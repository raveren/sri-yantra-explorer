/* Śrī Yantra Explorer — deep-zoom viewer + region annotation authoring.
 *
 * Data lives in data/regions.json (schema v2):
 *   meta.languages           — [{code, label}, ...]; add a language here to extend
 *   groups[key].label        — {en: ..., lt: ...}
 *   regions[].label          — {en: ..., lt: ...}
 *   regions[].content        — devanagari/iast shared; translation/explanation localized
 *
 * One page: index.html opens as the public explorer. Opening it with ?edit
 * prompts for the editor password (verified by api/auth.php) and unlocks the
 * editor: tracing, language tabs, character keyboards, images, Save via
 * api/save.php. All mutating requests carry the password as X-Edit-Token.
 */
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';
const DRAFT_KEY = 'sri-yantra-draft-v2';
const LANG_KEY = 'sri-yantra-lang';
const TOKEN_KEY = 'sri-yantra-edit-token';
// Editing is unlocked by opening the page with ?edit and entering the editor
// password; api/auth.php verifies it, then it is sent with every save/upload.
let editAllowed = false;
let editToken = '';
const EDIT_FOOT = '<b>E</b> edit · <b>N</b> new region · <b>Enter</b> close polygon · ' +
  '<b>Esc</b> cancel/deselect · <b>Del</b> delete · <b>H</b> overlays · <b>Ctrl+S</b> save';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let data = null;                 // {meta, groups, regions}
let viewer = null;
let svg = null, gRegions = null, gDraw = null, gHandles = null;
const IMG = { w: 0, h: 0 };

let LANGS = [{ code: 'en', label: 'English' }];
let lang = 'en';                 // display language (visitor page)
let contentLang = 'en';          // language tab in the editor form

let selectedId = null;
let selectedGroup = null;        // group key when an āvaraṇa is selected via the legend's [i]
let hoveredId = null;
let editMode = false;
let overlaysVisible = true;
const hiddenGroups = new Set();
let drawing = null;              // {points: [[x,y],...], rubber: [x,y]|null}
let draggingHandle = false;
let dirty = false;
let draftTimer = null;
let autoDev = null, autoIast = null;   // last auto-transliterated values (see syncTransliteration)

const $ = (id) => document.getElementById(id);

/* ============================= i18n ============================= */

const UI = {
  en: {
    region: 'Region', index: 'Index', overlays: 'Overlays', avaranas: 'Āvaraṇas',
    translation: 'Translation', explanation: 'Explanation', zoomTo: 'Zoom to region',
    only: 'Only', info: 'About this group', group: 'Group', zoomToGroup: 'Zoom to group',
    foot: 'Click a region to read it · <b>H</b> toggles overlays · <b>Esc</b> deselects',
    emptyHtml:
      '<h2>Śrī Yantra Explorer</h2>' +
      '<p>A scanned copper Śrī Yantra plate, explorable like a map: drag to pan, ' +
      'scroll or pinch to zoom.</p>' +
      '<p>Click a highlighted region to read its mantra — Devanagari, transliteration, ' +
      'translation and commentary. The <b>Index</b> tab lists every annotated region ' +
      'by enclosure.</p>' +
      '<p class="hint">Press <b>H</b> to hide the overlays and view the bare plate.</p>' +
      '<p class="hint">Learn more: <a href="sri-yantra-explained.html">The Śrī Yantra, ' +
      'Explained</a> · <a href="devanagari.html">Reading the letters</a></p>',
  },
  lt: {
    region: 'Sritis', index: 'Rodyklė', overlays: 'Žymės', avaranas: 'Āvaraṇos',
    translation: 'Vertimas', explanation: 'Paaiškinimas', zoomTo: 'Priartinti sritį',
    only: 'Tik', info: 'Apie šią grupę', group: 'Grupė', zoomToGroup: 'Priartinti grupę',
    foot: 'Spustelėkite sritį · <b>H</b> — žymės · <b>Esc</b> — atžymėti',
    emptyHtml:
      '<h2>Śrī Yantros žemėlapis</h2>' +
      '<p>Skenuota varinė Śrī Yantros plokštė, tyrinėjama kaip žemėlapis: tempkite, ' +
      'kad slinktumėte, sukite pelės ratuką arba žnybkite, kad priartintumėte.</p>' +
      '<p>Spustelėkite pažymėtą sritį — pamatysite jos mantrą: devanagari raštą, ' +
      'transliteraciją, vertimą ir paaiškinimą. Skirtuke <b>Rodyklė</b> — visos sritys ' +
      'pagal āvaraṇas.</p>' +
      '<p class="hint">Paspauskite <b>H</b>, kad paslėptumėte žymes ir matytumėte gryną plokštę.</p>' +
      '<p class="hint">Daugiau (EN): <a href="sri-yantra-explained.html">The Śrī Yantra, ' +
      'Explained</a> · <a href="devanagari.html">Reading the letters</a></p>',
  },
};

const T = (key) => (UI[lang] && UI[lang][key]) || UI.en[key] || '';

// Read a possibly-localized value: plain strings pass through (legacy),
// objects resolve to the requested language, falling back to en / anything.
function locGet(value, code, fallback = true) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value[code]) return value[code];
  if (!fallback) return '';
  return value.en || Object.values(value).find(Boolean) || '';
}

function locSet(container, key, code, text) {
  let cur = container[key];
  if (cur == null || typeof cur === 'string') {
    cur = container[key] = cur ? { en: cur } : {};
  }
  cur[code] = text;
}

function applyLang(code, persist = true) {
  lang = code;
  if (persist) {
    try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode */ }
  }
  const set = (id, key, asHtml) => {
    const el = $(id);
    if (el) el[asHtml ? 'innerHTML' : 'textContent'] = T(key);
  };
  set('tab-region', 'region');
  set('tab-index', 'index');
  set('tb-overlays', 'overlays');
  set('legend-title', 'avaranas');
  set('panel-foot', 'foot', true);
  if (editAllowed) { const f = $('panel-foot'); if (f) f.innerHTML = EDIT_FOOT; }
  set('rv-trans-h', 'translation');
  set('rv-expl-h', 'explanation');
  set('rv-zoom', 'zoomTo');
  const empty = $('region-empty');
  if (empty && UI[lang] && UI[lang].emptyHtml) empty.innerHTML = UI[lang].emptyHtml;
  document.querySelectorAll('#tb-lang button').forEach((b) =>
    b.classList.toggle('on', b.dataset.lang === lang));
  renderPanel();
  refreshLists();
}

function initVisitorLang() {
  const switcher = $('tb-lang');
  if (switcher) {
    for (const l of LANGS) {
      const b = document.createElement('button');
      b.dataset.lang = l.code;
      b.textContent = l.code.toUpperCase();
      b.title = l.label;
      b.onclick = () => applyLang(l.code);
      switcher.appendChild(b);
    }
  }
  const welcomeLangs = $('welcome-langs');
  if (welcomeLangs) {
    for (const l of LANGS) {
      const b = document.createElement('button');
      b.textContent = l.label;
      b.onclick = () => { applyLang(l.code); $('welcome').classList.add('hidden'); };
      welcomeLangs.appendChild(b);
    }
  }
  let stored = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch { /* private mode */ }
  if (stored && LANGS.some((l) => l.code === stored)) {
    applyLang(stored, false);
  } else {
    applyLang(LANGS[0].code, false);
    if (!editAllowed) $('welcome')?.classList.remove('hidden');
  }
}

/* ============================= editor access ============================= */

async function verifyToken(token) {
  try {
    const res = await fetch('api/auth.php', { method: 'POST', headers: { 'X-Edit-Token': token } });
    if (res.status === 429) { alert('Too many failed attempts — try again in a few minutes.'); return false; }
    return res.ok;
  } catch {
    return false;
  }
}

function grantEdit(token) {
  editAllowed = true;
  editToken = token;
  document.body.classList.add('can-edit');
}

// ?edit in the URL: reuse this tab's verified password or prompt for one.
async function initEditAccess() {
  if (!new URLSearchParams(location.search).has('edit')) return;
  let stored = '';
  try { stored = sessionStorage.getItem(TOKEN_KEY) || ''; } catch { /* private mode */ }
  if (stored && await verifyToken(stored)) { grantEdit(stored); return; }
  const entered = prompt('Editor password:');
  if (entered == null || entered === '') return;
  if (await verifyToken(entered)) {
    try { sessionStorage.setItem(TOKEN_KEY, entered); } catch { /* private mode */ }
    grantEdit(entered);
  } else {
    alert('Wrong password.');
  }
}

/* ============================= boot ============================= */

async function boot() {
  const resp = await fetch('data/regions.json', { cache: 'no-store' });
  data = await resp.json();
  normalizeData();
  if (Array.isArray(data.meta.languages) && data.meta.languages.length) {
    LANGS = data.meta.languages;
  }
  contentLang = LANGS[0].code;
  await initEditAccess();

  viewer = OpenSeadragon({
    id: 'viewer',
    tileSources: 'tiles.dzi',
    showNavigationControl: false,
    showNavigator: true,
    navigatorPosition: 'TOP_RIGHT',
    maxZoomPixelRatio: 3,
    minZoomImageRatio: 0.7,
    visibilityRatio: 0.7,
    gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: false },
  });

  viewer.addHandler('open', () => {
    const size = viewer.world.getItemAt(0).getContentSize();
    IMG.w = size.x; IMG.h = size.y;
    buildOverlay();
    renderRegions();
    refreshLists();
    checkDraft();
  });

  viewer.addHandler('canvas-click', onCanvasClick);
  viewer.addHandler('canvas-double-click', (e) => {
    if (drawing && drawing.points.length >= 3) { finishDrawing(); e.preventDefaultAction = true; }
  });
  viewer.addHandler('update-viewport', () => {
    if (gHandles && gHandles.childNodes.length) rescaleHandles();
    if (drawing) renderDraw();
  });

  viewer.element.addEventListener('mousemove', onMouseMove);
  wireUi();
  initVisitorLang();
  if (editAllowed) setEditMode(true);
}

function buildOverlay() {
  svg = document.createElementNS(SVGNS, 'svg');
  svg.id = 'anno-svg';
  svg.setAttribute('viewBox', `0 0 ${IMG.w} ${IMG.h}`);
  gRegions = document.createElementNS(SVGNS, 'g'); gRegions.id = 'regions-layer';
  gDraw = document.createElementNS(SVGNS, 'g'); gDraw.id = 'draw-layer';
  gHandles = document.createElementNS(SVGNS, 'g'); gHandles.id = 'handles-layer';
  svg.append(gRegions, gDraw, gHandles);
  viewer.addOverlay({
    element: svg,
    location: viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(0, 0, IMG.w, IMG.h)),
  });
  gHandles.addEventListener('pointerdown', onHandlePointerDown);
  gHandles.addEventListener('pointerenter', () => { if (editMode) viewer.setMouseNavEnabled(false); }, true);
  gHandles.addEventListener('pointerleave', () => { if (!draggingHandle) viewer.setMouseNavEnabled(true); }, true);
}

/* ======================== geometry helpers ======================== */

function imageZoom() { // screen px per image px
  return viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
}

function imagePointFromClient(clientX, clientY) {
  const r = viewer.element.getBoundingClientRect();
  const vp = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(clientX - r.left, clientY - r.top));
  const ip = viewer.viewport.viewportToImageCoordinates(vp);
  return [ip.x, ip.y];
}

function imagePointFromOsd(position) {
  const vp = viewer.viewport.pointFromPixel(position);
  const ip = viewer.viewport.viewportToImageCoordinates(vp);
  return [ip.x, ip.y];
}

function clampPt(x, y) {
  return [Math.round(Math.min(Math.max(x, 0), IMG.w)), Math.round(Math.min(Math.max(y, 0), IMG.h))];
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function hitTest(x, y) {
  let best = null, bestArea = Infinity;
  for (const r of data.regions) {
    if (hiddenGroups.has(r.group)) continue;
    if (pointInPoly(x, y, r.polygon)) {
      const a = polyArea(r.polygon);
      if (a < bestArea) { best = r; bestArea = a; }
    }
  }
  return best;
}

const byId = (id) => data.regions.find((r) => r.id === id);
const groupOf = (r) => data.groups[r.group] || { label: r.group, color: '#999999' };

function nextId() {
  let n = 0;
  for (const r of data.regions) {
    const m = /^r-(\d+)$/.exec(r.id);
    if (m) n = Math.max(n, +m[1]);
  }
  return `r-${String(n + 1).padStart(3, '0')}`;
}

/* ========================= targets: regions & groups ========================= */

// Groups (āvaraṇas) carry the same annotatable payload as regions.
function normalizeData() {
  const emptyContent = () => ({ devanagari: '', iast: '', translation: {}, explanation: {} });
  for (const g of Object.values(data.groups)) {
    g.content = g.content || emptyContent();
    g.images = g.images || [];
  }
  for (const r of data.regions) {
    r.content = r.content || emptyContent();
    r.images = r.images || [];
  }
}

// The thing the side panel is showing/editing: a region or a group.
function currentTarget() {
  if (selectedGroup && data.groups[selectedGroup]) {
    return { kind: 'group', id: selectedGroup, obj: data.groups[selectedGroup] };
  }
  if (selectedId) {
    const r = byId(selectedId);
    if (r) return { kind: 'region', id: selectedId, obj: r };
  }
  return null;
}

function selectGroup(key) {
  if (!data.groups[key]) return;
  select(null);
  selectedGroup = key;
  renderPanel();
  buildLegend();
  showTab('region');
}

// Bounding box of a target in image pixels (a group = union of its regions).
function targetBBox(t) {
  if (t.kind === 'region') return bboxOf(t.obj.polygon);
  const pts = data.regions.filter((r) => r.group === t.id).flatMap((r) => r.polygon);
  return pts.length ? bboxOf(pts) : null;
}

// "Only": show just this group; pressing it again on the solo group shows all.
function soloGroup(key) {
  const others = Object.keys(data.groups).filter((k) => k !== key);
  const isSolo = !hiddenGroups.has(key) && others.every((k) => hiddenGroups.has(k));
  hiddenGroups.clear();
  if (!isSolo) others.forEach((k) => hiddenGroups.add(k));
  buildLegend();
  renderRegions();
}

// Markdown -> HTML for display. Raw HTML in the source is neutralised (only
// Markdown syntax renders) and links are limited to safe schemes, so editor
// content can never inject scripts into visitors' browsers.
function renderMarkdown(text) {
  if (!text) return '';
  const noHtml = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = null;
  if (typeof marked !== 'undefined') {
    try { html = marked.parse(noHtml, { breaks: true }); } catch { html = null; }
  }
  if (html == null) {
    html = '<p>' + noHtml.replace(/&(?!lt;|gt;)/g, '&amp;').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('a').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (/^(https?:|mailto:|#|\/|\.)/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    else a.removeAttribute('href');
  });
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const at of Array.from(el.attributes)) if (/^on/i.test(at.name)) el.removeAttribute(at.name);
  });
  return tpl.innerHTML;
}

/* ========================= region rendering ========================= */

function renderRegions() {
  gRegions.textContent = '';
  for (const r of data.regions) {
    const poly = document.createElementNS(SVGNS, 'polygon');
    poly.setAttribute('points', r.polygon.map((p) => p.join(',')).join(' '));
    poly.setAttribute('vector-effect', 'non-scaling-stroke');
    poly.dataset.id = r.id;
    const col = groupOf(r).color;
    poly.style.fill = col;
    poly.style.stroke = col;
    poly.classList.add('region');
    if (r.id === selectedId) poly.classList.add('selected');
    if (r.id === hoveredId) poly.classList.add('hover');
    if (hiddenGroups.has(r.group)) poly.classList.add('hidden-region');
    gRegions.appendChild(poly);
  }
  renderHandles();
}

function polyDom(id) { return gRegions.querySelector(`polygon[data-id="${id}"]`); }

function updatePolyDom(r) {
  const el = polyDom(r.id);
  if (el) el.setAttribute('points', r.polygon.map((p) => p.join(',')).join(' '));
}

function setHover(id) {
  if (id === hoveredId) return;
  if (hoveredId) polyDom(hoveredId)?.classList.remove('hover');
  hoveredId = id;
  if (hoveredId) polyDom(hoveredId)?.classList.add('hover');
  viewer.element.style.cursor = drawing ? 'crosshair' : hoveredId ? 'pointer' : '';
}

function select(id) {
  if (selectedId) polyDom(selectedId)?.classList.remove('selected');
  selectedId = id;
  autoDev = autoIast = null;
  if (selectedGroup) { selectedGroup = null; buildLegend(); }
  if (selectedId) polyDom(selectedId)?.classList.add('selected');
  renderHandles();
  renderPanel();
  refreshIndexSelection();
}

function zoomToRegion(r) { zoomToBBox(bboxOf(r.polygon)); }

function zoomToBBox(b) {
  const pad = Math.max(b.w, b.h) * 0.35 + 40;
  const rect = viewer.viewport.imageToViewportRectangle(
    new OpenSeadragon.Rect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad));
  viewer.viewport.fitBounds(rect);
}

/* ========================= vertex handles ========================= */

function renderHandles() {
  gHandles.textContent = '';
  if (!editMode || !selectedId) return;
  const r = byId(selectedId);
  if (!r) return;
  const rad = 6 / imageZoom(), mrad = 4.5 / imageZoom();
  r.polygon.forEach((p, i) => {
    const q = r.polygon[(i + 1) % r.polygon.length];
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', (p[0] + q[0]) / 2); c.setAttribute('cy', (p[1] + q[1]) / 2);
    c.setAttribute('r', mrad);
    c.classList.add('handle', 'mid');
    c.dataset.insertAfter = i;
    gHandles.appendChild(c);
  });
  r.polygon.forEach((p, i) => {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
    c.setAttribute('r', rad);
    c.classList.add('handle', 'vert');
    c.dataset.index = i;
    gHandles.appendChild(c);
  });
}

function rescaleHandles() {
  const rad = 6 / imageZoom(), mrad = 4.5 / imageZoom();
  gHandles.querySelectorAll('.vert').forEach((c) => c.setAttribute('r', rad));
  gHandles.querySelectorAll('.mid').forEach((c) => c.setAttribute('r', mrad));
}

function onHandlePointerDown(e) {
  const t = e.target;
  if (!t.classList || !t.classList.contains('handle')) return;
  e.stopPropagation();
  e.preventDefault();
  const r = byId(selectedId);
  if (!r) return;

  if (t.classList.contains('vert') && e.altKey) {   // Alt-click removes a vertex
    if (r.polygon.length > 3) {
      r.polygon.splice(+t.dataset.index, 1);
      updatePolyDom(r); renderHandles(); markDirty();
    }
    return;
  }

  let index;
  if (t.dataset.insertAfter !== undefined) {        // mid handle: insert then drag
    index = +t.dataset.insertAfter + 1;
    r.polygon.splice(index, 0, clampPt(...imagePointFromClient(e.clientX, e.clientY)));
    updatePolyDom(r); renderHandles();
  } else {
    index = +t.dataset.index;
  }

  draggingHandle = true;
  viewer.setMouseNavEnabled(false);
  const move = (ev) => {
    r.polygon[index] = clampPt(...imagePointFromClient(ev.clientX, ev.clientY));
    updatePolyDom(r); renderHandles();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    draggingHandle = false;
    viewer.setMouseNavEnabled(true);
    markDirty();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ========================= drawing (tracing) ========================= */

function startDrawing() {
  if (!editMode || drawing) return;
  drawing = { points: [], rubber: null };
  select(null);
  $('drawhint')?.classList.remove('hidden');
  viewer.element.style.cursor = 'crosshair';
}

function addDrawPoint(x, y) {
  const pts = drawing.points;
  const [cx, cy] = clampPt(x, y);
  if (pts.length) {
    const [lx, ly] = pts[pts.length - 1];
    if (Math.hypot(cx - lx, cy - ly) < 2 / imageZoom()) return;  // dblclick duplicate
  }
  if (pts.length >= 3) {
    const [fx, fy] = pts[0];
    if (Math.hypot(cx - fx, cy - fy) < 12 / imageZoom()) { finishDrawing(); return; }
  }
  pts.push([cx, cy]);
  renderDraw();
}

function renderDraw() {
  gDraw.textContent = '';
  if (!drawing || !drawing.points.length) return;
  const all = drawing.rubber ? [...drawing.points, drawing.rubber] : drawing.points;
  const line = document.createElementNS(SVGNS, 'polyline');
  line.setAttribute('points', all.map((p) => p.join(',')).join(' '));
  line.classList.add('draw-line');
  gDraw.appendChild(line);
  const first = document.createElementNS(SVGNS, 'circle');
  first.setAttribute('cx', drawing.points[0][0]);
  first.setAttribute('cy', drawing.points[0][1]);
  first.setAttribute('r', 12 / imageZoom());
  first.classList.add('draw-first');
  gDraw.appendChild(first);
}

function finishDrawing() {
  if (!drawing || drawing.points.length < 3) return;
  const region = {
    id: nextId(),
    label: {},
    group: $('tb-group')?.value || 'other',
    polygon: drawing.points,
    content: { devanagari: '', iast: '', translation: {}, explanation: {} },
  };
  cancelDrawing();
  data.regions.push(region);
  renderRegions();
  refreshLists();
  select(region.id);
  markDirty();
  $('re-label')?.focus();
  // every new region gets a crop of itself attached by default
  cropRegion(region).catch((err) => status('auto-crop failed: ' + err.message));
}

function cancelDrawing() {
  drawing = null;
  gDraw.textContent = '';
  $('drawhint')?.classList.add('hidden');
  viewer.element.style.cursor = '';
}

/* ========================= viewer events ========================= */

function onCanvasClick(e) {
  if (!e.quick) return;
  const [x, y] = imagePointFromOsd(e.position);
  if (drawing) { addDrawPoint(x, y); e.preventDefaultAction = true; return; }
  if (!overlaysVisible) return;
  const hit = hitTest(x, y);
  select(hit ? hit.id : null);
}

function onMouseMove(e) {
  if (draggingHandle || !gRegions) return;
  const [x, y] = imagePointFromClient(e.clientX, e.clientY);
  if (drawing) {
    drawing.rubber = clampPt(x, y);
    renderDraw();
    return;
  }
  setHover(overlaysVisible ? (hitTest(x, y)?.id ?? null) : null);
}

/* ========================= side panel ========================= */

function renderPanel() {
  const t = currentTarget();
  $('region-empty').classList.toggle('hidden', !!t);
  $('region-view').classList.toggle('hidden', !t || editMode);
  const editForm = $('region-edit');
  if (editForm) editForm.classList.toggle('hidden', !t || !editMode);
  if (!t) return;
  const o = t.obj, isGroup = t.kind === 'group';

  if (editMode) {
    $('re-label').value = locGet(o.label, contentLang, false);
    $('re-group-wrap')?.classList.toggle('hidden', isGroup);
    $('re-trans-wrap')?.classList.toggle('hidden', isGroup);   // groups have no translation
    $('re-delete')?.classList.toggle('hidden', isGroup);
    if (!isGroup) $('re-group').value = o.group;
    const cropBtn = $('re-img-crop');
    if (cropBtn) cropBtn.title = isGroup
      ? 'Crop the area covering all regions of this group and attach it'
      : 'Crop this region from the full-resolution scan and attach it';
    $('re-dev').value = o.content.devanagari || '';
    $('re-iast').value = o.content.iast || '';
    $('re-trans').value = locGet(o.content.translation, contentLang, false);
    $('re-expl').value = locGet(o.content.explanation, contentLang, false);
    $('re-id').textContent = t.id;
    renderLangTabs();
    renderImages($('re-images'), o, true);
  } else {
    const chip = $('rv-group');
    if (isGroup) {
      chip.textContent = T('group');
      chip.style.background = o.color;
      chip.classList.remove('clickable');
      chip.title = '';
      chip.onclick = null;
    } else {
      const g = groupOf(o);
      chip.textContent = locGet(g.label, lang);
      chip.style.background = g.color;
      chip.classList.add('clickable');
      chip.title = T('info');
      chip.onclick = () => selectGroup(o.group);
    }
    $('rv-label').textContent = locGet(o.label, lang) || t.id;
    $('rv-dev').textContent = o.content.devanagari || '';
    $('rv-iast').textContent = o.content.iast || '';
    renderImages($('rv-images'), o, false);
    $('rv-trans-block')?.classList.toggle('hidden', isGroup);   // groups have no translation
    $('rv-trans').textContent = locGet(o.content.translation, lang) || '—';
    $('rv-expl').innerHTML = renderMarkdown(locGet(o.content.explanation, lang)) || '—';
    const zoomBtn = $('rv-zoom');
    zoomBtn.textContent = isGroup ? T('zoomToGroup') : T('zoomTo');
    zoomBtn.classList.toggle('hidden', !targetBBox(t));
  }
}

function renderLangTabs() {
  const wrap = $('re-langtabs');
  if (!wrap) return;
  const t = currentTarget();
  const r = t && t.obj;
  wrap.textContent = '';
  for (const l of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'langtab' + (l.code === contentLang ? ' active' : '');
    const has = r && (locGet(r.label, l.code, false) ||
      locGet(r.content.translation, l.code, false) ||
      locGet(r.content.explanation, l.code, false));
    if (!has) b.classList.add('empty');
    b.textContent = l.code.toUpperCase();
    b.title = l.label;
    b.onclick = () => { contentLang = l.code; renderPanel(); };
    wrap.appendChild(b);
  }
}

function showTab(which) {
  $('tab-region').classList.toggle('active', which === 'region');
  $('tab-index').classList.toggle('active', which === 'index');
  $('panel-region').classList.toggle('hidden', which !== 'region');
  $('panel-index').classList.toggle('hidden', which !== 'index');
}

/* ========================= legend & index ========================= */

function buildLegend() {
  const body = $('legend-body');
  body.textContent = '';
  for (const [key, g] of Object.entries(data.groups)) {
    const count = data.regions.filter((r) => r.group === key).length;
    const row = document.createElement('div');
    row.className = 'legend-row' + (hiddenGroups.has(key) ? ' off' : '') +
      (selectedGroup === key ? ' active' : '');
    row.innerHTML = `<span class="legend-chip" style="background:${esc(g.color)}"></span>` +
      `<span>${esc(locGet(g.label, lang))}</span><span class="legend-count">${count}</span>` +
      `<button type="button" class="legend-only">${T('only')}</button>` +
      `<button type="button" class="legend-info" title="${T('info')}">i</button>`;
    row.addEventListener('click', () => {
      if (hiddenGroups.has(key)) hiddenGroups.delete(key); else hiddenGroups.add(key);
      row.classList.toggle('off');
      renderRegions();
    });
    row.querySelector('.legend-only').onclick = (e) => { e.stopPropagation(); soloGroup(key); };
    row.querySelector('.legend-info').onclick = (e) => { e.stopPropagation(); selectGroup(key); };
    body.appendChild(row);
  }
}

function buildIndex() {
  const el = $('panel-index');
  el.textContent = '';
  for (const [key, g] of Object.entries(data.groups)) {
    const regions = data.regions.filter((r) => r.group === key);
    if (!regions.length) continue;
    const h = document.createElement('h4');
    h.innerHTML = `<span class="legend-chip" style="background:${esc(g.color)}"></span>${esc(locGet(g.label, lang))}`;
    h.style.cursor = 'pointer';
    h.title = T('info');
    h.addEventListener('click', () => {
      selectGroup(key);
      const b = targetBBox({ kind: 'group', id: key });
      if (b) zoomToBBox(b);
    });
    el.appendChild(h);
    for (const r of regions) {
      const item = document.createElement('div');
      item.className = 'index-item';
      item.dataset.id = r.id;
      const dev = r.content.devanagari
        ? `<div class="devanagari">${esc(r.content.devanagari.slice(0, 40))}${r.content.devanagari.length > 40 ? '…' : ''}</div>` : '';
      item.innerHTML = `<div>${esc(locGet(r.label, lang) || r.id)}</div>${dev}`;
      item.addEventListener('click', () => { select(r.id); zoomToRegion(r); showTab('region'); });
      el.appendChild(item);
    }
  }
  refreshIndexSelection();
}

function refreshIndexSelection() {
  document.querySelectorAll('.index-item').forEach((el) =>
    el.classList.toggle('selected', el.dataset.id === selectedId));
}

function refreshLists() { buildLegend(); buildIndex(); }

/* ========================= persistence ========================= */

function markDirty() {
  dirty = true;
  status('unsaved changes');
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ time: Date.now(), data }));
    } catch { /* storage full — Save/Export still works */ }
  }, 400);
}

function status(msg) {
  const el = $('tb-status');
  if (el) el.textContent = msg;
}

async function save() {
  if (!editAllowed) return;
  data.meta.saved = Date.now();
  const body = JSON.stringify(data, null, 2);
  try {
    const res = await fetch('api/save.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Edit-Token': editToken },
      body,
    });
    if (!res.ok) throw new Error(String(res.status));
    dirty = false;
    localStorage.removeItem(DRAFT_KEY);
    status('saved ✓ (data/regions.json)');
  } catch {
    const blob = new Blob([body], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'regions.json';
    a.click();
    URL.revokeObjectURL(a.href);
    status('no save server — downloaded regions.json, replace data/regions.json with it');
  }
}

function checkDraft() {
  if (!editAllowed) return;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { /* corrupt draft */ }
  if (!draft || !draft.data || (draft.time || 0) <= (data.meta.saved || 0)) return;
  $('draftbar').classList.remove('hidden');
  $('draft-restore').onclick = () => {
    data = draft.data;
    normalizeData();
    $('draftbar').classList.add('hidden');
    select(null);
    renderRegions();
    refreshLists();
    markDirty();
    status('draft restored — remember to Save');
  };
  $('draft-discard').onclick = () => {
    localStorage.removeItem(DRAFT_KEY);
    $('draftbar').classList.add('hidden');
  };
}

/* ========================= character keyboards ========================= */

const IAST_CHARS = ['ā', 'ī', 'ū', 'ṛ', 'ṝ', 'ḷ', 'ḹ', 'ṅ', 'ñ', 'ṭ', 'ḍ', 'ṇ', 'ś', 'ṣ', 'ṁ', 'ḥ'];

const DEV_KBD = [
  ['ॐ', 'श्रीं', 'ह्रीं', 'क्लीं', 'ऐं', 'सौः', 'हूं', 'श्री', 'नमः', '।', '॥', 'र्', '्र'],
  ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ऋ', 'ॠ', 'ऌ', 'ॡ', 'ए', 'ऐ', 'ओ', 'औ', 'अं', 'अः'],
  ['ा', 'ि', 'ी', 'ु', 'ू', 'ृ', 'ॄ', 'ॢ', 'ॣ', 'े', 'ै', 'ो', 'ौ', 'ं', 'ः', 'ँ', '्', 'ऽ'],
  ['क', 'ख', 'ग', 'घ', 'ङ', 'च', 'छ', 'ज', 'झ', 'ञ'],
  ['ट', 'ठ', 'ड', 'ढ', 'ण', 'त', 'थ', 'द', 'ध', 'न'],
  ['प', 'फ', 'ब', 'भ', 'म', 'य', 'र', 'ल', 'व', 'ळ'],
  ['श', 'ष', 'स', 'ह', '०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
];

const DEV_KEY_TITLES = {
  'ॐ': 'oṁ — praṇava, the absolute',
  'श्रीं': 'śrīṁ — lakṣmī-bīja (abundance, Lakṣmī)',
  'ह्रीं': 'hrīṁ — māyā-bīja (the goddess’s creative power)',
  'क्लीं': 'klīṁ — kāma-bīja (desire, attraction)',
  'ऐं': 'aiṁ — vāgbhava-bīja (speech, wisdom)',
  'सौः': 'sauḥ — parā-bīja (the supreme Śakti)',
  'हूं': 'hūṁ — kūrca-bīja (protective force)',
  'श्री': 'śrī — auspicious; honorific',
  'नमः': 'namaḥ — homage, salutation',
  '।': 'daṇḍa — end of a line or sentence',
  '॥': 'double daṇḍa — end of a verse',
  'र्': 'repha — r BEFORE the next consonant, drawn as a hook above it: स + र् + व = सर्व (sarva)',
  '्र': 'ra AFTER a consonant, drawn as a stroke below it: क + ्र = क्र (kra), प + ्र = प्र (pra)',
  '्': 'virāma — removes the inherent a; joins consonants into a conjunct',
  'ं': 'anusvāra (ṁ) — nasal hum closing a syllable',
  'ः': 'visarga (ḥ) — breathy echo of the vowel',
  'ँ': 'candrabindu — nasalized vowel',
  'ऽ': 'avagraha — an elided initial a (so’ham)',
  'ळ': 'ḻa — retroflex l (Vedic)',
};

function devKeyTitle(ch) {
  if (DEV_KEY_TITLES[ch]) return DEV_KEY_TITLES[ch];
  if (typeof devanagariToIast !== 'function') return '';
  if (/^[०-९]$/.test(ch)) return 'numeral ' + devanagariToIast(ch);
  if (/^[ा-ौॢॣ]$/.test(ch)) {
    const v = devanagariToIast('क' + ch).slice(1);
    return `vowel sign ${v} — after a consonant: क${ch} (k${v})`;
  }
  if (/^[अ-औ]$/.test(ch) || ch === 'अं' || ch === 'अः') return `${devanagariToIast(ch)} — vowel, independent form`;
  return `${devanagariToIast(ch)} — consonant (inherent a)`;
}

function insertAtCursor(el, text) {
  el.focus();
  // Insert through the browser's own editing command so the change joins the
  // field's native undo history (Ctrl+Z / Ctrl+Y work like typed text). It
  // fires a real 'input' event itself. Fall back to a plain value edit if the
  // command is unavailable.
  let done = false;
  try { done = document.execCommand('insertText', false, text); } catch (_) { done = false; }
  if (done) return;
  const s = el.selectionStart ?? el.value.length;
  const e = el.selectionEnd ?? s;
  el.setRangeText(text, s, e, 'end');
  el.dispatchEvent(new Event('input'));
}

/* ========================= region images ========================= */

// Draw an image onto a canvas rotated by 0/90/180/270 degrees.
function drawRotated(canvas, img, rot) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return;
  const swap = rot % 180 !== 0;
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
}

function renderImages(container, r, editable) {
  if (!container) return;
  container.textContent = '';
  const images = r.images || [];
  images.forEach((im, idx) => {
    const fig = document.createElement('figure');
    fig.className = 'rimg';
    const canvas = document.createElement('canvas');
    fig.appendChild(canvas);
    const img = new Image();
    img.onload = () => drawRotated(canvas, img, im.rotation || 0);
    img.src = im.file;

    if (editable) {
      const tools = document.createElement('div');
      tools.className = 'rimg-tools';
      const btn = (label, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.title = title; b.onclick = fn;
        tools.appendChild(b);
      };
      const rotate = (delta) => {
        im.rotation = (((im.rotation || 0) + delta) % 360 + 360) % 360;
        drawRotated(canvas, img, im.rotation);
        markDirty();
      };
      btn('↺', 'Rotate left 90°', () => rotate(-90));
      btn('↻', 'Rotate right 90°', () => rotate(90));
      const cap = document.createElement('input');
      cap.placeholder = `caption (${contentLang.toUpperCase()})`;
      cap.value = locGet(im.caption, contentLang, false);
      cap.addEventListener('input', () => { locSet(im, 'caption', contentLang, cap.value); markDirty(); });
      tools.appendChild(cap);
      btn('✕', 'Delete this image', () => deleteImage(r, idx));
      fig.appendChild(tools);
    } else {
      const cap = locGet(im.caption, lang);
      if (cap) {
        const fc = document.createElement('figcaption');
        fc.textContent = cap;
        fig.appendChild(fc);
      }
    }
    container.appendChild(fig);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile failed: ' + url));
    img.src = url;
  });
}

// Stitch the full-resolution tiles covering the region's bounding box onto a
// canvas (capped at 1600 px on the long side) and return a JPEG blob.
async function cropBBox(b) {
  const src = viewer.source;
  const ov = src.tileOverlap || 0;
  const pad = Math.round(Math.max(b.w, b.h) * 0.04 + 8);
  const x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(IMG.w, b.x + b.w + pad), y1 = Math.min(IMG.h, b.y + b.h + pad);

  let level = src.maxLevel, scale = 1;
  while (Math.max(x1 - x0, y1 - y0) / scale > 1600 && level > 0) { level--; scale *= 2; }
  const ts = src.getTileWidth ? src.getTileWidth(level) : src.tileSize;

  const lx0 = Math.floor(x0 / scale), ly0 = Math.floor(y0 / scale);
  const lx1 = Math.ceil(x1 / scale), ly1 = Math.ceil(y1 / scale);
  const canvas = document.createElement('canvas');
  canvas.width = lx1 - lx0;
  canvas.height = ly1 - ly0;
  const ctx = canvas.getContext('2d');

  const jobs = [];
  for (let row = Math.floor(ly0 / ts); row <= Math.floor((ly1 - 1) / ts); row++) {
    for (let col = Math.floor(lx0 / ts); col <= Math.floor((lx1 - 1) / ts); col++) {
      jobs.push(loadImage(src.getTileUrl(level, col, row)).then((img) => {
        const tx = col * ts - (col > 0 ? ov : 0);
        const ty = row * ts - (row > 0 ? ov : 0);
        ctx.drawImage(img, tx - lx0, ty - ly0);
      }));
    }
  }
  await Promise.all(jobs);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

async function uploadImage(blob, filename, regionId) {
  const fd = new FormData();
  fd.append('action', 'upload');
  fd.append('region', regionId || 'img');
  fd.append('file', blob, filename);
  const res = await fetch('api/image.php', { method: 'POST', headers: { 'X-Edit-Token': editToken }, body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.file) throw new Error(json.error || `upload failed (${res.status})`);
  return json.file;
}

// Upload a blob and attach it to a region or group object (id names the file).
async function attachImage(blob, filename, obj, id, persist = true) {
  status('uploading image…');
  const file = await uploadImage(blob, filename, id);
  (obj.images = obj.images || []).push({ file, rotation: 0, caption: {} });
  if (currentTarget()?.obj === obj) renderPanel();
  markDirty();
  if (persist) await save();
}

async function cropTarget(obj, id, b, persist = true) {
  status(`cropping ${id} from tiles…`);
  const blob = await cropBBox(b);
  await attachImage(blob, `${id}.jpg`, obj, id, persist);
}

function cropRegion(r, persist = true) {
  return cropTarget(r, r.id, bboxOf(r.polygon), persist);
}

async function cropSelected() {
  const t = currentTarget();
  if (!t) return;
  const b = targetBBox(t);
  if (!b) { status('this group has no regions to crop yet'); return; }
  try { await cropTarget(t.obj, t.id, b); } catch (err) { status('crop failed: ' + err.message); }
}

async function deleteImage(r, idx) {
  const im = r.images[idx];
  if (!im || !confirm('Delete this image?')) return;
  const fd = new FormData();
  fd.append('action', 'delete');
  fd.append('file', im.file.split('/').pop());
  try {
    const res = await fetch('api/image.php', { method: 'POST', headers: { 'X-Edit-Token': editToken }, body: fd });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    status('could not delete the file on the server (reference removed anyway)');
  }
  r.images.splice(idx, 1);
  renderPanel();
  markDirty();
  await save();
}

// Typing in one script field auto-fills the other while the other field is
// empty or still holds what we auto-generated; as soon as it is edited by
// hand the link is broken (until the region is re-selected).
function syncTransliteration(source) {
  const dev = $('re-dev'), iast = $('re-iast');
  const t = currentTarget();
  const r = t && t.obj;
  if (!r || !dev || !iast || typeof iastToDevanagari !== 'function') return;
  if (source === 'iast') {
    if (dev.value.trim() === '' || dev.value === autoDev) {
      autoDev = iastToDevanagari(iast.value);
      dev.value = autoDev;
      r.content.devanagari = autoDev;
    }
  } else {
    if (iast.value.trim() === '' || iast.value === autoIast) {
      autoIast = devanagariToIast(dev.value);
      iast.value = autoIast;
      r.content.iast = autoIast;
    }
  }
}

function buildKeyboards() {
  const iastBar = $('iast-bar');
  if (iastBar) {
    for (const ch of IAST_CHARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = ch;
      b.onmousedown = (e) => e.preventDefault(); // keep the caret in the field
      b.onclick = () => insertAtCursor($('re-iast'), ch);
      iastBar.appendChild(b);
    }
  }
  const kbd = $('dev-kbd');
  if (kbd) {
    DEV_KBD.forEach((row, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'kbd-sep';
        kbd.appendChild(sep);
      }
      for (const ch of row) {
        const b = document.createElement('button');
        b.type = 'button';
        // combining marks (vowel signs, virāma, anusvāra…) are shown on a dotted circle
        b.textContent = /^[ऀ-ःऺ-़ा-्॑-ॗॢॣ]/.test(ch) ? '◌' + ch : ch;
        b.title = devKeyTitle(ch);
        b.dataset.ch = ch;
        b.onmousedown = (e) => e.preventDefault(); // keep the caret in the field
        b.onclick = () => insertAtCursor($('re-dev'), ch);
        kbd.appendChild(b);
      }
    });
    $('re-dev-kbd').onclick = () => kbd.classList.toggle('hidden');
  }
}

/* ========================= ui wiring ========================= */

function setEditMode(on) {
  if (!editAllowed) return;
  editMode = on;
  document.body.classList.toggle('edit', on);
  $('tb-edit').classList.toggle('on', on);
  if (!on && drawing) cancelDrawing();
  renderHandles();
  renderPanel();
}

function setOverlays(on) {
  overlaysVisible = on;
  $('tb-overlays').classList.toggle('on', on);
  svg.classList.toggle('no-overlays', !on);
  if (!on) setHover(null);
}

function fillGroupSelects() {
  for (const sel of [$('tb-group'), $('re-group')].filter(Boolean)) {
    sel.textContent = '';
    for (const [key, g] of Object.entries(data.groups)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = locGet(g.label, 'en');
      sel.appendChild(opt);
    }
    if (sel.id === 'tb-group') sel.value = 'inscription';
  }
}

function deleteSelected() {
  const r = selectedId && byId(selectedId);
  if (!r) return;
  if (!confirm(`Delete region "${locGet(r.label, 'en') || r.id}"?`)) return;
  data.regions.splice(data.regions.indexOf(r), 1);
  select(null);
  renderRegions();
  refreshLists();
  markDirty();
}

function wireUi() {
  fillGroupSelects();
  buildKeyboards();

  // editor-only elements are absent on the read-only page
  const onClick = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };

  onClick('tb-zoom-in', () => { viewer.viewport.zoomBy(1.5); viewer.viewport.applyConstraints(); });
  onClick('tb-zoom-out', () => { viewer.viewport.zoomBy(1 / 1.5); viewer.viewport.applyConstraints(); });
  onClick('tb-home', () => viewer.viewport.goHome());
  onClick('tb-overlays', () => setOverlays(!overlaysVisible));
  onClick('tb-edit', () => setEditMode(!editMode));
  onClick('tb-new', startDrawing);
  onClick('tb-save', save);

  onClick('tab-region', () => showTab('region'));
  onClick('tab-index', () => showTab('index'));
  const zoomToTarget = () => { const t = currentTarget(); const b = t && targetBBox(t); if (b) zoomToBBox(b); };
  onClick('rv-zoom', zoomToTarget);
  onClick('re-zoom', zoomToTarget);
  onClick('re-delete', deleteSelected);
  onClick('re-img-crop', cropSelected);
  onClick('re-img-upload', () => $('re-img-file').click());
  const fileInput = $('re-img-file');
  if (fileInput) fileInput.addEventListener('change', async () => {
    const t = currentTarget();
    if (t) {
      for (const f of Array.from(fileInput.files)) {
        try { await attachImage(f, f.name, t.obj, t.id); } catch (err) { status('upload failed: ' + err.message); }
      }
    }
    fileInput.value = '';
  });

  onClick('legend-toggle', () => {
    const body = $('legend-body');
    const hidden = body.classList.toggle('hidden');
    $('legend-toggle').textContent = hidden ? '+' : '–';
  });

  // live-apply edit form; label/translation/explanation write to the active language tab
  const bind = (id, apply, localized) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const t = currentTarget();
      if (!t) return;
      apply(t.obj, el.value);
      if (localized) renderLangTabs();
      markDirty();
    });
  };
  bind('re-label', (r, v) => { locSet(r, 'label', contentLang, v); refreshLists(); }, true);
  bind('re-dev', (r, v) => { r.content.devanagari = v; syncTransliteration('dev'); });
  bind('re-iast', (r, v) => { r.content.iast = v; syncTransliteration('iast'); });
  bind('re-trans', (r, v) => locSet(r.content, 'translation', contentLang, v), true);
  bind('re-expl', (r, v) => locSet(r.content, 'explanation', contentLang, v), true);
  const reGroup = $('re-group');
  if (reGroup) reGroup.addEventListener('change', () => {
    const t = currentTarget();
    if (!t || t.kind !== 'region') return;
    t.obj.group = reGroup.value;
    renderRegions();
    refreshLists();
    markDirty();
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    switch (e.key) {
      case 'e': case 'E': setEditMode(!editMode); break;
      case 'h': case 'H': setOverlays(!overlaysVisible); break;
      case 'n': case 'N': if (editMode) startDrawing(); break;
      case 'Enter': if (drawing) finishDrawing(); break;
      case 'Escape': if (drawing) cancelDrawing(); else select(null); break;
      case 'Delete': case 'Backspace': if (editMode) deleteSelected(); break;
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

boot();

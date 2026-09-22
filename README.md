# Śrī Yantra Explorer

Google-Maps-style deep-zoom viewer for the copper Śrī Yantra scan, with
selectable regions that explain each engraved mantra.

## Run

On Windows, double-click `start.bat` (needs PHP on PATH, e.g. from Laravel
Herd). It serves this folder on the first free port of 8080, 8000 or 8888
and opens the browser; `start.bat 9000` forces a specific port. Or, from
this folder:

```
php -S localhost:8080
```

Open http://localhost:8080.

If a port refuses to bind with "forbidden by its access permissions",
Windows has reserved it for Hyper-V / WSL (list the ranges with
`netsh interface ipv4 show excludedportrange protocol=tcp`) — pick another.

The page opens as the public explorer. To edit, open it with **`?edit`**
(http://localhost:8080/?edit) and enter the editor password. Saving POSTs
to `api/save.php`, which writes `data/regions.json` and keeps the last 30
timestamped backups in `data/backups/`. Without PHP (plain static hosting)
the viewer works fully but editing cannot be unlocked.

Change the password with `php api/set-password.php 'new password'` (it is
stored only as a bcrypt hash in `api/config.php`). That file is git-ignored;
a fresh checkout falls back to `api/config.example.php` (password `1008`)
until you set a real one.

## Using the viewer

Drag to pan, scroll/pinch to zoom — the image is a 3,175-tile Deep Zoom
pyramid at full 12,028 × 12,199 resolution, so it stays sharp and fast at any
zoom, including on phones.

- Click a highlighted region → its mantra appears in the side panel
  (Devanagari, IAST, translation, explanation).
- Visitors never see editing UI; it only appears after `?edit` and the
  password (kept for the browser tab in sessionStorage — closing the tab
  forgets it).
- **Index** tab: browse all regions grouped by āvaraṇa; click to fly to one.
- Legend (bottom left): click a row to toggle that āvaraṇa's overlays,
  **Only** (LT: *Tik*) to show just that one (press again to show all),
  **i** to open the āvaraṇa's own entry — images, Devanagari, IAST,
  translation, explanation — in the side panel. The group chip on a
  region's entry and the group headings in the Index open it too. **H**
  hides all overlays to view the bare plate.
- Explanations are Markdown (bold, italics, lists, links, headings…) and
  render as such in the viewer.

## Authoring regions (edit mode)

Open the page with `?edit` and enter the password (edit mode starts
automatically), then:

1. Press **E** (or the Edit button).
2. Pick the target group in the toolbar dropdown, press **N**, then click
   around a mantra to trace it. Click the first point (or press **Enter**) to
   close the polygon; **Esc** cancels. You can pan/zoom mid-trace.
3. Fill in the panel — changes apply live. Devanagari and IAST are shared
   across languages; label, translation and explanation are per-language via
   the EN/LT tabs (dimmed tab = that language still empty). Below the fields:
   an IAST character bar (ā ṛ ś ṣ ṁ …) and a toggleable on-screen Devanagari
   keyboard (⌨ button), both inserting at the cursor. Typing in either
   script field auto-fills the other (`js/translit.js`) as long as the other
   field is empty or still holds the auto-generated text; editing it by hand
   breaks the link. Hyphens in IAST are dropped so compounds render joined.
   **Internal notes** (bottom of the form) is a free-text scratch field for
   editors — to-dos, doubts, sources to check. It is saved with the region
   (and with groups) but never rendered in the public viewer.
   Each region can carry images. A newly traced region automatically gets a
   crop of itself attached (the full-resolution tiles under it, stitched into
   a JPEG ≤1600 px); **📷 Crop region** adds another crop on demand (e.g.
   after reshaping), and **Upload…** attaches your own JPEG/PNG/WebP. Per image: ↺ ↻ rotate in
   90° steps (stored as metadata, non-destructive), a per-language caption,
   ✕ delete. Files go to `data/images/` via `api/image.php`; uploads and
   deletes save `regions.json` immediately, rotations/captions on Ctrl+S.
4. Reshape a selected region: drag the white dots (vertices), drag the small
   faint dots to insert a vertex, **Alt-click** a vertex to remove it.
   **Del** deletes the whole region.
5. **Ctrl+S** / Save writes `data/regions.json` through the server.
6. Āvaraṇas (groups) are edited the same way: in edit mode press the legend's
   **i** on a row and the same form appears for the group — its label,
   images (**Crop region** here crops the area covering all of the group's
   regions), Devanagari, IAST and Markdown explanation (no translation field
   for groups).

Edits are also autosaved to browser localStorage; if the tab dies before
saving, the app offers to restore the draft on next load.

## Localization

Visitors get a welcome screen with a language choice (remembered in
localStorage) and an EN/LT switcher in the toolbar; empty translations fall
back to English. To add a language:

1. Add `{"code": "xx", "label": "..."}` to `meta.languages` in
   `data/regions.json` — the editor grows a tab and the visitor page a
   button automatically.
2. Optionally translate the UI chrome by adding a `xx` entry to the `UI`
   dictionary at the top of `js/app.js` (falls back to English otherwise),
   and per-language group labels in `data/regions.json`.

## Files

| Path | What |
| --- | --- |
| `tiles.dzi`, `tiles_files/` | Deep Zoom pyramid (generated, ~3,175 JPEG tiles) |
| `data/regions.json` | All content: groups (āvaraṇas), region polygons in image pixels, and per-region text |
| `js/app.js`, `css/app.css`, `index.html` | The app (vanilla JS, no build step); explorer by default, editor after `?edit` + password |
| `vendor/openseadragon.min.js` | OpenSeadragon 5.0.1, vendored |
| `start.bat` | Windows launcher: finds a free port, runs `php -S`, opens the browser |
| `api/auth.php`, `api/save.php`, `api/image.php` | Password check, save, and image upload/delete endpoints; all go through `api/_auth.php` (bcrypt check + per-IP throttling) |
| `api/config.php`, `api/set-password.php` | The password hash, and the command-line tool that sets it |
| `data/images/` | Region images (cropped from the scan or uploaded), referenced from `regions.json` |
| `sri-yantra-explained.html` | Reference on the yantra's meaning: the nine āvaraṇas, all deity name lists (Devanagari + IAST), mantras, worship, sources — served at `/sri-yantra-explained.html` |
| `devanagari.html` | Letter-reading reference (vowels, consonants, conjuncts, bījas found on the plate) — served at `/devanagari.html` |

To regenerate tiles after retouching the scan, keep `sri-yantra-v4.jpg` in
the folder *above* `app/` and run `python make_dzi.py` (needs Pillow):
254px tiles, overlap 1, JPEG q88, ~3,200 files, about a minute.

## Deploying

Upload the contents of this folder to the PHP host (e.g. so that
`index.html` sits at `https://rokas.online/sri-yantra/`). Then:

- **Set a real password first**: `php api/set-password.php 'long passphrase'`
  before uploading (or run it on the host). The default `1008` is only for
  local use — four digits are guessable even with throttling.
- Make sure `data/`, `data/backups/` and `data/images/` exist and are
  writable by the web server (typically `chmod 775`, or the host panel's
  permissions tool). Test: open `?edit`, log in, press Ctrl+S — the status
  should say "saved ✓".
- Use HTTPS (the password travels in a request header).
- `data/.htaccess` forbids executing scripts from the upload folder. If the
  host returns a 500 for images after upload, the host disallows that
  directive — delete the file; uploads are already restricted to
  JPEG/PNG/WebP by content sniffing and get fixed extensions.
- Hosts often cap `upload_max_filesize` at 2 MB; crops are well under that,
  large custom photos may be rejected — resize them first.
- Editing works directly on the live site through `?edit`; there is nothing
  else to run on the server.

Security model, for the record: every write goes through `api/_auth.php`
(bcrypt `password_verify`, 5 failures → 10-minute lock per IP, log stored as
a self-exiting `.php` file); custom-header auth means cross-site forgery is
impossible without CORS, which is not enabled; uploads are MIME-sniffed,
renamed, and confined to `data/images/`; deletes are basename-sanitised;
editor-authored text is HTML-escaped everywhere and Markdown renders with raw
HTML disabled and links restricted to http(s)/mailto. `regions.json`,
backups and images are public by design (they are the content).

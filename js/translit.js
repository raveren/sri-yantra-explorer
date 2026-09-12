/* IAST <-> Devanagari transliteration for Sanskrit.
 * Exposes window.iastToDevanagari / window.devanagariToIast in the browser
 * (module.exports in Node for tests). Sanskrit rules: every consonant carries
 * an inherent "a" unless followed by a vowel sign or virāma; consonant
 * clusters get virāma (the font renders the conjunct). Hyphens between IAST
 * word-parts are dropped so compounds render joined, as engraved. */
(function (root) {
  'use strict';

  const VIRAMA = '्';

  // IAST consonant -> Devanagari letter (with inherent a)
  const CONS = {
    k: 'क', kh: 'ख', g: 'ग', gh: 'घ', 'ṅ': 'ङ',
    c: 'च', ch: 'छ', j: 'ज', jh: 'झ', 'ñ': 'ञ',
    'ṭ': 'ट', 'ṭh': 'ठ', 'ḍ': 'ड', 'ḍh': 'ढ', 'ṇ': 'ण',
    t: 'त', th: 'थ', d: 'द', dh: 'ध', n: 'न',
    p: 'प', ph: 'फ', b: 'ब', bh: 'भ', m: 'म',
    y: 'य', r: 'र', l: 'ल', v: 'व',
    'ś': 'श', 'ṣ': 'ष', s: 'स', h: 'ह', 'ḻ': 'ळ',
  };

  // IAST vowel -> [independent letter, vowel sign after a consonant]
  const VOW = {
    a: ['अ', ''], 'ā': ['आ', 'ा'], i: ['इ', 'ि'], 'ī': ['ई', 'ी'],
    u: ['उ', 'ु'], 'ū': ['ऊ', 'ू'], 'ṛ': ['ऋ', 'ृ'], 'ṝ': ['ॠ', 'ॄ'],
    'ḷ': ['ऌ', 'ॢ'], 'ḹ': ['ॡ', 'ॣ'], e: ['ए', 'े'], ai: ['ऐ', 'ै'],
    o: ['ओ', 'ो'], au: ['औ', 'ौ'],
  };

  const DIGITS_TO_DEV = { 0: '०', 1: '१', 2: '२', 3: '३', 4: '४', 5: '५', 6: '६', 7: '७', 8: '८', 9: '९' };

  function iastToDevanagari(text) {
    let s = (text || '').normalize('NFC').toLowerCase();
    // the sacred syllable is written with its own sign
    s = s.replace(/\b(?:oṁ|oṃ|om̐)(?![a-zāīūṛṝḷḹṅñṭḍṇśṣṁṃḥ])/g, 'ॐ');
    let out = '';
    let pendingCons = false;   // a consonant was emitted and awaits vowel / virāma
    let i = 0;
    while (i < s.length) {
      const one = s[i];
      const two = s.substr(i, 2);

      if (one === 'm' && s[i + 1] === '̐') {           // m̐ candrabindu
        if (pendingCons) out += VIRAMA;
        out += 'ँ'; pendingCons = false; i += 2; continue;
      }
      const cons = CONS[two] ? two : (CONS[one] ? one : null);
      if (cons) {
        if (pendingCons) out += VIRAMA;
        out += CONS[cons]; pendingCons = true; i += cons.length; continue;
      }
      const vow = VOW[two] ? two : (VOW[one] ? one : null);
      if (vow) {
        out += pendingCons ? VOW[vow][1] : VOW[vow][0];
        pendingCons = false; i += vow.length; continue;
      }
      if (one === 'ṁ' || one === 'ṃ') { if (pendingCons) out += VIRAMA; out += 'ं'; pendingCons = false; i++; continue; }
      if (one === 'ḥ') { if (pendingCons) out += VIRAMA; out += 'ः'; pendingCons = false; i++; continue; }
      if (one === '-') { i++; continue; }                    // join compound parts
      if (pendingCons) { out += VIRAMA; pendingCons = false; }
      if (two === '||') { out += '॥'; i += 2; continue; }
      if (one === '|') { out += '।'; i++; continue; }
      if (one === "'" || one === '’') { out += 'ऽ'; i++; continue; }
      if (DIGITS_TO_DEV[one] !== undefined) { out += DIGITS_TO_DEV[one]; i++; continue; }
      out += one; i++;
    }
    if (pendingCons) out += VIRAMA;
    return out;
  }

  const DEV_CONS = {};
  for (const [k, v] of Object.entries(CONS)) DEV_CONS[v] = k;
  const DEV_VOW = {}, DEV_SIGN = {};
  for (const [k, [ind, sign]] of Object.entries(VOW)) { DEV_VOW[ind] = k; if (sign) DEV_SIGN[sign] = k; }
  const DEV_MARK = { 'ं': 'ṁ', 'ः': 'ḥ', 'ँ': 'm̐', 'ऽ': "'", '।': '|', '॥': '||', 'ॐ': 'oṁ' };
  const DEV_DIGITS = {};
  for (const [k, v] of Object.entries(DIGITS_TO_DEV)) DEV_DIGITS[v] = k;
  const SKIP = new Set(['़', '‌', '‍']);   // nukta, ZWNJ, ZWJ

  function devanagariToIast(text) {
    const chars = Array.from((text || '').normalize('NFC'));
    let out = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (SKIP.has(ch)) continue;
      if (DEV_CONS[ch]) {
        out += DEV_CONS[ch];
        let j = i + 1;
        while (j < chars.length && SKIP.has(chars[j])) j++;
        const next = chars[j];
        if (next === VIRAMA) { i = j; }
        else if (next && DEV_SIGN[next]) { out += DEV_SIGN[next]; i = j; }
        else out += 'a';
        continue;
      }
      if (DEV_VOW[ch]) { out += DEV_VOW[ch]; continue; }
      if (DEV_MARK[ch]) { out += DEV_MARK[ch]; continue; }
      if (DEV_DIGITS[ch]) { out += DEV_DIGITS[ch]; continue; }
      if (ch === VIRAMA) continue;                           // stray virāma
      out += ch;
    }
    return out;
  }

  const api = { iastToDevanagari, devanagariToIast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);

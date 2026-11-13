// Small helpers shared by the parser and the QTI builders. No DOM or library globals here,
// so these modules run unchanged in the browser and in Node tests.

export function xmlEscape(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function slugify(name = '') {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'bank';
}

const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;

export function looksLikeHtml(text = '') {
  return HTML_TAG.test(String(text));
}

// Canvas stores question text and feedback as HTML. Plain text is escaped and line breaks are kept;
// text that already contains HTML tags is passed through unchanged.
export function toHtml(text = '') {
  const str = String(text ?? '').trim();
  if (!str) return '';
  if (looksLikeHtml(str)) return str;
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p>${para.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
  return `<div>${escaped}</div>`;
}

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;

// src values of <img> tags in an HTML string.
export function imageRefs(html = '') {
  return [...String(html ?? '').matchAll(IMG_SRC)].map((m) => m[3]);
}

// True for file names like "graph.png" or "img/graph.png"; false for URLs, data: URIs and Canvas paths.
export function isRelativeSrc(src = '') {
  return !!src && !/^([a-z][a-z0-9+.-]*:|\/\/|\/|\$IMS-CC-FILEBASE\$)/i.test(src);
}

// Rewrites <img src="name"> using map(name) -> new src (or null to leave it alone).
export function rewriteImageSrcs(html, map) {
  return String(html ?? '').replace(IMG_SRC, (m, pre, q, src) => {
    const next = map(src);
    return next ? `${pre}${q}${next}${q}` : m;
  });
}

// Lookup key for an image reference: the bare file name, case-insensitive ("img/Graph.PNG" -> "graph.png").
export function imageKey(src = '') {
  return decodeURIComponentSafe(String(src).split(/[?#]/)[0].split(/[\\/]/).pop()).toLowerCase();
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Canvas-safe file name: keeps letters, digits, dot, dash, underscore.
export function safeFileName(name = '') {
  const base = String(name).split(/[\\/]/).pop();
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'image';
}

export function stripHtml(text = '') {
  return String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Canvas-style identifiers: "g" + 32 hex characters.
export function randomIdent() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return 'g' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Deterministic 32-hex hash (four FNV-1a passes with different seeds). Not cryptographic;
// used only to derive stable, collision-resistant XML identifiers from a seed + row id.
export function hashIdent(input) {
  const str = String(input);
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return 'g' + out;
}

// Canvas writes decimals like "1.0" and "33.33".
export function formatNumber(n) {
  if (!Number.isFinite(n)) return '0.0';
  const rounded = Math.round(n * 10000) / 10000;
  return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
}

// Splits list cells such as "choice_1;choice_3" or "Na | na". Commas are NOT separators,
// so answers like "1,000" or "Paris, France" survive.
export function splitList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value).split(/[;|\n]+/).map((s) => s.trim()).filter(Boolean);
}

// Tags are informational only, so commas are allowed there too.
export function splitTags(value) {
  if (value === undefined || value === null) return [];
  return String(value).split(/[;,|]+/).map((s) => s.trim()).filter(Boolean);
}

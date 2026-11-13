// Reads a .docx (e.g. Google Docs → File → Download → Microsoft Word) into HTML plus its images.
// mammoth and JSZip are passed in so this runs in the browser (CDN globals) and in Node tests.

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp' };

// The course team's style guide: Title / Heading 1 = title, Heading 2 = steps and objectives, Heading 3 = figure
// titles, Heading 4 = Directions, Heading 5 = feedback text, Subtitle = figure descriptions.
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p.figure-description:fresh",
];

// ---------- Image size and text wrapping ----------
// mammoth drops each image's size and placement. Word records them on <w:drawing>: wp:extent (size in EMU)
// and, for images text wraps around, wp:anchor with a wrap type and horizontal position. We read them from
// document.xml, keyed by media file in document order, and match them to mammoth's images by their bytes.

const EMU_PER_PX = 9525; // 914400 EMU per inch, 96 px per inch

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${bytes.length}:${h}`;
}

async function readImageLayouts(zip, documentXml) {
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string') || '';
  const targets = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target && !/^https?:/i.test(a.Target)) targets.set(a.Id, `word/${a.Target.replace(/^\/?(word\/)?/, '')}`);
  }
  // Width of the text column, for deciding whether a wrapped image sits on the left or the right
  const pg = attrs(/<w:pgSz\b[^>]*>/.exec(documentXml)?.[0] || '');
  const mar = attrs(/<w:pgMar\b[^>]*>/.exec(documentXml)?.[0] || '');
  const columnEmu = ((Number(pg['w:w']) || 12240) - (Number(mar['w:left']) || 1440) - (Number(mar['w:right']) || 1440)) * 635;

  const hashes = new Map(); // media path -> content hash
  const hashOf = async (path) => {
    if (!hashes.has(path)) {
      const bytes = await zip.file(path)?.async('uint8array');
      hashes.set(path, bytes ? fnv(bytes) : null);
    }
    return hashes.get(path);
  };
  // Layouts are queued by image content, in document order (the order mammoth converts images in), so
  // identical image files used in several places each get their own size.
  const queues = new Map(); // content hash -> [{ width, height, float }]
  for (const m of documentXml.matchAll(/<w:drawing>([\s\S]*?)<\/w:drawing>/g)) {
    const d = m[1];
    const embed = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(d)?.[1];
    const path = embed && targets.get(embed);
    const ext = attrs(/<wp:extent\b[^>]*>/.exec(d)?.[0] || '');
    if (!path || !ext.cx || !ext.cy) continue;
    const layout = { width: Math.round(Number(ext.cx) / EMU_PER_PX), height: Math.round(Number(ext.cy) / EMU_PER_PX), float: null };
    const wraps = /<wp:(wrapSquare|wrapTight|wrapThrough)\b/.test(d);
    if (/<wp:anchor\b/.test(d) && wraps) {
      const posH = /<wp:positionH\b[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(d)?.[1] || '';
      const align = /<wp:align>(\w+)<\/wp:align>/.exec(posH)?.[1];
      const offset = Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posH)?.[1]);
      if (align === 'left' || align === 'right') layout.float = align;
      else if (Number.isFinite(offset)) layout.float = offset + Number(ext.cx) / 2 > columnEmu / 2 ? 'right' : 'left';
    }
    const hash = await hashOf(path);
    if (!hash) continue;
    if (!queues.has(hash)) queues.set(hash, []);
    queues.get(hash).push(layout);
  }
  return {
    // Next layout for an image with these bytes (each placement in turn)
    take(bytes) {
      const queue = queues.get(fnv(bytes));
      return queue?.length ? queue.shift() : null;
    },
  };
}

const FLOAT_STYLE = {
  left: 'float: left; margin: 0 16px 12px 0;',
  right: 'float: right; margin: 0 0 12px 16px;',
};

export async function extractDocx(arrayBuffer, { mammoth, JSZip }) {
  const warnings = [];
  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    throw new Error("This file isn't a Word document (.docx). In Google Docs use File → Download → Microsoft Word (.docx).");
  }
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error("This file isn't a Word document (.docx): word/document.xml is missing.");

  const edits = (documentXml.match(/<w:(ins|del)\b/g) || []).length;
  if (edits) {
    warnings.push({
      severity: 'error',
      message: `The document still has ${edits} suggested edit(s). Accept or reject all suggestions in Google Docs (Tools → Review suggested edits), then download it again. Otherwise suggested text may end up in the quiz.`,
    });
  }
  const commentsXml = await zip.file('word/comments.xml')?.async('string');
  const comments = commentsXml ? (commentsXml.match(/<w:comment\b/g) || []).length : 0;
  if (comments) {
    warnings.push({ severity: 'warning', message: `The document has ${comments} comment(s). Comments aren't imported, but check that none of them change a question or answer.` });
  }

  const images = [];
  const layouts = await readImageLayouts(zip, documentXml);
  const input = typeof window === 'undefined' && typeof Buffer !== 'undefined'
    ? { buffer: Buffer.from(arrayBuffer) }
    : { arrayBuffer };
  const result = await mammoth.convertToHtml(input, {
    styleMap: STYLE_MAP,
    convertImage: mammoth.images.imgElement(async (image) => {
      const ext = IMAGE_EXT[image.contentType] || 'png';
      const name = `image-${String(images.length + 1).padStart(2, '0')}.${ext}`;
      const data = new Uint8Array(await image.readAsArrayBuffer());
      images.push({ name, contentType: image.contentType, altText: image.altText || '', data });
      // Keep the size the author gave the image, and its side if text wraps around it.
      const layout = layouts.take(data);
      const out = { src: name };
      if (layout) {
        out.width = String(layout.width);
        out.height = String(layout.height);
        if (layout.float) out.style = FLOAT_STYLE[layout.float];
      }
      return out;
    }),
  });
  return { html: result.value, images, warnings };
}

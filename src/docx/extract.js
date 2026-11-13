// Reads a .docx (e.g. Google Docs → File → Download → Microsoft Word) into HTML plus its images.
// mammoth and JSZip are passed in so this runs in the browser (CDN globals) and in Node tests.

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp' };

// The course team's style guide: Title / Heading 1 = title, Heading 2 = steps and objectives, Heading 3 = figure
// titles, Heading 4 = Directions, Heading 5 = feedback text, Subtitle = figure descriptions.
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p.figure-description:fresh",
];

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
  const input = typeof window === 'undefined' && typeof Buffer !== 'undefined'
    ? { buffer: Buffer.from(arrayBuffer) }
    : { arrayBuffer };
  const result = await mammoth.convertToHtml(input, {
    styleMap: STYLE_MAP,
    convertImage: mammoth.images.imgElement(async (image) => {
      const ext = IMAGE_EXT[image.contentType] || 'png';
      const name = `image-${String(images.length + 1).padStart(2, '0')}.${ext}`;
      images.push({ name, contentType: image.contentType, altText: image.altText || '', data: new Uint8Array(await image.readAsArrayBuffer()) });
      return { src: name };
    }),
  });
  return { html: result.value, images, warnings };
}

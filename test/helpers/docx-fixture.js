// Builds small .docx files for tests from a list of blocks, so tests don't depend on course documents.
//   { p: 'text' | [{ text, bold }], style?: 'Title'|'Heading1'|'Heading2', list?: { num: 1|2, level: 0|1 }, inserted?: true }
//   { image: 'name.png', alt?: '' }
//   { table: [['Item', 'Cost'], ['Stand', '$10.00']] }
import JSZip from 'jszip';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const run = ({ text, bold, br }) => (br ? '<w:r><w:br/></w:r>'
  : `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`);

function paragraph(block) {
  const runs = (Array.isArray(block.p) ? block.p : [{ text: block.p }]).map(run).join('');
  const pPr = [
    block.style ? `<w:pStyle w:val="${block.style}"/>` : '',
    block.list ? `<w:numPr><w:ilvl w:val="${block.list.level}"/><w:numId w:val="${block.list.num}"/></w:numPr>` : '',
  ].join('');
  const body = block.inserted ? `<w:ins w:id="99" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">${runs}</w:ins>` : runs;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`;
}

function imageParagraph(block, rId, id) {
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="${id}" name="Picture ${id}" descr="${esc(block.alt ?? '')}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(block.image)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const table = (rows) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p>${run({ text: c })}</w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

export async function makeDocx(blocks, { comments = 0 } = {}) {
  const zip = new JSZip();
  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
  ];
  let images = 0;
  const body = blocks.map((b) => {
    if (b.image) {
      images += 1;
      const rId = `rIdImg${images}`;
      rels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${images}.png"/>`);
      zip.file(`word/media/image${images}.png`, PNG);
      return imageParagraph(b, rId, images);
    }
    if (b.table) return table(b.table);
    return paragraph(b);
  }).join('');

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
${comments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style>
</w:styles>`);
  zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`);
  if (comments) {
    zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${Array.from({ length: comments }, (_, i) => `<w:comment w:id="${i}" w:author="R"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`);
  }
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Variations found in real course documents (Google Docs exports), with invented content.
const REMINDER = 'Remember to save your work before you close the tab, or your progress will be lost.';
export const CONVENTION_VARIANTS = [
  { p: [{ text: 'Learning Outcomes and Course Goals', bold: true }] },
  { p: 'Goal 1: Observe celestial objects.' },
  { p: 'Unit 2 Comet Lab', style: 'Title' },
  { p: 'Greetings, astronomer.' },
  { p: 'Objective 1: Measure the comet', style: 'Heading1' },
  { p: 'Step 1: Observe the comet', style: 'Heading2' },
  { p: [{ text: 'Equipment', bold: true }] },
  { p: 'A telescope and a notebook.' },
  { p: 'Figure 1', style: 'Heading3' },
  { image: 'comet.png', alt: 'A comet with a long tail near the Sun.' },
  { p: 'Figure 1. The comet near the Sun.', style: 'Heading2' },
  { p: 'The long description of Figure 1 goes here.', style: 'Subtitle' },
  { p: 'Directions', style: 'Heading4' },
  { p: 'Use Figure 1 to answer questions 1 to 3.' },
  { p: '[Zero Point] 1. Did you complete the training?' },
  { p: 'yes [*]', list: { num: 1, level: 0 } },
  { p: 'no', list: { num: 1, level: 0 } },
  { p: 'Feedback: ungraded', style: 'Heading5' },
  { p: [{ text: '2', bold: true }, { text: '. What is the comet’s radial speed? Enter your answer to the nearest 0.1 km/s.' }] },
  { p: '[NUMERIC RESPONSE]', style: 'Heading5' },
  { p: 'Requirement: Margin of error', style: 'Heading5' },
  { p: 'Answer: −12.5', style: 'Heading5' },
  { p: '+/- margin: 0', style: 'Heading5' },
  { p: 'Type: Absolute' },
  { p: 'Feedback', style: 'Heading5' },
  { p: 'Answer: −12.5 km/s', style: 'Heading5' },
  { p: 'You can find the speed in two ways:' },
  { p: '1) Read it from the chart.' },
  { p: '2) Calculate it from the table.' },
  { p: [{ text: '3. Is the comet bound to the Sun?' }, { br: true }, { text: 'a. yes [*]', bold: true }, { br: true }, { text: 'b. no' }] },
  { p: 'Feedback: Answer: yes', style: 'Heading5' },
  { p: REMINDER },
  { p: 'Step 2: Explain the motion', style: 'Heading2' },
  { p: 'Directions', style: 'Heading4' },
  { p: 'Which statement explains the speed change?', list: { num: 1, level: 0 } },
  { p: 'Gravity [*]', list: { num: 1, level: 0 } },
  { p: 'Friction', list: { num: 1, level: 0 } },
  { p: 'Feedback: Answer: Gravity', style: 'Heading5' },
  { p: '5. Describe the orbit in your own words.' },
  { p: '[ESSAY QUESTION]' },
  { p: 'Feedback:', style: 'Heading5' },
  { p: 'Answer: Your instructor will assess your answer.', style: 'Heading5' },
  { p: 'Simulator help', style: 'Heading2' },
  { p: '1. Open the simulator in a new tab.' },
  { p: '2. Press play and watch the orbit.' },
  { p: REMINDER },
  { p: 'Mission Training (ARCHIVE - delete when no longer needed)', style: 'Heading1' },
  { p: '##. Which old question is this?' },
  { p: 'a. this one [*]' },
  { p: 'b. that one' },
  { p: 'Closing remarks', style: 'Heading1' },
  { p: 'Well done.' },
];

export const LEMONADE_LAB = [
  { p: 'Published 1/1/26. Any changes made to this document will be implemented in the next version.' },
  { p: 'ECN100 - Lemonade Stand Lab', style: 'Title' },
  { p: 'To: Student' },
  { p: 'Welcome to the lab. You will analyze the stand’s costs.' },
  { p: 'Objective 1: Analyze the stand’s costs', style: 'Heading1' },
  { p: 'The stand has fixed and variable costs.' },
  { p: 'Remember to save your worksheet before you close the browser tab, or your work will be lost.' },
  { p: 'Step 1: Classify costs', style: 'Heading2' },
  { image: 'stand.png', alt: '' },
  { p: 'Figure 1. A lemonade stand with a price sign showing $2 per cup.' },
  { table: [['Item', 'Cost per day'], ['Stand rental', '$10.00'], ['City permit', '$5.00'], ['Lemons', '$12.00']] },
  { p: 'Directions Use Table 1 to answer questions 1 and 2.' },
  { p: '1. Which of the following are fixed costs? Select all that apply.' },
  { p: 'a. Stand rental [*]' },
  { p: 'b. Lemons' },
  { p: 'c. City permit [*]' },
  { p: 'Feedback:' },
  { p: 'Answer: Stand rental, City permit' },
  { p: 'These costs do not change with the number of cups sold.' },
  { p: '2. What is the fixed cost per day? Enter your answer to the nearest 0.01 dollars ($).' },
  { p: '[NUMERIC ANSWER]' },
  { p: 'Requirement: Margin of error' },
  { p: 'Answer: 15.00' },
  { p: '+/- margin: 0.1' },
  { p: 'Type: Absolute' },
  { p: [{ text: 'Feedback:', bold: true }, { text: ' Answer: $15.00' }] },
  { p: 'Fixed cost = $10.00 + $5.00 = $15.00.' },
  { p: 'Remember to save your worksheet before you close the browser tab, or your work will be lost.' },
  { p: 'Step 2: Interpret the results', style: 'Heading2' },
  { p: 'Directions Use your answers above for questions 3 and 4.' },
  { p: 'Does the stand make a profit at 40 cups?', list: { num: 1, level: 0 } },
  { p: 'yes [*]', list: { num: 1, level: 1 } },
  { p: 'no', list: { num: 1, level: 1 } },
  { p: 'Feedback: Answer: yes [*]' },
  { p: 'Revenue of $80.00 is more than the total cost.' },
  { p: 'Upload your completed worksheet as a PDF.', list: { num: 1, level: 0 } },
  { p: 'Feedback: Your instructor will review the worksheet.' },
  { p: 'Remember to save your worksheet before you close the browser tab, or your work will be lost.' },
  { p: 'Closing remarks', style: 'Heading1' },
  { p: 'Great work on the lab.' },
  { p: 'Thanks to the reviewers.', inserted: true },
  { p: 'Instructor guide', style: 'Heading1' },
  { p: 'Answer key: 1 a and c; 2 is 15.00. Instructor checkpoint ID 9999.' },
];

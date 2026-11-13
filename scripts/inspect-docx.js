// Dev tool: shows how a .docx is converted, item by item, with every finding. Use it when a new document
// doesn't import the way you expect.
//   npm run inspect -- "examples/My Lab.docx"            summary + items + findings
//   npm run inspect -- "examples/My Lab.docx" --html     also writes the raw HTML from mammoth to .tmp/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { DOMParser } from 'linkedom';
import { extractDocx } from '../src/docx/extract.js';
import { convertDocument } from '../src/docx/convert.js';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run inspect -- <document.docx> [--html]');
  process.exit(1);
}
const buf = readFileSync(file);
const x = await extractDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { mammoth, JSZip });
if (flag === '--html') {
  mkdirSync('.tmp', { recursive: true });
  writeFileSync('.tmp/inspect.html', x.html.replace(/(<\/(p|h\d|li|tr|table|ul|ol)>)/g, '$1\n'));
  console.log('Raw HTML written to .tmp/inspect.html');
}
const r = convertDocument(x.html, { parseHtml: (h) => new DOMParser().parseFromString(h, 'text/html'), fileName: file.split(/[\\/]/).pop() });
const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

console.log(`Title:       ${r.title}`);
console.log(`Items:       ${r.stats.questions} questions, ${r.stats.stimuli} directions groups, ${r.stats.text} text blocks, ${x.images.length} images`);
console.log(`Description: ${plain(r.description).slice(0, 160)}`);
x.warnings.forEach((w) => console.log(`Document:    ${w.severity}: ${w.message}`));
r.excluded.forEach((e) => console.log(`Excluded:    ${e.reason}: ${e.preview.slice(0, 100)}`));
console.log('');
r.rows.forEach((row, i) => {
  let answer = '';
  if (row.correct !== undefined) answer = ` [${row.correct}] of ${Object.keys(row).filter((k) => /^choice_\d+$/.test(k)).length} choices`;
  if (row.numeric_answer !== undefined) answer = ` = ${row.numeric_answer} ± ${row.numeric_tolerance ?? 0}`;
  const parent = row.parent_stimulus ? ` (in ${row.parent_stimulus})` : '';
  console.log(`${String(i + 1).padStart(3)}. ${row.id.padEnd(4)} ${row.type.padEnd(15)} ${row.title}${parent}: ${plain(row.question).slice(0, 80)}${answer}`);
});
console.log('');
r.findings.forEach((f) => console.log(`  item ${f.item ?? '-'} ${f.severity}: ${f.message}${f.fix ? ` [fix: ${f.fix.label}]` : ''}`));

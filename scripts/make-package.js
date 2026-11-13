// Command-line version of the builder, handy for testing imports:
//   npm run package -- templates/question-template.csv                 -> canvas-qti-demo-bank.zip
//   npm run package -- my-questions.xlsx out.zip --title "Unit 3"
//   npm run package -- my-questions.xlsx --images ./images              (image files the rows reference)
//   npm run package -- my-questions.xlsx --qti21                         (experimental QTI 2.1)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';
import JSZip from 'jszip';
import { parseRows, validateQuestions, groupIntoBanks } from '../src/parse.js';
import { buildCanvasPackage } from '../src/canvasQti.js';
import { buildQti21Package } from '../src/qti21.js';
import { slugify, imageKey } from '../src/util.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};
const qti21 = args.includes('--qti21') ? (args.splice(args.indexOf('--qti21'), 1), true) : false;
const title = flag('--title') || 'Question Bank';
const imageDir = flag('--images');
const [input, output] = args;
if (!input) {
  console.error('Usage: npm run package -- <questions.csv|.xlsx> [out.zip] [--title "Quiz"] [--images <folder>] [--qti21]');
  process.exit(1);
}

const images = new Map();
if (imageDir) {
  readdirSync(imageDir)
    .filter((f) => /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(f))
    .forEach((f) => images.set(imageKey(f), { name: f, data: readFileSync(join(imageDir, f)) }));
}

const wb = XLSX.readFile(input, { raw: false });
const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'questions') || wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
const questions = parseRows(rows);
const { errors, warnings } = validateQuestions(questions, { target: qti21 ? 'qti21' : 'canvas', images: new Set(images.keys()) });
warnings.forEach((w) => console.warn(`note  row ${w.row} (${w.id}): ${w.message}`));
if (errors.length) {
  errors.forEach((e) => console.error(`error row ${e.row} (${e.id}): ${e.message}`));
  process.exit(1);
}

const banks = groupIntoBanks(questions, title);
const pkg = qti21 ? buildQti21Package(banks) : buildCanvasPackage(banks, {}, { images });
const zip = new JSZip();
pkg.files.forEach((f) => zip.file(f.path, f.content));
(pkg.folders || []).forEach((f) => zip.folder(f));
const file = output || `${qti21 ? 'qti21-experimental' : 'canvas-qti'}-${banks.length === 1 ? slugify(banks[0].title) : 'quizzes'}.zip`;
writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
if (pkg.unusedImages?.length) console.warn(`note  unused images left out: ${pkg.unusedImages.join(', ')}`);
console.log(`Wrote ${file}: ${questions.length} items in ${banks.length} quiz(zes).`);

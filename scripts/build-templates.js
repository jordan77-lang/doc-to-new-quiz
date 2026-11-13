// Regenerates every template from src/schema.js so they can never drift out of sync:
//   templates/question-template.csv / .xlsx   headers + example rows (xlsx also has a Help sheet)
//   templates/blank-template.csv / .xlsx      headers only
//   templates/gsheet_setup_appsscript.js      header + type lists between the GENERATED markers
// Run with: npm run templates
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import XLSX from 'xlsx';
import { COLUMNS, EXAMPLE_ROWS, CANVAS_TYPES, TYPE_LABELS } from '../src/schema.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => join(root, 'templates', name);

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [COLUMNS.join(',')];
  rows.forEach((r) => lines.push(COLUMNS.map((c) => csvCell(r[c])).join(',')));
  // BOM so Excel opens UTF-8 (°, é, …) correctly
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const HELP = [
  ['bank_name', 'Quiz title. Each different value becomes its own quiz. Blank = title set on the page.'],
  ['id', 'Short unique id for the row (e.g. q1). Blank = row number. Needed on stimulus rows.'],
  ['type', Object.keys(CANVAS_TYPES).join(', ')],
  ['parent_stimulus', 'For a question that belongs to a stimulus: the id of the stimulus row.'],
  ['title', 'Optional question name shown in Canvas. Blank = id.'],
  ['question', 'Question text (or stimulus / text block content). Plain text or HTML.'],
  ['image / image_alt', 'Image file name shown above the question (add the file on the page) and its alt text.'],
  ['points', 'Points for the question. Blank = default on the page (0 for text_only and stimulus).'],
  ['feedback_general', 'Shown after answering, whatever the answer (the only feedback for essay / file_upload).'],
  ['feedback_correct', 'Shown when the answer is correct.'],
  ['feedback_incorrect', 'Shown when the answer is wrong.'],
  ['tags', 'For your own reference. Canvas does not import tags.'],
  ['choice_1 … choice_12', 'Answer choices for multiple_choice / multiple_answer.'],
  ['correct', 'multiple_choice: choice_2 (or 2, or B). multiple_answer: choice_1;choice_3. true_false: true or false. short_answer: accepted answers separated by ;'],
  ['partial_credit', 'multiple_answer: true = partial credit, false = all or nothing. Blank = page setting.'],
  ['numeric_answer / numeric_tolerance', 'numeric: exact answer, optionally ± tolerance (3.14 and 0.01).'],
  ['numeric_min / numeric_max', 'numeric: accept any value in this range (inclusive). Use instead of numeric_answer.'],
  ['matching_left_n / matching_right_n', 'matching: each left item and its correct match.'],
  ['matching_distractors', 'matching: extra wrong options for the dropdowns, separated by ;'],
  ['upload_file_types / upload_max_files', 'file_upload: allowed file types (e.g. PDF;DOCX) and how many files a student may upload.'],
  ['correct_order, category_n', 'Experimental QTI 2.1 export only (ordering / categorization).'],
  ['', ''],
  ['Separators', 'Lists use ; (or |). Commas are kept as part of the text.'],
  ['Types', Object.entries(CANVAS_TYPES).map(([k]) => `${k} = ${TYPE_LABELS[k]}`).join('; ')],
];

function writeXlsx(rows, path, withHelp) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  ws['!cols'] = COLUMNS.map((c) => ({ wch: c === 'question' ? 45 : Math.max(10, c.length + 2) }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  if (withHelp) {
    const help = XLSX.utils.aoa_to_sheet([['Column', 'How to fill it in'], ...HELP]);
    help['!cols'] = [{ wch: 34 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, help, 'Help');
  }
  XLSX.writeFile(wb, path);
}

writeFileSync(out('question-template.csv'), toCsv(EXAMPLE_ROWS));
writeFileSync(out('blank-template.csv'), toCsv([]));
writeXlsx(EXAMPLE_ROWS, out('question-template.xlsx'), true);
writeXlsx([], out('blank-template.xlsx'), true);

const gsPath = out('gsheet_setup_appsscript.js');
const gs = readFileSync(gsPath, 'utf8');
const generated = `  // BEGIN GENERATED (npm run templates)
  const headers = ${JSON.stringify(COLUMNS)};
  const types = ${JSON.stringify(Object.keys(CANVAS_TYPES))};
  // END GENERATED`;
const updated = gs.replace(/ {2}\/\/ BEGIN GENERATED[\s\S]*?\/\/ END GENERATED/, generated);
if (updated === gs && !gs.includes(generated)) throw new Error('GENERATED markers not found in gsheet_setup_appsscript.js');
writeFileSync(gsPath, updated);

console.log(`Templates written (${COLUMNS.length} columns, ${EXAMPLE_ROWS.length} example rows).`);

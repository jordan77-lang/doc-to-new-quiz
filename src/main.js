// Page wiring: read rows (paste / CSV / XLSX / JSON) + images → parse → validate → preview → build zip.
// Papa (PapaParse), XLSX (SheetJS), JSZip and saveAs (FileSaver) are loaded as globals in index.html.
import { parseRows, validateQuestions, groupIntoBanks, normalizeType } from './parse.js';
import { buildCanvasPackage, numericRule, questionPoints, bankQuestions } from './canvasQti.js';
import { buildQti21Package } from './qti21.js';
import { EXAMPLE_ROWS, TYPE_LABELS, COLUMNS } from './schema.js';
import { xmlEscape as esc, slugify, stripHtml, imageKey } from './util.js';
import { extractDocx } from './docx/extract.js';
import { convertDocument } from './docx/convert.js';

const fmtPts = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '?');

const $ = (id) => document.getElementById(id);
const el = {
  docx: $('docx-input'),
  dropZone: $('drop-zone'),
  docxReport: $('docx-report'),
  modes: [...document.querySelectorAll('input[name="export-mode"]')],
  titleLabel: $('title-label'),
  quizSettings: $('quiz-settings'),
  bankNote: $('bank-note'),
  stepsQuiz: $('steps-quiz'),
  stepsBank: $('steps-bank'),
  paste: $('paste-area'),
  file: $('file-input'),
  parseBtn: $('parse-btn'),
  exampleBtn: $('example-btn'),
  source: $('source-status'),
  images: $('image-input'),
  imageList: $('image-list'),
  clearImages: $('clear-images'),
  target: $('target'),
  title: $('default-title'),
  points: $('default-points'),
  attempts: $('allowed-attempts'),
  calculator: $('calculator'),
  shuffle: $('shuffle-answers'),
  shuffleQuestions: $('shuffle-questions'),
  partialCredit: $('partial-credit'),
  showCorrect: $('show-correct'),
  description: $('description'),
  summary: $('summary'),
  issues: $('issues'),
  preview: $('question-preview'),
  generateBtn: $('generate-btn'),
  download: $('download-status'),
  experimentalNote: $('experimental-note'),
};

const state = {
  rows: [],
  rowOffset: 2,
  sourceWarnings: [],
  banks: [],
  errors: [],
  images: new Map(), // imageKey -> { name, data: Uint8Array, url }
  // Set when the rows came from a Word document: { fileName, findings, warnings, excluded, sources, stats }
  docx: null,
  editing: null, // row number of the item open in the editor
  edited: new Set(), // row numbers changed on the page
  lastErrors: [],
};

const rowLabel = () => (state.docx ? 'Item' : 'Row');

function readOptions() {
  const attempts = Number(el.attempts.value);
  return {
    mode: el.modes.find((m) => m.checked)?.value || 'quiz',
    target: el.target.value,
    defaultTitle: el.title.value.trim() || 'Question Bank',
    defaultPoints: el.points.value === '' ? 1 : Number(el.points.value),
    settings: {
      allowedAttempts: Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : -1,
      calculator: el.calculator.value,
      shuffleAnswers: el.shuffle.checked,
      shuffleQuestions: el.shuffleQuestions.checked,
      partialCredit: el.partialCredit.checked,
      showCorrectAnswers: el.showCorrect.checked,
      description: el.description.value,
    },
  };
}

// ---------- Input ----------

function rowsFromCsv(text) {
  const result = Papa.parse(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const warnings = [];
  result.errors.forEach((e) => {
    const row = Number.isInteger(e.row) ? e.row + 2 : '?';
    if (e.code === 'TooFewFields') return; // trailing empty cells trimmed by the editor: harmless
    if (e.code === 'TooManyFields') throw new Error(`Row ${row} has more cells than the header row. Check for an unquoted comma in the text.`);
    warnings.push(`Row ${row}: ${e.message}`);
  });
  return { rows: result.data, rowOffset: 2, warnings };
}

function rowsFromJson(text) {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : Array.isArray(data.questions) ? data.questions : [data];
  return { rows, rowOffset: 1, warnings: [] };
}

function rowsFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Nothing to read. Paste rows with a header line, or choose a file.');
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return rowsFromJson(trimmed);
  return rowsFromCsv(trimmed);
}

async function rowsFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.ods')) {
    const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === 'questions') || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    return { rows, rowOffset: 2, warnings: [], sheet: sheetName };
  }
  return rowsFromText(await file.text());
}

function load(result, label, { keepDocx = false } = {}) {
  if (!keepDocx) { state.docx = null; renderDocxReport(); }
  state.editing = null;
  state.edited = new Set();
  state.rows = result.rows;
  state.rowOffset = result.rowOffset;
  state.sourceWarnings = result.warnings || [];
  el.source.className = 'status ok';
  el.source.textContent = `${label}: ${result.rows.length} row(s) read${result.sheet ? ` from sheet "${result.sheet}"` : ''}.`;
  refresh();
}

function fail(err) {
  console.error(err);
  state.rows = [];
  el.source.className = 'status error';
  el.source.textContent = `Couldn't read input: ${err.message}`;
  refresh();
}

// ---------- Word document import ----------

async function importDocx(file) {
  el.docxReport.hidden = false;
  el.docxReport.innerHTML = `<p>Reading ${esc(file.name)}…</p>`;
  try {
    if (typeof mammoth === 'undefined') throw new Error('The Word converter (mammoth) did not load. Check your internet connection and reload the page.');
    const extracted = await extractDocx(await file.arrayBuffer(), { mammoth, JSZip });
    const result = convertDocument(extracted.html, { parseHtml: (h) => new DOMParser().parseFromString(h, 'text/html'), fileName: file.name });
    state.docx = {
      fileName: file.name,
      findings: result.findings.map((f, i) => ({ ...f, key: i })),
      warnings: extracted.warnings.map((w, i) => ({ ...w, key: `w${i}` })),
      excluded: result.excluded,
      sources: result.sources,
      stats: result.stats,
      imageCount: extracted.images.length,
    };
    for (const img of extracted.images) {
      const key = imageKey(img.name);
      const prev = state.images.get(key);
      if (prev) URL.revokeObjectURL(prev.url);
      state.images.set(key, { name: img.name, data: img.data, url: URL.createObjectURL(new Blob([img.data], { type: img.contentType })) });
    }
    renderImageList();
    if (result.title) el.title.value = result.title;
    el.description.value = result.description;
    load({ rows: result.rows, rowOffset: 1, warnings: [] }, file.name, { keepDocx: true });
    renderDocxReport();
  } catch (err) {
    console.error(err);
    state.docx = null;
    el.docxReport.innerHTML = `<p class="status error">Couldn't import ${esc(file.name)}: ${esc(err.message)}</p>`;
  }
}

// Import problems that still need a decision (errors that weren't fixed or dismissed)
const openDocxErrors = () => (state.docx ? [...state.docx.warnings, ...state.docx.findings].filter((f) => f.severity === 'error' && !f.done) : []);

function renderDocxReport() {
  const d = state.docx;
  if (!d) { el.docxReport.hidden = true; el.docxReport.innerHTML = ''; return; }
  el.docxReport.hidden = false;
  const open = [...d.warnings, ...d.findings].filter((f) => !f.done);
  const order = { error: 0, warning: 1, info: 2 };
  open.sort((a, b) => order[a.severity] - order[b.severity] || (a.item ?? 0) - (b.item ?? 0));
  const line = (f) => `<li class="${f.severity}">
      <span class="msg">${f.item ? `<strong>Item ${f.item}</strong>: ` : ''}${esc(f.message)}</span>
      ${f.fix ? `<button type="button" data-fix="${f.key}">${esc(f.fix.label)}</button>` : ''}
      ${f.severity !== 'info' ? `<button type="button" data-dismiss="${f.key}">Dismiss</button>` : ''}
    </li>`;
  const counts = ['error', 'warning', 'info'].map((s) => [s, open.filter((f) => f.severity === s).length]);
  el.docxReport.innerHTML = `
    <h3>Imported from ${esc(d.fileName)}</h3>
    <p class="stats">${d.stats.questions} questions, ${d.stats.stimuli} directions groups, ${d.stats.text} text blocks, ${d.imageCount} images. Check them in <strong>3) Review</strong> below; each item shows the document text it came from.</p>
    ${open.length ? `<p>${counts.filter(([, n]) => n).map(([s, n]) => `${n} ${s === 'error' ? 'problem(s) to fix or dismiss' : s === 'warning' ? 'thing(s) to check' : 'note(s)'}`).join(' · ')}</p>
    <ul class="findings">${open.map(line).join('')}</ul>` : '<p class="status ok">Nothing to check from the import.</p>'}
    ${d.excluded.length ? `<details><summary>Left out of the quiz (${d.excluded.length})</summary><ul>${d.excluded.map((e) => `<li><strong>${esc(e.reason)}</strong>${e.lines > 1 ? ` (${e.lines} paragraphs)` : ''}: ${esc(e.preview)}${e.preview.length >= 240 ? '…' : ''}</li>`).join('')}</ul></details>` : ''}
    <div class="actions">
      <button type="button" class="btn secondary" data-action="xlsx">Download as spreadsheet (.xlsx)</button>
    </div>
    <p class="hint">Fix small things with <strong>Edit</strong> in step 2. For many changes, fix the document and upload it again, or download the spreadsheet, edit it, and upload it under “Other ways to add questions”.</p>`;
}

el.docxReport.addEventListener('click', (e) => {
  const d = state.docx;
  if (!d) return;
  const all = [...d.warnings, ...d.findings];
  const fixKey = e.target.dataset.fix;
  const dismissKey = e.target.dataset.dismiss;
  if (fixKey !== undefined) {
    const f = all.find((x) => String(x.key) === fixKey);
    const row = state.rows[f.item - 1];
    if (row && f.fix) row[f.fix.field] = f.fix.value;
    f.done = true;
  } else if (dismissKey !== undefined) {
    all.find((x) => String(x.key) === dismissKey).done = true;
  } else if (e.target.dataset.action === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(state.rows, { header: COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');
    XLSX.writeFile(wb, `${slugify(el.title.value || d.fileName.replace(/\.docx$/i, ''))}-questions.xlsx`);
    return;
  } else return;
  renderDocxReport();
  refresh();
});

async function addImages(files) {
  for (const file of files) {
    const key = imageKey(file.name);
    const prev = state.images.get(key);
    if (prev) URL.revokeObjectURL(prev.url);
    state.images.set(key, { name: file.name, data: new Uint8Array(await file.arrayBuffer()), url: URL.createObjectURL(file) });
  }
  renderImageList();
  refresh();
}

function renderImageList() {
  const imgs = [...state.images.values()];
  el.clearImages.hidden = !imgs.length;
  el.imageList.innerHTML = imgs.length
    ? imgs.map((i) => `<li><img src="${i.url}" alt=""><span>${esc(i.name)}</span></li>`).join('')
    : '';
}

// ---------- Validation + preview ----------

function refresh() {
  const opts = readOptions();
  el.experimentalNote.hidden = opts.target !== 'qti21';
  el.download.textContent = '';
  const bank = opts.mode === 'bank';
  el.quizSettings.hidden = bank;
  el.bankNote.hidden = !bank;
  el.stepsQuiz.hidden = bank;
  el.stepsBank.hidden = !bank;
  el.titleLabel.textContent = bank ? 'Question bank title' : 'Quiz title';
  el.generateBtn.textContent = bank ? 'Download question bank (.zip)' : 'Download New Quiz (.zip)';
  el.modes.forEach((m) => m.closest('.mode-card').classList.toggle('selected', m.checked));

  const questions = parseRows(state.rows, { defaultPoints: opts.defaultPoints, rowOffset: state.rowOffset });
  const { errors, warnings } = validateQuestions(questions, {
    target: opts.target === 'qti21' ? 'qti21' : 'canvas',
    images: new Set(state.images.keys()),
  });
  state.banks = groupIntoBanks(questions, opts.defaultTitle);
  state.errors = errors;

  const importErrors = openDocxErrors();
  state.lastErrors = errors;
  renderIssues(errors, [...state.sourceWarnings.map((m) => ({ message: m })), ...warnings]);
  renderSummary(questions, errors, importErrors, opts);
  renderPreview(state.banks, errors, opts);
  el.generateBtn.disabled = !questions.length || errors.length > 0 || importErrors.length > 0;
}

function issueLine(i) {
  const edit = i.row ? ` <button type="button" class="link-btn" data-edit="${i.row}">Edit ${rowLabel().toLowerCase()} ${i.row}</button>` : '';
  return `<li>${i.row ? `<strong>${rowLabel()} ${i.row}</strong>${i.id ? ` (${esc(i.id)})` : ''}: ` : ''}${esc(i.message)}${edit}</li>`;
}

function renderIssues(errors, warnings) {
  let html = '';
  if (errors.length) html += `<div class="issue-box error"><h3>${errors.length} problem(s) to fix before export</h3><ul>${errors.map(issueLine).join('')}</ul></div>`;
  if (warnings.length) html += `<div class="issue-box warn"><h3>${warnings.length} note(s)</h3><ul>${warnings.map(issueLine).join('')}</ul></div>`;
  el.issues.innerHTML = html;
}

function renderSummary(questions, errors, importErrors = [], opts = readOptions()) {
  if (!questions.length) {
    el.summary.className = 'status';
    el.summary.textContent = state.rows.length ? 'No questions found.' : 'Upload a document in step 1 to see its questions here.';
    return;
  }
  const scored = (qs) => qs.filter((q) => !['text_only', 'stimulus'].includes(q.type)).length;
  const pts = (qs) => fmtPts(qs.reduce((s, q) => s + questionPoints(q), 0));
  const bank = opts.mode === 'bank';
  const parts = state.banks.map((b) => {
    const qs = bank ? bankQuestions(b.questions) : b.questions;
    const text = b.questions.length - scored(b.questions) - (bank ? qs.length - scored(qs) : 0);
    return `“${esc(b.title)}”: ${scored(qs)} questions, ${pts(qs)} pts${bank ? (text ? ` (${text} text block(s) and directions without questions are left out)` : '') : `, ${b.questions.length - scored(b.questions)} text blocks and directions`}`;
  });
  const blocked = errors.length || importErrors.length;
  el.summary.className = blocked ? 'status error' : 'status ok';
  el.summary.innerHTML = `${bank ? 'Question bank' : 'New Quiz'}${state.banks.length > 1 ? `s (${state.banks.length})` : ''}: ${parts.join('; ')}.`
    + (errors.length ? ` Fix the ${errors.length} problem(s) below before downloading.` : '')
    + (importErrors.length ? ` ${importErrors.length} import problem(s) in step 1 still need fixing or dismissing.` : '')
    + (blocked ? '' : ' Ready to download in step 3.');
}

function answerDetails(q, opts) {
  const mark = (ok) => (ok ? '<span class="tick" aria-label="correct">✓</span>' : '<span class="tick off" aria-hidden="true">·</span>');
  switch (q.type) {
    case 'multiple_choice':
    case 'multiple_answer':
    case 'true_false':
    case 'ordering':
    case 'categorization': {
      const correct = new Set(q.correct);
      const extra = (c) => {
        if (q.type === 'ordering') { const pos = q.orderedIds.indexOf(c.id); return pos >= 0 ? ` <em>(#${pos + 1})</em>` : ''; }
        if (q.type === 'categorization') { const cat = q.categories.find((x) => x.choiceId === c.id); return cat ? ` → <em>${esc(cat.category)}</em>` : ''; }
        return '';
      };
      const showMark = !['ordering', 'categorization'].includes(q.type);
      const partial = q.type === 'multiple_answer'
        ? `<p class="detail">Scoring: ${(q.partialCredit === true || (q.partialCredit === null && opts.settings.partialCredit)) ? 'partial credit' : 'all or nothing'}</p>`
        : '';
      return `<ul class="choices">${q.choices.map((c) => `<li>${showMark ? mark(correct.has(c.id)) : ''}${esc(stripHtml(c.text))}${extra(c)}</li>`).join('')}</ul>${partial}`;
    }
    case 'short_answer':
      return `<p class="detail">Accepted answers: ${q.answers.map((a) => `<code>${esc(a)}</code>`).join(', ') || '<em>none</em>'}</p>`;
    case 'numeric': {
      const n = q.numeric;
      if ([n.answer, n.tolerance, n.min, n.max].some(Number.isNaN)) return '';
      if (n.answer === null && n.min === null && n.max === null) return '';
      const r = numericRule(n);
      return `<p class="detail">${r.kind === 'exact' ? `Answer: ${r.exact}${r.margin ? ` ± ${r.margin}` : ' (exact)'}` : `Any value from ${r.low} to ${r.high}`}</p>`;
    }
    case 'matching':
      return `<ul class="choices">${q.matchingPairs.map((p) => `<li>${esc(p.left)} → <strong>${esc(p.right)}</strong></li>`).join('')}</ul>${q.distractors.length ? `<p class="detail">Extra (wrong) options: ${q.distractors.map(esc).join(', ')}</p>` : ''}`;
    case 'essay':
      return '<p class="detail">Graded manually in SpeedGrader.</p>';
    case 'file_upload': {
      const limits = [q.upload.types.length ? `types: ${q.upload.types.map(esc).join(', ')}` : '', q.upload.maxFiles ? `max files: ${q.upload.maxFiles}` : ''].filter(Boolean).join(' · ');
      return `<p class="detail">Graded manually in SpeedGrader.${limits ? ` ${limits}` : ''}</p>`;
    }
    case 'text_only':
      return '<p class="detail">Text block. Not scored.</p>';
    case 'stimulus':
      return '<p class="detail">Stimulus. The questions below are shown alongside it.</p>';
    default:
      return '';
  }
}

function imagePreview(q) {
  if (!q.image) return '';
  const img = state.images.get(imageKey(q.image));
  return img
    ? `<img class="qimg" src="${img.url}" alt="${esc(q.imageAlt)}">`
    : `<p class="detail missing">Missing image: ${esc(q.image)}</p>`;
}

function sourceDetails(q) {
  const src = state.docx?.sources[q.rowNumber - 1];
  if (!src) return '';
  const notes = state.docx.findings.filter((f) => f.item === q.rowNumber && !f.done);
  return `<details class="source"><summary>From the document${notes.length ? ` · ${notes.length} import note(s)` : ''}</summary><pre>${esc(src)}</pre></details>`;
}

// Long text blocks and directions are clipped to a few lines so the questions stay easy to scan.
function textPreview(q) {
  const text = stripHtml(q.question);
  if (!text) return '<p class="qtext"><em>(no text)</em></p>';
  const long = ['text_only', 'stimulus'].includes(q.type) && text.length > 280;
  return long
    ? `<p class="qtext clamp">${esc(text)}</p><button type="button" class="link-btn" data-expand>Show more</button>`
    : `<p class="qtext">${esc(text)}</p>`;
}

function renderPreview(banks, errors, opts) {
  if (!banks.length) {
    el.preview.innerHTML = '<p class="empty">Upload a document in step 1 and its questions appear here.</p>';
    return;
  }
  const errorRows = new Set(errors.map((e) => e.row));
  let n = 0;
  el.preview.innerHTML = banks.map((bank) => {
    const stimulusIds = new Set(bank.questions.filter((q) => q.type === 'stimulus').map((q) => q.id));
    return `
    <h3 class="bank-title">${esc(bank.title)}</h3>
    ${bank.questions.map((q) => {
      const scored = questionPoints(q) > 0 || !['text_only', 'stimulus'].includes(q.type);
      if (scored) n += 1;
      const pts = scored ? `<span class="pts">${fmtPts(q.points)} pt${q.points === 1 ? '' : 's'}</span>` : '';
      const child = q.parentStimulus && stimulusIds.has(q.parentStimulus);
      const cls = ['preview-item', child ? 'child' : '', q.type === 'stimulus' ? 'stimulus' : '', errorRows.has(q.rowNumber) ? 'has-error' : ''].filter(Boolean).join(' ');
      const edited = state.edited.has(q.rowNumber) ? '<span class="badge edited">edited</span>' : '';
      const body = state.editing === q.rowNumber
        ? editorHtml(q.rowNumber, errors.filter((e) => e.row === q.rowNumber))
        : `${imagePreview(q)}
        ${textPreview(q)}
        ${answerDetails(q, opts)}
        ${sourceDetails(q)}`;
      return `<article class="${cls}" id="item-${q.rowNumber}">
        <header>${scored ? `<span class="num">${n}.</span>` : ''}<span class="badge">${esc(TYPE_LABELS[q.type] || q.rawType || 'unknown type')}</span>${pts}${edited}<span class="row-ref">${rowLabel().toLowerCase()} ${q.rowNumber}</span>${state.editing === q.rowNumber ? '' : `<button type="button" class="link-btn" data-edit="${q.rowNumber}">Edit</button>`}</header>
        ${body}
      </article>`;
    }).join('')}`;
  }).join('');
}

// ---------- Editing an item on the page ----------

const rowFor = (rowNumber) => state.rows[rowNumber - state.rowOffset];
const CHOICE_TYPES = ['multiple_choice', 'multiple_answer'];
const EDIT_TYPES = ['multiple_choice', 'multiple_answer', 'true_false', 'short_answer', 'numeric', 'essay', 'file_upload', 'text_only', 'stimulus'];

function choiceEntries(row) {
  const correct = new Set(String(row.correct ?? '').split(/[;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  return Object.keys(row)
    .map((k) => /^choice_(\d+)$/i.exec(k))
    .filter((m) => m && String(row[m[0]] ?? '').trim() !== '')
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => ({ text: String(row[m[0]]), correct: correct.has(`choice_${m[1]}`) || correct.has(m[1]) }));
}

function editorHtml(rowNumber, errors) {
  const row = rowFor(rowNumber) || {};
  const type = normalizeType(row.type) || 'multiple_choice';
  const v = (k) => esc(row[k] ?? '');
  const field = (label, key, attrs = '', hint = '') => `<label>${label}<input type="text" data-field="${key}" value="${v(key)}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const area = (label, key, rows = 3, hint = '') => `<label class="wide">${label}<textarea data-field="${key}" rows="${rows}">${v(key)}</textarea>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const graded = !['essay', 'file_upload', 'text_only', 'stimulus'].includes(type);

  let answers = '';
  if (CHOICE_TYPES.includes(type)) {
    const choices = choiceEntries(row);
    while (choices.length < Math.max(4, choiceEntries(row).length + 2)) choices.push({ text: '', correct: false });
    answers = `<fieldset class="wide"><legend>Choices <span class="hint">(tick the correct one${type === 'multiple_answer' ? 's' : ''}; leave a box empty to remove a choice)</span></legend>
      ${choices.map((c, i) => `<div class="choice-row"><input type="checkbox" data-choice-correct="${i}" ${c.correct ? 'checked' : ''} aria-label="Choice ${i + 1} is correct"><input type="text" data-choice="${i}" value="${esc(c.text)}" placeholder="Choice ${i + 1}"></div>`).join('')}
    </fieldset>`;
  } else if (type === 'true_false') {
    const val = String(row.correct ?? '').toLowerCase();
    answers = `<label>Correct answer<select data-field="correct"><option value="">Choose…</option><option value="true" ${/^(t|true)$/.test(val) ? 'selected' : ''}>True</option><option value="false" ${/^(f|false)$/.test(val) ? 'selected' : ''}>False</option></select></label>`;
  } else if (type === 'short_answer') {
    answers = field('Accepted answers', 'correct', '', 'Separate several with ;');
  } else if (type === 'numeric') {
    answers = `<div class="wide numeric-fields">
      ${field('Exact answer', 'numeric_answer', 'inputmode="decimal"')}
      ${field('± margin', 'numeric_tolerance', 'inputmode="decimal"', '0 or blank = exact')}
      <span class="or-sep">or a range:</span>
      ${field('From', 'numeric_min', 'inputmode="decimal"')}
      ${field('To', 'numeric_max', 'inputmode="decimal"')}
    </div>`;
  } else if (type === 'file_upload') {
    answers = `${field('Allowed file types', 'upload_file_types', '', 'e.g. PDF;DOCX')}${field('Max files', 'upload_max_files', 'inputmode="numeric"')}`;
  }

  return `<form class="item-editor" data-row="${rowNumber}" id="editor-${rowNumber}">
    ${errors.length ? `<ul class="editor-errors">${errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul>` : ''}
    <div class="editor-grid">
      <label>Type<select data-field="type">${EDIT_TYPES.map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${esc(TYPE_LABELS[t])}</option>`).join('')}</select></label>
      ${['text_only', 'stimulus'].includes(type) ? '' : field('Points', 'points', 'inputmode="decimal"')}
      ${area(['text_only', 'stimulus'].includes(type) ? 'Text' : 'Question', 'question', 4, 'Plain text or HTML.')}
      ${answers}
      ${['text_only', 'stimulus'].includes(type) ? '' : area('Feedback (shown after answering)', 'feedback_general', 3)}
      ${graded ? `${area('Feedback when correct', 'feedback_correct', 2)}${area('Feedback when wrong', 'feedback_incorrect', 2)}` : ''}
    </div>
    <div class="actions">
      <button type="submit" class="btn">Save</button>
      <button type="button" class="btn secondary" data-cancel>Cancel</button>
    </div>
  </form>`;
}

function readEditor(form, row) {
  form.querySelectorAll('[data-field]').forEach((input) => {
    const value = input.value.trim();
    if (value === '') delete row[input.dataset.field];
    else row[input.dataset.field] = value;
  });
  const texts = [...form.querySelectorAll('[data-choice]')];
  if (texts.length) {
    Object.keys(row).filter((k) => /^choice_\d+$/i.test(k)).forEach((k) => delete row[k]);
    const correct = [];
    let n = 0;
    texts.forEach((input) => {
      const text = input.value.trim();
      if (!text) return;
      n += 1;
      row[`choice_${n}`] = text;
      if (form.querySelector(`[data-choice-correct="${input.dataset.choice}"]`).checked) correct.push(`choice_${n}`);
    });
    row.correct = correct.join(';');
  }
}

function openEditor(rowNumber) {
  state.editing = rowNumber;
  refresh();
  document.getElementById(`item-${rowNumber}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  document.querySelector(`#editor-${rowNumber} [data-field="question"], #editor-${rowNumber} input`)?.focus({ preventScroll: true });
}

function onEditClick(e) {
  const expand = e.target.closest('[data-expand]');
  if (expand) {
    const p = expand.previousElementSibling;
    const open = p.classList.toggle('clamp');
    expand.textContent = open ? 'Show more' : 'Show less';
    return;
  }
  const btn = e.target.closest('[data-edit]');
  if (btn) { openEditor(Number(btn.dataset.edit)); return; }
  if (e.target.closest('[data-cancel]')) { state.editing = null; refresh(); }
}
el.issues.addEventListener('click', onEditClick);
el.preview.addEventListener('click', onEditClick);
el.preview.addEventListener('submit', (e) => {
  const form = e.target.closest('.item-editor');
  if (!form) return;
  e.preventDefault();
  const rowNumber = Number(form.dataset.row);
  readEditor(form, rowFor(rowNumber));
  state.edited.add(rowNumber);
  state.editing = null;
  refresh();
  const stillWrong = state.lastErrors.filter((x) => x.row === rowNumber);
  if (stillWrong.length) openEditor(rowNumber);
  else document.getElementById(`item-${rowNumber}`)?.scrollIntoView({ block: 'center' });
});
// Changing the type shows that type's fields, keeping what was typed so far.
el.preview.addEventListener('change', (e) => {
  if (e.target.dataset.field !== 'type') return;
  const form = e.target.closest('.item-editor');
  readEditor(form, rowFor(Number(form.dataset.row)));
  refresh();
});

// ---------- Export ----------

async function generate() {
  if (!state.banks.length || state.errors.length) return;
  const opts = readOptions();
  el.download.className = 'status';
  el.download.textContent = 'Building zip…';
  try {
    const pkg = opts.target === 'qti21'
      ? buildQti21Package(state.banks)
      : buildCanvasPackage(state.banks, opts.settings, { images: state.images, mode: opts.mode });
    const zip = new JSZip();
    pkg.files.forEach((f) => zip.file(f.path, f.content));
    (pkg.folders || []).forEach((f) => zip.folder(f));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const kind = opts.target === 'qti21' ? 'qti21-experimental' : opts.mode === 'bank' ? 'question-bank' : 'new-quiz';
    const base = state.banks.length === 1 ? slugify(state.banks[0].title) : `${state.banks.length}-${opts.mode === 'bank' ? 'banks' : 'quizzes'}`;
    const filename = `${kind}-${base}.zip`;
    saveAs(blob, filename);
    el.download.className = 'status ok';
    const unused = pkg.unusedImages?.length
      ? ` ${pkg.unusedImages.length} image(s) weren't needed${opts.mode === 'bank' ? ' (they belong to text blocks or the instructions, which a bank leaves out)' : ''}.`
      : '';
    el.download.textContent = `Downloaded ${filename}. Import it with the steps in 4.${unused}`;
  } catch (err) {
    console.error(err);
    el.download.className = 'status error';
    el.download.textContent = `Error: ${err.message}`;
  }
}

// ---------- Events ----------

el.docx.addEventListener('change', () => {
  const file = el.docx.files[0];
  if (file) importDocx(file).finally(() => { el.docx.value = ''; });
});
el.parseBtn.addEventListener('click', () => {
  try { load(rowsFromText(el.paste.value), 'Pasted text'); } catch (err) { fail(err); }
});
el.file.addEventListener('change', async () => {
  const file = el.file.files[0];
  if (!file) return;
  try { load(await rowsFromFile(file), file.name); } catch (err) { fail(err); }
});
el.exampleBtn.addEventListener('click', () => {
  el.paste.value = JSON.stringify(EXAMPLE_ROWS, null, 2);
  load({ rows: EXAMPLE_ROWS, rowOffset: 1, warnings: [] }, 'Example questions');
});
el.images.addEventListener('change', () => addImages([...el.images.files]).then(() => { el.images.value = ''; }));
el.clearImages.addEventListener('click', () => {
  state.images.forEach((i) => URL.revokeObjectURL(i.url));
  state.images.clear();
  renderImageList();
  refresh();
});
['target', 'title', 'points', 'attempts', 'calculator', 'shuffle', 'shuffleQuestions', 'partialCredit', 'showCorrect', 'description'].forEach((k) => {
  el[k].addEventListener('input', refresh);
  el[k].addEventListener('change', refresh);
});
el.modes.forEach((m) => m.addEventListener('change', refresh));
el.generateBtn.addEventListener('click', generate);

// Drag and drop a .docx onto the upload box
['dragenter', 'dragover'].forEach((type) => el.dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  el.dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((type) => el.dropZone.addEventListener(type, () => el.dropZone.classList.remove('dragging')));
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])][0];
  if (!file) return;
  if (!/\.docx$/i.test(file.name)) {
    el.docxReport.hidden = false;
    el.docxReport.innerHTML = `<p class="status error">${esc(file.name)} isn't a .docx file. In Google Docs use File → Download → Microsoft Word (.docx). For spreadsheets, open “Other ways to add questions”.</p>`;
    return;
  }
  importDocx(file);
});

renderImageList();
refresh();

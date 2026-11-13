// Turns spreadsheet/JSON rows into a normalized question model, and validates it.
import { CANVAS_TYPES, EXPERIMENTAL_TYPES, TYPE_ALIASES, MAX_CHOICES, UNSCORED_TYPES } from './schema.js';
import { splitList, splitTags, imageRefs, isRelativeSrc, imageKey } from './util.js';

const ALIAS_LOOKUP = new Map(
  Object.entries(TYPE_ALIASES).flatMap(([type, aliases]) => aliases.map((a) => [a, type])),
);

export function normalizeType(raw) {
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s\-/]+/g, '_');
  if (!key) return 'multiple_choice';
  return ALIAS_LOOKUP.get(key) || null;
}

function normalizeKey(key) {
  return String(key).trim().toLowerCase().replace(/\s+/g, '_');
}

function cell(row, key) {
  const v = row[key];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// '' -> null, '3.5' -> 3.5, 'abc' or '3,14' -> NaN (reported by validation rather than guessed)
function num(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return Number(s);
}

function isBlankRow(row) {
  return Object.values(row).every((v) => v === undefined || v === null || String(v).trim() === '');
}

function collectChoices(row) {
  return Object.keys(row)
    .map((k) => /^choice_(\d+)$/.exec(k))
    .filter(Boolean)
    .map((m) => ({ num: Number(m[1]), text: cell(row, m[0]) }))
    .filter((c) => c.text !== '')
    .sort((a, b) => a.num - b.num)
    .map((c) => ({ id: `C${c.num}`, num: c.num, text: c.text }));
}

// Resolves "choice_3", "3", "C" (letter) or the exact choice text to a choice id.
export function resolveChoice(token, choices) {
  const tok = String(token).trim();
  let m = /^choice_?(\d+)$/i.exec(tok) || /^(\d+)$/.exec(tok);
  if (m) return choices.find((c) => c.num === Number(m[1]))?.id || null;
  m = /^([a-z])$/i.exec(tok);
  if (m) {
    const n = m[1].toLowerCase().charCodeAt(0) - 96;
    return choices.find((c) => c.num === n)?.id || null;
  }
  const lower = tok.toLowerCase();
  return choices.find((c) => c.text.toLowerCase() === lower)?.id || null;
}

function resolveAll(tokens, choices) {
  const ids = [];
  const unresolved = [];
  tokens.forEach((t) => {
    const id = resolveChoice(t, choices);
    if (id) ids.push(id);
    else unresolved.push(t);
  });
  return { ids: [...new Set(ids)], unresolved };
}

const TF_TRUE = /^(true|t|yes|y)$/i;
const TF_FALSE = /^(false|f|no|n)$/i;

// '' -> null (use the page default), 'yes'/'true'/1 -> true, 'no'/'false'/0 -> false, else 'invalid'
function parseBool(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (TF_TRUE.test(s) || s === '1') return true;
  if (TF_FALSE.test(s) || s === '0') return false;
  return 'invalid';
}

function parseTrueFalse(tokens, userChoices) {
  let value = null;
  const tok = tokens[0];
  if (tok !== undefined) {
    if (TF_TRUE.test(tok)) value = true;
    else if (TF_FALSE.test(tok)) value = false;
    else {
      const id = resolveChoice(tok, userChoices);
      const text = userChoices.find((c) => c.id === id)?.text || '';
      if (TF_TRUE.test(text)) value = true;
      else if (TF_FALSE.test(text)) value = false;
    }
  }
  const choices = [
    { id: 'C1', num: 1, text: 'True' },
    { id: 'C2', num: 2, text: 'False' },
  ];
  return { choices, correct: value === null ? [] : [value ? 'C1' : 'C2'], tfValue: value };
}

export function parseRow(rawRow, { rowNumber, defaultPoints = 1 } = {}) {
  const row = Object.fromEntries(Object.entries(rawRow).map(([k, v]) => [normalizeKey(k), v]));
  const rawType = cell(row, 'type');
  const type = normalizeType(rawType);
  const id = cell(row, 'id') || `row${rowNumber}`;
  const pointsCell = cell(row, 'points');
  const points = pointsCell === '' ? (UNSCORED_TYPES.includes(type) ? 0 : Number(defaultPoints)) : num(pointsCell);

  const userChoices = collectChoices(row);
  const correctTokens = splitList(row.correct ?? row.answer);

  let choices = userChoices;
  let correct = [];
  let unresolved = [];
  let tfValue = null;
  if (type === 'true_false') {
    ({ choices, correct, tfValue } = parseTrueFalse(correctTokens, userChoices));
  } else if (type === 'multiple_choice' || type === 'multiple_answer') {
    ({ ids: correct, unresolved } = resolveAll(correctTokens, choices));
  }

  const matchingPairs = [];
  const incompletePairs = [];
  Object.keys(row)
    .map((k) => /^matching_left_(\d+)$/.exec(k))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
    .forEach((n) => {
      const left = cell(row, `matching_left_${n}`);
      const right = cell(row, `matching_right_${n}`);
      if (left && right) matchingPairs.push({ left, right });
      else if (left || right) incompletePairs.push(n);
    });
  Object.keys(row).forEach((k) => {
    const m = /^matching_right_(\d+)$/.exec(k);
    if (m && cell(row, k) && !(`matching_left_${m[1]}` in row)) incompletePairs.push(Number(m[1]));
  });

  const order = resolveAll(splitList(row.correct_order), choices);
  const categories = choices
    .map((c) => (cell(row, `category_${c.num}`) ? { choiceId: c.id, category: cell(row, `category_${c.num}`) } : null))
    .filter(Boolean);
  const hotspots = Object.keys(row)
    .filter((k) => /^hotspot_coords_\d+$/.test(k) && cell(row, k))
    .map((k) => cell(row, k).split(',').map((n) => Number(n.trim())))
    .filter((c) => c.length === 4 && c.every(Number.isFinite));

  return {
    rowNumber,
    id,
    rawType,
    type,
    title: cell(row, 'title') || id,
    question: cell(row, 'question'),
    image: cell(row, 'image'),
    imageAlt: cell(row, 'image_alt'),
    parentStimulus: cell(row, 'parent_stimulus'),
    partialCredit: parseBool(row.partial_credit),
    upload: {
      types: splitTags(row.upload_file_types).map((t) => t.replace(/^\./, '').toUpperCase()),
      maxFiles: num(row.upload_max_files),
    },
    bankName: cell(row, 'bank_name'),
    points,
    feedback: {
      general: cell(row, 'feedback_general'),
      correct: cell(row, 'feedback_correct'),
      incorrect: cell(row, 'feedback_incorrect'),
    },
    tags: splitTags(row.tags),
    userChoices,
    choices,
    correctTokens,
    correct,
    unresolved,
    tfValue,
    answers: type === 'short_answer' ? correctTokens : [],
    numeric: {
      answer: num(row.numeric_answer),
      tolerance: num(row.numeric_tolerance),
      min: num(row.numeric_min),
      max: num(row.numeric_max),
    },
    matchingPairs,
    incompletePairs: [...new Set(incompletePairs)],
    distractors: splitList(row.matching_distractors),
    orderedIds: order.ids,
    orderUnresolved: order.unresolved,
    categories,
    imageFile: cell(row, 'image_file'),
    hotspots,
    perRowShuffle: cell(row, 'shuffle') !== '',
  };
}

// rowOffset: spreadsheet row number of the first data row (2 for CSV/XLSX with a header, 1 for JSON).
export function parseRows(rows, { defaultPoints = 1, rowOffset = 2 } = {}) {
  const out = [];
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object' || isBlankRow(row)) return;
    out.push(parseRow(row, { rowNumber: i + rowOffset, defaultPoints }));
  });
  return out;
}

const CHOICE_TYPES = ['multiple_choice', 'multiple_answer'];
const MANUAL_TYPES = ['essay', 'file_upload'];

// images: optional Set of available image file names (lower-cased). When given, every image a row
// references (the `image` column or <img src="..."> in its HTML) must be in it.
export function validateQuestions(questions, { target = 'canvas', images } = {}) {
  const errors = [];
  const warnings = [];
  const err = (q, message) => errors.push({ row: q.rowNumber, id: q.id, message });
  const warn = (q, message) => warnings.push({ row: q.rowNumber, id: q.id, message });

  const seen = new Map();
  const byId = new Map();
  questions.forEach((q) => { if (!byId.has(q.id)) byId.set(q.id, q); });
  const childCount = new Map();

  questions.forEach((q) => {
    if (seen.has(q.id)) err(q, `duplicate id "${q.id}" (also used on row ${seen.get(q.id)})`);
    else seen.set(q.id, q.rowNumber);

    if (!q.type) {
      err(q, `unknown type "${q.rawType}". Use one of: ${Object.keys(CANVAS_TYPES).join(', ')}`);
      return;
    }
    if (EXPERIMENTAL_TYPES.includes(q.type) && target === 'canvas') {
      err(q, `${q.type} questions can't be imported through QTI yet. Build them directly in New Quizzes, or switch to the experimental QTI 2.1 export`);
      return;
    }
    if (!q.question) err(q, q.type === 'stimulus' ? 'stimulus text (question column) is empty' : 'question text is empty');
    if (q.points === null || !Number.isFinite(q.points)) err(q, 'points must be a number');
    else if (q.points < 0) err(q, 'points cannot be negative');

    // Stimulus links
    if (q.parentStimulus) {
      const parent = byId.get(q.parentStimulus);
      if (UNSCORED_TYPES.includes(q.type)) err(q, `${q.type} items can't belong to a stimulus`);
      else if (!parent) err(q, `parent_stimulus "${q.parentStimulus}" doesn't match any row id`);
      else if (parent.type !== 'stimulus') err(q, `parent_stimulus "${q.parentStimulus}" (row ${parent.rowNumber}) is a ${parent.type || 'invalid'} row, not a stimulus`);
      else if ((parent.bankName || '') !== (q.bankName || '')) err(q, `parent_stimulus "${q.parentStimulus}" is in a different bank_name`);
      else childCount.set(parent.id, (childCount.get(parent.id) || 0) + 1);
    }

    if (CHOICE_TYPES.includes(q.type)) {
      if (q.choices.length < 2) err(q, 'needs at least 2 choices (choice_1, choice_2, ...)');
      if (q.unresolved.length) err(q, `correct value(s) ${q.unresolved.map((t) => `"${t}"`).join(', ')} don't match a filled-in choice`);
      if (!q.correct.length && !q.unresolved.length) err(q, 'correct is empty. Use e.g. choice_2');
      if (q.type === 'multiple_choice' && q.correct.length > 1) err(q, 'multiple_choice can have only one correct answer. Use type multiple_answer for more');
      const gaps = q.choices.some((c, i) => c.num !== i + 1);
      if (gaps) warn(q, 'choice columns have gaps; choices will be renumbered in order');
      if (q.choices.some((c) => c.num > MAX_CHOICES)) warn(q, `uses more than ${MAX_CHOICES} choices; that's fine, but the template only has ${MAX_CHOICES} columns`);
    }
    if (q.partialCredit === 'invalid') err(q, 'partial_credit must be true or false (or blank for the page default)');
    else if (q.partialCredit !== null && q.type !== 'multiple_answer') warn(q, 'partial_credit only applies to multiple_answer questions and will be ignored');

    if (q.type === 'true_false' && q.tfValue === null) err(q, 'correct must be true or false');
    if (q.type === 'short_answer' && !q.answers.length) err(q, 'correct must list at least one accepted answer (separate several with ;)');

    if (q.type === 'numeric') {
      const { answer, tolerance, min, max } = q.numeric;
      const bad = Object.entries(q.numeric).filter(([, v]) => Number.isNaN(v)).map(([k]) => `numeric_${k}`);
      if (bad.length) err(q, `${bad.join(', ')} must be a number`);
      else if (answer === null && min === null && max === null) err(q, 'has no answer. Click Edit and enter an exact answer (with an optional ± margin) or a range. In a spreadsheet: numeric_answer, or numeric_min and numeric_max');
      else if (answer !== null && (min !== null || max !== null)) err(q, 'use either numeric_answer or numeric_min/numeric_max, not both');
      else if (min !== null && max !== null && max < min) err(q, 'numeric_max is less than numeric_min');
      if (tolerance !== null && !Number.isNaN(tolerance) && tolerance < 0) err(q, 'numeric_tolerance cannot be negative');
      if (tolerance !== null && answer === null) warn(q, 'numeric_tolerance only applies with numeric_answer and will be ignored');
    }

    if (q.type === 'matching') {
      if (!q.matchingPairs.length) err(q, 'needs at least one matching_left_n / matching_right_n pair');
      if (q.incompletePairs.length) err(q, `matching pair(s) ${q.incompletePairs.join(', ')} have only one side filled in`);
      const lefts = q.matchingPairs.map((p) => p.left.toLowerCase());
      if (new Set(lefts).size !== lefts.length) err(q, 'two matching_left values are identical');
    }

    if (q.upload.maxFiles !== null && (!Number.isInteger(q.upload.maxFiles) || q.upload.maxFiles < 1)) err(q, 'upload_max_files must be a whole number of 1 or more');
    if (q.type !== 'file_upload' && (q.upload.types.length || q.upload.maxFiles !== null)) warn(q, 'upload_file_types / upload_max_files only apply to file_upload questions and will be ignored');

    if (q.type === 'ordering') {
      if (q.choices.length < 2) err(q, 'needs at least 2 choices');
      if (q.orderUnresolved.length) err(q, `correct_order value(s) ${q.orderUnresolved.join(', ')} don't match a choice`);
      if (q.orderedIds.length !== q.choices.length) err(q, 'correct_order must list every choice exactly once');
    }
    if (q.type === 'categorization') {
      if (q.choices.length < 2) err(q, 'needs at least 2 choices');
      if (q.categories.length !== q.choices.length) err(q, 'every choice_n needs a category_n');
    }
    if (q.type === 'hotspot' && !q.hotspots.length) err(q, 'needs hotspot_coords_n (x1,y1,x2,y2)');

    // Images
    const refs = [q.image, ...imageRefs(q.question), ...q.choices.flatMap((c) => imageRefs(c.text)),
      ...Object.values(q.feedback).flatMap((t) => imageRefs(t))].filter((s) => s && isRelativeSrc(s));
    if (refs.length && target === 'qti21') warn(q, 'images are not included in the experimental QTI 2.1 export');
    else if (images) {
      const missing = [...new Set(refs)].filter((name) => !images.has(imageKey(name)));
      if (missing.length) err(q, `image file(s) not added: ${missing.join(', ')}. Add them under "Images" (names must match)`);
    }
    if (q.imageAlt && !q.image) warn(q, 'image_alt is set but image is empty');
    if (q.image && !q.imageAlt) warn(q, `image "${q.image}" has no image_alt text; screen-reader users will hear nothing for it`);

    // Non-blocking hints
    if ((MANUAL_TYPES.includes(q.type) || UNSCORED_TYPES.includes(q.type)) && (q.feedback.correct || q.feedback.incorrect)) {
      warn(q, `${q.type} items only show feedback_general; feedback_correct/feedback_incorrect will be ignored`);
    }
    if (UNSCORED_TYPES.includes(q.type) && q.points) warn(q, `${q.type} items are worth 0 points; points will be ignored`);
    if (q.type === 'true_false' && q.userChoices.length) warn(q, 'true_false always uses the choices True and False; choice_n columns are ignored');
    if (!CHOICE_TYPES.includes(q.type) && !['true_false', 'ordering', 'categorization'].includes(q.type) && q.userChoices.length) {
      warn(q, `choice_n columns are ignored for ${q.type} questions`);
    }
    if (q.perRowShuffle && target === 'canvas') warn(q, 'per-question shuffle is not supported; use the "Shuffle answers" quiz setting');
  });

  questions.filter((q) => q.type === 'stimulus' && !childCount.get(q.id)).forEach((q) => {
    warn(q, `no questions name this stimulus in parent_stimulus. Use type text_only for standalone text, or set parent_stimulus = ${q.id} on its questions`);
  });

  return { errors, warnings };
}

// Groups questions into quizzes by bank_name (falling back to the default title), and moves each
// stimulus's questions directly after it, the order Canvas uses in its own exports.
export function groupIntoBanks(questions, defaultTitle = 'Question Bank') {
  const banks = new Map();
  questions.forEach((q) => {
    const title = q.bankName || defaultTitle;
    if (!banks.has(title)) banks.set(title, []);
    banks.get(title).push(q);
  });
  return [...banks.entries()].map(([title, qs]) => {
    const stimuli = new Set(qs.filter((q) => q.type === 'stimulus').map((q) => q.id));
    const isChild = (q) => q.parentStimulus && stimuli.has(q.parentStimulus) && !UNSCORED_TYPES.includes(q.type);
    const ordered = [];
    qs.forEach((q) => {
      if (isChild(q)) return;
      ordered.push(q);
      if (q.type === 'stimulus') ordered.push(...qs.filter((c) => isChild(c) && c.parentStimulus === q.id));
    });
    return { title, questions: ordered };
  });
}

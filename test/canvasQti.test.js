import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import JSZip from 'jszip';
import { parseRows, groupIntoBanks } from '../src/parse.js';
import { buildCanvasPackage, canvasItemXml } from '../src/canvasQti.js';
import { buildQti21Package } from '../src/qti21.js';
import { EXAMPLE_ROWS, CANVAS_TYPES } from '../src/schema.js';

// Real Canvas exports used as references. The New Quizzes one is course material and isn't part of
// the repo, so its test is skipped when the file isn't there.
const root = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const CLASSIC_EXPORT = root('dev-2024summer-jordan77-quiz-export.zip');
const NEW_QUIZZES_EXPORT = root(process.env.NQ_EXPORT || '7bf013b37d645ff5b4432b4db47ccac41e9b050d016ccdf2524debb9ac632dfe.zip');

const ordered = new XMLParser({ preserveOrder: true, ignoreAttributes: false });
const plain = new XMLParser({ ignoreAttributes: false, isArray: (name) => ['item', 'qtimetadatafield', 'respcondition', 'response_label', 'response_lid', 'resource', 'varequal', 'itemfeedback'].includes(name) });

const QUIZ = 'gquiz0000000000000000000000000001';
const build = (rows, settings, opts = {}) => buildCanvasPackage(groupIntoBanks(parseRows(rows, { rowOffset: 1 }), 'Test Bank'), settings, { idents: [QUIZ], ...opts });
const itemsOf = (pkg) => plain.parse(pkg.files.find((f) => f.path === `${QUIZ}/${QUIZ}.xml`).content).questestinterop.assessment.section.item;
const itemFor = (row, settings) => {
  const [q] = parseRows([row]);
  return plain.parse(canvasItemXml(q, { ident: 'gitem', answerBase: 1000, settings })).item[0];
};
const meta = (item) => Object.fromEntries(item.itemmetadata.qtimetadata.qtimetadatafield.map((f) => [f.fieldlabel, String(f.fieldentry ?? '')]));

test('every generated file is well-formed XML and the manifest points at real files', () => {
  const pkg = build(EXAMPLE_ROWS);
  pkg.files.forEach((f) => assert.equal(XMLValidator.validate(f.content), true, `${f.path} is not well-formed`));
  const paths = new Set(pkg.files.map((f) => f.path));
  const manifest = plain.parse(pkg.files[0].content).manifest;
  manifest.resources.resource.forEach((r) => assert.ok(paths.has(r.file['@_href']), `manifest references missing ${r.file['@_href']}`));
});

test('every item declares a Canvas question_type, points_possible and calculator_type', () => {
  const pkg = build(EXAMPLE_ROWS);
  const items = itemsOf(pkg);
  assert.equal(items.length, EXAMPLE_ROWS.length);
  items.forEach((item, i) => {
    const m = meta(item);
    assert.equal(m.question_type, CANVAS_TYPES[EXAMPLE_ROWS[i].type]);
    assert.match(m.points_possible, /^\d+(\.\d+)?$/);
    assert.equal(m.calculator_type, 'none');
    assert.match(m.assessment_question_identifierref, /^g[0-9a-f]{32}$/);
  });
  const quiz = plain.parse(pkg.files.find((f) => f.path.endsWith('assessment_meta.xml')).content).quiz;
  assert.equal(Number(quiz.points_possible), 24); // sum of example points; text and stimulus count as 0
});

test('multiple choice: 100-point scale, correct answer ident, feedback blocks', () => {
  const item = itemFor({ type: 'mc', question: 'Q', points: 4, choice_1: 'a', choice_2: 'b', correct: 'b', feedback_correct: 'yes', feedback_incorrect: 'no' });
  assert.equal(Number(meta(item).points_possible), 4);
  const [scoring] = item.resprocessing.respcondition;
  assert.equal(scoring.setvar['#text'], 100);
  assert.equal(scoring.conditionvar.varequal[0]['#text'], 1002);
  assert.deepEqual(item.itemfeedback.map((f) => f['@_ident']), ['correct_fb', 'general_incorrect_fb']);
});

test('multiple answers: one rule, correct choices first then wrong ones negated; partial credit flag', () => {
  const row = { type: 'ma', question: 'Q', choice_1: 'a', choice_2: 'b', choice_3: 'c', correct: '1;3' };
  const item = itemFor(row);
  assert.equal(item.presentation.response_lid[0]['@_rcardinality'], 'Multiple');
  const conds = item.resprocessing.respcondition;
  assert.equal(conds.length, 1);
  assert.deepEqual(conds[0].conditionvar.and.varequal.map((v) => v['#text']), [1001, 1003]);
  assert.equal(conds[0].conditionvar.and.not.varequal[0]['#text'], 1002);
  assert.equal(meta(item).scoring_algorithm, undefined);
  assert.equal(meta(itemFor({ ...row, partial_credit: 'yes' })).scoring_algorithm, 'PartialScore');
  assert.equal(meta(itemFor(row, { partialCredit: true, calculator: 'none' })).scoring_algorithm, 'PartialScore');
  assert.equal(meta(itemFor({ ...row, partial_credit: 'no' }, { partialCredit: true })).scoring_algorithm, undefined);
});

test('numeric exact answer: margin attributes plus or/and bounds', () => {
  const item = itemFor({ type: 'numeric', question: 'Q', numeric_answer: '3.14', numeric_tolerance: '0.005' });
  const cv = item.resprocessing.respcondition[0].conditionvar;
  assert.equal(cv.or.varequal[0]['#text'], 3.14);
  assert.equal(cv.or.varequal[0]['@_margintype'], 'absolute');
  assert.equal(cv.or.varequal[0]['@_margin'], '0.005');
  assert.equal(cv.or.and.vargte['#text'], 3.135);
  assert.equal(cv.or.and.varlte['#text'], 3.145);
  assert.equal(item.presentation.response_str.render_fib['@_fibtype'], 'Decimal');
});

test('matching: one response_lid per left item with all options, shares add to ~100, distractors listed', () => {
  const item = itemFor({ type: 'matching', question: 'Q', matching_left_1: 'France', matching_right_1: 'Paris', matching_left_2: 'Japan', matching_right_2: 'Tokyo', matching_distractors: 'Rome' });
  const lids = item.presentation.response_lid;
  assert.equal(lids.length, 2);
  lids.forEach((lid) => assert.equal(lid.render_choice.response_label.length, 3));
  assert.ok(item.resprocessing.respcondition.every((r) => r.setvar['@_action'] === 'Add' && r.setvar['#text'] === 50));
  assert.equal(meta(item).matching_answer_incorrect_matches, 'Rome');
});

test('short answer lists every accepted answer', () => {
  const item = itemFor({ type: 'short_answer', question: 'Q', correct: 'Na;sodium' });
  assert.deepEqual(item.resprocessing.respcondition[0].conditionvar.varequal.map((v) => v['#text']), ['Na', 'sodium']);
});

test('file upload carries allowed types and file count on <presentation>', () => {
  const item = itemFor({ type: 'file_upload', question: 'Q', upload_file_types: 'pdf, .docx', upload_max_files: '2' });
  assert.equal(item.presentation['@_allowed_types'], 'PDF,DOCX');
  assert.equal(item.presentation['@_files_count'], '2');
});

test('stimulus: children follow it and point at its ident; text blocks are passages', () => {
  const pkg = build([
    { id: 'q1', type: 'numeric', question: 'child placed early', parent_stimulus: 's1', numeric_answer: 1 },
    { id: 't1', type: 'text_only', question: 'Intro' },
    { id: 's1', type: 'stimulus', question: 'Case study' },
    { id: 'q2', type: 'mc', question: 'Other', choice_1: 'a', choice_2: 'b', correct: 1 },
  ]);
  const items = itemsOf(pkg);
  assert.deepEqual(items.map((i) => i['@_title']), ['t1', 's1', 'q1', 'q2']);
  const [text, stim, child, other] = items.map(meta);
  assert.equal(text.passage, 'true');
  assert.equal(stim.passage, 'false');
  assert.equal(stim.question_type, 'text_only_question');
  assert.equal(child.parent_stimulus_item_ident, items[1]['@_ident']);
  assert.equal(other.parent_stimulus_item_ident, undefined);
  assert.equal(items[1].presentation.material['@_orientation'], 'top');
});

test('images: packed into Uploaded Media, listed in the manifest, src rewritten', () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const images = new Map([
    ['graph 1.png', { name: 'Graph 1.png', data: png }],
    ['dot.png', { name: 'dot.png', data: png }],
    ['unused.png', { name: 'unused.png', data: png }],
  ]);
  const pkg = build([{ type: 'mc', question: 'Which curve?', image: 'Graph 1.png', image_alt: 'Cost curves', choice_1: '<img src="dot.png" alt="dot">', choice_2: 'none', correct: 1 }], {}, { images });
  const paths = pkg.files.map((f) => f.path);
  assert.ok(paths.includes('Uploaded Media/Graph_1.png'));
  assert.ok(paths.includes('Uploaded Media/dot.png'));
  assert.deepEqual(pkg.unusedImages, ['unused.png']);
  const manifest = plain.parse(pkg.files[0].content).manifest.resources.resource;
  assert.deepEqual(manifest.filter((r) => r['@_type'] === 'webcontent').map((r) => r['@_href']).sort(), ['Uploaded Media/Graph_1.png', 'Uploaded Media/dot.png']);
  const xml = pkg.files[1].content;
  assert.ok(xml.includes('src=&quot;$IMS-CC-FILEBASE$/Uploaded Media/Graph_1.png&quot; alt=&quot;Cost curves&quot;'));
  assert.ok(xml.includes('src=&quot;$IMS-CC-FILEBASE$/Uploaded Media/dot.png&quot;'));
});

test('text is HTML escaped exactly once; plain text is wrapped in <div><p>', () => {
  const [q1, q2] = parseRows([
    { type: 'essay', question: 'Is 2 < 3?\nExplain.' },
    { type: 'essay', question: '<p><strong>Bold</strong> &amp; more</p>' },
  ]);
  const x1 = canvasItemXml(q1, { ident: 'a', answerBase: 1000 });
  const x2 = canvasItemXml(q2, { ident: 'b', answerBase: 2000 });
  assert.ok(x1.includes('&lt;div&gt;&lt;p&gt;Is 2 &amp;lt; 3?&lt;br&gt;Explain.&lt;/p&gt;&lt;/div&gt;'));
  assert.ok(x2.includes('&lt;p&gt;&lt;strong&gt;Bold&lt;/strong&gt; &amp;amp; more&lt;/p&gt;'));
});

test('quiz settings reach assessment_meta.xml', () => {
  const pkg = build(EXAMPLE_ROWS.slice(0, 1), { allowedAttempts: -1, shuffleAnswers: true, shuffleQuestions: true, calculator: 'scientific', showCorrectAnswers: true });
  const quiz = plain.parse(pkg.files[2].content).quiz;
  assert.equal(quiz.quiz_type, 'assignment');
  assert.equal(quiz.allowed_attempts, -1);
  assert.equal(quiz.shuffle_answers, true);
  assert.equal(quiz.shuffle_questions, true);
  assert.equal(quiz.calculator_type, 'scientific');
  assert.equal(quiz.display_item_correct_answer, true);
  assert.match(pkg.files[1].content, /<fieldentry>unlimited<\/fieldentry>/);
});

test('question-bank export: Canvas objectbank with only the questions and the stimuli they use', () => {
  const rows = [
    { id: 't1', type: 'text_only', question: 'Welcome' },
    { id: 's1', type: 'stimulus', question: 'Case study' },
    { id: 'q1', type: 'mc', parent_stimulus: 's1', question: 'Q1', choice_1: 'a', choice_2: 'b', correct: 1 },
    { id: 's2', type: 'stimulus', question: 'Unused directions' },
    { id: 'q2', type: 'numeric', question: 'Q2', numeric_answer: 4 },
  ];
  const pkg = build(rows, { description: 'Quiz instructions' }, { mode: 'bank' });
  assert.deepEqual(pkg.files.map((f) => f.path), ['imsmanifest.xml', `${QUIZ}/${QUIZ}.xml`]);
  pkg.files.forEach((f) => assert.equal(XMLValidator.validate(f.content), true, f.path));
  const doc = plain.parse(pkg.files[1].content).questestinterop;
  assert.equal(doc.assessment, undefined);
  assert.equal(doc.objectbank['@_ident'], QUIZ);
  assert.equal(doc.objectbank.qtimetadata.qtimetadatafield[0].fieldentry, 'Test Bank');
  const items = doc.objectbank.item;
  assert.deepEqual(items.map((i) => i['@_title']), ['s1', 'q1', 'q2']);
  assert.equal(meta(items[1]).parent_stimulus_item_ident, items[0]['@_ident']);
  assert.ok(!pkg.files[1].content.includes('Quiz instructions'));
  const manifest = plain.parse(pkg.files[0].content).manifest.resources.resource;
  assert.deepEqual(manifest.map((r) => [r['@_type'], r.file['@_href']]), [['imsqti_xmlv1p2', `${QUIZ}/${QUIZ}.xml`]]);
  assert.equal(pkg.quizzes[0].count, 3);
});

test('multiple banks become multiple quizzes in one manifest', () => {
  const banks = groupIntoBanks(parseRows([
    { bank_name: 'A', type: 'essay', question: '1' },
    { bank_name: 'B', type: 'essay', question: '2' },
  ]));
  const pkg = buildCanvasPackage(banks);
  assert.equal(pkg.files.length, 5);
  assert.equal(plain.parse(pkg.files[0].content).manifest.resources.resource.length, 4);
});

// ---- Golden comparisons against real Canvas exports ----

function find(nodes, pred) {
  for (const n of nodes) {
    if (pred(n)) return n;
    const tag = Object.keys(n).find((k) => k !== ':@');
    if (tag && Array.isArray(n[tag])) {
      const hit = find(n[tag], pred);
      if (hit) return hit;
    }
  }
  return null;
}
// Element tree with attribute names (not values); runs of same-tag siblings collapse to one.
const skeleton = (nodes) => {
  const out = [];
  nodes.filter((n) => !('#text' in n)).forEach((n) => {
    const tag = Object.keys(n).find((k) => k !== ':@');
    const attrs = Object.keys(n[':@'] || {}).sort();
    const node = { [tag]: { attrs, children: skeleton(n[tag]) } };
    const prev = out[out.length - 1];
    if (!prev || JSON.stringify(prev) !== JSON.stringify(node)) out.push(node);
  });
  return out;
};
const part = (item, tag) => skeleton(item.item.filter((c) => tag in c));
const metaLabels = (item) => {
  const labels = [];
  find(item.item, (n) => {
    if ('fieldlabel' in n) labels.push(n.fieldlabel[0]['#text']);
    return false;
  });
  return labels;
};
// { label: entry } from an ordered-parser <item>
const metaMap = (item) => {
  const map = {};
  find(item.item, (n) => {
    if ('qtimetadatafield' in n) {
      const label = n.qtimetadatafield.find((c) => 'fieldlabel' in c)?.fieldlabel[0]?.['#text'];
      const entry = n.qtimetadatafield.find((c) => 'fieldentry' in c)?.fieldentry[0]?.['#text'];
      map[label] = entry === undefined ? '' : String(entry);
    }
    return false;
  });
  return map;
};
const typeOf = (item) => metaMap(item).question_type;

async function itemsFromZip(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const qtiPath = Object.keys(zip.files).find((p) => /\/(g[0-9a-f]{32})\/\1\.xml$/.test(`/${p}`));
  const doc = ordered.parse(await zip.file(qtiPath).async('string'));
  const items = [];
  find(doc, (n) => { if ('item' in n) items.push(n); return false; });
  return items;
}
const ourItems = (rows) => {
  const doc = ordered.parse(build(rows).files[1].content);
  const items = [];
  find(doc, (n) => { if ('item' in n) items.push(n); return false; });
  return items;
};

test('essay and numeric range items match the structure of a real Canvas export', { skip: !existsSync(CLASSIC_EXPORT) && 'Canvas export zip not present' }, async () => {
  const theirs = await itemsFromZip(CLASSIC_EXPORT);
  const ours = ourItems([
    { type: 'essay', question: 'Essay test question' },
    { type: 'numeric', question: 'what is a number between 1-3', numeric_min: 1, numeric_max: 3 },
  ]);
  for (const [i, type] of [[0, 'essay_question'], [1, 'numerical_question']]) {
    const t = theirs.find((it) => typeOf(it) === type);
    for (const tag of ['presentation', 'resprocessing']) {
      assert.deepEqual(part(ours[i], tag), part(t, tag), `${type} <${tag}> differs from Canvas export`);
    }
  }
});

test('items match the structure and metadata of the New Quizzes export', { skip: !existsSync(NEW_QUIZZES_EXPORT) && 'New Quizzes export zip not present' }, async () => {
  const theirs = await itemsFromZip(NEW_QUIZZES_EXPORT);
  const ours = ourItems([
    { id: 'txt', type: 'text_only', question: 'Intro' },
    { id: 'stim', type: 'stimulus', question: 'Directions' },
    { id: 'mc', type: 'mc', parent_stimulus: 'stim', question: 'Q', choice_1: '<p>a</p>', choice_2: '<p>b</p>', correct: 2, feedback_general: 'Because' },
    { id: 'ma', type: 'ma', parent_stimulus: 'stim', question: 'Q', choice_1: '<p>a</p>', choice_2: '<p>b</p>', choice_3: '<p>c</p>', correct: '1;2', partial_credit: 'true', feedback_general: 'Because' },
    { id: 'num', type: 'numeric', parent_stimulus: 'stim', question: 'Q', numeric_answer: 108, numeric_tolerance: 0.01, feedback_general: 'Because' },
    { id: 'up', type: 'file_upload', parent_stimulus: 'stim', question: 'Q', upload_file_types: 'PDF', upload_max_files: 1, feedback_general: 'Because' },
  ]);
  const pick = (type, pred = () => true) => theirs.find((it) => typeOf(it) === type && pred(it));
  const hasLabel = (l) => (it) => metaLabels(it).includes(l);
  const passage = (v) => (it) => metaMap(it).passage === v;
  const pairs = [
    [ours[0], pick('text_only_question', passage('true')), 'text_only (passage)'],
    [ours[1], pick('text_only_question', passage('false')), 'stimulus'],
    [ours[2], pick('multiple_choice_question', hasLabel('parent_stimulus_item_ident')), 'multiple choice'],
    [ours[3], pick('multiple_answers_question', hasLabel('scoring_algorithm')), 'multiple answers'],
    [ours[4], pick('numerical_question', hasLabel('parent_stimulus_item_ident')), 'numerical'],
    [ours[5], pick('file_upload_question'), 'file upload'],
  ];
  for (const [mine, real, label] of pairs) {
    assert.ok(real, `export has no ${label} item`);
    assert.deepEqual(metaLabels(mine), metaLabels(real), `${label}: metadata fields differ`);
    for (const tag of ['presentation', 'resprocessing']) {
      assert.deepEqual(part(mine, tag), part(real, tag), `${label}: <${tag}> differs from the New Quizzes export`);
    }
  }
});

test('experimental QTI 2.1 output is well-formed', () => {
  const rows = [...EXAMPLE_ROWS, { type: 'ordering', question: 'Order', choice_1: 'a', choice_2: 'b', correct_order: '2;1' },
    { type: 'categorization', question: 'Cat', choice_1: 'Lion', choice_2: 'Shark', category_1: 'Mammal', category_2: 'Fish' }];
  const pkg = buildQti21Package(groupIntoBanks(parseRows(rows, { rowOffset: 1 })));
  pkg.files.forEach((f) => assert.equal(XMLValidator.validate(f.content), true, `${f.path} is not well-formed`));
});

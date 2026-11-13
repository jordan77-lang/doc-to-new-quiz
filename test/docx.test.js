import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { DOMParser } from 'linkedom';
import { XMLValidator } from 'fast-xml-parser';
import { makeDocx, LEMONADE_LAB, CONVENTION_VARIANTS } from './helpers/docx-fixture.js';
import { extractDocx } from '../src/docx/extract.js';
import { convertDocument } from '../src/docx/convert.js';
import { parseRows, validateQuestions, groupIntoBanks } from '../src/parse.js';
import { buildCanvasPackage } from '../src/canvasQti.js';
import { imageKey } from '../src/util.js';

const parseHtml = (h) => new DOMParser().parseFromString(h, 'text/html');
const root = fileURLToPath(new URL('..', import.meta.url));
async function importDocx(blocks, opts) {
  const x = await extractDocx(await makeDocx(blocks, opts), { mammoth, JSZip });
  return { ...x, ...convertDocument(x.html, { parseHtml }) };
}
const byId = (r, id) => r.rows.find((row) => row.id === id);
const findingsFor = (r, id) => r.findings.filter((f) => f.id === id).map((f) => f.message);

test('structure: title, description, sections, stimuli, questions, reminders, exclusions', async () => {
  const r = await importDocx(LEMONADE_LAB);
  assert.equal(r.title, 'ECN100 - Lemonade Stand Lab');
  assert.equal(r.description, '<p>To: Student</p><p>Welcome to the lab. You will analyze the stand’s costs.</p>');
  assert.deepEqual(r.rows.map((x) => `${x.id}:${x.type}:${x.title}`), [
    't1:text_only:Objective 1',
    't2:text_only:Objective 1, Step 1',
    's1:stimulus:Directions',
    'q1:multiple_answer:Question 1',
    'q2:numeric:Question 2',
    't3:text_only:Reminder',
    't4:text_only:Objective 1, Step 2',
    's2:stimulus:Directions',
    'q3:multiple_choice:Question 3',
    'q4:file_upload:Question 4',
    't5:text_only:Reminder',
    't6:text_only:Closing remarks',
  ]);
  assert.deepEqual(r.rows.filter((x) => x.parent_stimulus).map((x) => `${x.id}>${x.parent_stimulus}`), ['q1>s1', 'q2>s1', 'q3>s2', 'q4>s2']);
  assert.deepEqual(r.excluded.map((e) => e.reason), ['Document-control note', 'Instructor-only section (not included in the quiz)']);
  const all = JSON.stringify(r.rows) + r.description;
  assert.ok(!all.includes('9999') && !all.includes('Answer key') && !all.includes('Published 1/1/26'));
  assert.match(byId(r, 't2').question, /^<h3>Step 1: Classify costs<\/h3>/);
  assert.match(byId(r, 't2').question, /<table>/);
});

test('questions: typed and Word-list numbering, [*] choices, numeric blocks, uploads, feedback', async () => {
  const r = await importDocx(LEMONADE_LAB);
  const q1 = byId(r, 'q1');
  assert.deepEqual([q1.choice_1, q1.choice_2, q1.choice_3, q1.correct], ['Stand rental', 'Lemons', 'City permit', 'choice_1;choice_3']);
  assert.equal(q1.question, '<p>Which of the following are fixed costs? Select all that apply.</p>');
  assert.equal(q1.feedback_general, '<p>Answer: Stand rental, City permit</p><p>These costs do not change with the number of cups sold.</p>');
  const q2 = byId(r, 'q2');
  assert.deepEqual([q2.numeric_answer, q2.numeric_tolerance], ['15.00', '0.1']);
  assert.equal(q2.feedback_general, '<p>Answer: $15.00</p><p>Fixed cost = $10.00 + $5.00 = $15.00.</p>');
  const q3 = byId(r, 'q3');
  assert.equal(q3.question, '<p>Does the stand make a profit at 40 cups?</p>');
  assert.deepEqual([q3.choice_1, q3.choice_2, q3.correct], ['yes', 'no', 'choice_1']);
  assert.ok(!q3.feedback_general.includes('[*]'));
  const q4 = byId(r, 'q4');
  assert.deepEqual([q4.upload_file_types, q4.upload_max_files], ['PDF', 1]);
});

test('findings: margin vs rounding (with fix), stray [*], drafted alt text, suggestions and comments', async () => {
  const r = await importDocx(LEMONADE_LAB, { comments: 2 });
  const margin = r.findings.find((f) => f.id === 'q2');
  assert.match(margin.message, /nearest 0\.01, but the margin is 0\.1/);
  assert.deepEqual(margin.fix, { label: 'Set margin to 0.01', field: 'numeric_tolerance', value: '0.01' });
  assert.match(findingsFor(r, 'q3')[0], /stray \[\*\] from the feedback/);
  assert.match(findingsFor(r, 't2')[0], /drafted from its figure caption/);
  assert.match(byId(r, 't2').question, /<img src="image-01.png" alt="A lemonade stand with a price sign showing \$2 per cup.">/);
  assert.deepEqual(r.warnings.map((w) => w.severity), ['error', 'warning']);
  assert.match(r.warnings[0].message, /1 suggested edit/);
  assert.match(r.warnings[1].message, /2 comment/);
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].name, 'image-01.png');
});

test('inline choices, missing [*], feedback disagreeing with the key, percent margins, essays', async () => {
  const r = await importDocx([
    { p: 'Quiz', style: 'Title' },
    { p: 'Directions Answer the questions.' },
    { p: '1. Which is a fruit? a. Carrot b. Apple [*] c. Potato Feedback: Answer: Carrot' },
    { p: '2. Pick one. a. Red b. Blue' },
    { p: 'Feedback: none' },
    { p: '3. What is 200 plus 10%?' },
    { p: '[NUMERIC ANSWER] Answer: 220 +/- margin: 5 Type: Percent' },
    { p: 'Feedback: Answer: 220' },
    { p: '4. Explain your reasoning.' },
    { p: 'Feedback: Your instructor will grade this.' },
  ]);
  const [q1, q2, q3, q4] = ['q1', 'q2', 'q3', 'q4'].map((id) => byId(r, id));
  assert.deepEqual([q1.type, q1.choice_1, q1.choice_2, q1.choice_3, q1.correct], ['multiple_choice', 'Carrot', 'Apple', 'Potato', 'choice_2']);
  assert.match(findingsFor(r, 'q1').join(' '), /feedback says "Answer: Carrot" but the choice\(s\) marked \[\*\] say "apple"/i);
  assert.ok(r.findings.some((f) => f.id === 'q2' && f.severity === 'error' && /No choice is marked correct/.test(f.message)));
  assert.deepEqual([q3.numeric_answer, q3.numeric_tolerance], ['220', '11']);
  assert.match(findingsFor(r, 'q3').join(' '), /Converted the 5% margin to ±11/);
  assert.equal(q4.type, 'essay');
});

test('conventions from real Google Docs exports', async () => {
  const r = await importDocx(CONVENTION_VARIANTS);
  assert.equal(r.title, 'Unit 2 Comet Lab');
  assert.equal(r.description, '<p>Greetings, astronomer.</p>');
  assert.deepEqual(r.rows.map((x) => `${x.id}:${x.type}:${x.title}`), [
    't1:text_only:Objective 1',
    't2:text_only:Objective 1, Step 1',
    's1:stimulus:Directions',
    'q1:multiple_choice:Question 1',
    'q2:numeric:Question 2',
    'q3:multiple_choice:Question 3',
    't3:text_only:Reminder',
    't4:text_only:Objective 1, Step 2',
    's2:stimulus:Directions',
    'q4:multiple_choice:Question 4',
    'q5:essay:Question 5',
    't5:text_only:Simulator help',
    't6:text_only:Closing remarks',
  ]);
  // front matter and archive sections are excluded
  assert.deepEqual(r.excluded.map((e) => e.heading), ['Learning Outcomes and Course Goals', 'Mission Training (ARCHIVE - delete when no longer needed)']);
  assert.ok(!JSON.stringify(r.rows).includes('Goal 1') && !JSON.stringify(r.rows).includes('old question'));
  // bold labels, caption headings and Subtitle figure descriptions stay inside their section
  const step1 = byId(r, 't2').question;
  assert.match(step1, /<h4>(<strong>)?Equipment/);
  assert.match(step1, /The comet near the Sun\./);
  assert.match(step1, /<p class="figure-description">|The long description of Figure 1/);
  // [Zero Point] → 0 points; Word-list choices
  assert.deepEqual([byId(r, 'q1').points, byId(r, 'q1').correct], [0, 'choice_1']);
  // "<strong>2</strong>. …", [NUMERIC RESPONSE] in Heading 5, Unicode minus, numbered steps kept in feedback, margin 0 accepted
  const q2 = byId(r, 'q2');
  assert.equal(q2.question, '<p>What is the comet’s radial speed? Enter your answer to the nearest 0.1 km/s.</p>');
  assert.deepEqual([q2.numeric_answer, q2.numeric_tolerance], ['-12.5', '0']);
  assert.match(q2.feedback_general, /1\) Read it from the chart\.<\/p><p>2\) Calculate it from the table\./);
  assert.ok(!findingsFor(r, 'q2').some((m) => /margin/.test(m)));
  // choices separated by line breaks; bold on the correct choice is removed so it doesn't give the answer away
  const q3 = byId(r, 'q3');
  assert.deepEqual([q3.choice_1, q3.choice_2, q3.correct], ['yes', 'no', 'choice_1']);
  // question and choices at the same list level; [ESSAY QUESTION]
  assert.deepEqual([byId(r, 'q4').choice_1, byId(r, 'q4').choice_2, byId(r, 'q4').correct], ['Gravity', 'Friction', 'choice_1']);
  assert.equal(byId(r, 'q5').type, 'essay');
  // numbered instructions are text, not questions
  assert.match(byId(r, 't5').question, /1\. Open the simulator/);
});

test('margin warnings only when the margin is larger than the rounding asked for', async () => {
  const q = (margin) => [
    { p: 'Quiz', style: 'Title' }, { p: 'Directions Answer.' },
    { p: '1. What is x? Enter your answer to the nearest 0.01.' },
    { p: `[NUMERIC ANSWER] Answer: 2.5 +/- margin: ${margin} Type: Absolute` }, { p: 'Feedback: Answer: 2.5' },
  ];
  for (const [margin, warned] of [['0', false], ['0.005', false], ['0.01', false], ['0.1', true]]) {
    const r = await importDocx(q(margin));
    assert.equal(r.findings.some((f) => /margin is/.test(f.message)), warned, `margin ${margin}`);
  }
});

test('no [*] but the feedback names the answer: offer a one-click fix', async () => {
  const r = await importDocx([
    { p: 'Quiz', style: 'Title' }, { p: 'Directions Look at the charts.' },
    { p: '1. Which chart is correct?' }, { p: 'a. Chart A' }, { p: 'b. Chart B' }, { p: 'c. Chart C' },
    { p: 'Feedback: Answer: Figure B' },
  ]);
  const f = r.findings.find((x) => x.id === 'q1' && x.severity === 'error');
  assert.deepEqual(f.fix, { label: 'Mark choice 2 (B) correct', field: 'correct', value: 'choice_2' });
});

test('"+1" answers, exact-response numerics, multi-line answer lists, and feedback-only repeated lines', async () => {
  const MORE = 'For more information, refer to the mission training on formal charge.';
  const r = await importDocx([
    { p: 'Quiz', style: 'Title' },
    { p: 'Step 1: Charges', style: 'Heading2' },
    { p: 'Directions', style: 'Heading4' },
    { p: '1. What is the formal charge of the nitrogen?' },
    { p: [{ text: '[NUMERIC ANSWER]', bold: true }] },
    { p: [{ text: 'Requirement: Exact response', bold: true }, { br: true }, { text: 'Answer: +1', bold: true }] },
    { p: 'Feedback:', style: 'Heading5' },
    { p: 'Answer: +1' },
    { p: MORE },
    { p: '2. Which are true? Select all that apply.' },
    { p: 'Lysozyme binds [*]', list: { num: 1, level: 0 } },
    { p: 'Ovalbumin binds', list: { num: 1, level: 0 } },
    { p: 'Both are proteins [*]', list: { num: 1, level: 0 } },
    { p: 'Feedback:', style: 'Heading5' },
    { p: [{ text: 'Answer:' }, { br: true }, { text: 'Lysozyme binds' }] },
    { p: 'Both are proteins' },
    { p: MORE },
    { p: 'Step 2: Next', style: 'Heading2' },
  ]);
  const q1 = byId(r, 'q1');
  assert.deepEqual([q1.type, q1.numeric_answer, q1.numeric_tolerance], ['numeric', '1', undefined]);
  assert.deepEqual(findingsFor(r, 'q1'), []);
  assert.ok(!findingsFor(r, 'q2').some((m) => /feedback says/i.test(m)), 'all listed answers are compared');
  assert.ok(!r.rows.some((x) => x.title === 'Reminder'), 'a sentence that only ends feedback is not a reminder');
  assert.match(byId(r, 'q2').feedback_general, /For more information/);
});

test('a document with no recognisable questions reports an error', async () => {
  const r = await importDocx([{ p: 'Notes', style: 'Title' }, { p: 'Just some text.' }]);
  assert.ok(r.findings.some((f) => f.severity === 'error' && /No questions were found/.test(f.message)));
});

test('a file that is not a .docx is rejected with a clear message', async () => {
  await assert.rejects(extractDocx(new TextEncoder().encode('hello').buffer, { mammoth, JSZip }), /isn't a Word document/);
});

test('imported rows validate and build a New Quizzes package with the document images', async () => {
  const r = await importDocx(LEMONADE_LAB);
  const images = new Map(r.images.map((i) => [imageKey(i.name), i]));
  const questions = parseRows(r.rows, { rowOffset: 1 });
  const { errors } = validateQuestions(questions, { images: new Set(images.keys()) });
  assert.deepEqual(errors, []);
  const pkg = buildCanvasPackage(groupIntoBanks(questions, r.title), { description: r.description }, { images });
  pkg.files.filter((f) => typeof f.content === 'string').forEach((f) => assert.equal(XMLValidator.validate(f.content), true, f.path));
  assert.ok(pkg.files.some((f) => f.path === 'Uploaded Media/image-01.png'));
  assert.match(pkg.files[1].content, /\$IMS-CC-FILEBASE\$\/Uploaded Media\/image-01.png/);
});

// ---- Real course documents in examples/ (course material, not in the repo; skipped when absent) ----
// Counts were checked by hand against each document on 2026-11-13. A change here means the rules changed.
const EXAMPLES = [
  [/Perfume Collapse/, { questions: 34, stimuli: 13 }],
  [/Lab 6 - A Tail of Ice/, { questions: 17, stimuli: 7 }],
  [/M0 Data Analysis/, { questions: 24, stimuli: 5 }],
  [/Meet the Beetles/, { questions: 15, stimuli: 6 }],
  [/\[Instructor\] AST 111 Lab 1/, { questions: 33, stimuli: 4 }],
  [/TEST DOC/, { questions: 36, stimuli: 8 }],
];
const exampleFiles = existsSync(`${root}/examples`) ? readdirSync(`${root}/examples`).filter((f) => f.endsWith('.docx')) : [];
for (const [pattern, expected] of EXAMPLES) {
  const file = exampleFiles.find((f) => pattern.test(f));
  test(`example document converts as checked: ${pattern.source}`, { skip: !file && 'example not present' }, async () => {
    const buf = readFileSync(`${root}/examples/${file}`);
    const x = await extractDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { mammoth, JSZip });
    const r = convertDocument(x.html, { parseHtml, fileName: file });
    assert.deepEqual({ questions: r.stats.questions, stimuli: r.stats.stimuli }, expected);
    assert.ok(r.title && !/=|learning outcomes/i.test(r.title), `title: ${r.title}`);
    const images = new Map(x.images.map((i) => [imageKey(i.name), i]));
    const pkg = buildCanvasPackage(groupIntoBanks(parseRows(r.rows, { rowOffset: 1 }), r.title), { description: r.description }, { images });
    pkg.files.filter((f) => typeof f.content === 'string').forEach((f) => assert.equal(XMLValidator.validate(f.content), true, f.path));
  });
}

// ---- Golden test: the real assignment .docx against its New Quizzes export (course material, not in the repo) ----
const findDocx =(dir) => (existsSync(`${root}/${dir}`) ? readdirSync(`${root}/${dir}`).filter((f) => /perfume/i.test(f) && f.endsWith('.docx')).map((f) => `${dir}/${f}`)[0] : undefined);
const goldenDocx = process.env.GOLDEN_DOCX || findDocx('examples') || findDocx('.');
const goldenExport = fileURLToPath(new URL(`../${process.env.NQ_EXPORT || '7bf013b37d645ff5b4432b4db47ccac41e9b050d016ccdf2524debb9ac632dfe.zip'}`, import.meta.url));

test('real assignment document matches its Canvas export', { skip: !(goldenDocx && existsSync(goldenExport)) && 'golden .docx or export not present' }, async () => {
  const buf = readFileSync(`${root}/${goldenDocx}`);
  const x = await extractDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { mammoth, JSZip });
  const r = convertDocument(x.html, { parseHtml });
  const ours = r.rows.filter((row) => !['text_only', 'stimulus'].includes(row.type));

  const zip = await JSZip.loadAsync(readFileSync(goldenExport));
  const xml = await zip.file(Object.keys(zip.files).find((p) => /^g[0-9a-f]{32}\/g[0-9a-f]{32}\.xml$/.test(p))).async('string');
  const decode = (s) => s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const plain = (s) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const theirs = (xml.match(/<item [\s\S]*?<\/item>/g) || []).filter((it) => !it.includes('text_only_question')).map((it) => {
    const type = /question_type<\/fieldlabel>\s*<fieldentry>([^<]+)/.exec(it)[1];
    if (type === 'numerical_question') { const m = /margin="([\d.]+)">([-\d.]+)</.exec(it); return { type, answer: Number(m[2]), margin: Number(m[1]) }; }
    const labels = Object.fromEntries([...it.matchAll(/<response_label ident="([^"]+)">\s*<material>\s*<mattext[^>]*>([\s\S]*?)<\/mattext>/g)].map((m) => [m[1], plain(m[2])]));
    const cond = (/<conditionvar>([\s\S]*?)<\/conditionvar>/.exec(it)?.[1] || '').replace(/<not>[\s\S]*?<\/not>/g, '');
    return { type, correct: [...cond.matchAll(/<varequal respident="response1">([^<]+)</g)].map((m) => labels[m[1]]).sort() };
  });
  const TYPE = { numeric: 'numerical_question', multiple_choice: 'multiple_choice_question', multiple_answer: 'multiple_answers_question', file_upload: 'file_upload_question', essay: 'essay_question' };
  const same = ours.map((q, i) => {
    const t = theirs[i];
    if (!t || TYPE[q.type] !== t.type) return false;
    if (q.type === 'numeric') return Number(q.numeric_answer) === t.answer && Number(q.numeric_tolerance) === t.margin;
    if (!t.correct) return true;
    const mine = (q.correct || '').split(';').filter(Boolean).map((c) => plain(q[c])).sort();
    return JSON.stringify(mine) === JSON.stringify(t.correct);
  });
  const mismatched = same.map((ok, i) => (ok ? null : i + 1)).filter(Boolean);
  mismatched.forEach((n) => {
    const q = ours[n - 1];
    const mine = q.type === 'numeric' ? `${q.numeric_answer}±${q.numeric_tolerance}` : (q.correct || '').split(';').filter(Boolean).map((c) => plain(q[c]));
    console.log(`  Q${n}: ours ${q.type} ${JSON.stringify(mine)} | Canvas ${JSON.stringify(theirs[n - 1])}`);
  });
  console.log(`golden: ${ours.length} questions, ${same.filter(Boolean).length} match the export; differing: ${mismatched.join(', ') || 'none'}`);
  assert.equal(ours.length, theirs.length);
  // Q23, Q25 and Q26 were rewritten after the Canvas version was built.
  assert.ok(mismatched.every((n) => [23, 25, 26].includes(n)), `unexpected mismatches: ${mismatched}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, normalizeType, resolveChoice, validateQuestions, groupIntoBanks } from '../src/parse.js';
import { EXAMPLE_ROWS } from '../src/schema.js';

const one = (row, opts) => parseRows([row], opts)[0];
const errorsFor = (rows, target) => validateQuestions(parseRows(rows), { target }).errors.map((e) => e.message);

test('type aliases normalize; unknown types are rejected, not silently made multiple choice', () => {
  assert.equal(normalizeType('MC'), 'multiple_choice');
  assert.equal(normalizeType('Multiple Answers'), 'multiple_answer');
  assert.equal(normalizeType('true/false'), 'true_false');
  assert.equal(normalizeType('fill-in-the-blank'), 'short_answer');
  assert.equal(normalizeType('numerical_question'), 'numeric');
  assert.equal(normalizeType('stimulus'), 'stimulus');
  assert.equal(normalizeType('passage'), 'text_only');
  assert.equal(normalizeType(''), 'multiple_choice');
  assert.equal(normalizeType('multiple choise'), null);
  const errs = errorsFor([{ type: 'multiple choise', question: 'x', choice_1: 'a', choice_2: 'b', correct: '1' }]);
  assert.match(errs[0], /unknown type/);
});

test('example rows are all valid', () => {
  const qs = parseRows(EXAMPLE_ROWS, { rowOffset: 1 });
  assert.equal(qs.length, EXAMPLE_ROWS.length);
  assert.deepEqual(validateQuestions(qs).errors, []);
});

test('correct accepts choice_n, n, letters and exact choice text', () => {
  const choices = [{ id: 'C1', num: 1, text: 'Paris' }, { id: 'C2', num: 2, text: 'Rome' }];
  assert.equal(resolveChoice('choice_2', choices), 'C2');
  assert.equal(resolveChoice('2', choices), 'C2');
  assert.equal(resolveChoice('b', choices), 'C2');
  assert.equal(resolveChoice('rome', choices), 'C2');
  assert.equal(resolveChoice('choice_3', choices), null);
});

test('commas are not list separators, so answers keep them', () => {
  const q = one({ type: 'short_answer', question: 'Q', correct: 'Paris, France;Paris' });
  assert.deepEqual(q.answers, ['Paris, France', 'Paris']);
});

test('header names are case/space insensitive', () => {
  const q = one({ Type: 'mc', Question: 'Q?', 'Choice 1': 'a', 'Choice 2': 'b', Correct: 'choice_2' });
  assert.equal(q.type, 'multiple_choice');
  assert.deepEqual(q.correct, ['C2']);
});

test('true/false needs an explicit answer and always uses True/False choices', () => {
  const t = one({ type: 'tf', question: 'Q', correct: 'FALSE' });
  assert.deepEqual(t.choices.map((c) => c.text), ['True', 'False']);
  assert.deepEqual(t.correct, ['C2']);
  const viaChoice = one({ type: 'tf', question: 'Q', choice_1: 'True', choice_2: 'False', correct: 'choice_1' });
  assert.deepEqual(viaChoice.correct, ['C1']);
  assert.match(errorsFor([{ type: 'tf', question: 'Q' }])[0], /true or false/);
});

test('multiple choice errors: bad reference, two answers, too few choices', () => {
  assert.match(errorsFor([{ type: 'mc', question: 'Q', choice_1: 'a', choice_2: 'b', correct: 'choice_5' }])[0], /don't match/);
  assert.match(errorsFor([{ type: 'mc', question: 'Q', choice_1: 'a', choice_2: 'b', correct: '1;2' }])[0], /only one correct/);
  assert.ok(errorsFor([{ type: 'mc', question: 'Q', choice_1: 'a', correct: '1' }]).some((m) => /at least 2 choices/.test(m)));
});

test('errors carry spreadsheet row numbers and duplicate ids are caught', () => {
  const rows = [
    { id: 'q1', type: 'essay', question: 'A' },
    {},
    { id: 'q1', type: 'essay', question: 'B' },
  ];
  const qs = parseRows(rows); // header is row 1, so data starts at row 2
  assert.deepEqual(qs.map((q) => q.rowNumber), [2, 4]);
  const { errors } = validateQuestions(qs);
  assert.equal(errors[0].row, 4);
  assert.match(errors[0].message, /duplicate id/);
});

test('numeric validation', () => {
  assert.deepEqual(errorsFor([{ type: 'numeric', question: 'Q', numeric_answer: '3.14', numeric_tolerance: '0.01' }]), []);
  assert.match(errorsFor([{ type: 'numeric', question: 'Q' }])[0], /numeric_answer/);
  assert.match(errorsFor([{ type: 'numeric', question: 'Q', numeric_min: '7', numeric_max: '5' }])[0], /less than/);
  assert.match(errorsFor([{ type: 'numeric', question: 'Q', numeric_answer: '3,14' }])[0], /must be a number/);
});

test('matching validation', () => {
  assert.match(errorsFor([{ type: 'matching', question: 'Q', matching_left_1: 'a' }]).join(' '), /only one side/);
});

test('experimental types are blocked for Canvas QTI 1.2 but allowed for QTI 2.1', () => {
  const row = { type: 'ordering', question: 'Q', choice_1: 'a', choice_2: 'b', correct_order: '2;1' };
  assert.match(errorsFor([row], 'canvas')[0], /can't be imported through QTI/);
  assert.deepEqual(errorsFor([row], 'qti21'), []);
});

test('stimulus links are checked', () => {
  const stim = { id: 's1', type: 'stimulus', question: 'Case' };
  const child = (extra) => ({ id: 'c', type: 'essay', question: 'Q', parent_stimulus: 's1', ...extra });
  assert.deepEqual(errorsFor([stim, child()]), []);
  assert.match(errorsFor([child()])[0], /doesn't match any row id/);
  assert.match(errorsFor([{ ...stim, type: 'text_only' }, child()])[0], /not a stimulus/);
  assert.match(errorsFor([{ ...stim, bank_name: 'A' }, child({ bank_name: 'B' })])[0], /different bank_name/);
  assert.match(errorsFor([stim, child({ type: 'text_only' })])[0], /can't belong to a stimulus/);
  const { warnings } = validateQuestions(parseRows([stim]));
  assert.match(warnings[0].message, /no questions name this stimulus/);
});

test('images must be added when validation is given the image list', () => {
  const rows = [{ type: 'essay', question: 'See <img src="a.png">', image: 'Graph.PNG', image_alt: 'g' }];
  const check = (names) => validateQuestions(parseRows(rows), { images: new Set(names) }).errors.map((e) => e.message);
  assert.match(check([])[0], /Graph\.PNG, a\.png/);
  assert.deepEqual(check(['graph.png', 'a.png']), []);
  const urlOnly = [{ type: 'essay', question: '<img src="https://example.com/x.png">' }];
  assert.deepEqual(validateQuestions(parseRows(urlOnly), { images: new Set() }).errors, []);
});

test('partial_credit must be a yes/no value', () => {
  const row = { type: 'ma', question: 'Q', choice_1: 'a', choice_2: 'b', correct: '1' };
  assert.deepEqual(errorsFor([{ ...row, partial_credit: 'Yes' }]), []);
  assert.match(errorsFor([{ ...row, partial_credit: 'maybe' }])[0], /partial_credit/);
});

test('rows group into banks by bank_name', () => {
  const banks = groupIntoBanks(parseRows([
    { bank_name: 'A', type: 'essay', question: '1' },
    { type: 'essay', question: '2' },
    { bank_name: 'A', type: 'essay', question: '3' },
  ]), 'Default');
  assert.deepEqual(banks.map((b) => [b.title, b.questions.length]), [['A', 2], ['Default', 1]]);
});

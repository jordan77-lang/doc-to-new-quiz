// Keeps the model instructions consistent: each prompt's example output must be valid JSON, match its
// schema, and pass the same code checks the app will run on real model replies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(`../prompts/${p}`, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');
const schema = (name) => JSON.parse(read(`schemas/${name}.schema.json`));

// The JSON block that follows a line starting with `label` inside the "## Example" section.
function exampleJson(file, label) {
  const md = read(file);
  const example = md.slice(md.indexOf('## Example'));
  const m = new RegExp(`${label}:\\s*\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``).exec(example);
  assert.ok(m, `${file}: no "${label}:" block in the example`);
  return JSON.parse(m[1]);
}

// Minimal JSON Schema check for the keywords these schemas use.
function validate(value, s, path = '$') {
  const errors = [];
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (s.type && s.type !== type && !(s.type === 'integer' && Number.isInteger(value))) return [`${path}: expected ${s.type}, got ${type}`];
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (type === 'string' && s.maxLength !== undefined && value.length > s.maxLength) errors.push(`${path}: longer than ${s.maxLength}`);
  if (type === 'array') {
    if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
    if (s.items) value.forEach((v, i) => errors.push(...validate(v, s.items, `${path}[${i}]`)));
  }
  if (type === 'object') {
    (s.required || []).forEach((k) => { if (!(k in value)) errors.push(`${path}: missing ${k}`); });
    Object.entries(value).forEach(([k, v]) => {
      if (s.properties?.[k]) errors.push(...validate(v, s.properties[k], `${path}.${k}`));
      else if (s.additionalProperties === false) errors.push(`${path}: unexpected property ${k}`);
    });
  }
  return errors;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const words = (s) => (s.match(/[^\s]+/g) || []).sort();

const TASKS = [
  ['classify-blocks.md', 'classify-blocks'],
  ['extract-question.md', 'item'],
  ['rebuild-table.md', 'table'],
  ['review-item.md', 'review'],
  ['alt-text.md', 'alt-text'],
  ['generate-questions.md', 'generate'],
];

test('every schema is valid JSON with a top-level object', () => {
  TASKS.forEach(([, name]) => assert.equal(schema(name).type, 'object', name));
});

for (const [file, name] of TASKS) {
  test(`${file}: example output matches ${name}.schema.json`, () => {
    assert.deepEqual(validate(exampleJson(file, 'Output'), schema(name)), []);
  });
}

test('the generate schema items stay identical to the item schema', () => {
  const { $comment, ...item } = schema('item');
  assert.deepEqual(schema('generate').properties.items.items, item);
});

test('examples pass the code checks described in each prompt', () => {
  const classifyIn = exampleJson('classify-blocks.md', 'Input');
  const classifyOut = exampleJson('classify-blocks.md', 'Output');
  assert.deepEqual(classifyOut.labels.map((l) => l.block_id), classifyIn.blocks.map((b) => b.id));

  const extractIn = exampleJson('extract-question.md', 'Input');
  const extractOut = exampleJson('extract-question.md', 'Output');
  assert.ok(extractIn.block.includes(extractOut.source_quote));
  assert.ok(extractIn.block.includes(extractOut.numeric_answer) && extractIn.block.includes(extractOut.numeric_tolerance));
  assert.ok(squash(extractIn.block).includes(squash(extractOut.question)));

  const tableIn = exampleJson('rebuild-table.md', 'Input');
  const t = exampleJson('rebuild-table.md', 'Output');
  assert.deepEqual(words([t.caption, ...t.header, ...t.rows.flat(), t.left_over].join(' ')), words(tableIn.text));
  t.rows.forEach((r) => assert.equal(r.length, t.header.length));

  const reviewIn = exampleJson('review-item.md', 'Input');
  const reviewOut = exampleJson('review-item.md', 'Output');
  const itemText = JSON.stringify(reviewIn.item);
  reviewOut.suggestions.forEach((s) => assert.ok(itemText.includes(s.quote), `quote not in item: ${s.quote}`));
  assert.ok(reviewOut.suggestions.every((s) => s.field !== 'numeric_answer' || s.proposed_value === ''));

  const alt = exampleJson('alt-text.md', 'Output');
  assert.ok(alt.alt.length <= 250 && !/^(image|picture) of/i.test(alt.alt));

  const genIn = exampleJson('generate-questions.md', 'Input');
  const genOut = exampleJson('generate-questions.md', 'Output');
  assert.equal(genOut.items.length, genIn.count);
  genOut.items.forEach((it) => {
    assert.ok(genIn.section_text.includes(it.source_quote));
    assert.ok(genIn.types.includes(it.type));
    assert.equal(it.choices.filter((c) => c.correct).length, 1);
  });
});

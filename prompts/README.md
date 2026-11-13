# Model instructions

Prompts and output schemas for the local language model used by the PDF → New Quiz pipeline
(see [docs/doc-to-quiz-spec.md](../docs/doc-to-quiz-spec.md)). They're written for a small model
(Qwen2.5-3B-Instruct in WebLLM) and work unchanged with larger ones.

## How every task is called

```js
const messages = [
  { role: 'system', content: BASE + '\n\n' + TASK },     // base.md + the task's .md file
  { role: 'user', content: JSON.stringify(input) },       // the task's input object, nothing else
];
const reply = await engine.chat.completions.create({
  messages,
  temperature: 0,                                          // 0.2 for generate-questions
  max_tokens: 1000,
  response_format: { type: 'json_object', schema: JSON.stringify(SCHEMA) }, // schemas/<task>.schema.json
});
const result = JSON.parse(reply.choices[0].message.content);
```

- **One block or item per call.** Keep system prompt + input under ~2,500 tokens. Never send the whole document.
- **Strip the task file's `## Example` section** if you're short on context. The rules are what matter.
- **Validate every reply** with the checks listed for that task. On invalid JSON or a failed check, retry
  once; if it fails again, show the item as "needs manual edit". Never silently accept it.
- **Never send instructor-only blocks** to `extract-question`, `review-item` or `generate-questions`.
- The model's output is always a **suggestion**. The review screen shows it next to the source, and a person
  accepts or rejects it.

## Tasks

| File | Use it when | Schema |
|---|---|---|
| [base.md](base.md) | Prepended to every task | n/a |
| [classify-blocks.md](classify-blocks.md) | The segmenter can't label a paragraph | [classify-blocks.schema.json](schemas/classify-blocks.schema.json) |
| [extract-question.md](extract-question.md) | The rule parser failed on a question block | [item.schema.json](schemas/item.schema.json) |
| [rebuild-table.md](rebuild-table.md) | A table was flattened into running text | [table.schema.json](schemas/table.schema.json) |
| [review-item.md](review-item.md) | Quality review of a parsed item | [review.schema.json](schemas/review.schema.json) |
| [alt-text.md](alt-text.md) | A figure has no alt text | [alt-text.schema.json](schemas/alt-text.schema.json) |
| [generate-questions.md](generate-questions.md) | The user asks for new questions on a section | [generate.schema.json](schemas/generate.schema.json) |

## Changing a prompt
Run the golden-set test (spec §5) before and after. Small models are sensitive to wording: change one thing
at a time, and keep the examples in step with the rules.

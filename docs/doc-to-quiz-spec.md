# PDF → New Quiz: implementation spec

**Goal:** an instructional designer uploads the assignment document as a **.docx** (Google Docs: File →
Download → Microsoft Word). The site turns it into a reviewed, importable Canvas New Quiz in minutes instead
of hours. A local language model helps, but a person approves everything before export.

**Input decision (2026-11-13):** .docx is the supported input. PDF is an optional later addition (§2.1).

**Status (2026-11-13):** Phase 1 (§6 step 1) is built: `src/docx/extract.js` and `src/docx/convert.js`, wired
into the page as "Upload the assignment document (.docx)", with an import report (fixes, dismissals and
excluded content) and source text on every item. It's tested with generated fixtures (`test/docx.test.js`) and against five real course documents in `examples/`:
*Perfume Collapse* matches its Canvas export on 31 of 34 questions (the other 3 were rewritten after the
Canvas version), and the other four are snapshot-tested on counts checked by hand. Those tests skip when the
files are absent, because the files are course material and gitignored. Use `npm run inspect -- <file.docx>`
to see how a new document converts.

The page is organised around this flow: **1** upload the .docx, **2** review and fix (with an inline editor on each
item), **3** choose **New Quiz** (everything) or **Question bank** (just the questions and the Directions they belong to,
written as a Canvas `<objectbank>`), **4** import into Canvas. Spreadsheet, paste and template input is kept under
"Other ways to add questions". Not yet confirmed: whether Canvas shows an imported bank as a New Quizzes item bank.

The model tasks (§2.7) are not built yet.

---

## 1. Key decision: rules extract, the model assists

We tested a rule-based parser on *Mod 1 Act 1 – The Perfume Collapse* and compared it with the same quiz
exported from Canvas:

| Result | Count |
|---|---|
| Questions found | 34 of 34 |
| Type, correct choices and numeric answer/margin identical to Canvas | 31 |
| Different because the PDF is a newer revision (Q23, Q25, Q26 were rewritten) | 3 |
| Extraction errors | 0 |

The document's authoring conventions (`[*]`, `[NUMERIC ANSWER] … Answer: X +/- margin: Y`, `Feedback:`) are
precise. Code reads them perfectly; a 1.5–3B model running in the browser does not. Small models copy numbers
wrongly, drop distractors, merge choices, and cannot do arithmetic reliably.

So:

- **Code** extracts everything the document states explicitly: structure, questions, choices, correct
  answers, numeric answers and margins, feedback. It also runs every check that can be computed.
- **The model** handles what code can't: labelling ambiguous blocks, rebuilding flattened tables, extracting a
  question the rules failed on, reviewing quality, drafting alt text, and proposing new questions.
- **A person** approves every model output. Nothing the model wrote is exported until it's been accepted.

This also keeps the model's work small (one block per call), which suits a 4,096-token context window.

---

## 2. Pipeline

```
 Upload ─► 1 Extract ─► 2 Clean ─► 3 Segment ─► 4 Parse (rules) ─► 5 Check (rules)
                                                                         │
                     8 Build QTI ◄─ 7 Review & approve (person) ◄─ 6 Assist (model)
```

| Stage | Who | Input → output |
|---|---|---|
| 1 Extract | code | file → pages of positioned text runs, link annotations, images |
| 2 Clean | code | pages → one clean text stream with page references |
| 3 Segment | code, model only when unsure | text → ordered **blocks** (heading, narrative, directions, question, figure, table, reminder, instructor-only, document-control) |
| 4 Parse | code | question blocks → **draft items** in the row format the builder already uses |
| 5 Check | code | draft items → **findings** (errors and warnings with evidence) |
| 6 Assist | model | selected blocks/items → **suggestions** (JSON, schema-constrained) |
| 7 Review | person | items + findings + suggestions → approved items |
| 8 Build | code (exists) | approved rows → `validateQuestions` → `buildCanvasPackage` → .zip |

### 2.1 Extract

**DOCX (supported input).** Convert with mammoth.js in the browser (`mammoth.convertToHtml({ arrayBuffer })`),
then walk the resulting HTML. It keeps:
- headings (when authors use Heading styles; otherwise bold paragraphs, which the segmenter also recognises);
- bold and italics, lists, and **real tables**, so there's no table rebuilding;
- hyperlinks, so "AXIOM terminal link" keeps its URL;
- images, delivered by mammoth's image converter. Turn each one into a `File` for the existing Images list,
  keeping its order so it lines up with the "Figure N" captions.

Before converting, open the .docx with JSZip (already loaded) and check:
- **Unresolved suggestions or comments:** `w:ins` / `w:del` in `word/document.xml`, or a `word/comments.xml`
  with entries. Warn: "This document has suggested edits or comments. Accept or reject them in Google Docs and
  download again, or the quiz may include text you didn't mean to keep."
- **Document tabs:** Google Docs tabs (e.g. the "Version notes" tab) may be exported into the same file. If
  the converted HTML contains a second top-level title or a "Version notes" heading, treat that section as
  document-control and exclude it. Confirm the behaviour with a real export.

**PDF (optional, later).** If PDF support is ever needed, use pdf.js (`pdfjs-dist`):
- `page.getTextContent()` returns text runs with positions. Rebuild lines by grouping runs with the same
  baseline (y), and paragraphs by line spacing. Don't rely on line breaks: PDFs exported from Google Docs can
  put every word on its own line.
- `page.getAnnotations()` for hyperlinks, and the operator list (`paintImageXObject`) for images.
- Tables come out flattened and need the `rebuild-table` model task.

### 2.2 Clean (code)
Most of this is only needed for PDF. A .docx has no page numbers and no broken lines, but the
document-control text still has to go. Remove the following, and record what was removed so the reviewer can see it:
- **Document-control text**, e.g. "Published 8/17/26. Any changes made to this document will be implemented
  in the next version…".
- **Page numbers.** pdf.js gives their position (bottom margin), so drop runs in the footer band rather than
  guessing from the text. The text-only prototype produced artefacts such as `Answer: 0.219 19 +/- margin`.
- **Ligatures:** ﬁ → fi, ﬂ → fl. Also normalise curly quotes for matching (keep the originals for display).
- **Hyphenation** across line ends, and duplicated whitespace.

### 2.3 Segment (code first)
Recognise blocks by the document's own signals, in this order:

| Signal | Block |
|---|---|
| Heading text "Instructor guide", "Instructor resources", "Answer key" | **instructor-only.** Everything after it is excluded from student content. |
| `Objective N:` heading | section heading |
| `Step N:` heading | sub-section heading |
| Paragraph starting `Directions` | directions (becomes a stimulus) |
| `N. ` at the start of a paragraph, numbered in sequence | question |
| `Figure N` + caption | figure (image + caption) |
| `Table N.` + caption | table |
| Repeated warning paragraphs (same text appears 2+ times), e.g. "If you leave the AXIOM terminal…" | reminder |
| Text before the first section heading | quiz description (mission memo / overview) |
| Text after the last question | closing text |

Call the model (prompt `classify-blocks`) only for paragraphs that match none of these, and only to choose
between the labels above. Low-confidence labels are shown to the reviewer as "check this".

**Instructor-only content never goes to the model's student-content tasks and never into the quiz.** This PDF's
instructor guide includes the full answer key and an instructor checkpoint ID.

### 2.4 Map blocks to New Quiz items
This mapping reproduces how the course team built the Canvas version (confirmed in the export):

| Block | New Quiz item | Notes |
|---|---|---|
| Preamble | quiz **description** | Shown before the student starts. |
| Each Objective heading + its intro | `text_only` (title "Objective N") | |
| Each Step heading + narrative + figures/tables | `text_only` (title "Objective N, Step M") | |
| Directions paragraph | `stimulus` (title "Directions") | |
| Questions until the next heading | children: `parent_stimulus` = that stimulus | |
| Reminder | `text_only` (title "Reminder") | One per occurrence, in place. |
| Closing text | `text_only` (title "Closing remarks") | |
| Instructor-only | not exported | Listed in the review screen as excluded. |

### 2.5 Parse questions (code)

| Pattern | Result |
|---|---|
| `[NUMERIC ANSWER]` … `Answer: <n> +/- margin: <m> Type: Absolute` | `numeric`, `numeric_answer` = n, `numeric_tolerance` = m |
| `Type: Percent` (if authors use it) | flag for review: percent margins are not yet supported by the builder |
| Choices `a. … b. …` with `[*]` after correct ones | choices in order. 1 `[*]` → `multiple_choice`; 2+ `[*]` or "Select all that apply" → `multiple_answer` |
| Exactly two choices `yes/no` or `true/false` | keep as `multiple_choice` (matches the Canvas build) |
| Question text says to upload / "upload it for submission" and has no choices | `file_upload` (types from the text, e.g. "PDF" → `upload_file_types` = PDF, `upload_max_files` = 1) |
| `Feedback:` to the end of the question block | `feedback_general` (the team uses general feedback for every item) |
| `Requirement:` / `Type:` lines | consumed; never shown to students |
| Images inside a question | `image` + `image_alt` |

Points: 1 per scored item unless the document says otherwise (all 34 are 1 point in Canvas).

### 2.6 Check (code, before any model call)
Each check produces a finding with the item, the evidence and a suggested fix:

- **Answer key agrees with feedback:** if feedback starts with `Answer: X`, X must equal the numeric answer
  (allowing for formatting: $, commas, trailing zeros) or the text of the marked choice(s).
- **Stray markers:** `[*]` or `[NUMERIC ANSWER]` inside feedback or stems. (Q25 has `[*]` in its feedback.)
- **Multiple-answer consistency:** "Select all that apply" with only one `[*]`, or several `[*]` without it.
- **Margin sanity:** margin ≥ 0; margin should match the rounding the stem asks for ("nearest 0.001" →
  0.001). Q5 asks for "nearest 0.01" but has margin 0.1, which should be flagged for a person to decide.
- **Choice letters in sequence** (a, b, c…) with none missing; no duplicate choices.
- **Sequence:** question numbers increase by 1; every question belongs to a Directions block (or is flagged).
- **Links:** every "link" phrase has a URL; URLs are https.
- **Figures:** every `Figure N` mentioned in text has an image; every image has alt text (or a draft).
- **Everything the builder already checks** (`validateQuestions`).

### 2.7 Assist (model)
Each task is a separate, small call with its own prompt and JSON schema (see [`/prompts`](../prompts/README.md)):

| Task | When | Output | Verified by code |
|---|---|---|---|
| `classify-blocks` | segmenter is unsure | label + confidence per block | label must be from the allowed list |
| `extract-question` | rules failed on a question block | one item | every choice and the stem must appear (fuzzy) in the source; `validateQuestions` |
| `rebuild-table` | a table was flattened (PDF) | HTML `<table>` | every word and number in the source appears exactly once in the table |
| `review-item` | every scored item (user can skip) | list of suggestions with quotes | each quote must appear in the item; numbers in suggestions are not trusted, so code recomputes or flags them |
| `alt-text` | figure without alt text | short alt text from the caption + nearby text | length ≤ 250 chars; no "image of" |
| `generate-questions` | user asks, for a section with no questions | 1–5 new items, marked **AI-drafted** | `validateQuestions`; the correct answer must be supported by a quoted sentence from the section |

Model settings: `temperature: 0` (0.2 for generate-questions), `max_tokens` 800–1,200, JSON mode with the
task's schema (WebLLM `response_format: { type: "json_object", schema }`; confirm the option name against the
vendored WebLLM version). Retry once on invalid JSON, then mark the task "failed, edit manually".

Input budget per call: about 2,500 tokens for system prompt + input, leaving room for output within the
default 4,096-token context of the prebuilt Qwen2.5/Llama 3.2 models. Never send the whole document.

### 2.8 Review screen (person)
- Two columns: **source** (the PDF page region or block text) on the left, the **item as students will see
  it** on the right, kept in step as you scroll.
- Every item shows its origin: *from document* (rules), *AI-extracted*, *AI-drafted*.
- Findings and model suggestions appear as cards on the item: **Accept** applies the change, **Dismiss**
  hides it, **Edit** opens the field. Accepted model changes are logged on the item.
- Export is blocked while there are errors, unapproved AI-extracted/AI-drafted items, or images without alt text.
- **Download rows (.xlsx)** at any point, so the quiz can be finished in a spreadsheet with the existing builder.

### 2.9 Build (exists)
Approved items → rows in the format of `src/schema.js` → `validateQuestions` → `groupIntoBanks` →
`buildCanvasPackage` with the extracted images. No changes needed beyond passing the quiz description.

---

## 3. Model back end

Reuse the Canvas Helper assistant interface (`load(modelId)`, `ask(...)`, `stop()`) so back ends can be swapped:

| Back end | Pros | Cons |
|---|---|---|
| **WebLLM, Qwen2.5-3B-Instruct** (default) | Runs on the user's GPU; content never leaves the computer; no cost | ~2 GB first download; needs WebGPU and ~2.5 GB GPU memory; small model, so tasks must stay narrow |
| WebLLM, Qwen2.5-1.5B | Faster, smaller | Noticeably weaker at review and generation; fine for classify/alt-text |
| Ollama (local server) | Larger models (7–14B) on the same machine | Needs installing; CORS setup |
| ASU CreateAI or another hosted API | Much stronger models | Content leaves the device; check data agreements first |

Prompts are written for the 3B model and work unchanged with larger ones.

Performance estimate for a 34-question document on a laptop GPU: rules stages under 2 s; review of all items
roughly 2–5 minutes with the 3B model (about 5–10 s per item). Make review optional and cancellable, and run
it item by item so the reviewer can start before it finishes.

---

## 4. Privacy
- The default model runs locally, so course documents are not uploaded anywhere. Say so on the page.
- Course documents rarely contain student data. If one does (names, IDs), it still stays on the device with
  the local model. Hosted back ends should be opt-in, with a warning.
- Instructor-only sections (answer keys, checkpoint IDs) are excluded from the quiz and from student-content
  prompts.

---

## 5. Evaluation
Keep a small **golden set**: pairs of (source document, Canvas export of the finished quiz). The first pair is
*The Perfume Collapse* PDF + its New Quizzes export, kept out of the repo because it's course material.

Automated test: run stages 1–5 on the document, compare items with the export (type, correct answers, numeric
answer and margin, feedback similarity, stimulus grouping, item order). The target is 100% on documents that
follow the conventions. Track model-task quality separately (acceptance rate of suggestions in real use).

---

## 6. Build order

1. **Rules path, no model:** DOCX extract (with images and links) → clean → segment → parse → check → review
   screen → build. This alone delivers most of the time saving for documents that follow the conventions.
2. **Golden-set test runner** using the .docx of *The Perfume Collapse* and its Canvas export, plus an
   authoring-conventions checker that writers can run on a draft.
3. **Model tasks** in this order: `alt-text`, `review-item`, `extract-question`, `classify-blocks`,
   `generate-questions`. (`rebuild-table` is only needed if PDF input is added.)
4. **PDF input**, only if it turns out to be needed.

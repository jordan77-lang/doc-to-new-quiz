# Question templates and column guide

Fill in one row per question, then upload the file (or paste the rows) into the builder, along with any
images the questions use. It produces a QTI .zip that Canvas imports as a New Quiz.

## Files
- **question-template.xlsx / .csv**: every column, with example rows for each question type, including a stimulus group. The xlsx also has a Help sheet.
- **blank-template.xlsx / .csv**: headers only.
- **gsheet_setup_appsscript.js**: builds a Google Sheet with dropdowns and validation (see GoogleSheetSetup.md).

All of these are generated from `src/schema.js`. To add or rename columns, edit that file and run `npm run templates`.

## Question types

| `type` | In New Quizzes | Columns used |
|---|---|---|
| `multiple_choice` | Multiple Choice | `choice_1…`, `correct` (one choice) |
| `multiple_answer` | Multiple Answer | `choice_1…`, `correct` (several, separated by `;`), `partial_credit` |
| `true_false` | True or False | `correct` = `true` or `false` |
| `short_answer` | Fill in the Blank | `correct` = accepted answers separated by `;` |
| `numeric` | Numeric | `numeric_answer` (+ `numeric_tolerance`), **or** `numeric_min` + `numeric_max` |
| `matching` | Matching | `matching_left_n` / `matching_right_n`, optional `matching_distractors` |
| `essay` | Essay (graded manually) | none |
| `file_upload` | File Upload (graded manually) | optional `upload_file_types`, `upload_max_files` |
| `text_only` | Text block (no question) | none. Use it for instructions, headings or a reading. |
| `stimulus` | Stimulus | none. Questions join it with `parent_stimulus`. |

Common spellings work too (`mc`, `ma`, `tf`, `fill in the blank`, `numerical`, …). An unknown type is
reported as an error rather than guessed. A blank `type` cell means `multiple_choice`.

**Not available through QTI yet:** `ordering`, `categorization` and `hotspot`. With the default export these
are flagged as errors. Build them directly in New Quizzes, or try the experimental generic QTI 2.1 export
(uses `correct_order` / `category_n`) in a sandbox course.

## Stimulus groups
A stimulus is content, such as a case, data table, reading or image, that New Quizzes shows next to a set of
questions.
1. Add a row with `type` = `stimulus`, an `id` (e.g. `s1`) and the content in `question`.
2. On each question that belongs to it, set `parent_stimulus` = `s1`.

The builder places those questions right after their stimulus in the quiz, whatever order the rows are in.
Stimulus and text_only rows are worth 0 points.

## Images
- Put the file name in the `image` column (e.g. `cost-curves.png`) and a short description in `image_alt`.
  The image appears above the question text.
- Or place images anywhere in HTML: `<img src="cost-curves.png" alt="...">` in a question, choice, feedback or
  stimulus.
- Then add the image files on the page under **Images**. File names are matched without regard to case, and
  a row that names a file you haven't added is reported as an error.

The files are packed into the zip under `Uploaded Media/`, the same place Canvas puts them in its own
exports. Canvas copies them into the course files on import.

## Columns

| Column | What to put in it |
|---|---|
| `bank_name` | Quiz title. Each different value becomes its own quiz in the same zip. Blank = the title set on the page. |
| `id` | Short unique id (`q1`, `ch3-07`). Blank = the row number. Needed on stimulus rows. Duplicates are reported. |
| `parent_stimulus` | For a question inside a stimulus group: the stimulus row's `id`. |
| `title` | Question name shown in Canvas. Blank = `id`. |
| `question` | Question text. Plain text is fine (line breaks are kept), or write HTML such as `<p>`, `<strong>`, `<sub>`, `<table>`. |
| `image`, `image_alt` | Image shown above the question, and its alt text for screen readers. |
| `points` | Points for the question. Blank = the default on the page (0 for text_only and stimulus). |
| `feedback_general` | Shown after the student answers, whatever the answer. The only feedback essay and file upload questions show. |
| `feedback_correct` / `feedback_incorrect` | Shown for a right / wrong answer. |
| `tags` | For your own organizing only. Canvas doesn't import tags. |
| `choice_1 … choice_12` | Answer choices. Add `choice_13` and beyond if you need more. |
| `correct` | See below. |
| `partial_credit` | multiple_answer only: `true` = partial credit, `false` = all or nothing. Blank = the page setting. |
| `numeric_answer`, `numeric_tolerance` | Exact answer, optionally ± a margin: `108` and `0.01` accepts 107.99–108.01. |
| `numeric_min`, `numeric_max` | Accept any value in this range (inclusive). Use these *instead of* `numeric_answer`. |
| `matching_left_n`, `matching_right_n` | One pair per number. Add `matching_left_7` and beyond if needed. |
| `matching_distractors` | Extra wrong options for the matching dropdowns, separated by `;`. |
| `upload_file_types`, `upload_max_files` | file_upload only: allowed types (`PDF;DOCX`) and the number of files. |

### Writing `correct`
- multiple choice: `choice_2`, `2`, `B`, or the exact text of the choice.
- multiple answers: several of those separated by `;`, e.g. `choice_1;choice_3`.
- true/false: `true` or `false` (`T`/`F` work too).
- short answer: every accepted answer, separated by `;`, e.g. `Na;sodium`.

**Lists use `;` (or `|`), never commas.** Commas are kept as part of the text, so answers like `1,000` or
`Paris, France` work. Numbers must use a decimal point (`3.14`, not `3,14`).

## Quiz settings
Attempts, calculator, shuffling, partial-credit default, showing correct answers and instructions are set on
the page and apply to every quiz in the zip. Everything can be changed in Canvas after import.

## Importing into Canvas
1. Course → **Settings** → **Import Course Content**.
2. Content Type **QTI .zip file**, choose the zip, select **All content**, then **Import**. If an
   **Import existing quizzes as New Quizzes** box is shown, tick it.
3. The quiz arrives unpublished under **Quizzes**. Check it in Build and Student View, then publish.

Try a new spreadsheet in a sandbox course first and answer a few questions in Student View to check scoring.

## Command line
`npm run package -- my-questions.xlsx` writes the same zip without opening the page. Options: an output file
name, `--title "Unit 3"`, `--images <folder>`, `--qti21`.

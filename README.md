# Doc to New Quiz

**Turn an assignment document into a Canvas New Quiz or question bank.**

Live site: **https://jordan77-lang.github.io/doc-to-new-quiz/**

Upload the assignment as a Word document. The site finds the objectives, steps, directions, questions, answer keys,
feedback, images and tables, checks them, and lets you fix anything flagged. It then gives you a QTI `.zip` that
Canvas imports as a **New Quiz** or a **question bank**.

Everything runs in your browser: no server, no account, and documents aren't uploaded anywhere.

## How to use it

1. **Get a .docx.** In Google Docs, accept or reject all suggestions and resolve comments, then
   **File → Download → Microsoft Word (.docx)**.
2. **Upload it** on the site. The import report lists anything to check (for example a missing `[*]`, a numeric
   margin wider than the rounding asked for, or images without alt text), with one-click fixes where possible.
   It also lists what was left out (instructor guides, draft notes, archived sections).
3. **Review and fix.** Every item shows what students will see, with an **Edit** button and the document text it
   came from.
4. **Choose what to export:**
   - **New Quiz**: everything, including instructions, objective and step text blocks, directions (as stimuli),
     questions and quiz settings.
   - **Question bank**: just the questions and the directions they belong to.
5. **Import into Canvas:** course **Settings → Import Course Content → QTI .zip file**. If you see
   *Import existing quizzes as New Quizzes*, make sure it's ticked.

How to write documents that convert cleanly: [docs/authoring-conventions.md](docs/authoring-conventions.md).
In short, Heading 2 for objectives and steps, Heading 4 for **Directions**, `[*]` after correct choices,
`[NUMERIC ANSWER]` blocks for numeric questions, and `Feedback:` before feedback.

You can also build a quiz from a spreadsheet (templates in [templates/](templates/README.md)) under
*Other ways to add questions*.

## What it supports

- **Question types:** multiple choice, multiple answer, true/false, numeric (exact ± margin, or a range),
  short answer, matching, essay, file upload.
- **New Quiz structure:** text blocks, and stimuli with their questions.
- **Content:** images (packed into the zip and copied into course files by Canvas), tables, links, partial
  credit, calculator, and quiz settings.
- **Not yet:** ordering, categorization and hotspot questions can't be imported through QTI. Build them in
  New Quizzes. A generic QTI 2.1 export is available under *Advanced* for experimenting.

## Development

```bash
npm install
npm run dev                         # serve the site at http://localhost:3001
npm test                            # unit tests, plus golden tests when real documents are present locally
npm run inspect -- path/to/doc.docx # show how a document converts, item by item
npm run package -- questions.xlsx   # build a zip from a spreadsheet on the command line
npm run templates                   # regenerate the spreadsheet templates from src/schema.js
```

| Path | What's there |
|---|---|
| `src/docx/` | .docx reading (mammoth) and the rules that turn a document into quiz items |
| `src/canvasQti.js` | Canvas QTI 1.2 package builder (New Quiz and question bank) |
| `src/parse.js` | Row model and validation shared by documents and spreadsheets |
| `src/main.js` | The page |
| `docs/` | Authoring guide and the design spec, including the planned optional AI review |
| `prompts/` | Instructions and JSON schemas for that AI review (not wired in yet) |

Real course documents and Canvas exports used for testing are kept out of the repository (see `.gitignore`).
Tests that use them skip when they aren't present.

## Licences

Uses [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2), [JSZip](https://stuk.github.io/jszip/) (MIT),
[SheetJS](https://sheetjs.com/) (Apache-2.0), [PapaParse](https://www.papaparse.com/) (MIT) and
[FileSaver.js](https://github.com/eligrey/FileSaver.js) (MIT), loaded from jsDelivr.

# Google Sheets setup

You can write questions in Google Sheets and download them as .xlsx or .csv for the builder.

## Quick way: import the template
1. In Google Sheets: **File → Import → Upload** and choose `question-template.xlsx` (or `blank-template.xlsx`).
2. Choose **Replace spreadsheet**. Keep the header row unchanged.
3. When you're done: **File → Download → Microsoft Excel (.xlsx)** and upload that file to the builder.
   The builder reads the sheet named **Questions** (or the first sheet).

## Validated sheet: run the setup script
`gsheet_setup_appsscript.js` builds a Questions sheet with:
- a dropdown for `type`;
- number-only `points` and `numeric_*` cells, with `numeric_max` ≥ `numeric_min`;
- matching pairs that must have both sides filled in;
- a hint on the `correct` column explaining what to type for each question type;
- a frozen, highlighted header row.

Steps:
1. Create a new Google Sheet, then **Extensions → Apps Script**.
2. Replace the editor contents with `gsheet_setup_appsscript.js`, save, and run **setupTemplate**. Authorize it when prompted.
3. Reload the sheet. A **Template Helper** menu appears, with *Setup template* and *Fill missing IDs*.

⚠️ *Setup template* clears the Questions sheet. Run it on a new sheet, not one that already has questions.

The script's header and type lists are generated from `src/schema.js` (`npm run templates`), so they always
match what the builder expects.

## Tips
- Put each question in one row. Line breaks inside a cell are fine.
- Separate lists with `;`, never commas (see README.md).
- Leave columns a question type doesn't use empty. The builder flags anything it ignores.
- The builder checks every row when you upload it and lists problems by row number, so there's no need to get everything right in the sheet first.

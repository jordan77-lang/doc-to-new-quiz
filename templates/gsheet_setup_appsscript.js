// Google Apps Script that builds a validated question sheet for the Canvas QTI Bank Builder.
// 1) In a new Google Sheet: Extensions > Apps Script, paste this file, save, then run setupTemplate().
// 2) Authorize when prompted. It creates a "Questions" sheet (header row, dropdowns, validations)
//    and a hidden "Config" sheet.
// 3) Reload the sheet to get the "Template Helper" menu (Setup template, Fill missing IDs).
// 4) When done: File > Download > Microsoft Excel (.xlsx) or CSV, then upload it to the builder.
//
// The header and type lists below are generated from src/schema.js. Don't edit them by hand; run
// `npm run templates` instead.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Template Helper')
    .addItem('Setup template (clears the Questions sheet)', 'setupTemplate')
    .addItem('Fill missing IDs', 'fillMissingIds')
    .addToUi();
}

function setupTemplate() {
  // BEGIN GENERATED (npm run templates)
  const headers = ["bank_name","id","type","parent_stimulus","title","question","image","image_alt","points","feedback_general","feedback_correct","feedback_incorrect","tags","choice_1","choice_2","choice_3","choice_4","choice_5","choice_6","choice_7","choice_8","choice_9","choice_10","choice_11","choice_12","correct","partial_credit","numeric_answer","numeric_tolerance","numeric_min","numeric_max","matching_left_1","matching_right_1","matching_left_2","matching_right_2","matching_left_3","matching_right_3","matching_left_4","matching_right_4","matching_left_5","matching_right_5","matching_left_6","matching_right_6","matching_distractors","upload_file_types","upload_max_files","correct_order","category_1","category_2","category_3","category_4","category_5","category_6","category_7","category_8","category_9","category_10","category_11","category_12"];
  const types = ["multiple_choice","multiple_answer","true_false","short_answer","numeric","matching","essay","file_upload","text_only","stimulus"];
  // END GENERATED

  const ss = SpreadsheetApp.getActive();
  const q = ss.getSheetByName('Questions') || ss.insertSheet('Questions');
  q.clear();
  q.getRange(1, 1, q.getMaxRows(), q.getMaxColumns()).clearDataValidations();
  if (q.getMaxColumns() < headers.length) q.insertColumnsAfter(q.getMaxColumns(), headers.length - q.getMaxColumns());
  q.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e4ecff');
  q.setFrozenRows(1);

  const cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
  cfg.clear();
  cfg.getRange(1, 1, types.length, 1).setValues(types.map((t) => [t]));
  ss.setNamedRange('TypeOptions', cfg.getRange(1, 1, types.length, 1));
  cfg.hideSheet();

  const lastRow = 1000;
  const col = (name) => headers.indexOf(name) + 1;
  const range = (name) => q.getRange(2, col(name), lastRow, 1);
  const letter = (name) => columnLetter(col(name));
  const rule = () => SpreadsheetApp.newDataValidation();

  range('type').setDataValidation(rule()
    .requireValueInRange(ss.getRangeByName('TypeOptions'), true)
    .setAllowInvalid(false)
    .setHelpText('Pick a question type')
    .build());

  range('points').setDataValidation(rule()
    .requireNumberGreaterThanOrEqualTo(0)
    .setAllowInvalid(false)
    .setHelpText('Points must be a number of 0 or more')
    .build());

  ['numeric_answer', 'numeric_tolerance', 'numeric_min'].forEach((name) => {
    range(name).setDataValidation(rule().requireNumberBetween(-1e12, 1e12).setAllowInvalid(false).setHelpText('Numbers only').build());
  });
  range('numeric_max').setDataValidation(rule()
    .requireFormulaSatisfied(`=OR(ISBLANK($${letter('numeric_min')}2),$${letter('numeric_max')}2>=$${letter('numeric_min')}2)`)
    .setAllowInvalid(false)
    .setHelpText('Must be a number ≥ numeric_min')
    .build());

  range('correct').setDataValidation(rule()
    .requireFormulaSatisfied('=TRUE')
    .setHelpText('multiple_choice: choice_2 · multiple_answer: choice_1;choice_3 · true_false: true/false · short_answer: answers separated by ;')
    .build());

  for (let i = 1; col(`matching_left_${i}`) > 0; i++) {
    const l = letter(`matching_left_${i}`);
    const r = letter(`matching_right_${i}`);
    const f = `=(LEN($${l}2)=0)=(LEN($${r}2)=0)`;
    [`matching_left_${i}`, `matching_right_${i}`].forEach((name) => {
      range(name).setDataValidation(rule().requireFormulaSatisfied(f).setHelpText('Fill both sides of the pair, or neither').build());
    });
  }

  q.autoResizeColumns(1, headers.length);
  q.setColumnWidth(col('question'), 360);
  SpreadsheetApp.flush();
}

function columnLetter(column) {
  let s = '';
  let n = column;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - rem) / 26);
  }
  return s;
}

// Fills empty id cells with q<rowNumber> for rows that have question text.
function fillMissingIds() {
  const q = SpreadsheetApp.getActive().getSheetByName('Questions');
  if (!q) return;
  const headers = q.getRange(1, 1, 1, q.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf('id') + 1;
  const questionCol = headers.indexOf('question') + 1;
  const lastRow = q.getLastRow();
  if (idCol < 1 || questionCol < 1 || lastRow < 2) return;
  const idRange = q.getRange(2, idCol, lastRow - 1, 1);
  const ids = idRange.getValues();
  const qs = q.getRange(2, questionCol, lastRow - 1, 1).getValues();
  let changed = false;
  for (let i = 0; i < ids.length; i++) {
    if (String(qs[i][0]).trim() && !String(ids[i][0]).trim()) {
      ids[i][0] = 'q' + (i + 2);
      changed = true;
    }
  }
  if (changed) idRange.setValues(ids);
}

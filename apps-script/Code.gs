const ALLOWED_SPREADSHEET_ID = '1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s';
const ALLOWED_SHEET_NAMES = [
  'Eunice Recipe Draft 20 - 2026-09-19',
  'Eunice Recipe Draft 100 - 2026-09-20',
  'V4_CANARY'
];

function doGet(e) {
  try {
    assertTarget_(e.parameter.spreadsheetId, e.parameter.sheetName);
    if (e.parameter.action !== 'list') throw new Error('Unsupported action.');
    const sheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID).getSheetByName(e.parameter.sheetName);
    if (!sheet) throw new Error('Target sheet not found.');
    const values = sheet.getDataRange().getDisplayValues();
    const headers = values.shift() || [];
    const recipes = values.filter(function(row) { return row[headers.indexOf('Content_ID')]; }).map(function(row) {
      return headers.reduce(function(item, header, index) { item[header] = row[index] || ''; return item; }, {});
    });
    return json_({ ok: true, headers: headers, recipes: recipes });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    assertTarget_(body.spreadsheetId, body.sheetName);
    if (body.action !== 'markPosted' || body.status !== 'Posted' || !body.contentId) throw new Error('Invalid status request.');
    const sheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID).getSheetByName(body.sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const idColumn = headers.indexOf('Content_ID') + 1;
    const statusColumn = headers.indexOf('Status') + 1;
    if (!idColumn || !statusColumn) throw new Error('Required headers not found.');
    const ids = sheet.getRange(2, idColumn, Math.max(sheet.getLastRow() - 1, 1), 1).getDisplayValues();
    const offset = ids.findIndex(function(row) { return row[0] === body.contentId; });
    if (offset < 0) throw new Error('Content_ID not found.');
    const rowNumber = offset + 2;
    sheet.getRange(rowNumber, statusColumn).setValue('Posted');
    SpreadsheetApp.flush();
    const verified = sheet.getRange(rowNumber, statusColumn).getDisplayValue();
    if (verified !== 'Posted') throw new Error('Status readback failed.');
    return json_({ ok: true, contentId: body.contentId, status: verified, rowNumber: rowNumber });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function assertTarget_(spreadsheetId, sheetName) {
  if (spreadsheetId !== ALLOWED_SPREADSHEET_ID || ALLOWED_SHEET_NAMES.indexOf(sheetName) < 0) throw new Error('Target is not allowed.');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

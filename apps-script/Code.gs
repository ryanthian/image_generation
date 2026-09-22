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
    if (body.action === 'appendV4Candidate') return appendV4Candidate_(body);
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

// This bridge deliberately does not compile content. Compilation belongs to
// the Production Console's shared V4 Template Registry. A deployment-only
// secret prevents callers from bypassing that compiler and writing direct rows.
function appendV4Candidate_(body) {
  if (body.sheetName !== 'V4_CANARY') throw new Error('V4 append target is not allowed.');
  const expectedToken = PropertiesService.getScriptProperties().getProperty('V4_APPEND_GATE_TOKEN');
  if (!expectedToken || body.gateToken !== expectedToken) throw new Error('V4 append gate token is invalid.');
  const expectedHeaders = ['Schema_Version','Content_ID','Title','Topic','Content_Type','Template_Type','Visual_Profile','Hook_Type','Hook_Text','Ready_To_Post_Caption','Content_Body','Source_References','Affiliate_Fit','Monetization_Angle','Asset_Plan_JSON','Status'];
  if (!Array.isArray(body.headers) || body.headers.join('|') !== expectedHeaders.join('|')) throw new Error('V4 append headers are invalid.');
  if (!Array.isArray(body.row) || body.row.length !== expectedHeaders.length) throw new Error('V4 append row is invalid.');
  if (typeof body.row[1] !== 'string' || !body.row[1].trim()) throw new Error('Content_ID must be an opaque non-empty string.');
  const sheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID).getSheetByName('V4_CANARY');
  const headers = sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0];
  if (headers.join('|') !== expectedHeaders.join('|')) throw new Error('V4_CANARY schema does not match the strict contract.');
  const idColumn = expectedHeaders.indexOf('Content_ID') + 1;
  const existingIds = sheet.getRange(2, idColumn, Math.max(sheet.getLastRow() - 1, 1), 1).getDisplayValues().flat();
  if (existingIds.indexOf(body.row[1]) >= 0) throw new Error('Duplicate Content_ID.');
  const rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, expectedHeaders.length).setValues([body.row]);
  SpreadsheetApp.flush();
  const verified = sheet.getRange(rowNumber, 1, 1, expectedHeaders.length).getDisplayValues()[0];
  if (verified[1] !== body.row[1]) throw new Error('V4 append readback failed.');
  return json_({ ok: true, contentId: verified[1], rowNumber: rowNumber });
}

function assertTarget_(spreadsheetId, sheetName) {
  if (spreadsheetId !== ALLOWED_SPREADSHEET_ID || ALLOWED_SHEET_NAMES.indexOf(sheetName) < 0) throw new Error('Target is not allowed.');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

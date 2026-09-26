const ALLOWED_SPREADSHEET_ID = '1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s';

function doGet(e) {
  // Bearer credentials are accepted only in POST bodies, never query strings.
  return json_({ ok: false, error: 'GET is disabled for the authenticated worksheet bridge.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    assertSpreadsheet_(body.spreadsheetId);
    assertBridgeToken_(body.bridgeToken);
    if (body.action === 'listSheets') return json_({ ok: true, sheets: listSheets_() });
    if (body.action === 'list') {
      const sheet = resolveSheet_(body.sheetId, body.sheetName);
      if (!sheet) throw new Error('Target worksheet not found.');
      const values = sheet.getDataRange().getDisplayValues();
      const headers = values.shift() || [];
      const idIndex = headers.indexOf('Content_ID');
      const records = idIndex < 0 ? [] : values.filter(function(row) {
        return row[idIndex] !== '';
      }).map(function(row) {
        return headers.reduce(function(item, header, index) {
          if (header) item[header] = row[index] || '';
          return item;
        }, {});
      });
      return json_({ ok: true, sheetId: sheet.getSheetId(), sheetName: sheet.getName(), headers: headers, records: records });
    }
    if (body.action === 'createSheet') return createSheet_(body);
    if (body.action === 'appendV4Candidate') return appendV4Candidate_(body);
    if (body.action !== 'markPosted' || body.status !== 'Posted' || typeof body.contentId !== 'string' || !body.contentId) {
      throw new Error('Invalid status request.');
    }
    assertAdminToken_(body.adminToken);
    const sheet = resolveSheet_(body.sheetId, body.sheetName);
    if (!sheet) throw new Error('Target worksheet not found.');
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
    return json_({ ok: true, sheetId: sheet.getSheetId(), contentId: body.contentId, status: verified, rowNumber: rowNumber });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function listSheets_() {
  const spreadsheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID);
  return spreadsheet.getSheets().map(function(sheet) {
    const lastColumn = sheet.getLastColumn();
    let headers = [];
    let inspectionError = '';
    try {
      if (lastColumn > 0) headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    } catch (error) {
      inspectionError = error.message;
    }
    return {
      sheetId: sheet.getSheetId(),
      title: sheet.getName(),
      rowCount: sheet.getLastRow(),
      columnCount: lastColumn,
      headers: headers,
      inspectionError: inspectionError
    };
  });
}

function createSheet_(body) {
  assertAdminToken_(body.adminToken);
  const title = String(body.sheetName || '').trim();
  const headers = body.headers;
  const invalidTitleCharacters = ['[', ']', ':', '*', '?', '\\', '/'];
  if (title.length < 3 || title.length > 90 || invalidTitleCharacters.some(function(character) { return title.indexOf(character) >= 0; })) {
    throw new Error('Worksheet name is invalid.');
  }
  if (isReservedSheetName_(title)) throw new Error('That worksheet name is reserved for system or lifecycle use.');
  if (!Array.isArray(headers) || headers.length < 2 || headers.some(function(value) { return typeof value !== 'string' || !value.trim(); })) {
    throw new Error('Template headers are invalid.');
  }
  if (new Set(headers).size !== headers.length) throw new Error('Template headers contain duplicates.');
  validateTemplateHeaders_(body.templateId, headers);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another worksheet creation is in progress; retry after it completes.');
  let created = null;
  try {
    const spreadsheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID);
    const duplicate = spreadsheet.getSheets().some(function(sheet) { return sheet.getName().toLocaleLowerCase() === title.toLocaleLowerCase(); });
    if (duplicate) throw new Error('A worksheet with this name already exists; no content was changed.');
    created = spreadsheet.insertSheet(title);
    const headerRange = created.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f4f3ef');
    headerRange.setWrap(true);
    created.setFrozenRows(1);
    const idColumn = headers.indexOf('Content_ID') + 1;
    if (idColumn > 0) created.getRange(1, idColumn, created.getMaxRows(), 1).setNumberFormat('@');
    const schemaVersionColumn = headers.indexOf('Schema_Version') + 1;
    if (body.templateId.indexOf('V4_') === 0 && schemaVersionColumn > 0) {
      const rule = SpreadsheetApp.newDataValidation().requireNumberEqualTo(4).setAllowInvalid(false).build();
      created.getRange(2, schemaVersionColumn, created.getMaxRows() - 1, 1).setDataValidation(rule);
    }
    SpreadsheetApp.flush();
    const verified = created.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (verified.join('\\u001f') !== headers.join('\\u001f')) throw new Error('Created worksheet header readback did not match the selected template.');
    return json_({ ok: true, sheetId: created.getSheetId(), title: created.getName(), templateId: body.templateId, headers: verified });
  } catch (error) {
    if (created) throw new Error('Worksheet ' + created.getName() + ' was created but could not be fully verified; it was preserved for recovery. ' + error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function validateTemplateHeaders_(templateId, headers) {
  const legacy = ['Content_ID','Draft_Title','Category','Ready_To_Post_Caption','Full_Recipe','Time_And_Servings','Source_References','Pattern_Notes','Image_1_Cover_Prompt','Image_2_Ingredients_Prompt','Image_3_Method_Prompt','Image_3_Step_1_Caption','Image_3_Step_2_Caption','Image_3_Step_3_Caption','Image_3_Step_4_Caption','Image_3_Step_5_Caption','Image_3_Step_6_Caption','Image_3_Final_Layout_Prompt','Image_4_Closeup_Prompt','Exact_Chinese_Overlay','Image_Consistency_And_Negatives','Quality_Check','Affiliate_Fit','Originality','Status'];
  const v4 = ['Schema_Version','Content_ID','Title','Topic','Content_Type','Template_Type','Visual_Profile','Hook_Type','Hook_Text','Ready_To_Post_Caption','Content_Body','Source_References','Affiliate_Fit','Monetization_Angle','Asset_Plan_JSON','Status'];
  const expected = templateId === 'LEGACY_RECIPE' ? legacy : /^V4_[A-Z0-9_]+$/.test(String(templateId || '')) ? v4 : null;
  if (!expected || expected.join('\u001f') !== headers.join('\u001f')) throw new Error('Template ID or headers do not match an approved Console worksheet contract.');
}

function assertBridgeToken_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('CONSOLE_BRIDGE_TOKEN');
  if (!expected || typeof provided !== 'string' || provided !== expected) throw new Error('Bridge authorization failed.');
}

function assertAdminToken_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('CONSOLE_ADMIN_GATE_TOKEN');
  if (!expected || typeof provided !== 'string' || provided !== expected) throw new Error('Write authorization failed.');
}

function isReservedSheetName_(title) {
  const normalized = String(title || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const reserved = ['DASHBOARD', 'SETTINGS', 'CONFIG', 'CONFIGURATION', 'LOOKUP', 'LOOKUPS', 'INSTRUCTIONS', 'SYSTEM', 'CONTENT LIBRARY', 'POSTING QUEUE', 'FAN PAGE SPLIT PLAN', 'V4_CANARY', 'V4_STAGING', 'V4_HOLD', 'PRODUCTION_SHEET_REGISTRY', 'PRODUCTION_PAGE_PROFILES'];
  return reserved.indexOf(normalized) >= 0 || normalized.indexOf('V4_CANARY_BACKUP_') === 0 || normalized.indexOf('V4_CANARY_BACKUP ') === 0 || normalized.indexOf('V4_STAGING_RECOVERY_') === 0 || normalized === 'COPY OF V4_CANARY';
}

// The compiler/validator stays in the Production Console. The private bridge
// token only prevents callers from bypassing that validated V4 append path.
function appendV4Candidate_(body) {
  if (body.sheetName !== 'V4_CANARY') throw new Error('V4 append target is not allowed.');
  const expectedToken = PropertiesService.getScriptProperties().getProperty('V4_APPEND_GATE_TOKEN');
  if (!expectedToken || body.gateToken !== expectedToken) throw new Error('V4 append gate token is invalid.');
  const expectedHeaders = ['Schema_Version','Content_ID','Title','Topic','Content_Type','Template_Type','Visual_Profile','Hook_Type','Hook_Text','Ready_To_Post_Caption','Content_Body','Source_References','Affiliate_Fit','Monetization_Angle','Asset_Plan_JSON','Status'];
  if (!Array.isArray(body.headers) || body.headers.join('|') !== expectedHeaders.join('|')) throw new Error('V4 append headers are invalid.');
  if (!Array.isArray(body.row) || body.row.length !== expectedHeaders.length) throw new Error('V4 append row is invalid.');
  if (typeof body.row[1] !== 'string' || !body.row[1].trim()) throw new Error('Content_ID must be an opaque non-empty string.');
  const sheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID).getSheetByName('V4_CANARY');
  if (!sheet) throw new Error('V4_CANARY worksheet not found.');
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

function resolveSheet_(sheetId, sheetName) {
  const spreadsheet = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID);
  if (sheetId !== undefined && sheetId !== null && String(sheetId) !== '') {
    const id = Number(sheetId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid sheetId.');
    return spreadsheet.getSheets().find(function(sheet) { return sheet.getSheetId() === id; }) || null;
  }
  return typeof sheetName === 'string' && sheetName ? spreadsheet.getSheetByName(sheetName) : null;
}

function assertSpreadsheet_(spreadsheetId) {
  if (spreadsheetId !== ALLOWED_SPREADSHEET_ID) throw new Error('Spreadsheet is not allowed.');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

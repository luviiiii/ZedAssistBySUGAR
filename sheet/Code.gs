/** ZED Assist - Google Sheet helper. Free: runs inside your own Google account.
 *  Setup: open the sheet > Extensions > Apps Script > paste this > set SECRET below >
 *  Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > copy the URL into ZED Assist settings. */
var SECRET = 'CHANGE-ME';          // put any long random text here and the same text in the extension settings
var SHEET_NAME = '';               // '' = first sheet

function sh_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.secret !== SECRET) return out_({ ok: false, error: 'wrong secret' });
    var sh = sh_();
    if (req.action === 'checkSerial') {
      // rows of the same month (col A date M/D/YYYY) that already hold this serial in col E
      var vals = sh.getDataRange().getValues(), hits = [];
      var ym = String(req.month); // YYYY-MM
      for (var i = 1; i < vals.length; i++) {
        var d = vals[i][0], s = String(vals[i][4]).trim();
        if (!s || s !== String(req.serial).trim()) continue;
        var dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt)) continue;
        var m = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2);
        if (m === ym) hits.push({ row: i + 1, zedId: vals[i][1], name: vals[i][2] });
      }
      return out_({ ok: true, duplicates: hits });
    }
    if (req.action === 'addRow') {
      // A Date, B ZED ID, C Name, D Phone, E FE serial, F Assessor, G Done by, H Email, I Remarks
      var r = req.row;
      sh.appendRow([r.date, r.zedId, r.name, r.phone || '', r.serial || '', r.assessor || '', r.doneBy || '', r.email || '', r.remarks || '']);
      return out_({ ok: true, row: sh.getLastRow() });
    }
    if (req.action === 'setSerial') {
      var vs = sh.getRange(1, 2, sh.getLastRow(), 1).getValues();
      for (var j = vs.length - 1; j >= 0; j--) if (String(vs[j][0]).trim() === String(req.zedId).trim()) { sh.getRange(j + 1, 5).setValue(req.serial); return out_({ ok: true, row: j + 1 }); }
      return out_({ ok: false, error: 'ZED ID row not found' });
    }
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}
function doGet() { return out_({ ok: true, hello: 'ZED Assist sheet helper is running' }); }

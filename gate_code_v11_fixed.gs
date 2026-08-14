// Chatbot ศูนย์ข้อมูล v12 — Dashboard Gate Code (sheet-first)
// ใช้ค่า WEB_ADMIN_KEY จากชีตตั้งค่าโดยตรงก่อน เพื่อกันค่า cache/getConfig เก่าทับรหัสจริง

const DASH_GATE_CONFIG_SPREADSHEET_ID = '166-AGSJrP4o9ltxCobd--mB6oObViDKdKELc9sipYJ4';
const DASH_GATE_CONFIG_SHEET = 'ตั้งค่า';
const DASH_GATE_CONFIG_KEY = 'WEB_ADMIN_KEY';

function _normalizeDashboardGateCodes_(value) {
  return String(value == null ? '' : value)
    .split(/[,;\n\r]+/)
    .map(function(s){ return String(s || '').trim(); })
    .filter(function(s){ return !!s; });
}

function _readDashboardGateCodesFromSheet_() {
  var ss = SpreadsheetApp.openById(DASH_GATE_CONFIG_SPREADSHEET_ID);
  var sh = ss.getSheetByName(DASH_GATE_CONFIG_SHEET);
  if (!sh) throw new Error('ไม่พบชีต "' + DASH_GATE_CONFIG_SHEET + '"');

  var lastRow = Math.max(sh.getLastRow(), 1);
  var values = sh.getRange(1, 1, lastRow, 2).getDisplayValues();

  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key === DASH_GATE_CONFIG_KEY) {
      return _normalizeDashboardGateCodes_(values[i][1]);
    }
  }
  return [];
}

function _getDashboardGateCodes_() {
  // 1) ยึดค่าจากชีตจริงก่อนเสมอ
  try {
    var sheetCodes = _readDashboardGateCodesFromSheet_();
    if (sheetCodes.length) return sheetCodes;
  } catch (sheetErr) {
    // ค่อย fallback ด้านล่าง
  }

  // 2) fallback ไป getConfig() เฉพาะเมื่ออ่านชีตโดยตรงไม่ได้/ไม่มีค่า
  try {
    if (typeof getConfig === 'function') {
      var fromConfig = getConfig(DASH_GATE_CONFIG_KEY);
      var configCodes = _normalizeDashboardGateCodes_(fromConfig);
      if (configCodes.length) return configCodes;
    }
  } catch (e) {}

  return [];
}

function verifyDashboardCode(code) {
  try {
    var input = String(code == null ? '' : code).trim();
    if (!input) return { ok: false, error: 'กรุณากรอกรหัสผ่าน' };

    var codes = _getDashboardGateCodes_();
    if (!codes.length) {
      return { ok: false, error: 'ยังไม่ได้ตั้งค่า WEB_ADMIN_KEY' };
    }

    return codes.indexOf(input) !== -1
      ? { ok: true }
      : { ok: false, error: 'รหัสไม่ถูกต้อง' };

  } catch (err) {
    return { ok: false, error: 'ตรวจสอบไม่ได้: ' + (err && err.message ? err.message : err) };
  }
}

function checkDashboardGate() {
  var codes = _getDashboardGateCodes_();
  var result = {
    ok: codes.length > 0,
    codeCount: codes.length,
    masked: codes.map(function(c){ return c.length <= 2 ? '**' : c.substring(0,1) + '***' + c.substring(c.length-1); }),
    message: codes.length ? 'Dashboard Gate พร้อมใช้งาน' : 'ยังไม่พบ WEB_ADMIN_KEY'
  };
  Logger.log(JSON.stringify(result));
  return result;
}

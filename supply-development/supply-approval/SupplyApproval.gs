/** Supply approval 1.6.1. Helpers only; no public maintenance routes. */
function isSupplyHead_(user) { return !!user && user.role === 'SUPPLY_HEAD'; }
function isSupplyOfficer_(user) { return !!user && (user.role === 'OFFICER' || isSupplyHead_(user)); }
function supplyApprovalEnabled_() { return !TRAINING_SCOPE_ || cfgBool_('approval_enabled', false); }
function needsSupplyApproval_(req) {
  return supplyApprovalEnabled_() && isOpen_(req.status) &&
    (!req.approved_at || req.approval_role_snapshot !== 'SUPPLY_HEAD');
}
function supplyRequestStatus_(req) { return needsSupplyApproval_(req) ? ST.PA : req.status; }
function requireSupplyApproval_(req) {
  if (needsSupplyApproval_(req)) throw appErr_('APPROVAL_REQUIRED', 'รอหัวหน้าเจ้าหน้าที่พัสดุอนุมัติจำนวนก่อนจัดเตรียมหรือจ่ายวัสดุ');
}
function checkApprovalRevision_(req, data) {
  if (data.expected_updated_at && tsMs_(data.expected_updated_at) !== tsMs_(req.updated_at)) {
    throw appErr_('STALE_REQUEST', 'คำขอเปลี่ยนแล้ว กรุณาโหลดรายการล่าสุดก่อนอนุมัติ');
  }
}
function approvalSnapshot_(user, ts) {
  return { approved_by: user.code, approved_at: ts, approved_name_snapshot: user.name,
    approved_position_snapshot: user.position || '', approval_role_snapshot: user.role };
}
function supplyTotals_(items, key) {
  const groups = {};
  items.forEach(function (item) {
    const raw = item[key];
    if (blank_(raw)) return;
    const unit = String(item.unit_name_snapshot || item.unit_name || 'หน่วย');
    groups[unit] = (groups[unit] || 0) + num_(raw) - (key === 'qty_issued' ? num_(item.qty_returned) : 0);
  });
  return Object.keys(groups).map(function (unit) { return { unit: unit, qty: groups[unit] }; });
}
/** Run from the project editor before publishing. Appends approval metadata only. */
function installSupplyApprovalSchema() {
  TRAINING_SCOPE_ = null; resetDb_();
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    ensureSheet_(db_(), 'REQUESTS', SCHEMA.REQUESTS);
    SpreadsheetApp.flush();
    Logger.log('เพิ่มช่องเก็บผู้อนุมัติแล้ว ไม่แก้จำนวนคงเหลือ ยอดจอง หรือล็อตต้นทุน');
  } finally { lock.releaseLock(); resetDb_(); }
}
/** Owner-only helper. Not routed by doPost. Caller must explicitly select the account. */
function assignSupplyHead(userCode) {
  if (!userCode) throw new Error('ต้องระบุรหัสบัญชีหัวหน้าเจ้าหน้าที่พัสดุ');
  TRAINING_SCOPE_ = null; resetDb_();
  const current = find_('USERS', userCode);
  if (!current) throw new Error('ไม่พบบัญชีในระบบวัสดุ');
  const data = { user_code: userCode, role: 'SUPPLY_HEAD', dept_id: current.dept_id, position: current.position };
  const ctx = { user: { code: 'EDITOR_OWNER', name: 'เจ้าของโครงการ', role: 'ADMIN' },
    uuid: Utilities.getUuid(), action: 'saveAccess', real_epoch: realTrialEpoch_() };
  return runOp_(ctx, 'saveAccess', data, function (writer) { return apiSaveAccess_(ctx, data, writer); });
}

#!/usr/bin/env python3
"""Apply a checked patch to the actual API 1.5.2 source, never to an old export."""
import hashlib
import re
import sys
from pathlib import Path

def integrate(source):
    if "const API_VERSION = '1.5.2';" not in source:
        raise ValueError('Expected actual API 1.5.2 source; no output written')
    def change(old, new, count=1):
        nonlocal source
        found = source.count(old)
        if found != count:
            raise ValueError(f'Expected {count} occurrences, found {found}: {old[:100]}')
        source = source.replace(old, new)
    def function(name, body):
        nonlocal source
        pattern = r'^function ' + re.escape(name) + r'\([^\n]*\{\n.*?^\}'
        source, count = re.subn(pattern, lambda _: body.strip(), source, count=1, flags=re.M | re.S)
        if count != 1:
            raise ValueError('Missing function ' + name)

    change("const API_VERSION = '1.5.2';", "const API_VERSION = '1.6.1';")
    change("const ROLES = ['NONE', 'USER', 'HEAD', 'OFFICER', 'ADMIN'];", "const ROLES = ['NONE', 'USER', 'HEAD', 'OFFICER', 'SUPPLY_HEAD', 'ADMIN'];")
    change("HEAD: 'หัวหน้าส่วน', OFFICER: 'เจ้าหน้าที่พัสดุ'", "HEAD: 'หัวหน้าส่วน', SUPPLY_HEAD: 'หัวหน้าเจ้าหน้าที่พัสดุ', OFFICER: 'เจ้าหน้าที่พัสดุ'")
    change("(u.role === 'OFFICER' || u.role === 'ADMIN')", "(isSupplyOfficer_(u) || u.role === 'ADMIN')")
    change("if (role === 'HEAD' && !dept)", "if ((role === 'HEAD' || role === 'SUPPLY_HEAD') && !dept)")
    change("const O = ['OFFICER'], OA = ['OFFICER', 'ADMIN'], A = ['ADMIN'], HO = ['HEAD', 'OFFICER'];", "const O = ['OFFICER', 'SUPPLY_HEAD'], OA = ['OFFICER', 'SUPPLY_HEAD', 'ADMIN'], A = ['ADMIN'], HO = ['SUPPLY_HEAD'];")
    change("me.role === 'OFFICER' || me.role === 'ADMIN'", "isSupplyOfficer_(me) || me.role === 'ADMIN'", 4)
    change("if (!own && me.role !== 'OFFICER')", "if (!own && !isSupplyOfficer_(me))")
    change("if (me.role === 'HEAD' || me.role === 'OFFICER')", "if (isSupplyHead_(me))")
    change("return r.status === ST.PA && (me.role === 'OFFICER' || r.dept_id === me.dept_id);", "return needsSupplyApproval_(r);", 2)
    change("return r.status === ST.PA || r.status === ST.PP;", "return supplyRequestStatus_(r) === ST.PA || supplyRequestStatus_(r) === ST.PP;", 2)
    change("myReady: mine.filter(function (r) { return r.status === ST.RD; }).length", "myReady: mine.filter(function (r) { return supplyRequestStatus_(r) === ST.RD; }).length")
    change("counts.queuePrep = reqs.filter(function (r) { return r.status === ST.PP; }).length;", "counts.queuePrep = reqs.filter(function (r) { return supplyRequestStatus_(r) === ST.PP; }).length;\n    counts.pendingApproval = reqs.filter(needsSupplyApproval_).length;")
    change("counts.queueReady = reqs.filter(function (r) { return r.status === ST.RD; }).length;", "counts.queueReady = reqs.filter(function (r) { return supplyRequestStatus_(r) === ST.RD; }).length;")
    change("approval_enabled: cfgBool_('approval_enabled', false),", "approval_enabled: supplyApprovalEnabled_(),\n      supply_approval_version: 1,")
    change("const status = cfgBool_('approval_enabled', false) ? ST.PA : ST.PP;", "const status = supplyApprovalEnabled_() ? ST.PA : ST.PP;")
    change("const sess = { code: code, name: name, role: role, dept_id:", "const sess = { code: code, name: name, first_name: ph.first, last_name: ph.last, role: role, dept_id:")
    change("s.name = (ph.first + ' ' + ph.last).trim();", "s.name = (ph.first + ' ' + ph.last).trim();\n    s.first_name = ph.first; s.last_name = ph.last;")
    change("out.push({ code: u.code, name: full, dept:", "out.push({ code: u.code, name: full, first_name: u.first, last_name: u.last, dept:")
    change("return { code: s.code, name: s.name, role: s.role, role_th:", "return { code: s.code, name: s.name, first_name: s.first_name || '', last_name: s.last_name || '', role: s.role, role_th:")
    change("'edit_count', 'edited_by', 'edited_name', 'edited_at', 'edit_reason'],", "'edit_count', 'edited_by', 'edited_name', 'edited_at', 'edit_reason',\n                   'approved_name_snapshot', 'approved_position_snapshot', 'approval_role_snapshot'],")
    change("let sh = ss.getSheetByName(name);\n  if (!sh) sh = ss.insertSheet(name);", "let sh = ss.getSheetByName(name);\n  if (!sh) sh = ss.insertSheet(name);\n  if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());")
    change("'เปิดขั้นอนุมัติโดยหัวหน้าส่วนในระบบ'", "'อนุมัติเบิกจ่ายโดยหัวหน้าเจ้าหน้าที่พัสดุ'", 2)
    change("if (k === 'approval_enabled' && !v && T_('REQUESTS')", "if (k === 'approval_enabled' && !v && !TRAINING_SCOPE_) throw appErr_('APPROVAL_REQUIRED', 'ระบบจริงต้องให้หัวหน้าเจ้าหน้าที่พัสดุอนุมัติก่อนจ่าย');\n    if (k === 'approval_enabled' && !v && T_('REQUESTS')")
    function('canApprove_', '''function canApprove_(me, req) {
  if (!isSupplyHead_(me)) throw appErr_('FORBIDDEN', 'เฉพาะหัวหน้าเจ้าหน้าที่พัสดุเท่านั้นที่อนุมัติเบิกจ่ายได้');
  if (!supplyApprovalEnabled_()) throw appErr_('APPROVAL_OFF', 'ไม่ได้เปิดขั้นอนุมัติในพื้นที่ฝึก');
  if (req.status !== ST.PA && !needsSupplyApproval_(req)) throw appErr_('BAD_STATUS', 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
}''')
    function('apiApproveRequest_', '''function apiApproveRequest_(ctx, d, w) {
  const me = ctx.user, req = mustReq_(d.req_id);
  canApprove_(me, req); checkApprovalRevision_(req, d);
  const items = itemsOf_(req.req_id), known = {}, want = {};
  items.forEach(function (it) { known[it.item_id] = true; });
  (Array.isArray(d.items) ? d.items : []).forEach(function (x) {
    if (!known[x.item_id] || Object.prototype.hasOwnProperty.call(want, x.item_id)) throw appErr_('BAD_QTY', 'รายการอนุมัติไม่ตรงกับใบเบิก');
    if (x.qty_approved === undefined || x.qty_approved === null || x.qty_approved === '') throw appErr_('BAD_QTY', 'กรุณาระบุจำนวนอนุมัติ');
    want[x.item_id] = x.qty_approved;
  });
  let sum = 0;
  const plan = items.map(function (it) {
    const q = want[it.item_id] === undefined ? num_(it.qty_req) : intQty_(want[it.item_id]);
    if (!(q >= 0) || q > num_(it.qty_req)) throw appErr_('BAD_QTY', 'จำนวนอนุมัติของ ' + it.mat_name_snapshot + ' ต้องอยู่ระหว่าง 0 ถึง ' + it.qty_req);
    const m = find_('MATERIALS', it.mat_id);
    if (!m) throw appErr_('NOT_FOUND', 'ไม่พบวัสดุในคลัง');
    const diff = q - reserveQty_(it);
    if (diff > 0 && diff > avail_(m)) throw appErr_('NOT_ENOUGH_STOCK', m.name + ' มีของพร้อมเบิกไม่พอสำหรับจำนวนอนุมัติ กรุณาลดจำนวน');
    sum += q;
    return { it: it, m: m, qty: q, diff: diff };
  });
  if (!sum) throw appErr_('ALL_ZERO', 'อนุมัติเป็น 0 ทุกรายการ ให้ใช้ไม่อนุมัติพร้อมเหตุผล');
  const ts = now_();
  plan.forEach(function (p) {
    w.update('MATERIALS', p.m, { reserved: Math.max(0, num_(p.m.reserved) + p.diff), updated_at: ts });
    w.update('REQUEST_ITEMS', p.it, { qty_approved: p.qty, qty_ready: '' });
    w.touch('mats', p.it.mat_id);
  });
  w.update('REQUESTS', req, Object.assign({ status: ST.PP, ready_by: '', ready_at: '', updated_at: ts }, approvalSnapshot_(me, ts)));
  w.touch('docs', req.req_id);
  w.audit('APPROVE', 'REQUESTS', req.req_id, { req_no: req.req_no, name: me.name, position: me.position || '', role: me.role,
    items: plan.map(function (p) { return { item_id: p.it.item_id, requested: p.it.qty_req, approved: p.qty }; }) });
  return { req_id: req.req_id, status: ST.PP, approved_by_name: me.name, approved_at: ts };
}''')
    change("canApprove_(me, req);\n  const reason =", "canApprove_(me, req);\n  checkApprovalRevision_(req, d);\n  const reason =")
    change("{ status: ST.RJ, approved_by: me.code, approved_at: now_(), reason: reason, updated_at: now_() }", "Object.assign({ status: ST.RJ, reason: reason, updated_at: now_() }, approvalSnapshot_(me, now_()))")
    for name in ['apiPrepareRequest_', 'apiIssueRequest_']:
        old = 'function ' + name + '(ctx, d, w) {\n  const me = ctx.user;\n  const req = mustReq_(d.req_id);'
        change(old, old + '\n  requireSupplyApproval_(req);')
    change("const max = num_(it.qty_req);", "const max = reserveQty_(it);")
    change("status: r.status, status_th: ST_TH[r.status] || r.status, purpose:", "status: supplyRequestStatus_(r), status_th: ST_TH[supplyRequestStatus_(r)] || r.status, purpose:")
    change("approved_at: r.approved_at, approved_by_name: userName_(r.approved_by), ready_at: r.ready_at,", "approved_at: r.approved_at, approved_by_name: r.approved_name_snapshot || userName_(r.approved_by),\n    approved_position: r.approved_position_snapshot || '', approval_valid: r.approval_role_snapshot === 'SUPPLY_HEAD' && !!r.approved_at && r.status !== ST.RJ,\n    approval_required: needsSupplyApproval_(r), updated_at: r.updated_at, ready_at: r.ready_at,")
    change("o.items = items.map(function (i) {", "o.totals = { requested: supplyTotals_(items, 'qty_req'), approved: supplyTotals_(items, 'qty_approved'), issued: supplyTotals_(items, 'qty_issued') };\n    o.items = items.map(function (i) {")
    change("function apiApprovals_(ctx) {\n  const me = ctx.user;", "function apiApprovals_(ctx) {\n  const me = ctx.user;\n  if (!isSupplyHead_(me)) throw appErr_('FORBIDDEN', 'เฉพาะหัวหน้าเจ้าหน้าที่พัสดุเท่านั้นที่อนุมัติเบิกจ่ายได้');")
    change("byStatus[r.status] = (byStatus[r.status] || 0) + 1;", "const visibleStatus = supplyRequestStatus_(r);\n    byStatus[visibleStatus] = (byStatus[visibleStatus] || 0) + 1;")
    change("['ADMIN','OFFICER'].indexOf(role)", "['ADMIN','OFFICER','SUPPLY_HEAD'].indexOf(role)", 2)
    source += '\n\n// SOURCE: SupplyApproval.gs\n' + Path(__file__).with_name('SupplyApproval.gs').read_text()
    return source

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: integrate.py actual-current-Code.gs patched-Code.gs')
    original = Path(sys.argv[1]).read_text()
    output = integrate(original)
    Path(sys.argv[2]).write_text(output)
    print('Patched API 1.6.1; baseline SHA256 ' + hashlib.sha256(original.encode()).hexdigest())

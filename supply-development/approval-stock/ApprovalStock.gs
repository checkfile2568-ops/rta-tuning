/** Quantities for the supply-head approval view. No stock or schema writes. */
function approvalStock_(it) {
  const m = find_('MATERIALS', it.mat_id);
  if (!m) return null;
  const balance = num_(m.balance), reserved = num_(m.reserved), own = reserveQty_(it);
  const valid = balance >= 0 && reserved >= 0 && own >= 0 && reserved >= own;
  const other = Math.max(0, reserved - own);
  return { balance: balance, reserved_other: other, reserved_this: own,
    available_for_request: valid ? Math.max(0, balance - other) : null,
    available_new: valid ? Math.max(0, balance - reserved) : null, valid: valid };
}

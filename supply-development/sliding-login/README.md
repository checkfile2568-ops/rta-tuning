# Supply frontend 1.4.0

Requested changes: a persistent illustration panel slides from left to right when an account is chosen and the PIN form slides left. Changing the name reverses the same panels. Mobile stacks the image and form in the opposite order with reduced movement; reduced-motion preference disables transitions. Existing name search, central PIN verification, session expiry, forced PIN-change and account roles remain.

Login and application headers use ระบบบริหารวัสดุสำนักงาน / ศาลจังหวัดลพบุรี. Login subtitle: บริหารวัสดุอย่างเป็นระบบ สนับสนุนงานอย่างมีประสิทธิภาพ. New decorative office-supply hero has no identity or official emblem. Loading fits the PIN stage, including reauthentication, with no numerical progress claim.

Opening import retains its column descriptions, .xlsx/.xls/.csv parsing, pasted TSV, per-item entry, preview, source acknowledgement and confirmed write. Added permanent pristine XLSX/UTF-8 CSV originals with ten identical headers, plus a second instructions sheet in XLSX. Existing generated example workbook remains available and explicitly marked for deletion of its sample row.

Officer home renames the queue to คิวคำขอเบิกพัสดุ, gives preparation/ready/reorder/approval cards individual colors and shows a doughnut of current outstanding request counts. Reorder material counts are not mixed with request counts. Zero queues show an honest empty state. Chart download failure leaves the readable numeric legend.

Validation before publication: 23 Node/DOM tests across login, search, training/real-workspace isolation and guarded reset controls passed. Static JavaScript syntax and git whitespace checks passed. XLSX and CSV first-row headers match with no sample rows. Tests use synthetic accounts and do not mutate stock. No Apps Script, API address, role, PIN or database content changed.

Run tests using the linkedom dependency from supply-development/training/package.json, or set LINKEDOM_PATH to its module path:

`node --test supply-development/sliding-login/ui.test.cjs supply-development/training/tests/login-search.test.cjs supply-development/training/tests/frontend.test.cjs supply-development/real-trial/tests/frontend.test.cjs supply-development/ui-refresh/ui.test.cjs`

Rollback frontend using the preceding GitHub commit and bump cache version; do not restore inventory data for this visual-only release.

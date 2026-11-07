# Supply 1.3.1: requested menu, catalog and login corrections

- User-menu modal uses an independent two-column grid, 100px minimum tile height, 30px icons, full-width section labels and positioned count badges. Sidebar and bottom navigation destinations/permissions remain unchanged.
- Name-entry screen uses a derived inventory illustration with real HTML titles and live account search. PIN entry keeps the existing option-2 glass/keypad/loading UI. Narrow-screen and landscape rules are included.
- Active real-round banner text is exactly “ข้อมูลตัวอย่าง”. Backend round/epoch/reset controls are unchanged.
- Removed INIT_MAT-001 through INIT_MAT-005 from the active inventory database and the current round’s zero baseline. All five were zero balance/reserved/value with no dependent material-unit, receipt, request, return, opening, adjustment, lot or ledger references in the inspected data. Cleared only A2:U6 contents without shifting other rows. Full Drive copies of both files were retained before the change. The 10 RT sample materials and existing trial transactions remain. Reset now returns an empty catalog rather than reintroducing the five rows.
- Catalog version was refreshed through the existing guarded saveMaterial handler with unchanged sample metadata; inventory quantities were not edited by this refresh. Readback through the live catalog API returned exactly 10 RT materials and reconciliation passed.

Validation: Node syntax checks; 3 VM runtime tests for separate name/PIN frames, unchanged role destinations/counts and exact banner text; scoped CSS checks. GitHub Pages deployment succeeded. Production browser loaded 1.3.1 scripts and illustration; login screenshot inspected. An authenticated mobile visual check of the menu was not performed.

Run: `node --test supply-development/ui-refresh/ui.test.cjs`

Rollback: revert frontend commit for UI only. Data restoration uses the retained Drive copies; do not replace newer stock or requisition data with a full older database. Restore only the five material rows after checking zero quantities and no conflicting IDs.

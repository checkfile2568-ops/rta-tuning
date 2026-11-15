# Approval stock quantities and time greetings

Web 1.10.0 / API 1.6.2. Baseline: web 1.9.2 commit 9218af96fd28429dd2c7e3ab81ea7317de89e1dd; API 1.6.1 deployment version 10.

Only two changes:

- Supply-head approval items show physical balance, quantities reserved for other requests, and quantities available to this request. Its own reservation is included, not deducted a second time. Approval retains/reduces the existing reservation; physical balance and FIFO ledger are deducted only on issue. Cancelling releases the reservation through the existing workflow.
- Welcome greetings and existing 3D art share one Asia/Bangkok clock: morning 05:00–11:59, afternoon 12:00–17:59, night 18:00–04:59. Open pages update them every 30 seconds and when made visible.

The approval page refreshes quantities every 30 seconds without replacing entered quantities. Invalid amounts and changed requests are disabled. Approval rechecks current availability inside the existing operation lock. Existing UUID retry and audit behavior are preserved. Additional stock fields are returned only from the existing supply-head-only approvals route. No schema, permission, catalog, existing stock, or historical record migration is performed.

`integrate.py` upgrades an exact-pattern actual 1.6.1 source. Full private project source is intentionally excluded from this public repository. Save the output to the existing Apps Script project and update the existing deployment version without changing URL or sharing. No setup/demo/reset or stock transactions are run during deployment.

Validation: 34 simulated backend/frontend/regression cases, including own vs other reservations, next-request quantities, cancellation, FIFO issue without a second deduction, stale quantities, preserved edits, unknown stock, duplicate/uncertain writes, and Bangkok greeting boundaries. Tests run against the integrated actual source in an in-memory Apps Script mock.

```sh
python3 supply-development/approval-stock/integrate.py /private/current-Code.gs /private/test-gas/Code.gs
GAS_TEST_DIR=/private/test-gas NODE_PATH=/path/to/test-dependencies/node_modules node --test supply-development/supply-approval/tests/*.test.cjs supply-development/audit-bento/tests/regression.test.cjs
```

Rollback: redeploy Apps Script version 10 and restore the scoped frontend files from the baseline commit. Preserve production data; no database restore is needed for this upgrade.

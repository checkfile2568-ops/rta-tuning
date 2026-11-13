# Supply frontend 1.8.3 — scoped audit fixes and responsive Bento layout

Changes apply only to `supply/` and its related development tests. No Apps Script, database, PIN, role or API URL changes.

## Behavior

- Receiving and opening imports persist an immutable pending payload and UUID under the signed-in account and workspace generation. A lost response, reload or double submission reuses the original UUID. A different payload is blocked until the prior outcome is resolved. A known first-attempt validation rejection permits correction; an uncertain outcome stays pending. Failed persistence blocks the write before network access. Success is distinguished from a subsequent catalog-refresh failure.
- Recovery restores the original form and locks edits until the user explicitly retries the original operation. Logout warns about unresolved stock writes and clears user-specific data in all generations; late network responses cannot restore cleared data after the token is removed.
- An unrecognized purchase unit has no selected fallback. Import Apply remains disabled, including its handler guard, until the operator explicitly chooses a supported unit. The preview shows base quantity and total, and rejects non-finite values or fractional base units.
- Full-detail Excel export requires the loaded history to match the largest available count (`history_total`, issue-line KPI, summary issue counts). A truncated response offers a clearly labelled summary-only workbook. The existing API has no verified pagination/export-all contract available to this change: this release prevents incomplete exports but does **not** add server-side full-history export.
- Home and statistics use a scoped Bento stylesheet inspired by the supplied responsive-grid video. Card grids use the content container width: below 480px = 1 column, 480px = 2, 768px = 3, 1024px = 4. Wide chart panels span two columns on large content areas. Admin, officer and requester destinations retain existing permissions. The login and print templates retain their design.
- Versioned asset URLs and the service-worker cache advance to 1.8.3.

## Checks

```sh
npm install --prefix supply-development/audit-bento --ignore-scripts
NODE_PATH="$PWD/supply-development/audit-bento/node_modules" node --test \
  supply-development/audit-bento/tests/*.test.cjs \
  supply-development/sliding-login/ui.test.cjs \
  supply-development/training/tests/login-search.test.cjs \
  supply-development/training/tests/frontend.test.cjs \
  supply-development/real-trial/tests/frontend.test.cjs \
  supply-development/ui-refresh/ui.test.cjs
```

The tests use synthetic data only. `preview.html` and `preview-frame.html` are browser fixtures with an explicit synthetic-data label and a disabled write implementation; they do not load production `config.js` or call the production API. The fixtures share actual application JS/CSS for visual checks at 390/740/1100/1600px.

## Remaining server work

Read the actual deployed Apps Script 1.5.2 source, deployment configuration and operation-retention rules before changing backend behavior. The accessible deployment-source document is version 1.1.3 and must not replace current source. Implement authorized full-history export/pagination on the current backend, then verify record counts and permissions above 500 and 2000 rows. FIFO, simultaneous stock writes, report locking and restore require separate live or isolated-backend checks and are not certified by these frontend tests.

## Rollback

Baseline source commit: `7ce3b3aaa7356877ebe7ffc31ec043ca767a0794`. Revert only this release's frontend changes and advance asset/cache URLs for a rollback publication so cached clients receive the restored files. No stock-data restoration or database migration is needed. Do not reuse a cache label for different file contents.

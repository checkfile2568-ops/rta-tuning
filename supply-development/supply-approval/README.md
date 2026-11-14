# Supply approval 1.6.1 / web 1.9.1

Scoped update: supply-head workspace and approval, per-document reduced quantities, issued quantity separation, immutable approval actor/time on slips, officer-equivalent operational permissions, two-line names, Bangkok time artwork, pending counts, pale cards and inventory login wording.

Only `SUPPLY_HEAD` can approve across departments. `OFFICER` prepares and issues within approved quantities; approval never deducts inventory. Legacy open requests without a supply-head approval record appear as awaiting approval without rewriting their stored stock/reservations. Existing issued documents retain their quantities.

The full current Apps Script source is private and is deliberately excluded from this public repository. `integrate.py` accepts the verified API 1.5.2 concatenated source and refuses mismatched replacements; it appends helpers and three metadata columns to REQUESTS. Existing materials, FIFO lots and ledger are preserved.

## Validation

```sh
python3 integrate.py /private/current-Code.gs /private/test-gas/Code.gs
GAS_TEST_DIR=/private/test-gas NODE_PATH=/path/to/test-dependencies/node_modules node --test tests/*.test.cjs ../audit-bento/tests/regression.test.cjs
```

Test dependencies: linkedom 0.18.12 and fake-indexeddb 6.0.1. All backend tests run against the current patched source in an in-memory Google Apps Script mock. They are not transactions on production data. `preview.html` and `preview-frame.html` contain only synthetic identities and read-only API fixtures.

## Deployment and recovery

Back up the real spreadsheet and existing source first. Save the integrated source into the existing project; run only `installSupplyApprovalSchema`, never setup/demo/reset. Update the existing deployment version and preserve the existing URL and sharing settings. Publish the scoped frontend files. Explicitly designate the supply-head account through the access-management workflow; the new role is never inferred from a person's name. Existing officer roles remain unchanged.

Rollback baseline: public main commit 97d3be9184eda5622725b385080deb328261bc7e; Apps Script deployment version 8 (API 1.5.2). The three appended approval metadata columns are backward compatible. Preserve live records; do not restore an old database over subsequent legitimate work. If rolling back after the new role is assigned, restore its previous access role through the same audited access-management workflow.

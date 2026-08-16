# Upload Sequence Fix Audit — 2026-08-16

Status: FIXED / DEVICE END-TO-END RETEST REQUIRED

## Production failure observed
At 2026-08-16 10:28 ICT:
- `mms-media-api` returned HTTP 500 during `create-media-set`.
- PostgreSQL logged: `mms_media_sets_retention_mode_check` violation.
- UI contract sends only `auto_24h` or `immediate`.
- Database still allowed legacy values `auto_24h`, `manual`, `save_device`.
- Because the thrown PostgREST error was an object, the UI displayed `[object Object]` as the technical detail.
- No Part upload had started yet; the failure occurred before Part 1 registration.

## Fix applied
1. Database retention contracts aligned to exactly:
   - `auto_24h`
   - `immediate`
   on both `mms_media_sets` and `media_files`.
2. Verified both values can be inserted successfully in a rollback test transaction.
3. Verified no unfinished media sets remained before the retest.
4. Confirmed client code already uploads sequentially with:
   `for (...) { await standardUpload(part, ...) }`
   therefore Part N+1 starts only after Part N finishes its Storage verification and completion calls.
5. Added database trigger `trg_mms_enforce_media_part_sequence` so ordering is enforced server-side too:
   - Part 2 is rejected until Part 1 is `ready`.
   - Part 3 is rejected until Part 2 is `ready`, etc.
   - duplicate active upload for the same Part is rejected.

## Canonical large-file behavior
- File > 50 MB is split locally.
- Target Part size: ~40 MB.
- Maximum Part size accepted by the current workflow: 45 MB.
- Upload order is strict and serial: `Part 1 → confirm ready → Part 2 → ... → final Part`.
- Later Parts are never intentionally started in parallel.
- Overall progress is based on completed Parts; each Part is registered as a separate `media_files` row linked by `media_set_id` and `segment_index`.

## Related migrations
- `20260816_align_media_retention_modes.sql`
- `20260816_enforce_sequential_media_part_uploads.sql`

## Retest required on Android/tablet
Use a >50 MB video and confirm:
1. Media set is created without HTTP 500.
2. Split plan appears.
3. UI shows Part 1 first.
4. Part 2 does not start until Part 1 is confirmed ready.
5. Repeat until all Parts complete.
6. Final media set state changes to upload-complete/analyzing.
7. If one Part fails, no later Part begins.

Change impact checked: DB constraints, Media API contract, Media Library sequential loop, upload state, retention policy, storage relationship, audit.

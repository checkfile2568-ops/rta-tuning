# Upload Sequence Fix Audit — 2026-08-16

Status: IN PROGRESS

Observed production error at 2026-08-16 10:28 ICT:
- `mms-media-api` returned HTTP 500 during `create-media-set`.
- PostgreSQL error: `mms_media_sets_retention_mode_check` rejected the UI value.
- UI sends `auto_24h` or `immediate` while database constraint still allowed `auto_24h`, `manual`, `save_device`.
- The UI serialized a non-Error detail as `[object Object]`.

Required behavior:
- For files > 50 MB, split locally into <=45 MB parts (target ~40 MB).
- Upload strictly sequentially: Part 1 must be confirmed `ready` before Part 2 starts, etc.
- Backend must also enforce segment order; client-only ordering is not sufficient.
- UI must show current part, per-part state, and overall progress based on completed parts.
- On part failure, stop immediately and preserve already completed parts for controlled retry/cleanup; never start later parts.

Change impact: DB constraint, Media API, splitter, Media Library UI, upload/audit state.

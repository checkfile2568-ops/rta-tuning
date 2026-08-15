# MMs Pro — System Audit (Requirements 3–8)

Date: 2026-08-15

## Live card metrics
Main `media.html` requests `mms-pro-api/dashboard` after login and approximately every 15 seconds.

- `video`: queued + processing jobs in module `video`
- `cctv`: CCTV events created today (Asia/Bangkok business day)
- `document`: completed new-system document jobs today
- `media_library`: ready media files
- `job_center`: queued + processing jobs
- `projects`: active projects

Values are real database counts. Do not seed fake values such as 2 / 14 / 8 for production UI.

> Legacy Apps Script document analysis does not yet write to `mms_processing_jobs`, therefore the new DOCUMENT counter does not include legacy-only jobs until the Document replacement/bridge is implemented.

## Requirement 3 — Media Library
Status: IMPLEMENTED / DEVICE TEST REQUIRED

- Private Supabase bucket: `mms-media`
- `media-library.html`
- Original metadata stored in `media_files`
- Original / Proxy / Output represented by `mms_media_variants`
- Signed private downloads
- Signed TUS resumable upload client using direct Storage hostname and 6 MB chunks
- Upload registration and audit log
- CCTV source flag supported

Required production test: upload small file, large video, interrupt/resume network, verify signed download and Proxy queue creation on actual Android/tablet/browser.

## Requirement 4 — Background Worker / Queue
Status: QUEUE IMPLEMENTED / WORKER CODE READY / DEPLOYMENT PENDING

- `mms_processing_jobs`
- `mms_worker_nodes`
- atomic claim with `FOR UPDATE SKIP LOCKED`
- retries and max attempts
- stale/offline worker recovery
- Job Center UI with progress / cancel / retry / worker status
- Dockerized Python worker source in `media-system/worker/`
- Worker cancellation checks and live FFmpeg progress

Blocker: Worker container is not yet deployed to a continuously running container service (e.g. Cloud Run). Until deployed, queued jobs remain safely queued.

## Requirement 5 — Proxy Workflow
Status: IMPLEMENTED IN WORKER / DEPLOYMENT PENDING

- Video uploads queue `proxy_generate`
- Worker uses ffprobe for source metadata
- FFmpeg creates max-720p H.264/AAC MP4 with faststart
- Smaller source is not intentionally enlarged
- Proxy stored as `mms_media_variants.variant_type = proxy`
- Final editing/export should use Original; UI/preview can use Proxy

## Requirement 6 — Projects / Autosave / Versions
Status: IMPLEMENTED

- `mms_projects`
- `mms_project_versions`
- `projects.html`
- Autosave after edits
- Manual immutable numbered Version snapshot
- Project types: video / cctv / audio / document / mixed

## Requirement 7 — CCTV Forensic Layer
Status: FORENSIC/REVIEW IMPLEMENTED / AUTOMATIC CV ANALYZER PENDING

- `mms_cctv_sources`
- `mms_cctv_events`
- `cctv-analysis.html`
- `cctv-player.html`
- Original private playback through signed URL
- Playback rates 0.10x–4x
- ±10 / ±5 / ±3 / ±1 / ±0.1 sec
- previous/next frame approximation from source FPS
- event pre/post context and loop
- SHA-256 checksum workflow
- Legal Hold flag (Admin)
- model + version + confidence fields
- Audit events for important forensic actions

Pending: automatic `cctv_analyze` Worker handler / CV model for person, vehicle, line crossing, loitering, text-natural-language query, etc.

## Requirement 8 — Human Confirmation for AI
Status: IMPLEMENTED DATA/API/UI

- `mms_ai_findings`
- Review states: pending / confirmed / rejected / corrected
- reviewer + reviewed timestamp
- correction JSON
- model name / model version / confidence
- CCTV event review uses the same human-confirmation policy
- Audit log records reviews/corrections

## Existing menus preserved
Still enabled:
- วิเคราะห์วิดีโอ — Legacy Apps Script
- วิเคราะห์เสียง — Legacy Apps Script
- วิเคราะห์เอกสาร — Legacy Apps Script (must remain during migration)
- ประวัติการวิเคราะห์ — Legacy Apps Script
- Admin Settings v4 — identity calls moved behind Edge Function

New enabled modules:
- Media Library
- CCTV Analysis
- Job Center
- Projects

`Video Studio (Beta)` remains disabled until Final Export Worker is production-ready.

## Security
- New Pro data tables have RLS enabled and direct `anon/authenticated` table access revoked.
- Browser calls Edge Functions using existing high-entropy MMs session; service-role secret remains server-side only.
- `mms_claim_processing_job` and stale-recovery RPC are service-role only.
- Private Storage bucket is used.
- Admin email/identity management now uses `mms-identity-api` Edge Function (`admin-settings-v4.html`).
- Direct browser execute rights on the old Admin identity Postgres RPCs were revoked.
- Current Supabase Security Advisor now reports only RLS-without-policy INFO entries; there are no remaining SECURITY DEFINER web-executable WARN entries from the Admin identity path.

## Performance
All new foreign-key covering-index warnings were resolved. Remaining Advisor notices are unused-index INFO because production tables are currently empty/new; retain until real workload statistics exist.

## Current database state at audit
At audit time the Pro tables contained no production media/project/job/CCTV/AI rows and no Worker was online. Therefore live cards correctly start at zero rather than showing demonstration values.

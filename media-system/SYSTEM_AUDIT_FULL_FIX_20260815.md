# MMs — Full System Audit / Fix Status

Date: 2026-08-15
Repository: `checkfile2568-ops/rta-tuning`
Backup branch before this change set: `backup-before-full-mms-fix-20260815`

## Root causes found

### 1. Back/menu navigation was inconsistent
- Main MMs opened modules inside an iframe workspace.
- Some child pages used `history.back()`, some depended only on the parent toolbar, and some had no common navigation contract.
- In iframe/standalone modes `history.back()` can return to a different browser history entry rather than the MMs card menu.

Fix:
- Added `mms-shell-bridge.js`.
- Child modules use `data-mms-back` and post `BACK_TO_MENU` to the parent MMs shell.
- Standalone fallback returns to `media.html#menus`.
- Main `media.html` has a persistent workspace toolbar with Back-to-menu, Full-page, Wake and Close controls.
- The parent listens for MMs postMessage events and closes the workspace before scrolling to the card carousel.

### 2. Responsive behavior was fragmented
- Different modules had independent CSS and different mobile breakpoints.
- Video Studio v2 had its own theme and did not share the Pro design system.

Fix:
- Reworked `mms-pro.css` as the shared MMs UI system.
- Sarabun / Noto Sans Thai / system fallback is used consistently.
- Added safe-area support, touch-sized controls, mobile/tablet/desktop and low-height landscape handling.
- Added `prefers-reduced-motion` handling.
- Reworked `media.html` responsive shell/card carousel.

### 3. Menu guidance was too inconsistent
Fix:
- Database menu subtitles were shortened to one concise action-oriented line.
- Added small `.help` blocks only where a workflow decision is needed.
- Cards keep live metrics separately from the short description.

Current key menu descriptions:
- Media Library: อัปโหลดและจัดเก็บไฟล์กลาง
- Video: ตัด ซูม และส่งออกวิดีโอ
- CCTV: ค้นหาคน รถ และเหตุการณ์ย้อนหลัง
- Audio: วิเคราะห์เสียงและแยกคำพูด
- Document: อ่านข้อความ สรุป และค้นหาสาระ
- History: ดูงานย้อนหลังและผลวิเคราะห์
- Job Center: ติดตามงานประมวลผลเบื้องหลัง
- Projects: บันทึกงานและย้อนเวอร์ชัน
- Admin: จัดการผู้ใช้ สิทธิ์ และเมนู

### 4. Video Studio v2 could not perform a real final export
- v2 selected a browser-local file and saved an edit draft.
- It did not have an end-to-end Storage -> Queue -> FFmpeg -> Output pipeline.
- Its processing/queue button was intentionally disabled.

Fix:
- Added `video-studio-v3.html` and routed the enabled `video` menu to it.
- Video Studio v3 selects ready videos from Media Library.
- Proxy is preferred for preview; Original is the fallback.
- Event marker defaults to 3 seconds pre-roll and 5 seconds post-roll.
- User can set Start/End in the same screen, preview the range and use 0.1/1/3-second navigation.
- Fixed zoom supports user-selected center and 1x-3x preview.
- `video_export` jobs are queued through `mms-workflow-api`.
- Final results are available from Video Studio and Job Center after processing.
- AI follow-subject/follow-ball/auto-action controls remain disabled in v3 until a dedicated tracking renderer is production-ready; Final Export does not falsely claim these modes are active.

### 5. Background processing only covered Proxy/Checksum
Fix:
- Media Worker v0.3 supports:
  - `checksum_compute`
  - `proxy_generate`
  - `video_export`
  - `cctv_analyze`
- Uses the existing atomic `mms_claim_processing_job` queue.
- Supports progress, heartbeat, cancel and retry/stale-worker recovery.
- Added HTTP health runner for container hosting.
- Docker image includes FFmpeg, OpenCV and Ultralytics YOLO runtime.
- Added Docker Compose production template and safe `.env.example`.
- Added GitHub Actions image build/publish workflow for `ghcr.io/checkfile2568-ops/mms-media-worker`.

Runtime status:
- Worker source/container are production-oriented and syntax-tested.
- A continuously running external container instance still requires a container host plus `SUPABASE_SERVICE_ROLE_KEY` supplied privately on that host. No Cloud Run/Cloudflare container deployment connector is available in the current ChatGPT tool session, and the secret is deliberately not stored in this public repository.
- Until a container host is activated, the queue safely remains queued and UI shows Worker Offline.

### 6. CCTV automatic people/vehicle detection was missing
Fix:
- CCTV Analysis now has an automatic analysis form.
- Presets: Fast / Standard / Detailed.
- User can analyze People and/or Vehicles.
- Worker samples video frames and uses Ultralytics YOLO (`yolo11n.pt` by default) for:
  - person
  - bicycle
  - car
  - motorcycle
  - bus
  - truck
- Contiguous detections are merged into person/vehicle events.
- Results are written to both `mms_cctv_events` and `mms_ai_findings`.
- All AI detections start as `pending` Human Review.
- Existing Confirm / Reject / Correct, confidence, model/version, forensic playback, SHA-256 and Legal Hold workflows remain.

### 7. Checksum background job was not guaranteed after upload
Fix:
- Added `media-ensure-jobs` to `mms-workflow-api`.
- After Media Library completes an upload it ensures:
  - SHA-256 checksum job if not verified
  - Proxy generation for video if no ready/active Proxy exists
- Duplicate active jobs are avoided.

## Backend / APIs
Active Supabase Edge Functions after this change set:
- `mms-api`
- `mms-pro-api`
- `mms-identity-api`
- `mms-workflow-api` v2

`mms-workflow-api` provides the new Video/CCTV/Worker-facing browser workflow endpoints while retaining the existing custom high-entropy MMs session model.

## Existing menus / Legacy compatibility
Enabled new/updated modules:
- Media Library
- Video -> Video Studio v3
- CCTV Analysis
- Job Center
- Projects
- Admin Settings v4

Enabled Legacy modules retained deliberately:
- Audio Analysis (Apps Script)
- Document AI (Apps Script) — MUST remain during migration
- History (Apps Script)

The GitHub repository does not contain the full deployed Apps Script UI source for those legacy modules, therefore their internal typography/theme was not modified blindly. Their containing MMs workspace/header/navigation is standardized.

## Validation
- GitHub Actions `MMs Quality Check` validates:
  - Python syntax for Worker + Health Runner
  - inline JavaScript syntax for core MMs pages
  - presence of the shared navigation bridge
  - required Video/CCTV/Worker integrations
- Final full quality-gate run for the current UI/worker integration completed successfully.
- GitHub Pages deployment after the updated UI completed successfully.
- Supabase Security Advisor: no new WARN/ERROR; remaining notices are INFO `RLS Enabled No Policy`, expected because the design intentionally mediates data through server Edge Functions/service role rather than exposing tables directly.
- Supabase Performance Advisor currently reports unused-index INFO only; new tables have not yet accumulated production workload.

## Production test still required after Worker host activation
Use real media, not demo rows:
1. Upload a large video and interrupt/resume upload.
2. Verify checksum job completes and `checksum_verified=true`.
3. Verify Proxy is generated and Video Studio previews Proxy.
4. Set an event point, confirm default Start = event - 3 sec and chosen End.
5. Submit Final Export, close the page, reopen Job Center and verify progress continues.
6. Download Final result and verify audio/video sync and no stutter.
7. Upload CCTV source, run Standard People+Vehicle analysis and review detected events.
8. Verify slow playback/frame-step/event pre/post context.
9. Verify Legal Hold prevents operational deletion paths when delete feature is introduced.

## Rollback
If a critical frontend regression is found, restore from branch:
`backup-before-full-mms-fix-20260815`

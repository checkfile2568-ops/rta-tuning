# MMs — CURRENT SYSTEM STATUS

วันที่ตรวจ: 2026-08-16
สถานะเอกสาร: Current production reference

เอกสารนี้ใช้ร่วมกับ `MMs_SYSTEM_BLUEPRINT.md` และ `WORKPLACE_REUSABLE_SYSTEM_STANDARD.md` ก่อนแก้ระบบครั้งต่อไป

## 1. Production entry
- Main: `media.html`
- UI: responsive MMs shell, PIN/session, data-driven menu, Admin permission
- Video production route: `video-studio-v4.html?v=20260816-enhance1`
- Legacy `Video Studio (Beta)` disabled after v4 promotion
- Media Library production route: `media-library-v3.html?v=20260816-retention2`

## 2. Authentication / Admin
- Custom 4-digit PIN session architecture
- User/role/menu permissions stored server-side
- Admin Settings supports users, email identity fields, roles, active state, menu route/order/enable
- Disabled menus are hidden by server-side menu filtering

## 3. Media Library
- Private Storage model
- Safe ASCII/UUID storage keys while preserving Thai display names
- Small files: signed standard upload
- Large files: browser-side FFmpeg split to target ~40 MB, hard check <=45 MB per Part
- Parts upload sequentially: Part 1 must be ready before Part 2, etc.; database sequence guard exists
- Media Set groups all Parts under one logical source
- User can delete failed/unused records subject to Legal Hold / project / active-job rules
- Retention UI/database policy values aligned: `auto_24h` and `immediate`
- Same-origin FFmpeg class worker is vendored under `vendor/ffmpeg-0.12.10/` to avoid mobile cross-origin Worker failures

## 4. Video Studio v4
- Single logical source list: complete Media Sets appear as one video instead of separate Parts
- Single-file sources remain supported
- Media Set preview uses sequential signed Part URLs and one global timeline
- Event mark / start / end / pre-roll / post-roll controls
- Playback step controls: ±3s, ±1s, ±0.1s
- Fixed Zoom:
  - native browser video controls removed from editing surface
  - pointer/touch selection layer
  - tap and drag target
  - coordinates calculated against actual displayed video rectangle, not letterbox area
  - fine directional nudge and center button
- Enhance controls:
  - brightness -50..50
  - contrast -50..50
  - saturation -50..50
  - sharpness 0..100
  - presets Natural / Bright / CCTV / Sport
  - brightness/contrast/saturation preview live in browser
  - sharpness is applied during Final Export
- Output profiles: source quality / Full HD / HD 720p / compact
- Follow Subject / Follow Ball / Auto Action remain disabled until real tracking renderer is implemented
- Worker status is explicit. Offline jobs may be queued but UI explains that no Final download exists until a Worker processes the job
- Completed jobs expose Open and Download actions through signed result URLs

## 5. Workflow API v4
- Supabase Edge Function `mms-workflow-api` v4 logic deployed ACTIVE
- New actions:
  - `video-source-list`
  - `video-preview-source`
- `video-export-queue` supports either `media_file_id` or `media_set_id`
- Media Set export jobs may have `media_file_id = null`; source relation is stored in job input as `media_set_id`
- Enhance and output-profile settings are clamped server-side and stored in job input/audit
- `job-result-url` returns signed downloadable result only for completed jobs

## 6. Media Worker v0.4.0 source/image
- Job types retained: checksum_compute / proxy_generate / video_export / cctv_analyze
- Worker Image build succeeds
- New capabilities:
  - `media_set_export`
  - `video_enhance`
- Media Set Final Export:
  1. download ready Parts ordered by `segment_index`
  2. concat Parts (stream-copy first, re-encode fallback)
  3. trim against global source timeline
  4. apply Fixed Zoom if selected
  5. apply Enhance filters
  6. apply output profile
  7. encode MP4 H.264/AAC + faststart
  8. upload Final to private storage
  9. calculate SHA-256
  10. complete Job with result metadata
- CCTV preset includes denoise before sharpening

## 7. CCTV
- CCTV source/evidence model exists
- CCTV analysis queue exists
- Worker source supports YOLO person/vehicle analysis
- Slow review / frame step / speed playback UI exists
- AI findings require Human Review before confirmation
- Checksum / timezone / Legal Hold concepts retained
- Runtime AI processing depends on Worker being online

## 8. Job Center
- Shows queued / processing / failed / cancelled / completed states and progress
- Cancel / Retry supported
- Download result is shown only after a completed job has an output path
- Queue is persistent in Supabase; leaving the page does not delete the queued job

## 9. Projects / Versioning / Audit
- Projects and autosave/version history exist
- Audit events are used for important workflow actions
- Blueprint requires source → edit/settings → job → output traceability

## 10. Legacy modules retained
- Audio / Document / History remain compatible with existing legacy routes where source migration is not complete
- Do not remove legacy workflow until replacement is tested against original behavior

## 11. Quality / deployment status
- MMs Quality Check run 55: SUCCESS
- Python Worker syntax: PASS
- Production inline JavaScript syntax: PASS
- Splitter syntax: PASS
- Navigation/protocol integration: PASS
- GitHub Pages deployment run 209: SUCCESS
- Worker Image run 4 (v0.4.0): SUCCESS

## 12. Critical remaining infrastructure item
**No Media Worker runtime is currently online.**
- `mms_worker_nodes`: no heartbeat rows
- Current queue contains checksum/proxy/video_export jobs waiting for processing
- Therefore Final Export code and image are ready, but background processing and Final Download are not End-to-End proven until the Worker Image is started on a continuous Container Host with the required Supabase secrets

This is not a browser/UI defect. Queue creation is expected to stay `queued` at 0% while Worker Online = 0.

## 13. Required End-to-End acceptance test after Worker runtime starts
1. Upload a large video and verify all Parts ready in one Media Set
2. Open Video Studio v4 and verify the set appears as one source
3. Seek across Part boundary
4. Select trim start/end and Fixed Zoom target by touch
5. Apply Brightness + Sharpness preset
6. Queue Final Export
7. Close the browser/page
8. Verify Worker heartbeat and progress >0
9. Verify completed Final output
10. Open and Download signed Final file
11. Verify output SHA-256 and audit relationship
12. Test Retry/Cancel/failure path

## 14. Change rule
Before future changes, check impact across:
UI → Navigation → Identity → Permission → Media Set / Media File → Storage → API → Queue → Worker → Output → Download → Project → Audit → Retention → Mobile/Browser.

Do not change one layer without checking the related layers above.

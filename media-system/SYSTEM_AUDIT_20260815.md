# MMs System Audit — 2026-08-15

## UI / UX policy
- Keep the existing MMs glass card carousel as the primary navigation.
- Responsive target: mobile/tablet/desktop, portrait and landscape.
- Open a selected work module in the workspace below the card area and provide an up/back control to return to menu selection.
- Disabled menus must not be shown to end users.

## Enabled primary menus
1. วิเคราะห์วิดีโอ (`video`) — enabled, legacy Apps Script route.
2. วิเคราะห์เสียง (`audio`) — enabled, legacy Apps Script route.
3. วิเคราะห์เอกสาร (`document`) — enabled, legacy Apps Script route. **Must remain.**
4. ประวัติการวิเคราะห์ (`history`) — enabled, legacy Apps Script route.
5. ตั้งค่าแอดมิน (`admin`) — enabled, routed to `admin-settings-v3.html`.

## Prepared but disabled
- คลังมัลติมีเดีย (`media_library`)
- วิเคราะห์กล้องวงจรปิด (`cctv`)
- Video Studio Beta (`video_studio_beta`)
- รายงาน (`reports`)
- ศูนย์งานประมวลผล (`job_center`)
- โปรเจกต์และประวัติ (`projects`)

These are intentionally hidden until each module is production-ready.

## Identity / Email
`mms_users` now includes:
- `email`
- `email_verified`
- `identity_provider`
- `external_subject`
- `last_login_at`

Admin Settings v3 displays a clear `ยังไม่ได้ผูกอีเมล` state instead of treating a user as unknown. Admin can maintain email/provider/verification state together with PIN, role, active status and menu permissions.

Current custom PIN login does not automatically disclose the user's Google email. Google account verification/linking is a separate future OAuth step; until then the email can be maintained in Admin Settings.

## Admin Settings v3
File: `admin-settings-v3.html`
- Responsive user cards.
- User name, role, active state, PIN reset.
- Email, provider and verification state.
- Per-user menu permissions.
- Menu enable/disable, order, route type and URL.
- Summary counters for users, enabled menus, linked emails and verified emails.

## Database / API security
- Core tables keep RLS enabled and are not intended for direct public table access.
- Identity RPCs validate the existing high-entropy MMs session token before returning or changing data.
- Unused profile RPC execution is revoked.
- Trigger function execution is revoked from web roles.
- `mms_touch_video_job_updated_at` has an explicit `search_path`.
- Two Admin RPCs remain callable by the anon REST role because the browser uses the existing custom MMs session rather than Supabase Auth JWT; both perform server-side admin-session validation before accessing data.

## Performance
Added covering indexes for:
- `analysis_jobs.media_file_id`
- `migration_import_log.imported_job_id`
- `mms_user_menu_permissions.menu_id`

Indexes reported as unused on newly-created video/job tables are intentionally retained until real workload exists.

## Legacy dependency still present
Video, Audio, Document and History currently point to the same Apps Script deployment URL. The Apps Script source code is not present in this repository, so these modules remain legacy dependencies until their replacement MMs Pro modules are completed.

## Next production migration order
1. Media Library + resumable upload/object storage.
2. Job Center + Media Worker/FFmpeg.
3. Video Studio full export and proxy workflow.
4. CCTV Analytics / forensic mode.
5. Audio Studio.
6. Document AI replacement while keeping the current Document menu available throughout migration.
7. Projects/History and Reports.

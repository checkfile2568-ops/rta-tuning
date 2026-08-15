# MMs SYSTEM BLUEPRINT

Version: 1.0
Status: CANONICAL / MUST CHECK BEFORE CHANGE
Updated: 2026-08-15

## 1. Purpose
เอกสารนี้เป็นแหล่งอ้างอิงหลักของระบบ MMs เพื่อให้การแก้ไขทุกครั้งตรวจความสัมพันธ์ก่อนเปลี่ยนโค้ดจริง และป้องกันการแก้เฉพาะหน้าแล้วทำให้ Import / Storage / Project / Processing / Export / History / Audit ไม่ตรงกัน

กฎหลัก: **ห้ามเปลี่ยน Contract ใดโดยไม่ตรวจ Downstream/Upstream ที่เกี่ยวข้อง**

## 2. Canonical Flow

```text
User / Device
  ↓
Identity + Permission
  ↓
Import / Upload
  ↓
Media Registration (media_files / Media ID)
  ↓
Private Object Storage
  ↓
Original Variant
  ↓
Project / Metadata / Classification
  ↓
Queue / Worker
  ├─ checksum_compute
  ├─ proxy_generate
  ├─ cctv_analyze
  ├─ ai_analyze
  └─ video_export
  ↓
Derived Variants
  ├─ proxy
  ├─ thumbnail
  ├─ waveform
  └─ output
  ↓
Human Review / Approval (where required)
  ↓
Export / Download / Share
  ↓
History + Audit + Retention
```

## 3. One File = One Media ID
ไฟล์ต้นฉบับ 1 ไฟล์ต้องมี `media_files.id` เดียวเป็นตัวอ้างอิงกลาง ห้ามแต่ละโมดูลสร้างสำเนาข้อมูลต้นฉบับใหม่โดยไม่จำเป็น

Relationship:

```text
media_files.id
  ├─ mms_media_variants.media_file_id
  ├─ mms_processing_jobs.media_file_id
  ├─ mms_cctv_events.media_file_id
  ├─ mms_ai_findings.media_file_id
  ├─ mms_audit_events.media_file_id
  └─ project_id → mms_projects.id
```

## 4. Import Contract
รองรับแหล่งข้อมูลกลาง:
- `upload` — ไฟล์ทั่วไปจากอุปกรณ์
- `cctv` — CCTV/NVR export
- `import` — นำเข้าจากระบบเดิม
- `nvr` — NVR integration

ประเภทข้อมูลกลาง:
- `video`
- `audio`
- `document`
- `image`
- `other`

เมื่อ Import ต้องทำตามลำดับ:
1. ตรวจ Session / Permission
2. สร้าง Media ID
3. เก็บชื่อผู้ใช้เห็นใน `original_name`
4. สร้าง Storage key ภายในแบบ ASCII-safe เช่น `<user>/<yyyy-mm>/<media-id>/source.mp4`
5. Upload ไป Private Storage
6. ยืนยันว่ามี Object จริง
7. เปลี่ยน `upload_status = ready`
8. สร้าง Original variant
9. Queue SHA-256
10. Queue Proxy/Analysis ตามประเภทไฟล์
11. เขียน Audit

## 5. Filename Policy
- ชื่อไฟล์ที่ผู้ใช้เห็นสามารถเป็นภาษาไทย/Unicode ได้
- ห้ามนำชื่อผู้ใช้เห็นไปใช้เป็น Storage object key โดยตรง
- Storage key ต้องใช้ UUID/ASCII-safe เสมอ
- Extension ต้องมาจาก whitelist / MIME mapping

ตัวอย่าง:

```text
Display: คลิป_ประชุม_วันที่15.mp4
Storage: 6539.../2026-08/2c45.../source.mp4
```

## 6. Upload Strategy
- ไฟล์ ≤ 50 MB: Signed Standard Upload
- ไฟล์ > 50 MB: Signed TUS Resumable Upload
- Signed TUS endpoint: `/storage/v1/upload/resumable/sign`
- TUS chunk: 6 MB
- Resume ต้องใช้ Media ID เดิมและขอ signed token ใหม่
- ห้ามใช้ token เก่าที่หมดอายุเป็น source of truth
- Progress ที่แสดงต้องเป็น progress จริงจาก transport/server
- Error 400/401/403 ต้องหยุด progress ทันทีและไม่แสดงค่าหลอก

## 7. Storage Variants
`mms_media_variants.variant_type` เป็นมาตรฐานกลาง:
- `original`
- `proxy`
- `thumbnail`
- `waveform`
- `output`

กฎ:
- Original immutable โดยหลัก
- งานแก้ไขต้องสร้าง Derived Variant/Output ใหม่
- Final Export ต้องอ้างกลับไปยัง Original + Edit/Job settings
- Proxy ใช้ Preview/Edit เท่านั้น ไม่ใช้เป็น Final master ยกเว้นกำหนดชัด

## 8. Project Relationship
Project รองรับ:
- video
- cctv
- audio
- document
- mixed

กฎ:
- Project เป็น container ของ workflow ไม่ใช่เจ้าของไฟล์แบบลบตามกันโดยอัตโนมัติ
- Autosave เก็บ working state
- Version เก็บ immutable snapshot
- การลบไฟล์ที่อยู่ใน Project ต้อง block จนถอดความสัมพันธ์ก่อน

## 9. Processing Contract
ทุกงานหนักต้องผ่าน `mms_processing_jobs`

สถานะมาตรฐาน:
- `draft`
- `queued`
- `processing`
- `completed`
- `failed`
- `cancelled`

ต้องมี:
- progress 0–100
- attempts/max_attempts
- idempotency_key
- worker_id
- error_message
- started/completed timestamps
- input/output JSON

กฎ:
- Job ต้อง idempotent
- Worker ต้อง claim แบบ atomic
- งานค้างต้อง recover ได้
- Cancel ต้องหยุด processor จริงเมื่อรองรับ
- Retry ห้ามสร้าง Output ซ้ำโดยไม่จำเป็น

## 10. CCTV Contract
CCTV ใช้ Media ID กลางเช่นเดียวกับ Video

ต้องเก็บ:
- camera/source
- timezone
- event start/end
- pre/post roll
- confidence
- model/version
- review status
- correction
- checksum/legal hold เมื่อต้องใช้ Evidence mode

AI finding ไม่ถือเป็นข้อเท็จจริงจนกว่าจะผ่าน Human Review ในงานที่กำหนด

## 11. Video Edit / Export Contract
Video editing เป็น non-destructive workflow

Edit state ตัวอย่าง:

```json
{
  "start_ms": 17500,
  "end_ms": 26800,
  "zoom_mode": "fixed",
  "zoom": 1.4,
  "x": 0.55,
  "y": 0.42,
  "pre_roll_ms": 3000
}
```

กฎ:
- จุดตัด/ซูม/คีย์เฟรมเก็บเป็น settings/snapshot ก่อน render
- Final Export ต้องใช้ Original เป็น source หลัก
- Proxy ใช้สำหรับ preview เพื่อความลื่น
- Output ใหม่ต้องสร้าง variant_type=`output`
- ห้าม overwrite Original

## 12. Export / File-Out Contract
การส่งไฟล์ออกเป็นส่วนหนึ่งของ workflow ไม่ใช่แค่ปุ่ม Download

### Export types
- Download private signed URL
- Final output file
- Share package (ถ้านโยบายอนุญาต)
- Evidence package
- External-system handoff/API

### Export pre-check
ก่อนส่งออกทุกครั้งต้องตรวจ:
1. User session valid
2. Action permission (`export`/`download`)
3. Media/Output status = ready
4. Data classification อนุญาตให้ส่งออกหรือไม่
5. Legal Hold / Evidence policy
6. Project relationship
7. Required human review/approval completed
8. Checksum status (ถ้ากำหนด)
9. Output metadata ถูกต้อง

### Export output relationship
ทุก Output ต้องสัมพันธ์กับ:
- source `media_file_id`
- `project_id` (ถ้ามี)
- `processing_job_id` หรือ export job
- version/edit snapshot
- creator/requester
- created_at
- checksum (เมื่อใช้)
- retention policy

### Export naming
ชื่อดาวน์โหลดสามารถใช้ชื่อไทยที่อ่านง่ายได้ แต่ Storage key ภายในยังใช้ ASCII-safe

ตัวอย่าง:

```text
Storage: .../outputs/8d2a.../final.mp4
Download name: ฟุตบอล_รอบชิง_ไฮไลต์_v3.mp4
```

### Evidence export
ถ้าเป็น CCTV/Evidence package ให้พิจารณารวม:
- Original checksum SHA-256
- Output checksum
- Source/camera/timezone
- Start/End timestamp
- Exported by / exported at
- AI findings + Human Review status
- Audit manifest

## 13. Delete / Retention Contract
ลบได้เมื่อ:
- ไม่ติด Legal Hold
- ไม่ถูก Project ใช้งาน หรือถอด relationship แล้ว
- ไม่มี active processing job
- ไม่มี policy ห้ามลบ

Failed upload history สามารถลบได้โดยผู้ใช้ตามสิทธิ์ แต่ Audit ควรยังเก็บเหตุการณ์สำคัญ

## 14. Persistence Policy
ข้อมูลสำคัญห้ามเก็บเฉพาะ localStorage

### Server-persistent
- users/roles/permissions
- media metadata
- project/version
- job/progress
- CCTV/AI findings
- export records
- audit

### Device-temporary
- session token raw client-side
- UI tab/scroll state
- temporary upload fingerprint
- Wake Lock state

## 15. Change Impact Check — MANDATORY
ก่อนแก้ทุกครั้งต้องตอบว่าเปลี่ยนอะไรในรายการนี้หรือไม่:

```text
[ ] UI / Navigation
[ ] Identity / Permission
[ ] API contract
[ ] Database schema
[ ] Storage path/key
[ ] Import flow
[ ] Upload/Resume
[ ] Project relation
[ ] Job/Worker
[ ] Proxy/Analysis
[ ] CCTV/AI
[ ] Export/Download
[ ] Audit/History
[ ] Retention/Delete
[ ] Legacy compatibility
[ ] Mobile/Tablet/Desktop
[ ] Security/Secret
```

ถ้ามีอย่างน้อย 1 จุดเปลี่ยน ต้องตรวจ upstream/downstream ก่อน commit

## 16. Required Pre-Change Procedure
1. อ่าน Blueprint ล่าสุด
2. ระบุ Component ที่จะแก้
3. ระบุ API/Data contract ที่เกี่ยวข้อง
4. ตรวจ migration/backward compatibility
5. สำรอง branch/commit
6. แก้ในขอบเขตเล็กที่สุด
7. Run syntax/quality check
8. Test Import → Process → Export ที่ได้รับผลกระทบ
9. Update Blueprint/Audit ถ้า contract เปลี่ยน
10. Deploy แล้วตรวจ production logs

## 17. Golden Rules
- Do not break working modules to add a new feature
- Do not duplicate source-of-truth data
- Do not store secrets in public frontend/GitHub
- Do not use user filenames as raw storage keys
- Do not show fake progress
- Do not claim completed until end-to-end test passes
- Do not delete Original silently
- Do not bypass permissions in UI only; enforce server-side
- Do not add a new menu without lifecycle/permission/route definition
- Do not change data contract without migration/version note

## 18. Reuse
หลักใน Blueprint นี้สามารถนำไปใช้กับ Document, Case, Personnel, LINE, Public Service และระบบอื่นได้ โดยยึดแกนเดียวกัน:

`Identity → Data Registration → Storage/DB → Workflow/Job → Output → Audit → Retention`

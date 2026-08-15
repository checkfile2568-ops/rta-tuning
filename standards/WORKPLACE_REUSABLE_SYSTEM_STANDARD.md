# WORKPLACE REUSABLE SYSTEM STANDARD

Version: 1.0
Status: REUSABLE STANDARD FOR NEW/EXISTING SYSTEMS
Updated: 2026-08-15

## Purpose
เอกสารนี้เก็บรูปแบบการพัฒนาระบบที่ต้องการใช้ซ้ำกับระบบอื่น เพื่อให้ระบบต่าง ๆ มีมาตรฐานเดียวกัน ใช้งานง่าย ตรวจสอบความสัมพันธ์ก่อนแก้ และไม่เกิดปัญหาแต่ละระบบใช้แนวทางคนละแบบ

## 1. User Experience Pattern
- Mobile-first และรองรับ Tablet/Desktop
- รองรับแนวตั้ง/แนวนอน
- เมนูหลักเป็น Card/Menu ที่เข้าใจง่าย
- เมนูที่ยังไม่เปิดใช้งานจริงต้องไม่แสดงแก่ผู้ใช้ทั่วไป
- ทุก Workspace ต้องมีปุ่มกลับไปเลือกเมนูแบบมาตรฐานเดียวกัน
- ข้อความกำกับสั้น กระชับ ภาษาไทยอ่านง่าย
- Error สำหรับผู้ใช้ต้องเป็นภาษาคน ไม่แสดง stack trace/token/debug ยาว
- Progress ต้องเป็นค่าจริง
- เมื่อทำงานเบื้องหลังได้ ให้แจ้งชัดว่าออกจากหน้าได้เมื่อใด

## 2. Identity Pattern
- มี User ID กลาง ไม่อิงชื่อเป็น primary identity
- ชื่อแก้ได้โดยไม่ทำให้ relation พัง
- รองรับ Email/SSO/Google หรือ Identity provider ในอนาคต
- PIN ใช้ Quick Unlock ได้ แต่ข้อมูลสิทธิ์บังคับฝั่ง Server
- Admin จัดการ active/inactive, role, permission, reset credential
- เก็บ last login / session audit ตามความเหมาะสม

## 3. Permission Pattern
Permission ต้องตอบได้ 3 คำถาม:
1. เห็น Module นี้หรือไม่
2. ทำ Action อะไรได้บ้าง
3. ทำกับ Data Scope ไหนได้บ้าง

Action มาตรฐานที่นำไปใช้ซ้ำได้:
- view
- create
- edit
- analyze/process
- approve/review
- export/download
- delete
- administer

## 4. Data Relationship Pattern
ทุก entity สำคัญควรมี Stable ID และ Foreign Key/Reference ที่ชัดเจน

ตัวอย่าง pattern:

```text
User
 ↓
Project / Case / Work Item
 ↓
Source Data / File / Record
 ↓
Processing / Workflow
 ↓
Output
 ↓
Audit / History
```

ห้ามใช้ชื่อบุคคล/ชื่อไฟล์เป็น key หลักในการเชื่อมระบบ

## 5. Import Pattern
ทุกระบบที่รับข้อมูลเข้าต้องมี:
- source type
- original display name/value
- internal stable ID
- owner
- project/work-item relation
- created/imported time
- validation status
- audit event

Import ต้องไม่ทำให้ข้อมูลต้นฉบับสูญหายโดยเงียบ

## 6. File Pattern
- Original แยกจาก Derived/Edited/Output
- Storage private เป็นค่าเริ่มต้นสำหรับข้อมูลภายใน
- Display filename แยกจาก Storage object key
- Object key ใช้ UUID/ASCII-safe
- มี checksum สำหรับข้อมูลที่ต้องการตรวจความถูกต้อง
- มี retention/delete policy
- มี Legal Hold สำหรับหลักฐาน/ข้อมูลที่ห้ามลบ

## 7. Processing Pattern
งานหนัก/นานต้องออกจาก Browser ไป Queue/Worker

```text
Request
 ↓
Queue
 ↓
Worker
 ↓
Progress
 ↓
Result
```

สถานะกลาง:
- draft
- queued
- processing
- completed
- failed
- cancelled

ต้องรองรับ retry/cancel/idempotency ตามความเหมาะสม

## 8. Save / Persistence Pattern
ข้อมูลสำคัญต้องเก็บฝั่ง Server ไม่ใช่เฉพาะเครื่องผู้ใช้

Server:
- account
- permission
- settings สำคัญ
- project/workflow
- progress
- result
- audit

Device-only:
- temporary UI state
- local cache
- short-lived resume fingerprint

ทุกฟังก์ชัน Save ที่สำคัญควรผ่าน Test:
`Save → Refresh → Logout/Login → Another Device`

## 9. Version Pattern
ระบบที่มีการแก้ไขงานต่อเนื่องควรมี:
- Autosave current working state
- Manual immutable version
- Restore previous version
- Version note/author/time

## 10. Export / Output Pattern
ทุกระบบต้องคิด Output ตั้งแต่ต้น ไม่ใช่ทำ Input อย่างเดียว

Output อาจเป็น:
- PDF
- Word
- Excel/CSV
- Image
- Video/Audio
- ZIP package
- Private download
- API handoff
- Notification/Message

ก่อน Export ต้องตรวจ:
- permission
- data classification
- approval/review
- source/result ready
- relation กับ project/work item
- retention/share policy

Output ทุกชิ้นควร trace กลับไปหา Source/Work Item/Version/User ได้

## 11. History / Audit Pattern
ต้องแยก:
- User-facing History — สำหรับเปิดงานเดิม/ทำต่อ
- Audit Log — สำหรับตรวจว่าใครทำอะไร เมื่อไร กับข้อมูลใด

Audit event มาตรฐาน:
- actor
- action
- entity type/id
- before/after หรือ detail
- result
- timestamp

## 12. Data Governance Pattern
ทุกระบบใหม่ควรระบุ Data Classification อย่างน้อย:
- PUBLIC
- INTERNAL
- CONFIDENTIAL
- RESTRICTED

Policy ต้องสัมพันธ์กับ:
- access
- download/export
- external sharing
- AI usage
- retention
- logging

## 13. AI Governance Pattern
ก่อนใช้ AI ต้องระบุ:
- use case
- data class
- model/provider
- data sent out
- human review required?
- confidence/limitations
- retention/logging

AI Finding สำหรับงานสำคัญต้องมีสถานะ:
- pending
- confirmed
- rejected
- corrected

## 14. Legacy Migration Pattern
เมื่อต่อยอดระบบเดิม:
- ห้ามตัดระบบเดิมก่อน replacement ผ่าน test
- ใช้ Hybrid bridge ได้
- ย้ายทีละ module
- รักษาข้อมูลเก่า
- มี mapping document
- มี rollback

## 15. Navigation Pattern
ทุก Module ต้องมี:
- ชื่อไทยสั้น
- ชื่ออังกฤษ/ระบบตามต้องการ
- icon
- route
- enabled state
- sort order
- permission
- back-to-menu behavior

ห้ามแต่ละหน้ากำหนดการกลับเมนูเองคนละวิธี

## 16. UI Design Pattern
- ใช้ Design Tokens/Theme กลาง
- ฟอนต์เดียวกันในระบบเดียว
- สีสถานะมาตรฐาน: success/warning/error/info
- ปุ่ม Primary/Secondary/Danger แบบเดียว
- Touch target เหมาะกับมือถือ
- รองรับ safe-area
- ไม่ให้ layout overflow/ซ้อนเมื่อจอเล็ก

## 17. Error Handling Pattern
แยก 2 ชั้น:

User message:
`อัปโหลดไม่สำเร็จ ระบบกำลังขอสิทธิ์ใหม่`

Technical log:
`HTTP 403 / Compact JWS / request id / stack`

ผู้ใช้ไม่ควรเห็น Secret/Token/Stack Trace

## 18. Change Impact Gate — MUST RUN BEFORE EDIT
ก่อนแก้ทุกระบบให้ตรวจ:

```text
[ ] UI/UX
[ ] Navigation
[ ] Identity
[ ] Permission
[ ] Data schema
[ ] API
[ ] File/storage
[ ] Import
[ ] Save/persistence
[ ] Queue/worker
[ ] Export/output
[ ] History/audit
[ ] Data governance
[ ] AI governance
[ ] Legacy compatibility
[ ] Mobile/tablet/desktop
[ ] Backup/rollback
```

ถ้าแก้จุดใด ต้องระบุ relation ที่ได้รับผลกระทบก่อนลงมือ

## 19. Definition of Done
คำว่า “เสร็จ” ใช้ได้เมื่อ:
- code merged/deployed
- syntax/CI ผ่าน
- permission test ผ่าน
- save/refresh test ผ่าน
- relevant end-to-end flow ผ่าน
- error state ทดสอบแล้ว
- mobile/tablet/desktop ตรวจแล้ว
- audit/log ตรวจได้
- documentation updated

ห้ามใช้คำว่าเสร็จ 100% ถ้ายังเหลือ runtime/worker/deployment/test ที่จำเป็น

## 20. Reusable Build Prompt Contract
เมื่อให้ AI/Codex/Programmer สร้างระบบใหม่ ให้เริ่มด้วยข้อกำหนด:

> สร้าง/แก้ระบบตาม Workplace Reusable System Standard ล่าสุด โดยคง stable IDs, server-side permission, relationship integrity, import-save-export lifecycle, audit, mobile-first navigation และต้องทำ Change Impact Check ก่อนแก้ ห้ามสร้าง source-of-truth ซ้ำหรือเปลี่ยน contract โดยไม่มี migration/rollback

## 21. Recommended Shared Platform Services
ระบบอื่นควรใช้บริการกลางร่วมกันเมื่อทำได้:
- Identity
- Permission
- Application Registry
- File Service
- Project/Workflow
- Notification
- Queue/Worker
- Search
- Audit
- Backup
- AI Gateway
- Data Classification

เป้าหมายคือ “เพิ่ม Module” แทน “สร้างระบบใหม่จากศูนย์” เมื่อบริบทเหมาะสม

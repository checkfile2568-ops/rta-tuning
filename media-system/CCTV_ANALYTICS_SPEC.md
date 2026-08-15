# MMs Pro — CCTV Analytics Specification

สถานะ: Approved requirement (2026-08-15)

## 1) เป้าหมาย

เพิ่มโมดูล **CCTV Analysis** เป็นส่วนหลักของ MMs Pro สำหรับวิเคราะห์ภาพจากกล้องวงจรปิด/ไฟล์บันทึก/NVR เพื่อค้นหาเหตุการณ์ตามเงื่อนไขที่ผู้ใช้กำหนด โดยต้องรองรับการย้อนเวลา เล่นช้า เดินทีละเฟรม และสร้างช่วงเหตุการณ์ย้อนหลังได้อย่างแม่นยำ

## 2) แหล่งข้อมูล

- Upload ไฟล์วิดีโอจากกล้อง/NVR/DVR
- Import หลายไฟล์ต่อเนื่องเป็น Timeline เดียว
- รองรับ H.264/H.265 และ container ที่พบบ่อย เช่น MP4/MKV/TS ตามที่ Worker รองรับ
- รองรับ ONVIF ในระยะถัดไป
  - Profile T สำหรับ streaming/metadata/event
  - Profile G สำหรับ recording/search/retrieval/playback
  - Profile M สำหรับ analytics metadata/events
- เก็บชื่อกล้อง ตำแหน่ง วันที่ เวลา timezone และ metadata ต้นฉบับ

## 3) CCTV Search / AI Query

ผู้ใช้กำหนดเงื่อนไขค้นหาได้ เช่น

- ช่วงวัน/เวลา
- กล้อง/พื้นที่/โซน
- บุคคลปรากฏ/หายไป
- จำนวนคน/การรวมกลุ่ม
- รถยนต์/รถจักรยานยนต์/วัตถุ
- สีเสื้อ/สีรถ/ประเภทวัตถุ เมื่อโมเดลรองรับ
- ทิศทางการเคลื่อนที่ เข้า/ออก/ซ้าย/ขวา
- Line crossing / Zone entry / Zone exit
- Loitering / อยู่ในพื้นที่เกินเวลาที่กำหนด
- วัตถุถูกวาง/ถูกนำออก
- Motion / sudden motion / tamper
- ค้นหาด้วยข้อความธรรมชาติ เช่น “หาช่วงที่มีรถสีขาวเข้าประตูหลังเวลา 18:00”

ผลลัพธ์ต้องแสดง Event Card พร้อม thumbnail, camera, start/end, confidence และปุ่มเล่นย้อนหลัง

## 4) Playback มาตรฐาน

Playback ต้องไม่แก้ไฟล์ต้นฉบับและต้องรักษา timestamp ต้นทาง

Speed presets:
- 0.10x
- 0.25x
- 0.50x
- 0.75x
- 1.00x
- 1.50x
- 2.00x
- 4.00x สำหรับการไล่ดูเร็วเมื่อ codec/device รองรับ

Fine controls:
- ย้อน 10s / 5s / 3s / 1s / 0.1s
- เดินหน้า 0.1s / 1s / 3s / 5s / 10s
- Previous frame / Next frame
- Jump to event
- Loop selected range

Slow motion preview ต้องใช้ timestamp/frame index จริง ไม่สร้าง frame ปลอมเป็นค่าเริ่มต้น

## 5) Event Pre-roll / Post-roll

เมื่อ AI พบเหตุการณ์ที่เวลา T:

- ค่าเริ่มต้น Pre-roll = 3s
- ค่าเริ่มต้น Post-roll = 5s สำหรับ CCTV
- ผู้ใช้ปรับได้
- หาก AI ระบุช่วงเหตุการณ์ [event_start,event_end] ให้ clip_start = event_start - pre_roll และ clip_end = event_end + post_roll
- ห้ามเกิน duration และห้าม start >= end

สำหรับเหตุการณ์สั้นมากให้ระบบแนะนำช่วงย้อนหลังที่ยาวพอให้เห็นบริบทก่อนและหลัง

## 6) Forensic / Evidence Mode

ต้องมีโหมดแยกจาก Creative Video Editing:

- ห้าม AI sharpen/upscale/crop แบบอัตโนมัติ
- Original pixels / original audio เป็นค่าหลัก
- แสดง source filename, checksum, duration, codec, fps/resolution, timestamp/timezone
- การตัดคลิปต้องบันทึก source reference + start/end + user + timestamp
- Export evidence ต้องสร้าง audit log
- Enhancement ใด ๆ ต้องถูกระบุว่าเป็น “Enhanced Copy” และไม่เขียนทับ Original

## 7) Review Workspace หน้าจอเดียว

องค์ประกอบ:
1. Video Preview
2. Camera/Date/Time overlay
3. Timeline พร้อม event markers
4. Speed control + frame step
5. ROI/Zone/Line drawing
6. Search filters / natural-language query
7. Event list ด้านข้างหรือ bottom sheet
8. Start/Event/End markers
9. Clip preview
10. Save case/project/export

Mobile portrait: video บน + controls เป็น bottom sheet
Mobile landscape/tablet: video เป็นพื้นที่หลัก + event panel ด้านข้าง
Desktop: video/timeline + filters/events แบบ 2-3 pane

## 8) Analytics Pipeline

Source Video
→ Metadata/clock normalization
→ Scene/motion segmentation
→ Object detection/tracking
→ ROI/line/zone rules
→ OCR/license plate/face/person attributes เฉพาะเมื่อเปิดโมดูลและมีสิทธิ์
→ Audio/speech analysis เมื่อมีเสียง
→ AI reasoning/summarization
→ Event index
→ Search / review / clip

Tracking ต้องมี smoothing และ confidence threshold เพื่อลด false movement

## 9) Performance

- สร้าง Proxy สำหรับ review บนมือถือ/แท็บเล็ต
- Final export ใช้ source เดิม
- Resumable upload
- Background job queue
- Worker ทำ decode/analyze/export แบบ asynchronous
- ปิดหน้าจอได้หลัง upload/enqueue สำเร็จ
- Job Center แสดง queued/processing/completed/failed/retry

## 10) Data Model เพิ่มเติม

- cctv_sources
- cctv_cameras
- cctv_recordings
- cctv_events
- cctv_tracks
- cctv_zones
- cctv_search_queries
- cctv_review_sessions
- cctv_evidence_exports
- audit_logs

## 11) สิทธิ์

Admin กำหนดรายผู้ใช้ได้:
- View CCTV
- Search CCTV
- Analyze
- Draw ROI/Zone
- Export Clip
- Export Evidence
- View sensitive analytics
- Manage camera sources

เมนูที่ยังไม่เปิดหรือผู้ใช้ไม่มีสิทธิ์ต้องไม่แสดง

## 12) Integration Direction

MMs Pro จะออกแบบให้สอดคล้องกับ ONVIF สำหรับระบบ IP camera โดยวางเส้นทางรองรับ Profile T (advanced streaming), Profile G (recording/search/retrieval/playback), และ Profile M (analytics metadata/events) ในอนาคต โดยไม่ผูกระบบกับผู้ผลิตกล้องรายเดียว

## 13) Default CCTV Presets

### General Review
- speed 1.0x
- pre 3s / post 5s
- motion + person + vehicle

### Incident Search
- pre 5s / post 10s
- person/vehicle/object tracking
- loop result range

### Forensic Review
- original quality
- no auto enhancement
- frame step enabled
- checksum + audit log required

### Fast Scan
- 2x/4x playback
- motion/event markers
- auto pause at high-confidence events

## 14) หลักสำคัญ

CCTV Analysis และ Video Studio ใช้ Timeline/Job/Storage framework ร่วมกัน แต่ต้องแยก **Evidence Mode** ออกจาก **Creative Editing Mode** อย่างชัดเจน เพื่อป้องกันการปรับแต่งไฟล์หลักโดยไม่ตั้งใจ

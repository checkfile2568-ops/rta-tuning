# MMs AI Worker v0.1.0

Worker แยกจาก Media Worker เดิม เพื่อไม่กระทบงาน proxy/export/CCTV ที่ใช้งานอยู่

## Capability
- `audio_transcribe` — ใช้ faster-whisper ถอดข้อความพร้อม timestamp และบันทึกเป็น `mms_ai_findings` (`transcript_segment`)
- `football_highlight_scan` — คัด Highlight candidates จากพลังเสียง + scene change และเสริม YOLO context ได้
- ผล AI ทุกประเภทเริ่มที่ `review_status=pending` และต้อง Human Review
- ไม่อ้างว่าเป็น Goal โดยอัตโนมัติ ค่า `goal_candidate` เปิดได้เฉพาะ heuristic mode และต้องยืนยัน

## Environment
ใช้ค่าเดิมของ Media Worker:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEDIA_BUCKET=mms-media`

เพิ่มเติม:
- `WORKER_ID` เช่น `mms-ai-office-01`
- `WHISPER_MODEL=small`
- `WHISPER_DEVICE=cpu` หรือ `cuda`
- `WHISPER_COMPUTE_TYPE=int8` (CPU) / `float16` (GPU)
- `FOOTBALL_USE_YOLO=0` เป็นค่าเริ่มต้น; เปิดเป็น `1` เมื่อเครื่องพร้อม
- `FOOTBALL_YOLO_MODEL=yolov8n.pt`

## Run
```bash
pip install -r requirements.txt
python worker_ai.py
```

ต้องมี `ffmpeg` ใน PATH

## Acceptance Test
1. Worker heartbeat ปรากฏใน `mms_worker_nodes` และ capability มี job type ที่ติดตั้งจริง
2. Audio job เปลี่ยน queued → processing → completed และมี transcript_segment
3. Football job สร้าง highlight_candidate โดยไม่เรียก Goal เมื่อ heuristic ปิด
4. กด Confirm/Reject แล้ว `review_status` เปลี่ยนและมี audit จาก API
5. ปิด AI Worker แล้ว Media Worker เดิมยังทำ proxy/export ได้ตามเดิม

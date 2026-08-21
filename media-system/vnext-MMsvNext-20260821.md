# MMs vNext — Upgrade Phase 1/2 (21 ส.ค. 2026)

## หลักการ
อัปเกรดแบบ additive ก่อน ไม่เปลี่ยน Production route และไม่รื้อ Media ID / Project / Job / AI Finding / Audit / Retention เดิม

## Phase 1 — UX + Health
- `mms-command-center-vnext.html` ใช้ dashboard health fields จาก mms-pro-api v5
- แสดง Worker Online, Jobs Active, Jobs Stuck, Failed Today และทางลัดงานหลัก
- ใช้ค่าจริงจาก Backend ไม่สร้าง progress จำลอง

## Phase 2 — AI Assistant ที่ทำงานจริง
### Audio Transcript
- `audio-analysis-v2.html`
- `mms-ai-api`
- `worker-ai` job `audio_transcribe`
- faster-whisper, ภาษาไทย, timestamp, Human Review
- ยังไม่ทำ Speaker Diarization ในรุ่นนี้

### Football AI
- `video-football-ai-v1.html`
- job `football_highlight_scan`
- Fusion: Audio Energy + Scene Change + optional YOLO context
- ค่าเริ่มต้นสร้าง `highlight_candidate`
- `goal_candidate` เป็น optional heuristic และต้อง Human Review
- รุ่นถัดไปควรเพิ่ม Scoreboard OCR / goal-specific classifier ก่อนเพิ่มคำว่า Goal แบบอัตโนมัติ

## สิ่งที่ยังไม่เปลี่ยน
- `media.html`, `video-studio-v4.html`, `audio-analysis.html` Production เดิม
- Media Worker เดิม
- DB schema เดิม
- Retention สองค่าเดิม: `auto_24h` / `immediate`

## Deploy Gate
ห้ามสลับ Production route จนกว่าจะผ่าน:
1. mms-pro-api v5 + mms-media-api v15 patch test
2. AI Edge Function deploy และ session auth ผ่าน
3. AI Worker heartbeat online
4. Audio E2E อย่างน้อย 1 ไฟล์
5. Football E2E อย่างน้อย 1 คลิป และ Human Review ใช้งานได้
6. Media Worker เดิมยัง proxy/export ได้
7. Mobile portrait/landscape smoke test

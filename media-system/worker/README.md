# MMs Media Worker

Background worker สำหรับงานหนักที่ไม่ควรประมวลผลใน Browser

## ทำงานหลายเครื่องได้

Worker เป็นแบบ **active-any-node**: คอมพิวเตอร์เครื่องใดเปิด Worker และเชื่อมต่อ Supabase ได้ จะรับงานใน Queue ทันที

| สถานะ | ผลลัพธ์ |
| --- | --- |
| บ้านเปิดเครื่องเดียว | บ้านรับงานทันที |
| ที่ทำงานเปิดเครื่องเดียว | ที่ทำงานรับงานทันที |
| เปิดทั้งสองเครื่อง | รับคนละงานพร้อมกัน ไม่รับงานเดียวกันซ้ำ |
| ปิดทั้งสองเครื่อง | งานค้างใน Queue อย่างปลอดภัย |

การกันงานซ้ำทำโดย `mms_claim_processing_job()` แบบ atomic (`FOR UPDATE SKIP LOCKED`) ที่ฐานข้อมูล ไม่ได้อาศัยการเดาจากหน้าเว็บ

## รองรับแล้ว
- `checksum_compute` — SHA-256 ของ Original แล้วบันทึก `checksum_verified=true`
- `proxy_generate` — สร้าง MP4 Proxy 720p H.264/AAC ด้วย FFmpeg แล้วบันทึกเป็น media variant
- Atomic job claim ผ่าน `mms_claim_processing_job()` + `FOR UPDATE SKIP LOCKED`
- Heartbeat ไป `mms_worker_nodes`
- Retry สูงสุดตาม `max_attempts`

## Environment
```text
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only secret>
WORKER_ID=mms-home-01
WORKER_LABEL=บ้าน
MEDIA_BUCKET=mms-media
POLL_SECONDS=3
HEARTBEAT_SECONDS=15
```

ห้ามนำ `SUPABASE_SERVICE_ROLE_KEY` ใส่ GitHub source หรือ Browser

ทุกเครื่องต้องใช้ `WORKER_ID` คนละค่า เช่น `mms-home-01` และ `mms-office-01` ส่วน `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ใช้ชุดเดียวกันได้บน Worker ที่ผู้ดูแลควบคุมเท่านั้น

## ตั้งค่าบน Windows

1. ติดตั้งและเปิด **Docker Desktop** แล้วให้ Docker Desktop เริ่มหลังลงชื่อเข้า Windows
2. ในโฟลเดอร์นี้คัดลอก `.env.example` เป็นชื่อ `.env` และตั้งค่า `WORKER_ID` กับ `WORKER_LABEL` ให้ไม่ซ้ำกับเครื่องอื่น
3. เปิด PowerShell ในโฟลเดอร์ `windows` แล้วรันครั้งแรก:

   ```powershell
   .\install-autostart.ps1 -StartNow
   ```

4. ตรวจสถานะด้วย:

   ```powershell
   .\status-worker.ps1
   ```

`install-autostart.ps1` สร้าง Scheduled Task ชื่อ **MMs Media Worker** สำหรับผู้ใช้ Windows คนปัจจุบัน เมื่อเปิดคอมและลงชื่อเข้าใช้ Worker จะเริ่มเองและรับงานค้างทันที

- ปิดเครื่องหรืออินเทอร์เน็ตหลุด: งานไม่หาย แต่รอใน Queue
- เปิดคอมเครื่องใดกลับมา: เครื่องนั้นดึงงานรอต่อเอง
- หน้าจอล็อก: Worker ยังทำงานได้ตราบใดที่ Windows และ Docker Desktop ยังทำงาน
- ไฟล์ `.env` เป็นความลับ ห้ามส่งผ่านแชตหรือขึ้น GitHub/Google Drive แบบสาธารณะ

## Container
```bash
docker build -t mms-media-worker .
docker run --rm \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e WORKER_ID=mms-worker-01 \
  mms-media-worker
```

## Production target
Deploy container นี้บน Windows ที่เปิดใช้งานจริง หรือ container service ที่รันต่อเนื่องได้. หลัง worker heartbeat เข้ามา Job Center จะแสดง Online โดยอัตโนมัติ

## ขั้นถัดไป
เพิ่ม job handlers: `video_render`, `cctv_analyze`, `audio_analyze`, `document_analyze`, thumbnail/waveform และ AI tracking โดยคง queue schema เดิม

# MMs Media Worker

Background worker สำหรับงานหนักที่ไม่ควรประมวลผลใน Browser

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
WORKER_ID=mms-worker-01
MEDIA_BUCKET=mms-media
POLL_SECONDS=3
```

ห้ามนำ `SUPABASE_SERVICE_ROLE_KEY` ใส่ GitHub source หรือ Browser

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
Deploy container นี้บน Cloud Run / container service ที่รันต่อเนื่องได้ แล้วตั้ง min instance ตาม workload. หลัง worker heartbeat เข้ามา Job Center จะแสดง Online โดยอัตโนมัติ

## ขั้นถัดไป
เพิ่ม job handlers: `video_render`, `cctv_analyze`, `audio_analyze`, `document_analyze`, thumbnail/waveform และ AI tracking โดยคง queue schema เดิม

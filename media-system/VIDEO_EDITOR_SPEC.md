# MMs — Video Editor / Processing Specification

สถานะ: Approved requirements from UI review (2026-08-15)

## 1. เป้าหมาย

ปรับระบบวิดีโอให้ตัดคลิปจากจุดสำคัญได้แม่นยำ ภาพ/เสียงลื่น รองรับมือถือและแท็บเล็ต และย้ายงานประมวลผลหนักออกจากหน้าเว็บเพื่อให้ผู้ใช้สามารถล็อกหน้าจอหรือออกจากหน้าเว็บได้โดยงานยังทำต่อบน Backend

## 2. Timeline และการตัดคลิป

- `event_time` = เวลาที่ AI/ผู้ใช้ชี้เป็นจุดสำคัญ
- ค่าเริ่มต้น `pre_roll = 3 วินาที`
- ค่าเริ่มต้น `post_roll = 2 วินาที` และปรับได้ 0–10 วินาที
- เมื่อเลือกจุดสำคัญ: `clip_start = max(0, event_time - pre_roll)`
- ถ้ามีช่วงเหตุการณ์จาก AI ให้ใช้ `event_end + post_roll` เป็น `clip_end`
- ถ้ามีเฉพาะจุดเวลา ให้ผู้ใช้กำหนด `clip_end` หรือใช้ค่าความยาว preset
- ปุ่ม `ตั้งจุดเริ่ม` / `ตั้งจุดสิ้นสุด` / `ย้อน 3 วิ` / `เดินหน้า 1 วิ` / `เดินหน้า 0.1 วิ`
- ปุ่ม `Preview ช่วงตัด` ก่อนบันทึก
- ห้ามบันทึกหาก `start >= end`, ช่วงตัดเกิน duration หรือ source ยังโหลด metadata ไม่ครบ

## 3. หน้าจอเดียว

องค์ประกอบต้องอยู่ใต้ Video Preview เดียวกัน:

1. Video ต้นฉบับ
2. Overlay จุดติดตาม/กรอบ Crop
3. Current time + Event time
4. Timeline ที่มี marker: Event / Start / End
5. Controls: Play/Pause, ±3s, ±1s, ±0.1s
6. Zoom / Tracking controls
7. ปุ่ม Reset กลับวิดีโอต้นฉบับ
8. Preview Output
9. Save / Export

ไม่เปิดหน้าตัดวิดีโอแยกหลายหน้า

## 4. Zoom modes

### A. Original / Reset
- 1.0x ไม่ crop
- คืนค่าจุดเริ่ม/สิ้นสุดและ zoom project ได้โดยไม่แก้ไฟล์ต้นฉบับ

### B. Fixed Zoom
- ผู้ใช้แตะตำแหน่งบนภาพ
- กำหนด 1.2x / 1.5x / 2.0x / Custom
- กรอบ Crop แสดงทันที

### C. Manual Keyframes
- กำหนดตำแหน่งและ zoom หลายจุดตามเวลา
- Interpolate แบบ smooth/ease-in-out ระหว่าง keyframe
- จำกัดความเร็วการ pan/zoom เพื่อลดอาการสั่น

### D. Follow Ball
- ตรวจจับลูกบอลในแต่ละ frame
- tracker ใช้ smoothing (EMA/Kalman) ไม่เลื่อนกล้องตาม detection ดิบ
- มี dead-zone กลางภาพก่อนขยับ crop
- หากลูกบอลหาย ให้ hold ตำแหน่งล่าสุดระยะสั้น แล้ว fallback ไป action/player cluster
- จำกัด zoom สูงสุดตามความละเอียด source เพื่อไม่ให้ภาพแตกเกินกำหนด

### E. Follow Subject
- เลือกคน/วัตถุจาก frame แล้วติดตามเป้าหมาย
- รองรับ person/player/vehicle/object ในอนาคต

### F. Auto Action (แนะนำสำหรับฟุตบอล)
- ใช้ลูกบอล + กลุ่มผู้เล่น + motion เพื่อหาศูนย์กลางเหตุการณ์
- เลื่อน crop ช้ากว่า Follow Ball เพื่อภาพดูเป็นธรรมชาติ
- เป็น default tracking สำหรับคลิปฟุตบอลเมื่อระบบมีโมเดล tracking พร้อม

## 5. ช่วยเพิ่มความชัดเมื่อ Zoom

- Preview ใช้ CSS/Canvas scaling เท่านั้น ไม่ถือเป็น final enhancement
- Final export ต้องประมวลผลจาก source frame โดยตรง ไม่อัดซ้ำจากหน้าจอ
- รองรับ sharpening แบบอ่อนหลัง scale
- หลีกเลี่ยงการ sharpen สูงที่ทำให้ halo/noise
- Upscale AI เป็นตัวเลือกแยก ไม่เปิดอัตโนมัติ เพราะใช้ทรัพยากรสูง

## 6. แก้อาการไฟล์บันทึกกระตุก

ห้ามใช้ browser real-time recording เป็นวิธี export หลัก เช่น `canvas.captureStream()` + `MediaRecorder` สำหรับงานจริง เพราะ frame อาจตกเมื่อ CPU/GPU มือถือไม่ทัน

Final export ควรทำแบบ offline/server-side โดย FFmpeg/worker:

- อ่าน source ตาม timestamp จริง
- รักษา source FPS/timebase หรือ normalize อย่างตั้งใจ
- Audio sync จาก source
- Export H.264/AAC MP4 พร้อม `faststart`
- ใช้ quality preset ที่เหมาะกับ source
- ตรวจ frame drop / duplicate timestamps หลัง encode

Fast trim ที่ไม่ zoom อาจใช้ stream copy เมื่อจุดตัดตรง keyframe; exact cut หรือมี zoom/tracking ให้ re-encode

## 7. งานเบื้องหลัง

Frontend:
- ใช้ Screen Wake Lock ขณะหน้าเว็บเปิดและ visible
- Upload แบบ resumable
- แสดง progress และ job ID

Backend:
- Upload source ไป object storage
- สร้าง `video_edit_job`
- Worker ทำ trim / crop / zoom / tracking / encode แบบ asynchronous
- อัปเดต progress ใน database
- ผู้ใช้สามารถปิดหน้า/ล็อกจอได้ หลัง upload + enqueue สำเร็จ
- เมื่อกลับเข้าระบบ ให้ History แสดง queued / processing / completed / failed

Service Worker ใช้สำหรับ cache/retry UI ได้ แต่ไม่ใช้เป็น video encoder ระยะยาว

## 8. Default presets

### Sports Highlight
- pre-roll: 3s
- post-roll: 3s
- tracking: Auto Action
- max zoom: 1.6x
- smoothing: High

### Goal / Critical Moment
- pre-roll: 3s
- post-roll: 5s
- tracking: Follow Ball -> Auto Action fallback
- max zoom: 1.8x

### Manual Clip
- pre-roll: 0s
- post-roll: 0s
- tracking: Original

## 9. Validation ก่อน Export

ระบบต้องตรวจ:

- source file readable
- duration/fps/resolution/audio metadata
- start/end validity
- crop อยู่ใน frame
- zoom ไม่เกิน safe limit
- output storage quota
- backend worker ready
- network upload complete/checksum verified

จากนั้นจึงเปิดปุ่ม `บันทึก/ประมวลผล`

## 10. Responsive UI

- Mobile portrait: Video อยู่บน, controls เป็น bottom sheet/accordion, timeline ใช้เต็มความกว้าง
- Mobile landscape: Video ซ้าย/บนเป็นพื้นที่หลัก, control compact ด้านขวาหรือด้านล่าง
- Tablet portrait: Video + timeline ด้านบน, controls 2 columns
- Tablet landscape/Desktop: Video + controls 2-pane แต่ทุก marker อยู่ใน workspace เดียว

## 11. Current blocker

ณ วันที่บันทึกสเปกนี้ source ของ Apps Script ระบบ media เดิม (`Code.gs`/HTML ภายในโปรเจกต์) ยังไม่ถูกเก็บใน GitHub และค้นไม่พบผ่าน Drive connector มีเพียง deployment URL เดิม ดังนั้น shell MMs แก้ได้ทันที แต่ปุ่มตัดวิดีโอภายใน Apps Script ไม่สามารถแก้จาก GitHub wrapper ได้เนื่องจากเป็น cross-origin iframe

แนวทางแก้มี 2 ทาง:

1. ดึง Apps Script source เดิมมา backup แล้วแก้ engine เดิมชั่วคราว
2. ทางแนะนำ: สร้าง Video Worker ใหม่ + Video Studio ใน MMs แล้วค่อยยกเลิก dependency Apps Script สำหรับเมนู Video

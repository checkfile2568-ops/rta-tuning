# LINE ↔ PrintHub v7 staging

สถานะ: **STAGING ONLY — ยังไม่ Deploy**

ฐานที่ใช้ตรวจ:
- LINE bot: `information-chatbot/` จาก branch base `77b0408...`
- PrintHub จริง: v6 “ยืนยันรับเอกสาร” จาก Google Drive ชุดแก้ล่าสุด 6 ก.ย. 2569
- Wrapper: https://checkfile2568-ops.github.io/printhub/

## เป้าหมาย
เพิ่มการสั่งพิมพ์ผ่าน LINE โดยไม่รื้อ PrintHub เดิม

```
VIP/Admin → บอท พิมพ์ → ส่ง PDF/JPG/PNG
  → WAIT_AGENT (ถ้าคอมปิด)
  → WAIT_CONFIRM (เมื่อ Agent online)
  → ผู้ใช้ยืนยัน
  → QUEUED → Agent เดิม CLAIMED/PRINTING
  → SENT (ส่งเข้าเครื่องแล้ว)
  → ผู้ใช้ยืนยันได้รับกระดาษ
  → DONE
```

## ไฟล์ฝั่ง LINE
- `information-chatbot/PrintHubLine.js` — session, permission, natural-language intent, bridge client, notification polling
- `information-chatbot/FIXED_Webhook.js` — hook 3 จุด: image เมื่อมี print session, file, text print intent
- `information-chatbot/Dashboard.html` — การ์ดตั้งค่า PrintHub ใน “ตั้งค่าและซ่อมแซม”

ไม่แก้:
- SearchUnified.js
- SmartMatching.js
- OnlineCourt.js
- GeminiQA.js
- ระบบบัญชีนัด/ส่งหมาย/เวรเสื้อฟ้า
- group gate
- LINE doPost/auth

## ไฟล์ staging ฝั่ง PrintHub
- `Queue.gs` — เพิ่มเฉพาะ `WAIT_AGENT`, `WAIT_CONFIRM` และให้สถานะดังกล่าวอยู่ใน LIVE
- `Api.gs` — เพิ่ม route `line_*` พร้อม token แยก; Agent API เดิม/AGENT_TOKEN คงเดิม
- `LineBridge.gs` — API สำหรับ LINE โดยเฉพาะ

### Bridge actions
- `line_status`
- `line_upload_start`
- `line_upload_chunk`
- `line_submit`
- `line_job`
- `line_latest`
- `line_confirm`
- `line_cancel`
- `line_receive`
- `line_search`
- `line_reprint`

## Security
ต้องตั้ง Script Property ชื่อเดียวกันทั้งสอง Apps Script:
`PRINT_HUB_BRIDGE_TOKEN`

- ห้ามใส่ token ลง GitHub/Dashboard/Sheet
- token นี้แยกจาก `AGENT_TOKEN`
- LINE user permission บังคับจาก LINE bot เดิม: VIP/Admin
- PrintHub bridge ผูก job owner เป็น `LINE:<LineUserId>`
- Agent claim ได้เฉพาะ `QUEUED`; WAIT_AGENT/WAIT_CONFIRM จึงพิมพ์ไม่ได้ก่อนยืนยัน

## File storage
PrintHub v6 เก็บไฟล์จริงใน Drive spool เดิม และเก็บ metadata ใน `PRINT_QUEUE`.
- Cancel: trash original/PDF ทันทีตาม logic เดิม
- DONE: เก็บไฟล์ตาม `FILE_KEEP_DAYS`
- หลัง retention หมด: purge ลบไฟล์ แต่ metadata ยังคงใน PRINT_LOG
- Reprint ใช้ได้ตราบใดที่ไฟล์ต้นฉบับยังอยู่
- Search รองรับชื่อไฟล์ และคำว่า “วันนี้/เมื่อวาน”

### Download
รอบนี้ **ยังไม่เปิด direct download** เพราะไฟล์ spool เป็น private.
หากต้องการ Phase 2 ให้ทำ authenticated temporary download/handoff; ห้ามเปลี่ยน Drive เป็น public link.

## AI
- Natural-language intent เปิด/ปิดได้
- AI reply style เปิด/ปิดได้
- AI มีหน้าที่ classify/rephrase เท่านั้น
- Code เป็นผู้ตัดสิน permission, Agent online, job state
- AI ห้ามอ้างว่า DONE หาก PrintHub ยังไม่เป็น DONE

## ก่อน Deploy
1. นำ `Queue.gs`, `Api.gs`, `LineBridge.gs` staging ไปเทียบกับ Apps Script PrintHub live อีกครั้ง
2. ตั้ง `PRINT_HUB_BRIDGE_TOKEN` ทั้งสองโปรเจกต์
3. เพิ่ม `PrintHubLine.js` และ patch Dashboard/Webhook ฝั่ง LINE
4. เปิด `PRINT_HUB_LINE_STATUS=OFF` ไว้ก่อน
5. syntax test + regression
6. Deploy PrintHub ก่อน
7. ทดสอบ `line_status` ด้วย token โดยไม่สร้าง job
8. Deploy LINE bot
9. เปิด PrintHub LINE feature แล้วทดสอบ VIP/Admin
10. ห้ามเปิด production ก่อนทดสอบ Offline → Online → Confirm → SENT → Receive ครบ

## Rollback
- ปิด `PRINT_HUB_LINE_STATUS=OFF` ฝั่ง LINE: feature หยุดทันที
- LINE code: revert branch changes
- PrintHub: คืน Queue.gs/Api.gs v6 เดิมและเอา LineBridge.gs ออก
- Agent ไม่ต้องเปลี่ยน และ `AGENT_TOKEN` ไม่เปลี่ยน

# LINE Chatbot Fixed Bundle — Staged Rollout

ชุดนี้เป็นสำเนาโค้ดแก้ไขสำหรับระบบ LINE Chatbot ศาลจังหวัดลพบุรี ใช้สำหรับตรวจสอบและนำไปติดตั้งแบบ staging ก่อน production

## ข้อควรระวัง

ห้ามเก็บ LINE channel access token, channel secret, `WEB_ADMIN_KEY`, cookie, OAuth credential หรือข้อมูลส่วนบุคคลใน repository นี้ ไฟล์ `FIXED_AdminAuth.js` ที่อยู่ใน branch นี้เป็นฉบับอ้างอิงที่ต้องใช้ค่า `WEB_ADMIN_KEY` จาก Script Properties หรือคอนฟิกเดิมเท่านั้น

Spreadsheet production และ Script ID ของระบบจริงไม่ควรถูกฝังไว้ในหน้าเว็บสาธารณะ การติดตั้งจริงต้องตรวจยืนยัน project ID และ backup ก่อนทุกครั้ง

## โครงสร้าง

โฟลเดอร์ `fixed/` มี Core Helpers, Webhook batch/signature validation, Admin Authorization, Secure Dashboard Dispatcher, Health Check, Trigger Control, คู่มือ และรายงานรีวิว

ไฟล์ในชุดนี้ไม่ได้แทนที่ไฟล์เดิมใน Apps Script project และยังไม่ใช่คำสั่ง Deploy อัตโนมัติ

## ลำดับติดตั้ง

1. สำรองไฟล์เดิมหรือสร้าง version ใน Apps Script Editor
2. ทดสอบบน Spreadsheet สำเนา
3. เพิ่มไฟล์ fixed แยกใน Apps Script project และตรวจ syntax
4. ตรวจ global function ที่ซ้ำก่อนเปิดใช้งาน override
5. ตรวจ Trigger ให้เหลือ runner ที่กำหนดไว้เพียงชุดเดียว
6. ทดสอบ Webhook, notification และ Dashboard แบบ read-only ก่อน deploy

เอกสารฉบับเต็มอยู่ใน `fixed/FIXED_Guide_TH.md` และรายงานตรวจอยู่ใน `fixed/FIXED_Review_Report_TH.md`

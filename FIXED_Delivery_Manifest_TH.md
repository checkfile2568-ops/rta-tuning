# Manifest ชุดส่งมอบ Fixed Bundle

วันที่: 17 สิงหาคม 2026

ชุดนี้เป็นโค้ดแก้ไขแยกจาก `/home/ubuntu/05-line-bot/` และไม่ได้เขียนทับไฟล์เดิมหรือแก้ Spreadsheet production

| รายการ | รายละเอียด |
|---|---|
| โฟลเดอร์โค้ด | `/home/ubuntu/05-line-bot-fixed/` |
| ZIP ส่งมอบ | `/home/ubuntu/05-line-bot-fixed.zip` |
| SHA-256 | ดูไฟล์ `/home/ubuntu/05-line-bot-fixed.sha256` |
| production mutation | ไม่มี |
| WEB_ADMIN_KEY | คงค่า `4255` |
| Spreadsheet production | ไม่ได้เปิดเพื่อเขียนหรือ repair |
| Spreadsheet staging ที่กำหนดในคู่มือ | `1llnzNFkDirqGAxqIg77azh8FZBbSadFGUvNYfUM4xcc` |

## ไฟล์หลัก

1. `FIXED_CoreHelpers.js`
2. `FIXED_Webhook.js`
3. `FIXED_HealthCheck.js`
4. `FIXED_AdminAuth.js`
5. `FIXED_SecureDashboardDispatch.js`
6. `FIXED_TriggerControl.js`
7. `test_fixed_code.js`
8. `FIXED_Guide_TH.md`
9. `FIXED_Review_Report_TH.md`
10. `verification_output.txt`

## ผลตรวจ

```text
SYNTAX_CHECK=PASS
ELLIPSIS_CHECK=PASS
fixed helper tests: PASS
```

## ข้อจำกัดการใช้งาน

ไฟล์ `FIXED_Webhook.js` มี `doPost` ของ fixed bundle จึงต้องใช้แทน `doPost` เดิมเมื่อย้ายเข้าสู่ staging/production และไม่ควรวางร่วมกับ implementation ที่ชื่อ global ซ้ำถาวร. การติดตั้งต้องเริ่มบน staging และทำตาม `FIXED_Guide_TH.md` เท่านั้น

โหมด HMAC ที่แนะนำสำหรับ production คือ `LINE_SIGNATURE_MODE=REQUIRED` หลังยืนยันว่า deployment/proxy ส่ง `x-line-signature` ให้ Apps Script ได้จริง. หากยังไม่เห็น header อย่าเปิด REQUIRED โดยไม่มีเส้นทางส่ง signature เพราะจะทำให้ webhook ถูกปฏิเสธทั้งหมด

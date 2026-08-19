# Information Chatbot

โฟลเดอร์นี้เก็บ source code ของ **Information Chatbot** ซึ่งเป็น Google Apps Script Project แยกจาก Main Chatbot production เดิม โดยจัดเก็บหน้า Login, Dashboard และโมดูลฝั่ง Apps Script ที่ใช้กับระบบใหม่เท่านั้น

## Project และ Web App

- **Apps Script Project ID:** `1kE5bDu5KMAZixexvKSXPK1Z0-s8-PfUZOXSGqBm2pQedP8ys0nbmx1mk`
- **Active deployment ID:** `AKfycbwI0qyeC8Agz76dXLfkAeabl2eNzOvxBS0eisdtQYhBBJV8hBmxYtFy_Ns-wBVcpYlo`
- **Web App URL:** `https://script.google.com/macros/s/AKfycbwI0qyeC8Agz76dXLfkAeabl2eNzOvxBS0eisdtQYhBBJV8hBmxYtFy_Ns-wBVcpYlo/exec`
- **Spreadsheet ID:** `1llnzNFkDirqGAxqIg77azh8FZBbSadFGUvNYfUM4xcc`
- **Deployment version ที่ตรวจสอบล่าสุด:** `13`

## ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
|---|---|
| `Login.html` | หน้าโหลด Information Chatbot, บอต SVG โบกมือ และหน้าเข้าสู่ระบบ Admin |
| `Dashboard.html` | หน้า Admin Console แบบ card-based สำหรับตั้งค่าระบบ |
| `FIXED_AdminAuth.js` | ตรวจสอบสิทธิ์ Admin และสร้างหน้า Login/Dashboard |
| `GeminiQA.js` | โมดูลถาม–ตอบด้วย Gemini ตามขอบเขตที่ Admin กำหนด |
| `LineFlexNotifyFix.js` | โมดูลการแจ้งเตือนแบบตั้งค่าได้ |
| `GeneralInfoAdmin.js` | โมดูลข้อมูลทั่วไปที่จัดการผ่าน Admin |
| `appsscript.json` | Manifest และการตั้งค่า Web App |
| `INFORMATION_CHATBOT_LOGIN_EXAMPLE.html` | ตัวอย่างหน้า Login สำหรับดูและทดสอบ UI แบบ local |

## การเผยแพร่

การนำ source ไปยัง Apps Script ให้ตรวจสอบไฟล์ `.claspignore` ก่อนเสมอ และห้ามนำไฟล์ backup, ผลการทดสอบ, รหัส Admin, token, API key หรือไฟล์ configuration ที่มีความลับขึ้น repository สาธารณะ

การตรวจสอบพื้นฐานก่อน deploy:

```bash
node test_geminiqa_logic.js
node test_notify_logic.js
for f in *.js; do node --check "$f"; done
python3 -m json.tool appsscript.json >/dev/null
```

สถานะ staging ที่ใช้ล่าสุดยังปิดการทำงานของฟีเจอร์ที่อาจส่งข้อความหรือเรียกบริการภายนอกจริง ได้แก่ `BOT_STATUS`, `NOTIFY_STATUS`, `GEMINI_QA_STATUS`, `TV_NOTIFY_STATUS`, `ONLINE_COURT_STATUS` และ `PERSONAL_ARCHIVE_STATUS` ตามค่าที่ตั้งไว้ใน Spreadsheet

## Patch ล่าสุด

Deployment รุ่น 13 แก้ปัญหาหน้า Admin ไม่แสดงผลหลังตรวจ `WEB_ADMIN_KEY` โดยปรับ newline ใน Dashboard bootstrap ให้เป็น escape ของ JavaScript ที่ถูกต้อง และทำ clean replacement ของ Apps Script content ให้เหลือเฉพาะ source root 23 ไฟล์ ไม่มี backup หรือไฟล์ probe ค้างอยู่

## ความปลอดภัย

ห้ามใช้ `WEB_ADMIN_KEY` ของ Main Chatbot production กับระบบนี้ และห้ามใส่ค่า Admin key จริงไว้ใน HTML, README, GitHub หรือ log การทดสอบ โดยระบบต้องอ่านค่าจาก Spreadsheet หรือ Script Properties ผ่านฝั่ง server เท่านั้น หากไม่พบค่าคีย์ ระบบจะปฏิเสธการเข้าสู่ระบบแทนการใช้ fallback key

การเปลี่ยนแปลงในโฟลเดอร์นี้ไม่ควรแก้ไขไฟล์หรือ Spreadsheet ของ Main Chatbot production เดิมโดยอัตโนมัติ

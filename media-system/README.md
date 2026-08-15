# ระบบจัดการแก้ไขวีดีโอและเสียง — Backup

โฟลเดอร์นี้ใช้เก็บสำรองโค้ดและข้อมูลอ้างอิงของหน้า:

- GitHub Pages: `https://checkfile2568-ops.github.io/rta-tuning/media.html`
- Google Apps Script Web App: `https://script.google.com/macros/s/AKfycbwqyIrR6JXm9OKpUF8IBeJh7bVciZv0M8Oq8Lj0aIE3CE_l7kJdNp1JUrKb_tEwPNuE/exec`
- Data Sheet ที่พบ: `ผลวิเคราะห์วิดีโอและเสียง (Gemini AI)`
- Spreadsheet ID: `1EXAxPDymO2Ic5LlvXOtuO21QBUaOJWeUzWNv2tyH_XI`

## ไฟล์ที่สำรองแล้ว

- `media.html` — หน้า wrapper ที่ GitHub Pages ใช้เปิด Apps Script
- `snippet-popup.html` — popup สำหรับเปลี่ยนเส้นทางผู้ใช้จากลิงก์เดิมไปหน้า GitHub Pages

## สถานะโค้ด Google Apps Script

หน้า `/exec` เปิดเผยเฉพาะ Web App ที่ deploy แล้ว และไม่เปิดเผย source code ฝั่ง server เช่น `Code.gs` ผ่าน URL สาธารณะ จึงยังไม่สามารถดึง source ฝั่ง Apps Script ออกจาก deployment ID เพียงอย่างเดียวได้

เพื่อให้ backup ครบ 100% ต้องมีอย่างใดอย่างหนึ่งต่อไปนี้:

1. URL หน้า Apps Script Editor ของโปรเจกต์ (`https://script.google.com/d/<SCRIPT_ID>/edit`)
2. `SCRIPT_ID` ของโปรเจกต์
3. ไฟล์ source จาก Apps Script เช่น `Code.gs`, HTML/JS/CSS ทั้งหมด

เมื่อได้ SCRIPT_ID ให้เก็บ source ไว้ใน `media-system/apps-script/` และใช้ `clasp` เพื่อ sync กับ GitHub

> หมายเหตุ: repo `rta-tuning` มี `.clasp.json` อยู่แล้ว แต่ชี้ไปยังโปรเจกต์ Apps Script คนละระบบ (โฟลเดอร์ `apps-script/` ของระบบจัดทำเอกสารคดี) จึงไม่ควรนำไปใช้ทับกับระบบ media โดยตรง

# Media System Migration Prep

เป้าหมาย: เตรียมย้ายระบบวิเคราะห์วิดีโอ/เสียง/เอกสารออกจาก Google Apps Script โดยไม่กระทบระบบใช้งานจริง

## สถานะปัจจุบัน
- หน้าใช้งานจริง: `media.html` บน GitHub Pages
- ระบบจริง: Google Apps Script Web App (`/exec`)
- ฐานผลวิเคราะห์เดิม: Google Sheet `ผลวิเคราะห์วิดีโอและเสียง (Gemini AI)`
- ยังไม่เปลี่ยน `media.html` และยังไม่ปิด Apps Script เดิม

## สถาปัตยกรรมเป้าหมาย
GitHub Pages -> API/Edge -> Supabase Auth + Postgres + Storage -> Gemini API

Cloudflare สามารถเสริมในชั้น CDN/Worker/Proxy ภายหลังได้ โดยไม่จำเป็นต้องใช้ในการเริ่ม migration

## หลักการย้าย
1. Freeze schema เดิมและทำ data mapping
2. สร้างฐานใหม่แบบ private ใน Supabase
3. Import ข้อมูลย้อนหลังจาก Google Sheet
4. ทำ frontend/backend ใหม่แบบคู่ขนาน
5. ทดสอบ Upload / Analyze / Save / History / Login
6. เปรียบเทียบผลกับ Apps Script เดิม
7. Cutover เฉพาะเมื่อผ่าน UAT
8. เก็บ Apps Script เดิมเป็น fallback ชั่วคราว

## ข้อมูลที่ห้ามเก็บใน public GitHub
- ข้อมูลผู้ใช้จริง
- ผลวิเคราะห์จริง
- ไฟล์วิดีโอ/เสียง/เอกสารจริง
- API keys / service-role keys / secrets

ไฟล์ในโฟลเดอร์นี้เป็นเฉพาะ schema, mapping และ migration code เท่านั้น

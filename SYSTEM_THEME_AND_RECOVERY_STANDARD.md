# SYSTEM THEME & RECOVERY STANDARD — Chatbot ศูนย์ข้อมูล

อัปเดต: 2026-08-14

## 1) Recovery points ที่ล็อกไว้แล้ว

### A. GitHub ก่อนเริ่มชุด Pastel/Robot
- Branch: `backup/pre-theme-2026-08-14`
- Commit: `c8caf39a2d13c25e3da43077684afec4dd0bc806`
- ใช้เป็นหลักฐาน/จุดย้อนของ GitHub ก่อนเริ่มธีมใหม่
- หมายเหตุสำคัญ: `gate_login_v11_unified.html` ในจุดนี้เป็น overlay ที่ออกแบบให้ฝังใน Dashboard ไม่ใช่ standalone `gate_login.html` ของ Production จึงห้ามนำไฟล์ Login นี้ไปวางทับ Production ตรง ๆ

### B. GitHub ปัจจุบันก่อนแก้ Production รอบใหม่
- Branch: `backup/current-before-production-fix-2026-08-14`
- Commit: `43a37a48bd85a4c550a7699b611a117a0ac8ac15`
- เก็บ SAFE v14 และเอกสารแนวทางไว้ครบ

> GitHub backup ไม่เท่ากับ Apps Script deployment backup. สำหรับ Apps Script ให้เก็บ deployment/version ที่เข้า Dashboard ได้จริงเป็น Production baseline แยกต่างหาก

---

## 2) โครงสร้างระบบที่ต้องรักษา

```text
GitHub Pages / linebot.html
        ↓
Apps Script Web App /exec
        ↓
doGet()
        ↓
ตรวจสิทธิ์ของระบบเดิม
   ├── ไม่ผ่าน → gate_login.html
   └── ผ่าน    → Dashboard.html
                       ↓
                 Search / LINE / บัญชีนัด / ฐานข้อมูล / Settings
```

หลักสำคัญ: Theme เป็น presentation layer เท่านั้น ห้ามเปลี่ยน authentication / routing / business logic เพื่อให้หน้าตาสวยขึ้น

---

## 3) การเปลี่ยนธีมที่อนุญาต

### รูปแบบ A — CSS-only (แนะนำที่สุด)
ใช้เมื่อ DOM และ logic ระบบเดิมทำงานปกติ
- เปลี่ยนสี
- พื้นหลัง
- font
- border / radius
- shadow
- ปุ่ม
- card
- table
- input/select/textarea
- responsive

ห้ามแก้ JavaScript, function, id, handler, google.script.run, token, session, cache

### รูปแบบ B — Static launcher skin
ใช้กับ GitHub `linebot.html`
- หน้าโหลดนิ่ง
- progress bar ได้
- ไม่มี Robot animation
- ทำหน้าที่โหลด Web App URL เดิมเท่านั้น
- ไม่สร้าง authorization logic เพิ่ม

### รูปแบบ C — Login visual skin
ใช้กับ `gate_login.html` เดิมที่ Login ได้จริง
- เพิ่ม `<style>` ต่อท้ายไฟล์เดิม
- ไม่แทนที่ script เดิม
- ไม่แก้ submit / verify / redirect / session / token
- ซ่อน mascot/robot ได้ด้วย CSS

### รูปแบบ D — Structural redesign (ห้ามใช้ในรอบนี้)
เป็นการย้าย DOM, เปลี่ยน id, rewrite JS หรือเปลี่ยน routing/auth flow
ต้องทำใน clone/test project เท่านั้น และไม่ใช่งาน Theme ปกติ

---

## 4) SAFE v14 — 3 ไฟล์ที่เตรียมไว้

### 1. `safe-v14/linebot_static.html`
- GitHub launcher แบบ static
- ไม่มี Robot
- ไม่มี auth logic ใหม่
- DASH_URL เดิม

### 2. `safe-v14/gate_login_theme_only.html`
- CSS only
- ไม่มี JavaScript
- ไม่แก้ `verifyDashboardCode()`
- ไม่สร้าง token
- ไม่ redirect เอง
- ซ่อน Robot/animation ด้วย CSS
- ต้องเพิ่มลงใน `gate_login.html` เดิมที่ใช้งานได้จริง ไม่ใช่วางแทนทั้งไฟล์

### 3. `safe-v14/dashboard_theme_only.html`
- CSS only
- ไม่มี JavaScript
- ไม่เพิ่ม event listener
- ไม่แตะ Search / LINE / appointment / data / permission
- เพิ่มก่อน `</body>` ของ Dashboard เดิม

---

## 5) สิ่งที่ห้ามแก้เพื่อเปลี่ยน Theme

- `doGet()`
- `_isDashboardRequestAuthorized_()`
- `_isDashboardAccessTokenAuthorized_()`
- `verifyDashboardCode()`
- Token / CacheService / Session / Properties logic
- `google.script.run` calls
- Search handlers
- LINE API handlers
- appointment logic
- Google Sheet IDs / sheet names
- trigger setup
- permission logic
- menu ids / page ids / data attributes

ถ้าต้องแก้รายการข้างบน แปลว่าไม่ใช่ Theme change แล้ว ต้องเปิดเป็นงานระบบแยกต่างหาก

---

## 6) ขั้นตอนนำเข้า Production ที่ถูกต้อง

### Phase 0 — Recovery first
1. เลือก Apps Script deployment/version ที่เข้า Dashboard ได้จริง
2. เปิด `/exec` โดยตรงและยืนยันว่า Login → Dashboard ผ่าน
3. จด deployment version และ Web App URL เป็น Production baseline
4. ห้ามแก้ `.gs` ในขั้น Theme

### Phase 1 — Login visual only
1. เปิด `gate_login.html` ของ baseline
2. ห้ามลบ code เดิม
3. วางเฉพาะ `<style>` จาก `safe-v14/gate_login_theme_only.html` ก่อน `</body>`
4. Save
5. ทดสอบ: รหัสผิด / รหัสถูก / เข้า Dashboard / ไม่วน Login
6. ถ้าไม่ผ่าน ให้เอา style block ออกทันที — logic ต้องกลับเหมือนเดิม

### Phase 2 — Dashboard theme only
1. เปิด `Dashboard.html` baseline
2. ตรวจว่าไม่มี Login/Gate ซ้ำใน Dashboard
3. วาง `safe-v14/dashboard_theme_only.html` ก่อน `</body>`
4. Save
5. ทดสอบเมนู, Search, บัญชีนัด, LINE/ฐานค้นหา, Settings

### Phase 3 — GitHub launcher
1. ยืนยัน Web App URL ของ deployment ที่ทดสอบผ่าน
2. ตรวจ `DASH_URL` ใน `safe-v14/linebot_static.html`
3. ถ้าตรง ให้แทน `linebot.html` บน GitHub
4. เปิด GitHub Pages และทดสอบ full flow

### Phase 4 — Production acceptance
ต้องผ่านทั้งหมด:
- หน้าโหลดนิ่ง ไม่มี Robot
- Login มีหน้าเดียว
- รหัสผิดแจ้งผิด
- รหัสถูกเข้า Dashboard ครั้งเดียว
- ไม่จอขาว
- ไม่วน Login
- เมนูเดิมครบ
- Search ทำงาน
- บัญชีนัดทำงาน
- LINE/ฐานข้อมูลหลักทำงาน
- ไม่มี console/script error ใหม่จาก Theme

---

## 7) สถานะระบบอื่น ๆ

SAFE v14 ไม่แก้ source ของระบบอื่น เพราะไฟล์ทั้งหมดอยู่ใต้ `safe-v14/` และเป็น launcher/CSS สำหรับ Chatbot เท่านั้น

อย่างไรก็ตาม Apps Script Production เคยมีการแก้ Gate/Login ก่อน SAFE v14 ดังนั้นคำว่า “ระบบอื่นยังทำงาน 100%” ต้องยืนยันด้วย acceptance test หลังกลับ baseline; ห้ามสรุปจากหน้าตาเพียงอย่างเดียว

---

## 8) หลักการ Recovery

- GitHub: ใช้ backup branches ที่ล็อกไว้
- Apps Script: ใช้ Deployment version ที่เคยเข้า Dashboard ได้จริง
- ห้ามใช้ GitHub Login overlay เป็นตัวแทน standalone `gate_login.html`
- ก่อนแก้ทุกครั้งให้จด: deployment version, Web App URL, วันที่/เวลา และไฟล์ที่จะเปลี่ยน
- เปลี่ยนครั้งละ layer: Login visual → Dashboard visual → Launcher
- ทุก layer ต้องผ่าน test ก่อนทำ layer ถัดไป

---

## 9) คำจำกัดความสำหรับงานครั้งต่อไป

เมื่อผู้ใช้สั่ง “เปลี่ยนธีม Chatbot” ให้หมายถึง:
- เปลี่ยน 3 อย่างเท่านั้น: หน้าโหลด, หน้า Login, Dashboard theme
- ไม่มี Robot animation
- ไม่แก้ logic เดิม
- ตรวจ source/บทบาทไฟล์ก่อนให้วางทุกครั้ง
- ต้องมี recovery point ก่อน Production change

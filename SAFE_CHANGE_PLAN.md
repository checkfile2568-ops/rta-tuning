# SAFE CHANGE PLAN — Chatbot ศูนย์ข้อมูล

อัปเดต: 2026-08-14

## เป้าหมาย
ปรับเฉพาะหน้าตา/ธีมของระบบ โดยคงโครงสร้างและ logic เดิมทั้งหมด

## กฎหลักที่ต้องยึด
1. เอาบอท/Robot animation ออกจากหน้าโหลดและหน้า Login ทั้งหมด หรือใช้ภาพนิ่งเท่านั้น ห้ามมีการเดิน/ขยับ/กระพริบที่มีผลต่อ layout
2. ห้ามแก้ `doGet()` จนกว่าจะตรวจ flow เดิมครบ และโดยค่าเริ่มต้นให้คง `doGet()` เดิม
3. ห้ามสร้าง Login ซ้ำใน `Dashboard.html`
4. `gate_login.html` ต้องเป็นหน้า Login เพียงชุดเดียวตามที่ `doGet()` เรียก
5. ห้ามเปลี่ยนชื่อ element id, function, `google.script.run`, token/session/cache logic, handler หรือ permission ของ Login เดิมโดยไม่ได้ตรวจ source เดิมครบก่อน
6. `Dashboard.html` เปลี่ยนได้เฉพาะ CSS/theme visual: สี, พื้นหลัง, ขอบ, เงา, ปุ่ม, การ์ด, ตาราง, input และ responsive
7. ห้ามเปลี่ยนเมนู, DOM structure, data source, search, LINE, appointment, trigger, permissions หรือ business logic
8. GitHub `linebot.html` ให้เป็น launcher แบบนิ่ง: แสดงหน้าโหลดธีมใหม่แบบ static แล้วเปิด Web App URL เดิมใน iframe/แท็บ โดยไม่เพิ่ม authorization logic ของตัวเอง
9. ทุกครั้งก่อนนำเข้า Production ต้องตรวจว่าไฟล์ที่จะวางตรงกับบทบาทจริงของระบบ:
   - `linebot.html` = GitHub launcher
   - `gate_login.html` = Apps Script login page
   - `Dashboard.html` = ระบบหลัก
   - `.gs` = server-side logic
10. ทุกการเปลี่ยนแปลงต้องทำบนสำเนา/เวอร์ชันทดลองก่อน แล้วทดสอบ flow ครบ: เปิดระบบ → Login → Dashboard → Search → LINE/ฐานข้อมูลที่สำคัญ ก่อน Deploy Production

## Flow ที่ต้องคงไว้
GitHub Launcher → Apps Script `/exec` → `doGet()` → ถ้ายังไม่ผ่านสิทธิ์เปิด `gate_login.html` → ผ่านสิทธิ์แล้วเปิด `Dashboard.html`

## รูปแบบหน้าตาใหม่
- Soft Pastel Modern
- ชมพู / ฟ้า / ขาว
- หน้าโหลดนิ่ง ไม่มี Robot animation
- หน้า Login ไม่มี Robot animation ใช้ไอคอน/ภาพนิ่งได้
- Dashboard ใช้ Theme CSS-only

## ขั้นตอนแก้ครั้งถัดไป
1. กลับไปใช้ deployment/version ที่ทำงานปกติเป็น baseline
2. ดึง source ของ baseline ที่เกี่ยวข้องกับ Login และ Dashboard มาตรวจให้ครบ
3. แยก logic ออกจาก visual ให้ชัด
4. ทำ `linebot.html` แบบ static loader ใหม่
5. ทำ `gate_login.html` โดยคง logic baseline 100% แล้วเปลี่ยนเฉพาะ visual
6. ใช้ Theme CSS-only กับ Dashboard
7. ตรวจว่าไม่มี `#dash-gate` ซ้ำใน Dashboard
8. ทดสอบบนสำเนาก่อน Production

## ข้อห้าม
- ห้ามเพิ่ม token/session flow ใหม่จากการคาดเดา
- ห้ามย้าย Login เข้า Dashboard
- ห้ามใช้ Robot animation อีกในระบบนี้
- ห้าม Deploy ก่อนตรวจความเข้ากันได้ของไฟล์กับ flow จริง

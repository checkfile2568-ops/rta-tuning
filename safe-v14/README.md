# SAFE v14 — เปลี่ยน 3 อย่างเท่านั้น

## ผลการย้อนตรวจต้นทาง
- จุดก่อนเริ่มธีม/Robot ใน GitHub คือ commit `c8caf39a2d13c25e3da43077684afec4dd0bc806`.
- `linebot.html` จุดนั้นเป็น GitHub launcher ที่โหลด Apps Script URL เดิมใน iframe.
- แต่ `gate_login_v11_unified.html` จุดนั้นระบุชัดว่าให้ “วางก่อน </body> ใน Dashboard.html” และเมื่อรหัสถูกจะเพียงลบ `#dash-gate` ออกจากหน้า จึงเป็น overlay ไม่ใช่ standalone `gate_login.html` ที่ `doGet()` Production เรียก.
- เพราะฉะนั้นห้ามใช้ไฟล์ gate_login จาก GitHub รุ่นนั้นเป็นต้นฉบับ Production อีก.

## ขอบเขตใหม่
เปลี่ยนเพียง 3 อย่าง:
1. หน้าโหลด GitHub: `linebot_static.html` — static, ไม่มีบอท.
2. หน้า Login: `gate_login_theme_only.html` — CSS only, ไม่มี JavaScript, ไม่แก้ token/redirect/session, ซ่อนบอท/animation เท่านั้น.
3. Dashboard: `dashboard_theme_only.html` — CSS only, ไม่แก้ DOM/handler/data/search/LINE/appointment/permission.

## กฎนำเข้า
- ต้องเริ่มจาก Apps Script deployment/source เวอร์ชันที่ Login ใช้งานได้จริงก่อนการแก้ธีม (baseline Production).
- ห้ามแทนที่ server-side `.gs` เพื่อเปลี่ยนธีม.
- ห้ามเปลี่ยน `doGet()`, `_isDashboardRequestAuthorized_()`, `_isDashboardAccessTokenAuthorized_()`, token/cache/session หรือ `verifyDashboardCode()` เพียงเพราะต้องการเปลี่ยนหน้าตา.
- Login theme ให้เพิ่มเฉพาะ `<style>` จาก `gate_login_theme_only.html` ลงใน `gate_login.html` เดิมที่ทำงานได้จริง.
- Dashboard theme ให้เพิ่มเฉพาะ `<style>` จาก `dashboard_theme_only.html` ก่อน `</body>`.
- `linebot_static.html` ใช้แทน GitHub launcher หลังตรวจว่า `DASH_URL` ตรงกับ deployment ที่ใช้งานจริง.

## Acceptance test ก่อน Production
1. เปิด GitHub launcher → หน้าโหลดนิ่ง ไม่มี Robot.
2. Apps Script เปิด Login เพียงหน้าเดียว.
3. ใส่รหัสถูก → Dashboard เปิดครั้งเดียว ไม่วนกลับ Login.
4. ใส่รหัสผิด → แจ้งผิดตาม logic baseline.
5. Search ใช้งานได้.
6. บัญชีนัดใช้งานได้.
7. LINE/ฐานค้นหาสำคัญไม่เปลี่ยน.
8. ไม่มี `#dash-gate` ซ้ำใน Dashboard.

## ห้าม
- ห้าม Robot animation.
- ห้าม patch Login logic จากการคาดเดา.
- ห้ามสร้าง token flow ใหม่.
- ห้าม deploy production ก่อนผ่าน acceptance test.

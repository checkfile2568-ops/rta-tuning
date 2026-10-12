# Phase 6–8 — Pairing และ Application Control

## 1. Apply Database Migration
หลังจากรัน `schema.sql` และ `rls.sql` แล้ว ให้รัน:

`supabase/phase6_8.sql`

Migration เพิ่ม:
- `pairing_requests`
- `paired_devices`
- `application_allowlist`
- Command: `OPEN_APP`, `CLOSE_APP`, `OPEN_URL`

## 2. ตั้งค่า Windows Agent
คัดลอก:

`apps.example.json` → `apps.json`

แก้ Path ให้ตรงกับเครื่องจริง และกำหนดเฉพาะโปรแกรมที่อนุญาต

ใน `config.json` เพิ่ม `allowed_url_hosts` เช่น:

```json
{
  "allowed_url_hosts": ["google.com", "github.com"]
}
```

Agent จะปฏิเสธ URL ที่ไม่ใช่ http/https และโดเมนที่ไม่ได้อยู่ในรายการ

## 3. เพิ่มรายการโปรแกรมใน Supabase
ตัวอย่าง:

```sql
insert into public.application_allowlist(device_id,app_id,label)
values
  ('DEVICE_UUID','chrome','Google Chrome'),
  ('DEVICE_UUID','edge','Microsoft Edge'),
  ('DEVICE_UUID','notepad','Notepad');
```

`app_id` ต้องตรงกับ Key ใน `apps.json`

## 4. Pair มือถือ
1. เปิด `pair-admin.html` บนเครื่องที่ได้รับสิทธิ์
2. Login
3. เลือก PC
4. กดสร้าง QR
5. ใช้มือถือ Scan QR
6. Login ด้วยบัญชีเดียวกัน
7. กดยืนยันเชื่อมต่อ
8. ระบบบันทึก Browser/มือถือใน `paired_devices`

รหัส Pairing ใช้ครั้งเดียวและหมดอายุใน 10 นาที

## 5. เกณฑ์ทดสอบ
- Pairing code หมดอายุแล้วต้องใช้ไม่ได้
- Pairing code ใช้ซ้ำไม่ได้
- OPEN_APP ทำงานเฉพาะ app_id ใน `apps.json`
- CLOSE_APP ทำงานเฉพาะ image_name ที่ผูกกับ app_id
- OPEN_URL ทำงานเฉพาะโดเมนใน `allowed_url_hosts`
- PC Offline แล้ว Dashboard ต้องไม่ส่งคำสั่ง
- Command เกิน 60 วินาทีต้องไม่ Execute

## Security
ระบบนี้ยังไม่มี Remote CMD หรือ Remote PowerShell แบบอิสระ และ Windows Agent ยังเป็นฝ่ายเชื่อมออกไป Backend เท่านั้น

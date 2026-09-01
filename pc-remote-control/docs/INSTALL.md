# คู่มือติดตั้ง PC Remote Control Center

## 1) Supabase Project
Project ใช้งานจริงถูกสร้างแยกจากระบบเดิมแล้ว ชื่อ `pc-remote-control` ใน region `ap-southeast-1`.

สำหรับการติดตั้งใหม่จากศูนย์ ให้รัน Migration ตามลำดับ:

1. `supabase/schema.sql`
2. `supabase/rls.sql`
3. `supabase/phase6_8.sql`
4. `supabase/security_performance.sql`

ไฟล์สุดท้ายเป็น Security/Performance hardening และควรรันทุกครั้งหลังติดตั้งฐานใหม่

## 2) สร้างผู้ใช้ผู้ดูแล
สร้างผู้ใช้ใน Supabase Authentication ก่อน แล้วนำ UUID ของผู้ใช้นั้นมาสร้าง Profile:

```sql
insert into public.profiles(id,display_name,role)
values ('USER_UUID','ผู้ดูแล','ADMIN');
```

ไม่ควรส่งรหัสผ่านผ่านแชตหรือฝังรหัสผ่านไว้ใน GitHub

## 3) สร้าง Device Token
สร้าง Token แบบสุ่มยาวอย่างน้อย 32 ตัวอักษร ห้าม Commit Token ลง GitHub:

```sql
insert into public.devices(owner_id,name,token_hash)
values (
  'USER_UUID',
  'PC-สำนักงาน',
  encode(digest('YOUR_LONG_RANDOM_DEVICE_TOKEN','sha256'),'hex')
)
returning id;
```

เก็บ `id` เป็น DEVICE UUID และเก็บ Token ไว้เฉพาะ Windows เครื่องนั้น

## 4) Edge Function
Deploy `supabase/functions/agent-api/index.ts` ด้วยชื่อ `agent-api`.

Function ใช้ Custom Device Authentication (`x-device-id` + `x-device-token`) และ `service_role` อยู่เฉพาะฝั่ง Supabase Edge Function ไม่อยู่ใน Frontend

## 5) Frontend
`frontend/assets/config.js` ต้องมีเฉพาะ:

- Supabase Project URL
- Publishable key

Publishable key สามารถอยู่ใน Frontend ได้ แต่ห้ามใส่ `service_role`.

## 6) ติดตั้ง Windows Agent
คัดลอก:

`config.example.json` → `config.json`

ตั้ง:

- `device_id`
- `backend_url`
- `allowed_url_hosts`

จากนั้นกำหนด Device Token ใน Windows:

```bat
setx PC_REMOTE_DEVICE_TOKEN "YOUR_LONG_RANDOM_DEVICE_TOKEN"
```

เปิด Command Prompt ใหม่ แล้วรัน `install.bat` แบบ Administrator จากนั้นทดสอบ `run-agent.bat`.

## 7) Application Allowlist
คัดลอก:

`apps.example.json` → `apps.json`

แก้ Path ของ Chrome / Edge / Notepad หรือโปรแกรมที่ต้องการให้ตรงกับเครื่องจริง ระบบจะไม่เปิดโปรแกรมนอก Allowlist

## 8) เกณฑ์ทดสอบก่อน Merge

- Login และ RLS ผ่าน
- Dashboard Online ภายใน 15–30 วินาที
- CPU / RAM / Disk แสดงค่า
- Lock ทำงาน
- ตั้ง Shutdown 30 นาทีและ Countdown ทำงาน
- Cancel Shutdown เรียก `shutdown /a` ได้จริง
- ปิด Agent 45–120 วินาทีเป็น Warning และเกิน 120 วินาทีเป็น Offline
- OPEN_APP ทำงานเฉพาะโปรแกรมใน Allowlist
- OPEN_URL ทำงานเฉพาะโดเมนที่อนุญาต
- Pairing code หมดอายุและใช้ซ้ำไม่ได้

ก่อน Merge เข้า `main` ให้ทดสอบบน Windows เครื่องเป้าหมายจริงก่อน

# คู่มือติดตั้ง Phase 1–5

## 1) สร้าง Supabase Project
สร้าง Project ใหม่สำหรับ PC Remote โดยเฉพาะ แล้วรัน `supabase/schema.sql` และ `supabase/rls.sql`

## 2) สร้างผู้ใช้
สร้างผู้ใช้ใน Supabase Authentication แล้วสร้าง profile:
```sql
insert into public.profiles(id,display_name,role) values ('USER_UUID','ผู้ดูแล','ADMIN');
```

## 3) สร้าง Device Token
สร้าง Token แบบสุ่มยาวอย่างน้อย 32 ตัวอักษร ห้าม Commit ลง GitHub
```sql
insert into public.devices(owner_id,name,token_hash)
values ('USER_UUID','PC-สำนักงาน',encode(digest('YOUR_LONG_RANDOM_DEVICE_TOKEN','sha256'),'hex'))
returning id;
```
เก็บค่า `id` เป็น DEVICE UUID

## 4) Deploy Edge Function
Deploy `supabase/functions/agent-api/index.ts` ชื่อ `agent-api` และเก็บ `SUPABASE_SERVICE_ROLE_KEY` เฉพาะฝั่ง Function

## 5) ตั้งค่า Frontend
แก้ `frontend/assets/config.js` ด้วย Project URL และ public anon key

## 6) ติดตั้ง Windows Agent
คัดลอก `config.example.json` เป็น `config.json`, ใส่ Device UUID และ backend URL จากนั้นตั้ง Token:
```bat
setx PC_REMOTE_DEVICE_TOKEN "YOUR_LONG_RANDOM_DEVICE_TOKEN"
```
เปิด Command Prompt ใหม่ แล้วรัน `install.bat` แบบ Administrator จากนั้นทดสอบ `run-agent.bat`

## 7) เกณฑ์ทดสอบ
- Dashboard Online ภายใน 15–30 วินาที
- CPU/RAM/Disk แสดงค่า
- Lock ทำงาน
- ตั้ง Shutdown 30 นาทีและ Countdown ทำงาน
- Cancel Shutdown ยกเลิกได้
- ปิด Agent 45–120 วินาทีเป็น Warning และเกิน 120 วินาทีเป็น Offline

ก่อน merge เข้า main ให้ทดสอบ Login และ RLS ให้ผ่านก่อน

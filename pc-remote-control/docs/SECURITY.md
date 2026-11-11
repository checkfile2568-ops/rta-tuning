# Security Baseline

1. Browser ใช้เฉพาะ Supabase public anon key + Auth session + RLS
2. `service_role` อยู่เฉพาะ Supabase Edge Function
3. Windows Agent ไม่เปิด HTTP/TCP listener สู่ Internet; Agent เป็นฝ่ายเชื่อมออก
4. Agent รับเฉพาะ Allowlist: LOCK, SLEEP, HIBERNATE, RESTART, SHUTDOWN, CANCEL_SHUTDOWN
5. ไม่มี Remote CMD / PowerShell arbitrary execution
6. Power command หมดอายุใน 60 วินาที และไม่รันคำสั่งเก่าหลังกลับ Online
7. Device token แยกต่อเครื่องและเก็บใน Environment Variable ของ Windows
8. Restart/Shutdown ต้องยืนยันจาก UI ก่อนส่งคำสั่ง
9. Activity Log บันทึกผลสำเร็จ/ล้มเหลว
10. Virtual Display / Screen Control / File Transfer จะทำเป็นโมดูลแยกใน Phase ถัดไป

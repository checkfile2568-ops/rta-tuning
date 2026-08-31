# PC Remote Control Center

ระบบต้นแบบใช้งานจริงระยะที่ 1–5 สำหรับตรวจสอบสถานะและควบคุม Windows จากเว็บ/มือถือ

## สิ่งที่มีในรุ่นนี้

- Supabase Auth + RLS
- Device registry และ heartbeat ทุก 15 วินาที
- สถานะ Online / Warning / Offline จาก `last_seen`
- System metrics: CPU / RAM / Disk / Uptime
- คำสั่งแบบ Allowlist: Lock / Sleep / Hibernate / Restart / Shutdown / Cancel shutdown
- ตั้งเวลาปิดหรือ Restart ด้วยจำนวนวินาที
- Activity log และผลคำสั่ง
- Responsive Dashboard ใช้บนคอมและมือถือ
- Windows Agent แบบ polling โดยไม่เปิดพอร์ตเข้าคอมจากอินเทอร์เน็ต
- Supabase Edge Function สำหรับ Agent โดยเก็บ `service_role` เฉพาะฝั่ง Server

## ยังไม่รวมในรุ่นนี้

Virtual Display, Screen streaming, Mouse/Keyboard remote, Clipboard, Screenshot, File transfer และ Device pairing จะทำในเฟสถัดไปหลัง Power Control ผ่านการทดสอบบน Windows จริง

เริ่มติดตั้งที่ `docs/INSTALL.md`

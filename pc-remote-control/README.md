# PC Remote Control Center

ระบบสำหรับตรวจสอบสถานะและควบคุม Windows จากเว็บ/มือถือ โดยแยก Windows Agent ออกจาก Frontend และใช้ Supabase เป็น Backend/Reatime control plane

## สถานะปัจจุบัน

### Phase 1–5 — สร้างแล้ว รอทดสอบกับ Windows จริง

- Supabase Auth + RLS
- Device registry และ heartbeat ทุก 15 วินาที
- Online / Warning / Offline จาก `last_seen`
- CPU / RAM / Disk / Uptime
- Lock / Sleep / Hibernate / Restart / Shutdown / Cancel shutdown
- Shutdown/Restart timer + countdown
- Activity log
- Responsive Dashboard สำหรับคอมและมือถือ
- Windows Agent ไม่เปิดพอร์ตเข้าจาก Internet
- Supabase Edge Function เก็บ `service_role` ฝั่ง Server เท่านั้น

### Phase 6–8 — เพิ่มลง branch แล้ว รอ Apply migration และทดสอบ

- QR mobile pairing แบบรหัสใช้ครั้งเดียว อายุ 10 นาที
- ตาราง `paired_devices` และ `pairing_requests`
- Application allowlist ต่อเครื่อง
- เปิด/ปิดโปรแกรมเฉพาะรายการใน `apps.json`
- เปิด URL เฉพาะ `http/https` และเฉพาะโดเมนใน `allowed_url_hosts`
- Agent v1.1.0
- Dashboard เพิ่ม Application Control และลิงก์เชื่อมต่อมือถือ
- ไม่มี Remote CMD/PowerShell arbitrary execution

ให้ Apply `supabase/phase6_8.sql` หลัง `schema.sql` และ `rls.sql`

## ยังไม่รวม / เฟสถัดไป

- Phase 9: Screenshot + Clipboard แบบผู้ใช้กดอนุญาต
- Phase 10: Virtual Display integration
- Phase 11: Remote screen แบบ low latency
- Phase 12: Mouse / Keyboard remote และ Multi-display

Remote Display จะไม่ส่ง Frame ผ่าน Database และจะไม่เขียน Kernel Driver ใหม่โดยไม่จำเป็น

เริ่มติดตั้งที่ `docs/INSTALL.md`

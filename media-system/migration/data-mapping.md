# Legacy Data Mapping

แหล่งข้อมูลเดิม: Google Sheet `ผลวิเคราะห์วิดีโอและเสียง (Gemini AI)`

| คอลัมน์เดิม | ปลายทางใหม่ | หมายเหตุ |
|---|---|---|
| วันที่บันทึก | `analysis_jobs.created_at` | ต้องแปลงปี พ.ศ. เป็น ค.ศ. และ timezone Asia/Bangkok |
| ผู้ใช้ | user/profile mapping | ข้อมูลเดิมบางแถวอาจว่าง ต้องกำหนด fallback |
| ประเภท | `media_files.media_type` | map วิดีโอ/เสียง/เอกสาร/รูปภาพ |
| โหมด | `analysis_jobs.mode` | เก็บข้อความเดิมเพื่อ compatibility |
| ชื่อไฟล์ | `media_files.original_name` | ใช้รวมรายการของไฟล์เดียวกันเป็น 1 job |
| เวลา/หน้า | `analysis_items.page_or_time` | เก็บเป็น text ก่อนเพื่อไม่ทำข้อมูลเดิมสูญหาย |
| หัวข้อ | `analysis_items.title` | รายการ detail ต่อ job |
| รายละเอียด | `analysis_items.detail` หรือ `analysis_jobs.summary` | แถว `(สรุป)` ให้ย้ายเข้า summary |

## กติกาจัดกลุ่มข้อมูลย้อนหลัง
- แถวที่มีไฟล์เดียวกัน + วันที่บันทึกเดียวกัน + โหมดเดียวกัน ให้พิจารณาเป็น analysis job เดียว
- แถวที่ `เวลา/หน้า = (สรุป)` ให้ถือเป็น summary ของ job
- แถวอื่นเป็น `analysis_items`
- เก็บค่าต้นฉบับของ `เวลา/หน้า` เป็นข้อความ แม้ Google Sheets จะตีความเวลาเกิน 24 ชั่วโมงเป็น `1 day, ...`
- ก่อน import ให้สร้าง checksum เพื่อป้องกันข้อมูลซ้ำ

## Validation ก่อน cutover
- จำนวน job หลัง import ต้องตรงกับจำนวนกลุ่มไฟล์/เวลา/โหมดเดิม
- จำนวน detail item ต้องตรงกับแถว non-summary เดิม
- ตรวจสุ่มวิดีโอ, เอกสาร และไฟล์ที่มีเวลาเกิน 24 ชั่วโมง
- ห้ามลบหรือแก้ Google Sheet เดิมในขั้น migration

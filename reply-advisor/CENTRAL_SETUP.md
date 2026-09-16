# Reply Advisor Central — ขั้นตอน Deploy Apps Script

ฐานข้อมูลกลางสร้างแล้วใน Google Sheet:
https://docs.google.com/spreadsheets/d/1opbSrWYL18uAdVwxTlm2UDKw-ofCPPMvpwtPjTIGC38/edit

1. เปิด Google Sheet → Extensions → Apps Script
2. ลบโค้ดตัวอย่าง และวาง `reply-advisor/apps-script/Code.gs`
3. กด Deploy → New deployment → Web app
4. Execute as: Me
5. Who has access: Anyone
6. Copy URL ที่ลงท้าย `/exec`
7. นำ URL ไปใส่ `API_URL` ในหน้า GitHub Reply Advisor

ระบบหน้าเว็บโหลดตามลำดับ:
1. Apps Script / Google Sheet กลาง
2. Cache ล่าสุดในอุปกรณ์
3. ฐานสำรองที่ฝังในหน้าเว็บ

หมายเหตุ: endpoint นี้อ่านฐานคำตอบอย่างเดียว และไม่เก็บคำถามประชาชนลงฐานกลางโดยอัตโนมัติ

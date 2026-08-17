# รายงานรีวิวและข้อเสนอแก้ไขระบบ LINE Chatbot ศาลจังหวัดลพบุรี

วันที่ตรวจ: 17 สิงหาคม 2026

## บทสรุปผู้บริหาร

ระบบมีโค้ดประมาณ 21,870 บรรทัดใน 15 ไฟล์ JavaScript, HTML และ manifest. ไฟล์เดิมทั้งหมดผ่าน Node.js syntax check แต่การผ่าน syntax ไม่ได้แปลว่าผ่าน runtime หรือ security review. จุดเสี่ยงหลักอยู่ที่ webhook batch event, การยืนยัน LINE signature, server-side authorization ของ Dashboard, debug endpoint, helper global ซ้ำ และ scheduled runner หลายชุด

ข้อเสนอที่เลือกคือ **ไม่แก้ทับโค้ดเดิมและไม่แตะ Spreadsheet production** แต่สร้าง fixed bundle แยกใน `/home/ubuntu/05-line-bot-fixed/` เพื่อทดสอบบน Spreadsheet สำเนาก่อน. แนวทางนี้รักษาชื่อชีต โครงสร้างคอลัมน์ ค่า configuration และรูปแบบข้อความ/Flex เดิม พร้อมเปิดทาง rollback ได้ชัดเจน

> สถานะปัจจุบัน: จัดทำ fixed bundle และเอกสารแล้ว, syntax check ผ่าน, pure helper/HMAC test ผ่าน, ยังไม่ได้ deploy และยังไม่ได้เปลี่ยน Trigger หรือข้อมูล production

## ขอบเขตและหลักฐานที่ตรวจ

| รายการ | ผลตรวจ |
|---|---|
| Platform | Google Apps Script V8, timezone Asia/Bangkok |
| Spreadsheet production | `166-AGSJrP4o9ltxCobd--mB6oObViDKdKELc9sipYJ4` ตามข้อมูลที่ได้รับ |
| Spreadsheet staging | `1llnzNFkDirqGAxqIg77azh8FZBbSadFGUvNYfUM4xcc` |
| Web App | anonymous access, execute as deploying user |
| WEB_ADMIN_KEY | ต้องคงค่า `4255` |
| LINE transport | มี implementation ซ้ำระหว่างไฟล์หลัก, `Performance.js` และ `Schedulefix.js` |
| Trigger | Court TV, scheduled notify, Pikad expiry และ warm-up มีความเสี่ยงซ้ำ/ตรวจไม่ครบ |
| Syntax | ไฟล์เดิมและ fixed bundle ผ่าน syntax check ตามที่รัน |
| Production mutation | ไม่ได้ทำ |

## รายการปัญหาหลัก

### E01 — Webhook ประมวลผลเฉพาะ event แรก ระดับ P0

`doPost` เดิมอ่าน `contents.events[0]` ทำให้ event ที่ LINE ส่งมาใน batch สูญหาย. ผลกระทบคือข้อความ, รูปภาพ, พิกัด, follow หรือ event อื่นที่อยู่ลำดับถัดไปไม่ถูกประมวลผล

`FIXED_Webhook.js:581-589` วนประมวลผลทุก event และห่อ error เป็นราย event เพื่อไม่ให้ event หนึ่งทำให้ batch ทั้งชุดหยุด

### E02 — LINE signature ไม่ถูกบังคับใช้ ระดับ P0

Web App anonymous ที่รับ POST โดยไม่มีการตรวจ `x-line-signature` สามารถรับ payload ปลอมได้. หาก payload ผ่าน router อาจทำให้สร้างสมาชิก, เขียน Location/Photo, เปลี่ยน state หรือเรียก LINE API

fixed code เพิ่ม HMAC-SHA256 ด้วย `LINE_CHANNEL_SECRET` และ constant-time comparison. อย่างไรก็ตาม Apps Script บาง deployment อาจไม่ส่ง HTTP header เข้า `e.headers`; ดังนั้นต้องยืนยันเส้นทาง header/proxy ก่อนตั้ง `LINE_SIGNATURE_MODE=REQUIRED`

### E03 — Event shape และ payload validation ไม่ครบ ระดับ P0/P1

Payload ที่ไม่มี `postData`, JSON ไม่ถูกต้อง, `events` ไม่ใช่ array, event ไม่มี source/userId หรือ message ไม่มีโครงสร้างที่คาด อาจทำให้เกิด exception หรือ lookup ด้วยค่าว่าง

fixed code ตรวจ body size, JSON, events array, จำนวน event และ `source.userId` ก่อนประมวลผล. Event ที่ไม่มี userId ถูกข้ามและไม่สร้างสมาชิกค่าว่าง

### E04 — `getAdminIds` type error ระดับ P0

ค่าจาก config อาจเป็น array, object, boolean หรือค่าว่าง แต่ implementation เดิมเรียก `.split(',')` โดยตรง จึงพบ production symptom `raw.split is not a function`

fixed code แปลงชนิดอย่างปลอดภัย รองรับ string, array และ object เฉพาะกรณีมี value ที่ระบุได้ ไม่แปลง object ที่เป็น config ทั้งก้อนให้กลายเป็น LINE ID ปลอม

### E05 — LINE transport retry และ fallback ไม่สม่ำเสมอ ระดับ P1

`_linePost` และ `safeSendReply` หลาย implementation ถูก override ข้ามไฟล์ ทำให้พฤติกรรมขึ้นกับลำดับโหลด. บางเส้นทางไม่มี retry และบางเส้นทางไม่มี fallback push เมื่อ reply token หมดอายุ

fixed core ใช้ retry เฉพาะ HTTP 429/5xx, backoff แบบจำกัด, คืน response code/body สม่ำเสมอ และ fallback push เมื่อมี userId. ไม่ retry 4xx ที่เกิดจาก payload ผิดเพื่อลดการส่งซ้ำและ quota waste

### E06 — Court TV นับผลส่งสำเร็จก่อนตรวจ HTTP ระดับ P1

`checkTVStatusAndNotify` เดิมเพิ่ม `sentCount` โดยไม่ได้ยืนยันผล response ของ `sendLineNotification` ทำให้ Dashboard/report แสดงผลดีเกินจริงแม้ LINE API ปฏิเสธ

fixed core ตรวจผล `ok/success/responseCode` ก่อนนับ และรวบรวม error summary แยกตาม target

### E07 — เปิด Spreadsheet ซ้ำและทำงานหนักก่อนกรอง event ระดับ P1

การเปิด Spreadsheet และ lookup ผู้ใช้ก่อนคัดกรอง event ที่ไม่ต้องใช้ฐานข้อมูลเพิ่ม latency และ quota โดยเฉพาะเมื่อ batch มีหลาย event

fixed webhook ตรวจ body, signature, event shape, duplicate และ group filter ก่อนเปิดสมาชิกชีตแบบ lazy เฉพาะเมื่อจำเป็น. cache helper ถูกแยกเป็น source-of-truth ใน fixed core

### E08 — Dashboard page gate ไม่ใช่ command authorization ระดับ P0

การตรวจ `WEB_ADMIN_KEY` ใน `doGet` ป้องกันเฉพาะการเปิดหน้า ไม่ได้ป้องกันการเรียก server function ที่เขียนข้อมูลผ่าน `google.script.run` หากฟังก์ชันนั้นไม่มี guard ภายใน

fixed bundle เพิ่ม `FIXED_AdminAuth.js` และ `FIXED_SecureDashboardDispatch.js`. dispatcher ตรวจ session/admin authorization และ allowlist ก่อนเรียก function. การติดตั้งจริงต้องเปลี่ยน Dashboard ให้เรียก dispatcher หรือเพิ่ม guard ต้นฟังก์ชัน mutating โดยตรง

### E09 — `debugSettings=1` เปิดข้อมูลภายในมากเกินไป ระดับ P0/P1

settings เดิมอาจมี token, secret, folder ID, sheet ID, group ID, URL และ internal keyword. HTML escaping ป้องกันเพียง injection บางชนิด ไม่ได้ป้องกันข้อมูลรั่ว

fixed admin auth คืน masked settings และตรวจสิทธิ์ก่อน. ใน production แนะนำปิด debug endpoint หรืออนุญาตเฉพาะ owner/email allowlist และคืนเฉพาะ status ที่จำเป็น

### E10 — XSS/URL injection ใน Dashboard ระดับ P1/P2

`escapeHtml` ช่วยป้องกัน attribute break-out แต่ไม่ป้องกัน scheme อันตรายเมื่อค่าจากชีตถูกนำไปใส่ `href`/`src`. ค่าที่เริ่มด้วย `javascript:` หรือ data URL อาจเป็นความเสี่ยงหากถูก render โดยตรง

แนวทางถัดไปคือเพิ่ม URL allowlist รับเฉพาะ `https:` และโดเมนที่กำหนด หรือเปลี่ยนเป็น DOM property ที่ตรวจ scheme ก่อน ไม่ควรพึ่งการ escape อย่างเดียว

### E11 — Global helper และ scheduled runner ซ้ำ ระดับ P1/P2

พบ global function ซ้ำ 20 ชื่อ และ scheduled runner หลายชุด ได้แก่ `runScheduledNotify`, `runScheduledNotify_v2`, `checkAndNotify` และ `checkTVStatusAndNotify`. การใช้ `ZZZ_` เพื่อ override ทำให้ load order เป็นตัวกำหนด behavior และทำให้การตรวจสอบยาก

fixed bundle แยก source-of-truth และมี `FIXED_TriggerControl.js` สำหรับ audit/รวม Trigger. ต้องเรียก `setupFixedTriggers()` เฉพาะ staging หลังตรวจ `auditFixedTriggers()` และหลังยืนยันค่า config

## ผลกระทบต่อฟังก์ชันระบบ

| ระบบ | ความเสี่ยง | สิ่งที่ fixed bundle รักษาไว้ |
|---|---|---|
| LINE reply | reply token หมดอายุ, ส่งซ้ำ, batch หาย | ข้อความ, Flex, altText และลำดับ router |
| Court TV | online/offline แจ้งผิด, sent count คลาดเคลื่อน | state key, target, ข้อความ และ transition เดิม |
| Scheduled Notify | runner ซ้ำ, ส่งซ้ำ, trigger หาย | ตาราง, target, card, expiry และ log เดิม |
| Pikad | หลายรูป/พิกัดผูก session ผิดได้จาก flow เดิม | schema และชื่อ field เดิม; ไม่ทำ migration อัตโนมัติ |
| Search/KB | helper ซ้ำและ role filter ไม่ตรง | keyword, database source และ response format เดิม |
| General Info | endpoint ไม่สม่ำเสมอ | READ_SHEET, SAVE_VALUE, READ_SAVED |
| Dashboard | key ผ่านหน้าแต่ command ไม่ถูก guard | key `4255`, theme และ flow เดิมเป็นหลัก |

## สถาปัตยกรรมที่แนะนำ

ให้เลือก source-of-truth เพียงชุดเดียวหลัง staging ผ่านดังนี้

| หมวด | source-of-truth ที่เลือก |
|---|---|
| config/cache/user/photo helper | fixed core ตามพฤติกรรมที่ผ่านการทดสอบจาก `Performance.js` |
| LINE transport/reply/notification | fixed core ตาม retry/fallback จาก `Schedulefix.js` |
| webhook | fixed webhook เท่านั้น |
| scheduled notification | `runScheduledNotify_v2` เท่านั้น |
| Court TV | `checkTVStatusAndNotify` แยกจาก scheduled notification |
| health check | fixed health check แบบ read-only |
| dashboard auth | fixed admin auth + secure dispatcher |

ไม่ควรเพิ่มไฟล์ `ZZZ_*` override ชุดใหม่แบบถาวร. หลัง migration สำเร็จให้ลบ duplicate implementation หรือเปลี่ยนชื่อ legacy เป็น private/archived file แล้วตรวจ global scan ซ้ำ

## Test evidence

### Static test

รันคำสั่งต่อไปนี้ใน fixed bundle:

```bash
cd /home/ubuntu/05-line-bot-fixed
for f in *.js; do node --check "$f" || exit 1; done
node test_fixed_code.js
```

ผลที่ได้:

```text
fixed helper tests: PASS
```

จำนวนบรรทัด fixed bundle ณ รอบส่งมอบ:

| ไฟล์ | บรรทัด |
|---|---:|
| `FIXED_AdminAuth.js` | 274 |
| `FIXED_CoreHelpers.js` | 569 |
| `FIXED_HealthCheck.js` | 235 |
| `FIXED_SecureDashboardDispatch.js` | 179 |
| `FIXED_TriggerControl.js` | 134 |
| `FIXED_Webhook.js` | 596 |
| `test_fixed_code.js` | 71 |

### สิ่งที่ยังต้องทดสอบบน staging

ยังไม่ได้ทดสอบการเรียก `google.script.run` จริง, HMAC ผ่าน deployment จริง, LINE API response จริง, trigger runtime, Dashboard ทุกเมนู, Court TV endpoint, scheduled catch-up และ regression กับไฟล์ legacy ทั้งชุด. เหตุผลคือการทดสอบเหล่านี้ต้องมี Apps Script deployment/staging credentials และอาจเขียนข้อมูลหรือส่งข้อความ จึงไม่ควรทำกับ production โดยไม่ได้รับอนุญาตเฉพาะกิจ

## การตัดสินใจที่แนะนำก่อน deploy

1. **ให้ staging เป็นด่านบังคับ** โดยใช้ Spreadsheet สำเนาและ LINE test channel
2. **ตั้ง `LINE_CHANNEL_SECRET` และทดสอบ signature path** ก่อนเปิด REQUIRED
3. **ยืนยัน Dashboard integration** เพราะ server dispatcher อย่างเดียวไม่สามารถเปลี่ยนการเรียก `google.script.run` เดิมโดยอัตโนมัติจนกว่าจะเปลี่ยน client wrapper หรือเพิ่ม guard ในแต่ละ endpoint
4. **รวม Trigger หลัง audit** ไม่ลบ trigger production ในรอบรีวิว
5. **รักษา `WEB_ADMIN_KEY=4255`** แต่ไม่ hardcode key ใน GitHub และไม่เก็บไว้ใน source สาธารณะ
6. **ปิดหรือ mask debug settings** ก่อนเปิด Web App anonymous ให้ผู้ใช้ทั่วไปเข้าถึง

## ข้อเสนอเพิ่มเติมเรื่องธีม

ไม่ควรผูก security logic กับ theme. ให้เก็บ theme, สี, font, spacing และ card style ไว้ใน Dashboard layer หรือ config ที่ไม่ใช่ secret. เมื่อเพิ่ม theme ใหม่ต้องตรวจว่าไม่มีการนำค่าจาก Spreadsheet ไปต่อ `innerHTML`, `href` หรือ `src` โดยไม่ผ่าน escaping และ URL allowlist

แนะนำกำหนด design tokens เช่น primary, secondary, background, surface, danger, success และ border ใน object เดียวของ Dashboard เพื่อเปลี่ยนธีมได้โดยไม่แตะ webhook, notification หรือ schema. สีสถานะระบบควรสื่อความหมายคงที่ เช่น ON/healthy, OFF/disabled, warning และ error เพื่อไม่ให้ผู้ดูแลอ่านผล Health Check ผิด

## ข้อสรุป

ระบบเดิมยังมีฐานการทำงานที่นำไปต่อได้ และไม่จำเป็นต้องรื้อ schema หรือรูปแบบแจ้งเตือน. แต่ควรแก้ P0 ก่อน ได้แก่ batch webhook, signature, type guard, server-side authorization และ debug data exposure. fixed bundle ที่จัดทำไว้เป็นชุดสำหรับ staging/ตรวจรับ ไม่ใช่การ deploy production อัตโนมัติ และไม่มีการเปลี่ยนข้อมูลจริงหรือ `WEB_ADMIN_KEY=4255`

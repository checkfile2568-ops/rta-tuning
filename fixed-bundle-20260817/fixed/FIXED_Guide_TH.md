# คู่มือติดตั้งและตรวจรับโค้ดฉบับแก้ไข LINE Chatbot

วันที่จัดทำ: 17 สิงหาคม 2026

เอกสารนี้จัดทำสำหรับโค้ด Google Apps Script ของ LINE Chatbot ศาลจังหวัดลพบุรี โดยมีหลักการสำคัญคือ **แยกไฟล์ฉบับแก้ไขออกจากโค้ดเดิม รักษาชื่อชีต โครงสร้างคอลัมน์ ค่า configuration และรูปแบบข้อความ/Flex เดิม และไม่แตะ Spreadsheet production ระหว่างการตรวจสอบ**

> ห้ามนำไฟล์ fixed ไปวางร่วมกับไฟล์เดิมแล้วกด Deploy ทันที เพราะ `doPost`, helper global และฟังก์ชันที่มีชื่อซ้ำอาจทำให้เกิดการชนกันตามลำดับการโหลดไฟล์ ต้องทำตามลำดับ staging ในเอกสารนี้ก่อนเสมอ

## 1. ไฟล์ที่ส่งมอบ

| ไฟล์ | หน้าที่ | สถานะ |
|---|---|---|
| `FIXED_CoreHelpers.js` | source-of-truth สำหรับ config/cache, `getAdminIds`, LINE transport, reply fallback, notification logging และ Court TV sent-count | สร้างและตรวจ syntax แล้ว |
| `FIXED_Webhook.js` | `doPost` ฉบับรองรับ batch, HMAC, validation, duplicate guard ต่อ event, lazy sheet access และ router เดิม | สร้างและตรวจ syntax แล้ว |
| `FIXED_HealthCheck.js` | health check แบบอ่านอย่างเดียว ตรวจ Trigger, runner ซ้ำ, config สำคัญ และ log ล่าสุด | สร้างและตรวจ syntax แล้ว |
| `FIXED_AdminAuth.js` | ตรวจสิทธิ์ Dashboard ฝั่ง server, mask debug settings และออก session token ชั่วคราว | สร้างและตรวจ syntax แล้ว |
| `FIXED_SecureDashboardDispatch.js` | allowlist dispatcher สำหรับคำสั่ง Dashboard ที่ต้องตรวจสิทธิ์ทุกครั้ง | สร้างและตรวจ syntax แล้ว |
| `FIXED_TriggerControl.js` | audit/รวม Trigger และลบ runner เก่าที่ซ้ำเมื่อผู้ดูแลสั่ง | สร้างและตรวจ syntax แล้ว |
| `test_fixed_code.js` | ทดสอบ pure helper และ HMAC แบบ offline ไม่เชื่อม production | ทดสอบผ่าน |

ผลตรวจล่าสุด: ไฟล์ JavaScript ใน fixed bundle ผ่าน `node --check` ทุกไฟล์ และ `test_fixed_code.js` แสดงผล `fixed helper tests: PASS` โดยยัง **ไม่มีการเรียก Spreadsheet production หรือ LINE production**

## 2. จุดปัญหาที่แก้และตำแหน่งในโค้ดเดิม

| รหัส | จุดเดิม | ผลกระทบ | จุดแก้ใน fixed bundle |
|---|---|---|---|
| E01 | `รหัส.js` ช่วง `doPost` เดิม ประมวลผล `events[0]` | event ที่ 2 เป็นต้นไปใน batch หาย | `FIXED_Webhook.js:543-595` วนทุก event |
| E02 | `รหัส.js` ช่วง parse webhook ไม่มี HMAC ที่บังคับใช้จริง | รับ payload ปลอมได้ | `FIXED_Webhook.js:111-132, 558-562` |
| E03 | duplicate guard ใช้ CacheService TTL 600 วินาที | กันซ้ำได้แบบ best-effort เท่านั้น | คง guard เดิม แต่เรียกต่อ event และแยกผล duplicate |
| E04 | `getAdminIds` เดิมเรียก `.split()` โดยไม่ตรวจชนิด | เกิด `raw.split is not a function` | `FIXED_CoreHelpers.js` มี type guard รองรับ string/array/object/ค่าว่าง |
| E05 | `_linePost` เดิมบางชุดไม่มี retry | rate limit/5xx ทำให้แจ้งเตือนล้มเหลว | `FIXED_CoreHelpers.js` retry เฉพาะ 429/5xx ด้วย backoff |
| E06 | `safeSendReply` เดิมไม่มี fallback push ในบางชุด | reply token หมดอายุแล้วผู้ใช้ไม่ได้รับข้อความ | `FIXED_CoreHelpers.js` รองรับ fallback push เมื่อมี userId |
| E07 | `checkTVStatusAndNotify` นับส่งสำเร็จก่อนตรวจผล HTTP | Dashboard/log รายงานสำเร็จเกินจริง | `FIXED_CoreHelpers.js` นับเมื่อ response สำเร็จจริง |
| E08 | Dashboard ตรวจ key ที่ `doGet` แต่ mutating server functions ไม่มี guard ซ้ำ | เรียกคำสั่งเขียนโดยไม่ผ่าน page gate ได้ | `FIXED_AdminAuth.js` และ `FIXED_SecureDashboardDispatch.js` |
| E09 | `debugSettings=1` คืน settings มากเกินจำเป็น | เสี่ยงรั่ว token, IDs, secret และ internal config | `getMaskedSettingsPayload_FIXED` mask sensitive key |
| E10 | helper global ซ้ำระหว่าง `รหัส.js`, `Performance.js`, `Schedulefix.js`, `ZZZ_*` | behavior ขึ้นกับ load order | fixed bundle ใช้ชื่อ `FIXED_*`; migration ระยะถัดไปต้องเหลือ source-of-truth เดียว |
| E11 | scheduled runner หลายชุดและ Health Check ตรวจไม่ครบ | ส่งซ้ำหรือ Dashboard แสดงสุขภาพคลาดเคลื่อน | `FIXED_TriggerControl.js` และ `FIXED_HealthCheck.js` |

## 3. จุดค้นหาฐานข้อมูลและ Schema ที่ต้องรักษา

โค้ดฉบับแก้ไขไม่ได้เปลี่ยนชื่อชีตหรือสร้าง schema ใหม่โดยอัตโนมัติ จุดอ้างอิงหลักมีดังนี้

| งาน | จุดค้นหาเดิม | ค่าที่ต้องรักษา |
|---|---|---|
| สมาชิก LINE | `SHEETS.MEMBERS`, `getUserByLineId`, `fixedWebhookSheetMembers_` | ชื่อชีต Members และคอลัมน์เดิม โดยเฉพาะ LINE ID, ชื่อ, role, status, state |
| Config | `getConfig`, `setConfig`, `SHEETS.CONFIG` | key เดิม เช่น `WEB_ADMIN_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `NOTIFY_STATUS`, `TV_NOTIFY_STATUS` |
| Court TV state | `TV_NOTIFY_STATE_KEY`, `fetchCourtTVStatus`, `checkTVStatusAndNotify` | state key และ target/ข้อความแจ้งเตือนเดิม |
| Scheduled Notify | ตาราง schedule และ `runScheduledNotify_v2` | เวลา, target, Flex/card, expiry และ log เดิม |
| Notification log | `NOTIFY_LOG` และ helper ที่เขียน log | คอลัมน์เดิม ห้ามเปลี่ยน header จาก fixed bundle |
| พิกัด/รูป | `SHEETS.LOCATION`, `_downloadAndSavePhoto`, `linkPhotoToSession` | Loc ID, row index, URL, ชื่อไฟล์ และ session flow เดิม |
| Search/KB | `smartSearchKB`, `smartSearchDB`, `routeSearchCommandV2` | keyword, database source, role filtering และคำตอบเดิม |
| General Info | `GeneralInfoAdmin.js` และ `_handleGeneralInfoMessage_` | card mode: READ_SHEET, SAVE_VALUE, READ_SAVED |

หากต้องเพิ่มคอลัมน์หรือเปลี่ยนชื่อชีต ให้ทำเป็น migration แยกต่างหากบนสำเนาเท่านั้น ไม่รวมไว้ใน webhook fixed เพราะ migration ใน webhook เพิ่มความเสี่ยง timeout และทำให้ rollback ยาก

## 4. ลำดับติดตั้งบน Spreadsheet สำเนา

ให้ใช้ Spreadsheet สำเนาทดสอบ `[STAGING_SPREADSHEET_ID]` และ Script Project staging ที่แยกจาก production เท่านั้น

### ขั้นที่ 1: สำรองก่อนติดตั้ง

ดาวน์โหลดหรือคัดลอกไฟล์ Apps Script เดิมทุกไฟล์ เก็บ manifest, Script Properties และรายการ Trigger ไว้เป็นชุด rollback. ห้ามแก้ `[PRODUCTION_SPREADSHEET_ID]` ในขั้นตอนนี้

### ขั้นที่ 2: ตั้ง Script Properties ของ staging

ตั้งค่าอย่างน้อยดังนี้ โดยใช้ค่า token/channel secret ของ staging หรือบัญชีทดสอบที่ผู้ดูแลอนุญาต

| Property | ค่าแนะนำ |
|---|---|
| `SPREADSHEET_ID` | ID ของ Spreadsheet สำเนา |
| `LINE_CHANNEL_ACCESS_TOKEN` | token ของ channel ทดสอบ |
| `LINE_CHANNEL_SECRET` | Channel Secret ของ channel ทดสอบ |
| `LINE_SIGNATURE_MODE` | `REQUIRED` เมื่อยืนยันว่า proxy ส่ง signature เข้า Apps Script ได้แล้ว |
| `WEB_ADMIN_KEY` | คงค่า `[WEB_ADMIN_KEY_FROM_EXISTING_CONFIG]` ตามข้อกำหนด |
| `WEB_ADMIN_EMAILS` | อีเมลผู้ดูแล staging ถ้าต้องการใช้ email allowlist |

ค่า `LINE_SIGNATURE_MODE=COMPAT` ใน fixed code มีไว้สำหรับ staging ที่ Apps Script ยังไม่เห็น header เท่านั้น ไม่ควรใช้เป็นโหมด production ถ้าไม่มี proxy ที่ตรวจ HMAC ก่อนถึง Apps Script

### ขั้นที่ 3: เพิ่มไฟล์ fixed แบบแยกชื่อ

เพิ่มไฟล์ fixed ทั้งหมดเข้า staging โดยไม่ลบไฟล์เดิมก่อน จากนั้นตรวจ syntax และค้นหาชื่อ global ซ้ำอีกครั้ง. ในช่วงนี้ **อย่าเปลี่ยนชื่อ `doPost` เดิมใน production** และอย่า deploy fixed เป็น Web App ที่รับ traffic จริงจนกว่าจะผ่าน test matrix

### ขั้นที่ 4: เรียก health check แบบอ่านอย่างเดียว

เรียก `runExtendedHealthCheck_FIXED()` หรือ `quickDiagnostic_FIXED()` ตามระดับรายละเอียดที่ต้องการใน `FIXED_HealthCheck.js`. ฟังก์ชันกลุ่มนี้ตรวจ trigger/config/log แต่ไม่ควรเรียก repair, migration, setup หรือ write function

ผลที่ต้องตรวจคือมี `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `WEB_ADMIN_KEY`, `NOTIFY_STATUS`, `TV_NOTIFY_STATUS`, `runScheduledNotify_v2`, `checkTVStatusAndNotify` และ log ล่าสุดตามที่คาดหวัง

### ขั้นที่ 5: ตรวจ Trigger ก่อนสร้าง

เรียก `auditFixedTriggers()` ก่อน หากพบ runner ซ้ำให้บันทึกผลไว้ก่อน. เมื่อทดสอบ staging พร้อมแล้วจึงเรียก `setupFixedTriggers()` หนึ่งครั้ง

ฟังก์ชันนี้จะลบ Trigger ของ `runScheduledNotify`, `checkAndNotify` และ handler หลักที่ซ้ำ แล้วสร้างตามสถานะ config ดังนี้

| Handler | ความถี่ | เงื่อนไข |
|---|---:|---|
| `checkTVStatusAndNotify` | 1 นาที | `TV_NOTIFY_STATUS=ON` |
| `runScheduledNotify_v2` | 5 นาที | `NOTIFY_STATUS=ON` |
| `closePikadExpiredSessions` | 1 นาที | มีฟังก์ชัน |
| `warmUp` | 10 นาที | มีฟังก์ชัน |

### ขั้นที่ 6: ตรวจ Dashboard authorization

ตัวเลือกที่ปลอดภัยกว่าคือให้ `doGet` fixed ตรวจ `adminKey=[WEB_ADMIN_KEY_FROM_EXISTING_CONFIG]` เพียงครั้งเดียว แล้วออก session token ชั่วคราว 30 นาทีให้ Dashboard. หลังจากนั้น Dashboard ต้องเรียก `secureDashboardCall_FIXED(method, args, request)` ผ่าน `FIXED_SecureDashboardDispatch.js` ซึ่งตรวจ token และ allowlist ทุกครั้ง

หาก Dashboard เดิมยังเรียก `google.script.run.getSomething(...)` ตรง ๆ อยู่ จะยังไม่ได้รับผลจาก dispatcher. ต้องเปลี่ยน wrapper client ให้เรียก dispatcher หรือใช้ bootstrap ที่มีให้ใน `FIXED_AdminAuth.js` เฉพาะใน staging แล้วทดสอบ callback ของ Dashboard ทุกเมนูให้ครบก่อน deploy

## 5. รายการฟังก์ชันที่ต้องมี authorization ฝั่ง server

ฟังก์ชันต่อไปนี้เป็นกลุ่มอ่าน/เขียนที่ควรผ่าน `secureDashboardCall_FIXED` หรือเรียก `requireDashboardAuthorization_FIXED(request, action)` ในต้นฟังก์ชันโดยตรง

| กลุ่ม | ตัวอย่าง |
|---|---|
| อ่านข้อมูล | `getDashboardData`, `getSystemSettings`, `getMasterSwitches`, `getSearchDbRecords`, `quickDiagnostic`, `runMasterHealthCheck` |
| เปลี่ยน config | `saveMultipleConfigs`, `saveHealthSettings`, `saveCourtConfig`, `saveSummarySettings`, `saveOnlineCourtConfigs` |
| เปลี่ยนสถานะฉุกเฉิน | `toggleMasterSwitch`, `emergencyEnableCore`, `emergencyShutdownAll` |
| จัดการฐานค้นหา | `addSearchDatabase`, `updateSearchDatabase`, `deleteSearchDatabase`, `addSearchRecord`, `updateSearchRecord`, `deleteSearchRecord` |
| จัดการแจ้งเตือน | `addScheduledNotify`, `deleteScheduledNotify`, `addPreNotifyReminders`, `sendLineNotification`, `testCourtFlexSend` |
| ซ่อม/ตั้งระบบ | `repairAndUpgradeSheets`, `repairFullSystemLight`, `repairOnlineCourtUsageSheets`, `setupOnlineCourtTestRoom` |

`FIXED_SecureDashboardDispatch.js` ใช้ allowlist และ `switch` แทน `eval` เพื่อป้องกันการให้ client ระบุชื่อ global function arbitrary. หากมี endpoint ใหม่ ต้องเพิ่มใน allowlist และ switch อย่างชัดเจน ไม่รับชื่อฟังก์ชันจาก client โดยตรง

## 6. การตรวจ signature ของ LINE

`FIXED_Webhook.js` อ่าน signature จาก `e.headers` และ fallback parameter ชื่อ `x-line-signature`, `lineSignature` หรือ `signature` เพื่อรองรับ proxy. หากมี signature จะคำนวณ HMAC-SHA256 ด้วย `LINE_CHANNEL_SECRET` แล้วเทียบแบบ constant-time

โหมดที่แนะนำคือ

> `LINE_SIGNATURE_MODE=REQUIRED`

แต่ต้องทดสอบก่อนว่า Web App deployment หรือ proxy ส่ง `x-line-signature` เข้า event object จริง หาก Apps Script ไม่เห็น header และไม่มี proxy ที่ส่ง signature มา การเปิด REQUIRED จะทำให้ทุก event ถูกปฏิเสธอย่างถูกต้องด้านความปลอดภัย แต่บอทจะไม่ตอบจนกว่าจะตั้งเส้นทางส่ง signature ให้ถูกต้อง

## 7. การทดสอบก่อน deploy

| กรณีทดสอบ | ผลที่ต้องได้ |
|---|---|
| JSON ไม่ถูกต้อง | ไม่เขียนชีต ไม่เรียก LINE API และคืนผลจบอย่างปลอดภัย |
| ไม่มี `postData` | ไม่ throw ออกนอก handler |
| `events=[]` | ไม่เกิด error และไม่มีการเขียนข้อมูล |
| batch 2-5 events | ประมวลผลทุก event ตามลำดับ |
| event ซ้ำ | event ซ้ำถูกข้ามตาม duplicate guard |
| signature ถูกต้อง | ประมวลผลได้เมื่อ mode REQUIRED |
| signature ผิด | ถูกปฏิเสธและไม่เขียนชีต |
| event ไม่มี userId | ข้าม event นั้น ไม่สร้างสมาชิกค่าว่าง |
| message/location/image/follow | ใช้ router เดิมและไม่ตอบซ้ำ |
| LINE 429/500 | retry ตาม policy และบันทึก error |
| reply token หมดอายุ | fallback push เมื่อมี userId |
| key `[WEB_ADMIN_KEY_FROM_EXISTING_CONFIG]` ถูกต้อง | เข้า Dashboard ได้ |
| key ผิด | เข้าไม่ได้ |
| เรียก mutation โดยไม่มี session | ถูกปฏิเสธฝั่ง server |
| Court TV target บางรายล้มเหลว | `sentCount` นับเฉพาะรายที่สำเร็จ |
| Trigger ซ้ำ | `auditFixedTriggers()` แสดง `CHECK` หรือ `DUPLICATE` |

การทดสอบ LINE และ Court TV ต้องใช้ mock หรือ channel/target ทดสอบ. ห้ามใช้ `FORCE_NOTIFY=ON`, `testLineNotify`, `sendLineNotification` หรือฟังก์ชัน repair กับผู้รับจริงระหว่าง dry-run

## 8. การตั้งค่า GitHub Pages

หน้า GitHub เดิมยังใช้ flow รับ key แล้วสร้าง iframe ไปยัง Web App. ค่า `WEB_ADMIN_KEY` ต้องคงเดิมตามคอนฟิกของระบบตามคำขอ แต่ query string มีความเสี่ยงจาก browser history และ access log. ระยะสั้นให้คง `referrerpolicy="no-referrer"`, ไม่ hardcode key ใน repository และอย่าแสดง iframe จนกว่าจะตรวจว่า response ไม่ใช่หน้า Access denied

ระยะยาวควรเปลี่ยนเป็น one-time session หรือให้ผู้ดูแลล็อกอินผ่านบัญชี Google ที่อยู่ใน `WEB_ADMIN_EMAILS`. ไม่ควรนำ `[WEB_ADMIN_KEY_FROM_EXISTING_CONFIG]` ไปเก็บใน JavaScript สาธารณะหรือ repository

## 9. การ rollback

หาก staging ทดสอบไม่ผ่าน ให้ลบเฉพาะ Trigger ที่ `setupFixedTriggers()` สร้างใน staging, เปลี่ยน Web App deployment กลับไปยัง version เดิม และนำไฟล์เดิมกลับมาใช้. ห้ามลบแถวใน Spreadsheet หรือ reset config เพื่อแก้ runtime

สำหรับ production ให้เก็บ version เดิมไว้เป็น immutable backup ก่อน deploy. หากเกิดปัญหาให้ rollback deployment ก่อน แล้วค่อยตรวจ log. ห้ามใช้ `repairFullSystemLight`, `repairAndUpgradeSheets` หรือ migration เพื่อกลบอาการโดยไม่มีสำเนาและ export ก่อน

## 10. ลำดับการนำขึ้น production ที่แนะนำ

1. ทดสอบ fixed bundle บน staging ให้ผ่าน test matrix ทั้งหมด
2. ตรวจ `auditFixedTriggers()` และเก็บผลเป็นไฟล์หลักฐาน
3. ตรวจ Dashboard ทุกเมนูอ่าน/เขียน พร้อม authorization
4. เปิด `LINE_SIGNATURE_MODE=REQUIRED` หลังยืนยัน header path
5. ใช้ deployment version ใหม่แบบควบคุมและเก็บ version เดิมไว้ rollback
6. เปลี่ยน webhook ไปยัง version ใหม่ในช่วงที่ผู้ดูแลเฝ้าดู log
7. ตรวจ Court TV online/offline และ Scheduled Notify อย่างน้อยหนึ่งรอบจริง
8. ตรวจว่า `WEB_ADMIN_KEY` ยังเป็น `[WEB_ADMIN_KEY_FROM_EXISTING_CONFIG]` และไม่มีการเปลี่ยนแปลง Spreadsheet schema

ไม่มีขั้นตอนใดในเอกสารนี้ที่ควรแก้ Spreadsheet production โดยอัตโนมัติระหว่างรีวิว

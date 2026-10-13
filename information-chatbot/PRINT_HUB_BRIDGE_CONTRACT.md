# Print Hub Bridge Contract (LINE ↔ Print Hub)

สัญญาระหว่าง `PrintHubLine.js` (ฝั่ง Information Chatbot) กับ Apps Script ของ Print Hub
ฝั่ง LINE เรียกครบทุก action ตามเอกสารนี้แล้ว — ฝั่ง Print Hub ต้องทำ `doPost` ให้รองรับ

## 1. รูปแบบการเรียก

ทุก action เป็น `POST` ไปที่ `PRINT_HUB_WEBAPP_URL` (`.../exec`)
`Content-Type: application/json`, `followRedirects: true`

```json
{ "action": "<ชื่อ action>", "token": "<PRINT_HUB_BRIDGE_TOKEN>", "...": "ฟิลด์ของ action นั้น" }
```

ตอบกลับต้องเป็น JSON และ **ต้องเป็น HTTP 2xx เสมอ** แม้จะเป็นความผิดพลาดเชิงตรรกะ
(ฝั่ง LINE ถือว่า HTTP นอก 2xx = ปัญหาการเชื่อมต่อ ไม่ใช่เครื่องออฟไลน์)

```json
{ "ok": true,  "...": "ข้อมูลของ action" }
{ "ok": false, "msg": "ข้อความภาษาไทยที่ส่งให้ผู้ใช้ได้" }
```

## 2. กฎความปลอดภัยที่ฝั่ง Print Hub ต้องบังคับเอง

ฝั่ง LINE ตรวจสิทธิ์ VIP/Admin มาแล้ว แต่ **ห้ามเชื่อฝั่ง LINE อย่างเดียว**:

1. **Token** — ปฏิเสธทุก request ที่ `token` ไม่ตรงกับค่าใน Script Properties ของ Print Hub
2. **Ownership (สำคัญที่สุด)** — `line_confirm`, `line_cancel`, `line_reprint`, `line_received`
   ต้องตรวจว่า `jobId` นั้นเป็นของ `lineUserId` ที่ส่งมาจริง
   ถ้าไม่ใช่ ให้ตอบ `{ok:false, msg:"ไม่พบงานพิมพ์นี้ของคุณ"}` — **ห้ามบอกว่างานมีอยู่แต่เป็นของคนอื่น**
   (ในกลุ่ม LINE ทุกคนเห็น jobId ของกันและกัน ถ้าไม่ตรวจ ใครก็กดยืนยัน/ยกเลิกงานคนอื่นได้)
3. **jobId ต้องเดาไม่ได้** — อย่างน้อย 12 ตัวอักษรสุ่ม `[A-Za-z0-9_-]`
   (ฝั่ง LINE รับ pattern `[a-z0-9_-]+` แบบ case-insensitive และคงตัวพิมพ์เดิมไว้)
4. **ห้ามพิมพ์อัตโนมัติ** — ไม่ว่ากรณีใด งานที่ยังไม่ผ่าน `line_confirm` ห้ามเข้าคิวพิมพ์
   โดยเฉพาะตอนเครื่องกลับมาออนไลน์
5. **แนะนำ** — เพิ่ม `ts` (epoch ms) + HMAC ของ body แล้วปฏิเสธ request ที่เก่ากว่า 5 นาที เพื่อกัน replay

## 3. สถานะงาน (state machine)

```
STORED ─┬─ agent offline ─→ WAITING_AGENT ─ agent online ─→ WAITING_CONFIRM
        └─ agent online  ─────────────────────────────────→ WAITING_CONFIRM
WAITING_CONFIRM ─ ยืนยัน ─→ QUEUED → PRINTING → SENT → COMPLETED
WAITING_CONFIRM ─ ยกเลิก ─→ CANCELLED (ลบไฟล์ตาม deleteOnCancel)
```

- `COMPLETED` เกิดได้เมื่อ Print Hub ยืนยันเท่านั้น หรือผู้ใช้กด “ได้รับครบแล้ว” (`line_received ok=true`)
- `ERROR` ใช้เมื่อพิมพ์ไม่สำเร็จ และ **ห้ามสั่งพิมพ์ซ้ำเอง**

## 4. Action ทั้ง 11 ตัว

### 4.1 `line_status`
ถามว่าเครื่อง agent ออนไลน์หรือไม่ (เรียกบ่อย ควรตอบเร็ว)

| ส่งไป | ชนิด |
|---|---|
| `lineUserId` | string |
| `sourceId` | string (groupId หรือ userId) |

```json
{ "ok": true, "agentOnline": true, "printer": "Pantum P3010", "queueCount": 0 }
```

### 4.2 `line_upload_start`
เปิดรอบอัปโหลด คืน `uploadId` สำหรับส่ง chunk

ส่งไป: `lineUserId`, `sourceId`, `sourceType` (`group`/`private`), `userName`, `fileName`, `mimeType`, `copies`, `paperSize` (`"A4"`)

```json
{ "ok": true, "uploadId": "up_8f2c..." }
```

### 4.3 `line_upload_chunk`
ส่งไฟล์ทีละ 1 MB (ฝั่ง LINE จำกัดไฟล์ไม่เกิน `PRINT_HUB_MAX_FILE_MB` ค่าเริ่มต้น 10 MB)

ส่งไป: `uploadId`, `part` (เริ่มที่ 0), `data` (base64), `lineUserId`

```json
{ "ok": true, "part": 0 }
```

### 4.4 `line_submit`
ปิดรอบอัปโหลด ประกอบไฟล์ และสร้างงานพิมพ์

ส่งไป: `uploadId`, `parts` (จำนวน chunk ทั้งหมด), `lineUserId`, `sourceId`, `sourceType`, `userName`, `fileName`, `mimeType`, `copies`, `paperSize`, `retentionDays`, `deleteOnCancel` (boolean)

```json
{ "ok": true, "jobId": "Jb7K2m9QxA4T", "status": "WAITING_CONFIRM", "agentOnline": true }
```

- `agentOnline: true` → ฝั่ง LINE จะ **push การ์ดยืนยันทันที** จึงต้องตั้ง status เป็น `WAITING_CONFIRM`
- `agentOnline: false` → ตั้ง `WAITING_AGENT` และรอ ส่ง event `CONFIRM` ผ่าน `line_pending` เมื่อออนไลน์

### 4.5 `line_confirm`
ส่งไป: `jobId`, `lineUserId`, `sourceId` — ตรวจ ownership ก่อนเสมอ

```json
{ "ok": true, "agentOnline": true, "status": "QUEUED" }
```

ถ้า agent ออฟไลน์ตอนยืนยัน: `{"ok":true,"agentOnline":false,"status":"WAITING_AGENT"}`
งานต้องรอจนออนไลน์แล้ว **ขอยืนยันใหม่** ไม่ใช่พิมพ์เลย

### 4.6 `line_cancel`
ส่งไป: `jobId`, `lineUserId`, `sourceId`
ตั้งเป็น `CANCELLED` และลบไฟล์ถ้า `deleteOnCancel` ของงานนั้นเป็น true

```json
{ "ok": true, "status": "CANCELLED", "fileDeleted": true }
```

### 4.7 `line_received`
ผู้ใช้ตรวจรับเอกสารที่เครื่องพิมพ์

ส่งไป: `jobId`, `lineUserId`, `sourceId`, `ok` (boolean — true = ได้รับครบ)

```json
{ "ok": true, "status": "COMPLETED" }
```

`ok:false` → ตั้งเป็น `ERROR` และ **ห้ามสั่งพิมพ์ซ้ำอัตโนมัติ**

### 4.8 `line_history`
ส่งไป: `lineUserId`, `sourceId`, `query` (≤120 ตัวอักษร), `limit`, `includeDownloadLink` (boolean)

```json
{ "ok": true, "jobs": [
  { "jobId": "Jb7K2m9QxA4T", "fileName": "คำพิพากษา.pdf",
    "status": "COMPLETED", "createdAt": "2026-10-13T09:12:00+07:00",
    "downloadUrl": "https://..." }
] }
```

คืนเฉพาะงานของ `lineUserId` นั้น และใส่ `downloadUrl` เฉพาะเมื่อ `includeDownloadLink` เป็น true
ลิงก์ควรหมดอายุเองภายใน 24 ชม.

### 4.9 `line_reprint`
ส่งไป: `jobId`, `lineUserId`, `sourceId`

```json
{ "ok": true, "agentOnline": true, "jobId": "Jb9NewId1234",
  "job": { "jobId": "Jb9NewId1234", "fileName": "คำพิพากษา.pdf", "copies": 1 } }
```

ต้องสร้าง **งานใหม่** สถานะ `WAITING_CONFIRM` เสมอ ห้ามพิมพ์ทันที
ถ้า `agentOnline` เป็น true ให้ส่ง `job` มาด้วย ฝั่ง LINE จะแสดงการ์ดยืนยันทันที

### 4.10 `line_pending`
ฝั่ง LINE poll ทุก 1 นาที (trigger `processPrintHubNotifications_`)

ส่งไป: `limit` (ค่าปัจจุบัน 30)

```json
{ "ok": true, "events": [
  { "eventId": "ev_001", "type": "CONFIRM", "jobId": "Jb7K...",
    "sourceId": "Cxxxx", "sourceType": "group", "lineUserId": "Uxxxx",
    "job": { "jobId": "Jb7K...", "fileName": "คำพิพากษา.pdf", "copies": 1 } },
  { "eventId": "ev_002", "type": "PRINTING", "jobId": "Jb7K...", "fileName": "คำพิพากษา.pdf",
    "sourceId": "Cxxxx", "lineUserId": "Uxxxx" }
] }
```

ชนิด event ที่รองรับ:

| type | ความหมาย | ฟิลด์ที่ **ต้อง** มี |
|---|---|---|
| `CONFIRM` | agent กลับมาออนไลน์ ขอให้ผู้ใช้ยืนยัน | `job` |
| `PRINTING` | เริ่มพิมพ์แล้ว | `fileName` |
| `SENT` | ส่งเข้าเครื่องพิมพ์แล้ว ขอให้ตรวจรับ | `job` |
| `DONE` | พิมพ์เสร็จและยืนยันแล้ว | — |
| `ERROR` | พิมพ์ไม่สำเร็จ | `error` (ไม่บังคับ) |

ทุก event ต้องมี `eventId` และ `sourceId` หรือ `lineUserId` อย่างน้อยหนึ่งอย่าง
**event ที่ขาดฟิลด์บังคับจะถูกฝั่ง LINE ลองส่ง 5 ครั้งแล้ว mark เป็น `SKIPPED`** เพื่อไม่ให้ค้างคิวตลอดไป

### 4.11 `line_mark_notified`
ส่งไป: `eventId`, `jobId`, `type`, และอาจมี `result: "SKIPPED"` + `attempts` เมื่อส่งไม่สำเร็จครบจำนวนครั้ง

```json
{ "ok": true }
```

ต้อง idempotent — ถูกเรียกซ้ำด้วย `eventId` เดิมได้โดยไม่ผิดพลาด

## 5. ค่าตั้งจาก Dashboard ที่ส่งมาให้ Print Hub

| คีย์ | ส่งมากับ | ความหมาย |
|---|---|---|
| `copies` | `line_upload_start`, `line_submit` | จำนวนชุด (`PRINT_HUB_DEFAULT_COPIES`) |
| `paperSize` | `line_upload_start`, `line_submit` | คงที่ `"A4"` |
| `retentionDays` | `line_submit` | เก็บไฟล์กี่วัน (`PRINT_HUB_RETENTION_DAYS`) |
| `deleteOnCancel` | `line_submit` | ลบไฟล์ทันทีเมื่อยกเลิกหรือไม่ |
| `includeDownloadLink` | `line_history` | ให้ลิงก์ดาวน์โหลดหรือไม่ |

ค่าที่ฝั่ง LINE บังคับเอง ไม่ส่งมา: ชนิดไฟล์ที่รับ, ขนาดสูงสุด, อายุ session, พฤติกรรมเมื่อออฟไลน์

## 6. สิ่งที่ฝั่ง LINE **ไม่** ทำ

- ไม่ตัดสินว่าเครื่องออนไลน์หรือไม่ — ใช้ `agentOnline` จาก Print Hub เท่านั้น
- ไม่บอกผู้ใช้ว่า “พิมพ์เสร็จแล้ว” นอกจากได้ event `DONE` หรือผู้ใช้กดตรวจรับเอง
- ไม่ลบไฟล์ ไม่จัดคิว ไม่สั่งเครื่องพิมพ์
- AI ใช้แค่ตีความคำสั่งและเรียบเรียงข้อความ ไม่แตะสิทธิ์และสถานะงาน

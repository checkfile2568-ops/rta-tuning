/**
 * LINE OA Lopburi — Unified Help Guide v3
 * Updated: 2026-08-14
 *
 * เป้าหมาย:
 * 1) ให้ Dashboard และ /ช่วยเหลือ ใช้ข้อมูลคู่มือชุดเดียวกัน
 * 2) แยกวิธีค้นหา "แชทส่วนตัว" กับ "กลุ่ม LINE" ชัดเจน
 * 3) บัญชีนัดในกลุ่มเรียกตรงได้ ไม่ต้องมี "บอท" นำหน้า
 */

const HELP_GUIDE_VERSION = '2026-08-14-v3';

function getUnifiedUsageGuide() {
  return {
    version: HELP_GUIDE_VERSION,
    title: '📖 คู่มือการใช้งาน LINE Bot — ศาลจังหวัดลพบุรี',
    privateSearch: {
      title: '💬 แชทส่วนตัว',
      lines: [
        'ค้นหาทั่วไป/ฐานความรู้: ค้นหา <คำค้น>',
        'เจาะฐานโดยตรง: ค้นหา [ชื่อฐาน] <คำค้น>',
        'บัญชีนัด: บัญชีนัด วันนี้ | พรุ่งนี้ | มะรืน | 14 สิงหาคม 2569',
        'ศูนย์ประสานงานคดีออนไลน์: ศูนย์ประสานงานคดี',
        'ดูคู่มือฉบับย่อ: /ช่วยเหลือ หรือ /help'
      ],
      examples: [
        'ค้นหา ลิงก์ห้อง',
        'ค้นหา เวรเสื้อฟ้า ชนินทร์',
        'ค้นหา [เขตส่งหมาย] ถนนใหญ่',
        'ค้นหา [เบอร์ทนาย] แสนศรี',
        'บัญชีนัด วันนี้',
        'บัญชีนัด 14 สิงหาคม 2569'
      ]
    },
    groupSearch: {
      title: '👥 กลุ่ม LINE',
      lines: [
        'ฐานความรู้/ฐานค้นหา: /บอท ค้นหา <คำค้น>',
        'เจาะฐานโดยตรง: /บอท ค้นหา [ชื่อฐาน] <คำค้น>',
        'บัญชีนัด: เรียกตรงได้ ไม่ต้องใช้คำว่า “บอท” นำหน้า',
        'ตัวอย่างบัญชีนัด: บัญชีนัด วันนี้ | บัญชีนัด พรุ่งนี้ | บัญชีนัด 14 สิงหาคม 2569',
        'บางกลุ่มภารกิจส่งหมายอาจถูกตั้งให้รับเฉพาะพิกัด/รูป จึงปิด KB+DB Search ตามการตั้งค่าของกลุ่ม'
      ],
      examples: [
        '/บอท ค้นหา ลิงก์ห้อง',
        '/บอท ค้นหา [เวรเสื้อฟ้า] ชนินทร์',
        '/บอท ค้นหา [เขตส่งหมาย] ท่าแค',
        '/บอท ค้นหา [ส่งหมาย] สิงหาคม',
        'บัญชีนัด วันนี้',
        'บัญชีนัด 14 สิงหาคม 2569'
      ]
    },
    databases: [
      {no: 1, icon: '📞', name: 'ผู้ใหญ่บ้าน', sheet: 'Village', access: 'Admin', status: 'ON'},
      {no: 2, icon: '📄', name: 'ต่อเนื่อง', sheet: 'sheets1', access: 'Internal', status: 'ON'},
      {no: 3, icon: '📤', name: 'คำขอคัดถ่าย', sheet: 'ขอคัดถ่าย', access: 'Internal', status: 'ON'},
      {no: 4, icon: '📞', name: 'เบอร์ทนาย', sheet: 'ค้นหาทนาย', access: 'Internal', status: 'ON'},
      {no: 5, icon: '📤', name: 'ส่งหมาย', sheet: 'LINE-ค้นหาส่งหมายรายเดือน', access: 'Admin', status: 'ON'},
      {no: 6, icon: '📤', name: 'เวรเสื้อฟ้า', sheet: 'เวรเสื้อฟ้า', access: 'Internal', status: 'ON'},
      {no: 7, icon: '🗺️', name: 'เขตส่งหมาย', sheet: 'LINE-ค้นหาพื้นที่หมาย', access: 'Internal', status: 'ON'}
    ],
    extraSources: [
      {icon: '⚖️', name: 'บัญชีนัด', detail: 'Database + Database_LastWeek (fallback)', access: 'VIP/Admin'},
      {icon: '📚', name: 'ฐานความรู้', detail: 'ชีต ความรู้', access: 'ตามสิทธิ์รายการ'}
    ],
    permissions: [
      {level: 'Public/User', detail: 'ใช้ข้อมูล Public'},
      {level: 'Internal/VIP', detail: 'ใช้ข้อมูล Internal และ Public'},
      {level: 'Admin', detail: 'ใช้ข้อมูล Admin, Internal และ Public'}
    ]
  };
}

function buildUnifiedHelpText_() {
  const g = getUnifiedUsageGuide();
  return [
    g.title,
    '',
    '💬 แชทส่วนตัว',
    '• ค้นหาฐานความรู้/ฐานข้อมูล: ค้นหา <คำค้น>',
    '• เจาะฐาน: ค้นหา [ชื่อฐาน] <คำค้น>',
    '• บัญชีนัด: บัญชีนัด วันนี้ / พรุ่งนี้ / มะรืน / 14 สิงหาคม 2569',
    '• ศูนย์ประสานงานคดี: พิมพ์ ศูนย์ประสานงานคดี',
    '',
    '👥 กลุ่ม LINE',
    '• ฐานความรู้/ฐานข้อมูล: /บอท ค้นหา <คำค้น>',
    '• เจาะฐาน: /บอท ค้นหา [ชื่อฐาน] <คำค้น>',
    '• ⚖️ บัญชีนัด: พิมพ์ บัญชีนัด ... ได้ทันที — ไม่ต้องมี “บอท” นำหน้า',
    '',
    '🔎 ตัวอย่าง',
    '• /บอท ค้นหา [เวรเสื้อฟ้า] ชนินทร์',
    '• /บอท ค้นหา [เขตส่งหมาย] ท่าแค',
    '• /บอท ค้นหา [ส่งหมาย] สิงหาคม',
    '• บัญชีนัด วันนี้',
    '• บัญชีนัด 14 สิงหาคม 2569',
    '',
    '📚 แหล่งค้นหา: บัญชีนัด + ฐานความรู้ + ผู้ใหญ่บ้าน + ต่อเนื่อง + คำขอคัดถ่าย + เบอร์ทนาย + ส่งหมาย + เวรเสื้อฟ้า + เขตส่งหมาย',
    '',
    '🔐 ระบบจะแสดงเฉพาะข้อมูลที่สิทธิ์ของผู้ใช้อนุญาต',
    '💡 หากไม่พบข้อมูล ลองระบุชื่อฐานใน [ ] เพื่อค้นหาให้ตรงฐานมากขึ้น',
    '📖 พิมพ์ /ช่วยเหลือ หรือ /help เพื่อดูคู่มือนี้อีกครั้ง'
  ].join('\n');
}

// เรียกจาก Dashboard ผ่าน google.script.run ได้
function getUnifiedHelpText() {
  return buildUnifiedHelpText_();
}

// ใช้ใน message router ของ LINE Bot
function isUnifiedHelpCommand_(text) {
  const s = String(text || '').trim().toLowerCase();
  return s === '/ช่วยเหลือ' || s === 'ช่วยเหลือ' || s === '/help' || s === 'help';
}

function tryUnifiedHelpCommand_(text) {
  if (!isUnifiedHelpCommand_(text)) return { handled: false };
  return { handled: true, text: buildUnifiedHelpText_() };
}

/*
=== จุดเชื่อมกับ handler เดิม ===
ในฟังก์ชันที่รับข้อความ LINE ก่อนเข้า Search/Court/KB router ให้เพิ่มแนวคิดนี้:

  const helpResult = tryUnifiedHelpCommand_(text);
  if (helpResult.handled) {
    // ใช้ฟังก์ชัน reply ของระบบเดิม เช่น replyText(replyToken, helpResult.text)
    // แล้ว return เพื่อไม่ให้ไหลไป Search/Fallback ต่อ
  }

อย่าสร้าง reply function ใหม่ถ้าระบบมีของเดิมอยู่แล้ว ให้เรียกของเดิมเพื่อไม่ให้ชนระบบเดิม
*/

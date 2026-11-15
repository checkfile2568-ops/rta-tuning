#!/usr/bin/env python3
"""Checked upgrade of the actual API 1.6.1 source to 1.6.2."""
from pathlib import Path
import sys,hashlib

def integrate(source):
    def change(old,new):
        nonlocal source
        if source.count(old)!=1: raise ValueError('Unexpected current source: '+old[:90])
        source=source.replace(old,new)
    change("const API_VERSION = '1.6.1';", "const API_VERSION = '1.6.2';")
    change("const diff = q - reserveQty_(it);\n    if (diff > 0 && diff > avail_(m))", "const currentStock = approvalStock_(it);\n    if (!currentStock || !currentStock.valid || q > currentStock.available_for_request) throw appErr_('NOT_ENOUGH_STOCK', m.name + ' ยอดพร้อมอนุมัติเปลี่ยนแล้ว กรุณาอัปเดตยอดวัสดุและพิจารณาจำนวนอีกครั้ง');\n    const diff = q - reserveQty_(it);\n    if (diff > 0 && diff > avail_(m))")
    old="""  }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
    .map(function (r) { return reqOut_(r, im[r.req_id] || [], me); });
}

/** คิวจ่าย:"""
    new="""  }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
    .map(function (r) {
      const items = im[r.req_id] || [], o = reqOut_(r, items, me);
      o.stock_checked_at = now_();
      o.items.forEach(function (item, index) { item.stock = approvalStock_(items[index]); });
      return o;
    });
}

/** คิวจ่าย:"""
    change(old,new)
    return source+'\n\n// SOURCE: ApprovalStock.gs\n'+Path(__file__).with_name('ApprovalStock.gs').read_text()

if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit('Usage: integrate.py actual-current-Code.gs patched-Code.gs')
    s=Path(sys.argv[1]).read_text();result=integrate(s);Path(sys.argv[2]).write_text(result)
    print('API 1.6.2 prepared; baseline SHA256 '+hashlib.sha256(s.encode()).hexdigest())

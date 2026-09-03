/*  MMs — mms-analyze.js (v1.0)
 *  พื้นที่ทำงานวิเคราะห์ไฟล์ด้วย AI ใช้ร่วมกันระหว่างเมนู "วิเคราะห์เสียง" และ "วิเคราะห์เอกสาร"
 *  ต่อกับ edge function mms-ai-api (Gemini) — ทำงานทันที ไม่ต้องรอ Worker
 *
 *  ── จุดต่อยอด ──
 *  [EXT-1] mountAnalyzer({...})  : เพิ่มหน้าใหม่ได้โดยส่ง config เข้ามา ไม่ต้องคัดลอกโค้ด
 *  [EXT-2] renderResult()        : เปลี่ยนวิธีแสดงผล เช่น ทำไทม์ไลน์คลิกได้จาก [mm:ss]
 */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => window.MmsPro?.esc ? window.MmsPro.esc(s) : String(s ?? '');
const bytes = n => window.MmsPro?.bytes ? window.MmsPro.bytes(n) : `${n} B`;
const dt = v => window.MmsPro?.dt ? window.MmsPro.dt(v) : String(v ?? '');

export function mountAnalyzer(cfg) {
  const P = window.MmsPro, AI = window.MmsGemini;
  const state = { files: [], file: null, caps: null, findings: [], busy: false, lastText: '', lastName: '' };

  const el = {
    list: $('#fileList'), hint: $('#listHint'), q: $('#q'),
    info: $('#fileInfo'), tasks: $('#taskRow'), ask: $('#askWrap'), question: $('#question'),
    run: $('#runBtn'), status: $('#runStatus'), result: $('#resultBox'),
    history: $('#history'), notice: $('#notice')
  };
  let task = cfg.defaultTask;

  /* ---------- capabilities ---------- */
  async function loadCaps() {
    try {
      const d = await AI.api('capabilities');
      state.caps = d;
      if (!d.ok) throw new Error(d.error || 'เชื่อมต่อระบบ AI ไม่ได้');
      if (!d.gemini_ready) {
        el.notice.hidden = false;
        el.notice.className = 'note warn';
        el.notice.textContent = 'ยังไม่ได้ตั้งค่ากุญแจ Gemini ในระบบ — เมนูนี้จะยังวิเคราะห์ไม่ได้จนกว่าผู้ดูแลจะตั้งค่า GEMINI_API_KEY';
      } else {
        el.notice.hidden = false;
        el.notice.className = 'note';
        el.notice.textContent = `พร้อมใช้งาน · โมเดล ${d.model} · ไฟล์ไม่เกิน ${Math.round((d.max_inline_bytes || 0) / 1048576)} MB ต่อครั้ง`;
      }
    } catch (e) {
      el.notice.hidden = false;
      el.notice.className = 'note bad';
      el.notice.textContent = 'ยังไม่ได้ติดตั้งบริการวิเคราะห์ (mms-ai-api) หรือเชื่อมต่อไม่ได้ · ' + (e.message || e);
    }
  }

  /* ---------- file list ---------- */
  async function loadFiles() {
    el.hint.textContent = 'กำลังโหลด…';
    const d = await P.api('library-list', { limit: 300 });
    if (!d.ok) { el.hint.textContent = d.error || 'โหลดคลังไฟล์ไม่สำเร็จ'; return; }
    state.files = (d.files || []).filter(x =>
      cfg.mediaTypes.includes(x.media_type) && x.upload_status === 'ready' && !x.purged_at);
    renderFiles();
  }
  function renderFiles() {
    const q = (el.q.value || '').trim().toLowerCase();
    const rows = state.files.filter(x => !q || String(x.original_name || '').toLowerCase().includes(q));
    el.hint.textContent = `${rows.length} รายการในคลังกลาง`;
    if (!rows.length) { el.list.innerHTML = '<div class="empty">ยังไม่มีไฟล์ประเภทนี้ในคลัง — อัปโหลดผ่านเมนู “คลังมัลติมีเดีย” ก่อน</div>'; return; }
    el.list.innerHTML = rows.map((x, i) => `
      <button class="src ${state.file?.id === x.id ? 'sel' : ''}" data-id="${esc(x.id)}">
        <span class="ico">${cfg.icon}</span>
        <span style="flex:1"><b>${esc(x.original_name)}</b>
        <span class="meta">${bytes(x.size_bytes)} · ${dt(x.created_at)}</span></span>
      </button>`).join('');
    el.list.querySelectorAll('.src').forEach(b =>
      b.addEventListener('click', () => selectFile(rows.find(f => f.id === b.dataset.id))));
  }

  async function selectFile(f) {
    if (!f) return;
    state.file = f;
    renderFiles();
    const tooBig = state.caps?.max_inline_bytes && Number(f.size_bytes) > Number(state.caps.max_inline_bytes);
    el.info.hidden = false;
    el.info.innerHTML = `<b>${esc(f.original_name)}</b>
      <span class="meta">${bytes(f.size_bytes)} · ${esc(f.mime_type || '')} · เพิ่มเมื่อ ${dt(f.created_at)}</span>
      ${tooBig ? '<span class="meta" style="color:#b8322d">ไฟล์ใหญ่เกินเพดานวิเคราะห์ทันที — ให้ตัดเฉพาะช่วงที่ต้องการก่อน แล้วอัปโหลดช่วงนั้นมาวิเคราะห์</span>' : ''}`;
    el.run.disabled = !!tooBig;
    renderTasks();
    await loadFindings();
  }

  /* ---------- tasks ---------- */
  function renderTasks() {
    const avail = cfg.tasks.filter(t => !state.file || t.media.includes(state.file.media_type));
    if (!avail.some(t => t.key === task)) task = avail[0]?.key;
    el.tasks.innerHTML = avail.map(t =>
      `<button class="chip ${t.key === task ? 'on' : ''}" data-k="${t.key}">${esc(t.label)}</button>`).join('');
    el.tasks.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      task = b.dataset.k; renderTasks();
    }));
    el.ask.hidden = task !== 'ask';
  }

  /* ---------- run ---------- */
  el.run.addEventListener('click', async () => {
    if (!state.file) return alert('กรุณาเลือกไฟล์ก่อน');
    if (task === 'ask' && !el.question.value.trim()) return alert('กรุณาพิมพ์คำถาม');
    state.busy = true;
    el.run.disabled = true;
    el.status.hidden = false;
    el.status.textContent = 'กำลังวิเคราะห์… ไฟล์ยาวอาจใช้เวลาหลายสิบวินาที กรุณาอย่าปิดหน้านี้';
    el.result.hidden = true;
    try {
      const d = await AI.api('analyze', {
        media_file_id: state.file.id,
        task,
        question: task === 'ask' ? el.question.value.trim() : undefined
      });
      if (!d.ok) throw new Error([d.error, d.detail].filter(Boolean).join(' · '));
      state.lastText = d.text || '';
      state.lastName = buildName(state.file.original_name, task);
      renderResult(state.lastText, d.elapsed_ms);
      await loadFindings();
    } catch (e) {
      el.result.hidden = false;
      el.result.className = 'resultbox bad';
      el.result.innerHTML = `<b>วิเคราะห์ไม่สำเร็จ</b><div class="meta">${esc(e.message || e)}</div>`;
    } finally {
      state.busy = false;
      el.run.disabled = false;
      el.status.hidden = true;
    }
  });

  function buildName(orig, t) {
    const base = String(orig || 'file').replace(/\.[^.]+$/, '').slice(0, 50);
    const suffix = { transcribe: 'ถอดเสียง', summarize: 'สรุป', ocr: 'ข้อความ', ask: 'คำตอบ' }[t] || t;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `MMs_${base}_${suffix}_${d.getFullYear() + 543}${p(d.getMonth() + 1)}${p(d.getDate())}.txt`;
  }

  /* [EXT-2] แสดงผลลัพธ์ */
  function renderResult(text, ms) {
    el.result.hidden = false;
    el.result.className = 'resultbox';
    el.result.innerHTML = `
      <div class="rowline" style="justify-content:space-between">
        <b>ผลวิเคราะห์</b>
        <span class="meta">${((ms || 0) / 1000).toFixed(1)} วินาที · ${text.length.toLocaleString('th-TH')} ตัวอักษร</span>
      </div>
      <pre class="out">${esc(text)}</pre>
      <div class="rowline">
        <button class="btn" id="copyBtn">คัดลอกข้อความ</button>
        <button class="btn primary" id="dlBtn">ดาวน์โหลดเป็นไฟล์ .txt</button>
      </div>`;
    $('#copyBtn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); $('#copyBtn').textContent = 'คัดลอกแล้ว'; }
      catch { alert('คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอกเอง'); }
    });
    $('#dlBtn').addEventListener('click', () => downloadText(text, state.lastName));
  }

  function downloadText(text, filename) {
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  /* ---------- history ---------- */
  async function loadFindings() {
    if (!state.file) { el.history.innerHTML = ''; return; }
    const d = await AI.api('findings', { media_file_id: state.file.id, limit: 30 });
    if (!d.ok) { el.history.innerHTML = ''; return; }
    state.findings = d.findings || [];
    if (!state.findings.length) { el.history.innerHTML = '<div class="empty">ยังไม่มีผลวิเคราะห์ของไฟล์นี้</div>'; return; }
    el.history.innerHTML = state.findings.map(f => `
      <div class="hist">
        <div style="flex:1">
          <b>${esc(f.title || f.finding_type)}</b>
          <span class="meta">${dt(f.created_at)} · ${esc(f.model_version || '')}</span>
        </div>
        <button class="btn" data-open="${esc(f.id)}">เปิด</button>
        <button class="btn ghost" data-del="${esc(f.id)}">ลบ</button>
      </div>`).join('');
    el.history.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      const f = state.findings.find(x => x.id === b.dataset.open);
      if (!f) return;
      state.lastText = f.detail || '';
      state.lastName = buildName(state.file.original_name, f.finding_type);
      renderResult(state.lastText, f.payload?.elapsed_ms);
      el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
    el.history.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('ลบผลวิเคราะห์รายการนี้')) return;
      await AI.api('delete-finding', { id: b.dataset.del });
      await loadFindings();
    }));
  }

  /* ---------- boot ---------- */
  el.q.addEventListener('input', renderFiles);
  $('#reload').addEventListener('click', loadFiles);
  renderTasks();
  loadCaps().then(loadFiles);
}

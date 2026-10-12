(() => {
  const cfg = window.PC_REMOTE_CONFIG || {};
  const $ = id => document.getElementById(id);
  const hasConfig = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const client = hasConfig ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  if (!hasConfig) $('setupBanner').classList.remove('hidden');

  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const requestId = params.get('request');
  const deviceId = params.get('device');
  const mobileName = params.get('name') || 'Mobile Browser';
  const code = params.get('code') || '';
  let requestRow = null;

  const enc = new TextEncoder();
  const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
  async function fingerprint() {
    const raw = [navigator.userAgent, navigator.language, screen.width, screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
    return sha256(raw);
  }

  async function signIn() {
    $('loginMessage').textContent = 'กำลังเข้าสู่ระบบ...';
    const { error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    $('loginMessage').textContent = error ? error.message : '';
  }

  async function validateRequest() {
    $('confirmPairBtn').disabled = true;
    if (!requestId || !deviceId || !code) {
      $('pairInfo').textContent = 'ลิงก์จับคู่ไม่สมบูรณ์'; return;
    }
    const { data, error } = await client.from('pairing_requests').select('*').eq('id', requestId).eq('device_id', deviceId).maybeSingle();
    if (error || !data) { $('pairInfo').textContent = 'ไม่พบคำขอจับคู่ หรือบัญชีนี้ไม่มีสิทธิ์'; return; }
    if (data.consumed_at) { $('pairInfo').textContent = 'รหัสจับคู่นี้ถูกใช้งานแล้ว'; return; }
    if (new Date(data.expires_at).getTime() <= Date.now()) { $('pairInfo').textContent = 'รหัสจับคู่หมดอายุแล้ว'; return; }
    if ((await sha256(code)) !== data.code_hash) { $('pairInfo').textContent = 'รหัสจับคู่ไม่ถูกต้อง'; return; }
    requestRow = data;
    $('pairInfo').textContent = `พร้อมเชื่อมต่อ “${mobileName}” กับอุปกรณ์ที่เลือก`;
    $('confirmPairBtn').disabled = false;
  }

  async function confirmPair() {
    if (!requestRow) return;
    $('confirmPairBtn').disabled = true;
    $('pairMessage').textContent = 'กำลังเชื่อมต่อ...';
    const { data: { user } } = await client.auth.getUser();
    const fp = await fingerprint();
    const { error: pairError } = await client.from('paired_devices').upsert({
      user_id: user.id,
      device_id: deviceId,
      mobile_name: mobileName.slice(0, 80),
      browser_fingerprint: fp,
      last_seen: new Date().toISOString(),
      revoked_at: null
    }, { onConflict: 'user_id,device_id,browser_fingerprint' });
    if (pairError) { $('pairMessage').textContent = `เชื่อมต่อไม่สำเร็จ: ${pairError.message}`; $('confirmPairBtn').disabled = false; return; }
    const { error: consumeError } = await client.from('pairing_requests').update({ consumed_at: new Date().toISOString() }).eq('id', requestId);
    if (consumeError) { $('pairMessage').textContent = `เชื่อมต่อแล้ว แต่บันทึกคำขอไม่สำเร็จ: ${consumeError.message}`; return; }
    $('pairMessage').textContent = 'เชื่อมต่อมือถือสำเร็จ';
    $('goDashboard').classList.remove('hidden');
  }

  async function handleSession(session) {
    if (!session) { $('loginCard').classList.remove('hidden'); $('pairCard').classList.add('hidden'); return; }
    $('loginCard').classList.add('hidden'); $('pairCard').classList.remove('hidden'); await validateRequest();
  }

  $('loginBtn').addEventListener('click', signIn);
  $('confirmPairBtn').addEventListener('click', confirmPair);
  if (client) {
    client.auth.onAuthStateChange((_e, s) => handleSession(s));
    client.auth.getSession().then(({ data }) => handleSession(data.session));
  } else {
    $('loginBtn').disabled = true;
  }
})();

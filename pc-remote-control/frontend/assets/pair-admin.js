(() => {
  const cfg = window.PC_REMOTE_CONFIG || {};
  const $ = id => document.getElementById(id);
  const hasConfig = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const client = hasConfig ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  if (!hasConfig) $('setupBanner').classList.remove('hidden');

  const enc = new TextEncoder();
  const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
  function randomCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

  async function signIn() {
    $('loginMessage').textContent = 'กำลังเข้าสู่ระบบ...';
    const { error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    $('loginMessage').textContent = error ? error.message : '';
  }

  async function loadDevices() {
    const { data, error } = await client.from('devices').select('id,name').order('created_at');
    if (error) return alert(error.message);
    $('deviceSelect').innerHTML = '';
    (data || []).forEach(d => {
      const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; $('deviceSelect').appendChild(o);
    });
  }

  async function handleSession(session) {
    if (!session) {
      $('loginCard').classList.remove('hidden'); $('pairPanel').classList.add('hidden'); return;
    }
    $('loginCard').classList.add('hidden'); $('pairPanel').classList.remove('hidden'); await loadDevices();
  }

  async function createPair() {
    const deviceId = $('deviceSelect').value;
    if (!deviceId) return alert('กรุณาเลือกเครื่อง');
    const code = randomCode();
    const codeHash = await sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: { user } } = await client.auth.getUser();
    const { data, error } = await client.from('pairing_requests').insert({ device_id: deviceId, created_by: user.id, code_hash: codeHash, expires_at: expiresAt }).select('id').single();
    if (error) return alert(`สร้างรหัสไม่ได้: ${error.message}`);

    const params = new URLSearchParams({ request: data.id, device: deviceId, name: $('mobileName').value.trim() || 'Mobile Browser' });
    const url = `${new URL('pair.html', location.href).href}#${params.toString()}&code=${encodeURIComponent(code)}`;
    $('pairCode').textContent = code;
    $('pairExpiry').textContent = `หมดอายุ ${new Date(expiresAt).toLocaleTimeString('th-TH')}`;
    $('pairLink').href = url;
    $('pairResult').classList.remove('hidden');
    $('qr').innerHTML = '';
    new QRCode($('qr'), { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  }

  $('loginBtn').addEventListener('click', signIn);
  $('createPairBtn').addEventListener('click', createPair);
  if (client) {
    client.auth.onAuthStateChange((_e, s) => handleSession(s));
    client.auth.getSession().then(({ data }) => handleSession(data.session));
  } else {
    $('loginBtn').disabled = true;
  }
})();

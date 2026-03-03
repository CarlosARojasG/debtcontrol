/**
 * DebtControl Pro - Site Guard v2.0
 * Protección de acceso al sitio con código maestro
 * 
 * - Usa Firebase REST API (no requiere SDK, solo la URL de la BD)
 * - En dispositivos nuevos pide la URL de Firebase + código
 * - Hash SHA-256: nadie puede ver el código real
 * - Sesión por pestaña (sessionStorage), 12 horas
 */

(function() {
  'use strict';

  var SESSION_KEY = 'debtcontrol_auth_session';
  var LOCAL_HASH_KEY = 'debtcontrol_access_hash';
  var DB_URL_KEY = 'debtcontrol_guard_dburl';
  var GUARD_PATH = '/config/siteGuard.json';

  // ============================================================
  // SHA-256
  // ============================================================
  async function sha256(text) {
    var encoder = new TextEncoder();
    var data = encoder.encode(text);
    var buffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ============================================================
  // Firebase REST API (no requiere SDK ni config completa)
  // ============================================================
  function getDbUrl() {
    // Primero intentar desde la config de cloud-sync
    try {
      var raw = localStorage.getItem('debtcontrol_firebase_config');
      if (raw) {
        var cfg = JSON.parse(raw);
        if (cfg && cfg.databaseURL) {
          localStorage.setItem(DB_URL_KEY, cfg.databaseURL);
          return cfg.databaseURL;
        }
      }
    } catch (e) {}
    // Fallback: URL guardada por el guard
    return localStorage.getItem(DB_URL_KEY) || null;
  }

  async function getRemoteHash(dbUrl) {
    if (!dbUrl) return null;
    try {
      var url = dbUrl.replace(/\/$/, '') + GUARD_PATH;
      var resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) return null;
      var data = await resp.json();
      if (data && data.hash) return data;
    } catch (e) {
      console.warn('[SiteGuard] Error REST:', e);
    }
    return null;
  }

  async function saveRemoteHash(dbUrl, hash) {
    if (!dbUrl) return;
    try {
      var url = dbUrl.replace(/\/$/, '') + GUARD_PATH;
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: hash, updatedAt: new Date().toISOString() })
      });
    } catch (e) {
      console.warn('[SiteGuard] Error guardando REST:', e);
    }
  }

  // ============================================================
  // Sesión
  // ============================================================
  function hasValidSession() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      return s && (Date.now() - s.ts < 12 * 60 * 60 * 1000);
    } catch (e) { return false; }
  }

  function createSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
  }

  // ============================================================
  // UI helpers
  // ============================================================
  function hideApp() {
    var root = document.getElementById('root');
    var loading = document.getElementById('loading');
    if (root) root.style.display = 'none';
    if (loading) loading.style.display = 'none';
  }

  function showApp() {
    var root = document.getElementById('root');
    var loading = document.getElementById('loading');
    if (root) root.style.display = '';
    if (loading) loading.style.display = '';
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'dc-guard';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '999999', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '16px'
    });
    return overlay;
  }

  function inputStyle() {
    return 'width:100%;padding:16px;border-radius:14px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;font-size:16px;text-align:center;box-sizing:border-box;outline:none;margin-top:12px;';
  }

  function btnStyle() {
    return 'width:100%;padding:16px;border:none;border-radius:14px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:16px;';
  }

  function cardStyle() {
    return 'background:rgba(255,255,255,0.08);backdrop-filter:blur(20px);border-radius:24px;padding:40px 32px;max-width:400px;width:100%;text-align:center;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);';
  }

  // ============================================================
  // Pantalla: LOGIN (tiene hash local o conoce la DB URL)
  // ============================================================
  function showLogin(hashData) {
    hideApp();
    var overlay = createOverlay();
    var card = document.createElement('div');
    card.setAttribute('style', cardStyle());
    card.innerHTML = ''
      + '<div style="font-size:56px;margin-bottom:16px">\uD83D\uDD12</div>'
      + '<h1 style="margin:0 0 8px 0;font-size:24px;font-weight:700">DebtControl Pro</h1>'
      + '<p style="margin:0 0 8px 0;font-size:14px;color:rgba(255,255,255,0.6)">Ingresa el c\u00f3digo de acceso</p>'
      + '<input id="dc-code" type="password" placeholder="C\u00f3digo de acceso" style="' + inputStyle() + 'letter-spacing:4px;font-size:20px" autocomplete="off">'
      + '<div id="dc-err" style="color:#FF6B6B;font-size:13px;margin-top:10px;min-height:18px"></div>'
      + '<button id="dc-btn" style="' + btnStyle() + '">\u2192 Entrar</button>'
      + '<p style="margin:20px 0 0 0;font-size:11px;color:rgba(255,255,255,0.25)">Acceso protegido</p>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var inp = card.querySelector('#dc-code');
    var btn = card.querySelector('#dc-btn');
    var err = card.querySelector('#dc-err');
    inp.focus();

    async function doLogin() {
      var code = inp.value;
      if (!code) { err.textContent = 'Ingresa el c\u00f3digo'; return; }
      btn.disabled = true;
      btn.textContent = '\u23F3 Verificando...';
      err.textContent = '';

      var hash = await sha256(code);

      // Si tenemos hash en memoria, comparar directo
      if (hashData && hashData.hash) {
        if (hash === hashData.hash) {
          createSession();
          localStorage.setItem(LOCAL_HASH_KEY, hash);
          overlay.remove();
          showApp();
          return;
        }
      }

      // Si no, intentar comparar con Firebase REST
      var dbUrl = getDbUrl();
      if (dbUrl) {
        var remote = await getRemoteHash(dbUrl);
        if (remote && remote.hash === hash) {
          createSession();
          localStorage.setItem(LOCAL_HASH_KEY, hash);
          overlay.remove();
          showApp();
          return;
        }
      }

      err.textContent = 'C\u00f3digo incorrecto';
      btn.disabled = false;
      btn.textContent = '\u2192 Entrar';
      inp.value = '';
      inp.focus();
    }

    btn.addEventListener('click', doLogin);
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
  }

  // ============================================================
  // Pantalla: SETUP (primer uso, crear código)
  // ============================================================
  function showSetup(dbUrl) {
    hideApp();
    var overlay = createOverlay();
    var card = document.createElement('div');
    card.setAttribute('style', cardStyle());
    card.innerHTML = ''
      + '<div style="font-size:56px;margin-bottom:16px">\uD83D\uDD10</div>'
      + '<h1 style="margin:0 0 8px 0;font-size:24px;font-weight:700">Configurar Acceso</h1>'
      + '<p style="margin:0 0 8px 0;font-size:14px;color:rgba(255,255,255,0.6)">Crea un c\u00f3digo para proteger la app.<br>Solo quien lo conozca podr\u00e1 entrar.</p>'
      + '<input id="dc-code1" type="password" placeholder="Crea tu c\u00f3digo (m\u00edn. 4 caracteres)" style="' + inputStyle() + 'letter-spacing:4px" autocomplete="off">'
      + '<input id="dc-code2" type="password" placeholder="Confirma el c\u00f3digo" style="' + inputStyle() + 'letter-spacing:4px" autocomplete="off">'
      + '<div id="dc-err" style="color:#FF6B6B;font-size:13px;margin-top:10px;min-height:18px"></div>'
      + '<button id="dc-btn" style="' + btnStyle() + '">\uD83D\uDD10 Establecer C\u00f3digo</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var inp1 = card.querySelector('#dc-code1');
    var inp2 = card.querySelector('#dc-code2');
    var btn = card.querySelector('#dc-btn');
    var err = card.querySelector('#dc-err');
    inp1.focus();

    async function doSetup() {
      var c1 = inp1.value, c2 = inp2.value;
      if (c1.length < 4) { err.textContent = 'M\u00ednimo 4 caracteres'; return; }
      if (c1 !== c2) { err.textContent = 'Los c\u00f3digos no coinciden'; return; }
      btn.disabled = true;
      btn.textContent = '\u23F3 Guardando...';

      var hash = await sha256(c1);
      localStorage.setItem(LOCAL_HASH_KEY, hash);
      if (dbUrl) {
        localStorage.setItem(DB_URL_KEY, dbUrl);
        await saveRemoteHash(dbUrl, hash);
      }
      createSession();
      overlay.remove();
      showApp();
    }

    btn.addEventListener('click', doSetup);
    inp1.addEventListener('keydown', function(e) { if (e.key === 'Enter') inp2.focus(); });
    inp2.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSetup(); });
  }

  // ============================================================
  // Pantalla: NUEVO DISPOSITIVO (no tiene config, pide DB URL + código)
  // ============================================================
  function showNewDevice() {
    hideApp();
    var overlay = createOverlay();
    var card = document.createElement('div');
    card.setAttribute('style', cardStyle());
    card.innerHTML = ''
      + '<div style="font-size:56px;margin-bottom:16px">\uD83D\uDCF1</div>'
      + '<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700">Nuevo Dispositivo</h1>'
      + '<p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.6)">Para acceder desde este dispositivo, necesitas tu <b>URL de Firebase</b> y tu <b>c\u00f3digo de acceso</b>.</p>'
      + '<p style="margin:0 0 4px 0;font-size:11px;color:rgba(255,255,255,0.4)">La URL est\u00e1 en: \u2601\uFE0F \u2192 \u2699\uFE0F \u2192 campo "Database URL" de tu otro dispositivo</p>'
      + '<input id="dc-dburl" type="url" placeholder="https://tu-proyecto-default-rtdb.firebaseio.com" style="' + inputStyle() + 'font-size:13px;letter-spacing:0" autocomplete="off">'
      + '<input id="dc-code" type="password" placeholder="C\u00f3digo de acceso" style="' + inputStyle() + 'letter-spacing:4px;font-size:18px" autocomplete="off">'
      + '<div id="dc-err" style="color:#FF6B6B;font-size:13px;margin-top:10px;min-height:18px"></div>'
      + '<button id="dc-btn" style="' + btnStyle() + '">\uD83D\uDD13 Verificar y Entrar</button>'
      + '<p style="margin:20px 0 0 0;font-size:11px;color:rgba(255,255,255,0.25)">DebtControl Pro \u00b7 Acceso protegido</p>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var inpUrl = card.querySelector('#dc-dburl');
    var inpCode = card.querySelector('#dc-code');
    var btn = card.querySelector('#dc-btn');
    var err = card.querySelector('#dc-err');
    inpUrl.focus();

    async function doVerify() {
      var dbUrl = inpUrl.value.trim();
      var code = inpCode.value;
      err.textContent = '';

      if (!dbUrl || !dbUrl.startsWith('https://')) {
        err.textContent = 'URL inv\u00e1lida. Debe empezar con https://';
        return;
      }
      if (!code) { err.textContent = 'Ingresa el c\u00f3digo'; return; }

      btn.disabled = true;
      btn.textContent = '\u23F3 Verificando...';

      // Intentar leer el hash desde Firebase REST
      var remote = await getRemoteHash(dbUrl);
      if (!remote || !remote.hash) {
        err.textContent = 'No se encontr\u00f3 configuraci\u00f3n. Verifica la URL.';
        btn.disabled = false;
        btn.textContent = '\uD83D\uDD13 Verificar y Entrar';
        return;
      }

      var hash = await sha256(code);
      if (hash === remote.hash) {
        // Guardar todo para futuros accesos
        localStorage.setItem(DB_URL_KEY, dbUrl);
        localStorage.setItem(LOCAL_HASH_KEY, hash);
        createSession();
        overlay.remove();
        showApp();
      } else {
        err.textContent = 'C\u00f3digo incorrecto';
        btn.disabled = false;
        btn.textContent = '\uD83D\uDD13 Verificar y Entrar';
        inpCode.value = '';
        inpCode.focus();
      }
    }

    btn.addEventListener('click', doVerify);
    inpUrl.addEventListener('keydown', function(e) { if (e.key === 'Enter') inpCode.focus(); });
    inpCode.addEventListener('keydown', function(e) { if (e.key === 'Enter') doVerify(); });
  }

  // ============================================================
  // Admin: cambiar/resetear código
  // ============================================================
  window.DebtControlGuard = {
    changeCode: async function() {
      var current = prompt('C\u00f3digo actual:');
      if (!current) return;
      var currentHash = await sha256(current);
      var localHash = localStorage.getItem(LOCAL_HASH_KEY);
      if (currentHash !== localHash) { alert('C\u00f3digo incorrecto'); return; }
      var newCode = prompt('Nuevo c\u00f3digo (m\u00edn. 4 caracteres):');
      if (!newCode || newCode.length < 4) { alert('Muy corto (m\u00edn. 4)'); return; }
      var confirm2 = prompt('Confirma el nuevo c\u00f3digo:');
      if (newCode !== confirm2) { alert('No coinciden'); return; }
      var newHash = await sha256(newCode);
      localStorage.setItem(LOCAL_HASH_KEY, newHash);
      var dbUrl = getDbUrl();
      if (dbUrl) await saveRemoteHash(dbUrl, newHash);
      alert('\u2705 C\u00f3digo cambiado');
    },
    resetCode: async function() {
      if (prompt('Escribe CONFIRMAR para eliminar el c\u00f3digo:') !== 'CONFIRMAR') return;
      localStorage.removeItem(LOCAL_HASH_KEY);
      var dbUrl = getDbUrl();
      if (dbUrl) {
        try {
          var url = dbUrl.replace(/\/$/, '') + GUARD_PATH;
          await fetch(url, { method: 'DELETE' });
        } catch (e) {}
      }
      alert('\u2705 C\u00f3digo eliminado. Recarga la p\u00e1gina.');
    }
  };

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    // 1. Sesión válida → pasar
    if (hasValidSession()) return;

    // 2. ¿Hay hash local?
    var localHash = localStorage.getItem(LOCAL_HASH_KEY);
    if (localHash) {
      showLogin({ hash: localHash });
      return;
    }

    // 3. ¿Hay URL de Firebase disponible? (de cloud-sync o guardada antes)
    var dbUrl = getDbUrl();
    if (dbUrl) {
      // Intentar leer hash remoto
      var remote = await getRemoteHash(dbUrl);
      if (remote && remote.hash) {
        // Ya hay código configurado → pedir login
        localStorage.setItem(LOCAL_HASH_KEY, remote.hash);
        showLogin(remote);
      } else {
        // No hay código aún → permitir setup (primer uso real)
        showSetup(dbUrl);
      }
      return;
    }

    // 4. Dispositivo completamente nuevo (sin nada) → pedir URL + código
    showNewDevice();
  }

  init();

})();

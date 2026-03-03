/**
 * DebtControl Pro - Site Guard v4.0
 * Protección de acceso con código maestro
 *
 * v4.0 - Rate limiting, sesión configurable, modals bonitos
 * - Firebase REST API (no SDK, solo URL)
 * - Hash SHA-256
 * - Bloqueo tras 5 intentos fallidos (5 min)
 * - Sesión persistente configurable (1h, 8h, 24h, 7d, siempre)
 */

(function() {
  'use strict';

  var SESSION_KEY = 'debtcontrol_auth_session';
  var LOCAL_HASH_KEY = 'debtcontrol_access_hash';
  var DB_URL_KEY = 'debtcontrol_guard_dburl';
  var GUARD_PATH = '/config/siteGuard.json';
  var ATTEMPTS_KEY = 'debtcontrol_login_attempts';
  var SESSION_DURATION_KEY = 'debtcontrol_session_duration';

  var MAX_ATTEMPTS = 5;
  var LOCKOUT_MINUTES = 5;

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
  // Firebase REST API
  // ============================================================
  function getDbUrl() {
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
  // Rate Limiting (anti fuerza bruta)
  // ============================================================
  function getAttempts() {
    try {
      var data = JSON.parse(localStorage.getItem(ATTEMPTS_KEY));
      if (!data) return { count: 0 };
      if (data.lockedUntil && Date.now() >= data.lockedUntil) {
        localStorage.removeItem(ATTEMPTS_KEY);
        return { count: 0 };
      }
      return data;
    } catch (e) { return { count: 0 }; }
  }

  function recordFailedAttempt() {
    var data = getAttempts();
    data.count = (data.count || 0) + 1;
    if (data.count >= MAX_ATTEMPTS) {
      data.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    }
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(data));
    return data;
  }

  function clearAttempts() {
    localStorage.removeItem(ATTEMPTS_KEY);
  }

  function isLocked() {
    var data = getAttempts();
    return !!(data.lockedUntil && Date.now() < data.lockedUntil);
  }

  function getRemainingLockSeconds() {
    var data = getAttempts();
    if (data.lockedUntil) {
      var remaining = Math.ceil((data.lockedUntil - Date.now()) / 1000);
      return remaining > 0 ? remaining : 0;
    }
    return 0;
  }

  // ============================================================
  // Sesión persistente (configurable)
  // ============================================================
  function getSessionHours() {
    var saved = localStorage.getItem(SESSION_DURATION_KEY);
    return saved !== null ? parseFloat(saved) : 24;
  }

  function hasValidSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!s) return false;
      var hours = getSessionHours();
      if (hours === 0) return true; // "No cerrar sesión"
      return Date.now() - s.ts < hours * 60 * 60 * 1000;
    } catch (e) { return false; }
  }

  function createSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
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
  // Pantalla: LOGIN
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

    // Mostrar estado de bloqueo si aplica
    if (isLocked()) {
      var secs = getRemainingLockSeconds();
      err.textContent = '\uD83D\uDD12 Bloqueado. Intenta en ' + Math.ceil(secs / 60) + ' min';
      btn.disabled = true;
      btn.style.opacity = '0.5';
      var lockTimer = setInterval(function() {
        var remaining = getRemainingLockSeconds();
        if (remaining <= 0) {
          clearInterval(lockTimer);
          err.textContent = '';
          btn.disabled = false;
          btn.style.opacity = '1';
        } else {
          err.textContent = '\uD83D\uDD12 Bloqueado. Intenta en ' + Math.ceil(remaining / 60) + ' min';
        }
      }, 5000);
    }

    inp.focus();

    async function doLogin() {
      if (isLocked()) {
        err.textContent = '\uD83D\uDD12 Demasiados intentos. Espera unos minutos.';
        return;
      }
      var code = inp.value;
      if (!code) { err.textContent = 'Ingresa el c\u00f3digo'; return; }
      btn.disabled = true;
      btn.textContent = '\u23F3 Verificando...';
      err.textContent = '';

      var hash = await sha256(code);
      var success = false;

      if (hashData && hashData.hash && hash === hashData.hash) {
        success = true;
      }

      if (!success) {
        var dbUrl = getDbUrl();
        if (dbUrl) {
          var remote = await getRemoteHash(dbUrl);
          if (remote && remote.hash === hash) {
            success = true;
          }
        }
      }

      if (success) {
        clearAttempts();
        createSession();
        localStorage.setItem(LOCAL_HASH_KEY, hash);
        overlay.remove();
        showApp();
        return;
      }

      // Fallo
      var attemptData = recordFailedAttempt();
      if (attemptData.lockedUntil) {
        err.textContent = '\uD83D\uDD12 Demasiados intentos. Bloqueado ' + LOCKOUT_MINUTES + ' min';
        btn.disabled = true;
        btn.style.opacity = '0.5';
        var lockTimer2 = setInterval(function() {
          if (!isLocked()) {
            clearInterval(lockTimer2);
            err.textContent = '';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.textContent = '\u2192 Entrar';
          }
        }, 5000);
      } else {
        var remaining = MAX_ATTEMPTS - attemptData.count;
        err.textContent = 'C\u00f3digo incorrecto (' + remaining + ' intento' + (remaining !== 1 ? 's' : '') + ' restante' + (remaining !== 1 ? 's' : '') + ')';
        btn.disabled = false;
        btn.textContent = '\u2192 Entrar';
      }
      inp.value = '';
      inp.focus();
    }

    btn.addEventListener('click', doLogin);
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
  }

  // ============================================================
  // Pantalla: SETUP (primer uso)
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
  // Pantalla: NUEVO DISPOSITIVO
  // ============================================================
  function showNewDevice() {
    hideApp();
    var overlay = createOverlay();
    var card = document.createElement('div');
    card.setAttribute('style', cardStyle());
    card.innerHTML = ''
      + '<div style="font-size:56px;margin-bottom:16px">\uD83D\uDCF1</div>'
      + '<h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700">Nuevo Dispositivo</h1>'
      + '<p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.6)">Para acceder necesitas tu <b>URL de Firebase</b> y tu <b>c\u00f3digo de acceso</b>.</p>'
      + '<p style="margin:0 0 4px 0;font-size:11px;color:rgba(255,255,255,0.4)">La URL est\u00e1 en: \u2601\uFE0F \u2192 \u2699\uFE0F de tu otro dispositivo</p>'
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

      var remote = await getRemoteHash(dbUrl);
      if (!remote || !remote.hash) {
        err.textContent = 'No se encontr\u00f3 configuraci\u00f3n. Verifica la URL.';
        btn.disabled = false;
        btn.textContent = '\uD83D\uDD13 Verificar y Entrar';
        return;
      }

      var hash = await sha256(code);
      if (hash === remote.hash) {
        localStorage.setItem(DB_URL_KEY, dbUrl);
        localStorage.setItem(LOCAL_HASH_KEY, hash);
        clearAttempts();
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
  // Admin: cambiar código (modal bonito)
  // ============================================================
  function showChangeCodeModal() {
    var existing = document.getElementById('dc-change-code-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'dc-change-code-modal';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: '999998', padding: '16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var bg = isDark ? '#1a1a2e' : '#fff';
    var txt = isDark ? '#fff' : '#1a1a2e';
    var iBg = isDark ? '#16213e' : '#f5f5f5';
    var bdr = isDark ? '#2d3748' : '#e0e0e0';

    var card = document.createElement('div');
    Object.assign(card.style, {
      background: bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
      width: '100%', color: txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:14px;border-radius:10px;border:1px solid ' + bdr + ';background:' + iBg + ';color:' + txt + ';font-size:15px;box-sizing:border-box;margin-top:10px;text-align:center;letter-spacing:3px;outline:none;';

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '  <h2 style="margin:0;font-size:18px">\uD83D\uDD12 Cambiar C\u00f3digo</h2>'
      + '  <button id="dc-cc-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + txt + '">\u2715</button>'
      + '</div>'
      + '<label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">C\u00f3digo actual</label>'
      + '<input id="dc-cc-current" type="password" placeholder="\u2022\u2022\u2022\u2022" style="' + iSt + '">'
      + '<label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + ';display:block;margin-top:12px">Nuevo c\u00f3digo (m\u00edn. 4)</label>'
      + '<input id="dc-cc-new1" type="password" placeholder="Nuevo c\u00f3digo" style="' + iSt + '">'
      + '<input id="dc-cc-new2" type="password" placeholder="Confirmar nuevo" style="' + iSt + '">'
      + '<div id="dc-cc-err" style="color:#FF6B6B;font-size:13px;margin-top:10px;min-height:18px;text-align:center"></div>'
      + '<button id="dc-cc-btn" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px">\uD83D\uDD10 Cambiar C\u00f3digo</button>'
      + '<button id="dc-cc-logout" style="width:100%;padding:12px;border:1px solid #FF3B30;border-radius:10px;background:transparent;color:#FF3B30;font-size:13px;cursor:pointer;margin-top:10px">\uD83D\uDEAA Cerrar Sesi\u00f3n</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    card.querySelector('#dc-cc-close').addEventListener('click', function() { overlay.remove(); });

    card.querySelector('#dc-cc-logout').addEventListener('click', function() {
      clearSession();
      overlay.remove();
      location.reload();
    });

    card.querySelector('#dc-cc-btn').addEventListener('click', async function() {
      var cur = card.querySelector('#dc-cc-current').value;
      var n1 = card.querySelector('#dc-cc-new1').value;
      var n2 = card.querySelector('#dc-cc-new2').value;
      var errEl = card.querySelector('#dc-cc-err');
      var btnEl = card.querySelector('#dc-cc-btn');
      errEl.textContent = '';

      if (!cur) { errEl.textContent = 'Ingresa el c\u00f3digo actual'; return; }
      var curHash = await sha256(cur);
      var localHash = localStorage.getItem(LOCAL_HASH_KEY);
      if (curHash !== localHash) { errEl.textContent = 'C\u00f3digo actual incorrecto'; return; }
      if (n1.length < 4) { errEl.textContent = 'M\u00ednimo 4 caracteres'; return; }
      if (n1 !== n2) { errEl.textContent = 'Los c\u00f3digos no coinciden'; return; }

      btnEl.disabled = true;
      btnEl.textContent = '\u23F3 Guardando...';
      var newHash = await sha256(n1);
      localStorage.setItem(LOCAL_HASH_KEY, newHash);
      var db = getDbUrl();
      if (db) await saveRemoteHash(db, newHash);

      overlay.remove();
      var toast = document.createElement('div');
      toast.textContent = '\u2705 C\u00f3digo cambiado exitosamente';
      Object.assign(toast.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        background: '#34C759', color: '#fff', padding: '12px 24px', borderRadius: '12px',
        fontSize: '14px', fontWeight: '500', zIndex: '99999', boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
      });
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 3000);
    });
  }

  // ============================================================
  // API pública
  // ============================================================
  window.DebtControlGuard = {
    changeCode: showChangeCodeModal,
    logout: function() { clearSession(); location.reload(); },
    lock: function() { clearSession(); location.reload(); },
    setSessionDuration: function(hours) {
      localStorage.setItem(SESSION_DURATION_KEY, String(hours));
    },
    getSessionDuration: getSessionHours,
    resetCode: async function() {
      // Usar dcConfirm si está disponible (de cloud-sync.js), sino fallback
      var doConfirm = window.dcConfirm || function(msg) { return Promise.resolve(confirm(msg)); };
      var ok = await doConfirm('\u00bfEliminar el c\u00f3digo de acceso?\nTendr\u00e1s que crear uno nuevo.');
      if (!ok) return;
      localStorage.removeItem(LOCAL_HASH_KEY);
      var db = getDbUrl();
      if (db) {
        try {
          var url = db.replace(/\/$/, '') + GUARD_PATH;
          await fetch(url, { method: 'DELETE' });
        } catch (e) {}
      }
      clearSession();
      location.reload();
    }
  };

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (hasValidSession()) return;

    var localHash = localStorage.getItem(LOCAL_HASH_KEY);
    if (localHash) {
      showLogin({ hash: localHash });
      return;
    }

    var dbUrl = getDbUrl();
    if (dbUrl) {
      var remote = await getRemoteHash(dbUrl);
      if (remote && remote.hash) {
        localStorage.setItem(LOCAL_HASH_KEY, remote.hash);
        showLogin(remote);
      } else {
        showSetup(dbUrl);
      }
      return;
    }

    showNewDevice();
  }

  init();
})();

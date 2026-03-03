/**
 * DebtControl Pro - Site Guard v1.0
 * Protección de acceso al sitio con código maestro
 * 
 * - Primer usuario configura el código maestro
 * - Todos los demás necesitan el código para entrar
 * - Hash SHA-256 almacenado en Firebase
 * - Sesión por pestaña (sessionStorage)
 */

(function() {
  'use strict';

  var SESSION_KEY = 'debtcontrol_auth_session';
  var LOCAL_HASH_KEY = 'debtcontrol_access_hash';
  var FIREBASE_GUARD_PATH = 'config/siteGuard';

  // ============================================================
  // SHA-256 hash
  // ============================================================
  async function sha256(text) {
    var encoder = new TextEncoder();
    var data = encoder.encode(text);
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ============================================================
  // Firebase helpers (reutiliza el SDK que carga cloud-sync)
  // ============================================================
  function getFirebaseConfig() {
    try {
      var raw = localStorage.getItem('debtcontrol_firebase_config');
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      if (cfg && cfg.apiKey && cfg.databaseURL && cfg.projectId) return cfg;
    } catch (e) {}
    return null;
  }

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function getFirebaseDB() {
    var config = getFirebaseConfig();
    if (!config) return null;
    try {
      if (!window.firebase) {
        await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js');
      }
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(config);
      }
      return firebase.database();
    } catch (e) {
      console.warn('[SiteGuard] No se pudo conectar a Firebase:', e);
      return null;
    }
  }

  // ============================================================
  // Leer/guardar hash del código maestro
  // ============================================================
  async function getSavedHash() {
    // Primero intenta Firebase
    var db = await getFirebaseDB();
    if (db) {
      try {
        var snap = await db.ref(FIREBASE_GUARD_PATH).get();
        if (snap.exists()) {
          var data = snap.val();
          // Sincronizar local
          if (data.hash) localStorage.setItem(LOCAL_HASH_KEY, data.hash);
          return data;
        }
      } catch (e) {
        console.warn('[SiteGuard] Error leyendo Firebase:', e);
      }
    }
    // Fallback local
    var localHash = localStorage.getItem(LOCAL_HASH_KEY);
    if (localHash) return { hash: localHash };
    return null;
  }

  async function saveHash(hash) {
    localStorage.setItem(LOCAL_HASH_KEY, hash);
    var db = await getFirebaseDB();
    if (db) {
      try {
        await db.ref(FIREBASE_GUARD_PATH).set({
          hash: hash,
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn('[SiteGuard] Error guardando en Firebase:', e);
      }
    }
  }

  // ============================================================
  // Verificar sesión actual
  // ============================================================
  function hasValidSession() {
    var session = sessionStorage.getItem(SESSION_KEY);
    if (!session) return false;
    try {
      var data = JSON.parse(session);
      // Sesión válida por 12 horas
      if (Date.now() - data.ts < 12 * 60 * 60 * 1000) return true;
    } catch (e) {}
    return false;
  }

  function createSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now(), v: 1 }));
  }

  // ============================================================
  // UI: Pantalla de acceso
  // ============================================================
  function showGuardScreen(mode) {
    // mode: 'setup' = primer uso, 'login' = pedir código, 'admin' = cambiar código

    // Ocultar la app
    var root = document.getElementById('root');
    var loading = document.getElementById('loading');
    if (root) root.style.display = 'none';
    if (loading) loading.style.display = 'none';

    // Bloquear los scripts de la app
    var overlay = document.createElement('div');
    overlay.id = 'dc-guard';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '999999', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '16px'
    });

    var isSetup = mode === 'setup';

    var card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)',
      borderRadius: '24px', padding: '40px 32px', maxWidth: '380px', width: '100%',
      textAlign: 'center', color: '#fff',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)'
    });

    card.innerHTML = ''
      + '<div style="font-size:56px;margin-bottom:16px">' + (isSetup ? '\uD83D\uDD10' : '\uD83D\uDD12') + '</div>'
      + '<h1 style="margin:0 0 8px 0;font-size:24px;font-weight:700">' + (isSetup ? 'Configurar Acceso' : 'DebtControl Pro') + '</h1>'
      + '<p style="margin:0 0 24px 0;font-size:14px;color:rgba(255,255,255,0.6)">'
      + (isSetup ? 'Crea un c\u00f3digo de acceso para proteger tu app.<br>Solo quien lo conozca podr\u00e1 entrar.' : 'Ingresa el c\u00f3digo de acceso')
      + '</p>'
      + '<input id="dc-guard-code" type="password" placeholder="' + (isSetup ? 'Crea tu c\u00f3digo (m\u00edn. 4 caracteres)' : 'C\u00f3digo de acceso') + '" '
      + 'style="width:100%;padding:16px;border-radius:14px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;font-size:18px;text-align:center;box-sizing:border-box;outline:none;letter-spacing:4px" '
      + 'autocomplete="off" inputmode="text">'
      + (isSetup ? '<input id="dc-guard-code2" type="password" placeholder="Confirma el c\u00f3digo" '
      + 'style="width:100%;padding:16px;border-radius:14px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;font-size:18px;text-align:center;box-sizing:border-box;margin-top:12px;outline:none;letter-spacing:4px" '
      + 'autocomplete="off" inputmode="text">' : '')
      + '<div id="dc-guard-error" style="color:#FF6B6B;font-size:13px;margin-top:12px;min-height:20px"></div>'
      + '<button id="dc-guard-btn" style="width:100%;padding:16px;border:none;border-radius:14px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px;transition:opacity 0.2s">'
      + (isSetup ? '\uD83D\uDD10 Establecer C\u00f3digo' : '\u2192 Entrar') + '</button>'
      + '<p style="margin:24px 0 0 0;font-size:11px;color:rgba(255,255,255,0.3)">DebtControl Pro \u00b7 Acceso protegido</p>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var input1 = card.querySelector('#dc-guard-code');
    var input2 = card.querySelector('#dc-guard-code2');
    var errorDiv = card.querySelector('#dc-guard-error');
    var btn = card.querySelector('#dc-guard-btn');

    input1.focus();

    function showError(msg) { errorDiv.textContent = msg; }

    async function handleSubmit() {
      var code = input1.value;
      btn.disabled = true;
      btn.textContent = '\u23F3 Verificando...';
      showError('');

      if (isSetup) {
        var code2 = input2.value;
        if (code.length < 4) { showError('El c\u00f3digo debe tener al menos 4 caracteres'); btn.disabled = false; btn.textContent = '\uD83D\uDD10 Establecer C\u00f3digo'; return; }
        if (code !== code2) { showError('Los c\u00f3digos no coinciden'); btn.disabled = false; btn.textContent = '\uD83D\uDD10 Establecer C\u00f3digo'; return; }

        var hash = await sha256(code);
        await saveHash(hash);
        createSession();
        overlay.remove();
        unlockApp();
      } else {
        var hash = await sha256(code);
        var saved = await getSavedHash();
        if (saved && saved.hash === hash) {
          createSession();
          overlay.remove();
          unlockApp();
        } else {
          showError('C\u00f3digo incorrecto');
          btn.disabled = false;
          btn.textContent = '\u2192 Entrar';
          input1.value = '';
          input1.focus();
        }
      }
    }

    btn.addEventListener('click', handleSubmit);
    var lastInput = input2 || input1;
    lastInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleSubmit();
    });
    input1.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        if (isSetup && input2) { input2.focus(); }
        else { handleSubmit(); }
      }
    });
  }

  function unlockApp() {
    var root = document.getElementById('root');
    var loading = document.getElementById('loading');
    if (root) root.style.display = '';
    if (loading) loading.style.display = '';
  }

  // ============================================================
  // Admin: Cambiar código (accesible desde consola o cloud-sync)
  // ============================================================
  window.DebtControlGuard = {
    changeCode: async function() {
      var current = prompt('Ingresa el c\u00f3digo actual:');
      if (!current) return;
      var currentHash = await sha256(current);
      var saved = await getSavedHash();
      if (!saved || saved.hash !== currentHash) {
        alert('C\u00f3digo incorrecto');
        return;
      }
      var newCode = prompt('Ingresa el nuevo c\u00f3digo (m\u00edn. 4 caracteres):');
      if (!newCode || newCode.length < 4) { alert('C\u00f3digo muy corto'); return; }
      var confirm2 = prompt('Confirma el nuevo c\u00f3digo:');
      if (newCode !== confirm2) { alert('No coinciden'); return; }
      var newHash = await sha256(newCode);
      await saveHash(newHash);
      alert('\u2705 C\u00f3digo cambiado exitosamente');
    },
    resetCode: async function() {
      var msg = '\u00bfEliminar el c\u00f3digo de acceso? Esto permitir\u00e1 que cualquiera entre sin c\u00f3digo hasta que se configure uno nuevo.\n\nEscribe CONFIRMAR para continuar:';
      var answer = prompt(msg);
      if (answer !== 'CONFIRMAR') return;
      localStorage.removeItem(LOCAL_HASH_KEY);
      var db = await getFirebaseDB();
      if (db) { try { await db.ref(FIREBASE_GUARD_PATH).remove(); } catch(e) {} }
      alert('\u2705 C\u00f3digo eliminado. Recarga la p\u00e1gina.');
    }
  };

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    // Si ya tiene sesión válida, no pedir código
    if (hasValidSession()) return;

    // Verificar si hay código configurado
    var saved = await getSavedHash();

    if (!saved) {
      // Primer uso: configurar código maestro
      showGuardScreen('setup');
    } else {
      // Pedir código
      showGuardScreen('login');
    }
  }

  // Ejecutar ANTES de que la app cargue
  init();

})();

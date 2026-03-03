/**
 * DebtControl Pro - Cloud Sync Module v2.5
 * Sincronización en la nube usando Firebase Realtime Database (gratis, sin servidor)
 * 
 * - Configurable desde la app (sin editar código)
 * - Backup local JSON (offline)
 * - Sync con Firebase (online)
 * - Auto-backup, cifrado con PIN, vinculación entre dispositivos
 * 
 * SETUP: Toca el botón ☁️ > ⚙️ Configurar Firebase
 */

(function() {
  'use strict';

  // ============================================================
  // Constantes
  // ============================================================
  const SYNC_KEYS = ['debts', 'payments', 'reminders', 'investments', 'savings', 'userStats'];
  const SYNC_VERSION = '2.5.0';
  const LS_FIREBASE_CONFIG = 'debtcontrol_firebase_config';
  const LS_SYNC_ID = 'debtcontrol_sync_id';
  const LS_LAST_SYNC = 'debtcontrol_last_sync';
  const LS_SYNC_PIN = 'debtcontrol_sync_pin';
  const LS_AUTO_BACKUP = 'debtcontrol_auto_backup';

  let firebaseReady = false;
  let db = null;
  let syncUserId = null;

  // ============================================================
  // Utilidades
  // ============================================================

  function getLocalForage() {
    if (window.localforage) return window.localforage;
    return null;
  }

  async function getAllLocalData() {
    const lf = getLocalForage();
    const data = {};
    for (const key of SYNC_KEYS) {
      try {
        if (lf) {
          data[key] = await lf.getItem(key);
        } else {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.endsWith('/' + key)) {
              try { data[key] = JSON.parse(localStorage.getItem(k)); } catch(e) {}
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[CloudSync] Error leyendo ' + key, e);
      }
    }
    return data;
  }

  // ============================================================
  // Firebase Config (guardada en localStorage, configurable desde UI)
  // ============================================================

  function getSavedFirebaseConfig() {
    try {
      const raw = localStorage.getItem(LS_FIREBASE_CONFIG);
      if (!raw) return null;
      const cfg = JSON.parse(raw);
      if (cfg && cfg.apiKey && cfg.databaseURL && cfg.projectId) return cfg;
    } catch (e) {}
    return null;
  }

  function saveFirebaseConfig(config) {
    localStorage.setItem(LS_FIREBASE_CONFIG, JSON.stringify(config));
  }

  function clearFirebaseConfig() {
    localStorage.removeItem(LS_FIREBASE_CONFIG);
    firebaseReady = false;
    db = null;
  }

  // ============================================================
  // Cifrado simple con PIN (para proteger datos en la nube)
  // ============================================================

  function getSyncPin() {
    return localStorage.getItem(LS_SYNC_PIN) || '';
  }

  function simpleEncrypt(text, pin) {
    if (!pin) return text;
    const encoded = btoa(unescape(encodeURIComponent(text)));
    let result = '';
    for (let i = 0; i < encoded.length; i++) {
      result += String.fromCharCode(encoded.charCodeAt(i) ^ pin.charCodeAt(i % pin.length));
    }
    return btoa(result);
  }

  function simpleDecrypt(text, pin) {
    if (!pin) return text;
    try {
      const decoded = atob(text);
      let result = '';
      for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ pin.charCodeAt(i % pin.length));
      }
      return decodeURIComponent(escape(atob(result)));
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // Backup Local (JSON)
  // ============================================================

  async function exportToJSON() {
    try {
      const data = await getAllLocalData();
      data._exportDate = new Date().toISOString();
      data._version = SYNC_VERSION;
      data._app = 'DebtControl Pro';

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'debtcontrol-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('\u2705 Backup descargado correctamente');
    } catch (err) {
      console.error('[CloudSync] Error exportando:', err);
      showToast('\u274C Error al exportar datos');
    }
  }

  async function importFromJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data._app && !data.debts && !data.payments) {
          showToast('\u274C Archivo no v\u00e1lido'); return;
        }
        if (!confirm('\u00bfReemplazar datos actuales con el backup?\nEsta acci\u00f3n no se puede deshacer.')) return;

        const lf = getLocalForage();
        for (const key of SYNC_KEYS) {
          if (data[key] != null && lf) {
            await lf.setItem(key, data[key]);
          }
        }
        showToast('\u2705 Datos restaurados. Recargando...');
        setTimeout(function() { location.reload(); }, 1500);
      } catch (err) {
        console.error('[CloudSync] Error importando:', err);
        showToast('\u274C Archivo corrupto o no v\u00e1lido');
      }
    };
    input.click();
  }

  // ============================================================
  // Firebase Init / Sync
  // ============================================================

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

  async function initFirebase() {
    var config = getSavedFirebaseConfig();
    if (!config) {
      console.log('[CloudSync] Firebase no configurado');
      return false;
    }
    try {
      if (!window.firebase) {
        await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js');
      }
      if (firebase.apps && firebase.apps.length) {
        // ya inicializado
      } else {
        firebase.initializeApp(config);
      }
      db = firebase.database();

      syncUserId = localStorage.getItem(LS_SYNC_ID);
      if (!syncUserId) {
        syncUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(LS_SYNC_ID, syncUserId);
      }

      // Test: escribir y leer un nodo de prueba para verificar conexion real
      var testRef = db.ref('_ping');
      await testRef.set({ ts: Date.now() });

      firebaseReady = true;
      console.log('[CloudSync] Firebase conectado OK');
      return true;
    } catch (err) {
      console.error('[CloudSync] Error Firebase:', err);
      // Mostrar detalle del error en consola para debug
      if (err.code) console.error('[CloudSync] Codigo:', err.code);
      firebaseReady = false;
      return false;
    }
  }

  async function syncToCloud() {
    if (!firebaseReady) { showToast('\u26A0\uFE0F Configura Firebase primero (bot\u00f3n \u2601\uFE0F > \u2699\uFE0F)'); return; }
    try {
      showToast('\u2601\uFE0F Subiendo datos...');
      var data = await getAllLocalData();
      var pin = getSyncPin();

      var payload = {
        _lastSync: new Date().toISOString(),
        _version: SYNC_VERSION,
        _device: navigator.userAgent.substring(0, 60),
        _encrypted: !!pin
      };

      if (pin) {
        payload._data = simpleEncrypt(JSON.stringify(data), pin);
      } else {
        for (var k in data) { payload[k] = data[k]; }
      }

      await db.ref('users/' + syncUserId + '/data').set(payload);
      localStorage.setItem(LS_LAST_SYNC, new Date().toISOString());
      showToast('\u2705 Sincronizado con la nube');
    } catch (err) {
      console.error('[CloudSync]', err);
      showToast('\u274C Error: ' + (err.message || 'sin conexi\u00f3n'));
    }
  }

  async function syncFromCloud() {
    if (!firebaseReady) { showToast('\u26A0\uFE0F Configura Firebase primero (bot\u00f3n \u2601\uFE0F > \u2699\uFE0F)'); return; }
    try {
      showToast('\u2601\uFE0F Descargando datos...');
      var snapshot = await db.ref('users/' + syncUserId + '/data').get();
      if (!snapshot.exists()) { showToast('\u2139\uFE0F No hay datos en la nube'); return; }

      var raw = snapshot.val();
      var data;

      if (raw._encrypted) {
        var pin = getSyncPin() || prompt('Los datos est\u00e1n cifrados. Introduce tu PIN:');
        if (!pin) return;
        var decrypted = simpleDecrypt(raw._data, pin);
        if (!decrypted) { showToast('\u274C PIN incorrecto'); return; }
        data = JSON.parse(decrypted);
      } else {
        data = raw;
      }

      var lastSync = raw._lastSync || 'desconocida';
      if (!confirm('\u00bfRestaurar datos de la nube?\n\u00daltima sync: ' + lastSync + '\nEsto reemplazar\u00e1 tus datos locales.')) return;

      var lf = getLocalForage();
      for (var i = 0; i < SYNC_KEYS.length; i++) {
        var key = SYNC_KEYS[i];
        if (data[key] != null && lf) await lf.setItem(key, data[key]);
      }

      showToast('\u2705 Datos restaurados. Recargando...');
      setTimeout(function() { location.reload(); }, 1500);
    } catch (err) {
      console.error('[CloudSync]', err);
      showToast('\u274C Error: ' + (err.message || 'sin conexi\u00f3n'));
    }
  }

  // ============================================================
  // UI: Toast
  // ============================================================

  function showToast(message, duration) {
    duration = duration || 3000;
    var old = document.getElementById('dc-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'dc-toast';
    t.textContent = message;
    Object.assign(t.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      background: '#1a1a2e', color: '#fff', padding: '12px 24px', borderRadius: '12px',
      fontSize: '14px', fontWeight: '500', zIndex: '99999',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: '90vw', textAlign: 'center',
      transition: 'opacity 0.3s, transform 0.3s',
      animation: 'dcToastIn 0.3s ease'
    });
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, duration);
  }

  // ============================================================
  // UI: Panel de configuraci\u00f3n Firebase
  // ============================================================

  function showFirebaseSetup() {
    var existing = document.getElementById('dc-setup-overlay');
    if (existing) { existing.remove(); return; }

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var bg = isDark ? '#1a1a2e' : '#fff';
    var text = isDark ? '#fff' : '#1a1a2e';
    var inputBg = isDark ? '#16213e' : '#f5f5f5';
    var border = isDark ? '#2d3748' : '#e0e0e0';

    var overlay = document.createElement('div');
    overlay.id = 'dc-setup-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', zIndex: '99999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    var saved = getSavedFirebaseConfig();
    var connected = firebaseReady;
    var syncId = localStorage.getItem(LS_SYNC_ID) || 'No generado a\u00fan';
    var lastSync = localStorage.getItem(LS_LAST_SYNC) || 'Nunca';
    var pin = getSyncPin();

    var panel = document.createElement('div');
    Object.assign(panel.style, {
      background: bg, borderRadius: '20px', padding: '24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: text,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    panel.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
      + '  <h2 style="margin:0;font-size:20px">\u2699\uFE0F Configurar Firebase</h2>'
      + '  <button id="dc-close-setup" style="background:none;border:none;font-size:24px;cursor:pointer;color:' + text + ';padding:4px">\u2715</button>'
      + '</div>'
      + '<div style="background:' + (connected ? '#34C75920' : '#FF950020') + ';border-radius:12px;padding:12px;margin-bottom:16px;display:flex;align-items:center;gap:8px">'
      + '  <span style="font-size:20px">' + (connected ? '\uD83D\uDFE2' : '\uD83D\uDD34') + '</span>'
      + '  <span style="font-size:14px;font-weight:600;color:' + text + '">' + (connected ? 'Firebase conectado' : 'Firebase no conectado') + '</span>'
      + '</div>'
      + '<p style="font-size:13px;color:' + (isDark ? '#a0a0a0' : '#666') + ';margin:0 0 16px 0">'
      + '  Pega aqu\u00ed la configuraci\u00f3n de tu proyecto Firebase.<br>'
      + '  <a href="https://console.firebase.google.com/" target="_blank" rel="noopener" style="color:#007AFF">Abrir Firebase Console \u2192</a>'
      + '</p>'
      + '<div style="margin-bottom:12px">'
      + '  <label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">API Key *</label>'
      + '  <input id="dc-apiKey" value="' + (saved && saved.apiKey ? saved.apiKey : '') + '" placeholder="AIzaSy..." style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + inputBg + ';color:' + text + ';font-size:14px;box-sizing:border-box;margin-top:4px">'
      + '</div>'
      + '<div style="margin-bottom:12px">'
      + '  <label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">Database URL *</label>'
      + '  <input id="dc-dbURL" value="' + (saved && saved.databaseURL ? saved.databaseURL : '') + '" placeholder="https://tu-proyecto-default-rtdb.firebaseio.com" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + inputBg + ';color:' + text + ';font-size:14px;box-sizing:border-box;margin-top:4px">'
      + '</div>'
      + '<div style="margin-bottom:12px">'
      + '  <label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">Project ID *</label>'
      + '  <input id="dc-projectId" value="' + (saved && saved.projectId ? saved.projectId : '') + '" placeholder="mi-proyecto-12345" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + inputBg + ';color:' + text + ';font-size:14px;box-sizing:border-box;margin-top:4px">'
      + '</div>'
      + '<div style="margin-bottom:12px">'
      + '  <label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">Auth Domain</label>'
      + '  <input id="dc-authDomain" value="' + (saved && saved.authDomain ? saved.authDomain : '') + '" placeholder="mi-proyecto.firebaseapp.com" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + inputBg + ';color:' + text + ';font-size:14px;box-sizing:border-box;margin-top:4px">'
      + '</div>'
      + '<div style="margin-bottom:12px">'
      + '  <label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">App ID</label>'
      + '  <input id="dc-appId" value="' + (saved && saved.appId ? saved.appId : '') + '" placeholder="1:123456:web:abc123" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + inputBg + ';color:' + text + ';font-size:14px;box-sizing:border-box;margin-top:4px">'
      + '</div>'
      + '<div style="margin-bottom:12px;padding:12px;background:' + inputBg + ';border-radius:12px">'
      + '  <label style="font-size:12px;font-weight:600;color:' + (isDark ? '#a0a0a0' : '#888') + '">O pega todo el firebaseConfig JSON aqu\u00ed:</label>'
      + '  <textarea id="dc-jsonConfig" rows="4" placeholder=\'{"apiKey":"...","databaseURL":"...",...}\' style="width:100%;padding:10px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';color:' + text + ';font-size:12px;font-family:monospace;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea>'
      + '  <button id="dc-parseJson" style="margin-top:8px;padding:8px 16px;border:none;border-radius:8px;background:#007AFF;color:#fff;font-size:13px;cursor:pointer;font-weight:600">\uD83D\uDCCB Parsear JSON</button>'
      + '</div>'
      + '<button id="dc-save-config" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:12px">'
      + '  \uD83D\uDCBE Guardar y Conectar'
      + '</button>'
      + (saved ? '<button id="dc-clear-config" style="width:100%;padding:12px;border:1px solid #FF3B30;border-radius:12px;background:transparent;color:#FF3B30;font-size:14px;cursor:pointer;margin-bottom:16px">\uD83D\uDDD1\uFE0F Desconectar Firebase</button>' : '')
      + '<hr style="border:none;border-top:1px solid ' + border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 12px 0">\uD83D\uDD17 Sincronizaci\u00f3n</h3>'
      + '<div style="background:' + inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '  <div style="font-size:12px;color:' + (isDark ? '#a0a0a0' : '#888') + ';font-weight:600">Tu ID de sincronizaci\u00f3n</div>'
      + '  <div style="font-size:13px;font-family:monospace;word-break:break-all;margin-top:4px;color:' + text + '">' + syncId + '</div>'
      + '  <div style="display:flex;gap:8px;margin-top:8px">'
      + '    <button id="dc-copy-id" style="flex:1;padding:8px;border:1px solid ' + border + ';border-radius:8px;background:' + bg + ';color:' + text + ';font-size:12px;cursor:pointer">\uD83D\uDCCB Copiar</button>'
      + '    <button id="dc-change-id" style="flex:1;padding:8px;border:1px solid ' + border + ';border-radius:8px;background:' + bg + ';color:' + text + ';font-size:12px;cursor:pointer">\u270F\uFE0F Cambiar ID</button>'
      + '  </div>'
      + '</div>'
      + '<div style="background:' + inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '  <div style="font-size:12px;color:' + (isDark ? '#a0a0a0' : '#888') + ';font-weight:600">\u00daltima sincronizaci\u00f3n</div>'
      + '  <div style="font-size:13px;margin-top:4px;color:' + text + '">' + (lastSync !== 'Nunca' ? new Date(lastSync).toLocaleString('es-ES') : 'Nunca') + '</div>'
      + '</div>'
      + '<div style="background:' + inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '  <div style="font-size:12px;color:' + (isDark ? '#a0a0a0' : '#888') + ';font-weight:600">\uD83D\uDD12 PIN de cifrado (opcional)</div>'
      + '  <div style="display:flex;gap:8px;margin-top:8px">'
      + '    <input id="dc-pin" type="password" value="' + pin + '" placeholder="PIN num\u00e9rico..." style="flex:1;padding:10px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';color:' + text + ';font-size:14px">'
      + '    <button id="dc-save-pin" style="padding:8px 16px;border:none;border-radius:8px;background:#34C759;color:#fff;font-size:13px;cursor:pointer;font-weight:600">Guardar</button>'
      + '  </div>'
      + '  <div style="font-size:11px;color:' + (isDark ? '#a0a0a0' : '#999') + ';margin-top:6px">Si pones un PIN, los datos se cifran antes de subir a la nube. Usa el mismo PIN en todos tus dispositivos.</div>'
      + '</div>'
      + '<hr style="border:none;border-top:1px solid ' + border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 8px 0">\uD83D\uDCD6 Gu\u00eda r\u00e1pida</h3>'
      + '<ol style="font-size:13px;color:' + (isDark ? '#a0a0a0' : '#666') + ';padding-left:20px;margin:0;line-height:1.8">'
      + '  <li>Ve a <a href="https://console.firebase.google.com/" target="_blank" style="color:#007AFF">Firebase Console</a></li>'
      + '  <li>Crea un proyecto (nombre libre, desactiva Analytics)</li>'
      + '  <li>En el men\u00fa izquierdo: <b>Compilaci\u00f3n \u2192 Realtime Database</b></li>'
      + '  <li>Click <b>"Crear base de datos"</b> \u2192 Selecciona regi\u00f3n \u2192 <b>Modo de prueba</b> \u2192 Habilitar</li>'
      + '  <li>En el men\u00fa izquierdo junto a "Informaci\u00f3n del proyecto" \u2192 <b>\u2699 Configuraci\u00f3n del proyecto</b></li>'
      + '  <li>Baja hasta <b>"Tus apps"</b> \u2192 Click en icono <b>&lt;/&gt;</b> (Web)</li>'
      + '  <li>Pon un nombre (ej: "DebtControl") \u2192 <b>Registrar</b></li>'
      + '  <li>Te mostrar\u00e1 un c\u00f3digo con <code>firebaseConfig</code> \u2192 <b>Copia todo el JSON</b></li>'
      + '  <li>P\u00e9galo aqu\u00ed arriba y presiona <b>"Guardar y Conectar"</b></li>'
      + '</ol>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Event listeners
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#dc-close-setup').addEventListener('click', function() { overlay.remove(); });

    // Parsear JSON pegado
    panel.querySelector('#dc-parseJson').addEventListener('click', function() {
      var raw = panel.querySelector('#dc-jsonConfig').value.trim();
      try {
        var jsonStr = raw;
        var match = raw.match(/\{[\s\S]*?apiKey[\s\S]*?\}/);
        if (match) jsonStr = match[0];
        // Reemplazar comillas simples por dobles
        jsonStr = jsonStr.replace(/'/g, '"');
        // Solo agregar comillas a claves que NO las tengan ya
        jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
        // Limpiar trailing commas
        jsonStr = jsonStr.replace(/,\s*\}/g, '}');
        var cfg = JSON.parse(jsonStr);
        if (cfg.apiKey) panel.querySelector('#dc-apiKey').value = cfg.apiKey;
        if (cfg.authDomain) panel.querySelector('#dc-authDomain').value = cfg.authDomain;
        if (cfg.databaseURL) panel.querySelector('#dc-dbURL').value = cfg.databaseURL;
        if (cfg.projectId) panel.querySelector('#dc-projectId').value = cfg.projectId;
        if (cfg.appId) panel.querySelector('#dc-appId').value = cfg.appId;
        showToast('\u2705 Configuraci\u00f3n parseada. Revisa los campos.');
      } catch (err) {
        showToast('\u274C JSON no v\u00e1lido. Copia todo el bloque firebaseConfig.');
      }
    });

    // Guardar config
    panel.querySelector('#dc-save-config').addEventListener('click', async function() {
      var apiKey = panel.querySelector('#dc-apiKey').value.trim();
      var databaseURL = panel.querySelector('#dc-dbURL').value.trim();
      var projectId = panel.querySelector('#dc-projectId').value.trim();
      var authDomain = panel.querySelector('#dc-authDomain').value.trim();
      var appId = panel.querySelector('#dc-appId').value.trim();

      if (!apiKey || !databaseURL || !projectId) {
        showToast('\u274C API Key, Database URL y Project ID son obligatorios');
        return;
      }

      var config = { apiKey: apiKey, databaseURL: databaseURL, projectId: projectId, authDomain: authDomain, appId: appId };
      saveFirebaseConfig(config);

      firebaseReady = false;
      var btn = panel.querySelector('#dc-save-config');
      btn.textContent = '\u23F3 Conectando...';
      btn.disabled = true;

      // Limpiar instancia previa de Firebase si existe
      if (window.firebase && firebase.apps && firebase.apps.length) {
        try {
          await firebase.app().delete();
          // Esperar un momento para que se limpie
          await new Promise(function(r) { setTimeout(r, 500); });
        } catch(e) {
          console.warn('[CloudSync] No se pudo limpiar app anterior:', e);
        }
      }

      var ok = await initFirebase();

      if (ok) {
        showToast('\u2705 Firebase conectado correctamente');
        overlay.remove();
        updateFabBadge();
      } else {
        btn.textContent = '\uD83D\uDCBE Guardar y Conectar';
        btn.disabled = false;
        showToast('\u274C Error al conectar. Abre la consola (F12) para ver detalles.', 5000);
      }
    });

    // Desconectar
    var clearBtn = panel.querySelector('#dc-clear-config');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (confirm('\u00bfDesconectar Firebase? Los datos locales NO se borran.')) {
          clearFirebaseConfig();
          overlay.remove();
          updateFabBadge();
          showToast('\uD83D\uDD0C Firebase desconectado');
        }
      });
    }

    // Copiar ID
    panel.querySelector('#dc-copy-id').addEventListener('click', function() {
      var id = localStorage.getItem(LS_SYNC_ID) || '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(id).then(function() { showToast('\uD83D\uDCCB ID copiado'); });
      } else {
        prompt('Copia este ID:', id);
      }
    });

    // Cambiar ID
    panel.querySelector('#dc-change-id').addEventListener('click', function() {
      var current = localStorage.getItem(LS_SYNC_ID) || '';
      var newId = prompt('Pega el ID del otro dispositivo para vincularlos:', '');
      if (newId && newId.trim() && newId.trim() !== current) {
        localStorage.setItem(LS_SYNC_ID, newId.trim());
        syncUserId = newId.trim();
        showToast('\uD83D\uDD17 ID actualizado. Descarga los datos de la nube.');
        overlay.remove();
      }
    });

    // Guardar PIN
    panel.querySelector('#dc-save-pin').addEventListener('click', function() {
      var newPin = panel.querySelector('#dc-pin').value;
      localStorage.setItem(LS_SYNC_PIN, newPin);
      showToast(newPin ? '\uD83D\uDD12 PIN guardado' : '\uD83D\uDD13 PIN eliminado (sin cifrado)');
    });
  }

  // ============================================================
  // UI: Bot\u00f3n flotante y men\u00fa
  // ============================================================

  function updateFabBadge() {
    var fab = document.getElementById('dc-sync-fab');
    if (!fab) return;
    var dot = fab.querySelector('.dc-dot');
    if (firebaseReady) {
      if (!dot) {
        var d = document.createElement('span');
        d.className = 'dc-dot';
        Object.assign(d.style, {
          position: 'absolute', top: '2px', right: '2px', width: '12px', height: '12px',
          background: '#34C759', borderRadius: '50%', border: '2px solid #fff'
        });
        fab.appendChild(d);
      }
    } else {
      if (dot) dot.remove();
    }
  }

  function createSyncUI() {
    var style = document.createElement('style');
    style.textContent = '@keyframes dcToastIn { from { opacity:0; transform:translateX(-50%) translateY(-10px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }'
      + ' #dc-sync-fab:active { transform: scale(0.9) !important; }'
      + ' #dc-sync-menu button:active { background: rgba(0,122,255,0.1) !important; }';
    document.head.appendChild(style);

    var fab = document.createElement('button');
    fab.id = 'dc-sync-fab';
    fab.innerHTML = '\u2601\uFE0F';
    Object.assign(fab.style, {
      position: 'fixed', bottom: '100px', right: '16px', width: '52px', height: '52px',
      borderRadius: '50%', border: 'none',
      background: 'linear-gradient(135deg, #007AFF, #5856D6)',
      color: 'white', fontSize: '24px', cursor: 'pointer', zIndex: '9998',
      boxShadow: '0 4px 15px rgba(0,122,255,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'transform 0.15s'
    });
    fab.addEventListener('click', function(e) { e.stopPropagation(); toggleMenu(); });
    document.body.appendChild(fab);

    var menu = document.createElement('div');
    menu.id = 'dc-sync-menu';
    Object.assign(menu.style, {
      position: 'fixed', bottom: '160px', right: '16px',
      borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
      zIndex: '9997', display: 'none', overflow: 'hidden', minWidth: '240px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    var items = [
      { icon: '\uD83D\uDCE5', label: 'Exportar Backup (JSON)', action: exportToJSON },
      { icon: '\uD83D\uDCE4', label: 'Importar Backup (JSON)', action: importFromJSON },
      { sep: true },
      { icon: '\u2B06\uFE0F', label: 'Subir a la Nube', action: syncToCloud },
      { icon: '\u2B07\uFE0F', label: 'Descargar de la Nube', action: syncFromCloud },
      { sep: true },
      { icon: '\u2699\uFE0F', label: 'Configurar Firebase', action: showFirebaseSetup }
    ];

    items.forEach(function(item) {
      if (item.sep) {
        var s = document.createElement('div');
        s.className = 'dc-sep';
        Object.assign(s.style, { height: '1px', margin: '0' });
        menu.appendChild(s);
        return;
      }
      var btn = document.createElement('button');
      btn.innerHTML = '<span style="margin-right:10px;font-size:18px">' + item.icon + '</span>' + item.label;
      Object.assign(btn.style, {
        display: 'flex', alignItems: 'center', width: '100%', padding: '14px 16px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: '14px', fontWeight: '500', textAlign: 'left', transition: 'background 0.12s'
      });
      btn.addEventListener('click', function() { toggleMenu(); item.action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    applyMenuTheme();

    document.addEventListener('click', function(e) {
      if (!menu.contains(e.target) && e.target !== fab && !fab.contains(e.target)) {
        menu.style.display = 'none';
      }
    });

    new MutationObserver(applyMenuTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    updateFabBadge();
  }

  function applyMenuTheme() {
    var menu = document.getElementById('dc-sync-menu');
    if (!menu) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    menu.style.background = isDark ? '#16213e' : '#fff';
    menu.querySelectorAll('button').forEach(function(b) { b.style.color = isDark ? '#fff' : '#333'; });
    menu.querySelectorAll('.dc-sep').forEach(function(s) { s.style.background = isDark ? '#2d3748' : '#e9ecef'; });
  }

  function toggleMenu() {
    var m = document.getElementById('dc-sync-menu');
    if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }

  // ============================================================
  // Auto-backup local
  // ============================================================

  function setupAutoBackup() {
    setInterval(async function() {
      try {
        var data = await getAllLocalData();
        var hasData = Object.values(data).some(function(v) { return v && (Array.isArray(v) ? v.length > 0 : true); });
        if (hasData) {
          localStorage.setItem(LS_AUTO_BACKUP, JSON.stringify({ data: data, ts: new Date().toISOString() }));
        }
      } catch (e) { /* silent */ }
    }, 5 * 60 * 1000);
  }

  // ============================================================
  // Auto-sync al reconectarse
  // ============================================================

  function setupAutoSync() {
    window.addEventListener('online', async function() {
      if (firebaseReady && localStorage.getItem(LS_LAST_SYNC)) {
        await new Promise(function(r) { setTimeout(r, 3000); });
        if (navigator.onLine && firebaseReady) {
          showToast('\u2601\uFE0F Sincronizando autom\u00e1ticamente...');
          await syncToCloud();
        }
      }
    });
  }

  // ============================================================
  // Init
  // ============================================================

  async function init() {
    await new Promise(function(r) {
      if (document.readyState === 'complete') r();
      else window.addEventListener('load', r);
    });
    await new Promise(function(r) { setTimeout(r, 2000); });

    await initFirebase();
    createSyncUI();
    setupAutoBackup();
    setupAutoSync();

    console.log('[CloudSync] v' + SYNC_VERSION + ' | Firebase:', firebaseReady ? '\u2705 Conectado' : '\u274C No configurado');
  }

  init();

})();

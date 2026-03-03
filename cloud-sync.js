/**
 * DebtControl Pro - Cloud Sync Module v3.0
 * Sincronización simplificada con Firebase REST API
 *
 * - Solo necesita la URL de la base de datos (1 campo)
 * - NO requiere Firebase SDK (más rápido, más ligero)
 * - QR para compartir entre dispositivos
 * - Backup local JSON, cifrado con PIN, auto-sync
 */

(function() {
  'use strict';

  // ============================================================
  // Constantes
  // ============================================================
  var SYNC_KEYS = ['debts', 'payments', 'reminders', 'investments', 'savings', 'userStats'];
  var SYNC_VERSION = '3.0.0';
  var DB_URL_KEY = 'debtcontrol_guard_dburl';          // compartido con site-guard
  var LS_LEGACY_CONFIG = 'debtcontrol_firebase_config'; // v2.x, para migración
  var LS_SYNC_ID = 'debtcontrol_sync_id';
  var LS_LAST_SYNC = 'debtcontrol_last_sync';
  var LS_SYNC_PIN = 'debtcontrol_sync_pin';
  var LS_AUTO_BACKUP = 'debtcontrol_auto_backup';

  var dbUrl = null;
  var connected = false;
  var syncUserId = null;

  // ============================================================
  // DB URL management + migración de v2.x
  // ============================================================

  function getDbUrl() {
    // Migrar config v2.x → URL simple
    try {
      var legacy = localStorage.getItem(LS_LEGACY_CONFIG);
      if (legacy) {
        var cfg = JSON.parse(legacy);
        if (cfg && cfg.databaseURL) {
          localStorage.setItem(DB_URL_KEY, cfg.databaseURL);
          // No borramos el legacy por si site-guard lo necesita aún en caché
        }
      }
    } catch (e) {}
    return localStorage.getItem(DB_URL_KEY) || null;
  }

  function saveDbUrl(url) {
    url = url.replace(/\/+$/, '');
    localStorage.setItem(DB_URL_KEY, url);
    dbUrl = url;
  }

  // ============================================================
  // Firebase REST API
  // ============================================================

  async function restGet(path) {
    if (!dbUrl) return null;
    try {
      var resp = await fetch(dbUrl + '/' + path + '.json');
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  }

  async function restPut(path, data) {
    if (!dbUrl) return false;
    try {
      var resp = await fetch(dbUrl + '/' + path + '.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return resp.ok;
    } catch (e) { return false; }
  }

  async function restDelete(path) {
    if (!dbUrl) return false;
    try {
      var resp = await fetch(dbUrl + '/' + path + '.json', { method: 'DELETE' });
      return resp.ok;
    } catch (e) { return false; }
  }

  async function testConnection() {
    if (!dbUrl) return false;
    try {
      var resp = await fetch(dbUrl + '/_ping.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts: Date.now() })
      });
      return resp.ok;
    } catch (e) { return false; }
  }

  // ============================================================
  // Utilidades locales
  // ============================================================

  function getLocalForage() {
    return window.localforage || null;
  }

  async function getAllLocalData() {
    var lf = getLocalForage();
    var data = {};
    for (var i = 0; i < SYNC_KEYS.length; i++) {
      var key = SYNC_KEYS[i];
      try {
        if (lf) {
          data[key] = await lf.getItem(key);
        } else {
          for (var j = 0; j < localStorage.length; j++) {
            var k = localStorage.key(j);
            if (k && k.endsWith('/' + key)) {
              try { data[key] = JSON.parse(localStorage.getItem(k)); } catch(e2) {}
              break;
            }
          }
        }
      } catch (e) {}
    }
    return data;
  }

  function getSyncId() {
    syncUserId = localStorage.getItem(LS_SYNC_ID);
    if (!syncUserId) {
      syncUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem(LS_SYNC_ID, syncUserId);
    }
    return syncUserId;
  }

  // ============================================================
  // Cifrado simple con PIN
  // ============================================================

  function getSyncPin() { return localStorage.getItem(LS_SYNC_PIN) || ''; }

  function simpleEncrypt(text, pin) {
    if (!pin) return text;
    var encoded = btoa(unescape(encodeURIComponent(text)));
    var result = '';
    for (var i = 0; i < encoded.length; i++) {
      result += String.fromCharCode(encoded.charCodeAt(i) ^ pin.charCodeAt(i % pin.length));
    }
    return btoa(result);
  }

  function simpleDecrypt(text, pin) {
    if (!pin) return text;
    try {
      var decoded = atob(text);
      var result = '';
      for (var i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ pin.charCodeAt(i % pin.length));
      }
      return decodeURIComponent(escape(atob(result)));
    } catch (e) { return null; }
  }

  // ============================================================
  // Backup Local (JSON)
  // ============================================================

  async function exportToJSON() {
    try {
      var data = await getAllLocalData();
      data._exportDate = new Date().toISOString();
      data._version = SYNC_VERSION;
      data._app = 'DebtControl Pro';
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'debtcontrol-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('\u2705 Backup descargado');
    } catch (err) {
      showToast('\u274C Error al exportar');
    }
  }

  async function importFromJSON() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async function(e) {
      try {
        var file = e.target.files[0];
        if (!file) return;
        var text = await file.text();
        var data = JSON.parse(text);
        if (!data._app && !data.debts && !data.payments) { showToast('\u274C Archivo no v\u00e1lido'); return; }
        if (!confirm('\u00bfReemplazar datos actuales con el backup?\nEsta acci\u00f3n no se puede deshacer.')) return;
        var lf = getLocalForage();
        for (var i = 0; i < SYNC_KEYS.length; i++) {
          if (data[SYNC_KEYS[i]] != null && lf) await lf.setItem(SYNC_KEYS[i], data[SYNC_KEYS[i]]);
        }
        showToast('\u2705 Datos restaurados. Recargando...');
        setTimeout(function() { location.reload(); }, 1500);
      } catch (err) {
        showToast('\u274C Archivo corrupto');
      }
    };
    input.click();
  }

  // ============================================================
  // Sync con Firebase REST
  // ============================================================

  async function syncToCloud() {
    if (!connected) { showToast('\u26A0\uFE0F Configura Firebase primero (\u2601\uFE0F \u2192 \u2699\uFE0F)'); return; }
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
      var ok = await restPut('users/' + getSyncId() + '/data', payload);
      if (ok) {
        localStorage.setItem(LS_LAST_SYNC, new Date().toISOString());
        showToast('\u2705 Sincronizado con la nube');
      } else {
        showToast('\u274C Error al subir datos');
      }
    } catch (err) {
      showToast('\u274C Error: ' + (err.message || 'sin conexi\u00f3n'));
    }
  }

  async function syncFromCloud() {
    if (!connected) { showToast('\u26A0\uFE0F Configura Firebase primero (\u2601\uFE0F \u2192 \u2699\uFE0F)'); return; }
    try {
      showToast('\u2601\uFE0F Descargando datos...');
      var raw = await restGet('users/' + getSyncId() + '/data');
      if (!raw) { showToast('\u2139\uFE0F No hay datos en la nube'); return; }
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
        if (data[SYNC_KEYS[i]] != null && lf) await lf.setItem(SYNC_KEYS[i], data[SYNC_KEYS[i]]);
      }
      showToast('\u2705 Datos restaurados. Recargando...');
      setTimeout(function() { location.reload(); }, 1500);
    } catch (err) {
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
  // UI: Panel de configuración Firebase (SIMPLIFICADO)
  // ============================================================

  function showFirebaseSetup() {
    var existing = document.getElementById('dc-setup-overlay');
    if (existing) { existing.remove(); return; }

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var bg = isDark ? '#1a1a2e' : '#fff';
    var txt = isDark ? '#fff' : '#1a1a2e';
    var inputBg = isDark ? '#16213e' : '#f5f5f5';
    var border = isDark ? '#2d3748' : '#e0e0e0';
    var muted = isDark ? '#a0a0a0' : '#666';

    var overlay = document.createElement('div');
    overlay.id = 'dc-setup-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', zIndex: '99999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    var savedUrl = dbUrl || '';
    var syncId = getSyncId();
    var lastSync = localStorage.getItem(LS_LAST_SYNC) || 'Nunca';
    var pin = getSyncPin();

    var panel = document.createElement('div');
    Object.assign(panel.style, {
      background: bg, borderRadius: '20px', padding: '24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    // QR image URL (usa API pública para generar QR)
    var qrSrc = savedUrl ? 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(savedUrl) : '';

    panel.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '  <h2 style="margin:0;font-size:20px">\u2601\uFE0F Configurar Firebase</h2>'
      + '  <button id="dc-close-setup" style="background:none;border:none;font-size:24px;cursor:pointer;color:' + txt + ';padding:4px">\u2715</button>'
      + '</div>'
      // Estado
      + '<div style="background:' + (connected ? '#34C75920' : '#FF950020') + ';border-radius:12px;padding:12px;margin-bottom:16px;display:flex;align-items:center;gap:8px">'
      + '  <span style="font-size:20px">' + (connected ? '\uD83D\uDFE2' : '\uD83D\uDD34') + '</span>'
      + '  <span style="font-size:14px;font-weight:600;color:' + txt + '">' + (connected ? 'Conectado a Firebase' : 'No conectado') + '</span>'
      + '</div>'
      // URL field
      + '<div style="margin-bottom:16px">'
      + '  <label style="font-size:13px;font-weight:600;color:' + muted + '">URL de tu Realtime Database</label>'
      + '  <input id="dc-dburl" value="' + savedUrl + '" placeholder="https://tu-proyecto-default-rtdb.firebaseio.com" style="width:100%;padding:12px;border-radius:10px;border:1px solid ' + border + ';background:' + inputBg + ';color:' + txt + ';font-size:14px;box-sizing:border-box;margin-top:6px">'
      + '  <p style="font-size:11px;color:' + muted + ';margin:6px 0 0 0">Es lo \u00fanico que necesitas. Lo encuentras en Firebase Console \u2192 Realtime Database (arriba de los datos).</p>'
      + '</div>'
      + '<button id="dc-save-config" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:12px">'
      + (connected ? '\u2705 Conectado \u2014 Guardar cambios' : '\uD83D\uDD17 Conectar') + '</button>'
      + (savedUrl ? '<button id="dc-clear-config" style="width:100%;padding:10px;border:1px solid #FF3B30;border-radius:10px;background:transparent;color:#FF3B30;font-size:13px;cursor:pointer;margin-bottom:16px">\uD83D\uDDD1\uFE0F Desconectar</button>' : '')
      // QR para compartir
      + (savedUrl ? '<hr style="border:none;border-top:1px solid ' + border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 12px 0">\uD83D\uDCF1 Compartir con otro dispositivo</h3>'
      + '<p style="font-size:12px;color:' + muted + ';margin:0 0 12px 0">Escanea este QR desde el otro celular para copiar la URL, o usa el bot\u00f3n de compartir.</p>'
      + '<div style="text-align:center;margin-bottom:12px">'
      + '  <img id="dc-qr" src="' + qrSrc + '" style="width:180px;height:180px;border-radius:12px;border:1px solid ' + border + '" alt="QR">'
      + '</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:16px">'
      + '  <button id="dc-copy-url" style="flex:1;padding:10px;border:1px solid ' + border + ';border-radius:10px;background:' + bg + ';color:' + txt + ';font-size:13px;cursor:pointer;font-weight:500">\uD83D\uDCCB Copiar URL</button>'
      + '  <button id="dc-share-url" style="flex:1;padding:10px;border:1px solid ' + border + ';border-radius:10px;background:' + bg + ';color:' + txt + ';font-size:13px;cursor:pointer;font-weight:500">\uD83D\uDCE4 Compartir</button>'
      + '</div>' : '')
      // Sync info
      + '<hr style="border:none;border-top:1px solid ' + border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 12px 0">\uD83D\uDD17 Sincronizaci\u00f3n</h3>'
      + '<div style="background:' + inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '  <div style="font-size:12px;color:' + muted + ';font-weight:600">Tu ID de sincronizaci\u00f3n</div>'
      + '  <div style="font-size:12px;font-family:monospace;word-break:break-all;margin-top:4px;color:' + txt + '">' + syncId + '</div>'
      + '  <div style="display:flex;gap:8px;margin-top:8px">'
      + '    <button id="dc-copy-id" style="flex:1;padding:8px;border:1px solid ' + border + ';border-radius:8px;background:' + bg + ';color:' + txt + ';font-size:12px;cursor:pointer">\uD83D\uDCCB Copiar</button>'
      + '    <button id="dc-change-id" style="flex:1;padding:8px;border:1px solid ' + border + ';border-radius:8px;background:' + bg + ';color:' + txt + ';font-size:12px;cursor:pointer">\u270F\uFE0F Cambiar ID</button>'
      + '  </div>'
      + '</div>'
      + '<div style="background:' + inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '  <div style="font-size:12px;color:' + muted + ';font-weight:600">\u00daltima sincronizaci\u00f3n</div>'
      + '  <div style="font-size:13px;margin-top:4px;color:' + txt + '">' + (lastSync !== 'Nunca' ? new Date(lastSync).toLocaleString('es-ES') : 'Nunca') + '</div>'
      + '</div>'
      + '<div style="background:' + inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '  <div style="font-size:12px;color:' + muted + ';font-weight:600">\uD83D\uDD12 PIN de cifrado (opcional)</div>'
      + '  <div style="display:flex;gap:8px;margin-top:8px">'
      + '    <input id="dc-pin" type="password" value="' + pin + '" placeholder="PIN num\u00e9rico..." style="flex:1;padding:10px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';color:' + txt + ';font-size:14px">'
      + '    <button id="dc-save-pin" style="padding:8px 16px;border:none;border-radius:8px;background:#34C759;color:#fff;font-size:13px;cursor:pointer;font-weight:600">Guardar</button>'
      + '  </div>'
      + '  <div style="font-size:11px;color:' + muted + ';margin-top:6px">Cifra tus datos antes de subirlos. Usa el mismo PIN en todos tus dispositivos.</div>'
      + '</div>'
      // Guía simplificada
      + '<hr style="border:none;border-top:1px solid ' + border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 8px 0">\uD83D\uDCD6 \u00bfC\u00f3mo obtener la URL?</h3>'
      + '<ol style="font-size:13px;color:' + muted + ';padding-left:20px;margin:0;line-height:2">'
      + '  <li>Ve a <a href="https://console.firebase.google.com/" target="_blank" style="color:#007AFF">console.firebase.google.com</a></li>'
      + '  <li>Crea un proyecto (desactiva Analytics)</li>'
      + '  <li><b>Compilaci\u00f3n \u2192 Realtime Database \u2192 Crear base de datos</b></li>'
      + '  <li>Selecciona regi\u00f3n \u2192 <b>Modo de prueba</b> \u2192 Habilitar</li>'
      + '  <li>Copia la URL que aparece arriba (empieza con <code style="background:' + inputBg + ';padding:2px 6px;border-radius:4px;font-size:11px">https://</code>)</li>'
      + '</ol>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // -- Event listeners --
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#dc-close-setup').addEventListener('click', function() { overlay.remove(); });

    // Conectar
    panel.querySelector('#dc-save-config').addEventListener('click', async function() {
      var url = panel.querySelector('#dc-dburl').value.trim();
      if (!url || !url.startsWith('https://')) {
        showToast('\u274C La URL debe empezar con https://');
        return;
      }
      var btn = panel.querySelector('#dc-save-config');
      btn.textContent = '\u23F3 Conectando...';
      btn.disabled = true;
      saveDbUrl(url);
      var ok = await testConnection();
      if (ok) {
        connected = true;
        showToast('\u2705 Firebase conectado correctamente');
        overlay.remove();
        updateFabBadge();
      } else {
        connected = false;
        btn.textContent = '\uD83D\uDD17 Conectar';
        btn.disabled = false;
        showToast('\u274C No se pudo conectar. Verifica la URL y las reglas de la BD.', 5000);
      }
    });

    // Desconectar
    var clearBtn = panel.querySelector('#dc-clear-config');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (confirm('\u00bfDesconectar Firebase? Los datos locales NO se borran.')) {
          localStorage.removeItem(DB_URL_KEY);
          localStorage.removeItem(LS_LEGACY_CONFIG);
          dbUrl = null;
          connected = false;
          overlay.remove();
          updateFabBadge();
          showToast('\uD83D\uDD0C Desconectado');
        }
      });
    }

    // Copiar URL
    var copyUrlBtn = panel.querySelector('#dc-copy-url');
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', function() {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(savedUrl).then(function() { showToast('\uD83D\uDCCB URL copiada'); });
        } else { prompt('Copia esta URL:', savedUrl); }
      });
    }

    // Compartir URL (Web Share API en móvil)
    var shareBtn = panel.querySelector('#dc-share-url');
    if (shareBtn) {
      shareBtn.addEventListener('click', function() {
        if (navigator.share) {
          navigator.share({ title: 'DebtControl - Firebase URL', text: savedUrl }).catch(function() {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(savedUrl).then(function() { showToast('\uD83D\uDCCB URL copiada al portapapeles'); });
        } else { prompt('Comparte esta URL:', savedUrl); }
      });
    }

    // Copiar ID
    panel.querySelector('#dc-copy-id').addEventListener('click', function() {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(syncId).then(function() { showToast('\uD83D\uDCCB ID copiado'); });
      } else { prompt('Copia este ID:', syncId); }
    });

    // Cambiar ID
    panel.querySelector('#dc-change-id').addEventListener('click', function() {
      var newId = prompt('Pega el ID del otro dispositivo para vincularlos:', '');
      if (newId && newId.trim() && newId.trim() !== syncId) {
        localStorage.setItem(LS_SYNC_ID, newId.trim());
        syncUserId = newId.trim();
        showToast('\uD83D\uDD17 ID actualizado. Descarga los datos de la nube.');
        overlay.remove();
      }
    });

    // PIN
    panel.querySelector('#dc-save-pin').addEventListener('click', function() {
      var newPin = panel.querySelector('#dc-pin').value;
      localStorage.setItem(LS_SYNC_PIN, newPin);
      showToast(newPin ? '\uD83D\uDD12 PIN guardado' : '\uD83D\uDD13 PIN eliminado');
    });
  }

  // ============================================================
  // UI: Botón flotante y menú
  // ============================================================

  function updateFabBadge() {
    var fab = document.getElementById('dc-sync-fab');
    if (!fab) return;
    var dot = fab.querySelector('.dc-dot');
    if (connected) {
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
    style.textContent = '@keyframes dcToastIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}'
      + '#dc-sync-fab:active{transform:scale(0.9)!important}'
      + '#dc-sync-menu button:active{background:rgba(0,122,255,0.1)!important}';
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
      { icon: '\u2699\uFE0F', label: 'Configurar Firebase', action: showFirebaseSetup },
      { icon: '\uD83D\uDD12', label: 'Cambiar C\u00f3digo de Acceso', action: function() { if (window.DebtControlGuard) window.DebtControlGuard.changeCode(); else showToast('Guard no disponible'); } }
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
      } catch (e) {}
    }, 5 * 60 * 1000);
  }

  // ============================================================
  // Auto-sync al reconectarse
  // ============================================================

  function setupAutoSync() {
    window.addEventListener('online', async function() {
      if (connected && localStorage.getItem(LS_LAST_SYNC)) {
        await new Promise(function(r) { setTimeout(r, 3000); });
        if (navigator.onLine && connected) {
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

    // Obtener URL (con migración automática de v2.x)
    dbUrl = getDbUrl();
    if (dbUrl) {
      connected = await testConnection();
      getSyncId();
    }

    createSyncUI();
    setupAutoBackup();
    setupAutoSync();

    console.log('[CloudSync] v' + SYNC_VERSION + ' | Firebase:', connected ? '\u2705 Conectado' : '\u274C No configurado');
  }

  init();

})();

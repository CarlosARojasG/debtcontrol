/**
 * DebtControl Pro - Cloud Sync Module v7.0.0
 * Sincronización + herramientas financieras
 *
 * v7.0 cambios:
 * - Fix applyCurrencyToDOM: $ en regex replace ya no corrompe símbolos multi-carácter
 * - Fix PDF: rendimiento 0% ya no muestra como '-'
 * - Fix notificaciones: ahora avisa el mismo día del vencimiento (día 0)
 * - Fix DTI: porcentaje disponible negativo se muestra correctamente
 * - Menú con títulos de sección (Archivo, Nube, Planificación, Herramientas, Ajustes)
 * - CSV export incluye recordatorios (reminders)
 * - Historial de sync con botón Limpiar
 * - Calendario muestra recordatorios con indicador morado
 * - Calculadora amortización: botón Copiar tabla al portapapeles
 * - Calculadora Fecha Libre de Deudas (proyección + pago extra)
 * - Comparador de Préstamos (lado a lado)
 * - Desglose de deudas por Categoría (barras + porcentajes)
 * - Accesos rápidos de teclado (Ctrl+E/P/U/D/F/K)
 *
 * v6.0 cambios:
 * - Exportar a CSV para Excel/Sheets
 * - Snapshot pre-sync con opción de revertir (undo)
 * - Calculadora ratio Deuda/Ingreso (DTI)
 * - Progreso visual por deuda en resumen financiero
 * - Pantalla "Acerca de" con changelog
 * - Auto-sync configurable (on/off)
 * - PDF incluye tabla de inversiones
 * - Backup JSON incluye preferencias del usuario
 * - Cambio de moneda actualiza todo el DOM (prev→nuevo)
 * - Fix tema oscuro respeta preferencia del sistema
 * - Fix posicionamiento del menú (scrollHeight)
 * - Fix formatNumber(NaN) → muestra 0
 * - Fix escapeAttr no escapaba &
 * - testConnection usa GET en vez de PUT
 *
 * v5.0 cambios:
 * - Resumen financiero, calculadora amortización, Snowball/Avalanche
 * - Toggle tema oscuro/claro manual
 * - Autenticación biométrica (WebAuthn)
 * - Limpieza automática datos huérfanos
 * - Fix moneda multi-carácter, toast tema, notif días, auto-sync
 * - Tecla Escape cierra modales, haptic feedback
 */

(function() {
  'use strict';

  // ============================================================
  // Constantes
  // ============================================================
  var SYNC_KEYS = ['debts', 'payments', 'reminders', 'investments', 'savings', 'userStats'];
  var SYNC_VERSION = '7.0.0';
  var DB_URL_KEY = 'debtcontrol_guard_dburl';
  var LS_LEGACY_CONFIG = 'debtcontrol_firebase_config';
  var LS_SYNC_ID = 'debtcontrol_sync_id';
  var LS_LAST_SYNC = 'debtcontrol_last_sync';
  var LS_SYNC_PIN = 'debtcontrol_sync_pin';
  var LS_AUTO_BACKUP = 'debtcontrol_auto_backup';
  var LS_SYNC_HISTORY = 'debtcontrol_sync_history';
  var LS_CURRENCY = 'debtcontrol_currency';
  var LS_NOTIFICATIONS = 'debtcontrol_notifications';
  var LS_AUTO_SYNC_ENABLED = 'debtcontrol_auto_sync';
  var LS_PRE_SYNC_SNAPSHOT = 'debtcontrol_pre_sync_snapshot';

  var dbUrl = null;
  var connected = false;
  var syncUserId = null;

  // ============================================================
  // DB URL management + migración v2.x
  // ============================================================
  function getDbUrl() {
    try {
      var legacy = localStorage.getItem(LS_LEGACY_CONFIG);
      if (legacy) {
        var cfg = JSON.parse(legacy);
        if (cfg && cfg.databaseURL) {
          localStorage.setItem(DB_URL_KEY, cfg.databaseURL);
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
      var resp = await fetch(dbUrl + '/.json?shallow=true', { method: 'GET' });
      return resp.ok;
    } catch (e) { return false; }
  }

  // ============================================================
  // Utilidades locales
  // ============================================================
  function getLocalForage() { return window.localforage || null; }

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
              try { data[key] = JSON.parse(localStorage.getItem(k)); } catch (e2) {}
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
  // Moneda
  // ============================================================
  function getCurrency() { return localStorage.getItem(LS_CURRENCY) || '$'; }
  function setCurrency(sym) { localStorage.setItem(LS_CURRENCY, sym); applyCurrencyToDOM(); }

  var currencyObserver = null;
  var prevCurrencySymbol = null;
  function applyCurrencyToDOM() {
    var sym = getCurrency();
    if (sym === '$' && !prevCurrencySymbol) return; // default, no cambiar
    if (currencyObserver) currencyObserver.disconnect();

    var replacing = false;
    // Construir regex que busca el símbolo anterior O $ seguido de dígito
    var escPrev = prevCurrencySymbol ? prevCurrencySymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;

    function replaceCurrency(node) {
      if (replacing) return;
      if (node.nodeType === 3) { // text node
        var text = node.textContent;
        var replaced = text;
        // Reemplazar $ seguido de número, solo si $ no está precedido por letra
        // Usar función para evitar que $ en sym se interprete como referencia regex
        replaced = replaced.replace(/(^|[^A-Za-z])\$(\d)/g, function(_, pre, digit) { return pre + sym + digit; });
        // Si hay símbolo previo diferente, reemplazarlo también
        if (escPrev && escPrev !== '\\$' && sym !== prevCurrencySymbol) {
          var prevRegex = new RegExp(escPrev + '(\\d)', 'g');
          replaced = replaced.replace(prevRegex, function(_, digit) { return sym + digit; });
        }
        if (replaced !== text) {
          replacing = true;
          node.textContent = replaced;
          replacing = false;
        }
      } else if (node.nodeType === 1 && node.id !== 'dc-sync-menu' && node.id !== 'dc-setup-overlay') {
        node.childNodes.forEach(replaceCurrency);
      }
    }

    var root = document.getElementById('root');
    if (root) {
      replaceCurrency(root);
      currencyObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          m.addedNodes.forEach(replaceCurrency);
        });
      });
      currencyObserver.observe(root, { childList: true, subtree: true });
    }
    prevCurrencySymbol = sym;
  }

  // ============================================================
  // Modales bonitos: dcConfirm y dcPrompt (globales)
  // ============================================================
  function isDarkMode() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function getThemeColors() {
    var isDark = isDarkMode();
    return {
      isDark: isDark,
      bg: isDark ? '#1a1a2e' : '#fff',
      txt: isDark ? '#fff' : '#1a1a2e',
      inputBg: isDark ? '#16213e' : '#f5f5f5',
      border: isDark ? '#2d3748' : '#e0e0e0',
      muted: isDark ? '#a0a0a0' : '#666'
    };
  }

  function createModalOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'dc-modal-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: '999998', padding: '16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      animation: 'dcFadeIn 0.2s ease'
    });
    return overlay;
  }

  window.dcConfirm = function(message, options) {
    options = options || {};
    return new Promise(function(resolve) {
      var t = getThemeColors();
      var overlay = createModalOverlay();

      var card = document.createElement('div');
      Object.assign(card.style, {
        background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
        width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center'
      });

      var icon = options.icon || '\u2753';
      var confirmText = options.confirmText || 'Confirmar';
      var cancelText = options.cancelText || 'Cancelar';
      var danger = options.danger || false;

      card.innerHTML = ''
        + '<div style="font-size:48px;margin-bottom:12px">' + icon + '</div>'
        + '<p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;white-space:pre-line">' + escapeHtml(message) + '</p>'
        + '<div style="display:flex;gap:10px">'
        + '  <button id="dc-modal-cancel" style="flex:1;padding:14px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:15px;font-weight:500;cursor:pointer">' + cancelText + '</button>'
        + '  <button id="dc-modal-ok" style="flex:1;padding:14px;border:none;border-radius:12px;background:' + (danger ? '#FF3B30' : 'linear-gradient(135deg,#007AFF,#5856D6)') + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer">' + confirmText + '</button>'
        + '</div>';

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      function close(result) { overlay.remove(); resolve(result); }
      card.querySelector('#dc-modal-ok').addEventListener('click', function() { close(true); });
      card.querySelector('#dc-modal-cancel').addEventListener('click', function() { close(false); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
    });
  };

  window.dcPrompt = function(message, options) {
    options = options || {};
    return new Promise(function(resolve) {
      var t = getThemeColors();
      var overlay = createModalOverlay();

      var card = document.createElement('div');
      Object.assign(card.style, {
        background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
        width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center'
      });

      var icon = options.icon || '\u270F\uFE0F';
      var placeholder = options.placeholder || '';
      var defaultValue = options.defaultValue || '';
      var inputType = options.inputType || 'text';

      card.innerHTML = ''
        + '<div style="font-size:48px;margin-bottom:12px">' + icon + '</div>'
        + '<p style="margin:0 0 16px 0;font-size:15px;line-height:1.5">' + escapeHtml(message) + '</p>'
        + '<input id="dc-modal-input" type="' + inputType + '" placeholder="' + escapeAttr(placeholder) + '" value="' + escapeAttr(defaultValue) + '" style="width:100%;padding:14px;border-radius:12px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:15px;box-sizing:border-box;outline:none;text-align:center">'
        + '<div style="display:flex;gap:10px;margin-top:16px">'
        + '  <button id="dc-modal-cancel" style="flex:1;padding:14px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:15px;font-weight:500;cursor:pointer">Cancelar</button>'
        + '  <button id="dc-modal-ok" style="flex:1;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer">Aceptar</button>'
        + '</div>';

      overlay.appendChild(card);
      document.body.appendChild(overlay);
      card.querySelector('#dc-modal-input').focus();

      function close(val) { overlay.remove(); resolve(val); }
      card.querySelector('#dc-modal-ok').addEventListener('click', function() {
        close(card.querySelector('#dc-modal-input').value);
      });
      card.querySelector('#dc-modal-cancel').addEventListener('click', function() { close(null); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });
      card.querySelector('#dc-modal-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') close(card.querySelector('#dc-modal-input').value);
      });
    });
  };

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      data._currency = getCurrency();
      data._preferences = {
        theme: localStorage.getItem('debtcontrol_theme') || '',
        currency: getCurrency(),
        notifications: localStorage.getItem(LS_NOTIFICATIONS) || '',
        sessionDuration: localStorage.getItem('debtcontrol_session_duration') || '24',
        autoSync: localStorage.getItem(LS_AUTO_SYNC_ENABLED) !== 'false'
      };
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
        var ok = await dcConfirm('\u00bfReemplazar datos actuales con el backup?\nEsta acci\u00f3n no se puede deshacer.', { icon: '\u26A0\uFE0F', confirmText: 'Restaurar', danger: true });
        if (!ok) return;
        var lf = getLocalForage();
        for (var i = 0; i < SYNC_KEYS.length; i++) {
          if (data[SYNC_KEYS[i]] != null && lf) await lf.setItem(SYNC_KEYS[i], data[SYNC_KEYS[i]]);
        }
        // Restaurar preferencias si existen
        if (data._preferences) {
          if (data._preferences.theme) localStorage.setItem('debtcontrol_theme', data._preferences.theme);
          if (data._preferences.currency) localStorage.setItem(LS_CURRENCY, data._preferences.currency);
          if (data._preferences.notifications) localStorage.setItem(LS_NOTIFICATIONS, data._preferences.notifications);
          if (data._preferences.sessionDuration) localStorage.setItem('debtcontrol_session_duration', data._preferences.sessionDuration);
        } else if (data._currency) {
          localStorage.setItem(LS_CURRENCY, data._currency);
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
  // CSV Export
  // ============================================================
  async function exportToCSV() {
    try {
      var data = await getAllLocalData();
      var currency = getCurrency();
      var lines = [];

      // Deudas
      var debts = data.debts || [];
      if (debts.length > 0) {
        lines.push('=== DEUDAS ===');
        lines.push('Nombre,Monto,Categor\u00eda,Tasa Inter\u00e9s,Cuota Mensual,Vencimiento');
        debts.forEach(function(d) {
          lines.push([
            '"' + (d.name || d.nombre || '').replace(/"/g, '""') + '"',
            parseFloat(d.amount || d.totalAmount || d.monto || 0),
            '"' + (d.category || d.categoria || '').replace(/"/g, '""') + '"',
            parseFloat(d.interestRate || d.tasaInteres || 0),
            parseFloat(d.monthlyPayment || d.cuota || 0),
            d.dueDate || d.fechaVencimiento || ''
          ].join(','));
        });
        lines.push('');
      }

      // Pagos
      var payments = data.payments || [];
      if (payments.length > 0) {
        lines.push('=== PAGOS ===');
        lines.push('Fecha,Monto,Deuda');
        payments.forEach(function(p) {
          lines.push([
            p.date || p.fecha || '',
            parseFloat(p.amount || p.monto || 0),
            '"' + (p.debtName || p.deudaNombre || p.debtId || '').replace(/"/g, '""') + '"'
          ].join(','));
        });
        lines.push('');
      }

      // Ahorros
      var savings = data.savings || [];
      if (savings.length > 0) {
        lines.push('=== AHORROS ===');
        lines.push('Nombre,Balance,Tipo');
        savings.forEach(function(s) {
          lines.push([
            '"' + (s.name || s.nombre || '').replace(/"/g, '""') + '"',
            parseFloat(s.balance || s.saldo || 0),
            '"' + (s.type || s.tipo || '').replace(/"/g, '""') + '"'
          ].join(','));
        });
        lines.push('');
      }

      // Inversiones
      var investments = data.investments || [];
      if (investments.length > 0) {
        lines.push('=== INVERSIONES ===');
        lines.push('Nombre,Monto,Tipo,Rendimiento');
        investments.forEach(function(inv) {
          lines.push([
            '"' + (inv.name || inv.nombre || '').replace(/"/g, '""') + '"',
            parseFloat(inv.amount || inv.monto || 0),
            '"' + (inv.type || inv.tipo || '').replace(/"/g, '""') + '"',
            parseFloat(inv.returnRate || inv.rendimiento || 0)
          ].join(','));
        });
        lines.push('');
      }

      // Recordatorios
      var reminders = data.reminders || [];
      if (reminders.length > 0) {
        lines.push('=== RECORDATORIOS ===');
        lines.push('T\u00edtulo,Fecha,Descripci\u00f3n,Recurrente');
        reminders.forEach(function(r) {
          lines.push([
            '"' + (r.title || r.titulo || '').replace(/"/g, '""') + '"',
            r.date || r.fecha || '',
            '"' + (r.description || r.descripcion || '').replace(/"/g, '""') + '"',
            r.recurring || r.recurrente || 'no'
          ].join(','));
        });
      }

      var bom = '\uFEFF'; // BOM para Excel
      var blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'debtcontrol-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('\u2705 CSV exportado');
    } catch (err) {
      showToast('\u274C Error al exportar CSV');
    }
  }

  // ============================================================
  // Snapshot pre-sync (undo)
  // ============================================================
  async function savePreSyncSnapshot() {
    try {
      var data = await getAllLocalData();
      var json = JSON.stringify({ data: data, ts: new Date().toISOString() });
      if (json.length < 2 * 1024 * 1024) {
        localStorage.setItem(LS_PRE_SYNC_SNAPSHOT, json);
      }
    } catch (e) {}
  }

  async function restorePreSyncSnapshot() {
    try {
      var raw = localStorage.getItem(LS_PRE_SYNC_SNAPSHOT);
      if (!raw) { showToast('\u2139\uFE0F No hay snapshot disponible'); return; }
      var snapshot = JSON.parse(raw);
      var ts = snapshot.ts ? new Date(snapshot.ts).toLocaleString('es-ES') : 'desconocida';
      var ok = await dcConfirm('\u00bfRevertir al estado anterior a la \u00faltima sincronizaci\u00f3n?\nSnapshot de: ' + ts + '\nEsto reemplazar\u00e1 tus datos actuales.', { icon: '\u23EA', confirmText: 'Revertir', danger: true });
      if (!ok) return;
      var lf = getLocalForage();
      var data = snapshot.data;
      for (var i = 0; i < SYNC_KEYS.length; i++) {
        if (data[SYNC_KEYS[i]] != null && lf) await lf.setItem(SYNC_KEYS[i], data[SYNC_KEYS[i]]);
      }
      showToast('\u2705 Datos revertidos. Recargando...');
      setTimeout(function() { location.reload(); }, 1500);
    } catch (e) {
      showToast('\u274C Error al restaurar snapshot');
    }
  }

  // ============================================================
  // Pantalla Acerca de
  // ============================================================
  function showAbout() {
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '400px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center'
    });

    card.innerHTML = ''
      + '<div style="font-size:56px;margin-bottom:8px">\uD83D\uDCB0</div>'
      + '<h2 style="margin:0 0 4px 0;font-size:22px;font-weight:700">DebtControl Pro</h2>'
      + '<div style="font-size:13px;color:' + t.muted + ';margin-bottom:16px">v' + SYNC_VERSION + '</div>'
      + '<div style="background:linear-gradient(135deg,#007AFF,#5856D6);border-radius:12px;padding:16px;color:#fff;margin-bottom:16px;text-align:left">'
      + '<div style="font-size:14px;font-weight:600;margin-bottom:8px">\u2728 Caracter\u00edsticas</div>'
      + '<div style="font-size:12px;line-height:1.8;opacity:0.9">'
      + '\u2022 Gesti\u00f3n completa de deudas y finanzas<br>'
      + '\u2022 Sincronizaci\u00f3n en la nube (Firebase)<br>'
      + '\u2022 Exportar PDF, JSON y CSV<br>'
      + '\u2022 Calculadora de amortizaci\u00f3n<br>'
      + '\u2022 Estrategia Snowball vs Avalanche<br>'
      + '\u2022 Ratio Deuda/Ingreso (DTI)<br>'
      + '\u2022 Fecha Libre de Deudas + Comparador de Pr\u00e9stamos<br>'
      + '\u2022 Desglose por Categor\u00eda<br>'
      + '\u2022 Convenio de Pago (liquidaci\u00f3n / plan de pagos)<br>'
      + '\u2022 Calendario y notificaciones<br>'
      + '\u2022 Seguridad: c\u00f3digo + biometr\u00eda<br>'
      + '\u2022 Accesos r\u00e1pidos de teclado (Ctrl+E/P/U/D/F/K)<br>'
      + '\u2022 Funciona offline (PWA)</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px;margin-bottom:16px;text-align:left">'
      + '<div style="font-size:13px;font-weight:600;margin-bottom:8px">\uD83D\uDCDD Changelog v' + SYNC_VERSION + '</div>'
      + '<div style="font-size:12px;color:' + t.muted + ';line-height:1.8">'
      + '\u2022 Calculadora Fecha Libre de Deudas<br>'
      + '\u2022 Comparador de Pr\u00e9stamos lado a lado<br>'
      + '\u2022 Desglose de deudas por Categor\u00eda<br>'
      + '\u2022 Accesos r\u00e1pidos de teclado<br>'
      + '\u2022 Men\u00fa con t\u00edtulos de secci\u00f3n<br>'
      + '\u2022 CSV incluye recordatorios<br>'
      + '\u2022 Calendario muestra recordatorios<br>'
      + '\u2022 Limpiar historial de sync<br>'
      + '\u2022 Copiar tabla de amortizaci\u00f3n<br>'
      + '\u2022 Fix moneda $ en reemplazos DOM<br>'
      + '\u2022 Fix notificaci\u00f3n d\u00eda del vencimiento<br>'
      + '\u2022 Fix DTI disponible negativo</div></div>'
      + '<div style="font-size:11px;color:' + t.muted + ';margin-bottom:16px">'
      + 'Desarrollado con \u2764\uFE0F<br>'
      + 'React 19 \u2022 Vite \u2022 PWA \u2022 Firebase REST</div>'
      + '<button class="dc-about-close" style="width:100%;padding:14px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:15px;cursor:pointer">Cerrar</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-about-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // Calculadora DTI (Debt-to-Income Ratio)
  // ============================================================
  async function showDTICalculator() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var debts = data.debts || [];
    var totalMonthlyDebt = debts.reduce(function(s, d) {
      return s + parseFloat(d.monthlyPayment || d.cuota || d.minimumPayment || 0);
    }, 0);

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '400px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;box-sizing:border-box;margin-top:6px;outline:none;';
    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDCC9 Ratio Deuda/Ingreso</h2>'
      + '<button class="dc-dti-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-bottom:16px;font-size:12px;color:' + t.muted + ';line-height:1.6">'
      + 'El <b>DTI</b> (Debt-to-Income) mide qu\u00e9 porcentaje de tus ingresos se destina a deudas. Menor es mejor.'
      + '<div style="margin-top:8px">\uD83D\uDFE2 &lt;36% Saludable \u2022 \uD83D\uDFE1 36-50% Precauci\u00f3n \u2022 \uD83D\uDD34 &gt;50% Cr\u00edtico</div></div>'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Pagos mensuales de deudas (' + currency + ')</label>'
      + '<input class="dc-dti-debt" type="number" value="' + totalMonthlyDebt.toFixed(2) + '" style="' + iSt + '">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + ';display:block;margin-top:12px">Ingreso mensual bruto (' + currency + ')</label>'
      + '<input class="dc-dti-income" type="number" placeholder="Ej: 30000" style="' + iSt + '">'
      + '<button class="dc-dti-calc" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px">\uD83D\uDCC9 Calcular DTI</button>'
      + '<div class="dc-dti-result" style="margin-top:16px"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-dti-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    card.querySelector('.dc-dti-calc').addEventListener('click', function() {
      var debtAmt = parseFloat(card.querySelector('.dc-dti-debt').value) || 0;
      var income = parseFloat(card.querySelector('.dc-dti-income').value) || 0;
      if (income <= 0) { showToast('\u26A0\uFE0F Ingresa tu ingreso mensual'); return; }

      var dti = (debtAmt / income) * 100;
      var color, label, icon, advice;
      if (dti < 20) {
        color = '#34C759'; label = 'Excelente'; icon = '\uD83C\uDF1F';
        advice = 'Tu DTI es muy bajo. Tienes buena flexibilidad financiera.';
      } else if (dti < 36) {
        color = '#34C759'; label = 'Saludable'; icon = '\uD83D\uDFE2';
        advice = 'Est\u00e1s en buen rango. La mayor\u00eda de prestamistas te considerar\u00edan buen candidato.';
      } else if (dti < 50) {
        color = '#FF9500'; label = 'Precauci\u00f3n'; icon = '\uD83D\uDFE1';
        advice = 'Tu DTI es algo alto. Considera reducir deudas antes de tomar nuevos pr\u00e9stamos.';
      } else {
        color = '#FF3B30'; label = 'Cr\u00edtico'; icon = '\uD83D\uDD34';
        advice = 'Tu DTI es alto. Prioriza pagar deudas y evita nuevas obligaciones.';
      }

      var barWidth = Math.min(dti, 100);
      var html = ''
        + '<div style="background:' + t.inputBg + ';border-radius:16px;padding:20px;text-align:center">'
        + '<div style="font-size:40px;margin-bottom:4px">' + icon + '</div>'
        + '<div style="font-size:36px;font-weight:700;color:' + color + '">' + dti.toFixed(1) + '%</div>'
        + '<div style="font-size:14px;font-weight:600;color:' + color + ';margin-bottom:12px">' + label + '</div>'
        + '<div style="background:' + t.border + ';border-radius:6px;height:12px;overflow:hidden;margin-bottom:12px">'
        + '<div style="width:' + barWidth + '%;height:100%;background:' + color + ';border-radius:6px;transition:width 0.5s"></div></div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'
        + '<div><div style="font-size:11px;color:' + t.muted + '">Deuda mensual</div><div style="font-size:16px;font-weight:600">' + currency + formatNumber(debtAmt) + '</div></div>'
        + '<div><div style="font-size:11px;color:' + t.muted + '">Ingreso mensual</div><div style="font-size:16px;font-weight:600">' + currency + formatNumber(income) + '</div></div>'
        + '<div><div style="font-size:11px;color:' + t.muted + '">Disponible</div><div style="font-size:16px;font-weight:600;color:' + (income - debtAmt >= 0 ? '#34C759' : '#FF3B30') + '">' + (income - debtAmt < 0 ? '-' : '') + currency + formatNumber(Math.abs(income - debtAmt)) + '</div></div>'
        + '<div><div style="font-size:11px;color:' + t.muted + '">% Disponible</div><div style="font-size:16px;font-weight:600;color:' + (dti <= 100 ? '#34C759' : '#FF3B30') + '">' + Math.max(0, 100 - dti).toFixed(1) + '%' + (dti > 100 ? ' \u26A0\uFE0F' : '') + '</div></div></div>'
        + '<div style="font-size:12px;color:' + t.muted + ';line-height:1.5;text-align:left;background:' + t.bg + ';border-radius:8px;padding:10px">\uD83D\uDCA1 ' + advice + '</div></div>';

      card.querySelector('.dc-dti-result').innerHTML = html;
    });
  }

  // ============================================================
  // Calculadora: Fecha Libre de Deudas
  // ============================================================
  async function showDebtFreeDate() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var debts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    });
    var payments = data.payments || [];

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    if (debts.length === 0) {
      card.innerHTML = '<div style="text-align:center;padding:20px">'
        + '<div style="font-size:48px;margin-bottom:12px">\uD83C\uDF89</div>'
        + '<h2 style="margin:0 0 8px 0;font-size:18px">\u00a1Sin deudas!</h2>'
        + '<p style="color:' + t.muted + ';font-size:14px">No tienes deudas activas. \u00a1Felicidades!</p>'
        + '<button class="dc-df-close" style="padding:12px 24px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:12px">Cerrar</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      card.querySelector('.dc-df-close').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      return;
    }

    var totalDebt = debts.reduce(function(s, d) { return s + parseFloat(d.amount || d.totalAmount || d.monto || 0); }, 0);
    var totalMonthlyPay = debts.reduce(function(s, d) {
      return s + parseFloat(d.monthlyPayment || d.cuota || d.minimumPayment || 0);
    }, 0);

    // Calcular pagos mensuales promedio de los últimos 6 meses
    var now = new Date();
    var sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    var recentPayments = payments.filter(function(p) {
      var d = new Date(p.date || p.fecha || '');
      return d >= sixMonthsAgo;
    });
    var avgMonthlyPayment = recentPayments.length > 0
      ? recentPayments.reduce(function(s, p) { return s + parseFloat(p.amount || p.monto || 0); }, 0) / 6
      : totalMonthlyPay;

    var iSt = 'width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;box-sizing:border-box;margin-top:6px;outline:none;';

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83C\uDFC1 Fecha Libre de Deudas</h2>'
      + '<button class="dc-df-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px;margin-bottom:16px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '<div><div style="font-size:11px;color:' + t.muted + '">Deuda total</div><div style="font-size:16px;font-weight:700;color:#FF3B30">' + currency + formatNumber(totalDebt) + '</div></div>'
      + '<div><div style="font-size:11px;color:' + t.muted + '">Pago promedio/mes</div><div style="font-size:16px;font-weight:700;color:#007AFF">' + currency + formatNumber(avgMonthlyPayment) + '</div></div>'
      + '</div></div>'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Pago mensual estimado (' + currency + ')</label>'
      + '<input class="dc-df-monthly" type="number" value="' + Math.round(avgMonthlyPayment) + '" style="' + iSt + '">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + ';display:block;margin-top:12px">Pago extra mensual (' + currency + ')</label>'
      + '<input class="dc-df-extra" type="number" value="0" placeholder="0" style="' + iSt + '">'
      + '<button class="dc-df-calc" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px">\uD83C\uDFC1 Calcular Fecha</button>'
      + '<div class="dc-df-result" style="margin-top:16px"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-df-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    card.querySelector('.dc-df-calc').addEventListener('click', function() {
      var monthly = parseFloat(card.querySelector('.dc-df-monthly').value) || 0;
      var extra = parseFloat(card.querySelector('.dc-df-extra').value) || 0;
      var totalPay = monthly + extra;
      if (totalPay <= 0) { showToast('\u26A0\uFE0F Ingresa un pago mensual'); return; }

      // Simulación simplificada (promedio de tasas)
      var avgRate = debts.reduce(function(s, d) { return s + parseFloat(d.interestRate || d.tasaInteres || 0); }, 0) / debts.length;
      var monthlyRate = avgRate / 100 / 12;
      var balance = totalDebt;
      var months = 0;
      var totalInterest = 0;

      while (balance > 0.01 && months < 600) {
        months++;
        var interest = balance * monthlyRate;
        totalInterest += interest;
        balance += interest;
        var pay = Math.min(totalPay, balance);
        balance -= pay;
      }

      if (months >= 600) {
        card.querySelector('.dc-df-result').innerHTML = '<div style="background:#FF3B3020;border-radius:12px;padding:16px;text-align:center">'
          + '<div style="font-size:40px;margin-bottom:8px">\u26A0\uFE0F</div>'
          + '<div style="font-size:14px;font-weight:600;color:#FF3B30">Con ese pago nunca liquidar\u00e1s la deuda</div>'
          + '<div style="font-size:12px;color:' + t.muted + ';margin-top:4px">Necesitas pagar m\u00e1s que los intereses generados.</div></div>';
        return;
      }

      var freeDate = new Date();
      freeDate.setMonth(freeDate.getMonth() + months);
      var years = Math.floor(months / 12);
      var remainMonths = months % 12;
      var timeStr = (years > 0 ? years + ' a\u00f1o' + (years !== 1 ? 's' : '') + ' ' : '') + remainMonths + ' mes' + (remainMonths !== 1 ? 'es' : '');

      // Comparación con y sin extra
      var monthsNoExtra = 0;
      if (extra > 0) {
        var bal2 = totalDebt;
        while (bal2 > 0.01 && monthsNoExtra < 600) {
          monthsNoExtra++;
          bal2 += bal2 * monthlyRate;
          bal2 -= Math.min(monthly, bal2);
        }
      }

      var resultHtml = '<div style="background:linear-gradient(135deg,#34C759,#30D158);border-radius:16px;padding:20px;text-align:center;color:#fff">'
        + '<div style="font-size:40px;margin-bottom:4px">\uD83C\uDFC1</div>'
        + '<div style="font-size:14px;opacity:0.9">Libre de deudas el</div>'
        + '<div style="font-size:24px;font-weight:700;margin:4px 0">' + freeDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) + '</div>'
        + '<div style="font-size:13px;opacity:0.85">' + timeStr + ' (' + months + ' meses)</div>'
        + '<div style="font-size:12px;opacity:0.7;margin-top:8px">Inter\u00e9s total estimado: ' + currency + formatNumber(totalInterest) + '</div>'
        + '</div>';

      if (extra > 0 && monthsNoExtra > months && monthsNoExtra < 600) {
        var saved = monthsNoExtra - months;
        resultHtml += '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-top:10px;text-align:center">'
          + '<div style="font-size:12px;color:' + t.muted + '">\uD83D\uDCA1 El pago extra de ' + currency + formatNumber(extra) + '/mes te ahorra</div>'
          + '<div style="font-size:18px;font-weight:700;color:#34C759;margin-top:4px">' + saved + ' mes' + (saved !== 1 ? 'es' : '') + '</div></div>';
      }

      card.querySelector('.dc-df-result').innerHTML = resultHtml;
    });
  }

  // ============================================================
  // Comparador de Préstamos
  // ============================================================
  function showLoanComparator() {
    var t = getThemeColors();
    var currency = getCurrency();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '440px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:10px;border-radius:8px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:13px;box-sizing:border-box;margin-top:4px;outline:none;';

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDD0D Comparar Pr\u00e9stamos</h2>'
      + '<button class="dc-lc-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px">'
      + '<div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:8px;color:#007AFF">Opci\u00f3n A</div>'
      + '<label style="font-size:11px;color:' + t.muted + '">Monto (' + currency + ')</label>'
      + '<input class="dc-lc-a-amount" type="number" placeholder="10000" style="' + iSt + '">'
      + '<label style="font-size:11px;color:' + t.muted + '">Tasa anual (%)</label>'
      + '<input class="dc-lc-a-rate" type="number" placeholder="12" step="0.1" style="' + iSt + '">'
      + '<label style="font-size:11px;color:' + t.muted + '">Plazo (meses)</label>'
      + '<input class="dc-lc-a-term" type="number" placeholder="24" style="' + iSt + '">'
      + '</div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px">'
      + '<div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:8px;color:#5856D6">Opci\u00f3n B</div>'
      + '<label style="font-size:11px;color:' + t.muted + '">Monto (' + currency + ')</label>'
      + '<input class="dc-lc-b-amount" type="number" placeholder="10000" style="' + iSt + '">'
      + '<label style="font-size:11px;color:' + t.muted + '">Tasa anual (%)</label>'
      + '<input class="dc-lc-b-rate" type="number" placeholder="15" step="0.1" style="' + iSt + '">'
      + '<label style="font-size:11px;color:' + t.muted + '">Plazo (meses)</label>'
      + '<input class="dc-lc-b-term" type="number" placeholder="36" style="' + iSt + '">'
      + '</div></div>'
      + '<button class="dc-lc-calc" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px">\uD83D\uDD0D Comparar</button>'
      + '<div class="dc-lc-result" style="margin-top:16px"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-lc-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    card.querySelector('.dc-lc-calc').addEventListener('click', function() {
      function calc(amount, rate, term) {
        if (!amount || !rate || !term || amount <= 0 || rate <= 0 || term <= 0) return null;
        var mr = rate / 100 / 12;
        var payment = amount * (mr * Math.pow(1 + mr, term)) / (Math.pow(1 + mr, term) - 1);
        var totalPaid = payment * term;
        return { payment: payment, totalPaid: totalPaid, totalInterest: totalPaid - amount, amount: amount, rate: rate, term: term };
      }

      var a = calc(
        parseFloat(card.querySelector('.dc-lc-a-amount').value),
        parseFloat(card.querySelector('.dc-lc-a-rate').value),
        parseInt(card.querySelector('.dc-lc-a-term').value)
      );
      var b = calc(
        parseFloat(card.querySelector('.dc-lc-b-amount').value),
        parseFloat(card.querySelector('.dc-lc-b-rate').value),
        parseInt(card.querySelector('.dc-lc-b-term').value)
      );

      if (!a || !b) { showToast('\u26A0\uFE0F Completa todos los campos de ambas opciones'); return; }

      var winnerInterest = a.totalInterest <= b.totalInterest ? 'A' : 'B';
      var winnerPayment = a.payment <= b.payment ? 'A' : 'B';

      function optionCard(opt, label, color, isWinner) {
        return '<div style="background:' + (isWinner ? color + '15' : t.inputBg) + ';border:2px solid ' + (isWinner ? color : 'transparent') + ';border-radius:12px;padding:14px;text-align:center">'
          + '<div style="font-size:14px;font-weight:700;color:' + color + ';margin-bottom:8px">' + label + (isWinner ? ' \uD83C\uDFC6' : '') + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + '">Cuota mensual</div>'
          + '<div style="font-size:18px;font-weight:700">' + currency + formatNumber(opt.payment) + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + ';margin-top:6px">Total a pagar</div>'
          + '<div style="font-size:15px;font-weight:600">' + currency + formatNumber(opt.totalPaid) + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + ';margin-top:6px">Total intereses</div>'
          + '<div style="font-size:15px;font-weight:600;color:#FF3B30">' + currency + formatNumber(opt.totalInterest) + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + ';margin-top:6px">' + opt.rate + '% \u2022 ' + opt.term + ' meses</div></div>';
      }

      var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'
        + optionCard(a, 'Opci\u00f3n A', '#007AFF', winnerInterest === 'A')
        + optionCard(b, 'Opci\u00f3n B', '#5856D6', winnerInterest === 'B')
        + '</div>';

      var diff = Math.abs(a.totalInterest - b.totalInterest);
      if (diff > 0.01) {
        html += '<div style="background:#34C75920;border-radius:12px;padding:12px;text-align:center">'
          + '<div style="font-size:13px;font-weight:600">\uD83D\uDCA1 Opci\u00f3n ' + winnerInterest + ' te ahorra en intereses</div>'
          + '<div style="font-size:20px;font-weight:700;color:#34C759;margin:4px 0">' + currency + formatNumber(diff) + '</div>';
        if (winnerPayment !== winnerInterest) {
          html += '<div style="font-size:11px;color:' + t.muted + '">Pero Opci\u00f3n ' + winnerPayment + ' tiene cuota m\u00e1s baja (' + currency + formatNumber(winnerPayment === 'A' ? a.payment : b.payment) + '/mes)</div>';
        }
        html += '</div>';
      }

      card.querySelector('.dc-lc-result').innerHTML = html;
    });
  }

  // ============================================================
  // Resumen por Categoría
  // ============================================================
  async function showCategoryBreakdown() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var debts = data.debts || [];

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    if (debts.length === 0) {
      card.innerHTML = '<div style="text-align:center;padding:20px">'
        + '<div style="font-size:48px;margin-bottom:12px">\uD83D\uDCCA</div>'
        + '<h2 style="margin:0 0 8px 0;font-size:18px">Desglose por Categor\u00eda</h2>'
        + '<p style="color:' + t.muted + ';font-size:14px">No hay deudas para analizar.</p>'
        + '<button class="dc-cat-close" style="padding:12px 24px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:12px">Cerrar</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      card.querySelector('.dc-cat-close').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      return;
    }

    // Agrupar por categoría
    var categories = {};
    var totalDebt = 0;
    debts.forEach(function(d) {
      var cat = d.category || d.categoria || 'Sin categor\u00eda';
      var amount = parseFloat(d.amount || d.totalAmount || d.monto || 0);
      totalDebt += amount;
      if (!categories[cat]) categories[cat] = { total: 0, count: 0, debts: [] };
      categories[cat].total += amount;
      categories[cat].count++;
      categories[cat].debts.push({ name: d.name || d.nombre || 'Deuda', amount: amount });
    });

    // Ordenar por total descendiente
    var sorted = Object.keys(categories).sort(function(a, b) { return categories[b].total - categories[a].total; });

    var colors = ['#007AFF', '#FF3B30', '#FF9500', '#34C759', '#5856D6', '#AF52DE', '#FF2D55', '#5AC8FA'];

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDCCA Desglose por Categor\u00eda</h2>'
      + '<button class="dc-cat-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>';

    // Barra total
    html += '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px;margin-bottom:16px;text-align:center">'
      + '<div style="font-size:11px;color:' + t.muted + '">Deuda Total</div>'
      + '<div style="font-size:24px;font-weight:700;color:#FF3B30">' + currency + formatNumber(totalDebt) + '</div>'
      + '<div style="font-size:11px;color:' + t.muted + '">' + debts.length + ' deuda' + (debts.length !== 1 ? 's' : '') + ' en ' + sorted.length + ' categor\u00eda' + (sorted.length !== 1 ? 's' : '') + '</div></div>';

    // Barra de composición horizontal
    html += '<div style="display:flex;border-radius:8px;overflow:hidden;height:24px;margin-bottom:16px">';
    sorted.forEach(function(cat, idx) {
      var pct = (categories[cat].total / totalDebt) * 100;
      var color = colors[idx % colors.length];
      html += '<div title="' + escapeAttr(cat) + ': ' + pct.toFixed(1) + '%" style="width:' + pct + '%;background:' + color + ';min-width:2px"></div>';
    });
    html += '</div>';

    // Detalle por categoría
    sorted.forEach(function(cat, idx) {
      var info = categories[cat];
      var pct = (info.total / totalDebt) * 100;
      var color = colors[idx % colors.length];
      html += '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-bottom:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + '<div style="width:12px;height:12px;border-radius:3px;background:' + color + '"></div>'
        + '<span style="font-size:14px;font-weight:600">' + escapeHtml(cat) + '</span>'
        + '<span style="font-size:11px;color:' + t.muted + '">(' + info.count + ')</span></div>'
        + '<div style="text-align:right"><div style="font-size:14px;font-weight:700">' + currency + formatNumber(info.total) + '</div>'
        + '<div style="font-size:11px;color:' + t.muted + '">' + pct.toFixed(1) + '%</div></div></div>'
        + '<div style="background:' + t.border + ';border-radius:4px;height:6px;overflow:hidden">'
        + '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:4px"></div></div>';
      // Listar deudas individuales
      info.debts.forEach(function(d) {
        html += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;padding:0 4px;color:' + t.muted + '">'
          + '<span>' + escapeHtml(d.name) + '</span>'
          + '<span>' + currency + formatNumber(d.amount) + '</span></div>';
      });
      html += '</div>';
    });

    html += '<button class="dc-cat-close2" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:8px">Cerrar</button>';

    card.innerHTML = html;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-cat-close').addEventListener('click', function() { overlay.remove(); });
    card.querySelector('.dc-cat-close2').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // Convenio de Pago
  // ============================================================
  async function showPaymentAgreement() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var debts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    });

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '460px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:10px;border-radius:8px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:13px;box-sizing:border-box;margin-top:4px;outline:none;';
    var selSt = iSt + 'appearance:auto;';

    // Generar opciones del select de deudas
    var debtOptions = '<option value="">-- Selecciona una deuda --</option>';
    debts.forEach(function(d, idx) {
      var name = escapeAttr(d.name || d.nombre || 'Deuda ' + (idx + 1));
      var amt = parseFloat(d.amount || d.totalAmount || d.monto || 0);
      debtOptions += '<option value="' + idx + '">' + name + ' (' + currency + formatNumber(amt) + ')</option>';
    });
    debtOptions += '<option value="manual">Ingresar manualmente</option>';

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83E\uDD1D Convenio de Pago</h2>'
      + '<button class="dc-pa-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px;margin-bottom:14px;font-size:12px;color:' + t.muted + ';line-height:1.5">'
      + '\uD83D\uDCA1 Simula un convenio de pago para deudas vencidas: liquidaci\u00f3n en un solo pago o plan de pagos a plazos.</div>'

      // Selección de deuda
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Deuda</label>'
      + '<select class="dc-pa-debt-select" style="' + selSt + '">' + debtOptions + '</select>'

      // Campos manuales (ocultos por defecto)
      + '<div class="dc-pa-manual" style="display:none;margin-top:8px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Nombre de la deuda</label>'
      + '<input class="dc-pa-manual-name" type="text" placeholder="Ej: Tarjeta VISA" style="' + iSt + '">'
      + '</div>'

      // Monto original adeudado
      + '<div style="margin-top:10px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Monto original adeudado (' + currency + ')</label>'
      + '<input class="dc-pa-original" type="number" placeholder="Ej: 50000" style="' + iSt + '"></div>'

      // Monto acordado
      + '<div style="margin-top:10px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Monto acordado en convenio (' + currency + ')</label>'
      + '<input class="dc-pa-agreed" type="number" placeholder="Ej: 35000" style="' + iSt + '"></div>'

      // Tipo de convenio
      + '<div style="margin-top:10px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Tipo de convenio</label>'
      + '<select class="dc-pa-type" style="' + selSt + '">'
      + '<option value="lump">Liquidar en un solo pago</option>'
      + '<option value="installments">Plan de pagos (parcialidades)</option>'
      + '</select></div>'

      // Campos para plan de pagos
      + '<div class="dc-pa-installment-fields" style="display:none;margin-top:10px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">N\u00famero de pagos</label>'
      + '<input class="dc-pa-num-payments" type="number" placeholder="Ej: 6" min="2" style="' + iSt + '">'
      + '<div style="margin-top:8px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Frecuencia de pago</label>'
      + '<select class="dc-pa-frequency" style="' + selSt + '">'
      + '<option value="weekly">Semanal</option>'
      + '<option value="biweekly">Quincenal</option>'
      + '<option value="monthly" selected>Mensual</option>'
      + '</select></div>'
      + '<div style="margin-top:8px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Inter\u00e9s del convenio (% anual, 0 si no aplica)</label>'
      + '<input class="dc-pa-interest" type="number" value="0" min="0" step="0.1" style="' + iSt + '"></div>'
      + '</div>'

      // Fecha inicio
      + '<div style="margin-top:10px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Fecha de inicio del convenio</label>'
      + '<input class="dc-pa-start-date" type="date" value="' + new Date().toISOString().split('T')[0] + '" style="' + iSt + '"></div>'

      // Botón calcular
      + '<button class="dc-pa-calc" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#FF9500,#FF3B30);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px">\uD83E\uDD1D Generar Convenio</button>'
      + '<div class="dc-pa-result" style="margin-top:16px"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-pa-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Toggle campos manuales
    var debtSelect = card.querySelector('.dc-pa-debt-select');
    var manualDiv = card.querySelector('.dc-pa-manual');
    var originalInput = card.querySelector('.dc-pa-original');
    debtSelect.addEventListener('change', function() {
      if (debtSelect.value === 'manual') {
        manualDiv.style.display = 'block';
        originalInput.value = '';
      } else if (debtSelect.value !== '') {
        manualDiv.style.display = 'none';
        var d = debts[parseInt(debtSelect.value)];
        originalInput.value = parseFloat(d.amount || d.totalAmount || d.monto || 0).toFixed(2);
      } else {
        manualDiv.style.display = 'none';
        originalInput.value = '';
      }
    });

    // Toggle campos de plan de pagos
    var typeSelect = card.querySelector('.dc-pa-type');
    var installFields = card.querySelector('.dc-pa-installment-fields');
    typeSelect.addEventListener('change', function() {
      installFields.style.display = typeSelect.value === 'installments' ? 'block' : 'none';
    });

    // Calcular
    card.querySelector('.dc-pa-calc').addEventListener('click', function() {
      var originalAmt = parseFloat(originalInput.value) || 0;
      var agreedAmt = parseFloat(card.querySelector('.dc-pa-agreed').value) || 0;
      var startDateStr = card.querySelector('.dc-pa-start-date').value;
      var agreementType = typeSelect.value;

      if (originalAmt <= 0) { showToast('\u26A0\uFE0F Ingresa el monto original adeudado'); return; }
      if (agreedAmt <= 0) { showToast('\u26A0\uFE0F Ingresa el monto acordado en el convenio'); return; }
      if (agreedAmt > originalAmt) { showToast('\u26A0\uFE0F El monto acordado no puede ser mayor al original'); return; }
      if (!startDateStr) { showToast('\u26A0\uFE0F Selecciona la fecha de inicio'); return; }

      var discount = originalAmt - agreedAmt;
      var discountPct = (discount / originalAmt) * 100;

      // Nombre de la deuda
      var debtName;
      if (debtSelect.value === 'manual') {
        debtName = card.querySelector('.dc-pa-manual-name').value || 'Deuda';
      } else if (debtSelect.value !== '') {
        var selDebt = debts[parseInt(debtSelect.value)];
        debtName = selDebt.name || selDebt.nombre || 'Deuda';
      } else {
        debtName = 'Deuda';
      }

      var startDate = new Date(startDateStr + 'T00:00:00');

      var html = '<div style="background:' + t.inputBg + ';border-radius:14px;padding:16px;margin-bottom:12px">'
        + '<div style="text-align:center;margin-bottom:12px">'
        + '<div style="font-size:36px;margin-bottom:4px">\uD83E\uDD1D</div>'
        + '<div style="font-size:16px;font-weight:700">Convenio de Pago</div>'
        + '<div style="font-size:13px;color:' + t.muted + '">' + escapeHtml(debtName) + '</div></div>'

        // Resumen del convenio
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'
        + '<div style="background:' + t.bg + ';border-radius:10px;padding:10px;text-align:center">'
        + '<div style="font-size:11px;color:' + t.muted + '">Monto Original</div>'
        + '<div style="font-size:16px;font-weight:700;color:#FF3B30;text-decoration:line-through">' + currency + formatNumber(originalAmt) + '</div></div>'
        + '<div style="background:' + t.bg + ';border-radius:10px;padding:10px;text-align:center">'
        + '<div style="font-size:11px;color:' + t.muted + '">Monto Acordado</div>'
        + '<div style="font-size:16px;font-weight:700;color:#34C759">' + currency + formatNumber(agreedAmt) + '</div></div></div>'

        + '<div style="background:linear-gradient(135deg,#34C75920,#34C75910);border:1px solid #34C75940;border-radius:10px;padding:10px;text-align:center;margin-bottom:12px">'
        + '<div style="font-size:11px;color:' + t.muted + '">Descuento Obtenido</div>'
        + '<div style="font-size:20px;font-weight:700;color:#34C759">' + currency + formatNumber(discount) + ' <span style="font-size:14px">(' + discountPct.toFixed(1) + '%)</span></div></div>';

      if (agreementType === 'lump') {
        // ── Pago único ──
        html += '<div style="background:' + t.bg + ';border-radius:10px;padding:14px;text-align:center;border:2px solid #007AFF40">'
          + '<div style="font-size:13px;font-weight:600;color:#007AFF;margin-bottom:6px">\uD83D\uDCB5 Liquidaci\u00f3n en un Solo Pago</div>'
          + '<div style="font-size:11px;color:' + t.muted + '">Monto a pagar</div>'
          + '<div style="font-size:24px;font-weight:700;margin:4px 0">' + currency + formatNumber(agreedAmt) + '</div>'
          + '<div style="font-size:12px;color:' + t.muted + '">Fecha l\u00edmite: <b>' + startDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '</b></div>'
          + '</div>';

        html += '<div style="margin-top:12px;background:' + t.bg + ';border-radius:10px;padding:12px;font-size:12px;color:' + t.muted + ';line-height:1.6">'
          + '<div style="font-weight:600;margin-bottom:4px">\u2705 Ventajas de liquidar en un solo pago:</div>'
          + '\u2022 Te liberas de la deuda inmediatamente<br>'
          + '\u2022 Ahorro de ' + currency + formatNumber(discount) + ' (' + discountPct.toFixed(1) + '% de descuento)<br>'
          + '\u2022 No generas intereses adicionales<br>'
          + '\u2022 Mejoras tu historial crediticio m\u00e1s r\u00e1pido</div>';

      } else {
        // ── Plan de pagos ──
        var numPayments = parseInt(card.querySelector('.dc-pa-num-payments').value) || 0;
        var frequency = card.querySelector('.dc-pa-frequency').value;
        var annualRate = parseFloat(card.querySelector('.dc-pa-interest').value) || 0;

        if (numPayments < 2) { showToast('\u26A0\uFE0F Ingresa al menos 2 pagos para el plan'); return; }

        // Calcular cuota
        var totalWithInterest = agreedAmt;
        var monthlyPayment;
        var totalInterest = 0;

        if (annualRate > 0) {
          // Calcular tasa por período según frecuencia
          var periodsPerYear = frequency === 'weekly' ? 52 : (frequency === 'biweekly' ? 26 : 12);
          var periodRate = annualRate / 100 / periodsPerYear;
          monthlyPayment = agreedAmt * (periodRate * Math.pow(1 + periodRate, numPayments)) / (Math.pow(1 + periodRate, numPayments) - 1);
          totalWithInterest = monthlyPayment * numPayments;
          totalInterest = totalWithInterest - agreedAmt;
        } else {
          monthlyPayment = agreedAmt / numPayments;
        }

        var freqLabel = frequency === 'weekly' ? 'Semanal' : (frequency === 'biweekly' ? 'Quincenal' : 'Mensual');
        var freqDays = frequency === 'weekly' ? 7 : (frequency === 'biweekly' ? 14 : 30);

        html += '<div style="background:' + t.bg + ';border-radius:10px;padding:14px;border:2px solid #5856D640;margin-bottom:12px">'
          + '<div style="font-size:13px;font-weight:600;color:#5856D6;text-align:center;margin-bottom:10px">\uD83D\uDCC5 Plan de Pagos (' + freqLabel + ')</div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center">'
          + '<div><div style="font-size:11px;color:' + t.muted + '">Cuota</div><div style="font-size:15px;font-weight:700">' + currency + formatNumber(monthlyPayment) + '</div></div>'
          + '<div><div style="font-size:11px;color:' + t.muted + '">Pagos</div><div style="font-size:15px;font-weight:700">' + numPayments + '</div></div>'
          + '<div><div style="font-size:11px;color:' + t.muted + '">Total</div><div style="font-size:15px;font-weight:700">' + currency + formatNumber(totalWithInterest) + '</div></div></div>';

        if (totalInterest > 0) {
          html += '<div style="margin-top:8px;text-align:center;font-size:12px;color:#FF9500">'
            + '\u26A0\uFE0F Intereses del convenio: ' + currency + formatNumber(totalInterest) + ' (' + annualRate + '% anual)</div>';
        }
        html += '</div>';

        // Tabla de pagos
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px">\uD83D\uDCC6 Calendario de Pagos</div>';
        html += '<div style="max-height:240px;overflow-y:auto;border:1px solid ' + t.border + ';border-radius:10px">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
        html += '<thead><tr style="background:' + t.inputBg + ';position:sticky;top:0">'
          + '<th style="padding:8px 6px;text-align:center;border-bottom:1px solid ' + t.border + '">#</th>'
          + '<th style="padding:8px 6px;text-align:left;border-bottom:1px solid ' + t.border + '">Fecha</th>'
          + '<th style="padding:8px 6px;text-align:right;border-bottom:1px solid ' + t.border + '">Monto</th>'
          + '<th style="padding:8px 6px;text-align:right;border-bottom:1px solid ' + t.border + '">Saldo</th>'
          + '</tr></thead><tbody>';

        var balance = totalWithInterest;
        var payDate = new Date(startDate.getTime());
        var tableText = 'No.\tFecha\tMonto\tSaldo\n';

        for (var p = 1; p <= numPayments; p++) {
          var thisPayment = p < numPayments ? monthlyPayment : balance;
          balance = Math.max(0, balance - thisPayment);
          var dateStr = payDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
          var isPast = payDate < new Date();
          var rowBg = isPast ? (t.isDark ? '#FF3B3015' : '#FF3B3010') : 'transparent';

          html += '<tr style="background:' + rowBg + '">'
            + '<td style="padding:6px;text-align:center;border-bottom:1px solid ' + t.border + ';color:' + t.muted + '">' + p + '</td>'
            + '<td style="padding:6px;text-align:left;border-bottom:1px solid ' + t.border + ';font-size:11px' + (isPast ? ';color:#FF3B30;font-weight:600' : '') + '">' + dateStr + (isPast ? ' \u26A0\uFE0F' : '') + '</td>'
            + '<td style="padding:6px;text-align:right;border-bottom:1px solid ' + t.border + ';font-weight:600">' + currency + formatNumber(thisPayment) + '</td>'
            + '<td style="padding:6px;text-align:right;border-bottom:1px solid ' + t.border + ';color:' + (balance <= 0 ? '#34C759' : t.muted) + '">' + currency + formatNumber(balance) + '</td></tr>';

          tableText += p + '\t' + dateStr + '\t' + currency + formatNumber(thisPayment) + '\t' + currency + formatNumber(balance) + '\n';

          // Avanzar fecha según frecuencia
          if (frequency === 'weekly') {
            payDate.setDate(payDate.getDate() + 7);
          } else if (frequency === 'biweekly') {
            payDate.setDate(payDate.getDate() + 14);
          } else {
            payDate.setMonth(payDate.getMonth() + 1);
          }
        }

        html += '</tbody></table></div>';

        // Fecha de término
        var endDate = new Date(payDate.getTime());
        if (frequency === 'weekly') endDate.setDate(endDate.getDate() - 7);
        else if (frequency === 'biweekly') endDate.setDate(endDate.getDate() - 14);
        else endDate.setMonth(endDate.getMonth() - 1);

        html += '<div style="margin-top:10px;background:' + t.bg + ';border-radius:10px;padding:10px;text-align:center;font-size:12px;color:' + t.muted + '">'
          + '\uD83C\uDFC1 Terminas de pagar: <b style="color:' + t.txt + '">' + endDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '</b></div>';

        // Ahorro real vs original
        var realSaving = originalAmt - totalWithInterest;
        if (realSaving > 0) {
          html += '<div style="margin-top:8px;background:linear-gradient(135deg,#34C75920,#34C75910);border:1px solid #34C75940;border-radius:10px;padding:10px;text-align:center">'
            + '<div style="font-size:11px;color:' + t.muted + '">Ahorro real vs deuda original (despu\u00e9s de intereses)</div>'
            + '<div style="font-size:18px;font-weight:700;color:#34C759">' + currency + formatNumber(realSaving) + ' (' + (realSaving / originalAmt * 100).toFixed(1) + '%)</div></div>';
        } else if (realSaving < 0) {
          html += '<div style="margin-top:8px;background:linear-gradient(135deg,#FF3B3020,#FF3B3010);border:1px solid #FF3B3040;border-radius:10px;padding:10px;text-align:center">'
            + '<div style="font-size:11px;color:' + t.muted + '">\u26A0\uFE0F Con intereses pagar\u00e1s m\u00e1s que la deuda original</div>'
            + '<div style="font-size:18px;font-weight:700;color:#FF3B30">+' + currency + formatNumber(Math.abs(realSaving)) + '</div></div>';
        }

        // Botón copiar tabla
        html += '<button class="dc-pa-copy" style="width:100%;padding:10px;border:1px solid ' + t.border + ';border-radius:10px;background:transparent;color:' + t.txt + ';font-size:13px;cursor:pointer;margin-top:10px">\uD83D\uDCCB Copiar Tabla al Portapapeles</button>';

        // Guardar referencia al texto de la tabla
        card.setAttribute('data-table-text', tableText);
      }

      html += '</div>'; // cierre del contenedor principal

      card.querySelector('.dc-pa-result').innerHTML = html;

      // Bind copiar si existe
      var copyBtn = card.querySelector('.dc-pa-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          var txt = card.getAttribute('data-table-text') || '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function() {
              showToast('\u2705 Tabla copiada al portapapeles');
            });
          } else {
            var ta = document.createElement('textarea');
            ta.value = txt;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showToast('\u2705 Tabla copiada al portapapeles');
          }
        });
      }
    });
  }

  // ============================================================
  // PDF Export (jsPDF)
  // ============================================================
  async function exportToPDF() {
    showToast('\uD83D\uDCC4 Generando PDF...');
    try {
      // Cargar jsPDF si no está disponible
      if (!window.jspdf) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      }
      var jsPDF = window.jspdf.jsPDF;
      var data = await getAllLocalData();
      var currency = getCurrency();
      var doc = new jsPDF();
      var y = 20;
      var pageW = doc.internal.pageSize.getWidth();

      // Header
      doc.setFillColor(0, 122, 255);
      doc.rect(0, 0, pageW, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.text('DebtControl Pro', pageW / 2, 18, { align: 'center' });
      doc.setFontSize(12);
      doc.text('Reporte Financiero - ' + new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }), pageW / 2, 30, { align: 'center' });
      y = 50;
      doc.setTextColor(0, 0, 0);

      // Resumen
      var debts = data.debts || [];
      var payments = data.payments || [];
      var savings = data.savings || [];
      var investments = data.investments || [];

      var totalDebt = debts.reduce(function(sum, d) { return sum + (parseFloat(d.amount || d.totalAmount || d.monto || 0)); }, 0);
      var totalPaid = payments.reduce(function(sum, p) { return sum + (parseFloat(p.amount || p.monto || 0)); }, 0);
      var totalSavings = savings.reduce(function(sum, s) {
        var bal = parseFloat(s.balance || s.saldo || 0);
        return sum + bal;
      }, 0);

      doc.setFontSize(16);
      doc.text('Resumen General', 14, y);
      y += 10;
      doc.setFontSize(11);
      doc.setDrawColor(200, 200, 200);
      doc.line(14, y, pageW - 14, y);
      y += 8;

      var summaryItems = [
        ['Deudas activas', debts.length + ''],
        ['Total deuda', currency + formatNumber(totalDebt)],
        ['Total pagado', currency + formatNumber(totalPaid)],
        ['Ahorros', currency + formatNumber(totalSavings)],
        ['Inversiones', investments.length + '']
      ];
      summaryItems.forEach(function(item) {
        doc.setFont(undefined, 'bold');
        doc.text(item[0] + ':', 14, y);
        doc.setFont(undefined, 'normal');
        doc.text(item[1], 80, y);
        y += 7;
      });
      y += 5;

      // Deudas
      if (debts.length > 0) {
        y = checkPageBreak(doc, y, 30);
        doc.setFontSize(16);
        doc.text('Deudas', 14, y);
        y += 10;
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text('Nombre', 14, y);
        doc.text('Monto', 90, y);
        doc.text('Categor\u00eda', 130, y);
        doc.text('Vencimiento', 165, y);
        doc.setFont(undefined, 'normal');
        y += 2;
        doc.line(14, y, pageW - 14, y);
        y += 5;
        debts.forEach(function(d) {
          y = checkPageBreak(doc, y, 8);
          var name = (d.name || d.nombre || d.description || 'Sin nombre').substring(0, 30);
          var amount = currency + formatNumber(parseFloat(d.amount || d.totalAmount || d.monto || 0));
          var cat = (d.category || d.categoria || '-').substring(0, 15);
          var due = d.dueDate || d.fechaVencimiento || d.nextPaymentDate || '-';
          if (due !== '-') due = new Date(due).toLocaleDateString('es-ES');
          doc.text(name, 14, y);
          doc.text(amount, 90, y);
          doc.text(cat, 130, y);
          doc.text(due, 165, y);
          y += 6;
        });
        y += 5;
      }

      // Últimos Pagos
      if (payments.length > 0) {
        y = checkPageBreak(doc, y, 30);
        doc.setFontSize(16);
        doc.text('\u00daltimos Pagos', 14, y);
        y += 10;
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text('Fecha', 14, y);
        doc.text('Monto', 60, y);
        doc.text('Deuda', 100, y);
        doc.setFont(undefined, 'normal');
        y += 2;
        doc.line(14, y, pageW - 14, y);
        y += 5;
        var recentPayments = payments.slice(-20).reverse();
        recentPayments.forEach(function(p) {
          y = checkPageBreak(doc, y, 8);
          var date = p.date || p.fecha || '-';
          if (date !== '-') date = new Date(date).toLocaleDateString('es-ES');
          var amount = currency + formatNumber(parseFloat(p.amount || p.monto || 0));
          var debtName = (p.debtName || p.deudaNombre || p.debtId || '-').substring(0, 35);
          doc.text(date, 14, y);
          doc.text(amount, 60, y);
          doc.text(debtName, 100, y);
          y += 6;
        });
        y += 5;
      }

      // Ahorros
      if (savings.length > 0) {
        y = checkPageBreak(doc, y, 30);
        doc.setFontSize(16);
        doc.text('Ahorros', 14, y);
        y += 10;
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text('Cuenta', 14, y);
        doc.text('Balance', 90, y);
        doc.text('Tipo', 140, y);
        doc.setFont(undefined, 'normal');
        y += 2;
        doc.line(14, y, pageW - 14, y);
        y += 5;
        savings.forEach(function(s) {
          y = checkPageBreak(doc, y, 8);
          var name = (s.name || s.nombre || 'Sin nombre').substring(0, 30);
          var balance = currency + formatNumber(parseFloat(s.balance || s.saldo || 0));
          var type = (s.type || s.tipo || '-').substring(0, 15);
          doc.text(name, 14, y);
          doc.text(balance, 90, y);
          doc.text(type, 140, y);
          y += 6;
        });
      }

      // Inversiones
      if (investments.length > 0) {
        y = checkPageBreak(doc, y, 30);
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text('Inversiones', 14, y);
        y += 10;
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text('Nombre', 14, y);
        doc.text('Monto', 90, y);
        doc.text('Tipo', 130, y);
        doc.text('Rendimiento', 165, y);
        doc.setFont(undefined, 'normal');
        y += 2;
        doc.line(14, y, pageW - 14, y);
        y += 5;
        investments.forEach(function(inv) {
          y = checkPageBreak(doc, y, 8);
          var name = (inv.name || inv.nombre || 'Sin nombre').substring(0, 30);
          var amount = currency + formatNumber(parseFloat(inv.amount || inv.monto || 0));
          var type = (inv.type || inv.tipo || '-').substring(0, 15);
          var rr = inv.returnRate != null ? inv.returnRate : (inv.rendimiento != null ? inv.rendimiento : null);
          var returnRate = rr !== null ? rr + '%' : '-';
          doc.text(name, 14, y);
          doc.text(amount, 90, y);
          doc.text(type, 130, y);
          doc.text(String(returnRate), 165, y);
          y += 6;
        });
        y += 5;
      }

      // Footer
      var totalPages = doc.internal.getNumberOfPages();
      for (var p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('DebtControl Pro - Generado el ' + new Date().toLocaleString('es-ES'), 14, doc.internal.pageSize.getHeight() - 10);
        doc.text('P\u00e1gina ' + p + ' de ' + totalPages, pageW - 14, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
      }

      doc.save('debtcontrol-reporte-' + new Date().toISOString().slice(0, 10) + '.pdf');
      showToast('\u2705 PDF generado');
    } catch (err) {
      console.error('[PDF]', err);
      showToast('\u274C Error al generar PDF. Requiere conexi\u00f3n para la primera vez.');
    }
  }

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function checkPageBreak(doc, y, needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      return 20;
    }
    return y;
  }

  function formatNumber(n) {
    if (isNaN(n) || n === null || n === undefined) n = 0;
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ============================================================
  // Sync con Firebase REST
  // ============================================================
  async function syncToCloud() {
    if (!connected) { showToast('\u26A0\uFE0F Configura Firebase primero (\u2601\uFE0F \u2192 \u2699\uFE0F)'); return; }
    try {
      await savePreSyncSnapshot();
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
        logSyncEvent('upload', true, 'Datos subidos correctamente');
        showToast('\u2705 Sincronizado con la nube');
      } else {
        logSyncEvent('upload', false, 'Error al subir');
        showToast('\u274C Error al subir datos');
      }
    } catch (err) {
      logSyncEvent('upload', false, err.message || 'Error');
      showToast('\u274C Error: ' + (err.message || 'sin conexi\u00f3n'));
    }
  }

  async function syncFromCloud() {
    if (!connected) { showToast('\u26A0\uFE0F Configura Firebase primero (\u2601\uFE0F \u2192 \u2699\uFE0F)'); return; }
    try {
      await savePreSyncSnapshot();
      showToast('\u2601\uFE0F Descargando datos...');
      var raw = await restGet('users/' + getSyncId() + '/data');
      if (!raw) { showToast('\u2139\uFE0F No hay datos en la nube'); return; }
      var data;
      if (raw._encrypted) {
        var pin = getSyncPin();
        if (!pin) {
          pin = await dcPrompt('Los datos est\u00e1n cifrados.\nIntroduce tu PIN:', { icon: '\uD83D\uDD12', placeholder: 'PIN...', inputType: 'password' });
        }
        if (!pin) return;
        var decrypted = simpleDecrypt(raw._data, pin);
        if (!decrypted) { showToast('\u274C PIN incorrecto'); return; }
        data = JSON.parse(decrypted);
      } else {
        data = raw;
      }
      var lastSync = raw._lastSync || 'desconocida';
      var ok = await dcConfirm('\u00bfRestaurar datos de la nube?\n\u00daltima sync: ' + lastSync + '\nEsto reemplazar\u00e1 tus datos locales.', { icon: '\u2601\uFE0F', confirmText: 'Restaurar', danger: true });
      if (!ok) return;
      var lf = getLocalForage();
      for (var i = 0; i < SYNC_KEYS.length; i++) {
        if (data[SYNC_KEYS[i]] != null && lf) await lf.setItem(SYNC_KEYS[i], data[SYNC_KEYS[i]]);
      }
      logSyncEvent('download', true, 'Datos descargados correctamente');
      showToast('\u2705 Datos restaurados. Recargando...');
      setTimeout(function() { location.reload(); }, 1500);
    } catch (err) {
      logSyncEvent('download', false, err.message || 'Error');
      showToast('\u274C Error: ' + (err.message || 'sin conexi\u00f3n'));
    }
  }

  // ============================================================
  // Sync History
  // ============================================================
  function logSyncEvent(type, success, details) {
    try {
      var history = JSON.parse(localStorage.getItem(LS_SYNC_HISTORY) || '[]');
      history.push({
        type: type,
        success: success,
        details: details,
        device: navigator.userAgent.substring(0, 40),
        ts: new Date().toISOString()
      });
      if (history.length > 50) history = history.slice(-50);
      localStorage.setItem(LS_SYNC_HISTORY, JSON.stringify(history));
    } catch (e) {}
  }

  function showSyncHistory() {
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var panel = document.createElement('div');
    Object.assign(panel.style, {
      background: t.bg, borderRadius: '20px', padding: '24px', maxWidth: '420px',
      width: '100%', maxHeight: '80vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var history = [];
    try { history = JSON.parse(localStorage.getItem(LS_SYNC_HISTORY) || '[]'); } catch (e) {}
    history = history.reverse();

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDCCB Historial de Sync</h2>'
      + '<button class="dc-hist-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button>'
      + '</div>';

    if (history.length === 0) {
      html += '<p style="text-align:center;color:' + t.muted + '">No hay historial a\u00fan</p>';
    } else {
      history.forEach(function(entry) {
        var icon = entry.success ? '\u2705' : '\u274C';
        var typeLabel = entry.type === 'upload' ? '\u2B06\uFE0F Subida' : '\u2B07\uFE0F Descarga';
        var date = new Date(entry.ts).toLocaleString('es-ES');
        html += '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px;margin-bottom:8px">'
          + '<div style="display:flex;justify-content:space-between;align-items:center">'
          + '<span style="font-size:13px;font-weight:600">' + icon + ' ' + typeLabel + '</span>'
          + '<span style="font-size:11px;color:' + t.muted + '">' + date + '</span>'
          + '</div>'
          + '<div style="font-size:12px;color:' + t.muted + ';margin-top:4px">' + escapeHtml(entry.details || '') + '</div>'
          + '</div>';
      });
    }

    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('.dc-hist-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Botón limpiar historial
    if (history.length > 0) {
      var clearBtn = document.createElement('button');
      clearBtn.textContent = '\uD83D\uDDD1\uFE0F Limpiar Historial';
      Object.assign(clearBtn.style, {
        width: '100%', padding: '12px', border: '1px solid #FF3B30', borderRadius: '10px',
        background: 'transparent', color: '#FF3B30', fontSize: '13px', cursor: 'pointer', marginTop: '12px'
      });
      clearBtn.addEventListener('click', async function() {
        var ok = await dcConfirm('\u00bfLimpiar todo el historial de sincronizaci\u00f3n?', { icon: '\uD83D\uDDD1\uFE0F', confirmText: 'Limpiar', danger: true });
        if (ok) {
          localStorage.removeItem(LS_SYNC_HISTORY);
          overlay.remove();
          showToast('\u2705 Historial limpiado');
        }
      });
      panel.appendChild(clearBtn);
    }
  }

  // ============================================================
  // UI: Toast
  // ============================================================
  function showToast(message, duration) {
    duration = duration || 3000;
    var old = document.getElementById('dc-toast');
    if (old) old.remove();
    var isDarkToast = isDarkMode();
    var t = document.createElement('div');
    t.id = 'dc-toast';
    t.textContent = message;
    Object.assign(t.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      background: isDarkToast ? '#2d3748' : '#1a1a2e', color: '#fff', padding: '12px 24px', borderRadius: '12px',
      fontSize: '14px', fontWeight: '500', zIndex: '99999',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: '90vw', textAlign: 'center',
      transition: 'opacity 0.3s, transform 0.3s',
      animation: 'dcToastIn 0.3s ease'
    });
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, duration);
  }

  // ============================================================
  // Notificaciones de vencimiento
  // ============================================================
  function getNotifPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_NOTIFICATIONS)) || { enabled: false, daysBefore: [1, 3, 7] }; }
    catch (e) { return { enabled: false, daysBefore: [1, 3, 7] }; }
  }

  function saveNotifPrefs(prefs) {
    localStorage.setItem(LS_NOTIFICATIONS, JSON.stringify(prefs));
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) { showToast('\u274C Tu navegador no soporta notificaciones'); return false; }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') { showToast('\u274C Notificaciones bloqueadas. Habil\u00edtalas en ajustes del navegador.'); return false; }
    var result = await Notification.requestPermission();
    return result === 'granted';
  }

  async function checkDueDates() {
    var prefs = getNotifPrefs();
    if (!prefs.enabled) return;
    if (Notification.permission !== 'granted') return;

    var data = await getAllLocalData();
    var debts = data.debts || [];
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    var notifiedKey = 'debtcontrol_notified_' + now.toISOString().slice(0, 10);
    var alreadyNotified = [];
    try { alreadyNotified = JSON.parse(localStorage.getItem(notifiedKey) || '[]'); } catch (e) {}

    debts.forEach(function(d) {
      var dueStr = d.dueDate || d.fechaVencimiento || d.nextPaymentDate || null;
      if (!dueStr) return;
      var due = new Date(dueStr);
      due.setHours(0, 0, 0, 0);
      var diffDays = Math.round((due - now) / (1000 * 60 * 60 * 24));
      var debtId = d.id || d.nombre || d.name || dueStr;
      if (alreadyNotified.indexOf(debtId) !== -1) return;

      var name = d.name || d.nombre || d.description || 'Deuda';
      var amount = getCurrency() + formatNumber(parseFloat(d.monthlyPayment || d.cuota || d.amount || d.monto || 0));

      if (diffDays === 0) {
        new Notification('DebtControl Pro', {
          body: '\u203C\uFE0F ' + name + ' vence HOY (' + amount + ')',
          icon: './icons/icon-192.png',
          tag: 'debt-today-' + debtId,
          requireInteraction: true
        });
        alreadyNotified.push(debtId);
      } else if (prefs.daysBefore.indexOf(diffDays) !== -1) {
        new Notification('DebtControl Pro', {
          body: '\uD83D\uDCC5 ' + name + ' vence en ' + diffDays + ' d\u00eda' + (diffDays !== 1 ? 's' : '') + ' (' + amount + ')',
          icon: './icons/icon-192.png',
          tag: 'debt-' + debtId,
          requireInteraction: false
        });
        alreadyNotified.push(debtId);
      } else if (diffDays < 0) {
        new Notification('DebtControl Pro', {
          body: '\u26A0\uFE0F ' + name + ' est\u00e1 VENCIDA (' + Math.abs(diffDays) + ' d\u00eda' + (Math.abs(diffDays) !== 1 ? 's' : '') + ' de retraso) - ' + amount,
          icon: './icons/icon-192.png',
          tag: 'debt-overdue-' + debtId,
          requireInteraction: true
        });
        alreadyNotified.push(debtId);
      }
    });

    localStorage.setItem(notifiedKey, JSON.stringify(alreadyNotified));
  }

  async function showNotificationConfig() {
    var prefs = getNotifPrefs();
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
      width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var permStatus = ('Notification' in window) ? Notification.permission : 'unsupported';
    var permLabel = permStatus === 'granted' ? '\uD83D\uDFE2 Permitidas' : permStatus === 'denied' ? '\uD83D\uDD34 Bloqueadas' : '\uD83D\uDFE1 Sin solicitar';

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDD14 Notificaciones</h2>'
      + '<button class="dc-notif-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button>'
      + '</div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-bottom:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<span style="font-size:14px;font-weight:600">Activar notificaciones</span>'
      + '<label style="position:relative;width:50px;height:28px;display:inline-block">'
      + '<input type="checkbox" class="dc-notif-toggle" ' + (prefs.enabled ? 'checked' : '') + ' style="opacity:0;width:0;height:0">'
      + '<span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:' + (prefs.enabled ? '#34C759' : '#ccc') + ';border-radius:14px;transition:0.3s"></span>'
      + '<span style="position:absolute;top:3px;left:' + (prefs.enabled ? '25px' : '3px') + ';width:22px;height:22px;background:#fff;border-radius:50%;transition:0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>'
      + '</label></div>'
      + '<div style="font-size:12px;color:' + t.muted + ';margin-top:6px">Estado: ' + permLabel + '</div>'
      + '</div>'
      + '<div style="margin-bottom:16px">'
      + '<div style="font-size:13px;font-weight:600;margin-bottom:8px">Avisar con anticipaci\u00f3n de:</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + [1, 3, 5, 7, 14, 30].map(function(d) {
          var active = prefs.daysBefore.indexOf(d) !== -1;
          return '<button class="dc-notif-day" data-days="' + d + '" data-active="' + (active ? 'true' : 'false') + '" style="padding:8px 14px;border-radius:10px;border:1px solid ' + (active ? '#007AFF' : t.border) + ';background:' + (active ? '#007AFF22' : 'transparent') + ';color:' + (active ? '#007AFF' : t.txt) + ';font-size:13px;font-weight:500;cursor:pointer">' + d + 'd</button>';
        }).join('')
      + '</div></div>'
      + '<button class="dc-notif-save" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer">\uD83D\uDD14 Guardar Preferencias</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Toggle visual
    var toggle = card.querySelector('.dc-notif-toggle');
    toggle.addEventListener('change', function() {
      var track = toggle.nextElementSibling;
      var thumb = track.nextElementSibling;
      track.style.background = toggle.checked ? '#34C759' : '#ccc';
      thumb.style.left = toggle.checked ? '25px' : '3px';
    });

    // Day buttons toggle
    card.querySelectorAll('.dc-notif-day').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var active = btn.getAttribute('data-active') === 'true';
        if (active) {
          btn.setAttribute('data-active', 'false');
          btn.style.background = 'transparent';
          btn.style.borderColor = t.border;
          btn.style.color = t.txt;
        } else {
          btn.setAttribute('data-active', 'true');
          btn.style.background = '#007AFF22';
          btn.style.borderColor = '#007AFF';
          btn.style.color = '#007AFF';
        }
      });
    });

    // Save
    card.querySelector('.dc-notif-save').addEventListener('click', async function() {
      var enabled = toggle.checked;
      if (enabled) {
        var granted = await requestNotificationPermission();
        if (!granted) {
          toggle.checked = false;
          toggle.dispatchEvent(new Event('change'));
          return;
        }
      }
      var days = [];
      card.querySelectorAll('.dc-notif-day').forEach(function(btn) {
        if (btn.getAttribute('data-active') === 'true') {
          days.push(parseInt(btn.getAttribute('data-days')));
        }
      });
      saveNotifPrefs({ enabled: enabled, daysBefore: days });
      overlay.remove();
      showToast(enabled ? '\uD83D\uDD14 Notificaciones activadas' : '\uD83D\uDD15 Notificaciones desactivadas');
      if (enabled) checkDueDates();
    });

    card.querySelector('.dc-notif-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // Calendario de Pagos
  // ============================================================
  async function showCalendar() {
    var data = await getAllLocalData();
    var debts = data.debts || [];
    var payments = data.payments || [];
    var reminders = data.reminders || [];
    var currentDate = new Date();
    var currentMonth = currentDate.getMonth();
    var currentYear = currentDate.getFullYear();

    function render(month, year) {
      var existing = document.getElementById('dc-calendar-overlay');
      if (existing) existing.remove();

      var t = getThemeColors();
      var overlay = document.createElement('div');
      overlay.id = 'dc-calendar-overlay';
      Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: '99998', padding: '16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        animation: 'dcFadeIn 0.2s ease'
      });

      var panel = document.createElement('div');
      Object.assign(panel.style, {
        background: t.bg, borderRadius: '20px', padding: '24px', maxWidth: '400px',
        width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      });

      var monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      var dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

      // Mapear eventos del mes
      var events = {};
      var today = new Date();
      today.setHours(0, 0, 0, 0);

      debts.forEach(function(d) {
        var dueStr = d.dueDate || d.fechaVencimiento || d.nextPaymentDate || null;
        if (!dueStr) return;
        var due = new Date(dueStr);
        if (due.getMonth() === month && due.getFullYear() === year) {
          var day = due.getDate();
          if (!events[day]) events[day] = [];
          var isPaid = payments.some(function(p) {
            var pDate = new Date(p.date || p.fecha || '');
            return (p.debtId === d.id || p.debtName === d.name) &&
                   pDate.getMonth() === month && pDate.getFullYear() === year;
          });
          events[day].push({
            name: d.name || d.nombre || 'Deuda',
            amount: parseFloat(d.monthlyPayment || d.cuota || d.amount || d.monto || 0),
            paid: isPaid,
            overdue: due < today && !isPaid,
            type: 'debt'
          });
        }
      });

      // Mapear recordatorios del mes
      reminders.forEach(function(r) {
        var rDateStr = r.date || r.fecha || null;
        if (!rDateStr) return;
        var rDate = new Date(rDateStr);
        if (rDate.getMonth() === month && rDate.getFullYear() === year) {
          var day = rDate.getDate();
          if (!events[day]) events[day] = [];
          events[day].push({
            name: r.title || r.titulo || 'Recordatorio',
            amount: 0,
            paid: false,
            overdue: false,
            type: 'reminder'
          });
        }
      });

      // Días del mes
      var firstDay = new Date(year, month, 1).getDay();
      firstDay = firstDay === 0 ? 6 : firstDay - 1; // Lunes = 0
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      var calHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center">';
      dayNames.forEach(function(d) {
        calHtml += '<div style="font-size:11px;font-weight:700;color:' + t.muted + ';padding:6px 0">' + d + '</div>';
      });

      for (var i = 0; i < firstDay; i++) {
        calHtml += '<div></div>';
      }

      for (var d = 1; d <= daysInMonth; d++) {
        var isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        var hasEvents = events[d] && events[d].length > 0;
        var bg = 'transparent';
        var color = t.txt;
        var border2 = 'transparent';
        var dots = '';

        if (isToday) {
          border2 = '#007AFF';
        }
        if (hasEvents) {
          var debtEvents = events[d].filter(function(e) { return e.type !== 'reminder'; });
          var reminderOnly = debtEvents.length === 0;
          var allPaid = debtEvents.length > 0 && debtEvents.every(function(e) { return e.paid; });
          var anyOverdue = debtEvents.some(function(e) { return e.overdue; });
          if (reminderOnly) {
            bg = '#5856D620';
            dots = '<div style="width:6px;height:6px;border-radius:50%;background:#5856D6;margin:2px auto 0"></div>';
          } else if (anyOverdue) {
            bg = '#FF3B3020';
            dots = '<div style="width:6px;height:6px;border-radius:50%;background:#FF3B30;margin:2px auto 0"></div>';
          } else if (allPaid) {
            bg = '#34C75920';
            dots = '<div style="width:6px;height:6px;border-radius:50%;background:#34C759;margin:2px auto 0"></div>';
          } else {
            bg = '#FF950020';
            dots = '<div style="width:6px;height:6px;border-radius:50%;background:#FF9500;margin:2px auto 0"></div>';
          }
        }

        calHtml += '<div class="dc-cal-day" data-day="' + d + '" style="padding:6px 2px;border-radius:10px;background:' + bg + ';cursor:' + (hasEvents ? 'pointer' : 'default') + ';border:2px solid ' + border2 + ';font-size:14px;font-weight:' + (isToday ? '700' : '400') + ';color:' + color + ';transition:background 0.15s">'
          + d + dots + '</div>';
      }
      calHtml += '</div>';

      panel.innerHTML = ''
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
        + '<button class="dc-cal-prev" style="background:none;border:none;font-size:20px;cursor:pointer;color:' + t.txt + ';padding:8px">\u25C0</button>'
        + '<h2 style="margin:0;font-size:18px">\uD83D\uDCC5 ' + monthNames[month] + ' ' + year + '</h2>'
        + '<button class="dc-cal-next" style="background:none;border:none;font-size:20px;cursor:pointer;color:' + t.txt + ';padding:8px">\u25B6</button>'
        + '</div>'
        + '<div style="display:flex;gap:12px;justify-content:center;margin-bottom:12px;font-size:11px;flex-wrap:wrap">'
        + '<span>\uD83D\uDD34 Vencido</span><span>\uD83D\uDFE1 Pendiente</span><span>\uD83D\uDFE2 Pagado</span><span>\uD83D\uDFE3 Recordatorio</span>'
        + '</div>'
        + calHtml
        + '<div id="dc-cal-details" style="margin-top:12px;min-height:20px"></div>'
        + '<button class="dc-cal-close" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:12px">Cerrar</button>';

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // Events
      panel.querySelector('.dc-cal-prev').addEventListener('click', function() {
        var m = month - 1, y = year;
        if (m < 0) { m = 11; y--; }
        render(m, y);
      });
      panel.querySelector('.dc-cal-next').addEventListener('click', function() {
        var m = month + 1, y = year;
        if (m > 11) { m = 0; y++; }
        render(m, y);
      });
      panel.querySelector('.dc-cal-close').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

      // Click on day to see details
      panel.querySelectorAll('.dc-cal-day').forEach(function(dayEl) {
        dayEl.addEventListener('click', function() {
          var day = parseInt(dayEl.getAttribute('data-day'));
          var dayEvents = events[day];
          var details = panel.querySelector('#dc-cal-details');
          if (!dayEvents || dayEvents.length === 0) {
            details.innerHTML = '<div style="text-align:center;color:' + t.muted + ';font-size:12px">Sin eventos este d\u00eda</div>';
            return;
          }
          var currency = getCurrency();
          var html = '';
          dayEvents.forEach(function(ev) {
            if (ev.type === 'reminder') {
              html += '<div style="background:' + t.inputBg + ';border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">'
                + '<span style="font-size:13px">\uD83D\uDCCC ' + escapeHtml(ev.name) + '</span>'
                + '<span style="font-size:12px;font-weight:500;color:#5856D6">Recordatorio</span>'
                + '</div>';
            } else {
              var statusIcon = ev.overdue ? '\uD83D\uDD34' : ev.paid ? '\uD83D\uDFE2' : '\uD83D\uDFE1';
              var statusText = ev.overdue ? 'Vencida' : ev.paid ? 'Pagada' : 'Pendiente';
              html += '<div style="background:' + t.inputBg + ';border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">'
                + '<span style="font-size:13px">' + statusIcon + ' ' + escapeHtml(ev.name) + '</span>'
                + '<span style="font-size:12px;font-weight:600">' + currency + formatNumber(ev.amount) + ' \u2022 ' + statusText + '</span>'
                + '</div>';
            }
          });
          details.innerHTML = html;
        });
      });
    }

    render(currentMonth, currentYear);
  }

  // ============================================================
  // Configuración de moneda
  // ============================================================
  function showCurrencyConfig() {
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
      width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center'
    });

    var current = getCurrency();
    var currencies = [
      { sym: '$', label: 'D\u00f3lar ($)' },
      { sym: '\u20AC', label: 'Euro (\u20AC)' },
      { sym: '\u00A3', label: 'Libra (\u00A3)' },
      { sym: '\u00A5', label: 'Yen/Yuan (\u00A5)' },
      { sym: '\u20B9', label: 'Rupia (\u20B9)' },
      { sym: 'R$', label: 'Real (R$)' },
      { sym: 'CLP', label: 'Peso Chileno (CLP)' },
      { sym: 'MXN', label: 'Peso Mexicano (MXN)' },
      { sym: 'COP', label: 'Peso Colombiano (COP)' }
    ];

    var buttonsHtml = currencies.map(function(c) {
      var active = c.sym === current;
      return '<button class="dc-cur-btn" data-sym="' + escapeAttr(c.sym) + '" style="padding:12px;border-radius:12px;border:2px solid ' + (active ? '#007AFF' : t.border) + ';background:' + (active ? '#007AFF15' : 'transparent') + ';color:' + t.txt + ';font-size:14px;cursor:pointer;font-weight:' + (active ? '700' : '400') + ';transition:all 0.15s">' + c.label + '</button>';
    }).join('');

    card.innerHTML = ''
      + '<div style="font-size:48px;margin-bottom:12px">\uD83D\uDCB1</div>'
      + '<h2 style="margin:0 0 8px 0;font-size:18px">Configurar Moneda</h2>'
      + '<p style="font-size:12px;color:' + t.muted + ';margin:0 0 16px 0">Se aplica en reportes PDF y vista de la app</p>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">' + buttonsHtml + '</div>'
      + '<div style="margin-bottom:16px">'
      + '<input class="dc-cur-custom" placeholder="Otro s\u00edmbolo..." value="' + (currencies.some(function(c) { return c.sym === current; }) ? '' : current) + '" style="width:100%;padding:12px;border-radius:12px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;box-sizing:border-box;text-align:center">'
      + '</div>'
      + '<div style="display:flex;gap:10px">'
      + '<button class="dc-cur-cancel" style="flex:1;padding:14px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:15px;cursor:pointer">Cancelar</button>'
      + '<button class="dc-cur-save" style="flex:1;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer">Guardar</button>'
      + '</div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var selectedSym = current;
    card.querySelectorAll('.dc-cur-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        card.querySelectorAll('.dc-cur-btn').forEach(function(b) {
          b.style.borderColor = t.border;
          b.style.background = 'transparent';
          b.style.fontWeight = '400';
        });
        btn.style.borderColor = '#007AFF';
        btn.style.background = '#007AFF15';
        btn.style.fontWeight = '700';
        selectedSym = btn.getAttribute('data-sym');
        card.querySelector('.dc-cur-custom').value = '';
      });
    });

    card.querySelector('.dc-cur-custom').addEventListener('input', function() {
      if (this.value) {
        selectedSym = this.value;
        card.querySelectorAll('.dc-cur-btn').forEach(function(b) {
          b.style.borderColor = t.border;
          b.style.background = 'transparent';
          b.style.fontWeight = '400';
        });
      }
    });

    card.querySelector('.dc-cur-save').addEventListener('click', function() {
      if (selectedSym) {
        setCurrency(selectedSym);
        overlay.remove();
        showToast('\uD83D\uDCB1 Moneda cambiada a ' + selectedSym);
      }
    });
    card.querySelector('.dc-cur-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // Instalar App
  // ============================================================
  async function installApp() {
    if (window.dcInstallPrompt) {
      window.dcInstallPrompt.prompt();
      var result = await window.dcInstallPrompt.userChoice;
      if (result.outcome === 'accepted') {
        showToast('\u2705 \u00a1App instalada!');
        window.dcInstallPrompt = null;
      }
    } else {
      showToast('\u2139\uFE0F La app ya est\u00e1 instalada o tu navegador no soporta instalaci\u00f3n');
    }
  }

  // ============================================================
  // Sesión configurable (UI)
  // ============================================================
  function showSessionConfig() {
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
      width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center'
    });

    var guard = window.DebtControlGuard;
    var currentHours = guard ? guard.getSessionDuration() : 24;

    var options = [
      { h: 1, label: '1 hora' },
      { h: 8, label: '8 horas' },
      { h: 24, label: '24 horas' },
      { h: 168, label: '7 d\u00edas' },
      { h: 0, label: 'No cerrar sesi\u00f3n' }
    ];

    var btnsHtml = options.map(function(o) {
      var active = o.h === currentHours;
      return '<button class="dc-sess-btn" data-hours="' + o.h + '" style="padding:14px;border-radius:12px;border:2px solid ' + (active ? '#007AFF' : t.border) + ';background:' + (active ? '#007AFF15' : 'transparent') + ';color:' + t.txt + ';font-size:14px;cursor:pointer;font-weight:' + (active ? '700' : '400') + '">' + o.label + '</button>';
    }).join('');

    var autoSyncOn = isAutoSyncEnabled();

    card.innerHTML = ''
      + '<div style="font-size:48px;margin-bottom:12px">\u23F0</div>'
      + '<h2 style="margin:0 0 8px 0;font-size:18px">Duraci\u00f3n de Sesi\u00f3n</h2>'
      + '<p style="font-size:12px;color:' + t.muted + ';margin:0 0 16px 0">Cu\u00e1nto tiempo permaneces autenticado</p>'
      + '<div style="display:grid;gap:8px;margin-bottom:20px">' + btnsHtml + '</div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px;margin-bottom:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<div><div style="font-size:14px;font-weight:600">Auto-sync al reconectar</div>'
      + '<div style="font-size:11px;color:' + t.muted + '">Subir datos autom\u00e1ticamente al volver online</div></div>'
      + '<label style="position:relative;width:50px;height:28px;display:inline-block;flex-shrink:0;margin-left:12px">'
      + '<input type="checkbox" class="dc-autosync-toggle" ' + (autoSyncOn ? 'checked' : '') + ' style="opacity:0;width:0;height:0">'
      + '<span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:' + (autoSyncOn ? '#34C759' : '#ccc') + ';border-radius:14px;transition:0.3s"></span>'
      + '<span style="position:absolute;top:3px;left:' + (autoSyncOn ? '25px' : '3px') + ';width:22px;height:22px;background:#fff;border-radius:50%;transition:0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>'
      + '</label></div></div>'
      + '<button class="dc-sess-close" style="width:100%;padding:14px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:15px;cursor:pointer">Cerrar</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Auto-sync toggle
    var asToggle = card.querySelector('.dc-autosync-toggle');
    asToggle.addEventListener('change', function() {
      var track = asToggle.nextElementSibling;
      var thumb = track.nextElementSibling;
      track.style.background = asToggle.checked ? '#34C759' : '#ccc';
      thumb.style.left = asToggle.checked ? '25px' : '3px';
      localStorage.setItem(LS_AUTO_SYNC_ENABLED, asToggle.checked ? 'true' : 'false');
      showToast(asToggle.checked ? '\u2601\uFE0F Auto-sync activado' : '\u2601\uFE0F Auto-sync desactivado');
    });

    card.querySelectorAll('.dc-sess-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var hours = parseFloat(btn.getAttribute('data-hours'));
        if (guard) guard.setSessionDuration(hours);
        card.querySelectorAll('.dc-sess-btn').forEach(function(b) {
          b.style.borderColor = t.border;
          b.style.background = 'transparent';
          b.style.fontWeight = '400';
        });
        btn.style.borderColor = '#007AFF';
        btn.style.background = '#007AFF15';
        btn.style.fontWeight = '700';
        showToast('\u2705 Sesi\u00f3n configurada: ' + btn.textContent);
        setTimeout(function() { overlay.remove(); }, 800);
      });
    });

    card.querySelector('.dc-sess-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // Panel configuración Firebase (ARREGLADO: sin XSS)
  // ============================================================
  function showFirebaseSetup() {
    var existing = document.getElementById('dc-setup-overlay');
    if (existing) { existing.remove(); return; }

    var t = getThemeColors();
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
    var qrSrc = savedUrl ? 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(savedUrl) : '';

    var panel = document.createElement('div');
    Object.assign(panel.style, {
      background: t.bg, borderRadius: '20px', padding: '24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    panel.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:20px">\u2601\uFE0F Configurar Firebase</h2>'
      + '<button id="dc-close-setup" style="background:none;border:none;font-size:24px;cursor:pointer;color:' + t.txt + ';padding:4px">\u2715</button>'
      + '</div>'
      + '<div style="background:' + (connected ? '#34C75920' : '#FF950020') + ';border-radius:12px;padding:12px;margin-bottom:16px;display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:20px">' + (connected ? '\uD83D\uDFE2' : '\uD83D\uDD34') + '</span>'
      + '<span style="font-size:14px;font-weight:600">' + (connected ? 'Conectado a Firebase' : 'No conectado') + '</span>'
      + '</div>'
      + '<div style="margin-bottom:16px">'
      + '<label style="font-size:13px;font-weight:600;color:' + t.muted + '">URL de tu Realtime Database</label>'
      + '<input id="dc-dburl" placeholder="https://tu-proyecto-default-rtdb.firebaseio.com" style="width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;box-sizing:border-box;margin-top:6px">'
      + '<p style="font-size:11px;color:' + t.muted + ';margin:6px 0 0 0">Firebase Console \u2192 Realtime Database (URL arriba de los datos).</p>'
      + '</div>'
      + '<button id="dc-save-config" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:12px">'
      + (connected ? '\u2705 Conectado \u2014 Guardar cambios' : '\uD83D\uDD17 Conectar') + '</button>'
      + (savedUrl ? '<button id="dc-clear-config" style="width:100%;padding:10px;border:1px solid #FF3B30;border-radius:10px;background:transparent;color:#FF3B30;font-size:13px;cursor:pointer;margin-bottom:16px">\uD83D\uDDD1\uFE0F Desconectar</button>' : '')
      + (savedUrl ? '<hr style="border:none;border-top:1px solid ' + t.border + ';margin:16px 0">'
        + '<h3 style="font-size:16px;margin:0 0 12px 0">\uD83D\uDCF1 Compartir con otro dispositivo</h3>'
        + '<div style="text-align:center;margin-bottom:12px"><img id="dc-qr" src="' + escapeAttr(qrSrc) + '" style="width:180px;height:180px;border-radius:12px;border:1px solid ' + t.border + '" alt="QR"></div>'
        + '<div style="display:flex;gap:8px;margin-bottom:16px">'
        + '<button id="dc-copy-url" style="flex:1;padding:10px;border:1px solid ' + t.border + ';border-radius:10px;background:' + t.bg + ';color:' + t.txt + ';font-size:13px;cursor:pointer">\uD83D\uDCCB Copiar URL</button>'
        + '<button id="dc-share-url" style="flex:1;padding:10px;border:1px solid ' + t.border + ';border-radius:10px;background:' + t.bg + ';color:' + t.txt + ';font-size:13px;cursor:pointer">\uD83D\uDCE4 Compartir</button>'
        + '</div>' : '')
      + '<hr style="border:none;border-top:1px solid ' + t.border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 12px 0">\uD83D\uDD17 Sincronizaci\u00f3n</h3>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '<div style="font-size:12px;color:' + t.muted + ';font-weight:600">Tu ID de sincronizaci\u00f3n</div>'
      + '<div style="font-size:12px;font-family:monospace;word-break:break-all;margin-top:4px">' + escapeHtml(syncId) + '</div>'
      + '<div style="display:flex;gap:8px;margin-top:8px">'
      + '<button id="dc-copy-id" style="flex:1;padding:8px;border:1px solid ' + t.border + ';border-radius:8px;background:' + t.bg + ';color:' + t.txt + ';font-size:12px;cursor:pointer">\uD83D\uDCCB Copiar</button>'
      + '<button id="dc-change-id" style="flex:1;padding:8px;border:1px solid ' + t.border + ';border-radius:8px;background:' + t.bg + ';color:' + t.txt + ';font-size:12px;cursor:pointer">\u270F\uFE0F Cambiar ID</button>'
      + '</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '<div style="font-size:12px;color:' + t.muted + ';font-weight:600">\u00daltima sincronizaci\u00f3n</div>'
      + '<div style="font-size:13px;margin-top:4px">' + (lastSync !== 'Nunca' ? new Date(lastSync).toLocaleString('es-ES') : 'Nunca') + '</div>'
      + '</div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;margin-bottom:12px">'
      + '<div style="font-size:12px;color:' + t.muted + ';font-weight:600">\uD83D\uDD12 PIN de cifrado (opcional)</div>'
      + '<div style="display:flex;gap:8px;margin-top:8px">'
      + '<input id="dc-pin" type="password" placeholder="PIN num\u00e9rico..." style="flex:1;padding:10px;border-radius:8px;border:1px solid ' + t.border + ';background:' + t.bg + ';color:' + t.txt + ';font-size:14px">'
      + '<button id="dc-save-pin" style="padding:8px 16px;border:none;border-radius:8px;background:#34C759;color:#fff;font-size:13px;cursor:pointer;font-weight:600">Guardar</button>'
      + '</div>'
      + '<div style="font-size:11px;color:' + t.muted + ';margin-top:6px">Cifra los datos antes de subirlos.</div>'
      + '</div>'
      + '<hr style="border:none;border-top:1px solid ' + t.border + ';margin:16px 0">'
      + '<h3 style="font-size:16px;margin:0 0 8px 0">\uD83D\uDCD6 \u00bfC\u00f3mo obtener la URL?</h3>'
      + '<ol style="font-size:13px;color:' + t.muted + ';padding-left:20px;margin:0;line-height:2">'
      + '<li>Ve a <a href="https://console.firebase.google.com/" target="_blank" style="color:#007AFF">console.firebase.google.com</a></li>'
      + '<li>Crea un proyecto (desactiva Analytics)</li>'
      + '<li><b>Compilaci\u00f3n \u2192 Realtime Database \u2192 Crear BD</b></li>'
      + '<li>Selecciona regi\u00f3n \u2192 <b>Modo de prueba</b></li>'
      + '<li>Copia la URL de arriba</li></ol>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Set URL value safely (no XSS)
    var urlInput = panel.querySelector('#dc-dburl');
    urlInput.value = savedUrl;

    // Set PIN value safely
    var pinInput = panel.querySelector('#dc-pin');
    pinInput.value = pin;

    // Events
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#dc-close-setup').addEventListener('click', function() { overlay.remove(); });

    panel.querySelector('#dc-save-config').addEventListener('click', async function() {
      var url = urlInput.value.trim();
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
        showToast('\u2705 Firebase conectado');
        overlay.remove();
        updateFabBadge();
      } else {
        connected = false;
        btn.textContent = '\uD83D\uDD17 Conectar';
        btn.disabled = false;
        showToast('\u274C No se pudo conectar. Verifica URL y reglas.', 5000);
      }
    });

    var clearBtn = panel.querySelector('#dc-clear-config');
    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        var ok = await dcConfirm('\u00bfDesconectar Firebase?\nLos datos locales NO se borran.', { icon: '\uD83D\uDD0C', confirmText: 'Desconectar', danger: true });
        if (!ok) return;
        localStorage.removeItem(DB_URL_KEY);
        localStorage.removeItem(LS_LEGACY_CONFIG);
        dbUrl = null;
        connected = false;
        overlay.remove();
        updateFabBadge();
        showToast('\uD83D\uDD0C Desconectado');
      });
    }

    // Clipboard (sin prompt fallback)
    var copyUrlBtn = panel.querySelector('#dc-copy-url');
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', function() {
        copyToClipboard(savedUrl).then(function() { showToast('\uD83D\uDCCB URL copiada'); });
      });
    }

    var shareBtn = panel.querySelector('#dc-share-url');
    if (shareBtn) {
      shareBtn.addEventListener('click', function() {
        if (navigator.share) {
          navigator.share({ title: 'DebtControl - Firebase URL', text: savedUrl }).catch(function() {});
        } else {
          copyToClipboard(savedUrl).then(function() { showToast('\uD83D\uDCCB URL copiada al portapapeles'); });
        }
      });
    }

    panel.querySelector('#dc-copy-id').addEventListener('click', function() {
      copyToClipboard(syncId).then(function() { showToast('\uD83D\uDCCB ID copiado'); });
    });

    panel.querySelector('#dc-change-id').addEventListener('click', async function() {
      var newId = await dcPrompt('Pega el ID del otro dispositivo para vincularlos:', { icon: '\uD83D\uDD17', placeholder: 'user_xxxxx...' });
      if (newId && newId.trim() && newId.trim() !== syncId) {
        localStorage.setItem(LS_SYNC_ID, newId.trim());
        syncUserId = newId.trim();
        showToast('\uD83D\uDD17 ID actualizado. Descarga los datos de la nube.');
        overlay.remove();
      }
    });

    panel.querySelector('#dc-save-pin').addEventListener('click', function() {
      var newPin = pinInput.value;
      localStorage.setItem(LS_SYNC_PIN, newPin);
      showToast(newPin ? '\uD83D\uDD12 PIN guardado' : '\uD83D\uDD13 PIN eliminado');
    });
  }

  // Clipboard helper (sin prompt fallback)
  function copyToClipboard(text) {
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      resolve();
    });
  }

  // ============================================================
  // Limpieza de datos huérfanos
  // ============================================================
  function cleanupOrphanData() {
    try {
      var now = new Date();
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.startsWith('debtcontrol_notified_')) {
          var dateStr = key.replace('debtcontrol_notified_', '');
          var keyDate = new Date(dateStr);
          if ((now - keyDate) > 7 * 24 * 60 * 60 * 1000) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
      if (keysToRemove.length > 0) console.log('[Cleanup] ' + keysToRemove.length + ' claves hu\u00e9rfanas eliminadas');
    } catch (e) {}
  }

  // ============================================================
  // Toggle de tema oscuro/claro
  // ============================================================
  function toggleTheme() {
    var html = document.documentElement;
    var current = html.getAttribute('data-theme');
    var newTheme = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('debtcontrol_theme', newTheme);
    applyMenuTheme();
    showToast(newTheme === 'dark' ? '\uD83C\uDF19 Modo oscuro' : '\u2600\uFE0F Modo claro');
  }

  function applySavedTheme() {
    var saved = localStorage.getItem('debtcontrol_theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  // ============================================================
  // Resumen financiero r\u00e1pido
  // ============================================================
  async function showFinancialSummary() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var debts = data.debts || [];
    var payments = data.payments || [];
    var savings = data.savings || [];
    var investments = data.investments || [];

    var totalDebt = debts.reduce(function(s, d) { return s + parseFloat(d.amount || d.totalAmount || d.monto || 0); }, 0);
    var totalPaid = payments.reduce(function(s, p) { return s + parseFloat(p.amount || p.monto || 0); }, 0);
    var totalSavings = savings.reduce(function(s, sv) { return s + parseFloat(sv.balance || sv.saldo || 0); }, 0);
    var totalInvestments = investments.reduce(function(s, iv) { return s + parseFloat(iv.amount || iv.monto || 0); }, 0);
    var netWorth = totalSavings + totalInvestments - totalDebt;

    var now = new Date(); now.setHours(0, 0, 0, 0);
    var nextDue = null;
    debts.forEach(function(d) {
      var dueStr = d.dueDate || d.fechaVencimiento || d.nextPaymentDate;
      if (!dueStr) return;
      var due = new Date(dueStr); due.setHours(0, 0, 0, 0);
      if (due >= now && (!nextDue || due < nextDue.date)) {
        nextDue = { date: due, name: d.name || d.nombre || 'Deuda', amount: parseFloat(d.monthlyPayment || d.cuota || d.amount || d.monto || 0) };
      }
    });

    var thisMonth = payments.filter(function(p) {
      var d = new Date(p.date || p.fecha || '');
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    var lastMonthDate = new Date(now); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    var lastMonth = payments.filter(function(p) {
      var d = new Date(p.date || p.fecha || '');
      return d.getMonth() === lastMonthDate.getMonth() && d.getFullYear() === lastMonthDate.getFullYear();
    });
    var thisMonthTotal = thisMonth.reduce(function(s, p) { return s + parseFloat(p.amount || p.monto || 0); }, 0);
    var lastMonthTotal = lastMonth.reduce(function(s, p) { return s + parseFloat(p.amount || p.monto || 0); }, 0);
    var trendIcon = thisMonthTotal >= lastMonthTotal ? '\uD83D\uDCC8' : '\uD83D\uDCC9';

    var overlay = createModalOverlay();
    var panel = document.createElement('div');
    Object.assign(panel.style, {
      background: t.bg, borderRadius: '20px', padding: '24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    panel.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDCCA Resumen Financiero</h2>'
      + '<button class="dc-summary-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button>'
      + '</div>'
      + '<div style="background:linear-gradient(135deg,#007AFF,#5856D6);border-radius:16px;padding:20px;color:#fff;margin-bottom:16px;text-align:center">'
      + '<div style="font-size:12px;opacity:0.8">Balance Neto</div>'
      + '<div style="font-size:28px;font-weight:700;margin:4px 0">' + (netWorth >= 0 ? '+' : '') + currency + formatNumber(netWorth) + '</div>'
      + '<div style="font-size:11px;opacity:0.6">Ahorros + Inversiones - Deudas</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px"><div style="font-size:11px;color:' + t.muted + '">Total Deudas</div><div style="font-size:18px;font-weight:700;color:#FF3B30">' + currency + formatNumber(totalDebt) + '</div><div style="font-size:11px;color:' + t.muted + '">' + debts.length + ' activa' + (debts.length !== 1 ? 's' : '') + '</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px"><div style="font-size:11px;color:' + t.muted + '">Total Pagado</div><div style="font-size:18px;font-weight:700;color:#34C759">' + currency + formatNumber(totalPaid) + '</div><div style="font-size:11px;color:' + t.muted + '">' + payments.length + ' pago' + (payments.length !== 1 ? 's' : '') + '</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px"><div style="font-size:11px;color:' + t.muted + '">Ahorros</div><div style="font-size:18px;font-weight:700;color:#007AFF">' + currency + formatNumber(totalSavings) + '</div><div style="font-size:11px;color:' + t.muted + '">' + savings.length + ' cuenta' + (savings.length !== 1 ? 's' : '') + '</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px"><div style="font-size:11px;color:' + t.muted + '">Inversiones</div><div style="font-size:18px;font-weight:700;color:#5856D6">' + currency + formatNumber(totalInvestments) + '</div><div style="font-size:11px;color:' + t.muted + '">' + investments.length + ' activa' + (investments.length !== 1 ? 's' : '') + '</div></div>'
      + '</div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">'
      + '<div><div style="font-size:11px;color:' + t.muted + '">Pagos este mes vs anterior</div><div style="font-size:16px;font-weight:600;margin-top:2px">' + currency + formatNumber(thisMonthTotal) + ' <span style="font-size:12px;color:' + t.muted + '">vs ' + currency + formatNumber(lastMonthTotal) + '</span></div></div>'
      + '<div style="font-size:28px">' + trendIcon + '</div></div>'
      + (nextDue ? '<div style="background:#FF950015;border:1px solid #FF9500;border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center">'
        + '<div><div style="font-size:11px;color:#FF9500;font-weight:600">Pr\u00f3ximo vencimiento</div><div style="font-size:14px;font-weight:600;margin-top:2px">' + escapeHtml(nextDue.name) + '</div></div>'
        + '<div style="text-align:right"><div style="font-size:16px;font-weight:700">' + currency + formatNumber(nextDue.amount) + '</div><div style="font-size:11px;color:' + t.muted + '">' + nextDue.date.toLocaleDateString('es-ES') + '</div></div></div>' : '');

    // Progreso visual por deuda
    if (debts.length > 0) {
      var progressHtml = '<div style="margin-top:12px"><div style="font-size:13px;font-weight:600;margin-bottom:8px">\uD83D\uDCC8 Progreso por Deuda</div>';
      debts.forEach(function(d) {
        var name = d.name || d.nombre || 'Deuda';
        var total = parseFloat(d.amount || d.totalAmount || d.monto || 0);
        if (total <= 0) return;
        var debtPayments = payments.filter(function(p) {
          return p.debtId === d.id || p.debtName === (d.name || d.nombre);
        });
        var paid = debtPayments.reduce(function(s, p) { return s + parseFloat(p.amount || p.monto || 0); }, 0);
        var pct = Math.min((paid / total) * 100, 100);
        var barColor = pct >= 100 ? '#34C759' : pct >= 50 ? '#007AFF' : '#FF9500';
        progressHtml += '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px 12px;margin-bottom:6px">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
          + '<span style="font-size:12px;font-weight:500">' + escapeHtml(name) + '</span>'
          + '<span style="font-size:11px;color:' + t.muted + '">' + pct.toFixed(0) + '% \u2022 ' + currency + formatNumber(paid) + '/' + currency + formatNumber(total) + '</span></div>'
          + '<div style="background:' + t.border + ';border-radius:4px;height:8px;overflow:hidden">'
          + '<div style="width:' + pct + '%;height:100%;background:' + barColor + ';border-radius:4px;transition:width 0.3s"></div></div></div>';
      });
      progressHtml += '</div>';
      panel.innerHTML += progressHtml;
    }

    panel.innerHTML += '<button class="dc-summary-close2" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:16px">Cerrar</button>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    panel.querySelector('.dc-summary-close').addEventListener('click', function() { overlay.remove(); });
    panel.querySelector('.dc-summary-close2').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ============================================================
  // Calculadora de amortizaci\u00f3n
  // ============================================================
  function showAmortizationCalc() {
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '420px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;box-sizing:border-box;margin-top:6px;outline:none;';
    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83E\uDDEE Calculadora Amortizaci\u00f3n</h2>'
      + '<button class="dc-amort-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button>'
      + '</div>'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Monto del pr\u00e9stamo (' + getCurrency() + ')</label>'
      + '<input class="dc-amort-amount" type="number" placeholder="10000" style="' + iSt + '">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + ';display:block;margin-top:12px">Tasa de inter\u00e9s anual (%)</label>'
      + '<input class="dc-amort-rate" type="number" placeholder="12" step="0.1" style="' + iSt + '">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + ';display:block;margin-top:12px">Plazo (meses)</label>'
      + '<input class="dc-amort-term" type="number" placeholder="24" style="' + iSt + '">'
      + '<button class="dc-amort-calc" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px">\uD83E\uDDEE Calcular</button>'
      + '<div class="dc-amort-result" style="margin-top:16px"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-amort-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    card.querySelector('.dc-amort-calc').addEventListener('click', function() {
      var amount = parseFloat(card.querySelector('.dc-amort-amount').value);
      var annualRate = parseFloat(card.querySelector('.dc-amort-rate').value);
      var months = parseInt(card.querySelector('.dc-amort-term').value);
      if (!amount || !annualRate || !months || amount <= 0 || annualRate <= 0 || months <= 0) {
        showToast('\u26A0\uFE0F Completa todos los campos');
        return;
      }

      var monthlyRate = annualRate / 100 / 12;
      var payment = amount * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
      var totalPaid = payment * months;
      var totalInterest = totalPaid - amount;
      var currency = getCurrency();

      var html = ''
        + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:16px;margin-bottom:12px">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
        + '<div><div style="font-size:11px;color:' + t.muted + '">Cuota mensual</div><div style="font-size:20px;font-weight:700;color:#007AFF">' + currency + formatNumber(payment) + '</div></div>'
        + '<div><div style="font-size:11px;color:' + t.muted + '">Total a pagar</div><div style="font-size:20px;font-weight:700">' + currency + formatNumber(totalPaid) + '</div></div>'
        + '<div><div style="font-size:11px;color:' + t.muted + '">Total intereses</div><div style="font-size:20px;font-weight:700;color:#FF3B30">' + currency + formatNumber(totalInterest) + '</div></div>'
        + '<div><div style="font-size:11px;color:' + t.muted + '">% Inter\u00e9s/Capital</div><div style="font-size:20px;font-weight:700">' + (totalInterest / amount * 100).toFixed(1) + '%</div></div>'
        + '</div></div>';

      html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px">Tabla de amortizaci\u00f3n</div>';
      html += '<div style="max-height:200px;overflow-y:auto">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<tr style="background:' + t.inputBg + '"><th style="padding:6px;text-align:left">#</th><th style="padding:6px;text-align:right">Cuota</th><th style="padding:6px;text-align:right">Capital</th><th style="padding:6px;text-align:right">Inter\u00e9s</th><th style="padding:6px;text-align:right">Saldo</th></tr>';
      var balance = amount;
      for (var i = 1; i <= months; i++) {
        var interest = balance * monthlyRate;
        var principal = payment - interest;
        balance -= principal;
        if (balance < 0) balance = 0;
        html += '<tr style="border-bottom:1px solid ' + t.border + '"><td style="padding:5px">' + i + '</td><td style="padding:5px;text-align:right">' + currency + formatNumber(payment) + '</td><td style="padding:5px;text-align:right">' + currency + formatNumber(principal) + '</td><td style="padding:5px;text-align:right">' + currency + formatNumber(interest) + '</td><td style="padding:5px;text-align:right">' + currency + formatNumber(balance) + '</td></tr>';
      }
      html += '</table></div>';

      // Botón copiar tabla
      html += '<button class="dc-amort-copy" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:10px;background:transparent;color:' + t.txt + ';font-size:13px;cursor:pointer;margin-top:10px">\uD83D\uDCCB Copiar Tabla al Portapapeles</button>';

      card.querySelector('.dc-amort-result').innerHTML = html;

      // Generar texto plano para copiar
      card.querySelector('.dc-amort-copy').addEventListener('click', function() {
        var lines = ['# Amortización - ' + currency + formatNumber(amount) + ' al ' + annualRate + '% en ' + months + ' meses'];
        lines.push('Cuota mensual: ' + currency + formatNumber(payment));
        lines.push('Total a pagar: ' + currency + formatNumber(totalPaid));
        lines.push('Total intereses: ' + currency + formatNumber(totalInterest));
        lines.push('');
        lines.push('#\tCuota\tCapital\tInterés\tSaldo');
        var bal2 = amount;
        for (var j = 1; j <= months; j++) {
          var int2 = bal2 * monthlyRate;
          var prin2 = payment - int2;
          bal2 -= prin2;
          if (bal2 < 0) bal2 = 0;
          lines.push(j + '\t' + currency + formatNumber(payment) + '\t' + currency + formatNumber(prin2) + '\t' + currency + formatNumber(int2) + '\t' + currency + formatNumber(bal2));
        }
        copyToClipboard(lines.join('\n')).then(function() { showToast('\uD83D\uDCCB Tabla copiada'); });
      });
    });
  }

  // ============================================================
  // Estrategia de pago: Snowball vs Avalanche
  // ============================================================
  async function showDebtStrategy() {
    var data = await getAllLocalData();
    var debts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    });
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '24px', maxWidth: '440px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var currency = getCurrency();
    var iSt = 'width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;box-sizing:border-box;margin-top:6px;outline:none;';

    if (debts.length < 2) {
      card.innerHTML = '<div style="text-align:center;padding:20px">'
        + '<div style="font-size:48px;margin-bottom:12px">\u2696\uFE0F</div>'
        + '<h2 style="margin:0 0 8px 0;font-size:18px">Estrategia de Pago</h2>'
        + '<p style="color:' + t.muted + ';font-size:14px">Necesitas al menos 2 deudas activas para comparar estrategias Snowball vs Avalanche.</p>'
        + '<button class="dc-strat-close" style="padding:12px 24px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:12px">Cerrar</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      card.querySelector('.dc-strat-close').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      return;
    }

    var debtsHtml = debts.map(function(d, idx) {
      var name = d.name || d.nombre || 'Deuda ' + (idx + 1);
      var amount = parseFloat(d.amount || d.totalAmount || d.monto || 0);
      var rate = parseFloat(d.interestRate || d.tasaInteres || 0);
      var minPay = parseFloat(d.monthlyPayment || d.cuota || d.minimumPayment || 0);
      return '<div style="background:' + t.inputBg + ';border-radius:8px;padding:8px 10px;margin-bottom:4px;display:flex;justify-content:space-between;font-size:12px">'
        + '<span>' + escapeHtml(name) + '</span>'
        + '<span>' + currency + formatNumber(amount) + ' | ' + rate + '% | ' + currency + formatNumber(minPay) + '/mes</span></div>';
    }).join('');

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\u2696\uFE0F Snowball vs Avalanche</h2>'
      + '<button class="dc-strat-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="margin-bottom:12px"><div style="font-size:13px;font-weight:600;margin-bottom:6px">Tus deudas:</div>' + debtsHtml + '</div>'
      + '<div style="background:#007AFF15;border-radius:12px;padding:14px;margin-bottom:16px;font-size:12px;color:' + t.muted + ';line-height:1.5">'
      + '<b>\u2744\uFE0F Snowball:</b> Paga primero la m\u00e1s peque\u00f1a (motivaci\u00f3n)<br>'
      + '<b>\uD83C\uDFD4\uFE0F Avalanche:</b> Paga primero la de mayor inter\u00e9s (ahorra m\u00e1s)</div>'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Pago extra mensual (' + currency + ')</label>'
      + '<input class="dc-strat-extra" type="number" placeholder="0" value="0" style="' + iSt + '">'
      + '<button class="dc-strat-calc" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:12px">\u2696\uFE0F Comparar</button>'
      + '<div class="dc-strat-result" style="margin-top:16px"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-strat-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    card.querySelector('.dc-strat-calc').addEventListener('click', function() {
      var extra = parseFloat(card.querySelector('.dc-strat-extra').value) || 0;
      var debtList = debts.map(function(d) {
        return {
          name: d.name || d.nombre || 'Deuda',
          balance: parseFloat(d.amount || d.totalAmount || d.monto || 0),
          rate: parseFloat(d.interestRate || d.tasaInteres || 0),
          minPayment: parseFloat(d.monthlyPayment || d.cuota || d.minimumPayment || 0) || parseFloat(d.amount || d.totalAmount || d.monto || 0) * 0.03
        };
      });

      function simulate(strategy) {
        var ds = debtList.map(function(d) { return { balance: d.balance, rate: d.rate, minPayment: d.minPayment }; });
        if (strategy === 'snowball') ds.sort(function(a, b) { return a.balance - b.balance; });
        else ds.sort(function(a, b) { return b.rate - a.rate; });
        var months = 0, totalPaid = 0, totalInterest = 0;
        while (months < 600 && ds.some(function(d) { return d.balance > 0.01; })) {
          months++;
          for (var i = 0; i < ds.length; i++) {
            if (ds[i].balance <= 0) continue;
            var interest = ds[i].balance * (ds[i].rate / 100 / 12);
            ds[i].balance += interest;
            totalInterest += interest;
          }
          var avail = extra;
          for (var i = 0; i < ds.length; i++) {
            if (ds[i].balance <= 0) { avail += ds[i].minPayment; continue; }
            var pay = Math.min(ds[i].minPayment, ds[i].balance);
            ds[i].balance -= pay; totalPaid += pay;
          }
          for (var i = 0; i < ds.length; i++) {
            if (ds[i].balance <= 0 || avail <= 0) continue;
            var pay = Math.min(avail, ds[i].balance);
            ds[i].balance -= pay; totalPaid += pay; avail -= pay;
          }
        }
        return { months: months, totalPaid: totalPaid, totalInterest: totalInterest };
      }

      var snowball = simulate('snowball');
      var avalanche = simulate('avalanche');
      var winner = avalanche.totalInterest <= snowball.totalInterest ? 'avalanche' : 'snowball';
      var saved = Math.abs(snowball.totalInterest - avalanche.totalInterest);
      var monthsDiff = Math.abs(snowball.months - avalanche.months);

      var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'
        + '<div style="background:' + (winner === 'snowball' ? '#34C75920' : t.inputBg) + ';border:2px solid ' + (winner === 'snowball' ? '#34C759' : 'transparent') + ';border-radius:12px;padding:14px;text-align:center">'
        + '<div style="font-size:24px">\u2744\uFE0F</div><div style="font-size:14px;font-weight:700">Snowball</div>'
        + '<div style="font-size:11px;color:' + t.muted + ';margin-top:8px">' + snowball.months + ' meses</div>'
        + '<div style="font-size:13px;font-weight:600">' + currency + formatNumber(snowball.totalPaid) + '</div>'
        + '<div style="font-size:11px;color:#FF3B30">Inter\u00e9s: ' + currency + formatNumber(snowball.totalInterest) + '</div></div>'
        + '<div style="background:' + (winner === 'avalanche' ? '#34C75920' : t.inputBg) + ';border:2px solid ' + (winner === 'avalanche' ? '#34C759' : 'transparent') + ';border-radius:12px;padding:14px;text-align:center">'
        + '<div style="font-size:24px">\uD83C\uDFD4\uFE0F</div><div style="font-size:14px;font-weight:700">Avalanche</div>'
        + '<div style="font-size:11px;color:' + t.muted + ';margin-top:8px">' + avalanche.months + ' meses</div>'
        + '<div style="font-size:13px;font-weight:600">' + currency + formatNumber(avalanche.totalPaid) + '</div>'
        + '<div style="font-size:11px;color:#FF3B30">Inter\u00e9s: ' + currency + formatNumber(avalanche.totalInterest) + '</div></div></div>';

      if (saved > 0.01) {
        html += '<div style="background:#34C75920;border-radius:12px;padding:12px;text-align:center">'
          + '<div style="font-size:13px;font-weight:600">\uD83C\uDFC6 ' + (winner === 'avalanche' ? 'Avalanche' : 'Snowball') + ' te ahorra</div>'
          + '<div style="font-size:20px;font-weight:700;color:#34C759;margin:4px 0">' + currency + formatNumber(saved) + '</div>'
          + (monthsDiff > 0 ? '<div style="font-size:12px;color:' + t.muted + '">y ' + monthsDiff + ' mes' + (monthsDiff !== 1 ? 'es' : '') + ' menos</div>' : '') + '</div>';
      } else {
        html += '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;text-align:center;font-size:13px;color:' + t.muted + '">Ambas estrategias dan resultado similar.</div>';
      }

      card.querySelector('.dc-strat-result').innerHTML = html;
    });
  }

  // ============================================================
  // Configuraci\u00f3n biom\u00e9trica (UI)
  // ============================================================
  async function showBiometricConfig() {
    var guard = window.DebtControlGuard;
    if (!guard || !guard.isWebAuthnAvailable || !guard.isWebAuthnAvailable()) {
      showToast('\u274C Tu dispositivo no soporta autenticaci\u00f3n biom\u00e9trica');
      return;
    }
    var hasBio = guard.hasBiometric ? guard.hasBiometric() : false;
    var t = getThemeColors();
    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '380px',
      width: '100%', color: t.txt, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center'
    });

    card.innerHTML = ''
      + '<div style="font-size:48px;margin-bottom:12px">\uD83D\uDD10</div>'
      + '<h2 style="margin:0 0 8px 0;font-size:18px">Autenticaci\u00f3n Biom\u00e9trica</h2>'
      + '<p style="font-size:13px;color:' + t.muted + ';margin:0 0 20px 0">Usa huella dactilar o reconocimiento facial para desbloquear la app.</p>'
      + '<div style="background:' + (hasBio ? '#34C75920' : t.inputBg) + ';border-radius:12px;padding:16px;margin-bottom:16px">'
      + '<div style="font-size:14px;font-weight:600">' + (hasBio ? '\uD83D\uDFE2 Biometr\u00eda activada' : '\uD83D\uDD34 No configurada') + '</div></div>'
      + (hasBio
        ? '<button class="dc-bio-remove" style="width:100%;padding:14px;border:1px solid #FF3B30;border-radius:12px;background:transparent;color:#FF3B30;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px">\uD83D\uDDD1\uFE0F Desactivar</button>'
        : '<button class="dc-bio-register" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px">\uD83D\uDD10 Activar Biometr\u00eda</button>')
      + '<button class="dc-bio-close" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer">Cerrar</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-bio-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    var regBtn = card.querySelector('.dc-bio-register');
    if (regBtn) {
      regBtn.addEventListener('click', async function() {
        regBtn.textContent = '\u23F3 Configurando...';
        regBtn.disabled = true;
        var ok = await guard.registerBiometric();
        if (ok) { showToast('\u2705 Biometr\u00eda activada'); overlay.remove(); }
        else { showToast('\u274C Error al configurar'); regBtn.textContent = '\uD83D\uDD10 Activar Biometr\u00eda'; regBtn.disabled = false; }
      });
    }

    var rmBtn = card.querySelector('.dc-bio-remove');
    if (rmBtn) {
      rmBtn.addEventListener('click', async function() {
        var ok = await dcConfirm('\u00bfDesactivar biometr\u00eda?', { icon: '\uD83D\uDD10', confirmText: 'Desactivar', danger: true });
        if (ok && guard.removeBiometric) { guard.removeBiometric(); showToast('\u2705 Desactivada'); overlay.remove(); }
      });
    }
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
    style.textContent = ''
      + '@keyframes dcToastIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}'
      + '@keyframes dcFadeIn{from{opacity:0}to{opacity:1}}'
      + '#dc-sync-fab:active{transform:scale(0.9)!important}'
      + '#dc-sync-menu button:active{background:rgba(0,122,255,0.1)!important}'
      + '#dc-sync-menu{scrollbar-width:thin}';
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
      position: 'fixed', right: '16px',
      borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
      zIndex: '9997', display: 'none', overflow: 'hidden auto', minWidth: '250px',
      maxHeight: '70vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    var items = [
      { header: '\uD83D\uDCC1 Archivo' },
      { icon: '\uD83D\uDCE5', label: 'Exportar Backup (JSON)', action: exportToJSON },
      { icon: '\uD83D\uDCC4', label: 'Exportar Reporte PDF', action: exportToPDF },
      { icon: '\uD83D\uDCCA', label: 'Exportar CSV (Excel)', action: exportToCSV },
      { icon: '\uD83D\uDCE4', label: 'Importar Backup (JSON)', action: importFromJSON },
      { sep: true },
      { header: '\u2601\uFE0F Nube' },
      { icon: '\u2B06\uFE0F', label: 'Subir a la Nube', action: syncToCloud },
      { icon: '\u2B07\uFE0F', label: 'Descargar de la Nube', action: syncFromCloud },
      { icon: '\u23EA', label: 'Revertir \u00faltimo Sync', action: restorePreSyncSnapshot },
      { sep: true },
      { header: '\uD83D\uDCC5 Planificaci\u00f3n' },
      { icon: '\uD83D\uDCC5', label: 'Calendario de Pagos', action: showCalendar },
      { icon: '\uD83D\uDD14', label: 'Notificaciones', action: showNotificationConfig },
      { icon: '\uD83D\uDCB1', label: 'Moneda', action: showCurrencyConfig },
      { sep: true },
      { header: '\uD83D\uDCCA Herramientas' },
      { icon: '\uD83D\uDCCA', label: 'Resumen Financiero', action: showFinancialSummary },
      { icon: '\uD83E\uDDEE', label: 'Calculadora Amortizaci\u00f3n', action: showAmortizationCalc },
      { icon: '\u2696\uFE0F', label: 'Snowball vs Avalanche', action: showDebtStrategy },
      { icon: '\uD83D\uDCC9', label: 'Ratio Deuda/Ingreso', action: showDTICalculator },
      { icon: '\uD83C\uDFC1', label: 'Fecha Libre de Deudas', action: showDebtFreeDate },
      { icon: '\uD83D\uDD0D', label: 'Comparar Pr\u00e9stamos', action: showLoanComparator },
      { icon: '\uD83D\uDCCA', label: 'Desglose por Categor\u00eda', action: showCategoryBreakdown },
      { icon: '\uD83E\uDD1D', label: 'Convenio de Pago', action: showPaymentAgreement },
      { sep: true },
      { header: '\u2699\uFE0F Ajustes' },
      { icon: '\u2699\uFE0F', label: 'Configurar Firebase', action: showFirebaseSetup },
      { icon: '\uD83D\uDCCB', label: 'Historial de Sync', action: showSyncHistory },
      { icon: '\uD83D\uDD12', label: 'Cambiar C\u00f3digo de Acceso', action: function() { if (window.DebtControlGuard) window.DebtControlGuard.changeCode(); else showToast('Guard no disponible'); } },
      { icon: '\u23F0', label: 'Duraci\u00f3n de Sesi\u00f3n', action: showSessionConfig },
      { icon: '\uD83C\uDF19', label: 'Cambiar Tema', action: toggleTheme },
      { icon: '\uD83D\uDD10', label: 'Biometr\u00eda', action: showBiometricConfig },
      { sep: true }
    ];

    items.push({ icon: '\uD83D\uDCF2', label: 'Instalar App', action: installApp });
    items.push({ icon: '\u2139\uFE0F', label: 'Acerca de', action: showAbout });
    items.push({ icon: '\uD83D\uDD10', label: 'Bloquear App', action: function() { if (window.DebtControlGuard) window.DebtControlGuard.lock(); else { localStorage.removeItem('debtcontrol_auth_session'); location.reload(); } } });
    items.push({ icon: '\uD83D\uDEAA', label: 'Cerrar Sesi\u00f3n', action: function() { if (window.DebtControlGuard) window.DebtControlGuard.logout(); else { localStorage.removeItem('debtcontrol_auth_session'); location.reload(); } } });

    items.forEach(function(item) {
      if (item.sep) {
        var s = document.createElement('div');
        s.className = 'dc-sep';
        Object.assign(s.style, { height: '1px', margin: '0' });
        menu.appendChild(s);
        return;
      }
      if (item.header) {
        var h = document.createElement('div');
        h.className = 'dc-menu-header';
        h.textContent = item.header;
        Object.assign(h.style, {
          padding: '8px 16px 4px 16px', fontSize: '11px', fontWeight: '700',
          textTransform: 'uppercase', letterSpacing: '0.5px', opacity: '0.5'
        });
        menu.appendChild(h);
        return;
      }
      var btn = document.createElement('button');
      btn.innerHTML = '<span style="margin-right:10px;font-size:18px">' + item.icon + '</span>' + item.label;
      Object.assign(btn.style, {
        display: 'flex', alignItems: 'center', width: '100%', padding: '13px 16px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: '14px', fontWeight: '500', textAlign: 'left', transition: 'background 0.12s',
        whiteSpace: 'nowrap'
      });
      btn.addEventListener('click', function() { if (navigator.vibrate) navigator.vibrate(10); toggleMenu(); item.action(); });
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

    // Tecla Escape para cerrar modales + Accesos rápidos de teclado
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var overlays = document.querySelectorAll('.dc-modal-overlay, #dc-calendar-overlay, #dc-setup-overlay, #dc-change-code-modal');
        if (overlays.length > 0) {
          overlays[overlays.length - 1].remove();
        } else {
          var menu = document.getElementById('dc-sync-menu');
          if (menu && menu.style.display !== 'none') menu.style.display = 'none';
        }
        return;
      }
      // Accesos rápidos (Ctrl/Cmd + tecla) — solo si no hay modal/input abierto
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        var tag = (document.activeElement || {}).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        var hasModal = document.querySelector('.dc-modal-overlay, #dc-calendar-overlay, #dc-setup-overlay, #dc-change-code-modal');
        if (hasModal) return;
        var key = e.key.toLowerCase();
        var shortcut = {
          'e': exportToJSON,        // Ctrl+E → Exportar JSON
          'p': exportToPDF,         // Ctrl+P → PDF (nuestro, no del navegador)
          'u': syncToCloud,         // Ctrl+U → Upload (Subir)
          'd': syncFromCloud,       // Ctrl+D → Download (Descargar)
          'f': showFinancialSummary,// Ctrl+F → Resumen Financiero
          'k': showCalendar         // Ctrl+K → Calendario
        };
        if (shortcut[key]) {
          e.preventDefault();
          if (navigator.vibrate) navigator.vibrate(10);
          shortcut[key]();
        }
      }
    });
  }

  function applyMenuTheme() {
    var menu = document.getElementById('dc-sync-menu');
    if (!menu) return;
    var isDark = isDarkMode();
    menu.style.background = isDark ? '#16213e' : '#fff';
    menu.querySelectorAll('button').forEach(function(b) { b.style.color = isDark ? '#fff' : '#333'; });
    menu.querySelectorAll('.dc-sep').forEach(function(s) { s.style.background = isDark ? '#2d3748' : '#e9ecef'; });
    menu.querySelectorAll('.dc-menu-header').forEach(function(h) { h.style.color = isDark ? '#8899aa' : '#666'; });
  }

  function toggleMenu() {
    var m = document.getElementById('dc-sync-menu');
    if (!m) return;
    if (m.style.display === 'none' || !m.style.display) {
      // Mostrar fuera de pantalla para medir altura real
      m.style.visibility = 'hidden';
      m.style.display = 'block';
      var menuH = m.scrollHeight;
      m.style.visibility = '';

      var fab = document.getElementById('dc-sync-fab');
      var fabRect = fab.getBoundingClientRect();
      var viewH = window.innerHeight;
      menuH = Math.min(menuH, viewH * 0.7);

      var bottom = viewH - fabRect.top + 8;
      if (bottom + menuH > viewH - 20) {
        m.style.bottom = 'auto';
        m.style.top = Math.max(10, (viewH - menuH) / 2) + 'px';
      } else {
        m.style.top = 'auto';
        m.style.bottom = bottom + 'px';
      }
    } else {
      m.style.display = 'none';
    }
  }

  // ============================================================
  // Auto-backup local (fix: tamaño controlado)
  // ============================================================
  function setupAutoBackup() {
    setInterval(async function() {
      try {
        var data = await getAllLocalData();
        var hasData = Object.values(data).some(function(v) { return v && (Array.isArray(v) ? v.length > 0 : true); });
        if (!hasData) return;
        var json = JSON.stringify({ data: data, ts: new Date().toISOString() });
        // Solo guardar si es menor a 2MB (evitar saturar localStorage)
        if (json.length < 2 * 1024 * 1024) {
          localStorage.setItem(LS_AUTO_BACKUP, json);
        }
      } catch (e) {}
    }, 5 * 60 * 1000);
  }

  // ============================================================
  // Auto-sync al reconectarse
  // ============================================================
  function isAutoSyncEnabled() {
    return localStorage.getItem(LS_AUTO_SYNC_ENABLED) !== 'false';
  }

  function setupAutoSync() {
    window.addEventListener('online', async function() {
      if (connected && localStorage.getItem(LS_LAST_SYNC) && isAutoSyncEnabled()) {
        await new Promise(function(r) { setTimeout(r, 3000); });
        if (navigator.onLine && connected) {
          try {
            var remote = await restGet('users/' + getSyncId() + '/data/_lastSync');
            var localSync = localStorage.getItem(LS_LAST_SYNC);
            if (remote && localSync && new Date(remote) > new Date(localSync)) {
              showToast('\u26A0\uFE0F Datos m\u00e1s recientes en la nube. Descarga primero.', 5000);
              return;
            }
          } catch (e) {}
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

    applySavedTheme();
    cleanupOrphanData();

    dbUrl = getDbUrl();
    if (dbUrl) {
      connected = await testConnection();
      getSyncId();
    }

    createSyncUI();
    setupAutoBackup();
    setupAutoSync();
    applyCurrencyToDOM();

    // Verificar vencimientos
    setTimeout(checkDueDates, 5000);
    // Re-check cada 4 horas
    setInterval(checkDueDates, 4 * 60 * 60 * 1000);

    console.log('[CloudSync] v' + SYNC_VERSION + ' | Firebase:', connected ? '\u2705' : '\u274C', '| Moneda:', getCurrency());
  }

  init();
})();

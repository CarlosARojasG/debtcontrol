/**
 * DebtControl Pro - Cloud Sync Module v7.2.1
 * SincronizaciÃ³n + herramientas financieras
 *
 * v7.0 cambios:
 * - Fix applyCurrencyToDOM: $ en regex replace ya no corrompe sÃ­mbolos multi-carÃ¡cter
 * - Fix PDF: rendimiento 0% ya no muestra como '-'
 * - Fix notificaciones: ahora avisa el mismo dÃ­a del vencimiento (dÃ­a 0)
 * - Fix DTI: porcentaje disponible negativo se muestra correctamente
 * - MenÃº con tÃ­tulos de secciÃ³n (Archivo, Nube, PlanificaciÃ³n, Herramientas, Ajustes)
 * - CSV export incluye recordatorios (reminders)
 * - Historial de sync con botÃ³n Limpiar
 * - Calendario muestra recordatorios con indicador morado
 * - Calculadora amortizaciÃ³n: botÃ³n Copiar tabla al portapapeles
 * - Calculadora Fecha Libre de Deudas (proyecciÃ³n + pago extra)
 * - Comparador de PrÃ©stamos (lado a lado)
 * - Desglose de deudas por CategorÃ­a (barras + porcentajes)
 * - Accesos rÃ¡pidos de teclado (Ctrl+E/P/U/D/F/K)
 *
 * v6.0 cambios:
 * - Exportar a CSV para Excel/Sheets
 * - Snapshot pre-sync con opciÃ³n de revertir (undo)
 * - Calculadora ratio Deuda/Ingreso (DTI)
 * - Progreso visual por deuda en resumen financiero
 * - Pantalla "Acerca de" con changelog
 * - Auto-sync configurable (on/off)
 * - PDF incluye tabla de inversiones
 * - Backup JSON incluye preferencias del usuario
 * - Cambio de moneda actualiza todo el DOM (prevâ†’nuevo)
 * - Fix tema oscuro respeta preferencia del sistema
 * - Fix posicionamiento del menÃº (scrollHeight)
 * - Fix formatNumber(NaN) â†’ muestra 0
 * - Fix escapeAttr no escapaba &
 * - testConnection usa GET en vez de PUT
 *
 * v5.0 cambios:
 * - Resumen financiero, calculadora amortizaciÃ³n, Snowball/Avalanche
 * - Toggle tema oscuro/claro manual
 * - AutenticaciÃ³n biomÃ©trica (WebAuthn)
 * - Limpieza automÃ¡tica datos huÃ©rfanos
 * - Fix moneda multi-carÃ¡cter, toast tema, notif dÃ­as, auto-sync
 * - Tecla Escape cierra modales, haptic feedback
 */

(function() {
  'use strict';

  // ============================================================
  // Constantes
  // ============================================================
  var SYNC_KEYS = ['debts', 'payments', 'reminders', 'investments', 'savings', 'userStats'];
  var SYNC_VERSION = '7.2.1';
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
  var LS_ACHIEVEMENTS = 'debtcontrol_achievements';
  var LS_PAID_DEBTS = 'debtcontrol_paid_debts';
  var LS_RECURRING_BILLS = 'debtcontrol_recurring_bills';
  var LS_RECURRING_RECORDS = 'debtcontrol_recurring_records';
  var LS_RECURRING_CHECKED = 'debtcontrol_recurring_checked';

  var dbUrl = null;
  var connected = false;
  var syncUserId = null;

  // ============================================================
  // DB URL management + migraciÃ³n v2.x
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
    // Construir regex que busca el sÃ­mbolo anterior O $ seguido de dÃ­gito
    var escPrev = prevCurrencySymbol ? prevCurrencySymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;

    function replaceCurrency(node) {
      if (replacing) return;
      if (node.nodeType === 3) { // text node
        var text = node.textContent;
        var replaced = text;
        // Reemplazar $ seguido de nÃºmero, solo si $ no estÃ¡ precedido por letra
        // Usar funciÃ³n para evitar que $ en sym se interprete como referencia regex
        replaced = replaced.replace(/(^|[^A-Za-z])\$(\d)/g, function(_, pre, digit) { return pre + sym + digit; });
        // Si hay sÃ­mbolo previo diferente, reemplazarlo tambiÃ©n
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

  // Nombre de deuda: React usa 'creditor', cloud-sync legacy usa 'name'/'nombre'
  function dn(d) { return d.creditor || d.name || d.nombre || ''; }

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
      // Datos en localStorage (recurrentes + gamificación)
      data._recurringBills = localStorage.getItem(LS_RECURRING_BILLS) || '[]';
      data._recurringRecords = localStorage.getItem(LS_RECURRING_RECORDS) || '{}';
      data._achievements = localStorage.getItem(LS_ACHIEVEMENTS) || '[]';
      data._paidDebts = localStorage.getItem(LS_PAID_DEBTS) || '[]';
      data._debtPlans = localStorage.getItem(LS_DEBT_PLANS) || '{}';
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
        // Restaurar datos recurrentes y gamificación
        if (data._recurringBills) localStorage.setItem(LS_RECURRING_BILLS, data._recurringBills);
        if (data._recurringRecords) localStorage.setItem(LS_RECURRING_RECORDS, data._recurringRecords);
        if (data._achievements) localStorage.setItem(LS_ACHIEVEMENTS, data._achievements);
        if (data._paidDebts) localStorage.setItem(LS_PAID_DEBTS, data._paidDebts);
        if (data._debtPlans) localStorage.setItem(LS_DEBT_PLANS, data._debtPlans);
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
            '"' + dn(d).replace(/"/g, '""') + '"',
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

      // Pagos Recurrentes
      var recurringBills = [];
      try { recurringBills = JSON.parse(localStorage.getItem(LS_RECURRING_BILLS) || '[]'); } catch(e) {}
      var recurringRecords = {};
      try { recurringRecords = JSON.parse(localStorage.getItem(LS_RECURRING_RECORDS) || '{}'); } catch(e) {}
      if (recurringBills.length > 0) {
        lines.push('');
        lines.push('=== PAGOS RECURRENTES ===');
        lines.push('Servicio,Categor\u00eda,Monto Estimado,Activo');
        recurringBills.forEach(function(bill) {
          lines.push([
            '"' + (bill.name || '').replace(/"/g, '""') + '"',
            '"' + (bill.category || '').replace(/"/g, '""') + '"',
            parseFloat(bill.estimatedAmount || 0),
            bill.active !== false ? 'S\u00ed' : 'No'
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
      var lsData = {
        recurringBills: localStorage.getItem(LS_RECURRING_BILLS) || '[]',
        recurringRecords: localStorage.getItem(LS_RECURRING_RECORDS) || '{}',
        achievements: localStorage.getItem(LS_ACHIEVEMENTS) || '[]',
        paidDebts: localStorage.getItem(LS_PAID_DEBTS) || '[]',
        debtPlans: localStorage.getItem(LS_DEBT_PLANS) || '{}'
      };
      var json = JSON.stringify({ data: data, lsData: lsData, ts: new Date().toISOString() });
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
      // Restaurar datos localStorage del snapshot
      if (snapshot.lsData) {
        if (snapshot.lsData.recurringBills) localStorage.setItem(LS_RECURRING_BILLS, snapshot.lsData.recurringBills);
        if (snapshot.lsData.recurringRecords) localStorage.setItem(LS_RECURRING_RECORDS, snapshot.lsData.recurringRecords);
        if (snapshot.lsData.achievements) localStorage.setItem(LS_ACHIEVEMENTS, snapshot.lsData.achievements);
        if (snapshot.lsData.paidDebts) localStorage.setItem(LS_PAID_DEBTS, snapshot.lsData.paidDebts);
        if (snapshot.lsData.debtPlans) localStorage.setItem(LS_DEBT_PLANS, snapshot.lsData.debtPlans);
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
      + '\u2022 Sistema de Logros, XP y motivaci\u00f3n<br>'
      + '\u2022 Registro de deudas liquidadas (activas + hist\u00f3ricas)<br>'
      + '\u2022 Historial agrupado por entidad, tipo y estado<br>'
      + '\u2022 Pagos recurrentes con recordatorio mensual<br>'
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

    // Calcular pagos mensuales promedio de los Ãºltimos 6 meses
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

      // SimulaciÃ³n simplificada (promedio de tasas)
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

      // ComparaciÃ³n con y sin extra
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
  // Comparador de PrÃ©stamos
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
  // Resumen por CategorÃ­a
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

    // Agrupar por categorÃ­a
    var categories = {};
    var totalDebt = 0;
    debts.forEach(function(d) {
      var cat = d.category || d.categoria || 'Sin categor\u00eda';
      var amount = parseFloat(d.amount || d.totalAmount || d.monto || 0);
      totalDebt += amount;
      if (!categories[cat]) categories[cat] = { total: 0, count: 0, debts: [] };
      categories[cat].total += amount;
      categories[cat].count++;
      categories[cat].debts.push({ name: dn(d) || 'Deuda', amount: amount });
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

    // Barra de composiciÃ³n horizontal
    html += '<div style="display:flex;border-radius:8px;overflow:hidden;height:24px;margin-bottom:16px">';
    sorted.forEach(function(cat, idx) {
      var pct = (categories[cat].total / totalDebt) * 100;
      var color = colors[idx % colors.length];
      html += '<div title="' + escapeAttr(cat) + ': ' + pct.toFixed(1) + '%" style="width:' + pct + '%;background:' + color + ';min-width:2px"></div>';
    });
    html += '</div>';

    // Detalle por categorÃ­a
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
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    var debts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    });

    // Clasificar deudas: vencidas vs al corriente
    var overdueDebts = [];
    var currentDebts = [];
    debts.forEach(function(d, idx) {
      var dueStr = d.dueDate || d.fechaVencimiento || d.nextPaymentDate || null;
      var isOverdue = false;
      var daysLate = 0;
      if (dueStr) {
        var due = new Date(dueStr);
        due.setHours(0, 0, 0, 0);
        daysLate = Math.round((now - due) / (1000 * 60 * 60 * 24));
        if (daysLate > 0) isOverdue = true;
      }
      var entry = { debt: d, idx: idx, isOverdue: isOverdue, daysLate: daysLate, dueStr: dueStr };
      if (isOverdue) overdueDebts.push(entry);
      else currentDebts.push(entry);
    });
    // Ordenar vencidas por mÃ¡s dÃ­as de retraso
    overdueDebts.sort(function(a, b) { return b.daysLate - a.daysLate; });

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '460px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:10px;border-radius:8px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:13px;box-sizing:border-box;margin-top:4px;outline:none;';
    var selSt = iSt + 'appearance:auto;';

    // Generar opciones del select â€” vencidas primero con indicador
    var debtOptions = '<option value="">-- Selecciona una deuda --</option>';
    if (overdueDebts.length > 0) {
      debtOptions += '<optgroup label="\u26A0\uFE0F Deudas Vencidas (' + overdueDebts.length + ')">';
      overdueDebts.forEach(function(e) {
        var name = escapeAttr(dn(e.debt) || 'Deuda ' + (e.idx + 1));
        var amt = parseFloat(e.debt.amount || e.debt.totalAmount || e.debt.monto || 0);
        debtOptions += '<option value="' + e.idx + '">\u26A0\uFE0F ' + name + ' (' + currency + formatNumber(amt) + ') - ' + e.daysLate + 'd retraso</option>';
      });
      debtOptions += '</optgroup>';
    }
    if (currentDebts.length > 0) {
      debtOptions += '<optgroup label="\u2705 Deudas al Corriente (' + currentDebts.length + ')">';
      currentDebts.forEach(function(e) {
        var name = escapeAttr(dn(e.debt) || 'Deuda ' + (e.idx + 1));
        var amt = parseFloat(e.debt.amount || e.debt.totalAmount || e.debt.monto || 0);
        debtOptions += '<option value="' + e.idx + '">' + name + ' (' + currency + formatNumber(amt) + ')</option>';
      });
      debtOptions += '</optgroup>';
    }
    debtOptions += '<option value="manual">Ingresar manualmente</option>';

    // Panel de cuentas pendientes (vencidas)
    var overduePanel = '';
    if (overdueDebts.length > 0) {
      var totalOverdue = overdueDebts.reduce(function(s, e) { return s + parseFloat(e.debt.amount || e.debt.totalAmount || e.debt.monto || 0); }, 0);
      overduePanel = '<div style="background:linear-gradient(135deg,#FF3B3018,#FF950018);border:1px solid #FF3B3040;border-radius:12px;padding:14px;margin-bottom:14px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span style="font-size:20px">\u26A0\uFE0F</span>'
        + '<div><div style="font-size:13px;font-weight:700;color:#FF3B30">Cuentas Pendientes Vencidas</div>'
        + '<div style="font-size:11px;color:' + t.muted + '">' + overdueDebts.length + ' deuda' + (overdueDebts.length !== 1 ? 's' : '') + ' \u2022 Total: <b style="color:#FF3B30">' + currency + formatNumber(totalOverdue) + '</b></div></div></div>';
      overdueDebts.forEach(function(e) {
        var name = dn(e.debt) || 'Deuda';
        var amt = parseFloat(e.debt.amount || e.debt.totalAmount || e.debt.monto || 0);
        var dueDate = e.dueStr ? new Date(e.dueStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        overduePanel += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;margin-top:4px;background:' + t.bg + ';border-radius:8px;font-size:12px">'
          + '<div><span style="font-weight:600">' + escapeHtml(name) + '</span>'
          + (dueDate ? '<span style="color:' + t.muted + ';margin-left:6px">venc. ' + dueDate + '</span>' : '') + '</div>'
          + '<div style="text-align:right"><div style="font-weight:700;color:#FF3B30">' + currency + formatNumber(amt) + '</div>'
          + '<div style="font-size:10px;color:#FF9500">' + e.daysLate + ' d\u00eda' + (e.daysLate !== 1 ? 's' : '') + ' de retraso</div></div></div>';
      });
      overduePanel += '</div>';
    } else {
      overduePanel = '<div style="background:linear-gradient(135deg,#34C75918,#34C75910);border:1px solid #34C75940;border-radius:12px;padding:12px;margin-bottom:14px;text-align:center">'
        + '<span style="font-size:16px">\u2705</span> '
        + '<span style="font-size:13px;font-weight:600;color:#34C759">No tienes deudas vencidas</span>'
        + '<div style="font-size:11px;color:' + t.muted + ';margin-top:2px">A\u00fan puedes simular un convenio para cualquier deuda.</div></div>';
    }

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83E\uDD1D Convenio de Pago</h2>'
      + '<button class="dc-pa-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px;margin-bottom:14px;font-size:12px;color:' + t.muted + ';line-height:1.5">'
      + '\uD83D\uDCA1 Simula un convenio de pago para deudas vencidas: liquidaci\u00f3n en un solo pago o plan de pagos a plazos.</div>'

      // Panel de deudas vencidas
      + overduePanel

      // SelecciÃ³n de deuda
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

      // BotÃ³n calcular
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
        debtName = dn(selDebt) || 'Deuda';
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
        // â”€â”€ Pago Ãºnico â”€â”€
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
        // â”€â”€ Plan de pagos â”€â”€
        var numPayments = parseInt(card.querySelector('.dc-pa-num-payments').value) || 0;
        var frequency = card.querySelector('.dc-pa-frequency').value;
        var annualRate = parseFloat(card.querySelector('.dc-pa-interest').value) || 0;

        if (numPayments < 2) { showToast('\u26A0\uFE0F Ingresa al menos 2 pagos para el plan'); return; }

        // Calcular cuota
        var totalWithInterest = agreedAmt;
        var monthlyPayment;
        var totalInterest = 0;

        if (annualRate > 0) {
          // Calcular tasa por perÃ­odo segÃºn frecuencia
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

          // Avanzar fecha segÃºn frecuencia
          if (frequency === 'weekly') {
            payDate.setDate(payDate.getDate() + 7);
          } else if (frequency === 'biweekly') {
            payDate.setDate(payDate.getDate() + 14);
          } else {
            payDate.setMonth(payDate.getMonth() + 1);
          }
        }

        html += '</tbody></table></div>';

        // Fecha de tÃ©rmino
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

        // BotÃ³n copiar tabla
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
  // Sistema de Logros y MotivaciÃ³n
  // ============================================================
  var ACHIEVEMENTS_DEF = [
    { id: 'first_paid', icon: '\uD83C\uDF1F', title: 'Primer Paso', desc: 'Liquida tu primera deuda', xp: 50, check: function(pd) { return pd.length >= 1; } },
    { id: 'paid_3', icon: '\uD83D\uDD25', title: 'En Racha', desc: 'Liquida 3 deudas', xp: 100, check: function(pd) { return pd.length >= 3; } },
    { id: 'paid_5', icon: '\u2B50', title: 'Imparable', desc: 'Liquida 5 deudas', xp: 200, check: function(pd) { return pd.length >= 5; } },
    { id: 'paid_10', icon: '\uD83C\uDFC6', title: 'Leyenda', desc: 'Liquida 10 deudas', xp: 500, check: function(pd) { return pd.length >= 10; } },
    { id: 'amt_1k', icon: '\uD83D\uDCB0', title: 'Primer Mil', desc: 'Liquida m\u00e1s de 1,000 en total', xp: 75, check: function(pd) { var t = pd.reduce(function(s, d) { return s + (d.amount || 0); }, 0); return t >= 1000; } },
    { id: 'amt_10k', icon: '\uD83D\uDCB5', title: 'Diez Grandes', desc: 'Liquida m\u00e1s de 10,000 en total', xp: 150, check: function(pd) { var t = pd.reduce(function(s, d) { return s + (d.amount || 0); }, 0); return t >= 10000; } },
    { id: 'amt_50k', icon: '\uD83D\uDCB8', title: 'Gran Liquidador', desc: 'Liquida m\u00e1s de 50,000 en total', xp: 300, check: function(pd) { var t = pd.reduce(function(s, d) { return s + (d.amount || 0); }, 0); return t >= 50000; } },
    { id: 'amt_100k', icon: '\uD83D\uDC8E', title: 'Maestro Financiero', desc: 'Liquida m\u00e1s de 100,000 en total', xp: 500, check: function(pd) { var t = pd.reduce(function(s, d) { return s + (d.amount || 0); }, 0); return t >= 100000; } },
    { id: 'historic', icon: '\uD83D\uDCDC', title: 'Historiador', desc: 'Registra una deuda pagada antes de la app', xp: 30, check: function(pd) { return pd.some(function(d) { return d.historic; }); } },
    { id: 'with_discount', icon: '\u2702\uFE0F', title: 'Negociador', desc: 'Liquida una deuda con descuento (convenio)', xp: 80, check: function(pd) { return pd.some(function(d) { return d.discount && d.discount > 0; }); } },
    { id: 'debt_free', icon: '\uD83C\uDF89', title: '\u00a1Libre de Deudas!', desc: 'Liquida todas tus deudas activas', xp: 1000, check: function(pd, activeDebts) { return activeDebts === 0 && pd.length > 0; } },
    { id: 'streak_3m', icon: '\uD83D\uDCC6', title: 'Constancia', desc: 'Liquida deudas en 3 meses diferentes', xp: 120, check: function(pd) { var months = {}; pd.forEach(function(d) { if (d.paidDate) months[d.paidDate.substring(0, 7)] = true; }); return Object.keys(months).length >= 3; } }
  ];

  var MOTIVATIONAL_MESSAGES = [
    '\uD83D\uDCAA \u00a1Cada deuda que liquidas es una victoria!',
    '\uD83C\uDF1F \u00a1Vas por buen camino hacia la libertad financiera!',
    '\uD83D\uDE80 \u00a1Sigue as\u00ed! Tu futuro yo te lo agradecer\u00e1.',
    '\uD83C\uDFC6 Los grandes logros se construyen paso a paso.',
    '\uD83D\uDCB0 Cada peso que pagas es un peso menos de presi\u00f3n.',
    '\u2728 La disciplina de hoy es la libertad de ma\u00f1ana.',
    '\uD83C\uDF08 No es la velocidad, es la constancia lo que cuenta.',
    '\uD83E\uDD73 \u00a1Cel\u00e9brate! Has tomado el control de tus finanzas.',
    '\uD83C\uDFAF Tu compromiso con tus pagos habla de tu fortaleza.',
    '\uD83D\uDCA1 Recuerda: la deuda no define tu valor, tu esfuerzo s\u00ed.'
  ];

  function getPaidDebts() {
    try { return JSON.parse(localStorage.getItem(LS_PAID_DEBTS) || '[]'); }
    catch (e) { return []; }
  }

  function savePaidDebts(list) {
    localStorage.setItem(LS_PAID_DEBTS, JSON.stringify(list));
  }

  function getUnlockedAchievements() {
    try { return JSON.parse(localStorage.getItem(LS_ACHIEVEMENTS) || '[]'); }
    catch (e) { return []; }
  }

  function saveUnlockedAchievements(list) {
    localStorage.setItem(LS_ACHIEVEMENTS, JSON.stringify(list));
  }

  async function checkAndUnlockAchievements(silent) {
    var paidDebts = getPaidDebts();
    var data = await getAllLocalData();
    var activeDebts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    }).length;
    var unlocked = getUnlockedAchievements();
    var newlyUnlocked = [];

    ACHIEVEMENTS_DEF.forEach(function(ach) {
      if (unlocked.indexOf(ach.id) !== -1) return;
      if (ach.check(paidDebts, activeDebts)) {
        unlocked.push(ach.id);
        newlyUnlocked.push(ach);
      }
    });

    if (newlyUnlocked.length > 0) {
      saveUnlockedAchievements(unlocked);
      if (!silent) {
        newlyUnlocked.forEach(function(ach) {
          showAchievementToast(ach);
        });
      }
    }
    return newlyUnlocked;
  }

  function showAchievementToast(ach) {
    var t = getThemeColors();
    var toast = document.createElement('div');
    Object.assign(toast.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%) translateY(-100px)',
      background: 'linear-gradient(135deg, #FFD700, #FF9500)', color: '#1a1a2e',
      borderRadius: '16px', padding: '14px 20px', zIndex: '999999',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 8px 32px rgba(255,215,0,0.4)', textAlign: 'center',
      maxWidth: '340px', width: '90%', transition: 'transform 0.5s cubic-bezier(0.175,0.885,0.32,1.275)'
    });
    toast.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.7;margin-bottom:4px">\uD83C\uDF89 \u00a1Logro Desbloqueado!</div>'
      + '<div style="font-size:28px;margin:4px 0">' + ach.icon + '</div>'
      + '<div style="font-size:15px;font-weight:700">' + ach.title + '</div>'
      + '<div style="font-size:12px;opacity:0.8">' + ach.desc + '</div>'
      + '<div style="font-size:12px;font-weight:700;margin-top:4px;color:#1a1a2e">+' + ach.xp + ' XP</div>';
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.transform = 'translateX(-50%) translateY(0)'; }, 50);
    setTimeout(function() {
      toast.style.transform = 'translateX(-50%) translateY(-100px)';
      setTimeout(function() { toast.remove(); }, 500);
    }, 4000);
    // Haptic
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
  }

  function getMotivationalMessage() {
    return MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
  }

  function calculateLevel(xp) {
    // Cada nivel necesita 100 XP mÃ¡s que el anterior: nivel 1 = 100, nivel 2 = 300, nivel 3 = 600...
    var level = 0;
    var needed = 0;
    while (xp >= needed + (level + 1) * 100) {
      level++;
      needed += level * 100;
    }
    var currentLevelXP = xp - needed;
    var nextLevelXP = (level + 1) * 100;
    return { level: level, currentXP: currentLevelXP, nextLevelXP: nextLevelXP, totalXP: xp };
  }

  function getTotalXP() {
    var unlocked = getUnlockedAchievements();
    var xp = 0;
    ACHIEVEMENTS_DEF.forEach(function(ach) {
      if (unlocked.indexOf(ach.id) !== -1) xp += ach.xp;
    });
    return xp;
  }

  function getLevelTitle(level) {
    if (level >= 10) return 'Maestro Financiero \uD83D\uDC8E';
    if (level >= 7) return 'Experto en Finanzas \uD83C\uDFC6';
    if (level >= 5) return 'Guerrero de Deudas \u2694\uFE0F';
    if (level >= 3) return 'Controlador Financiero \uD83D\uDCCA';
    if (level >= 1) return 'Aprendiz de Ahorro \uD83C\uDF31';
    return 'Novato \uD83D\uDC23';
  }

  // ============================================================
  // Marcar Deuda como Liquidada
  // ============================================================
  async function showMarkDebtPaid() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var paidDebts = getPaidDebts();

    var debts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    });

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '440px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    var iSt = 'width:100%;padding:10px;border-radius:8px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:13px;box-sizing:border-box;margin-top:4px;outline:none;';
    var selSt = iSt + 'appearance:auto;';

    // Select de deudas activas
    var debtOptions = '<option value="">-- Selecciona la deuda liquidada --</option>';
    debts.forEach(function(d, idx) {
      var name = escapeAttr(dn(d) || 'Deuda ' + (idx + 1));
      var amt = parseFloat(d.amount || d.totalAmount || d.monto || 0);
      debtOptions += '<option value="active_' + idx + '">' + name + ' (' + currency + formatNumber(amt) + ')</option>';
    });
    debtOptions += '<option value="historic">A\u00f1adir deuda pagada antes de la app</option>';

    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\u2705 Registrar Deuda Liquidada</h2>'
      + '<button class="dc-mpd-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px;margin-bottom:14px;font-size:12px;color:' + t.muted + ';line-height:1.5">'
      + '\uD83C\uDF89 Registra deudas que ya liquidaste para ganar XP y logros. Tambi\u00e9n puedes agregar deudas que hayas pagado antes de usar la app.</div>'

      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Deuda</label>'
      + '<select class="dc-mpd-select" style="' + selSt + '">' + debtOptions + '</select>'

      // Campos para deuda histÃ³rica
      + '<div class="dc-mpd-historic" style="display:none;margin-top:8px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Nombre de la deuda</label>'
      + '<input class="dc-mpd-name" type="text" placeholder="Ej: Tarjeta VISA, Pr\u00e9stamo banco..." style="' + iSt + '">'
      + '<div style="margin-top:8px"><label style="font-size:12px;font-weight:600;color:' + t.muted + '">Monto que se adeudaba (' + currency + ')</label>'
      + '<input class="dc-mpd-amount" type="number" placeholder="Ej: 15000" style="' + iSt + '"></div>'
      + '<div style="margin-top:8px"><label style="font-size:12px;font-weight:600;color:' + t.muted + '">Categor\u00eda (opcional)</label>'
      + '<input class="dc-mpd-category" type="text" placeholder="Ej: Tarjeta de cr\u00e9dito" style="' + iSt + '"></div></div>'

      // Campos comunes
      + '<div style="margin-top:10px"><label style="font-size:12px;font-weight:600;color:' + t.muted + '">Fecha en que se liquid\u00f3</label>'
      + '<input class="dc-mpd-date" type="date" value="' + new Date().toISOString().split('T')[0] + '" style="' + iSt + '"></div>'

      + '<div style="margin-top:10px"><label style="font-size:12px;font-weight:600;color:' + t.muted + '">\u00bfSe obtuvo descuento? (convenio/negociaci\u00f3n)</label>'
      + '<select class="dc-mpd-discount-toggle" style="' + selSt + '">'
      + '<option value="no">No, se pag\u00f3 completo</option>'
      + '<option value="yes">S\u00ed, se obtuvo descuento</option>'
      + '</select></div>'

      + '<div class="dc-mpd-discount-fields" style="display:none;margin-top:8px">'
      + '<label style="font-size:12px;font-weight:600;color:' + t.muted + '">Monto original antes del descuento (' + currency + ')</label>'
      + '<input class="dc-mpd-orig-amount" type="number" placeholder="Ej: 50000" style="' + iSt + '">'
      + '</div>'

      + '<div style="margin-top:10px"><label style="font-size:12px;font-weight:600;color:' + t.muted + '">Nota (opcional)</label>'
      + '<input class="dc-mpd-note" type="text" placeholder="Ej: Liquidada con aguinaldo" style="' + iSt + '"></div>'

      + '<button class="dc-mpd-save" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#34C759,#30D158);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px">\u2705 Registrar como Liquidada</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-mpd-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Toggle campos histÃ³ricos
    var sel = card.querySelector('.dc-mpd-select');
    sel.addEventListener('change', function() {
      card.querySelector('.dc-mpd-historic').style.display = sel.value === 'historic' ? 'block' : 'none';
    });

    // Toggle descuento
    var discToggle = card.querySelector('.dc-mpd-discount-toggle');
    discToggle.addEventListener('change', function() {
      card.querySelector('.dc-mpd-discount-fields').style.display = discToggle.value === 'yes' ? 'block' : 'none';
    });

    // Guardar
    card.querySelector('.dc-mpd-save').addEventListener('click', async function() {
      var selVal = sel.value;
      if (!selVal) { showToast('\u26A0\uFE0F Selecciona una deuda'); return; }

      var entry = { id: 'pd_' + Date.now(), paidDate: card.querySelector('.dc-mpd-date').value || new Date().toISOString().split('T')[0], note: card.querySelector('.dc-mpd-note').value || '' };

      if (selVal === 'historic') {
        // Deuda histÃ³rica
        var hName = card.querySelector('.dc-mpd-name').value;
        var hAmount = parseFloat(card.querySelector('.dc-mpd-amount').value) || 0;
        if (!hName || hAmount <= 0) { showToast('\u26A0\uFE0F Ingresa nombre y monto de la deuda'); return; }
        entry.name = hName;
        entry.amount = hAmount;
        entry.category = card.querySelector('.dc-mpd-category').value || '';
        entry.historic = true;
      } else {
        // Deuda activa
        var idx = parseInt(selVal.replace('active_', ''));
        var debt = debts[idx];
        if (!debt) { showToast('\u26A0\uFE0F Deuda no encontrada'); return; }
        entry.name = dn(debt) || 'Deuda';
        entry.amount = parseFloat(debt.amount || debt.totalAmount || debt.monto || 0);
        entry.category = debt.category || debt.categoria || '';
        entry.historic = false;
        entry.originalDebtId = debt.id || null;
      }

      // Descuento
      if (discToggle.value === 'yes') {
        var origAmt = parseFloat(card.querySelector('.dc-mpd-orig-amount').value) || 0;
        if (origAmt > entry.amount) {
          entry.discount = origAmt - entry.amount;
          entry.originalAmount = origAmt;
        }
      }

      var list = getPaidDebts();
      list.push(entry);
      savePaidDebts(list);

      overlay.remove();
      showToast('\uD83C\uDF89 \u00a1' + escapeHtml(entry.name) + ' registrada como liquidada!');

      // Verificar logros
      var newAch = await checkAndUnlockAchievements(false);

      // Mensaje motivacional
      setTimeout(function() {
        showToast(getMotivationalMessage(), 4000);
      }, newAch.length > 0 ? 4500 : 1500);
    });
  }

  // ============================================================
  // Pantalla: Mis Logros y Progreso
  // ============================================================
  async function showAchievementsScreen() {
    var t = getThemeColors();
    var currency = getCurrency();
    var paidDebts = getPaidDebts();
    var unlocked = getUnlockedAchievements();
    var totalXP = getTotalXP();
    var levelInfo = calculateLevel(totalXP);
    var levelTitle = getLevelTitle(levelInfo.level);

    // Stats
    var totalPaid = paidDebts.reduce(function(s, d) { return s + (d.amount || 0); }, 0);
    var totalDiscount = paidDebts.reduce(function(s, d) { return s + (d.discount || 0); }, 0);
    var historicCount = paidDebts.filter(function(d) { return d.historic; }).length;
    var data = await getAllLocalData();
    var activeDebts = (data.debts || []).filter(function(d) {
      return parseFloat(d.amount || d.totalAmount || d.monto || 0) > 0;
    }).length;

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '440px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    // Barra de XP
    var xpPct = levelInfo.nextLevelXP > 0 ? Math.min(100, (levelInfo.currentXP / levelInfo.nextLevelXP) * 100) : 100;

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83C\uDFC6 Mis Logros</h2>'
      + '<button class="dc-ach-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>';

    // Perfil de nivel
    html += '<div style="background:linear-gradient(135deg,#FFD700,#FF9500);border-radius:16px;padding:18px;color:#1a1a2e;text-align:center;margin-bottom:16px">'
      + '<div style="font-size:40px;margin-bottom:2px">' + (levelInfo.level >= 10 ? '\uD83D\uDC8E' : levelInfo.level >= 5 ? '\uD83C\uDFC6' : levelInfo.level >= 1 ? '\uD83C\uDF1F' : '\uD83D\uDC23') + '</div>'
      + '<div style="font-size:22px;font-weight:800">Nivel ' + levelInfo.level + '</div>'
      + '<div style="font-size:13px;font-weight:600;opacity:0.8">' + levelTitle + '</div>'
      + '<div style="background:rgba(0,0,0,0.2);border-radius:8px;height:10px;margin:10px 0 4px 0;overflow:hidden">'
      + '<div style="width:' + xpPct + '%;height:100%;background:rgba(255,255,255,0.9);border-radius:8px;transition:width 0.5s"></div></div>'
      + '<div style="font-size:11px;font-weight:600;opacity:0.7">' + levelInfo.currentXP + ' / ' + levelInfo.nextLevelXP + ' XP \u2022 Total: ' + totalXP + ' XP</div></div>';

    // Mensaje motivacional
    html += '<div style="background:linear-gradient(135deg,#007AFF20,#5856D620);border:1px solid #007AFF30;border-radius:12px;padding:12px;text-align:center;margin-bottom:16px;font-size:13px;font-weight:500">'
      + getMotivationalMessage() + '</div>';

    // Stats grid
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;text-align:center">'
      + '<div style="font-size:22px;font-weight:800;color:#34C759">' + paidDebts.length + '</div>'
      + '<div style="font-size:11px;color:' + t.muted + '">Deudas Liquidadas</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;text-align:center">'
      + '<div style="font-size:22px;font-weight:800;color:#007AFF">' + activeDebts + '</div>'
      + '<div style="font-size:11px;color:' + t.muted + '">Deudas Activas</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;text-align:center">'
      + '<div style="font-size:16px;font-weight:800;color:#34C759">' + currency + formatNumber(totalPaid) + '</div>'
      + '<div style="font-size:11px;color:' + t.muted + '">Total Liquidado</div></div>'
      + '<div style="background:' + t.inputBg + ';border-radius:12px;padding:12px;text-align:center">'
      + '<div style="font-size:16px;font-weight:800;color:#FF9500">' + currency + formatNumber(totalDiscount) + '</div>'
      + '<div style="font-size:11px;color:' + t.muted + '">Ahorrado en Convenios</div></div></div>';

    // Logros
    html += '<div style="font-size:14px;font-weight:700;margin-bottom:10px">\uD83C\uDFC5 Logros (' + unlocked.length + '/' + ACHIEVEMENTS_DEF.length + ')</div>';

    ACHIEVEMENTS_DEF.forEach(function(ach) {
      var isUnlocked = unlocked.indexOf(ach.id) !== -1;
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px;margin-bottom:6px;border-radius:12px;'
        + 'background:' + (isUnlocked ? 'linear-gradient(135deg,' + t.inputBg + ',' + t.inputBg + ')' : t.inputBg) + ';'
        + 'border:1px solid ' + (isUnlocked ? '#FFD70060' : 'transparent') + ';'
        + 'opacity:' + (isUnlocked ? '1' : '0.5') + '">'
        + '<div style="font-size:28px;' + (isUnlocked ? '' : 'filter:grayscale(100%)') + '">' + ach.icon + '</div>'
        + '<div style="flex:1"><div style="font-size:13px;font-weight:700">' + ach.title + (isUnlocked ? '' : ' \uD83D\uDD12') + '</div>'
        + '<div style="font-size:11px;color:' + t.muted + '">' + ach.desc + '</div></div>'
        + '<div style="font-size:12px;font-weight:700;color:' + (isUnlocked ? '#FFD700' : t.muted) + '">+' + ach.xp + '</div></div>';
    });

    // Historial de deudas liquidadas
    if (paidDebts.length > 0) {
      html += '<div style="font-size:14px;font-weight:700;margin:16px 0 10px 0">\uD83D\uDCDC Deudas Liquidadas</div>';
      // Ordenar por fecha mÃ¡s reciente
      var sorted = paidDebts.slice().sort(function(a, b) { return (b.paidDate || '').localeCompare(a.paidDate || ''); });
      sorted.forEach(function(d) {
        var dateStr = d.paidDate ? new Date(d.paidDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        html += '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">'
          + '<div><div style="font-size:13px;font-weight:600">' + (d.historic ? '\uD83D\uDCDC ' : '\u2705 ') + escapeHtml(d.name || 'Deuda') + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + '">' + dateStr
          + (d.historic ? ' \u2022 Hist\u00f3rica' : '')
          + (d.category ? ' \u2022 ' + escapeHtml(d.category) : '')
          + (d.note ? ' \u2022 ' + escapeHtml(d.note) : '') + '</div></div>'
          + '<div style="text-align:right"><div style="font-size:14px;font-weight:700;color:#34C759">' + currency + formatNumber(d.amount || 0) + '</div>'
          + (d.discount > 0 ? '<div style="font-size:10px;color:#FF9500">Ahorro: ' + currency + formatNumber(d.discount) + '</div>' : '') + '</div></div>';
      });
    } else {
      html += '<div style="text-align:center;padding:20px;color:' + t.muted + ';font-size:13px">'
        + '<div style="font-size:40px;margin-bottom:8px">\uD83C\uDFAF</div>'
        + 'A\u00fan no has registrado deudas liquidadas.<br>Marca una deuda como pagada para empezar a ganar logros.</div>';
    }

    html += '<div style="display:flex;gap:8px;margin-top:16px">'
      + '<button class="dc-ach-add" style="flex:1;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#34C759,#30D158);color:#fff;font-size:13px;font-weight:600;cursor:pointer">\u2795 Registrar Liquidada</button>'
      + '<button class="dc-ach-close2" style="flex:1;padding:12px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:13px;cursor:pointer">Cerrar</button></div>';

    card.innerHTML = html;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector('.dc-ach-close').addEventListener('click', function() { overlay.remove(); });
    card.querySelector('.dc-ach-close2').addEventListener('click', function() { overlay.remove(); });
    card.querySelector('.dc-ach-add').addEventListener('click', function() { overlay.remove(); showMarkDebtPaid(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Verificar logros al abrir (por si hay nuevos)
    await checkAndUnlockAchievements(false);
  }

  // ============================================================
  // Historial Agrupado de Deudas y Pagos
  // ============================================================
  async function showDebtHistory() {
    var data = await getAllLocalData();
    var t = getThemeColors();
    var currency = getCurrency();
    var paidDebts = getPaidDebts();
    var debts = data.debts || [];
    var payments = data.payments || [];
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    // Construir lista unificada de deudas con estado
    var allDebts = [];

    // Deudas activas
    debts.forEach(function(d) {
      var amount = parseFloat(d.amount || d.totalAmount || d.monto || 0);
      if (amount <= 0) return;
      var dueStr = d.dueDate || d.fechaVencimiento || d.nextPaymentDate || null;
      var isOverdue = false;
      var daysLate = 0;
      if (dueStr) {
        var due = new Date(dueStr);
        due.setHours(0, 0, 0, 0);
        daysLate = Math.round((now - due) / (1000 * 60 * 60 * 24));
        if (daysLate > 0) isOverdue = true;
      }
      // Pagos asociados
      var debtPayments = payments.filter(function(p) {
        return p.debtId === d.id || p.debtName === dn(d);
      });
      var totalPaid = debtPayments.reduce(function(s, p) { return s + parseFloat(p.amount || p.monto || 0); }, 0);
      var pct = amount > 0 ? Math.min((totalPaid / amount) * 100, 100) : 0;

      allDebts.push({
        name: dn(d) || 'Deuda',
        amount: amount,
        category: d.category || d.categoria || '',
        lender: d.lender || d.acreedor || d.bank || d.banco || d.institution || d.entidad || d.company || d.empresa || '',
        status: isOverdue ? 'overdue' : 'active',
        daysLate: daysLate,
        dueDate: dueStr || null,
        paidAmount: totalPaid,
        paidPct: pct,
        payments: debtPayments,
        paidDate: null,
        discount: 0,
        historic: false,
        note: ''
      });
    });

    // Deudas liquidadas
    paidDebts.forEach(function(d) {
      allDebts.push({
        name: d.name || 'Deuda',
        amount: d.amount || 0,
        category: d.category || '',
        lender: d.lender || d.acreedor || d.bank || d.banco || d.institution || d.entidad || d.company || d.empresa || '',
        status: 'paid',
        daysLate: 0,
        dueDate: null,
        paidAmount: d.amount || 0,
        paidPct: 100,
        payments: [],
        paidDate: d.paidDate || null,
        discount: d.discount || 0,
        originalAmount: d.originalAmount || 0,
        historic: d.historic || false,
        note: d.note || ''
      });
    });

    // Determinar agrupaciones (entidad y tipo)
    var byLender = {};
    var byCategory = {};
    allDebts.forEach(function(d) {
      var lKey = d.lender || inferLender(d.name);
      var cKey = d.category || inferCategory(d.name);
      d._lender = lKey;
      d._category = cKey;
      if (!byLender[lKey]) byLender[lKey] = [];
      byLender[lKey].push(d);
      if (!byCategory[cKey]) byCategory[cKey] = [];
      byCategory[cKey].push(d);
    });

    // Inferir entidad del nombre
    function inferLender(name) {
      if (!name) return 'Sin entidad';
      var n = name.toLowerCase();
      // Patrones comunes de bancos/entidades
      var banks = ['bbva', 'banamex', 'banorte', 'santander', 'hsbc', 'scotiabank', 'azteca', 'inbursa', 'citibanamex', 'afirme', 'banbajio', 'banregio', 'hey banco', 'nu ', 'nubank', 'mercadopago', 'mercado pago', 'coppel', 'elektra', 'liverpool', 'palacio', 'costco', 'amex', 'american express'];
      for (var i = 0; i < banks.length; i++) {
        if (n.indexOf(banks[i]) !== -1) {
          return banks[i].charAt(0).toUpperCase() + banks[i].slice(1);
        }
      }
      // Si tiene palabras como "banco", "tarjeta de", separar
      var match = n.match(/(?:banco|bank|tarjeta|credito|pr[eÃ©]stamo)\s+(?:de\s+)?(\w+)/i);
      if (match) return match[1].charAt(0).toUpperCase() + match[1].slice(1);
      return 'Sin entidad';
    }

    function inferCategory(name) {
      if (!name) return 'Sin categor\u00eda';
      var n = name.toLowerCase();
      if (n.indexOf('tarjeta') !== -1 || n.indexOf('tdc') !== -1 || n.indexOf('credit card') !== -1) return 'Tarjeta de Cr\u00e9dito';
      if (n.indexOf('hipoteca') !== -1 || n.indexOf('casa') !== -1 || n.indexOf('vivienda') !== -1 || n.indexOf('mortgage') !== -1) return 'Hipotecario';
      if (n.indexOf('auto') !== -1 || n.indexOf('carro') !== -1 || n.indexOf('vehic') !== -1 || n.indexOf('car loan') !== -1) return 'Automotriz';
      if (n.indexOf('personal') !== -1 || n.indexOf('pr\u00e9stamo') !== -1 || n.indexOf('prestamo') !== -1) return 'Pr\u00e9stamo Personal';
      if (n.indexOf('escolar') !== -1 || n.indexOf('estudi') !== -1 || n.indexOf('educaci') !== -1 || n.indexOf('universidad') !== -1) return 'Educativo';
      if (n.indexOf('m\u00e9dico') !== -1 || n.indexOf('medico') !== -1 || n.indexOf('hospital') !== -1 || n.indexOf('salud') !== -1) return 'M\u00e9dico';
      return 'Sin categor\u00eda';
    }

    var overlay = createModalOverlay();
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: t.bg, borderRadius: '20px', padding: '28px 24px', maxWidth: '480px',
      width: '100%', maxHeight: '85vh', overflowY: 'auto', color: t.txt,
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    });

    if (allDebts.length === 0) {
      card.innerHTML = '<div style="text-align:center;padding:20px">'
        + '<div style="font-size:48px;margin-bottom:12px">\uD83D\uDCCB</div>'
        + '<h2 style="margin:0 0 8px 0;font-size:18px">Historial de Deudas</h2>'
        + '<p style="color:' + t.muted + ';font-size:14px">No hay deudas registradas a\u00fan.</p>'
        + '<button class="dc-dh-close0" style="padding:12px 24px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:12px">Cerrar</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      card.querySelector('.dc-dh-close0').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      return;
    }

    // EstadÃ­sticas
    var countActive = allDebts.filter(function(d) { return d.status === 'active'; }).length;
    var countOverdue = allDebts.filter(function(d) { return d.status === 'overdue'; }).length;
    var countPaid = allDebts.filter(function(d) { return d.status === 'paid'; }).length;
    var totalActive = allDebts.filter(function(d) { return d.status !== 'paid'; }).reduce(function(s, d) { return s + d.amount; }, 0);
    var totalPaidAmt = allDebts.filter(function(d) { return d.status === 'paid'; }).reduce(function(s, d) { return s + d.amount; }, 0);

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:18px">\uD83D\uDCCB Historial de Deudas</h2>'
      + '<button class="dc-dh-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:' + t.txt + '">\u2715</button></div>';

    // Tabs
    html += '<div class="dc-dh-tabs" style="display:flex;gap:6px;margin-bottom:14px">'
      + '<button class="dc-dh-tab" data-tab="lender" style="flex:1;padding:8px;border:1px solid #007AFF;border-radius:10px;background:#007AFF;color:#fff;font-size:12px;font-weight:600;cursor:pointer">\uD83C\uDFE6 Por Entidad</button>'
      + '<button class="dc-dh-tab" data-tab="category" style="flex:1;padding:8px;border:1px solid ' + t.border + ';border-radius:10px;background:transparent;color:' + t.txt + ';font-size:12px;font-weight:600;cursor:pointer">\uD83D\uDCC1 Por Tipo</button>'
      + '<button class="dc-dh-tab" data-tab="status" style="flex:1;padding:8px;border:1px solid ' + t.border + ';border-radius:10px;background:transparent;color:' + t.txt + ';font-size:12px;font-weight:600;cursor:pointer">\uD83D\uDEA6 Por Estado</button></div>';

    // Stats bar
    html += '<div style="display:flex;gap:6px;margin-bottom:14px">'
      + '<div style="flex:1;background:' + t.inputBg + ';border-radius:10px;padding:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#FF9500">' + countActive + '</div>'
      + '<div style="font-size:10px;color:' + t.muted + '">Vigente' + (countActive !== 1 ? 's' : '') + '</div></div>'
      + '<div style="flex:1;background:' + t.inputBg + ';border-radius:10px;padding:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#FF3B30">' + countOverdue + '</div>'
      + '<div style="font-size:10px;color:' + t.muted + '">En mora</div></div>'
      + '<div style="flex:1;background:' + t.inputBg + ';border-radius:10px;padding:8px;text-align:center">'
      + '<div style="font-size:18px;font-weight:800;color:#34C759">' + countPaid + '</div>'
      + '<div style="font-size:10px;color:' + t.muted + '">Liquidada' + (countPaid !== 1 ? 's' : '') + '</div></div></div>';

    // Container dinÃ¡mico
    html += '<div class="dc-dh-content"></div>';

    html += '<button class="dc-dh-close2" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:14px;cursor:pointer;margin-top:12px">Cerrar</button>';

    card.innerHTML = html;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var contentDiv = card.querySelector('.dc-dh-content');

    function statusBadge(status, daysLate) {
      if (status === 'overdue') return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;background:#FF3B3020;color:#FF3B30;border:1px solid #FF3B3040">\uD83D\uDD34 Mora' + (daysLate > 0 ? ' (' + daysLate + 'd)' : '') + '</span>';
      if (status === 'paid') return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;background:#34C75920;color:#34C759;border:1px solid #34C75940">\uD83D\uDFE2 Liquidada</span>';
      return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;background:#FF950020;color:#FF9500;border:1px solid #FF950040">\uD83D\uDFE1 Vigente</span>';
    }

    function renderDebtCard(d) {
      var card = '<div style="background:' + t.inputBg + ';border-radius:10px;padding:10px 12px;margin-bottom:6px;border-left:3px solid '
        + (d.status === 'overdue' ? '#FF3B30' : d.status === 'paid' ? '#34C759' : '#FF9500') + '">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">'
        + '<div style="flex:1">'
        + '<div style="font-size:13px;font-weight:600">' + (d.historic ? '\uD83D\uDCDC ' : '') + escapeHtml(d.name) + '</div>'
        + '<div style="font-size:11px;color:' + t.muted + ';margin-top:2px">'
        + (d._category !== 'Sin categor\u00eda' ? d._category + ' \u2022 ' : '')
        + (d._lender !== 'Sin entidad' ? d._lender : '') + '</div></div>'
        + '<div style="text-align:right">'
        + '<div style="font-size:14px;font-weight:700;' + (d.status === 'paid' ? 'color:#34C759' : '') + '">' + currency + formatNumber(d.amount) + '</div>'
        + statusBadge(d.status, d.daysLate) + '</div></div>';

      // Barra de progreso para activas
      if (d.status !== 'paid' && d.paidPct > 0) {
        card += '<div style="background:' + t.border + ';border-radius:4px;height:5px;overflow:hidden;margin:4px 0">'
          + '<div style="width:' + d.paidPct + '%;height:100%;background:#34C759;border-radius:4px"></div></div>'
          + '<div style="font-size:10px;color:' + t.muted + '">Pagado: ' + currency + formatNumber(d.paidAmount) + ' (' + d.paidPct.toFixed(0) + '%)</div>';
      }

      // Info adicional
      var details = [];
      if (d.dueDate) details.push('Vence: ' + new Date(d.dueDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }));
      if (d.paidDate) details.push('Liquidada: ' + new Date(d.paidDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }));
      if (d.discount > 0) details.push('\u2702\uFE0F Descuento: ' + currency + formatNumber(d.discount));
      if (d.historic) details.push('\uD83D\uDCDC Pagada antes de la app');
      if (d.note) details.push(d.note);
      if (details.length > 0) {
        card += '<div style="font-size:10px;color:' + t.muted + ';margin-top:4px">' + details.join(' \u2022 ') + '</div>';
      }

      card += '</div>';
      return card;
    }

    function renderGrouped(groups, labelKey) {
      var sorted = Object.keys(groups).sort(function(a, b) {
        // Entidades con mora primero, luego activas, luego liquidadas
        var aHasOverdue = groups[a].some(function(d) { return d.status === 'overdue'; });
        var bHasOverdue = groups[b].some(function(d) { return d.status === 'overdue'; });
        if (aHasOverdue !== bHasOverdue) return aHasOverdue ? -1 : 1;
        var aHasActive = groups[a].some(function(d) { return d.status === 'active'; });
        var bHasActive = groups[b].some(function(d) { return d.status === 'active'; });
        if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
        return groups[b].length - groups[a].length;
      });
      var h = '';
      sorted.forEach(function(key) {
        var items = groups[key];
        var totalGrp = items.reduce(function(s, d) { return s + d.amount; }, 0);
        var grpOverdue = items.filter(function(d) { return d.status === 'overdue'; }).length;
        var grpActive = items.filter(function(d) { return d.status === 'active'; }).length;
        var grpPaid = items.filter(function(d) { return d.status === 'paid'; }).length;
        var grpColor = grpOverdue > 0 ? '#FF3B30' : grpActive > 0 ? '#FF9500' : '#34C759';

        h += '<div style="margin-bottom:14px">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding:8px 10px;background:' + grpColor + '12;border:1px solid ' + grpColor + '30;border-radius:10px">'
          + '<div><div style="font-size:14px;font-weight:700">' + escapeHtml(key) + '</div>'
          + '<div style="font-size:10px;color:' + t.muted + '">'
          + items.length + ' deuda' + (items.length !== 1 ? 's' : '')
          + (grpOverdue > 0 ? ' \u2022 <span style="color:#FF3B30">' + grpOverdue + ' en mora</span>' : '')
          + (grpActive > 0 ? ' \u2022 <span style="color:#FF9500">' + grpActive + ' vigente' + (grpActive !== 1 ? 's' : '') + '</span>' : '')
          + (grpPaid > 0 ? ' \u2022 <span style="color:#34C759">' + grpPaid + ' liquidada' + (grpPaid !== 1 ? 's' : '') + '</span>' : '')
          + '</div></div>'
          + '<div style="font-size:15px;font-weight:700">' + currency + formatNumber(totalGrp) + '</div></div>';

        // Ordenar deudas: mora > activa > liquidada, luego por monto
        items.sort(function(a, b) {
          var order = { overdue: 0, active: 1, paid: 2 };
          if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
          return b.amount - a.amount;
        });
        items.forEach(function(d) { h += renderDebtCard(d); });
        h += '</div>';
      });
      return h;
    }

    function renderByStatus() {
      var groups = { 'Mora': [], 'Vigente': [], 'Liquidada': [] };
      allDebts.forEach(function(d) {
        if (d.status === 'overdue') groups['Mora'].push(d);
        else if (d.status === 'active') groups['Vigente'].push(d);
        else groups['Liquidada'].push(d);
      });
      var h = '';
      ['Mora', 'Vigente', 'Liquidada'].forEach(function(key) {
        var items = groups[key];
        if (items.length === 0) return;
        var grpColor = key === 'Mora' ? '#FF3B30' : key === 'Vigente' ? '#FF9500' : '#34C759';
        var icon = key === 'Mora' ? '\uD83D\uDD34' : key === 'Vigente' ? '\uD83D\uDFE1' : '\uD83D\uDFE2';
        var totalGrp = items.reduce(function(s, d) { return s + d.amount; }, 0);

        h += '<div style="margin-bottom:14px">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding:8px 10px;background:' + grpColor + '12;border:1px solid ' + grpColor + '30;border-radius:10px">'
          + '<div><div style="font-size:14px;font-weight:700">' + icon + ' ' + key + '</div>'
          + '<div style="font-size:10px;color:' + t.muted + '">' + items.length + ' deuda' + (items.length !== 1 ? 's' : '') + '</div></div>'
          + '<div style="font-size:15px;font-weight:700">' + currency + formatNumber(totalGrp) + '</div></div>';

        items.sort(function(a, b) { return b.amount - a.amount; });
        items.forEach(function(d) { h += renderDebtCard(d); });
        h += '</div>';
      });
      return h;
    }

    // Render tab
    function showTab(tab) {
      if (tab === 'lender') contentDiv.innerHTML = renderGrouped(byLender);
      else if (tab === 'category') contentDiv.innerHTML = renderGrouped(byCategory);
      else contentDiv.innerHTML = renderByStatus();

      // Update tab styles
      card.querySelectorAll('.dc-dh-tab').forEach(function(btn) {
        var isActive = btn.getAttribute('data-tab') === tab;
        btn.style.background = isActive ? '#007AFF' : 'transparent';
        btn.style.color = isActive ? '#fff' : t.txt;
        btn.style.borderColor = isActive ? '#007AFF' : t.border;
      });
    }

    // Event listeners
    card.querySelector('.dc-dh-close').addEventListener('click', function() { overlay.remove(); });
    card.querySelector('.dc-dh-close2').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    card.querySelectorAll('.dc-dh-tab').forEach(function(btn) {
      btn.addEventListener('click', function() { showTab(btn.getAttribute('data-tab')); });
    });

    // Iniciar con vista por entidad
    showTab('lender');
  }

  // ============================================================
  // Pagos Recurrentes (Gastos Fijos Mensuales)
  // ============================================================

  var RECURRING_CATEGORIES = [
    { id: 'celular', icon: '\uD83D\uDCF1', label: 'Plan Celular' },
    { id: 'internet', icon: '\uD83C\uDF10', label: 'Internet' },
    { id: 'agua', icon: '\uD83D\uDCA7', label: 'Agua' },
    { id: 'luz', icon: '\uD83D\uDCA1', label: 'Luz / Electricidad' },
    { id: 'gas', icon: '\uD83D\uDD25', label: 'Gas' },
    { id: 'gym', icon: '\uD83C\uDFCB\uFE0F', label: 'Gimnasio' },
    { id: 'streaming', icon: '\uD83C\uDFAC', label: 'Streaming' },
    { id: 'seguro', icon: '\uD83D\uDEE1\uFE0F', label: 'Seguro' },
    { id: 'renta', icon: '\uD83C\uDFE0', label: 'Renta / Alquiler' },
    { id: 'transporte', icon: '\uD83D\uDE8C', label: 'Transporte' },
    { id: 'educacion', icon: '\uD83C\uDF93', label: 'Educaci\u00f3n' },
    { id: 'otro', icon: '\uD83D\uDCCC', label: 'Otro' }
  ];

  function getRecurringBills() {
    try { return JSON.parse(localStorage.getItem(LS_RECURRING_BILLS)) || []; } catch(e) { return []; }
  }
  function saveRecurringBills(bills) {
    localStorage.setItem(LS_RECURRING_BILLS, JSON.stringify(bills));
  }
  function getRecurringRecords() {
    try { return JSON.parse(localStorage.getItem(LS_RECURRING_RECORDS)) || {}; } catch(e) { return {}; }
  }
  function saveRecurringRecords(records) {
    localStorage.setItem(LS_RECURRING_RECORDS, JSON.stringify(records));
  }
  function getCurrentMonth() {
    var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function getMonthLabel(ym) {
    var parts = ym.split('-');
    var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }

  function showRecurringPayments() {
    var t = getThemeColors();
    var bills = getRecurringBills();
    var records = getRecurringRecords();
    var month = getCurrentMonth();

    function buildBillsList() {
      if (!bills.length) return '<div style="text-align:center;padding:30px 10px;color:' + t.muted + '">'
        + '<div style="font-size:40px;margin-bottom:12px">\uD83D\uDCCB</div>'
        + '<div>No tienes gastos recurrentes registrados</div>'
        + '<div style="font-size:12px;margin-top:6px">Agrega servicios como celular, internet, luz, etc.</div></div>';

      var html = '';
      bills.forEach(function(bill) {
        var cat = RECURRING_CATEGORIES.find(function(c) { return c.id === bill.category; }) || RECURRING_CATEGORIES[RECURRING_CATEGORIES.length - 1];
        var rec = (records[bill.id] && records[bill.id][month]) || null;
        var statusIcon = rec ? '\u2705' : '\u23F3';
        var statusLabel = rec ? (getCurrency() + Number(rec.amount).toLocaleString()) : 'Pendiente';
        var statusColor = rec ? '#27ae60' : '#e67e22';

        html += '<div class="dc-rb-item" data-id="' + bill.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + t.inputBg + ';border-radius:10px;margin-bottom:8px;cursor:pointer">'
          + '<div style="font-size:24px;width:36px;text-align:center">' + cat.icon + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(bill.name) + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + '">' + cat.label
          + (bill.estimatedAmount ? ' \u2022 ~' + getCurrency() + Number(bill.estimatedAmount).toLocaleString() : '') + '</div></div>'
          + '<div style="text-align:right">'
          + '<div style="font-size:16px">' + statusIcon + '</div>'
          + '<div style="font-size:11px;font-weight:600;color:' + statusColor + '">' + statusLabel + '</div></div></div>';
      });
      return html;
    }

    function buildSummary() {
      if (!bills.length) return '';
      var registered = 0, pending = 0, totalMonth = 0;
      bills.forEach(function(bill) {
        if (!bill.active) return;
        var rec = records[bill.id] && records[bill.id][month];
        if (rec) { registered++; totalMonth += Number(rec.amount) || 0; } else { pending++; }
      });
      return '<div style="display:flex;gap:8px;margin-bottom:14px">'
        + '<div style="flex:1;background:#27ae6022;border-radius:10px;padding:10px;text-align:center">'
        + '<div style="font-size:18px;font-weight:700;color:#27ae60">' + registered + '</div>'
        + '<div style="font-size:10px;color:' + t.muted + '">Registrados</div></div>'
        + '<div style="flex:1;background:#e67e2222;border-radius:10px;padding:10px;text-align:center">'
        + '<div style="font-size:18px;font-weight:700;color:#e67e22">' + pending + '</div>'
        + '<div style="font-size:10px;color:' + t.muted + '">Pendientes</div></div>'
        + '<div style="flex:1;background:#007AFF22;border-radius:10px;padding:10px;text-align:center">'
        + '<div style="font-size:18px;font-weight:700;color:#007AFF">' + getCurrency() + totalMonth.toLocaleString() + '</div>'
        + '<div style="font-size:10px;color:' + t.muted + '">Total Mes</div></div></div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'dc-agreement-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';

    var card = document.createElement('div');
    card.style.cssText = 'background:' + t.bg + ';color:' + t.txt + ';border-radius:18px;max-width:440px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)';

    function render() {
      bills = getRecurringBills();
      records = getRecurringRecords();

      card.innerHTML = '<div style="padding:18px 20px 14px;border-bottom:1px solid ' + t.border + ';display:flex;align-items:center;justify-content:space-between">'
        + '<div style="font-weight:700;font-size:17px">\uD83D\uDD04 Pagos Recurrentes</div>'
        + '<div style="display:flex;gap:8px;align-items:center">'
        + '<button class="dc-rb-add" style="background:#007AFF;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer">+ Nuevo</button>'
        + '<button class="dc-rb-close" style="background:none;border:none;cursor:pointer;font-size:22px;color:' + t.muted + '">\u2715</button></div></div>'
        + '<div style="padding:16px 20px;overflow-y:auto;flex:1">'
        + '<div style="text-align:center;margin-bottom:14px;font-size:13px;color:' + t.muted + ';font-weight:600">\uD83D\uDCC5 ' + getMonthLabel(month) + '</div>'
        + buildSummary()
        + '<div class="dc-rb-list">' + buildBillsList() + '</div>'
        + '</div>'
        + '<div style="padding:12px 20px;border-top:1px solid ' + t.border + ';display:flex;gap:8px">'
        + '<button class="dc-rb-history" style="flex:1;background:' + t.inputBg + ';color:' + t.txt + ';border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">\uD83D\uDCCA Historial</button>'
        + '<button class="dc-rb-close2" style="flex:1;background:#007AFF;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer">Cerrar</button></div>';

      card.querySelector('.dc-rb-close').addEventListener('click', function() { overlay.remove(); });
      card.querySelector('.dc-rb-close2').addEventListener('click', function() { overlay.remove(); });
      card.querySelector('.dc-rb-add').addEventListener('click', function() { showAddBill(); });
      card.querySelector('.dc-rb-history').addEventListener('click', function() { showRecurringHistory(); });

      card.querySelectorAll('.dc-rb-item').forEach(function(el) {
        el.addEventListener('click', function() {
          var id = el.getAttribute('data-id');
          showBillActions(id);
        });
      });
    }

    async function showAddBill() {
      var catHtml = RECURRING_CATEGORIES.map(function(c) {
        return '<option value="' + c.id + '">' + c.icon + ' ' + c.label + '</option>';
      }).join('');

      var formOverlay = document.createElement('div');
      formOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';

      var form = document.createElement('div');
      form.style.cssText = 'background:' + t.bg + ';color:' + t.txt + ';border-radius:16px;max-width:380px;width:100%;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,.3)';
      form.innerHTML = '<div style="font-weight:700;font-size:16px;margin-bottom:16px">\u2795 Nuevo Gasto Recurrente</div>'
        + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Nombre del servicio</label>'
        + '<input id="dc-rb-name" placeholder="Ej: Telcel, Telmex, CFE..." style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;margin-bottom:12px;box-sizing:border-box" />'
        + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Categor\u00eda</label>'
        + '<select id="dc-rb-cat" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;margin-bottom:12px;box-sizing:border-box">' + catHtml + '</select>'
        + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Monto estimado mensual (opcional)</label>'
        + '<input id="dc-rb-amount" type="number" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;margin-bottom:16px;box-sizing:border-box" />'
        + '<div style="display:flex;gap:8px">'
        + '<button id="dc-rb-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;font-weight:600;cursor:pointer">Cancelar</button>'
        + '<button id="dc-rb-save" style="flex:1;padding:10px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Guardar</button></div>';

      formOverlay.appendChild(form);
      document.body.appendChild(formOverlay);
      form.querySelector('#dc-rb-name').focus();

      formOverlay.addEventListener('click', function(e) { if (e.target === formOverlay) formOverlay.remove(); });
      form.querySelector('#dc-rb-cancel').addEventListener('click', function() { formOverlay.remove(); });
      form.querySelector('#dc-rb-save').addEventListener('click', function() {
        var name = form.querySelector('#dc-rb-name').value.trim();
        if (!name) { showToast('\u26A0\uFE0F Ingresa el nombre del servicio'); return; }
        var cat = form.querySelector('#dc-rb-cat').value;
        var est = parseFloat(form.querySelector('#dc-rb-amount').value) || 0;
        var newBill = { id: 'rb_' + Date.now(), name: name, category: cat, estimatedAmount: est, active: true, createdAt: new Date().toISOString() };
        bills.push(newBill);
        saveRecurringBills(bills);
        formOverlay.remove();
        showToast('\u2705 Gasto recurrente agregado');
        render();
      });
    }

    async function showBillActions(billId) {
      var bill = bills.find(function(b) { return b.id === billId; });
      if (!bill) return;
      var rec = records[billId] && records[billId][month];
      var cat = RECURRING_CATEGORIES.find(function(c) { return c.id === bill.category; }) || RECURRING_CATEGORIES[RECURRING_CATEGORIES.length - 1];

      var actOverlay = document.createElement('div');
      actOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';

      var actCard = document.createElement('div');
      actCard.style.cssText = 'background:' + t.bg + ';color:' + t.txt + ';border-radius:16px;max-width:360px;width:100%;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,.3)';

      var statusHtml = rec
        ? '<div style="background:#27ae6018;border-radius:10px;padding:12px;margin-bottom:16px">'
          + '<div style="font-size:12px;color:#27ae60;font-weight:600">\u2705 Registrado este mes</div>'
          + '<div style="font-size:20px;font-weight:700;color:#27ae60;margin-top:4px">' + getCurrency() + Number(rec.amount).toLocaleString() + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + '">' + new Date(rec.date).toLocaleDateString() + '</div></div>'
        : '<div style="background:#e67e2218;border-radius:10px;padding:12px;margin-bottom:16px">'
          + '<div style="font-size:12px;color:#e67e22;font-weight:600">\u23F3 Pendiente este mes</div>'
          + (bill.estimatedAmount ? '<div style="font-size:14px;color:' + t.muted + ';margin-top:4px">Estimado: ' + getCurrency() + Number(bill.estimatedAmount).toLocaleString() + '</div>' : '')
          + '</div>';

      actCard.innerHTML = '<div style="text-align:center;margin-bottom:16px">'
        + '<div style="font-size:36px;margin-bottom:8px">' + cat.icon + '</div>'
        + '<div style="font-weight:700;font-size:16px">' + escapeHtml(bill.name) + '</div>'
        + '<div style="font-size:12px;color:' + t.muted + '">' + cat.label + '</div></div>'
        + statusHtml
        + '<div style="display:flex;flex-direction:column;gap:8px">'
        + '<button class="dc-rb-register" style="width:100%;padding:11px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-size:14px;font-weight:600;cursor:pointer">' + (rec ? '\uD83D\uDD04 Actualizar Monto' : '\uD83D\uDCB0 Registrar Monto') + '</button>'
        + '<button class="dc-rb-delete" style="width:100%;padding:11px;border-radius:10px;border:1px solid #e74c3c;background:transparent;color:#e74c3c;font-size:14px;font-weight:600;cursor:pointer">\uD83D\uDDD1\uFE0F Eliminar Servicio</button>'
        + '<button class="dc-rb-back" style="width:100%;padding:11px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:14px;font-weight:600;cursor:pointer">Volver</button></div>';

      actOverlay.appendChild(actCard);
      document.body.appendChild(actOverlay);
      actOverlay.addEventListener('click', function(e) { if (e.target === actOverlay) actOverlay.remove(); });
      actCard.querySelector('.dc-rb-back').addEventListener('click', function() { actOverlay.remove(); });

      actCard.querySelector('.dc-rb-register').addEventListener('click', async function() {
        var defVal = rec ? String(rec.amount) : (bill.estimatedAmount ? String(bill.estimatedAmount) : '');
        var val = await dcPrompt('\uD83D\uDCB0 Monto de ' + bill.name + ' (' + getMonthLabel(month) + ')', {
          icon: cat.icon, placeholder: '0.00', defaultValue: defVal, inputType: 'number'
        });
        if (val === null || val === '') return;
        var amount = parseFloat(val);
        if (isNaN(amount) || amount < 0) { showToast('\u26A0\uFE0F Monto inv\u00e1lido'); return; }
        if (!records[billId]) records[billId] = {};
        records[billId][month] = { amount: amount, date: new Date().toISOString() };
        saveRecurringRecords(records);
        showToast('\u2705 Monto registrado: ' + getCurrency() + amount.toLocaleString());
        actOverlay.remove();
        render();
      });

      actCard.querySelector('.dc-rb-delete').addEventListener('click', async function() {
        var ok = await dcConfirm('\u00BFEliminar "' + bill.name + '" de tus gastos recurrentes?', { danger: true });
        if (!ok) return;
        bills = bills.filter(function(b) { return b.id !== billId; });
        saveRecurringBills(bills);
        delete records[billId];
        saveRecurringRecords(records);
        showToast('\uD83D\uDDD1\uFE0F Servicio eliminado');
        actOverlay.remove();
        render();
      });
    }

    function showRecurringHistory() {
      var histOverlay = document.createElement('div');
      histOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';

      var histCard = document.createElement('div');
      histCard.style.cssText = 'background:' + t.bg + ';color:' + t.txt + ';border-radius:16px;max-width:420px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.3)';

      // Recolectar todos los meses con registros
      var allMonths = {};
      Object.keys(records).forEach(function(billId) {
        Object.keys(records[billId]).forEach(function(m) { allMonths[m] = true; });
      });
      var sortedMonths = Object.keys(allMonths).sort().reverse();

      var histHtml = '';
      if (!sortedMonths.length) {
        histHtml = '<div style="text-align:center;padding:30px;color:' + t.muted + '">No hay registros a\u00fan</div>';
      } else {
        sortedMonths.forEach(function(m) {
          var monthTotal = 0;
          var rows = '';
          bills.forEach(function(bill) {
            var rec = records[bill.id] && records[bill.id][m];
            if (rec) {
              var catObj = RECURRING_CATEGORIES.find(function(c) { return c.id === bill.category; }) || RECURRING_CATEGORIES[RECURRING_CATEGORIES.length - 1];
              monthTotal += Number(rec.amount) || 0;
              rows += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px">'
                + '<span>' + catObj.icon + ' ' + escapeHtml(bill.name) + '</span>'
                + '<span style="font-weight:600">' + getCurrency() + Number(rec.amount).toLocaleString() + '</span></div>';
            }
          });
          histHtml += '<div style="margin-bottom:16px">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
            + '<div style="font-weight:700;font-size:14px">\uD83D\uDCC5 ' + getMonthLabel(m) + '</div>'
            + '<div style="font-weight:700;color:#007AFF;font-size:14px">' + getCurrency() + monthTotal.toLocaleString() + '</div></div>'
            + rows + '</div>';
        });
      }

      histCard.innerHTML = '<div style="padding:18px 20px 14px;border-bottom:1px solid ' + t.border + ';display:flex;justify-content:space-between;align-items:center">'
        + '<div style="font-weight:700;font-size:16px">\uD83D\uDCCA Historial de Gastos Fijos</div>'
        + '<button class="dc-rbh-close" style="background:none;border:none;cursor:pointer;font-size:20px;color:' + t.muted + '">\u2715</button></div>'
        + '<div style="padding:16px 20px;overflow-y:auto;flex:1">' + histHtml + '</div>'
        + '<div style="padding:12px 20px;border-top:1px solid ' + t.border + '">'
        + '<button class="dc-rbh-close2" style="width:100%;padding:10px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Cerrar</button></div>';

      histOverlay.appendChild(histCard);
      document.body.appendChild(histOverlay);
      histOverlay.addEventListener('click', function(e) { if (e.target === histOverlay) histOverlay.remove(); });
      histCard.querySelector('.dc-rbh-close').addEventListener('click', function() { histOverlay.remove(); });
      histCard.querySelector('.dc-rbh-close2').addEventListener('click', function() { histOverlay.remove(); });
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    render();
  }

  // Verificar pagos recurrentes pendientes al inicio del mes
  async function checkRecurringPayments() {
    var bills = getRecurringBills().filter(function(b) { return b.active !== false; });
    if (!bills.length) return;

    var month = getCurrentMonth();
    var checkedKey = localStorage.getItem(LS_RECURRING_CHECKED);
    // Si ya revisamos este mes hoy, no volver a preguntar
    var today = new Date().toISOString().slice(0, 10);
    if (checkedKey === month + '_' + today) return;

    var records = getRecurringRecords();
    var pending = bills.filter(function(bill) {
      return !(records[bill.id] && records[bill.id][month]);
    });

    if (!pending.length) {
      localStorage.setItem(LS_RECURRING_CHECKED, month + '_' + today);
      return;
    }

    var t = getThemeColors();
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';

    var card = document.createElement('div');
    card.style.cssText = 'background:' + t.bg + ';color:' + t.txt + ';border-radius:18px;max-width:400px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)';

    var listHtml = pending.map(function(bill) {
      var cat = RECURRING_CATEGORIES.find(function(c) { return c.id === bill.category; }) || RECURRING_CATEGORIES[RECURRING_CATEGORIES.length - 1];
      return '<div class="dc-rbc-item" data-id="' + bill.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + t.inputBg + ';border-radius:10px;margin-bottom:8px;cursor:pointer">'
        + '<div style="font-size:22px;width:32px;text-align:center">' + cat.icon + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-weight:600;font-size:14px">' + escapeHtml(bill.name) + '</div>'
        + (bill.estimatedAmount ? '<div style="font-size:11px;color:' + t.muted + '">Estimado: ' + getCurrency() + Number(bill.estimatedAmount).toLocaleString() + '</div>' : '')
        + '</div>'
        + '<div style="font-size:13px;color:#e67e22;font-weight:600">\uD83D\uDCB0 Registrar</div></div>';
    }).join('');

    card.innerHTML = '<div style="padding:18px 20px 14px;border-bottom:1px solid ' + t.border + '">'
      + '<div style="font-weight:700;font-size:17px">\uD83D\uDD14 Gastos Pendientes de ' + getMonthLabel(month) + '</div>'
      + '<div style="font-size:12px;color:' + t.muted + ';margin-top:4px">Tienes ' + pending.length + ' servicio' + (pending.length > 1 ? 's' : '') + ' sin registrar este mes</div></div>'
      + '<div style="padding:16px 20px;overflow-y:auto;flex:1">' + listHtml + '</div>'
      + '<div style="padding:12px 20px;border-top:1px solid ' + t.border + ';display:flex;gap:8px">'
      + '<button class="dc-rbc-later" style="flex:1;padding:10px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';color:' + t.txt + ';font-size:13px;font-weight:600;cursor:pointer">Recordar despu\u00e9s</button>'
      + '<button class="dc-rbc-dismiss" style="flex:1;padding:10px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Lo har\u00e9 luego</button></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    card.querySelector('.dc-rbc-later').addEventListener('click', function() { overlay.remove(); });
    card.querySelector('.dc-rbc-dismiss').addEventListener('click', function() {
      localStorage.setItem(LS_RECURRING_CHECKED, month + '_' + today);
      overlay.remove();
    });

    card.querySelectorAll('.dc-rbc-item').forEach(function(el) {
      el.addEventListener('click', async function() {
        var billId = el.getAttribute('data-id');
        var bill = pending.find(function(b) { return b.id === billId; });
        if (!bill) return;
        var cat = RECURRING_CATEGORIES.find(function(c) { return c.id === bill.category; }) || RECURRING_CATEGORIES[RECURRING_CATEGORIES.length - 1];
        var defVal = bill.estimatedAmount ? String(bill.estimatedAmount) : '';
        var val = await dcPrompt('\uD83D\uDCB0 Monto de ' + bill.name + ' (' + getMonthLabel(month) + ')', {
          icon: cat.icon, placeholder: '0.00', defaultValue: defVal, inputType: 'number'
        });
        if (val === null || val === '') return;
        var amount = parseFloat(val);
        if (isNaN(amount) || amount < 0) { showToast('\u26A0\uFE0F Monto inv\u00e1lido'); return; }
        if (!records[billId]) records[billId] = {};
        records[billId][month] = { amount: amount, date: new Date().toISOString() };
        saveRecurringRecords(records);
        showToast('\u2705 ' + bill.name + ': ' + getCurrency() + amount.toLocaleString());
        // Actualizar visual: remover item del listado
        el.style.opacity = '0.4';
        el.style.pointerEvents = 'none';
        el.querySelector('div:last-child').textContent = '\u2705';
        el.querySelector('div:last-child').style.color = '#27ae60';
        // Si ya no quedan pendientes, cerrar
        var remaining = card.querySelectorAll('.dc-rbc-item:not([style*="opacity: 0.4"])');
        if (remaining.length <= 1) {
          setTimeout(function() { overlay.remove(); }, 800);
        }
      });
    });
  }

  // ============================================================
  // PDF Export (jsPDF)
  // ============================================================
  async function exportToPDF() {
    showToast('\uD83D\uDCC4 Generando PDF...');
    try {
      // Cargar jsPDF si no estÃ¡ disponible
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
          var name = (dn(d) || d.description || 'Sin nombre').substring(0, 30);
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

      // Ãšltimos Pagos
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
      // Incluir datos localStorage en la data para sync
      data._recurringBills = localStorage.getItem(LS_RECURRING_BILLS) || '[]';
      data._recurringRecords = localStorage.getItem(LS_RECURRING_RECORDS) || '{}';
      data._achievements = localStorage.getItem(LS_ACHIEVEMENTS) || '[]';
      data._paidDebts = localStorage.getItem(LS_PAID_DEBTS) || '[]';
      data._debtPlans = localStorage.getItem(LS_DEBT_PLANS) || '{}';
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
      // Restaurar datos localStorage desde la nube
      if (data._recurringBills) localStorage.setItem(LS_RECURRING_BILLS, data._recurringBills);
      if (data._recurringRecords) localStorage.setItem(LS_RECURRING_RECORDS, data._recurringRecords);
      if (data._achievements) localStorage.setItem(LS_ACHIEVEMENTS, data._achievements);
      if (data._paidDebts) localStorage.setItem(LS_PAID_DEBTS, data._paidDebts);
      if (data._debtPlans) localStorage.setItem(LS_DEBT_PLANS, data._debtPlans);
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

    // BotÃ³n limpiar historial
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

      var name = dn(d) || d.description || 'Deuda';
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
            return (p.debtId === d.id || p.debtName === dn(d)) &&
                   pDate.getMonth() === month && pDate.getFullYear() === year;
          });
          events[day].push({
            name: dn(d) || 'Deuda',
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

      // DÃ­as del mes
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
  // ConfiguraciÃ³n de moneda
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
  // SesiÃ³n configurable (UI)
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
  // Panel configuraciÃ³n Firebase (ARREGLADO: sin XSS)
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
  // Limpieza de datos huÃ©rfanos
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
        nextDue = { date: due, name: dn(d) || 'Deuda', amount: parseFloat(d.monthlyPayment || d.cuota || d.amount || d.monto || 0) };
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
        var name = dn(d) || 'Deuda';
        var total = parseFloat(d.amount || d.totalAmount || d.monto || 0);
        if (total <= 0) return;
        var debtPayments = payments.filter(function(p) {
          return p.debtId === d.id || p.debtName === dn(d);
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

      // BotÃ³n copiar tabla
      html += '<button class="dc-amort-copy" style="width:100%;padding:12px;border:1px solid ' + t.border + ';border-radius:10px;background:transparent;color:' + t.txt + ';font-size:13px;cursor:pointer;margin-top:10px">\uD83D\uDCCB Copiar Tabla al Portapapeles</button>';

      card.querySelector('.dc-amort-result').innerHTML = html;

      // Generar texto plano para copiar
      card.querySelector('.dc-amort-copy').addEventListener('click', function() {
        var lines = ['# AmortizaciÃ³n - ' + currency + formatNumber(amount) + ' al ' + annualRate + '% en ' + months + ' meses'];
        lines.push('Cuota mensual: ' + currency + formatNumber(payment));
        lines.push('Total a pagar: ' + currency + formatNumber(totalPaid));
        lines.push('Total intereses: ' + currency + formatNumber(totalInterest));
        lines.push('');
        lines.push('#\tCuota\tCapital\tInterÃ©s\tSaldo');
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
      var name = dn(d) || 'Deuda ' + (idx + 1);
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
          name: dn(d) || 'Deuda',
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
    try {
      if (!guard || !guard.isWebAuthnAvailable || !guard.isWebAuthnAvailable()) {
        showToast('\u274C Tu dispositivo no soporta autenticaci\u00f3n biom\u00e9trica');
        return;
      }
    } catch (e) {
      showToast('\u274C Biometr\u00eda no disponible');
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
  // UI: BotÃ³n flotante y menÃº
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
      + '@keyframes dcSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}'
      + '#dc-sync-fab{transition:transform 0.15s,box-shadow 0.15s}'
      + '#dc-sync-fab:active{transform:scale(0.88)!important}'
      + '.dc-hub-overlay{animation:dcFadeIn 0.2s ease}'
      + '.dc-hub-card{animation:dcSlideUp 0.25s ease}'
      + '.dc-hub-tile{transition:transform 0.12s,box-shadow 0.12s}'
      + '.dc-hub-tile:active{transform:scale(0.93)!important}'
      + '.dc-hub-cat-btn{transition:background 0.15s,color 0.15s}'
      + '.dc-hub-card{scrollbar-width:thin}';
    document.head.appendChild(style);

    // FAB - Bot\u00f3n flotante principal
    var fab = document.createElement('button');
    fab.id = 'dc-sync-fab';
    fab.innerHTML = '\u2699\uFE0F';
    Object.assign(fab.style, {
      position: 'fixed', bottom: '100px', right: '16px', width: '54px', height: '54px',
      borderRadius: '50%', border: 'none',
      background: 'linear-gradient(135deg, #007AFF, #5856D6)',
      color: 'white', fontSize: '24px', cursor: 'pointer', zIndex: '9998',
      boxShadow: '0 4px 18px rgba(0,122,255,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    fab.addEventListener('click', function(e) { e.stopPropagation(); toggleMenu(); });
    document.body.appendChild(fab);

    updateFabBadge();
    new MutationObserver(function() { updateFabBadge(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Atajos de teclado
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var hub = document.getElementById('dc-hub-overlay');
        if (hub) { hub.remove(); return; }
        var overlays = document.querySelectorAll('.dc-modal-overlay, #dc-calendar-overlay, #dc-setup-overlay, #dc-change-code-modal');
        if (overlays.length > 0) {
          overlays[overlays.length - 1].remove();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        var tag = (document.activeElement || {}).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        var hasModal = document.querySelector('.dc-modal-overlay, #dc-calendar-overlay, #dc-setup-overlay, #dc-change-code-modal, #dc-hub-overlay');
        if (hasModal) return;
        var key = e.key.toLowerCase();
        var shortcut = {
          'e': exportToJSON,
          'p': exportToPDF,
          'u': syncToCloud,
          'd': syncFromCloud,
          'f': showFinancialSummary,
          'k': showCalendar
        };
        if (shortcut[key]) {
          e.preventDefault();
          if (navigator.vibrate) navigator.vibrate(10);
          shortcut[key]();
        }
      }
    });
  }

  function toggleMenu() {
    var existing = document.getElementById('dc-hub-overlay');
    if (existing) { existing.remove(); return; }
    showControlHub();
  }

  function showControlHub() {
    var t = getThemeColors();

    var categories = [
      {
        id: 'quick', label: 'Inicio', icon: '\u26A1',
        tiles: [
          { icon: '\uD83D\uDCCA', label: 'Resumen', action: showFinancialSummary, color: '#007AFF' },
          { icon: '\uD83D\uDCC5', label: 'Calendario', action: showCalendar, color: '#5856D6' },
          { icon: '\uD83D\uDD04', label: 'Recurrentes', action: showRecurringPayments, color: '#FF9500' },
          { icon: '\uD83C\uDFC6', label: 'Logros', action: showAchievementsScreen, color: '#34C759' }
        ]
      },
      {
        id: 'tools', label: 'Herramientas', icon: '\uD83E\uDDEE',
        tiles: [
          { icon: '\uD83E\uDDEE', label: 'Amortizaci\u00f3n', action: showAmortizationCalc, color: '#007AFF' },
          { icon: '\u2696\uFE0F', label: 'Snowball vs Avalanche', action: showDebtStrategy, color: '#5856D6' },
          { icon: '\uD83D\uDCC9', label: 'Ratio Deuda', action: showDTICalculator, color: '#FF3B30' },
          { icon: '\uD83C\uDFC1', label: 'Libre de Deudas', action: showDebtFreeDate, color: '#34C759' },
          { icon: '\uD83D\uDD0D', label: 'Comparar Pr\u00e9stamos', action: showLoanComparator, color: '#FF9500' },
          { icon: '\uD83D\uDCCA', label: 'Por Categor\u00eda', action: showCategoryBreakdown, color: '#AF52DE' },
          { icon: '\uD83E\uDD1D', label: 'Convenio', action: showPaymentAgreement, color: '#007AFF' }
        ]
      },
      {
        id: 'progress', label: 'Progreso', icon: '\uD83C\uDFC6',
        tiles: [
          { icon: '\u2705', label: 'Liquidar Deuda', action: showMarkDebtPaid, color: '#34C759' },
          { icon: '\uD83D\uDCCB', label: 'Historial', action: showDebtHistory, color: '#5856D6' }
        ]
      },
      {
        id: 'cloud', label: 'Nube y Backup', icon: '\u2601\uFE0F',
        tiles: [
          { icon: '\u2B06\uFE0F', label: 'Subir', action: syncToCloud, color: '#007AFF' },
          { icon: '\u2B07\uFE0F', label: 'Descargar', action: syncFromCloud, color: '#34C759' },
          { icon: '\u23EA', label: 'Revertir', action: restorePreSyncSnapshot, color: '#FF9500' },
          { icon: '\uD83D\uDCE5', label: 'Backup JSON', action: exportToJSON, color: '#5856D6' },
          { icon: '\uD83D\uDCC4', label: 'Reporte PDF', action: exportToPDF, color: '#FF3B30' },
          { icon: '\uD83D\uDCCA', label: 'CSV Excel', action: exportToCSV, color: '#007AFF' },
          { icon: '\uD83D\uDCE4', label: 'Importar', action: importFromJSON, color: '#FF9500' }
        ]
      },
      {
        id: 'settings', label: 'Ajustes', icon: '\u2699\uFE0F',
        tiles: [
          { icon: '\u2699\uFE0F', label: 'Firebase', action: showFirebaseSetup, color: '#FF9500' },
          { icon: '\uD83D\uDD14', label: 'Notificaciones', action: showNotificationConfig, color: '#FF3B30' },
          { icon: '\uD83D\uDCB1', label: 'Moneda', action: showCurrencyConfig, color: '#34C759' },
          { icon: '\uD83C\uDF19', label: 'Tema', action: toggleTheme, color: '#5856D6' },
          { icon: '\u23F0', label: 'Sesi\u00f3n', action: showSessionConfig, color: '#007AFF' },
          { icon: '\uD83D\uDD12', label: 'C\u00f3digo', action: function() { if (window.DebtControlGuard) window.DebtControlGuard.changeCode(); else showToast('Guard no disponible'); }, color: '#FF3B30' },
          { icon: '\uD83D\uDD10', label: 'Biometr\u00eda', action: showBiometricConfig, color: '#AF52DE' },
          { icon: '\uD83D\uDCCB', label: 'Historial Sync', action: showSyncHistory, color: '#8E8E93' }
        ]
      }
    ];

    var activeCategory = 'quick';

    var overlay = document.createElement('div');
    overlay.id = 'dc-hub-overlay';
    overlay.className = 'dc-hub-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
      zIndex: '10000', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    var card = document.createElement('div');
    card.className = 'dc-hub-card';
    Object.assign(card.style, {
      background: t.bg, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: '480px',
      maxHeight: '85vh', display: 'flex', flexDirection: 'column',
      boxShadow: '0 -8px 40px rgba(0,0,0,0.25)', color: t.txt, overflow: 'hidden'
    });

    function renderHub() {
      var cat = categories.find(function(c) { return c.id === activeCategory; });

      // Handle - barra superior para arrastrar
      var headerHtml = '<div style="display:flex;justify-content:center;padding:10px 0 4px"><div style="width:40px;height:4px;border-radius:2px;background:' + t.border + '"></div></div>';

      // Header con t\u00edtulo y botones
      headerHtml += '<div style="padding:8px 20px 12px;display:flex;justify-content:space-between;align-items:center">'
        + '<div style="font-size:20px;font-weight:700">DebtControl Pro</div>'
        + '<div style="display:flex;gap:6px;align-items:center">'
        + '<button class="dc-hub-install" style="background:' + t.inputBg + ';border:none;border-radius:10px;width:34px;height:34px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center" title="Instalar App">\uD83D\uDCF2</button>'
        + '<button class="dc-hub-about" style="background:' + t.inputBg + ';border:none;border-radius:10px;width:34px;height:34px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center" title="Acerca de">\u2139\uFE0F</button>'
        + '<button class="dc-hub-lock" style="background:' + t.inputBg + ';border:none;border-radius:10px;width:34px;height:34px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center" title="Bloquear">\uD83D\uDD12</button>'
        + '<button class="dc-hub-close" style="background:' + t.inputBg + ';border:none;border-radius:10px;width:34px;height:34px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;color:' + t.txt + '" title="Cerrar">\u2715</button>'
        + '</div></div>';

      // Pesta\u00f1as de categor\u00edas
      headerHtml += '<div style="padding:0 16px 14px;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none">';
      categories.forEach(function(c) {
        var isActive = c.id === activeCategory;
        headerHtml += '<button class="dc-hub-cat-btn" data-cat="' + c.id + '" style="'
          + 'flex-shrink:0;padding:8px 14px;border-radius:20px;border:none;cursor:pointer;font-size:13px;font-weight:600;'
          + 'white-space:nowrap;'
          + (isActive
            ? 'background:linear-gradient(135deg,#007AFF,#5856D6);color:#fff;box-shadow:0 2px 8px rgba(0,122,255,0.3);'
            : 'background:' + t.inputBg + ';color:' + t.muted + ';')
          + '">' + c.icon + ' ' + c.label + '</button>';
      });
      headerHtml += '</div>';

      // Grid de tiles
      var cols = cat.tiles.length <= 4 ? 'repeat(' + Math.min(cat.tiles.length, 4) + ',1fr)' : 'repeat(4,1fr)';
      var tilesHtml = '<div style="padding:0 16px 20px;overflow-y:auto;flex:1">';
      tilesHtml += '<div style="display:grid;grid-template-columns:' + cols + ';gap:10px">';
      cat.tiles.forEach(function(tile, idx) {
        tilesHtml += '<button class="dc-hub-tile" data-idx="' + idx + '" style="'
          + 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 6px 12px;'
          + 'border-radius:16px;border:none;cursor:pointer;'
          + 'background:' + t.inputBg + ';color:' + t.txt + ';'
          + '">'
          + '<div style="width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:22px;'
          + 'background:' + tile.color + '18;'
          + '">' + tile.icon + '</div>'
          + '<div style="font-size:11px;font-weight:600;text-align:center;line-height:1.25">' + tile.label + '</div>'
          + '</button>';
      });
      tilesHtml += '</div></div>';

      // Footer
      var footerHtml = '<div style="padding:10px 16px 16px;border-top:1px solid ' + t.border + '">'
        + '<button class="dc-hub-logout" style="width:100%;padding:11px;border-radius:12px;border:1px solid ' + t.border + ';background:transparent;color:' + t.muted + ';font-size:13px;font-weight:600;cursor:pointer">\uD83D\uDEAA Cerrar Sesi\u00f3n</button>'
        + '</div>';

      card.innerHTML = headerHtml + tilesHtml + footerHtml;

      // Events
      card.querySelector('.dc-hub-close').addEventListener('click', function() { overlay.remove(); });
      card.querySelector('.dc-hub-install').addEventListener('click', function() { overlay.remove(); installApp(); });
      card.querySelector('.dc-hub-about').addEventListener('click', function() { overlay.remove(); showAbout(); });
      card.querySelector('.dc-hub-lock').addEventListener('click', function() {
        overlay.remove();
        if (window.DebtControlGuard) window.DebtControlGuard.lock();
        else { localStorage.removeItem('debtcontrol_auth_session'); location.reload(); }
      });
      card.querySelector('.dc-hub-logout').addEventListener('click', function() {
        overlay.remove();
        if (window.DebtControlGuard) window.DebtControlGuard.logout();
        else { localStorage.removeItem('debtcontrol_auth_session'); location.reload(); }
      });

      card.querySelectorAll('.dc-hub-cat-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          activeCategory = btn.getAttribute('data-cat');
          renderHub();
        });
      });

      card.querySelectorAll('.dc-hub-tile').forEach(function(el) {
        el.addEventListener('click', function() {
          var idx = parseInt(el.getAttribute('data-idx'));
          if (navigator.vibrate) navigator.vibrate(10);
          overlay.remove();
          if (cat.tiles[idx] && cat.tiles[idx].action) cat.tiles[idx].action();
        });
      });
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    renderHub();
  }

  function applyMenuTheme() {
    // El hub se re-renderiza cada vez con colores actuales
  }

  // ============================================================
  // Auto-backup local (fix: tamaÃ±o controlado)
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
  // Debt Enhancer - Plan de Pagos integrado en formulario
  // ============================================================
  var LS_DEBT_PLANS = 'debtcontrol_debt_plans';

  function getDebtPlans() {
    try { return JSON.parse(localStorage.getItem(LS_DEBT_PLANS)) || {}; } catch (e) { return {}; }
  }

  function saveDebtPlans(plans) {
    localStorage.setItem(LS_DEBT_PLANS, JSON.stringify(plans));
  }

  function generateInstallments(config) {
    var installments = [];
    var startDate = new Date(config.startDate + 'T00:00:00');
    var amount = config.installmentAmount;
    var interestRate = config.interestRate || 0;
    var balance = config.totalAmount;
    var monthlyRate = interestRate / 100 / 12;

    for (var i = 0; i < config.totalInstallments; i++) {
      var dueDate = new Date(startDate);

      if (config.frequency === 'weekly') {
        dueDate.setDate(dueDate.getDate() + (i * 7));
      } else if (config.frequency === 'biweekly') {
        dueDate.setDate(dueDate.getDate() + (i * 14));
      } else {
        dueDate.setMonth(dueDate.getMonth() + i);
      }

      var interest = balance * monthlyRate;
      var principal = amount - interest;
      if (i === config.totalInstallments - 1) {
        principal = balance;
        amount = balance + interest;
      }
      if (principal < 0) principal = 0;

      installments.push({
        number: i + 1,
        dueDate: dueDate.toISOString().split('T')[0],
        amount: Math.round(amount * 100) / 100,
        principal: Math.round(principal * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        paid: false,
        paidDate: null,
        paidAmount: 0
      });

      balance -= principal;
      if (balance < 0) balance = 0;
    }
    return installments;
  }

  function calcInstallmentAmount(total, months, annualRate) {
    if (!annualRate || annualRate <= 0) return Math.round((total / months) * 100) / 100;
    var r = annualRate / 100 / 12;
    var pmt = total * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
    return Math.round(pmt * 100) / 100;
  }

  // ============================================================
  // Inyectar campos de Plan de Pagos en formulario React
  // ============================================================
  function initDebtFormEnhancer() {
    if (window._dcFormObserver) return;
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType === 1) {
            checkAndEnhanceForm(nodes[j]);
            checkAndEnhanceCards(nodes[j]);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window._dcFormObserver = observer;
  }

  function checkAndEnhanceForm(node) {
    // Buscar el header de "Nueva Deuda" o "Editar Deuda"
    var headers = node.querySelectorAll ? node.querySelectorAll('h2') : [];
    var formHeader = null;
    var isEdit = false;
    for (var i = 0; i < headers.length; i++) {
      var txt = headers[i].textContent || '';
      if (txt.indexOf('Nueva Deuda') >= 0) { formHeader = headers[i]; break; }
      if (txt.indexOf('Editar Deuda') >= 0) { formHeader = headers[i]; isEdit = true; break; }
    }
    if (!formHeader) {
      // Check if node itself is h2
      if (node.tagName === 'H2') {
        var t = node.textContent || '';
        if (t.indexOf('Nueva Deuda') >= 0) formHeader = node;
        else if (t.indexOf('Editar Deuda') >= 0) { formHeader = node; isEdit = true; }
      }
    }
    if (!formHeader) return;

    // Buscar el form
    var container = formHeader.closest ? formHeader.closest('div') : null;
    if (!container) return;
    var forms = container.querySelectorAll('form');
    if (!forms || forms.length === 0) {
      var parent = container.parentElement;
      forms = parent ? parent.querySelectorAll('form') : [];
    }
    if (!forms || forms.length === 0) return;
    var form = forms[forms.length - 1];

    // evitar doble inyeccion
    if (form.getAttribute('data-dc-enhanced')) return;
    form.setAttribute('data-dc-enhanced', 'true');

    // Esperar a que React renderice completamente
    setTimeout(function() { injectPlanFields(form, isEdit); }, 200);
  }

  function injectPlanFields(form, isEdit) {
    var t = getThemeColors();
    var currency = getCurrency();

    // Encontrar el campo de notas (textarea) para insertar antes de el
    var textareas = form.querySelectorAll('textarea');
    var insertBefore = null;
    if (textareas.length > 0) {
      insertBefore = textareas[textareas.length - 1].closest('div[style]');
      if (insertBefore) insertBefore = insertBefore.parentElement ? insertBefore : null;
    }
    // Si no hay textarea, insertar antes de los botones
    if (!insertBefore) {
      var btns = form.querySelectorAll('button[type="submit"]');
      if (btns.length > 0) insertBefore = btns[0].closest('div');
    }

    var planSection = document.createElement('div');
    planSection.id = 'dc-plan-section';
    planSection.style.cssText = 'margin-bottom:20px;border:1px solid ' + t.border + ';border-radius:12px;overflow:hidden';

    var headerStyle = 'padding:14px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;background:' + t.inputBg;
    planSection.innerHTML = '<div class="dc-plan-header" style="' + headerStyle + '">'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:18px">\uD83D\uDCC5</span>'
      + '<span style="font-weight:600;font-size:15px;color:' + t.txt + '">Plan de Pagos</span>'
      + '</div>'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="event.stopPropagation()">'
      + '<span style="font-size:12px;color:' + t.muted + '">Activar</span>'
      + '<input type="checkbox" id="dc-plan-enabled" style="width:18px;height:18px;accent-color:#007AFF">'
      + '</label>'
      + '</div>'
      + '<div id="dc-plan-body" style="display:none;padding:16px;border-top:1px solid ' + t.border + '">'

      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'
      + '<div>'
      + '<label style="display:block;margin-bottom:6px;color:' + t.txt + ';font-weight:500;font-size:13px">N\u00BA de Pagos *</label>'
      + '<input type="number" id="dc-plan-installments" min="2" max="360" value="12" style="width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.bg + ';color:' + t.txt + ';font-size:15px;box-sizing:border-box">'
      + '</div>'
      + '<div>'
      + '<label style="display:block;margin-bottom:6px;color:' + t.txt + ';font-weight:500;font-size:13px">Frecuencia</label>'
      + '<select id="dc-plan-frequency" style="width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.bg + ';color:' + t.txt + ';font-size:15px;box-sizing:border-box">'
      + '<option value="monthly">Mensual</option>'
      + '<option value="biweekly">Quincenal</option>'
      + '<option value="weekly">Semanal</option>'
      + '</select>'
      + '</div>'
      + '</div>'

      + '<div style="margin-bottom:12px">'
      + '<label style="display:block;margin-bottom:6px;color:' + t.txt + ';font-weight:500;font-size:13px">Fecha Primer Pago *</label>'
      + '<input type="date" id="dc-plan-start" style="width:100%;padding:12px;border-radius:10px;border:1px solid ' + t.border + ';background:' + t.bg + ';color:' + t.txt + ';font-size:15px;box-sizing:border-box">'
      + '</div>'

      + '<div id="dc-plan-preview" style="background:' + t.inputBg + ';border-radius:10px;padding:14px;margin-top:12px;display:none">'
      + '<div style="font-size:13px;font-weight:600;color:' + t.txt + ';margin-bottom:8px">\uD83D\uDCCA Vista Previa</div>'
      + '<div id="dc-plan-preview-content"></div>'
      + '</div>'

      + '</div>';

    if (insertBefore && insertBefore.parentNode === form) {
      form.insertBefore(planSection, insertBefore);
    } else {
      // Insertar antes del ultimo div (botones)
      var children = form.children;
      if (children.length > 1) {
        form.insertBefore(planSection, children[children.length - 1]);
      } else {
        form.appendChild(planSection);
      }
    }

    // Event handlers
    var toggle = planSection.querySelector('#dc-plan-enabled');
    var body = planSection.querySelector('#dc-plan-body');
    var instInput = planSection.querySelector('#dc-plan-installments');
    var freqInput = planSection.querySelector('#dc-plan-frequency');
    var startInput = planSection.querySelector('#dc-plan-start');

    // Default start date: tomorrow
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    startInput.value = tomorrow.toISOString().split('T')[0];

    toggle.addEventListener('change', function() {
      body.style.display = toggle.checked ? 'block' : 'none';
      if (toggle.checked) updatePlanPreview();
    });

    // Auto-update preview
    [instInput, freqInput, startInput].forEach(function(el) {
      el.addEventListener('change', updatePlanPreview);
      el.addEventListener('input', updatePlanPreview);
    });

    // Also listen to amount and interestRate fields in the React form
    var amountInputs = form.querySelectorAll('input[type="number"]');
    amountInputs.forEach(function(inp) {
      inp.addEventListener('input', function() {
        setTimeout(updatePlanPreview, 100);
      });
    });

    function getFormValues() {
      var amount = 0;
      var rate = 0;
      var numInputs = form.querySelectorAll('input[type="number"]');
      // First number input is amount, second is interest rate (by React form order)
      if (numInputs.length >= 1) amount = parseFloat(numInputs[0].value) || 0;
      if (numInputs.length >= 2) rate = parseFloat(numInputs[numInputs.length - 1].value) || 0;
      return { amount: amount, rate: rate };
    }

    function updatePlanPreview() {
      if (!toggle.checked) return;
      var preview = planSection.querySelector('#dc-plan-preview');
      var content = planSection.querySelector('#dc-plan-preview-content');
      var vals = getFormValues();
      var months = parseInt(instInput.value) || 0;

      if (vals.amount <= 0 || months < 2) {
        preview.style.display = 'none';
        return;
      }

      var pmt = calcInstallmentAmount(vals.amount, months, vals.rate);
      var totalPaid = pmt * months;
      var totalInterest = totalPaid - vals.amount;
      var freqLabel = freqInput.value === 'weekly' ? 'semanal' : freqInput.value === 'biweekly' ? 'quincenal' : 'mensual';

      preview.style.display = 'block';
      content.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">'
        + '<div style="color:' + t.muted + '">Pago ' + freqLabel + ':</div>'
        + '<div style="font-weight:700;color:#007AFF;text-align:right">' + currency + formatNumber(pmt) + '</div>'
        + '<div style="color:' + t.muted + '">Total a pagar:</div>'
        + '<div style="font-weight:600;text-align:right;color:' + t.txt + '">' + currency + formatNumber(totalPaid) + '</div>'
        + (totalInterest > 0 ? '<div style="color:' + t.muted + '">Inter\u00e9s total:</div>'
        + '<div style="font-weight:600;text-align:right;color:#FF3B30">' + currency + formatNumber(totalInterest) + '</div>' : '')
        + '<div style="color:' + t.muted + '">Primer pago:</div>'
        + '<div style="text-align:right;color:' + t.txt + '">' + (startInput.value ? new Date(startInput.value + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '-') + '</div>'
        + '</div>';
    }

    // Hook form submission
    form.addEventListener('submit', function() {
      if (!toggle.checked) return;

      var vals = getFormValues();
      var months = parseInt(instInput.value) || 12;
      var pmt = calcInstallmentAmount(vals.amount, months, vals.rate);

      var planConfig = {
        enabled: true,
        totalInstallments: months,
        frequency: freqInput.value,
        startDate: startInput.value,
        installmentAmount: pmt,
        totalAmount: vals.amount,
        interestRate: vals.rate,
        createdAt: new Date().toISOString()
      };
      planConfig.installments = generateInstallments(planConfig);

      // Guardar temporalmente, se asociara al debt despues
      window._dcPendingPlan = planConfig;

      // Observar localforage para capturar el debt ID
      setTimeout(function() { associatePlanToDebt(planConfig); }, 500);
    });

    // Si estamos editando, cargar plan existente
    if (isEdit) {
      setTimeout(function() { loadExistingPlan(form, toggle, instInput, freqInput, startInput, body); }, 400);
    }
  }

  async function associatePlanToDebt(planConfig) {
    var lf = getLocalForage();
    if (!lf) return;

    // Leer debts y encontrar la mas reciente
    var debts = await lf.getItem('debts') || [];
    if (debts.length === 0) return;

    // Ordenar por createdAt o id para encontrar la ultima
    var sorted = debts.slice().sort(function(a, b) {
      var ta = a.createdAt || a.id || '';
      var tb = b.createdAt || b.id || '';
      return ta > tb ? -1 : 1;
    });

    var newestDebt = sorted[0];
    if (!newestDebt || !newestDebt.id) return;

    var plans = getDebtPlans();
    plans[newestDebt.id] = planConfig;
    saveDebtPlans(plans);

    // Actualizar el remainingAmount basado en el plan
    showToast('\uD83D\uDCC5 Plan de ' + planConfig.totalInstallments + ' pagos creado');
  }

  function loadExistingPlan(form, toggle, instInput, freqInput, startInput, body) {
    // Intentar encontrar el debt que se esta editando
    var creditorInput = form.querySelector('input[type="text"]');
    if (!creditorInput) return;
    var creditor = creditorInput.value;

    var plans = getDebtPlans();
    var lf = getLocalForage();
    if (!lf) return;

    lf.getItem('debts').then(function(debts) {
      if (!debts) return;
      var debt = debts.find(function(d) { return d.creditor === creditor; });
      if (!debt || !plans[debt.id]) return;

      var plan = plans[debt.id];
      toggle.checked = true;
      body.style.display = 'block';
      instInput.value = plan.totalInstallments || 12;
      freqInput.value = plan.frequency || 'monthly';
      if (plan.startDate) startInput.value = plan.startDate;
    }).catch(function() {});
  }

  // ============================================================
  // Inyectar tracker de cuotas en tarjetas de deudas React
  // ============================================================
  function checkAndEnhanceCards(node) {
    // Buscar el header "Mis Deudas"
    var allText = node.textContent || '';
    if (allText.indexOf('Mis Deudas') < 0 && allText.indexOf('Pendiente') < 0) return;

    setTimeout(function() { enhanceVisibleDebtCards(); }, 300);
  }

  async function enhanceVisibleDebtCards() {
    var plans = getDebtPlans();
    if (Object.keys(plans).length === 0) return;

    var lf = getLocalForage();
    if (!lf) return;
    var debts = await lf.getItem('debts') || [];

    // Buscar tarjetas de deuda en el DOM
    var cards = document.querySelectorAll('div[style*="borderLeft"][style*="borderRadius"]');
    cards.forEach(function(card) {
      if (card.getAttribute('data-dc-plan-injected')) return;

      // Encontrar creditor name en la tarjeta
      var nameEl = card.querySelector('div[style*="fontWeight"][style*="700"][style*="18px"]');
      if (!nameEl) return;
      var creditorName = nameEl.textContent.trim();

      // Buscar debt que coincida
      var debt = debts.find(function(d) { return d.creditor === creditorName; });
      if (!debt || !plans[debt.id]) return;

      var plan = plans[debt.id];
      card.setAttribute('data-dc-plan-injected', 'true');

      injectInstallmentTracker(card, debt, plan);
    });
  }

  function injectInstallmentTracker(card, debt, plan) {
    var t = getThemeColors();
    var currency = getCurrency();
    var inst = plan.installments || [];
    var paidCount = inst.filter(function(p) { return p.paid; }).length;
    var total = inst.length;
    var pct = total > 0 ? Math.round((paidCount / total) * 100) : 0;

    // Encontrar proxima cuota pendiente
    var today = new Date().toISOString().split('T')[0];
    var nextInst = inst.find(function(p) { return !p.paid; });
    var overdueCount = inst.filter(function(p) { return !p.paid && p.dueDate < today; }).length;

    var freqLabel = plan.frequency === 'weekly' ? 'semanales' : plan.frequency === 'biweekly' ? 'quincenales' : 'mensuales';

    var tracker = document.createElement('div');
    tracker.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:10px;background:' + (t.isDark ? 'rgba(0,122,255,0.1)' : 'rgba(0,122,255,0.06)') + ';border:1px solid ' + (t.isDark ? 'rgba(0,122,255,0.2)' : 'rgba(0,122,255,0.12)');
    tracker.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<div style="font-size:12px;font-weight:600;color:#007AFF">\uD83D\uDCC5 Plan: ' + total + ' pagos ' + freqLabel + '</div>'
      + '<div style="font-size:12px;font-weight:700;color:' + (pct === 100 ? '#34C759' : '#007AFF') + '">' + paidCount + '/' + total + '</div>'
      + '</div>'
      // Barra de progreso de cuotas
      + '<div style="background:' + t.border + ';border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px">'
      + '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#007AFF,#5856D6);border-radius:4px;transition:width 0.3s"></div>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + (nextInst
        ? '<div style="font-size:11px;color:' + (overdueCount > 0 ? '#FF3B30' : t.muted) + '">'
          + (overdueCount > 0 ? '\u26A0\uFE0F ' + overdueCount + ' vencida' + (overdueCount > 1 ? 's' : '') + ' \u2022 ' : '')
          + 'Pr\u00f3ximo: ' + new Date(nextInst.dueDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
          + ' \u2022 ' + currency + formatNumber(nextInst.amount) + '</div>'
        : '<div style="font-size:11px;color:#34C759;font-weight:600">\u2705 Todas las cuotas pagadas</div>')
      + '<button class="dc-view-plan-btn" style="font-size:11px;padding:4px 10px;border-radius:8px;border:none;background:#007AFF;color:#fff;cursor:pointer;font-weight:600">Ver Plan</button>'
      + '</div>';

    card.appendChild(tracker);

    // Click handler para ver plan completo
    tracker.querySelector('.dc-view-plan-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      showInstallmentManager(debt.id);
    });
  }

  // ============================================================
  // Gestor de Cuotas - Vista completa del plan de pagos
  // ============================================================
  function showInstallmentManager(debtId) {
    var plans = getDebtPlans();
    var plan = plans[debtId];
    if (!plan) { showToast('No hay plan de pagos para esta deuda'); return; }

    var t = getThemeColors();
    var currency = getCurrency();

    var overlay = document.createElement('div');
    overlay.className = 'dc-modal-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
      zIndex: '10001', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    function render() {
      var inst = plan.installments || [];
      var paidCount = inst.filter(function(p) { return p.paid; }).length;
      var paidAmount = inst.filter(function(p) { return p.paid; }).reduce(function(s, p) { return s + (p.paidAmount || p.amount); }, 0);
      var totalAmount = inst.reduce(function(s, p) { return s + p.amount; }, 0);
      var pct = inst.length > 0 ? Math.round((paidCount / inst.length) * 100) : 0;
      var today = new Date().toISOString().split('T')[0];
      var freqLabel = plan.frequency === 'weekly' ? 'Semanal' : plan.frequency === 'biweekly' ? 'Quincenal' : 'Mensual';

      var html = '<div style="background:' + t.bg + ';border-radius:20px;width:100%;max-width:440px;max-height:85vh;overflow-y:auto;color:' + t.txt + '">'
        // Header
        + '<div style="padding:20px 20px 16px;border-bottom:1px solid ' + t.border + '">'
        + '<div style="display:flex;justify-content:space-between;align-items:center">'
        + '<div style="font-size:18px;font-weight:700">\uD83D\uDCC5 Plan de Pagos</div>'
        + '<button class="dc-close-plan" style="background:' + t.inputBg + ';border:none;border-radius:10px;width:32px;height:32px;cursor:pointer;font-size:16px;color:' + t.txt + '">\u2715</button>'
        + '</div>'
        + '<div style="font-size:13px;color:' + t.muted + ';margin-top:4px">' + freqLabel + ' \u2022 ' + inst.length + ' cuotas</div>'
        + '</div>'

        // Stats
        + '<div style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'
        + '<div style="text-align:center;padding:10px;background:' + t.inputBg + ';border-radius:12px">'
        + '<div style="font-size:20px;font-weight:700;color:#007AFF">' + paidCount + '/' + inst.length + '</div>'
        + '<div style="font-size:11px;color:' + t.muted + '">Cuotas</div></div>'
        + '<div style="text-align:center;padding:10px;background:' + t.inputBg + ';border-radius:12px">'
        + '<div style="font-size:20px;font-weight:700;color:#34C759">' + pct + '%</div>'
        + '<div style="font-size:11px;color:' + t.muted + '">Progreso</div></div>'
        + '<div style="text-align:center;padding:10px;background:' + t.inputBg + ';border-radius:12px">'
        + '<div style="font-size:15px;font-weight:700;color:' + t.txt + '">' + currency + formatNumber(totalAmount - paidAmount) + '</div>'
        + '<div style="font-size:11px;color:' + t.muted + '">Restante</div></div>'
        + '</div>'

        // Progress bar
        + '<div style="padding:0 20px 16px">'
        + '<div style="background:' + t.border + ';border-radius:6px;height:8px;overflow:hidden">'
        + '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#34C759,#32D74B);border-radius:6px;transition:width 0.3s"></div>'
        + '</div></div>'

        // Installment list
        + '<div style="padding:0 20px 20px">';

      inst.forEach(function(item, idx) {
        var isOverdue = !item.paid && item.dueDate < today;
        var isCurrent = !item.paid && !isOverdue && (idx === 0 || inst[idx - 1].paid || inst.slice(0, idx).every(function(p) { return p.paid; }) || item.dueDate <= today);
        var borderColor = item.paid ? '#34C759' : isOverdue ? '#FF3B30' : isCurrent ? '#007AFF' : t.border;
        var bgColor = item.paid ? (t.isDark ? 'rgba(52,199,89,0.08)' : 'rgba(52,199,89,0.04)') :
          isOverdue ? (t.isDark ? 'rgba(255,59,48,0.08)' : 'rgba(255,59,48,0.04)') :
          isCurrent ? (t.isDark ? 'rgba(0,122,255,0.08)' : 'rgba(0,122,255,0.04)') : t.inputBg;

        html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;border-radius:10px;background:' + bgColor + ';border-left:3px solid ' + borderColor + '">'
          + '<div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;'
          + (item.paid ? 'background:#34C759;color:#fff' : isOverdue ? 'background:#FF3B30;color:#fff' : 'background:' + t.inputBg + ';color:' + t.muted) + '">'
          + (item.paid ? '\u2713' : item.number) + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="display:flex;justify-content:space-between;align-items:center">'
          + '<div style="font-size:13px;font-weight:600;color:' + t.txt + '">Cuota ' + item.number + '</div>'
          + '<div style="font-size:14px;font-weight:700;color:' + (item.paid ? '#34C759' : isOverdue ? '#FF3B30' : t.txt) + '">' + currency + formatNumber(item.amount) + '</div>'
          + '</div>'
          + '<div style="font-size:11px;color:' + t.muted + ';margin-top:2px">'
          + new Date(item.dueDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
          + (item.paid && item.paidDate ? ' \u2022 Pagada: ' + new Date(item.paidDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '')
          + (isOverdue ? ' \u2022 \u26A0\uFE0F Vencida' : '')
          + '</div></div>';

        if (!item.paid) {
          html += '<button class="dc-pay-inst" data-idx="' + idx + '" style="flex-shrink:0;padding:6px 12px;border-radius:8px;border:none;background:#34C759;color:#fff;font-size:11px;font-weight:600;cursor:pointer">Pagar</button>';
        }

        html += '</div>';
      });

      // Delete plan button
      html += '<div style="margin-top:16px;padding-top:16px;border-top:1px solid ' + t.border + ';display:flex;gap:8px">'
        + '<button class="dc-delete-plan" style="flex:1;padding:10px;border-radius:10px;border:1px solid #FF3B30;background:transparent;color:#FF3B30;font-size:13px;font-weight:600;cursor:pointer">\uD83D\uDDD1\uFE0F Eliminar Plan</button>'
        + '</div>';

      html += '</div></div>';
      overlay.innerHTML = html;

      // Event handlers
      overlay.querySelector('.dc-close-plan').addEventListener('click', function() { overlay.remove(); });

      overlay.querySelectorAll('.dc-pay-inst').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute('data-idx'));
          markInstallmentPaid(debtId, idx, overlay, render);
        });
      });

      var deleteBtn = overlay.querySelector('.dc-delete-plan');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
          dcConfirm('\u00bfEliminar el plan de pagos de esta deuda?').then(function(ok) {
            if (!ok) return;
            var p = getDebtPlans();
            delete p[debtId];
            saveDebtPlans(p);
            overlay.remove();
            showToast('Plan eliminado');
          });
        });
      }
    }

    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    render();
  }

  async function markInstallmentPaid(debtId, instIdx, overlay, renderFn) {
    var plans = getDebtPlans();
    var plan = plans[debtId];
    if (!plan || !plan.installments[instIdx]) return;

    var inst = plan.installments[instIdx];
    inst.paid = true;
    inst.paidDate = new Date().toISOString().split('T')[0];
    inst.paidAmount = inst.amount;
    saveDebtPlans(plans);

    // Actualizar remainingAmount en el debt de localForage
    var lf = getLocalForage();
    if (lf) {
      var debts = await lf.getItem('debts') || [];
      var debt = debts.find(function(d) { return d.id === debtId; });
      if (debt) {
        var totalPaid = plan.installments
          .filter(function(p) { return p.paid; })
          .reduce(function(s, p) { return s + (p.paidAmount || p.amount); }, 0);
        debt.remainingAmount = Math.max(0, debt.amount - totalPaid);
        debt.paidAmount = totalPaid;

        // Si todas pagadas, marcar como paid
        var allPaid = plan.installments.every(function(p) { return p.paid; });
        if (allPaid) {
          debt.status = 'paid';
          debt.paidDate = new Date().toISOString().split('T')[0];
        }
        await lf.setItem('debts', debts);
      }
    }

    // Verificar logros
    setTimeout(function() { checkAndUnlockAchievements(true); }, 500);

    showToast('\u2705 Cuota ' + (instIdx + 1) + ' pagada');
    renderFn();
  }

  // ============================================================
  // Herramientas contextuales en vista de deudas
  // ============================================================
  function injectDebtToolsBar() {
    if (window._dcToolsObserver) return;
    var observer = new MutationObserver(function() {
      var headers = document.querySelectorAll('h2');
      for (var i = 0; i < headers.length; i++) {
        var txt = headers[i].textContent || '';
        if (txt.indexOf('Mis Deudas') >= 0) {
          var container = headers[i].closest('div');
          if (container && !container.getAttribute('data-dc-tools-injected')) {
            container.setAttribute('data-dc-tools-injected', 'true');
            addToolsToDebtsView(container);
          }
          break;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window._dcToolsObserver = observer;
  }

  function addToolsToDebtsView(headerContainer) {
    var t = getThemeColors();
    var toolsBar = document.createElement('div');
    toolsBar.style.cssText = 'padding:8px 20px 4px;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none';

    var tools = [
      { icon: '\uD83D\uDCCA', label: 'Resumen', action: showFinancialSummary },
      { icon: '\uD83E\uDDEE', label: 'Amortizaci\u00f3n', action: showAmortizationCalc },
      { icon: '\u2696\uFE0F', label: 'Estrategia', action: showDebtStrategy },
      { icon: '\uD83D\uDCC9', label: 'Ratio DTI', action: showDTICalculator },
      { icon: '\uD83C\uDFC1', label: 'Libre de Deudas', action: showDebtFreeDate },
      { icon: '\u2705', label: 'Liquidar', action: showMarkDebtPaid },
      { icon: '\uD83D\uDCCB', label: 'Historial', action: showDebtHistory }
    ];

    tools.forEach(function(tool) {
      var btn = document.createElement('button');
      btn.style.cssText = 'flex-shrink:0;padding:6px 12px;border-radius:16px;border:1px solid ' + t.border + ';background:' + t.inputBg + ';cursor:pointer;display:flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:' + t.txt + ';white-space:nowrap';
      btn.innerHTML = tool.icon + ' ' + tool.label;
      btn.addEventListener('click', function() {
        if (navigator.vibrate) navigator.vibrate(10);
        tool.action();
      });
      toolsBar.appendChild(btn);
    });

    // Insertar despues del header y filtros de categoria
    var parent = headerContainer.parentElement;
    if (parent) {
      var siblings = parent.children;
      // Insertar despues del segundo hijo (header + category filters)
      if (siblings.length >= 2) {
        parent.insertBefore(toolsBar, siblings[2]);
      } else {
        parent.insertBefore(toolsBar, siblings[1] || null);
      }
    }
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
    initDebtFormEnhancer();
    injectDebtToolsBar();

    // Verificar vencimientos
    setTimeout(checkDueDates, 5000);
    // Re-check cada 4 horas
    setInterval(checkDueDates, 4 * 60 * 60 * 1000);

    // Verificar logros silenciosamente al iniciar
    setTimeout(function() { checkAndUnlockAchievements(true); }, 6000);

    // Verificar pagos recurrentes pendientes del mes
    setTimeout(checkRecurringPayments, 7000);

    console.log('[CloudSync] v' + SYNC_VERSION + ' | Firebase:', connected ? '\u2705' : '\u274C', '| Moneda:', getCurrency());
  }

  init();
})();

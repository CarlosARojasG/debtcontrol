/**
 * DebtControl Pro - Cloud Sync Module v4.0.0
 * Sincronización + herramientas financieras
 *
 * v4.0 cambios:
 * - Modales bonitos (dcConfirm/dcPrompt) — adiós prompt/confirm nativos
 * - PDF Export con jsPDF
 * - Notificaciones de vencimiento de deudas
 * - Calendario de pagos
 * - Configuración de moneda
 * - Historial de sincronización
 * - Bloqueo rápido
 * - Botón instalar app
 * - Fix XSS en Firebase URL
 * - Fix auto-backup (tamaño controlado)
 * - Menú con posicionamiento inteligente
 */

(function() {
  'use strict';

  // ============================================================
  // Constantes
  // ============================================================
  var SYNC_KEYS = ['debts', 'payments', 'reminders', 'investments', 'savings', 'userStats'];
  var SYNC_VERSION = '4.0.0';
  var DB_URL_KEY = 'debtcontrol_guard_dburl';
  var LS_LEGACY_CONFIG = 'debtcontrol_firebase_config';
  var LS_SYNC_ID = 'debtcontrol_sync_id';
  var LS_LAST_SYNC = 'debtcontrol_last_sync';
  var LS_SYNC_PIN = 'debtcontrol_sync_pin';
  var LS_AUTO_BACKUP = 'debtcontrol_auto_backup';
  var LS_SYNC_HISTORY = 'debtcontrol_sync_history';
  var LS_CURRENCY = 'debtcontrol_currency';
  var LS_NOTIFICATIONS = 'debtcontrol_notifications';

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
  function applyCurrencyToDOM() {
    var sym = getCurrency();
    if (sym === '$') return; // default, no cambiar
    if (currencyObserver) currencyObserver.disconnect();

    function replaceCurrency(node) {
      if (node.nodeType === 3) { // text node
        var text = node.textContent;
        // Reemplazar $ seguido de número (ej: $1,500.00 → €1,500.00)
        var replaced = text.replace(/\$(\d)/g, sym + '$1');
        if (replaced !== text) node.textContent = replaced;
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
  }

  // ============================================================
  // Modales bonitos: dcConfirm y dcPrompt (globales)
  // ============================================================
  function getThemeColors() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
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
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        showToast('\u2705 Datos restaurados. Recargando...');
        setTimeout(function() { location.reload(); }, 1500);
      } catch (err) {
        showToast('\u274C Archivo corrupto');
      }
    };
    input.click();
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
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

      if (prefs.daysBefore.indexOf(diffDays) !== -1) {
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
          return '<button class="dc-notif-day" data-days="' + d + '" style="padding:8px 14px;border-radius:10px;border:1px solid ' + (active ? '#007AFF' : t.border) + ';background:' + (active ? '#007AFF22' : 'transparent') + ';color:' + (active ? '#007AFF' : t.txt) + ';font-size:13px;font-weight:500;cursor:pointer">' + d + 'd</button>';
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
        var active = btn.style.background.indexOf('007AFF') !== -1;
        if (active) {
          btn.style.background = 'transparent';
          btn.style.borderColor = t.border;
          btn.style.color = t.txt;
        } else {
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
        if (btn.style.color === 'rgb(0, 122, 255)' || btn.style.color === '#007AFF') {
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
            overdue: due < today && !isPaid
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
          var allPaid = events[d].every(function(e) { return e.paid; });
          var anyOverdue = events[d].some(function(e) { return e.overdue; });
          if (anyOverdue) {
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
        + '<div style="display:flex;gap:12px;justify-content:center;margin-bottom:12px;font-size:11px">'
        + '<span>\uD83D\uDD34 Vencido</span><span>\uD83D\uDFE1 Pendiente</span><span>\uD83D\uDFE2 Pagado</span>'
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
            var statusIcon = ev.overdue ? '\uD83D\uDD34' : ev.paid ? '\uD83D\uDFE2' : '\uD83D\uDFE1';
            var statusText = ev.overdue ? 'Vencida' : ev.paid ? 'Pagada' : 'Pendiente';
            html += '<div style="background:' + t.inputBg + ';border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">'
              + '<span style="font-size:13px">' + statusIcon + ' ' + escapeHtml(ev.name) + '</span>'
              + '<span style="font-size:12px;font-weight:600">' + currency + formatNumber(ev.amount) + ' \u2022 ' + statusText + '</span>'
              + '</div>';
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

    card.innerHTML = ''
      + '<div style="font-size:48px;margin-bottom:12px">\u23F0</div>'
      + '<h2 style="margin:0 0 8px 0;font-size:18px">Duraci\u00f3n de Sesi\u00f3n</h2>'
      + '<p style="font-size:12px;color:' + t.muted + ';margin:0 0 16px 0">Cu\u00e1nto tiempo permaneces autenticado</p>'
      + '<div style="display:grid;gap:8px;margin-bottom:20px">' + btnsHtml + '</div>'
      + '<button class="dc-sess-close" style="width:100%;padding:14px;border:1px solid ' + t.border + ';border-radius:12px;background:transparent;color:' + t.txt + ';font-size:15px;cursor:pointer">Cerrar</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

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

    var canInstall = !!window.dcInstallPrompt;

    var items = [
      { icon: '\uD83D\uDCE5', label: 'Exportar Backup (JSON)', action: exportToJSON },
      { icon: '\uD83D\uDCC4', label: 'Exportar Reporte PDF', action: exportToPDF },
      { icon: '\uD83D\uDCE4', label: 'Importar Backup (JSON)', action: importFromJSON },
      { sep: true },
      { icon: '\u2B06\uFE0F', label: 'Subir a la Nube', action: syncToCloud },
      { icon: '\u2B07\uFE0F', label: 'Descargar de la Nube', action: syncFromCloud },
      { sep: true },
      { icon: '\uD83D\uDCC5', label: 'Calendario de Pagos', action: showCalendar },
      { icon: '\uD83D\uDD14', label: 'Notificaciones', action: showNotificationConfig },
      { icon: '\uD83D\uDCB1', label: 'Moneda', action: showCurrencyConfig },
      { sep: true },
      { icon: '\u2699\uFE0F', label: 'Configurar Firebase', action: showFirebaseSetup },
      { icon: '\uD83D\uDCCB', label: 'Historial de Sync', action: showSyncHistory },
      { icon: '\uD83D\uDD12', label: 'Cambiar C\u00f3digo de Acceso', action: function() { if (window.DebtControlGuard) window.DebtControlGuard.changeCode(); else showToast('Guard no disponible'); } },
      { icon: '\u23F0', label: 'Duraci\u00f3n de Sesi\u00f3n', action: showSessionConfig },
      { sep: true }
    ];

    if (canInstall) {
      items.push({ icon: '\uD83D\uDCF2', label: 'Instalar App', action: installApp });
    }

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
      var btn = document.createElement('button');
      btn.innerHTML = '<span style="margin-right:10px;font-size:18px">' + item.icon + '</span>' + item.label;
      Object.assign(btn.style, {
        display: 'flex', alignItems: 'center', width: '100%', padding: '13px 16px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: '14px', fontWeight: '500', textAlign: 'left', transition: 'background 0.12s',
        whiteSpace: 'nowrap'
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

    // Listen for install prompt changes
    window.addEventListener('beforeinstallprompt', function() {
      // Rebuild menu to include install option if not present
    });
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
    if (!m) return;
    if (m.style.display === 'none' || !m.style.display) {
      // Posicionar inteligentemente
      var fab = document.getElementById('dc-sync-fab');
      var fabRect = fab.getBoundingClientRect();
      var viewH = window.innerHeight;
      var menuH = Math.min(m.scrollHeight || 500, viewH * 0.7);

      // Si el menú no cabe arriba del FAB, ponerlo abajo o centrar
      var bottom = viewH - fabRect.top + 8;
      if (bottom + menuH > viewH - 20) {
        // Centrar verticalmente
        m.style.bottom = 'auto';
        m.style.top = Math.max(10, (viewH - menuH) / 2) + 'px';
      } else {
        m.style.top = 'auto';
        m.style.bottom = bottom + 'px';
      }
      m.style.display = 'block';
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

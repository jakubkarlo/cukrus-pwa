// ─── State ───────────────────────────────────────────────────────────────────
var sensors = [];
var settings = { defaultCustomReminders: [48, 4] };
var swReg = null;
var deferredInstallPrompt = null;
var refreshTimer = null;

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  loadSettings();
  registerSW();
  loadSensors();
  setupInstallBanner();
  setupVisibilityHandler();
  startAutoRefresh();
  renderSettings();
});

function loadSettings() {
  try {
    var s = localStorage.getItem('diabetes-settings');
    if (s) settings = JSON.parse(s);
  } catch (e) {}
}

function saveSettings() {
  localStorage.setItem('diabetes-settings', JSON.stringify(settings));
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(function (reg) {
    swReg = reg;
    // Sprawdź powiadomienia przy każdym otwarciu strony
    navigator.serviceWorker.ready.then(function () { triggerSWCheck(); });
    // Try to register periodic background sync
    if ('periodicSync' in reg) {
      navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (status) {
        if (status.state === 'granted') {
          reg.periodicSync.register('check-notifications', { minInterval: 12 * 60 * 60 * 1000 }).catch(function () {});
        }
      }).catch(function () {});
    }
  }).catch(function (err) {
    console.warn('SW registration failed:', err);
  });
}

function triggerSWCheck() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_NOTIFICATIONS' });
  }
}

function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      triggerSWCheck();
      loadSensors();
    }
  });
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function () {
    renderSensors();
  }, 60000);
}

function setupInstallBanner() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    var banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'flex';
  });
  window.addEventListener('appinstalled', function () {
    var banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'none';
    deferredInstallPrompt = null;
  });
  var installBtn = document.getElementById('install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function () {
          deferredInstallPrompt = null;
        });
      }
    });
  }
}

// ─── Sensors ─────────────────────────────────────────────────────────────────
function loadSensors() {
  DB.getSensors().then(function (list) {
    sensors = list.sort(function (a, b) { return new Date(a.expiresAt) - new Date(b.expiresAt); });
    renderSensors();
    checkNotifPermission();
    if (typeof Push !== 'undefined') Push.init(sensors);
  });
}

function addSensor(data) {
  var start = new Date(data.startDate);
  var expires = new Date(start.getTime() + data.durationDays * 24 * 60 * 60 * 1000);
  var sensor = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    type: data.type,
    name: data.name,
    startDate: start.toISOString(),
    durationDays: data.durationDays,
    expiresAt: expires.toISOString(),
    customReminders: data.customReminders.slice(),
    firedNotifications: [],
    createdAt: new Date().toISOString()
  };
  DB.saveSensor(sensor).then(function () {
    loadSensors();
    setTimeout(triggerSWCheck, 500);
    if (typeof Push !== 'undefined') Push.sync(sensors.concat([sensor]));
  });
}

function removeSensor(id) {
  DB.deleteSensor(id).then(function () {
    loadSensors();
    if (typeof Push !== 'undefined') Push.sync(sensors.filter(function (s) { return s.id !== id; }));
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderSensors() {
  var list = document.getElementById('sensor-list');
  var empty = document.getElementById('empty-state');
  if (!list) return;

  var now = Date.now();
  var activeSensors = sensors.filter(function (s) { return new Date(s.expiresAt).getTime() > now - 2 * 60 * 60 * 1000; });

  if (activeSensors.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = activeSensors.map(function (s) {
    var expiresAt = new Date(s.expiresAt).getTime();
    var msLeft = expiresAt - now;
    var expired = msLeft < 0;
    var statusClass = expired ? 'expired' : msLeft < 24 * 3600000 ? 'critical' : msLeft < 48 * 3600000 ? 'warning' : 'ok';
    var icon = s.type === 'sensor' ? '<i class="fa-solid fa-satellite-dish"></i>' : '<i class="fa-solid fa-syringe"></i>';
    var sticker = s.type === 'sensor' ? '&#xf1eb;' : '&#xf48e;';
    var typeLabel = s.type === 'sensor' ? 'Sensor CGM' : 'Wkłucie';
    var countdownText = expired ? 'Wygasło!' : formatCountdown(msLeft);
    var expiryStr = formatDate(new Date(s.expiresAt));
    var remindersList = buildRemindersList(s);

    return '<div class="sensor-card status-' + statusClass + '" id="card-' + s.id + '" data-sticker="' + sticker + '">' +
      '<div class="card-header">' +
        '<span class="card-icon">' + icon + '</span>' +
        '<div class="card-info">' +
          '<div class="card-name">' + escapeHtml(s.name || typeLabel) + '</div>' +
          '<div class="card-type">' + typeLabel + ' \u2022 ' + s.durationDays + ' dni</div>' +
        '</div>' +
        '<button class="delete-btn" onclick="confirmDelete(\'' + s.id + '\')" title="Usuń">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="card-countdown ' + statusClass + '">' + countdownText + '</div>' +
      '<div class="card-expiry">Wygasa: ' + expiryStr + '</div>' +
      remindersList +
    '</div>';
  }).join('');
}

function buildRemindersList(sensor) {
  var reminders = [24].concat(sensor.customReminders || []);
  var unique = reminders.filter(function (h, i) { return reminders.indexOf(h) === i; }).sort(function (a, b) { return b - a; });
  var items = unique.map(function (h) {
    var label = h >= 24 ? (h / 24 === 1 ? '1 dzień' : (h / 24) + ' dni') : h + 'h';
    var notifId = sensor.id + '-' + h;
    var fired = sensor.firedNotifications && sensor.firedNotifications.includes(notifId);
    return '<span class="reminder-tag' + (fired ? ' fired' : '') + '"><i class="fa-solid ' + (fired ? 'fa-check' : 'fa-bell') + '"></i> ' + label + '</span>';
  });
  return '<div class="reminder-tags">' + items.join('') + '</div>';
}

function formatCountdown(ms) {
  var h = Math.floor(ms / 3600000);
  var m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return 'Za ' + Math.floor(h / 24) + ' dni';
  if (h >= 24) return 'Za 1 dzień ' + (h % 24) + 'h';
  if (h > 0) return 'Za ' + h + 'h ' + m + 'min';
  return 'Za ' + m + ' min';
}

function formatDate(d) {
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ─── Notification Permission ──────────────────────────────────────────────────
function checkNotifPermission() {
  var banner = document.getElementById('notif-banner');
  if (!banner) return;
  if (!('Notification' in window)) {
    banner.style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted') {
    banner.style.display = 'none';
  } else if (Notification.permission === 'denied') {
    banner.querySelector('.banner-text').textContent = 'Powiadomienia zablokowane. Kliknij ikonę 🔒 w pasku adresu → Uprawnienia → Powiadomienia → Zezwól.';
    banner.style.display = 'flex';
    banner.querySelector('button').style.display = 'none';
  } else {
    banner.style.display = 'flex';
  }
}

function requestNotifPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(function (result) {
    checkNotifPermission();
    if (result === 'granted') triggerSWCheck();
  });
}

// ─── Add Modal ────────────────────────────────────────────────────────────────
var modalReminders = [];

function openAddModal() {
  modalReminders = settings.defaultCustomReminders.slice();
  var modal = document.getElementById('add-modal');
  var now = new Date();
  var pad = function (n) { return n.toString().padStart(2, '0'); };
  var localNow = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  document.getElementById('f-start').value = localNow;
  document.getElementById('f-duration').value = '7';
  document.getElementById('f-name').value = '';
  document.getElementById('t-sensor').checked = true;
  renderModalReminders();
  modal.classList.add('open');
  document.getElementById('f-name').focus();
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
}

function onTypeChange() {
  var type = document.querySelector('input[name="type"]:checked').value;
  document.getElementById('f-duration').value = type === 'sensor' ? '7' : '3';
}

function renderModalReminders() {
  var container = document.getElementById('modal-reminders');
  if (!container) return;
  container.innerHTML = modalReminders.map(function (h, i) {
    return '<div class="reminder-row">' +
      '<input type="number" min="1" max="720" value="' + h + '" onchange="updateModalReminder(' + i + ', this.value)" class="reminder-input">' +
      '<span>godz. przed końcem</span>' +
      '<button type="button" class="rem-del-btn" onclick="removeModalReminder(' + i + ')">✕</button>' +
    '</div>';
  }).join('') +
  '<button type="button" class="add-reminder-btn" onclick="addModalReminder()">+ Dodaj przypomnienie</button>';
}

function addModalReminder() {
  modalReminders.push(12);
  renderModalReminders();
}

function removeModalReminder(i) {
  modalReminders.splice(i, 1);
  renderModalReminders();
}

function updateModalReminder(i, val) {
  modalReminders[i] = parseInt(val, 10) || 1;
}

function submitAddForm(e) {
  e.preventDefault();
  var type = document.querySelector('input[name="type"]:checked').value;
  var name = document.getElementById('f-name').value.trim();
  var startDate = document.getElementById('f-start').value;
  var durationDays = parseInt(document.getElementById('f-duration').value, 10);

  if (!startDate || isNaN(durationDays) || durationDays < 1) {
    alert('Wypełnij wszystkie pola poprawnie.');
    return;
  }

  addSensor({
    type: type,
    name: name || (type === 'sensor' ? 'Sensor CGM' : 'Wkłucie'),
    startDate: new Date(startDate).toISOString(),
    durationDays: durationDays,
    customReminders: modalReminders.filter(function (h) { return !isNaN(h) && h > 0; })
  });
  closeAddModal();
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function confirmDelete(id) {
  var sensor = sensors.find(function (s) { return s.id === id; });
  var name = sensor ? (sensor.name || (sensor.type === 'sensor' ? 'Sensor CGM' : 'Wkłucie')) : 'ten wpis';
  if (confirm('Usunąć "' + name + '"?')) {
    removeSensor(id);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  var container = document.getElementById('settings-reminders');
  if (!container) return;
  container.innerHTML = settings.defaultCustomReminders.map(function (h, i) {
    return '<div class="reminder-row">' +
      '<input type="number" min="1" max="720" value="' + h + '" onchange="updateSettingReminder(' + i + ', this.value)" class="reminder-input">' +
      '<span>godz. przed końcem</span>' +
      '<button type="button" class="rem-del-btn" onclick="removeSettingReminder(' + i + ')">✕</button>' +
    '</div>';
  }).join('') +
  '<button type="button" class="add-reminder-btn" onclick="addSettingReminder()">+ Dodaj domyślne przypomnienie</button>';
}

function addSettingReminder() {
  settings.defaultCustomReminders.push(12);
  saveSettings();
  renderSettings();
}

function removeSettingReminder(i) {
  settings.defaultCustomReminders.splice(i, 1);
  saveSettings();
  renderSettings();
}

function updateSettingReminder(i, val) {
  settings.defaultCustomReminders[i] = parseInt(val, 10) || 1;
  saveSettings();
}

function toggleSettings() {
  var panel = document.getElementById('settings-panel');
  panel.classList.toggle('open');
}

function sendTestNotification() {
  if (!('Notification' in window)) { alert('Twoja przeglądarka nie obsługuje powiadomień.'); return; }
  if (Notification.permission !== 'granted') { requestNotifPermission(); return; }
  // Wyślij przez Firebase FCM (prawdziwy push w tle)
  if (typeof Push !== 'undefined') {
    Push.sendTest();
  } else {
    // Fallback lokalny jeśli Firebase nie skonfigurowany
    if (swReg) {
      swReg.showNotification('Cukruś - Test lokalny', {
        body: 'Lokalne powiadomienie działa. Skonfiguruj Firebase dla powiadomień w tle.',
        icon: './icon-192.svg',
        badge: './icon-192.svg'
      });
    }
  }
}

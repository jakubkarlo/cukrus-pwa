var CACHE_NAME = 'diabetes-v1';
var SW_BASE = self.location.href.replace(/sw\.js.*$/, '');
var ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './lock.js',
  './app.js',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg'
];

// ─── IndexedDB helper (duplicated here since SW has no DOM access) ──────────
var IDB_NAME = 'diabetes-db';
var IDB_STORE = 'sensors';

function idbOpen() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

function idbGetAll() {
  return idbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readonly');
      var req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = function (e) { resolve(e.target.result || []); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

function idbPut(sensor) {
  return idbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readwrite');
      var req = tx.objectStore(IDB_STORE).put(sensor);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

// ─── Notification logic ─────────────────────────────────────────────────────
function checkAndFireNotifications() {
  return idbGetAll().then(function (sensors) {
    var now = Date.now();
    var promises = sensors.map(function (sensor) {
      var expiresAt = new Date(sensor.expiresAt).getTime();
      if (expiresAt < now - 24 * 60 * 60 * 1000) return Promise.resolve(); // expired >1 day ago, skip

      // Build list of reminder offsets in ms: always 24h + custom
      var reminders = [24];
      if (sensor.customReminders && sensor.customReminders.length) {
        sensor.customReminders.forEach(function (h) {
          if (!reminders.includes(h)) reminders.push(h);
        });
      }

      var needsSave = false;
      var fired = sensor.firedNotifications || [];

      var notifPromises = reminders.map(function (hours) {
        var notifyAt = expiresAt - hours * 60 * 60 * 1000;
        var notifId = sensor.id + '-' + hours;
        if (now >= notifyAt && !fired.includes(notifId)) {
          fired = fired.concat([notifId]);
          needsSave = true;
          var label = sensor.type === 'sensor' ? 'Sensor CGM' : 'Wkłucie';
          var title = (sensor.name || label) + ' \u2014 wymiana za ' + (hours >= 24 ? (hours / 24) + ' dob\u0119' : hours + 'h');
          var body = hours >= 24
            ? 'Zaplanuj wymian\u0119 ' + label.toLowerCase() + '.'
            : 'Do ko\u0144ca dzia\u0142ania zosta\u0142o ' + hours + ' godzin!';
          return self.registration.showNotification(title, {
            body: body,
            icon: SW_BASE + 'icon-192.svg',
            badge: SW_BASE + 'icon-192.svg',
            tag: notifId,
            renotify: true,
            data: { sensorId: sensor.id }
          });
        }
        return Promise.resolve();
      });

      return Promise.all(notifPromises).then(function () {
        if (needsSave) {
          sensor.firedNotifications = fired;
          return idbPut(sensor);
        }
      });
    });
    return Promise.all(promises);
  });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
      }),
      checkAndFireNotifications()
    ])
  );
});

self.addEventListener('fetch', function (e) {
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).catch(function () { return cached; });
    })
  );
});

// ─── Periodic Background Sync ────────────────────────────────────────────────
self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'check-notifications') {
    e.waitUntil(checkAndFireNotifications());
  }
});

// ─── Message from app ────────────────────────────────────────────────────────
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'CHECK_NOTIFICATIONS') {
    e.waitUntil(checkAndFireNotifications());
  }
});

// ─── FCM Push (Firebase Cloud Messaging) ─────────────────────────────────────
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  // data-only message: pola są w data{}, notification message: w notification{}
  var title = (data.data && data.data.title) || data.title || (data.notification && data.notification.title) || 'Cukruś';
  var body  = (data.data && data.data.body)  || data.body  || (data.notification && data.notification.body)  || '';
  var tag   = (data.data && data.data.tag)   || data.tag   || 'cukrus-push';
  e.waitUntil(
    self.registration.showNotification(title, {
      body:  body,
      icon:  SW_BASE + 'icon-192.svg',
      badge: SW_BASE + 'icon-192.svg',
      tag:   tag,
      data:  data.data || {}
    })
  );
});

// ─── Notification click ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow(SW_BASE);
    })
  );
});

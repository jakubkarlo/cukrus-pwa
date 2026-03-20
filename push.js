// ─── Firebase Push Notifications ─────────────────────────────────────────────
var Push = (function () {
  var DEVICE_KEY = 'cukrus-device-id';
  var app, messaging, db;
  var initialized = false;

  function getDeviceId() {
    var id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function setup() {
    if (initialized) return;
    if (typeof FIREBASE_CONFIG === 'undefined' || FIREBASE_CONFIG.apiKey === 'REPLACE_ME') {
      console.warn('[Push] firebase-config.js nie jest skonfigurowany.');
      return;
    }
    try {
      app       = firebase.initializeApp(FIREBASE_CONFIG);
      messaging = firebase.messaging();
      db        = firebase.firestore();
      initialized = true;
    } catch (e) {
      // już zainicjowany
      app       = firebase.app();
      messaging = firebase.messaging();
      db        = firebase.firestore();
      initialized = true;
    }
  }

  function getToken() {
    if (!initialized) return Promise.resolve(null);
    if (Notification.permission !== 'granted') return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) {
      return messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    }).catch(function (err) {
      console.warn('[Push] getToken error:', err);
      return null;
    });
  }

  function sync(sensors) {
    if (!initialized) return;
    var deviceId = getDeviceId();
    getToken().then(function (token) {
      if (!token) return;
      var firedNotifications = [];
      sensors.forEach(function (s) {
        (s.firedNotifications || []).forEach(function (n) {
          if (!firedNotifications.includes(n)) firedNotifications.push(n);
        });
      });
      return db.collection('devices').doc(deviceId).set({
        fcmToken: token,
        sensors: sensors.map(function (s) {
          return {
            id: s.id,
            type: s.type,
            name: s.name || '',
            expiresAt: s.expiresAt,
            durationDays: s.durationDays,
            customReminders: s.customReminders || []
          };
        }),
        firedNotifications: firedNotifications,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }).catch(function (err) {
      console.warn('[Push] sync error:', err);
    });
  }

  function sendTest() {
    if (!initialized) {
      alert('Firebase nie jest skonfigurowany.');
      return;
    }
    var deviceId = getDeviceId();
    var fns = firebase.app().functions('europe-west1');
    var sendTestNotification = fns.httpsCallable('sendTestNotification');
    sendTestNotification({ deviceId: deviceId })
      .then(function () {
        alert('Testowe powiadomienie FCM wysłane! Sprawdź telefon.');
      })
      .catch(function (err) {
        alert('Błąd FCM: ' + err.message);
      });
  }

  function init(sensors) {
    setup();
    if (!initialized) return;
    messaging.onTokenRefresh(function () { sync(sensors); });
    sync(sensors);
  }

  return { init: init, sync: sync, sendTest: sendTest };
})();

const functions = require('firebase-functions');
const admin     = require('firebase-admin');

admin.initializeApp();
const db        = admin.firestore();
const messaging = admin.messaging();

// Uruchamia się co godzinę i sprawdza wszystkie urządzenia
exports.checkSensorNotifications = functions
  .region('europe-west1')
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    const snapshot = await db.collection('devices').get();
    const now = Date.now();

    const promises = snapshot.docs.map(async (doc) => {
      const device = doc.data();
      const { fcmToken, sensors = [], firedNotifications = [] } = device;
      if (!fcmToken || !sensors.length) return;

      const newFired = [...firedNotifications];
      const sends = [];

      for (const sensor of sensors) {
        const expiresAt = new Date(sensor.expiresAt).getTime();
        // Pomiń jeśli wygasł ponad 2 dni temu
        if (expiresAt < now - 2 * 24 * 3600000) continue;

        const reminders = [24, ...(sensor.customReminders || [])];

        for (const hours of reminders) {
          const notifyAt = expiresAt - hours * 3600000;
          const notifId  = `${sensor.id}-${hours}`;
          if (now < notifyAt) continue;
          if (firedNotifications.includes(notifId)) continue;

          const label    = sensor.type === 'sensor' ? 'Sensor CGM' : 'Wkłucie';
          const name     = sensor.name || label;
          const timeLeft = hours >= 48
            ? `${Math.round(hours / 24)} dni`
            : hours >= 24 ? '1 dobę' : `${hours}h`;
          const title = `${name} — wymiana za ${timeLeft}`;
          const body  = hours >= 24
            ? `Zaplanuj wymianę ${label.toLowerCase()}.`
            : `Do końca działania zostało ${hours} godzin!`;

          sends.push(
            messaging.send({
              token: fcmToken,
              notification: { title, body },
              webpush: {
                notification: {
                  title,
                  body,
                  icon:  'https://jakubkarlo.github.io/cukrus-pwa/icon-192.svg',
                  badge: 'https://jakubkarlo.github.io/cukrus-pwa/icon-192.svg',
                  tag:   notifId,
                  renotify: true
                },
                fcmOptions: { link: 'https://jakubkarlo.github.io/cukrus-pwa/' }
              }
            })
            .then(() => { newFired.push(notifId); })
            .catch((err) => {
              functions.logger.warn('FCM send error', err.code, doc.id);
              // Nieważny token — wyczyść żeby nie spamować
              if (err.code === 'messaging/registration-token-not-registered') {
                return doc.ref.update({ fcmToken: null });
              }
            })
          );
        }
      }

      await Promise.all(sends);

      if (newFired.length !== firedNotifications.length) {
        await doc.ref.update({ firedNotifications: newFired });
      }
    });

    await Promise.all(promises);
    functions.logger.info(`Sprawdzono ${snapshot.size} urządzeń.`);
  });

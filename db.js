var DB = (function () {
  var DB_NAME = 'diabetes-db';
  var DB_VERSION = 1;
  var STORE = 'sensors';

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function getSensors() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function (e) { resolve(e.target.result || []); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function saveSensor(sensor) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var req = tx.objectStore(STORE).put(sensor);
        req.onsuccess = function () { resolve(); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function deleteSensor(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var req = tx.objectStore(STORE).delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  return { openDB: openDB, getSensors: getSensors, saveSensor: saveSensor, deleteSensor: deleteSensor };
})();

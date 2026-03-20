// ─── Zmień PASS_HASH na hash SHA-256 swojego hasła ──────────────────────────
// Aby wygenerować hash, wklej w konsolę przeglądarki:
// crypto.subtle.digest('SHA-256', new TextEncoder().encode('TWOJE_HASLO'))
//   .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
var PASS_HASH = 'cb853b77fabc650bbfb902f68d86cc62c263b3974ec4e445dd4dfb226241cc58';

var Lock = (function () {
  var SESSION_KEY = 'diabetes-unlocked';

  function sha256(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        return Array.from(new Uint8Array(buf))
          .map(function (b) { return b.toString(16).padStart(2, '0'); })
          .join('');
      });
  }

  function isUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function unlock() {
    sessionStorage.setItem(SESSION_KEY, '1');
    var overlay = document.getElementById('lock-overlay');
    if (overlay) {
      overlay.classList.add('unlocking');
      setTimeout(function () { overlay.style.display = 'none'; }, 350);
    }
  }

  function lock() {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  function showError(msg) {
    var el = document.getElementById('lock-err');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    var card = document.getElementById('lock-card');
    if (card) {
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }
  }

  function submitEnter() {
    var input = document.getElementById('lock-pwd');
    var pwd = input ? input.value : '';
    if (!pwd) return;
    var btn = document.getElementById('lock-submit-btn');
    btn.disabled = true;
    btn.textContent = '…';
    sha256(pwd).then(function (hash) {
      if (hash === PASS_HASH) {
        unlock();
      } else {
        showError('Nieprawidłowe hasło 🙈');
        input.value = '';
        input.focus();
        btn.disabled = false;
        btn.textContent = 'Wejdź';
      }
    });
  }

  function init() {
    var overlay = document.getElementById('lock-overlay');
    if (!overlay) return;

    if (PASS_HASH === 'USTAW_HASH_TUTAJ') {
      // tryb developerski - brak hasła, od razu wejdź
      overlay.style.display = 'none';
      return;
    }

    if (isUnlocked()) {
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = 'flex';
    setTimeout(function () {
      var el = document.getElementById('lock-pwd');
      if (el) el.focus();
    }, 100);
  }

  return { init: init, lock: lock, submitEnter: submitEnter };
})();

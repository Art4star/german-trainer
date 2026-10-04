(function () {
  'use strict';

  var CATS = ['artikel', 'praeposition', 'pronomen', 'adjektiv', 'konjunktiv'];
  var CAT_LABELS = { artikel: 'Artikel', praeposition: 'Präpositionen', pronomen: 'Pronomen', adjektiv: 'Adjektivendungen', konjunktiv: 'Konjunktiv' };
  var LEARNED_STREAK = 3; // лише для тексту в UI — реальний підрахунок робить сервер
  var NEW_PER_SESSION = 15;
  var MAX_PER_SESSION = 40;

  var API_BASE = 'https://german-trainer-api.onrender.com';
  var GOOGLE_CLIENT_ID = '385497440761-7megs57d45ftrvgcik27j4md2c3lbovh.apps.googleusercontent.com';

  var SUPPORTED_LANGS = ['uk', 'de', 'en'];
  var UI_LANG = (SUPPORTED_LANGS.indexOf((navigator.language || '').slice(0, 2).toLowerCase()) >= 0)
    ? navigator.language.slice(0, 2).toLowerCase()
    : 'en';
  var LOGIN_TEXT = {
    uk: { or: 'або', send: 'Надіслати код', verify: 'Увійти', codeHint: 'Ми надіслали 6-значний код на {email}. Він дійсний 10 хвилин.', codePlaceholder: '6 цифр', error: 'Не вдалося увійти. Перевір дані й спробуй ще раз.', wait: 'Код уже надіслано. Зачекай хвилину перед повторним запитом.', badCode: 'Невірний або прострочений код. Запроси новий.', badEmail: 'Перевір адресу електронної пошти.' },
    de: { or: 'oder', send: 'Code senden', verify: 'Anmelden', codeHint: 'Wir haben einen 6-stelligen Code an {email} gesendet. Er ist 10 Minuten gültig.', codePlaceholder: '6 Ziffern', error: 'Anmeldung fehlgeschlagen. Bitte prüfe deine Eingaben.', wait: 'Der Code wurde bereits gesendet. Bitte warte eine Minute.', badCode: 'Falscher oder abgelaufener Code. Fordere einen neuen an.', badEmail: 'Bitte prüfe die E-Mail-Adresse.' },
    en: { or: 'or', send: 'Send code', verify: 'Sign in', codeHint: 'We sent a 6-digit code to {email}. It is valid for 10 minutes.', codePlaceholder: '6 digits', error: 'Sign-in failed. Please check your details and try again.', wait: 'A code was already sent. Please wait a minute before requesting another.', badCode: 'Wrong or expired code. Request a new one.', badEmail: 'Please check the email address.' }
  };
  var T = LOGIN_TEXT[UI_LANG];

  var TOKEN_KEY = 'deutsch-trainer:apiToken';
  var USER_KEY = 'deutsch-trainer:apiUser';
  var TOPICS_KEY = 'deutsch-trainer:topics';

  var apiToken = localStorage.getItem(TOKEN_KEY);
  var progressCache = {}; // exerciseId -> progress-рядок із сервера

  function loadSelection() {
    try {
      var s = JSON.parse(localStorage.getItem(TOPICS_KEY) || 'null');
      if (s && Array.isArray(s.cats) && typeof s.level === 'string') return s;
    } catch (e) { /* ignore */ }
    return { cats: CATS.slice(), level: 'all' };
  }
  var selection = loadSelection();

  function saveSelection() {
    localStorage.setItem(TOPICS_KEY, JSON.stringify(selection));
  }

  // ---------- API ----------
  function apiFetch(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (apiToken) headers.Authorization = 'Bearer ' + apiToken;
    if (options.headers) Object.assign(headers, options.headers);
    return fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error(body.error || ('http_' + res.status));
          err.status = res.status;
          throw err;
        });
      }
      return res.json();
    });
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- DOM ----------
  var el = {
    menuBtn: document.getElementById('menuBtn'),
    menuPanel: document.getElementById('menuPanel'),
    menuUser: document.getElementById('menuUser'),
    historyBtn: document.getElementById('historyBtn'),
    resetBtn: document.getElementById('resetBtn'),
    switchUserBtn: document.getElementById('switchUserBtn'),

    screenLogin: document.getElementById('screen-login'),
    googleSignInBtn: document.getElementById('googleSignInBtn'),
    orText: document.getElementById('orText'),
    emailForm: document.getElementById('emailForm'),
    emailInput: document.getElementById('emailInput'),
    sendCodeBtn: document.getElementById('sendCodeBtn'),
    loginError: document.getElementById('loginError'),

    screenCode: document.getElementById('screen-code'),
    codeForm: document.getElementById('codeForm'),
    codeHint: document.getElementById('codeHint'),
    codeInput: document.getElementById('codeInput'),
    verifyCodeBtn: document.getElementById('verifyCodeBtn'),
    codeError: document.getElementById('codeError'),
    changeEmailBtn: document.getElementById('changeEmailBtn'),

    screenSelect: document.getElementById('screen-select'),
    learnedLine: document.getElementById('learnedLine'),
    startBtn: document.getElementById('startBtn'),
    topicsBtn: document.getElementById('topicsBtn'),
    topicSummary: document.getElementById('topicSummary'),

    screenTopics: document.getElementById('screen-topics'),
    catChecks: document.getElementById('catChecks'),
    levelSeg: document.getElementById('levelSeg'),
    topicsBack: document.getElementById('topicsBack'),

    screenQuiz: document.getElementById('screen-quiz'),
    progressBar: document.getElementById('progressBar'),
    topicLabel: document.getElementById('topicLabel'),
    sentenceBefore: document.getElementById('sentenceBefore'),
    sentenceAfter: document.getElementById('sentenceAfter'),
    answerInput: document.getElementById('answerInput'),
    checkBtn: document.getElementById('checkBtn'),
    feedback: document.getElementById('feedback'),
    feedbackNote: document.getElementById('feedbackNote'),
    translationToggle: document.getElementById('translationToggle'),
    translationText: document.getElementById('translationText'),
    quitBtn: document.getElementById('quitBtn'),

    screenSummary: document.getElementById('screen-summary'),
    summaryStats: document.getElementById('summaryStats'),
    backToStart: document.getElementById('backToStart'),

    screenHistory: document.getElementById('screen-history'),
    historySummary: document.getElementById('historySummary'),
    historyProblems: document.getElementById('historyProblems'),
    historySessions: document.getElementById('historySessions'),
    historyBack: document.getElementById('historyBack'),
  };

  // ---------- Стан сесії ----------
  var session = null; // { queue, pointer, reviewed, correct, wrong, mode, sessionId }

  function showScreen(name) {
    el.screenLogin.hidden = name !== 'login';
    el.screenCode.hidden = name !== 'code';
    el.screenSelect.hidden = name !== 'select';
    el.screenTopics.hidden = name !== 'topics';
    el.screenQuiz.hidden = name !== 'quiz';
    el.screenSummary.hidden = name !== 'summary';
    el.screenHistory.hidden = name !== 'history';
    var preAuth = name === 'login' || name === 'code';
    el.menuBtn.hidden = preAuth;
    openMenu(false);
  }

  // ---------- Меню ----------
  function openMenu(open) {
    el.menuPanel.hidden = !open;
    el.menuBtn.setAttribute('aria-expanded', String(open));
  }

  el.menuBtn.addEventListener('click', function () {
    openMenu(el.menuPanel.hidden);
  });
  document.addEventListener('click', function (e) {
    if (!el.menuPanel.hidden && !el.menuPanel.contains(e.target) && e.target !== el.menuBtn) openMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') openMenu(false);
  });

  el.historyBtn.addEventListener('click', function () {
    renderHistory();
    showScreen('history');
  });
  el.resetBtn.addEventListener('click', function () {
    openMenu(false);
    if (confirm('Скинути весь твій прогрес (вивчені картки, лічильники, історію сесій)? Цю дію не можна скасувати.')) {
      apiFetch('/api/reset', { method: 'POST', body: '{}' }).then(function () {
        progressCache = {};
        refreshStats();
      }).catch(function () {
        alert('Не вдалося скинути прогрес — перевір з’єднання із сервером.');
      });
    }
  });
  el.switchUserBtn.addEventListener('click', logout);

  // ---------- Логін ----------
  function showLoginError(msg) {
    el.loginError.hidden = false;
    el.loginError.textContent = msg;
  }

  function afterAuthSuccess(token, user) {
    apiToken = token;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    el.menuUser.textContent = user.name || user.email || 'Користувач';
    el.loginError.hidden = true;
    loadProgressAndEnter();
  }

  function loadProgressAndEnter() {
    apiFetch('/api/progress').then(function (data) {
      progressCache = {};
      (data.progress || []).forEach(function (p) { progressCache[p.exercise_id] = p; });
      buildTopics();
      refreshStats();
      showScreen('select');
    }).catch(function () {
      showLoginError('Не вдалося завантажити прогрес із сервера. Перевір з’єднання й спробуй увійти ще раз.');
      logout();
    });
  }

  function logout() {
    apiToken = null;
    progressCache = {};
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    showScreen('login');
  }

  function initGoogleSignIn() {
    if (!window.google || !window.google.accounts || GOOGLE_CLIENT_ID.indexOf('REPLACE_WITH') === 0) return;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: function (response) {
        apiFetch('/auth/google', { method: 'POST', body: JSON.stringify({ idToken: response.credential }) })
          .then(function (data) { afterAuthSuccess(data.token, data.user); })
          .catch(function () { showLoginError('Не вдалося увійти через Google.'); });
      }
    });
    google.accounts.id.renderButton(el.googleSignInBtn, { theme: 'outline', size: 'large', width: 280, locale: UI_LANG });
  }

  var pendingEmail = '';

  function showCodeScreen(email) {
    pendingEmail = email;
    el.codeHint.textContent = T.codeHint.replace('{email}', email);
    el.codeInput.placeholder = T.codePlaceholder;
    el.codeInput.value = '';
    el.codeError.hidden = true;
    showScreen('code');
    el.codeInput.focus();
  }

  el.emailForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = el.emailInput.value.trim();
    el.loginError.hidden = true;
    el.sendCodeBtn.disabled = true;
    apiFetch('/auth/email/request', { method: 'POST', body: JSON.stringify({ email: email }) })
      .then(function () { showCodeScreen(email); })
      .catch(function (err) {
        if (err.status === 429) showLoginError(T.wait);
        else if (err.status === 400) showLoginError(T.badEmail);
        else showLoginError(T.error);
      })
      .then(function () { el.sendCodeBtn.disabled = false; });
  });

  el.codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    el.codeError.hidden = true;
    el.verifyCodeBtn.disabled = true;
    apiFetch('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ email: pendingEmail, code: el.codeInput.value.trim() })
    }).then(function (data) {
      afterAuthSuccess(data.token, data.user);
    }).catch(function (err) {
      el.codeError.hidden = false;
      el.codeError.textContent = err.status === 401 ? T.badCode : T.error;
    }).then(function () { el.verifyCodeBtn.disabled = false; });
  });

  el.changeEmailBtn.addEventListener('click', function () {
    el.emailInput.value = pendingEmail;
    showScreen('login');
  });

  el.orText.textContent = T.or;
  el.sendCodeBtn.textContent = T.send;
  el.verifyCodeBtn.textContent = T.verify;

  // ---------- Теми та рівень ----------
  function selectedLevelLabel() {
    return selection.level === 'all' ? 'усі рівні' : selection.level;
  }

  function buildTopics() {
    el.catChecks.innerHTML = '';
    CATS.forEach(function (cat) {
      var row = document.createElement('label');
      row.className = 'list-row';
      var name = document.createElement('span');
      name.textContent = CAT_LABELS[cat];
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = cat;
      input.checked = selection.cats.indexOf(cat) !== -1;
      input.addEventListener('change', function () {
        selection.cats = Array.prototype.slice.call(el.catChecks.querySelectorAll('input:checked')).map(function (i) { return i.value; });
        saveSelection();
        refreshStats();
      });
      row.appendChild(name);
      row.appendChild(input);
      el.catChecks.appendChild(row);
    });
    paintLevel();
  }

  function paintLevel() {
    Array.prototype.forEach.call(el.levelSeg.querySelectorAll('button'), function (btn) {
      var active = btn.getAttribute('data-level') === selection.level;
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  el.levelSeg.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-level]');
    if (!btn) return;
    selection.level = btn.getAttribute('data-level');
    saveSelection();
    paintLevel();
    refreshStats();
  });

  el.topicsBtn.addEventListener('click', function () { showScreen('topics'); });
  el.topicsBack.addEventListener('click', function () { showScreen('select'); refreshStats(); });

  function filteredExercises() {
    return window.EXERCISES.filter(function (ex) {
      if (selection.cats.indexOf(ex.cat) === -1) return false;
      if (selection.level !== 'all' && ex.level !== selection.level) return false;
      return true;
    });
  }

  // Розкладає вправи на 4 черги за пріоритетом показу:
  // 1) struggling — активно вивчається, остання відповідь невірна
  // 2) recheck    — вже "вивчено", але настав час перевірки
  // 3) inProgress — активно вивчається, остання відповідь вірна
  // 4) fresh      — ще жодної спроби не було
  function classify(exs) {
    var today = todayStr();
    var struggling = [], recheck = [], inProgress = [], fresh = [];
    exs.forEach(function (ex) {
      var p = progressCache[ex.id];
      if (!p) { fresh.push(ex.id); return; }
      if (p.state === 'learned') {
        if (p.next_check_at && p.next_check_at <= today) recheck.push(ex.id);
        return;
      }
      if (p.last_result === 'wrong') struggling.push(ex.id);
      else inProgress.push(ex.id);
    });
    return { struggling: struggling, recheck: recheck, inProgress: inProgress, fresh: fresh };
  }

  function refreshStats() {
    var exs = filteredExercises();
    var learnedAll = 0;
    window.EXERCISES.forEach(function (ex) {
      var p = progressCache[ex.id];
      if (p && p.state === 'learned') learnedAll += 1;
    });
    el.learnedLine.textContent = 'Вивчено ' + learnedAll + ' з ' + window.EXERCISES.length;
    var allCats = selection.cats.length === CATS.length;
    el.topicSummary.textContent = selectedLevelLabel() + ' · ' + (allCats ? 'усі теми' : selection.cats.length + ' тем');
    el.startBtn.disabled = exs.length === 0;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- Вивчення ----------
  function startSession() {
    var buckets = classify(filteredExercises());
    shuffle(buckets.struggling);
    shuffle(buckets.recheck);
    shuffle(buckets.inProgress);
    shuffle(buckets.fresh);

    var freshSlice = buckets.fresh.slice(0, NEW_PER_SESSION);
    var queue = buckets.struggling.concat(buckets.recheck, buckets.inProgress, freshSlice);
    if (queue.length > MAX_PER_SESSION) queue = queue.slice(0, MAX_PER_SESSION);

    if (queue.length === 0) {
      alert('Немає карток для повторення. Обери інші теми або зачекай до наступної перевірки.');
      return;
    }

    el.startBtn.disabled = true;
    apiFetch('/api/session/start', { method: 'POST', body: '{}' }).then(function (data) {
      session = { queue: queue, pointer: 0, reviewed: 0, correct: 0, wrong: 0, mode: 'check', sessionId: data.sessionId };
      showScreen('quiz');
      renderCurrent();
    }).catch(function () {
      alert('Не вдалося почати сесію — перевір з’єднання із сервером.');
    }).then(function () {
      el.startBtn.disabled = false;
    });
  }

  el.startBtn.addEventListener('click', startSession);

  function currentExerciseId() {
    return session.queue[session.pointer];
  }
  function currentExercise() {
    var id = currentExerciseId();
    return window.EXERCISES.filter(function (e) { return e.id === id; })[0];
  }

  function renderCurrent() {
    if (!session || session.pointer >= session.queue.length) {
      endSession();
      return;
    }
    var ex = currentExercise();
    session.mode = 'check';

    var idx = ex.text.indexOf('___');
    el.sentenceBefore.textContent = ex.text.slice(0, idx);
    el.sentenceAfter.textContent = ex.text.slice(idx + 3);
    el.topicLabel.textContent = CAT_LABELS[ex.cat] + ' · ' + ex.topic + ' · ' + ex.level;

    el.answerInput.value = '';
    el.answerInput.className = '';
    el.answerInput.readOnly = false;
    el.feedback.hidden = true;
    el.feedback.className = 'feedback';
    el.feedbackNote.textContent = '';
    el.translationText.hidden = true;
    el.translationText.textContent = ex.tr;
    el.checkBtn.textContent = 'Перевірити';
    el.checkBtn.disabled = false;

    var total = session.queue.length;
    el.progressBar.style.width = Math.round((session.pointer / total) * 100) + '%';

    el.answerInput.focus();
  }

  function normalize(s) {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function checkAnswer() {
    if (session.mode !== 'check') return;
    var ex = currentExercise();
    var given = el.answerInput.value;
    var isCorrect = ex.answer.some(function (a) { return normalize(a) === normalize(given); });

    el.answerInput.readOnly = true;
    el.checkBtn.disabled = true;
    el.feedback.hidden = false;
    el.feedback.className = 'feedback';
    el.feedback.textContent = '…';
    el.feedbackNote.textContent = '';
    session.mode = 'pending';

    apiFetch('/api/attempt', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, exerciseId: ex.id, correct: isCorrect, givenAnswer: given })
    }).then(function (data) {
      var p = data.progress;
      progressCache[ex.id] = p;
      session.reviewed += 1;
      if (isCorrect) session.correct += 1; else session.wrong += 1;

      el.feedback.className = 'feedback ' + (isCorrect ? 'ok' : 'bad');
      if (isCorrect) {
        el.feedback.textContent = p.state === 'learned'
          ? '✓ Вивчено'
          : '✓ Правильно · ' + p.streak + '/' + LEARNED_STREAK;
      } else {
        el.feedback.textContent = '✗ Правильно: ' + ex.answer[0];
      }
      el.feedbackNote.textContent = ex.note;
      el.answerInput.className = isCorrect ? 'ok' : 'bad';
      el.checkBtn.textContent = 'Далі';
      el.checkBtn.disabled = false;
      session.mode = 'next';
      el.answerInput.focus();

      if (!isCorrect) {
        var reinsertAt = session.pointer + 1 + 5 + Math.floor(Math.random() * 4); // +5..+8
        var pos = Math.min(reinsertAt, session.queue.length);
        session.queue.splice(pos, 0, ex.id);
      }
    }).catch(function () {
      el.feedback.className = 'feedback bad';
      el.feedback.textContent = 'Помилка з’єднання. Спробуй ще раз.';
      el.answerInput.readOnly = false;
      el.checkBtn.disabled = false;
      session.mode = 'check';
    });
  }

  function nextCard() {
    session.pointer += 1;
    renderCurrent();
  }

  // ---------- Результат ----------
  function endSession() {
    var accuracy = session.reviewed ? Math.round((session.correct / session.reviewed) * 100) : 0;
    apiFetch('/api/session/end', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, reviewed: session.reviewed, correct: session.correct, wrong: session.wrong })
    }).catch(function () { /* незавершена сесія лишиться в історії без ended_at — не критично */ });

    el.summaryStats.innerHTML =
      '<div><strong>' + accuracy + '%</strong><span>точність</span></div>' +
      '<div><strong>' + session.wrong + '</strong><span>помилок</span></div>';
    session = null;
    showScreen('summary');
    refreshStats();
  }

  el.checkBtn.addEventListener('click', function () {
    if (session.mode === 'check') checkAnswer();
    else if (session.mode === 'next') nextCard();
  });
  el.answerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (session.mode === 'check') checkAnswer();
      else if (session.mode === 'next') nextCard();
    }
  });
  el.translationToggle.addEventListener('click', function () {
    el.translationText.hidden = !el.translationText.hidden;
  });
  el.backToStart.addEventListener('click', function () { showScreen('select'); refreshStats(); });
  el.quitBtn.addEventListener('click', function () {
    if (confirm('Завершити сесію? Прогрес по вже відповіданих картках збережеться.')) {
      endSession();
    }
  });

  // ---------- Історія ----------
  function renderHistory() {
    el.historySummary.textContent = 'Завантаження…';
    el.historyProblems.innerHTML = '';
    el.historySessions.innerHTML = '';

    Promise.all([apiFetch('/api/progress'), apiFetch('/api/sessions')]).then(function (results) {
      progressCache = {};
      (results[0].progress || []).forEach(function (p) { progressCache[p.exercise_id] = p; });
      var sessions = results[1].sessions || [];

      var learnedTotal = window.EXERCISES.filter(function (ex) {
        var p = progressCache[ex.id];
        return p && p.state === 'learned';
      }).length;
      el.historySummary.textContent = 'Вивчено ' + learnedTotal + ' з ' + window.EXERCISES.length + ' · сесій: ' + sessions.length;

      var problems = window.EXERCISES
        .map(function (ex) { var p = progressCache[ex.id]; return p ? { ex: ex, p: p } : null; })
        .filter(function (item) { return item && item.p.total_wrong > 0 && item.p.state !== 'learned'; })
        .sort(function (a, b) { return b.p.total_wrong - a.p.total_wrong; })
        .slice(0, 12);

      el.historyProblems.innerHTML = problems.length
        ? problems.map(function (item) {
            return '<div class="problem-row"><span>' + CAT_LABELS[item.ex.cat] + ' · ' + item.ex.topic +
              '</span><span class="problem-count">' + item.p.total_wrong + ' пом.</span></div>';
          }).join('')
        : '<p class="muted">Проблемних тем поки немає.</p>';

      var recent = sessions.slice(0, 30);
      if (recent.length) {
        var rows = recent.map(function (s) {
          var d = new Date(s.started_at);
          var dateStr = d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
          var acc = s.reviewed ? Math.round((s.correct / s.reviewed) * 100) : 0;
          var unfinished = s.ended_at ? '' : ' <span class="muted">(перервано)</span>';
          return '<tr><td>' + dateStr + unfinished + '</td><td>' + s.reviewed + '</td><td>' + acc + '%</td><td>' + s.wrong + '</td></tr>';
        }).join('');
        el.historySessions.innerHTML =
          '<table class="history-table"><thead><tr><th>Дата</th><th>Карток</th><th>Точність</th><th>Помилок</th></tr></thead><tbody>' + rows + '</tbody></table>';
      } else {
        el.historySessions.innerHTML = '<p class="muted">Ще немає жодної сесії.</p>';
      }
    }).catch(function () {
      el.historySummary.textContent = 'Не вдалося завантажити історію — перевір з’єднання.';
    });
  }

  el.historyBack.addEventListener('click', function () { showScreen('select'); refreshStats(); });

  // ---------- Init ----------
  el.orText.textContent = T.or;
  // SDK Google підключається асинхронно — ініціалізуємо після події load
  window.addEventListener('load', initGoogleSignIn);

  var savedUser = null;
  try { savedUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { /* ignore */ }
  if (apiToken && savedUser) {
    el.menuUser.textContent = savedUser.name || savedUser.email || 'Користувач';
    loadProgressAndEnter();
  } else {
    showScreen('login');
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () { /* офлайн-кеш необов'язковий */ });
    });
  }
})();

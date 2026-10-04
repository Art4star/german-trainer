(function () {
  'use strict';

  var CATS = ['artikel', 'praeposition', 'pronomen', 'adjektiv', 'konjunktiv'];
  var CAT_LABELS = { artikel: 'Artikel', praeposition: 'Präpositionen', pronomen: 'Pronomen', adjektiv: 'Adjektivendungen', konjunktiv: 'Konjunktiv' };
  var LEARNED_STREAK = 3; // лише для тексту в UI — реальний підрахунок робить сервер

  // TODO: підставити реальні значення після налаштування Render/Apple Developer
  var API_BASE = 'https://german-trainer-api.onrender.com';
  var GOOGLE_CLIENT_ID = '385497440761-7megs57d45ftrvgcik27j4md2c3lbovh.apps.googleusercontent.com';
  var APPLE_CLIENT_ID = 'REPLACE_WITH_APPLE_SERVICES_ID';

  var SUPPORTED_LANGS = ['uk', 'de', 'en'];
  var UI_LANG = (SUPPORTED_LANGS.indexOf((navigator.language || '').slice(0, 2).toLowerCase()) >= 0)
    ? navigator.language.slice(0, 2).toLowerCase()
    : 'en';
  var APPLE_BUTTON_TEXT = { uk: 'Увійти через Apple', de: 'Mit Apple anmelden', en: 'Sign in with Apple' };

  var TOKEN_KEY = 'deutsch-trainer:apiToken';
  var USER_KEY = 'deutsch-trainer:apiUser';

  var apiToken = localStorage.getItem(TOKEN_KEY);
  var progressCache = {}; // exerciseId -> progress-рядок із сервера

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
    userBar: document.getElementById('userBar'),
    userBarName: document.getElementById('userBarName'),
    switchUserBtn: document.getElementById('switchUserBtn'),

    screenLogin: document.getElementById('screen-login'),
    googleSignInBtn: document.getElementById('googleSignInBtn'),
    appleSignInBtn: document.getElementById('appleSignInBtn'),
    loginError: document.getElementById('loginError'),

    struggleCount: document.getElementById('struggleCount'),
    recheckCount: document.getElementById('recheckCount'),
    newCount: document.getElementById('newCount'),
    learnedCount: document.getElementById('learnedCount'),
    totalCount: document.getElementById('totalCount'),
    catChecks: document.getElementById('catChecks'),
    levelSelect: document.getElementById('levelSelect'),
    newPerSession: document.getElementById('newPerSession'),
    maxSessionSize: document.getElementById('maxSessionSize'),
    startBtn: document.getElementById('startBtn'),
    historyBtn: document.getElementById('historyBtn'),
    resetBtn: document.getElementById('resetBtn'),

    screenSelect: document.getElementById('screen-select'),
    screenQuiz: document.getElementById('screen-quiz'),
    screenSummary: document.getElementById('screen-summary'),
    screenHistory: document.getElementById('screen-history'),

    progressText: document.getElementById('progressText'),
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
    summaryStats: document.getElementById('summaryStats'),
    backToStart: document.getElementById('backToStart'),
    quitBtn: document.getElementById('quitBtn'),
    historySummary: document.getElementById('historySummary'),
    historyProblems: document.getElementById('historyProblems'),
    historySessions: document.getElementById('historySessions'),
    historyBack: document.getElementById('historyBack'),
  };

  // ---------- Стан сесії ----------
  var session = null; // { queue, pointer, reviewed, correct, wrong, mode, sessionId }

  function showScreen(name) {
    el.screenLogin.hidden = name !== 'login';
    el.screenSelect.hidden = name !== 'select';
    el.screenQuiz.hidden = name !== 'quiz';
    el.screenSummary.hidden = name !== 'summary';
    el.screenHistory.hidden = name !== 'history';
    el.userBar.hidden = name === 'login';
  }

  function showLoginError(msg) {
    el.loginError.hidden = false;
    el.loginError.textContent = msg;
  }

  // ---------- Логін (Sign in with Apple / Google) ----------
  function afterAuthSuccess(token, user) {
    apiToken = token;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    el.userBarName.textContent = user.name || user.email || 'Користувач';
    el.loginError.hidden = true;
    loadProgressAndEnter();
  }

  function loadProgressAndEnter() {
    apiFetch('/api/progress').then(function (data) {
      progressCache = {};
      (data.progress || []).forEach(function (p) { progressCache[p.exercise_id] = p; });
      buildCatChecks();
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

  function initAppleSignIn() {
    if (!window.AppleID || APPLE_CLIENT_ID.indexOf('REPLACE_WITH') === 0) return;
    AppleID.auth.init({
      clientId: APPLE_CLIENT_ID,
      scope: 'name email',
      redirectURI: window.location.origin + window.location.pathname,
      usePopup: true
    });
  }

  el.appleSignInBtn.addEventListener('click', function () {
    if (!window.AppleID) { showLoginError('Apple Sign-In ще не готовий, спробуй за мить.'); return; }
    AppleID.auth.signIn().then(function (res) {
      var name;
      if (res.user && res.user.name) {
        name = (res.user.name.firstName || '') + ' ' + (res.user.name.lastName || '');
        name = name.trim();
      }
      return apiFetch('/auth/apple', {
        method: 'POST',
        body: JSON.stringify({ idToken: res.authorization.id_token, name: name })
      });
    }).then(function (data) {
      afterAuthSuccess(data.token, data.user);
    }).catch(function (err) {
      if (err && err.error === 'popup_closed_by_user') return;
      showLoginError('Не вдалося увійти через Apple.');
    });
  });

  el.switchUserBtn.addEventListener('click', logout);

  // ---------- Вибір рівня і теми ----------
  function buildCatChecks() {
    el.catChecks.innerHTML = '';
    CATS.forEach(function (cat) {
      var label = document.createElement('label');
      label.className = 'check';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = cat;
      input.checked = true;
      input.addEventListener('change', refreshStats);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + CAT_LABELS[cat]));
      el.catChecks.appendChild(label);
    });
  }

  function selectedCats() {
    return Array.prototype.slice
      .call(el.catChecks.querySelectorAll('input:checked'))
      .map(function (i) { return i.value; });
  }

  function filteredExercises() {
    var cats = selectedCats();
    var level = el.levelSelect.value;
    return window.EXERCISES.filter(function (ex) {
      if (cats.indexOf(ex.cat) === -1) return false;
      if (level !== 'all' && ex.level !== level) return false;
      return true;
    });
  }

  // Розкладає вправи на 4 черги за пріоритетом показу:
  // 1) struggling — активно вивчається, остання відповідь невірна (показувати найчастіше)
  // 2) recheck    — вже "вивчено", але настав час періодичної перевірки
  // 3) inProgress — активно вивчається, остання відповідь вірна (streak 1-2)
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
    var buckets = classify(exs);
    var learned = 0;
    exs.forEach(function (ex) {
      var p = progressCache[ex.id];
      if (p && p.state === 'learned') learned += 1;
    });
    el.struggleCount.textContent = buckets.struggling.length;
    el.recheckCount.textContent = buckets.recheck.length;
    el.newCount.textContent = buckets.fresh.length;
    el.learnedCount.textContent = learned;
    el.totalCount.textContent = exs.length;
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
    var exs = filteredExercises();
    var buckets = classify(exs);
    shuffle(buckets.struggling);
    shuffle(buckets.recheck);
    shuffle(buckets.inProgress);
    shuffle(buckets.fresh);

    var newLimit = Math.max(0, parseInt(el.newPerSession.value, 10) || 0);
    var freshSlice = buckets.fresh.slice(0, newLimit);

    var queue = buckets.struggling.concat(buckets.recheck, buckets.inProgress, freshSlice);

    var maxSize = Math.max(0, parseInt(el.maxSessionSize.value, 10) || 0);
    if (maxSize > 0 && queue.length > maxSize) queue = queue.slice(0, maxSize);

    if (queue.length === 0) {
      alert('Немає карток для повторення прямо зараз. Спробуй додати нові картки за сесію або зачекати до наступної перевірки.');
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
    el.translationText.hidden = true;
    el.translationText.textContent = ex.tr;
    el.checkBtn.textContent = 'Перевірити';
    el.checkBtn.disabled = false;

    el.progressText.textContent = 'Переглянуто: ' + session.reviewed + ' · Залишилось: ' + (session.queue.length - session.pointer);
    var pct = session.queue.length ? Math.round((session.reviewed / (session.reviewed + (session.queue.length - session.pointer))) * 100) : 0;
    el.progressBar.style.width = pct + '%';

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
          ? '✓ Правильно! Ця тема вивчена 🎉'
          : '✓ Правильно! (' + p.streak + '/' + LEARNED_STREAK + ' поспіль)';
      } else {
        el.feedback.textContent = '✗ Правильна відповідь: ' + ex.answer[0];
      }
      el.feedbackNote.textContent = ex.note;
      el.answerInput.className = isCorrect ? 'ok' : 'bad';
      el.checkBtn.textContent = 'Далі →';
      el.checkBtn.disabled = false;
      session.mode = 'next';
      el.answerInput.focus();

      if (!isCorrect) {
        var reinsertAt = session.pointer + 1 + 5 + Math.floor(Math.random() * 4); // +5..+8
        var pos = Math.min(reinsertAt, session.queue.length);
        session.queue.splice(pos, 0, ex.id);
      }

      refreshStats();
    }).catch(function () {
      el.feedback.className = 'feedback bad';
      el.feedback.textContent = 'Помилка з’єднання із сервером. Спробуй перевірити ще раз.';
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
      '<div><strong>' + session.reviewed + '</strong><span>переглянуто карток</span></div>' +
      '<div><strong>' + accuracy + '%</strong><span>точність</span></div>' +
      '<div><strong>' + session.wrong + '</strong><span>помилок</span></div>';
    session = null;
    showScreen('summary');
    refreshStats();
  }

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
      el.historySummary.textContent =
        'Вивчено ' + learnedTotal + ' із ' + window.EXERCISES.length + ' вправ · Проведено сесій: ' + sessions.length;

      var withProgress = window.EXERCISES
        .map(function (ex) { var p = progressCache[ex.id]; return p ? { ex: ex, p: p } : null; })
        .filter(Boolean);

      var problems = withProgress
        .filter(function (item) { return item.p.total_wrong > 0 && item.p.state !== 'learned'; })
        .sort(function (a, b) { return b.p.total_wrong - a.p.total_wrong; })
        .slice(0, 12);

      el.historyProblems.innerHTML = problems.length
        ? problems.map(function (item) {
            return '<div class="problem-row"><span>' + CAT_LABELS[item.ex.cat] + ' · ' + item.ex.topic +
              '</span><span class="problem-count">' + item.p.total_wrong + ' пом. · streak ' + item.p.streak + '/' + LEARNED_STREAK + '</span></div>';
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

  // ---------- Events ----------
  el.startBtn.addEventListener('click', startSession);
  el.levelSelect.addEventListener('change', refreshStats);
  el.newPerSession.addEventListener('change', refreshStats);
  el.maxSessionSize.addEventListener('change', refreshStats);

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
    if (confirm('Завершити сесію достроково? Прогрес по вже відповіданих картках збережеться.')) {
      endSession();
    }
  });
  el.historyBtn.addEventListener('click', function () {
    renderHistory();
    showScreen('history');
  });
  el.historyBack.addEventListener('click', function () { showScreen('select'); refreshStats(); });
  el.resetBtn.addEventListener('click', function () {
    if (confirm('Скинути весь твій прогрес (вивчені картки, лічильники, історію сесій)? Цю дію не можна скасувати.')) {
      apiFetch('/api/reset', { method: 'POST', body: '{}' }).then(function () {
        progressCache = {};
        refreshStats();
      }).catch(function () {
        alert('Не вдалося скинути прогрес — перевір з’єднання із сервером.');
      });
    }
  });

  // ---------- Init ----------
  el.appleSignInBtn.textContent = APPLE_BUTTON_TEXT[UI_LANG];

  // SDK Google/Apple підключаються асинхронно — ініціалізуємо після події load
  window.addEventListener('load', function () {
    initGoogleSignIn();
    initAppleSignIn();
  });

  var savedUser = null;
  try { savedUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { /* ignore */ }
  if (apiToken && savedUser) {
    el.userBarName.textContent = savedUser.name || savedUser.email || 'Користувач';
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

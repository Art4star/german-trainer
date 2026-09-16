(function () {
  'use strict';

  var CATS = ['artikel', 'praeposition', 'pronomen', 'adjektiv', 'konjunktiv'];
  var CAT_LABELS = { artikel: 'Artikel', praeposition: 'Präpositionen', pronomen: 'Pronomen', adjektiv: 'Adjektivendungen', konjunktiv: 'Konjunktiv' };

  var DB_KEY = 'deutsch-trainer:db:v2';
  var CURRENT_USER_KEY = 'deutsch-trainer:currentUserId';
  var MAX_ATTEMPTS = 5000;       // обмеження на розмір логу спроб у localStorage
  var LEARNED_STREAK = 3;        // скільки вірних поспіль треба, щоб картка стала "вивченою"
  var RECHECK_START_DAYS = 30;   // перша повторна перевірка вивченої картки — через N днів
  var RECHECK_MAX_DAYS = 180;    // стеля для інтервалу повторних перевірок

  var USER_ID = null; // встановлюється після логіну

  // ---------- Дата/час helpers ----------
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  function nowIso() {
    return new Date().toISOString();
  }
  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ---------- Persistence: User / Progress / Attempt / Session ----------
  function loadDb() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore, fall through to fresh db */ }
    return { users: {}, progress: {}, attempts: [], sessions: [] };
  }
  function saveDb() {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  var db = loadDb();

  function slugify(name) {
    var s = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
    return s || 'user';
  }

  function listUsers() {
    return Object.keys(db.users)
      .map(function (id) { return db.users[id]; })
      .sort(function (a, b) { return (b.lastLoginAt || b.createdAt).localeCompare(a.lastLoginAt || a.createdAt); });
  }

  function loginAs(name) {
    var id = slugify(name);
    if (!db.users[id]) {
      db.users[id] = { id: id, name: name.trim(), createdAt: nowIso(), lastLoginAt: nowIso() };
    } else {
      db.users[id].lastLoginAt = nowIso();
      db.users[id].name = name.trim();
    }
    saveDb();
    USER_ID = id;
    localStorage.setItem(CURRENT_USER_KEY, id);
  }

  function logout() {
    USER_ID = null;
    localStorage.removeItem(CURRENT_USER_KEY);
  }

  function progressKey(exerciseId) {
    return USER_ID + ':' + exerciseId;
  }
  function getProgress(exerciseId) {
    return db.progress[progressKey(exerciseId)] || null;
  }
  function ensureProgress(exerciseId) {
    var key = progressKey(exerciseId);
    var p = db.progress[key];
    if (!p) {
      p = {
        userId: USER_ID, exerciseId: exerciseId,
        streak: 0, totalCorrect: 0, totalWrong: 0,
        state: 'learning', learnedAt: null, nextCheckAt: null, recheckDays: null,
        lastResult: null, lastSeenAt: null
      };
      db.progress[key] = p;
    }
    return p;
  }

  // Вірно 3 рази поспіль → "вивчено". Помилка скидає лічильник і повертає в активне вивчення.
  // Вивчена картка періодично "спливає" на перевірку (nextCheckAt); якщо там знову вірно —
  // інтервал до наступної перевірки подвоюється (30 → 60 → 120 → 180 днів, стеля).
  function updateProgress(exerciseId, correct) {
    var p = ensureProgress(exerciseId);
    var wasLearned = p.state === 'learned';
    if (correct) {
      p.streak += 1;
      p.totalCorrect += 1;
      if (wasLearned) {
        var prevDays = p.recheckDays || RECHECK_START_DAYS;
        var nextDays = Math.min(RECHECK_MAX_DAYS, Math.round(prevDays * 2));
        p.recheckDays = nextDays;
        p.nextCheckAt = addDays(todayStr(), nextDays);
      } else if (p.streak >= LEARNED_STREAK) {
        p.state = 'learned';
        p.learnedAt = nowIso();
        p.recheckDays = RECHECK_START_DAYS;
        p.nextCheckAt = addDays(todayStr(), RECHECK_START_DAYS);
      }
    } else {
      p.streak = 0;
      p.totalWrong += 1;
      if (wasLearned) {
        p.state = 'learning';
        p.learnedAt = null;
        p.nextCheckAt = null;
        p.recheckDays = null;
      }
    }
    p.lastResult = correct ? 'correct' : 'wrong';
    p.lastSeenAt = nowIso();
    saveDb();
    return p;
  }

  function recordAttempt(exerciseId, correct, givenAnswer, sessionId) {
    db.attempts.push({
      id: 'a_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      userId: USER_ID, sessionId: sessionId, exerciseId: exerciseId,
      correct: correct, givenAnswer: givenAnswer, timestamp: nowIso()
    });
    if (db.attempts.length > MAX_ATTEMPTS) {
      db.attempts.splice(0, db.attempts.length - MAX_ATTEMPTS);
    }
    saveDb();
  }

  function startSessionRecord() {
    var s = { id: 's_' + Date.now(), userId: USER_ID, startedAt: nowIso(), endedAt: null, reviewed: 0, correct: 0, wrong: 0 };
    db.sessions.push(s);
    saveDb();
    return s;
  }
  function finalizeSessionRecord(rec, reviewed, correct, wrong) {
    rec.endedAt = nowIso();
    rec.reviewed = reviewed; rec.correct = correct; rec.wrong = wrong;
    saveDb();
  }
  function userSessions() {
    return db.sessions.filter(function (s) { return s.userId === USER_ID; });
  }

  // ---------- DOM ----------
  var el = {
    userBar: document.getElementById('userBar'),
    userBarName: document.getElementById('userBarName'),
    switchUserBtn: document.getElementById('switchUserBtn'),

    screenLogin: document.getElementById('screen-login'),
    loginExisting: document.getElementById('loginExisting'),
    loginNameInput: document.getElementById('loginNameInput'),
    loginBtn: document.getElementById('loginBtn'),

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
  var session = null; // { queue, pointer, reviewed, correct, wrong, mode, sessionId, record }

  function showScreen(name) {
    el.screenLogin.hidden = name !== 'login';
    el.screenSelect.hidden = name !== 'select';
    el.screenQuiz.hidden = name !== 'quiz';
    el.screenSummary.hidden = name !== 'summary';
    el.screenHistory.hidden = name !== 'history';
    el.userBar.hidden = name === 'login';
  }

  // ---------- Логін ----------
  function renderLogin() {
    var users = listUsers();
    el.loginExisting.innerHTML = '';
    if (users.length) {
      var label = document.createElement('div');
      label.className = 'field-label';
      label.textContent = 'Продовжити як:';
      el.loginExisting.appendChild(label);
      users.forEach(function (u) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn profile-btn';
        btn.textContent = u.name;
        btn.addEventListener('click', function () { enterAsUser(u.name); });
        el.loginExisting.appendChild(btn);
      });
    }
    el.loginNameInput.value = '';
  }

  function enterAsUser(name) {
    if (!name || !name.trim()) return;
    loginAs(name);
    el.userBarName.textContent = db.users[USER_ID].name;
    buildCatChecks();
    refreshStats();
    showScreen('select');
  }

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
      var p = getProgress(ex.id);
      if (!p) { fresh.push(ex.id); return; }
      if (p.state === 'learned') {
        if (p.nextCheckAt && p.nextCheckAt <= today) recheck.push(ex.id);
        return;
      }
      if (p.lastResult === 'wrong') struggling.push(ex.id);
      else inProgress.push(ex.id);
    });
    return { struggling: struggling, recheck: recheck, inProgress: inProgress, fresh: fresh };
  }

  function refreshStats() {
    var exs = filteredExercises();
    var buckets = classify(exs);
    var learned = 0;
    exs.forEach(function (ex) {
      var p = getProgress(ex.id);
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

    var rec = startSessionRecord();
    session = { queue: queue, pointer: 0, reviewed: 0, correct: 0, wrong: 0, mode: 'check', sessionId: rec.id, record: rec };
    showScreen('quiz');
    renderCurrent();
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

    recordAttempt(ex.id, isCorrect, given, session.sessionId);
    var p = updateProgress(ex.id, isCorrect);
    session.reviewed += 1;
    if (isCorrect) session.correct += 1; else session.wrong += 1;

    el.feedback.hidden = false;
    el.feedback.className = 'feedback ' + (isCorrect ? 'ok' : 'bad');
    if (isCorrect) {
      el.feedback.textContent = p.state === 'learned'
        ? '✓ Правильно! Ця тема вивчена 🎉'
        : '✓ Правильно! (' + p.streak + '/' + LEARNED_STREAK + ' поспіль)';
    } else {
      el.feedback.textContent = '✗ Правильна відповідь: ' + ex.answer[0];
    }
    el.feedbackNote.textContent = ex.note;
    el.answerInput.readOnly = true;
    el.answerInput.className = isCorrect ? 'ok' : 'bad';
    el.checkBtn.textContent = 'Далі →';
    session.mode = 'next';
    el.answerInput.focus();

    if (!isCorrect) {
      var reinsertAt = session.pointer + 1 + 5 + Math.floor(Math.random() * 4); // +5..+8
      var pos = Math.min(reinsertAt, session.queue.length);
      session.queue.splice(pos, 0, ex.id);
    }

    refreshStats();
  }

  function nextCard() {
    session.pointer += 1;
    renderCurrent();
  }

  // ---------- Результат ----------
  function endSession() {
    var accuracy = session.reviewed ? Math.round((session.correct / session.reviewed) * 100) : 0;
    finalizeSessionRecord(session.record, session.reviewed, session.correct, session.wrong);
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
    var learnedTotal = window.EXERCISES.filter(function (ex) {
      var p = getProgress(ex.id);
      return p && p.state === 'learned';
    }).length;
    var sessions = userSessions();
    el.historySummary.textContent =
      'Вивчено ' + learnedTotal + ' із ' + window.EXERCISES.length + ' вправ · Проведено сесій: ' + sessions.length;

    var withProgress = window.EXERCISES
      .map(function (ex) { var p = getProgress(ex.id); return p ? { ex: ex, p: p } : null; })
      .filter(Boolean);

    var problems = withProgress
      .filter(function (item) { return item.p.totalWrong > 0 && item.p.state !== 'learned'; })
      .sort(function (a, b) { return b.p.totalWrong - a.p.totalWrong; })
      .slice(0, 12);

    el.historyProblems.innerHTML = problems.length
      ? problems.map(function (item) {
          return '<div class="problem-row"><span>' + CAT_LABELS[item.ex.cat] + ' · ' + item.ex.topic +
            '</span><span class="problem-count">' + item.p.totalWrong + ' пом. · streak ' + item.p.streak + '/' + LEARNED_STREAK + '</span></div>';
        }).join('')
      : '<p class="muted">Проблемних тем поки немає.</p>';

    var recent = sessions.slice().reverse().slice(0, 30);
    if (recent.length) {
      var rows = recent.map(function (s) {
        var d = new Date(s.startedAt);
        var dateStr = d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        var acc = s.reviewed ? Math.round((s.correct / s.reviewed) * 100) : 0;
        var unfinished = s.endedAt ? '' : ' <span class="muted">(перервано)</span>';
        return '<tr><td>' + dateStr + unfinished + '</td><td>' + s.reviewed + '</td><td>' + acc + '%</td><td>' + s.wrong + '</td></tr>';
      }).join('');
      el.historySessions.innerHTML =
        '<table class="history-table"><thead><tr><th>Дата</th><th>Карток</th><th>Точність</th><th>Помилок</th></tr></thead><tbody>' + rows + '</tbody></table>';
    } else {
      el.historySessions.innerHTML = '<p class="muted">Ще немає жодної сесії.</p>';
    }
  }

  // ---------- Events ----------
  el.loginBtn.addEventListener('click', function () { enterAsUser(el.loginNameInput.value); });
  el.loginNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); enterAsUser(el.loginNameInput.value); }
  });
  el.switchUserBtn.addEventListener('click', function () {
    logout();
    renderLogin();
    showScreen('login');
  });

  el.startBtn.addEventListener('click', startSession);
  el.levelSelect.addEventListener('change', refreshStats);
  el.newPerSession.addEventListener('change', refreshStats);
  el.maxSessionSize.addEventListener('change', refreshStats);

  el.checkBtn.addEventListener('click', function () {
    if (session.mode === 'check') checkAnswer();
    else nextCard();
  });
  el.answerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (session.mode === 'check') checkAnswer();
      else nextCard();
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
    if (confirm('Скинути весь прогрес (вивчені картки, лічильники, історію сесій) для цього користувача? Цю дію не можна скасувати.')) {
      Object.keys(db.progress).forEach(function (key) {
        if (db.progress[key].userId === USER_ID) delete db.progress[key];
      });
      db.attempts = db.attempts.filter(function (a) { return a.userId !== USER_ID; });
      db.sessions = db.sessions.filter(function (s) { return s.userId !== USER_ID; });
      saveDb();
      refreshStats();
    }
  });

  // ---------- Init ----------
  renderLogin();
  var savedUserId = localStorage.getItem(CURRENT_USER_KEY);
  if (savedUserId && db.users[savedUserId]) {
    USER_ID = savedUserId;
    el.userBarName.textContent = db.users[USER_ID].name;
    buildCatChecks();
    refreshStats();
    showScreen('select');
  } else {
    showScreen('login');
  }
})();

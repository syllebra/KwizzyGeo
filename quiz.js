/* KwizzyGeo quiz: the screens. Everything that is not a question (which country,
   which capital, which flag, which five wrong answers) lives in quizcore.js; this
   file is the DOM, the keyboard and the hand-over of the map.

   THREE SCREENS, one container (#quiz):
     start    the first page on load: mode, zone, difficulty, Play
     question the map (or the flag), the six options, then the verdict
     end      the score, the round's dots, play again / change settings

   The map is borrowed, not owned: MapApp.enter() pins the layer and silences the
   labels and the panel, MapApp.show() lights a country up and flies to it,
   MapApp.exit() gives it all back. The viewer is untouched by any of this when no
   quiz is running. */
(function () {
'use strict';

var Q = window.QuizCore;
var M = window.MapApp;
if (!Q || !M) return;

var quizEl = document.getElementById('quiz');
var bodyEl = document.body;

/* the config survives a reload; a private-mode browser simply forgets it */
var STORE = 'kwizzy.quiz.cfg';
var cfg = { mode: 'country', zone: 'world', difficulty: 'medium', len: 10, variant: 'name' };
try {
  var saved = window.localStorage.getItem(STORE);
  if (saved) {
    var o = JSON.parse(saved);
    if (o && typeof o === 'object') {
      if (Q.MODES.length) for (var i0 = 0; i0 < Q.MODES.length; i0++) if (o.mode === Q.MODES[i0].id) cfg.mode = o.mode;
      for (var i1 = 0; i1 < Q.ZONES.length; i1++) if (o.zone === Q.ZONES[i1].id) cfg.zone = o.zone;
      for (var i2 = 0; i2 < Q.DIFFS.length; i2++) if (o.difficulty === Q.DIFFS[i2].id) cfg.difficulty = o.difficulty;
      for (var i3 = 0; i3 < Q.FLAG_ASK.length; i3++) if (o.variant === Q.FLAG_ASK[i3].id) cfg.variant = o.variant;
    }
  }
} catch (e) { /* private mode: keep the defaults */ }
function storeCfg() {
  try { window.localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {}
}

var screen = 'start';        /* start | question | end */
var session = null, q = null, answered = false, chosen = -1;
var infoMsg = '';

/* ---------- tiny helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flagSpan(code, cls) {
  if (!code || !/^[a-z]{2}$/.test(code)) return '';
  return '<span class="fi fi-' + code + (cls ? ' ' + cls : '') + '"></span>';
}
function zoneLabel(id) {
  for (var i = 0; i < Q.ZONES.length; i++) if (Q.ZONES[i].id === id) return Q.ZONES[i].label;
  return id;
}
function diffLabel(id) {
  for (var i = 0; i < Q.DIFFS.length; i++) if (Q.DIFFS[i].id === id) return Q.DIFFS[i].label;
  return id;
}
function variantSub(id) {
  for (var i = 0; i < Q.FLAG_ASK.length; i++) if (Q.FLAG_ASK[i].id === id) return Q.FLAG_ASK[i].sub;
  return '';
}
function modeLabel(id) {
  for (var i = 0; i < Q.MODES.length; i++) if (Q.MODES[i].id === id) return Q.MODES[i].label;
  return id;
}
function flagsReady() { return M.ready(); }
function capsReady() { return M.placesReady(); }
function bestKey() { return 'kwizzy.quiz.best.' + cfg.mode + '.' + cfg.zone + '.' + cfg.difficulty; }
function bestOf() {
  try { var v = parseInt(window.localStorage.getItem(bestKey()), 10); return isFinite(v) ? v : -1; }
  catch (e) { return -1; }
}
function saveBest(n) {
  var b = bestOf();
  if (n <= b) return b;
  try { window.localStorage.setItem(bestKey(), String(n)); } catch (e) {}
  return n;
}

/* ---------- screen 1: the first page ---------- */
function startHTML() {
  var ready = flagsReady();
  var h = '';
  h += '<div class="qz-scrim"></div>';
  h += '<div class="qz-card">';
  h += '<div class="qz-brand"><h1>Kwizzy<span>Geo</span></h1>' +
       '<p>Ten questions, six answers, one map.</p></div>';

  h += '<div class="qz-h">Find</div><div class="qz-modes">';
  for (var i = 0; i < Q.MODES.length; i++) {
    var md = Q.MODES[i];
    var waitCap = (md.id === 'capital' && !capsReady());
    h += '<button class="qz-mode' + (cfg.mode === md.id ? ' on' : '') + (waitCap ? ' wait' : '') +
         '" data-mode="' + md.id + '">' +
         '<span class="ico">' + md.ico + '</span>' +
         '<span class="t">' + esc(md.label) + '</span>' +
         '<span class="s">' + (waitCap ? 'loading the capitals…' : esc(md.sub)) + '</span>' +
         '</button>';
  }
  h += '</div>';

  /* THE FLAG QUESTION HAS TWO HALVES: name the country from the flag, or pick the
     flag of a named country. The row only exists while the flag mode is picked, so
     the page does not grow a permanent setting that is meaningless for the others. */
  if (cfg.mode === 'flag') {
    h += '<div class="qz-h">Flag question</div><div class="chips qz-row">';
    for (var v = 0; v < Q.FLAG_ASK.length; v++) {
      h += '<button class="chip' + (cfg.variant === Q.FLAG_ASK[v].id ? ' on' : '') + '" data-variant="' +
           Q.FLAG_ASK[v].id + '">' + esc(Q.FLAG_ASK[v].label) + '</button>';
    }
    h += '</div><div class="qz-note">' + esc(variantSub(cfg.variant)) + '</div>';
  }

  h += '<div class="qz-h">Zone</div><div class="chips qz-row">';
  for (var z = 0; z < Q.ZONES.length; z++) {
    h += '<button class="chip' + (cfg.zone === Q.ZONES[z].id ? ' on' : '') + '" data-zone="' +
         Q.ZONES[z].id + '">' + esc(Q.ZONES[z].label) + '</button>';
  }
  h += '</div>';

  h += '<div class="qz-h">Difficulty</div><div class="chips qz-row">';
  for (var d = 0; d < Q.DIFFS.length; d++) {
    h += '<button class="chip' + (cfg.difficulty === Q.DIFFS[d].id ? ' on' : '') + '" data-diff="' +
         Q.DIFFS[d].id + '">' + esc(Q.DIFFS[d].label) + '</button>';
  }
  h += '</div>';
  h += '<div class="qz-note">' + esc(diffSub(cfg.difficulty)) + '</div>';

  h += '<div class="qz-actions"><button class="qz-play" data-act="play"' +
       (ready ? '' : ' disabled') + '>' + (ready ? 'Play' : 'Loading the map…') + '</button></div>';
  h += '<div class="qz-note qz-info">' + esc(infoMsg || defaultInfo()) + '</div>';
  h += '<div class="qz-foot"><a class="qz-link" data-act="explore">Explore the map instead</a>' +
       '<span class="qz-best">' + bestText() + '</span></div>';
  h += '</div>';
  return h;
}
function diffSub(id) {
  for (var i = 0; i < Q.DIFFS.length; i++) if (Q.DIFFS[i].id === id) return Q.DIFFS[i].sub;
  return '';
}
function defaultInfo() {
  if (!flagsReady()) return 'Loading the map…';
  if (cfg.mode === 'capital' && !capsReady()) return 'Loading the capital cities…';
  return '';
}
function bestText() {
  var b = bestOf();
  if (b < 0) return '';
  return 'best here: ' + b + ' / ' + cfg.len;
}

/* ---------- screen 2: a question ---------- */
function askHTML() {
  var h = '';
  if (q.mode === 'country') {
    h += '<div class="qz-q">Which country is lit up?</div>' +
         '<div class="qz-sub">' + esc(zoneLabel(q.zone)) + ' · ' + esc(diffLabel(q.difficulty)) + '</div>';
  } else if (q.mode === 'capital') {
    h += '<div class="qz-q">What is the capital of <b>' + esc(q.answer.name) + '</b>?</div>' +
         '<div class="qz-sub">' + esc(zoneLabel(q.zone)) + ' · ' + esc(diffLabel(q.difficulty)) + '</div>';
  } else if (q.variant === 'flags') {
    /* the country is NAMED and lit up on the map, with its capital: the flag is the
       answer, so it must not be anywhere on screen */
    var bits = [];
    if (q.answer.cap) bits.push('capital ' + esc(q.answer.cap));
    if (q.answer.cont) bits.push(esc(q.answer.cont));
    h += '<div class="qz-q">Which flag is <b>' + esc(q.answer.name) + '</b>&rsquo;s?</div>' +
         '<div class="qz-sub">' + (bits.length ? bits.join(' · ') : esc(zoneLabel(q.zone))) + '</div>';
  } else {
    /* the prompt and the flag on ONE row: the country is centred on the map behind
       this card, and a stack of title + 100 px flag covered the top third of it */
    h += '<div class="qz-flagrow"><span class="qz-q">Whose flag is this?</span>' +
         '<span class="qz-flagwrap">' + flagSpan(q.answer.flag, 'qz-bigflag') + '</span></div>';
  }
  return h;
}
function optionLabel(it) {
  return q.mode === 'capital' ? it.cap : it.name;
}
function flagsAsOptions() { return q.mode === 'flag' && q.variant === 'flags'; }
function answersHTML() {
  var asFlags = flagsAsOptions();
  var h = '<div class="qz-answers' + (asFlags ? ' qz-answers-flags' : '') + '">';
  for (var i = 0; i < q.options.length; i++) {
    var cls = 'qz-ans';
    if (answered) {
      if (i === q.correct) cls += ' ok';
      else if (i === chosen) cls += ' bad';
      else cls += ' off';
    }
    h += '<button class="' + cls + '" data-i="' + i + '"' + (answered ? ' disabled' : '') + '>' +
         '<span class="n">' + (i + 1) + '</span>';
    if (asFlags) {
      /* the flag IS the option: no label, and `aria-label` carries the country name
         for a screen reader (and for the headless test) */
      h += '<span class="fl" aria-label="' + esc(q.options[i].name) + '">' +
           flagSpan(q.options[i].flag, 'qz-optflag') + '</span>';
      /* ONCE ANSWERED the flags get their countries' names: a wrong option that
         stays anonymous teaches nothing, and the names were the whole reason the
         flags were hidden before. */
      if (answered) h += '<span class="cap">' + esc(q.options[i].name) + '</span>';
    } else {
      h += '<span class="v">' + esc(optionLabel(q.options[i])) + '</span>';
    }
    h += '</button>';
  }
  return h + '</div>';
}
function revealHTML() {
  var a = q.answer;
  /* THE VERDICT IS THE VERDICT, and the line beside it is the ANSWER. Printing the
     right answer inside the verdict as well ("✕ Trinidad and Tobago" next to
     "Trinidad and Tobago") said the same thing twice and read like a bug. */
  var facts;
  if (q.mode === 'capital') {
    /* the question was about the CITY, so the answer line leads with the city */
    facts = flagSpan(a.flag, 'fis') + ' <b>' + esc(a.cap) + '</b>' +
            ' <span class="qz-dim">· capital of ' + esc(a.name) +
            (a.cont ? ' · ' + esc(a.cont) : '') + '</span>';
  } else {
    facts = flagSpan(a.flag, 'fis') + ' <b>' + esc(a.name) + '</b>';
    var bits = [];
    if (a.cap) bits.push('capital ' + esc(a.cap));
    if (a.cont) bits.push(esc(a.cont));
    if (bits.length) facts += ' <span class="qz-dim">· ' + bits.join(' · ') + '</span>';
  }
  /* THE DETAILS. Answering a question should teach something, so the verdict comes
     with the same panel a click on the map opens: the country's own facts, or - when
     the question was about a capital - the CITY's. Rendered by app.js
     (MapApp.countryPanel / capitalPanel), i.e. by the one builder the info panel
     uses, so the two cannot disagree about a country's area or its second capital. */
  var details = '';
  try {
    details = (q.mode === 'capital') ? M.capitalPanel(a.id) : M.countryPanel(a.id);
  } catch (e) { details = ''; }
  var last = (session.i >= session.cfg.len);
  return '<div class="qz-reveal">' +
    '<div class="qz-head">' +
    '<span class="qz-verdict ' + (q.ok ? 'good' : 'bad') + '">' +
    (q.ok ? '\u2713 Correct' : '\u2715 Wrong') + '</span>' +
    '<span class="qz-facts">' + facts + '</span>' +
    '<button class="qz-next" data-act="next">' + (last ? 'Results \u2192' : 'Next \u2192') +
    '</button></div>' +
    (details ? '<div class="qz-details">' + details + '</div>' : '') +
    '</div>';
}
function questionHTML() {
  var h = '';
  h += '<div class="qz-top">' +
       '<button class="qz-x" data-act="quit" title="Back to the menu">\u2715</button>' +
       '<div class="qz-mid"><span class="qz-prog">Question ' + session.i + ' / ' + session.cfg.len +
       '</span><span class="qz-score">' + session.score + ' \u2713</span></div>' +
       '</div>';
  h += '<div class="qz-ask' + (q.mode === 'flag' && q.variant === 'name' ? ' qz-ask-flag' : '') + '">' +
       askHTML() + '</div>';
  h += '<div class="qz-bottom">' + (answered ? revealHTML() : '') + answersHTML() + '</div>';
  return h;
}

/* ---------- screen 3: the score ---------- */
function endHTML() {
  var n = session.asked.length, ok = 0, dots = '';
  for (var i = 0; i < n; i++) {
    var a = session.asked[i];
    if (a.ok) ok++;
    dots += '<span class="qz-dot' + (a.ok ? ' good' : ' bad') + '"></span>';
  }
  var best = saveBest(ok);
  var msg = ok === n ? 'Every one. Ridiculous.' :
            ok >= n * 0.8 ? 'Strong. The map is yours.' :
            ok >= n * 0.5 ? 'Solid half. Again?' :
            'The map wins this round.';
  return '<div class="qz-scrim"></div><div class="qz-card qz-endcard">' +
    '<div class="qz-h">' + esc(modeLabel(session.cfg.mode)) + ' · ' + esc(zoneLabel(session.cfg.zone)) +
    ' · ' + esc(diffLabel(session.cfg.difficulty)) + '</div>' +
    '<div class="qz-endh">' + ok + ' <span>/ ' + n + '</span></div>' +
    '<div class="qz-dots">' + dots + '</div>' +
    '<div class="qz-endmsg">' + esc(msg) + '</div>' +
    '<div class="qz-note">best here: ' + best + ' / ' + n + '</div>' +
    '<div class="qz-actions"><button class="qz-play" data-act="again">Play again</button>' +
    '<button class="qz-ghost" data-act="menu">Change settings</button></div>' +
    '</div>';
}

/* ---------- render ---------- */
function render() {
  if (!quizEl) return;
  if (screen === 'start') quizEl.innerHTML = startHTML();
  else if (screen === 'question') quizEl.innerHTML = questionHTML();
  else quizEl.innerHTML = endHTML();
  quizEl.className = 'qz-on qz-' + screen;
  if (bodyEl && bodyEl.classList) {
    if (screen === 'question') bodyEl.classList.add('qz-playing');
    else bodyEl.classList.remove('qz-playing');
  }
}
function info(msg) { infoMsg = msg || ''; if (screen === 'start') render(); }

/* ---------- the flow ---------- */
function startSession() {
  if (!flagsReady()) { info('The map is still loading…'); return false; }
  if (cfg.mode === 'capital' && !capsReady()) { info('The capital cities are still loading…'); return false; }
  /* HAND THE MAP OVER FIRST, then read the country list: enter() pins the layer, and
     the list must be the one the pinned layer actually draws (app.js paints the 50m
     layer and swaps the 10m one in when its 11 MB arrive - building the items before
     that would key a session to a layer that is no longer on screen). */
  if (!M.enter()) { info('The map is not ready yet.'); return false; }
  var items = M.items();
  var pool = Q.poolFor(items, cfg.zone, cfg.mode);
  if (pool.length < Q.N_OPT) {
    M.exit();
    info('Not enough countries in ' + zoneLabel(cfg.zone) + ' for six answers - pick another zone.');
    return false;
  }
  session = Q.newSession(items, cfg, (Math.random() * 2147483647) | 0);
  infoMsg = '';
  screen = 'question';
  nextQuestion();
  return true;
}
function nextQuestion() {
  q = Q.nextQuestion(session);
  answered = false;
  chosen = -1;
  if (!q) { endScreen(); return; }
  /* EVERY mode flies to the country and lights it up, the flag ones included: the
     flag says what the country looks like, the map says where it is, and both
     variants of the flag question end on the same picture. */
  M.show(q.answer.id);
  render();
}
function choose(i) {
  if (!q || answered || screen !== 'question') return false;
  if (i < 0 || i >= q.options.length) return false;
  var res = Q.answerQuestion(session, q, i);
  if (!res) return false;
  answered = true;
  chosen = i;
  render();
  return res.ok;
}
function next() {
  if (!answered) return false;
  nextQuestion();
  return true;
}
function endScreen() {
  screen = 'end';
  render();
}
function quit() {
  session = null; q = null; answered = false; chosen = -1;
  screen = 'start';
  infoMsg = '';
  M.exit();
  render();
}
function open() {
  if (screen === 'question' && session) return;
  screen = 'start';
  session = null; q = null; answered = false;
  M.exit();
  render();
}
function hide() {
  if (M.quizOn()) M.exit();
  quizEl.className = '';
  if (bodyEl && bodyEl.classList) bodyEl.classList.remove('qz-playing');
}

/* ---------- input ---------- */
function attrUp(el, name) {
  while (el && el !== quizEl && el.getAttribute) {
    if (el.getAttribute('data-' + name) != null) return el;
    el = el.parentNode;
  }
  return null;
}
if (quizEl && quizEl.addEventListener) {
  quizEl.addEventListener('click', function (e) {
    var el = attrUp(e.target, 'act');
    if (el) {
      var act = el.getAttribute('data-act');
      if (act === 'play' || act === 'again') startSession();
      else if (act === 'next') next();
      else if (act === 'quit') quit();
      else if (act === 'menu') quit();
      else if (act === 'explore') hide();
      return;
    }
    el = attrUp(e.target, 'mode');
    if (el) { cfg.mode = el.getAttribute('data-mode'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'zone');
    if (el) { cfg.zone = el.getAttribute('data-zone'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'variant');
    if (el) { cfg.variant = el.getAttribute('data-variant'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'diff');
    if (el) { cfg.difficulty = el.getAttribute('data-diff'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'i');
    if (el) { choose(parseInt(el.getAttribute('data-i'), 10)); return; }
  });
}
window.addEventListener('keydown', function (e) {
  if (!quizEl || !quizEl.className) return;      /* the quiz is not on screen */
  if (screen === 'question') {
    if (e.key >= '1' && e.key <= '6') { choose(parseInt(e.key, 10) - 1); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === ' ') { next(); e.preventDefault(); return; }
    if (e.key === 'Escape') { quit(); return; }
  } else if (screen === 'end') {
    if (e.key === 'Enter') { startSession(); e.preventDefault(); return; }
    if (e.key === 'Escape') { quit(); return; }
  } else if (screen === 'start') {
    if (e.key === 'Enter') { startSession(); e.preventDefault(); }
  }
});

/* The start page is the FIRST page on load, before the map has anything on it: the
   buttons that need data say so and stay disabled until it lands (the map is
   fetched by app.js in the background, and a slow layer must not leave a dead
   Play button with no explanation). */
var readyTimer = null;
function watchReady() {
  if (readyTimer) return;
  readyTimer = setInterval(function () {
    if (!flagsReady()) return;
    if (screen !== 'start') { clearInterval(readyTimer); readyTimer = null; return; }
    if (cfg.mode === 'capital' && !capsReady() && infoMsg) return;
    render();
    clearInterval(readyTimer); readyTimer = null;
  }, 400);
}

/* ---------- public, for the burger row and for the tests ---------- */
window.Quizzy = {
  open: function () { open(); },
  close: function () { hide(); },
  /* Read-mostly state, plus the two entry points the buttons use, so a headless
     test drives exactly the same path a tap does. */
  state: function () {
    return {
      screen: screen,
      mode: cfg.mode, zone: cfg.zone, difficulty: cfg.difficulty, len: cfg.len,
      variant: cfg.variant,
      index: session ? session.i : 0, score: session ? session.score : 0,
      answered: answered, chosen: chosen,
      question: q ? {
        mode: q.mode, variant: q.variant, correct: q.correct,
        answer: q.answer.name, answerId: q.answer.id, flag: q.answer.flag,
        capital: q.answer.cap,
        options: q.options.map(function (it) { return { name: it.name, cap: it.cap, flag: it.flag, id: it.id }; })
      } : null,
      info: infoMsg
    };
  },
  config: function () {
    return { mode: cfg.mode, zone: cfg.zone, difficulty: cfg.difficulty, variant: cfg.variant };
  },
  set: function (patch) {
    if (!patch) return;
    if (patch.mode) cfg.mode = patch.mode;
    if (patch.zone) cfg.zone = patch.zone;
    if (patch.difficulty) cfg.difficulty = patch.difficulty;
    if (patch.variant) cfg.variant = patch.variant;
    storeCfg();
    if (screen === 'start') render();
  },
  start: function () { return startSession(); },
  choose: function (i) { return choose(i); },
  next: function () { return next(); },
  quit: function () { quit(); },
  html: function () { return quizEl ? quizEl.innerHTML : ''; },
  best: function () { return bestOf(); }
};

render();
watchReady();
})();

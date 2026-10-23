/* KwizzyGeo — ON CRAZYGAMES.
   One game, two homes: the same files are served by GitHub Pages and uploaded to
   CrazyGames, and the code asks where it is running rather than being forked.

   WHAT THE PLATFORM ASKS FOR, and where each answer lives:

     the SDK          index.html loads sdk.crazygames.com/crazygames-sdk-v3.js (defer), and
                      this file initialises it once the DOM is ready;
     no fullscreen    their own fills the page and a second one fights it, so the disc is
                      hidden in app.js (wireFs) and the CSS moves the disc beside it left
                      (style.css / quiz.css, `body.cg`);
     gameplay events  quiz.js calls gameplayStart when a question is up and gameplayStop
                      on every menu - the moment it leaves for free exploration included;
     loading events   loadingStart right here, at parse time; loadingStop when app.js has
                      drawn the first frame of the map (the end of loadAll);
     happytime        quiz.js, on a perfect round, and nowhere else;
     completion       progress(): the share of the four modes this player has played,
                      reported after every round and once at boot;
     muteAudio        game.settings / addSettingsChangeListener -> Juice.setMuted;
     locale           user.systemInfo.locale -> the game's own 18 languages.

   THE RULE THIS FILE KEEPS: the platform is a PLUS, never a dependency. Every call
   goes through one guarded path, is queued until init() has resolved, and is dropped
   without a throw when the SDK is absent, blocked by an adblocker or running on
   GitHub Pages. A player on a domain that is neither gets exactly the game that was
   there before this file existed.

   AND THE MISTAKE THIS FILE MADE, KEPT AS A WARNING: the first version armed a 10 s
   timer that set a DEAD flag when init had not resolved - and never cancelled it when
   init DID resolve. Ten seconds into every session the module went permanently deaf:
   loadingStart/loadingStop had already been sent (the platform's own debug panel showed
   them green) while gameplayStart, gameplayStop and happytime, which happen when the
   player actually plays, were silently dropped. Their QA panel is what caught it.
   There is no such timer now: a call that arrives before init is queued (bounded), the
   module asks boot() again, and nothing ever disables it.

   `isCrazyGames()` is the test the whole thing hangs on: the hostname CrazyGames serves
   the game from (their own game frame lives on games.crazygames.com, and the apps
   serve the same origins - see their sitelock page). `?crazysdk=1` turns the same mode
   on anywhere else, which is how the integration is tested on localhost: the SDK then
   reports the `local` environment and logs what it would have done.
   THE `disabled` ENVIRONMENT, the trap that cost a round of testing: on a domain the SDK
   does not serve, `init()` RESOLVES (it logs "HTML SDK initialized") and every game method
   then throws "CrazySDK is disabled on this domain". So init resolving is NOT proof the
   platform works: `environment` says so, and it is checked BEFORE init and after it. A
   disabled SDK means the game plays normally, at once, with no platform mode at all -
   never a loader waiting for something that will not come.

   THE LOG IS THE CONSOLE'S: `[crazy] ...` lines in devtools, nothing on screen. A tester
   reads the console; a player must never see instrumentation over the map. */
(function () {
'use strict';

/* THE HOST, CAPTURED ONCE. Everything below goes through W and DOC rather than the
   globals: this file is small enough to be re-evaluated in a test harness that swaps the
   host between runs, and a copy that read `window` again later would answer for the
   other one (tests/crazy_test.js runs it in two). */
var W = window, DOC = W.document;

/* ---------- 1. THE DOMAIN TEST ---------- */
function isCrazyGames() {
  var hostname = (W.location && W.location.hostname) || '';
  return hostname === 'crazygames.com' || hostname.endsWith('.crazygames.com');
}
function forced() {
  var s = (W.location && W.location.search) || '';
  return /[?&]crazysdk=(1|true)/.test(s);
}

/* ---------- 2. STATE ----------
   ON    : the platform (or `?crazysdk=1`) is in charge of the page's chrome
   READY : init() has resolved - calls now reach the SDK
   QUEUE : calls made before then, replayed IN ORDER (loadingStart must stay first),
           bounded so a blocked SDK cannot grow it for a whole session
   LOG   : the NAMES of the calls that really reached the SDK, for tests and for a
           support conversation
   EVENTS: the same, with a status and a time - read by events(), and the console's twin */
var ON = isCrazyGames() || forced();
var READY = false, INITING = false, MUTED = false, PLAYING = false;
var QUEUE = [], QUEUE_MAX = 40, LOG = [], LOG_MAX = 120;
var EVENTS = [], EVENTS_MAX = 40;
var FAILED = false, LAST_PCT = -1;
/* THE INIT LIFECYCLE, which the title screen waits on: 'off' (not the platform),
   'idle' (the platform, boot() not called yet), 'pending' (init() in flight),
   'ready', 'failed'. The GAME reads this to decide whether to show its buttons:
   while it is pending the player sees a loader instead of a Play button, and a
   failure puts the buttons back and turns the platform mode OFF. */
var INIT = ON ? 'idle' : 'off';
var SETTLED_FNS = [];
/* How long init() may take before the game gives up on the platform and plays
   normally. NOT the old bug: that timer DISABLED the module for the whole session and
   was never cancelled. This one is cancelled when init settles AND checks the state
   when it fires, so a slow-but-successful init can never be killed by it. */
var INIT_TIMEOUT_MS = 9000, INIT_TIMER = null;

function sdk() {
  var c = W.CrazyGames;
  return (c && c.SDK) || null;
}
/* `SDK.game` is a GETTER, and on a disabled SDK reading it - or any method on it - throws
   "CrazySDK is disabled on this domain". Both are read behind a guard, so an SDK that
   cannot be asked answers null and the caller drops the call, instead of turning a
   platform problem into an exception on someone's map. */
function game() {
  var s = sdk();
  if (!s) return null;
  try { return s.game || null; } catch (e) { return null; }
}
function environment() {
  var s = sdk();
  if (!s) return 'none';
  try { return s.environment || 'none'; } catch (e) { return 'none'; }
}
/* IS THE SDK ACTUALLY SERVING THIS DOMAIN? 'disabled' means no - every method throws and
   init() still resolves. Checked before init and again after it. */
function sdkDisabled() { return environment() === 'disabled'; }

/* ---------- 3. THE LOG (THE CONSOLE'S, NOT THE PAGE'S) ----------
   Two readers, one list: EVENTS (kept for events(), so a test can read what happened) and
   the console, with a `[crazy]` prefix - which is where their preview tool's QA
   conversation happens. NOTHING is drawn on the page: instrumentation over the map is
   noise for a player, and a tester has the console open anyway. */
function note(kind, name, detail) {
  var e = { t: Date.now(), kind: kind, name: name || '', detail: detail || '' };
  EVENTS.push(e);
  if (EVENTS.length > EVENTS_MAX) EVENTS.shift();
  if (kind === 'error') FAILED = true;
  try {
    if (W.console && W.console.log) {
      W.console.log('[crazy] ' + kind + (name ? ' ' + name : '') + (detail ? ' - ' + detail : ''));
    }
  } catch (err) {}
}

/* ---------- 4. THE ONE DOOR ----------
   Nothing else in the game touches window.CrazyGames: this is what makes "the SDK
   threw" a non-event rather than a broken round on a platform we cannot reproduce
   locally. `sent` means the SDK's own method was CALLED (the SDK throttles some of
   them at 1 Hz and logs the drop itself, which we cannot see from here). */
function call(name, args) {
  if (!ON) { note('skip', name, 'not on the platform'); return false; }
  if (!READY) {
    if (QUEUE.length < QUEUE_MAX) QUEUE.push([name, args || []]);
    note('queued', name, 'waiting for init()');
    boot();                       /* a late SDK arriving is still worth trying */
    return false;
  }
  var g = game();
  if (!g || typeof g[name] !== 'function') {
    note('error', name, 'the SDK has no ' + name + '() - environment ' + environment());
    return false;
  }
  try { g[name].apply(g, args || []); }
  catch (e) {
    note('error', name, (e && (e.message || e.code)) || String(e));
    return false;
  }
  LOG.push(name);
  if (LOG.length > LOG_MAX) LOG.shift();
  note('sent', name);
  return true;
}
/* stops the moment the platform is given up: replaying the rest into a dead SDK would
   only produce a wall of errors in a console somebody is trying to read */
function flush() {
  var q = QUEUE;
  QUEUE = [];
  for (var i = 0; i < q.length && ON; i++) call(q[i][0], q[i][1]);
}

/* ---------- 5. THE PLATFORM'S SETTINGS ----------
   `muteAudio` is the PLAYER's mute on CrazyGames' own player, and it WINS over our
   drawer: a game that lets its own switch turn the sound back on has ignored the
   request. Juice keeps the player's choice untouched and applies this as a master
   mute on top of it (see Juice.setMuted). */
function settings() {
  var g = game();
  if (!g) return null;
  try { return g.settings || null; } catch (e) { return null; }
}
function applyMute(s) {
  var st = (s && typeof s === 'object') ? s : settings();
  var m = !!(st && st.muteAudio);
  if (m === MUTED) return;
  MUTED = m;
  note('mute', 'muteAudio', m ? 'on' : 'off');
  var J = W.Juice;
  if (J && J.setMuted) { try { J.setMuted(MUTED); } catch (e) {} }
}

/* ---------- 6. THE PLAYER'S LANGUAGE ----------
   `fr-FR` is not one of the 18 codes, the base language is; and an unsupported
   language falls back to English IN THE APP (setLang validates), never here - a
   half-translated map is worse than an English one. */
function locale() {
  if (!ON) return null;             /* off the platform nothing here is even read */
  var s = sdk();
  var info = null;
  try { info = s && s.user && s.user.systemInfo; } catch (e) { info = null; }
  var loc = info && info.locale;
  if (!loc) return null;
  var code = String(loc).split(/[-_]/)[0].toLowerCase();
  return code || null;
}
/* The late path: init() landed after the map had already defaulted to English. The map
   must have its place names first (the city-name files are keyed by place index), and
   a player who ever chose a language for themselves is left alone - setLang stores its
   choice, which is exactly the flag read here. The early path is the same test used as
   a fallback by app.js storedLang(), so whichever wins, the player gets one language. */
function applyLocale() {
  var code = locale();
  if (!code) return;
  var stored = null;
  try { stored = W.localStorage.getItem('kwizzy.lang'); } catch (e) { stored = null; }
  if (stored) return;
  var M = W.MapApp, V = W.ViewState;
  if (!M || !M.placesReady || !M.placesReady()) return;
  if (V && V.setLang) { try { V.setLang(code); } catch (e2) {} }
}

/* ---------- 6b. SETTLING, AND GIVING UP ----------
   The title screen subscribes here so it can swap its loader for its buttons (or the
   reverse) without polling. A listener is called ONCE, and a screen that renders later
   reads initState() instead, so nothing has to be remembered. */
function settled() {
  var fns = SETTLED_FNS;
  SETTLED_FNS = [];
  for (var i = 0; i < fns.length; i++) { try { fns[i](INIT); } catch (e) {} }
}

/* PLATFORM MODE OFF, cleanly: the game plays exactly as it does on GitHub Pages.
   Three things are rolled back - the mode flag, the `cg` body class (which is what the
   stylesheets hang the platform's layout on: the Back disc in the corner, the closed gap
   in the quiz rows) and the fullscreen disc app.js hid when it saw the platform. The
   class goes FIRST so the layout is back before the button reappears in it. */
function unplatform(why) {
  if (!ON) return;
  ON = false;
  PLAYING = false;
  QUEUE = [];
  try { DOC.body.classList.remove('cg'); } catch (e) {}
  try {
    var M = W.MapApp;
    if (M && M.recheckFullscreen) M.recheckFullscreen();   /* wireFs() again, once */
  } catch (e2) {}
  note('error', 'platform', why || 'giving up - the game plays normally');
}

/* ---------- 7. INIT ----------
   The tag in index.html is `defer`, so window.CrazyGames exists by the time
   DOMContentLoaded fires; boot() is retried on `load` and again by any call that
   arrives before READY. NOTHING HERE EVER DISABLES THE MODULE - that is the bug this
   file used to have (see the header). */
/* the timer's own callback: GIVE UP ONLY IF STILL PENDING. Checking the state at fire
   time is the whole safety of this timeout - a clearTimeout that failed (an old browser,
   a stub) would otherwise put the game back to "not the platform" nine seconds in. */
function initTimedOut() {
  INIT_TIMER = null;
  if (INIT !== 'pending') return;
  INIT = 'failed';
  note('error', 'init', 'no answer after ' + Math.round(INIT_TIMEOUT_MS / 1000) + ' s');
  unplatform('the SDK never answered init()');
  settled();
}
function armInitTimer() {
  if (INIT_TIMER !== null || !W.setTimeout) return;
  INIT_TIMER = W.setTimeout(initTimedOut, INIT_TIMEOUT_MS);
}
function clearInitTimer() {
  if (INIT_TIMER !== null && W.clearTimeout) { try { W.clearTimeout(INIT_TIMER); } catch (e) {} }
  INIT_TIMER = null;
}

function boot() {
  if (!ON || READY || INITING) return;
  var s = sdk();
  /* THE DOMAIN THE SDK DOES NOT SERVE. `environment` is readable before init and says
     'disabled' there; init() would resolve anyway and every call would throw, so the
     platform mode is dropped NOW: the title renders the ordinary column, the loader never
     appears, and the game plays exactly as it does on GitHub Pages. One console line
     says why (it is the first question a tester asks). */
  if (s && sdkDisabled()) {
    note('off', 'platform', 'the SDK is disabled on ' + ((W.location && W.location.hostname) || 'this domain') +
         ' - playing as a normal web game');
    INIT = 'failed';
    unplatform('environment is disabled');
    settled();
    return;
  }
  if (!s || typeof s.init !== 'function') {
    /* the tag is still downloading (or the CDN was blocked). Stay 'pending' - the title
       keeps its loader - and let the `load` listener ask again. A `crazysdk=1` page with
       no SDK at all would sit here, so the timer is armed on this path too. */
    if (INIT === 'idle') { INIT = 'pending'; armInitTimer(); settled(); }
    return;
  }
  INITING = true;
  INIT = 'pending';
  armInitTimer();
  settled();
  note('init', '', 'calling init() - environment ' + environment());
  var p;
  try { p = s.init(); }
  catch (e) {
    INITING = false;
    INIT = 'failed';
    clearInitTimer();
    note('error', 'init', (e && e.message) || String(e));
    unplatform('init() threw');
    settled();
    return;
  }
  Promise.resolve(p).then(function () {
    if (READY) return;
    INITING = false;
    clearInitTimer();          /* settled, whatever it says: the deadline is over */
    /* RESOLVING IS NOT SUCCEEDING. On a domain the SDK does not serve, init() resolves
       and THEN refuses every method: read `environment` before believing it. (This is
       exactly what happened in testing, and the queue would have gone out into a dead
       SDK, printing an error per call.) */
    if (sdkDisabled()) {
      note('off', 'platform', 'init() resolved but the environment is disabled - playing as a normal web game');
      INIT = 'failed';
      unplatform('environment is disabled after init');
      settled();
      return;
    }
    READY = true;
    INIT = 'ready';
    note('init', '', 'resolved - environment ' + environment());
    applyMute();
    var g = game();
    if (g && typeof g.addSettingsChangeListener === 'function') {
      try { g.addSettingsChangeListener(applyMute); } catch (e) {}
    }
    flush();
    applyLocale();
    settled();
  })['catch'](function (e) {
    INITING = false;
    INIT = 'failed';
    clearInitTimer();
    var why = (e && (e.message || e.code)) || String(e);
    note('off', 'platform', 'init() refused: ' + why + ' - playing as a normal web game');
    unplatform('init() was rejected');
    settled();
  });
}

/* ---------- 8. THE PUBLIC SHAPE ---------- */
W.Crazy = {
  /* the two questions the rest of the code asks */
  isCrazyGames: isCrazyGames,
  on: function () { return ON; },
  ready: function () { return READY; },
  /* 'off' | 'idle' | 'pending' | 'ready' | 'failed' - what the title screen waits on */
  initState: function () { return INIT; },
  /* called once when init settles (or when the game gives up on the platform) */
  onSettled: function (fn) { if (typeof fn === 'function') SETTLED_FNS.push(fn); },
  muted: function () { return MUTED; },
  locale: locale,
  environment: environment,

  loadingStart: function () { call('loadingStart'); },
  loadingStop: function () { call('loadingStop'); },
  /* gameplayStart is IDEMPOTENT HERE, not at the call sites: quiz.js says what the
     screen is on every render, and a round re-renders on every answer. */
  gameplayStart: function () { if (PLAYING) return; PLAYING = true; call('gameplayStart'); },
  gameplayStop: function () { if (!PLAYING) return; PLAYING = false; call('gameplayStop'); },
  happytime: function () { call('happytime'); },

  /* GAME COMPLETION. Their definition is ours to make for a game with no levels, and
     the meaningful milestone here is PLAYING ALL FOUR MODES - a player who has found a
     country, a capital, a flag and a city on the map has seen the whole game. So the
     percentage is the share of the four the record says this player has played, and
     quiz.js reports it after every round and once at boot. A repeated value is not
     sent again (the SDK would be asked to record the same progress on every render). */
  progress: function (pct) {
    var v = Math.round(Number(pct));
    if (!isFinite(v)) return false;
    v = Math.max(0, Math.min(100, v));
    if (v === LAST_PCT) return false;
    LAST_PCT = v;
    return call('reportGameCompletedPercentage', [v]);
  },
  progressSent: function () { return LAST_PCT; },

  /* read-only, for tests and for support */
  log: function () { return LOG.slice(); },
  events: function () { return EVENTS.slice(); },
  queued: function () { return QUEUE.length; },
  failed: function () { return FAILED; },
  boot: boot
};

/* ---------- 10. START ----------
   The body class is what the stylesheets hang the left-hand column on, so it is set
   here, before the map's first frame: `body.cg` moves the Back disc into the corner the
   fullscreen disc would have used (style.css) and closes the gap it leaves in the quiz's
   own top rows (quiz.css). */
if (ON) {
  /* THE SDK TAG IS `defer`, so at this moment (a classic script, earlier in the document)
     window.CrazyGames usually does not exist yet and nothing can be asked of it. The
     domain it DOES answer for is checked here when it happens to be available, and again
     in boot() - which is the check that matters, because a disabled SDK resolves init()
     and then refuses every method. */
  if (sdk() && sdkDisabled()) {
    note('off', 'platform', 'the SDK is disabled on ' +
         ((W.location && W.location.hostname) || 'this domain') + ' - playing as a normal web game');
    INIT = 'failed';
    unplatform('environment is disabled');
  } else {
    try { DOC.body.classList.add('cg'); } catch (e) {}
    W.Crazy.loadingStart();
    if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', boot);
    else boot();
    W.addEventListener('load', boot);
    /* THE LOADER IS WHAT THE PLAYER SEES until init settles: say so at once, so the title
       never offers a Play button it may have to take back */
    if (INIT === 'idle' && !READY) { INIT = 'pending'; armInitTimer(); }
  }
  note('boot', INIT === 'failed' ? 'gave up - environment ' + environment()
                                : 'platform mode - environment ' + environment());
  settled();
}
})();

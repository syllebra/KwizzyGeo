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
     muteAudio        game.settings / addSettingsChangeListener -> Juice.setMuted;
     locale           user.systemInfo.locale -> the game's own 18 languages.

   THE RULE THIS FILE KEEPS: the platform is a PLUS, never a dependency. Every call
   goes through one guarded path, is queued until init() has resolved, and is dropped
   without a throw when the SDK is absent, blocked by an adblocker or running on
   GitHub Pages. A player on a domain that is neither gets exactly the game that was
   there before this file existed.

   `isCrazyGames()` is the test the whole thing hangs on: the hostname CrazyGames serves
   the game from (their own game frame lives on games.crazygames.com, and the apps
   serve the same origins - see their sitelock page). `?crazysdk=1` turns the same mode
   on anywhere else, which is how the integration is tested on localhost: the SDK then
   reports the `local` environment and logs what it would have done. */
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
   QUEUE : calls made before then, replayed IN ORDER (loadingStart must stay first)
   LOG   : the last calls that really reached the SDK, for tests and for a support
           conversation; capped so a long session cannot grow it */
var ON = isCrazyGames() || forced();
var READY = false, DEAD = false, MUTED = false, PLAYING = false;
var QUEUE = [], LOG = [], LOG_MAX = 120;

function sdk() {
  var c = W.CrazyGames;
  return (c && c.SDK) || null;
}
function game() {
  var s = sdk();
  return (s && s.game) || null;
}
/* THE ONE DOOR. Nothing else in the game touches window.CrazyGames: this is what makes
   "the SDK threw" a non-event rather than a broken round on a platform we cannot
   reproduce locally. */
function call(name, args) {
  if (!ON || DEAD) return;
  if (!READY) { QUEUE.push([name, args || []]); return; }
  var g = game();
  if (!g || typeof g[name] !== 'function') return;
  try { g[name].apply(g, args || []); } catch (e) { return; }
  LOG.push(name);
  if (LOG.length > LOG_MAX) LOG.shift();
}
function flush() {
  var q = QUEUE;
  QUEUE = [];
  for (var i = 0; i < q.length; i++) call(q[i][0], q[i][1]);
}

/* ---------- 3. THE PLATFORM'S SETTINGS ----------
   `muteAudio` is the PLAYER's mute on CrazyGames' own player, and it WINS over our
   drawer: a game that lets its own switch turn the sound back on has ignored the
   request. Juice keeps the player's choice untouched and applies this as a master
   mute on top of it (see Juice.setMuted). */
function settings() {
  var g = game();
  return (g && g.settings) || null;
}
function applyMute(s) {
  var st = (s && typeof s === 'object') ? s : settings();
  var m = !!(st && st.muteAudio);
  if (m === MUTED) return;
  MUTED = m;
  var J = W.Juice;
  if (J && J.setMuted) { try { J.setMuted(MUTED); } catch (e) {} }
}

/* ---------- 4. THE PLAYER'S LANGUAGE ----------
   `fr-FR` is not one of the 18 codes, the base language is; and an unsupported
   language falls back to English IN THE APP (setLang validates), never here - a
   half-translated map is worse than an English one. */
function locale() {
  if (!ON) return null;             /* off the platform nothing here is even read */
  var s = sdk();
  var info = s && s.user && s.user.systemInfo;
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

/* ---------- 5. INIT ----------
   The tag in index.html is `defer`, so window.CrazyGames exists by the time
   DOMContentLoaded fires; boot() is retried on `load` and given up on after 10 s so a
   blocked or absent SDK cannot leave a queue filling up for the whole session. */
function boot() {
  if (!ON || READY || DEAD) return;
  var s = sdk();
  if (!s || typeof s.init !== 'function') return;
  var p;
  try { p = s.init(); } catch (e) { return; }
  Promise.resolve(p).then(function () {
    if (READY) return;
    READY = true;
    applyMute();
    var g = game();
    if (g && typeof g.addSettingsChangeListener === 'function') {
      try { g.addSettingsChangeListener(applyMute); } catch (e) {}
    }
    flush();
    applyLocale();
  })['catch'](function () { /* no throw escapes into the game */ });
}

/* ---------- 6. THE PUBLIC SHAPE ---------- */
W.Crazy = {
  /* the two questions the rest of the code asks */
  isCrazyGames: isCrazyGames,
  on: function () { return ON; },
  ready: function () { return READY; },
  muted: function () { return MUTED; },
  locale: locale,

  loadingStart: function () { call('loadingStart'); },
  loadingStop: function () { call('loadingStop'); },
  /* gameplayStart is IDEMPOTENT HERE, not at the call sites: quiz.js says what the
     screen is on every render, and a round re-renders on every answer. */
  gameplayStart: function () { if (PLAYING) return; PLAYING = true; call('gameplayStart'); },
  gameplayStop: function () { if (!PLAYING) return; PLAYING = false; call('gameplayStop'); },
  happytime: function () { call('happytime'); },

  /* read-only, for tests and for support */
  log: function () { return LOG.slice(); },
  queued: function () { return QUEUE.length; },
  boot: boot
};

/* ---------- 7. START ----------
   The body class is what the stylesheets hang the left-hand column on, so it is set
   here, before the map's first frame: `body.cg` moves the Back disc into the corner the
   fullscreen one would have had (style.css) and closes the gap it leaves in the quiz's
   own top rows (quiz.css). */
if (ON) {
  try { DOC.body.classList.add('cg'); } catch (e) {}
  W.Crazy.loadingStart();
  if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', boot);
  else boot();
  W.addEventListener('load', boot);
  var wd = setTimeout(function () { DEAD = true; QUEUE = []; }, 10000);
  if (wd && wd.unref) wd.unref();               /* node: do not hold the process open */
}
})();

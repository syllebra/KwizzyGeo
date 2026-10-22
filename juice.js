/* KwizzyGeo — the juice: sound effects, haptics, particles and music.
   Ported from the Kwizzy app (github.com/syllebra/Kwizzy), whose `app.js` grew all of
   this against a real player: the clips, the haptic retry, the burst, the music engine
   and the settings key are that app's, adapted to this one. Set BELOW (rather than
   below as you read) so it can be seen at a glance:

     sfx(name)      one short .wav per UI event: tap, select, screen, start,
                    correct, wrong  (media/sfx/, 547 kB, ours - synthesised by
                    Kwizzy's scripts/kwizzy-sfx.py, no samples, no licence)
     haptic(ms|[])  Vibration API, with Kwizzy's one-task-later retry (Chrome
                    refuses a pulse until a user gesture is committed to the frame)
     burst(x,y,n)   the particle burst: one <i class="spark"> per particle, flying
                    out on a CSS animation and removing itself when it lands
     Music          Web Audio: one decoded buffer per track, one source per play,
                    a crossfade on the master... no: per-play gains under the master,
                    because two overlapping tracks must not double the level
     settings       localStorage kwizzy.settings.v1 — {sfx, music, haptics, vol, trk}

   THE RULES THIS FILE KEEPS (Kwizzy's ADR 0004, "juice is additive"):
     * nothing here carries meaning alone. A right answer says "Correct" in green AND
       plays the rising clip AND bursts; a wrong one says "Wrong" in red AND shakes
       AND falls. A player with `prefers-reduced-motion` gets every word and the colour.
     * reduceMotion kills movement (animations, particles, haptics) but never audio:
       it is a setting about flashing and moving images, not about sound.
     * particles are created per interaction and remove themselves: nothing
       accumulates in the DOM. */
(function () {
'use strict';

var LS_SETTINGS = 'kwizzygeo.settings.v1';
var PLAYLIST = window.KwizzyPlaylist || null;

/* prefers-reduced-motion, read once. A media query listener keeps it live, which the
   CSS cannot do for the JS half (bursts, haptics). */
var reduceMotion = false;
try { reduceMotion = window.matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) {}
try {
  var mq = window.matchMedia('(prefers-reduced-motion:reduce)');
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function (e) { reduceMotion = !!e.matches; });
  }
} catch (e2) {}

/* ---------- settings ----------
   Every field is read with a FORGIVING default (`!== false`, an unknown track falls
   back to "all", a vol that is not a number in [0,1] is the default), so a partial,
   corrupt or stale blob loads as a working configuration instead of none. */
var settings = { sfx: true, music: true, haptics: true, vol: 1, trk: 'all' };

function loadSettings() {
  var o = null;
  try { o = JSON.parse(window.localStorage.getItem(LS_SETTINGS) || 'null'); } catch (e) { o = null; }
  if (!o || typeof o !== 'object') return;
  settings.sfx = o.sfx !== false;
  settings.music = o.music !== false;
  settings.haptics = o.haptics !== false;
  var v = typeof o.vol === 'number' ? o.vol : parseFloat(o.vol);
  settings.vol = (isFinite(v) && v >= 0 && v <= 1) ? v : 1;
  if (PLAYLIST && PLAYLIST.validTrack(o.trk)) settings.trk = o.trk;
}
function saveSettings() {
  try { window.localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (e) {}
}
loadSettings();

/* ---------- sound effects ----------
   One Audio object per name, built on first use: nothing is fetched before it is
   needed, and the files are tiny and same-origin, so a play() costs one small request.
   NOT gated by reduceMotion - that setting is about moving pixels, not about audio.

   LEVEL. One clip had to be normalised: Kwizzy's wrong.wav peaks at 0.035 of full scale
   against 0.94 for correct.wav (measured with the test below), i.e. the rasp of a wrong
   answer was very nearly inaudible - and it is the one sound a quiz cannot lose. The
   ASSET carries the fix (x6, same waveform, peak now 0.21, no clipping), not this code:
   an <audio> element's volume cannot go above 1, so a runtime gain would have to route
   everything through Web Audio, and the effects must not depend on an audio context
   being unlocked. tests/juice_test.js asserts every clip's peak lands in 0.10-0.99, so a
   fresh copy of the quiet original fails the suite instead of going silent. */
var sfxCache = {}, sfxFailed = {};

function clip(name) {
  var a = sfxCache[name];
  if (a) return a;
  try {
    a = new Audio('media/sfx/' + name + '.wav');
    a.preload = 'auto';
    a.volume = 1;
    sfxCache[name] = a;
  } catch (e) {
    sfxFailed[name] = true;
    return null;
  }
  return a;
}

/* One clip, from the top. `a.currentTime = 0` is what makes a rapid double tap sound
   like two taps instead of one restarted one (the same clip is reused). */
/* The last attempt, for a page that has no console: {name, ok, error}. */
var lastAttempt = null;

function sfx(name) {
  if (!settings.sfx) return;          // Sound effects OFF in the drawer: stay silent
  /* NOT gated by reduceMotion: that setting is about moving pixels, not about audio */
  if (sfxFailed[name]) return;
  var a = clip(name);
  if (!a) return;
  try {
    a.currentTime = 0;               // replay from the top: two taps, not one restarted
    var p = a.play();
    lastAttempt = { name: name, ok: true, error: '' };
    if (p && p.catch) p.catch(function (e) {
      /* NOT every rejection is permanent. NotAllowedError is the autoplay policy: the
         page has not been touched yet (or the gesture was not committed), and the very
         same clip will play on the next tap. Marking that as a failed clip - which this
         did at first - silences the whole game forever after one early refusal. Only a
         real failure (no decoder, a broken file, no output device) is permanent. */
      var n = (e && e.name) || '';
      lastAttempt = { name: name, ok: false, error: n + (e && e.message ? ': ' + e.message : '') };
      if (n !== 'NotAllowedError') sfxFailed[name] = true;
    });
  } catch (e) {
    lastAttempt = { name: name, ok: false, error: String(e && e.message || e) };
    sfxFailed[name] = true;
  }
}

/* ---------- haptics ----------
   Vibration API: Android Chrome/Samsung pulse the phone; iOS Safari and Firefox do
   not implement it (navigator.vibrate absent, or returns false). Where it is absent,
   the visual side stays the whole feedback. Kwizzy's trap, kept: Chrome refuses the
   pulse until a user gesture is COMMITTED to the frame (chromestatus 5644273861001216),
   so vibrate() answering false means "ask again on a later task", not "no vibration
   here" - the retry is what makes the first tap of a session buzz at all. Also: call it
   as a method of navigator, never through a copied local (`var v = navigator.vibrate;
   v(20)` throws "Illegal invocation"). */
function haptic(pattern) {
  if (reduceMotion) return;
  if (!settings.haptics) return;
  if (!navigator.vibrate) return;
  /* vibrate() answers FALSE when the browser refuses: Chrome needs a user gesture
     committed to the frame, and its very first touchdown often does not count - so the
     first buttons of a session would never buzz. Retry on later tasks, three times, then
     accept that this device will not pulse (Silent mode, no motor, iOS). */
  var tries = 0;
  (function attempt() {
    var r = null;
    try { r = navigator['vibrate'](pattern); } catch (e) { return; }
    if (r !== false) return;                     /* fired (or no return value): stop */
    if (tries >= 3) return;
    var wait = [40, 90, 160][tries];
    tries++;
    setTimeout(attempt, wait);
  })();
}

/* ---------- particles ----------
   Kwizzy's colours, swapped for this app's: the accent blue, the green of a right
   answer, the red of a wrong one, and the gold of the viewer's picked city - so a
   burst looks like it belongs on THIS map. */
var burstEl = null;
var BURST_COLORS = ['#8ed0ff', '#46d18e', '#ff8f8f', '#ffd166', '#c9e6ff', '#7fe0b0'];

function burst(x, y, n) {
  if (reduceMotion) return;
  if (!burstEl) burstEl = document.getElementById('burst');
  if (!burstEl) return;
  n = n || 16;
  for (var i = 0; i < n; i++) {
    var s = document.createElement('i');
    s.className = 'spark';
    var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    var dist = 42 + Math.random() * 78;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.background = BURST_COLORS[i % BURST_COLORS.length];
    s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    s.style.setProperty('--rot', (Math.random() * 520 - 260).toFixed(0) + 'deg');
    s.style.setProperty('--dur', (620 + Math.random() * 380).toFixed(0) + 'ms');
    s.style.width = s.style.height = (5 + Math.random() * 7).toFixed(1) + 'px';
    burstEl.appendChild(s);
    (function (el) {
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1100);
    })(s);
  }
}
function burstAt(node, n) {
  if (!node || !node.getBoundingClientRect) return;
  var r = node.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, n);
}

/* Re-run a one-shot CSS animation: remove, force a reflow, add. Without the reflow the
   class is already there and the browser does not restart the animation (a second wrong
   answer in a row would sit still). */
function thump(el, cls) {
  if (!el || reduceMotion || !el.classList) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(function () { if (el.classList) el.classList.remove(cls); }, 620);
}

/* ---------- MUSIC ----------
   The five ambient tracks are Kwizzy's own (media/music/*.mp3, 25 s loops, 3 MB). The
   RULES live in media/music/playlist.js - a pure module, loaded before this file and
   also require()d by tests/playlist_test.js - so what a player hears is what the test
   checks:
     * "All" (the default) walks the set in a random order, each track repeating
       REPEATS (3) times, the next one fading in over the tail of the previous one;
       the order always opens on light_ambient, the track the app loads at startup;
     * picking one track loops that one and never moves on.

   Playback is Web Audio, not <audio>.play(): the volume must be ramped (fade in, fade
   out, crossfade) and only a GainNode can do that. Each track is fetched and decoded
   ONCE and kept, so a repeat or a track change costs no request.

   Two traps this engine exists for, both from Kwizzy where they were measured:
     1. a source with src.loop = true fires `ended` ZERO times, so the playlist's
        "third play, then the next track" could never be reached AND the old track kept
        running under the new one. Hence: one source per play, loop = false.
     2. Chrome hands the AudioContext out FROZEN (currentTime stays 0) until the page
        has been interacted with. "A track is loaded" and "the browser has let it play"
        are two different facts, and the panel must state the second one. */
var MUSIC_FADE_MS = 1200;      // fade in / out / crossfade
var MUSIC_VOL = 0.55;          // the music sits under the effects
var Music = {
  ctx: null, master: null,
  buf: {}, fetching: {},
  player: null, state: null,
  started: false, muted: false, overFade: false,
  pendingId: null, wantId: null, loadFailed: false, lastEnd: 0
};

function musNow() {
  try { return Music.ctx ? Music.ctx.currentTime : 0; } catch (e) { return 0; }
}
function musCtx() {
  if (Music.ctx) return Music.ctx;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    Music.ctx = AC ? new AC() : null;
    if (Music.ctx) {
      Music.master = Music.ctx.createGain();
      Music.master.gain.value = 0;
      Music.master.connect(Music.ctx.destination);
    }
  } catch (e) { Music.ctx = null; }
  return Music.ctx;
}
function musRunning() { return !!Music.ctx && musNow() > 0.02; }

function musVol() {
  var v = settings.vol;
  if (!isFinite(v) || v < 0) v = 0;
  if (v > 1) v = 1;
  return MUSIC_VOL * v;
}
/* the one place the level is ramped: fade in, fade out and crossfade are the same call */
function musGain(target, ms) {
  var g = Music.master, ctx = Music.ctx;
  if (!g || !ctx) return;
  var now = ctx.currentTime, ms2 = ms || 0;
  try { g.gain.cancelScheduledValues(now); } catch (e) {}
  if (ms2 <= 0) { try { g.gain.setValueAtTime(target, now); } catch (e1) { g.gain.value = target; } return; }
  try { g.gain.setValueAtTime(g.gain.value, now); } catch (e2) {}
  try { g.gain.linearRampToValueAtTime(target, now + ms2 / 1000); } catch (e3) { g.gain.value = target; }
}

function musFetch(id) {
  var ctx = musCtx();
  if (!ctx || !PLAYLIST) return Promise.reject(new Error('no audio'));
  if (Music.buf[id]) return Promise.resolve(Music.buf[id]);
  if (Music.fetching[id]) return Music.fetching[id];
  var tr = PLAYLIST.trackAt(PLAYLIST.indexOf(id));
  if (!tr) return Promise.reject(new Error('unknown track ' + id));
  var p = fetch('media/music/' + tr.file, { cache: 'force-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then(function (bytes) {
      return new Promise(function (res, rej) { ctx.decodeAudioData(bytes, res, rej); });
    })
    .then(function (buf) { Music.buf[id] = buf; return buf; })
    ['catch'](function (e) { delete Music.fetching[id]; throw e; });
  Music.fetching[id] = p;
  return p;
}

function musNewPlayer(id, buf) {
  var ctx = Music.ctx;
  var src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = false;                      // see trap 1 above
  var gain = ctx.createGain();
  gain.gain.value = 1;
  src.connect(gain);
  gain.connect(Music.master);
  src.onended = musEnded;
  return { id: id, src: src, gain: gain };
}
function musDropPlayer(p) {
  if (!p) return;
  try { p.src.onended = null; } catch (e) {}
  try { p.gain.disconnect(); } catch (e2) {}
  try { p.src.disconnect(); } catch (e3) {}
  try { p.src.stop(); } catch (e4) {}
}

/* One play finished: the rules decide, not the clock. */
function musEnded() {
  var now = Date.now();
  if (now - Music.lastEnd < 400) return;        // one transition per end, never two
  Music.lastEnd = now;
  if (!Music.started || Music.overFade || !settings.music) return;
  var id = Music.wantId || (Music.player ? Music.player.id : null);
  if (!id) return;
  if (PLAYLIST.cycle(Music.state) === 'next') {
    var pick = PLAYLIST.pick(Music.state);
    var next = PLAYLIST.trackAt(pick.index);
    if (next) musPlay(next.id, MUSIC_FADE_MS, true);
  } else {
    musPlay(id, 0, false);                      // a repeat: same track, at once, at volume
  }
}
/* Warm the NEXT track while this one plays: a 600 kB fetch costs seconds, and 25 s of
   music is what hides it - but only if it is asked for before the tail. */
function musWarm() {
  if (!Music.state || !settings.music || !PLAYLIST) return;
  var id = PLAYLIST.nextId(Music.state);
  if (id && !Music.buf[id] && Music.wantId !== id) musFetch(id)['catch'](function () {});
}

/* Start one play. fadeMs > 0 fades it up from silence; cross = another track is still
   sounding, so each play uses its own gain: the outgoing falls to 0 while the new one
   climbs to 1 over the same time. Their total never doubles, which is exactly what a
   master dip could NOT do (it silences both at once and leaves the old one loud). */
function musPlay(id, fadeMs, cross) {
  if (!musCtx()) return;
  if (Music.pendingId === id && !Music.player) return;
  Music.wantId = id;
  Music.started = true;
  Music.pendingId = id;
  var old = Music.player;
  Music.player = null;
  musFetch(id).then(function (buf) {
    if (!Music.started || Music.wantId !== id) return;
    var ctx = Music.ctx;
    Music.pendingId = null;
    var p = musNewPlayer(id, buf);
    try { ctx.resume(); } catch (e) {}
    var t = musNow();
    if (cross && old) {
      Music.overFade = true;
      try { old.gain.gain.setValueAtTime(old.gain.gain.value, t); } catch (e0) {}
      try { old.gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_MS / 1000); } catch (e1) {}
      try { p.gain.gain.setValueAtTime(0, t); } catch (e2) {}
      try { p.gain.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_MS / 1000); } catch (e3) {}
      try { p.src.start(t); } catch (e4) {}
      (function (dead) {
        setTimeout(function () { musDropPlayer(dead); Music.overFade = false; }, MUSIC_FADE_MS + 200);
      })(old);
    } else {
      musDropPlayer(old);
      Music.overFade = false;
      try { p.src.start(t); } catch (e5) {}
      musGain(musVol(), fadeMs);
    }
    Music.player = p;
    Music.muted = false;
    Music.loadFailed = false;
    musWarm();
    notify();
  })['catch'](function () {
    Music.pendingId = null;
    Music.overFade = false;
    Music.wantId = null;
    Music.started = !!Music.player;
    Music.loadFailed = true;
    notify();
  });
}

/* the drawer re-reads the engine whenever it changes; the panel installs the hook */
function notify() { if (Juice.onState) Juice.onState(); }

function musicStop() {
  Music.started = false;
  Music.wantId = null;
  if (Music.ctx) musGain(0, MUSIC_FADE_MS);
  var p = Music.player;
  Music.player = null;
  Music.muted = true;
  if (p) setTimeout(function () { musDropPlayer(p); }, MUSIC_FADE_MS + 200);
  notify();
}

function musicStart() {
  if (!musCtx() || !Music.state) return;
  try { Music.ctx.resume(); } catch (e) {}
  Music.started = true;
  var tr = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index);
  if (!tr) return;
  /* already sounding on that very track: put the volume back instead of restarting, so
     music off/on keeps the track where it left off - but only when the clock is really
     moving (a frozen context's source was never heard and cannot be started twice) */
  if (Music.player && !Music.overFade && Music.player.id === tr.id && musRunning()) {
    Music.muted = false;
    musGain(musVol(), MUSIC_FADE_MS);
    notify();
    return;
  }
  musPlay(tr.id, MUSIC_FADE_MS, false);
}

function musicSelectTrack(id) {
  if (!PLAYLIST) return;
  if (!PLAYLIST.validTrack(id)) id = 'all';
  /* the CHOICE is a setting: it is saved whether or not there is an engine to obey it
     (no Web Audio, a browser that refused a context), so the drawer remembers it */
  settings.trk = id;
  saveSettings();
  if (Music.state) {
    PLAYLIST.select(Music.state, id);
    var want = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index);
    if (want && Music.player && !Music.muted && musRunning()) musPlay(want.id, MUSIC_FADE_MS, true);
    else if (want && settings.music) musicStart();
  }
  notify();
}

/* The autoplay policy: the first tap or key press is what unfreezes the context. A
   source already started at 0 inside a frozen context DOES play once it is resumed, so
   the unlock resumes rather than starting a second copy - and only if resume() is still
   refused (the clock never moved) is a fresh play started. */
function musicUnlock() {
  if (!settings.music || !Music.state) return;
  if (musRunning()) return;
  try { Music.ctx.resume(); } catch (e) {}
  setTimeout(function () {
    if (!settings.music) return;
    if (musRunning()) { notify(); return; }
    var tr = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index);
    if (tr) musPlay(tr.id, MUSIC_FADE_MS, false);
    else notify();
  }, 400);
}

function musicSupported() { return !!(window.AudioContext || window.webkitAudioContext); }

function musicBoot() {
  if (!PLAYLIST) return;
  Music.state = PLAYLIST.makeState(settings.trk);
  if (!musCtx()) return;                       // no Web Audio: the Music row greys out
  var first = PLAYLIST.trackAt(PLAYLIST.pick(Music.state).index);
  if (!first) return;
  /* decode the startup track NOW: that fetch is what the first tap would otherwise
     wait for, and the tap that unlocks the context can then start it straight away */
  musFetch(first.id).then(function () {
    if (settings.music) musicStart();
  })['catch'](function () {
    Music.loadFailed = true;
    notify();
  });
  window.addEventListener('pointerdown', musicUnlock, { passive: true });
  window.addEventListener('keydown', musicUnlock);
}

/* ---------- the switches ---------- */
function setSfx(on) {
  settings.sfx = !!on;
  saveSettings();
  if (settings.sfx) sfx('tap');         // the tick confirms the new state, so it is LAST
}
function setMusic(on) {
  settings.music = !!on;
  saveSettings();
  if (settings.music) musicStart();
  else musicStop();
}
function setHaptics(on) {
  settings.haptics = !!on;
  saveSettings();
  if (settings.haptics) haptic(30);
}
function setVol(v) {
  v = isFinite(v) ? v : 1;
  if (v < 0) v = 0;
  if (v > 1) v = 1;
  settings.vol = v;
  saveSettings();
  /* re-aim the master gain at once: the track ALREADY playing follows the thumb
     (160 ms ramp), nothing is started, stopped or restarted */
  if (settings.music && Music.started) musGain(musVol(), 160);
}

var Juice = {
  reduceMotion: function () { return reduceMotion; },
  sfx: sfx, haptic: haptic, burst: burst, burstAt: burstAt, thump: thump,
  settings: function () { return { sfx: settings.sfx, music: settings.music, haptics: settings.haptics, vol: settings.vol, trk: settings.trk }; },
  setSfx: setSfx, setMusic: setMusic, setHaptics: setHaptics, setVol: setVol,
  setTrack: musicSelectTrack,
  tracks: function () { return PLAYLIST ? PLAYLIST.TRACKS : []; },
  trackLabel: function (id) { return PLAYLIST ? PLAYLIST.label(id) : id; },
  music: function () {
    return {
      supported: musicSupported(), running: musRunning(), started: Music.started,
      muted: Music.muted, loadFailed: Music.loadFailed,
      playing: Music.player ? Music.player.id : null,
      buffered: Object.keys(Music.buf), state: Music.state
    };
  },
  hapticsSupported: function () { return typeof navigator !== 'undefined' && !!navigator.vibrate; },
  boot: musicBoot,
  /* a hook the panel can replace, so the drawer re-syncs whenever the engine changes */
  onState: null,
  lastAttempt: function () { return lastAttempt; },
  _cache: sfxCache, _failed: sfxFailed, _reset: function () {
    for (var k in sfxCache) if (sfxCache.hasOwnProperty(k)) delete sfxCache[k];
    for (var f in sfxFailed) if (sfxFailed.hasOwnProperty(f)) delete sfxFailed[f];
  }
};
window.Juice = Juice;
})();

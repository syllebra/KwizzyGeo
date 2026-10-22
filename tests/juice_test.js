/* node tests for juice.js and for the sound assets it plays.
   No browser: `Audio` is a recorder, `matchMedia` answers what the test needs, and
   `navigator.vibrate` counts its calls. What is asserted:

     * the six clips Kwizzy ships are HERE, are audible (peak 0.10-0.99) and are the
       ones the code asks for - the wrong.wav level trap, pinned;
     * the settings key: forgiving defaults, a corrupt blob, a bad vol, an unknown
       track, a localStorage that throws;
     * sfx: one <audio> per name, reused, replayed from 0, silent when Sound is off,
       and it survives a play() that is refused (the autoplay policy);
     * haptics: the retry while vibrate() says false, and the three-try give-up;
     * reduceMotion: kills the particles and the haptics, and does NOT kill the sound;
     * the burst: n sparks, positioned, self-removing;
     * the music rules still hold (tests/playlist_test.js) and `boot()` is safe with
       no Web Audio at all.
   Run: node tests/juice_test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');

let checks = 0, fails = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}

/* ---------- the assets ---------- */
/* A RIFF header and the peak of the samples: the two things a silent asset gets wrong. */
function wavInfo(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return { bad: 'not RIFF' };
  const nch = buf.readUInt16LE(22), sr = buf.readUInt32LE(24), bits = buf.readUInt16LE(34);
  /* find 'data' */
  let off = 12;
  while (off + 8 < buf.length && buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4);
  const len = buf.readUInt32LE(off + 4);
  const start = off + 8;
  let peak = 0, extreme = 0, count = 0;
  const step = bits === 16 ? 2 : 1;
  for (let i = start; i + step <= start + len; i += step) {
    const raw = bits === 16 ? Math.abs(buf.readInt16LE(i)) : Math.abs(buf[i] - 128);
    if (bits === 16 && raw >= 32767) extreme++;
    const v = bits === 16 ? raw / 32768 : raw / 128;
    if (v > peak) peak = v;
    count++;
  }
  return { channels: nch, rate: sr, bits: bits, seconds: len / (nch * (bits / 8) * sr),
           peak: peak, extremeShare: count ? extreme / count : 1 };
}
const CLIPS = ['tap', 'select', 'screen', 'start', 'correct', 'wrong'];
CLIPS.forEach(name => {
  const p = path.join(REPO, 'media/sfx', name + '.wav');
  check('the clip ' + name + '.wav is shipped', fs.existsSync(p));
  if (!fs.existsSync(p)) return;
  const i = wavInfo(p);
  check(name + ' is a 48 kHz-ish PCM wav', !i.bad && i.channels >= 1 && i.rate >= 22050, i.bad || (i.rate + ' Hz'));
  check(name + ' is AUDIBLE (peak >= 0.10)', i.peak >= 0.10, 'peak ' + i.peak.toFixed(3));
  /* a clip touching full scale is fine (screen.wav does: 51 of its 23 792 samples sit on
     the rail - a swell, not a clipped click); a file made of nothing but rail would be a
     crushed one, and that is what this refuses */
  check(name + ' is not crushed (< 2% of samples at full scale)', i.extremeShare < 0.02,
        (i.extremeShare * 100).toFixed(2) + '%');
  check(name + ' is short (< 1.2 s)', i.seconds < 1.2, i.seconds.toFixed(2) + ' s');
});
check('the music tracks are shipped (5)', ['light_ambient', 'arcade_quiz_02', 'jazzy_lounge_01',
  'jazzy_lounge_02', 'jazzy_lounge_04'].every(t => fs.existsSync(path.join(REPO, 'media/music', t + '.mp3'))));
/* every clip the two files NAME is a file on disk, and the six the game needs are all
   wired somewhere: a typo or a renamed clip is a silent 404, and a missing one is a
   silent answer */
(function () {
  const both = fs.readFileSync(path.join(REPO, 'juice.js'), 'utf8') + '\n' +
               fs.readFileSync(path.join(REPO, 'quiz.js'), 'utf8');
  const used = ['tap', 'select', 'screen', 'start', 'correct', 'wrong'];
  const unwired = used.filter(n => both.indexOf("'" + n + "'") < 0);
  check('all six clips are wired to an event', unwired.length === 0, unwired.join(','));
  const onDisk = used.filter(n => !fs.existsSync(path.join(REPO, 'media/sfx', n + '.wav')));
  check('every wired clip exists on disk', onDisk.length === 0, onDisk.join(','));
  const stray = (both.match(/media\/sfx\/([a-z0-9]+)\.wav/g) || [])
    .map(m => m.replace(/^media\/sfx\//, '').replace(/\.wav$/, ''))
    .filter(n => used.indexOf(n) < 0);
  check('the code names no clip it does not ship', stray.length === 0, stray.join(','));
})();

/* ---------- a fake browser ---------- */
function makeEnv(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const audios = [], vibr = [];
  function El(tag) {
    const el = {
      tagName: tag, style: { setProperty(k, v) { this[k] = v; } }, children: [],
      className: '', textContent: '', parentNode: null, _cls: {},
      classList: {
        add(c) { el._cls[c] = 1; el.className = Object.keys(el._cls).join(' '); },
        remove(c) { delete el._cls[c]; el.className = Object.keys(el._cls).join(' '); },
        contains(c) { return !!el._cls[c]; }
      },
      appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
      removeChild(c) {
        const i = el.children.indexOf(c);
        if (i >= 0) el.children.splice(i, 1);
        c.parentNode = null;
      },
      getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 40 }; }
    };
    return el;
  }
  const burstEl = El('div');
  const win = {
    matchMedia(q) {
      return { matches: !!(opts.reduce && q.indexOf('reduce') >= 0),
               addEventListener() {} };
    },
    addEventListener() {},
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { if (opts.throwStorage) throw new Error('quota'); store[k] = String(v); }
    },
    AudioContext: opts.webAudio ? function () {
      /* the smallest thing musicBoot() will accept: it only creates a gain and connects */
      const ctx = {
        currentTime: 0, destination: {},
        createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }; },
        decodeAudioData() {}, resume() {}
      };
      return ctx;
    } : undefined,
    document: {
      getElementById(id) { return id === 'burst' ? burstEl : null; },
      createElement(tag) { return El(tag); }
    }
  };
  if (opts.vibrate) {
    win.navigator = { vibrate(p) { vibr.push(p); return opts.vibrate(vibr.length); } };
  }
  function Audio(src) {
    const a = {
      src: src, volume: 1, currentTime: 0, preload: '', plays: 0, ok: opts.refusePlay ? false : true,
      play() {
        a.plays++;
        if (!a.ok) {
          const err = new Error('refused'); err.name = opts.refuse || 'NotAllowedError';
          return { catch(f) { a.refused = true; if (f) f(err); } };
        }
        return { catch() {} };
      }
    };
    audios.push(a);
    return a;
  }
  win.Audio = Audio;
  global.window = win;
  global.Audio = Audio;
  /* Node 21+ ships a `navigator` that is a GETTER: it must be redefined, not assigned */
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: win.navigator || {}, configurable: true, writable: true
    });
  } catch (e) { /* older node: the plain global is fine */ }
  global.localStorage = win.localStorage;
  global.document = win.document;
  return { win: win, store: store, audios: audios, vibr: vibr, burstEl: burstEl };
}

/* Load juice.js fresh, with a given fake environment. Its IIFE reads localStorage and
   matchMedia at load, which is the point: those are the two things that can be wrong. */
function loadJuice(env) {
  const e = env || makeEnv();
  /* the fakes the module reads: window (with its document, matchMedia, Audio and
     localStorage), and the same navigator the page would have */
  global.window = e.win;
  global.document = e.win.document;
  global.Audio = e.win.Audio;
  /* the music rules module. In the PAGE it is a plain <script> that sets
     window.KwizzyPlaylist; under node the same file exports through module.exports (its
     UMD wrapper checks `module` first, and node always has one), so the test require()s
     it and puts it where the page would - same module, same rules. */
  const plPath = path.join(REPO, 'media/music/playlist.js');
  delete require.cache[require.resolve(plPath)];
  global.window.KwizzyPlaylist = require(plPath);
  new Function(fs.readFileSync(path.join(REPO, 'juice.js'), 'utf8')).call(global.window);
  return global.window.Juice;
}

/* ---------- defaults and persistence ---------- */
(function () {
  const env = makeEnv();
  let J = loadJuice(env);
  check('the module is exported', !!J);
  let st = J.settings();
  check('everything is on by default', st.sfx && st.music && st.haptics);
  check('the volume defaults to 100%', st.vol === 1);
  check('the music choice defaults to all', st.trk === 'all');
  check('nothing is written to localStorage until a choice is made',
        Object.keys(env.store).length === 0, JSON.stringify(env.store));

  J.setSfx(false);
  check('Sound off is saved', JSON.parse(env.store['kwizzygeo.settings.v1']).sfx === false);
  J.setMusic(false);
  J.setHaptics(false);
  J.setVol(0.4);
  J.setTrack('jazzy_lounge_01');
  const saved = JSON.parse(env.store['kwizzygeo.settings.v1']);
  check('every setting is in one key',
        saved.sfx === false && saved.music === false && saved.haptics === false &&
        saved.vol === 0.4 && saved.trk === 'jazzy_lounge_01', JSON.stringify(saved));

  /* a reload with that store */
  const env2 = makeEnv({ store: env.store });
  J = loadJuice(env2);
  st = J.settings();
  check('the settings survive a reload',
        !st.sfx && !st.music && !st.haptics && st.vol === 0.4 && st.trk === 'jazzy_lounge_01',
        JSON.stringify(st));

  /* garbage in the key */
  const env3 = makeEnv({ store: { 'kwizzygeo.settings.v1': '{"sfx":"yes","vol":"loud","trk":"nope"}' } });
  J = loadJuice(env3);
  st = J.settings();
  check('a corrupt blob loads as a working configuration', st.sfx === true && st.vol === 1 && st.trk === 'all',
        JSON.stringify(st));
  const env4 = makeEnv({ store: { 'kwizzygeo.settings.v1': 'not json at all' } });
  J = loadJuice(env4);
  check('unparseable JSON loads as defaults', J.settings().sfx === true);
  const env5 = makeEnv({ throwStorage: true });
  J = loadJuice(env5);
  check('a localStorage that throws does not break the module', (function () {
    try { J.setSfx(false); J.setVol(0.2); return J.settings().vol === 0.2; } catch (e) { return false; }
  })());
})();

/* ---------- the clips ---------- */
(function () {
  const env = makeEnv();
  const J = loadJuice(env);
  J.sfx('tap');
  check('a clip is fetched on first use, not before', env.audios.length === 1, env.audios.length);
  check('...from media/sfx, by name', /\bmedia\/sfx\/tap\.wav$/.test(env.audios[0].src), env.audios[0].src);
  check('...and played at full volume', env.audios[0].volume === 1);
  J.sfx('tap');
  J.sfx('tap');
  check('the same clip is REUSED, not re-created', env.audios.length === 1, env.audios.length);
  check('...and replayed from the top each time',
        env.audios[0].plays === 3 && env.audios[0].currentTime === 0, env.audios[0].plays);
  J.sfx('correct');
  J.sfx('wrong');
  check('one <audio> per distinct clip', env.audios.length === 3, env.audios.length);

  J.setSfx(false);
  const before = env.audios.reduce((n, a) => n + a.plays, 0);
  J.sfx('tap'); J.sfx('correct');
  check('with Sound OFF nothing plays', env.audios.reduce((n, a) => n + a.plays, 0) === before);
  J.setSfx(true);
  check('switching Sound back on ticks once (the confirmation)',
        env.audios.reduce((n, a) => n + a.plays, 0) === before + 1);

  /* A REFUSED play. NotAllowedError is the autoplay policy, not a broken clip: the same
     clip must play on the next, gesturing, tap - marking it dead silence the whole game
     after one early refusal. Any OTHER rejection is a real failure and is remembered. */
  const env2 = makeEnv({ refusePlay: true, refuse: 'NotAllowedError' });
  const J2 = loadJuice(env2);
  let threw = false;
  try { J2.sfx('tap'); J2.sfx('tap'); } catch (e) { threw = true; }
  check('a refused play() does not throw', !threw);
  check('a policy refusal (NotAllowedError) does NOT kill the clip',
        !J2._failed.tap, JSON.stringify(J2._failed));
  check('...and the refusal is reported', (function () {
    const a = J2.lastAttempt();
    return a && a.ok === false && /NotAllowedError/.test(a.error);
  })(), JSON.stringify(J2.lastAttempt()));

  const env3 = makeEnv({ refusePlay: true, refuse: 'NotSupportedError' });
  const J3 = loadJuice(env3);
  J3.sfx('tap');
  check('a real failure (NotSupportedError) is remembered, so it is tried once',
        J3._failed.tap === true, JSON.stringify(J3._failed));
  const before3 = env3.audios.reduce((n, a) => n + a.plays, 0);
  J3.sfx('tap');
  check('...and never played again', env3.audios.reduce((n, a) => n + a.plays, 0) === before3);
})();

/* ---------- reduceMotion ---------- */
(function () {
  const env = makeEnv({ reduce: true, vibrate: () => true });
  const J = loadJuice(env);
  check('reduceMotion is read from the media query', J.reduceMotion() === true);
  J.sfx('tap');
  check('reduceMotion does NOT silence the effects', env.audios.length === 1 && env.audios[0].plays === 1);
  J.haptic(60);
  check('reduceMotion DOES silence the haptics', env.vibr.length === 0);
  J.burst(10, 10, 8);
  check('reduceMotion creates no particles', env.burstEl.children.length === 0);
  J.thump({ classList: { add() { check('thump is inert under reduceMotion', false); }, remove() {} } }, 'shake');
  check('reduceMotion skips thump', true);
})();

/* ---------- haptics ---------- */
(function () {
  /* refused twice, then granted: the retry is what makes the first tap of a session buzz */
  const seq = [false, false, true];
  const env = makeEnv({ vibrate: n => seq[n - 1] === true });
  const J = loadJuice(env);
  check('a device with vibration is detected', J.hapticsSupported() === true);
  J.haptic([25, 40, 25]);
  setTimeout(function () {
    check('vibrate() is retried until it is granted', env.vibr.length === 3, env.vibr.length);
    check('...with the pattern it was given', JSON.stringify(env.vibr[0]) === '[25,40,25]', JSON.stringify(env.vibr[0]));

    /* never granted: three tries, then quiet (no infinite retry) */
    const env2 = makeEnv({ vibrate: () => false });
    const J2 = loadJuice(env2);
    J2.haptic(60);
    setTimeout(function () {
      check('a device that always refuses is asked 4 times, then left alone',
            env2.vibr.length === 4, env2.vibr.length);

      /* haptics off in the drawer */
      const env3 = makeEnv({ vibrate: () => true });
      const J3 = loadJuice(env3);
      J3.setHaptics(false);
      J3.haptic(60);
      check('with Haptics OFF nothing vibrates', env3.vibr.length === 0);
      check('a device with no navigator.vibrate says so', (function () {
        const env4 = makeEnv();
        const J4 = loadJuice(env4);
        return J4.hapticsSupported() === false;
      })());
      afterHaptics();
    }, 600);
  }, 600);

  function afterHaptics() { afterBurst(); }
})();

/* ---------- the particles ---------- */
function afterBurst() {
  const env = makeEnv();
  const J = loadJuice(env);
  J.burst(100, 200, 9);
  check('a burst creates n sparks', env.burstEl.children.length === 9, env.burstEl.children.length);
  const s0 = env.burstEl.children[0];
  check('each spark is positioned at the point',
        s0.style.left === '100px' && s0.style.top === '200px', s0.style.left + ',' + s0.style.top);
  check('each spark carries its own travel, spin and duration',
        !!s0.style['--dx'] && !!s0.style['--dy'] && !!s0.style['--rot'] && !!s0.style['--dur']);
  check('sparks are hidden from assistive tech in the markup',
        /id="burst"[^>]*aria-hidden="true"/.test(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8')));
  const node = { classList: { _c: {}, add(c) { this._c[c] = 1; }, remove(c) { delete this._c[c]; } },
                 getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; } };
  J.thump(node, 'shake');
  check('thump adds the class for the animation', node.classList._c.shake === 1);
  afterMusic();
}

/* ---------- the music ---------- */
function afterMusic() {
  /* no Web Audio at all: boot() must be a no-op, not a throw, and the panel must be
     able to say why the row is greyed out */
  const env = makeEnv();
  const J = loadJuice(env);
  let threw = false;
  try { J.boot(); } catch (e) { threw = true; }
  check('boot() without Web Audio does not throw', !threw);
  const m = J.music();
  check('...and reports no audio engine', m.supported === false, JSON.stringify(m));
  check('...while the effects still work', (function () { J.sfx('tap'); return env.audios.length === 1; })());

  /* with a (fake) AudioContext: the playlist state exists and the choice persists */
  const env2 = makeEnv({ webAudio: true });
  const J2 = loadJuice(env2);
  J2.boot();
  const m2 = J2.music();
  check('boot() builds a playlist state', !!m2.state && m2.state.track === 'all', JSON.stringify(m2.state && m2.state.track));
  check('the app opens on the ambient track', m2.state && m2.state.order[0] === 'light_ambient',
        m2.state && m2.state.order.join(','));
  check('five tracks are offered', J2.tracks().length === 5, J2.tracks().length);
  check('a track has its menu label', J2.trackLabel('jazzy_lounge_02') === 'Jazzy lounge #2');
  J2.setTrack('arcade_quiz_02');
  check('picking a track persists it', JSON.parse(env2.store['kwizzygeo.settings.v1']).trk === 'arcade_quiz_02');
  check('...and the playlist follows', J2.music().state.track === 'arcade_quiz_02');

  console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
}

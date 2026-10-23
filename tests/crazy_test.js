/* crazy.js — the CrazyGames adapter, measured on the outside.

   Nothing here is a grep: the module is RUN, twice, in two different hosts, with a fake
   SDK, and what it did to that SDK is read back. The checks are the promises the file
   makes:

     1. IT KNOWS WHERE IT IS. The hostname test is the user's own (`crazygames.com`,
        `*.crazygames.com`), and every near-miss that must NOT count is checked -
        `notcrazygames.com`, `crazygames.com.evil.io`, an empty/absent hostname (a
        `file://` page, a fake DOM in the other test scripts).
     2. OFF THE PLATFORM NOTHING HAPPENS. No body class, not one call to the SDK, and no
        throw if there is no SDK at all: GitHub Pages must get the game it had before.
     3. ON IT, THE EVENTS ARE IN ORDER AND DEDUPED. loadingStart is the FIRST call, made
        before init has resolved (the queue), loadingStop and the gameplay pair follow in
        the order the game really produced them, and a re-render of the same screen does
        not repeat gameplayStart.
     4. THE SETTINGS ARE OBEYED. muteAudio mutes through Juice.setMuted (and only on a
        CHANGE), a later settings event is followed, and `user.systemInfo.locale` reaches
        the app's language - but never over a language the player chose.
     5. A BLOCKED SDK IS A NON-EVENT. No global, an init() that rejects, game methods
        that throw: no exception escapes, the game keeps playing.

   Run: node tests/crazy_test.js */
'use strict';
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../crazy.js', 'utf8');

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return true;
  fails++;
  console.log('FAIL ' + name + (detail !== undefined ? '   [' + detail + ']' : ''));
  return false;
}

/* ---------- the fake host ----------
   One object per run, so `new Function(...).call()` sees exactly one host and the module
   cannot leak state between cases (that is also why it is re-evaluated). */
function host(opts) {
  opts = opts || {};
  const log = [], listeners = {};
  let settingsListeners = [];
  const juice = { setMuted(v) { log.push('juice:muted:' + v); } };
  /* the REAL classList contract, because the fallback path REMOVES the class: a stub
     with only add() would have made "the cg class is taken back off" pass vacuously */
  const body = { cls: [], classList: {
    add(c) { if (body.cls.indexOf(c) < 0) body.cls.push(c); },
    remove(c) { const i = body.cls.indexOf(c); if (i >= 0) body.cls.splice(i, 1); },
    contains(c) { return body.cls.indexOf(c) >= 0; }
  } };
  /* EVERY TIMER THE MODULE ARMS IS RECORDED, so a test can fire them: the version that
     went deaf after 10 s armed one and never cancelled it, and nothing else could see it. */
  const timers = [];
  const consoleLines = [];
  const win = {
    location: { hostname: opts.hostname, search: opts.search || '' },
    addEventListener(t, f) { listeners['win:' + t] = f; },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    console: { log(l) { consoleLines.push(String(l)); } },
    localStorage: opts.storage || { getItem() { return null; }, setItem() {} },
    MapApp: { placesReady() { return !!opts.mapReady; },
              recheckFullscreen() { win.MapApp.recheckCalls = (win.MapApp.recheckCalls || 0) + 1; } },
    ViewState: opts.onLang ? { setLang(c) { log.push('lang:' + c); } } : undefined,
    Juice: juice,
    document: {
      readyState: 'complete', body: body,
      addEventListener(t, f) { listeners['doc:' + t] = f; },
      /* the debug panel: one element, created on demand */
      _els: {},
      getElementById(id) { return win.document._els[id] || null; },
      createElement() { return { style: {}, setAttribute() {}, textContent: '' }; }
    }
  };
  body.appendChild = function (el) { if (el.id) win.document._els[el.id] = el; return el; };
  if (opts.sdk !== false) {
    let release = null;
    const sdk = {
      environment: opts.disabled ? 'disabled' : (opts.environment || 'crazygames'),
      init() {
        log.push('init');
        /* the domain the SDK only refuses AFTER init: that is the real shape of it */
        if (opts.disabledAfterInit) sdk.environment = 'disabled';
        if (opts.initFails) return Promise.reject(new Error('no'));
        /* a slow init: the promise is resolved by the test, which is how a 'pending'
           state is observable at all */
        if (opts.initPending) return new Promise(res => { release = res; });
        return Promise.resolve();
      },
      user: { systemInfo: opts.systemInfo === undefined ? { locale: 'en-US' } : opts.systemInfo },
      game: {
        settings: opts.settings || { muteAudio: false, disableChat: false },
        addSettingsChangeListener(f) { settingsListeners.push(f); },
        loadingStart() { log.push('loadingStart'); },
        loadingStop() { log.push('loadingStop'); },
        gameplayStart() { log.push('gameplayStart'); },
        gameplayStop() { log.push('gameplayStop'); },
        happytime() { log.push('happytime'); },
        reportGameCompletedPercentage(n) { log.push('progress:' + n); }
      }
    };
    if (opts.throwers) {
      sdk.init = function () { log.push('init'); throw new Error('boom'); };
    }
    win.CrazyGames = { SDK: sdk };
    win.__release = () => { if (release) release(); };
  }
  global.window = win;
  global.document = win.document;
  const realSetTimeout = global.setTimeout;
  global.setTimeout = win.setTimeout;
  try { new Function(SRC).call(win); } finally { global.setTimeout = realSetTimeout; }
  return {
    win, log, body, timers, consoleLines,
    resolve() { win.__release(); },
    panel() { return win.document._els['cglog'] || null; },
    Crazy: win.Crazy,
    fire(patch) { settingsListeners.forEach(f => f(patch)); return log; },
    settingsListeners
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

(async function () {
  /* ---------- 1. the hostname test ---------- */
  const yes = ['crazygames.com', 'www.crazygames.com', 'games.crazygames.com', 'app.crazygames.com'];
  const no = ['', 'github.io', 'syllebra.github.io', 'notcrazygames.com', 'crazygames.com.evil.io',
              'crazygames.fr', 'localhost', '127.0.0.1'];
  for (const h of yes) check('"' + h + '" is CrazyGames', host({ hostname: h }).Crazy.isCrazyGames() === true, h);
  for (const h of no) check('"' + h + '" is not', host({ hostname: h }).Crazy.isCrazyGames() === false, h);
  /* no location at all: the other test scripts' fake window has none */
  {
    const h2 = host({ hostname: undefined });
    check('an absent hostname is not CrazyGames and does not throw', h2.Crazy.isCrazyGames() === false);
  }
  /* the forced flag, for testing the integration on localhost */
  {
    const h3 = host({ hostname: 'localhost', search: '?crazysdk=1' });
    check('?crazysdk=1 turns the platform mode on anywhere', h3.Crazy.on() === true && h3.body.cls.indexOf('cg') >= 0,
          h3.body.cls.join(','));
    const h4 = host({ hostname: 'localhost', search: '?crazysdk=0' });
    check('...and ?crazysdk=0 does not', h4.Crazy.on() === false && h4.body.cls.length === 0);
  }

  /* ---------- 2. off the platform, nothing ---------- */
  {
    const h = host({ hostname: 'syllebra.github.io' });
    await tick();
    h.Crazy.loadingStart(); h.Crazy.gameplayStart(); h.Crazy.happytime();
    check('GitHub Pages: no body class', h.body.cls.length === 0, h.body.cls.join(','));
    check('GitHub Pages: not one call reaches the SDK', h.log.length === 0, h.log.join(','));
    check('GitHub Pages: nothing is queued either', h.Crazy.queued() === 0);
    check('GitHub Pages: the module still answers, and says not-muted',
          h.Crazy.ready() === false && h.Crazy.muted() === false);
    check('GitHub Pages: no locale is claimed', h.Crazy.locale() === null);
    /* and with NO SDK global at all, the same calls must not throw */
    const h2 = host({ hostname: 'crazygames.com', sdk: false });
    await tick();
    let threw = false;
    try { h2.Crazy.loadingStop(); h2.Crazy.gameplayStart(); h2.Crazy.happytime(); } catch (e) { threw = true; }
    check('on CrazyGames with no SDK object: the calls are dropped, silently', !threw && h2.log.length === 0);
  }

  /* ---------- 3. on the platform: order, dedupe, the queue ---------- */
  {
    const h = host({ hostname: 'www.crazygames.com' });
    /* loadingStart is fired by the module itself, at parse time - before init resolves */
    check('the body gets the cg class at once', h.body.cls.indexOf('cg') >= 0, h.body.cls.join(','));
    check('loadingStart is queued before init has run', h.Crazy.queued() === 1 &&
          h.log.indexOf('loadingStart') < 0, h.log.join(','));
    await tick();
    check('init() is called', h.log[0] === 'init', h.log.join(','));
    check('...and the queue is flushed in order: loadingStart first',
          h.log[1] === 'loadingStart', h.log.join(','));
    check('...and nothing is left waiting', h.Crazy.queued() === 0);
    check('ready() reports the resolved init', h.Crazy.ready() === true);

    h.Crazy.loadingStop();
    check('loadingStop follows loadingStart', h.log.slice(-1)[0] === 'loadingStop', h.log.join(','));

    h.Crazy.gameplayStart();
    h.Crazy.gameplayStart();            /* a re-render of the same question */
    h.Crazy.gameplayStart();
    check('gameplayStart is sent ONCE however often the screen re-renders',
          h.log.filter(x => x === 'gameplayStart').length === 1, h.log.join(','));
    h.Crazy.gameplayStop();
    h.Crazy.gameplayStop();
    check('...and so is gameplayStop', h.log.filter(x => x === 'gameplayStop').length === 1, h.log.join(','));
    h.Crazy.gameplayStart();
    check('...but the pair can be re-entered', h.log.filter(x => x === 'gameplayStart').length === 2);
    h.Crazy.happytime();
    check('happytime goes straight through', h.log.slice(-1)[0] === 'happytime', h.log.join(','));
    check('...and the log keeps what was sent', h.Crazy.log().join(',') ===
          'loadingStart,loadingStop,gameplayStart,gameplayStop,gameplayStart,happytime', h.Crazy.log().join(','));
  }

  /* ---------- 4. settings: muteAudio, and the locale ---------- */
  {
    const h = host({ hostname: 'crazygames.com', settings: { muteAudio: true }, storage: null,
                     systemInfo: { locale: 'fr-FR' }, mapReady: true, onLang: true });
    await tick();
    check('muteAudio=true at init mutes the juice', h.log.indexOf('juice:muted:true') >= 0, h.log.join(','));
    check('...and muted() says so', h.Crazy.muted() === true);
    h.fire({ muteAudio: true });
    check('the same setting again is not re-applied', h.log.filter(x => /juice:muted/.test(x)).length === 1, h.log.join(','));
    h.fire({ muteAudio: false });
    check('a settings change is followed', h.log.filter(x => x === 'juice:muted:false').length === 1, h.log.join(','));
    check('...and muted() says so too', h.Crazy.muted() === false);

    check('the locale is reduced to its base language', h.Crazy.locale() === 'fr', h.Crazy.locale());
    check('...and applied to the app when nothing was chosen', h.log.indexOf('lang:fr') >= 0, h.log.join(','));
  }
  {
    const chosen = { getItem(k) { return k === 'kwizzy.lang' ? 'de' : null; }, setItem() {} };
    const h = host({ hostname: 'crazygames.com', storage: chosen, systemInfo: { locale: 'fr-FR' }, mapReady: true, onLang: true });
    await tick();
    check('a language the player chose is never overridden by the platform',
          h.log.indexOf('lang:fr') < 0, h.log.join(','));
  }
  {
    const h = host({ hostname: 'crazygames.com', systemInfo: { locale: 'fr-FR' }, mapReady: false, onLang: true });
    await tick();
    check('the locale is not applied before the place names are in',
          h.log.indexOf('lang:fr') < 0, h.log.join(','));
  }
  {
    const h = host({ hostname: 'crazygames.com', systemInfo: null });
    await tick();
    check('no system info is no locale, not a throw', h.Crazy.locale() === null && h.Crazy.ready() === true);
  }

  /* ---------- 5. a broken SDK does not break the game ---------- */
  {
    const h = host({ hostname: 'crazygames.com', initFails: true });
    await tick();
    check('a rejected init() leaves the module inert', h.Crazy.ready() === false);
    let threw = false;
    try { h.Crazy.gameplayStart(); h.Crazy.loadingStop(); } catch (e) { threw = true; }
    check('...and the calls after it are swallowed', !threw);
  }
  {
    /* the methods are there but throw when called: the wrapper catches, and the game
       keeps going - the log then does not contain the call that failed */
    const h = host({ hostname: 'crazygames.com' });
    await tick();
    h.win.CrazyGames.SDK.game.loadingStop = function () { throw new Error('bad'); };
    let threw = false;
    try { h.Crazy.loadingStop(); } catch (e) { threw = true; }
    check('a throwing SDK method does not escape', !threw);
    check('...and is not recorded as sent', h.Crazy.log().indexOf('loadingStop') < 0, h.Crazy.log().join(','));
  }
  {
    /* init() throwing SYNCHRONOUSLY is the other shape of the same failure */
    const h = host({ hostname: 'crazygames.com', throwers: true });
    let threw = false;
    try { await tick(); } catch (e) { threw = true; }
    check('an init() that throws at call time is contained', !threw && h.Crazy.ready() === false, h.log.join(','));
  }

  /* ---------- 5b. NOTHING EVER DISABLES THE MODULE (the bug their QA found) ----------
     The first version armed a 10 s timer that set DEAD when init had not resolved, and
     never cancelled it when init HAD. Ten seconds into every session the module went
     deaf: loadingStart/loadingStop had been sent (their debug panel showed them green)
     while gameplayStart, gameplayStop and happytime - everything that happens once the
     player actually plays - were dropped in silence. So: fire every timer the module
     armed, then prove the calls still reach the SDK. */
  {
    const h = host({ hostname: 'www.crazygames.com' });
    await tick();
    h.Crazy.loadingStart(); h.Crazy.loadingStop();
    /* THERE IS ONE DEADLINE NOW, and it is the right kind: init() gets 9 s before the
       game stops waiting for the platform. What must NEVER happen again is that such a
       timer, once the init has SUCCEEDED, turns the module off. So the test fires every
       timer the module armed - the timer that killed the old build - and requires the
       calls to keep arriving. */
    check('the only timer armed is the init deadline, and init is already done',
          h.timers.length === 1 && h.timers[0].ms >= 5000,
          h.timers.map(t => t.ms + 'ms').join(' '));
    h.timers.forEach(t => t.fn());
    const before = h.log.length;
    h.Crazy.gameplayStart(); h.Crazy.gameplayStop(); h.Crazy.happytime();
    check('...firing it after a successful init does not make the module deaf',
          h.log.slice(before).join(',') === 'gameplayStart,gameplayStop,happytime',
          h.log.slice(before).join(',') || 'nothing');
    check('...and the platform is still on', h.Crazy.on() === true && h.Crazy.initState() === 'ready',
          h.Crazy.initState());
  }
  {
    /* the same shape from the other side: a call made long after init must still be sent.
       The clock is the only thing that moved in the real bug, so here the module is
       driven twice with an idle gap and both halves must arrive. */
    const h = host({ hostname: 'crazygames.com' });
    await tick();
    h.Crazy.gameplayStart();
    await new Promise(r => setTimeout(r, 30));
    h.Crazy.gameplayStop(); h.Crazy.happytime(); h.Crazy.loadingStop();
    check('every call after the first one keeps arriving, in order',
          h.log.filter(x => /^(gameplay|happy|loading)/.test(x)).join(',') ===
          'loadingStart,gameplayStart,gameplayStop,happytime,loadingStop',
          h.log.join(','));
  }

  /* ---------- 5c. GAME COMPLETION ---------- */
  {
    const h = host({ hostname: 'www.crazygames.com' });
    await tick();
    check('progress(0) is sent', h.Crazy.progress(0) === true && h.log.indexOf('progress:0') >= 0, h.log.join(','));
    check('...the same value again is not', h.Crazy.progress(0) === false &&
          h.log.filter(x => x === 'progress:0').length === 1);
    check('progress(50) is sent', h.Crazy.progress(50) === true && h.log.indexOf('progress:50') >= 0);
    check('...and the last value is readable', h.Crazy.progressSent() === 50);
    check('a value out of range is clamped, not passed on',
          h.Crazy.progress(140) === true && h.log.indexOf('progress:100') >= 0, h.log.join(','));
    check('a NaN is refused', h.Crazy.progress('abc') === false);
  }
  {
    /* before init resolves, the figure is QUEUED (a returning player reports on arrival) */
    const h = host({ hostname: 'www.crazygames.com' });
    h.Crazy.progress(75);
    check('a completion figure sent before init is queued, not lost',
          h.Crazy.queued() === 2, h.Crazy.queued() + ' queued');   /* loadingStart + this */
    await tick();
    check('...and flushed once init resolves', h.log.indexOf('progress:75') >= 0, h.log.join(','));
  }

  /* ---------- 5d. THE LOG IS THE CONSOLE'S, AND NOTHING IS DRAWN ON THE PAGE ----------
     Instrumentation over the map is noise for a player; a tester has devtools open. So the
     module must never touch the DOM to report itself - and events() still has to carry
     what happened, which is what a test reads. */
  {
    const h = host({ hostname: 'www.crazygames.com' });
    await tick();
    h.Crazy.gameplayStart();
    check('nothing is added to the page', h.panel() === null && !h.win.document._els['cglog'],
          Object.keys(h.win.document._els).join(','));
    check('...and there is no debug switch on the public shape', h.Crazy.debug === undefined);
    check('the events are still readable programmatically',
          h.Crazy.events().some(e => e.kind === 'sent' && e.name === 'gameplayStart'),
          JSON.stringify(h.Crazy.events().slice(-1)));
    check('...and every event is written to the console with a [crazy] prefix',
          h.consoleLines.some(l => /^\[crazy\] sent gameplayStart$/.test(l)),
          h.consoleLines.slice(-3).join(' | '));
  }
  {
    /* a broken SDK reports ONCE, in the console, and the game goes on */
    const h = host({ hostname: 'www.crazygames.com' });
    await tick();
    h.win.CrazyGames.SDK.game.happytime = undefined;
    h.Crazy.happytime();
    check('a missing SDK method is reported as an error', h.Crazy.failed() === true &&
          h.Crazy.events().some(e => e.kind === 'error' && /happytime/.test(e.name)),
          JSON.stringify(h.Crazy.events().slice(-1)));
    check('...in the console, not on the page', !!h.panel() === false &&
          h.consoleLines.some(l => /^\[crazy\] error happytime/.test(l)),
          h.consoleLines.slice(-2).join(' | '));
  }

  /* ---------- 5d-bis. THE SDK'S `disabled` ENVIRONMENT (found in testing) ----------
     On a domain the SDK does not serve, `init()` RESOLVES - it even logs "HTML SDK
     initialized" - and then every game method throws "CrazySDK is disabled on this
     domain". The build that trusted the resolution went into platform mode, showed the
     loader and then sprayed an error per queued call. The rule now: `environment` is
     checked BEFORE and AFTER init, and 'disabled' means the game plays normally. */
  {
    const h = host({ hostname: 'www.crazygames.com', disabled: true, initPending: true });
    await tick();
    check('a disabled environment is detected before init', h.Crazy.on() === false,
          h.Crazy.initState() + ' / on=' + h.Crazy.on());
    check('...the platform mode is dropped at once (no loader to wait for)',
          h.Crazy.initState() === 'failed' && h.body.cls.indexOf('cg') < 0, h.body.cls.join(','));
    check('...init is not even called', h.log.indexOf('init') < 0, h.log.join(','));
    check('...and it says so once, in the console',
          h.Crazy.events().some(e => e.kind === 'off' && /disabled/.test(e.detail)) &&
          h.consoleLines.some(l => /^\[crazy\] off platform .*disabled/.test(l)),
          h.consoleLines.slice(-2).join(' | '));
  }
  {
    /* the same domain, but the SDK only reveals it once init has resolved: the check
       after init catches it, and the queue is NOT replayed into a dead SDK */
    const h = host({ hostname: 'www.crazygames.com', disabledAfterInit: true });
    h.Crazy.gameplayStart();
    await tick();
    check('a disabled environment revealed by init is caught too', h.Crazy.on() === false &&
          h.Crazy.initState() === 'failed', h.Crazy.initState());
    check('...the cg class is taken off', h.body.cls.indexOf('cg') < 0, h.body.cls.join(','));
    /* init() is the one call made (it is how the environment becomes visible); not one
       event goes out, and the queued loadingStart is dropped rather than replayed */
    check('...nothing is sent to a disabled SDK',
          h.log.filter(x => x !== 'init').length === 0 && h.Crazy.queued() === 0,
          h.log.join(','));
    check('...and the game keeps playing', (() => { try { h.Crazy.gameplayStart(); return true; } catch (e) { return false; } })());
  }

  /* ---------- 5e. INIT IS PART OF LOADING, AND A FAILURE GIVES THE GAME BACK ----------
     The title waits on initState(): 'pending' shows a loader, 'ready' the buttons, and
     'failed' the buttons again WITH the platform mode off. The state has to be readable
     at every point, and a failure has to roll back the three things the platform mode
     changed (the flag, the `cg` body class, the hidden fullscreen disc). */
  {
    /* a pending init: the state is 'pending' until it resolves */
    const h = host({ hostname: 'www.crazygames.com', initPending: true });
    check('a slow init reads as pending', h.Crazy.initState() === 'pending', h.Crazy.initState());
    check('...and the game is not ready yet', h.Crazy.ready() === false);
    check('...and the platform is still on, so the layout stays the platform one',
          h.Crazy.on() === true && h.body.cls.indexOf('cg') >= 0);
    h.resolve();
    await tick();
    check('a resolved init reads as ready', h.Crazy.initState() === 'ready', h.Crazy.initState());
    check('...and the queue went out', h.Crazy.queued() === 0 && h.log.indexOf('loadingStart') >= 0,
          h.log.join(','));
  }
  {
    /* a REJECTED init: the game gets its controls back, the platform goes off */
    const h = host({ hostname: 'www.crazygames.com', initFails: true });
    await tick();
    check('a rejected init reads as failed', h.Crazy.initState() === 'failed', h.Crazy.initState());
    check('...the platform mode is turned OFF', h.Crazy.on() === false);
    check('...the cg body class is taken back off', h.body.cls.indexOf('cg') < 0, h.body.cls.join(','));
    check('...the queued calls are dropped, not left to fire at nothing', h.Crazy.queued() === 0);
    check('...and MapApp is asked to put the fullscreen disc back',
          h.win.MapApp && h.win.MapApp.recheckCalls === 1, h.win.MapApp ? h.win.MapApp.recheckCalls : 'no MapApp');
    check('...and the refusal is recorded once, naming init()',
          h.Crazy.events().filter(e => e.kind === 'off' && /init\(\)/.test(e.detail)).length === 1,
          JSON.stringify(h.Crazy.events().slice(-2)));
    /* and it stays usable: the game must not throw when it plays normally afterwards */
    let threw = false;
    try { h.Crazy.gameplayStart(); h.Crazy.gameplayStop(); } catch (e) { threw = true; }
    check('...and the game can keep playing (calls are simply not sent)', !threw);
  }
  {
    /* an init that THROWS synchronously is the same story */
    const h = host({ hostname: 'www.crazygames.com', throwers: true });
    check('an init() that throws is a failed init too', h.Crazy.initState() === 'failed', h.Crazy.initState());
    check('...and turns the platform off', h.Crazy.on() === false && h.body.cls.indexOf('cg') < 0);
  }
  {
    /* THE DEADLINE. init never answers: after the timeout the game gives itself back. */
    const h = host({ hostname: 'www.crazygames.com', initPending: true });
    check('a pending init arms the deadline', h.timers.length === 1, h.timers.map(t => t.ms + 'ms').join(' '));
    h.timers[0].fn();                       /* the deadline fires */
    check('...which gives up when it fires', h.Crazy.initState() === 'failed', h.Crazy.initState());
    check('...turning the platform mode off', h.Crazy.on() === false && h.body.cls.indexOf('cg') < 0);
    /* and a LATE success must not put the game back into a half-platform state */
    h.resolve();
    await tick();
    check('...and a late init does not resurrect the platform', h.Crazy.on() === false,
          h.Crazy.initState());
  }
  {
    /* the settle hook: called once, and it says which state it settled in */
    const h = host({ hostname: 'www.crazygames.com', initPending: true });
    const seen = [];
    h.Crazy.onSettled(st => seen.push(st));
    h.resolve();
    await tick();
    check('onSettled fires once with the final state', seen.join(',') === 'ready', JSON.stringify(seen));
    h.Crazy.onSettled(st => seen.push('again:' + st));
    check('...and a listener added after it settles is NOT called',
          seen.length === 1, JSON.stringify(seen));
  }

  /* ---------- 6. the wiring in the other files ----------
     The two facts a run cannot show from here: the page loads the module BEFORE app.js
     (the fullscreen disc asks it at load) and before the stylesheets it feeds. */
  {
    const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
    const at = s => html.indexOf(s);
    check('index.html loads the CrazyGames SDK from their CDN, deferred',
          /<script src="https:\/\/sdk\.crazygames\.com\/crazygames-sdk-v3\.js" defer><\/script>/.test(html));
    check('...crazy.js first, before core.js and app.js',
          at('src="crazy.js') > 0 && at('src="crazy.js') < at('src="core.js') &&
          at('src="core.js') < at('src="app.js'), at('src="crazy.js') + '/' + at('src="core.js'));
    /* EVERY local asset the page loads carries a ?v=, and crazy.js is one of them: a
       file that changed without a bump is a stale copy served from a CDN for days (the
       trap this project hit on GitHub Pages). The exact numbers are deliberately NOT
       pinned here - the pinned version of this check failed the day a stylesheet legitimately
       moved - and the file list is read out of the page itself, so an asset added later
       without a buster is caught. */
    const locals = (html.match(/(?:href|src)="([^":]+\?[^"]*)"/g) || []);
    const bare = (html.match(/(?:href|src)="([^":]+)"/g) || []).filter(x => !/\?v=/.test(x) && !/^href="https?:/.test(x) && !/favicon/.test(x));
    check('every local asset the page loads carries a cache-buster',
          bare.length === 0, bare.join(' '));
    check('...and there are the assets this build needs (crazy.js among them)',
          locals.some(x => /src="crazy\.js\?v=\d+"/.test(x)) &&
          locals.some(x => /src="app\.js\?v=\d+"/.test(x)) &&
          locals.some(x => /href="quiz\.css\?v=\d+"/.test(x)), locals.join(' '));
    const app = fs.readFileSync(__dirname + '/../app.js', 'utf8');
    check('app.js hides the fullscreen disc on the platform',
          /function wireFs\(\)[\s\S]{0,600}?window\.Crazy\.on\(\)/.test(app));
    check('app.js tells the platform the map is playable (loadingStop after the first frame)',
          /loop\(\);[\s\S]{0,400}?window\.Crazy\.loadingStop\(\)[\s\S]{0,40}?loadPlaces\(\);/.test(app));
    check('app.js reads the platform locale when nothing was chosen',
          /function storedLang\(\)[\s\S]*?window\.Crazy\.locale/.test(app));
    const quiz = fs.readFileSync(__dirname + '/../quiz.js', 'utf8');
    check('quiz.js starts the platform gameplay on a question and stops it on a menu',
          /platformGameplay\(screen === 'question'\)/.test(quiz));
    check('...and stops it when the player leaves for free exploration',
          /window\.Crazy\.gameplayStop/.test(quiz));
    check('...and celebrates a perfect round, nothing else',
          /function endScreen\(\)[\s\S]{0,700}?C\.happytime\(\)/.test(quiz));
    const css = fs.readFileSync(__dirname + '/../style.css', 'utf8');
    check('style.css moves the Back disc into the freed corner', /body\.cg \.backbtn \{ left: 10px; \}/.test(css));
    check('style.css turns text selection off (their mobile requirement: no magnifier, no context menu)',
          /body \{[^}]*user-select: none/.test(css));
    const qcss = fs.readFileSync(__dirname + '/../quiz.css', 'utf8');
    check('quiz.css closes the gap in the question row and the title bar',
          /body\.cg \.qz-top \{ padding-left: 14px; \}/.test(qcss) &&
          /body\.cg \.qz-topbar \{ padding-left: calc\(10px \+ 36px \+ 12px\); \}/.test(qcss));
  }

  console.log((fails ? 'FAIL' : 'OK') + ' — ' + checks + ' checks, ' + fails + ' failure(s)');
  process.exit(fails ? 1 : 0);
})();

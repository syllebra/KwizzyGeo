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
  const body = { cls: [], classList: { add(c) { body.cls.push(c); } } };
  const win = {
    location: { hostname: opts.hostname, search: opts.search || '' },
    addEventListener(t, f) { listeners['win:' + t] = f; },
    localStorage: opts.storage || { getItem() { return null; }, setItem() {} },
    MapApp: opts.mapReady === undefined ? undefined : { placesReady() { return opts.mapReady; } },
    ViewState: opts.onLang ? { setLang(c) { log.push('lang:' + c); } } : undefined,
    Juice: juice,
    document: { readyState: 'complete', body: body, addEventListener(t, f) { listeners['doc:' + t] = f; } }
  };
  if (opts.sdk !== false) {
    const sdk = {
      environment: opts.environment || 'crazygames',
      init() { log.push('init'); return opts.initFails ? Promise.reject(new Error('no')) : Promise.resolve(); },
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
  }
  global.window = win;
  global.document = win.document;
  new Function(SRC).call(win);
  return {
    win, log, body,
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

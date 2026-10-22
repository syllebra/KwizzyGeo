/* node tests for stats.js: what a round writes down, and what survives a bad blob.
   No browser: `localStorage` is a plain object here, which is all the module uses.
   Run: node tests/stats_test.js */
'use strict';

let checks = 0, fails = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}

/* ---------- a fake localStorage ---------- */
function fresh(seed) {
  const store = seed || {};
  global.window = {
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    }
  };
  delete require.cache[require.resolve(__dirname + '/../stats.js')];
  const S = require(__dirname + '/../stats.js');
  return { S: S, store: store };
}
const KEY = 'kwizzygeo.stats.v1';

/* a question, shaped like the ones quizcore makes */
function question(mode, zone, difficulty, variant) {
  return { mode: mode, zone: zone, difficulty: difficulty, variant: variant || null };
}
function item(name, flag) { return { id: 'ne' + name, name: name, flag: flag || 'fr' }; }

/* ---------- 1. an empty record ---------- */
(function () {
  const { S, store } = fresh();
  const s = S.summary();
  check('nothing played: every figure is zero',
        s.asked === 0 && s.correct === 0 && s.played === 0 && s.bestStreak === 0);
  check('nothing played: the percentage is 0, not NaN', s.pct === 0);
  check('nothing played: no tables', s.modes.length === 0 && s.zones.length === 0 && s.cfgs.length === 0);
  check('reading an empty record does not write one', Object.keys(store).length === 0);
  const b = S.best({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('the best of a config never played is empty, not zero-scored',
        b.score === 0 && b.len === 0 && b.played === 0);
})();

/* ---------- 2. one answer ---------- */
(function () {
  const { S } = fresh();
  S.answer(question('country', 'world', 'easy'), true, item('France', 'fr'));
  let s = S.summary();
  check('one right answer: one asked, one correct', s.asked === 1 && s.correct === 1);
  check('...a 100% record', s.pct === 1);
  check('...a streak of 1', s.streak === 1 && s.bestStreak === 1);
  check('...and one country recorded', s.countriesAsked === 1);

  S.answer(question('country', 'world', 'easy'), false, item('France', 'fr'));
  s = S.summary();
  check('a wrong answer ends the streak', s.streak === 0);
  check('...but the best streak is kept', s.bestStreak === 1);
  check('...and the country now reads 1/2', s.missed.length === 1 &&
        s.missed[0].name === 'France' && s.missed[0].correct === 1 && s.missed[0].asked === 2,
        JSON.stringify(s.missed[0]));
  check('the country keeps its flag code', s.missed[0].flag === 'fr');

  /* the streak's best is sticky across many right answers, then broken */
  for (let i = 0; i < 5; i++) S.answer(question('country', 'world', 'easy'), true, item('Chad'));
  s = S.summary();
  check('five in a row set a best streak of 5', s.bestStreak === 5 && s.streak === 5, s.bestStreak);
  S.answer(question('country', 'world', 'easy'), false, item('Chad'));
  s = S.summary();
  check('a miss resets the current streak, never the best', s.streak === 0 && s.bestStreak === 5);
})();

/* ---------- 3. the groupings ---------- */
(function () {
  const { S } = fresh();
  const q = question('capital', 'europe', 'hard');
  S.answer(q, true, item('France'));
  S.answer(q, false, item('France'));
  S.answer(question('capital', 'europe', 'hard'), true, item('Malta'));
  S.answer(question('flag', 'asia', 'easy', 'flags'), true, item('Japan'));
  const s = S.summary();
  const mode = k => s.modes.filter(m => m.key === k)[0];
  check('two modes are listed', s.modes.length === 2, s.modes.map(m => m.key).join(','));
  check('capital: 2 of 3 right', mode('capital').asked === 3 && mode('capital').correct === 2,
        JSON.stringify(mode('capital')));
  check('flag: 1 of 1 right', mode('flag').asked === 1 && mode('flag').correct === 1);
  const zone = k => s.zones.filter(z => z.key === k)[0];
  check('zones are counted separately', zone('europe').asked === 3 && zone('asia').asked === 1,
        JSON.stringify(s.zones.map(z => z.key + ':' + z.asked)));
  /* the flag mode's two halves have their own key: a flag-picking score must not hide
     a flag-naming one */
  const names = s.cfgs.map(c => c.key);
  check('the flag halves are separate configs',
        names.indexOf('flag|asia|easy|flags') >= 0 && names.indexOf('flag|asia|easy|name') < 0,
        names.join(' '));
  check('a non-flag config carries a dash for the variant',
        names.indexOf('capital|europe|hard|-') >= 0, names.join(' '));
})();

/* ---------- 4. a round, and what "best" means ---------- */
(function () {
  const { S } = fresh();
  function round(cfg, score, len) {
    const asked = [];
    for (let i = 0; i < len; i++) asked.push({});
    const sess = { cfg: cfg, score: score, asked: asked };
    return S.endRun(sess);
  }
  const cfg5 = { mode: 'country', zone: 'world', difficulty: 'easy', len: 5 };
  round(cfg5, 4, 5);
  let b = S.best({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('a 4/5 round is recorded as the best', b.score === 4 && b.len === 5, b.score + '/' + b.len);
  check('...after one round', b.played === 1);

  round({ mode: 'country', zone: 'world', difficulty: 'easy', len: 0 }, 9, 10);
  b = S.best({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('9/10 beats 4/5 (ratio first, then score)', b.score === 9 && b.len === 10, b.score + '/' + b.len);

  round({ mode: 'country', zone: 'world', difficulty: 'easy', len: 10 }, 10, 10);
  b = S.best({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('10/10 beats 9/10', b.score === 10 && b.len === 10);

  /* a LONG round with the same ratio does not replace a shorter perfect one, but a
     better ratio does - and 25/25 is a better ratio than 10/10? no: equal. It must
     still be able to become the best, because its score is higher. */
  round({ mode: 'country', zone: 'world', difficulty: 'easy', len: 25 }, 25, 25);
  b = S.best({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('25/25 becomes the best of the config (same ratio, higher score)', b.score === 25 && b.len === 25);

  round({ mode: 'country', zone: 'world', difficulty: 'easy', len: 25 }, 20, 25);
  b = S.best({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('a worse round never replaces the best', b.score === 25 && b.len === 25);
  check('...but it is counted as played', b.played === 5, b.played);

  /* another config is untouched */
  const other = S.best({ mode: 'capital', zone: 'world', difficulty: 'easy' });
  check('another mode has no record', other.len === 0 && other.played === 0);

  const s = S.summary();
  check('the rounds are kept, newest first', s.played === 5 && s.cfgs.length === 1, s.played);
  const e = s.cfgs[0];
  check('the config row carries the best and the count', e.best === 25 && e.bestLen === 25 && e.played === 5,
        JSON.stringify(e));
})();

/* ---------- 5. the runs list is capped ---------- */
(function () {
  const { S } = fresh();
  const cfg = { mode: 'country', zone: 'world', difficulty: 'medium', len: 5 };
  for (let i = 0; i < S.MAX_RUNS + 12; i++) {
    S.endRun({ cfg: cfg, score: i % 6, asked: [{}, {}, {}, {}, {}] });
  }
  const raw = S.raw();
  check('the runs list is capped at MAX_RUNS', raw.runs.length === S.MAX_RUNS, raw.runs.length);
  check('the newest run is first', raw.runs[0].score === (S.MAX_RUNS + 11) % 6,
        raw.runs[0].score + ' vs ' + ((S.MAX_RUNS + 11) % 6));
  check('the played counter keeps counting beyond the cap', raw.byCfg['country|world|medium|-'].played === S.MAX_RUNS + 12);
})();

/* ---------- 6. what a corrupt blob does ---------- */
(function () {
  const cases = [
    ['not json', 'not json at all'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['a string', '"hello"'],
    ['numbers where objects should be', JSON.stringify({ asked: 'many', correct: -3, byCfg: 7, byCountry: 'x', runs: 'y' })],
    ['a half-written bucket', JSON.stringify({ asked: 4, correct: 9, byCfg: { 'a|b|c|-': { played: 1 } },
                                              byCountry: { ne1: { n: 'X', a: 2, c: 5 } }, runs: [{}, null] })]
  ];
  cases.forEach(([name, blob]) => {
    const { S } = fresh({ [KEY]: blob });
    let ok = true, s = null;
    try { s = S.summary(); } catch (e) { ok = false; }
    check('a ' + name + ' blob loads without throwing', ok);
    if (!s) return;
    check('...as numbers, never NaN', typeof s.asked === 'number' && isFinite(s.asked) &&
          isFinite(s.pct) && typeof s.played === 'number', JSON.stringify({ a: s.asked, p: s.pct }));
    check('...with correct never above asked', s.correct <= s.asked, s.correct + '>' + s.asked);
  });
  /* the half-written bucket keeps what it can */
  const { S } = fresh({ [KEY]: cases[5][1] });
  const raw = S.raw();
  check('a bucket with no counts still loads its key', !!raw.byCfg['a|b|c|-']);
  check('a country whose correct exceeds asked is clamped',
        raw.byCountry.ne1.c === 2, raw.byCountry.ne1.c);
})();

/* ---------- 7. reset ---------- */
(function () {
  const { S, store } = fresh();
  S.answer(question('country', 'world', 'easy'), true, item('France'));
  S.endRun({ cfg: { mode: 'country', zone: 'world', difficulty: 'easy', len: 1 }, score: 1, asked: [{}] });
  check('there is something to erase', S.summary().asked > 0);
  /* the settings and the quiz config are OTHER keys: erasing the record must not
     touch them (that is why they are kept apart) */
  store['kwizzygeo.settings.v1'] = '{"sfx":false}';
  S.reset();
  const s = S.summary();
  check('after a reset everything is zero',
        s.asked === 0 && s.correct === 0 && s.played === 0 && s.bestStreak === 0 &&
        s.countriesAsked === 0 && s.cfgs.length === 0);
  check('...and the settings key is untouched', store['kwizzygeo.settings.v1'] === '{"sfx":false}');
  check('...and the record is still a valid blob',
        (function () { try { return !!JSON.parse(store[KEY]).v; } catch (e) { return false; } })());
})();

/* ---------- 8. a localStorage that refuses to write ---------- */
(function () {
  global.window = {
    localStorage: {
      getItem() { return null; },
      setItem() { throw new Error('QuotaExceededError'); }
    }
  };
  delete require.cache[require.resolve(__dirname + '/../stats.js')];
  const S = require(__dirname + '/../stats.js');
  let threw = false;
  try {
    S.answer(question('country', 'world', 'easy'), true, item('France'));
    S.endRun({ cfg: { mode: 'country', zone: 'world', difficulty: 'easy', len: 1 }, score: 1, asked: [{}] });
  } catch (e) { threw = true; }
  check('a refusing localStorage does not break the game', !threw);
  check('...the record simply reads back empty', S.summary().asked === 0);
})();

/* ---------- 9. two players' keys, one big number ---------- */
(function () {
  const { S, store } = fresh();
  for (let i = 0; i < 300; i++) S.answer(question('country', 'world', 'hard'), i % 3 !== 0, item('C' + (i % 190)));
  const size = store[KEY].length;
  check('the record stays small after 300 answers', size < 40000, size + ' bytes');
  check('...and keeps every country it has seen', Object.keys(S.raw().byCountry).length === 190,
        Object.keys(S.raw().byCountry).length);
})();

console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);

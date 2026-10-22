/* node unit tests for quizcore.js: the quiz's rules, no DOM, no map.
   Fixtures here are a synthetic lattice, so every distance is known: the point of
   these checks is that "six options, always" and "easy = far, hard = near" are
   properties of the code and not of the data that happened to be loaded. */
global.window = undefined;      /* no browser: the file must not need one */
/* quizcore.js exports itself through `window.QuizCore` in a page and through
   `module.exports` under node (it has no DOM to reach for), so the test loads it
   the ordinary way - no source-string evaluation, no reach into its closure. */
const Q = require(__dirname + '/../quizcore.js');

let fails = 0, checks = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

/* ---------- fixtures ---------- */
/* a 13 x 5 lattice over the globe, 30 deg apart: neighbours are 30 deg away, so
   the distance bands are unambiguous */
function lattice(opts) {
  opts = opts || {};
  const zones = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'];
  const out = [];
  let n = 0;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 30) {
      n++;
      const it = {
        id: 'L' + n, idx: n,
        name: 'Country ' + n,
        nameEn: 'Country ' + n,
        cont: zones[n % zones.length], sub: 'Sub ' + (n % 5),
        lat: lat, lon: lon,
        cap: 'Capital ' + n, capLat: lat + 5, capLon: lon + 5,
        flag: 'f' + n
      };
      if (opts.noCap && n % 7 === 0) { it.cap = ''; it.capLat = null; it.capLon = null; }
      if (opts.noFlag && n % 11 === 0) it.flag = '';
      out.push(it);
    }
  }
  return out;
}
const ALL = lattice();

/* ---------- 1. zones ---------- */
check('world pool keeps every item', Q.poolFor(ALL, 'world', 'country').length === ALL.length);
const africa = Q.poolFor(ALL, 'africa', 'country');
check('a zone keeps only its own continent',
      africa.length > 0 && africa.every(it => it.cont === 'Africa'), africa.length);
check('zone of a normal country is its continent',
      Q.zoneOf({ cont: 'Europe', sub: 'Western Europe' }) === 'Europe');
check('a "seven seas" country falls back to its subregion', (() => {
  /* Seychelles, Mauritius, Maldives: Natural Earth files them under
     "Seven seas (open ocean)", so a pure CONTINENT filter would drop them from
     every zone and they would never be asked */
  const it = { id: 'sc', name: 'Seychelles', cont: 'Seven seas (open ocean)',
               sub: 'Eastern Africa', lat: -4.6, lon: 55.5 };
  return Q.zoneOf(it) === 'Africa' && Q.poolFor([it], 'africa', 'country').length === 1;
})());
check('Antarctica belongs to no zone',
      Q.zoneOf({ cont: 'Antarctica', sub: 'Antarctica' }) === null &&
      Q.poolFor([{ id: 'a', name: 'Antarctica', cont: 'Antarctica', sub: 'Antarctica', lat: -80, lon: 0 }],
                'world', 'country').length === 1);
check('an unknown continent falls back to the subregion',
      Q.zoneOf({ cont: 'Nowhere', sub: 'Polynesia' }) === 'Oceania');

/* ---------- 2. what a mode needs ---------- */
check('capital mode needs a capital', Q.poolFor(lattice({ noCap: true }), 'world', 'capital')
      .every(it => it.cap && it.capLat != null));
check('capital mode drops a country with no capital',
      Q.poolFor(lattice({ noCap: true }), 'world', 'capital').length < ALL.length);
check('flag mode needs a flag', Q.poolFor(lattice({ noFlag: true }), 'world', 'flag')
      .every(it => it.flag));
check('country mode needs neither', Q.poolFor(lattice({ noCap: true, noFlag: true }), 'world', 'country').length === ALL.length);

/* a country with no coordinates cannot be scored for difficulty, so it is out of
   every mode */
check('an item without coordinates is never a candidate',
      Q.poolFor([{ id: 'x', name: 'X', cont: 'Asia', lat: null, lon: 5 }], 'world', 'country').length === 0);

/* ---------- 2b. the two halves of flag mode ---------- */
check('flag mode has two variants', Q.FLAG_ASK.map(v => v.id).join(',') === 'name,flags');
(function () {
  const sName = Q.newSession(ALL, { mode: 'flag', zone: 'world', difficulty: 'medium', len: 3, variant: 'name' }, 5);
  const sFlags = Q.newSession(ALL, { mode: 'flag', zone: 'world', difficulty: 'medium', len: 3, variant: 'flags' }, 5);
  check('the variant is carried by the session', sName.cfg.variant === 'name' && sFlags.cfg.variant === 'flags');
  check('a variant only exists in flag mode',
        Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 3, variant: 'flags' }, 5)
          .cfg.variant === null);
  check('an unknown variant falls back to name',
        Q.newSession(ALL, { mode: 'flag', zone: 'world', difficulty: 'medium', len: 3, variant: 'zzz' }, 5)
          .cfg.variant === 'name');
  const qs = [];
  for (let i = 0; i < 12; i++) { const q = Q.nextQuestion(sFlags); if (q) qs.push(q); }
  check('flag-mode questions carry the variant', qs.every(q => q.variant === 'flags'));
  /* both halves ask about countries of the same pool, with the same answer rules */
  check('the flags variant keeps six distinct options',
        qs.every(q => q.options.length === 6 && q.options[q.correct].id === q.answer.id));
  check('the flags variant never repeats a flag among the options',
        qs.every(q => { const s = {}; return q.options.every(it => !s[it.flag] && (s[it.flag] = 1)); }));
  check('the answer flag is among the options',
        qs.every(q => q.options.some(it => it.id === q.answer.id && it.flag === q.answer.flag)));
})();

/* ---------- 3. a question ---------- */
function manyQuestions(cfg, n, seed) {
  const sess = Q.newSession(ALL, cfg, seed == null ? 12345 : seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const q = Q._question(sess, sess.rnd);
    if (!q) break;
    out.push(q);
  }
  return out;
}
const qs = manyQuestions({ mode: 'country', zone: 'world', difficulty: 'medium', len: 50 }, 200);
check('200 questions were produced', qs.length === 200, qs.length);
check('always six options', qs.every(q => q.options.length === Q.N_OPT));
check('the answer is always among the options',
      qs.every(q => q.options.some(it => it.id === q.answer.id)));
check('correct is the index of the answer',
      qs.every(q => q.options[q.correct].id === q.answer.id));
check('six distinct options', qs.every(q => {
  const s = {}; return q.options.every(it => (s[it.id] ? false : (s[it.id] = 1)));
}));
check('no option is the answer twice', qs.every(q => q.options.filter(it => it.id === q.answer.id).length === 1));

/* the key that makes two options "the same answer" is the option's own text */
const capQ = manyQuestions({ mode: 'capital', zone: 'world', difficulty: 'medium', len: 50 }, 200);
check('capital options are capital names, all different', capQ.every(q => {
  const s = {}; return q.options.every(it => it.cap && !s[it.cap.toLowerCase()] && (s[it.cap.toLowerCase()] = 1));
}));
check('capital mode always offers the answer capital',
      capQ.every(q => q.options[q.correct].cap === q.answer.cap && q.options[q.correct].id === q.answer.id));

/* ---------- 4. difficulty is DISTANCE ---------- */
function dists(q) {
  const a = (q.mode === 'capital' && q.answer.capLat != null)
    ? { lat: q.answer.capLat, lon: q.answer.capLon } : { lat: q.answer.lat, lon: q.answer.lon };
  return q.options.filter(it => it.id !== q.answer.id).map(it => {
    const p = (q.mode === 'capital' && it.capLat != null) ? { lat: it.capLat, lon: it.capLon }
                                                          : { lat: it.lat, lon: it.lon };
    return Q.distanceKm(a, p);
  });
}
function mean(list) { return list.reduce((a, b) => a + b, 0) / list.length; }
const easyQ = manyQuestions({ mode: 'country', zone: 'world', difficulty: 'easy', len: 50 }, 200);
const hardQ = manyQuestions({ mode: 'country', zone: 'world', difficulty: 'hard', len: 50 }, 200);
const medQ = manyQuestions({ mode: 'country', zone: 'world', difficulty: 'medium', len: 50 }, 200);
const dEasy = easyQ.map(q => mean(dists(q)));
const dMed = medQ.map(q => mean(dists(q)));
const dHard = hardQ.map(q => mean(dists(q)));
check('easy answers are farther than normal ones', mean(dEasy) > mean(dMed) * 1.4,
      Math.round(mean(dEasy)) + ' vs ' + Math.round(mean(dMed)) + ' km');
check('hard answers are nearer than normal ones', mean(dHard) < mean(dMed) * 0.7,
      Math.round(mean(dHard)) + ' vs ' + Math.round(mean(dMed)) + ' km');

/* and it is a hard rule, not an average: on the lattice a HARD question can only
   draw from the nearest 8 (12 % of 65) and an EASY one from the farthest 23 */
(function () {
  const first = ALL[0];
  const ds = ALL.filter(it => it.id !== first.id)
    .map(it => ({ it: it, d: Q.distanceKm(first, it) }))
    .sort((a, b) => a.d - b.d);
  const nearMax = ds[Math.ceil(ds.length * 0.12) - 1].d;
  const farMin = ds[Math.max(0, ds.length - Math.max(5 * 3, Math.ceil(ds.length * 0.35)))].d;
  const r = Q._rng(7);
  /* the bands are internal, so the check is on the OUTCOME: every distractor of a
     hard question about this country must be inside the nearest band */
  const sess = { cfg: { mode: 'country', zone: 'world', difficulty: 'hard', len: 1 },
                 pool: ALL, used: {}, rnd: r, i: 0, score: 0, asked: [] };
  let okNear = true, okFar = true;
  for (let k = 0; k < 40; k++) {
    const q = Q._question(Object.assign({}, sess, { used: {} }), r);
    if (q.answer.id !== first.id) continue;
    dists(q).forEach(d => { if (d > nearMax + 1e-6) okNear = false; });
  }
  check('a hard question only offers the nearest band', okNear, 'band <= ' + Math.round(nearMax) + ' km');
  const sess2 = { cfg: { mode: 'country', zone: 'world', difficulty: 'easy', len: 1 },
                  pool: ALL, used: {}, rnd: Q._rng(11), i: 0, score: 0, asked: [] };
  for (let k = 0; k < 60; k++) {
    const q = Q._question(sess2, sess2.rnd);
    if (q.answer.id !== first.id) continue;
    dists(q).forEach(d => { if (d < farMin - 1e-6) okFar = false; });
  }
  check('an easy question only offers the farthest band', okFar, 'band >= ' + Math.round(farMin) + ' km');
})();

/* flag mode: two options never carry the same flag (two identical pictures with
   two different right answers is not a question) */
const flagAll = lattice();
flagAll[1].flag = flagAll[0].flag;         /* a duplicate the mode must dodge */
const flagQ = (function () {
  const sess = Q.newSession(flagAll, { mode: 'flag', zone: 'world', difficulty: 'medium', len: 50 }, 99);
  const out = [];
  for (let i = 0; i < 120; i++) { const q = Q._question(sess, sess.rnd); if (q) out.push(q); }
  return out;
})();
check('flag options are all different flags', flagQ.every(q => {
  const s = {}; return q.options.every(it => !s[it.flag] && (s[it.flag] = 1));
}));

/* ---------- 5. the session ---------- */
(function () {
  const sess = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 50 }, 4);
  check('session clamps and normalises its config',
        sess.cfg.len === 50 && sess.cfg.mode === 'country' && sess.cfg.difficulty === 'medium');
  const bad = Q.newSession(ALL, { mode: 'nope', zone: 'nope', difficulty: 'nope', len: 0 }, 4);
  check('a bad config falls back to world / country / normal',
        bad.cfg.mode === 'country' && bad.cfg.zone === 'world' && bad.cfg.difficulty === 'medium' &&
        bad.cfg.len === 10);

  const ids = {}, order = [];
  let q, n = 0;
  while ((q = Q.nextQuestion(sess))) { n++; ids[q.answer.id] = (ids[q.answer.id] || 0) + 1; order.push(q); }
  check('a session asks exactly len questions', n === 50, n);
  check('a country is never asked twice in one session',
        order.every(q => ids[q.answer.id] === 1));
  check('nextQuestion returns null at the end', Q.nextQuestion(sess) === null);

  check('the score counts the right answers only', (function () {
    const s = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 3 }, 8);
    const q1 = Q.nextQuestion(s), q2 = Q.nextQuestion(s), q3 = Q.nextQuestion(s);
    Q.answerQuestion(s, q1, q1.correct);
    Q.answerQuestion(s, q2, (q2.correct + 1) % 6);
    Q.answerQuestion(s, q3, q3.correct);
    return s.score === 2;
  })());
  check('one question cannot be answered twice', (function () {
    const s = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 1 }, 8);
    const q1 = Q.nextQuestion(s);
    Q.answerQuestion(s, q1, q1.correct);
    const again = Q.answerQuestion(s, q1, (q1.correct + 1) % 6);
    return again === null && s.score === 1;
  })());
  check('a wrong answer still reports where the right one was', (function () {
    const s = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 1 }, 8);
    const q1 = Q.nextQuestion(s);
    const r = Q.answerQuestion(s, q1, (q1.correct + 2) % 6);
    return r.ok === false && r.correct === q1.correct && s.score === 0;
  })());

  /* the same seed replays the same questions: that is what makes the session
     reproducible in a test at all */
  function replay(seed) {
    const s = Q.newSession(ALL, { mode: 'capital', zone: 'europe', difficulty: 'hard', len: 10 }, seed);
    const out = [];
    for (let i = 0; i < 10; i++) { const q = Q.nextQuestion(s); if (q) out.push(q.answer.id + ':' + q.correct); }
    return out.join(',');
  }
  check('the same seed replays the same questions', replay(42) === replay(42));
  check('another seed asks different questions', replay(42) !== replay(43));
})();

/* ---------- 6. the pool is never asked for more than it has ---------- */
(function () {
  /* a six-country pool: every question uses all six, so the used-set must RESET
     rather than run dry */
  const tiny = ALL.slice(0, 6);
  const sess = Q.newSession(tiny, { mode: 'country', zone: 'world', difficulty: 'hard', len: 12 }, 3);
  let n = 0, q;
  while ((q = Q.nextQuestion(sess))) { n++; if (q.options.length !== 6) break; }
  check('a tiny pool still produces full questions', n === 12 && sess.asked.every(q => q.options.length === 6), n);
  check('a pool smaller than six yields no question at all',
        Q.newSession(ALL.slice(0, 5), { mode: 'country', zone: 'world', difficulty: 'easy', len: 5 }, 3).pool.length === 5 &&
        Q.nextQuestion(Q.newSession(ALL.slice(0, 5), { mode: 'country', zone: 'world', difficulty: 'easy', len: 5 }, 3)) === null);
})();

/* ---------- 7. real data sanity, cheap half (the map-driven half is quiz_test.js) ---------- */
(function () {
  /* the zones must between them cover the whole world pool: a country that belongs
     to no zone is a country the game can never ask about (Antarctica excepted) */
  const zoneUnion = {};
  Q.ZONES.forEach(z => { if (z.cont) zoneUnion[z.cont] = 1; });
  check('every zone in the list has a continent', Q.ZONES.every(z => z.id === 'world' ? z.cont === null : !!z.cont));
  check('the difficulty list is easy / normal / hard',
        Q.DIFFS.map(d => d.id).join(',') === 'easy,medium,hard');
  check('the mode list is country / capital / flag',
        Q.MODES.map(m => m.id).join(',') === 'country,capital,flag');
  check('six options is the rule', Q.N_OPT === 6);
  void zoneUnion;
})();

console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);

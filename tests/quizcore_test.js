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

/* ---------- 3b. how long a round is ---------- */
(function () {
  check('three lengths are offered: 10, 25 and All',
        Q.LENS.map(l => l.id).join(',') === '10,25,0', Q.LENS.map(l => l.id).join(','));
  [10, 25].forEach(len => {
    const s = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: len }, 5);
    check('a ' + len + '-question round is ' + len + ' questions',
          s.cfg.len === len && s.pool.length >= len, s.cfg.len);
    let n = 0, q;
    while ((q = Q.nextQuestion(s))) n++;
    check('...and asks exactly that many', n === len, n);
  });
  const allS = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 0 }, 5);
  let n = 0, q, ids = {};
  while ((q = Q.nextQuestion(allS))) { n++; ids[q.answer.id] = (ids[q.answer.id] || 0) + 1; }
  check('All asks every country of the pool once', n === allS.pool.length && n === ALL.length, n);
  check('...and repeats none', Object.keys(ids).every(k => ids[k] === 1));
  /* a zone narrower than the asked length: the pool wins, never a repeat */
  const europe = Q.newSession(ALL, { mode: 'country', zone: 'africa', difficulty: 'medium', len: 0 }, 5);
  check('All on a zone is that zone\'s pool', europe.cfg.len === europe.pool.length && europe.pool.length > 0,
        europe.cfg.len);
  const tooLong = Q.newSession(ALL, { mode: 'capital', zone: 'oceania', difficulty: 'medium', len: 25 }, 5);
  check('a length longer than the pool is clipped to the pool',
        tooLong.cfg.len === tooLong.pool.length && tooLong.cfg.lenWanted === 25,
        tooLong.cfg.len + ' of ' + tooLong.pool.length);
  check('the wanted length is kept for the record', allS.cfg.lenWanted === ALL.length);
})();

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
  const sess = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 25 }, 4);
  check('session clamps and normalises its config',
        sess.cfg.len === 25 && sess.cfg.mode === 'country' && sess.cfg.difficulty === 'medium');
  /* A LENGTH THE MODE DOES NOT OFFER RESOLVES TO ITS FIRST ONE. It used to be taken
     as-is (50 stayed 50); locate offers 5 / 10 / 25 and no "All", so the choice has to
     be resolved against the mode's own list - and doing that for every mode keeps one
     rule instead of a special case. */
  const offList = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 50 }, 4);
  check('a length the mode does not offer falls back to its first',
        offList.cfg.len === Q.lensOf('country')[0].id, offList.cfg.len);
  /* `len: 0` is "All", not a bad value: the whole pool. A bad MODE / zone / difficulty
     still falls back, and the length then follows the fallback's pool. */
  const bad = Q.newSession(ALL, { mode: 'nope', zone: 'nope', difficulty: 'nope', len: 10 }, 4);
  check('a bad config falls back to world / country / normal',
        bad.cfg.mode === 'country' && bad.cfg.zone === 'world' && bad.cfg.difficulty === 'medium' &&
        bad.cfg.len === 10);
  const all = Q.newSession(ALL, { mode: 'country', zone: 'world', difficulty: 'medium', len: 0 }, 4);
  check('len 0 means All: the whole pool, once', all.cfg.len === ALL.length && all.cfg.lenWanted === ALL.length,
        all.cfg.len + ' / ' + ALL.length);

  const ids = {}, order = [];
  let q, n = 0;
  while ((q = Q.nextQuestion(sess))) { n++; ids[q.answer.id] = (ids[q.answer.id] || 0) + 1; order.push(q); }
  check('a session asks exactly len questions', n === 25, n);
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
  /* a six-country pool cannot hold a 12-question round any more: the length is
     resolved against the pool, so it is 6 and every country is asked once */
  const tiny = ALL.slice(0, 6);
  const sess = Q.newSession(tiny, { mode: 'country', zone: 'world', difficulty: 'hard', len: 12 }, 3);
  let n = 0, q;
  while ((q = Q.nextQuestion(sess))) { n++; if (q.options.length !== 6) break; }
  check('a 12-question round on a six-country pool is six questions',
        sess.cfg.len === 6 && n === 6 && sess.asked.every(q => q.options.length === 6), n);
  check('...and every question still has six options', sess.asked.every(q => q.options.length === 6));
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
  check('the mode list is country / capital / flag / locate',
        Q.MODES.map(m => m.id).join(',') === 'country,capital,flag,locate');
  check('six options is the rule', Q.N_OPT === 6);
  void zoneUnion;
})();

/* ---------- 9. LOCATE: the fourth mode, scored in kilometres ----------
   What has to be true, and why each one is a check and not a comment:
     * a city's difficulty is its FAME, and the three bands are DISJOINT - otherwise
       "hard" is just "easy with bad luck";
     * no town below 40 000 people is ever asked: a place nobody could find is not a
       hard question, it is a lottery;
     * the points curve is monotone, full marks at zero, and worth what it says;
     * an answer is a POINT, given once, and it scores by distance - not right/wrong;
     * locate's lengths are its own (5 / 10 / 25, no "All"), so a stored "All" from a
       country round cannot start a 4 598-question round. */
(function () {
  /* min_zoom (z) is the fame rank now, so a fixture HAS to carry one: it is what the
     bands are thresholds on. The numbers below are the real ones from Natural Earth
     (Paris 1.7, Bern 5.6, Lyon 6.0, Villeurbanne 6.7). */
  const C = (i, name, lat, lon, pop, cap, cont, zz) =>
    ({ id: 'p' + i, idx: i, name: name, lat: lat, lon: lon, pop: pop, cap: cap || 0,
       cont: cont || 'Europe', sub: '', country: 'X', z: zz == null ? 6.0 : zz });
  const CITIES = [
    C(1, 'Paris', 48.85, 2.35, 9904000, 0, 'Europe', 1.7),
    C(2, 'Lyon', 45.76, 4.83, 472000, 0, 'Europe', 6.0),
    C(3, 'Villeurbanne', 45.77, 4.88, 124000, 0, 'Europe', 6.7),
    C(4, 'Annonay', 45.24, 4.67, 16000, 0, 'Europe', 8.0),        /* too small to be asked */
    C(5, 'Bern', 46.95, 7.44, 275000, 1, 'Europe', 5.6),          /* a capital: easy */
    C(6, 'Marseille', 43.30, 5.40, 1400000, 0, 'Europe', 4.0),
    C(7, 'Ouagadougou', 12.37, -1.52, 1800000, 0, 'Africa', 4.0),
    C(8, 'Bobo-Dioulasso', 11.18, -4.30, 200000, 0, 'Africa', 6.7),
    C(9, 'Eger', 47.90, 20.37, 56647, 0, 'Europe', 7.7),          /* the 8-9 tail: never */
    C(10, 'Atar', 20.52, -13.05, 25000, 0, 'Africa', 5.0)         /* an isolated speck */
  ];
  const names = (list) => list.map(c => c.name).join(',');

  /* Bern is a capital at min_zoom 5.6, so it is MEDIUM under these thresholds: min_zoom
     leads, and being a capital only rescues a city from the population floor and from the
     Easy band's 250 000 condition - it does not make an obscure capital famous. */
  check('the fame bands are disjoint, and read off min_zoom',
        ['easy', 'medium', 'hard'].map(d => names(Q.cityPool(CITIES, 'world', d))).join('|') ===
        'Paris,Marseille,Ouagadougou|Lyon,Bern|Villeurbanne,Bobo-Dioulasso',
        ['easy', 'medium', 'hard'].map(d => names(Q.cityPool(CITIES, 'world', d))).join('|'));
  check('a town above min_zoom 7 is never asked (Eger, z 7.7)',
        Q.cityBand(C(20, 'Eger', 0, 0, 56647, 0, 'Europe', 7.7)) === null);
  check('...nor is an isolated speck with a low zoom and no people (Atar, 25 000)',
        Q.cityBand(C(21, 'Atar', 0, 0, 25000, 0, 'Africa', 5.0)) === null);
  check('...but a tiny CAPITAL still is (Vaduz, 36 000)',
        Q.cityBand(C(22, 'Vaduz', 0, 0, 36281, 1, 'Europe', 6.7)) === 'hard');
  check('...no city in two bands at once', (() => {
    const seen = {};
    return ['easy', 'medium', 'hard'].every(d => Q.cityPool(CITIES, 'world', d).every(c => {
      if (seen[c.id]) return false;
      seen[c.id] = 1; return true;
    }));
  })());
  check('a national capital is easy however small it is',
        Q.cityBand(C(9, 'Reykjavik', 64.1, -21.9, 166212, 1, 'Europe', 3.7)) === 'easy');
  check('...but a capital does not become Easy by existing (Bern, z 5.6)',
        Q.cityBand(C(23, 'Bern', 46.9, 7.4, 275329, 1, 'Europe', 5.6)) === 'medium');
  check('a town below 40 000 is never asked',
        Q.cityBand(C(10, 'Nowhere', 0, 0, 39999, 0, 'Europe', 6.0)) === null &&
        Q.cityBand(C(10, 'x', 0, 0, 40000, 0, 'Europe', 6.0)) === 'medium');
  check('a city with no population and no capital is not asked',
        Q.cityBand(C(11, 'y', 0, 0, null, 0, 'Europe', 6.0)) === null);
  check('a city with no min_zoom is not asked at all',
        Q.cityBand({ id: 'q', name: 'q', lat: 0, lon: 0, pop: 5000000, cap: 1 }) === null);
  check('a zone still filters the cities',
        names(Q.cityPool(CITIES, 'africa', 'hard')) === 'Bobo-Dioulasso', names(Q.cityPool(CITIES, 'africa', 'hard')));
  check('the point of a bullseye is the full 1000', Q.pointsFor(0) === Q.POINTS_MAX, Q.pointsFor(0));
  check('points only fall with distance, and never below zero', (() => {
    let last = Infinity;
    for (let km = 0; km <= 20000; km += 50) {
      const p = Q.pointsFor(km);
      if (p > last || p < 0) return false;
      last = p;
    }
    return Q.pointsFor(100000) === 0;
  })());
  check('the curve is the one documented (1000 km -> 513, 5000 km -> 36)',
        Q.pointsFor(1000) === 513 && Q.pointsFor(5000) === 36,
        Q.pointsFor(1000) + ' / ' + Q.pointsFor(5000));

  const sess = Q.newSession(CITIES, { mode: 'locate', zone: 'world', difficulty: 'medium', len: 5 }, 3);
  check('a locate session asks CITIES, from the difficulty band',
        sess.pool.length === 2 && names(sess.pool) === 'Lyon,Bern', sess.pool.length);
  check('...and its length is capped to that pool', sess.cfg.len === 2, sess.cfg.len);
  const q = Q.nextQuestion(sess);
  check('a locate question has no options at all',
        !!q && q.mode === 'locate' && q.options.length === 0 && q.correct === -1);
  const res = Q.answerPoint(sess, q, { lat: 45.76, lon: 4.83 });
  check('a guess on the city is a bullseye and scores full marks',
        res.ok === true && res.km < 1 && res.points === 1000, JSON.stringify(res));
  check('...and the session counts it', sess.score === 1 && sess.points === 1000);
  check('the same answer cannot be scored twice', Q.answerPoint(sess, q, { lat: 0, lon: 0 }) === null);

  const sess2 = Q.newSession(CITIES, { mode: 'locate', zone: 'world', difficulty: 'medium', len: 5 }, 3);
  const q2 = Q.nextQuestion(sess2);
  const far = Q.answerPoint(sess2, q2, { lat: 48.85, lon: 2.35 });   /* Paris: ~392 km */
  check('a far guess is measured in kilometres, not right or wrong',
        far.ok === false && Math.abs(far.km - 391.6) < 5, far.km);
  check('...and still scores something (points, not a verdict)', far.points > 600 && far.points < 850, far.points);
  check('a session adds up the distance it was off', Math.abs(sess2.km - far.km) < 1e-6);

  check('locate has its own lengths: 5 / 10 / 25, and no "All"',
        Q.lensOf('locate').map(l => l.id).join(',') === '5,10,25');
  check('...while the three other modes keep 10 / 25 / All',
        Q.lensOf('country').map(l => l.id).join(',') === '10,25,0' &&
        Q.lensOf('capital').map(l => l.id).join(',') === '10,25,0' &&
        Q.lensOf('flag').map(l => l.id).join(',') === '10,25,0');
  check('a stored "All" cannot start a locate round of every city',
        Q.newSession(CITIES, { mode: 'locate', zone: 'world', difficulty: 'easy', len: 0 }, 1).cfg.len === 3,
        Q.newSession(CITIES, { mode: 'locate', zone: 'world', difficulty: 'easy', len: 0 }, 1).cfg.len);
  /* every question of a locate round is a different city: the pool is walked, not sampled */
  const seen = {};
  const s3 = Q.newSession(CITIES, { mode: 'locate', zone: 'europe', difficulty: 'easy', len: 10 }, 11);
  let n3 = 0, dup = false;
  while (Q.nextQuestion(s3)) { n3++; }
  check('a locate round asks one question per easy city in Europe (2 of them)',
        n3 === Q.cityPool(CITIES, 'europe', 'easy').length && n3 === 2, n3);
  void seen;
})();

/* ---------- 10. LOCATE PICKS A COUNTRY FIRST ----------
   Drawing from the cities is what the first build did, and it made one easy question in
   five Chinese (China is 18.6 % of the easy pool). The rule is now two-stage: a country,
   then a city of it - so what these checks pin is that the COUNTRY is what is spread, that
   a country is not asked twice in a round while an unasked one remains, and that a big
   country is still visible without dominating. */
(function () {
  const C = (i, name, country, pop, cap) =>
    ({ id: 'p' + i, idx: i, name: name, country: country, pop: pop, cap: cap || 0,
       lat: 45 + (i % 7), lon: 5 + (i % 11), cont: 'Europe', sub: '', z: 4.0 });
  /* one bloated country (20 cities) and five small ones (1 city each): a draw over the
     CITIES makes the bloated one 80 %, a draw over the COUNTRIES makes it ~34 % at the
     default weight and 17 % strictly equal */
  const BIG = [];
  for (let i = 0; i < 20; i++) BIG.push(C(i, 'Big ' + i, 'BIG', 2000000));
  const SMALL = [C(100, 'S1', 'S1', 2000000), C(101, 'S2', 'S2', 2000000),
                 C(102, 'S3', 'S3', 2000000), C(103, 'S4', 'S4', 2000000),
                 C(104, 'S5', 'S5', 2000000)];
  const ALL = BIG.concat(SMALL);
  const grouped = Q.citiesByCountry(ALL);
  check('the cities are grouped by country', Object.keys(grouped.by).length === 6 &&
        grouped.by.BIG.length === 20, Object.keys(grouped.by).length);

  const counts = {};
  let rounds = 300, perRound = 0;
  for (let i = 0; i < rounds; i++) {
    const sess = Q.newSession(ALL, { mode: 'locate', zone: 'world', difficulty: 'easy', len: 5 }, 100 + i);
    let q, n = 0;
    while ((q = Q.nextQuestion(sess))) {
      counts[q.answer.country] = (counts[q.answer.country] || 0) + 1;
      n++;
    }
    if (i === 0) perRound = n;
  }
  const tot = Object.values(counts).reduce((a, b) => a + b, 0);
  const bigShare = counts.BIG / tot;
  /* 6 is not a length locate offers (5 / 10 / 25), so this is also the resolution rule at
     work: the round is 5, and it asks 5 DIFFERENT countries out of the 6 available */
  check('a round of 5 in a 6-country zone asks 5 questions', perRound === 5, perRound);
  check('the big country no longer takes most of the questions',
        bigShare < 0.42, (100 * bigShare).toFixed(1) + '%');
  check('...but it is still in the mix (a country, not an accident)',
        bigShare > 0.15, (100 * bigShare).toFixed(1) + '%');
  check('every small country is asked about as often as the big one is',
        ['S1', 'S2', 'S3', 'S4', 'S5'].every(k => counts[k] > 0), JSON.stringify(counts));

  /* a country is not asked twice in a round while an unasked one remains */
  check('a round asks DIFFERENT countries (one question each)', (() => {
    for (let i = 0; i < 40; i++) {
      const sess = Q.newSession(ALL, { mode: 'locate', zone: 'world', difficulty: 'easy', len: 5 }, 900 + i);
      const seen = {}, names = [];
      let q;
      while ((q = Q.nextQuestion(sess))) {
        if (seen[q.answer.country]) return false;
        seen[q.answer.country] = 1; names.push(q.answer.country);
      }
    }
    return true;
  })());
  /* ...and once every country HAS been asked, the round may repeat one rather than stop */
  check('past the last country, a round goes on with the cities that are left', (() => {
    const sess = Q.newSession(ALL, { mode: 'locate', zone: 'world', difficulty: 'easy', len: 10 }, 77);
    let n = 0, q, rep = false, seen = {};
    while ((q = Q.nextQuestion(sess))) {
      n++;
      if (seen[q.answer.country]) rep = true;
      seen[q.answer.country] = 1;
    }
    return n === 10 && rep;          /* 6 countries, 10 questions: it had to come round */
  })());

  /* the weight is the one design decision: 1.0 would be "proportional to cities" again */
  check('the country weight is between the two extremes (0 = equal, 1 = by cities)',
        Q.COUNTRY_WEIGHT > 0 && Q.COUNTRY_WEIGHT < 1, Q.COUNTRY_WEIGHT);
})();


/* ---------- THE FRANCE QUIZ'S RULES ----------
   A synthetic France: 13 départements strung east along a parallel every 0.5 deg,
   numbered 01..13, six of them in région 'R1' and the rest in 'R2', plus one overseas
   département ('971') alone in 'R3'. It is a fixture, not the real data: what is
   asserted here are the RULES (zones, options, numbers, the score scale), which is
   what quizcore owns; `tests/france_test.js` runs the same rules on the real files. */
(function () {
  const FR = [];
  for (let i = 1; i <= 13; i++) {
    const code = String(i).padStart(2, '0');
    FR.push({
      id: 'D' + code, code: code, name: 'Département ' + code,
      reg: i <= 6 ? '11' : '24', regName: 'Région ' + (i <= 6 ? '11' : '24'),
      pref: 'Préf ' + code, prefLat: 46 + i * 0.1, prefLon: 1 + i * 0.5,
      lat: 46 + i * 0.1, lon: 1 + i * 0.5,
      pop: 100000, dom: 0, country: 'D' + code
    });
  }
  FR.push({ id: 'D971', code: '971', name: 'Guadeloupe', reg: '01', regName: 'Guadeloupe',
            pref: 'Basse-Terre', prefLat: 16, prefLon: -61.7, lat: 16.2, lon: -61.5,
            pop: 400000, dom: 1, country: 'D971' });

  check('the France quiz has six modes, all tagged france',
        Q.FR_MODES.length === 6 && Q.FR_MODES.every(m => m.scope === 'france'),
        Q.FR_MODES.map(m => m.id).join(','));
  check('modesOf(france) is the France list, modesOf(world) the world one',
        Q.modesOf('france') === Q.FR_MODES && Q.modesOf('world') === Q.MODES);
  check('isFr knows the five and nothing else',
        ['fdept', 'fplace', 'fnum', 'fname', 'fpref', 'floc'].every(Q.isFr) &&
        !Q.isFr('country') && !Q.isFr('locate') && !Q.isFr(undefined));

  /* zones: the three aggregates plus the régions, and the filter reads `reg`/`dom` */
  const zones = Q.frZones([{ code: '11', nom: 'Région 11', ndep: 6 },
                           { code: '01', nom: 'Guadeloupe', ndep: 1, dom: true }]);
  check('frZones is all / metropolitan / overseas + one per région',
        zones.length === 5 && zones[0].id === 'fr' && zones[3].id === 'r11', zones.map(z => z.id).join(','));
  check('isFrZone accepts the three aggregates and r<code> only',
        Q.isFrZone('fr') && Q.isFrZone('fr-metro') && Q.isFrZone('fr-dom') &&
        Q.isFrZone('r11') && !Q.isFrZone('europe') && !Q.isFrZone('11') && !Q.isFrZone(null));
  check('the pools follow the zones', (() => {
    const all = Q.poolFor(FR, 'fr', 'fdept').length;
    const metro = Q.poolFor(FR, 'fr-metro', 'fdept').length;
    const dom = Q.poolFor(FR, 'fr-dom', 'fdept').length;
    const r1 = Q.poolFor(FR, 'r11', 'fdept').length;
    return all === 14 && metro === 13 && dom === 1 && r1 === 6;
  })(), [Q.poolFor(FR, 'fr', 'fdept').length, Q.poolFor(FR, 'fr-metro', 'fdept').length,
        Q.poolFor(FR, 'fr-dom', 'fdept').length, Q.poolFor(FR, 'r11', 'fdept').length].join('/'));

  /* THE OPTIONS COME FROM FRANCE, THE ANSWER FROM THE ZONE: a one-département zone is
     still a six-option question (this is what makes Mayotte playable at all) */
  check('a one-département zone still asks six options', (() => {
    const s = Q.newSession(FR, { mode: 'fname', zone: 'r01', difficulty: 'medium', len: 10 }, 4);
    const q = Q.nextQuestion(s);
    return s.cfg.len === 1 && q.answer.code === '971' && q.options.length === 6 &&
           q.options.filter(o => o.reg !== '01').length === 5;
  })());
  check('...and its round is one question', (() => {
    const s = Q.newSession(FR, { mode: 'fname', zone: 'r01', difficulty: 'medium', len: 25 }, 4);
    return s.cfg.len === 1;
  })());

  /* the number modes: the ANSWER is a code, and the options are codes */
  /* NAME -> NUMBER HAS TWO SHAPES (his call, 2026-11-02): a QCM of six NUMBERS at the three
     regular difficulties, and a keypad at EXTREME - which is the mode's fourth difficulty
     and exists nowhere else */
  check('name -> number at Normal is a QCM of six codes', (() => {
    const s = Q.newSession(FR, { mode: 'fnum', zone: 'fr', difficulty: 'medium', len: 10 }, 8);
    const q = Q.nextQuestion(s);
    return q.options.length === 6 && !q.extreme &&
           q.options.every(o => /^[0-9]{2,3}$/.test(o.code)) &&
           q.options[q.correct].code === q.answer.code;
  })());
  check('...and at EXTREME it is a typed code, with no options', (() => {
    const s = Q.newSession(FR, { mode: 'fnum', zone: 'fr', difficulty: 'extreme', len: 10 }, 8);
    const q = Q.nextQuestion(s);
    return q.options.length === 0 && q.correct === -1 && q.extreme === true && !!q.answer.code;
  })());
  check('Extreme is a difficulty of that mode alone',
        Q.diffsOf('fnum').length === 4 && Q.diffsOf('fname').length === 3 &&
        Q.diffsOf('country').length === 3);
  check('...and the normalisation is the rule: 1 is 01, 2a is 2A, 971 stays',
        Q.normNum('1') === '01' && Q.normNum('01') === '01' && Q.normNum('2a') === '2A' &&
        Q.normNum('971') === '971' && Q.normNum('') === '' && Q.normNum('x') === '');
  check('...a right code scores once', (() => {
    const s = Q.newSession(FR, { mode: 'fnum', zone: 'fr', difficulty: 'extreme', len: 10 }, 8);
    const q = Q.nextQuestion(s);
    const r = Q.answerNum(s, q, String(parseInt(q.answer.code, 10)));   /* no leading zero */
    return r && r.ok === true && s.score === 1 && Q.answerNum(s, q, q.answer.code) === null;
  })());
  check('...and a wrong one does not', (() => {
    const s = Q.newSession(FR, { mode: 'fnum', zone: 'fr', difficulty: 'extreme', len: 10 }, 8);
    const q = Q.nextQuestion(s);
    const wrong = q.answer.code === '01' ? '02' : '01';
    const r = Q.answerNum(s, q, wrong);
    return r && r.ok === false && s.score === 0 && r.correct === q.answer.code;
  })());
  check('...and an empty entry is not an answer at all',
        (() => {
          const s = Q.newSession(FR, { mode: 'fnum', zone: 'fr', difficulty: 'extreme', len: 10 }, 8);
          const q = Q.nextQuestion(s);
          return Q.answerNum(s, q, '') === null && q._done !== true;
        })());
  check('number -> name offers six names', (() => {
    const s = Q.newSession(FR, { mode: 'fname', zone: 'fr', difficulty: 'medium', len: 10 }, 8);
    const q = Q.nextQuestion(s);
    return q.options.every(o => o.name) && q.options[q.correct].code === q.answer.code;
  })());
  check('two départements can never be two options of the same question', (() => {
    for (let i = 0; i < 30; i++) {
      const s = Q.newSession(FR, { mode: 'fdept', zone: 'fr', difficulty: 'easy', len: 10 }, 300 + i);
      const q = Q.nextQuestion(s);
      if (new Set(q.options.map(o => o.code)).size !== 6) return false;
    }
    return true;
  })());
  /* the préfecture mode: the OPTIONS are the towns, and the distance rule runs on them */
  check('the préfecture mode offers préfectures, never the département', (() => {
    for (let i = 0; i < 30; i++) {
      const s = Q.newSession(FR, { mode: 'fpref', zone: 'fr', difficulty: 'medium', len: 10 }, 400 + i);
      const q = Q.nextQuestion(s);
      if (q.options.some(o => o.name === q.answer.pref)) return false;
      if (new Set(q.options.map(o => o.pref)).size !== 6) return false;
    }
    return true;
  })());
  /* ...on the METROPOLITAN answers: an overseas département's nearest neighbour really
     is 6 800 km away, and that is the data being right, not the band being wrong */
  let hardMax = 0;
  check('...and hard picks the NEAREST préfectures', (() => {
    const s = Q.newSession(FR, { mode: 'fpref', zone: 'fr-metro', difficulty: 'hard', len: 20 }, 12);
    let max = 0;
    for (let i = 0; i < 10; i++) {
      const q = Q.nextQuestion(s);
      if (!q) break;
      q.options.filter(o => o.pref !== q.answer.pref).forEach(o => {
        max = Math.max(max, Q.distanceKm({ lat: q.answer.prefLat, lon: q.answer.prefLon },
                                         { lat: o.prefLat, lon: o.prefLon }));
      });
    }
    hardMax = Math.round(max);
    return max < 400;           /* the fixture's préfectures are 0.5 deg apart */
  })(), hardMax + ' km');

  /* PLACE THE DÉPARTEMENT: no options at all, and the answer is a shape */
  check('a place question has no options and a code for an answer', (() => {
    const s = Q.newSession(FR, { mode: 'fplace', zone: 'fr', difficulty: 'medium', len: 10 }, 21);
    const q = Q.nextQuestion(s);
    return q.options.length === 0 && q.correct === -1 && !!q.answer.code;
  })());
  check('...and it is scored by the code, once', (() => {
    const s = Q.newSession(FR, { mode: 'fplace', zone: 'fr', difficulty: 'medium', len: 10 }, 21);
    const q = Q.nextQuestion(s);
    const right = Q.answerDept(s, q, q.answer.code);
    const again = Q.answerDept(s, q, '99');
    return right.ok === true && s.score === 1 && again === null;
  })());
  check('...and a code that is not the answer is wrong', (() => {
    const s = Q.newSession(FR, { mode: 'fplace', zone: 'fr', difficulty: 'medium', len: 10 }, 21);
    const q = Q.nextQuestion(s);
    const w = Q.answerDept(s, q, q.answer.code === '01' ? '02' : '01');
    return w.ok === false && s.score === 0 && w.correct === q.answer.code;
  })());
  check('a place round never asks the same département twice while others remain', (() => {
    /* "All" on the metropolitan zone: 13 départements, so 13 questions - and a length
       that is not one of 10/25/All falls back to 10 (that is newSession's own rule) */
    const s = Q.newSession(FR, { mode: 'fplace', zone: 'fr-metro', difficulty: 'medium', len: 0 }, 3);
    const seen = {}, order = [];
    let q;
    while ((q = Q.nextQuestion(s))) { seen[q.answer.code] = (seen[q.answer.code] || 0) + 1; order.push(q.answer.code); }
    return order.length === 13 && order.every(c => seen[c] === 1);
  })());

  /* THE SCORE SCALE IS THE SESSION'S */
  check("a France session scores on France distances, a world one on the world's",
        (() => {
          const f = Q.newSession(FR, { mode: 'floc', zone: 'fr', difficulty: 'easy', len: 5 }, 2);
          const w = Q.newSession(ALL, { mode: 'locate', zone: 'world', difficulty: 'easy', len: 5 }, 2);
          return f.cfg.scoreKm === Q.SCORE_KM_FR && w.cfg.scoreKm === Q.SCORE_KM &&
                 Q.SCORE_KM_FR < Q.SCORE_KM;
        })());
  check('the points curve takes the scale as an argument', (() => {
    return Q.pointsFor(25, Q.SCORE_KM_FR) === 812 &&
           Q.pointsFor(120, Q.SCORE_KM_FR) === 368 &&
           Q.pointsFor(25) === Q.pointsFor(25, Q.SCORE_KM) &&
           Q.pointsFor(25, 0) === Q.pointsFor(25);
  })(), Q.pointsFor(25, Q.SCORE_KM_FR) + ' / ' + Q.pointsFor(120, Q.SCORE_KM_FR));

  /* a France config cannot carry a world zone, and the other way round */
  check('a world zone in a France mode falls back to all of France',
        Q.newSession(FR, { mode: 'fnum', zone: 'europe', difficulty: 'medium', len: 10 }, 1).cfg.zone === 'fr');
  check('a France zone in a world mode falls back to the world',
        Q.newSession(ALL, { mode: 'country', zone: 'fr', difficulty: 'medium', len: 10 }, 1).cfg.zone === 'world');
  /* the SCOPE follows the MODE: a world id makes a world session (and takes the world
     zone list with it), so a config can never be half in each */
  check('a world mode id makes a world session, whatever the zone says',
        (() => {
          const w = Q.newSession(FR, { mode: 'country', zone: 'fr', difficulty: 'medium', len: 10 }, 1);
          return w.cfg.mode === 'country' && w.cfg.zone === 'world' && w.cfg.scoreKm === Q.SCORE_KM;
        })());
  check("...and an id from NEITHER list falls back to that scope's first",
        Q.newSession(FR, { mode: 'nonsense', zone: 'fr', difficulty: 'medium', len: 10 }, 1).cfg.mode === 'country');
  check('locate has no flag variant, in France too',
        Q.newSession(FR, { mode: 'floc', zone: 'fr', difficulty: 'medium', len: 5, variant: 'flags' }, 1).cfg.variant === null);

  /* the city bands are populations, absolute, and a zone is topped up to six */
  /* ten of each band, so no band has to be topped up here - the top-up is its own
     check below, on a zone that cannot fill its band */
  const CITIES = [];
  for (let i = 0; i < 40; i++) {
    CITIES.push({ id: 'v' + i, name: 'Ville ' + i, lat: 45 + i * 0.05, lon: 1 + i * 0.05,
                  pop: i < 10 ? 500000 : i < 20 ? 50000 : i < 30 ? 15000 : 5000,
                  pref: i === 25 ? 1 : 0, reg: i < 8 ? '11' : '24', dom: 0, country: 'D01' });
  }
  check('the France bands are population thresholds, absolute',
        Q.frCityPool(CITIES, 'fr', 'easy').every(c => c.pop >= 100000) &&
        Q.frCityPool(CITIES, 'fr', 'medium').length > Q.frCityPool(CITIES, 'fr', 'easy').length &&
        Q.frCityPool(CITIES, 'fr', 'hard').length > Q.frCityPool(CITIES, 'fr', 'medium').length);
  /* a préfecture of 15 000 people is a MEDIUM question (the 30 000 threshold, one band
     early), and it is NOT an easy one - the allowance is one band, not a free pass */
  check('a préfecture is admitted a band early',
        Q.frCityPool(CITIES, 'fr', 'medium').some(c => c.name === 'Ville 25') &&
        !Q.frCityPool(CITIES, 'fr', 'easy').some(c => c.name === 'Ville 25'),
        'med ' + Q.frCityPool(CITIES, 'fr', 'medium').length +
        ' / easy ' + Q.frCityPool(CITIES, 'fr', 'easy').map(c => c.name + ':' + c.pop).join(' '));
  /* the top-up: a zone with fewer than six in its band takes its biggest towns, so a
     round about Corse or Mayotte is a round and not an empty screen */
  check('a zone too small for its band is topped up to six',
        Q.frCityPool(CITIES, 'r24', 'easy').length === 6,
        Q.frCityPool(CITIES, 'r24', 'easy').length);
  check('...and every one of them is in the zone',
        Q.frCityPool(CITIES, 'r24', 'easy').every(c => c.reg === '24'));
  check('...with the zone\'s biggest first, not a random six',
        Q.frCityPool(CITIES, 'r24', 'easy').map(c => c.pop).join(',') === '500000,500000,50000,50000,50000,50000',
        Q.frCityPool(CITIES, 'r24', 'easy').map(c => c.pop).join(','));
})();

console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);

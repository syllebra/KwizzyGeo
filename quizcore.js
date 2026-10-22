/* KwizzyGeo quiz: the brain, and nothing else.
   Pure functions, no DOM, no data loading - exactly like core.js. The UI (quiz.js)
   feeds it the item list it built from the map's own layers; the node tests feed it
   fixtures or the real data files. That split is what makes the rules below
   checkable: "six options, always" and "easy = far, hard = neighbours" are
   properties of this file alone.

   THREE MODES
     country - a country is lit up on the map, the six options are country names;
     capital - the country is named and lit up, the options are its capital cities;
     flag    - a flag is shown, the options are country names.
   ONE LENGTH: six options, always (N_OPT).

   DIFFICULTY is the DISTANCE of the wrong answers, measured between the two places
   the options themselves name:
     easy   - from the far half of the pool (a wrong answer that is obviously wrong);
     medium - anywhere (no constraint);
     hard   - from the nearest few per cent (neighbours: the shapes, flags and
              capitals a player actually confuses).
   "The place an option names" is the country's Natural Earth LABEL point, or, in
   capital mode, the CAPITAL's own coordinates: two capitals 200 km apart (Lomé and
   Cotonou) are what a player confuses, not two country centroids. */
(function () {
'use strict';

var N_OPT = 6;
var R_KM = 6371.0088;

var MODES = [
  { id: 'country', label: 'Find the country', sub: 'A country is lit up: name it.', ico: '\u25C9' },
  { id: 'capital', label: 'Find the capital', sub: 'Pick the capital city.', ico: '\u2605' },
  { id: 'flag',    label: 'Find the flag',    sub: 'a flag, or the country of a flag', ico: '\u2691' }
];

/* The zone list is the CONTINENT vocabulary of the layers, minus the two that are
   not a zone. A country whose CONTINENT is "Seven seas (open ocean)" - Seychelles,
   Mauritius, Maldives in the 50m sovereignty layer - gets its zone from SUBREGION
   instead (see zoneOf), so the island nations are reachable at all. */
var ZONES = [
  { id: 'world',         label: 'World',         cont: null },
  { id: 'africa',        label: 'Africa',        cont: 'Africa' },
  { id: 'asia',          label: 'Asia',          cont: 'Asia' },
  { id: 'europe',        label: 'Europe',        cont: 'Europe' },
  { id: 'north-america', label: 'North America', cont: 'North America' },
  { id: 'south-america', label: 'South America', cont: 'South America' },
  { id: 'oceania',       label: 'Oceania',       cont: 'Oceania' }
];

/* FLAG MODE HAS TWO HALVES, and they are the same question read from the two ends:
   the flag is given and the country must be named, or the country is named (and lit
   up on the map, with its capital) and the flag must be picked. The options follow
   the question, so one shows six country names and the other six flags. */
var FLAG_ASK = [
  { id: 'name',  label: 'Flag \u2192 country', sub: 'a flag is shown: name the country' },
  { id: 'flags', label: 'Country \u2192 flag', sub: 'a country is named: pick its flag' }
];

/* HOW LONG A ROUND IS. 0 means "All": every country of the pool, once - the whole
   zone, which is a real game for a continent (Africa is 54 questions) and a long one
   for the world (195). A session never asks more questions than its pool holds,
   whatever is asked for. */
var LENS = [
  { id: 10, label: '10',  sub: 'a short round' },
  { id: 25, label: '25',  sub: 'a long round' },
  { id: 0,  label: 'All', sub: 'every country of the zone, once' }
];

var DIFFS = [
  { id: 'easy',   label: 'Easy',   sub: 'the wrong answers are far away' },
  { id: 'medium', label: 'Normal', sub: 'the wrong answers come from anywhere' },
  { id: 'hard',   label: 'Hard',   sub: 'the wrong answers are neighbours' }
];

var SUB_ZONE = {
  'Eastern Africa': 'Africa', 'Western Africa': 'Africa', 'Middle Africa': 'Africa',
  'Southern Africa': 'Africa', 'Northern Africa': 'Africa',
  'Western Asia': 'Asia', 'Southern Asia': 'Asia', 'Eastern Asia': 'Asia',
  'South-Eastern Asia': 'Asia', 'Central Asia': 'Asia',
  'Northern Europe': 'Europe', 'Southern Europe': 'Europe', 'Eastern Europe': 'Europe',
  'Western Europe': 'Europe',
  'Caribbean': 'North America', 'Central America': 'North America',
  'Northern America': 'North America',
  'South America': 'South America',
  'Micronesia': 'Oceania', 'Melanesia': 'Oceania', 'Polynesia': 'Oceania',
  'Australia and New Zealand': 'Oceania'
};

/* ---------- small utilities ---------- */
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function byId(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
/* mulberry32: a seeded generator, so a session's questions can be reproduced in a
   test (the UI seeds from the clock, the tests from a constant) */
function rng(seed) {
  var a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, r) {
  var out = list.slice(0), i, j, t;
  for (i = out.length - 1; i > 0; i--) {
    j = Math.floor(r() * (i + 1));
    t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}
function distanceKm(a, b) {
  var dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  var la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- items -> pools ---------- */
/* An ITEM is what quiz.js builds from one map feature:
   { id, idx, name, nameEn, cont, sub, lat, lon, cap, capLat, capLon, flag }
   `id` is the stable key (Natural Earth NE_ID), `idx` the feature index in the
   layer being drawn. Nothing here reads `idx`: the index belongs to the layer. */
function zoneOf(it) {
  var c = it.cont;
  if (!c) return SUB_ZONE[it.sub] || null;
  for (var i = 0; i < ZONES.length; i++) if (ZONES[i].cont === c) return c;
  return SUB_ZONE[it.sub] || null;
}
function pointOf(it, mode) {
  if (mode === 'capital' && it.capLat != null && it.capLon != null) {
    return { lat: it.capLat, lon: it.capLon };
  }
  return { lat: it.lat, lon: it.lon };
}
/* the KEY of an option: what makes two options "the same answer". In capital mode
   it is the capital's name - the country does not appear on the button. */
function keyOf(it, mode) {
  return norm(mode === 'capital' ? it.cap : it.name);
}

function usable(it, mode) {
  if (!it || !norm(it.name)) return false;
  if (it.lat == null || it.lon == null || !isFinite(it.lat) || !isFinite(it.lon)) return false;
  if (mode === 'capital' && (!norm(it.cap) || it.capLat == null || it.capLon == null)) return false;
  if (mode === 'flag' && !norm(it.flag)) return false;
  return true;
}

/* The pool for a zone and a mode. One entry per COUNTRY NAME: two features sharing
   a name would be two right answers, which no multiple-choice question can carry.
   (Capitals and flags are not deduplicated here - two countries may share a capital
   name or a flag, and each of them makes a perfectly good question; it is the
   OPTIONS that must be distinct, and question() enforces that.) */
function poolFor(items, zone, mode) {
  var z = byId(ZONES, zone) || ZONES[0];
  var out = [], seen = {}, i, it, k;
  for (i = 0; i < (items || []).length; i++) {
    it = items[i];
    if (!usable(it, mode)) continue;
    if (z.cont && zoneOf(it) !== z.cont) continue;
    k = norm(it.name);
    if (seen[k]) continue;
    seen[k] = 1;
    out.push(it);
  }
  return out;
}

/* ---------- the distractors ---------- */
/* cands: [{it, d}] sorted by distance. The band is a SLICE of that order, so
   "easy" can only ever offer far countries and "hard" only near ones; the choice
   inside the band is random, so the same country does not always come with the
   same five neighbours. */
function pickDistractors(cands, need, difficulty, r) {
  var n = cands.length;
  var band;
  if (difficulty === 'hard') {
    /* the nearest 12 % - a country has 1-14 neighbours, and 12 % of the world is
       ~23, so a hard question is genuinely regional but never repeats the same 5 */
    band = cands.slice(0, Math.max(need, Math.min(n, Math.ceil(n * 0.12))));
  } else if (difficulty === 'easy') {
    /* the farthest 35 % - big enough that two easy questions rarely share all six */
    band = cands.slice(Math.max(0, n - Math.max(need * 3, Math.ceil(n * 0.35))));
  } else {
    band = cands.slice(0);
  }
  var pick = shuffle(band, r).slice(0, need);
  if (pick.length < need) {
    /* a narrow zone can have fewer than `need` candidates in the band (Oceania at
       hard); the remainder comes from the rest, nearest-first, so the question is
       still six options instead of a crash */
    var taken = {}, i;
    for (i = 0; i < pick.length; i++) taken[pick[i].it.id] = 1;
    for (i = 0; i < cands.length && pick.length < need; i++) {
      if (!taken[cands[i].it.id]) { taken[cands[i].it.id] = 1; pick.push(cands[i]); }
    }
  }
  return pick;
}

/* ---------- one question ---------- */
function question(sess, r) {
  var pool = sess.pool, cfg = sess.cfg, mode = cfg.mode;
  if (pool.length < N_OPT) return null;
  var i, it, free = [];
  for (i = 0; i < pool.length; i++) if (!sess.used[pool[i].id]) free.push(pool[i]);
  if (!free.length) {                       /* every country asked: start over */
    sess.used = {};
    free = pool.slice(0);
  }
  var answer = free[Math.floor(r() * free.length)];
  sess.used[answer.id] = 1;

  var aPoint = pointOf(answer, mode), aKey = keyOf(answer, mode);
  var seen = {}, cands = [];
  seen[aKey] = 1;
  for (i = 0; i < pool.length; i++) {
    it = pool[i];
    if (it.id === answer.id) continue;
    var k = keyOf(it, mode);
    if (!k || seen[k]) continue;             /* the same name twice on screen is a bug */
    if (mode === 'flag' && norm(it.flag) === norm(answer.flag)) continue;
    seen[k] = 1;
    cands.push({ it: it, d: distanceKm(aPoint, pointOf(it, mode)) });
  }
  if (cands.length < N_OPT - 1) return null;
  cands.sort(function (a, b) { return a.d - b.d; });

  var picks = pickDistractors(cands, N_OPT - 1, cfg.difficulty, r);
  var mixed = shuffle(picks.concat([{ it: answer, d: 0 }]), r);
  var options = [], correct = -1;
  for (i = 0; i < mixed.length; i++) {
    options.push(mixed[i].it);
    if (mixed[i].it.id === answer.id) correct = i;
  }
  return {
    mode: mode, zone: cfg.zone, difficulty: cfg.difficulty,
    variant: cfg.variant || null,
    answer: answer, options: options, correct: correct,
    /* the share of wrong answers that sit in the intended distance band - what the
       tests assert on, and what the difficulty really means */
    spread: picks.length ? Math.round(picks[picks.length - 1].d) : 0,
    near: picks.length ? Math.round(picks[0].d) : 0
  };
}

/* ---------- a session ---------- */
/* cfg: {mode, zone, difficulty, len, variant}. `items` is the whole item list; the pool
   is derived ONCE, so a session cannot change its own rules halfway - and the length is
   resolved against that pool, so "All" on a six-country zone is six questions and "25"
   on the same zone is six too, not twenty-five with repeats. */
function newSession(items, cfg, seed) {
  var c = {
    mode: (byId(MODES, cfg.mode) || MODES[0]).id,
    zone: (byId(ZONES, cfg.zone) || ZONES[0]).id,
    difficulty: (byId(DIFFS, cfg.difficulty) || DIFFS[1]).id,
    len: 10,
    lenWanted: 10,
    /* only meaningful in flag mode; null elsewhere so a session cannot carry a
       setting that does not apply to it */
    variant: null
  };
  if (c.mode === 'flag') c.variant = (byId(FLAG_ASK, cfg.variant) || FLAG_ASK[0]).id;
  var pool = poolFor(items, c.zone, c.mode);
  var want = (cfg.len === 0 || cfg.len === 'all' || cfg.len === 'All') ? 0 : (cfg.len | 0);
  if (!want) want = pool.length;
  c.lenWanted = want;
  c.len = Math.max(1, Math.min(want, pool.length || want, 500));
  return {
    cfg: c, pool: pool,
    used: {}, i: 0, score: 0, asked: [],
    rnd: rng(seed == null ? (Date.now() & 0x7fffffff) : seed)
  };
}
function nextQuestion(sess) {
  if (!sess || sess.i >= sess.cfg.len) return null;
  var q = question(sess, sess.rnd);
  if (!q) return null;
  sess.i++;
  sess.asked.push(q);
  return q;
}
/* One answer, once: the UI disables the buttons, but the rule lives here too so a
   double tap on a touch screen can never score twice. */
function answerQuestion(sess, q, chosen) {
  if (!q || q._done) return null;
  q._done = true;
  q.chosen = chosen;
  q.ok = (chosen === q.correct);
  if (q.ok) sess.score++;
  return { ok: q.ok, correct: q.correct };
}

var QUIZCORE = {
  N_OPT: N_OPT, MODES: MODES, ZONES: ZONES, DIFFS: DIFFS, FLAG_ASK: FLAG_ASK, LENS: LENS,
  zoneOf: zoneOf, poolFor: poolFor, distanceKm: distanceKm,
  newSession: newSession, nextQuestion: nextQuestion, answerQuestion: answerQuestion,
  /* exposed for the tests, and for nothing else */
  _rng: rng, _shuffle: shuffle, _question: question, _keyOf: keyOf
};

if (typeof window !== 'undefined') window.QuizCore = QUIZCORE;
if (typeof module !== 'undefined' && module.exports) module.exports = QUIZCORE;
})();

/* KwizzyGeo quiz: the brain, and nothing else.
   Pure functions, no DOM, no data loading - exactly like core.js. The UI (quiz.js)
   feeds it the item list it built from the map's own layers; the node tests feed it
   fixtures or the real data files. That split is what makes the rules below
   checkable: "six options, always" and "easy = far, hard = neighbours" are
   properties of this file alone.

   FOUR MODES
     country - a country is lit up on the map, the six options are country names;
     capital - the country is named and lit up, the options are its capital cities;
     flag    - a flag is shown, the options are country names;
     locate  - a CITY is named and the player puts a marker on the map. There are no
               options at all: the answer is a geographic point, and what it scores is
               the DISTANCE between that point and the real one (see answerPoint).

   "Six options, always" (N_OPT) is a property of the three multiple-choice modes. Locate
   is the fourth mode precisely because it cannot be one of them: its answer is a place
   on the map, and its verdict is a number of kilometres.

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
  { id: 'flag',    label: 'Find the flag',    sub: 'a flag, or the country of a flag', ico: '\u2691' },
  { id: 'locate',  label: 'Locate the city',  sub: 'a city is named: put it on the map', ico: '\u25CE' }
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

/* A LOCATE ROUND IS SHORTER, and "All" is not an option there: the pool is every city
   of a zone (thousands in the world), and each question costs a pan, a zoom and a
   decision rather than a tap. 5 / 10 / 25 - a round of 25 cities is already a long
   session when you have to find each one. */
var LENS_LOCATE = [
  { id: 5,  label: '5',  sub: 'a short round' },
  { id: 10, label: '10', sub: 'a round' },
  { id: 25, label: '25', sub: 'a long round' }
];
function lensOf(mode) { return mode === 'locate' ? LENS_LOCATE : LENS; }

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

/* ---------- LOCATE: the city pool, and how hard a city is ----------
   A locate ITEM is a city, built by quiz.js from the map's own places layer:
   { id:'p<index>', idx, name, lat, lon, pop, z (min_zoom), cap (ADM0CAP 0/1), cont, sub, country }

   DIFFICULTY IS FAME, and the first build used POPULATION for it. That is a bad proxy and
   a player notices: Duisburg has 1.3 million people and nobody outside Germany could place
   it, while Bern has 275 000 and everyone can. What actually encodes fame here is Natural
   Earth's own MIN_ZOOM - the zoom at which a map starts showing the city's name - because
   that is a cartographer's judgement about how much of the world knows the place:
   Paris/Tokyo/New York are at 1.7, a country's big cities at 4-5, regional centres at 6,
   small towns at 7-9. So the bands are thresholds on min_zoom:

     easy   - z <= 5.0 AND (250 000 people or a national capital): a name a world map shows;
     medium - z <= 6.1: a regional centre;
     hard   - z <= 7.0: a smaller town.

   Two floors, both measured against what a question can fairly ask:
     * nothing ABOVE 7.0 at any difficulty - the 8-9 tail is the towns only a regional map
       names (Eger, Tatabánya, Wum), and asking about them is not a hard question but a
       lottery. That tail is most of what made Hard feel unfair;
     * nothing below 40 000 people unless it is a capital (Vaduz, Monaco, Vatican City).
   The 250 000 condition on Easy is what removes the second artifact of min_zoom: an
   ISOLATED speck gets a low zoom because a map must label something in the emptiness
   (Abéché, Atar, Honiara, Alice Springs, Arctic Bay were all "easy"), and a population
   floor is what tells those apart from Kathmandu.

   Measured on the shipped data: world pools 448 easy / 1 957 medium / 2 013 hard, spread
   over 165 / 179 / 154 countries. */
var CITY_Z = { easy: 5.0, medium: 6.1, hard: 7.0 };
var EASY_MIN_POP = 250000;
var ASK_MIN_POP = 40000;         /* below this, only a capital is asked */
var BULLSEYE_KM = 25;            /* "you found it" - the dot on the score screen */
var POINTS_MAX = 1000;           /* per question; a round is n x 1000 */
var SCORE_KM = 1500;             /* the distance that costs 63 % of the points */

function cityBand(it) {
  if (!it) return null;
  var p = it.pop, z = it.z;
  if (z == null || !isFinite(z)) return null;
  if (z > CITY_Z.hard) return null;                        /* a town, not a question */
  if ((p == null || !isFinite(p) || p < ASK_MIN_POP) && !it.cap) return null;
  if (z <= CITY_Z.easy && (it.cap || (p != null && p >= EASY_MIN_POP))) return 'easy';
  if (z <= CITY_Z.medium) return 'medium';
  return 'hard';
}
/* the cities a round can ask about: the zone's, in the difficulty's band */
function cityPool(items, zone, difficulty) {
  var z = byId(ZONES, zone) || ZONES[0];
  var band = byId(DIFFS, difficulty) ? difficulty : 'medium';
  var out = [], seen = {}, i, it, k;
  for (i = 0; i < (items || []).length; i++) {
    it = items[i];
    if (!it || !norm(it.name)) continue;
    if (it.lat == null || it.lon == null || !isFinite(it.lat) || !isFinite(it.lon)) continue;
    if (cityBand(it) !== band) continue;
    if (z.cont && zoneOf(it) !== z.cont) continue;
    k = norm(it.name) + '|' + it.lat.toFixed(2) + ',' + it.lon.toFixed(2);
    if (seen[k]) continue;               /* the same name at the same place, twice */
    seen[k] = 1;
    out.push(it);
  }
  return out;
}
/* THE SCORE OF ONE ANSWER. Points fall off with the distance: a bullseye is the full
   1000, 100 km is 936, 500 km 717, 1 000 km 513, 2 000 km 264, 5 000 km 36. The curve
   is exponential because a mistake's cost is proportional to the scale you were
   already working at: being 200 km off is nothing in Siberia and a lot in Belgium. */
function pointsFor(km) {
  if (!isFinite(km) || km < 0) return 0;
  return Math.round(POINTS_MAX * Math.exp(-km / SCORE_KM));
}

/* ---------- HOW A CITY IS CHOSEN: COUNTRY FIRST, THEN CITY ----------
   Drawing uniformly from the CITIES is what the first build did, and it is wrong in a way
   a player notices at once: a city question is really a question about a country's
   geography, but the pool is not spread over countries - it is spread over cities, and
   cities are wildly uneven. Measured on the shipped data, the easy band is 602 cities in
   198 countries, and CHINA ALONE IS 18.6 % of it (the USA 8.4 %, India 7.9 %): one easy
   question in five was Chinese, and a ten-question round named 8 distinct countries, not
   ten.

   So the draw is two-stage, as the player expects: a COUNTRY, then a city inside it.

   The country's weight is `cities^COUNTRY_WEIGHT`, and that one exponent is the whole
   design decision:
     * 1.0 = today's behaviour (proportional to cities) - China 18.6 %, USA 8.4 %;
     * 0.0 = every country strictly equal - China 0.6 %, a micro-state exactly as likely
       as China, so "Easy" becomes "the capital of some random small country" and the big
       countries nearly vanish;
     * 0.5 (the default) = in between, and the one that reads right: measured, China is
       3.5 %, the USA 2.5 %, India 2.3 %, and the round names TEN distinct countries out
       of ten.
   A country is never asked twice in a round while there is an unasked one left, which is
   the rule the three multiple-choice modes already keep for their answers. */
var COUNTRY_WEIGHT = 0.5;
function citiesByCountry(pool) {
  var by = {}, order = [], i, k;
  for (i = 0; i < pool.length; i++) {
    k = pool[i].country || '';
    if (!k) k = '\u0000' + pool[i].id;        /* a city with no country stands alone */
    if (!by[k]) { by[k] = []; order.push(k); }
    by[k].push(pool[i]);
  }
  return { by: by, order: order };
}
/* one locate question: a country nobody has been asked yet this round, then a city of it,
   by its share of the band */
function cityQuestion(sess, r) {
  if (!sess.pool.length) return null;       /* an empty zone has no question to ask */
  if (!sess.byCountry) sess.byCountry = citiesByCountry(sess.pool);
  var by = sess.byCountry.by, order = sess.byCountry.order, i, k;
  /* the countries that still have a city to ask */
  var freeC = [], allC = [];
  for (i = 0; i < order.length; i++) {
    k = order[i];
    var un = [];
    for (var j = 0; j < by[k].length; j++) if (!sess.used[by[k][j].id]) un.push(by[k][j]);
    if (!un.length) continue;
    allC.push(k);
    if (!sess.usedCountry[k]) freeC.push(k);
  }
  if (!allC.length) {                        /* every city asked: start the zone over */
    sess.used = {}; sess.usedCountry = {};
    return cityQuestion(sess, r);
  }
  /* prefer a country this round has not named; fall back to any that still has a city */
  var cands = freeC.length ? freeC : allC;
  var pick = cands[0], weights = [], total = 0;
  if (COUNTRY_WEIGHT === 0) {
    pick = cands[Math.floor(r() * cands.length)];
  } else {
    for (i = 0; i < cands.length; i++) {
      var w = Math.pow(by[cands[i]].length, COUNTRY_WEIGHT);
      weights.push(w); total += w;
    }
    var t = r() * total;
    for (i = 0; i < cands.length; i++) { pick = cands[i]; if ((t -= weights[i]) <= 0) break; }
  }
  sess.usedCountry[pick] = 1;
  /* then a city of it, uniformly among the ones not asked yet */
  var free = [];
  for (i = 0; i < by[pick].length; i++) if (!sess.used[by[pick][i].id]) free.push(by[pick][i]);
  var answer = free[Math.floor(r() * free.length)] || by[pick][0];
  sess.used[answer.id] = 1;
  return {
    mode: 'locate', zone: sess.cfg.zone, difficulty: sess.cfg.difficulty,
    variant: null, answer: answer, options: [], correct: -1
  };
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
  if (c.mode === 'locate') c.variant = null;
  var pool = (c.mode === 'locate')
    ? cityPool(items, c.zone, c.difficulty)
    : poolFor(items, c.zone, c.mode);
  /* THE LENGTH IS RESOLVED AGAINST THIS MODE'S OWN LIST: a stored 10 (a country round)
     is not a length locate offers, and "All" is not one of its choices at all. An
     unknown or absent choice falls back to the list's first entry, so a config carried
     from one mode to another can never start a round the player did not ask for. */
  var lens = lensOf(c.mode), want = null, i;
  for (i = 0; i < lens.length; i++) {
    if (cfg.len === lens[i].id || String(cfg.len) === String(lens[i].id)) want = lens[i].id;
  }
  if (want == null) want = lens[0].id;
  if (want === 0) want = pool.length;          /* "All" = the zone's whole pool */
  c.lenWanted = want;
  /* THE ROUND IS CAPPED BY ITS CITIES, not by its countries. "One country per question" is
     a PREFERENCE in cityQuestion, not a limit on the round: capping at the country count
     turned a 25-question round of Oceania/medium into TWO questions (6 cities, 2
     countries), when the honest round there is six cities in two countries. */
  c.len = Math.max(1, Math.min(want, pool.length || want, 500));
  return {
    cfg: c, pool: pool,
    used: {}, usedCountry: {}, byCountry: null, i: 0, score: 0, points: 0, km: 0, asked: [],
    rnd: rng(seed == null ? (Date.now() & 0x7fffffff) : seed)
  };
}
function nextQuestion(sess) {
  if (!sess || sess.i >= sess.cfg.len) return null;
  var q = (sess.cfg.mode === 'locate') ? cityQuestion(sess, sess.rnd) : question(sess, sess.rnd);
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

/* ONE ANSWER, GIVEN AS A POINT: the locate mode's verdict. `guess` is {lat, lon} - what
   the player pointed at. The rule lives here, next to the score curve, so the UI cannot
   disagree with the tests about what a kilometre is worth. */
function answerPoint(sess, q, guess) {
  if (!q || q._done) return null;
  if (!guess || !isFinite(guess.lat) || !isFinite(guess.lon)) return null;
  q._done = true;
  q.guess = { lat: guess.lat, lon: guess.lon };
  q.km = distanceKm({ lat: q.answer.lat, lon: q.answer.lon }, q.guess);
  q.points = pointsFor(q.km);
  q.ok = q.km <= BULLSEYE_KM;
  sess.points = (sess.points || 0) + q.points;
  sess.km = (sess.km || 0) + q.km;
  if (q.ok) sess.score++;
  return { ok: q.ok, km: q.km, points: q.points };
}

var QUIZCORE = {
  N_OPT: N_OPT, MODES: MODES, ZONES: ZONES, DIFFS: DIFFS, FLAG_ASK: FLAG_ASK, LENS: LENS,
  LENS_LOCATE: LENS_LOCATE, lensOf: lensOf,
  BULLSEYE_KM: BULLSEYE_KM, POINTS_MAX: POINTS_MAX, SCORE_KM: SCORE_KM,
  CITY_Z: CITY_Z, EASY_MIN_POP: EASY_MIN_POP, ASK_MIN_POP: ASK_MIN_POP,
  COUNTRY_WEIGHT: COUNTRY_WEIGHT, citiesByCountry: citiesByCountry,
  zoneOf: zoneOf, poolFor: poolFor, distanceKm: distanceKm,
  cityBand: cityBand, cityPool: cityPool, pointsFor: pointsFor,
  newSession: newSession, nextQuestion: nextQuestion, answerQuestion: answerQuestion,
  answerPoint: answerPoint,
  /* exposed for the tests, and for nothing else */
  _rng: rng, _shuffle: shuffle, _question: question, _keyOf: keyOf
};

if (typeof window !== 'undefined') window.QuizCore = QUIZCORE;
if (typeof module !== 'undefined' && module.exports) module.exports = QUIZCORE;
})();

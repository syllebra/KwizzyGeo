/* KwizzyGeo stats: everything the player has answered, kept in localStorage.
   Pure state and no DOM - like quizcore.js - so the rules are checkable in node and the
   screens only render what this returns.

   WHAT IS KEPT (key `kwizzygeo.stats.v1`, separate from the settings key and from the
   quiz's own config key, so resetting one never wipes another):

     asked, correct      counters over every question ever answered
     streak, bestStreak  the current run of right answers, and the longest ever
     runs[]              the last MAX_RUNS finished rounds: {t, mode, zone, difficulty,
                         variant, len, score}
     byCfg{}             per mode|zone|difficulty|variant: {played, asked, correct,
                         best, bestLen, last} - `best` is compared by RATIO, so a 25/25
                         beats a 10/10 and a 9/10 beats a 4/5
     byMode{}, byZone{}  the same counters grouped one level coarser (the stats sheet's
                         two tables)
     byCountry{}         per country: {n: name, a: asked, c: correct} - which places this
                         player actually knows and which ones are always wrong
     first, last         timestamps, in ms

   The country map is the only part that grows with the map (195 entries, ~12 kB), and
   it is the interesting part: "you have never been asked about Chad" and "you miss
   Kazakhstan every time" are the two things a player wants from their own record. */
(function () {
'use strict';

var LS = 'kwizzygeo.stats.v1';
var V = 1;
var MAX_RUNS = 60;         /* the last 60 rounds, newest first */
var MAX_COUNTRIES = 400;   /* a guard against a corrupt blob, not a real limit */

function now() { return Date.now(); }

function blank() {
  return {
    v: V, asked: 0, correct: 0, streak: 0, bestStreak: 0,
    runs: [], byCfg: {}, byMode: {}, byZone: {}, byCountry: {},
    first: 0, last: 0
  };
}

/* A stored blob is trusted only as far as it is well formed: every field is
   re-checked, because a half-written or hand-edited value must load as a working
   (possibly empty) record rather than as NaN in a percentage. */
function sane(o) {
  var s = blank();
  if (!o || typeof o !== 'object') return s;
  function n(v) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0; }
  s.asked = n(o.asked);
  s.correct = Math.min(s.asked, n(o.correct));
  s.streak = n(o.streak);
  s.bestStreak = Math.max(n(o.bestStreak), s.streak);
  s.first = n(o.first); s.last = n(o.last);
  function bucket(b) {
    var out = {};
    if (!b || typeof b !== 'object') return out;
    for (var k in b) {
      if (!b.hasOwnProperty(k)) continue;
      var v = b[k];
      if (!v || typeof v !== 'object') continue;
      out[k] = {
        played: n(v.played), asked: n(v.asked), correct: Math.min(n(v.asked), n(v.correct)),
        best: n(v.best), bestLen: n(v.bestLen), last: n(v.last)
      };
    }
    return out;
  }
  s.byCfg = bucket(o.byCfg);
  s.byMode = bucket(o.byMode);
  s.byZone = bucket(o.byZone);
  if (o.byCountry && typeof o.byCountry === 'object') {
    var c = 0;
    for (var id in o.byCountry) {
      if (!o.byCountry.hasOwnProperty(id)) continue;
      if (++c > MAX_COUNTRIES) break;
      var e = o.byCountry[id];
      if (!e || typeof e !== 'object') continue;
      s.byCountry[id] = { n: String(e.n == null ? '' : e.n), f: String(e.f == null ? '' : e.f),
                          a: n(e.a), c: Math.min(n(e.a), n(e.c)) };
    }
  }
  if (o.runs && o.runs.length) {
    for (var i = 0; i < o.runs.length && s.runs.length < MAX_RUNS; i++) {
      var r = o.runs[i];
      if (!r || typeof r !== 'object') continue;
      s.runs.push({
        t: n(r.t), mode: String(r.mode || ''), zone: String(r.zone || ''),
        difficulty: String(r.difficulty || ''), variant: r.variant || null,
        len: n(r.len), score: n(r.score)
      });
    }
  }
  return s;
}

function load() {
  try {
    var raw = window.localStorage.getItem(LS);
    return sane(raw ? JSON.parse(raw) : null);
  } catch (e) { return blank(); }
}
function save(s) {
  s.last = now();
  if (!s.first) s.first = s.last;
  try { window.localStorage.setItem(LS, JSON.stringify(s)); return true; }
  catch (e) { return false; }        /* private mode / quota: the game goes on */
}

/* the key of one question's rules. The flag mode's two halves are asked differently
   enough that their scores must not be mixed. */
function cfgKey(c) {
  if (!c) return '';
  return [c.mode || '', c.zone || '', c.difficulty || '',
          (c.mode === 'flag' ? (c.variant || 'name') : '-')].join('|');
}

/* one row of a grouping table, by its own key: `byMode` is keyed by the mode id and
   `byZone` by the zone id (NOT by cfgKey, which would make every mode row read
   "capital|||-") */
function bump(b, key) {
  if (!key) return null;
  var e = b[key] || (b[key] = { played: 0, asked: 0, correct: 0, best: 0, bestLen: 0, last: 0 });
  e.last = now();
  return e;
}

/* One ANSWER. Returns the object that was saved, so a test can read it back without
   going through localStorage. */
function answer(q, ok, item) {
  var s = load();
  s.asked++;
  if (ok) { s.correct++; s.streak++; if (s.streak > s.bestStreak) s.bestStreak = s.streak; }
  else s.streak = 0;
  var cfg = { mode: q && q.mode, zone: q && q.zone, difficulty: q && q.difficulty,
              variant: q && q.variant };
  [bump(s.byCfg, cfgKey(cfg)), bump(s.byMode, cfg.mode), bump(s.byZone, cfg.zone)]
    .forEach(function (e) { if (e) { e.asked++; if (ok) e.correct++; } });
  if (item && item.id) {
    var c = s.byCountry[item.id] || (s.byCountry[item.id] = { n: item.name || '', f: '', a: 0, c: 0 });
    c.n = item.name || c.n;
    c.f = item.flag || c.f;            /* two letters: the stats sheet draws the flag */
    c.a++; if (ok) c.c++;
  }
  save(s);
  return s;
}

/* A finished ROUND: the score, and the best-of-that-config if it beats it.
   `best` is compared by ratio first (25/25 > 10/10 > 9/10), then by score, so a short
   round can never hide a long one's result. */
function endRun(session) {
  if (!session || !session.cfg) return null;
  var c = session.cfg;
  var score = session.score || 0;
  var len = session.asked ? session.asked.length : (c.len || 0);
  var s = load();
  s.runs.unshift({ t: now(), mode: c.mode, zone: c.zone, difficulty: c.difficulty,
                   variant: c.variant || null, len: len, score: score });
  if (s.runs.length > MAX_RUNS) s.runs.length = MAX_RUNS;
  var keys = [bump(s.byCfg, cfgKey(c)), bump(s.byMode, c.mode), bump(s.byZone, c.zone)];
  keys.forEach(function (e) {
    if (!e) return;
    e.played++;
    var better = !e.bestLen || (score / (len || 1)) > (e.best / (e.bestLen || 1)) ||
                 ((score / (len || 1)) === (e.best / (e.bestLen || 1)) && score > e.best);
    if (better) { e.best = score; e.bestLen = len; }
  });
  save(s);
  return s;
}

/* The best result for a config: {score, len, ratio, played} - score 0 when never
   played, so a caller can tell "no record" from "a bad record" by `len`. */
function best(cfg) {
  var s = load();
  var e = s.byCfg[cfgKey(cfg)];
  if (!e || !e.bestLen) return { score: 0, len: 0, ratio: 0, played: 0, last: 0 };
  return { score: e.best, len: e.bestLen, ratio: e.best / e.bestLen,
           played: e.played, last: e.last };
}

/* Everything the stats sheet shows, already sorted. Read-only. */
function summary() {
  var s = load();
  var modes = [], zones = [], cfgs = [], countries = [];
  function row(k, e) {
    return { key: k, played: e.played, asked: e.asked, correct: e.correct,
             pct: e.asked ? e.correct / e.asked : 0, best: e.best, bestLen: e.bestLen };
  }
  for (var k in s.byMode) if (s.byMode.hasOwnProperty(k)) modes.push(row(k, s.byMode[k]));
  for (var z in s.byZone) if (s.byZone.hasOwnProperty(z)) zones.push(row(z, s.byZone[z]));
  for (var c in s.byCfg) if (s.byCfg.hasOwnProperty(c)) cfgs.push(row(c, s.byCfg[c]));
  for (var id in s.byCountry) {
    if (!s.byCountry.hasOwnProperty(id)) continue;
    var e = s.byCountry[id];
    if (!e.a) continue;
    countries.push({ id: id, name: e.n, flag: e.f || '', asked: e.a, correct: e.c, pct: e.c / e.a });
  }
  /* "costs you the most" is the number of MISSES first, then the share: a country
     missed once out of one (0/1) is not a bigger weakness than one missed five times
     out of eight, and sorting by percentage alone put a single unlucky question at
     the top of the list. */
  countries.sort(function (a, b) {
    var ma = a.asked - a.correct, mb = b.asked - b.correct;
    if (ma !== mb) return mb - ma;
    if (a.pct !== b.pct) return a.pct - b.pct;
    return b.asked - a.asked;
  });
  modes.sort(function (a, b) { return b.asked - a.asked; });
  zones.sort(function (a, b) { return b.asked - a.asked; });
  cfgs.sort(function (a, b) {
    var ra = a.bestLen ? a.best / a.bestLen : 0, rb = b.bestLen ? b.best / b.bestLen : 0;
    return rb - ra;
  });
  return {
    asked: s.asked, correct: s.correct, pct: s.asked ? s.correct / s.asked : 0,
    streak: s.streak, bestStreak: s.bestStreak,
    played: s.runs.length, first: s.first, last: s.last,
    modes: modes, zones: zones, cfgs: cfgs,
    countriesAsked: countries.length,
    missed: countries.filter(function (c) { return c.correct < c.asked; }).slice(0, 8),
    known: countries.filter(function (c) { return c.pct === 1; })
      .sort(function (a, b) { return b.asked - a.asked; }).slice(0, 8)
  };
}

/* Everything forgotten: the counters, the rounds and the country record. The settings
   (sound, music, volume) and the quiz config are other keys and survive, which is the
   point of keeping them apart. */
function reset() {
  var s = blank();
  save(s);
  return s;
}

function raw() { return load(); }

var API = {
  LS_KEY: LS, MAX_RUNS: MAX_RUNS,
  cfgKey: cfgKey,
  answer: answer, endRun: endRun, best: best, summary: summary,
  reset: reset, raw: raw,
  /* the whole blob, for a test or an export: nothing here writes it back */
  exportAll: function () { return load(); }
};
if (typeof window !== 'undefined') window.KwizzyStats = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

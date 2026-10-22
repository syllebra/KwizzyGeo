/* node tests for i18n.js: the quiz's UI strings in the 18 languages the map speaks.
   What is asserted, and why each one matters:

     * every language has EVERY key. A missing one would fall back to English, i.e. an
       English button inside a Japanese screen - the one thing "translate all the UI"
       must not allow.
     * the placeholders survive. A translation that loses {n} shows a sentence with a
       hole in it, which is worse than English.
     * no string is left untranslated, except a whitelist of legitimate cases (music
       titles are proper names, "{n} ✓" is a number and a tick, "Asia"/"África" are the
       same word in another language).
     * no empty strings, no stray ASCII-only copy of an English sentence, and the
       language codes are exactly the map's 18.
   Run: node tests/i18n_test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const I = require(__dirname + '/../i18n.js');

let checks = 0, fails = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}

const EN = I.table('en');
const KEYS = I.keys();

/* ---------- 1. the set of languages is the map's ---------- */
/* app.js's LANGS list, read out of the source so the two can never drift apart */
(function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const block = app.slice(app.indexOf('var LANGS = ['), app.indexOf('];', app.indexOf('var LANGS = [')));
  const codes = (block.match(/c: '([a-z]{2})'/g) || []).map(s => s.replace(/c: '|'/g, ''));
  check('the map declares 18 languages', codes.length === 18, codes.join(','));
  check('i18n covers exactly those languages', codes.slice().sort().join(',') === I.CODES.slice().sort().join(','),
        'map: ' + codes.join(',') + ' | i18n: ' + I.CODES.join(','));
  codes.forEach(c => check('i18n has a table for ' + c, I.has(c)));
  check('an unknown code falls back to English', I.table('xx') === EN);
})();

/* ---------- 2. every key in every language ---------- */
(function () {
  check('the English table is the key set', KEYS.length > 100, KEYS.length);
  I.CODES.forEach(code => {
    const t = I.table(code);
    const missing = KEYS.filter(k => !(k in t));
    const extra = Object.keys(t).filter(k => !(k in EN));
    check(code + ': every key is present', missing.length === 0, missing.join(','));
    check(code + ': no key the English table does not have', extra.length === 0, extra.join(','));
    const empty = KEYS.filter(k => !String(t[k] || '').trim());
    check(code + ': no empty string', empty.length === 0, empty.join(','));
    const notString = KEYS.filter(k => typeof t[k] !== 'string');
    check(code + ': every value is a string', notString.length === 0, notString.join(','));
  });
})();

/* ---------- 3. placeholders ---------- */
(function () {
  function ph(s) { return (String(s).match(/\{(\w+)\}/g) || []).sort().join(','); }
  I.CODES.forEach(code => {
    const t = I.table(code);
    const bad = KEYS.filter(k => ph(t[k]) !== ph(EN[k]));
    check(code + ': placeholders match English', bad.length === 0,
          bad.map(k => k + ' [' + ph(t[k]) + ' vs ' + ph(EN[k]) + ']').join(' '));
  });
  /* the two that carry a number in every language, spot-checked on real values */
  I.CODES.forEach(code => {
    const s = I.t('question_of', { i: 3, n: 10 }, code);
    check(code + ': question_of substitutes both numbers', s.indexOf('3') >= 0 && s.indexOf('10') >= 0, s);
    check(code + ': question_of leaves no placeholder behind', s.indexOf('{') < 0, s);
  });
  check('a translation may reorder its placeholders',
        I.t('sub_zone', { zone: 'A', difficulty: 'B' }, 'ja').indexOf('A') >= 0);
  check('an unknown key returns the key itself, so a test can see it',
        I.t('no_such_key', null, 'fr') === 'no_such_key');
  check('a missing value leaves the placeholder (no "undefined" on screen)',
        I.t('question_of', { i: 1 }, 'en').indexOf('{n}') >= 0);
})();

/* ---------- 4. nothing is left in English by accident ---------- */
(function () {
  /* Compare the WORDS only: placeholders and punctuation are language-neutral, so
     "{zone} · {difficulty}" is legitimately identical in all 18 tables. What is left is
     the text, and if it still matches English the key is either one of the cases below -
     a word that really is the same word in that language, or one of our music titles,
     which are proper names - or it is a string somebody forgot to translate. */
  const SAME_OK = {
    /* the word genuinely is the same in that language: French "zone", "questions",
       "Europe", "normal", "correct"; German/Dutch "Zone"; Spanish/Portuguese "capital",
       Spanish "Asia" */
    h_zone: 1, h_len: 1, fig_questions: 1, question_of: 1, correct: 1,
    z_europe: 1, z_asia: 1, d_medium: 1, sub_capital: 1, capital_word: 1,
    /* a number and a tick */
    /* score_mark is "{n} ✓": no words at all, so the comparison above never sees it
       (it is listed for the reader, and the stale check ignores it) */
    score_mark: 1,
    /* the music's own titles (and "arcade" is the German word too) */
    track_arcade: 1, track_jazzy1: 1, track_jazzy2: 1,
    /* the info panel's row labels, where the word genuinely is the same one: French
       "type"/"population", German "Name"/"Region", Spanish/Portuguese "capital",
       Dutch "type", Swedish "region", the abbreviations "GDP" and "km²" (the unit
       symbol is the same everywhere), and the conventional "est." */
    p_name: 1, p_type: 1, p_region: 1, p_capital: 1, p_population: 1,
    p_codes: 1, p_source: 1, p_gdp: 1, p_est: 1, p_popmax: 1, p_km2: 1
  };
  function core(v) {
    return String(v).replace(/\{\w+\}/g, '').replace(/[^\p{L}]+/gu, ' ').trim().toLowerCase();
  }
  I.CODES.filter(c => c !== 'en').forEach(code => {
    const t = I.table(code);
    const same = KEYS.filter(k => {
      const a = core(EN[k]), b = core(t[k]);
      return a && a === b;
    });
    const unexpected = same.filter(k => !SAME_OK[k]);
    check(code + ': no string is left in English', unexpected.length === 0,
          unexpected.map(k => k + '="' + EN[k] + '"').join(' '));
  });
  /* the whitelist itself must stay small and must still be doing its job: a key listed
     there that no language actually shares is cruft */
  const shared = {};
  I.CODES.filter(c => c !== 'en').forEach(code => {
    const t = I.table(code);
    KEYS.forEach(k => { if (core(EN[k]) && core(EN[k]) === core(t[k])) shared[k] = 1; });
  });
  const stale = Object.keys(SAME_OK).filter(k => !shared[k] && k !== 'score_mark');
  check('the whitelist has no stale entry', stale.length === 0, stale.join(','));
  check('the whitelist is short (it is exceptions, not the rule)', Object.keys(SAME_OK).length <= 26,
        Object.keys(SAME_OK).length);

  /* a "sentence" copied from English but edited by one word would pass the check above:
     this one looks at the first three words */
  I.CODES.filter(c => c !== 'en').forEach(code => {
    const t = I.table(code);
    const copies = KEYS.filter(k => {
      if (SAME_OK[k] || /^track_/.test(k)) return false;
      const a = core(EN[k]), b = core(t[k]);
      if (a.split(' ').length < 3) return false;
      return a.split(' ').slice(0, 3).join(' ') === b.split(' ').slice(0, 3).join(' ');
    });
    check(code + ': no sentence begins like the English one', copies.length === 0, copies.join(','));
  });
})();

/* ---------- 5. the scripts are the right script ---------- */
(function () {
  /* A Latin-script placeholder in a string whose language is CJK / Arabic / Indic means
     somebody pasted English in. Checked on the long strings only (a lone "10" is a
     number in every language). */
  const scriptOf = {
    zh: /[\u4e00-\u9fff]/, ja: /[\u3040-\u30ff\u4e00-\u9fff]/, ko: /[\uac00-\ud7af]/,
    ru: /[\u0400-\u04ff]/, uk: /[\u0400-\u04ff]/, el: /[\u0370-\u03ff]/,
    ar: /[\u0600-\u06ff]/, fa: /[\u0600-\u06ff]/, he: /[\u0590-\u05ff]/,
    hi: /[\u0900-\u097f]/, bn: /[\u0980-\u09ff]/
  };
  Object.keys(scriptOf).forEach(code => {
    const t = I.table(code);
    const long = KEYS.filter(k => String(EN[k]).length > 14 && !/^track_/.test(k) &&
                                  /\p{L}/u.test(String(EN[k]).replace(/\{\w+\}/g, '')));
    const latin = long.filter(k => !scriptOf[code].test(String(t[k])));
    check(code + ': the long strings are in its own script', latin.length === 0,
          latin.map(k => k + '="' + t[k] + '"').join(' '));
  });
})();

/* ---------- 6. right-to-left ---------- */
(function () {
  check('Arabic is right to left', I.dir('ar') === 'rtl');
  check('Persian is right to left', I.dir('fa') === 'rtl');
  check('Hebrew is right to left', I.dir('he') === 'rtl');
  check('English is left to right', I.dir('en') === 'ltr');
  check('Japanese is left to right', I.dir('ja') === 'ltr');
  check('an unknown code is left to right', I.dir('xx') === 'ltr');
})();

/* ---------- 7. the quiz has no hard-coded English left ---------- */
(function () {
  const quiz = fs.readFileSync(path.join(__dirname, '..', 'quiz.js'), 'utf8');
  /* the screens' own words must all go through T(): a markup literal with a sentence in
     it is the failure mode this whole file exists to prevent */
  const markupEnglish = (quiz.match(/'>[A-Z][a-z]+ [a-z]+ [^'<]*</g) || []);
  check('no English sentence is written straight into the markup', markupEnglish.length === 0,
        markupEnglish.join(' '));
  /* and every key the screens ask for exists */
  const asked = (quiz.match(/T\('([a-z_0-9]+)'/g) || []).map(s => s.replace(/T\('|'/g, ''));
  const unknown = asked.filter(k => !(k in EN));
  check('every key quiz.js asks for exists', unknown.length === 0, unknown.join(','));
  check('the screens use a lot of keys', asked.length > 40, asked.length);
  /* the id -> key maps in quiz.js must cover the vocabularies in quizcore */
  const qc = fs.readFileSync(path.join(__dirname, '..', 'quizcore.js'), 'utf8');
  ['country', 'capital', 'flag'].forEach(id => {
    check('mode ' + id + ' has a label key', new RegExp("K_MODE[^}]*" + id + ": 'm_").test(quiz), id);
  });
  ['world', 'africa', 'asia', 'europe', 'north-america', 'south-america', 'oceania'].forEach(id => {
    /* the map writes unquoted keys (world: 'z_world') and quoted ones for the two
       hyphenated zones, so both forms are accepted */
    const pat = new RegExp('(^|[\\s{])["\']?' + id + '["\']?\\s*:\\s*["\']z_');
    check('zone ' + id + ' has a label key', pat.test(quiz), id);
  });
  check('the flag variants have keys', quiz.indexOf("name: 'v_name'") >= 0 && quiz.indexOf("flags: 'v_flags'") >= 0);
  void qc;
})();

console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);

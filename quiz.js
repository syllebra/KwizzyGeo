/* KwizzyGeo quiz: the screens. Everything that is not a question (which country,
   which capital, which flag, which five wrong answers) lives in quizcore.js; this
   file is the DOM, the keyboard and the hand-over of the map.

   THREE SCREENS, one container (#quiz):
     start    the first page on load: mode, zone, difficulty, Play
     question the map (or the flag), the six options, then the verdict
     end      the score, the round's dots, play again / change settings

   The map is borrowed, not owned: MapApp.enter() pins the layer and silences the
   labels and the panel, MapApp.show() lights a country up and flies to it,
   MapApp.exit() gives it all back. The viewer is untouched by any of this when no
   quiz is running. */
(function () {
'use strict';

var Q = window.QuizCore;
var M = window.MapApp;
/* the juice: Kwizzy's sound effects, haptics, particles and music (juice.js). Sound is
   OPTIONAL here - the game must run exactly as before if the module is absent or the
   browser has no audio at all, so every call goes through J() and is a no-op when gone. */
var JU = window.Juice || null;
function J() { return JU; }
/* the record of everything played (stats.js). Optional exactly like the juice: the
   quiz runs without it, it just cannot remember anything. */
var ST = window.KwizzyStats || null;
function S() { return ST; }
/* THE UI LANGUAGE is the map's own language (app.js's LANG, set by the burger's chips):
   one setting for the whole app, not a second one for the game. Every visible string
   goes through T(); country and capital names come from the layers through M.label /
   M.capLabel, so they follow the same setting. */
var I18 = window.KwizzyI18n || null;
var V = window.ViewState || null;
function lang() {
  try { return (V && V.lang && V.lang()) || 'en'; } catch (e) { return 'en'; }
}
function T(key, vars) {
  if (!I18) return key;
  return I18.t(key, vars, lang());
}
function dirOf() { return I18 ? I18.dir(lang()) : 'ltr'; }
/* the id -> key maps for the vocabularies that live in quizcore (which is language
   neutral by design: it holds ids and rules, never words) */
var K_MODE = { country: 'm_country', capital: 'm_capital', flag: 'm_flag', locate: 'm_locate' };
var K_MODE_SUB = { country: 'm_country_s', capital: 'm_capital_s', flag: 'm_flag_s',
                   locate: 'm_locate_s' };
var K_ZONE = { world: 'z_world', africa: 'z_africa', asia: 'z_asia', europe: 'z_europe',
               'north-america': 'z_na', 'south-america': 'z_sa', oceania: 'z_oceania' };
var K_DIFF = { easy: 'd_easy', medium: 'd_medium', hard: 'd_hard' };
var K_DIFF_SUB = { easy: 'd_easy_s', medium: 'd_medium_s', hard: 'd_hard_s' };
/* In locate mode "the wrong answers are neighbours" would be meaningless - there are no
   answers to choose from. The difficulty there is how famous the city is, so the three
   subs are their own sentences. */
var K_DIFF_SUB_LOCATE = { easy: 'd_l_easy_s', medium: 'd_l_medium_s', hard: 'd_l_hard_s' };
var K_VARIANT = { name: 'v_name', flags: 'v_flags' };
var K_VARIANT_SUB = { name: 'v_name_s', flags: 'v_flags_s' };
var K_LEN_SUB = { 10: 'l_short', 25: 'l_long', 0: 'l_all' };
var K_TRACK = { arcade_quiz_02: 'track_arcade', jazzy_lounge_01: 'track_jazzy1',
                jazzy_lounge_02: 'track_jazzy2', jazzy_lounge_04: 'track_jazzy4',
                light_ambient: 'track_ambient' };
if (!Q || !M) return;

var quizEl = document.getElementById('quiz');
var bodyEl = document.body;
/* THE BACK DISC: app chrome, in index.html next to the fullscreen button, NOT inside a
   page. `position: fixed` is measured against the nearest TRANSFORMED ancestor, and #quiz
   animates a transform on every screen change - so a fixed Back button inside the page
   drifted with that animation and never lined up exactly with the other two discs. */
var backEl = document.getElementById('qback');

/* the config survives a reload; a private-mode browser simply forgets it */
var STORE = 'kwizzy.quiz.cfg';
var cfg = { mode: 'country', zone: 'world', difficulty: 'medium', len: 10, variant: 'name' };
try {
  var saved = window.localStorage.getItem(STORE);
  if (saved) {
    var o = JSON.parse(saved);
    if (o && typeof o === 'object') {
      if (Q.MODES.length) for (var i0 = 0; i0 < Q.MODES.length; i0++) if (o.mode === Q.MODES[i0].id) cfg.mode = o.mode;
      for (var i1 = 0; i1 < Q.ZONES.length; i1++) if (o.zone === Q.ZONES[i1].id) cfg.zone = o.zone;
      for (var i2 = 0; i2 < Q.DIFFS.length; i2++) if (o.difficulty === Q.DIFFS[i2].id) cfg.difficulty = o.difficulty;
      for (var i3 = 0; i3 < Q.FLAG_ASK.length; i3++) if (o.variant === Q.FLAG_ASK[i3].id) cfg.variant = o.variant;
      for (var i4 = 0; i4 < Q.LENS.length; i4++) if (o.len === Q.LENS[i4].id) cfg.len = o.len;
    }
  }
} catch (e) { /* private mode: keep the defaults */ }
function storeCfg() {
  try { window.localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {}
}

/* THE SCREENS, in the order the arrows walk them (Kwizzy's own shape: a title, then
   one question per screen, then the run). `question` and `end` are the game; the rest
   are the menu the player walks through before a round. */
var STEPS = ['title', 'mode', 'zone', 'diff'];
var screen = 'title';        /* title | mode | zone | diff | about | question | end */
var soundOpen = false;       /* the sound & music drawer, over whichever screen */
var soundEl = document.getElementById('qz-sound');   /* a SIBLING of #quiz, so a screen
                                                       re-render cannot wipe the drawer */
var statsOpen = false;       /* the record of everything played */
var statsEl = document.getElementById('qz-stats');
var statsArmed = false;      /* the Reset button has been pressed once */
var session = null, q = null, answered = false, chosen = -1;
/* LOCATE: the point the player has put on the map, {lon, lat}, and the answer once it
   is given. `guess` lives outside the question so a re-render (a language change, a
   resize) does not throw away the marker the player placed. */
var guess = null;
var infoMsg = '';
var bumped = false;          /* the score just went up: its next render bumps */
var lastHover = -1;          /* which answer the pointer is on, for the select pip */

/* ---------- tiny helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flagSpan(code, cls) {
  if (!code || !/^[a-z]{2}$/.test(code)) return '';
  return '<span class="fi fi-' + code + (cls ? ' ' + cls : '') + '"></span>';
}
function zoneLabel(id) { return K_ZONE[id] ? T(K_ZONE[id]) : id; }
function diffLabel(id) { return K_DIFF[id] ? T(K_DIFF[id]) : id; }
function diffSub(id) {
  var k = (cfg.mode === 'locate' ? K_DIFF_SUB_LOCATE : K_DIFF_SUB)[id];
  return k ? T(k) : '';
}
function modeLabel(id) { return K_MODE[id] ? T(K_MODE[id]) : id; }
function modeSub(id) { return K_MODE_SUB[id] ? T(K_MODE_SUB[id]) : ''; }
function variantLabel(id) { return K_VARIANT[id] ? T(K_VARIANT[id]) : id; }
function variantSub(id) { return K_VARIANT_SUB[id] ? T(K_VARIANT_SUB[id]) : ''; }
/* THE LOGO SLOT. The final mark drops in as media/logo.png; until that file exists the
   wordmark is the logo. Probed ONCE at boot rather than put in the markup with an
   onerror, so a missing file is a quiet 404 in the network log and never a broken
   image flashing on the title. */
var logoOK = false;
try {
  var logoProbe = new window.Image();
  logoProbe.onload = function () { logoOK = true; if (screen === 'title') render(); };
  logoProbe.src = 'media/logo.png';
} catch (e) { /* no Image() (node): the wordmark stays */ }
function flagsReady() { return M.ready(); }
function capsReady() { return M.placesReady(); }
/* THE BEST SCORE OF THIS CONFIG comes from stats.js, which compares by RATIO (so a
   25/25 beats a 10/10 and a 9/10 beats a 4/5) and keeps the length it was set at -
   the old per-key integer died with the fixed 10-question round. */
function cfgForStats() {
  return { mode: cfg.mode, zone: cfg.zone, difficulty: cfg.difficulty,
           variant: cfg.mode === 'flag' ? cfg.variant : null };
}
function bestOf() {
  if (!S()) return { score: 0, len: 0, ratio: 0, played: 0 };
  return S().best(cfgForStats());
}

/* ---------- screen 1: the first page ---------- */
/* ---------- the chrome the four menu screens share ----------
   Kwizzy's shape: a top bar with a back arrow and the step's own title, a body, and
   one primary action pinned under the thumb. Everything is a full-viewport page with
   the map visible behind it (the map is the background of the whole game). */
function stepDots(i, n) {
  var h = '<span class="qz-steps" aria-hidden="true">';
  for (var k = 1; k <= n; k++) h += '<span class="qz-stepd' + (k < i ? ' done' : k === i ? ' on' : '') + '"></span>';
  return h + '</span>';
}
function shellHTML(o) {
  var h = '';
  h += '<div class="qz-scrim"></div>';
  h += '<div class="qz-page' + (o.cls ? ' ' + o.cls : '') + '">';
  /* THE TOP BAR IS ON EVERY STEPPED PAGE, and on a page that is not a step of the walk
     (the credits) it keeps the back arrow and the title and drops the dots - a page
     with no way back and no name is a page you are stuck on.

     THE TITLE IS `.qz-steptitle`, NOT `.qz-title`: #quiz itself carries `qz-title` as
     its SCREEN marker (`class="qz-on qz-title"`), so a `.qz-title` rule styling the
     heading also hit the whole full-screen container - its `white-space: nowrap`
     inherited all the way down the title screen and stopped the tagline wrapping.
     Every screen class is `qz-<screen>`, so no component class may be named that way. */
  if (o.title) {
    /* THE BACK DISC IS NOT IN HERE. It is app chrome (#qback in index.html), next to the
       fullscreen button: see setBack() for the transform that made an in-page fixed
       button drift off the other two. The bar only carries the step's own words. */
    h += '<div class="qz-topbar">' +
         '<div class="qz-titles">' +
         (o.step ? '<span class="qz-kicker">' + esc(T('step_of', { i: o.step, n: o.steps })) + '</span>' : '') +
         '<h2 class="qz-steptitle">' + esc(o.title) + '</h2></div>' +
         (o.step ? stepDots(o.step, o.steps) : '') + '</div>';
  }
  h += '<div class="qz-pagebody">' + o.body + '</div>';
  if (o.foot) h += '<div class="qz-pagefoot">' + o.foot + '</div>';
  return h + '</div>';
}
/* one card of a choice row: icon, name, one line, and a tick when it is the pick */
function choiceHTML(attr, id, ico, title, sub, on, extra) {
  return '<button class="qz-choice' + (on ? ' on' : '') + '" data-' + attr + '="' + id + '"' +
         (extra || '') + '>' +
         '<span class="qz-choice-ico" aria-hidden="true">' + ico + '</span>' +
         '<span class="qz-choice-t">' + esc(title) + '</span>' +
         (sub ? '<span class="qz-choice-s">' + esc(sub) + '</span>' : '') +
         '<span class="qz-tick" aria-hidden="true"></span></button>';
}
function loaderHTML() {
  return '<div class="qz-loader" role="status" aria-live="polite">' +
         '<span class="qz-ring" aria-hidden="true"></span>' +
         '<span class="qz-loadnote">' + esc(T('loading_map')) + '</span></div>';
}

/* ---------- screen 1: the title ---------- */
function titleHTML() {
  var ready = flagsReady();
  var h = '';
  h += '<div class="qz-scrim qz-scrim-soft"></div>';
  h += '<div class="qz-page qz-page-title"><div class="qz-titlewrap">';
  /* THE HALO breathes behind the name, exactly as Kwizzy's title does: the one pulsing
     light of the app, and it is decorative only. */
  h += '<div class="qz-brand"><span class="qz-halo" aria-hidden="true"></span>';
  /* THE LOGO SLOT. The final mark drops in as media/logo.png; while that file is not
     there the wordmark below IS the logo (quiz.js probes the file once at boot, so a
     missing logo never shows a broken image). */
  if (logoOK) h += '<img class="qz-logomark" src="media/logo.png" alt="KwizzyGeo">';
  else h += '<h1>Kwizzy<span>Geo</span></h1>';
  h += '<p class="qz-tagline">' + esc(T('tagline')) + '</p></div>';

  if (!ready) h += loaderHTML();
  /* THE MAIN MENU: the two ways to use the app, side by side in the hierarchy - play a
     round, or take the map and explore it - and then the two doors that are not ways to
     play (credits, and the sound/stats drawers in the footer). Leaving the game used to
     be a small link down here AND a row in the burger; it is a first-class choice. */
  h += '<div class="qz-titleacts">' +
       '<button class="qz-play qz-xl" data-act="play"' + (ready ? '' : ' disabled') + '>' +
       esc(ready ? T('play') : T('loading_map')) + '</button>' +
       '<button class="qz-ghost qz-explorebtn" data-act="explore">' +
       esc(T('explore')) + '</button>' +
       '<button class="qz-ghost qz-creditsbtn" data-act="about">' + esc(T('ab_title')) + '</button>' +
       '</div>';
  h += '<div class="qz-foot">' +
       '<span class="qz-links">' +
       '<a class="qz-link" data-act="snd-open">' + esc(T('sound_music')) + '</a>' +
       '<a class="qz-link" data-act="stats-open">' + esc(T('stats')) + '</a></span>' +
       '<span class="qz-best">' + bestText() + '</span></div>';
  h += '<div class="qz-note qz-info">' + esc(infoMsg || defaultInfo()) + '</div>';
  return h + '</div></div>';
}

/* ---------- screen 2: what to find ---------- */
function modeHTML() {
  var b = '<div class="qz-choices qz-choices-row">';
  for (var i = 0; i < Q.MODES.length; i++) {
    var md = Q.MODES[i];
    var waitCap = (md.id === 'capital' && !capsReady());
    b += choiceHTML('mode', md.id, md.ico, modeLabel(md.id),
                    waitCap ? T('loading_capitals_short') : modeSub(md.id),
                    cfg.mode === md.id, waitCap ? ' aria-disabled="true"' : '');
  }
  b += '</div>';
  /* THE FLAG QUESTION HAS TWO HALVES: name the country from the flag, or pick the flag
     of a named country. The row only exists while the flag mode is picked, so the page
     never grows a setting that is meaningless for the other two modes. */
  if (cfg.mode === 'flag') {
    b += '<div class="qz-block"><div class="qz-h">' + esc(T('h_flag')) + '</div>' +
         '<div class="chips qz-row">';
    for (var v = 0; v < Q.FLAG_ASK.length; v++) {
      b += '<button class="chip' + (cfg.variant === Q.FLAG_ASK[v].id ? ' on' : '') + '" data-variant="' +
           Q.FLAG_ASK[v].id + '">' + esc(variantLabel(Q.FLAG_ASK[v].id)) + '</button>';
    }
    b += '</div><div class="qz-note">' + esc(variantSub(cfg.variant)) + '</div></div>';
  }
  return shellHTML({
    step: 1, steps: 3, title: T('h_pick_mode'), body: b,
    foot: '<button class="qz-play" data-act="go" data-to="zone">' + esc(T('cont')) + '</button>'
  });
}

/* ---------- screen 3: which part of the world ---------- */
function zoneHTML() {
  var b = '<div class="qz-choices qz-zones">';
  for (var i = 0; i < Q.ZONES.length; i++) {
    var z = Q.ZONES[i];
    b += '<button class="qz-zcard' + (cfg.zone === z.id ? ' on' : '') + '" data-zone="' + z.id + '">' +
         '<span class="qz-zname">' + esc(zoneLabel(z.id)) + '</span>' +
         '<span class="qz-tick" aria-hidden="true"></span></button>';
  }
  b += '</div>';
  return shellHTML({
    step: 2, steps: 3, title: T('h_pick_zone'), body: b,
    foot: '<button class="qz-play" data-act="go" data-to="diff">' + esc(T('cont')) + '</button>'
  });
}

/* ---------- screen 4: how hard, and how long ---------- */
function diffHTML() {
  var b = '<div class="qz-choices qz-choices-row">';
  for (var d = 0; d < Q.DIFFS.length; d++) {
    var df = Q.DIFFS[d];
    b += choiceHTML('diff', df.id, '', diffLabel(df.id), diffSub(df.id), cfg.difficulty === df.id);
  }
  b += '</div>';
  b += '<div class="qz-block"><div class="qz-h">' + esc(T('h_len')) + '</div><div class="chips qz-row">';
  var LENS = Q.lensOf(cfg.mode), cur = chosenLen();
  for (var L = 0; L < LENS.length; L++) {
    b += '<button class="chip' + (cur === LENS[L].id ? ' on' : '') + '" data-len="' +
         LENS[L].id + '">' + esc(LENS[L].id ? String(LENS[L].id) : T('all_tracks')) + '</button>';
  }
  b += '</div><div class="qz-note">' + esc(lenSub()) + '</div></div>';
  var best = bestText();
  if (best) b += '<div class="qz-note qz-bestline">' + esc(best) + '</div>';
  return shellHTML({
    step: 3, steps: 3, title: T('h_pick_diff'), body: b,
    foot: '<button class="qz-play qz-xl" data-act="start"' + (flagsReady() ? '' : ' disabled') + '>' +
          esc(flagsReady() ? T('play') : T('loading_map')) + '</button>'
  });
}

/* ---------- screen 5: credits and memory ---------- */
/* The two things a player should be able to find without reading the README: what the
   map is made of (and whose it is), and what this device remembers about them. The
   memory half is the stats sheet's own content, rendered by the same builder. */
function creditRow(name, what, href) {
  var n = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(name) + '</a>'
               : esc(name);
  return '<div class="qz-credrow"><span class="k">' + n + '</span>' +
         '<span class="v">' + esc(what) + '</span></div>';
}
function aboutHTML() {
  var b = '';
  b += '<div class="qz-block"><div class="qz-h">' + esc(T('ab_data')) + '</div>' +
       creditRow('Natural Earth', T('ab_ne'), 'https://www.naturalearthdata.com/') +
       '<div class="qz-note">' + esc(T('ab_layers_v')) + '</div></div>';
  b += '<div class="qz-block"><div class="qz-h">' + esc(T('ab_flags')) + '</div>' +
       creditRow('flag-icons', T('ab_fi'), 'https://github.com/lipis/flag-icons') + '</div>';
  b += '<div class="qz-block"><div class="qz-h">' + esc(T('ab_map')) + '</div>' +
       creditRow('KwizzyGeo', T('ab_code')) +
       '<div class="qz-note">' + esc(T('ab_map_note')) + '</div></div>';
  b += '<div class="qz-block"><div class="qz-h">' + esc(T('snd_title')) + '</div>' +
       '<div class="qz-note">' + esc(T('ab_music_note')) + '</div></div>';
  b += '<div class="qz-block"><div class="qz-h">' + esc(T('ab_memory')) + '</div>' +
       '<div class="qz-note">' + esc(T('ab_memory_note')) + '</div>' +
       '<div class="qz-actions"><button class="qz-ghost" data-act="stats-open">' + esc(T('stats')) +
       '</button><button class="qz-ghost" data-act="snd-open">' + esc(T('sound_music')) +
       '</button></div></div>';
  return shellHTML({
    title: T('ab_title'), body: b, cls: 'qz-page-about',
    foot: '<button class="qz-play" data-act="back">' + esc(T('done')) + '</button>'
  });
}

/* the note under the length chips: "All" needs to say how many that actually is, and
   a zone smaller than the asked length says so instead of silently repeating */
/* THE POOL A CONFIG MEANS - the one call the length note, the "not enough" message and
   the session all agree on. Locate asks about CITIES, so its pool comes from the cities
   and from the difficulty (the fame band), not from the countries. */
function poolOf(c) {
  var cc = c || cfg;
  if (!flagsReady()) return [];
  if (cc.mode === 'locate') return Q.cityPool(M.cities(), cc.zone, cc.difficulty);
  return Q.poolFor(M.items(), cc.zone, cc.mode);
}
/* the length a round would actually play: the same resolution newSession does, so a
   stored 10 carried over from a country round cannot light up a chip locate does not
   offer */
function chosenLen() {
  var L = Q.lensOf(cfg.mode);
  for (var i = 0; i < L.length; i++) if (cfg.len === L[i].id) return cfg.len;
  return L[0].id;
}
function lenSub() {
  var want = chosenLen();
  var n = poolOf(cfg).length;
  if (!want) {
    return n ? T('l_note_all', { zone: zoneLabel(cfg.zone), n: n }) : T('l_all');
  }
  if (n && n < want) return T('l_note_clip', { zone: zoneLabel(cfg.zone), n: n });
  return K_LEN_SUB[want] ? T(K_LEN_SUB[want]) : '';
}
function defaultInfo() {
  if (!flagsReady()) return T('loading_map');
  if (cfg.mode === 'capital' && !capsReady()) return T('loading_caps');
  return '';
}
function bestText() {
  var b = bestOf();
  if (!b.len) return '';
  /* the length is printed with the score: it is what makes two bests comparable */
  return T('best_here', { score: b.score, len: b.len }) +
         (b.played > 1 ? ' \u00b7 ' + T('best_n', { n: b.played }) : '');
}

/* ---------- screen 2: a question ---------- */
function askHTML() {
  var h = '';
  if (q.mode === 'country') {
    h += '<div class="qz-q">' + esc(T('ask_country')) + '</div>' +
         '<div class="qz-sub">' + esc(subZoneDiff(q)) + '</div>';
  } else if (q.mode === 'capital') {
    h += '<div class="qz-q">' + askCapital(q) + '</div>' +
         '<div class="qz-sub">' + esc(subZoneDiff(q)) + '</div>';
  } else if (q.mode === 'locate') {
    /* THE CITY IS THE QUESTION: named, in the language in play, and split at {city} so a
       language can put the name where its own sentence wants it */
    var cityN = M.placeLabel(q.answer.id) || q.answer.name;
    h += '<div class="qz-q">' + named('ask_locate', cityN, 'city') + '</div>' +
         '<div class="qz-sub">' + esc(subZoneDiff(q)) + '</div>';
  } else if (q.variant === 'flags') {
    /* the country is NAMED and lit up on the map, with its capital: the flag is the
       answer, so it must not be anywhere on screen */
    var bits = [];
    var capF = M.capLabel(q.answer.id);
    if (capF) bits.push(esc(T('sub_capital', { cap: capF })));
    if (q.answer.cont) bits.push(esc(continent(q.answer)));
    h += '<div class="qz-q">' + askFlag(q) + '</div>' +
         '<div class="qz-sub">' + (bits.length ? bits.join(' · ') : esc(zoneLabel(q.zone))) + '</div>';
  } else {
    /* the prompt and the flag on ONE row: the country is centred on the map behind
       this card, and a stack of title + 100 px flag covered the top third of it */
    h += '<div class="qz-flagrow"><span class="qz-q">' + esc(T('ask_flag_name')) + '</span>' +
         '<span class="qz-flagwrap">' + flagSpan(q.answer.flag, 'qz-bigflag') + '</span></div>';
  }
  return h;
}
/* THE THREE PROMPTS THAT NAME SOMETHING. Split at {country} so the country can be bold
   WITHOUT the sentence being glued together here: a language that puts the name at the
   end, or wraps it in its own punctuation, only has to move {country} in its own string. */
function named(tpl, name, varName) {
  var mark = '\u0001';
  var vars = {};
  vars[varName || 'country'] = mark;
  var s2 = esc(T(tpl, vars));
  return s2.replace(mark, '<b>' + esc(name) + '</b>');
}
function askCapital(q) { return named('ask_capital', M.label(q.answer.id) || q.answer.name); }
function askFlag(q) { return named('ask_flag_country', M.label(q.answer.id) || q.answer.name); }
function subZoneDiff(q) {
  return T('sub_zone', { zone: zoneLabel(q.zone), difficulty: diffLabel(q.difficulty) });
}
/* the continent of an answer, in the map's language: Earth's continents are in the same
   vocabulary as the zones, and quizcore's SUB_ZONE has the fallback for the three
   countries Natural Earth files under "seven seas" */
function continent(it) {
  var z = Q.zoneOf ? Q.zoneOf(it) : it.cont;
  for (var i = 0; i < Q.ZONES.length; i++) {
    if (Q.ZONES[i].cont && Q.ZONES[i].cont === z && K_ZONE[Q.ZONES[i].id]) return zoneLabel(Q.ZONES[i].id);
  }
  return it.cont || '';
}
/* THE OPTION'S OWN TEXT, read live: the country name in the language in play, or the
   capital's - never the string the item was built with, so a language change is not
   frozen into a half-translated question */
function optionLabel(it) {
  if (q.mode === 'capital') return M.capLabel(it.id) || it.cap || '';
  return M.label(it.id) || it.name || '';
}
function flagsAsOptions() { return q.mode === 'flag' && q.variant === 'flags'; }
function answersHTML() {
  var asFlags = flagsAsOptions();
  var h = '<div class="qz-answers' + (asFlags ? ' qz-answers-flags' : '') + '">';
  for (var i = 0; i < q.options.length; i++) {
    var cls = 'qz-ans';
    if (answered) {
      if (i === q.correct) cls += ' ok';
      else if (i === chosen) cls += ' bad';
      else cls += ' off';
    }
    h += '<button class="' + cls + '" data-i="' + i + '" style="--i:' + i + '"' +
         (answered ? ' disabled' : '') + '>' +
         '<span class="n">' + (i + 1) + '</span>';
    if (asFlags) {
      /* the flag IS the option: no label, and `aria-label` carries the country name
         for a screen reader (and for the headless test) */
      h += '<span class="fl" aria-label="' + esc(q.options[i].name) + '">' +
           flagSpan(q.options[i].flag, 'qz-optflag') + '</span>';
      /* ONCE ANSWERED the flags get their countries' names: a wrong option that
         stays anonymous teaches nothing, and the names were the whole reason the
         flags were hidden before. */
      if (answered) h += '<span class="cap">' + esc(q.options[i].name) + '</span>';
    } else {
      h += '<span class="v">' + esc(optionLabel(q.options[i])) + '</span>';
    }
    h += '</button>';
  }
  return h + '</div>';
}
function revealHTML() {
  var a = q.answer;
  /* THE VERDICT IS THE VERDICT, and the line beside it is the ANSWER. Printing the
     right answer inside the verdict as well ("✕ Trinidad and Tobago" next to
     "Trinidad and Tobago") said the same thing twice and read like a bug. */
  var facts;
  var aName = M.label(a.id) || a.name;
  var aCap = M.capLabel(a.id) || a.cap;
  if (q.mode === 'capital') {
    /* the question was about the CITY, so the answer line leads with the city */
    facts = flagSpan(a.flag, 'fis') + ' <b>' + esc(aCap) + '</b>' +
            ' <span class="qz-dim">· ' + esc(T('capital_of', { country: aName })) +
            (a.cont ? ' · ' + esc(continent(a)) : '') + '</span>';
  } else {
    facts = flagSpan(a.flag, 'fis') + ' <b>' + esc(aName) + '</b>';
    var bits = [];
    if (aCap) bits.push(esc(T('capital_word', { cap: aCap })));
    if (a.cont) bits.push(esc(continent(a)));
    if (bits.length) facts += ' <span class="qz-dim">· ' + bits.join(' · ') + '</span>';
  }
  /* THE DETAILS. Answering a question should teach something, so the verdict comes
     with the same panel a click on the map opens: the country's own facts, or - when
     the question was about a capital - the CITY's. Rendered by app.js
     (MapApp.countryPanel / capitalPanel), i.e. by the one builder the info panel
     uses, so the two cannot disagree about a country's area or its second capital. */
  var details = '';
  try {
    details = (q.mode === 'capital') ? M.capitalPanel(a.id) : M.countryPanel(a.id);
  } catch (e) { details = ''; }
  var last = (session.i >= session.cfg.len);
  return '<div class="qz-reveal">' +
    '<div class="qz-head">' +
    '<span class="qz-verdict ' + (q.ok ? 'good' : 'bad') + '">' +
    (q.ok ? '\u2713 ' + esc(T('correct')) : '\u2715 ' + esc(T('wrong'))) + '</span>' +
    '<span class="qz-facts">' + facts + '</span>' +
    '<button class="qz-next" data-act="next">' + esc(last ? T('results') : T('next')) +
    '</button></div>' +
    (details ? '<div class="qz-details">' + details + '</div>' : '') +
    '</div>';
}
/* THE LOCATE BAR. There are no answers to press, so the bottom of the screen holds the
   one thing there is to do. Before a marker is placed it says what to do; after, it
   confirms, and it is the only enabled control in the game that is not a six-option
   grid. Written as its own builder so the question screen stays one branch per mode. */
function locateBarHTML() {
  return '<div class="qz-locbar">' +
    '<div class="qz-lochint">' + esc(T(guess ? 'loc_place_ok' : 'loc_place')) + '</div>' +
    '<button class="qz-play qz-locgo" data-act="confirm"' + (guess ? '' : ' disabled') + '>' +
    esc(T('loc_confirm')) + '</button>' +
    '</div>';
}
/* kilometres as a player reads them: one decimal under 10 km (a bullseye is a real
   number, "0 km" would look like a bug), whole kilometres above */
function fmtKm(km) {
  if (!isFinite(km)) return '0';
  return km < 9.95 ? (Math.round(km * 10) / 10).toFixed(1) : String(Math.round(km));
}
/* the verdict of a locate answer: how far, how many points - and the city's own panel,
   so the round teaches where it was as well as how close you got */
function locateRevealHTML() {
  var a = q.answer, nm = M.placeLabel(a.id) || a.name;
  var details = '';
  try { details = M.placePanel ? M.placePanel(a.id) : ''; } catch (e) { details = ''; }
  var last = (session.i >= session.cfg.len);
  return '<div class="qz-reveal">' +
    '<div class="qz-head">' +
    '<span class="qz-verdict ' + (q.ok ? 'good' : 'bad') + '">' +
    (q.ok ? '\u2713 ' + esc(T('correct')) : '\u2715 ' + esc(T('wrong'))) + '</span>' +
    '<span class="qz-facts"><b>' + esc(nm) + '</b>' +
    (a.country ? ' <span class="qz-dim">· ' + esc(a.country) + '</span>' : '') +
    ' <span class="qz-locres">' + esc(T('loc_away', { n: fmtKm(q.km) })) + ' · ' +
    esc(T('loc_pts', { n: q.points })) + '</span></span>' +
    '<button class="qz-next" data-act="next">' + esc(last ? T('results') : T('next')) +
    '</button></div>' +
    (details ? '<div class="qz-details">' + details + '</div>' : '') +
    '</div>';
}
function questionHTML() {
  var h = '';
  h += '<div class="qz-top">' +
       '<button class="qz-x" data-act="quit" title="' + esc(T('quit')) + '">\u2715</button>' +
       /* muting mid-round is a thing players do, so the drawer is one tap away here too */
       '<button class="qz-x qz-sndbtn" data-act="snd-open" title="' + esc(T('sound_btn')) +
       '" aria-label="' + esc(T('sound_btn')) + '">' +
       '\u266A</button>' +
       '<div class="qz-mid"><span class="qz-prog">' +
       esc(T('question_of', { i: session.i, n: session.cfg.len })) +
       '</span><span class="qz-score' + (bumped ? ' bump' : '') + '">' +
       esc(q.mode === 'locate' ? T('loc_pts', { n: session.points || 0 })
                              : T('score_mark', { n: session.score })) + '</span></div>' +
       '</div>';
  h += '<div class="qz-ask' + (q.mode === 'flag' && q.variant === 'name' ? ' qz-ask-flag' : '') +
       (q.mode === 'locate' ? ' qz-ask-locate' : '') + '">' +
       askHTML() + '</div>';
  if (q.mode === 'locate') {
    h += '<div class="qz-bottom">' + (answered ? locateRevealHTML() : locateBarHTML()) + '</div>';
  } else {
    h += '<div class="qz-bottom">' + (answered ? revealHTML() : '') + answersHTML() + '</div>';
  }
  return h;
}

/* ---------- screen 3: the score ---------- */
function endHTML() {
  var n = session.asked.length, ok = 0, dots = '';
  for (var i = 0; i < n; i++) {
    var a = session.asked[i];
    if (a.ok) ok++;
    dots += '<span class="qz-dot' + (a.ok ? ' good' : ' bad') + '" style="--i:' + i + '"></span>';
  }
  /* the run goes into the record BEFORE the best is read, so this round can be the
     best one - and so the record survives a player who closes the tab on the score */
  var before = bestOf();
  if (S()) S().endRun(session);
  var after = bestOf();
  var fresh = !before.len || (after.score === ok && after.len === n && ok / n > before.ratio);
  /* the running total, read ONCE (the sheet and this line must agree, and reading the
     store three times was three JSON parses per render) */
  var ever = '';
  if (S()) {
    var sum = S().summary();
    if (sum.asked > n) ever = ' \u00b7 ' + T('ever_right', { c: sum.correct, n: sum.asked });
  }
  var msg = T(ok === n ? 'end_every' :
              ok >= n * 0.8 ? 'end_strong' :
              ok >= n * 0.5 ? 'end_half' : 'end_lose');
  return '<div class="qz-scrim"></div><div class="qz-card qz-endcard">' +
    '<div class="qz-h">' + esc(modeLabel(session.cfg.mode)) + ' · ' + esc(zoneLabel(session.cfg.zone)) +
    ' · ' + esc(diffLabel(session.cfg.difficulty)) + '</div>' +
    (session.cfg.mode === 'locate'
      ? '<div class="qz-endh' + (fresh ? ' fresh' : '') + '">' + (session.points || 0) +
        ' <span>/ ' + (n * Q.POINTS_MAX) + '</span></div>'
      : '<div class="qz-endh' + (fresh ? ' fresh' : '') + '">' + ok + ' <span>/ ' + n + '</span></div>') +
    '<div class="qz-dots">' + dots + '</div>' +
    '<div class="qz-endmsg">' + esc(msg) + '</div>' +
    '<div class="qz-note' + (fresh ? ' qz-best-new' : '') + '">' +
    esc(T(fresh ? 'new_best' : 'best_line', { score: after.score, len: after.len })) +
    /* the whole record, one line: this run's place in it */
    ever + '</div>' +
    '<div class="qz-actions"><button class="qz-play" data-act="again">' + esc(T('play_again')) +
    '</button><button class="qz-ghost" data-act="menu">' + esc(T('change_settings')) +
    '</button></div>' +
    '</div>';
}

/* ---------- the sound & music drawer ----------
   Kwizzy puts its three switches in a burger above every screen. Here they live in one
   drawer opened from the start page's footer AND from the speaker button beside the ✕
   during a question (muting mid-round is a thing players do). Everything shown is the
   state of juice.js - this is presentation only. */
function toggleRow(id, label, on, extra) {
  return '<div class="qz-set' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') +
         '" data-set="' + id + '">' +
         '<span class="lbl">' + esc(label) + '</span>' +
         (extra ? '<span class="why">' + esc(extra) + '</span>' : '') +
         '<span class="sw"></span></div>';
}
function soundHTML() {
  var j = J();
  if (!j) return '<div class="qz-scrim" data-act="snd-close"></div><div class="qz-sheet">' +
                 '<div class="qz-h">' + esc(T('snd_title')) + '</div><div class="qz-note">' +
                 esc(T('no_sound_module')) + '</div></div>';
  var st = j.settings(), m = j.music();
  var canHap = j.hapticsSupported();
  var h = '<div class="qz-scrim" data-act="snd-close"></div><div class="qz-sheet">';
  h += '<div class="qz-h">' + esc(T('snd_title')) + '</div>';
  h += toggleRow('sfx', T('set_sfx'), st.sfx);
  h += toggleRow('music', T('set_music'), st.music, m.supported ? '' : T('no_audio'));
  h += toggleRow('haptics', T('set_haptics'), st.haptics && canHap,
                 canHap ? '' : T('no_vibrate'));
  /* the volume: a real slider, because a switch cannot express a loudness. A tap on the
     track sets the level to that spot (which is what makes a small slider usable on a
     phone), and the level is also written out - never state in movement alone. */
  h += '<div class="qz-vol' + (st.music ? '' : ' off') + '">' +
       '<span class="lbl">' + esc(T('volume')) + '</span>' +
       '<input type="range" min="0" max="100" step="5" value="' + Math.round(st.vol * 100) +
       '" id="qz-vol" aria-label="' + esc(T('volume')) + '">' +
       '<span class="pill">' + Math.round(st.vol * 100) + '%</span></div>';
  h += '<div class="qz-h">' + esc(T('music_choice')) + '</div><div class="chips qz-row">';
  h += '<button class="chip' + (st.trk === 'all' ? ' on' : '') + '" data-trk="all">' +
       esc(T('all_tracks')) + '</button>';
  var tr = j.tracks();
  for (var i = 0; i < tr.length; i++) {
    h += '<button class="chip' + (st.trk === tr[i].id ? ' on' : '') + '" data-trk="' + tr[i].id + '">' +
         esc(trackLabel(tr[i])) + '</button>';
  }
  h += '</div>';
  h += '<div class="qz-note" id="qz-now">' + esc(musicStatus(m)) + '</div>';
  h += '<div class="qz-actions"><button class="qz-ghost" data-act="snd-close">' +
       esc(T('done')) + '</button></div>';
  h += '</div>';
  return h;
}
/* What the music engine is doing, in words - the honest three states: playing, waiting
   for a first touch (the autoplay policy), or failed to load. */
function musicStatus(m) {
  if (!m.supported) return T('music_noengine');
  if (m.loadFailed) return T('music_failed');
  if (!J().settings().music) return T('music_off');
  if (m.running) return T('music_playing', { track: trackLabel({ id: m.playing || '' }) });
  return T('music_waiting');
}
/* a track's name in the UI language: the titles are ours, so they are translated where
   a translation reads naturally and left alone where it is a proper name */
function trackLabel(tr) {
  var k = tr && K_TRACK[tr.id];
  if (k) return T(k);
  return (tr && tr.label) || (tr && tr.id) || '';
}
function soundRender() {
  var el = soundEl || (soundEl = document.getElementById('qz-sound'));
  if (!el) return;
  applyDir();
  el.innerHTML = soundOpen ? soundHTML() : '';
  el.className = soundOpen ? 'qz-sound on' : 'qz-sound';
}
function soundToggle(open) {
  soundOpen = (open === undefined) ? !soundOpen : !!open;
  soundRender();
}

/* ---------- the stats sheet ----------
   Everything stats.js remembers, in the order a player cares about it: what I have done
   overall, how each mode and zone treats me, my best rounds, and the countries I keep
   getting wrong. Read-only except the Reset, which is a two-step button (a one-tap
   erase of a season's record is not a thing to offer by accident). */
function pctText(v, asked) {
  if (!asked) return '\u2014';
  return Math.round(v * 100) + '%';
}
function statRows(list, labelOf, n) {
  var h = '', shown = 0;
  for (var i = 0; i < list.length && shown < (n || 99); i++) {
    var r = list[i];
    shown++;
    h += '<div class="qz-srow"><span class="k">' + esc(labelOf(r.key)) + '</span>' +
         '<span class="v">' + pctText(r.pct, r.asked) + '</span>' +
         '<span class="q">' + r.correct + '/' + r.asked + '</span>' +
         (r.bestLen ? '<span class="b">' + esc(T('best_word', { score: r.best, len: r.bestLen })) + '</span>' : '') +
         '</div>';
  }
  return h || '<div class="qz-note">' + esc(T('nothing_yet')) + '</div>';
}
function countryRows(list) {
  var h = '';
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    h += '<div class="qz-crow">' + flagSpan(c.flag, 'fis') +
         '<span class="nm">' + esc(M.label(c.id) || c.name) + '</span>' +
         '<span class="q">' + c.correct + '/' + c.asked + '</span>' +
         '<span class="v">' + pctText(c.pct, c.asked) + '</span></div>';
  }
  return h;
}
function statsHTML() {
  var st = S();
  if (!st) {
    return '<div class="qz-scrim" data-act="stats-close"></div><div class="qz-sheet">' +
           '<div class="qz-h">' + esc(T('stats')) + '</div><div class="qz-note">' +
           esc(T('no_stats_module')) + '</div></div>';
  }
  var m = st.summary();
  /* a PINNED header and footer with a scrolling body: the record is longer than a
     phone screen, and a sheet whose title scrolls away and whose Close button is below
     the fold is a sheet you cannot get out of. */
  var h = '<div class="qz-scrim" data-act="stats-close"></div><div class="qz-sheet qz-statsheet">';
  h += '<div class="qz-shead"><span class="qz-h">' + esc(T('rec_title')) + '</span>' +
       '<button class="qz-x qz-xs" data-act="stats-close" aria-label="' + esc(T('close')) +
       '">\u2715</button></div>';
  h += '<div class="qz-sbody">';
  if (!m.asked) {
    h += '<div class="qz-note">' + esc(T('nothing_played')) + '</div>';
  } else {
    h += '<div class="qz-figs">' +
         '<div class="fig"><b>' + m.asked + '</b><span>' + esc(T('fig_questions')) + '</span></div>' +
         '<div class="fig"><b>' + Math.round(m.pct * 100) + '%</b><span>' + esc(T('fig_right')) + '</span></div>' +
         '<div class="fig"><b>' + m.bestStreak + '</b><span>' + esc(T('fig_streak')) + '</span></div>' +
         '<div class="fig"><b>' + m.played + '</b><span>' + esc(T('fig_rounds')) + '</span></div>' +
         '</div>';
    h += '<div class="qz-h">' + esc(T('by_mode')) + '</div>' + statRows(m.modes, modeLabel);
    h += '<div class="qz-h">' + esc(T('by_zone')) + '</div>' + statRows(m.zones, zoneLabel);
    if (m.cfgs.length) {
      h += '<div class="qz-h">' + esc(T('best_rounds')) + '</div>' +
           statRows(m.cfgs.slice(0, 4), function (k) {
             var p = String(k).split('|');
             return modeLabel(p[0]) + (p[1] ? ' \u00b7 ' + zoneLabel(p[1]) : '') +
                    (p[2] ? ' \u00b7 ' + diffLabel(p[2]) : '');
           });
    }
    if (m.missed.length) h += '<div class="qz-h">' + esc(T('costs')) + '</div>' + countryRows(m.missed);
    if (m.known.length) h += '<div class="qz-h">' + esc(T('never_missed')) + '</div>' + countryRows(m.known.slice(0, 6));
  }
  h += '</div>';
  h += '<div class="qz-sfoot">' +
       '<button class="qz-ghost" data-act="stats-reset">' +
       esc(statsArmed ? T('reset_confirm') : T('reset_stats')) + '</button>' +
       '<button class="qz-play" data-act="stats-close">' + esc(T('done')) + '</button></div>';
  h += '</div>';
  return h;
}
function statsRender() {
  if (!statsEl) statsEl = document.getElementById('qz-stats');
  if (!statsEl) return;
  applyDir();
  statsEl.innerHTML = statsOpen ? statsHTML() : '';
  statsEl.className = statsOpen ? 'qz-stats on' : 'qz-stats';
}
function statsToggle(open) {
  statsOpen = (open === undefined) ? !statsOpen : !!open;
  if (!statsOpen) statsArmed = false;
  statsRender();
}
function statsReset() {
  if (!statsArmed) { statsArmed = true; statsRender(); return; }
  statsArmed = false;
  if (S()) S().reset();
  statsRender();
  render();          /* the start page's "best here" line is now empty */
}

/* ---------- render ---------- */
/* RIGHT-TO-LEFT for Arabic, Persian and Hebrew: `dir` on the containers, so the flex
   rows (top bar, footer, the six answers, the sheets) flip. The map is untouched - it is
   a picture. Set on every render as well as on a language change, so a sheet opened
   later cannot be left in the old direction. */
function applyDir() {
  var d = dirOf();
  if (quizEl) quizEl.setAttribute('dir', d);
  if (soundEl) soundEl.setAttribute('dir', d);
  if (statsEl) statsEl.setAttribute('dir', d);
}

/* show the Back disc on every screen that HAS a way back, and name it in the language
   in play. The title has none (there is nowhere to go), a question has its own ✕. */
function setBack() {
  if (!backEl) return;
  var on = isMenu() && screen !== 'title';
  if (on) {
    if (backEl.removeAttribute) backEl.removeAttribute('hidden');
    backEl.hidden = false;
  } else {
    backEl.setAttribute('hidden', '');
    backEl.hidden = true;
  }
  backEl.setAttribute('aria-label', T('back'));
  backEl.setAttribute('title', T('back'));
}
function render() {
  if (!quizEl) return;
  applyDir();
  setBack();
  if (screen === 'title') quizEl.innerHTML = titleHTML();
  else if (screen === 'mode') quizEl.innerHTML = modeHTML();
  else if (screen === 'zone') quizEl.innerHTML = zoneHTML();
  else if (screen === 'diff') quizEl.innerHTML = diffHTML();
  else if (screen === 'about') quizEl.innerHTML = aboutHTML();
  else if (screen === 'question') quizEl.innerHTML = questionHTML();
  else quizEl.innerHTML = endHTML();
  quizEl.className = 'qz-on qz-' + screen;
  /* Kwizzy's entrance: the screen slides up, its blocks pop in behind it, staggered.
     Re-adding the class after a reflow is what makes the SECOND render of the same
     screen animate too (a wrong answer re-renders the question screen). */
  void quizEl.offsetWidth;
  quizEl.classList.add('anim-in');
  if (bodyEl && bodyEl.classList) {
    /* qz-playing: a question is up (the burger goes too); qz-owning: any quiz screen
       (the HUD and the help line go, they are instrumentation over the card) */
    if (screen === 'question') bodyEl.classList.add('qz-playing');
    else bodyEl.classList.remove('qz-playing');
    bodyEl.classList.add('qz-owning');
  }
  soundRender();
  statsRender();
  /* THE MAP DRIFTS BEHIND THE MENU. A slow, self-running travel of the perspective
     view - it is what makes the background alive rather than a screenshot - and it is
     switched off the moment a question is up, where the map is the QUESTION's picture
     and must hold still. */
  if (M.cinema) M.cinema(isMenu());
}
function isMenu() { return STEPS.indexOf(screen) >= 0 || screen === 'about'; }
function info(msg) { infoMsg = msg || ''; if (isMenu()) render(); }

/* ---------- the flow ---------- */
function startSession() {
  if (!flagsReady()) { info(T('loading_map')); return false; }
  if (cfg.mode === 'capital' && !capsReady()) { info(T('loading_caps')); return false; }
  /* HAND THE MAP OVER FIRST, then read the country list: enter() pins the layer, and
     the list must be the one the pinned layer actually draws (app.js paints the 50m
     layer and swaps the 10m one in when its 11 MB arrive - building the items before
     that would key a session to a layer that is no longer on screen). */
  if (!M.enter({ flat: cfg.mode === 'locate' })) { info(T('map_not_ready')); return false; }
  /* the items the session holds are the mode's own: countries for the three
     multiple-choice modes, cities for locate. */
  var items = cfg.mode === 'locate' ? M.cities() : M.items();
  var pool = poolOf(cfg);
  /* "six options" is the multiple-choice rule; locate needs a pool at all, and its
     round is capped to that pool by newSession. */
  if (pool.length < (cfg.mode === 'locate' ? 1 : Q.N_OPT)) {
    M.exit();
    info(T('not_enough', { zone: zoneLabel(cfg.zone) }));
    return false;
  }
  guess = null;
  session = Q.newSession(items, cfg, (Math.random() * 2147483647) | 0);
  infoMsg = '';
  var j = J();
  if (j) j.sfx('start');            /* the one loud yes of a run, as in Kwizzy */
  var was = screen;
  screen = 'question';
  nextQuestion();
  screenSfx(was);
  return true;
}
/* an airy swell under every screen change, as in Kwizzy: felt more than heard */
function screenSfx(from) {
  var j = J();
  if (j && from !== screen) j.sfx('screen');
}
function nextQuestion() {
  q = Q.nextQuestion(session);
  answered = false;
  chosen = -1;
  lastHover = -1;
  if (!q) { endScreen(); return; }
  /* EVERY mode flies to the country and lights it up, the flag ones included: the
     flag says what the country looks like, the map says where it is, and both
     variants of the flag question end on the same picture. */
  /* THE MAP MAY NAME THE COUNTRY, except where the name IS the answer:
       find the country        the name IS the answer            -> no label
       flag -> country         the name IS the answer            -> no label
       capital                 the CAPITAL is asked, the country
                               is given                          -> label
       country -> flag         the country is given, the flag is
                               the answer                        -> label
     So the label follows the QUESTION, not the mode: the same flag mode has one half
     that may say the name and one that may not. */
  if (M.labels) M.labels(q.mode === 'capital' || (q.mode === 'flag' && q.variant === 'flags'));
  guess = null;
  if (q.mode === 'locate') { locateArm(); render(); return; }
  if (M.aim) M.aim(false);
  if (M.clearMarks) M.clearMarks();
  M.show(q.answer.id);
  render();
}
/* ---------- LOCATE: arming the map ----------
   A locate question hands the map three things: an opening view of the ZONE (never of
   the city - that would be the answer), the COUNTRY NAMES left visible (the question is
   where a city is, not which country it is in - the shapes alone would make a 50 000
   town a lottery), and the aim: from now on a tap on the map reports a point instead of
   picking a country. */
function locateArm() {
  if (!q || q.mode !== 'locate') return;
  if (M.labels) M.labels(false);          /* no single country lit up: nothing is "the" one */
  if (M.countryNames) M.countryNames(true);
  if (M.clearMarks) M.clearMarks();
  if (M.goZone) M.goZone(q.answer && q.answer.cont, q.answer);
  if (M.aim) M.aim(true, onAim);
}
function onAim(pt) {
  if (!pt || screen !== 'question' || !q || q.mode !== 'locate' || answered) return;
  guess = { lon: pt.lon, lat: pt.lat };
  /* the marker is drawn by the map itself, so the player sees what they chose before
     they confirm - the picture is the state */
  if (M.marks) M.marks(guess, null, '');
  render();
}
function aimOff() {
  if (M.aim) M.aim(false);
  if (M.countryNames) M.countryNames(false);
}
/* CONFIRM: the answer is a point, so it goes through the point rule - distance,
   points, and the two marks that show the miss. */
function confirmGuess() {
  if (!q || q.mode !== 'locate' || answered || !guess) return false;
  var res = Q.answerPoint(session, q, guess);
  if (!res) return false;
  answered = true;
  bumped = res.ok;
  aimOff();
  var nm = M.placeLabel(q.answer.id) || q.answer.name;
  if (M.marks) M.marks(guess, { lon: q.answer.lon, lat: q.answer.lat }, nm);
  /* frame both points: the reveal is a picture, and two marks 200 km apart have to be
     two marks, not one */
  if (M.fitMarks) M.fitMarks();
  if (S()) S().answer(q, res.ok, { id: q.answer.id, name: nm });
  render();
  bumped = false;
  var j = J();
  if (j) {
    /* the juice says the same thing the number does: a bullseye gets the correct clip,
       a miss the wrong one - and 500+ points is neither, so it gets the neutral tap */
    var good = res.ok, half = res.points >= 500;
    j.haptic(good ? 60 : (half ? 30 : [25, 40, 25]));
    j.sfx(good ? 'correct' : (half ? 'tap' : 'wrong'));
  }
  return res.ok;
}

function choose(i) {
  if (!q || answered || screen !== 'question') return false;
  if (i < 0 || i >= q.options.length) return false;
  var res = Q.answerQuestion(session, q, i);
  if (!res) return false;
  answered = true;
  chosen = i;
  bumped = res.ok;
  /* ONCE ANSWERED, THE NAME IS NOT A SECRET ANY MORE: the verdict card prints it, so the
     map may name the country too - which is the moment a player wants the two pictures
     (the shape and the name) to be the same thing. */
  if (M.labels) M.labels(true);
  if (S()) S().answer(q, res.ok, q.answer);
  render();
  bumped = false;
  var j = J();
  if (j) {
    /* exactly Kwizzy's verdict feedback: one clean buzz for a right answer, a triple
       tap for a wrong one; a RISING clip for right, a FALLING rasp for wrong, so the
       two can never be mistaken for each other or for the tap. The words on the card
       say the same thing - the juice amplifies, it never carries the message. */
    j.haptic(res.ok ? 60 : [25, 40, 25]);
    j.sfx(res.ok ? 'correct' : 'wrong');
    /* a burst on the right option, wherever it sits in the grid - and a smaller one
       when the player got it wrong, on the answer they should have picked */
    var el = quizEl && quizEl.querySelector ? quizEl.querySelector('[data-i="' + q.correct + '"]') : null;
    if (el) setTimeout(function () { j.burstAt(el, res.ok ? 22 : 10); }, 60);
  }
  return res.ok;
}
function next() {
  if (!answered) return false;
  nextQuestion();
  return true;
}
function endScreen() {
  screen = 'end';
  render();
  screenSfx('question');
}
/* the ✕ during a round: the map goes back to the viewer and the player lands on the
   title, where a run starts */
function quit() {
  aimOff();
  if (M.clearMarks) M.clearMarks();
  session = null; q = null; answered = false; chosen = -1; guess = null;
  screen = 'title';
  infoMsg = '';
  M.exit();
  render();
  screenSfx('question');
}
function open() {
  if (screen === 'question' && session) return;
  screen = 'title';
  aimOff();
  session = null; q = null; answered = false; guess = null;
  M.exit();
  /* the map goes back to the GAME's palette: the title is a game screen */
  if (M.explore) M.explore(false);
  render();
}
/* WALK THE STEPS. `go` moves forward (and back through `back`), so the arrows, the
   keyboard and the tests all take one path. A step that is left clears the run: the
   screens own the config, never a session. */
function go(to) {
  if (to !== 'about' && STEPS.indexOf(to) < 0) return false;
  if (to === 'question' || to === 'end') return false;
  var was = screen;
  aimOff();
  guess = null;
  session = null; q = null; answered = false; chosen = -1;
  screen = to;
  infoMsg = '';
  render();
  screenSfx(was);
  return true;
}
function back() {
  if (screen === 'about') return go('title');
  var i = STEPS.indexOf(screen);
  if (i <= 0) return false;
  return go(STEPS[i - 1]);
}
/* "EXPLORE THE MAP INSTEAD": the viewer gets the whole screen back, and the BACKGROUND
   ANIMATION STOPS. It used to keep running here - the drift is switched from render(),
   and hide() never rendered - so free exploration was a map that wandered off on its own
   at twice the fit: the player could not hold a view. Leaving the game is also the moment
   the drift gives back the view it found (MapApp.cinema(false) restores the centre and
   the fitted zoom, see driftRestore in app.js). */
function hide() {
  aimOff();
  if (M.clearMarks) M.clearMarks();
  if (M.quizOn()) M.exit();
  if (M.cinema) M.cinema(false);
  /* ...and the chart turns GREY: free exploration is the map for its own sake, and its
     palette says so (see MapApp.explore / COL.landX in app.js) */
  if (M.explore) M.explore(true);
  quizEl.className = '';
  if (backEl) { backEl.hidden = true; backEl.setAttribute('hidden', ''); }
  if (bodyEl && bodyEl.classList) {
    bodyEl.classList.remove('qz-playing');
    bodyEl.classList.remove('qz-owning');
  }
}

/* ---------- input ---------- */
function attrUp(el, name) {
  while (el && el !== quizEl && el.getAttribute) {
    if (el.getAttribute('data-' + name) != null) return el;
    el = el.parentNode;
  }
  return null;
}
/* ONE delegated handler for the whole game, as Kwizzy has: a tap on anything pressable
   ticks (the clip is the same for every button), and each control then does its job. */
function onQuizClick(e) {
    var el = attrUp(e.target, 'act');
    if (el) {
      var act = el.getAttribute('data-act');
      if (act !== 'snd-close') tapSfx();          /* closing the drawer is not a press */
      /* the flow's own words: play/again start a round, go/back walk the menu, start
         is the Play of the last step (kept separate from play so the title's big
         button cannot start a round from a screen that has no difficulty yet) */
      if (act === 'start' || act === 'again') startSession();
      else if (act === 'play') go('mode');
      else if (act === 'go') go(el.getAttribute('data-to'));
      else if (act === 'back') back();
      else if (act === 'about') go('about');
      else if (act === 'next') next();
      else if (act === 'confirm') confirmGuess();
      else if (act === 'quit') quit();
      else if (act === 'menu') go('diff');
      else if (act === 'explore') hide();
      else if (act === 'snd-open') soundToggle(true);
      else if (act === 'snd-close') soundToggle(false);
      else if (act === 'stats-open') statsToggle(true);
      else if (act === 'stats-close') statsToggle(false);
      else if (act === 'stats-reset') statsReset();
      return;
    }
    /* the three switches and the music choice: juice.js owns the state, this renders it */
    el = attrUp(e.target, 'set');
    if (el) { switchToggle(el.getAttribute('data-set')); tapSfx(); return; }
    el = attrUp(e.target, 'trk');
    if (el) {
      var j0 = J();
      if (j0) { j0.setTrack(el.getAttribute('data-trk')); }
      tapSfx();
      soundRender();
      return;
    }
    el = attrUp(e.target, 'mode');
    if (el) { tapSfx(); cfg.mode = el.getAttribute('data-mode'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'zone');
    if (el) { tapSfx(); cfg.zone = el.getAttribute('data-zone'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'variant');
    if (el) { tapSfx(); cfg.variant = el.getAttribute('data-variant'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'len');
    if (el) {
      tapSfx();
      cfg.len = parseInt(el.getAttribute('data-len'), 10) || 0;
      storeCfg();
      info('');
      render();
      return;
    }
    el = attrUp(e.target, 'diff');
    if (el) { tapSfx(); cfg.difficulty = el.getAttribute('data-diff'); storeCfg(); info(''); render(); return; }
    el = attrUp(e.target, 'i');
    if (el) {
      /* an answer press: the tick, then the verdict clip 90 ms later (Kwizzy plays them
         as two sounds too - the tap of the press, then correct/wrong) */
      tapSfx();
      choose(parseInt(el.getAttribute('data-i'), 10));
      return;
    }
}

if (backEl && backEl.addEventListener) {
  backEl.addEventListener('click', function () {
    tapSfx();
    if (isMenu()) back(); else quit();
  });
}
if (quizEl && quizEl.addEventListener) {
  quizEl.addEventListener('click', onQuizClick);
  if (soundEl) soundEl.addEventListener('click', onQuizClick);
  if (statsEl) statsEl.addEventListener('click', onQuizClick);

  /* THE HIGHLIGHT MOVED: Kwizzy's `select` pip belongs to a selection step this game
     does not have (one tap answers). The nearest honest equivalent is the pointer
     moving onto an answer, so that is where it plays - and only for a real pointer,
     once per option, so a mouse sweeping the grid does not machine-gun six pips. */
  quizEl.addEventListener('mouseover', function (e) {
    var el = attrUp(e.target, 'i');
    if (!el) { lastHover = -1; return; }
    var i = parseInt(el.getAttribute('data-i'), 10);
    if (i === lastHover) return;
    lastHover = i;
    var j = J();
    if (j && !answered) j.sfx('select');
  });

  /* the volume slider: a live level, written straight into the master gain */
  function onVolInput(e) {
    var t = e.target;
    if (!t || t.id !== 'qz-vol') return;
    var j = J();
    if (j) j.setVol(parseInt(t.value, 10) / 100);
    var pill = quizEl.querySelector ? quizEl.querySelector('.qz-vol .pill') : null;
    if (pill) pill.textContent = t.value + '%';
    var now = document.getElementById('qz-now');
    if (now && j) now.textContent = musicStatus(j.music());
  }
  quizEl.addEventListener('input', onVolInput);
  if (soundEl) soundEl.addEventListener('input', onVolInput);
}

/* the tick: the same clip for every button, exactly as Kwizzy does it */
function tapSfx() {
  var j = J();
  if (j) j.sfx('tap');
}
/* one switch, from the row's data-set to juice.js and back into the row */
function switchToggle(which) {
  var j = J();
  if (!j) return;
  var st = j.settings(), el = null;
  if (quizEl && quizEl.querySelector) el = quizEl.querySelector('[data-set="' + which + '"]');
  if (which === 'sfx') j.setSfx(!st.sfx);
  else if (which === 'music') j.setMusic(!st.music);
  else if (which === 'haptics') j.setHaptics(!st.haptics);
  /* the tick for a switch turning ON comes from juice (it fires after the state, so the
     confirmation is heard); turning OFF must be silent - there is nothing to hear */
  if (el) {
    var now = j.settings();
    var on = which === 'sfx' ? now.sfx : which === 'music' ? now.music : now.haptics;
    el.classList.toggle('on', !!(on && (which !== 'haptics' || j.hapticsSupported())));
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  soundRender();
}
/* THE KEYBOARD WALKS THE SAME STEPS as the buttons: Enter goes on, Escape goes back -
   one key each, so a player who never touches the mouse can still play. During a
   question the digits answer and Enter takes the next one, as before. */
function stepForward() {
  if (screen === 'title') return go('mode');
  if (screen === 'mode') return go('zone');
  if (screen === 'zone') return go('diff');
  if (screen === 'diff') return startSession();
  return false;
}
window.addEventListener('keydown', function (e) {
  if (!quizEl || !quizEl.className) return;      /* the quiz is not on screen */
  if (screen === 'question') {
    if (e.key >= '1' && e.key <= '6') { tapSfx(); choose(parseInt(e.key, 10) - 1); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      /* a locate question has two states under Enter: confirm the marker, then go on */
      if (q && q.mode === 'locate' && !answered) confirmGuess(); else next();
      e.preventDefault(); return;
    }
    if (e.key === 'Escape') {
      if (soundOpen || statsOpen) { soundToggle(false); statsToggle(false); return; }
      quit(); return;
    }
  } else if (screen === 'end') {
    if (e.key === 'Enter') { startSession(); e.preventDefault(); return; }
    if (e.key === 'Escape') { go('diff'); return; }
  } else if (isMenu()) {
    if (e.key === 'Escape') {
      if (soundOpen || statsOpen) { soundToggle(false); statsToggle(false); return; }
      if (screen === 'title') hide(); else back();
      return;
    }
    if (e.key === 'Enter') { stepForward(); e.preventDefault(); }
  }
});

/* The start page is the FIRST page on load, before the map has anything on it: the
   buttons that need data say so and stay disabled until it lands (the map is
   fetched by app.js in the background, and a slow layer must not leave a dead
   Play button with no explanation). */
var readyTimer = null;
function watchReady() {
  if (readyTimer) return;
  readyTimer = setInterval(function () {
    if (!flagsReady()) return;
    if (!isMenu()) { clearInterval(readyTimer); readyTimer = null; return; }
    if (cfg.mode === 'capital' && !capsReady() && infoMsg) return;
    render();
    clearInterval(readyTimer); readyTimer = null;
  }, 400);
}

/* THE LANGUAGE IS THE MAP'S, so the map tells us when it moves: every screen the quiz
   owns is rebuilt (the words from i18n.js, the country and capital names from the
   layers, which the map has just reloaded). */
if (V && V.onLang) {
  V.onLang(function () {
    render();
    soundRender();
    statsRender();
  });
}

/* Boot the juice: the music engine starts loading its first track now (it may be
   refused until the first gesture - that is juice.js's business), and every change the
   engine reports re-renders the drawer, so the panel never claims a stale state. */
if (JU) { JU.onState = soundRender; JU.boot(); }

/* ---------- public, for the burger row and for the tests ---------- */
window.Quizzy = {
  open: function () { open(); },
  close: function () { hide(); },
  /* Read-mostly state, plus the two entry points the buttons use, so a headless
     test drives exactly the same path a tap does. */
  state: function () {
    return {
      screen: screen,
      mode: cfg.mode, zone: cfg.zone, difficulty: cfg.difficulty, len: cfg.len,
      /* the length of the ROUND IN PROGRESS, which "All" resolves against the pool
         (cfg.len stays 0 = All, so the choice survives) */
      roundLen: session ? session.cfg.len : cfg.len,
      variant: cfg.variant,
      index: session ? session.i : 0, score: session ? session.score : 0,
      answered: answered, chosen: chosen,
      points: session ? (session.points || 0) : 0,
      km: session ? (session.km || 0) : 0,
      guess: guess ? { lon: guess.lon, lat: guess.lat } : null,
      qkm: (q && q.km != null) ? q.km : null, qpoints: (q && q.points != null) ? q.points : null,
      question: q ? {
        mode: q.mode, variant: q.variant, correct: q.correct,
        answer: q.answer.name, answerId: q.answer.id, flag: q.answer.flag,
        capital: q.answer.cap,
        options: q.options.map(function (it) { return { name: it.name, cap: it.cap, flag: it.flag, id: it.id }; })
      } : null,
      info: infoMsg
    };
  },
  config: function () {
    return { mode: cfg.mode, zone: cfg.zone, difficulty: cfg.difficulty, variant: cfg.variant };
  },
  set: function (patch) {
    if (!patch) return;
    if (patch.mode) cfg.mode = patch.mode;
    if (patch.zone) cfg.zone = patch.zone;
    if (patch.difficulty) cfg.difficulty = patch.difficulty;
    if (patch.variant) cfg.variant = patch.variant;
    if (patch.len !== undefined) cfg.len = patch.len | 0;
    storeCfg();
    if (isMenu()) render();
  },
  start: function () { return startSession(); },
  go: function (to) { return go(to); },
  back: function () { return back(); },
  choose: function (i) { return choose(i); },
  /* LOCATE's own two entries: a point answer has no button index, so the test (and the
     keyboard, and the Confirm button) go through this, and the state above reports the
     marker so a test can see what the player would be confirming */
  confirm: function () { return confirmGuess(); },
  guess: function () { return guess ? { lon: guess.lon, lat: guess.lat } : null; },
  next: function () { return next(); },
  quit: function () { quit(); },
  html: function () { return quizEl ? quizEl.innerHTML : ''; },
  best: function () { return bestOf(); },
  stats: function () { return S(); },
  lang: function () { return lang(); },
  dir: function () { return dirOf(); },
  t: function (k, vars) { return T(k, vars); },
  statsOpen: function () { return statsOpen; },
  statsToggle: function (open) { statsToggle(open); return statsOpen; },
  statsHtml: function () { return statsEl ? statsEl.innerHTML : ''; },
  /* the sound drawer, and the juice module itself (null when absent) */
  sound: function () { return { open: soundOpen, html: soundEl ? soundEl.innerHTML : '' }; },
  soundToggle: function (open) { soundToggle(open); return soundOpen; },
  /* the burger's sound switches live in app.js: after one of them changes the engine,
     the drawer (open behind it, or opened later) must show the same state */
  soundRender: function () { soundRender(); },
  juice: function () { return J(); }
};

render();
watchReady();
})();

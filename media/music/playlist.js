/* Kwizzy — the ambient-music playlist, as pure state with no DOM, no Audio and no timer.
   The browser reads it as a plain <script> (it defines window.KwizzyPlaylist); Node reads
   the same file with require() (media/music/playlist.test.js) — one source, no build step,
   so the rule the player hears is the rule the test checks.

   The rules, in the player's words (the Music menu):
     - "All" (the default) plays the tracks in a random order; a track repeats REPEATS
       times, then the next track of the order fades in over the tail of the previous one.
       The order opens on FIRST, the track the app is asked to load at startup.
     - Picking one track loops that one track and never moves on.

   Loop state is carried by the play counter alone, never by time: cycle() is called once
   per completed play, and while a crossfade is running the caller does not call it again.

   The CommonJS test is written with typeof on BOTH sides on purpose: `module` does not exist
   in a browser at all, so a plain `module.exports` check would throw a ReferenceError there
   (a bare `module && …` still throws) and window.KwizzyPlaylist would never be defined. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && typeof module.exports !== "undefined" && module.exports) {
    module.exports = api;                                                   // Node test
  } else {
    root.KwizzyPlaylist = api;                                              // browser
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TRACKS = [
    { id: "arcade_quiz_02",  label: "Arcade quiz",        file: "arcade_quiz_02.mp3" },
    { id: "jazzy_lounge_01", label: "Jazzy lounge #1",    file: "jazzy_lounge_01.mp3" },
    { id: "jazzy_lounge_02", label: "Jazzy lounge #2",    file: "jazzy_lounge_02.mp3" },
    { id: "jazzy_lounge_04", label: "Jazzy lounge, slow", file: "jazzy_lounge_04.mp3" },
    { id: "light_ambient",   label: "Light ambient",      file: "light_ambient.mp3" }
  ];

  var ALL = "all";        // the "shuffle the whole set" choice (the default)
  var REPEATS = 3;        // a track plays this many times, then the next one fades in
  var FIRST = "light_ambient";   // the one the app loads at startup: the "All" order opens on it

  function ids() {
    var out = [], i;
    for (i = 0; i < TRACKS.length; i++) out.push(TRACKS[i].id);
    return out;
  }

  /* Uniform shuffle, in place. Math.random is the only thing this module borrows from the
     outside world, and nothing else here depends on it. */
  function shuffle(a, rnd) {
    var r = rnd || Math.random, i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(r() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function indexOf(id) {
    var i;
    for (i = 0; i < TRACKS.length; i++) if (TRACKS[i].id === id) return i;
    return -1;
  }

  /* A selection that is not a known track id is "All": the default is forgiving, so a
     stale saved choice can never leave the player with no music at all. */
  function validTrack(id) { return id === ALL || indexOf(id) >= 0; }

  function label(id) {
    if (id === ALL) return "All";
    var i = indexOf(id);
    return i < 0 ? "All" : TRACKS[i].label;
  }

  /* A fresh order for "All": every track exactly once in a random order, except that the
     ambient track the app opens on (FIRST) is always played first — the startup track is a
     fixed promise, and everything after it is the shuffle the player asked for. Any track id
     that is not in the set (an older payload, say) simply leaves the plain shuffle in place. */
  function shuffleOrder(rnd) {
    var order = shuffle(ids(), rnd);
    var at = order.indexOf(FIRST);
    if (at > 0) {
      order.splice(at, 1);
      order.unshift(FIRST);
    }
    return order;
  }

  function makeState(track) {
    track = validTrack(track) ? track : ALL;
    return {
      track: track,          // "all", or the id of the one looping track
      order: shuffleOrder(), // the random order the "all" mode walks through
      offset: 0,             // how far into that order we are
      loops: 0               // completed plays of the track currently playing
    };
  }

  /* Which track is playing, and where it sits in the order. One track selected leaves the
     shuffle untouched, so switching back to "All" resumes the same order. */
  function pick(state) {
    if (state.track !== ALL) {
      var one = indexOf(state.track);
      return { index: one < 0 ? 0 : one, order: 1, nth: 1 };
    }
    var n = state.order.length;
    var offset = ((state.offset % n) + n) % n;
    return { index: indexOf(state.order[offset]), order: n, nth: offset + 1 };
  }

  /* One play finished. Under "All": count it while the track has repeats left, otherwise
     step to the next track of the order and start its count again. A single selected track
     loops forever and its counter is dropped, so the menu shows no "x of 3". */
  function cycle(state) {
    if (state.track !== ALL) { state.loops = 0; return "loop"; }
    state.loops++;
    if (state.loops < REPEATS) return "repeat";
    state.loops = 0;
    state.offset = (state.offset + 1) % state.order.length;
    return "next";
  }

  /* The player picked another choice: keep the order, restart the count. */
  function select(state, track) {
    state.track = validTrack(track) ? track : ALL;
    state.loops = 0;
    return state;
  }

  /* Is the play about to start the LAST one of this track? Read-only: the caller may not
     cycle() yet (that would count it twice), it only needs to know whether to let the next
     track fade in over the tail of this one. A single selected track never has a last play. */
  function lastPlay(state) {
    if (state.track !== ALL) return false;
    return (state.loops + 1) >= REPEATS;
  }

  /* The track that will be picked once the CURRENT play ends, or null when it is the same
     one (a repeat, or a single selected track). Lets the engine warm that buffer while the
     current play is still running: the next fetch costs seconds, and 25 s of music hides
     them. Read-only like lastPlay(). */
  function nextId(state) {
    if (state.track !== ALL) return null;
    if ((state.loops + 1) < REPEATS) return null;
    var n = state.order.length;
    var nextOffset = ((((state.offset + 1) % n) + n) % n);
    return indexOf(state.order[nextOffset]) >= 0 ? state.order[nextOffset] : null;
  }

  function trackAt(index) { return TRACKS[index]; }

  return {
    TRACKS: TRACKS, ALL: ALL, REPEATS: REPEATS, FIRST: FIRST,
    ids: ids, label: label, indexOf: indexOf, validTrack: validTrack,
    shuffle: shuffle, shuffleOrder: shuffleOrder,
    makeState: makeState, pick: pick, cycle: cycle, select: select,
    lastPlay: lastPlay, nextId: nextId, trackAt: trackAt
  };
});

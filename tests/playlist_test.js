/* Tests for the playlist rules the Music menu promises (see playlist.js):
     - "All" walks every track once per round, in a random order;
     - a track repeats exactly REPEATS times before the next one is reached;
     - picking a single track loops it and never advances.
   Run: node tests/playlist_test.js   (no dependencies, no framework)
   This is Kwizzy's media/music/playlist.test.js, moved with its module: only the
   require() path changed. The rules it checks are the ones this app now plays. */
"use strict";

const P = require(__dirname + "/../media/music/playlist.js");

let pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log("  ok   " + what); }
  else { fail++; console.log("  FAIL " + what); }
}
function eq(a, b, what) { ok(a === b, what + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function group(name) { console.log("\n" + name); }

/* A deterministic shuffle so a failure is reproducible: a fixed pseudo-random stream. */
function seeded(seed) {
  let x = seed >>> 0;
  return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

group("the track set");
ok(P.TRACKS.length === 5, "five tracks are declared");
ok(P.ids().indexOf("light_ambient") >= 0, "light_ambient is one of them");
eq(P.label("all"), "All", 'the "all" choice is labelled All');
eq(P.label("light_ambient"), "Light ambient", "a track resolves to its menu label");
eq(P.label("nonsense"), "All", "an unknown saved choice falls back to All");
ok(P.validTrack("all") && P.validTrack("arcade_quiz_02") && !P.validTrack("nope"),
   "validTrack accepts all + known ids, rejects the rest");

group("shuffle");
{
  const a = P.shuffle([1, 2, 3, 4, 5], seeded(7));
  eq(a.length, 5, "nothing is lost");
  eq(a.slice().sort().join(","), "1,2,3,4,5", "the shuffle is a permutation");
  let moved = false;
  for (let seed = 1; seed <= 40 && !moved; seed++) {
    if (P.shuffle(P.ids(), seeded(seed)).join(",") !== P.ids().join(",")) moved = true;
  }
  ok(moved, "the order actually changes with the random stream");
}

group('the "All" order opens on the startup track');
{
  eq(P.FIRST, "light_ambient", "the startup track is declared as light_ambient");
  let always = true, alwaysPermutation = true, sawOthers = false;
  for (let seed = 1; seed <= 50; seed++) {
    const order = P.shuffleOrder(seeded(seed));
    if (order[0] !== P.FIRST) always = false;
    if (order.slice().sort().join(",") !== P.ids().sort().join(",")) alwaysPermutation = false;
    if (order[1] !== P.FIRST) sawOthers = true;
  }
  ok(always, "the ambient track is the FIRST track of every shuffled order");
  ok(alwaysPermutation, "and the order is still every track exactly once");
  ok(sawOthers, "the tracks that follow it do move around with the random stream");
  const st = P.makeState("all");
  eq(P.trackAt(P.pick(st).index).id, P.FIRST, "so a fresh visit starts on the ambient track");
}

group('"All": three plays per track, then the next one');
{
  const s = P.makeState("all");
  eq(s.loops, 0, "a fresh round starts at 0 plays");
  eq(s.offset, 0, "and at the first track of the order");
  eq(s.order.length, 5, "the order holds every track once");

  const seen = [];
  for (let i = 0; i < 15; i++) {
    const p = P.pick(s);
    seen.push(p.index);
    const verdict = P.cycle(s);
    const last = i % 3 === 2;
    eq(verdict, last ? "next" : "repeat",
       "play " + (i + 1) + " of the round is " + (last ? "the third, so it advances" : "not the third, so it repeats"));
  }
  ok(seen[0] === seen[1] && seen[1] === seen[2], "one track owns the first three plays");
  ok(seen[3] === seen[4] && seen[4] === seen[5], "the next track owns the next three");
  eq(s.offset, 0, "after 5 tracks x 3 plays the round wraps to the start");

  const firstRound = [];
  const s2 = P.makeState("all");
  for (let i = 0; i < 5; i++) { firstRound.push(P.pick(s2).index); P.cycle(s2); P.cycle(s2); P.cycle(s2); }
  eq(new Set(firstRound).size, 5, "each track of the order is played once per round");

  const p = P.pick(s2);
  eq(p.nth, 1, "pick() reports the position in the order (1-based)");
  eq(p.order, 5, "and how many tracks the order has");
}

group('"All" counts keep advancing under a longer walk');
{
  const s = P.makeState("all");
  const counts = {};
  for (let i = 0; i < 5 * P.REPEATS * 4; i++) {
    counts[P.pick(s).index] = (counts[P.pick(s).index] || 0) + 1;
    P.cycle(s);
  }
  const values = Object.keys(counts).map(k => counts[k]);
  ok(values.length === 5 && values.every(v => v === 3 * 4),
     "over four rounds every track is played exactly 3 x 4 times");
  eq(s.offset, 0, "four rounds land back on the start of the order");
}

group("one selected track loops forever");
{
  const s = P.makeState("jazzy_lounge_01");
  const p = P.pick(s);
  eq(p.index, P.indexOf("jazzy_lounge_01"), "pick() resolves the selected track");
  eq(p.order, 1, "a single choice has a one-track order");
  eq(p.nth, 1, "and is always the first of it");
  let advanced = 0, verdicts = [];
  for (let i = 0; i < 10; i++) {
    const before = P.pick(s).index;
    verdicts.push(P.cycle(s));
    if (P.pick(s).index !== before) advanced++;
  }
  eq(advanced, 0, "ten plays never move to another track");
  eq(verdicts.join(","), Array(10).fill("loop").join(","), "every play is reported as a loop");
  eq(s.loops, 0, "the counter stays at 0, so the menu shows no x of 3");
  eq(s.offset, 0, "and the All order is left alone for when the player goes back to it");
}

group("switching selection");
{
  const s = P.makeState("all");
  const orderBefore = s.order.join(",");
  P.cycle(s); P.cycle(s); P.cycle(s);
  P.select(s, "light_ambient");
  eq(s.track, "light_ambient", "select() takes the new choice");
  eq(s.loops, 0, "select() restarts the play count");
  eq(s.order.join(","), orderBefore, "the shuffled order survives the detour");
  P.select(s, "all");
  eq(s.track, "all", "and going back to All keeps that same order");
  const t = P.makeState("not-a-track");
  eq(t.track, "all", "an unknown choice is stored as All");
}

group("lastPlay: the rule the engine asks before starting a play");
{
  const s = P.makeState("all");
  ok(P.lastPlay(s) === false, "a fresh round: the 1st play is not the last");
  P.cycle(s);
  ok(P.lastPlay(s) === false, "after 1 play: the 2nd is not the last either");
  P.cycle(s);
  ok(P.lastPlay(s) === true, "after 2 plays: the 3rd IS the last, so the next track crossfades");
  eq(P.lastPlay(s), true, "and asking twice changes nothing (read-only, it never counts)");
  P.cycle(s);
  ok(P.lastPlay(s) === false, "after the advance: the new track starts its own 3 plays");
  const one = P.makeState("light_ambient");
  ok(P.lastPlay(one) === false, "a single selected track has no last play, ever");
  P.cycle(one); P.cycle(one); P.cycle(one);
  ok(P.lastPlay(one) === false, "and cycling it never invents one");
}

group("nextId: which track the engine must already be downloading");
{
  /* state.loops counts the plays ALREADY finished, so the play about to start is the
     (loops+1)-th: with 2 finished, play 3 is the last one of this track. */
  const s = P.makeState("all");
  ok(P.nextId(s) === null, "play 1 of 3: after it comes the same track again, nothing to warm");
  P.cycle(s);
  ok(P.nextId(s) === null, "play 2 of 3: after it comes the same track again, nothing to warm");
  P.cycle(s);
  const id = P.nextId(s);
  ok(typeof id === "string", "play 3 of 3 (2 already done): the next track of the order, warm now");
  const cur = P.trackAt(P.pick(s).index).id;
  ok(id !== cur, "and it is a DIFFERENT track than the one playing");
  P.cycle(s);
  ok(P.nextId(s) === null, "after the advance: the new track starts its own repeats");
  const one = P.makeState("light_ambient");
  ok(P.nextId(one) === null, "a single selected track never needs another one warmed");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

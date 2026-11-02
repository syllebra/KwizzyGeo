#!/usr/bin/env node
/* STAMP THE CACHE-BUSTERS FROM THE FILES THEMSELVES.

   WHY THIS EXISTS. The `?v=` numbers in `index.html` are the only thing that makes a
   browser fetch a new copy of a file, and they were bumped BY HAND. On 2026-11-02 that
   failed in the worst possible way: `quizcore.js?v=5` was stamped once, in the first
   France commit, and then quizcore.js gained the sixth mode ("place the département")
   without its number moving. The server had the new file at that URL; every browser that
   had already loaded `?v=5` kept the OLD one for ever, so the player saw five modes and
   the whole team saw six. A cache-buster you have to remember is a cache-buster that
   lies.

   THE RULE NOW: `?v=` is a NUMBER DERIVED FROM THE CONTENT (the first 8 hex digits of the
   file's sha1, as a decimal), and `tests/cache_test.js` recomputes it for every asset the
   page loads. Edit a file and forget to run this script -> the test fails, so a stale
   stamp cannot be shipped. A decimal (not a hex string) keeps every existing `\?v=\d+`
   regex in the tests, in the scripts and in the page's self-heal working unchanged.

   Run:  node tools/stamp.js          (rewrites index.html in place, prints what moved)
         node tools/stamp.js --check  (exit 1 if anything is stale, write nothing)
   It is also run by tools/screens.js and by the release steps, and it is cheap: a few
   reads and a regex. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'index.html');

function stampOf(file) {
  const buf = fs.readFileSync(path.join(ROOT, file));
  const h = crypto.createHash('sha1').update(buf).digest('hex');
  /* 8 hex digits -> a decimal under 2^32: unique enough for a cache-buster, and still a
     plain `\d+` for every regex that reads it */
  return String(parseInt(h.slice(0, 8), 16));
}

function scan(html) {
  const out = [];
  const re = /(src|href)="([^":]+?)\?v=(\d+)"/g;
  let m;
  while ((m = re.exec(html))) out.push({ attr: m[1], file: m[2], have: m[3], want: stampOf(m[2]),
                                         at: m.index, len: m[0].length });
  return out;
}

const html = fs.readFileSync(PAGE, 'utf8');
const found = scan(html);
const stale = found.filter(s => s.have !== s.want);

if (process.argv.indexOf('--check') >= 0) {
  found.forEach(s => { if (s.have !== s.want) console.log('STALE ' + s.file + ': v=' + s.have + ' -> ' + s.want); });
  console.log(found.length + ' stamped assets, ' + stale.length + ' stale');
  process.exit(stale.length ? 1 : 0);
}

if (!stale.length) {
  console.log(found.length + ' stamped assets, all current');
} else {
  /* rewrite from the END so the earlier offsets stay valid */
  let next = html;
  stale.slice().reverse().forEach(s => {
    const oldTxt = next.substr(s.at, s.len);
    const newTxt = oldTxt.replace(/\?v=\d+"/, '?v=' + s.want + '"');
    next = next.slice(0, s.at) + newTxt + next.slice(s.at + s.len);
    console.log('  ' + s.file + ': v=' + s.have + ' -> ' + s.want);
  });
  fs.writeFileSync(PAGE, next);
  console.log(found.length + ' stamped assets, ' + stale.length + ' re-stamped');
}

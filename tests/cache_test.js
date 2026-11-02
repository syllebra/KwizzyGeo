/* node test: THE CACHE-BUSTERS ARE TRUE.
   What is asserted, and why each one is a thing that actually broke:

     * every local asset the page loads carries `?v=<hash of the file>`, i.e. the number
       is DERIVED FROM THE CONTENT, not remembered. On 2026-11-02 `quizcore.js?v=5` was
       stamped once and the file then gained a sixth mode without its number moving: the
       server had the new file at that URL and every browser that had already loaded it
       kept the old one, so the player saw five modes where the build had six. That is
       the failure this file exists to make impossible.
     * nothing local is loaded WITHOUT a `?v=` (an unstamped file is cached for ever),
       and nothing stamped points at a file that does not exist (a 404 on every load).
     * `index.html` itself carries no `?v=` (it is the page, and its own freshness is
       handled by the self-heal script at the end of it - see the README).
     * the self-heal script is present, guards itself with sessionStorage, and reads the
       SAME `app.js?v=` shape the page uses, so it cannot be silently half-renamed.
     * the build stamp on the credits screen is generated from the `<script>` tags, so a
       player can always read which build their tab is on.

   Run: node tests/cache_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'index.html');
const html = fs.readFileSync(PAGE, 'utf8');

let checks = 0, fails = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function stampOf(file) {
  const buf = fs.readFileSync(path.join(ROOT, file));
  return String(parseInt(crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8), 16));
}

/* ---------- 1. every stamp equals its file ---------- */
(function () {
  const re = /(?:src|href)="([^":]+?)\?v=(\d+)"/g;
  const seen = [];
  let m;
  while ((m = re.exec(html))) seen.push({ file: m[1], v: m[2] });
  check('the page stamps a dozen assets', seen.length >= 10, seen.length);
  seen.forEach(s => {
    const exists = fs.existsSync(path.join(ROOT, s.file));
    check('stamped asset exists: ' + s.file, exists);
    if (!exists) return;
    const want = stampOf(s.file);
    check('the stamp of ' + s.file + ' matches its content', s.v === want,
          'page v=' + s.v + ', file hashes to ' + want + '  -> run node tools/stamp.js');
    check('...and it is a plain number (every regex reading it expects \\d+)', /^\d+$/.test(s.v), s.v);
  });
})();

/* ---------- 2. nothing local is loaded unstamped ---------- */
(function () {
  const all = html.match(/(?:src|href)="([^"]+)"/g) || [];
  const local = all.filter(x => !/^href="https?:/.test(x) && !/favicon/.test(x) &&
                                !/^src="https:/.test(x));
  const bare = local.filter(x => !/\?v=/.test(x));
  check('no local asset is loaded without a ?v=', bare.length === 0, bare.join(' '));
  const page = local.filter(x => /"index\.html/.test(x));
  check('the page itself is never stamped', page.length === 0, page.join(' '));
})();

/* ---------- 3. the self-heal ---------- */
(function () {
  check('index.html carries the self-heal script', /kwizzy\.reloaded/.test(html));
  check('...which fetches its own HTML with no-store', /no-store/.test(html));
  check('...reads the app.js?v= shape the page uses', /app\\\.js\\\?v=\(\\d\+\)/.test(html) ||
        /app\.js\\\?v=\(\\d\+\)/.test(html), 'regex not found');
  check('...and can reload at most once per version',
        /sessionStorage\.getItem\('kwizzy\.reloaded'\)/.test(html) &&
        /sessionStorage\.setItem\('kwizzy\.reloaded'/.test(html));
  /* the script must be LAST: it reads the tags above it */
  const healAt = html.indexOf('kwizzy.reloaded');
  const quizTag = html.indexOf('src="quiz.js?v=');
  check('...and it runs after every other script', healAt > quizTag, healAt + ' vs ' + quizTag);
})();

/* ---------- 4. the build stamp on the credits screen ---------- */
(function () {
  const quiz = fs.readFileSync(path.join(ROOT, 'quiz.js'), 'utf8');
  check('quiz.js builds the credits stamp from the <script> tags',
        /function buildStamp/.test(quiz) && /getElementsByTagName\('script'\)/.test(quiz));
  check('...naming the four files a player can compare',
        /'app\.js'/.test(quiz) && /'quiz\.js'/.test(quiz) && /'quizcore\.js'/.test(quiz) &&
        /'i18n\.js'/.test(quiz));
  check('...and the credits screen shows it', /ab_build/.test(quiz));
})();

console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
process.exit(fails ? 1 : 0);

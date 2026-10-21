/* FLAGS test: every flag the app can ask for exists, and the ones it deliberately
   does not draw stay undrawn.

   The failure mode here is quiet: a <span class="fi fi-xx"> with no matching rule and
   no SVG renders as an empty 1.33em box - a gap where a flag should be, no error, no
   404 the page reports. So the assertion is against the FILES, and it is driven by the
   same two tables app.js uses (parsed out of it, not copied), so a code added there
   fails this test until the SVG is vendored.
   The other half matters more: a flag is a claim about sovereignty. The ambiguous
   features - Somaliland, Northern Cyprus, Siachen - must NOT get one. */
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return true;
  fails++;
  console.log('FAIL ' + name + (detail !== undefined ? '   [' + detail + ']' : ''));
  return false;
}

const app = fs.readFileSync(path + 'app.js', 'utf8');
const css = fs.readFileSync(path + 'flags.css', 'utf8');
const shipped = new Set(fs.readdirSync(path + 'data/flags').filter(f => /\.svg$/.test(f))
  .map(f => f.replace(/\.svg$/, '')));

function table(name) {
  const m = new RegExp('var ' + name + ' = \\{([\\s\\S]*?)\\};').exec(app);
  if (!m) return null;
  const out = {};
  for (const r of m[1].matchAll(/(?:'([^']+)'|(\w+))\s*:\s*'([A-Za-z]{2})'/g)) {
    out[r[1] || r[2]] = r[3].toLowerCase();
  }
  return out;
}

/* ---------- 1. the two hand-written tables are complete ---------- */
const langFlag = table('LANG_FLAG');
const neIso2 = table('NE_ISO2');
check('LANG_FLAG is in app.js', langFlag && Object.keys(langFlag).length === 18,
      langFlag ? Object.keys(langFlag).length + ' entries' : 'missing');
check('NE_ISO2 is in app.js', neIso2 && Object.keys(neIso2).length > 20,
      neIso2 ? Object.keys(neIso2).length + ' entries' : 'missing');

const wanted = new Set([...Object.values(langFlag || {}), ...Object.values(neIso2 || {})]);
for (const c of wanted) {
  check('the SVG for ' + c + ' is vendored', shipped.has(c), c);
  check('flags.css has a rule for ' + c, css.indexOf('.fi-' + c + '{') >= 0, c);
}

/* ---------- 2. every ISO code the data can produce ---------- */
const seen = new Set();
for (const layer of ['so50.geojson', 'countries.geojson', 'ne10m.geojson']) {
  const geo = JSON.parse(fs.readFileSync(path + 'data/' + layer, 'utf8'));
  for (const f of geo.features) {
    const iso = String(f.properties.ISO_A2 || '');
    if (/^[A-Za-z]{2}$/.test(iso)) seen.add(iso.toLowerCase());
    const m = /^([A-Za-z]{2})-/.exec(iso);
    if (m) seen.add(m[1].toLowerCase());
  }
}
/* `xd` is UNDOF Zone - a UN buffer zone on the Golan, with an ISO-like code and no
   flag in the library at all. Allowing it by name is better than a wildcard: any
   OTHER code that starts failing after a data rebuild is a real bug. */
const KNOWN_FLAGLESS = new Set(['xd']);
const missing = [...seen].filter(c => !shipped.has(c) && !KNOWN_FLAGLESS.has(c));
check('every plain ISO_A2 in the data has a flag', missing.length === 0, missing.join(' '));
check('and a CSS rule for each of them',
      [...seen].filter(c => !KNOWN_FLAGLESS.has(c)).every(c => css.indexOf('.fi-' + c + '{') >= 0),
      [...seen].filter(c => !KNOWN_FLAGLESS.has(c) && css.indexOf('.fi-' + c + '{') < 0).join(' '));
check('the only code allowed to have no flag is the UNDOF Zone', KNOWN_FLAGLESS.size === 1);

/* ---------- 3. the stylesheet points at the files that exist ---------- */
const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
check('the stylesheet links ' + shipped.size + ' flags', urls.length === shipped.size,
      urls.length + ' urls for ' + shipped.size + ' files');
const badRef = urls.filter(u => {
  /* flags.css sits at the repository root */
  const rel = u.replace(/^\.?\//, '');
  return !fs.existsSync(path + rel);
});
check('every url() in flags.css resolves', badRef.length === 0, badRef.slice(0, 4).join(' '));
check('the urls are root-relative, not ../ (flags.css lives at the root)',
      urls.every(u => u.indexOf('../') !== 0), urls[0]);
check('the library class names are kept', /\.fi\{/.test(css) && /\.fi\.fis\{/.test(css));

/* ---------- 4. the licence travels with the assets ---------- */
check('the flag-icons licence ships', fs.existsSync(path + 'flags.LICENSE.txt'));
check('it names the library and its author',
      /MIT/.test(fs.readFileSync(path + 'flags.LICENSE.txt', 'utf8')) &&
      /Panayiotis Lipiridis/.test(fs.readFileSync(path + 'flags.LICENSE.txt', 'utf8')));
check('flags.css says where they came from', /lipis\/flag-icons/.test(css));

/* ---------- 5. the app's rule, exercised ---------- */
const C = new Function(fs.readFileSync(path + 'core.js', 'utf8') + '\nreturn CORE;')();
const so50 = JSON.parse(fs.readFileSync(path + 'data/so50.geojson', 'utf8'));
const byName = {};
for (const f of so50.features) byName[f.properties.NAME] = f.properties;

/* the exact code path, pulled out of app.js by running it in a sandbox */
const sandbox = `
var out = {};
${neIso2 ? '' : ''}
${/var NE_ISO2 = \{[\s\S]*?\};/.exec(app)[0]}
${/function flagCodeOf[\s\S]*?\n\}/.exec(app)[0]}
${/function flagHTML[\s\S]*?\n\}/.exec(app)[0]}
out.flagCodeOf = flagCodeOf; out.flagHTML = flagHTML;
return out;`;
const F = new Function(sandbox)();

for (const [name, want] of [['France', 'fr'], ['Germany', 'de'], ['United States of America', 'us'],
                            ['United Kingdom', 'gb'], ['Norway', 'no'], ['Taiwan', 'tw'],
                            ['Netherlands', 'nl'], ['Australia', 'au'], ['China', 'cn']]) {
  const p = byName[name];
  if (!p) { check('the layer has ' + name, false); continue; }
  const got = F.flagCodeOf(p);
  check(name + ' gets its flag (' + want + ')', got === want, got + ' (ISO_A2=' + p.ISO_A2 + ')');
}
/* the ones that must stay flagless, and why */
for (const name of ['Somaliland', 'Northern Cyprus', 'Siachen Glacier']) {
  const p = byName[name];
  if (!p) continue;
  const got = F.flagCodeOf(p);
  check(name + ' is deliberately left without a flag', got === '', got);
}
check('a flag span is produced for a known code',
      F.flagHTML('fr') === '<span class="fi fi-fr"></span>', F.flagHTML('fr'));
check('nothing at all for an empty code', F.flagHTML('') === '', F.flagHTML(''));
check('a two-letter code the library has no flag for still gets the span (and the'
      + ' browser shows nothing, which is the honest result)',
      F.flagHTML('xd') === '<span class="fi fi-xd"></span>', F.flagHTML('xd'));

console.log(fails ? '\n' + fails + ' of ' + checks + ' FAILED' : checks + ' checks, ALL PASS');
process.exit(fails ? 1 : 0);

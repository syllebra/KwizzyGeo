/* the 3D app's own core.js is the vendored one; make sure the app's globals
   (ringGlobeTris / sewGlobeLadder) are exported and that the 2D path still
   uses the untouched 2D ladder */
const fs = require('fs');
const core = fs.readFileSync(__dirname + '/core.js', 'utf8');
const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
const need = ['sewGlobeLadder', 'ringGlobeLLAtLevel', 'ringGlobeTris'];
for (const n of need) {
  const def = new RegExp('^function ' + n, 'm').test(core);
  const exp = new RegExp(n + ':').test(core);
  console.log(n + ': defined ' + def + ', exported ' + exp);
}
// 2D path must not touch the globe ladder
const bad = /\bC\.ringGlobe(Tris|LLAtLevel)\b/.test(app) ? 'globe ladder used' : 'ok';
console.log('app uses globe ladder:', bad);
// every globe-side use of the 2D ladder would be a bug
const suspect = app.match(/C\.ringLLAtLevel|rg\.levels\[lvl\]/g);
console.log('2D-ladder uses left in app.js:', suspect ? suspect.join(',') : 'none');
// levels[FIN] / ll-based inter maps are fine (they read the FINE ring, shared by both ladders)
console.log('core.js lines:', core.split('\n').length, 'app.js lines:', app.split('\n').length);

// find identifiers used at module level in core.js that are never declared
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/core.js', 'utf8');
// strip block comments and line comments (naive but our code has no /* inside strings,
// and no // inside string literals except URLs; good enough to find lost declarations)
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const declared = new Set();
const varRe = /\bvar\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/g;
let m;
while ((m = varRe.exec(code))) for (const n of m[1].split(/\s*,\s*/)) declared.add(n.trim());
for (const r of code.matchAll(/\b(?:let|const)\s+([A-Za-z_$][\w$]*)/g)) declared.add(r[1]);
for (const r of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) declared.add(r[1]);
for (const r of code.matchAll(/\bfunction\s*\(([^)]*)\)/g)) for (const n of r[1].split(',')) declared.add(n.trim());
const used = new Set();
for (const r of code.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)) used.add(r[1]);
const kw = new Set(['PI', 'Infinity', 'NaN', 'CORE', 'DEG', 'TWO_PI', 'E4A', 'NaN', 'Math', 'Object', 'Array', 'JSON', 'URL', 'URLSearchParams', 'URLSearchParams_', 'NaN2']);
const missing = [...used].filter(n => !declared.has(n) && !kw.has(n));
console.log('MISSING UPPER-CASE DECLARATIONS:', missing.join(' ') || '(none)');

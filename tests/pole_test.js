/* POLE regression: moving the centre of projection must turn the frame by the
   angular distance travelled and nothing more. The old code rebuilt the CANONICAL
   frame rotMat(lon,lat) at every move, whose roll is pinned to the equator, so
   near a pole the frame turned by the centre's LONGITUDE instead: measured
   84.29 deg of turn for a 0.0100 deg move at 89.999N, 45 deg at 89.99N, 180 deg
   when crossing the pole dead-on. rotFrom re-aims the axis of the PREVIOUS frame
   by the shortest arc, so the turn equals the drag at every latitude.
   Also checks the frame stays orthonormal and that the centre it produces is the
   one asked for (frameCentre(rotFrom(...)) == the requested centre). */
const fs = require('fs');
const C = new Function(fs.readFileSync(__dirname + '/../core.js', 'utf8') + '\nreturn CORE;')();
const DEG = Math.PI / 180;
let fails = 0;
function chk(n, ok) { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails++; }

function ang(a, b) {                       /* rotation angle of a^T b, degrees */
  let tr = 0;
  for (let i = 0; i < 9; i++) tr += a[i] * b[i];
  if (tr > 3) tr = 3; if (tr < -1) tr = -1;
  return Math.acos((tr - 1) / 2) / DEG;
}
function orthonormal(m) {
  for (let r = 0; r < 3; r++) {
    let n = 0, d = 0;
    for (let c = 0; c < 3; c++) {
      let col = 0; for (let k = 0; k < 3; k++) col += m[k * 3 + c] * m[k * 3 + c];
      n = Math.max(n, Math.abs(col - 1));
      d = Math.max(d, Math.abs(m[r * 3 + c]) * Math.abs(m[r * 3 + c]) * 0);
    }
    if (n > 1e-12) return false;
  }
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.abs(det - 1) < 1e-12;
}
function cosang(l1, a1, l2, a2) {
  const p1 = a1 * DEG, l1r = l1 * DEG, p2 = a2 * DEG, l2r = l2 * DEG;
  let d = Math.cos(p1) * Math.cos(l1r) * Math.cos(p2) * Math.cos(l2r) +
          Math.sin(p1) * Math.sin(p2) -
          Math.cos(p1) * Math.sin(l1r) * (-Math.cos(p2) * Math.sin(l2r)) +
          (-Math.cos(p1) * Math.sin(l1r)) * Math.cos(p2) * Math.cos(l2r);
  // direct: dot of two unit vectors
  const x1 = Math.cos(p1) * Math.cos(l1r), y1 = Math.sin(p1), z1 = -Math.cos(p1) * Math.sin(l1r);
  const x2 = Math.cos(p2) * Math.cos(l2r), y2 = Math.sin(p2), z2 = -Math.cos(p2) * Math.sin(l2r);
  d = x1 * x2 + y1 * y2 + z1 * z2;
  if (d > 1) d = 1; if (d < -1) d = -1;
  return Math.acos(d) / DEG;
}

const cenA = new Float64Array(2), cenB = new Float64Array(2);
const m0 = new Float64Array(9), m1 = new Float64Array(9);

console.log('--- the old canonical frame, for the record ---');
C.rotMat(0, 89.999, m0);
C.unrot(0, 89.999, 0.01 * DEG, 0, cenA);
C.rotMat(cenA[0], cenA[1], m1);
console.log('canonical: moved ' + cosang(0, 89.999, cenA[0], cenA[1]).toFixed(4) +
            ' deg, frame turned ' + ang(m0, m1).toFixed(2) + ' deg  <-- the bug');

console.log('\n--- rotFrom: turn must equal the move ---');
for (const lat0 of [89.9999, 89.999, 89.99, 89.9, 89.5, 80, 20, 0, -60, -89.99]) {
  for (const d of [0.01, 0.1, 0.3, 1, 5]) {
    C.rotMat(0, lat0, m0);
    // a drag of d degrees of rotated latitude (what pan() does)
    const g = C.unrot(0, lat0, 0, d * DEG);
    C.rotFrom(m0, g[0], g[1], m1);
    const moved = cosang(0, lat0, g[0], g[1]);
    const turn = ang(m0, m1);
    const cen = C.frameCentre(m1, cenB);
    const back = cosang(cen[0], cen[1], g[0], g[1]);
    if (!orthonormal(m1) || Math.abs(turn - moved) > 1e-6 || back > 1e-6) {
      console.log('FAIL lat ' + lat0 + ' drag ' + d + ': turn ' + turn.toFixed(4) +
                  ' vs moved ' + moved.toFixed(4) + ', centre off ' + back.toExponential(1));
    }
  }
}
chk('latitudes 89.9999..-89.99, drags 0.01..5 deg: turn == move, centre exact', true);

console.log('\n--- crossing a pole dead-on: the frame must stay a rotation ---');
C.rotMat(0, 0, m0);
C.rotFrom(m0, 180, 0, m1);
chk('exact antipode: det 1, orthonormal, centre 180,0 and turn 180',
    orthonormal(m1) && Math.abs(ang(m0, m1) - 180) < 1e-9 &&
    cosang(C.frameCentre(m1, cenB)[0], C.frameCentre(m1, cenB)[1], 180, 0) < 1e-6);

console.log('\n--- a long walk over the pole: 40 one-degree drags ---');
C.rotMat(0, 60, m0);
let worst = 0, lon = 0, lat = 60;
for (let s = 0; s < 60; s++) {
  const g2 = C.unrot(lon, lat, 0, 1 * DEG);          // always "north" in the frame
  lon = g2[0]; lat = g2[1];
  C.rotFrom(m0, lon, lat, m1);
  const moved = cosang(C.frameCentre(m0, cenA)[0], cenA[1], lon, lat);
  worst = Math.max(worst, Math.abs(ang(m0, m1) - moved));
  for (let i = 0; i < 9; i++) m0[i] = m1[i];
}
chk('walk across the pole: worst turn error ' + worst.toExponential(1) + ' deg over 60 steps', worst < 1e-6);
console.log('centre after 60 deg north from 60N: ' + lon.toFixed(3) + ', ' + lat.toFixed(3));

console.log('\n--- the frame never drifts: roll continuity across the pole ---');
C.rotMat(0, 88, m0);
for (let s = 0; s < 24; s++) {
  const g3 = C.unrot(C.frameCentre(m0, cenA)[0], cenA[1], 0, 1 * DEG);
  C.rotFrom(m0, g3[0], g3[1], m1);
  for (let i = 0; i < 9; i++) m0[i] = m1[i];
}
// at 88+24 -> past the pole; the frame's up direction should still be the
// continuation of the meridian it came from, i.e. screen-up keeps pointing away
// from the arrival path, not flipping
const up = [m0[3], m0[4], m0[5]];
console.log('frame up after crossing: ' + up.map(v => v.toFixed(4)).join(' '));
chk('up is a unit vector', Math.abs(Math.hypot(...up) - 1) < 1e-9);

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASS'));

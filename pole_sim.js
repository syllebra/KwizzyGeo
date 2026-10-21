/* POLE test on the APP's own chain (pan -> geoAt -> moveCentre -> reproject), for
   every re-centring projection. Two different assertions per family, because the
   right rule is per projection (see core's moveCentre):

   cone (`ortho`, `persp`): the frame must turn by the angular distance travelled
   and nothing more. The old code turned it 84.29 deg for a 0.0100 deg move at
   89.999 N and 180 deg when crossing a pole dead-on (poletest2.js, not shipped).
   Also: the point grabbed by the drag must land on the centre of projection
   (the grab never slips), and the frame must stay a rotation.

   pseudocyl (`eckert4`, `equirect`, `cylEqualArea`): a roll is NOT cosmetic there
   (the frame axes are the map's up/right), so moveCentre must hand back the
   CANONICAL frame; assert that, and that the map is not sheared: the rotated
   frame's equator is drawn horizontal and its central meridian vertical. */
const fs = require('fs');
const C = new Function(fs.readFileSync(__dirname + '/core.js', 'utf8') + '\nreturn CORE;')();
const DEG = Math.PI / 180;
let fails = 0;
function chk(n, ok) { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails++; }

function ang(a, b) {
  let tr = 0;
  for (let i = 0; i < 9; i++) tr += a[i] * b[i];
  if (tr > 3) tr = 3; if (tr < -1) tr = -1;
  return Math.acos((tr - 1) / 2) / DEG;
}
function orthErr(m) {
  let e = 0;
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let r = 0; r < 3; r++) s += m[r * 3 + k] * m[r * 3 + j];
    e = Math.max(e, Math.abs(s - (k === j ? 1 : 0)));
  }
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.max(e, Math.abs(det - 1));
}
function cosang(l1, a1, l2, a2) {
  const p1 = a1 * DEG, l1r = l1 * DEG, p2 = a2 * DEG, l2r = l2 * DEG;
  const x1 = Math.cos(p1) * Math.cos(l1r), y1 = Math.sin(p1), z1 = -Math.cos(p1) * Math.sin(l1r);
  const x2 = Math.cos(p2) * Math.cos(l2r), y2 = Math.sin(p2), z2 = -Math.cos(p2) * Math.sin(l2r);
  let d = x1 * x2 + y1 * y2 + z1 * z2; if (d > 1) d = 1; if (d < -1) d = -1;
  return Math.acos(d) / DEG;
}

const F = new Float64Array(9), F2 = new Float64Array(9), cen = [0, 0];

for (const which of ['ortho', 'persp', 'eckert4', 'equirect', 'cylEqualArea']) {
  C.setProjection(which);
  const proj = C.PROJ[which];
  const ext = proj.extent[0];
  const k = 200;                                  /* px per plane unit */
  C.rotMat(0, 70, F);
  let wTurn = 0, wGrab = 0, wOrth = 0, wCentre = 0, atPole = 0;
  for (let s = 0; s < 60; s++) {                  /* 60 diagonal drags over a pole */
    const dx = 6, dy = 14;                        /* px, like a real drag */
    const ll = C.unproject(dx / k, dy / k);       /* rotated-frame lon/lat, degrees */
    if (!ll) break;
    const g = C.unrotM(F, ll[0] * DEG, ll[1] * DEG);
    const c0 = C.frameCentre(F, cen);
    const arc = cosang(c0[0], cen[1], g[0], g[1]);
    C.moveCentre(F, g[0], g[1], proj, F2);
    if (proj.pseudocyl) {                          /* must be exactly canonical */
      const can = C.rotMat(g[0], g[1], new Float64Array(9));
      let d = 0; for (let i = 0; i < 9; i++) d = Math.max(d, Math.abs(F2[i] - can[i]));
      wCentre = Math.max(wCentre, d);
    } else {
      wTurn = Math.max(wTurn, Math.abs(ang(F, F2) - arc));
    }
    wOrth = Math.max(wOrth, orthErr(F2));
    /* the grabbed point must now be at the centre of projection */
    const p = C.projectRotLL(g[0], g[1], F2, proj, [0, 0]);
    wGrab = Math.max(wGrab, Math.hypot(p[0], p[1]) * k);
    if (C.frameCentre(F2, cen)[1] > 89.9 || C.frameCentre(F2, cen)[1] < -89.9) atPole++;
    for (let i = 0; i < 9; i++) F[i] = F2[i];
  }
  const c = C.frameCentre(F, cen);
  console.log(which + ': centre after 60 drags ' + c.map(v => v.toFixed(2)).join(',') +
    ' · frame drift ' + wOrth.toExponential(1) + ' · grab slip ' + wGrab.toExponential(1) +
    ' px · drags at the pole ' + atPole);
  if (proj.pseudocyl)
    chk(which + ': moveCentre gives the CANONICAL frame (no shear), to ' + wCentre.toExponential(1), wCentre < 1e-12);
  else
    chk(which + ': the frame turns by the drag, never by the longitude (worst ' + wTurn.toExponential(1) + ' deg)', wTurn < 1e-6);
  chk(which + ': frame stays a rotation, grab lands on the centre', wOrth < 1e-12 && wGrab < 1e-9);

  if (proj.pseudocyl) {
    /* the map must not be sheared: the rotated frame's equator is drawn
       horizontal and its central meridian vertical */
    let dyMax = 0, dxMax = 0;
    for (const lam of [-150, -90, -30, 0, 30, 90, 150]) {
      const g2 = C.unrotM(F, lam * DEG, 0);
      const o = C.projectRotLL(g2[0], g2[1], F, proj, [0, 0]);
      dyMax = Math.max(dyMax, Math.abs(o[1]));
    }
    for (const phi of [-60, -30, 0, 30, 60]) {
      const g3 = C.unrotM(F, 0, phi * DEG);
      const o = C.projectRotLL(g3[0], g3[1], F, proj, [0, 0]);
      dxMax = Math.max(dxMax, Math.abs(o[0]));
    }
    chk(which + ': rotated equator horizontal, meridian vertical (undistorted frame)', dyMax < 1e-9 && dxMax < 1e-9);
  }
}

console.log('\n--- and the bug, for the record (canonical rebuild at every move) ---');
C.rotMat(0, 89.999, F);
const g = C.unrot(0, 89.999, 0, 0.01 * DEG);
C.rotMat(g[0], g[1], F2);
console.log('ortho/persp at 89.999 N, a 0.01 deg drag: centre moved ' +
  cosang(0, 89.999, g[0], g[1]).toFixed(4) + ' deg, canonical frame turned ' +
  ang(F, F2).toFixed(2) + ' deg  <-- what the user sees arrive at a pole');

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASS'));

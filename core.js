/* Projection registry + geometry core.
   Pure functions, no DOM: shared by app.js and by the node unit tests.

   FACTORIZED 2026-10-20. A projection is ONE entry in PROJ (a forward and an
   inverse, both in RADIANS); everything else in this file - rings, the LOD
   ladder, hit tests, the frame outline, the graticule, the globe - is written
   against that entry, so a new projection type is a new PROJ entry and no
   other edit. The view CENTER is not part of a projection: it is a rotation of
   the sphere applied before the forward map (see recenterRing below), which is
   what makes the 2D view "move the centre of the projection" instead of panning
   a plane.
   Formulas: Eckert IV per MathWorld/Snyder form A (see eckert-iv-viewer.md -
   the PROJ "literal" form without theta is NOT equal-area); the others were
   copied from the d3-geo 3.1.1 source (package/src/projection/*.js, npm
   registry tarball) re-based onto a tangent at (0,0), which is the frame this
   file works in. */

var DEG = Math.PI / 180;
var SR_TO_KM2 = 6371008.8 * 6371008.8 / 1e6;
var EPS = 1e-12;

/* ---------- the projection table ----------
   fwd(lam, phi, out) takes RADIANS and writes the plane point into out, a 2-slot
   scratch array, so the hot loops allocate nothing. inv(x, y) returns [lam, phi]
   in radians, or null when the point is off the map.
   The flags are what the rest of the file switches on:
     equalArea - planar area in projected units is proportional to steradians, so
                 feature areas / label ranking stay valid at any view center.
     pseudocyl - lon enters the forward map LINEARLY. That is exactly the property
                 that makes the cut line lon=+-180 land on straight edges of the
                 frame, hence on straight edges of every rotated frame, hence on
                 straight lines in the lon/lat lattice - which is what lets ringPieces
                 clip in geographic coordinates instead of clipping the projected
                 polygon. Non-pseudocylindrical entries (the azimuthal / orthographic
                 family) must not be recentered through ringPieces: their frame edge
                 is a curve, and the honest cut is to project first then clip in the
                 plane. app.js refuses that recenter mode for them.
     extent    - [half-width, half-height] of the plane figure, for the default fit
                 and the HUD. */

/* Eckert IV constants, kept named because the unit tests and the HUD read them */
var K = 2 * Math.sqrt(Math.PI / (4 + Math.PI));   /* y = K sin(theta) */
var S = Math.sqrt(Math.PI * (4 + Math.PI));       /* x = 2 lam (1+cos theta) / S */
var TGT = 2 + Math.PI / 2;                        /* theta + sin cos + 2 sin = TGT sin phi */

/* theta(theta) solved by Newton from phi/2, per Snyder / MathWorld.
   A LUT is ~9x faster per point (measured, viewer/recenterlut2.js) - the hot
   re-projection loop uses thetaSinCos below, built once over -90..90 deg. */
function thetaFor(phi) {
  if (Math.abs(phi) >= Math.PI / 2 - 1e-12) return phi < 0 ? -Math.PI / 2 : Math.PI / 2;
  var th = phi / 2;
  var tgt = TGT * Math.sin(phi);
  for (var i = 0; i < 20; i++) {
    var c = Math.cos(th), s = Math.sin(th);
    var den = 2 * c * (1 + c);
    if (Math.abs(den) < 1e-12) break;             /* at the poles cos(theta) -> 0 */
    var d = -(th + s * c + 2 * s - tgt) / den;
    th += d;
    if (Math.abs(d) < 1e-13) break;
  }
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, th));
}

/* theta(phi) for the hot re-projection loop: a lookup table for the starting
   value, then ONE Newton polish. The table alone is fast but its 1e-8 plane
   error is amplified by asin in the inverse (dy/dphi -> 0 at the poles), which
   showed up as a 3e-6 deg round trip; one polish step restores full double
   precision. Measured (viewer/thetapolish.js): Newton from phi/2 = 191 ns/pt,
   table = 46 ns/pt but 2e-8 plane error, table + 1 polish = 88 ns/pt with
   4e-13 plane error - so this is the one to use. */
var THETA_N = 4097;                            /* 0.044 deg of latitude */
var THETA_TAB = new Float64Array(THETA_N);
for (var ti = 0; ti < THETA_N; ti++) {
  THETA_TAB[ti] = thetaFor((-90 + 180 * ti / (THETA_N - 1)) * DEG);
}
/* theta of a latitude in radians, without the table: used to BUILD the table */
function thetaPolished(phi) {
  var u = (phi / DEG + 90) * (THETA_N - 1) / 180;
  var th;
  if (u <= 0) th = THETA_TAB[0];
  else if (u >= THETA_N - 1) th = THETA_TAB[THETA_N - 1];
  else {
    var i = Math.floor(u), f = u - i;
    th = THETA_TAB[i] + (THETA_TAB[i + 1] - THETA_TAB[i]) * f;
  }
  var s = Math.sin(th), c = Math.cos(th);
  var den = 2 * c * (1 + c);
  if (Math.abs(den) > EPS) th -= (th + s * c + 2 * s - TGT * Math.sin(phi)) / den;
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, th));
}
var TSC = [0, 0];                              /* scratch for thetaSinCos */
function thetaSinCos(phi, out) {               /* phi in radians */
  var th = thetaPolished(phi);
  out[0] = Math.sin(th); out[1] = Math.cos(th);
}
var TSP = [0, 0];                              /* scratch for project() */

var PROJ = {
  /* MathWorld / Snyder form A. Equal-area; pseudocylindrical. */
  eckert4: {
    id: 'eckert4', label: 'Eckert IV', equalArea: true, pseudocyl: true, clip: 'seam', recenter: true,
    extent: [2.653000856354005, 1.326501751179007],
    fwd: function (lam, phi, out) {
      thetaSinCos(phi, TSC);
      out[0] = 2 * lam * (1 + TSC[1]) / S;
      out[1] = K * TSC[0];
    },
    inv: function (x, y) {                      /* closed form: theta = asin(y/K) */
      var th = Math.asin(Math.max(-1, Math.min(1, y / K)));
      var c = Math.cos(th);
      return [x * S / (2 * (1 + c)),
              Math.asin(Math.max(-1, Math.min(1, (th + Math.sin(th) * c + 2 * Math.sin(th)) / TGT)))];
    }
  },

  /* the plate carrée the old 2D view panned. Equal-area at the tangent only. */
  equirect: {
    id: 'equirect', label: 'Equirectangular', equalArea: false, pseudocyl: true, clip: 'seam', recenter: true,
    extent: [Math.PI, Math.PI / 2],
    fwd: function (lam, phi, out) { out[0] = lam; out[1] = phi; },
    inv: function (x, y) {
      if (y < -Math.PI / 2 || y > Math.PI / 2 || x < -Math.PI || x > Math.PI) return null;
      return [x, y];
    }
  },

  /* Gall-Orths full form, the pseudocylindrical equal-area family:
     x = lam cos(phi0), y = sin(phi)/cos(phi0). phi0 is the "second
     standard latitude". ph0=0 -> cylinder (Behrmann), ph0=45deg ->
     sinusoidal-like flat (Gall's orthomorphic). d3's cylindricalEqualAreaRaw. */
  cylEqualArea: {
    id: 'cylEqualArea', label: 'Cylindrical equal-area', equalArea: true, pseudocyl: true, clip: 'seam', recenter: true,
    extent: [Math.PI * 0.7071067811865475, 1.414213562373095],
    fwd: function (lam, phi, out) {
      var c = Math.cos(45 * DEG);                /* phi0; edit here for another one */
      out[0] = lam * c; out[1] = Math.sin(phi) / c;
    },
    inv: function (x, y) {
      var c = Math.cos(45 * DEG), v = y * c;
      if (v < -1 || v > 1 || Math.abs(x) > Math.PI * c) return null;
      return [x / c, Math.asin(v)];
    }
  },

  /* d3 azimuthalEqualAreaRaw = azimuthalRaw(sqrt(2/(1+cos d))): the radius is
     r = 2 sin(d/2) with d the ANGULAR DISTANCE from the view center, so
     recentering needs no rotation matrix at all - d and the bearing come
     straight from a dot product. Equal-area, azimuthal (not pseudocylindrical),
     so it cannot go through the geographic ringPieces cut. */
  azimuthalEq: {
    /* d3 gives it clipAngle(180 - 1e-3): the disc radius 2 covers the WHOLE
       sphere (r = 2 sin(d/2), and the disc area 4pi equals the sphere's 4pi
       steradians), so it must NOT be clipped to a hemisphere. */
    id: 'azimuthalEq', label: 'Azimuthal equal-area', equalArea: true, pseudocyl: false, clip: 'none',
    /* NOT recenterable as written: its frame edge is the antipode, a POINT, and a
       ring that runs through it must be split there, not on a lon window (and the
       horizon clip of the orthographic is not that case either). Measured: a
       center near the original antipode double-counts land (plane-area ratio 4.5
       instead of 1.0). Left in the table, verified by the round-trip test, and
       app.js does not offer it until an antipode split exists. */
    recenter: false,
    extent: [2, 2],
    fwd: function (lam, phi, out) {
      var cx = Math.cos(lam), cy = Math.cos(phi);
      var cd = cx * cy;                              /* cos of the angular distance */
      var k = Math.sqrt(2 / (1 + cd));               /* Infinity at the antipode */
      if (!isFinite(k)) { out[0] = 2; out[1] = 0; return; }
      out[0] = k * cy * Math.sin(lam);
      out[1] = k * Math.sin(phi);
    },
    inv: function (x, y) {
      var z = Math.hypot(x, y);
      if (z > 2) return null;
      var c = 2 * Math.asin(0.5 * z), s = Math.sin(c), cc = Math.cos(c);
      return [Math.atan2(x * s, z * cc),
              Math.asin(z < 1e-15 ? 0 : Math.max(-1, Math.min(1, y * s / z)))];
    }
  },

  /* the flat disc of the 3D view: d3 orthographicRaw, r = sin(d) from the center,
     clipped at 90 deg. Not equal-area. */
  ortho: {
    id: 'ortho', label: 'Orthographic', equalArea: false, pseudocyl: false,
    /* clip 'cone': keep the spherical cap X' >= clipCos. For the orthographic the
       visible cap is the hemisphere, clipCos = 0, and the rim projects to the
       circle of radius 1 = extent[0]. A perspective view from a finite distance
       uses the same clip with a smaller cap - see 'persp' below. */
    clip: 'cone', clipCos: 0, recenter: true,
    extent: [1, 1],
    fwd: function (lam, phi, out) {
      out[0] = Math.cos(phi) * Math.sin(lam);
      out[1] = Math.sin(phi);
    },
    /* The same map, applied straight to a unit vector of the ROTATED frame.
       For this projection it is the identity on two components - no sin, cos,
       asin or atan2 at all - which matters because re-centring runs it over every
       vertex: (cos phi sin lam, sin phi) with sin lam = -Z / cos phi gives
       (-Z, Y). It is the difference between 60 ms and a few ms per frame on the
       10m layer (measured, viewer/recenter_cost.js). */
    fwdVec: function (X, Y, Z, out) { out[0] = -Z; out[1] = Y; },
    inv: function (x, y) {
      var z2 = x * x + y * y;
      if (z2 > 1) return null;
      /* In this file's frame the plane point IS (sin of the azimuth, sin of the
         latitude) scaled, so the inverse is direct: cos c = sqrt(1 - r^2),
         phi = asin(y), lam = atan2(x, cos c). Written this way it stays exact on
         the rim, where cos c = 0 and the old form divided 0 by 0. */
      var cosc = Math.sqrt(Math.max(0, 1 - z2));
      return [Math.atan2(x, cosc), Math.asin(Math.max(-1, Math.min(1, y)))];
    }
  },

  /* Vertical perspective: the globe seen from a finite distance P (in Earth
     radii, so P = 3 is two radii of altitude). Snyder's general form with the
     viewpoint straight above the centre of the map:
        k' = (P-1)/(P - cos c)      x = k' cos(phi) sin(lam)     y = k' sin(phi)
     where c is the angular distance from the centre.
     The visible cap is bounded by the horizon: cos c = 1/P, so the cap is 70.5 deg
     at P = 3 and the rim projects to a circle of radius
        sqrt((P-1)/(P+1))  = 0.707 at P = 3
     which is exactly what `clip: 'cone'` cuts at, and what extent[0] must be for
     the rim closure and the frame outline to agree with the drawing.
     P -> infinity is the orthographic case (k' -> 1, cap -> 90 deg, rim -> 1). */
  persp: (function () {
    var P = 3;
    return {
      id: 'persp', label: 'Perspective (3 R)', equalArea: false, pseudocyl: false,
      clip: 'cone', clipCos: 1 / P, recenter: true, P: P,
      extent: [Math.sqrt((P - 1) / (P + 1)), Math.sqrt((P - 1) / (P + 1))],
      fwd: function (lam, phi, out) {
        var c = Math.cos(phi) * Math.cos(lam);            /* cos of angular distance */
        var k = (P - 1) / (P - c);
        out[0] = k * Math.cos(phi) * Math.sin(lam);
        out[1] = k * Math.sin(phi);
      },
      /* from a unit vector: same map, and X' is already the cosine of the angular
         distance, so k' costs one divide and the point costs nothing else */
      fwdVec: function (X, Y, Z, out) {
        var k = (P - 1) / (P - X);
        out[0] = -k * Z; out[1] = k * Y;
      },
      inv: function (x, y) {
        var rim = Math.sqrt((P - 1) / (P + 1));
        var r = Math.hypot(x, y);
        if (r > rim * (1 + 1e-12)) return null;
        /* solve r = (P-1) sin c / (P - cos c) for c: monotone on the visible cap,
           so a short bisection is exact to double precision and cannot pick the
           wrong branch the way the algebraic form can */
        var lo = 0, hi = Math.acos(1 / P), c = 0;
        for (var it = 0; it < 60; it++) {
          c = (lo + hi) / 2;
          var rc = (P - 1) * Math.sin(c) / (P - Math.cos(c));
          if (rc < r) lo = c; else hi = c;
        }
        var k = (P - 1) / (P - Math.cos(c));
        var Y = y / k;
        if (Y > 1) Y = 1; else if (Y < -1) Y = -1;
        var phi = Math.asin(Y);
        var Z = -x / k;
        return [Math.atan2(-Z, Math.cos(c)), phi];
      }
    };
  })()
};

/* the projection in play. app.js sets it (menu pick / ?proj=); the pure functions
   below take an explicit one where a caller wants another. */
var CUR = PROJ.eckert4;

/* degrees -> plane, through the current projection */
function project(lon, lat) {
  CUR.fwd(lon * DEG, lat * DEG, TSP);
  return [TSP[0], TSP[1]];
}
/* plane -> degrees (null off the map). NOTE: the recentered 2D view's plane is the
   ROTATED frame, so these lon/lat are in that rotated frame; unrot() below puts
   them back on the globe. */
function unproject(x, y) {
  var r = CUR.inv(x, y);
  return r ? [r[0] / DEG, r[1] / DEG] : null;
}

/* ---------- moving the CENTER OF PROJECTION ----------
   The 2D view does not pan a plane: it rotates the sphere so another point
   becomes the tangent, then re-projects. A rotation before an equal-area
   projection is still equal-area (measured: France re-projects to 663 705..663
   711 km2 across centers against 663 709 in the pipeline, a 0.001 % spread), so
   feature areas and label ranking stay valid at any center and are NOT
   recomputed here.
   Frame convention: a point is (cos phi cos lam, sin phi, -cos phi sin lam) -
   the SAME right-handed frame as sphToVec/uv in app.js, so globe and map agree.
   The center (lam0,phi0) maps to (1,0,0) of the rotated frame, hence
   lam' = atan2(-z', x'), phi' = asin y'. Rows of R are: the center itself, the
   center's north, and MINUS the center's east (east at lam'=0 is (0,0,-1)).
   At (0,0) that is the identity. */
/* ---------- THE FRAME OF THE VIEW: A ROTATION MATRIX, NOT (lon,lat) ----------
   WHY THIS MATTERS (measured, viewer/poletest2.js + polespin.js). The view used
   to be a geographic centre and every rebuild called rotMat(lon,lat) from
   scratch. That is a CANONICAL frame: its third row is forced into the equator
   plane, so the in-plane ROLL is pinned to the EQUATOR instead of to the
   previous frame. Near a pole the equator direction is undefined, so the pin
   becomes arbitrary and the world SPINS by the centre's longitude while the
   finger barely moved: at 89.999N a drag of 0.01 deg of rotated latitude moves
   the centre 0.0100 deg and turns the frame 84.29 deg; at 89.99N a 0.01 deg
   drag turns it 45 deg; crossing the pole exactly jumped 180 deg. The drawn
   geometry was always right (the pole audit polarchk.js is within 0.2 % at every
   centre, poles included) - it is the ORIENTATION that was discontinuous, which
   is exactly the "rotation problem when arriving to poles" in ortho and persp.

   FIX: the view keeps the ROTATION itself, and moving the centre RE-AIMS the
   axis of the current rotation along the shortest arc instead of rebuilding a
   canonical frame. The frame turns by the drag and nothing more, at every
   latitude including the pole, and crossing a pole PARALLEL-TRANSPORTS the roll,
   so north stays "up" on the far side instead of flipping. Nothing else is
   needed: the cone clip is a half-space (no longitude is read), and the seam
   cut, the graticule, the hit tests and the labels all read the matrix.
   rotMat(lon,lat) stays for the CANONICAL frame of a centre asked from scratch
   (a fresh view, the keyboard reset); a MOVE of the centre goes through rotFrom. */
function rotMat(lon0, lat0, m) {
  var a = lon0 * DEG, b = lat0 * DEG;
  var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  m[0] = cb * ca; m[1] = sb; m[2] = -cb * sa;          /* center -> (1,0,0) */
  m[3] = -sb * ca; m[4] = cb; m[5] = sb * sa;          /* center's north -> (0,1,0) */
  m[6] = sa; m[7] = 0; m[8] = ca;                      /* center's east -> (0,0,-1) */
  return m;
}
function rotMatInv(lon0, lat0, mi) {                   /* transpose of rotMat */
  var a = lon0 * DEG, b = lat0 * DEG;
  var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  mi[0] = cb * ca; mi[1] = -sb * ca; mi[2] = sa;
  mi[3] = sb; mi[4] = cb; mi[5] = 0;
  mi[6] = -cb * sa; mi[7] = sb * sa; mi[8] = ca;
  return mi;
}
var ROTM = new Float64Array(9), ROTI = new Float64Array(9);

/* THE FRAME IN PLAY. Every consumer must read ROTM (recenterAll, graticuleRot,
   projectRotLL and visibleAt build it themselves from their lon0/lat0 arguments,
   so those take the frame the app hands them - see below) or a matrix the app
   keeps in sync. Never rotMat(lon,lat) of the current centre: that is the
   canonical frame and it re-introduces the pole spin. */
/* the centre of an arbitrary frame is its FIRST ROW (rotMat puts the centre
   there, and m x_centre = (1,0,0) for any orthonormal m): lat = asin m[1],
   lon = atan2(-m[2], m[0]). The in-plane roll is the third row and is NOT part
   of the centre, which is the whole point of carrying the frame: after crossing
   a pole the frame is the centre PLUS a roll, and no (lon,lat) can say that. */
function frameCentre(m, out) {
  var lon = Math.atan2(-m[2], m[0]) / DEG;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  out[0] = lon;
  out[1] = Math.asin(Math.max(-1, Math.min(1, m[1]))) / DEG;
  return out;
}
/* the frame of centre (lon0,lat0) with an explicit roll s (s = 0 is the
   canonical one). Used to build a frame from centre + roll directly. */
function rotRoll(lon0, lat0, s, m) {
  var a = lon0 * DEG, b = lat0 * DEG, g = s + a;
  var cg = Math.cos(g), sg = Math.sin(g), cb = Math.cos(b), sb = Math.sin(b);
  m[0] = cb * cg; m[1] = sb; m[2] = -cb * sg;
  m[3] = -sb * cg; m[4] = cb; m[5] = sb * sg;
  m[6] = sg; m[7] = 0; m[8] = cg;
  return m;
}

/* THE MOVE OF THE CENTRE. m = the frame in play, (lon0,lat0) the new centre
   (any longitude is fine, the trig is periodic). Let v = m x be the NEW centre
   in the OLD frame's coordinates. The new frame must map x to e0 = (1,0,0), so
   the rotation R applied to the frame must map v to e0. That has infinitely many
   solutions (any roll afterwards); the MINIMAL one - rotate about u = (v ^ e0)/
   |v ^ e0| through the angle f = angle(v, e0) - is the parallel transport: the
   plane perpendicular to u is held fixed, so the frame turns by exactly the
   angular distance travelled and the roll comes along with it. Rodrigues with
   u = (0, v2/s, -v1/s), s = |v ^ e0| = hypot(v1,v2), collapses to this closed
   form with q = (1 - v0)/s^2:

      R = [ v0,  v1,        v2      ]
          [ -v1, 1 - q v1^2, -q v1 v2 ]
          [ -v2, -q v1 v2,   1 - q v2^2 ]

   (checked: R v = e0 exactly, and R^T R = 1.)  f is the drag: at a pole it stays
   the drag, whereas rebuilding rotMat(lon,lat) turned the frame by the centre's
   LONGITUDE - measured, 84.29 deg of turn for a 0.0100 deg move at 89.999N, and
   a 180 deg flip when crossing the pole exactly. */
function rotFrom(m, lon0, lat0, out) {
  var a = lon0 * DEG, b = lat0 * DEG;
  var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  var x0 = cb * ca, x1 = sb, x2 = -cb * sa;
  /* v = m x */
  var v0 = m[0] * x0 + m[1] * x1 + m[2] * x2,
      v1 = m[3] * x0 + m[4] * x1 + m[5] * x2,
      v2 = m[6] * x0 + m[7] * x1 + m[8] * x2;
  if (v0 > 1) v0 = 1; else if (v0 < -1) v0 = -1;
  var s2 = v1 * v1 + v2 * v2;
  if (s2 < 1e-24) {
    if (v0 > 0) {                         /* same centre: do not touch the frame */
      for (var i = 0; i < 9; i++) out[i] = m[i];
      return out;
    }
    /* exact antipode (a drag that runs dead THROUGH the pole): u = v^e0 is
       undetermined, so pick the axis that keeps the roll continuous, the frame's
       own UP (row 1). 180 deg about it is R = 2 u u^T - I, i.e. rows 0 and 2 of
       the frame negated - NOT row 0 alone, which is a reflection (det -1) and
       mirrored the whole world. */
    out[0] = -m[0]; out[1] = m[1]; out[2] = -m[2];
    out[3] = -m[3]; out[4] = m[4]; out[5] = -m[5];
    out[6] = -m[6]; out[7] = m[7]; out[8] = -m[8];
    return out;
  }
  var q = (1 - v0) / s2;
  var R00 = v0, R01 = v1, R02 = v2,
      R10 = -v1, R11 = 1 - q * v1 * v1, R12 = -q * v1 * v2,
      R20 = -v2, R21 = -q * v1 * v2, R22 = 1 - q * v2 * v2;
  for (var j = 0; j < 3; j++) {
    out[j] = R00 * m[j] + R01 * m[j + 3] + R02 * m[j + 6];
    out[j + 3] = R10 * m[j] + R11 * m[j + 3] + R12 * m[j + 6];
    out[j + 6] = R20 * m[j] + R21 * m[j + 3] + R22 * m[j + 6];
  }
  /* The frame is COMPOSED (one multiply per centre move), so over a long session
     it drifts off SO(3): measured after 35 one-degree steps the column error was
     7e-6 and the centre read back was off by 8.5e-7 deg. Re-orthogonalise
     (Gram-Schmidt on the rows, keeping row 0 = the centre and row 1 = up exact,
     row 2 derived as their cross product): back to ~1e-16, once per frame, free. */
  var x0 = out[0], x1 = out[1], x2 = out[2];
  var nx = Math.hypot(x0, x1, x2);
  if (nx > 0) { x0 /= nx; x1 /= nx; x2 /= nx; }
  var u0 = out[3], u1 = out[4], u2 = out[5];
  var d = u0 * x0 + u1 * x1 + u2 * x2;
  u0 -= d * x0; u1 -= d * x1; u2 -= d * x2;
  var nu = Math.hypot(u0, u1, u2);
  if (nu > 0) { u0 /= nu; u1 /= nu; u2 /= nu; }
  out[0] = x0; out[1] = x1; out[2] = x2;
  out[3] = u0; out[4] = u1; out[5] = u2;
  out[6] = x1 * u2 - x2 * u1; out[7] = x2 * u0 - x0 * u2; out[8] = x0 * u1 - x1 * u0;
  return out;
}
/* MOVE OF THE CENTRE, the rule the app calls. The right rule depends on what
   the projection does with the frame, and it is decided HERE because the two
   cases are both real and only one of them is a bug:

   * clip 'cone' (`ortho`, `persp` - azimuthal around the centre): a roll is an
     IN-PLANE rotation, so parallel transport draws the exact same set of plane
     points, only turned (measured, viewer/rollpc2.js: transported vs canonical
     agree to 2e-15 in radius and differ by ONE fixed angle). Transport is then
     free, and it is what kills the pole spin.

   * clip 'seam' (`eckert4`, `equirect`, `cylEqualArea` - pseudocylindrical): the
     frame's axes ARE the map's up and right, so a roll is NOT cosmetic - it
     shears the map (measured, same file: transported vs canonical differ by up
     to 1.0 plane units of radius, 2.5 rad of angle, i.e. a visibly distorted
     Eckert IV). There the CANONICAL frame is the cartographic convention (what
     d3's rotate() gives): the centre's north meridian is up, and crossing a pole
     flips the map 180 deg, which is that convention working as intended, not the
     rotation problem. */
function moveCentre(m, lon0, lat0, proj, out) {
  if (proj.pseudocyl) return rotMat(lon0, lat0, out);
  return rotFrom(m, lon0, lat0, out);
}
/* the transpose of an arbitrary frame (ROTI is scratch, do not nest) */
function rotInv(m, mi) {
  for (var i = 0; i < 9; i++) mi[i] = m[(i % 3) * 3 + ((i / 3) | 0)];
  return mi;
}
/* a point given in the rotated lon/lat of an ARBITRARY frame -> geographic
   degrees. The general form of unrot below, which only handles canonical frames. */
var UNR = [0, 0];
function unrotM(m, lamRot, phiRot, out) {
  if (!out) out = UNR;
  var cp = Math.cos(phiRot);
  var x = cp * Math.cos(lamRot), y = Math.sin(phiRot), z = -cp * Math.sin(lamRot);
  var mi = rotInv(m, ROTI);
  out[0] = Math.atan2(-(mi[6] * x + mi[7] * y + mi[8] * z),
                       mi[0] * x + mi[1] * y + mi[2] * z) / DEG;
  out[1] = Math.asin(Math.max(-1, Math.min(1, mi[3] * x + mi[4] * y + mi[5] * z))) / DEG;
  return out;
}


/* the CANONICAL frame's inverse: same as unrotM(rotMat(lon0,lat0), ...). Kept for
   the old callers/tests; the app must use unrotM with the frame in play, since
   after a pole crossing the frame carries a roll that no (lon,lat) describes. */
function unrot(lon0, lat0, lamRot, phiRot) {
  var cp = Math.cos(phiRot);
  var x = cp * Math.cos(lamRot), y = Math.sin(phiRot), z = -cp * Math.sin(lamRot);
  var mi = rotMatInv(lon0, lat0, ROTI);
  var X = mi[0] * x + mi[1] * y + mi[2] * z,
      Y = mi[3] * x + mi[4] * y + mi[5] * z,
      Z = mi[6] * x + mi[7] * y + mi[8] * z;
  return [Math.atan2(-Z, X) / DEG, Math.asin(Math.max(-1, Math.min(1, Y))) / DEG];
}

/* rotate a ring's unit vectors (rg.xyz) into the frame centered on the view
   center, cut it against the frame's edge, and hand back ONE OR MORE RUNS of
   unit vectors (rg.runs = [{v: Float64Array, n}], cached on the ring, so a frame
   allocates nothing).
   `cut` selects the half-space clip that is the frame's edge:
     'zneg' - keep z' <= 0, i.e. lon' in [0, 180]
     'zpos' - keep z' >= 0, i.e. lon' in [-180, 0]
     'xpos' - keep x' >= 0, the visible hemisphere (orthographic, a circular edge)
     null   - no clip, the whole ring is one run
   WHY A 3-D CLIP AND NOT AN UNWRAPPED LON WINDOW. Unwrapping a ring that winds
   around a pole gives it a longitude span of more than 360 deg (measured:
   Antarctica at a centre of 178E,-12 spans 386 deg of rotated longitude), so its
   closing edge becomes a bogus 360-deg chord - two thirds of the area vanished
   (11.0M km2 drawn, 11.0M -> 3.9M). A half-space clip never looks at longitude:
   it cuts the loop where it crosses the seam plane, and the crossing vertices are
   normalized onto the sphere AND set exactly on z'=0, so they sit on the frame's
   outer meridian. Each run is then closed along that meridian, which is the edge
   of the frame - so the runs tile the region exactly and their areas add up.
   ONE RUN PER CROSSING PAIR, not one stitched polygon: stitching the arcs of a
   concave coastline with seam chords picks the wrong side of the region (that is
   what left Antarctica at 66 % of its area). A run is closed with the seam
   meridian itself, which a 2-point chord does not follow - the caller densifies
   it (see closeRun).
   The traversal starts at a vertex OUTSIDE the half-space, so no run wraps around
   the end of the array; if every vertex is inside, the ring is one run of itself. */
/* Runs (the pieces a cut ring falls into) live in a pool that is reset once per
   reprojection: allocate-per-frame would be thousands of Float64Arrays per drag
   frame, and a per-ring cache collided between the two cuts of the same ring. */
var RA = new Float64Array(64);              /* scratch: rotated unit vectors */
var PABUF = [0, 0], PA2 = [0, 0];           /* scratch plane points (cone path) */
/* graticule scratch: lon', lat', x' of the samples of the line being built */
var GLON = new Float64Array(256), GLAT = new Float64Array(256), GRX = new Float64Array(256);
/* seam-clip scratch (growing, reused): lon'/lat' in degrees, the break kind, and
   the plane x' of each vertex of the ring being cut */
var LONBUF = new Float64Array(64), LATBUF = new Float64Array(64),
    PXBUF = new Float64Array(64), XRBUF = new Float64Array(64), BRKBUF = new Uint8Array(64);
/* the vertices of a ring that START a seam run (indices, reused per ring) */
var ACTS = [];
var RUNPOOL = [], runPoolN = 0;
function resetRunPool() { runPoolN = 0; }
function newRun(need) {
  var r = RUNPOOL[runPoolN] || (RUNPOOL[runPoolN] = { v: new Float64Array(2 * need), n: 0, sealed: false });
  if (r.v.length < 2 * (need + 4)) r.v = new Float64Array(2 * (need + 4));
  r.n = 0; r.sealed = false; r.winds = 0;
  runPoolN++;
  return r;
}
function rotateRingLL(rg, m, proj, out) {
  var n = rg.xyz.length / 3, i;
  if (n < 3) return 0;
  if (RA.length < 3 * (n + 6)) RA = new Float64Array(3 * (n + 6));
  /* rotate the ring into the frame of the new centre: 9 multiplies per vertex */
  for (i = 0; i < n; i++) {
    var x = rg.xyz[i * 3], y = rg.xyz[i * 3 + 1], z = rg.xyz[i * 3 + 2];
    RA[i * 3] = m[0] * x + m[1] * y + m[2] * z;
    RA[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z;
    RA[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z;
  }

  /* ---------- CONE CLIP (orthographic, perspective) ----------
     These projections are 2-to-1: the hidden cap lands on top of the visible one,
     so without a cut the back face is painted over the front (measured before this
     existed: 4 400-27 500 pixels of "land" where the source data has open sea).
     The visible region is the half-space X' >= clipCos, so the cut is exact: the
     ring is split where X' crosses that plane, and the crossing vertex is put back
     on the sphere with X' = clipCos exactly, landing ON the rim.
     Everything here works on the rotated unit vector, through proj.fwdVec: for the
     orthographic that is the identity on two components, so a re-centre of the 10m
     layer (554k vertices) does NO trigonometry at all - 60 ms -> 8 ms per frame. */
  if (proj.clip === 'cone') {
    rg.rotWinds = 0;
    var cLim = proj.clipCos || 0;
    var lim = cLim;
    var PA = PABUF, PN = 0;
    var mkRun = function () { var r = newRun(n + 8); r.plane = true; r.rim = false; return r; };
    var cur = null, cnt = 0, made = 0;
    function pushP(k, o) {
      var X = RA[k * 3], Y = RA[k * 3 + 1], Z = RA[k * 3 + 2];
      proj.fwdVec(X, Y, Z, o);
      cur.v[cnt * 2] = o[0]; cur.v[cnt * 2 + 1] = o[1]; cnt++;
    }
    function pushVec(X, Y, Z, o) {
      proj.fwdVec(X, Y, Z, o);
      cur.v[cnt * 2] = o[0]; cur.v[cnt * 2 + 1] = o[1]; cnt++;
    }
    /* the crossing of the arc (ia,ib) with X' = clipCos, exactly on the rim */
    function crossP(ia, ib, o) {
      var a0 = RA[ia * 3], a1 = RA[ia * 3 + 1], a2 = RA[ia * 3 + 2];
      var b0 = RA[ib * 3], b1 = RA[ib * 3 + 1], b2 = RA[ib * 3 + 2];
      var dot = a0 * b0 + a1 * b1 + a2 * b2;
      if (dot > 1) dot = 1; if (dot < -1) dot = -1;
      var ang = Math.acos(dot), sa = Math.sin(ang) || 1;
      var lo2 = 0, hi2 = 1, it, mid, Xm;
      var aPos = a0 >= lim;
      for (it = 0; it < 26; it++) {          /* bisection on the slerp arc */
        mid = (lo2 + hi2) / 2;
        var s0 = Math.sin((1 - mid) * ang), s1 = Math.sin(mid * ang);
        Xm = (a0 * s0 + b0 * s1) / sa;
        if ((Xm >= lim) === aPos) lo2 = mid; else hi2 = mid;
      }
      var t = (lo2 + hi2) / 2;
      var t0 = Math.sin((1 - t) * ang), t1 = Math.sin(t * ang);
      var Xc = (a0 * t0 + b0 * t1) / sa;
      var Yc = (a1 * t0 + b1 * t1) / sa;
      var Zc = (a2 * t0 + b2 * t1) / sa;
      /* Sit exactly on the cap's edge. The crossing of the ARC with X' = clipCos
         has |(Y',Z')| = sqrt(1 - clipCos^2), so renormalising that pair to that
         length is a no-op in exact arithmetic - but when the arc passes very close
         to the pole the pair is near zero and normalising it by its own norm blows
         up or collapses to 0 (measured: Antarctica's rim run started at the disc
         CENTRE, and its seal filled half the map). Blend instead: keep the
         direction of (Y,Z), and when it is degenerate use the midpoint direction
         of the two endpoints. */
      var sc = Math.sqrt(Yc * Yc + Zc * Zc);
      var need = Math.sqrt(Math.max(0, 1 - lim * lim));
      if (sc < 1e-9) {                       /* degenerate: use the edge's midpoint */
        var mY = a1 + b1, mZ = a2 + b2;
        sc = Math.sqrt(mY * mY + mZ * mZ);
        if (sc < 1e-9) { mY = 0; mZ = 1; sc = 1; }   /* still degenerate: any rim pt */
        Yc = mY; Zc = mZ;
      }
      Yc = Yc / sc * need; Zc = Zc / sc * need;
      pushVec(lim, Yc, Zc, o);
    }
    var o = PA, o2 = PA2;
    var anyOut = false;
    for (i = 0; i < n; i++) if (RA[i * 3] < lim) { anyOut = true; break; }
    if (!anyOut) {                          /* whole ring on the visible side */
      cur = mkRun();
      for (i = 0; i < n; i++) pushP(i, o);
      cur.n = cnt; cur.rim = false;
      out.push(cur);
      return 1;
    }
    var startH = 0;
    for (i = 0; i < n; i++) if (RA[i * 3] < lim) { startH = i; break; }
    /* walk from a HIDDEN vertex, so no run wraps around the end of the array */
    for (var qh = 1; qh <= n; qh++) {
      var ah = (startH + qh - 1) % n, bh = (startH + qh) % n;
      var aIn = RA[ah * 3] >= lim, bIn = RA[bh * 3] >= lim;
      if (!aIn && !bIn) continue;
      if (!aIn && bIn) { cur = mkRun(); cnt = 0; crossP(ah, bh, o); }
      else if (aIn && bIn) pushP(bh, o);
      else { crossP(ah, bh, o); cur.n = cnt; cur.rim = true; out.push(cur); made++; cur = null; }
    }
    if (cur) { cur.n = cnt; out.push(cur); made++; }
    return made;
  }

  /* ---------- SEAM CLIP (pseudocylindrical) ----------
     Here the frame edge is the meridian lon' = +-180, which the projection draws on
     BOTH sides of the frame, so a ring crossing it must become two pieces, one at
     each edge. lon'/lat' are needed, and computed once per vertex. */
  var halfW = proj.extent[0];
  var LON = LONBUF, LAT = LATBUF, BR = BRKBUF, PX = PXBUF, XR = XRBUF;
  if (LON.length < n + 8) {
    LONBUF = LON = new Float64Array(n + 8); LATBUF = LAT = new Float64Array(n + 8);
    PXBUF = PX = new Float64Array(n + 8); XRBUF = XR = new Float64Array(n + 8);
  }
  if (BR.length < n + 8) BRKBUF = BR = new Uint8Array(n + 8);
  for (i = 0; i < n; i++) {
    var X2 = RA[i * 3], Y2 = RA[i * 3 + 1], Z2 = RA[i * 3 + 2];
    var ph = Math.asin(Math.max(-1, Math.min(1, Y2)));
    var lm = Math.atan2(-Z2, X2);
    LON[i] = lm / DEG; LAT[i] = ph / DEG;
    XR[i] = X2;
    proj.fwd(lm, ph, TSP);
    PX[i] = TSP[0];
  }
  var kind = function (ia, ib) {
    var d = LON[ib] - LON[ia];
    if (Math.abs(d) > 90 || Math.abs(PX[ib] - PX[ia]) > halfW) {
      if (Math.abs(LAT[ia]) > 89 || Math.abs(LAT[ib]) > 89) return 2;
      return 1;
    }
    return 0;
  };
  var onSeam = function (k) { return Math.abs(LON[k]) > 180 - 1e-6; };
  var acts = ACTS;
  acts.length = 0;
  for (i = 0; i < n; i++) if (onSeam(i) || kind((i - 1 + n) % n, i) === 1) acts.push(i);
  var made2 = 0, cur2 = null, curN = 0;
  function push(lo, la) {
    if (!cur2) cur2 = newRun(n + 8);
    cur2.v[curN * 2] = lo; cur2.v[curN * 2 + 1] = la; curN++;
  }
  function emit() {
    if (curN > 0) { cur2.n = curN; if (curN >= 3) { out.push(cur2); made2++; } }
    cur2 = null; curN = 0;
  }
  var wind = 0, plon = 0, latSum = 0;
  for (i = 0; i < n; i++) {
    var d3 = LON[i] - plon;
    if (i > 0) { while (d3 > 180) d3 -= 360; while (d3 < -180) d3 += 360; wind += d3; }
    plon = LON[i]; latSum += LAT[i];
  }
  var encircles = (Math.abs(wind) > 180) ? (latSum >= 0 ? 1 : -1) : 0;
  rg.rotWinds = encircles;
  if (!acts.length || encircles) {
    var prevU = null;
    for (i = 0; i < n; i++) {
      var lo3 = LON[i];
      if (prevU !== null) {
        while (lo3 - prevU > 180) lo3 -= 360;
        while (lo3 - prevU < -180) lo3 += 360;
      }
      push(lo3, LAT[i]); prevU = lo3;
    }
    cur2.winds = encircles; cur2.sealed = encircles !== 0;
    emit();
    return made2;
  }
  for (var ai = 0; ai < acts.length; ai++) {
    var b0 = acts[ai], b1 = acts[(ai + 1) % acts.length];
    var count = (b1 - b0 + n) % n;
    if (count === 0) count = n;
    cur2 = newRun(n + 8);
    for (i = 0; i < count; i++) push(LON[(b0 + i) % n], LAT[(b0 + i) % n]);
    cur2.sealed = true;
    emit();
  }
  return made2;
}
/* clip a flat UNWRAPPED lon/lat ring to the lon window [t*360-180, t*360+180]
   (the rotated frame's antimeridians) - flat-array Sutherland-Hodgman, one
   vertex per crossing, same rule as clipHalf above but without allocating a
   pair per vertex. Only valid for a pseudocyl projection: the cut line then
   projects onto the frame's outer meridians, so the cut is invisible
   (ringPieces' argument, unchanged). A closed ring clipped by two half-planes
   gains at most 4 vertices. The result lands in CLIPB, grown in place. */
var CLIPA = new Float64Array(16), CLIPB = new Float64Array(16);
function clipLonF(src, n, lo, hi) {
  var a = src, an = n, w = 0;
  for (var side = 0; side < 2; side++) {
    var bound = side ? hi : lo, keepAbove = side === 0;
    var out = side ? CLIPB : CLIPA;
    if (out.length < 2 * (an + 4)) {
      if (side) CLIPB = out = new Float64Array(2 * (an + 4));
      else CLIPA = out = new Float64Array(2 * (an + 4));
    }
    w = 0;
    for (var i = 0; i < an; i++) {
      var j = (i + 1) % an;
      var ax2 = a[i * 2], ay2 = a[i * 2 + 1];
      var bx2 = a[j * 2], by2 = a[j * 2 + 1];
      var ain = keepAbove ? ax2 >= bound : ax2 <= bound;
      var bin = keepAbove ? bx2 >= bound : bx2 <= bound;
      if (ain) {
        out[w * 2] = ax2; out[w * 2 + 1] = ay2; w++;
        if (!bin) {
          var t = (bound - ax2) / (bx2 - ax2);
          out[w * 2] = bound; out[w * 2 + 1] = ay2 + (by2 - ay2) * t; w++;
        }
      } else if (bin) {
        var t2 = (bound - ax2) / (bx2 - ax2);
        out[w * 2] = bound; out[w * 2 + 1] = ay2 + (by2 - ay2) * t2; w++;
      }
    }
    if (w < 3) return 0;
    a = out; an = w;
  }
  return w;
}

/* densify a clipped flat lon/lat polyline (closed by last->first) and project
   every point through `proj`, shifting lon back by LONSHIFT. Same walk as
   densifyRing (same epsilon so an edge already of `step` stays ONE segment,
   which is what makes this path reproduce the built layer point-for-point at
   center (0,0)) - keeping it a single walk means the long edges are treated
   identically to the build path: the closing edge of a ring that winds the
   rotated pole and the meridian cut edges both get points every `step`, which
   is what puts them along the frame's curved outer meridian / bottom edge
   instead of a straight chord (an Antarctica-sized 10-20 % area error otherwise).
   Returns the point count written into dst; countPts gives that count first so
   the per-ring buffers can be sized and never reallocated. */
/* densify a lon/lat ring (closed, [[lon,lat],...]) and project it with `proj` into
   a flat [x,y,...] array - the build pipeline's densifyRing, but taking the
   projection explicitly instead of reading CUR. Used for the rare ring that
   encircles a rotated pole (see rebuildRing). */
function densifyRingLL(coords, step, proj) {
  var out = [], n = coords.length;
  for (var i = 0; i < n; i++) {
    var a = coords[i], b = coords[(i + 1) % n];
    var lon1 = a[0], lat1 = a[1], lon2 = b[0], lat2 = b[1];
    var span = Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1));
    var seg = Math.max(1, Math.ceil(span / step - 1e-9));
    for (var k = 0; k < seg; k++) {
      var t = k / seg;
      proj.fwd((lon1 + (lon2 - lon1) * t) * DEG, (lat1 + (lat2 - lat1) * t) * DEG, TSP);
      out.push(TSP[0], TSP[1]);
    }
  }
  return out;
}

/* project a flat lon/lat polyline through `proj`, shifting lon back by LONSHIFT
   (the t*360 of the window the piece was clipped out of - ringPieces does the
   same with `cl[k][0] - t*360`).
   The ORIGINAL edges are kept as the chord between the already-densified
   endpoints: rg.xyz is the fine ring ALREADY densified in the original frame
   (rg.ll is densifyLonLat of the very pieces the build path used), so rotating
   those points keeps that polyline exactly. Re-densifying in rotated lon/lat
   would interpolate LINEARLY in rotated lon/lat, which is not a geodesic and
   near the rotated pole bends the coastline (measured: land total off by up to
   6.4 % for Antarctica, 5 % for China) - so no re-densify here.
   The CUT edges are the exception and must be densified: the build path's
   densifyRing walks the CLIPPED polygon, so it puts a point every `step` along
   the meridian at lon=+-180, and that meridian projects to the projection's
   curved OUTER MERIDIAN. Left as a straight chord a piece loses a sliver of the
   frame (that is what left Antarctica 14-24 % off against the build path). A
   constant-lon segment is a geodesic, so interpolating its latitude is exact. */
var LONSHIFT = 0, CUTLO = 0, CUTHI = 0;
function projectLL(src, n, proj, dst, step) {
  var w = 0;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    var lon1 = src[i * 2], lat1 = src[i * 2 + 1];
    var lon2 = src[j * 2], lat2 = src[j * 2 + 1];
    var onCut = Math.abs(lon1 - lon2) < 1e-9 &&
                (Math.abs(lon1 - CUTLO) < 1e-9 || Math.abs(lon1 - CUTHI) < 1e-9);
    var seg = 1;
    if (onCut) seg = Math.max(1, Math.ceil(Math.abs(lat2 - lat1) / step - 1e-9));
    for (var k = 0; k < seg; k++) {
      var t = k / seg;
      proj.fwd((lon1 + (lon2 - lon1) * t - LONSHIFT) * DEG,
               (lat1 + (lat2 - lat1) * t) * DEG, TSP);
      dst[w * 2] = TSP[0]; dst[w * 2 + 1] = TSP[1]; w++;
    }
  }
  return w;
}

/* ---------- one ring, re-projected around a new center ----------
   rotate + cut (rotateRingLL) -> project each run -> close it along the frame
   edge -> rebuild the ladder level in use. Everything lands in buffers cached on
   the ring (rg.pbuf = one Float64Array per piece, rg.pieces = the live piece list
   with {pts, n, bbox, levels, lw}), so a frame allocates nothing.
   The piece count varies with the center (a ring crossing a seam comes out as
   several runs), so rg.pieces.length is the live count.
   Cost measured on the real layers (viewer/recentercost.js): 8 ms for the whole
   110m layer and 20 ms for the 50m, plus ~1.5 ms for the frame and the graticule. */
function rebuildRing(rg, m, proj, step, thresholds, onlyLevel) {
  if (!rg.pieces) rg.pieces = [];
  if (!rg.pbuf) rg.pbuf = [];
  var pieces = rg.pieces, np = 0;
  var list = RUNLIST;
  list.length = 0;
  rotateRingLL(rg, m, proj, list);
  if (rg.rotWinds) {
    /* The ring ENCIRCLES a pole of the rotated frame, so its image is not the
       projection of a simple closed curve: the pole line has to be part of the
       boundary and getting that right by hand took several wrong attempts
       (China, whose ring contains the rotated pole when the view is centred on
       its antipode, came out at 73 % / 27 % of its area). This is rare - a few
       rings, only when the centre sits near their antipode - so the ROTATED ring
       is handed to the build pipeline itself, whose clipping is already exact:
       rotate to lon'/lat', then ringPieces + densifyRing, exactly as
       buildFeaturesLOD does for an unrotated country. */
    var nv = rg.xyz.length / 3, rot = [];
    for (var i2 = 0; i2 < nv; i2++) {
      var X2 = rg.xyz[i2 * 3], Y2 = rg.xyz[i2 * 3 + 1], Z2 = rg.xyz[i2 * 3 + 2];
      var Xr = m[0] * X2 + m[1] * Y2 + m[2] * Z2,
          Yr = m[3] * X2 + m[4] * Y2 + m[5] * Z2,
          Zr = m[6] * X2 + m[7] * Y2 + m[8] * Z2;
      rot.push([Math.atan2(-Zr, Xr) / DEG, Math.asin(Math.max(-1, Math.min(1, Yr))) / DEG]);
    }
    rot.push(rot[0].slice());
    var pcs = (rg.windsFallback = ringPieces(rot));
    for (var q2 = 0; q2 < pcs.length; q2++) {
      var flat = densifyRingLL(pcs[q2], step, proj);
      if (flat.length < 6) continue;
      var need2 = flat.length;
      var buf2 = rg.pbuf[np];
      if (!buf2 || buf2.length < need2) { buf2 = new Float64Array(need2); rg.pbuf[np] = buf2; }
      for (var v2 = 0; v2 < need2; v2++) buf2[v2] = flat[v2];
      var p2 = pieces[np] || (pieces[np] = { pts: buf2, n: 0, bbox: [0, 0, 0, 0], hole: rg.hole, levels: null, lw: null });
      p2.pts = buf2; p2.n = need2 / 2;
      var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (var w2 = 0; w2 < need2; w2 += 2) {
        if (buf2[w2] < bx0) bx0 = buf2[w2];
        if (buf2[w2] > bx1) bx1 = buf2[w2];
        if (buf2[w2 + 1] < by0) by0 = buf2[w2 + 1];
        if (buf2[w2 + 1] > by1) by1 = buf2[w2 + 1];
      }
      p2.bbox[0] = bx0; p2.bbox[1] = by0; p2.bbox[2] = bx1; p2.bbox[3] = by1;
      rebuildLevels(p2, p2.n, thresholds, onlyLevel);
      np++;
    }
    pieces.length = np;
    return np;
  }
  for (var q = 0; q < list.length; q++) {
    var run = list[q], n = run.n, pts = run.v;
    /* A sealed run ends exactly on a frame edge (lon' = +-180). Closing it with a
       chord would cut a sliver off the frame, because that edge is a meridian, a
       curve in the plane; so the closing stretch is walked along the meridian at
       `step`. A constant-lon' segment is exact in lon'/lat'. */
    var sealN = 1;
    if (run.sealed && Math.abs(Math.abs(pts[0]) - 180) < 1e-9) {
      var laA = pts[1], laB = pts[(n - 1) * 2 + 1];
      sealN = Math.max(1, Math.ceil(Math.abs(laB - laA) / step - 1e-9));
    }
    var poleSign = run.winds || 0;
    var poleN = poleSign ? Math.max(2, Math.ceil(90 / step)) : 0;
    /* A rim run (horizon clip) ends on the rim at lon' = +-90: close it along the
       rim, i.e. along those two meridians, through the nearer pole. Both legs are
       constant-lon', so walking them in lon/lat is exact. */
    var rimN = run.rim ? Math.max(2, Math.ceil(360 / step)) : 0;
    var need = 2 * (n + sealN + 2 * poleN + rimN + 8);
    var buf = rg.pbuf[np];
    if (!buf || buf.length < need) { buf = new Float64Array(need); rg.pbuf[np] = buf; }
    var cnt = 0, i;
    if (run.plane) {
      /* a cone-clipped run already holds PLANE coordinates (see rotateRingLL):
         copying them is the whole projection step, no trig per vertex */
      for (i = 0; i < n * 2; i++) buf[i] = pts[i];
      cnt = n;
    } else {
      for (i = 0; i < n; i++) {
        proj.fwd(pts[i * 2] * DEG, pts[i * 2 + 1] * DEG, TSP);
        buf[cnt * 2] = TSP[0]; buf[cnt * 2 + 1] = TSP[1]; cnt++;
      }
    }
    if (poleSign) {
      /* The loop ENCIRCLES a pole, so the region is that loop plus the polar cap
         and the cap is bounded by the FRAME, not by the country. Its boundary is
         therefore walked along the frame: from the run's last point to the pole
         at its own longitude of the seam, along the pole edge to the seam's other
         meridian, and down to the run's first point. In the plane that pole edge
         is the top (or bottom) of the frame - a single straight segment - and the
         two legs are constant-lon' meridians, so this is exact in lon/lat while
         being the frame's own boundary. */
      var laLast2 = pts[(n - 1) * 2 + 1], lonLast2 = pts[(n - 1) * 2];
      var laFirst2 = pts[1], lonFirst2 = pts[0];
      /* the seam meridian this loop crosses: the sign of the point opposite */
      var seam1 = lonLast2 >= 0 ? 180 : -180;
      var seam2 = lonFirst2 >= 0 ? 180 : -180;
      var legN = Math.max(2, Math.ceil(90 / step));
      for (i = 1; i <= legN; i++) {                 /* up/down to the pole edge */
        proj.fwd(lonLast2 * DEG, (laLast2 + (poleSign * 90 - laLast2) * (i / legN)) * DEG, TSP);
        buf[cnt * 2] = TSP[0]; buf[cnt * 2 + 1] = TSP[1]; cnt++;
      }
      /* along the pole edge, as a straight line in the plane: that IS the frame */
      proj.fwd(lonLast2 * DEG, poleSign * 90 * DEG, TSP);
      var ex = TSP[0], ey = TSP[1];
      proj.fwd(lonFirst2 * DEG, poleSign * 90 * DEG, TSP);
      var fx = TSP[0], fy = TSP[1];
      var edgeSeg = Math.max(2, Math.ceil(Math.hypot(fx - ex, fy - ey) / (step * DEG * 2)));
      for (i = 1; i < edgeSeg; i++) {
        buf[cnt * 2] = ex + (fx - ex) * (i / edgeSeg);
        buf[cnt * 2 + 1] = ey + (fy - ey) * (i / edgeSeg);
        cnt++;
      }
      for (i = 1; i <= legN; i++) {                 /* down/up to the first point */
        proj.fwd(lonFirst2 * DEG, (poleSign * 90 + (laFirst2 - poleSign * 90) * (i / legN)) * DEG, TSP);
        buf[cnt * 2] = TSP[0]; buf[cnt * 2 + 1] = TSP[1]; cnt++;
      }
    }
    if (rimN) {
      /* Close the run along the RIM: for a horizon projection the frame edge is the
         circle of radius extent[0], so this needs no projection at all. Two arcs
         close a run and only one is right; they differ by exactly one turn of the
         rim, i.e. the two closed polygons differ by the area of the whole disc, so
         the smaller one is the arc that hugs the limb - which is what the visible
         part of a country is. ("Follow the ring's orientation" and "go to the
         nearer pole" were both guesses that filled the whole disc at some centre.) */
      if (cnt > 0) {
        var th0 = Math.atan2(buf[1], buf[0]);
        var thL = Math.atan2(buf[(cnt - 1) * 2 + 1], buf[(cnt - 1) * 2]);
        var Rr = proj.extent[0];
        var sRun = 0;
        for (var sI = 0; sI < cnt - 1; sI++) {
          sRun += buf[sI * 2] * buf[(sI + 1) * 2 + 1] - buf[(sI + 1) * 2] * buf[sI * 2 + 1];
        }
        var sweep = th0 - thL;
        while (sweep <= 0) sweep += 2 * Math.PI;
        var aCcw = Math.abs(sRun + Rr * Rr * sweep);
        var aCw = Math.abs(sRun + Rr * Rr * (sweep - 2 * Math.PI));
        if (aCw < aCcw) sweep -= 2 * Math.PI;
        var segR = Math.max(1, Math.ceil(Math.abs(sweep) * Rr / (step * DEG)));
        for (var sR = 1; sR < segR; sR++) {
          var thR = thL + sweep * (sR / segR);
          buf[cnt * 2] = Rr * Math.cos(thR); buf[cnt * 2 + 1] = Rr * Math.sin(thR); cnt++;
        }
      }
    }
    if (sealN > 1) {
      var lonS = pts[0], la1 = pts[1], la2 = pts[(n - 1) * 2 + 1];
      for (i = 1; i < sealN; i++) {
        var t = i / sealN;
        proj.fwd(lonS * DEG, (la1 + (la2 - la1) * (1 - t)) * DEG, TSP);
        buf[cnt * 2] = TSP[0]; buf[cnt * 2 + 1] = TSP[1]; cnt++;
      }
    }
    if (cnt < 3) continue;
    var p = pieces[np] || (pieces[np] = { pts: buf, n: 0, bbox: [0, 0, 0, 0], hole: rg.hole, levels: null, lw: null });
    p.pts = buf; p.n = cnt;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var v = 0; v < cnt * 2; v += 2) {
      var pxx = buf[v], pyy = buf[v + 1];
      if (pxx < x0) x0 = pxx;
      if (pxx > x1) x1 = pxx;
      if (pyy < y0) y0 = pyy;
      if (pyy > y1) y1 = pyy;
    }
    p.bbox[0] = x0; p.bbox[1] = y0; p.bbox[2] = x1; p.bbox[3] = y1;
    rebuildLevels(p, cnt, thresholds, onlyLevel);
    np++;
  }
  pieces.length = np;
  return np;
}

/* one shared run list per frame (see rotateRingLL) */
var RUNLIST = [];

function rebuildLevels(p, n, thresholds, onlyLevel) {
  if (!p.levels) { p.levels = []; p.lw = []; }
  var t0 = (onlyLevel === undefined || onlyLevel < 0) ? 0 : onlyLevel;
  var t1 = (onlyLevel === undefined || onlyLevel < 0) ? thresholds.length : onlyLevel + 1;
  for (var t = t0; t < t1; t++) {
    var u = thresholds[t], idx = p.levels[t];
    if (!idx || idx.length < n) idx = p.levels[t] = new Int32Array(n);
    var w = 0;
    if (u === 0) {
      for (var i = 0; i < n; i++) idx[w++] = i;
    } else {
      var last = -1;
      for (var j = 0; j < n; j++) {
        if (last < 0) { idx[w++] = j; last = j; continue; }
        var dx = p.pts[j * 2] - p.pts[last * 2], dy = p.pts[j * 2 + 1] - p.pts[last * 2 + 1];
        if (dx * dx + dy * dy >= u * u) { idx[w++] = j; last = j; }
      }
      if (w < 3) { w = 0; for (var z = 0; z < n && w < 3; z++) idx[w++] = z; }
    }
    p.lw[t] = w;
    if (onlyLevel !== undefined && onlyLevel >= 0) p.builtT = onlyLevel;
  }
  if (onlyLevel !== undefined && onlyLevel >= 0) {
    /* Every OTHER level is now stale: it was computed from the point list of an
       earlier centre, so its indices point at the wrong vertices - and when the
       ring was re-cut, past the end of the list (measured: 845 points past on 15
       pieces of the 10m layer). Keeping them around is what made a draw between a
       zoom and its reprojection paint garbage. Drop them; ensureLevel-style
       laziness rebuilds one if it is ever asked for. */
    if (!p.levelN) p.levelN = [];
    p.levelN[onlyLevel] = n;
    for (var t2 = 0; t2 < p.levels.length; t2++) {
      if (t2 !== onlyLevel) { p.levels[t2] = null; p.lw[t2] = undefined; p.levelN[t2] = 0; }
    }
  } else {
    if (!p.levelN) p.levelN = [];
    for (var t3 = 0; t3 < p.levels.length; t3++) p.levelN[t3] = n;
  }
  return p.levels;
}
/* re-project every ring of every feature and refresh the feature bboxes (which
   are the only thing areas do NOT stay valid for).
   NO CULL, deliberately: the obvious optimization (skip the rings far from the
   centre) needs plane distance to bound ANGULAR distance, and this projection's
   plane scale degenerates at the poles - a point 90 deg from the centre near a
   pole sits at plane y ~ K, right at the frame edge - so a cheap angle-based
   bound would sometimes drop a visible ring. Every ring is reprojected; the
   per-feature cull then happens on the fresh bboxes (drawing skips off-screen
   features through onScreen()). Measured cost of the full pass: 5.5-8.5 ms for
   the 110m layer and 14-19 ms for the 50m (viewer/recentercost.js).
   m0 OPTIONAL: the frame in play. The app must pass it, because after a centre
   move that crossed a pole the frame carries a roll that no (lon,lat) describes,
   and rebuilding the canonical rotMat(lon,lat) there is exactly the spin bug.
   Callers that want the canonical frame (tests, a fresh view) omit it. */
function recenterAll(feats, lon0, lat0, proj, step, thresholds, onlyLevel, m0) {
  var m = m0 || rotMat(lon0, lat0, ROTM);
  resetRunPool();
  for (var i = 0; i < feats.length; i++) {
    var f = feats[i], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var r = 0; r < f.rings.length; r++) {
      rebuildRing(f.rings[r], m, proj, step, thresholds, onlyLevel);
    }
    for (var r2 = 0; r2 < f.rings.length; r2++) {
      var pcs = f.rings[r2].pieces;
      if (!pcs) continue;
      for (var q = 0; q < pcs.length; q++) {
        var b = pcs[q].bbox;
        if (b[0] < x0) x0 = b[0];
        if (b[1] < y0) y0 = b[1];
        if (b[2] > x1) x1 = b[2];
        if (b[3] > y1) y1 = b[3];
      }
    }
    f.bbox[0] = x0 === Infinity ? 0 : x0;
    f.bbox[1] = y0 === Infinity ? 0 : y0;
    f.bbox[2] = x1 === -Infinity ? 0 : x1;
    f.bbox[3] = y1 === -Infinity ? 0 : y1;
  }
  return feats;
}

/* planar area in projected space (steradians); projection is equal-area so
   steradians * R^2 is the true area. */
function ringAreaProjected(pts) {          /* pts = flat [x,y,x,y,...] */
  var n = pts.length / 2, a = 0;
  for (var i = 0; i < n; i++) {
    var x1 = pts[i * 2], y1 = pts[i * 2 + 1];
    var j = (i + 1) % n, x2 = pts[j * 2], y2 = pts[j * 2 + 1];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/* antimeridian handling: a ring may straddle lon=+-180 or (Antarctica) wrap
   the pole. Unwrap around three anchors and clip each variant to the
   lon range, so every piece stays inside the map frame and can be projected
   on its own. Clipping in lon/lat is exact for a pseudocylindrical
   projection because the clip line lon=+-180 projects to the frame's
   outer meridians. */
function ringPieces(ring) {
  var unw = unwrapRing(ring, ring[0][0]);
  var lmin = Infinity, lmax = -Infinity;
  for (var i = 0; i < unw.length; i++) {
    if (unw[i][0] < lmin) lmin = unw[i][0];
    if (unw[i][0] > lmax) lmax = unw[i][0];
  }
  /* one unwrap per 360-degree window; pieces are shifted back by t*360 so
     they project at their true x. Cut edges sit on lon=+-180, which are the
     frame's outer meridians, so the cut is invisible on a whole-world map. */
  var t0 = Math.floor((lmin + 180) / 360), t1 = Math.floor((lmax + 180) / 360);
  if (t1 - t0 > 2) t1 = t0 + 2;
  var pieces = [];
  for (var t = t0; t <= t1; t++) {
    var cl = clipHalf2(unw, t * 360 - 180, t * 360 + 180);
    if (cl.length < 3 || polyAreaLonLat(cl) < 1e-6) continue;
    var shifted = [];
    for (var k = 0; k < cl.length; k++) shifted.push([cl[k][0] - t * 360, cl[k][1]]);
    pieces.push(shifted);
  }
  return pieces.length ? pieces : [unw];
}
function clipHalf2(poly, lo, hi) {
  return clipHalf(clipHalf(poly, lo, true), hi, false);
}
function unwrapRing(ring, anchor) {
  var out = [[anchor, ring[0][1]]];
  for (var i = 1; i < ring.length; i++) {
    var prev = ring[i - 1][0], cur = ring[i][0];
    var d = cur - prev;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    out.push([out[out.length - 1][0] + d, ring[i][1]]);
  }
  return out;
}
function clipLonRange(poly, lo, hi) {   /* Sutherland-Hodgman, lon half-planes */
  var p = poly;
  p = clipHalf(p, lo, true);
  p = clipHalf(p, hi, false);
  return p;
}
function clipHalf(poly, bound, keepAbove) {
  var out = [];
  for (var i = 0; i < poly.length; i++) {
    var a = poly[i], b = poly[(i + 1) % poly.length];
    var ain = (keepAbove ? a[0] >= bound : a[0] <= bound);
    if (ain) {
      out.push(a);
      var bin = (keepAbove ? b[0] >= bound : b[0] <= bound);
      if (!bin) {
        var t = (bound - a[0]) / (b[0] - a[0]);
        out.push([bound, a[1] + (b[1] - a[1]) * t]);
      }
    } else {
      var bin2 = (keepAbove ? b[0] >= bound : b[0] <= bound);
      if (bin2) {
        var t2 = (bound - a[0]) / (b[0] - a[0]);
        out.push([bound, a[1] + (b[1] - a[1]) * t2]);
      }
    }
  }
  return out;
}
function polyAreaLonLat(poly) {
  var a = 0;
  for (var i = 0; i < poly.length; i++) {
    var p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/* densify a lon/lat ring so straight geographic edges follow the curved
   meridians of the projection; returns flat projected [x,y,...] */
function densifyRing(coords, step) {
  var out = [];
  var n = coords.length;
  for (var i = 0; i < n; i++) {
    var a = coords[i], b = coords[(i + 1) % n];
    var lon1 = a[0], lat1 = a[1], lon2 = b[0], lat2 = b[1];
    var span = Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1));
    var seg = Math.max(1, Math.ceil(span / step - 1e-9));
    for (var k = 0; k < seg; k++) {
      var t = k / seg;
      var p = project(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t);
      out.push(p[0], p[1]);
    }
  }
  return out;
}

/* Build renderable features from a GeoJSON FeatureCollection. */
function buildFeatures(geo, step) {
  var feats = [];
  for (var i = 0; i < geo.features.length; i++) {
    var f = geo.features[i];
    var rings = [];
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    var polys = f.geometry.coordinates;
    for (var p = 0; p < polys.length; p++) {
      var ringsOfPoly = polys[p];                    /* [outer, hole...] */
      for (var h = 0; h < ringsOfPoly.length; h++) {
        var ring = ringsOfPoly[h];
        if (!ring || ring.length < 4) continue;
        var pieces = ringPieces(ring);
        for (var pc = 0; pc < pieces.length; pc++) {
          var flat = densifyRing(pieces[pc], step);
          rings.push({ pts: flat, bbox: null, hole: h > 0 });
        }
      }
    }
    for (var r = 0; r < rings.length; r++) {
      var pts = rings[r].pts, bx = [Infinity, Infinity, -Infinity, -Infinity];
      for (var v = 0; v < pts.length; v += 2) {
        if (pts[v] < bx[0]) bx[0] = pts[v];
        if (pts[v] > bx[2]) bx[2] = pts[v];
        if (pts[v + 1] < bx[1]) bx[1] = pts[v + 1];
        if (pts[v + 1] > bx[3]) bx[3] = pts[v + 1];
      }
      rings[r].bbox = bx;
      if (bx[0] < minx) minx = bx[0];
      if (bx[1] < miny) miny = bx[1];
      if (bx[2] > maxx) maxx = bx[2];
      if (bx[3] > maxy) maxy = bx[3];
    }
    var areaSr = 0;
    for (var r2 = 0; r2 < rings.length; r2++) {
      var a = ringAreaProjected(rings[r2].pts);
      areaSr += rings[r2].hole ? -a : a;
    }
    var lp = f.properties.LABEL_X != null ? project(f.properties.LABEL_X, f.properties.LABEL_Y) : null;
    feats.push({
      props: f.properties,
      rings: rings,
      bbox: [minx, miny, maxx, maxy],
      areaSr: areaSr,
      areaKm2: f.properties.AREA_KM2 != null ? f.properties.AREA_KM2 : areaSr * SR_TO_KM2,
      label: lp
    });
  }
  return feats;
}

var LOD_U = [0.012, 0.006, 0.003, 0.0015, 0.0008, 0.0004, 0.0002, 0.0001, 0.00005, 0];

/* decimation ladder over an already-densified ring: level t keeps vertices
   that are >= LOD_U[t] apart in projected units, so the worst error at zoom k
   is LOD_U[t] * k projected units = that many screen px */
function makeLevels(proj, thresholds) {
  var n = proj.length / 2, levels = [];
  for (var t = 0; t < thresholds.length; t++) {
    var u = thresholds[t], idx = [];
    if (u === 0) {
      for (var i = 0; i < n; i++) idx.push(i);
    } else {
      var last = -1;
      for (var j = 0; j < n; j++) {
        var x = proj[j * 2], y = proj[j * 2 + 1];
        if (last < 0) { idx.push(j); last = j; continue; }
        var dx = x - proj[last * 2], dy = y - proj[last * 2 + 1];
        if (dx * dx + dy * dy >= u * u) { idx.push(j); last = j; }
      }
      if (idx.length < 3) { idx = []; for (var z = 0; z < n && idx.length < 3; z++) idx.push(z); }
    }
    levels.push(idx);
  }
  return levels;
}

/* build features with the LOD ladder. Rings are densified first (edges at
   most `step` degrees, so each edge is straight enough at any zoom) then
   decimated. Point arrays are precomputed once: a frame only reads them. */
function buildFeaturesLOD(geo, step, keepLL) {
  /* keepLL: also store the densified lon/lat ring next to its projection, with
     IDENTICAL point ordering, so the same index ladder can feed the 3D globe. */
  var feats = [];
  for (var i = 0; i < geo.features.length; i++) {
    var f = geo.features[i];
    var rings = [];
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    var polys = f.geometry.coordinates;
    for (var p = 0; p < polys.length; p++) {
      var ringsOfPoly = polys[p];
      for (var h = 0; h < ringsOfPoly.length; h++) {
        var ring = ringsOfPoly[h];
        if (!ring || ring.length < 4) continue;
        var pieces = ringPieces(ring);
        for (var pc = 0; pc < pieces.length; pc++) {
          var proj = densifyRing(pieces[pc], step);   /* already projected, closed */
          var n = proj.length / 2;
          rings.push({ pts: proj, bbox: null, hole: h > 0,
                       levels: null, lw: null, ll: null });
          if (keepLL) rings[rings.length - 1].ll = densifyLonLat(pieces[pc], step);
        }
      }
    }
    for (var r = 0; r < rings.length; r++) {
      var pts = rings[r].pts, bx = [Infinity, Infinity, -Infinity, -Infinity];
      for (var v = 0; v < pts.length; v += 2) {
        if (pts[v] < bx[0]) bx[0] = pts[v];
        if (pts[v] > bx[2]) bx[2] = pts[v];
        if (pts[v + 1] < bx[1]) bx[1] = pts[v + 1];
        if (pts[v + 1] > bx[3]) bx[3] = pts[v + 1];
      }
      rings[r].bbox = bx;
      if (bx[0] < minx) minx = bx[0];
      if (bx[1] < miny) miny = bx[1];
      if (bx[2] > maxx) maxx = bx[2];
      if (bx[3] > maxy) maxy = bx[3];
    }
    var areaSr = 0;
    for (var r2 = 0; r2 < rings.length; r2++) {
      var a = ringAreaProjected(rings[r2].pts);
      areaSr += rings[r2].hole ? -a : a;
    }
    var lp = f.properties.LABEL_X != null ? project(f.properties.LABEL_X, f.properties.LABEL_Y) : null;
    feats.push({
      props: f.properties,
      rings: rings,
      bbox: [minx, miny, maxx, maxy],
      areaSr: areaSr,
      areaKm2: f.properties.AREA_KM2 != null ? f.properties.AREA_KM2 : areaSr * SR_TO_KM2,
      label: lp
    });
  }
  return feats;
}

/* same decimated ring, but reading the lon/lat twin (identical point order
   as ring.pts) so the 3D globe can map the very same LOD subset onto a sphere */
function ringLLAtLevel(ring, t) {
  var idx = ensureLevel(ring, t), ll = ring.ll;
  if (!ll) return null;
  if (idx.length === ll.length / 2) return ll;
  var out = new Array(cnt * 2);
  for (var a = 0; a < cnt; a++) {
    var i = idx[a];
    out[a * 2] = ll[i * 2]; out[a * 2 + 1] = ll[i * 2 + 1];
  }
  return out;
}

/* The LOD ladder of a ring is built ON DEMAND. Building all ten levels for the
   10m layer costs ~100 ms of the 205 ms load and 10.6 MB of Int32Array, and a
   session typically uses two or three levels (the world view reads one, the globe
   another). `ensureLevel` builds one level and caches it; the level indices are
   pure functions of the projected points, so an unbuilt level costs nothing until
   something asks for it. */
function ensureLevel(ring, t) {
  if (!ring.levels) { ring.levels = []; ring.lw = []; }
  if (t < 0) t = 0;
  if (t >= LOD_U.length) t = LOD_U.length - 1;
  if (ring.levels[t]) return ring.levels[t];
  var pts = ring.pts, n = pts.length / 2, u = LOD_U[t];
  var idx = new Int32Array(n), w = 0, j;
  if (u === 0) {
    for (j = 0; j < n; j++) idx[w++] = j;
  } else {
    var last = -1;
    for (j = 0; j < n; j++) {
      if (last < 0) { idx[w++] = j; last = j; continue; }
      var dx = pts[j * 2] - pts[last * 2], dy = pts[j * 2 + 1] - pts[last * 2 + 1];
      if (dx * dx + dy * dy >= u * u) { idx[w++] = j; last = j; }
    }
    if (w < 3) { w = 0; for (var z = 0; z < n && w < 3; z++) idx[w++] = z; }
  }
  ring.levels[t] = idx;
  ring.lw[t] = w;
  return idx;
}
function levelIndex(ring, k, maxPx) {
  for (var t = 0; t < LOD_U.length - 1; t++) {
    if (LOD_U[t] * k <= maxPx) return t;
  }
  return LOD_U.length - 1;
}

/* index list of a ring at an explicit ladder level (for the 3D globe, where
   the level is chosen by camera distance rather than by current view) */
function ringAtLevel(ring, t) {
  var idx = ensureLevel(ring, t), pts = ring.pts;
  if (idx.length === pts.length / 2) return pts;
  var out = new Array(idx.length * 2);
  for (var a = 0; a < idx.length; a++) {
    var i = idx[a];
    out[a * 2] = pts[i * 2]; out[a * 2 + 1] = pts[i * 2 + 1];
  }
  return out;
}

/* flat projected coords of a ring at zoom k (coarsest level under maxPx error) */
function ringFlat(ring, k, maxPx) {
  var t = levelIndex(ring, k, maxPx);
  var idx = ensureLevel(ring, t), pts = ring.pts, n = ring.lw[t];
  if (n === pts.length / 2) return pts;                 /* full detail: reuse array */
  var out = new Array(n * 2);
  for (var a = 0; a < n; a++) {
    var i = idx[a];
    out[a * 2] = pts[i * 2]; out[a * 2 + 1] = pts[i * 2 + 1];
  }
  return out;
}

/* Lawson flips: turn the ear-clipped mesh toward a constrained Delaunay
   triangulation, in place. VENDORED VERBATIM from earcut v3.2.4 `src/earcut.js`
   (the `refine` post-pass and its scratch/predicates; only the exported name is
   renamed to refineTri and the `export` keyword dropped).

   Why this matters: the ear clipper below is fine on COVERAGE (measured on the
   real 50m layer: 0 gaps, 0.4 % spikes over sea, and that 0.4 % is the geodesic
   chord, not the clipper) but its ear ORDER is terrible on SHAPE, because
   densification inserts vertices nearly collinear with their neighbours. Measured
   across all 9 LOD levels: 24 % of triangles at LOD 0 and 48 % at LOD 8 have a
   minimum angle under 2 degrees - the long thin slivers that made the globe look
   bad. Legalizing every interior edge drops that to 1.2 % / 4.9 %, costs ~1 % of
   the clip (16 ms vs 1.7 s at LOD 8), keeps triangle COUNT and covered area
   identical, and cannot cross a boundary edge (those keep he = -1), so the
   coastline stays exactly where the ring puts it.

   Precondition: consistently CCW input, which triangulateRing guarantees by
   normalizing the signed area. */

// Reusable module-level scratch for refine():
//   he      = twin half-edge of each edge, or -1 on the polygon boundary
//   hTable  = open-addressing hash, slot -> half-edge index, valid iff hStamp[slot] === gen
//   edgeStamp = pending-in-stack flag, cleared when the edge is popped
/** @type {Int32Array} */ let edgeStack;
/** @type {Int32Array} */ let he;
/** @type {Int32Array} */ let hTable;
/** @type {Uint32Array} */ let hStamp;
/** @type {Uint8Array} */ let edgeStamp;
let hMask = 0, gen = 0;

/**
 * Refine a triangulation toward the constrained Delaunay triangulation by legalizing every
 * interior edge in place with Lawson flips — maximizing the minimum angle and removing most
 * slivers. An optional post-pass for {@link earcut} output, or any manifold triangle-index array
 * indexing into `coords`. Adapted from delaunator's edge legalization.
 *
 * Uses non-robust predicates: float input is fine, and the worst case is a not-quite-Delaunay
 * edge, never an invalid mesh.
 *
 * @param {number[]} triangles triangle indices, as returned by {@link earcut}; mutated in place
 * @param {ArrayLike<number>} coords the flat vertex coordinates passed to {@link earcut}
 * @param {number} [dim=2] number of coordinates per vertex in `coords`
 * @example refine(earcut(data), data);
 */
function refineTri(triangles, coords, dim = 2) {
    const t = triangles;
    const n = t.length;
    if (n < 6) return;
    ensureScratch(n);
    gen++;              // bumping the generation logically empties the hash (no clearing)
    he.fill(-1, 0, n);

    // Build half-edge twins with an undirected-edge hash; consumed slots mark linked pairs. As each
    // pair is linked we seed the stack with one representative (s, the earlier-inserted edge) — this
    // fuses the initial "push every interior edge" pass into the build, saving a full O(n) scan.
    // edgeStamp is all-zero here (balanced push/pop leaves it clean) and each pair links once, so
    // the seed write needs no dedup guard.
    let i = 0;
    for (let e = 0; e < n; e++) {
        const a = t[e], b = t[nextHE(e)];
        const lo = a < b ? a : b, hi = a < b ? b : a;
        let h = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca6b)) & hMask;
        while (hStamp[h] === gen) {
            const s = hTable[h];
            // s === -1 marks a consumed slot (a pair already linked) — skip past it
            if (s !== -1) {
                const sa = t[s], sb = t[nextHE(s)];
                if ((sa === lo && sb === hi) || (sa === hi && sb === lo)) {
                    he[e] = s; he[s] = e; hTable[h] = -1; // link, then consume the slot
                    edgeStamp[s] = 1; edgeStack[i++] = s; // seed the interior edge for the cascade
                    break;
                }
            }
            h = (h + 1) & hMask;
        }
        if (hStamp[h] !== gen) { hTable[h] = e; hStamp[h] = gen; } // first occurrence: insert
    }

    while (i > 0) {
        const a = edgeStack[--i];
        edgeStamp[a] = 0;
        const b = he[a];
        if (b === -1) continue;

        const a0 = a - a % 3;
        const b0 = b - b % 3;
        const ar = a0 + (a + 2) % 3;
        const al = a0 + (a + 1) % 3;
        const bl = b0 + (b + 2) % 3;
        const br = b0 + (b + 1) % 3;
        const p0 = t[ar], pr = t[a], pl = t[al], p1 = t[bl];

        const x0 = coords[p0 * dim], y0 = coords[p0 * dim + 1];
        const xr = coords[pr * dim], yr = coords[pr * dim + 1];
        const xl = coords[pl * dim], yl = coords[pl * dim + 1];
        const x1 = coords[p1 * dim], y1 = coords[p1 * dim + 1];

        // Test inCircle first: most interior edges are already Delaunay (inCircle true → no flip),
        // so this short-circuits before the two convexity orients on the common path. The quad must
        // also be convex (both new triangles CCW) — flipping a reflex quad would push a triangle
        // outside the polygon. Boundary/hole edges need no guard — they self-protect via he === -1.
        if (!inCircle(x0, y0, xr, yr, xl, yl, x1, y1) &&
            orient(x0, y0, xr, yr, x1, y1) > 0 && orient(x0, y0, x1, y1, xl, yl) > 0) {
            t[a] = p1; t[b] = p0;
            const hbl = he[bl], har = he[ar];
            he[a] = hbl; if (hbl !== -1) he[hbl] = a;
            he[b] = har; if (har !== -1) he[har] = b;
            he[ar] = bl; he[bl] = ar;

            // re-check the quad's four outer edges; skip boundary edges (he === -1) and any
            // already queued (edgeStamp), which also keeps the stack bounded by n.
            if (hbl    !== -1 && edgeStamp[a]  === 0) { edgeStamp[a]  = 1; edgeStack[i++] = a; }
            if (har    !== -1 && edgeStamp[b]  === 0) { edgeStamp[b]  = 1; edgeStack[i++] = b; }
            if (he[al] !== -1 && edgeStamp[al] === 0) { edgeStamp[al] = 1; edgeStack[i++] = al; }
            if (he[br] !== -1 && edgeStamp[br] === 0) { edgeStamp[br] = 1; edgeStack[i++] = br; }
        }
    }
}

/** @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} cx @param {number} cy */
function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Whether p is inside or exactly on the circumcircle of triangle (a, b, c). Sign is negated vs the
// usual predicate to match earcut's CCW winding — the standard sign would build the anti-Delaunay
// mesh. Cocircular quads are legal ties, so refine only flips when this returns false.
/** @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} cx @param {number} cy @param {number} px @param {number} py */
function inCircle(ax, ay, bx, by, cx, cy, px, py) {
    const dx = ax - px, dy = ay - py, ex = bx - px, ey = by - py, fx = cx - px, fy = cy - py;
    const ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy;
    // A near-cocircular quad is a legal Delaunay tie, but roundoff can flag both an edge and its
    // flip as illegal, cascading into an endless flip loop (#205) — so treat a determinant within
    // a small margin of zero as a tie. The determinant's worst-case roundoff error is provably
    // below 9e-16·(ap + bp + cp)² (Shewchuk-style bound), so the margin guarantees every executed
    // flip is illegal in exact arithmetic, and Lawson flipping always terminates.
    const s = ap + bp + cp;
    return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) <= 1e-13 * s * s;
}

/** @param {number} e */
function nextHE(e) { // next half-edge within the same triangle
    return e - e % 3 + (e + 1) % 3;
}

// Grow the scratch arrays on demand (like earcut's z-order arrays). Allocating lazily here rather
// than at module load lets the whole refine() block tree-shake away for callers who don't use it.
/** @param {number} n */
function ensureScratch(n) {
    // edgeStack holds at most one entry per half-edge (edgeStamp dedups), so n is a safe cap —
    // sizing it up front lets the cascade push without a bounds/grow check.
    if (!edgeStack || edgeStack.length < n) edgeStack = new Int32Array(n);
    if (!he || he.length < n) he = new Int32Array(n);
    if (!edgeStamp || edgeStamp.length < n) edgeStamp = new Uint8Array(n);
    let size = 1;
    while (size < n * 4) size <<= 1; // power-of-two table, load factor <= 0.25
    if (!hTable || hTable.length < size) { hTable = new Int32Array(size); hStamp = new Uint32Array(size); }
    hMask = size - 1;
}

/* Cached triangulation of a ring at a LOD level.

   The clip is the expensive part of a globe build (measured on the 50m layer:
   1.7 s of clipping at LOD 8 against 16 ms of Lawson refinement), and the
   result depends on nothing but (ring, level) - so cache it on the ring. A
   rebuild, a layer switch, or a re-pick after zooming then pays the 16 ms
   refine, never the 1.7 s clip. ring.levels[] already holds one index list per
   level, so tris[] runs parallel to it. */
function ringTris(ring, t) {
  if (!ring.tris) ring.tris = [];
  var hit = ring.tris[t];
  if (hit) return hit;
  var lla = ringLLAtLevel(ring, t);
  var out = [];
  if (lla && lla.length >= 6) {
    /* refineTri mutates its triangle array in place and returns nothing (as in
       the vendored source), so keep the clip's array, do not chain the calls */
    out = triangulateRing(lla);
    refineTri(out, lla);
  }
  ring.tris[t] = out;
  return out;
}

/* ---------- the GLOBE's own LOD ladder: sewn, decimation only on the outside ----------
   The 2D ladder above decimates every ring INDEPENDENTLY, which is fine on a flat
   map (a hairline of background between two countries reads as a border stroke)
   but NOT on the globe, where the land is a crust over an ocean sphere: a border
   kept on one side and dropped on the other opens a crack down to the sea.
   Measured on the 2D ladder, share of drawn border edges used by only one side:
     110m  lvl0 84.7%  lvl1 67.1%  lvl2 24.1%  lvl4 0.3%   50m  lvl0 93.4% lvl1 80.9%
   So at the coarse levels the globe was actually drawing about HALF of the national
   borders (the country outlines were still closed loops, so land stayed solid - but
   the shared edge was gone, and the interior border stroke was missing).

   Fix: a vertex of a ring whose FINE edge is shared with another ring is a BORDER
   vertex, and it must be kept at EVERY level - then both sides of a shared border
   agree on where it runs, and the decimation only happens on the OUTSIDE (which
   must stay exact anyway, it is the silhouette against the sea). One shared-edge
   pass over the finest level, then the same distance ladder with those vertices
   forced. Measured (viewer/sewvar.js): unmatched border edges go to 0.0% at every
   level, and the vertex cost is x2.9 at LOD 0 (25.7k for 110m, 52.5k for 50m)
   against x1.0 at LOD 3+ - the borders are simply denser than the coasts, which
   is what the globe's own LOD level (see app.js) then keeps hidden.
   The 2D ladder is left untouched: it is what hover/pick and the flat map run on,
   and changing it would change the screen-px error budget that was tuned there. */
function sewGlobeLadder(feats) {
  var vk = function (x, y) { return Math.round(x * 1e6) + ',' + Math.round(y * 1e6); };
  var shared = {}, ends = [];
  for (var i = 0; i < feats.length; i++) for (var r = 0; r < feats[i].rings.length; r++) {
    var rg = feats[i].rings[r], ll = rg.ll, n = ll.length / 2;
    if (!ll) continue;
    for (var e = 0; e < n; e++) {
      var a = vk(ll[e * 2], ll[e * 2 + 1]), b = vk(ll[((e + 1) % n) * 2], ll[((e + 1) % n) * 2 + 1]);
      if (a === b) continue;
      var k = a < b ? a + '|' + b : b + '|' + a;
      shared[k] = (shared[k] || 0) + 1;
      if (shared[k] === 1) ends.push(a, b);
    }
  }
  var forced = {};
  for (var q = 0; q < ends.length; q += 2) {
    var a2 = ends[q], b2 = ends[q + 1];
    var k2 = a2 < b2 ? a2 + '|' + b2 : b2 + '|' + a2;
    /* the map is only needed to count, the endpoints were pushed for the same
       edges, so re-reading the count here is O(1) and avoids a second pass */
    if (shared[k2] > 1) { forced[a2] = 1; forced[b2] = 1; }
  }
  for (var t = 0; t < LOD_U.length; t++) {
    var u = LOD_U[t];
    for (var i2 = 0; i2 < feats.length; i2++) for (var r2 = 0; r2 < feats[i2].rings.length; r2++) {
      var rg2 = feats[i2].rings[r2], ll2 = rg2.ll, pts = rg2.pts, nF = ll2.length / 2;
      if (!ll2) continue;
      var idx = [], last = -1;
      if (u === 0) {
        for (var j2 = 0; j2 < nF; j2++) idx.push(j2);
      } else {
        for (var j = 0; j < nF; j++) {
          var keep = last < 0;
          if (!keep) {
            var dx = pts[j * 2] - pts[last * 2], dy = pts[j * 2 + 1] - pts[last * 2 + 1];
            if (dx * dx + dy * dy >= u * u) keep = true;
          }
          if (!keep && forced[vk(ll2[j * 2], ll2[j * 2 + 1])] === 1) keep = true;
          if (keep) { idx.push(j); last = j; }
        }
      }
      if (idx.length < 3) { idx = []; for (var z = 0; z < nF && idx.length < 3; z++) idx.push(z); }
      if (!rg2.gl) rg2.gl = [];
      rg2.gl[t] = idx;
      rg2.gtris = [];
    }
  }
  return forced;
}

/* the globe reads its OWN ladder (rg.gl) and its own tri cache (rg.gtris): the
   2D ladder and the 2D tri cache stay what the flat map was tuned on, and a
   level switch never invalidates the other view's work */
function ringGlobeLLAtLevel(ring, t) {
  var idx = ring.gl[t], ll = ring.ll;
  if (idx.length === ll.length / 2) return ll;
  var out = new Array(cnt * 2);
  for (var a = 0; a < cnt; a++) {
    var i = idx[a];
    out[a * 2] = ll[i * 2]; out[a * 2 + 1] = ll[i * 2 + 1];
  }
  return out;
}

function ringGlobeTris(ring, t) {
  if (!ring.gtris) ring.gtris = [];
  var hit = ring.gtris[t];
  if (hit) return hit;
  var lla = ringGlobeLLAtLevel(ring, t);
  var out = [];
  if (lla && lla.length >= 6) {
    out = triangulateRing(lla);
    refineTri(out, lla);   /* mutates in place, returns nothing: keep the clip's array */
  }
  ring.gtris[t] = out;
  return out;
}

function triangulateRing(poly) {
  /* flat [x,y,...] ring -> flat list of triangle vertex INDICES into poly
     (so callers can map the same vertices to lon/lat and onto a sphere).
     Ear clipping with: collinear removal, convexity, diagonal-vs-edge
     intersection and a reflex-vertex containment test. Densified borders are
     full of nearly-collinear vertices, so all three tests are needed. */
  var n0 = poly.length / 2;
  if (n0 < 3) return [];
  var p = [], src = [];
  for (var i = 0; i < n0; i++) {
    var x = poly[i * 2], y = poly[i * 2 + 1];
    var m = p.length / 2;
    if (m > 0 && x === p[(m - 1) * 2] && y === p[(m - 1) * 2 + 1]) continue;
    p.push(x, y); src.push(i);
  }
  if (p.length >= 2 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) {
    p = p.slice(0, p.length - 2); src = src.slice(0, src.length - 1);
  }
  var n = p.length / 2;
  if (n < 3) return [];

  var A = 0;
  for (var i2 = 0; i2 < n; i2++) { var j = (i2 + 1) % n; A += p[i2 * 2] * p[j * 2 + 1] - p[j * 2] * p[i2 * 2 + 1]; }
  if (A === 0) return [];
  if (A < 0) { var q = [], qs = []; for (var k = n - 1; k >= 0; k--) { q.push(p[k * 2], p[k * 2 + 1]); qs.push(src[k]); } p = q; src = qs; }

  var ex = 0, ey = 0;
  for (var c2 = 0; c2 < n; c2++) { ex += p[c2 * 2]; ey += p[c2 * 2 + 1]; }
  var mx = 1;
  for (var c3 = 0; c3 < n; c3++) {
    var dxx = p[c3 * 2] - ex / n, dyy = p[c3 * 2 + 1] - ey / n;
    var d2 = dxx * dxx + dyy * dyy;
    if (d2 > mx) mx = d2;
  }
  /* cross() is in SQUARE units (it is a 2x-area determinant), so the tolerance
     must be a squared length: 1e-11 * mx (max distance from the centroid)
     SQUARED, i.e. a relative cross-product cutoff. Written as mx*mx below. */
  var eps = 1e-11 * mx * mx;

  function cross(a, b, c) {
    return (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) -
           (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2]);
  }

  var alive = new Uint8Array(n); alive.fill(1);
  var prev = new Int32Array(n), next = new Int32Array(n);
  for (var v = 0; v < n; v++) { prev[v] = (v - 1 + n) % n; next[v] = (v + 1) % n; }

  /* pass 1: drop collinear vertices (keeps the area exact) */
  var left = n, pass = 0, removed = 0;
  while (pass < 6 && left > 3) {
    var changed = false;
    for (var v2 = 0; v2 < n; v2++) {
      if (!alive[v2]) continue;
      if (Math.abs(cross(prev[v2], v2, next[v2])) <= eps) {
        next[prev[v2]] = next[v2]; prev[next[v2]] = prev[v2];
        alive[v2] = 0; left--; removed++; changed = true;
      }
    }
    if (!changed) break;
    pass++;
  }
  if (left < 3 || removed === n) return [];

  var reflex = new Uint8Array(n);
  for (var v3 = 0; v3 < n; v3++) if (alive[v3]) reflex[v3] = cross(prev[v3], v3, next[v3]) < 0 ? 1 : 0;

  function inside(q, a, b, c) {
    var qx = p[q * 2], qy = p[q * 2 + 1];
    var d1 = (p[c * 2] - qx) * (p[b * 2 + 1] - qy) - (p[c * 2 + 1] - qy) * (p[b * 2] - qx);
    var d2 = (p[a * 2] - qx) * (p[c * 2 + 1] - qy) - (p[a * 2 + 1] - qy) * (p[c * 2] - qx);
    var d3 = (p[b * 2] - qx) * (p[c * 2 + 1] - qy) - (p[b * 2 + 1] - qy) * (p[c * 2] - qx);
    return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
  }
  function segProper(i, j, k, l) {
    var x1 = p[i * 2], y1 = p[i * 2 + 1], x2 = p[j * 2], y2 = p[j * 2 + 1];
    var x3 = p[k * 2], y3 = p[k * 2 + 1], x4 = p[l * 2], y4 = p[l * 2 + 1];
    var d1 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    var d2 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1);
    var d3 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
    var d4 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3);
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
  }
  function diagOK(a, c) {
    for (var e1 = 0; e1 < n; e1++) {
      if (!alive[e1]) continue;
      var e2 = next[e1];
      if (e1 === a || e2 === a || e1 === c || e2 === c) continue;
      if (segProper(a, c, e1, e2)) return false;
    }
    return true;
  }
  function isEar(v) {
    if (reflex[v] || !alive[v]) return false;
    var a = prev[v], b = v, c = next[v];
    if (cross(a, b, c) <= eps) return false;
    if (!diagOK(a, c)) return false;
    for (var q2 = 0; q2 < n; q2++) {
      if (!alive[q2] || !reflex[q2] || q2 === a || q2 === b || q2 === c) continue;
      if (inside(q2, a, b, c)) return false;
    }
    return true;
  }

  var queue = [];
  for (var v4 = 0; v4 < n; v4++) if (alive[v4] && isEar(v4)) queue.push(v4);
  var out = [], guard = 0;

  function cut(v5) {
    var a1 = prev[v5], c1 = next[v5];
    var cr = cross(a1, v5, c1);
    if (cr > eps) out.push(src[a1], src[v5], src[c1]);
    alive[v5] = 0; left--;
    next[a1] = c1; prev[c1] = a1;
    reflex[a1] = cross(prev[a1], a1, next[a1]) < 0 ? 1 : 0;
    reflex[c1] = cross(prev[c1], c1, next[c1]) < 0 ? 1 : 0;
    if (alive[a1] && isEar(a1)) queue.push(a1);
    if (alive[c1] && isEar(c1)) queue.push(c1);
  }

  while (left > 3) {
    var pick = -1;
    while (queue.length) {
      var cand = queue.pop();
      if (alive[cand] && isEar(cand)) { pick = cand; break; }
    }
    if (pick < 0) {
      var bestV = -1, bestC = eps;
      for (var fv = 0; fv < n; fv++) {
        if (!alive[fv]) continue;
        var cr2 = cross(prev[fv], fv, next[fv]);
        if (cr2 > bestC) { bestC = cr2; bestV = fv; }
      }
      if (bestV < 0) break;
      pick = bestV;
      if (++guard > 3 * n) break;
    } else guard = 0;
    cut(pick);
  }
  var rem = [];
  for (var r = 0; r < n; r++) if (alive[r]) rem.push(r);
  if (rem.length === 3 && cross(rem[0], rem[1], rem[2]) > eps) out.push(src[rem[0]], src[rem[1]], src[rem[2]]);
  return out;
}

/* densify a lon/lat ring (closed) into flat [lon,lat,...] - same walk as
   densifyRing but keeping geographic coords, for the 3D globe */
function densifyLonLat(coords, step) {
  var out = [];
  var n = coords.length;
  for (var i = 0; i < n; i++) {
    var a = coords[i], b = coords[(i + 1) % n];
    var lon1 = a[0], lat1 = a[1], lon2 = b[0], lat2 = b[1];
    var span = Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1));
    var seg = Math.max(1, Math.ceil(span / step - 1e-9));
    for (var k = 0; k < seg; k++) {
      var t = k / seg;
      out.push(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t);
    }
  }
  return out;
}

/* even-odd point-in-polygon over LOD rings, using the same subdivision as
   drawing so hover/pick agrees with what is on screen */
function hitTestLOD(feats, X, Y, k) {
  var hits = [];
  for (var i = 0; i < feats.length; i++) {
    var ft = feats[i], b = ft.bbox;
    if (X < b[0] || X > b[2] || Y < b[1] || Y > b[3]) continue;
    var inside = false;
    for (var r = 0; r < ft.rings.length; r++) {
      var rg = ft.rings[r], rb = rg.bbox;
      if (X < rb[0] || X > rb[2] || Y < rb[1] || Y > rb[3]) continue;
      var pts = ringFlat(rg, k, 0.7), n = pts.length >> 1;
      for (var a = 0, bb = n - 1; a < n; bb = a++) {
        var x1 = pts[a * 2], y1 = pts[a * 2 + 1], x2 = pts[bb * 2], y2 = pts[bb * 2 + 1];
        if (((y1 > Y) !== (y2 > Y)) && (X < (x2 - x1) * (Y - y1) / (y2 - y1) + x1)) inside = !inside;
      }
    }
    if (inside) hits.push(i);
  }
  return hits;
}

/* even-odd point in polygon, in projected space; scans all rings of all
   features whose bbox contains the point (holes handled by parity) */
function hitTest(feats, X, Y) {
  var hits = [];
  for (var i = 0; i < feats.length; i++) {
    var ft = feats[i], b = ft.bbox;
    if (X < b[0] || X > b[2] || Y < b[1] || Y > b[3]) continue;
    var inside = false;
    for (var r = 0; r < ft.rings.length; r++) {
      var rb = ft.rings[r].bbox;
      if (X < rb[0] || X > rb[2] || Y < rb[1] || Y > rb[3]) continue;
      var pts = ft.rings[r].pts, n = pts.length / 2;
      for (var a = 0, bb = n - 1; a < n; bb = a++) {
        var x1 = pts[a * 2], y1 = pts[a * 2 + 1], x2 = pts[bb * 2], y2 = pts[bb * 2 + 1];
        if (((y1 > Y) !== (y2 > Y)) && (X < (x2 - x1) * (Y - y1) / (y2 - y1) + x1)) inside = !inside;
      }
    }
    if (inside) hits.push(i);
  }
  return hits;
}

/* even-odd point in polygon, in projected space; scans all rings of all
   features whose bbox contains the point (holes handled by parity) */
function hitTest(feats, X, Y) {
  var hits = [];
  for (var i = 0; i < feats.length; i++) {
    var ft = feats[i], b = ft.bbox;
    if (X < b[0] || X > b[2] || Y < b[1] || Y > b[3]) continue;
    var inside = false;
    for (var r = 0; r < ft.rings.length; r++) {
      var rb = ft.rings[r].bbox;
      if (X < rb[0] || X > rb[2] || Y < rb[1] || Y > rb[3]) continue;
      var pts = ft.rings[r].pts, n = pts.length / 2;
      for (var a = 0, bb = n - 1; a < n; bb = a++) {
        var x1 = pts[a * 2], y1 = pts[a * 2 + 1], x2 = pts[bb * 2], y2 = pts[bb * 2 + 1];
        if (((y1 > Y) !== (y2 > Y)) && (X < (x2 - x1) * (Y - y1) / (y2 - y1) + x1)) inside = !inside;
      }
    }
    if (inside) hits.push(i);
  }
  return hits;
}

/* the projection outline: outer meridians are semicircles, poles are lines
   half as long as the equator */
function frameOutline(step) {
  var path = [];
  for (var lat = -90; lat <= 90; lat += step) path.push(project(180, lat));
  for (var lon = 180; lon >= -180; lon -= step) path.push(project(lon, 90));
  for (var lat2 = 90; lat2 >= -90; lat2 -= step) path.push(project(-180, lat2));
  for (var lon2 = -180; lon2 <= 180; lon2 += step) path.push(project(lon2, -90));
  return path;
}

/* graticule polylines of the frame in play (static grid) */
function graticule(step, dlon, dlat) {
  var lines = [];
  for (var lon = -180; lon <= 180; lon += dlon) {
    var l = [];
    for (var lat = -90; lat <= 90; lat += step) l.push(project(lon, lat));
    lines.push(l);
  }
  for (var lat2 = -90; lat2 <= 90; lat2 += dlat) {
    var m = [];
    for (var lon2 = -180; lon2 <= 180; lon2 += step) m.push(project(lon2, lat2));
    lines.push(m);
  }
  return lines;
}

/* the 3D globe stores the lon/lat twin (rg.ll); the recentered 2D view needs the
   same ring as unit vectors. Built ONCE per layer from rg.ll, which is densifyLonLat
   of the very pieces the build path densified - same points, so rotating them keeps
   the polyline identical to the built layer's. */
function prepareXYZ(feats) {
  for (var i = 0; i < feats.length; i++) {
    var rings = feats[i].rings;
    for (var r = 0; r < rings.length; r++) {
      var rg = rings[r], ll = rg.ll;
      if (!ll || rg.xyz) continue;
      var n = ll.length / 2, v = new Float64Array(n * 3);
      for (var k = 0; k < n; k++) {
        var a = ll[k * 2] * DEG, b = ll[k * 2 + 1] * DEG;
        var s = Math.sin(b), c = Math.cos(b);
        v[k * 3] = c * Math.cos(a); v[k * 3 + 1] = s; v[k * 3 + 2] = -c * Math.sin(a);
      }
      rg.xyz = v;
    }
  }
  return feats;
}

/* ---------- helpers for the recentered view ----------
   A single geographic point -> the plane of the frame centered at (lon0,lat0).
   m is the rotation from rotMat. */
function projectRotLL(lonDeg, latDeg, m, proj, out) {
  var phi = latDeg * DEG, lam = lonDeg * DEG;
  var s = Math.sin(phi), c = Math.cos(phi);
  var x = c * Math.cos(lam), y = s, z = -c * Math.sin(lam);
  var X = m[0] * x + m[1] * y + m[2] * z,
      Y = m[3] * x + m[4] * y + m[5] * z,
      Z = m[6] * x + m[7] * y + m[8] * z;
  var phi2 = Math.asin(Math.max(-1, Math.min(1, Y)));
  var lam2 = Math.atan2(-Z, X);
  proj.fwd(lam2, phi2, out);
  return out;
}

/* projectRotLL + the visibility test of visibleAt, in ONE pass: one rotation and
   one fwd() per point instead of two.
   This is the hot path of the city layer (7 342 points, tested every frame), so it
   also avoids the plain projectRotLL's trap: on a cone-clipped projection the
   hidden cap maps ONTO the visible disc, so a point behind the world projects to a
   perfectly plausible screen position. The X' >= clipCos test is what tells them
   apart. Returns true when the point is drawn, and `out` holds the plane point
   either way. */
function projectRotLLVis(lonDeg, latDeg, m, proj, out) {
  var phi = latDeg * DEG, lam = lonDeg * DEG;
  var s = Math.sin(phi), c = Math.cos(phi);
  var x = c * Math.cos(lam), y = s, z = -c * Math.sin(lam);
  var X = m[0] * x + m[1] * y + m[2] * z,
      Y = m[3] * x + m[4] * y + m[5] * z,
      Z = m[6] * x + m[7] * y + m[8] * z;
  /* EPS at the limb: a point EXACTLY on the rim (cos of the angular distance = 0,
     e.g. the South Pole station seen from a centre on the equator) computes X as
     -6e-17, i.e. a hair on the hidden side. It belongs to the drawn rim, not the
     hidden cap, so the test is given the same 1e-12 slack the geometry has. */
  var vis = !(proj.clip === 'cone' && X < (proj.clipCos || 0) - 1e-12);
  if (proj.fwdVec && proj.clip === 'cone') proj.fwdVec(X, Y, Z, out);
  else proj.fwd(Math.atan2(-Z, X), Math.asin(Math.max(-1, Math.min(1, Y))), out);
  return vis;
}

/* Would a point at (lon,lat) be inside the drawn figure, seen from the frame
   centered at (lon0,lat0)? Needed for halo-free label placement: a horizon
   projection draws only x' >= 0, so a label anchored on the hidden hemisphere
   must not be drawn - without this, country labels appeared in open ocean on the
   far side of an orthographic globe (measured: "Australia" floating mid-Pacific). */
function visibleAt(lonDeg, latDeg, lon0, lat0, proj, m0) {
  var m = m0 || rotMat(lon0, lat0, ROTM);
  var phi = latDeg * DEG, lam = lonDeg * DEG;
  var s = Math.sin(phi), c = Math.cos(phi);
  var x = c * Math.cos(lam), y = s, z = -c * Math.sin(lam);
  var X = m[0] * x + m[1] * y + m[2] * z,
      Y = m[3] * x + m[4] * y + m[5] * z,
      Z = m[6] * x + m[7] * y + m[8] * z;
  if (proj.clip === 'cone' && X < (proj.clipCos || 0)) return false;   /* hidden cap */
  var phi2 = Math.asin(Math.max(-1, Math.min(1, Y)));
  var lam2 = Math.atan2(-Z, X);
  var out = [0, 0];
  proj.fwd(lam2, phi2, out);
  if (!isFinite(out[0]) || !isFinite(out[1])) return false;
  var E = proj.extent;
  if (proj.clip !== 'cone') {
    /* outside the frame's box: the lon window is +-180, the lat window +-90, so
       the plane image must sit within the extent */
    if (Math.abs(out[0]) > E[0] * 1.0001 || Math.abs(out[1]) > E[1] * 1.0001) return false;
  }
  return true;
}

/* the LOD ladder over a re-projected piece: piece.pts is a Float64Array with an
   explicit count piece.n and levels are Int32Array with counts in piece.lw.
   flat = the same points at the level chosen by zoom k under maxPx error. */
function pieceFlat(p, k, maxPx) {
  var t = pieceLevelIndex(p, k, maxPx);
  if (t < 0) { p._flatLen = p.n; return p.pts; }   /* no valid level: full detail */
  var idx = p.levels[t], w = p.lw[t];
  if (!idx || w === undefined) { p._flatLen = p.n; return p.pts; }
  if (w === p.n) { p._flatLen = p.n; return p.pts; }
  var out = (p._flat && p._flat.length >= 2 * w) ? p._flat : (p._flat = new Float64Array(2 * w));
  p._flatLen = w;
  for (var a = 0; a < w; a++) {
    var i = idx[a];
    out[a * 2] = p.pts[i * 2]; out[a * 2 + 1] = p.pts[i * 2 + 1];
  }
  return out;
}
/* The ladder level to DRA W this piece at. Rebuilding every level of the ladder
   costs ~12 ms per recentre, so recenterAll rebuilds only the level the frame is
   about to read (p.builtT). If the caller asks for a level that was not built
   (a zoom step whose reprojection has not landed yet), fall back to the built
   one: returning an unbuilt index would read a stale index list and paint
   garbage paths (that is exactly what happened before this guard). */
function pieceLevelIndex(p, k, maxPx) {
  var t = levelForK(k, maxPx);
  /* a level is only usable if it was built for THIS point list; anything else is
     a leftover from an earlier centre and its indices would be meaningless */
  if (p.levels && p.levels[t] && p.lw[t] !== undefined && p.levelN[t] === p.n) return t;
  if (p.builtT !== undefined && p.levels && p.levels[p.builtT] &&
      p.levelN && p.levelN[p.builtT] === p.n) return p.builtT;
  return -1;                        /* nothing valid: the caller draws full detail */
}
/* the ladder level a frame reads at zoom k: the coarsest whose error LOD_U[t]*k
   stays under maxPx screen px. One value per frame, so recenterAll rebuilds
   ONLY that level of the ladder (the other 9 cost ~12 ms of the frame otherwise
   and no caller reads them). */
function levelForK(k, maxPx) {
  for (var t = 0; t < LOD_U.length - 1; t++) if (LOD_U[t] * k <= maxPx) return t;
  return LOD_U.length - 1;
}

/* even-odd point-in-polygon over the re-projected pieces of every feature whose
   bbox holds the point - the recentered twin of hitTestLOD above, so hover/pick
   agrees with what is on screen */
function hitTestPieces(feats, X, Y, k) {
  var hits = [];
  for (var i = 0; i < feats.length; i++) {
    var ft = feats[i], b = ft.bbox;
    if (X < b[0] || X > b[2] || Y < b[1] || Y > b[3]) continue;
    var inside = false;
    for (var r = 0; r < ft.rings.length; r++) {
      var rg = ft.rings[r];
      if (!rg.pieces) continue;
      for (var q = 0; q < rg.pieces.length; q++) {
        var p = rg.pieces[q], rb = p.bbox;
        if (X < rb[0] || X > rb[2] || Y < rb[1] || Y > rb[3]) continue;
        var pts = pieceFlat(p, k, 0.7), n = p._flatLen;
        for (var a = 0, bb = n - 1; a < n; bb = a++) {
          var x1 = pts[a * 2], y1 = pts[a * 2 + 1], x2 = pts[bb * 2], y2 = pts[bb * 2 + 1];
          if (((y1 > Y) !== (y2 > Y)) && (X < (x2 - x1) * (Y - y1) / (y2 - y1) + x1)) inside = !inside;
        }
      }
    }
    if (inside) hits.push(i);
  }
  return hits;
}

/* the map frame in the plane of the projection in play. A pseudocylindrical
   projection's frame is the projection of lon=+-180 and lat=+-90 - and because
   the view center is a rotation applied BEFORE the projection, that outline is
   the same shape whatever the center: the world moves inside a static frame.
   An azimuthal / orthographic projection's frame is the horizon, i.e. a circle
   of the plane half-extent. */
function frameFor(proj, step) {
  if (!proj.pseudocyl) {
    var r = proj.extent[0], pts = [];
    for (var a = 0; a < 360; a += step) pts.push([r * Math.cos(a * DEG), r * Math.sin(a * DEG)]);
    pts.push(pts[0]);
    return pts;
  }
  return frameOutline(step);
}

/* the GEOGRAPHIC graticule re-projected into the frame centered at (lon0,lat0):
   the grid the user expects to move with the centre (the frame's own grid would
   be static and say nothing). Each line is sampled geographically, rotated into
   the frame, unwrapped so its rotated longitude stays continuous, then cut into
   runs that stay inside the frame and projected. For a pseudocylindrical frame
   the frame edge is the rotated antimeridian, so the cut is the lon window; for a
   horizon-clipped one (orthographic) it is the circle x'=0, so the runs are cut
   where the line leaves the visible hemisphere.
   Cost: a few thousand points per frame, ~0.3 ms - no reason to cache it. */
function graticuleRot(lon0, lat0, step, dlon, dlat, proj, k, m0) {
  var m = m0 || rotMat(lon0, lat0, ROTM);
  var lines = [];
  /* Plane units between graticule points: about 4 px at the CURRENT zoom. A grid
     line is a guide, not geometry - 0.7 px (the map's own error budget) is 6x more
     points than needed and cost 54 ms at the fitted world view; 4 px gives 2 ms
     there and stays smooth when zoomed. Clamped so the very deep zoom does not
     explode the point count (measured: 4 px at k=7000 would be 1.6M points). */
  var MAXSTEP = (k && k > 0) ? Math.max(0.004, 4 / k) : 0.02;

  function rot(lonDeg, latDeg, out) {       /* geographic -> lon', lat' (deg) and x' */
    var phi = latDeg * DEG, lam = lonDeg * DEG;
    var s = Math.sin(phi), c = Math.cos(phi);
    var x = c * Math.cos(lam), y = s, z = -c * Math.sin(lam);
    var X = m[0] * x + m[1] * y + m[2] * z,
        Y = m[3] * x + m[4] * y + m[5] * z,
        Z = m[6] * x + m[7] * y + m[8] * z;
    out[0] = Math.atan2(-Z, X) / DEG;
    out[1] = Math.asin(Math.max(-1, Math.min(1, Y))) / DEG;
    out[2] = X;
    return out;
  }
  var ra = [0, 0, 0], rb = [0, 0, 0];

  /* One geographic graticule line -> projected runs inside the frame.
     Three things this has to get right, each of which was a visible bug:
     1. RESAMPLE in geographic lon/lat until the plane step is small. Near the
        rotated pole a parallel moves very fast across the projection's pole
        (which is a LINE in Eckert IV, not a point), so 1 deg of geographic
        longitude is a huge step in the plane and the line came out as a bar
        lying along the pole line. Interpolating lon/lat is exact here: a
        parallel has constant latitude, a meridian constant longitude.
     2. UNWRAP lon' continuously, and BREAK where it flips by ~180 deg in one
        step: that is a line passing over the rotated pole, where lon' is
        undefined. Joining across it drew a straight bar right across the frame.
     3. CLIP PER SEGMENT, in the parameter t, not per point. Testing points and
        cutting where one falls outside made the runs chatter into hundreds of
        two-point fragments along the seam (measured: 1531 runs instead of 153);
        a segment's inside interval is computed exactly, so a run is a maximal
        stretch and neighbours join naturally. */
  function addLine(geo, n) {
    var i, k, t, seg;
    /* ONE pass: sample the geographic line into (lon', lat', x'), inserting the
       intermediate samples a segment needs, and keep the samples. The first
       version rotated every point twice (once to size the chord, once for the
       output), which is what made the grid cost 20-40 ms. Samples go into flat
       scratch arrays that grow and are reused across lines. */
    var need = 0;
    for (i = 0; i < n - 1; i++) {
      rot(geo[i * 2], geo[i * 2 + 1], ra);
      rot(geo[i * 2 + 2], geo[i * 2 + 3], rb);
      proj.fwd(ra[0] * DEG, ra[1] * DEG, TSP);
      var ax = TSP[0], ay = TSP[1];
      proj.fwd(rb[0] * DEG, rb[1] * DEG, TSP);
      need += Math.max(1, Math.ceil(Math.hypot(TSP[0] - ax, TSP[1] - ay) / MAXSTEP));
    }
    need += 1;
    if (GLON.length < need) { GLON = new Float64Array(need * 2); GLAT = new Float64Array(need * 2); GRX = new Float64Array(need * 2); }
    var m2 = 0;
    for (i = 0; i < n - 1; i++) {
      rot(geo[i * 2], geo[i * 2 + 1], ra);
      rot(geo[i * 2 + 2], geo[i * 2 + 3], rb);
      proj.fwd(ra[0] * DEG, ra[1] * DEG, TSP);
      var ax2 = TSP[0], ay2 = TSP[1];
      proj.fwd(rb[0] * DEG, rb[1] * DEG, TSP);
      seg = Math.max(1, Math.ceil(Math.hypot(TSP[0] - ax2, TSP[1] - ay2) / MAXSTEP));
      for (k = 0; k < seg; k++) {
        t = k / seg;
        rot(geo[i * 2] + (geo[i * 2 + 2] - geo[i * 2]) * t,
            geo[i * 2 + 1] + (geo[i * 2 + 3] - geo[i * 2 + 1]) * t, ra);
        GLON[m2] = ra[0]; GLAT[m2] = ra[1]; GRX[m2] = ra[2]; m2++;
      }
    }
    rot(geo[(n - 1) * 2], geo[(n - 1) * 2 + 1], ra);
    GLON[m2] = ra[0]; GLAT[m2] = ra[1]; GRX[m2] = ra[2]; m2++;
    n = m2;
    var g2 = null;

    var rl = new Float64Array(n * 2), rx = new Float64Array(n), brk = new Uint8Array(n);
    var pole = new Uint8Array(n);
    var prev = null, prevRaw = null;
    for (i = 0; i < n; i++) {
      /* the sample was already rotated in the loop above: read it, do not redo it */
      var lo = GLON[i];
      if (prevRaw !== null && Math.abs(lo - prevRaw) > 90) brk[i] = 1;
      prevRaw = lo;
      /* Right at the ROTATED pole, lon' is degenerate (X and Z both go to 0), so
         the unwrap there produces noise - measured: hundreds of two-point
         fragments stacked on the pole line (2061 runs instead of ~40). In this
         projection the pole is a LINE, and the meridians already fan out along
         it, so the grid within a degree of it carries no information: the run
         is ended there instead. */
      if (GLAT[i] > 89 || GLAT[i] < -89) pole[i] = 1;
      if (prev !== null) {
        var d = lo - prev;
        while (d > 180) { lo -= 360; d -= 360; }
        while (d < -180) { lo += 360; d += 360; }
      }
      rl[i * 2] = lo; rl[i * 2 + 1] = GLAT[i]; rx[i] = GRX[i];
      prev = lo;
    }

    /* the inside interval of one segment, as [t0,t1] in [0,1], or null */
    function span(ia, ib) {
      if (proj.clip === 'cone') {
        var lim2 = proj.clipCos || 0;
        var x0 = rx[ia], x1 = rx[ib];
        if (x0 < lim2 && x1 < lim2) return null;
        if (x0 >= lim2 && x1 >= lim2) return [0, 1];
        var t2 = (lim2 - x0) / (x1 - x0);
        return (x0 >= lim2) ? [0, t2] : [t2, 1];
      }
      var l0 = rl[ia * 2], l1 = rl[ib * 2];
      var t0 = 0, t1 = 1;
      /* EPS: a point sitting exactly on the seam comes out as -180.00000000000014
         and, with a hard window, that made the clip cut a zero-length piece and
         start a new run - hundreds of two-point fragments along the seam */
      if (Math.abs(l1 - l0) > 1e-12) {
        var ta = (-180 - l0) / (l1 - l0), tb = (180 - l0) / (l1 - l0);
        var lo2 = Math.min(ta, tb), hi2 = Math.max(ta, tb);
        t0 = Math.max(0, lo2); t1 = Math.min(1, hi2);
      } else if (l0 < -180 - 1e-6 || l0 > 180 + 1e-6) return null;
      /* snap: an interval that only misses its end by float noise must continue
         the run instead of starting a new one, or every seam point becomes a
         2-point fragment (which is what 1000+ runs per line looked like) */
      if (t0 < 1e-6) t0 = 0;
      if (t1 > 1 - 1e-6) t1 = 1;
      if (t1 <= t0) return null;
      return [t0, t1];
    }
    function at(ia, ib, t) {
      var lo = rl[ia * 2] + (rl[ib * 2] - rl[ia * 2]) * t;
      var la = rl[ia * 2 + 1] + (rl[ib * 2 + 1] - rl[ia * 2 + 1]) * t;
      if (proj.clip === 'horizon') {
        /* the circle edge: x' = 0 exactly, found by bisection on the 3D x' */
        var a = 0, b = 1, it, mid;
        var target = (t < 0.5) ? 0 : 1;
        for (it = 0; it < 28; it++) {
          mid = (a + b) / 2;
          var xm = rx[ia] + (rx[ib] - rx[ia]) * mid;
          if ((xm >= 0) === (target === 0)) b = mid; else a = mid;
        }
        t = target === 0 ? b : a;
        lo = rl[ia * 2] + (rl[ib * 2] - rl[ia * 2]) * t;
        la = rl[ia * 2 + 1] + (rl[ib * 2 + 1] - rl[ia * 2 + 1]) * t;
      } else if (proj.clip === 'cone') {
        /* NOT clamped to the lon window: for a horizon projection the frame edge is
           the RIM, and lon' = +-180 is an ordinary meridian pointing away from the
           viewer at plane x = 0. Clamping onto it therefore collapsed every sample
           of a line that ran past the seam into the same two plane points and drew
           the grid as a dashed line falling down the middle of the disc, with the
           rest of that line missing (measured at centre 155.8, 11.5: 10 of 29 runs
           under 40 px, 36 % of the total grid length lost). The unwrap leaves lon'
           in an arbitrary 360-turn, and the projection is 360-periodic in it, so
           bring it back into (-180, 180] by SUBTRACTION and keep the geometry. */
        lo = lo - 360 * Math.round(lo / 360);
      } else {
        lo = Math.max(-180, Math.min(180, lo));
      }
      proj.fwd(lo * DEG, la * DEG, TSP);
      return [TSP[0], TSP[1]];
    }

    var cur = null;
    for (i = 0; i < n - 1; i++) {
      if (brk[i + 1] || pole[i] || pole[i + 1]) { lines.push(cur); cur = null; continue; }
      var s = span(i, i + 1);
      if (!s) { lines.push(cur); cur = null; continue; }
      if (!cur || s[0] > 0) {                 /* starts a new visible run */
        lines.push(cur); cur = [];
        cur.push(at(i, i + 1, s[0]));
      }
      cur.push(at(i, i + 1, s[1]));
      if (s[1] < 1) { lines.push(cur); cur = null; }
    }
    lines.push(cur);
  }

  var geo, lon, lat;
  for (lon = -180; lon <= 180; lon += dlon) {               /* meridians */
    geo = [];
    for (lat = -90; lat <= 90; lat += step) geo.push(lon, lat);
    addLine(geo, geo.length / 2);
  }
  for (lat = -90 + dlat; lat <= 90 - dlat; lat += dlat) {   /* parallels */
    geo = [];
    for (lon = -180; lon <= 180; lon += step) geo.push(lon, lat);
    addLine(geo, geo.length / 2);
  }
  /* drop empty and degenerate runs (a single point cannot be stroked), and JOIN
     runs that end where the next begins: along the seam a line leaves and comes
     back on the same spot, which the per-segment clip reports as two runs (the
     fragment count drops by an order of magnitude this way) */
  var out = [];
  for (var q = 0; q < lines.length; q++) {
    var ln = lines[q];
    if (!ln || ln.length < 2) continue;
    /* a run shorter than one chord is a clipping artifact, not a grid line */
    var len = 0;
    for (var z = 1; z < ln.length; z++) len += Math.hypot(ln[z][0] - ln[z - 1][0], ln[z][1] - ln[z - 1][1]);
    if (len < MAXSTEP) continue;
    var last = out[out.length - 1];
    if (last) {
      var e = last[last.length - 1], b = ln[0];
      if (Math.abs(e[0] - b[0]) < 1e-9 && Math.abs(e[1] - b[1]) < 1e-9) {
        for (var w = 1; w < ln.length; w++) last.push(ln[w]);
        continue;
      }
    }
    out.push(ln);
  }
  return out;
}

var CORE = {
  project: project, unproject: unproject, thetaFor: thetaFor, thetaSinCos: thetaSinCos,
  PROJ: PROJ,
  /* CUR is exposed as a GETTER: `CUR: CUR` copied the value once at load, so
     C.CUR kept pointing at Eckert IV after setProjection() had switched the
     internal variable - which is why ?proj=ortho drew Eckert IV (the HUD label,
     frameFor(C.CUR), graticuleRot and hitTest all read C.CUR). */
  get CUR() { return CUR; },
  setProjection: function (id) { if (PROJ[id]) CUR = PROJ[id]; return CUR; },
  rotMat: rotMat, rotMatInv: rotMatInv, rotFrom: rotFrom, moveCentre: moveCentre, rotInv: rotInv,
  unrot: unrot, unrotM: unrotM, frameCentre: frameCentre, rotRoll: rotRoll, ROTM: ROTM,
  rebuildRing: rebuildRing, recenterAll: recenterAll, pieceFlat: pieceFlat,
  levelForK: levelForK, prepareXYZ: prepareXYZ, visibleAt: visibleAt,
  clipLonF: clipLonF, CLIPB: CLIPB, CLIPA: CLIPA,
  pieceLevelIndex: pieceLevelIndex, hitTestPieces: hitTestPieces,
  projectRotLL: projectRotLL, projectRotLLVis: projectRotLLVis,
  frameFor: frameFor, graticuleRot: graticuleRot,
  buildFeatures: buildFeatures, hitTest: hitTest,
  buildFeaturesLOD: buildFeaturesLOD, hitTestLOD: hitTestLOD,
  ringFlat: ringFlat, levelIndex: levelIndex, LOD_U: LOD_U, ensureLevel: ensureLevel,
  ringAtLevel: ringAtLevel, ringLLAtLevel: ringLLAtLevel,
  triangulateRing: triangulateRing, refineTri: refineTri, ringTris: ringTris, densifyLonLat: densifyLonLat,
  sewGlobeLadder: sewGlobeLadder, ringGlobeLLAtLevel: ringGlobeLLAtLevel, ringGlobeTris: ringGlobeTris,
  ringAreaProjected: ringAreaProjected, SR_TO_KM2: SR_TO_KM2,
  frameOutline: frameOutline, graticule: graticule,
  K: K, S: S, TGT: TGT, DEG: DEG
};

if (typeof window !== 'undefined') window.AppCore = CORE;

"""ne_10m_admin_0_map_units shapefile -> data/ne10m.geojson

Same pipeline and conventions as shp2geojson.py / shp2geojson50.py:
  * MultiPolygon lon/lat, one ring list per polygon, holes after the outer ring
  * AREA_KM2 measured as PLANAR AREA IN PROJECTED SPACE (Eckert IV is equal-area,
    so steradians x R^2 is the true area), with edges densified first because a
    geographic straight line is not straight in Eckert IV
  * the label attributes the app reads (MIN_LABEL / MAX_LABEL / LABELRANK /
    LABEL_X / LABEL_Y) plus the panel fields
Differences for the 10m layer:
  * coordinates are rounded to 4 decimals (~11 m) instead of 6: 552k points at 6
    decimals is ~20 MB of JSON, at 4 it is ~11 MB and no pixel of this viewer can
    tell the difference (the deepest zoom is 1200x the fitted world view, where
    11 m is well under a pixel)
  * DENSIFY_STEP is 0.05 deg instead of 0.1: the source is already far denser than
    that, so this only affects the few long straight edges (Antarctica's pole edge,
    some disputed straight-line borders) while keeping the area honest
"""
import shapefile, json, math, sys
from collections import OrderedDict

S = math.sqrt(math.pi * (4 + math.pi))
K = 2 * math.sqrt(math.pi / (4 + math.pi))


def fwd(lon, lat):
    lam = math.radians(lon)
    phi = math.radians(lat)
    th = phi / 2.0
    tgt = (2 + math.pi / 2) * math.sin(phi)
    for _ in range(40):
        f = th + math.sin(th) * math.cos(th) + 2 * math.sin(th) - tgt
        d = -f / (2 * math.cos(th) * (1 + math.cos(th)))
        th += d
        if abs(d) < 1e-15:
            break
    return (2 * lam * (1 + math.cos(th)) / S, K * math.sin(th))


def dens(ring, step):
    out = []
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        n = max(1, int(math.ceil(max(abs(x2 - x1), abs(y2 - y1)) / step - 1e-9)))
        for k in range(n):
            out.append((x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n))
    out.append(ring[-1])
    return out


def planar(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += (x1 * y2 - x2 * y1) / 2
    return abs(a)


R2 = 6371008.8 ** 2 / 1e6
DENSIFY_STEP = 0.05
SRC = sys.argv[1] if len(sys.argv) > 1 else "ne_10m_admin_0_map_units.shp"

r = shapefile.Reader(SRC)
names = [f[0] for f in r.fields[1:]]
recs = [dict(zip(names, row)) for row in r.records()]
shapes = r.shapes()

KEEP = ["NAME", "NAME_LONG", "SOVEREIGNT", "TYPE", "CONTINENT", "SUBREGION", "REGION_UN",
        "ADMIN", "GEOUNIT", "SUBUNIT", "MAPUNIT", "ABBREV", "FORMAL_EN",
        "POP_EST", "POP_YEAR", "GDP_MD", "GDP_YEAR", "ECONOMY", "INCOME_GRP",
        "ISO_A2", "ISO_A3", "ISO_N3", "NE_ID", "scalerank", "LABELRANK", "LEVEL",
        "MIN_LABEL", "MAX_LABEL", "LABEL_X", "LABEL_Y", "TINY", "HOMEPART",
        # every language the VIEWER's selector offers (see app.js LANGS). It used to
        # be six; the map has a language selector now, and a language it cannot
        # answer in is a language that silently leaves the country names in English.
        "NAME_EN", "NAME_FR", "NAME_DE", "NAME_ES", "NAME_PT", "NAME_NL", "NAME_SV",
        "NAME_RU", "NAME_UK", "NAME_EL", "NAME_ZH", "NAME_JA", "NAME_KO", "NAME_AR",
        "NAME_FA", "NAME_HE", "NAME_HI", "NAME_BN", "NAME_IT", "NAME_PL", "NAME_TR"]
KEEP = [k for k in KEEP if k in names]

feats = []
for rec, sh in zip(recs, shapes):
    rings = []
    for i, p in enumerate(sh.parts):
        e = sh.parts[i + 1] if i + 1 < len(sh.parts) else len(sh.points)
        rg = [(round(x, 4), round(y, 4)) for x, y in sh.points[p:e]]
        if len(rg) > 3:
            rings.append(rg)
    if not rings:
        continue
    area = 0.0
    for rg in rings:
        closed = list(rg) + [rg[0]]
        area += planar([fwd(*pt) for pt in dens(closed, DENSIFY_STEP)])
    props = OrderedDict((k, rec[k]) for k in KEEP)
    props["AREA_KM2"] = int(round(area * R2))
    props["PARTS"] = len(rings)
    props["VERTS"] = sum(len(rg) for rg in rings)
    feats.append({"type": "Feature", "properties": props,
                  "geometry": {"type": "MultiPolygon",
                               "coordinates": [[rg] for rg in rings]}})

import sys
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/ne10m.geojson"
with open(OUT, "w") as fh:
    json.dump({"type": "FeatureCollection", "features": feats}, fh,
              ensure_ascii=False, separators=(",", ":"))

tot = sum(f["properties"]["AREA_KM2"] for f in feats)
verts = sum(f["properties"]["VERTS"] for f in feats)
print("features:", len(feats), " raw vertices:", f"{verts:,}",
      " total land km^2:", f"{tot:,.0f}")
truth = {"Russia": 17098242, "Canada": 9984670, "France": 643801, "Brazil": 8515770,
         "Greenland": 2166086, "Australia": 7741662, "Antarctica": 14200000,
         "Luxembourg": 2586, "Fiji": 18443, "Italy": 301230, "Norway": 382900}
for f in feats:
    n = f["properties"]["NAME"]
    if n in truth:
        a = f["properties"]["AREA_KM2"]
        print(f"  {n}: {a:,} km^2  real {truth[n]:,}  ratio {a/truth[n]:.3f}"
              f"  verts {f['properties']['VERTS']}")

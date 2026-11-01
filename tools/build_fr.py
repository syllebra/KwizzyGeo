#!/usr/bin/env python3
"""Build the France quiz's data files (data/fr/*).

SOURCES, and why each one:
  * departments / regions geometry - france-geojson (github: gregoiredavid), which is
    IGN's ADMIN-EXPRESS re-cut as GeoJSON, Licence Ouverte / Etalab 2.0. 101
    departments (96 metropolitan + 5 overseas) and 18 regions, with the 2021 codes.
  * names, region membership, population, commune centres - geo.api.gouv.fr, the
    state's own API over the Base Adresse Nationale / INSEE commune table.
  * water - IGN's WFS (data.geopf.fr), BDCARTO_V5:plan_d_eau for the lakes and
    BDCARTO_V5:cours_d_eau for the rivers. Licence Ouverte. BDCARTO has 144 000
    river courses in France: asking about all of them would paint a grey wash, so the
    build keeps a SHORT, NAMED list of the rivers a map uses to orient itself (the
    whitelist below) - which is what the game needs.

WHY THE NUMBERS ARE WHAT THEY ARE
  * the geometries are Douglas-Peucker'd to ~450 m (departments), ~650 m (regions),
    ~200 m (lakes) and ~1 km (rivers): at the zoom the France quiz plays at, 450 m is
    a fifth of a pixel, and the whole overlay stays around 1 MB of GeoJSON.
  * every department carries its CHEF-LIEU (the préfecture) and that town's
    coordinates, because "find the préfecture" is one of the five France modes and
    the distance rule of the difficulty bands runs on those points.
  * the cities file keeps every commune of 5 000 inhabitants or more (2 280 of them),
    plus every préfecture however small, because the France locate mode asks about
    cities and its hard band has to be able to reach "a smaller town".

Run: python3 tools/build_fr.py        (needs network; writes data/fr/)
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'fr')
CACHE = os.path.join(HERE, '..', '.fr-cache')

GH = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/'
API = 'https://geo.api.gouv.fr/'
WFS = 'https://data.geopf.fr/wfs/ows'

# THE PRÉFECTURE OF EVERY DEPARTMENT. This is the one list that is written by hand
# (the state's API publishes codes, names and populations, not chefs-lieux); the
# coordinates are then looked up in the commune table, and the build FAILS if any of
# these names does not resolve, so a typo cannot reach the game.
PREF = {
    '01': 'Bourg-en-Bresse', '02': 'Laon', '03': 'Moulins',
    '04': 'Digne-les-Bains', '05': 'Gap', '06': 'Nice', '07': 'Privas',
    '08': 'Charleville-Mézières', '09': 'Foix', '10': 'Troyes',
    '11': 'Carcassonne', '12': 'Rodez', '13': 'Marseille', '14': 'Caen',
    '15': 'Aurillac', '16': 'Angoulême', '17': 'La Rochelle', '18': 'Bourges',
    '19': 'Tulle', '2A': 'Ajaccio', '2B': 'Bastia', '21': 'Dijon',
    '22': 'Saint-Brieuc', '23': 'Guéret', '24': 'Périgueux', '25': 'Besançon',
    '26': 'Valence', '27': 'Évreux', '28': 'Chartres', '29': 'Quimper',
    '30': 'Nîmes', '31': 'Toulouse', '32': 'Auch', '33': 'Bordeaux',
    '34': 'Montpellier', '35': 'Rennes', '36': 'Châteauroux', '37': 'Tours',
    '38': 'Grenoble', '39': 'Lons-le-Saunier', '40': 'Mont-de-Marsan',
    '41': 'Blois', '42': 'Saint-Étienne', '43': 'Le Puy-en-Velay',
    '44': 'Nantes', '45': 'Orléans', '46': 'Cahors', '47': 'Agen',
    '48': 'Mende', '49': 'Angers', '50': 'Saint-Lô', '51': 'Châlons-en-Champagne',
    '52': 'Chaumont', '53': 'Laval', '54': 'Nancy', '55': 'Bar-le-Duc',
    '56': 'Vannes', '57': 'Metz', '58': 'Nevers', '59': 'Lille',
    '60': 'Beauvais', '61': 'Alençon', '62': 'Arras', '63': 'Clermont-Ferrand',
    '64': 'Pau', '65': 'Tarbes', '66': 'Perpignan', '67': 'Strasbourg',
    '68': 'Colmar', '69': 'Lyon', '70': 'Vesoul', '71': 'Mâcon',
    '72': 'Le Mans', '73': 'Chambéry', '74': 'Annecy', '75': 'Paris',
    '76': 'Rouen', '77': 'Melun', '78': 'Versailles', '79': 'Niort',
    '80': 'Amiens', '81': 'Albi', '82': 'Montauban', '83': 'Toulon',
    '84': 'Avignon', '85': 'La Roche-sur-Yon', '86': 'Poitiers',
    '87': 'Limoges', '88': 'Épinal', '89': 'Auxerre', '90': 'Belfort',
    '91': 'Évry-Courcouronnes', '92': 'Nanterre', '93': 'Bobigny',
    '94': 'Créteil', '95': 'Cergy',
    '971': 'Basse-Terre', '972': 'Fort-de-France', '973': 'Cayenne',
    '974': 'Saint-Denis', '976': 'Mamoudzou'
}

# THE RIVERS that are kept, by the name BDCARTO files them under. A map is oriented
# by its great rivers and by the ones that name a region; 144 000 courses is a wash.
RIVERS = [
    'Seine', 'Loire', 'Rhône', 'Garonne', 'Dordogne', 'Rhin', 'Meuse', 'Moselle',
    'Saône', 'Doubs', 'Marne', 'Oise', 'Aisne', 'Yonne', 'Aube', 'Cher', 'Allier',
    'Creuse', 'Vienne', 'Charente', 'Lot', 'Tarn', 'Aveyron', 'Aude', 'Hérault',
    'Gard', 'Ardèche', 'Isère', 'Durance', 'Var', 'Adour', 'Vilaine', 'Rance',
    'Somme', 'Escaut', 'Sarthe', 'Mayenne', 'Orne', 'Eure', 'Ariège', 'Gers',
    'Ain', 'Ognon', 'Ill', 'Blavet', 'Aulne', 'Têt', 'Tech', 'Hérault',
    'Sèvre Niortaise', 'Loir', 'Baïse', 'Cère', 'Vézère', 'Corrèze', 'Dropt',
    'Sélune', 'Trieux', 'Orb', 'Agly'
]

METRO_BBOX = (-5.6, 41.0, 9.9, 51.6)          # west, south, east, north
LAKE_MIN_KM2 = 0.8                           # lakes smaller than this are ponds
DP_DEP, DP_REG, DP_LAKE, DP_RIVER = 0.0045, 0.0065, 0.004, 0.008


def log(*a):
    print(*a)
    sys.stdout.flush()


def cached(name, url, data=None, binary=False):
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)
    p = os.path.join(CACHE, name)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        with open(p, 'rb') as f:
            raw = f.read()
        return raw if binary else json.loads(raw.decode('utf-8'))
    req = urllib.request.Request(url, data=data,
                                 headers={'User-Agent': 'KwizzyGeo data build'})
    log('  GET', url[:110])
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    with open(p, 'wb') as f:
        f.write(raw)
    return raw if binary else json.loads(raw.decode('utf-8'))


# ---------- geometry helpers ----------
def rings_of(geom):
    """(outer ring, [rings of this polygon]) for Polygon/MultiPolygon, holes kept."""
    t = geom['type']
    if t == 'Polygon':
        return [geom['coordinates']]
    if t == 'MultiPolygon':
        return list(geom['coordinates'])
    return []


def lines_of(geom):
    t = geom['type']
    if t == 'LineString':
        return [geom['coordinates']]
    if t == 'MultiLineString':
        return list(geom['coordinates'])
    return []


def dp(pts, tol):
    """Douglas-Peucker on a 2-D point list (closed rings handled by the caller)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def collapse(ring):
    """A ring that Douglas-Peucker flattened: a triangle of its own extremes, so a
    sliver stays a sliver instead of becoming the whole unsimplified ring."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    lo = ring[xs.index(min(xs))]
    hi = ring[xs.index(max(xs))]
    mid = ring[ys.index(min(ys))]
    return [lo, hi, mid, lo]


def simplify_geom(geom, tol):
    """Simplify, and NORMALISE THE TYPE: core.js's buildFeaturesLOD walks
    coordinates as [polygon][ring][point], i.e. it expects a MultiPolygon (which is
    how the Natural Earth files it was written for are shaped). A Polygon would be
    read as a ring of POINTS and silently produce no geometry at all - Paris
    vanished from the first build for exactly this reason."""
    if geom['type'] == 'Polygon':
        out = []
        for ri, ring in enumerate(geom['coordinates']):
            s = dp(ring, tol)
            if len(s) < 4:
                if ri == 0:
                    s = collapse(ring)
                else:
                    continue
            out.append(s)
        return {'type': 'MultiPolygon', 'coordinates': [out or [collapse(geom['coordinates'][0])]]}
    if geom['type'] == 'MultiPolygon':
        out = []
        for poly in geom['coordinates']:
            keep = []
            for ri, ring in enumerate(poly):
                s = dp(ring, tol)
                if len(s) < 4:
                    if ri == 0:
                        s = collapse(ring)
                    else:
                        continue
                keep.append(s)
            if keep:
                out.append(keep)
        return {'type': 'MultiPolygon',
                'coordinates': out or [[collapse(geom['coordinates'][0][0])]]}
    if geom['type'] == 'LineString':
        return {'type': 'MultiLineString', 'coordinates': [dp(geom['coordinates'], tol)]}
    if geom['type'] == 'MultiLineString':
        return {'type': 'MultiLineString',
                'coordinates': [dp(l, tol) for l in geom['coordinates'] if len(l) > 1]}
    return geom


def bbox_of(geom):
    xs, ys = [], []

    def walk(c):
        if not c:
            return
        if isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for x in c:
                walk(x)
    walk(geom['coordinates'])
    return min(xs), min(ys), max(xs), max(ys)


def count_pts(geom):
    n = 0

    def walk(c):
        nonlocal n
        if not c:
            return
        if isinstance(c[0], (int, float)):
            n += 1
        else:
            for x in c:
                walk(x)
    walk(geom['coordinates'])
    return n


def ring_area_km2(ring):
    """Spherical area of one ring, km^2 (positive for either winding)."""
    R = 6371.0088
    a = 0.0
    n = len(ring)
    for i in range(n):
        lon1, lat1 = ring[i][0], math.radians(ring[i][1])
        lon2, lat2 = ring[(i + 1) % n][0], math.radians(ring[(i + 1) % n][1])
        a += math.radians(lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(a) * R * R / 2.0


def geom_area_km2(geom):
    tot = 0.0
    for poly in rings_of(geom):
        for i, ring in enumerate(poly):
            a = ring_area_km2(ring)
            tot += -a if i else a
    return tot


def ring_centroid(ring):
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    if abs(a) < 1e-15:
        return ring[0][0], ring[0][1]
    return cx / (3 * a), cy / (3 * a)


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def point_in_geom(x, y, geom):
    for poly in rings_of(geom):
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


def label_point(geom):
    """A point INSIDE the shape, near its middle: the centroid of the biggest polygon
    when it falls inside, else the interior grid point farthest from the edge. A label
    is drawn here, so a point in the sea would put the name off its département."""
    polys = rings_of(geom)
    polys.sort(key=lambda p: ring_area_km2(p[0]), reverse=True)
    cx, cy = ring_centroid(polys[0][0])
    if point_in_geom(cx, cy, geom):
        return cx, cy
    x0, y0, x1, y1 = bbox_of(geom)
    best, bp = -1.0, (cx, cy)
    for i in range(1, 24):
        for j in range(1, 24):
            x = x0 + (x1 - x0) * i / 24.0
            y = y0 + (y1 - y0) * j / 24.0
            if not point_in_geom(x, y, geom):
                continue
            d = math.hypot(x - cx, y - cy)
            if best < 0 or d < best:
                best, bp = d, (x, y)
    return bp


def norm_name(s):
    return (s or '').strip().lower().replace('’', "'")


# ---------- the build ----------
def main():
    log('KwizzyGeo — building data/fr')
    if not os.path.isdir(OUT):
        os.makedirs(OUT)

    dep_raw = cached('departements.geojson', GH + 'departements-avec-outre-mer.geojson')
    reg_raw = cached('regions.geojson', GH + 'regions-avec-outre-mer.geojson')
    api_deps = cached('api_deps.json', API + 'departements?fields=nom,code,codeRegion,region&format=json')
    api_com = cached('api_communes.json',
                     API + 'communes?fields=nom,code,codeDepartement,codeRegion,population,centre&format=json')
    log('  %d departments, %d regions, %d communes' %
        (len(dep_raw['features']), len(reg_raw['features']), len(api_com)))

    reg_name = {}
    for r in reg_raw['features']:
        reg_name[r['properties']['code']] = r['properties']['nom']
    dep_reg = {}
    reg_of = {}
    for d in api_deps:
        dep_reg[d['code']] = d['codeRegion']
        reg_of[d['code']] = d.get('region', {}).get('nom', reg_name.get(d['codeRegion'], ''))

    # population per department and per region: summed over the communes, so the two
    # tables can never disagree with the third
    dep_pop, reg_pop = {}, {}
    for c in api_com:
        p = c.get('population') or 0
        dc = c.get('codeDepartement')
        if dc:
            dep_pop[dc] = dep_pop.get(dc, 0) + p
        rc = c.get('codeRegion')
        if rc:
            reg_pop[rc] = reg_pop.get(rc, 0) + p

    # ---------- the préfectures, resolved to coordinates ----------
    by_dept = {}
    for c in api_com:
        by_dept.setdefault(c.get('codeDepartement'), []).append(c)
    pref_out = {}
    missing = []
    for code, name in PREF.items():
        cands = [c for c in by_dept.get(code, [])
                 if norm_name(c['nom']) == norm_name(name)]
        if not cands:
            # "Le Puy-en-Velay" and friends are stored under their full name; a
            # name that still does not resolve is a typo and must stop the build
            missing.append('%s %s (%s)' % (code, name, dep_reg.get(code)))
            continue
        c = cands[0]
        pref_out[code] = (name, c['centre']['coordinates'][0], c['centre']['coordinates'][1],
                          c.get('population') or 0)
    if missing:
        raise SystemExit('préfecture names that do not resolve: ' + ', '.join(missing))

    # ---------- departments ----------
    deps = []
    for f in dep_raw['features']:
        code = f['properties']['code']
        geom = simplify_geom(f['geometry'], DP_DEP)
        pname, plon, plat, ppop = pref_out[code]
        lx, ly = label_point(geom)
        area = geom_area_km2(geom)
        deps.append({
            'type': 'Feature',
            'properties': {
                'code': code,
                'nom': f['properties']['nom'],
                'reg': dep_reg.get(code, ''),
                'reg_nom': reg_of.get(code, ''),
                'pref': pname,
                'pref_lon': round(plon, 4),
                'pref_lat': round(plat, 4),
                'pref_pop': ppop,
                'pop': dep_pop.get(code, 0),
                'area_km2': round(area),
                # DOM: the five overseas departments are the three-digit codes 
                'dom': 1 if len(code) == 3 else 0,
                'LABEL_X': round(lx, 4),
                'LABEL_Y': round(ly, 4)
            },
            'geometry': geom
        })
    deps.sort(key=lambda d: (d['properties']['dom'], d['properties']['code']))
    write(os.path.join(OUT, 'departements.geojson'), {'type': 'FeatureCollection', 'features': deps})
    log('  departements.geojson: %d features, %d points' %
        (len(deps), sum(count_pts(d['geometry']) for d in deps)))

    # ---------- regions ----------
    regs = []
    for f in reg_raw['features']:
        code = f['properties']['code']
        geom = simplify_geom(f['geometry'], DP_REG)
        lx, ly = label_point(geom)
        n = sum(1 for d in deps if d['properties']['reg'] == code)
        regs.append({
            'type': 'Feature',
            'properties': {
                'code': code,
                'nom': f['properties']['nom'],
                'pop': reg_pop.get(code, 0),
                'ndep': n,
                # the five overseas REGIONS carry the codes 01 02 03 04 06, which are
                # also metropolitan DEPARTMENT codes: the list decides, not the number
                'dom': 1 if code in ('01', '02', '03', '04', '06') else 0,
                'LABEL_X': round(lx, 4),
                'LABEL_Y': round(ly, 4)
            },
            'geometry': geom
        })
    regs.sort(key=lambda d: (d['properties']['dom'], d['properties']['code']))
    write(os.path.join(OUT, 'regions.geojson'), {'type': 'FeatureCollection', 'features': regs})
    log('  regions.geojson: %d features, %d points' %
        (len(regs), sum(count_pts(d['geometry']) for d in regs)))

    # ---------- the cities ----------
    prefset = set((norm_name(v[0]), k) for k, v in pref_out.items())
    cities = []
    for c in api_com:
        pop = c.get('population') or 0
        code = c.get('codeDepartement')
        is_pref = (norm_name(c['nom']), code) in prefset
        if pop < 5000 and not is_pref:
            continue
        ce = c.get('centre')
        if not ce:
            continue
        lon, lat = ce['coordinates'][0], ce['coordinates'][1]
        cities.append({
            'id': 'v' + c['code'],
            'name': c['nom'],
            'dept': code or '',
            'reg': c.get('codeRegion') or '',
            'lat': round(lat, 4),
            'lon': round(lon, 4),
            'pop': pop,
            'pref': 1 if is_pref else 0
        })
    cities.sort(key=lambda c: (-c['pop'], c['name']))
    write(os.path.join(OUT, 'villes.json'), {'v': 1, 'n': len(cities), 'list': cities})
    bands = {
        'easy': sum(1 for c in cities if c['pop'] >= 100000),
        'medium': sum(1 for c in cities if c['pop'] >= 30000),
        'hard': sum(1 for c in cities if c['pop'] >= 10000)
    }
    log('  villes.json: %d cities (>=100k %d, >=30k %d, >=10k %d)' %
        (len(cities), bands['easy'], bands['medium'], bands['hard']))

    # ---------- the water ----------
    lakes = fetch_lakes()
    rivers = fetch_rivers()
    feats = []
    for name, geom in lakes:
        feats.append({'type': 'Feature', 'properties': {'kind': 'lake', 'name': name},
                      'geometry': geom})
    for name, geom in rivers:
        feats.append({'type': 'Feature', 'properties': {'kind': 'river', 'name': name},
                      'geometry': geom})
    write(os.path.join(OUT, 'eau.geojson'), {'type': 'FeatureCollection', 'features': feats})
    log('  eau.geojson: %d lakes, %d river courses, %d points' %
        (len(lakes), sum(1 for f in feats if f['properties']['kind'] == 'river'),
         sum(count_pts(f['geometry']) for f in feats)))


def write(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    log('  wrote %s (%.1f kB)' % (os.path.relpath(path, HERE), os.path.getsize(path) / 1024.0))


def wfs_json(typename, extra, count=4000):
    q = [('service', 'WFS'), ('version', '2.0.0'), ('request', 'GetFeature'),
         ('typeNames', typename), ('outputFormat', 'application/json'),
         ('srsName', 'EPSG:4326')]
    q += extra
    url = WFS + '?' + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={'User-Agent': 'KwizzyGeo data build'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode('utf-8'))


def metro_clip(geom):
    """true when the shape is inside (or overlaps) the metropolitan bounding box"""
    b = bbox_of(geom)
    return not (b[2] < METRO_BBOX[0] or b[0] > METRO_BBOX[2] or
                b[3] < METRO_BBOX[1] or b[1] > METRO_BBOX[3])


def fetch_lakes():
    """Every plan d'eau of metropolitan France, kept above LAKE_MIN_KM2."""
    key = 'lacs.json'
    p = os.path.join(CACHE, key)
    if not os.path.exists(p):
        log('  GET plan_d_eau (paged)')
        feats, start = [], 0
        while True:
            js = wfs_json('BDCARTO_V5:plan_d_eau',
                          [('bbox', '%s,%s,%s,%s,EPSG:4326' % METRO_BBOX),
                           ('count', '5000'), ('startIndex', str(start))])
            got = js.get('features') or []
            feats += got
            start += len(got)
            log('    %d / %s' % (start, js.get('totalFeatures')))
            if not got or start >= (js.get('totalFeatures') or 0):
                break
        with open(p, 'w', encoding='utf-8') as f:
            json.dump({'features': feats}, f)
        js = {'features': feats}
    else:
        js = json.load(open(p, encoding='utf-8'))
    out = []
    for f in js['features']:
        g = f.get('geometry')
        if not g or g['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        if geom_area_km2(g) < LAKE_MIN_KM2:
            continue
        name = (f['properties'].get('toponyme') or '').strip()
        # A MARSH HAS A FRACTAL EDGE: the Vendée's marais are 0.05 deg across and
        # 7 000 vertices wide, i.e. most of the file for a shape that is one flat
        # patch on screen. The tolerance grows per lake until it is a polygon again
        # (250 points is far more than a lake needs at any zoom the quiz plays at).
        tol = DP_LAKE
        s = simplify_geom(g, tol)
        while count_pts(s) > 250 and tol < 0.05:
            tol *= 1.7
            s = simplify_geom(g, tol)
        out.append((name, s))
    out.sort(key=lambda t: t[0])
    log('  %d lakes kept (>= %.2f km2)' % (len(out), LAKE_MIN_KM2))
    return out


def fetch_rivers():
    """The named rivers of RIVERS, one request each, articles stripped of variants."""
    p = os.path.join(CACHE, 'rivieres.json')
    if os.path.exists(p):
        js = json.load(open(p, encoding='utf-8'))
    else:
        js = {'features': []}
        for i in range(0, len(RIVERS), 6):
            batch = RIVERS[i:i + 6]
            cql = ' OR '.join("toponyme LIKE '%%%s%%'" % n.replace("'", "''") for n in batch)
            log('  GET cours_d_eau %s' % ', '.join(batch))
            got = wfs_json('BDCARTO_V5:cours_d_eau',
                           [('CQL_FILTER', cql), ('count', '2000')])
            js['features'] += got.get('features') or []
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(js, f)
    want = {}
    for n in RIVERS:
        want[norm_name(n)] = n
    out = {}
    for f in js['features']:
        g = f.get('geometry')
        if not g or g['type'] not in ('LineString', 'MultiLineString'):
            continue
        raw = (f['properties'].get('toponyme') or '').strip()
        base = norm_name(raw)
        for article in ("l'", 'la ', 'le ', 'les ', "l’"):
            if base.startswith(article):
                base = base[len(article):]
                break
        base = base.replace('’', "'")
        if base not in want:
            continue
        if not metro_clip(g):
            continue
        name = want[base]
        s = simplify_geom(g, DP_RIVER)
        ln = sum(len(l) for l in lines_of(s))
        if ln < 8:
            continue
        # the same river is cut into many courses: keep them side by side, they are
        # drawn as one line on screen anyway
        out.setdefault(name, []).append(s)
    res = []
    for name in sorted(out):
        parts = out[name]
        if len(parts) == 1:
            res.append((name, parts[0]))
        else:
            res.append((name, {'type': 'MultiLineString',
                               'coordinates': [l for p2 in parts for l in lines_of(p2)]}))
    log('  %d of the %d wanted rivers found' % (len(res), len(RIVERS)))
    missing = [n for n in RIVERS if n not in out]
    if missing:
        log('  not in BDCARTO under that name: %s' % ', '.join(missing))
    return res


if __name__ == '__main__':
    main()

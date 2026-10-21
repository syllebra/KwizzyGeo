"""ne_10m_populated_places shapefile -> data/places.json

The city layer of the viewer: 7 342 Natural Earth populated places (v5.1.2,
10m cultural), as GeoJSON Points.

WHY THE PROPERTIES ARE ABBREVIATED
Full Natural Earth properties are 137 fields per place; the viewer reads six of
them. Shipped slim, the layer is ~700 kB; shipped whole it would be 8 MB of JSON
to parse before the cities can be drawn. The keys are documented in the file's
own `"about"` member so the data stays self-describing.

WHAT THE VIEWER USES
  z  MIN_ZOOM   the zoom at which Natural Earth intends the place to appear
                (1.7 ... 9.0) - the city layer's LOD, used verbatim
  l  LABELRANK  label priority, 0 (Paris, Tokyo) ... 8
  p  POP_MAX    population, -99 when unknown
  f  FEATURECLA abbreviated: A0 admin-0 capital, A0R admin-0 region capital,
                A1 admin-1 capital, A1R admin-1 region capital, P populated
                place, S scientific station, H historic place, M met. station
  n / c / r / tz  name, country (ADM0NAME), region (ADM1NAME), timezone

Coordinates are rounded to 4 decimals (~11 m). At the deepest zoom the view is
1 px = 11.8 m, so 4 decimals is sub-pixel; 5 would double the file for nothing.

WHY NOT GEOJSON
A GeoJSON Feature with a point geometry costs ~110 bytes of boilerplate ("type",
"geometry", "coordinates", "properties" ...) before a single value, so 7 342 points
come out at 1.35 MB. The same data as one array per place, with the field names
declared once, is 0.59 MB and parses in a third of the time. This layer is a point
table, not geometry, so the boilerplate buys nothing: the file is a JSON object
with `fields` and `places` (one array each, in that field order).

    python3 tools/shp2geojson_places.py ne_10m_populated_places.shp data/places.json
"""
import json
import sys

import shapefile

FCLASS = {
    'Admin-0 capital': 'A0',
    'Admin-0 region capital': 'A0R',
    'Admin-0 capital alt': 'A0R',
    'Admin-1 capital': 'A1',
    'Admin-1 region capital': 'A1R',
    'Populated place': 'P',
    'Populated Place': 'P',
    'Scientific station': 'S',
    'Meteorological Station': 'M',
    'Historic place': 'H',
}


def main(src, dst):
    r = shapefile.Reader(src)
    rows = []
    skipped = 0
    for sr in r.iterShapeRecords():
        d = sr.record.as_dict()
        g = sr.shape
        if not g.points:
            skipped += 1
            continue
        lon, lat = g.points[0]
        # prefer the attribute column when present: the shapefile's point and the
        # LATITUDE/LONGITUDE columns agree in this release, and the columns are the
        # ones Natural Earth documents as authoritative
        if d.get('LONGITUDE') is not None and d.get('LATITUDE') is not None:
            lon, lat = d['LONGITUDE'], d['LATITUDE']
        name = d.get('NAME') or d.get('NAMEASCII') or ''
        props = {
            'n': name,
            'c': d.get('ADM0NAME') or '',
            'r': d.get('ADM1NAME') or '',
            'p': int(d.get('POP_MAX') or -99),
            'z': float(d.get('MIN_ZOOM') if d.get('MIN_ZOOM') is not None else 9.0),
            'l': int(d.get('LABELRANK') if d.get('LABELRANK') is not None else 8),
            'f': FCLASS.get(d.get('FEATURECLA') or '', 'P'),
        }
        if d.get('TIMEZONE'):
            props['tz'] = d['TIMEZONE']
        rows.append([props['n'], props['c'], props['r'], props['p'], props['z'],
                     props['l'], props['f'], props.get('tz', ''),
                     round(lon, 4), round(lat, 4)])
    # Natural Earth's own order is kept (it is roughly by importance); the viewer
    # sorts by its own rules at draw time
    out = {
        'type': 'places',
        'v': 1,
        'about': ('Natural Earth 10m populated places v5.1.2, slimmed for the viewer. '
                  'n=name c=country r=region p=pop_max z=min_zoom l=labelrank '
                  'f=feature class (A0 capital, A1 admin-1 capital, A0R/A1R region '
                  'capitals, P populated place, S scientific station, M met. station, '
                  'H historic) tz=timezone lon lat. Coordinates to 4 decimals (~11 m).'),
        'fields': ['n', 'c', 'r', 'p', 'z', 'l', 'f', 'tz', 'lon', 'lat'],
        'places': rows,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    print('%s: %d places (%d skipped, no point)' % (dst, len(rows), skipped))
    import os
    print('%.2f MB' % (os.path.getsize(dst) / 1048576.0))
    zs = sorted({r[4] for r in rows})
    print('min_zoom values:', zs)
    for z in zs:
        print('  z >= %.1f : %d places' % (z, sum(1 for r in rows if r[4] <= z)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

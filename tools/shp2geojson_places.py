"""ne_10m_populated_places shapefile -> data/places.json

The city layer of the viewer: 7 342 Natural Earth populated places (v5.1.2,
10m cultural), as GeoJSON Points.

WHY THE PROPERTIES ARE ABBREVIATED
Full Natural Earth properties are 137 fields per place; the viewer reads six of
them. Shipped slim, the layer is ~700 kB; shipped whole it would be 8 MB of JSON
to parse before the cities can be drawn. The keys are documented in the file's
own `"about"` member so the data stays self-describing.

TRANSLATIONS
Localised names are written to ONE FILE PER LANGUAGE, data/cities.<code>.json:
`{"lang":"fr","n":7342,"sum":"…","names":{"1519":"Londres", …}}` — index into the
`places` array -> the name, and only where it DIFFERS from the base name (1536 of
7 342 for French, 7 342 for a non-Latin script). The viewer fetches the file when
that language is picked and not before, so choosing French costs 31 kB and the base
layer stays 0.59 MB. `n` and `sum` are a stamp: if the places list is ever rebuilt
from another Natural Earth release the indices move, and the viewer must be able to
notice instead of putting "Londres" on Lagos.

Only languages that BOTH layers carry are emitted: the country layer (10m map units)
has AR BN DE EL EN ES FA FR HE HI JA KO NL PT RU SV UK ZH, and Natural Earth has no
Italian/Polish/Turkish names for countries, so offering Italian would leave country
names in English while cities changed - worse than not offering it.

WHAT THE VIEWER USES
  z  MIN_ZOOM   the zoom at which Natural Earth intends the place to appear
                (1.7 ... 9.0) - the city layer's LOD, used verbatim
  l  LABELRANK  label priority, 0 (Paris, Tokyo) ... 8
  p  POP_MAX    population, -99 when unknown
  f  FEATURECLA abbreviated: A0 admin-0 capital, A0R admin-0 region capital,
                A1 admin-1 capital, A1R admin-1 region capital, P populated
                place, S scientific station, H historic place, M met. station
  n / c / r / tz  name, country (ADM0NAME), region (ADM1NAME), timezone
  k  CAPIN - WHICH capital this is, verbatim: "Administrative", "Legislative cap",
                "Judicial capita", "Official capita", "De facto, admin", "Former
                capital", ... (Natural Earth stores 16 characters, so the strings
                are truncated; app.js turns them into role tags). A country can have
                several: South Africa has three (Pretoria administrative, Cape Town
                legislative, Bloemfontein judicial).  Empty for a place that is not
                a capital at all, and for most A1/A0R rows.
  e  NAME_EN, which is what the Wikipedia link uses: the localised name in the panel
                follows the language selector, but an encyclopedia article does not.
  a  ADM0CAP as 0/1 - Natural Earth's own "this is the country's capital" flag, which
                is what decides the PRIMARY capital when there are several.

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


LANGS = ['EN', 'FR', 'DE', 'ES', 'PT', 'NL', 'RU', 'ZH', 'JA', 'AR', 'EL', 'FA',
         'HE', 'HI', 'KO', 'BN', 'SV', 'UK']
LANG_NAMES = {
    'en': 'English', 'fr': 'Français', 'de': 'Deutsch', 'es': 'Español',
    'pt': 'Português', 'nl': 'Nederlands', 'ru': 'Русский', 'zh': '中文',
    'ja': '日本語', 'ar': 'العربية', 'el': 'Ελληνικά', 'fa': 'فارسی',
    'he': 'עברית', 'hi': 'हिन्दी', 'ko': '한국어', 'bn': 'বাংলা',
    'sv': 'Svenska', 'uk': 'Українська',
}


def stamp(names):
    """a small, stable fingerprint of the place list, so a language file built from
    another release cannot be silently applied to this one (the keys are indices)."""
    h = 0
    for v in names:
        for ch in v:
            h = (h * 131 + ord(ch)) & 0xffffffff
    return '%08x' % h


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
                     round(lon, 4), round(lat, 4),
                     (d.get('CAPIN') or '').strip(), d.get('NAME_EN') or name,
                     int(d.get('ADM0CAP') or 0)])
    base_names = [r[0] for r in rows]
    # Natural Earth's own order is kept (it is roughly by importance); the viewer
    # sorts by its own rules at draw time
    out = {
        'type': 'places',
        'v': 1,
        'about': ('Natural Earth 10m populated places v5.1.2, slimmed for the viewer. '
                  'n=name c=country r=region p=pop_max z=min_zoom l=labelrank '
                  'f=feature class (A0 capital, A1 admin-1 capital, A0R/A1R region '
                  'capitals, P populated place, S scientific station, M met. station, '
                  'H historic) tz=timezone lon lat k=CAPIN (which capital) '
                  'e=NAME_EN (the Wikipedia title) a=ADM0CAP 0/1. '
                  'Coordinates to 4 decimals (~11 m).'),
        'fields': ['n', 'c', 'r', 'p', 'z', 'l', 'f', 'tz', 'lon', 'lat', 'k', 'e', 'a'],
        # the same fingerprint the language files carry
        'sum': stamp(base_names),
        'places': rows,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    print('%s: %d places (%d skipped, no point)' % (dst, len(rows), skipped))

    # ---- one file per language, differing names only ----
    import os
    d = os.path.dirname(dst) or '.'
    written = []
    for L in LANGS:
        code = L.lower()
        names = {}
        for i, rec in enumerate(r.iterRecords()):
            if i >= len(rows):
                break
            v = rec.as_dict().get('NAME_' + L)
            if v and v != base_names[i]:
                names[str(i)] = v
        out = {'lang': code, 'label': LANG_NAMES[code], 'n': len(rows),
               'sum': stamp(base_names), 'names': names}
        fp = os.path.join(d, 'cities.%s.json' % code)
        with open(fp, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        written.append((code, len(names), os.path.getsize(fp)))
    for code, cnt, size in written:
        print('  cities.%-3s %5d differing names  %5.1f kB' % (code, cnt, size / 1024.0))
    import os
    print('%.2f MB' % (os.path.getsize(dst) / 1048576.0))
    zs = sorted({r[4] for r in rows})
    print('min_zoom values:', zs)
    for z in zs:
        print('  z >= %.1f : %d places' % (z, sum(1 for r in rows if r[4] <= z)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

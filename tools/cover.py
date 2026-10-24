#!/usr/bin/env python3
"""KwizzyGeo — the CrazyGames cover images.

CrazyGames asks for three sizes (1920x1080 landscape, 800x1200 portrait, 800x800
square), with CONSISTENT visuals, the game's name on the cover, and no other text.
Their guidelines are followed literally here: not a screenshot (the globe is re-rendered
from the same Natural Earth data at cover resolution, with its own lighting), simple, a
stylised font (Space Grotesk), the title only.

The palette is the game's own (app.js COL / style.css):
    ocean      #143456 -> #0e2436        land       #2c4a66
    accent     #8ed0ff                   ink        #eaf3fb

THE GLOBE IS RENDERED BY INVERSE MAPPING, not by drawing polygons: for every pixel of
the disc the script computes lon/lat (orthographic inverse) and samples a land mask built
once from data/so50.geojson in equirectangular space. That is what makes the horizon
clean - polygons drawn one by one would need clipping and would seam at the limb - and it
lets the shading (limb darkening, the lit side, the bloom) be a function of the pixel.

    python3 tools/cover.py                    # all three, into docs/cover/
    python3 tools/cover.py --size 1920x1080   # just one
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'cover')
FONT = '/tmp/sg.ttf'

# ---------- palette ----------
# THE LOOK, in numbers, so a variant is a value and not a rewrite. Everything here was
# chosen by rendering a contact sheet of variants and looking at them (tools/cover.py
# --sheet), because "a bit darker" is not a measurement.
OCEAN_TOP = (26, 66, 110)
OCEAN_BOT = (9, 26, 46)
LAND_LIT = (110, 150, 190)      # land at the light (chosen off a contact sheet)
LAND_DARK = (40, 68, 100)       # land at the terminator
LIGHT_DIR = (-0.42, 0.52, 0.74)
SHEEN = 44
GRAT_ALPHA = 20
COAST = 1.0
TONEMAP = 0.35
ACCENT = (142, 208, 255)
INK = (234, 243, 251)


def lin(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


# ---------- 1. the land mask (equirectangular, built once) ----------
def build_mask(w=4096, h=2048):
    """True where there is land, in equirectangular space (x: -180..180, y: 90..-90)."""
    with open(os.path.join(ROOT, 'data', 'so50.geojson')) as f:
        gj = json.load(f)
    img = Image.new('1', (w, h), 0)
    d = ImageDraw.Draw(img)

    def to_px(lon, lat):
        return ((lon + 180.0) / 360.0 * w, (90.0 - lat) / 180.0 * h)

    def ring(coords):
        pts = [to_px(c[0], c[1]) for c in coords]
        if len(pts) < 3:
            return
        # a ring that crosses the antimeridian is drawn twice, shifted a world, so the
        # split at -180/180 does not leave a white wedge (the one real trap of the
        # equirectangular raster)
        xs = [p[0] for p in pts]
        if max(xs) - min(xs) > w * 0.5:
            for shift in (-w, w):
                d.polygon([(x + shift, y) for x, y in pts], fill=1)
        d.polygon(pts, fill=1)

    for feat in gj['features']:
        g = feat.get('geometry') or {}
        if g.get('type') == 'Polygon':
            for r in g['coordinates']:
                ring(r)
        elif g.get('type') == 'MultiPolygon':
            for poly in g['coordinates']:
                for r in poly:
                    ring(r)
    return np.array(img, dtype=bool)


# ---------- 2. the globe, by inverse mapping ----------
def render_globe(size, cx, cy, R, lon0, lat0):
    """The disc's normalised coordinates for a canvas.

    cx, cy and R are in PIXELS OF `size` - the caller supersamples and passes supersampled
    numbers. (Multiplying by ss again here is a bug this file had: it moved the globe's
    centre off-canvas, and what looked like "a dark globe" was the far edge of one.)"""
    W, H = int(size[0]), int(size[1])
    ys, xs = np.mgrid[0:H, 0:W]
    # pixel -> normalised disc coordinates, y up
    nx = (xs - cx) / R
    ny = -((ys - cy) / R)
    r2 = nx * nx + ny * ny
    inside = r2 <= 1.0
    r = np.sqrt(np.clip(r2, 0, 1))
    nz = np.sqrt(np.clip(1.0 - r2, 0, 1))

    # inverse orthographic around (lon0, lat0)
    p = math.radians(lat0)
    l = math.radians(lon0)
    sp, cp = math.sin(p), math.cos(p)
    lat = np.arcsin(np.clip(nz * sp + ny * cp, -1, 1))
    lon = l + np.arctan2(nx, nz * cp - ny * sp)
    lon = (np.degrees(lon) + 180.0) % 360.0 - 180.0
    latd = np.degrees(lat)

    return inside, r, nx, ny, nz, lon, latd


def sample_mask(mask, lon, lat):
    h, w = mask.shape
    xi = np.clip(((lon + 180.0) / 360.0 * w).astype(int), 0, w - 1)
    yi = np.clip(((90.0 - lat) / 180.0 * h).astype(int), 0, h - 1)
    return mask[yi, xi]


def glow_mask(alpha, radius, strength):
    """A blurred copy of a mask, for the halo every bright edge in this game has."""
    img = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8), 'L')
    img = img.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(img, dtype=np.float32) / 255.0 * strength


def draw_globe(img, mask, cx, cy, R, lon0, lat0, ss, graticule=True, bloom=1.0):
    W, H = img.size
    inside, r, nx, ny, nz, lon, latd = render_globe((W, H), cx, cy, R, lon0, lat0)

    # --- the sphere's own light: upper-left key light, limb darkening ---
    lx, ly, lz = LIGHT_DIR
    lam = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
    lit = lam ** 0.75                       # 0 at the terminator, 1 at the light
    shade = 0.34 + 0.78 * lit               # never fully black, never blown out
    shade *= 1.0 - 0.22 * r ** 4            # limb darkening

    ocean = np.zeros((H, W, 3), np.float32)
    for i in range(3):
        grad = OCEAN_TOP[i] + (OCEAN_BOT[i] - OCEAN_TOP[i]) * np.clip(0.5 - ny * 0.55, 0, 1)
        ocean[..., i] = grad * shade
    # a soft sheen, so the ocean reads as a surface and not as flat paint
    sheen = np.clip(lam, 0, 1) ** 4 * (1.0 - r) ** 0.5
    for i in range(3):
        ocean[..., i] += sheen * (SHEEN * 1.55 if i == 2 else SHEEN * 0.75)

    land = sample_mask(mask, lon, latd)
    la = (land & inside).astype(np.float32)

    # THE EDGE, done properly. (la - blur(la)) is 0 in the middle of a continent and 0 in
    # the open sea; it is positive only along a coast, which is exactly the set we want.
    # The first version wrote (la - 0.88 * blur(la)), which is 0.12 EVERYWHERE on land -
    # the whole globe then took a flat +78 of accent light and every continent washed out
    # to white. A blur of the FILLED mask, used as a glow, did the same a second time.
    blur_la = np.asarray(
        Image.fromarray((la * 255).astype(np.uint8), 'L')
        .filter(ImageFilter.GaussianBlur(max(1, int(R * 0.0022)))), np.float32) / 255.0
    edge = np.clip((la - blur_la) * 2.6, 0, 1)
    coast_glow = glow_mask(edge, int(R * 0.03) + 1, 1.0)

    col = ocean.copy()
    landcol = np.zeros((H, W, 3), np.float32)
    for i in range(3):
        landcol[..., i] = LAND_DARK[i] + (LAND_LIT[i] - LAND_DARK[i]) * np.clip(lit * 1.25, 0, 1)
    m = (land & inside)[..., None].astype(np.float32)
    col = col * (1 - m) + landcol * m

    # THE SHORE: a thin bright line on every coast, the thing that makes the map read as
    # a map instead of as a ball of paint
    for i in range(3):
        col[..., i] += edge * (ACCENT[i] * 0.9 + 26) * COAST
    for i in range(3):
        col[..., i] += coast_glow * ACCENT[i] * 0.55 * bloom

    # the limb: a thin bright ring, and a wider halo outside it
    limb = np.clip(1.0 - np.abs(r - 1.0) / 0.010, 0, 1) * inside
    for i in range(3):
        col[..., i] += limb * (ACCENT[i] * 0.75 + 55 * bloom)
    halo = np.clip((r - 1.0) / 0.20, 0, 1)
    halo = (1.0 - halo) ** 2.2 * (r > 1.0)

    # tonemap: v' = v / (1 + v/255 * k). k = 0 is a pass-through, k = 1 halves the headroom.
    col = col / (1.0 + col / 255.0 * TONEMAP)
    out = np.zeros((H, W, 3), np.float32)
    out[inside] = col[inside]
    alpha = inside.astype(np.float32)
    # the halo is painted OUTSIDE the disc too, so it lands in the transparent zone
    halocol = np.zeros((H, W, 3), np.float32)
    for i in range(3):
        halocol[..., i] = halo * ACCENT[i] * 0.42 * bloom
    img.paste(Image.fromarray(np.clip(out + halocol, 0, 255).astype(np.uint8), 'RGB'),
              (0, 0))

    if graticule:
        gd = ImageDraw.Draw(img, 'RGBA')
        gc = (142, 208, 255, GRAT_ALPHA)
        for lon_g in range(-180, 181, 30):
            pts = []
            for lat_g in range(-89, 90, 2):
                x, y, vis = proj(lon_g, lat_g, cx, cy, R, lon0, lat0)
                if vis:
                    pts.append((x, y))
                elif len(pts) > 1:
                    gd.line(pts, fill=gc, width=max(1, int(R * 0.0016)))
                    pts = []
                else:
                    pts = []
            if len(pts) > 1:
                gd.line(pts, fill=gc, width=max(1, int(R * 0.0016)))
        for lat_g in range(-60, 61, 30):
            pts = []
            for lon_g in range(-180, 181, 2):
                x, y, vis = proj(lon_g, lat_g, cx, cy, R, lon0, lat0)
                if vis:
                    pts.append((x, y))
                elif len(pts) > 1:
                    gd.line(pts, fill=gc, width=max(1, int(R * 0.0016)))
                    pts = []
                else:
                    pts = []
            if len(pts) > 1:
                gd.line(pts, fill=gc, width=max(1, int(R * 0.0016)))


def proj(lon, lat, cx, cy, R, lon0, lat0):
    p, l = math.radians(lat0), math.radians(lon0)
    la, lo = math.radians(lat), math.radians(lon)
    z = math.sin(p) * math.sin(la) + math.cos(p) * math.cos(la) * math.cos(lo - l)
    x = math.cos(la) * math.sin(lo - l)
    y = math.cos(p) * math.sin(la) - math.sin(p) * math.cos(la) * math.cos(lo - l)
    return (cx + x * R, cy - y * R, z > 0.004)


# ---------- 3. the background ----------
def background(W, H, ss):
    """Deep navy, a diagonal wash, a vignette, and a faint atlas grid."""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xs / W
    v = ys / H
    base = np.zeros((H, W, 3), np.float32)
    for i in range(3):
        base[..., i] = (OCEAN_BOT[i] * 0.70) + (18 if i == 2 else 8) * (1 - v)
    # the light behind the globe: a wide radial glow from the upper right
    dx = (u - 0.74) * 1.0
    dy = (v - 0.42) * 1.25
    rad = np.sqrt(dx * dx + dy * dy)
    for i in range(3):
        base[..., i] += np.clip(1 - rad / 0.62, 0, 1) ** 2.2 * (ACCENT[i] * 0.16)
    # vignette
    dd = np.sqrt((u - 0.5) ** 2 * 0.75 + (v - 0.5) ** 2)
    for i in range(3):
        base[..., i] *= np.clip(1.12 - dd * 0.55, 0.35, 1.1)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), 'RGB')

    # a very faint graticule over the whole canvas: the "atlas" texture the game has
    gd = ImageDraw.Draw(img, 'RGBA')
    step = int(64 * ss)
    for x in range(-step, W + step, step):
        gd.line([(x, 0), (x - int(0.22 * H), H)], fill=(142, 208, 255, 7), width=1)
    for y in range(0, H, step):
        gd.line([(0, y), (W, y)], fill=(142, 208, 255, 6), width=1)
    return img


# ---------- 4. the title ----------
def font(px, weight=700):
    f = ImageFont.truetype(FONT, int(px))
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def tracked_width(d, text, f, tracking):
    w = 0.0
    for ch in text:
        w += d.textlength(ch, font=f) + tracking
    return w - tracking if text else 0.0


def draw_tracked(d, xy, text, f, tracking, fill):
    """Letter-spaced text. PIL has no tracking, so each glyph is placed by hand - which
    is also what lets a two-colour wordmark be set exactly like the logo."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + tracking
    return x


def title_layer(word1, word2, px, tracking, gap):
    """The wordmark on its own transparent layer, cropped to its ink.

    KWIZZY in ink, GEO in the accent under its right end and smaller - the logo's own
    arrangement. Drawn on a layer sized to the text (found by measuring first), so the
    caller places it by a bbox and never by a guess about ascenders."""
    probe = Image.new('L', (8, 8))
    d0 = ImageDraw.Draw(probe)
    f1, f2 = font(px, 700), font(px * 0.52, 700)
    t1, t2 = tracking, tracking * 1.06
    w1 = tracked_width(d0, word1, f1, t1)
    w2 = tracked_width(d0, word2, f2, t2)
    a1, d1 = f1.getmetrics()
    a2, d2 = f2.getmetrics()
    lw = int(max(w1, w2)) + int(px * 0.16)
    lh = int(a1 + d1 + gap + a2 + d2) + int(px * 0.30)
    lay = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    x = (lw - w1) / 2
    y = int(px * 0.06)
    draw_tracked(d, (x, y), word1, f1, t1, INK + (255,))
    draw_tracked(d, (x + w1 - w2, y + a1 + d1 + gap), word2, f2, t2, ACCENT + (255,))
    return lay.crop(lay.getbbox())


def place(canvas, layer, fx, fy, halo=0.55):
    """Put a layer on the canvas with its centre at (fx, fy) in canvas fractions, and
    the soft halo this game puts under every bright thing."""
    W, H = canvas.size
    lw, lh = layer.size
    x = int(fx * W - lw / 2)
    y = int(fy * H - lh / 2)
    if halo > 0:
        g = layer.filter(ImageFilter.GaussianBlur(max(2, int(lh * 0.10))))
        a = g.getchannel('A').point(lambda v: int(v * halo))
        g.putalpha(a)
        canvas.alpha_composite(g, (x, y))
    canvas.alpha_composite(layer, (x, y))


# ---------- 5. compose ----------
def compose(size, layout, mask, ss=2):
    W, H = size[0] * ss, size[1] * ss
    img = background(W, H, ss).convert('RGBA')

    # --- the globe -------------------------------------------------------
    g = Image.new('RGB', (W, H), (0, 0, 0))
    R = layout['gr'] * min(W, H)
    draw_globe(g, mask, layout['gx'] * W, layout['gy'] * H, R,
               layout['lon'], layout['lat'], ss)

    # THE BLOOM, built the way app.js builds it: a blurred copy of the picture, squared
    # (multiplied with itself, so highlights survive and the dark ocean does not), then
    # screened back over it. A plain additive blur greys the whole frame instead.
    blur = g.filter(ImageFilter.GaussianBlur(max(2, int(R * 0.05))))
    b = np.asarray(blur, np.float32)
    b = b * b / 255.0
    base = np.asarray(img.convert('RGB'), np.float32)
    scr = 255.0 - (255.0 - base) * (255.0 - b * 0.85) / 255.0
    img = Image.fromarray(np.clip(scr, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    # the globe itself, unblurred, over its own bloom
    img.paste(g, (0, 0), Image.fromarray(
        (np.asarray(g, np.float32).max(axis=2) > 6).astype(np.uint8) * 255, 'L'))

    # --- the wordmark ----------------------------------------------------
    tl = title_layer('KWIZZY', 'GEO', layout['title'] * ss, layout['track'] * ss, layout['gap'] * ss)
    place(img, tl, layout['title_box'][0], layout['title_box'][1], layout['halo'])

    return img.convert('RGB').resize(size, Image.LANCZOS)


LAYOUTS = [
    # Landscapes: the globe bleeds off the right, the wordmark holds the left third. A
    # cover for a quiz reads at a glance - globe = geography, name = which game - so the
    # two never overlap.
    {
        'name': 'landscape-1920x1080', 'size': (1920, 1080),
        'gx': 0.735, 'gy': 0.500, 'gr': 0.640, 'lon': 10, 'lat': 26,
        'title': 168, 'track': 1.2, 'gap': 6, 'title_box': (0.295, 0.500), 'halo': 0.60,
    },
    {
        'name': 'landscape-1920x1024', 'size': (1920, 1024),
        'gx': 0.735, 'gy': 0.500, 'gr': 0.640, 'lon': 10, 'lat': 26,
        'title': 160, 'track': 1.15, 'gap': 6, 'title_box': (0.295, 0.500), 'halo': 0.60,
    },
    # Portrait and square: the globe has to stay a globe, so it goes BELOW the wordmark
    # and is cut by the bottom edge. Measured against the title's own box rather than
    # guessed: the title sits in the top fifth, the disc starts under it.
    {
        'name': 'portrait-800x1200', 'size': (800, 1200),
        'gx': 0.500, 'gy': 0.720, 'gr': 0.400, 'lon': 10, 'lat': 26,
        'title': 78, 'track': 0.9, 'gap': 3, 'title_box': (0.500, 0.135), 'halo': 0.60,
    },
    {
        'name': 'square-800x800', 'size': (800, 800),
        'gx': 0.500, 'gy': 0.790, 'gr': 0.470, 'lon': 10, 'lat': 26,
        'title': 68, 'track': 0.8, 'gap': 2, 'title_box': (0.500, 0.135), 'halo': 0.60,
    },
]


def sheet():
    """A contact sheet of looks, so the eye can choose and the numbers can be read back."""
    import itertools
    mask = build_mask()
    variants = []
    for land_top, tonemap, coast in itertools.product(
            [(126, 166, 205), (100, 140, 182), (160, 195, 226)],
            [0.35, 0.62],
            [0.55, 1.0]):
        variants.append((land_top, tonemap, coast))
    tiles = []
    g = globals()
    for land_top, tonemap, coast in variants:
        g['LAND_LIT'] = land_top
        g['TONEMAP'] = tonemap
        g['COAST'] = coast
        L = dict(LAYOUTS[0])
        L['size'] = (760, 428)
        L['title'] = 64
        L['track'] = 0.6
        L['gr'] = 0.64
        img = compose(L['size'], L, mask, ss=1)
        from PIL import ImageDraw as ID
        d = ID.Draw(img)
        d.rectangle([0, 0, 300, 18], fill=(0, 0, 0))
        d.text((4, 4), 'land%s tone%.2f coast%.2f' % (land_top[0], tonemap, coast),
               font=font(12), fill=(255, 255, 255))
        tiles.append(img)
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    tw, th = 760, 428
    out = Image.new('RGB', (cols * tw + (cols + 1) * 8, rows * th + (rows + 1) * 8), (18, 22, 28))
    for i, t in enumerate(tiles):
        out.paste(t, (8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + 8)))
    p = '/tmp/sheet.png'
    out.resize((out.width // 2, out.height // 2), Image.LANCZOS).save(p)
    print(p)


def main():
    if '--sheet' in sys.argv:
        sheet()
        return
    want = None
    for a in sys.argv[1:]:
        if a.startswith('--size'):
            want = a.split('=', 1)[1] if '=' in a else sys.argv[sys.argv.index(a) + 1]
    os.makedirs(OUT, exist_ok=True)
    print('building the land mask…')
    mask = build_mask()
    for L in LAYOUTS:
        if want and ('%dx%d' % L['size']) != want:
            continue
        print('  ', L['name'], '…')
        img = compose(L['size'], L, mask)
        p = os.path.join(OUT, L['name'] + '.png')
        img.save(p, optimize=True)
        print('   ->', p, os.path.getsize(p) // 1024, 'kB')


if __name__ == '__main__':
    main()

"""Kongō hull region: the hull sides and their portholes, the weather decks' fittings forward of
the pagoda and on the quarterdeck, deck-edge rails over the whole length and everything below
the waterline.

Owns ground tackle (hawse pipes, cables, stoppers, windlasses, capstan and anchors), bitts,
fairleads, ventilators, hatches and winches on the weather decks, the bow crest and jackstaff,
the stern anchors, screws, shafts, brackets and rudders. Datums are reference-frame
measurements converted by `P`.
"""
import math
from mathutils import Vector
from kongo_kit import P
from kongo_windows import WINDOWS

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()

# Weather-deck fittings: (kind, reference x, z, deck y, size, mirrored). Sizes in metres: athwartships,
# fore and aft, height; round fittings (radius, height). Mirrored rows are listed once for starboard.
DECK_FITTINGS = [
    # Forecastle.
    ('bitts', 5.86, -87.88, 7.07, (1.06, 2.28, .85), True), ('bitts', 0, -105.2, 7.33, (.74, 1.6, .6), False),
    ('roller fairlead', 1.75, -106.35, 7.05, (.8, 1.07, .7), True), ('chock', .97, -109.33, 7.4, (.48, .9, .3), True),
    ('chock', 1.31, -108.48, 7.4, (.46, .79, .3), True), ('chock', 8.78, -51.2, 6.3, (.55, 1.73, .9), True),
    ('mushroom vent', 2.99, -70.01, 6.49, (.25, .82), True), ('mushroom vent', 4.94, -61.76, 6.37, (.25, .82), True),
    ('mushroom vent', -6.03, -74.3, 6.88, (.19, .71), False), ('mushroom vent', 6.13, -69.84, 6.77, (.19, .71), False),
    ('mushroom vent', 6.38, -61.48, 6.6, (.19, .71), False),
    ('vent', 5.95, -71.44, 6.87, (.71, .78, .53), False), ('vent', 0, -71.48, 6.87, (.96, 1.06, .71), False),
    ('vent', -6.47, -56.45, 6.55, (.95, 1.06, .71), False), ('vent', .97, -87.69, 7.11, (.71, .79, .53), False),
    ('vent', 7.02, -56.27, 6.55, (.96, 1.05, .71), False), ('vent', -5.9, -75.8, 6.99, (.71, .79, .52), False),
    ('vent', 6.2, -63.69, 6.68, (.71, .78, .53), False), ('vent', 2.08, -68.69, 6.83, (.96, 1.06, .72), False),
    ('vent', 4.17, -56.78, 6.55, (1.13, 1.19, .71), False), ('vent', .26, -89.97, 7.1, (1.06, .96, .72), False),
    ('vent', -5.92, -64.76, 6.68, (.89, .87, .53), False), ('vent', -5.65, -84.24, 7.02, (.86, .89, .53), False),
    ('vent', -4.17, -56.78, 6.55, (1.13, 1.19, .71), False), ('vent', 5.9, -77.82, 6.99, (.72, .78, .53), False),
    ('vent', -3.55, -64.17, 6.68, (1.16, 1.07, .71), False), ('vent', 3.06, -55.9, 6.55, (.87, .82, .53), False),
    ('hatch', 0, -88.81, 7.13, (2.18, 1.25, .44), False), ('hatch', 0, -76.7, 7.02, (.93, .99, .49), False),
    ('hatch', -2.25, -68.86, 6.82, (2.19, 1.25, .44), False), ('hatch', 3.3, -53.53, 6.55, (2.19, 1.25, .44), True),
    ('winch', 2.0, -66.75, 6.81, (2.1, .88, 1.16), True), ('winch', -5.0, -51.15, 6.62, (1.0, 2.2, 1.35), False),
    ('grating', 6.05, -82.07, 6.98, (1.08, 1.0, .12), True), ('grating', 2.39, -103.07, 7.2, (1.28, 1.23, .12), True),
    # Quarterdeck and the after end of the forecastle deck.
    ('bitts', 5.43, 83.8, 4.32, (1.48, 2.41, .87), True), ('bitts', 10.75, 41.1, 4.32, (1.15, 2.31, .87), False),
    ('chock', 11.4, 37.27, 4.03, (.64, 1.75, .91), False), ('chock', 2.52, 100.0, 4.03, (.9, 1.8, .9), True),
    ('winch', 3.5, 70.74, 4.34, (2.61, 1.11, 1.44), True), ('winch', -3.72, 56.0, 4.35, (1.58, 2.19, 1.35), False),
    ('hatch', 0, 95.41, 4.35, (1.47, 2.57, .45), False), ('hatch', 0, 87.3, 4.28, (1.24, 2.19, .43), False),
    ('hatch', -2.29, 71.81, 4.34, (2.18, 1.24, .43), False), ('hatch', 0, 59.5, 4.35, (.93, .99, .49), False),
    ('hatch', -.57, 105.1, 4.36, (.93, .99, .49), False),
    ('vent', -5.23, 65.08, 4.33, (.76, 1.26, .49), False), ('vent', 3.85, 69.43, 4.33, (1.25, 1.25, .49), False),
    ('vent', -4.93, 63.83, 4.33, (.94, 1.31, .49), False), ('vent', 4.82, 62.83, 4.35, (1.01, 1.12, .71), False),
    ('vent', -5.59, 66.34, 4.35, (1.04, 1.15, .71), False), ('vent', 4.93, 68.04, 4.35, (1.01, 1.13, .71), False),
    ('vent', -3.22, 61.43, 4.35, (.74, .73, .45), False), ('vent', 3.44, 61.43, 4.35, (.73, .73, .45), False),
    ('ladder', -8.21, 63.96, 4.32, (2.88, 7.68, .22), False), ('ladder', 8.5, 63.62, 4.32, (2.3, 7.78, .22), False),
    ('stores', -9.38, 37.74, 4.35, (.84, 2.36, .33), False), ('stores', 7.47, 44.19, 4.35, (.84, 2.36, .33), False),
]


def build(D, kit):
    cols = kit.cols
    deck = cols['Deck fittings']
    under = cols['Underwater fittings']
    ground_tackle(kit, deck)
    deck_fittings(kit, deck)
    crest_and_staffs(kit, deck)
    kit.windows('hull-portholes', cols['Hull and decks'], WINDOWS['hull'])
    screws_and_rudders(kit, under)
    deck_edge_rails(D, kit, deck)


# ---------------------------------------------------------------- ground tackle
def chain(kit, assembly, col, path, pitch=.316):
    """Stud-link cable laid along a reference-frame path of (x, z) points on the deck, links alternating
    flat and on edge, merged into one mesh."""
    pts = [Vector(P(x, 0, z)[:2]) for x, z in path]
    seg = [(a, b, (b - a).length) for a, b in zip(pts, pts[1:])]
    total = sum(s[2] for s in seg)
    vv, ff = [], []
    n = int(total / pitch)
    for i in range(n):
        d = (i + .5) * pitch
        for a, b, L in seg:
            if d <= L:
                c = a.lerp(b, d / L)
                u = (b - a).normalized()
                break
            d -= L
        floor = kit.support.below(c.x, c.y, 8.5)
        v = Vector((-u.y, u.x, 0))
        up = Vector((0, 0, 1))
        flat = i % 2 == 0
        side, lift = (v, .04) if flat else (up, .16)
        centre = Vector((c.x, c.y, floor + lift))
        k = len(vv)
        # A rounded link ring: 10 points round the link, 4 round the bar.
        ring = []
        for j in range(10):
            a = math.tau * j / 10
            ring.append((math.cos(a) * .22, math.sin(a) * .12))
        for rx, ry in ring:
            p = centre + Vector((u.x, u.y, 0)) * rx + side * ry
            outward = (Vector((u.x, u.y, 0)) * rx + side * ry * 3.4).normalized()
            other = Vector((u.x, u.y, 0)).cross(side).normalized()
            for q in range(4):
                b = math.tau * q / 4
                vv.append(tuple(p + (outward * math.cos(b) + other * math.sin(b)) * .045))
        ff += [(k + j * 4 + q, k + j * 4 + (q + 1) % 4, k + ((j + 1) % 10) * 4 + (q + 1) % 4, k + ((j + 1) % 10) * 4 + q) for j in range(10) for q in range(4)]
    kit.tag(kit.mesh(assembly + '.cable', vv, ff, 'black', col), assembly)


def anchor(kit, assembly, col, s, hawse, crown, scale=1.0):
    """Stockless anchor housed against the hull: shank from the hawse to the crown, arms and palms."""
    h, c = Vector(P(*hawse)), Vector(P(*crown))
    kit.part('rod', assembly, col, 'shank', h, c, .15 * scale, 'black', vertices=10, r2=.13 * scale)
    axis = (c - h).normalized()
    across = axis.cross(Vector((0, s, 0))).normalized()
    for t in (-1, 1):
        tip = c + across * t * 1.05 * scale - axis * .75 * scale
        kit.part('rod', assembly, col, 'arm', c, tip, .13 * scale, 'black', vertices=8)
        kit.part('box', assembly, col, 'palm', tuple(tip - axis * .1 * scale), (.55 * scale, .22 * scale, .55 * scale), 'black')
    kit.part('box', assembly, col, 'crown', tuple(c), (.6 * scale, .4 * scale, .6 * scale), 'black')


def ground_tackle(kit, col):
    sup = kit.support
    for s in (-1, 1):
        side = 'port' if s < 0 else 'starboard'
        A = f'cable-{side}'
        # Spurling pipe on the deck: a raised oval with the cable running down it.
        x, y, z = P(s * 2.78, 0, -98.22)
        floor = sup.below(x, y, 8.5)
        kit.prism(A, col, 'spurling pipe', [(x + a, y + b) for a, b in kit.stadium(.81, 3.36, 28)], floor - .05, floor + .22, 'naval')
        kit.prism(A, col, 'spurling opening', [(x + a, y + b) for a, b in kit.stadium(.47, 2.47, 24)], floor + .2, floor + .23, 'dark')
        path = [(s * 2.72, -97.6), (s * 2.53, -95.3), (s * 2.43, -93.4), (s * 2.47, -92.1), (s * 2.63, -88.3), (s * 2.62, -86.4),
                (s * 2.46, -84.8), (s * 2.54, -81.3), (s * 2.62, -78.1), (s * 2.45, -75.0), (s * 2.3, -74.1)]
        chain(kit, A, col, path)
        # Steel cable-path plates under the cable.
        for (ax, az), (bx, bz) in zip(path, path[1:]):
            a, b = Vector(P(ax, 0, az)[:2]), Vector(P(bx, 0, bz)[:2])
            m = (a + b) / 2
            h = sup.below(m.x, m.y, 8.5)
            plate = kit.part('box', A, col, 'cable plate', (m.x, m.y, h), ((b - a).length + .05, 1.1, .06), 'naval')
            plate.rotation_euler = (0, 0, math.atan2(b.y - a.y, b.x - a.x))
        # Cable stoppers on the deck.
        for sx, sz in ((2.49, -94.35), (2.62, -86.09)):
            x, y, z = P(s * sx, 0, sz)
            floor = sup.below(x, y, 8.5)
            kit.part('box', A, col, 'stopper', (x, y, floor + .14), (.38, .8, .28), 'naval')
            kit.part('rod', A, col, 'stopper lever', (x, y - s * .4, floor + .25), (x - .9, y - s * 1.1, floor + .08), .04, 'edge', vertices=6)
        # Windlass: gear housing, cable holder and its brake handwheel.
        W = f'windlass-{side}'
        x, y, z = P(s * 2.29, 0, -73.28)
        floor = sup.below(x, y, 8.5)
        kit.part('box', W, col, 'gear housing', (x, y, floor + .25), (1.6, 1.6, .5), 'naval')
        kit.cylz(W, col, 'cable holder', (x, y, floor + .45), .77, .45, 'naval', 24)
        kit.cylz(W, col, 'holder cap', (x, y, floor + .9), .43, .22, 'naval', 18)
        hx, hy, hz = P(s * 2.56, 0, -71.93)
        kit.part('rod', W, col, 'brake column', (hx, hy, floor), (hx, hy, floor + .55), .06, 'naval', vertices=8)
        kit.part('rod', W, col, 'brake handwheel', (hx - .03, hy, floor + .6), (hx + .03, hy, floor + .6), .22, 'edge', vertices=14)
        # Bower anchor housed in its hawse on the hull side.
        B = f'bower-anchor-{side}'
        kit.part('rod', B, col, 'hawse lip', P(s * 2.98, 7.02, -98.95), P(s * 3.25, 6.7, -99.45), .32, 'naval', vertices=14)
        anchor(kit, B, col, s, (s * 3.08, 6.85, -99.2), (s * 3.28, 4.75, -101.0))
        # Stern anchor in its hawse under the quarterdeck.
        anchor(kit, f'stern-anchor-{side}', col, s, (s * 4.4, 4.1, 91.7), (s * 4.55, 2.3, 92.35), .62)
    # Capstans: before the windlasses, and on the quarterdeck abaft No. 4 turret.
    for C, (rx, rz, ry, r) in (('capstan-fwd', (0, -81.85, 7.02, .62)), ('capstan-aft', (0, 78.28, 4.24, .58))):
        capstan(kit, C, col, rx, rz, ry, r)


def capstan(kit, C, col, rx, rz, ry, r):
    x, y, _ = P(rx, 0, rz)
    floor = kit.support.below(x, y, ry + .6)
    kit.part('box', C, col, 'bed plate', (x, y, floor + .03), (r * 3.1, r * 3.1, .06), 'naval')
    kit.cylz(C, col, 'barrel', (x, y, floor), r, .5, 'naval', 8, r2=r * .88)
    kit.cylz(C, col, 'head', (x, y, floor + .5), r * 1.08, .12, 'naval', 16)
    for i in range(8):
        a = math.tau * (i + .5) / 8
        kit.part('box', C, col, 'whelp', (x + math.cos(a) * r * .95, y + math.sin(a) * r * .95, floor + .25), (.12, .12, .46), 'naval')


# ---------------------------------------------------------------- weather-deck fittings
def deck_fittings(kit, col):
    sup = kit.support
    for n, (kind, rx, rz, ry, size, mirror) in enumerate(DECK_FITTINGS):
        for s in ((-1, 1) if mirror and rx else (1,)):
            A = f'{kind.replace(" ", "-")}-{n}{"" if s > 0 or not mirror else "p"}'
            x, y, _ = P(s * rx, 0, rz)
            floor = sup.below(x, y, ry + .6)
            if kind == 'mushroom vent':
                r, h = size
                kit.cylz(A, col, 'trunk', (x, y, floor), r * .6, h * .78, 'naval', 12)
                kit.cylz(A, col, 'cap', (x, y, floor + h * .72), r, h * .28, 'naval', 16, r2=r * .45)
                continue
            w, l, h = size
            if kind == 'bitts':
                kit.part('box', A, col, 'bed plate', (x, y, floor + .05), (l, w, .1), 'naval')
                r = min(w, l / 2) * .32
                for t in (-1, 1):
                    kit.cylz(A, col, 'bitt', (x + t * l * .27, y, floor), r, h, 'naval', 14)
                    kit.cylz(A, col, 'bitt cap', (x + t * l * .27, y, floor + h), r * 1.25, .06, 'naval', 14)
            elif kind == 'roller fairlead':
                kit.part('box', A, col, 'base', (x, y, floor + .1), (l, w, .2), 'naval')
                kit.part('rod', A, col, 'roller', (x, y - w * .35, floor + .45), (x, y + w * .35, floor + .45), .2, 'naval', vertices=14)
                for t in (-1, 1):
                    kit.part('box', A, col, 'horn', (x + t * l * .38, y, floor + .4), (.12, w * .8, .6), 'naval')
            elif kind == 'chock':
                kit.part('box', A, col, 'chock', (x, y, floor + h / 2), (l, w, h), 'naval')
                kit.part('box', A, col, 'throat', (x, y, floor + h * .72), (l + .02, w * .45, h * .3), 'dark')
            elif kind == 'vent':
                kit.part('box', A, col, 'trunk', (x, y, floor + h * .35), (l * .7, w * .7, h * .7), 'naval')
                kit.part('box', A, col, 'hood', (x, y, floor + h * .82), (l, w, h * .36), 'naval')
                kit.part('box', A, col, 'louvre', (x + l * .5, y, floor + h * .8), (.02, w * .7, h * .22), 'dark')
            elif kind == 'hatch':
                kit.part('box', A, col, 'coaming', (x, y, floor + h * .45), (l, w, h * .9), 'naval')
                kit.part('box', A, col, 'cover', (x, y, floor + h * .94), (l + .06, w + .06, h * .12), 'roof')
            elif kind == 'winch':
                kit.part('box', A, col, 'bed', (x, y, floor + .1), (l, w, .2), 'naval')
                along_x = l >= w
                a, b = ((x - l * .35, y), (x + l * .35, y)) if along_x else ((x, y - w * .35), (x, y + w * .35))
                kit.part('rod', A, col, 'drum', (a[0], a[1], floor + h * .5), (b[0], b[1], floor + h * .5), min(w, l) * .3, 'naval', vertices=16)
                kit.part('box', A, col, 'motor', (x - (0 if along_x else l * .3), y - (w * .3 if along_x else 0), floor + h * .45), (min(l, w) * .6, min(l, w) * .6, h * .7), 'naval')
            elif kind == 'ladder':
                kit.part('box', A, col, 'stowed ladder', (x, y, floor + h / 2), (l, w, h), 'naval')
                for t in range(1, 12):
                    px = x - l / 2 + l * t / 12
                    kit.part('box', A, col, 'tread', (px, y, floor + h + .01), (.08, w * .9, .03), 'wood')
            elif kind == 'stores':
                kit.part('box', A, col, 'stores box', (x, y, floor + h / 2), (l, w, h), 'wood')
            elif kind == 'grating':
                kit.part('box', A, col, 'grating', (x, y, floor + h / 2), (l, w, h), 'wood')


def crest_and_staffs(kit, col):
    x, y, z = P(0, 7.93, -111.03)
    kit.part('rod', 'chrysanthemum', col, 'crest', (x - .05, y, z), (x + .1, y, z), .45, 'gold', vertices=16)
    for i in range(16):
        a = math.tau * i / 16
        kit.part('box', 'chrysanthemum', col, 'petal', (x + .08, y + .32 * math.cos(a), z + .32 * math.sin(a)), (.06, .12, .12), 'gold')
    kit.part('rod', 'jackstaff', col, 'staff', P(0, 7.45, -110.3), P(0, 15.6, -110.3), .05, 'naval', vertices=8)


# ---------------------------------------------------------------- screws, shafts, brackets and rudders
def screw(kit, id, col, hub, pitch_hand):
    """Three-bladed screw of 3.3 m on a tapered boss; blades lofted with pitch and skew."""
    hx, hy, hz = hub
    kit.part('rod', id, col, 'boss', (hx + .5, hy, hz), (hx - .45, hy, hz), .36, 'bronze', vertices=16, r2=.2)
    R, root, pitch = 1.65, .34, 3.6
    for k in range(3):
        base = k * math.tau / 3
        vv = []
        radii = [root + (R - root) * i / 6 for i in range(7)]
        for r in radii:
            f = (r - root) / (R - root)
            chord = 1.3 * math.sqrt(max(0, 1 - (f - .45) ** 2 / .62 ** 2)) + .18
            phi = math.atan(pitch / (math.tau * r))           # blade angle to the disc plane
            skew = .35 * f * f                                 # tip swept back
            thick = .09 * (1 - f) + .025
            for side in (1, -1):
                for c in (-.5, -.2, .15, .5):
                    ang = base + (c * chord) / r * math.cos(phi) * pitch_hand + skew * pitch_hand
                    ax = -c * chord * math.sin(phi) + side * thick * (1 - abs(c) * 1.6) * .5 * math.cos(phi)
                    vv.append((hx + ax, hy + r * math.cos(ang), hz + r * math.sin(ang)))
        n = 8
        ff = []
        for i in range(len(radii) - 1):
            for j in range(3):
                a, b = i * n + j, (i + 1) * n + j
                ff.append((a, a + 1, b + 1, b))                   # front face
                ff.append((a + 4 + 1, a + 4, b + 4, b + 4 + 1))   # back face
            ff.append((i * n, (i + 1) * n, (i + 1) * n + 4, i * n + 4))            # leading edge
            ff.append((i * n + 3 + 4, (i + 1) * n + 3 + 4, (i + 1) * n + 3, i * n + 3))  # trailing edge
        t = (len(radii) - 1) * n
        ff.append((t, t + 4, t + 5, t + 1))
        ff.append((t + 1, t + 5, t + 6, t + 2))
        ff.append((t + 2, t + 6, t + 7, t + 3))
        if pitch_hand > 0:
            ff = [tuple(reversed(f)) for f in ff]
        ob = kit.mesh(f'{id}.blade', vv, ff, 'bronze', col, True)
        for poly in ob.data.polygons:
            poly.use_smooth = True
        kit.tag(ob, id)


def rudder(kit, id, col, rx):
    """Streamlined balanced rudder: a lofted foil 1.45 m thick at 30 % chord under a stock to the hull."""
    zs = [87.8, 88.0, 88.5, 89.3, 90.3, 91.5, 92.8, 94.0, 94.9, 95.2]
    top = [-6.2, -5.7, -5.45, -5.2, -5.1, -5.25, -5.5, -5.75, -5.9, -6.2]
    bot = [-6.2, -7.6, -8.1, -8.45, -8.6, -8.45, -8.1, -7.7, -7.3, -6.2]
    c0, c1 = zs[0], zs[-1]
    vv = []
    for z, yt, yb in zip(zs, top, bot):
        u = (z - c0) / (c1 - c0)
        f = 1.4845 * math.sqrt(u) - .63 * u - 1.758 * u * u + 1.4215 * u ** 3 - .5075 * u ** 4
        t = max(.02, .725 * f / .5)
        for sx, yy in ((-1, yb), (1, yb), (1, yt), (-1, yt)):
            vv.append(P(rx + sx * t, yy, z))
    n = len(zs)
    ff = [(4 * i + j, 4 * i + (j + 1) % 4, 4 * (i + 1) + (j + 1) % 4, 4 * (i + 1) + j) for i in range(n - 1) for j in range(4)]
    ff += [(3, 2, 1, 0), (4 * (n - 1), 4 * (n - 1) + 1, 4 * (n - 1) + 2, 4 * (n - 1) + 3)]
    ob = kit.mesh(id + '.blade', vv, ff, 'antifouling', col)
    kit.tag(ob, id)
    # The stock rises from the blade's top into the hull.
    x, y, z = P(rx, -5.2, 90.3)
    hull = kit.support.along((x, y, z), (0, 0, 1), 4.0).z
    kit.part('rod', id, col, 'stock', (x, y, z - .1), (x, y, hull + .2), .22, 'antifouling', vertices=12)


def screws_and_rudders(kit, col):
    sup = kit.support
    for id, (rx, ry, rz_), shaft_z in [('screw-1', (-6.72, -5.39, 78.92), 60.0), ('screw-2', (-3.31, -6.49, 86.53), 72.0),
                                       ('screw-3', (3.46, -6.35, 86.53), 72.0), ('screw-4', (6.87, -5.24, 78.92), 60.0)]:
        x, y, z = P(rx, ry, rz_)
        screw(kit, id, col, (x, y, z), 1 if rx < 0 else -1)
        sx, sy, sz = P(rx, ry + .15, shaft_z)
        kit.part('rod', id, col, 'shaft', (x + .5, y, z), (sx, sy, sz), .23, 'edge', vertices=12)
        bx, by, bz = P(rx, ry + .05, rz_ - 3.2)
        foot = sup.below(bx, by * .6, bz + 4)
        kit.part('rod', id, col, 'bracket', (bx, by, bz), (bx, by * .55, foot + .05), .14, 'antifouling', vertices=8)
        kit.part('rod', id, col, 'bracket', (bx, by, bz), (bx, by * 1.08, foot + .05), .14, 'antifouling', vertices=8)
        kit.part('rod', id, col, 'bracket boss', (bx + .5, by, bz), (bx - .5, by, bz), .32, 'antifouling', vertices=12)
    for id, rx in [('rudder-port', -2.28), ('rudder-starboard', 2.28)]:
        rudder(kit, id, col, rx)


# ---------------------------------------------------------------- deck-edge rails
def deck_edge_rails(D, kit, col):
    H = D['hull']
    L = H['length']
    secs = H['sections']

    def edge(station):
        for a, b in zip(secs, secs[1:]):
            if a['station'] <= station <= b['station']:
                t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
                pa, pb = a['points'][-1], b['points'][-1]
                return pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t
        return secs[-1]['points'][-1]
    # Casemate drums turn in the forecastle embrasures below the deck edge: no rail over them.
    drums = [(-m['position'][2], -m['position'][0]) for m in D['mounts'] if m['partId'].endswith('casemate')]
    for side in (-1, 1):
        pts = []
        for i in range(0, 441):
            st = 1.0 + (L - 3.5) * i / 440
            w, h = edge(st)
            pts.append((st - L / 2, side * max(0, w - .08), h))
        run = []
        for p, q in zip(pts, pts[1:]):
            near_drum = any(math.hypot(p[0] - dx, p[1] - dy) < 1.7 or math.hypot(q[0] - dx, q[1] - dy) < 1.7 for dx, dy in drums)
            if abs(p[2] - q[2]) > .35 or abs(p[1] - q[1]) > .8 or near_drum:
                if len(run) > 1:
                    kit.rail('deck-rails', col, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)
                run = []
                continue
            run.append(p)
        if len(run) > 1:
            kit.rail('deck-rails', col, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)

"""Fusō hull region: the weather decks' fittings, deck-edge rails over the whole length and everything below
the waterline.

Owns ground tackle (hawse pockets, cables, spurling pipes, stoppers, windlasses, capstans and the housed bower and
stern anchors), bitts, fairleads, ventilators, hatches, winches and reels from the reference's fitting table
(fuso_fittings.py), the bow crest and jackstaff, the four screws on their shafts, bossings and brackets, and the
twin rudders. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from fuso_kit import P, ZC
from fuso_fittings import DECK_FITTINGS, PORTHOLES

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()


def build(D, kit):
    cols = kit.cols
    deck = cols['Deck fittings']
    under = cols['Underwater fittings']
    ground_tackle(kit, deck)
    deck_fittings(kit, deck)
    crest_and_staffs(kit, deck)
    portholes(kit, cols['Hull and decks'])
    screws_and_rudders(kit, under)
    deck_edge_rails(D, kit, deck)


# ---------------------------------------------------------------- ground tackle
def chain(kit, assembly, col, path, pitch=.3):
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
        floor = kit.support.below(c.x, c.y, 9.0)
        v = Vector((-u.y, u.x, 0))
        up = Vector((0, 0, 1))
        flat = i % 2 == 0
        side, lift = (v, .04) if flat else (up, .15)
        centre = Vector((c.x, c.y, floor + lift))
        k = len(vv)
        for j in range(10):
            a = math.tau * j / 10
            rx, ry = math.cos(a) * .21, math.sin(a) * .115
            p = centre + Vector((u.x, u.y, 0)) * rx + side * ry
            outward = (Vector((u.x, u.y, 0)) * rx + side * ry * 3.4).normalized()
            other = Vector((u.x, u.y, 0)).cross(side).normalized()
            for q in range(4):
                b = math.tau * q / 4
                vv.append(tuple(p + (outward * math.cos(b) + other * math.sin(b)) * .042))
        ff += [(k + j * 4 + q, k + j * 4 + (q + 1) % 4, k + ((j + 1) % 10) * 4 + (q + 1) % 4, k + ((j + 1) % 10) * 4 + q) for j in range(10) for q in range(4)]
    kit.tag(kit.mesh(assembly + '.cable', vv, ff, 'black', col), assembly)


def seat_on_hull(kit, s, ref, standoff):
    """Point on the hull plating at a reference (y, z), found by a ray from outboard, moved `standoff` out along the
    plating's normal; returns (point, outward normal) in the authoring frame."""
    origin = Vector(P(s * 20, ref[1], ref[2]))
    direction = Vector((0, s, 0))
    hit = kit.hit(origin, direction, 22)
    if hit is None:
        return Vector(P(*ref)), Vector((0, -s, 0))
    loc, nrm = hit
    nrm = Vector(nrm)
    if nrm.dot(direction) > 0:
        nrm = -nrm
    return loc + nrm * standoff, nrm


def anchor(kit, assembly, col, s, hawse, crown, scale=1.0):
    """Stockless anchor housed flat against the plating: the shank from the hawse down to the crown, the arms and
    palms spread in the plating's plane, the hawse pipe's bolster round the shank's head."""
    h, nh = seat_on_hull(kit, s, hawse, .2 * scale)
    c, nc = seat_on_hull(kit, s, crown, .24 * scale)
    kit.part('rod', assembly, col, 'shank', h, c, .15 * scale, 'black', vertices=10, r2=.13 * scale)
    kit.part('rod', assembly, col, 'shackle', h - nh * .05, h + (h - c).normalized() * .3 * scale, .11 * scale, 'black', vertices=8)
    axis = (c - h).normalized()
    across = axis.cross(nc).normalized()
    for t in (-1, 1):
        tip = c + across * t * 1.2 * scale - axis * .9 * scale
        kit.part('rod', assembly, col, 'arm', c, tip, .14 * scale, 'black', vertices=8, r2=.1 * scale)
        palm = kit.part('box', assembly, col, 'palm', tuple(tip - axis * .12 * scale), (.62 * scale, .62 * scale, .2 * scale), 'black')
        palm.rotation_euler = (across.cross(nc)).to_track_quat('Z', 'Y').to_euler()
    kit.part('box', assembly, col, 'crown', tuple(c), (.62 * scale, .62 * scale, .62 * scale), 'black')
    # Bolster: a thick ring on the plating round the hawse, touching the shank.
    b, nb = seat_on_hull(kit, s, hawse, .0)
    kit.part('rod', assembly, col, 'hawse bolster', b - nb * .05, b + nb * .22 * scale, .38 * scale, 'naval', vertices=16, r2=.3 * scale)


def capstan(kit, C, col, rx, rz, ry, r, height=.55):
    x, y, _ = P(rx, 0, rz)
    floor = kit.support.below(x, y, ry + .6)
    kit.part('box', C, col, 'bed plate', (x, y, floor + .03), (r * 3.1, r * 3.1, .06), 'naval')
    kit.cylz(C, col, 'barrel', (x, y, floor), r, height, 'naval', 8, r2=r * .88)
    kit.cylz(C, col, 'head', (x, y, floor + height), r * 1.08, .13 * height / .55, 'naval', 16)
    for i in range(8):
        a = math.tau * (i + .5) / 8
        kit.part('box', C, col, 'whelp', (x + math.cos(a) * r * .95, y + math.sin(a) * r * .95, floor + height / 2), (.12, .12, height - .05), 'naval')


def ground_tackle(kit, col):
    """Bower cables from the stem-side hawses aft over spurling pipes and stoppers to the windlasses
    (reference plan cuts of the forecastle), the capstan between them, and the housed anchors."""
    sup = kit.support
    for s in (-1, 1):
        side = 'port' if s < 0 else 'starboard'
        A = f'cable-{side}'
        # Hawse pipe mouth on the deck near the stem and the cable path aft to the windlass (x, reference z).
        x, y, z = P(s * 3.3, 0, -97.2)
        floor = sup.below(x, y, 9)
        kit.prism(A, col, 'hawse deck pipe', [(x + a, y + b) for a, b in kit.stadium(.62, 2.6, 24)], floor - .05, floor + .3, 'naval')
        kit.prism(A, col, 'hawse opening', [(x + a, y + b) for a, b in kit.stadium(.38, 1.9, 20)], floor + .28, floor + .31, 'dark')
        path = [(s * 3.3, -95.6), (s * 3.28, -92.5), (s * 3.28, -89.0), (s * 3.42, -85.5), (s * 3.55, -82.0), (s * 3.62, -79.0), (s * 3.55, -77.2), (s * 3.25, -76.3)]
        chain(kit, A, col, path)
        for (ax, az), (bx, bz) in zip(path, path[1:]):
            a, b = Vector(P(ax, 0, az)[:2]), Vector(P(bx, 0, bz)[:2])
            m = (a + b) / 2
            h = sup.below(m.x, m.y, 9)
            plate = kit.part('box', A, col, 'cable plate', (m.x, m.y, h), ((b - a).length + .05, 1.0, .06), 'naval')
            plate.rotation_euler = (0, 0, math.atan2(b.y - a.y, b.x - a.x))
        for sz in (-91.2, -84.2):
            x, y, z = P(s * 3.35, 0, sz)
            floor = sup.below(x, y, 9)
            kit.part('box', A, col, 'stopper', (x, y, floor + .14), (.38, .8, .28), 'naval')
            kit.part('rod', A, col, 'stopper lever', (x, y - s * .4, floor + .25), (x - .9, y - s * 1.1, floor + .08), .04, 'edge', vertices=6)
        # Windlass: gear housing, cable holder and brake handwheel (reference prism 6.68-7.58 m at x 3.1).
        W = f'windlass-{side}'
        x, y, z = P(s * 3.12, 0, -75.1)
        floor = sup.below(x, y, 9)
        kit.part('box', W, col, 'gear housing', (x, y, floor + .25), (1.6, 1.6, .5), 'naval')
        kit.cylz(W, col, 'cable holder', (x, y, floor + .45), .76, .45, 'naval', 24)
        kit.cylz(W, col, 'holder cap', (x, y, floor + .9), .42, .2, 'naval', 18)
        hx, hy, hz = P(s * 3.45, 0, -73.8)
        kit.part('rod', W, col, 'brake column', (hx, hy, floor), (hx, hy, floor + .55), .06, 'naval', vertices=8)
        kit.part('rod', W, col, 'brake handwheel', (hx - .03, hy, floor + .6), (hx + .03, hy, floor + .6), .22, 'edge', vertices=14)
        # Bower anchor housed in its hawse on the bow (reference cm005: 3.5 m high, 1.25 m across about z -100.1; the
        # hawse mouth painted at 6 m, z -99.6).
        anchor(kit, f'bower-anchor-{side}', col, s, (s * 3.2, 6.1, -99.6), (s * 3.35, 4.45, -100.4), 1.25)
        # Stern anchor in its hawse under the quarterdeck (reference cm005: 2.7 m high about x 5.05, z 96.7).
        anchor(kit, f'stern-anchor-{side}', col, s, (s * 5.0, 3.55, 96.3), (s * 5.1, 1.45, 97.05), .8)
    capstan(kit, 'capstan-forward', col, 0, -80.83, 6.75, .75)
    # The after capstan stands under No. 6 turret's barrels at full depression: 0.6 m lower than the reference's.
    capstan(kit, 'capstan-after', col, 0, 78.5, 4.06, .55, .3)


# ---------------------------------------------------------------- weather-deck fittings
def deck_fittings(kit, col):
    sup = kit.support
    for n, (kind, rx, ry, rz, size, bearing) in enumerate(DECK_FITTINGS):
        A = f'{kind.replace(" ", "-")}-{n}'
        x, y, _ = P(rx, 0, rz)
        floor = kit.floor(x, y, ry + .6)
        if floor is None or abs(floor - ry) > .6:
            continue
        w, l, h = size
        # Fittings under a turning gunhouse or the main barrels' full depression are cut down to clear them (as
        # Takao's ventilators under its gunhouses are); none stands in a light gun's working circle.
        kit._last_floor = floor
        ceiling = kit.sweep_ceiling(x, y)
        if ceiling is not None:
            if ceiling - floor < .15:
                continue
            h = min(h, ceiling - floor)
        rot = math.radians(bearing)
        parts = []
        if kind == 'mushroom vent':
            parts.append(kit.cylz(A, col, 'trunk', (x, y, floor), w * .3, h * .78, 'naval', 12))
            parts.append(kit.cylz(A, col, 'cap', (x, y, floor + h * .72), w * .5, h * .28, 'naval', 16, r2=w * .22))
            continue
        if kind == 'cowl vent':
            r = min(w, l) * .32
            kit.cylz(A, col, 'trunk', (x, y, floor), r, h * .7, 'naval', 14)
            kit.part('rod', A, col, 'cowl', (x, y, floor + h * .72), (x + math.cos(rot) * r * 1.2, y - math.sin(rot) * r * 1.2, floor + h * .82), r * 1.35, 'naval', vertices=14)
            kit.part('rod', A, col, 'cowl mouth', (x + math.cos(rot) * r * 1.2, y - math.sin(rot) * r * 1.2, floor + h * .82),
                     (x + math.cos(rot) * r * 1.3, y - math.sin(rot) * r * 1.3, floor + h * .83), r * 1.2, 'dark', vertices=14)
            continue
        if kind == 'bitts':
            kit.part('box', A, col, 'bed plate', (x, y, floor + .05), (l, w, .1), 'naval')
            r = min(w, l / 2) * .32
            for t in (-1, 1):
                kit.cylz(A, col, 'bitt', (x + t * l * .27, y, floor), r, h, 'naval', 14)
                kit.cylz(A, col, 'bitt cap', (x + t * l * .27, y, floor + h), r * 1.25, .06, 'naval', 14)
        elif kind == 'fairlead':
            kit.part('box', A, col, 'base', (x, y, floor + .1), (l, w, .2), 'naval')
            for t in (-1, 1):
                kit.cylz(A, col, 'roller', (x + t * l * .25, y, floor + .2), min(w, l) * .22, h - .2, 'naval', 12)
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
        elif kind == 'reel':
            r = min(h, max(w, l)) * .45
            along_x = l >= w
            a, b = ((x - l * .4, y), (x + l * .4, y)) if along_x else ((x, y - w * .4), (x, y + w * .4))
            kit.part('rod', A, col, 'reel drum', (a[0], a[1], floor + r + .05), (b[0], b[1], floor + r + .05), r * .7, 'black', vertices=14)
            for p in (a, b):
                kit.part('rod', A, col, 'reel flange', (p[0] - .02, p[1], floor + r + .05) if along_x else (p[0], p[1] - .02, floor + r + .05),
                         (p[0] + .02, p[1], floor + r + .05) if along_x else (p[0], p[1] + .02, floor + r + .05), r, 'naval', vertices=16)
                kit.part('box', A, col, 'reel stand', (p[0], p[1], floor + (r + .05) / 2), (.08, .08, r + .05), 'naval')


def crest_and_staffs(kit, col):
    # Gold chrysanthemum on the stem at 6.48 m (reference jm306/jm307), seated on this loft's stem by a ray from ahead.
    # The disc lies on the raked stem: its face is square to the line between the stem's points 0.42 m above and
    # below the crest's centre.
    hi = kit.hit(P(.01, 6.9, -115), (-1, 0, 0), 12)
    lo = kit.hit(P(.01, 6.06, -115), (-1, 0, 0), 12)
    if hi and lo:
        a, b = Vector(hi[0]), Vector(lo[0])
        tangent = (a - b).normalized()
        normal = Vector((tangent.z, 0, -tangent.x))
        if normal.x < 0:
            normal = -normal
        centre = (a + b) / 2 + normal * .05
    else:
        centre, normal = Vector(P(0, 6.48, -106.6)), Vector((1, 0, 0))
    kit.part('rod', 'chrysanthemum', col, 'crest', tuple(centre - normal * .12), tuple(centre + normal * .07), .42, 'gold', vertices=16)
    across = Vector((0, 1, 0))
    up = normal.cross(across).normalized()
    for i in range(16):
        ang = math.tau * i / 16
        p = centre + normal * .07 + (across * math.cos(ang) + up * math.sin(ang)) * .33
        petal = kit.part('box', 'chrysanthemum', col, 'petal', tuple(p), (.06, .12, .12), 'gold')
        petal.rotation_euler = normal.to_track_quat('X', 'Z').to_euler()
    x, y, z = P(0, 7.5, -106.2)
    kit.part('rod', 'jackstaff', col, 'staff', (x, y, z), (x, y, z + 7.2), .05, 'naval', vertices=8)
    kit.cylz('jackstaff', col, 'step', (x, y, z - .02), .14, .3, 'naval', 12)


def portholes(kit, col):
    """Rimmed portholes the reference paints on its hull sides (fuso_fittings.PORTHOLES), seated on this loft on
    both sides by a ray from outboard at each datum."""
    rows = []
    for z, y, dia in PORTHOLES:
        for s in (-1, 1):
            direction = Vector((0, s, 0))
            hit = kit.hit(P(s * 20, y, z), direction, 22)
            if not hit:
                continue
            loc, nrm = hit
            nrm = Vector(nrm)
            if nrm.dot(direction) > 0:
                nrm = -nrm
            rows.append(('port', -loc.y, loc.z, -loc.x, dia, dia, -nrm.y, -nrm.x))
    kit.windows('hull-portholes', col, rows)


# ---------------------------------------------------------------- screws, shafts, bossings, brackets and rudders
def screw(kit, id, col, hub, pitch_hand, R=1.68):
    """Three-bladed screw on a tapered boss; blades lofted with pitch and skew."""
    hx, hy, hz = hub
    kit.part('rod', id, col, 'boss', (hx + .55, hy, hz), (hx - .5, hy, hz), .36, 'bronze', vertices=16, r2=.2)
    root, pitch = .34, 3.7
    for k in range(3):
        base = k * math.tau / 3
        vv = []
        radii = [root + (R - root) * i / 6 for i in range(7)]
        for r in radii:
            f = (r - root) / (R - root)
            chord = 1.3 * math.sqrt(max(0, 1 - (f - .45) ** 2 / .62 ** 2)) + .18
            phi = math.atan(pitch / (math.tau * r))
            skew = .35 * f * f
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
                ff.append((a, a + 1, b + 1, b))
                ff.append((a + 4 + 1, a + 4, b + 4, b + 4 + 1))
            ff.append((i * n, (i + 1) * n, (i + 1) * n + 4, i * n + 4))
            ff.append((i * n + 3 + 4, (i + 1) * n + 3 + 4, (i + 1) * n + 3, i * n + 3))
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
    """Balanced rudder behind an inner screw: a lofted foil 0.7 m thick at 30 % chord over the reference's outline
    (6.9 m long, 5.2 to 9.3 m deep, the trailing edge raked forward at its foot)."""
    zs = [85.0, 85.25, 85.9, 86.8, 87.8, 88.8, 89.8, 90.6, 91.3, 91.9]
    top = [-5.3, -5.2, -5.15, -5.1, -5.05, -5.02, -5.0, -5.0, -5.02, -5.1]
    bot = [-5.3, -8.4, -9.0, -9.25, -9.3, -9.25, -9.1, -8.6, -7.6, -6.0]
    c0, c1 = zs[0], zs[-1]
    vv = []
    for z, yt, yb in zip(zs, top, bot):
        u = (z - c0) / (c1 - c0)
        f = 1.4845 * math.sqrt(u) - .63 * u - 1.758 * u * u + 1.4215 * u ** 3 - .5075 * u ** 4
        t = max(.02, .35 * f / .5)
        for sx, yy in ((-1, yb), (1, yb), (1, yt), (-1, yt)):
            vv.append(P(rx + sx * t, yy, z))
    n = len(zs)
    ff = [(4 * i + j, 4 * i + (j + 1) % 4, 4 * (i + 1) + (j + 1) % 4, 4 * (i + 1) + j) for i in range(n - 1) for j in range(4)]
    ff += [(3, 2, 1, 0), (4 * (n - 1), 4 * (n - 1) + 1, 4 * (n - 1) + 2, 4 * (n - 1) + 3)]
    kit.tag(kit.mesh(id + '.blade', vv, ff, 'antifouling', col), id)
    x, y, z = P(rx, -5.2, 87.2)
    hull = kit.support.along((x, y, z), (0, 0, 1), 4.0).z
    kit.part('rod', id, col, 'stock', (x, y, z - .1), (x, y, hull + .2), .2, 'antifouling', vertices=12)


def screws_and_rudders(kit, col):
    sup = kit.support
    # Screws at the reference propeller datums; shafts run forward inside tapered bossings to the hull.
    # Reference propeller datums (cm001/cm032 hubs) and the bossings' extent from profile cuts, reference z.
    for id, (rx, ry, rz_), (bz0, bz1) in [('screw-1', (-6.16, -7.30, 78.66), (63.1, 77.3)), ('screw-2', (-2.79, -6.87, 83.19), (67.2, 81.8)),
                                         ('screw-3', (2.79, -6.87, 83.19), (67.2, 81.8)), ('screw-4', (6.16, -7.30, 78.66), (63.1, 77.3))]:
        x, y, z = P(rx, ry, rz_)
        screw(kit, id, col, (x, y, z), 1 if rx < 0 else -1)
        tail = P(rx, ry, bz1)
        kit.part('rod', id, col, 'shaft', (x + .5, y, z), tail, .22, 'edge', vertices=12)
        # Bossing: a long streamlined fairing round the shaft, faired into the bottom forward.
        head = P(rx, ry + .55, bz0)
        kit.part('rod', id, col, 'bossing', tail, head, .5, 'antifouling', vertices=16, r2=.62)
        kit.part('rod', id, col, 'bossing cap', tail, P(rx, ry, bz1 + .45), .5, 'antifouling', vertices=16, r2=.27)
        # Where the bossing's head stands clear of the bottom, a web joins it to the hull above.
        try:
            top = sup.along(head, (0, 0, 1), 3.0).z
            if top - head[2] > .05:
                kit.part('rod', id, col, 'bossing root', head, (head[0], head[1], top + .2), .45, 'antifouling', vertices=12)
        except ValueError:
            pass
        # A strut bracket just forward of the screw.
        bx, by, bz = P(rx, ry, rz_ - 2.1)
        foot = sup.below(bx, by * .7, bz + 4)
        kit.part('rod', id, col, 'bracket', (bx, by, bz), (bx, by * .7, foot + .05), .13, 'antifouling', vertices=8)
        kit.part('rod', id, col, 'bracket boss', (bx + .45, by, bz), (bx - .45, by, bz), .3, 'antifouling', vertices=12)
    for id, rx in [('rudder-port', -2.8), ('rudder-starboard', 2.8)]:
        rudder(kit, id, col, rx)
    skeg(kit, col)


def skeg(kit, col):
    """Centreline skeg: the reference keeps its bottom at 9.83 m on the centreline from 56 to 74 m aft of midships
    while the hull above rises, then steps up at a near-vertical after edge. A fin 0.5 m thick from the keel line
    into the hull."""
    A = 'skeg'
    zs = [52.5, 56.0, 60.0, 64.0, 68.0, 71.5, 74.2]          # runtime z
    vv, rows = [], []
    for i, z in enumerate(zs):
        x = -z
        hit = kit.hit((x, 0.0, -12.0), (0, 0, 1), 8)
        top = (hit[0].z if hit else -7.0) + .45
        bottom = -9.72 if i == 0 else -9.83
        half = .06 if i == 0 else .25
        k = len(vv)
        vv += [(x, -half, bottom), (x, half, bottom), (x, half, top), (x, -half, top)]
        rows.append(k)
    ff = []
    for a, b in zip(rows, rows[1:]):
        ff += [(a + j, b + j, b + (j + 1) % 4, a + (j + 1) % 4) for j in range(4)]
    ff += [(rows[0] + 3, rows[0] + 2, rows[0] + 1, rows[0]), (rows[-1], rows[-1] + 1, rows[-1] + 2, rows[-1] + 3)]
    ob = kit.mesh(A + '.fin', vv, ff, 'antifouling', col)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
    kit.tag(ob, A)


# ---------------------------------------------------------------- deck-edge rails
def deck_edge_rails(D, kit, col):
    H = D['hull']
    L = H['length']
    secs = H['sections']

    def outer(points):
        # The deck edge: the outermost point at the deck's height (aft of the forecastle the upper points close the
        # deck to the centreline, so the last point is not the edge).
        top = points[-1][1]
        return max((p for p in points if p[1] >= top - .05), key=lambda p: p[0])

    def edge(station):
        for a, b in zip(secs, secs[1:]):
            if a['station'] <= station <= b['station']:
                t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
                pa, pb = outer(a['points']), outer(b['points'])
                return pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t
        return outer(secs[-1]['points'])
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

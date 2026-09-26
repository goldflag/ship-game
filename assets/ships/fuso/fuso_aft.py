"""Fusō after region: the after control tower and mainmast (reference z 34 to 50), the quarterdeck's aircraft
installation and the stern.

Owns the after director (which trains), the 4.5 m rangefinders, periscopes, searchlight controls and lamps on the
tower, the mainmast (lower mast, topmast, pole, yard, gaff and stays) over the lookout top with the aerials it
carries to the funnel, the pagoda and the stern staff, the catapult on its turntable, the stowed aircraft crane on
the port quarter's sponson, the linoleum aircraft deck's brass strips and trolley rails, and rails round the
tower's roofs. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from fuso_kit import P, ZC, LINOLEUM_EDGE, BRASS_STRIPS
from fuso_fittings import SMALL_FITTINGS

CLAIMED_STRUCTURES = set()


def zone(x, y, z):
    """Runtime point inside the after tower region."""
    return 34 < z < 51 and y > 8.9


def build(D, kit):
    masts = kit.cols['Sensors and masts']
    sup = kit.cols['Superstructure']
    air = kit.cols['Boats and aviation']
    structures = [s for s in D['structures'] if s['id'] != 'funnel']
    after_director(kit, masts)
    # The 4.5 m rangefinders (jf009) are enclosed houses 2.26 m across on short pedestals, their tubes fore and aft.
    for id, ref, bearing in [('rf-after-port', (-3.859, 20.682, 38.808), -90), ('rf-after-starboard', (3.869, 20.684, 38.792), 90)]:
        kit.rangefinder_house(id, ref, 4.9, bearing, masts, radius=1.13, pedestal=.45, height=.8, tube=.42, arm=(.42, .46))
    periscopes(kit, masts)
    tower_glazing(kit, sup)
    tower_gear(kit, masts)
    lookout_top(kit, sup)
    mainmast(kit, masts)
    catapult(kit, air)
    crane(kit, air)
    aircraft_deck(kit, kit.cols['Deck fittings'])
    kit.roof_rails('after-tower-rails', sup, structures, zone)
    kit.overhang_knees('after-tower-knees', sup, structures, zone)


def after_director(kit, col):
    """After director (reference HP_JD_4, a Type 91 house facing aft) in its well in the tower roof; it trains."""
    from fuso_pagoda import type91_director
    x, y, z = P(0, 24.375, 47.201)
    moving = type91_director(kit, 'after-director', (0, 24.375, 47.201), col, facing=180)
    radar_pivot('after-director.yaw', (x, y, z - .8), moving)


def periscopes(kit, col):
    """Director periscope houses on the tower roof (reference jf027 pair and jf026, part bounds and cuts): the pair
    are round houses 2.4 m across from their floor plate at 24.62 m to flat roofs at 26.0 m, doors outboard; the after
    one is a round house 2.76 m across to 26.18 m with the periscope's hood on its roof, a rail round the roof and the
    hood's curved pipe down its forward side."""
    for id, (rx, rz), s in [('periscope-port', (-1.734, 39.28), -1), ('periscope-starboard', (1.722, 39.28), 1)]:
        x, y, z = P(rx, 24.62, rz)
        floor = kit.floor(x, y, 24.9)
        base = 24.62 if floor is None or abs(floor - 24.62) > .3 else floor
        kit.cylz(id, col, 'house', (x, y, base), 1.2, 1.32, 'naval', 28)
        kit.cylz(id, col, 'roof', (x, y, base + 1.32), 1.23, .05, 'roof', 28)
        kit.cylz(id, col, 'roof hatch', (x, y, base + 1.37), .35, .08, 'naval', 12)
        # Door on the outboard face and a sighting port forward.
        door = Vector((x, y, base + .75))
        out = Vector((0, -s, 0))
        kit.beam(id, col, 'door', door + out * 1.18, door + out * 1.23, .7, 1.2, 'painted-edge')
        fwd = Vector((1, 0, 0))
        port = Vector((x, y, base + 1.0))
        kit.beam(id, col, 'sighting port', port + fwd * 1.18, port + fwd * 1.22, .45, .2, 'dark')
    A = 'periscope-after'
    rx, rz = -0.009, 43.845
    x, y, z = P(rx, 24.62, rz)
    floor = kit.floor(x, y, 24.9)
    base = 24.62 if floor is None or abs(floor - 24.62) > .3 else floor
    kit.cylz(A, col, 'house', (x, y, base), 1.38, 1.56, 'naval', 32)
    top = base + 1.56
    kit.cylz(A, col, 'roof', (x, y, top), 1.41, .05, 'roof', 32)
    # Two tall periscope windows on each after quarter and a small one on each side (the reference's painted house).
    for ang in (-150, -120, 120, 150, -90, 90):
        a = math.radians(ang)
        d = Vector((math.cos(a), math.sin(a), 0))
        tall = abs(ang) > 100
        w = Vector((x, y, base + (.95 if tall else 1.05)))
        kit.beam(A, col, 'window', w + d * 1.37, w + d * 1.41, .4 if tall else .34, .8 if tall else .34, 'glass')
    # The periscope's hood on the roof: a box with its sloped face forward.
    hx, hy, _ = P(0, 0, 44.0)
    vv = [(hx - .33, hy - .28, top + .05), (hx + .33, hy - .28, top + .05), (hx + .33, hy + .28, top + .05), (hx - .33, hy + .28, top + .05),
          (hx - .33, hy - .28, top + .62), (hx + .05, hy - .28, top + .62), (hx + .05, hy + .28, top + .62), (hx - .33, hy + .28, top + .62)]
    ff = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = kit.mesh(A + '.hood', vv, ff, 'naval', col)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
    kit.tag(ob, A)
    kit.part('box', A, col, 'hood glass', (hx + .21, hy, top + .42), (.3, .4, .02), 'glass').rotation_euler = (0, math.radians(-55), 0)
    # Curved pipe from the hood over the house's forward edge and down to the tower roof.
    pts = [P(0, 26.75, 44.05), P(0, 27.45, 43.75), P(0, 27.6, 43.2), P(0, 27.4, 42.45), P(0, 26.9, 42.3), P(0, 24.36, 42.3)]
    kit.polyline(A, col, pts, .1, 'naval', 10)
    # Rail round the roof.
    ring = [(x + 1.3 * math.cos(t), y + 1.3 * math.sin(t)) for t in [math.tau * i / 16 for i in range(16)]]
    kit.rail(A, col, ring, top + .05, .95, 1.1, closed=True, check=False)


def tower_glazing(kit, col):
    """The two large windows the reference paints on each side of the tower's upper deckhouse (textured side render:
    1.2 m by 0.6 m at 23.25-23.85 m, runtime z 41.9-43.1 and 46.0-47.2), cast onto this model's walls."""
    rows = []
    for z0, z1 in ((41.93, 43.13), (46.0, 47.2)):
        zc = (z0 + z1) / 2
        for s in (-1, 1):
            hit = kit.hit((-zc, -s * 8, 23.55), (0, s, 0), 7)
            if hit and abs(hit[1].y) > .7:
                loc, nrm = hit
                rows.append(('window', -loc.y, 23.55, -loc.x, z1 - z0, .6, -nrm.y, -nrm.x))
    kit.windows('after-tower-glazing', col, rows)


def tower_gear(kit, col):
    for n, (kind, rx, ry, rz, (w, l, h)) in enumerate(SMALL_FITTINGS):
        if not 34 < rz - ZC < 51 or ry < 8.9:
            continue
        A = f'after-{kind.replace(" ", "-")}-{n}'
        x, y, z = P(rx, ry, rz)
        if kind == 'signal lamp':
            kit.lamp(A, col, x, y, ry, h, .12)
            continue
        floor = kit.floor(x, y, ry + .3)
        if floor is None or abs(floor - ry) > .6:
            continue
        base = floor
        if kind == 'searchlight':
            kit.searchlight(A, (rx, base, rz), col)
        elif kind in ('binocular', 'binocular pair', 'searchlight control'):
            kit.cylz(A, col, 'pedestal', (x, y, base), .07, max(.6, h * .72), 'naval', 8)
            top = base + max(.6, h * .72)
            kit.part('box', A, col, 'binocular', (x, y, top + .1), (.3, .45 if kind == 'binocular' else .7, .2), 'edge')
        elif kind == 'deck lamp':
            kit.lamp(A, col, x, y, base, h, .15)


def mainmast(kit, col):
    """Pole mainmast measured on the orthographic side render and the reference's centreline section: a lower mast
    0.5 m across from the tower's mast house to 40 m, a topmast to its trucks at 51.1 m and a pole to 55.1 m, the
    yard at 47.7 m, the gaff to the ensign datum, stays to the tower, and the aerials."""
    A = 'mainmast'
    foot = P(0, 25.9, 40.4)
    head = P(0, 40.3, 40.4)
    kit.part('rod', A, col, 'lower mast', foot, head, .26, 'black', vertices=16, r2=.2)
    kit.part('rod', A, col, 'mast band', P(0, 38.2, 40.4), P(0, 38.5, 40.4), .25, 'black', vertices=16)
    # The topmast runs on to its trucks at 51.06 and 51.26 m, with the reference's thin pole above them to 55.06 m.
    kit.part('rod', A, col, 'topmast', P(0, 38.2, 40.85), P(-.115, 51.1, 41.073), .12, 'black', vertices=10, r2=.055)
    for ty in (51.06, 51.26):
        kit.cylz(A, col, 'truck', P(-.115, ty, 41.073), .215, .1, 'black', 12)
    kit.part('rod', A, col, 'pole', P(-.115, 51.1, 41.073), P(-.115, 55.06, 41.073), .04, 'black', vertices=6, r2=.025)
    kit.part('rod', A, col, 'topmast heel', P(0, 38.2, 40.4), P(0, 38.2, 40.85), .12, 'black', vertices=10)
    kit.part('rod', A, col, 'cap', P(0, 40.2, 40.4), P(0, 40.2, 40.85), .14, 'black', vertices=10)
    kit.part('rod', A, col, 'yard', P(-3.9, 47.72, 40.97), P(3.9, 47.72, 40.97), .06, 'black', vertices=8, r2=.04)
    kit.part('rod', A, col, 'gaff', P(0, 36.4, 40.65), P(0, 39.55, 46.25), .08, 'black', vertices=8, r2=.05)
    kit.part('rod', A, col, 'crosstree', P(-1.1, 40.0, 40.6), P(1.1, 40.0, 40.6), .05, 'black', vertices=6)
    # Stays from the crosstree and the topmast to the tower roof and the lookout top's edge.
    for s in (-1, 1):
        kit.wire(A, col, P(s * 1.1, 40.0, 40.6), P(s * 4.2, 28.1, 38.3), .018, check=False)
        kit.wire(A, col, P(s * 1.1, 40.0, 40.6), P(s * 4.0, 28.1, 42.8), .018, check=False)
        kit.wire(A, col, P(-.08 * s, 49.5, 41.0), P(s * 3.9, 47.72, 40.97), .012, check=False)
    kit.wire(A, col, P(0, 39.55, 46.25), P(0, 46.0, 41.0), .014, check=False)
    kit.wire(A, col, P(0, 38.0, 45.6), P(0, 24.6, 48.9), .014, check=False)
    # Aerials the reference's orthographic side render traces: from the lower mast at 36.45 m forward over the
    # funnel, sagging to 35.5 m, to the pagoda's top platform; a vee from the same point down to the funnel's after
    # rim and from its forward rim up to the pagoda's upper tier; and the backstay from the trucks to the stern staff.
    mast = P(0, 36.45, 40.4)
    kit.polyline(A, col, [mast, P(0, 35.86, 29.1), P(0, 35.5, 21.4), P(0, 35.68, 12.4), P(0, 36.67, -1.1), P(0, 37.85, -10.1),
                          P(0, 39.29, -17.8), P(0, 40.55, -25.0)], .015, 'edge', 3)
    kit.wire(A, col, mast, P(0, 23.8, 12.75), .015, check=False)
    kit.wire(A, col, P(0, 23.8, 6.6), P(0, 28.6, -24.8), .015, check=False)
    kit.wire(A, col, P(-.115, 51.2, 41.073), P(0, 6.9, 104.8), .015, check=False)
    # Ensign staff on the stern (reference centreline section: 3.98 to 8.87 m at z 104.8).
    x, y, _ = P(0, 0, 104.85)
    floor = kit.floor(x, y, 5.0)
    base = 3.98 if floor is None else floor
    kit.part('rod', A, col, 'stern staff', P(0, base - .02, 104.85), P(0, 8.87, 104.75), .05, 'naval', vertices=8, r2=.035)


def catapult(kit, col):
    """Type 2-style catapult (reference HP_JC_1): a lattice girder 19.8 m long on a pedestal turntable, trained
    fore and aft at rest, with its trolley rails and launching cradle."""
    A = 'catapult'
    x, y, z = P(2.997, 3.957, 92.951)
    floor = kit.floor(x, y, 4.5)
    base = z if floor is None else floor
    kit.cylz(A, col, 'turntable', (x, y, base), 1.45, .3, 'naval', 32)
    kit.cylz(A, col, 'pedestal', (x, y, base + .3), .9, 1.3, 'naval', 24, r2=.75)
    kit.cylz(A, col, 'pivot cap', (x, y, base + 1.6), 1.05, .2, 'naval', 24)
    top = base + 2.35
    fwd, aft = x + 10.4, x - 9.4          # reference visual 19.8 m, pivot 9.4 m from its after end
    for s in (-1, 1):
        kit.member(A, col, (aft, y + s * .55, top), (fwd, y + s * .45, top - .2), .07, 'naval', 6)
        kit.member(A, col, (aft, y + s * .55, top - .75), (fwd, y + s * .45, top - .75), .06, 'naval', 6)
        n = 16
        for i in range(n):
            a = aft + (fwd - aft) * i / n
            b = aft + (fwd - aft) * (i + 1) / n
            za, zb = top - .2 * i / n, top - .2 * (i + 1) / n
            kit.member(A, col, (a, y + s * .52, za - .75), (b, y + s * .52, zb), .03, 'naval', 4)
            kit.member(A, col, (a, y + s * .52, za - .75), (a, y + s * .52, za), .03, 'naval', 4)
    for i in range(0, 17, 2):
        a = aft + (fwd - aft) * i / 16
        kit.member(A, col, (a, y - .55, top - .1), (a, y + .55, top - .1), .035, 'naval', 4)
        kit.member(A, col, (a, y - .55, top - .8), (a, y + .55, top - .8), .03, 'naval', 4)
    # The deck plate spans the chords (it tapers with them, so it is laid on the after, higher half).
    kit.part('box', A, col, 'girder deck', (aft + (fwd - aft) * .3, y, top + .02), ((fwd - aft) * .6, 1.2, .08), 'naval')
    for s in (-1, 1):
        kit.part('box', A, col, 'rail', (aft + (fwd - aft) * .3, y + s * .22, top + .1), ((fwd - aft) * .6 - .2, .06, .08), 'edge')
    kit.part('box', A, col, 'launching cradle', (aft + 2.2, y, top + .36), (1.6, 1.0, .45), 'naval')
    kit.part('box', A, col, 'cradle chocks', (aft + 2.2, y, top + .62), (.9, 1.2, .1), 'edge')
    # Struts from the pedestal to the girder.
    for dx in (-1.2, 1.6):
        for s in (-1, 1):
            kit.member(A, col, (x + dx * .4, y + s * .5, base + 1.7), (x + dx, y + s * .5, top - .75), .07, 'naval', 6)


def crane(kit, col):
    """Aircraft crane stowed along the port deck edge (reference jm071 bounds and plan cuts): a lattice jib 18 m
    long from its heel post on the quarter's sponson forward to a rest at the deck edge."""
    A = 'aircraft-crane'
    heel = Vector(P(-6.6, 0, 92.6))
    tip = Vector(P(-9.85, 0, 75.3))
    floor = kit.floor(heel.x, heel.y, 4.3)
    base = 4.05 if floor is None else floor
    kit.cylz(A, col, 'heel post', (heel.x, heel.y, base), .42, .9, 'naval', 20)
    kit.cylz(A, col, 'heel cap', (heel.x, heel.y, base + .9), .5, .12, 'naval', 20)
    u = (tip - heel).normalized()
    v = Vector((-u.y, u.x, 0))
    # The jib tapers in depth from 0.6 m at the heel to 0.3 m at its outer end, where No. 6 turret's barrels at
    # full depression pass over it.
    lo = base + .12
    start = heel + u * .3
    length = (tip - start).length
    n = 14

    def hi(t):
        return base + .6 - .3 * t

    def at(t, side, width, zz):
        p = start + u * (length * t) + v * (side * width)
        return (p.x, p.y, zz)
    for s in (-1, 1):
        kit.member(A, col, at(0, s, .5, lo), at(1, s, .18, lo), .045, 'naval', 6)
        kit.member(A, col, at(0, s, .5, hi(0)), at(1, s, .18, hi(1)), .045, 'naval', 6)
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        w0, w1 = .5 - .32 * t0, .5 - .32 * t1
        for s in (-1, 1):
            kit.member(A, col, at(t0, s, w0, lo), at(t1, s, w1, hi(t1)), .025, 'naval', 4)
        kit.member(A, col, at(t0, -1, w0, hi(t0)), at(t0, 1, w0, hi(t0)), .025, 'naval', 4)
    tx, ty, _ = at(.97, 0, 0, 0)
    kit.part('rod', A, col, 'hook block', (tx, ty, hi(.97) - .02), (tx, ty, lo - .1), .12, 'black', vertices=10)
    # Chocks holding the jib on the deck.
    for t in (.25, .6, .92):
        cx, cy, _ = at(t, 0, 0, 0)
        f = kit.floor(cx, cy, lo)
        if f is not None and lo - f < 1.2:
            kit.part('box', A, col, 'chock', (cx, cy, (f + lo) / 2), (.25, .9, max(.05, lo - f)), 'naval')


def aircraft_deck(kit, col):
    """Brass strips across the linoleum aircraft deck (the reference's textured top render: every 1.393 m from runtime
    z 79.3 to the stern, stopping at the linoleum's chevron edge), brass edging along that edge, and two trolley rails
    from the catapult to the crane."""
    A = 'aircraft-deck'

    def deck_half(zr):
        x, y, _ = (-zr, 0, 0)
        for w in [v / 10 for v in range(130, 0, -2)]:
            if kit.floor(-zr, w, 4.3) is not None and kit.floor(-zr, -w, 4.3) is not None:
                return w - .35
        return None

    for zr in BRASS_STRIPS:
        floor = kit.floor(-zr, 0, 4.3)
        half = deck_half(zr)
        if floor is None or not half or half < 1:
            continue
        # Where the chevron crosses this station, the strip runs only outboard of it.
        inner = 0.0
        if zr < LINOLEUM_EDGE[0][1]:
            for (x0, z0), (x1, z1) in zip(LINOLEUM_EDGE, LINOLEUM_EDGE[1:]):
                if min(z0, z1) <= zr <= max(z0, z1) and z0 != z1:
                    inner = x0 + (x1 - x0) * (zr - z0) / (z1 - z0) + .05
        if inner <= 0:
            kit.part('box', A, col, 'brass strip', (-zr, 0, floor + .006), (.06, 2 * half, .012), 'gold')
        elif half - inner > .3:
            for s in (-1, 1):
                kit.part('box', A, col, 'brass strip', (-zr, s * (inner + half) / 2, floor + .006), (.06, half - inner, .012), 'gold')
    # Edging along the chevron.
    for (x0, z0), (x1, z1) in zip(LINOLEUM_EDGE, LINOLEUM_EDGE[1:]):
        for s in (-1, 1):
            n = max(1, int(math.hypot(x1 - x0, z1 - z0) / .5))
            for i in range(n):
                xa, za = x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n
                xb, zb = x0 + (x1 - x0) * (i + 1) / n, z0 + (z1 - z0) * (i + 1) / n
                half = deck_half((za + zb) / 2)
                if half is None or max(xa, xb) > half:
                    continue
                fa, fb = kit.floor(-za, -s * xa, 4.3), kit.floor(-zb, -s * xb, 4.3)
                if fa is None or fb is None or abs(fa - fb) > .05 or fa > 4.3 or fa < 3.8:
                    continue
                kit.beam(A, col, 'brass edging', (-za, -s * xa, fa + .006), (-zb, -s * xb, fb + .006), .06, .012, 'gold')
    for s in (-1, 1):
        a, b = P(s * .9 + 1.2, 0, 72.0), P(s * .9 + 1.2, 0, 101.5)
        fa, fb = kit.floor(a[0], a[1], 4.3), kit.floor(b[0], b[1], 4.3)
        if fa is not None and fb is not None:
            kit.part('box', A, col, 'trolley rail', ((a[0] + b[0]) / 2, a[1], (fa + fb) / 2 + .03), (abs(b[0] - a[0]), .07, .06), 'edge')


def lookout_top(kit, col):
    """The lookout top: the star-shaped plate at 27.98 m (the blueprint's platform) carried on six thin radial webs
    under its arms (reference plan cuts at 27.0-28.0 m: nothing but the mast and its collar below 27.1 m, the webs
    reaching out as the cuts rise), each 0.9 m deep at the collar tapering to the arm's tip."""
    A = 'lookout-top'
    plate = next(s for s in kit.D['structures'] if s['id'] == 'platform-170')
    cx, cz = 0.0, 40.4                       # the collar under the star's centre (runtime)
    pts = [tuple(p) for p in plate['footprint']]
    # The arm tips: the outline's points farther from the collar than both neighbours, beyond 2.5 m.
    dist = [math.hypot(px - cx, pz - cz) for px, pz in pts]
    tips = []
    for i, (px, pz) in enumerate(pts):
        if dist[i] > 2.5 and dist[i] >= dist[i - 1] and dist[i] >= dist[(i + 1) % len(pts)]:
            if not any(math.hypot(px - tx, pz - tz) < .8 for _, tx, tz in tips):
                tips.append((dist[i], px, pz))
    if len(tips) != 6:
        raise ValueError(f'lookout top: expected six arm tips, found {len(tips)}')
    under = plate['baseY'] - .005
    for d, px, pz in tips:
        ux, uz = (px - cx) / d, (pz - cz) / d
        a0 = (cx + ux * .55, cz + uz * .55)
        a1 = (px - ux * .15, pz - uz * .15)
        n = Vector((ux, -uz, 0)).normalized() * .035       # square to the web (authoring frame)
        quad = [(a0, 27.05), (a0, under), (a1, under), (a1, under - .1)]
        vv = [tuple(Vector((-z, -x, yy)) + n * sgn) for sgn in (-1, 1) for (x, z), yy in quad]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        ob = kit.mesh(A + '.web', vv, ff, 'naval', col)
        import bmesh
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
        kit.tag(ob, A)
        # Lightening holes through the web, where it is deep enough.
        for t, r in ((.3, .2), (.55, .13)):
            hx, hz = a0[0] + (a1[0] - a0[0]) * t, a0[1] + (a1[1] - a0[1]) * t
            depth = (under - 27.05) * (1 - t) + .1 * t
            c = Vector((-hz, -hx, under - depth / 2))
            kit.part('rod', A, col, 'lightening hole', tuple(c - n * 1.25), tuple(c + n * 1.25), r, 'dark', vertices=12)

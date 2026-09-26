"""Fusō after region: the after control tower and mainmast (reference z 34 to 50), the quarterdeck's aircraft
installation and the stern.

Owns the after director (which trains), the 4.5 m rangefinders, periscopes, searchlight controls and lamps on the
tower, the mainmast (lower mast, topmast, yard, gaff and stays) over the lookout top, the catapult on its
turntable, the stowed aircraft crane on the port quarter's sponson, the linoleum aircraft deck's brass strips and
trolley rails, and rails round the tower's roofs. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from fuso_kit import P, ZC
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
    for id, ref, bearing in [('rf-after-port', (-3.859, 20.682, 38.808), -90), ('rf-after-starboard', (3.869, 20.684, 38.792), 90)]:
        kit.rangefinder(id, ref, 4.5, 0, masts)
    periscopes(kit, masts)
    tower_gear(kit, masts)
    mainmast(kit, masts)
    catapult(kit, air)
    crane(kit, air)
    aircraft_deck(kit, kit.cols['Deck fittings'])
    kit.roof_rails('after-tower-rails', sup, structures, zone)
    kit.overhang_knees('after-tower-knees', sup, structures, zone)


def after_director(kit, col):
    """After director (reference HP_JD_4, Type 91 house facing aft) on the tower roof; it trains."""
    A = 'after-director'
    x, y, z = P(0, 24.375, 47.201)
    floor = kit.floor(x, y, 24.6)
    base = y if floor is None or abs(floor - y) > .8 else floor
    moving = [kit.cylz(A, col, 'seat', (x, y, base), .95, .22, 'naval', 28)]
    moving.append(kit.part('box', A, col, 'house', (x, y, base + 1.05), (2.2, 1.9, 1.62), 'naval'))
    moving.append(kit.part('box', A, col, 'house roof', (x, y, base + 1.89), (2.28, 1.98, .06), 'roof'))
    moving.append(kit.part('rod', A, col, 'rangefinder', (x + .45, y - 1.3, base + 1.4), (x + .45, y + 1.3, base + 1.4), .12, 'naval', vertices=12))
    for s in (-1, 1):
        moving.append(kit.part('box', A, col, 'rangefinder hood', (x + .45, y + s * 1.3, base + 1.4), (.35, .3, .32), 'naval'))
        moving.append(kit.part('box', A, col, 'port', (x - 1.12, y + s * .45, base + 1.3), (.03, .4, .24), 'glass'))
    radar_pivot('after-director.yaw', (x, y, base), moving)


def periscopes(kit, col):
    """Director periscopes on the tower roof (reference HP_JF_10-12): hooded heads on columns."""
    for id, ref in [('periscope-port', (-1.734, 24.635, 39.276)), ('periscope-starboard', (1.722, 24.635, 39.281)), ('periscope-after', (-0.009, 24.635, 43.994))]:
        x, y, z = P(*ref)
        floor = kit.floor(x, y, y + .3)
        base = y if floor is None or abs(floor - y) > .8 else floor
        kit.cylz(id, col, 'column', (x, y, base), .28, 1.05, 'naval', 16)
        kit.part('box', id, col, 'head', (x, y, base + 1.28), (.62, .5, .46), 'naval')
        kit.part('box', id, col, 'head window', (x + .32, y, base + 1.3), (.02, .34, .16), 'glass')


def tower_gear(kit, col):
    for n, (kind, rx, ry, rz, (w, l, h)) in enumerate(SMALL_FITTINGS):
        if not 34 < rz - ZC < 51 or ry < 8.9:
            continue
        A = f'after-{kind.replace(" ", "-")}-{n}'
        x, y, z = P(rx, ry, rz)
        floor = kit.floor(x, y, ry + .3)
        base = ry if floor is None or abs(floor - ry) > .6 else floor
        if kind == 'searchlight':
            kit.searchlight(A, (rx, base, rz), col)
        elif kind in ('binocular', 'binocular pair', 'searchlight control'):
            kit.cylz(A, col, 'pedestal', (x, y, base), .07, max(.6, h * .72), 'naval', 8)
            top = base + max(.6, h * .72)
            kit.part('box', A, col, 'binocular', (x, y, top + .1), (.3, .45 if kind == 'binocular' else .7, .2), 'edge')
        elif kind in ('signal lamp', 'deck lamp'):
            kit.part('box', A, col, 'lamp', (x, y, base + h / 2), (max(.2, l * .8), max(.2, w * .8), h), 'naval')
            kit.part('box', A, col, 'lens', (x + max(.1, l * .4) + .01, y, base + h * .6), (.02, max(.14, w * .6), h * .4), 'glass')


def mainmast(kit, col):
    """Pole mainmast measured on the orthographic side render: a lower mast 0.5 m across from the tower's mast
    house to 40 m, a topmast to the flagpole datum at 50.2 m, the yard at 47.7 m, the gaff to the ensign datum and
    stays to the tower."""
    A = 'mainmast'
    foot = P(0, 25.9, 40.4)
    head = P(0, 40.3, 40.4)
    kit.part('rod', A, col, 'lower mast', foot, head, .26, 'black', vertices=16, r2=.2)
    kit.part('rod', A, col, 'mast band', P(0, 38.2, 40.4), P(0, 38.5, 40.4), .25, 'black', vertices=16)
    kit.part('rod', A, col, 'topmast', P(0, 38.2, 40.85), P(-.108, 50.25, 41.06), .12, 'black', vertices=10, r2=.06)
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


def catapult(kit, col):
    """Type 2-style catapult (reference HP_JC_1): a lattice girder 19.8 m long on a pedestal turntable, trained
    fore and aft at rest, with its trolley rails and launching cradle."""
    A = 'catapult'
    x, y, z = P(2.997, 3.957, 92.951)
    floor = kit.floor(x, y, 4.5)
    base = y if floor is None else floor
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
    kit.part('box', A, col, 'girder deck', ((aft + fwd) / 2, y, top + .03), (fwd - aft, .5, .06), 'naval')
    for s in (-1, 1):
        kit.part('box', A, col, 'rail', ((aft + fwd) / 2, y + s * .22, top + .1), (fwd - aft - .2, .06, .08), 'edge')
    kit.part('box', A, col, 'launching cradle', (aft + 2.2, y, top + .35), (1.6, 1.0, .45), 'naval')
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
    lo, hi = base + .15, base + .85
    start = heel + u * .3
    length = (tip - start).length
    n = 14

    def at(t, side, width, zz):
        p = start + u * (length * t) + v * (side * width)
        return (p.x, p.y, zz)
    for s in (-1, 1):
        for zz in (lo, hi):
            kit.member(A, col, at(0, s, .5, zz), at(1, s, .18, zz), .045, 'naval', 6)
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        w0, w1 = .5 - .32 * t0, .5 - .32 * t1
        for s in (-1, 1):
            kit.member(A, col, at(t0, s, w0, lo), at(t1, s, w1, hi), .025, 'naval', 4)
        kit.member(A, col, at(t0, -1, w0, hi), at(t0, 1, w0, hi), .025, 'naval', 4)
    tx, ty, _ = at(1, 0, 0, 0)
    kit.part('rod', A, col, 'hook block', (tx, ty, hi), (tx, ty, lo - .15), .14, 'black', vertices=10)
    # Chocks holding the jib on the deck.
    for t in (.25, .6, .92):
        cx, cy, _ = at(t, 0, 0, 0)
        f = kit.floor(cx, cy, lo)
        if f is not None and lo - f < 1.2:
            kit.part('box', A, col, 'chock', (cx, cy, (f + lo) / 2), (.25, .9, max(.05, lo - f)), 'naval')


def aircraft_deck(kit, col):
    """Brass strips across the linoleum aircraft deck and two trolley rails from the catapult to the crane."""
    A = 'aircraft-deck'
    for i in range(22):
        zr = 71.4 + i * 1.5
        x, y, _ = P(0, 0, zr)
        floor = kit.floor(x, y, 4.3)
        if floor is None:
            continue
        half = None
        for w in [v / 10 for v in range(130, 0, -2)]:
            if kit.floor(x, y + w, 4.3) is not None and kit.floor(x, y - w, 4.3) is not None:
                half = w - .35
                break
        if half and half > 1:
            kit.part('box', A, col, 'brass strip', (x, y, floor + .006), (.06, 2 * half, .012), 'gold')
    for s in (-1, 1):
        a, b = P(s * .9 + 1.2, 0, 72.0), P(s * .9 + 1.2, 0, 101.5)
        fa, fb = kit.floor(a[0], a[1], 4.3), kit.floor(b[0], b[1], 4.3)
        if fa is not None and fb is not None:
            kit.part('box', A, col, 'trolley rail', ((a[0] + b[0]) / 2, a[1], (fa + fb) / 2 + .03), (abs(b[0] - a[0]), .07, .06), 'edge')

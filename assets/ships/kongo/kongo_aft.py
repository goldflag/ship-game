"""Kongō after region: reference z +10 to the stern above the forecastle and quarterdeck.

Owns the after control tower's director and rangefinder pods, the windows painted on the
midships and after superstructure, the aircraft deck's catapult, brass strips, trolley rails
and turntables, the boat ramp on the port quarter and the after cutters. Datums are
reference-frame measurements converted by `P`.
"""
import math
from blender_rig import radar_pivot
from kongo_kit import P
from kongo_windows import WINDOWS

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()


def build(D, kit):
    cols = kit.cols
    masts = cols['Sensors and masts']
    boats = cols['Boats and aviation']
    after_director(kit, masts)
    rangefinder_pods(kit, masts)
    kit.windows('superstructure-windows', cols['Superstructure'], WINDOWS['amidships'])
    catapult(kit, boats)
    aircraft_deck(kit, boats)
    boat_ramp(kit, cols['Deck fittings'])
    kit.open_boat('cutter-3', (-9.715, 46.46), 9.1, 2.4, 4.55, 1.22, boats, chocks=(.15, .5, .85))
    kit.open_boat('cutter-4', (9.435, 46.44), 9.1, 2.4, 4.55, 1.22, boats, chocks=(.15, .5, .85))


def octagon(cx, cz, r):
    """Plan octagon about a reference (x, z) centre, authoring-frame points."""
    return [P(cx + r * math.cos(math.radians(22.5 + 45 * i)), 0, cz + r * math.sin(math.radians(22.5 + 45 * i)))[:2] for i in range(8)]


# ---------------------------------------------------------------- after control tower
def after_director(kit, col):
    """Type 94 director on the tower's drum: an octagonal housing that trains with its sight face aft."""
    A = 'after-director'
    cz = 13.194
    x, y, z = P(0, 16.754, cz)
    moving = [kit.cylz(A, col, 'training ring', (x, y, z), 1.55, .12, 'edge', 32)]
    moving.append(kit.prism(A, col, 'housing', octagon(0, cz, 1.5), z + .12, 19.5, 'naval', 'roof'))
    moving.append(kit.cylz(A, col, 'roof cap', (x, y, 19.5), 1.3, .24, 'naval', 16))
    for s in (-1, 1):
        moving.append(kit.part('box', A, col, 'side hood', P(s * 1.56, 18.45, cz), (1.2, .35, .9), 'naval'))
        moving.append(kit.part('box', A, col, 'hood slit', P(s * 1.74, 18.6, cz), (.8, .02, .16), 'glass'))
    moving.append(kit.part('box', A, col, 'sight box', P(0, 18.6, cz + 1.6), (.45, 1.2, .6), 'naval'))
    moving.append(kit.part('box', A, col, 'sight slit', P(0, 18.7, cz + 1.83), (.02, .9, .16), 'glass'))
    ring = [P(1.22 * math.cos(math.tau * i / 10), 0, cz + 1.22 * math.sin(math.tau * i / 10)) for i in range(10)]
    for i in range(10):
        a, b = ring[i], ring[(i + 1) % 10]
        moving.append(kit.part('rod', A, col, 'rail stanchion', (a[0], a[1], 19.74), (a[0], a[1], 20.64), .02, 'edge', vertices=5))
        for h in (20.2, 20.64):
            moving.append(kit.part('rod', A, col, 'rail', (a[0], a[1], h), (b[0], b[1], h), .016, 'edge', vertices=5))
    radar_pivot('after-director.yaw', (x, y, z), moving)


def rangefinder_pods(kit, col):
    """The two after rangefinders: drums on the tower's wings with hooded housings and 5 m arms."""
    for s in (-1, 1):
        A = f'rf-after-{"port" if s < 0 else "starboard"}'
        cx, cz = s * 2.6, 16.25
        x, y, _ = P(cx, 0, cz)
        floor = kit.support.below(x, y, 15.6)
        kit.cylz(A, col, 'drum', (x, y, floor), 1.25, 16.5 - floor, 'naval', 24)
        kit.cylz(A, col, 'collar', (x, y, 16.45), 1.32, .14, 'naval', 24)
        kit.prism(A, col, 'hood', octagon(cx, cz, 1.18), 16.59, 17.6, 'naval', 'roof')
        kit.part('rod', A, col, 'rangefinder', P(s * .2, 16.95, cz), P(s * 5.0, 16.95, cz), .17, 'naval', vertices=14)
        for ex in (.35, 4.85):
            kit.part('box', A, col, 'end hood', P(s * ex, 16.95, cz), (.5, .45, .5), 'naval')
        for dx in (-.35, .35):
            kit.part('box', A, col, 'window', P(cx + dx, 17.12, cz + 1.12), (.03, .3, .3), 'glass')


# ---------------------------------------------------------------- aircraft deck
def catapult(kit, col):
    """Powder catapult: a tapered girder with lightened side plates on a turntable, and the
    launching cradle's A-frames."""
    A = 'catapult'
    x, y, z = P(0, 6.618, 50.157)
    kit.cylz(A, col, 'turntable', (x, y, z - .02), 1.78, .13, 'naval', 40)
    kit.cylz(A, col, 'pivot', (x, y, z + .1), .7, .5, 'naval', 20)

    def bottom(zr):
        return 6.85 if zr > 45 else 6.85 + (45 - zr) / 7.7 * .75
    top = 8.05
    zs = [37.3 + i * (57.14 - 37.3) / 16 for i in range(17)]
    for s in (-1, 1):
        # Side plate as a thin lofted strip.
        vv = []
        for zr in zs:
            for t in (-.02, .02):
                vv += [P(s * (.6 + t), bottom(zr), zr), P(s * (.6 + t), top, zr)]
        n = len(zs)
        ff = []
        for i in range(n - 1):
            a, b = 4 * i, 4 * (i + 1)
            ff += [(a, b, b + 1, a + 1), (a + 3, b + 3, b + 2, a + 2), (a + 1, b + 1, b + 3, a + 3), (a + 2, b + 2, b, a)]
        ff += [(0, 1, 3, 2), (4 * (n - 1) + 2, 4 * (n - 1) + 3, 4 * (n - 1) + 1, 4 * (n - 1))]
        if s < 0:
            ff = [tuple(reversed(f)) for f in ff]
        kit.tag(kit.mesh(A + '.side plate', vv, ff, 'naval', col), A)
        for a, b in zip(zs, zs[1:]):
            m = (a + b) / 2
            h = (bottom(m) + top) / 2
            kit.member(A, col, P(s * .58, h, m), P(s * .66, h, m), min(.24, (top - bottom(m)) * .3), 'dark', 8)
        kit.member(A, col, P(s * .6, top, 37.3), P(s * .6, top, 57.14), .06, 'naval', 4)
        kit.member(A, col, P(s * .35, top + .03, 37.3), P(s * .35, top + .03, 57.14), .04, 'naval', 4)
    # Launching carriage and the cradle's A-frames.
    kit.part('box', A, col, 'carriage', P(0, top + .12, 50.15), (3.9, 1.3, .25), 'naval')
    for zf in (49.0, 52.0):
        for s in (-1, 1):
            kit.member(A, col, P(s * .55, top + .24, zf), P(0, 10.1, zf), .05, 'naval', 6)
    kit.member(A, col, P(0, 10.1, 49.0), P(0, 10.1, 52.0), .05, 'naval', 6)
    kit.member(A, col, P(0, 9.9, 49.0), P(0, top + .3, 52.0), .04, 'naval', 6)


def aircraft_deck(kit, col):
    """Brass strips over the linoleum, the aircraft trolley rails and the two turntables."""
    A = 'aircraft-deck'
    sup = kit.support

    def span(zr):
        left = -8.5 if zr <= 40.6 else -5.67 if zr <= 50.33 else -5.67 + (zr - 50.33) * 3.34 / 6.17
        right = 6.57 if zr <= 50.33 else 6.57 - (zr - 50.33) * 4.07 / 6.17
        return left, right

    def strip(a, b, width=.1):
        (ax, az), (bx, bz) = a, b
        mx, my = P((ax + bx) / 2, 0, (az + bz) / 2)[:2]
        h = sup.below(mx, my, 7.5)
        kit.beam(A, col, 'brass strip', P(ax, h + .006, az), P(bx, h + .006, bz), width, .014, 'gold')
    for zr in (38.0, 40.6, 43.0, 45.5, 47.9, 50.33, 52.6, 55.0):
        strip(*[(v, zr) for v in span(zr)])
    outline = [(-6.83, 35.43), (6.57, 35.43), (6.57, 50.33), (2.5, 56.5), (-2.33, 56.5), (-5.67, 50.33), (-5.67, 40.6),
               (-8.5, 40.6), (-8.5, 33.0), (-7.17, 33.0), (-6.83, 35.43)]
    for a, b in zip(outline, outline[1:]):
        strip(a, b)
    # Trolley rails from the turntables aft, and the crossing track between them.
    for rx, z0, z1 in ((-5.13, 39.0, 51.0), (-3.97, 39.0, 51.0), (4.37, 39.0, 47.7), (5.67, 39.0, 47.7)):
        mx, my = P(rx, 0, (z0 + z1) / 2)[:2]
        h = sup.below(mx, my, 7.5)
        kit.beam(A, col, 'trolley rail', P(rx, h + .015, z0), P(rx, h + .015, z1), .12, .03, 'edge')
    for zr in (37.13, 37.43):
        mx, my = P(0, 0, zr)[:2]
        h = sup.below(mx, my, 7.5)
        kit.beam(A, col, 'trolley rail', P(-3.17, h + .015, zr), P(3.17, h + .015, zr), .12, .03, 'edge')
    for tx in (-4.95, 4.93):
        x, y, _ = P(tx, 0, 37.25)
        h = sup.below(x, y, 7.5)
        kit.cylz(A, col, 'turntable', (x, y, h - .01), 1.47, .07, 'naval', 32)
        for dx in (-.3, .3):
            kit.beam(A, col, 'turntable rail', P(tx + dx, h + .075, 36.0), P(tx + dx, h + .075, 38.5), .1, .03, 'edge')


def boat_ramp(kit, col):
    """Sloping plate girder along the port quarter from the aircraft deck's corner down to the
    quarterdeck, on A-frame legs, with its head fitting on the deck above."""
    A = 'boat-ramp'
    a, b = P(-7.75, 6.45, 40.6), P(-7.75, 5.05, 60.0)
    kit.beam(A, col, 'girder', a, b, .9, .4, 'naval')
    kit.beam(A, col, 'track', (a[0], a[1], a[2] + .21), (b[0], b[1], b[2] + .21), .32, .04, 'dark')
    for zi in (49.4, 50.6, 51.7, 52.9, 56.0):
        t = (zi - 40.6) / (60.0 - 40.6)
        gy = 6.45 + (5.05 - 6.45) * t - .2
        deck = kit.support.below(*P(-7.75, 0, zi)[:2], gy)
        for fx in (-8.35, -7.15):
            kit.member(A, col, P(fx, deck, zi), P(-7.75, gy + .02, zi + .3), .07, 'naval', 4)
    x, y, _ = P(-7.65, 0, 38.2)
    floor = kit.support.below(x, y, 7.2)
    kit.part('box', A, col, 'head fitting', (x, y, floor + .3), (1.24, 1.15, .6), 'naval')
    kit.part('rod', A, col, 'head roller', P(-8.1, floor + .62, 38.2), P(-7.2, floor + .62, 38.2), .16, 'naval', vertices=12)

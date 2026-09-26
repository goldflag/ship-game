"""Hyūga after region: the mainmast on the after control tower, its directors, and the quarterdeck's
catapult.

The tracer followed the mainmast's pole, yard, gaff and signal gear as a stack of thin prisms; this
module claims them and draws the pole (grey below the smoke band, black above), the topmast, the two
yards with their braces, the gaff that carries the ensign, and the lamps. It adds the after Type 94
director (training) and its periscope, the two Type 94 high-angle directors on the tower's wings, and
the powder catapult on its turntable at the reference's pivot and heading, with the aircraft trolley
rails. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from hyuga_kit import P, ZC

# The mainmast's pole, yards and gaff were traced as thin prisms (after-tower-015 to -046).
CLAIMED_STRUCTURES = {f'after-tower-{i:03d}' for i in range(15, 47)}
BLACK_ABOVE = 31.5


def build(D, kit):
    cols = kit.cols
    masts = cols['Sensors and masts']
    mainmast(kit, masts)
    after_director(kit, masts)
    ha_directors(kit, masts)
    catapult(kit, cols['Boats and aviation'])


def split_black(kit, assembly, col, label, a, b, r, r2=None, vertices=14):
    """A spar painted grey below the smoke band and black above it."""
    r2 = r if r2 is None else r2
    if (a[2] - BLACK_ABOVE) * (b[2] - BLACK_ABOVE) >= 0:
        kit.part('rod', assembly, col, label, a, b, r, 'black' if min(a[2], b[2]) >= BLACK_ABOVE else 'naval', vertices=vertices, r2=r2)
        return
    t = (BLACK_ABOVE - a[2]) / (b[2] - a[2])
    m = tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
    rm = r + (r2 - r) * t
    kit.part('rod', assembly, col, label, a, m, r, 'naval', vertices=vertices, r2=rm)
    kit.part('rod', assembly, col, label + ' black', m, b, rm, 'black', vertices=vertices, r2=r2)


def mainmast(kit, col):
    A = 'mainmast'
    # Pole: reference z 42.3 at the tower top to 41.1 at the masthead (46.0 m).
    foot = Vector(P(0, 19.9, 42.35))
    floor = kit.try_below(foot.x, foot.y, 20.4, 19.9)
    foot.z = floor - .02
    band = Vector(P(0, 31.5, 41.55))
    head = Vector(P(0, 39.8, 41.1))
    split_black(kit, A, col, 'pole', tuple(foot), tuple(band), .5, .44, 20)
    kit.part('rod', A, col, 'smoke band', tuple(band + Vector((0, 0, -.35))), tuple(band), .46, 'white', vertices=20)
    kit.part('rod', A, col, 'pole', tuple(band), tuple(head), .44, 'black', vertices=20, r2=.3)
    top = Vector(P(0, 46.0, 41.05))
    kit.part('rod', A, col, 'topmast', tuple(head + Vector((0, 0, -.6))), tuple(top), .13, 'black', vertices=10, r2=.06)
    kit.cylz(A, col, 'truck', (top.x, top.y, top.z - .05), .1, .12, 'black', 10)
    # Ladder up the pole's after side to the lower yard.
    kit.ladder(A, col, (foot.x - .52, 0, 20.4), (band.x - .47, 0, 31.3), (0, 1, 0), .4, .32, .03, .018, 'naval')
    # Lower yard at 31.3 m (reference x +-9.0) with knee braces; upper yard at 39.3 m (x +-5.0).
    yx = P(0, 0, 41.6)[0]
    kit.member(A, col, (yx, -9.0, 31.35), (yx, 9.0, 31.35), .09, 'black', 8)
    for s in (-1, 1):
        kit.member(A, col, (yx, s * 3.6, 31.35), (yx, s * .45, 29.9), .05, 'black', 6)
        for yy in (5.5, 9.0):
            kit.cylz(A, col, 'yardarm lamp', (yx, s * yy, 31.44), .06, .14, 'black', 8)
    ux = P(0, 0, 41.15)[0]
    kit.member(A, col, (ux, -5.0, 39.3), (ux, 5.0, 39.3), .07, 'black', 8)
    for s in (-1, 1):
        kit.member(A, col, (ux, s * 2.2, 39.3), (ux, s * .3, 38.3), .04, 'black', 6)
    # Gaff: from the pole at 29.7 m up aft to its peak at 30.9 m, where the ensign flies.
    heel = Vector(P(0, 29.7, 42.6))
    peak = Vector(P(0, 30.9, 45.4))
    kit.member(A, col, tuple(heel), tuple(peak), .07, 'naval', 8)
    kit.wire(A, col, tuple(peak), tuple(Vector(P(0, 36.0, 41.4))), .015, False)
    # Day lights and the halyards from the yards down to the tower.
    t = (27.9 - foot.z) / (band.z - foot.z)
    lamp = foot.lerp(band, t) + Vector((-.55, 0, 0))
    kit.part('box', A, col, 'day light bracket', tuple(foot.lerp(band, t) + Vector((-.3, 0, 0))), (.5, .12, .1), 'naval')
    kit.cylz(A, col, 'day light', (lamp.x, lamp.y, lamp.z - .25), .14, .5, 'naval', 12)
    for s in (-1, 1):
        kit.wire(A, col, (yx, s * 8.6, 31.35), P(s * 3.6, 17.6, 40.2), .01, False)


def after_director(kit, col):
    """Type 94 director on the tower top (reference JD_10) with its periscope hood behind (JF_8)."""
    A = 'after-director'
    cx, cz, base = 0.0, 44.27, 19.65
    x, y, z = P(cx, base, cz)
    floor = kit.try_below(x, y, base + .1, base)
    ring = [kit.cylz(A, col, 'training ring', (x, y, floor), 1.05, base - floor + .12, 'edge', 32)]

    def octo(r):
        return [P(cx + r * math.cos(math.radians(22.5 + 45 * i)), 0, cz + r * math.sin(math.radians(22.5 + 45 * i)))[:2] for i in range(8)]
    ring.append(kit.prism(A, col, 'housing', octo(1.18), base + .12, 21.35, 'naval', 'roof'))
    ring.append(kit.prism(A, col, 'hood', octo(.85), 21.35, 21.72, 'naval', 'roof'))
    for s in (-1, 1):
        ring.append(kit.part('rod', A, col, 'rangefinder arm', P(s * .9, 20.8, cz), P(s * 1.45, 20.8, cz), .17, 'naval', vertices=12))
        ring.append(kit.part('box', A, col, 'arm hood', P(s * 1.45, 20.8, cz), (.45, .4, .45), 'naval'))
    gx, gy, gz = P(0, 20.9, cz + 1.15)
    ring.append(kit.part('box', A, col, 'sight slit', (gx, gy, gz), (.03, .9, .16), 'glass'))
    radar_pivot('after-director.yaw', (x, y, floor), ring)
    B = 'after-periscope'
    x, y, z = P(0, 18.8, 47.35)
    floor = kit.try_below(x, y, 19.2, 18.8)
    kit.cylz(B, col, 'hood', (x, y, floor), .55, 19.95 - floor, 'naval', 20)
    kit.cylz(B, col, 'cap', (x, y, 19.95), .6, .08, 'naval', 20)
    kit.part('box', B, col, 'window', (x - .52, y, 19.7), (.03, .5, .16), 'glass')


def ha_directors(kit, col):
    """Type 94 high-angle directors on the tower's wings (reference JD_11/12): a drum with a cabin and
    its 4.5 m rangefinder along the ship."""
    for side, rx in (('port', -3.555), ('starboard', 3.555)):
        A = f'ha-director-aft-{side}'
        s = 1 if rx > 0 else -1
        x, y, z = P(rx, 16.65, 44.8)
        floor = kit.try_below(x, y, 17.0, 16.65)
        kit.cylz(A, col, 'drum', (x, y, floor), .75, 17.25 - floor, 'naval', 20)
        kit.part('box', A, col, 'cabin', (x, y, 17.9), (2.0, 1.6, 1.3), 'naval')
        kit.part('box', A, col, 'cabin roof', (x, y, 18.58), (2.1, 1.7, .06), 'roof')
        kit.part('rod', A, col, 'rangefinder', (x - 2.35, y, 18.2), (x + 2.35, y, 18.2), .14, 'naval', vertices=12)
        for t in (-1, 1):
            kit.part('box', A, col, 'rangefinder hood', (x + t * 2.35, y, 18.2), (.38, .36, .4), 'naval')
        kit.part('box', A, col, 'window', (x + 1.01, y, 17.95), (.03, 1.1, .3), 'glass')


def catapult(kit, col):
    """Type 2 No. 1 powder catapult on its turntable (reference HP_JC_1 pivot at z 86.92, heading 10 degrees
    to starboard of the bow): a tapered girder with lightened side plates, the launching carriage and its
    cradle frames."""
    A = 'catapult'
    px, py, pz = P(4.353, 4.916, 86.924)
    floor = kit.try_below(px, py, 5.2, 4.9)
    kit.cylz(A, col, 'turntable', (px, py, floor - .02), 1.9, .16, 'naval', 40)
    kit.cylz(A, col, 'pivot', (px, py, floor + .1), .75, .55, 'naval', 20)
    heading = math.radians(10)
    fwd = Vector((math.cos(heading), -math.sin(heading), 0))
    side = Vector((math.sin(heading), math.cos(heading), 0))
    c = Vector((px, py, 0))

    def at(u, v, h):
        p = c + fwd * u + side * v
        return (p.x, p.y, h)

    def bottom(u):
        return floor + .5 + max(0.0, u - 3.0) / 9.6 * .45 + max(0.0, -u - 2.0) / 5.0 * .25
    top = floor + 1.65
    us = [-7.0 + i * (19.6 / 16) for i in range(17)]
    for sv in (-1, 1):
        vv = []
        for u in us:
            for t in (-.02, .02):
                vv += [at(u, sv * (.6 + t), bottom(u)), at(u, sv * (.6 + t), top)]
        n = len(us)
        ff = []
        for i in range(n - 1):
            a, b = 4 * i, 4 * (i + 1)
            ff += [(a, b, b + 1, a + 1), (a + 3, b + 3, b + 2, a + 2), (a + 1, b + 1, b + 3, a + 3), (a + 2, b + 2, b, a)]
        ff += [(0, 1, 3, 2), (4 * (n - 1) + 2, 4 * (n - 1) + 3, 4 * (n - 1) + 1, 4 * (n - 1))]
        if sv < 0:
            ff = [tuple(reversed(f)) for f in ff]
        kit.tag(kit.mesh(A + '.side plate', vv, ff, 'naval', col), A)
        for a_, b_ in zip(us, us[1:]):
            m = (a_ + b_) / 2
            h = (bottom(m) + top) / 2
            kit.member(A, col, at(m, sv * .58, h), at(m, sv * .66, h), min(.24, (top - bottom(m)) * .3), 'dark', 8)
        kit.member(A, col, at(-7.0, sv * .6, top), at(12.6, sv * .6, top), .06, 'naval', 4)
        kit.member(A, col, at(-7.0, sv * .35, top + .03), at(12.6, sv * .35, top + .03), .04, 'edge', 4)
    kit.part('box', A, col, 'carriage', at(1.5, 0, top + .12), (3.6, 1.3, .25), 'naval')
    for uf in (.4, 2.8):
        for sv in (-1, 1):
            kit.member(A, col, at(uf, sv * .55, top + .24), at(uf, 0, top + 1.9), .05, 'naval', 6)
    kit.member(A, col, at(.4, 0, top + 1.9), at(2.8, 0, top + 1.9), .05, 'naval', 6)
    # Aircraft trolley rails on the quarterdeck from the catapult's heel toward the stern.
    for rail in (-1.1, 1.1):
        a = Vector(P(rail, 0, 94.5))
        b = Vector(P(rail, 0, 101.5))
        h = kit.try_below(a.x, a.y, 5.2, 4.6)
        kit.beam(A, col, 'trolley rail', (a.x, a.y, h + .015), (b.x, b.y, h + .015), .12, .03, 'edge')

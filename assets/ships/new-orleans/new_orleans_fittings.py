"""New Orleans fittings: masts, directors, radars, funnel tops, aviation, boats, searchlights, bulwarks, deck gear and
rails.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the approved GameModels3D
pasc107 B_Hull model (hardpoints, part bounds and plan cuts) and converted once by `P`; shapes are original
approximations of the reference's fittings at their measured sizes. No reference geometry is loaded.
"""
import math

import bmesh
from mathutils import Vector

from new_orleans_kit import P, R, ZS
from new_orleans_lockers import LOCKERS
from new_orleans_walls import FLOORS, WALLS
import new_orleans_underwater


def V(x, y, z):
    return Vector(P(x, y, z))


def local(ob, pivot):
    """Parent a freshly built object to an unrotated pivot, keeping its authored place."""
    ob.location = Vector(ob.location) - Vector(pivot.location)
    ob.parent = pivot
    return ob


def taper(kit, aid, col, label, a, b, r0, r1, material='naval', n=16):
    return kit.part('rod', aid, col, label, V(*a), V(*b), r0, material, r2=r1, vertices=n)


def seat(kit, x, y, z, reach=1.5):
    """Height of the support under a reference-frame point (searching from 0.25 m above it), or y when nothing lies
    within `reach` below."""
    X, Y, Z = P(x, y, z)
    try:
        h = kit.support.below(X, Y, Z + .25)
    except ValueError:
        return y
    return h if Z - h <= reach else y


def recalc(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def deck(kit, zref):
    """Weather-deck height at a reference z (from the compiled loft)."""
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZS)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][-1][1] * (1 - t) + s1['points'][-1][1] * t
    return 3.64


def hull_half(kit, zref, y):
    """Loft half-breadth at a reference z and height."""
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZS)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])

            def w(sec):
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (y - y0) / (y1 - y0))
                return best if best else sec['points'][-1][0]
            return w(s0) * (1 - t) + w(s1) * t
    return 0.0


# ---------------------------------------------------------------- bulwarks, screens and gun tubs
def walls(D, kit):
    """Thin plating along the measured polylines of new_orleans_walls.py (6 cm, foot to top)."""
    col = kit.collections['Superstructure']
    vv, ff = [], []
    t = .03
    for w in WALLS:
        for sign in ((1, -1) if w['mirror'] else (1,)):
            pts = [Vector((-z, -sign * x, 0)) for x, z in w['pts']]
            if len(pts) < 2:
                continue
            n = len(pts)
            normals = []
            for i in range(n):
                a = pts[max(0, i - 1)]
                b = pts[min(n - 1, i + 1)]
                d = (b - a)
                d.z = 0
                if d.length < 1e-6:
                    d = Vector((1, 0, 0))
                d.normalize()
                normals.append(Vector((-d.y, d.x, 0)))
            base = len(vv)
            for p, nrm in zip(pts, normals):
                for side in (-1, 1):
                    for h in (w['base'], w['top']):
                        q = p + nrm * side * t
                        vv.append((q.x, q.y, h))
            for i in range(n - 1):
                a, b = base + 4 * i, base + 4 * (i + 1)
                # vertex order per point: (-t, base), (-t, top), (+t, base), (+t, top)
                ff += [(a, b, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2), (a + 1, b + 1, b + 3, a + 3), (a, a + 2, b + 2, b)]
            last = base + 4 * (n - 1)
            ff += [(base, base + 1, base + 3, base + 2), (last, last + 2, last + 3, last + 1)]
    if vv:
        ob = kit.tag(kit.mesh('Bulwarks and gun tubs', vv, ff, 'naval', col), 'bulwarks')
        recalc(ob)
    # Sponson floors under the walls that bulge round a gun's working circle, flush with the deck they stand on.
    for i, f in enumerate(FLOORS):
        kit.prism('bulwarks', col, f'sponson floor {i + 1}', [(-z, -x) for x, z in f['pts']], f['y'] - .06, f['y'] + .004, 'naval', top_material='deck-blue')


# ---------------------------------------------------------------- masts
def mast_z(z0, y0, rake, y):
    return z0 + rake * (y - y0)


def foremast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    fz = lambda y: mast_z(-22.28, 17.5, .074, y)
    taper(kit, aid, col, 'pole', (0, 17.3, fz(17.3)), (0, 31.32, fz(31.32)), .28, .24)
    # Masthead platform carrying the SK forward and the topmast aft (reference 31.3 to 31.44 m).
    kit.boxc(aid, col, 'masthead platform', V(0, 31.36, -20.95), (4.2, 2.2, .14), 'roof')
    for s in (-1, 1):
        kit.member(aid, col, V(s * 1.05, 31.44, -23.0), V(s * 1.05, 31.44, -18.9), .03, 'edge')
        for zz in (-23.0, -21.0, -18.9):
            kit.member(aid, col, V(s * 1.05, 31.44, zz), V(s * 1.05, 32.4, zz), .025, 'edge', 5)
        kit.member(aid, col, V(s * 1.05, 32.4, -23.0), V(s * 1.05, 32.4, -18.9), .022, 'edge', 5)
    # Upper yard for the signal halyards and the IFF aerials at its ends (reference y 31.05, z -21.14).
    taper(kit, aid, col, 'upper yard', (-5.65, 31.05, -21.14), (5.65, 31.05, -21.14), .08, .08, 'naval', 10)
    for s in (-1, 1):
        for x in (1.6, 3.3, 5.1):
            kit.member(aid, col, V(0, 27.0, fz(27.0)), V(s * x, 31.0, -21.14), .045, 'naval', 6)
        # IFF aerials (am062, 1.0 m) and footropes.
        c = V(s * 5.55, 31.05, -21.14)
        kit.part('rod', aid, col, 'IFF mast', c, c + Vector((0, 0, 1.45)), .03, 'edge', vertices=6)
        kit.part('rod', aid, col, 'IFF dipole', c + Vector((0, 0, 1.25)), c + Vector((0, 0, 1.55)), .08, 'edge', vertices=8)
        kit.wire(aid, col, V(s * .4, 30.6, -21.14), V(s * 5.4, 30.6, -21.14), .012, False)
    # TBS antenna on the starboard yard arm (am085).
    c = V(4.62, 31.1, -21.25)
    kit.part('rod', aid, col, 'TBS whip', c, c + Vector((0, 0, 2.9)), .03, 'edge', vertices=6)
    for k in range(4):
        a = k * math.pi / 2
        kit.part('rod', aid, col, 'TBS ground plane', c + Vector((0, 0, 1.2)), c + Vector((1.2 * math.cos(a), 1.2 * math.sin(a), .6)), .015, 'edge', vertices=4)
    # Lower yard and its struts (reference y 23.3).
    taper(kit, aid, col, 'lower yard', (-3.05, 23.3, -21.9), (3.05, 23.3, -21.9), .07, .07, 'naval', 10)
    for s in (-1, 1):
        kit.member(aid, col, V(s * .96, 23.3, -21.9), V(s * .3, 21.0, fz(21.0)), .04)
        kit.member(aid, col, V(s * 2.9, 23.3, -21.9), V(s * .3, 25.5, fz(25.5)), .035)
    # Topmast from the platform to the forward SG, with a heel brace to the pole head.
    taper(kit, aid, col, 'topmast', (0, 31.44, -19.275), (0, 38.93, -19.275), .135, .09, 'naval', 12)
    kit.member(aid, col, V(0, 31.44, fz(31.32)), V(0, 33.2, -19.35), .06)
    kit.member(aid, col, V(0, 38.68, -18.54), V(0, 40.4, -18.54), .03, 'edge', 6)
    kit.ladder(aid, col, V(0, 17.6, fz(17.6) + .3), V(0, 31.2, fz(31.2) + .3), (1, 0, 0), .4)


def mainmast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'mainmast'
    mz = lambda y: mast_z(38.86, 9.8, .089, y)
    taper(kit, aid, col, 'pole', (0, 9.7, mz(9.7)), (0, 30.05, mz(30.05)), .28, .24)
    # Radar platform at 30.0 to 30.14 m: an oval 2.3 x 5.25 m round the pole, the SM on it.
    ring = [(1.15 * math.cos(math.tau * i / 28), 2.62 * math.sin(math.tau * i / 28)) for i in range(28)]
    pts = [P(x, 0, 40.4 + z)[:2] for x, z in ring]
    kit.prism(aid, col, 'radar platform', pts, 30.0, 30.14, 'naval', 'roof')
    for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1]):
        kit.wire(aid, col, V(ax, 31.1, 40.4 + az), V(bx, 31.1, 40.4 + bz), .018, False)
    for x, z in ring[::3]:
        kit.wire(aid, col, V(x, 30.14, 40.4 + z), V(x, 31.1, 40.4 + z), .022, False)
    for s in (-1, 1):
        kit.member(aid, col, V(s * .9, 30.0, 40.4 - 2.0), V(0, 27.3, mz(27.3)), .05)
        kit.member(aid, col, V(s * .9, 30.0, 40.4 + 2.0), V(0, 27.3, mz(27.3)), .05)
    # Topmast to the after SG.
    taper(kit, aid, col, 'topmast', (0, 30.14, 38.208), (0, 37.65, 38.208), .135, .09, 'naval', 12)
    # Yard for the IFF aerials (am062) and the TBS (am085).
    taper(kit, aid, col, 'yard', (-3.0, 30.21, 39.3), (3.0, 30.21, 39.3), .07, .07, 'naval', 10)
    for s in (-1, 1):
        c = V(s * 2.85, 30.21, 39.3)
        kit.part('rod', aid, col, 'IFF mast', c, c + Vector((0, 0, 1.0)), .03, 'edge', vertices=6)
        kit.part('rod', aid, col, 'IFF dipole', c + Vector((0, 0, .87)), c + Vector((0, 0, 1.13)), .08, 'edge', vertices=8)
        c = V(s * .7, 30.14, 42.24)
        kit.part('rod', aid, col, 'TBS whip', c, c + Vector((0, 0, .5)), .02, 'edge', vertices=5)
    c = V(-1.94, 30.21, 39.3)
    kit.part('rod', aid, col, 'TBS whip', c, c + Vector((0, 0, 2.9)), .03, 'edge', vertices=6)
    # Gaff for the ensign (reference HP_flag_nation) and a narrow landing at 25.2 m.
    kit.member(aid, col, V(0, 28.2, mz(28.2)), V(0, 29.45, 42.55), .06)
    kit.boxc(aid, col, 'landing', V(0, 25.17, 38.62), (3.2, .5, .08), 'roof')
    for s in (-1, 1):
        kit.wire(aid, col, V(s * .25, 26.1, 37.02), V(s * .25, 26.1, 40.2), .018, False)
        for z in (37.02, 38.6, 40.2):
            kit.wire(aid, col, V(s * .25, 25.2, z), V(s * .25, 26.1, z), .02, False)
    kit.ladder(aid, col, V(0, 9.8, mz(9.8) - .3), V(0, 29.9, mz(29.9) - .3), (1, 0, 0), .4)


# ---------------------------------------------------------------- directors
def mk51(kit, aid, col, x, y, z, bearing):
    """Mk 51 40 mm director: pedestal, yoke and the box sight with its eyepieces (reference 0.84 x 1.73 m)."""
    foot = seat(kit, x, y, z)
    base = V(x, y, z)
    floor = V(x, foot, z)
    kit.cylz(aid, col, 'pedestal', floor, .2, 1.05 + (y - foot), 'naval', 16)
    kit.cylz(aid, col, 'pedestal foot', floor, .3, .08, 'edge', 16)
    pivot = kit.empty(aid + '.yaw', tuple(base + Vector((0, 0, 1.05))), assembly=aid, col=col)
    pivot.rotation_euler.z = math.radians(-bearing)
    local(kit.boxc(aid, col, 'yoke', tuple(base + Vector((0, 0, 1.1))), (.2, .46, .1), 'naval'), pivot)
    local(kit.boxc(aid, col, 'sight box', tuple(base + Vector((0, 0, 1.36))), (.62, .4, .42), 'naval'), pivot)
    local(kit.boxc(aid, col, 'sight window', tuple(base + Vector((.315, 0, 1.4))), (.03, .3, .16), 'glass'), pivot)
    for s in (-1, 1):
        local(kit.part('rod', aid, col, 'handle', base + Vector((-.36, s * .12, 1.25)), base + Vector((-.3, s * .28, 1.25)), .025, 'edge', vertices=6), pivot)
    local(kit.boxc(aid, col, 'gyro housing', tuple(base + Vector((-.15, 0, 1.64))), (.36, .3, .16), 'painted-edge'), pivot)


def directors(D, kit):
    col = kit.collections['Sensors and masts']
    # Mk 31 main-battery directors (reference ad008: 2.88 m across, 1.19 m high): a low round base with sloped sides,
    # the director house on it and the rangefinder across its full width, training on a ring.
    for aid, (x, y, z) in [('mk31-forward', (0, 21.954, -28.444)), ('mk31-after', (0, 15.963, 49.017))]:
        c = V(x, y, z)
        kit.cylz(aid, col, 'training ring', c - Vector((0, 0, .03)), 1.46, .05, 'edge', 40)
        pivot = kit.empty(aid + '.yaw', tuple(c), assembly=aid, col=col)
        if aid == 'mk31-after':
            pivot.rotation_euler.z = math.pi
        local(kit.cylz(aid, col, 'base', c, 1.44, .5, 'naval', 40, r2=1.18), pivot)
        local(kit.cylz(aid, col, 'base deck', c + Vector((0, 0, .5)), 1.18, .04, 'roof', 40), pivot)
        local(kit.boxc(aid, col, 'house', tuple(c + Vector((-.05, 0, .76))), (1.1, 1.4, .5), 'naval'), pivot)
        local(kit.boxc(aid, col, 'house roof', tuple(c + Vector((-.05, 0, 1.02))), (1.14, 1.44, .04), 'roof'), pivot)
        local(kit.boxc(aid, col, 'sight hood', tuple(c + Vector((.55, 0, .82))), (.3, .5, .3), 'naval'), pivot)
        local(kit.boxc(aid, col, 'sight window', tuple(c + Vector((.71, 0, .86))), (.03, .36, .1), 'glass'), pivot)
        local(kit.part('rod', aid, col, 'rangefinder tube', c + Vector((.05, -1.44, 1.05)), c + Vector((.05, 1.44, 1.05)), .1, 'naval', vertices=12), pivot)
        for s in (-1, 1):
            local(kit.boxc(aid, col, 'rangefinder end', tuple(c + Vector((.05, s * 1.38, 1.05))), (.26, .12, .26), 'naval'), pivot)
            local(kit.boxc(aid, col, 'rangefinder window', tuple(c + Vector((.19, s * 1.38, 1.05))), (.02, .1, .1), 'glass'), pivot)
        local(kit.boxc(aid, col, 'hatch', tuple(c + Vector((-.3, 0, 1.06))), (.45, .5, .04), 'edge'), pivot)
    # Mk 28 5-inch directors (reference ad009: 3.57 m wide, 5.67 m high): a tall tapered pedestal (2.6 m), the director
    # house (3.0 x 2.4 x 2.6 m, its face raked), rangefinder ends through the sides, the Mk 4 radar array on the face
    # and hatches and periscopes on the roof.
    for aid, (x, y, z), heading in [('mk28-forward', (0, 21.989, -24.535), 0), ('mk28-after', (0, 16.119, 46.232), math.pi)]:
        c = V(x, y, z)
        kit.cylz(aid, col, 'pedestal', c, .8, 2.57, 'naval', 20, r2=.36)
        kit.cylz(aid, col, 'pedestal foot', c, .9, .08, 'edge', 20)
        pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, 2.57))), assembly=aid, col=col)
        pivot.rotation_euler.z = heading
        top = c + Vector((0, 0, 2.57))
        # House: a box whose face rakes back 0.35 m from its foot to its roof.
        L, W, H = 2.4, 3.0, 2.58
        f0, f1, a = .95, .6, -1.45
        vv = [(a, -W / 2, 0), (a, W / 2, 0), (f0, W / 2, 0), (f0, -W / 2, 0), (a, -W / 2, H), (a, W / 2, H), (f1, W / 2, H), (f1, -W / 2, H)]
        vv = [tuple(top + Vector(v)) for v in vv]
        house = kit.tag(kit.mesh(aid + '.director house', vv, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'naval', col), aid)
        local(recalc(house), pivot)
        local(kit.boxc(aid, col, 'house roof', tuple(top + Vector((-.42, 0, H + .02))), (2.1, 3.06, .04), 'roof'), pivot)
        for s in (-1, 1):
            local(kit.part('rod', aid, col, 'rangefinder end', top + Vector((-.2, s * 1.5, 1.75)), top + Vector((-.2, s * 1.79, 1.75)), .16, 'naval', vertices=12), pivot)
            local(kit.part('rod', aid, col, 'rangefinder window', top + Vector((-.2, s * 1.79, 1.75)), top + Vector((-.2, s * 1.8, 1.75)), .12, 'glass', vertices=12), pivot)
        local(kit.boxc(aid, col, 'face window', tuple(top + Vector((.82, 0, 1.25))), (.04, 2.2, .22), 'glass'), pivot)
        # Mk 4 array on the face: a narrow vertical frame of dipole rows, 0.5 m wide and 2.5 m tall.
        arr = top + Vector((1.25, 0, 1.3))
        local(kit.boxc(aid, col, 'Mk 4 array frame', tuple(arr), (.12, .52, 2.5), 'painted-edge'), pivot)
        for k in range(8):
            local(kit.boxc(aid, col, 'Mk 4 dipole row', tuple(arr + Vector((.1, 0, -1.1 + k * .31))), (.06, .56, .05), 'edge'), pivot)
        for s in (-1, 1):
            local(kit.part('rod', aid, col, 'array bracket', arr + Vector((-.06, s * .2, .9)), top + Vector((.75, s * .2, 1.9)), .03, 'edge', vertices=6), pivot)
            local(kit.part('rod', aid, col, 'array bracket', arr + Vector((-.06, s * .2, -.9)), top + Vector((.9, s * .2, .6)), .03, 'edge', vertices=6), pivot)
        for dy in (-.9, 0, .9):
            local(kit.boxc(aid, col, 'roof hatch', tuple(top + Vector((-.9, dy, H + .3))), (.55, .5, .55), 'naval'), pivot)
        for s in (-1, 1):
            local(kit.part('rod', aid, col, 'periscope', top + Vector((.1, s * .55, H)), top + Vector((.45, s * .55, H + .55)), .07, 'edge', vertices=8), pivot)
    # Mk 51 40 mm directors beside their quads (reference HP_AD_3..6, 9, 10).
    for i, (x, y, z, bearing) in enumerate([(-3.003, 20.619, -23.499, -90), (3.003, 20.619, -23.499, 90), (-3.553, 13.764, 42.762, -90),
                                             (3.553, 13.764, 42.762, 90), (-2.386, 5.046, 72.509, 180), (2.386, 5.046, 72.509, 180)], 1):
        mk51(kit, f'mk51-{i}', col, x, y, z, bearing)


# ---------------------------------------------------------------- radars
def radars(D, kit):
    col = kit.collections['Sensors and masts']
    # SK air-search bedspring on the foremast head (reference ars006: 5.13 m wide, 5.83 m high, 1.7 m deep).
    aid = 'radar-sk'
    c = V(0, 31.438, -22.351)
    kit.cylz(aid, col, 'pedestal', c, .35, .5, 'naval', 16)
    pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, .5))), assembly=aid, col=col)
    top = c + Vector((0, 0, .5))
    local(kit.boxc(aid, col, 'rotator housing', tuple(top + Vector((0, 0, .25))), (.8, .8, .5), 'naval'), pivot)
    frame = top + Vector((.33, 0, 2.9))
    for dy in (-2.5, 2.5):
        local(kit.part('rod', aid, col, 'frame upright', frame + Vector((0, dy, -2.4)), frame + Vector((0, dy, 2.4)), .045, 'naval', vertices=6), pivot)
    for dz in (-2.4, -1.2, 0, 1.2, 2.4):
        local(kit.part('rod', aid, col, 'frame rail', frame + Vector((0, -2.5, dz)), frame + Vector((0, 2.5, dz)), .04, 'naval', vertices=6), pivot)
    local(kit.boxc(aid, col, 'mesh reflector', tuple(frame + Vector((-.08, 0, 0))), (.03, 5.0, 4.8), 'edge'), pivot)
    for dy in (-1.9, -.6, .6, 1.9):
        for dz in (-1.8, -.6, .6, 1.8):
            local(kit.boxc(aid, col, 'dipole', tuple(frame + Vector((-.02, dy, dz))), (.05, .9, .06), 'painted-edge'), pivot)
    for s in (-1, 1):
        local(kit.part('rod', aid, col, 'back strut', top + Vector((0, s * .35, .5)), frame + Vector((-.1, s * 2.0, 1.8)), .035, 'naval', vertices=6), pivot)
        local(kit.part('rod', aid, col, 'back strut', top + Vector((0, s * .35, .5)), frame + Vector((-.1, s * 2.0, -1.8)), .035, 'naval', vertices=6), pivot)
    # SG surface-search sets on both topmasts (reference ars004: 1.29 x 1.23 x 0.69 m).
    for aid, (x, y, z) in [('radar-sg-forward', (0, 38.931, -19.27)), ('radar-sg-after', (0, 37.647, 38.234))]:
        c = V(x, y, z)
        kit.cylz(aid, col, 'drive', c, .14, .28, 'edge', 12)
        pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, .28))), assembly=aid, col=col)
        base = c + Vector((0, 0, .28))
        vv, ff = [], []
        n = 9
        for i in range(n + 1):
            a = -.6 + 1.2 * i / n
            for zz in (.05, .92):
                vv.append((base.x + .28 * (1 - math.cos(a * 1.3)) - .3, base.y + .64 * math.sin(a) / math.sin(.6), base.z + zz))
        for i in range(n):
            ff.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
        dish = kit.tag(kit.mesh(aid + '.reflector', vv, ff, 'painted-edge', col), aid)
        local(dish, pivot)
        local(kit.part('rod', aid, col, 'feed', base + Vector((-.3, 0, .48)), base + Vector((.28, 0, .48)), .04, 'edge', vertices=6), pivot)
        local(kit.part('rod', aid, col, 'mast head', base - Vector((0, 0, .02)), base + Vector((0, 0, .5)), .06, 'edge', vertices=8), pivot)
        local(kit.boxc(aid, col, 'feed horn', tuple(base + Vector((.3, 0, .48))), (.1, .16, .12), 'edge'), pivot)
    # SM fighter-direction dish on the mainmast platform (reference arf012: 2.45 m across, 2.9 m high).
    aid = 'radar-sm'
    c = V(0, 30.14, 41.289)
    kit.cylz(aid, col, 'pedestal', c, .45, .9, 'naval', 16)
    pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, .9))), assembly=aid, col=col)
    top = c + Vector((0, 0, .9))
    local(kit.boxc(aid, col, 'yoke', tuple(top + Vector((0, 0, .45))), (.5, 1.2, .9), 'naval'), pivot)
    rings = []
    for r, dx in [(.05, .55), (.6, .42), (1.0, .22), (1.22, 0)]:
        rings.append([(top.x + dx, top.y + r * math.cos(math.tau * i / 24), top.z + 1.3 + r * math.sin(math.tau * i / 24)) for i in range(24)])
    dish = kit.loft(aid, col, 'dish', rings, 'painted-edge', False, False, True)
    local(dish, pivot)
    local(kit.part('rod', aid, col, 'feed support', top + Vector((.55, 0, 1.3)), top + Vector((1.1, 0, 1.3)), .04, 'edge', vertices=6), pivot)


# ---------------------------------------------------------------- funnel tops
FUNNELS = [('forward-funnel', -13.852, .1125, 11.0, 20.0, 18.7), ('after-funnel', 3.265, .1046, 9.7, 19.3, 18.0)]
HOOD_BACK = -13.45  # reference z of the forward funnel cowl's after face
SECTION = [(-2.87, 0), (-2.8, .30), (-2.6, .87), (-2.4, 1.12), (-2.2, 1.32), (-2.0, 1.41), (-1.8, 1.48), (-1.5, 1.58), (-1.0, 1.66),
           (0, 1.66), (1.0, 1.60), (1.5, 1.43), (1.8, 1.30), (2.0, 1.07), (2.2, .73), (2.4, .30), (2.45, 0)]


def funnel_ring(zc, grow=0.0):
    pts = [(w, zc + dz) for dz, w in SECTION] + [(-w, zc + dz) for dz, w in reversed(SECTION[1:-1])]
    if grow:
        cx = 0
        out = []
        for x, z in pts:
            d = math.hypot(x - cx, z - zc) or 1
            out.append((x + (x - cx) / d * grow, z + (z - zc) / d * grow))
        return out
    return pts


def funnels(D, kit):
    col = kit.collections['Superstructure']
    for aid, z_ref, rake, y_ref, rim, gallery in FUNNELS:
        zc = lambda y: z_ref + rake * (y - y_ref)
        # Rim lip, the mouth's grating bars and the sooted inner cap stand on the lofted stack's top.
        lip = [(x, rim, z) for x, z in funnel_ring(zc(rim), .06)]
        inner = [(x, rim, z) for x, z in funnel_ring(zc(rim), -.02)]
        top = [(x, rim + .14, z) for x, z in funnel_ring(zc(rim + .14), .06)]
        kit.loft(aid + '-top', col, 'rim lip', [[P(*p) for p in inner], [P(*p) for p in lip], [P(*p) for p in top]], 'black', False, False, False)
        # (the forward funnel's cowl covers the forward part of its mouth: no bars under it)
        clear = HOOD_BACK - zc(rim) + .1 if aid == 'forward-funnel' else -9
        for dz in (-1.6, -.5, .6, 1.6):
            if dz > clear:
                kit.boxc(aid + '-top', col, 'mouth bar', V(0, rim + .12, zc(rim) + dz), (.08, 3.0, .12), 'black')
        a0 = max(-2.3, clear)
        kit.boxc(aid + '-top', col, 'mouth bar', V(0, rim + .12, zc(rim) + (a0 + 2.3) / 2), ((2.3 - a0), .08, .12), 'black')
        # Gallery round the stack with its rail, on brackets.
        ring = funnel_ring(zc(gallery), .62)
        base = funnel_ring(zc(gallery), .02)
        vv = [P(x, gallery - .06, z) for x, z in base] + [P(x, gallery - .06, z) for x, z in ring] + \
             [P(x, gallery, z) for x, z in base] + [P(x, gallery, z) for x, z in ring]
        n = len(ring)
        ff = []
        for i in range(n):
            j = (i + 1) % n
            ff += [(2 * n + i, 2 * n + j, 3 * n + j, 3 * n + i), (i, n + i, n + j, j), (n + i, 3 * n + i, 3 * n + j, n + j), (i, j, 2 * n + j, 2 * n + i)]
        recalc(kit.tag(kit.mesh(aid + '-top.gallery', vv, ff, 'roof', col), aid + '-top'))
        for i, (x, z) in enumerate(ring):
            j = ring[(i + 1) % n]
            kit.wire(aid + '-top', col, V(x, gallery + 1.0, z), V(j[0], gallery + 1.0, j[1]), .018, False)
            kit.wire(aid + '-top', col, V(x, gallery + .5, z), V(j[0], gallery + .5, j[1]), .014, False)
            if i % 2 == 0:
                kit.wire(aid + '-top', col, V(x, gallery, z), V(x, gallery + 1.0, z), .02, False)
                bx, bz = base[i]
                kit.wire(aid + '-top', col, V(x, gallery - .05, z), V(bx, gallery - .75, bz), .025, False, 'naval', 4)
        # Steam pipes up the after side, clear of the rim.
        for s in (-.22, .22):
            a = (s, 9.5 if aid == 'after-funnel' else 8.5, zc(9.5 if aid == 'after-funnel' else 8.5) + 2.5)
            b = (s, rim + 1.1, zc(rim + 1.1) + 2.5)
            kit.part('rod', aid + '-top', col, 'steam pipe', V(*a), V(*b), .11, 'naval', vertices=10)
            kit.part('rod', aid + '-top', col, 'pipe mouth', V(*b) - Vector((0, 0, .05)), V(*b) + Vector((0, 0, .05)), .13, 'black', vertices=10)
        # Ladder up the side to the gallery.
        kit.ladder(aid + '-top', col, V(1.72, 10.0, zc(10.0) + .6), V(1.72, gallery, zc(gallery) + .6), (-1, 0, 0), .42)
    # The forward funnel's cowl (reference plan and profile cuts): it covers the mouth from the forward rim to a steep
    # after face 0.61 m forward of the stack's centre at the rim (reference z -13.45), its top rising from 20.45 m at
    # the forward tip to 22.47 m on the centreline at that face and arched across it, 0.54 m lower 1.3 m out.
    rim = 20.0
    zc = lambda y: -13.852 + .1125 * (y - 11.0)
    base, peak, back = rim + .12, 22.47, HOOD_BACK

    def half_width(z):
        dz = z - zc(rim)
        for (d0, w0), (d1, w1) in zip(SECTION, SECTION[1:]):
            if d0 <= dz <= d1:
                return (w0 + (w1 - w0) * (dz - d0) / (d1 - d0)) + .06
        return .06

    tip = zc(rim) + SECTION[0][0] + .05
    rings = []
    for k in range(11):
        z = tip + (back - tip) * k / 10
        crown = 20.45 - base + (peak - 20.45) * k / 10  # centreline height above the lip
        w = max(half_width(z), .08)
        top = [(w * (-1 + 2 * j / 10), base + crown * max(.25, 1 - .24 * (w * (-1 + 2 * j / 10) / 1.3) ** 2), z) for j in range(11)]
        rings.append([P(*q) for q in top + [(w, base, z), (-w, base, z)]])
    hood = kit.loft('forward-funnel-top', col, 'hood', rings, 'black', True, True, True)
    hood.data.set_sharp_from_angle(angle=math.radians(35))


# ---------------------------------------------------------------- aviation
def catapults(D, kit):
    col = kit.collections['Boats and aviation']
    for s in (-1, 1):
        aid = 'catapult-port' if s < 0 else 'catapult-starboard'
        cx, cy, cz = s * 7.074, 9.529, 17.262
        # Turntable on the tower and the operator's cab at the pivot.
        kit.cylz(aid, col, 'turntable', V(cx, cy, cz), 1.9, .22, 'edge', 40)
        kit.cylz(aid, col, 'turntable deck', V(cx, cy + .22, cz), 1.75, .08, 'roof', 40)
        kit.boxc(aid, col, 'operator cab', V(cx + s * 1.25, cy + .9, cz + .3), (1.4, .9, 1.2), 'naval')
        kit.boxc(aid, col, 'cab window', V(cx + s * 1.25, cy + 1.05, cz - .41), (.04, .7, .3), 'glass')
        # Box-girder track 21.5 m long, 1.0 m wide and 1.2 m deep, lattice sides, rails on top.
        z0, z1 = 6.83, 28.32
        top = cy + 1.55
        a, b = V(cx, top - .6, z0 + .1), V(cx, top - .6, z1 - .1)
        kit.lattice(aid, col, a, b, 1.0, 1.2, 18, .07, .035)
        kit.boxc(aid, col, 'track deck', V(cx, top + .02, (z0 + z1) / 2), (z1 - z0, 1.05, .06), 'roof')
        for dx in (-.3, .3):
            kit.member(aid, col, V(cx + dx, top + .09, z0 + .2), V(cx + dx, top + .09, z1 - .3), .035, 'edge', 6)
        # Side walkways over the middle third, and the launching car at the forward end.
        for side in (-1, 1):
            kit.boxc(aid, col, 'walkway', V(cx + side * .95, top - .2, 17.4), (13.0, .7, .05), 'roof')
            kit.wire(aid, col, V(cx + side * 1.28, top + .7, 11.0), V(cx + side * 1.28, top + .7, 23.8), .016, False)
            for z in (11.0, 14.2, 17.4, 20.6, 23.8):
                kit.wire(aid, col, V(cx + side * 1.28, top - .18, z), V(cx + side * 1.28, top + .7, z), .02, False)
        kit.boxc(aid, col, 'launching car', V(cx, top + .25, 8.3), (2.2, .8, .38), 'painted-edge')
        kit.boxc(aid, col, 'car chocks', V(cx, top + .5, 8.1), (.5, 1.1, .16), 'edge')
        kit.cylz(aid, col, 'centre post', V(cx, cy + .3, cz), .45, top - cy - .3, 'naval', 16)


def aircraft_crane(D, kit):
    col = kit.collections['Boats and aviation']
    aid = 'aircraft-crane'
    bx, bz = -8.3, 35.0
    kit.cylz(aid, col, 'pedestal', V(bx, 9.88, bz), .95, 1.45, 'naval', 24, r2=.7)
    kit.boxc(aid, col, 'machinery house', V(bx, 13.1, bz - .3), (3.0, 2.6, 3.6), 'naval')
    kit.boxc(aid, col, 'house roof', V(bx, 14.93, bz - .3), (3.06, 2.66, .06), 'roof')
    kit.boxc(aid, col, 'house window', V(bx + 1.31, 13.9, bz - .3), (.04, 1.2, .4), 'glass')
    taper(kit, aid, col, 'king post', (bx, 14.9, bz), (bx, 20.66, bz), .3, .22)
    kit.cylz(aid, col, 'post cap', V(bx, 20.55, bz), .3, .2, 'edge', 12)
    # Jib on the reference's line (am113 plan cuts: centre -6.78, 32.8 at 15 m and -2.15, 26.1 at 23 m), its heel
    # pinned at the front of the machinery house.
    heel = V(-7.62, 13.6, 34.0)
    tip = V(-2.28, 22.8, 26.31)
    kit.lattice(aid, col, heel, tip, .9, .9, 16, .07, .04)
    kit.part('rod', aid, col, 'jib head sheave', tip + Vector((0, -.25, 0)), tip + Vector((0, .25, 0)), .2, 'edge', vertices=12)
    for k in (.65, .9):
        p = heel.lerp(tip, k)
        kit.wire(aid, col, V(bx, 20.6, bz), p, .025, False)
    kit.wire(aid, col, tip, tip - Vector((0, 0, 5.5)), .02, False)
    kit.boxc(aid, col, 'hook block', tip - Vector((0, 0, 5.7)), (.3, .3, .4), 'edge')


# ---------------------------------------------------------------- boats
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, covered=False, material='naval'):
    """Open boat: a lofted hull of pointed-oval sections (authoring frame centre c, keel down)."""
    n = 16
    rings = []
    for k in range(n + 1):
        t = k / n
        u = 2 * t - 1
        half = beam / 2 * max(.06, (1 - u * u) ** .6) * (1 if u < 0 else (1 - .25 * u))
        h = depth * (1 - .4 * u * u)
        ring = []
        for j in range(9):
            a = math.pi * j / 8
            ring.append((u * length / 2, half * math.cos(a), -h * math.sin(a) * .9 + depth * .1 * u * u))
        rings.append(ring)
    vv = []
    ff = []
    ca, sa = math.cos(heading), math.sin(heading)
    for ring in rings:
        for x, y, z in ring:
            vv.append((c.x + x * ca - y * sa, c.y + x * sa + y * ca, c.z + z))
    m = 9
    for k in range(n):
        for j in range(m - 1):
            a0 = k * m + j
            ff.append((a0, a0 + 1, a0 + m + 1, a0 + m))
    ob = recalc(kit.tag(kit.mesh(aid + '.hull', vv, ff, material, col, True), aid))
    kit.boxc(aid, col, 'thwarts', c + Vector((0, 0, -.25 * depth)), (length * .7, beam * .8, .05), 'wood')
    if covered:
        kit.boxc(aid, col, 'cover', c + Vector((0, 0, .02)), (length * .8, beam * .85, .1), 'canvas', yaw=heading)
    return ob


def boats(D, kit):
    col = kit.collections['Boats and aviation']
    # 26 ft whaleboats (am091, 7.94 x 1.99 m) in radial davits in the waist, keel at 6.0 m.
    for s in (-1, 1):
        aid = f'whaleboat-{"port" if s < 0 else "starboard"}'
        c = V(s * 7.8, 7.3, 11.34)
        boat(kit, aid, col, c, 7.9, 1.95, 1.2, covered=True)
        for z in (8.21, 14.47):
            daid = aid + '-davits'
            foot = V(s * 8.72, 3.64, z)
            kit.part('rod', daid, col, 'davit post', foot, V(s * 8.72, 7.2, z), .12, 'naval', vertices=10)
            kit.part('rod', daid, col, 'davit arm', V(s * 8.72, 7.2, z), V(s * 8.2, 8.3, z), .1, 'naval', vertices=10)
            kit.part('rod', daid, col, 'davit head', V(s * 8.2, 8.3, z), V(s * 7.8, 8.35, z), .09, 'naval', vertices=10)
            kit.wire(daid, col, V(s * 7.8, 8.35, z), V(s * 7.8, 7.75, z), .015, False)
            kit.cylz(daid, col, 'davit foot', foot, .22, .12, 'edge', 12)
        for z in (9.6, 13.1):
            kit.member(aid, col, V(s * 7.8, 6.2, z), V(s * 8.72, 6.2, z), .06, 'edge', 6)
    # Dinghies (am058, 3.07 x 2.14 m) on the hangar roof, on chocks.
    for x, z in ((-3.1, 31.01), (2.16, 35.48)):
        aid = f'dinghy-{"port" if x < 0 else "starboard"}'
        boat(kit, aid, col, V(x, 10.3, z), 3.05, 1.6, .55)
        for dz in (-.8, .8):
            kit.boxc(aid, col, 'chock', V(x, 9.83, z + dz), (.15, 1.2, .16), 'wood')
    # Carley floats stowed on edge beside the forward funnel casing (am054, 3.07 x 1.66 m).
    for s in (-1, 1):
        aid = f'floats-{"port" if s < 0 else "starboard"}'
        c = V(s * 1.81, 8.75, -14.33)
        ring = [(1.4 * math.cos(math.tau * i / 20), .72 * math.sin(math.tau * i / 20)) for i in range(20)]
        for i, (a, b) in enumerate(ring):
            p, q = ring[(i + 1) % 20]
            # painted grey with a dark grating, as the reference's texture shows them
            kit.member(aid, col, c + Vector((a, 0, b)), c + Vector((p, 0, q)), .13, 'naval', 8)
        kit.boxc(aid, col, 'grating', c, (2.4, .04, .9), 'edge')
        kit.boxc(aid, col, 'rack', c - Vector((0, -s * .15, .75)), (2.6, .1, .08), 'edge')


# ---------------------------------------------------------------- searchlights
def searchlight(kit, aid, col, base, drum, bearing=0.0, pedestal=1.0):
    try:
        floor = kit.support.below(base.x, base.y, base.z + .25)
    except ValueError:
        floor = base.z
    drop = base.z - floor if base.z - floor < 1.6 else 0
    kit.cylz(aid, col, 'pedestal', base - Vector((0, 0, drop)), .18, pedestal + drop, 'naval', 12)
    kit.cylz(aid, col, 'pedestal foot', base - Vector((0, 0, drop)), .3, .08, 'edge', 12)
    top = base + Vector((0, 0, pedestal))
    kit.boxc(aid, col, 'yoke', top + Vector((0, 0, .1)), (.3, drum * 1.3, .2), 'naval')
    for s in (-1, 1):
        kit.boxc(aid, col, 'yoke arm', top + Vector((0, s * drum * .62, drum * .45)), (.12, .08, drum * .9), 'naval')
    d = Vector((math.cos(bearing), math.sin(bearing), 0))
    c = top + Vector((0, 0, drum * .6))
    kit.part('rod', aid, col, 'drum', c - d * drum * .45, c + d * drum * .45, drum / 2, 'naval', vertices=20)
    kit.part('rod', aid, col, 'lens', c + d * drum * .45, c + d * drum * .47, drum * .46, 'glass', vertices=20)
    kit.part('rod', aid, col, 'vent cap', c - d * drum * .5, c - d * drum * .3, drum * .3, 'edge', vertices=12)


def searchlights(D, kit):
    col = kit.collections['Sensors and masts']
    # 900 mm lights on the midships platforms (am037) and 600 mm lights on the bridge (am038).
    for i, (x, y, z) in enumerate([(1.71, 12.93, -7.06), (-1.73, 12.93, -4.54)], 1):
        searchlight(kit, f'searchlight-900-{i}', col, V(x, y, z), .95, 0, 1.0)
    for i, (x, y, z, b) in enumerate([(0, 14.7, -33.1, 0), (-4.12, 13.16, -19.18, math.pi / 2), (4.12, 13.16, -19.18, -math.pi / 2)], 1):
        searchlight(kit, f'searchlight-600-{i}', col, V(x, y, z), .62, b, .7)


# ---------------------------------------------------------------- deck gear
def deck_gear(D, kit):
    col = kit.collections['Deck fittings']
    aid = 'deck-gear'
    B = [(-8.07, 6.57, -21.8), (-7.6, 4.04, 53.38), (-6.18, 7.15, -51.32), (-4.86, 4.43, 80.25), (-3.6, 8.16, -74.54), (0.0, 8.88, -84.78),
         (3.6, 8.16, -74.54), (4.86, 4.43, 80.25), (6.18, 7.15, -51.32), (7.6, 4.04, 53.38), (8.07, 6.57, -21.8)]
    for x, y, z in B:
        foot = deck(kit, z) if abs(x) > .1 or z > -84 else y - .42
        for dz in (-.42, .42):
            kit.cylz(aid, col, 'bollard', V(x, foot, z + dz), .17, .62, 'naval', 12)
            kit.cylz(aid, col, 'bollard cap', V(x, foot + .6, z + dz), .21, .06, 'naval', 12)
        kit.boxc(aid, col, 'bollard base', V(x, foot + .03, z), (1.4, .5, .06), 'naval')
    FAIRLEADS = [(-8.64, -19.5), (-8.49, -25.75), (-8.39, 47.75), (-7.82, 59.08), (-7.21, -45.98), (-6.41, 73.49), (-6.27, -56.12), (-4.85, -69.17),
                 (-4.6, 83.79), (-3.52, -78.72)]
    for x, z in FAIRLEADS:
        for s in (-1, 1):
            xx = s * abs(x)
            y = deck(kit, z)
            kit.boxc(aid, col, 'fairlead', V(xx, y + .12, z), (.6, .24, .24), 'naval')
            kit.part('rod', aid, col, 'fairlead roller', V(xx, y + .2, z - .25), V(xx, y + .2, z + .25), .08, 'edge', vertices=8)
    # Capstans (am088) and the anchors in their hawse pipes (cm006, 4.3 m).
    for s in (-1, 1):
        # The caps stop at the reference's 7.72 m, under the sweep of No. 1 turret's overhang trained aft.
        y = deck(kit, -61.68)
        kit.cylz(aid, col, 'capstan', V(s * 1.8, y, -61.68), .32, 7.66 - y, 'naval', 16, r2=.26)
        kit.cylz(aid, col, 'capstan cap', V(s * 1.8, 7.66, -61.68), .36, .06, 'edge', 16)
        # Chain from the capstan to the hawse pipe, along the deck.
        hy = deck(kit, -79.5)
        kit.member(aid, col, V(s * 1.8, y + .07, -62.1), V(s * 2.2, hy + .07, -79.3), .07, 'edge', 6)
        hx = hull_half(kit, -81.0, 6.4)
        shank_top = V(s * (hx + .12), 7.4, -81.6)
        shank_low = V(s * (hx + .22), 5.4, -80.6)
        kit.part('rod', aid, col, 'hawse pipe lip', V(s * (hx - .05), 7.55, -81.7), V(s * (hx + .12), 7.45, -81.65), .32, 'edge', vertices=12)
        kit.part('rod', aid, col, 'anchor shank', shank_top, shank_low, .14, 'dark', vertices=8)
        kit.boxc(aid, col, 'anchor crown', shank_low + Vector((0, 0, -.2)), (.5, .5, .4), 'dark')
        for d in (-1, 1):
            kit.part('rod', aid, col, 'anchor fluke', shank_low + Vector((0, 0, -.2)), shank_low + Vector((d * .9, s * .25, .6)), .12, 'dark', r2=.05, vertices=6)
    # Mushroom and cowl ventilators, hatches and the boat winch.
    for x, y, z, r, h in [(-1.97, 3.68, 63.43, .74, 1.04), (1.97, 3.68, 63.43, .74, 1.04), (0.01, 4.02, 78.36, .78, 1.16),
                          (-2.15, 7.66, -72.0, .25, .7), (-1.77, 7.6, -70.92, .25, .7), (0.0, 7.56, -70.25, .25, .7), (2.14, 7.6, -70.92, .25, .7)]:
        kit.cylz(aid, col, 'vent trunk', V(x, y, z), r * .45, h * .7, 'naval', 16)
        kit.cylz(aid, col, 'vent head', V(x, y + h * .7, z), r, h * .3, 'naval', 20, r2=r * .75)
    for x, y, z, sx, sz, h in [(-1.92, 3.74, 61.2, .9, .75, .33), (1.92, 3.74, 61.2, .9, .75, .33), (0.0, 8.68, -86.22, .9, .75, .33), (0.03, 7.63, -71.69, .9, .75, .33),
                               (-1.92, 3.81, 65.2, .9, 1.35, .49), (1.92, 3.81, 65.2, .9, 1.35, .49), (-1.51, 6.68, -49.17, .9, 1.35, .49),
                               (1.51, 6.68, -49.17, .9, 1.35, .49), (0.0, 3.83, 76.05, .9, 1.35, .49), (0.0, 7.92, -77.37, .9, 1.35, .49)]:
        kit.boxc(aid, col, 'hatch', V(x, y + h / 2, z), (sz, sx, h), 'naval')
        kit.boxc(aid, col, 'hatch lid', V(x, y + h + .02, z), (sz + .06, sx + .06, .04), 'edge')
    wy = seat(kit, 0.04, 3.95, 65.65)
    kit.boxc(aid, col, 'boat winch', V(0.04, wy + .28, 65.65), (2.4, 1.6, .55), 'naval')
    for s in (-1, 1):
        kit.part('rod', aid, col, 'winch drum', V(s * .75, wy + .33, 65.2), V(s * .75, wy + .33, 66.1), .28, 'edge', vertices=14)
    # Smoke generators on the stern (am011).
    for s in (-1, 1):
        y = deck(kit, 87.43)
        kit.boxc(aid, col, 'smoke generator frame', V(s * 1.82, y + .1, 87.43), (1.4, .7, .2), 'edge')
        for dz in (-.35, .35):
            kit.part('rod', aid, col, 'smoke canister', V(s * 1.82, y + .25, 87.43 + dz), V(s * 1.82, y + 1.2, 87.43 + dz), .3, 'naval', vertices=12)
    # Paravanes by No. 2 turret and abreast the bridge (am077).
    for s in (-1, 1):
        for x, y, z, up in [(2.74, 8.16, -47.0, True), (3.29, 9.27, -20.42, False)]:
            foot = seat(kit, s * x, y - (1.5 if up else .8), z, 2.0)
            if up:
                c = V(s * x, foot + 1.35, z)
                kit.part('rod', aid, col, 'paravane body', c - Vector((0, 0, 1.3)), c + Vector((0, 0, 1.2)), .2, 'naval', r2=.12, vertices=10)
                kit.boxc(aid, col, 'paravane plane', c + Vector((0, 0, -.2)), (.05, 1.1, 1.1), 'naval')
                kit.boxc(aid, col, 'paravane crutch', V(s * x, foot + .15, z), (.5, .5, .3), 'edge')
            else:
                # Stowed on a rack at the reference's height (8.4 m) over the forecastle deck.
                deck_y = seat(kit, s * x, y - .8, z, 4.0)
                c = V(s * x, 8.85, z)
                kit.part('rod', aid, col, 'paravane body', c - Vector((1.4, 0, 0)), c + Vector((1.4, 0, 0)), .2, 'naval', r2=.12, vertices=10)
                kit.boxc(aid, col, 'paravane plane', c, (1.1, .05, .8), 'naval')
                for dz in (-.9, .9):
                    kit.boxc(aid, col, 'paravane cradle', V(s * x, 8.6, z + dz), (.14, .5, .12), 'edge')
                    for dx in (-.22, .22):
                        kit.part('rod', aid, col, 'rack post', V(s * x + dx, deck_y, z + dz), V(s * x + dx * .5, 8.62, z + dz), .04, 'naval', vertices=6)
    # Ready-use lockers by the guns (new_orleans_lockers.py).
    for x, y, z, sx, sy, sz in LOCKERS:
        foot = seat(kit, x, y - sy / 2, z, .6)
        y = foot + sy / 2
        kit.boxc(aid, col, 'ready-use locker', V(x, y, z), (sz, sx, sy), 'naval')
        kit.boxc(aid, col, 'locker lid', V(x, y + sy / 2 + .015, z), (sz + .04, sx + .04, .03), 'edge')
    # Sky lookouts (am061), bridge binoculars (am463) and the RDF loop (am115).
    for x, y, z in [(-1.66, 16.03, 42.06), (1.66, 16.03, 42.05), (-1.19, 21.97, -22.57), (1.19, 21.97, -22.57)]:
        y = seat(kit, x, y, z)
        kit.cylz(aid, col, 'lookout pedestal', V(x, y, z), .12, 1.18, 'naval', 10)
        kit.boxc(aid, col, 'lookout seat', V(x, y + .7, z + .3), (.4, .45, .06), 'edge')
        kit.member(aid, col, V(x, y + .7, z + .08), V(x, y + .7, z + .3), .03, 'edge', 5)
        kit.part('rod', aid, col, 'lookout glass', V(x, y + 1.25, z - .2), V(x, y + 1.25, z + .25), .09, 'edge', vertices=8)
    for x, y, z in [(-3.16, 19.9, -29.42), (3.16, 19.9, -29.42)]:
        y = seat(kit, x, y, z)
        kit.cylz(aid, col, 'binocular pedestal', V(x, y, z), .1, 1.33, 'naval', 10)
        kit.boxc(aid, col, 'binocular yoke', V(x, y + 1.36, z - .05), (.2, .34, .08), 'edge')
        kit.part('rod', aid, col, 'binocular', V(x - .12, y + 1.45, z - .3), V(x - .12, y + 1.45, z + .15), .08, 'edge', vertices=8)
        kit.part('rod', aid, col, 'binocular', V(x + .12, y + 1.45, z - .3), V(x + .12, y + 1.45, z + .15), .08, 'edge', vertices=8)
    kit.part('rod', aid, col, 'RDF post', V(0, 15.4, -19.12), V(0, 16.5, -19.12), .04, 'edge', vertices=6)
    for k in range(12):
        a, b = math.tau * k / 12, math.tau * (k + 1) / 12
        kit.member(aid, col, V(0, 16.55 + .32 * math.sin(a), -19.12 + .32 * math.cos(a)), V(0, 16.55 + .32 * math.sin(b), -19.12 + .32 * math.cos(b)), .025, 'edge', 5)
    # Life buoys on the rails (am549, am489) and fenders.
    for x, y, z in [(-6.76, 4.43, 70.87), (-4.48, 8.18, -72.25), (4.48, 8.18, -72.25), (6.76, 4.43, 70.87)]:
        for k in range(12):
            a, b = math.tau * k / 12, math.tau * (k + 1) / 12
            kit.member(aid, col, V(x, y + .3 * math.sin(a), z + .3 * math.cos(a)), V(x, y + .3 * math.sin(b), z + .3 * math.cos(b)), .06, 'white', 6)
    # Starboard accommodation ladder stowed along the forecastle side (cm025).
    kit.beam(aid, col, 'accommodation ladder', V(8.04, 6.45, -40.8), V(8.04, 6.45, -31.9), .9, .12, 'naval')
    for i in range(12):
        z = -40.5 + i * .75
        kit.boxc(aid, col, 'ladder tread', V(8.04, 6.53, z), (.1, .8, .04), 'edge')


# ---------------------------------------------------------------- rails
def railings(D, kit):
    """Guard rails along the open weather-deck edges (the bulwarked gun bays and waist have none); the gun arcs
    stay clear (Kit.in_arc), as the reference's collapsible rails do."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        for z0, z1 in ((-89.8, -19.7), (29.4, 88.6)):
            n = max(2, int(abs(z1 - z0) / 1.6))
            pts = []
            for i in range(n + 1):
                z = z0 + (z1 - z0) * i / n
                y = deck(kit, z)
                x = hull_half(kit, z, y - .02) - .1
                pts.append((V(s * x, y, z), y))
            for (a, _), (b, _) in zip(pts, pts[1:]):
                for h in (.5, 1.0):
                    kit.wire('railings', col, a + Vector((0, 0, h)), b + Vector((0, 0, h)), .016, True)
                kit.wire('railings', col, a, a + Vector((0, 0, 1.0)), .022, True)
            kit.wire('railings', col, pts[-1][0], pts[-1][0] + Vector((0, 0, 1.0)), .022, True)


def build(D, kit):
    walls(D, kit)
    foremast(D, kit)
    mainmast(D, kit)
    directors(D, kit)
    radars(D, kit)
    funnels(D, kit)
    catapults(D, kit)
    aircraft_crane(D, kit)
    boats(D, kit)
    searchlights(D, kit)
    deck_gear(D, kit)
    railings(D, kit)
    new_orleans_underwater.build(D, kit)
    kit.build_wires()

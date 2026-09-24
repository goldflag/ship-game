"""Kongō pagoda foremast region: reference z -48 to -18.5 above the forecastle deck.

The measured prisms give the tiers; this module adds what the reference shows on them: the
director tower with its 10 m rangefinder, the bulwarked top platform and the open yard with its
rigging, the rear tripod leg, the windows and portholes the reference paints (kongo_windows.py),
rails round exposed roofs, knees under overhangs, the high-angle directors, rangefinders and
searchlights. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from kongo_kit import P, ZC
from kongo_windows import WINDOWS

# The round director trunk replaces the two measured boxes that stand for it.
CLAIMED_STRUCTURES = {'deckhouse-049', 'platform-050'}
DIRECTOR_Z = -30.05          # reference z of the director's training axis


def zone(x, y, z):
    """Runtime point inside the pagoda region."""
    return -48 < z + ZC < -18.5 and y > 6.7


def octagon(cx, cz, hx, hz, chamfer):
    """Reference-frame plan outline (x, z) of an elongated octagon."""
    c = chamfer
    pts = [(hx - c, cz - hz), (hx, cz - hz + c), (hx, cz + hz - c), (hx - c, cz + hz),
           (-hx + c, cz + hz), (-hx, cz + hz - c), (-hx, cz - hz + c), (-hx + c, cz - hz)]
    return [(cx + x, z) for x, z in pts]


def plan(pts):
    """Reference plan points -> authoring plan points (X bow, Y port)."""
    return [(-(z - ZC), -x) for x, z in pts]


def frustum(kit, assembly, col, label, lower, upper, y0, y1, material='naval'):
    """Closed solid between two reference plan outlines with the same vertex count."""
    a, b = plan(lower), plan(upper)
    n = len(a)
    vv = [(x, y, y0) for x, y in a] + [(x, y, y1) for x, y in b]
    area = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(a, a[1:] + a[:1]))
    order = list(range(n)) if area > 0 else list(reversed(range(n)))
    ff = [tuple(reversed(order)), tuple(i + n for i in order)] + [(order[i], order[(i + 1) % n], order[(i + 1) % n] + n, order[i] + n) for i in range(n)]
    return kit.tag(kit.mesh(assembly + '.' + label, vv, ff, material, col), assembly)


def build(D, kit):
    masts = kit.cols['Sensors and masts']
    sup = kit.cols['Superstructure']
    structures = [s for s in D['structures'] if not s['id'].endswith('funnel') and s['id'] not in CLAIMED_STRUCTURES]

    # ------------------------------------------------------------ director trunk and rotating director
    A = 'main-director'
    kit.cylz(A, masts, 'trunk', P(0, 29.2, DIRECTOR_Z), 1.6, 3.75, 'naval', 32)
    kit.cylz(A, masts, 'trunk band', P(0, 31.3, DIRECTOR_Z), 1.66, .12, 'naval', 32)
    moving = [kit.cylz(A, masts, 'training ring', P(0, 32.95, DIRECTOR_Z), 1.72, .16, 'edge', 32)]
    lower = octagon(0, -30.3, 1.85, 2.45, .6)
    moving.append(kit.prism(A, masts, 'lower stage', plan(lower), 33.1, 35.0, 'naval', 'roof'))
    upper = octagon(0, -30.1, 2.05, 2.05, .6)
    moving.append(kit.prism(A, masts, 'upper stage', plan(upper), 35.0, 36.5, 'naval'))
    lip = octagon(0, -30.1, 2.3, 2.3, .67)
    moving.append(kit.prism(A, masts, 'roof lip', plan(lip), 36.5, 36.62, 'naval', 'roof'))
    moving.append(frustum(kit, A, masts, 'cap', octagon(0, -30.1, 1.85, 1.85, .54), octagon(0, -30.1, 1.1, 1.1, .32), 36.62, 37.22))
    # 10 m rangefinder through the lower stage's after part, with armoured end hoods.
    rz = -28.35
    moving.append(kit.part('rod', A, masts, 'rangefinder', P(-4.55, 34.05, rz), P(4.55, 34.05, rz), .34, 'naval', vertices=18))
    for s in (-1, 1):
        x, y, z = P(s * 4.95, 34.05, rz)
        moving.append(kit.part('box', A, masts, 'rangefinder hood', (x, y, z), (1.25, .8, 1.05), 'naval'))
        moving.append(kit.part('rod', A, masts, 'objective', (x + .62, y, z), (x + .66, y, z), .24, 'glass', vertices=14))
        moving.append(kit.part('box', A, masts, 'hood port', (x + .63, y, z), (.02, .6, .6), 'dark'))
    for dx in (-.85, 0, .85):
        x, y, z = P(dx, 34.15, -32.75)
        moving.append(kit.part('box', A, masts, 'sight port', (x + .01, y, z), (.03, .48, .44), 'dark'))
        moving.append(kit.part('rod', A, masts, 'sight lens', (x + .02, y, z), (x + .05, y, z), .15, 'glass', vertices=12))
    for s in (-1, 1):
        x, y, z = P(s * 1.86, 34.15, -30.9)
        moving.append(kit.part('box', A, masts, 'side port', (x, y + s * -.01, z), (.5, .03, .5), 'dark'))
    # Railing round the cap and the direction-finder loop on its after frame.
    ring = octagon(0, -30.1, 2.18, 2.18, .64)
    for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1]):
        moving.append(kit.part('rod', A, masts, 'cap rail post', P(ax, 36.62, az), P(ax, 37.55, az), .025, 'edge', vertices=6))
        moving.append(kit.part('rod', A, masts, 'cap rail', P(ax, 37.55, az), P(bx, 37.55, bz), .022, 'edge', vertices=6))
    moving.append(kit.part('rod', A, masts, 'loop mast', P(0, 36.62, -28.2), P(0, 40.1, -27.95), .05, 'edge', vertices=8))
    moving.append(kit.part('rod', A, masts, 'loop strut', P(0, 37.22, -29.4), P(0, 38.4, -28.1), .035, 'edge', vertices=6))
    loop = [P(0, 39.45 + .42 * math.sin(a), -28.75 + .42 * math.cos(a)) for a in [i * math.tau / 8 for i in range(8)]]
    for a, b in zip(loop, loop[1:] + loop[:1]):
        moving.append(kit.part('rod', A, masts, 'direction-finder loop', a, b, .03, 'edge', vertices=6))
    moving.append(kit.part('rod', A, masts, 'loop arm', P(0, 39.45, -28.33), P(0, 39.45, -28.05), .03, 'edge', vertices=6))
    radar_pivot('main-director.yaw', P(0, 32.95, DIRECTOR_Z), moving)

    # ------------------------------------------------------------ top platform: bulwark, binoculars, open yard
    T = 'pagoda-top'
    deck = 31.45
    outline = [(3.15, -34.3), (3.15, -25.4), (2.65, -24.9), (1.0, -24.9)] + [(-1.0, -24.9), (-2.65, -24.9), (-3.15, -25.4), (-3.15, -34.3)] + \
              [(-2.3, -35.15), (-1.2, -35.4), (1.2, -35.4), (2.3, -35.15)]
    floor = [(-3.15, -34.3), (-3.15, -25.4), (-2.65, -24.9), (2.65, -24.9), (3.15, -25.4), (3.15, -34.3), (2.3, -35.15), (1.2, -35.4), (-1.2, -35.4), (-2.3, -35.15)]
    kit.prism(T, sup, 'platform floor', plan(floor), deck - .1, deck + .01, 'naval', 'linoleum')
    wall = outline[:4] + [None] + outline[4:] + outline[:1]
    run = []
    for p in wall + [None]:
        if p is None:
            for (ax, az), (bx, bz) in zip(run, run[1:]):
                a, b = Vector(P(ax, deck, az)), Vector(P(bx, deck, bz))
                d = (b - a)
                if d.length < 1e-3:
                    continue
                n = Vector((-d.y, d.x, 0)).normalized() * .03
                vv = [tuple(a - n), tuple(b - n), tuple(b + n), tuple(a + n)]
                vv += [(v[0], v[1], v[2] + 1.05) for v in vv]
                ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
                kit.tag(kit.mesh(T + '.bulwark', vv, ff, 'naval', sup), T)
                kit.part('rod', T, sup, 'bulwark capping', tuple(a + Vector((0, 0, 1.07))), tuple(b + Vector((0, 0, 1.07))), .045, 'naval', vertices=6)
            run = []
        else:
            run.append(p)
    for i in range(10):
        a = -math.pi * .9 + i * math.pi * 1.8 / 9
        bx, bz = 2.75 * math.sin(a), -30.2 - 4.6 * math.cos(a) * .98
        if bz > -25.6:
            continue
        x, y, z = P(max(-2.85, min(2.85, bx)), deck, bz)
        kit.cylz(T, sup, 'binocular pedestal', (x, y, z), .07, 1.05, 'naval', 8)
        kit.part('box', T, sup, 'binocular', (x, y, z + 1.14), (.18, .34, .16), 'edge')
    # Columns under the platform's after overhang.
    for s in (-1, 1):
        kit.part('rod', T, sup, 'column', P(s * 2.3, 29.2, -25.6), P(s * 2.3, deck - .1, -25.6), .09, 'naval', vertices=10)
    # The open yard: diagonal booms to the rigging, an after boom and a railed walkway.
    y = deck - .05
    for s in (-1, 1):
        kit.part('rod', T, sup, 'yard boom', P(s * 2.9, y, -25.1), P(s * 7.55, y, -21.4), .08, 'naval', vertices=8)
        kit.part('rod', T, sup, 'yard brace', P(s * 1.4, 29.2, -25.9), P(s * 5.2, y, -24.1), .06, 'naval', vertices=8)
    kit.part('rod', T, sup, 'after boom', P(-7.55, y, -21.4), P(7.55, y, -21.4), .08, 'naval', vertices=8)
    kit.part('box', T, sup, 'walkway grating', P(0, deck - .03, -23.05), (3.7, 1.0, .06), 'roof')
    kit.part('rod', T, sup, 'walkway stringer', P(0, deck - .1, -24.9), P(0, deck - .1, -21.2), .07, 'naval', vertices=8)
    for s in (-1, 1):
        kit.rail(T, sup, [P(s * .5, 0, -24.9)[:2], P(s * .5, 0, -21.3)[:2]], deck, 1.0, 1.2, check=False)
    kit.rail(T, sup, [P(-.5, 0, -21.3)[:2], P(.5, 0, -21.3)[:2]], deck, 1.0, 1.2, check=False)
    ax, ay, az = P(0, deck + 1.05, -25.25)
    kit.part('rod', T, sup, 'anemometer post', (ax, ay, az - 1.05), (ax, ay, az + .5), .03, 'edge', vertices=6)
    for i in range(3):
        a = i * math.tau / 3
        kit.part('rod', T, sup, 'anemometer arm', (ax, ay, az + .5), (ax + .3 * math.cos(a), ay + .3 * math.sin(a), az + .5), .015, 'edge', vertices=5)
    # Rigging: two fans of five wires from the yard booms to the searchlight platform, and five halyards.
    top = [(5.14, -24.17), (5.71, -23.53), (6.29, -22.87), (6.91, -22.15), (7.51, -21.47)]
    low = [(3.32, -24.83), (3.15, -24.57), (3.01, -24.29), (2.84, -24.0), (2.70, -23.72)]
    for s in (-1, 1):
        for (tx, tz), (lx, lz) in zip(top, low):
            kit.wire(T, sup, P(s * tx, y, tz), P(s * lx, 18.05, lz), .012, check=False)
    for dx, tz in [(-.3, -25.3), (-.15, -24.4), (0, -23.6), (.15, -22.6), (.3, -21.7)]:
        kit.wire(T, sup, P(dx, y, tz), P(dx * 1.3, 18.05, -23.2), .01, check=False)

    # ------------------------------------------------------------ sky-control screen round the trunk (29.2-31.2 m, open aft)
    C = 'pagoda-sky-control'
    screen = [(3.0, -30.2), (3.0, -32.4), (1.5, -34.6), (-1.5, -34.6), (-3.0, -32.4), (-3.0, -30.2)]
    for (ax_, az_), (bx_, bz_) in zip(screen, screen[1:]):
        a, b = Vector(P(ax_, 29.2, az_)), Vector(P(bx_, 29.2, bz_))
        d = b - a
        n = Vector((-d.y, d.x, 0)).normalized() * .03
        vv = [tuple(a - n), tuple(b - n), tuple(b + n), tuple(a + n)]
        vv += [(v[0], v[1], v[2] + 2.0) for v in vv]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        kit.tag(kit.mesh(C + '.screen', vv, ff, 'naval', sup), C)
    band = [('window', x, 30.93, -34.6 - ZC, .45, .4, 0, -1) for x in (-1.3, -.8, -.3, .2, .7, 1.2)]
    for s in (-1, 1):
        band += [('window', s * 3.0, 30.93, z - ZC, .38, .4, s, 0) for z in (-32.2, -32.7, -33.2)]
    kit.windows(C, sup, [(k, x, y, z, w, h, nx, nz) for k, x, y, z, w, h, nx, nz in band])

    # ------------------------------------------------------------ tripod leg behind the tower
    kit.part('rod', 'pagoda-leg', sup, 'rear leg', P(0, 6.63, -23.95), P(0, 32.0, -30.25), .5, 'naval', vertices=20)
    kit.cylz('pagoda-leg', sup, 'leg shoe', P(0, 6.63, -23.95), .78, .35, 'naval', 20)

    # ------------------------------------------------------------ windows, rails and knees on the tiers
    kit.windows('pagoda-windows', sup, WINDOWS['pagoda'], zone=lambda x, y, z: not 29.2 < y < 31.3)
    # The top platform carries its own bulwark.
    kit.roof_rails('pagoda-rails', sup, structures, lambda x, y, z: zone(x, y, z) and y < 31.2)
    kit.overhang_knees('pagoda-knees', sup, structures, zone)

    # ------------------------------------------------------------ rangefinders on the pagoda
    for id, ref, width, bearing in [('rf-pagoda-port', (-2.831, 21.65, -36.311), 1.5, 0), ('rf-pagoda-starboard', (2.832, 21.65, -36.299), 1.5, 0),
                                    ('rf-secondary-port', (-4.453, 23.964, -27.489), 4.5, -90), ('rf-secondary-starboard', (4.44, 23.964, -27.489), 4.5, 90)]:
        kit.rangefinder(id, ref, width, bearing, masts)

    # ------------------------------------------------------------ high-angle directors on the pagoda wings
    for id, rx in [('ha-director-port', -6.0), ('ha-director-starboard', 6.03)]:
        s = -1 if rx < 0 else 1
        x, y, z = P(rx, 15.26, -27.946)
        kit.cylz(id, masts, 'seat', (x, y, z), 1.05, .3, 'naval', 24)
        house = octagon(rx, -27.95, 1.4, 2.35, .45)
        kit.prism(id, masts, 'housing', plan(house), 15.56, 17.6, 'naval', 'roof')
        kit.prism(id, masts, 'hood', plan(octagon(rx, -28.3, 1.1, 1.3, .35)), 17.6, 17.98, 'naval', 'roof')
        kit.part('rod', id, masts, 'rangefinder', P(rx - s * .2, 16.9, -26.4), P(rx + s * 1.65, 16.9, -26.4), .14, 'naval', vertices=12)
        kit.part('box', id, masts, 'rangefinder hood', P(rx + s * 1.65, 16.9, -26.4), (.5, .45, .5), 'naval')
        for dz in (-29.4, -28.4, -27.4, -26.4):
            gx, gy, gz = P(rx + s * 1.41, 17.1, dz)
            kit.part('box', id, masts, 'window', (gx, gy, gz), (.55, .03, .42), 'glass')

    # ------------------------------------------------------------ searchlights
    for i, ref in enumerate([(5.08, 20.75, -27.54), (-5.08, 20.75, -27.54), (2.65, 18.01, -26.29), (-2.65, 18.01, -26.29),
                             (5.9, 12.85, -21.58), (-5.9, 12.85, -21.58)], 1):
        kit.searchlight(f'searchlight-{i}', ref, masts)

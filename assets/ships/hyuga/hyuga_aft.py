"""Hyūga after region: the mainmast on the after control tower, its directors, and the quarterdeck's
aircraft deck.

The tracer followed the mainmast's pole, yard, gaff and signal gear as a stack of thin prisms; this
module claims them and draws the pole (grey below the smoke band, black above), the topmast, the two
yards with their braces, the gaff that carries the ensign, and the lamps. It adds the after Type 94
director (training) and its periscope, the two Type 94 high-angle directors on the tower's wings, the
powder catapult on its turntable at the reference's pivot and heading, and the aircraft deck the
reference lays aft of No. 6 turret: brass strips over the linoleum (the recipe paints the deck itself),
steel waterways, the aircraft trolley tracks on their chairs with the two wheeled trolleys, and the
aircraft crane's lattice boom stowed on its grated platform along the port quarter. Datums are
reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from hyuga_kit import P, ZC

# The mainmast's pole, yards and gaff were traced as thin prisms (after-tower-015 to -046).
CLAIMED_STRUCTURES = {f'after-tower-{i:03d}' for i in range(15, 47)}
BLACK_ABOVE = 31.5

# The aircraft deck (reference frame, x starboard, z aft): linoleum from the brass strip at z 97.78 forward to
# a V whose flat apex (x +-1.52) stands at z 80.2 and whose arms reach the transverse strips at z 74.74
# (x +-6.65) that run out to the waterways. Transverse brass strips every 1.254 m from the after edge, one
# along the centreline to the apex, and a border strip round the whole area. Aft of it the stern is steel.
LINO_AFT, LINO_APEX, LINO_CORNER = 97.78, 80.2, 74.74
APEX_X, CORNER_X = 1.52, 6.65
STRIP_STEP = 1.254
WATERWAY = .4


def v_front(x):
    """Reference z of the linoleum's forward (V-shaped) edge at athwartships position x."""
    ax = abs(x)
    if ax <= APEX_X:
        return LINO_APEX
    if ax >= CORNER_X:
        return LINO_CORNER
    return LINO_APEX - (ax - APEX_X) * (LINO_APEX - LINO_CORNER) / (CORNER_X - APEX_X)


def in_linoleum(x, z):
    """Whether the deck at reference (x, z) is laid with the aircraft deck's linoleum."""
    return v_front(x) <= z <= LINO_AFT


# The port quarter's blister under the aircraft deck (reference z 81.6 to 90.6), where the reference's hull is
# asymmetric: the side stands out square from the deck down to 3 m, then rounds in to the shell about 1.1 m
# above the waterline, flush with the deck on top; the crane boom's heel is hinged on its forward face.
# (z, outer half-breadth, height where it meets the shell), from station cuts of the reference hull.
BLISTER = [(81.6, 8.55, 2.2), (82.0, 8.85, 1.75), (82.6, 8.95, 1.45), (83.0, 8.93, 1.3), (84.0, 8.66, 1.15), (85.0, 8.44, 1.1),
           (86.0, 8.15, 1.08), (87.0, 7.9, 1.08), (88.0, 7.64, 1.08), (89.0, 7.37, 1.1), (90.0, 6.95, 1.4), (90.6, 6.6, 2.3)]


def blister_half(z):
    """The blister's outer half-breadth at reference z, or None outside it."""
    for (za, wa, _), (zb, wb, _) in zip(BLISTER, BLISTER[1:]):
        if za <= z <= zb:
            return wa + (wb - wa) * (z - za) / (zb - za)
    return None


def half_breadth(D, zr, y):
    """The loft's half-breadth at reference z and height y."""
    H = D['hull']
    station = H['length'] / 2 - (zr - ZC)

    def at(points):
        for (w0, y0), (w1, y1) in zip(points, points[1:]):
            if y0 <= y <= y1:
                return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (y - y0) / (y1 - y0)
        return points[-1][0] if y > points[-1][1] else points[0][0]
    secs = H['sections']
    for a, b in zip(secs, secs[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return at(a['points']) * (1 - t) + at(b['points']) * t
    return at(secs[0]['points'])


def blister_mesh(D, mesh, materials, collection):
    """The port-quarter blister as a closed shell: flat top at the deck (linoleum), square side, rounded
    bilge into the loft's shell, its inboard face hidden inside the hull."""
    rings = []
    for z, W, yb in BLISTER:
        hb, yd = deck_edge(D, z)
        top = yd + .008
        xb = half_breadth(D, z, yb) - .05
        pts = [(hb - .3, top), (W, top), (W, 3.0)]
        for i in (1, 2, 3):
            y = 3.0 - (3.0 - yb) * i / 4
            t = (3.0 - y) / (3.0 - yb)
            pts.append((W - (W - xb) * t ** 3, y))
        pts += [(xb, yb), (xb - .3, yb + .15)]
        rings.append([P(-w, y, z) for w, y in pts])
    n = len(rings[0])
    vv = [p for ring in rings for p in ring]
    ff, tops = [], []
    for i in range(len(rings) - 1):
        for j in range(n):
            if j == 0:
                tops.append(len(ff))
            ff.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
    ff += [tuple(reversed(range(n))), tuple(range((len(rings) - 1) * n, len(rings) * n))]
    ob = mesh('port-quarter-blister.shell', vv, ff, materials['hullgray'], collection)
    ob.data.materials.append(materials['linoleum'])
    for i in tops:
        ob.data.polygons[i].material_index = 1
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    ob['assemblyId'] = 'port-quarter-blister'
    return ob


def edge_half(D, z, side):
    """Deck-edge half-breadth at reference z on one side (-1 port, reference x sense), round the blister."""
    w = deck_edge(D, z)[0]
    b = blister_half(z) if side < 0 else None
    return max(w, b) if b else w


# Aircraft trolley tracks (reference x, z polylines of each rail's centre, from the top faces of the
# reference's rails): the pair from the after trolley's straight run, bent onto the long diagonal toward
# the port side abreast No. 6 turret; the two switches toward the catapult's heel; the two branches that
# turn off the diagonal near the V's apex. Gauge 1.27 m.
TRACKS = {
    'track-a': [(0.285, 100.85), (0.285, 96.07), (-8.99, 60.19)],
    'track-b': [(-0.989, 100.85), (-0.989, 96.235), (-10.27, 60.53)],
    'switch-1': [(-1.04, 95.75), (0.375, 93.06)],
    'switch-2': [(0.343, 96.07), (1.502, 93.65)],
    'branch-1': [(-5.41, 78.90), (-1.633, 82.22)],
    'branch-2': [(-4.27, 78.20), (-0.737, 81.19)],
}
GAUGE = 1.274


def build(D, kit):
    cols = kit.cols
    masts = cols['Sensors and masts']
    mainmast(kit, masts)
    after_director(kit, masts)
    ha_directors(kit, masts)
    catapult(kit, cols['Boats and aviation'])
    aircraft_deck(D, kit, cols['Boats and aviation'])
    crane_boom(D, kit, cols['Boats and aviation'])


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
    """Lower mast (1.2 m) from the tower top to the lookout platform at 32 m, the upper pole to the truck at
    46 m, the fore-and-aft aerial spar and the athwartships yards (reference silhouettes and side view)."""
    A = 'mainmast'
    foot = Vector(P(0, 19.9, 42.3))
    floor = kit.try_below(foot.x, foot.y, 20.4, 19.9)
    foot.z = floor - .02
    cap = Vector(P(0, 32.7, 42.3))
    split_black(kit, A, col, 'lower mast', tuple(foot), tuple(cap), .6, .58, 24)
    kit.part('rod', A, col, 'smoke band', tuple(Vector(P(0, 31.15, 42.3))), tuple(Vector(P(0, 31.5, 42.3))), .6, 'white', vertices=24)
    top = Vector(P(0, 46.0, 41.3))
    kit.part('rod', A, col, 'upper pole', tuple(cap + Vector((0, 0, -.3))), tuple(top), .19, 'black', vertices=12, r2=.08)
    kit.cylz(A, col, 'truck', (top.x, top.y, top.z - .05), .11, .12, 'black', 10)
    # Lookout platform at 32 m on a gusseted bracket, railed round (reference z 39.2 to 42.9).
    px0, px1 = P(0, 0, 42.9)[0], P(0, 0, 39.2)[0]
    kit.part('box', A, col, 'lookout platform', ((px0 + px1) / 2, 0, 32.0), (abs(px1 - px0), 2.2, .1), 'black')
    kit.beam(A, col, 'platform bracket', (px0, 0, 30.2), (px1 - .05, 0, 31.95), .3, .3, 'black')
    kit.rail(A, col, [(px0 + .05, -1.05), (px1 - .05, -1.05), (px1 - .05, 1.05), (px0 + .05, 1.05)], 32.05, .9, 1.0, check=False)
    # Fore-and-aft aerial spar at 32 m (reference z 33.6 to 50.1) with its braces down to the lower mast.
    sx0, sx1 = P(0, 0, 50.1)[0], P(0, 0, 33.6)[0]
    kit.member(A, col, (sx0, 0, 32.05), (sx1, 0, 32.05), .07, 'black', 8)
    for zr in (37.0, 38.8, 45.8, 47.6):
        x = P(0, 0, zr)[0]
        kit.member(A, col, (x, 0, 32.02), (foot.x + (-.55 if zr > 42.3 else .55), 0, 30.1), .04, 'black', 6)
    # Athwartships yards: 31.3 m (x +-9.0) and 39.3 m (x +-5.0), with their braces.
    yx = foot.x - .62
    kit.member(A, col, (yx, -9.0, 31.3), (yx, 9.0, 31.3), .08, 'black', 8)
    for s in (-1, 1):
        kit.member(A, col, (yx, s * 3.4, 31.3), (yx + .05, s * .5, 30.0), .045, 'black', 6)
    t = (39.3 - (cap.z - .3)) / (top.z - (cap.z - .3))
    ux = cap.x + (top.x - cap.x) * t - (.19 + (.08 - .19) * t) - .02
    kit.member(A, col, (ux, -5.0, 39.3), (ux, 5.0, 39.3), .07, 'black', 8)
    for s in (-1, 1):
        kit.member(A, col, (ux, s * 2.0, 39.3), (ux + .1, s * .1, 37.9), .035, 'black', 6)
        kit.wire(A, col, (ux, s * 4.8, 39.3), (yx, s * 8.8, 31.3), .01, False)
    # Ladder up the lower mast's after side, and the day light on its bracket.
    kit.ladder(A, col, (foot.x - .62, 0, 20.4), (cap.x - .6, 0, 31.9), (0, 1, 0), .4, .32, .03, .018, 'naval')
    lamp = foot.lerp(cap, (27.9 - foot.z) / (cap.z - foot.z))
    kit.part('box', A, col, 'day light bracket', tuple(lamp + Vector((.0, .62, 0))), (.12, .5, .1), 'naval')
    kit.cylz(A, col, 'day light', (lamp.x, lamp.y + .92, lamp.z - .25), .14, .5, 'naval', 12)


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


def deck_edge(D, zr):
    """Half-breadth and height of the loft's deck edge at reference z."""
    H = D['hull']
    station = H['length'] / 2 - (zr - ZC)
    secs = H['sections']

    def edge(points):
        top = points[-1][1]
        return max((w, y) for w, y in points if y >= top - .01)
    for a, b in zip(secs, secs[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            pa, pb = edge(a['points']), edge(b['points'])
            return pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t
    return edge((secs[0] if station < secs[0]['station'] else secs[-1])['points'])


def aircraft_deck(D, kit, col):
    """Brass strips over the linoleum, the steel waterways beside it, the trolley tracks on their chairs
    and the two aircraft trolleys (reference JM066/JM435: a wheeled carriage, a web-plate frame under two
    long girders and the float cradle sloping up aft, stayed to the deck)."""
    A = 'aircraft-deck'

    def deck(x, z):
        """Our deck under reference (x, z): the loft's deck is level athwartships at each station."""
        return deck_edge(D, z)[1]

    def lay(label, a, b, width, depth, lift, material, step=1.3):
        """A flat bar along reference (x, z) points a-b, cut into pieces that each follow the deck."""
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        for i in range(n):
            p = (a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
            q = (a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n)
            pa, pb = P(p[0], 0, p[1]), P(q[0], 0, q[1])
            kit.beam(A, col, label, (pa[0], pa[1], deck(*p) + lift), (pb[0], pb[1], deck(*q) + lift), width, depth, material)

    def strip(a, b):
        lay('brass strip', a, b, .06, .014, .008, 'brass')

    # Waterways and the border strips along them, from the V's side corners to the after edge (round the
    # port blister's outline).
    z0, z1 = BLISTER[0][0], BLISTER[-1][0]
    for s in (-1, 1):
        zs = [LINO_CORNER + (LINO_AFT - LINO_CORNER) * i / 18 for i in range(19)]
        edge = []
        if s < 0:
            zs = sorted([z for z in zs if not z0 - .3 <= z <= z1 + .3] + [z for z, _, _ in BLISTER])
        for z in zs:
            w = deck_edge(D, z)[0]
            if s < 0 and abs(z - z0) < 1e-6:
                edge += [(w, z), (blister_half(z), z)]
            elif s < 0 and abs(z - z1) < 1e-6:
                edge += [(blister_half(z), z), (w, z)]
            else:
                edge.append((edge_half(D, z, s), z))
        for (wa, za), (wb, zb) in zip(edge, edge[1:]):
            # The outline runs aft, so this normal points onto the deck (inboard, or aft/forward across the
            # blister's ends).
            d = math.hypot(wb - wa, zb - za)
            nw, nz = -(zb - za) / d, (wb - wa) / d
            for off, draw in ((WATERWAY / 2 + .02, 'waterway'), (WATERWAY, 'strip')):
                a = (s * (wa + nw * off), za + nz * off)
                b = (s * (wb + nw * off), zb + nz * off)
                if draw == 'waterway':
                    lay('waterway', a, b, WATERWAY, .014, .005, 'roof')
                else:
                    strip(a, b)
        # The V's border: across from the waterway to the corner, then up the arm to the apex.
        strip((s * (edge_half(D, LINO_CORNER, s) - WATERWAY), LINO_CORNER), (s * CORNER_X, LINO_CORNER))
        strip((s * CORNER_X, LINO_CORNER), (s * APEX_X, LINO_APEX))
    strip((-APEX_X, LINO_APEX), (APEX_X, LINO_APEX))
    strip((0, LINO_APEX), (0, LINO_AFT))
    # Transverse strips from the after edge forward, clipped by the V.
    k = 0
    while LINO_AFT - k * STRIP_STEP > LINO_CORNER + .05:
        z = LINO_AFT - k * STRIP_STEP
        xv = 0.0 if z >= LINO_APEX else APEX_X + (LINO_APEX - z) * (CORNER_X - APEX_X) / (LINO_APEX - LINO_CORNER)
        for s in (-1, 1):
            half = edge_half(D, z, s) - WATERWAY
            if half - xv > .1:
                strip((s * xv, z), (s * half, z))
        k += 1

    # Trolley tracks: flat-bottomed rails on chairs about every 1.25 m.
    for name, pts in TRACKS.items():
        for a, b in zip(pts, pts[1:]):
            lay('rail', a, b, .08, .09, .075, 'naval', 1.25)
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            ux, uz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            for i in range(int(length / 1.25) + 1):
                t = min(length - .1, .1 + i * 1.25)
                c = (a[0] + ux * t, a[1] + uz * t)
                lay('rail chair', (c[0] - ux * .09, c[1] - uz * .09), (c[0] + ux * .09, c[1] + uz * .09), .26, .05, .025, 'naval')

    # The two trolleys: the after one on the straight run, the other on the diagonal abreast the V.
    diag = (-(-8.99 - .285), -(60.19 - 96.07))
    n = math.hypot(*diag)
    trolley(kit, col, 'aircraft-trolley-aft', (-.352, 99.22), (0.0, -1.0), deck)
    trolley(kit, col, 'aircraft-trolley-forward', (-3.684, 83.3), (-diag[0] / n, -diag[1] / n), deck)


def trolley(kit, col, A, centre, forward, deck):
    """Wheeled aircraft trolley on the 1.27 m track, its float cradle rising aft. `forward` is the unit
    reference (x, z) direction toward the cradle's low end."""
    fx, fz = forward
    sx, sz = -fz, fx                        # across the track
    h0 = deck(*centre)

    def at(u, v, h):
        x, z = centre[0] + fx * u + sx * v, centre[1] + fz * u + sz * v
        ax, ay, _ = P(x, 0, z)
        return (ax, ay, h0 + h)
    g = GAUGE / 2
    rail_top = .12
    # Carriage: wheels on the rails inside two sills, cross members and the carriage deck.
    for u in (-.75, .75):
        for v in (-g, g):
            kit.part('rod', A, col, 'wheel', at(u, v - .06, rail_top + .18), at(u, v + .06, rail_top + .18), .18, 'naval', vertices=14)
        kit.part('rod', A, col, 'axle', at(u, -g - .2, rail_top + .18), at(u, g + .2, rail_top + .18), .05, 'edge', vertices=8)
    for v in (-g - .16, g + .16):
        kit.beam(A, col, 'sill', at(-1.0, v, rail_top + .2), at(1.0, v, rail_top + .2), .14, .24, 'naval')
    kit.beam(A, col, 'carriage deck', at(-1.05, 0, rail_top + .36), at(1.05, 0, rail_top + .36), 2 * g + .5, .08, 'naval')
    # Web-plate frames under the girders: trapezoids of flat bars with a W web.
    base, top = rail_top + .4, 1.55
    for v in (-.62, .62):
        for a, b in [((-.8, base), (.8, base)), ((-.8, base), (-2.0, top)), ((.8, base), (2.0, top)),
                     ((-.8, base), (-.35, top)), ((.8, base), (.35, top)), ((0, base), (-.35, top)), ((0, base), (.35, top))]:
            kit.beam(A, col, 'web', at(a[0], v, a[1]), at(b[0], v, b[1]), .03, .2, 'naval')
    # Two long girders and their cross members.
    for v in (-.62, .62):
        kit.beam(A, col, 'girder', at(-2.05, v, top + .17), at(2.05, v, top + .17), .18, .34, 'naval')
        for u in (-1.6, -.55, .55, 1.6):
            kit.part('rod', A, col, 'lightening hole', at(u, v - .095, top + .17), at(u, v + .095, top + .17), .08, 'dark', vertices=10)
    for u in (-1.95, -.65, .65, 1.95):
        kit.beam(A, col, 'cross girder', at(u, -.62, top + .24), at(u, .62, top + .24), .12, .2, 'naval')
    # Float cradle: side rails sloping up aft to two posts with a head bar, transoms and braces.
    lo, hi = top + .36, top + 1.2
    for v in (-.5, .5):
        kit.member(A, col, at(1.3, v, lo), at(-1.25, v, hi), .045, 'naval', 4)
        kit.member(A, col, at(-1.25, v, top + .34), at(-1.25, v, hi + .28), .05, 'naval', 4)
        kit.member(A, col, at(.15, v, top + .34), at(.15, v, lo + (hi - lo) * (1.3 - .15) / 2.55), .035, 'naval', 4)
        kit.member(A, col, at(-.55, v, top + .34), at(-1.25, v, hi), .03, 'naval', 4)
    kit.member(A, col, at(-1.25, -.5, hi + .28), at(-1.25, .5, hi + .28), .045, 'naval', 4)
    for u in (1.3, .4, -.45):
        h = lo + (hi - lo) * (1.3 - u) / 2.55
        kit.member(A, col, at(u, -.5, h), at(u, .5, h), .035, 'naval', 4)
    # Stays from the girders' ends to eyes on the deck.
    for u in (-2.0, 2.0):
        for v in (-1, 1):
            kit.wire(A, col, at(u, v * .62, top + .05), at(u * 1.2, v * 1.45, .01), .012, False)
            kit.part('rod', A, col, 'deck eye', at(u * 1.2, v * 1.45, 0), at(u * 1.2, v * 1.45, .05), .05, 'edge', vertices=8)


def crane_boom(D, kit, col):
    """The aircraft crane's lattice boom stowed on its grated platform along the port quarter (reference
    z 66 to 82.3): the platform outboard of the shell a little below the deck edge on knees, the boom
    tapering from its heel, hinged on the blister's forward face, to the head forward."""
    A = 'crane-boom'
    # Platform outline: the reference's outer edge, and our shell at the platform's height.
    outer = [(-10.3, 65.9), (-11.9, 68.6), (-11.8, 71.0), (-10.9, 74.0), (-10.0, 78.0), (-9.1, 82.0), (-9.05, 82.3)]
    top = deck_edge(D, 75.0)[1] - .46
    bottom = top - .24
    inner = []
    for x, z in reversed(outer):
        ax, ay, _ = P(-13.5, 0, z)
        hit = kit.try_along((ax, ay, top - .12), (0, -1, 0), 6.0)
        half = hit.y if hit else deck_edge(D, z)[0]
        inner.append((-(half - .06), z))
    plan = [P(x, 0, z)[:2] for x, z in outer + inner]
    kit.prism(A, col, 'grating', plan, bottom, top, 'naval', 'painted-edge')
    # Knees from the platform's outer edge down to the shell.
    for (x0, z0), (x1, z1) in zip(outer, outer[1:]):
        n = max(1, round(math.hypot(x1 - x0, z1 - z0) / 2.2))
        for i in range(n):
            x, z = x0 + (x1 - x0) * (i + .5) / n, z0 + (z1 - z0) * (i + .5) / n
            ox, oy, _ = P(x + .25, 0, z)
            hit = kit.try_along((ox, oy, bottom - .9), (0, -1 if oy > 0 else 1, 0), 4.0)
            if hit is None:
                continue
            kit.member(A, col, (ox, oy, bottom + .02), (hit.x, hit.y + .03, bottom - .9), .05, 'naval', 4)
    # The boom: a four-chord lattice from its heel (reference z 81.45) to its head (z 68.55), the axis
    # x = -10.905 + (z - 70) * 0.2287, lying on the platform.
    def axis(z):
        return -10.905 + (z - 70.0) * .2287

    def section(z):
        t = max(0.0, min(1.0, (z - 68.55) / (77.0 - 68.55)))
        return .5 + .45 * t, .42 + .2 * t          # width, depth
    z_head, z_heel = 68.55, BLISTER[0][0] - .15
    stations = [z_head + (z_heel - z_head) * i / 14 for i in range(15)]
    base = top + .05

    def corner(z, s, u):
        w, d = section(z)
        return P(axis(z) + s * w / 2, base + (d if u else 0), z)
    for s in (-1, 1):
        for u in (0, 1):
            for za, zb in zip(stations, stations[1:]):
                kit.member(A, col, corner(za, s, u), corner(zb, s, u), .045, 'naval', 4)
    for i, (za, zb) in enumerate(zip(stations, stations[1:])):
        for s in (-1, 1):
            kit.member(A, col, corner(za, s, i % 2), corner(zb, s, 1 - i % 2), .03, 'edge', 4)
        kit.member(A, col, corner(za, -1, 1), corner(zb, 1, 1), .03, 'edge', 4)
        kit.member(A, col, corner(za, -1, 1), corner(za, 1, 1), .03, 'naval', 4)
        kit.member(A, col, corner(za, -1, 0), corner(za, 1, 0), .03, 'naval', 4)
    for s in (-1, 1):
        kit.member(A, col, corner(z_heel, s, 0), corner(z_heel, s, 1), .045, 'naval', 4)
    kit.member(A, col, corner(z_head, -1, 1), corner(z_head, 1, 1), .045, 'naval', 4)
    # Head sheave, and the heel pin in its bracket on the blister's forward face.
    hx, hy, hz = P(axis(z_head), base + .3, z_head - .15)
    kit.sheave(A, col, (hx, hy, hz), (0, 1, 0), .22, .12, 'naval')
    bx, by, _ = P(axis(z_heel), 0, (z_heel + BLISTER[0][0] + .02) / 2)
    kit.part('box', A, col, 'heel bracket', (bx, by, top + .35), (BLISTER[0][0] + .02 - z_heel, 1.1, .8), 'naval')
    kit.part('rod', A, col, 'heel pin', P(axis(z_heel) - .55, top + .35, z_heel - .05), P(axis(z_heel) + .55, top + .35, z_heel - .05), .09, 'edge', vertices=10)

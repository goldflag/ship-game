"""Fusō midships region: the funnel and its fittings, the boats and the davits (reference z -40 to 34).

Owns the funnel's black cap band, cage grill and steam pipes, the tapered forward casing, the lattice tower under the
after searchlight platform, the Type 13 radar antennas on the funnel's sides,
the midships searchlights on their platforms, the two 9 m cutters beside the pagoda, four 12 m motor launches and
two 15 m motor boats on the forecastle deck with their chocks, and the stowed radial davits on the casemate ledge.
Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Matrix, Vector
from fuso_kit import P, ZC
from fuso_fittings import SMALL_FITTINGS

# Blocks at the motor boats' bounds give No. 4 turret's interlock something to stop at; this module draws the boats.
# The forward casing's block takes its mean breadth; this module draws its taper.
CLAIMED_STRUCTURES = {'motor-boat-port', 'motor-boat-starboard', 'funnel-casing'}
FUNNEL_TOP = 23.88       # the casing's rim; the casing is the blueprint's 'funnel' block (3.96 m by 5.86 m about z 9.76)
# Steam pipes up the after half of each side (reference plan cuts from the deck to 23 m): x, z and radius, starboard.
STEAM_PIPES = [(2.2, 9.97, .125), (2.2, 10.44, .13), (2.19, 10.97, .13), (2.055, 11.445, .125), (1.915, 11.84, .115)]
SIREN_PIPE = (1.99, 7.91, .115)       # the tall pipe at each forward quarter, to its T head at 24.6 m


def build(D, kit):
    cols = kit.cols
    funnel(kit, cols['Superstructure'])
    forward_casing(kit, cols['Superstructure'])
    searchlight_tower(kit, cols['Superstructure'])
    type13_radars(kit, cols['Sensors and masts'])
    searchlights(kit, cols['Sensors and masts'])
    boats(kit, cols['Boats and aviation'])
    davits(kit, cols['Boats and aviation'])


def outline(kit, grow=0.0):
    """The funnel casing's plan outline, reference frame (x, z), grown outward by `grow` metres."""
    s = next(s for s in kit.D['structures'] if s['id'] == 'funnel')
    pts = [(x, z + ZC) for x, z in s['footprint']]
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
    turn = 1 if area > 0 else -1
    out = []
    n = len(pts)
    for i, (x, z) in enumerate(pts):
        (ax, az), (bx, bz) = pts[i - 1], pts[(i + 1) % n]
        normals = []
        for (px, pz), (qx, qz) in (((ax, az), (x, z)), ((x, z), (bx, bz))):
            L = math.hypot(qx - px, qz - pz) or 1
            normals.append(((qz - pz) / L * turn, -(qx - px) / L * turn))
        nx, nz = normals[0][0] + normals[1][0], normals[0][1] + normals[1][1]
        L = math.hypot(nx, nz) or 1
        # Keep the offset distance square to the edges at a corner.
        k = grow / max(.5, (nx * normals[0][0] + nz * normals[0][1]) / L)
        out.append((x + nx / L * k, z + nz / L * k))
    return out


def chord(poly, axis, value):
    """Where the line x = value (axis 0) or z = value (axis 1) crosses a convex outline: (lo, hi) of the other
    coordinate, or None."""
    hits = []
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        a, b = (ax, bx) if axis == 0 else (az, bz)
        if (a - value) * (b - value) <= 0 and a != b:
            t = (value - a) / (b - a)
            hits.append(az + (bz - az) * t if axis == 0 else ax + (bx - ax) * t)
    return (min(hits), max(hits)) if len(hits) >= 2 else None


def wall_x(kit, z):
    """Half-breadth of the casing at reference z."""
    span = chord(outline(kit), 1, z)
    return span[1] if span else 1.9


def funnel(kit, col):
    """The casing's black cap band, rim, uptake and cage grill; the steam pipes up the after half of each side and the
    tall pipe at each forward quarter, on brackets; rungs up the after end."""
    A = 'funnel-fittings'
    band = [P(x, 0, z)[:2] for x, z in outline(kit, .025)]
    kit.prism(A, col, 'cap band', band, FUNNEL_TOP - 1.8, FUNNEL_TOP + .02, 'black')
    kit.prism(A, col, 'cap rim', [P(x, 0, z)[:2] for x, z in outline(kit, .08)], FUNNEL_TOP - .06, FUNNEL_TOP + .06, 'black')
    inner = outline(kit, -.12)
    kit.prism(A, col, 'uptake', [P(x, 0, z)[:2] for x, z in inner], FUNNEL_TOP - .5, FUNNEL_TOP + .03, 'dark')
    # Cage grill: bars fore and aft and athwartships over the uptake, with posts from the rim.
    grill = FUNNEL_TOP + .45
    for i in range(-3, 4):
        span = chord(inner, 0, i * .55)
        if span:
            kit.member(A, col, P(i * .55, grill, span[0] + .05), P(i * .55, grill, span[1] - .05), .04, 'black', 6)
    zs = [z for _, z in inner]
    for k in range(1, 6):
        zz = min(zs) + (max(zs) - min(zs)) * k / 6
        span = chord(inner, 1, zz)
        if span:
            kit.member(A, col, P(span[0] + .05, grill, zz), P(span[1] - .05, grill, zz), .04, 'black', 6)
    ring = outline(kit, -.05)
    cx, cz = sum(x for x, _ in ring) / len(ring), sum(z for _, z in ring) / len(ring)
    for x, z in ring[::max(1, len(ring) // 8)]:
        kit.member(A, col, P(x, FUNNEL_TOP, z), P(cx + (x - cx) * .93, grill, cz + (z - cz) * .95), .04, 'black', 6)
    # Steam pipes: from the base blocks up the after half of each side into the cap band, flared at the mouth.
    for s in (-1, 1):
        for x, z, r in STEAM_PIPES:
            px, py, _ = P(s * x, 0, z)
            foot = kit.floor(px, py, 12.3)
            foot = 12.2 if foot is None else foot
            top = 23.1
            kit.part('rod', A, col, 'steam pipe', (px, py, foot), P(s * x, top, z), r, 'naval', vertices=10)
            kit.part('rod', A, col, 'steam pipe mouth', P(s * x, top - .02, z), P(s * x, top + .22, z), r, 'dark', vertices=10, r2=r * 1.35)
            for y in (15.2, 18.6, 21.9):
                kit.member(A, col, P(s * x, y, z), P(s * (wall_x(kit, z) - .03), y, z), .03, 'naval', 4)
        # The tall pipe at the forward quarter, with its T head above the rim.
        x, z, r = SIREN_PIPE
        px, py, _ = P(s * x, 0, z)
        foot = kit.floor(px, py, 12.3)
        foot = 12.2 if foot is None else foot
        kit.part('rod', A, col, 'siren pipe', (px, py, foot), P(s * x, 24.45, z), r, 'naval', vertices=10)
        kit.part('rod', A, col, 'siren head', P(s * x, 24.45, z - .3), P(s * x, 24.45, z + .3), r * 1.15, 'naval', vertices=10)
        for y in (15.2, 18.6, 21.9):
            kit.member(A, col, P(s * x, y, z), P(s * (wall_x(kit, z) - .03), y, z), .03, 'naval', 4)
    # Rungs up the after end.
    aft = max(z for _, z in outline(kit))
    kit.ladder(A, col, P(0, 12.35, aft + .12), P(0, FUNNEL_TOP - .1, aft + .12), (0, 1, 0), .42, .35, .03, .02, 'naval')


def forward_casing(kit, col):
    """The casing ahead of the funnel under the forward searchlight platform (reference plan cuts 12.4-15.0 m): 4.2 m
    across at its foot tapering to 2.7 m at 15.43 m, from 3.59 m aft to the funnel's forward end."""
    A = 'funnel-casing'
    y0, y1, z0, z1 = 12.22, 15.43, 3.59, 6.95
    vv = []
    for y, half in ((y0, 2.11), (y1, 1.34)):
        for x, z in ((-half, z0), (half, z0), (half, z1), (-half, z1)):
            vv.append(P(x, y, z))
    ff = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = kit.mesh(A + '.casing', vv, ff, 'naval', col)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
    ob.data.materials.append(kit.m['roof'])
    for poly in ob.data.polygons:
        if poly.normal.z > .8:
            poly.material_index = 1
    kit.tag(ob, A)


def searchlight_tower(kit, col):
    """The tapered lattice tower under the after searchlight platform (reference plan cuts 9.8-15.2 m: flat-bar legs
    x 2.5 m out at the deck closing to 1.25 m under the platform at 15.43 m, the forward pair at reference z 13.0 to
    13.25 and the after pair at 14.75, X-braced on its sides and after face)."""
    A = 'searchlight-tower'
    top = 15.42
    legs = []
    for s in (-1, 1):
        for zb, zt in ((13.0, 13.25), (14.75, 14.75)):
            bx, by, _ = P(s * 2.5, 0, zb)
            foot = kit.floor(bx, by, 10.5)
            foot = 9.03 if foot is None else foot
            legs.append((s, zb, zt, Vector((bx, by, foot)), Vector(P(s * 1.25, top, zt))))
            kit.beam(A, col, 'leg', (bx, by, foot - .02), P(s * 1.25, top + .02, zt), .3, .1, 'naval')

    def at(s, zb, zt, y):
        leg = next(l for l in legs if l[0] == s and l[1] == zb)
        a, b = leg[3], leg[4]
        t = (y - a.z) / (b.z - a.z)
        return a.lerp(b, max(0, min(1, t)))
    base = min(l[3].z for l in legs)
    levels = [base + .3 + (top - base - .5) * k / 3 for k in range(4)]
    for s in (-1, 1):
        for y0, y1 in zip(levels, levels[1:]):
            kit.xbrace(A, col, at(s, 13.0, 13.25, y0), at(s, 14.75, 14.75, y0), at(s, 14.75, 14.75, y1), at(s, 13.0, 13.25, y1), .035)
        for y in levels:
            kit.member(A, col, at(s, 13.0, 13.25, y), at(s, 14.75, 14.75, y), .045, 'naval', 6)
    for y0, y1 in zip(levels, levels[1:]):
        kit.xbrace(A, col, at(-1, 14.75, 14.75, y0), at(1, 14.75, 14.75, y0), at(1, 14.75, 14.75, y1), at(-1, 14.75, 14.75, y1), .035)
    for y in levels:
        for zb, zt in ((13.0, 13.25), (14.75, 14.75)):
            kit.member(A, col, at(-1, zb, zt, y), at(1, zb, zt, y), .045, 'naval', 6)


def type13_radars(kit, col):
    """Type 13 air-search antennas on the funnel's sides (reference HP_JRS_3/4, jrs010 bounds): a laced column 0.46 m
    across and 0.42 m fore and aft from 17.7 to 21.8 m on a foot and under a cap, carrying four dipole frames 1.11 m
    apart, each a fore-and-aft element 2.0 m long outboard of the column and 1.7 m inboard; bracket plates from the
    casing under the foot and over the cap."""
    for id, s in [('type13-port', -1), ('type13-starboard', 1)]:
        x, z = 3.17 * s, 8.87
        kit.lattice(id, col, P(x, 17.77, z), P(x, 21.77, z), .46, .42, n=5, chord=.035, web=.018)
        # The fore and aft faces are laced in seven crossed panels, as the reference's front view shows.
        levels = [17.77 + 4.0 * k / 7 for k in range(8)]
        for zf in (z - .21, z + .21):
            for y0, y1 in zip(levels, levels[1:]):
                kit.xbrace(id, col, P(x - .23, y0, zf), P(x + .23, y0, zf), P(x + .23, y1, zf), P(x - .23, y1, zf), .016, 'edge')
        kit.part('box', id, col, 'foot', P(x, 17.58, z), (.55, .53, .38), 'naval')
        kit.part('box', id, col, 'cap', P(x, 21.87, z), (.55, .53, .2), 'naval')
        wall = wall_x(kit, z) - .02
        for yy in (17.345, 22.015):
            inner, outer = P(s * wall, yy, z), P(s * 3.22, yy, z)
            kit.part('box', id, col, 'bracket plate', ((inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2, yy), (.48, abs(outer[1] - inner[1]), .05), 'naval')
        for yy in (18.06, 19.17, 20.28, 21.4):
            corners = [P(s * xo, yy, z + zo) for xo, zo in ((2.87, -.55), (3.42, -.55), (3.42, .55), (2.87, .55))]
            kit.polyline(id, col, corners + corners[:1], .02, 'naval', 4)
            kit.part('rod', id, col, 'dipole', P(s * 3.47, yy, 7.94), P(s * 3.47, yy, 9.92), .03, 'edge', vertices=6)
            kit.part('rod', id, col, 'dipole', P(s * 2.9, yy, 8.0), P(s * 2.9, yy, 9.69), .03, 'edge', vertices=6)


def searchlights(kit, col):
    for n, (kind, rx, ry, rz, (w, l, h)) in enumerate(SMALL_FITTINGS):
        if not -16.5 <= rz - ZC <= 34 or ry < 8.9:
            continue
        A = f'midships-{kind.replace(" ", "-")}-{n}'
        x, y, z = P(rx, ry, rz)
        floor = kit.floor(x, y, ry + .3)
        if floor is None or abs(floor - ry) > .6:
            continue
        base = floor
        if kind == 'searchlight':
            kit.searchlight(A, (rx, base, rz), col)
        elif kind in ('binocular', 'binocular pair', 'searchlight control'):
            kit.cylz(A, col, 'pedestal', (x, y, base), .07, .75, 'naval', 8)
            kit.part('box', A, col, 'binocular', (x, y, base + .86), (.3, .45, .2), 'edge')


def boats(kit, col):
    """Boats at the reference boat parts' centres and principal axes (cants read as the angle of each part's long axis
    to the centreline): cutters on the boat deck beside the pagoda, motor launches and motor boats on chocks on the
    forecastle deck. Positive cants turn the bow to port; all but the motor boats lie with their stems forward."""
    # The 9 m cutters (jm037) lie 30 degrees bow inboard, clear of the 25 mm single outboard of each; grey outside and
    # wood inside, as the reference paints them.
    import bpy
    for id, (x, z), cant in [('cutter-port', (-5.585, -34.702), -30.0), ('cutter-starboard', (5.874, -34.869), 30.0)]:
        kit.open_boat(id, (x, z), 9.15, 2.4, 9.62, .95, col, bow=1, outer='naval', inner='wood', chocks=(.25, .5, .75))
        cant_boat(kit, id, (x, z), cant)
    # The 12 m motor launches (jm039) are open boats with thwarts and an engine casing: the forward pair canted 29.6
    # and 17.3 degrees bow inboard, the after pair 11.2 and 8.9.
    for id, (x, z), keel, cant in [('launch-port-forward', (-6.901, 2.34), 6.93, -29.6), ('launch-starboard-forward', (7.083, 2.459), 6.98, 17.3),
                                   ('launch-port-after', (-5.815, 31.003), 7.02, -11.2), ('launch-starboard-after', (6.463, 31.692), 6.95, 8.9)]:
        kit.open_launch(id, (x, z), 12.0, 2.85, keel, col, chocks=(.2, .4, .62, .84))
        cant_boat(kit, id, (x, z), cant)
    for id, (x, z), cant in [('motor-boat-port', (-7.499, 24.632), -4.7), ('motor-boat-starboard', (7.686, 22.597), 13.3)]:
        # The 15 m motor boats (jm041) lie with their stems aft, their after ends 4.7 and 13.3 degrees outboard. They
        # are seated low with a 0.95 m wheelhouse and no mast, so No. 4 turret's gunhouse turns over them (its sole is at
        # 10.1 m; the reference's boats stand 0.8 m higher, into the gunhouse's sweep).
        kit.motor_boat(id, (x, z), 15.0, 2.8, 6.78, col, chocks=(.25, .43, .62, .82), wheelhouse=.95, mast=False, bow=-1)
        cant_boat(kit, id, (x, z), cant)


def cant_boat(kit, id, ref_center, degrees):
    """Turn a stowed boat's parts about the vertical through its centre; positive turns the bow to port."""
    import bpy
    kit.build_wires()
    bpy.context.view_layer.update()
    cx, cy, _ = P(ref_center[0], 0, ref_center[1])
    turn = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.radians(degrees), 4, 'Z') @ Matrix.Translation((-cx, -cy, 0))
    for ob in [o for o in bpy.data.objects if o.get('assemblyId') == id and o.parent is None]:
        ob.matrix_world = turn @ ob.matrix_world


def davits(kit, col):
    """Radial davits stowed along the casemate ledge (reference jm049/jm096 pairs): curved arms 2.6 m high on
    socketed posts, with their guys and blocks."""
    rows = [(-12.27, -37.95), (12.18, -36.95), (-13.08, -25.35), (13.28, -24.92), (-13.85, 4.47), (13.95, 7.28), (-11.69, 31.64),
            (12.07, -38.31), (-12.14, -37.06), (13.12, -25.33), (-13.37, -24.87), (13.88, 3.89), (-13.79, 6.97), (11.82, 31.46)]
    for n, (rx, rz) in enumerate(rows):
        A = f'davit-{n}'
        x, y, _ = P(rx, 0, rz)
        floor = kit.floor(x, y, 4.6)
        if floor is None:
            continue
        s = 1 if rx > 0 else -1
        kit.cylz(A, col, 'socket', (x, y, floor), .16, .35, 'naval', 12)
        pts = []
        for i in range(9):
            a = math.radians(90 * i / 8)
            # The arm rises from the socket and curves forward along the ledge, stowed.
            pts.append((x + 2.4 * (1 - math.cos(a)), y, floor + .35 + 2.2 * math.sin(a)))
        kit.polyline(A, col, pts, .1, 'naval', 8)
        kit.part('rod', A, col, 'block', (pts[-1][0], y, pts[-1][2] - .05), (pts[-1][0], y, pts[-1][2] - .4), .08, 'black', vertices=8)
        kit.wire(A, col, pts[-1], (x + 2.4, y, floor + .05), .015, check=False)

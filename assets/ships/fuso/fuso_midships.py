"""Fusō midships region: the funnel and its fittings, the boats and the davits (reference z -40 to 34).

Owns the funnel's black cap band, cage grill and steam pipes, the Type 13 radar antennas on the funnel's sides,
the midships searchlights on their platforms, the two 9 m cutters beside the pagoda, four 12 m motor launches and
two 15 m motor boats on the forecastle deck with their chocks, and the stowed radial davits on the casemate ledge.
Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Matrix, Vector
from fuso_kit import P, ZC
from fuso_fittings import SMALL_FITTINGS

# Blocks at the motor boats' bounds give No. 4 turret's interlock something to stop at; this module draws the boats.
CLAIMED_STRUCTURES = {'motor-boat-port', 'motor-boat-starboard'}
FUNNEL_Z = 9.67          # reference z of the funnel's centre; stadium 4.68 m by 6.64 m, 12.28 m to 23.88 m
FUNNEL_TOP = 23.88


def build(D, kit):
    cols = kit.cols
    funnel(kit, cols['Superstructure'])
    type13_radars(kit, cols['Sensors and masts'])
    searchlights(kit, cols['Sensors and masts'])
    boats(kit, cols['Boats and aviation'])
    davits(kit, cols['Boats and aviation'])


def stadium_ring(cx, cz, half, length, r_extra=0.0, n=40):
    """Reference-frame points round the funnel's stadium grown by r_extra."""
    straight = length / 2 - half
    pts = []
    for i in range(n):
        a = i * math.tau / n
        pts.append((cx + (half + r_extra) * math.cos(a), cz + math.copysign(straight, math.sin(a)) + (half + r_extra) * math.sin(a)))
    return pts


def funnel(kit, col):
    A = 'funnel-fittings'
    half, length = 2.34, 6.64
    # Black cap band over the top 1.9 m, a rolled rim and the cage grill over the uptake.
    ring = [P(x, 0, z)[:2] for x, z in stadium_ring(0, FUNNEL_Z, half, length, .025)]
    kit.prism(A, col, 'cap band', ring, FUNNEL_TOP - 1.9, FUNNEL_TOP + .02, 'black')
    rim = [P(x, 0, z)[:2] for x, z in stadium_ring(0, FUNNEL_Z, half, length, .08)]
    inner = [P(x, 0, z)[:2] for x, z in stadium_ring(0, FUNNEL_Z, half, length, -.12)]
    kit.prism(A, col, 'cap rim', rim, FUNNEL_TOP - .06, FUNNEL_TOP + .06, 'black')
    kit.prism(A, col, 'uptake', inner, FUNNEL_TOP - .5, FUNNEL_TOP + .03, 'dark')
    straight = length / 2 - half
    for i in range(-3, 4):
        x = i * .6
        reach = straight + math.sqrt(max(0, (half - .08) ** 2 - x * x))
        kit.member(A, col, P(x, FUNNEL_TOP + .45, FUNNEL_Z - reach), P(x, FUNNEL_TOP + .45, FUNNEL_Z + reach), .04, 'black', 6)
    for zz in (FUNNEL_Z - 2.2, FUNNEL_Z - 1.1, FUNNEL_Z, FUNNEL_Z + 1.1, FUNNEL_Z + 2.2):
        kit.member(A, col, P(-half + .1, FUNNEL_TOP + .45, zz), P(half - .1, FUNNEL_TOP + .45, zz), .04, 'black', 6)
    for a in range(0, 360, 45):
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        straight = length / 2 - half
        px, pz = (half - .05) * c, FUNNEL_Z + math.copysign(straight, s) + (half - .05) * s
        kit.member(A, col, P(px, FUNNEL_TOP, pz), P(px * .96, FUNNEL_TOP + .45, FUNNEL_Z + (pz - FUNNEL_Z) * .97), .04, 'black', 6)
    # Steam and waste pipes up the forward face and the quarters, standing proud of the casing on brackets.
    for x, r in [(-1.5, .12), (-.9, .15), (-.3, .12), (.3, .12), (.9, .15), (1.5, .12)]:
        zf = FUNNEL_Z - length / 2 + half - math.sqrt(max(0, (half + .2) ** 2 - x * x)) - .02
        kit.part('rod', A, col, 'steam pipe', P(x, 12.3, zf), P(x, FUNNEL_TOP + .7, zf), r, 'naval', vertices=10)
        for y in (15.0, 18.5, 22.0):
            kit.member(A, col, P(x, y, zf), P(x * .95, y, zf + .25), .03, 'naval', 4)
    for s in (-1, 1):
        for dz in (-1.8, 1.8):
            kit.part('rod', A, col, 'waste pipe', P(s * (half + .18), 12.3, FUNNEL_Z + dz), P(s * (half + .18), FUNNEL_TOP + .35, FUNNEL_Z + dz), .1, 'naval', vertices=8)
    # Rungs up the after face.
    kit.ladder(A, col, P(0, 12.35, FUNNEL_Z + length / 2 + .12), P(0, FUNNEL_TOP - .1, FUNNEL_Z + length / 2 + .12), (0, 1, 0), .42, .35, .03, .02, 'naval')


def type13_radars(kit, col):
    """Type 13 air-search antennas on the funnel's sides (reference HP_JRS_3/4): a ladder of dipole rungs 4.7 m
    tall on brackets from the casing."""
    for id, s in [('type13-port', -1), ('type13-starboard', 1)]:
        x, y0, z = 3.11 * s, 17.33, 8.94
        top = y0 + 4.68
        for dz in (-.9, .9):
            kit.part('rod', id, col, 'rail', P(x, y0, z + dz), P(x, top, z + dz), .045, 'naval', vertices=6)
        n = 9
        for i in range(n):
            yy = y0 + .3 + (top - y0 - .5) * i / (n - 1)
            kit.part('rod', id, col, 'dipole', P(x, yy, z - .98), P(x, yy, z + .98), .025, 'edge', vertices=6)
        for yy in (y0 + .4, top - .6):
            kit.part('rod', id, col, 'bracket', P(x, yy, z), P(s * 2.3, yy, z), .06, 'naval', vertices=8)
        kit.part('box', id, col, 'feed box', P(x, y0 - .15, z), (.5, .4, .35), 'naval')
        kit.part('rod', id, col, 'feed strut', P(x, y0 - .35, z), P(s * 2.3, y0 - 1.2, z), .06, 'naval', vertices=8)


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
    """Boats at the reference boat datums: cutters on the boat deck beside the pagoda, motor launches and motor
    boats on chocks on the forecastle deck."""
    # The cutters lie canted 24.5 degrees, bow inboard, as their 5.3 m by 8.2 m reference bounds show, clear of
    # the 25 mm single outboard of each; grey outside and wood inside, as the reference paints them.
    import bpy
    for id, (x, z), s in [('cutter-port', (-6.07, -34.83), -1), ('cutter-starboard', (6.07, -34.83), 1)]:
        kit.open_boat(id, (x, z), 8.2, 2.2, 9.62, .95, col, bow=1, outer='naval', inner='wood', chocks=(.25, .5, .75))
        kit.build_wires()
        bpy.context.view_layer.update()
        cx, cy, _ = P(x, 0, z)
        turn = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.radians(24.5 * s), 4, 'Z') @ Matrix.Translation((-cx, -cy, 0))
        for ob in [o for o in bpy.data.objects if o.get('assemblyId') == id and o.parent is None]:
            ob.matrix_world = turn @ ob.matrix_world
    # The 12 m motor launches are open boats with thwarts and an engine casing, canted bow inboard as the reference's
    # top view and part bounds show: the forward pair 20 and 10 degrees, the after pair 5.5 and 4.
    for id, (x, z), keel, cant in [('launch-port-forward', (-7.19, 2.42), 6.93, 20), ('launch-starboard-forward', (7.26, 2.44), 6.98, 10),
                                   ('launch-port-after', (-5.89, 31.0), 7.02, 5.5), ('launch-starboard-after', (6.49, 31.7), 6.95, 4)]:
        kit.open_launch(id, (x, z), 11.9, 2.9, keel, col, chocks=(.2, .4, .62, .84))
        cant_boat(kit, id, (x, z), cant * (1 if x > 0 else -1))
    for id, (x, z), cant in [('motor-boat-port', (-7.43, 24.6), 0), ('motor-boat-starboard', (7.40, 22.5), 6)]:
        # Seated low with a 0.95 m wheelhouse and no mast, so No. 4 turret's gunhouse turns over them (its sole is at
        # 10.1 m; the reference's boats stand 0.8 m higher, into the gunhouse's sweep). The starboard boat lies 6
        # degrees bow inboard.
        kit.motor_boat(id, (x, z), 15.2, 3.4, 6.78, col, chocks=(.25, .43, .62, .82), wheelhouse=.95, mast=False)
        if cant:
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

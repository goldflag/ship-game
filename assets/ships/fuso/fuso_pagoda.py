"""Fusō pagoda foremast region: reference z -40 to -17, above the forecastle deck.

The measured prisms give the tiers and platforms; this module adds what the reference shows on them: the
main director on the top platform with the 10 m rangefinder tower and the radar mattress on its face, the Type 22
radars, the 3.5 m and 1.5 m rangefinders, the Type 91 high-angle directors, searchlights, binoculars and lamps, the
signal yards, the forestay aerial, the bridge glazing the reference paints in three bands, rails round exposed
roofs and knees under overhangs. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from fuso_kit import P, ZC
from fuso_fittings import SMALL_FITTINGS

CLAIMED_STRUCTURES = set()
DIRECTOR = (0, 39.52, -30.415)      # reference HP_JD_1: the main director's training axis and seat


def zone(x, y, z):
    """Runtime point inside the pagoda region."""
    return -40 < z < -16.5 and y > 8.9


def build(D, kit):
    masts = kit.cols['Sensors and masts']
    sup = kit.cols['Superstructure']
    structures = [s for s in D['structures'] if s['id'] != 'funnel']
    main_director(kit, masts)
    rangefinder_10m(kit, masts)
    type22_radars(kit, masts)
    for id, ref in [('rf-bridge-port', (-1.21, 25.862, -31.438)), ('rf-bridge-starboard', (1.26, 25.86, -31.432))]:
        kit.rangefinder(id, ref, 1.5, 0, masts)
    # The 3.5 m rangefinders (jf016) are enclosed: a round house 1.96 m across with the tube's arms through its sides
    # out to 3.76 m, 1.42 m high over all with its sighting dome.
    for id, ref in [('rf-secondary-port', (-4.488, 23.049, -28.212)), ('rf-secondary-starboard', (4.512, 23.045, -28.227)),
                    ('rf-upper-port', (-3.879, 30.876, -27.454)), ('rf-upper-starboard', (3.869, 30.875, -27.543))]:
        kit.rangefinder_house(id, ref, 3.76, 0, masts, radius=.98, height=1.17, tube=.6)
    # The Type 91 directors (jd008) stand in wells 0.8 m deep in their platforms (reference 22.14-23.89 m).
    for id, rx in [('ha-director-port', -5.182), ('ha-director-starboard', 5.199)]:
        type91_director(kit, id, (rx, 22.94, -21.4), masts)
    bridge_gear(kit, masts)
    rear_legs(kit, sup)
    signal_yards(kit, sup)
    forestay(kit, masts)
    glazing(kit, sup)
    kit.roof_rails('pagoda-rails', sup, structures, zone)
    kit.overhang_knees('pagoda-knees', sup, structures, zone)


# ---------------------------------------------------------------- top platform
def main_director(kit, col):
    """Main battery director: a drum 3.7 m across on a training ring, with its roof lip, sighting hood and ports."""
    A = 'main-director'
    x, y, z = DIRECTOR
    moving = []
    moving.append(kit.cylz(A, col, 'training ring', P(x, y, z), 1.9, .14, 'edge', 40))
    moving.append(kit.cylz(A, col, 'drum', P(x, y + .14, z), 1.83, 1.55, 'naval', 40))
    moving.append(kit.cylz(A, col, 'roof lip', P(x, y + 1.69, z), 1.9, .08, 'naval', 40))
    moving.append(kit.cylz(A, col, 'roof', P(x, y + 1.77, z), 1.75, .18, 'roof', 40, r2=1.35))
    # Sighting hood and ports on the forward face; the rangefinder's objective housings either side.
    hx, hy, hz = P(0, y + 1.1, z - 1.7)
    moving.append(kit.part('box', A, col, 'sight hood', (hx, hy, hz), (.55, 1.6, .62), 'naval'))
    moving.append(kit.part('box', A, col, 'sight port', (hx + .28, hy, hz), (.03, 1.3, .22), 'glass'))
    for s in (-1, 1):
        px, py, pz = P(s * 1.3, y + .9, z - 1.3)
        moving.append(kit.part('box', A, col, 'side port', (px, py, pz), (.03, .5, .32), 'glass'))
        moving.append(kit.part('box', A, col, 'hatch', P(s * 1.82, y + .8, z + .3), (.9, .04, .95), 'painted-edge'))
    moving.append(kit.part('rod', A, col, 'roof vent', P(.6, y + 1.9, z + .7), P(.6, y + 2.3, z + .7), .12, 'naval', vertices=10))
    radar_pivot('main-director.yaw', P(x, y, z), moving)


def rangefinder_10m(kit, col):
    """10 m rangefinder (reference HP_JF_7) through the tower on the top platform, and the radar mattress on the
    tower's forward face. Reference sections: the tower 2.1 m wide over z -28.4 to -25.9 from 40.8 to 44.5 m with a
    short post on its roof, the tube's arms out to 5.5 m either side at 41.7 m, the mattress 5.1 m wide from 42.2 to
    44.4 m at z -28.5."""
    A = 'rangefinder-10m'
    x, y, z = 0.044, 40.835, -26.923
    kit.cylz(A, col, 'turntable', P(x, y, z), 1.35, .16, 'edge', 32)
    kit.part('box', A, col, 'housing', P(x, y + 1.88, z - .05), (2.5, 2.2, 3.48), 'naval')
    kit.part('box', A, col, 'housing roof', P(x, y + 3.66, z - .05), (2.62, 2.32, .08), 'roof')
    kit.part('rod', A, col, 'roof post', P(x, y + 3.68, z + .02), P(x, 44.95, z + .02), .07, 'naval', vertices=8)
    # Tube across the ship with armoured end hoods and objectives facing forward.
    ty = y + .92
    kit.part('rod', A, col, 'tube', P(x - 5.0, ty, z - .2), P(x + 5.0, ty, z - .2), .3, 'naval', vertices=18)
    for s in (-1, 1):
        hx, hy, hz = P(x + s * 5.05, ty, z - .2)
        kit.part('box', A, col, 'end hood', (hx, hy, hz), (1.05, .72, .78), 'naval')
        kit.part('box', A, col, 'objective', (hx + .53, hy, hz + .05), (.03, .5, .34), 'glass')
        kit.part('rod', A, col, 'tube collar', P(x + s * 1.3, ty, z - .2), P(x + s * 1.45, ty, z - .2), .36, 'naval', vertices=18)
    # Radar mattress: a dark panel in a frame on the tower's forward face, braced back to it.
    face = z - .05 - 1.25
    gz = -28.5
    y0, y1, half = 42.21, 44.40, 2.54
    kit.part('box', A, col, 'mattress', P(x, (y0 + y1) / 2, gz), (.08, 2 * half, y1 - y0), 'edge')
    corners = [P(x - half, y0, gz), P(x + half, y0, gz), P(x + half, y1, gz), P(x - half, y1, gz)]
    kit.polyline(A, col, corners + corners[:1], .05, 'naval', 6)
    for i in range(1, 9):
        xx = x - half + 2 * half * i / 9
        kit.member(A, col, P(xx, y0, gz - .05), P(xx, y1, gz - .05), .025, 'naval', 4)
    for j in range(1, 5):
        yy = y0 + (y1 - y0) * j / 5
        kit.member(A, col, P(x - half, yy, gz - .05), P(x + half, yy, gz - .05), .025, 'naval', 4)
    for s in (-1, 1):
        for yy in (y0 + .25, y1 - .25):
            kit.member(A, col, P(x + s * 1.9, yy, gz), P(x + s * .9, yy, face + .1), .05, 'naval', 6)


def type22_radars(kit, col):
    """Type 22 surface radars (reference HP_JRS_1/2): a transmitting and a receiving horn on a small cabinet."""
    for id, rx in [('type22-port', -2.835), ('type22-starboard', 2.835)]:
        x, y, z = P(rx, 38.588, -26.63)
        floor = kit.floor(x, y, 38.7)
        base = z if floor is None or z - floor > 1.2 else floor
        kit.part('box', id, col, 'cabinet', (x, y, base + .35), (.55, .6, .7), 'naval')
        for dy in (-.18, .18):
            mouth = Vector((x + .85, y + dy, base + .95))
            throat = Vector((x + .25, y + dy, base + .95))
            vv = [tuple(throat + Vector((0, a * .06, b * .05))) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            vv += [tuple(mouth + Vector((0, a * .2, b * .16))) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            ff = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0)]
            kit.tag(kit.mesh(id + '.horn', vv, ff, 'naval', col), id)
            kit.part('rod', id, col, 'waveguide', (x + .1, y + dy, base + .7), tuple(throat), .04, 'edge', vertices=6)


def type91_director(kit, id, ref, col, facing=0.0, well=.8):
    """Type 91 high-angle director (reference jd008, HP_JD_2-4): a round hood 2.37 m across and 1.75 m high over its
    seat, its walls rising 1.5 m to a low domed roof, the sighting opening and rangefinder ports on its face; it stands
    `well` below the datum in a well sunk into its platform, the well's dark rim round it at the platform. `facing` is
    the bearing its face looks along (0 forward). Returns the parts that train."""
    x, y, z = P(*ref)
    base = z - well
    a = math.radians(facing)
    f = Vector((math.cos(a), -math.sin(a), 0))
    side = Vector((-f.y, f.x, 0))
    moving = [kit.cylz(id, col, 'seat', (x, y, base), .95, .12, 'naval', 28)]
    moving.append(kit.cylz(id, col, 'hood', (x, y, base + .1), 1.185, 1.4, 'naval', 32))
    moving.append(kit.cylz(id, col, 'hood roof', (x, y, base + 1.5), 1.2, .25, 'roof', 32, r2=.85))
    # The hood is open over the director's sights: a dark opening in the roof, reaching the face.
    moving.append(kit.beam(id, col, 'roof opening', Vector((x, y, base + 1.755)) - f * .15, Vector((x, y, base + 1.755)) + f * .9, .7, .012, 'dark'))
    c = Vector((x, y, base + 1.28))
    moving.append(kit.beam(id, col, 'sighting opening', c + f * 1.17, c + f * 1.2, 1.1, .34, 'dark'))
    for s in (-1, 1):
        port = c + f * .95 + side * s * .72 + Vector((0, 0, -.25))
        moving.append(kit.beam(id, col, 'rangefinder port', port, port + f * .02, .28, .16, 'dark'))
    # The well's dark rim at the platform, round the hood.
    vv, ff = [], []
    n = 32
    for r in (1.2, 1.36):
        for i in range(n):
            t = math.tau * i / n
            vv.append((x + r * math.cos(t), y + r * math.sin(t), z + .006))
    ff = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    kit.tag(kit.mesh(id + '.well rim', vv, ff, 'dark', col), id)
    return moving


def bridge_gear(kit, col):
    """Searchlights, their controls, binoculars, lamps and lockers from the reference's fitting bounds."""
    for n, (kind, rx, ry, rz, (w, l, h)) in enumerate(SMALL_FITTINGS):
        if not -40 < rz - ZC < -16.5 or ry < 8.9:
            continue
        A = f'pagoda-{kind.replace(" ", "-")}-{n}'
        x, y, z = P(rx, ry, rz)
        if kind == 'signal lamp':
            # Day lights stand on the yard arms (34.25 m), on shelves or on the floor under them.
            if ry > 33.8 and abs(rx) > 3:
                kit.cylz(A, col, 'lamp foot', (x, y, 34.25), .1, .07, 'naval', 12)
                kit.cylz(A, col, 'lamp lens', (x, y, 34.32), .12, h * .55, 'glass', 12)
                kit.cylz(A, col, 'lamp cap', (x, y, 34.32 + h * .55), .135, h * .22, 'naval', 12, r2=.055)
            else:
                kit.lamp(A, col, x, y, ry, h, .12)
            continue
        if kind == 'running light':
            # The side lights' screens on the bridge wings' outer faces, red to port and green to starboard.
            side = 1 if rx > 0 else -1           # starboard is authoring -y
            hit = kit.hit((x, y - side * 2.0, ry + h / 2), (0, side, 0), 3.0)
            if hit is not None and abs(hit[0].y - y) < .8:
                cy = hit[0].y - side * (w / 2 - .02)
            else:
                cy = y
                floor = kit.floor(x, y, ry + .3)
                if floor is not None and ry - floor > .02:
                    kit.cylz(A, col, 'post', (x, y, floor), .06, ry - floor + .02, 'naval', 8)
            kit.part('box', A, col, 'screen', (x, cy, ry + h / 2), (l, w, h), 'naval')
            kit.part('box', A, col, 'lens', (x + l * .2, cy - side * (w / 2 + .01), ry + h * .5), (l * .45, .03, h * .55), 'lens-red' if rx < 0 else 'lens-green')
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
            if kind == 'binocular pair':
                kit.part('box', A, col, 'binocular', (x, y, top + .12), (.3, .7, .24), 'edge')
            else:
                kit.part('box', A, col, 'binocular', (x, y, top + .09), (.28, .34, .18), 'edge')
                kit.part('rod', A, col, 'objective', (x + .14, y - .09, top + .1), (x + .17, y - .09, top + .1), .06, 'glass', vertices=8)
                kit.part('rod', A, col, 'objective', (x + .14, y + .09, top + .1), (x + .17, y + .09, top + .1), .06, 'glass', vertices=8)
        elif kind == 'deck lamp':
            kit.lamp(A, col, x, y, base, h, .15)
        elif kind == 'flag locker':
            kit.part('box', A, col, 'locker', (x, y, base + h / 2), (l, w, h), 'naval')


def forestay(kit, col):
    """The aerial the reference's orthographic side render traces from the pagoda's upper tier (37.0 m at z -33.1)
    down to an insulator 4.5 m over the forecastle at z -84.5, with its lead to the deck, and the bridle from the
    lower bridge tier (16.2 m at z -38.5) joining it at 26.6 m over z -54.1."""
    A = 'aerials-forward'
    # The forestay ends in an insulator laid along it (drawn with the wires); the down-lead leaves its lower end.
    kit.wire(A, col, P(0, 37.04, -33.1), P(0, 12.0, -83.4), .015, check=False)
    kit.wire(A, col, P(0, 16.2, -38.5), P(0, 26.58, -54.12), .015, check=False)
    kit.wire(A, col, P(0, 12.2, -83.0), P(0, 11.45, -84.5), .05, check=False, sides=6)
    x, y, _ = P(0, 0, -84.3)
    floor = kit.floor(x, y, 9.0)
    if floor is not None:
        kit.wire(A, col, P(0, 11.55, -84.3), (x, y, floor - .02), .012, check=False)


def signal_yards(kit, col):
    """The signal yard (reference plan cuts at 33.9-34.5 m): one narrow railed yard 0.3 m wide at 34.05-34.25 m,
    straight across the tower's after face within 1.75 m of the centreline and swept 25 degrees aft from there to
    its tips 10.8 m out; a brace under each arm's inner half; signal halyards from the arms down to the flag
    lockers on the 22 m platform."""
    A = 'signal-yards'
    y = 34.15
    kit.beam(A, col, 'yard', P(-1.8, y, -24.8), P(1.8, y, -24.8), .3, .2, 'naval')
    locker = {}
    for kind, rx, ry, rz, (w, l, h) in SMALL_FITTINGS:
        if kind == 'flag locker':
            locker[1 if rx > 0 else -1] = (rx, ry + h, rz)
    for s in (-1, 1):
        root, tip = Vector(P(s * 1.75, y, -24.9)), Vector(P(s * 10.8, y, -20.7))
        kit.beam(A, col, 'yard arm', root, tip, .3, .2, 'naval')
        kit.member(A, col, P(s * .5, 33.93, -25.6), P(s * 4.65, 33.93, -23.65), .06, 'naval', 6)
        # A rail along the arm's forward edge and round its tip.
        edge = (tip - root).normalized().cross(Vector((0, 0, 1))) * .13
        if edge.x < 0:
            edge = -edge
        start = root.lerp(tip, .18)
        pts = [(start + edge).to_2d(), (tip + edge).to_2d(), (tip - edge).to_2d()]
        kit.rail(A, col, [tuple(q) for q in pts], y + .1, .8, 1.4, check=False)
        # Halyards from the arm down to the flag locker on this side.
        if s in locker:
            lx, ly, lz = locker[s]
            to = Vector(P(lx, ly, lz))
            for t in (.3, .45, .6, .75, .9):
                a = root.lerp(tip, t)
                kit.wire(A, col, (a.x, a.y, a.z - .1), tuple(to), .012, check=False)


def glazing(kit, col):
    """Bridge windows the reference paints in three bands (orthographic front and side renders): panes cast onto this
    model's own walls. The forward faces carry the front runs; each side carries its run of panes between the measured
    forward and after ends (reference textured side render: 7 panes at 20 m, 5 at 23.2 m and 5 at 28.85 m)."""
    rows = []
    # (bottom, top, front face z, front half-width, side run from z, to z, side panes)
    bands = [(20.0, 20.6, -34.4, 3.0, -34.4, -30.8, 7), (23.2, 23.9, -33.4, 1.6, -33.25, -31.18, 5), (28.85, 29.5, -33.1, 2.5, -32.86, -30.73, 5)]
    guns = [(m['position'][0], m['position'][1], m['position'][2]) for m in kit.D['mounts'] if m['id'].startswith('aa25-')]
    for y0, y1, zfront, half, zs0, zs1, m in bands:
        yc, h = (y0 + y1) / 2, y1 - y0
        n = max(2, round(2 * half / .52))
        for i in range(n):
            xr = -half + (i + .5) * 2 * half / n
            hit = kit.hit(P(xr, yc, zfront - 6), (-1, 0, 0), 8)
            if hit:
                loc, nrm = hit
                row = ('window', -loc.y, yc, -loc.x, 2 * half / n - .08, h, -nrm.y, -nrm.x)
                # No front pane inside a light gun's working circle (the tower's walls are cut back round those guns).
                if not any(math.hypot(row[1] - gx, row[3] - gz) < 1.9 and -.5 < yc - gy < 3 for gx, gy, gz in guns):
                    rows.append(row)
        for s in (-1, 1):
            side = []
            for i in range(m):
                zr = zs0 + (i + .5) * (zs1 - zs0) / m
                hit = kit.hit(P(s * 9, yc, zr), (0, s, 0), 8)
                if hit and abs(hit[1].y) > .7:
                    loc, nrm = hit
                    side.append(('window', -loc.y, yc, -loc.x, (zs1 - zs0) / m - .08, h, -nrm.y, -nrm.x))
            if side:
                # Keep the panes on the band's outer wall, not in a notch cut back behind it.
                outer = sorted(abs(r[1]) for r in side)[len(side) // 2]
                rows += [r for r in side if abs(r[1]) > outer - .5]
    kit.windows('bridge-glazing', col, rows)


def rear_legs(kit, col):
    """The tower's rear legs, raked struts and their web plates (reference plan cuts every 0.6 m, starboard side,
    mirrored). Each leg is a 0.38 m by 0.22 m member standing on the base roof at the base's after corner (3.12 m out,
    9.3 m), nearly upright to a knee at 13.2 m and raked aft from there to the 21.4 m platform. Outboard of it a raked
    strut 0.65 m square rises from the base roof 2.4 m ahead of the base's after face, raked 25 degrees aft and outward
    to the same platform's after corner; a brace leans forward from the strut at 12 m to the tower at 20 m, and a web
    plate fills the angle between strut and brace from 12.4 to 15.4 m. Runtime-frame datums (reference z + 1.095)."""
    A = 'pagoda-legs'

    def pt(x, y, z):
        return Vector((-z, -x, y))

    for s in (-1, 1):
        # Leg: foot on the base roof, knee, head under the platform.
        fx, fz = s * 3.12, -23.425
        foot = kit.floor(-fz, -fx, 9.8)
        if foot is None or foot < 8.9:
            raise ValueError(f'pagoda leg foot at ({fx}, {fz}) misses the base roof: {foot}')
        knee = pt(s * 2.70, 13.2, -23.28)
        head = pt(s * 1.86, 21.5, -20.55)
        kit.beam(A, col, 'leg', pt(fx, foot - .03, fz), knee + Vector((0, 0, .1)), .22, .38, 'naval')
        kit.beam(A, col, 'leg', knee - (head - knee).normalized() * .1, head, .22, .38, 'naval')
        # Strut: along the measured line (x 2.83 at 10 m to 4.76 at 21.4 m) down to the roof it stands on.
        top = pt(s * 4.76, 21.5, -20.6)
        d = Vector((s * .1693, 1, .4272))
        a = Vector((s * 2.83, 10.0, -25.505))
        fy = kit.floor(-(a.z - d.z * .9), -(a.x - d.x * .9), 11.0)
        if fy is None or fy < 8.9:
            raise ValueError(f'pagoda strut foot misses the base roof: {fy}')
        b = a + d * (fy - a.y - .05)
        kit.beam(A, col, 'strut', pt(b.x, b.y, b.z), top, .62, .62, 'naval')
        # Brace from the strut forward and up to the tower, and the web between them.
        c0 = a + d * (12.0 - a.y)
        brace_top = pt(s * 2.38, 20.1, -26.1)
        kit.beam(A, col, 'brace', pt(c0.x, c0.y, c0.z), brace_top, .6, .6, 'naval')
        bd = (brace_top - pt(c0.x, c0.y, c0.z))
        web = []
        for y in (12.4, 15.4):
            sp = a + d * (y - a.y)
            t = (y - 12.0) / (20.1 - 12.0)
            bp = pt(c0.x, c0.y, c0.z) + bd * t
            web.append((pt(sp.x, sp.y, sp.z), bp))
        (s0, b0), (s1, b1) = web
        n = (s1 - s0).cross(b0 - s0).normalized() * .05
        vv = [tuple(v + n * k) for k in (-1, 1) for v in (s0, s1, b1, b0)]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        ob = kit.mesh(A + '.web', vv, ff, 'naval', col)
        import bmesh
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
        kit.tag(ob, A)
        # The pipe outboard of the strut from the base roof to the 16 m platform.
        pf = kit.floor(-(-24.565), -(s * 3.45), 10.5)
        if pf is None or pf < 8.9:
            raise ValueError(f'pagoda strut pipe misses the base roof: {pf}')
        kit.part('rod', A, col, 'pipe', pt(s * 3.44, pf - .02, -24.565), pt(s * 4.22, 16.25, -25.375), .14, 'naval', vertices=10)

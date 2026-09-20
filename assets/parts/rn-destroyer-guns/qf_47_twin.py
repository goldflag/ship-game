"""Original 4.7-inch QF Mk XII twin on the CP Mk XIX mounting.

Visual proportions follow the approved GameModels3D Jervis A artillery
(`bgm079_120mm_45_qf_cp_mkxix_twin`), the same visual that Jupiter (1942),
Cossack and Eskimo fit. No reference geometry is loaded here. The catalog owns
the weapon data and the closed armour envelope; this recipe draws the
open-backed weather shield on that same authored surface, opens its two gun
slots and its side sighting windows, and adds the turntable, the trunnion
pedestal, sliding barrels, elevating port shields, layers' seats and the rear
loading platform.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
Everything above the horizontal rule is plain geometry, shared with the
generator that writes the catalog's `gunhouseMesh`.
"""
import math

# Plan half-breadth of the weather shield, read off the approved model at its
# lower band, from the open rear rim forward around the rounded nose.
PLAN = [(-1.24, 2.05), (-0.30, 2.04), (0.34, 1.97), (0.60, 1.93), (1.05, 1.82),
        (1.23, 1.72), (1.41, 1.56), (1.52, 1.32), (1.62, 1.00), (1.70, 0.75),
        (1.76, 0.19), (1.78, 0.00)]
DATUM = 0.359       # height at which PLAN was measured
RAKE = -0.21        # the nose lies back this far per metre of height
SILL = 0.92         # gun-slot sill, dropped clear of the barrel at full depression
LEDGE = 1.31        # sighting-window sill
EAVE = 2.059        # wall head, where the cambered roof springs
CAMBER = 0.30       # roof camber over the eave on the centre line
SKIRT = 0.191       # forward shield rim; the rear skirt hangs to the sole
LEVELS = (None, SILL, LEDGE, EAVE)
GUN_SLOT = (9, 10)  # the slot spans these plan points and continues over the roof
WINDOWS = (5, 7)    # the sighting window spans these plan points
ROOF_SLOT = 2       # the roof is cut from this plan point forward
ROOF_LINES = (1.30, 0.75, 0.19)     # slot lines lie at 0.75 and 0.19
COARSE = (0, 3, 5, 7, 9, 10, 11)    # stations kept by the catalog armour envelope


def rake(x):
    return RAKE * min(1.0, max(0.0, x / PLAN[-1][0]))


def half_breadth(x):
    for (a, wa), (b, wb) in zip(PLAN, PLAN[1:]):
        if a <= x <= b:
            return wa + (wb - wa) * (x - a) / (b - a)
    return PLAN[0][1] if x < PLAN[0][0] else PLAN[-1][1]


def roof_surface(x, y):
    """Height of the cambered roof over a plan point, before the nose rake."""
    fall = max(0.0, 1 - ((max(x, 0.10) - 0.10) / 1.05) ** 2)
    width = max(0.02, half_breadth(x))
    return EAVE + CAMBER * fall * max(0.0, 1 - (y / width) ** 2)


def foot(index):
    """Height of the shield's lower rim; the rear skirt hangs to the sole."""
    return 0.0 if PLAN[index][0] < 0.0 else SKIRT


def station(index, z):
    """A shield plan point carried to height z, following the nose rake."""
    x, y = PLAN[index]
    return (x + rake(x) * (z - DATUM), y)


def roof_height(index, y):
    """Cambered roof over the eave; the camber dies into the eave at the nose."""
    return roof_surface(PLAN[index][0], y)


def roof_lines(index):
    """Roof y lines at one station: edge, 1.30, the two slot lines, centre."""
    width = PLAN[index][1]
    half = [width] + [min(v, width) for v in ROOF_LINES] + [0.0]
    return half + [-v for v in reversed(half[:-1])]


def _ring(indices):
    return [(i, 1) for i in indices] + [(i, -1) for i in reversed(indices[:-1])]


def walls(indices, points):
    """Quads of the skirt, wall and head bands, tagged by what they carry."""
    ring = _ring(indices)
    grid = {}
    for column, (index, side) in enumerate(ring):
        for row, level in enumerate(LEVELS):
            z = foot(index) if level is None else level
            x, y = station(index, z)
            grid[(column, row)] = len(points)
            points.append((x, side * y, z))
    out = []
    for column in range(len(ring) - 1):
        (left, side), (right, _) = ring[column], ring[column + 1]
        pair = (min(left, right), max(left, right))
        for row in range(len(LEVELS) - 1):
            tag = 'wall'
            if row > 0 and pair == GUN_SLOT:
                tag = 'slot'
            elif row == len(LEVELS) - 2 and WINDOWS[0] <= pair[0] and pair[1] <= WINDOWS[1]:
                tag = 'window'
            out.append(((grid[(column, row)], grid[(column, row + 1)],
                         grid[(column + 1, row + 1)], grid[(column + 1, row)]), tag))
    return out, grid, ring


def roof(indices, points):
    """Quads of the cambered roof, seated on the eave ring."""
    cells = {}
    for column, index in enumerate(indices):
        x = station(index, EAVE)[0]
        for row, y in enumerate(roof_lines(index)):
            cells[(column, row)] = len(points)
            points.append((x, y, roof_height(index, y)))
    out = []
    for column in range(len(indices) - 1):
        for row in range(len(roof_lines(indices[column])) - 1):
            quad = (cells[(column, row)], cells[(column, row + 1)],
                    cells[(column + 1, row + 1)], cells[(column + 1, row)])
            corners = {(round(points[i][0], 4), round(points[i][1], 4)) for i in quad}
            if len(corners) < 3:
                continue
            inner = min(abs(points[i][1]) for i in quad)
            outer = max(abs(points[i][1]) for i in quad)
            cut = (indices[column] >= ROOF_SLOT
                   and inner >= ROOF_LINES[2] - 1e-6 and outer <= ROOF_LINES[1] + 1e-6)
            out.append((quad, 'roof-slot' if cut else 'roof'))
    return out, cells


def envelope():
    """Closed coarse armour envelope: the same surface with a tent roof.

    Returns (points, faces) where each face is (indices, finish); the gun
    slots, the sighting windows and the open rear are closed over, so the
    solid is the protection the mounting offers, not its plating pattern.
    """
    points = []
    bands, grid, ring = walls(COARSE, points)
    faces = [(quad, 'naval') for quad, _ in bands]
    spine = {}
    for column, index in enumerate(COARSE):
        spine[column] = len(points)
        points.append((station(index, EAVE)[0], 0.0, roof_height(index, 0.0)))
    head = len(LEVELS) - 1
    last = len(COARSE) - 1
    for column in range(last):
        faces.append(((grid[(column, head)], spine[column], spine[column + 1],
                       grid[(column + 1, head)]), 'roof'))
        port, starboard = len(ring) - 1 - column, len(ring) - 2 - column
        faces.append(((grid[(port, head)], grid[(starboard, head)],
                       spine[column + 1], spine[column]), 'roof'))
    sole = [grid[(column, 0)] for column in range(len(ring))]
    faces += [((sole[0], sole[i], sole[i + 1]), 'naval') for i in range(1, len(sole) - 1)]
    # The rear opening is closed from its crown, because both side edges of the
    # rim are straight and a corner fan would collapse along them.
    rear = ([spine[0]] + [grid[(len(ring) - 1, row)] for row in reversed(range(len(LEVELS)))]
            + [grid[(0, row)] for row in range(len(LEVELS))])
    faces += [((rear[0], rear[i + 1], rear[i]), 'naval') for i in range(1, len(rear) - 1)]
    # Weld the coincident nose vertices, then drop the triangles they collapse.
    weld = {}
    merged = []
    for index, point in enumerate(points):
        key = tuple(round(v, 4) for v in point)
        if key not in weld:
            weld[key] = len(merged)
            merged.append(point)
        points[index] = weld[key]
    triangles = []
    for indices, finish in faces:
        corners = [points[i] for i in indices]
        fan = [corners] if len(corners) == 3 else [corners[:3], [corners[0], corners[2], corners[3]]]
        for triangle in fan:
            if len(set(triangle)) == 3:
                triangles.append((tuple(triangle), finish))
    return merged, triangles


# --------------------------------------------------------------------------
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402
from blender_barrels import barrel_layout  # noqa: E402

JACKET = .165
CHASE = .1035
CREST = .80     # pedestal crest; the elevating gear swings clear above it


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    naval, roof_mat, edge, dark, painted, glass = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'])
    name = mount['id']
    spec = mount['weapon']

    def node(suffix, parent=None, loc=(0, 0, 0)):
        empty = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(empty)
        empty.location = loc
        empty.parent = parent
        empty['nodeId'] = empty.name
        empty['assemblyId'] = name
        return empty

    yaw = node('yaw')

    def put(obj, parent=None):
        obj.parent = parent or yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = name
        return obj

    def plating(obj, thickness=.024):
        modifier = obj.modifiers.new('Shield plating', 'SOLIDIFY')
        modifier.thickness = thickness
        modifier.offset = 1
        return obj

    # ---- weather shield -----------------------------------------------------
    # The plating is the authored surface the catalog envelope follows, with the
    # rear left open, the two gun slots cut through the head and the roof, and a
    # sighting window in each cheek.
    fine = tuple(range(len(PLAN)))
    points = []
    bands, _, _ = walls(fine, points)
    covers, _ = roof(fine, points)
    plating(put(mesh(name + '.shield', points, [q for q, tag in bands if tag == 'wall'], naval, col)))
    plating(put(mesh(name + '.shield-roof', points, [q for q, tag in covers if tag == 'roof'], roof_mat, col)))

    pivot, trunnion = spec['pivotHeight'], spec['trunnionForward']
    length = spec['muzzleForward'] - trunnion
    bore = spec['caliberM'] / 2

    # ---- rotating structure -------------------------------------------------
    put(cyl(name + '.roller-path', (0, 0, .026), 1.19, .052, edge, col, 40))
    put(cyl(name + '.turntable', (0, 0, .095), 1.12, .086, naval, col, 40))
    skirt = [(-.80, .86), (.90, .86), (.90, -.86), (-.80, -.86)]
    crest = [(-.50, .55), (.60, .55), (.60, -.55), (-.50, -.55)]
    verts = [(x, y, .138) for x, y in skirt] + [(x, y, CREST) for x, y in crest]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    put(mesh(name + '.pedestal', verts, faces, naval, col))
    for across in [0, .94, -.94]:
        put(box(name + '.trunnion-standard', (trunnion, across, (CREST + pivot) / 2 + .09),
                (.34, .20, pivot - CREST + .18), naval, col))
        put(rod(name + '.trunnion-bearing', (trunnion, across - .11, pivot),
                (trunnion, across + .11, pivot), .15, edge, col, vertices=12))
    put(rod(name + '.king-post', (-.52, 0, .14), (-.52, 0, roof_surface(-.52, 0) - .03),
            .06, naval, col, vertices=8))

    # ---- guns ---------------------------------------------------------------
    for side, across, _ in barrel_layout(spec):
        elevation = node(side + '.elevation', yaw, (trunnion, across, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = node(side + '.recoil', elevation)
        node(side + '.muzzle', recoil, (length, 0, 0))
        put(box(name + '.breech', (-.39, 0, .05), (.46, .52, .56), edge, col), recoil)
        put(rod(name + '.breech-ring', (-.16, 0, 0), (-.02, 0, 0), .225, edge, col, vertices=16), recoil)
        # One connected surface: a constant jacket long enough for the cuff of
        # the cradle through full recoil, a shoulder, then the chase.
        profile = [(-.16, JACKET), (2.80, JACKET), (2.86, CHASE), (length, CHASE)]
        count = 16
        tube = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count,
                  (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', tube, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, CHASE), (length, bore), (length - .34, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count,
                  (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .36, 0, 0), (length - .34, 0, 0),
                bore, dark, col, vertices=count), recoil)
        put(box(name + '.cradle', (.30, 0, -.24), (1.18, .42, .24), naval, col), elevation)
        put(rod(name + '.trunnion-pin', (0, -.40, 0), (0, .40, 0), .085, edge, col, vertices=12), elevation)
        for offset in [-.26, .26]:
            put(rod(name + '.recoil-cylinder', (-.10, offset, -.17), (1.02, offset, -.17),
                    .080, edge, col, vertices=10), elevation)
        # Toothed elevating quadrant under the cradle; it stays clear of the
        # pedestal crest at full depression.
        sweep = [(0.0, 0.0)] + [(math.cos(math.radians(a)) * .45, math.sin(math.radians(a)) * .45)
                                for a in range(-40, 16, 8)]
        k = len(sweep)
        sector = [(px, -.09, pz) for px, pz in sweep] + [(px, .09, pz) for px, pz in sweep]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        put(mesh(name + '.elevating-quadrant', sector, faces, naval, col), elevation)
        box_shield = [(.24, -.30, -.38), (.24, .28, -.38), (.24, .28, .44), (.24, -.30, .44),
                      (.70, -.30, -.38), (.70, .28, -.38), (.70, .28, .44), (.70, -.30, .44)]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        port_shield = put(mesh(name + '.port-shield', box_shield, faces, naval, col), elevation)
        port_shield.modifiers.new('Port shield knuckle', 'BEVEL').width = .05

    # ---- fittings inside and behind the shield ------------------------------
    for sign in [1, -1]:
        # Layer's seat and elevation handwheel hang off the outboard trunnion
        # standard, outside everything the recoiling breech sweeps through.
        put(box(name + '.layer-seat', (-.30, sign * 1.05, 1.12), (.50, .38, .07), edge, col))
        put(box(name + '.layer-back', (-.52, sign * 1.05, 1.34), (.07, .38, .40), edge, col))
        put(rod(name + '.seat-bracket', (-.30, sign * .90, 1.06), (-.30, sign * 1.05, 1.10), .05, naval, col, vertices=6))
        spokes = [(-.10, sign * 1.20 + .28 * math.cos(math.tau * i / 14), 1.30 + .28 * math.sin(math.tau * i / 14))
                  for i in range(14)]
        put(mesh(name + '.handwheel', spokes + [(-.10, sign * 1.20, 1.30)],
                 [(i, (i + 1) % 14, 14) for i in range(14)], edge, col))
        put(rod(name + '.handwheel-shaft', (-.10, sign * .92, 1.30), (-.10, sign * 1.20, 1.30), .05, edge, col, vertices=8))
        put(box(name + '.sight-hood', (.72, sign * 1.52, 1.74), (.90, .38, .86), naval, col))
        put(box(name + '.sight-window', (1.15, sign * 1.52, 1.86), (.03, .26, .20), glass, col))
        put(rod(name + '.loading-rail', (-1.70, sign * 1.45, 1.98), (.00, sign * 1.45, 1.98), .06, edge, col, vertices=8))
        for x in [-1.50, -.70, .00]:
            put(rod(name + '.rail-hanger', (x, sign * 1.45, 1.98), (x, sign * 1.45, roof_surface(x, 1.45) - .03),
                    .025, painted, col, vertices=6))
        put(box(name + '.loading-tray', (-1.70, sign * 1.00, 1.42), (1.20, .34, .30), edge, col))
        for x in [-1.62, -2.22]:
            put(rod(name + '.tray-pillar', (x, sign * 1.00, 1.02), (x, sign * 1.00, 1.30), .045, naval, col, vertices=6))
        put(rod(name + '.platform-brace', (-.90, sign * .93, .20), (-2.10, sign * .93, .96), .05, naval, col, vertices=6))
        for x in [-1.58, -2.38]:
            put(rod(name + '.rail-stanchion', (x, sign * 1.18, 1.00), (x, sign * 1.18, 1.90), .032, painted, col, vertices=6))
        for z in [1.30, 1.90]:
            put(rod(name + '.guard-rail', (-1.54, sign * 1.18, z), (-2.42, sign * 1.18, z), .026, painted, col, vertices=6))
            put(rod(name + '.guard-rail-end', (-2.42, sign * 1.18, z), (-2.42, sign * .28, z), .026, painted, col, vertices=6))
        put(rod(name + '.ladder-stringer', (-2.52, sign * .24, .26), (-2.52, sign * .24, 1.04), .028, painted, col, vertices=6))
    put(box(name + '.rear-platform', (-2.02, 0, .99), (1.00, 2.50, .07), naval, col))
    put(box(name + '.hoist-head', (-2.00, 0, 1.58), (0.90, 1.27, 1.14), naval, col))
    put(box(name + '.hoist-door', (-2.47, 0, 1.44), (.04, .62, .84), edge, col))
    put(rod(name + '.hoist-handle', (-2.51, -.18, 1.44), (-2.51, .18, 1.44), .025, painted, col, vertices=6))
    for step in range(4):
        put(rod(name + '.platform-step', (-2.52, -.24, .32 + step * .22), (-2.52, .24, .32 + step * .22),
                .025, painted, col, vertices=6))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

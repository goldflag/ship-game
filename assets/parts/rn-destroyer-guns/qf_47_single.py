"""Original 4.7-inch QF Mk IX single shielded mounting.

Visual proportions follow the approved GameModels3D Acasta A/B artillery
(`bgm075_120mm_45_qf_mkix`), the same visual that Icarus, Gallant and Anthony
fit. No reference geometry is loaded here. The catalog owns the weapon data and
the closed armour envelope; this recipe draws the open-backed weather shield on
that same authored surface, opens its gun port and the notch the barrel
elevates through, and adds the turntable, the rotating platform, the pedestal,
the sliding barrel, the elevating port shield, layers' seats and the rear
loading tray.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
Everything above the horizontal rule is plain geometry, shared with the
generator that writes the catalog's `gunhouseMesh`.
"""
import math

# Plan half-breadth of the shield: the rear rim with its corner chamfer, the
# nearly parallel sides, then the flat front face read off from its corner in.
PLAN = [(-0.70, 1.34), (-0.59, 1.57), (0.30, 1.50), (1.01, 1.44),
        (1.01, 1.02), (1.01, 0.60), (1.01, 0.00)]
DATUM = 0.22        # height at which PLAN was measured
RAKE = -0.19        # the front face lies back this far per metre of height
FOOT = 0.178        # the shield's lower rim, level all round
RIDGE = 2.181       # roof at the rear rim
FALL = 0.1245       # the flat roof drops this far per metre going forward
SILL = (1.35, 1.35, 1.35, 1.30, 1.25, 1.00, 0.79)   # gun-port sill, per plan point
GUN_PORT = 4        # the port spans PLAN[4]..PLAN[6] of the front face
ROOF_STATIONS = (0, 1, 2, 3)
ROOF_LINES = (1.02, 0.60)   # the barrel elevates through the notch inside 0.60
ROOF_NOTCH = 2      # the notch runs from this station forward


def rake(x):
    return RAKE * min(1.0, max(0.0, x / PLAN[-1][0]))


def roof_surface(x):
    """Flat roof plate, sloping down forward; no athwartships camber."""
    return RIDGE - FALL * (x - PLAN[0][0])


def station(index, z):
    """A shield plan point carried to height z, following the front-face rake."""
    x, y = PLAN[index]
    return (x + rake(x) * (z - DATUM), y)


def head(index):
    """Height where the wall meets the sloping roof, solved for the rake."""
    z = RIDGE
    for _ in range(4):
        z = roof_surface(station(index, z)[0])
    return z


def level(index, row):
    return (FOOT, SILL[index], head(index))[row]


def roof_lines(index):
    width = PLAN[index][1]
    half = [width] + [min(v, width) for v in ROOF_LINES] + [0.0]
    return half + [-v for v in reversed(half[:-1])]


def _ring(indices):
    return [(i, 1) for i in indices] + [(i, -1) for i in reversed(indices[:-1])]


def walls(points):
    """Quads of the skirt and head bands, tagged by what they carry."""
    indices = tuple(range(len(PLAN)))
    ring = _ring(indices)
    grid = {}
    for column, (index, side) in enumerate(ring):
        for row in range(3):
            z = level(index, row)
            x, y = station(index, z)
            grid[(column, row)] = len(points)
            points.append((x, side * y, z))
    out = []
    for column in range(len(ring) - 1):
        (left, _), (right, _) = ring[column], ring[column + 1]
        pair = (min(left, right), max(left, right))
        for row in range(2):
            tag = 'port' if row == 1 and pair[0] >= GUN_PORT else 'wall'
            out.append(((grid[(column, row)], grid[(column, row + 1)],
                         grid[(column + 1, row + 1)], grid[(column + 1, row)]), tag))
    return out, grid, ring


def roof(points):
    """Quads of the flat roof, seated on the head of the wall."""
    cells = {}
    for column, index in enumerate(ROOF_STATIONS):
        x = station(index, head(index))[0]
        z = roof_surface(x)
        for row, y in enumerate(roof_lines(index)):
            cells[(column, row)] = len(points)
            points.append((x, y, z))
    out = []
    for column in range(len(ROOF_STATIONS) - 1):
        for row in range(len(roof_lines(ROOF_STATIONS[column])) - 1):
            quad = (cells[(column, row)], cells[(column, row + 1)],
                    cells[(column + 1, row + 1)], cells[(column + 1, row)])
            corners = {(round(points[i][0], 4), round(points[i][1], 4)) for i in quad}
            if len(corners) < 3:
                continue
            outer = max(abs(points[i][1]) for i in quad)
            cut = ROOF_STATIONS[column] >= ROOF_NOTCH and outer <= ROOF_LINES[1] + 1e-6
            out.append((quad, 'roof-notch' if cut else 'roof'))
    return out, cells


def envelope():
    """Closed coarse armour envelope: the same surface, everything closed over."""
    points = []
    bands, grid, ring = walls(points)
    faces = [(quad, 'naval') for quad, _ in bands]
    covers, cells = roof(points)
    faces += [(quad, 'roof') for quad, _ in covers]
    sole = [grid[(column, 0)] for column in range(len(ring))]
    faces += [((sole[0], sole[i], sole[i + 1]), 'naval') for i in range(1, len(sole) - 1)]
    # The rear opening is closed from the crown of its rim: the head of the
    # wall is the outer end of the roof's rear edge, so that edge joins in.
    lines = len(roof_lines(ROOF_STATIONS[0]))
    rear = ([grid[(0, 0)], grid[(0, 1)]] + [cells[(0, row)] for row in range(lines)]
            + [grid[(len(ring) - 1, 1)], grid[(len(ring) - 1, 0)]])
    # Fan from the port sill: the roof's rear edge and each wall column are
    # straight, so only a point off both can carry the triangulation.
    rear = rear[1:] + rear[:1]
    faces += [((rear[0], rear[i + 1], rear[i]), 'naval') for i in range(1, len(rear) - 1)]
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

JACKET = .162
CHASE = .102
CREST = .70     # pedestal crest; the elevating gear swings clear above it


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
    points = []
    bands, _, _ = walls(points)
    covers, _ = roof(points)
    plating(put(mesh(name + '.shield', points, [q for q, tag in bands if tag == 'wall'], naval, col)))
    plating(put(mesh(name + '.shield-roof', points, [q for q, tag in covers if tag == 'roof'], roof_mat, col)))

    pivot, trunnion = spec['pivotHeight'], spec['trunnionForward']
    length = spec['muzzleForward'] - trunnion
    bore = spec['caliberM'] / 2

    # ---- rotating structure -------------------------------------------------
    put(cyl(name + '.roller-path', (0, 0, .045), .95, .09, edge, col, 36))
    put(cyl(name + '.turntable', (0, 0, .140), .87, .096, naval, col, 36))
    # Rotating gun platform: it carries the shield, the seats and the loading
    # tray, and overhangs the roller path on radial knees.
    deck = [(-1.36, 1.52), (.57, 1.52), (.57, -1.52), (-1.36, -1.52)]
    put(mesh(name + '.platform',
             [(x, y, .184) for x, y in deck] + [(x, y, .304) for x, y in deck],
             [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
             naval, col))
    for angle in range(0, 360, 30):
        radians = math.radians(angle)
        x, y = math.cos(radians), math.sin(radians)
        reach = min(1.50, abs(1.50 / max(.001, abs(y))), abs(.56 / max(.001, abs(x)))
                    if x > 0 else abs(1.35 / max(.001, abs(x))))
        put(mesh(name + '.platform-knee',
                 [(x * .80, y * .80, .06), (x * .80, y * .80, .184), (x * reach, y * reach, .184)],
                 [(0, 1, 2)], naval, col)).modifiers.new('Knee plate', 'SOLIDIFY').thickness = .022
    skirt = [(-.55, .64), (.62, .64), (.62, -.64), (-.55, -.64)]
    crest = [(-.34, .40), (.44, .40), (.44, -.40), (-.34, -.40)]
    put(mesh(name + '.pedestal',
             [(x, y, .30) for x, y in skirt] + [(x, y, CREST) for x, y in crest],
             [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)], naval, col))
    for across in [.50, -.50]:
        put(box(name + '.trunnion-standard', (trunnion, across, (CREST + pivot) / 2 + .09),
                (.32, .20, pivot - CREST + .18), naval, col))
        put(rod(name + '.trunnion-bearing', (trunnion, across - .11, pivot),
                (trunnion, across + .11, pivot), .15, edge, col, vertices=12))

    # ---- gun ----------------------------------------------------------------
    for side, across, _ in barrel_layout(spec):
        elevation = node(side + '.elevation', yaw, (trunnion, across, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = node(side + '.recoil', elevation)
        node(side + '.muzzle', recoil, (length, 0, 0))
        put(box(name + '.breech', (-.40, 0, .04), (.48, .50, .54), edge, col), recoil)
        put(rod(name + '.breech-ring', (-.16, 0, 0), (-.02, 0, 0), .22, edge, col, vertices=16), recoil)
        profile = [(-.16, JACKET), (2.10, JACKET), (2.16, CHASE), (length, CHASE)]
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
        put(box(name + '.cradle', (.30, 0, -.24), (1.10, .40, .24), naval, col), elevation)
        put(rod(name + '.trunnion-pin', (0, -.56, 0), (0, .56, 0), .085, edge, col, vertices=12), elevation)
        for offset in [-.25, .25]:
            put(rod(name + '.recoil-cylinder', (-.08, offset, -.16), (.96, offset, -.16),
                    .078, edge, col, vertices=10), elevation)
        sweep = [(0.0, 0.0)] + [(math.cos(math.radians(a)) * .44, math.sin(math.radians(a)) * .44)
                                for a in range(-40, 16, 8)]
        k = len(sweep)
        sector = [(px, -.09, pz) for px, pz in sweep] + [(px, .09, pz) for px, pz in sweep]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        put(mesh(name + '.elevating-quadrant', sector, faces, naval, col), elevation)
        shape = [(.16, -.38, -.36), (.16, .38, -.36), (.16, .38, .38), (.16, -.38, .38),
                 (.56, -.38, -.36), (.56, .38, -.36), (.56, .38, .38), (.56, -.38, .38)]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        put(mesh(name + '.port-shield', shape, faces, naval, col), elevation).modifiers.new(
            'Port shield knuckle', 'BEVEL').width = .05

    # ---- fittings -----------------------------------------------------------
    for sign in [1, -1]:
        put(box(name + '.layer-seat', (-.42, sign * .90, .84), (.38, .44, .06), edge, col))
        put(rod(name + '.seat-bracket', (-.42, sign * .66, .80), (-.42, sign * .90, .82), .045, naval, col, vertices=6))
        spokes = [(-.06, sign * .84 + .26 * math.cos(math.tau * i / 14), 1.22 + .26 * math.sin(math.tau * i / 14))
                  for i in range(14)]
        put(mesh(name + '.handwheel', spokes + [(-.06, sign * .84, 1.22)],
                 [(i, (i + 1) % 14, 14) for i in range(14)], edge, col))
        put(rod(name + '.handwheel-shaft', (-.06, sign * .60, 1.22), (-.06, sign * .84, 1.22), .045, edge, col, vertices=8))
        put(box(name + '.sight-box', (.60, sign * .88, 1.42), (.22, .12, .22), naval, col))
        put(box(name + '.sight-window', (.71, sign * .88, 1.42), (.02, .09, .09), glass, col))
        # Ladder rungs up the outside of each side wall, as on the approved model.
        for step in range(5):
            z = .42 + step * .35
            outboard = station(1, z)
            put(rod(name + '.side-rung', (-.30, sign * (outboard[1] + .02), z),
                    (-.30, sign * (outboard[1] + .20), z), .022, painted, col, vertices=6))
        put(rod(name + '.side-rail', (-.30, sign * (PLAN[1][1] + .20), .42),
                (-.30, sign * (PLAN[1][1] + .20), 1.82), .024, painted, col, vertices=6))
        # The loading trays and the rear gear stand outboard of everything the
        # recoiling breech sweeps through on its way out of the open back.
        put(box(name + '.loading-tray', (-1.42, sign * .60, 1.15), (2.02, .30, .36), edge, col))
        put(rod(name + '.tray-rail', (-.60, sign * .60, 1.36), (-2.48, sign * .60, 1.36), .040, edge, col, vertices=8))
        put(rod(name + '.tray-strut', (-2.34, sign * .60, 1.15), (-1.30, sign * .52, .31), .04, naval, col, vertices=6))
        put(rod(name + '.tray-pillar', (-.66, sign * .60, .31), (-.66, sign * .60, .99), .05, naval, col, vertices=8))
        put(box(name + '.rear-gear', (-1.00, sign * .62, 1.63), (.50, .30, .50), naval, col))
        put(box(name + '.rear-plate', (-.32, sign * .48, 1.70), (.10, .30, .31), naval, col))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

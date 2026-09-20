"""Original 4.7-inch/50 QF Mk XI twin gunhouse, the L-class main mounting.

Visual proportions follow the approved GameModels3D Lightning A/B artillery
(`bgm086_4_7in_50qf_mkxi`). No reference geometry is loaded here. Unlike the
Mk XII twin and the Mk IX single this is a fully enclosed gunhouse, so the
catalog `gunhouseMesh` is both the armour and the visible shell, as on the
German sibling; the recipe draws that shell and adds the rotating stalk, the
elevating mantlet housings, the sliding barrels, the flank ladders, the rear
roof step and the roof hood.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
Everything above the horizontal rule is plain geometry, shared with the
generator that writes the catalog's `gunhouseMesh`.
"""
import math

# Transverse stations of the gunhouse, read off the approved model.
#   x, half-breadth, lower rim, head of the side, head at the port line,
#   floor of the gun trough, head of the raised centre, crown
# A station whose half-breadth falls inside a y line collapses that point onto
# the side, which is how the trough and the raised centre die out at the nose.
STATIONS = [
    (-2.513, 1.80, 0.000, 2.70, 2.94, 2.975, 2.975, 2.975),
    (-1.300, 2.04, 0.490, 2.74, 2.90, 2.933, 2.933, 2.933),
    (-0.100, 2.16, 0.518, 2.76, 2.86, 2.888, 2.888, 2.888),
    (0.300, 2.10, 0.518, 1.70, 1.70, 1.350, 2.870, 2.870),
    (1.900, 1.38, 0.518, 1.25, 1.25, 0.950, 2.230, 2.230),
    (2.520, 0.90, 0.518, 1.15, 1.15, 1.950, 1.950, 1.950),
]
PORT_Y = 1.44       # outboard edge of the gun trough
TROUGH_Y = 0.97     # inboard edge of the trough, and the foot of the centre
PIVOT = 1.961
BARREL_Y = 1.221


def profile(index):
    """One station's section, from the port lower rim over the crown.

    Points are returned port side first; the crown is shared. Coincident
    points are welded later, so a station narrower than a y line simply
    loses that point.
    """
    x, w, low, side, port, trough, centre, crown = STATIONS[index]
    py, ty = min(PORT_Y, w), min(TROUGH_Y, w)
    if py >= w - 1e-9:
        port = side
    if ty >= w - 1e-9:
        trough = centre = crown
    half = [(w, low), (w, side), (py, port), (ty, trough), (ty, centre)]
    return x, half + [(0.0, crown)] + [(-y, z) for y, z in reversed(half)]


def shell():
    """Vertices and quads of the gunhouse skin, tagged by the band they carry."""
    points = []
    grid = {}
    for index in range(len(STATIONS)):
        x, section = profile(index)
        for row, (y, z) in enumerate(section):
            grid[(index, row)] = len(points)
            points.append((x, y, z))
    rows = len(profile(0)[1])
    faces = []
    for index in range(len(STATIONS) - 1):
        for row in range(rows - 1):
            faces.append(((grid[(index, row)], grid[(index, row + 1)],
                           grid[(index + 1, row + 1)], grid[(index + 1, row)]), 'roof' if 1 <= row <= rows - 3 else 'naval'))
    return points, grid, faces, rows


def envelope():
    """Closed armour envelope; it is also the visible gunhouse."""
    points, grid, faces, rows = shell()
    weld = {}
    merged = []
    remap = []
    for point in points:
        key = tuple(round(v, 4) for v in point)
        if key not in weld:
            weld[key] = len(merged)
            merged.append(point)
        remap.append(weld[key])
    grid = {k: remap[v] for k, v in grid.items()}
    faces = [(tuple(remap[i] for i in indices), finish) for indices, finish in faces]

    def loop(indices):
        """Drop the repeats a collapsed station leaves in a cap outline."""
        out = []
        for i in indices:
            if not out or out[-1] != i:
                out.append(i)
        while len(out) > 1 and out[0] == out[-1]:
            out.pop()
        return out

    def fan(indices, apex, flip):
        out = []
        n = len(indices)
        start = indices.index(apex)
        order = indices[start:] + indices[:start]
        for i in range(1, n - 1):
            triangle = (order[0], order[i], order[i + 1])
            out.append((tuple(reversed(triangle)) if flip else triangle, 'naval'))
        return out

    last = len(STATIONS) - 1
    sole = loop([grid[(index, 0)] for index in range(len(STATIONS))]
                + [grid[(index, rows - 1)] for index in reversed(range(len(STATIONS)))])
    faces += fan(sole, sole[0], False)
    rear = loop([grid[(0, row)] for row in range(rows)])
    faces += fan(rear, rear[1], True)
    nose = loop([grid[(last, row)] for row in range(rows)])
    faces += fan(nose, nose[1], False)
    triangles = []
    for indices, finish in faces:
        corners = [merged[i] for i in indices]
        keys = [tuple(round(v, 4) for v in c) for c in corners]
        order = [indices] if len(indices) == 3 else [indices[:3], (indices[0], indices[2], indices[3])]
        for triangle in order:
            if len({tuple(round(v, 4) for v in merged[i]) for i in triangle}) == 3:
                triangles.append((tuple(triangle), finish))
    return merged, triangles


# --------------------------------------------------------------------------
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.geometry import intersect_ray_tri  # noqa: E402
from blender_barrels import barrel_layout  # noqa: E402

CHASE = .174
SOLE = .52      # the gunhouse floor stands this far over the deck ring


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

    def joint(suffix, parent=None, loc=(0, 0, 0)):
        empty = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(empty)
        empty.location = loc
        empty.parent = parent
        empty['nodeId'] = empty.name
        empty['assemblyId'] = name
        return empty

    yaw = joint('yaw')

    def put(obj, parent=None):
        obj.parent = parent or yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = name
        return obj

    # The visible gunhouse is exactly the catalog's armour shell, so the roof,
    # the gun troughs and the raised centre stay aligned with their protection.
    shape = spec['gunhouseMesh']
    house = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    house.data.materials.append(roof_mat)
    for polygon, face in zip(house.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]

    def top_z(x, y):
        hits = [intersect_ray_tri(*t, Vector((0, 0, -1)), Vector((x, y, 6))) for t in plates]
        return max((h.z for h in hits if h is not None), default=2.9)

    # Rotating stalk between the gunhouse floor and the deck ring; the ship
    # owns the fixed barbette under it.
    put(cyl(name + '.turntable', (0, 0, SOLE / 2), 1.70, SOLE, naval, col, 40))

    pivot, trunnion = spec['pivotHeight'], spec['trunnionForward']
    length = spec['muzzleForward'] - trunnion
    bore = spec['caliberM'] / 2

    for side, across, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (trunnion, across, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # Mantlet housing and the ring boss on the chase both pitch with the
        # gun; the barrel slides through them on recoil.
        put(box(name + '.mantlet-housing', (.49, 0, .29), (.86, .58, 1.11), naval, col), elevation)
        put(box(name + '.mantlet-cap', (.94, 0, .29), (.08, .38, .92), edge, col), elevation)
        put(box(name + '.chase-boss', (1.05, 0, 0), (.43, .31, .34), naval, col), elevation)
        profile_points = [(-.90, .20), (1.10, .20), (1.18, CHASE), (length - .30, CHASE),
                          (length - .18, .186), (length, .186)]
        count = 16
        tube = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                for x, r in profile_points for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count,
                  (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile_points) - 1) for i in range(count)]
        put(mesh(name + '.barrel', tube, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .186), (length, bore), (length - .34, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count,
                  (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .36, 0, 0), (length - .34, 0, 0),
                bore, dark, col, vertices=count), recoil)

    # ---- external fittings --------------------------------------------------
    # Roof hood over the layer's periscope, at the rear of the crown.
    hood = -2.15
    put(box(name + '.periscope-hood', (hood, 0, top_z(hood, 0) + .14), (.40, .40, .30), naval, col))
    put(box(name + '.hood-window', (hood + .21, 0, top_z(hood, 0) + .17), (.03, .22, .12), glass, col))
    put(rod(name + '.roof-aerial', (-1.94, 0, top_z(-1.94, 0) - .02),
            (-1.64, 0, top_z(-1.64, 0) + .12), .02, painted, col, vertices=6))
    # Rear step over the back plate, on brackets off the rear face.
    put(box(name + '.rear-step', (-2.60, 0, 2.70), (.12, 3.40, .06), edge, col))
    for sign in [1, -1]:
        put(rod(name + '.step-bracket', (-2.52, sign * 1.55, 2.60), (-2.62, sign * 1.55, 2.68),
                .035, naval, col, vertices=6))
        # Flank ladder up the rear quarter, on standoffs off the plating.
        rail = -2.57
        put(rod(name + '.ladder-rail', (rail, sign * 1.17, .55), (rail, sign * 1.17, 2.72), .026, painted, col, vertices=6))
        put(rod(name + '.ladder-rail', (rail, sign * 1.31, .55), (rail, sign * 1.31, 2.72), .026, painted, col, vertices=6))
        for i in range(8):
            z = .70 + i * .29
            put(rod(name + '.ladder-rung', (rail, sign * 1.17, z), (rail, sign * 1.31, z), .020, painted, col, vertices=4))
        for z in [.90, 1.90, 2.60]:
            put(rod(name + '.ladder-standoff', (-2.47, sign * 1.24, z), (rail, sign * 1.24, z), .022, painted, col, vertices=4))
        # Grab rails along the roof edge and a sight port in each cheek.
        points = [(-2.10, 1.72), (-1.00, 1.92), (0.00, 1.96)]
        seats = [(x, sign * y, top_z(x, sign * y)) for x, y in points]
        for (ax, ay, az), (bx, by, bz) in zip(seats, seats[1:]):
            put(rod(name + '.roof-grab', (ax, ay, az + .17), (bx, by, bz + .17), .018, painted, col, vertices=4))
        for x, y, z in seats:
            put(rod(name + '.grab-post', (x, y, z - .01), (x, y, z + .17), .020, naval, col, vertices=4))
        put(box(name + '.sight-port', (-0.30, sign * 2.17, 2.30), (.46, .04, .30), glass, col))
        put(box(name + '.sight-hood', (-0.30, sign * 2.14, 2.50), (.56, .10, .07), naval, col))
        # Rear door with its hinges and handle.
        put(box(name + '.rear-door', (-2.50, sign * .78, 1.60), (.05, .86, 1.70), naval, col))
        put(rod(name + '.door-handle', (-2.54, sign * .42, 1.52), (-2.54, sign * .42, 1.72), .022, edge, col, vertices=6))
        for z in [.95, 2.25]:
            put(rod(name + '.door-hinge', (-2.53, sign * 1.19, z - .09), (-2.53, sign * 1.19, z + .09), .028, edge, col, vertices=6))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

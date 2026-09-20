"""Original 20 cm/50 3rd Year Type twin, Model E, of Furutaka and the Takao class.

Visual proportions follow the approved GameModels3D pjsc005 AB1 artillery
(`jgm146_203mm50_type_e`); Atago (pjsc038) and Maya (pjsc517) fit the same
mounting as `jgm025_203mm50_type_e`. It is a different gunhouse from the
catalog's Mogami E3 mount: wider and longer, with a pointed stern facet, a
steep glacis carrying climbing rungs, a flat roof with a full perimeter
railing and a raised trunk on the port shoulder. No reference geometry is
loaded here. The catalog owns the closed armour shell and the weapon data.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

CHASE = .195            # barrel radius outside the bloomer
JACKET = .24            # sliding jacket radius at the trunnion
COLLAR = 2.80           # cuff station forward of the trunnion
ROOF_Z = 2.06

# Railing stations on the roof edge, as (x, y, z, stanchion). The rail runs
# aft from the front gate posts, round the stern and back.
RAIL = [
    (1.46, 1.29, ROOF_Z, True), (1.46, .65, ROOF_Z, True),
]
RAIL_SIDE = [
    (1.46, 2.175, ROOF_Z, True), (-.305, 2.375, ROOF_Z, True), (-1.695, 2.53, ROOF_Z, True),
    (-4.545, 2.21, ROOF_Z, True), (-5.01, .915, ROOF_Z, True), (-5.01, .435, ROOF_Z, True),
]
# Climbing rungs up the glacis, as (z, half-length) columns.
RUNG_Z = [.35, .65, .95, 1.25, 1.49, 1.70, 1.88, 2.01]


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    naval, roof, edge, dark, painted, glass = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'])
    name = mount['id']
    spec = mount['weapon']

    def joint(suffix, parent=None, loc=(0, 0, 0)):
        node = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(node)
        node.location = loc
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = name
        return node

    yaw = joint('yaw')

    def put(obj, parent=None):
        obj.parent = parent or yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = name
        return obj

    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]

    def cast(origin, direction):
        hits = [intersect_ray_tri(*t, Vector(direction), Vector(origin)) for t in plates]
        return [h for h in hits if h is not None]

    def front_x(y, z):
        return max(h.x for h in cast((20, y, z), (-1, 0, 0)))

    def side_y(x, z, sign=1):
        hits = cast((x, sign * 20, z), (0, -sign, 0))
        return sign * max(sign * h.y for h in hits) if hits else 0.0

    put(cyl(name + '.turntable', (0, 0, spec['gunhouseBaseHeight'] / 2), spec.get('rollerRadius', 2.76),
            spec['gunhouseBaseHeight'], edge, col, 40))

    # --- guns -------------------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        profile = [(.05, JACKET), (1.85, JACKET), (2.00, .215), (2.40, CHASE), (length, CHASE)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, CHASE), (length, bore), (length - .35, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .37, 0, 0), (length - .35, 0, 0), bore, dark, col, vertices=count), recoil)
        # Weather collar clamped on the chase just outside the bloomer cuff.
        put(rod(name + '.chase-collar', (2.64, 0, 0), (3.07, 0, 0), .22, edge, col, vertices=14), recoil)

    # --- glacis detail -----------------------------------------------------
    # Raised ridges between and outboard of the gun ports: the reference sinks
    # the ports into deep pockets, and these ridges are the pocket walls that
    # survive on the closed armour face.
    glacis_lean = -math.atan2(1.21, 1.0)     # steep front slope above the knuckle
    face_lean = -math.atan2(.31, 1.0)        # gentler plate below it
    for y in (1.945, 0.0, -1.945):
        o = put(box(name + '.glacis-ridge', (front_x(y, 1.465) + .06, y, 1.465), (.12, .37, 1.08), naval, col))
        o.rotation_euler.y = glacis_lean
    for y, width in ((0.0, .83), (1.945, .42), (-1.945, .42)):
        o = put(box(name + '.face-panel', (front_x(y, 1.02) + .05, y, 1.02), (.09, width, .47), naval, col))
        o.rotation_euler.y = face_lean
    # Three columns of climbing rungs up the face and glacis.
    # The centre column is short so it stays clear of the starboard jacket
    # through elevation, exactly as the reference cuts it.
    for y, reach in ((1.52, .20), (-1.52, .20), (-.53, .10)):
        for z in RUNG_Z:
            put(rod(name + '.face-rung', (front_x(y, z) + .022, y - reach, z), (front_x(y, z) + .022, y + reach, z),
                    .026, painted, col, vertices=4))

    # --- roof furniture ---------------------------------------------------
    put(cyl(name + '.sight-flange', (-.585, 0, ROOF_Z + .05), .29, .13, naval, col, 12))
    put(cyl(name + '.sight-drum', (-.59, 0, ROOF_Z + .26), .33, .35, naval, col, 12))
    put(box(name + '.sight-window', (-.28, 0, ROOF_Z + .28), (.03, .26, .14), glass, col))
    for y in (1.945, -1.945, 0.0):
        put(box(name + '.roof-hatch', (1.05, y, ROOF_Z + .05), (.92, .82 if y == 0 else .41, .12), roof, col))
    # Raised trunk on the port shoulder of the flat roof.
    put(box(name + '.shoulder-trunk', (-1.93, 1.775, ROOF_Z + .28), (1.46, 1.47, .60), naval, col))
    put(box(name + '.shoulder-trunk-lid', (-1.93, 1.775, ROOF_Z + .60), (1.32, 1.33, .07), roof, col))

    # Perimeter railing standing on the roof edge.
    def railing(run, close=False):
        stations = list(run) + [(x, -y, z, post) for x, y, z, post in reversed(run) if abs(y) > 1e-6]
        tops = []
        for x, y, z, post in stations:
            if post:
                put(rod(name + '.rail-post', (x, y, z - .05), (x, y, z + .50), .024, painted, col, vertices=4))
            tops.append((x, y, z + .46))
        pairs = list(zip(tops, tops[1:])) + ([(tops[-1], tops[0])] if close else [])
        for a, b in pairs:
            put(rod(name + '.rail', a, b, .022, painted, col, vertices=4))

    railing(RAIL)
    railing(RAIL_SIDE)
    for sign in (1, -1):
        put(box(name + '.rail-kick-plate', (1.035, sign * 2.23, ROOF_Z + .27), (.85, .13, .47), naval, col))

    # --- ladders -----------------------------------------------------------
    # Inclined flank ladder on the port side plate, following its tumblehome.
    foot, head = Vector((-.10, 3.03, .15)), Vector((-.10, 2.46, 1.88))
    for x in (-.25, .05):
        put(mesh(name + '.flank-ladder-stringer',
                 [(x, foot.y + .03, foot.z), (x, foot.y - .09, foot.z),
                  (x, head.y - .09, head.z), (x, head.y + .03, head.z)],
                 [(0, 1, 2, 3)], painted, col))
    for i in range(5):
        t = (i + .5) / 5.5
        y = foot.y + (head.y - foot.y) * t
        z = foot.z + (head.z - foot.z) * t
        put(rod(name + '.flank-ladder-rung', (-.25, y + .02, z), (.05, y + .02, z), .022, painted, col, vertices=4))
    put(box(name + '.flank-ladder-platform', (-.10, 2.33, ROOF_Z + .06), (.32, .10, .14), painted, col))

    # Rear ladder on the pointed stern facet.
    p, q = Vector((-5.37, .00)), Vector((-5.28, .93))
    tangent = (q - p).normalized()
    outward = Vector((-tangent.y, tangent.x))
    if outward.x > 0:
        outward = -outward
    for t in (.55, .88):
        seat = p + (q - p) * t
        foot_xy = seat + outward * .04
        put(rod(name + '.rear-ladder-rail', (foot_xy.x, foot_xy.y, .07), (foot_xy.x, foot_xy.y, 1.90),
                .022, painted, col, vertices=4))
        for z in (.10, .90, 1.86):
            put(rod(name + '.rear-ladder-standoff', (seat.x, seat.y, z), (foot_xy.x, foot_xy.y, z),
                    .018, painted, col, vertices=4))
    for z in (.36, .66, .95, 1.23, 1.52, 1.82):
        a = p + (q - p) * .55 + outward * .07
        b = p + (q - p) * .88 + outward * .07
        put(rod(name + '.rear-ladder-rung', (a.x, a.y, z), (b.x, b.y, z), .018, painted, col, vertices=4))
    put(box(name + '.rear-ladder-platform', (-4.875, .675, ROOF_Z + .06), (.10, .32, .14), painted, col))

    # --- canvas gun-port covers ------------------------------------------
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .40 * math.copysign(abs(math.cos(a)) ** .82, math.cos(a))
            zz = 1.045 + .945 * math.copysign(abs(math.sin(a)) ** .75, math.sin(a))
            seam.append((front_x(yy, zz) + .012, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, CHASE + .018,
                               rings=6, fold_depth=.026, slack=.04, fullness=.05)
        # Drape the intermediate rings over the glacis and keep them outside
        # the sliding jacket, without moving the seam or the pitching cuff.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        sectors = int(cover['gunCoverFixedVertexCount'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < sectors or index >= len(key.data) - sectors:
                    continue
                plate = cast((20, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .03)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                clear = JACKET + .045
                if 0 < distance < clear:
                    for i in range(3):
                        point.co[i] += radial[i] * (clear / distance - 1)
        for vertex, base in zip(cover.data.vertices, cover.data.shape_keys.key_blocks[0].data):
            vertex.co = base.co

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

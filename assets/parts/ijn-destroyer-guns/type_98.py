"""Original 10 cm/65 Type 98 twin, the Akizuki-class dual-purpose mounting.

Visual proportions follow the approved GameModels3D Akizuki AB1 artillery
(`jgm055_100mm65_type98`). No reference geometry is loaded here. The catalog
owns the closed splinter enclosure and the weapon data; this recipe draws that
enclosure and adds the turntable sole, the roof trough with its pivoting
mantlets, sliding barrels, sight hoods, guard rails, flank ladders, the twin
rear door and the roof fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout

SLEEVE = .178  # sliding jacket radius through the mantlet
MANTLET = .60  # mantlet plate radius about the trunnion
SLOT = (.17, .565)  # mantlet half-width limits either side of the centre web


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

    def tube_path(label, points, radius, material, sides=6, parent=None):
        pts = [Vector(p) for p in points]
        verts = []
        count = len(pts)
        for i, p in enumerate(pts):
            delta = pts[min(i + 1, count - 1)] - pts[max(i - 1, 0)]
            q = delta.to_track_quat('Z', 'Y')
            verts += [p + q @ Vector((radius * math.cos(j * math.tau / sides),
                                     radius * math.sin(j * math.tau / sides), 0)) for j in range(sides)]
        faces = [(i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
                 for i in range(count - 1) for j in range(sides)]
        faces += [tuple(reversed(range(sides))), tuple((count - 1) * sides + j for j in range(sides))]
        return put(mesh(name + '.' + label, verts, faces, material, col, True), parent)

    # The visible enclosure is exactly the catalog's armour shell, so the crown,
    # flanks and the gun trough stay aligned with their protection.
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
        hits = cast((20, y, z), (-1, 0, 0))
        return max((h.x for h in hits), default=0)

    def rear_x(y, z):
        hits = cast((-20, y, z), (1, 0, 0))
        return min((h.x for h in hits), default=0)

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max((h.z for h in hits), default=.36)

    def flank_y(x, z):
        hits = cast((x, 20, z), (0, -1, 0))
        return max((h.y for h in hits), default=0)

    # Rotating sole. The ship owns the fixed barbette below it; the gunhouse
    # floor overhangs the roller path on radial knee plates.
    put(cyl(name + '.turntable', (0, 0, .188), spec['rollerRadius'], .375, naval, col, 32))
    for i in range(16):
        angle = (i + .5) * math.tau / 16
        u, v = math.cos(angle), math.sin(angle)
        hits = cast((u * 9, v * 9, .55), (-u, -v, 0))
        far = max((h.x * u + h.y * v for h in hits), default=1.9)
        knee = put(mesh(name + '.floor-knee', [(u * 1.72, v * 1.72, .06), (u * 1.72, v * 1.72, .363),
                                               (u * far, v * far, .363), (u * far, v * far, .25)],
                        [(0, 1, 2, 3)], naval, col))
        thickness = knee.modifiers.new('Knee plate thickness', 'SOLIDIFY')
        thickness.thickness = .024

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, lateral, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], lateral, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough to stay inside the
        # mantlet through the full stroke, a shoulder, then the tapering chase.
        profile = [(-.28, SLEEVE), (1.14, SLEEVE), (1.20, .152), (length - .42, .078),
                   (length - .14, .073), (length, .073)]
        count = 12
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        faces.append(tuple(reversed(range(count))))
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .073), (length, .081), (length - .22, .081), (length - .22, bore),
                            (length, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(4) for i in range(count)]
        put(mesh(name + '.muzzle-collar', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .24, 0, 0), (length - .22, 0, 0), bore, dark, col, vertices=count), recoil)

        # Pivoting mantlet: a D plate on the trunnion axis that closes its own
        # slot at every elevation and stays clear of the trough sole.
        sign = 1 if lateral > 0 else -1
        inner, outer = sorted((sign * SLOT[0] - lateral, sign * SLOT[1] - lateral))
        section = [(MANTLET * math.cos(math.radians(a)), MANTLET * math.sin(math.radians(a)))
                   for a in [-110 + 22 * k for k in range(11)]]
        k = len(section)
        points = [(x, y, z) for y in (inner, outer) for x, z in section]
        faces = [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        faces += [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        put(mesh(name + '.mantlet', points, faces, naval, col), elevation)
        put(box(name + '.mantlet-rib', (.02, (inner + outer) / 2, 0), (.05, outer - inner - .04, 1.12), painted, col, .02), elevation)

        # Cradle and the two recoil cylinders stand behind the mantlet, in sight
        # through the open trough; the breech ring slides with the barrel.
        put(box(name + '.cradle', (-.32, 0, -.02), (.44, .30, .32), naval, col), elevation)
        for lift in (.21, -.21):
            put(rod(name + '.recoil-cylinder', (-.28, 0, lift), (.45, 0, lift), .072, edge, col, vertices=8), elevation)
        put(box(name + '.breech-ring', (-.20, 0, 0), (.24, .26, .26), edge, col, .03), recoil)

    # Fixed splinter web between the two slots, seated on the trough sole and on
    # the trough's aft bulkhead. The mantlets pass either side of it.
    web = [(-.50, 1.12), (1.50, 1.335), (1.62, 1.70), (1.37, 2.10), (1.19, 2.50), (.73, 2.90),
           (.45, 3.005), (-.50, 3.005)]
    k = len(web)
    points = [(x, y, z) for y in (-.15, .15) for x, z in web]
    faces = [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
    faces += [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
    put(mesh(name + '.centre-web', points, faces, naval, col))

    # Guard rail around the roof eaves, from the forward shoulders aft around the
    # rounded stern. Each stanchion stands on the eave plate it guards.
    eave = [(1.21, 2.30), (.40, 2.39), (-.60, 2.36), (-1.60, 2.23), (-2.50, 1.96),
            (-3.10, 1.72), (-3.52, 1.28), (-3.68, .62)]
    rim = [(x, y) for x, y in eave] + [(-3.74, 0)] + [(x, -y) for x, y in reversed(eave)]
    posts = []
    for x, y in rim:
        span = math.hypot(x, y) or 1
        px, py = x + x / span * .14, y + y / span * .14
        base = min(max(top_z(x - x / span * .12, y - y / span * .12), 1.85), 2.16)
        posts.append((px, py, base))
        put(rod(name + '.rail-stanchion', (px, py, base - .02), (px, py, base + 1.02), .022, painted, col, vertices=5))
    for lift in (.52, 1.00):
        tube_path('roof-rail', [(x, y, z + lift) for x, y, z in posts], .019, painted)

    for sign in (1, -1):
        # Flank handrails on short standoffs, at the two levels of the original.
        for level in (.583, 1.517):
            contacts = [(x, sign * flank_y(x, level), level) for x in
                        [2.05, 1.40, .60, -.30, -1.20, -2.10, -2.80, -3.35]]
            tube_path('side-rail', [(x, y + sign * .10, z) for x, y, z in contacts], .017, painted)
            for x, y, z in contacts:
                put(rod(name + '.side-rail-foot', (x, y - sign * .01, z), (x, y + sign * .10, z), .021, naval, col, vertices=4))

        # Recessed access ladder up each forward shoulder to the roof.
        for offset in (1.13, 1.63):
            y = sign * offset
            put(rod(name + '.ladder-stringer', (front_x(y, .45) + .05, y, .45), (front_x(y, 1.86) + .05, y, 1.86),
                    .026, painted, col, vertices=4))
        for z in (.52, .86, 1.20, 1.54, 1.86):
            x = front_x(sign * 1.38, z) + .05
            put(rod(name + '.ladder-rung', (x, sign * 1.13, z), (x, sign * 1.63, z), .019, painted, col, vertices=4))

        # Twin rear door with its frame and handle.
        leaf = sign * .847
        put(box(name + '.rear-door', (rear_x(leaf, 1.08) - .03, leaf, 1.082), (.06, .566, 1.31), naval, col, .05))
        put(rod(name + '.door-handle', (rear_x(leaf, 1.08) - .07, sign * 1.084, .96),
                (rear_x(leaf, 1.08) - .07, sign * 1.084, 1.12), .018, edge, col, vertices=4))
        for z in (.402, 1.762):
            put(box(name + '.door-frame', (rear_x(sign * .60, z) - .015, sign * .60, z), (.05, 1.19, .05), painted, col, .015))

        # The approved model carries the trainer's hood to port and the layer's
        # tall telescope fin to starboard; both are kept where they stand.
        if sign > 0:
            hood = put(box(name + '.sight-hood', (.69, sign * 1.52, 2.24), (.86, .70, .88), naval, col, .07))
            hood.rotation_euler.x = sign * -.30
            put(box(name + '.sight-window', (1.12, sign * 1.52, 2.30), (.03, .34, .16), glass, col, .01))
        else:
            put(box(name + '.sight-telescope', (.72, sign * .92, 2.82), (1.50, .28, .84), naval, col, .06))
            put(box(name + '.sight-window', (1.45, sign * .92, 2.98), (.03, .18, .14), glass, col, .01))

        # Roof fittings: hatch covers, a raised grating and the flank lockers.
        for x, y in ((-.53, .40), (-1.46, 1.26)):
            put(cyl(name + '.roof-hatch', (x, sign * y, top_z(x, sign * y) + .03), .19, .06, roof, col, 12))
        for x, y, z in ((1.28, 2.34, 1.65), (-.63, 2.37, 1.74), (-2.30, 2.15, 1.78)):
            locker = put(box(name + '.flank-locker', (x, sign * (flank_y(x, z) + .14), z), (.40, .30, .40), naval, col, .03))
            locker.rotation_euler.z = sign * -.10

    put(box(name + '.roof-grating', (-1.14, 0, 3.20), (1.65, 1.27, .03), painted, col, .01))
    for x in (-1.90, -1.14, -.39):
        for y in (-.56, .56):
            put(rod(name + '.grating-leg', (x, y, top_z(x, y) - .01), (x, y, 3.19), .028, painted, col, vertices=4))

    for polygon in shell.data.polygons:
        polygon.use_smooth = False
    bevel = shell.modifiers.new('Rolled Type 98 plate edges', 'BEVEL')
    bevel.width = .05
    bevel.segments = 1
    bevel.angle_limit = math.radians(25)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

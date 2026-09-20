"""Original BL 8-inch/50 Mk VIII twin, the County-class cruiser main turret.

Visual proportions follow the approved GameModels3D artillery visual `bgm129_8in50_bl_mk8`
as fitted on pbsc206 (Devonshire), pbsc207 (Surrey) and pbsc538 (Hampshire); pbsc505 (Exeter)
fits `bgm105_8in50_bl_mk8`, whose vertex set is identical. No reference geometry is loaded here.
The catalog owns the closed armor shell and the weapon data; this recipe draws that shell and adds
the roller plate, the gun-port blisters that carry the guns out through the front slope, the
sliding guns on their cradles, the glacis step ladder, the roof hatches and the service fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout

SLEEVE = .33     # sliding jacket radius inside the blister
CHASE = .28      # visible chase radius, as the reference models it


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

    def top_z(x, y):
        return max(h.z for h in cast((x, y, 20), (0, 0, -1)))

    def side_y(x, z):
        return max(h.y for h in cast((x, 20, z), (0, -1, 0)))

    def rear_x(y, z):
        return min(h.x for h in cast((-20, y, z), (1, 0, 0)))

    base = spec['gunhouseBaseHeight']
    pivot = spec['pivotHeight']
    trunnion = spec['trunnionForward']
    length = spec['muzzleForward'] - trunnion
    bore = spec['caliberM'] / 2

    put(cyl(name + '.turntable', (0, 0, base / 2), spec['barbetteRadius'], base, naval, col, 44))

    # ---- guns -------------------------------------------------------------
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (trunnion, y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        profile = [(.04, .29), (.10, SLEEVE), (2.20, SLEEVE), (2.26, .30), (3.20, .30),
                   (3.26, CHASE), (length - .14, .262), (length, .272)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .272), (length, bore), (length - .52, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .54, 0, 0), (length - .52, 0, 0), bore, dark, col, vertices=count), recoil)

        # Cradle, trunnions and the recoil pair under the jacket.
        put(box(name + '.cradle', (1.00, 0, -.26), (1.70, .38, .34), edge, col), elevation)
        put(box(name + '.cradle-cheek', (.12, 0, -.16), (.32, .72, .58), edge, col), elevation)
        for pin in [1, -1]:
            put(rod(name + '.trunnion-pin', (0, pin * .32, 0), (0, pin * .44, 0), .13, edge, col), elevation)
        for lane in [.26, -.26]:
            put(rod(name + '.recoil-cylinder', (.06, lane, -.30), (1.72, lane, -.30), .10, edge, col), elevation)
            put(rod(name + '.recuperator-head', (1.72, lane, -.30), (1.82, lane, -.30), .12, edge, col), elevation)

        # Gun shield: the drooping fairing around each gun, which swings with it
        # and runs in and out of the front slope through elevation and recoil.
        stations = [(2.50, .45, .62, .95), (3.20, .415, .565, .92), (3.62, .38, .55, .88),
                    (4.00, .345, .535, .855), (4.30, .325, .44, .96), (4.53, .295, .295, 1.03),
                    (4.44, .285, .285, 1.04)]
        count = 12
        points = [(x - trunnion, ry * math.cos(math.tau * i / count),
                   zc - pivot + rz * math.sin(math.tau * i / count))
                  for x, ry, rz, zc in stations for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(stations) - 1) for i in range(count)]
        faces += [tuple(reversed(range(count)))]
        put(mesh(name + '.gun-shield', points, faces, naval, col, True), elevation)

    # ---- glacis step ladder between the guns ------------------------------
    # Two stringers with rungs climbing the front slope on the centreline.
    steps = [(2.90, 1.44), (2.68, 1.72), (2.46, 1.85), (2.24, 2.02), (2.06, 2.14)]
    for lane in [.45, -.42]:
        for a, b in zip(steps, steps[1:]):
            put(rod(name + '.glacis-stringer', (a[0], lane, a[1]), (b[0], lane, b[1]), .035, painted, col, vertices=4))
    for x, z in steps:
        put(rod(name + '.glacis-rung', (x, -.42, z), (x, .45, z), .03, painted, col, vertices=4))
        put(box(name + '.glacis-tread', (x - .04, .015, z + .05), (.16, .95, .04), painted, col))

    # ---- roof fittings ----------------------------------------------------
    for sign in [1, -1]:
        put(box(name + '.roof-hatch', (-4.77, sign * 1.00, top_z(-4.77, sign * 1.00) + .02), (.65, 1.27, .05), painted, col))
        for x, ly in [(-2.20, 2.10), (0.10, 2.20), (-5.60, 1.30)]:
            put(box(name + '.roof-lug', (x, sign * ly, top_z(x, sign * ly) + .05), (.10, .12, .12), painted, col))
    # Single roof plate and the sighting hood the reference carries to starboard.
    put(box(name + '.roof-plate', (-0.42, -2.18, top_z(-0.42, -2.18) + .02), (.34, .46, .05), painted, col))
    put(box(name + '.sight-hood-base', (0.11, -2.00, 2.44), (.18, .21, .31), naval, col))
    put(box(name + '.sight-hood', (0.21, -1.99, 2.75), (.32, .14, .32), naval, col))
    put(box(name + '.sight-hood-window', (0.36, -1.99, 2.75), (.03, .09, .12), glass, col))

    # ---- rear plate and flanks --------------------------------------------
    for sign in [1, -1]:
        put(rod(name + '.rear-stile', (rear_x(sign * 1.79, 1.00) - .05, sign * 1.79, .60),
                (rear_x(sign * 1.79, 1.00) - .05, sign * 1.79, 1.36), .05, painted, col, vertices=6))
        put(box(name + '.rear-cleat', (rear_x(sign * 1.62, .88) - .02, sign * 1.62, .88), (.10, .06, .32), painted, col))
        for z in [.40, 1.22]:
            put(box(name + '.rear-step', (rear_x(sign * .80, z) + .05, sign * .80, z), (.14, .44, .18), painted, col))

        # Hand rail on brackets along each flank.
        rail = []
        for i in range(9):
            x = -5.40 + i * .72
            rail.append((x, sign * (side_y(x, 1.70) + .11), 1.70))
        for a, b in zip(rail, rail[1:]):
            put(rod(name + '.side-rail', a, b, .035, painted, col, vertices=6))
        for i in [0, 2, 4, 6, 8]:
            x, ry, z = rail[i]
            put(rod(name + '.side-rail-bracket', (x, sign * side_y(x, 1.70), z), (x, ry, z), .032, painted, col, vertices=4))

        # Vertical ladder on the after quarter.
        for lane in [-.11, .11]:
            oy = sign * (side_y(-5.15 + lane, 1.10) + .07)
            put(rod(name + '.ladder-rail', (-5.15 + lane, oy, .12), (-5.15 + lane, oy, 2.10), .03, painted, col, vertices=4))
        for i in range(7):
            z = .20 + i * .31
            oy = sign * (side_y(-5.15, 1.10) + .07)
            put(rod(name + '.ladder-rung', (-5.26, oy, z), (-5.04, oy, z), .024, painted, col, vertices=4))
        for z in [.34, 1.16, 1.96]:
            put(rod(name + '.ladder-standoff', (-5.15, sign * side_y(-5.15, z), z),
                    (-5.15, sign * (side_y(-5.15, 1.10) + .07), z), .026, painted, col, vertices=4))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

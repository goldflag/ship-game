"""Original 15 cm SK C/25 triple (Drh LC/25) as fitted in Nuernberg.

Visual proportions follow the approved GameModels3D pgsc106 AB artillery
(`ggm029_149mm60_drhtr_sk_c25`). No reference geometry is loaded here. That
visual carries the same armor shell as the Koenigsberg fit but a different
fitting-out: a raised triangular roof plate, a single shoulder guard rail per
run, outboard brackets on the face corners, rear quarter platforms and the
face ladder to starboard of the centre gun. Each part maps to exactly one
visual, so the two mounts are separate catalog entries and this file repeats
the shared construction rather than importing the other recipe. Authoring
frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole at Z = 0.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .205   # constant jacket radius carrying the canvas cuff through recoil
COLLAR = 3.20   # cuff station forward of the yaw datum, as on the reference bag
KNUCKLE = 1.95  # top of the vertical flank; the shoulder folds in above it
CHAMFER = .76   # shoulder inset per metre of rise, measured off the reference


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    naval, roof, edge, dark, painted = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge'])
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

    # The visible gunhouse is exactly the catalog's armor shell, so the raked
    # face, folded shoulders and rounded back plate stay aligned with their
    # protection.
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

    def flank_y(x):
        return max(h.y for h in cast((x, 20, KNUCKLE - .3), (0, -1, 0)))

    # Rotating sole. The ship owns the fixed barbette below it.
    put(cyl(name + '.turntable', (0, 0, .075), 2.895, .15, naval, col, 40))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM']/2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a tapering jacket, a constant section long
        # enough to carry the cuff through the whole stroke, then the chase.
        profile = [(0, .30), (1.55, .245), (2.15, SLEEVE), (2.85, SLEEVE), (3.91, .151), (3.93, .140), (length, .096)]
        count = 14
        points = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
                  for x, r in profile for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
               for x, r in [(length, .096), (length, bore), (length-.30, bore)] for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length-.32, 0, 0), (length-.30, 0, 0), bore, dark, col, vertices=count), recoil)

    for sign in [1, -1]:
        # Ventilator cowls standing on the shoulder plate between the two
        # guard-rail runs, hooded toward the rear as on the reference.
        x, y = -2.09, sign*2.53
        put(cyl(name + '.vent-cowl', (x, y, 2.62), .205, 1.00, naval, col, 12))
        put(cyl(name + '.vent-collar', (x, y, 2.23), .245, .12, painted, col, 12))
        hood = put(cyl(name + '.vent-hood', (x-.07, y, 3.22), .205, .24, painted, col, 12))
        hood.rotation_euler.y = math.radians(20)
        put(box(name + '.vent-cap', (x-.06, y, 3.19), (.18, .22, .20), painted, col))

        # One guard rail lying along the shoulder fold, in the forward and
        # quarter runs the reference shows either side of the cowls.
        for x0, x1, posts in [(-1.67, 1.35, 5), (-4.08, -2.39, 4)]:
            rise = .33
            a = (x0, sign*(flank_y(x0) - CHAMFER*rise + .05), KNUCKLE + rise + .04)
            b = (x1, sign*(flank_y(x1) - CHAMFER*rise + .05), KNUCKLE + rise + .04)
            put(rod(name + '.shoulder-rail', a, b, .028, painted, col, vertices=4))
            for i in range(posts):
                px = x0 + (x1 - x0)*i/(posts - 1)
                py = flank_y(px)
                put(rod(name + '.shoulder-rail-post',
                        (px, sign*(py - CHAMFER*.10), KNUCKLE + .10),
                        (px, sign*(py - CHAMFER*rise + .05), KNUCKLE + rise + .04), .020, painted, col, vertices=4))

        # Brackets standing outboard of the face corners, over the flank
        # knuckle, in place of the flat face panels of the Koenigsberg fit.
        put(box(name + '.face-bracket', (2.085, sign*2.925, 1.47), (.15, .65, .32), painted, col))

        # Rear quarter working platforms, welded to the rounded back plate
        # above the ammunition hatch, with a stay under each outboard corner.
        py = sign*1.525
        ax = min(h.x for h in cast((-20, py, 1.75), (1, 0, 0)))
        platform = put(box(name + '.rear-platform', (ax-.14, py, 1.75), (.50, 1.19, .05), painted, col))
        platform.rotation_euler.z = sign*math.atan2(.56, 1.6)
        put(rod(name + '.rear-platform-stay', (ax-.30, py, 1.72), (ax+.02, py, 1.30),
                .024, painted, col, vertices=4))

    # Rear centreline door on the back plate, between the quarter platforms.
    door = put(box(name + '.rear-door', (-4.90, 0, 1.835), (.14, .96, .21), painted, col))
    door.rotation_euler.z = 0

    # Raised triangular roof plate: a wide base on the forward roof knuckle
    # running aft to a point abaft the ridge, lying on the armor.
    # The reference base edge is 0.20 m further forward; it is pulled aft so
    # the guns clear the plate at full elevation.
    corners = [(1.15, 2.61), (1.15, -2.61), (-1.25, 0.)]
    deck = [(x, y, top_z(x, y) + .09) for x, y in corners]
    skirt = [(x, y, top_z(x, y) + .01) for x, y in corners]
    put(mesh(name + '.roof-plate', deck + skirt,
             [(0, 1, 2), (5, 4, 3)] + [(i, (i+1) % 3, (i+1) % 3 + 3, i + 3) for i in range(3)],
             roof, col))

    # Face ladder between the centre and starboard guns, hooked over the
    # roof edge, one rung higher than the Koenigsberg fit.
    for dy in [-1.00, -.76]:
        put(rod(name + '.face-ladder-rail', (front_x(dy, .30)+.035, dy, .30),
                (front_x(dy, 2.22)+.035, dy, 2.22), .023, painted, col, vertices=4))
    put(rod(name + '.face-ladder-hook', (front_x(-.88, 2.22)+.035, -1.00, 2.22),
            (front_x(-.88, 2.22)+.035, -.76, 2.22), .023, painted, col, vertices=4))
    for i in range(8):
        z = .45 + .25*i
        put(rod(name + '.face-ladder-rung', (front_x(-.88, z)+.055, -1.06, z),
                (front_x(-.88, z)+.055, -.70, z), .020, painted, col, vertices=4))
    # Small lifting brackets on the face between the guns.
    for by in [1.15, .40, -.40]:
        put(box(name + '.face-lug', (front_x(by, 2.055)+.035, by, 2.055), (.11, .08, .13), painted, col))

    # Canvas gun-port bags. The fixed seam is cast onto the real raked face;
    # the cuff rides the constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i*math.tau/20
            yy = y + .30*math.copysign(abs(math.cos(a))**.6, math.cos(a))
            zz = 1.675 + .585*math.copysign(abs(math.sin(a))**.6, math.sin(a))
            seam.append((front_x(yy, zz)+.015, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               COLLAR, SLEEVE+.045, rings=5, slack=.12, fullness=.07)
        # A linear cloth loft cuts into the raked face at depression and can
        # cross the jacket at high elevation. Drape the intermediate rings over
        # the armor and keep them outside the sliding sleeve, without moving
        # the fixed seam or the pitching cuff.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < 20 or index >= 80:
                    continue
                plate = cast((20, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate)+.03)
                delta = (point.co.x-spec['trunnionForward'], point.co.y-y, point.co.z-spec['pivotHeight'])
                along = sum(delta[i]*axis[i] for i in range(3))
                radial = [delta[i]-along*axis[i] for i in range(3)]
                distance = math.sqrt(sum(v*v for v in radial))
                if 0 < distance < SLEEVE+.055:
                    for i in range(3):
                        point.co[i] += radial[i]*((SLEEVE+.055)/distance-1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

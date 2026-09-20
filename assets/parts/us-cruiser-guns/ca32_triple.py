"""Original 8-inch/55 triple turret of the New Orleans class (CA-32 pattern).

Visual proportions follow the approved GameModels3D pasc107 (New Orleans) AB1
artillery, `agm006_8in55_ca32`: a round-faced turret with the transverse
rangefinder hoods carried out on the after quarters. No reference geometry is
loaded here. The catalog owns the closed armor shell and the weapon data; this
recipe draws that shell and adds the flank ladders, sight hoods, rangefinder
ears, roof hatches, the face steps and three sliding barrels with canvas seals.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .375   # sliding jacket radius through the canvas cuff
COLLAR = 2.02   # cuff station forward of the trunnion
LADDER = [(3.29, .30), (2.89, 2.35)]   # flank ladder, (y, z) at foot and head


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

    # The visible gunhouse is exactly the catalog's armor shell, so the round
    # raked face and the tumblehome flanks stay aligned with their protection.
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
        return max(h.x for h in hits) if hits else 1.83

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else 2.60

    def side_y(x, z, sign):
        hits = cast((x, sign * 20, z), (0, -sign, 0))
        return sign * max(h.y * sign for h in hits) if hits else sign * 3.0

    def fin(label, profile, x0, x1, material):
        """Thin plate standing in the y-z plane, extruded between two x stations."""
        k = len(profile)
        points = [(x, y, z) for x in [x0, x1] for y, z in profile]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
        return put(mesh(name + '.' + label, points, faces, material, col))

    # Rung ladder up each flank, its stringers welded to the sloping plate.
    for sign in [1, -1]:
        (fy, fz), (hy, hz) = LADDER
        for x in [-.705, -.325]:
            inner = [(sign * (side_y(x, fz, sign) * sign - .10), fz), (sign * fy, fz),
                     (sign * hy, hz), (sign * (side_y(x, hz, sign) * sign - .10), hz)]
            fin('ladder-stringer', inner, x - .025, x + .025, painted)
        for i in range(8):
            t = i / 7
            y, z = sign * (fy + (hy - fy) * t), fz + (hz - fz) * t
            put(rod(name + '.ladder-rung', (-.70, y, z), (-.33, y, z), .022, painted, col, vertices=4))

        # Trainer and pointer hood on the forward shoulder.
        hood_y = side_y(.26, 2.215, sign)
        put(box(name + '.sight-hood', (.26, hood_y + sign * .12, 2.215), (.64, .47, .37), naval, col))
        put(box(name + '.sight-hood-bezel', (.55, hood_y + sign * .12, 2.215), (.06, .30, .24), edge, col))
        put(box(name + '.sight-hood-lens', (.59, hood_y + sign * .12, 2.215), (.02, .22, .17), glass, col))

        # Rangefinder hood on the after quarter: a collar through the flank
        # plate and the armored end box that carries the window.
        put(box(name + '.rangefinder-collar', (-5.315, sign * 2.69, 2.31), (1.61, .46, .92), naval, col))
        ear = put(box(name + '.rangefinder-hood', (-5.31, sign * 3.485, 2.25), (1.40, 1.61, .84), naval, col))
        ear.rotation_euler.z = -sign * math.radians(4)
        put(box(name + '.rangefinder-window', (-4.62, sign * 3.90, 2.30), (.05, .74, .34), glass, col))
        put(box(name + '.rangefinder-cap', (-6.00, sign * 3.90, 2.25), (.06, .80, .60), painted, col))
        # Vane post on the after roof beside the hood.
        put(rod(name + '.roof-post', (-4.43, sign * 2.035, top_z(-4.43, sign * 2.035) - .02),
                (-4.43, sign * 2.035, 3.12), .045, painted, col, vertices=6))

    # Two raised roof hatches, each stiffened by a pair of longitudinal ribs.
    for cx in [-2.96, -1.07]:
        z = top_z(cx, 0)
        put(box(name + '.roof-hatch', (cx, 0, z + .13), (1.58, 2.96, .29), roof, col))
        for sign in [1, -1]:
            put(box(name + '.roof-hatch-rib', (cx + .05, sign * .585, z + .21), (1.69, .09, .35), painted, col))

    # Rotating sole under the house skirt; the ship owns the barbette below it.
    put(cyl(name + '.turntable', (0, 0, .025), spec['barbetteRadius'], .05, naval, col, 40))

    # Boarding steps under the centre port.
    for sign in [1, -1]:
        for z in [.155, .450]:
            put(box(name + '.face-step', (front_x(sign * .575, z) + .06, sign * .575, z), (.13, .33, .09), painted, col))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough for the cuff
        # through full recoil, a shoulder, then the tapering chase.
        profile = [(.20, SLEEVE), (2.22, SLEEVE), (3.47, .341), (4.40, .300),
                   (4.55, .272), (6.47, .253), (length, .221)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .221), (length, bore), (length - .40, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .40, 0, 0), bore, dark, col, vertices=count), recoil)

    # Pleated canvas seals, seam cast onto the round raked face.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .46 * math.copysign(abs(math.cos(a)) ** .80, math.cos(a))
            zz = 1.45 + .85 * math.copysign(abs(math.sin(a)) ** .70, math.sin(a))
            seam.append((front_x(yy, zz) + .012, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .015, rings=5, slack=.08, fullness=.07)
        # A linear cloth loft cuts through the raked face at depression and can
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
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .03)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < SLEEVE + .035:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .035) / distance - 1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

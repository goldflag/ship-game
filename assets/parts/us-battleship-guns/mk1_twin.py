"""Original 406 mm/45 Mk.1 twin turret, the Colorado-class main mount.

Visual proportions follow the approved GameModels3D pasb008 A artillery
(`agm156_16in45_mk1`), which is a low-detail visual: a faceted house with a roof
that rises aft, two rangefinder arms over the after shoulders, a roof sighting
post and footboards at the sole. No reference geometry is loaded here, and no
fittings are invented beyond what that visual shows. The catalog owns the closed
armor shell and the weapon data; this recipe draws that shell and adds the
roller path, those fittings, the sliding barrels and the canvas gun-port covers.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .52      # sliding jacket radius through the canvas cuff
COLLAR = 2.72     # cuff station forward of the trunnion


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

    # The visible gunhouse is exactly the catalog's armor shell, so the raked
    # face and the roof that rises aft stay on their protection.
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
        return max(h.x for h in cast((30, y, z), (-1, 0, 0)))

    def top_z(x, y):
        return max(h.z for h in cast((x, y, 30), (0, 0, -1)))

    # Plane pairs of the right-handed frame, so an extruded outline can be
    # wound outward whichever flank it is mirrored onto.
    PLANE = {'x': lambda u, v, w: (w, u, v), 'y': lambda u, v, w: (v, w, u), 'z': lambda u, v, w: (u, v, w)}

    def solid(label, outline, axis, a, b, material, outline_b=None):
        """Closed prism or frustum: `outline` lies in the plane normal to `axis`, swept from a to b."""
        rings = [[tuple(p) for p in outline], [tuple(p) for p in (outline_b or outline)]]
        k = len(rings[0])
        area = sum(rings[0][i][0] * rings[0][(i + 1) % k][1] - rings[0][(i + 1) % k][0] * rings[0][i][1] for i in range(k))
        if a > b:
            a, b = b, a
            rings.reverse()
        if area < 0:
            rings = [list(reversed(r)) for r in rings]
        place = PLANE[axis]
        points = [place(u, v, w) for w, ring in zip((a, b), rings) for u, v in ring]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return put(mesh(name + label, points, faces, material, col))

    # Rotating roller path. The ship owns the fixed barbette below the sole.
    put(cyl(name + '.roller-path', (0, 0, .045), spec['barbetteRadius'], .09, edge, col, 32))

    # ---- guns -----------------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One closed surface per gun: the constant jacket that carries the cuff
        # through full recoil, the stepped chase, the muzzle swell and the bore
        # turned back inside the muzzle face.
        profile = [(-.10, SLEEVE), (5.80, SLEEVE), (5.86, .44), (12.28, .307), (12.44, .352),
                   (length, .352), (length, bore), (length - .50, bore)]
        count, strips = 12, len(profile) - 1
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(strips) for i in range(count)]
        points += [(profile[-1][0], 0, 0), (profile[0][0], 0, 0)]
        base = strips * count
        faces += [(base + i, base + (i + 1) % count, len(points) - 2) for i in range(count)]
        faces += [(i, len(points) - 1, (i + 1) % count) for i in range(count)]
        tube = put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        tube.data.materials.append(dark)
        for polygon in tube.data.polygons:
            if polygon.index >= (strips - 1) * count:
                polygon.material_index = 1      # the rifled bore behind the muzzle face
        for polygon in tube.data.polygons[strips * count:]:
            polygon.use_smooth = False

    # ---- fittings the approved visual shows ------------------------------
    for sign in [1, -1]:
        # Rangefinder arm lying across the after shoulder and out over the
        # flank, with the raised optical block on its outboard end.
        arm = [(1.98, -6.58), (2.52, -6.58), (2.52, -5.31), (1.98, -5.31)]
        solid('.rangefinder-arm', arm, 'y', sign * 2.83, sign * 5.61, naval)
        block = [(1.95, -6.52), (2.79, -6.52), (2.79, -5.37), (1.95, -5.37)]
        solid('.rangefinder-block', block, 'y', sign * 4.92, sign * 5.61, naval)
        put(box(name + '.rangefinder-window', (-5.95, sign * 5.62, 2.40), (.70, .05, .34), glass, col))

        # Footboards on the turntable sole, their outboard edge following the
        # shell's floor line, with the step cleats standing astride it as the
        # approved visual carries them.
        hem = lambda x: 5.28 - (x + .89) * 2.0 / 5.43       # floor edge of the shell in plan
        solid('.footboard', [(-0.19, sign * (hem(-0.19) - .55)), (3.47, sign * (hem(3.47) - .55)),
                             (3.47, sign * hem(3.47)), (-0.19, sign * hem(-0.19))], 'z', 0, .06, edge)
        for x in [.78, 1.64, 2.43]:
            seat = hem(x)
            solid('.footboard-cleat', [(x - .10, sign * (seat - .21)), (x + .10, sign * (seat - .21)),
                                       (x + .10, sign * (seat + .21)), (x - .10, sign * (seat + .21))],
                  'z', .06, .22, painted)
    solid('.footboard', [(4.65, -1.78), (5.01, -1.78), (5.01, 1.78), (4.65, 1.78)], 'z', 0, .06, edge)

    # Sighting post on the roof centreline, standing on the roof plate.
    put(box(name + '.roof-post', (1.07, 0, (top_z(1.07, 0) + 3.06) / 2),
            (.17, .14, 3.06 - top_z(1.07, 0)), painted, col))

    # ---- canvas gun-port covers -----------------------------------------
    # The fixed seam is cast onto the real raked face; the cuff rides the
    # constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .63 * math.copysign(abs(math.cos(a)) ** .80, math.cos(a))
            rise = .74 if math.sin(a) > 0 else .68
            zz = spec['pivotHeight'] + rise * math.copysign(abs(math.sin(a)) ** .75, math.sin(a))
            seam.append((front_x(yy, zz) + .03, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, .055 + SLEEVE, rings=5, slack=.12, fullness=.07)
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
                plate = cast((30, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .04)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < SLEEVE + .03:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .03) / distance - 1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

"""Original 330 mm/52 Model 1931 quadruple, the Dunkerque main turret.

Visual proportions follow the approved GameModels3D pfsb506 main artillery
(`fgm001_330_52_mle_1931`). No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the turntable, the rear-quarter rangefinder pods, the sighting
fittings, the gun-port frame, the sliding barrels and the canvas covers.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

BACK = 3.75       # rear station of the gun-port frame, buried in the face
FRAME = 4.80      # front rim of the gun-port frame the canvas is sealed to
SLEEVE = .42      # sliding jacket radius through the canvas cuff
COLLAR = 2.45     # cuff station forward of the trunnion


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

    def sweep(label, sections, material, smooth=False):
        """Closed hull through equal-length rings of points; winding fixed from the signed volume."""
        k = len(sections[0])
        points = [tuple(p) for ring in sections for p in ring]
        faces = [tuple(reversed(range(k))), tuple(range((len(sections) - 1) * k, len(sections) * k))]
        faces += [(j * k + i, j * k + (i + 1) % k, (j + 1) * k + (i + 1) % k, (j + 1) * k + i)
                  for j in range(len(sections) - 1) for i in range(k)]
        volume = 0.
        for face in faces:
            a = Vector(points[face[0]])
            for b, c in zip(face[1:-1], face[2:]):
                b, c = Vector(points[b]), Vector(points[c])
                volume += a.dot(b.cross(c)) / 6
        if volume < 0:
            faces = [tuple(reversed(f)) for f in faces]
        return put(mesh(name + '.' + label, points, faces, material, col, smooth))

    # The visible gunhouse is exactly the catalog's armor shell, so the raked
    # face, the knuckle and the sloping roof stay aligned with their protection.
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

    def top_z(x, y):
        return max(h.z for h in cast((x, y, 20), (0, 0, -1)))

    def side_y(x, z):
        return max(h.y for h in cast((x, 20, z), (0, -1, 0)))

    # Rotating sole. The ship owns the fixed barbette below it; the shell floor
    # lands on its top face.
    put(cyl(name + '.turntable', (0, 0, .03), spec.get('rollerRadius', 5.10), .06, naval, col, 48))

    for sign in [1, -1]:
        # Rear-quarter rangefinder pod, its inboard end buried in the armor.
        half = spec.get('rangefinderWidth', 12.56) / 2
        mid = spec.get('rangefinderForward', -6.20)
        root, axis = 3.60, 2.395

        def pod(outer, low, high, corner):
            return [(root, low), (outer - corner, low), (outer - .3 * corner, low + .3 * corner), (outer, low + corner),
                    (outer, high - corner), (outer - .3 * corner, high - .3 * corner), (outer - corner, high), (root, high)]
        stations = [(mid - 1.29, pod(half - .20, 2.17, 2.64, .22)), (mid - 1.00, pod(half, 1.90, 2.94, .40)),
                    (mid - 0.70, pod(half, 1.78, 3.01, .05)), (mid + 1.00, pod(half, 1.78, 3.01, .05)),
                    (mid + 1.18, pod(half, 1.86, 2.94, .40)), (mid + 1.29, pod(half - .20, 2.02, 2.80, .22))]
        sweep('rangefinder-pod', [[(x, sign * y, z) for y, z in profile] for x, profile in stations], naval)
        put(box(name + '.rangefinder-panel', (mid + .03, sign * (half - .04), axis), (1.19, .14, 1.06), dark, col))
        put(box(name + '.rangefinder-window', (mid + .03, sign * (half + .02), axis + .10), (.92, .10, .34), glass, col))
        put(box(name + '.pod-end-plate', (mid + 1.28, sign * (half - .95), axis), (.19, .53, 1.08), naval, col))
        for x in [mid - .85, mid + .90]:
            put(rod(name + '.pod-rail-post', (x, sign * (half - .06), 2.94), (x, sign * (half - .06), 3.08),
                    .018, painted, col, vertices=4))
        put(rod(name + '.pod-grab-rail', (mid - .85, sign * (half - .06), 3.08), (mid + .90, sign * (half - .06), 3.08),
                .020, painted, col, vertices=4))

        # Trainer's armored sight scuttle, half sunk into the flank plate.
        x, z = 3.00, 1.16
        flank = side_y(x, z)
        put(box(name + '.sight-scuttle', (x, sign * (flank + .06), z), (.86, .42, .80), naval, col))
        put(box(name + '.sight-aperture', (x, sign * (flank + .27), z), (.34, .06, .30), glass, col))

        # Grab rails welded along the shoulder chine on short stanchions.
        for a, b in [((-4.30, 4.30), (-3.10, 4.42)), ((-1.20, 4.56), (0.20, 4.52))]:
            points = []
            for x, y in [a, b]:
                surface = top_z(x, sign * y)
                points.append((x, sign * y, surface + .09))
                put(rod(name + '.shoulder-post', (x, sign * y, surface - .02), (x, sign * y, surface + .09),
                        .018, painted, col, vertices=4))
            put(rod(name + '.shoulder-rail', points[0], points[1], .020, painted, col, vertices=4))

    # Captain's sighting hood on the forward roof and, on the starboard shoulder
    # only, the trainer's periscope cluster the reference carries there.
    seat = top_z(3.16, 0)
    put(box(name + '.sight-hood', (3.16, 0, seat + .21), (.86, 1.00, .53), naval, col))
    put(cyl(name + '.periscope', (3.22, 0, seat + .56), .09, .20, painted, col, 12))
    base = top_z(1.67, -4.36)
    put(box(name + '.trainer-seat', (1.67, -4.36, base + .10), (.90, .82, .48), naval, col))
    put(box(name + '.trainer-hood', (1.66, -4.36, base + .42), (.60, .60, .85), naval, col))
    put(box(name + '.trainer-scope', (1.92, -4.36, base + .64), (.16, .34, .37), painted, col))
    put(box(name + '.trainer-window', (1.99, -4.36, base + .64), (.05, .18, .22), glass, col))

    # Gun-port frame: three partitions between the four ports carrying the
    # access rungs, a lintel rising forward off the roof knuckle and a sill on
    # the floor. Its front rim at FRAME carries the canvas.
    spacing = spec['barrelSpacing']
    for y, width in [(0., .70), (spacing, .70), (-spacing, .70)]:
        rib = [(BACK, .34), (FRAME, .36), (FRAME, 2.50), (BACK, 2.06)]
        sweep('face-rib', [[(x, y - width / 2, z) for x, z in rib], [(x, y + width / 2, z) for x, z in rib]], naval)
        for i in range(6):
            z = .62 + i * .30
            put(rod(name + '.face-rung', (FRAME + .01, y - width / 2 + .07, z), (FRAME + .01, y + width / 2 - .07, z),
                    .024, painted, col, vertices=4))
    for label, beam in [('port-lintel', [(BACK, 2.04), (FRAME, 2.54), (FRAME, 2.88), (BACK, 2.56)]),
                        ('port-sill', [(BACK, .06), (FRAME, .06), (FRAME, .38), (BACK, .38)])]:
        sweep(label, [[(x, -3.72, z) for x, z in beam], [(x, 3.72, z) for x, z in beam]], naval)

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough for the cuff
        # through full recoil, then the long tapering chase of this gun.
        profile = [(.50, SLEEVE), (3.60, SLEEVE), (3.70, .401), (length, .258)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length - .14, .2613), (length - .08, .272), (length, .272), (length, bore), (length - .44, bore)]
               for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(4) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .46, 0, 0), (length - .44, 0, 0), bore, dark, col, vertices=count), recoil)

    # Pleated canvas gun-port covers, sealed on the front rim of the port frame
    # and riding the constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .66 * math.copysign(abs(math.cos(a)) ** .75, math.cos(a))
            zz = 1.44 + 1.10 * math.copysign(abs(math.sin(a)) ** .65, math.sin(a))
            seam.append((FRAME - .08, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .02, rings=5, slack=.16, fullness=.12)
        # A linear cloth loft cuts into the face at depression and can cross the
        # jacket at high elevation. Drape the intermediate rings over the armor
        # and keep them outside the sliding sleeve, without moving the fixed
        # seam or the pitching cuff.
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
                if 0 < distance < SLEEVE + .04:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .04) / distance - 1)
                point.co.z = max(point.co.z, .04)   # nothing hangs below the sole plane

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

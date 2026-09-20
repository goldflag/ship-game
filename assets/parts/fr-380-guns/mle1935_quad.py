"""Original 380 mm/45 Model 1935 quadruple, the Richelieu main turret.

Visual proportions follow the approved GameModels3D pfsb108 main artillery
(`fgm049_380mm_45_mle_1935`). No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the rotating sole flange, the flank walkways and their guard rails,
the rear-quarter rangefinder pods, the sighting fittings, the face ribs, the
sliding barrels and the canvas gun-port covers.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole flange.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SOLE = .21        # top of the rotating flange the gunhouse stands on
FRAME = 5.16      # front rim of the gun-port frame the canvas is sealed to
SLEEVE = .41      # sliding jacket radius through the canvas cuff
COLLAR = 4.11     # cuff station forward of the trunnion


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

    def sweep(label, sections, material, caps=True, smooth=False):
        """Closed hull through equal-length rings of points; winding fixed from the signed volume."""
        k = len(sections[0])
        points = [tuple(p) for ring in sections for p in ring]
        faces = [(j * k + i, j * k + (i + 1) % k, (j + 1) * k + (i + 1) % k, (j + 1) * k + i)
                 for j in range(len(sections) - 1) for i in range(k)]
        if caps:
            faces = [tuple(reversed(range(k))), tuple(range((len(sections) - 1) * k, len(sections) * k))] + faces
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
    # face, the shoulder chine and the sloping roof stay aligned with their
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

    def side_y(x, z):
        return max(h.y for h in cast((x, 20, z), (0, -1, 0)))

    # Rotating sole flange: a roller-path ring forward of the rear chamfer, cut
    # off along the two rear quarter lines of the shell. The ship owns the fixed
    # barbette below it; the shell floor lands on its top face.
    ring = spec.get('rollerRadius', 7.13)
    tail = -3.51
    limit = math.acos(max(-1., tail / ring))
    arc = [(ring * math.cos(a), ring * math.sin(a))
           for a in [-limit + 2 * limit * i / 26 for i in range(27)]]
    plan = [(-9.03, 0.), (-8.55, -5.05)] + arc + [(-8.55, 5.05)]
    sweep('sole-flange', [[(x, y, 0.) for x, y in plan], [(x, y, SOLE) for x, y in plan]], naval)

    for sign in [1, -1]:
        # Flank walkway carried on the flange rim, with its two-rail guard.
        walk = [(-2.59, 6.63), (-2.71, 7.08), (-0.79, 7.55), (0.95, 7.55), (0.95, 7.04)]
        walk = walk + [(x, math.sqrt(max(0., ring ** 2 - x * x)))
                       for x in [0.4, -0.4, -1.2, -2.0]]
        outline = [(x, sign * y) for x, y in walk]
        sweep('walkway', [[(x, y, SOLE - .08) for x, y in outline], [(x, y, SOLE) for x, y in outline]], naval)
        posts = [(-2.52, 7.18), (-1.30, 7.48), (-0.10, 7.50), (0.88, 7.50)]
        for x, y in posts:
            put(rod(name + '.rail-stanchion', (x, sign * y, SOLE), (x, sign * y, SOLE + 1.04),
                    .028, painted, col, vertices=4))
        for z in [SOLE + .45, SOLE + .98]:
            for (xa, ya), (xb, yb) in zip(posts, posts[1:]):
                put(rod(name + '.guard-rail', (xa, sign * ya, z), (xb, sign * yb, z), .024, painted, col, vertices=4))

        # Rear-quarter rangefinder pod: a rounded housing hung on the shell
        # flank, its inboard end buried in the armor that carries it.
        half = spec.get('rangefinderWidth', 14.82) / 2
        mid = spec.get('rangefinderForward', -7.05)
        root, axis = 4.90, 2.85

        def pod(outer, low, high, corner):
            return [(root, low), (outer - corner, low), (outer - .3 * corner, low + .3 * corner), (outer, low + corner),
                    (outer, high - corner), (outer - .3 * corner, high - .3 * corner), (outer - corner, high), (root, high)]
        stations = [(mid - 1.39, pod(half - .25, 2.42, 3.28, .30)), (mid - 1.06, pod(half, 2.24, 3.46, .50)),
                    (mid - 0.75, pod(half, 2.24, 3.46, .05)), (mid + 1.05, pod(half, 2.24, 3.46, .05)),
                    (mid + 1.25, pod(half, 2.24, 3.46, .50)), (mid + 1.40, pod(half - .25, 2.42, 3.28, .30))]
        sweep('rangefinder-pod', [[(x, sign * y, z) for y, z in profile] for x, profile in stations], naval)
        # Recessed optical panel with the two window housings of the reference.
        put(box(name + '.rangefinder-panel', (mid + .15, sign * (half - .04), axis), (1.86, .14, .70), dark, col))
        for z in [axis - .09, axis + .19]:
            put(box(name + '.rangefinder-window', (mid + .15, sign * (half + .02), z), (1.42, .10, .19), glass, col))
        for x in [mid - .95, mid + 1.00]:
            put(rod(name + '.pod-rail-post', (x, sign * (half - .06), 3.40), (x, sign * (half - .06), 3.52),
                    .020, painted, col, vertices=4))
        put(rod(name + '.pod-grab-rail', (mid - .95, sign * (half - .06), 3.52), (mid + 1.00, sign * (half - .06), 3.52),
                .022, painted, col, vertices=4))

        # Trainer's armored sight scuttle, half sunk into the flank plate.
        x, z = 3.10, 1.29
        flank = side_y(x, z)
        put(box(name + '.sight-scuttle', (x, sign * (flank + .04), z), (.71, .30, .68), naval, col))
        put(box(name + '.sight-aperture', (x, sign * (flank + .20), z), (.30, .06, .26), glass, col))

        # Grab rails welded along the shoulder chine on short stanchions.
        for label, a, b in [('aft', (-6.60, 5.20), (-5.30, 5.35)), ('mid', (-3.00, 5.60), (-1.60, 5.70))]:
            points = []
            for x, y in [a, b]:
                surface = top_z(x, sign * y)
                points.append((x, sign * y, surface + .09))
                put(rod(name + '.shoulder-post', (x, sign * y, surface - .02), (x, sign * y, surface + .09),
                        .018, painted, col, vertices=4))
            put(rod(name + '.shoulder-rail', points[0], points[1], .020, painted, col, vertices=4))

    # Captain's sighting hood on the forward roof, with its periscope cap.
    seat = top_z(3.23, 0)
    put(box(name + '.sight-hood', (3.23, 0, seat + .12), (1.00, .92, .48), naval, col))
    put(cyl(name + '.periscope', (3.30, 0, seat + .40), .09, .20, painted, col, 12))
    put(box(name + '.roof-hatch', (-0.60, 0, top_z(-0.60, 0) + .03), (1.05, .88, .10), naval, col))
    put(rod(name + '.roof-hatch-handle', (-0.95, 0, top_z(-0.60, 0) + .09), (-0.25, 0, top_z(-0.60, 0) + .09),
            .022, painted, col, vertices=4))

    # Gun-port frame: three partitions between the ports carrying the access
    # rungs, closed by a lintel that stands above the roof knuckle and a sill
    # lying on the sole flange, as the reference hood roots do. Its front rim
    # at FRAME carries the canvas.
    spacing = spec['barrelSpacing']
    for y, width in [(0., .68), (spacing, .62), (-spacing, .62)]:
        rib = [(4.52, .40), (FRAME, .36), (FRAME, 2.90), (4.52, 2.50)]
        sweep('face-rib', [[(x, y - width / 2, z) for x, z in rib], [(x, y + width / 2, z) for x, z in rib]], naval)
        for i in range(7):
            z = .62 + i * .33
            put(rod(name + '.face-rung', (FRAME + .01, y - width / 2 + .07, z), (FRAME + .01, y + width / 2 - .07, z),
                    .026, painted, col, vertices=4))
    # The lintel rises forward, the way the reference hood roots sweep up off the
    # roof knuckle, and its underside clears the bores at full elevation.
    for label, beam in [('port-lintel', [(4.52, 2.45), (FRAME, 2.88), (FRAME, 3.34), (4.52, 2.95)]),
                        ('port-sill', [(4.52, .20), (FRAME, .20), (FRAME, .49), (4.52, .55)])]:
        sweep(label, [[(x, -4.36, z) for x, z in beam], [(x, 4.36, z) for x, z in beam]], naval)

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough for the cuff
        # through full recoil, a shoulder, then the tapering chase.
        profile = [(.60, SLEEVE), (5.60, SLEEVE), (5.66, .385), (length, .334)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length - .14, .3355), (length - .08, .348), (length, .348), (length, bore), (length - .52, bore)]
               for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(4) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .54, 0, 0), (length - .52, 0, 0), bore, dark, col, vertices=count), recoil)

    # Pleated canvas gun-port covers, sealed on the front rim of the port frame
    # and riding the constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .84 * math.copysign(abs(math.cos(a)) ** .75, math.cos(a))
            zz = 1.66 + 1.20 * math.copysign(abs(math.sin(a)) ** .65, math.sin(a))
            seam.append((FRAME - .08, yy, zz))   # bedded inside the frame rim, so no port slit opens
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .02, rings=5, slack=.26, fullness=.16)
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

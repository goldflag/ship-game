"""Original 28 cm SK C/34 triple (Drh LC/34), the Scharnhorst main turret.

Visual proportions follow the approved GameModels3D pgsb507 A artillery
(`ggm058_280mm54_5_c34`). No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the turntable, sliding barrels, canvas seals and service fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .36  # sliding jacket radius through the canvas cuff
COLLAR = 3.16  # cuff station forward of the trunnion


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

    # The visible gunhouse is exactly the catalog's armor shell, so the roof,
    # shoulders and rounded rear stay aligned with their protection.
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

    # Rotating sole and the raised working platform that carries the side
    # stowage. The platform stops under the gunhouse flank; the ship owns the
    # fixed barbette below the sole.
    put(cyl(name + '.turntable', (0, 0, .085), 5.53, .17, naval, col, 48))
    sweep = math.acos(-2.44/5.40)
    arc = [(5.40*math.cos(a), 5.40*math.sin(a)) for a in
           [-sweep + 2*sweep*i/30 for i in range(31)]]
    k = len(arc)
    put(mesh(name + '.working-platform',
             [(x, y, z) for z in [.16, .37] for x, y in arc],
             [tuple(range(k, 2*k))] + [(i, (i+1) % k, (i+1) % k+k, i+k) for i in range(k)],
             naval, col))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM']/2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough for the cuff
        # through full recoil, a shoulder, then the tapering chase.
        profile = [(.55, SLEEVE), (5.55, SLEEVE), (5.58, .30), (length, .222)]
        count = 16
        points = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
                  for x, r in profile for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
               for x, r in [(length, .222), (length, bore), (length-.45, bore)] for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length-.47, 0, 0), (length-.45, 0, 0), bore, dark, col, vertices=count), recoil)

    # Gunlayers' sight ports sit between the guns. Both apertures open toward
    # starboard of their armored frame, as on the approved model.
    lean = -math.atan2(.51, 1.62)
    for sign in [1, -1]:
        y = sign*1.24
        # Each piece is seated on the plate at its own height: the face rakes
        # aft, so one shared station would leave the brow standing off it.
        for label, proud, across, z, size, material in [
                ('sight-frame', .035, 0, 1.59, (.09, 1.00, .58), naval),
                ('sight-aperture', .085, -.23, 1.59, (.02, .44, .38), dark),
                ('sight-brow', .08, 0, 1.76, (.20, 1.06, .08), naval),
                ('sight-sill', .08, 0, 1.29, (.20, 1.06, .08), naval)]:
            o = put(box(name + '.' + label, (front_x(y, z)+proud, y+across, z), size, material, col))
            o.rotation_euler.y = lean

    for sign in [1, -1]:
        # Tapered periscope hood rooted in the shoulder plate, with its flange
        # lying on the slope and a forward optical window in the cap.
        x, y = -.27, sign*4.15
        seat = top_z(x, y)
        flange = put(cyl(name + '.sight-hood-flange', (x, y, seat+.01), .56, .06, naval, col, 16))
        flange.rotation_euler.x = -sign*math.atan2(1.61, 1.72)
        put(cyl(name + '.sight-hood', (x, y, 2.535), .43, .83, naval, col, 16, .27))
        put(cyl(name + '.sight-hood-cap', (x, y, 3.115), .29, .33, naval, col, 16))
        put(box(name + '.sight-hood-window', (x+.285, y, 3.12), (.03, .24, .14), glass, col))

        # Access ladder: up the flank, over the knuckle and along the shoulder
        # to a short hook on the roof. Rails stand 5 cm off the plate.
        knee, crown = (4.86, 1.91), (3.14, 3.52)
        run = math.hypot(knee[0]-crown[0], crown[1]-knee[1])
        normal = ((crown[1]-knee[1])/run, (knee[0]-crown[0])/run)
        off = .05
        path = [(knee[0]+off, .45), (knee[0]+off, knee[1]+off*.4),
                (crown[0]+normal[0]*off, crown[1]+normal[1]*off), (2.92, crown[1]+off)]
        for x in [-2.64, -2.23]:
            for (ya, za), (yb, zb) in zip(path, path[1:]):
                put(rod(name + '.ladder-rail', (x, sign*ya, za), (x, sign*yb, zb), .028, painted, col, vertices=4))
            # Standoffs weld each rail to the flank and the shoulder plate.
            for z in [.58, 1.70]:
                put(rod(name + '.ladder-standoff', (x, sign*(knee[0]-.01), z), (x, sign*(knee[0]+off), z), .022, painted, col, vertices=4))
            for t in [.30, .92]:
                py, pz = knee[0]+(crown[0]-knee[0])*t, knee[1]+(crown[1]-knee[1])*t
                put(rod(name + '.ladder-standoff', (x, sign*(py-normal[0]*.01), pz-normal[1]*.01),
                        (x, sign*(py+normal[0]*off), pz+normal[1]*off), .022, painted, col, vertices=4))
        rungs = [(path[0][0], .56+.28*i) for i in range(5)]
        for i in range(9):
            t = (.10+i*.265)/run
            rungs.append((knee[0]+(crown[0]-knee[0])*t+normal[0]*off, knee[1]+(crown[1]-knee[1])*t+normal[1]*off))
        for yy, zz in rungs:
            put(rod(name + '.ladder-rung', (-2.64, sign*yy, zz), (-2.23, sign*yy, zz), .02, painted, col, vertices=4))

        # Grab rails welded along the shoulder on short stanchions.
        for label, a, b in [('aft', (-6.78, 4.57), (-5.75, 4.57)), ('mid', (-2.05, 4.57), (-.85, 4.57)),
                            ('forward', (.40, 4.41), (3.10, 3.83))]:
            posts = 2 if label != 'forward' else 4
            points = []
            for i in range(posts):
                t = i/(posts-1)
                px, py = a[0]+(b[0]-a[0])*t, sign*(a[1]+(b[1]-a[1])*t)
                surface = top_z(px, py)
                points.append((px, py, surface+.075))
                put(rod(name + '.grab-rail-post', (px, py, surface-.01), (px, py, surface+.075), .016, painted, col, vertices=4))
            for p, q in zip(points, points[1:]):
                put(rod(name + '.grab-rail', p, q, .018, painted, col, vertices=4))

        # Long stowage tube carried on four saddles beside the forward flank,
        # parallel to the tapering cheek plate.
        a, b = (-1.05, sign*5.10, .70), (2.45, sign*4.585, .70)
        put(rod(name + '.stowage-tube', a, b, .19, naval, col, vertices=12))
        for cap in [a, b]:
            axis = (Vector(b)-Vector(a)).normalized()*(.03 if cap == b else -.03)
            put(rod(name + '.stowage-tube-cap', cap, tuple(Vector(cap)+axis), .205, painted, col, vertices=12))
        for i in range(4):
            t = (.08+i*.28)
            px, py = a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t
            saddle = put(box(name + '.stowage-saddle', (px, py, .50), (.10, .36, .30), naval, col))
            saddle.rotation_euler.z = sign*math.atan2(b[1]*sign-a[1]*sign, b[0]-a[0])

        # Rear ventilation hood standing proud of the rounded back plate. It is
        # built in the plate's own tangent frame and sunk 6 cm into the armor.
        p, q = Vector((-7.70, sign*2.24)), Vector((-7.29, sign*3.73))
        tangent = (q-p).normalized()
        outward = Vector((-tangent.y, tangent.x))*sign
        origin = p+(q-p)*.31
        profile = [(-.06, .95), (.40, .95), (.45, 1.10), (.45, 2.16), (.33, 2.43), (-.06, 2.54)]
        k = len(profile)
        points = [(origin.x+outward.x*n+tangent.x*u, origin.y+outward.y*n+tangent.y*u, z)
                  for u in [-.56, .56] for n, z in profile]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2*k)))]
        faces += [(i, i+k, (i+1) % k+k, (i+1) % k) for i in range(k-1)]
        if sign > 0:
            faces = [tuple(reversed(f)) for f in faces]
        put(mesh(name + '.rear-hood', points, faces, naval, col))
        handle = origin+outward*.47
        put(rod(name + '.rear-hood-handle', (handle.x+tangent.x*.30, handle.y+tangent.y*.30, 1.45),
                (handle.x+tangent.x*.30, handle.y+tangent.y*.30, 1.75), .02, painted, col, vertices=4))

    # Pleated canvas seals. The fixed seam is cast onto the real face, upper
    # plate and glacis so it stays seated where the tall port returns over the
    # roof; the cuff rides the constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i*math.tau/20
            yy = y + .66*math.copysign(abs(math.cos(a))**.75, math.cos(a))
            zz = 1.42 + .95*math.copysign(abs(math.sin(a))**.65, math.sin(a))
            seam.append((front_x(yy, zz)+.03, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward']+COLLAR, SLEEVE+.015, rings=5, slack=.20, fullness=.11)
        # A linear cloth loft cuts under the face knuckle at depression and can
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
                if 0 < distance < SLEEVE+.035:
                    for i in range(3):
                        point.co[i] += radial[i]*((SLEEVE+.035)/distance-1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

"""Original 406 mm/45 Mk.6 three-gun turret, the North Carolina and South Dakota main mount.

Visual proportions follow the approved GameModels3D pasb012 A artillery
(`agm012_16in45_mk6`). No reference geometry is loaded here. The catalog owns
the closed armor shell and the weapon data; this recipe draws that shell and
adds the roller path, the raked gun-port face with its climbing ladders, the
flank sight hoods, the rear rangefinder hoods and access platform, the roof
rails, the sliding barrels and the canvas gun-port covers.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .54      # sliding jacket radius through the canvas cuff
COLLAR = 1.97     # cuff station forward of the trunnion
ROOF_Z = 2.86     # flat roof plane of the catalog shell
# Roof edge of the shell in plan, rear to front; the rails and hoods sit on it.
ROOF_EDGE = [(-8.29, 4.39), (0.40, 5.37), (3.36, 4.75)]


def roof_edge_y(x):
    for (xa, ya), (xb, yb) in zip(ROOF_EDGE, ROOF_EDGE[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return ROOF_EDGE[0][1] if x < ROOF_EDGE[0][0] else ROOF_EDGE[-1][1]


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
    # face, the belt knuckle and the chamfered rear stay on their protection.
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

    def side_y(x, z, sign=1):
        """Distance from the centreline to the side plate on the given flank."""
        hits = cast((x, sign * 30, z), (0, -sign, 0))
        return max(sign * h.y for h in hits) if hits else 0.0

    # Plane pairs of the right-handed frame, so an extruded outline can be
    # wound outward whichever flank it is mirrored onto.
    PLANE = {'x': lambda u, v, w: (w, u, v), 'y': lambda u, v, w: (v, w, u), 'z': lambda u, v, w: (u, v, w)}

    def solid(label, outline, axis, a, b, material):
        """Closed prism: `outline` lies in the plane normal to `axis`, swept from a to b."""
        ring = [tuple(p) for p in outline]
        k = len(ring)
        area = sum(ring[i][0] * ring[(i + 1) % k][1] - ring[(i + 1) % k][0] * ring[i][1] for i in range(k))
        if area < 0:
            ring.reverse()
        a, b = min(a, b), max(a, b)
        place = PLANE[axis]
        points = [place(u, v, w) for w in (a, b) for u, v in ring]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return put(mesh(name + label, points, faces, material, col))

    def octagon(cx, cy, half_x, half_y, chamfer):
        return [(cx - half_x + chamfer, cy - half_y), (cx + half_x - chamfer, cy - half_y),
                (cx + half_x, cy - half_y + chamfer), (cx + half_x, cy + half_y - chamfer),
                (cx + half_x - chamfer, cy + half_y), (cx - half_x + chamfer, cy + half_y),
                (cx - half_x, cy + half_y - chamfer), (cx - half_x, cy - half_y + chamfer)]

    # Rotating roller path. The ship owns the fixed barbette below the sole.
    put(cyl(name + '.roller-path', (0, 0, .055), spec['barbetteRadius'], .11, edge, col, 32))

    # ---- guns -----------------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One closed surface per gun: the constant jacket that carries the cuff
        # through full recoil, the slide shoulder, the tapered chase, the
        # muzzle swell and the bore turned back inside it.
        profile = [(-.10, SLEEVE), (3.29, SLEEVE), (3.76, .477), (length - .62, .246),
                   (length - .42, .294), (length, .294), (length, bore), (length - .55, bore)]
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

    # ---- gun-port face ---------------------------------------------------
    # Four ladders climb the raked face, one outboard of each wing port and one
    # between the ports, on shoes welded to the plate.
    for sign in [1, -1]:
        for centre in [1.4925, 4.305]:
            y = sign * centre
            rails = [y - .215, y + .215]
            foot, head = .26, ROOF_Z + .02
            for ry in rails:
                a = (front_x(ry, foot) + .10, ry, foot)
                b = (front_x(ry, head - .04) + .10, ry, head)
                put(rod(name + '.face-ladder-rail', a, b, .032, painted, col, vertices=4))
                for t in [.06, .5, .94]:
                    p = Vector(a).lerp(Vector(b), t)
                    put(rod(name + '.face-ladder-shoe', (front_x(ry, p.z) - .01, ry, p.z),
                            (p.x, ry, p.z), .026, painted, col, vertices=4))
            steps = 9
            for i in range(steps):
                z = foot + .22 + (head - foot - .44) * i / (steps - 1)
                x = front_x(y, z) + .10
                put(rod(name + '.face-ladder-rung', (x, rails[0], z), (x, rails[1], z), .024, painted, col, vertices=4))

    # ---- flank fittings --------------------------------------------------
    for sign in [1, -1]:
        # Two armoured sight hoods per flank: the lower, after pointer hood and
        # the raised forward trainer hood. Each is a chamfered housing let into
        # the side plate behind a rain flange, with an outboard visor cap and a
        # forward-facing optical slit.
        for x, z in [(-.72, 1.37), (.86, 2.23)]:
            seat = side_y(x, z, sign)
            # Plane coordinates for an extrusion along Y are (z, x).
            solid('.sight-hood-flange', octagon(z, x, .42, .44, .13), 'y',
                  sign * (seat - .04), sign * (seat + .07), naval)
            solid('.sight-hood', octagon(z, x, .37, .38, .11), 'y',
                  sign * (seat - .22), sign * (seat + .32), naval)
            solid('.sight-hood-visor', octagon(z - .05, x - .03, .26, .24, .08), 'y',
                  sign * (seat + .10), sign * (seat + .56), naval)
            put(box(name + '.sight-hood-window', (x + .21, sign * (seat + .40), z - .05),
                    (.05, .28, .40), glass, col))

        # Rear rangefinder hood: an armoured box let through the after shoulder
        # plate, its outboard end chamfered, with the bearing's cap plate lying
        # on the roof inboard of it.
        x0, x1, out, bevel = -7.62, -5.70, 7.04, .34
        z0, z1 = 1.51, 2.71
        hood = [(x0, 4.40), (x1, 4.40), (x1, out - bevel), (x1 - bevel, out),
                (x0 + bevel, out), (x0, out - bevel)]
        solid('.rangefinder-hood', [(px, sign * py) for px, py in hood], 'z', z0, z1, naval)
        cap = [(-7.82, 4.05), (-5.41, 4.05), (-5.41, 5.24), (-7.82, 4.88)]
        solid('.rangefinder-cap', [(px, sign * py) for px, py in cap], 'z', ROOF_Z - .02, ROOF_Z + .08, naval)

        # Low rail along the roof edge on short stanchions.
        path = [(-4.99, roof_edge_y(-4.99) - .24), (0.40, roof_edge_y(0.40) - .19), (3.05, roof_edge_y(3.05) - .21)]
        for (xa, ya), (xb, yb) in zip(path, path[1:]):
            put(rod(name + '.roof-rail', (xa, sign * ya, 3.01), (xb, sign * yb, 3.01), .042, painted, col, vertices=4))
        for (xa, ya), (xb, yb) in zip(path, path[1:]):
            span = math.hypot(xb - xa, yb - ya)
            posts = max(2, int(span / .58))
            for i in range(posts):
                t = (i + .5) / posts
                px, py = xa + (xb - xa) * t, sign * (ya + (yb - ya) * t)
                put(rod(name + '.roof-rail-post', (px, py, top_z(px, py) - .02), (px, py, 3.00), .026, painted, col, vertices=4))

        # Drip brackets stiffening the lower edge of the side plate.
        for i in range(10):
            x = -1.2 + i * .62
            top, foot = .66, .16
            ya, yb = side_y(x, top, sign), side_y(x, foot, sign)
            solid('.edge-bracket', [(sign * ya, top), (sign * yb, foot), (sign * (yb + .17), foot)],
                  'x', x - .05, x + .05, naval)

    # Rear access platform on the starboard quarter, a plate carried aft of the
    # back plate on two gusset brackets, as on the approved model.
    solid('.rear-platform', [(-9.38, -2.28), (-8.30, -2.22), (-8.30, -4.06), (-9.14, -4.10)], 'z', 2.42, 2.70, naval)
    for py in [-2.42, -3.90]:
        solid('.rear-platform-bracket', [(2.42, -8.86), (2.42, -9.30), (1.78, -8.86)], 'y', py - .05, py + .05, naval)

    # Shallow fairing under the after floor on the starboard quarter, carrying
    # the training gear as on the approved model. It stops on the sole plane.
    solid('.under-floor-fairing', [(.02, -8.62), (.62, -8.62), (.30, -6.10), (.02, -6.10)], 'y', -4.00, -1.70, naval)

    # ---- canvas gun-port covers -----------------------------------------
    # The fixed seam is cast onto the real raked face, so the tall port stays
    # seated up at the roof knuckle; the cuff rides the constant jacket through
    # elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .86 * math.copysign(abs(math.cos(a)) ** .78, math.cos(a))
            rise = 1.40 if math.sin(a) > 0 else .76
            zz = spec['pivotHeight'] + rise * math.copysign(abs(math.sin(a)) ** .70, math.sin(a))
            seam.append((front_x(yy, zz) + .03, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, .095 + SLEEVE, rings=5, slack=.18, fullness=.13)
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
                if 0 < distance < SLEEVE + .05:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .05) / distance - 1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

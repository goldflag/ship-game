"""Original 305 mm/50 Mk.8 three-gun turret, the Alaska class main mount.

Visual proportions follow the approved GameModels3D pasc510 A artillery
(`agm177_12in50_mk8_triple`). No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the roller path, the raked gun-port face with its climbing ladders,
the flank ladder and sight hoods, the swept rear rangefinder wings, the roof
rail and hatch, the sliding barrels and the canvas gun-port covers.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .425     # sliding jacket radius through the canvas cuff
COLLAR = 2.09     # cuff station forward of the trunnion
ROOF_Z = 2.68     # roof plane of the catalog shell abaft the forward break


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
    # face, the tumblehome flanks and the rounded back stay on their protection.
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

    def octagon(cu, cv, half_u, half_v, chamfer):
        return [(cu - half_u + chamfer, cv - half_v), (cu + half_u - chamfer, cv - half_v),
                (cu + half_u, cv - half_v + chamfer), (cu + half_u, cv + half_v - chamfer),
                (cu + half_u - chamfer, cv + half_v), (cu - half_u + chamfer, cv + half_v),
                (cu - half_u, cv + half_v - chamfer), (cu - half_u, cv - half_v + chamfer)]

    def ladder(label, rails, foot, head, standoff, rungs):
        """Two rails on shoes up the raked face, with rungs between them."""
        for ry in rails:
            a = (front_x(ry, foot) + standoff, ry, foot)
            b = (front_x(ry, head - .04) + standoff, ry, head)
            put(rod(name + label + '.rail', a, b, .028, painted, col, vertices=4))
            for t in [.06, .5, .94]:
                p = Vector(a).lerp(Vector(b), t)
                put(rod(name + label + '.shoe', (front_x(ry, p.z) - .01, ry, p.z), (p.x, ry, p.z), .024, painted, col, vertices=4))
        for i in range(rungs):
            z = foot + .20 + (head - foot - .40) * i / (rungs - 1)
            x = front_x(sum(rails) / 2, z) + standoff
            put(rod(name + label + '.rung', (x, rails[0], z), (x, rails[1], z), .022, painted, col, vertices=4))

    # Rotating roller path. The ship owns the fixed barbette below the sole.
    put(cyl(name + '.roller-path', (0, 0, .075), spec['barbetteRadius'], .15, edge, col, 32))

    # ---- guns -----------------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One closed surface per gun: the constant jacket that carries the cuff
        # through full recoil, the stepped chase and the bore turned back inside
        # the muzzle face.
        profile = [(-.10, SLEEVE), (3.63, SLEEVE), (4.44, .339), (6.86, .293), (6.90, .257),
                   (length, .234), (length, bore), (length - .45, bore)]
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
    # Four ladders climb the raked face, one between the centre gun and each
    # wing gun and one outboard of each wing port.
    for sign in [1, -1]:
        for centre in [1.13, 3.28]:
            ladder('.face-ladder', [sign * (centre - .18), sign * (centre + .18)], .26, 2.52, .09, 8)
            # Hand-hold hoop where the ladder tops out on the roof knuckle.
            solid('.face-ladder-hoop', [(sign * (centre - .22), 2.54), (sign * (centre + .22), 2.54),
                                        (sign * (centre + .22), 2.71), (sign * (centre - .22), 2.71)],
                  'x', 2.49, 2.53, painted)

    # ---- flank fittings --------------------------------------------------
    for sign in [1, -1]:
        # Vertical ladder up the flank to a roof hand-hold.
        for rx in [-1.40, -1.05]:
            foot, head = .27, 2.60
            a = (rx, sign * (side_y(rx, foot, sign) + .07), foot)
            b = (rx, sign * (side_y(rx, head, sign) + .07), head)
            put(rod(name + '.flank-ladder-rail', a, b, .026, painted, col, vertices=4))
            for t in [.08, .5, .92]:
                p = Vector(a).lerp(Vector(b), t)
                put(rod(name + '.flank-ladder-shoe', (rx, sign * (side_y(rx, p.z, sign) - .01), p.z),
                        (rx, p.y, p.z), .022, painted, col, vertices=4))
        for i in range(8):
            z = .45 + i * .30
            put(rod(name + '.flank-ladder-rung', (-1.40, sign * (side_y(-1.40, z, sign) + .07), z),
                    (-1.05, sign * (side_y(-1.05, z, sign) + .07), z), .022, painted, col, vertices=4))
        solid('.flank-ladder-hoop', [(2.67, -1.37), (2.67, -.95), (2.86, -.95), (2.86, -1.37)], 'y',
              sign * (side_y(-1.16, 2.60, sign) - .30), sign * (side_y(-1.16, 2.60, sign) + .02), painted)

        # Two armoured sight hoods per flank: the lower, after pointer hood and
        # the raised forward trainer hood, each a chamfered housing let into the
        # side plate behind a rain flange, with a forward-facing optical slit.
        for x, z in [(-.58, 1.36), (.78, 2.11)]:
            seat = side_y(x, z, sign)
            solid('.sight-hood-flange', octagon(z, x, .40, .42, .12), 'y',
                  sign * (seat - .04), sign * (seat + .06), naval)
            solid('.sight-hood', octagon(z, x, .35, .37, .10), 'y',
                  sign * (seat - .20), sign * (seat + .27), naval)
            solid('.sight-hood-visor', octagon(z - .01, x - .02, .25, .25, .08), 'y',
                  sign * (seat + .08), sign * (seat + .45), naval)
            put(box(name + '.sight-hood-window', (x + .22, sign * (seat + .33), z - .01),
                    (.05, .24, .38), glass, col))

        # Swept rangefinder wing: a tapered armoured arm let through the after
        # shoulder, its outboard end capped by the optical window box.
        root = [(1.12, -7.22), (2.69, -7.22), (2.69, -4.72), (1.12, -4.72)]
        tip = [(1.80, -7.15), (2.45, -7.15), (2.67, -4.92), (1.15, -4.92)]
        cap = [(1.94, -7.00), (2.33, -7.00), (2.53, -5.12), (1.31, -5.12)]
        solid('.rangefinder-wing', root, 'y', sign * 3.30, sign * 6.28, naval, tip)
        solid('.rangefinder-wing-cap', tip, 'y', sign * 6.28, sign * 6.48, naval, cap)
        solid('.rangefinder-window', [(2.00, -6.90), (2.27, -6.90), (2.45, -5.25), (1.40, -5.25)], 'y',
              sign * 6.46, sign * 6.50, glass)
        put(box(name + '.rangefinder-eyepiece', (-5.88, sign * 6.30, 1.60), (.22, .30, .22), naval, col))

        # Grab stanchions welded to the lower flank.
        for x in [-3.62, -2.26]:
            seat = side_y(x, 1.20, sign)
            solid('.flank-stanchion', [(.50, x - .05), (1.83, x - .05), (1.83, x + .05), (.50, x + .05)], 'y',
                  sign * (seat - .04), sign * (seat + .09), painted)
            solid('.flank-stanchion-foot', [(.34, x - .09), (.54, x - .09), (.54, x + .09), (.34, x + .09)], 'y',
                  sign * (seat - .04), sign * (seat + .14), naval)

        # Drip brackets stiffening the lower edge of the side plate.
        for i in range(8):
            x = .40 + i * .52
            top, foot = .58, .14
            ya, yb = side_y(x, top, sign), side_y(x, foot, sign)
            solid('.edge-bracket', [(sign * ya, top), (sign * yb, foot), (sign * (yb + .15), foot)],
                  'x', x - .05, x + .05, naval)

    # Raised grab rail across the port half of the roof and the starboard
    # access hatch, both standing on the roof plate.
    solid('.roof-rail', [(-2.06, .02), (-1.79, .02), (-1.79, 3.22), (-2.06, 3.22)], 'z', ROOF_Z - .02, 3.05, painted)
    solid('.roof-hatch', octagon(.79, -.77, .27, .27, .09), 'z', ROOF_Z - .05, 3.03, naval)

    # ---- canvas gun-port covers -----------------------------------------
    # The fixed seam is cast onto the real raked face; the cuff rides the
    # constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .53 * math.copysign(abs(math.cos(a)) ** .78, math.cos(a))
            rise = 1.44 if math.sin(a) > 0 else .82
            zz = spec['pivotHeight'] + rise * math.copysign(abs(math.sin(a)) ** .70, math.sin(a))
            seam.append((front_x(yy, zz) + .03, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, .085 + SLEEVE, rings=5, slack=.15, fullness=.11)
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
                if 0 < distance < SLEEVE + .04:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .04) / distance - 1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

"""Original 8-inch/55 Mk 16 three-gun turret, the Des Moines and Salem main battery.

Visual proportions follow the approved GameModels3D pasc020 (Des Moines) A1
artillery, `agm025_8in55_triple_mk16`, which Salem (pasc710) fits unchanged. No
reference geometry is loaded here. The catalog owns the closed armor shell and
the weapon data; this recipe draws that shell and adds the turntable, the
forward working tray, the four face ladders, three sliding barrels with canvas
seals, the after platform and splinter screen, and the roof fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .285   # sliding jacket radius through the canvas cuff
COLLAR = 2.50   # cuff station forward of the trunnion
LADDERS = [1.03, 3.24]   # face ladders between and outboard of the ports


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
    # face, the tumblehome sides and the sloping after roof stay aligned with
    # their protection.
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
        return max(h.x for h in hits) if hits else 2.24

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else 2.74

    # Rotating sole under the house; the ship owns the fixed barbette below it.
    put(cyl(name + '.turntable', (0, 0, .06), spec['barbetteRadius'], .12, naval, col, 48))

    # Forward working tray carried off the foot of the face, with its rail
    # broken where each gun trains out over it.
    put(box(name + '.tray', (5.04, 0, .16), (2.29, 5.82, .08), naval, col))
    put(box(name + '.tray-rail', (6.07, 0, .485), (.09, 5.82, .07), painted, col))
    for sign in [1, -1]:
        put(box(name + '.tray-side', (5.10, sign * 2.865, .45), (2.16, .09, .66), naval, col))
        for a, b in [(.50, 1.45), (2.55, 2.90)]:
            put(box(name + '.tray-rail-panel', (6.11, sign * (a + b) / 2, .67), (.09, b - a, .42), painted, col))
        # Guard rail from the top corner of the face down to the tray corner,
        # on two stanchions that stand on the tray side.
        head, foot = (2.33, sign * 3.30, 2.78), (6.11, sign * 2.88, .88)
        put(rod(name + '.tray-guard', head, foot, .035, painted, col, vertices=4))
        for t in [.34, .67]:
            p = Vector(head).lerp(Vector(foot), t)
            put(rod(name + '.tray-guard-post', (p.x, p.y, .79), (p.x, p.y, p.z), .03, painted, col, vertices=4))

    # Rung ladders climb the raked face between and outboard of the three ports.
    for lateral in LADDERS:
        for sign in [1, -1]:
            y = sign * lateral
            rails = [y - .165, y + .165]
            path = [(front_x(y, z) + .06, z) for z in [.30, 2.68]]
            for ry in rails:
                put(rod(name + '.face-ladder-rail', (path[0][0], ry, path[0][1]),
                        (path[1][0], ry, path[1][1]), .028, edge, col, vertices=4))
                for z in [.45, 1.55, 2.55]:
                    put(rod(name + '.face-ladder-shoe', (front_x(y, z) - .02, ry, z),
                            (front_x(y, z) + .06, ry, z), .024, naval, col, vertices=4))
            for i in range(8):
                z = .42 + i * .32
                put(rod(name + '.face-ladder-rung', (front_x(y, z) + .06, rails[0], z),
                        (front_x(y, z) + .06, rails[1], z), .022, edge, col, vertices=4))

    # After platform and its splinter screen, hung on the rear plate.
    put(box(name + '.after-platform', (-6.31, 0, .41), (.88, 7.16, .18), naval, col))
    for a, b in [(-3.56, -1.63), (-.91, .91), (1.63, 3.56)]:
        put(box(name + '.after-screen', (-6.70, (a + b) / 2, 1.03), (.06, b - a, 1.09), naval, col))
    for y in [-1.66, 0, 1.66]:
        put(box(name + '.after-bracket', (-6.33, y, .27), (.81, .08, .18), painted, col))

    for sign in [1, -1]:
        # Trainer and pointer hoods on the widest part of each flank.
        for label, x, z, depth in [('sight-hood', -.34, 1.40, .50), ('sight-hood-upper', -.68, 2.08, .49)]:
            put(box(name + '.' + label, (x, sign * 4.70, z), (.50, .40, depth), naval, col))
            put(box(name + '.' + label + '-bezel', (x + .27, sign * 4.70, z), (.05, .30, depth - .14), edge, col))
            put(box(name + '.' + label + '-lens', (x + .30, sign * 4.70, z), (.02, .22, depth - .22), glass, col))
        # Cable box low on the after quarter of the flank.
        put(box(name + '.cable-box', (-3.85, sign * 4.06, 2.17), (.14, .20, .60), painted, col))

        # Hatch gratings lie on the sloping after roof.
        put(box(name + '.roof-hatch', (-5.73, sign * 1.325, 2.57), (.66, 1.23, .10), roof, col))
        # Sight-head stalk, its seat and a vent hood forward of it.
        seat = top_z(-3.72, sign * 1.76)
        put(box(name + '.roof-stalk-seat', (-3.72, sign * 1.76, seat + .08), (.27, .26, .23), naval, col))
        put(rod(name + '.roof-stalk', (-3.72, sign * 1.76, seat + .04), (-3.72, sign * 1.76, 3.50), .06, painted, col, vertices=8))
        put(cyl(name + '.roof-vent', (-2.74, sign * 2.59, top_z(-2.74, sign * 2.59) + .16), .10, .40, naval, col, 10))
        # Grab rails along the roof edge on short stanchions.
        for a, b in [(-4.60, -2.90), (-1.90, -.20)]:
            posts = [(a, sign * 3.58), (b, sign * 3.42)]
            for px, py in posts:
                put(rod(name + '.roof-rail-post', (px, py, top_z(px, py) - .02),
                        (px, py, top_z(px, py) + .20), .022, painted, col, vertices=4))
            put(rod(name + '.roof-rail', (posts[0][0], posts[0][1], top_z(*posts[0]) + .19),
                    (posts[1][0], posts[1][1], top_z(*posts[1]) + .19), .022, painted, col, vertices=4))

    # Asymmetric aerial spreader on the crown: two posts carry a stay out to a
    # bracket on the starboard roof edge and a cross spar toward port.
    for x in [-1.49, -1.05]:
        put(rod(name + '.aerial-post', (x, -.82, top_z(x, -.82) - .02), (x, -.82, 3.12), .028, painted, col, vertices=4))
    put(box(name + '.aerial-bracket', (-1.21, -3.42, 2.90), (.05, .55, .28), painted, col))
    put(rod(name + '.aerial-stay', (-1.27, -.82, 3.06), (-1.21, -3.42, 2.86), .026, painted, col, vertices=4))
    put(rod(name + '.aerial-spar', (-1.28, -.86, 2.84), (-1.28, 1.86, 2.84), .026, painted, col, vertices=4))
    put(rod(name + '.aerial-spar-foot', (-1.28, 1.80, top_z(-1.28, 1.80) - .02), (-1.28, 1.80, 2.84), .024, painted, col, vertices=4))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough for the cuff
        # through full recoil, then the tapering chase.
        profile = [(.20, SLEEVE), (2.80, SLEEVE), (5.90, .219), (length, .158)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .158), (length, bore), (length - .40, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .40, 0, 0), bore, dark, col, vertices=count), recoil)

    # Pleated canvas seals. The fixed seam is cast onto the raked face around
    # the tall gun port; the cuff rides the constant jacket through recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .66 * math.copysign(abs(math.cos(a)) ** .75, math.cos(a))
            zz = 1.58 + 1.14 * math.copysign(abs(math.sin(a)) ** .60, math.sin(a))
            seam.append((front_x(yy, zz) + .012, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .015, rings=5, slack=.12, fullness=.10)
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
                # The port is taller than the face: the canvas stands proud of
                # the roof knuckle, as on the approved model.
                angle = (index % 20) * math.tau / 20
                point.co.z += [0, .34, .21, .07][index // 20] * max(0., math.sin(angle)) ** 2
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

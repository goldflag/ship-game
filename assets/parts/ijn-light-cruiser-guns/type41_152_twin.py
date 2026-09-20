"""Original 15.2 cm/50 41st Year Type twin gunhouse, the Agano-class main mounting.

Visual proportions follow the approved GameModels3D `jgm167_152mm50_type_41` as fitted on Agano
(pjsc205), Yahagi (pjsc505) and Gokase (pjsc206). No reference geometry is loaded here. The catalog
owns the closed gunhouse and the weapon data; this recipe draws that gunhouse and adds the revolving
platform and its gussets, the two gun-port fairings with their sliding jackets, the roof sight drums
and periscopes, the flank grab rails and ladder, the forward sighting bar and the rear access door.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout

JACKET = .265   # sliding jacket inside the gunhouse
SLEEVE = .205   # jacket section that carries the port fairing
CHASE = .164    # chase radius where it leaves the fairing


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

    # The visible gunhouse is exactly the catalog's armor shell, so the glacis, flanks and roof stay
    # aligned with their protection.
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

    def rear_x(y, z):
        return min(h.x for h in cast((-20, y, z), (1, 0, 0)))

    def side_y(x, z, sign):
        return max(sign * h.y for h in cast((x, sign * 20, z), (0, -sign, 0))) * sign

    # Revolving platform: the racer plate, the roller drum and the gussets that carry the rim.
    put(cyl(name + '.turntable', (0, 0, .06), 2.50, .12, painted, col, 40))
    put(cyl(name + '.roller-drum', (0, 0, .285), 2.10, .35, naval, col, 32))
    for i in range(12):
        a = math.tau * i / 12 + math.tau / 24
        gusset = put(box(name + '.rim-gusset', (2.28 * math.cos(a), 2.28 * math.sin(a), .285),
                         (.44, .07, .33), naval, col))
        gusset.rotation_euler.z = a

    # Rear access door: a proud frame with two dogs on the rounded back plate.
    for label, across, lift, size in [('door-jamb', 1.12, 1.37, (.05, .07, 1.62)),
                                      ('door-head', 0, 2.15, (.05, 2.31, .07)),
                                      ('door-sill', 0, .59, (.05, 2.31, .07))]:
        for sign in ([1, -1] if across else [1]):
            y = sign * across
            put(box(name + '.' + label, (rear_x(y, lift) + .025, y, lift), size, painted, col))
    for lift in [1.16, 1.58]:
        put(box(name + '.door-dog', (rear_x(-.95, lift) + .05, -.95, lift), (.10, .26, .09), edge, col))

    # Flank furniture: three grab rails on short brackets and a boarding ladder by the shoulder.
    for sign in [1, -1]:
        for x in [-1.69, -.11, 1.50]:
            plate = side_y(x, 2.00, sign)
            for end in [-.24, .24]:
                put(box(name + '.rail-bracket', (x + end, sign * (plate + .05), 1.95),
                        (.07, .11, .22), painted, col))
            put(rod(name + '.grab-rail', (x - .27, sign * (plate + .095), 2.06),
                    (x + .27, sign * (plate + .095), 2.06), .028, painted, col, vertices=6))
        # Boarding ladder amidships: seven rungs standing well off the tumblehome plate.
        for i in range(7):
            z = .575 + i * .30
            plate = side_y(.385, z, sign)
            put(box(name + '.ladder-rung', (.385, sign * (plate + .12), z), (.31, .24, .05), painted, col))
        for x in [.25, .52]:
            plate = side_y(x, 1.50, sign)
            put(rod(name + '.ladder-stringer', (x, sign * (plate + .215), .50),
                    (x, sign * (plate + .01), 2.45), .026, painted, col, vertices=6))
        # Rear stepping bracket carried outside the sill, under the quarter.
        put(mesh(name + '.quarter-bracket',
                 [(-3.13, sign * 1.10, .48), (-1.56, sign * 1.10, .48),
                  (-1.56, sign * 2.27, .20), (-3.13, sign * 2.27, .20),
                  (-3.13, sign * 1.10, .42), (-1.56, sign * 1.10, .42),
                  (-1.56, sign * 2.27, .14), (-3.13, sign * 2.27, .14)],
                 [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)],
                 painted, col))

        # Roof sight drum over each shoulder, and a periscope stub at the roof edge.
        put(cyl(name + '.sight-drum', (.59, sign * 1.43, 2.755), .24, .11, naval, col, 16))
        put(cyl(name + '.sight-drum-cap', (.59, sign * 1.43, 2.83), .17, .06, painted, col, 12))
        put(box(name + '.sight-drum-window', (.80, sign * 1.43, 2.76), (.04, .16, .08), glass, col))
        put(box(name + '.roof-periscope', (.385, sign * 1.875, 2.72), (.31, .05, .18), painted, col))

    # Layer's sighting bar standing off the face between the ports, and two face steps below it.
    put(box(name + '.sighting-bar', (2.14, 0, 1.775), (.96, .42, .11), painted, col))
    for z in [.73, 1.02]:
        put(box(name + '.face-step', (front_x(0, z) + .10, 0, z), (.21, .30, .06), painted, col))
    # Ready-use blast tube carried on the port shoulder of the face.
    tube = put(box(name + '.stowage-tube', (2.38, 1.55, 1.69), (1.10, .50, .34), naval, col))
    tube.rotation_euler.y = math.radians(6)
    put(box(name + '.stowage-tube-cap', (2.93, 1.55, 1.75), (.06, .44, .28), painted, col))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        def ring(x, r, count=16):
            return [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for i in range(count)]

        def tube_mesh(label, profile, material, parent, count=16, smooth=True):
            points = [p for x, r in profile for p in ring(x, r, count)]
            faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                     for j in range(len(profile) - 1) for i in range(count)]
            return put(mesh(name + '.' + side + '.' + label, points, faces, material, col, smooth), parent)

        # Slide: a short eight-sided sleeve behind the trunnion with a bore clear of the gun.
        outer, inner = .34, .285
        stations = [(-1.15, outer), (-.20, outer)]
        points = [p for x, r in stations for p in ring(x, r, 8)]
        points += [p for x, r in stations for p in ring(x, inner, 8)]
        faces = [(i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i) for i in range(8)]
        faces += [(16 + i, 24 + i, 24 + (i + 1) % 8, 16 + (i + 1) % 8) for i in range(8)]
        faces += [(i, 16 + i, 16 + (i + 1) % 8, (i + 1) % 8) for i in range(8)]
        faces += [(8 + i, 8 + (i + 1) % 8, 24 + (i + 1) % 8, 24 + i) for i in range(8)]
        put(mesh(name + '.' + side + '.slide', points, faces, edge, col), elevation)
        for sy in [1, -1]:
            put(rod(name + '.' + side + '.trunnion-boss', (0, sy * .25, 0), (0, sy * .46, 0), .13, edge, col, vertices=12), elevation)
            put(rod(name + '.' + side + '.recoil-cylinder', (-.95, sy * .21, .30), (.95, sy * .21, .30),
                    .10, edge, col, vertices=10), elevation)
        put(box(name + '.' + side + '.elevating-arc', (-.85, 0, -.31), (.40, .34, .22), edge, col), elevation)

        # Sliding gun: breech, the jacket seen through the port, the fairing sleeve and the chase.
        profile = [(-.70, .30), (-.34, .30), (-.30, JACKET), (1.01, JACKET), (1.05, SLEEVE),
                   (2.55, SLEEVE), (2.60, CHASE), (length, .120)]
        tube_mesh('barrel', profile, edge, recoil)
        rim = [(length, .120), (length, bore), (length - .30, bore)]
        tube_mesh('muzzle-rim', rim, edge, recoil, smooth=False)
        put(box(name + '.' + side + '.breech', (-.44, 0, .02), (.56, .66, .68), edge, col), recoil)
        put(box(name + '.' + side + '.breech-block', (-.74, 0, -.02), (.10, .50, .54), edge, col), recoil)

        # Gun-port fairing: a fixed ring seated on the glacis where the sleeve passes through.
        station = front_x(y, spec['pivotHeight'])
        put(cyl(name + '.' + side + '.port-fairing', (station + .02, y, spec['pivotHeight']), .35, .26, naval, col, 20)) \
            .rotation_euler = (0, math.pi / 2, 0)
        put(cyl(name + '.' + side + '.port-collar', (station + .16, y, spec['pivotHeight']), .27, .10, painted, col, 20)) \
            .rotation_euler = (0, math.pi / 2, 0)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

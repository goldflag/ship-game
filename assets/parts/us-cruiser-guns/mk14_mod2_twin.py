"""Original 8-inch/55 Mk 14 Mod 2 twin mount, the lower Pensacola turrets.

Visual proportions follow the approved GameModels3D pasc106 (Pensacola) A1
artillery, `agm021_8in55_mk14_mod2`, the two-gun sister of the agm020 triple:
a narrower turtle-back gunhouse whose guns work
from a recess between two forward wings, with the rangefinder hoods carried out
on the after quarters. No reference geometry is loaded here. The catalog owns
the closed armor shell (the recess back is its face) and the weapon data; this
recipe draws that shell and adds the wings, the recess deck and port frames,
the flank ladders, the rangefinder ears, the crown fittings and three sliding
barrels with canvas seals.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .35    # sliding jacket radius through the canvas cuff
COLLAR = 2.06   # cuff station forward of the trunnion
WING = [(1.015, .02), (2.388, .02), (2.388, 1.80), (2.100, 2.05), (1.015, 2.10)]


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

    # The visible gunhouse is exactly the catalog's armor shell, so the curved
    # crown and the recess face stay aligned with their protection.
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
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else 3.10

    def prism(label, profile, x0, x1, material, mirror=False):
        """Solid with a constant (y, z) section between two x stations."""
        points = [(x, -y if mirror else y, z) for x in [x0, x1] for y, z in profile]
        k = len(profile)
        faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
        if mirror:
            faces = [tuple(reversed(f)) for f in faces]
        return put(mesh(name + '.' + label, points, faces, material, col))

    def washer(label, x0, x1, inner, outer, centre, material, count=14):
        """Flat ring standing across the bore, drawn as a closed tube."""
        points = [(x, centre[0] + r * math.cos(math.tau * i / count), centre[1] + r * math.sin(math.tau * i / count))
                  for x, r in [(x0, inner), (x0, outer), (x1, outer), (x1, inner)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(3) for i in range(count)]
        faces += [(3 * count + i, 3 * count + (i + 1) % count, (i + 1) % count, i) for i in range(count)]
        return put(mesh(name + '.' + label, points, faces, material, col))

    # Rotating sole under the house; the ship owns the fixed barbette below it.
    put(cyl(name + '.turntable', (0, 0, .015), spec['barbetteRadius'], .03, naval, col, 40))

    # Forward wings that flank the gun recess, the glacis between them and the
    # recess deck the guns work over.
    for mirror in [False, True]:
        prism('wing', WING, 1.55, 2.764, naval, mirror)
        sign = -1 if mirror else 1
        put(box(name + '.wing-rim', (2.24, sign * 1.64, 2.25), (.54, .11, .53), painted, col))
        put(box(name + '.wing-cleat', (2.82, sign * 2.36, .645), (.14, .10, .41), painted, col))
    put(box(name + '.glacis', (2.195, 0, .470), (1.14, 2.03, .900), naval, col))
    # The deck sits 5 cm lower than the approved model's, so the guns keep it
    # clear at full depression.
    put(box(name + '.recess-deck', (2.195, 0, .930), (1.14, 2.03, .06), naval, col))

    # Port frames stand in the recess, braced down to its deck.
    for side, y, _ in barrel_layout(spec):
        washer('port-frame', 2.24, 2.38, .42, .465, (y, spec['pivotHeight']), naval)
        put(box(name + '.port-frame-brace', (2.31, y, 1.06), (.12, .16, .20), painted, col))

    for sign in [1, -1]:
        # Rangefinder hood on the after quarter, with the collar through the
        # flank plate and the window in its outboard end.
        put(box(name + '.rangefinder-hood', (-5.645, sign * 3.00, 2.67), (1.29, 2.35, .82), naval, col))
        put(box(name + '.rangefinder-window', (-4.985, sign * 3.70, 2.70), (.05, .70, .32), glass, col))
        put(box(name + '.rangefinder-cap', (-6.25, sign * 3.70, 2.67), (.06, .78, .60), painted, col))

        # Rung ladder up the flank, its rungs stood off the plate.
        for i in range(7):
            z = .24 + i * .33
            put(rod(name + '.ladder-rung', (-4.34, sign * 2.37, z), (-3.92, sign * 2.37, z), .026, painted, col, vertices=4))
        for x in [-4.34, -3.92]:
            put(rod(name + '.ladder-stringer', (x, sign * 2.37, .22), (x, sign * 2.37, 2.22), .024, painted, col, vertices=4))
        # Grab rail on the shoulder above the ladder head.
        for x in [-4.13, -2.40]:
            put(rod(name + '.shoulder-rail-post', (x, sign * 2.18, top_z(x, sign * 2.18) - .02),
                    (x, sign * 2.18, top_z(x, sign * 2.18) + .18), .022, painted, col, vertices=4))
        put(rod(name + '.shoulder-rail', (-4.13, sign * 2.18, top_z(-4.13, sign * 2.18) + .17),
                (-2.40, sign * 2.18, top_z(-2.40, sign * 2.18) + .17), .022, painted, col, vertices=4))

    # Sight hood and a short vent on the crown.
    put(box(name + '.crown-hood', (-3.63, -1.65, top_z(-3.63, -1.65) + .12), (.31, .28, .30), naval, col))
    put(box(name + '.crown-hood-window', (-3.50, -1.65, top_z(-3.63, -1.65) + .14), (.03, .18, .14), glass, col))
    put(cyl(name + '.crown-vent', (-6.10, 0, top_z(-6.10, 0) + .10), .09, .28, painted, col, 8))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: a constant jacket long enough for the cuff
        # through full recoil, a shoulder at the jacket end, then the chase.
        profile = [(.20, SLEEVE), (3.69, SLEEVE), (3.71, .275), (5.60, .262), (length, .255)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .255), (length, bore), (length - .40, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .40, 0, 0), bore, dark, col, vertices=count), recoil)

    # Pleated canvas seals. The seam is seated on the port frame in the recess;
    # the cuff rides the constant jacket through recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            seam.append((2.30, y + .45 * math.cos(a), spec['pivotHeight'] + .45 * math.sin(a)))
        create_bloomer(mount, col, helpers, palette, side, seam,
                       spec['trunnionForward'] + COLLAR, SLEEVE + .015, rings=4, slack=.05, fullness=.04)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

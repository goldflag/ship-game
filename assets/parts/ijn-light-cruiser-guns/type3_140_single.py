"""Original 14 cm/50 3rd Year Type single mount, the Kuma/Nagara/Tenryu light-cruiser gun.

Visual proportions follow the approved GameModels3D `jgm035_140mm50_type_3year` as fitted on Kuma
(pjsc013), Tenryu (pjsc015), Kitakami (pjsc014) and Iwaki (pjsc026). No reference geometry is loaded
here. The catalog owns the shield plating and the weapon data; this recipe draws that plating and adds
the revolving pedestal, the slide and cradle, the sliding gun with its breech, the flank step rungs,
the roof sight hood, the two hinged sight scuttles and the canvas gun-port bag.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .186   # constant jacket radius carried through the canvas cuff
COLLAR = 2.38   # cuff station, in mount coordinates


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

    # The visible shield is exactly the catalog's plating slab, so the armor and the silhouette agree.
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

    def side_y(x, z, sign):
        return max(sign * h.y for h in cast((x, sign * 20, z), (0, -sign, 0))) * sign

    # Revolving pedestal: a deck ring, the roller drum and the racer plate under the carriage.
    put(cyl(name + '.deck-ring', (0, 0, .045), .80, .09, painted, col, 24))
    put(cyl(name + '.pedestal', (0, 0, .355), .72, .61, naval, col, 24))
    put(cyl(name + '.pedestal-cap', (0, 0, .695), .41, .07, naval, col, 20))

    # Trunnion standards carry the slide. Their bearing bosses stop at the inboard face so the
    # elevating yoke swings clear; a forward thwart ties the two standards to the racer.
    for sign in [1, -1]:
        put(box(name + '.trunnion-standard', (-.05, sign * .50, 1.10), (.52, .24, .74), naval, col))
        put(rod(name + '.trunnion-cap', (-.05, sign * .39, 1.46), (-.05, sign * .57, 1.46), .155, edge, col, vertices=12))
        # Elevating handwheel on the inboard face of each standard.
        put(cyl(name + '.gear-boss', (-.42, sign * .44, 1.08), .13, .10, edge, col, 12)).rotation_euler.x = math.pi / 2
    put(box(name + '.carriage-thwart', (.18, 0, .665), (.10, 1.70, .45), naval, col))
    put(box(name + '.training-gear', (-.90, -.55, .88), (.34, .26, .38), edge, col))

    # Ready-use shell racks stand against the inside of each flank, as on the approved model.
    for sign in [1, -1]:
        put(box(name + '.ready-rack', (.21, sign * .80, 1.26), (1.84, .88, .50), naval, col))
        for i in range(4):
            x = -.55 + i * .55
            put(rod(name + '.ready-round', (x, sign * .45, 1.55), (x, sign * 1.16, 1.55), .07, edge, col, vertices=8))
        put(box(name + '.rack-stanchion', (.21, sign * .80, .93), (.10, .86, .18), naval, col))

    # Hinged sight scuttles either side of the port, each a framed aperture with its cover standing open.
    for sign in [1, -1]:
        y, z = sign * .695, 1.45
        face = front_x(y, z)
        put(box(name + '.sight-frame', (face + .02, y, z), (.06, .50, .62), naval, col))
        put(box(name + '.sight-aperture', (face + .06, y, z), (.02, .38, .48), dark, col))
        # Two leaves swung right back against the hinge post, as the approved model shows them.
        for lift in [-.16, .16]:
            put(box(name + '.sight-cover', (face + .14, sign * .93, z + lift), (.22, .05, .28), naval, col))
        put(rod(name + '.sight-hinge', (face + .04, sign * .93, z - .32),
                (face + .04, sign * .93, z + .32), .025, painted, col, vertices=6))

    # Flank step rungs welded to the starboard plate, and the layer's hood on the port roof.
    for z in [.89, 1.56, 2.22]:
        plate = side_y(-1.455, z, -1)
        put(box(name + '.step-rung', (-1.455, plate - .10, z), (.45, .21, .04), painted, col))
    hood = put(cyl(name + '.roof-sight-hood', (-1.50, .73, 2.82), .22, .15, naval, col, 16))
    hood.rotation_euler.y = math.radians(7)
    put(cyl(name + '.roof-sight-cap', (-1.50, .73, 2.90), .13, .05, painted, col, 12))
    put(box(name + '.roof-sight-window', (-1.33, .73, 2.84), (.04, .16, .09), glass, col))

    # Elevating mass. The slide is a closed octagonal trough; the gun rides inside it and recoils
    # straight back, so the two never share a surface.
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        def ring(x, r, count=16):
            return [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for i in range(count)]

        def tube(label, profile, material, parent, count=16, smooth=True):
            points = [p for x, r in profile for p in ring(x, r, count)]
            faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                     for j in range(len(profile) - 1) for i in range(count)]
            return put(mesh(name + '.' + side + '.' + label, points, faces, material, col, smooth), parent)

        # Slide: an eight-sided sleeve with a bore clear of the gun, capped at both ends.
        outer, inner = .345, .30
        stations = [(-1.55, outer), (.55, outer)]
        points = [p for x, r in stations for p in ring(x, r, 8)]
        points += [p for x, r in stations for p in ring(x, inner, 8)]
        faces = [(i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i) for i in range(8)]
        faces += [(16 + i, 24 + i, 24 + (i + 1) % 8, 16 + (i + 1) % 8) for i in range(8)]
        faces += [(i, 16 + i, 16 + (i + 1) % 8, (i + 1) % 8) for i in range(8)]
        faces += [(8 + i, 8 + (i + 1) % 8, 24 + (i + 1) % 8, 24 + i) for i in range(8)]
        put(mesh(name + '.' + side + '.slide', points, faces, edge, col), elevation)
        put(box(name + '.' + side + '.slide-yoke', (0, 0, -.02), (.50, .66, .60), edge, col), elevation)
        for sy in [1, -1]:
            put(rod(name + '.' + side + '.recoil-cylinder', (-1.30, sy * .22, -.30), (.40, sy * .22, -.30),
                    .09, edge, col, vertices=10), elevation)
        put(box(name + '.' + side + '.elevating-arc', (-1.385, 0, -.48), (.37, .28, .28), edge, col), elevation)
        put(box(name + '.' + side + '.loading-tray', (-1.80, 0, -.41), (.72, .46, .12), painted, col), elevation)

        # Sliding gun: breech ring, the length inside the slide, the constant jacket the canvas cuff
        # rides on, and the tapering chase with its muzzle swell.
        profile = [(-1.94, .28), (-1.24, .29), (.47, .265), (.85, .215), (1.40, SLEEVE),
                   (2.88, SLEEVE), (2.94, .172), (length - .16, .150)]
        tube('barrel', profile, edge, recoil)
        rim = [(length - .16, .150), (length - .07, .166), (length, .166), (length, bore), (length - .40, bore)]
        tube('muzzle-rim', rim, edge, recoil, smooth=False)
        put(box(name + '.' + side + '.breech', (-1.79, 0, .10), (.44, .70, .88), edge, col), recoil)
        put(box(name + '.' + side + '.breech-block', (-2.03, 0, .04), (.10, .54, .58), edge, col), recoil)
        put(rod(name + '.' + side + '.breech-lever', (-2.06, .20, .10), (-2.20, .42, -.10), .035, painted, col, vertices=6), recoil)

    # Canvas gun-port bag: the seam is cast onto the raked shield face around a tall port, the cuff
    # rides the constant jacket through the whole recoil stroke.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(18):
            a = i * math.tau / 18
            ca, sa = math.cos(a), math.sin(a)
            yy = y + .37 * math.copysign(abs(ca) ** .70, ca)
            zz = 1.50 + .73 * math.copysign(abs(sa) ** .70, sa)
            seam.append((front_x(yy, zz) + .025, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               COLLAR, SLEEVE + .014, rings=5, slack=.13, fullness=.02)
        # A straight loft would cut into the raked face at depression and pinch the jacket at high
        # elevation. Drape the intermediate rings over the plating and keep them off the sleeve.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < 18 or index >= 72:
                    continue
                plate = cast((20, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .025)
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

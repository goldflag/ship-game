"""Original 15 cm Tbts KC/36 single in the Drh LC/36 shield, the German destroyer main gun.

Visual proportions follow the approved GameModels3D Z-31 (pgsd207) AB1 artillery
visual `ggm076_150mm_tl_c_36`. No reference geometry is loaded here. The catalog
owns the open-backed splinter shield and the weapon data; this recipe draws that
shield, the working space the open rear exposes, the elevating gun-port hood and
the sliding barrel. Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the
roller path, which is the plane the mount stands on.
"""
import bpy
import math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

RAKE_X0, RAKE_K = 1.47, .447  # the front plate: x = RAKE_X0 - RAKE_K * z
CUFF = 1.875                  # canvas cuff station forward of the trunnion
CUFF_RADIUS = .215            # cuff radius over the sliding jacket
PORT = (.34, 1.40, .54)       # gun port: half width, centre height, half height


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    palette.setdefault('canvas', palette['dark'])
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

    def plate_x(z):
        return RAKE_X0 - RAKE_K * z

    # The visible shield is exactly the catalog's armor envelope, thickened
    # inboard, so the rear doorway and the gun port read as real plate edges.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.shield', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    thickness = shell.modifiers.new('Shield plating', 'SOLIDIFY')
    thickness.thickness = .03
    thickness.offset = -1

    # Roller path, pedestal and the working floor the open rear shows.
    put(cyl(name + '.roller-path', (0, 0, .045), .52, .09, edge, col, 24))
    put(cyl(name + '.pedestal', (0, 0, .375), .33, .57, naval, col, 16))
    put(cyl(name + '.working-floor', (0, 0, .275), .58, .07, naval, col, 24))
    put(box(name + '.trunnion-block', (0, 0, .745), (.72, .68, .17), naval, col))
    # A transverse sill closes the floor pan under the rear doorway.
    put(box(name + '.floor-sill', (-.40, 0, .36), (.07, 2.54, .58), naval, col))

    # Rear bulkhead: a framed doorway, not a solid plate; the loading crew
    # works through it. Sill, head and two jambs stand on the shield floor.
    for label, x, y, z, size in [
            ('bulkhead-sill', -1.01, 0, .21, (.035, 2.52, .28)),
            ('bulkhead-head', -1.01, 0, 1.94, (.035, 1.54, .20)),
            ('bulkhead-jamb', -1.01, 1.02, 1.04, (.035, .48, 1.38)),
            ('bulkhead-jamb', -1.01, -1.02, 1.04, (.035, .48, 1.38))]:
        put(box(name + '.' + label, (x, y, z), size, naval, col))

    # Training gear and hoist trunk standing on the floor aft of the bulkhead.
    put(box(name + '.hoist-trunk', (-1.37, 0, 1.29), (.82, .76, .96), naval, col))
    put(cyl(name + '.hoist-head', (-1.37, 0, 1.83), .30, .12, edge, col, 12))
    for sign in [1, -1]:
        put(rod(name + '.trunk-stay', (-1.78, sign * .30, .10), (-1.78, sign * .38, 1.15),
                .035, painted, col, vertices=6))

    # Slide, cradle and the trunnion bearings that carry the gun.
    put(box(name + '.cradle-bed', (.45, 0, 1.01), (1.54, 1.56, .52), naval, col))
    for sign in [1, -1]:
        put(box(name + '.slide-cheek', (0, sign * .485, 1.25), (1.09, .13, .87), naval, col))
        put(cyl(name + '.trunnion-bearing', (spec['trunnionForward'], sign * .58, spec['pivotHeight']),
                .17, .18, edge, col, 12)).rotation_euler.x = math.pi / 2
        # Recoil cylinder alongside the cradle, capped at the front.
        put(rod(name + '.recoil-cylinder', (-.28, sign * .30, 1.52), (1.02, sign * .30, 1.52),
                .11, edge, col, vertices=10))
        put(cyl(name + '.recoil-cylinder-cap', (1.05, sign * .30, 1.52), .13, .07, painted, col, 10)
            ).rotation_euler.y = math.pi / 2

        # Layer to starboard, trainer to port: seat, footrest and handwheel.
        put(box(name + '.gunner-seat', (.56, sign * 1.02, 1.36), (.50, .13, .07), edge, col))
        put(box(name + '.gunner-seat-back', (.33, sign * .98, 1.60), (.09, .46, .52), edge, col))
        for x in [.33, .79]:
            put(rod(name + '.seat-leg', (x, sign * 1.02, .95), (x, sign * 1.02, 1.33),
                    .028, painted, col, vertices=6))
        wheel = put(cyl(name + '.handwheel', (.43, sign * .86, 1.38), .155, .035, painted, col, 12))
        wheel.rotation_euler.x = math.pi / 2
        put(rod(name + '.handwheel-shaft', (.43, sign * .62, 1.38), (.43, sign * .86, 1.38),
                .035, edge, col, vertices=8))
        put(box(name + '.sight-box', (.44, sign * .78, 1.63), (.24, .30, .22), naval, col))
        put(box(name + '.sight-glass', (.57, sign * .78, 1.66), (.02, .18, .11), glass, col))

        # The layer's and trainer's vision openings: tall trapezoids that lean
        # inboard as they rise. The armor envelope keeps a continuous face, so
        # they are drawn as recessed wells sunk into the raked plate.
        corners = [(.69, 1.15), (1.03, 1.15), (.94, 1.88), (.37, 1.88)]
        if sign < 0:
            corners = list(reversed(corners))
        lip = [(plate_x(z) + .004, sign * yy, z) for yy, z in corners]
        back = [(plate_x(z) - .085, sign * yy, z) for yy, z in corners]
        well = put(mesh(name + '.vision-port', lip + back,
                        [(4, 5, 6, 7)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)],
                        dark, col))
        well.data.materials.append(naval)
        for polygon in list(well.data.polygons)[1:]:
            polygon.material_index = 1

        # Side steps and a ready locker on the shield flank.
        put(box(name + '.flank-step', (.82, sign * 1.24, .29), (.72, .10, .30), naval, col))
        put(box(name + '.ready-locker', (1.04, sign * .87, 1.01), (.22, .36, .44), naval, col)
            ).rotation_euler.y = -math.atan(RAKE_K)
        # Flank handrail on short stanchions, outboard of the shield plating.
        for x in [-1.66, -1.20]:
            put(rod(name + '.rail-stanchion', (x, sign * 1.24, 1.22), (x, sign * 1.37, 1.22),
                    .020, painted, col, vertices=6))
        put(rod(name + '.flank-rail', (-1.70, sign * 1.37, 1.22), (-1.16, sign * 1.37, 1.22),
                .022, painted, col, vertices=6))

    # Rear plate: the shield is hooded over the doorway, closed above the
    # crew's heads and open below. It is cut to the rear rim's own outline.
    rim = [(-1.20, 1.78), (-1.06, 1.96), (-.73, 2.23), (.73, 2.23), (1.06, 1.96), (1.20, 1.78)]
    k = len(rim)
    points = [(x, y, z) for x in [-1.845, -1.795] for y, z in rim]
    faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
    faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
    put(mesh(name + '.rear-hood-plate', points, faces, naval, col))

    # Raised roof hatch hood: a low cambered lid over the crown, with flat
    # ends, as the source fits it between the shoulders.
    lid = [(-.787, 2.147), (-.45, 2.43), (.095, 2.379), (.37, 2.02)]
    k = len(lid)
    points = [(x, y, z) for y in [-.819, .819] for x, z in lid]
    faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
    faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
    put(mesh(name + '.roof-hood', points, faces, roof, col))

    # Barrel group. One gun: elevation, recoil and muzzle datums follow the
    # approved model's joint nodes.
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # One connected sliding surface: breech ring, constant jacket long
        # enough for the canvas cuff through full recoil, shoulder, chase.
        profile = [(-.98, .235), (-.72, .235), (-.69, .225), (.66, .225), (.69, .20),
                   (2.93, .20), (2.96, .148), (length - .16, .119), (length, .131)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        faces.append(tuple(range(count)))
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        put(rod(name + '.bore-interior', (length - .30, 0, 0), (length - .01, 0, 0), bore, dark, col, vertices=count), recoil)
        # Breech block and the loading tray behind it.
        put(box(name + '.breech-block', (-.82, 0, 0), (.34, .46, .44), edge, col), recoil)
        put(box(name + '.loading-tray', (-1.22, 0, -.20), (.52, .34, .06), painted, col), recoil)

        # Canvas gun-port cover: the long tapering bag the source draws as a
        # fixed snout. Its seam is cast onto the raked plate around the port
        # and the cuff slides on the jacket 1.9 m out, so the bag sags below
        # the bore and still seals at every elevation.
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + PORT[0] * math.copysign(abs(math.cos(a)) ** .72, math.cos(a))
            zz = PORT[1] + PORT[2] * math.copysign(abs(math.sin(a)) ** .72, math.sin(a))
            seam.append((plate_x(zz) + .02, yy, zz))
        create_bloomer(mount, col, helpers, palette, side, seam,
                       spec['trunnionForward'] + CUFF, CUFF_RADIUS,
                       rings=6, fold_depth=.025, slack=.09, fullness=.035)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

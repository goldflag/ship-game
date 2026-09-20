"""Original 12.7 cm SK C/34 single in the Tbts C/36 shield, the German destroyer main gun.

Visual proportions follow the approved GameModels3D Z-23 (pgsd108) B1 artillery
visual `ggm071_127mm_sk_c34`. No reference geometry is loaded here. The catalog
owns the open-backed splinter shield and the weapon data; this recipe draws that
shield, the working space the open rear exposes, the gun bulkhead, the roof
sight plates and the sliding barrel. Authoring frame: +X muzzle, +Y port,
+Z up, yaw datum on the roller path, which is the plane the mount stands on.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

PLATE_X0, PLATE_K = 1.0708, .1199  # the front plate: x = PLATE_X0 - PLATE_K * z
CUFF = 2.52                        # canvas cuff station forward of the trunnion
CUFF_RADIUS = .135                 # cuff radius over the sliding chase
SEAM = (.25, 1.235, .455)          # canvas seam on the plate: half width, centre height, half height


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
        return PLATE_X0 - PLATE_K * z

    # The visible shield is exactly the catalog's armor envelope, thickened
    # inboard, so the rear doorway and the gun-port slot read as plate edges.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.shield', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    thickness = shell.modifiers.new('Shield plating', 'SOLIDIFY')
    thickness.thickness = .028
    thickness.offset = -1

    # Roller path, deck plate and the pedestal that carries the slide.
    put(cyl(name + '.roller-path', (0, 0, .09), .52, .18, edge, col, 24))
    put(box(name + '.deck-plate', (-.18, 0, .16), (2.41, 2.52, .04), naval, col))
    for sign in [1, -1]:
        put(box(name + '.deck-stringer', (-.83, sign * 1.13, .185), (1.11, .09, .03), naval, col))
    put(box(name + '.pedestal', (0, 0, .34), (.76, .76, .34), naval, col))
    put(box(name + '.trunnion-carrier', (0, 0, .90), (.79, .76, .78), naval, col))

    # Gun bulkhead: a frame with a wide cut-out for the cradle, closing the
    # working space ahead of the loading crew.
    for label, x, y, z, size in [
            ('gun-bulkhead-sill', -.24, 0, .34, (.03, 2.40, .36)),
            ('gun-bulkhead-head', -.24, 0, 1.92, (.03, 1.90, .18)),
            ('gun-bulkhead-jamb', -.24, .90, 1.16, (.03, .60, 1.28)),
            ('gun-bulkhead-jamb', -.24, -.90, 1.16, (.03, .60, 1.28))]:
        put(box(name + '.' + label, (x, y, z), size, naval, col))

    # Training gear and ready-round trunk aft of the bulkhead.
    put(box(name + '.gear-trunk', (-1.25, 0, 1.22), (.50, .62, .81), naval, col))
    put(cyl(name + '.gear-head', (-1.25, 0, 1.68), .22, .10, edge, col, 12))
    put(box(name + '.ready-rack', (-.95, 0, 1.18), (.16, .62, .55), edge, col))

    # Slide, cradle and the trunnion bearings.
    put(box(name + '.cradle-bed', (0, 0, .96), (.78, .40, .58), naval, col))
    for sign in [1, -1]:
        put(box(name + '.slide-cheek', (-.02, sign * .15, .96), (.75, .08, .52), edge, col))
        put(cyl(name + '.trunnion-bearing', (spec['trunnionForward'], sign * .34, spec['pivotHeight']),
                .14, .16, edge, col, 12)).rotation_euler.x = math.pi / 2
        put(rod(name + '.recoil-cylinder', (-.55, sign * .22, 1.45), (.40, sign * .22, 1.45),
                .085, edge, col, vertices=10))

        # Layer to starboard, trainer to port.
        put(box(name + '.gunner-seat', (.18, sign * .82, 1.16), (.44, .12, .06), edge, col))
        put(box(name + '.gunner-seat-back', (-.02, sign * .82, 1.42), (.08, .40, .46), edge, col))
        put(rod(name + '.seat-leg', (.18, sign * .82, .80), (.18, sign * .82, 1.13),
                .026, painted, col, vertices=6))
        wheel = put(cyl(name + '.handwheel', (.10, sign * .58, 1.22), .14, .03, painted, col, 12))
        wheel.rotation_euler.x = math.pi / 2
        put(rod(name + '.handwheel-shaft', (.10, sign * .36, 1.22), (.10, sign * .58, 1.22),
                .03, edge, col, vertices=8))
        put(box(name + '.sight-box', (.22, sign * .52, 1.52), (.22, .26, .20), naval, col))
        put(box(name + '.sight-glass', (.34, sign * .52, 1.55), (.02, .16, .10), glass, col))

        # The layer's and trainer's vision openings lean inboard as they rise;
        # the armor envelope keeps its face, so they are recessed wells.
        corners = [(.69, 1.05), (1.02, 1.05), (.82, 1.88), (.32, 1.88)]
        if sign < 0:
            corners = list(reversed(corners))
        lip = [(plate_x(z) + .004, sign * yy, z) for yy, z in corners]
        back = [(plate_x(z) - .075, sign * yy, z) for yy, z in corners]
        well = put(mesh(name + '.vision-port', lip + back,
                        [(4, 5, 6, 7)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)],
                        dark, col))
        well.data.materials.append(naval)
        for polygon in list(well.data.polygons)[1:]:
            polygon.material_index = 1

        # Roof sight plates: an upright blade beside the gun port and the flat
        # spray plate that leans outboard from it over the shoulder.
        put(box(name + '.sight-blade', (.74, sign * .85, 1.88), (.24, .02, .36), naval, col))
        panel = put(box(name + '.spray-plate', (.885, sign * .70, 2.00), (.35, .82, .02), naval, col))
        panel.rotation_euler.x = -sign * math.radians(8)

        # Flank handrail on short stanchions, outboard of the plating.
        for x in [-1.28, -.76]:
            put(rod(name + '.rail-stanchion', (x, sign * 1.25, 1.20), (x, sign * 1.38, 1.20),
                    .02, painted, col, vertices=6))
        put(rod(name + '.flank-rail', (-1.32, sign * 1.38, 1.20), (-.72, sign * 1.38, 1.20),
                .022, painted, col, vertices=6))

    # Slot frame: narrow strips either side of the gun-port opening, sunk on
    # the plate as the source fits them.
    for sign in [1, -1]:
        strip = [(.30, .86), (.30, 1.90), (.24, 1.90), (.24, .86)]
        edge_pts = [(plate_x(z) + .022, sign * yy, z) for yy, z in strip]
        inner = [(plate_x(z) - .01, sign * yy, z) for yy, z in strip]
        if sign < 0:
            edge_pts, inner = list(reversed(edge_pts)), list(reversed(inner))
        put(mesh(name + '.slot-frame', edge_pts + inner,
                 [(0, 1, 2, 3)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)],
                 naval, col))

    # Rear plate, cut to the rear rim's own outline: the shield is hooded over
    # the doorway and open below.
    rim = [(-1.27, 1.84), (-1.13, 1.99), (-.98, 2.15), (.98, 2.15), (1.13, 1.99), (1.27, 1.84)]
    k = len(rim)
    points = [(x, y, z) for x in [-1.465, -1.415] for y, z in rim]
    faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
    faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
    put(mesh(name + '.rear-hood-plate', points, faces, naval, col))

    # Barrel group. Elevation, recoil and muzzle datums follow the approved
    # model's joint nodes.
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # One connected sliding surface: breech ring, jacket, shoulder and the
        # chase the canvas cuff rides through the full recoil stroke.
        profile = [(-.68, .195), (-.44, .195), (-.41, .19), (.56, .19), (.59, .16),
                   (2.29, .16), (2.34, .125), (length - .14, .108), (length, .118)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        faces.append(tuple(range(count)))
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        put(rod(name + '.bore-interior', (length - .26, 0, 0), (length - .01, 0, 0), bore, dark, col, vertices=count), recoil)
        put(box(name + '.breech-block', (-.56, 0, 0), (.30, .40, .38), edge, col), recoil)
        put(box(name + '.loading-tray', (-.92, 0, -.17), (.46, .30, .05), painted, col), recoil)

        # Canvas gun-port cover: the tall bag the source draws as a fixed
        # snout. Its seam is cast onto the plate around the slot and the cuff
        # slides on the chase, so the bag seals at every elevation.
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + SEAM[0] * math.copysign(abs(math.cos(a)) ** .62, math.cos(a))
            zz = SEAM[1] + SEAM[2] * math.copysign(abs(math.sin(a)) ** .62, math.sin(a))
            seam.append((plate_x(zz) + .02, yy, zz))
        create_bloomer(mount, col, helpers, palette, side, seam,
                       spec['trunnionForward'] + CUFF, CUFF_RADIUS,
                       rings=6, fold_depth=.02, slack=.07, fullness=.02)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

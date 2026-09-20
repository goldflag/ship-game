"""Original 15 cm SK L/45 shielded single (MPL C/16), the Karlsruhe broadside gun.

Visual proportions follow the approved GameModels3D pgsc104 A1 artillery
(`ggm047_150mm_sk_l45`). No reference geometry is loaded here. This is not a
closed turret: the catalog owns a thin closed shield slab, open at the rear,
and this recipe draws that slab plus the pedestal, carriage, trunnion cheeks,
cradle, sliding gun with its breech and recoil cylinders, the layers' seats,
handwheels and sights that the open back exposes. Authoring frame: +X muzzle,
+Y port, +Z up, yaw datum on the mounting flange at Z = 0.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout


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
    pivot, height = spec['trunnionForward'], spec['pivotHeight']

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

    # The visible shield is exactly the catalog's armor slab, so the plates the
    # game resolves are the plates the player sees.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    # Deck flange, revolving pedestal, roller race and the carriage deck the
    # trunnion cheeks stand on. The ship owns the bandstand under the flange.
    put(box(name + '.deck-flange', (0, 0, .06), (1.50, 1.50, .12), painted, col))
    put(cyl(name + '.pedestal', (0, 0, .265), .63, .33, naval, col, 24))
    put(cyl(name + '.roller-race', (0, 0, .485), .50, .13, edge, col, 24))
    put(box(name + '.carriage-deck', (-.10, 0, .59), (1.10, 1.10, .09), naval, col))

    for sign in [1, -1]:
        # Stays carrying the shield off the carriage, the only structure
        # between the revolving deck and the plate.
        for sx in [-.45, .35]:
            put(box(name + '.shield-stay', (sx, sign*.83, .50), (.16, .56, .10), painted, col))
        # Trunnion cheeks rising from the carriage deck, with bearing caps.
        put(box(name + '.trunnion-cheek', (pivot, sign*.47, 1.02), (.46, .09, .80), edge, col))
        bearing = put(cyl(name + '.trunnion-bearing', (pivot, sign*.47, height), .16, .16, edge, col, 12))
        bearing.rotation_euler.x = math.pi/2
        # Layers' handwheels: two per side on one shaft off a standard bolted
        # to the carriage deck, as the open back of the reference shows.
        put(box(name + '.handwheel-standard', (.05, sign*.50, .90), (.20, .16, .53), edge, col))
        put(rod(name + '.handwheel-shaft', (.05, sign*.46, 1.18), (.05, sign*.95, 1.18), .035, edge, col, vertices=8))
        for dy in [.62, .86]:
            wheel = put(cyl(name + '.handwheel', (.05, sign*dy, 1.18), .215, .035, edge, col, 12))
            wheel.rotation_euler.x = math.pi/2
        # Layers' seats on posts off the carriage deck, outboard of the cradle.
        put(box(name + '.seat', (-.55, sign*.56, .80), (.50, .26, .06), edge, col))
        put(rod(name + '.seat-post', (-.55, sign*.56, .63), (-.55, sign*.56, .79), .05, edge, col, vertices=6))
        # Sight ports in the shield plate, framed and glazed on the inner face.
        put(box(name + '.sight-window-frame', (.66, sign*.71, 1.66), (.06, .42, .34), painted, col))
        put(box(name + '.sight-window', (.62, sign*.71, 1.66), (.03, .34, .26), glass, col))

    # Gun-port surround closing the shield round the jacket. The barrel passes
    # through it at every elevation, as through the shield plate itself.
    put(box(name + '.gun-port-surround', (.70, 0, 1.44), (.26, .62, .98), edge, col))

    length = spec['muzzleForward'] - pivot
    bore = spec['caliberM']/2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (pivot, y, height))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # Cradle: the trough the gun slides in. It carries the trunnions, so it
        # pitches with the gun but does not recoil.
        put(box(name + '.cradle', (-.16, 0, -.33), (1.60, .78, .28), edge, col), elevation)
        put(box(name + '.cradle-yoke', (-.66, 0, -.185), (.28, .78, .53), edge, col), elevation)
        for sign in [1, -1]:
            put(rod(name + '.recoil-cylinder', (-.51, sign*.28, -.24), (1.04, sign*.28, -.24),
                    .10, edge, col, vertices=8), elevation)
            # Open sights on the cradle: a standard over the trunnion and the
            # layer's eyepiece hood behind it.
            put(box(name + '.sight-standard', (-.75, sign*.315, .19), (.12, .25, .21), edge, col), elevation)
            put(box(name + '.sight-hood', (-1.21, sign*.155, .36), (.06, .30, .40), edge, col), elevation)
            put(rod(name + '.sight-link', (-1.15, sign*.20, .30), (-.75, sign*.315, .22),
                    .03, edge, col, vertices=6), elevation)

        # Sliding mass: breech ring, jacket, stepped chase and bored muzzle,
        # one connected surface owned by the recoil joint.
        profile = [(-2.10, .24), (-1.33, .24), (-1.31, .27), (1.25, .27), (1.27, .21),
                   (1.69, .21), (1.71, .18), (3.10, .18), (3.12, .14), (length, .14)]
        count = 12
        points = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
                  for x, r in profile for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
               for x, r in [(length, .14), (length, bore), (length-.25, bore)] for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length-.27, 0, 0), (length-.25, 0, 0), bore, dark, col, vertices=count), recoil)
        # Breech housing, its rear cap, the recoil slide under the jacket, the
        # wedge handle and the loading tray hinged off the breech ring.
        put(box(name + '.breech-housing', (-1.435, 0, .10), (.31, .60, .60), edge, col), recoil)
        put(box(name + '.breech-cap', (-1.805, 0, 0.), (.25, .52, .24), edge, col), recoil)
        put(box(name + '.recoil-slide', (-1.08, 0, -.30), (.40, .60, .34), edge, col), recoil)
        put(rod(name + '.breech-handle', (-1.60, .24, .10), (-1.60, .46, .22), .035, edge, col, vertices=6), recoil)
        put(box(name + '.loading-tray', (-1.585, .40, -.105), (.73, .07, .47), edge, col), recoil)
        put(rod(name + '.tray-hinge', (-1.45, .28, -.10), (-1.45, .42, -.10), .04, edge, col, vertices=6), recoil)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

"""Original 4.5-inch QF Mk IV single shielded mounting, the Jutland X-position gun.

Visual proportions follow the approved GameModels3D pbsd109 A1 artillery
(`bgm093_4_5in_45_mk4_1barrel`). No reference geometry is loaded here. The
catalog owns the closed armor shell and the weapon data; this recipe draws that
shell and adds the pedestal it stands on, the rear canopy, the elevating port
shield, the sliding barrel, recoil gear and the layers' sight hoods.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout

FLOOR = .21       # shield floor in the catalog shell
SILL = .88        # gun-slot sill
CROWN = 2.41      # crown of the shield
BACK = -.95       # back wall of the gun slot
PORT = .30        # half width of the gun slot
SHIELD = (.78, .88, -30., 24.)     # elevating port shield: radii and arc on the trunnion
PEDESTAL = (.867, .822, .790)


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    naval, roof, edge, dark, painted = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge'])
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

    def tube(label, points, radius, material, sides=8):
        pts = [Vector(p) for p in points]
        verts, n = [], len(pts)
        for i, p in enumerate(pts):
            delta = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            q = delta.to_track_quat('Z', 'Y')
            verts += [p + q @ Vector((radius*math.cos(j*math.tau/sides), radius*math.sin(j*math.tau/sides), 0))
                      for j in range(sides)]
        faces = [(i*sides+j, i*sides+(j+1) % sides, (i+1)*sides+(j+1) % sides, (i+1)*sides+j)
                 for i in range(n-1) for j in range(sides)]
        faces += [tuple(reversed(range(sides))), tuple((n-1)*sides+j for j in range(sides))]
        return put(mesh(name + '.' + label, verts, faces, material, col, True))

    # The visible shield is exactly the catalog's armor shell.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0

    # Stepped pedestal between the deck and the shield floor.
    for i, radius in enumerate(PEDESTAL):
        put(cyl(name + '.pedestal', (0, 0, FLOOR*(i + .5)/len(PEDESTAL)), radius,
                FLOOR/len(PEDESTAL), naval, col, 24))

    # Rear canopy over the loading space, carried on the back of the shield.
    put(box(name + '.rear-canopy', (-1.60, 0, 2.52), (1.66, 3.02, .11), roof, col, .04))
    put(box(name + '.canopy-fascia', (-2.40, 0, 2.28), (.10, 3.02, .60), naval, col, .04))
    for sign in [1, -1]:
        put(box(name + '.canopy-cheek', (-1.85, sign*1.46, 2.25), (1.16, .10, .46), naval, col, .03))
        put(rod(name + '.canopy-stay', (-1.20, sign*1.42, 2.02), (-2.34, sign*1.46, 2.42), .032, naval, col, vertices=6))
    put(box(name + '.canopy-floorplate', (-1.76, 0, 2.03), (1.30, 2.98, .045), naval, col, .02))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM']/2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # Elevating port shield, curved on the trunnion radius so it stays in
        # the slot through the full elevation interval.
        inner, outer, lo, hi = SHIELD
        steps = 7
        arc = [math.radians(lo + (hi-lo)*i/(steps-1)) for i in range(steps)]
        cheeks = (-(PORT - .025), PORT - .025)
        points = [(r*math.cos(a), yy, r*math.sin(a)) for yy in cheeks for r in (inner, outer) for a in arc]

        def node(s, t, i):
            return (s*2 + t)*steps + i
        faces = []
        for i in range(steps-1):
            faces.append((node(0, 0, i), node(0, 0, i+1), node(1, 0, i+1), node(1, 0, i)))
            faces.append((node(0, 1, i), node(1, 1, i), node(1, 1, i+1), node(0, 1, i+1)))
            faces.append((node(0, 0, i), node(0, 1, i), node(0, 1, i+1), node(0, 0, i+1)))
            faces.append((node(1, 0, i), node(1, 0, i+1), node(1, 1, i+1), node(1, 1, i)))
        faces.append((node(0, 0, 0), node(1, 0, 0), node(1, 1, 0), node(0, 1, 0)))
        faces.append((node(0, 0, steps-1), node(0, 1, steps-1), node(1, 1, steps-1), node(1, 0, steps-1)))
        put(mesh(name + '.port-shield', points, faces, naval, col), elevation)
        put(cyl(name + '.port-shield-collar', (outer-.04, 0, 0), .262, .11, naval, col, 20),
            elevation).rotation_euler.y = math.pi/2
        put(rod(name + '.recoil-cylinder', (.55, 0, -.27), (1.30, 0, -.27), .080, edge, col, vertices=12), elevation)
        put(box(name + '.slide-lug', (.95, 0, -.16), (.26, .10, .14), edge, col, .02), elevation)
        # One connected surface: the jacket the shield rides on, the shoulder
        # and the slender chase carried outside it.
        profile = [(-.30, .205), (.55, .205), (.60, .191), (2.86, .191), (2.90, .139), (length, .139)]
        count = 16
        points = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
                  for x, r in profile for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        faces += [tuple(reversed(range(count)))]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
               for x, r in [(length, .139), (length, bore), (length-.28, bore)] for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length-.30, 0, 0), (length-.28, 0, 0), bore, dark, col, vertices=count), recoil)

    # Layers' sight hoods each side of the slot, standing on the shield floor,
    # and the grab rails and rear steps the approved model carries.
    for sign in [1, -1]:
        put(box(name + '.sight-hood', (.45, sign*.66, 1.21), (.66, .44, .39), naval, col, .03))
        put(box(name + '.sight-glass', (.78, sign*.66, 1.28), (.03, .22, .12), dark, col, .01))
        put(rod(name + '.handwheel-shaft', (.05, sign*.52, .95), (.05, sign*.52, 1.32), .026, edge, col, vertices=6))
        tube('handwheel', [(.05, sign*.52 + .16*math.cos(i*math.tau/12), 1.34 + .16*math.sin(i*math.tau/12))
                           for i in range(13)], .016, edge)
        for z in [.42, .74, 1.06]:
            put(rod(name + '.rear-step', (-1.55, sign*.62, z), (-1.55, sign*1.08, z), .022, painted, col, vertices=6))
        put(rod(name + '.side-grab', (.40, sign*1.42, 1.55), (-.90, sign*1.42, 1.55), .018, edge, col, vertices=6))
        for x in [.40, -.90]:
            put(rod(name + '.side-grab-foot', (x, sign*1.36, 1.55), (x, sign*1.42, 1.55), .022, naval, col, vertices=6))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

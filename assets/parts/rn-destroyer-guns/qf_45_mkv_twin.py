"""Original 4.5-inch QF Mk V twin mounting, the Daring-class main gun.

Visual proportions follow the approved GameModels3D pbsd110 A1 artillery
(`bgm102_4_5in45_mk_5`). No reference geometry is loaded here. The catalog owns
the closed armor shell and the weapon data; this recipe draws that shell and
adds the deck ring and trunk it stands on, the gun-port divider, the elevating
port shields, sliding barrels, recoil gear and the service fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout

FLOOR = .66       # gunhouse floor in the catalog shell
SILL = 1.35       # gun-slot sill
ROOF = 3.44       # roof plane
BACK = .10        # back wall of the gun slot
FRONT = 2.23      # flat face across the slot
DIVIDER = .11     # half width of the fixed divider between the two gun ports
PORT = .65        # half width of the gun slot
SHIELD = (.95, 1.05, -31., 27.)   # elevating port shield: radii and arc on the trunnion
RING, TRUNK = (1.829, .24), (1.675, .79)


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

    # The visible gunhouse is exactly the catalog's armor shell, so the rounded
    # roof, tapered stern and slot stay aligned with their protection.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0

    # Deck ring and the trunk the gunhouse overhangs, as on the approved model.
    put(cyl(name + '.deck-ring', (0, 0, RING[1]/2), RING[0], RING[1], naval, col, 32))
    put(cyl(name + '.trunk', (0, 0, (RING[1]+TRUNK[1])/2), TRUNK[0], TRUNK[1]-RING[1], naval, col, 32))
    for i in range(8):
        a = math.tau*i/8 + math.tau/16
        put(box(name + '.trunk-bracket', ((TRUNK[0]+.10)*math.cos(a), (TRUNK[0]+.10)*math.sin(a), .52),
                (.34, .10, .30), naval, col, .02)).rotation_euler.z = a

    # Fixed divider between the two gun ports, standing on the slot sill.
    put(box(name + '.port-divider', ((FRONT+BACK)/2, 0, (SILL+ROOF)/2),
            (FRONT-BACK, 2*DIVIDER, ROOF-SILL), naval, col, .03))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM']/2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        inboard = DIVIDER + .025 - abs(y)
        outboard = PORT - .025 - abs(y)
        if y < 0:
            inboard, outboard = -inboard, -outboard
        # Elevating gun-port shield. The approved model draws a rigid slab that
        # fills the whole slot and passes through the gunhouse at high angles;
        # this one is curved on the trunnion radius, so it stays inside the slot
        # through the full elevation interval.
        inner, outer, lo, hi = SHIELD
        steps = 7
        arc = [math.radians(lo + (hi-lo)*i/(steps-1)) for i in range(steps)]
        cheeks = sorted((inboard, outboard))
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
        put(cyl(name + '.port-shield-collar', (outer-.04, 0, 0), .178, .11, naval, col, 20),
            elevation).rotation_euler.y = math.pi/2
        put(rod(name + '.recoil-cylinder', (.55, 0, -.26), (1.35, 0, -.26), .078, edge, col, vertices=12), elevation)
        put(box(name + '.slide-lug', (.95, 0, -.15), (.26, .10, .13), edge, col, .02), elevation)
        # One connected surface: the jacket the shield rides on, the shoulder
        # and the slender chase the approved model carries outside the shield.
        profile = [(-.15, .175), (.90, .175), (.94, .150), (.98, .134), (length, .134)]
        count = 16
        points = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
                  for x, r in profile for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        faces += [tuple(reversed(range(count)))]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
               for x, r in [(length, .134), (length, bore), (length-.28, bore)] for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length-.30, 0, 0), (length-.28, 0, 0), bore, dark, col, vertices=count), recoil)

    # Rear ladder up the tapered stern, with the rails carried above the roof.
    for y in [-.30, .30]:
        put(rod(name + '.ladder-rail', (-2.86, y, .95), (-2.86, y, ROOF + .42), .026, painted, col, vertices=6))
    for i in range(9):
        z = 1.05 + i*.29
        put(rod(name + '.ladder-rung', (-2.86, -.30, z), (-2.86, .30, z), .021, painted, col, vertices=6))
    put(tube('ladder-head', [(-2.86, .30, ROOF + .42), (-2.55, .30, ROOF + .42)], .024, painted))
    put(tube('ladder-head', [(-2.86, -.30, ROOF + .42), (-2.55, -.30, ROOF + .42)], .024, painted))

    # Roof: two hatch coamings and the guard rails around the after end.
    for x in [-.55, -1.45]:
        put(box(name + '.roof-hatch', (x, .42, ROOF + .06), (.62, .52, .12), roof, col, .025))
    for sign in [1, -1]:
        path = [(-1.05, sign*1.52, ROOF + .34), (-1.95, sign*1.42, ROOF + .34), (-2.35, sign*1.05, ROOF + .34)]
        tube('roof-rail', path, .018, edge)
        for p in path:
            put(rod(name + '.roof-rail-post', (p[0], p[1], ROOF - .06), p, .020, naval, col, vertices=6))
        # Flank handrails on short standoffs, following the vertical side.
        for z in [1.30, 2.30]:
            a, b = (1.55, sign*2.03, z), (-1.75, sign*2.03, z)
            put(rod(name + '.side-rail', a, b, .018, edge, col, vertices=6))
            for p in [a, b]:
                put(rod(name + '.side-rail-foot', (p[0], sign*1.96, z), p, .022, naval, col, vertices=6))
        # Layer's sight hood on the forward shoulder.
        hood = put(box(name + '.sight-hood', (1.62, sign*1.82, 2.55), (.46, .24, .34), naval, col, .03))
        put(box(name + '.sight-glass', (1.62, sign*1.95, 2.60), (.24, .03, .12), dark, col, .01))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

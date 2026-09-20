"""Original 4.5-inch QF Mk IV twin between-decks mounting, the Battle-class main gun.

Visual proportions follow the approved GameModels3D pbsd109 A1 artillery
(`bgm087_4_5in_45_mk4_2barrels`). No reference geometry is loaded here. The
catalog owns the closed armor shell and the weapon data; this recipe draws that
shell and adds the gun-port divider, the elevating port shields, sliding
barrels, recoil gear and the service fittings the approved model carries.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout

SILL = .65        # gun-port recess floor in the catalog shell
BACK = -.65       # back wall of the gun-port recess
ROOF = 2.29       # roof plane
DIVIDER = .22     # half width of the fixed divider between the two gun ports
PORT = .74        # half width of the gun-port slot
SHIELD = (.86, .98, -33., 27.)  # elevating port shield: inner/outer radius and arc on the trunnion


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
    # face, knuckle and roof stay aligned with their protection.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0

    def plan_x(y):
        """Forward edge of the shell at the sill, from the authored outline."""
        return 2.16 - .1757*abs(y)

    # Fixed divider between the two gun ports, standing on the recess sill and
    # closing on the back wall of the slot.
    put(box(name + '.port-divider', ((plan_x(DIVIDER)+BACK)/2, 0, (SILL+ROOF)/2),
            (plan_x(DIVIDER)-BACK, 2*DIVIDER, ROOF-SILL), naval, col, .03))

    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM']/2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        inboard = DIVIDER + .025 - abs(y)        # port-shield edges, inside the slot
        outboard = PORT - .025 - abs(y)
        if y < 0:
            inboard, outboard = -inboard, -outboard
        # Elevating gun-port shield. The approved model draws a rigid box that
        # fills the whole slot and passes through the gunhouse at high angles;
        # this one is curved on the trunnion radius, so it stays inside the
        # slot through the full elevation interval.
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
        put(cyl(name + '.port-shield-collar', (outer-.04, 0, 0), .235, .12, naval, col, 20),
            elevation).rotation_euler.y = math.pi/2
        # Recoil cylinder and its slide lug under the chase, on the cradle.
        put(rod(name + '.recoil-cylinder', (.72, 0, -.30), (1.32, 0, -.30), .088, edge, col, vertices=12), elevation)
        put(box(name + '.slide-lug', (1.00, 0, -.16), (.30, .11, .16), edge, col, .02), elevation)
        # One connected surface: breech end, the constant jacket the shield
        # rides on, the collar and the tapering chase.
        profile = [(-.30, .222), (1.08, .222), (1.12, .190), (2.84, .190), (2.88, .152), (2.92, .128), (length, .128)]
        count = 16
        points = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
                  for x, r in profile for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        faces += [tuple(reversed(range(count)))]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r*math.cos(math.tau*i/count), r*math.sin(math.tau*i/count))
               for x, r in [(length, .128), (length, bore), (length-.30, bore)] for i in range(count)]
        faces = [(j*count+i, j*count+(i+1) % count, (j+1)*count+(i+1) % count, (j+1)*count+i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length-.32, 0, 0), (length-.30, 0, 0), bore, dark, col, vertices=count), recoil)
        # Breech ring behind the trunnion, inside the gunhouse.
        put(cyl(name + '.breech', (-.21, 0, 0), .235, .16, edge, col, 16), recoil).rotation_euler.y = math.pi/2

    # Rear wall: two access doors, the centreline ladder and the working step.
    for sign in [1, -1]:
        put(box(name + '.rear-door', (-2.395, sign*1.45, .86), (.06, .66, 1.37), naval, col, .05))
        put(rod(name + '.door-handle', (-2.445, sign*1.19, .78), (-2.445, sign*1.19, .96), .022, edge, col, vertices=6))
        # Step brackets beside each door, as on the approved model.
        for z in [.44, 1.29]:
            put(box(name + '.rear-step', (-2.46, sign*2.10, z), (.10, .19, .12), edge, col, .015))
    for y in [.554, .953]:
        put(rod(name + '.ladder-rail', (-2.47, y, .84), (-2.47, y, ROOF + .04), .026, painted, col, vertices=6))
    for i in range(6):
        z = .95 + i*.27
        put(rod(name + '.ladder-rung', (-2.47, .554, z), (-2.47, .953, z), .021, painted, col, vertices=6))
    put(tube('ladder-head', [(-2.47, .554, ROOF + .04), (-2.47, .554, ROOF + .38), (-2.20, .554, ROOF + .38)], .024, painted))
    platform = put(box(name + '.rear-platform', (-2.585, .24, .842), (.34, 2.98, .026), naval, col, .01))
    for py in [-1.10, .24, 1.58]:
        put(rod(name + '.platform-bracket', (-2.42, py, .60), (-2.74, py, .83), .028, naval, col, vertices=6))
    # Ready-use locker on the starboard quarter of the rear wall.
    put(box(name + '.rear-locker', (-2.66, -1.56, 1.90), (.48, .92, .65), naval, col, .04))
    put(rod(name + '.locker-stay', (-2.53, -1.56, 1.57), (-2.53, -1.56, .86), .026, edge, col, vertices=6))

    # Layers' sight hoods seated on the flanks, lying on the plate they cut.
    a, b = Vector((1.65, 1.40)), Vector((1.08, 1.87))
    tangent = (b - a).normalized()
    outward = Vector((tangent.y, -tangent.x))
    seat = a + (b - a)*.42
    for sign in [1, -1]:
        centre = seat + outward*.07
        hood = put(box(name + '.sight-hood', (centre.x, sign*centre.y, 1.23), (.26, .21, .43), naval, col, .03))
        hood.rotation_euler.z = sign*math.atan2(outward.y, outward.x)
        glass = put(box(name + '.sight-glass', (centre.x + outward.x*.06, sign*(centre.y + outward.y*.06), 1.30),
                        (.03, .13, .12), dark, col, .01))
        glass.rotation_euler.z = sign*math.atan2(outward.y, outward.x)

    # Roof: hatch coaming, and a grab rail down each side of the slot.
    put(box(name + '.roof-hatch', (-1.60, .73, ROOF + .07), (.86, .70, .14), roof, col, .03))
    for sign in [1, -1]:
        rail = [(-1.30, sign*1.18, ROOF + .20), (-.20, sign*1.18, ROOF + .20)]
        tube('roof-grab', rail, .020, edge)
        for p in rail:
            put(rod(name + '.roof-grab-foot', (p[0], p[1], ROOF - .01), p, .022, naval, col, vertices=6))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

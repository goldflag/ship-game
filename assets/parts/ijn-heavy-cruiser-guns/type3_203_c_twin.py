"""Original 20 cm/50 3rd Year Type twin, Model C, as carried by Aoba.

Visual proportions follow the approved GameModels3D pjsc007 AB1 artillery
(`jgm013_203mm50_type_c`, the mounting without turret rangefinder). No
reference geometry is loaded here. The catalog owns the closed armour shell
and the weapon data; this recipe draws that shell and adds the gun ports,
canvas bloomers, sliding barrels, roof furniture, perimeter railing and the
flank and rear ladders the reference shows.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .245           # chase radius through the canvas cuff
JACKET = .30            # sliding jacket radius at the trunnion
COLLAR = 1.782          # cuff station forward of the trunnion
PORT_HALF_Y = .42       # gun-port half width in the raked face
PORT_Z0, PORT_Z1 = .14, 1.94

# Roof knuckle, as a closed ring of (x, y, z) read off the reference's top
# edge.  The railing stands on it and the shoulder plate falls away from it.
KNUCKLE = [
    (-5.070, .00, 2.190), (-5.000, 1.01, 2.190), (-4.900, 1.40, 2.190),
    (-4.450, 2.42, 1.996), (-3.350, 2.54, 1.950), (-1.750, 2.83, 1.900),
    (-0.690, 3.02, 1.810), (0.170, 3.02, 1.760), (0.960, 3.02, 1.690),
    (1.390, 3.02, 1.650), (2.170, 2.245, 1.980), (2.295, 1.73, 2.120),
    (2.295, 1.34, 2.130), (2.295, .57, 2.130),
]


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

    # The visible gunhouse is exactly the catalog's armour shell, so the raked
    # face, the sloping shoulder and the flat crown stay aligned with their
    # protection.
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]
    # Rotating roller path under the gunhouse skirt; the ship owns the fixed
    # barbette below it.
    put(cyl(name + '.turntable', (0, 0, spec['gunhouseBaseHeight'] / 2), spec.get('rollerRadius', 2.76),
            spec['gunhouseBaseHeight'], edge, col, 40))

    def cast(origin, direction):
        hits = [intersect_ray_tri(*t, Vector(direction), Vector(origin)) for t in plates]
        return [h for h in hits if h is not None]

    def front_x(y, z):
        return max(h.x for h in cast((20, y, z), (-1, 0, 0)))

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else 0.0

    face_lean = -math.atan2(.27, 1.0)   # the front plate falls aft with height

    # --- guns -------------------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: jacket over the recoil stroke, a shoulder,
        # then the constant chase the reference leaves outside the bloomer.
        profile = [(.05, JACKET), (1.20, JACKET), (1.34, .262), (1.66, SLEEVE), (length, SLEEVE)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, SLEEVE), (length, bore), (length - .40, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .40, 0, 0), bore, dark, col, vertices=count), recoil)

    # --- front plate detail ----------------------------------------------
    for label, x_out, y, z, size, material in [
            ('face-door', .03, 2.00, .85, (.07, .60, .59), naval),
            ('face-door', .03, -2.00, .85, (.07, .60, .59), naval),
            ('face-panel', .03, .03, 1.04, (.06, .44, .62), naval)]:
        o = put(box(name + '.' + label, (front_x(y, z) + x_out, y, z), size, material, col))
        o.rotation_euler.y = face_lean
    # --- roof furniture ---------------------------------------------------
    # Plated panel on the crown between the guns; the reference sets it a
    # hand's breadth off the surrounding crown, drawn here as a raised plate.
    put(box(name + '.crown-panel', (1.655, 0, 2.248), (1.43, .92, .05), roof, col))

    # Gunlayer's periscope hood on the crown between the guns.
    put(box(name + '.sight-flange', (-.185, 0, 2.252), (.37, .32, .07), naval, col))
    put(box(name + '.sight-hood', (-.18, 0, 2.415), (.52, .44, .28), naval, col))
    put(box(name + '.sight-window', (.085, 0, 2.44), (.02, .22, .12), glass, col))

    # Raised trunk on the port shoulder, lying on the sloping plate. The
    # shoulder falls outboard, so the box leans the same way as the plate.
    fall = .257                                   # shoulder plate dz/dy outboard
    shoulder_lean = -math.atan(fall)
    trunk = put(box(name + '.shoulder-trunk', (-1.68, 2.00, 2.270), (1.62, 1.22, .34), naval, col))
    trunk.rotation_euler.x = shoulder_lean
    lid = put(box(name + '.shoulder-trunk-lid', (-1.68, 1.99, 2.470), (1.48, 1.10, .08), roof, col))
    lid.rotation_euler.x = shoulder_lean
    for dy in (-.46, .46):
        z = 2.505 - fall * dy
        put(rod(name + '.shoulder-trunk-cleat', (-2.30, 1.99 + dy, z), (-1.06, 1.99 + dy, z),
                .022, painted, col, vertices=4))

    # Perimeter railing standing on the roof knuckle; the rail is one run.
    ring = []
    for x, y, z in KNUCKLE:
        ring.append((x, y, z))
    ring = ring + [(x, -y, z) for x, y, z in reversed(ring) if abs(y) > 1e-6]
    tops = []
    for x, y, z in ring:
        inset = .04
        scale = 1 - inset / max(.2, math.hypot(x + 1.2, y))
        px, py = -1.2 + (x + 1.2) * scale, y * scale
        put(rod(name + '.rail-post', (px, py, z - .06), (px, py, z + .48), .024, painted, col, vertices=4))
        tops.append((px, py, z + .47))
    for a, b in zip(tops, tops[1:] + tops[:1]):
        put(rod(name + '.rail', a, b, .022, painted, col, vertices=4))

    # --- ladders ----------------------------------------------------------
    for sign in (1, -1):
        # Flank ladder to the knuckle, on standoffs off the vertical side plate.
        for x in (1.00, 1.30):
            put(rod(name + '.flank-ladder-rail', (x, sign * 3.055, .02), (x, sign * 3.055, 1.56), .024, painted, col, vertices=4))
            for z in (.06, .78, 1.50):
                put(rod(name + '.flank-ladder-standoff', (x, sign * 3.00, z), (x, sign * 3.055, z), .020, painted, col, vertices=4))
        for i in range(6):
            z = .02 + i * .296
            put(rod(name + '.flank-ladder-rung', (1.00, sign * 3.065, z), (1.30, sign * 3.065, z), .018, painted, col, vertices=4))

    # Rear ladder on the port quarter facet, rising to the rail gap.
    p, q = Vector((-5.07, .82)), Vector((-4.92, 1.46))
    tangent = (q - p).normalized()
    outward = Vector((-tangent.y, tangent.x))
    if outward.x > 0:
        outward = -outward
    for t in (.42, .88):
        foot = p + (q - p) * t + outward * .035
        put(rod(name + '.rear-ladder-rail', (foot.x, foot.y, .02), (foot.x, foot.y, 2.22), .024, painted, col, vertices=4))
        for z in (.06, .78, 1.51, 2.17):
            seat = p + (q - p) * t
            put(rod(name + '.rear-ladder-standoff', (seat.x, seat.y, z), (foot.x, foot.y, z), .020, painted, col, vertices=4))
    for i in range(7):
        z = .02 + i * .298
        a = p + (q - p) * .42 + outward * .07
        b = p + (q - p) * .88 + outward * .07
        put(rod(name + '.rear-ladder-rung', (a.x, a.y, z), (b.x, b.y, z), .018, painted, col, vertices=4))

    # --- canvas gun-port covers ------------------------------------------
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + PORT_HALF_Y * math.copysign(abs(math.cos(a)) ** .80, math.cos(a))
            zz = 1.04 + .90 * math.copysign(abs(math.sin(a)) ** .72, math.sin(a))
            seam.append((front_x(yy, zz) + .012, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .018,
                               rings=6, fold_depth=.028, slack=.045, fullness=.045)
        # A linear cloth loft cuts into the raked face at depression and can
        # cross the chase at high elevation. Drape the intermediate rings on
        # the armour and keep them outside the sliding sleeve, without moving
        # the fixed seam or the pitching cuff.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        sectors = int(cover['gunCoverFixedVertexCount'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < sectors or index >= len(key.data) - sectors:
                    continue
                plate = cast((20, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .03)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                clear = JACKET + .045
                if 0 < distance < clear:
                    for i in range(3):
                        point.co[i] += radial[i] * (clear / distance - 1)
        for vertex, base in zip(cover.data.vertices, cover.data.shape_keys.key_blocks[0].data):
            vertex.co = base.co

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

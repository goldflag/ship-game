"""Original Ise-class 35.6 cm twin gunhouse (Hyūga 1942), using the shared joint/plate builder.

Measured against the approved GameModels3D pjsb517 jgm191 visual: a lozenge plan widest at the
training axis, chamfered front corners and a shallow V back, side plates leaning inward about 15
degrees, and a gabled roof whose ridge rises from 1.73 m over the inclined face plate to 2.64 m at
the back. Turret-local metres: +X forward, +Y port, +Z up, with the yaw datum on the gunhouse floor.
The trunnions stand 0.84 m above the floor, 2.6 m ahead of the training axis.
"""
import math
import bpy
from blender_components import create_gun_mount
from blender_barrels import barrel_layout

# Cross-section rings, front to back: (base x, base half-width), (eave x, eave half-width, eave height),
# (ridge x, ridge height). The first ring is the inclined face plate.
RINGS = [((3.95, 1.71), (3.45, 1.64, 1.55), (3.39, 1.73)),
         ((2.89, 3.27), (2.45, 2.80, 1.50), (2.45, 1.86)),
         ((.30, 4.30), (.30, 3.80, 1.58), (.30, 2.14)),
         ((-3.00, 3.80), (-3.00, 3.28, 2.00), (-3.00, 2.58)),
         ((-5.93, 3.31), (-5.90, 2.81, 2.20), (-5.90, 2.64)),
         ((-6.81, .73), (-6.79, .76, 2.40), (-6.85, 2.63))]
FACE_SLOPE = (3.95 - 3.45) / 1.55     # face plate set back per metre of height


def front_x(y, z):
    """The inclined face plate's x at height z (for |y| within its 1.7 m half-width)."""
    return 3.95 - FACE_SLOPE * z


def _interp(pairs, x):
    pairs = sorted(pairs)
    if x <= pairs[0][0]:
        return pairs[0][1]
    if x >= pairs[-1][0]:
        return pairs[-1][1]
    for (a, va), (b, vb) in zip(pairs, pairs[1:]):
        if a <= x <= b:
            return va + (vb - va) * (x - a) / (b - a)


def ridge_z(x):
    return _interp([(r[2][0], r[2][1]) for r in RINGS], x)


def eave(x):
    """(half-width, height) of the eave at x."""
    return _interp([(r[1][0], r[1][1]) for r in RINGS], x), _interp([(r[1][0], r[1][2]) for r in RINGS], x)


def roof_z(x, y):
    """Height of the gabled roof at (x, y)."""
    w, h = eave(x)
    r = ridge_z(x)
    return r - (r - h) * min(1.0, abs(y) / max(w, 1e-6))


def half_width(x, z):
    """Side plate's half-width at (x, z) below the eave."""
    base = _interp([(r[0][0], r[0][1]) for r in RINGS], x)
    w, h = eave(x)
    return base + (w - base) * min(1.0, max(0.0, z / h))


def gunhouse_shape():
    """Closed armoured shell: face plate 305 mm, sides and back 229 mm, roof 152 mm, floor 25 mm."""
    vs = []
    faces = []

    def vertex(p):
        p = [round(v, 6) for v in p]
        if p not in vs:
            vs.append(p)
        return vs.index(p)

    def tri(label, a, b, c, mm, finish='naval'):
        faces.append(dict(id=label, indices=[a, b, c], thicknessMm=mm, material='steel', finish=finish))
    rings = []
    for (bx, bw), (ex, ew, eh), (rx, rh) in RINGS:
        rings.append([vertex((bx, bw, 0)), vertex((ex, ew, eh)), vertex((rx, 0, rh)), vertex((ex, -ew, eh)), vertex((bx, -bw, 0))])
    n = len(rings)
    # Face plate (ring 0) and back (last ring): pentagons, wound outward.
    f = rings[0]
    for i, (a, b, c) in enumerate([(f[0], f[1], f[4]), (f[1], f[3], f[4]), (f[1], f[2], f[3])]):
        tri(f'face-{i}', a, b, c, 305)
    r = rings[-1]
    for i, (a, b, c) in enumerate([(r[0], r[4], r[1]), (r[1], r[4], r[3]), (r[1], r[3], r[2])]):
        tri(f'back-{i}', a, b, c, 229)
    # Sides and roof between consecutive rings; roof panels take the roof finish.
    for j in range(n - 1):
        a, c = rings[j], rings[j + 1]
        for k in range(4):
            p, q, s, t = a[k], a[k + 1], c[k + 1], c[k]
            roof = k in (1, 2)
            mm = 152 if roof else 229
            finish = 'roof' if roof else 'naval'
            tri(f'{"roof" if roof else "side"}-{j}-{k}-a', p, t, s, mm, finish)
            tri(f'{"roof" if roof else "side"}-{j}-{k}-b', p, s, q, mm, finish)
    # Floor: fan over the base outline (convex), wound downward.
    base = [rings[j][0] for j in range(n)] + [rings[j][4] for j in reversed(range(n))]
    for i in range(1, len(base) - 1):
        tri(f'floor-{i}', base[0], base[i + 1], base[i], 25)
    # Check the winding: every face normal points away from the centroid.
    cx = sum(v[0] for v in vs) / len(vs)
    cz = sum(v[2] for v in vs) / len(vs)
    for face in faces:
        a, b, c = (vs[i] for i in face['indices'])
        u = [b[k] - a[k] for k in range(3)]
        w = [c[k] - a[k] for k in range(3)]
        nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        mid = [(a[k] + b[k] + c[k]) / 3 for k in range(3)]
        out = [mid[0] - cx, mid[1], mid[2] - cz]
        if sum(nrm[k] * out[k] for k in range(3)) < 0:
            face['indices'] = [face['indices'][0], face['indices'][2], face['indices'][1]]
    return dict(version=1, vertices=vs, faces=faces,
                provenance=dict(sourceId='gamemodels3d-pjsb517-jgm191', basis='estimated',
                                note='Original reconstruction from plan and cross-section cuts of the approved model. Armour thicknesses are provisional game calibration.'))


def create_mount(mount, col, helpers, mats):
    spec = mount['weapon']
    name = mount['id']
    house = create_gun_mount(mount, col, helpers, mats, lambda x: mount['position'][1])
    yaw = next(o for o in col.objects if o.get('nodeId') == name + '.yaw')
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    canvas = mats['canvas']

    def own(o):
        o.parent = yaw
        o['assemblyId'] = name
        return o

    def bar(label, a, b, r=.026, material=None, n=8):
        return own(rod(name + '.' + label, a, b, r, material or mats['edge'], col, vertices=n))
    # The ship owns the barbette. Keep only a shallow annular bearing under the gunhouse floor whose
    # underside is the support plane (local Z = -0.25).
    for o in list(col.objects):
        if o.get('assemblyId') != name or not any(k in o.name for k in [' • armored barbette', ' • roller race']):
            continue
        if ' • armored barbette' in o.name:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        old = o.data
        r = max(math.hypot(v.co.x, v.co.y) for v in old.vertices)
        lo = min(v.co.z for v in old.vertices)
        hi = max(v.co.z for v in old.vertices)
        n = 64
        profile = [(r, lo), (r, hi), (3.95, hi), (3.95, lo)]
        verts = [(rr * math.cos(i * math.tau / n), rr * math.sin(i * math.tau / n), z) for rr, z in profile for i in range(n)]
        faces = [(j * n + i, j * n + (i + 1) % n, ((j + 1) % 4) * n + (i + 1) % n, ((j + 1) % 4) * n + i) for j in range(4) for i in range(n)]
        data = bpy.data.meshes.new(o.name + ' annular support')
        data.from_pydata(verts, [], faces)
        data.update()
        for material in old.materials:
            data.materials.append(material)
        for face in data.polygons:
            face.use_smooth = face.index // n in [0, 2]
        o.data = data
        if old.users == 0:
            bpy.data.meshes.remove(old)
    # Skirt ring round the foot of the gunhouse, turning with it.
    ring_pts = 72
    vv, ff = [], []
    for rr, zz in [(4.46, -.02), (4.46, .16), (4.30, .16), (4.30, -.02)]:
        for i in range(ring_pts):
            a = i * math.tau / ring_pts
            vv.append((rr * math.cos(a), rr * math.sin(a), zz))
    ff = [(j * ring_pts + i, j * ring_pts + (i + 1) % ring_pts, ((j + 1) % 4) * ring_pts + (i + 1) % ring_pts, ((j + 1) % 4) * ring_pts + i) for j in range(4) for i in range(ring_pts)]
    skirt = own(mesh(name + '.gunhouse skirt', vv, ff, mats['naval'], col, True))
    skirt.location = (0, 0, 0)
    T, H = spec['trunnionForward'], spec['pivotHeight']
    # Turned barrels with blast bags replace the shared mantlets; the yaw/elevation/recoil/socket chains stay.
    for side, gy, _ in barrel_layout(spec):
        elevation = next(o for o in col.objects if o.get('nodeId') == name + '.' + side + '.elevation')
        recoil = next(o for o in col.objects if o.get('nodeId') == name + '.' + side + '.recoil')
        for o in list(recoil.children):
            if o.type == 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)

        def local(o, parent):
            o.parent = parent
            o['assemblyId'] = name
            return o
        profile = [(T - .75, .50), (5.3, .50), (7.4, .50), (7.45, .46), (10.8, .39),
                   (spec['muzzleForward'], .305), (spec['muzzleForward'], .178), (spec['muzzleForward'] - .65, .178)]
        n = 24
        vs = [(x - T, r * math.cos(i * math.tau / n), r * math.sin(i * math.tau / n)) for x, r in profile for i in range(n)]
        fs = [(j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i) for j in range(len(profile) - 1) for i in range(n)]
        fs.append(tuple(reversed(range((len(profile) - 1) * n, len(profile) * n))))
        barrel = local(mesh(name + '.' + side + '.turned-barrel', vs, fs, mats['naval'], col, True), recoil)
        barrel.data.materials.append(mats['dark'])
        for p in barrel.data.polygons:
            if p.index >= 6 * n:
                p.material_index = 1
        barrel.data.set_sharp_from_angle(angle=math.radians(35))
        # Locking bands ahead of the bag recoil with the barrel.
        for x in [5.9, 6.5, 7.1]:
            local(rod(name + '.barrel-locking-band', (x - T - .05, 0, 0), (x - T + .05, 0, 0), .54, mats['naval'], col, vertices=16), recoil)
            for sign in [-1, 1]:
                local(box(name + '.barrel-band-lug', (x - T, sign * .5, .13), (.15, .1, .2), mats['edge'], col), recoil)
        # Fixed bearing cheeks and trunnion pins connect the gun to the floor; recoil slides through them.
        for sign in [-1, 1]:
            y = gy + sign * .66
            own(box(name + '.bearing-post', (T, y, H / 2), (.38, .19, H), mats['naval'], col))
            own(rod(name + '.bearing-cap', (T, y - .09, H), (T, y + .09, H), .19, mats['naval'], col, vertices=16))
            local(rod(name + '.trunnion-pin', (0, sign * .48, 0), (0, sign * .66, 0), .13, mats['edge'], col, vertices=16), elevation)
        # Blast bag: a square seam round the port on the face plate, pitching with the gun at its collar.
        rings = 9
        sectors = 32
        collar_x = 5.25
        collar_radius = .515

        def cover_points(degrees):
            theta = math.radians(degrees)
            c, s = math.cos(theta), math.sin(theta)
            result = []
            for j in range(rings):
                t = j / (rings - 1)
                for i in range(sectors):
                    a = i * math.tau / sectors
                    ca, sa = math.cos(a), math.sin(a)
                    m = max(abs(ca), abs(sa))
                    z0 = H + .7 * sa / m
                    y0 = .6 * ca / m
                    x0 = min(front_x(gy + y0, z0), 3.45 - (z0 - 1.55) * .3) - .01
                    along = collar_x - T
                    up = collar_radius * sa
                    end = (T + along * c - up * s, gy + collar_radius * ca, H + along * s + up * c)
                    p = [x0 + (end[0] - x0) * t, gy + y0 + (end[1] - gy - y0) * t, z0 + (end[2] - z0) * t]
                    fold = math.sin(math.pi * t) * (.065 + .035 * math.sin(a * 7 + t * 4))
                    p[1] += fold * ca
                    p[2] += fold * sa - .10 * math.sin(math.pi * t)
                    result.append(p)
            return result
        fs = [(j * sectors + i, j * sectors + (i + 1) % sectors, (j + 1) * sectors + (i + 1) % sectors, (j + 1) * sectors + i)
              for j in range(rings - 1) for i in range(sectors)]
        cover = own(mesh(name + '.' + side + '.canvas-bag', cover_points(-5), fs, canvas, col, True))
        cover['nodeId'] = name + '.' + side + '.cover'
        cover['gunCoverElevationId'] = name + '.' + side + '.elevation'
        cover['gunCoverBaseAngle'] = -5.0
        cover['gunCoverAngles'] = [float(a) for a in range(0, 46, 5)]
        cover.shape_key_add(name='Basis')
        for angle in range(0, 46, 5):
            shape = cover.shape_key_add(name='Elevation ' + str(angle))
            for v, p in zip(shape.data, cover_points(angle)):
                v.co = p
            driver = shape.driver_add('value').driver
            driver.type = 'SCRIPTED'
            var = driver.variables.new()
            var.name = 'pitch'
            var.type = 'TRANSFORMS'
            target = var.targets[0]
            target.id = elevation
            target.transform_type = 'ROT_Y'
            target.transform_space = 'LOCAL_SPACE'
            driver.expression = f'max(0,1-abs(-pitch*57.29577951308232-{angle})/5)'
        # A continuous turned seam at the bag's collar.
        vs, fs = [], []
        for i in range(sectors):
            angle = i * math.tau / sectors
            for j in range(4):
                around = j * math.tau / 4
                r = collar_radius + .018 * math.cos(around)
                vs.append((collar_x - T + .018 * math.sin(around), r * math.cos(angle), r * math.sin(angle)))
        for i in range(sectors):
            for j in range(4):
                fs.append((i * 4 + j, ((i + 1) % sectors) * 4 + j, ((i + 1) % sectors) * 4 + (j + 1) % 4, i * 4 + (j + 1) % 4))
        local(mesh(name + '.canvas-collar', vs, fs, canvas, col, True), elevation)
    # Seat the shared hatches on the gabled roof.
    for o in col.objects:
        if o.parent == yaw and 'roof hatch' in o.name:
            o.location.z = roof_z(o.location.x, o.location.y) + .065
    # Sight hoods at the roof's front corners, with their hinged covers, and a small centre hood.
    for index, (x, y, length, width) in enumerate([(2.45, 1.95, .95, .5), (2.45, -1.95, .95, .5), (2.75, 0, .7, .4)]):
        front = x + length / 2
        rear = x - length / 2
        z = roof_z(front, y) + .24
        n = 20
        vs = []
        for xx, ry, rz, cz, power in [(rear, width * .46, .07, roof_z(rear, y) + .06, .4), (front - .12, width / 2, .23, z, .4),
                                       (front, width / 2, .2, z, .4), (front, width / 2 - .045, .15, z, .4), (front - .12, width / 2 - .045, .15, z, .4)]:
            for i in range(n):
                a = i * math.tau / n
                ca, sa = math.cos(a), math.sin(a)
                vs.append((xx, y + ry * math.copysign(abs(ca) ** power, ca), cz + rz * math.copysign(abs(sa) ** power, sa)))
        fs = [tuple(reversed(range(n)))]
        fs += [(r * n + i, r * n + (i + 1) % n, (r + 1) * n + (i + 1) % n, (r + 1) * n + i) for r in range(4) for i in range(n)]
        own(mesh(name + '.sight-cowl-' + str(index + 1), vs, fs, mats['naval'], col, True))
        own(box(name + '.sight-recess', (front - .135, y, z), (.04, width - .08, .31), mats['dark'], col))
        own(rod(name + '.sight-objective', (front - .125, y, z), (front - .105, y, z), .073, mats.get('glass', mats['dark']), col, vertices=16))
        if index < 2:
            # The open cover stands hinged up behind the hood.
            hx = rear - .05
            hz = roof_z(hx, y) + .02
            flap = own(box(name + '.sight-cover', (hx - .05, y, hz + .28), (.05, width + .06, .56), mats['naval'], col))
            flap.rotation_euler.y = math.radians(-18)
    # Periscope hood at the back of the roof, with its post.
    px = -5.35
    pz = ridge_z(px) - .03
    own(cyl(name + '.periscope-hood', (px, 0, pz + .21), .5, .42, mats['naval'], col, 24))
    own(cyl(name + '.periscope-cap', (px, 0, pz + .45), .54, .06, mats['naval'], col, 24))
    bar('periscope-post', (px + .1, -.62, roof_z(px + .1, -.62) - .02), (px + .1, -.62, pz + .72), .06, mats['naval'], 10)
    # Face-plate ladder between the bags, returning onto the roof.
    for yy in (-.29, .29):
        a = (front_x(yy, .05) + .065, yy, .05)
        b = (front_x(yy, 1.5) + .065, yy, 1.5)
        bar('front-ladder-stile', a, b, .024)
        bar('front-ladder-return', b, (2.9, yy, ridge_z(2.9) + .06), .024)
    for z in (.2, .45, .7, .95, 1.2, 1.45):
        x = front_x(0, z) + .065
        bar('front-ladder-rung', (x, -.29, z), (x, .29, z), .021)
    # Rear ladders on the back's chamfers.
    for side in (-1, 1):
        y = side * 1.9
        x0 = _interp([(0, -6.81), (.73, -6.81), (3.31, -5.93)], abs(y)) - .06
        for z in (.35, .7, 1.05, 1.4, 1.75, 2.1):
            bar('ladder-rung', (x0, y - .27, z), (x0, y + .27, z))
        for yy in (y - .29, y + .29):
            bar('ladder-stile', (x0, yy, .05), (x0, yy, 2.25))
    return house

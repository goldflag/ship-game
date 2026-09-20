"""Original BL 15-inch Mk I twin mounting, the Queen Elizabeth main turret.

Visual proportions follow the approved GameModels3D pbsb106 15-inch artillery
(`bgm009_15in42_mk1`, and `bgm010_15in42_mk1_rf` for the rangefinder turrets).
No reference geometry is loaded here. The catalog owns the closed armor shell
and the weapon data; this recipe draws that shell and adds the turntable skirt,
sliding guns, canvas port covers and the service fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .50   # sliding jacket radius through the canvas cuff
COLLAR = 3.60  # cuff station forward of the trunnion


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
    part = mount.get('partId', spec['id'])

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

    # The visible gunhouse is exactly the catalog's armor shell, so the sloped
    # flanks, cambered roof and raked face stay aligned with their protection.
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

    def front_x(y, z, default=0.0):
        hits = cast((30, y, z), (-1, 0, 0))
        return max(h.x for h in hits) if hits else default

    def rear_x(y, z, default=0.0):
        hits = cast((-30, y, z), (1, 0, 0))
        return min(h.x for h in hits) if hits else default

    def top_z(x, y, default=0.0):
        hits = cast((x, y, 30), (0, 0, -1))
        return max(h.z for h in hits) if hits else default

    def side_y(x, z, default=0.0):
        hits = cast((x, 30, z), (0, -1, 0))
        return max(h.y for h in hits) if hits else default

    def face_plane(y0, z0):
        """Local plane of the raked face beside one gun, from samples that are safely on it."""
        step = .35
        origin = front_x(y0, z0)
        along_z = (front_x(y0, z0 + step) - origin) / step
        along_y = (front_x(y0 + math.copysign(step, y0 or 1), z0) - origin) / step * math.copysign(1, y0 or 1)
        return origin - along_y * y0 - along_z * z0, along_y, along_z

    def face_x(y, z, plane):
        """Face station for cloth and port rings: the plate where it is reachable, the plane elsewhere."""
        estimate = plane[0] + plane[1] * y + plane[2] * z
        near = [h.x for h in cast((30, y, z), (-1, 0, 0)) if abs(h.x - estimate) < .16]
        return max(near) if near else estimate

    def prism(label, stations, material, smooth=False):
        """Closed solid through rings of (y, z) points given counter-clockwise, lofted along x."""
        k = len(stations[0][1])
        points = [(x, y, z) for x, ring in stations for y, z in ring]
        faces = [tuple(reversed(range(k))), tuple(range((len(stations) - 1) * k, len(stations) * k))]
        for s in range(len(stations) - 1):
            a, b = s * k, (s + 1) * k
            faces += [(a + i, a + (i + 1) % k, b + (i + 1) % k, b + i) for i in range(k)]
        return put(mesh(name + '.' + label, points, faces, material, col, smooth))

    # Rotating sole: a short vertical skirt under the shell floor, on the plan
    # of the armor itself, so the rear quarters overhang the barbette as they do
    # on the real mounting. The ship owns everything below the sole plane.
    base = spec.get('gunhouseBaseHeight', .14)
    rim = {}
    for v in shape['vertices']:
        if abs(v[2] - base) < 1e-6:
            rim.setdefault(round(v[0], 3), []).append(v[1])
    order = sorted(rim)
    loop = [(x, max(rim[x])) for x in order] + [(x, min(rim[x])) for x in reversed(order)]
    k = len(loop)
    put(mesh(name + '.turntable', [(x, y, 0.0) for x, y in loop] + [(x, y, base + .02) for x, y in loop],
             [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
             + [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)], naval, col))

    # Guns: a constant jacket long enough for the canvas cuff through full
    # recoil, a shoulder, then the tapering chase and the muzzle rim.
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    jacket = spec.get('barrelBaseRadius', SLEEVE)
    vanguard = part in ('bl-15-mki-vanguard-twin', 'bl-15-mki-vanguard-twin-rf')
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        profile = ([(.55, jacket), (4.14, jacket), (4.22, .44), (7.54, .385), (length, .33)] if vanguard
                   else [(.55, jacket), (4.85, jacket), (4.93, .44), (8.10, .375), (length, .325)])
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim_profile = [(length, .33 if vanguard else .325), (length, bore), (length - .40, bore)]
        rim_points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                      for x, r in rim_profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim_points, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .40, 0, 0), bore, dark, col, vertices=count), recoil)

    # Gun-port surrounds: a shallow armored ring standing proud of the raked
    # face, each vertex seated on the plate so the ring follows the rake.
    planes = {}
    for side, y, _ in ([] if vanguard else barrel_layout(spec)):
        pivot = spec['pivotHeight']
        plane = planes[side] = face_plane(y, pivot)
        outer = [(y + .84 * math.cos(i * math.tau / 12), pivot + .92 * math.sin(i * math.tau / 12)) for i in range(12)]
        points = [(face_x(yy, zz, plane) - .05, yy, zz) for yy, zz in outer]
        points += [(face_x(yy, zz, plane) + .08, y + (yy - y) * .80, pivot + (zz - pivot) * .80) for yy, zz in outer]
        faces = [(i, (i + 1) % 12, (i + 1) % 12 + 12, i + 12) for i in range(12)]
        put(mesh(name + '.port-ring', points, faces, naval, col))

    # Pleated canvas port covers. The fixed seam is cast onto the real face so
    # it stays seated on the rake; the cuff rides the constant jacket through
    # elevation and recoil.
    for side, y, _ in ([] if vanguard else barrel_layout(spec)):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .68 * math.copysign(abs(math.cos(a)) ** .80, math.cos(a))
            zz = spec['pivotHeight'] + .06 + .82 * math.copysign(abs(math.sin(a)) ** .70, math.sin(a))
            seam.append((face_x(yy, zz, planes[side]) + .05, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .02, rings=5, slack=.10, fullness=.16)
        # A linear cloth loft cuts under the face at depression and can cross
        # the jacket at high elevation. Drape the intermediate rings over the
        # armor and keep them outside the sliding sleeve, without moving the
        # fixed seam or the pitching cuff.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < 20 or index >= 80:
                    continue
                plate = cast((30, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .04)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < SLEEVE + .05:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .05) / distance - 1)
        # At full depression the slack hangs below the sole plane; the ship owns
        # everything under it, so the folds stop just above the turntable.
        for point in cover.data.vertices:
            point.co.z = max(point.co.z, .03)
        for key in cover.data.shape_keys.key_blocks:
            for point in key.data:
                point.co.z = max(point.co.z, .03)

    def loft_y(label, ya, yb, ring, material):
        """Closed solid through one ring of (x, z) points given counter-clockwise, extruded across y."""
        n = len(ring)
        points = [(x, y, z) for y in (ya, yb) for x, z in ring]
        faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
        faces += [((i + 1) % n, i, i + n, (i + 1) % n + n) for i in range(n)]
        if yb < ya:
            faces = [tuple(reversed(f)) for f in faces]
        return put(mesh(name + '.' + label, points, faces, material, col))

    # Sight and periscope cowls on the roof: a rounded hood open to the front,
    # each seated on the roof plate it stands on, with its guard rail behind.
    def cowl(label, x0, x1, yc, half, rise0, rise1):
        rings = []
        for x, rise in [(x0, rise0), (x1, rise1)]:
            ring = []
            for i in range(9):
                t = math.pi * i / 8
                dy = half * math.cos(t)
                ring.append((yc + dy, top_z(x, yc + dy) - .04 + rise * math.sin(t)))
            rings.append((x, ring))
        prism(label, rings, naval)
        put(box(name + '.' + label + '-aperture', (x1 + .02, yc, top_z(x1, yc) + rise1 * .52),
                (.03, half * 1.05, rise1 * .60), dark, col))
        for sign in [1, -1]:
            post = (x0 - .12, yc + sign * half * .95)
            put(rod(name + '.' + label + '-rail-post', (post[0], post[1], top_z(*post) - .02),
                    (post[0], post[1], top_z(*post) + .34), .022, painted, col, vertices=4))
        put(rod(name + '.' + label + '-rail', (x0 - .12, yc + half * .95, top_z(x0 - .12, yc + half * .95) + .33),
                (x0 - .12, yc - half * .95, top_z(x0 - .12, yc - half * .95) + .33), .022, painted, col, vertices=4))

    if vanguard:
        # The Vanguard mountings seal each port with a rigid circular shield
        # instead of canvas. The drum is struck about the trunnion, so the bore
        # leaves it at the same radius through the whole elevation arc; it is
        # cut off at the sole, which costs nothing because the face covers
        # everything below the aperture. A square cover plate rides the bore.
        pivot, radius = spec['pivotHeight'], 1.30
        axis, centre = pivot - .03, spec['trunnionForward'] + 1.09
        low = math.asin(max(-1.0, (.02 - axis) / radius))
        drum = [(centre + radius * math.cos(low + (math.pi - 2 * low) * i / 20),
                 axis + radius * math.sin(low + (math.pi - 2 * low) * i / 20)) for i in range(21)]
        for side, y, _ in barrel_layout(spec):
            loft_y('port-shield', y - .645, y + .645, drum, naval)
            elevation = next(o for o in col.objects if o.get('nodeId') == name + '.' + side + '.elevation')
            put(cyl(name + '.port-boss', (2.05, 0, 0), .78, .30, naval, col, 16, .62),
                elevation).rotation_euler.y = math.pi / 2
            put(cyl(name + '.port-boss-rim', (2.22, 0, 0), .63, .06, edge, col, 16),
                elevation).rotation_euler.y = math.pi / 2
        # Raised hoods over the gun ports, the Vanguard's most obvious
        # difference from the Queen Elizabeth roof.
        for side, y, _ in barrel_layout(spec):
            rings = []
            for x, half, rise in [(2.45, .60, .28), (2.90, .62, .56), (3.40, .66, .46), (3.90, .62, .34), (4.20, .48, .14)]:
                ring = []
                for i in range(7):
                    t = math.pi * i / 6
                    dy = half * math.cos(t)
                    ring.append((y + dy, top_z(x, y + dy) - .05 + rise * math.sin(t)))
                rings.append((x, ring))
            prism('port-hood', rings, roof)
        cowl('sight-hood', 1.56, 2.29, -.185, .175, .30, .34)
        for sign in [1, -1]:
            cowl('periscope-hood' + ('-port' if sign > 0 else '-starboard'), 1.94, 2.67, sign * 2.36, .175, .30, .34)
        # Rear roof: the vent stack and the flush hatch on the raised aft plate.
        put(cyl(name + '.roof-vent', (-5.92, .99, top_z(-5.92, .99) + .20), .15, .46, naval, col, 10))
        put(cyl(name + '.roof-vent-cap', (-5.92, .99, top_z(-5.92, .99) + .44), .18, .06, painted, col, 10))
        put(cyl(name + '.roof-hatch', (-4.50, .49, top_z(-4.50, .49) + .10), .17, .26, naval, col, 10))
        # Rear-quarter lockers with the hose runs dropping down the quarter.
        for sign in [1, -1]:
            put(box(name + '.quarter-locker', (-6.77, sign * 2.29, 1.80), (.46, .88, .57), naval, col))
            for offset in [-.30, 0, .30]:
                y = sign * (2.29 + offset)
                put(rod(name + '.quarter-hose', (rear_x(y, 1.50) - .015, y, 1.50),
                        (rear_x(y, .45) - .015, y, .45), .022, painted, col, vertices=4))
        # Access ladders up both flanks, hooking over the roof knuckle.
        for sign in [1, -1]:
            stringers = [-1.70, -1.31]
            for x in stringers:
                path = [(sign * (side_y(x, .30) + .05), .30), (sign * (side_y(x, 2.12) + .05), 2.12),
                        (sign * 3.30, top_z(x, sign * 3.30) + .07)]
                for (ya, za), (yb, zb) in zip(path, path[1:]):
                    put(rod(name + '.flank-ladder-rail', (x, ya, za), (x, yb, zb), .026, painted, col, vertices=4))
                for z in [.42, 1.10, 1.80]:
                    put(rod(name + '.flank-ladder-standoff', (x, sign * (side_y(x, z) - .01), z),
                            (x, sign * (side_y(x, z) + .05), z), .02, painted, col, vertices=4))
            for i in range(8):
                z = .40 + i * .24
                y = sign * (side_y(-1.50, z) + .05)
                put(rod(name + '.flank-ladder-rung', (stringers[0], y, z), (stringers[1], y, z), .018, painted, col, vertices=4))
        span = spec.get('rangefinderWidth')
        if span:
            # Boxy rangefinder: the plinth on the aft roof, the tall central
            # hood, and an arm each side out to its squared end housing.
            station, tip = spec.get('rangefinderForward', -5.25), span / 2
            prism('rangefinder-plinth', [(x, [(2.47, 2.54), (2.47, 2.86), (-2.47, 2.86), (-2.47, 2.54)])
                                         for x in (station - 1.17, station + 1.18)], roof)
            hood = [(station - 1.07, 2.38, 3.67), (station + .16, 2.38, 3.67), (station + 1.07, 2.38, 3.30)]
            prism('rangefinder-hood', [(x, [(hw, 2.60), (hw, zt - .18), (hw - .46, zt), (-(hw - .46), zt),
                                            (-hw, zt - .18), (-hw, 2.60)]) for x, hw, zt in hood], naval)
            for sign in [1, -1]:
                arm = [(station - .62, 2.77, 3.40), (station + .80, 2.77, 3.40)]
                prism('rangefinder-arm', [(x, [(sign * tip, zb), (sign * tip, zt), (sign * 2.35, zt), (sign * 2.35, zb)])
                                          for x, zb, zt in arm][::sign], naval)
                loft_y('rangefinder-head', sign * 3.85, sign * tip,
                       [(station - .78, 2.72), (station - .06, 2.72), (station - .06, 3.48), (station - .78, 3.48)], naval)
                put(box(name + '.rangefinder-window', (station - .77, sign * (tip + 3.85) / 2, 3.10),
                        (.05, .40, .44), dark, col))
        a, b, c = mount['position']
        yaw.location = (-c, -a, b)
        yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
        return yaw

    if part == 'bl-15-mkii-twin':
        # The Mk II carries no roof cowls: the working space is under one long
        # rear hood with its raised side panels, the sighting drum on top and
        # the transverse bar that overhangs both flanks.
        hood = [(-3.24, 2.92, 2.66), (-3.64, 3.11, 3.30), (-4.54, 3.11, 3.69),
                (-5.39, 3.11, 3.69), (-5.70, 3.06, 3.45), (-5.77, 2.94, 3.07)]
        prism('rear-hood', [(x, [(hw, 2.50), (hw, zt - .16), (hw - .58, zt), (-(hw - .58), zt),
                                 (-hw, zt - .16), (-hw, 2.50)]) for x, hw, zt in hood], roof)
        corner, panel = .22, []
        for x, z in [(-5.68, 2.57), (-4.32, 2.57), (-4.26, 2.63), (-4.26, 3.60), (-4.32, 3.66),
                     (-5.68, 3.66), (-5.74, 3.60), (-5.74, 2.63)]:
            panel.append((x, z))
        for sign in [1, -1]:
            loft_y('hood-panel', sign * 3.04, sign * 3.15, panel, naval)
        # Sighting drum, its visor, the crown stub and the small stubs on the
        # hood's forward slope.
        put(cyl(name + '.hood-sight-drum', (-4.55, -.62, 3.52), .41, .46, naval, col, 12))
        put(cyl(name + '.hood-sight-cap', (-4.55, -.62, 3.79), .30, .10, naval, col, 12))
        put(box(name + '.hood-sight-visor', (-4.16, -.62, 3.56), (.28, .52, .22), dark, col))
        put(box(name + '.hood-sight-step', (-4.08, -.62, 3.35), (.52, .84, .10), painted, col))
        put(cyl(name + '.hood-crown-stub', (-4.72, 0, 3.80), .10, .34, painted, col, 8))
        for y in [-1.02, -0.62, -0.22]:
            put(box(name + '.hood-slope-stub', (-3.86, y, 3.38), (.15, .11, .22), painted, col))
        # Outrigger brackets: a strut off each roof knuckle carrying the small
        # standing box and the outboard step tab of the reference.
        for sign in [1, -1]:
            heel = (-4.35, sign * 3.55)
            put(rod(name + '.outrigger', (heel[0], heel[1], top_z(*heel)), (-4.35, sign * 4.72, 2.96),
                    .05, painted, col, vertices=6))
            put(box(name + '.outrigger-post', (-4.31, sign * 4.29, 3.24), (.23, .33, .59), painted, col))
            put(box(name + '.outrigger-step', (-4.35, sign * 4.45, 2.97), (.10, .69, .09), painted, col))
        # Roof handrail: light stanchions on the roof camber under one rail
        # that runs from the hood to the forward roof edge.
        for sign in [1, -1]:
            rail = []
            for x in [-4.42, -3.10, -1.00, 1.20, 3.09]:
                y = sign * 2.62
                top = 3.61 - .0866 * (x + 4.42)
                rail.append((x, y, top))
                if x > -4.42:
                    put(rod(name + '.roof-rail-post', (x, y, top_z(x, y) - .02), (x, y, top),
                            .022, painted, col, vertices=4))
            for a, b in zip(rail, rail[1:]):
                put(rod(name + '.roof-rail', a, b, .018, painted, col, vertices=4))
            put(cyl(name + '.roof-rail-head', rail[-1], .035, .07, painted, col, 8))
        # One ladder up the raked stern, port of the centreline.
        stern, foot, head = [.70, 1.08], .30, 2.30
        seats = {y: (rear_x(y, foot) - .05, rear_x(y, head) - .05) for y in stern}

        def stern_x(y, z):
            return seats[y][0] + (seats[y][1] - seats[y][0]) * (z - foot) / (head - foot)

        for y in stern:
            path = [(stern_x(y, .16), .16), (stern_x(y, 2.62), 2.62), (stern_x(y, 2.62) + .30, 3.40)]
            for (xa, za), (xb, zb) in zip(path, path[1:]):
                put(rod(name + '.stern-ladder-rail', (xa, y, za), (xb, y, zb), .026, painted, col, vertices=4))
            put(cyl(name + '.stern-ladder-head', (stern_x(y, 2.62) + .30, y, 3.42), .034, .07, painted, col, 8))
            for z in [.40, 1.30, 2.20]:
                put(rod(name + '.stern-ladder-standoff', (rear_x(y, z) + .01, y, z), (stern_x(y, z), y, z),
                        .02, painted, col, vertices=4))
        for i in range(10):
            z = .28 + i * .25
            put(rod(name + '.stern-ladder-rung', (stern_x(stern[0], z), stern[0], z),
                    (stern_x(stern[1], z), stern[1], z), .018, painted, col, vertices=4))
        a, b, c = mount['position']
        yaw.location = (-c, -a, b)
        yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
        return yaw

    cowl('sight-hood', 1.92, 2.96, 0, .28, .46, .52)
    for sign in [1, -1]:
        cowl('periscope-hood' + ('-port' if sign > 0 else '-starboard'), 2.06, 2.76, sign * 2.32, .19, .30, .34)

    # Raised rear roof plate: a wedge that rises aft over the working space,
    # with the flush round hatch and the hinged hatch let into its crest.
    rear_plate = [(-3.83, 2.44, 2.50), (-4.60, 2.44, 3.06), (-5.03, 2.44, 3.17),
                  (-5.62, 2.44, 3.15), (-5.84, .95, 3.00)]
    stations = []
    for x, hw, zt in rear_plate:
        stations.append((x, [(hw, 2.40), (hw, zt - .10), (hw - .12, zt), (-(hw - .12), zt), (-hw, zt - .10), (-hw, 2.40)]))
    prism('rear-roof-plate', stations, roof)
    put(cyl(name + '.roof-hatch-cover', (-4.72, -.38, 3.12), .25, .14, naval, col, 12))
    put(box(name + '.roof-hatch', (-4.66, .55, 3.10), (.31, .45, .16), naval, col))
    for handle in [(-4.56, .55), (-4.76, .55)]:
        put(rod(name + '.roof-hatch-handle', (handle[0], handle[1] - .09, 3.19), (handle[0], handle[1] + .09, 3.19),
                .018, painted, col, vertices=4))
    put(rod(name + '.roof-hatch-cover-handle', (-4.72, -.50, 3.20), (-4.72, -.26, 3.20), .018, painted, col, vertices=4))

    # Rangefinder turrets carry the same rear plate with the transverse
    # housing running out through both flanks on its bracket webs.
    span = spec.get('rangefinderWidth')
    if span:
        station = spec.get('rangefinderForward', -5.0)
        tip, root = span / 2, 2.44
        for sign in [1, -1]:
            arm = []
            for y, back, front in [(root, station - .49, station + .28), (tip, station - .49, station + .46)]:
                arm.append((sign * y, [(back, 2.70), (back + .03, 2.62), (back + .11, 2.59), (front - .12, 2.59),
                                       (front - .04, 2.62), (front, 2.70), (front, 2.86), (front - .04, 2.95),
                                       (front - .12, 2.98), (back + .11, 2.98), (back + .03, 2.95), (back, 2.86)]))
            n = len(arm[0][1])
            points = [(x, y, z) for y, ring in arm for x, z in ring]
            faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
            faces += [(i + 1 if i + 1 < n else 0, i, i + n, (i + 1 if i + 1 < n else 0) + n) for i in range(n)]
            if sign < 0:
                faces = [tuple(reversed(f)) for f in faces]
            put(mesh(name + '.rangefinder-housing', points, faces, naval, col))
            # Bracket web carrying the projecting end, sunk into the flank it
            # is welded to, lightened by a round and a hexagonal hole.
            web = [(2.60, 2.59), (tip, 2.59), (tip, 2.30), (2.95, 1.62)]
            points = [(station + d, sign * y, z) for d in [-.03, .03] for y, z in web]
            faces = [(0, 1, 2, 3), (7, 6, 5, 4)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
            if sign < 0:
                faces = [tuple(reversed(f)) for f in faces]
            put(mesh(name + '.rangefinder-bracket', points, faces, naval, col))
            for hole, radius, sides in [((3.32, 2.22), .15, 12), ((3.92, 2.42), .19, 6)]:
                put(cyl(name + '.rangefinder-bracket-hole', (station, sign * hole[0], hole[1]), radius, .09,
                        dark, col, sides)).rotation_euler.y = math.pi / 2
            put(box(name + '.rangefinder-step', (station + .30, sign * (root + tip) / 2 * 1.02, 3.02),
                    (.42, tip - root - .20, .08), painted, col))
            posts = [root + .5, (root + tip) / 2, tip - .18]
            for y in posts:
                put(rod(name + '.rangefinder-rail-post', (station - .10, sign * y, 2.94),
                        (station - .10, sign * y, 3.26), .022, painted, col, vertices=4))
            put(rod(name + '.rangefinder-rail', (station - .10, sign * posts[0], 3.25),
                    (station - .10, sign * posts[-1], 3.25), .022, painted, col, vertices=4))

    # Access ladders up both flanks, standing off the sloped plate and hooking
    # over the roof knuckle, and a ladder down the port rear quarter.
    for sign in [1, -1]:
        stringers = [-4.06, -3.67]
        for x in stringers:
            path = [(sign * (side_y(x, .30) + .05), .30), (sign * (side_y(x, 2.16) + .05), 2.16),
                    (sign * 2.96, top_z(x, sign * 2.96) + .07)]
            for (ya, za), (yb, zb) in zip(path, path[1:]):
                put(rod(name + '.flank-ladder-rail', (x, ya, za), (x, yb, zb), .026, painted, col, vertices=4))
            for z in [.42, 1.20, 2.00]:
                put(rod(name + '.flank-ladder-standoff', (x, sign * (side_y(x, z) - .01), z),
                        (x, sign * (side_y(x, z) + .05), z), .02, painted, col, vertices=4))
        for i in range(8):
            z = .40 + i * .25
            y = sign * (side_y(-3.86, z) + .05)
            put(rod(name + '.flank-ladder-rung', (stringers[0], y, z), (stringers[1], y, z), .018, painted, col, vertices=4))

    quarter, foot, head = [1.66, 2.02], .25, 2.05
    rails = {y: (rear_x(y, foot) - .05, rear_x(y, head) - .05) for y in quarter}

    def quarter_x(y, z):
        return rails[y][0] + (rails[y][1] - rails[y][0]) * (z - foot) / (head - foot)

    for y in quarter:
        path = [(quarter_x(y, .10), .10), (quarter_x(y, 2.36), 2.36), (quarter_x(y, 2.36) + .24, 2.70)]
        for (xa, za), (xb, zb) in zip(path, path[1:]):
            put(rod(name + '.quarter-ladder-rail', (xa, y, za), (xb, y, zb), .026, painted, col, vertices=4))
        for z in [.32, 1.20, 2.00]:
            put(rod(name + '.quarter-ladder-standoff', (rear_x(y, z) + .01, y, z), (quarter_x(y, z), y, z),
                    .02, painted, col, vertices=4))
    for i in range(9):
        z = .22 + i * .25
        put(rod(name + '.quarter-ladder-rung', (quarter_x(quarter[0], z), quarter[0], z),
                (quarter_x(quarter[1], z), quarter[1], z), .018, painted, col, vertices=4))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

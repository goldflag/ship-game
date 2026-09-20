"""Original BL 6-inch/50 Mk XXIII triple, the Town/Edinburgh/Fiji cruiser main turret.

Visual proportions follow the approved GameModels3D artillery visual
`bgm001_6in50_mk_xxiii` as fitted on pbsc107 (Fiji), pbsc507/pbsc528 (Belfast),
pbsc108 (Edinburgh) and pbsc109 (Neptune). No reference geometry is loaded here.
The catalog owns the closed armor shell and the weapon data; this recipe draws that
shell and adds the roller plate, the sliding guns in their open wells, the cradles
and recoil gear, the sighting hoods and the service fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout

SLEEVE = .265   # sliding jacket radius through the gun-port ring
WELL_W = .33    # half width of an open gun well, matching the catalog shell
RING_R = .42    # gun-port ring radius on the well back plate


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

    # The visible gunhouse is exactly the catalog's armor shell, so the glacis,
    # the open gun wells and the cambered roof stay aligned with their protection.
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

    def top_z(x, y):
        return max(h.z for h in cast((x, y, 20), (0, 0, -1)))

    def side_y(x, z):
        return max(h.y for h in cast((x, 20, z), (0, -1, 0)))

    def rear_x(y, z):
        return min(h.x for h in cast((-20, y, z), (1, 0, 0)))

    base = spec['gunhouseBaseHeight']
    pivot = spec['pivotHeight']
    trunnion = spec['trunnionForward']
    length = spec['muzzleForward'] - trunnion
    bore = spec['caliberM'] / 2

    # Roller plate. The reference shows no ring above deck; this is the thin sole
    # the shell floor sits on, with the ship owning the fixed barbette below it.
    put(cyl(name + '.turntable', (0, 0, base / 2), spec['barbetteRadius'], base, naval, col, 40))

    # ---- guns -------------------------------------------------------------
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (trunnion, y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # One connected surface: a constant jacket long enough to stay plugged
        # into the port ring through the full stroke, a shoulder, then the chase.
        profile = [(.02, .225), (.07, SLEEVE), (.96, SLEEVE), (1.00, .24), (1.98, .24),
                   (2.02, .152), (length, .138)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .138), (length, bore), (length - .40, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .40, 0, 0), bore, dark, col, vertices=count), recoil)

        # Cradle and recoil gear ride the trunnions; the jacket slides through them.
        put(box(name + '.cradle', (.68, 0, -.22), (1.05, .32, .30), edge, col), elevation)
        put(box(name + '.cradle-cheek', (.10, 0, -.14), (.26, .58, .46), edge, col), elevation)
        for pin in [1, -1]:
            put(rod(name + '.trunnion-pin', (0, pin * .26, 0), (0, pin * .35, 0), .105, edge, col), elevation)
        for lane in [.235, -.235]:
            put(rod(name + '.recoil-cylinder', (.05, lane, -.24), (1.18, lane, -.24), .085, edge, col), elevation)
            put(rod(name + '.recuperator-head', (1.18, lane, -.24), (1.26, lane, -.24), .10, edge, col), elevation)
        put(box(name + '.elevating-arc', (-.10, 0, -.44), (.46, .34, .34), edge, col), elevation)

        # Fixed port ring on the well back plate: the flared collar the jacket
        # runs through. 'port' in the name keeps it out of the clearance sweep.
        ring = [(1.24 + d, y + RING_R * (1 - .33 * i) * math.cos(math.tau * k / 16),
                 pivot + RING_R * (1 - .33 * i) * math.sin(math.tau * k / 16))
                for i, d in enumerate([0, .20]) for k in range(16)]
        faces = [(i, (i + 1) % 16, 16 + (i + 1) % 16, 16 + i) for i in range(16)]
        put(mesh(name + '.gun-port-ring', ring, faces, painted, col))

        # Raised coaming around the open mouth of the well, rounding off its
        # after end exactly as the approved model does.
        inner = [(2.20, .33), (1.52, .33), (1.43, .28), (1.43, 0), (1.43, -.28), (1.52, -.33), (2.20, -.33)]
        outer = [(2.20, .46), (1.52, .46), (1.34, .36), (1.30, 0), (1.34, -.36), (1.52, -.46), (2.20, -.46)]
        seat = [(x, y + dy, 2.34 - .0235 * (y + dy) ** 2) for x, dy in inner]
        skirt = [(x, y + dy, 2.34 - .0235 * (y + dy) ** 2) for x, dy in outer]
        lip = .075
        points = ([tuple(p) for p in seat] + [(p[0], p[1], p[2] + lip) for p in seat]
                  + [(p[0], p[1], p[2] + lip) for p in skirt] + [tuple(p) for p in skirt])
        k = len(seat)
        faces = []
        for i in range(k - 1):
            faces += [(i, k + i, k + i + 1, i + 1),
                      (k + i, 2 * k + i, 2 * k + i + 1, k + i + 1),
                      (2 * k + i, 3 * k + i, 3 * k + i + 1, 2 * k + i + 1)]
        faces += [(0, 3 * k, 2 * k, k), (k - 1, 2 * k - 1, 3 * k - 1, 4 * k - 1)]
        put(mesh(name + '.well-coaming', points, faces, naval, col))

        # Blast-shield strut standing on the well ramp under the muzzle, and the
        # pair of lashing rails on the glacis lip, as the reference carries them.
        put(box(name + '.gun-shield-strut', (3.02, y, .52), (.16, .22, .70), painted, col))
        put(box(name + '.gun-shield-strut-head', (3.14, y, .84), (.40, .20, .10), painted, col))
        for lane in [.12, -.12]:
            put(rod(name + '.glacis-rail', (3.31, y + lane, .08), (3.29, y + lane, .84), .022, painted, col, vertices=6))

    # ---- sighting hoods ---------------------------------------------------
    # Two gunlayers' hoods with their linking bar sit on the glacis between the
    # centre and the port gun on the approved model; they are not mirrored.
    bar = []
    for hood in [.72, 1.24]:
        seat = front_x(hood, 1.80)
        o = put(box(name + '.sight-hood', (seat + .12, hood, 1.80), (.26, .22, .12), naval, col))
        o.rotation_euler.y = -math.atan2(1.10, 2.26)
        put(box(name + '.sight-aperture', (seat + .04, hood, 1.71), (.06, .16, .10), glass, col))
        bar.append((seat + .10, hood, 1.83))
    put(rod(name + '.sight-link', bar[0], bar[1], .026, painted, col, vertices=6))
    put(box(name + '.sight-shelf', (front_x(.98, 1.86) + .08, .98, 1.88), (.16, .10, .10), painted, col))

    # ---- roof fittings ----------------------------------------------------
    # Open crew hatch frame just abaft the centre well.
    for edge_x in [-.36, .27]:
        put(box(name + '.hatch-frame', (edge_x, 0, top_z(edge_x, 0) + .04), (.09, .92, .09), painted, col))
    for edge_y in [.40, -.40]:
        put(box(name + '.hatch-frame', (-.05, edge_y, top_z(-.05, edge_y) + .03), (.72, .09, .07), painted, col))

    # Lifting and stanchion lugs scattered over the roof, as on the reference.
    for x, ly in [(0.0, 1.45), (0.92, 2.15), (-2.85, 2.77), (0.55, 3.12), (-3.90, 2.44), (-1.85, 1.20)]:
        for sign in ([1, -1] if ly else [1]):
            seat = top_z(x, sign * ly)
            put(box(name + '.roof-lug', (x, sign * ly, seat + .07), (.05, .15, .17), painted, col))

    # Periscope trunk standing on the after roof, offset to starboard as modelled.
    put(box(name + '.periscope-base', (-3.96, -.84, 2.31), (.20, .22, .16), naval, col))
    put(cyl(name + '.periscope', (-3.96, -.84, 2.68), .06, .60, painted, col, 10, .045))
    put(box(name + '.periscope-head', (-3.96, -.84, 2.96), (.12, .10, .10), painted, col))

    # ---- rear plate -------------------------------------------------------
    put(box(name + '.rear-vent', (-5.01, 0, 1.99), (.14, .54, .35), naval, col))
    for sign in [1, -1]:
        put(box(name + '.rear-hatch', (-4.62, sign * 1.98, 1.87), (.32, .53, .36), naval, col))
        put(box(name + '.rear-hatch-handle', (-4.80, sign * 1.98, 1.87), (.05, .18, .05), painted, col))
        for z in [.36, 1.18]:
            put(box(name + '.rear-step', (-4.74, sign * 1.66, z), (.18, .39, .18), painted, col))
        stile = rear_x(sign * 2.24, .74) - .05
        put(rod(name + '.rear-stile', (stile, sign * 2.24, .42), (stile, sign * 2.24, 1.05), .04, painted, col, vertices=6))
        put(box(name + '.rear-cleat', (stile + .03, sign * 2.24, .73), (.12, .07, .18), painted, col))

        # ---- side hand rail on brackets, and the after ladder -------------
        rail = []
        for i in range(10):
            x = -3.95 + i * .501
            rail.append((x, sign * (side_y(x, 1.75) + .11), 1.75))
        for a, b in zip(rail, rail[1:]):
            put(rod(name + '.side-rail', a, b, .035, painted, col, vertices=6))
        for i in [0, 2, 4, 6, 8]:
            x, ry, z = rail[i]
            put(rod(name + '.side-rail-bracket', (x, sign * side_y(x, 1.75), z), (x, ry, z), .032, painted, col, vertices=4))
        put(box(name + '.side-tab', (.05, sign * (side_y(.05, 1.51) + .02), 1.51), (.05, .10, .14), painted, col))

        # Vertical ladder on the after quarter, stringers standing off the plate.
        for lane in [-.10, .10]:
            a = (-4.28 + lane, sign * (side_y(-4.28 + lane, 1.00) + .07), .10)
            b = (-4.28 + lane, sign * (side_y(-4.28 + lane, 1.00) + .07), 1.98)
            put(rod(name + '.ladder-rail', a, b, .03, painted, col, vertices=4))
        for i in range(7):
            z = .18 + i * .29
            oy = sign * (side_y(-4.28, 1.00) + .07)
            put(rod(name + '.ladder-rung', (-4.38, oy, z), (-4.18, oy, z), .022, painted, col, vertices=4))
        for z in [.30, 1.10, 1.86]:
            put(rod(name + '.ladder-standoff', (-4.28, sign * side_y(-4.28, z), z),
                    (-4.28, sign * (side_y(-4.28, 1.00) + .07), z), .024, painted, col, vertices=4))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

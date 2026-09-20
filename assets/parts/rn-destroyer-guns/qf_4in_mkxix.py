"""Original 4-inch QF Mk XVI HA gun on the twin Mk XIX mounting.

Two hoods share this recipe. `create_mount` draws the open-backed hood carried
as the Black Swan main battery and as the high-angle secondary of the larger
ships; `create_enclosed_mount` draws the fully plated hood of the later cruiser
fit. Proportions follow the approved GameModels3D visuals
`bgs006_4in45_qf_mk_xix` and `bgs127_4in45_qf_mk_xix`; no reference geometry is
loaded here. The catalog owns the hood facets and the weapon data; this recipe
draws that hood and adds the roller path, working platform, trunnion standards,
sliding guns, layers' stations and the canvas port covers.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .135          # sliding jacket radius through the canvas cuff
COLLAR = 1.98          # cuff station forward of the trunnion
FLOOR = .39            # gunhouse floor and working-platform top
SLOT_IN, SLOT_OUT = .06, .48   # gun-port slot edges either side of the centre rib


def create_mount(mount, col, helpers, materials):
    return _build(mount, col, helpers, materials, enclosed=False)


def create_enclosed_mount(mount, col, helpers, materials):
    return _build(mount, col, helpers, materials, enclosed=True)


def _build(mount, col, helpers, materials, enclosed):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('canvas', palette['dark'])
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

    # The visible hood is exactly the catalog's plating, so the gun-port slots,
    # the shoulders and the open back stay aligned with their protection.
    shape = spec['gunhouseMesh']
    hood = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                    [f['indices'] for f in shape['faces']], naval, col))
    hood.data.materials.append(roof)
    for polygon, face in zip(hood.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    # Outer facets stay the catalog's; the inward skin only gives the plate its
    # thickness, so the open back and the port slots read as plating from inside.
    plate = hood.modifiers.new('Hood plate thickness', 'SOLIDIFY')
    plate.thickness = .014
    plate.offset = 1
    plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]
    ring = [Vector(v) for v in shape['vertices'][:10]]

    def top_z(x, y, default=None):
        hits = [intersect_ray_tri(*t, Vector((0, 0, -1)), Vector((x, y, 6))) for t in plates]
        hits = [h.z for h in hits if h is not None]
        return max(hits) if hits else default

    # Crown line between the two port slots: the datum for the canvas seams.
    crown = [(v.x, v.z) for v in [Vector(p) for p in shape['vertices']][4::10]]
    crown = crown[1:] if not enclosed else crown[3:]

    def crest(t):
        u = max(0., min(1., t)) * (len(crown) - 1)
        i = min(int(u), len(crown) - 2)
        a, b = crown[i], crown[i + 1]
        f = u - i
        return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)

    # Roller path and the rotating sole. The ship owns the fixed ring below.
    put(cyl(name + '.sole', (0, 0, .055), .98, .11, naval, col, 32))
    put(cyl(name + '.roller-path', (0, 0, .20), .90, .19, edge, col, 32, .84))
    for i in range(16):
        a = i * math.tau / 16
        put(rod(name + '.roller', (.93 * math.cos(a), .93 * math.sin(a), .11),
                (.93 * math.cos(a), .93 * math.sin(a), .29), .055, painted, col, vertices=6))

    if enclosed:
        # The plated tail overhangs a narrow working platform, as on the
        # approved visual; its flanks stop short of the deck.
        put(box(name + '.working-platform', (-.68, 0, FLOOR - .05), (1.76, 1.90, .10), naval, col))
        for y in [-.74, .74]:
            put(box(name + '.platform-leg', (-1.38, y, .17), (.22, .22, .34), naval, col))
        put(box(name + '.rear-door', (-1.52, 0, FLOOR + .58), (.06, .84, 1.16), naval, col))
        put(rod(name + '.door-handle', (-1.56, .26, FLOOR + .48), (-1.56, .26, FLOOR + .66),
                .022, painted, col, vertices=6))
    else:
        # Open working platform abaft the hood, on four legs off the deck.
        put(box(name + '.working-platform', (-.72, 0, FLOOR - .05), (1.66, 3.90, .10), naval, col))
        for x in [-1.38, -.22]:
            for y in [-1.70, 1.70]:
                put(box(name + '.platform-leg', (x, y, .17), (.22, .22, .34), naval, col))
        for side in [-1, 1]:
            # Ready-use lockers and the outboard grab rail along the platform.
            put(box(name + '.ready-locker', (-.98, side * 1.62, .555), (1.05, .46, .33), naval, col))
            rail = [(-1.52, side * 1.88, .95), (-1.52, side * 1.88, 1.32), (-.44, side * 1.88, 1.32)]
            for a, b in zip(rail, rail[1:]):
                put(rod(name + '.platform-rail', a, b, .022, painted, col, vertices=6))
            put(rod(name + '.rail-stanchion', (-1.52, side * 1.88, FLOOR), (-1.52, side * 1.88, 1.32),
                    .024, painted, col, vertices=6))
            put(rod(name + '.rail-stanchion', (-.44, side * 1.88, FLOOR), (-.44, side * 1.88, 1.32),
                    .024, painted, col, vertices=6))
        # Rolled coaming around the open back of the hood.
        for a, b in zip(ring, ring[1:]):
            put(rod(name + '.rear-coaming', tuple(a), tuple(b), .035, painted, col, vertices=6))

    # Trunnion standards: one centre frame and two outboard frames, carrying the
    # elevating masses at the catalog trunnion height.
    pivot, height = spec['trunnionForward'], spec['pivotHeight']
    for y, thickness in [(0, .14), (.62, .13), (-.62, .13)]:
        put(box(name + '.trunnion-standard', (pivot + .02, y, (FLOOR + height + .06) / 2),
                (.62, thickness, height + .06 - FLOOR), naval, col))
        put(rod(name + '.trunnion-cap', (pivot, y - thickness / 2 - .01, height),
                (pivot, y + thickness / 2 + .01, height), .135, edge, col, vertices=12))
    # Forward transverse frame, kept clear of the guns at full depression.
    put(box(name + '.forward-frame', (.18, 0, (FLOOR + 1.50) / 2), (.10, 1.45, 1.50 - FLOOR), naval, col))
    put(box(name + '.training-gearbox', (-.30, 0, FLOOR + .21), (.52, .70, .42), naval, col))
    # Hoist trunk on the centreline, clear of the breeches at full depression,
    # with the ready-use shell racks either side of it.
    put(box(name + '.hoist-trunk', (-.95, 0, FLOOR + .37), (.42, .56, .74), naval, col))
    put(box(name + '.hoist-door', (-.74, 0, FLOOR + .30), (.04, .40, .50), edge, col))
    for side in [-1, 1]:
        put(box(name + '.shell-rack', (-1.24, side * .74, FLOOR + .30), (.46, .46, .60), naval, col))
        for i in range(3):
            put(rod(name + '.ready-round', (-1.38 + i * .14, side * .74, FLOOR + .60),
                    (-1.38 + i * .14, side * .74, FLOOR + .92), .052, edge, col, vertices=8))

    length = spec['muzzleForward'] - pivot
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        sign = 1 if y > 0 else -1
        elevation = joint(side + '.elevation', yaw, (pivot, y, height))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # Cradle, recuperator and elevating arc pitch with the gun but do not
        # slide; they stay inside the port slot through the whole travel.
        put(box(name + '.cradle', (.62, 0, -.13), (1.94, .30, .30), naval, col), elevation)
        put(rod(name + '.recuperator', (.26, 0, .235), (1.72, 0, .235), .085, edge, col, vertices=12), elevation)
        put(rod(name + '.trunnion-shaft', (0, -.34, 0), (0, .34, 0), .105, edge, col, vertices=12), elevation)
        arc = [(.56 * math.cos(math.radians(a)), .56 * math.sin(math.radians(a))) for a in range(-108, -43, 8)]
        k = len(arc)
        put(mesh(name + '.elevating-arc',
                 [(ax, yy, az) for yy in [sign * .18, sign * .26] for ax, az in arc] +
                 [(ax * .84, yy, az * .84) for yy in [sign * .18, sign * .26] for ax, az in arc],
                 [(i, i + 1, k + i + 1, k + i) for i in range(k - 1)][::sign] +
                 [(2 * k + i, 3 * k + i, 3 * k + i + 1, 2 * k + i + 1) for i in range(k - 1)][::sign] +
                 [(0, k, 3 * k, 2 * k), (k - 1, 3 * k - 1, 4 * k - 1, 2 * k - 1)],
                 edge, col), elevation)

        # One connected sliding surface: breech, a constant jacket long enough
        # for the cuff through full recoil, then the tapering chase.
        profile = [(-.86, .17), (-.28, .17), (-.24, .155), (.52, .155), (.56, SLEEVE),
                   (COLLAR + spec['recoilM'] + .14, SLEEVE), (COLLAR + spec['recoilM'] + .22, .098),
                   (length, .092)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        faces += [tuple(reversed(range(count))), tuple((len(profile) - 1) * count + i for i in range(count))]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .092), (length, bore), (length - .22, bore)] for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim,
                 [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                  for j in range(2) for i in range(count)], edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .24, 0, 0), (length - .22, 0, 0), bore, dark, col, vertices=count), recoil)
        # Breech mechanism and the loading tray behind it.
        put(box(name + '.breech-block', (-.60, 0, .02), (.30, .34, .36), edge, col), recoil)
        put(rod(name + '.breech-lever', (-.86, sign * .18, .10), (-1.06, sign * .26, .22), .028, painted, col, vertices=6), recoil)
        put(box(name + '.loading-tray', (-1.22, 0, -.12), (.62, .26, .10), painted, col), elevation)

    for side, y, _ in barrel_layout(spec):
        sign = 1 if y > 0 else -1
        # Layer's and trainer's stations on the platform inside the hood.
        seat_x = -.52
        put(cyl(name + '.seat-pedestal', (seat_x, sign * 1.24, FLOOR + .17), .085, .34, naval, col, 10))
        put(cyl(name + '.seat-pan', (seat_x, sign * 1.24, FLOOR + .38), .23, .07, painted, col, 12))
        put(box(name + '.seat-back', (seat_x - .21, sign * 1.24, FLOOR + .58), (.07, .40, .34), painted, col))
        hub = (-.06, sign * 1.02, 1.12)
        put(box(name + '.gear-housing', (hub[0] - .16, hub[1], hub[2] - .12), (.30, .26, .46), naval, col))
        put(rod(name + '.handwheel-shaft', (hub[0] - .18, hub[1], hub[2]), hub, .028, edge, col, vertices=8))
        wheel = [(hub[0], hub[1] + .21 * math.cos(a * math.tau / 12), hub[2] + .21 * math.sin(a * math.tau / 12))
                 for a in range(12)]
        for a, b in zip(wheel, wheel[1:] + wheel[:1]):
            put(rod(name + '.handwheel-rim', a, b, .022, painted, col, vertices=5))
        for a in range(0, 12, 4):
            put(rod(name + '.handwheel-spoke', hub, wheel[a], .018, painted, col, vertices=5))
        # Layer's telescope on its bracket, sighting through the port slot.
        eye = (-.30, sign * .82, 1.62)
        put(rod(name + '.sight-telescope', eye, (eye[0] + .62, sign * .70, 1.80), .045, edge, col, vertices=10))
        put(box(name + '.sight-bracket', (eye[0] + .10, sign * .76, 1.50), (.10, .12, .30), naval, col))
        put(box(name + '.sight-eyepiece', (eye[0] - .04, sign * .82, 1.62), (.05, .10, .10), glass, col))

    # Pleated canvas covers. The fixed seam follows the rim of each port slot;
    # the cuff rides the constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        outer = SLOT_OUT if y > 0 else -SLOT_IN
        inner = SLOT_IN if y > 0 else -SLOT_OUT
        seam = []
        for lateral, ts in [(outer, [.60, .42, .26, .12]), (None, [0.]),
                            (inner, [.12, .26, .42, .60, .75, .86, .95]), (None, [1.]),
                            (outer, [.95, .86, .75])]:
            for t in ts:
                x, z = crest(t)
                seam.append((x, (outer + inner) / 2 if lateral is None else lateral, z + .04))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               pivot + COLLAR, SLEEVE + .018, rings=4, fold_depth=.03,
                               slack=.06, fullness=.04)
        # A linear cloth loft cuts through the hood shoulders at depression.
        # Lift the intermediate rings onto the plating and keep them outside the
        # sliding sleeve, without moving the fixed seam or the pitching cuff.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        sectors = cover['gunCoverFixedVertexCount']
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < sectors or index >= len(key.data) - sectors:
                    continue
                plate = top_z(point.co.x, point.co.y)
                if plate is not None:
                    point.co.z = max(point.co.z, plate + .035)
                delta = (point.co.x - pivot, point.co.y - y, point.co.z - height)
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < SLEEVE + .03:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .03) / distance - 1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

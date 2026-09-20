"""Original 16-inch Mk I triple mount, the Nelson and Rodney main turret.

Visual proportions follow the approved GameModels3D pbsb517 A artillery
(`bgm066_16in45_bl_mki`). No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the turntable, the flanking rangefinder arms, sliding barrels, canvas
seals and service fittings. Authoring frame: +X muzzle, +Y port, +Z up, yaw
datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .543          # sliding jacket radius through the canvas cuff
COLLAR = 2.45          # cuff station forward of the trunnion
PORT_HALF = .64        # elevation port half-width
PORT_LOW = .80         # centre of the port's lower round
PORT_HIGH = 2.00       # centre of the port's upper round
SECTORS = 20


def stadium(half, low, high, count):
    """Port outline in (y, z): two half rounds joined by straight cheeks.

    Sampled by arc length from +Y at mid height and winding toward +Z, the
    order `gun_bloomers` expects for a seam.
    """
    mid = (low + high) / 2
    dense = [(half, mid + (high - mid) * i / 8) for i in range(8)]
    dense += [(half * math.cos(math.pi * i / 16), high + half * math.sin(math.pi * i / 16)) for i in range(17)]
    dense += [(-half, high - (high - low) * i / 8) for i in range(1, 8)]
    dense += [(half * math.cos(math.pi + math.pi * i / 16), low + half * math.sin(math.pi + math.pi * i / 16)) for i in range(17)]
    dense += [(half, low + (mid - low) * i / 8) for i in range(1, 8)]
    runs = [math.dist(a, b) for a, b in zip(dense, dense[1:] + dense[:1])]
    total = sum(runs)
    out = []
    walked = 0.0
    index = 0
    for k in range(count):
        target = total * k / count
        while walked + runs[index] < target:
            walked += runs[index]
            index += 1
        a, b = dense[index], dense[(index + 1) % len(dense)]
        t = (target - walked) / runs[index]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


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

    # The visible gunhouse is exactly the catalog's armor shell, so the rounded
    # back plate, the tumbled flanks and the raked face stay aligned with their
    # protection.
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
        hits = cast((20, y, z), (-1, 0, 0))
        return max(h.x for h in hits) if hits else 5.65

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else 2.81

    def flank_y(x, z, sign):
        hits = cast((x, sign * 20, z), (0, -sign, 0))
        return sign * max(sign * h.y for h in hits) if hits else sign * 5.5

    def prism(label, outline, z0, z1, material):
        """Closed prism; the outline is wound counter-clockwise seen from above."""
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1]))
        if area < 0:
            outline = list(reversed(outline))
        k = len(outline)
        points = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return put(mesh(name + '.' + label, points, faces, material, col))

    # Rotating sole. The gunhouse overhangs it fore and aft; the ship owns the
    # fixed barbette below the datum plane.
    roller = spec.get('rollerRadius', spec['barbetteRadius'] + .1)
    base = spec.get('gunhouseBaseHeight', .12)
    put(cyl(name + '.turntable', (0, 0, base / 2), roller, base, naval, col, 36))
    put(cyl(name + '.roller-path', (0, 0, base - .03), roller - .12, .06, edge, col, 36))

    # Sliding guns. One connected surface: a constant jacket long enough to
    # carry the canvas cuff through the full stroke, a shoulder, the tapering
    # chase and a shallow muzzle swell.
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    stroke = spec.get('recoilM', 1.2)
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 0))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        profile = [(.50, SLEEVE), (COLLAR + stroke + .35, SLEEVE), (COLLAR + stroke + .42, .444),
                   (length - .58, .336), (length - .04, .367), (length, .335)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        # The rim is rooted inside the chase so the muzzle face, the rifled bore
        # and the barrel read as one welded piece rather than a capped stack.
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length - .06, .300), (length, .345), (length, bore), (length - .40, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(3) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .42, 0, 0), (length - .38, 0, 0), bore + .02, dark, col, vertices=count), recoil)

    # Elevation ports. The armour is closed, so the rim and its coaming are
    # drawn on the real raked face and the canvas fills the opening the guns
    # work through.
    outline = stadium(PORT_HALF, PORT_LOW, PORT_HIGH, SECTORS)
    seams = {}
    for side, y, _ in barrel_layout(spec):
        seam = [(front_x(y + dy, dz) + .02, y + dy, dz) for dy, dz in outline]
        seams[side] = seam
        inner, outer = [], []
        for (dy, dz), (px, py, pz) in zip(outline, seam):
            centre = min(max(dz, PORT_LOW), PORT_HIGH)
            span = math.hypot(dy, dz - centre) or 1.0
            inner.append((px + .05, py, pz))
            # The coaming keeps to the plate: where the raised rim would run off
            # the face or under the floor it narrows instead.
            for reach in [.18, .13, .08, .04]:
                oy = dy + dy / span * reach
                oz = max(dz + (dz - centre) / span * reach, .15)
                if cast((20, y + oy, oz), (-1, 0, 0)):
                    break
            outer.append((front_x(y + oy, oz) + .015, y + oy, oz))
        k = len(seam)
        points = seam + inner + outer
        faces = [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        faces += [(i + k, (i + 1) % k + k, (i + 1) % k + 2 * k, i + 2 * k) for i in range(k)]
        put(mesh(name + '.gun-port-frame', points, faces, naval, col))

    # Rangefinder arms. Both flanks carry a hooded platform growing out of the
    # roof knuckle abaft the guns, with the transverse tube slung beneath it.
    arm_x = spec.get('rangefinderForward', -5.23)
    tip = spec.get('rangefinderWidth', 13.01) / 2
    for sign in [1, -1]:
        plan = [(arm_x - .90, sign * 4.50), (arm_x - .90, sign * (tip - .09)), (arm_x - .87, sign * (tip - .04)),
                (arm_x - .79, sign * tip), (arm_x + .79, sign * tip), (arm_x + .87, sign * (tip - .04)),
                (arm_x + .90, sign * (tip - .09)), (arm_x + .90, sign * 4.50)]
        prism('rangefinder-platform', plan, 2.498, 2.648, naval)
        hood = [(arm_x - .86, sign * 4.95), (arm_x - .86, sign * (tip - .10)), (arm_x - .78, sign * tip),
                (arm_x + .78, sign * tip), (arm_x + .86, sign * (tip - .10)), (arm_x + .86, sign * 4.95)]
        prism('rangefinder-hood', hood, 1.880, 2.498, naval)
        # Root bracket: the hood is carried on a plate sunk into the flank.
        put(box(name + '.rangefinder-bracket', (arm_x, sign * 4.79, 2.08), (1.79, .46, .84), naval, col))
        put(rod(name + '.rangefinder-tube', (arm_x + .22, sign * 4.55, 2.16), (arm_x + .22, sign * (tip - .11), 2.16),
                .22, edge, col, vertices=12))
        put(box(name + '.rangefinder-eyepiece', (arm_x + .27, sign * (tip - .07), 2.16), (.14, .20, .23), glass, col))
        put(box(name + '.rangefinder-locker', (arm_x + .60, sign * 5.68, 2.35), (.59, .51, .64), naval, col))
        # Escape scuttle let into the platform roof, with its lifting handle.
        put(cyl(name + '.rangefinder-scuttle', (arm_x - .58, sign * (tip - .45), 2.672), .17, .06, naval, col, 12))
        put(rod(name + '.rangefinder-scuttle-handle', (arm_x - .70, sign * (tip - .45), 2.713),
                (arm_x - .46, sign * (tip - .45), 2.713), .022, painted, col, vertices=4))

    def ladder(label, a, b, normal, across, width, steps):
        """Two rails on standoffs with rungs, laid on a plate of the shell."""
        def shift(p, out, lateral):
            return tuple(p[i] + normal[i] * out + across[i] * lateral for i in range(3))
        for lateral in [-width / 2, width / 2]:
            ra, rb = shift(a, .05, lateral), shift(b, .05, lateral)
            put(rod(name + '.' + label + '-rail', ra, rb, .028, painted, col, vertices=4))
            for t in [.12, .88]:
                p = [ra[i] + (rb[i] - ra[i]) * t for i in range(3)]
                put(rod(name + '.' + label + '-standoff',
                        tuple(p[i] - normal[i] * .07 for i in range(3)), tuple(p), .022, painted, col, vertices=4))
        for i in range(steps):
            t = .06 + i * (.88 / max(1, steps - 1))
            p = [a[k] + (b[k] - a[k]) * t for k in range(3)]
            put(rod(name + '.' + label + '-rung', shift(p, .05, -width / 2), shift(p, .05, width / 2),
                    .02, painted, col, vertices=4))

    # Flank ladders, one each side, laid on the tumbled side plate.
    for sign in [1, -1]:
        lx = -1.46
        foot = (lx, flank_y(lx, .22, sign), .22)
        head = (lx, flank_y(lx, 2.58, sign), 2.58)
        run = math.hypot(head[1] - foot[1], head[2] - foot[2])
        normal = (0, sign * (head[2] - foot[2]) / run, sign * (foot[1] - head[1]) / run)
        ladder('flank-ladder', foot, head, normal, (1, 0, 0), .42, 9)

    # Face ladder between the centre and starboard guns, on the rake.
    rake = math.atan2(1, 2.4)
    fy = -1.25
    ladder('face-ladder', (front_x(fy, .24), fy, .24), (front_x(fy, 2.62), fy, 2.62),
           (math.cos(rake), 0, math.sin(rake)), (0, 1, 0), .42, 9)

    # Starboard training-gear housing standing proud of the flank abaft the
    # ladder, as the approved model carries it on one side only.
    sy = flank_y(-.72, 1.06, -1)
    put(box(name + '.flank-housing', (-.72, sy - .21, 1.065), (.41, .58, .33), naval, col))
    put(box(name + '.flank-housing-door', (-.72, sy - .50, 1.065), (.25, .04, .21), edge, col))

    # Starboard escape hatch on the rear roof, with its handle.
    hx, hy = -6.95, -3.69
    put(cyl(name + '.roof-hatch', (hx, hy, top_z(hx, hy) + .05), .31, .10, naval, col, 8))
    put(rod(name + '.roof-hatch-handle', (hx - .14, hy, top_z(hx, hy) + .112), (hx + .14, hy, top_z(hx, hy) + .112),
            .026, painted, col, vertices=4))

    # Two awning davits abaft the forward roof edge, starboard side.
    for dx, dy in [(.77, -4.47), (.18, -4.11)]:
        seat = top_z(dx, dy)
        put(box(name + '.roof-davit-seat', (dx, dy, seat + .04), (.19, .19, .26), naval, col))
        put(box(name + '.roof-davit', (dx, dy, seat + .30), (.10, .10, .30), painted, col))
        put(box(name + '.roof-davit-arm', (dx + .16, dy, seat + .40), (.30, .08, .07), painted, col))

    # Lifting eyes welded along both roof knuckles.
    for sign in [1, -1]:
        for ex in [-6.90, -4.25, -2.20, .60, 1.12, 3.20]:
            ey = flank_y(ex, 2.55, sign) - sign * .12
            put(box(name + '.roof-eye', (ex, ey, top_z(ex, ey) + .04), (.10, .10, .10), painted, col))

    # Pleated canvas seals. The fixed seam sits on the real raked face around
    # each port; the cuff rides the constant jacket through elevation and the
    # full recoil stroke.
    for side, y, _ in barrel_layout(spec):
        cover = create_bloomer(mount, col, helpers, palette, side, seams[side],
                               spec['trunnionForward'] + COLLAR, SLEEVE + .015, rings=5, slack=.07, fullness=.07)
        # A linear cloth loft can cut into the face at depression and cross the
        # jacket at high elevation. Drape the intermediate rings over the armour
        # and keep them outside the sliding sleeve, without moving the fixed
        # seam or the pitching cuff.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < SECTORS or index >= 4 * SECTORS:
                    continue
                plate = cast((20, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .03)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < SLEEVE + .04:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .04) / distance - 1)
                # Nothing hangs below the sole plane, cloth included.
                point.co.z = max(point.co.z, .06)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

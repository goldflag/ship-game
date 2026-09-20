"""Original 381 mm/50 Model 1934 triple, the Littorio-class main turret.

Visual proportions follow the approved GameModels3D pisb508 artillery visuals
(`igm011_381mm50_barrels_3_m1939_tower` for the platform variant and
`igm010_381mm50_barrels_3_m1939_life_boat` for the first-turret variant). No
reference geometry is loaded here. The catalog owns the closed armor shell and
the weapon data; this recipe draws that shell and adds the turntable, working
platform, rear corner sponsons and their haunches, the raised rear platform or
the boat stowage, ladders, sliding barrels and canvas seals.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SLEEVE = .49          # sliding jacket radius under the canvas cuff
COLLAR = 2.02         # cuff station forward of the trunnion
JACKET = 3.30         # forward end of the constant jacket (cuff + full recoil)
TALL = 'it-381-50-m1934-triple'   # the variant with the raised rear platform

# Rear corner sponson, port half-plan, taken from the reference outline.
SPONSON = [(-5.94, 3.98), (-8.90, 3.79), (-9.38, 5.86), (-9.30, 6.28),
           (-9.02, 6.58), (-8.78, 6.62), (-5.58, 6.62), (-5.49, 6.45)]
SPONSON_TOP = [(-9.41, 2.36), (-8.77, 2.61), (-7.42, 2.82), (-5.49, 2.70)]
# Raised rear platform: supporting trunk and the deck it carries, port halves.
TRUNK = [(-7.37, 3.25), (-7.50, 3.69), (-9.06, 4.26), (-9.52, 4.20), (-9.95, 4.02),
         (-10.33, 3.73), (-10.62, 3.36), (-10.80, 2.91), (-10.98, 2.19), (-11.15, 1.10), (-11.20, 0)]
DECK = [(-7.36, 3.77), (-9.05, 4.36), (-9.54, 4.30), (-10.01, 4.11), (-10.40, 3.80),
        (-10.71, 3.41), (-10.90, 2.94), (-11.08, 2.21), (-11.25, 1.11), (-11.30, 0)]
# Shell stations used for the flank-mounted fittings: x -> (floor half-width, roof edge, roof height)
FLANK = [(-9.05, 3.73, 3.70, 2.73), (-8.66, 4.57, 3.66, 2.80), (-2.86, 5.09, 3.85, 3.71),
         (-0.10, 5.09, 3.99, 3.32), (4.66, 4.50, 3.64, 2.66)]


def _span(table, x, column):
    """Linear interpolation through a measured station table."""
    if x <= table[0][0]:
        return table[0][column]
    for a, b in zip(table, table[1:]):
        if x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return a[column] + (b[column] - a[column]) * t
    return table[-1][column]


def _ccw(loop):
    twice = sum(loop[i][0] * loop[(i + 1) % len(loop)][1] - loop[(i + 1) % len(loop)][0] * loop[i][1]
                for i in range(len(loop)))
    return list(loop) if twice > 0 else list(reversed(loop))


def _inset(loop, distance):
    cx = sum(p[0] for p in loop) / len(loop)
    cy = sum(p[1] for p in loop) / len(loop)
    out = []
    for x, y in loop:
        dx, dy = x - cx, y - cy
        length = math.hypot(dx, dy) or 1
        out.append((x - dx / length * distance, y - dy / length * distance))
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
    tall = mount['partId'] == TALL

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

    def tube(label, rings, material, smooth=False, caps=(True, True)):
        """Closed prism through equal-length rings of 3D points, bottom ring first."""
        k = len(rings[0])
        points = [p for ring in rings for p in ring]
        faces = [(r * k + i, r * k + (i + 1) % k, (r + 1) * k + (i + 1) % k, (r + 1) * k + i)
                 for r in range(len(rings) - 1) for i in range(k)]
        if caps[0]:
            faces.append(tuple(range(k - 1, -1, -1)))
        if caps[1]:
            faces.append(tuple(range((len(rings) - 1) * k, len(rings) * k)))
        return put(mesh(name + '.' + label, points, faces, material, col, smooth))

    # The visible gunhouse is exactly the catalog's armor shell, so the raked
    # face, the tumblehome flanks and the rounded back stay with their plates.
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
        return max(h.x for h in hits) if hits else 5.85

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else .30

    # Rotating sole and the raised working platform. The platform is the
    # reference's forward disc segment, cut off square under the rear sponsons;
    # the ship owns the fixed barbette below the sole.
    put(cyl(name + '.turntable', (0, 0, .15), 6.90, .30, naval, col, 32))
    cut = math.radians(135)
    arc = [(6.80 * math.cos(-cut + 2 * cut * i / 26), 6.80 * math.sin(-cut + 2 * cut * i / 26)) for i in range(27)]
    ring = _ccw(arc)
    tube('working-platform', [[(x, y, .30) for x, y in ring], [(x, y, .50) for x, y in ring]], naval)

    # ---- sliding barrels ------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # One connected surface: the constant jacket that carries the cuff
        # through full recoil, the chase shoulder and the tapering chase.
        profile = [(.45, SLEEVE), (JACKET, SLEEVE), (6.06, .398), (6.09, .358),
                   (13.45, .291), (13.48, .343), (length, .343)]
        count = 16
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        # The rim band laps back over the chase so the muzzle face, the bore
        # wall and the tube stay one connected surface.
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length - .12, .330), (length, .352), (length, bore), (length - .55, bore)]
               for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(3) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .60, 0, 0), (length - .52, 0, 0), bore + .006, dark, col, vertices=count), recoil)

    # ---- rear corner sponsons and their haunches -------------------------
    for sign in [1, -1]:
        plan = _ccw([(x, sign * y) for x, y in SPONSON])
        crown = [(x, y, _span(SPONSON_TOP, x, 1)) for x, y in plan]
        tube('rear-sponson',
             [[(x, y, .50) for x, y in plan],
              [(x, y, z - .22) for (x, y), (_, _, z) in zip(plan, crown)],
              [(x, y, z) for (x, y), (_, _, z) in zip(_inset(plan, .16), crown)]], naval)
        # Buttress under the sponson: vertical sides, merged into the flank.
        haunch = []
        for x, yout, ztop in [(-8.88, 4.58, 2.62), (-5.55, 4.90, 2.98)]:
            haunch.append([(x, sign * 3.70, .32), (x, sign * yout, .32), (x, sign * yout, ztop - .20),
                           (x, sign * (yout - .14), ztop), (x, sign * 3.70, ztop)])
        if sign < 0:
            haunch = [list(reversed(r)) for r in haunch]
        tube('sponson-haunch', haunch, naval)
        # Round hatch hood on the sponson crown and two rubbing pads outboard.
        put(cyl(name + '.sponson-hood', (-8.80, sign * 6.00, 2.57), .50, .44, naval, col, 14))
        for x in [-7.64, -6.27]:
            put(box(name + '.sponson-pad', (x, sign * 6.56, .89), (.35, .22, .25), painted, col))
        # Access door in the sponson's forward face, with its rain cap.
        put(box(name + '.sponson-door', (-5.62, sign * 5.89, 1.75), (.36, 1.19, 1.80), painted, col))
        put(box(name + '.sponson-door-cap', (-5.60, sign * 5.88, 2.66), (.33, 1.34, .15), naval, col))
        for z in [1.20, 2.30]:
            put(box(name + '.sponson-door-handle', (-5.52, sign * 5.16, z), (.29, .17, .10), edge, col))
        # Ready-use locker seated flush on the sloping flank forward of it.
        lean = math.atan2(5.09 - 3.85, 3.71 - .30)
        locker = put(box(name + '.flank-locker', (-5.07, sign * 4.93, 1.76), (1.06, .60, 1.75), naval, col))
        locker.rotation_euler.x = sign * lean

    # ---- variant structures ---------------------------------------------
    if tall:
        # Raised rear platform: a trunk wrapped around the rounded back plate,
        # its deck, the bulwark, the cylindrical hood and the AA pads.
        trunk = _ccw([(x, y) for x, y in TRUNK] + [(x, -y) for x, y in reversed(TRUNK[:-1])])
        tube('rear-trunk', [[(x, y, 1.21) for x, y in trunk], [(x, y, 3.36) for x, y in trunk]], naval)
        deck = _ccw([(x, y) for x, y in DECK] + [(x, -y) for x, y in reversed(DECK[:-1])])
        tube('rear-deck', [[(x, y, 3.36) for x, y in deck], [(x, y, 3.45) for x, y in deck]], naval)
        # Bulwark: an upstand around the deck rim, open across the forward step.
        rail = DECK + [(x, -y) for x, y in reversed(DECK[:-1])]
        outer = rail
        inner = _inset(_ccw(rail), .14)
        inner = inner if _ccw(rail) == rail else list(reversed(inner))
        wall = _ccw(list(outer) + list(reversed(inner)))

        def crest(x):
            return 4.21 + min(.20, max(0, (-x - 7.36) * .12))
        tube('rear-bulwark', [[(x, y, 3.42) for x, y in wall], [(x, y, crest(x)) for x, y in wall]], naval)
        for x, y, height in [(-7.42, 3.73, .79), (-8.21, 4.00, .88), (-9.06, 4.29, .99),
                             (-10.37, 3.76, .99), (-10.94, 2.47, .99), (-11.18, 1.11, .99)]:
            for sign in [1, -1]:
                put(box(name + '.bulwark-stiffener', (x, sign * y, 3.42 + height / 2), (.10, .10, height), painted, col))
        # Step up from the roof into the tub, and the sighting hood itself.
        put(box(name + '.platform-step', (-6.92, 0, 3.28), (.76, 7.49, .29), naval, col))
        put(cyl(name + '.rear-hood', (-7.62, 0, 3.635), 1.00, 1.47, naval, col, 14))
        put(cyl(name + '.rear-hood-cap', (-7.62, 0, 4.40), .96, .09, roof, col, 14))
        for offset in [-.30, .30]:
            put(box(name + '.rear-hood-window', (-8.57, offset, 3.90), (.10, .42, .16), glass, col))
        for sign in [1, -1]:
            put(cyl(name + '.aa-pad', (-9.048, sign * 2.415, 3.50), .30, .14, painted, col, 12))
            put(box(name + '.deck-cleat', (-7.88, sign * 2.50, 3.51), (.17, .10, .17), painted, col))
            put(box(name + '.stern-locker', (-10.72, sign * .46, 3.91), (1.11, .55, .92), naval, col))
        # Ladder from the flank to the roof, port and starboard.
        for sign in [1, -1]:
            foot, head = (5.13, .47), (3.80, 3.53)
            run = math.hypot(foot[0] - head[0], head[1] - foot[1])
            normal = ((head[1] - foot[1]) / run, (foot[0] - head[0]) / run)
            for x in [-4.20, -3.79]:
                put(rod(name + '.ladder-rail', (x, sign * (foot[0] + normal[0] * .05), foot[1] + normal[1] * .05),
                        (x, sign * (head[0] + normal[0] * .05), head[1] + normal[1] * .05), .03, painted, col, vertices=4))
                for t in [.12, .50, .88]:
                    py = foot[0] + (head[0] - foot[0]) * t
                    pz = foot[1] + (head[1] - foot[1]) * t
                    put(rod(name + '.ladder-standoff', (x, sign * (py - normal[0] * .04), pz - normal[1] * .04),
                            (x, sign * (py + normal[0] * .05), pz + normal[1] * .05), .022, painted, col, vertices=4))
            for i in range(10):
                t = (.06 + i * .098)
                py = foot[0] + (head[0] - foot[0]) * t + normal[0] * .05
                pz = foot[1] + (head[1] - foot[1]) * t + normal[1] * .05
                put(rod(name + '.ladder-rung', (-4.20, sign * py, pz), (-3.79, sign * py, pz), .02, painted, col, vertices=4))
            # Grab hoop standing over the roof edge at the ladder head.
            put(rod(name + '.ladder-hoop', (-4.00, sign * 3.76, 3.52), (-4.00, sign * 3.74, 4.05), .025, painted, col, vertices=4))
            put(rod(name + '.ladder-hoop', (-4.00, sign * 3.74, 4.05), (-4.00, sign * 3.44, 4.08), .025, painted, col, vertices=4))
            put(rod(name + '.ladder-hoop', (-4.00, sign * 3.44, 4.08), (-4.00, sign * 3.42, 3.70), .025, painted, col, vertices=4))
        # Guard strips flanking the centre gun port on the raked face.
        for sign in [1, -1]:
            put(rod(name + '.face-strip', (5.78, sign * .77, .54), (4.70, sign * .77, 2.60), .035, painted, col, vertices=4))
    else:
        # First turret: no rear platform. A boat stowage on the working
        # platform, a ladder up the face and another up the rounded back.
        for sign in [1, -1]:
            for y in [5.35, 6.45]:
                put(box(name + '.boat-skid', (0, sign * y, .53), (2.04, .12, .14), naval, col))
            for x in [-.89, .88]:
                put(box(name + '.boat-chock', (x, sign * 5.90, .72), (.10, 1.22, .48), naval, col))
        # Face ladder, port side of the centre gun as on the reference.
        for x in [1.07, 1.50]:
            put(rod(name + '.face-ladder-rail', (5.86, x, .48), (4.68, x, 2.68), .022, painted, col, vertices=4))
        for i in range(6):
            t = .08 + i * .168
            put(rod(name + '.face-ladder-rung', (5.86 - 1.18 * t, 1.07, .48 + 2.20 * t),
                    (5.86 - 1.18 * t, 1.50, .48 + 2.20 * t), .018, painted, col, vertices=4))
        # Back-plate ladder and the hook that carries it over onto the roof.
        for sign in [1, -1]:
            put(rod(name + '.rear-ladder-rail', (-9.89, sign * .21, .38), (-9.89, sign * .21, 2.58), .022, painted, col, vertices=4))
            for z in [.70, 1.60, 2.45]:
                put(rod(name + '.rear-ladder-standoff', (-9.78, sign * .21, z), (-9.89, sign * .21, z), .018, painted, col, vertices=4))
        for i in range(7):
            z = .55 + i * .31
            put(rod(name + '.rear-ladder-rung', (-9.89, -.21, z), (-9.89, .21, z), .018, painted, col, vertices=4))
        for sign in [1, -1]:
            put(rod(name + '.rear-ladder-hook', (-9.89, sign * .21, 2.45), (-9.62, sign * .10, 3.00), .024, painted, col, vertices=4))
        put(rod(name + '.rear-ladder-hoop', (-9.62, -.10, 3.00), (-9.62, .10, 3.00), .024, painted, col, vertices=4))
        # Local-control hood on the roof crown.
        put(box(name + '.roof-hood', (-.52, 0, 3.68), (.40, .54, .81), naval, col))
        put(box(name + '.roof-hood-window', (-.32, 0, 3.90), (.04, .30, .18), glass, col))

    # Raised deflector strips along the front of the roof, clear of the centre
    # bay, as on both reference visuals.
    for sign in [1, -1]:
        strip = [(4.66, sign * .80), (4.66, sign * 3.64), (3.42, sign * 3.73), (3.42, sign * .80)]
        if sign < 0:
            strip = list(reversed(strip))
        tube('roof-lip', [[(x, y, top_z(x, y) - .01) for x, y in strip],
                          [(x, y, top_z(x, y) + .05) for x, y in strip]], roof)

    # ---- pleated canvas seals -------------------------------------------
    # The fixed seam is cast onto the real face and returns over the front roof
    # knuckle, where the tall port opens at maximum elevation; the cuff rides
    # the constant jacket through elevation and recoil.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            yy = y + .70 * math.copysign(abs(math.cos(a)) ** .80, math.cos(a))
            zz = 1.63 + 1.12 * math.copysign(abs(math.sin(a)) ** .70, math.sin(a))
            seam.append((front_x(yy, zz) + .03, yy, zz))
        cover = create_bloomer(mount, col, helpers, palette, side, seam,
                               spec['trunnionForward'] + COLLAR, SLEEVE + .045, rings=5,
                               fold_depth=.07, slack=.20, fullness=.12)
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
                plate = cast((20, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .04)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < SLEEVE + .065:
                    for i in range(3):
                        point.co[i] += radial[i] * ((SLEEVE + .065) / distance - 1)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

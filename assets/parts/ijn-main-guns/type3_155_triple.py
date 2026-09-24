"""Original 15.5 cm/60 3rd Year Type triple, the Yamato secondary turret.

Visual proportions follow the approved GameModels3D pjsb018 A_ATBA artillery
(`jgs156_155mm_60_type3`). No reference geometry is loaded here. The catalog
owns the closed armour shell and the weapon data; this recipe draws that shell
and adds the barbette lip, the open gun recess with its elevating blast bags,
guard hoops and gunlayers' hoods, the rangefinder hoods, sliding barrels,
ladders, handrails and roof fittings.

Authoring frame: +X muzzle, +Y port, +Z up, origin on the yaw datum. The Yamato
blueprint places that datum 0.253 m below the reference hardpoint; the lip ring
here fills the gap to the gunhouse floor, so the ship supplies its fixed
barbette only up to the datum.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout

# Reference datum: our yaw datum sits DZ below the reference hardpoint.
DZ = .253
SILL = .79 + DZ           # recess floor between the cheeks
BACK = 1.55               # recess back wall (x)
SILL_EDGE = 2.90          # front edge of the recess floor
RECESS = 1.91             # recess half-width (cheek inner walls)
ROOF_FRONT = 2.21 + DZ    # roof edge over the recess back wall
BAG_HALF = .33            # blast-bag half-width; the slots are .70 wide
BLOCK = (.36, 1.19)       # inter-gun block lateral span (|y|)

# Blast bag (elevating, does not recoil), in the elevation frame: x along the
# bore from the trunnion, z up. (x, bottom, top, half-width). The hood top stays
# inside 0.93 m of the trunnion wherever it can swing past the roof edge, and
# the lower edge clears the recess floor and skirt at full depression.
BAG = [(-.20, .34, .90, BAG_HALF), (.20, .24, .88, BAG_HALF), (.45, .12, .78, BAG_HALF),
       (.70, .02, .64, BAG_HALF), (.95, -.05, .50, BAG_HALF), (1.15, -.08, .44, BAG_HALF),
       (1.40, -.36, .40, .32), (1.69, -.52, .36, .30), (2.09, -.42, .34, .285),
       (2.45, -.29, .31, .27), (2.60, -.25, .28, .26)]
# Barrel profile along the recoil frame: (x, radius). The chase keeps the
# reference's thick reinforce to 5.45 m, a stepped shoulder, then tapers to a
# slightly swollen muzzle.
CHASE = [(1.85, .235), (3.66, .235), (3.72, .205), (3.76, .198), (7.08, .142), (7.12, .163), (7.283, .163)]


def create_yamato_secondary(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    col = collection
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    palette.setdefault('canvas', palette['naval'])
    naval, roof, edge, dark, painted, glass, canvas = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass', 'canvas'])
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

    def outward(obj):
        # Closed authored solids: orient every face away from the interior.
        data = bmesh.new()
        data.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(data, faces=data.faces)
        data.to_mesh(obj.data)
        data.free()
        return obj

    def rail(label, points, radius=.018, material=None, sides=4, parent=None):
        # One swept tube per path: bends share a mitred ring, so a hoop or a
        # handrail is a single connected bar rather than a chain of capped rods.
        points = [Vector(p) for p in points]
        if len(points) == 2:
            return put(rod(name + '.' + label, points[0], points[1], radius, material or painted, col, vertices=sides), parent)
        normal = None
        rings = []
        for i, point in enumerate(points):
            ahead = (points[min(i + 1, len(points) - 1)] - point).normalized() if i < len(points) - 1 else None
            behind = (point - points[i - 1]).normalized() if i else None
            tangent = ((ahead or behind) + (behind or ahead)).normalized()
            scale = 1.0 if ahead is None or behind is None else 1 / max(.5, ahead.dot(tangent))
            if normal is None:
                normal = tangent.orthogonal().normalized()
            normal = (normal - tangent * normal.dot(tangent)).normalized()
            binormal = tangent.cross(normal)
            rings.append([tuple(point + (normal * math.cos(math.tau * k / sides) + binormal * math.sin(math.tau * k / sides)) * radius * scale)
                          for k in range(sides)])
        return loft(label, rings, material or painted, parent, smooth=False)

    def loft(label, sections, material, parent=None, caps=(True, True), smooth=True):
        count = len(sections[0])
        points = [p for ring in sections for p in ring]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(sections) - 1) for i in range(count)]
        if caps[0]:
            faces.append(tuple(reversed(range(count))))
        if caps[1]:
            faces.append(tuple(range((len(sections) - 1) * count, len(sections) * count)))
        return put(mesh(name + '.' + label, points, faces, material, col, smooth), parent)

    # --- armour shell ---------------------------------------------------
    # The visible gunhouse is exactly the catalog's shell, so the rounded
    # rear, the rangefinder housing and its arms, the raked cheeks and the
    # open gun recess stay aligned with their protection.
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

    def top_z(x, y):
        hits = cast((x, y, 20), (0, 0, -1))
        return max(h.z for h in hits) if hits else 0.0

    def side_y(x, z, sign):
        hits = cast((x, sign * 20, z), (0, -sign, 0))
        return max(abs(h.y) for h in hits) if hits else 0.0

    def rear_x(y, z):
        hits = cast((-20, y, z), (1, 0, 0))
        return min(h.x for h in hits) if hits else 0.0

    # --- barbette lip ----------------------------------------------------
    # The ship's fixed barbette ends at the yaw datum. The reference carries it
    # 5 cm higher, then steps in to a shadowed roller ring under the gunhouse
    # base plate.
    floor = spec['gunhouseBaseHeight']
    put(cyl(name + '.barbette-lip', (0, 0, .0265), spec['barbetteRadius'], .053, naval, col, 40))
    put(cyl(name + '.roller-ring', (0, 0, .153), 3.25, .20, dark, col, 40))
    put(cyl(name + '.base-plate', (0, 0, (.253 + floor) / 2), 2.98, floor - .253, naval, col, 40))

    # --- guns: elevating blast bags and sliding barrels ------------------
    bore = spec['caliberM'] / 2
    length = spec['muzzleForward'] - spec['trunnionForward']
    count = 16
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # Blast bag: a hood over the breech that sweeps down into a bell round
        # the chase. Sections are rounded rectangles; it pitches with the gun
        # and the chase recoils through its mouth.
        rings = []
        for x, bottom, top, half in BAG:
            mid, height = (top + bottom) / 2, (top - bottom) / 2
            ring = []
            for i in range(14):
                a = math.tau * i / 14
                c, s = math.cos(a), math.sin(a)
                ring.append((x, half * math.copysign(abs(c) ** .55, c), mid + height * math.copysign(abs(s) ** .55, s)))
            rings.append(ring)
        loft('blast-bag', rings, canvas, elevation, caps=(True, False))
        # Mouth ring and collar where the chase leaves the bag.
        x0, bottom, top, half = BAG[-1]
        mouth = [(x0, p[1], p[2]) for p in rings[-1]]
        inner = [(x0, .245 * math.cos(math.tau * i / 14), .245 * math.sin(math.tau * i / 14)) for i in range(14)]
        loft('blast-bag-mouth', [mouth, inner], canvas, elevation, caps=(False, False), smooth=False)
        loft('bag-collar', [[(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for i in range(count)]
                            for x, r in [(2.50, .262), (2.66, .262)]], edge, elevation, caps=(False, True), smooth=False)

        # Chase: one connected turned surface long enough to stay inside the
        # bag through the full recoil stroke.
        loft('barrel', [[(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for i in range(count)]
                        for x, r in CHASE], edge, recoil, caps=(True, False))
        rim = [[(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for i in range(count)]
               for x, r in [(length, CHASE[-1][1]), (length, bore), (length - .45, bore)]]
        loft('muzzle-rim', rim, edge, recoil, caps=(False, False), smooth=False)
        put(rod(name + '.bore-interior', (length - .47, 0, 0), (length - .45, 0, 0), bore, dark, col, vertices=count), recoil)

        # Dark chamber behind each slot so an elevated gun shows a port, not
        # a lit wall. Named with the gunhouse: the gun passes into it.
        put(box(name + '.gunhouse.port-chamber', (BACK + .006, y, (SILL + ROOF_FRONT) / 2), (.012, 2 * BAG_HALF + .04, ROOF_FRONT - SILL - .04), dark, col))

    # --- inter-gun blocks, gunlayers' hoods and guard hoops --------------
    block_profile = [(BACK, 2.20 + DZ), (2.00, 2.10 + DZ), (2.25, 2.00 + DZ), (2.50, 1.80 + DZ), (2.75, 1.40 + DZ), (2.93, SILL + .12), (2.93, SILL), (BACK, SILL)]
    k = len(block_profile)
    for sign in (1, -1):
        y0, y1 = sign * BLOCK[0], sign * BLOCK[1]
        points = [(x, y, z) for y in (y0, y1) for x, z in block_profile]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
        if sign < 0:
            faces = [tuple(reversed(f)) for f in faces]
        outward(put(mesh(name + '.gun-block', points, faces, naval, col)))
        cy = sign * sum(BLOCK) / 2
        # Gunlayer's hood: a roof box running forward over the block, its
        # sloped visor carrying the sight window.
        put(box(name + '.layer-hood', (1.00, cy, 2.635), (1.20, .60, .39), naval, col))
        visor = [(1.58, 2.02 + DZ), (1.94, 1.86 + DZ), (1.94, 2.28 + DZ), (1.58, 2.50 + DZ)]
        points = [(x, cy + d, z) for d in (-.30, .30) for x, z in visor]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        outward(put(mesh(name + '.layer-visor', points, faces, naval, col)))
        put(box(name + '.layer-window', (1.945, cy, 2.07 + DZ), (.02, .38, .22), glass, col))
        # Guard hoops arching over the slots from the roof to the skirt, on
        # both edges of each block, with a shorter inner hoop and ties.
        for y in (y0 + sign * .025, y1 - sign * .025):
            outer = [(1.30, y, 2.14 + DZ), (1.70, y, 2.47 + DZ), (2.30, y, 2.55 + DZ), (2.75, y, 2.41 + DZ),
                     (3.05, y, 2.10 + DZ), (3.18, y, 1.62 + DZ), (3.12, y, 1.08 + DZ), (3.02, y, .60 + DZ)]
            inner = [(1.72, y, 2.12 + DZ), (2.02, y, 2.40 + DZ), (2.40, y, 2.42 + DZ), (2.72, y, 2.08 + DZ), (2.86, y, 1.30 + DZ)]
            rail('guard-hoop', outer, .022, painted, 6)
            rail('guard-hoop', inner, .018, painted, 6)
            for a, b in [(inner[1], outer[1]), (inner[3], outer[3])]:
                rail('guard-hoop-tie', [a, b], .014, painted, 4)

    # --- rangefinder hoods -----------------------------------------------
    # Open-fronted boxes on the forward faces of the rangefinder arms, their
    # windows behind a grille.
    for sign in (1, -1):
        y0, y1 = sign * 3.70, sign * 4.39
        cy, w = (y0 + y1) / 2, abs(y1 - y0)
        z0, z1 = 2.17 + DZ, 3.39 + DZ
        x0, x1 = -1.52, -.90
        put(box(name + '.rangefinder-hood-back', (x0 + .03, cy, (z0 + z1) / 2), (.06, w, z1 - z0), naval, col))
        put(box(name + '.rangefinder-window', (x0 + .07, cy, (z0 + z1) / 2), (.02, w - .16, z1 - z0 - .16), dark, col))
        for label, loc, dim in [('top', (0, cy, z1 - .03), (x1 - x0, w, .06)), ('bottom', (0, cy, z0 + .03), (x1 - x0, w, .06)),
                                ('side', (0, y0 + sign * .03, (z0 + z1) / 2), (x1 - x0, .06, z1 - z0)),
                                ('side', (0, y1 - sign * .03, (z0 + z1) / 2), (x1 - x0, .06, z1 - z0))]:
            put(box(name + '.rangefinder-hood-' + label, ((x0 + x1) / 2, loc[1], loc[2]), dim, naval, col))
        for t in (1 / 3, 2 / 3):
            yy = y0 + (y1 - y0) * t
            rail('rangefinder-grille', [(x1 - .03, yy, z0 + .05), (x1 - .03, yy, z1 - .05)], .016, painted)
        for t in (.25, .5, .75):
            zz = z0 + (z1 - z0) * t
            rail('rangefinder-grille', [(x1 - .03, y0 + sign * .05, zz), (x1 - .03, y1 - sign * .05, zz)], .016, painted)

    # --- roof fittings ---------------------------------------------------
    # Periscope cupola on the port roof, an octagonal drum with a sight slit.
    cz = top_z(-.08, .78)
    put(cyl(name + '.cupola', (-.08, .78, cz + .20), .40, .40, naval, col, 8))
    put(cyl(name + '.cupola-cap', (-.08, .78, cz + .45), .33, .10, roof, col, 8))
    put(box(name + '.cupola-slit', (.27, .78, cz + .30), (.06, .34, .08), glass, col))
    # Steps up the rangefinder housing's slopes on the starboard side.
    for x, y in [(-3.50, -1.55), (-3.25, -1.55), (-3.00, -1.55), (-1.45, -1.97), (-1.20, -1.97), (-.95, -1.97), (-.70, -1.97)]:
        put(box(name + '.housing-step', (x, y, top_z(x, y) + .03), (.12, .22, .08), painted, col))

    # Handrails: round the rear roof and along the forward flanks.
    def stations(points, height=.85):
        tops = []
        for x, y in points:
            z = top_z(x, y)
            put(rod(name + '.rail-post', (x, y, z - .02), (x, y, z + height), .018, painted, col, vertices=4))
            tops.append((x, y, z + height))
        return tops
    rear = [(-3.95, 2.70), (-4.35, 2.25), (-4.62, 1.55), (-4.85, .80), (-4.92, 0)]
    rear = rear + [(x, -y) for x, y in reversed(rear[:-1])]
    rail('rail', stations(rear), .016)
    for sign in (1, -1):
        rail('rail', stations([(-.35, sign * 2.72), (.45, sign * 2.72), (1.25, sign * 2.70)]), .016)

    # --- ladders ---------------------------------------------------------
    for sign in (1, -1):
        # Flank ladder to the roof edge, on standoffs off the side plate.
        wall = side_y(-.05, 1.2, sign)
        for x in (-.23, .12):
            rail('flank-ladder-rail', [(x, sign * (wall + .07), .40), (x, sign * (wall + .07), 2.30)], .022)
            for z in (.55, 1.40, 2.20):
                rail('flank-ladder-standoff', [(x, sign * (wall - .01), z), (x, sign * (wall + .07), z)], .016)
        for i in range(7):
            z = .55 + i * .27
            rail('flank-ladder-rung', [(-.23, sign * (wall + .07), z), (.12, sign * (wall + .07), z)], .016)
        # Cheek-front ladder climbing the rounded nose, 6 cm off the plate.
        nose = [(3.05, .30), (2.93, 1.04), (2.70, 1.75), (2.25, 2.27), (2.00, 2.38)]
        for y in (sign * 2.02, sign * 2.37):
            rail('nose-ladder-rail', [(x + .06, y, z) for x, z in nose[:-1]] + [(nose[-1][0], y, nose[-1][1] + .06)], .02)
            # Standoffs weld the rails to the nose plate.
            for x, z in nose[1:-1]:
                rail('nose-ladder-standoff', [(x - .01, y, z), (x + .06, y, z)], .016)
            rail('nose-ladder-standoff', [(nose[-1][0], y, nose[-1][1] - .03), (nose[-1][0], y, nose[-1][1] + .06)], .016)
        for (xa, za), (xb, zb) in zip(nose, nose[1:]):
            steps = max(1, round(math.hypot(xb - xa, zb - za) / .30))
            for i in range(steps):
                t = i / steps
                x, z = xa + (xb - xa) * t + .06, za + (zb - za) * t
                rail('nose-ladder-rung', [(x, sign * 2.02, z), (x, sign * 2.37, z)], .016)
        # Block-front ladder from the deck edge up the skirt to the block.
        for y in (sign * .60, sign * .95):
            rail('block-ladder-rail', [(3.10, y, .35), (3.00, y, SILL + .10), (2.90, y, 1.45 + DZ)], .02)
            for a, b in [((3.02, y, .42), (3.10, y, .42)), ((2.92, y, SILL + .10), (3.00, y, SILL + .10)), ((2.70, y, 1.45 + DZ), (2.90, y, 1.45 + DZ))]:
                rail('block-ladder-standoff', [a, b], .016)
        for i in range(5):
            t = i / 4
            x, z = 3.10 + (2.90 - 3.10) * t, .45 + (1.40 + DZ - .45) * t
            rail('block-ladder-rung', [(x, sign * .60, z), (x, sign * .95, z)], .016)

    # Raised plate frame round each flank panel: along the eave, down the
    # rounded nose and back along the foot, 1 cm proud of the side plate.
    frame = [(-3.95, .45), (-3.95, 2.30), (-1.50, 2.30), (1.45, 2.30), (2.12, 2.16), (2.55, 1.70), (2.76, 1.05), (2.86, .45), (-1.50, .45), (-3.95, .45)]
    for sign in (1, -1):
        rail('flank-frame', [(x, sign * (side_y(x, z, sign) + .01), z) for x, z in frame], .02, naval)

    # Rear rain brows over the two rear doors.
    for sign in (1, -1):
        ya, yb = sign * .06, sign * 1.08
        z = 1.76 + DZ
        brow = [(rear_x(ya, z) - .03, ya, z - .08), (rear_x(ya, z) - .06, ya + sign * .10, z),
                (rear_x(yb, z) - .06, yb - sign * .10, z), (rear_x(yb, z) - .03, yb, z - .08)]
        rail('rear-brow', brow, .02)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

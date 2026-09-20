"""Original BL 6-inch/50 Mk XXI twin, the Leander-class cruiser main turret.

Visual proportions follow the approved GameModels3D artillery visual `bgm021_6in50_mk_xxi`
as fitted on pbsc106 (Leander, configurations A1 and B1, four mounts). The gun itself is the
6-inch Mk XXIII; Mk XXI is the twin mounting, and the reference visual carries that designation.
No reference geometry is loaded here. The catalog owns the closed armor shell and the weapon
data; this recipe draws that shell and adds the roller plate, the sliding guns on their cradles,
the projecting gun cowls, the centre sighting tower and the service fittings.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout

SLEEVE = .265    # sliding jacket radius through the gun-port ring
WELL_W = .31     # half width of a gun recess, matching the catalog shell
SILL = .95       # recess floor height
BACK = 1.23      # recess back plate
ROOF_Z = 2.14


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
    # The glacis is one plane through the floor front edge and the roof front edge.
    rake = (2.40 - BACK) / (ROOF_Z - base)

    def glacis_x(z):
        return 2.40 - rake * (z - base)

    put(cyl(name + '.turntable', (0, 0, base / 2), spec['barbetteRadius'], base, naval, col, 36))

    # ---- guns -------------------------------------------------------------
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (trunnion, y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # Four-step gun: jacket, chase shoulder, chase, muzzle swell, matching
        # the approved model's barrel components.
        profile = [(.02, .225), (.06, SLEEVE), (.87, SLEEVE), (.91, .24), (1.87, .24),
                   (1.91, .20), (2.90, .20), (2.94, .148), (length - .10, .134), (length, .142)]
        count = 14
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .142), (length, bore), (length - .36, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.bore-interior', (length - .38, 0, 0), (length - .36, 0, 0), bore, dark, col, vertices=count), recoil)

        # Cradle, trunnions and the recoil pair, riding the elevation joint.
        put(box(name + '.cradle', (.52, 0, -.20), (.76, .30, .26), edge, col), elevation)
        put(box(name + '.cradle-cheek', (.08, 0, -.13), (.24, .54, .44), edge, col), elevation)
        for pin in [1, -1]:
            put(rod(name + '.trunnion-pin', (0, pin * .24, 0), (0, pin * .33, 0), .10, edge, col), elevation)
        for lane in [.19, -.19]:
            put(rod(name + '.recoil-cylinder', (.04, lane, -.23), (.80, lane, -.23), .07, edge, col), elevation)
            put(rod(name + '.recuperator-head', (.80, lane, -.23), (.88, lane, -.23), .085, edge, col), elevation)

        # Flared gun-port ring on the recess back plate. 'port' in the name keeps
        # it out of the clearance sweep, as the jacket runs straight through it.
        ring = [(BACK + d, y + (.40 - .13 * i) * math.cos(math.tau * k / 16),
                 pivot + (.40 - .13 * i) * math.sin(math.tau * k / 16))
                for i, d in enumerate([0, .18]) for k in range(16)]
        faces = [(i, (i + 1) % 16, 16 + (i + 1) % 16, 16 + i) for i in range(16)]
        put(mesh(name + '.gun-port-ring', ring, faces, painted, col))

        # Cowl: a curved rib on each lip of the recess, arching out past the
        # glacis and carrying the gun port clear of the plate.
        arc = [(BACK + .04, ROOF_Z - .02), (1.72, 1.88), (2.18, 1.24), (2.46, .98), (2.62, .90)]
        nx, nz = .874, .486          # glacis outward normal
        for wall in [WELL_W - .02, -WELL_W - .07]:
            band = [(x, z) for x, z in arc] + [(x - .19 * nx, z - .19 * nz) for x, z in arc[::-1]]
            k = len(arc)
            points = [(x, y + wall + t, z) for t in [0, .09] for x, z in band]
            n = 2 * k
            faces = []
            for i in range(k - 1):
                faces += [(i, i + 1, n - 2 - i, n - 1 - i),
                          (n + i + 1, n + i, 2 * n - 1 - i, 2 * n - 2 - i),
                          (i, n + i, n + i + 1, i + 1),
                          (n - 1 - i, n - 2 - i, 2 * n - 2 - i, 2 * n - 1 - i)]
            faces += [(0, n - 1, 2 * n - 1, n), (k - 1, n + k - 1, 2 * n - k, n - k)]
            put(mesh(name + '.gun-cowl', points, faces, naval, col))
        # Tunnel floor between the cowls: it falls away forward so the gun stays
        # clear of it at full depression.
        deck = [(glacis_x(.95), .95), (2.64, .87), (2.64, .79), (glacis_x(.87), .87)]
        k = len(deck)
        points = [(x, y + t, z) for t in [WELL_W, -WELL_W] for x, z in deck]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
        put(mesh(name + '.cowl-sill', points, faces, naval, col))

        # Training rail hanging on the glacis under each gun, as modelled.
        put(box(name + '.glacis-block', (2.48, y, .13), (.18, .31, .19), painted, col))
        put(rod(name + '.glacis-rail', (glacis_x(.30) + .06, y, .22), (glacis_x(.80) + .06, y, .84), .028, painted, col, vertices=6))

    # ---- centre sighting tower --------------------------------------------
    # A stepped pedestal climbing the glacis between the guns, with the fins and
    # the periscope column the reference carries above the roof.
    tower = [(2.62, 1.02), (1.70, 1.02), (1.20, 1.96), (1.20, 2.10), (1.92, 2.10), (2.62, 1.12)]
    k = len(tower)
    points = [(x, t, z) for t in [.19, -.19] for x, z in tower]
    faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
    faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
    put(mesh(name + '.sight-tower', points, faces, naval, col))
    for sign in [1, -1]:
        fin = [(2.60, 1.06), (2.02, 1.86), (1.86, 1.86), (2.42, 1.06)]
        k = len(fin)
        points = [(x, sign * t, z) for t in [.28, .34] for x, z in fin]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
        put(mesh(name + '.sight-fin', points, faces, painted, col))
        put(box(name + '.sight-lug', (2.14, sign * .24, 1.40), (.10, .16, .09), painted, col))
    put(box(name + '.sight-cap', (1.78, 0, 2.20), (.32, .44, .22), naval, col))
    put(cyl(name + '.periscope', (1.80, 0, 2.55), .07, .52, painted, col, 10, .055))
    put(box(name + '.periscope-head', (1.80, 0, 2.82), (.14, .12, .12), painted, col))
    put(box(name + '.periscope-window', (1.87, 0, 2.82), (.03, .09, .07), glass, col))

    # ---- roof and rear fittings -------------------------------------------
    put(box(name + '.roof-vent', (-3.78, 0, top_z(-3.78, 0) + .07), (.22, .22, .14), naval, col))
    for x, ly in [(-4.13, 1.62), (-1.60, 2.30), (0.55, 2.28)]:
        for sign in [1, -1]:
            put(box(name + '.roof-lug', (x, sign * ly, top_z(x, sign * ly) + .06), (.10, .18, .12), painted, col))
    for sign in [1, -1]:
        for z in [.36, 1.18]:
            put(box(name + '.rear-step', (rear_x(sign * .70, z) + .05, sign * .70, z), (.14, .41, .18), painted, col))
        stile = rear_x(sign * 1.36, .74) - .05
        put(rod(name + '.rear-stile', (stile, sign * 1.36, .42), (stile, sign * 1.36, 1.05), .04, painted, col, vertices=6))
        put(box(name + '.rear-cleat', (stile + .03, sign * 1.36, .73), (.12, .07, .18), painted, col))

        # Hand rail on brackets along each flank.
        rail = []
        for i in range(7):
            x = -3.60 + i * .62
            rail.append((x, sign * (side_y(x, 1.62) + .10), 1.62))
        for a, b in zip(rail, rail[1:]):
            put(rod(name + '.side-rail', a, b, .032, painted, col, vertices=6))
        for i in [0, 2, 4, 6]:
            x, ry, z = rail[i]
            put(rod(name + '.side-rail-bracket', (x, sign * side_y(x, 1.62), z), (x, ry, z), .03, painted, col, vertices=4))

        # Vertical ladder on the after quarter.
        for lane in [-.10, .10]:
            oy = sign * (side_y(-3.95 + lane, 1.00) + .07)
            put(rod(name + '.ladder-rail', (-3.95 + lane, oy, .10), (-3.95 + lane, oy, 1.86), .028, painted, col, vertices=4))
        for i in range(6):
            z = .18 + i * .31
            oy = sign * (side_y(-3.95, 1.00) + .07)
            put(rod(name + '.ladder-rung', (-4.05, oy, z), (-3.85, oy, z), .022, painted, col, vertices=4))
        for z in [.30, 1.05, 1.74]:
            put(rod(name + '.ladder-standoff', (-3.95, sign * side_y(-3.95, z), z),
                    (-3.95, sign * (side_y(-3.95, 1.00) + .07), z), .024, painted, col, vertices=4))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

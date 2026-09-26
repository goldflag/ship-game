"""Original 6-inch/53 Mk 13 single mounts of the Omaha class: the open-backed drum on its
pedestal (upper forward casemates) and the closed casemate drum (the other six guns).

Visual proportions follow the approved GameModels3D pasc005 (Omaha) A artillery:
`agm159_6in53_mk13_single` (a sixteen-sided training drum 3.67 m across, open at the
back over a pedestal mount, 0.72 m above the yaw datum) and `agm160_6in53_mk13_single`
(the same drum closed, standing on the yaw datum, with only the chase outside it). Both
carry the gun 0.709 m above the drum's sole and work it through a slotted port in the
drum's flat face between two sighting ports. No reference geometry is loaded here. The
catalog owns the drum (the visible shell) and the weapon data; this recipe draws it and
adds the port, the pedestal and carriage, the slide, the breech and sights, and the gun.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum at the mount position.
"""
import bpy
import bmesh
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

FACE_X = 1.850      # the drum's flat face
GUN_OVER_SOLE = .7085


def _build(mount, col, helpers, materials, open_back):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    naval, roof, edge, dark, painted = (palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge'])
    name = mount['id']
    spec = mount['weapon']
    pivot = spec['pivotHeight']
    shape = spec['gunhouseMesh']
    sole = min(v[2] for v in shape['vertices'])
    top = max(v[2] for v in shape['vertices'])

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

    def solid(obj):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        return obj

    def plate(label, outline, x0, x1, material, parent=None):
        """Plate of constant (y, z) outline between two x stations."""
        k = len(outline)
        points = [(x, y, z) for x in (x0, x1) for y, z in outline]
        faces = [tuple(range(k)), tuple(range(k, 2 * k))] + [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return put(solid(mesh(name + '.' + label, points, faces, material, col)), parent)

    def slot(cy, cz, half_w, half_h, n=6):
        """Rounded vertical slot outline in (y, z)."""
        r = half_w
        pts = []
        for k in range(n + 1):
            a = math.pi * k / n
            pts.append((cy + r * math.cos(a), cz + half_h - r + r * math.sin(a)))
        for k in range(n + 1):
            a = math.pi + math.pi * k / n
            pts.append((cy + r * math.cos(a), cz - half_h + r + r * math.sin(a)))
        return pts

    # ---- drum: the catalog shell, with a liner where its back is open ----------------
    drum = put(mesh(name + '.drum', [tuple(v) for v in shape['vertices']], [f['indices'] for f in shape['faces']], naval, col))
    drum.data.materials.append(roof)
    for polygon, face in zip(drum.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    if open_back:
        focus = (0.0, 0.0, (sole + top) / 2)
        liner = [tuple(focus[k] + (v[k] - focus[k]) * .985 for k in range(3)) for v in shape['vertices']]
        put(mesh(name + '.drum-liner', liner, [tuple(reversed(f['indices'])) for f in shape['faces']], painted, col))
        # Jambs and sill round the open back.
        put(box(name + '.rear-jamb', (-1.80, .37, (sole + 2.2) / 2), (.08, .05, 2.2 - sole), painted, col))
        put(box(name + '.rear-jamb', (-1.80, -.37, (sole + 2.2) / 2), (.08, .05, 2.2 - sole), painted, col))
        put(box(name + '.rear-lintel', (-1.80, 0, 2.2), (.08, .78, .05), painted, col))
    # Roof rim and a hand rail round the roof edge.
    put(cyl(name + '.roof-rim', (0, 0, top + .012), 1.80, .024, painted, col, 32))

    # ---- face: slotted gun port between two sighting ports ------------------------
    cz = sole + .84
    port = slot(0, cz, .30, .72)
    plate('gun-port', port, FACE_X - .02, FACE_X + .004, dark)
    frame_out = slot(0, cz, .36, .78)
    for (y0, z0), (y1, z1) in zip(frame_out, frame_out[1:] + frame_out[:1]):
        put(rod(name + '.port-frame', (FACE_X + .01, y0, z0), (FACE_X + .01, y1, z1), .025, painted, col, vertices=5))
    for sign in [1, -1]:
        # Sighting port on the facet beside the face (reference: 0.52-0.79 m off the axis, 0.61 m tall).
        t = (.655 - .362) / (1.040 - .362)
        nx, ny = 1.040 - .362, FACE_X - 1.568
        norm = math.hypot(nx, ny)
        nx, ny = nx / norm, sign * ny / norm
        xc, yc = FACE_X - t * (FACE_X - 1.568), sign * .655
        heading = math.atan2(ny, nx)
        port_box = put(box(name + '.sight-port', (xc + nx * .004, yc + ny * .004, sole + .913), (.02, .27, .61), dark, col))
        port_box.rotation_euler.z = heading

    # ---- open mount: pedestal, carriage and training/elevating gear ---------------
    if open_back:
        put(cyl(name + '.base-plate', (0, 0, .061), .832, .122, painted, col, 8))
        put(cyl(name + '.training-ring', (0, 0, .212), .68, .26, naval, col, 24))
        put(cyl(name + '.ring-flange', (0, 0, .175), .711, .033, edge, col, 24))
        put(cyl(name + '.ring-flange', (0, 0, .277), .711, .081, edge, col, 24))
        put(cyl(name + '.pedestal', (0, 0, (0.307 + pivot - .30) / 2), .58, pivot - .30 - .307, naval, col, 16, .46))
        for sign in [1, -1]:
            # Elevating (port) and training (starboard) gear cases at the pedestal foot, their handwheels outboard.
            put(box(name + '.gear-case', (-.42, sign * .676, .302), (.85, .40, .337), naval, col))
            put(rod(name + '.gear-shaft', (.05, sign * .70, .40), (.05, sign * .70, .80), .04, edge, col, vertices=6))
            put(rod(name + '.handwheel', (.12, sign * .86, .72), (.12, sign * .90, .72), .20, edge, col, vertices=12))
            put(rod(name + '.handwheel-hub', (.12, sign * .70, .72), (.12, sign * .86, .72), .03, edge, col, vertices=6))
            # Trunnion cheeks of the carriage from the pedestal head to the trunnions.
            cheek = [(-.55, pivot - .62), (.45, pivot - .62), (.40, pivot + .12), (.10, pivot + .22), (-.45, pivot + .10)]
            k = len(cheek)
            pts = [(x, sign * y, z) for y in (.36, .44) for x, z in cheek]
            faces = [tuple(range(k)), tuple(range(k, 2 * k))] + [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
            put(solid(mesh(name + '.trunnion-cheek', pts, faces, naval, col)))
            put(rod(name + '.trunnion-cap', (0, sign * .44, pivot), (0, sign * .50, pivot), .15, edge, col, vertices=12))
            # Shield stanchions and arms carry the drum from the carriage.
            put(rod(name + '.shield-stanchion', (-.368, sign * .532, pivot - .42), (-.368, sign * .532, top - .02), .045, naval, col, vertices=8))
            put(rod(name + '.shield-arm', (.30, sign * .44, pivot - .40), (.30, sign * 1.80, pivot - .40), .05, naval, col, vertices=8))
            put(rod(name + '.shield-arm-stay', (-.30, sign * .44, pivot - .55), (.30, sign * 1.70, pivot - .40), .035, edge, col, vertices=6))
        put(box(name + '.pedestal-head', (-.05, 0, pivot - .60), (1.0, .90, .12), naval, col))

    # ---- elevating mass ------------------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    count = 16
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # Port shutter: a curved plate about the trunnions that closes the slot behind the face.
        arc = [(.95 * math.cos(math.radians(a)), .95 * math.sin(math.radians(a))) for a in range(-40, 44, 8)]
        pts = [(x, yy, z) for yy in (-.40, .40) for x, z in arc] + [(x - .05, yy, z) for yy in (-.40, .40) for x, z in arc]
        k = len(arc)
        faces = []
        for i in range(k - 1):
            faces += [(i, i + 1, k + i + 1, k + i), (2 * k + i, 3 * k + i, 3 * k + i + 1, 2 * k + i + 1),
                      (i, 2 * k + i, 2 * k + i + 1, i + 1), (k + i, k + i + 1, 3 * k + i + 1, 3 * k + i)]
        faces += [(0, k, 3 * k, 2 * k), (k - 1, 2 * k + k - 1, 3 * k + k - 1, 2 * k - 1)]
        put(solid(mesh(name + '.port-shutter', pts, faces, painted, col)), elevation)
        put(rod(name + '.port-collar', (FACE_X + .03, 0, 0), (FACE_X + .09, 0, 0), .33, painted, col, vertices=count), elevation)
        if open_back:
            # Slide, recoil cylinders, sights and the loading tray guard.
            put(box(name + '.slide', (-.37, 0, -.40), (1.99, .60, .30), naval, col), elevation)
            for flank in [1, -1]:
                put(box(name + '.slide-cheek', (-.37, flank * .36, -.10), (1.99, .06, .56), naval, col), elevation)
                put(rod(name + '.recoil-cylinder', (-1.30, flank * .22, -.45), (.60, flank * .22, -.45), .085, painted, col, vertices=10), elevation)
                put(rod(name + '.cylinder-head', (.60, flank * .22, -.45), (.66, flank * .22, -.45), .10, edge, col, vertices=10), elevation)
                put(box(name + '.sight-bracket', (-.40, flank * .52, .20), (.30, .06, .40), naval, col), elevation)
                put(rod(name + '.sight-telescope', (-.95, flank * .60, .36), (.10, flank * .60, .36), .045, edge, col, vertices=8), elevation)
                put(rod(name + '.sight-eyepiece', (-1.02, flank * .60, .36), (-.95, flank * .60, .36), .06, dark, col, vertices=8), elevation)
            put(box(name + '.tray-guard', (-1.85, 0, -.07), (.17, .78, .92), naval, col), elevation)
            put(box(name + '.loading-tray', (-2.2, 0, -.30), (.70, .34, .06), edge, col), elevation)
        # The gun: breech ring and block, jacket, chase and muzzle swell as one surface.
        if open_back:
            profile = [(-2.416, .338), (.754, .338), (.803, .297), (1.884, .241), (1.958, .206), (5.449, .120), (5.47, .125), (5.665, .125), (length, .113)]
        else:
            profile = [(-.40, .297), (.803, .297), (1.884, .241), (1.958, .206), (5.449, .120), (5.47, .125), (5.665, .125), (length, .113)]
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, painted, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for x, r in [(length, .113), (length, bore), (length - .30, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i) for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-face', rim, faces, edge, col), recoil)
        put(rod(name + '.bore', (length - .32, 0, 0), (length - .30, 0, 0), bore, dark, col, vertices=count), recoil)
        if open_back:
            put(rod(name + '.breech-ring', (-2.57, 0, 0), (-2.416, 0, 0), .47, naval, col, vertices=count), recoil)
            put(rod(name + '.breech-block', (-2.60, 0, 0), (-2.57, 0, 0), .30, edge, col, vertices=count), recoil)
            put(rod(name + '.breech-lever', (-2.62, -.20, .10), (-2.62, -.55, .30), .03, edge, col, vertices=6), recoil)
            put(rod(name + '.breech-hinge', (-2.60, .38, -.10), (-2.60, .38, .10), .05, edge, col, vertices=6), recoil)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw


def create_open_single(mount, col, helpers, materials):
    return _build(mount, col, helpers, materials, open_back=True)


def create_casemate(mount, col, helpers, materials):
    return _build(mount, col, helpers, materials, open_back=False)

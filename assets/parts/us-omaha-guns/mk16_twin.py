"""Original 6-inch/53 Mk 16 twin mount, the Omaha class's two centreline turrets.

Visual proportions follow the approved GameModels3D pasc005 (Omaha) A artillery,
`agm031_6in53_mk16_twin`: a slab-sided gunhouse 6.15 m long and 3.09 m wide on a
low turntable skirt, a cambered roof that falls to a vertical face, a bevelled rear,
an open-topped recess in the face that the two guns work out of, sight hoods on the
front roof corners, a pair of long tubes on brackets along each roof edge, footboards,
rungs and grab rails on the flanks. No reference geometry is loaded here. The catalog
owns the closed armour shell (recess included) and the weapon data; this recipe draws
that shell and adds the fittings, the port shields and the barrels.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the deck under the skirt.
"""
import bpy
import bmesh
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

SKIRT = 1.525    # turntable skirt radius (reference 3.05 m across)
FACE = 1.612     # vertical face
BACK = 0.884     # recess back wall
FLOOR = 0.408    # gunhouse sole


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    naval, roof, edge, dark, painted, glass = (palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'])
    name = mount['id']
    spec = mount['weapon']
    pivot = spec['pivotHeight']

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
        """Wind a closed mesh outward."""
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        return obj

    def prism(label, outline, z0, z1, material, parent=None):
        """Closed vertical prism over a counter-clockwise plan outline [(x, y), ...]."""
        k = len(outline)
        points = [(x, y, z) for z in (z0, z1) for x, y in outline]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return put(mesh(name + '.' + label, points, faces, material, col), parent)

    # ---- gunhouse: exactly the catalog's armour shell ---------------------------
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']], [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0

    def roof_z(x, y):
        """Top of the shell over (x, y), from the same datums the catalog shell uses."""
        ay = min(abs(y), 1.546)
        rows = [(1.546, 2.506, .85, 2.506), (1.4, 2.712, .808, 2.54), (.96, 2.785, .412, 2.555), (.69, 2.806, .30, 2.563), (.2, 2.83, .10, 2.563), (0, 2.83, .10, 2.563)]
        for (y0, c0, f0, t0), (y1, c1, f1, t1) in zip(rows, rows[1:]):
            if y1 <= ay <= y0:
                u = (ay - y1) / (y0 - y1)
                camber, fall, top = c1 + (c0 - c1) * u, f1 + (f0 - f1) * u, t1 + (t0 - t1) * u
                break
        if x <= fall:
            return camber
        return camber + (top - camber) * (x - fall) / (FACE - fall)

    # ---- shallow rear bevel over the flat rear plate (reference: 0.22 m proud on the centreline) ----
    ys = [1.546, 1.4, .96, .69, .2, -.2, -.69, -.96, -1.4, -1.546]
    bevel = {1.546: -4.318, 1.4: -4.359, .96: -4.482, .69: -4.51, .2: -4.538}
    outer = [(bevel[abs(y)], y) for y in ys]
    k = len(ys)
    pts = [(x, y, FLOOR) for x, y in outer] + [(x, y, roof_z(-4.4, y)) for x, y in outer]
    pts += [(-4.30, y, FLOOR) for y in ys] + [(-4.30, y, roof_z(-4.4, y)) for y in ys]
    faces = [(i, i + 1, k + i + 1, k + i) for i in range(k - 1)]                       # bevelled face
    faces += [(2 * k + i + 1, 2 * k + i, 3 * k + i, 3 * k + i + 1) for i in range(k - 1)]  # hidden back
    faces += [(k + i, k + i + 1, 3 * k + i + 1, 3 * k + i) for i in range(k - 1)]      # top strip
    faces += [(i + 1, i, 2 * k + i, 2 * k + i + 1) for i in range(k - 1)]              # bottom strip
    faces += [(0, k, 3 * k, 2 * k), (k - 1, 2 * k + k - 1, 3 * k + k - 1, 2 * k - 1)]
    rear_bevel = put(solid(mesh(name + '.rear-bevel', pts, faces, naval, col)))

    # ---- turntable skirt and the chin under the recess ------------------------
    put(cyl(name + '.turntable-skirt', (0, 0, (FLOOR + .004) / 2), SKIRT, FLOOR + .004, naval, col, 40))
    chin = [(-.987, -1.546), (.764, -1.546), (FACE, -.69), (FACE, .69), (.764, 1.546), (-.987, 1.546)]
    prism('chin', chin, .134, FLOOR + .006, naval)

    # ---- sight hoods on the front roof corners ---------------------------------
    for sign in [1, -1]:
        y = sign * 1.063
        z0 = roof_z(1.30, y) - .03
        put(box(name + '.sight-hood', (1.39, y, (z0 + 2.846) / 2), (.45, .438, 2.846 - z0), naval, col))
        put(box(name + '.sight-hood-cap', (1.37, y, 2.858), (.50, .47, .024), painted, col))
        put(box(name + '.sight-window', (1.617, y, 2.70), (.012, .30, .10), glass, col))
        put(box(name + '.sight-hood-rib', (1.40, y - sign * .20, 2.55), (.40, .03, .40), painted, col))

    # ---- roof tubes on their brackets ----------------------------------------
    for sign in [1, -1]:
        outer, inner = sign * 1.356, sign * 1.012
        put(rod(name + '.roof-tube', (-4.335, outer, 3.007), (.118, outer, 3.007), .172, painted, col, vertices=14))
        for x in [-4.335, .118]:
            put(rod(name + '.roof-tube-cap', (x - .015, outer, 3.007), (x + .015, outer, 3.007), .182, edge, col, vertices=14))
        put(rod(name + '.roof-rail', (-4.12, inner, 2.947), (0.0, inner, 2.947), .075, painted, col, vertices=10))
        for x in [-3.739, -2.032, -.324]:
            base = roof_z(x, sign * 1.2) - .05
            profile = [(sign * .85, base + .07), (sign * .85, 2.93), (sign * 1.18, 3.04), (sign * 1.55, 2.95), (sign * 1.55, 2.50), (sign * 1.40, base)]
            pts = [(x + dx, y, z) for dx in (-.03, .03) for y, z in profile]
            k = len(profile)
            faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))] + [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
            put(solid(mesh(name + '.tube-bracket', pts, faces, naval, col)))
            put(box(name + '.tube-strap', (x, outer, 3.10), (.06, .29, .16), edge, col))

    # ---- flank fittings: footboards, rungs, grab rails -----------------------------
    for sign in [1, -1]:
        wall = sign * 1.546
        put(box(name + '.footboard', (-1.870, sign * 1.721, .716), (4.28, .35, .06), painted, col))
        for x in [-3.976, -2.579, -1.184, .212]:
            put(box(name + '.footboard-bracket', (x, sign * 1.70, .60), (.038, .31, .20), naval, col))
        for i in range(7):
            z = .446 + i * .3337
            put(rod(name + '.face-rung', (.76, sign * 1.60, z), (1.14, sign * 1.60, z), .02, painted, col, vertices=6))
            for x in [.78, 1.12]:
                put(rod(name + '.rung-stand', (x, wall, z), (x, sign * 1.61, z), .014, painted, col, vertices=5))
        put(rod(name + '.grab-rail', (-4.085, sign * 1.626, 2.18), (.078, sign * 1.626, 2.18), .018, painted, col, vertices=6))
        for x in [-4.0, -2.689, -1.312, 0.0]:
            put(rod(name + '.grab-rail-stand', (x, wall, 2.18), (x, sign * 1.64, 2.18), .013, painted, col, vertices=5))
        put(rod(name + '.grab-bar', (-2.683, sign * 1.626, 1.073), (-2.683, sign * 1.626, 1.975), .018, painted, col, vertices=6))
        for z in [1.08, 1.97]:
            put(rod(name + '.grab-bar-stand', (-2.683, wall, z), (-2.683, sign * 1.64, z), .013, painted, col, vertices=5))
        # Side door plate where the reference paints its door.
        put(box(name + '.side-door', (-2.25, sign * 1.552, 1.45), (.80, .014, 1.30), painted, col))

    # ---- rear: access box and footboard -------------------------------------------
    put(box(name + '.rear-access-box', (-4.66, .952, 1.548), (.57, .88, .447), naval, col))
    put(box(name + '.rear-box-lid', (-4.66, .952, 1.78), (.60, .91, .025), painted, col))
    put(box(name + '.rear-footboard', (-4.613, -.71, .716), (.54, 1.38, .06), painted, col))
    for y in [-1.3, -.12]:
        put(box(name + '.rear-footboard-bracket', (-4.50, y, .60), (.30, .038, .20), naval, col))

    # ---- elevating masses: slide, port shield, barrel -------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    trunnion = spec['trunnionForward']
    bore = spec['caliberM'] / 2
    count = 16
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (trunnion, y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # Slide and port shield ride the elevation; the shield stands proud of the recess back wall
        # so it clears it through the full arc.
        put(rod(name + '.slide', (-.30, 0, 0), (.50, 0, 0), .30, naval, col, vertices=count), elevation)
        put(rod(name + '.port-shield', (.54, 0, 0), (.62, 0, 0), .318, naval, col, vertices=count), elevation)
        put(rod(name + '.port-shield-rim', (.615, 0, 0), (.64, 0, 0), .288, painted, col, vertices=count), elevation)
        for dy in [-.133, .133]:
            put(rod(name + '.recoil-buffer', (.45, dy, -.38), (.75, dy, -.38), .07, painted, col, vertices=8), elevation)
            put(rod(name + '.buffer-cap', (.75, dy, -.38), (.78, dy, -.38), .085, edge, col, vertices=8), elevation)
        # One connected barrel: a constant jacket long enough for the full recoil stroke through the
        # port shield, the taper to the step at 1.88 m from the trunnion, and the chase to the muzzle.
        profile = [(-.30, .296), (.46, .296), (1.838, .246), (1.878, .219), (length - .07, .150), (length - .07, .162), (length, .162)]
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        put(mesh(name + '.barrel', points, faces, painted, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for x, r in [(length, .162), (length, bore), (length - .30, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i) for j in range(2) for i in range(count)]
        put(mesh(name + '.muzzle-face', rim, faces, edge, col), recoil)
        put(rod(name + '.bore', (length - .32, 0, 0), (length - .30, 0, 0), bore, dark, col, vertices=count), recoil)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

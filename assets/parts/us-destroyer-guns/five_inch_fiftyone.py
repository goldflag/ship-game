"""Original 5-inch/51 pedestal mounts, open and shielded.

Visual proportions follow the approved GameModels3D Nicholas broadside
artillery (`ags085_5in51_mk_7_mod2`, open, and `ags086_5in51_mk_7_mod2`, the
same mount behind a shield). No reference geometry is loaded here. Authoring
frame: +X muzzle, +Y port, +Z up, yaw datum on the sole.

The shielded variant's visible plating is the catalog `gunhouseMesh`; the
recipe adds the inner liner, the feet and the stays that carry it.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout


def _palette(materials):
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    return palette


def _mount(mount, col, helpers, materials, shielded):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = _palette(materials)
    naval, roof, edge, dark, painted = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge'])
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

    # ---- foundation ------------------------------------------------------
    put(cyl(name + '.deck-flange', (0, 0, .026), .685, .052, naval, col, 20))
    for i in range(16):
        angle = math.tau * (i + .5) / 16
        put(box(name + '.holding-down-bolt',
                (.580 * math.cos(angle), .580 * math.sin(angle), .078), (.080, .080, .052), edge, col, .012))
    put(cyl(name + '.pedestal-base', (0, 0, .146), .534, .200, naval, col, 16))
    put(cyl(name + '.training-race', (0, 0, .222), .559, .062, edge, col, 24))
    put(cyl(name + '.roller-path', (0, 0, .285), .520, .060, edge, col, 24))

    # ---- rotating pedestal and trunnion fork -----------------------------
    put(cyl(name + '.pedestal-column', (0, 0, .450), .458, .340, naval, col, 8, .430))
    for sign in [1, -1]:
        put(mesh(name + '.trunnion-cheek',
                 [(x, sign * y, z) for x, z in
                  [(-.400, .620), (.420, .620), (.420, 1.260), (.190, 1.400), (-.400, 1.400)]
                  for y in [.360, .452]],
                 [(0, 2, 3, 1), (2, 4, 5, 3), (4, 6, 7, 5), (6, 8, 9, 7), (8, 0, 1, 9),
                  (0, 8, 6, 4, 2), (1, 3, 5, 7, 9)], naval, col))
        put(box(name + '.cheek-gusset', (.010, sign * .420, .680), (.80, .13, .11), naval, col))
        put(rod(name + '.trunnion-cap', (0, sign * .3625, pivot), (0, sign * .4225, pivot), .162, edge, col, vertices=12))

    # ---- sight platforms -------------------------------------------------
    # Side platforms on the cheek tops, open between them so the breech rises.
    for sign in [1, -1]:
        put(box(name + '.sight-platform', (-.420, sign * .420, 1.470), (1.58, .180, .075), edge, col))
        put(box(name + '.platform-rail', (-.420, sign * .500, 1.560), (1.58, .040, .105), edge, col))
        put(box(name + '.rail-outrigger', (.420, sign * .560, 1.430), (.20, .26, .130), naval, col))

    # ---- layers' stations ------------------------------------------------
    for sign in [1, -1]:
        put(box(name + '.gun-platform', (-.335, sign * .530, .330), (.67, .61, .095), edge, col))
        for x in [-.620, -.060]:
            put(rod(name + '.platform-stay', (x, sign * .430, .285), (x, sign * .790, .330), .028, edge, col, vertices=6))
        put(box(name + '.seat-bracket', (-.300, sign * .540, .620), (.46, .22, .26), naval, col))
        put(box(name + '.seat-pan', (-.305, sign * .570, .770), (.34, .30, .055), edge, col))
        put(box(name + '.gear-case', (.150, sign * .560, .950), (.30, .20, .34), naval, col))
        for y, label in [(.568, 'elevating'), (.695, 'training')]:
            put(rod(name + '.' + label + '-handwheel', (.150, sign * (y - .013), .950),
                    (.150, sign * (y + .013), .950), .165, edge, col, vertices=10))
            put(rod(name + '.' + label + '-wheel-hub', (.150, sign * .440, .950),
                    (.150, sign * y, .950), .038, edge, col, vertices=6))
            put(rod(name + '.' + label + '-wheel-handle', (.150, sign * (y + .022), 1.088),
                    (.150, sign * (y + .095), 1.088), .024, edge, col, vertices=6))

    # ---- elevating mass --------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        for flank in [1, -1]:
            put(mesh(name + '.slide-cheek',
                     [(x, flank * yy, z) for x, z in
                      [(-1.020, -.300), (.220, -.300), (.220, .150), (-1.020, .150)]
                      for yy in [.245, .305]],
                     [(0, 2, 3, 1), (2, 4, 5, 3), (4, 6, 7, 5), (6, 0, 1, 7),
                      (0, 6, 4, 2), (1, 3, 5, 7)], naval, col), elevation)
            put(rod(name + '.recoil-cylinder', (-1.020, flank * .170, -.280),
                    (.300, flank * .170, -.280), .090, edge, col, vertices=10), elevation)
        put(box(name + '.slide-bed', (-.400, 0, -.268), (1.24, .61, .085), naval, col), elevation)
        put(rod(name + '.elevating-arc', (-1.560, 0, -.255), (-.760, 0, -.255), .030, edge, col, vertices=6), elevation)
        put(box(name + '.elevating-arc-head', (-1.610, 0, -.255), (.12, .17, .17), edge, col), elevation)
        for flank in [1, -1]:
            put(rod(name + '.trunnion-boss', (0, flank * .300, 0), (0, flank * .3595, 0), .150, naval, col, vertices=10), elevation)
            put(box(name + '.sight-bracket', (-1.700, flank * .410, .080), (.26, .070, .40), naval, col), elevation)
            put(rod(name + '.sight-telescope', (-1.980, flank * .410, .070), (-1.620, flank * .410, .070),
                    .040, edge, col, vertices=8), elevation)
            put(rod(name + '.sight-eyepiece', (-2.020, flank * .410, .070), (-1.980, flank * .410, .070),
                    .055, dark, col, vertices=8), elevation)

        put(box(name + '.breech-block', (-1.486, 0, .033), (.175, .610, .756), naval, col), recoil)
        put(rod(name + '.breech-lever', (-1.570, -.300, .160), (-1.570, -.520, .250), .030, edge, col, vertices=6), recoil)
        put(rod(name + '.breech-ring', (-1.400, 0, 0), (-.609, 0, 0), .2545, edge, col, vertices=12), recoil)
        put(rod(name + '.jacket', (-.609, 0, 0), (.609, 0, 0), .2545, edge, col, r2=.210, vertices=12), recoil)
        chase = put(rod(name + '.chase', (.609, 0, 0), (length - .154, 0, 0), .210, edge, col, r2=.096, vertices=12), recoil)
        for polygon in chase.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        put(rod(name + '.muzzle-swell', (length - .154, 0, 0), (length, 0, 0), .110, edge, col, vertices=12), recoil)
        put(rod(name + '.bore', (length - .060, 0, 0), (length + .002, 0, 0), bore, dark, col, vertices=12), recoil)

    if shielded:
        shape = spec['gunhouseMesh']
        vertices = [tuple(v) for v in shape['vertices']]
        plating = put(mesh(name + '.shield', vertices, [f['indices'] for f in shape['faces']], naval, col))
        plating.data.materials.append(roof)
        for polygon, face in zip(plating.data.polygons, shape['faces']):
            polygon.material_index = 1 if face['finish'] == 'roof' else 0
        focus = (0.0, 0.0, 1.35)
        put(mesh(name + '.shield-liner',
                 [tuple(focus[k] + (v[k] - focus[k]) * .990 for k in range(3)) for v in vertices],
                 [tuple(reversed(f['indices'])) for f in shape['faces']], edge, col))
        for sign in [1, -1]:
            put(box(name + '.shield-foot', (.420, sign * .560, 1.510), (.20, .26, .060), naval, col))
            put(rod(name + '.shield-stay', (-.900, sign * .430, 1.560), (-.500, sign * .990, 1.400), .028, edge, col, vertices=6))

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw


def create_open_single(mount, col, helpers, materials):
    return _mount(mount, col, helpers, materials, shielded=False)


def create_shielded_single(mount, col, helpers, materials):
    return _mount(mount, col, helpers, materials, shielded=True)

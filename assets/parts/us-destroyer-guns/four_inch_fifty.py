"""Original 4-inch/50 flush-decker mounts: the open pedestal and its shielded twin sister.

Visual proportions follow the approved GameModels3D Wickes/Clemson broadside
artillery (`ags040_4in50_mk12`, open, and `ags039_4in50_mk12`, the same mount
under a splinter shield). No reference geometry is loaded here: the pedestal,
fork, slide, sighting gear and shield plating are authored from measured
datums. Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole.

The shielded variant's visible plating is the catalog `gunhouseMesh`, so armor
and shell stay aligned; the recipe adds only the inner liner that gives the
open back and the gun port their plate thickness.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

BORE_OFFSET = .004  # catalog pivot height vs the source model's bore line


def _palette(materials):
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    return palette


def _mount(mount, col, helpers, materials, shielded):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = _palette(materials)
    naval, roof, edge, dark, painted, glass = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'])
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
    # Ring bulkhead on deck, its holding-down bolts, and the training race the
    # carriage turns on. Everything above the race trains with the gun.
    put(cyl(name + '.deck-flange', (-.06, 0, .006), .615, .096, naval, col, 20))
    for i in range(16):
        angle = math.tau * (i + .5) / 16
        put(box(name + '.holding-down-bolt',
                (-.06 + .52 * math.cos(angle), .52 * math.sin(angle), .070), (.075, .075, .050), edge, col, .012))
    put(cyl(name + '.pedestal-base', (0, 0, .126), .386, .152, naval, col, 16))
    put(cyl(name + '.training-race', (0, 0, .247), .375, .095, edge, col, 24))
    put(cyl(name + '.roller-path', (0, 0, .292), .400, .036, edge, col, 24))

    # ---- rotating pedestal and trunnion fork -----------------------------
    # The column stops below the breech sweep; two cheeks carry the trunnions
    # and leave the slide free to elevate between them.
    put(cyl(name + '.pedestal-column', (0, 0, .400), .325, .240, naval, col, 8, .312))
    for sign in [1, -1]:
        put(mesh(name + '.trunnion-cheek',
                 [(x, sign * y, z) for x, z in
                  [(-.315, .520), (.330, .520), (.330, 1.180), (.145, 1.310), (-.315, 1.310)]
                  for y in [.262, .338]],
                 [(0, 2, 3, 1), (2, 4, 5, 3), (4, 6, 7, 5), (6, 8, 9, 7), (8, 0, 1, 9),
                  (0, 8, 6, 4, 2), (1, 3, 5, 7, 9)], naval, col))
        put(box(name + '.cheek-gusset', (.010, sign * .320, .570), (.62, .11, .10), naval, col))
        put(rod(name + '.trunnion-cap', (0, sign * .2625, pivot), (0, sign * .3125, pivot), .125, edge, col, vertices=12))

    # ---- sight platform rails -------------------------------------------
    # Fore-and-aft rails welded on the cheek tops carry the layer's telescope
    # brackets, the forward grab rails and, on the shielded mount, the shield
    # feet. Nothing crosses the centreline: the breech rises between them.
    for sign in [1, -1]:
        put(box(name + '.carriage-rail', (-.235, sign * .300, 1.372), (1.34, .072, .074), edge, col))
        put(box(name + '.rail-outrigger', (.336, sign * .490, 1.300), (.17, .22, .120), naval, col))
        if not shielded:
            # Open mount: the layers' grab rails run forward over the jacket.
            put(box(name + '.forward-rail', (.347, sign * .560, 1.300), (.68, .072, .082), edge, col))
            put(box(name + '.upper-rail', (.343, sign * .476, 1.388), (.56, .030, .034), edge, col))
            put(rod(name + '.upper-rail-stanchion', (.560, sign * .476, 1.340), (.560, sign * .476, 1.388), .018, edge, col, vertices=6))

    # ---- layers' seats, footplates and handwheels ------------------------
    for sign in [1, -1]:
        put(box(name + '.seat-bracket', (-.265, sign * .430, .470), (.52, .24, .28), naval, col))
        put(box(name + '.seat-pan', (-.270, sign * .460, .628), (.34, .30, .055), edge, col))
        put(box(name + '.seat-back', (-.428, sign * .460, .716), (.050, .28, .16), edge, col))
        put(box(name + '.footplate-bracket', (-.560, sign * .520, .589), (.18, .040, .25), naval, col))
        put(box(name + '.footplate', (-.700, sign * .520, .755), (.295, .435, .050), edge, col))
        # Training and elevating handwheels on their gearbox, outboard of the
        # fork so the breech sweeps clear of them.
        put(box(name + '.gear-case', (.030, sign * .450, .884), (.26, .18, .28), naval, col))
        for y, label in [(.470, 'elevating'), (.570, 'training')]:
            put(rod(name + '.' + label + '-handwheel', (.030, sign * (y - .012), .884),
                    (.030, sign * (y + .012), .884), .150, edge, col, vertices=10))
            put(rod(name + '.' + label + '-wheel-hub', (.030, sign * .360, .884),
                    (.030, sign * y, .884), .034, edge, col, vertices=6))
            put(rod(name + '.' + label + '-wheel-handle', (.030, sign * (y + .020), 1.010),
                    (.030, sign * (y + .090), 1.010), .022, edge, col, vertices=6))

    # ---- elevating mass --------------------------------------------------
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        # Slide: two cheek plates under a trough, with the recoil cylinder
        # between them and the counter-recoil rods on the flanks.
        for flank in [1, -1]:
            put(mesh(name + '.slide-cheek',
                     [(x, flank * yy, z) for x, z in
                      [(-.620, -.400), (.380, -.400), (.380, .060), (-.620, .060)]
                      for yy in [.185, .245]],
                     [(0, 2, 3, 1), (2, 4, 5, 3), (4, 6, 7, 5), (6, 0, 1, 7),
                      (0, 6, 4, 2), (1, 3, 5, 7)], naval, col), elevation)
            put(rod(name + '.counter-recoil-cylinder', (-.640, flank * .170, -.212),
                    (.310, flank * .170, -.212), .052, edge, col, vertices=8), elevation)
        put(box(name + '.slide-bed', (-.120, 0, -.372), (1.00, .49, .075), naval, col), elevation)
        put(rod(name + '.recoil-cylinder', (-.640, 0, -.267), (.390, 0, -.267), .080, edge, col, vertices=10), elevation)
        put(rod(name + '.elevating-screw', (-1.620, 0, -.290), (-.600, 0, -.290), .024, edge, col, vertices=6), elevation)
        put(box(name + '.elevating-screw-head', (-1.660, 0, -.290), (.10, .14, .14), edge, col), elevation)
        for flank in [1, -1]:
            put(rod(name + '.trunnion-boss', (0, flank * .195, 0), (0, flank * .2615, 0), .118, naval, col, vertices=10), elevation)
            # Sighting gear rides the slide, outboard of the recoiling breech.
            put(box(name + '.sight-bracket', (-1.565, flank * .330, .048), (.22, .062, .34), naval, col), elevation)
            put(rod(name + '.sight-telescope', (-1.830, flank * .330, .038), (-1.500, flank * .330, .038),
                    .036, edge, col, vertices=8), elevation)
            put(rod(name + '.sight-eyepiece', (-1.860, flank * .330, .038), (-1.830, flank * .330, .038),
                    .050, dark, col, vertices=8), elevation)

        # Gun: breech block housing, breech ring, jacket, chase and muzzle.
        put(box(name + '.breech-block', (-1.490, 0, .040), (.150, .490, .560), naval, col), recoil)
        put(rod(name + '.breech-lever', (-1.560, -.245, .140), (-1.560, -.420, .215), .028, edge, col, vertices=6), recoil)
        put(rod(name + '.breech-ring', (-1.420, 0, 0), (-.470, 0, 0), .190, edge, col, r2=.172, vertices=12), recoil)
        put(rod(name + '.jacket', (-.470, 0, 0), (1.041, 0, 0), .168, edge, col, r2=.157, vertices=12), recoil)
        chase = put(rod(name + '.chase', (1.041, 0, 0), (length - .150, 0, 0), .132, edge, col, r2=.096, vertices=12), recoil)
        for polygon in chase.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        put(rod(name + '.muzzle-swell', (length - .150, 0, 0), (length, 0, 0), .098, edge, col, vertices=12), recoil)
        put(rod(name + '.bore', (length - .050, 0, 0), (length + .002, 0, 0), bore, dark, col, vertices=12), recoil)

    if shielded:
        _shield(mount, col, put, helpers, palette)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw


def _shield(mount, col, put, helpers, palette):
    """Splinter shield: the catalog plating plus its inner liner and feet."""
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    name = mount['id']
    shape = mount['weapon']['gunhouseMesh']
    naval, roof, edge = palette['naval'], palette['roof'], palette['edge']
    vertices = [tuple(v) for v in shape['vertices']]
    plating = put(mesh(name + '.shield', vertices, [f['indices'] for f in shape['faces']], naval, col))
    plating.data.materials.append(roof)
    for polygon, face in zip(plating.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    # The plate is 6.4 mm steel: a liner one plate-thickness inside shows that
    # edge at the open back and around the gun port.
    focus = (0.0, 0.0, 1.24)
    put(mesh(name + '.shield-liner',
             [tuple(focus[k] + (v[k] - focus[k]) * .988 for k in range(3)) for v in vertices],
             [tuple(reversed(f['indices'])) for f in shape['faces']], edge, col))
    # Feet on the rail outriggers and diagonal stays to the flank plating.
    for sign in [1, -1]:
        put(box(name + '.shield-foot', (.336, sign * .490, 1.386), (.17, .22, .060), naval, col))
        put(rod(name + '.shield-stay', (-.600, sign * .300, 1.405), (-.300, sign * .830, 1.250), .026, edge, col, vertices=6))


def create_open_single(mount, col, helpers, materials):
    return _mount(mount, col, helpers, materials, shielded=False)


def create_shielded_single(mount, col, helpers, materials):
    return _mount(mount, col, helpers, materials, shielded=True)

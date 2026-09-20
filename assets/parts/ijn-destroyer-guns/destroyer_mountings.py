"""Original 12.7 cm/50 Japanese destroyer mountings beside the existing Type C.

Three further mountings are authored here, each against one approved
GameModels3D destroyer gun visual and none of them the Type C:

* ``create_type_a``      Type A twin (Shinonome, ``jgm153_127_50_twin_type_a``)
* ``create_type_b_twin`` Type B twin (Akatsuki, ``jgm148_127mm50_type_b``)
* ``create_type_b_single`` Type B single (Shiratsuyu, ``jgm152_127mm50_type_b``)
* ``create_type_five``   the enclosed twin the source names ``jgm176_127mm_50_type5``

No reference geometry is loaded: the source was measured for stations, joint
datums and fittings only. The catalog owns the closed shell and the weapon
values; this module draws that shell and adds the sole, apron, pitching gun-port
hoods, sliding barrels and service fittings.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the sole at deck level.
"""
import math

import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri

from blender_barrels import barrel_layout


def _setup(mount, col, helpers, materials):
    """Shared shell, sole, apron and barrel machinery for one mounting."""
    palette = dict(materials)
    for role, fallback in [('roof', 'naval'), ('painted-edge', 'edge'),
                           ('glass', 'dark'), ('canvas', 'dark')]:
        palette.setdefault(role, palette[fallback])
    mesh0, cyl0, rod0, box0 = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    name = mount['id']
    spec = mount['weapon']
    shape = spec['gunhouseMesh']

    def mesh(label, vertices, faces, material, smooth=False):
        return mesh0(name + '.' + label, vertices, faces, material, col, smooth)

    def cyl(label, loc, radius, depth, material, vertices=16, r2=None):
        return cyl0(name + '.' + label, loc, radius, depth, material, col, vertices, r2)

    def rod(label, a, b, radius, material, r2=None, vertices=8):
        return rod0(name + '.' + label, a, b, radius, material, col, r2, vertices)

    def box(label, loc, size, material, bev=.03):
        return box0(name + '.' + label, loc, size, material, col, bev)

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

    # The visible gunhouse is exactly the catalog's protective shell, so plate
    # thickness and shell hits stay aligned with what the eye sees.
    shell = put(mesh('gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], palette['naval']))
    shell.data.materials.append(palette['roof'])
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    shell.data.set_sharp_from_angle(angle=math.radians(34))
    weighted = shell.modifiers.new('Plate normals', 'WEIGHTED_NORMAL')
    weighted.keep_sharp = True
    weighted.weight = 35
    plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]

    def cast(origin, direction):
        hits = [intersect_ray_tri(*t, Vector(direction), Vector(origin)) for t in plates]
        return [h for h in hits if h is not None]

    def front_x(y, z):
        """Forward face of the shell on the (y, z) line, or None off the shell."""
        hits = cast((30, y, z), (-1, 0, 0))
        return max((h.x for h in hits), default=None)

    def top_z(x, y):
        hits = cast((x, y, 30), (0, 0, -1))
        return max((h.z for h in hits), default=None)

    def half_width(x, z):
        hits = cast((x, 30, z), (0, -1, 0))
        return max((h.y for h in hits), default=None)

    tools = dict(mesh=mesh, cyl=cyl, rod=rod, box=box, joint=joint, put=put, palette=palette,
                 name=name, spec=spec, yaw=yaw, shape=shape, cast=cast, front_x=front_x,
                 top_z=top_z, half_width=half_width, mount=mount)
    return tools


def _tube_path(tools, label, points, radius, material, sides=6, closed=False):
    """A swept tube through a polyline; used for rails, grabs and hoops."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    verts = []
    for i, p in enumerate(pts):
        delta = pts[(i + 1) % n] - pts[(i - 1) % n] if closed else pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        q = delta.to_track_quat('Z', 'Y')
        verts += [p + q @ Vector((radius * math.cos(j * math.tau / sides),
                                  radius * math.sin(j * math.tau / sides), 0)) for j in range(sides)]
    faces = []
    for i in range(n if closed else n - 1):
        k = (i + 1) % n
        faces += [(i * sides + j, i * sides + (j + 1) % sides, k * sides + (j + 1) % sides, k * sides + j)
                  for j in range(sides)]
    if not closed:
        faces += [tuple(reversed(range(sides))), tuple((n - 1) * sides + j for j in range(sides))]
    return tools['mesh'](label, verts, faces, material, smooth=True)


def _sole(tools, radius, height, plates=12):
    """Rotating sole plate with the radial knees that carry the shell apron."""
    put, cyl, mesh, palette = tools['put'], tools['cyl'], tools['mesh'], tools['palette']
    put(cyl('sole', (0, 0, height / 2), radius, height, palette['naval'], 20))
    for i in range(plates):
        angle = i * math.tau / plates
        c, s = math.cos(angle), math.sin(angle)
        reach = tools['half_width'](radius * c * .5, height + .18)
        outer = max(radius + .10, min(radius + 1.05, reach or radius + .35))
        knee = put(mesh('sole-knee', [(c * radius * .92, s * radius * .92, height * .55),
                                      (c * radius * .92, s * radius * .92, height + .30),
                                      (c * outer, s * outer, height + .30)],
                        [(0, 1, 2)], palette['naval']))
        knee.modifiers.new('Knee plate', 'SOLIDIFY').thickness = .022


def _apron(tools, stations, top, bottom, inset=.10, sides=18):
    """Sheet apron closing the gap between the shell skirt and the sole."""
    put, mesh, palette = tools['put'], tools['mesh'], tools['palette']
    ring = []
    for i in range(sides):
        angle = i * math.tau / sides
        c, s = math.cos(angle), math.sin(angle)
        x = stations[0] + (stations[1] - stations[0]) * (c + 1) / 2
        w = tools['half_width'](x, top + .05)
        w = (w if w is not None else .8) - inset
        ring.append((x, w * s if abs(s) > 1e-9 else 0.0))
    verts = [(x, y, top) for x, y in ring] + [(x * .93, y * .90, bottom) for x, y in ring]
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    skirt = put(mesh('apron', verts, faces, palette['naval']))
    skirt.modifiers.new('Apron plate', 'SOLIDIFY').thickness = .03
    return skirt


def _side_shelf(tools, back, front, outboard, height, steps=6):
    """Shelf plate bracketed off each flank at one height."""
    put, mesh, rod, palette = tools['put'], tools['mesh'], tools['rod'], tools['palette']
    stations = [back + (front - back) * i / (steps - 1) for i in range(steps)]
    for sign in (1, -1):
        inner, outer = [], []
        for x in stations:
            w = tools['half_width'](x, height)
            if w is None:
                continue
            inner.append((x, sign * (w - .04)))
            outer.append((x, sign * (w + outboard)))
        if len(inner) < 2:
            continue
        k = len(inner)
        verts = [(x, y, height) for x, y in inner] + [(x, y, height) for x, y in outer]
        faces = [(i, i + 1, k + i + 1, k + i) for i in range(k - 1)]
        plate = put(mesh('side-shelf', verts, faces, palette['naval']))
        plate.modifiers.new('Shelf plate', 'SOLIDIFY').thickness = .03
        for (x, y), (_, yo) in list(zip(inner, outer))[1::2]:
            put(rod('shelf-bracket', (x, y, height - .30), (x, yo, height - .02), .022,
                    palette['painted-edge'], vertices=4))


def _barrels(tools, jacket, chase, muzzle_radius, sleeve_start):
    """Sliding barrels: a constant jacket for the seal, then the tapered chase."""
    spec, put, mesh, palette = tools['spec'], tools['put'], tools['mesh'], tools['palette']
    name = tools['name']
    joint = tools['joint']
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    made = []
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', tools['yaw'],
                          (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(tools['mount'].get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        profile = [(sleeve_start, jacket), (chase[0], jacket), (chase[0] + .10, chase[1]),
                   (length - .30, muzzle_radius), (length, muzzle_radius + .012)]
        count = 12
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count,
                  (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        barrel = put(mesh('barrel', points, faces, palette['edge'], True), recoil)
        for polygon in barrel.data.polygons:
            polygon.use_smooth = True
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, muzzle_radius + .012), (length, bore), (length - .38, bore)]
               for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count,
                  (j + 1) * count + i) for j in range(2) for i in range(count)]
        put(mesh('muzzle-rim', rim, faces, palette['edge']), recoil)
        put(tools['rod']('bore-interior', (length - .40, 0, 0), (length - .38, 0, 0), bore,
                         palette['dark'], vertices=count), recoil)
        made.append((side, y, elevation, recoil))
    return made


def _port_hood(tools, elevation, y, front, back, half, low, high, lip=.09):
    """Gun-port hood around one barrel.

    The hood pitches with its gun, as the source's rigid hoods must: it is the
    moving half of the port, so the barrel never crosses a hood edge and the
    slot behind it stays covered from depression to maximum elevation.
    Authored in the elevation joint's own frame (origin at the trunnion).
    """
    put, mesh, palette = tools['put'], tools['mesh'], tools['palette']
    spec = tools['spec']
    ox, oz = spec['trunnionForward'], spec['pivotHeight']
    sections = [(back, half, low, high),
                (back + (front - back) * .55, half * .95, low + .07, high - .05),
                (front, half * .80, low + .16, high - .14)]
    verts = []
    for x, w, a, b in sections:
        verts += [(x - ox, -w, a - oz), (x - ox, w, a - oz),
                  (x - ox, w * .82, b - oz), (x - ox, -w * .82, b - oz)]
    faces = []
    for k in range(len(sections) - 1):
        for j in range(4):
            n = (j + 1) % 4
            faces.append((k * 4 + j, k * 4 + n, (k + 1) * 4 + n, (k + 1) * 4 + j))
    faces.append((3, 2, 1, 0))
    hood = put(mesh('gunport-hood', verts, faces, palette['naval']), elevation)
    hood.modifiers.new('Hood plate', 'SOLIDIFY').thickness = .028
    # The port itself stays open: the rim is a picture frame welded round it,
    # so the gun is visible through its mouth at every elevation.
    inner = [(-half * .52, low + .30), (half * .52, low + .30),
             (half * .52, high - .26), (-half * .52, high - .26)]
    outer = [(-half * .80 - lip, low + .16), (half * .80 + lip, low + .16),
             (half * .70 + lip, high - .14), (-half * .70 - lip, high - .14)]
    verts = [(front - ox, yy, z - oz) for yy, z in outer] + \
            [(front - ox, yy, z - oz) for yy, z in inner]
    faces = [(j, (j + 1) % 4, 4 + (j + 1) % 4, 4 + j) for j in range(4)]
    frame = put(mesh('gunport-rim', verts, faces, palette['naval']), elevation)
    frame.modifiers.new('Rim plate', 'SOLIDIFY').thickness = .05
    return sections


def _rails(tools, path, z_levels, radius=.017, standoff=.05):
    """Grab rails carried on short stanchions off the shell flank."""
    put, rod, palette = tools['put'], tools['rod'], tools['palette']
    for z in z_levels:
        for sign in (1, -1):
            points = []
            for x in path:
                w = tools['half_width'](x, z)
                if w is None:
                    continue
                points.append((x, sign * (w + standoff), z))
                put(rod('rail-foot', (x, sign * (w - .01), z), (x, sign * (w + standoff), z),
                        .018, palette['painted-edge'], vertices=4))
            if len(points) > 1:
                put(_tube_path(tools, 'side-rail', points, radius,
                               palette['painted-edge']))


def _roof_rail(tools, path, height=.19, radius=.018):
    put, rod, palette = tools['put'], tools['rod'], tools['palette']
    points = []
    for x, y in path:
        z = tools['top_z'](x, y)
        if z is None:
            continue
        points.append((x, y, z + height))
        put(rod('roof-rail-foot', (x, y, z - .01), (x, y, z + height), .018, palette['painted-edge'],
                vertices=4))
    if len(points) > 1:
        put(_tube_path(tools, 'roof-rail', points, radius, palette['painted-edge']))


def _roof_fittings(tools, hatches, radius=.155):
    put, cyl, palette = tools['put'], tools['cyl'], tools['palette']
    for x, y in hatches:
        z = tools['top_z'](x, y)
        if z is None:
            continue
        put(cyl('roof-hatch', (x, y, z + .028), radius, .056, palette['naval'], 12))
        put(cyl('roof-hatch-boss', (x, y, z + .066), radius * .35, .03, palette['painted-edge'], 8))


def _rear_door(tools, y, z, width, height, back, palette_key='naval'):
    put, box, rod, palette = tools['put'], tools['box'], tools['rod'], tools['palette']
    door = put(box('rear-door', (back - .03, y, z), (.06, width, height), palette[palette_key], bev=.05))
    put(rod('door-handle', (back - .08, y - width * .34, z - .10),
            (back - .08, y - width * .34, z + .08), .018, palette['painted-edge'], vertices=4))
    for dz in (-height * .38, height * .38):
        put(rod('door-hinge', (back - .05, y + width * .48, z + dz - .08),
                (back - .05, y + width * .48, z + dz + .08), .024, palette['painted-edge'], vertices=4))
    return door


def _rear_ladder(tools, back, half, bottom, top, rungs=6):
    put, rod, palette = tools['put'], tools['rod'], tools['palette']
    for sign in (1, -1):
        put(rod('ladder-rail', (back - .09, sign * half, bottom), (back - .09, sign * half, top),
                .020, palette['painted-edge'], vertices=4))
    for i in range(rungs):
        z = bottom + (top - bottom) * i / (rungs - 1)
        put(rod('ladder-rung', (back - .09, -half, z), (back - .09, half, z), .018,
                palette['painted-edge'], vertices=4))
        for sign in (1, -1):
            put(rod('ladder-standoff', (back - .01, sign * half, z), (back - .09, sign * half, z),
                    .018, palette['painted-edge'], vertices=4))


def _finish(mount, tools):
    yaw = tools['yaw']
    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw


# --------------------------------------------------------------------------
# Type A twin: Shinonome A1 artillery, jgm153_127_50_twin_type_a
# --------------------------------------------------------------------------
def create_type_a(mount, col, helpers, materials):
    tools = _setup(mount, col, helpers, materials)
    spec, put, palette = tools['spec'], tools['put'], tools['palette']
    box, rod, cyl = tools['box'], tools['rod'], tools['cyl']

    _sole(tools, 1.25, .246)
    _apron(tools, (-3.05, 1.88), .30, .05)

    # The jacket stays constant well past the hood mouth so the sliding
    # surface is continuous through the whole recoil stroke.
    made = _barrels(tools, .205, (1.55, .155), .147, -.35)
    for side, y, elevation, recoil in made:
        _port_hood(tools, elevation, y, 1.93, .80, .29, 1.25, 2.33)
    # Fixed cheek plates frame the slot the hoods work through.
    for sign in (1, -1):
        cheek = put(box('port-cheek', (1.12, sign * .90, 1.70), (.38, .12, .42),
                        palette['naval'], bev=.02))
        cheek.rotation_euler.y = math.radians(-28)

    # Roof: eight hatches, the fore-and-aft training rail and the sight post.
    _roof_fittings(tools, [(-.19, .91), (-.19, -.91), (-.91, .44), (-.91, -.44),
                           (-1.67, 1.07), (-1.67, -1.07), (-2.33, .44), (-2.33, -.44)])
    spine = [(-3.00, 0), (-2.00, 0), (-1.00, 0), (0.00, 0), (.72, 0)]
    posts = []
    for x, y in spine:
        z = tools['top_z'](x, y)
        if z is None:
            continue
        posts.append((x, y, z + .21))
        put(rod('spine-post', (x, y, z - .01), (x, y, z + .21), .020, palette['painted-edge'], vertices=4))
    put(_tube_path(tools, 'training-rail', posts, .020, palette['painted-edge']))
    post_z = tools['top_z'](.71, 0) or 2.28
    put(rod('periscope-post', (.71, 0, post_z - .02), (.71, 0, post_z + .26), .032,
            palette['painted-edge'], vertices=8))
    put(cyl('periscope-head', (.71, 0, post_z + .28), .052, .07, palette['naval'], 8))

    # The mount captain's raised position sits on the port forward roof; it is
    # the one fitting that breaks the mounting's symmetry in the source.
    deck_z = tools['top_z'](-.20, .95) or 2.33
    put(box('captain-platform', (-.22, .95, deck_z + .12), (.95, 1.10, .14),
            palette['naval'], bev=.02))
    for dx, dy in [(-.40, -.48), (.40, -.48), (-.40, .48), (.40, .48)]:
        put(rod('platform-foot', (-.22 + dx, .95 + dy, deck_z - .01),
                (-.22 + dx, .95 + dy, deck_z + .06), .026, palette['painted-edge'], vertices=4))
    put(cyl('captain-hood', (-.19, .91, deck_z + .245), .17, .11, palette['naval'], 12, .14))
    put(box('captain-window', (-.03, .91, deck_z + .25), (.02, .16, .07), palette['glass'], bev=.005))

    # Roof-edge rail around the flat part of the roof, then the side grabs.
    outline = [(.70, 1.12), (.20, 1.38), (-1.20, 1.44), (-2.45, 1.32), (-2.95, .80), (-2.95, -.80),
               (-2.45, -1.32), (-1.20, -1.44), (.20, -1.38), (.70, -1.12)]
    _roof_rail(tools, outline)
    _rails(tools, [1.15, .40, -.60, -1.60, -2.50], [.46, 1.44, 2.02])

    # Rear face: two access doors, a centreline ladder and ready lockers.
    for sign in (1, -1):
        _rear_door(tools, sign * .71, 1.20, .96, 1.36, -3.06)
        put(box('ready-locker', (-2.86, sign * 1.02, .52), (.42, .38, .40), palette['naval'], bev=.03))
    _rear_ladder(tools, -3.09, .27, .55, 2.18)
    for sign in (1, -1):
        put(cyl('vent-mushroom', (-2.70, sign * 1.12, 2.42), .13, .10, palette['naval'], 10))
    return _finish(mount, tools)


def _walkway(tools, back, front, outboard, height, steps=10):
    """Outboard walkway flange ringing the shell at platform level."""
    put, mesh, palette = tools['put'], tools['mesh'], tools['palette']
    stations = [back + (front - back) * i / (steps - 1) for i in range(steps)]
    widths = []
    for x in stations:
        w = tools['half_width'](x, height)
        widths.append(0.0 if w is None else w)
    loop = [(x, w) for x, w in zip(stations, widths)]
    loop += [(x, -w) for x, w in zip(reversed(stations), reversed(widths))]
    inner = [(x, y) for x, y in loop]
    outer = [(x, y + math.copysign(outboard, y) if abs(y) > 1e-6 else y) for x, y in loop]
    k = len(inner)
    verts = [(x, y, height) for x, y in inner] + [(x, y, height) for x, y in outer]
    faces = [(i, (i + 1) % k, k + (i + 1) % k, k + i) for i in range(k)]
    deck = put(mesh('walkway', verts, faces, palette['naval']))
    deck.modifiers.new('Walkway plate', 'SOLIDIFY').thickness = .035
    return deck


def _hood_loft(tools, label, sections, material, parent=None):
    """A rounded deckhouse hood: rectangular sections with cut corners."""
    put, mesh = tools['put'], tools['mesh']
    verts = []
    for x, y, half, low, high in sections:
        verts += [(x, y - half, low), (x, y + half, low), (x, y + half * .88, high - .10),
                  (x, y + half * .55, high), (x, y - half * .55, high), (x, y - half * .88, high - .10)]
    k = 6
    faces = []
    for j in range(len(sections) - 1):
        for i in range(k):
            n = (i + 1) % k
            faces.append((j * k + i, j * k + n, (j + 1) * k + n, (j + 1) * k + i))
    faces.append(tuple(reversed(range(k))))
    faces.append(tuple((len(sections) - 1) * k + i for i in range(k)))
    return put(mesh(label, verts, faces, material), parent)


# --------------------------------------------------------------------------
# Type B twin: Akatsuki AB1 artillery, jgm148_127mm50_type_b
# --------------------------------------------------------------------------
def create_type_b_twin(mount, col, helpers, materials):
    tools = _setup(mount, col, helpers, materials)
    spec, put, palette = tools['spec'], tools['put'], tools['palette']
    box, rod, cyl = tools['box'], tools['rod'], tools['cyl']

    _sole(tools, 1.65, .31)
    _apron(tools, (-3.62, 2.30), .34, .06)
    # Continuous walkway flange at platform level, as on the source.
    walk = _walkway(tools, -3.88, 1.20, .20, 2.07)

    made = _barrels(tools, .20, (1.90, .175), .162, -.40)
    for side, y, elevation, recoil in made:
        _port_hood(tools, elevation, y, 2.31, .22, .245, 1.15, 2.42)
    for sign in (1, -1):
        cheek = put(box('port-cheek', (1.62, sign * .92, 1.72), (.44, .13, .52),
                        palette['naval'], bev=.02))
        cheek.rotation_euler.y = math.radians(-16)

    # Raised port sight house and its domed forward hood; the source carries
    # them only on the port side, which is what breaks this mount's symmetry.
    roof = tools['top_z'](-1.00, 1.40) or 2.44
    _hood_loft(tools, 'sight-house', [
        (-1.84, 1.41, .40, 2.20, 3.06),
        (-.60, 1.48, .50, 2.20, 3.16),
        (.30, 1.66, .73, 2.24, 3.36),
        (1.30, 1.62, .70, 2.30, 3.26),
        (2.12, 1.50, .46, 2.36, 2.90)], palette['naval'])
    put(box('sight-hood-window', (2.14, 1.50, 2.72), (.03, .34, .16), palette['glass'], bev=.006))
    for x in (-1.40, -.30, .80):
        put(rod('house-grab', (x, 1.02, roof + .12), (x, 1.80, roof + .12), .017,
                palette['painted-edge'], vertices=4))

    # Aft roof house, periscope post and the roof hatches to starboard of it.
    put(box('roof-house', (-1.56, 0, 2.62), (1.49, 1.22, .33), palette['naval'], bev=.04))
    post_z = tools['top_z'](0, 0) or 2.50
    put(rod('periscope-post', (0, 0, post_z - .02), (0, 0, post_z + .13), .10,
            palette['painted-edge'], vertices=8))
    _roof_fittings(tools, [(-2.70, .80), (-2.70, -.80), (.60, -1.10), (-.70, -1.30)], radius=.17)

    # The source rails the walkway edge, not the roof: stanchions stand on the
    # flange and the top rail runs 37 cm above it.
    for sign in (1, -1):
        edge = []
        for x in (1.05, .20, -1.10, -2.40, -3.30, -3.75):
            w = tools['half_width'](x, 2.07)
            if w is None:
                continue
            edge.append((x, sign * (w + .16), 2.09))
            put(rod('walkway-stanchion', (x, sign * (w + .16), 2.09),
                    (x, sign * (w + .16), 2.44), .018, palette['painted-edge'], vertices=4))
        if len(edge) > 1:
            for height in (.21, .37):
                put(_tube_path(tools, 'walkway-rail', [(x, y, z + height) for x, y, z in edge],
                               .016, palette['painted-edge']))
    _rails(tools, [1.70, .70, -.60, -1.90, -2.90], [.60, 1.55])

    for sign in (1, -1):
        _rear_door(tools, sign * .82, 1.30, 1.02, 1.52, -3.62)
        put(box('ready-locker', (-3.30, sign * 1.24, .62), (.48, .42, .46), palette['naval'], bev=.03))
    _rear_ladder(tools, -3.66, .30, .60, 2.28)
    return _finish(mount, tools)


# --------------------------------------------------------------------------
# Enclosed twin the source names jgm176_127mm_50_type5: Hayate A artillery
# --------------------------------------------------------------------------
def create_type_five(mount, col, helpers, materials):
    tools = _setup(mount, col, helpers, materials)
    spec, put, palette = tools['spec'], tools['put'], tools['palette']
    box, rod, cyl = tools['box'], tools['rod'], tools['cyl']

    _sole(tools, 2.30, .346)
    _apron(tools, (-4.60, 3.05), .40, .06)
    _walkway(tools, -4.74, 2.40, .13, 2.62)

    made = _barrels(tools, .215, (2.35, .175), .158, -.45)
    for side, y, elevation, recoil in made:
        _port_hood(tools, elevation, y, 3.70, 1.90, .262, 1.62, 2.90)
    for sign in (1, -1):
        cheek = put(box('port-cheek', (2.70, sign * .95, 2.10), (.52, .15, .60),
                        palette['naval'], bev=.02))
        cheek.rotation_euler.y = math.radians(-20)
        # Boarding steps bracketed off each flank, as on the source.
        put(box('flank-step', (2.73, sign * 2.63, 1.17), (.78, .86, .04), palette['naval'], bev=.01))
        for dx in (-.30, .30):
            put(rod('step-bracket', (2.73 + dx, sign * 2.30, 1.15),
                    (2.73 + dx, sign * 2.98, 1.15), .026, palette['painted-edge'], vertices=4))

    # Roof: hatches, ventilator mushrooms and the light forward tripod.
    _roof_fittings(tools, [(-3.10, 1.20), (-3.10, -1.20), (-1.40, 1.70), (-1.40, -1.70),
                           (.40, 1.30), (.40, -1.30)], radius=.20)
    for sign in (1, -1):
        put(cyl('vent-mushroom', (-2.20, sign * .55, (tools['top_z'](-2.20, sign * .55) or 3.2) + .12),
                .18, .24, palette['naval'], 10))
    apex = (1.48, 1.72, 3.70)
    for dx, dy in [(-.55, -.42), (.55, -.42), (0, .52)]:
        foot = (apex[0] + dx, apex[1] + dy, tools['top_z'](apex[0] + dx, apex[1] + dy) or 3.0)
        put(rod('tripod-leg', foot, apex, .045, palette['painted-edge'], vertices=6))
    put(cyl('tripod-head', (apex[0], apex[1], apex[2] + .05), .08, .12, palette['naval'], 8))

    # Guard rails stand on the walkway flange.
    for sign in (1, -1):
        edge = []
        for x in (2.25, 1.20, -.40, -2.00, -3.40, -4.50):
            w = tools['half_width'](x, 2.62)
            if w is None:
                continue
            edge.append((x, sign * (w + .10), 2.64))
            put(rod('walkway-stanchion', (x, sign * (w + .10), 2.64),
                    (x, sign * (w + .10), 3.02), .018, palette['painted-edge'], vertices=4))
        if len(edge) > 1:
            for height in (.22, .38):
                put(_tube_path(tools, 'walkway-rail', [(x, y, z + height) for x, y, z in edge],
                               .016, palette['painted-edge']))
    _rails(tools, [2.30, 1.10, -.50, -2.20, -3.60], [.75, 1.85])

    for sign in (1, -1):
        _rear_door(tools, sign * .95, 1.45, 1.10, 1.80, -4.64)
        put(box('ready-locker', (-4.20, sign * 1.45, .74), (.54, .48, .52), palette['naval'], bev=.03))
    _rear_ladder(tools, -4.70, .34, .70, 2.58)
    return _finish(mount, tools)


# --------------------------------------------------------------------------
# Type B single: Shiratsuyu AB1 artillery, jgm152_127mm50_type_b
# --------------------------------------------------------------------------
def create_type_b_single(mount, col, helpers, materials):
    tools = _setup(mount, col, helpers, materials)
    spec, put, palette = tools['spec'], tools['put'], tools['palette']
    box, rod, cyl = tools['box'], tools['rod'], tools['cyl']

    _sole(tools, 1.20, .30)
    _apron(tools, (-3.30, 2.02), .30, .05)

    made = _barrels(tools, .185, (1.85, .160), .150, -.40)
    for side, y, elevation, recoil in made:
        _port_hood(tools, elevation, y, 2.38, .90, .235, 1.18, 2.24)
    for sign in (1, -1):
        cheek = put(box('port-cheek', (1.62, sign * .62, 1.68), (.40, .12, .46),
                        palette['naval'], bev=.02))
        cheek.rotation_euler.y = math.radians(-20)

    # Two ranks of side shelves bracketed off each flank, as on the source.
    _side_shelf(tools, -3.35, 1.70, .10, 1.86)
    _side_shelf(tools, -2.67, 2.05, .18, .67)

    # The tall weather hood carries a wireless whip aft of the sighting port.
    hood_z = tools['top_z'](-2.60, 0) or 2.60
    put(box('rear-housing', (-3.28, 0, 1.88), (.16, 1.33, .13), palette['naval'], bev=.02))
    put(rod('aerial', (-1.60, .10, hood_z - .05), (-1.60, .10, 3.94), .028,
            palette['painted-edge'], r2=.010, vertices=6))
    for dy in (-.34, .34):
        put(rod('aerial-stay', (-1.60, .10, 3.10), (-1.60, .10 + dy, hood_z + .02), .012,
                palette['painted-edge'], vertices=4))

    _roof_fittings(tools, [(-2.30, .62), (-2.30, -.62), (-.70, .70), (-.70, -.70)], radius=.16)
    _roof_rail(tools, [(.95, .95), (.20, 1.28), (-1.30, 1.34), (-2.60, 1.10), (-3.05, .55),
                       (-3.05, -.55), (-2.60, -1.10), (-1.30, -1.34), (.20, -1.28), (.95, -.95)])
    _rails(tools, [1.40, .40, -.90, -2.10, -2.95], [.62, 1.55])

    _rear_door(tools, 0, 1.30, 1.16, 1.60, -3.30)
    _rear_ladder(tools, -3.33, .28, .62, 2.40)
    for sign in (1, -1):
        put(box('ready-locker', (-2.95, sign * 1.10, .60), (.44, .40, .44), palette['naval'], bev=.03))
    return _finish(mount, tools)

"""Original 46 cm Type 94 triple mount, the Yamato main turret.

Proportions follow the approved GameModels3D pjsb018 A artillery (`jgm178_460mm_45_type94`),
measured from its joint nodes and inspection sections. No reference geometry is loaded here.
The catalog `gunhouseMesh` is both the armour and the visible gunhouse. This recipe adds the
turntable, the low front plinth, three armoured round-topped gun ports with canvas blast bags,
stepped sliding barrels, the armoured end hoods of the 15 m rangefinder, the roof sights and
periscope hood, plate joints, rails, ladders, the rear davit and shelves and the side vision ports.
Authoring frame: +X muzzle, +Y port, +Z up. The origin is the yaw datum, 2.40 m below the
reference hardpoint, because the ship supplies the fixed barbette up to Z = 2.15.
"""
import math
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

D = 2.40            # reference hardpoint above the yaw datum
SEAT = 2.15         # top of the ship's fixed barbette
SLEEVE = .649       # constant reinforce radius: runs through the canvas cuff for the whole recoil
CUFF = 7.00         # canvas cuff station at rest (absolute x)
FACE_N = Vector((1, 0, 1.016)).normalized()   # 45-degree face plate: x + 1.016 (z - D) = 6.305
FACE_UP = Vector((-1.016, 0, 1)).normalized()  # up the face slope
PORT = dict(half=.79, low=-1.47, high=1.77, bottom=.30)  # seam in face coordinates about the 0-degree crossing


def _face_x(z):
    return 6.305 - 1.016 * (z - D)


def _rounded_port(half, low, high, bottom, samples):
    """Round-topped port outline sampled by polar angle from its centre (angle 0 = +Y, winding up)."""
    centre = (low + high) / 2
    top = high - half
    outline = []
    for i in range(24):  # upper semicircle, +u to -u
        a = math.pi * i / 23
        outline.append((half * math.cos(a), top + half * math.sin(a)))
    for i in range(7):  # lower -u corner
        a = math.pi + math.pi / 2 * i / 6
        outline.append((-half + bottom + bottom * math.cos(a), low + bottom + bottom * math.sin(a)))
    for i in range(7):  # lower +u corner
        a = 1.5 * math.pi + math.pi / 2 * i / 6
        outline.append((half - bottom + bottom * math.cos(a), low + bottom + bottom * math.sin(a)))
    for i in range(1, 24):  # straight jambs and sill
        t = i / 24
        outline.append((half, low + bottom + (top - low - bottom) * t))
        outline.append((-half, low + bottom + (top - low - bottom) * t))
        outline.append((-half + bottom + (2 * half - 2 * bottom) * t, low))
    polar = sorted((math.atan2(v - centre, u) % math.tau, math.hypot(u, v - centre)) for u, v in outline)
    polar = [(polar[-1][0] - math.tau, polar[-1][1])] + polar + [(polar[0][0] + math.tau, polar[0][1])]
    result = []
    for k in range(samples):
        a = k * math.tau / samples
        for (a0, r0), (a1, r1) in zip(polar, polar[1:]):
            if a0 <= a <= a1:
                r = r0 + (r1 - r0) * (a - a0) / max(1e-9, a1 - a0)
                break
        result.append((r * math.cos(a), centre + r * math.sin(a)))
    return result


def create_yamato_main(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    for key, fallback in [('roof', 'naval'), ('painted-edge', 'edge'), ('glass', 'dark'), ('canvas', 'dark')]:
        palette.setdefault(key, palette[fallback])
    naval, roof, edge, dark, painted, glass = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'])
    name = mount['id']
    spec = mount['weapon']
    pivot, height = spec['trunnionForward'], spec['pivotHeight']

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

    def loft(label, sections, material, caps=(True, True), smooth=False, closed=True, parent=None):
        k = len(sections[0])
        verts = [tuple(p) for s in sections for p in s]
        faces = []
        for j in range(len(sections) - 1):
            for i in range(k if closed else k - 1):
                faces.append((j * k + i, j * k + (i + 1) % k, (j + 1) * k + (i + 1) % k, (j + 1) * k + i))
        if caps[0]: faces.append(tuple(reversed(range(k))))
        if caps[1]: faces.append(tuple(range((len(sections) - 1) * k, len(sections) * k)))
        return put(mesh(name + '.' + label, verts, faces, material, col, smooth), parent)

    # ---- the catalog shell is the visible gunhouse --------------------------------------------
    shape = spec['gunhouseMesh']
    shell = put(mesh(name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                     [f['indices'] for f in shape['faces']], naval, col))
    shell.data.materials.append(roof)
    for polygon, face in zip(shell.data.polygons, shape['faces']):
        polygon.material_index = 1 if face['finish'] == 'roof' else 0
    plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]

    def cast(origin, direction):
        o, d = Vector(origin), Vector(direction)
        found = []
        for t in plates:
            hit = intersect_ray_tri(t[0], t[1], t[2], d, o)
            if hit is not None:
                normal = (t[1] - t[0]).cross(t[2] - t[0]).normalized()
                if normal.dot(d) > 0: normal = -normal
                found.append(((hit - o).length, hit, normal))
        return sorted(found, key=lambda h: h[0])

    def surface(origin, direction):
        first = cast(origin, direction)
        if not first: raise ValueError(f'{name}: no gunhouse surface from {origin} along {direction}')
        return first[0][1], first[0][2]

    def top(x, y): return surface((x, y, 20), (0, 0, -1))
    def flank(x, z, s): return surface((x, s * 20, z), (0, -s, 0))
    def back(y, z): return surface((-20, y, z), (1, 0, 0))

    # Rotating sole on the ship's barbette; the housing overhangs it as on the reference.
    put(cyl(name + '.roller', (0, 0, (SEAT + 2.43) / 2), spec['barbetteRadius'] + .02, 2.43 - SEAT, painted, col, 48))

    # Low curved plinth under the gun ports: its sloped top runs back into the face plate.
    front = [(6.33, 4.98), (6.33, 3.37), (6.45, 2.91), (6.75, 1.97), (6.93, 1.0), (7.0, 0)]
    front = front + [(x, -y) for x, y in reversed(front[:-1])]
    k = len(front)
    verts = [(x, y, 2.40) for x, y in front] + [(x, y, 2.75) for x, y in front]
    verts += [(5.6, -4.98, 2.40), (5.6, 4.98, 2.40), (5.6, -4.98, 2.75), (5.6, 4.98, 2.75)]
    faces = [(i + 1, i, k + i, k + i + 1) for i in range(k - 1)]
    faces.append(tuple(reversed(tuple(range(k, 2 * k)) + (2 * k + 2, 2 * k + 3))))
    faces.append((2 * k + 3, k, 0, 2 * k + 1))
    faces.append((2 * k - 1, 2 * k + 2, 2 * k, k - 1))
    put(mesh(name + '.front-plinth', verts, faces, naval, col))

    # ---- gun ports: raised round-topped frames on the face; the bag seam sits inside them ------
    sectors = 28
    seam = _rounded_port(PORT['half'], PORT['low'], PORT['high'], PORT['bottom'], sectors)
    frame_out = _rounded_port(PORT['half'] + .11, PORT['low'] - .11, PORT['high'] + .11, PORT['bottom'] + .11, sectors)

    def on_face(y, u, v, proud):
        origin = Vector((_face_x(height), y, height))  # where the level bore meets the face
        return origin + Vector((0, u, 0)) + FACE_UP * v + FACE_N * proud

    layout = barrel_layout(spec)
    for side, y, _ in layout:
        rings = [[on_face(y, u, v, -.03) for u, v in frame_out], [on_face(y, u, v, .085) for u, v in frame_out],
                 [on_face(y, u, v, .085) for u, v in seam], [on_face(y, u, v, -.03) for u, v in seam]]
        loft(side + '.port-frame', rings, naval, caps=(False, False))
        # Frame bolts along the upper arch.
        for i in range(2, sectors // 2 - 1, 3):
            u, v = frame_out[i]
            p = on_face(y, u * .955, v - .05 * math.sin(i * math.tau / sectors), .07)
            put(rod(name + '.' + side + '.port-bolt', p, p + FACE_N * .05, .03, painted, col, vertices=6))

    # Brow bars along the head of the face plate (split for the face ladder).
    for y0, y1 in [(.23, 4.70), (-4.70, -1.90)]:
        p = Vector((_face_x(5.66), (y0 + y1) / 2, 5.66)) + FACE_N * .02
        bar = put(box(name + '.face-brow', tuple(p), (.08, y1 - y0, .14), naval, col))
        bar.rotation_euler.y = -math.atan2(FACE_N.z, FACE_N.x)

    # ---- barrels: reinforce, clear shoulder, chase and muzzle swell -----------------------------
    length = spec['muzzleForward'] - pivot
    bore = spec['caliberM'] / 2
    profile = [(.25, SLEEVE), (5.70, SLEEVE), (5.76, .632), (5.84, .612), (6.40, .553),
               (length - .45, .390), (length - .30, .401), (length, .401)]
    count = 20
    for side, y, _ in layout:
        elevation = joint(side + '.elevation', yaw, (pivot, y, height))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        points = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                  for x, r in profile for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(len(profile) - 1) for i in range(count)]
        faces.append(tuple(reversed(range(count))))
        put(mesh(name + '.' + side + '.barrel', points, faces, edge, col, True), recoil)
        rim = [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
               for x, r in [(length, .401), (length, bore), (length - .5, bore)] for i in range(count)]
        faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                 for j in range(2) for i in range(count)]
        put(mesh(name + '.' + side + '.muzzle-rim', rim, faces, edge, col), recoil)
        put(rod(name + '.' + side + '.bore-interior', (length - .52, 0, 0), (length - .5, 0, 0), bore, dark, col,
                vertices=count), recoil)
        # Lashing band at the bag's cuff: pitches with the gun while the reinforce recoils through it.
        put(rod(name + '.' + side + '.bag-band', (CUFF - pivot - .06, 0, 0), (CUFF - pivot + .12, 0, 0), SLEEVE + .03,
                palette['canvas'], col, vertices=count), elevation)

    # ---- 15 m rangefinder: armoured end hoods through the rear flanks -------------------------
    zb, zt, c = 4.00, 5.26, .14
    def xf(y): return -6.90 + (y - 5.20) * .291
    def xr(y): return -9.30 - (y - 4.70) * .16
    def section(y, x0, x1, z0, z1, ch=c, s=1, aft=.26):
        # Broad bevels close the after end; the forward edges carry a light chamfer.
        return [(x0 + aft, s * y, z0), (x1 - ch, s * y, z0), (x1, s * y, z0 + ch), (x1, s * y, z1 - ch),
                (x1 - ch, s * y, z1), (x0 + aft, s * y, z1), (x0, s * y, z1 - aft), (x0, s * y, z0 + aft)]
    for s in (1, -1):
        mid, tip, back_x = 6.35, 7.92, -8.67
        body = [section(4.30, xr(4.30), xf(4.30), zb, zt, s=s), section(mid, xr(mid), xf(mid), zb, zt, s=s)]
        if s > 0: body = [list(reversed(r)) for r in body]
        loft('rangefinder-hood', body, naval)
        rear = [section(mid, xr(mid), back_x, zb, zt, s=s), section(7.55, xr(7.55), back_x, zb, zt, s=s),
                section(tip, xr(7.55) + .35, back_x, zb, zt, s=s)]
        if s > 0: rear = [list(reversed(r)) for r in rear]
        loft('rangefinder-hood.aft', rear, naval)
        for label, z0, z1 in [('crown', zt - .07, zt), ('sill', zb, zb + .24)]:
            plate = [[(back_x - .02, s * y, z0), (xf(y), s * y, z0), (xf(y), s * y, z1), (back_x - .02, s * y, z1)]
                     for y in (mid - .02, tip)]
            if s > 0: plate = [list(reversed(r)) for r in plate]
            loft('rangefinder-hood.' + label, plate, naval)
        end = [[(back_x - .02, s * y, zb + .2), (xf(y), s * y, zb + .2), (xf(y), s * y, zt - .05), (back_x - .02, s * y, zt - .05)]
               for y in (tip - .08, tip)]
        if s > 0: end = [list(reversed(r)) for r in end]
        loft('rangefinder-hood.end', end, naval)
        # Shadowed back of the window, the objective carriage and its glass.
        put(box(name + '.rangefinder-window.back', (back_x + .01, s * (mid + tip) / 2, (zb + zt) / 2),
                (.03, tip - mid, zt - zb - .30), dark, col))
        # Objective carriage at the back of the open window, and its glass.
        put(box(name + '.rangefinder-objective', (-8.25, s * 7.15, 4.64), (.86, .62, .56), edge, col))
        put(box(name + '.rangefinder-glass', (-7.815, s * 7.15, 4.64), (.02, .46, .40), glass, col))
        # Gussets under the hood's forward and after roots, and three grab rungs beside the window.
        for gx, root in [(xf(5.15) - .15, 5.15), (-8.75, 4.95)]:
            tri = [(s * (root - .05), zb + .02), (s * (root + .85), zb + .02), (s * (root + .20), 3.20)]
            gusset = [[(x, y, z) for y, z in tri] for x in (gx - .06, gx + .06)]
            if s > 0: gusset = [list(reversed(r)) for r in gusset]
            loft('rangefinder-gusset', gusset, naval)
        for z in (4.24, 4.65, 5.05):
            a, b = Vector((xf(6.24) - .01, s * 6.24, z)), Vector((xf(6.54) - .01, s * 6.54, z))
            out = Vector((1, -.291 * s, 0)).normalized() * .20
            for p in (a, b): put(rod(name + '.rangefinder-rung.leg', p - out * .1, p + out, .02, painted, col, vertices=4))
            put(rod(name + '.rangefinder-rung', a + out, b + out, .022, painted, col, vertices=4))

    # ---- roof: plate joints, lifting eyes, sights, periscope hood, conduit, edge rails ---------
    for x in (-7.0, -3.55, -.40, 2.45):
        z = top(x, 0)[0].z
        put(box(name + '.roof-joint', (x, 0, z + .005), (.10, 8.3 if x > -7.5 else 8.0, .03), naval, col))
    for x in (-7.15, -3.87, -.58, 2.62):
        z = top(x, 0)[0].z
        put(cyl(name + '.roof-eye-pad', (x, 0, z + .02), .13, .05, painted, col, 8))
        for dy in (-.05, .05):
            put(rod(name + '.roof-eye', (x - .08, dy, z + .02), (x - .08, dy, z + .2), .022, painted, col, vertices=4))
            put(rod(name + '.roof-eye', (x + .08, dy, z + .02), (x + .08, dy, z + .2), .022, painted, col, vertices=4))
        put(rod(name + '.roof-eye', (x - .1, 0, z + .2), (x + .1, 0, z + .2), .03, painted, col, vertices=6))

    # Gunlayer's sight hood: a broad base with a raised cowl and its forward window.
    base_z = top(-2.58, .70)[0].z
    put(box(name + '.sight-hood.base', (-2.58, .70, base_z + .17), (1.74, .79, .40), naval, col))
    put(box(name + '.sight-hood.cowl', (-2.85, .70, base_z + .52), (1.10, .66, .32), naval, col))
    put(rod(name + '.sight-hood.crown', (-2.85, .40, base_z + .67), (-2.85, 1.0, base_z + .67), .20, naval, col, vertices=10))
    put(box(name + '.sight-hood.window', (-1.705, .70, base_z + .20), (.02, .52, .14), glass, col))
    put(box(name + '.sight-hood.window', (-2.295, .70, base_z + .52), (.02, .44, .12), glass, col))

    # Commander's periscope hood (starboard aft) and its periscope pillar.
    pz = top(-7.67, -1.535)[0].z - .02
    prof = [(-.515, 0), (.515, 0), (.40, .56), (.24, .76), (0, .82), (-.24, .76), (-.40, .56)]
    loft('periscope-hood', [[(x, -1.535 + u, pz + w) for u, w in prof] for x in (-7.93, -7.41)], naval)
    put(box(name + '.periscope-hood.slot', (-7.40, -1.535, pz + .44), (.02, .16, .56), dark, col))
    qz = top(-7.18, -1.53)[0].z - .02
    for z0, h, r in [(0, .12, .29), (.12, .42, .19), (.54, .08, .29), (.62, .11, .21)]:
        put(cyl(name + '.periscope-pillar', (-7.18, -1.53, qz + z0 + h / 2), r, h, naval, col, 8))
    put(box(name + '.periscope-pillar.window', (-6.98, -1.53, qz + .30), (.02, .2, .1), glass, col))

    # Small forward sight hood (port side, ahead of the joint).
    fz = top(1.83, 1.52)[0].z - .02
    put(cyl(name + '.fore-sight.base', (1.83, 1.52, fz + .07), .37, .14, naval, col, 12))
    put(cyl(name + '.fore-sight', (1.83, 1.52, fz + .31), .20, .36, naval, col, 12))
    put(cyl(name + '.fore-sight.cap', (1.83, 1.52, fz + .54), .15, .12, naval, col, 12, .09))
    put(box(name + '.fore-sight.window', (2.02, 1.52, fz + .38), (.03, .16, .08), glass, col))

    # Voice-pipe conduit along the port half of the roof on saddles.
    cz = top(-4.5, 1.6)[0].z
    a, b = Vector((-6.85, 1.60, top(-6.85, 1.6)[0].z + .07)), Vector((-2.25, 1.60, top(-2.25, 1.6)[0].z + .07))
    put(rod(name + '.roof-conduit', a, b, .05, painted, col, vertices=6))
    for t in (0, .5, 1):
        p = a.lerp(b, t)
        put(box(name + '.roof-conduit.saddle', (p.x, p.y, p.z - .045), (.10, .16, .09), painted, col))
    put(rod(name + '.roof-conduit.elbow', b, (b.x + .05, 1.25, b.z), .05, painted, col, vertices=6))

    # Edge rails on the crown chamfers: stanchions welded to the plate and a single top rail.
    for s in (1, -1):
        tops = []
        for x, y in [(-8.85, 4.10), (-6.58, 4.57), (-4.70, 4.72), (-3.26, 4.79), (-1.60, 4.95), (-.01, 5.08), (1.61, 5.15)]:
            p, _ = top(x, s * y)
            put(rod(name + '.edge-stanchion', (x, s * y, p.z - .03), (x, s * y, p.z + .30), .022, painted, col, vertices=4))
            tops.append(Vector((x, s * y, p.z + .30)))
        for p, q in zip(tops, tops[1:]):
            put(rod(name + '.edge-rail', p, q, .016, painted, col, vertices=4))

    # ---- ladders ---------------------------------------------------------------------------------
    def ladder(label, path, across, off=.07, rung=.30, feet=()):
        """Two rails following `path` (points on the plate with their outward normals)."""
        rails = []
        for sign in (-1, 1):
            pts = [p + n * off + across * sign * .20 for p, n in path]
            rails.append(pts)
            for p, q in zip(pts, pts[1:]):
                put(rod(name + '.' + label + '.rail', p, q, .026, painted, col, vertices=4))
            for index in feet:
                p, n = path[index]
                base = p + across * sign * .20
                put(rod(name + '.' + label + '.standoff', base - n * .02, base + n * off, .02, painted, col, vertices=4))
        # rungs at even spacing along the path
        total = sum((q[0] - p[0]).length for p, q in zip(path, path[1:]))
        d = .25
        while d < total - .1:
            run = d
            for (p, n), (q, m) in zip(path, path[1:]):
                seg = (q - p).length
                if run <= seg:
                    t = run / seg
                    point = p.lerp(q, t) + n.lerp(m, t).normalized() * off
                    put(rod(name + '.' + label + '.rung', point - across * .20, point + across * .20, .018, painted, col, vertices=4))
                    break
                run -= seg
            d += rung

    for s in (1, -1):
        x = -1.56
        path = [flank(x, z, s) for z in (2.46, 3.4, 4.3, 5.1, 5.55)]
        ladder('flank-ladder', path, Vector((1, 0, 0)), feet=(0, 2, 4))
    path = [(Vector((_face_x(z), -1.555, z)), FACE_N.copy()) for z in (2.80, 4.3, 5.78)]
    ladder('face-ladder', path, Vector((0, 1, 0)), feet=(0, 1, 2))
    edge_z = top(2.70, -1.555)[0].z
    for dy in (-.20, .20):  # hand hooks over the head of the face
        p = Vector((_face_x(5.78), -1.555 + dy, 5.78)) + FACE_N * .07
        q = Vector((2.55, -1.555 + dy, edge_z + .30))
        put(rod(name + '.face-ladder.hook', p, q, .026, painted, col, vertices=4))
        put(rod(name + '.face-ladder.hook', q, (2.30, -1.555 + dy, edge_z - .02), .026, painted, col, vertices=4))
    path = [back(-1.135, z) for z in (2.52, 3.6, 4.8, 6.10)]
    ladder('rear-ladder', path, Vector((0, 1, 0)), feet=(0, 1, 2, 3))
    rz = top(-9.9, -1.135)[0].z
    for dy in (-.20, .20):
        p, n = path[-1]
        p = p + n * .07 + Vector((0, dy, 0))
        put(rod(name + '.rear-ladder.hook', p, (p.x + .10, p.y, rz + .40), .026, painted, col, vertices=4))
        put(rod(name + '.rear-ladder.hook', (p.x + .10, p.y, rz + .40), (p.x + .45, p.y, rz - .02), .026, painted, col, vertices=4))

    # ---- flanks: octagonal vision ports on the forward quarter plates ---------------------------
    for s in (1, -1):
        p, n = flank(2.42, 3.82, s)
        put(rod(name + '.vision-port.boss', p - n * .04, p + n * .10, .42, naval, col, vertices=8))
        put(rod(name + '.vision-port.cover', p + n * .08, p + n * .16, .29, painted, col, vertices=8))
        put(rod(name + '.vision-port.hinge', p + n * .10 + Vector((0, 0, .20)), p + n * .10 + Vector((0, 0, .36)), .04, painted, col, vertices=6))

    # ---- rear: boat davit arm, stowage shelves, lamp ---------------------------------------------
    def aft(y, z, off):
        p, n = back(y, z)
        return p + n * off
    put(box(name + '.rear-davit.bracket', tuple(aft(1.25, 5.45, .10)), (.24, .26, .52), painted, col))
    arm = [aft(1.25, 5.62, .26), aft(.20, 5.74, .30), aft(-.85, 5.36, .26)]
    for p, q in zip(arm, arm[1:]):
        put(rod(name + '.rear-davit.arm', p, q, .10, painted, col, vertices=6))
    put(box(name + '.rear-davit.rest', tuple(aft(-.85, 5.30, .12)), (.26, .22, .30), painted, col))
    for label, y0, y1, z, depth in [('rear-shelf.upper', -.87, 1.0, 5.18, .36), ('rear-shelf.lower', -.87, .87, 3.27, .62)]:
        p = aft((y0 + y1) / 2, z, depth / 2 - .02)
        put(box(name + '.' + label, tuple(p), (depth, y1 - y0, .05), painted, col))
        for y in (y0 + .1, (y0 + y1) / 2, y1 - .1):
            q = aft(y, z - .22, .0)
            put(rod(name + '.' + label + '.bracket', q, (p.x - depth / 2 + .05, y, z - .02), .025, painted, col, vertices=4))
    lamp = aft(1.55, 5.78, 0)
    put(rod(name + '.rear-lamp', lamp, lamp + Vector((-.14, 0, 0)), .11, painted, col, vertices=8))
    put(rod(name + '.rear-lamp.lens', lamp + Vector((-.14, 0, 0)), lamp + Vector((-.16, 0, 0)), .08, glass, col, vertices=8))

    # ---- canvas blast bags: seam on the port frame, cuff on the reinforce -----------------------
    for side, y, _ in layout:
        rim = [tuple(on_face(y, u, v, .05)) for u, v in seam]
        cover = create_bloomer(mount, col, helpers, palette, side, rim, CUFF, SLEEVE + .015,
                               rings=7, fold_depth=.10, slack=0, fullness=.03, forward_fullness=.05)
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        rings = len(cover.data.vertices) // sectors
        origin = Vector((pivot, y, height))
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = Vector((math.cos(theta), 0, math.sin(theta)))
            for index, point in enumerate(key.data):
                j, i = divmod(index, sectors)
                if j == 0 or j == rings - 1:
                    continue
                t = j / (rings - 1)
                envelope = math.sin(math.pi * t)
                a = i * math.tau / sectors
                # The reference bag rides high over the gun and sags onto the plinth below it.
                point.co.z += (.25 * envelope ** 2 * max(0, math.sin(a)) ** 1.5
                               - .30 * envelope ** .7 * max(0, -math.sin(a)) ** 2)
                # Stay proud of the face plate.
                depth = (point.co - Vector((_face_x(point.co.z), point.co.y, point.co.z))).dot(FACE_N)
                if depth < .04:
                    point.co += FACE_N * (.04 - depth)
                # Stay outside the sliding reinforce.
                rel = point.co - origin
                along = rel.dot(axis)
                radial = rel - axis * along
                need = (SLEEVE + .05) / math.cos(math.pi / sectors)
                if along > 0 and radial.length < need:
                    point.co = origin + axis * along + radial.normalized() * need
                # Above the plinth.
                point.co.z = max(point.co.z, 2.80)
        for vertex, base in zip(cover.data.vertices, cover.data.shape_keys.key_blocks[0].data):
            vertex.co = base.co

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

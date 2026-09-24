"""Original USS Alaska topside and underwater fittings, proportioned to the approved
GameModels3D pasc510 A hull. Positions are the reference's measured datums in the
reference frame (x starboard, y up, z toward the stern), converted once by `P`.
No reference geometry is loaded.
"""
import math
from mathutils import Vector
from blender_fidelity import Fittings, loft_breadth
from blender_rig import radar_pivot

ZC = -1.995


def P(x, y, z):
    """Reference-frame point -> authoring frame (+X bow, +Y port, +Z up)."""
    return (-(z - ZC), -x, y)


def build_fittings(D, helpers, materials, collections, support, deckz, width):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    H = D['hull']

    def tag(ob, assembly):
        ob['assemblyId'] = assembly
        return ob

    def part(kind, assembly, col, *args, **kw):
        return tag(helpers[kind](assembly + '.' + args[0], *args[1:], col=col, **kw), assembly)

    def objects_since(before):
        import bpy
        return [o for o in bpy.context.scene.objects if o.name not in before]

    def names():
        import bpy
        return {o.name for o in bpy.context.scene.objects}

    def lattice(name, a, b, w, h, col, n=None, chord=.06, web=.035, assembly=None):
        a, b = Vector(a), Vector(b)
        d = (b - a)
        L = d.length
        d.normalize()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = Vector((0, 1, 0))
        side.normalize()
        up = side.cross(d).normalized()
        n = n or max(4, int(L / 1.2))
        out = []
        for s in (-1, 1):
            for u in (-1, 1):
                out.append(rod(name + ' chord', a + side * s * w / 2 + up * u * h / 2, b + side * s * w / 2 + up * u * h / 2, chord, 'naval', col, vertices=6))
        for i in range(n):
            p, q = a.lerp(b, i / n), a.lerp(b, (i + 1) / n)
            for s in (-1, 1):
                out.append(rod(name + ' web', p + side * s * w / 2 - up * h / 2, q + side * s * w / 2 + up * h / 2, web, 'edge', col, vertices=5))
            out.append(rod(name + ' tie', p - side * w / 2 + up * h / 2, p + side * w / 2 + up * h / 2, web, 'edge', col, vertices=5))
            out.append(rod(name + ' tie', q - side * w / 2 - up * h / 2, q + side * w / 2 - up * h / 2, web, 'edge', col, vertices=5))
        for o in out:
            tag(o, assembly or name)
        return out

    def grid(name, center, w, h, col, normal='x', rows=8, cols=12, bar=.022, assembly=None):
        cx, cy, cz = center
        pt = (lambda a, b: (cx, cy + a, cz + b)) if normal == 'x' else (lambda a, b: (cx + a, cy, cz + b))
        out = []
        for i in range(cols + 1):
            a = -w / 2 + w * i / cols
            out.append(rod(name + ' vertical', pt(a, -h / 2), pt(a, h / 2), bar, 'edge', col, vertices=5))
        for j in range(rows + 1):
            b = -h / 2 + h * j / rows
            out.append(rod(name + ' horizontal', pt(-w / 2, b), pt(w / 2, b), bar, 'edge', col, vertices=5))
        out.append(rod(name + ' frame', pt(-w / 2, -h / 2), pt(w / 2, -h / 2), bar * 2.6, 'naval', col, vertices=6))
        out.append(rod(name + ' frame', pt(-w / 2, h / 2), pt(w / 2, h / 2), bar * 2.6, 'naval', col, vertices=6))
        for o in out:
            tag(o, assembly or name)
        return out

    F = Fittings(helpers, materials, collections['Deck fittings'])

    # Rails stay out of the barrels' arcs (removable in action) and from under turning gunhouses.
    arcs = []
    for m in D['mounts']:
        w = m['weapon']
        if m['battery'] != 'main' and 'us-5in38' not in m['partId']:
            continue
        mx, my, mz = -m['position'][2], -m['position'][0], m['position'][1]
        house = max((v[0] ** 2 + v[1] ** 2) ** .5 for v in w['gunhouseMesh']['vertices']) + .2 if w.get('gunhouseMesh') else max(w['gunhouseSize'][:2]) * .6
        arcs.append((mx, my, mz, house, w))

    def in_arc(a, b):
        for p in (a, b, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)):
            for mx, my, mz, house, w in arcs:
                d = math.hypot(p[0] - mx, p[1] - my)
                if d < house and max(a[2], b[2]) > mz - .05:
                    return True
                low = mz + w['pivotHeight'] + math.sin(math.radians(w['elevationMinDeg'])) * max(0, d - w['trunnionForward']) - w.get('barrelBaseRadius', .4) - .15
                if d < w['muzzleForward'] + .6 and max(a[2], b[2]) > low:
                    return True
        return False

    class Wires:
        """Thin rails, stanchions and wires as one capless triangular-tube mesh per assembly."""
        def __init__(self):
            self.runs = {}

        def add(self, assembly, col, a, b, r):
            if in_arc(a, b):
                return
            self.runs.setdefault((assembly, col.name), (col, []))[1].append((Vector(a), Vector(b), r))

        def build(self):
            for (assembly, _), (col, segs) in self.runs.items():
                vv, ff = [], []
                for a, b, r in segs:
                    d = b - a
                    if d.length < 1e-4:
                        continue
                    d.normalize()
                    u = d.cross(Vector((0, 0, 1))) if abs(d.z) < .95 else d.cross(Vector((1, 0, 0)))
                    u.normalize()
                    w = d.cross(u)
                    k = len(vv)
                    for p in (a, b):
                        for i in range(3):
                            ang = math.tau * i / 3
                            vv.append(tuple(p + (u * math.cos(ang) + w * math.sin(ang)) * r))
                    ff += [(k + i, k + (i + 1) % 3, k + 3 + (i + 1) % 3, k + 3 + i) for i in range(3)]
                if ff:
                    tag(mesh(assembly + '.wires', vv, ff, 'edge', col), assembly)

    W = Wires()

    # ------------------------------------------------------------ directors
    col = collections['Sensors and masts']

    def pedestal(assembly, base, top, radius, col):
        """A solid foundation from the supporting surface to the director's bearing."""
        x, y, z = base
        floor = min(z, support.below(x, y, z + .4))
        if z - floor > .02:
            part('cyl', assembly, col, 'foundation', (x, y, (floor + z) / 2), radius, z - floor + .02, 'naval', vertices=28)

    def mk38(id, ref, aft):
        before = names()
        x, y, z = P(*ref)
        s = -1 if aft else 1
        pedestal(id, (x, y, z), None, 1.25, col)
        moving = []
        moving.append(part('cyl', id, col, 'training base', (x, y, z + .18), 1.35, .36, 'edge', vertices=32))
        hull_pts = [(-1.55, -1.45), (1.2, -1.45), (1.65, -.95), (1.65, .95), (1.2, 1.45), (-1.55, 1.45)]
        vv = [(x + s * a, y + b, z + .36 + hz) for hz in (0, 1.5) for a, b in hull_pts]
        n = len(hull_pts)
        ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        moving.append(tag(mesh(id + '.armoured hood', vv, ff, 'naval', col), id))
        moving.append(part('box', id, col, 'hood roof', (x, y, z + 1.9), (3.1, 2.8, .08), 'roof'))
        half = 4.3
        moving.append(part('rod', id, col, 'rangefinder', (x - s * .25, y - half, z + 1.25), (x - s * .25, y + half, z + 1.25), .21, 'naval', vertices=16))
        for side in (-1, 1):
            moving.append(part('box', id, col, 'rangefinder hood', (x - s * .25, y + side * half, z + 1.25), (.62, .5, .62), 'naval'))
            moving.append(part('box', id, col, 'rangefinder window', (x + s * .06, y + side * half, z + 1.26), (.03, .34, .2), 'glass'))
        for dy in (-.7, 0, .7):
            moving.append(part('box', id, col, 'sight port', (x + s * 1.66, y + dy, z + 1.25), (.04, .36, .26), 'glass'))
        # Mk 8 fire-control radar antenna carried on the hood roof.
        moving += grid(id + '.mk8 antenna', (x - s * .6, y, z + 2.55), 3.2, .95, col, 'x', 4, 14, assembly=id)
        for dy in (-.9, .9):
            moving.append(part('rod', id, col, 'antenna standard', (x - s * .6, y + dy, z + 1.94), (x - s * .6, y + dy, z + 2.1), .05, 'naval', vertices=8))
        radar_pivot(id + '.yaw', (x, y, z + .18), [o for o in objects_since(before) if o in moving])

    def mk37(id, ref, aft):
        before = names()
        x, y, z = P(*ref)
        s = -1 if aft else 1
        pedestal(id, (x, y, z), None, 1.55, col)
        moving = [part('cyl', id, col, 'training base', (x, y, z + .2), 1.6, .4, 'edge', vertices=32)]
        pts = [(-1.85, -1.6), (1.55, -1.6), (1.95, -1.2), (1.95, 1.2), (1.55, 1.6), (-1.85, 1.6)]
        vv = [(x + s * a, y + b * (1 if hz == 0 else .96), z + .4 + hz) for hz in (0, 1.75) for a, b in pts]
        n = len(pts)
        ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        moving.append(tag(mesh(id + '.gun director house', vv, ff, 'naval', col), id))
        moving.append(part('box', id, col, 'roof', (x, y, z + 2.19), (3.8, 3.1, .07), 'roof'))
        moving.append(part('rod', id, col, 'rangefinder', (x - s * .4, y - 2.35, z + 1.55), (x - s * .4, y + 2.35, z + 1.55), .19, 'naval', vertices=16))
        for side in (-1, 1):
            moving.append(part('box', id, col, 'rangefinder hood', (x - s * .4, y + side * 2.35, z + 1.55), (.55, .42, .55), 'naval'))
        for dy in (-1.0, 0, 1.0):
            moving.append(part('box', id, col, 'sight hood', (x + s * 1.25, y + dy, z + 2.35), (.5, .38, .32), 'naval'))
        # Mk 12 / Mk 22 antenna pair on outriggers above the house.
        moving += grid(id + '.mk12 antenna', (x - s * .2, y, z + 3.2), 2.9, 1.3, col, 'x', 5, 12, assembly=id)
        moving += grid(id + '.mk22 antenna', (x - s * .2, y + 1.85, z + 3.25), .55, 1.6, col, 'x', 6, 2, assembly=id)
        for dy in (-1.2, 1.2):
            moving.append(part('rod', id, col, 'antenna bracket', (x - s * .2, y + dy, z + 2.22), (x - s * .2, y + dy, z + 2.55), .06, 'naval', vertices=8))
        radar_pivot(id + '.yaw', (x, y, z + .2), [o for o in objects_since(before) if o in moving])

    mk38('mk38-forward', (0, 32.24, -7.707), False)
    mk38('mk38-after', (0, 20.393, 33.164), True)
    mk37('mk37-forward', (0, 17.805, -17.016), False)
    mk37('mk37-after', (0, 14.109, 41.217), True)

    small = [('mk57', (0, 11.19, -111.26), 0), ('mk51', (0, 12.76, -27.61), 0), ('mk51', (-4.15, 12.76, -20.88), -90), ('mk51', (4.15, 12.76, -20.88), 90),
             ('mk57', (0, 17.3, -20.49), 0), ('mk57', (-2.94, 15.11, -17.27), -90), ('mk57', (2.94, 15.11, -17.27), 90), ('mk57', (-3.54, 16.07, -11.49), -90),
             ('mk57', (3.54, 16.07, -11.49), 90), ('mk57', (-4.15, 11.95, 29.02), -90), ('mk57', (4.15, 11.95, 29.02), 90), ('mk51', (-3.28, 14.02, 31.31), -90),
             ('mk51', (3.28, 14.02, 31.31), 90), ('mk57', (-3.54, 11.1, 38.12), -90), ('mk57', (3.54, 11.1, 38.12), 90), ('mk51', (0, 11.66, 43.84), 180),
             ('mk57', (-1.38, 6.65, 93.78), -90), ('mk57', (1.38, 6.65, 93.78), 90), ('mk57', (-1.77, 6.5, 110.94), 180), ('mk57', (1.77, 6.5, 110.94), 180)]
    for i, (kind, ref, bearing) in enumerate(small, 1):
        id = f'{kind}-{i}'
        x, y, z = P(*ref)
        a = -math.radians(bearing)
        fx, fy = math.cos(a), math.sin(a)
        pedestal(id, (x, y, z), None, .38, col)
        part('cyl', id, col, 'foot', (x, y, z + .06), .36, .12, 'naval', vertices=16)
        part('cyl', id, col, 'column', (x, y, z + .55), .13 if kind == 'mk51' else .2, .9, 'naval', vertices=14)
        if kind == 'mk57':
            head = part('box', id, col, 'director head', (x, y, z + 1.3), (.95, .8, .6), 'naval')
            head.rotation_euler.z = a
            part('rod', id, col, 'radar post', (x, y, z + 1.58), (x, y, z + 1.74), .05, 'naval', vertices=8)
            part('cyl', id, col, 'radar dish', (x + fx * .1, y + fy * .1, z + 1.76), .42, .08, 'edge', vertices=16)
            for s in (-1, 1):
                part('rod', id, col, 'telescope', (x + fx * .2 - fy * s * .28, y + fy * .2 + fx * s * .28, z + 1.36),
                     (x + fx * .62 - fy * s * .28, y + fy * .62 + fx * s * .28, z + 1.36), .07, 'dark', vertices=8)
        else:
            head = part('box', id, col, 'sight head', (x, y, z + 1.2), (.55, .45, .38), 'naval')
            head.rotation_euler.z = a
            for s in (-1, 1):
                part('rod', id, col, 'eyepiece', (x + fx * .1 - fy * s * .16, y + fy * .1 + fx * s * .16, z + 1.42),
                     (x + fx * .34 - fy * s * .16, y + fy * .34 + fx * s * .16, z + 1.46), .06, 'dark', vertices=8)
                part('rod', id, col, 'handgrip', (x - fx * .2 - fy * s * .2, y - fy * .2 + fx * s * .2, z + 1.08),
                     (x - fx * .36 - fy * s * .2, y - fy * .36 + fx * s * .2, z + .92), .03, 'edge', vertices=6)

    # ------------------------------------------------------------ masts and radars
    # Foremast: a pole stepped on the after end of the 22 m tower platform, braced
    # to the tower, with the SK platform and an offset topmast carrying the SG.
    name = 'foremast'
    foot = P(0, 21.99, -.34)
    head = P(0, 35.9, -.34)
    part('rod', name, col, 'pole', foot, head, .34, 'naval', r2=.24, vertices=16)
    for sx in (-1, 1):
        part('rod', name, col, 'tower strut', P(sx * 1.25, 24.1, -3.9), P(0, 31.5, -.36), .13, 'naval', vertices=10)
    part('rod', name, col, 'signal yard', P(-4.8, 33.2, -.1), P(4.8, 33.2, -.1), .09, 'naval', r2=.06, vertices=10)
    for sx in (-1, 1):
        part('rod', name, col, 'yard brace', P(0, 34.7, -.3), P(sx * 4.6, 33.2, -.1), .03, 'edge', vertices=6)
    plat_x = (P(0, 35.87, -1.13)[0] + P(0, 35.87, 2.4)[0]) / 2
    part('box', name, col, 'radar platform', (plat_x, 0, 35.87), (4.2, 3.0, .12), 'roof')
    pts = [(plat_x - 2.1, -1.5), (plat_x + 2.1, -1.5), (plat_x + 2.1, 1.5), (plat_x - 2.1, 1.5)]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        part('rod', name, col, 'platform rail', (a[0], a[1], 36.85), (b[0], b[1], 36.85), .025, 'edge', vertices=5)
    for p in pts:
        part('rod', name, col, 'rail stanchion', (p[0], p[1], 35.93), (p[0], p[1], 36.85), .025, 'edge', vertices=5)
    for sx in (-1, 1):
        part('rod', name, col, 'platform knee', P(sx * 1.2, 35.8, -.34), P(0, 34.3, -.34), .07, 'naval', vertices=8)
    part('rod', name, col, 'topmast', P(0, 35.93, 2.1), P(0, 41.84, 2.1), .13, 'naval', r2=.08, vertices=10)
    part('rod', name, col, 'topmast stay', P(0, 35.93, -.34), P(0, 39.2, 2.1), .04, 'edge', vertices=6)
    before = names()
    sx, sy, sz = P(0, 36.05, -1.13)
    part('cyl', 'radar-sk', col, 'pedestal', (sx, sy, 36.19), .32, .52, 'naval', vertices=16)
    grid('radar-sk.antenna', (sx + .12, sy, 39.1), 5.1, 5.2, col, 'x', 10, 12, assembly='radar-sk')
    for dy in (-1.6, 1.6):
        part('rod', 'radar-sk', col, 'back brace', (sx - .7, sy, 37.3), (sx + .1, sy + dy, 38.2), .05, 'naval', vertices=8)
    part('rod', 'radar-sk', col, 'mast', (sx - .7, sy, 36.4), (sx - .7, sy, 40.2), .09, 'naval', vertices=10)
    radar_pivot('radar-sk.yaw', (sx, sy, 36.45), objects_since(before))
    before = names()
    gx, gy, gz = P(0, 41.82, 2.1)
    part('cyl', 'radar-sg-forward', col, 'drive', (gx, gy, gz + .12), .16, .24, 'naval', vertices=12)
    part('box', 'radar-sg-forward', col, 'reflector', (gx + .15, gy, gz + .75), (.14, 1.28, .95), 'edge')
    part('rod', 'radar-sg-forward', col, 'feed arm', (gx + .15, gy, gz + .3), (gx + .55, gy, gz + .75), .03, 'naval', vertices=6)
    radar_pivot('radar-sg-forward.yaw', (gx, gy, gz + .12), objects_since(before))

    def R(x, y, z):
        """Runtime point (x starboard, y up, z aft) -> authoring frame."""
        return (-z, -x, y)

    def web(name, assembly, zy, thick, holes=(), knobs=(), c=None):
        """A centreline plate web in the runtime z-y plane, with lightening holes and bolted bosses."""
        n = len(zy)
        vv = [(-z, s * thick / 2, y) for s in (-1, 1) for z, y in zy]
        ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        tag(mesh(name + '.web', vv, ff, 'naval', c or col), assembly)
        for z, y, r in holes:
            tag(cyl(name + '.lightening hole', (-z, 0, y), r, thick + .04, 'dark', c or col, 8), assembly).rotation_euler.x = math.pi / 2
        for z, y in knobs:
            tag(cyl(name + '.boss', (-z, 0, y), .12, thick + .14, 'naval', c or col, 6), assembly).rotation_euler.x = math.pi / 2

    # After pole on the funnel's forward web, carrying the second SG (reference centreline cut).
    name = 'after-pole'
    web(name, name, [(13.75, 20.2), (13.3, 20.25), (10.4, 26.2), (10.4, 26.72), (11.45, 26.72), (13.75, 24.4)], .3,
        holes=[(11.47, 25.48, .13), (12.02, 24.65, .22), (12.43, 23.65, .15), (13.3, 22.86, .2), (13.37, 21.65, .17)])
    px_, _, _ = R(0, 0, 10.93)
    part('cyl', name, col, 'platform', (px_, 0, 26.8), 1.05, .16, 'roof', vertices=20)
    for i in range(10):
        a0, a1 = math.tau * i / 10, math.tau * (i + 1) / 10
        W.add('platform-rails', col, (px_ + .98 * math.cos(a0), .98 * math.sin(a0), 26.88), (px_ + .98 * math.cos(a0), .98 * math.sin(a0), 27.85), .024)
        for h in (27.35, 27.85):
            W.add('platform-rails', col, (px_ + .98 * math.cos(a0), .98 * math.sin(a0), h), (px_ + .98 * math.cos(a1), .98 * math.sin(a1), h), .018)
    part('rod', name, col, 'pole', (px_, 0, 26.88), (px_, 0, 32.62), .15, 'naval', r2=.1, vertices=10)
    part('rod', name, col, 'crosstree', (px_, -2.2, 31.4), (px_, 2.2, 31.4), .05, 'naval', vertices=6)
    for s in (-1, 1):
        part('rod', name, col, 'crosstree brace', (px_, 0, 30.6), (px_, s * 1.6, 31.36), .025, 'edge', vertices=5)
    # The SG's guard cage ("flower basket") round the masthead.
    for i in range(6):
        a = math.tau * i / 6
        part('rod', name, col, 'cage leg', (px_, 0, 31.9), (px_ + .55 * math.cos(a), .55 * math.sin(a), 32.55), .025, 'edge', vertices=5)
        b_ = math.tau * (i + 1) / 6
        part('rod', name, col, 'cage ring', (px_ + .55 * math.cos(a), .55 * math.sin(a), 32.55), (px_ + .55 * math.cos(b_), .55 * math.sin(b_), 32.55), .025, 'edge', vertices=5)
    before = names()
    gx, gy, gz = P(0, 32.6, 8.9)
    part('cyl', 'radar-sg-after', col, 'drive', (gx, gy, gz + .12), .16, .24, 'naval', vertices=12)
    part('box', 'radar-sg-after', col, 'reflector', (gx - .15, gy, gz + .75), (.14, 1.28, .95), 'edge')
    part('rod', 'radar-sg-after', col, 'feed arm', (gx - .15, gy, gz + .3), (gx - .55, gy, gz + .75), .03, 'naval', vertices=6)
    radar_pivot('radar-sg-after.yaw', (gx, gy, gz + .12), objects_since(before))
    # After arm on the funnel's after face: a pierced web leaning aft to the main-yard head, with the
    # exhaust pipe that rises from the after deckhouse up the funnel face and along the web.
    name = 'funnel-after-arm'
    web(name, name, [(21.95, 20.3), (22.35, 20.3), (24.9, 27.47), (24.16, 27.47), (21.95, 24.25)], .3,
        holes=[(24.07, 26.44, .14), (22.55, 23.3, .22), (22.3, 21.9, .17)], knobs=[(23.55, 25.38), (23.15, 24.6)])
    part('box', name, col, 'masthead', R(0, 28.03, 24.53), (.74, .7, 1.12), 'naval')
    part('rod', name, col, 'main yard', R(-6.0, 28.52, 24.53), R(6.0, 28.52, 24.53), .085, 'naval', vertices=8)
    for s in (-1, 1):
        part('rod', name, col, 'yard end', R(s * 6.0, 28.52, 24.53), R(s * 6.3, 28.52, 24.53), .05, 'naval', vertices=6)
        part('rod', name, col, 'yard lift', R(0, 28.62, 24.53), R(s * 5.6, 28.55, 24.53), .02, 'edge', vertices=5)
        part('rod', name, col, 'yard brace', R(s * .3, 27.6, 24.4), R(s * 2.6, 28.47, 24.5), .045, 'naval', vertices=6)
    pipe = [R(0, 11.6, 22.58), R(0, 19.6, 22.58), R(0, 20.35, 22.75), R(0, 26.8, 25.05)]
    for a, b_ in zip(pipe, pipe[1:]):
        part('rod', name, col, 'exhaust pipe', a, b_, .22, 'naval', vertices=10)
    for y_ in (13.2, 15.4, 17.6):
        part('rod', name, col, 'pipe clip', R(0, y_, 22.58), R(0, y_, 21.98), .04, 'edge', vertices=5)

    # ------------------------------------------------------------ funnel fittings
    fcol = collections['Superstructure']
    f = next(s for s in D['structures'] if s['id'] == 'funnel')
    top = f['baseY'] + f['height']
    ring = [(-z, -x) for x, z in f['footprint']]
    cx = sum(p[0] for p in ring) / len(ring)
    for zz, r in [(top - .08, .09), (top - 3.2, .05), (top - 9.5, .05)]:
        for a, b in zip(ring, ring[1:] + ring[:1]):
            s = 1 + r * .6
            tag(rod('funnel.band', (cx + (a[0] - cx) * s, a[1] * s, zz), (cx + (b[0] - cx) * s, b[1] * s, zz), r, 'edge', fcol, vertices=6), 'funnel')
    tag(mesh('funnel.exhaust opening', [(cx + (p[0] - cx) * .97, p[1] * .97, top - .03) for p in ring], [tuple(range(len(ring)))], 'dark', fcol), 'funnel')
    half = max(abs(p[1]) for p in ring)
    spine = (max(p[0] for p in ring) - half, min(p[0] for p in ring) + half)   # authoring x of the two end centres

    def outward(p, d):
        sx = min(max(p[0], spine[1]), spine[0])
        v = Vector((p[0] - sx, p[1], 0))
        v = v.normalized() if v.length > 1e-6 else Vector((0, 1 if p[1] >= 0 else -1, 0))
        return (p[0] + v.x * d, p[1] + v.y * d)

    # Rain lip: the casing flares 0.4 m outward over its top half metre (reference rim at 25.05 m).
    n = len(ring)
    vv = [(p[0], p[1], top - .5) for p in ring] + [(*outward(p, .4), top) for p in ring] + [(*outward(p, .4), top - .06) for p in ring]
    ff = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [(n + i, n + (i + 1) % n, 2 * n + (i + 1) % n, 2 * n + i) for i in range(n)]
    tag(mesh('funnel.rain lip', vv, ff, 'naval', fcol), 'funnel')
    for i in range(0, n, 2):
        a, b_ = outward(ring[i], .36), outward(ring[(i + 2) % n], .36)
        W.add('funnel-rails', fcol, (a[0], a[1], top), (a[0], a[1], top + 1.0), .024)
        for h in (.5, 1.0):
            W.add('funnel-rails', fcol, (a[0], a[1], top + h), (b_[0], b_[1], top + h), .018)
    # Cap housing inside the rim: a raked stadium (x +-2.2, z 14.8-21.4) whose top climbs forward
    # from 25.45 to 26.8 m, with the four boiler uptakes standing proud of it.
    cap_aft, cap_fwd, cap_half = R(0, 0, 21.4)[0], R(0, 0, 14.8)[0], 2.2
    pts = []
    for i in range(24):
        a = math.tau * i / 24
        ex = cap_fwd - cap_half if math.cos(a) > 0 else cap_aft + cap_half
        pts.append((ex + cap_half * math.cos(a), cap_half * math.sin(a)))

    def cap_top(xa):
        return 25.45 + (xa - cap_aft) / (cap_fwd - cap_aft) * 1.35

    m = len(pts)
    vv = [(x_, y_, top - .15) for x_, y_ in pts] + [(x_, y_, cap_top(x_)) for x_, y_ in pts]
    ff = [(i, (i + 1) % m, m + (i + 1) % m, m + i) for i in range(m)]
    tag(mesh('funnel.cap casing', vv, ff, 'naval', fcol), 'funnel')
    tag(mesh('funnel.cap top', vv[m:], [tuple(range(m))], 'dark', fcol), 'funnel')
    for rx, rz, r, stub in ((-1.25, 20.9, .34, .45), (1.25, 20.9, .34, .45), (-.55, 16.4, .32, .4), (.55, 16.4, .32, .4)):
        ux, uy, _ = R(rx, 0, rz)
        base = cap_top(ux)
        tag(cyl('funnel.uptake', (ux, uy, base + stub / 2 - .1), r, stub + .2, 'dark', fcol, 14), 'funnel')
    for s in (-1, 1):
        F.col = fcol
        F.ladder('funnel.ladder', (cx - 1.0, s * 2.42, f['baseY'] + .5), (cx - 1.0, s * 2.42, top - .4), .5)
    # Gallery round the funnel's forward end at 19.65 m, 1.5 m wide, on knees.
    gy, g_in, g_out = 19.65, half, half + 1.5
    fc = spine[0]      # forward end centre (authoring x)
    arc = [(fc + math.cos(a) * 1, math.sin(a) * 1) for a in [math.radians(-90 + 180 * k / 12) for k in range(13)]]
    aft_x = R(0, 0, 17.6)[0]
    inner = [(aft_x, -g_in)] + [(fc + (p[0] - fc) * g_in, p[1] * g_in) for p in arc] + [(aft_x, g_in)]
    outer = [(aft_x, -g_out)] + [(fc + (p[0] - fc) * g_out, p[1] * g_out) for p in arc] + [(aft_x, g_out)]
    k = len(inner)
    vv = [(*p, gy) for p in inner] + [(*p, gy) for p in outer] + [(*p, gy - .08) for p in inner] + [(*p, gy - .08) for p in outer]
    ff = [(i, i + 1, k + i + 1, k + i) for i in range(k - 1)] + [(2 * k + i, 3 * k + i, 3 * k + i + 1, 2 * k + i + 1) for i in range(k - 1)]
    ff += [(k + i, k + i + 1, 3 * k + i + 1, 3 * k + i) for i in range(k - 1)]
    tag(mesh('funnel.gallery deck', vv, ff, 'roof', fcol), 'funnel')
    for i in range(k):
        p = outer[i]
        W.add('funnel-rails', fcol, (p[0], p[1], gy), (p[0], p[1], gy + 1.0), .024)
        if i + 1 < k:
            q = outer[i + 1]
            for h in (.5, 1.0):
                W.add('funnel-rails', fcol, (p[0], p[1], gy + h), (q[0], q[1], gy + h), .018)
    for i in range(1, k - 1, 3):
        p, q = inner[i], outer[i]
        tag(rod('funnel.gallery knee', (p[0], p[1], gy - 1.1), ((p[0] + q[0]) / 2 + (q[0] - p[0]) * .35, (p[1] + q[1]) / 2 + (q[1] - p[1]) * .35, gy - .08), .06, 'naval', fcol, vertices=6), 'funnel')
    # Knees under the searchlight platforms, from their outer edge to the casing.
    for s in (-1, 1):
        for rz in (18.0, 20.2):
            tag(rod('funnel.platform knee', R(s * 2.32, 19.4, rz), R(s * 4.3, 20.84, rz), .07, 'naval', fcol, vertices=6), 'funnel')
    # Searchlight platforms on the funnel (36-inch lights).
    for s in (-1, 1):
        x, y, z = P(s * 3.3, 20.9, 17.1)
        tag(cyl('funnel.searchlight', (x, y, z + .75), .55, .95, 'naval', fcol, 20), 'funnel')
        tag(cyl('funnel.searchlight lens', (x + .56, y, z + .75), .46, .05, 'glass', fcol, 20), 'funnel').rotation_euler.y = math.pi / 2
        tag(cyl('funnel.searchlight trunnion', (x, y, z + .12), .3, .24, 'edge', fcol, 16), 'funnel')

    # ------------------------------------------------------------ tower searchlights and fittings
    for s in (-1, 1):
        x, y, z = P(s * 3.5, 17.4, -6.0)
        z = support.below(x, y, z + 1.2)
        tag(cyl('tower.searchlight', (x, y, z + .75), .38, .75, 'naval', col, 18), 'tower-fittings')
        tag(cyl('tower.searchlight base', (x, y, z + .19), .28, .38, 'edge', col, 14), 'tower-fittings')

    # ------------------------------------------------------------ aviation: catapults and cranes
    acol = collections['Aircraft handling']
    for s, side in ((-1, 'port'), (1, 'starboard')):
        id = 'catapult-' + side
        x, y, z = P(s * 11.77, 9.37, .33)
        part('cyl', id, acol, 'turntable', (x, y, z + .15), 1.55, .3, 'edge', vertices=36)
        part('cyl', id, acol, 'pintle', (x, y, z + .55), .75, .5, 'naval', vertices=24)
        lattice(id + '.girder', (x - 10.4, y, z + 1.25), (x + 10.4, y, z + 1.25), 1.3, 1.05, acol, 16, assembly=id)
        for dy in (-.36, .36):
            part('rod', id, acol, 'rail', (x - 10.2, y + dy, z + 1.82), (x + 10.3, y + dy, z + 1.82), .05, 'edge', vertices=6)
        part('box', id, acol, 'launching car', (x + 3.2, y, z + 1.98), (1.6, 1.3, .28), 'edge')
        part('box', id, acol, 'powder breech', (x - 1.2, y, z + .95), (2.2, .9, .8), 'naval')
        for dx in (-9.6, 9.6):
            part('rod', id, acol, 'end stop', (x + dx, y - .6, z + 1.8), (x + dx, y + .6, z + 1.8), .08, 'naval', vertices=8)
    for s, side in ((-1, 'port'), (1, 'starboard')):
        id = 'crane-' + side
        base = P(s * 4.9, 9.1, 13.9)
        top_ = P(s * 4.9, 18.4, 13.9)
        part('cyl', id, acol, 'post foot', (base[0], base[1], base[2] + .15), .8, .3, 'naval', vertices=20)
        part('rod', id, acol, 'king post', (base[0], base[1], base[2] + .3), top_, .52, 'naval', r2=.34, vertices=16)
        part('cyl', id, acol, 'post cap', (top_[0], top_[1], top_[2] + .1), .5, .2, 'edge', vertices=16)
        for dz in (2.5, 5.0, 7.5):
            F.col = acol
            F.ring(id + '.post band', (base[0], base[1], base[2] + dz), .5 - .018 * dz, .03, 'z', segments=14)
        heel = P(s * 4.6, 11.8, 15.0)
        tip = P(s * 2.55, 17.6, 32.9)
        lattice(id + '.jib', heel, tip, .9, .75, acol, 14, assembly=id)
        part('rod', id, acol, 'topping lift', (top_[0], top_[1], top_[2] + .15), tip, .025, 'edge', vertices=5)
        part('rod', id, acol, 'hoist fall', tip, (tip[0], tip[1], tip[2] - 4.2), .02, 'edge', vertices=5)
        F.col = acol
        F.ring(id + '.hook', (tip[0], tip[1], tip[2] - 4.4), .2, .045, 'y', segments=12)
        part('box', id, acol, 'winch house', (base[0] + .3, base[1] + s * -.2, base[2] + .7), (1.6, 1.2, 1.4), 'naval')
    dcol_boats = collections['Deck fittings']
    # Twin 26 ft motor whaleboats under the cranes, and the life floats forward.
    F.col = collections['Deck fittings']
    for s in (-1, 1):
        x, y, z = P(s * 4.7, 9.4, 23.8)
        before = names()
        F.boat('motor whaleboat', x, y, z, 8.0, 2.2, True)
        for o in objects_since(before):
            tag(o, 'whaleboat-' + ('port' if s < 0 else 'starboard'))
        for dx in (-2.3, 2.3):
            for dy in (-.75, .75):
                floor = support.below(x + dx, y + dy, z - .1)
                tag(rod('whaleboat.skid post', (x + dx, y + dy, floor), (x + dx, y + dy, z - .14), .09, 'naval', collections['Deck fittings'], vertices=8), 'boats')
            tag(box('whaleboat.skid beam', (x + dx, y, z - .12), (.28, 2.0, .16), 'naval', collections['Deck fittings']), 'boats')
    # Paired stacks of balsa life floats on the forward deckhouse roof.
    for s in (-1, 1):
        for zr in (-40.5, -35.7):
            x, y, z = P(s * 9.1, 8.1, zr)
            floor = support.below(x, y, z + 1)
            for k in range(2):
                zz = floor + .2 + k * .4
                n = 20
                ring = [(x + 1.45 * math.cos(math.tau * i / n) * (1 if abs(math.cos(math.tau * i / n)) < .7 else 1), y + .85 * math.sin(math.tau * i / n)) for i in range(n)]
                for a, b in zip(ring, ring[1:] + ring[:1]):
                    tag(rod('life float.tube', (a[0], a[1], zz), (b[0], b[1], zz), .19, 'canvas', dcol_boats, vertices=8), 'life-floats')
                for dx in (-.7, 0, .7):
                    tag(box('life float.grating', (x + dx, y, zz - .02), (.08, 1.4, .05), 'edge', dcol_boats), 'life-floats')
    # ------------------------------------------------------------ ground tackle and deck gear
    dcol = collections['Deck fittings']
    for s in (-1, 1):
        x, y, z = P(s * 2.5, 7.1, -114.8)
        top_deck = deckz(x)
        tag(cyl('ground tackle.windlass', (x - 6.5, y, top_deck + .45), .55, .9, 'edge', dcol, 24), 'ground-tackle')
        tag(cyl('ground tackle.windlass cap', (x - 6.5, y, top_deck + .95), .7, .12, 'naval', dcol, 24), 'ground-tackle')
        a, c = Vector((x - 6.0, y, deckz(x - 6.0) + .12)), Vector((x + 1.5, y * 1.05, deckz(x + 1.5) + .12))
        n = int((c - a).length / .3)
        for i in range(n):
            q = a.lerp(c, (i + .5) / n)
            link = tag(box('ground tackle.chain link', q, (.36, .09 if i % 2 else .22, .22 if i % 2 else .09), 'edge', dcol), 'ground-tackle')
            link.rotation_euler.z = math.atan2((c - a).y, (c - a).x)
        # Stockless anchor seated in its hawse at the bow flare.
        ax, ay, az = P(s * 3.1, 6.0, -115.6)
        edge = support.along((ax, -s * .1, az), (0, -s, 0), 20)
        tag(rod('anchor.shank', (edge.x, edge.y - s * .12, edge.z + 1.1), (edge.x, edge.y - s * .12, edge.z - 1.2), .14, 'dark', dcol, vertices=10), 'anchors')
        tag(rod('anchor.crown', (edge.x - .7, edge.y - s * .15, edge.z - 1.3), (edge.x + .7, edge.y - s * .15, edge.z - 1.3), .24, 'dark', dcol, vertices=12), 'anchors')
        for d in (-1, 1):
            tag(rod('anchor.fluke', (edge.x + d * .7, edge.y - s * .15, edge.z - 1.3), (edge.x + d * .95, edge.y - s * .2, edge.z - .35), .16, 'dark', dcol, r2=.07, vertices=8), 'anchors')
        tag(cyl('anchor.hawse lip', (edge.x, edge.y - s * .04, edge.z + 1.25), .42, .1, 'edge', dcol, 20), 'anchors').rotation_euler.x = math.pi / 2
    for zr in (-104, -96, -84, -64, 66, 82, 100, 112):
        for s in (-1, 1):
            x = P(0, 0, zr)[0]
            y = s * (width(x) - 1.3)
            z = deckz(x)
            tag(box('bollards.bed', (x, y, z + .06), (1.3, .6, .12), 'roof', dcol), 'mooring')
            for dx in (-.35, .35):
                tag(cyl('bollards.post', (x + dx, y, z + .4), .17, .7, 'edge', dcol, 16), 'mooring')
                tag(cyl('bollards.cap', (x + dx, y, z + .78), .22, .07, 'edge', dcol, 16), 'mooring')
    def reel(x, y, floor, radius=.45, length=1.1):
        """Hose reel: two cheeks, a wound drum and two feet (a light stand-in for the shared reel,
        whose modelled rope windings cost 2,000 triangles each)."""
        axle = floor + radius + .18
        for s in (-1, 1):
            tag(box('reel.foot', (x, y + s * length / 2, floor + .35), (.16, .14, .7), 'naval', dcol), 'reels')
            tag(rod('reel.cheek', (x, y + s * (length / 2 - .05), axle), (x, y + s * (length / 2 + .05), axle), radius, 'naval', dcol, vertices=16), 'reels')
        tag(rod('reel.hose', (x, y - length / 2, axle), (x, y + length / 2, axle), radius * .8, 'canvas', dcol, vertices=16), 'reels')
        tag(rod('reel.crank', (x, y + length / 2 + .05, axle), (x, y + length / 2 + .25, axle), .04, 'edge', dcol, vertices=6), 'reels')

    for (rx, ry, rzz) in [(-.4, 6.9, -80.3), (3.3, 6.9, -80.3), (-3.3, 6.9, -80.3), (1.6, 6.9, -80.3), (-10.3, 5.3, 5.4), (10.3, 5.3, 5.4), (3.9, 5.3, 76.1), (0, 5.4, 76.9), (-3.9, 5.3, 76.1)]:
        x, y, z = P(rx, ry, rzz)
        floor = support.below(x, y, z + 1)
        reel(x, y, floor)
    for s in (-1, 1):
        x, y, z = P(s * 6.8, 6.5, -78.7)
        floor = support.below(x, y, z + 1)
        tag(rod('paravane.body', (x - 1.5, y, floor + .45), (x + 1.2, y, floor + .45), .28, 'naval', dcol, r2=.12, vertices=12), 'paravanes')
        tag(box('paravane.plane', (x - .2, y, floor + .45), (.9, 1.6, .05), 'naval', dcol), 'paravanes')
        tag(box('paravane.chock', (x, y, floor + .1), (1.2, .5, .2), 'roof', dcol), 'paravanes')
    for (rx, ry, rzz, ln) in [(3.9, 5.9, -70.0, 2.2), (-3.9, 5.9, -70.0, 2.2), (9.9, 4.9, 92.0, 2.2), (-9.9, 4.9, 92.0, 2.2), (8.6, 5.1, 101.0, 2.2), (-8.6, 5.1, 101.0, 2.2),
                              (11.3, 4.8, 72.6, 3.1), (-11.3, 4.8, 72.6, 3.1), (9.8, 4.8, 72.5, 3.1), (-9.8, 4.8, 72.5, 3.1)]:
        x, y, z = P(rx, ry, rzz)
        floor = support.below(x, y, z + 1)
        tag(box('floater net basket', (x, y, floor + .32), (ln if abs(rx) > 5 else .8, .8 if abs(rx) > 5 else ln, .64), 'canvas', dcol), 'life-saving')
    # ------------------------------------------------------------ bridge bulwarks, roof posts, platform rails
    scol = collections['Superstructure']
    structures = D['structures']

    def outline(st):
        return [(-z, -x) for x, z in st['footprint']]

    def inside(pt, poly):
        x, y = pt
        c = False
        for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                c = not c
        return c

    def wall(name, a, b, z, height, assembly, thick=.06):
        a, b = Vector((a[0], a[1], z)), Vector((b[0], b[1], z))
        d = b - a
        if d.length < .05:
            return
        o = box(name, ((a + b) / 2) + Vector((0, 0, height / 2)), (d.length, thick, height), 'naval', scol)
        o.rotation_euler.z = math.atan2(d.y, d.x)
        tag(o, assembly)
        tag(rod(name + ' capping', (a.x, a.y, z + height), (b.x, b.y, z + height), .05, 'naval', scol, vertices=6), assembly)

    def taller_beside(pt, level):
        return any(t['baseY'] <= level + .3 and t['baseY'] + t['height'] > level + .5 and inside(pt, outline(t)) for t in structures)

    def edge_runs(st, level):
        poly = outline(st)
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        for a, b in zip(poly, poly[1:] + poly[:1]):
            m = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0))
            out = (m - Vector((cx, cy, 0)))
            out = out.normalized() * .35 if out.length else out
            if taller_beside((m.x + out.x, m.y + out.y), level) or taller_beside((m.x - out.x, m.y - out.y), level):
                continue
            yield a, b

    for st in structures:
        top = st['baseY'] + st['height']
        platform = st['height'] < .3
        if st['id'] == 'funnel' or not (platform or top > 9):
            continue
        bridge = abs(top - 21.99) < .1 or abs(top - 28.845) < .1
        for a, b in edge_runs(st, top):
            # Solid bulwarks and a hanging fascia around the bridge and director decks;
            # the director deck's walkway aft to the foremast keeps open rails.
            if bridge and min(a[0], b[0]) > P(0, 0, -3.9)[0]:
                wall(st['id'] + '.bulwark', a, b, top, 1.15, st['id'])
                wall(st['id'] + '.fascia', a, b, st['baseY'] - .75, .75, st['id'], .05)
                continue
            n = max(1, math.ceil(math.dist(a, b) / 1.8))
            for i in range(n + 1):
                p = (a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
                W.add('platform-rails', scol, (p[0], p[1], top), (p[0], p[1], top + 1.0), .024)
            for h in (.5, 1.0):
                W.add('platform-rails', scol, (a[0], a[1], top + h), (b[0], b[1], top + h), .018)
    # ------------------------------------------------------------ deckhouse walls: doors, scuttles, vents
    for st in structures:
        if st['height'] < 1.8 or st['id'] == 'funnel':
            continue
        base, top = st['baseY'], st['baseY'] + st['height']
        poly = outline(st)
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        k = 0
        for a, b in zip(poly, poly[1:] + poly[:1]):
            av, bv = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
            d = bv - av
            length = d.length
            if length < 3:
                continue
            d.normalize()
            n = Vector((d.y, -d.x, 0))
            m = (av + bv) / 2
            if n.dot(m - Vector((cx, cy, 0))) < 0:
                n = -n
            probe = m + n * .6
            if any(t is not st and t['baseY'] <= base + .3 and t['baseY'] + t['height'] > base + 1.2 and inside((probe.x, probe.y), outline(t)) for t in structures):
                continue
            ang = math.atan2(d.y, d.x)
            count = int(length // 2.4)
            for i in range(count):
                q = av + d * (length * (i + .5) / count) + n * .015
                k += 1
                if k % 7 == 3 and st['height'] >= 2.1:
                    door = tag(box(st['id'] + '.door', (q.x + n.x * .03, q.y + n.y * .03, base + .95), (.78, .06, 1.72), 'naval', scol), st['id'])
                    door.rotation_euler.z = ang
                    frame = tag(box(st['id'] + '.door frame', (q.x, q.y, base + .95), (.92, .04, 1.86), 'edge', scol), st['id'])
                    frame.rotation_euler.z = ang
                    for dz in (.45, 1.45):
                        dog = tag(box(st['id'] + '.door dog', (q.x + n.x * .07 + d.x * .3, q.y + n.y * .07 + d.y * .3, base + dz), (.12, .05, .05), 'edge', scol), st['id'])
                        dog.rotation_euler.z = ang
                elif k % 7 == 5 and st['height'] >= 2.1:
                    vent = tag(box(st['id'] + '.vent', (q.x + n.x * .02, q.y + n.y * .02, top - .9), (.9, .05, .6), 'dark', scol), st['id'])
                    vent.rotation_euler.z = ang
                    for dz in (-.2, 0, .2):
                        slat = tag(box(st['id'] + '.vent slat', (q.x + n.x * .06, q.y + n.y * .06, top - .9 + dz), (.9, .06, .05), 'naval', scol), st['id'])
                        slat.rotation_euler.z = ang
                else:
                    sc = tag(cyl(st['id'] + '.scuttle', (q.x, q.y, top - .75 if st['height'] < 3 else base + 1.6), .17, .04, 'glass', scol, 10), st['id'])
                    sc.rotation_euler = (math.pi / 2, 0, ang)
                    rim = tag(cyl(st['id'] + '.scuttle rim', (q.x - n.x * .004, q.y - n.y * .004, top - .75 if st['height'] < 3 else base + 1.6), .21, .03, 'edge', scol, 10), st['id'])
                    rim.rotation_euler = (math.pi / 2, 0, ang)

    # The bridge roof overhangs its tower column: posts carry its free corners.
    roof = min((t for t in structures if abs(t['baseY'] - 24.069) < .05), key=lambda t: -len(t['footprint']), default=None)
    if roof:
        poly = outline(roof)
        for p in poly:
            if taller_beside(p, 22.5):
                continue
            q = Vector((p[0], p[1], 0))
            c = Vector((sum(v[0] for v in poly) / len(poly), sum(v[1] for v in poly) / len(poly), 0))
            q = q + (c - q).normalized() * .15
            floor = support.below(q.x, q.y, 24.0)
            tag(rod('bridge-roof.post', (q.x, q.y, floor), (q.x, q.y, 24.07), .07, 'naval', scol, vertices=8), 'bridge-roof')

    # ------------------------------------------------------------ rails along the deck edge
    points = [(s['station'] - H['length'] / 2, s['points'][-1][0], s['points'][-1][1]) for s in H['sections']]
    for sign in (-1, 1):
        edge = []
        for a, b in zip(points, points[1:]):
            n = max(1, math.ceil((b[0] - a[0]) / 2.4))
            for i in range(n):
                t = i / n
                x = a[0] + (b[0] - a[0]) * t
                y = sign * max(0, a[1] + (b[1] - a[1]) * t - .12)
                z = a[2] + (b[2] - a[2]) * t
                if x > 121 or x < -122:
                    continue
                edge.append((x, y, z))
                W.add('deck-rails', dcol, (x, y, z), (x, y, z + 1.0), .026)
        for a, b in zip(edge, edge[1:]):
            if abs(b[0] - a[0]) > 3.2:
                continue
            for h in (.36, .68, 1.0):
                W.add('deck-rails', dcol, (a[0], a[1], a[2] + h), (b[0], b[1], b[2] + h), .016)
    W.build()

    # ------------------------------------------------------------ underwater: shafts, screws, skeg, rudder
    ucol = collections['Underwater fittings']
    for i, ((rx, ry, rzz), hand) in enumerate([((-8.6, -6.5, 84.7), 1), ((-4.7, -6.7, 98.2), 1), ((4.7, -6.7, 98.2), -1), ((8.6, -6.5, 84.7), -1)], 1):
        id = f'shaft-{i}'
        x, y, z = P(rx, ry, rzz)
        inboard = (x + 26, y * .7, z + 1.6)
        tag(rod(id + '.line', inboard, (x + .9, y, z), .2, 'edge', ucol, vertices=14), id)
        for d in (1.6, 9.0):
            p = Vector(inboard).lerp(Vector((x, y, z)), 1 - d / 26)
            shell = support.along((p.x, p.y, p.z), (0, 0, 1), 12)
            tag(rod(id + '.strut', p, (p.x, p.y * .85, shell.z + .15), .13, 'antifouling', ucol, vertices=10), id)
        tag(rod(id + '.hub', (x - .6, y, z), (x + .9, y, z), .42, 'bronze', ucol, r2=.3, vertices=20), id)
        for blade in range(4):
            a = math.tau * blade / 4 + (.4 if hand > 0 else -.4)
            shape = [(.25, -.2), (.95, -.5), (1.65, -.38), (1.85, .1), (1.5, .55), (.7, .45)]
            vv = [(x + .25 * hand * tn, y + r * math.cos(a) - tn * math.sin(a), z + r * math.sin(a) + tn * math.cos(a)) for r, tn in shape]
            tag(mesh(id + '.blade', vv, [tuple(range(len(vv)))], 'bronze', ucol), id)
    # Centreline skeg and the single balanced rudder, from the reference profile.
    skeg = [P(0, -5.3, 78), P(0, -9.8, 84), P(0, -9.8, 95.5), P(0, -5.0, 99.5)]
    vv = [(p[0], s, p[2]) for s in (-.5, .5) for p in skeg]
    tag(mesh('skeg.plate', vv, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'antifouling', ucol), 'skeg')
    rudder = [P(0, -3.4, 103.2), P(0, -9.5, 103.6), P(0, -9.5, 111.3), P(0, -3.1, 111.9)]
    vv = [(p[0], s, p[2]) for s in (-.32, .32) for p in rudder]
    tag(mesh('rudder.blade', vv, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'antifouling', ucol), 'rudder')
    rx, _, _ = P(0, 0, 105.5)
    tag(rod('rudder.stock', (rx, 0, -3.6), (rx, 0, -1.9), .3, 'edge', ucol, vertices=16), 'rudder')

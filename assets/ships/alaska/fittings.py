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


def R(x, y, z):
    """Runtime point (x starboard, y up, z aft) -> authoring frame."""
    return (-z, -x, y)


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
        if m['battery'] != 'main' and 'us-5in38' not in m['partId'] and not m['partId'].startswith('us-40'):
            continue
        mx, my, mz = -m['position'][2], -m['position'][0], m['position'][1]
        house = max((v[0] ** 2 + v[1] ** 2) ** .5 for v in w['gunhouseMesh']['vertices']) + .2 if w.get('gunhouseMesh') else max(w['gunhouseSize'][:2]) * .6
        arcs.append((mx, my, mz, house, w))

    # Light AA tubs are their own bulwarks: rails stop at the tub rather than run through the gun's swing.
    tubs = []
    for m in D['mounts']:
        if m['partId'].startswith(('us-40', 'us-20')):
            tubs.append((-m['position'][2], -m['position'][0], m['position'][1], 2.85 if m['partId'].startswith('us-40') else 1.8))

    def in_arc(a, b):
        for p in (a, b, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)):
            for tx, ty, tz, tr in tubs:
                if math.hypot(p[0] - tx, p[1] - ty) < tr and max(a[2], b[2]) > tz - 1.0 and min(a[2], b[2]) < tz + 1.3:
                    return True
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

    def prism(name, assembly, outline, z0, z1, material='naval', top_outline=None, c=None):
        """A closed prism (optionally tapering to top_outline) from authoring (x, y) outlines."""
        top_outline = top_outline or outline
        n = len(outline)
        vv = [(a, b, z0) for a, b in outline] + [(a, b, z1) for a, b in top_outline]
        ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        return tag(mesh(name, vv, ff, material, c or col), assembly)

    def mk38(id, ref, aft):
        """Mk 38 main-battery director (reference: a low hexagonal house 0.8 m tall with a nose that
        leans back, 8.7 m rangefinder arms as deep boxes, two trestles and the Mk 8 antenna aft)."""
        before = names()
        x, y, z = P(*ref)
        s = -1 if aft else 1

        def L(a, b):     # local forward / starboard offsets -> authoring x, y
            return (x + s * a, y - s * b)

        pedestal(id, (x, y, z), None, 1.25, col)
        moving = [part('cyl', id, col, 'training base', (x, y, z + .03), 1.35, .06, 'edge', vertices=32)]
        low = [(-1.49, -.4), (-.92, -1.73), (.6, -1.73), (1.5, 0), (.6, 1.73), (-.92, 1.73), (-1.49, .4)]
        high = [(a if a < .6 else .6 + (a - .6) * .6, b) for a, b in low]
        high[3] = (1.15, 0)
        moving.append(prism(id + '.house', id, [L(a, b) for a, b in low], z + .06, z + .88, top_outline=[L(a, b) for a, b in high]))
        moving.append(prism(id + '.roof', id, [L(a * .97, b * .97) for a, b in high], z + .88, z + .92, 'roof'))
        for side in (-1, 1):
            arm = [L(.32, side * 1.7), L(.32, side * 4.35), L(-.32, side * 4.35), L(-.32, side * 1.7)]
            moving.append(prism(id + '.rangefinder arm', id, arm, z + .06, z + .86))
            moving.append(part('box', id, col, 'rangefinder window', (*L(.335, side * 4.05), z + .52), (.03, .34, .22), 'glass'))
            # Trestle carrying the Mk 8 antenna.
            for da in (-.28, .28):
                moving.append(part('rod', id, col, 'trestle leg', (*L(da, side * 1.95), z + .84), (*L(0, side * 1.95), z + 2.25), .06, 'naval', vertices=6))
            moving.append(part('box', id, col, 'trestle head', (*L(0, side * 1.95), z + 2.3), (.34, .3, .26), 'naval'))
        for b in (-.55, 0, .55):
            nose = 1.5 - .35 * .6
            face = .6 + (nose - .6) * (1 - abs(b) / 1.73)
            port = part('box', id, col, 'sight port', (*L(face, b), z + .55), (.08, .34, .22), 'glass')
            if b:
                dx, dy = (s * (nose - .6), s * 1.73) if b > 0 else (s * (.6 - nose), s * 1.73)
                port.rotation_euler.z = math.atan2(dy, dx) - math.pi / 2
            moving.append(port)
        # Mk 8 array spanning the trestle heads, and the guard rail round the roof and arms.
        bar = part('box', id, col, 'mk8 array', (*L(0, 0), z + 2.3), (.3, 3.6, .28), 'edge')
        moving.append(bar)
        rail = [L(-.3, -4.3), L(.3, -4.3), L(.3, -1.73), L(1.05, 0), L(.3, 1.73), L(.3, 4.3), L(-.3, 4.3), L(-.3, 1.73), L(-.92, 1.7), L(-1.45, .4), L(-1.45, -.4), L(-.92, -1.7), L(-.3, -1.73)]
        for a_, b_ in zip(rail, rail[1:] + rail[:1]):
            moving.append(part('rod', id, col, 'guard rail', (a_[0], a_[1], z + 1.9), (b_[0], b_[1], z + 1.9), .025, 'edge', vertices=5))
        for a_ in rail:
            moving.append(part('rod', id, col, 'rail stanchion', (a_[0], a_[1], z + .86), (a_[0], a_[1], z + 1.9), .025, 'edge', vertices=5))
        radar_pivot(id + '.yaw', (x, y, z + .03), [o for o in objects_since(before) if o in moving])

    def mk37(id, ref, aft):
        """Mk 37 secondary director (reference: a 2 m house with a vertical front that rakes back over
        its top metre, sides tapering inward, the rangefinder aft of centre with bulbous end hoods, an
        access trunk on the back and three antenna shields on the roof's after edge)."""
        before = names()
        x, y, z = P(*ref)
        s = -1 if aft else 1

        def L(a, b):
            return (x + s * a, y - s * b)

        pedestal(id, (x, y, z), None, 1.55, col)
        moving = [part('cyl', id, col, 'training base', (x, y, z + .075), 1.6, .15, 'edge', vertices=32)]
        base = [(-1.45, -1.62), (1.45, -1.62), (1.45, 1.62), (-1.45, 1.62)]
        mid = [(-1.45, -1.54), (1.45, -1.54), (1.45, 1.54), (-1.45, 1.54)]
        top = [(-1.45, -1.3), (.35, -1.3), (.35, 1.3), (-1.45, 1.3)]
        moving.append(prism(id + '.house', id, [L(*p) for p in base], z + .15, z + 1.2, top_outline=[L(*p) for p in mid]))
        moving.append(prism(id + '.house top', id, [L(*p) for p in mid], z + 1.2, z + 2.2, top_outline=[L(*p) for p in top]))
        moving.append(prism(id + '.roof', id, [L(a * .98, b * .98) for a, b in top], z + 2.2, z + 2.24, 'roof'))
        moving.append(part('rod', id, col, 'rangefinder', (*L(-.45, -2.37), z + 1.5), (*L(-.45, 2.37), z + 1.5), .19, 'naval', vertices=14))
        for side in (-1, 1):
            moving.append(part('rod', id, col, 'rangefinder hood', (*L(-.45, side * 1.62), z + 1.5), (*L(-.45, side * 2.15), z + 1.5), .5, 'naval', r2=.42, vertices=14))
            moving.append(part('box', id, col, 'rangefinder window', (*L(-.45, side * 2.38), z + 1.5), (.2, .03, .2), 'glass'))
        moving.append(prism(id + '.access trunk', id, [L(-1.45, -.9), L(-1.45, .9), L(-1.95, .9), L(-1.95, -.9)], z + .7, z + 1.9))
        for b in (-.6, 0, .6):
            moving.append(part('box', id, col, 'sight port', (*L(1.465, b), z + 1.02), (.04, .34, .24), 'glass'))
            fin = part('box', id, col, 'antenna shield', (*L(.62, b), z + 2.0), (.12, .36, .95), 'naval')
            fin.rotation_euler = (0, -s * math.radians(35), 0)
            moving.append(fin)
        for a, b, h in ((-.6, -1.0, .9), (-.9, 1.0, .7)):
            moving.append(part('rod', id, col, 'whip', (*L(a, b), z + 2.24), (*L(a + .35, b - .2), z + 2.24 + h), .02, 'edge', vertices=5))
        radar_pivot(id + '.yaw', (x, y, z + .075), [o for o in objects_since(before) if o in moving])

    mk38('mk38-forward', (0, 32.24, -7.707), False)
    mk38('mk38-after', (0, 20.393, 33.164), True)
    mk37('mk37-forward', (0, 17.805, -17.016), False)
    mk37('mk37-after', (0, 14.109, 41.217), True)

    small = [('mk57', (0, 11.19, -111.26), 0), ('mk51', (0, 12.76, -27.61), 0), ('mk51', (-4.15, 12.76, -20.88), -90), ('mk51', (4.15, 12.76, -20.88), 90),
             ('mk57', (0, 17.3, -20.49), 0), ('mk57', (-2.94, 15.11, -17.27), -90), ('mk57', (2.94, 15.11, -17.27), 90), ('mk57', (-3.54, 16.07, -11.49), -90),
             ('mk57', (3.54, 16.07, -11.49), 90), ('mk57', (-4.15, 11.95, 29.02), -90), ('mk57', (4.15, 11.95, 29.02), 90), ('mk51', (-3.28, 14.02, 31.31), -90),
             ('mk51', (3.28, 14.02, 31.31), 90), ('mk57', (-3.54, 11.1, 38.12), -90), ('mk57', (3.54, 11.1, 38.12), 90), ('mk51', (0, 11.66, 43.84), 180),
             ('mk57', (-1.38, 6.65, 93.78), -90), ('mk57', (1.38, 6.65, 93.78), 90), ('mk57', (-1.77, 6.5, 110.94), 180), ('mk57', (1.77, 6.5, 110.94), 180)]
    # The forward Mk 57 stands in a drum (2.1 m, 10.5-12.0 m) on the after end of its deckhouse, the
    # overhang carried by a sloping gusset (reference side view).
    dx_, dy_, _ = R(0, 0, -109.25)
    part('cyl', 'mk57-1', col, 'drum', (dx_, dy_, 11.285), 1.05, 1.51, 'naval', vertices=20)
    part('cyl', 'mk57-1', col, 'drum deck', (dx_, dy_, 12.02), 1.0, .04, 'roof', vertices=20)
    gy = support.below(*R(0, 0, -109.9)[:2], 10.4)
    prism('mk57-1.trunk', 'mk57-1', [R(-.73, 0, -109.6)[:2], R(.73, 0, -109.6)[:2], R(.73, 0, -110.25)[:2], R(-.73, 0, -110.25)[:2]], gy - .05, 10.6)
    gus = [R(.73, 10.55, -108.35), R(.73, 10.55, -109.62), R(.73, 9.45, -109.62)]
    vv = [(p_[0], p_[1] + d_, p_[2]) for d_ in (0, 1.46) for p_ in gus]
    tag(mesh('mk57-1.gusset', vv, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], 'naval', col), 'mk57-1')
    for i, (kind, ref, bearing) in enumerate(small, 1):
        id = f'{kind}-{i}'
        x, y, z = P(*ref)
        a = -math.radians(bearing)
        fx, fy = math.cos(a), math.sin(a)
        if id != 'mk57-1':          # the forward Mk 57's drum is its foundation
            pedestal(id, (x, y, z), None, .38, col)
        part('cyl', id, col, 'foot', (x, y, z + .06), .36, .12, 'naval', vertices=16)
        part('cyl', id, col, 'column', (x, y, z + .6 if kind == 'mk57' else z + .55), .13 if kind == 'mk51' else .24, 1.0 if kind == 'mk57' else .9, 'naval', vertices=14)
        if kind == 'mk57':
            head = part('box', id, col, 'director head', (x, y, z + 1.42), (.8, .7, .62), 'naval')
            head.rotation_euler.z = a
            top_box = part('box', id, col, 'sight box', (x - fx * .08, y - fy * .08, z + 1.86), (.5, .42, .26), 'naval')
            top_box.rotation_euler.z = a
            # Radar dish on the director's face, facing its bearing (reference front view: about 0.75 m).
            part('rod', id, col, 'radar dish', (x + fx * .58, y + fy * .58, z + 1.45), (x + fx * .4, y + fy * .4, z + 1.45), .38, 'edge', r2=.12, vertices=14)
            part('rod', id, col, 'dish feed', (x + fx * .58, y + fy * .58, z + 1.45), (x + fx * .78, y + fy * .78, z + 1.45), .03, 'dark', vertices=5)
            for s in (-1, 1):
                part('rod', id, col, 'telescope', (x + fx * .1 - fy * s * .48, y + fy * .1 + fx * s * .48, z + 1.55),
                     (x + fx * .5 - fy * s * .48, y + fy * .5 + fx * s * .48, z + 1.55), .07, 'dark', vertices=8)
                part('rod', id, col, 'trunnion arm', (x - fy * s * .35, y + fx * s * .35, z + 1.42), (x - fy * s * .48, y + fx * s * .48, z + 1.55), .05, 'naval', vertices=6)
        else:
            head = part('box', id, col, 'sight head', (x, y, z + 1.2), (.55, .45, .38), 'naval')
            head.rotation_euler.z = a
            for s in (-1, 1):
                part('rod', id, col, 'eyepiece', (x + fx * .1 - fy * s * .16, y + fy * .1 + fx * s * .16, z + 1.42),
                     (x + fx * .34 - fy * s * .16, y + fy * .34 + fx * s * .16, z + 1.46), .06, 'dark', vertices=8)
                part('rod', id, col, 'handgrip', (x - fx * .2 - fy * s * .2, y - fy * .2 + fx * s * .2, z + 1.08),
                     (x - fx * .36 - fy * s * .2, y - fy * .36 + fx * s * .2, z + .92), .03, 'edge', vertices=6)

    # ------------------------------------------------------------ masts and radars
    # Foremast (reference cuts): a pole stepped on the 22 m deck abaft the tower at z 1.66, braced to
    # the 24 m roof by two struts, a teardrop SK platform at 36 m with a short yard, a small fan platform
    # at 34 m, and a topmast at z 4.1 carrying the SG in a guard cage. The long signal yard projects from
    # the director deck at z -5.8.
    name = 'foremast'
    mz = 1.655
    # The pole is stepped on the 24 m walkway tail, which a trunk carries from the 22 m deck.
    part('rod', name, col, 'pole', R(0, 24.1, mz), R(0, 35.9, mz), .33, 'naval', r2=.24, vertices=16)
    part('box', name, col, 'tail trunk', R(0, 23.03, .35), (.7, .6, 2.1), 'naval')
    for sx in (-1, 1):
        part('rod', name, col, 'tower strut', R(sx * 1.0, 24.15, -1.65), R(sx * .2, 32.9, 1.42), .13, 'naval', vertices=10)
    # SK platform: round forward end (r 1.25 about z 0.75) tapering aft to the topmast.
    outline = [R(1.25 * math.sin(math.radians(a)), 0, .75 - 1.25 * math.cos(math.radians(a))) for a in range(-110, 111, 20)]
    outline = [(p_[0], p_[1]) for p_ in outline] + [R(0, 0, 5.3)[:2]]
    prism(name + '.sk platform', name, outline, 35.86, 35.96, 'roof')
    for a, b_ in zip(outline, outline[1:] + outline[:1]):
        W.add('mast-rails', col, (a[0], a[1], 35.96), (a[0], a[1], 36.9), .024)
        for h in (36.43, 36.9):
            W.add('mast-rails', col, (a[0], a[1], h), (b_[0], b_[1], h), .018)
    for sx in (-1, 1):
        part('rod', name, col, 'platform knee', R(sx * .25, 34.4, mz), R(sx * 1.1, 35.85, .6), .06, 'naval', vertices=6)
        part('rod', name, col, 'platform knee', R(sx * .2, 34.6, mz + .2), R(sx * .5, 35.85, 3.6), .05, 'naval', vertices=6)
    part('rod', name, col, 'sk yard', R(-3.2, 36.1, .1), R(3.2, 36.1, .1), .05, 'naval', vertices=6)
    for sx in (-1, 1):
        part('rod', name, col, 'yard antenna', R(sx * 3.1, 35.6, .1), R(sx * 3.1, 36.6, .1), .03, 'edge', vertices=5)
        part('rod', name, col, 'yard brace', R(sx * .2, 35.5, .6), R(sx * 2.2, 36.08, .1), .025, 'edge', vertices=5)
    # Fan platform at 34 m abaft the pole.
    fan = [R(-.9, 0, 3.17), R(-.95, 0, 1.4), R(-.3, 0, 1.0), R(.3, 0, 1.0), R(.95, 0, 1.4), R(.9, 0, 3.17)]
    prism(name + '.fan platform', name, [p_[:2] for p_ in fan], 33.94, 34.02, 'roof')
    for a, b_ in zip(fan, fan[1:]):
        W.add('mast-rails', col, (a[0], a[1], 34.02), (a[0], a[1], 34.9), .022)
        W.add('mast-rails', col, (a[0], a[1], 34.9), (b_[0], b_[1], 34.9), .018)
    part('rod', name, col, 'fan knee', R(0, 33.2, mz + .25), R(0, 33.94, 2.9), .05, 'naval', vertices=6)
    # Topmast through the platform's after point, with the SG's guard cage.
    part('rod', name, col, 'topmast', R(0, 34.6, 4.1), R(0, 41.84, 4.1), .13, 'naval', r2=.08, vertices=10)
    part('rod', name, col, 'topmast heel', R(0, 34.6, 4.1), R(0, 34.2, mz + .25), .08, 'naval', vertices=6)
    for i in range(6):
        a0, a1 = math.tau * i / 6, math.tau * (i + 1) / 6
        c0, c1 = R(.55 * math.cos(a0), 41.55, 4.1 + .55 * math.sin(a0)), R(.55 * math.cos(a1), 41.55, 4.1 + .55 * math.sin(a1))
        part('rod', name, col, 'cage leg', R(0, 40.8, 4.1), c0, .025, 'edge', vertices=5)
        part('rod', name, col, 'cage ring', c0, c1, .025, 'edge', vertices=5)
    # Signal yard off the director deck (reference HP_flag points at +-8.9 and +-6.8).
    part('rod', name, col, 'signal yard', R(-9.1, 28.55, -5.77), R(9.1, 28.55, -5.77), .09, 'naval', r2=.07, vertices=8)
    for sx in (-1, 1):
        part('rod', name, col, 'signal yard brace', R(sx * 1.84, 26.6, -5.77), R(sx * 4.6, 28.5, -5.77), .06, 'naval', vertices=6)
        for hx in (6.8, 8.9):
            part('rod', name, col, 'halyard block', R(sx * hx, 28.52, -5.77), R(sx * hx, 28.3, -5.77), .04, 'edge', vertices=5)
    before = names()
    sx, sy, sz = P(0, 36.05, -1.13)
    part('box', 'radar-sk', col, 'pedestal', (sx - .1, sy, 36.66), (.92, .9, 1.3), 'naval')
    part('box', 'radar-sk', col, 'pedestal cap', (sx - .1, sy, 37.36), (1.05, 1.0, .12), 'edge')
    # The SK's mesh screen reads nearly solid: a thin backing plate inside the frame grid.
    outline_sk = [(-2.5, 36.93), (2.5, 36.93), (2.5, 41.0), (1.8, 41.73), (-1.8, 41.73), (-2.5, 41.0)]
    k_ = len(outline_sk)
    vv = [(sx + .84 + dx, sy + b_, h_) for dx in (-.015, .015) for b_, h_ in outline_sk]
    ff = [tuple(range(k_)), tuple(reversed(range(k_, 2 * k_)))] + [(i, (i + 1) % k_, k_ + (i + 1) % k_, k_ + i) for i in range(k_)]
    tag(mesh('radar-sk.screen', vv, ff, 'edge', col), 'radar-sk')
    grid('radar-sk.antenna', (sx + .87, sy, 39.1), 5.0, 4.3, col, 'x', 5, 8, assembly='radar-sk')
    for dy in (-1.6, 1.6):
        part('rod', 'radar-sk', col, 'back brace', (sx - .1, sy, 37.4), (sx + .82, sy + dy, 38.4), .05, 'naval', vertices=8)
        part('rod', 'radar-sk', col, 'back brace', (sx - .1, sy, 37.4), (sx + .82, sy + dy, 40.2), .04, 'naval', vertices=6)
    radar_pivot('radar-sk.yaw', (sx, sy, 36.45), objects_since(before))
    before = names()
    gx, gy, gz = P(0, 41.82, 2.1)
    part('cyl', 'radar-sg-forward', col, 'drive', (gx, gy, gz + .2), .16, .4, 'naval', vertices=12)
    part('box', 'radar-sg-forward', col, 'reflector', (gx + .15, gy, gz + .88), (.14, 1.05, .9), 'edge')
    part('rod', 'radar-sg-forward', col, 'feed arm', (gx + .15, gy, gz + .4), (gx + .55, gy, gz + .88), .03, 'naval', vertices=6)
    radar_pivot('radar-sg-forward.yaw', (gx, gy, gz + .12), objects_since(before))

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
    web(name, name, [(13.75, 20.2), (13.45, 20.3), (10.3, 26.1), (10.05, 26.45), (10.05, 26.72), (11.2, 26.72), (13.4, 24.6), (13.75, 24.45)], .3,
        holes=[(11.25, 25.48, .13), (11.8, 24.65, .22), (12.25, 23.65, .15), (13.15, 22.86, .2), (13.3, 21.65, .17)])
    px_, _, _ = R(0, 0, 10.75)
    pole_x = R(0, 0, 10.9)[0]
    part('cyl', name, col, 'platform', (px_, 0, 26.8), 1.2, .16, 'roof', vertices=20)
    for i in range(10):
        a0, a1 = math.tau * i / 10, math.tau * (i + 1) / 10
        W.add('platform-rails', col, (px_ + 1.13 * math.cos(a0), 1.13 * math.sin(a0), 26.88), (px_ + 1.13 * math.cos(a0), 1.13 * math.sin(a0), 27.85), .024)
        for h in (27.35, 27.85):
            W.add('platform-rails', col, (px_ + 1.13 * math.cos(a0), 1.13 * math.sin(a0), h), (px_ + 1.13 * math.cos(a1), 1.13 * math.sin(a1), h), .018)
    part('rod', name, col, 'pole', (pole_x, 0, 26.88), (pole_x, 0, 32.62), .15, 'naval', r2=.1, vertices=10)
    part('rod', name, col, 'crosstree', (pole_x, -2.2, 31.4), (pole_x, 2.2, 31.4), .05, 'naval', vertices=6)
    for s in (-1, 1):
        part('rod', name, col, 'crosstree brace', (pole_x, 0, 30.6), (pole_x, s * 1.6, 31.36), .025, 'edge', vertices=5)
    # The SG's guard cage ("flower basket") round the masthead.
    for i in range(6):
        a = math.tau * i / 6
        part('rod', name, col, 'cage leg', (pole_x, 0, 31.9), (pole_x + .55 * math.cos(a), .55 * math.sin(a), 32.55), .025, 'edge', vertices=5)
        b_ = math.tau * (i + 1) / 6
        part('rod', name, col, 'cage ring', (pole_x + .55 * math.cos(a), .55 * math.sin(a), 32.55), (pole_x + .55 * math.cos(b_), .55 * math.sin(b_), 32.55), .025, 'edge', vertices=5)
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
    pipe = [R(0, 11.6, 22.42), R(0, 19.4, 22.42), R(0, 20.2, 22.62), R(0, 27.0, 25.2)]
    for a, b_ in zip(pipe, pipe[1:]):
        part('rod', name, col, 'exhaust pipe', a, b_, .27, 'naval', vertices=10)
    for y_ in (13.2, 15.4, 17.6):
        part('rod', name, col, 'pipe clip', R(0, y_, 22.42), R(0, y_, 21.98), .04, 'edge', vertices=5)

    # ------------------------------------------------------------ funnel fittings
    fcol = collections['Superstructure']
    f = next(s for s in D['structures'] if s['id'] == 'funnel')
    top = f['baseY'] + f['height']
    ring = [(-z, -x) for x, z in f['footprint']]
    cx = sum(p[0] for p in ring) / len(ring)
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
        W.add('funnel-rails', fcol, (a[0], a[1], top), (a[0], a[1], top + .9), .024)
        for h in (.45, .9):
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
        return 25.4 + (xa - cap_aft) / (cap_fwd - cap_aft) * 1.05

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
        heel = P(s * 4.9, 11.8, 14.3)
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
        top_deck = support.below(x - 6.5, y, 20)
        tag(cyl('ground tackle.windlass', (x - 6.5, y, top_deck + .45), .55, .9, 'edge', dcol, 24), 'ground-tackle')
        tag(cyl('ground tackle.windlass cap', (x - 6.5, y, top_deck + .95), .7, .12, 'naval', dcol, 24), 'ground-tackle')
        a, c = Vector((x - 6.0, y, deckz(x - 6.0) + .12)), Vector((x + 1.5, y * 1.05, deckz(x + 1.5) + .12))
        n = int((c - a).length / .3)
        for i in range(n):
            q = a.lerp(c, (i + .5) / n)
            q = Vector((q.x, q.y, support.below(q.x, q.y, q.z + 1) + .1))
            link = tag(box('ground tackle.chain link', q, (.36, .09 if i % 2 else .22, .22 if i % 2 else .09), 'edge', dcol), 'ground-tackle')
            link.rotation_euler.z = math.atan2((c - a).y, (c - a).x)
        # Stockless anchor (reference: 3.4 m tall, crown at 4.7 m, shank into the hawse at 8.1 m), lying
        # against the flare: the shank follows the shell between its hawse and crown heights.
        az = R(0, 0, -113.5)[0]
        top = support.along((az, -s * .1, 8.0), (0, -s, 0), 20)
        low = support.along((az + .3, -s * .1, 5.2), (0, -s, 0), 20)
        out = Vector((0, -s * .28, 0))
        a_top = Vector((top.x, top.y, top.z)) + out
        a_low = Vector((low.x, low.y, low.z)) + out * 1.5
        tag(rod('anchor.shank', a_top, a_low, .19, 'dark', dcol, r2=.16, vertices=8), 'anchors')
        crown = a_low + Vector((0, 0, -.25))
        tag(rod('anchor.crown', crown + Vector((-1.0, 0, 0)), crown + Vector((1.0, 0, 0)), .26, 'dark', dcol, vertices=8), 'anchors')
        for d in (-1, 1):
            tag(rod('anchor.fluke', crown + Vector((d * .95, 0, .05)), crown + Vector((d * 1.05, -s * .15, 1.25)), .22, 'dark', dcol, r2=.08, vertices=6), 'anchors')
        tag(cyl('anchor.hawse lip', (top.x, top.y - s * .05, top.z + .2), .5, .12, 'edge', dcol, 16), 'anchors').rotation_euler.x = math.pi / 2
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
        tag(box('paravane.chock', (x, y, floor + .16), (1.2, .5, .32), 'roof', dcol), 'paravanes')
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
        # The lookout tub forward of the 24 m level is open-topped in the reference: no rails.
        if st['id'] in ('funnel', 'deckhouse-052') or not (platform or top > 9):
            continue
        bridge = abs(top - 21.99) < .1 or abs(top - 28.845) < .1
        runs = []
        for a, b in edge_runs(st, top):
            # The open bridge's glazed front stands 2.0 m over the middle 5.6 m and 1.45 m outboard
            # (reference cuts at x = 0.5-3.3); split edges that cross |x| = 2.8.
            if bridge and abs(top - 21.99) < .1 and (abs(a[1]) - 2.8) * (abs(b[1]) - 2.8) < 0 and abs(a[1] - b[1]) > 1e-6:
                edge = math.copysign(2.8, (a if abs(a[1]) > 2.8 else b)[1])
                t = (edge - a[1]) / (b[1] - a[1])
                m_ = (a[0] + (b[0] - a[0]) * t, edge)
                runs += [(a, m_), (m_, b)]
            else:
                runs.append((a, b))
        for a, b in runs:
            # Solid bulwarks around the bridge and director decks; the director deck's walkway aft to
            # the foremast keeps open rails.
            if bridge and min(a[0], b[0]) > P(0, 0, -3.9)[0]:
                # Reference: 1.45-1.5 m plated bulwarks, externally stiffened, the open bridge's forward
                # run glazed along its upper half; no fascia below the deck edge.
                open_bridge = abs(top - 21.99) < .1
                front = open_bridge and (a[0] + b[0]) / 2 > P(0, 0, -8.2)[0] and abs(a[1] + b[1]) / 2 < 2.8
                wall(st['id'] + '.bulwark', a, b, top, 1.95 if front else 1.4 if open_bridge else 1.5, st['id'])
                d = Vector((b[0] - a[0], b[1] - a[1], 0))
                if d.length > .4:
                    t = d.normalized()
                    n_out = Vector((t.y, -t.x, 0))
                    mid = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0))
                    if n_out.dot(mid - Vector((sum(p[0] for p in outline(st)) / len(outline(st)), sum(p[1] for p in outline(st)) / len(outline(st)), 0))) < 0:
                        n_out = -n_out
                    ribs = max(1, int(d.length / 1.1))
                    for k in range(ribs + 1):
                        q = Vector(a[:2] + (0,)) + d * (k / ribs) + n_out * .06
                        tag(box(st['id'] + '.bulwark stiffener', (q.x, q.y, top + .7), (.07, .07, 1.3), 'naval', scol), st['id'])
                    if front:
                        g = tag(box(st['id'] + '.windscreen', (mid.x + n_out.x * .035, mid.y + n_out.y * .035, top + 1.5), (d.length * .92, .02, .5), 'glass', scol), st['id'])
                        g.rotation_euler.z = math.atan2(d.y, d.x)
                continue
            n = max(1, math.ceil(math.dist(a, b) / 1.8))
            for i in range(n + 1):
                p = (a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
                W.add('platform-rails', scol, (p[0], p[1], top), (p[0], p[1], top + 1.0), .024)
            for h in (.5, 1.0):
                W.add('platform-rails', scol, (a[0], a[1], top + h), (b[0], b[1], top + h), .018)
    # Legs under the raised Oerlikon sponsons abreast the after superstructure and the stern platforms,
    # as the reference stands them on the deck.
    for sid in ('deckhouse-112', 'deckhouse-113', 'deckhouse-134', 'deckhouse-137'):
        st = next((t for t in structures if t['id'] == sid), None)
        if not st:
            continue
        poly = outline(st)
        cx_ = sum(p_[0] for p_ in poly) / len(poly)
        cy_ = sum(p_[1] for p_ in poly) / len(poly)
        for p_ in poly[::max(1, len(poly) // 4)]:
            q = Vector(((p_[0] - cx_) * .75 + cx_, (p_[1] - cy_) * .75 + cy_, 0))
            floor = support.below(q.x, q.y, st['baseY'] - .01)
            if st['baseY'] - floor > .05:
                tag(rod(sid + '.leg', (q.x, q.y, floor), (q.x, q.y, st['baseY'] + .01), .07, 'naval', scol, vertices=6), sid)

    # Knees under the after 5-inch sponson decks, from the barbette out to the rim (reference z = 28.9 cut).
    for sid in ('platform-5in-aft-port', 'platform-5in-aft-starboard'):
        st = next((t for t in structures if t['id'] == sid), None)
        if not st:
            continue
        sgn = -1 if sid.endswith('port') else 1
        cx_, cy_, _ = R(sgn * 10.9, 0, 28.94)
        for ang in (-60, -20, 20, 60, 100, 140, 180, 220, 260):
            a_ = math.radians(ang)
            d_ = Vector((math.cos(a_), math.sin(a_), 0))
            inner = Vector((cx_, cy_, 0)) + d_ * 1.95
            outer = Vector((cx_, cy_, 0)) + d_ * 3.95
            if abs(outer.y) > 13.6:
                outer = Vector((cx_, cy_, 0)) + d_ * max(2.4, (13.6 - abs(cy_)) / max(.2, abs(d_.y)))
            side_ = Vector((-d_.y, d_.x, 0)) * .04
            pts = [inner + Vector((0, 0, 5.9)), inner + Vector((0, 0, 7.1)), outer + Vector((0, 0, 7.1))]
            vv = [tuple(p_ + sv) for sv in (-side_, side_) for p_ in pts]
            tag(mesh(sid + '.knee', vv, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], 'naval', scol), sid)

    # Two rows of windows on the upper tower (24.15-28.75 m), which rakes and tapers.
    def upper_tower(y):
        return (2.086 - (y - 24.149) * .0904) / 2.05, .1435 * (y - 24.149) + .185

    for wy in (25.35, 27.55):
        f_, shift = upper_tower(wy)
        for sx in (-1, 1):
            for wz in (-3.8, -4.7, -5.6):
                g = tag(box('tower.window', R(sx * (2.05 * f_ + .01), wy, wz), (.5, .06, .36), 'glass', scol), 'tower-fittings')
        for wx in (-.55, .55):
            g = tag(box('tower.window', R(wx * f_, wy, -7.73 + shift - .01), (.06, .45, .36), 'glass', scol), 'tower-fittings')
            g.rotation_euler.y = math.radians(-8)

    # Diagonal braces under the tower's after extensions (the 22 m deck and the director deck reach aft
    # to the foremast), as the reference carries them.
    for sx in (-1, 1):
        tag(rod('tower.brace', R(sx * 1.3, 19.5, -2.62), R(sx * 1.3, 21.9, .5), .1, 'naval', scol, vertices=6), 'tower-fittings')
        tag(rod('tower.brace', R(sx * .4, 26.6, -2.42), R(sx * .4, 28.74, 1.5), .09, 'naval', scol, vertices=6), 'tower-fittings')

    # ------------------------------------------------------------ deckhouse walls: doors, scuttles, vents
    for st in structures:
        if st['height'] < 1.8 or st['id'] == 'funnel' or st.get('surface'):
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
            if 24.07 - floor > 3:      # the walkway aft to the foremast rides on the pole, not on posts
                continue
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

    def solid_blade(name, assembly, outline, hand, x, y, z, a):
        """A thin pitched blade: outline (r, tangential) in the disc plane, twisted by radius."""
        top, bot = [], []
        for r, tn in outline:
            ax = hand * tn * .55 / max(r, .5)          # blade angle falls off toward the tip
            base = (x + ax, y + r * math.cos(a) - tn * math.sin(a), z + r * math.sin(a) + tn * math.cos(a))
            top.append((base[0] + .035, base[1], base[2]))
            bot.append((base[0] - .035, base[1], base[2]))
        n = len(outline)
        ff = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
        return tag(mesh(name, top + bot, ff, 'bronze', ucol), assembly)

    # Four wide, skewed blades (reference: 3.71 m screws, blades about 1.5 m wide).
    blade = [(.4, -.45), (.8, -.72), (1.25, -.78), (1.6, -.62), (1.83, -.25), (1.85, .1), (1.7, .42), (1.35, .62), (.9, .58), (.45, .38)]
    for i, ((rx, ry, rzz), hand) in enumerate([((-8.615, -6.525, 84.65), 1), ((-4.725, -6.745, 98.15), 1), ((4.725, -6.745, 98.15), -1), ((8.615, -6.525, 84.65), -1)], 1):
        id = f'shaft-{i}'
        x, y, z = P(rx, ry, rzz)
        inboard = (x + 26, y * .7, z + 1.6)
        tag(rod(id + '.line', inboard, (x + .9, y, z), .2, 'edge', ucol, vertices=14), id)
        for d in (1.9, 9.0):
            p = Vector(inboard).lerp(Vector((x, y, z)), 1 - d / 26)
            tag(rod(id + '.strut boss', (p.x - .45, p.y, p.z), (p.x + .45, p.y, p.z), .32, 'antifouling', ucol, vertices=12), id)
            # V-strut: a vertical leg and one raked 35 degrees inboard, each to the shell above.
            side_in = -1 if p.y > 0 else 1
            for ang in (0, 35):
                d_ = Vector((0, side_in * math.sin(math.radians(ang)), math.cos(math.radians(ang))))
                shell = support.along((p.x, p.y, p.z), tuple(d_), 12)
                tag(rod(id + '.strut leg', p, Vector((shell.x, shell.y, shell.z)) + d_ * .12, .1, 'antifouling', ucol, r2=.08, vertices=8), id)
        tag(rod(id + '.hub', (x - .45, y, z), (x + .95, y, z), .47, 'bronze', ucol, r2=.36, vertices=16), id)
        tag(rod(id + '.fairing cone', (x - 1.55, y, z), (x - .45, y, z), .02, 'bronze', ucol, r2=.47, vertices=16), id)
        for k in range(4):
            solid_blade(id + '.blade', id, blade, hand, x, y, z, math.tau * k / 4 + hand * .12)
    # Centreline skeg (reference x = 0 and z = 92 cuts): the flat keel runs on to z 96.6, then rises
    # to meet the hull at z 99.2; 1.6 m wide at the hull, 1.1 m at the keel.
    prof = [R(0, -9.85, 80.0), R(0, -9.85, 96.6), R(0, -4.75, 99.2), R(0, -5.9, 90.0), R(0, -8.0, 84.0), R(0, -8.0, 80.0)]
    widths = (.55, .55, .75, .8, .8, .8)
    n = len(prof)
    vv = [(p_[0], sw * w, p_[2]) for sw in (-1, 1) for p_, w in zip(prof, widths)]
    ff = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i + n, (i + 1) % n + n, (i + 1) % n, i) for i in range(n)]
    tag(mesh('skeg.plate', vv, ff, 'antifouling', ucol), 'skeg')

    # Balanced rudder: a thick foil (chord 104.7-113.7, 1.3 m thick at the hull, tapering below 6.5 m)
    # from the reference cuts at y = -7, z = 110 and x = 0.
    def foil(t):
        return 5 * t * (.2969 * math.sqrt(max(t, 0)) - .126 * t - .3516 * t ** 2 + .2843 * t ** 3 - .1036 * t ** 4) / .5

    stations = [0, .03, .1, .2, .35, .5, .65, .8, .92, 1]
    levels = [(-2.6, 104.05, 113.75, 1.0), (-6.5, 104.5, 113.7, 1.0), (-9.2, 105.25, 113.65, .45), (-9.6, 106.3, 113.6, .25)]
    rings = []
    for yy, le, te, scale in levels:
        half = [(le + (te - le) * t, .64 * max(0, foil(t)) * scale if t < 1 else 0) for t in stations]
        rings.append([R(hw, yy, zz) for zz, hw in half] + [R(-hw, yy, zz) for zz, hw in reversed(half[1:-1])])
    m = len(rings[0])
    vv = [p_ for ring in rings for p_ in ring]
    ff = [tuple(range(m)), tuple(reversed(range((len(rings) - 1) * m, len(rings) * m)))]
    for j in range(len(rings) - 1):
        ff += [(j * m + i, j * m + (i + 1) % m, (j + 1) * m + (i + 1) % m, (j + 1) * m + i) for i in range(m)]
    tag(mesh('rudder.blade', vv, ff, 'antifouling', ucol), 'rudder')
    rx, _, _ = R(0, 0, 107.5)
    tag(rod('rudder.stock', (rx, 0, -3.6), (rx, 0, -1.9), .3, 'edge', ucol, vertices=16), 'rudder')

    # Bilge keels (reference z = 0 cut, y = -9.35 plan): short triangular fins at the bilge turn,
    # 0.95 m deep, running z -12 to 25 and fading out at both ends.
    fin = Vector((0, .45, -.87)).normalized()
    for sgn in (-1, 1):
        rows = []
        for k in range(13):
            zr = -12 + 37 * k / 12
            ax_ = R(0, 0, zr)[0]
            d_ = Vector((0, -sgn * fin.y, fin.z))
            root = support.along((ax_, -sgn * 9.0, -8.85), (0, -sgn, 0), 8)     # the bilge at 8.85 m depth
            root = Vector((root.x, root.y, root.z))
            fade = max(0, min(1, (zr + 12) / 4, (25 - zr) / 4))
            tang = Vector((0, d_.z, -d_.y)) * .14
            rows.append((root - tang - d_ * .08, root + tang - d_ * .08, root + d_ * (.95 * fade + .02)))
        vv = [tuple(p_) for row in rows for p_ in row]
        ff = []
        for j in range(len(rows) - 1):
            a0, b0 = 3 * j, 3 * (j + 1)
            ff += [(a0, b0, b0 + 2, a0 + 2), (a0 + 1, a0 + 2, b0 + 2, b0 + 1)]
        tag(mesh('bilge keel.' + ('port' if sgn < 0 else 'starboard'), vv, ff, 'antifouling', ucol), 'bilge-keels')

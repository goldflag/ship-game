"""Cleveland hull appendages: skeg, rudder, bilge keels, shaft bossings and brackets, screws,
propeller guards and the fantail bulwark, proportioned to the approved Hull A.

Blender frame as in build.py: X forward (= -z runtime), Y port (= -x runtime), Z up (= y runtime).
Positions are runtime metres measured on the viewing reference; every part is seated on the loft.
"""
import math
import bmesh


def build_underwater(D, helpers, materials, col):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    naval, red, bronze = materials['naval'], materials['antifouling'], materials['bronze']
    H = D['hull']; L = H['length']

    def tag(obj, name):
        obj['assemblyId'] = name
        return obj

    def section(z):
        """Starboard outline [(half-breadth, height)] at runtime z, keel first."""
        st = L / 2 - z
        S = H['sections']
        for a, b in zip(S, S[1:]):
            if a['station'] <= st <= b['station']:
                t = 0 if b['station'] == a['station'] else (st - a['station']) / (b['station'] - a['station'])
                return [(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t) for pa, pb in zip(a['points'], b['points'])]
        return S[0]['points'] if st < 0 else S[-1]['points']

    def keel(z):
        return section(z)[0][1]

    def shell_x(z, y):
        """Half-breadth of the loft at height y."""
        p = section(z)
        for (w0, y0), (w1, y1) in zip(p, p[1:]):
            if y0 <= y <= y1 and y1 > y0:
                return w0 + (w1 - w0) * (y - y0) / (y1 - y0)
        return p[-1][0] if y > p[-1][1] else 0.0

    def bottom_y(z, x):
        """Lowest loft height at half-breadth x (the shell under a point x off the centreline)."""
        p = section(z)
        for (w0, y0), (w1, y1) in zip(p, p[1:]):
            if (w0 - x) * (w1 - x) <= 0 and w1 != w0:
                return y0 + (y1 - y0) * (x - w0) / (w1 - w0)
        return p[0][1]

    def nearest(z, px, py):
        p = section(z); best = None
        for (w0, y0), (w1, y1) in zip(p, p[1:]):
            vx, vy = w1 - w0, y1 - y0; l2 = vx * vx + vy * vy
            t = 0 if l2 < 1e-12 else max(0, min(1, ((px - w0) * vx + (py - y0) * vy) / l2))
            q = (w0 + t * vx, y0 + t * vy); d = (q[0] - px) ** 2 + (q[1] - py) ** 2
            if best is None or d < best[0]:
                best = (d, q)
        return best[1]

    def loft_rings(name, rings, mat, smooth=False):
        """Closed solid through rings of (X, Y, Z) points with equal counts; ends capped."""
        n = len(rings[0]); vv = [p for r in rings for p in r]; ff = [tuple(reversed(range(n))), tuple(range((len(rings) - 1) * n, len(rings) * n))]
        for r in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                ff.append((r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i))
        obj = tag(mesh(name, vv, ff, mat, col, smooth), name.split('.')[0])
        bm = bmesh.new(); bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data); bm.free()
        return obj

    def lerp_table(table, z):
        for (a, va), (b, vb) in zip(table, table[1:]):
            if a <= z <= b:
                return va + (vb - va) * (z - a) / (b - a)
        return table[0][1] if z < table[0][0] else table[-1][1]

    # Centreline skeg (deadwood) from the forefoot of the run to its raked after edge at z 64.
    bottom = [(34.5, None), (36, -7.62), (40, -7.59), (45, -7.50), (50, -7.42), (55, -7.31), (60, -7.20), (63.3, -7.13), (63.9, -6.9), (64.25, -5.35)]
    half = [(34.5, .12), (38, .27), (42, .30), (46, .45), (50, .54), (56, .52), (60, .46), (64.25, .40)]
    rings = []
    for z, yb in bottom:
        k = keel(z); yb = k if yb is None else min(yb, k); w = lerp_table(half, z); top = k + .30
        rings.append([(-z, s * w, y) for s, y in [(1, top), (1, yb + .12), (.55, yb), (-.55, yb), (-1, yb + .12), (-1, top)]])
    loft_rings('skeg', rings, red)

    # Balanced rudder: a thick foil, the leading edge slightly raked, the trailing edge upright.
    def foil(y, le, te, t):
        return [(le, 0), (le + .35, .8 * t), (le + 1.2, t), (te - 1.5, .78 * t), (te, .16 * t), (te, -.16 * t), (te - 1.5, -.78 * t), (le + 1.2, -t), (le + .35, -.8 * t)]
    rings = []
    for y, le, t in [(-7.18, 79.22, .21), (-6.9, 79.12, .24), (-3.5, 78.30, .25), (-2.30, 78.05, .25)]:
        rings.append([(-z, -x, y) for z, x in foil(y, le, 86.05, t)])
    loft_rings('rudder.blade', rings, red)

    # Bilge keels: plates along the measured tip line, roots on the loft's bilge.
    tips = [(-25.5, None), (-24, (8.02, -4.65)), (-22, (8.28, -4.95)), (-20, (8.46, -5.20)), (-16, (8.49, -5.50)), (-10, (8.52, -5.75)),
            (-4, (8.50, -5.90)), (0, (8.50, -6.00)), (6, (8.38, -6.00)), (12, (8.26, -6.00)), (18, (8.06, -5.85)), (24, (7.81, -5.65)),
            (28, (7.49, -5.25)), (30, (7.18, -4.90)), (31.2, None)]
    for sign in [-1, 1]:
        name = 'bilge-keel-' + ('port' if sign > 0 else 'starboard'); rings = []
        for i, (z, tip) in enumerate(tips):
            ref = tip or tips[i + 1 if i == 0 else i - 1][1]
            root = nearest(z, *ref)
            if tip is None:
                tip = (root[0] + .02, root[1] - .02)
            dx, dy = tip[0] - root[0], tip[1] - root[1]; l = math.hypot(dx, dy) or 1; nx, ny = -dy / l * .04, dx / l * .04
            ux, uy = dx / l * .05, dy / l * .05
            r0 = (root[0] - ux, root[1] - uy)
            rings.append([(-z, sign * (p[0] + s * nx), p[1] + s * ny) for p, s in [(r0, 1), (tip, 1), (tip, -1), (r0, -1)]])
        loft_rings(name, rings, red)

    # Shafts, bossings, A-brackets and four screws; hubs at the reference's positions.
    # (name, Blender Y, height, hub fore end z, radius, blade plane z, bossing start, bossing end z, bracket z, inboard strut Y)
    screws = [('propeller-1', 6.3705, -5.03, 58.78, 1.60, 59.65, (36.0, 5.10, -4.50), 47.5, 58.0, 3.62),
              ('propeller-2', 3.137, -5.463, 75.90, 1.48, 76.71, (52.0, 1.95, -4.98), 63.5, 75.0, .45),
              ('propeller-3', -3.137, -5.463, 75.90, 1.48, 76.71, (52.0, -1.95, -4.98), 63.5, 75.0, -.45),
              ('propeller-4', -6.3705, -5.03, 58.78, 1.60, 59.65, (36.0, -5.10, -4.50), 47.5, 58.0, -3.62)]
    for name, x, y, z, R, zb, boss, boss_end, bracket_z, inboard in screws:
        # runtime x of the build's propeller-N: Blender Y is -x, and the build's sign convention put
        # propeller-1 on the port side (Blender +Y), so mirror here.
        X, Y = -z, x
        side = 1 if x > 0 else -1
        bz, bx, by = boss
        shaft_r = .175
        # Faired bossing tapering into the shaft
        t_end = (boss_end - bz) / (z - bz)
        end = (bx + (x - bx) * t_end, by + (y - by) * t_end)
        rings = []
        for t, r in [(0, .68), (.35, .62), (.7, .42), (1, shaft_r + .01)]:
            zc = bz + (boss_end - bz) * t; xc = bx + (end[0] - bx) * t; yc = by + (end[1] - by) * t
            rings.append([(-zc, xc + r * math.cos(a), yc + r * math.sin(a)) for a in [k * math.tau / 16 for k in range(16)]])
        loft_rings(name + '.bossing', rings, red, True)
        rod(name + '.shaft', (-boss_end, end[0], end[1]), (X - .2, Y, y), shaft_r, naval, col, vertices=12)['assemblyId'] = name
        # A-bracket: a bearing barrel with one upright and one inboard-raking strut into the run.
        bxz = bracket_z; cx = end[0] + (x - end[0]) * (bxz - boss_end) / (z - boss_end); cy = end[1] + (y - end[1]) * (bxz - boss_end) / (z - boss_end)
        tag(cyl(name + '.bracket barrel', (-bxz, cx, cy), .37, 1.25, red, col, 20), name).rotation_euler.y = math.pi / 2
        for tx in [cx, inboard]:
            top_y = bottom_y(bxz, abs(tx)) + .25
            a = (-bxz, cx, cy); b = (-bxz, tx, top_y)
            vx, vy = b[1] - a[1], b[2] - a[2]; l = math.hypot(vx, vy); nx, ny = -vy / l * .06, vx / l * .06
            vv = [(a[0] + dz, a[1] + s * nx, a[2] + s * ny) for dz in [-.26, .26] for s in [-1, 1]] + [(b[0] + dz, b[1] + s * nx, b[2] + s * ny) for dz in [-.26, .26] for s in [-1, 1]]
            ff = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
            tag(mesh(name + '.bracket strut', vv, ff, red, col), name)
        # Hub and four broad skewed blades with pitch.
        hub_len = 1.72
        rod(name + '.hub', (X, Y, y), (X - hub_len * .8, Y, y), .30, bronze, col, r2=.30, vertices=16)['assemblyId'] = name
        rod(name + '.cap', (X - hub_len * .8, Y, y), (X - hub_len, Y, y), .30, bronze, col, r2=.08, vertices=16)['assemblyId'] = name
        cxb = -zb
        lead = [(.14, .10), (.30, .22), (.45, .31), (.60, .35), (.75, .34), (.88, .27), (.97, .14), (1.0, .02)]
        trail = [(1.0, .02), (.97, -.09), (.88, -.18), (.75, -.23), (.60, -.25), (.45, -.23), (.30, -.18), (.14, -.10)]
        outline = lead + trail[1:]
        hand = side
        for k in range(4):
            # tip bearings as the reference: 13.8 degrees off the horizontal, mirrored per side
            ang = k * math.tau / 4 + side * math.radians(13.8)
            vv = []
            for face in [-1, 1]:
                for rr, cc in outline:
                    r = rr * R; c = cc * R * hand
                    pitch = math.atan(1.15 * 2 * R / (math.tau * max(r, .3)))
                    tang = c * math.cos(pitch); axial = -c * math.sin(pitch) + face * .035
                    vv.append((cxb + axial, Y + r * math.cos(ang) - tang * math.sin(ang), y + r * math.sin(ang) + tang * math.cos(ang)))
            n = len(outline)
            ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
            tag(mesh(name + '.blade', vv, ff, bronze, col, True), name)

    # Propeller guards over the wing screws: a D-shaped plate at 1.62 m with three raking braces.
    for sign in [-1, 1]:
        name = 'propeller-guard-' + ('port' if sign > 0 else 'starboard')
        pts = []
        for k in range(13):
            a = math.pi * k / 12; zc = 59.1 - 2.65 * math.cos(a); xo = 8.35 + 1.86 * math.sin(a)
            pts.append((zc, xo))
        pts += [(61.75, shell_x(61.75, 1.62) - .12), (56.45, shell_x(56.45, 1.62) - .12)]
        n = len(pts)
        vv = [(-zc, sign * xo, h) for h in [1.57, 1.67] for zc, xo in pts]
        ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
        tag(mesh(name, vv, ff, naval, col), name)
        for zb, xb in [(58.06, 9.62), (59.15, 10.05), (60.2, 9.45)]:
            rod(name + '.brace', (-zb, sign * xb, 1.62), (-zb, sign * (shell_x(zb, 2.9) - .03), 2.9), .07, naval, col, vertices=8)['assemblyId'] = name

    # Fantail bulwark along the deck edge aft of z 83.9, 0.11 m thick, to 8.0 m.
    for sign in [-1, 1]:
        name = 'fantail-bulwark-' + ('port' if sign > 0 else 'starboard'); rings = []
        for i in range(14):
            z = 83.9 + (89.93 - 83.9) * i / 13
            p = section(z)[-1]; top = 8.0 if z < 88 else 8.05
            rings.append([(-z, sign * xo, yy) for xo, yy in [(p[0] + .01, p[1] - .06), (p[0] + .01, top), (p[0] - .11, top), (p[0] - .11, p[1] - .06)]])
        loft_rings(name, rings, naval)

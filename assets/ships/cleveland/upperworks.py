"""Cleveland funnel fittings, funnel galleries and pole masts, proportioned to the approved Hull A.

Blender frame as in build.py: X forward (= -z runtime), Y port (= -x runtime), Z up (= y runtime). The helpers
below take runtime (x, y, z) so the measured tables read as they were taken.
"""
import math
import bmesh


def outward(obj):
    """Consistent outward normals on a closed authored mesh."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data); bm.free()
    return obj


def build_upperworks(D, helpers, materials, col, F):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    naval, roof, dark, boot = materials['naval'], materials['roof'], materials['dark'], materials['edge']

    def B(p):
        x, y, z = p
        return (-z, -x, y)

    def tag(obj, name):
        obj['assemblyId'] = name
        return obj

    def tube(name, a, b, r, mat=None, r2=None, n=12):
        return tag(rod(name, B(a), B(b), r, mat or naval, col, r2=r2, vertices=n), name.split('.')[0])

    def path(name, pts, r, mat=None, n=12):
        for a, b in zip(pts, pts[1:]):
            tube(name, a, b, r, mat, n=n)
        for p in pts[1:-1]:
            tag(cyl(name + ' joint', B(p), r, r * 2, mat or naval, col, n), name.split('.')[0]).rotation_euler = (0, 0, 0)

    def plate(name, ring, top, thick, mat=None):
        """Horizontal plate from a runtime [x, z] ring, top face at `top`."""
        n = len(ring)
        vv = [B((x, top - thick, z)) for x, z in ring] + [B((x, top, z)) for x, z in ring]
        ff = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        return outward(tag(mesh(name, vv, ff, mat or roof, col), name.split('.')[0]))

    def ringwall(name, cx, cz, y, r, h, start, end, t=.08):
        """Circular bulwark (runtime centre cx, cz; angles from +x toward +z, degrees)."""
        n = max(8, round((end - start) / 10)); vv = []
        for radius, hh in [(r, 0), (r, h), (r - t, h), (r - t, 0)]:
            for i in range(n + 1):
                a = math.radians(start + (end - start) * i / n)
                vv.append(B((cx + radius * math.cos(a), y + hh, cz + radius * math.sin(a))))
        k = n + 1; ff = []
        for j in range(3):
            for i in range(n):
                ff.append((j * k + i, j * k + i + 1, (j + 1) * k + i + 1, (j + 1) * k + i))
        ff.extend([(0, k, 2 * k, 3 * k), (n, k + n, 2 * k + n, 3 * k + n)])
        return outward(tag(mesh(name, vv, ff, naval, col), name.split('.')[0]))

    def rail(name, pts, y, h=.95, step=1.6):
        """Stanchions and two wires along a runtime [x, z] polyline at deck height y."""
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            L = math.hypot(x1 - x0, z1 - z0); k = max(1, math.ceil(L / step))
            for i in range(k):
                t = i / k; x = x0 + (x1 - x0) * t; z = z0 + (z1 - z0) * t
                tube(name + ' stanchion', (x, y, z), (x, y + h, z), .025, n=6)
            for hh in [h * .5, h]:
                tube(name + ' wire', (x0, y + hh, z0), (x1, y + hh, z1), .016, boot, n=6)
        x, z = pts[-1]
        tube(name + ' stanchion', (x, y, z), (x, y + h, z), .025, n=6)

    def wall(name, pts, y, h, t=.08):
        """Thin solid bulwark along a runtime [x, z] polyline standing on height y."""
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            L = math.hypot(x1 - x0, z1 - z0)
            ob = box(name, B(((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2)), (L + .04, t, h), naval, col)
            ob.rotation_euler.z = math.atan2(-(x1 - x0), -(z1 - z0)); tag(ob, name.split('.')[0])
            tube(name + ' cap', (x0, y + h, z0), (x1, y + h, z1), .045, n=6)

    struct = {s['id']: s for s in D['structures']}

    # --- Funnels: dark throat inside each open cowl.
    for name in ['forward-funnel', 'after-funnel']:
        V = struct[name]['surface']['vertices']; n = 40
        throat = [B(p) for p in V[-n:]]
        tag(mesh(name + '.throat', throat, [tuple(range(n))], boot, col), name)

    # Forward funnel: waste-steam pipe up the after face, bent aft into a flared horn above the cowl.
    name = 'forward-funnel'
    fz = lambda y: -2.78 + .092 * (y - 15)
    pipe = [(0, 12.73, fz(12.73)), (0, 20.7, fz(20.7)), (0, 21.05, fz(20.7) + .2), (0, 21.3, fz(20.7) + .42)]
    path(name + '.waste steam pipe', pipe, .2)
    mouth = (0, 21.9, fz(20.7) + 1.0)
    tube(name + '.waste steam horn', pipe[-1], mouth, .2, r2=.55, n=8)
    for y in [14.2, 17.0, 19.8]:
        tube(name + '.pipe clip', (0, y, fz(y) - .2), (0, y, fz(y) - .42), .05, n=6)
    # Two small pipes up the fore face, over the collar and up the cowl front.
    front = lambda y: -6.945 + .0925 * (y - 14)
    for x in [-.35, .35]:
        pts = [(x, 15.34, front(15.34) - .12), (x, 21.0, front(21.0) - .12), (x, 21.35, front(21.0) - .22), (x, 22.9, -5.77 - .1)]
        path(name + '.fore pipe', pts, .07, n=8)
    # After funnel: S-bent exhaust pipe up the fore face to above the cowl.
    name = 'after-funnel'
    s_pipe = [(0, 12.8, 4.62), (0, 14, 4.64), (0, 15, 4.81), (0, 16, 5.02), (0, 17, 5.15), (0, 18, 5.26), (0, 19, 5.36), (0, 20, 5.40),
              (0, 21, 5.25), (0, 22, 5.56), (0, 22.5, 5.77), (0, 23.0, 5.94), (0, 23.3, 5.97)]
    path(name + '.exhaust pipe', s_pipe, .22)
    tag(cyl(name + '.exhaust cap', B((0, 23.36, 5.97)), .3, .1, naval, col, 12), name)
    for y, z in [(14.5, 4.72), (18.5, 5.31)]:
        fzf = 5.065 + .09 * (y - 13)
        tube(name + '.pipe clip', (0, y, z + .2), (0, y, fzf + .03), .05, n=6)

    # --- Forward funnel gallery at 15.34 m with the Mk 51 tubs either side of the funnel.
    name = 'funnel-gallery-forward'
    half = [(0, -8.63), (0.47, -8.54), (0.90, -8.28), (1.24, -7.89), (1.54, -6.85), (2.11, -6.05), (3.60, -6.04), (3.58, -5.95), (4.13, -5.84),
            (4.59, -5.53), (4.90, -5.07), (5.00, -4.53), (4.90, -3.99), (4.59, -3.54), (4.13, -3.23), (3.58, -3.12), (3.59, -3.02)]
    ring = [(x, z) for x, z in half] + [(-x, z) for x, z in reversed(half) if x > 0]
    plate(name + '.deck', ring, 15.34, .15)
    for s in [-1, 1]:
        # A solid bulwark round the tubs and the nose, a rail across the after edge.
        # Bulwarks round the tubs only (1.1 m); guard rails on the nose and across the after edge.
        ringwall(name + '.tub', s * 3.70, -4.53, 15.34, 1.30, 1.1, -95 if s > 0 else 85, 95 if s > 0 else 275)
        wall(name + '.bulwark', [(s * 2.11, -6.05), (s * 3.60, -6.04)], 15.34, 1.1)
        rail(name + '.rail', [(0, -8.63), (s * .47, -8.54), (s * .90, -8.28), (s * 1.24, -7.89), (s * 1.54, -6.85), (s * 2.11, -6.05)], 15.34)
        rail(name + '.rail', [(s * 3.59, -3.02), (s * 1.2, -3.02)], 15.34)
        # Brackets from the tubs and the nose down to the uptake casing and the 02 deck.
        for z in [-5.3, -3.6]:
            tube(name + '.bracket', (s * 4.3, 15.2, z), (s * 2.05, 12.73, z - .2 if z < -4 else z - .4), .08, n=8)

    # --- After funnel searchlight gallery at 16.97 m, with the 36-inch searchlights in its fore tubs.
    name = 'searchlight-gallery'
    half = [(0, 4.44), (1.19, 4.44), (1.48, 4.01), (1.93, 3.71), (2.46, 3.60), (2.99, 3.71), (3.43, 4.00), (3.73, 4.45), (3.84, 4.98),
            (3.73, 5.50), (3.43, 5.95), (2.93, 6.27), (2.97, 6.36), (1.39, 7.84), (0.62, 9.18), (0, 9.39)]
    ring = [(x, z) for x, z in half] + [(-x, z) for x, z in reversed(half) if x > 0]
    plate(name + '.deck', ring, 16.97, .15)
    for s in [-1, 1]:
        ringwall(name + '.tub', s * 2.46, 4.98, 16.97, 1.38, .9, 150, 390)
        rail(name + '.rail', [(s * 2.97, 6.36), (s * 1.39, 7.84), (s * .62, 9.18)], 16.97)
        # Diagonal struts to the after block's 02 deck.
        tube(name + '.strut', (s * 2.46, 16.85, 3.75), (s * 1.55, 12.8, 5.9), .09, n=8)
        tube(name + '.strut', (s * 3.6, 16.85, 5.6), (s * 1.95, 12.8, 7.6), .09, n=8)
        tube(name + '.strut', (s * 2.46, 16.85, 3.75), (s * 3.6, 16.85, 5.6), .06, n=6)
        # 36-inch searchlight: pedestal, trunnion yoke and drum trained forward.
        lx, lz = s * 2.53, 4.95; sname = 'searchlight-36in-' + ('starboard' if s > 0 else 'port')
        tag(cyl(sname + '.pedestal', B((lx, 17.35, lz)), .16, .76, naval, col, 12), sname)
        for dx in [-.55, .55]:
            tube(sname + '.yoke', (lx + dx, 17.7, lz), (lx + dx, 18.3, lz), .05, n=6)
        tube(sname + '.yoke', (lx - .55, 17.7, lz), (lx + .55, 17.7, lz), .06, n=6)
        tube(sname + '.drum', (lx, 18.25, lz + .55), (lx, 18.25, lz - .6), .48, n=16)
        tag(cyl(sname + '.lens', B((lx, 18.25, lz - .62)), .42, .03, materials['glass'], col, 16), sname).rotation_euler = (0, math.pi / 2, 0)
        tube(sname + '.vent', (lx, 18.7, lz + .1), (lx, 18.95, lz + .1), .14, n=8)

    # --- Pole masts. Foremast: a raked pole from the 02 deck with the SK platform, yard and SG topmast;
    # mainmast: a raked pole from the after 02 deck with its platform, yard and the TDY pole.
    def pole_z(y, a, b):
        (y0, z0), (y1, z1) = a, b
        return z0 + (z1 - z0) * (y - y0) / (y1 - y0)

    fore = ((12.73, -10.75), (28.07, -9.81))
    name = 'foremast'
    tube(name + '.pole', (0, fore[0][0], fore[0][1]), (0, fore[1][0] + .02, fore[1][1]), .40, r2=.25, n=16)
    F.ladder(name + '.ladder', B((0, 13.2, pole_z(13.2, *fore) - .45)), B((0, 27.8, pole_z(27.8, *fore) - .33)), .45)
    top = 28.07
    sk = [(round(1.3 * math.cos(a), 3), round(-11.2 + 1.3 * math.sin(a), 3)) for a in [math.pi * (1 + k / 12) for k in range(13)]]
    walk = [(-1.10, -9.92), (-1.06, -9.63), (-0.55, -6.62), (-0.34, -6.39), (0, -6.30), (0.34, -6.39), (0.55, -6.62), (1.06, -9.63), (1.10, -9.92)]
    plate(name + '.platform', [(x, z) for x, z in sk] + walk[::-1], top, .12)
    tube(name + '.yard', (-8.51, top - .1, -9.77), (8.51, top - .1, -9.77), .12, n=10)
    for s in [-1, 1]:
        tube(name + '.yard brace', (s * 7.42, top, -9.70), (s * .9, top - .02, -7.0), .05, n=6)
        tube(name + '.yard strut', (0, top - 3.2, pole_z(top - 3.2, *fore)), (s * 4.5, top + .05, -9.77), .05, n=6)
        for x in [4.6, 8.4]:
            tube(name + '.signal halyard', (s * x, top + .1, -9.77), (s * x * .4, 15.1, -12.3), .018, dark, n=4)
        tube(name + '.platform knee', (s * 1.0, top - .12, -11.2), (0, top - 1.6, pole_z(top - 1.6, *fore) - .15), .07, n=6)
    # SG topmast: a pole on the after walkway with two raking legs.
    tube(name + '.sg topmast', (0, top, -7.17), (0, 34.62, -7.17), .15, n=10)
    for s in [-1, 1]:
        tube(name + '.sg leg', (s * .62, top, -7.75), (s * .12, 34.3, -7.28), .06, n=6)
    tube(name + '.sg stay', (0, top + .1, pole_z(top, *fore)), (0, 33.2, -7.2), .03, n=4)

    main = ((12.8, 9.68), (27.21, 11.25))
    name = 'mainmast'
    tube(name + '.pole', (0, main[0][0], main[0][1]), (0, main[1][0] + .02, main[1][1]), .355, r2=.225, n=16)
    F.ladder(name + '.ladder', B((0, 13.4, pole_z(13.4, *main) - .42)), B((0, 26.9, pole_z(26.9, *main) - .3)), .45)
    top = 27.21
    half = [(0, 8.19), (0.34, 8.28), (0.57, 8.52), (0.77, 9.75), (1.91, 9.75), (2.15, 9.83), (2.32, 10.00), (2.38, 10.23), (2.32, 10.47),
            (1.22, 11.25), (1.22, 11.94), (1.11, 12.75), (0.85, 13.10), (0.46, 13.34), (0, 13.42)]
    ring = [(x, z) for x, z in half] + [(-x, z) for x, z in reversed(half) if x > 0]
    plate(name + '.platform', ring, top, .12)
    rail(name + '.rail', [(-1.22, 11.4), (-1.11, 12.75), (-0.46, 13.34), (0.46, 13.34), (1.11, 12.75), (1.22, 11.4)], top, .9, 1.2)
    tube(name + '.yard', (-5.45, top - .12, 11.3), (5.45, top - .12, 11.3), .10, n=10)
    for s in [-1, 1]:
        tube(name + '.yard brace', (s * 5.03, top, 6.07 + (11.3 - 6.07) * .35), (s * 4.22, top, 11.26), .04, n=6)
        tube(name + '.yard strut', (0, top - 2.6, pole_z(top - 2.6, *main)), (s * 3.2, top + .05, 11.3), .05, n=6)
        for x in [3.0, 5.2]:
            tube(name + '.signal halyard', (s * x, top + .08, 11.3), (s * x * .4, 17.7, 12.0), .018, dark, n=4)
        tube(name + '.platform knee', (s * 1.7, top - .12, 10.2), (0, top - 1.9, pole_z(top - 1.9, *main) - .1), .07, n=6)
    tube(name + '.platform knee', (0, top - .12, 8.5), (0, top - 1.9, pole_z(top - 1.9, *main) - .2), .07, n=6)
    # TDY pole forward of the platform (the aerial itself is in fittings.py).
    tube(name + '.antenna pole', (0, top, 9.14), (0, 33.914, 9.14), .11, n=10)
    tube(name + '.pole brace', (0, top, 8.3), (0, 33.7, 8.85), .025, n=4)
    tag(cyl(name + '.pole cap', B((0, 33.83, 9.14)), .31, .17, naval, col, 16), name)

    # IFF saucers on the yard ends.
    for yx, yy, yz in [(8.38, 28.07, -9.77), (5.07, 27.21, 11.3)]:
        for s_ in [-1, 1]:
            tube('mast-fittings.iff stalk', (s_ * yx, yy, yz), (s_ * yx, yy + .75, yz), .03, n=6)
            tag(cyl('mast-fittings.iff dish', B((s_ * yx, yy + .8, yz)), .36, .06, naval, col, 16, .12), 'mast-fittings')

    def deck_y(z):
        st = D['hull']['length'] / 2 - z
        d = D['hull']['deckHeights']
        for (a, va), (b, vb) in zip(d, d[1:]):
            if a <= st <= b:
                return va + (vb - va) * (st - a) / (b - a)
        return d[-1][1]

    def edge_wall(name, pts, h, t=.1, top=None):
        """Deck-standing bulwark along a runtime [x, z] polyline: h above the deck (following the sheer),
        or up to a level `top`."""
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            y0, y1 = deck_y(z0) - .05, deck_y(z1) - .05
            t0, t1 = (top, top) if top else (y0 + h + .05, y1 + h + .05)
            nx, nz = z1 - z0, -(x1 - x0); L = math.hypot(nx, nz) or 1; nx, nz = nx / L * t / 2, nz / L * t / 2
            a = [B((x0 + nx, y0, z0 + nz)), B((x1 + nx, y1, z1 + nz)), B((x1 + nx, t1, z1 + nz)), B((x0 + nx, t0, z0 + nz))]
            b = [B((x0 - nx, y0, z0 - nz)), B((x1 - nx, y1, z1 - nz)), B((x1 - nx, t1, z1 - nz)), B((x0 - nx, t0, z0 - nz))]
            ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
            outward(tag(mesh(name, a + b, ff, naval, col), name.split('.')[0]))
            tube(name + ' cap', (x0, t0, z0), (x1, t1, z1), .05, n=6)

    # 20 mm deck-edge bulwarks: the bow gun tub and the U-shaped sponsons abreast the guns (1.2-1.4 m).
    # D-shaped tub round both bow 20 mm guns, open aft on the centreline; its top level at 8.66 m.
    bow = [(0.9, -83.63), (1.84, -83.57), (2.44, -83.69), (3.0, -84.1), (3.16, -84.79), (2.94, -85.87), (2.26, -86.71), (1.84, -87.09),
           (0.8, -87.61), (0, -87.61)]
    for s_ in [-1, 1]:
        edge_wall('bow-gun-bulwark', [(s_ * x, z) for x, z in bow], 1.2, top=8.66)
    for ident, pts in [('aa-sponson-forward', [(5.2, -49.69), (6.36, -49.69), (6.82, -49.27), (6.92, -48.9), (6.92, -44.83), (6.82, -44.63),
                                              (6.40, -44.25), (5.2, -44.21)]),
                       ('aa-sponson-midships', [(7.16, 4.21), (8.40, 4.31), (8.70, 4.57), (8.82, 4.85), (8.82, 9.73), (8.52, 10.03), (8.36, 10.11),
                                                (7.16, 10.15)]),
                       ('aa-sponson-after', [(6.72, 40.85), (7.92, 40.99), (8.26, 41.25), (8.40, 41.57), (8.42, 48.65), (8.04, 48.99), (7.84, 49.07),
                                             (6.72, 49.07)])]:
        for s_ in [-1, 1]:
            edge_wall(ident, [(s_ * x, z) for x, z in pts], 1.4)

    # Guard rails round the 01 deck edges where nothing stands on them.
    roofs = [struct[k] for k in ['forward-deckhouse', 'center-deckhouse-roof', 'after-deckhouse']]
    others = [s for s in D['structures'] if 8.0 < s['baseY'] < 8.4 or (s['baseY'] < 8 and s['baseY'] + s['height'] > 8.5)] + roofs

    def inside(x, z, poly):
        c = False
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
                c = not c
        return c
    # Keep rails out of every gun's training circle.
    reach = {'main': 7.5, 'secondary': 3.6}
    guns = [(m['position'][0], m['position'][2], reach.get(m['id'].split('-')[0], 3.2 if m['weapon']['caliberM'] > .03 else 2.6))
            for m in D['mounts'] if abs(m['position'][1] - 8.27) < 3.0]
    for r in roofs:
        poly = r['footprint']
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            L = math.hypot(bx - ax, bz - az); k = max(1, math.ceil(L / 1.6))
            for i in range(k):
                t0, t1 = i / k, (i + 1) / k
                p0 = (ax + (bx - ax) * t0, az + (bz - az) * t0); p1 = (ax + (bx - ax) * t1, az + (bz - az) * t1)
                m = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
                # inset 12 cm from the edge
                nx, nz = (bz - az) / (L or 1), -(bx - ax) / (L or 1)
                if inside(m[0] + nx * .3, m[1] + nz * .3, poly):
                    nx, nz = -nx, -nz
                q0 = (p0[0] - nx * .12, p0[1] - nz * .12); q1 = (p1[0] - nx * .12, p1[1] - nz * .12)
                if any(inside(m[0], m[1], o['footprint']) or inside(m[0] + nx * .3, m[1] + nz * .3, o['footprint']) for o in others if o is not r):
                    continue
                if any(math.hypot(m[0] - gx, m[1] - gz) < gr for gx, gz, gr in guns):
                    continue
                rail('deck-01-rail', [q0, q1], 8.27, .95, 2.0)

    # Sky lookouts on the pilot house roof and the after 03 roof; 24-inch searchlights on the 03 deck.
    for x, y, z in [(2.25, 17.25, -15.62), (2.48, 17.25, -13.01), (-2.25, 17.25, -15.62), (-2.48, 17.25, -13.01), (2.31, 15.45, 13.43), (-2.31, 15.45, 13.43)]:
        name = 'sky-lookout'
        tube(name + '.column', (x, y, z), (x, y + 1.05, z), .08, n=8)
        tag(box(name + '.binocular', B((x, y + 1.2, z)), (.55, .35, .3), naval, col), name)
        tube(name + '.seat post', (x, y, z + .45), (x, y + .6, z + .45), .04, n=6)
        tag(cyl(name + '.seat', B((x, y + .62, z + .45)), .18, .05, naval, col, 10), name)
        tag(cyl(name + '.foot', B((x, y + .04, z)), .3, .08, naval, col, 12), name)
    for s_ in [-1, 1]:
        name = 'searchlight-24in-' + ('starboard' if s_ > 0 else 'port')
        lx, lz = s_ * 3.93, -13.25
        tag(cyl(name + '.pedestal', B((lx, 15.35, lz)), .55, .6, naval, col, 16), name)
        tube(name + '.column', (lx, 15.6, lz), (lx, 16.3, lz), .14, n=10)
        tube(name + '.yoke', (lx - .48, 16.3, lz), (lx + .48, 16.3, lz), .05, n=6)
        for dx in [-.48, .48]:
            tube(name + '.yoke', (lx + dx, 16.3, lz), (lx + dx, 17.0, lz), .04, n=6)
        tube(name + '.drum', (lx, 17.0, lz + .5), (lx, 17.0, lz - .55), .42, n=14)
        tag(cyl(name + '.lens', B((lx, 17.0, lz - .57)), .37, .03, materials['glass'], col, 14), name).rotation_euler = (0, math.pi / 2, 0)
        tube(name + '.vent', (lx, 17.42, lz), (lx, 17.58, lz), .12, n=8)


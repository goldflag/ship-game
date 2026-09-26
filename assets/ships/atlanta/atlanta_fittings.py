"""Atlanta fittings: tubs and splinter shields, funnel tops, masts and the SC-1 aerial, directors and the
rangefinder, torpedo mounts, depth-charge gear, boats, the boat crane, searchlights, deck gear and underwater
gear.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the approved
GameModels3D pasc006 model's hardpoints and part bounds and converted once by `P`; shapes are original
approximations of the reference's fittings at their measured sizes. No reference geometry is loaded.
"""
import math
import bmesh
from mathutils import Vector, Matrix
from atlanta_kit import P, R, ZS


def V(x, y, z):
    return Vector(P(x, y, z))


def local(ob, pivot):
    """Parent a freshly built object to an unrotated pivot, keeping its authored place."""
    ob.location = Vector(ob.location) - Vector(pivot.location)
    ob.parent = pivot
    return ob


def taper(kit, aid, col, label, a, b, r0, r1, material='naval', n=12):
    return kit.part('rod', aid, col, label, V(*a), V(*b), r0, material, r2=r1, vertices=n)


def ring_pts(cx, cz, r, n=28, rx=None):
    """Plan ring in the reference frame (x, z) about a centre."""
    rx = r if rx is None else rx
    return [(cx + rx * math.cos(math.tau * i / n), cz + r * math.sin(math.tau * i / n)) for i in range(n)]


def plan(pts):
    """Reference-frame plan points (x, z) -> authoring-frame (x, y)."""
    return [P(x, 0, z)[:2] for x, z in pts]


def hull_half(kit, zref, y):
    """Loft half-breadth at a reference z and height (from the compiled sections)."""
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZS)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])

            def w(sec):
                # Held at the section's own deck edge above it: the sheer rises between stations.
                yy = min(y, sec['points'][-1][1])
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= yy <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (yy - y0) / (y1 - y0))
                return best
            return w(s0) * (1 - t) + w(s1) * t
    return 0.0


def deck(kit, zref):
    """Weather deck at the side at a reference z."""
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZS)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][-1][1] * (1 - t) + s1['points'][-1][1] * t
    return 3.64


# ---------------------------------------------------------------- bow bulwark
# The reference carries a flared bulwark above the forecastle deck edge from z -76.7 to the stem: a sloped aft end
# up to 8.45 m at z -77.6, then a top rising gently to 8.85 m at the stem head (sections at z -77.5 to -82.2, plan
# cuts at y 8.5 and 8.75). Outer top edge (z, half-breadth); the bullnose fairleads pierce it.
BULWARK_FOOT = -76.71
BULWARK_TOP = [(-77.58, 2.50), (-78.0, 2.46), (-78.5, 2.36), (-79.0, 2.25), (-79.5, 2.16), (-80.0, 2.04), (-80.5, 1.93),
               (-81.0, 1.76), (-81.5, 1.57), (-82.0, 1.27), (-82.2, 1.15), (-82.42, .97), (-82.6, .75), (-82.74, .57),
               (-82.85, .3), (-82.9, 0.0)]


def stem_z(kit):
    """Reference z of the hull's stem head (station L)."""
    return -kit.D['hull']['length'] / 2 - ZS


def deck_edge(kit, zref):
    """(half-breadth, height) of the weather-deck edge, held at the stem head forward of it."""
    z = max(zref, stem_z(kit) + .005)
    y = deck(kit, z)
    return hull_half(kit, z, y - .005), y


def bulwark_top(kit, zref):
    """(half-breadth, height) of the bow bulwark's outer top edge at a reference z, or None aft of its foot."""
    if zref > BULWARK_FOOT:
        return None
    z1, x1 = BULWARK_TOP[0]
    if zref >= z1:
        x0, y0 = deck_edge(kit, BULWARK_FOOT)
        t = (BULWARK_FOOT - zref) / (BULWARK_FOOT - z1)
        return x0 + (x1 - x0) * t, y0 + (8.45 - y0) * t
    for (za, xa), (zb, xb) in zip(BULWARK_TOP, BULWARK_TOP[1:]):
        if zb <= zref <= za:
            x = xa + (xb - xa) * (za - zref) / (za - zb)
            break
    else:
        x = 0.0
    return x, 8.45 + .0757 * (BULWARK_TOP[0][0] - max(zref, BULWARK_TOP[-1][0]))


def side_x(kit, zref, y):
    """Outer half-breadth of the hull side at a reference z and height, the bow bulwark included."""
    xe, ye = deck_edge(kit, zref)
    top = bulwark_top(kit, zref)
    ylo = ye - .12
    if y <= ylo or top is None or top[1] < ye + .01:
        return hull_half(kit, zref, min(y, ye - .005))
    xlo = hull_half(kit, zref, ylo) - .02
    return max(hull_half(kit, zref, min(y, ye - .005)), xlo + (top[0] - xlo) * (y - ylo) / (top[1] - ylo))


def bow_bulwark(kit):
    col = kit.collections['Hull and decks']
    tip = stem_z(kit)
    zs = [BULWARK_FOOT, -76.9, -77.1, -77.3] + [z for z, _ in BULWARK_TOP]
    vv, ff = [], []

    def add(p):
        vv.append(P(*p))
        return len(vv) - 1

    for s in (-1, 1):
        rows = []
        for z in zs:
            xb, yb = deck_edge(kit, z)
            if z < tip:
                xb = 0.0
            xt, yt = bulwark_top(kit, z)
            inner = xt - .12 > .03 and xb - .14 > .03
            # The outer plating starts just inside the side below the deck edge and runs out through it, so the
            # two surfaces meet in a clean line instead of a step.
            ylo, xlo = (yb - .12, hull_half(kit, z, yb - .12) - .02) if z >= tip else (yb, 0.0)
            rows.append(dict(ob=add((s * xlo, ylo, max(z, tip))), ot=add((s * xt, yt, z)),
                             it=add((s * (xt - .12), yt, z)) if inner else None,
                             ib=add((s * (xb - .14), yb - .03, max(z, tip))) if inner else None,
                             ct=add((0.0, yt, z)), cb=add((0.0, yb - .03, max(z, tip)))))
        for a, b in zip(rows, rows[1:]):
            ff.append((a['ob'], b['ob'], b['ot'], a['ot']))
            if b['it'] is not None:
                ff.append((a['ot'], b['ot'], b['it'], a['it']))
                ff.append((a['it'], b['it'], b['ib'], a['ib']))
                ff.append((a['ib'], b['ib'], b['ob'], a['ob']))
            elif a['it'] is not None:
                # Forward of here the two sides are one solid: close the inner face across to the centreline.
                ff.append((a['it'], a['ct'], a['cb'], a['ib']))
                ff.append((a['ot'], b['ot'], b['ct'], a['ct'], a['it']))
                ff.append((a['ob'], a['ib'], a['cb'], b['cb'], b['ob']))
            else:
                ff.append((a['ot'], b['ot'], b['ct'], a['ct']))
                ff.append((a['ob'], a['cb'], b['cb'], b['ob']))
        r0 = rows[0]
        ff.append((r0['ob'], r0['ot'], r0['it'], r0['ib']))
    ff = [f if len(set(f)) == len(f) else tuple(dict.fromkeys(f)) for f in ff]
    ff = [f for f in ff if len(f) >= 3]
    ob = kit.mesh('bow-bulwark', vv, ff, 'hullgray', col)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    kit.tag(ob, 'bow-bulwark')
    return ob


def surface_disc(kit, aid, col, label, s, zc, yc, rz, ry, lift, material, n=16):
    """A thin elliptic plate lying on the hull side (bulwark included) about (zc, yc), `lift` proud of it."""
    vv, ff = [], []
    for k in range(n):
        t = math.tau * k / n
        z, y = zc + rz * math.cos(t), yc + ry * math.sin(t)
        x = side_x(kit, z, y)
        vv += [P(s * (x + lift), y, z), P(s * (x - .02), y, z)]
    ff.append(tuple(2 * k for k in range(n)))
    ff.append(tuple(2 * k + 1 for k in reversed(range(n))))
    ff += [(2 * k, 2 * k + 1, 2 * ((k + 1) % n) + 1, 2 * ((k + 1) % n)) for k in range(n)]
    ob = kit.mesh(aid + '.' + label, vv, ff, material, col)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return kit.tag(ob, aid)


def surface_ring(kit, aid, col, s, zc, yc, rz, ry, lift, r=.05, n=14, material='naval'):
    """A rim of members round an ellipse on the hull side."""
    pts = []
    for k in range(n):
        t = math.tau * k / n
        z, y = zc + rz * math.cos(t), yc + ry * math.sin(t)
        pts.append(V(s * (side_x(kit, z, y) + lift), y, z))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        kit.member(aid, col, a, b, r, material, 6)


def leaf(kit, aid, col, label, s, root, tip, width, lift0, lift1, thickness=.12, material='naval', n=6):
    """A flat pointed blade (an anchor fluke) lying along the hull side from root (z, y) to tip (z, y)."""
    (z0, y0), (z1, y1) = root, tip
    L = math.hypot(z1 - z0, y1 - y0)
    nz, ny = -(y1 - y0) / L, (z1 - z0) / L
    outer, inner = [], []
    for k in range(n + 1):
        t = k / n
        half = width / 2 * (.75 + 1.1 * t) * (1 - t ** 2.2) if k < n else 0.0
        zc, yc = z0 + (z1 - z0) * t, y0 + (y1 - y0) * t
        lift = lift0 + (lift1 - lift0) * t
        for side in ((-1, 1) if k < n else (0,)):
            z, y = zc + side * nz * half, yc + side * ny * half
            x = side_x(kit, z, y) + lift
            outer.append(P(s * (x + thickness / 2), y, z))
            inner.append(P(s * (x - thickness / 2), y, z))
    m = len(outer)
    # Outline order: the -1 side root to tip, then the +1 side back to the root.
    order = [2 * k for k in range(n)] + [m - 1] + [2 * k + 1 for k in reversed(range(n))]
    vv = outer + inner
    ff = [tuple(order), tuple(m + i for i in reversed(order))]
    ff += [(order[i], order[(i + 1) % len(order)], m + order[(i + 1) % len(order)], m + order[i]) for i in range(len(order))]
    ob = kit.mesh(aid + '.' + label, vv, ff, material, col)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return kit.tag(ob, aid)


# ---------------------------------------------------------------- tubs and splinter shields
# Walled tubs round light guns and directors (reference frame): centre (x, z) and radius, or a traced outline;
# floor and shield top heights from the reference's plan cuts and probes.
TUBS = [
    ('mk44-tub-port', (-5.61, -24.02, 1.2), 7.06, 8.095),
    ('mk44-tub-starboard', (5.61, -24.02, 1.2), 7.06, 8.095),
    ('aa-tub-stern-port', (-3.4, 69.43, 1.6), 4.248, 5.245),
    ('aa-tub-stern-starboard', (3.4, 69.43, 1.6), 4.248, 5.245),
    ('quad-tub-after', (0.0, 26.79, 2.42), 10.011, 10.995),
    ('quad-tub-stern', [(-.16, 72.01), (-.62, 72.35), (-.78, 72.87), (-1.28, 73.33), (-1.66, 73.39), (-1.7, 73.83), (-2.34, 74.51), (-2.62, 75.15),
                        (-2.66, 76.27), (-2.62, 76.59), (-2.34, 77.23), (-1.94, 77.75), (-1.36, 78.21), (-.68, 78.49), (0, 78.53), (.68, 78.49),
                        (1.36, 78.21), (1.94, 77.75), (2.34, 77.23), (2.62, 76.59), (2.66, 76.27), (2.62, 75.15), (2.34, 74.51), (1.7, 73.83),
                        (1.66, 73.39), (1.28, 73.33), (.78, 72.87), (.62, 72.35), (.16, 72.01)], 4.398, 5.395),
]


def tub_outline(shape):
    if isinstance(shape, tuple):
        cx, cz, r = shape
        return ring_pts(cx, cz, r, 32)
    return shape


def platforms(D, kit):
    """Tub floors that stand above the deck or roof below them, drawn before anything is seated on them."""
    col = kit.collections['Superstructure']
    made = []
    for aid, shape, floor, top in TUBS:
        pts = tub_outline(shape)
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        made.append(kit.prism(aid, col, 'floor', plan(pts), floor - .1, floor, 'naval', 'roof'))
    return made


def tubs(D, kit):
    col = kit.collections['Superstructure']
    for aid, shape, floor, top in TUBS:
        pts = tub_outline(shape)
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        kit.wall(aid, col, 'splinter shield', plan(pts), floor - .1, top, .045, 'naval')
        # A rolled lip on the shield top and supports down to whatever the floor stands on.
        ring = [V(x, top, z) for x, z in pts]
        for a, b in zip(ring, ring[1:] + ring[:1]):
            kit.member(aid, col, a, b, .035, 'naval', 6)
        c = V(cx, floor - .1, cz)
        base = kit.below(c.x, c.y, c.z - .02, c.z - .02)
        if c.z - base > .08:
            r = max(math.hypot(x - cx, z - cz) for x, z in pts) * .55
            kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, base - .02)), r, c.z - base + .02, 'naval', 20)
    # Open-backed double splinter shield round each pair of waist 20 mm on the 01 deck (plan cuts at 6.6-7.32 m),
    # standing on the deck up to 7.33 m.
    for s in (-1, 1):
        aid = 'aa-shield-waist-' + ('port' if s < 0 else 'starboard')
        line = [(s * x, z) for x, z in WAIST_SHIELD]
        pts = plan(line)
        floor = kit.below(*V(line[5][0], 6.3, line[5][1])[:2], 6.6, 6.2)
        kit.wall(aid, col, 'splinter shield', pts, floor - .02, 7.33, .04, 'naval', closed=False)
        for a, b in zip(line, line[1:]):
            kit.member(aid, col, V(a[0], 7.33, a[1]), V(b[0], 7.33, b[1]), .025, 'naval', 6)


# Outer face of the port waist shield (reference x, z), from its inboard end aft round both tubs to the forward end.
WAIST_SHIELD = [(3.95, 2.84), (5.16, 2.33), (5.82, 2.15), (6.59, 2.36), (7.15, 2.92), (7.36, 3.69), (7.15, 4.46), (6.59, 5.03), (5.82, 5.24),
                (5.82, 6.48), (6.59, 6.69), (7.15, 7.25), (7.36, 8.02), (7.15, 8.79), (6.59, 9.36), (5.82, 9.56), (5.16, 9.38), (3.98, 8.64)]


# ---------------------------------------------------------------- funnels
def funnels(D, kit):
    """Clinker screens, rims, a ladder and a top gallery on each funnel's measured cap."""
    col = kit.collections['Superstructure']
    for s in D['structures']:
        if 'exhaust' not in s:
            continue
        aid = s['id']
        vs = s['surface']['vertices']
        n = len(s['footprint'])
        top = [Vector(R(v)) for v in vs[-n:]]
        # Rolled rim round the mouth.
        for a, b in zip(top, top[1:] + top[:1]):
            kit.member(aid, col, a, b, .06, 'naval', 6)
        # Clinker-screen bars across the mouth, fore and aft, 0.45 m apart.
        xs = [p.x for p in top]
        x0, x1 = min(xs), max(xs)
        k = max(2, int((x1 - x0) / .45))
        for i in range(1, k):
            x = x0 + (x1 - x0) * i / k
            cut = []
            for a, b in zip(top, top[1:] + top[:1]):
                if (a.x - x) * (b.x - x) < 0:
                    t = (x - a.x) / (b.x - a.x)
                    cut.append(a.lerp(b, t))
            if len(cut) >= 2:
                cut.sort(key=lambda p: p.y)
                kit.member(aid, col, cut[0] + Vector((0, 0, .08)), cut[-1] + Vector((0, 0, .08)), .03, 'black', 4)
        # A ladder up the after side of the casing from its base to the rim.
        bottom = [Vector(R(v)) for v in vs[:n]]
        rear = min(range(n), key=lambda i: bottom[i].x)
        a, b = bottom[rear] + Vector((-.14, 0, .1)), top[rear] + Vector((-.14, 0, -.25))
        kit.ladder(aid, col, a, b, (0, 1, 0), .42)
        # Gallery 0.9 m under the rim's lowest point: a grating on brackets, 0.5 m wide, with a rail.
        rings = [[Vector(R(v)) for v in vs[j * n:(j + 1) * n]] for j in range(len(vs) // n)]
        yg = min(p.z for p in top) - .9
        ring = min(rings[:-1], key=lambda r: abs(sum(p.z for p in r) / n - yg))
        cx, cy = sum(p.x for p in ring) / n, sum(p.y for p in ring) / n
        inner, outer = [], []
        for p in ring:
            d = Vector((p.x - cx, p.y - cy, 0)).normalized()
            inner.append(Vector((p.x, p.y, yg)) - d * .02)
            outer.append(Vector((p.x, p.y, yg)) + d * .5)
        vv, ff = [], []
        for q in inner + outer:
            vv += [tuple(q), tuple(q + Vector((0, 0, .06)))]
        for i in range(n):
            j = (i + 1) % n
            a0, b0, a1, b1 = 2 * i, 2 * j, 2 * (n + i), 2 * (n + j)
            ff += [(a0 + 1, b0 + 1, b1 + 1, a1 + 1), (a0, a1, b1, b0), (a1, a1 + 1, b1 + 1, b1), (a0, b0, b0 + 1, a0 + 1)]
        grating = kit.tag(kit.mesh(aid + '.gallery grating', vv, ff, 'edge', col), aid)
        for i in range(0, n, 2):
            kit.member(aid, col, outer[i], outer[i] + Vector((0, 0, 1.0)), .022, 'naval', 5)
            kit.member(aid, col, inner[i] + Vector((0, 0, -.02)), outer[i] - Vector((0, 0, .45)) + (inner[i] - outer[i]) * .5, .03, 'naval', 5)
        for h in (.5, 1.0):
            for i in range(n):
                kit.member(aid, col, outer[i] + Vector((0, 0, h)), outer[(i + 1) % n] + Vector((0, 0, h)), .016, 'naval', 4)
        # A steam pipe up the forward starboard face of the casing to above the rim.
        fore = max(range(n), key=lambda i: bottom[i].x - .6 * abs(bottom[i].y + .6))
        pb, pt = bottom[fore], top[fore]
        out = Vector((pb.x - cx, pb.y - cy, 0)).normalized() * .22
        kit.part('rod', aid, col, 'steam pipe', pb + out + Vector((0, 0, .1)), pt + out + Vector((0, 0, .45)), .11, 'naval', vertices=10)
        kit.part('rod', aid, col, 'pipe mouth', pt + out + Vector((0, 0, .45)), pt + out + Vector((0, 0, .6)), .15, 'black', vertices=10)


# ---------------------------------------------------------------- masts and the SC-1 aerial
def masts(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    # Raked hexagonal pole from the bridge top to the SC-1 aerial (plan cuts: axis z -14.28 at 16 m to -13.07 at 32 m,
    # 0.43 m to 0.2 m across the flats), the signal yard at 31 m with its lamps, outriggers fore and aft for the stays,
    # the RDF loop, the ship's bell and small lamp brackets on the forward face.
    axis = lambda y: -14.275 + (y - 16.0) * .0757
    foot, head = (0, 15.1, axis(15.1)), (0, 32.82, axis(32.82))
    taper(kit, aid, col, 'pole', foot, head, .45, .2, 'naval', 6)
    kit.cylz(aid, col, 'foot collar', V(0, 15.1, axis(15.1)), .56, .3, 'naval', 6)
    for s in (-1, 1):
        taper(kit, aid, col, 'signal yard', (s * .15, 31.0, axis(31.0)), (s * 7.8, 31.0, axis(31.0)), .1, .05, 'naval', 8)
        kit.member(aid, col, V(0, 29.6, axis(29.6)), V(s * 4.0, 30.98, axis(31.0)), .03, 'naval', 5)
        for x in (4.52, 7.30):
            kit.cylz(aid, col, 'signal lamp', V(s * x, 31.05, axis(31.0)), .08, .2, 'dark', 8)
    kit.boxc(aid, col, 'wind vane', V(1.54, 31.25, axis(31.0)), (.4, .1, .6), 'edge')
    # Outriggers: aft to z -9.4 near the masthead, forward to z -16.2 for the forestay, each on a strut.
    kit.beam(aid, col, 'after outrigger', V(0, 32.4, axis(32.4)), V(0, 32.1, -9.4), .1, .12, 'naval')
    kit.member(aid, col, V(0, 30.4, axis(30.4)), V(0, 32.05, -9.5), .04, 'naval', 5)
    kit.beam(aid, col, 'forward outrigger', V(0, 31.5, axis(31.5)), V(0, 30.6, -16.2), .1, .12, 'naval')
    kit.member(aid, col, V(0, 32.5, axis(32.5)), V(0, 30.65, -16.1), .04, 'naval', 5)
    kit.boxc(aid, col, 'signal plate', V(0, 27.6, axis(27.6) - .55), (.4, .12, 2.9), 'naval')
    for y in (19.4, 20.6, 22.1, 25.1):
        c = V(0, y, axis(y) - .35)
        kit.boxc(aid, col, 'lamp bracket', c + Vector((.2, 0, 0)), (.6, .5, .06), 'naval')
        kit.cylz(aid, col, 'lamp', c + Vector((.35, 0, .03)), .1, .25, 'dark', 8)
    kit.part('rod', aid, col, 'rdf loop', V(0, 19.1, -12.38), V(0, 19.9, -12.38), .03, 'edge', vertices=6)
    kit.cylz(aid, col, 'rdf ring', V(0, 19.9, -12.38), .32, .04, 'edge', 16)
    kit.member(aid, col, V(0, 19.1, -12.38), V(0, 19.1, axis(19.1) + .3), .04)
    kit.cylz(aid, col, 'ships bell', V(0, 16.9, axis(16.9) + .5), .2, .45, 'brass', 12, r2=.12)
    kit.member(aid, col, V(0, 17.35, axis(17.35) + .5), V(0, 17.35, axis(17.35) + .3), .03)
    kit.ladder(aid, col, V(0, 15.3, axis(15.3) - .5), V(0, 30.7, axis(30.7) - .28), (0, 1, 0), .38)
    # Masthead plate carrying the aerial's turntable.
    kit.cylz(aid, col, 'masthead plate', V(0, 32.8, axis(32.8)), .36, .1, 'naval', 12)
    # SC-1 air-search aerial on the masthead, trained by the rig (HP_ARS_1): a bedspring on a yoke.
    rid = 'radar-sc1'
    bx, by, bz = P(0, 32.9, -12.966)
    pivot = kit.empty(rid + '.yaw', (bx, by, bz), assembly=rid, col=col)
    local(kit.cylz(rid, col, 'turntable', (bx, by, bz), .28, .16, 'edge', 16), pivot)
    local(kit.boxc(rid, col, 'yoke', (bx, by, bz + .45), (.25, .6, .6), 'naval'), pivot)
    w, h, zc = 2.6, 2.5, bz + 1.55
    for i in range(7):
        yy = -w / 2 + w * i / 6
        local(kit.part('rod', rid, col, 'dipole bar', (bx + .12, by + yy, zc - h / 2), (bx + .12, by + yy, zc + h / 2), .02, 'edge', vertices=5), pivot)
    for j in range(6):
        zz = zc - h / 2 + h * j / 5
        local(kit.part('rod', rid, col, 'dipole bar', (bx + .12, by - w / 2, zz), (bx + .12, by + w / 2, zz), .02, 'edge', vertices=5), pivot)
    local(kit.boxc(rid, col, 'reflector screen', (bx - .1, by, zc), (.04, w, h), 'dark'), pivot)
    for t in (-1, 1):
        local(kit.part('rod', rid, col, 'frame', (bx, by + t * w / 2, zc - h / 2), (bx, by + t * w / 2, zc + h / 2), .04, 'naval', vertices=6), pivot)
    # Main (after) mast abaft the after funnel (plan cuts: axis z 9.38 at 16.5 m raking to 9.97 at 27.5 m, 0.34 m to
    # 0.26 m across, a topmast above 26 m), its yard and the ensign gaff to the HP_flag_nation datum.
    aid = 'mainmast'
    axis_m = lambda y: 9.38 + (y - 16.5) * .0563
    taper(kit, aid, col, 'pole', (0, 14.6, axis_m(14.6)), (0, 26.2, axis_m(26.2)), .18, .12, 'naval', 6)
    taper(kit, aid, col, 'topmast', (0, 26.0, axis_m(26.0)), (0, 28.9, axis_m(28.9)), .07, .04, 'naval', 8)
    kit.cylz(aid, col, 'foot collar', V(0, 14.6, axis_m(14.6)), .28, .3, 'naval', 6)
    for s in (-1, 1):
        taper(kit, aid, col, 'yard', (s * .08, 27.3, axis_m(27.3)), (s * 3.2, 27.3, axis_m(27.3)), .07, .04, 'naval', 8)
    taper(kit, aid, col, 'gaff', (0, 25.6, axis_m(25.6) + .1), (0, 24.34, 13.1), .07, .04, 'naval', 8)
    kit.member(aid, col, V(0, 27.0, axis_m(27.0)), V(0, 24.4, 13.05), .02, 'edge', 4)
    kit.boxc(aid, col, 'speed light', V(0, 18.0, axis_m(18.0) + .3), (.8, .28, .6), 'edge')
    kit.ladder(aid, col, V(0, 14.8, axis_m(14.8) + .32), V(0, 25.8, axis_m(25.8) + .28), (0, 1, 0), .34)


# ---------------------------------------------------------------- fire control
def mk37(kit, did, x, y, z, face):
    """Mk 37 director house on its roller ring, trained by the rig: sloped front, roof hatches, rangefinder
    through the house with hooded ends."""
    col = kit.collections['Sensors and masts']
    bx, by, bz = P(x, y, z)
    pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
    s = 1 if face == 0 else -1
    local(kit.cylz(did, col, 'roller ring', (bx, by, bz - .05), 1.28, .3, 'edge', 32), pivot)
    # House: 3.4 m long, 2.9 m wide, 2.1 m tall, the front face raked back.
    L, W, H = 3.4, 2.9, 2.1
    f, r = s * L / 2, -s * L / 2
    outline = [(r, -W / 2), (f - s * .45, -W / 2), (f, -W / 2 + .45), (f, W / 2 - .45), (f - s * .45, W / 2), (r, W / 2)]
    vv = [(bx + px, by + py, bz + .25) for px, py in outline] + [(bx + px - s * (.35 if abs(px - f) < .5 else 0), by + py, bz + .25 + H) for px, py in outline]
    n = len(outline)
    ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    house = kit.tag(kit.mesh(did + '.house', vv, ff, 'naval', col), did)
    bm = bmesh.new()
    bm.from_mesh(house.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(house.data)
    bm.free()
    local(house, pivot)
    # Rangefinder tube through the house and its end hoods, 4.75 m over the hoods.
    local(kit.part('rod', did, col, 'rangefinder', (bx - s * .2, by - 2.2, bz + 1.55), (bx - s * .2, by + 2.2, bz + 1.55), .2, 'naval', vertices=14), pivot)
    for t in (-1, 1):
        local(kit.boxc(did, col, 'rangefinder hood', (bx - s * .2, by + t * 2.2, bz + 1.55), (.62, .36, .58), 'naval'), pivot)
        local(kit.boxc(did, col, 'hood window', (bx - s * .2 + s * .31, by + t * 2.2, bz + 1.55), (.02, .22, .16), 'glass'), pivot)
    for k, t in enumerate((-.8, 0, .8)):
        local(kit.boxc(did, col, 'roof hatch', (bx + s * .4, by + t, bz + .25 + H + .06), (.55, .5, .12), 'naval'), pivot)
        local(kit.boxc(did, col, 'sight window', (bx + s * .65, by + t, bz + .25 + H + .04), (.04, .32, .1), 'glass'), pivot)
    local(kit.boxc(did, col, 'rear door', (bx + r - s * .02, by, bz + 1.05), (.05, .7, 1.4), 'edge'), pivot)


def mk44(kit, did, x, y, z, bearing):
    """Mk 44 director for a 1.1-inch quad: a pedestal and an open sight head with its handles."""
    col = kit.collections['Sensors and masts']
    c = V(x, y, z)
    floor = kit.below(c.x, c.y, c.z + .2, c.z)
    kit.cylz(did, col, 'pedestal', Vector((c.x, c.y, floor - .01)), .22, c.z + .75 - floor, 'naval', 14)
    kit.cylz(did, col, 'base', Vector((c.x, c.y, c.z + .72)), .34, .12, 'edge', 16)
    yaw = math.radians(-bearing)
    head = kit.boxc(did, col, 'sight head', Vector((c.x, c.y, c.z + 1.18)), (.7, .55, .72), 'naval', yaw)
    for t in (-1, 1):
        off = Matrix.Rotation(yaw, 3, 'Z') @ Vector((.1, t * .26, 1.18))
        kit.part('rod', did, col, 'handle', c + off, c + off + Matrix.Rotation(yaw, 3, 'Z') @ Vector((-.35, 0, -.25)), .025, 'edge', vertices=6)
        off2 = Matrix.Rotation(yaw, 3, 'Z') @ Vector((.36, t * .15, 1.32))
        kit.part('rod', did, col, 'eyepiece', c + off2, c + off2 + Matrix.Rotation(yaw, 3, 'Z') @ Vector((.12, 0, 0)), .06, 'glass', vertices=8)


def directors(D, kit):
    mk37(kit, 'mk37-forward', 0, 18.344, -19.485, 0)
    mk37(kit, 'mk37-after', 0, 14.313, 19.06, 180)
    for did, (x, y, z), bearing in [('mk44-port', (-5.61, 7.038, -24.024), -90), ('mk44-starboard', (5.611, 7.038, -24.009), 90),
                                    ('mk44-after', (-.012, 11.115, 22.116), 180), ('mk44-stern', (0, 5.589, 72.657), 180)]:
        mk44(kit, did, x, y, z, bearing)
    col = kit.collections['Sensors and masts']
    # Torpedo directors on the bridge wings (HP_AD_4/5): a pedestal with a telescope sight.
    for s in (-1, 1):
        aid = 'torpedo-director-' + ('port' if s < 0 else 'starboard')
        c = V(s * 3.633, 13.01, -17.011)
        floor = kit.below(c.x, c.y, c.z + .2, c.z)
        kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, floor - .01)), .12, c.z + 1.05 - floor, 'naval', 10)
        kit.boxc(aid, col, 'sight', c + Vector((0, 0, 1.2)), (1.0, .32, .34), 'naval')
        kit.part('rod', aid, col, 'telescope', c + Vector((.4, 0, 1.42)), c + Vector((.6, 0, 1.42)), .07, 'glass', vertices=8)
    # 2.5 m rangefinder on the navigating bridge (HP_AF_1).
    aid = 'rangefinder-2m5'
    c = V(0, 15.171, -26.788)
    kit.cylz(aid, col, 'pedestal', c, .2, 1.25, 'naval', 12)
    kit.part('rod', aid, col, 'tube', c + Vector((0, -1.3, 1.35)), c + Vector((0, 1.3, 1.35)), .13, 'naval', vertices=12)
    for t in (-1, 1):
        kit.boxc(aid, col, 'end hood', c + Vector((0, t * 1.26, 1.35)), (.4, .22, .36), 'naval')
    # Target designators and peloruses on the bridge (reference part datums).
    for x, y, z in [(-2.27, 15.17, -24.87), (2.27, 15.17, -24.67), (-3.56, 12.81, -19.65), (3.56, 12.81, -19.44), (-1.78, 15.38, -16.97), (1.72, 15.38, -16.81),
                    (-1.82, 11.47, 17.06), (1.77, 11.47, 17.27), (-3.89, 12.98, -23.44), (3.89, 12.98, -23.44)]:
        c = V(x, y, z)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        kit.cylz('bridge-sights', col, 'column', Vector((c.x, c.y, floor)), .07, c.z + 1.1 - floor, 'naval', 8)
        kit.boxc('bridge-sights', col, 'sight', c + Vector((0, 0, 1.25)), (.5, .22, .3), 'naval')


# ---------------------------------------------------------------- torpedo mounts
def torpedo_mounts(D, kit):
    """Quadruple 21-inch Mk 14 mounts: a training base and deck, four tubes with bands, breech doors and the
    trainer's seat, trained from the rest pose (tubes forward) about the reference pivot."""
    col = kit.collections['Torpedoes and depth charges']
    for launcher in D['torpedoLaunchers']:
        lid = launcher['id']
        x, y, z = R(launcher['position'])
        floor = kit.below(x, y, z + .2, z)
        kit.cylz(lid, col, 'base ring', (x, y, floor - .01), 1.05, z - floor + .08, 'naval', 28)
        pivot = kit.empty(lid + '.yaw', (x, y, z), assembly=lid, col=col)
        local(kit.cylz(lid, col, 'turntable', (x, y, z + .08), 1.0, .12, 'edge', 28), pivot)
        local(kit.boxc(lid, col, 'training deck', (x - .5, y, z + .26), (5.2, 2.5, .08), 'roof'), pivot)
        for xx in (-2.9, -.5, 1.8):
            local(kit.boxc(lid, col, 'tube saddle', (x + xx, y, z + .5), (.18, 2.6, .36), 'edge'), pivot)
        side = 1 if y > 0 else -1
        local(kit.boxc(lid, col, 'trainer seat', (x - 3.3, y + side * .9, z + .75), (.45, .45, .9), 'edge'), pivot)
        local(kit.boxc(lid, col, 'sight hood', (x - 3.0, y - side * .9, z + 1.25), (.6, .5, .5), 'naval'), pivot)
        for tube in [t for t in D['torpedoTubes'] if t['launcherId'] == lid]:
            mx, my, mz = R(tube['position'])
            muzzle = Vector((mx, my, mz))
            breech = muzzle - Vector((8.0, 0, 0))
            local(kit.part('rod', lid, col, 'tube', breech, muzzle, .31, 'naval', vertices=16), pivot)
            local(kit.part('rod', lid, col, 'tube mouth', muzzle - Vector((.03, 0, 0)), muzzle + Vector((.005, 0, 0)), .26, 'dark', vertices=16), pivot)
            local(kit.part('rod', lid, col, 'breech door', breech - Vector((.16, 0, 0)), breech + Vector((.1, 0, 0)), .34, 'edge', vertices=16), pivot)
            for xx in (-6.8, -4.6, -2.4, -.5):
                cband = muzzle + Vector((xx, 0, 0))
                local(kit.part('rod', lid, col, 'tube band', cband - Vector((.05, 0, 0)), cband + Vector((.05, 0, 0)), .335, 'edge', vertices=16), pivot)
            kit.empty(tube['id'] + '.muzzle', tuple(muzzle - Vector(pivot.location)), pivot, lid, col)


# ---------------------------------------------------------------- depth charges
def depth_charges(D, kit):
    col = kit.collections['Torpedoes and depth charges']
    for launcher in D['depthChargeLaunchers']:
        lid = launcher['id']
        rx, ry, rz_ = R(launcher['position'])
        kit.empty(lid + '.release', (rx, ry, rz_), assembly=lid, col=col)
        if 'thrower' in lid:
            # K-gun: a mortar barrel raked 45 degrees outboard on its base, the arbor and a charge on it.
            side = -1 if launcher['position'][0] < 0 else 1       # runtime x sign; authoring y = -x
            ay = -side
            base = Vector((rx, ry - ay * .45, 0))
            floor = kit.below(base.x, base.y, rz_ + .2)
            base.z = floor
            kit.cylz(lid, col, 'base', base, .3, .18, 'edge', 14)
            barrel_foot = base + Vector((0, 0, .18))
            barrel_top = barrel_foot + Vector((0, ay * .45, .45))
            kit.part('rod', lid, col, 'barrel', barrel_foot, barrel_top, .17, 'naval', vertices=12)
            kit.part('rod', lid, col, 'arbor', barrel_top, barrel_top + Vector((0, ay * .25, .25)), .08, 'edge', vertices=8)
            kit.part('rod', lid, col, 'charge', barrel_top + Vector((-.33, ay * .3, .3)), barrel_top + Vector((.33, ay * .3, .3)), .22, 'black', vertices=12)
        else:
            # Stern roller track: two rails on a raked frame over the transom, charges rolling aft.
            x0 = rx + 4.1
            floor = kit.below(rx + 2.0, ry, rz_ + 1.5, rz_ - .3)
            for t in (-.42, .42):
                a, b = Vector((x0, ry + t, floor + 1.35)), Vector((rx, ry + t, floor + .95))
                kit.member(lid, col, a, b, .05, 'edge', 6)
                for k in range(5):
                    p = a.lerp(b, k / 4)
                    kit.member(lid, col, p, Vector((p.x, p.y, floor)), .04, 'naval', 5)
            for k in range(6):
                p = Vector((x0 - .3 - k * .65, ry, floor + 1.35 - k * .065 + .25))
                kit.part('rod', lid, col, 'charge', p + Vector((0, -.35, 0)), p + Vector((0, .35, 0)), .22, 'black', vertices=12)
            kit.boxc(lid, col, 'release gate', Vector((rx + .05, ry, floor + .97)), (.07, 1.0, .12), 'naval')
    # Ready-use stowage racks by the throwers, with their charges (reference part datums).
    for x, y, z, along in [(-3.09, 4.25, 59.91, 'x'), (3.09, 4.25, 59.91, 'x'), (-3.58, 4.26, 60.71, 'z'), (3.58, 4.26, 60.71, 'z'), (4.67, 4.26, 60.71, 'z'),
                           (-4.67, 4.26, 60.71, 'z'), (-4.12, 4.26, 60.87, 'z'), (4.12, 4.26, 60.87, 'z'), (2.84, 4.3, 63.09, 'x'), (-2.98, 4.3, 63.09, 'x'),
                           (-4.4, 4.32, 63.8, 'z'), (3.31, 4.31, 63.8, 'z'), (-3.31, 4.31, 63.8, 'z'), (4.4, 4.32, 63.8, 'z'), (3.85, 4.31, 63.96, 'z'),
                           (-3.85, 4.32, 63.96, 'z'), (-3.09, 4.34, 65.56, 'x'), (2.8, 4.35, 66.12, 'x'), (-4.26, 4.36, 66.23, 'z'), (-3.16, 4.35, 66.23, 'z'),
                           (-3.71, 4.35, 66.39, 'z'), (3.16, 4.36, 66.83, 'z'), (4.26, 4.36, 66.83, 'z'), (3.71, 4.36, 66.99, 'z')]:
        c = V(x, y, z)
        floor = kit.below(c.x, c.y, c.z + .3, c.z - .3)
        kit.boxc('depth-charge-stowage', col, 'rack', Vector((c.x, c.y, floor + .2)), (.45, .45, .4), 'edge')
        a = Vector((.35, 0, 0)) if along == 'z' else Vector((0, .35, 0))
        kit.part('rod', 'depth-charge-stowage', col, 'charge', Vector((c.x, c.y, floor + .6)) - a, Vector((c.x, c.y, floor + .6)) + a, .22, 'black', vertices=12)
    # Loading davits beside the throwers.
    for x, z in [(-4.51, 60.08), (4.51, 60.08), (-4.22, 63.16), (4.22, 63.16), (-4.12, 65.58), (4.12, 66.19)]:
        side = 1 if x > 0 else -1
        c = V(x, 4.0, z)
        floor = kit.below(c.x, c.y, 5.0, 3.9)
        foot = Vector((c.x, c.y + side * .3, floor))
        top = foot + Vector((0, 0, 2.7))
        kit.part('rod', 'depth-charge-davits', col, 'davit', foot, top, .06, 'naval', vertices=8)
        kit.part('rod', 'depth-charge-davits', col, 'davit arm', top, top + Vector((0, -side * .9, .2)), .05, 'naval', vertices=8)


# ---------------------------------------------------------------- boats and the crane
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, covered=False, material='white'):
    """Original lofted boat hull on its keel point c (authoring frame), bow toward +X."""
    rings = []
    n = 13
    for i in range(n):
        t = i / (n - 1)
        x = (t - .5) * length
        fore = max(0, (t - .6) / .4)
        aft = max(0, (.25 - t) / .25)
        half = beam / 2 * (1 - fore ** 1.7) * (1 - .35 * aft ** 2) + .02
        top = depth * (1 + .15 * fore ** 2)
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append((x, -half * math.cos(a), top - depth * .85 * math.sin(a) ** 1.4 * (1 - .4 * fore) - depth * .15))
        rings.append(ring)
    rot = Matrix.Rotation(heading, 3, 'Z')
    rings = [[tuple(Vector(c) + rot @ Vector(p)) for p in ring] for ring in rings]
    hull = kit.loft(aid, col, 'boat hull', rings, material, True, True, True)
    if covered:
        kit.boxc(aid, col, 'canopy', Vector(c) + rot @ Vector((-length * .08, 0, depth * .9 + .4)), (length * .5, beam * .7, .85), 'naval', heading)
        kit.boxc(aid, col, 'cockpit coaming', Vector(c) + rot @ Vector((length * .28, 0, depth * .9 + .12)), (length * .2, beam * .6, .25), 'naval', heading)
    else:
        for k in range(4):
            kit.boxc(aid, col, 'thwart', Vector(c) + rot @ Vector(((k - 1.5) * length * .2, 0, depth * .6)), (.2, beam * .85, .06), 'wood', heading)
    return hull


def boats(D, kit):
    col = kit.collections['Boats']
    # 26 ft whaleboats at the 01 level abreast the forward funnel (reference 7.9 m x 2.0 m), in chocks under
    # quadrantal davits.
    for s in (-1, 1):
        aid = 'whaleboat-' + ('port' if s < 0 else 'starboard')
        keel = V(s * 6.14, 6.3, -13.46)
        floor = kit.below(keel.x, keel.y, keel.z + .5, keel.z - .3)
        keel.z = max(keel.z, floor + .12)
        boat(kit, aid, col, keel, 7.88, 2.0, 1.1, 0, False, 'naval')
        for dz in (-2.3, 2.3):
            ck = V(s * 6.14, 0, -13.46 + dz)
            f = kit.below(ck.x, ck.y, keel.z + .3, keel.z - .3)
            kit.boxc(aid, col, 'chock', Vector((ck.x, ck.y, (f + keel.z + .1) / 2)), (.3, 1.3, keel.z + .1 - f), 'edge')
            foot = V(s * 5.2, 0, -13.46 + dz * 1.3)
            ff = kit.below(foot.x, foot.y, keel.z + .5, keel.z - .3)
            foot.z = ff
            top = Vector((foot.x, foot.y, keel.z + 2.4))
            kit.part('rod', aid, col, 'davit', foot, top, .09, 'naval', vertices=10)
            kit.part('rod', aid, col, 'davit head', top, top + Vector((0, s * -.95, -.1)), .07, 'naval', vertices=8)
            kit.wire(aid, col, top + Vector((0, s * -.95, -.15)), Vector((ck.x, ck.y, keel.z + 1.05)), .014, False)
    # 40 ft motor launches on the 01 deck between the funnels, in cradles under the crane (reference 12.25 m x 3.25 m),
    # the 12 ft punts stacked on the centreline between them.
    for s in (-1, 1):
        aid = 'motor-launch-' + ('port' if s < 0 else 'starboard')
        keel = V(s * 2.62, 6.75, -3.84)
        floor = kit.below(keel.x, keel.y, keel.z + .5, keel.z - .5)
        keel.z = max(keel.z, floor + .35)
        boat(kit, aid, col, keel, 12.25, 3.25, 1.7, 0, True, 'naval')
        for dz in (-4.0, 0, 4.0):
            ck = V(s * 2.62, 0, -3.84 + dz)
            f = kit.below(ck.x, ck.y, keel.z + .3, keel.z - .6)
            kit.boxc(aid, col, 'cradle', Vector((ck.x, ck.y, (f + keel.z + .15) / 2)), (.3, 1.9, keel.z + .15 - f), 'edge')
    # Two 12 ft punts stacked on a rack between the launches (reference 3.66 m x 1.15 m, keels at 7.1 and 7.75 m).
    aid = 'punts'
    lower, upper = V(0, 7.07, -4.55), V(0, 7.75, -4.55)
    for dz in (-1.1, 1.1):
        foot = V(0, 0, -4.55 + dz)
        f = kit.below(foot.x, foot.y, 7.2, 5.5)
        kit.boxc(aid, col, 'rack', Vector((foot.x, foot.y, (f + lower.z + .06) / 2)), (.16, 1.0, lower.z + .06 - f), 'edge')
        kit.boxc(aid, col, 'chock', Vector((foot.x, foot.y, lower.z + .57)), (.14, .7, .16), 'edge')
    boat(kit, aid, col, lower, 3.66, 1.15, .55, 0, False, 'naval')
    boat(kit, aid, col, upper, 3.66, 1.15, .55, 0, False, 'naval')
    # Floater-net life rafts standing on edge against the deckhouse and sponson sides (each pushed inboard until it
    # meets the wall, on two brackets) and two flat on the quarterdeck.
    for x, y, z, flat in [(-7.54, 5.59, -22.57, False), (7.54, 5.59, -22.57, False), (-7.61, 7.9, -19.86, False), (7.61, 7.9, -19.86, False),
                          (-3.71, 10.22, -15.54, False), (3.71, 10.22, -15.54, False), (-2.41, 9.14, 21.09, False), (2.41, 9.14, 21.09, False),
                          (0.0, 4.11, 57.5, True), (0.0, 4.11, 59.49, True)]:
        c = V(x, y, z)
        if flat:
            f = kit.below(c.x, c.y, c.z + .3, c.z - .3)
            raft(kit, 'life-rafts', col, Vector((c.x, c.y, f + .2)), 3.2 if z < 58 else 2.7, 1.8 if z < 58 else 1.5, None)
        else:
            inboard = Vector((0, -1 if c.y > 0 else 1, 0))
            try:
                hit = kit.support.along(c + inboard * -.4, inboard, 4.0)
                c = Vector((c.x, hit.y - inboard.y * .24, c.z))
            except ValueError:
                pass
            raft(kit, 'life-rafts', col, c, 3.3, 1.8, -inboard)


def raft(kit, aid, col, c, length, height, outward):
    """A floater-net raft: a rounded-rectangle float ring with a slatted grating inside. Standing on edge when
    `outward` (the wall's outward normal) is given, with two brackets back to the wall; flat otherwise."""
    r, tube = .42, .17
    pts = []
    for cx, cy, a0 in ((length / 2 - r, height / 2 - r, 0), (-length / 2 + r, height / 2 - r, 90), (-length / 2 + r, -height / 2 + r, 180), (length / 2 - r, -height / 2 + r, 270)):
        for k in range(5):
            a = math.radians(a0 + 90 * k / 4)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    if outward is None:
        frame = lambda u, v, w=0.0: c + Vector((u, v, w))
    else:
        frame = lambda u, v, w=0.0: c + Vector((u, 0, v)) + outward * w
    ring = [frame(u, v) for u, v in pts]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        kit.member(aid, col, a, b, tube, 'raft', 8)
    for k in range(7):
        u = -length / 2 + tube + (length - 2 * tube) * (k + .5) / 7
        kit.member(aid, col, frame(u, -height / 2 + tube), frame(u, height / 2 - tube), .035, 'wood', 4)
    for v in (-height * .22, height * .22):
        kit.member(aid, col, frame(-length / 2 + tube, v), frame(length / 2 - tube, v), .03, 'wood', 4)
    if outward is not None:
        for u in (-length * .3, length * .3):
            kit.member(aid, col, frame(u, -height / 2 + .05, -.02), frame(u, -height / 2 + .05, -.3), .04, 'naval', 5)
            kit.member(aid, col, frame(u, height / 2 - .05, -.02), frame(u, height / 2 - .05, -.3), .04, 'naval', 5)


def crane(D, kit):
    """Boat crane between the funnels (reference part am491, cut on the centreline): a pillar on the 01 deck with a
    kingpost to 13.25 m, a box-lattice jib pivoted low at 10 m and raked forward 49 degrees over the motor launches,
    the topping lift from the kingpost head and the hoist."""
    col = kit.collections['Boats']
    aid = 'boat-crane'
    base = V(0, 8.75, 3.1)
    floor = kit.below(base.x, base.y, base.z + .2, base.z)
    kit.cylz(aid, col, 'pillar', Vector((base.x, base.y, floor - .02)), .42, 10.25 - floor, 'naval', 16, r2=.38)
    kit.cylz(aid, col, 'slewing ring', V(0, 10.2, 3.1), .5, .18, 'edge', 16)
    kit.part('rod', aid, col, 'kingpost', V(0, 10.35, 3.1), V(0, 13.25, 3.1), .26, 'naval', r2=.08, vertices=10)
    heel, head = V(0, 10.1, 2.7), V(0, 17.75, -4.0)
    kit.lattice(aid, col, heel, head, .7, .7, 12, .06, .035)
    for side in (-1, 1):
        kit.beam(aid, col, 'heel lug', V(side * .38, 10.35, 3.1), V(side * .38, 10.1, 2.7) + Vector((0, 0, 0)), .06, .3, 'naval')
    kit.boxc(aid, col, 'winch house', V(0, 10.9, 3.75), (1.0, .8, .9), 'naval')
    kit.boxc(aid, col, 'head block', head + Vector((-.15, 0, -.05)), (.55, .75, .5), 'naval')
    kit.part('rod', aid, col, 'head sheave', head + Vector((-.2, -.3, -.1)), head + Vector((-.2, .3, -.1)), .26, 'edge', vertices=12)
    mid = heel.lerp(head, .55)
    kit.boxc(aid, col, 'lift block', mid + Vector((0, 0, .45)), (.45, .45, .35), 'naval')
    top = V(0, 13.25, 3.1)
    kit.wire(aid, col, top, mid + Vector((0, 0, .55)), .02, False)
    kit.wire(aid, col, mid + Vector((0, 0, .55)), head + Vector((0, 0, .2)), .02, False)
    kit.wire(aid, col, head + Vector((-.2, 0, -.35)), head + Vector((-.2, 0, -4.2)), .015, False)
    kit.part('rod', aid, col, 'hook block', head + Vector((-.2, 0, -4.2)), head + Vector((-.2, 0, -4.6)), .13, 'edge', vertices=8)
    for s in (-1, 1):
        kit.boxc(aid, col, 'controls', V(s * 2.11, 9.42, 4.41), (.95, .7, 1.2), 'naval')


# ---------------------------------------------------------------- searchlights
def searchlights(D, kit):
    col = kit.collections['Sensors and masts']
    for i, (x, y, z, r) in enumerate([(-3.1, 15.2, -8.18, .5), (3.1, 15.2, -8.06, .5), (-2.69, 14.8, 7.04, .5), (2.69, 14.8, 7.16, .5),
                                      (-2.96, 15.2, -18.58, .34), (2.96, 15.2, -18.58, .34)], 1):
        aid = f'searchlight-{i}'
        c = V(x, y, z)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        h = 1.25 if r > .4 else .95
        kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, floor)), .25, h * .55, 'naval', 14)
        kit.boxc(aid, col, 'yoke', Vector((c.x, c.y, floor + h * .6)), (.35, r * 2.4, .15), 'naval')
        for t in (-1, 1):
            kit.boxc(aid, col, 'yoke arm', Vector((c.x, c.y + t * r * 1.15, floor + h * .6 + .3)), (.12, .1, .6), 'naval')
        barrel_c = Vector((c.x, c.y, floor + h * .6 + .45))
        kit.part('rod', aid, col, 'barrel', barrel_c + Vector((-.55, 0, 0)), barrel_c + Vector((.35, 0, 0)), r, 'naval', vertices=20)
        kit.part('rod', aid, col, 'lens', barrel_c + Vector((.35, 0, 0)), barrel_c + Vector((.4, 0, 0)), r * .88, 'glass', vertices=20)
        kit.part('rod', aid, col, 'lamp house', barrel_c + Vector((-.55, 0, 0)), barrel_c + Vector((-.75, 0, 0)), r * .6, 'edge', vertices=14)


# ---------------------------------------------------------------- deck gear
def deck_gear(D, kit):
    col = kit.collections['Deck fittings']
    aid = 'ground-tackle'
    # Stockless bow anchors as the reference houses them: the shank drawn into the hawse at the centre of a round
    # pocket (z -75.9, y 6.3, 1.6 m by 1.25 m), the crown standing just forward of it and the two flukes lying aft
    # along the flare; the hawse pipes lead up to the forecastle and the cables aft to the capstans.
    for s in (-1, 1):
        zc, yc = -75.88, 6.32
        surface_ring(kit, aid, col, s, zc, yc, .81, .62, .03, .055)
        surface_disc(kit, aid, col, 'hawse', s, zc + .1, yc, .3, .26, .01, 'black', 14)

        def on(z, y, lift):
            return V(s * (side_x(kit, z, y) + lift), y, z)
        kit.part('rod', aid, col, 'anchor shank', on(zc + .1, yc, -.2), on(zc + .1, yc, .3), .17, 'naval', vertices=10)
        kit.part('rod', aid, col, 'anchor crown', on(-75.78, 5.25, .2), on(-76.5, 7.05, .2), .18, 'naval', vertices=8)
        leaf(kit, aid, col, 'anchor fluke', s, (-76.3, 6.9), (-74.85, 7.5), .5, .2, .14)
        leaf(kit, aid, col, 'anchor fluke', s, (-75.85, 5.75), (-74.25, 6.02), .5, .2, .14)
        top = deck(kit, -74.4)
        hb = hull_half(kit, -75.8, 7.45)
        kit.part('rod', aid, col, 'hawse pipe', V(s * (hb - .25), 7.45, -75.8), V(s * 1.9, top + .05, -74.4), .2, 'edge', vertices=12)
        kit.cylz(aid, col, 'hawse lip', V(s * 1.9, top, -74.4), .32, .1, 'edge', 14)
        for i in range(9):
            z0 = -74.2 + i * (74.2 - 66.2) / 9
            z1 = -74.2 + (i + 1) * (74.2 - 66.2) / 9
            x0, x1 = 1.9 + (1.7 - 1.9) * i / 9, 1.9 + (1.7 - 1.9) * (i + 1) / 9
            kit.part('rod', aid, col, 'cable', V(s * x0, deck(kit, z0) + .06, z0), V(s * x1, deck(kit, z1) + .06, z1), .07, 'black', vertices=6)
        c = V(s * 1.7, 0, -65.53)
        f = kit.below(c.x, c.y, 8.5, 7.0)
        kit.cylz(aid, col, 'capstan', Vector((c.x, c.y, f)), .42, .55, 'naval', 16, r2=.36)
        kit.cylz(aid, col, 'capstan cap', Vector((c.x, c.y, f + .55)), .48, .12, 'edge', 16)
        for x, z in [(.83, -64.33), (.34, -65.13)]:
            c2 = V(s * x, 0, z)
            f2 = kit.below(c2.x, c2.y, 8.5, 7.0)
            kit.part('rod', aid, col, 'brake column', Vector((c2.x, c2.y, f2)), Vector((c2.x, c2.y, f2 + .7)), .06, 'edge', vertices=8)
            kit.cylz(aid, col, 'brake wheel', Vector((c2.x, c2.y, f2 + .7)), .22, .04, 'edge', 12)
    # Bollards and fairleads at the reference positions.
    for x, y, z in [(0.0, 7.94, -76.51), (2.5, 7.42, -68.84), (-2.51, 7.42, -68.84), (-5.01, 5.99, -47.45), (5.01, 5.99, -47.45), (-6.73, 4.76, -23.06),
                    (6.73, 4.76, -23.06), (-7.02, 4.17, 0.01), (7.02, 4.17, 0.01), (6.78, 3.97, 31.77), (-6.78, 3.97, 31.77), (5.99, 4.18, 54.2),
                    (-5.99, 4.18, 54.2), (-3.72, 4.52, 77.03), (3.72, 4.52, 77.03)]:
        c = V(x, 0, z)
        f = kit.below(c.x, c.y, y + .6, y - .5)
        kit.boxc('bollards', col, 'bollard base', Vector((c.x, c.y, f + .05)), (1.6, .55, .1), 'edge')
        for d in (-.5, .5):
            kit.cylz('bollards', col, 'bitt', Vector((c.x + d, c.y, f)), .18, .62, 'naval', 12)
    for x, y, z in [(2.47, 7.62, -73.1), (3.54, 7.0, -64.26), (4.96, 6.21, -52.43), (5.94, 5.6, -42.04), (7.0, 4.83, -26.83), (7.3, 4.46, -17.95),
                    (7.46, 4.11, -3.04), (7.46, 4.01, 5.94), (7.33, 3.86, 27.84), (7.23, 3.89, 36.57), (6.82, 4.02, 48.63), (6.1, 4.15, 58.43), (4.6, 4.37, 73.41)]:
        for s in (-1, 1):
            c = V(s * x, 0, z)
            f = kit.below(c.x, c.y, y + .6, y - .5)
            kit.boxc('fairleads', col, 'fairlead base', Vector((c.x, c.y, f + .05)), (.7, .3, .1), 'edge')
            for d in (-.2, .2):
                kit.cylz('fairleads', col, 'roller', Vector((c.x + d, c.y, f)), .11, .45, 'naval', 10)
    # Ventilators, reels, paravanes, hatches and gear lockers (reference part datums).
    for x, y, z, r, h in [(0.0, 7.72, -38.68, .45, .7), (-1.58, 3.83, 54.68, .6, 1.5), (1.58, 3.83, 54.68, .6, 1.5), (-1.4, 3.6, 63.79, .75, 1.85),
                          (0.0, 6.33, -1.26, .9, 2.2)]:
        c = V(x, 0, z)
        f = kit.below(c.x, c.y, y + 1.0, y - .5)
        kit.cylz('ventilators', col, 'trunk', Vector((c.x, c.y, f - .01)), r * .55, h * .78, 'naval', 16)
        kit.cylz('ventilators', col, 'head', Vector((c.x, c.y, f + h * .78)), r, h * .22, 'naval', 16, r2=r * .7)
    for x, y, z, big in [(-3.86, 6.83, -43.08, False), (3.15, 5.31, 32.69, False), (-3.15, 5.3, 32.69, False), (0.0, 6.73, 38.11, False),
                         (0.6, 7.09, -58.73, True), (4.13, 4.91, -12.97, True), (-5.86, 4.61, -4.78, True), (-5.86, 4.6, -2.98, True),
                         (3.58, 4.34, 34.52, True), (-3.56, 4.42, 41.86, True), (-1.05, 6.73, -47.31, True), (.91, 6.73, -47.16, False),
                         (2.68, 4.76, 39.86, True), (.94, 4.77, 45.12, True), (-.94, 4.93, 45.12, False)]:
        c = V(x, 0, z)
        f = kit.below(c.x, c.y, y + 1.0, y - 1.0)
        r = .62 if big else .32
        for d in (-.45, .45):
            kit.boxc('reels', col, 'reel cheek', Vector((c.x, c.y + d, f + r + .05)), (r * 2.1, .06, r * 2.1), 'edge')
        kit.part('rod', 'reels', col, 'drum', Vector((c.x, c.y - .42, f + r + .05)), Vector((c.x, c.y + .42, f + r + .05)), r * .75, 'canvas', vertices=14)
    for x, z in [(-4.27, -41.94), (4.27, -41.94)]:
        c = V(x, 0, z)
        f = kit.below(c.x, c.y, 8.0, 5.0)
        kit.part('rod', 'paravanes', col, 'paravane body', Vector((c.x + .9, c.y, f + .5)), Vector((c.x - 1.5, c.y, f + .5)), .2, 'naval', vertices=10)
        kit.boxc('paravanes', col, 'paravane plane', Vector((c.x - .2, c.y, f + .5)), (.8, 1.1, .04), 'naval')
        kit.boxc('paravanes', col, 'chock', Vector((c.x, c.y, f + .15)), (.3, .5, .3), 'edge')
    for x, y, z, w, l in [(0.0, 7.95, -78.76, .75, .9), (0.0, 7.48, -72.39, .75, .9), (.43, 5.93, -49.55, .75, .92), (-.48, 6.7, -61.37, .95, 1.45),
                          (.48, 4.18, 63.46, .9, 1.36), (-1.33, 4.29, 68.22, .9, 1.35), (-1.68, 4.38, 78.16, 1.01, .68)]:
        c = V(x, 0, z)
        f = kit.below(c.x, c.y, y + .6, y - .6)
        kit.boxc('hatches', col, 'hatch coaming', Vector((c.x, c.y, f + .15)), (l, w, .3), 'naval')
        kit.boxc('hatches', col, 'hatch lid', Vector((c.x, c.y, f + .32)), (l + .06, w + .06, .05), 'edge')
    # Stern smoke generators and the spare Mk 15 torpedoes stowed on the main deck forward of the tube mounts.
    for s in (-1, 1):
        c = V(s * 2.23, 0, 80.92)
        f = kit.below(c.x, c.y, 5.5, 3.9)
        kit.part('rod', 'smoke-generators', col, 'generator', Vector((c.x + .6, c.y, f + .55)), Vector((c.x - .6, c.y, f + .55)), .4, 'black', vertices=14)
        kit.boxc('smoke-generators', col, 'cradle', Vector((c.x, c.y, f + .1)), (1.0, .7, .2), 'edge')
        for y in (4.28, 4.96):
            a, b = V(s * 5.47, y, 1.4), V(s * 5.47, y, 8.3)
            kit.part('rod', 'spare-torpedoes', col, 'torpedo', a, b, .27, 'naval', vertices=12)
        c = V(s * 5.47, 0, 4.84)
        f = kit.below(c.x, c.y, 4.5, 3.4)
        for dz in (-2.4, 0, 2.4):
            kit.boxc('spare-torpedoes', col, 'rack', Vector((c.x + dz, c.y, (f + 4.96) / 2)), (.25, .7, 4.96 - f + .2), 'edge')
    # Bullnose fairleads either side of the stem head, through the bulwark at the deck edge (reference z -81.1 to
    # -82.1, y 7.5 to 8.3): a heavy rim round a dark opening.
    for sd in (-1, 1):
        zc, yc = -81.62, 7.92
        surface_disc(kit, 'bullnose', col, 'opening', sd, zc, yc, .37, .3, .03, 'black', 16)
        surface_ring(kit, 'bullnose', col, sd, zc, yc, .43, .36, .06, .065, 16)
    # Hull number 51 in white on both bows and quarters (the reference's default paint), 0.55 m high.
    hull_numbers(kit, col)
    # Jack staff stepped on the bulwark's stem head (reference z -82.5, up to 15.3 m) with a truck on top and two
    # stays down to the bulwark tops.
    kit.part('rod', 'staffs', col, 'jack staff', V(0, 8.78, -82.5), V(0, 15.2, -82.5), .06, 'naval', r2=.035, vertices=8)
    kit.boxc('staffs', col, 'jack staff truck', V(0, 15.32, -82.5), (.2, .2, .25), 'naval')
    for sd in (-1, 1):
        xt, yt = bulwark_top(kit, -80.75)
        kit.member('staffs', col, V(sd * (xt - .06), yt, -80.75), V(0, 11.5, -82.5), .03, 'naval', 6)
    # Stern light.
    post = V(0, 4.2, 81.95)
    post.z = kit.below(post.x, post.y, 5.0, 4.0)
    kit.part('rod', 'staffs', col, 'stern light post', post, post + Vector((0, 0, .95)), .04, 'naval', vertices=8)
    kit.boxc('staffs', col, 'stern light', post + Vector((0, 0, 1.05)), (.18, .13, .22), 'white')


# ---------------------------------------------------------------- markings
# Strokes of the numerals in a unit cell (u across, v up), read left to right.
DIGITS = {
    '5': [[(.71, 1.0), (.12, 1.0), (.07, .56), (.35, .62), (.6, .56), (.74, .38), (.71, .17), (.55, .03), (.3, 0.0), (.02, .08)]],
    '1': [[(.36, 1.0), (.36, 0.0)]],
}


def hull_numbers(kit, col):
    # Reference: 0.5-0.6 m numerals 0.7 m across, centred at z -69.3, y 3.81 on the bow and z 77.56, y 3.48 aft.
    size, stroke, gap = .55, .09, .83
    for zc, yc in ((-69.32, 3.81), (77.56, 3.48)):
        for sd in (-1, 1):
            vv, ff = [], []
            # Seen from abeam the number reads forward on starboard (bow on the right) and aft on port.
            along = -1 if sd > 0 else 1
            for k, ch in enumerate('51'):
                for line in DIGITS[ch]:
                    for (u0, v0), (u1, v1) in zip(line, line[1:]):
                        du, dv = u1 - u0, v1 - v0
                        L = math.hypot(du, dv) or 1
                        nu, nv = -dv / L * stroke / size / 2, du / L * stroke / size / 2
                        outer, inner = [], []
                        for u, v in ((u0 - nu, v0 - nv), (u1 - nu, v1 - nv), (u1 + nu, v1 + nv), (u0 + nu, v0 + nv)):
                            z = zc + along * ((k * gap + u) - (gap + .38) / 2) * size
                            y = yc + (v - .5) * size
                            hb = hull_half(kit, z, y)
                            outer.append(V(sd * (hb + .01), y, z))
                            inner.append(V(sd * (hb - .004), y, z))
                        base = len(vv)
                        vv += [tuple(q) for q in outer + inner]
                        ff += [(base, base + 1, base + 2, base + 3), (base + 7, base + 6, base + 5, base + 4)]
                        ff += [(base + i, base + 4 + i, base + 4 + (i + 1) % 4, base + (i + 1) % 4) for i in range(4)]
            ob = kit.mesh('hull-number.' + ('bow' if zc < 0 else 'quarter') + (' port' if sd < 0 else ' starboard'), vv, ff, 'white', col)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(ob.data)
            bm.free()
            kit.tag(ob, 'hull-numbers')


# ---------------------------------------------------------------- underwater
def underwater(D, kit):
    col = kit.collections['Underwater fittings']
    # Two three-bladed screws (reference cm001/cm032: 3.1 m, hubs at x +-3.05, y -4.96, z 68.1) on shafts that leave
    # the hull through long bossings (z 40 to 57) and run exposed to the struts.
    for s in (-1, 1):
        aid = 'screw-' + ('port' if s < 0 else 'starboard')
        x, y, z = s * 3.05, -4.96, 68.08
        c = V(x, y, z)
        kit.part('rod', aid, col, 'hub', c + Vector((.55, 0, 0)), c + Vector((-.45, 0, 0)), .42, 'bronze', r2=.36, vertices=14)
        kit.part('rod', aid, col, 'hub cone', c + Vector((-.45, 0, 0)), c + Vector((-.95, 0, 0)), .36, 'bronze', r2=.07, vertices=14)
        for k in range(3):
            a = math.pi / 6 + k * math.tau / 3
            ca, sa = math.cos(a), math.sin(a)
            sections = []
            for r, w in ((.34, .75), (.8, 1.05), (1.25, .95), (1.55, .5)):
                le = (c.x - w * .16, c.y + r * ca - w * sa * .5 * s, c.z + r * sa + w * ca * .5 * s)
                te = (c.x + w * .16, c.y + r * ca + w * sa * .5 * s, c.z + r * sa - w * ca * .5 * s)
                sections.append((le, te))
            vv = []
            for le, te in sections:
                for dx in (-.03, .03):
                    vv += [(le[0] + dx, le[1], le[2]), (te[0] + dx, te[1], te[2])]
            ff = []
            for i in range(len(sections) - 1):
                a0, b0 = 4 * i, 4 * (i + 1)
                ff += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, b0 + 2, b0 + 3, a0 + 3), (a0, b0, b0 + 2, a0 + 2), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
            last = 4 * (len(sections) - 1)
            ff += [(0, 2, 3, 1), (last, last + 1, last + 3, last + 2)]
            ob = kit.mesh(aid + '.blade', vv, ff, 'bronze', col)
            kit.tag(ob, aid)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(ob.data)
            bm.free()
        # Shaft from the bossing's end to the hub; the bossing is faired into the hull from z 40.5.
        kit.part('rod', aid, col, 'shaft', V(s * 2.95, -4.97, 56.8), c + Vector((.55, 0, 0)), .2, 'antifouling', vertices=12)
        for zz in (59.0, 61.5, 64.0):
            kit.part('rod', aid, col, 'shaft coupling', V(s * 2.97, -4.97, zz - .18), V(s * 2.97, -4.97, zz + .18), .27, 'antifouling', vertices=12)
        kit.part('rod', aid, col, 'bossing', V(s * 2.3, -4.2, 40.5), V(s * 2.95, -4.97, 57.0), .5, 'antifouling', r2=.3, vertices=14)
        # Struts: a single strut at 54.6 and an A-bracket just ahead of the screw, from the shaft up into the hull.
        for zz, offsets in ((54.6, [0.0]), (66.3, [-.9, .35])):
            sp = V(s * 3.02, -4.97, zz)
            for dx in offsets:
                tx = abs(3.02 + dx) * .8
                ty = next((yy for yy in [-4.9 + .05 * k for k in range(80)] if hull_half(kit, zz, yy) >= tx), -2.0)
                top = V(s * tx, ty + .2, zz)
                kit.beam(aid, col, 'strut', sp, top, .12, .45, 'antifouling')
    # Balanced rudder on the centreline abaft the screws (reference: z 69 to 74.9, y -2.0 to -6.6), with its stock.
    aid = 'rudder'

    def foil(y, z0, z1, t, n=10):
        up = [(z0 + (z1 - z0) * i / n, t * 2.6 * math.sqrt(max(0, i / n)) * (1 - i / n) ** 1.1) for i in range(n + 1)]
        right = [(w, y, z) for z, w in up]
        left = [(-w, y, z) for z, w in reversed(up[1:-1])]
        return [P(*p) for p in right + left]
    kit.loft(aid, col, 'rudder blade', [foil(-6.62, 69.4, 74.9, .22), foil(-2.2, 69.0, 74.9, .3)], 'antifouling', True, True, False)
    kit.part('rod', aid, col, 'rudder stock', V(0, -2.25, 70.3), V(0, -1.3, 70.3), .2, 'antifouling', vertices=12)
    # Bilge keels along the turn of the bilge (reference z -35 to 30), plates standing out and down.
    for s in (-1, 1):
        zs = [-35 + 65 * i / 10 for i in range(11)]
        pts = []
        for z in zs:
            hb = hull_half(kit, z, -4.6)
            pts.append((V(s * (hb - .05), -4.6, z), V(s * (hb + .45), -5.25, z)))
        vv, ff = [], []
        for (a, b) in pts:
            for p in (a, b):
                vv.append(tuple(p + Vector((0, 0, 0))))
        n = len(pts)
        faces = []
        for i in range(n - 1):
            faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        # Thicken by duplicating 3 cm to the fore-and-aft-normal side.
        off = [tuple(Vector(v) + Vector((0, 0, .03))) for v in vv]
        allv = vv + off
        m = len(vv)
        ff = faces + [tuple(m + k for k in reversed(f)) for f in faces]
        for i in range(n - 1):
            for e in ((2 * i, 2 * i + 2), (2 * i + 1, 2 * i + 3)):
                ff.append((e[0], e[1], m + e[1], m + e[0]))
        ff += [(0, 1, m + 1, m), (2 * n - 2, m + 2 * n - 2, m + 2 * n - 1, 2 * n - 1)]
        ob = kit.mesh('bilge keel', allv, ff, 'antifouling', col)
        kit.tag(ob, 'bilge-keels')
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(ob.data)
        bm.free()


def railings(D, kit):
    """Guard rails along the weather-deck edge; the gun arcs stay clear (Kit.in_arc), as removable rails would."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        zs = [-77.0 + i * 1.6 for i in range(int((81.5 + 77.0) / 1.6) + 1)]
        pts = []
        for z in zs:
            y = deck(kit, z)
            x = hull_half(kit, z, y - .03) - .12
            if x > .3:
                pts.append(V(s * x, y, z))
        for a, b in zip(pts, pts[1:]):
            for h in (.5, 1.0):
                kit.wire('railings', col, a + Vector((0, 0, h)), b + Vector((0, 0, h)), .016, True)
            kit.wire('railings', col, a, a + Vector((0, 0, 1.0)), .022, True)
        # Over the bow bulwark a single course 0.42 m above its top, run down onto it short of the stem.
        bow = []
        for z, h in ((-77.58, .42), (-78.6, .42), (-79.6, .42), (-80.6, .42), (-81.8, .04)):
            xt, yt = bulwark_top(kit, z)
            base = V(s * (xt - .06), yt, z)
            bow.append(base + Vector((0, 0, h)))
            if h > .1:
                kit.wire('railings', col, base, base + Vector((0, 0, h)), .022, True)
        kit.polyline('railings', col, [pts[0] + Vector((0, 0, 1.0))] + bow, .016, 'edge', 3)


def build(D, kit):
    bow_bulwark(kit)
    tubs(D, kit)
    funnels(D, kit)
    masts(D, kit)
    directors(D, kit)
    torpedo_mounts(D, kit)
    depth_charges(D, kit)
    boats(D, kit)
    crane(D, kit)
    searchlights(D, kit)
    deck_gear(D, kit)
    underwater(D, kit)
    railings(D, kit)
    kit.build_wires()

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
import atlanta_rails


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
    ('mk44-tub-port', (-5.61, -24.02, 1.2, 12), 7.06, 8.095),
    ('mk44-tub-starboard', (5.61, -24.02, 1.2, 12), 7.06, 8.095),
    ('mk44-tub-after', (0.0, 22.03, 1.2, 12), 11.12, 12.14),
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
        cx, cz, r, *n = shape
        return ring_pts(cx, cz, r, n[0] if n else 32)
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
    # The waist 20 mm galleries: a 0.1 m floor at the guns' datum (6.31 m) inside the double shield, over the 01 deck's
    # edge and cantilevered out past the deckhouse side on knees (reference sections at 5.0, 6.1 and 6.26 m).
    for s in (-1, 1):
        line = offset_line([(s * x, z) for x, z in WAIST_SHIELD], -.02 * s)
        made.append(kit.prism('aa-shield-waist-' + ('port' if s < 0 else 'starboard'), col, 'gallery floor', plan(line), 6.21, 6.31, 'naval', 'roof'))
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
    # Open-backed double splinter shield round each pair of waist 20 mm, from the gallery floor (6.21 m) to 7.33 m
    # (plan cuts at 6.26-7.32 m), thickened inboard; open below, where the spare torpedoes lie on the main deck.
    for s in (-1, 1):
        aid = 'aa-shield-waist-' + ('port' if s < 0 else 'starboard')
        line = [(s * x, z) for x, z in WAIST_SHIELD]
        pts = plan(line if s < 0 else line[::-1])
        kit.wall(aid, col, 'splinter shield', pts, 6.21, 7.33, .04, 'naval', closed=False)
        for a, b in zip(line, line[1:]):
            kit.member(aid, col, V(a[0], 7.33, a[1]), V(b[0], 7.33, b[1]), .025, 'naval', 6)
        # Knees at reference z 2.59, 6.63 and 9.83: a leg from the main deck by the ship's side (x 7.52), turning
        # inboard under the gallery into a beam to the deckhouse side (x 5.19); plain beams at 3.1 and 4.29.
        for z in (2.59, 6.63, 9.83):
            d = deck(kit, z)
            knee = [V(s * 7.52, d - .02, z), V(s * 7.52, 5.62, z), V(s * 7.38, 5.92, z), V(s * 7.05, 6.1, z), V(s * 6.6, 6.15, z)]
            for a, b in zip(knee, knee[1:]):
                kit.beam(aid, col, 'gallery knee', a, b, .12, .14, 'naval', up=(1, 0, 0))
            kit.beam(aid, col, 'gallery beam', V(s * 7.3, 6.14, z), V(s * 5.17, 6.14, z), .12, .14, 'naval', up=(1, 0, 0))
        for z in (3.1, 4.29):
            kit.beam(aid, col, 'gallery beam', V(s * 6.98, 6.14, z), V(s * 5.17, 6.14, z), .1, .12, 'naval', up=(1, 0, 0))


def offset_line(line, d):
    """A reference-frame (x, z) polyline pushed `d` to the right of its direction of travel."""
    out = []
    for i, (x, z) in enumerate(line):
        normals = []
        for a, b in ((line[i - 1] if i > 0 else None, (x, z)), ((x, z), line[i + 1] if i + 1 < len(line) else None)):
            if a is None or b is None:
                continue
            dx, dz = b[0] - a[0], b[1] - a[1]
            k = math.hypot(dx, dz)
            normals.append((dz / k, -dx / k))
        nx, nz = sum(n[0] for n in normals), sum(n[1] for n in normals)
        k = math.hypot(nx, nz) or 1
        out.append((x + nx / k * d, z + nz / k * d))
    return out


def bridge_bulwark(kit):
    """The open navigating bridge as the reference has it (plan cut at 15.7 m, sections at x 0.5 to 2.6): a 1 m
    bulwark from the bridge deck at 15.18 m round its forward part, the front at reference z -25.33, the sides
    stepping in from x 2.85 at z -24.7 to 2.0 at z -22.3 and running aft to z -20.2 where the deck stays open round
    the Mk 37 tower, with a capping bar 8 cm proud of its face; inside, the four sky-lookout chairs (am532) facing
    outboard with their binoculars and foot rails."""
    col = kit.collections['Superstructure']
    aid = 'bridge-bulwark'
    # Outer face, from the starboard after end forward, across and aft to port, so the wall thickens inboard.
    line = [(2.02, -20.2), (2.02, -22.3), (2.83, -24.66), (2.86, -25.33), (-2.86, -25.33), (-2.83, -24.66), (-2.02, -22.3), (-2.02, -20.2)]
    kit.wall(aid, col, 'bulwark', plan(line), 15.18, 16.08, .12, 'naval', closed=False)
    kit.wall(aid, col, 'capping', plan(offset_line(line, -.08)), 16.06, 16.18, .2, 'naval', closed=False)
    for x, z in ((1.43, -23.45), (1.09, -22.24)):
        for s in (-1, 1):
            lookout_chair(kit, s * x, 15.2, z)


def lookout_chair(kit, x, y, z):
    """A sky-lookout chair (reference am532, 0.93 x 1.24 x 0.62 m) at a reference-frame datum, facing outboard: a
    column with the seat and backrest, the binocular on its mount and a foot-rail frame round it."""
    col = kit.collections['Superstructure']
    lid = 'sky-lookouts'
    c = V(x, y, z)
    floor = kit.below(c.x, c.y, c.z + .3, c.z)
    out = Vector((0, -1 if x > 0 else 1, 0))           # authoring +Y is port: outboard of a starboard chair is -Y
    kit.cylz(lid, col, 'column', Vector((c.x, c.y, floor - .01)), .06, 1.0, 'naval', 8)
    kit.boxc(lid, col, 'seat', Vector((c.x, c.y, floor + .62)) - out * .12, (.34, .36, .05), 'naval')
    kit.boxc(lid, col, 'backrest', Vector((c.x, c.y, floor + .86)) - out * .3, (.34, .04, .42), 'naval')
    kit.boxc(lid, col, 'binocular mount', Vector((c.x, c.y, floor + 1.02)), (.18, .18, .1), 'edge')
    for t in (-.07, .07):
        kit.part('rod', lid, col, 'binocular', Vector((c.x + t, c.y, floor + 1.1)) - out * .12, Vector((c.x + t, c.y, floor + 1.1)) + out * .2, .045, 'dark', vertices=8)
    rail = [Vector((c.x + dx, c.y, floor + .3)) + out * dy for dx, dy in ((-.31, -.46), (.31, -.46), (.31, .46), (-.31, .46))]
    for a, b in zip(rail, rail[1:] + rail[:1]):
        kit.member(lid, col, a, b, .02, 'naval', 5)
    for q in rail:
        kit.member(lid, col, Vector((q.x, q.y, floor - .01)), q, .02, 'naval', 5)


def station_wall(kit, aid, col, pts, inside, y0, y1, thickness=.08):
    """A splinter wall on a runtime-frame (x, z) polyline, its outer face on the line and thickened toward the
    `inside` point, with a rolled lip along its top."""
    a = [Vector((-z, -x)) for x, z in pts]
    q = Vector((-inside[1], -inside[0]))
    d = a[1] - a[0]
    if d.x * (q.y - a[0].y) - d.y * (q.x - a[0].x) < 0:     # keep the inside on the left of travel
        a.reverse()
    kit.wall(aid, col, 'splinter wall', [tuple(v) for v in a], y0, y1, thickness, 'naval', closed=False)
    for u, v in zip(a, a[1:]):
        kit.member(aid, col, (u.x, u.y, y1), (v.x, v.y, y1), .03, 'naval', 6)


# The two lookout stations' walls (runtime frame x, z): the level tracing measured them as solid blocks, and the
# blueprint now keeps only their floors (author-blueprint.py).
BRIDGE_STATION = [(-1.4, -18.58), (-2.44, -17.94), (-2.48, -17.78), (-2.44, -15.38), (-2.38, -15.32), (2.38, -15.32), (2.44, -15.38),
                  (2.48, -17.38), (2.44, -17.94), (1.54, -18.48), (1.4, -18.62)]
AFTER_STATION = [(-2.23, 18.21), (-2.23, 14.77), (-2.31, 14.53), (-2.55, 14.25), (-2.55, 14.05), (-2.33, 13.71), (-2.05, 13.63), (-1.29, 12.99),
                 (-1.13, 12.99), (-.77, 13.39), (-.53, 13.47), (.55, 13.47), (.79, 13.39), (1.11, 13.03), (1.35, 13.03), (2.15, 13.71),
                 (2.35, 13.75), (2.57, 14.05), (2.57, 14.25), (2.29, 14.57), (2.21, 14.81), (2.21, 18.25)]


def lookout_stations(kit):
    """The bridge's aft lookout station (reference: walls x 2.35-2.45 from its 15.4 m floor to 16.4 m round the
    forward Mk 37 tower) and the after superstructure's (walls from its 11.5 m floor to 12.49 m forward of the after
    tower, and from the 02 deck to 12.14 m abaft it, stepping in to the after Mk 44's tub), each with its sky-lookout
    chairs: four on the bridge, two aft (am532 datums)."""
    col = kit.collections['Superstructure']
    station_wall(kit, 'bridge-lookout-station', col, BRIDGE_STATION, (0, -16.5), 15.395, 16.395)
    station_wall(kit, 'after-lookout-station', col, AFTER_STATION, (0, 16.0), 11.5, 12.495)
    for s in (-1, 1):
        # The station's after wall down to the 02 deck (1 cm abaft the floor's edge, so the two faces do not fight),
        # and the lower walls abaft it round to the tub.
        station_wall(kit, 'after-lookout-station', col, [(s * 2.23, 18.222), (s * 1.46, 18.742)], (0, 16.0), 11.035, 12.495)
        station_wall(kit, 'after-lookout-station', col, [(s * 2.21, 18.25), (s * 2.21, 21.05), (s * 1.19, 21.89)], (0, 20.5), 11.035, 12.14)
    for x, z in ((1.87, -16.0), (1.87, -17.77)):
        for s in (-1, 1):
            lookout_chair(kit, s * x, 15.4, z)
    for s in (-1, 1):
        lookout_chair(kit, s * 1.53, 11.5, 15.82)


# Outer face of the port waist shield (reference x, z), from its inboard end aft round both tubs to the forward end.
WAIST_SHIELD = [(3.95, 2.84), (5.16, 2.33), (5.82, 2.15), (6.59, 2.36), (7.15, 2.92), (7.36, 3.69), (7.15, 4.46), (6.59, 5.03), (5.82, 5.24),
                (5.82, 6.48), (6.59, 6.69), (7.15, 7.25), (7.36, 8.02), (7.15, 8.79), (6.59, 9.36), (5.82, 9.56), (5.16, 9.38), (3.98, 8.64)]


# ---------------------------------------------------------------- funnels
# Steam pipes (reference frame points, radius): from each funnel's base up to the reference's pipe ends.
STEAM_PIPES = {
    'forward-funnel': ([(-.22, 15.18, -7.72), (-.22, 18.3, -7.41), (-.22, 18.62, -7.12)], .11),
    'after-funnel': ([(1.085, 15.62, 8.54), (1.085, 20.26, 8.99)], .19),
}


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
        # The steam pipe where the reference runs it (reference frame): up the after face of the forward casing, a
        # little to port, to a short bend aft at 18.6 m; on the after funnel, clear of the casing's starboard quarter
        # to just above the rim.
        points, r = STEAM_PIPES[aid]
        for a, b in zip(points, points[1:]):
            kit.part('rod', aid, col, 'steam pipe', V(*a), V(*b), r, 'naval', vertices=10)
        end = V(*points[-1])
        d = (end - V(*points[-2])).normalized()
        kit.part('rod', aid, col, 'pipe mouth', end - d * .02, end + d * .08, r + .03, 'black', vertices=10)


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
    # The signal yard crosses on the pole's after face (reference z -12.83, where its wires end).
    for s in (-1, 1):
        taper(kit, aid, col, 'signal yard', (s * .15, 31.0, -12.83), (s * 7.8, 31.0, -12.83), .1, .05, 'naval', 8)
        kit.member(aid, col, V(0, 29.6, axis(29.6)), V(s * 4.0, 30.98, -12.83), .03, 'naval', 5)
        # Signal lamps at the yard arms (reference am049 at x 7.62).
        kit.cylz(aid, col, 'signal lamp', V(s * 7.62, 31.05, -12.83), .07, .24, 'dark', 8)
    kit.boxc(aid, col, 'wind vane', V(1.54, 31.25, -12.83), (.4, .1, .6), 'edge')
    # Outriggers where the reference has them and its wires end: aft level at 30.92 m to z -9.45 on a strut from the
    # mast at 28.9 m, forward from the mast at 30.75 m down to the forestay's end (29.62 m, z -16.22), held by a lift
    # from the masthead platform.
    kit.beam(aid, col, 'after outrigger', V(0, 30.92, axis(30.92)), V(0, 30.92, -9.45), .1, .12, 'naval')
    kit.member(aid, col, V(0, 28.91, axis(28.91)), V(0, 30.9, -10.01), .04, 'naval', 5)
    for s in (-1, 1):
        kit.member(aid, col, V(s * .3, 30.75, axis(30.75) - .05), V(0, 29.62, -16.22), .045, 'naval', 6)
        kit.member(aid, col, V(s * .3, 29.72, axis(29.72) - .05), V(0, 29.62, -16.22), .04, 'naval', 6)
    kit.member(aid, col, V(0, 29.66, -16.2), V(0, 32.8, -13.17), .014, 'edge', 4)
    # Masthead platform under the SC-1 (reference: 2.5 m square at 32.8 to 32.9 m, centred at z -13.01) on four
    # braces down to the pole at 31.92 m.
    kit.boxc(aid, col, 'masthead platform', V(0, 32.85, -13.01), (2.5, 2.5, .1), 'naval')
    for x, z in ((-.88, -13.88), (.88, -13.88), (-.88, -12.14), (.88, -12.14)):
        kit.member(aid, col, V(x * .1, 31.92, axis(31.92)), V(x, 32.8, z), .035, 'naval', 5)
    for s in (-1, 1):
        kit.cylz(aid, col, 'fighting light', V(s * 1.32, 32.4, -13.0), .1, .6, 'dark', 8)
    # The octagonal lookout cabinet on the pole's forward face (sections at 26.5 and 27.5 m: 0.9 m across about z
    # -14.12, 26.0 to 27.9 m with its flared band and lid) over a step on brackets at 25.1 m.
    kit.cylz(aid, col, 'lookout cabinet', V(0, 26.01, -14.12), .46, 1.2, 'naval', 8)
    kit.cylz(aid, col, 'cabinet band', V(0, 27.2, -14.12), .51, .41, 'naval', 8)
    kit.cylz(aid, col, 'cabinet lid', V(0, 27.61, -14.12), .46, .29, 'naval', 8, r2=.38)
    kit.boxc(aid, col, 'cabinet step', V(0, 25.13, -14.14), (.96, .6, .08), 'naval')
    for s in (-1, 1):
        kit.member(aid, col, V(s * .25, 25.09, -14.5), V(s * .12, 24.4, axis(24.4) - .2), .03, 'naval', 5)
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
    taper(kit, aid, col, 'pole', (0, 14.6, axis_m(14.6)), (0, 27.4, axis_m(27.4)), .18, .11, 'naval', 6)
    taper(kit, aid, col, 'topmast', (0, 27.3, axis_m(27.3)), (0, 28.75, axis_m(28.75)), .07, .04, 'naval', 8)
    kit.cylz(aid, col, 'foot collar', V(0, 14.6, axis_m(14.6)), .28, .3, 'naval', 6)
    # The reference's wire ends: the yard at 25.15 m across 9.1 m, a 1.88 m square masthead platform at 27.29 to
    # 27.39 m on four braces from 26.46 m, a small crosstree at 23.4 m and the gaff level at 24.8 m to z 13.14.
    for s in (-1, 1):
        taper(kit, aid, col, 'yard', (s * .06, 25.15, axis_m(25.15) + .1), (s * 4.57, 25.15, axis_m(25.15) + .1), .08, .04, 'naval', 8)
        kit.member(aid, col, V(s * .1, 23.42, 9.78), V(s * 1.04, 23.42, 9.78), .03, 'naval', 5)
    # The masthead platform: a twelve-sided grating in a rim, as the reference's.
    kit.cylz(aid, col, 'masthead platform', V(0, 27.29, 9.97), .94, .1, 'edge', 12)
    rim = [V(.95 * math.cos(math.tau * k / 12), 27.39, 9.97 + .95 * math.sin(math.tau * k / 12)) for k in range(12)]
    for a, b in zip(rim, rim[1:] + rim[:1]):
        kit.member(aid, col, a, b, .035, 'naval', 6)
    for x, z in ((-.64, 9.3), (.64, 9.3), (-.64, 10.65), (.64, 10.65)):
        kit.member(aid, col, V(x * .05, 26.46, axis_m(26.46)), V(x, 27.3, z), .03, 'naval', 5)
    taper(kit, aid, col, 'gaff', (0, 24.8, axis_m(24.8) + .1), (0, 24.8, 13.14), .07, .04, 'naval', 8)
    # Signal lamps (reference am049): at the yard arms, the crosstree ends and the masthead.
    for x, y, z in ((4.52, 25.2, 10.08), (-4.52, 25.2, 10.08), (1.1, 23.47, 9.79), (-1.1, 23.47, 9.79), (0, 28.62, 9.97)):
        kit.cylz(aid, col, 'signal lamp', V(x, y, z), .06, .24, 'dark', 8)
    kit.member(aid, col, V(0, 23.07, axis_m(23.07) + .1), V(0, 24.8, 12.54), .03, 'naval', 5)
    kit.boxc(aid, col, 'speed light', V(0, 18.0, axis_m(18.0) + .3), (.8, .28, .6), 'edge')
    kit.ladder(aid, col, V(0, 14.8, axis_m(14.8) + .32), V(0, 25.8, axis_m(25.8) + .28), (0, 1, 0), .34)


# ---------------------------------------------------------------- rigging
def rigging(D, kit):
    """Shrouds, stays, braces and the wire aerials as the reference strings them: ends read off its thin wire
    triangles (reference frame), each wire drawn straight and mirrored where the reference is."""
    col = kit.collections['Sensors and masts']

    def wire(aid, a, b, r=.016, mirror=True):
        for s in ((-1, 1) if mirror else (1,)):
            kit.member(aid, col, V(s * a[0], a[1], a[2]), V(s * b[0], b[1], b[2]), r, 'edge', 3)

    aid = 'foremast-rigging'
    for a, b in [((.07, 30.49, -13.4), (3.98, 12.57, -21.92)), ((.04, 30.49, -13.38), (3.61, 15.16, -17.88)),
                 ((.06, 30.68, -12.96), (3.8, 15.29, -9.32)), ((.1, 28.53, -13.57), (4.38, 13.58, -16.27))]:
        wire(aid, a, b, .022)
    wire(aid, (0, 29.66, -16.21), (0, 15.61, -29.62), .022, False)  # forestay from the forward outrigger
    wire(aid, (0, 30.79, -12.35), (1.4, 19.11, -9.25), .014, False)
    wire(aid, (1.4, 19.11, -9.25), (3.37, 10.79, -12.21), .014, False)
    wire(aid, (0, 30.92, -9.48), (0, 21.22, -10.71), .014, False)
    for a, b in [((7.53, 30.93, -12.87), (0, 29.72, -16.25)), ((7.71, 30.92, -12.81), (0, 30.94, -10.02)),
                 ((.1, 32.61, -13.05), (6.43, 30.96, -12.83))]:
        wire(aid, a, b, .014)
    # The foremast aerial fan: ten wires a side from the signal yard down to a spreader beside the bridge.
    aid = 'aerials'
    fan = [(.71, 2.65, 13.92, -11.52), (1.18, 2.74, 13.92, -11.85), (1.76, 2.84, 13.92, -12.34), (2.23, 2.94, 13.92, -12.85),
           (2.67, 3.03, 13.92, -13.39), (3.59, 3.11, 13.92, -13.81), (4.57, 3.17, 13.92, -14.24), (5.54, 3.21, 13.92, -14.74),
           (6.55, 3.27, 14.11, -15.27), (7.49, 3.3, 14.1, -15.79)]
    for xt, xb, yb, zb in fan:
        wire(aid, (xt, 30.89, -12.83), (xb, yb, zb), .012)
    wire(aid, (2.6, 13.92, -11.4), (3.33, 14.11, -15.9), .03)
    # Four long aerials from the foremast yard aft to the main yard, with their lead-ins down to the after deckhouses.
    for xf, xa in ((4.45, 2.59), (6.38, 4.52)):
        wire(aid, (xf, 30.9, -12.77), (xa, 25.19, 10.04), .012)
    wire(aid, (3.06, 26.65, 4.17), (1.57, 17.58, 7.12), .012)
    wire(aid, (1.57, 17.58, 7.12), (2.9, 10.67, 15.34), .012)
    wire(aid, (4.65, 25.64, 8.21), (2.33, 13.89, 9.04), .012)
    # The main-yard fan: four a side down to the after superstructure.
    for xt, xb, zb in ((1.65, .9, 13.42), (2.52, 1.23, 13.69), (3.39, 1.65, 14.03), (4.22, 2.07, 14.37)):
        wire(aid, (xt, 25.14, 10.09), (xb, 12.54, zb), .012)
    aid = 'mainmast-rigging'
    for a, b in [((.05, 24.88, 9.75), (2.4, 14.72, 5.3)), ((.05, 24.98, 9.97), (2.49, 8.76, 12.28))]:
        wire(aid, a, b, .02)
    for a, b in [((.07, 27.28, 10.0), (4.53, 25.2, 10.09)), ((4.56, 25.17, 10.11), (0, 24.81, 12.54))]:
        wire(aid, a, b, .014)
    wire(aid, (0, 27.25, 10.06), (0, 24.81, 12.55), .014, False)  # gaff peak halyard
    wire(aid, (0, 24.78, 13.1), (-1.04, 12.53, 13.54), .012, False)  # ensign halyard


# ---------------------------------------------------------------- fire control
def mk37(kit, did, x, y, z, face):
    """Mk 37 director house on its base plate, trained by the rig: sloped front with two rows of sighting hatches,
    roof hatches, the rangefinder through the house in canvas bags, an access trunk behind."""
    col = kit.collections['Sensors and masts']
    bx, by, bz = P(x, y, z)
    pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
    s = 1 if face == 0 else -1
    # The reference's 3.2 m base plate, 0.1 m thick, turning with the house.
    local(kit.cylz(did, col, 'roller ring', (bx, by, bz), 1.6, .1, 'edge', 40), pivot)
    # House as the reference's (sections and orthographic views): 2.85 m long, 2.88 m wide and 1.99 m tall on the
    # plate, the front upright for 1.0 m and then sloping back 1.12 m to the roof; the upright part's corners are
    # chamfered from the full breadth 1.12 m back to 0.31 m in at the front.
    L, W, H, V1, SB, BASE = 2.85, 2.88, 1.99, 1.0, 1.12, .1
    f, r = s * L / 2, -s * L / 2
    outline = [(r, -W / 2), (f - s * SB, -W / 2), (f, -W / 2 + .31), (f, W / 2 - .31), (f - s * SB, W / 2), (r, W / 2)]
    n = len(outline)

    def ring(h, back):
        return [(bx + px - s * (back if abs(px - f) < .5 else 0), by + py, bz + BASE + h) for px, py in outline]
    vv = ring(0, 0) + ring(V1, 0) + ring(H, SB)
    ff = [tuple(reversed(range(n))), tuple(range(2 * n, 3 * n))]
    ff += [(k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i) for k in (0, 1) for i in range(n)]
    house = kit.tag(kit.mesh(did + '.house', vv, ff, 'naval', col), did)
    bm = bmesh.new()
    bm.from_mesh(house.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(house.data)
    bm.free()
    local(house, pivot)
    up = Vector((-s * SB, 0, H - V1)).normalized()
    out = Vector((s * (H - V1), 0, SB)).normalized()
    foot = Vector((bx + f, by, bz + BASE + V1))          # the slope's lower edge on the centreline
    slope = math.hypot(SB, H - V1)
    back = Vector((-s, 0, 0))
    # Two rows of three sighting hatches on the slope, 0.66 m apart as the reference's: the upper row's lids hinged
    # at the roof edge and standing up to 20.9 m, the lower row's hinged at the slope's foot and hanging forward.
    for t in (-.66, 0, .66):
        for frac, lid in ((.72, 'up'), (.3, 'down')):
            c = foot + up * slope * frac + Vector((0, t, 0))
            local(kit.beam(did, col, 'sight hatch', c - up * .22 + out * .02, c + up * .22 + out * .02, .48, .06, 'naval'), pivot)
            local(kit.beam(did, col, 'sight window', c - up * .15 + out * .055, c + up * .15 + out * .055, .3, .02, 'dark'), pivot)
            if lid == 'up':
                hinge = foot + up * slope + Vector((0, t, 0)) + out * .06
                local(kit.beam(did, col, 'hatch lid', hinge, hinge + (back * .15 + Vector((0, 0, 1))).normalized() * .47, .44, .05, 'naval'), pivot)
            else:
                hinge = foot + Vector((0, t, 0)) + out * .06
                local(kit.beam(did, col, 'hatch lid', hinge, hinge + (-back * .4 + Vector((0, 0, -.35))).normalized() * .5, .44, .05, 'naval'), pivot)
    # Two closed roof hatches over the after part of the house.
    for t in (-.45, .45):
        local(kit.boxc(did, col, 'roof hatch', (bx + r + s * .55, by + t, bz + BASE + H + .03), (.5, .42, .06), 'naval'), pivot)
    # Rangefinder 0.4 m abaft the pivot at 19.85 m (reference), its arms reaching 2.385 m out through canvas bags
    # on the house sides (1.44 to 1.83 m out, 18.9 to 20.35 m), a round end with a lens window on each arm.
    rx, rh = bx - s * .4, bz + 1.5
    local(kit.part('rod', did, col, 'rangefinder', (rx, by - 2.33, rh), (rx, by + 2.33, rh), .15, 'naval', vertices=14), pivot)
    for t in (-1, 1):
        local(kit.part('rod', did, col, 'rangefinder end', (rx, by + t * 2.29, rh), (rx, by + t * 2.385, rh), .17, 'naval', vertices=14), pivot)
        local(kit.boxc(did, col, 'lens window', (rx + s * .15, by + t * 2.2, rh), (.03, .16, .16), 'dark'), pivot)
        local(kit.part('rod', did, col, 'end drum', (rx, by + t * 2.08, rh - .19), (rx, by + t * 2.08, rh - .06), .08, 'naval', vertices=10), pivot)
        rings = []
        for h, bulge, half in ((.5, .08, .2), (1.0, .3, .3), (1.45, .39, .3), (1.9, .32, .28), (2.0, .1, .2)):
            ring = []
            for k in range(10):
                a = math.tau * k / 10
                ring.append((rx + s * half * math.cos(a) * 1.0, by + t * (W / 2 - .02 + bulge * (.5 + .5 * math.sin(a))), bz + h))
            rings.append(ring)
        local(kit.loft(did, col, 'canvas bag', rings, 'canvas', True, True, True), pivot)
    # The access trunk on the back of the house (reference: 0.66 m wide, 0.52 m deep, 19.03 to 20.19 m) and its door.
    local(kit.boxc(did, col, 'rear trunk', (bx + r - s * .26, by, bz + 1.265), (.52, .66, 1.16), 'naval'), pivot)
    local(kit.boxc(did, col, 'rear door', (bx + r - s * .53, by, bz + 1.25), (.04, .5, .95), 'edge'), pivot)


def mk44(kit, did, x, y, z, bearing):
    """Mk 44 director for a 1.1-inch quad as the reference's ad075 (1.73 m across, 1.38 m deep, 1.89 m tall, read off
    orthographic renders): an octagonal plinth and a column, the sight head leaning back on a yoke with its dark
    lens, the 1.73 m sight bar across the top behind the head with a sight at each end, and the two operators'
    bucket seats either side of the column on brackets, with foot rails and pedals under them."""
    col = kit.collections['Sensors and masts']
    c = V(x, y, z)
    floor = kit.below(c.x, c.y, c.z + .2, c.z)
    rot = Matrix.Rotation(math.radians(-bearing), 3, 'Z')
    yaw = math.radians(-bearing)

    def at(f, a, h):
        """A point in the director's frame: f toward its facing, a across (to its left), h over the floor."""
        return Vector((c.x, c.y, floor)) + rot @ Vector((f, a, h))

    def box(label, f, a, h, size, material='naval'):
        kit.boxc(did, col, label, at(f, a, h), size, material, yaw)

    kit.cylz(did, col, 'plinth', at(0, 0, -.01), .42, .21, 'edge', 8)
    kit.cylz(did, col, 'plinth top', at(0, 0, .2), .42, .06, 'edge', 8, r2=.34)
    kit.cylz(did, col, 'collar', at(0, 0, .26), .3, .12, 'naval', 12)
    box('column foot', 0, 0, .44, (.46, .64, .16))
    box('column', 0, 0, .87, (.4, .4, 1.0))
    box('column back', -.2, 0, .78, (.2, .3, .7))
    # The step plate raked down behind the column.
    kit.beam(did, col, 'step plate', at(-.2, 0, .5), at(-.72, 0, .4), .45, .04, 'naval')
    # The yoke: a cross-head on the column and two arms up either side of the head.
    box('cross-head', 0, 0, 1.12, (.3, .84, .1))
    for s in (-1, 1):
        kit.beam(did, col, 'yoke arm', at(0, s * .38, 1.1), at(-.04, s * .38, 1.52), .08, .1, 'naval')
    # The sight head, leaning back, its lens on the forward face and the round sight behind.
    kit.beam(did, col, 'sight head', at(.02, 0, 1.3), at(-.14, 0, 1.86), .34, .3, 'naval')
    kit.beam(did, col, 'lens', at(.16, .05, 1.52), at(.1, .05, 1.76), .2, .03, 'dark')
    kit.part('rod', did, col, 'round sight', at(-.16, 0, 1.72), at(-.36, 0, 1.72), .09, 'naval', vertices=10)
    kit.part('rod', did, col, 'round sight lens', at(-.36, 0, 1.72), at(-.38, 0, 1.72), .07, 'dark', vertices=10)
    # The sight bar across the top, 0.25 m behind the column, with dark end plates and a sight at each end, the
    # upper bar over it and the braces down to the yoke.
    kit.part('rod', did, col, 'sight bar', at(-.25, -.83, 1.645), at(-.25, .83, 1.645), .065, 'naval', vertices=10)
    box('upper bar', -.25, 0, 1.78, (.06, 1.2, .05))
    for s in (-1, 1):
        kit.part('rod', did, col, 'bar end', at(-.25, s * .8, 1.645), at(-.25, s * .865, 1.645), .085, 'dark', vertices=10)
        box('bar sight', -.25, s * .75, 1.77, (.1, .1, .1), 'dark')
        kit.beam(did, col, 'bar brace', at(-.25, s * .55, 1.6), at(-.04, s * .38, 1.46), .05, .05, 'naval')
        kit.beam(did, col, 'upper brace', at(-.25, s * .6, 1.78), at(-.14, 0, 1.86), .04, .04, 'naval')
        kit.beam(did, col, 'bar post', at(-.25, s * .2, 1.58), at(-.25, s * .2, 1.78), .05, .05, 'naval')
        # The operator's bucket seat on a bracket from the column, its foot rail and pedals under it.
        kit.beam(did, col, 'seat bracket', at(.1, s * .2, .78), at(.18, s * .6, .7), .3, .08, 'naval')
        rings = []
        for h, half_f, half_a in ((.72, .2, .2), (1.15, .15, .11)):
            rings.append([tuple(at(.2 + df * half_f, s * .63 + da * half_a, h)) for df, da in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
        kit.loft(did, col, 'seat', rings, 'naval', True, True, False)
        kit.beam(did, col, 'hand rail', at(.2, s * .52, 1.12), at(.05, s * .38, 1.24), .03, .03, 'naval')
        for aa in (.45, .82):
            kit.part('rod', did, col, 'rail post', at(.3, s * aa, .72), at(.45, s * aa, .38), .015, 'naval', vertices=5)
        kit.part('rod', did, col, 'foot rail', at(.45, s * .44, .38), at(.45, s * .83, .38), .015, 'naval', vertices=5)
        for aa in (.52, .72):
            box('pedal', .5, s * aa, .33, (.2, .1, .12), 'edge')
            kit.part('rod', did, col, 'pedal post', at(.5, s * aa, 0), at(.5, s * aa, .28), .02, 'naval', vertices=5)


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
def spoon(kit, aid, col, start, length, r, thick=.035, material='naval', n=10):
    """The scarfed muzzle of a torpedo tube: an upper half-pipe that narrows to a lip over `length` (+X)."""
    rings = []
    for i in range(n + 1):
        t = i / n
        half = math.radians(90 - 62 * t ** 1.3)     # half the arc left of the tube, from 180 degrees to a 56-degree lip
        ring = []
        for k in range(9):
            a = math.pi / 2 - half + 2 * half * k / 8
            ring.append((start.x + length * t, start.y + math.cos(a) * r, start.z + math.sin(a) * r))
        rings.append(ring)
    m = len(rings[0])
    vv, ff = [], []
    for ring in rings:
        for (px, py, pz) in ring:
            vv.append((px, py, pz))
        for (px, py, pz) in ring:
            dy, dz = py - start.y, pz - start.z
            s = (r - thick) / r
            vv.append((px, start.y + dy * s, start.z + dz * s))
    for i in range(n):
        o0, o1 = 2 * m * i, 2 * m * (i + 1)
        for k in range(m - 1):
            ff.append((o0 + k, o1 + k, o1 + k + 1, o0 + k + 1))                   # outer skin
            ff.append((o0 + m + k, o0 + m + k + 1, o1 + m + k + 1, o1 + m + k))   # inner skin
        ff.append((o0, o0 + m, o1 + m, o1))                                        # the two cut edges
        ff.append((o0 + m - 1, o1 + m - 1, o1 + 2 * m - 1, o0 + 2 * m - 1))
    last = 2 * m * n
    ff.append(tuple([last + k for k in range(m)] + [last + m + k for k in reversed(range(m))]))
    ob = kit.mesh(aid + '.muzzle spoon', vv, ff, material, col)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return kit.tag(ob, aid)


def torpedo_mounts(D, kit):
    """Quadruple 21-inch Mk 14 mounts measured on the reference (HP_AGT_1/2): a training base, four 8.05 m tubes on
    saddles with bands, breech doors and scarfed muzzles, and the trainer's cylindrical cab over the breech end.
    The reference stows them trained aft; the game trains tubes from zero (forward), so each mount is authored as
    the reference's turned end for end about its pivot (muzzles 4.72 m ahead, breeches 3.33 m abaft, the cab 1.46 m
    abaft and 0.33 m outboard) and the rig trains it from there."""
    col = kit.collections['Torpedoes and depth charges']
    for launcher in D['torpedoLaunchers']:
        lid = launcher['id']
        x, y, z = R(launcher['position'])
        outboard = 1 if y > 0 else -1                 # authoring +Y is port
        floor = kit.below(x, y, z + .2, z)
        kit.cylz(lid, col, 'base ring', (x, y, floor - .01), 1.05, z - floor + .08, 'naval', 28)
        pivot = kit.empty(lid + '.yaw', (x, y, z), assembly=lid, col=col)
        local(kit.cylz(lid, col, 'turntable', (x, y, z + .08), 1.0, .12, 'edge', 28), pivot)
        # Training base under the tubes (reference: 2.1 m square, 3.77 to 4.11 m).
        local(kit.boxc(lid, col, 'training deck', (x, y, z + .27), (2.1, 2.1, .14), 'roof'), pivot)
        tubes = [t for t in D['torpedoTubes'] if t['launcherId'] == lid]
        mz = R(tubes[0]['position'])[2]
        breech_x = x - 3.326
        for xx in (-2.2, -.2, 1.6):
            local(kit.boxc(lid, col, 'tube saddle', (x + xx, y, (z + .34 + mz - .27) / 2), (.22, 2.5, mz - .27 - z - .34), 'edge'), pivot)
        for tube in tubes:
            tx, ty, tz = R(tube['position'])
            muzzle = Vector((tx, ty, tz))
            breech = Vector((breech_x, ty, tz))
            scarf = muzzle - Vector((2.1, 0, 0))
            local(kit.part('rod', lid, col, 'tube', breech, scarf, .3, 'naval', vertices=16), pivot)
            local(spoon(kit, lid, col, scarf, 2.1, .3), pivot)
            local(kit.part('rod', lid, col, 'tube mouth', scarf - Vector((.03, 0, 0)), scarf + Vector((.005, 0, 0)), .26, 'dark', vertices=16), pivot)
            # Breech door and locking ring flush with the tube end, as the reference's: nothing stands proud of the
            # 3.33 m breech end, which clears the waist deckhouse by 0.15 m at 60 and 120 degrees of train.
            local(kit.part('rod', lid, col, 'breech door', breech - Vector((.005, 0, 0)), breech + Vector((.08, 0, 0)), .305, 'edge', vertices=16), pivot)
            local(kit.part('rod', lid, col, 'breech ring', breech + Vector((.08, 0, 0)), breech + Vector((.2, 0, 0)), .318, 'edge', vertices=16), pivot)
            for xx in (1.31, .54, -.6):
                cband = Vector((x + xx, ty, tz))
                local(kit.part('rod', lid, col, 'tube band', cband - Vector((.05, 0, 0)), cband + Vector((.05, 0, 0)), .325, 'edge', vertices=16), pivot)
            kit.empty(tube['id'] + '.muzzle', tuple(muzzle - Vector(pivot.location)), pivot, lid, col)
        # The trainer's cab: a 2 m drum from the tube tops (4.78 m) to its roof (6.29 m), with sight ports forward
        # (toward the muzzles), a roof hatch and rungs up its after face.
        cx, cy = x - 1.461, y + outboard * .333
        local(kit.cylz(lid, col, 'cab', (cx, cy, 4.78), 1.0, 1.42, 'naval', 24), pivot)
        local(kit.cylz(lid, col, 'cab roof', (cx, cy, 6.2), .96, .09, 'naval', 24), pivot)
        local(kit.cylz(lid, col, 'cab hatch', (cx - .2, cy, 6.29), .3, .1, 'naval', 12), pivot)
        for dy in (-.45, 0, .45):
            local(kit.boxc(lid, col, 'sight port', (cx + math.sqrt(max(0, 1 - dy * dy)) - .01, cy + dy, 5.85), (.06, .3, .16), 'glass'), pivot)
        for h in (5.0, 5.3, 5.6, 5.9):
            local(kit.part('rod', lid, col, 'rung', (cx - 1.05, cy - .22, h), (cx - 1.05, cy + .22, h), .02, 'edge', vertices=6), pivot)


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
            # Stern roller track as the reference's agb187 (HP_AGB_7/8, bearing 171.7): two rails on a raked frame
            # from reference z 78.8 to 83.0, splayed 8.3 degrees so the after end stands 0.4 m further outboard
            # and overhangs the transom by 0.8 m, charges rolling aft to the release gate at its end.
            out = 1 if ry > 0 else -1                        # authoring +Y is port
            aft_end = Vector(P(-out * 1.35, 0, 83.0)[:2] + (0,))
            fwd = Vector((math.cos(math.radians(8.3)), -out * math.sin(math.radians(8.3)), 0))
            across = Vector((-fwd.y, fwd.x, 0))
            floor = kit.below(rx + 2.0, ry, rz_ + 1.5, rz_ - .3)
            L = 4.2

            def deck_under(q):
                try:
                    f = kit.support.below(q.x, q.y, floor + .3)
                except ValueError:
                    return None
                return f if f > floor - .3 else None
            # The charge rails, raked down aft, and the frame's two sides with their top rails, posts and ties,
            # empty as the reference shows them.
            for t in (-.42, .42):
                kit.member(lid, col, aft_end + fwd * L + across * t + Vector((0, 0, floor + 1.0)),
                           aft_end + across * t + Vector((0, 0, floor + .72)), .05, 'edge', 6)
            for t in (-.72, .72):
                top_a, top_b = aft_end + fwd * L + across * t + Vector((0, 0, floor + 1.5)), aft_end + across * t + Vector((0, 0, floor + 1.22))
                kit.member(lid, col, top_a, top_b, .045, 'naval', 6)
                kit.member(lid, col, top_a - Vector((0, 0, .5)), top_b - Vector((0, 0, .5)), .035, 'naval', 6)
                for k in range(6):
                    q = top_a.lerp(top_b, k / 5)
                    f = deck_under(q)
                    if f is not None:
                        kit.member(lid, col, q, Vector((q.x, q.y, f)), .045, 'naval', 6)
                kit.member(lid, col, top_b, aft_end + fwd * 1.1 + across * t + Vector((0, 0, floor)), .04, 'naval', 5)
            for k in range(6):
                q = aft_end + fwd * (L * k / 5)
                h = 1.5 - .28 * (1 - k / 5)
                kit.member(lid, col, q - across * .72 + Vector((0, 0, floor + h)), q + across * .72 + Vector((0, 0, floor + h)), .03, 'naval', 5)
                kit.member(lid, col, q - across * .72 + Vector((0, 0, floor + h - .55)), q + across * .72 + Vector((0, 0, floor + h - .55)), .03, 'naval', 5)
            g = aft_end + fwd * .05 + Vector((0, 0, floor + .78))
            kit.part('rod', lid, col, 'release gate', g - across * .5, g + across * .5, .05, 'naval', vertices=6)
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
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, material='naval', bottom=None, ends='transom', foredeck=.15,
         afterdeck=.08, thwarts=4, coaming=False, bottom_frac=.32):
    """Original open boat on its keel point c (authoring frame), bow toward +X: a lofted shell 5 cm thick, closed by
    decked ends and bulkheads round an open well, with its gunwale, floorboards and thwarts. `ends` is 'transom' (a
    launch's square stern), 'double' (a whaleboat, pointed at both ends) or 'pram' (a punt's raked square ends);
    `bottom` paints the hull below `bottom_frac` of its depth."""
    th = .05
    C = Vector(c)
    rot = Matrix.Rotation(heading, 3, 'Z')

    def W(p):
        return tuple(C + rot @ Vector(p))

    def section(t):
        x = (t - .5) * length
        if ends == 'pram':
            fore, aft = max(0, (t - .78) / .22), max(0, (.22 - t) / .22)
            half, rise, top = beam / 2 * (1 - .2 * max(fore, aft) ** 2), max(fore, aft) * .9, depth * (1 + .06 * max(fore, aft))
        else:
            fore = max(0, (t - .6) / .4)
            if ends == 'double':
                aft = max(0, (.4 - t) / .4)
                half, rise = beam / 2 * (1 - fore ** 1.7) * (1 - aft ** 1.7) + .02, max(fore, aft)
                top = depth * (1 + .15 * fore ** 2 + .1 * aft ** 2)
            else:
                aft = max(0, (.25 - t) / .25)
                half, rise, top = beam / 2 * (1 - fore ** 1.7) * (1 - .35 * aft ** 2) + .02, fore, depth * (1 + .15 * fore ** 2)
        outer, inner = [], []
        for k in range(9):
            a = math.pi * k / 8
            y = -half * math.cos(a)
            z = top - depth * .85 * math.sin(a) ** 1.4 * (1 - .4 * rise) - depth * .15
            outer.append((x, y, z))
            inner.append((x, y * max(0.0, (half - th) / half), z + th * math.sin(a)))
        return outer, inner

    ts = sorted(set([i / 20 for i in range(21)] + [afterdeck, 1 - foredeck]))
    ia, iw = ts.index(afterdeck), ts.index(1 - foredeck)
    rings = [section(t) for t in ts]
    vv, ff, mats = [], [], []

    def add(p):
        vv.append(W(p))
        return len(vv) - 1
    O = [[add(p) for p in o] for o, _ in rings]
    I = [[add(p) for p in inner] if ia <= i <= iw else None for i, (_, inner) in enumerate(rings)]
    low = min(p[2] for o, _ in rings for p in o) + depth * bottom_frac

    def face(f, outer_skin=False):
        ff.append(f)
        mats.append(1 if outer_skin and bottom and min(vv[i][2] for i in f) < C.z + low - 1e-6 and
                    sum(vv[i][2] for i in f) / len(f) < C.z + low else 0)
    for i in range(len(ts) - 1):
        for k in range(8):
            face((O[i][k], O[i][k + 1], O[i + 1][k + 1], O[i + 1][k]), True)
        if i < ia or i >= iw:
            face((O[i][0], O[i + 1][0], O[i + 1][8], O[i][8]))                 # the decked ends
        else:
            face((O[i][0], I[i][0], I[i + 1][0], O[i + 1][0]))                 # gunwale tops round the well
            face((O[i][8], O[i + 1][8], I[i + 1][8], I[i][8]))
            for k in range(8):
                face((I[i][k], I[i + 1][k], I[i + 1][k + 1], I[i][k + 1]))     # inside the well
    face(tuple(O[0]))
    face(tuple(O[-1]))
    face(tuple([O[ia][0]] + I[ia] + [O[ia][8]]))                               # bulkheads at the ends of the well
    face(tuple([O[iw][0]] + I[iw] + [O[iw][8]]))
    hull = kit.mesh(aid + '.boat hull', vv, ff, material, col)
    if bottom:
        hull.data.materials.append(kit.mat(bottom))
    for poly, m in zip(hull.data.polygons, mats):
        poly.material_index = m if bottom else 0
    bm = bmesh.new()
    bm.from_mesh(hull.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(hull.data)
    bm.free()
    kit.tag(hull, aid)
    # Gunwale capping, stem to stern.
    for k in (0, 8):
        for i in range(len(ts) - 1):
            kit.member(aid, col, Vector(vv[O[i][k]]) + Vector((0, 0, .02)), Vector(vv[O[i + 1][k]]) + Vector((0, 0, .02)), .035, 'naval', 6)
    if coaming:
        for k in (0, 8):
            for i in range(ia, iw):
                kit.member(aid, col, Vector(vv[I[i][k]]) + Vector((0, 0, .1)), Vector(vv[I[i + 1][k]]) + Vector((0, 0, .1)), .03, 'naval', 6)
        for i in (ia, iw):
            kit.member(aid, col, Vector(vv[I[i][0]]) + Vector((0, 0, .1)), Vector(vv[I[i][8]]) + Vector((0, 0, .1)), .03, 'naval', 6)

    def inner_half(i, z):
        """Half-breadth of the well at station i and local height z, or None where the bottom stands above it."""
        pts = rings[i][1]
        for a, b in zip(pts[:4], pts[1:5]):
            if min(a[2], b[2]) <= z <= max(a[2], b[2]) and abs(b[2] - a[2]) > 1e-9:
                return abs(a[1] + (b[1] - a[1]) * (z - a[2]) / (b[2] - a[2]))
        return None
    # Floorboards over the bottom of the well, 0.22 of the depth over the keel.
    zf = depth * .22
    strip = [(ts[i], inner_half(i, zf)) for i in range(ia, iw + 1)]
    strip = [(tt, h - .03) for tt, h in strip if h and h > .1]
    if len(strip) >= 2:
        fv = [W(((tt - .5) * length, s * h, zf + dz)) for dz in (0, .03) for tt, h in strip for s in (-1, 1)]
        m = len(strip)
        fl = []
        for j in range(m - 1):
            a, b = 2 * j, 2 * (j + 1)
            fl += [(a, b, b + 1, a + 1), (2 * m + a, 2 * m + a + 1, 2 * m + b + 1, 2 * m + b), (a, 2 * m + a, 2 * m + b, b), (a + 1, b + 1, 2 * m + b + 1, 2 * m + a + 1)]
        fl += [(0, 1, 2 * m + 1, 2 * m), (2 * m - 2, 4 * m - 2, 4 * m - 1, 2 * m - 1)]
        boards = kit.mesh(aid + '.floorboards', fv, fl, 'wood', col)
        bm = bmesh.new()
        bm.from_mesh(boards.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(boards.data)
        bm.free()
        kit.tag(boards, aid)
    # Thwarts across the well, 0.25 m under the gunwale.
    for j in range(thwarts):
        tt = ts[ia] + (ts[iw] - ts[ia]) * (j + 1) / (thwarts + 1)
        i = min(range(ia, iw + 1), key=lambda q: abs(ts[q] - tt))
        zt = rings[i][1][0][2] - .25
        h = inner_half(i, zt)
        if h:
            kit.boxc(aid, col, 'thwart', W(((tt - .5) * length, 0, zt)), (.22, 2 * h + .02, .05), 'naval', heading)

    def keel_at(dx):
        """Height of the keel over c at dx along the boat (for chocks and cradles)."""
        xs = [(tt - .5) * length for tt in ts]
        for j in range(len(ts) - 1):
            if xs[j] <= dx <= xs[j + 1]:
                u = (dx - xs[j]) / (xs[j + 1] - xs[j])
                return rings[j][0][4][2] * (1 - u) + rings[j + 1][0][4][2] * u
        return 0.0
    return hull, keel_at


def boats(D, kit):
    col = kit.collections['Boats']
    # Motor whaleboats abreast the bridge (reference: 8.4 m x 2.0 m, keel 6.63 m, gunwale 7.57 m, centred at x 6.13,
    # z -13.87), in chocks, under two davits stepped at the ship's side (z -10.21 and -17.19, x 7.85) whose arms
    # curve in over the boat to heads at 9.1 m, joined by a span wire.
    for s in (-1, 1):
        aid = 'whaleboat-' + ('port' if s < 0 else 'starboard')
        keel = V(s * 6.13, 6.63, -13.87)
        # Double-ended, decked forward and aft round a coamed well with the engine box and two thwarts, as the
        # reference's am091; its rudder hung on the sternpost.
        _, keel_at = boat(kit, aid, col, keel, 8.4, 2.0, .94, 0, 'naval', 'black', ends='double', foredeck=.3, afterdeck=.14,
                          thwarts=2, coaming=True, bottom_frac=.4)
        kit.boxc(aid, col, 'engine box', keel + Vector((-.4, 0, .62)), (1.0, .8, .55), 'naval')
        kit.boxc(aid, col, 'engine box lid', keel + Vector((-.4, 0, .91)), (1.04, .84, .04), 'edge')
        kit.boxc(aid, col, 'rudder', keel + Vector((-4.2, 0, .35)), (.4, .05, .6), 'black')
        for dz in (-2.4, 2.4):
            ck = V(s * 6.13, 0, -13.87 + dz)
            f = kit.below(ck.x, ck.y, keel.z + .3, keel.z - 1.5)
            top = keel.z + keel_at(-dz) + .04
            kit.boxc(aid, col, 'chock', Vector((ck.x, ck.y, (f + top) / 2)), (.3, 1.3, top - f), 'edge')
        heads = []
        for zz in (-10.21, -17.19):
            xe = min(7.85, hull_half(kit, zz, deck(kit, zz) - .05) - .12)
            foot = V(s * xe, deck(kit, zz) - .02, zz)
            arm = [V(s * xe, 8.25, zz), V(s * (xe - .13), 8.8, zz), V(s * (xe - .55), 9.1, zz), V(s * 6.7, 9.18, zz), V(s * 6.13, 9.12, zz)]
            kit.part('rod', aid, col, 'davit', foot, arm[0], .1, 'naval', vertices=10)
            for a, b in zip(arm, arm[1:]):
                kit.part('rod', aid, col, 'davit arm', a, b, .085, 'naval', vertices=8)
            kit.wire(aid, col, arm[-1] + Vector((0, 0, -.05)), V(s * 6.13, 7.62, zz), .016, False)
            heads.append((arm[-1], xe))
        kit.wire(aid, col, heads[0][0], heads[1][0], .014, False)
        # The strongback between the davits, level with the gunwale, and the two padded fenders the boat lies
        # against (reference: spar at 7.55 m with two dark pads).
        xs = min(h[1] for h in heads) - .02
        kit.part('rod', aid, col, 'strongback', V(s * xs, 7.55, -10.21), V(s * xs, 7.55, -17.19), .09, 'naval', vertices=8)
        for zz in (-12.2, -15.5):
            kit.boxc(aid, col, 'fender pad', V(s * (xs + 7.1) / 2, 7.55, zz), (.85, abs(xs - 7.1) + .04, .42), 'black')
    # 40 ft motor launches on the 01 deck between the funnels, in cradles under the crane (reference 12.25 m x 3.25 m),
    # the 12 ft punts stacked on the centreline between them.
    for s in (-1, 1):
        aid = 'motor-launch-' + ('port' if s < 0 else 'starboard')
        keel = V(s * 2.62, 6.85, -3.84)
        floor = kit.below(keel.x, keel.y, keel.z + .5, keel.z - .5)
        keel.z = max(keel.z, floor + .35)
        # As the reference's am096 (sheer 8.45 m, keel 6.87 m): decked ends round an open well with four thwarts and
        # floorboards, the engine box at the after end of the well, the coxswain's tubular guard on the stern deck, a
        # short mast forward, and the rudder and screw under the transom.
        _, keel_at = boat(kit, aid, col, keel, 12.25, 3.25, 1.9, 0, 'naval', 'black', ends='transom', foredeck=.19, afterdeck=.2,
                          thwarts=4, bottom_frac=.55)
        gunwale = 1.9 * .85
        kit.boxc(aid, col, 'engine box', keel + Vector((-2.4, 0, gunwale - .12)), (1.9, 1.35, .7), 'canvas')
        kit.boxc(aid, col, 'engine box lid', keel + Vector((-2.4, 0, gunwale + .25)), (1.95, 1.4, .05), 'naval')
        for dy in (-.65, .65):
            for dx in (-5.75, -4.55):
                kit.member(aid, col, keel + Vector((dx, dy, gunwale)), keel + Vector((dx, dy, gunwale + 1.0)), .025, 'naval', 6)
            kit.member(aid, col, keel + Vector((-5.75, dy, gunwale + 1.0)), keel + Vector((-4.55, dy, gunwale + 1.0)), .025, 'naval', 6)
            kit.member(aid, col, keel + Vector((-5.75, dy, gunwale + .55)), keel + Vector((-4.55, dy, gunwale + .55)), .02, 'naval', 6)
        for dx in (-5.75, -4.55):
            kit.member(aid, col, keel + Vector((dx, -.65, gunwale + 1.0)), keel + Vector((dx, .65, gunwale + 1.0)), .025, 'naval', 6)
        kit.part('rod', aid, col, 'mast', keel + Vector((5.5, 0, gunwale + .2)), keel + Vector((5.5, 0, gunwale + 1.3)), .03, 'naval', vertices=6)
        kit.boxc(aid, col, 'rudder', keel + Vector((-6.25, 0, .35)), (.5, .06, .65), 'black')
        kit.part('rod', aid, col, 'screw', keel + Vector((-5.75, 0, .32)), keel + Vector((-5.65, 0, .32)), .28, 'bronze', vertices=10)
        for dz in (-4.0, 0, 4.0):
            ck = V(s * 2.62, 0, -3.84 + dz)
            f = kit.below(ck.x, ck.y, keel.z + .3, keel.z - .6)
            top = keel.z + keel_at(-dz) + .04
            kit.boxc(aid, col, 'cradle', Vector((ck.x, ck.y, (f + top) / 2)), (.3, 1.9, top - f), 'edge')
    # Two 12 ft punts stacked on a rack between the launches (reference 3.66 m x 1.15 m, keels at 7.1 and 7.75 m).
    aid = 'punts'
    lower, upper = V(0, 7.07, -4.55), V(0, 7.75, -4.55)
    for dz in (-1.1, 1.1):
        foot = V(0, 0, -4.55 + dz)
        f = kit.below(foot.x, foot.y, 7.2, 5.5)
        kit.boxc(aid, col, 'rack', Vector((foot.x, foot.y, (f + lower.z + .06) / 2)), (.16, 1.0, lower.z + .06 - f), 'edge')
        kit.boxc(aid, col, 'chock', Vector((foot.x, foot.y, lower.z + .57)), (.14, .7, .16), 'edge')
    boat(kit, aid, col, lower, 3.66, 1.15, .55, 0, 'naval', None, ends='pram', foredeck=.07, afterdeck=.07, thwarts=2)
    boat(kit, aid, col, upper, 3.66, 1.15, .55, 0, 'naval', None, ends='pram', foredeck=.07, afterdeck=.07, thwarts=2)
    # Floater-net life rafts standing on edge against the deckhouse and sponson sides (each pushed inboard until it
    # meets the wall, on two brackets) and two flat on the quarterdeck.
    for x, y, z, flat in [(-7.54, 5.59, -22.57, False), (7.54, 5.59, -22.57, False), (-7.61, 7.9, -19.86, False), (7.61, 7.9, -19.86, False),
                          (-3.71, 10.22, -15.54, False), (3.71, 10.22, -15.54, False), (-2.41, 9.14, 21.09, False), (2.41, 9.14, 21.09, False),
                          (0.0, 4.11, 57.5, True), (0.0, 4.11, 59.49, True)]:
        c = V(x, y, z)
        if flat:
            f = kit.below(c.x, c.y, c.z + .3, c.z - .3)
            # The reference's two balsa floats on the quarterdeck: 3.86 x 2.13 m and 3.1 x 1.72 m.
            raft(kit, 'life-rafts', col, Vector((c.x, c.y, f + .2)), 3.86 if z < 58 else 3.1, 2.13 if z < 58 else 1.72, None)
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
    """Boat crane between the funnels as the reference's am491 (orthographic renders, reference frame): a pedestal on
    the 01 deck and a tapered kingpost to its sheave block at 15.9 m (axis z 3.05); the jib hinged at z 3.0, 9.6 m
    and raked forward 49 degrees to its head at z -4.5, 18.2 m, a lattice 1.8 m wide at the heel tapering to 0.5 m
    and 0.35 m deep; the topping lift through a floating block at z -2.7, 17.0 m, and the three-part hoist to the
    hook block."""
    col = kit.collections['Boats']
    aid = 'boat-crane'
    base = V(0, 8.9, 3.05)
    floor = kit.below(base.x, base.y, base.z + .2, base.z)
    kit.cylz(aid, col, 'pedestal flange', Vector((base.x, base.y, floor - .01)), .75, .13, 'naval', 20)
    kit.cylz(aid, col, 'pedestal', Vector((base.x, base.y, floor + .1)), .42, 9.95 - floor - .1, 'naval', 16)
    kit.part('rod', aid, col, 'kingpost', V(0, 9.9, 3.1), V(0, 15.45, 3.07), .36, 'naval', r2=.22, vertices=12)
    top = V(0, 15.65, 2.95)
    kit.part('rod', aid, col, 'kingpost block', top + Vector((0, -.17, 0)), top + Vector((0, .17, 0)), .3, 'naval', vertices=6)
    kit.beam(aid, col, 'block strap', V(0, 15.4, 3.07), top, .3, .12, 'naval')
    # The jib: four chords of a section tapering 1.8 -> 0.5 m across and 0.35 m deep, laced on its broad faces.
    heel, head = V(0, 9.6, 3.0), V(0, 18.2, -4.5)
    axis = (head - heel).normalized()
    across = Vector((0, 1, 0))
    up = axis.cross(across).normalized()
    if up.z < 0:
        up = -up

    def corner(u, sa, su):
        w = .9 + (.25 - .9) * u
        return heel.lerp(head, u) + across * sa * w + up * su * .175
    for sa in (-1, 1):
        for su in (-1, 1):
            kit.member(aid, col, corner(0, sa, su), corner(1, sa, su), .05, 'naval', 6)
    n = 12
    for i in range(n):
        u0, u1 = i / n, (i + 1) / n
        for su in (-1, 1):
            kit.member(aid, col, corner(u0, -1 if i % 2 else 1, su), corner(u1, 1 if i % 2 else -1, su), .03, 'naval', 5)
            kit.member(aid, col, corner(u1, -1, su), corner(u1, 1, su), .025, 'naval', 5)
        for sa in (-1, 1):
            kit.member(aid, col, corner(u1, sa, -1), corner(u1, sa, 1), .025, 'naval', 5)
    # Heel lugs and pin on the pedestal's forward face.
    for sa in (-1, 1):
        kit.beam(aid, col, 'heel lug', V(sa * .5, 9.25, 3.3), V(sa * .5, 9.75, 2.95), .08, .45, 'naval')
    kit.part('rod', aid, col, 'heel pin', V(-.62, 9.6, 3.0), V(.62, 9.6, 3.0), .09, 'edge', vertices=10)
    # Head: sheave block between the chords' ends, and the floating topping-lift block.
    kit.part('rod', aid, col, 'head block', head + Vector((0, -.2, 0)), head + Vector((0, .2, 0)), .32, 'naval', vertices=6)
    lift = V(0, 17.0, -2.7)
    kit.part('rod', aid, col, 'lift block', lift + Vector((0, -.17, 0)), lift + Vector((0, .17, 0)), .3, 'naval', vertices=6)
    for dy in (-.08, .08):
        kit.wire(aid, col, top + Vector((0, dy, .1)), lift + Vector((0, dy, .12)), .02, False)
    kit.wire(aid, col, lift + Vector((0, 0, .15)), head + Vector((0, 0, .2)), .02, False)
    kit.wire(aid, col, lift + Vector((0, 0, -.15)), head + Vector((0, 0, -.1)), .02, False)
    hook = V(0, 15.3, -4.75)
    for dy in (-.12, 0, .12):
        kit.wire(aid, col, head + Vector((0, dy, -.25)), hook + Vector((0, dy, .2)), .016, False)
    kit.part('rod', aid, col, 'hook block', hook + Vector((0, -.15, 0)), hook + Vector((0, .15, 0)), .24, 'naval', vertices=6)
    kit.part('rod', aid, col, 'hook shank', hook + Vector((0, 0, -.2)), hook + Vector((0, 0, -.65)), .04, 'edge', vertices=6)
    kit.part('rod', aid, col, 'hook', hook + Vector((0, 0, -.65)), hook + Vector((-.2, 0, -.9)), .04, 'edge', vertices=6)
    kit.part('rod', aid, col, 'hook tip', hook + Vector((-.2, 0, -.9)), hook + Vector((-.3, 0, -.7)), .035, 'edge', vertices=6)
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
    # Four paravanes as the reference's am077: two stowed upright on the main deck against the deckhouse (x 4.27,
    # 5.4 to 8.3 m) and two lying on the 01 deck (x 2.95, z -41.9 to -39.0), each a torpedo body with tail fins and
    # the kite plane across it near the nose.
    def paravane(tail, nose, plane_axis):
        d = (nose - tail).normalized()
        kit.part('rod', 'paravanes', col, 'paravane body', tail + d * .25, nose - d * .35, .19, 'naval', vertices=10)
        kit.part('rod', 'paravanes', col, 'paravane nose', nose - d * .35, nose, .19, 'naval', r2=.06, vertices=10)
        kit.part('rod', 'paravanes', col, 'paravane tail', tail, tail + d * .25, .08, 'naval', r2=.19, vertices=10)
        other = d.cross(plane_axis).normalized()
        for u in (plane_axis, other):
            kit.beam('paravanes', col, 'paravane fin', tail + d * .12 - u * .3, tail + d * .12 + u * .3, .22, .02, 'naval', up=d)
        k = tail.lerp(nose, .72)
        kit.beam('paravanes', col, 'kite plane', k - plane_axis * .52, k + plane_axis * .52, .7, .04, 'naval', up=d)
        for sgn in (-1, 1):
            kit.beam('paravanes', col, 'kite pad', k + plane_axis * sgn * .44, k + plane_axis * sgn * .56, .5, .16, 'edge', up=d)
    for s in (-1, 1):
        c = V(s * 4.27, 0, -41.94)
        f = kit.below(c.x, c.y, 8.0, 5.0)
        paravane(Vector((c.x, c.y, f + .05)), Vector((c.x, c.y, f + 2.9)), Vector((1, 0, 0)))
        kit.boxc('paravanes', col, 'paravane shoe', Vector((c.x, c.y, f + .03)), (.4, .4, .08), 'edge')
        # A strap from the body in to the deckhouse side.
        try:
            wall = kit.support.along(Vector((c.x, c.y, f + 2.2)), Vector((0, 1 if c.y < 0 else -1, 0)), 2.0)
            kit.member('paravanes', col, Vector((c.x, c.y, f + 2.2)), Vector((c.x, wall.y, f + 2.2)), .03, 'naval', 5)
        except ValueError:
            pass
        c2 = V(s * 2.95, 0, -40.45)
        f2 = kit.below(c2.x, c2.y, 9.0, 7.0)
        paravane(Vector((c2.x - 1.4, c2.y, f2 + .32)), Vector((c2.x + 1.4, c2.y, f2 + .32)), Vector((0, 0, 1)))
        for dx in (-.8, .6):
            kit.boxc('paravanes', col, 'chock', Vector((c2.x + dx, c2.y, f2 + .07)), (.2, .45, .16), 'edge')
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
        # Four smoke pots stacked two by two in a banded cradle, as the reference's am011 (1.0 x 1.3 x 1.6 m).
        for dy in (-.24, .24):
            for dz in (.36, .84):
                a, b = Vector((c.x + .75, c.y + dy, f + dz)), Vector((c.x - .75, c.y + dy, f + dz))
                kit.part('rod', 'smoke-generators', col, 'smoke pot', a, b, .23, 'naval', vertices=12)
        for dx in (-.4, .4):
            kit.boxc('smoke-generators', col, 'band', Vector((c.x + dx, c.y, f + .6)), (.06, 1.0, 1.0), 'edge')
        kit.boxc('smoke-generators', col, 'cradle', Vector((c.x, c.y, f + .06)), (1.6, .95, .12), 'edge')
        # Two spare Mk 15s a side (reference am496, 6.92 m), painted as the reference's: black bodies with grey
        # warhead noses aft, the afterbody tapering forward to the fins and the bronze screws.
        for y in (4.28, 4.96):
            aid = 'spare-torpedoes'
            kit.part('rod', aid, col, 'torpedo', V(s * 5.47, y, 2.9), V(s * 5.47, y, 7.72), .27, 'black', vertices=12)
            kit.part('rod', aid, col, 'afterbody', V(s * 5.47, y, 1.72), V(s * 5.47, y, 2.9), .12, 'black', r2=.27, vertices=12)
            kit.part('rod', aid, col, 'warhead', V(s * 5.47, y, 7.7), V(s * 5.47, y, 8.12), .27, 'naval', r2=.23, vertices=12)
            kit.part('rod', aid, col, 'nose', V(s * 5.47, y, 8.1), V(s * 5.47, y, 8.3), .23, 'naval', r2=.1, vertices=12)
            for k in range(4):
                a = math.radians(45 + 90 * k)
                off = Vector((0, math.cos(a), math.sin(a)))
                kit.beam(aid, col, 'fin', V(s * 5.47, y, 1.98) + off * .08, V(s * 5.47, y, 1.98) + off * .27, .3, .02, 'black', up=(1, 0, 0))
            kit.part('rod', aid, col, 'screw hub', V(s * 5.47, y, 1.52), V(s * 5.47, y, 1.74), .06, 'bronze', vertices=8)
            for k in range(4):
                a = math.radians(90 * k)
                off = Vector((0, math.cos(a), math.sin(a)))
                kit.beam(aid, col, 'screw blade', V(s * 5.47, y, 1.6) + off * .04, V(s * 5.47, y, 1.6) + off * .2, .09, .02, 'bronze', up=(1, 0, 0))
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
        # The centre bullnose through the stem head, seen from ahead as a dark opening either side of the stem bar.
        surface_disc(kit, 'bullnose', col, 'stem opening', sd, -82.4, 7.98, .13, .2, .02, 'black', 12)
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
    # Bilge keels along the turn of the bilge, measured on the reference's sections: from z -22.5 to 32.5, the tip
    # 0.9-1.1 m out from the root (z, tip half-breadth, tip height, root height), a wedge 0.24 m thick at the root.
    KEEL = [(-22.5, None, None, -3.34), (-20, 6.84, -4.34, -3.55), (-16, 7.0, -4.66, -3.88), (-12, 7.02, -4.86, -4.08),
            (-8, 7.04, -5.05, -4.27), (-4, 7.05, -5.16, -4.38), (6, 7.03, -5.2, -4.42), (10, 7.01, -5.12, -4.34),
            (14, 6.99, -5.0, -4.22), (18, 6.93, -4.86, -4.07), (22, 6.84, -4.69, -3.89), (26, 6.76, -4.47, -3.71),
            (30, 6.7, -4.21, -3.55), (32.5, None, None, -3.45)]
    for s in (-1, 1):
        vv, ff = [], []
        for z, tx, ty, ry in KEEL:
            if tx is None:
                tx, ty = hull_half(kit, z, ry) + .02, ry
            vv += [P(s * (hull_half(kit, z, ry + .12) - .04), ry + .12, z), P(s * (hull_half(kit, z, ry - .12) - .04), ry - .12, z), P(s * tx, ty, z)]
        for i in range(len(KEEL) - 1):
            u0, l0, t0, u1, l1, t1 = 3 * i, 3 * i + 1, 3 * i + 2, 3 * i + 3, 3 * i + 4, 3 * i + 5
            ff += [(u0, u1, t1, t0), (l0, t0, t1, l1), (u0, l0, l1, u1)]
        n = 3 * (len(KEEL) - 1)
        ff += [(0, 2, 1), (n, n + 1, n + 2)]
        ob = kit.mesh('bilge-keels.' + ('port' if s < 0 else 'starboard'), vv, ff, 'antifouling', col)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(ob.data)
        bm.free()
        kit.tag(ob, 'bilge-keels')


def railings(D, kit):
    """Guard rails along the weather-deck edge; the gun arcs stay clear (Kit.in_arc), as removable rails would."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        # Stanchions at the reference's 2.95 m pitch (section at 6.0 m: z -51.97, -49.1, -46.14 ...), from the bow
        # bulwark's foot to the stern.
        zs = [-77.0] + [-51.97 + 2.95 * k for k in range(-8, 46)] + [81.5]
        pts = []
        for z in zs:
            y = deck(kit, z)
            x = hull_half(kit, z, y - .03) - .12
            if x > .3:
                pts.append(V(s * x, y, z))
        # Three courses as the reference's deck-edge rails (0.33, 0.73 and 1.12 m over the deck). The reference has
        # none along the waist from reference z 11.2 to 26.4, where the torpedo tubes train out over the side; here
        # the gap starts at 10.0, because the muzzles, authored forward (torpedo_mounts), cross the deck edge at 10.7.
        def open_waist(p, q):
            za, zb = sorted((-p.x - ZS, -q.x - ZS))
            return zb > 10.0 and za < 26.39
        segments = list(zip(pts, pts[1:]))
        for i, (a, b) in enumerate(segments):
            if open_waist(a, b):
                continue
            for h in (.33, .73, 1.12):
                kit.wire('railings', col, a + Vector((0, 0, h)), b + Vector((0, 0, h)), .016, True)
            kit.wire('railings', col, a, a + Vector((0, 0, 1.12)), .022, True)
            if i + 1 < len(segments) and open_waist(*segments[i + 1]):
                kit.wire('railings', col, b, b + Vector((0, 0, 1.12)), .022, True)
        # Over the bow bulwark a single course 0.42 m above its top, run down onto it short of the stem.
        bow = []
        for z, h in ((-77.58, .42), (-78.6, .42), (-79.6, .42), (-80.6, .42), (-81.8, .04)):
            xt, yt = bulwark_top(kit, z)
            base = V(s * (xt - .06), yt, z)
            bow.append(base + Vector((0, 0, h)))
            if h > .1:
                kit.wire('railings', col, base, base + Vector((0, 0, h)), .022, True)
        kit.polyline('railings', col, [pts[0] + Vector((0, 0, 1.12))] + bow, .016, 'edge', 3)


def build(D, kit):
    bow_bulwark(kit)
    bridge_bulwark(kit)
    lookout_stations(kit)
    tubs(D, kit)
    funnels(D, kit)
    masts(D, kit)
    rigging(D, kit)
    directors(D, kit)
    torpedo_mounts(D, kit)
    depth_charges(D, kit)
    boats(D, kit)
    crane(D, kit)
    searchlights(D, kit)
    deck_gear(D, kit)
    underwater(D, kit)
    railings(D, kit)
    atlanta_rails.build(D, kit, V)
    kit.build_wires()

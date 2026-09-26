"""Omaha fittings: torpedo pockets and mounts, funnel caps, masts, directors, rangefinders, searchlights,
aviation, boats, deck gear and underwater gear.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the approved
GameModels3D pasc005 model and converted once by `P`; shapes are original approximations of the
reference's fittings at their measured sizes. No reference geometry is loaded.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix
from omaha_kit import P, R, ZSHIFT


def V(x, y, z):
    return Vector(P(x, y, z))


def local(ob, pivot):
    """Parent a freshly built object to an unrotated pivot, keeping its authored place."""
    ob.location = Vector(ob.location) - Vector(pivot.location)
    ob.parent = pivot
    return ob


def taper(kit, aid, col, label, a, b, r0, r1, material='naval', n=16):
    return kit.part('rod', aid, col, label, V(*a), V(*b), r0, material, r2=r1, vertices=n)


def hull_half(kit, zref, y):
    """Loft half-breadth at a reference z and height (from the compiled sections)."""
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZSHIFT)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])

            def w(sec):
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (y - y0) / (y1 - y0))
                return best if best else sec['points'][-1][0]
            return w(s0) * (1 - t) + w(s1) * t
    return 0.0


def deck(kit, zref):
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZSHIFT)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][-1][1] * (1 - t) + s1['points'][-1][1] * t
    return 6.0


# ---------------------------------------------------------------- torpedo pockets
# The forward torpedo mounts stand on the main deck in pockets let into the hull side under the upper deck
# (reference: 9.0 m long from z 20.55 to 29.55, 5 m deep to a back wall at x 4.0, floor 3.53 m, head 5.95 m).
POCKET = dict(z0=20.55, z1=29.55, back=4.0, floor=3.53, head=5.95)


def torpedo_pockets(D, kit, hull):
    for sign in (-1, 1):
        a = V(sign * POCKET['back'], POCKET['floor'], POCKET['z1'])
        b = V(sign * 12.0, POCKET['head'], POCKET['z0'])
        lo = [min(a[i], b[i]) for i in range(3)]
        hi = [max(a[i], b[i]) for i in range(3)]
        cutter = kit.box('pocket cutter', [(l + h) / 2 for l, h in zip(lo, hi)], [h - l for l, h in zip(lo, hi)], 'hullgray', kit.collections['Hull and decks'])
        # Kit.box winds its faces inward; the exact solver reads an inside-out cutter as empty and only scores the
        # hull, so turn its normals outward first.
        kit.solid(cutter)
        mod = hull.modifiers.new('pocket', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = hull
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    # The cut must leave each pocket's back wall (authoring y = -x); a failed boolean only scores the side.
    back = [v for v in hull.data.vertices if abs(abs(v.co.y) - POCKET['back']) < .01 and POCKET['floor'] - .01 <= v.co.z <= POCKET['head'] + .01]
    if len(back) < 8:
        raise RuntimeError(f'torpedo pockets: the boolean left {len(back)} back-wall vertices; the pockets were not cut')
    # Faces the cut made: walls and ceiling take the hull paint, the floor the deck paint (build.py sorts them).
    names = [m.name for m in hull.data.materials]
    return names


# ---------------------------------------------------------------- anchor recesses
# Each bower anchor lies in a recess let into the forecastle's deck edge (reference top and quarter views: 3.9 m long
# from z -76.35 to -72.45, its inboard wall slanting from x 2.30 forward to 1.65 aft, its floor sloping down
# outboard to about 0.95 m under the deck edge, where the anchor's lowest point stands at 8.58 m).
RECESS = dict(z0=-76.35, z1=-72.45, inboard=(2.30, 1.65), floor=9.05, slope=.265)


def recess_floor(x):
    """Height of the recess floor at reference |x| (a plane falling outboard)."""
    return RECESS['floor'] - (abs(x) - RECESS['inboard'][1]) * RECESS['slope']


def anchor_recesses(D, kit, hull):
    for sign in (-1, 1):
        (xf, xa), top = RECESS['inboard'], 11.5
        corners = [(xf, RECESS['z0']), (6.0, RECESS['z0']), (6.0, RECESS['z1']), (xa, RECESS['z1'])]
        vv = [tuple(V(sign * x, recess_floor(x) if level == 0 else top, z)) for level in (0, 1) for x, z in corners]
        ff = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        cutter = kit.solid(kit.mesh('anchor recess cutter', vv, ff, 'hullgray', kit.collections['Hull and decks']))
        mod = hull.modifiers.new('anchor recess', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = hull
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    # The cut must leave floor vertices on the recess's plane inside its length; a failed boolean leaves none.
    floor = [v for v in hull.data.vertices if -(RECESS['z1'] + ZSHIFT) - .01 <= v.co.x <= -(RECESS['z0'] + ZSHIFT) + .01
             and abs(v.co.z - recess_floor(-v.co.y)) < .02 and 1.6 < abs(v.co.y) < 3.8]
    if len(floor) < 4:
        raise RuntimeError(f'anchor recesses: the boolean left {len(floor)} floor vertices; the recesses were not cut')


def links(kit, aid, col, pts, material='black', pitch=.30):
    """A chain cable as alternate flat and upright links along a polyline (authoring points), merged into one mesh."""
    vv, ff = [], []
    path = [Vector(p) for p in pts]
    total = sum((b - a).length for a, b in zip(path, path[1:]))
    k, along = 0, 0.0
    while along <= total:
        rest, i = along, 0
        while i < len(path) - 2 and rest > (path[i + 1] - path[i]).length:
            rest -= (path[i + 1] - path[i]).length
            i += 1
        a, b = path[i], path[i + 1]
        d = (b - a).normalized()
        c = a + d * min(rest, (b - a).length)
        side = d.cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-6 else Vector((0, 1, 0))
        up = side.cross(d).normalized()
        w, h = (.20, .06) if k % 2 == 0 else (.06, .20)
        base = len(vv)
        for du in (-.19, .19):
            for sv, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                vv.append(tuple(c + d * du + side * (sv * w / 2) + up * (sw * h / 2 + h / 2 - .03)))
        ff += [(base + 3, base + 2, base + 1, base), (base + 4, base + 5, base + 6, base + 7), (base, base + 1, base + 5, base + 4),
               (base + 1, base + 2, base + 6, base + 5), (base + 2, base + 3, base + 7, base + 6), (base + 3, base, base + 4, base + 7)]
        k += 1
        along += pitch
    return kit.solid(kit.tag(kit.mesh(aid + '.chain cable', vv, ff, material, col), aid))


def anchor(kit, aid, col, sign):
    """A stockless bower anchor lying crown aft on its recess floor (reference CM036: 1.69 m across the flukes,
    3.2 m long): the crown, two flukes, the tapered shank and its shackle, in a frame tilted with the floor."""
    n = Vector((sign * RECESS['slope'], 1, 0)).normalized()        # floor normal, reference frame
    v = Vector((sign * 1, -RECESS['slope'], 0)).normalized()       # outboard along the floor
    u = Vector((0, 0, -1))                                         # forward
    ox = 2.80
    origin = Vector((sign * ox, recess_floor(ox), -72.90))
    at = lambda uu, vs, ww: Vector(P(*(origin + u * uu + v * vs + n * ww)))
    def block(label, u0, u1, v0, v1, w0, w1, material='naval'):
        pts = [at(uu, vs, ww) for ww in (w0, w1) for uu, vs in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]
        return kit.solid(kit.tag(kit.mesh(aid + '.' + label, [tuple(p) for p in pts],
                                          [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], material, col), aid))
    block('crown', -.18, .40, -.64, .64, 0, .30)
    for t in (-1, 1):
        root = [at(.35, t * vs, ww) for vs, ww in ((.16, 0), (.82, 0), (.82, .20), (.16, .20))]
        tip = [at(1.60, t * vs, ww) for vs, ww in ((.30, .04), (.64, .04), (.64, .14), (.30, .14))]
        kit.loft(aid, col, 'fluke', [[tuple(p) for p in root], [tuple(p) for p in tip]], 'naval', True, True, False)
    shank0 = [at(.30, vs, ww) for vs, ww in ((-.15, .04), (.15, .04), (.15, .32), (-.15, .32))]
    shank1 = [at(2.72, vs, ww) for vs, ww in ((-.11, .08), (.11, .08), (.11, .28), (-.11, .28))]
    kit.loft(aid, col, 'shank', [[tuple(p) for p in shank0], [tuple(p) for p in shank1]], 'naval', True, True, False)
    ring = [at(2.93 + .21 * math.cos(math.tau * k / 10), .13 * math.sin(math.tau * k / 10), .18) for k in range(10)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        kit.member(aid, kit.collections['Deck fittings'], a, b, .045, 'naval', 6)
    return at(3.14, 0, .12)


# ---------------------------------------------------------------- torpedo mounts
def torpedo_mounts(D, kit):
    """Triple 21-inch mounts (reference agt042): a pedestal and saddle carrying three tubes 8.0 m long, 0.69 m across
    and 0.732 m apart, their muzzles 3.23 m ahead of the pivot with flanged doors, their after ends tapered, clamped
    by bands; the trainer's sight post over the middle tube. Authored at zero train."""
    col = kit.collections['Torpedoes']
    for launcher in D['torpedoLaunchers']:
        lid = launcher['id']
        x, y, z = R(launcher['position'])
        floor = kit.below(x, y, z + .3, z)
        kit.cylz(lid, col, 'pedestal', (x, y, floor - .02), .62, z - floor + .02 + .12, 'naval', 24)
        pivot = kit.empty(lid + '.yaw', (x, y, z), assembly=lid, col=col)
        local(kit.cylz(lid, col, 'training ring', (x, y, z + .10), .74, .10, 'edge', 28), pivot)
        local(kit.cylz(lid, col, 'turntable', (x, y, z + .20), .55, .21, 'naval', 20), pivot)
        local(kit.boxc(lid, col, 'saddle', (x, y, z + .62), (1.10, 2.20, .42), 'naval'), pivot)
        tubes = [t for t in D['torpedoTubes'] if t['launcherId'] == lid]
        for tube in tubes:
            mx, my, mz = R(tube['position'])
            axis_y, axis_z = my, mz
            front = mx + .136            # flanged muzzle door, 3.36 m ahead of the pivot
            back = mx - 7.873            # after end, 4.65 m abaft the pivot
            taper_at = back + 3.0
            ring = 16
            prof = [(front, .345), (taper_at, .345), (back + .25, .23), (back, .20)]
            vv = [(px, axis_y + r * math.cos(math.tau * k / ring), axis_z + r * math.sin(math.tau * k / ring)) for px, r in prof for k in range(ring)]
            ff = [(j * ring + k, (j + 1) * ring + k, (j + 1) * ring + (k + 1) % ring, j * ring + (k + 1) % ring) for j in range(len(prof) - 1) for k in range(ring)]
            ff += [tuple(range(ring)), tuple(reversed(range((len(prof) - 1) * ring, len(prof) * ring)))]
            local(kit.solid(kit.tag(kit.mesh(lid + '.21-inch tube', vv, ff, 'naval', col, True), lid)), pivot)
            local(kit.part('rod', lid, col, 'muzzle door', (front - .02, axis_y, axis_z), (front + .06, axis_y, axis_z), .37, 'edge', vertices=16), pivot)
            local(kit.part('rod', lid, col, 'door hinge', (front + .02, axis_y - .38, axis_z - .12), (front + .02, axis_y - .38, axis_z + .12), .04, 'edge', vertices=6), pivot)
            for bx in (front - 1.9, front - 2.8, front - 4.1, front - 5.3):
                local(kit.part('rod', lid, col, 'tube band', (bx - .05, axis_y, axis_z), (bx + .05, axis_y, axis_z), .37, 'edge', vertices=16), pivot)
            kit.empty(tube['id'] + '.muzzle', tuple(Vector((mx, axis_y, axis_z)) - Vector(pivot.location)), pivot, lid, col)
        # Trainer's sight post and seat over the middle tube (reference 1.1 to 1.8 m).
        local(kit.boxc(lid, col, 'sight post', (x + .41, y - .37 * (1 if y > 0 else -1), z + 1.40), (.18, .18, .70), 'naval'), pivot)
        local(kit.part('rod', lid, col, 'sight', (x + .15, y - .37 * (1 if y > 0 else -1), z + 1.78), (x + .75, y - .37 * (1 if y > 0 else -1), z + 1.78), .05, 'edge', vertices=8), pivot)
        local(kit.boxc(lid, col, 'trainer seat', (x - .5, y - .37 * (1 if y > 0 else -1), z + 1.32), (.35, .35, .08), 'edge'), pivot)
        local(kit.part('rod', lid, col, 'seat post', (x - .5, y - .37 * (1 if y > 0 else -1), z + .80), (x - .5, y - .37 * (1 if y > 0 else -1), z + 1.30), .04, 'edge', vertices=6), pivot)


# ---------------------------------------------------------------- funnel caps
FUNNEL_GUYS = {'funnel-2': ((-17.2, 3.6), (-8.65, 2.8)), 'funnel-3': ((1.0, 3.6), (10.36, 3.6)), 'funnel-4': ((6.25, 3.6), (19.1, 3.6))}


def funnel_caps(D, kit):
    """Each funnel's rain cap: an eight-sided hood on four stays over the rim (reference: the cap's eave 0.33 m
    above the rim, 3.5 m across, rising to its crown)."""
    col = kit.collections['Superstructure']
    for s in D['structures']:
        ex = s.get('exhaust')
        if not ex:
            continue
        aid = s['id'] + '-cap'
        x, y, rim = R(ex['position'])  # authoring (fore-aft, athwart, up): the exhaust datum stands at the rim
        hx, hz = ex['length'] / 2, ex['width'] / 2
        ring0 = kit.disc_ring(8, hz + .14, (x, y, rim + .30), rx=hx + .14, phase=math.pi / 8)
        ring1 = kit.disc_ring(8, hz * .30, (x, y, rim + .62), rx=hx * .30, phase=math.pi / 8)
        kit.loft(aid, col, 'cap', [ring0, [(p[0], p[1], p[2] + .06) for p in ring0], ring1], 'black', True, True, False)
        for k in range(4):
            ang = math.tau * (k + .5) / 4
            px, py = x + (hx - .06) * math.cos(ang), y + (hz - .06) * math.sin(ang)
            kit.member(aid, kit.collections['Superstructure'], (px, py, rim - .25), (px, py, rim + .34), .05, 'black', 6)
        # A ladder up the forward face and a steam pipe up the after side, as the reference shows them.
        base = s['baseY']
        ang = 0.0
        wall = lambda a, off: (x + (hx + off) * math.cos(a), y + (hz + off) * math.sin(a))
        lx, ly = wall(ang, .16)
        across = (-math.sin(ang), math.cos(ang), 0)
        kit.ladder(s['id'] + '-ladder', col, (lx, ly, base + .9), (lx, ly, rim - .15), across, .40, .32, .03, .02)
        for a in (ang - .12, ang + .12):
            for hgt in (base + 1.5, (base + rim) / 2, rim - .6):
                px, py = wall(a, 0)
                qx, qy = wall(a, .17)
                kit.member(s['id'] + '-ladder', col, (px, py, hgt), (qx, qy, hgt), .025, 'naval', 5)
        px, py = wall(math.pi, .14)
        kit.part('rod', s['id'] + '-pipe', col, 'steam pipe', (px, py, base + .3), (px, py, rim + .22), .085, 'naval', vertices=10)
        for hgt in (base + 2.0, (base + rim) / 2, rim - 1.0):
            qx, qy = wall(math.pi, -.02)
            kit.member(s['id'] + '-pipe', col, (qx, qy, hgt), (px, py, hgt), .03, 'naval', 5)
        # Guys from eyeplates at 17.25 m, fore and aft either side, to the deck (Nos. 3 and 4 crossing between
        # them) and No. 2's after pair to the midships deckhouse roof (reference side and top views; reference x,
        # z of each landing). No. 1's wires lead to the foremast in the reference and are left out.
        for (zl, xl), fore in zip(FUNNEL_GUYS.get(s['id'], ()), (True, False)):
            for side in (-1, 1):
                gx, gy = wall(-side * (math.pi / 4 if fore else 3 * math.pi / 4), .02)
                foot = V(side * xl, 0, zl)
                foot.z = kit.below(foot.x, foot.y, 11.0, 6.0)
                kit.wire(s['id'] + '-guys', col, (gx, gy, 17.25), foot + Vector((0, 0, .03)), .012, False)
                kit.cylz(s['id'] + '-guys', col, 'guy plate', foot - Vector((0, 0, .01)), .07, .07, 'naval', 8)


# ---------------------------------------------------------------- masts
def foremast(D, kit):
    """Tripod foremast: the lower pole from the pilot house to the spotting top, two raked legs from the bridge
    deck, the lower top (a Y-shaped platform at 23.5 m with a lookout house), the signal truss and the spotting
    top round the Mk 7 director (floor 27.85 m), the topmast 1.7 m abaft the lower pole to the truck at 59.5 m, a
    lookout box and the signal yard (reference cuts every 2-5 m and its front view)."""
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    lower = lambda y: -41.90 + (y - 15.7) * .052
    upper = lambda y: -40.12 + (y - 27.3) * .078
    taper(kit, aid, col, 'lower pole', (0, 15.65, lower(15.65)), (0, 27.30, lower(27.30)), .44, .38)
    taper(kit, aid, col, 'topmast', (0, 27.25, upper(27.25)), (0, 45.0, upper(45.0)), .31, .19)
    taper(kit, aid, col, 'topgallant', (0, 45.0, upper(45.0)), (0, 59.55, -37.60), .19, .07)
    kit.part('cyl', aid, col, 'truck', V(0, 59.62, -37.6), .10, .14, 'naval', vertices=10)
    for s in (-1, 1):
        # Legs: (4.89, 10.35, -35.6) to the spotting top, 0.30 m across (fitted to the cuts at 19, 21 and 23 m).
        taper(kit, aid, col, 'leg', (s * 4.89, 10.30, -35.60), (s * .30, 27.30, -40.80), .30, .28)
        kit.part('cyl', aid, col, 'leg shoe', V(s * 4.89, 10.40, -35.60), .42, .16, 'naval', vertices=12)
    # Lower top: a Y-shaped platform (reference 23.45 m) with its rail, the searchlight on its forward tongue.
    ring = [(-2.5, -39.0), (-2.2, -38.5), (-1.3, -38.5), (0, -39.3), (1.3, -38.5), (2.2, -38.5), (2.5, -39.0), (2.5, -39.8),
            (1.2, -40.6), (1.1, -43.6), (.6, -44.5), (-.6, -44.5), (-1.1, -43.6), (-1.2, -40.6), (-2.5, -39.8)]
    pts = [V(x, 23.45, z)[:2] for x, z in ring]
    kit.prism(aid, col, 'lower top', pts, 23.40, 23.52, 'roof')
    kit.rail(aid, col, pts, 23.52, .95, 1.1, True, False)
    for s in (-1, 1):
        kit.member(aid, col, V(s * 1.8, 23.40, -38.8), V(s * .2, 22.2, -41.9), .06)
    # The lookout house on the lower top abaft the pole (reference 23.49-25.49 m, 5.2 m across, pointed forward to the
    # pole), its window band under the roof and a rail round the roof.
    house = [(-.55, -41.85), (.55, -41.85), (2.45, -40.1), (2.6, -39.6), (1.3, -38.8), (-1.3, -38.8), (-2.6, -39.6), (-2.45, -40.1)]
    kit.prism(aid, col, 'lower top house', [V(x, 0, z)[:2] for x, z in house], 23.50, 25.49, 'naval', 'roof')
    centre = sum((V(xx, 0, zz) for xx, zz in house), Vector()) / len(house)
    faces = [(s * x0, z0, s * x1, z1) for (x0, z0), (x1, z1) in zip(house[1:4], house[2:5]) for s in (1, -1)]
    faces.append((1.3, -38.8, -1.3, -38.8))  # the after face, once
    for x0, z0, x1, z1 in faces:
        a, b = V(x0, 25.1, z0), V(x1, 25.1, z1)
        n = Vector((-(b - a).y, (b - a).x, 0)).normalized()
        if n.dot((a + b) / 2 - Vector((centre.x, centre.y, 25.1))) < 0:
            n = -n
        d = (b - a).normalized()
        q = [a + d * .15 + n * .012 + Vector((0, 0, -.2)), b - d * .15 + n * .012 + Vector((0, 0, -.2)),
             b - d * .15 + n * .012 + Vector((0, 0, .2)), a + d * .15 + n * .012 + Vector((0, 0, .2))]
        kit.solid(kit.tag(kit.mesh('foremast.lower top house window', [tuple(p) for p in q] + [tuple(p - n * .02) for p in q],
                                   [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'glass', col), aid))
    kit.rail(aid, col, [V(x, 0, z)[:2] for x, z in house[1:] + house[:1]], 25.49, .9, 1.0, False, False)
    # Signal truss under the spotting top's after part and the spotting top itself: a floor at 27.85 m on knees from
    # the pole, a plated wall to 29.0 m round the director (reference 3.2 by 4.8 m), open windows between posts to the
    # roof at 30.3-30.45 m and a raised centre over the director to 30.9 m. The truss (reference 27.31-27.43 m, chords
    # 0.92 m apart, 14.1 m across) is laced like the mainmast's.
    ys = 27.37
    for zc in (-40.20, -39.28):
        kit.member(aid, col, V(-7.06, ys, zc), V(7.06, ys, zc), .06, 'naval', 6)
    xs = [-7.06 + 14.12 * k / 16 for k in range(17)]
    for k, x in enumerate(xs):
        kit.member(aid, col, V(x, ys, -40.20), V(x, ys, -39.28), .035, 'naval', 5)
        if k < 16:
            a, b = (-40.20, -39.28) if k % 2 == 0 else (-39.28, -40.20)
            kit.member(aid, col, V(x, ys, a), V(xs[k + 1], ys, b), .03, 'naval', 5)
    top = [V(x, 0, z)[:2] for x, z in [(-1.6, -39.2), (1.6, -39.2), (1.6, -44.0), (-1.6, -44.0)]]
    kit.prism(aid, col, 'spotting top floor', top, 27.25, 27.85, 'naval', 'roof')
    for s in (-1, 1):
        knee = [V(s * .8, 27.26, lower(27.2) - .3), V(s * .8, 27.26, -43.9), V(s * .8, 26.2, lower(26.2) - .3)]
        kit.solid(kit.tag(kit.mesh(aid + '.knee', [tuple(p + Vector((0, d, 0))) for d in (-.03, .03) for p in knee],
                                   [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], 'naval', col), aid))
    edges = [((-1.6, -39.2), (1.6, -39.2)), ((1.6, -39.2), (1.6, -44.0)), ((1.6, -44.0), (-1.6, -44.0)), ((-1.6, -44.0), (-1.6, -39.2))]
    for (x0, z0), (x1, z1) in edges:
        a, b = V(x0, 27.85, z0), V(x1, 27.85, z1)
        mid = (a + b) / 2
        length = (b - a).length
        along_x = abs(a.y - b.y) < 1e-6
        kit.boxc(aid, col, 'bulwark', Vector((mid.x, mid.y, 28.43)), (length if along_x else .05, .05 if along_x else length, 1.15), 'naval')
        n = max(2, round(length / .8))
        for k in range(n + 1):
            p = a.lerp(b, k / n)
            kit.boxc(aid, col, 'window post', Vector((p.x, p.y, 29.66)), (.07, .07, 1.32), 'naval')
    kit.prism(aid, col, 'spotting top roof', [V(x, 0, z)[:2] for x, z in [(-1.68, -39.12), (1.68, -39.12), (1.68, -44.08), (-1.68, -44.08)]],
              30.32, 30.45, 'naval', 'roof')
    # The roof rises from its eaves to a flat crown over the after part (reference side and front views: eaves
    # 30.41 m, crown 30.95 m, 1.58 m across, from the after edge to z -40.93), sloping down to the front and the sides.
    eaves = [(-1.62, -39.15), (1.62, -39.15), (1.62, -44.02), (-1.62, -44.02)]
    crown = [(-.79, -39.15), (.79, -39.15), (.79, -40.93), (-.79, -40.93)]
    kit.loft(aid, col, 'spotting top roof slopes', [[tuple(V(x, 30.44, z)) for x, z in eaves], [tuple(V(x, 30.95, z)) for x, z in crown]],
             'naval', True, True, False)
    # Lookout box forward of the topmast.
    kit.boxc(aid, col, 'lookout', V(0, 45.2, -40.25), (.72, .72, 1.25), 'naval')
    kit.member(aid, col, V(0, 44.6, -39.9), V(0, 44.6, upper(44.6)), .05)
    # The signal yard at 42.3 m, 13.7 m across, carrying eight signal lamps (reference front view, AM071 datums).
    for s in (-1, 1):
        kit.part('rod', aid, col, 'signal yard', V(0, 42.29, -39.25), V(s * 6.85, 42.29, -39.25), .08, 'naval', r2=.045, vertices=8)
        for xc in (2.635, 3.715, 4.805, 5.89):
            kit.boxc(aid, col, 'signal lamp', V(s * xc, 42.50, -39.36), (.18, .22, .30), 'naval')
            kit.part('cyl', aid, col, 'signal lamp hood', V(s * xc, 42.69, -39.36), .10, .07, 'edge', vertices=10)
            kit.boxc(aid, col, 'signal lamp lens', V(s * xc, 42.50, -39.46), (.02, .14, .14), 'glass')
        # Lifts from the mast over the lookout box to the yard arms.
        kit.wire(aid, col, V(0, 46.0, upper(46.0)), V(s * 6.8, 42.33, -39.25), .012, False)
    kit.ladder(aid, col, V(0, 15.9, lower(15.9) + .4), V(0, 27.2, lower(27.2) + .4), (0, 1, 0), .38)
    # Standing rigging: shrouds to the deck edge, and the two forestays that the reference leads down from the
    # masthead and the lower yard to the forward shelter's roof (thin, merged). The aerials are drawn by mainmast().
    for s in (-1, 1):
        for zz in (-40.0, -37.0, -34.0):
            kit.wire(aid, col, V(0, 43.5, upper(43.5)), V(s * 7.3, 8.1, zz), .012, False)
        kit.wire(aid, col, V(s * 6.9, 27.37, -39.74), V(s * 7.2, 8.2, -31.0), .012, False)
    for y in (58.4, 41.9):
        kit.wire(aid, col, V(0, y, upper(y)), V(0, 14.80, -52.6), .014, False)


def mainmast(D, kit):
    """Pole mainmast on the upper deck just forward of the after superstructure (reference: 0.33 m at 19 m, 0.035 m at
    the truck at 67.3 m, 3.7 degrees of rake), the boat derrick post and boom forward of it, a lookout box, yards and
    a gaff for the ensign."""
    col = kit.collections['Sensors and masts']
    aid = 'mainmast'
    pole = lambda y: 33.20 + (y - 19.0) * .066
    base = kit.below(*V(0, 0, pole(6.0))[:2], 12.0, 6.0)
    taper(kit, aid, col, 'pole', (0, base - .05, pole(base)), (0, 24.5, pole(24.5)), .38, .31)
    taper(kit, aid, col, 'topmast', (0, 24.5, pole(24.5)), (0, 50.0, pole(50.0)), .31, .13)
    taper(kit, aid, col, 'topgallant', (0, 50.0, pole(50.0)), (0, 67.3, 36.39), .13, .035)
    kit.part('cyl', aid, col, 'truck', V(0, 67.36, 36.39), .07, .12, 'naval', vertices=10)
    kit.part('cyl', aid, col, 'mast band', V(0, 24.5, pole(24.5)), .39, .30, 'naval', vertices=14)
    kit.boxc(aid, col, 'deck house', V(0, base + .95, pole(base) - .2), (1.3, 1.3, 1.9), 'naval')
    post = kit.below(*V(0, 0, 31.96)[:2], 12.0, 6.0)
    taper(kit, aid, col, 'derrick post', (0, post - .05, 31.96), (0, 24.6, 31.96), .17, .10)
    # The post is braced to the mast by a triangular bracket at 20.5 m (reference side view), not at its head.
    kit.member(aid, col, V(0, 20.55, 32.02), V(0, 20.55, pole(20.55) - .25), .06)
    kit.member(aid, col, V(0, 20.55, 32.02), V(0, 19.45, pole(19.45) - .28), .05)
    kit.beam(aid, col, 'post bracket', V(0, 20.25, 32.05), V(0, 20.25, pole(20.25) - .28), .03, .55, 'naval')
    # Lower lookout station abaft the pole (reference 15.71-17.71 m, 1.9 m across, z 33.62 to 34.55) on a floor plate
    # that reaches forward to the pole, its window band over a sill at 17.0 m.
    kit.boxc(aid, col, 'lower lookout floor', V(0, 15.77, 33.72), (1.30, 1.95, .12), 'naval')
    kit.boxc(aid, col, 'lower lookout', V(0, 16.77, 34.085), (.93, 1.90, 1.88), 'naval')
    kit.boxc(aid, col, 'lower lookout roof', V(0, 17.735, 34.085), (1.01, 1.98, .05), 'edge')
    kit.boxc(aid, col, 'lower lookout sill', V(0, 17.02, 34.085), (1.03, 2.00, .06), 'naval')
    for t in (-1, 1):
        kit.boxc(aid, col, 'lower lookout window', V(t * .955, 17.38, 34.085), (.72, .02, .46), 'glass')
    kit.boxc(aid, col, 'lower lookout window', V(0, 17.38, 34.555), (.02, 1.5, .46), 'glass')
    # Upper lookout: a platform either side of the pole at 41.76-41.89 m and a narrow box abaft it to 43.95 m
    # (reference z 35.25 to 36.05, 0.66 m across) with its window band, the yard under it.
    kit.boxc(aid, col, 'lookout platform', V(.25, 41.825, 34.40), (2.0, 1.05, .13), 'naval')
    kit.rail(aid, col, [V(x, 0, z)[:2] for x, z in [(-.26, 35.35), (-.26, 33.42), (.76, 33.42), (.76, 35.35)]], 41.89, .9, .7, False, False)
    kit.boxc(aid, col, 'lookout', V(0, 42.855, 35.65), (.80, .66, 2.19), 'naval')
    kit.boxc(aid, col, 'lookout roof', V(0, 43.97, 35.65), (.88, .74, .05), 'edge')
    for t in (-1, 1):
        kit.boxc(aid, col, 'lookout window', V(t * .335, 43.48, 35.65), (.56, .02, .55), 'glass')
    kit.boxc(aid, col, 'lookout window', V(0, 43.48, 36.055), (.02, .5, .55), 'glass')
    kit.part('rod', aid, col, 'yard', V(-6.7, 41.55, pole(41.55) + .15), V(6.7, 41.55, pole(41.55) + .15), .075, 'naval', r2=.045, vertices=8)
    kit.part('rod', aid, col, 'top yard', V(-4.1, 58.55, pole(58.55) + .1), V(4.1, 58.55, pole(58.55) + .1), .05, 'naval', r2=.035, vertices=8)
    # Signal truss at 25.34 m: two chords 0.8 m apart either side of the pole, 13.3 m across, laced (reference 25.26-25.42 m).
    ys = 25.34
    for zc in (33.46, 34.27):
        kit.member(aid, col, V(-6.66, ys, zc), V(6.66, ys, zc), .06, 'naval', 6)
    xs = [-6.66 + 13.32 * k / 14 for k in range(15)]
    for k, x in enumerate(xs):
        kit.member(aid, col, V(x, ys, 33.46), V(x, ys, 34.27), .035, 'naval', 5)
        if k < 14:
            a, b = (33.46, 34.27) if k % 2 == 0 else (34.27, 33.46)
            kit.member(aid, col, V(x, ys, a), V(xs[k + 1], ys, b), .03, 'naval', 5)
    for s in (-1, 1):
        kit.wire(aid, col, V(0, 29.0, pole(29.0)), V(s * 6.3, ys + .05, 33.86), .012, False)
    kit.part('rod', aid, col, 'gaff', V(0, 26.0, pole(26.0)), V(0, 27.9, 38.2), .07, 'naval', r2=.045, vertices=8)
    kit.ladder(aid, col, V(0, base + 2.0, pole(base + 2.0) + .4), V(0, 44.0, pole(44.0) + .4), (1, 0, 0), .36)
    # Shrouds from the masthead and the yard arm, bunched on chain plates at the deck edge just forward of the after
    # torpedo mounts' muzzles, as the reference leads them; there they stay out of the tubes' swing.
    for s in (-1, 1):
        for zz in (31.1, 31.6, 32.1):
            foot = V(s * (hull_half(kit, zz, 6.0) - .18), 0, zz)
            foot.z = kit.below(foot.x, foot.y, 7.0, 6.0)
            kit.wire(aid, col, V(0, 50.0, pole(50.0)), foot + Vector((0, 0, .05)), .012, False)
            kit.boxc(aid, col, 'chain plate', foot + Vector((0, 0, .06)), (.16, .06, .12), 'naval')
        foot = V(s * (hull_half(kit, 32.55, 6.0) - .18), 0, 32.55)
        foot.z = kit.below(foot.x, foot.y, 7.0, 6.0)
        kit.wire(aid, col, V(s * 6.5, 41.55, pole(41.55) + .15), foot + Vector((0, 0, .05)), .012, False)
        kit.boxc(aid, col, 'chain plate', foot + Vector((0, 0, .06)), (.16, .06, .12), 'naval')
    # Two backstays from the masthead and the upper yard to the screened speed-light post at the after edge of the
    # after superstructure's roof (reference AM200, 9.49-10.17 m at z 50.4-51.2).
    foot = V(0, 0, 50.30)
    roof = kit.below(foot.x, foot.y, 11.0, 9.0)
    kit.cylz(aid, col, 'speed light post', (foot.x, foot.y, roof - .01), .07, 10.20 - roof, 'naval', 8)
    kit.boxc(aid, col, 'speed light', Vector((foot.x - .08, foot.y, 9.95)), (.30, .30, .40), 'naval')
    for y in (58.6, 40.5):
        kit.wire(aid, col, V(0, y, pole(y)), (foot.x, foot.y, 10.18), .014, False)
    # Aerials between the masts as the reference hangs them: an upper and a lower run, each sagging to a junction
    # amidships, with a down-lead from each junction to the midships deckhouse roof.
    fore = lambda y: -40.12 + (y - 27.3) * .078
    for y_fore, y_main, sag in ((58.8, 58.6, 52.5), (41.9, 41.5, 35.4)):
        junction = V(0, sag, -.05 if sag > 50 else -2.55)
        kit.wire(aid, col, V(0, y_fore, fore(y_fore)), junction, .01, False)
        kit.wire(aid, col, junction, V(0, y_main, pole(y_main)), .01, False)
        kit.wire(aid, col, junction, V(0, 10.02, -6.0), .01, False)


# ---------------------------------------------------------------- staffs
def staffs(D, kit):
    """The ensign staff at the stern (reference: raked aft from z 82.66 on the quarterdeck to its truck at 12.8 m over
    z 84.04, braced to the deck either side) with the low frame over the stern round its foot, and the jackstaff at
    the stem head (z -85.28, to 15.05 m) with the signal lamp on its truck (reference AM049)."""
    col = kit.collections['Deck fittings']
    aid = 'ensign-staff'
    base = V(0, 0, 82.66)
    base.z = kit.below(base.x, base.y, 6.0, 3.8)
    top = V(0, 12.80, 84.04)
    kit.part('rod', aid, col, 'staff', base - Vector((0, 0, .02)), top, .075, 'naval', r2=.04, vertices=10)
    kit.part('cyl', aid, col, 'truck', top + Vector((0, 0, .08)), .09, .16, 'naval', vertices=10)
    kit.cylz(aid, col, 'socket', base - Vector((0, 0, .01)), .14, .30, 'naval', 12)
    brace_head = base.lerp(top, .34)
    for s in (-1, 1):
        foot = V(s * .95, 0, 81.55)
        foot.z = kit.below(foot.x, foot.y, 6.0, 3.8)
        kit.member(aid, col, brace_head, foot, .035, 'naval', 6)
        kit.cylz(aid, col, 'brace foot', foot - Vector((0, 0, .01)), .07, .08, 'naval', 8)
    # The frame over the stern: an outline with its diagonals on low posts, a hand's breadth over the deck.
    frame = [V(x, 0, z) for x, z in [(-1.45, 81.60), (1.45, 81.60), (1.20, 83.55), (0, 83.95), (-1.20, 83.55)]]
    for p in frame:
        p.z = kit.below(p.x, p.y, 6.0, 3.8) + .12
    kit.polyline(aid, col, frame + [frame[0]], .045, 'naval', 6)
    kit.member(aid, col, frame[0], frame[2], .035, 'naval', 5)
    kit.member(aid, col, frame[1], frame[4], .035, 'naval', 5)
    for p in frame:
        kit.member(aid, col, p - Vector((0, 0, .14)), p, .04, 'naval', 6)
    aid = 'jackstaff'
    foot = V(0, 0, -85.28)
    foot.z = kit.below(foot.x, foot.y, 12.0, 9.95)
    head = V(0, 15.05, -85.28)
    kit.part('rod', aid, col, 'staff', foot - Vector((0, 0, .02)), head, .06, 'naval', r2=.035, vertices=10)
    kit.cylz(aid, col, 'socket', foot - Vector((0, 0, .01)), .11, .25, 'naval', 12)
    kit.cylz(aid, col, 'signal lamp', head, .07, .40, 'naval', 10)


# ---------------------------------------------------------------- fire control
def directors(D, kit):
    """Mk 7 pedestal directors (reference ad054, 1.55 m tall) on the foremast top and the after tower, each trained by
    the rig about its own yaw node; a seat pedestal carries each to its datum where the deck below falls short."""
    col = kit.collections['Sensors and masts']
    for did, (x, y, z), face in [('main-director', (0, 27.869, -42.476), 0), ('after-director', (0, 10.320, 45.524), 180)]:
        bx, by, bz = P(x, y, z)
        # The foremast director stands on the spotting top's floor (27.85 m, drawn by foremast(), not a support
        # surface); the after one on the structure under it.
        floor = 27.85 if did == 'main-director' else kit.below(bx, by, bz + .3, bz)
        if bz - floor > .03:
            kit.cylz(did, col, 'director stand', (bx, by, floor - .02), .40, bz - floor + .03, 'naval', 20)
        pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
        s = 1 if face == 0 else -1
        local(kit.cylz(did, col, 'base', (bx, by, bz - .02), .417, .135, 'naval', 16), pivot)
        local(kit.cylz(did, col, 'pedestal', (bx, by, bz + .11), .258, .83, 'naval', 12, r2=.20), pivot)
        for k in range(4):
            a = math.tau * (k + .5) / 4
            local(kit.part('rod', did, col, 'strut', (bx + .30 * math.cos(a), by + .30 * math.sin(a), bz + .12),
                           (bx + .22 * math.cos(a), by + .22 * math.sin(a), bz + .94), .012, 'edge', vertices=5), pivot)
        local(kit.cylz(did, col, 'deck ring', (bx, by, bz + .936), .306, .037, 'edge', 20), pivot)
        local(kit.boxc(did, col, 'sight head', (bx + s * .02, by, bz + 1.08), (.44, .30, .26), 'naval'), pivot)
        local(kit.boxc(did, col, 'head roof', (bx + s * .02, by, bz + 1.225), (.40, .26, .03), 'edge'), pivot)
        for t in (-1, 1):
            a = (bx - s * .15, by + t * .28, bz + 1.05)
            b = (bx + s * .38, by + t * .28, bz + 1.05)
            local(kit.part('rod', did, col, 'telescope', a, b, .045, 'edge', vertices=10), pivot)
            local(kit.part('rod', did, col, 'objective', b, (b[0] + s * .03, b[1], b[2]), .038, 'glass', vertices=10), pivot)
            local(kit.part('rod', did, col, 'eyepiece', (a[0] - s * .06, a[1], a[2]), a, .03, 'dark', vertices=8), pivot)
        local(kit.part('rod', did, col, 'training handwheel', (bx - s * .25, by - .17, bz + .80), (bx - s * .25, by - .21, bz + .80), .12, 'edge', vertices=10), pivot)


def rangefinders(D, kit):
    """3.6 m rangefinders (reference af052): a housing 1.25 m deep and 1.54 m tall on a turntable, the tube's arms
    reaching 2 m either side, on the conning station and on the after tower."""
    col = kit.collections['Sensors and masts']
    for aid, (x, y, z), face in [('rangefinder-forward', (0, 18.053, -44.692), 0), ('rangefinder-after', (0, 12.270, 40.184), 180)]:
        c = V(x, y, z)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        if c.z - floor > .03:
            kit.cylz(aid, col, 'stand', (c.x, c.y, floor - .02), .45, c.z - floor + .03, 'naval', 20)
        s = 1 if face == 0 else -1
        kit.cylz(aid, col, 'turntable', c, .605, .315, 'naval', 16)
        kit.boxc(aid, col, 'housing', c + Vector((s * .08, 0, .315 + .77)), (1.25, 1.83, 1.54), 'naval')
        kit.boxc(aid, col, 'housing roof', c + Vector((s * .08, 0, 1.87)), (1.29, 1.87, .03), 'edge')
        for t in (-1, 1):
            kit.boxc(aid, col, 'arm', c + Vector((s * .36, t * 1.45, 1.56)), (.24, 1.08, .30), 'naval')
            kit.boxc(aid, col, 'arm window', c + Vector((s * .49, t * 1.95, 1.56)), (.02, .10, .12), 'glass')
        kit.cylz(aid, col, 'sight port', c + Vector((s * .70, .43, 1.29)), .09, .18, 'edge', 8)


# ---------------------------------------------------------------- boats and davits
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, cabin=None, engine=False, colour='white', double=False):
    """Original lofted boat hull on its keel point c (authoring frame), bow toward +X, open as the reference's boats
    are: the hull's top between the gunwales is the dark inside, with a rim along the sheer and thwarts across it.
    `cabin` = (length, height) adds the motor boat's white canopy amidships; `engine` the launch's engine box and
    helm post aft of amidships; `double` gives a double-ended hull, pointed at both ends like the whaleboats."""
    rings = []
    n = 13
    for i in range(n):
        t = i / (n - 1)
        x = (t - .5) * length
        fore = max(0, (t - .62) / .38)
        aft = max(0, (.22 - t) / .22)
        half = beam / 2 * (1 - fore ** 1.8) * (1 - .45 * aft ** 2) + .03
        top = depth * (1 + .18 * fore ** 2 + .06 * aft)
        if double:
            aft = max(0, (.38 - t) / .38)
            half = beam / 2 * (1 - fore ** 1.8) * (1 - aft ** 1.8) + .03
            top = depth * (1 + .18 * fore ** 2 + .18 * aft ** 2)
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append((x, -half * math.cos(a), top - depth * .9 * math.sin(a) ** 1.3 * (1 - .35 * fore) - depth * .1))
        rings.append(ring)
    rot = Matrix.Rotation(heading, 3, 'Z')
    rings = [[tuple(Vector(c) + rot @ Vector(p)) for p in ring] for ring in rings]
    hull = kit.loft(aid, col, 'boat hull', rings, 'naval', True, True, True)  # grey hulls, as the reference paints them
    # The loft's strip between each ring's last and first point spans the gunwales: paint it as the dark inside.
    hull.data.materials.append(kit.materials['edge'])
    for j in range(n - 1):
        hull.data.polygons[j * 9 + 8].material_index = 1
    up = Vector((0, 0, .035))
    for side in (0, 8):
        kit.polyline(aid, col, [Vector(r[side]) + up for r in rings], .05, 'naval', 6)
    for r in (rings[0], rings[-1]):
        kit.member(aid, col, Vector(r[0]) + up, Vector(r[8]) + up, .05, 'naval', 6)
    sheer = depth * .9
    if cabin:
        cl, ch = cabin
        kit.boxc(aid, col, 'canopy', Vector(c) + rot @ Vector((-length * .05, 0, sheer + ch / 2)), (cl, beam * .72, ch), colour, heading)
        kit.boxc(aid, col, 'canopy roof', Vector(c) + rot @ Vector((-length * .05, 0, sheer + ch + .02)), (cl + .1, beam * .78, .05), colour, heading)
        thwarts = [-.36, .30]
    elif engine:
        kit.boxc(aid, col, 'engine box', Vector(c) + rot @ Vector((-length * .10, 0, sheer + .25)), (1.5, beam * .40, .50), 'naval', heading)
        kit.boxc(aid, col, 'helm post', Vector(c) + rot @ Vector((-length * .30, 0, sheer + .45)), (.20, .20, .90), 'naval', heading)
        kit.part('rod', aid, col, 'helm wheel', Vector(c) + rot @ Vector((-length * .30 + .12, -.30, sheer + .80)),
                 Vector(c) + rot @ Vector((-length * .30 + .12, .30, sheer + .80)), .04, 'edge', vertices=6)
        thwarts = [.08, .20, .32]
    else:
        thwarts = [-.285, -.095, .095, .285]
    for f in thwarts:
        # Boards across at the sheer, over the dark inside.
        station = min(range(n), key=lambda i: abs((i / (n - 1) - .5) - f))
        width = abs(rings[station][0][1] - rings[station][8][1]) if abs(heading) < 1e-6 else beam
        kit.boxc(aid, col, 'thwart', Vector(c) + rot @ Vector((f * length, 0, sheer + .02)), (.24, width * .96, .05), 'wood', heading)
    return hull


def davit(kit, aid, col, foot, height, out, radius=.13):
    """A radial boat davit: a post rising from its socket that crooks over by `out` (authoring vector)."""
    foot, out = Vector(foot), Vector(out)
    pts = []
    for k in range(9):
        a = (k / 8) * math.pi / 2
        pts.append(foot + Vector((0, 0, height * math.sin(a))) + out * (1 - math.cos(a)))
    for a, b in zip(pts, pts[1:]):
        kit.member(aid, col, a, b, radius, 'naval', 8)
    kit.cylz(aid, col, 'davit socket', foot - Vector((0, 0, .02)), radius * 1.9, .35, 'naval', 12)
    kit.cylz(aid, col, 'davit head block', pts[-1] - Vector((0, 0, .22)), radius * .9, .22, 'edge', 8)
    return pts[-1]


def boats(D, kit):
    """Two 40 ft motor launches and two 35 ft motor boats in chocks on the upper deck either side of Nos. 1 and 2
    funnels, two 28 ft sail whaleboats outboard at their davits, and the eight tall radial davits that work them
    (reference AM096, AM093, AM092, AM075 and AM131 datums). As the reference shows them, the launches are open
    with an engine box and helm, the motor boats carry a white canopy and the whaleboats are open with thwarts."""
    col = kit.collections['Boats and aviation']
    for s in (-1, 1):
        side = 'port' if s < 0 else 'starboard'
        ky = 8.45 if s > 0 else 7.65  # the port launch sits lower in the reference
        boat(kit, f'launch-{side}', col, V(s * 5.94, ky, -28.13), 12.1, 3.3, 1.55, 0, engine=True)
        for dz in (-3.6, 0, 3.6):
            c = V(s * 5.94, 0, -28.13 + dz)
            floor = kit.below(c.x, c.y, ky + .4, ky - 1.5)
            kit.boxc(f'launch-{side}', col, 'chock', Vector((c.x, c.y, (floor + ky + .3) / 2)), (.3, 2.2, ky + .3 - floor), 'edge')
        boat(kit, f'motor-boat-{side}', col, V(s * 6.8, 7.35, -14.8), 10.5, 2.35, 1.55, 0, cabin=(3.4, .95))
        for dz in (-3.0, 0, 3.0):
            c = V(s * 6.8, 0, -14.8 + dz)
            floor = kit.below(c.x, c.y, 7.7, 6.0)
            kit.boxc(f'motor-boat-{side}', col, 'chock', Vector((c.x, c.y, (floor + 7.65) / 2)), (.3, 1.7, 7.65 - floor), 'edge')
        boat(kit, f'whaleboat-{side}', col, V(s * 9.75, 9.85, -15.18), 8.5, 2.15, 1.2, 0, double=True)
        # The davits stand in sockets on the hull side and rise past the deck edge, as the reference mounts them.
        for z, y0, top, head_x in ((-11.3, 5.35, 12.75, 9.75), (-18.9, 5.55, 12.9, 9.75), (-23.43, 5.75, 13.1, 6.30), (-32.85, 5.75, 13.1, 6.30)):
            aid = f'davit-{side}-{abs(z):.0f}'
            x0 = hull_half(kit, z, y0 + .9) + .16
            foot = V(s * x0, y0, z)
            head = davit(kit, aid, col, foot, top - y0, Vector((0, -s * (head_x - x0), 0)))
            edge = deck(kit, z) - .12
            kit.boxc(aid, col, 'davit bracket', V(s * (hull_half(kit, z, edge) + .05), edge, z), (.22, .26, .16), 'naval')
            if head_x > 9:
                kit.wire(aid, col, head - Vector((0, 0, .25)), V(s * 9.75, 11.0, z * .6 - 15.18 * .4), .015, False)
            else:
                kit.wire(aid, col, head - Vector((0, 0, .25)), V(s * 5.94, ky + 1.8, z * .5 - 28.13 * .5), .015, False)
        x0 = hull_half(kit, 3.7, 6.4) + .12
        foot = V(s * x0, 5.55, 3.7)
        davit(kit, f'davit-{side}-small', col, foot, 10.55 - 5.55, Vector((0, -s * .5, 0)), .08)
        kit.boxc(f'davit-{side}-small', col, 'davit bracket', V(s * (hull_half(kit, 3.7, deck(kit, 3.7) - .12) + .03), deck(kit, 3.7) - .12, 3.7), (.18, .20, .14), 'naval')
        # The boat boom stowed along the hull side under the launch's davits (reference AM109, 5.2-5.5 m, z -35.8 to -24.7).
        a, b = V(s * (hull_half(kit, -35.6, 5.37) + .14), 5.37, -35.6), V(s * (hull_half(kit, -24.9, 5.37) + .14), 5.37, -24.9)
        kit.part('rod', f'boat-boom-{side}', col, 'boat boom', a, b, .13, 'naval', r2=.10, vertices=10)
        for t in (.2, .8):
            p = a.lerp(b, t)
            kit.boxc(f'boat-boom-{side}', col, 'boom bracket', p + Vector((0, s * .08, 0)), (.14, .22, .30), 'naval')


# ---------------------------------------------------------------- aviation
def side_plate(kit, aid, col, label, c, rot, x, y, z, length, height, t, material):
    """An octagonal plate in a vertical fore-and-aft plane (local frame of centre c and rotation rot), t thick."""
    a, b = length / 2, height / 2
    k = min(a, b) * .45
    pts = [(-a + k, -b), (a - k, -b), (a, -b + k), (a, b - k), (a - k, b), (-a + k, b), (-a, b - k), (-a, -b + k)]
    vv = [tuple(c + rot @ Vector((x + px, y + dy, z + pz))) for dy in (-t / 2, t / 2) for px, pz in pts]
    ff = [tuple(range(8)), tuple(8 + i for i in reversed(range(8)))] + [(i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i) for i in range(8)]
    return kit.solid(kit.tag(kit.mesh(aid + '.' + label, vv, ff, material, col), aid))


def catapults(D, kit):
    """Two catapults on turntables abreast No. 4 funnel (reference ac001 at HP_AC): a plated box girder 16.6 m long,
    1.14 m wide and 0.84 m deep, its ends tapered up, pierced by oval lightening holes and lying on a 3.7 m
    turntable; the launching car and its rails on top, a training handwheel at the side; empty. Heights from the
    reference's orthographic side and top views, over the turntable's datum."""
    col = kit.collections['Boats and aviation']
    for s, (px, py, pz, brg) in ((1, (6.576, 6.992, 20.668, 1)), (-1, (-6.556, 6.987, 20.672, -1))):
        aid = 'catapult-' + ('port' if s < 0 else 'starboard')
        c = V(px, py, pz)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        yaw = math.radians(-brg)
        rot = Matrix.Rotation(yaw, 3, 'Z')
        kit.cylz(aid, col, 'turntable', Vector((c.x, c.y, floor - .01)), 1.85, c.z - floor + .08, 'naval', 32)
        kit.cylz(aid, col, 'roller path', Vector((c.x, c.y, c.z + .06)), 1.75, .03, 'edge', 32)
        top, half = .92, .57
        prof = [(-6.95, .47), (-3.45, .08), (8.85, .08), (9.30, .30), (9.66, .58)]
        rings = []
        for x, bottom in prof:
            ring = [(x, -half, bottom), (x, half, bottom), (x, half, top), (x, -half, top)]
            rings.append([tuple(c + rot @ Vector(p)) for p in ring])
        kit.loft(aid, col, 'girder', rings, 'naval', True, True, False)
        bottom_at = lambda x: next(b0 + (b1 - b0) * (x - x0) / (x1 - x0) for (x0, b0), (x1, b1) in zip(prof, prof[1:]) if x0 <= x <= x1)
        for k in range(15):
            x = -6.30 + 1.08 * k
            depth = top - bottom_at(x)
            if depth < .40:
                continue
            for t in (-1, 1):
                side_plate(kit, aid, col, 'lightening hole', c, rot, x, t * (half + .003), (top + bottom_at(x)) / 2, .80, min(.36, depth * .45), .012, 'dark')
        for t in (-1, 1):
            kit.member(aid, col, c + rot @ Vector((-6.9, t * .24, top + .03)), c + rot @ Vector((9.2, t * .24, top + .03)), .03, 'edge', 4)
            kit.part('rod', aid, col, 'handwheel', c + rot @ Vector((-.15, t * (half + .02), .80)), c + rot @ Vector((-.15, t * (half + .08), .80)), .16, 'brass', vertices=12)
        # Launching car on the rails (reference 7.91-8.19 m, uprights to 8.6 m), 2.2 m long, amidships of the girder.
        kit.boxc(aid, col, 'launching car', c + rot @ Vector((2.49, 0, top + .13)), (2.2, 1.0, .14), 'edge', yaw)
        for dx in (-1.0, 1.0):
            for t in (-1, 1):
                kit.boxc(aid, col, 'car upright', c + rot @ Vector((2.49 + dx, t * .42, top + .43)), (.08, .08, .46), 'edge', yaw)


# ---------------------------------------------------------------- searchlights
def searchlights(D, kit):
    """Five 600 mm searchlights (reference AM038): one on the foremast's lower top and four on lattice towers abreast
    Nos. 3 and 4 funnels with platforms 14.36 m up against the funnels' sides; each on a pedestal with its yoke,
    barrel, lens and ventilator."""
    col = kit.collections['Sensors and masts']
    lights = [('searchlight-foremast', (0, 23.52, -43.40)), ('searchlight-1', (-3.17, 14.36, 4.74)), ('searchlight-2', (3.17, 14.36, 4.74)),
              ('searchlight-3', (-3.17, 14.36, 14.34)), ('searchlight-4', (3.17, 14.36, 14.34))]
    for aid, (x, y, z) in lights:
        c = V(x, y, z)
        if y < 20:
            floor = kit.below(c.x, c.y, y - .5, 6.2)
            b, t = .95, .78
            corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
            legs = [(Vector((c.x + i * b, c.y + j * b, floor)), Vector((c.x + i * t, c.y + j * t, y - .08))) for i, j in corners]
            for lo, hi in legs:
                kit.member(aid, col, lo, hi, .06, 'naval', 8)
            for k in range(4):
                r0 = [lo.lerp(hi, k / 4) for lo, hi in legs]
                r1 = [lo.lerp(hi, (k + 1) / 4) for lo, hi in legs]
                for i in range(4):
                    kit.member(aid, col, r0[i], r0[(i + 1) % 4], .035, 'naval', 5)
                    kit.member(aid, col, r0[i], r1[(i + 1) % 4], .028, 'naval', 5)
            # The platform reaches in to the funnel's side and is chamfered outboard (reference top view: 3.1 m
            # across from the funnel to x 4.65, 2.9 m long); the rail leaves open the end the walkway joins.
            sx = 1 if x > 0 else -1
            ring = [(1.50, -1.45), (4.15, -1.45), (4.65, -.95), (4.65, .95), (4.15, 1.45), (1.50, 1.45)]
            outline = [V(sx * px, 0, z + pz)[:2] for px, pz in ring]
            kit.prism(aid, col, 'platform', outline, y - .08, y, 'naval')  # light grey, as the reference paints them
            railed = ring[:5] if z < 10 else ring[1:]
            kit.rail(aid, col, [V(sx * (px - .06 if px > 4 else px), 0, z + pz * .96)[:2] for px, pz in railed], y, .95, 1.1, False, False)
        kit.cylz(aid, col, 'pedestal', c, .22, .52, 'naval', 12)
        kit.boxc(aid, col, 'yoke', c + Vector((0, 0, .60)), (.30, .95, .14), 'naval')
        for t in (-1, 1):
            kit.boxc(aid, col, 'yoke arm', c + Vector((0, t * .45, .86)), (.12, .06, .50), 'naval')
        kit.part('rod', aid, col, 'barrel', c + Vector((-.32, 0, 1.0)), c + Vector((.30, 0, 1.0)), .40, 'naval', vertices=18)
        kit.part('rod', aid, col, 'lens', c + Vector((.30, 0, 1.0)), c + Vector((.34, 0, 1.0)), .35, 'glass', vertices=18)
        kit.cylz(aid, col, 'ventilator', c + Vector((-.05, 0, 1.38)), .18, .18, 'naval', 10)
    # A walkway joins the platforms abreast Nos. 3 and 4 funnels on each side, with a hand line along it (reference
    # side and top views: 14.3 m, from platform edge to platform edge).
    for s in (-1, 1):
        aid = 'searchlight-walkway-' + ('port' if s < 0 else 'starboard')
        a, b = V(s * 3.17, 14.28, 13.22), V(s * 3.17, 14.28, 5.86)
        kit.beam(aid, col, 'walkway', a, b, .55, .08, 'roof')
        for t in (-1, 1):
            kit.member(aid, col, a + Vector((0, t * .26, -.08)), b + Vector((0, t * .26, -.08)), .035, 'naval', 5)
        for zz in (12.95, 9.54, 6.13):
            kit.member(aid, col, V(s * 3.40, 14.30, zz), V(s * 3.40, 15.27, zz), .022, 'naval', 5)
        kit.wire(aid, col, V(s * 3.40, 15.25, 12.95), V(s * 3.40, 15.25, 6.13), .014, False)


# ---------------------------------------------------------------- casemate hoods
def casemates(D, kit):
    """Roof plates over the forward lower casemates' drums (reference 11.74-11.81 m) and the bowl-shaped fairings
    under their sponsons, from the shelf's outboard edge down to the ship's side at 8.5 m (reference side view and
    cuts at 8.85-9.6 m)."""
    col = kit.collections['Superstructure']
    for s in (-1, 1):
        aid = 'casemate-hood-' + ('port' if s < 0 else 'starboard')
        c = V(s * 5.502, 11.795, -49.467)
        kit.cylz(aid, col, 'hood', c, 1.95, .07, 'naval', 32)
    for st in D['structures']:
        # Forward drums' sponsons meet the side at 8.5 m, the after lower drums' shelves at 2.6 m (reference cuts and side view).
        if st['id'].startswith('casemate-sponson'):
            foot_y = 8.5
        elif st['id'].startswith('aftlow-'):
            foot_y = 2.6
        else:
            continue
        y0 = st['baseY']
        pts = [(x, z - ZSHIFT) for x, z in st['footprint']]
        sign = -1 if sum(p[0] for p in pts) < 0 else 1
        arc = sorted((p for p in pts if abs(p[0]) > hull_half(kit, p[1], y0) + .03), key=lambda p: p[1])
        rings = []
        for x, z in arc:
            ring = []
            for k in range(6):
                a = math.pi / 2 * k / 5
                y = y0 + .01 - (y0 + .01 - foot_y) * math.sin(a)
                side = hull_half(kit, z, y) - .05
                ring.append(tuple(V(sign * (side + (abs(x) - side) * math.cos(a)), y, z)))
            ring.append(tuple(V(sign * (hull_half(kit, z, y0) - .05), y0 + .01, z)))
            rings.append(ring)
        if len(rings) >= 2:
            kit.loft(st['id'], col, 'fairing', rings, 'naval', True, True, True)


# ---------------------------------------------------------------- deck gear
def deck_gear(D, kit):
    """Ground tackle, capstans, bollards, fairleads, the forecastle crane, paravanes, cowl ventilators, boat winches
    and the accommodation ladders at the reference positions (misc parts AM/CM datums)."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        # The bower anchor in its deck-edge recess, its cable led forward into a hawse in the recess's forward wall;
        # on deck the cable comes up through a deck pipe inboard of the recess and runs aft to the capstan, as the
        # reference lays them.
        side = 'port' if s < 0 else 'starboard'
        shackle = anchor(kit, f'anchor-{side}', col, s)
        hawse = V(s * 2.95, recess_floor(2.95) + .32, RECESS['z0'])
        kit.part('rod', f'anchor-{side}', col, 'hawse lip', hawse + Vector((-.06, 0, 0)), hawse + Vector((.03, 0, 0)), .30, 'naval', vertices=14)
        kit.part('rod', f'anchor-{side}', col, 'hawse', hawse + Vector((-.075, 0, 0)), hawse + Vector((-.058, 0, 0)), .21, 'dark', vertices=14)
        links(kit, f'anchor-{side}', col, [shackle, shackle.lerp(hawse, .5) + Vector((0, 0, .02)), hawse + Vector((-.12, 0, 0))])
        pipe = V(s * 1.62, 0, -76.05)
        pipe.z = kit.below(pipe.x, pipe.y, 10.5, 9.0)
        kit.cylz('ground-tackle', col, 'deck pipe', pipe - Vector((0, 0, .01)), .34, .18, 'naval', 16)
        kit.cylz('ground-tackle', col, 'deck pipe mouth', pipe + Vector((0, 0, .16)), .22, .03, 'dark', 14)
        cap = V(s * 3.0, 9.12, -67.01)
        cap.z = kit.below(cap.x, cap.y, 10.5, 9.0)
        path = []
        for x, z in ((1.62, -75.75), (1.45, -73.0), (1.55, -70.6), (2.30, -68.6), (2.80, -67.30)):
            q = V(s * x, 0, z)
            q.z = kit.below(q.x, q.y, 10.5, 9.0) + .01
            path.append(q)
        links(kit, 'ground-tackle', col, path)
        kit.cylz('capstans', col, 'capstan', cap, .34, .55, 'naval', 16, r2=.30)
        kit.cylz('capstans', col, 'capstan head', cap + Vector((0, 0, .55)), .42, .16, 'edge', 16)
    for x, z in [(0, -81.2), (4.25, -65.2), (-4.25, -65.2), (-6.87, -21.3), (7.52, 5.0), (-7.52, 5.0), (5.35, 56.8), (-5.35, 56.8), (0, 75.9)]:
        c = V(x, 0, z)
        c.z = kit.below(c.x, c.y, 12.0 if z < -50 else 9.0, 3.0)
        across = abs(x) < .1
        kit.boxc('bollards', col, 'bollard base', c + Vector((0, 0, .05)), (.62, 1.6, .1) if across else (1.6, .62, .1), 'edge')
        for d in (-.48, .48):
            o = Vector((0, d, 0)) if across else Vector((d, 0, 0))
            kit.cylz('bollards', col, 'bitt', c + o + Vector((0, 0, .08)), .2, .55, 'naval', 12)
            kit.cylz('bollards', col, 'bitt cap', c + o + Vector((0, 0, .63)), .25, .06, 'naval', 12)
    for x, z in [(4.1, -71.5), (-4.1, -71.5), (5.0, -63.4), (-5.0, -63.4), (8.3, -17.7), (-8.3, -17.7), (7.9, -26.8), (-7.9, -26.8),
                 (8.68, 15.35), (-8.68, 15.35), (6.26, 54.6), (-6.26, 54.6), (5.4, 60.2), (-5.4, 60.2), (3.5, 70.15), (-3.5, 70.15), (0, 82.65)]:
        # Fairleads stand at the deck edge: keep them just inside the loft's edge.
        edge = hull_half(kit, z, deck(kit, z) - .05) - .3
        x = max(-edge, min(edge, x))
        c = V(x, 0, z)
        c.z = kit.below(c.x, c.y, 12.0 if z < -50 else 9.0, 3.0)
        kit.boxc('fairleads', col, 'fairlead', c + Vector((0, 0, .12)), (.5, .22, .24), 'edge')
        for d in (-.14, .14):
            kit.cylz('fairleads', col, 'roller', c + Vector((d, 0, .02)), .07, .32, 'naval', 8)
    c = V(0, 0, -75.5)
    c.z = kit.below(c.x, c.y, 11.0, 9.5)
    kit.cylz('forecastle-crane', col, 'crane post', c, .22, 2.5, 'naval', 12, r2=.16)
    kit.lattice('forecastle-crane', col, c + Vector((0, 0, 1.2)), c + Vector((1.9, 0, 3.7)), .28, .28, 5, .035, .02)
    kit.wire('forecastle-crane', col, c + Vector((1.9, 0, 3.6)), c + Vector((1.9, 0, 1.6)), .012, False)
    kit.wire('forecastle-crane', col, c + Vector((0, 0, 2.5)), c + Vector((1.9, 0, 3.75)), .012, False)
    # The paravane booms stand stowed against the forward superstructure's front, leaning in at the head
    # (reference AM109: 8.55-15.38 m at z -53.2).
    for s, (x0, x1) in ((-1, (3.25, 2.08)), (1, (3.75, 2.52))):
        foot = V(s * x0, 0, -53.28)
        foot.z = kit.below(foot.x, foot.y, 9.5, 8.5)
        kit.part('rod', 'paravane-booms', col, 'paravane boom', foot - Vector((0, 0, .02)), V(s * x1, 15.30, -53.28), .10, 'naval', r2=.07, vertices=10)
        kit.cylz('paravane-booms', col, 'boom heel', foot - Vector((0, 0, .01)), .16, .16, 'naval', 10)
    for s in (-1, 1):
        c = V(s * 4.32, 0, -55.3)
        c.z = kit.below(c.x, c.y, 9.9, 8.3) + .02
        kit.part('rod', 'paravanes', col, 'paravane body', c + Vector((-1.4, 0, .35)), c + Vector((1.4, 0, .35)), .2, 'naval', vertices=10)
        kit.boxc('paravanes', col, 'paravane plane', c + Vector((-.5, 0, .35)), (.8, 1.2, .04), 'naval')
        kit.boxc('paravanes', col, 'paravane chock', c + Vector((0, 0, .08)), (1.8, .5, .16), 'edge')
    # Cowl ventilators: reference x, z and the height of the cowl's crown (AM128 bounds). Their trunks run down
    # through the deck in the reference, so the crown, not the mesh's height, sets each one's height here.
    for x, z, crown, big in [(4.02, -7.72, 11.88, 1), (-4.02, -7.72, 11.88, 1), (4.70, 12.46, 8.92, 1), (-4.70, 12.46, 8.92, 1),
                             (0.99, 18.88, 8.92, 1), (0.0, 7.78, 10.59, 1), (-3.38, 31.42, 7.75, 0), (3.38, 27.33, 7.07, 0),
                             (-3.38, 27.33, 7.07, 0), (1.25, 61.51, 5.33, 0)]:
        c = V(x, 0, z)
        c.z = kit.below(c.x, c.y, 11.0, 3.4)
        r = .42 if big else .30
        top = max(c.z + .25, crown - r * 1.6)
        kit.cylz('ventilators', col, 'ventilator trunk', c, r * .8, top - c.z, 'naval', 14)
        kit.part('rod', 'ventilators', col, 'cowl', Vector((c.x, c.y, top - .05)), Vector((c.x + .9 * r, c.y, top + r * 1.1)), r * .9, 'naval', r2=r * 1.35, vertices=14)
        kit.part('rod', 'ventilators', col, 'cowl mouth', Vector((c.x + .9 * r, c.y, top + r * 1.1)), Vector((c.x + 1.0 * r, c.y, top + r * 1.2)), r * 1.25, 'dark', vertices=14)
    # On the midships deckhouse's roof (10.0 m): the octagonal ventilation trunk at its after end under a canvas
    # cover, and the low skylight at its forward end (reference plan cuts at 10.3-11.3 m).
    roof = kit.below(*V(0, 0, -6.5)[:2], 10.5, 9.9)
    trunk = [V(.92 * math.cos(math.tau * (k + .5) / 8), 0, -6.515 + .86 * math.sin(math.tau * (k + .5) / 8))[:2] for k in range(8)]
    kit.prism('midships-house-fittings', col, 'ventilation trunk', trunk, roof - .02, roof + 1.45, 'naval', 'canvas')
    kit.boxc('midships-house-fittings', col, 'skylight', V(0, 0, -11.07) + Vector((0, 0, roof + .14)), (.76, 3.32, .30), 'naval')
    for z in (-27.5, 35.3, 57.7):
        c = V(0, 0, z)
        c.z = kit.below(c.x, c.y, 8.5, 3.4)
        kit.boxc('winches', col, 'winch bed', c + Vector((0, 0, .1)), (1.0, 2.8, .2), 'edge')
        kit.part('rod', 'winches', col, 'winch drum', c + Vector((0, -1.05, .55)), c + Vector((0, 1.05, .55)), .3, 'naval', vertices=14)
        for t in (-1, 1):
            kit.boxc('winches', col, 'winch cheek', c + Vector((0, t * 1.2, .45)), (.7, .12, .7), 'naval')
    for s in (-1, 1):
        c = V(s * 9.2, 6.71, -0.06)
        kit.beam('ladders', col, 'accommodation ladder', c + Vector((4.4, 0, -1.0)), c + Vector((-4.4, 0, 1.0)), .7, .12, 'naval')


# ---------------------------------------------------------------- underwater
def underwater(D, kit):
    """Four three-bladed screws (reference CM001/CM032: outer pair 3.1 m across at z 61.1, inner pair at z 75.9), their
    shafts leaving the hull through bossings, brackets, the rudder (5.3 m long, down to 4.89 m below the waterline)
    and the bilge keels."""
    col = kit.collections['Underwater fittings']
    screws = [('outer', 7.26, -2.83, 61.10, 1.55, (6.00, -2.72, 47.5)), ('inner', 4.55, -2.95, 75.90, 1.60, (3.05, -2.40, 60.0))]
    for hub, x0, y0, z0, radius, (ex, ey, ez) in screws:
        for s in (-1, 1):
            aid = f'screw-{"port" if s < 0 else "starboard"}-{hub}'
            c = V(s * x0, y0, z0)
            exit_ = V(s * ex, ey, ez)
            axis = (c - exit_).normalized()
            kit.part('rod', aid, col, 'shaft', exit_, c, .17, 'antifouling', vertices=12)  # painted with the bottom
            kit.part('rod', aid, col, 'bossing', exit_ - axis * 2.0, exit_ + axis * 1.4, .45, 'antifouling', r2=.24, vertices=16)
            kit.part('rod', aid, col, 'hub', c - axis * .35, c + axis * .45, .34, 'bronze', r2=.30, vertices=14)
            kit.part('rod', aid, col, 'hub cone', c + axis * .45, c + axis * .95, .30, 'bronze', r2=.06, vertices=14)
            side = axis.cross(Vector((0, 0, 1))).normalized()
            up = side.cross(axis).normalized()
            for k in range(3):
                a = math.tau * k / 3 + math.pi / 2  # one blade straight up, as the reference stands them
                radial = (side * math.cos(a) + up * math.sin(a)).normalized()
                tangent = axis.cross(radial).normalized()
                sections = []
                for r, w in ((.30, .70), (.75, 1.20), (1.15, 1.26), (1.45, .92), (radius, .42)):
                    p = c + radial * r
                    sections.append((p - tangent * w * .5 - axis * w * .18 * s, p + tangent * w * .5 + axis * w * .18 * s))
                vv = []
                for le, te in sections:
                    for d in (-.035, .035):
                        vv += [tuple(le + axis * d), tuple(te + axis * d)]
                ff = []
                for i in range(len(sections) - 1):
                    a0, b0 = 4 * i, 4 * (i + 1)
                    ff += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, b0 + 2, b0 + 3, a0 + 3), (a0, b0, b0 + 2, a0 + 2), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
                last = 4 * (len(sections) - 1)
                ff += [(0, 2, 3, 1), (last, last + 1, last + 3, last + 2)]
                kit.solid(kit.tag(kit.mesh(aid + '.blade', vv, ff, 'bronze', col), aid))
            # Bracket: a boss just forward of the screw on two arms up and inboard to the hull.
            boss = c - axis * 1.1
            kit.part('rod', aid, col, 'bracket boss', boss - axis * .3, boss + axis * .3, .28, 'antifouling', vertices=12)
            for dx, dy in ((.9, 1.6), (-.5, 1.9)):
                top = V(s * (x0 - dx), y0 + dy, z0 - 1.1)
                kit.beam(aid, col, 'bracket arm', boss, top, .12, .45, 'antifouling', tuple(axis))
    aid = 'rudder'

    def foil(y, z0, z1, t, n=10):
        up = [(z0 + (z1 - z0) * i / n, t * 2.6 * math.sqrt(max(0, i / n)) * (1 - i / n) ** 1.1) for i in range(n + 1)]
        right = [(w, y, z) for z, w in up]
        left = [(-w, y, z) for z, w in reversed(up[1:-1])]
        return [P(*p) for p in right + left]
    kit.loft(aid, col, 'rudder blade', [foil(-4.88, 77.25, 82.50, .11), foil(-1.3, 77.10, 82.40, .13)], 'antifouling', True, True, False)
    kit.part('rod', aid, col, 'rudder stock', V(0, -1.4, 78.3), V(0, .2, 78.3), .16, 'antifouling', vertices=10)
    for s in (-1, 1):
        zs = [-15 + 55 * i / 10 for i in range(11)]
        for z0, z1 in zip(zs, zs[1:]):
            roots = [V(s * (hull_half(kit, z, -3.25) - .05), -3.25, z) for z in (z0, z1)]
            out = Vector((0, -s * .55, -.35))
            kit.beam('bilge-keels', col, 'bilge keel', roots[0] + out * .5, roots[1] + out * .5, .05, .62, 'antifouling', tuple(out))


# ---------------------------------------------------------------- rails
def railings(D, kit):
    """Guard rails along the forecastle and quarterdeck edges, kept out of the gun arcs (Kit.in_arc). The reference
    rails no part of the upper deck's edge between the superstructures, where the after torpedo mounts swing their
    tubes out over the side."""
    col = kit.collections['Deck fittings']
    r0, r1 = RECESS['z0'] - .15, RECESS['z1'] + .15
    inboard = lambda z: RECESS['inboard'][0] + (RECESS['inboard'][1] - RECESS['inboard'][0]) * (z - RECESS['z0']) / (RECESS['z1'] - RECESS['z0'])
    for s in (-1, 1):
        for z0, z1 in ((-84.6, -55.0), (42.2, 83.4)):
            n = max(2, int(abs(z1 - z0) / 1.6))
            zs = [z0 + (z1 - z0) * i / n for i in range(n + 1)]
            if z0 < r0 and r1 < z1:
                # Round the anchor recess along its inboard edge, as the reference's stanchions stand.
                zs = sorted([z for z in zs if not r0 - .5 < z < r1 + .5] + [r0 - .5, r0, r1, r1 + .5])
            pts = []
            for z in zs:
                y = deck(kit, z)
                x = hull_half(kit, z, y - .02) - .1
                if r0 <= z <= r1:
                    x = min(x, inboard(min(max(z, RECESS['z0']), RECESS['z1'])) - .12)
                pts.append(V(s * x, y, z))
            for a, b in zip(pts, pts[1:]):
                for h in (.5, 1.0):
                    kit.wire('railings', col, a + Vector((0, 0, h)), b + Vector((0, 0, h)), .016, True)
                kit.wire('railings', col, a, a + Vector((0, 0, 1.0)), .022, True)


def build(D, kit):
    directors(D, kit)
    rangefinders(D, kit)
    torpedo_mounts(D, kit)
    funnel_caps(D, kit)
    foremast(D, kit)
    mainmast(D, kit)
    boats(D, kit)
    catapults(D, kit)
    searchlights(D, kit)
    casemates(D, kit)
    deck_gear(D, kit)
    underwater(D, kit)
    staffs(D, kit)
    railings(D, kit)
    kit.build_wires()

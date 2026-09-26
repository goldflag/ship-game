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
        mod = hull.modifiers.new('pocket', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = hull
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    # Faces the cut made: walls and ceiling take the hull paint, the floor the deck paint (build.py sorts them).
    names = [m.name for m in hull.data.materials]
    return names


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


# ---------------------------------------------------------------- funnel caps
def funnel_caps(D, kit):
    """Each funnel's rain cap: a shallow dished disc on four stays over the rim (reference: the cap's plate
    0.33-0.41 m above the rim, 3.5 m across)."""
    col = kit.collections['Superstructure']
    for s in D['structures']:
        ex = s.get('exhaust')
        if not ex:
            continue
        aid = s['id'] + '-cap'
        x, y, z = R(ex['position'])
        rim = y
        hx, hz = ex['length'] / 2, ex['width'] / 2
        ring0 = kit.disc_ring(24, hz + .12, (x, y, rim + .33), rx=hx + .12)
        ring1 = kit.disc_ring(24, hz * .35, (x, y, rim + .52), rx=hx * .35)
        kit.loft(aid, col, 'cap', [ring0, [(p[0], p[1], p[2] + .06) for p in ring0], ring1], 'black', True, True, True)
        for k in range(4):
            ang = math.tau * (k + .5) / 4
            px, py = x + (hx - .06) * math.cos(ang), y + (hz - .06) * math.sin(ang)
            kit.member(aid, kit.collections['Superstructure'], (px, py, rim - .25), (px, py, rim + .34), .05, 'black', 6)


# ---------------------------------------------------------------- masts
def foremast(D, kit):
    """Tripod foremast: the lower pole from the pilot house to the spotting top, two raked legs from the bridge
    deck, the lower top (a Y-shaped platform at 23.5 m with the signal yard at 25.45 m), the spotting top round the
    Mk 7 director (floor 27.85 m), the topmast 1.7 m abaft the lower pole to the truck at 59.5 m, a lookout box and
    the upper yard (reference cuts every 2-5 m; 0.08 m of rake aft per metre)."""
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    lower = lambda y: -42.30 + (y - 15.7) * .082
    upper = lambda y: -40.12 + (y - 27.3) * .078
    taper(kit, aid, col, 'lower pole', (0, 15.65, lower(15.65)), (0, 27.30, lower(27.30)), .34, .32)
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
    # Signal yard under the spotting top and the spotting top itself: a floor at 27.85 m and a bulwark to 29.0 m round
    # the director (reference 3.2 by 4.8 m), with a light canopy frame over it.
    kit.part('rod', aid, col, 'signal yard', V(-5.6, 25.45, -40.35), V(5.6, 25.45, -40.35), .08, 'naval', r2=.05, vertices=8)
    top = [V(x, 0, z)[:2] for x, z in [(-1.6, -39.2), (1.6, -39.2), (1.6, -44.0), (-1.6, -44.0)]]
    kit.prism(aid, col, 'spotting top floor', top, 27.25, 27.85, 'naval', 'roof')
    for (x0, z0), (x1, z1) in [((-1.6, -39.2), (1.6, -39.2)), ((1.6, -39.2), (1.6, -44.0)), ((1.6, -44.0), (-1.6, -44.0)), ((-1.6, -44.0), (-1.6, -39.2))]:
        a, b = V(x0, 27.85, z0), V(x1, 27.85, z1)
        mid = (a + b) / 2
        length = (b - a).length
        kit.boxc(aid, col, 'bulwark', Vector((mid.x, mid.y, 28.43)), (length if abs(a.y - b.y) < 1e-6 else .05, .05 if abs(a.y - b.y) < 1e-6 else length, 1.15), 'naval')
    for x, z in [(-1.55, -39.25), (1.55, -39.25), (1.55, -43.95), (-1.55, -43.95)]:
        kit.member(aid, col, V(x, 29.0, z), V(x * .7, 30.55, z * .5 + -41.0 * .5), .035)
    kit.boxc(aid, col, 'canopy frame', V(0, 30.6, -41.1), (2.0, 2.2, .06), 'edge')
    # Lookout box forward of the topmast and the upper yard with its blocks.
    kit.boxc(aid, col, 'lookout', V(0, 45.2, -40.25), (.72, .72, 1.25), 'naval')
    kit.member(aid, col, V(0, 44.6, -39.9), V(0, 44.6, upper(44.6)), .05)
    kit.part('rod', aid, col, 'upper yard', V(-5.4, 44.2, upper(44.2) - .15), V(5.4, 44.2, upper(44.2) - .15), .07, 'naval', r2=.045, vertices=8)
    kit.part('rod', aid, col, 'top yard', V(-3.5, 52.5, upper(52.5) - .1), V(3.5, 52.5, upper(52.5) - .1), .05, 'naval', r2=.035, vertices=8)
    for s in (-1, 1):
        for k in range(1, 6):
            kit.boxc(aid, col, 'yard block', V(s * k * .95, 44.05, upper(44.2) - .15), (.12, .10, .18), 'edge')
    kit.ladder(aid, col, V(0, 15.9, lower(15.9) + .4), V(0, 27.2, lower(27.2) + .4), (0, 1, 0), .38)
    # Standing rigging: shrouds to the deck edge and stays fore and aft (thin, merged).
    for s in (-1, 1):
        for zz in (-40.0, -37.0, -34.0):
            kit.wire(aid, col, V(0, 43.5, upper(43.5)), V(s * 7.3, 8.1, zz), .012, False)
        kit.wire(aid, col, V(s * 5.3, 25.45, -40.35), V(s * 7.2, 8.2, -31.0), .012, False)
    kit.wire(aid, col, V(0, 58.0, upper(58.0)), V(0, 10.3, -85.0), .014, False)
    kit.wire(aid, col, V(0, 55.0, upper(55.0)), V(0, 56.0, 35.9), .012, False)
    kit.wire(aid, col, V(0, 50.0, upper(50.0)), V(0, 51.0, 35.3), .012, False)


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
    taper(kit, aid, col, 'derrick post', (0, post - .05, 31.96), (0, 25.0, 31.96), .17, .10)
    kit.member(aid, col, V(0, 24.5, 31.96), V(0, 24.5, pole(24.5)), .05)
    # Derrick boom stowed up against the post, heel on a gooseneck at 12 m.
    kit.part('rod', aid, col, 'derrick boom', V(0, 12.0, 32.1), V(-2.6, 19.6, 30.8), .14, 'naval', r2=.09, vertices=10)
    kit.wire(aid, col, V(-2.6, 19.6, 30.8), V(0, 24.4, 31.96), .015, False)
    kit.boxc(aid, col, 'lookout', V(0, 44.8, pole(44.8) - .55), (.72, .72, 1.25), 'naval')
    kit.part('rod', aid, col, 'yard', V(-5.4, 37.0, pole(37.0) + .15), V(5.4, 37.0, pole(37.0) + .15), .07, 'naval', r2=.045, vertices=8)
    kit.part('rod', aid, col, 'top yard', V(-3.6, 55.0, pole(55.0) + .1), V(3.6, 55.0, pole(55.0) + .1), .05, 'naval', r2=.035, vertices=8)
    kit.part('rod', aid, col, 'gaff', V(0, 26.0, pole(26.0)), V(0, 27.9, 38.2), .07, 'naval', r2=.045, vertices=8)
    kit.ladder(aid, col, V(0, base + 2.0, pole(base + 2.0) + .4), V(0, 44.0, pole(44.0) + .4), (1, 0, 0), .36)
    for s in (-1, 1):
        for zz in (31.0, 35.0, 38.0):
            kit.wire(aid, col, V(0, 50.0, pole(50.0)), V(s * 8.1, 6.3, zz), .012, False)
        kit.wire(aid, col, V(s * 5.2, 37.0, pole(37.0) + .15), V(s * 7.9, 6.2, 33.0), .012, False)
    kit.wire(aid, col, V(0, 62.0, pole(62.0)), V(0, 4.2, 82.5), .014, False)
    # Aerial run between the mastheads.
    kit.wire(aid, col, V(0, 57.0, -37.75), V(0, 60.0, 36.10), .01, False)


# ---------------------------------------------------------------- fire control
def directors(D, kit):
    """Mk 7 pedestal directors (reference ad054, 1.55 m tall) on the foremast top and the after tower, each trained by
    the rig about its own yaw node; a seat pedestal carries each to its datum where the deck below falls short."""
    col = kit.collections['Sensors and masts']
    for did, (x, y, z), face in [('main-director', (0, 27.869, -42.476), 0), ('after-director', (0, 10.320, 45.524), 180)]:
        bx, by, bz = P(x, y, z)
        floor = kit.below(bx, by, bz + .3, bz)
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
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, cabin=None, colour='white'):
    """Original lofted boat hull on its keel point c (authoring frame), bow toward +X; `cabin` = (length, height)."""
    rings = []
    n = 13
    for i in range(n):
        t = i / (n - 1)
        x = (t - .5) * length
        fore = max(0, (t - .62) / .38)
        aft = max(0, (.22 - t) / .22)
        half = beam / 2 * (1 - fore ** 1.8) * (1 - .45 * aft ** 2) + .03
        top = depth * (1 + .18 * fore ** 2 + .06 * aft)
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append((x, -half * math.cos(a), top - depth * .9 * math.sin(a) ** 1.3 * (1 - .35 * fore) - depth * .1))
        rings.append(ring)
    rot = Matrix.Rotation(heading, 3, 'Z')
    rings = [[tuple(Vector(c) + rot @ Vector(p)) for p in ring] for ring in rings]
    hull = kit.loft(aid, col, 'boat hull', rings, colour, True, True, True)
    kit.boxc(aid, col, 'gunwale', Vector(c) + rot @ Vector((0, 0, depth * 1.0)), (length * .78, beam * 1.0, .05), 'wood', heading)
    if cabin:
        cl, ch = cabin
        kit.boxc(aid, col, 'canopy', Vector(c) + rot @ Vector((-length * .05, 0, depth + ch / 2)), (cl, beam * .72, ch), colour, heading)
        kit.boxc(aid, col, 'canopy roof', Vector(c) + rot @ Vector((-length * .05, 0, depth + ch + .02)), (cl + .1, beam * .78, .05), 'canvas', heading)
    else:
        for k in range(4):
            kit.boxc(aid, col, 'thwart', Vector(c) + rot @ Vector(((k - 1.5) * length * .19, 0, depth * .62)), (.22, beam * .86, .06), 'wood', heading)
    return hull


def davit(kit, aid, col, foot, height, out, radius=.13):
    """A radial boat davit: a post rising from its deck socket that crooks over outboard by `out` (authoring vector)."""
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
    (reference AM096, AM093, AM092, AM075 and AM131 datums)."""
    col = kit.collections['Boats and aviation']
    for s in (-1, 1):
        side = 'port' if s < 0 else 'starboard'
        ky = 8.45 if s > 0 else 7.65  # the port launch sits lower in the reference
        boat(kit, f'launch-{side}', col, V(s * 5.94, ky, -28.13), 12.1, 3.3, 1.55, 0, cabin=(4.2, 1.1))
        for dz in (-3.6, 0, 3.6):
            c = V(s * 5.94, 0, -28.13 + dz)
            floor = kit.below(c.x, c.y, ky + .4, ky - 1.5)
            kit.boxc(f'launch-{side}', col, 'chock', Vector((c.x, c.y, (floor + ky + .3) / 2)), (.3, 2.2, ky + .3 - floor), 'edge')
        boat(kit, f'motor-boat-{side}', col, V(s * 6.8, 7.35, -14.8), 10.5, 2.35, 1.55, 0, cabin=(3.4, .95))
        for dz in (-3.0, 0, 3.0):
            c = V(s * 6.8, 0, -14.8 + dz)
            floor = kit.below(c.x, c.y, 7.7, 6.0)
            kit.boxc(f'motor-boat-{side}', col, 'chock', Vector((c.x, c.y, (floor + 7.65) / 2)), (.3, 1.7, 7.65 - floor), 'edge')
        boat(kit, f'whaleboat-{side}', col, V(s * 9.75, 9.85, -15.18), 8.5, 2.15, 1.2, 0)
        for z in (-11.3, -18.9):
            aid = f'davit-{side}-{abs(z):.0f}'
            foot = V(s * 8.3, 0, z)
            foot.z = kit.below(foot.x, foot.y, 7.5, 6.9)
            head = davit(kit, aid, col, foot, 13.0 - foot.z, Vector((0, -s * 1.5, 0)))
            kit.wire(aid, col, head - Vector((0, 0, .25)), V(s * 9.75, 11.0, z * .6 - 15.18 * .4), .015, False)
        for z in (-23.43, -32.85):
            aid = f'davit-{side}-{abs(z):.0f}'
            foot = V(s * 7.45, 0, z)
            foot.z = kit.below(foot.x, foot.y, 7.8, 7.0)
            head = davit(kit, aid, col, foot, 13.1 - foot.z, Vector((0, s * 1.4, 0)))
            kit.wire(aid, col, head - Vector((0, 0, .25)), V(s * 5.94, ky + 1.8, z * .5 - 28.13 * .5), .015, False)
        foot = V(s * 9.06, 0, 3.7)
        foot.z = kit.below(foot.x, foot.y, 7.0, 6.3)
        davit(kit, f'davit-{side}-small', col, foot, 10.55 - foot.z, Vector((0, -s * .6, 0)), .08)


# ---------------------------------------------------------------- aviation
def catapults(D, kit):
    """Two catapults on turntables abreast No. 4 funnel (reference ac001 at HP_AC): a plated girder 16.6 m long with
    lightening holes and tapered ends, the launching car and its rails, on a pedestal and a 3.4 m turntable; empty."""
    col = kit.collections['Boats and aviation']
    for s, (px, py, pz, brg) in ((1, (6.576, 6.992, 20.668, 1)), (-1, (-6.556, 6.987, 20.672, -1))):
        aid = 'catapult-' + ('port' if s < 0 else 'starboard')
        c = V(px, py, pz)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        yaw = math.radians(-brg)
        rot = Matrix.Rotation(yaw, 3, 'Z')
        kit.cylz(aid, col, 'turntable', Vector((c.x, c.y, floor - .01)), 1.7, c.z - floor + .10, 'naval', 28)
        kit.cylz(aid, col, 'roller path', Vector((c.x, c.y, c.z + .09)), 1.6, .06, 'edge', 28)
        kit.boxc(aid, col, 'pedestal', c + Vector((0, 0, .45)), (1.4, .9, .70), 'naval', yaw)
        prof = [(-6.96, .75, .95), (-5.5, .72, 1.05), (-1.0, .70, 1.20), (2.5, .70, 1.20), (8.0, .72, 1.0), (9.66, .80, .88)]
        rings = []
        for x, bottom, top in prof:
            ring = [(x, -.36, bottom), (x, .36, bottom), (x, .36, top), (x, -.36, top)]
            rings.append([tuple(c + rot @ Vector(p)) for p in ring])
        kit.loft(aid, col, 'girder', rings, 'naval', True, True, False)
        for x in [-6.0, -4.9, -3.8, -2.4, -1.3, 1.6, 3.1, 4.3, 5.6, 6.9]:
            for t in (-1, 1):
                p = c + rot @ Vector((x, t * .365, 1.02))
                kit.part('rod', aid, col, 'lightening hole', p - rot @ Vector((0, t * .01, 0)), p + rot @ Vector((0, t * .01, 0)), .18, 'dark', vertices=10)
        for t in (-1, 1):
            kit.member(aid, col, c + rot @ Vector((-6.9, t * .24, 1.24)), c + rot @ Vector((9.6, t * .24, 1.24)), .03, 'edge', 4)
        kit.boxc(aid, col, 'launching car', c + rot @ Vector((2.9, 0, 1.36)), (1.9, .95, .22), 'edge', yaw)
        kit.boxc(aid, col, 'car cradle', c + rot @ Vector((2.9, 0, 1.55)), (1.4, .10, .30), 'edge', yaw)
        kit.boxc(aid, col, 'breech housing', c + rot @ Vector((-5.8, 0, 1.40)), (1.2, .80, .40), 'naval', yaw)


# ---------------------------------------------------------------- searchlights
def searchlights(D, kit):
    """Five 600 mm searchlights (reference AM038): one on the foremast's lower top and four on lattice towers abreast
    Nos. 3 and 4 funnels with platforms 14.36 m up; each on a pedestal with its yoke, barrel, lens and ventilator."""
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
            kit.boxc(aid, col, 'platform', Vector((c.x, c.y, y - .04)), (2.2, 2.2, .08), 'roof')
            kit.rail(aid, col, [(c.x + i * 1.08, c.y + j * 1.08) for i, j in corners], y, .95, 1.1, True, False)
        kit.cylz(aid, col, 'pedestal', c, .22, .52, 'naval', 12)
        kit.boxc(aid, col, 'yoke', c + Vector((0, 0, .60)), (.30, .95, .14), 'naval')
        for t in (-1, 1):
            kit.boxc(aid, col, 'yoke arm', c + Vector((0, t * .45, .86)), (.12, .06, .50), 'naval')
        kit.part('rod', aid, col, 'barrel', c + Vector((-.32, 0, 1.0)), c + Vector((.30, 0, 1.0)), .40, 'naval', vertices=18)
        kit.part('rod', aid, col, 'lens', c + Vector((.30, 0, 1.0)), c + Vector((.34, 0, 1.0)), .35, 'glass', vertices=18)
        kit.cylz(aid, col, 'ventilator', c + Vector((-.05, 0, 1.38)), .18, .18, 'naval', 10)


# ---------------------------------------------------------------- casemate hoods
def casemates(D, kit):
    """Roof plates over the forward lower casemates' drums (reference 11.74-11.81 m)."""
    col = kit.collections['Superstructure']
    for s in (-1, 1):
        aid = 'casemate-hood-' + ('port' if s < 0 else 'starboard')
        c = V(s * 5.502, 11.745, -49.467)
        kit.cylz(aid, col, 'hood', c, 1.95, .07, 'naval', 32)
        kit.cylz(aid, col, 'hood rim', c - Vector((0, 0, .08)), 1.97, .08, 'edge', 32)


# ---------------------------------------------------------------- deck gear
def deck_gear(D, kit):
    """Ground tackle, capstans, bollards, fairleads, the forecastle crane, paravanes, cowl ventilators, boat winches
    and the accommodation ladders at the reference positions (misc parts AM/CM datums)."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        c = V(s * 2.66, 9.16, -74.12)
        c.z = kit.below(c.x, c.y, 10.5, 9.0)
        kit.boxc('ground-tackle', col, 'anchor shank', c + Vector((0, 0, .18)), (2.6, .32, .30), 'black', math.radians(4 * s))
        kit.boxc('ground-tackle', col, 'anchor crown', c + Vector((-1.2, 0, .22)), (.35, 1.5, .36), 'black')
        kit.part('cyl', 'ground-tackle', col, 'hawse pipe', c + Vector((1.45, 0, .06)), .34, .14, 'naval', vertices=14)
        cap = V(s * 3.0, 9.12, -67.01)
        cap.z = kit.below(cap.x, cap.y, 10.5, 9.0)
        for i in range(8):
            a, b = c.lerp(cap, i / 8), c.lerp(cap, (i + 1) / 8)
            kit.member('ground-tackle', col, Vector((a.x, a.y, a.z + .06)), Vector((b.x, b.y, b.z + .06)), .05, 'black', 5)
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
    for s in (-1, 1):
        c = V(s * 4.32, 0, -55.3)
        c.z = kit.below(c.x, c.y, 9.9, 8.3) + .02
        kit.part('rod', 'paravanes', col, 'paravane body', c + Vector((-1.4, 0, .35)), c + Vector((1.4, 0, .35)), .2, 'naval', vertices=10)
        kit.boxc('paravanes', col, 'paravane plane', c + Vector((-.5, 0, .35)), (.8, 1.2, .04), 'naval')
        kit.boxc('paravanes', col, 'paravane chock', c + Vector((0, 0, .08)), (1.8, .5, .16), 'edge')
    for x, z, h, big in [(4.02, -7.72, 5.15, 1), (-4.02, -7.72, 5.15, 1), (4.70, 12.46, 4.52, 1), (-4.70, 12.46, 4.52, 1), (0.99, 18.88, 4.52, 1),
                         (0.0, 7.78, 4.52, 1), (-3.38, 31.42, 3.16, 0), (3.38, 27.33, 2.11, 0), (-3.38, 27.33, 2.11, 0), (1.25, 61.51, 3.16, 0)]:
        c = V(x, 0, z)
        c.z = kit.below(c.x, c.y, 11.0, 3.4)
        r = .42 if big else .30
        top = c.z + h - r * 1.6
        kit.cylz('ventilators', col, 'ventilator trunk', c, r * .8, top - c.z, 'naval', 14)
        kit.part('rod', 'ventilators', col, 'cowl', Vector((c.x, c.y, top - .05)), Vector((c.x + .9 * r, c.y, top + r * 1.1)), r * .9, 'naval', r2=r * 1.35, vertices=14)
        kit.part('rod', 'ventilators', col, 'cowl mouth', Vector((c.x + .9 * r, c.y, top + r * 1.1)), Vector((c.x + 1.0 * r, c.y, top + r * 1.2)), r * 1.25, 'dark', vertices=14)
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
            kit.part('rod', aid, col, 'shaft', exit_, c, .17, 'bronze', vertices=12)
            kit.part('rod', aid, col, 'bossing', exit_ - axis * 2.0, exit_ + axis * 1.4, .45, 'antifouling', r2=.24, vertices=16)
            kit.part('rod', aid, col, 'hub', c - axis * .35, c + axis * .45, .34, 'bronze', r2=.30, vertices=14)
            kit.part('rod', aid, col, 'hub cone', c + axis * .45, c + axis * .95, .30, 'bronze', r2=.06, vertices=14)
            side = axis.cross(Vector((0, 0, 1))).normalized()
            up = side.cross(axis).normalized()
            for k in range(3):
                a = math.tau * k / 3 + (.3 if s > 0 else -.3)
                radial = (side * math.cos(a) + up * math.sin(a)).normalized()
                tangent = axis.cross(radial).normalized()
                sections = []
                for r, w in ((.30, .55), (.75, .95), (1.15, .95), (1.45, .65), (radius, .25)):
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
    """Guard rails along the forecastle, upper-deck and quarterdeck edges, kept out of the gun arcs (Kit.in_arc)."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        for z0, z1 in ((-84.6, -55.0), (-35.0, 41.3), (42.2, 83.4)):
            n = max(2, int(abs(z1 - z0) / 1.6))
            pts = []
            for i in range(n + 1):
                z = z0 + (z1 - z0) * i / n
                y = deck(kit, z)
                x = hull_half(kit, z, y - .02) - .1
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
    railings(D, kit)
    kit.build_wires()

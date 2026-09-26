"""Pensacola fittings: gun-tub bulwarks, masts and the aircraft crane, catapults, directors,
rangefinder, CXAM radar, searchlights, boats, deck gear, railings and underwater gear.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the
approved GameModels3D pasc106 model (hardpoints, part bounds and plan/section cuts) and converted
once by `P`; shapes are original approximations of the reference's fittings at their measured
sizes. No reference geometry is loaded.
"""
import math
import bmesh
from mathutils import Vector, Matrix
from pensacola_kit import P, R, ZC
from pensacola_bulwarks import BULWARKS


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
    station = H['length'] / 2 - (zref - ZC)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])

            def w(sec):
                # A height above this station's deck edge (the sheer rises toward the next station) reads the
                # deck edge's own half-breadth, not zero.
                yy = min(y, sec['points'][-1][1] - 1e-3)
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= yy <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (yy - y0) / (y1 - y0))
                return best
            return w(s0) * (1 - t) + w(s1) * t
    return 0.0


def deck(kit, zref):
    H = kit.D['hull']
    station = H['length'] / 2 - (zref - ZC)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][-1][1] * (1 - t) + s1['points'][-1][1] * t
    return 3.9


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def wall(kit, aid, col, label, pts, y0, y1, t=.06, closed=False, material='naval', rail=True):
    """A thin plate wall along a plan polyline [(x, z), ...] (reference frame) from y0 to y1, with a
    rolled top edge; one mesh."""
    seq = list(pts) + ([pts[0]] if closed else [])
    vv, ff = [], []
    for (ax, az), (bx, bz) in zip(seq, seq[1:]):
        dx, dz = bx - ax, bz - az
        n = math.hypot(dx, dz)
        if n < 1e-3:
            continue
        ox, oz = -dz / n * t / 2, dx / n * t / 2
        base = len(vv)
        for (px, pz) in ((ax - ox, az - oz), (bx - ox, bz - oz), (bx + ox, bz + oz), (ax + ox, az + oz)):
            vv.append(P(px, y0, pz))
        for (px, pz) in ((ax - ox, az - oz), (bx - ox, bz - oz), (bx + ox, bz + oz), (ax + ox, az + oz)):
            vv.append(P(px, y1, pz))
        ff += [(base, base + 1, base + 2, base + 3), (base + 4, base + 7, base + 6, base + 5), (base, base + 4, base + 5, base + 1),
               (base + 1, base + 5, base + 6, base + 2), (base + 2, base + 6, base + 7, base + 3), (base + 3, base + 7, base + 4, base)]
    if not vv:
        return None
    ob = fix_normals(kit.tag(kit.mesh(f'{aid}.{label}', vv, ff, material, col), aid))
    if rail:
        for (ax, az), (bx, bz) in zip(seq, seq[1:]):
            kit.member(aid, col, V(ax, y1, az), V(bx, y1, bz), t * .75, 'naval', 6)
    return ob


# ---------------------------------------------------------------- gun tubs and open platforms
def bulwarks(D, kit):
    """Rolled top edges of the gun-tub and platform bulwarks; the plating itself is blueprint structure."""
    col = kit.collections['Superstructure']
    for w in BULWARKS:
        aid = 'bulwark-rails'
        if 'wall' in w:
            # Traced plate walls carry their measured top at every vertex: the rolled edge follows it.
            for (ax, az, _, at), (bx, bz, _, bt) in zip(w['wall'], w['wall'][1:]):
                if math.hypot(bx - ax, bz - az) > .02:
                    kit.member(aid, col, V(ax, at + .01, az), V(bx, bt + .01, bz), .045, 'naval', 6)
            continue
        pts = [tuple(p) for p in (w.get('ring') or w['chain'])]
        if 'ring' in w:
            pts.append(pts[0])
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            if math.hypot(bx - ax, bz - az) > .02:
                kit.member(aid, col, V(ax, w['y1'] + .01, az), V(bx, w['y1'] + .01, bz), .045, 'naval', 6)


# ---------------------------------------------------------------- masts and the aircraft crane
def foremast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    # Tripod (plan cuts every 2 m): the raked main leg from inside the bridge up to the top house, and
    # two side legs from the gun-sponson deck converging on it.
    taper(kit, aid, col, 'main leg', (0, 15.2, -28.95), (0, 30.6, -27.55), .38, .34, 'naval', 18)
    for s in (-1, 1):
        taper(kit, aid, col, 'side leg', (s * 5.63, 9.2, -22.16), (s * 1.18, 31.0, -26.04), .32, .3, 'naval', 16)
        kit.cylz(aid, col, 'leg foot', V(s * 5.63, 0, -22.16)[:2] + (9.18,), .5, .14, 'edge', 16)
    # The foretop platform's spider (plan cuts every 0.2 m from 22.8 to 24.8 m): five struts fan up and forward
    # from a collar on the main leg at 22.9 m to the platform's underside, and one strut up from each side leg
    # to its outer corner. No struts join the side legs to the main leg.
    kit.cylz(aid, col, 'spider collar', V(0, 0, -28.32)[:2] + (22.75,), .46, .3, 'naval', 18)
    for (x0, z0), (x1, z1) in [((0, -28.5), (0, -30.28)), ((.22, -28.4), (1.52, -29.74)), ((.3, -28.25), (2.36, -29.05))]:
        for s in ((-1, 1) if x1 else (1,)):
            kit.member(aid, col, V(s * x0, 22.95, z0), V(s * x1, 24.7, z1), .055, 'naval', 8)
    for s in (-1, 1):
        kit.member(aid, col, V(s * 2.8, 23.15, -24.8), V(s * 3.15, 24.7, -26.42), .055, 'naval', 8)
    # Topmast behind the director top, carrying the CXAM, with its bracket to the top house.
    taper(kit, aid, col, 'topmast', (0, 30.4, -24.08), (0, 38.05, -24.08), .18, .15, 'naval', 12)
    kit.member(aid, col, V(0, 31.2, -24.08), V(0, 31.2, -25.3), .08)
    kit.member(aid, col, V(0, 33.6, -24.08), V(0, 33.6, -24.6), .08)
    # Signal yard across the director top, with its footropes and the wind instruments.
    taper(kit, aid, col, 'yard', (-6.95, 33.2, -24.44), (6.95, 33.2, -24.44), .08, .08, 'naval', 8)
    for s in (-1, 1):
        kit.member(aid, col, V(s * 2.9, 33.2, -24.42), V(s * 2.9, 33.55, -24.42), .03)
        kit.cylz(aid, col, 'wind vane', V(s * 2.9, 0, -24.42)[:2] + (33.5,), .12, .3, 'edge', 8)
    kit.ladder(aid, col, V(0, 17.6, -28.5), V(0, 24.6, -27.95), (0, 1, 0), .42)


def mainmast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'mainmast'
    # Pole mainmast raked aft from the boat deck abaft the after funnel, with its topmast, yard and gaff.
    taper(kit, aid, col, 'mast', (0, 6.3, 24.52), (0, 29.8, 27.2), .19, .09, 'naval', 14)
    taper(kit, aid, col, 'topmast', (0, 29.6, 27.18), (0, 31.3, 27.37), .08, .05, 'naval', 8)
    taper(kit, aid, col, 'yard', (-4.6, 24.0, 26.63), (4.6, 24.0, 26.63), .07, .05, 'naval', 8)
    kit.member(aid, col, V(0, 21.6, 26.36), V(0, 23.9, 29.6), .06)       # gaff to the ensign's hoist
    kit.boxc(aid, col, 'lookout platform', V(0, 20.7, 26.0), (1.6, 1.6, .08), 'roof')
    kit.ladder(aid, col, V(0, 6.6, 24.85), V(0, 20.6, 26.45), (0, 1, 0), .38)
    # After tower (plan cuts every 0.2-0.6 m): two forward struts raked up past the platform's forward edge to the
    # top of its bulwark (16.8 m at z 37.4), two after legs converging on the platform, and the centre post under
    # the Mk 19. The struts carry no cross-bracing.
    for s in (-1, 1):
        taper(kit, aid, col, 'forward strut', (s * 2.74, 6.3, 24.79), (s * 2.74, 16.8, 37.4), .33, .28, 'naval', 16)
        taper(kit, aid, col, 'after leg', (s * 3.43, 6.2, 42.86), (s * 1.43, 15.15, 41.22), .33, .3, 'naval', 16)
        kit.cylz(aid, col, 'strut foot', V(s * 2.74, 0, 24.79)[:2] + (6.22,), .45, .12, 'edge', 14)
    taper(kit, aid, col, 'centre post', (0, 6.2, 37.7), (0, 13.2, 38.4), .3, .27, 'naval', 16)


def crane(D, kit):
    """Aircraft crane between the funnels: king post with its after brace, and a cranked lattice
    jib from the post's foot reaching forward over the catapults (reference side view and bounds)."""
    col = kit.collections['Boats and aviation']
    aid = 'aircraft-crane'
    # Plan cuts of the reference crane every 1.5-2 m: king post at z 8.94 (0.52 m across), two braces
    # splayed aft to the deck, jib chords 1.3 m apart at the heel closing to 0.5 m at the head.
    foot = kit.below(*V(0, 0, 8.94)[:2], 8.0, 6.3)
    taper(kit, aid, col, 'king post', (0, foot, 8.94), (0, 16.7, 8.9), .27, .25, 'naval', 18)
    kit.cylz(aid, col, 'post collar', V(0, 0, 8.94)[:2] + (foot,), .6, .45, 'naval', 20, r2=.34)
    kit.cylz(aid, col, 'post cap', V(0, 0, 8.9)[:2] + (16.7,), .34, .3, 'edge', 16)
    for s in (-1, 1):
        brace_foot = kit.below(*V(s * 3.45, 0, 13.75)[:2], 8.0, 6.3)
        kit.member(aid, col, V(s * .25, 16.3, 9.3), V(s * 3.45, brace_foot, 13.75), .11, 'naval', 10)
        kit.cylz(aid, col, 'brace foot', V(s * 3.45, 0, 13.75)[:2] + (brace_foot,), .22, .12, 'edge', 10)
    # Cranked jib: heel at the post foot, knee over the catapult deck, head with the hook.
    pivot = V(0, 7.2, 9.0)
    knee = V(0, 16.7, 3.5)
    head = V(0, 23.0, -6.3)
    kit.lattice(aid, col, pivot, knee, 1.25, .5, 10, .06, .035)
    kit.lattice(aid, col, knee, head, .9, .4, 10, .05, .03)
    kit.boxc(aid, col, 'jib heel', pivot, (.7, 1.4, .45), 'edge')
    kit.boxc(aid, col, 'jib head', head, (.7, .35, .4), 'edge')
    for s in (-.2, .2):
        kit.wire(aid, col, V(s, 16.6, 8.9), V(s, 16.9, 3.6), .025, False)
    kit.wire(aid, col, V(0, 22.8, -6.35), V(0, 21.2, -6.4), .015, False)
    kit.boxc(aid, col, 'hook', V(0, 21.05, -6.4), (.2, .12, .3), 'black')


# ---------------------------------------------------------------- aviation
def catapults(D, kit):
    """Two powder catapults on the pedestals abreast the forward funnel (HP_AC, plane start and
    end datums), trained fore and aft and fitted empty: turntable, lattice girder, rails and car."""
    col = kit.collections['Boats and aviation']
    for s in (-1, 1):
        aid = 'catapult-' + ('port' if s < 0 else 'starboard')
        px, py, pz = 7.31 * s, 6.258, -5.949
        top = kit.below(*V(px, 0, pz)[:2], py + .5, py - .2)
        kit.cylz(aid, col, 'turntable', V(px, 0, pz)[:2] + (top,), 1.55, py + .12 - top, 'edge', 32)
        kit.cylz(aid, col, 'training rack', V(px, 0, pz)[:2] + (py + .1,), 1.2, .22, 'naval', 28)
        a, b = V(px, 6.95, 5.05), V(px, 6.95, -16.4)
        kit.lattice(aid, col, a, b, 1.25, .95, 18, .07, .04)
        kit.boxc(aid, col, 'rail deck', (a + b) / 2 + Vector((0, 0, .52)), ((a - b).length, 1.0, .08), 'edge')
        for t in (-.36, .36):
            kit.member(aid, col, a + Vector((0, t, .6)), b + Vector((0, t, .6)), .05, 'edge', 6)
        kit.boxc(aid, col, 'car', V(px, 7.72, -1.4), (1.8, 1.2, .28), 'edge')
        kit.boxc(aid, col, 'powder chamber', V(px, 7.1, 3.6), (2.2, 1.3, 1.0), 'naval')
        for zz in (-9.0, -2.3):
            kit.member(aid, col, V(px, py + .2, pz), V(px, 6.5, zz), .14)
        # Aircraft cradle and dolly stowed on the deck beside it.
        c = V(s * 8.34, 6.62, 8.65)
        kit.boxc(aid, col, 'aircraft cradle', c, (2.42, 1.52, .5), 'edge')
    # Spare seaplane float on the deckhouse roof abaft the forward funnel.
    aid = 'spare-float'
    y = kit.below(*V(0, 0, -10.62)[:2], 8.0, 6.6)
    kit.part('rod', aid, col, 'float', V(-3.9, y + .52, -10.62), V(3.9, y + .52, -10.62), .45, 'naval', r2=.2, vertices=14)
    for xx in (-2.2, 1.8):
        kit.boxc(aid, col, 'float chock', V(xx, y + .07, -10.62), (.9, .3, .16), 'edge')


# ---------------------------------------------------------------- fire control and sensors
def director_mk19(kit, aid, col, hp, face, pivot_name=None):
    """Mk 19 director (part bounds 4.98 x 3.46 x 3.01 m): a round training base, a boxy house with a
    sloped face, its rangefinder arms out to either side, sight hoods and hatches."""
    bx, by, bz = P(*hp)
    floor = kit.below(bx, by, bz - .6, bz - .7)
    if bz - floor > .05:
        # The director's trunk down to the platform it stands on.
        kit.cylz(aid, col, 'director trunk', (bx, by, floor - .02), 1.05, bz - floor - .06, 'naval', 32)
    pivot = kit.empty((pivot_name or aid) + '.yaw', (bx, by, bz), assembly=pivot_name or aid, col=col)
    s = 1 if face == 0 else -1
    local(kit.cylz(aid, col, 'director base', (bx, by, bz - .12), 1.25, .42, 'naval', 32), pivot)
    # The house in plan: square-fronted with its four vertical edges chamfered (the reference's rounded corners),
    # 3.6 m long and 2.9 m wide, and a low hood along the roof's front edge over the sighting ports.
    house = [(1.95, -1.05), (1.95, 1.05), (1.6, 1.45), (-1.35, 1.45), (-1.65, 1.15), (-1.65, -1.15), (-1.35, -1.45), (1.6, -1.45)]
    pts = [(bx + s * x, by + y) for x, y in house]
    local(kit.prism(aid, col, 'director house', pts, bz + .3, bz + 2.05, 'naval', 'roof'), pivot)
    hood = [(1.95, -1.0), (1.95, 1.0), (1.35, 1.3), (1.35, -1.3)]
    local(kit.prism(aid, col, 'sight hood', [(bx + s * x, by + y) for x, y in hood], bz + 2.05, bz + 2.28, 'naval', 'roof'), pivot)
    for side in (-1, 1):
        local(kit.part('rod', aid, col, 'rangefinder arm', (bx - s * .2, by + side * 1.4, bz + 1.55), (bx - s * .2, by + side * 2.45, bz + 1.55), .26, 'naval', vertices=14), pivot)
        local(kit.boxc(aid, col, 'rangefinder hood', (bx - s * .2, by + side * 2.4, bz + 1.55), (.62, .3, .62), 'naval'), pivot)
        local(kit.part('rod', aid, col, 'rangefinder window', (bx - s * .2 + s * .3, by + side * 2.4, bz + 1.55), (bx - s * .2 + s * .34, by + side * 2.4, bz + 1.55), .12, 'glass', vertices=10), pivot)
        for k in (-1, 1):
            local(kit.boxc(aid, col, 'sight port', (bx + s * 1.96, by + side * .55 + k * .18, bz + 1.75), (.05, .26, .2), 'glass'), pivot)
        local(kit.boxc(aid, col, 'roof hatch', (bx - s * .6, by + side * .75, bz + 2.09), (.8, .7, .08), 'edge'), pivot)
    return pivot


def director_mk44(kit, aid, col, hp, bearing_deg):
    """Mk 44 director (1.9 m tall): a pedestal, a training head with the sight and its handles."""
    c = V(*hp)
    floor = kit.below(c.x, c.y, c.z + .2, c.z - .6)
    kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, floor - .01)), .16, c.z - floor + .9, 'naval', 12, r2=.12)
    kit.cylz(aid, col, 'pedestal foot', Vector((c.x, c.y, floor - .01)), .34, .1, 'edge', 14)
    head = c + Vector((0, 0, .95))
    a = math.radians(bearing_deg)
    d = Vector((math.cos(a), -math.sin(a), 0))     # bearing 0 is the bow (+X), 90 starboard (-Y)
    kit.part('rod', aid, col, 'sight body', head - d * .55, head + d * .45, .2, 'naval', vertices=12)
    kit.part('rod', aid, col, 'sight lens', head + d * .45, head + d * .5, .14, 'glass', vertices=12)
    side = Vector((-d.y, d.x, 0))
    for k in (-1, 1):
        kit.part('rod', aid, col, 'handle', head + side * .15 * k - d * .2, head + side * .5 * k - d * .25 - Vector((0, 0, .15)), .03, 'edge', vertices=6)
        kit.part('rod', aid, col, 'sight bracket', head + side * .12 * k, head + side * .3 * k + Vector((0, 0, .16)), .03, 'edge', vertices=6)
        kit.part('rod', aid, col, 'trainer\'s sight', head + side * .32 * k + Vector((0, 0, .16)), head + side * .32 * k + d * .3 + Vector((0, 0, .16)), .05, 'edge', vertices=8)


def directors(D, kit):
    col = kit.collections['Sensors and masts']
    # Mk 19 directors for the 5-inch battery (HP_AD_1 forward on the bridge top, HP_AD_5 aft facing aft).
    director_mk19(kit, 'secondary-director-forward', col, (0, 18.662, -34.047), 0)
    director_mk19(kit, 'secondary-director-after', col, (0, 16.959, 40.490), 180)
    # Mk 44 directors for the 1.1-inch mounts: abreast the foremast on the bridge top and on the quarterdeck.
    for aid, hp, bearing in [('aa-director-port', (-2.466, 17.688, -28.21), -90), ('aa-director-starboard', (2.466, 17.688, -28.21), 90),
                             ('aa-director-after-port', (-2.587, 4.755, 76.68), 180), ('aa-director-after-starboard', (2.588, 4.755, 76.68), 180)]:
        director_mk44(kit, aid, col, hp, bearing)
    # Mk 22 main battery director on the foremast top (HP_AD_4), trained by the rig: a box with its
    # rangefinder arms and roof hatches (part bounds 2.78 x 3.0 x 2.3 m).
    did = 'main-director'
    bx, by, bz = P(0, 34.748, -26.932)
    pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
    local(kit.cylz(did, col, 'training base', (bx, by, bz - .1), 1.05, .42, 'edge', 24), pivot)
    local(kit.boxc(did, col, 'director house', (bx - .15, by, bz + 1.05), (2.9, 1.9, 1.5), 'naval'), pivot)
    local(kit.boxc(did, col, 'director roof', (bx - .15, by, bz + 1.85), (2.6, 1.7, .1), 'roof'), pivot)
    for side in (-1, 1):
        local(kit.boxc(did, col, 'rangefinder arm', (bx + .35, by + side * 1.15, bz + 1.45), (1.0, .5, .55), 'naval'), pivot)
        local(kit.boxc(did, col, 'rangefinder window', (bx + .86, by + side * 1.2, bz + 1.45), (.04, .3, .16), 'glass'), pivot)
        local(kit.boxc(did, col, 'roof hatch', (bx - .8, by + side * .45, bz + 1.92), (.5, .5, .08), 'edge'), pivot)
    local(kit.boxc(did, col, 'sight hood', (bx + 1.25, by, bz + 1.2), (.3, 1.2, .5), 'naval'), pivot)
    # Mk 18 after main battery director (HP_AD_6): a pedestal director on the after tower, trained by the rig.
    did = 'after-director'
    bx, by, bz = P(0.04, 12.009, 42.555)
    pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
    local(kit.cylz(did, col, 'pedestal', (bx, by, bz), .26, 1.0, 'naval', 14), pivot)
    local(kit.boxc(did, col, 'sight head', (bx + .05, by, bz + 1.45), (1.0, .8, .9), 'naval'), pivot)
    local(kit.boxc(did, col, 'hood', (bx + .05, by, bz + 1.95), (.9, .75, .1), 'roof'), pivot)
    for side in (-1, 1):
        local(kit.part('rod', did, col, 'telescope', (bx + .5, by + side * .25, bz + 1.6), (bx + .72, by + side * .25, bz + 1.6), .07, 'glass', vertices=8), pivot)


def rangefinders(D, kit):
    """2.7 m rangefinder on the foretop (HP_AF_1, bounds 2.9 x 1.09 x 1.88 m): pedestal, tube and hoods."""
    col = kit.collections['Sensors and masts']
    aid = 'rangefinder-2m7'
    c = V(0, 25.112, -30.822)
    floor = kit.below(c.x, c.y, c.z + .3, c.z - .5)
    kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, floor - .01)), .22, c.z - floor + .75, 'naval', 14)
    kit.boxc(aid, col, 'operator hood', c + Vector((-.1, 0, 1.0)), (.9, 1.0, .7), 'naval')
    kit.part('rod', aid, col, 'rangefinder tube', c + Vector((0, -1.45, 1.25)), c + Vector((0, 1.45, 1.25)), .15, 'naval', vertices=14)
    for t in (-1, 1):
        kit.boxc(aid, col, 'end hood', c + Vector((0, t * 1.35, 1.25)), (.36, .24, .36), 'naval')
        kit.boxc(aid, col, 'end window', c + Vector((.18, t * 1.35, 1.25)), (.02, .16, .14), 'glass')


def radars(D, kit):
    """CXAM bedspring aerial on the topmast (HP_ARS_1, bounds 6.3 x 2.15 x 5.33 m), trained by the rig."""
    col = kit.collections['Sensors and masts']
    rid = 'cxam-radar'
    bx, by, bz = P(0, 38.159, -24.121)
    pivot = kit.empty(rid + '.yaw', (bx, by, bz), assembly=rid, col=col)
    local(kit.cylz(rid, col, 'turntable', (bx, by, bz - .1), .45, .25, 'edge', 18), pivot)
    local(kit.boxc(rid, col, 'pedestal', (bx, by, bz + .45), (.5, .5, .75), 'naval'), pivot)
    w, h = 6.2, 4.3
    zc = bz + .85 + h / 2
    frame = kit.boxc(rid, col, 'reflector screen', (bx - .1, by, zc), (.05, w, h), 'dark')
    local(frame, pivot)
    for i in range(11):
        yy = -w / 2 + w * i / 10
        local(kit.part('rod', rid, col, 'dipole column', (bx + .05, by + yy, zc - h / 2), (bx + .05, by + yy, zc + h / 2), .025, 'edge', vertices=5), pivot)
    for j in range(7):
        zz = zc - h / 2 + h * j / 6
        local(kit.part('rod', rid, col, 'dipole row', (bx + .05, by - w / 2, zz), (bx + .05, by + w / 2, zz), .025, 'edge', vertices=5), pivot)
    for yy in (-w / 2, w / 2):
        local(kit.part('rod', rid, col, 'frame', (bx - .02, by + yy, zc - h / 2), (bx - .02, by + yy, zc + h / 2), .07, 'naval', vertices=8), pivot)
    for zz in (zc - h / 2, zc + h / 2):
        local(kit.part('rod', rid, col, 'frame', (bx - .02, by - w / 2, zz), (bx - .02, by + w / 2, zz), .07, 'naval', vertices=8), pivot)
    local(kit.part('rod', rid, col, 'spine', (bx - .02, by, bz + .8), (bx - .02, by, zc + h / 2), .08, 'naval', vertices=8), pivot)
    for s in (-1, 1):
        local(kit.part('rod', rid, col, 'brace', (bx - .02, by, bz + .8), (bx - .02, by + s * w * .45, zc - h / 2), .05, 'naval', vertices=6), pivot)
    # Radio direction finder loop on the house abaft the bridge top (am239_rdf, 1.92 m tall).
    aid = 'rdf-loop'
    c = V(0, 20.59, -24.10)
    floor = kit.below(c.x, c.y, 20.0, 19.6)
    kit.part('rod', aid, col, 'loop post', Vector((c.x, c.y, floor - .02)), c + Vector((0, 0, .1)), .05, 'naval', vertices=8)
    for i in range(16):
        a0, a1 = math.tau * i / 16, math.tau * (i + 1) / 16
        p0 = c + Vector((0, .5 * math.cos(a0), .55 + .5 * math.sin(a0)))
        p1 = c + Vector((0, .5 * math.cos(a1), .55 + .5 * math.sin(a1)))
        kit.member(aid, col, p0, p1, .03, 'edge', 5)


def searchlight(kit, aid, col, c, barrel_r, bearing_deg=0, floor=None):
    floor = kit.below(c.x, c.y, c.z + .3, c.z - .8) if floor is None else floor
    kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, floor - .01)), .22, c.z - floor + .55, 'naval', 14)
    a = math.radians(bearing_deg)
    d = Vector((math.cos(a), -math.sin(a), 0))
    head = c + Vector((0, 0, .55 + barrel_r + .1))
    kit.boxc(aid, col, 'yoke', c + Vector((0, 0, .6)), (.35, barrel_r * 2.4, .16), 'naval')
    kit.part('rod', aid, col, 'barrel', head - d * barrel_r * .9, head + d * barrel_r * .95, barrel_r, 'naval', vertices=20)
    kit.part('rod', aid, col, 'lens', head + d * barrel_r * .95, head + d * (barrel_r * .95 + .04), barrel_r * .9, 'glass', vertices=20)
    kit.part('rod', aid, col, 'lamp house', head - d * barrel_r * 1.2, head - d * barrel_r * .85, barrel_r * .7, 'naval', vertices=14)


def searchlights(D, kit):
    col = kit.collections['Sensors and masts']
    # 36-inch (900 mm) searchlights on the platform round the after funnel (am225, bounds 0.9 x 2.3 m).
    for i, (x, z) in enumerate([(-2.43, 19.71), (2.43, 19.71), (-3.18, 23.92), (3.18, 23.92)], 1):
        searchlight(kit, f'searchlight-{i}', col, V(x, 14.1, z), .45, 90 if x > 0 else -90)
    # 24-inch (600 mm) signal searchlights under the foretop (am038) on their platform between the tripod
    # legs (plan cuts: rails round a 4.1 x 2.0 m deck at 21.0 m), which stands on two box columns (0.34 x 0.30 m
    # at x +-0.74, z -26.19) from the house roof abaft the bridge top at 19.6 m.
    aid = 'searchlight-platform'
    kit.boxc(aid, col, 'platform', V(0, 20.93, -26.2), (2.0, 4.1, .12), 'roof')
    for s in (-1, 1):
        kit.boxc(aid, col, 'column', V(s * .74, 20.26, -26.19), (.3, .34, 1.28), 'naval')
    corners = [(-2.03, -26.6), (-1.6, -27.21), (1.6, -27.21), (2.03, -26.6), (2.03, -25.8), (1.6, -25.17), (-1.6, -25.17), (-2.03, -25.8)]
    kit.rail(aid, col, [V(x, 0, z)[:2] for x, z in corners], 20.99, .6, 1.0, True, False)
    for i, x in enumerate((-.74, .74), 5):
        searchlight(kit, f"searchlight-{i}", col, V(x, 21.02, -26.19), .3, 0, 20.99)
    # Sky lookout stations on the bridge top (am061): a pedestal seat with binoculars.
    for i, (x, z) in enumerate([(-1.79, -31.06), (1.79, -31.06), (-2.10, -25.94), (2.10, -25.94)], 1):
        aid = f'sky-lookout-{i}'
        c = V(x, 17.5, z)
        floor = kit.below(c.x, c.y, 18.2, 17.2)
        kit.cylz(aid, col, 'post', Vector((c.x, c.y, floor)), .08, 1.2, 'naval', 10)
        kit.boxc(aid, col, 'seat', Vector((c.x, c.y, floor + .55)), (.4, .4, .08), 'edge')
        kit.part('rod', aid, col, 'binoculars', Vector((c.x - .2, c.y, floor + 1.25)), Vector((c.x + .25, c.y, floor + 1.25)), .09, 'edge', vertices=10)


# ---------------------------------------------------------------- boats
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, covered=False):
    """Original lofted boat hull on its keel point c (authoring frame), bow toward +X."""
    rings = []
    n = 13
    for i in range(n):
        t = i / (n - 1)
        x = (t - .5) * length
        fore = max(0, (t - .6) / .4)
        aft = max(0, (.25 - t) / .25)
        half = beam / 2 * (1 - fore ** 1.7) * (1 - .35 * aft ** 2) + .02
        top = depth * (1 + .12 * fore ** 2)
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append((x, -half * math.cos(a), top - depth * .85 * math.sin(a) ** 1.4 * (1 - .4 * fore) - depth * .15))
        rings.append(ring)
    rot = Matrix.Rotation(heading, 3, 'Z')
    if covered:
        rings = [[tuple(Vector(c) + rot @ Vector(p)) for p in ring] for ring in rings]
        hull = kit.loft(aid, col, 'boat hull', rings, 'naval', True, True, True)
    else:
        # An open boat: a 5 cm shell, the inner face following the outer one, closed along the gunwales and at the
        # transom and stem, so the thwarts and bottom boards show from above.
        inner = []
        for ring in rings:
            half = max(abs(p[1]) for p in ring)
            inner.append([(x, y * max(0.0, 1 - .05 / half), z + .05 * math.sin(math.pi * k / 8)) for k, (x, y, z) in enumerate(ring)])
        place = lambda pts: [tuple(Vector(c) + rot @ Vector(p)) for p in pts]
        outer_w, inner_w = [place(r) for r in rings], [place(r) for r in inner]
        m = len(rings[0])
        vv = [p for r in outer_w for p in r] + [p for r in inner_w for p in r]
        o = lambda i, k: i * m + k
        q = lambda i, k: len(rings) * m + i * m + k
        ff = []
        for i in range(len(rings) - 1):
            for k in range(m - 1):
                ff.append((o(i, k), o(i + 1, k), o(i + 1, k + 1), o(i, k + 1)))
                ff.append((q(i, k), q(i, k + 1), q(i + 1, k + 1), q(i + 1, k)))
            for k in (0, m - 1):
                ff.append((o(i, k), q(i, k), q(i + 1, k), o(i + 1, k)))
        for i in (0, len(rings) - 1):
            ff.append(tuple(o(i, k) for k in range(m)) + tuple(q(i, k) for k in reversed(range(m))))
            ff.append(tuple(q(i, k) for k in range(m)))
        hull = fix_normals(kit.tag(kit.mesh(aid + '.boat hull', vv, ff, 'naval', col), aid))
        kit.boxc(aid, col, 'bottom boards', Vector(c) + rot @ Vector((0, 0, depth * .28)), (length * .7, beam * .5, .04), 'wood', heading)
    if covered:
        kit.boxc(aid, col, 'canopy', Vector(c) + rot @ Vector((-length * .12, 0, depth * .85 + .32)), (length * .4, beam * .6, .6), 'canvas', heading)
    else:
        for k in range(4):
            kit.boxc(aid, col, 'thwart', Vector(c) + rot @ Vector(((k - 1.5) * length * .2, 0, depth * .6)), (.2, beam * .85, .06), 'wood', heading)
    return hull


def boats(D, kit):
    col = kit.collections['Boats and aviation']
    # Two 26 ft motor whaleboats in chocks at the deck edge abaft the mainmast (am091), under their davits.
    for s in (-1, 1):
        aid = 'whaleboat-' + ('port' if s < 0 else 'starboard')
        z0 = 36.12
        floor = kit.below(*V(s * 7.87, 0, z0)[:2], 5.0, 3.9)
        boat(kit, aid, col, V(s * 7.87, floor + .1, z0), 7.9, 2.0, 1.4, math.pi, False)
        # Radial davits (plan cuts at 4.2-7.4 m): posts at the deck edge (x 9.25, z 32.95 and 38.98) standing to
        # 6.4 m, then curving in over the boat's centre line to their heads at 7.75 m.
        for zd in (32.95, 38.98):
            kit.boxc(aid, col, 'chock', V(s * 7.87, floor + .05, zd + (1.0 if zd < z0 else -1.0)), (.3, 1.6, .1), 'edge')
            # The post rides the deck edge (the reference's stands on the sheer strake at x 9.25).
            px = min(9.25, hull_half(kit, zd, floor - .05) - .04)
            pts = [V(s * px, floor - .02, zd), V(s * px, 6.4, zd)]
            for k in range(1, 7):
                a = math.pi / 2 * k / 6
                pts.append(V(s * (7.9 + (px - 7.9) * math.cos(a)), 6.4 + 1.35 * math.sin(a), zd))
            for a_, b_ in zip(pts, pts[1:]):
                kit.part('rod', aid, col, 'davit', a_, b_, .09, 'naval', vertices=10)
            head = pts[-1]
            kit.boxc(aid, col, 'davit block', head + Vector((0, 0, -.25)), (.16, .12, .3), 'edge')
            kit.wire(aid, col, head + Vector((0, 0, -.4)), V(s * 7.87, floor + 1.5, zd + (1.2 if zd < z0 else -1.2)), .015, False)
    # Boat booms stowed on the forecastle and aft (am131 datums) and the Franklin life buoys (am489).
    for s in (-1, 1):
        x = 9.08 + .09      # on the flush side of the midships superstructure (plan cuts: 9.07-9.09 m)
        kit.part('rod', 'life-buoys', col, 'life buoy', V(s * (x - .02), 5.9, 22.59), V(s * (x + .1), 5.9, 22.59), .36, 'white', vertices=16)
        kit.part('rod', 'life-buoys', col, 'buoy bracket', V(s * (x - .02), 6.2, 22.59), V(s * (x - .12), 6.2, 22.59), .04, 'edge', vertices=6)


# Deck stores at the bounds of the reference's own fittings (reference frame min and max corners): ready-use
# lockers, hatches and skylights, signal flag lockers, boat winches, the stack of wooden boxes abaft the forward
# funnel, fuel-oil hoses, floater-net baskets and the Oerlikons' cooling-water tanks. Shapes are simple originals.
DECK_STORES = [
    ('basket', (-4.3, 6.4, -15.34), (-3.84, 6.95, -13.19)),
    ('basket', (3.84, 6.4, -15.34), (4.3, 6.95, -13.19)),
    ('flaglocker-edge', (-5.66, 14.71, -21.18), (-1.8, 16.46, -20.23)),
    ('flaglocker-edge', (1.8, 14.71, -21.18), (5.66, 16.46, -20.23)),
    ('flagbox', (-2.37, 13.42, 25.04), (-0.47, 14.83, 25.78)),
    ('flagbox', (0.47, 13.42, 25.04), (2.37, 14.83, 25.78)),
    ('hatch', (-1.95, 6.95, -79.39), (-1.14, 7.34, -78.42)),
    ('hatch', (-0.44, 6.57, -71.9), (0.46, 6.93, -71.14)),
    ('hatch', (-0.45, 6.49, -70.2), (0.45, 6.86, -69.43)),
    ('hatch', (0.07, 6.15, -64.12), (0.97, 6.52, -63.36)),
    ('hatch', (-0.51, 5.92, -62.81), (0.51, 6.73, -60.75)),
    ('hatch', (0.85, 5.92, -59.85), (1.75, 6.28, -59.08)),
    ('hatch', (-1.64, 5.43, -49.59), (-0.74, 5.79, -48.82)),
    ('hatch', (-5.4, 6.56, 12.88), (-4.5, 6.89, 13.63)),
    ('hatch', (4.5, 6.56, 12.88), (5.4, 6.89, 13.63)),
    ('hatch', (-0.48, 13.34, 18.89), (0.34, 13.65, 19.57)),
    ('hatch', (1.81, 6.57, 19.0), (2.71, 6.9, 19.75)),
    ('hatch', (0.15, 3.86, 30.21), (2.15, 4.26, 32.21)),
    ('hatch', (-2.98, 3.67, 36.02), (-0.7, 4.49, 37.03)),
    ('hatch', (-0.47, 3.85, 36.03), (0.43, 4.18, 36.78)),
    ('hatch', (-1.53, 15.2, 38.81), (-0.93, 15.47, 39.53)),
    ('hatch', (0.58, 3.84, 57.49), (1.48, 4.17, 58.24)),
    ('hatch', (1.4, 3.81, 68.0), (2.3, 4.14, 68.75)),
    ('hatch', (-3.26, 3.77, 70.66), (-2.25, 4.48, 72.71)),
    ('hatch', (2.25, 3.77, 70.66), (3.26, 4.48, 72.71)),
    ('hose', (-6.54, 5.2, -31.87), (-6.2, 5.62, -29.52)),
    ('hose', (6.2, 5.15, -31.87), (6.54, 5.57, -29.52)),
    ('hose', (-6.54, 5.69, -31.86), (-6.2, 6.11, -29.51)),
    ('hose', (6.2, 5.64, -31.86), (6.54, 6.06, -29.51)),
    ('hose', (-0.79, 5.66, -25.71), (1.56, 6.04, -25.36)),
    ('hose', (-0.79, 6.15, -25.71), (1.56, 6.53, -25.36)),
    ('hose', (0.73, 4.55, 4.46), (3.08, 4.93, 4.8)),
    ('hose', (0.73, 4.96, 4.46), (3.08, 5.34, 4.8)),
    ('hose', (-7.58, 4.51, 44.74), (-7.24, 4.89, 47.09)),
    ('hose', (-7.58, 4.94, 44.74), (-7.24, 5.32, 47.09)),
    ('hose', (7.24, 4.51, 44.74), (7.58, 4.89, 47.09)),
    ('hose', (7.24, 4.94, 44.74), (7.58, 5.32, 47.09)),
    ('locker', (1.93, 9.41, -32.93), (3.25, 10.25, -31.43)),
    ('locker', (-2.98, 9.4, -32.52), (-2.16, 11.15, -31.76)),
    ('locker', (-1.8, 24.9, -30.15), (-0.88, 25.97, -29.16)),
    ('locker', (0.88, 24.9, -30.15), (1.8, 25.97, -29.16)),
    ('locker', (-2.53, 12.45, -29.87), (-2.13, 14.15, -29.27)),
    ('locker', (-0.43, 17.45, -29.72), (0.43, 18.52, -29.2)),
    ('locker', (-1.12, 24.9, -28.25), (-0.5, 25.7, -26.86)),
    ('locker', (0.5, 24.9, -28.25), (1.12, 25.7, -26.86)),
    ('locker', (-5.97, 4.56, -26.81), (-4.99, 5.4, -26.25)),
    ('locker', (-3.39, 9.29, -26.46), (-2.01, 10.09, -25.84)),
    ('locker', (5.51, 4.47, -26.43), (5.91, 6.17, -25.83)),
    ('locker', (5.51, 4.47, -25.8), (5.91, 6.17, -25.2)),
    ('locker', (-1.91, 24.9, -25.53), (-0.53, 25.7, -24.91)),
    ('locker', (0.53, 24.9, -25.53), (1.91, 25.7, -24.91)),
    ('locker', (1.62, 9.21, -24.6), (2.23, 10.51, -24.2)),
    ('locker', (-1.41, 14.91, -22.97), (-0.03, 15.71, -22.35)),
    ('locker', (0.03, 14.91, -22.97), (1.41, 15.71, -22.35)),
    ('locker', (-3.82, 9.1, -19.77), (-2.84, 9.94, -19.21)),
    ('locker', (2.84, 9.1, -19.77), (3.82, 9.94, -19.21)),
    ('locker', (-3.83, 6.97, -18.77), (-3.32, 7.47, -16.07)),
    ('locker', (3.32, 6.97, -18.77), (3.83, 7.47, -16.07)),
    ('locker', (2.02, 4.16, 2.83), (3.24, 5.58, 4.05)),
    ('locker', (-3.24, 4.16, 3.38), (-2.02, 5.58, 4.6)),
    ('locker', (2.27, 6.57, 14.35), (3.03, 7.15, 15.75)),
    ('locker', (2.27, 6.57, 15.86), (3.03, 7.15, 17.26)),
    ('locker', (-2.96, 6.58, 20.02), (-1.75, 7.8, 21.32)),
    ('locker', (1.75, 6.58, 20.02), (2.96, 7.8, 21.32)),
    ('locker', (-4.24, 3.95, 22.99), (-3.68, 4.79, 23.97)),
    ('locker', (3.68, 3.95, 22.99), (4.24, 4.79, 23.97)),
    ('locker', (-2.65, 6.58, 23.83), (-1.93, 7.73, 24.77)),
    ('locker', (1.93, 6.58, 23.83), (2.65, 7.73, 24.77)),
    ('locker', (-1.9, 6.58, 28.34), (-0.7, 7.8, 29.64)),
    ('locker', (0.7, 6.58, 28.34), (1.9, 7.8, 29.64)),
    ('locker', (0.25, 3.88, 28.63), (1.36, 4.79, 29.26)),
    ('locker', (-0.73, 6.23, 31.78), (-0.13, 6.88, 33.43)),
    ('locker', (0.13, 6.23, 31.78), (0.73, 6.88, 33.43)),
    ('locker', (-1.55, 15.29, 37.64), (-0.7, 16.36, 38.16)),
    ('locker', (2.58, 3.89, 39.6), (2.98, 5.19, 40.2)),
    ('locker', (-1.79, 15.29, 40.11), (-1.32, 15.9, 40.88)),
    ('locker', (1.32, 15.29, 40.11), (1.79, 15.9, 40.88)),
    ('locker', (2.59, 3.89, 40.26), (2.99, 5.19, 40.86)),
    ('locker', (-0.38, 15.29, 41.81), (0.38, 15.9, 42.27)),
    ('locker', (-2.19, 6.24, 43.9), (-1.21, 7.08, 44.46)),
    ('locker', (-1.36, 3.82, 81.46), (-0.51, 4.89, 81.98)),
    ('locker', (0.51, 3.82, 81.46), (1.36, 4.89, 81.98)),
    ('skylight', (-1.7, 6.54, 19.9), (-0.12, 7.33, 21.2)),
    ('skylight', (0.12, 6.54, 19.9), (1.7, 7.33, 21.2)),
    ('tube', (-2.26, 25.05, -30.1), (-1.9, 26.05, -29.81)),
    ('tube', (1.89, 25.05, -30.09), (2.25, 26.05, -29.8)),
    ('tube', (-3.31, 24.97, -25.65), (-2.71, 25.91, -25.09)),
    ('tube', (2.67, 24.95, -25.56), (3.21, 25.94, -25.05)),
    ('tube', (-3.59, 15.36, 39.77), (-3.32, 16.36, 40.13)),
    ('tube', (3.32, 15.36, 39.77), (3.58, 16.36, 40.14)),
    ('tube', (-3.08, 15.36, 41.96), (-2.82, 16.36, 42.33)),
    ('tube', (2.81, 15.36, 41.97), (3.08, 16.36, 42.34)),
    ('winch', (2.83, 6.57, 21.67), (4.83, 7.15, 23.09)),
    ('winch', (-4.83, 6.57, 21.7), (-2.83, 7.15, 23.12)),
    ('winch', (-1.28, 6.55, 25.28), (-0.42, 7.4, 26.22)),
    ('winch', (0.42, 6.55, 25.28), (1.28, 7.4, 26.22)),
    ('winch', (-0.94, 3.81, 70.68), (0.94, 4.58, 73.34)),
    ('woodbox', (-2.35, 9.14, -21.59), (0.01, 9.46, -20.75)),
    ('woodbox', (-2.35, 9.45, -21.59), (0.01, 9.77, -20.75)),
    ('woodbox', (-2.35, 9.76, -21.59), (0.01, 10.09, -20.75)),
    ('woodbox', (0.03, 9.14, -21.59), (2.39, 9.46, -20.75)),
    ('woodbox', (0.03, 9.45, -21.59), (2.39, 9.77, -20.75)),
    ('woodbox', (0.03, 9.76, -21.59), (2.39, 10.09, -20.75)),
    ('woodbox', (-2.35, 9.14, -20.75), (0.01, 9.46, -19.91)),
    ('woodbox', (-2.35, 9.45, -20.75), (0.01, 9.77, -19.91)),
    ('woodbox', (-2.35, 9.76, -20.75), (0.01, 10.09, -19.91)),
    ('woodbox', (0.03, 9.14, -20.75), (2.39, 9.46, -19.91)),
    ('woodbox', (0.03, 9.45, -20.75), (2.39, 9.77, -19.91)),
    ('woodbox', (0.03, 9.76, -20.75), (2.39, 10.09, -19.91)),
]

def deck_stores(D, kit):
    """The deck stores of DECK_STORES as simple original shapes, each seated on the deck or platform under it
    (dropped where our deck lies more than 0.35 m off the reference's); the wooden boxes keep their stacking."""
    col = kit.collections['Deck fittings']
    aid = 'deck-stores'
    boxes = [r for r in DECK_STORES if r[0] == 'woodbox']
    stack_base = min(mn[1] for _, mn, _ in boxes)
    sc = V(*[sum((mn[i] + mx[i]) / 2 for _, mn, mx in boxes) / len(boxes) for i in range(3)])
    stack_shift = kit.below(sc.x, sc.y, stack_base + .5, stack_base) - stack_base
    skipped = swept = 0
    main = [a for a in kit.arcs if a[5]['battery'] == 'main']

    def main_arc(p):
        # A point the 8-inch gunhouses sweep (within their overhang, above their sole) or the barrels reach at full
        # depression (as Kit.in_arc, main battery only: the light mounts' interlocks already stop them at the stores).
        for mx_, my_, mz_, house, w, m in main:
            d = math.hypot(p[0] - mx_, p[1] - my_)
            if d < house and p[2] > mz_ - .05:
                return True
            # The barrels reach only bearings inside the mount's training limits (authoring +X is the bow, +Y port).
            bearing = math.degrees(math.atan2(-(p[1] - my_), p[0] - mx_))
            off = (bearing - m['bearingDeg'] + 180) % 360 - 180
            if abs(off) > w.get('traverseDeg', 180) + 5:
                continue
            low = mz_ + w['pivotHeight'] + math.sin(math.radians(w['elevationMinDeg'])) * max(0, d - w['trunnionForward']) - w.get('barrelBaseRadius', .4) - .15
            if d < w['muzzleForward'] + .6 and p[2] > low:
                return True
        return False

    for kind, mn, mx in DECK_STORES:
        cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
        sx, sy, sz = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
        c = V(cx, 0, cz)
        if kind == 'woodbox':
            shift = stack_shift
        elif kind in ('hose', 'basket', 'flaglocker-edge'):
            # Hung on a deckhouse side, or (the signal flag lockers abaft the bridge wings) standing against the
            # platform's after edge, at the reference's height.
            shift = 0.0
        else:
            # The best of the supports under the centre and the four corners (inset 0.1 m) that lies within 0.35 m
            # of the reference's footing: a store on a platform edge still finds the platform.
            shifts = []
            for fx, fz in ((0, 0), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                q = V(cx + fx * (sx / 2 - .1), 0, cz + fz * (sz / 2 - .1))
                d = kit.below(q.x, q.y, mx[1] + .2, mn[1] - 5) - mn[1]
                if abs(d) <= .35:
                    shifts.append(d)
            if not shifts:
                skipped += 1
                continue
            shift = max(shifts)
        base = Vector((c.x, c.y, mn[1] + shift))
        # Stores the turrets' gunhouses or depressed barrels would sweep through are left off (the reference keeps
        # hatches and a winch under No. 1's overhang and No. 4's barrels, where the guns would strike them).
        corners = [V(cx + fx * sx / 2, 0, cz + fz * sz / 2) for fx in (-1, 0, 1) for fz in (-1, 0, 1)]
        if any(main_arc((q.x, q.y, base.z + sy)) for q in corners):
            swept += 1
            print('deck store in a turret\'s swept space:', kind, mn, mx)
            continue
        # Authoring box size is (fore-aft, athwart, up).
        if kind == 'locker':
            kit.boxc(aid, col, 'locker', base + Vector((0, 0, sy * .45)), (sz, sx, sy * .9), 'naval')
            kit.boxc(aid, col, 'locker lid', base + Vector((0, 0, sy * .95)), (sz + .04, sx + .04, sy * .1), 'edge')
        elif kind in ('hatch', 'skylight'):
            kit.boxc(aid, col, 'hatch coaming', base + Vector((0, 0, sy * .4)), (sz, sx, sy * .8), 'naval')
            kit.boxc(aid, col, 'hatch cover' if kind == 'hatch' else 'skylight glazing', base + Vector((0, 0, sy * .9)),
                     (sz * .92, sx * .92, sy * .2), 'roof' if kind == 'hatch' else 'glass')
        elif kind in ('flagbox', 'flaglocker-edge'):
            kit.boxc(aid, col, 'flag locker', base + Vector((0, 0, sy * .42)), (sz, sx, sy * .84), 'naval')
            kit.boxc(aid, col, 'flag locker lid', base + Vector((0, 0, sy * .9)), (sz + .06, sx + .06, sy * .12), 'edge')
        elif kind == 'winch':
            kit.boxc(aid, col, 'winch bed', base + Vector((0, 0, .08)), (sz, sx, .16), 'edge')
            along_x = sx >= sz
            r = min(sy * .35, (sz if along_x else sx) * .3)
            a = base + Vector((0, 0, .16 + r))
            half = Vector((0, sx * .42, 0)) if along_x else Vector((sz * .42, 0, 0))
            kit.part('rod', aid, col, 'winch drum', a - half, a + half, r, 'black', vertices=14)
            kit.boxc(aid, col, 'winch motor', base + Vector((0, 0, sy * .45)), (sz * .45, sx * .3, sy * .9) if along_x else (sz * .3, sx * .45, sy * .9), 'naval')
        elif kind == 'woodbox':
            kit.boxc(aid, col, 'wooden box', base + Vector((0, 0, sy / 2)), (sz - .02, sx - .02, sy - .01), 'wood')
        elif kind == 'hose':
            long_z = sz >= sx
            half = Vector((sz / 2 - .05, 0, 0)) if long_z else Vector((0, sx / 2 - .05, 0))
            r = min(sy, sx if long_z else sz) / 2
            kit.part('rod', aid, col, 'hose coil', base + Vector((0, 0, r)) - half, base + Vector((0, 0, r)) + half, r, 'canvas', vertices=12)
        elif kind == 'basket':
            kit.boxc(aid, col, 'net basket', base + Vector((0, 0, sy / 2)), (sz, sx, sy), 'canvas')
        elif kind == 'tube':
            kit.cylz(aid, col, 'cooling tank', base, min(sx, sz) / 2, sy, 'naval', 14)
    print('deck stores left off where our deck differs:', skipped, '- in the guns\' swept space:', swept)


def sponson_supports(D, kit):
    """The pillars, cross-bracing and knee braces under the forward 5-inch sponsons (plan cuts every 0.4 m from 4.4
    to 8.8 m): box pillars at the outboard edge and against the deckhouse side, X-bracing between the paired
    pillars, and knee braces from the deckhouse side out to the sponson's underside; mirrored to port."""
    col = kit.collections['Superstructure']
    aid = 'sponson-supports'
    posts = [(8.39, -29.2), (8.45, -27.97), (6.47, -29.33), (6.46, -20.51), (8.78, -20.51), (6.46, -19.27), (8.82, -19.27),
             (6.46, -17.22), (8.84, -17.22)]
    for s in (-1, 1):
        tops = {}
        for x, z in posts:
            c = V(s * x, 0, z)
            top = kit.below(c.x, c.y, 9.6, 8.9)
            foot = kit.below(c.x, c.y, top - .3, 4.5)
            kit.member(aid, col, V(s * x, foot - .02, z), V(s * x, top + .02, z), .06, 'naval', 6)
            tops[(x, z)] = (foot, top)
        for (xa, za), (xb, zb) in (((8.39, -29.2), (8.45, -27.97)), ((8.78, -20.51), (8.82, -19.27)), ((6.46, -20.51), (6.46, -19.27))):
            fa, ta = tops[(xa, za)]
            fb, tb = tops[(xb, zb)]
            lo, hi = max(fa, fb) + .3, min(ta, tb) - .3
            kit.member(aid, col, V(s * xa, lo, za), V(s * xb, hi, zb), .035, 'naval', 5)
            kit.member(aid, col, V(s * xa, hi, za), V(s * xb, lo, zb), .035, 'naval', 5)
        for z in (-30.54, -29.11, -26.17, -24.69):
            c = V(s * 7.3, 0, z)
            top = kit.below(c.x, c.y, 9.6, 8.9)
            kit.member(aid, col, V(s * 6.36, 7.0, z), V(s * 7.3, top + .02, z), .045, 'naval', 6)


# ---------------------------------------------------------------- deck gear
def deck_gear(D, kit):
    col = kit.collections['Deck fittings']
    soles = [(*R(m['position'])[:2], m['position'][1], m['id']) for m in D['mounts'] if m['battery'] == 'main']

    def seat(x, z, y, h):
        c = V(x, 0, z)
        return Vector((c.x, c.y, kit.below(c.x, c.y, y + .6, y - .4)))

    # Bollards (am005, am106).
    for x, y, z in [(0.0, 7.8, -83.97), (3.83, 6.82, -70.03), (-3.83, 6.82, -70.03), (6.15, 5.81, -49.5), (-6.15, 5.81, -49.5),
                    (8.52, 4.52, 3.14), (-8.52, 4.52, 3.14), (8.5, 4.24, 31.07), (-8.5, 4.24, 31.07), (7.32, 4.21, 57.34),
                    (-7.32, 4.21, 57.34), (4.1, 4.16, 83.81), (-4.1, 4.16, 83.81)]:
        c = seat(x, z, y - .7, .7)
        kit.boxc('bollards', col, 'bollard base', c + Vector((0, 0, .04)), (1.3, .6, .08), 'edge')
        for d in (-.4, .4):
            kit.cylz('bollards', col, 'bitt', c + Vector((d, 0, .06)), .18, .55, 'naval', 12)
            kit.cylz('bollards', col, 'bitt cap', c + Vector((d, 0, .6)), .23, .06, 'naval', 12)
    for x in (-.56, .56):
        c = seat(x, 89.98, 3.9, .3)
        kit.cylz('bollards', col, 'stern bitt', c, .2, .35, 'naval', 12)
    # Fairleads (am242, am571) at the deck edge.
    for x, y, z in [(-3.55, 7.09, -75.8), (3.55, 7.09, -75.8), (-6.08, 5.98, -55.46), (6.08, 5.98, -55.46), (-9.02, 4.37, 5.91), (9.02, 4.37, 5.91),
                    (-8.22, 4.11, 51.18), (8.22, 4.11, 51.18), (-3.37, 4.17, 86.9), (3.37, 4.17, 86.9), (-4.94, 6.51, -65.49), (4.94, 6.51, -65.48),
                    (7.23, 5.41, -43.7), (-7.23, 5.41, -43.69), (-8.96, 4.45, -.03), (8.96, 4.45, -.03), (-8.9, 4.14, 33.42), (8.9, 4.14, 33.42),
                    (-7.52, 4.07, 61.45), (7.52, 4.07, 61.45), (-5.59, 4.05, 79.02), (5.59, 4.05, 79.02)]:
        c = seat(x, z, y - .15, .3)
        kit.boxc('fairleads', col, 'fairlead', c + Vector((0, 0, .12)), (.62, .22, .24), 'edge')
        kit.part('rod', 'fairleads', col, 'roller', c + Vector((0, 0, .26)) - Vector((.25, 0, 0)), c + Vector((0, 0, .26)) + Vector((.25, 0, 0)), .06, 'naval', vertices=8)
    # Capstans on the forecastle (am088) and the anchor cable reels (am108, am007).
    for x in (-2.5, 2.5):
        c = seat(x, -72.65, 6.6, .5)
        kit.cylz('capstans', col, 'capstan', c, .28, .42, 'naval', 16, r2=.24)
        kit.cylz('capstans', col, 'capstan head', c + Vector((0, 0, .42)), .32, .08, 'edge', 16)
    for x, y, z, r in [(0, 7.04, -68.49, .6), (-7.75, 5.04, -13.57, .62), (7.43, 5.02, -9.96, .62), (-2.76, 4.76, 44.2, .5), (2.76, 4.76, 44.22, .5)]:
        c = seat(x, z, y - r, r)
        for d in (-.3, .3):
            kit.boxc('reels', col, 'reel stand', c + Vector((0, d, r * .55)), (.25, .06, r * 1.1), 'edge')
        kit.part('rod', 'reels', col, 'reel drum', c + Vector((0, -.26, r)), c + Vector((0, .26, r)), r * .75, 'canvas', vertices=16)
    # Ventilators: cowls and mushroom heads at the reference positions (am021/022/167/168/283/326/455).
    for x, y, z, w, h in [(0, 4.41, 70.13, 1.06, 1.2), (-.47, 4.14, 75.78, .5, .7), (-.47, 4.14, 76.85, .5, .7), (1.66, 4.14, 83.43, .5, .7),
                          (4.31, 4.88, 2.61, 1.6, 1.5), (2.61, 4.49, 33.4, 1.4, 1.27), (-3.03, 7.2, -13.08, 1.4, .48), (3.01, 7.2, -13.08, 1.4, .48),
                          (-4.52, 4.97, -26.58, .4, .87), (4.52, 4.97, -26.58, .4, .87), (-3.05, 4.81, -6.3, 1.2, 1.16),
                          (-4.45, 4.85, 3.44, 1.5, 1.44), (-3.24, 4.58, 32.69, 1.5, 1.44)]:
        c = seat(x, z, y - h / 2, h)
        top = c.z + h
        for mx, my, sole, mid in soles:
            if math.hypot(c.x - mx, c.y - my) < 7.8 and top > sole - .06:
                top = sole - .06
        hh = max(.25, top - c.z)
        kit.cylz('ventilators', col, 'ventilator trunk', Vector((c.x, c.y, c.z - .01)), w * .32, hh - .18, 'naval', 16)
        kit.cylz('ventilators', col, 'ventilator head', Vector((c.x, c.y, c.z + hh - .2)), w * .5, .2, 'naval', 16, r2=w * .42)
    # Paravanes stowed by No. 2 and No. 3 barbettes (am077).
    for x, y, z in [(-4.69, 7.48, -43.51), (4.69, 7.48, -43.51), (4.37, 5.48, 52.59), (-3.75, 5.47, 53.63)]:
        c = seat(x, z, y - 1.6, 1)
        kit.part('rod', 'paravanes', col, 'paravane body', c + Vector((0, 0, .25)) + Vector((-.7, 0, 0)), c + Vector((0, 0, .25)) + Vector((.8, 0, 0)), .18, 'naval', vertices=10)
        kit.boxc('paravanes', col, 'paravane plane', c + Vector((0, 0, .25)), (.5, 1.1, .03), 'naval')
        kit.boxc('paravanes', col, 'paravane chock', c + Vector((0, 0, .05)), (.9, .3, .1), 'edge')
    # Spare anchor on deck by No. 3 barbette (cm036), and the bow anchors in their hawse pipes.
    c = seat(-4.42, 52.53, 3.9, .3)
    kit.boxc('ground-tackle', col, 'spare anchor shank', c + Vector((0, 0, .1)), (1.5, .3, .2), 'black')
    kit.boxc('ground-tackle', col, 'spare anchor crown', c + Vector((.75, 0, .1)), (.3, .9, .2), 'black')
    for s in (-1, 1):
        for zz, yy, size in ((-82.1, 5.9, (.95, .3, .3)), (-81.8, 5.45, (1.3, .45, .22))):
            hb = hull_half(kit, zz, yy)
            kit.boxc('ground-tackle', col, 'bow anchor', V(s * (hb + size[2] / 2 - .02), yy, zz), (size[0], size[2], size[1]), 'black')
    # Windlasses and cables (plan cuts at 6.7-7.6 m): a 1.44 m drum base at x +-1.0, z -72.51 with its 0.7 m
    # head and the cable casing ahead of it; each cable runs from its hawse-pipe collar at the stem (x +-0.72,
    # z -81.7) aft over the deck into the windlass, and on from the windlass into its chain pipe; links 0.38 m long,
    # alternately flat and on edge.
    for s in (-1, 1):
        c = seat(s * 1.0, -72.51, 6.9, .4)
        kit.cylz('ground-tackle', col, 'windlass base', c + Vector((0, 0, -.02)), .72, .38, 'naval', 28)
        kit.cylz('ground-tackle', col, 'windlass cover', c + Vector((0, 0, .36)), .7, .06, 'roof', 28)
        kit.cylz('ground-tackle', col, 'windlass head', c + Vector((0, 0, .42)), .35, .48, 'naval', 20, r2=.3)
        kit.cylz('ground-tackle', col, 'windlass cap', c + Vector((0, 0, .9)), .33, .05, 'edge', 20)
        k = seat(s * 1.03, -73.78, 6.9, .3)
        kit.boxc('ground-tackle', col, 'cable casing', k + Vector((0, 0, .15)), (.95, .65, .3), 'naval')
        h = seat(s * .72, -81.7, 7.5, .3)
        kit.cylz('ground-tackle', col, 'hawse collar', h + Vector((0, 0, -.02)), .32, .14, 'edge', 18)
        p = seat(s * .78, -71.3, 6.8, .3)
        kit.cylz('ground-tackle', col, 'chain pipe', p + Vector((0, 0, -.02)), .26, .16, 'edge', 16)
        for (xa, za), (xb, zb) in (((.72, -81.5), (.55, -74.3)), ((.9, -71.95), (.78, -71.45))):
            n = max(2, int(math.hypot(xb - xa, zb - za) / .38))
            for i in range(n):
                t0, t1 = i / n, (i + 1) / n
                a = seat(s * (xa + (xb - xa) * t0), za + (zb - za) * t0, 7.2, .5)
                b = seat(s * (xa + (xb - xa) * t1), za + (zb - za) * t1, 7.2, .5)
                a.z, b.z = a.z + .1, b.z + .1
                if i % 2:
                    kit.beam('ground-tackle', col, 'cable link', a, b, .06, .2, 'black')
                else:
                    kit.beam('ground-tackle', col, 'cable link', a, b, .23, .06, 'black')
    # 5-inch ammunition hoists and ready-use lockers on the sponson deck (am508, am520).
    for x in (-1.13, 1.19):
        c = seat(x, -23.53, 9.2, .8)
        kit.boxc('ammunition-hoists', col, 'hoist casing', c + Vector((0, 0, .5)), (1.0, 1.4, 1.0), 'naval')
    # Aircraft and boat loading machine on the after deckhouse (am070).
    c = seat(0.03, 41.28, 6.2, 1.5)
    kit.boxc('loading-machine', col, 'machine', c + Vector((0, 0, .9)), (3.2, 1.5, 1.8), 'naval')
    # Jack staff at the stem and the raked ensign staff at the stern (centreline profile).
    kit.part('rod', 'staffs', col, 'jack staff', V(0, 7.75, -87.35), V(0, 12.4, -87.35), .06, 'naval', r2=.03, vertices=8)
    kit.part('rod', 'staffs', col, 'ensign staff', V(0, 4.08, 90.25), V(0, 11.3, 91.3), .07, 'naval', r2=.035, vertices=8)


# ---------------------------------------------------------------- funnels
def funnels(D, kit):
    """Steam and exhaust pipes up the funnels, on the centres the reference's plan sections give every 0.5-2.5 m
    (10-20.5 m): two thin pipes up the forward funnel's face on its 0.1 rake, one ending in the whistle above the
    cap and one turning into the casing under the cap; a large pipe up its after face whose head turns aft; and
    three pipes up the after funnel's after face, the outer two with heavier heads. Each pipe stands on the deck."""
    col = kit.collections['Superstructure']
    # (assembly, polyline of (x, y, reference z), radius, mouth radius or 0 for a closed bend, mouth direction)
    pipes = [('forward-funnel', [(.43, 8.8, -18.23), (.43, 17.0, -17.41), (.43, 18.7, -17.53), (.43, 20.55, -17.42)], .085, .1, (0, 1, 0)),
             ('forward-funnel', [(-.67, 8.8, -18.21), (-.67, 16.9, -17.32), (-.67, 17.15, -17.08)], .065, 0, None),
             ('forward-funnel', [(0, 8.8, -12.26), (0, 18.2, -11.24), (0, 18.55, -10.96)], .24, .26, (0, -.35, 1)),
             ('after-funnel', [(-.43, 8.5, 16.9), (-.43, 18.4, 18.03)], .14, .2, (0, 1, 0)),
             ('after-funnel', [(.58, 8.5, 16.9), (.58, 18.3, 18.05)], .24, .3, (0, 1, 0)),
             ('after-funnel', [(0, 8.5, 17.15), (0, 17.4, 17.97), (0, 18.1, 18.3)], .26, .28, (0, -.3, 1))]
    for aid, pts, r, mouth, direction in pipes:
        a, b = pts[0], pts[1]
        foot = kit.below(*V(*a)[:2], a[1] + .3, a[1] - .5)
        pts = [(a[0], foot - .02, a[2] - (a[1] - foot) * (b[2] - a[2]) / (b[1] - a[1]))] + pts[1:]
        for p, q in zip(pts, pts[1:]):
            kit.part('rod', aid + '-pipes', col, 'steam pipe', V(*p), V(*q), r, 'naval', vertices=12)
            kit.part('rod', aid + '-pipes', col, 'pipe joint', V(*q) - Vector((0, 0, r * .6)), V(*q) + Vector((0, 0, r * .6)), r * 1.12, 'naval', vertices=12)
        if mouth:
            end = V(*pts[-1])
            d = Vector((-direction[2], -direction[0], direction[1])).normalized()   # reference (x, y, z) direction -> authoring
            kit.part('rod', aid + '-pipes', col, 'pipe head', end - d * .05, end + d * .35, mouth, 'naval', vertices=12)
            kit.part('rod', aid + '-pipes', col, 'pipe mouth', end + d * .35, end + d * .42, mouth * 1.05, 'black', vertices=12)
        # Brackets to the casing every 2.5 m up the run.
        for k in range(1, 5):
            y = pts[0][1] + (pts[1][1] - pts[0][1]) * k / 5
            t = (y - pts[0][1]) / (pts[1][1] - pts[0][1])
            c = (pts[0][0], y, pts[0][2] + (pts[1][2] - pts[0][2]) * t)
            toward = -1 if c[2] > (-14.5 if aid == 'forward-funnel' else 14.8) else 1
            kit.member(aid + "-pipes", col, V(*c), V(c[0], c[1], c[2] + toward * (r + .2)), .03, "naval", 6)
    funnel_tops(D, kit)


def casing_rings(D, fid):
    """The funnel casing's rings (height, runtime-frame outline) from its blueprint surface: rings of n vertices
    bottom to top, then the two cap centres."""
    s = next(s for s in D['structures'] if s['id'] == fid)
    vv = s['surface']['vertices']
    n = sum(1 for v in vv if abs(v[1] - s['baseY']) < 1e-4) - 1
    rings = [(vv[j * n][1], [tuple(v) for v in vv[j * n:(j + 1) * n]]) for j in range((len(vv) - 2) // n)]
    # The outer casing only: the rim's inner edge and the mouth's well follow the top ring.
    out = [rings[0]]
    for y, ring in rings[1:]:
        if y <= out[-1][0] + 1e-6:
            break
        out.append((y, ring))
    return out


def casing_at(rings, y, d=0.0):
    """Casing outline at height y (runtime frame, linear between rings), grown by d outward."""
    for (ya, ra), (yb, rb) in zip(rings, rings[1:]):
        if ya - 1e-6 <= y <= yb + 1e-6:
            t = 0 if yb - ya < 1e-9 else (y - ya) / (yb - ya)
            ring = [(a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t) for a, b in zip(ra, rb)]
            break
    else:
        ring = [(p[0], y, p[2]) for p in rings[-1][1]]
    cx = sum(p[0] for p in ring) / len(ring)
    cz = (min(p[2] for p in ring) + max(p[2] for p in ring)) / 2
    hw = max(abs(p[0] - cx) for p in ring)
    hl = max(abs(p[2] - cz) for p in ring)
    return [(cx + (p[0] - cx) * (hw + d) / hw, y, cz + (p[2] - cz) * (hl + d) / hl) for p in ring]


def funnel_tops(D, kit):
    """Funnel cap fittings read off the reference's plan sections: the sloping apron round each casing under
    the cap (forward 17.63-17.84 m, 0.23 m out; after 17.2-17.45 m, 0.35 m out), the grating over each mouth,
    and the forward funnel's cowl, a hood over the front of the mouth whose flat back stands open aft at
    reference z -14.40 and whose top falls from 20.95 m there to the cap's front edge."""
    col = kit.collections['Superstructure']
    Ra = lambda p: R(list(p))
    for fid, (y0, y1, out) in (('forward-funnel', (17.63, 17.84, .23)), ('after-funnel', (17.20, 17.45, .35))):
        rings = casing_rings(D, fid)
        aid = fid + '-cap'
        inner_lo, outer_hi = casing_at(rings, y0, -.02), casing_at(rings, y1, out)
        outer_lo = casing_at(rings, y1 - .05, out)
        inner_hi = casing_at(rings, y0 + .05, -.02)
        kit.loft(aid, col, 'apron', [[Ra(p) for p in ring] for ring in (inner_lo, outer_lo, outer_hi, inner_hi)], 'black', False, False, False)
        # Grating in the mouth: bars 0.15 m down the well, wall to wall (the well is 0.12 m inside the rim), on the
        # cap's slant (read off the rim: its height against z).
        top = rings[-1][0]
        rim = rings[-1][1]
        mouth = casing_at(rings, top, -.13)
        zs = [p[2] for p in mouth]
        cz = (min(zs) + max(zs)) / 2
        slope = sum((p[1] - top) * (p[2] - cz) for p in rim) / sum((p[2] - cz) ** 2 for p in rim)
        at = lambda z: top - .15 + slope * (z - cz)
        z_open = rz_ref(-14.40) if fid == 'forward-funnel' else min(zs)
        for x in (-.6, 0.0, .6):
            span = [p[2] for p in mouth if abs(p[0] - x) < .35]
            za, zb = max(z_open, min(span)), max(span)
            a, b = Vector(Ra((x, at(za), za))), Vector(Ra((x, at(zb), zb)))
            kit.beam(aid, col, 'grating bar', a, b, .06, .1, 'black')
        z = z_open + .45
        while z < max(zs) - .2:
            half = max(abs(p[0]) for p in mouth if abs(p[2] - z) < .4)
            kit.boxc(aid, col, 'grating bar', Vector(Ra((0, at(z), z))), (.06, 2 * half, .1), 'black')
            z += .8
    # The forward funnel's cowl: plan-section outlines every 0.1 m (half-width, front edge at reference z) about
    # its open back at reference z -14.40.
    rings = casing_rings(D, 'forward-funnel')
    top = rings[-1][0]
    COWL = [(top - .02, 1.36, -16.60), (19.70, 1.36, -16.49), (19.80, 1.356, -16.42), (19.90, 1.258, -16.40), (20.00, 1.188, -16.22),
            (20.10, 1.141, -16.03), (20.20, 1.098, -15.85), (20.30, 1.055, -15.67), (20.40, .962, -15.49), (20.50, .84, -15.31),
            (20.60, .736, -15.12), (20.70, .633, -14.94), (20.80, .494, -14.76), (20.85, .327, -14.67), (20.93, .10, -14.50)]
    back = -14.40
    rows = []
    for y, a, zf in COWL:
        depth = back - zf
        ring = [(a * math.cos(math.pi * k / 16), y, back - depth * math.sin(math.pi * k / 16)) for k in range(17)]
        rows.append([Ra((x, yy, rz_ref(z))) for x, yy, z in ring])
    kit.loft('forward-funnel-cap', col, 'cowl', rows, 'black', True, True, True)


def rz_ref(z):
    """Reference z -> runtime z."""
    return z - ZC


# ---------------------------------------------------------------- underwater
def screw(kit, aid, col, c, radius, blades=4, hand=1):
    kit.part('rod', aid, col, 'hub', c + Vector((.55, 0, 0)), c + Vector((-.45, 0, 0)), .36, 'bronze', r2=.32, vertices=16)
    kit.part('rod', aid, col, 'hub cone', c + Vector((-.45, 0, 0)), c + Vector((-.9, 0, 0)), .32, 'bronze', r2=.07, vertices=16)
    for k in range(blades):
        a = math.pi / 4 + k * math.tau / blades
        ca, sa = math.cos(a), math.sin(a)
        sections = []
        # Broad, rounded blades (the reference's screws are 3.55 m across and 2.0 m long along the shaft).
        for r, w in ((.26, .7), (.75 * radius / 1.78, 1.22), (1.2 * radius / 1.78, 1.36), (1.55 * radius / 1.78, 1.05), (radius, .42)):
            skew = hand * .22
            le = (c.x - w * .15, c.y + r * ca - w * sa * .5 * hand, c.z + r * sa + w * ca * .5 * hand)
            te = (c.x + w * .15, c.y + r * ca + w * sa * .5 * hand, c.z + r * sa - w * ca * .5 * hand)
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
        fix_normals(kit.tag(kit.mesh(aid + '.blade', vv, ff, 'bronze', col), aid))


def underwater(D, kit):
    col = kit.collections['Underwater fittings']
    # Four four-bladed screws (cm002/cm033: 3.55 m across) on shafts in long bossings, each held by an
    # A-bracket; the outer pair well forward of the inner pair.
    for x, y, z, which in [(-6.87, -4.45, 68.29, 'outer'), (6.87, -4.45, 68.29, 'outer'), (-3.14, -4.54, 81.27, 'inner'), (3.14, -4.54, 81.27, 'inner')]:
        aid = f'screw-{"port" if x < 0 else "starboard"}-{which}'
        c = V(x, y, z)
        screw(kit, aid, col, c, 1.76, 4, 1 if x > 0 else -1)
        # The shaft runs forward and slightly inboard and up into the hull.
        start = z - 26 if which == 'outer' else z - 24
        xs = x * (.8 if which == 'outer' else .78)
        ys = y + (.9 if which == 'outer' else 1.1)
        exit_z = start
        for k in range(60):
            zz = start + k * (z - start) / 60
            t = (zz - start) / (z - start)
            px, py = xs + (x - xs) * t, ys + (y - ys) * t
            if abs(px) > hull_half(kit, zz, py) + .05:
                exit_z = zz
                break
        # The shafts are painted with the bottom, as the reference shows them.
        kit.part('rod', aid, col, 'shaft', V(xs, ys, start), c + Vector((.5, 0, 0)), .2, 'antifouling', vertices=12)
        t0 = (exit_z - start) / (z - start)
        ex = Vector(P(xs + (x - xs) * t0, ys + (y - ys) * t0, exit_z))
        mid = ex.lerp(c, .45)
        kit.part('rod', aid, col, 'bossing', ex + (ex - c).normalized() * 1.2, mid, .5, 'antifouling', r2=.3, vertices=14)
        # A-bracket 1.6 m ahead of the screw: two struts up and out to the hull.
        bracket = c + Vector((1.6, 0, 0))
        zb = z - 1.6
        for fx, up in ((.62, 2.2), (1.06, 1.4)):
            ty = y + up
            hx = hull_half(kit, zb, ty)
            target = V(math.copysign(max(.2, min(abs(x) * fx, hx - .05)), x), ty, zb)
            kit.member(aid, col, bracket, target, .12, 'antifouling', 8)
        kit.part('rod', aid, col, 'bracket barrel', bracket + Vector((.35, 0, 0)), bracket - Vector((.35, 0, 0)), .32, 'antifouling', vertices=14)
    # Semi-balanced rudder on the centreline (centreline profile): blade from the stock aft to the counter,
    # the balance ahead of the stock in its lower part; 0.3 m thick.
    aid = 'rudder'
    outline = [(82.9, -6.1), (83.2, -6.42), (89.2, -6.42), (89.5, -6.1), (89.5, -1.45), (89.2, -1.37), (86.2, -2.07), (86.2, -4.4), (83.2, -4.4), (82.9, -5.2)]
    vv = []
    for t in (-.15, .15):
        vv += [P(t, y, z) for z, y in outline]
    n = len(outline)
    ff = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    fix_normals(kit.tag(kit.mesh(aid + '.rudder blade', vv, ff, 'antifouling', col), aid))
    kit.part('rod', aid, col, 'rudder stock', V(0, -4.4, 85.95), V(0, -1.3, 85.95), .2, 'antifouling', vertices=12)
    # Bilge keels along the turn of the bilge (plan cut at -5.5 m: reference z -18.5 to 33.3).
    for s in (-1, 1):
        zs = [-18.5 + (33.3 + 18.5) * i / 10 for i in range(11)]
        for z0, z1 in zip(zs, zs[1:]):
            ends = [V(s * (hull_half(kit, z, -5.55) - .05), -5.55, z) for z in (z0, z1)]
            out = Vector((0, -s * .8, -.6))
            mid = [e + out * .45 for e in ends]
            kit.beam('bilge-keels', col, 'bilge keel', mid[0], mid[1], .05, .9, 'antifouling', tuple(out))


# ---------------------------------------------------------------- railings
def railings(D, kit):
    """Guard rails along the weather-deck edge; gun arcs stay clear (Kit.in_arc), as removable rails would."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        for z0, z1 in ((-86.6, 4.4), (29.9, 90.2)):
            n = max(2, int(abs(z1 - z0) / 1.8))
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
            kit.wire('railings', col, pts[-1], pts[-1] + Vector((0, 0, 1.0)), .022, True)


def build(D, kit):
    bulwarks(D, kit)
    foremast(D, kit)
    mainmast(D, kit)
    crane(D, kit)
    catapults(D, kit)
    directors(D, kit)
    rangefinders(D, kit)
    radars(D, kit)
    searchlights(D, kit)
    boats(D, kit)
    deck_gear(D, kit)
    deck_stores(D, kit)
    sponson_supports(D, kit)
    funnels(D, kit)
    underwater(D, kit)
    railings(D, kit)

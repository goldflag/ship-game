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
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (y - y0) / (y1 - y0))
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
        # Struts from the side legs to the main leg under the foretop.
        kit.member(aid, col, V(s * 2.78, 23.4, -24.66), V(0, 23.4, -28.18), .09)
        kit.member(aid, col, V(s * 3.65, 19.0, -23.89), V(0, 21.4, -28.37), .09)
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
    # After tower (plan cuts): two forward struts raked up to the director platform, two after legs
    # converging on it, and the centre post under the Mk 19.
    for s in (-1, 1):
        taper(kit, aid, col, 'forward strut', (s * 2.74, 6.3, 24.79), (s * 2.74, 15.15, 35.56), .33, .3, 'naval', 16)
        taper(kit, aid, col, 'after leg', (s * 3.43, 6.2, 42.86), (s * 1.43, 15.15, 41.22), .33, .3, 'naval', 16)
        kit.cylz(aid, col, 'strut foot', V(s * 2.74, 0, 24.79)[:2] + (6.22,), .45, .12, 'edge', 14)
        kit.member(aid, col, V(s * 2.74, 10.0, 29.3), V(s * 2.95, 10.0, 38.0), .08)
    kit.member(aid, col, V(-2.74, 10.0, 29.3), V(2.74, 10.0, 29.3), .08)
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
    house = [(1.55, -1.4), (1.55, 1.4), (-1.75, 1.45), (-1.75, -1.45)]
    pts = [(bx + s * x, by + y) for x, y in house]
    local(kit.prism(aid, col, 'director house', pts, bz + .3, bz + 2.05, 'naval', 'roof'), pivot)
    # Sloped face and the brow over the sighting ports.
    face_pts = [(bx + s * 1.55, by - 1.4), (bx + s * 1.55, by + 1.4), (bx + s * 1.95, by + 1.3), (bx + s * 1.95, by - 1.3)]
    local(kit.prism(aid, col, 'director face', face_pts, bz + .3, bz + 1.45, 'naval'), pivot)
    local(kit.boxc(aid, col, 'sight brow', (bx + s * 1.62, by, bz + 2.0), (.6, 2.9, .1), 'roof'), pivot)
    for side in (-1, 1):
        local(kit.part('rod', aid, col, 'rangefinder arm', (bx - s * .2, by + side * 1.4, bz + 1.55), (bx - s * .2, by + side * 2.45, bz + 1.55), .26, 'naval', vertices=14), pivot)
        local(kit.boxc(aid, col, 'rangefinder hood', (bx - s * .2, by + side * 2.4, bz + 1.55), (.62, .3, .62), 'naval'), pivot)
        local(kit.part('rod', aid, col, 'rangefinder window', (bx - s * .2 + s * .3, by + side * 2.4, bz + 1.55), (bx - s * .2 + s * .34, by + side * 2.4, bz + 1.55), .12, 'glass', vertices=10), pivot)
        for k in (-1, 1):
            local(kit.boxc(aid, col, 'sight port', (bx + s * 1.97, by + side * .55 + k * .18, bz + 1.12), (.05, .26, .2), 'glass'), pivot)
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
    # legs (plan cut: 4.0 x 2.0 m at 20.8-21.0 m), carried on brackets to the side legs and the main leg.
    aid = 'searchlight-platform'
    kit.boxc(aid, col, 'platform', V(0, 20.93, -26.2), (2.0, 4.0, .12), 'roof')
    for s in (-1, 1):
        leg_x = 5.63 + (1.18 - 5.63) * (20.9 - 9.2) / (31.0 - 9.2)
        leg_z = -22.16 + (-26.04 + 22.16) * (20.9 - 9.2) / (31.0 - 9.2)
        kit.member(aid, col, V(s * 1.9, 20.9, -25.4), V(s * (leg_x - .2), 20.9, leg_z), .07)
        kit.member(aid, col, V(s * 1.6, 20.87, -26.9), V(s * .2, 20.1, -28.43), .06)
    kit.member(aid, col, V(0, 20.87, -27.15), V(0, 20.87, -28.36), .08)
    for i, x in enumerate((-.98, .98), 5):
        searchlight(kit, f"searchlight-{i}", col, V(x, 21.02, -26.17), .3, 0, 20.99)
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
        top = depth * (1 + .25 * fore ** 2)
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append((x, -half * math.cos(a), top - depth * .85 * math.sin(a) ** 1.4 * (1 - .4 * fore) - depth * .15))
        rings.append(ring)
    rot = Matrix.Rotation(heading, 3, 'Z')
    rings = [[tuple(Vector(c) + rot @ Vector(p)) for p in ring] for ring in rings]
    hull = kit.loft(aid, col, 'boat hull', rings, 'naval', True, True, True)
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
        boat(kit, aid, col, V(s * 7.87, floor + .28, z0), 7.9, 2.0, 1.4, math.pi, True)
        for dz in (-2.4, 2.4):
            kit.boxc(aid, col, 'chock', V(s * 7.87, floor + .14, z0 + dz), (.3, 1.6, .28), 'edge')
            foot = V(s * 8.75, floor, z0 + dz * 1.25)
            top = V(s * 8.9, floor + 3.6, z0 + dz * 1.25)
            kit.part('rod', aid, col, 'davit', foot, top, .09, 'naval', vertices=10)
            kit.part('rod', aid, col, 'davit head', top, top + Vector((0, s * .9, -.35)), .07, 'naval', vertices=8)
            kit.wire(aid, col, top + Vector((0, s * .9, -.4)), V(s * 7.87, floor + 1.7, z0 + dz * 1.1), .015, False)
    # Boat booms stowed on the forecastle and aft (am131 datums) and the Franklin life buoys (am489).
    for s in (-1, 1):
        x = 9.08 + .09      # on the flush side of the midships superstructure (plan cuts: 9.07-9.09 m)
        kit.part('rod', 'life-buoys', col, 'life buoy', V(s * (x - .02), 5.9, 22.59), V(s * (x + .1), 5.9, 22.59), .36, 'white', vertices=16)
        kit.part('rod', 'life-buoys', col, 'buoy bracket', V(s * (x - .02), 6.2, 22.59), V(s * (x - .12), 6.2, 22.59), .04, 'edge', vertices=6)


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
        kit.part('rod', 'ground-tackle', col, 'hawse pipe', V(s * 1.2, 7.0, -78.8), V(s * 1.65, 6.6, -81.4), .26, 'naval', vertices=14)
        for i in range(8):
            p = V(s * (1.1 - .02 * i), 7.02, -78.6 + i * .75)
            kit.part('rod', 'ground-tackle', col, 'cable', p, p + Vector((-.55, 0, 0)), .055, 'edge', vertices=6)
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
    """Steam and exhaust pipes up the funnels (plan cuts at 10-20.5 m): two thin pipes up the forward
    funnel's face, the whistle pipe standing above its cap, a large pipe up its after face bending into
    the hood, and three pipes up the after funnel's after face. Each pipe rides the raked casing."""
    col = kit.collections['Superstructure']
    pipes = [('forward-funnel', (.43, 8.8, -18.2), (.43, 20.6, -17.4), .085), ('forward-funnel', (-.67, 8.8, -18.18), (-.67, 17.6, -17.55), .065),
             ('forward-funnel', (0, 8.8, -12.3), (0, 18.9, -11.2), .23), ('after-funnel', (-.43, 8.5, 16.9), (-.43, 18.6, 18.05), .15),
             ('after-funnel', (.58, 8.5, 16.9), (.58, 18.6, 18.1), .24), ('after-funnel', (0, 8.5, 16.95), (0, 18.7, 18.3), .26)]
    for aid, a, b, r in pipes:
        foot = kit.below(*V(*a)[:2], a[1] + .3, a[1] - .5)
        a = (a[0], foot - .02, a[2] - (a[1] - foot) * (b[2] - a[2]) / (b[1] - a[1]))
        kit.part('rod', aid + '-pipes', col, 'steam pipe', V(*a), V(*b), r, 'naval', vertices=12)
        kit.part('rod', aid + '-pipes', col, 'pipe mouth', V(*b), V(b[0], b[1] + .12, b[2]), r * 1.2, 'black', vertices=12)
    # The forward funnel's big after pipe turns forward into the hood.
    kit.part('rod', 'forward-funnel-pipes', col, 'pipe bend', V(0, 18.9, -11.2), V(0, 19.45, -12.7), .21, 'naval', vertices=12)


# ---------------------------------------------------------------- underwater
def screw(kit, aid, col, c, radius, blades=4, hand=1):
    kit.part('rod', aid, col, 'hub', c + Vector((.55, 0, 0)), c + Vector((-.45, 0, 0)), .36, 'bronze', r2=.32, vertices=16)
    kit.part('rod', aid, col, 'hub cone', c + Vector((-.45, 0, 0)), c + Vector((-.9, 0, 0)), .32, 'bronze', r2=.07, vertices=16)
    for k in range(blades):
        a = math.pi / 4 + k * math.tau / blades
        ca, sa = math.cos(a), math.sin(a)
        sections = []
        for r, w in ((.3, .62), (.8 * radius / 1.78, .9), (1.3 * radius / 1.78, .82), (radius, .38)):
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
        kit.part('rod', aid, col, 'shaft', V(xs, ys, start), c + Vector((.5, 0, 0)), .2, 'bronze', vertices=12)
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
    funnels(D, kit)
    underwater(D, kit)
    railings(D, kit)

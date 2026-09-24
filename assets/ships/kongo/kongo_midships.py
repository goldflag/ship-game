"""Kongō midships region: reference z -24 to +12 above the forecastle deck.

Owns the funnels' caps, cages, whistles and steam pipes; the tripod mainmast with its lookout
platform, topmast, yards, gaff and derrick; the lattice legs under the searchlight tower ahead
of the forward funnel; the boat davits with their slung boats; and the boats stowed amidships.
Datums are reference-frame measurements converted by `P`.
"""
from kongo_kit import P

# Measured prisms this module draws itself (build.py skips their generic extrusion): the
# mainmast head's platform, bracket, heel fitting and yards were measured as boxes, and the girts of
# the lattice tower abaft the forward funnel as thin platforms.
CLAIMED_STRUCTURES = {'deckhouse-110', 'deckhouse-111', 'deckhouse-114', 'deckhouse-120', 'deckhouse-121', 'platform-118', 'platform-119',
                      'platform-105', 'platform-106', 'platform-107'}

# Smoke line: masts, booms and funnel caps are black above it.
BLACK_ABOVE = 20.15

# Steam pipes per funnel: reference (x, z, top of the straight run, top of the flared mouth).
PIPES = {'forward-funnel': [(-.63, -5.35, 19.53, 20.54), (.03, -5.17, 19.53, 20.54), (.64, -5.35, 19.53, 20.54)],
         'after-funnel': [(0, 4.1, 20.17, 21.09), (-1.715, 4.77, 20.17, 21.09), (1.715, 4.77, 20.17, 21.09),
                          (2.28, 7.72, 20.17, 21.09), (0, 9.97, 20.17, 21.09)]}
# Siren on the port side of each funnel cap: reference z of its two posts.
WHISTLE = {'forward-funnel': (-6.99, -6.1), 'after-funnel': (6.35, 7.1)}


def build(D, kit):
    cols = kit.cols
    funnels(D, kit, cols['Superstructure'])
    mainmast(kit, cols['Sensors and masts'])
    derrick(kit, cols['Sensors and masts'])
    tower_legs(kit, cols['Superstructure'])
    fittings(kit, cols)
    boats(kit, cols['Boats and aviation'])
    davits(kit, cols['Boats and aviation'])


def split_black(kit, assembly, col, label, a, b, r, r2=None, vertices=14):
    """A spar painted grey below the smoke line and black above it."""
    r2 = r if r2 is None else r2
    if (a[2] - BLACK_ABOVE) * (b[2] - BLACK_ABOVE) >= 0:
        kit.part('rod', assembly, col, label, a, b, r, 'black' if min(a[2], b[2]) >= BLACK_ABOVE else 'naval', vertices=vertices, r2=r2)
        return
    t = (BLACK_ABOVE - a[2]) / (b[2] - a[2])
    m = tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
    rm = r + (r2 - r) * t
    lo, hi = (a, b) if a[2] < b[2] else (b, a)
    rl, rh = (r, r2) if a[2] < b[2] else (r2, r)
    kit.part('rod', assembly, col, label, lo, m, rl, 'naval', vertices=vertices, r2=rm)
    kit.part('rod', assembly, col, label + ' black', m, hi, rm, 'black', vertices=vertices, r2=rh)


# ---------------------------------------------------------------- funnels
def funnels(D, kit, col):
    for f in D['structures']:
        if not f['id'].endswith('funnel'):
            continue
        F = f['id']
        xs = [p[0] for p in f['footprint']]
        zs = [p[1] for p in f['footprint']]
        half, length = (max(xs) - min(xs)) / 2, max(zs) - min(zs)
        cx = -(min(zs) + max(zs)) / 2
        base, top = f['baseY'], f['baseY'] + f['height']

        def outline(grow, n=40):
            return [(cx + a, b) for a, b in kit.stadium(half + grow, length + 2 * grow, n)]
        # Black cap: the casing runs up to a flared rim, with the uptake standing proud inside it.
        kit.prism(F, col, 'black cap', outline(.025), BLACK_ABOVE, top + .01, 'black')
        if F == 'forward-funnel':
            # Outer casing round the forward funnel's middle section.
            kit.prism(F, col, 'outer casing', [(cx + a, b) for a, b in kit.stadium(2.45, 6.5, 40)], 12.0, 18.4, 'naval', 'roof')
        kit.prism(F, col, 'casing top', outline(0), top, 21.66, 'black')
        kit.prism(F, col, 'rim', outline(.1), 21.62, 21.88, 'black')
        kit.prism(F, col, 'uptake', [(cx + a, b) for a, b in kit.stadium(1.62, 3.26, 36)], 21.6, 22.04, 'black', 'dark')
        # Spark cage: five arched hoops across the cap and two longitudinals over them.
        hoops = [cx + length * (.5 - u) for u in (.12, .28, .47, .65, .81)]
        for hx in hoops:
            kit.polyline(F, col, [(hx, -2.06, 21.88), (hx, -1.7, 22.36), (hx, 1.7, 22.36), (hx, 2.06, 21.88)], .035, 'black', 5)
        for y in (-.95, .95):
            kit.polyline(F, col, [(hoops[0] + .3, y, 21.88), (hoops[0], y, 22.36), (hoops[-1], y, 22.36), (hoops[-1] - .3, y, 21.88)], .035, 'black', 5)
        # Siren on the port side of the cap, fed by a pipe up the casing.
        za, zb = WHISTLE[F]
        for z in (za, zb):
            kit.part('rod', F, col, 'siren post', P(-2.2, 21.66, z), P(-2.2, 23.04, z), .1, 'black', vertices=8)
        kit.part('rod', F, col, 'siren', P(-2.2, 22.68, za + .06), P(-2.2, 22.68, zb - .06), .13, 'black', vertices=12)
        if F == 'forward-funnel':
            kit.polyline(F, col, [P(-2.18, 18.35, -8.5), P(-2.18, 19.8, -8.5), P(-2.18, 21.0, -6.6), P(-2.18, 22.62, -6.55)], .08, 'naval', 8)
        else:
            floor = kit.support.below(*P(-2.2, 0, 7.3)[:2], base + .5)
            kit.part('rod', F, col, 'siren pipe', P(-2.2, floor, 7.3), P(-2.2, 22.62, 7.3), .12, 'naval', vertices=10)
        # Steam pipes with flared mouths.
        for i, (rx, rz, run, mouth) in enumerate(PIPES[F]):
            floor = kit.support.below(*P(rx, 0, rz)[:2], base + .5)
            kit.part('rod', F, col, 'steam pipe', P(rx, floor, rz), P(rx, run, rz), .1, 'naval', vertices=10)
            kit.part('rod', F, col, 'steam pipe mouth', P(rx, run, rz), P(rx, mouth, rz), .1, 'black' if run >= 19.4 else 'naval', vertices=10, r2=.16)
        for zz in (base + 4.5, base + 8.2):
            kit.prism(F, col, 'band', outline(.05), zz, zz + .1, 'naval')


# ---------------------------------------------------------------- mainmast
def mainmast(kit, col):
    A = 'mainmast'
    split_black(kit, A, col, 'pole', P(0, 8.8, 1.66), P(0, 32.77, 1.66), .46, .44, 20)
    # Tripod legs: straight struts either side of the after funnel to the lookout platform.
    for s in (-1, 1):
        split_black(kit, A, col, 'strut', P(s * 5.03, 8.8, 6.47), P(s * .24, 29.25, 2.38), .41, .36, 16)
    # Lookout platform on a bracket between the pole and the struts, railed round.
    octo = [(1.08 * c, 2.13 + 1.08 * s) for c, s in ((1, .41), (.41, 1), (-.41, 1), (-1, .41), (-1, -.41), (-.41, -1), (.41, -1), (1, -.41))]
    kit.prism(A, col, 'lookout platform', [P(x, 0, z)[:2] for x, z in octo], 29.21, 29.3, 'black')
    brace = [(.87 * c, 2.07 + .9 * s) for c, s in ((1, .41), (.41, 1), (-.41, 1), (-1, .41), (-1, -.41), (-.41, -1), (.41, -1), (1, -.41))]
    kit.prism(A, col, 'lookout bracket', [P(x, 0, z)[:2] for x, z in brace], 28.25, 29.22, 'black')
    ring = [P(1.2 * c, 0, 2.13 + 1.2 * s)[:2] for c, s in ((1, .41), (.41, 1), (-.41, 1), (-1, .41), (-1, -.41), (-.41, -1), (.41, -1), (1, -.41))]
    kit.rail(A, col, ring[2:] + ring[:2], 29.3, .95, 1.0, check=False)
    # Pole cap, topmast stepped ahead of the pole, and their heel fitting.
    kit.prism(A, col, 'pole cap', [P(x, 0, z)[:2] for x, z in [(.59, .57), (.59, 2.25), (-.59, 2.25), (-.59, .57)]], 32.77, 32.87, 'black')
    kit.part('box', A, col, 'topmast heel', P(0, 31.15, 1.1), (.7, .6, .3), 'black')
    kit.part('rod', A, col, 'topmast', P(0, 31.0, .7), P(0, 40.74, .7), .08, 'black', vertices=10, r2=.05)
    kit.cylz(A, col, 'day light', P(0, 40.74, .7), .16, .77, 'black', 12)
    kit.cylz(A, col, 'signal lamps', P(0, 38.3, .55), .08, .2, 'black', 8)
    # Signal yard with its knee braces and the after outriggers; the topmast yard above.
    kit.member(A, col, P(-5.93, 32.69, 1.655), P(5.96, 32.69, 1.655), .08, 'black', 8)
    for s in (-1, 1):
        kit.member(A, col, P(s * 2.9, 32.69, 1.655), P(s * .42, 31.5, 1.655), .045, 'black', 6)
        kit.member(A, col, P(s * .8, 32.72, 2.2), P(s * 3.45, 32.72, 5.6), .05, 'black', 6)
        kit.member(A, col, P(s * 3.5, 36.51, .56), P(0, 38.4, .7), .02, 'edge', 3)
        kit.member(A, col, P(s * 1.5, 36.51, .56), P(0, 35.7, .7), .035, 'black', 6)
        # Halyards from the outriggers to the 25 mm platform.
        kit.wire(A, col, P(s * 3.45, 32.72, 5.6), P(s * 2.25, 16.8, 2.45), .012, False)
    kit.member(A, col, P(-1.79, 32.69, 3.72), P(1.79, 32.69, 3.72), .04, 'black', 6)
    kit.member(A, col, P(-4.59, 36.51, .56), P(4.62, 36.51, .56), .06, 'black', 8)
    # Signal gaff and its peak halyard.
    kit.member(A, col, P(0, 34.6, .72), P(0, 38.4, 4.4), .06, 'black', 8)
    kit.wire(A, col, P(0, 38.8, .7), P(0, 38.4, 4.4), .015, False)
    kit.wire(A, col, P(0, 38.4, 4.4), P(0, 22.3, 3.5), .012, False)
    # Topping-lift blocks on the pole's fore side.
    for y, z in ((24.4, .39), (26.72, .41), (28.71, .15)):
        kit.part('box', A, col, 'eye plate', P(0, y + .35, 1.1), (.3, .1, .3), 'black')
        kit.member(A, col, P(0, y + .35, 1.0), P(0, y + .22, z + .1), .035, 'black', 5)
        kit.sheave(A, col, P(0, y, z), (0, 1, 0), .28, .1)


def derrick(kit, col):
    A = 'derrick'
    # Cigar-shaped boom from a gooseneck on the pole's fore side, topped to about 58 degrees.
    heel, mid, head = P(0, 13.3, .8), P(0, 22.05, -3.24), P(0, 30.8, -7.28)
    kit.part('box', A, col, 'gooseneck', P(0, 13.3, .82), (.9, .62, .7), 'naval')
    split_black(kit, A, col, 'boom', heel, mid, .14, .24, 14)
    split_black(kit, A, col, 'boom', mid, head, .24, .13, 14)
    kit.part('box', A, col, 'head fitting', P(0, 31.0, -7.5), (.55, .3, .35), 'black')
    kit.sheave(A, col, P(0, 31.45, -7.6), (0, 1, 0), .25, .12)
    kit.sheave(A, col, P(0, 31.25, -8.05), (0, 1, 0), .22, .12)
    kit.sheave(A, col, P(0, 30.1, -7.2), (0, 1, 0), .2, .12)
    # Topping lift: three parts from the boom head to the pole blocks, then down the pole to the winches.
    for y, z in ((24.4, .39), (26.72, .41), (28.71, .15)):
        kit.wire(A, col, P(0, 31.45, -7.6), P(0, y, z), .018, False)
    for s, (y, z) in ((-1, (24.4, .39)), (1, (26.72, .41))):
        kit.wire(A, col, P(0, y - .25, z), P(s * 1.18, 11.3, .48), .015, False)
    # Cargo fall and hook, stowed near the heel.
    for dz in (-.08, .08):
        kit.wire(A, col, P(0, 31.1, -8.1 + dz), P(0, 13.95, -.38 + dz), .018, False)
    kit.sheave(A, col, P(0, 13.75, -.32), (0, 1, 0), .2, .14)
    kit.part('rod', A, col, 'hook', P(0, 13.6, -.3), P(0, 12.95, -.12), .05, 'black', vertices=6)
    # The hook is lashed back to the mast's foot while the boom is stowed.
    kit.part('rod', A, col, 'lashing', P(0, 12.98, -.16), P(0, 12.98, .5), .025, 'edge', vertices=5)


# ---------------------------------------------------------------- searchlight tower ahead of the forward funnel
def tower_legs(kit, col):
    A = 'searchlight-tower'
    deck, mid, top = 8.8, 12.7, 15.5
    # Lower tier: a four-legged angle-iron tower under the 12.7 m platform, braced on every face.
    corners = [(-2.62, -15.28), (2.62, -15.28), (2.62, -11.97), (-2.62, -11.97)]
    for x, z in corners:
        kit.member(A, col, P(x, deck, z), P(x, mid, z), .08, 'naval', 4)
    for z in (-15.28, -11.97):
        kit.member(A, col, P(0, deck, z), P(0, mid, z), .06, 'naval', 4)
        for x0, x1 in ((-2.62, 0), (0, 2.62)):
            kit.xbrace(A, col, P(x0, deck, z), P(x1, deck, z), P(x1, mid, z), P(x0, mid, z), .035)
    for x in (-2.62, 2.62):
        kit.xbrace(A, col, P(x, deck, -15.28), P(x, deck, -11.97), P(x, mid, -11.97), P(x, mid, -15.28), .035)
    for s in (-1, 1):
        # Round forward legs to the upper platform, braced to the lower tower and to the trunk.
        leg = (s * 3.12, -16.5)
        kit.member(A, col, P(leg[0], deck, leg[1]), P(leg[0], top, leg[1]), .17, 'naval', 12)
        kit.xbrace(A, col, P(leg[0], deck, leg[1]), P(s * 2.62, deck, -15.28), P(s * 2.62, mid, -15.28), P(leg[0], mid, leg[1]), .035)
        kit.xbrace(A, col, P(leg[0], 12.9, leg[1]), P(s * 2.45, 12.9, -15.0), P(s * 2.45, top, -15.0), P(leg[0], top, leg[1]), .035)
        # Raked legs beside the funnel, braced to the trunk's after corners.
        kit.member(A, col, P(s * 3.1, deck, -10.3), P(s * 4.05, top, -10.3), .19, 'naval', 12)
        kit.xbrace(A, col, P(s * 2.45, 12.9, -12.2), P(s * 3.63, 12.9, -10.3), P(s * 4.05, top, -10.3), P(s * 2.45, top, -12.2), .035)
    # Abaft the funnel: a six-legged tower under the searchlight platform, braced in four tiers,
    # with knees out to the platform's round ends.
    B = 'searchlight-tower-aft'
    tiers = [8.8, 10.4, 12.0, 13.4, 14.3]
    for x in (-1.7, 0, 1.7):
        for z in (-4.85, -3.7):
            kit.member(B, col, P(x, tiers[0], z), P(x, tiers[-1], z), .07, 'naval', 4)
    for y0, y1 in zip(tiers, tiers[1:]):
        for z in (-4.85, -3.7):
            kit.member(B, col, P(-1.7, y1, z), P(1.7, y1, z), .045, 'naval', 4)
            for x0, x1 in ((-1.7, 0), (0, 1.7)):
                kit.xbrace(B, col, P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z), .03)
        for x in (-1.7, 1.7):
            kit.member(B, col, P(x, y1, -4.85), P(x, y1, -3.7), .045, 'naval', 4)
            kit.xbrace(B, col, P(x, y0, -4.85), P(x, y0, -3.7), P(x, y1, -3.7), P(x, y1, -4.85), .03)
    for s in (-1, 1):
        for z in (-4.85, -3.7):
            kit.member(B, col, P(s * 1.7, 13.3, z), P(s * 4.2, 14.3, z), .05, 'naval', 4)
    # Gangway rails from the pagoda to the tower at 13 m.
    for x in (-.37, .37):
        kit.rail(A, col, [P(x, 0, -21.0)[:2], P(x, 0, -16.5)[:2]], 12.7, .8, 1.15, check=False)


# ---------------------------------------------------------------- small fittings
def fittings(kit, cols):
    masts = cols['Sensors and masts']
    deck = cols['Deck fittings']
    for i, ref in enumerate([(2.8, 14.81, -4.16), (-2.8, 14.81, -4.16), (1.89, 16.88, -13.72), (-1.89, 16.88, -13.72)], 7):
        kit.searchlight(f'searchlight-{i}', ref, masts)
    for s in (-1, 1):
        B = f'binocular-mid-{"port" if s < 0 else "starboard"}'
        x, y, z = P(s * 4.14, 15.46, -10.24)
        kit.cylz(B, masts, 'binocular pedestal', (x, y, z), .07, 1.05, 'naval', 8)
        kit.part('box', B, masts, 'binocular', (x, y, z + 1.14), (.34, .18, .16), 'edge')
        # Electric deck winches abaft the mainmast.
        W = f'winch-mid-{"port" if s < 0 else "starboard"}'
        x, y, z = P(s * 7.0, 6.62, 6.1)
        floor = kit.support.below(x, y, z + .3)
        kit.part('box', W, deck, 'bed', (x, y, floor + .12), (1.0, 2.2, .24), 'naval')
        kit.part('rod', W, deck, 'drum', (x, y - .75, floor + .72), (x, y + .75, floor + .72), .33, 'naval', vertices=16)
        kit.part('box', W, deck, 'motor', (x - .2, y + s * .85, floor + .6), (.7, .5, .7), 'naval')
        for dy in (-.8, .8):
            kit.part('box', W, deck, 'cheek', (x, y + dy, floor + .6), (.8, .08, .75), 'naval')


# ---------------------------------------------------------------- boats stowed amidships
def boats(kit, col):
    for side, s in (('port', -1), ('starboard', 1)):
        kit.motor_boat(f'motor-boat-{side}', (s * 5.17, -12.82), 15.3, 2.8, 8.95, col)
        kit.covered_launch(f'launch-{side}', (s * 9.34, -11.37), 12.1, 3.1, 6.8, col)
        # Keel 0.2 m above the reference's so the hull clears the shields of No. 5 casemates below.
        kit.open_boat(f'cutter-{1 if s < 0 else 2}', (s * 9.62, 8.0), 9.1, 2.4, 7.0, 1.22, col, chocks=(.15, .5, .85))


# ---------------------------------------------------------------- boat davits abreast the forward funnel
def davits(kit, col):
    """A-frame luffing davit on a deck-edge kingpost, its 9 m boat slung bow-aft over the launch."""
    for side, s, dz in (('port', -1, 0.0), ('starboard', 1, .25)):
        A = f'crane-{side}'

        def R(x, y, z):
            return P(s * x, y, z + dz)
        px, py, pz = R(13.08, 0, -11.56)
        floor = kit.support.below(px, py, 7.0)
        kit.cylz(A, col, 'pedestal', (px, py, floor), .24, 7.05 - floor, 'naval', 16)
        kit.cylz(A, col, 'turntable', (px, py, 7.04), .52, .13, 'naval', 24)
        kit.part('rod', A, col, 'topping post', (px, py, 7.17), (px, py, 9.86), .17, 'naval', vertices=10, r2=.09)
        kit.cylz(A, col, 'post cap', (px, py, 9.85), .13, .08, 'naval', 10)
        heads = [R(8.95, 13.75, -14.3), R(8.95, 13.75, -8.8)]
        # Two ladder-braced jibs spreading from the turntable to the heads.
        for heel, head in zip([R(12.8, 7.2, -11.9), R(12.8, 7.2, -11.2)], heads):
            kit.ladder(A, col, heel, head, (1, 0, 0), .42, .36, .05, .025)
        kit.member(A, col, R(12.6, 7.83, -11.1), R(9.76, 12.4, -13.53), .03, 'naval', 4)
        kit.member(A, col, R(12.6, 7.83, -12.01), R(9.76, 12.4, -9.57), .03, 'naval', 4)
        # Cross beam and the two arms the slung boat rests on.
        kit.member(A, col, R(10.9, 10.5, -12.9), R(10.9, 10.5, -10.2), .06, 'naval', 4)
        for z in (-13.3, -9.8):
            kit.part('box', A, col, 'boat rest', R(10.27, 10.52, z), (.25, 1.48, .2), 'naval')
            kit.part('box', A, col, 'chock', R(9.78, 10.9, z), (.3, .45, .5), 'naval')
        # Topping wires, the spreader between the heads, and the falls to the boat's slings.
        for h in heads:
            kit.wire(A, col, (px, py, 9.9), h, .02, False)
        kit.wire(A, col, heads[0], heads[1], .02, False)
        for h, (bz, blk) in zip(heads, ((-15.3, -14.45), (-8.1, -8.65))):
            kit.sheave(A, col, R(8.93, 13.6, blk), (1, 0, 0), .16, .12)
            for dy in (-.06, .06):
                kit.wire(A, col, R(8.93, 13.5, blk + dy), R(8.55, 11.6, bz + dy), .014, False)
        kit.open_boat(f'slung-boat-{side}', (s * 8.47, -11.685 + dz), 9.25, 2.42, 10.42, 1.41, col, bow=-1, outer='wood', inner='white', chocks=())

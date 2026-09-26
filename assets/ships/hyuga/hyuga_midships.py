"""Hyūga midships region: the funnel and its lattice tower, the searchlights, the boats and the boat derrick.

The measured prism round the funnel's middle (reference 10.2-17.0 m) stands for an open lattice: this
module draws the funnel casing and its fore and after trunks inside it, the tower's corner posts, X
bracing and girts, and knee braces out to the searchlight platform above. It adds the black cap's rim
and spark cage, the siren and steam pipes, the searchlights on their pedestals, the boats in their
cradles (cutters, motor launches, motor boats, dinghies and the landing craft) and the boat derrick with
its gooseneck, topping lift and falls. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from hyuga_kit import P, ZC
from hyuga_fittings_table import FITTINGS
from hyuga_windows import WINDOWS

CLAIMED_STRUCTURES = {'funnel-002'}
# Funnel casing (reference): a stadium x +-2.12 from z -7.24 to -0.24; fore trunk x +-1.88 from z -10.16 to -7.72.
CASING = dict(half=2.12, z0=-7.24, z1=-0.24)
FORE_TRUNK = dict(half=1.88, z0=-10.16, z1=-7.72)
AFT_TRUNK = dict(half=2.12, z0=0.04, z1=1.72)
TOWER = dict(half=4.25, z0=-9.95, z1=1.70, y0=10.2, y1=17.0)


def build(D, kit):
    cols = kit.cols
    sup = cols['Superstructure']
    funnel(D, kit, sup)
    lattice_tower(kit, sup)
    searchlights(kit, cols['Sensors and masts'])
    boats(kit, cols['Boats and aviation'])
    derrick(kit, cols['Sensors and masts'])
    kit.windows('superstructure-windows', sup, WINDOWS['superstructure'])
    # Platforms that stand on stanchions in the reference (their thin legs fall below the tracer's reach).
    for s in D['structures']:
        if s['id'] in ('midships-001', 'midships-002', 'midships-005', 'midships-006'):
            kit.stilts(s['id'] + '-legs', sup, s, .08)
        if s['id'] in ('midships-003', 'midships-004'):
            brackets(kit, sup, s)


def brackets(kit, col, s):
    """Cantilever brackets from the funnel's upper block aft under a searchlight platform."""
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] for p in s['footprint']]
    for fx in (min(xs) + .4, max(xs) - .4):
        start = Vector((-(min(zs) + .3), -fx, s['baseY'] - .05))
        hit = kit.try_along(tuple(start), (1, 0, 0), 3.0)
        if hit is None:
            continue
        foot = Vector((hit.x + .02, hit.y, s['baseY'] - .9))
        kit.part('rod', s['id'] + '-brackets', col, 'bracket', tuple(foot), (-(max(zs) - .4), -fx, s['baseY'] + .01), .06, 'naval', vertices=6)
        kit.part('rod', s['id'] + '-brackets', col, 'bracket', (hit.x + .02, hit.y, s['baseY'] + .01), (-(max(zs) - .4), -fx, s['baseY'] + .01), .06, 'naval', vertices=6)


def stadium_plan(half, z0, z1, grow=0.0, n=32):
    """Authoring plan outline of a stadium between reference z0 and z1."""
    cx = -((z0 + z1) / 2 - ZC)
    return [(cx + a, b) for a, b in _stadium(half + grow, (z1 - z0) + 2 * grow, n)]


def _stadium(half, length, n):
    straight = max(0, length / 2 - half)
    pts = []
    for i in range(n):
        a = i * math.tau / n
        pts.append((math.copysign(straight, math.cos(a)) + half * math.cos(a), half * math.sin(a)))
    return pts


def funnel(D, kit, col):
    F = 'funnel'
    t = TOWER
    kit.prism(F, col, 'casing', stadium_plan(CASING['half'], CASING['z0'], CASING['z1']), t['y0'] - .02, t['y1'] + .05, 'naval')
    kit.prism(F, col, 'fore trunk', stadium_plan(FORE_TRUNK['half'], FORE_TRUNK['z0'], FORE_TRUNK['z1'], 0, 24), t['y0'] - .02, 14.25, 'naval', 'roof')
    kit.prism(F, col, 'after trunk', stadium_plan(AFT_TRUNK['half'], AFT_TRUNK['z0'], AFT_TRUNK['z1'], 0, 24), t['y0'] - .02, 13.45, 'naval', 'roof')
    for yy in (12.0, 14.0, 16.0):
        kit.prism(F, col, 'band', stadium_plan(CASING['half'], CASING['z0'], CASING['z1'], .04), yy, yy + .1, 'naval')
    # Black cap: rim and spark cage over the top block, steam pipes and the siren.
    top = max(s['baseY'] + s['height'] for s in D['structures'] if s['id'].startswith('funnel-'))
    kit.prism(F, col, 'cap rim', stadium_plan(2.3, -6.95, -0.55, .1), top - .12, top + .04, 'black')
    for u in (.12, .3, .5, .7, .88):
        zr = -6.95 + (6.4) * u
        x = -(zr - ZC)
        kit.polyline(F, col, [(x, -2.35, top), (x, -2.0, top + .55), (x, 2.0, top + .55), (x, 2.35, top)], .035, 'black', 5)
    for yy in (-1.1, 1.1):
        kit.polyline(F, col, [(-(-6.6 - ZC), yy, top + .55), (-(-0.9 - ZC), yy, top + .55)], .035, 'black', 5)
    for rx, rz in ((-.8, -.2), (.8, -.2), (0, -.4)):
        x, y, _ = P(rx, 0, rz)
        kit.part('rod', F, col, 'steam pipe', (x, y, 17.0), (x, y, top + .5), .1, 'naval', vertices=10)
        kit.part('rod', F, col, 'steam pipe mouth', (x, y, top + .5), (x, y, top + .95), .1, 'black', vertices=10, r2=.16)
    x, y, _ = P(2.35, 0, -3.2)
    kit.part('rod', F, col, 'siren pipe', (x, y, 22.0), (x, y, 24.6), .07, 'naval', vertices=8)
    kit.part('rod', F, col, 'siren', (x - .25, y, 24.5), (x + .25, y, 24.5), .12, 'bronze', vertices=12)


def lattice_tower(kit, col):
    """Corner posts, X bracing and girts of the open tower round the funnel's middle section."""
    A = 'funnel-tower'
    t = TOWER
    h = t['half']
    corners = [(-h, t['z0']), (h, t['z0']), (h, t['z1']), (-h, t['z1'])]
    y0, y1 = t['y0'], t['y1']
    tiers = [y0, y0 + (y1 - y0) / 3, y0 + 2 * (y1 - y0) / 3, y1]
    for rx, rz in corners:
        kit.member(A, col, P(rx, y0 - .02, rz), P(rx, y1 + .02, rz), .16, 'naval', 8)
    faces = [((-h, t['z0']), (h, t['z0'])), ((h, t['z0']), (h, t['z1'])), ((h, t['z1']), (-h, t['z1'])), ((-h, t['z1']), (-h, t['z0']))]
    for (ax, az), (bx, bz) in faces:
        for ya, yb in zip(tiers, tiers[1:]):
            kit.member(A, col, P(ax, yb, az), P(bx, yb, bz), .09, 'naval', 4)
            kit.xbrace(A, col, P(ax, ya, az), P(bx, ya, bz), P(bx, yb, bz), P(ax, yb, az), .05)
        # Ties from each face's midpoint in to the casing.
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        cx = max(-CASING['half'], min(CASING['half'], mx))
        cz = max(CASING['z0'], min(CASING['z1'], mz))
        for yy in tiers[1:3]:
            kit.member(A, col, P(mx, yy, mz), P(cx, yy, cz), .06, 'naval', 4)
    # Knee braces from the posts out under the searchlight platform's overhang.
    for s in (-1, 1):
        for rz in (t['z0'], t['z1']):
            kit.member(A, col, P(s * h, y1 - 2.2, rz), P(s * 6.3, y1 + .02, rz), .08, 'naval', 6)
            kit.member(A, col, P(s * h, y1 - .02, rz), P(s * 6.3, y1 + .02, rz), .07, 'naval', 4)


def searchlight(kit, A, col, cx, y0, cz, size):
    x, y, _ = P(cx, 0, cz)
    floor = kit.try_below(x, y, y0 + .3, y0)
    h = size[1]
    kit.cylz(A, col, 'pedestal', (x, y, floor), .2, y0 + h * .35 - floor, 'naval', 12)
    kit.part('box', A, col, 'yoke', (x, y, y0 + h * .45), (.22, .95, .45), 'naval')
    c = y0 + h * .62
    kit.part('rod', A, col, 'drum', (x - .45, y, c), (x + .4, y, c), .5, 'naval', vertices=20)
    kit.part('rod', A, col, 'glass', (x + .4, y, c), (x + .45, y, c), .45, 'glass', vertices=20)
    kit.part('rod', A, col, 'vent', (x - .45, y, c), (x - .6, y, c), .28, 'naval', vertices=12)


def searchlights(kit, col):
    for i, (cx, y0, cz, sx, sy, sz) in enumerate(FITTINGS['searchlight'], 1):
        searchlight(kit, f'searchlight-{i}', col, cx, y0, cz, (sx, sy, sz))


def boats(kit, col):
    """Boats at the reference's positions (bounds centres), keels on their cradles. The reference turns
    several boats a few degrees off the centreline; they are stowed square here."""
    for i, (cx, y0, cz, sx, sy, sz) in enumerate(FITTINGS['cutter'], 1):
        kit.open_boat(f'cutter-{i}', (cx, cz), 9.0, 2.45, y0 + .05, 1.1, col, chocks=(.2, .5, .8))
    for i, (cx, y0, cz, sx, sy, sz) in enumerate(FITTINGS['dinghy'], 1):
        kit.open_boat(f'dinghy-{i}', (cx, cz), 5.9, 1.8, y0 + .05, .85, col, chocks=(.25, .75))
    for i, (cx, y0, cz, sx, sy, sz) in enumerate(FITTINGS['motor-launch'], 1):
        kit.covered_launch(f'motor-launch-{i}', (cx, cz), 12.0, 3.0, y0 + .05, col)
    for i, (cx, y0, cz, sx, sy, sz) in enumerate(FITTINGS['motor-boat'], 1):
        long = sz > 14
        kit.motor_boat(f'motor-boat-{i}', (cx, cz), 16.8 if long else 11.2, 3.3 if long else 2.7, y0 + .05, col)
    for i, (cx, y0, cz, sx, sy, sz) in enumerate(FITTINGS['landing-craft'], 1):
        landing_craft(kit, f'landing-craft-{i}', col, cx, y0, cz, 3.4, sy, 14.4)


def landing_craft(kit, A, col, cx, y0, cz, sx, sy, sz):
    """Daihatsu landing craft: a box hull with a bow ramp and a small after wheelhouse, on chocks."""
    x, y, _ = P(cx, 0, cz)
    L, W = sz, sx
    keel = y0 + .1
    kit.part('box', A, col, 'hull', (x, y, keel + .55), (L * .82, W, 1.1), 'naval')
    kit.part('box', A, col, 'well', (x + L * .05, y, keel + 1.08), (L * .6, W - .3, .06), 'dark')
    kit.part('box', A, col, 'bow ramp', (x + L * .45, y, keel + .75), (.15, W * .9, 1.3), 'naval')
    kit.part('box', A, col, 'wheelhouse', (x - L * .35, y, keel + 1.5), (1.4, 1.5, 1.0), 'naval')
    for t in (-.3, 0, .3):
        floor = kit.try_below(x + t * L, y, keel - .02, keel - .4)
        kit.part('box', A, col, 'chock', (x + t * L, y, (floor + keel) / 2), (.16, W * .7, max(.06, keel - floor + .02)), 'naval')


def derrick(kit, col):
    """Boat derrick on the centreline: boom from a gooseneck on the pagoda's after face up to its head
    over the funnel's forward trunk, with the topping lift, falls and hook."""
    A = 'boat-derrick'
    heel = Vector(P(0, 12.6, -21.2))
    head = Vector(P(0, 24.2, -7.4))
    wall = kit.try_along(tuple(heel + Vector((-.5, 0, 0))), (1, 0, 0), 4.0)
    if wall:
        kit.part('box', A, col, 'gooseneck bracket', (wall.x - .25, 0, heel.z), (.5, .8, .9), 'naval')
    kit.part('box', A, col, 'gooseneck', tuple(heel), (.7, .6, .6), 'naval')
    mid = heel.lerp(head, .45)
    kit.part('rod', A, col, 'boom', tuple(heel), tuple(mid), .2, 'naval', vertices=14, r2=.3)
    kit.part('rod', A, col, 'boom', tuple(mid), tuple(head), .3, 'naval', vertices=14, r2=.17)
    kit.part('box', A, col, 'head fitting', tuple(head + Vector((.1, 0, .1))), (.6, .35, .35), 'naval')
    kit.sheave(A, col, tuple(head + Vector((.2, 0, .3))), (0, 1, 0), .25, .12)
    # Topping lift to the pagoda, falls and the hook hanging from the head.
    top = Vector(P(0, 27.8, -21.0))
    kit.wire(A, col, tuple(head + Vector((.2, 0, .3))), tuple(top), .02, False)
    # The falls' lower block is hauled up close under the head, the hook hanging from it.
    block = head + Vector((.25, 0, -.45))
    kit.part('rod', A, col, 'block strop', tuple(head + Vector((.25, 0, -.05))), tuple(block), .05, 'black', vertices=6)
    kit.sheave(A, col, tuple(block), (0, 1, 0), .24, .16)
    kit.part('rod', A, col, 'hook', tuple(block + Vector((0, 0, -.2))), tuple(block + Vector((0, 0, -.62))), .05, 'black', vertices=6)

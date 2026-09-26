"""Omaha bridge and upperworks detail: the navigation platform round the pilot house with its wings, girder, rails,
side-light screens, flag boxes, binnacle and pelorus stands; the rails and pelorus platform on the pilot house roof;
the rails round the chart-house roof; the trestle under the after control station and the rails round the after
superstructure roof.

Datums are reference-frame positions (x starboard, y up, z toward the stern, metres) read off the approved
GameModels3D pasc005 model's hull and misc parts by plan, station and profile cuts; shapes are original
approximations at the measured sizes. No reference geometry is loaded.
"""
import math
from mathutils import Vector
from omaha_kit import P, R


def V(x, y, z):
    return Vector(P(x, y, z))


def structure(D, sid):
    return next(s for s in D['structures'] if s['id'] == sid)


def outline_ref(s):
    """A structure's footprint as reference-frame (x, z) points."""
    return [(x, z - .7523) for x, z in s['footprint']]


def rail_runs(kit, aid, col, pts, y, keep, height=1.0, spacing=1.5, closed=True, check=True):
    """Rails along the kept segments of a reference-frame (x, z) outline at height y, in unbroken runs."""
    seq = list(pts) + ([pts[0]] if closed else [])
    run = []
    for a, b in zip(seq, seq[1:]):
        if keep(a, b):
            if not run:
                run = [a]
            run.append(b)
        elif run:
            kit.rail(aid, col, [V(x, 0, z)[:2] for x, z in run], y, height, spacing, False, check)
            run = []
    if run:
        kit.rail(aid, col, [V(x, 0, z)[:2] for x, z in run], y, height, spacing, False, check)


def slab(kit, aid, col, label, pts, n, t, material='naval'):
    """A plate from a planar outline (authoring points) thickened by t along its normal n, centred on the outline."""
    n = Vector(n).normalized() * (t / 2)
    k = len(pts)
    vv = [tuple(Vector(p) - n) for p in pts] + [tuple(Vector(p) + n) for p in pts]
    ff = [tuple(range(k)), tuple(k + i for i in reversed(range(k)))] + [(i, (i + 1) % k, k + (i + 1) % k, k + i) for i in range(k)]
    return kit.solid(kit.tag(kit.mesh(aid + '.' + label, vv, ff, material, col), aid))


# ---------------------------------------------------------------- navigation platform
# Reference cut at 15.65 m: the plate (15.554-15.736 m) runs from the pilot house's front corners out to the wings,
# 14.7 m across, and ends aft at z -35.70 where the flag boxes stand.
PLATFORM_Y = (15.554, 15.736)
PLATFORM = [(-2.61, -43.43), (-5.93, -37.35), (-7.35, -37.35), (-7.35, -35.70), (7.35, -35.70), (7.35, -37.35), (5.93, -37.35), (2.61, -43.43)]


def navigation_platform(D, kit):
    col = kit.collections['Superstructure']
    aid = 'navigation-bridge'
    y0, y1 = PLATFORM_Y
    kit.prism(aid, col, 'platform', [V(x, 0, z)[:2] for x, z in PLATFORM], y0, y1, 'naval', 'roof')
    # Transverse girder under the plate between the tripod legs (reference 15.10-15.55 m at z -37.25), with knees.
    g = [V(-4.60, y0 + .01, -37.25), V(4.50, y0 + .01, -37.25), V(4.00, 15.10, -37.25), V(-4.00, 15.10, -37.25)]
    slab(kit, aid, col, 'girder', g, (1, 0, 0), .10)
    for x in (-3.0, -1.0, 1.0, 3.0):
        k = [V(x, y0 + .01, -37.20), V(x, y0 + .01, -36.60), V(x, 15.30, -37.20)]
        slab(kit, aid, col, 'knee', k, (0, 1, 0), .06)
    # Rails: the slanted fronts, the wings and the aft edge outboard of the flag boxes.
    front = {(-2.61, -43.43), (2.61, -43.43)}
    keep = lambda a, b: not (a in front and b in front) and not (abs(a[1] + 35.70) < .01 and abs(b[1] + 35.70) < .01)
    rail_runs(kit, aid, col, PLATFORM, y1, keep, 1.0, 1.4, True, False)
    for s in (-1, 1):
        kit.rail(aid, col, [V(s * 7.35, 0, -35.70)[:2], V(s * 4.50, 0, -35.70)[:2]], y1, 1.0, 1.4, False, False)
        # Side-light screens hung outboard of the wing ends, two tiers (AM047/AM048), red to port, green to starboard.
        for ya, yb in ((15.75, 16.09), (16.43, 16.76)):
            c = V(s * 7.61, (ya + yb) / 2, -36.55)
            kit.boxc(aid, col, 'side-light screen', c, (1.25, .52, yb - ya), 'naval')
            kit.part('rod', aid, col, 'side light', c + Vector((.2, -s * .27, 0)), c + Vector((.2, -s * .30, 0)), .10,
                     'red' if s < 0 else 'green', vertices=10)
        # Signal lamps on the rail at the wings' after corners (AM164).
        c = V(s * 7.28, 16.76, -35.76)
        kit.cylz(aid, col, 'signal lamp', c, .19, .42, 'naval', 12)
        kit.cylz(aid, col, 'signal lamp hood', c + Vector((0, 0, .42)), .12, .16, 'edge', 10)
        kit.part('rod', aid, col, 'signal lamp lens', c + Vector((.19, 0, .22)), c + Vector((.21, 0, .22)), .13, 'glass', vertices=10)
        # Pelorus stands on the platform (AM025).
        pelorus(kit, aid, col, V(s * 4.71, y1, -38.14), 1.30)
        # Flag boxes across the aft edge (AM170: 15.14-16.73 m, z -35.69 to -34.83).
        c = V(s * 2.71, (15.14 + 16.73) / 2, -35.27)
        kit.boxc(aid, col, 'flag box', c, (.90, 3.52, 1.59), 'naval')
        kit.boxc(aid, col, 'flag box lid', c + Vector((0, 0, .82)), (.96, 3.58, .05), 'edge')
        for k in range(1, 6):
            kit.boxc(aid, col, 'flag box division', c + Vector((-.46, s * (k * .58 - 1.74), .1)), (.03, .04, 1.3), 'edge')
    # The binnacle on its step between the flag boxes (reference step 15.55-16.21 m; AM018 1.57 m tall).
    kit.boxc(aid, col, 'binnacle step', V(0, (y0 + 16.205) / 2, -35.21), (.98, 1.90, 16.205 - y0), 'naval')
    b = V(0, 16.205, -35.16)
    kit.cylz(aid, col, 'binnacle pedestal', b, .24, .95, 'naval', 16, r2=.19)
    kit.cylz(aid, col, 'binnacle bowl', b + Vector((0, 0, .95)), .30, .22, 'brass', 18)
    kit.cylz(aid, col, 'binnacle hood', b + Vector((0, 0, 1.17)), .27, .40, 'brass', 18, r2=.10)
    for t in (-1, 1):
        kit.part('rod', aid, col, 'corrector arm', b + Vector((0, t * .16, 1.0)), b + Vector((0, t * .36, 1.0)), .03, 'edge', vertices=6)
        kit.part('cyl', aid, col, 'corrector sphere', b + Vector((0, t * .40, 1.0)), .10, .18, 'green' if t > 0 else 'red', vertices=12)
    # Lockers behind the pilot house on the plate (AM224 ammunition boxes, AM233 locker).
    for x in (-.49, .49):
        kit.boxc(aid, col, 'ready-use locker', V(x, (y1 + 16.56) / 2, -39.01), (.56, .96, 16.56 - y1), 'naval')
    kit.boxc(aid, col, 'tall locker', V(1.18, (y1 + 17.32) / 2, -39.70), (.60, .40, 17.32 - y1), 'naval')


def pelorus(kit, aid, col, c, height):
    """A pelorus stand: column, dial and sight vanes."""
    kit.cylz(aid, col, 'pelorus column', c, .08, height - .12, 'naval', 10, r2=.06)
    kit.cylz(aid, col, 'pelorus dial', c + Vector((0, 0, height - .12)), .19, .07, 'brass', 14)
    for t in (-1, 1):
        kit.boxc(aid, col, 'pelorus vane', c + Vector((t * .15, 0, height + .02)), (.02, .10, .22), 'edge')


# ---------------------------------------------------------------- pilot house roof
def pilot_house_roof(D, kit):
    """Rails round the pilot house roof and the raised pelorus platform on its after annex (reference 18.68-18.77 m,
    0.8 m radius at z -39.80), with the third pelorus (AM025 at 18.67-20.07 m)."""
    col = kit.collections['Superstructure']
    aid = 'pilot-house-roof'
    s = structure(D, 'fwd-07')
    top = s['baseY'] + s['height']
    ring = outline_ref(s)
    # The annex's after edge carries the pelorus platform; the rest of the roof edge is railed.
    keep = lambda a, b: not (a[1] > -39.9 and b[1] > -39.9)
    rail_runs(kit, aid, col, ring, top, keep, .95, 1.2, True, False)
    c = V(0, 18.68, -39.80)
    kit.cylz(aid, col, 'pelorus platform post', Vector((c.x, c.y, top - .02)), .20, 18.68 - top + .03, 'naval', 12)
    kit.cylz(aid, col, 'pelorus platform', c, .80, .09, 'naval', 24)
    pts = [(c.x + .78 * math.cos(math.tau * k / 12), c.y + .78 * math.sin(math.tau * k / 12)) for k in range(12)]
    # Open toward the roof ladder on its forward side.
    kit.rail(aid, col, pts[1:12], 18.77, .9, .6, False, False)
    pelorus(kit, aid, col, c + Vector((-.08, 0, .09)), 1.30)
    kit.ladder(aid, col, Vector((c.x + .95, c.y - .55, top + .02)), Vector((c.x + .80, c.y - .55, 18.72)), (0, 1, 0), .40, .25)


# ---------------------------------------------------------------- chart-house roof (13.3 m)
def chart_house_roof(D, kit):
    """Rails along the outboard and after edges of the 13.3 m roof beside and abaft the bridge tiers (reference
    stanchions at x +-2.66 and along z -36.2)."""
    col = kit.collections['Superstructure']
    aid = 'chart-house-roof'
    s = structure(D, 'fwd-04')
    top = s['baseY'] + s['height']
    ring = outline_ref(s)
    # Only where the roof is open: abaft the pilot house front (z > -43.3) and outside the tiers above (|x| > 1.8).
    keep = lambda a, b: min(a[1], b[1]) > -43.3 and (min(abs(a[0]), abs(b[0])) > 1.8 or max(a[1], b[1]) > -38.0)
    rail_runs(kit, aid, col, ring, top, keep, 1.0, 1.4, True, True)


# ---------------------------------------------------------------- after control station
def after_station(D, kit):
    """The trestle carrying the after control station forward of the after superstructure: four legs from the upper
    deck to the station's floor at 8.85 m with X-braced faces (reference plan cut at 7.5 m: x +-1.65, z 38.1 to
    41.5), and the rails round the after superstructure roof."""
    col = kit.collections['Superstructure']
    aid = 'after-station-trestle'
    floor = structure(D, 'aft-03')['baseY']
    # Under the station's floor (this recipe's aft-03 carries it from z 38.5 to 41.6, 3 m across).
    corners = [(-1.42, 38.62), (1.42, 38.62), (1.42, 41.45), (-1.42, 41.45)]
    feet = []
    for x, z in corners:
        c = V(x, 0, z)
        foot = kit.below(c.x, c.y, floor - .3, 5.5)
        feet.append((Vector((c.x, c.y, foot - .02)), Vector((c.x, c.y, floor + .02))))
        kit.member(aid, col, feet[-1][0], feet[-1][1], .09, 'naval', 8)
    for i in range(4):
        (a0, a1), (b0, b1) = feet[i], feet[(i + 1) % 4]
        mid_a, mid_b = a0.lerp(a1, .5), b0.lerp(b1, .5)
        for p, q in ((a0, mid_b), (mid_a, b0), (mid_a, b1), (a1, mid_b)):
            kit.member(aid, col, p, q, .045, 'naval', 6)
        kit.member(aid, col, mid_a, mid_b, .05, 'naval', 6)
    top = V(.85, floor + .02, 38.50)
    foot = V(.85, 0, 36.30)
    foot.z = kit.below(foot.x, foot.y, floor - .5, 5.5)
    kit.ladder(aid, col, foot, top, (0, 1, 0), .6, .28)
    # The rangefinder's round platform (reference 12.14-12.27 m, 1.46 m radius) on a flared pedestal from the
    # station's roof, railed round.
    c = V(0, 12.14, 40.184)
    base = structure(D, 'aft-09')['baseY'] + structure(D, 'aft-09')['height']
    kit.cylz('after-station-platform', col, 'pedestal', Vector((c.x, c.y, base - .02)), .75, 12.15 - base, 'naval', 24, r2=1.2)
    kit.cylz('after-station-platform', col, 'platform', c, 1.46, .13, 'naval', 32)
    pts = [(c.x + 1.42 * math.cos(math.tau * k / 16), c.y + 1.42 * math.sin(math.tau * k / 16)) for k in range(16)]
    kit.rail('after-station-platform', col, pts[2:] + pts[:1], 12.27, .95, .9, False, False)
    # Roof rails of the after superstructure (9.25 m), kept out of the 1.1-inch mounts' reach.
    s = structure(D, 'aft-04')
    top = s['baseY'] + s['height']
    ring = outline_ref(s)
    keep = lambda a, b: not (max(a[1], b[1]) < 41.6 and max(abs(a[0]), abs(b[0])) < 1.8)
    rail_runs(kit, 'after-superstructure-rails', col, ring, top, keep, 1.0, 1.4, True, True)


def build(D, kit):
    navigation_platform(D, kit)
    pilot_house_roof(D, kit)
    chart_house_roof(D, kit)
    after_station(D, kit)

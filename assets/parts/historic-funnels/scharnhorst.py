"""Original Scharnhorst funnel, viewed against GM3D's 1939 asset.

Hand-authored sections and fittings in metres, +X forward / +Y port / +Z up.
No reference mesh or texture is an input. The installation sole is Z=0.
"""
import math
import sys
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'construction'))
from geometry import Model

N = 32
# Egg plans as (fullest station, forward semi-length, aft semi-length, half beam).
# The run aft is a half ellipse; the blunter entrance is a 2.2 superellipse.
CASING = (1.0, 3.30, 5.30, 2.56)
COWL = (1.0, 2.83, 5.02, 2.17)
SHELF = (1.1, 3.58, 5.60, 3.03)
GALLERY_Z, SHELF_Z, BAFFLE_Z = 5.05, 8.56, 8.20


def grow(plan, d): return (plan[0], plan[1]+d, plan[2]+d, plan[3]+d)


def at(plan, a, z=0):
    x0, fore, aft, beam = plan
    c, s = math.cos(a), math.sin(a)
    if c < 0: return Vector((x0+aft*c, beam*s, z))
    return Vector((x0+fore*abs(c)**(1/1.1), math.copysign(beam*abs(s)**(1/1.1), s), z))


def egg(plan, z, n=N): return [tuple(at(plan, i*math.tau/n, z)) for i in range(n)]


def crown(x): return 10.31+.219*x


def raked(plan, drop=0, n=N):
    return [(p.x, p.y, crown(p.x)-drop) for p in (at(plan, i*math.tau/n) for i in range(n))]


def skin(m, name, rings, mat='naval'):
    n = len(rings[0])
    # Split normals at each authored section, smooth around the circumference.
    for a, b in zip(rings, rings[1:]):
        m.mesh(name, a+b, [(i, (i+1) % n, n+(i+1) % n, n+i) for i in range(n)], mat=mat, smooth=True)


def outward(plan, a):
    d = at(plan, a+.01)-at(plan, a-.01)
    return Vector((d.y, -d.x, 0)).normalized()


def standing(plan, degrees, off, z):
    a = math.radians(degrees)
    return at(plan, a, z)+outward(plan, a)*off


def half_breadth(plan, x):
    x0, fore, aft, beam = plan
    if x < x0: return beam*math.sqrt(max(0, 1-((x0-x)/aft)**2))
    return beam*max(0, 1-((x-x0)/fore)**2.2)**(1/2.2)


def sleeve(m, name, plan, first, last, lo, hi, proud, mat='naval'):
    """A closed stiffener strap over part of the circumference."""
    inner = [at(plan, i*math.tau/N) for i in range(first, last+1)]
    outer = [at(grow(plan, proud), i*math.tau/N) for i in range(first, last+1)]
    k = len(inner)
    vs = [(p.x, p.y, z) for z in [lo, hi] for ring in [inner, outer] for p in ring]
    fs = []
    for i in range(k-1):
        fs += [(k+i, k+i+1, 3*k+i+1, 3*k+i), (2*k+i, 2*k+i+1, 3*k+i+1, 3*k+i), (i, i+1, k+i+1, k+i)]
    fs += [(0, k, 3*k, 2*k), (k-1, 2*k-1, 4*k-1, 3*k-1)]
    m.mesh(name, vs, fs, mat=mat)


def jackstay(m, name, plan, z, first=0, last=N, off=.16):
    closed = last-first == N
    points = [standing(plan, i*360/N, off, z) for i in range(first, last if closed else last+1, 2)]
    m.path(name, points, .02, closed=closed, vertices=3)
    for i in range(first, last if closed else last+1, 4):
        m.rod(name+'-bracket', standing(plan, i*360/N, -.02, z), standing(plan, i*360/N, off, z), .018, vertices=3)


def gooseneck(m, name, plan, degrees, radius, foot, top, off=.27, saddles=(.35, 1.4, 4.1)):
    """A waste-steam pipe clipped to the casing, turned outboard at its head."""
    points = [standing(grow(CASING, .11), degrees, off, .08), standing(grow(CASING, .11), degrees, off, foot),
              standing(plan, degrees, off, foot+.45), standing(plan, degrees, off, top)]
    a = math.radians(degrees)
    points += [points[-1]+outward(plan, a)*.10+Vector((0, 0, .14)), points[-1]+outward(plan, a)*.30+Vector((0, 0, .10))]
    m.path(name, points, radius, vertices=6)
    m.cyl(name+'-mouth', points[-1]+outward(plan, a)*.005, radius*.72, .012, mat='dark', vertices=8).rotation_euler = \
        outward(plan, a).to_track_quat('Z', 'Y').to_euler()
    for z in [z for z in saddles if z < top-.5]+[top-.35]:
        base = grow(CASING, .11) if z < 2.85 else plan
        m.rod(name+'-saddle', standing(base, degrees, -.03, z), standing(base, degrees, off, z), radius*.55, vertices=4)


def create_scharnhorst(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    m.root['funnelOutletWidthM'] = 4.0
    m.root['funnelOutletLengthM'] = 7.5

    # Doubled foot plating, a short chamfer, then the plain egg-plan jacket.
    foot = grow(CASING, .11)
    skin(m, 'deck-sole', [egg(grow(foot, .035), 0), egg(grow(foot, .035), .05), egg(grow(foot, -.01), .05)], 'painted-edge')
    skin(m, 'casing', [egg(foot, 0), egg(foot, 2.85), egg(CASING, 3.02), egg(CASING, SHELF_Z)])
    # Forward stiffener straps stop abreast the ladders, as on the long run aft.
    for z in [3.78, 4.79]:
        sleeve(m, 'forward-strap', CASING, -9, 9, z-.05, z+.05, .08)
    for side in [-1, 1]:
        y = side*(half_breadth(foot, .35)+.005)
        door = m.box('casing-door', (.35, y, 1.95), (.92, .05, 2.0), mat='painted-edge')
        door.rotation_euler.z = side*.06
        for z in [1.30, 2.60]:
            m.box('door-clip', (.84, y+side*.025, z), (.10, .05, .16), mat='edge')

    # Cap shelf: a walking rim outside the jacket, its apron rising to the cowl.
    skin(m, 'cap-shelf', [egg(CASING, SHELF_Z), egg(SHELF, SHELF_Z), egg(SHELF, SHELF_Z+.11), egg(COWL, SHELF_Z+.34)])
    rim = grow(SHELF, -.04)
    for i in range(0, N, 2):
        p = at(rim, i*math.tau/N, SHELF_Z+.10)
        m.rod('shelf-stanchion', p, p+Vector((0, 0, .26)), .018, vertices=3)
    m.path('shelf-rail', [at(rim, i*math.tau/N, SHELF_Z+.35) for i in range(0, N, 2)], .018, closed=True, vertices=3)

    # Raked cowl with a real lip, a short liner and a shallow soot baffle.
    inner = grow(COWL, -.10)
    skin(m, 'cowl-foot-strap', [egg(grow(COWL, .012), SHELF_Z+.32), egg(grow(COWL, .012), SHELF_Z+.46)], 'painted-edge')
    skin(m, 'cowl', [egg(COWL, SHELF_Z+.30), raked(COWL)])
    skin(m, 'cowl-lip', [raked(COWL), raked(inner)], 'painted-edge')
    skin(m, 'uptake-liner', [raked(inner), egg(grow(inner, -.02), BAFFLE_Z)], 'dark')
    m.mesh('soot-baffle', egg(grow(inner, -.02), BAFFLE_Z), [tuple(range(N))], mat='dark')
    # Egg-crate uptake dividers finish just below the lip and rest on the baffle.
    def divider(name, a, b):
        t = Vector((b[1]-a[1], a[0]-b[0])).normalized()*.03
        ends = [(p[0]+t.x*s, p[1]+t.y*s, p[0]) for p in [a, b] for s in [1, -1]]
        vs = [(x, y, BAFFLE_Z) for x, y, _ in ends]+[(x, y, crown(station)-.06) for x, y, station in ends]
        m.mesh(name, vs, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)], mat='edge')
    divider('uptake-divider', (-3.92, 0), (3.70, 0))
    for side in [-1, 1]:
        divider('uptake-divider', (-3.72, side*.45), (3.58, side*.45))
    for x in [-1.90, -.22, 1.55, 3.05]:
        y = half_breadth(inner, x)-.03
        divider('uptake-crossplate', (x, -y), (x, y))

    # Mushroom ventilators for the jacket air space stand on the apron.
    apron = ((COWL[0]+CASING[0])/2, 3.07, 5.16, 2.37)
    for degrees in [10, 21, 31, 41, 50, 63, 75, 87, 109, 114, 119, 124, 130, 136, 149, 159, 171,
                    -31, -41, -50, -64, -74, -84, -95, -99, -103, -107, -111, -115, -119, -171]:
        p = at(apron, math.radians(degrees), SHELF_Z+.12)
        m.rod('jacket-vent', p, p+Vector((0, 0, .62)), .10, vertices=4)
        m.rod('jacket-vent-cowl', p+Vector((0, 0, .52)), p+Vector((0, 0, .76)), .19, r2=.10, vertices=6)

    # Gallery: a walkway carried on gussets, with a ladder trunk each side.
    walk, trunk = grow(CASING, .80), grow(CASING, .55)
    hatches = {7, N-8}
    for lo, hi in [(GALLERY_Z, GALLERY_Z+.12)]:
        for i in range(N):
            a, b = i*math.tau/N, (i+1)*math.tau/N
            near = trunk if i in hatches else grow(CASING, -.03)
            quad = [at(near, a), at(near, b), at(walk, b), at(walk, a)]
            faces = [(3, 2, 1, 0), (4, 5, 6, 7), (2, 3, 7, 6), (0, 1, 5, 4)]
            # Close the plating where it is cut for a ladder trunk.
            if (i-1) % N in hatches: faces.append((0, 3, 7, 4))
            if (i+1) % N in hatches: faces.append((1, 2, 6, 5))
            m.mesh('gallery', [(p.x, p.y, z) for z in [lo, hi] for p in quad], faces, mat='roof')
    edge = grow(walk, -.04)
    for i in range(0, N, 2):
        p = at(edge, i*math.tau/N, GALLERY_Z+.10)
        m.rod('gallery-stanchion', p, p+Vector((0, 0, 1.02)), .022, vertices=4)
    for rise in [.56, 1.10]:
        m.path('gallery-rail', [at(edge, i*math.tau/N, GALLERY_Z+rise) for i in range(0, N, 2)], .018, closed=True, vertices=3)
    for i in range(1, N, 3):
        a = i*math.tau/N
        root, tip, normal = at(CASING, a), at(grow(walk, -.08), a), outward(CASING, a)
        across = Vector((-normal.y, normal.x, 0))*.025
        vs = [v+across*s for s in [1, -1] for v in [Vector((root.x, root.y, GALLERY_Z-.75))-normal*.03,
                                                     Vector((root.x, root.y, GALLERY_Z+.01))-normal*.03,
                                                     Vector((tip.x, tip.y, GALLERY_Z+.01))]]
        m.mesh('gallery-gusset', [tuple(v) for v in vs], [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])

    for side in [-1, 1]:
        # Ladder from the foot, through the gallery trunk, to a grab length above.
        a = side*7.5*math.tau/N
        normal = outward(CASING, a)
        along = Vector((-normal.y, normal.x, 0))*.21
        def run(z, off=.22):
            # The ladder follows the doubled foot, then cranks in to the jacket.
            t = max(0, min(1, (z-2.85)/.25))
            return standing(foot, math.degrees(a), off, z).lerp(standing(CASING, math.degrees(a), off, z), t)
        for s in [-1, 1]:
            m.path('ladder-stringer', [run(z)+along*s for z in [.45, 2.85, 3.10, GALLERY_Z+1.0]], .022, vertices=4)
        for i in range(19):
            m.rod('ladder-rung', run(.60+.30*i)-along, run(.60+.30*i)+along, .016, vertices=3)
        for z in [.75, 2.55, 4.05, GALLERY_Z+.80]:
            for s in [-1, 1]:
                m.rod('ladder-clip', run(z, -.02)+along*s, run(z)+along*s, .018, vertices=3)
        # Ready-use locker standing on the gallery against the jacket.
        y = side*(half_breadth(CASING, .30)+.17)
        m.box('gallery-locker', (.30, y, GALLERY_Z+1.05), (1.06, .40, 1.86)).rotation_euler.z = side*.064
        # Tall waste pipe: up the jacket, cranked round the shelf rim.
        riser = [standing(foot, side*106, .30, .08), standing(foot, side*106, .30, 2.80), standing(CASING, side*106, .30, 3.15),
                 standing(CASING, side*106, .30, 7.85), standing(SHELF, side*106, .11, 8.42), standing(SHELF, side*106, .11, 8.95)]
        m.path('waste-pipe', riser, .075, vertices=6)
        m.cyl('waste-pipe-mouth', riser[-1]+Vector((0, 0, .005)), .055, .012, mat='dark', vertices=8)
        for z in [1.2, 4.2, 6.9]:
            base = foot if z < 2.85 else CASING
            m.rod('waste-pipe-saddle', standing(base, side*106, -.03, z), standing(base, side*106, .30, z), .05, vertices=4)
        m.rod('waste-pipe-saddle', standing(SHELF, side*106, -.04, SHELF_Z+.05), standing(SHELF, side*106, .13, SHELF_Z+.05), .05, vertices=4)
        gooseneck(m, 'steam-pipe', CASING, side*24, .085, 2.55, 6.35)
        # Short boiler-room vent pipe on the quarter.
        gooseneck(m, 'quarter-vent', foot, side*146, .05, 1.0, 1.85, off=.24, saddles=(.35, 1.2))
    gooseneck(m, 'auxiliary-steam-pipe', CASING, -10, .05, 2.55, 6.75, off=.24)

    # Jackstays stand off the plating on short brackets.
    jackstay(m, 'jackstay', foot, 2.08)
    jackstay(m, 'jackstay', CASING, 3.65)
    jackstay(m, 'jackstay', CASING, 8.08)
    jackstay(m, 'cowl-jackstay', COWL, 9.62, -10, 10)

    # A steam whistle is bracketed to each side of the cowl.
    for side in [-1, 1]:
        p = standing(COWL, side*88, .16, 9.98)
        m.box('whistle-bracket', tuple(standing(COWL, side*88, .07, 9.96)), (.20, .30, .04), mat='painted-edge')
        m.rod('whistle', p, p+Vector((0, 0, .26)), .055, mat='bright', vertices=8)
        m.rod('whistle-horn', p+Vector((0, 0, .22)), p+Vector((0, side*.42, .46)), .03, r2=.07, mat='bright', vertices=8)
    return m.root

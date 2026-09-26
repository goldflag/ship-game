"""Nagato masts, funnel top and optics: the pagoda's topmast, yards and rangefinders, the tripod mainmast with its
crosstree, topmast, gaff and aircraft crane jib, the funnel cap, directors, searchlights and periscopes.

Datums are reference-frame measurements (x starboard, y up, z toward the stern, metres) converted by `P`, read from
plan and profile cuts (`ship:slice --plan/--section`) and the part bounds of the cached pjsb010 reference.
"""
import math
import bpy
from mathutils import Vector
from nagato_kit import P, ZC

# Mainmast prisms above the trunk that the mast drawing replaces (none: the trunk and crosstree are measured).
CLAIMED_STRUCTURES = set()


def attach(kit, objs, parent):
    bpy.context.view_layer.update()
    inverse = parent.matrix_world.inverted()
    for o in objs:
        o.parent = parent
        o.matrix_parent_inverse = inverse


def rod(kit, assembly, col, label, a, b, r, material='naval', vertices=10, r2=None):
    return kit.part('rod', assembly, col, label, P(*a), P(*b), r, material, vertices=vertices, r2=r2)


# ------------------------------------------------------------------ pagoda
def pagoda(kit):
    col = kit.collections['Sensors and masts']
    A = 'pagoda-mast'
    # Topmast on the after face of the director platform (x = 0 profile cut), with its wind vane.
    rod(kit, A, col, 'topmast', (0, 33.75, -27.72), (0, 40.75, -27.62), .16, 'black', 10, .09)
    rod(kit, A, col, 'topmast heel band', (0, 33.75, -27.72), (0, 34.05, -27.72), .22, 'naval', 10)
    kit.boxc(A, col, 'wind vane arm', P(0, 40.72, -27.42), (.7, .04, .04), 'black')
    kit.cylz(A, col, 'wind vane cup', P(0, 40.72, -27.12), .09, .16, 'black', 8)
    # Signal yards: one across the topmast and a longer one along the pagoda's after face, each braced.
    for y, z, half, name in [(36.3, -27.68, 7.9, 'upper yard'), (31.75, -34.05, 8.9, 'lower yard')]:
        rod(kit, A, col, name, (-half, y, z), (half, y, z), .09, 'black', 8, None)
        rod(kit, A, col, name + ' bracket', (0, y, z + .1), (0, y, z - 1.2), .12, 'black', 8)
        for s in (-1, 1):
            rod(kit, A, col, name + ' brace', (s * half * .55, y, z), (s * 1.1, y - 1.6, z), .04, 'black', 6)
            for k in range(4):
                xx = s * half * (.35 + .18 * k)
                rod(kit, A, col, name + ' halyard block', (xx, y - .02, z), (xx, y - .22, z), .05, 'black', 6)
    # The 10 m rangefinder housing on its platform (jf046: 10.5 m across, 30.7 to 33.1 m).
    R = 'rangefinder-10m'
    x, yy, z = P(0, 30.71, -35.13)
    kit.cylz(R, col, 'turntable', (x, yy, z), 1.05, .25, 'edge', 28)
    kit.boxc(R, col, 'housing', (x, yy, z + 1.05), (1.8, 2.3, 1.6), 'naval')
    kit.boxc(R, col, 'housing roof', (x, yy, z + 1.9), (1.95, 2.45, .1), 'roof')
    kit.part('rod', R, col, 'tube', (x - .1, yy - 5.25, z + 1.25), (x - .1, yy + 5.25, z + 1.25), .34, 'naval', vertices=18)
    for s in (-1, 1):
        kit.boxc(R, col, 'end hood', (x - .1, yy + s * 5.0, z + 1.25), (1.0, .7, 1.0), 'naval')
        kit.part('rod', R, col, 'objective', (x + .4, yy + s * 5.0, z + 1.25), (x + .44, yy + s * 5.0, z + 1.25), .22, 'glass', vertices=14)
    for dy in (-.6, 0, .6):
        kit.boxc(R, col, 'sight port', (x + .91, yy + dy, z + 1.45), (.04, .32, .24), 'glass')
    # 4.5 m and 1.5 m rangefinders (jf047, jf012) at their datums; bearing is the line of sight.
    for x0, y0, z0, bearing, width in [(-4.41, 24.52, -34.52, -90, 4.5), (4.41, 24.52, -34.52, 90, 4.5), (-8.97, 13.96, -4.69, -90, 4.5),
                                       (8.97, 13.96, -4.69, 90, 4.5), (-3.28, 17.58, 23.53, -90, 4.5), (3.28, 17.58, 23.53, 90, 4.5),
                                       (-4.70, 25.69, -29.60, 0, 1.5), (4.70, 25.69, -29.60, 0, 1.5)]:
        rid = f'rangefinder-{width:g}m-{"port" if x0 < 0 else "starboard"}-{abs(round(z0))}'
        px, py, pz = P(x0, y0, z0)
        kit.rangefinder(rid, px, py, pz, width, -bearing, col, pedestal=.55 if width > 2 else .45, hood=.5 if width > 2 else .32)


# ------------------------------------------------------------------ directors and lights
def directors(kit):
    col = kit.collections['Sensors and masts']
    # Type 91 high-angle directors on their sponsons (jd008: 2.7 m across, 12.05 to 14.06 m).
    for s in (-1, 1):
        A = 'ha-director-' + ('port' if s < 0 else 'starboard')
        x, y, z = P(s * 11.553, 12.05, -4.707)
        kit.cylz(A, col, 'base', (x, y, z), 1.05, .3, 'edge', 24)
        kit.cylz(A, col, 'drum', (x, y, z + .3), 1.25, 1.15, 'naval', 24)
        kit.cylz(A, col, 'roof', (x, y, z + 1.45), 1.32, .07, 'roof', 24)
        kit.boxc(A, col, 'sight hood', (x + .2, y, z + 1.72), (.9, .8, .5), 'naval')
        kit.part('rod', A, col, 'rangefinder', (x - .25, y - 1.45, z + 1.05), (x - .25, y + 1.45, z + 1.05), .14, 'naval', vertices=12)
        for t in (-1, 1):
            kit.boxc(A, col, 'rangefinder hood', (x - .25, y + t * 1.45, z + 1.05), (.36, .2, .36), 'naval')
        for dy in (-.35, .35):
            kit.boxc(A, col, 'window', (x + 1.24, y + dy, z + 1.05), (.04, .28, .22), 'glass')
    # Machine-gun control positions (jd056): a pedestal sight under a hood.
    for s in (-1, 1):
        A = 'mg-control-' + ('port' if s < 0 else 'starboard')
        x, y, z = P(s * 5.50, 13.452, -6.98)
        kit.cylz(A, col, 'pedestal', (x, y, z), .14, .75, 'naval', 12)
        kit.boxc(A, col, 'sight', (x, y, z + .92), (.55, .5, .35), 'naval')
        kit.part('rod', A, col, 'binocular', (x + .1, y - .25, z + 1.02), (x + .1, y + .25, z + 1.02), .06, 'edge', vertices=8)
    # Periscope heads of the after control position (jf027, jf048).
    for x0, y0, z0, r in [(-3.72, 17.89, 18.3, 1.0), (3.72, 17.89, 18.3, 1.0), (-2.51, 19.875, 16.48, .95), (2.34, 19.875, 16.23, .95)]:
        A = 'periscope-' + ('port' if x0 < 0 else 'starboard') + f'-{round(z0)}'
        x, y, z = P(x0, y0, z0)
        kit.cylz(A, col, 'drum', (x, y, z), r * .8, .75, 'naval', 20)
        kit.cylz(A, col, 'cap', (x, y, z + .75), r * .85, .1, 'roof', 20)
        kit.part('rod', A, col, 'periscope', (x, y, z + .85), (x, y, z + 1.25), .09, 'edge', vertices=8)
        kit.boxc(A, col, 'eyepiece', (x + .1, y, z + 1.28), (.28, .16, .12), 'edge')
    # Searchlights on their platforms round the funnel (jm008), trained outboard, and the two control sights.
    for x0, y0, z0 in [(-4.554, 15.501, -9.495), (4.554, 15.501, -9.495), (-3.442, 17.625, -6.465), (3.458, 17.625, -6.465),
                       (-4.354, 15.501, -2.593), (4.371, 15.501, -2.593)]:
        x, y, z = P(x0, y0, z0)
        kit.searchlight('searchlight-' + ('port' if x0 < 0 else 'starboard') + f'-{abs(round(z0))}', x, y, z, 90 if x0 < 0 else -90, col, drum=.52)
    for x0 in (-2.288, 2.375):
        A = 'searchlight-control-' + ('port' if x0 < 0 else 'starboard')
        x, y, z = P(x0, 20.435, 20.155)
        # Held to the reference's 0.93 m so the 25 mm singles beside it clear it at level.
        kit.cylz(A, col, 'pedestal', (x, y, z), .25, .22, 'naval', 16)
        kit.cylz(A, col, 'drum', (x, y, z + .22), .78, .5, 'naval', 20)
        kit.boxc(A, col, 'hood', (x + .25, y, z + .82), (.6, .5, .2), 'naval')


# ------------------------------------------------------------------ mainmast
def mainmast(kit):
    col = kit.collections['Sensors and masts']
    A = 'mainmast'
    # The trunk between the after control position's roof (20.25 m) and the 23.65 m platform: a 0.76 m square (plan
    # cuts y = 20.5 to 23.4), black above the paint line.
    for y0, y1, paint in ((20.23, 22.65, 'naval'), (22.65, 23.67, 'black')):
        kit.boxc(A, col, 'trunk', P(.007, (y0 + y1) / 2, 16.25), (.76, .76, y1 - y0), paint)
    # Pole: one plain spar 0.36 m across, upright, from the crosstree platform to the truck (plan cuts y = 31.5 to
    # 45.3 all find it at reference z 17.565-17.885), with a wind vane on the truck. The reference paints the whole
    # mast black above 22.65 m.
    POLE_Z, POLE_R = 17.725, .18
    rod(kit, A, col, 'pole', (0, 30.9, POLE_Z), (0, 45.35, POLE_Z), POLE_R, 'black', 14, .17)
    kit.cylz(A, col, 'truck', P(0, 45.33, POLE_Z), .21, .14, 'black', 12)
    rod(kit, A, col, 'wind vane spindle', (0, 45.45, POLE_Z), (0, 46.0, POLE_Z), .03, 'black', 6)
    rod(kit, A, col, 'wind vane arm', (-.28, 45.95, POLE_Z), (.28, 45.95, POLE_Z), .02, 'black', 6)
    for s in (-1, 1):
        kit.cylz(A, col, 'wind vane cup', P(s * .28, 45.88, POLE_Z), .06, .14, 'black', 8)
    # Tripod legs: box struts from the after control deck up to the 28.75 m platform under the crosstree, splayed to
    # each side and raked forward, black from the mast's paint line (the line through their plan-cut centres at
    # y = 20.5 to 28.6; the cuts above the platform find only the trunk).
    for s in (-1, 1):
        foot, head = (s * 2.6, 16.85, 19.79), (s * .88, 28.77, 17.06)
        t = (22.65 - foot[1]) / (head[1] - foot[1])
        joint = tuple(a + (b - a) * t for a, b in zip(foot, head))
        kit.beam(A, col, 'tripod leg', P(*foot), P(*joint), .75, .8, 'naval')
        kit.beam(A, col, 'tripod leg head', P(*joint), P(*head), .75, .8, 'black')
    # The top yard across the after face of the pole at 39.7 m, 10.5 m long and tapering from 0.33 m at the pole to
    # 0.2 m at the arms (profile cuts x = 1 to 5 m and the front silhouette); a brace from each side of the pole below
    # it up to the yard, and a lift from the pole above it down to each arm.
    YARD_Y, YARD_Z = 39.685, 18.045
    for s in (-1, 1):
        rod(kit, A, col, 'top yard', (0, YARD_Y, YARD_Z), (s * 5.25, YARD_Y, YARD_Z), .165, 'black', 10, .1)
        rod(kit, A, col, 'top yard brace', (s * .12, 38.86, 17.76), (s * 2.2, YARD_Y, YARD_Z), .055, 'black', 6)
        kit.member(A, col, P(s * .1, 41.1, POLE_Z), P(s * 3.0, YARD_Y + .12, YARD_Z), .02, 'black', 4)
    # Two gaffs aft (x = 0 profile cut and the side renders): the masthead gaff from the pole at 38.95 m to its peak
    # 2.3 m aft, where the ensign flies at sea (HP_flag_nation, the blueprint's rig), with its peak stay from 41.8 m;
    # and the lower gaff along the crosstree's after arm at 28.8 m, 3 m abaft the trunk, with its peak halyard.
    rod(kit, A, col, 'masthead gaff', (0, 38.95, POLE_Z + .12), (0, 39.55, 20.45), .08, 'black', 8, .05)
    kit.member(A, col, P(0, 41.76, POLE_Z + .1), P(0, 39.6, 20.43), .025, 'black', 4)
    rod(kit, A, col, 'lower gaff', (0, 28.8, 18.95), (0, 28.95, 22.0), .09, 'black', 8, .06)
    kit.member(A, col, P(0, 28.99, 21.95), P(0, 31.1, 19.0), .025, 'black', 4)
    # Three signal blocks forward of the trunk (reference z 14.4 to 15.1), each on a short arm from an eye on the
    # trunk's forward face.
    for y0 in (25.0, 26.4, 27.4):
        block = Vector(P(0, y0, 14.7))
        kit.part('rod', A, col, 'signal block', tuple(block + Vector((0, -.17, 0))), tuple(block + Vector((0, .17, 0))), .35, 'black', vertices=6)
        face = kit.toward(tuple(block + Vector((-.35, 0, 0))), (-1, 0, 0), 2.5, P(0, y0, 15.9))
        kit.member(A, col, tuple(block + Vector((-.3, 0, 0))), tuple(face + Vector((-.08, 0, 0))), .05, 'black', 6)
        kit.boxc(A, col, 'signal block eye', tuple(face + Vector((.03, 0, 0))), (.12, .3, .3), 'black')
    # Aircraft crane jib from its heel at the mast foot, forward and up (x = 0 profile), with sheaves and a hook.
    C = 'aircraft-crane'
    heel, head = (0, 11.5, 15.45), (0, 28.6, 8.72)
    kit.cylz(C, col, 'heel pedestal', P(0, 10.95, 15.6), .55, .6, 'naval', 16)
    kit.beam(C, col, 'jib', P(*heel), P(*head), .55, .6, 'naval')
    for dy, dz in [(.2, -.45), (-.6, .15)]:
        kit.part('rod', C, col, 'sheave', P(-.35, head[1] + dy, head[2] + dz), P(.35, head[1] + dy, head[2] + dz), .32, 'black', vertices=6)
    kit.member(C, col, P(0, 28.3, 8.9), P(0, 21.35, 8.9), .03, 'black', 4)
    kit.boxc(C, col, 'hook block', P(0, 21.2, 8.9), (.3, .22, .45), 'black')
    kit.member(C, col, P(0, 28.6, 8.8), P(0, 44.0, POLE_Z - POLE_R + .02), .025, 'edge', 3)


# ------------------------------------------------------------------ funnel
def funnel(kit, D):
    col = kit.collections['Superstructure']
    A = 'funnel-cap'
    top = max(s['baseY'] + s['height'] for s in D['structures'] if s['id'].startswith('funnel-'))
    s = next(s for s in D['structures'] if s.get('exhaust'))
    pts = [(-z, -x) for x, z in s['footprint']]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    # The black band down from the mouth (the reference paints about 1.35 m), a rolled rim and a domed grating.
    band = [(cx + (px - cx) * 1.012, cy + (py - cy) * 1.012) for px, py in pts]
    kit.prism(A, col, 'black band', band, top - 1.35, top - .02, 'black')
    ring = [(cx + (px - cx) * 1.03, cy + (py - cy) * 1.03) for px, py in pts]
    kit.prism(A, col, 'rim', ring, top - .14, top + .06, 'black')
    hx = max(abs(p[0] - cx) for p in pts)
    hy = max(abs(p[1] - cy) for p in pts)
    for k in range(-3, 4):
        u = k / 3.5
        pts_ = []
        for i in range(9):
            v = -1 + 2 * i / 8
            dome = .45 * (1 - v * v) * (1 - .4 * u * u)
            pts_.append((cx + u * hx * .96, cy + v * hy * .96 * math.sqrt(max(.05, 1 - (u * .96) ** 2)), top + .05 + dome))
        kit.polyline(A, col, pts_, .035, 'black', 5)
    for k in range(-3, 4):
        v = k / 3.5
        pts_ = []
        for i in range(9):
            u = -1 + 2 * i / 8
            dome = .45 * (1 - u * u) * (1 - .4 * v * v)
            pts_.append((cx + u * hx * .96 * math.sqrt(max(.05, 1 - (v * .96) ** 2)), cy + v * hy * .96, top + .05 + dome))
        kit.polyline(A, col, pts_, .035, 'black', 5)
    # Steam pipes up the after face; a ladder up the port side to the rim.
    for dy in (-.8, 0, .8):
        kit.part('rod', A, col, 'steam pipe', (cx - hx - .12, cy + dy, 14.9), (cx - hx - .12, cy + dy, top + .9), .09 if dy else .13, 'naval', vertices=10)
    kit.ladder(A, col, (cx + hx * .4, cy + hy + .14, 15.2), (cx + hx * .4, cy + hy + .14, top), (1, 0, 0), .42)
    # Sirens on the rim (plan cuts y = 24.7 and 25.0): a pair on each quarter of the after rim and one on the forward
    # rim to starboard of the centre line, each pair of whistles joined by a bar.
    for a, b in [((2.56, .455), (2.26, 1.015)), ((-2.56, .455), (-2.26, 1.015)), ((.86, -5.125), (1.52, -5.125))]:
        for x0, z0 in (a, b):
            foot = Vector(P(x0, top + .02, z0))
            kit.part('rod', A, col, 'siren', tuple(foot), tuple(foot + Vector((0, 0, .9))), .1, 'black', vertices=8)
            kit.cylz(A, col, 'siren bell', tuple(foot + Vector((0, 0, .9))), .14, .16, 'black', 10)
        kit.part('rod', A, col, 'siren bar', P(a[0], top + .75, a[1]), P(b[0], top + .75, b[1]), .06, 'black', vertices=6)
    funnel_lattice(kit)


# The funnel's lattice (plan cuts y = 9.6 to 17.0 every 0.2-0.5 m, reference frame; mirrored to port). Two rows of
# posts round the funnel's forward half from the 11.85 m casing roof up to the platforms at 15.15-15.45 m, X-braced
# with a raised V in the middle bay (the reference's side view); abaft them a leaning post from the 01 deck to the
# 14.75 m platform, braced to the frame and to the after legs, and the two legs of the after 25 mm platform (16.75 m),
# one upright and one leaning in. Rows: (z, x, width across, depth fore and aft, x lean per metre from 12 m).
LATTICE_OUTER = [(-8.73, 4.91, .30, .28, -.042), (-6.94, 4.43, .12, .29, 0), (-4.00, 4.61, .11, .30, 0), (-2.05, 4.70, .30, .33, 0)]
LATTICE_INNER = [(-8.73, 3.70, .42, .28, 0), (-6.67, 2.62, .12, .29, 0), (-3.91, 2.87, .11, .30, 0), (-1.87, 3.20, .33, .30, 0)]
LATTICE_BAYS = ['X', 'V', 'X']          # from forward: between posts 1-2, 2-3 and 3-4 of each row
LATTICE_LEAN = (.81, 4.64, .37, .32, .24)      # leaning post abaft the frame (z, x at 12 m, width, depth, lean)
LATTICE_LEGS = [(3.25, 3.39, .27, .24, 0), (3.54, 2.31, .40, .30, -.238)]


def funnel_lattice(kit):
    col = kit.collections['Superstructure']
    A = 'funnel-lattice'

    def at(post, y):
        z, x, w, d, lean = post
        return x + lean * (y - 12.0), z

    def pt(side, post, y):
        x, z = at(post, y)
        return Vector(P(side * x, y, z))

    for side in (-1, 1):
        ends = {}
        # Every post runs from the surface under it to the platform over it.
        for post in LATTICE_OUTER + LATTICE_INNER + [LATTICE_LEAN] + LATTICE_LEGS:
            frame = post in LATTICE_OUTER + LATTICE_INNER
            ax, ay, _ = pt(side, post, 12.0 if frame else 10.0)
            foot = kit.below(ax, ay, 12.2 if frame else 11.2)
            start = 16.0 if post in LATTICE_LEGS else 14.2
            ax, ay, _ = pt(side, post, start + .5)
            head = kit.above(ax, ay, start, 2.5, 15.15 if start < 16 else 16.75)
            a, b = pt(side, post, foot - .03), pt(side, post, head + .03)
            kit.beam(A, col, 'post', tuple(a), tuple(b), post[2], post[3], 'naval', (1, 0, 0))
            ends[post] = (foot, head)
        # The frame's two rows: top and bottom beams and the bay bracing.
        for row in (LATTICE_OUTER, LATTICE_INNER):
            lo = max(ends[p][0] for p in row) + .12
            hi = min(ends[p][1] for p in row) - .12
            for p, q, bay in zip(row, row[1:], LATTICE_BAYS):
                for y in (lo, hi):
                    kit.beam(A, col, 'beam', tuple(pt(side, p, y)), tuple(pt(side, q, y)), .12, .22, 'naval')
                if bay == 'X':
                    kit.member(A, col, tuple(pt(side, p, lo)), tuple(pt(side, q, hi)), .045, 'naval', 6)
                    kit.member(A, col, tuple(pt(side, p, hi)), tuple(pt(side, q, lo)), .045, 'naval', 6)
                else:
                    mid = (pt(side, p, hi) + pt(side, q, hi)) / 2
                    kit.member(A, col, tuple(pt(side, p, lo)), tuple(mid), .045, 'naval', 6)
                    kit.member(A, col, tuple(pt(side, q, lo)), tuple(mid), .045, 'naval', 6)
            # Ties across the frame between the rows at the forward end.
            for y in (lo, hi):
                kit.beam(A, col, 'tie', tuple(pt(side, LATTICE_OUTER[0], y)), tuple(pt(side, LATTICE_INNER[0], y)), .12, .22, 'naval')
        # Abaft the frame: the leaning post braced to the frame's after post and to the upright after leg.
        lo, hi = 11.97, 14.6
        for p, q in ((LATTICE_OUTER[-1], LATTICE_LEAN), (LATTICE_LEAN, LATTICE_LEGS[0])):
            for y in (lo, hi):
                kit.beam(A, col, 'beam', tuple(pt(side, p, y)), tuple(pt(side, q, y)), .12, .22, 'naval')
            kit.member(A, col, tuple(pt(side, p, lo)), tuple(pt(side, q, hi)), .045, 'naval', 6)
            kit.member(A, col, tuple(pt(side, p, hi)), tuple(pt(side, q, lo)), .045, 'naval', 6)
        # The after legs tied together.
        for y in (lo, hi):
            kit.beam(A, col, 'tie', tuple(pt(side, LATTICE_LEGS[0], y)), tuple(pt(side, LATTICE_LEGS[1], y)), .12, .2, 'naval')

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
    # Pole: from the crosstree platform to the truck (HP_Flagpole 44.4 m), raked slightly aft; black above 33 m.
    rod(kit, A, col, 'pole', (0, 30.9, 17.72), (0, 33.2, 17.75), .34, 'naval', 14, .32)
    rod(kit, A, col, 'topmast', (0, 33.2, 17.75), (0, 45.2, 18.14), .30, 'black', 12, .12)
    kit.cylz(A, col, 'truck', P(0, 45.2, 18.14), .16, .1, 'black', 10)
    # Tripod legs: box struts from the after control deck up to the crosstree, splayed to each side, black from
    # 27.6 m as the reference paints them.
    for s in (-1, 1):
        foot, head = (s * 2.35, 16.85, 19.55), (s * .55, 30.95, 17.2)
        t = (27.6 - foot[1]) / (head[1] - foot[1])
        joint = tuple(a + (b - a) * t for a, b in zip(foot, head))
        kit.beam(A, col, 'tripod leg', P(*foot), P(*joint), .75, .8, 'naval')
        kit.beam(A, col, 'tripod leg head', P(*joint), P(*head), .75, .8, 'black')
    # Crosstree platform rails and the top yard with its braces.
    for y0, half in [(39.5, 2.6)]:
        rod(kit, A, col, 'top yard', (-half, y0, 18.02), (half, y0, 18.02), .07, 'black', 8)
        for s in (-1, 1):
            rod(kit, A, col, 'top yard brace', (s * half * .7, y0, 18.02), (0, y0 + 1.3, 18.05), .03, 'black', 6)
    # Gaff from the crosstree forward and up, stayed to the topmast.
    rod(kit, A, col, 'gaff', (0, 31.35, 16.6), (0, 33.1, 8.8), .1, 'black', 8, .06)
    kit.member(A, col, P(0, 33.1, 8.8), P(0, 44.0, 18.1), .02, 'edge', 3)
    # Signal blocks hung from the after side of the pole.
    for y0 in (26.0, 27.1, 28.2):
        kit.part('rod', A, col, 'signal block', P(1.1, y0, 18.6), P(1.1, y0, 18.95), .32, 'black', vertices=6)
        kit.member(A, col, P(0, y0 + .4, 18.0), P(1.1, y0, 18.75), .03, 'naval', 4)
    # Aircraft crane jib from its heel at the mast foot, forward and up (x = 0 profile), with sheaves and a hook.
    C = 'aircraft-crane'
    heel, head = (0, 11.5, 15.45), (0, 28.6, 8.72)
    kit.cylz(C, col, 'heel pedestal', P(0, 10.95, 15.6), .55, .6, 'naval', 16)
    kit.beam(C, col, 'jib', P(*heel), P(*head), .55, .6, 'naval')
    for dy, dz in [(.2, -.45), (-.6, .15)]:
        kit.part('rod', C, col, 'sheave', P(-.35, head[1] + dy, head[2] + dz), P(.35, head[1] + dy, head[2] + dz), .32, 'black', vertices=6)
    kit.member(C, col, P(0, 28.3, 8.9), P(0, 21.35, 8.9), .03, 'black', 4)
    kit.boxc(C, col, 'hook block', P(0, 21.2, 8.9), (.3, .22, .45), 'black')
    kit.member(C, col, P(0, 28.6, 8.8), P(0, 44.0, 18.1), .025, 'edge', 3)


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
    # Steam pipes up the after face and a siren platform; a ladder up the port side to the rim.
    for dy in (-.8, 0, .8):
        kit.part('rod', A, col, 'steam pipe', (cx - hx - .12, cy + dy, 14.9), (cx - hx - .12, cy + dy, top + .9), .09 if dy else .13, 'naval', vertices=10)
    kit.ladder(A, col, (cx + hx * .4, cy + hy + .14, 15.2), (cx + hx * .4, cy + hy + .14, top), (1, 0, 0), .42)

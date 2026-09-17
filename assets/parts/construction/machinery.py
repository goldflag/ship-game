"""Original modular machinery; illustrative packages, not historical replicas.

Forward/port/up metres. Every package includes its foundation and auxiliaries;
the installed ship owns the supporting floor, shaft route and funnel uptake.
"""
import math
from geometry import Model


def foundation(m, w, h, l):
    t = min(.3, h * .08)
    m.box('foundation', (0, 0, t / 2), (l, w, t), mat='edge')
    for x in [-l * .45, l * .45]:
        for y in [-w * .43, w * .43]:
            m.cyl('foundation-bolt', (x, y, t + .025), .035, .05, mat='edge', vertices=6)
    return t


def wheel(m, x, y, z, radius):
    m.path('valve-wheel', [(x, y + radius * math.cos(i * math.tau / 20),
                           z + radius * math.sin(i * math.tau / 20)) for i in range(20)],
           .018, mat='edge', closed=True)
    for a in [0, math.pi / 2]:
        m.rod('wheel-spoke', (x, y - radius * math.cos(a), z - radius * math.sin(a)),
              (x, y + radius * math.cos(a), z + radius * math.sin(a)), .015, mat='edge')


def create_diesel(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    w, h, l = part['size']
    t = foundation(m, w, h, l)
    lanes = [0] if part['powerKw'] < 1000 else [-w * .24, w * .24]
    ew = w * (.65 if len(lanes) == 1 else .36)
    for y in lanes:
        m.box('engine-bed', (0, y, t + h * .07), (l * .78, ew, h * .14), mat='edge')
        m.box('crankcase', (0, y, h * .39), (l * .74, ew * .88, h * .40))
        for i in range(6):
            x = l * (-.30 + i * .12)
            m.box('cylinder-head', (x, y, h * .66), (l * .09, ew * .78, h * .17), mat='roof')
            m.rod('injector', (x, y, h * .73), (x, y, h * .79), .025, mat='edge')
            m.path('fuel-line', [(x, y, h * .79), (x, y + ew * .43, h * .79),
                                (x, y + ew * .43, h * .40)], .018, mat='edge')
            m.rod('access-cover', (x, y - ew * .45, h * .39),
                  (x, y - ew * .46, h * .39), ew * .14, mat='roof', vertices=16)
        m.rod('exhaust-manifold', (-l * .34, y - ew * .28, h * .80),
              (l * .34, y - ew * .28, h * .80), h * .055, mat='edge')
        for x in [-l * .30, 0, l * .30]:
            m.rod('exhaust-branch', (x, y, h * .66), (x, y - ew * .28, h * .80), h * .035, mat='edge')
        m.rod('output-shaft', (-l * .47, y, h * .32), (-l * .37, y, h * .32), h * .06, mat='edge')
        m.rod('flywheel', (-l * .40, y, h * .32), (-l * .37, y, h * .32), h * .20, mat='edge', vertices=32)
    # A seated auxiliary generator occupies the forward end of the shared bed.
    m.box('generator-seat', (l * .43, 0, t + h * .06), (l * .10, w * .5, h * .12), mat='edge')
    m.rod('auxiliary-generator', (l * .43, -w * .23, t + h * .21),
          (l * .43, w * .23, t + h * .21), h * .12, vertices=24)
    m.box('combining-gear', (-l * .45, 0, h * .32), (l * .07, w * .65, h * .25), mat='roof')
    m.rod('drive-coupling', (-l * .50, 0, h * .32), (-l * .45, 0, h * .32), h * .06, mat='edge')
    for y in lanes:
        m.path('exhaust-collector', [(0, y - ew * .28, h * .80), (0, y - ew * .28, h * .93),
                                    (0, 0, h * .93), (0, 0, h)], h * .035, mat='edge')
    return m.root


def create_reciprocating(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    w, h, l = part['size']
    t = foundation(m, w, h, l)
    # Two horizontal fire-tube boiler shells, visibly seated on saddles.
    for y in [-w * .24, w * .24]:
        r = w * .19
        z = t + r + h * .05
        for x in [l * .08, l * .35]:
            m.box('boiler-saddle', (x, y, t + h * .07), (l * .07, r * 1.65, h * .14), mat='edge')
        m.rod('boiler-shell', (l * .01, y, z), (l * .44, y, z), r, vertices=40)
        for x in [l * .015, l * .42]:
            m.rod('boiler-band', (x, y, z), (x + l * .015, y, z), r * 1.035, mat='edge', vertices=40)
        for dy in [-r * .4, r * .4]:
            m.rod('furnace-door', (l * .44, y + dy, z - r * .25),
                  (l * .455, y + dy, z - r * .25), r * .29, mat='dark', vertices=24)
        m.path('steam-main', [(l * .2, y, z + r * .8), (l * .2, y, h * .91),
                              (-l * .16, y, h * .91), (-l * .16, 0, h * .91),
                              (-l * .16, 0, h * .77)], .07, mat='edge')
    m.box('engine-bed', (-l * .28, 0, t + h * .05), (l * .43, w * .50, h * .10), mat='edge')
    m.rod('crankshaft', (-l * .48, 0, h * .23), (-l * .08, 0, h * .23), .09, mat='edge')
    for i, radius in enumerate([w * .085, w * .11, w * .14]):
        x = -l * (.13 + i * .145)
        for side in [-1, 1]:
            m.rod('engine-column', (x, side * w * .20, t + h * .1),
                  (x, side * w * .20, h * .68), .075, mat='edge')
        m.box('cylinder-support', (x, 0, h * .65), (l * .12, w * .46, h * .06), mat='roof')
        m.cyl('expansion-cylinder', (x, 0, h * .76), radius, h * .20, vertices=32)
        m.cyl('cylinder-cover', (x, 0, h * .87), radius * 1.05, h * .025, mat='edge', vertices=32)
        m.rod('piston-rod', (x, 0, h * .29), (x, 0, h * .66), .055, mat='bright')
        m.box('crosshead', (x, 0, h * .40), (.18, .28, .20), mat='edge')
        m.rod('bearing-pedestal', (x, 0, t), (x, 0, h * .23), .15, mat='edge')
    m.rod('flywheel', (-l * .485, 0, h * .27), (-l * .46, 0, h * .27), h * .18, mat='edge', vertices=40)
    m.rod('drive-coupling', (-l * .50, 0, h * .27), (-l * .46, 0, h * .27), .09, mat='edge')
    m.box('uptake-collector', (0, 0, h * .60), (l * .04, w * .65, h * .10), mat='edge')
    for y in [-w * .30, w * .30]:
        m.rod('uptake-support', (0, y, t), (0, y, h * .55), .055, mat='edge')
    m.rod('uptake', (0, 0, h * .60), (0, 0, h), .16, mat='edge')
    m.rod('valve-stem', (-l * .13, -w * .12, h * .75), (-l * .13, -w * .31, h * .75), .025, mat='edge')
    # Wheel plane is Y/Z; an attached bracket brings its axle to that plane.
    m.rod('valve-bracket', (-l * .13, -w * .31, h * .75), (-l * .10, -w * .31, h * .75), .025, mat='edge')
    wheel(m, -l * .10, -w * .31, h * .75, .17)
    return m.root


def create_turbine(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    w, h, l = part['size']
    t = foundation(m, w, h, l)
    count = 1 if part['powerKw'] == 5000 else 2 if part['powerKw'] == 22000 else 4
    # Larger units add actual boiler casings, rather than stretching one casing.
    xs = [l * .22] if count < 4 else [l * .10, l * .34]
    ys = [0] if count == 1 else [-w * .23, w * .23]
    bw = w * (.56 if count == 1 else .36)
    bl = l * (.40 if count < 4 else .20)
    for x in xs:
        for y in ys:
            m.box('boiler-seat', (x, y, t + h * .035), (bl, bw, h * .07), mat='edge')
            m.box('boiler-casing', (x, y, t + h * .30), (bl * .94, bw * .92, h * .50))
            m.rod('steam-drum', (x - bl * .42, y, t + h * .60),
                  (x + bl * .42, y, t + h * .60), h * .09, mat='roof', vertices=32)
            for dy in [-bw * .20, bw * .20]:
                m.rod('burner-cover', (x + bl * .47, y + dy, t + h * .21),
                      (x + bl * .49, y + dy, t + h * .21), bw * .15, mat='dark', vertices=20)
            m.path('steam-main', [(x, y, t + h * .60), (x, y, h * .89),
                                  (-l * .17, y, h * .89), (-l * .17, y, h * .45)], .065, mat='edge')
    # One geared set: HP and LP casings on a condenser bed, one output shaft.
    m.box('condenser', (-l * .24, 0, t + h * .09), (l * .32, w * .66, h * .18), mat='edge')
    for y, r in [(-w * .18, h * .13), (w * .17, h * .19)]:
        m.box('turbine-seat', (-l * .24, y, t + h * .20), (l * .28, r * 1.6, h * .12), mat='edge')
        z = t + h * .24 + r
        m.rod('turbine-casing', (-l * .36, y, z), (-l * .12, y, z), r, vertices=40)
        for x in [-l * .34, -l * .24, -l * .14]:
            m.rod('casing-flange', (x, y, z), (x + .045, y, z), r * 1.07, mat='edge', vertices=32)
        m.path('inlet-branch', [(-l * .17, 0, h * .89), (-l * .17, y, h * .89),
                               (-l * .17, y, z)], .065, mat='edge')
    m.box('gear-seat', (-l * .425, 0, t + h * .06), (l * .11, w * .65, h * .12), mat='edge')
    m.box('reduction-gear', (-l * .425, 0, t + h * .28), (l * .11, w * .60, h * .40), mat='roof')
    m.rod('output-shaft', (-l * .50, 0, h * .32), (-l * .475, 0, h * .32), .13, mat='edge', vertices=24)
    m.box('uptake-collector', (l * .04, 0, t + h * .52), (l * .08, w * .70, h * .10), mat='edge')
    m.rod('uptake', (0, 0, t + h * .52), (0, 0, h), .16, mat='edge')
    return m.root

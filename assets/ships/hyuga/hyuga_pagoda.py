"""Hyūga pagoda foremast region: reference z -48 to -18.5 above the forecastle deck.

The measured prisms give the tiers; this module adds what the reference carries on them: the Type 94
main director and the 10 m rangefinder on its tower (each training), the Type 91 high-angle directors,
the Type 95 and machine-gun directors, the 4.5 m and 1.5 m rangefinders, the signal yard, the tower's
after legs, stanchions under the platforms that stand on them, rails round exposed roofs and knees
under overhangs, and the bridge glazing and portholes read off the reference's painted textures
(hyuga_windows.py). Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from hyuga_kit import P, ZC
from hyuga_windows import WINDOWS

CLAIMED_STRUCTURES = set()


def zone(x, y, z):
    """Runtime point inside the pagoda region."""
    return -48 < z + ZC < -18.5 and y > 6.9


def octagon(cx, cz, hx, hz, chamfer):
    """Reference-frame plan outline (x, z) of an elongated octagon."""
    c = chamfer
    pts = [(hx - c, cz - hz), (hx, cz - hz + c), (hx, cz + hz - c), (hx - c, cz + hz),
           (-hx + c, cz + hz), (-hx, cz + hz - c), (-hx, cz - hz + c), (-hx + c, cz - hz)]
    return [(cx + x, z) for x, z in pts]


def plan(pts):
    """Reference plan points -> authoring plan points (X bow, Y port)."""
    return [(-(z - ZC), -x) for x, z in pts]


def build(D, kit):
    masts = kit.cols['Sensors and masts']
    sup = kit.cols['Superstructure']
    structures = [s for s in D['structures'] if not s['id'].startswith('funnel-')]
    main_director(kit, masts)
    ha_directors(kit, masts)
    small_directors(kit, masts)
    rangefinders(kit, masts)
    yard(kit, masts)
    legs(kit, sup)
    for s in D['structures']:
        if s['id'] in ('pagoda-009', 'pagoda-010', 'pagoda-016', 'pagoda-017'):
            kit.stilts(s['id'] + '-legs', sup, s, .09)
    kit.windows('pagoda-windows', sup, WINDOWS['pagoda'])
    kit.roof_rails('pagoda-rails', sup, structures, lambda x, y, z: zone(x, y, z) and y < 34.0)
    kit.overhang_knees('pagoda-knees', sup, structures, zone)


def main_director(kit, col):
    """Type 94 director on the tower top (reference JD_3) and the 10 m rangefinder behind it (JF_5)."""
    A = 'main-director'
    cx, cz, base = 0.0, -31.95, 35.41
    x, y, z = P(cx, base, cz)
    floor = kit.try_below(x, y, base + .05, base)
    moving = [kit.cylz(A, col, 'training ring', (x, y, floor), 1.25, base - floor + .14, 'edge', 32)]
    moving.append(kit.prism(A, col, 'housing', plan(octagon(cx, cz, 1.55, 1.5, .45)), base + .12, 37.0, 'naval', 'roof'))
    moving.append(kit.prism(A, col, 'hood', plan(octagon(cx, cz - .2, 1.2, 1.0, .35)), 37.0, 37.45, 'naval', 'roof'))
    for dx in (-.8, 0, .8):
        gx, gy, gz = P(dx, 36.4, cz - 1.5)
        moving.append(kit.part('box', A, col, 'sight port', (gx + .01, gy, gz), (.03, .45, .36), 'glass'))
    for s in (-1, 1):
        gx, gy, gz = P(s * 1.55, 36.3, cz)
        moving.append(kit.part('box', A, col, 'side port', (gx, gy, gz), (.5, .03, .4), 'glass'))
    radar_pivot('main-director.yaw', (x, y, floor), moving)
    B = 'main-rangefinder'
    rx, rz, rbase = 0.0, -28.06, 37.12
    x, y, z = P(rx, rbase, rz)
    floor = kit.try_below(x, y, rbase + .05, rbase)
    moving = [kit.cylz(B, col, 'pedestal', (x, y, floor), .75, rbase - floor + .45, 'naval', 24)]
    moving.append(kit.prism(B, col, 'cabin', plan(octagon(rx, rz, 1.3, 1.0, .3)), rbase + .45, rbase + 1.55, 'naval', 'roof'))
    moving.append(kit.part('rod', B, col, 'rangefinder', P(-4.6, rbase + 1.0, rz), P(4.6, rbase + 1.0, rz), .3, 'naval', vertices=16))
    for s in (-1, 1):
        hx, hy, hz = P(s * 4.85, rbase + 1.0, rz)
        moving.append(kit.part('box', B, col, 'hood', (hx, hy, hz), (1.0, .8, 1.0), 'naval'))
        moving.append(kit.part('rod', B, col, 'objective', (hx + .5, hy, hz), (hx + .54, hy, hz), .22, 'glass', vertices=14))
    radar_pivot('main-rangefinder.yaw', (x, y, floor), moving)


def ha_directors(kit, col):
    """Type 91 high-angle directors on the pagoda wings (reference JD_6/JD_7)."""
    for side, rx in (('port', -7.308), ('starboard', 7.308)):
        A = f'ha-director-{side}'
        s = 1 if rx > 0 else -1
        x, y, z = P(rx, 17.72, -26.5)
        floor = kit.try_below(x, y, 17.9, 17.72)
        kit.cylz(A, col, 'pedestal', (x, y, floor), .8, 17.95 - floor, 'naval', 24)
        kit.prism(A, col, 'housing', plan(octagon(rx, -26.5, 1.1, 1.15, .35)), 17.95, 19.15, 'naval', 'roof')
        kit.part('rod', A, col, 'rangefinder', P(rx - s * .9, 18.9, -26.1), P(rx + s * 1.3, 18.9, -26.1), .13, 'naval', vertices=12)
        kit.part('box', A, col, 'rangefinder hood', P(rx + s * 1.3, 18.9, -26.1), (.4, .38, .42), 'naval')
        for dz in (-27.3, -26.7):
            gx, gy, gz = P(rx, 18.65, dz)
            kit.part('box', A, col, 'window', (gx, gy - s * 1.1, gz), (.4, .03, .3), 'glass')


def small_directors(kit, col):
    """Type 95 25 mm directors (JD_1/2) and machine-gun control positions (JD_4/5, JD_8/9)."""
    for A, (rx, base, rz), size in [('aa-director-port', (-2.427, 31.98, -32.055), (1.3, 1.1)), ('aa-director-starboard', (2.427, 31.98, -32.055), (1.3, 1.1)),
                                    ('mg-control-port-fwd', (-2.598, 34.5, -29.016), (.9, 1.0)), ('mg-control-starboard-fwd', (2.598, 34.5, -29.016), (.9, 1.0)),
                                    ('mg-control-port-aft', (-3.591, 19.07, 4.544), (.9, 1.0)), ('mg-control-starboard-aft', (3.591, 19.07, 4.544), (.9, 1.0))]:
        x, y, z = P(rx, base, rz)
        floor = kit.try_below(x, y, base + .1, base)
        w, h = size
        kit.cylz(A, col, 'pedestal', (x, y, floor), .16, base + .45 - floor, 'naval', 12)
        kit.part('box', A, col, 'sight body', (x, y, base + .45 + h * .3), (w, w * .8, h * .6), 'naval')
        kit.part('rod', A, col, 'sight', (x + w * .5, y, base + .45 + h * .45), (x + w * .5 + .12, y, base + .45 + h * .45), .1, 'glass', vertices=10)
        kit.part('box', A, col, 'shield', (x - w * .45, y, base + .45 + h * .35), (.05, w, h * .7), 'naval')


def rangefinder(kit, A, col, rx, base, rz, length, along_ship):
    x, y, z = P(rx, base, rz)
    floor = kit.try_below(x, y, base + .1, base)
    kit.cylz(A, col, 'pedestal', (x, y, floor), .2, base + .55 - floor, 'naval', 14)
    c = Vector((x, y, base + .85))
    d = Vector((1, 0, 0)) if along_ship else Vector((0, 1, 0))
    kit.part('rod', A, col, 'tube', tuple(c - d * length / 2), tuple(c + d * length / 2), .16, 'naval', vertices=14)
    for t in (-1, 1):
        kit.part('box', A, col, 'end hood', tuple(c + d * t * length / 2), (.42, .42, .48), 'naval')
    back = Vector((0, 1, 0)) if along_ship else Vector((-1, 0, 0))
    kit.part('box', A, col, 'operator shield', tuple(c + back * .4 * (1 if rx < 0 else -1) + Vector((0, 0, -.1))), (.8, .8, .85), 'naval')


def rangefinders(kit, col):
    rangefinder(kit, 'rf-front-port', col, -1.81, 17.82, -41.34, 4.5, False)
    rangefinder(kit, 'rf-front-starboard', col, 1.81, 17.23, -41.34, 4.5, False)
    rangefinder(kit, 'rf-pagoda-port', col, -2.911, 22.67, -31.31, 1.5, False)
    rangefinder(kit, 'rf-pagoda-starboard', col, 2.911, 22.67, -31.31, 1.5, False)
    rangefinder(kit, 'rf-wing-port', col, -6.103, 21.85, -26.5, 4.5, True)
    rangefinder(kit, 'rf-wing-starboard', col, 6.103, 21.85, -26.5, 4.5, True)


def yard(kit, col):
    """Signal yard across the tower's back at 31.2 m, with its halyards to the wing platforms."""
    A = 'signal-yard'
    y0 = 31.2
    root = Vector(P(0, y0, -22.4))
    hit = kit.try_along(tuple(root + Vector((-1.5, 0, 0))), (1, 0, 0), 5.0)
    rx = hit.x + .05 if hit else root.x
    kit.member(A, col, (rx, -9.9, y0), (rx, 9.9, y0), .08, 'naval', 8)
    for s in (-1, 1):
        kit.member(A, col, (rx, s * 4.6, y0), (rx + .6, s * .8, y0 - 1.6), .05, 'naval', 6)
        for yy in (7.4, 9.9):
            kit.wire(A, col, (rx, s * yy, y0), (rx - 1.0, s * 7.0, 19.2), .01, False)


def legs(kit, col):
    """The tower's after legs: two raked struts from the shelter deck up to the director platform."""
    A = 'pagoda-legs'
    for s in (-1, 1):
        a = Vector(P(s * 2.2, 10.1, -20.4))
        b = Vector(P(s * 1.2, 30.0, -25.6))
        foot = kit.try_below(a.x, a.y, 10.3, 10.1)
        a.z = foot
        top = kit.try_along(tuple(b + Vector((0, 0, -.5))), (0, 0, 1), 3.0)
        if top:
            b.z = top.z + .05
        kit.part('rod', A, col, 'leg', tuple(a), tuple(b), .32, 'naval', vertices=16, r2=.26)
        kit.cylz(A, col, 'leg shoe', (a.x, a.y, a.z), .5, .3, 'naval', 16)

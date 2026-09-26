"""Ise fittings: directors, rangefinders and radars; masts, yards and cranes; searchlights; boats;
catapults; the AA rocket launchers; ground tackle and deck gear; screws, shafts and rudders; rails.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the approved
GameModels3D pjsb526 model's hardpoints and part bounds and converted once by `P`; shapes are original
approximations of the reference's fittings at their measured sizes. No reference geometry is loaded.
"""
import math
import bmesh
from mathutils import Vector
from ise_kit import P, ZS
from blender_rig import radar_pivot

CLAIMED_STRUCTURES = set()


def V(x, y, z):
    return Vector(P(x, y, z))


def heading(bearing):
    """Authoring-frame unit vector of a compass bearing (0 bow, 90 starboard)."""
    a = math.radians(bearing)
    return Vector((math.cos(a), -math.sin(a), 0))


def recalc(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def floor_under(kit, x, y, z, reach=3.0):
    """The authored surface under an authoring-frame point, or z itself when nothing lies within reach."""
    try:
        f = kit.support.below(x, y, z + .02)
    except ValueError:
        return z
    return f if z - f < reach else z


# ---------------------------------------------------------------- directors, rangefinders, radars
def hood(kit, aid, col, c, width, length, height, bearing=0.0, material='naval', front=.35):
    """A director or control hood: a box whose front is raked back `front` metres at the top, centred on c
    (authoring-frame base centre), facing `bearing`."""
    f = heading(bearing)
    s = Vector((-f.y, f.x, 0))
    x, y, z = c
    base = Vector((x, y, z))
    pts = []
    for h, rake in ((0, 0), (height, front)):
        for u, v in ((length / 2 - rake, width / 2), (length / 2 - rake, -width / 2), (-length / 2, -width / 2), (-length / 2, width / 2)):
            pts.append(tuple(base + f * u + s * v + Vector((0, 0, h))))
    ff = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return recalc(kit.tag(kit.mesh(aid + '.hood', pts, ff, material, col), aid))


def directors(D, kit):
    col = kit.cols['Sensors and masts']
    # Main battery rangefinder tower top: the 10 m rangefinder (HP_JF_3) with its end hoods and the Type 21
    # mattress above it, turning on its pivot; the Type 94 director hood (HP_JD_2) ahead of it.
    A = 'main-director'
    x, y, z = P(0, 37.58, -28.34)
    moving = [kit.cylz(A, col, 'rangefinder turntable', (x, y, 37.58), 1.55, .45, 'naval', 28)]
    moving.append(kit.part('box', A, col, 'rangefinder house', (x, y, 38.35), (2.6, 3.0, 1.1), 'naval'))
    for s in (-1, 1):
        moving.append(kit.part('rod', A, col, 'rangefinder arm', (x, y + s * 1.3, 38.25), (x, y + s * 5.05, 38.25), .3, 'naval', vertices=16))
        moving.append(kit.part('rod', A, col, 'rangefinder end hood', (x - .45, y + s * 5.1, 38.25), (x + .45, y + s * 5.1, 38.25), .42, 'naval', vertices=16))
        moving.append(kit.part('box', A, col, 'end hood window', (x + .47, y + s * 5.1, 38.3), (.04, .3, .18), 'glass'))
    # Type 21 mattress on its frame over the house.
    moving.append(kit.part('box', A, col, 'radar pedestal', (x, y, 39.15), (.5, .5, .5), 'naval'))
    moving.append(kit.part('box', A, col, 'radar frame', (x - .08, y, 40.45), (.12, 3.6, 2.1), 'edge'))
    for i in range(7):
        moving.append(kit.part('box', A, col, 'radar dipole row', (x - .16, y, 39.55 + i * .3), (.04, 3.4, .04), 'painted-edge'))
    for i in range(9):
        moving.append(kit.part('box', A, col, 'radar dipole column', (x - .16, y - 1.6 + i * .4, 40.45), (.04, .04, 2.0), 'painted-edge'))
    radar_pivot('main-director.yaw', (x, y, 37.58), moving)
    hood(kit, 'pagoda-director', col, P(0, 35.77, -32.09), 3.1, 3.0, 2.0, 0)
    for s in (-1, 1):
        kit.part('box', 'pagoda-director', col, 'hood window', V(0, 36.97, -33.37) + Vector((0, s * .75, 0)), (.05, 1.0, .35), 'glass')

    # After director (HP_JD_9) on the after tower, turning on its own pivot.
    A = 'after-director'
    x, y, z = P(0, 19.47, 44.85)
    moving = [kit.cylz(A, col, 'base ring', (x, y, 19.47), 1.3, .3, 'naval', 24)]
    moving.append(hood(kit, A, col, (x, y, 19.77), 3.0, 3.1, 1.75, 180))
    for s in (-1, 1):
        moving.append(kit.part('rod', A, col, 'rangefinder arm', (x, y + s * 1.4, 21.0), (x, y + s * 2.35, 21.0), .16, 'naval', vertices=12))
        moving.append(kit.part('box', A, col, 'hood window', (x + 1.52, y + s * .7, 20.95), (.03, .9, .3), 'glass'))
    radar_pivot('after-director.yaw', (x, y, 19.47), moving)

    # Type 94 high-angle directors abreast the pagoda (HP_JD_5, HP_JD_6), facing outboard.
    for s in (-1, 1):
        A = f'ha-director-{"port" if s < 0 else "starboard"}'
        c = P(s * 7.21, 17.7, -26.74)
        kit.cylz(A, col, 'pedestal', c, 1.0, .45, 'naval', 24)
        hood(kit, A, col, (c[0], c[1], c[2] + .45), 2.4, 3.2, 1.55, 90 * s, 'naval', .4)
        for u in (-1, 1):
            kit.part('rod', A, col, 'rangefinder', V(s * 7.21, 19.35, -26.74 + u * 1.0), V(s * 7.21, 19.35, -26.74 + u * 2.35), .15, 'naval', vertices=12)
        kit.part('box', A, col, 'hood window', V(s * (7.21 + 1.3), 18.9, -26.74), (1.1, .03, .3), 'glass')

    # 25 mm control positions (HP_JD_1, 3, 4, 7, 8, 10): a pedestal sight with its shield.
    for i, (px, py, pz, bearing) in enumerate([(.63, 18.71, -37.58, 0), (-2.92, 35.02, -29.15, -90), (2.92, 35.02, -29.06, 90),
                                                (-3.64, 19.59, 4.33, -90), (3.64, 19.59, 4.42, 90), (-.05, 18.69, 47.81, 180)], 1):
        A = f'aa-control-{i}'
        c = P(px, py, pz)
        foot = floor_under(kit, *c, 1.5)
        kit.cylz(A, col, 'pedestal', (c[0], c[1], foot - .02), .14, c[2] + .97 - foot, 'naval', 12)
        f = heading(bearing)
        kit.part('rod', A, col, 'sight', Vector(c) + Vector((0, 0, 1.05)) - f * .35, Vector(c) + Vector((0, 0, 1.05)) + f * .35, .09, 'dark', vertices=10)
        kit.part('box', A, col, 'shield', tuple(Vector(c) + Vector((0, 0, .75)) + f * .3), (.6 if abs(f.x) < .5 else .05, .05 if abs(f.x) < .5 else .6, .55), 'naval')

    # 1.5 m rangefinders on the bridge wings (HP_JF_1, 2) and 4.5 m rangefinders abaft the funnel (HP_JF_4, 5).
    for s in (-1, 1):
        kit.rangefinder(f'rangefinder-1-5-{"port" if s < 0 else "starboard"}', (s * 2.71, 22.77, -31.52), 1.5, 90 * s, col)
        A = f'rangefinder-4-5-{"port" if s < 0 else "starboard"}'
        c = P(s * 5.33, 19.21, -3.71)
        foot = floor_under(kit, *c, 2.0)
        kit.cylz(A, col, 'pedestal', (c[0], c[1], foot - .02), .6, c[2] + .82 - foot, 'naval', 20)
        kit.part('box', A, col, 'house', (c[0], c[1], c[2] + 1.2), (1.6, 1.5, 1.0), 'naval')
        kit.part('rod', A, col, 'tube', (c[0] - 2.3, c[1], c[2] + 1.35), (c[0] + 2.3, c[1], c[2] + 1.35), .2, 'naval', vertices=14)
        for u in (-1, 1):
            kit.part('box', A, col, 'end hood', (c[0] + u * 2.3, c[1], c[2] + 1.35), (.4, .45, .5), 'naval')

    # Type 22 radar horns on the pagoda (HP_JRS_2, 3) and Type 13 ladders on the after mast (HP_JRS_4, 5).
    for s in (-1, 1):
        A = f'type22-{"port" if s < 0 else "starboard"}'
        c = V(s * 4.55, 34.92, -30.33)
        f = heading(75 * s)
        kit.part('box', A, col, 'house', tuple(c + Vector((0, 0, .5))), (.9, .9, 1.0), 'naval')
        # Carried on a bracket from the rangefinder tower's side.
        kit.beam(A, col, 'bracket', V(s * 2.6, 34.85, -30.33), V(s * 4.5, 34.85, -30.33), .5, .14, 'naval')
        kit.member(A, col, V(s * 2.7, 33.6, -30.33), V(s * 4.2, 34.8, -30.33), .06, 'naval', 6)
        for dz in (.25, .95):
            kit.part('rod', A, col, 'horn', c + Vector((0, 0, dz)) + f * .4, c + Vector((0, 0, dz)) + f * 1.2, .12, 'naval', r2=.32, vertices=12)
    for s in (-1, 1):
        A = f'type13-{"port" if s < 0 else "starboard"}'
        for u in (-1, 1):
            kit.member(A, col, V(s * 2.035 + u * .3, 32.35, 44.77), V(s * 2.035 + u * .3, 37.0, 44.77), .03, 'edge', 4)
        for i in range(12):
            h = 32.55 + i * .38
            kit.member(A, col, V(s * 2.035 - .3, h, 44.77), V(s * 2.035 + .3, h, 44.77), .02, 'edge', 4)


# ---------------------------------------------------------------- masts, yards, cranes
def masts(D, kit):
    col = kit.cols['Sensors and masts']
    A = 'after-mast'
    # Pole topmast over the after tower's trunk (reference trunk 1.08 m square to 33.1 m at z 42.3; the pole,
    # 0.28 m, from there to 43.07 m at z 43.62, black above 34 m as the reference paints it).
    kit.part('rod', A, col, 'topmast', V(0, 31.0, 43.62), V(0, 34.0, 43.62), .17, 'naval', r2=.15, vertices=16)
    kit.part('rod', A, col, 'topmast head', V(0, 34.0, 43.62), V(0, 43.07, 43.62), .15, 'black', r2=.09, vertices=16)
    kit.part('rod', A, col, 'topmast band', V(0, 33.95, 43.62), V(0, 34.35, 43.62), .165, 'white', vertices=16)
    kit.part('box', A, col, 'heel bracket', tuple(V(0, 31.8, 43.2)), (.9, .5, 1.6), 'naval')
    # Upper yard (40.3 m, 4.2 m each way), the radar yard (37.0 m) and the gaff for the ensign.
    kit.member(A, col, V(-4.2, 40.3, 43.62), V(4.2, 40.3, 43.62), .06, 'black', 8)
    kit.member(A, col, V(-2.7, 37.05, 43.9), V(2.7, 37.05, 43.9), .07, 'black', 8)
    kit.member(A, col, V(0, 31.5, 43.62), V(0, 32.1, 46.0), .06, 'naval', 8)
    for s in (-1, 1):
        kit.member(A, col, V(s * 4.1, 40.3, 43.62), V(0, 42.3, 43.62), .012, 'edge', 3)
        kit.member(A, col, V(s * 2.6, 37.05, 43.9), V(0, 39.0, 43.62), .012, 'edge', 3)
    # Pagoda signal yard (flag halyards at 31.3 m, 9.6 m each way).
    A = 'pagoda-yard'
    kit.member(A, col, V(-9.7, 31.4, -22.8), V(9.7, 31.4, -22.8), .09, 'naval', 8)
    # Carried on a short boom from the pagoda's after face.
    kit.part('rod', A, col, 'boom', V(0, 31.4, -22.6), V(0, 31.4, -26.0), .14, 'naval', vertices=10)
    for s in (-1, 1):
        kit.member(A, col, V(s * 9.6, 31.4, -22.8), V(s * 2.2, 33.8, -23.3), .018, 'edge', 3)
        kit.member(A, col, V(s * 6.0, 31.4, -22.8), V(s * 3.0, 30.0, -23.0), .05, 'naval', 6)

    # Boat crane: a tapered boom from its heel on the boat deck abaft the pagoda to its head at the funnel's
    # front (reference 0.66 m boom from z -24.3 at 11.6 m to z -9.5 at 23.3 m), with its sheaves and hook.
    A = 'boat-crane'
    col = kit.cols['Boats and aviation']
    heel, head = V(0, 11.6, -24.3), V(0, 23.3, -9.5)
    kit.part('rod', A, col, 'boom', heel, head, .36, 'naval', r2=.24, vertices=16)
    kit.cylz(A, col, 'heel pedestal', tuple(V(0, 10.3, -24.8)), .55, 1.3, 'naval', 16)
    kit.part('rod', A, col, 'heel pin', V(-.5, 11.3, -24.5), V(.5, 11.3, -24.5), .12, 'edge', vertices=10)
    for dx in (-.35, .35):
        kit.sheave(A, col, tuple(head + Vector((0, dx * .8, .05))), (0, 1, 0), .32, .1)
    kit.member(A, col, head + Vector((0, 0, -.2)), head + Vector((0, 0, -3.3)), .03, 'black', 4)
    kit.part('rod', A, col, 'hook block', head + Vector((0, 0, -3.3)), head + Vector((0, 0, -3.8)), .12, 'black', vertices=10)

    # Folding aircraft crane stowed in its recess on the flight deck's port side (jm071, z 86.7-105).
    A = 'flight-deck-crane'
    kit.part('box', A, col, 'jib', tuple(V(-7.87, 10.5, 95.9)), (18.2, .7, .75), 'naval')
    kit.cylz(A, col, 'post', tuple(V(-7.87, 10.07, 87.3)), .5, .87, 'naval', 16)
    for u in range(8):
        kit.member(A, col, V(-7.87, 10.15, 87.9 + u * 2.2), V(-7.87, 10.85, 89.0 + u * 2.2), .04, 'edge', 4)

    # Boat booms stowed along the casemate ledge (jm216, z -64 to -51).
    for s in (-1, 1):
        A = f'boat-boom-{"port" if s < 0 else "starboard"}'
        kit.part('rod', A, col, 'boom', V(s * 10.2, 4.86, -63.8), V(s * 10.2, 4.86, -51.2), .16, 'naval', r2=.1, vertices=10)
        for zz in (-62.5, -57.0, -52.0):
            kit.part('box', A, col, 'crutch', tuple(V(s * 10.2, 4.7, zz)), (.12, .35, .32), 'naval')


# ---------------------------------------------------------------- searchlights
def searchlights(D, kit):
    col = kit.cols['Sensors and masts']
    for i, (x, y, z) in enumerate([(-3.39, 24.45, -26.15), (3.39, 24.45, -26.15), (-4.09, 26.94, -31.97), (4.09, 26.94, -31.97)], 1):
        kit.searchlight(f'searchlight-{i}', (x, y, z), col)
    # 110 cm searchlights on the funnel platforms.
    for i, (x, y, z) in enumerate([(-2.11, 20.68, -9.2), (2.11, 20.68, -9.2), (-2.11, 20.68, 1.89), (2.11, 20.68, 1.89)], 5):
        A = f'searchlight-{i}'
        c = V(x, y, z)
        foot = floor_under(kit, *c, 1.5)
        kit.cylz(A, col, 'pedestal', (c.x, c.y, foot - .02), .3, c.z + .62 - foot, 'naval', 14)
        kit.part('box', A, col, 'yoke', tuple(c + Vector((0, 0, .85))), (.3, 1.35, .6), 'naval')
        kit.part('rod', A, col, 'drum', c + Vector((-.55, 0, 1.4)), c + Vector((.5, 0, 1.4)), .66, 'naval', vertices=22)
        kit.part('rod', A, col, 'glass', c + Vector((.5, 0, 1.4)), c + Vector((.55, 0, 1.4)), .6, 'glass', vertices=22)
        kit.part('rod', A, col, 'vent', c + Vector((-.55, 0, 1.4)), c + Vector((-.75, 0, 1.4)), .36, 'naval', vertices=14)


# ---------------------------------------------------------------- boats
def boats(D, kit):
    col = kit.cols['Boats and aviation']
    # Reference boat bounds: centre x, centre z, length, beam, keel y.
    kit.motor_boat('motor-boat-17m', (6.08, -15.45), 17.0, 3.9, 9.45, col, chocks=(.25, .45, .65, .85))
    for s in (-1, 1):
        kit.covered_launch(f'motor-launch-{"port" if s < 0 else "starboard"}', (s * 3.02, -17.4), 12.0, 3.4, 10.15, col)
    kit.open_boat('cutter-boat-deck', (-2.955, -16.8), 9.0, 2.4, 11.55, 1.3, col)
    for s in (-1, 1):
        kit.open_boat(f'cutter-pagoda-{"port" if s < 0 else "starboard"}', (s * 8.65, -31.35), 9.0, 2.4, 9.75, 1.3, col, chocks=None)
        kit.open_boat(f'cutter-turret-4-{"port" if s < 0 else "starboard"}', (s * 7.545, 16.52), 9.0, 2.4, 4.9, 1.3, col)
    kit.open_boat('dinghy', (-4.43, -69.74), 6.2, 1.55, 7.45, .95, col)
    # Davits for the cutters abreast the pagoda, which hang clear of the deck.
    for s in (-1, 1):
        A = f'cutter-pagoda-{"port" if s < 0 else "starboard"}'
        for zz in (-34.6, -28.1):
            top = V(s * 8.65, 12.4, zz)
            kit.member(A, col, V(s * 7.1, 9.35, zz), V(s * 7.1, 12.0, zz), .1, 'naval', 8)
            kit.member(A, col, V(s * 7.1, 12.0, zz), top, .09, 'naval', 8)
            kit.member(A, col, top, top + Vector((0, 0, -1.2)), .015, 'edge', 3)
            kit.part('box', A, col, 'gripe', tuple(V(s * 8.65, 11.05, zz)), (.12, 2.5, .08), 'canvas')
    # Landing craft (14 m Daihatsu) abreast the funnel, on cradles.
    for i, (x, z, keel) in enumerate([(11.87, -12.27, 7.35), (-6.11, -14.17, 9.9)], 1):
        A = f'landing-craft-{i}'
        x0, y0, _ = P(x, 0, z)
        hull, st = kit.boat_hull(A + '.hull', col, x0, y0, keel, 14.0, 3.3, 1.4, 'naval', 'wood', 1, .95, .1, (.1, .05), .9)
        kit.tag(hull, A)
        kit.cradles(A, col, st, y0, (.2, .5, .8), 1.1)
        bx, bw, _, bg = st(.99)
        kit.part('box', A, col, 'bow ramp', (bx - .1, y0, bg - .6), (.12, 2.6, 1.3), 'naval')
        sx = st(.08)[0]
        kit.part('box', A, col, 'engine house', (sx + .8, y0, st(.08)[3] - .5), (1.6, 1.6, .9), 'naval')


# ---------------------------------------------------------------- catapults
def catapults(D, kit):
    col = kit.cols['Boats and aviation']
    for s, bearing in ((-1, 19.7), (1, -19.7)):
        A = f'catapult-{"port" if s < 0 else "starboard"}'
        pivot = V(s * 13.207, 8.871, 32.928)
        f = heading(bearing)
        side = Vector((-f.y, f.x, 0))
        seat = floor_under(kit, *pivot, 1.0)
        kit.cylz(A, col, 'turntable', (pivot.x, pivot.y, seat - .02), 2.1, pivot.z + .15 - seat, 'naval', 40)
        kit.cylz(A, col, 'pivot drum', tuple(pivot + Vector((0, 0, .15))), 1.0, .8, 'naval', 24)
        fwd, aft = pivot + f * 16.3, pivot - f * 9.4
        low, high = .95, 1.85
        kit.lattice(A, col, fwd + Vector((0, 0, (low + high) / 2)), aft + Vector((0, 0, (low + high) / 2)), 1.0, high - low, 20, .07, .04)
        for p in (pivot + f * 4, pivot - f * 3):
            for u in (-1, 1):
                kit.member(A, col, pivot + Vector((0, 0, .9)) + side * u * .45, p + Vector((0, 0, low)) + side * u * .45, .06, 'naval', 6)
        # Launching carriage near the after end, and the rails along the top chord.
        car = aft + f * 3.0 + Vector((0, 0, high + .2))
        kit.part('box', A, col, 'carriage', tuple(car), (3.0 if abs(f.x) > .7 else 1.3, 1.3 if abs(f.x) > .7 else 3.0, .35), 'naval')
        for u in (-1, 1):
            kit.member(A, col, aft + Vector((0, 0, high + .04)) + side * u * .35, fwd + Vector((0, 0, high + .04)) + side * u * .35, .05, 'edge', 4)
        # Sheaves and buffers at the forward end.
        kit.sheave(A, col, tuple(fwd + Vector((0, 0, high - .1))), tuple(side), .3, .2)


# ---------------------------------------------------------------- AA rocket launchers
def rockets(D, kit):
    """The six 12 cm 28-tube rocket launchers on the after gallery (HP_JGA_36-41): visual fittings, since the
    simulation has no rocket weapon. A pedestal, a cradle and a four-by-seven tube pack trained outboard at the
    reference's rest elevation, behind a sheet shield."""
    col = kit.cols['Light AA']
    for i, (x, y, z, bearing) in enumerate([(-9.603, 7.983, 94.709, -90), (9.603, 7.983, 94.709, 90), (-9.258, 7.983, 98.15, -90),
                                            (9.258, 7.983, 98.15, 90), (-8.907, 7.983, 101.501, -90), (8.907, 7.983, 101.501, 90)], 1):
        A = f'rocket-launcher-{i}'
        c = V(x, y, z)
        f = heading(bearing)
        side = Vector((-f.y, f.x, 0))
        kit.cylz(A, col, 'pedestal', tuple(c), .45, .55, 'naval', 18)
        kit.cylz(A, col, 'training ring', tuple(c + Vector((0, 0, .55))), .6, .12, 'naval', 20)
        for u in (-1, 1):
            kit.part('box', A, col, 'cradle cheek', tuple(c + Vector((0, 0, 1.05)) + side * u * .58), (.5 if abs(f.x) > .5 else .08, .08 if abs(f.x) > .5 else .5, 1.0), 'naval')
        elev = math.radians(20)
        axis = f * math.cos(elev) + Vector((0, 0, math.sin(elev)))
        up = Vector((0, 0, 1)) * math.cos(elev) - f * math.sin(elev)
        centre = c + Vector((0, 0, 1.35))
        for row in range(4):
            for colm in range(7):
                o = centre + side * ((colm - 3) * .16) + up * ((row - 1.5) * .16)
                kit.part('rod', A, col, 'tube', o - axis * 1.05, o + axis * 1.05, .07, 'naval', vertices=8)
        kit.part('box', A, col, 'shield', tuple(centre - axis * .9 + up * .1), (.06 if abs(f.x) > .5 else 1.35, 1.35 if abs(f.x) > .5 else .06, .95), 'naval')
        kit.part('box', A, col, 'layer seat', tuple(c + Vector((0, 0, .75)) - f * .45 + side * .45), (.35, .35, .08), 'naval')
        kit.part('rod', A, col, 'seat post', c + Vector((0, 0, .6)) - f * .45 + side * .45, c + Vector((0, 0, .75)) - f * .45 + side * .45, .04, 'naval', vertices=6)


# ---------------------------------------------------------------- ground tackle and deck gear
def deck_gear(D, kit):
    col = kit.cols['Deck fittings']
    # Bow anchors housed in their hawses (cm137/cm138), with cables to the windlass and capstan.
    for s in (-1, 1):
        A = f'bow-anchor-{"port" if s < 0 else "starboard"}'
        c = V(s * 2.33, 6.55, -102.9)
        kit.part('box', A, col, 'anchor shank', tuple(c), (1.9, .32, .45), 'black')
        kit.part('box', A, col, 'anchor crown', tuple(c + Vector((-.9, 0, -.35))), (.5, .9, .5), 'black')
        kit.part('rod', A, col, 'hawse pipe', V(s * 2.2, 7.3, -101.6), V(s * 1.6, 8.2, -97.8), .3, 'black', vertices=12)
        kit.polyline(A, col, [V(s * 1.6, 8.25, -97.8), V(s * 1.2, 8.3, -93.0), V(s * .9, 8.3, -88.3)], .09, 'black', 6)
    A = 'windlass'
    kit.cylz(A, col, 'capstan', tuple(V(0, 7.4, -86.36)), .9, .87, 'naval', 24)
    kit.cylz(A, col, 'capstan head', tuple(V(0, 8.27, -86.36)), .6, .15, 'naval', 20)
    for s in (-1, 1):
        kit.cylz(A, col, 'cable lifter', tuple(V(s * 1.4, 7.45, -87.8)), .6, .45, 'naval', 20)
    A = 'after-capstans'
    kit.cylz(A, col, 'capstan', tuple(V(-1.83, 4.79, 96.57)), .85, .87, 'naval', 24)
    kit.cylz(A, col, 'capstan head', tuple(V(-1.83, 5.66, 96.57)), .55, .12, 'naval', 20)
    kit.cylz(A, col, 'small capstan', tuple(V(1.6, 4.73, 94.55)), .6, .82, 'naval', 20)
    for s in (-1, 1):
        A = f'stern-anchor-{"port" if s < 0 else "starboard"}'
        kit.part('box', A, col, 'anchor', tuple(V(s * 3.0, 2.75, 99.9)), (1.2, .25, 1.9), 'black')
    # Electric deck winches (jm032) and paravanes (jm002) on the forecastle.
    for x, y, z in [(-9.67, 6.81, -35.5), (9.67, 6.81, -35.5), (-6.06, 6.9, -50.46), (5.97, 6.9, -50.6), (-4.12, 4.5, 13.92), (4.16, 4.5, 13.92)]:
        A = f'winch-{"p" if x < 0 else "s"}{int(abs(z))}'
        c = V(x, y, z)
        kit.part('box', A, col, 'bed', tuple(c + Vector((0, 0, .1))), (2.2, 1.0, .2), 'naval')
        kit.part('rod', A, col, 'drum', c + Vector((0, -.45, .55)), c + Vector((0, .45, .55)), .38, 'naval', vertices=16)
        kit.part('box', A, col, 'motor', tuple(c + Vector((.75, 0, .55))), (.6, .7, .8), 'naval')
    for x, y, z in [(4.93, 9.33, -44.8), (-4.93, 9.33, -44.8), (-3.25, 6.99, -55.68), (3.25, 6.99, -55.7)]:
        A = f'paravane-{"p" if x < 0 else "s"}{int(abs(z))}'
        c = V(x, y, z)
        kit.part('rod', A, col, 'body', c + Vector((0, -1.5, .5)), c + Vector((0, 1.5, .5)), .22, 'naval', vertices=12)
        kit.part('box', A, col, 'plane', tuple(c + Vector((0, 0, .5))), (1.2, .06, .9), 'naval')
        kit.part('box', A, col, 'chock', tuple(c + Vector((0, 0, .15))), (.3, 1.6, .3), 'naval')


# ---------------------------------------------------------------- screws, shafts, rudders
def underwater(D, kit):
    col = kit.cols['Underwater fittings']
    # Four three-bladed screws (cm001/cm032, 3.6 m) on their shafts: the outer pair on A-brackets forward of the
    # inner pair.
    for x, y, z, hub in [(-7.115, -6.12, 75.11, 'outer'), (7.12, -6.12, 75.11, 'outer'), (-2.87, -6.86, 84.18, 'inner'), (2.87, -6.86, 84.18, 'inner')]:
        aid = f'screw-{"port" if x < 0 else "starboard"}-{hub}'
        c = V(x, y, z)
        kit.part('rod', aid, col, 'hub', c + Vector((.75, 0, 0)), c + Vector((-.55, 0, 0)), .42, 'bronze', r2=.36, vertices=14)
        kit.part('rod', aid, col, 'hub cone', c + Vector((-.55, 0, 0)), c + Vector((-1.05, 0, 0)), .36, 'bronze', r2=.08, vertices=14)
        hand = 1 if x > 0 else -1
        for k in range(3):
            a = math.pi / 6 + k * math.tau / 3
            ca, sa = math.cos(a), math.sin(a)
            sections = []
            for r, w in ((.32, .8), (.95, 1.15), (1.45, 1.05), (1.8, .5)):
                le = (c.x - w * .16 * hand, c.y + r * ca - w * sa * .5, c.z + r * sa + w * ca * .5)
                te = (c.x + w * .16 * hand, c.y + r * ca + w * sa * .5, c.z + r * sa - w * ca * .5)
                sections.append((le, te))
            vv = []
            for le, te in sections:
                for dx in (-.04, .04):
                    vv += [(le[0] + dx, le[1], le[2]), (te[0] + dx, te[1], te[2])]
            ff = []
            for i in range(len(sections) - 1):
                a0, b0 = 4 * i, 4 * (i + 1)
                ff += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, b0 + 2, b0 + 3, a0 + 3), (a0, b0, b0 + 2, a0 + 2), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
            last = 4 * (len(sections) - 1)
            ff += [(0, 2, 3, 1), (last, last + 1, last + 3, last + 2)]
            recalc(kit.tag(kit.mesh(aid + '.blade', vv, ff, 'bronze', col), aid))
        # Shaft forward into the hull, and its brackets.
        if hub == 'outer':
            start = V(x * .8, -4.7, 52.0)
            kit.part('rod', aid, col, 'shaft', start, c + Vector((.75, 0, 0)), .25, 'bronze', vertices=12)
            for zz, drop in ((72.4, 1.0), (62.0, .6)):
                p = V(x + (x * .8 - x) * (75.11 - zz) / (75.11 - 52.0), y + (-4.7 - y) * (75.11 - zz) / (75.11 - 52.0), zz)
                kit.part('rod', aid, col, 'bearing', p + Vector((.5, 0, 0)), p + Vector((-.5, 0, 0)), .38, 'antifouling', vertices=12)
                kit.member(aid, col, p, V(x * .72, y + 2.6 + drop, zz), .14, 'antifouling', 8)
                kit.member(aid, col, p, V(x * 1.06, y + 2.1 + drop, zz), .14, 'antifouling', 8)
        else:
            start = V(x * .7, -5.6, 62.0)
            kit.part('rod', aid, col, 'shaft', start, c + Vector((.75, 0, 0)), .25, 'bronze', vertices=12)
            p = V(x, y + .05, 81.5)
            kit.part('rod', aid, col, 'bearing', p + Vector((.5, 0, 0)), p + Vector((-.5, 0, 0)), .38, 'antifouling', vertices=12)
            kit.member(aid, col, p, V(x * .6, y + 2.3, 81.5), .14, 'antifouling', 8)
            kit.member(aid, col, p, V(x * 1.15, y + 2.1, 81.5), .14, 'antifouling', 8)
    # Twin balanced rudders behind the inner screws (reference x 1.88, z 85.9 to 92.7, 0.6 m thick).
    for s in (-1, 1):
        aid = f'rudder-{"port" if s < 0 else "starboard"}'
        n = 12
        foil = []
        for i in range(n + 1):
            t = i / n
            half = .3 * 2.6 * math.sqrt(max(0, t)) * (1 - t) ** 1.1
            foil.append((85.9 + 6.8 * t, half))
        ring = [(s * 1.88 + w, zz) for zz, w in foil] + [(s * 1.88 - w, zz) for zz, w in reversed(foil[1:-1])]
        pts = [P(x, 0, zz)[:2] for x, zz in ring]
        top = 0.0
        try:
            top = kit.support.below(*P(s * 1.88, 0, 88.0)[:2], 2.0)
        except ValueError:
            top = -3.3
        kit.prism(aid, col, 'blade', pts, -9.0, top + .15, 'antifouling')
        kit.part('rod', aid, col, 'stock', V(s * 1.88, top - .2, 87.6), V(s * 1.88, top + .6, 87.6), .24, 'antifouling', vertices=12)


# ---------------------------------------------------------------- rails
def rails(D, kit):
    """Guard rails along the forecastle and upper-deck edges and round the flight deck; gun arcs stay clear."""
    col = kit.cols['Deck fittings']
    H = D['hull']
    secs = H['sections']
    L = H['length']

    def edge(station):
        for a, b in zip(secs, secs[1:]):
            if a['station'] <= station <= b['station']:
                t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
                w = a['points'][-1][0] * (1 - t) + b['points'][-1][0] * t
                y = a['points'][-1][1] * (1 - t) + b['points'][-1][1] * t
                return w, y
        return None
    for s in (-1, 1):
        for z0, z1 in ((-104.0, -14.3), (-13.3, 40.5)):
            pts = []
            n = max(2, int(abs(z1 - z0) / 1.6))
            for i in range(n + 1):
                zr = z0 + (z1 - z0) * i / n
                e = edge(L / 2 - (zr + ZS))
                if e:
                    w, y = e
                    pts.append((-(zr + ZS), -s * (w - .12), y))
            for (ax, ay, az), (bx, by, bz) in zip(pts, pts[1:]):
                for h in (.45, .9):
                    kit.wire('rails', col, (ax, ay, az + h), (bx, by, bz + h), .016)
                kit.wire('rails', col, (ax, ay, az), (ax, ay, az + .9), .022)


def glazing(D, kit):
    """Windows and portholes of the pagoda and the after tower (ise_windows.py, read off the reference's painted
    textures), seated on this model's own walls: a ray from outside along the view finds the wall, and an opening
    is glazed only where that wall faces the view."""
    from ise_windows import ROWS
    tree = kit.support.tree
    col = kit.cols['Superstructure']
    rows = []
    for view, kind, across, y, w, h, wall in ROWS:
        if view == 'front':
            starts = [(Vector(P(across, y, -75)), Vector((-1, 0, 0)), Vector(P(across, y, wall)))]
        else:
            starts = [(Vector(P(s * 30, y, across)), Vector((0, s, 0)), Vector(P(s * wall, y, across))) for s in (1, -1)]
        for origin, direction, expected in starts:
            hit, normal, _, dist = tree.ray_cast(origin, direction, 80)
            # Our wall must face the view and stand within 0.5 m of the reference's.
            if hit is None or normal.dot(-direction) < .82 or (hit - expected).length > .5:
                continue
            # Runtime frame for Kit.windows: x starboard, z toward the stern, outward normal in x and z.
            rows.append((kind, round(-hit.y, 3), round(hit.z, 3), round(-hit.x, 3), w, h, round(-normal.y, 3), round(-normal.x, 3)))
    kit.windows('bridge-glazing', col, rows)


def build(D, kit):
    glazing(D, kit)
    directors(D, kit)
    masts(D, kit)
    searchlights(D, kit)
    boats(D, kit)
    catapults(D, kit)
    rockets(D, kit)
    deck_gear(D, kit)
    underwater(D, kit)
    rails(D, kit)

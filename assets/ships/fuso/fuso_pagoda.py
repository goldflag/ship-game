"""Fusō pagoda foremast region: reference z -40 to -17, above the forecastle deck.

The measured prisms give the tiers and platforms; this module adds what the reference shows on them: the
main director on the top platform with the 10 m rangefinder tower and the radar mattress on its face, the Type 22
radars, the 3.5 m and 1.5 m rangefinders, the Type 91 high-angle directors, searchlights, binoculars and lamps, the
signal yards, the forestay aerial, the bridge glazing the reference paints in three bands, rails round exposed
roofs and knees under overhangs. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from fuso_kit import P, ZC
from fuso_fittings import SMALL_FITTINGS

CLAIMED_STRUCTURES = set()
DIRECTOR = (0, 39.52, -30.415)      # reference HP_JD_1: the main director's training axis and seat


def zone(x, y, z):
    """Runtime point inside the pagoda region."""
    return -40 < z < -16.5 and y > 8.9


def build(D, kit):
    masts = kit.cols['Sensors and masts']
    sup = kit.cols['Superstructure']
    structures = [s for s in D['structures'] if s['id'] != 'funnel']
    main_director(kit, masts)
    rangefinder_10m(kit, masts)
    type22_radars(kit, masts)
    for id, ref, width in [('rf-bridge-port', (-1.21, 25.862, -31.438), 1.5), ('rf-bridge-starboard', (1.26, 25.86, -31.432), 1.5),
                           ('rf-secondary-port', (-4.488, 23.049, -28.212), 3.5), ('rf-secondary-starboard', (4.512, 23.045, -28.227), 3.5),
                           ('rf-upper-port', (-3.879, 30.876, -27.454), 3.5), ('rf-upper-starboard', (3.869, 30.875, -27.543), 3.5)]:
        kit.rangefinder(id, ref, width, 0, masts)
    for id, rx in [('ha-director-port', -5.182), ('ha-director-starboard', 5.199)]:
        type91_director(kit, id, (rx, 22.94, -21.4), masts)
    bridge_gear(kit, masts)
    rear_legs(kit, sup)
    signal_yards(kit, sup)
    forestay(kit, masts)
    glazing(kit, sup)
    kit.roof_rails('pagoda-rails', sup, structures, zone)
    kit.overhang_knees('pagoda-knees', sup, structures, zone)


# ---------------------------------------------------------------- top platform
def main_director(kit, col):
    """Main battery director: a drum 3.7 m across on a training ring, with its roof lip, sighting hood and ports."""
    A = 'main-director'
    x, y, z = DIRECTOR
    moving = []
    moving.append(kit.cylz(A, col, 'training ring', P(x, y, z), 1.9, .14, 'edge', 40))
    moving.append(kit.cylz(A, col, 'drum', P(x, y + .14, z), 1.83, 1.55, 'naval', 40))
    moving.append(kit.cylz(A, col, 'roof lip', P(x, y + 1.69, z), 1.9, .08, 'naval', 40))
    moving.append(kit.cylz(A, col, 'roof', P(x, y + 1.77, z), 1.75, .18, 'roof', 40, r2=1.35))
    # Sighting hood and ports on the forward face; the rangefinder's objective housings either side.
    hx, hy, hz = P(0, y + 1.1, z - 1.7)
    moving.append(kit.part('box', A, col, 'sight hood', (hx, hy, hz), (.55, 1.6, .62), 'naval'))
    moving.append(kit.part('box', A, col, 'sight port', (hx + .28, hy, hz), (.03, 1.3, .22), 'glass'))
    for s in (-1, 1):
        px, py, pz = P(s * 1.3, y + .9, z - 1.3)
        moving.append(kit.part('box', A, col, 'side port', (px, py, pz), (.03, .5, .32), 'glass'))
        moving.append(kit.part('box', A, col, 'hatch', P(s * 1.82, y + .8, z + .3), (.9, .04, .95), 'painted-edge'))
    moving.append(kit.part('rod', A, col, 'roof vent', P(.6, y + 1.9, z + .7), P(.6, y + 2.3, z + .7), .12, 'naval', vertices=10))
    radar_pivot('main-director.yaw', P(x, y, z), moving)


def rangefinder_10m(kit, col):
    """10 m rangefinder (reference HP_JF_7) through the tower on the top platform, and the radar mattress on the
    tower's forward face. Reference sections: the tower 2.1 m wide over z -28.4 to -25.9 from 40.8 to 44.5 m with a
    short post on its roof, the tube's arms out to 5.5 m either side at 41.7 m, the mattress 5.1 m wide from 42.2 to
    44.4 m at z -28.5."""
    A = 'rangefinder-10m'
    x, y, z = 0.044, 40.835, -26.923
    kit.cylz(A, col, 'turntable', P(x, y, z), 1.35, .16, 'edge', 32)
    kit.part('box', A, col, 'housing', P(x, y + 1.88, z - .05), (2.5, 2.2, 3.48), 'naval')
    kit.part('box', A, col, 'housing roof', P(x, y + 3.66, z - .05), (2.62, 2.32, .08), 'roof')
    kit.part('rod', A, col, 'roof post', P(x, y + 3.68, z + .02), P(x, 44.95, z + .02), .07, 'naval', vertices=8)
    # Tube across the ship with armoured end hoods and objectives facing forward.
    ty = y + .92
    kit.part('rod', A, col, 'tube', P(x - 5.0, ty, z - .2), P(x + 5.0, ty, z - .2), .3, 'naval', vertices=18)
    for s in (-1, 1):
        hx, hy, hz = P(x + s * 5.05, ty, z - .2)
        kit.part('box', A, col, 'end hood', (hx, hy, hz), (1.05, .72, .78), 'naval')
        kit.part('box', A, col, 'objective', (hx + .53, hy, hz + .05), (.03, .5, .34), 'glass')
        kit.part('rod', A, col, 'tube collar', P(x + s * 1.3, ty, z - .2), P(x + s * 1.45, ty, z - .2), .36, 'naval', vertices=18)
    # Radar mattress: a dark panel in a frame on the tower's forward face, braced back to it.
    face = z - .05 - 1.25
    gz = -28.5
    y0, y1, half = 42.21, 44.40, 2.54
    kit.part('box', A, col, 'mattress', P(x, (y0 + y1) / 2, gz), (.08, 2 * half, y1 - y0), 'edge')
    corners = [P(x - half, y0, gz), P(x + half, y0, gz), P(x + half, y1, gz), P(x - half, y1, gz)]
    kit.polyline(A, col, corners + corners[:1], .05, 'naval', 6)
    for i in range(1, 9):
        xx = x - half + 2 * half * i / 9
        kit.member(A, col, P(xx, y0, gz - .05), P(xx, y1, gz - .05), .025, 'naval', 4)
    for j in range(1, 5):
        yy = y0 + (y1 - y0) * j / 5
        kit.member(A, col, P(x - half, yy, gz - .05), P(x + half, yy, gz - .05), .025, 'naval', 4)
    for s in (-1, 1):
        for yy in (y0 + .25, y1 - .25):
            kit.member(A, col, P(x + s * 1.9, yy, gz), P(x + s * .9, yy, face + .1), .05, 'naval', 6)


def type22_radars(kit, col):
    """Type 22 surface radars (reference HP_JRS_1/2): a transmitting and a receiving horn on a small cabinet."""
    for id, rx in [('type22-port', -2.835), ('type22-starboard', 2.835)]:
        x, y, z = P(rx, 38.588, -26.63)
        floor = kit.floor(x, y, 38.7)
        base = z if floor is None or z - floor > 1.2 else floor
        kit.part('box', id, col, 'cabinet', (x, y, base + .35), (.55, .6, .7), 'naval')
        for dy in (-.18, .18):
            mouth = Vector((x + .85, y + dy, base + .95))
            throat = Vector((x + .25, y + dy, base + .95))
            vv = [tuple(throat + Vector((0, a * .06, b * .05))) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            vv += [tuple(mouth + Vector((0, a * .2, b * .16))) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            ff = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0)]
            kit.tag(kit.mesh(id + '.horn', vv, ff, 'naval', col), id)
            kit.part('rod', id, col, 'waveguide', (x + .1, y + dy, base + .7), tuple(throat), .04, 'edge', vertices=6)


def type91_director(kit, id, ref, col):
    """Type 91 high-angle director (reference HP_JD_2/3): a round seat, a squared house with sighting ports and
    its rangefinder arms."""
    x, y, z = P(*ref)
    moving = []
    moving.append(kit.cylz(id, col, 'seat', (x, y, z - .02), .95, .22, 'naval', 28))
    moving.append(kit.part('box', id, col, 'house', (x, y, z + 1.05), (2.05, 1.7, 1.66), 'naval'))
    moving.append(kit.part('box', id, col, 'house roof', (x, y, z + 1.9), (2.12, 1.78, .06), 'roof'))
    moving.append(kit.part('rod', id, col, 'rangefinder', (x - .5, y - 1.2, z + 1.45), (x - .5, y + 1.2, z + 1.45), .12, 'naval', vertices=12))
    for s in (-1, 1):
        moving.append(kit.part('box', id, col, 'rangefinder hood', (x - .5, y + s * 1.2, z + 1.45), (.35, .3, .32), 'naval'))
        moving.append(kit.part('box', id, col, 'port', (x + 1.03, y + s * .45, z + 1.3), (.03, .38, .24), 'glass'))


def bridge_gear(kit, col):
    """Searchlights, their controls, binoculars, lamps and lockers from the reference's fitting bounds."""
    for n, (kind, rx, ry, rz, (w, l, h)) in enumerate(SMALL_FITTINGS):
        if not -40 < rz - ZC < -16.5 or ry < 8.9:
            continue
        A = f'pagoda-{kind.replace(" ", "-")}-{n}'
        x, y, z = P(rx, ry, rz)
        floor = kit.floor(x, y, ry + .3)
        if floor is None or abs(floor - ry) > .6:
            continue
        base = floor
        if kind == 'searchlight':
            kit.searchlight(A, (rx, base, rz), col)
        elif kind in ('binocular', 'binocular pair', 'searchlight control'):
            kit.cylz(A, col, 'pedestal', (x, y, base), .07, max(.6, h * .72), 'naval', 8)
            top = base + max(.6, h * .72)
            if kind == 'binocular pair':
                kit.part('box', A, col, 'binocular', (x, y, top + .12), (.3, .7, .24), 'edge')
            else:
                kit.part('box', A, col, 'binocular', (x, y, top + .09), (.28, .34, .18), 'edge')
                kit.part('rod', A, col, 'objective', (x + .14, y - .09, top + .1), (x + .17, y - .09, top + .1), .06, 'glass', vertices=8)
                kit.part('rod', A, col, 'objective', (x + .14, y + .09, top + .1), (x + .17, y + .09, top + .1), .06, 'glass', vertices=8)
        elif kind in ('signal lamp', 'deck lamp', 'running light'):
            kit.part('box', A, col, 'lamp', (x, y, base + h / 2), (max(.2, l * .8), max(.2, w * .8), h), 'naval')
            kit.part('box', A, col, 'lens', (x + max(.1, l * .4) + .01, y, base + h * .6), (.02, max(.14, w * .6), h * .4), 'glass')
        elif kind == 'flag locker':
            kit.part('box', A, col, 'locker', (x, y, base + h / 2), (l, w, h), 'naval')


def forestay(kit, col):
    """The aerial the reference's orthographic side render traces from the pagoda's upper tier (37.0 m at z -33.1)
    down to an insulator 4.5 m over the forecastle at z -84.5, with its lead to the deck, and the bridle from the
    lower bridge tier (16.2 m at z -38.5) joining it at 26.6 m over z -54.1."""
    A = 'aerials-forward'
    # The forestay ends in an insulator laid along it (drawn with the wires); the down-lead leaves its lower end.
    kit.wire(A, col, P(0, 37.04, -33.1), P(0, 12.0, -83.4), .015, check=False)
    kit.wire(A, col, P(0, 16.2, -38.5), P(0, 26.58, -54.12), .015, check=False)
    kit.wire(A, col, P(0, 12.2, -83.0), P(0, 11.45, -84.5), .05, check=False, sides=6)
    x, y, _ = P(0, 0, -84.3)
    floor = kit.floor(x, y, 9.0)
    if floor is not None:
        kit.wire(A, col, P(0, 11.55, -84.3), (x, y, floor - .02), .012, check=False)


def signal_yards(kit, col):
    """The signal yard: a railed walkway 1.2 m wide at 34.2 m across the tower's after face (reference level cut at
    34.25 m, 15.5 m across) with yard arms out to the flag hardpoints (HP_flag_1-4) and signal halyards."""
    A = 'signal-yards'
    y0, z0, z1 = 34.15, -24.6, -22.1
    kit.part('box', A, col, 'walkway', P(0, y0, (z0 + z1) / 2), (z1 - z0, 15.6, .1), 'roof')
    kit.rail(A, col, [P(-7.8, 0, z1)[:2], P(7.8, 0, z1)[:2]], y0 + .05, 1.0, 1.4, check=False)
    for s in (-1, 1):
        kit.rail(A, col, [P(s * 7.8, 0, z0 + 1.2)[:2], P(s * 7.8, 0, z1)[:2]], y0 + .05, 1.0, 1.4, check=False)
        kit.part('rod', A, col, 'yard arm', P(s * 6.8, y0 - .09, -22.3), P(s * 10.45, 33.72, -20.78), .07, 'naval', vertices=8, r2=.045)
        kit.member(A, col, P(s * 3.5, y0 - .05, -22.4), P(s * 6.8, y0 - .05, -22.3), .06, 'naval', 6)
        for t in (0.35, 0.65, 0.95):
            a = Vector(P(s * 6.8, y0 - .09, -22.3)).lerp(Vector(P(s * 10.45, 33.72, -20.78)), t)
            kit.wire(A, col, tuple(a), (a.x, a.y, a.z - 1.2), .012, check=False)


def glazing(kit, col):
    """Bridge windows the reference paints in three bands (orthographic front and side renders): panes cast
    onto this model's own walls, forward faces and the forward ends of the sides."""
    rows = []
    bands = [(20.0, 20.6, -34.4, 3.0, -30.8), (23.2, 23.9, -33.4, 1.6, -31.2), (28.85, 29.5, -33.1, 2.5, -30.8)]
    for y0, y1, zfront, half, zside in bands:
        yc, h = (y0 + y1) / 2, y1 - y0
        n = max(2, round(2 * half / .52))
        for i in range(n):
            xr = -half + (i + .5) * 2 * half / n
            hit = kit.hit(P(xr, yc, zfront - 6), (-1, 0, 0), 8)
            if hit:
                loc, nrm = hit
                rows.append(('window', -loc.y, yc, -loc.x, 2 * half / n - .08, h, -nrm.y, -nrm.x))
        for s in (-1, 1):
            m = max(1, round((zside - zfront) / .52))
            for i in range(m):
                zr = zfront + (i + .5) * (zside - zfront) / m
                hit = kit.hit(P(s * 9, yc, zr), (0, s, 0), 8)
                if hit:
                    loc, nrm = hit
                    rows.append(('window', -loc.y, yc, -loc.x, (zside - zfront) / m - .08, h, -nrm.y, -nrm.x))
    # No pane inside a light gun's working circle (the tower's walls are cut back round those guns).
    guns = [(m['position'][0], m['position'][1], m['position'][2]) for m in kit.D['mounts'] if m['id'].startswith('aa25-')]
    rows = [r for r in rows if not any(math.hypot(r[1] - gx, r[3] - gz) < 1.9 and -.5 < r[2] - gy < 3 for gx, gy, gz in guns)]
    kit.windows('bridge-glazing', col, rows)


def rear_legs(kit, col):
    """The tower's rear legs and the struts under its after platforms (reference plan cuts every 1.5 m: two legs
    0.55 m across from the base roof at 9.2 m up to the 21.7 m platform, leaning 2 m aft, and a strut pair from the
    base roof to the 16.5 m platform's after corners), in runtime-frame datums."""
    for s in (-1, 1):
        for a, b, r in [((s * 2.6, 9.0, -23.0), (s * 1.97, 21.4, -21.0), .28), ((s * 5.0, 9.0, -22.8), (s * 3.9, 16.62, -22.9), .2)]:
            pa, pb = (-a[2], -a[0], a[1]), (-b[2], -b[0], b[1])
            foot = kit.floor(pa[0], pa[1], a[1] + .4)
            pa = (pa[0], pa[1], foot - .03 if foot is not None else pa[2])
            kit.part('rod', 'pagoda-legs', col, 'leg', pa, pb, r, 'naval', vertices=14)

"""Nagato fittings: mount seats, roof materials and everything the measured prisms cannot draw.

Datums are reference-frame measurements (x starboard, y up, z toward the stern) converted by `P`.
"""
import math
import bpy
from mathutils import Vector
from nagato_kit import P, R, ZC
import nagato_masts
import nagato_boats
import nagato_hull
import nagato_rails
from nagato_windows import WINDOWS

# Measured prisms a region draws itself (still used as supports and kept as combat volumes): the two searchlight
# towers on the funnel platform are open four-legged A-frames in the reference (searchlight_towers).
CLAIMED_STRUCTURES = {'deckhouse-053', 'deckhouse-054'}

# Roof paint read off the textured top renders of the reference (`ship:overlay --textured`): the 01 and 02 decks round
# the pagoda and the funnel and the 13.5 m pagoda platform are planked; the deck-edge sponsons abreast the funnel are
# grey steel, and the two after sponsons lie in the linoleum aircraft deck.
PLANKED_ROOFS = {'deckhouse-018', 'deckhouse-020', 'deckhouse-026', 'platform-072', 'deckhouse-113', 'deckhouse-114'}
STEEL_ROOFS = {'forecastle-002', 'forecastle-003', 'forecastle-006', 'forecastle-007'}
LINOLEUM_ROOFS = {'forecastle-004', 'forecastle-005'}
# The reference paints the whole mainmast black above a line at 22.65 m (trunk, tiers, platforms, legs and topmast);
# the after control position and its tower below and abaft the trunk stay grey.
MAST_BLACK_FROM = 22.65


def roof(s):
    """Roof material of a measured block: planked weather decks (the forecastle deck block and the decks above),
    linoleum on the aircraft deck's sponsons and grey steel elsewhere."""
    if mast_black(s):
        return 'black'
    if s['id'] in STEEL_ROOFS:
        return 'roof'
    if s['id'] in LINOLEUM_ROOFS:
        return 'linoleum'
    if s['id'].startswith('forecastle-') or s['id'] in PLANKED_ROOFS:
        return 'deck'
    return 'roof'


def mast_black(s):
    """A mainmast trunk block above the black paint line (the after control position's tower abaft z 21.5 is not)."""
    return (s['name'].startswith('Mainmast') and s['baseY'] >= MAST_BLACK_FROM - .05
            and min(z for x, z in s['footprint']) < 21.5)


def tier(kit, s, rows, col):
    """An open pagoda tier drawn from its measured cuts (nagato_tiers.TIERS) in place of the solid prism: the legs and
    central tube as columns, bulwarks, windscreens and fins as thin walls, and its decks as plates."""
    obs = []
    top = roof(s)
    paint = 'black' if mast_black(s) else 'naval'
    for y0, y1, pieces in rows:
        for p in pieces:
            if p[0] == 'c':
                _, x, z, r = p
                obs.append(kit.cylz(s['id'], col, 'column', (-z, -x, y0), r, y1 - y0, paint, 16))
            else:
                obs.append(kit.prism(s['id'], col, 'tier', [(-z, -x) for x, z in p[1]], y0, y1, paint, top_material=top))
    return obs


def mount_seat(kit, mount, col):
    """A pedestal from the supporting deck to a secondary or light mount's datum when it stands above it."""
    x, y, z = R(mount['position'])
    floor = kit.below(x, y, z + .3, z)
    gap = z - floor
    if gap > .03:
        w = mount['weapon']
        r = w['barbetteRadius'] if mount['partId'].startswith('type3-140') else max(.35, w['barbetteRadius'] * .75)
        kit.cylz(mount['id'], col, 'pedestal', (x, y, floor - .01), r, gap + .012, 'naval', 36 if r > 1 else 20)


def attach(objs, parent):
    """Parent objects to a joint without moving them (the joint's world matrix must be current)."""
    bpy.context.view_layer.update()
    inverse = parent.matrix_world.inverted()
    for o in objs:
        o.parent = parent
        o.matrix_parent_inverse = inverse


def main_director(kit):
    """Type 94 director on the pagoda top (HP_JD_1), training on its own yaw node for the rig."""
    col = kit.collections['Sensors and masts']
    A = 'main-director'
    x, y, z = P(0, 37.41, -31.549)
    yaw = kit.empty(A + '.yaw', (x, y, z), assembly=A, col=col)
    parts = [kit.cylz(A, col, 'training base', (x, y, z), 1.55, .22, 'edge', 32),
             kit.cylz(A, col, 'drum', (x, y, z + .22), 1.62, 1.05, 'naval', 32),
             kit.cylz(A, col, 'roof', (x, y, z + 1.27), 1.70, .08, 'roof', 32),
             kit.cylz(A, col, 'sight hood', (x - .25, y, z + 1.35), .75, .42, 'naval', 20)]
    for s in (-1, 1):
        parts.append(kit.part('rod', A, col, 'rangefinder arm', (x - .2, y + s * 1.55, z + .8), (x - .2, y + s * 1.95, z + .8), .18, 'naval', vertices=12))
        parts.append(kit.boxc(A, col, 'rangefinder hood', (x - .2, y + s * 2.05, z + .8), (.55, .3, .5), 'naval'))
        parts.append(kit.part('rod', A, col, 'objective', (x + .08, y + s * 2.05, z + .8), (x + .12, y + s * 2.05, z + .8), .13, 'glass', vertices=12))
    for dy in (-.6, 0, .6):
        parts.append(kit.boxc(A, col, 'sight port', (x + 1.6, y + dy, z + .85), (.06, .36, .26), 'glass'))
    attach(parts, yaw)


# Measured drums that stand clear of the blocks below them: the reference carries the two control drums abreast
# the funnel on round columns about 0.9 m across, down to the deck under them. {structure: column radius}
POSTED = {'deckhouse-037': .45, 'deckhouse-038': .45}


def posts(D, kit):
    col = kit.collections['Superstructure']
    for s in D['structures']:
        if s['id'] not in POSTED:
            continue
        pts = [(-z, -x) for x, z in s['footprint']]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        base = s['baseY']
        floor = kit.below(cx, cy, base - .05, base - 3)
        kit.cylz(s['id'], col, 'post', (cx, cy, floor - .02), POSTED[s['id']], base - floor + .04, 'naval', 20)


# The reference's splinter-screened gun deck (JM081), one round each 25 mm triple that stands on a deck: a 0.62 m
# bulwark in three plates, open on the gun's inboard side. Plan in the gun's frame (u outward from the ship's centre
# line, or aft for the centre-line triple; v across), measured from `ship:slice pjsb010 --section y=4.6 --parts
# JM081_Gun_Deck_1#2`: the tips abreast the pivot 1.9 m either side, the corners 1.57 m out and 0.95 m either side.
GUN_DECK = [(-.10, -1.895), (1.575, -.945), (1.575, .945), (-.10, 1.895)]
GUN_DECK_HEIGHT = .62
GUN_DECK_MOUNTS = {'aa3-1': (-1, 0), 'aa3-2': (1, 0), 'aa3-4': (-1, 0), 'aa3-5': (1, 0), 'aa3-6': (-1, 0), 'aa3-7': (1, 0),
                   'aa3-8': (-1, 0), 'aa3-9': (1, 0), 'aa3-10': (0, 1)}


def gun_decks(D, kit):
    col = kit.collections['Light AA']
    for m in D['mounts']:
        if m['id'] not in GUN_DECK_MOUNTS:
            continue
        ox, oz = GUN_DECK_MOUNTS[m['id']]
        px, py, pz = m['position']
        A = m['id'] + '-gun-deck'
        # Runtime (x, z) of a plan point: u along the outward direction (ox, oz), v across it.
        pts = [(px + ox * u + oz * v, pz + oz * u + ox * v) for u, v in GUN_DECK]
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            a, b = Vector((-az, -ax, 0)), Vector((-bz, -bx, 0))
            d = (b - a).normalized() * .025
            a, b = a - d, b + d
            mid = (a + b) / 2
            foot = kit.below(mid.x, mid.y, py + .3, py)
            a.z = b.z = foot - .02 + (GUN_DECK_HEIGHT + .02) / 2
            kit.beam(A, col, 'bulwark', tuple(a), tuple(b), .05, GUN_DECK_HEIGHT + .02, 'naval')


def searchlight_towers(D, kit):
    """The two forward searchlights on the funnel stand on four-legged towers (the reference's cuts y=15.8 to 16.7: legs
    0.55 m square leaning in, 1.4 m apart across and fore and aft at their feet, joined in a solid head from 17.05 m),
    drawn in place of the two measured prisms (CLAIMED_STRUCTURES), which stay as combat volumes."""
    col = kit.collections['Superstructure']
    for s in D['structures']:
        if s['id'] not in ('deckhouse-053', 'deckhouse-054'):
            continue
        side = 1 if sum(x for x, z in s['footprint']) > 0 else -1
        y0, y1 = s['baseY'], s['baseY'] + s['height']
        head = 17.05
        # Reference-frame feet at 15.55 m and tops at 17.1 m (starboard; mirrored to port).
        for (xa, za), (xb, zb) in [((2.98, -7.36), (3.17, -7.16)), ((4.49, -7.28), (4.27, -7.10)),
                                   ((2.90, -5.86), (3.11, -6.07)), ((4.40, -5.77), (4.19, -5.99))]:
            kit.beam(s['id'], col, 'tower leg', P(side * xa, y0 - .02, za), P(side * xb, head + .05, zb), .55, .55, 'naval', (1, 0, 0))
        kit.boxc(s['id'], col, 'tower head', P(side * 3.68, (head + y1) / 2, -6.58), (1.62, 1.62, y1 - head + .02), 'naval')


def build(D, kit):
    main_director(kit)
    posts(D, kit)
    gun_decks(D, kit)
    searchlight_towers(D, kit)
    nagato_masts.pagoda(kit)
    nagato_masts.directors(kit)
    nagato_masts.mainmast(kit)
    nagato_masts.funnel(kit, D)
    nagato_boats.build(kit)
    nagato_hull.build(kit, D)
    nagato_rails.build(kit, D)
    # Glazing: windows and portholes the reference paints, seated on this model's own walls.
    kit.windows('glazing', kit.collections['Superstructure'], [r for r in WINDOWS if r[0] == 'window'])
    kit.windows('scuttles', kit.collections['Hull and decks'], [r for r in WINDOWS if r[0] == 'port'])

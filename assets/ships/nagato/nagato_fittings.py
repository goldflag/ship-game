"""Nagato fittings: mount seats, roof materials and everything the measured prisms cannot draw.

Datums are reference-frame measurements (x starboard, y up, z toward the stern) converted by `P`.
"""
import math
import bpy
from nagato_kit import P, R, ZC
import nagato_masts
import nagato_boats
import nagato_hull
import nagato_rails
from nagato_windows import WINDOWS

# Measured prisms a region draws itself (still used as supports).
CLAIMED_STRUCTURES = set()


def roof(s):
    """Roof material of a measured block: the forecastle deck block and its deck-edge sponsons are planked like the
    weather decks; every other roof is grey steel."""
    if s['id'].startswith('forecastle-'):
        return 'deck'
    return 'roof'


def tier(kit, s, rows, col):
    """An open pagoda tier drawn from its measured cuts (nagato_tiers.TIERS) in place of the solid prism: the legs and
    central tube as columns, bulwarks, windscreens and fins as thin walls, and its decks as plates."""
    obs = []
    top = roof(s)
    for y0, y1, pieces in rows:
        for p in pieces:
            if p[0] == 'c':
                _, x, z, r = p
                obs.append(kit.cylz(s['id'], col, 'column', (-z, -x, y0), r, y1 - y0, 'naval', 16))
            else:
                obs.append(kit.prism(s['id'], col, 'tier', [(-z, -x) for x, z in p[1]], y0, y1, 'naval', top_material=top))
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


def build(D, kit):
    main_director(kit)
    posts(D, kit)
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

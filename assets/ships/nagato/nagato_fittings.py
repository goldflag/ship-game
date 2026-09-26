"""Nagato fittings: mount seats, roof materials and everything the measured prisms cannot draw.

Datums are reference-frame measurements (x starboard, y up, z toward the stern) converted by `P`.
"""
import math
from nagato_kit import P, R, ZC

# Measured prisms a region draws itself (still used as supports).
CLAIMED_STRUCTURES = set()


def roof(s):
    """Roof material of a measured block: the forecastle deck block and its deck-edge sponsons are planked like the
    weather decks; every other roof is grey steel."""
    if s['id'].startswith('forecastle-'):
        return 'deck'
    return 'roof'


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
    for o in objs:
        world = o.matrix_world.copy()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()


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


def build(D, kit):
    main_director(kit)

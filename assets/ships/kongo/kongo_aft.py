"""Kongō after region: reference z +10 to the stern above the forecastle and quarterdeck.

Owns the after control tower and its director and rangefinders, the aircraft deck and
catapult, the surroundings of Nos. 3 and 4 turrets and the quarterdeck's fittings.
Datums are reference-frame measurements converted by `P`.
"""
from blender_rig import radar_pivot
from kongo_kit import P

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()


def build(D, kit):
    cols = kit.cols
    masts = cols['Sensors and masts']
    boats = cols['Boats and aviation']
    deck = cols['Deck fittings']

    # ------------------------------------------------------------ after director and rangefinders
    A = 'after-director'
    x, y, z = P(0, 16.754, 13.194)
    kit.cylz(A, masts, 'barbette', (x, y, z - .02), 1.25, .45, 'naval', 32)
    moving = [kit.cylz(A, masts, 'training ring', (x, y, z + .4), 1.35, .16, 'edge', 32)]
    hood = [(x + a, y + b) for a, b in [(-1.7, -1.1), (-1.7, 1.1), (-.8, 1.5), (1.9, 1.5), (1.9, -1.5), (-.8, -1.5)]]
    moving.append(kit.prism(A, masts, 'hood', hood, z + .55, z + 2.6, 'naval', 'roof'))
    moving.append(kit.part('rod', A, masts, 'rangefinder', (x + .6, y - 2.4, z + 2.0), (x + .6, y + 2.4, z + 2.0), .24, 'naval', vertices=16))
    for s in (-1, 1):
        moving.append(kit.part('box', A, masts, 'rangefinder hood', (x + .6, y + s * 2.35, z + 2.0), (.7, .55, .7), 'naval'))
    radar_pivot('after-director.yaw', (x, y, z + .4), moving)
    for id, ref in [('rf-after-port', (-2.626, 15.501, 16.276)), ('rf-after-starboard', (2.607, 15.501, 16.276))]:
        kit.rangefinder(id, ref, 4.8, 180, masts)

    # ------------------------------------------------------------ catapult on the aircraft deck
    A = 'catapult'
    x, y, z = P(0, 6.618, 50.157)
    kit.cylz(A, boats, 'turntable', (x, y, z), 1.8, .35, 'naval', 40)
    kit.cylz(A, boats, 'pivot', (x, y, z + .35), .9, .5, 'edge', 24)
    kit.lattice(A, boats, P(0, 7.55, 57.1), P(0, 7.55, 37.4), 1.1, .9, 16, .07, .04)
    kit.part('box', A, boats, 'launching carriage', P(0, 8.2, 54.6), (2.2, 1.3, .3), 'naval')
    for dz in (-4.0, 4.0):
        kit.part('rod', A, boats, 'support leg', P(0, 7.1, 50.157 + dz), P(0, 6.95, 50.157 + dz * .4), .12, 'naval', vertices=8)

    # ------------------------------------------------------------ after boats and quarterdeck fittings
    kit.boat('cutter-3', (-9.71, 4.52, 46.46), 9.2, 2.45, boats)
    kit.boat('cutter-4', (9.44, 4.52, 46.44), 9.2, 2.45, boats)
    kit.cylz('capstan-aft', deck, 'capstan', P(0, 4.36, 78.28), .5, .6, 'edge', 16)

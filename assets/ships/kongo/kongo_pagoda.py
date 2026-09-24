"""Kongō pagoda foremast region: reference z -48 to -20 above the forecastle deck.

Owns the pagoda's visual detail, its directors, rangefinders, searchlights, AA tubs'
surroundings and the pole mast. Datums are reference-frame measurements converted by `P`.
"""
import math
from blender_rig import radar_pivot
from kongo_kit import P

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()


def build(D, kit):
    masts = kit.cols['Sensors and masts']

    # ------------------------------------------------------------ pagoda top: main director and pole mast
    A = 'main-director'
    x, y, z = P(0, 32.87, -29.98)
    kit.cylz(A, masts, 'barbette', (x, y, z - .02), 1.35, .5, 'naval', 32)
    moving = [kit.cylz(A, masts, 'training ring', (x, y, z + .45), 1.45, .18, 'edge', 32)]
    hood = [(x + a, y + b) for a, b in [(1.9, -1.2), (1.9, 1.2), (.9, 1.6), (-2.3, 1.6), (-2.3, -1.6), (.9, -1.6)]]
    moving.append(kit.prism(A, masts, 'hood', hood, z + .6, z + 2.9, 'naval', 'roof'))
    moving.append(kit.part('rod', A, masts, 'rangefinder', (x - .8, y - 5.2, z + 2.2), (x - .8, y + 5.2, z + 2.2), .32, 'naval', vertices=16))
    for s in (-1, 1):
        moving.append(kit.part('box', A, masts, 'rangefinder hood', (x - .8, y + s * 5.05, z + 2.2), (.9, .7, .95), 'naval'))
        moving.append(kit.part('box', A, masts, 'objective', (x - .33, y + s * 5.05, z + 2.25), (.05, .44, .34), 'glass'))
    for dy in (-.8, 0, .8):
        moving.append(kit.part('box', A, masts, 'sight port', (x + 1.92, y + dy, z + 2.25), (.04, .42, .3), 'glass'))
    radar_pivot('main-director.yaw', (x, y, z + .45), moving)
    kit.part('rod', 'pagoda-mast', masts, 'pole', P(0, 35.4, -30.9), P(0, 43.0, -30.9), .12, 'black', vertices=10, r2=.07)
    kit.part('rod', 'pagoda-mast', masts, 'yard', P(-3.6, 38.8, -30.9), P(3.6, 38.8, -30.9), .06, 'black', vertices=8)

    # ------------------------------------------------------------ rangefinders on the pagoda
    for id, ref, width, bearing in [('rf-pagoda-port', (-2.831, 21.65, -36.311), 1.5, 0), ('rf-pagoda-starboard', (2.832, 21.65, -36.299), 1.5, 0),
                                    ('rf-secondary-port', (-4.453, 23.964, -27.489), 4.5, -90), ('rf-secondary-starboard', (4.44, 23.964, -27.489), 4.5, 90)]:
        kit.rangefinder(id, ref, width, bearing, masts)

    # ------------------------------------------------------------ high-angle directors on the pagoda wings
    for id, rx in [('ha-director-port', -6.0), ('ha-director-starboard', 6.03)]:
        x, y, z = P(rx, 15.26, -27.946)
        kit.cylz(id, masts, 'seat', (x, y, z), 1.05, .3, 'naval', 24)
        s = 1 if rx < 0 else -1
        house = [(x + a, y + s * b) for a, b in [(-1.9, -.8), (1.6, -.8), (2.1, -.2), (2.1, 1.25), (-1.9, 1.25)]]
        kit.prism(id, masts, 'housing', house, z + .3, z + 2.5, 'naval', 'roof')
        kit.part('rod', id, masts, 'rangefinder', (x - .2, y - s * .9, z + 2.1), (x - .2, y + s * 1.9, z + 2.1), .15, 'naval', vertices=12)
        for dx in (-1.2, -.4, .4, 1.2):
            kit.part('box', id, masts, 'window', (x + dx, y + s * 1.27, z + 1.8), (.5, .04, .4), 'glass')

    # ------------------------------------------------------------ searchlights
    for i, ref in enumerate([(5.08, 20.75, -27.54), (-5.08, 20.75, -27.54), (2.65, 18.01, -26.29), (-2.65, 18.01, -26.29),
                             (5.9, 12.85, -21.58), (-5.9, 12.85, -21.58)], 1):
        kit.searchlight(f'searchlight-{i}', ref, masts)

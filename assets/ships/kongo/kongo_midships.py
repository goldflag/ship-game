"""Kongō midships region: reference z -20 to +10 above the forecastle deck.

Owns the funnels' detail, the tripod mainmast, topmast and derrick, the boat cranes,
boats and their stowage, the searchlight towers and the 01 deckhouse between the pagoda
and the after superstructure. Datums are reference-frame measurements converted by `P`.
"""
from kongo_kit import P

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()


def build(D, kit):
    cols = kit.cols
    masts = cols['Sensors and masts']
    boats = cols['Boats and aviation']

    # ------------------------------------------------------------ funnels
    for f in D['structures']:
        if not f['id'].endswith('funnel'):
            continue
        xs = [p[0] for p in f['footprint']]
        zs = [p[1] for p in f['footprint']]
        half, length = (max(xs) - min(xs)) / 2, max(zs) - min(zs)
        cx = -(min(zs) + max(zs)) / 2
        base, top = f['baseY'], f['baseY'] + f['height']
        col = cols['Superstructure']
        pts = [(cx + a, b) for a, b in kit.stadium(half + .025, length + .05, 40)]
        # Black cap band over the upper 2.2 m, a rolled rim and the funnel-top grating and rain caps.
        kit.prism(f['id'], col, 'black cap', pts, top - 2.2, top + .01, 'black')
        rim = [(cx + a, b) for a, b in kit.stadium(half + .09, length + .18, 40)]
        kit.prism(f['id'], col, 'rim', rim, top - .12, top + .04, 'black')
        inner = [(cx + a, b) for a, b in kit.stadium(half - .2, length - .4, 36)]
        kit.prism(f['id'], col, 'cap coaming', inner, top, top + .55, 'black')
        for i in range(-5, 6):
            kit.part('rod', f['id'], col, 'grating bar', (cx + i * length * .085, -(half - .25), top + .5), (cx + i * length * .085, half - .25, top + .5), .03, 'black', vertices=5)
        for dx in (-length * .22, length * .22):
            kit.cylz(f['id'], col, 'rain cap post', (cx + dx, 0, top + .5), .08, .45, 'black', 8)
            kit.part('box', f['id'], col, 'rain cap', (cx + dx, 0, top + 1.0), (.5, .9, .12), 'black')
        # Steam pipes up the after face and two raised bands.
        for dy in (-.7, .7):
            kit.part('rod', f['id'], col, 'steam pipe', (cx - length / 2 - .12, dy, base + 1.0), (cx - length / 2 - .12, dy, top + .6), .09, 'naval', vertices=10)
        for zz in (base + 4.5, base + 8.2):
            kit.prism(f['id'], col, 'band', [(cx + a, b) for a, b in kit.stadium(half + .05, length + .1, 40)], zz, zz + .1, 'naval')

    # ------------------------------------------------------------ mainmast, topmast and derrick
    A = 'mainmast'
    foot = P(0, 8.8, 1.66)
    head = P(0, 31.2, 1.66)
    kit.part('rod', A, masts, 'pole', foot, P(0, 21.5, 1.66), .44, 'naval', vertices=20)
    kit.part('rod', A, masts, 'pole black', P(0, 21.5, 1.66), head, .44, 'black', vertices=20)
    for s in (-1, 1):
        f0 = P(s * 5.05, 8.8, 6.5)
        f1 = P(s * 0.25, 30.4, 1.95)
        mid = P(s * 1.02, 26.0, 3.05)
        kit.part('rod', A, masts, 'strut', f0, mid, .36, 'naval', vertices=16, r2=.34)
        kit.part('rod', A, masts, 'strut black', mid, f1, .34, 'black', vertices=16, r2=.3)
    kit.part('rod', A, masts, 'topmast', P(0, 31.0, 0.71), P(0, 40.7, 0.71), .07, 'black', vertices=10, r2=.05)
    kit.part('box', A, masts, 'masthead platform', P(0, 31.25, 1.4), (2.2, 1.6, .12), 'black')
    kit.part('rod', A, masts, 'yard', P(-3.2, 34.2, 0.71), P(3.2, 34.2, 0.71), .06, 'black', vertices=8)
    kit.cylz(A, masts, 'day light', P(0, 40.7, 0.71), .16, .7, 'black', 12)
    kit.part('rod', A, masts, 'gaff', P(0, 36.8, 0.71), P(0, 38.2, 4.4), .05, 'black', vertices=8)
    # Derrick boom stepped at the mast foot, topped forward over the boat stowage.
    kit.part('rod', 'derrick', masts, 'boom', P(0, 13.6, 0.9), P(0, 27.6, -4.2), .24, 'black', vertices=14, r2=.14)
    kit.cylz('derrick', masts, 'gooseneck', P(0, 13.0, 1.0), .35, .8, 'naval', 16)
    kit.wire('derrick', masts, P(0, 27.6, -4.2), P(0, 30.4, 1.2), .03, check=False)
    kit.wire('derrick', masts, P(0, 27.6, -4.2), P(0, 14.2, -4.4), .02, check=False)

    # ------------------------------------------------------------ searchlights on the funnel platforms
    for i, ref in enumerate([(2.8, 14.81, -4.16), (-2.8, 14.81, -4.16), (1.89, 16.88, -13.72), (-1.89, 16.88, -13.72)], 7):
        kit.searchlight(f'searchlight-{i}', ref, masts)

    # ------------------------------------------------------------ boats and their cradles
    kit.boat('motor-boat-port', (-5.17, 8.8, -12.82), 15.3, 2.95, boats, cabin=True)
    kit.boat('motor-boat-starboard', (5.18, 8.8, -12.82), 15.3, 2.95, boats, cabin=True)
    kit.boat('launch-port', (-9.34, 6.74, -11.37), 12.4, 3.2, boats, cabin=True)
    kit.boat('launch-starboard', (9.35, 6.74, -11.37), 12.4, 3.2, boats, cabin=True)
    kit.boat('cutter-1', (-9.61, 6.77, 8.04), 9.2, 2.45, boats)
    kit.boat('cutter-2', (9.61, 6.77, 8.04), 9.2, 2.45, boats)

    # ------------------------------------------------------------ boat cranes beside the forward funnel
    for id, rx in [('crane-port', -12.9), ('crane-starboard', 12.9)]:
        x, y, z = P(rx * .74, 4.76, -11.6)
        floor = kit.support.below(x, y, 8.0)
        kit.cylz(id, boats, 'post', (x, y, floor), .38, 13.6 - floor, 'naval', 18)
        kit.lattice(id, boats, (x, y, 12.8), P(rx, 12.6, -15.7), .5, .55, 6)
        kit.part('rod', id, boats, 'hoist wire', P(rx, 12.6, -15.7), P(rx, 8.2, -15.7), .02, 'edge', vertices=5)
        kit.part('box', id, boats, 'winch house', (x, y, floor + .5), (1.4, 1.2, 1.0), 'naval')

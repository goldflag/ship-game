"""Deck-edge and gallery fittings, executed in build.py's scope after details.py.

Placed by comparison with GameModels3D pasa518 where the 1942 ship had the same fitting:
floater-net baskets under the gallery edges, ready-service boxes by the 20 mm guns, fire hose
racks and extinguishers on the gallery walls, bollards and chocks on the forecastle and
quarterdeck, and stockless anchors hanging at the hawse pipes."""

def build_fittings():
    g = Kit('Gallery fittings', COL['Hangar and galleries'], 'gallery-fittings')
    for sign in [-1, 1]:
        # Open AA galleries of 1942: floater nets under the outer edge, ready boxes between guns.
        for a, b, yedge in [(-69, -34, 14.2), (31, 67, 14.2), (-121, -109, 13.1)]:
            outer = yedge + .82
            guns = [-m['position'][2] for m in D['mounts'] if 'oerlikon' in m['partId'] and
                    a - .5 <= -m['position'][2] <= b + .5 and m['position'][0] * -sign > 0]
            for x in [a + 2.5 + i * 7.5 for i in range(int((b - a - 2) / 7.5) + 1)]:
                if x + 1.1 > b: continue
                floater_basket(g, x, sign * (outer + .26), 15.56 - .62, 2.1, 0)
                for dx in [-.7, .7]:
                    g.rod((x + dx, sign * outer, 15.56), (x + dx, sign * (outer + .5), 15.56 - .6), .03, 'naval', 5)
            for x in guns[:-1]:
                if b - a > 20: ready_box(g, x + 2.5, sign * (yedge - .62), 15.79, 0)
        # Fire hose racks and extinguishers along the gallery walls, above the boats.
        for x in [-83.5, -61.5, -38.5, -16.5, 6.5, 27.5, 49.5, 70.0]:
            hose_rack(g, x, sign * 10.2, 15.2, (0, sign))
            extinguisher(g, x + .9, sign * 10.2, 14.35, (0, sign))
    g.emit()
    d = Kit('Deck edge fittings', COL['Deck equipment'], 'deck-edge-fittings')
    for sign in [-1, 1]:
        # Forecastle: bollards inboard of the flare, open chocks at the deck edge.
        for x, off in [(98.0, 2.0), (106.5, 1.7), (113.0, 1.3)]:
            z = interpolate(H['deckHeights'], x + H['length'] / 2)
            w = loft_width(x, z - .05)
            bollard(d, x, sign * (w - off), z, 0)
            chock(d, x + 2.2, sign * (loft_width(x + 2.2, z - .05) - .3), z, 0)
        # Quarterdeck.
        for x, off in [(-112.0, 1.9), (-118.5, 1.5)]:
            z = interpolate(H['deckHeights'], x + H['length'] / 2)
            w = loft_width(x, z - .05)
            bollard(d, x, sign * (w - off), z, 0)
            chock(d, x - 2.0, sign * (loft_width(x - 2.0, z - .05) - .3), z, 0)
        # Stockless anchors lying against the flared bow below the hawse pipes.
        x, zt = 116.0, 9.3
        wt = loft_width(x, zt); wb = loft_width(x - .35, zt - 2.2)
        top = (x, sign * (wt + .12), zt); bottom = (x - .35, sign * (wb + .3), zt - 2.2)
        rod('Anchor hawse collar', (x, sign * (wt - .1), zt + .05), (x, sign * (wt + .18), zt + .05), .21, M['naval'], COL['Deck equipment'], vertices=10)
        anchor(d, top, bottom, (1, sign * (loft_width(x + .5, zt - 1) - loft_width(x - .5, zt - 1)), 0))
    d.emit()

build_fittings()

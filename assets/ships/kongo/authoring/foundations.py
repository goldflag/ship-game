"""Original stepped deckhouses connecting the three superstructure groups.

Blender metres. Roof levels follow the retained mount seats; the footprints
are original constructions from the approved overview and quarter views.
"""

def mirrored(port):
    return port + [(x, -y) for x, y in reversed(port)]

BRIDGE = mirrored([(22.99, -4.2), (24.5, -5.6), (30.0, -5.6),
    (31.8, -8.6), (40.1, -8.6), (41.6, -5.25), (49.0, -5.25),
    (52.75, -3.3)])
FORWARD_UPTAKE = mirrored([(-1.0, -6.4), (2.0, -8.5), (6.0, -9.52),
    (20.0, -9.52), (23.6, -6.0)])
AFTER_UPTAKE = mirrored([(-18.05, -2.65), (-15.8, -5.0), (-9.5, -6.2),
    (-1.0, -6.2), (3.86, -4.5)])

def create(h, mats):
    h['prism']('foundation.bridge', BRIDGE, 7.28, 8.44)
    h['prism']('uptakes.deckhouse', FORWARD_UPTAKE, 7.28, 7.75)
    h['prism']('aftertower.foot', AFTER_UPTAKE, 7.28, 9.0)

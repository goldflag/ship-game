"""King George V superstructure blocks. Rewrites blueprint.json `structures` and their `obstructions`.

Tier heights and outlines were read, like a lines plan, from the approved GameModels3D pbsb107 viewing
reference (plan cuts and roof heights at its waterline; runtime frame, reference z + 0.57). No
reference mesh is read here. Outlines are symmetric: each table row gives the starboard half from
aft to forward, [x, z] with +x starboard and -z forward; the port half is mirrored. build.py draws the
funnels itself and adds galleries, wings and fittings. Idempotent; rerun after editing the table,
then refit internals if a block reaches below the deck, and ship:build.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
DECK = 4.9929          # upper deck at side amidships (author-hull.py)
SHELTER = 7.35         # raised 5.25-inch sponsons (the mounts' aprons stand on them)
BLOCK = 10.25          # forward block and after deckhouse roof (boat deck)
HANGAR = 12.0          # hangar roof abreast the fore funnel


def half(rows):
    """Starboard half [x, z] (aft to forward) -> closed symmetric outline."""
    return [[x, z] for x, z in rows] + [[-x, z] for x, z in reversed(rows) if x > 1e-9]


def side(rows, sign):
    return [[sign * x, z] for x, z in rows]


def stadium(cz, length, width, n=10):
    """Straight-sided funnel section with semicircular ends; [x, z]."""
    r = width / 2; a = length / 2 - r
    aft = [[r * math.cos(t), cz + a + r * math.sin(t)] for t in [math.pi * i / n for i in range(n + 1)]]
    fwd = [[r * math.cos(t), cz - a + r * math.sin(t)] for t in [math.pi + math.pi * i / n for i in range(n + 1)]]
    return aft + fwd


def octagon(cx, cz, wx, lz, c):
    return [[cx + wx / 2, cz + lz / 2 - c], [cx + wx / 2, cz - lz / 2 + c], [cx + wx / 2 - c, cz - lz / 2], [cx - wx / 2 + c, cz - lz / 2],
            [cx - wx / 2, cz - lz / 2 + c], [cx - wx / 2, cz + lz / 2 - c], [cx - wx / 2 + c, cz + lz / 2], [cx + wx / 2 - c, cz + lz / 2]]


# id, name, footprint [x, z], base, top, material
STRUCTURES = [
    # Forward block: main deck to the 10.25 m deck, pointed forward end.
    ('forward-shelter', 'Forward superstructure block', half([(8.8, 3.3), (8.8, -20.5), (2.0, -27.0)]), DECK, BLOCK, 'naval'),
    # Raised 5.25-inch seats; the reference's long tails are trimmed where the neighbouring mount trains over them.
    ('sponson-starboard-2', 'S2 5.25-inch sponson', side([(8.7, 3.2), (11.0, 3.25), (13.6, 2.7), (15.4, 1.0), (15.6, -1.8), (14.8, -3.8), (12.9, -4.8), (8.7, -4.8)], 1), DECK, SHELTER, 'naval'),
    ('sponson-port-2', 'P2 5.25-inch sponson', side([(8.7, -4.8), (12.9, -4.8), (14.8, -3.8), (15.6, -1.8), (15.4, 1.0), (13.6, 2.7), (11.0, 3.25), (8.7, 3.2)], -1), DECK, SHELTER, 'naval'),
    ('hangar-port', 'Port aircraft hangar roof block', [[-0.7, 3.3], [-8.9, 3.3], [-8.9, -10.8], [-0.7, -10.8]], BLOCK, HANGAR, 'naval'),
    ('hangar-starboard', 'Starboard aircraft hangar roof block', [[0.7, -10.8], [8.9, -10.8], [8.9, 3.3], [0.7, 3.3]], BLOCK, HANGAR, 'naval'),
    # Houses at the fore funnel: searchlight house abaft it, foremast house before it.
    ('searchlight-house', 'Fore funnel searchlight house', half([(3.5, 3.8), (3.5, 1.4)]), HANGAR, 17.0, 'naval'),
    ('foremast-house', 'Foremast house', half([(2.6, -4.3), (2.6, -7.2)]), HANGAR, 18.0, 'naval'),
    # Forward tower tiers.
    ('tower-base', 'Forward tower platform deck', half([(8.6, -10.9), (8.6, -20.5), (2.0, -27.0)]), BLOCK, 11.0, 'naval'),
    ('tower-middle', 'Forward tower lower levels', half([(5.1, -11.1), (5.1, -24.0), (2.0, -27.0)]), 11.0, 14.25, 'naval'),
    ('tower-lower-bridge', 'Lower bridge and wings', half([(5.1, -11.1), (5.1, -16.6), (7.0, -17.9), (7.0, -22.4), (2.1, -27.0)]), 14.25, 15.55, 'naval'),
    ('tower-admirals', 'Admiral bridge core', half([(2.1, -12.0), (2.1, -23.3), (3.9, -23.7), (3.9, -26.4), (2.8, -27.0)]), 15.55, 18.15, 'naval'),
    ('tower-upper-bridge', 'Navigating bridge level', half([(3.8, -11.3), (3.8, -12.0), (3.3, -12.2), (3.3, -16.0), (4.2, -16.2), (4.2, -24.8), (2.7, -26.0), (2.1, -28.1)]), 18.15, 20.75, 'naval'),
    ('bridge-top', 'Bridge top and director seating deck', half([(3.8, -10.8), (3.8, -12.0), (3.3, -12.2), (3.3, -15.8), (3.6, -16.2), (3.6, -20.3)]), 20.75, 21.9, 'naval'),
    ('compass-shelter', 'Navigating bridge glazed shelter', half([(3.4, -20.3), (3.4, -26.0), (2.4, -26.3), (2.4, -28.0)]), 20.75, 22.3, 'naval'),
    ('compass-platform', 'Compass platform', half([(2.0, -22.9), (2.0, -27.5), (1.4, -27.9)]), 22.3, 23.4, 'naval'),
    ('director-forward-base', 'Forward 14-inch director seating', octagon(0, -20.7, 3.0, 3.0, .6), 21.9, 23.27, 'naval'),
    ('hacs-forward-tower', 'Forward HACS director tower', half([(3.6, -11.9), (3.6, -14.4)]), 21.9, 25.45, 'naval'),
    ('hacs-tower-step', 'HACS tower forward step', half([(2.1, -14.4), (2.1, -16.1), (1.3, -16.3), (1.3, -17.5)]), 21.9, 23.0, 'naval'),
    # After deckhouse: main deck to the boat deck, pointed aft end.
    # Notched to 8.6 m where the P4/S4 gunhouses swing inboard.
    ('after-shelter', 'After deckhouse and boat deck', half([(2.2, 51.9), (9.0, 44.0), (9.0, 37.6), (8.6, 37.2), (8.6, 31.0), (7.6, 31.0), (7.6, 19.6)]), DECK, BLOCK, 'naval'),
    ('sponson-starboard-3', 'S3 5.25-inch sponson', side([(7.6, 27.4), (12.3, 27.4), (14.5, 26.4), (15.45, 24.0), (15.1, 21.7), (13.5, 20.2), (10.5, 19.7), (7.6, 19.9)], 1), DECK, SHELTER, 'naval'),
    ('sponson-port-3', 'P3 5.25-inch sponson', side([(7.6, 19.9), (10.5, 19.7), (13.5, 20.2), (15.1, 21.7), (15.45, 24.0), (14.5, 26.4), (12.3, 27.4), (7.6, 27.4)], -1), DECK, SHELTER, 'naval'),
    ('director-aft-base', 'After control tower', half([(3.3, 46.3), (3.95, 45.8), (3.95, 42.8), (3.3, 42.3)]), BLOCK, 14.6, 'naval'),
    ('after-tower-top', 'After tower close-range director seat', half([(1.3, 47.5), (1.3, 43.9)]), 14.6, 17.0, 'naval'),
    ('director-aft-seat', 'After 14-inch director seating', octagon(0, 50.13, 3.4, 3.4, .7), BLOCK, 12.28, 'naval'),
    # Funnel envelopes for hits; build.py draws the stacks from its own funnel table.
    ('forward-funnel', 'Forward funnel', stadium(-0.58, 6.05, 3.9), HANGAR, 23.7, 'naval'),
    ('after-funnel', 'After funnel', stadium(23.86, 6.73, 3.1), BLOCK, 23.7, 'naval'),
]


def area(fp):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(fp, fp[1:] + fp[:1])) / 2


def structures():
    out, obst = [], []
    for sid, name, fp, base, top, material in STRUCTURES:
        fp = [[round(x, 4), round(z, 4)] for x, z in fp]
        if area(fp) < 0:
            fp.reverse()
        out.append(dict(id=sid, name=name, footprint=fp, baseY=base, height=round(top - base, 4), material=material))
        xs = [p[0] for p in fp]; zs = [p[1] for p in fp]
        # Bounding proxies kept inside the visual blocks for firing clearance.
        obst.append(dict(id=sid, center=[(min(xs) + max(xs)) / 2, base + (top - base) / 2, (min(zs) + max(zs)) / 2],
                         size=[max(.2, max(xs) - min(xs) - .4), round(top - base, 4), max(.2, max(zs) - min(zs) - .4)]))
    return out, obst


if __name__ == '__main__':
    path = HERE / 'blueprint.json'
    b = json.loads(path.read_text())
    s, o = structures()
    b['structures'] = s
    b['obstructions'] = o
    path.write_text(json.dumps(b, indent=2) + '\n')
    print(f'KGV structures: {len(s)} blocks and obstruction proxies')

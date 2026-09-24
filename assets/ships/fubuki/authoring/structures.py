"""Fubuki superstructure: blueprint `structures` re-measured from the approved GameModels3D pjsd106 viewing reference
(plan outlines traced at several heights, heights from side and cross sections; funnel sections in funnels.json).
Outlines are runtime [x, z] (+x starboard, -z bow), written as the starboard half from aft to forward and mirrored.

    python3 assets/ships/fubuki/authoring/structures.py    # replaces these structures in blueprint.json by ID
"""
import json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
FUNNELS = json.loads((HERE / 'funnels.json').read_text())


def mirror(half):
    """Starboard half (aft centre ... forward centre) -> closed counter-clockwise outline seen from above."""
    pts = [tuple(p) for p in half]
    port = [(-x, z) for x, z in reversed(pts) if abs(x) > 1e-9]
    return [[round(x, 4), round(z, 4)] for x, z in pts + port]


def prism(id, name, half, base, top, material='naval'):
    return {'id': id, 'name': name, 'footprint': mirror(half), 'baseY': base, 'height': round(top - base, 4), 'material': material}


def loft(rings, cap_bottom=True, cap_top=True):
    """Closed surface through rings [(y, [[x, z]...])] of equal count; caps fan from the ring centroid."""
    n = len(rings[0][1]); vs = []; tris = []
    for y, pts in rings:
        vs += [[p[0], round(y, 4), p[1]] if len(p) == 2 else list(p) for p in pts]
    for r in range(len(rings) - 1):
        a = r * n; b = a + n
        for i in range(n):
            j = (i + 1) % n
            tris += [[a + i, b + j, a + j], [a + i, b + i, b + j]]
    for cap, r, flip in [(cap_bottom, 0, True), (cap_top, len(rings) - 1, False)]:
        if not cap: continue
        ring = vs[r * n:(r + 1) * n]
        c = [sum(p[k] for p in ring) / n for k in range(3)]
        vs.append([round(v, 4) for v in c]); ci = len(vs) - 1
        for i in range(n):
            j = (i + 1) % n
            tris.append([ci, r * n + j, r * n + i] if flip else [ci, r * n + i, r * n + j])
    return {'version': 1, 'vertices': [[round(v, 4) for v in p] for p in vs], 'triangles': tris}


# ---------------------------------------------------------------- bridge
# Lower bridge: rounded front, sides tapering aft to a rounded after end (traced at 8.0 m).
BRIDGE_LOWER = [(0, -22.16), (.74, -22.16), (1.17, -22.45), (1.44, -22.81), (1.47, -23.3), (2.01, -28.12),
                (1.62, -28.81), (1.13, -29.19), (.59, -29.43), (0, -29.43)]
# Wheelhouse (10.05-12.75 m): faceted front, pointed wings at z -26.4, sides to z -24.3, then the narrower
# chart-house core rounding to the after end (traced at 11.2-11.5 m).
WHEEL = [(0, -22.35), (.55, -22.5), (.95, -22.85), (1.2, -23.4), (1.3, -24.25), (2.2, -24.3), (2.25, -25.45), (3.05, -25.68),
         (3.42, -26.2), (3.42, -26.65), (3.05, -27.18), (2.42, -27.32), (2.25, -27.49), (2.17, -28.54), (1.71, -29.38),
         (1.13, -29.79), (.6, -30.0), (0, -30.0)]
# Its underside is chamfered at the front, meeting the lower bridge face at 10.05 m.
WHEEL_FOOT = WHEEL[:-5] + [(2.03, -28.2), (1.62, -28.85), (1.13, -29.22), (.6, -29.45), (0, -29.45)]
# Upper bridge: an open platform with bulwarks (12.75-13.6 m), pointed front (traced at 13.4 m).
BRIDGE_UPPER = [(0, -22.08), (.5, -22.2), (1.12, -22.96), (1.21, -23.6), (1.21, -24.64), (1.3, -25.0), (1.33, -25.93),
                (1.0, -26.71), (.45, -27.3), (0, -27.54)]
# Compass house at its front, windowed, roof at 14.25 m (traced at 14.0 m).
COMPASS = [(0, -25.05), (1.2, -25.05), (1.24, -25.9), (1.0, -26.55), (.45, -27.05), (.2, -27.2), (0, -27.2)]


def wheelhouse():
    s = prism('wheelhouse', 'Wheelhouse', WHEEL, 10.05, 12.75)
    s['surface'] = loft([(10.05, mirror(WHEEL_FOOT)), (10.9, mirror(WHEEL)), (12.75, mirror(WHEEL))])
    return s


# ---------------------------------------------------------------- funnels
def funnel_rings(name, top_front, top_back, band=.7):
    rings = FUNNELS[name]; rake = FUNNELS['rake']
    last = rings[-1]; y0 = last['y']; pts = last['points']
    zs = [p[1] for p in pts]; zf, zb = min(zs), max(zs)
    out = [(r['y'], r['points']) for r in rings]

    def at(fraction_below_rim):
        ring = []
        for x, z in pts:
            t = (z - zf) / (zb - zf)
            y = top_front + (top_back - top_front) * t - fraction_below_rim
            ring.append([x, round(y, 4), round(z + rake * (y - y0), 4)])
        return ring
    mid = [(y0 + 2.0, [[x, z + rake * 2.0] for x, z in pts])]
    return out + mid + [(None, at(band)), (None, at(0))]


def funnel(id, name, base_rings, top_front, top_back):
    rings = funnel_rings(id, top_front, top_back)
    rings = [r for r in rings if r[0] is None or r[0] >= base_rings]
    loft_rings = [(y if y is not None else 0, pts) for y, pts in rings]
    surface = loft(loft_rings, cap_bottom=False, cap_top=False)
    xs = [v[0] for v in surface['vertices']]; zs = [v[2] for v in surface['vertices']]; ys = [v[1] for v in surface['vertices']]
    base = min(ys); top = max(ys)
    fp = [[max(xs), min(zs)], [max(xs), max(zs)], [min(xs), max(zs)], [min(xs), min(zs)]]
    return {'id': id, 'name': name, 'footprint': [[round(a, 4), round(b, 4)] for a, b in fp], 'baseY': round(base, 4),
            'height': round(top - base, 4), 'material': 'naval', 'surface': surface}


def rrect(w, z0, z1, c=.35):
    """Starboard half of a chamfered rectangle, aft centre to forward centre (z0 forward, z1 aft)."""
    return [(0, z1), (w - c, z1), (w, z1 - c), (w, z0 + c), (w - c, z0), (0, z0)]


def block(id, name, rings):
    """Closed loft through half-outline rings [(y, half)] with equal point counts; footprint is the widest ring."""
    full = [(y, mirror(h)) for y, h in rings]
    widest = max(full, key=lambda r: max(p[0] for p in r[1]) * (max(p[1] for p in r[1]) - min(p[1] for p in r[1])))[1]
    base = rings[0][0]; top = rings[-1][0]
    return {'id': id, 'name': name, 'footprint': widest, 'baseY': base, 'height': round(top - base, 4), 'material': 'naval',
            'surface': loft(full)}


# ---------------------------------------------------------------- midships
# Torpedo deck under bank 1: a narrow rounded pedestal aft of the fore cowls widening to 2.45 m (traced at 4.2 m).
TORPEDO_DECK = [(0, -1.8), (2.1, -1.8), (2.4, -2.2), (2.45, -9.3), (1.6, -9.9), (1.05, -10.3), (.8, -11.0), (0, -11.15)]


def fore_boot():
    """The fore funnel's flared foot from the main deck into the funnel (the reference has no wider casing here)."""
    rings = FUNNELS['forward-funnel']
    r4 = rings[0]['points']; r5 = rings[1]['points']
    zs = [p[1] for p in r4]; zc = (min(zs) + max(zs)) / 2
    deck = [[round(x * 1.04, 4), round(zc + (z - zc) * 1.08, 4)] for x, z in r4]
    s = {'id': 'fore-uptake', 'name': 'Fore funnel foot', 'footprint': [[round(x, 4), round(z, 4)] for x, z in deck],
         'baseY': 3.36, 'height': round(5.0 - 3.36, 4), 'material': 'naval'}
    s['surface'] = loft([(3.36, deck), (4.0, r4), (5.0, r5)], cap_bottom=True, cap_top=False)
    return s


STRUCTURES = [
    prism('bridge-lower', 'Lower bridge', BRIDGE_LOWER, 5.38, 10.05),
    wheelhouse(),
    prism('bridge-upper', 'Upper bridge platform', BRIDGE_UPPER, 12.75, 13.6),
    prism('bridge-compass', 'Compass house', COMPASS, 13.6, 14.25),
    fore_boot(),
    funnel('forward-funnel', 'Forward Funnel', 5.0, 13.25, 12.75),
    prism('fore-torpedo-deck', 'Torpedo deck', TORPEDO_DECK, 3.36, 4.95),
    # 13 mm AA tower on the after end of the torpedo deck: sloped fore face, after face with the intake mouths;
    # the AA platform sits on its top (traced at 5.0, 6.0 and 7.0 m).
    block('aa-13-tower', '13 mm AA tower', [(4.95, rrect(2.88, -4.6, -1.8, .4)), (6.8, rrect(2.88, -3.5, -1.55, .4)),
                                            (8.0, rrect(2.3, -4.25, -1.3, .4))]),
    # After funnel casing with the reload lockers along its sides: sides sloping from 3.4 m to 2.9 m (sections at z 3, 6.5).
    block('aft-uptake', 'After funnel casing', [(3.36, rrect(3.4, -1.9, 7.4, .4)), (6.2, rrect(2.9, -1.9, 7.4, .35))]),
    # Searchlight tower rising from the casing to the searchlight platform (traced at 6.5, 7.5 and 8.2 m).
    block('searchlight-tower', 'Searchlight tower', [(6.1, rrect(1.4, 5.6, 8.2, .5)), (7.3, rrect(1.3, 5.85, 7.8, .45)),
                                                    (8.16, rrect(1.2, 5.5, 7.9, .5))]),
    # Radio house on the after platform, with its direction-finding loop (traced at 7.5 and 8.2 m).
    prism('radio-house', 'Radio house', [(0, 10.39), (.7, 10.39), (.9, 10.2), (.9, 9.48), (.6, 9.0), (0, 8.8)], 6.55, 8.75),
    funnel('after-funnel', 'After Funnel', 6.0, 13.2, 12.7),
    # After deckhouse, its sides carrying the reload lockers (traced at 4.2 and 5.3 m); tapered after end.
    # Its tapered after end stops 0.65 m short of the reference's (37.6 m, not 38.25 m) so the after gun's barrels
    # clear it at full train (150 deg) and depression.
    prism('after-deckhouse', 'After deckhouse', [(0, 37.6), (1.6, 37.6), (1.9, 37.4), (3.1, 36.0), (3.1, 28.95),
                                                 (2.75, 28.75), (0, 28.75)], 3.36, 5.54),
    # Step under the upper after AA platform (traced at 5.9 m); the plated platform above is 2.5 m either side.
    prism('aft-aa-upper-step', 'After AA step', [(0, 32.7), (1.4, 32.7), (1.7, 32.2), (1.7, 29.9), (0, 29.9)], 5.54, 6.02),
]


def apply(b):
    by_id = {s['id']: s for s in STRUCTURES}
    out = []
    for s in b['structures']:
        out.append(by_id.pop(s['id'], s))
    out += by_id.values()
    b['structures'] = out
    return b


if __name__ == '__main__':
    path = HERE.parent / 'blueprint.json'
    b = apply(json.loads(path.read_text()))
    path.write_text(json.dumps(b, indent=2) + '\n')
    print('\n'.join(f"{s['id']}: {s['baseY']}..{round(s['baseY'] + s['height'], 3)}" for s in b['structures']))

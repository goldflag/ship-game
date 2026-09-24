"""Write the bridge, funnel and uptake structures into the blueprint.

Outlines and heights were measured (plan slices and horizontal cuts, runtime frame, bow -Z) on the
approved GameModels3D pjsd718 viewing reference; this helper reads no reference mesh. Only the
structure records named below change; every other record in `blueprint.json` is kept.

    python3 assets/ships/yukikaze/authoring/structures.py
"""
import json, math
from pathlib import Path

DIR = Path(__file__).resolve().parents[1]


def js(o):
    if isinstance(o, dict): return {k: js(v) for k, v in o.items()}
    if isinstance(o, list): return [js(v) for v in o]
    if isinstance(o, float): return int(o) if o.is_integer() else o
    return o


def mirror(half):
    """Starboard half [(x, z)] from the bow aft (x >= 0) -> closed footprint, starboard then port."""
    right = [(x, z) for x, z in half]
    left = [(-x, z) for x, z in reversed(half) if x > 1e-9]
    ring = right + left
    if half[0][0] > 1e-9: ring = [(0, half[0][1])] + ring
    return [[round(x, 4), round(z, 4)] for x, z in ring]


def loft(rings, closed=True):
    """Closed solid through rings [[(x, y, z), ...]] of equal point count, capped with centre fans."""
    n = len(rings[0]); vs = [list(map(lambda v: round(v, 4), p)) for r in rings for p in r]; tri = []
    for r in range(len(rings) - 1):
        a, b = r * n, (r + 1) * n
        for i in range(n):
            j = (i + 1) % n
            tri += [[a + i, a + j, b + j], [a + i, b + j, b + i]]
    if closed:
        for r, flip in [(0, True), (len(rings) - 1, False)]:
            c = len(vs); ring = rings[r]
            vs.append([round(sum(p[k] for p in ring) / n, 4) for k in range(3)])
            for i in range(n):
                j = (i + 1) % n
                tri.append([c, r * n + j, r * n + i] if flip else [c, r * n + i, r * n + j])
    return {'vertices': vs, 'triangles': tri}


def prism_rings(footprint, levels):
    """Rings of a footprint at [(y, inset)] levels; inset pulls each point toward the centroid."""
    cx = sum(p[0] for p in footprint) / len(footprint); cz = sum(p[1] for p in footprint) / len(footprint)
    rings = []
    for y, inset in levels:
        ring = []
        for x, z in footprint:
            dx, dz = x - cx, z - cz; d = math.hypot(dx, dz) or 1
            ring.append((x - dx / d * inset, y, z - dz / d * inset))
        rings.append(ring)
    return rings


def ellipse(cz, a, b, y, n=64, top=None):
    """Funnel ring in runtime coordinates: +cos toward the bow (-Z); top=(mid, rise) slants y."""
    ring = []
    for i in range(n):
        t = i * math.tau / n
        yy = y if top is None else top[0] + top[1] * math.cos(t)
        ring.append((b * math.sin(t), yy, cz - a * math.cos(t)))
    return ring


# ---------------------------------------------------------------- bridge
bridge_lower = mirror([(0, -29.42), (.55, -29.4), (1.05, -29.34), (1.5, -29.12), (1.8, -28.82), (1.96, -28.5),
                       (2.0, -27.9), (2.02, -24.05)])
bridge_middle = mirror([(0, -29.45), (1.01, -29.37), (1.49, -29.13), (1.87, -28.63), (2.0, -28.2), (2.0, -24.05)])
compass = mirror([(0, -29.66), (.85, -29.6), (1.57, -29.23), (1.95, -28.73), (2.07, -27.33), (2.6, -26.97),
                  (2.63, -25.77), (3.05, -25.5), (3.12, -25.25), (2.95, -24.2), (2.37, -24.03)])
# The after bridge block ends 2.9 m abaft the break; the mast trestle stands on open platforms behind it.
after_block = mirror([(0, -24.07), (1.62, -24.07), (1.62, -21.2), (0, -21.2)])
director = [[1.09, -26.39], [-1.09, -26.39]] + [[round(-1.09 * math.cos(math.pi * i / 12), 4), round(-25.14 + 1.09 * math.sin(math.pi * i / 12), 4)] for i in range(13)]
director = [p for i, p in enumerate(director) if p not in director[:i]]


def shape(id, name, footprint, base, top, material='naval', surface=None):
    d = {'id': id, 'name': name, 'footprint': footprint, 'baseY': base, 'height': round(top - base, 4), 'material': material}
    if surface: d['surface'] = surface
    return d


structures = {
    'bridge-lower': shape('bridge-lower', 'Bridge Lower', bridge_lower, 4.72, 7.16),
    'bridge-middle': shape('bridge-middle', 'Bridge Middle', bridge_middle, 7.16, 8.85),
    'wheelhouse': shape('wheelhouse', 'Wheelhouse', compass, 8.85, 10.78,
                        surface=loft(prism_rings([tuple(p) for p in compass], [(8.85, .2), (9.3, 0), (10.72, 0), (10.78, 0)]))),
    'director-house': shape('director-house', 'Director House', director, 10.78, 12.41),
    'bridge-after': shape('bridge-after', 'Bridge After', after_block, 6.73, 8.85),
}

# ---------------------------------------------------------------- funnels
# Fore funnel: a 3.9 m by 2.2 m oval barrel, centre 13.85 m forward of midships at its 3.85 m base and
# raked 0.1 m; its mouth slopes down aft from 12.03 m to 10.52 m.
F = dict(cz=-13.85, base=3.85, top=11.27, rake=.1, a=1.95, b=1.1, rise=.755)
fc = lambda y: F['cz'] + F['rake'] * (y - F['base']) / (F['top'] - F['base'])
# Rings 3 and 4 run parallel to the sloping mouth, so the dark cap band above ring 4 is 1 m deep all round.
fore = loft([ellipse(fc(3.85), 2.35, 1.45, 3.85), ellipse(fc(4.6), 2.2, 1.28, 4.6), ellipse(fc(5.4), 2.02, 1.13, 5.4),
             ellipse(fc(10.17), F['a'], F['b'], None, top=(F['top'] - 1.1, F['rise'])),
             ellipse(fc(10.27), F['a'] * 1.035, F['b'] * 1.035, None, top=(F['top'] - 1.0, F['rise'])),
             ellipse(fc(F['top']), F['a'] * 1.035, F['b'] * 1.035, None, top=(F['top'], F['rise']))], closed=False)
# After funnel: 2.9 m by 2.1 m at its foot tapering to 2.8 m at the mouth, centre 1.6 m aft of
# midships at 5.64 m and 1.9 m at the mouth, which slopes down aft from 10.66 m to 9.94 m.
A = dict(cz=1.6, base=5.64, top=10.3, rake=-.3, a=1.36, b=1.03, rise=.36)
ac = lambda y: A['cz'] - A['rake'] * (y - A['base']) / (A['top'] - A['base'])
after = loft([ellipse(ac(5.64), 1.62, 1.2, 5.64), ellipse(ac(5.96), 1.52, 1.12, 5.96), ellipse(ac(6.79), 1.45, 1.05, 6.79),
              ellipse(ac(9.2), A['a'], A['b'], None, top=(A['top'] - 1.1, A['rise'])),
              ellipse(ac(9.3), A['a'] * 1.035, A['b'] * 1.035, None, top=(A['top'] - 1.0, A['rise'])),
              ellipse(ac(A['top']), A['a'] * 1.035, A['b'] * 1.035, None, top=(A['top'], A['rise']))], closed=False)
structures['forward-funnel'] = dict(shape('forward-funnel', 'Forward Funnel', [[-1.14, -11.8], [-1.14, -15.9], [1.14, -15.9], [1.14, -11.8]],
                                          3.85, 12.05, surface=fore), exhaust={'position': [0, 11.27, -13.75], 'width': 2.4, 'length': 2.9})
structures['after-funnel'] = dict(shape('after-funnel', 'After Funnel', [[-1.1, 3.25], [-1.1, .1], [1.1, .1], [1.1, 3.25]],
                                        5.64, 10.67, surface=after), exhaust={'position': [0, 10.3, 1.9], 'width': 2.3, 'length': 2.6})
# Fore funnel casing: the uptake and the torpedo reload lockers either side of it form one housing,
# 3.7 m either side at its forward end and 2.5 m at its after end, 4.95 m high.
# Below 3.8 m only the two locker blocks stand on the deck, with an open passage between them.
structures['forward-uptake'] = shape('forward-uptake', 'Forward Uptake', mirror([(0, -19.75), (1.33, -19.75), (2.45, -19.8), (3.45, -19.65),
    (3.72, -18.7), (2.47, -10.6), (2.75, -10.15), (2.5, -9.9), (1.0, -10.1), (0, -10.2)]), 3.8, 4.95)
locker = [(2.45, -19.81), (3.37, -19.69), (3.47, -19.59), (3.43, -17.11), (2.87, -13.47), (2.63, -13.19), (2.55, -12.63), (2.45, -12.53),
          (1.89, -12.45), (1.79, -12.55), (1.75, -13.47), (1.79, -19.39), (2.29, -19.49)]
for side, sign in [('starboard', 1), ('port', -1)]:
    ring = [[round(sign * x, 4), z] for x, z in locker]
    if sign < 0: ring.reverse()
    structures['torpedo-lockers-' + side] = shape('torpedo-lockers-' + side, 'Torpedo reload lockers ' + side, ring, 2.77, 3.8)
# The raised torpedo working deck now ends against the casing's after face.
structures['torpedo-working-deck'] = shape('torpedo-working-deck', 'Raised torpedo working deck', [[1.05, 4.3], [2.52, .1], [2.55, -3.6], [2.78, -5.8],
    [2.55, -7.4], [2.48, -10.0], [-2.48, -10.0], [-2.55, -7.4], [-2.78, -5.8], [-2.55, -3.6], [-2.52, .1], [-1.05, 4.3]], 2.76, 3.697)
# After deckhouse: a low forward part (4.2 m) round the mainmast and the full-height after part
# (5.05 m) carrying No. 2 mount, 3.16 m either side and rounded aft.
structures['after-deckhouse-forward'] = shape('after-deckhouse-forward', 'After Deckhouse Forward',
    mirror([(0, 16.93), (2.06, 16.68), (2.34, 17.16), (2.96, 17.28), (3.16, 17.44), (3.16, 23.5), (0, 23.5)]), 2.75, 4.2)
structures['after-deckhouse'] = shape('after-deckhouse', 'After Deckhouse',
    mirror([(0, 23.5), (3.16, 23.5), (3.16, 26.98), (1.96, 30.7), (1.72, 31.1), (1.18, 31.68), (.82, 31.84), (.5, 31.92), (0, 31.92)]), 2.75, 5.05)
structures['after-uptake'] = shape('after-uptake', 'After Uptake', mirror([(0, -.22), (1.1, -.22), (1.55, .25), (1.55, 3.2), (1.1, 3.67), (0, 3.67)]), 2.74, 5.8)

path = DIR / 'blueprint.json'
bp = json.loads(path.read_text())
seen = set()
for i, s in enumerate(bp['structures']):
    if s['id'] in structures:
        new = structures[s['id']]; keep = {k: v for k, v in s.items() if k not in new and k not in ('surface', 'exhaust')}
        bp['structures'][i] = {**{k: new[k] for k in ['id', 'name']}, **{k: v for k, v in new.items() if k not in ('id', 'name')}, **keep}
        seen.add(s['id'])
# New records go in after the record they extend.
for sid, after_id in [('after-deckhouse-forward', 'after-deckhouse'), ('torpedo-lockers-starboard', 'forward-uptake'), ('torpedo-lockers-port', 'forward-uptake')]:
    if sid not in seen:
        k = next(i for i, s in enumerate(bp['structures']) if s['id'] == after_id)
        bp['structures'].insert(k, structures[sid]); seen.add(sid)
missing = set(structures) - seen
if missing: raise SystemExit(f'unknown structures {sorted(missing)}')
path.write_text(json.dumps(js(bp), indent=2, ensure_ascii=False) + '\n')
print('structures written:', ', '.join(sorted(seen)))

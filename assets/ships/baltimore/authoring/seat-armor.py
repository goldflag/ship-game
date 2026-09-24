"""Re-seat the retained protection surfaces on the current hull and mounts, keeping every plate's ID, extent
and thickness:

- belt plates: each vertex moves across to the shell half-breadth at its own height and station;
- armoured transverse bulkheads: their half-width becomes the narrowest shell half-breadth over the belt band;
- barbette rings: centred on their turret, from the protective deck to the mount's seat.

    python3 assets/ships/baltimore/authoring/seat-armor.py
"""
import json, math
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'blueprint.json'
b = json.loads(path.read_text())
H = b['hull']; L = H['length']; S = H['sections']


def section(station):
    i = next((k for k, s in enumerate(S) if s['station'] >= station), len(S) - 1)
    i = max(1, i)
    a, c = S[i - 1], S[i]
    t = (station - a['station']) / (c['station'] - a['station'])
    return [[p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] for p, q in zip(a['points'], c['points'])]


def half_breadth(z, y):
    """The shell half-breadth at runtime z and height y, as hull.rs interpolates it."""
    pts = section(L / 2 - z)
    w = 0.0
    for (aw, ay), (bw, by) in zip(pts, pts[1:]):
        if ay - 1e-7 <= y <= by + 1e-7:
            w = max(w, max(aw, bw) if by - ay < 1e-7 else aw + (bw - aw) * (y - ay) / (by - ay))
    return w


def bounds(plate):
    vs = plate['vertices']
    lo = [min(v[i] for v in vs) for i in range(3)]; hi = [max(v[i] for v in vs) for i in range(3)]
    return [(l + h) / 2 for l, h in zip(lo, hi)], [max(.001, h - l) for l, h in zip(lo, hi)]


mounts = {m['id']: m for m in b['mounts']}
for a in b['armor']:
    p = a.get('plate')
    if not p:
        continue
    if a['id'].startswith('belt'):
        for v in p['vertices']:
            v[0] = math.copysign(half_breadth(v[2], v[1]), v[0])
        if len(p['vertices']) > 3:
            # a quadrilateral plate stays planar: one half-breadth per edge height, averaged along it
            for y in {v[1] for v in p['vertices']}:
                edge = [v for v in p['vertices'] if v[1] == y]
                x = sum(v[0] for v in edge) / len(edge)
                for v in edge:
                    v[0] = x
    elif a['id'].startswith('citadel-'):
        z = p['vertices'][0][2]; ys = [v[1] for v in p['vertices']]
        w = min(half_breadth(z, y) for y in [min(ys) + (max(ys) - min(ys)) * k / 10 for k in range(11)]) - .01
        for v in p['vertices']:
            v[0] = math.copysign(w, v[0])
    elif '-barbette-' in a['id']:
        # every ring plate spans the protective deck to the seat; its corners keep their bearing and radius
        m = mounts[a['id'].split('-barbette-')[0]]
        base = min(v[1] for v in p['vertices'])
        for v in p['vertices']:
            v[1] = base if abs(v[1] - base) < 1e-6 else m['position'][1]
    else:
        continue
    a['center'], a['size'] = bounds(p)

# Barbette rings: translate each turret's 20 plates so their ring centre sits under the mount.
for mid, m in mounts.items():
    plates = [a for a in b['armor'] if a['id'].startswith(mid + '-barbette-')]
    if not plates:
        continue
    vs = [v for a in plates for v in a['plate']['vertices']]
    cx = (max(v[0] for v in vs) + min(v[0] for v in vs)) / 2; cz = (max(v[2] for v in vs) + min(v[2] for v in vs)) / 2
    dx, dz = m['position'][0] - cx, m['position'][2] - cz
    for a in plates:
        for v in a['plate']['vertices']:
            v[0] += dx; v[2] += dz
        a['center'], a['size'] = bounds(a['plate'])


def js(o):
    return {k: js(v) for k, v in o.items()} if isinstance(o, dict) else [js(v) for v in o] if isinstance(o, list) else int(o) if isinstance(o, float) and o.is_integer() else o


path.write_text(json.dumps(js(b), indent=2, ensure_ascii=False) + '\n')
print('re-seated', sum(1 for a in b['armor'] if 'plate' in a), 'plates')

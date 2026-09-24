"""Re-seat the retained protection surfaces on the current hull and mounts, keeping every plate's ID, extent
and thickness:

- belt plates: each vertex moves across to the shell half-breadth at its own height and station;
- armoured transverse bulkheads: their half-width becomes the narrowest shell half-breadth over the belt band;
- barbette rings: centred on their turret, from the protective deck to the mount's seat;
- the protective deck: a convex plate following the shell at its height between the bulkheads;
- the retained rooms and their modules below the deck: bottoms raised and ends drawn in until every corner
  lies inside the shell (their tops and IDs unchanged). Rerun flood spaces and stability afterwards.

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
    elif a['id'] == 'armored-deck':
        # The protective deck follows the shell at its own height between the armoured bulkheads.
        y = p['vertices'][0][1]; zs = [-64.5, -45, -22, 0, 22, 45, 64.5]
        zs = [z for z in zs if abs(z) <= max(abs(v[2]) for v in p['vertices'])]
        w = {z: half_breadth(z, y) - .05 for z in zs}
        right = [[w[z], y, z] for z in sorted(zs, reverse=True)]
        left = [[-w[z], y, z] for z in sorted(zs)]
        verts = [left[-1]] + right + left[:-1]
        # keep it strictly convex: drop any vertex that turns the wrong way
        def turn(o, a_, b_):
            return (a_[0] - o[0]) * (b_[2] - o[2]) - (a_[2] - o[2]) * (b_[0] - o[0])
        changed = True
        while changed and len(verts) > 3:
            changed = False
            for i in range(len(verts)):
                if turn(verts[i - 1], verts[i], verts[(i + 1) % len(verts)]) >= -1e-6:
                    verts.pop(i); changed = True; break
        p['vertices'] = verts
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


def contains(x, y, z):
    st = L / 2 - z
    if st < 0 or st > L:
        return False
    pts = section(st)
    if y < pts[0][1] - 1e-7 or y > pts[-1][1] + 1e-7:
        return False
    return abs(x) <= half_breadth(z, y) + 1e-7


def fit_inside(v, within=None):
    lo = [v['center'][i] - v['size'][i] / 2 for i in range(3)]; hi = [v['center'][i] + v['size'][i] / 2 for i in range(3)]
    if within:
        lo = [max(a, b + .01) for a, b in zip(lo, within[0])]; hi = [min(a, b - .01) for a, b in zip(hi, within[1])]
    corners = lambda: [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    for _ in range(400):
        out = [c for c in corners() if not contains(*c)]
        if not out:
            break
        if all(c[1] == lo[1] for c in out) and hi[1] - lo[1] > 1.5:
            lo[1] += .05          # only the floor corners are outside: raise the floor
            continue
        for c in out:             # an end reaches past the rising bottom or the fining shell: draw it in
            if c[2] == hi[2] and hi[2] - lo[2] > 1:
                hi[2] -= .1
            elif c[2] == lo[2] and hi[2] - lo[2] > 1:
                lo[2] += .1
    before = [v['center'][i] - v['size'][i] / 2 for i in range(3)], [v['center'][i] + v['size'][i] / 2 for i in range(3)]
    if any(abs(p - q) > 1e-6 for p, q in zip(lo + hi, before[0] + before[1])):
        volume = lambda size: size[0] * size[1] * size[2]
        old = volume(v['size'])
        v['center'] = [round((a + b) / 2, 4) for a, b in zip(lo, hi)]; v['size'] = [round(b - a, 4) for a, b in zip(lo, hi)]
        if 'capacityM3' in v:     # the room keeps its permeability
            v['capacityM3'] = round(v['capacityM3'] * volume(v['size']) / old, 1)
    return lo, hi


rooms = {}
for c in b['compartments']:
    if c['id'].startswith(('reserve-', 'flood-strip', 'flood-end')) or c['center'][1] - c['size'][1] / 2 > 2:
        continue
    rooms[c['id']] = fit_inside(c)
for m in b['modules']:
    if m['center'][1] - m['size'][1] / 2 > 2:
        continue
    fit_inside(m, rooms.get(m.get('compartmentId')))


def js(o):
    return {k: js(v) for k, v in o.items()} if isinstance(o, dict) else [js(v) for v in o] if isinstance(o, list) else int(o) if isinstance(o, float) and o.is_integer() else o


path.write_text(json.dumps(js(b), indent=2, ensure_ascii=False) + '\n')
print('re-seated', sum(1 for a in b['armor'] if 'plate' in a), 'plates')

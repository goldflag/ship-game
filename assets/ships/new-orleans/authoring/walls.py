"""New Orleans bulwarks, splinter screens and gun tubs: thin walls traced from plan cuts of the reference.

  python3 assets/ships/new-orleans/authoring/walls.py structures.json > assets/ships/new-orleans/new_orleans_walls.py

Reads the cached `pasc107-b` reference (`bun run ship:reference pasc107 --hull B_Hull --name pasc107-b`),
`authoring/lines.json` and the measured superstructure blocks (`structures.py` output, runtime frame); needs numpy.

The block tracer drops anything under 0.3 m thick, which is every bulwark, splinter screen and gun tub. Here the
reference's hull group is cut every 0.2 m from the main deck to 23 m; cut segments that lie on a block's walls (within
0.1 m of the outline of a block standing at that height) or on the hull's own shell below its deck are set aside, the
rest are chained (a thin plate's two faces, joined at its ends, open into one face), and chains under 0.6 m (rails,
stanchions, ladders) are dropped. Chains that repeat from level to level at the same place in plan are one wall: its
outline is the longest chain, simplified to 3 cm; its foot is the highest surface under it and its top the highest
point of the faces it crosses. Written as (x, z) runtime metres, starboard and centreline only where the ship is
symmetric (`mirror`). The recipe draws each as plating 6 cm thick. Measured offsets only; no source triangles.
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REF = ROOT / '.build/references/pasc107-b'
LINES = json.loads((HERE / 'lines.json').read_text())
ZS = LINES['zShift']
BLOCKS = json.loads(Path(sys.argv[1]).read_text())['structures']

meta = json.loads((REF / 'reference.json').read_text())
raw = (REF / 'mesh.bin').read_bytes()
_, _, nv, ni = struct.unpack('<4I', raw[:16])
pos = np.frombuffer(raw, dtype='<f4', count=nv * 3, offset=16).reshape(-1, 3).astype(np.float64)
idx = np.frombuffer(raw, dtype='<u4', count=ni, offset=16 + nv * 12).reshape(-1, 3)
TRIS = pos[np.concatenate([idx[p['first']:p['first'] + p['count']] for p in meta['parts'] if p['group'] == 'hull'])]
TRIS_ZMIN, TRIS_ZMAX = TRIS[:, :, 2].min(1), TRIS[:, :, 2].max(1)
TRIS_YMIN, TRIS_YMAX = TRIS[:, :, 1].min(1), TRIS[:, :, 1].max(1)
SECS = sorted(((LINES['length'] / 2 - s['station'] - ZS, s['points']) for s in LINES['sections']))
SEC_Z = np.array([s[0] for s in SECS])
SEC_DECK = np.array([s[1][-1][1] for s in SECS])


def deck(zref):
    return float(np.interp(zref, SEC_Z, SEC_DECK))


def hull_half(zref, y):
    i = int(np.argmin(np.abs(SEC_Z - zref)))
    best = None
    for (w0, y0), (w1, y1) in zip(SECS[i][1], SECS[i][1][1:]):
        if min(y0, y1) <= y <= max(y0, y1) and y1 != y0:
            w = w0 + (w1 - w0) * (y - y0) / (y1 - y0)
            best = w if best is None else max(best, w)
    return best if best is not None else SECS[i][1][-1][0]


def seg_dist(p, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0 if L2 < 1e-12 else max(0, min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2))
    return math.hypot(p[0] - ax - t * dx, p[1] - az - t * dz)


def block_outline(s, y):
    """A block's outline at height y: its footprint, or a lofted block's nearest ring (runtime x, z)."""
    if not s.get('surface'):
        return s['footprint']
    vs = s['surface']['vertices']
    heights = sorted({round(v[1], 3) for v in vs})
    h = min(heights, key=lambda k: abs(k - y))
    return [[v[0], v[2]] for v in vs if abs(round(v[1], 3) - h) < 1e-6]


def inside(q, ring):
    x, z = q
    c = False
    for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            c = not c
    return c


def near_block(p, y):
    """On a block standing at height y: within 0.12 m of its outline there, or inside it (reference frame point)."""
    for s in BLOCKS:
        if not (s['baseY'] - .05 <= y <= s['baseY'] + s['height'] + .05):
            continue
        b = s['bounds']
        if not (b[0] - .3 <= p[0] <= b[2] + .3 and b[1] - .3 <= p[1] + ZS <= b[3] + .3):
            continue
        ring = block_outline(s, y)
        q = (p[0], p[1] + ZS)
        if inside(q, ring):
            return True
        for a, c in zip(ring, ring[1:] + ring[:1]):
            if seg_dist(q, a, c) < .12:
                return True
    return False


def cut(y):
    sel = (TRIS_YMIN < y) & (TRIS_YMAX > y)
    t = TRIS[sel]
    lo, hi = TRIS_YMIN[sel], TRIS_YMAX[sel]
    segs = []
    for tri, a0, a1 in zip(t, lo, hi):
        dd = tri[:, 1] - y
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (dd[a] > 0) != (dd[b] > 0):
                f = dd[a] / (dd[a] - dd[b])
                p = tri[a] + (tri[b] - tri[a]) * f
                pts.append((float(p[0]), float(p[2])))
        if len(pts) == 2:
            segs.append((pts, float(a0), float(a1)))
    return segs


def chains(segs, tol=.004):
    key = lambda p: (round(p[0] / tol), round(p[1] / tol))
    ends = {}
    for i, (s, _, _) in enumerate(segs):
        ends.setdefault(key(s[0]), []).append((i, 0))
        ends.setdefault(key(s[1]), []).append((i, 1))
    used = set()
    out = []
    for i in range(len(segs)):
        if i in used:
            continue
        used.add(i)
        line = [segs[i][0][0], segs[i][0][1]]
        members = [i]
        for direction in (1, -1):
            while True:
                tip = line[-1] if direction == 1 else line[0]
                nxt = next(((j, e) for j, e in ends.get(key(tip), []) if j not in used), None)
                if nxt is None:
                    break
                j, e = nxt
                used.add(j)
                members.append(j)
                p = segs[j][0][1 - e]
                if direction == 1:
                    line.append(p)
                else:
                    line.insert(0, p)
        out.append((line, min(segs[k][1] for k in members), max(segs[k][2] for k in members)))
    return out


def length(line):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(line, line[1:]))


def open_loop(line):
    """A closed chain round a thin plate (both faces joined at its ends): keep one face."""
    if len(line) < 4 or math.hypot(line[0][0] - line[-1][0], line[0][1] - line[-1][1]) > .02:
        return line
    ring = line[:-1]
    area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2
    if area / max(length(line), 1e-9) > .06:
        return line
    arr = np.array(ring)
    d = np.hypot(arr[:, None, 0] - arr[None, :, 0], arr[:, None, 1] - arr[None, :, 1])
    i, j = np.unravel_index(np.argmax(d), d.shape)
    i, j = int(min(i, j)), int(max(i, j))
    one, two = ring[i:j + 1], ring[j:] + ring[:i + 1]
    return one if length(one) >= length(two) else two


def simplify(pts, eps=.03):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = np.linalg.norm(ab)
    dists = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / n if n > 1e-9 else float(np.hypot(p[0] - a[0], p[1] - a[1])) for p in pts]
    k = int(np.argmax(dists))
    if dists[k] > eps:
        return simplify(pts[:k + 1], eps)[:-1] + simplify(pts[k:], eps)
    return [pts[0], pts[-1]]


def mean_dist(a, b):
    """Mean distance from the points of polyline a to polyline b (sampled)."""
    arr = np.array(a)
    total = 0.0
    for p in arr:
        total += min(seg_dist(p, u, v) for u, v in zip(b, b[1:])) if len(b) > 1 else math.hypot(p[0] - b[0][0], p[1] - b[0][1])
    return total / len(arr)


def surface_below(x, z, y):
    """Highest up-facing hull-group surface at (x, z) at or below y (reference frame)."""
    sel = (TRIS[:, :, 0].min(1) <= x) & (TRIS[:, :, 0].max(1) >= x) & (TRIS_ZMIN <= z) & (TRIS_ZMAX >= z) & (TRIS_YMIN <= y)
    best = None
    for tri in TRIS[sel]:
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
        den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(den) < 1e-12:
            continue
        u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
        v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
        w = 1 - u - v
        if u < -1e-6 or v < -1e-6 or w < -1e-6:
            continue
        yy = u * ay + v * by + w * cy
        n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
        if abs(n[1]) / (np.linalg.norm(n) + 1e-12) > .7 and yy <= y + 1e-6 and (best is None or yy > best):
            best = yy
    return best


groups = []   # each: dict(line, lo_cut, hi_cut, top)
# The funnels above their casings are lofted from their own measurements (structures.py FUNNELS, reference z).
FUNNELS = [(-2.35, 2.35, -17.6, -9.4, 7.75), (-2.35, 2.35, -.1, 7.7, 8.25)]
y = 3.8
while y <= 23.0:
    segs = []
    for s, lo, hi in cut(y):
        mid = ((s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2)
        if any(x0 <= mid[0] <= x1 and z0 <= mid[1] <= z1 and y >= fy for x0, x1, z0, z1, fy in FUNNELS):
            continue
        d = deck(mid[1])
        if y < d + .02:
            # below the local deck: the hull's own shell
            if abs(abs(mid[0]) - hull_half(mid[1], y)) < .2:
                continue
        if near_block(mid, y):
            continue
        segs.append((s, lo, hi))
    for line, lo, hi in chains(segs):
        closed = len(line) > 3 and math.hypot(line[0][0] - line[-1][0], line[0][1] - line[-1][1]) < .02
        if closed and length(line) < 3.0:
            # a pole, pipe or post: drawn by the recipe
            continue
        line = open_loop(line)
        if length(line) < .6:
            continue
        for g in groups:
            if abs(g['hi_cut'] - y) <= .21 and mean_dist(line, g['line']) < .1:
                if length(line) > length(g['line']):
                    g['line'] = line
                g['hi_cut'] = y
                g['top'] = max(g['top'], hi)
                g['lo'] = min(g['lo'], lo)
                break
        else:
            groups.append(dict(line=line, lo_cut=y, hi_cut=y, top=hi, lo=lo))
    y = round(y + .2, 3)

walls = []
# The recipe draws the main-battery barbettes (reference z, their radius 2.96 m).
BARBETTES = [-56.506, -41.839, 56.789]
for g in groups:
    if g['hi_cut'] - g['lo_cut'] < .19 and g['top'] - g['lo'] < .4:
        continue
    if g['top'] - g['lo'] > 1.9:
        # faces taller than any bulwark: a deckhouse wall the block outline did not quite follow
        continue
    if any(all(math.hypot(p[0], p[1] - bz) < 3.4 for p in g['line']) for bz in BARBETTES):
        continue
    pts = simplify(g['line'])
    mid = pts[len(pts) // 2]
    foot = surface_below(mid[0], mid[1], g['lo_cut'])
    if foot is None or g['lo_cut'] - foot > 1.0:
        # nothing under it to stand on: not a bulwark
        continue
    # Nothing stands below the weather deck: a foot found under the deck edge is the shell's own strake.
    base = max(foot, deck(mid[1]) - .02)
    top = min(g['top'], base + 2.2)
    if top - base < .3:
        continue
    walls.append(dict(base=round(float(base), 3), top=round(float(top), 3), pts=[[round(float(x), 3), round(float(z) + ZS, 3)] for x, z in pts]))

# The same wall found again after a level where its chain broke: merge it into the first.
merged = []
for w in sorted(walls, key=lambda w: -length(w['pts'])):
    for m in merged:
        if w['base'] <= m['top'] + .1 and m['base'] <= w['top'] + .1 and mean_dist(w['pts'], m['pts']) < .1:
            m['base'], m['top'] = min(m['base'], w['base']), max(m['top'], w['top'])
            break
    else:
        merged.append(dict(w))
walls = sorted(merged, key=lambda w: -min(p[0] for p in w['pts']))
# A wall whose top meets a block's top where it runs inside or along that block (a screen under a platform slab)
# stops 5 cm under it, so the two tops do not share a plane (ship:check counts tops within 3 cm as one).
for w in walls:
    for s in BLOCKS:
        top = s['baseY'] + s['height']
        b = s['bounds']
        if abs(top - w['top']) > .03 or not any(b[0] - .2 <= x <= b[2] + .2 and b[1] - .2 <= z <= b[3] + .2 for x, z in w['pts']):
            continue
        ring = block_outline(s, top)
        if any(inside((x, z), ring) or min(seg_dist((x, z), a, c) for a, c in zip(ring, ring[1:] + ring[:1])) < .1 for x, z in w['pts']):
            w['top'] = round(top - .05, 3)
# Mirror: a starboard wall whose port twin is also found keeps one record marked `mirror`.
out = []
used = set()
for i, w in enumerate(walls):
    if i in used:
        continue
    twin = None
    xs = [p[0] for p in w['pts']]
    if min(xs) > .05:
        flipped = [[-x, z] for x, z in w['pts']]
        for j, v in enumerate(walls):
            if j != i and j not in used and abs(v['base'] - w['base']) < .1 and max(p[0] for p in v['pts']) < -.05 and mean_dist(flipped, v['pts']) < .12:
                twin = j
                break
    if twin is not None:
        used.add(twin)
        out.append(dict(w, mirror=True))
    else:
        out.append(dict(w, mirror=False))

# The walls give way to the guns. The reference's light guns stand closer to their screens and tub walls than the
# catalog parts' gunners' rests, shields and platforms sweep (mount-envelopes.json, measured on the built model by
# mount_envelope.py): wherever a wall crosses a light or secondary gun's working circle at the heights that circle
# reaches, the wall is pushed out radially onto the circle (plus MARGIN), so a straight screen bulges round the gun as a
# tub would. Where the bulge leaves the deck by more than FLOOR_FROM, a sponson floor fills between the traced line
# and the bulge at the wall's foot. The barrels are left to the installation interlocks.
BLUEPRINT = json.loads((HERE.parent / 'blueprint.json').read_text())
ENVELOPES = json.loads((HERE / 'mount-envelopes.json').read_text())
MARGIN, FLOOR_FROM = .08, .1


def working_radius(part, lo, hi):
    rows = [r for y, r in ENVELOPES.get(part, []) if lo - .03 <= y <= hi + .03]
    return max(rows) + MARGIN if rows else 0.0


def densify(pts, step=.05):
    res = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        res += [[a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] for k in range(1, n + 1)]
    return res


def carve(pts, c, R):
    """Push the points of a polyline inside the circle (c, R) out onto it; returns the new points and the runs of
    (traced, pushed) point pairs that moved."""
    dense = densify(pts)
    moved = []
    res = []
    for p in dense:
        dx, dz = p[0] - c[0], p[1] - c[1]
        d = math.hypot(dx, dz)
        if d < R - 1e-6 and d > 1e-6:
            q = [c[0] + dx / d * R, c[1] + dz / d * R]
            if res and moved and moved[-1] is not None and res[-1] is moved[-1][-1][1]:
                # both on the circle: fill the arc between them
                a0 = math.atan2(res[-1][1] - c[1], res[-1][0] - c[0])
                a1 = math.atan2(dz, dx)
                da = (a1 - a0 + math.pi) % math.tau - math.pi
                n = int(abs(da) / math.radians(6))
                for k in range(1, n + 1):
                    a = a0 + da * k / (n + 1)
                    arc = [c[0] + R * math.cos(a), c[1] + R * math.sin(a)]
                    res.append(arc)
                    moved[-1].append((None, arc))
            res.append(q)
            if not moved or moved[-1] is None:
                moved.append([])
            moved[-1].append((p, q))
        else:
            res.append(p)
            if moved and moved[-1] is not None:
                moved.append(None)
    return res, [run for run in moved if run]


def simplify_line(pts, tol=.01):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    best, at = 0, 0
    for i, p in enumerate(pts[1:-1], 1):
        d = abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / L if L > 1e-9 else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > best:
            best, at = d, i
    if best <= tol:
        return [a, b]
    return simplify_line(pts[:at + 1], tol)[:-1] + simplify_line(pts[at:], tol)


mounts = [m for m in BLUEPRINT['mounts'] if m['battery'] != 'main']
expanded = []
for w in out:
    for sign in ((1, -1) if w['mirror'] else (1,)):
        expanded.append(dict(base=w['base'], top=w['top'], pts=[[sign * x, z] for x, z in w['pts']], twin_of=len(expanded) - 1 if sign < 0 else None))
floors = []
for w in expanded:
    pts = w['pts']
    changed = False
    for m in mounts:
        mx, my, mz = m['position']
        R = working_radius(m['partId'], w['base'] - my, w['top'] - my)
        if R <= 0 or min(math.hypot(p[0] - mx, p[1] - mz) for p in densify(pts)) >= R:
            continue
        pts, runs = carve(pts, (mx, mz), R)
        changed = True
        for run in runs:
            push = max(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in run if p is not None)
            traced = [p for p, _ in run if p is not None]
            if push > FLOOR_FROM and len(traced) >= 2:
                outline = simplify_line(traced) + simplify_line([q for _, q in run])[::-1]
                floors.append(dict(y=w['base'], pts=[[round(x, 3), round(z, 3)] for x, z in outline]))
    if changed:
        w['pts'] = simplify_line(pts)
    w['pts'] = [[round(x, 3), round(z, 3)] for x, z in w['pts']]
final = []
for i, w in enumerate(expanded):
    if w['twin_of'] is not None:
        continue
    twin = expanded[i + 1] if i + 1 < len(expanded) and expanded[i + 1]['twin_of'] == i else None
    if twin is not None and len(twin['pts']) == len(w['pts']) and all(abs(a[0] + b[0]) < .002 and abs(a[1] - b[1]) < .002 for a, b in zip(w['pts'], twin['pts'])):
        final.append(dict(base=w['base'], top=w['top'], pts=w['pts'], mirror=True))
    else:
        final.append(dict(base=w['base'], top=w['top'], pts=w['pts'], mirror=False))
        if twin is not None:
            final.append(dict(base=twin['base'], top=twin['top'], pts=twin['pts'], mirror=False))
print('"""Measured thin walls (runtime metres), written by authoring/walls.py from the pasc107-b reference: bulwarks,')
print('splinter screens and gun tubs as (x, z) polylines with their foot and top; `mirror` walls repeat to port.')
print('FLOORS are the sponson floors under walls pushed out round a gun\'s working circle (polygons at height y)."""')
print('WALLS = [')
for w in final:
    print(f'    {w!r},')
print(']')
print('FLOORS = [')
for f in floors:
    print(f'    {f!r},')
print(']')
print(f'{len(final)} walls ({sum(w["mirror"] for w in final)} mirrored), {len(floors)} sponson floors', file=sys.stderr)

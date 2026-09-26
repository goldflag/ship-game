"""New Orleans superstructure blocks from dense plan footprints, by raster label propagation.

  python structures.py plans.json lines.json out.json [--exclude=excl.json] [--break=.1] [--prism_tol=.05] ...

Needs numpy, scipy, shapely, scikit-image and Pillow (a venv in ignored .build/ does). `plans.json` comes from
`plans.ts` (the shared `ship:slice --plan --sym` trace of the pasc107-b reference, every 0.05 m) and `lines.json`
from `measure-lines.ts`.

Every level's footprint is drawn into one plan grid, minus the loft below its deck (so the hull's own shell never
becomes a block), the main-battery barbettes the recipe draws, and any boxes in the exclusion file. The trace fills
whatever walls enclose, so the deck inside a bulwark, a gun tub or an open bridge would come back solid: a cell is
kept only where the reference has some surface above it (a roof; the funnels' flues are capped inside), and the
working circle of every open gun is cut out from its sole to 2.6 m above it. Levels above MAX_Y (the masts) are left
to the recipe. Cells are carried up level by level: each new cell joins the block nearest below it within 0.15 m,
and a block continues while its outline moves on average less than BREAK per level (a tapered wall), ends where it
changes abruptly (a roof, a platform, an overhang) and splits where it comes apart. Each block becomes a prism, or,
where its walls taper, a lofted block through the few rings its taper needs. Measured offsets only; no source
triangles. Output in the runtime frame: +X starboard, +Y up, -Z bow, z = reference z + zShift.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import shapely
import shapely.geometry
import shapely.prepared
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import Polygon
from skimage import measure

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
plans = json.load(open(args[0]))
lines = json.load(open(args[1]))
SHIFT = lines['zShift']
HALF = lines['length'] / 2
CELL = .05
X0, X1 = -11.0, 11.0
Z0, Z1 = -92.0, 92.0
NX, NZ = int((X1 - X0) / CELL), int((Z1 - Z0) / CELL)
BREAK = float(opts.get('break', .1))
PRISM_TOL = float(opts.get('prism_tol', .05))
ASSIGN = float(opts.get('assign', .15)) / CELL
SMOOTH = int(round(float(opts.get('smooth', .2)) / CELL))
MIN_AREA = float(opts.get('min_area', .5))
HULL_MARGIN = float(opts.get('hull_margin', .05))
MAX_Y = float(opts.get('max_y', 23.0))
exclude = json.load(open(opts['exclude'])) if 'exclude' in opts else []
# Sections in reference z.
SECTIONS = sorted(({'z': HALF - s['station'] - SHIFT, 'points': s['points']} for s in lines['sections']), key=lambda s: s['z'])
ROOT = Path(__file__).resolve().parents[4]
REFDIR = ROOT / '.build/references' / plans.get('reference', 'pasc107-b')


def to_px(x, z):
    return ((x - X0) / CELL, (z - Z0) / CELL)


def hull_triangles():
    meta = json.loads((REFDIR / 'reference.json').read_text())
    raw = (REFDIR / 'mesh.bin').read_bytes()
    _, _, nv, ni = struct.unpack('<4I', raw[:16])
    pos = np.frombuffer(raw, dtype='<f4', count=nv * 3, offset=16).reshape(-1, 3).astype(np.float64)
    idx = np.frombuffer(raw, dtype='<u4', count=ni, offset=16 + nv * 12).reshape(-1, 3)
    return pos[np.concatenate([idx[p['first']:p['first'] + p['count']] for p in meta['parts'] if p['group'] == 'hull'])]


HULL_TRIS = hull_triangles()
# The funnel bodies above their casings are lofted by author-blueprint.py from their measured section and rake:
# (x0, x1, z0, z1, from y), reference z.
FUNNELS = [(-2.35, 2.35, -17.6, -9.4, 7.75), (-2.35, 2.35, -.1, 7.7, 8.25)]


def top_map():
    """Highest surface of the reference's hull group over each plan cell (reference z)."""
    tris = HULL_TRIS
    top = np.full((NZ, NX), -np.inf)
    cx = (tris[:, :, 0] - X0) / CELL - .5
    cz = (tris[:, :, 2] - Z0) / CELL - .5
    c0 = np.clip(np.ceil(cx.min(1)).astype(int), 0, NX - 1)
    c1 = np.clip(np.floor(cx.max(1)).astype(int), 0, NX - 1)
    r0 = np.clip(np.ceil(cz.min(1)).astype(int), 0, NZ - 1)
    r1 = np.clip(np.floor(cz.max(1)).astype(int), 0, NZ - 1)
    for t in range(len(tris)):
        if c1[t] < c0[t] or r1[t] < r0[t]:
            # Smaller than a cell: its highest corner marks the cell it falls in.
            c = int(np.clip(round(cx[t].mean()), 0, NX - 1))
            r = int(np.clip(round(cz[t].mean()), 0, NZ - 1))
            top[r, c] = max(top[r, c], tris[t, :, 1].max())
            continue
        gx, gz = np.meshgrid(np.arange(c0[t], c1[t] + 1), np.arange(r0[t], r1[t] + 1))
        (ax, az), (bx, bz), (qx, qz) = zip(cx[t], cz[t])
        den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz)
        if abs(den) < 1e-12:
            continue
        u = ((bz - qz) * (gx - qx) + (qx - bx) * (gz - qz)) / den
        v = ((qz - az) * (gx - qx) + (ax - qx) * (gz - qz)) / den
        w = 1 - u - v
        inside = (u >= -1e-6) & (v >= -1e-6) & (w >= -1e-6)
        if not inside.any():
            continue
        y = u * tris[t, 0, 1] + v * tris[t, 1, 1] + w * tris[t, 2, 1]
        rr, cc = gz[inside], gx[inside]
        np.maximum.at(top, (rr, cc), y[inside])
    return top


TOP = top_map()
print('top map ready')
# Open guns (reference hardpoints): their working circles, from the sole to 2.6 m above it.
GUN_RADIUS = {'aga008': 2.25, 'aga018': 1.4, 'aga003': 1.3, 'ags007': 2.3}
_meta = json.loads((REFDIR / 'reference.json').read_text())
_hp = {h['id']: h for h in _meta['hardpoints']}
GUNS = []
for p in _meta['parts']:
    key = p['visual'].split('/')[-1][:6]
    node = p['path'].split('/')[-1]
    if key in GUN_RADIUS and node in _hp:
        x, y, z = _hp[node]['position']
        GUNS.append((x, y, z, GUN_RADIUS[key]))


def raster(polys):
    img = Image.new('L', (NX, NZ), 0)
    d = ImageDraw.Draw(img)
    for ring in polys:
        if len(ring) >= 3:
            d.polygon([to_px(x, z) for x, z in ring], fill=255)
    return np.array(img) > 0


def breadth_at(points, y):
    best = None
    for (w0, y0), (w1, y1) in zip(points, points[1:]):
        if min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-9:
            w = w0 + (w1 - w0) * (y - y0) / (y1 - y0)
            best = w if best is None else max(best, w)
    return best


def hull_rings(y):
    """The loft's outline at height y where that height is below its deck (the hull body, not a deckhouse): one ring
    per run of consecutive sections, so the forecastle and the raised stern are never bridged across the waist."""
    runs, right = [], []
    for s in SECTIONS:
        w = breadth_at(s['points'], min(y, s['points'][-1][1])) if s['points'][0][1] <= y <= s['points'][-1][1] + 1e-6 else None
        if w is not None:
            right.append((w + HULL_MARGIN, s['z']))
        elif right:
            runs.append(right)
            right = []
    if right:
        runs.append(right)
    return [[(x, z) for x, z in r] + [(-x, z) for x, z in reversed(r)] for r in runs if len(r) >= 2]


# Main-battery barbettes (reference HP_AGM datums and the armour model's 2.96 m radius): the recipe draws them.
MAIN = [(-56.506, 7.779), (-41.839, 9.834), (56.789, 4.734)]


def circle(x, z, r, n=64):
    return [(x + r * np.cos(a), z + r * np.sin(a)) for a in np.linspace(0, 2 * np.pi, n, endpoint=False)]


def exclusion_rings(y):
    rings = []
    for z, top in MAIN:
        if y <= top + .05:
            rings.append(circle(0, z, 3.15))
    for x, gy, z, r in GUNS:
        if gy - .02 <= y <= gy + 2.6:
            rings.append(circle(x, z, r, 48))
    for x0, x1, z0, z1, y0 in FUNNELS:
        if y >= y0:
            rings.append([(x0, z0), (x1, z0), (x1, z1), (x0, z1)])
    for e in exclude:
        if e['y0'] <= y <= e['y1']:
            if 'circle' in e:
                x, z, r = e['circle']
                rings.append(circle(x, z, r, 40))
            else:
                x0, z0, x1, z1 = e['box']
                rings.append([(x0, z0), (x1, z0), (x1, z1), (x0, z1)])
    return rings


disk = np.hypot(*np.mgrid[-SMOOTH:SMOOTH + 1, -SMOOTH:SMOOTH + 1]) <= SMOOTH + .01


def level_mask(level):
    m = raster([p['ring'] for p in level['polygons']])
    m &= TOP > level['y'] + .02
    m &= ~raster(hull_rings(level['y']))
    m &= ~raster(exclusion_rings(level['y']))
    if SMOOTH:
        m = ndimage.binary_opening(m, structure=disk)
        m = ndimage.binary_closing(m, structure=disk)
    lab, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.flatnonzero(sizes * CELL * CELL >= MIN_AREA * .6))
        m &= keep
    return m


def perimeter(mask):
    er = ndimage.binary_erosion(mask)
    return max(1, (mask & ~er).sum()) * CELL


def union_box(a, b):
    return (slice(min(a[0].start, b[0].start), max(a[0].stop, b[0].stop)), slice(min(a[1].start, b[1].start), max(a[1].stop, b[1].stop)))


def place(sub, box, target):
    out = np.zeros((target[0].stop - target[0].start, target[1].stop - target[1].start), bool)
    out[box[0].start - target[0].start:box[0].stop - target[0].start, box[1].start - target[1].start:box[1].stop - target[1].start] = sub
    return out


class Run:
    def __init__(self, rid, y, box, sub):
        self.id = rid
        self.levels = []
        self.add(y, box, sub)

    def add(self, y, box, sub):
        self.levels.append((y, box, sub.copy()))
        self.box, self.sub = box, sub


levels = [lv for lv in plans['levels'] if lv['y'] <= MAX_Y]
STEP = levels[1]['y'] - levels[0]['y']
runs, active = [], {}
label = np.zeros((NZ, NX), np.int32)
next_id = 1
for li, level in enumerate(levels):
    y = level['y']
    mask = level_mask(level)
    new_label = np.zeros_like(label)
    if active:
        dist, (iz, ix) = ndimage.distance_transform_edt(label == 0, return_indices=True)
        near = label[iz, ix]
        cand = np.where(mask & (dist <= ASSIGN), near, 0)
    else:
        cand = np.zeros_like(label)
    boxes = ndimage.find_objects(cand)
    ended = []
    for rid, run in list(active.items()):
        box = boxes[rid - 1] if rid - 1 < len(boxes) else None
        if box is None:
            ended.append(rid)
            continue
        cells = cand[box] == rid
        lab, n = ndimage.label(cells)
        if n > 1:
            sizes = ndimage.sum(cells, lab, range(1, n + 1))
            big = [i + 1 for i, sz in enumerate(sizes) if sz * CELL * CELL >= MIN_AREA * .6]
            if len(big) != 1:
                ended.append(rid)
                continue
            cells = lab == big[0]
        u = union_box(run.box, box)
        a, b = place(run.sub, run.box, u), place(cells, box, u)
        drift = (a ^ b).sum() * CELL * CELL / ((perimeter(a) + perimeter(b)) / 2)
        if drift <= BREAK:
            run.add(y, box, cells)
            new_label[box][cells] = rid
        else:
            ended.append(rid)
    for rid in ended:
        runs.append(active.pop(rid))
    free = mask & (new_label == 0)
    lab, n = ndimage.label(free)
    objs = ndimage.find_objects(lab)
    for i in range(1, n + 1):
        box = objs[i - 1]
        cells = lab[box] == i
        if cells.sum() * CELL * CELL < MIN_AREA * .6:
            continue
        active[next_id] = Run(next_id, y, box, cells)
        new_label[box][cells] = next_id
        next_id += 1
    label = new_label
runs.extend(active.values())
print(len(runs), 'runs')


def outline_change(a_box, a, b_box, b):
    u = union_box(a_box, b_box)
    pa, pb = place(a, a_box, u), place(b, b_box, u)
    return (pa ^ pb).sum() * CELL * CELL / ((perimeter(pa) + perimeter(pb)) / 2)


# A run that ends only because a transient detail spiked the drift is rejoined to the run that starts on the next
# level with nearly the same outline.
MERGE = float(opts.get('merge', .06))
by_start = {}
for r in runs:
    by_start.setdefault(round(r.levels[0][0], 3), []).append(r)
merged = set()
for r in sorted(runs, key=lambda r: r.levels[0][0]):
    if id(r) in merged:
        continue
    while True:
        y_end, box_end, sub_end = r.levels[-1]
        nxt = None
        for c in by_start.get(round(y_end + STEP, 3), []):
            if id(c) in merged or c is r:
                continue
            if outline_change(box_end, sub_end, c.levels[0][1], c.levels[0][2]) <= MERGE:
                nxt = c
                break
        if nxt is None:
            break
        r.levels.extend(nxt.levels)
        merged.add(id(nxt))
runs = [r for r in runs if id(r) not in merged]
print(len(runs), 'runs after merging')


def mask_polygon(mask, box=(slice(0, NZ), slice(0, NX))):
    padded = np.pad(mask, 1).astype(float)
    best = None
    r0, c0 = box[0].start, box[1].start
    for c in measure.find_contours(padded, .5):
        pts = [(X0 + (c0 + col - 1 + .5) * CELL, Z0 + (r0 + row - 1 + .5) * CELL) for row, col in c]
        if len(pts) < 4:
            continue
        p = Polygon(pts).buffer(0)
        if p.geom_type == 'MultiPolygon':
            p = max(p.geoms, key=lambda g: g.area)
        if best is None or p.area > best.area:
            best = p
    if best is None:
        return None
    best = Polygon(best.exterior).simplify(float(opts.get('simplify', .06)))
    return shapely.geometry.polygon.orient(best, 1.0) if best.is_valid and not best.is_empty else None


def ring_points(poly, n):
    coords = np.array(poly.exterior.coords)[:-1]
    xs, zs = coords[:, 0], coords[:, 1]
    start = int(np.argmax(zs - 3 * np.abs(xs)))
    coords = np.roll(coords, -start, axis=0)
    closed = np.vstack([coords, coords[:1]])
    seg = np.hypot(*np.diff(closed, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n, endpoint=False)
    return np.stack([np.interp(t, s, closed[:, 0]), np.interp(t, s, closed[:, 1])], 1)


def project_ring(prev, poly):
    """Resample an outline where the points of the neighbouring level's ring fall on it (nearest points, kept in
    order round the ring), so corresponding points follow the wall instead of sliding round with its perimeter."""
    line = shapely.LineString(np.array(poly.exterior.coords))
    L = line.length
    s = np.asarray(shapely.line_locate_point(line, shapely.points(prev)), dtype=float)
    out = [s[0]]
    for v in s[1:]:
        v = v + L * np.round((out[-1] - v) / L)
        out.append(max(v, out[-1] + .005))  # never two points on one spot
    out = np.array(out)
    if out[-1] - out[0] > L * .999:
        out = out[0] + (out - out[0]) * (L * .999 / (out[-1] - out[0]))
    return np.array([line.interpolate(v % L).coords[0] for v in out])


def triangulate(ring):
    poly = Polygon(ring)
    if not poly.is_valid:
        return None
    tris = shapely.constrained_delaunay_triangles(poly)
    pts = {tuple(np.round(p, 6)): i for i, p in enumerate(ring)}
    out = []
    for t in tris.geoms:
        c = [tuple(np.round(v, 6)) for v in list(t.exterior.coords)[:3]]
        if all(k in pts for k in c):
            out.append([pts[k] for k in c])
    return out


def rz(z):
    return round(float(z) + SHIFT, 3)


def apart(a, c):
    """How far outline a strays from outline c: the 90th percentile of its points' distances, every 5 cm."""
    pts = shapely.points(np.array([a.exterior.interpolate(t).coords[0] for t in np.arange(0, a.exterior.length, .05)]))
    return float(np.percentile(shapely.distance(pts, c.exterior), 90))


structures = []
todo = [list(run.levels) for run in runs]
while todo:
    levels = todo.pop(0)
    y0 = levels[0][0] - STEP / 2
    y1 = levels[-1][0] + STEP / 2
    ym, mbox, mid = levels[len(levels) // 2]
    area = mid.sum() * CELL * CELL
    if area < MIN_AREA or (y1 - y0) * area < float(opts.get('min_volume', .3)):
        continue
    # A run one level deep is a plane grazing a plate; real platforms come from the horizontal faces below.
    if len(levels) < 2:
        continue
    per = perimeter(mid)
    spread = 0
    for _, bx, sub in levels:
        u = union_box(mbox, bx)
        spread = max(spread, (place(mid, mbox, u) ^ place(sub, bx, u)).sum() * CELL * CELL / per)
    entry = dict(baseY=round(y0, 3), height=round(y1 - y0, 3), levels=len(levels))
    if spread <= PRISM_TOL or len(levels) < 3:
        poly = mask_polygon(mid, mbox)
        if poly is None or poly.area < MIN_AREA * .5:
            continue
        entry['footprint'] = [[round(x, 3), rz(z)] for x, z in list(poly.exterior.coords)[:-1]]
        entry['kind'] = 'prism'
    else:
        polys = [mask_polygon(sub, bx) for _, bx, sub in levels]
        if any(p is None for p in polys):
            continue
        # Where the outline jumps between two neighbouring levels (a deckhouse stepping in above its lower tier) the
        # run is two blocks: split it there and treat each part on its own; a part one level deep joins the part below.
        jumps = [k + 1 for k in range(len(polys) - 1) if max(apart(polys[k], polys[k + 1]), apart(polys[k + 1], polys[k])) > float(opts.get('split', .15))]
        if jumps:
            parts, start = [], 0
            for k in jumps + [len(levels)]:
                if k - start < 2 and parts:
                    parts[-1] = parts[-1] + levels[start:k]
                elif k > start:
                    parts.append(levels[start:k])
                start = k
            if len(parts) > 1:
                todo[:0] = parts
                continue
        # A block is a prism when nearly all its levels (PRISM_SHARE of its height) keep nine tenths of their outline
        # within PRISM_H of the middle level's, both ways: a loft of near-identical rings, or of rings that differ only
        # by a small feature that comes and goes (a locker, a ladder, a fillet, a lip at the top), only crumples the
        # shading.
        middle = len(polys) // 2

        offsets = [max(apart(p, polys[middle]), apart(polys[middle], p)) for p in polys]
        alike = [v < float(opts.get('prism_h', .15)) for v in offsets]
        bx0, bz0, bx1, bz1 = polys[middle].bounds
        print(f'tapered run {y0:.2f}-{y1:.2f} m at x {bx0:.1f}..{bx1:.1f}, z {bz0 + SHIFT:.1f}..{bz1 + SHIFT:.1f}: '
              f'{sum(alike)}/{len(polys)} levels like the middle one'
              + ('' if sum(alike) >= .85 * len(polys) else ' (' + ' '.join(f'{v:.2f}' for v in offsets) + ')'), file=sys.stderr)
        if sum(alike) >= float(opts.get('prism_share', .85)) * len(polys):
            entry['footprint'] = [[round(x, 3), rz(z)] for x, z in list(polys[middle].exterior.coords)[:-1]]
            entry['kind'] = 'prism'
        else:
            # Rings: the middle level sampled evenly, each level above and below resampled where its neighbour's points
            # fall on it, so a feature that comes and goes between levels does not drag the correspondence round the ring.
            n = int(np.clip(round(max(p.length for p in polys) / .3), 16, 128))
            sampled = [None] * len(polys)
            sampled[middle] = ring_points(polys[middle], n)
            for k in range(middle + 1, len(polys)):
                sampled[k] = project_ring(sampled[k - 1], polys[k])
            for k in range(middle - 1, -1, -1):
                sampled[k] = project_ring(sampled[k + 1], polys[k])
            ys = [lv[0] for lv in levels]
            # Keep only the levels the shape needs: a level goes when the straight blend of the kept levels either side of it
            # stays within LOFT_TOL of its outline both ways (shape distance, not vertex to vertex, so the arc-length
            # sampling sliding along a ring does not keep every level and crumple the shading).
            edges = [shapely.LineString(np.vstack([p, p[:1]])) for p in sampled]
            keep, i = [0], 0
            while i < len(polys) - 1:
                j = len(polys) - 1
                while j > i + 1:
                    ok = True
                    for k in range(i + 1, j):
                        t = (ys[k] - ys[i]) / (ys[j] - ys[i])
                        guess = sampled[i] * (1 - t) + sampled[j] * t
                        there = shapely.distance(shapely.points(guess), edges[k]).max()
                        back = shapely.distance(shapely.points(sampled[k]), shapely.LineString(np.vstack([guess, guess[:1]]))).max()
                        if max(there, back) > float(opts.get('loft_tol', .15)):
                            ok = False
                            break
                    if ok:
                        break
                    j -= 1
                keep.append(j)
                i = j
            loops = [(y0 if k == 0 else y1 if k == len(polys) - 1 else ys[k], sampled[k]) for k in keep]
            m = len(loops)
            verts = [[round(float(x), 3), round(yk, 3), rz(z)] for yk, pts in loops for x, z in pts]
            tris = []
            for a in range(m - 1):
                for i in range(n):
                    p, q = a * n + i, a * n + (i + 1) % n
                    r, s = (a + 1) * n + (i + 1) % n, (a + 1) * n + i
                    tris += [[p, q, r], [p, r, s]]
            bottom = triangulate(loops[0][1])
            top = triangulate(loops[-1][1])
            if bottom is None or top is None or len(verts) > 2048:
                poly = polys[len(polys) // 2]
                entry['footprint'] = [[round(x, 3), rz(z)] for x, z in list(poly.exterior.coords)[:-1]]
                entry['kind'] = 'prism'
            else:
                tris += [[c, b, a] for a, b, c in bottom]
                tris += [[(m - 1) * n + a, (m - 1) * n + b, (m - 1) * n + c] for a, b, c in top]
                widest = max(polys, key=lambda p: p.area)
                entry['footprint'] = [[round(x, 3), rz(z)] for x, z in list(widest.exterior.coords)[:-1]]
                entry['surface'] = dict(vertices=verts, triangles=tris)
                entry['kind'] = 'loft'
    if len(entry['footprint']) > 256:
        poly = Polygon(entry['footprint']).simplify(.12)
        entry['footprint'] = [[round(x, 3), round(z, 3)] for x, z in list(poly.exterior.coords)[:-1]]
    fp = np.array(entry['footprint'])
    entry['bounds'] = [round(fp[:, 0].min(), 2), round(fp[:, 1].min(), 2), round(fp[:, 0].max(), 2), round(fp[:, 1].max(), 2)]
    # A sliver one level thick lying on the sheered deck is the level plane grazing the deck plating, not a platform.
    zmid = (fp[:, 1].min() + fp[:, 1].max()) / 2 - SHIFT
    near = min(SECTIONS, key=lambda s: abs(s['z'] - zmid))
    if entry['height'] <= .1 and abs(entry['baseY'] - near['points'][-1][1]) < .3:
        continue
    structures.append(entry)

# ---------------------------------------------------------------- thin platforms
# Platforms, gun-tub floors and bridge wings are plates a few centimetres thick, often a single face, so most plan
# levels miss them. Horizontal reference surfaces above the deck that no block's top covers are gathered by height,
# joined where they touch, and each piece of at least PLATFORM_AREA m2 and 0.3 m across becomes a slab.
PLATFORM_AREA = float(opts.get('platform_area', .8))
SLAB = .08
T = HULL_TRIS
nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
tri_area = np.linalg.norm(nrm, axis=1) / 2
ny = np.abs(nrm[:, 1]) / np.maximum(2 * tri_area, 1e-12)
cen = T.mean(1)
sec_z = np.array([s['z'] for s in SECTIONS])
sec_deck = np.array([s['points'][-1][1] for s in SECTIONS])
deck_at = np.interp(cen[:, 2], sec_z, sec_deck)
cand = np.flatnonzero((ny > .98) & (tri_area > 1e-4) & (cen[:, 1] > deck_at + .25) & (cen[:, 1] < MAX_Y))
tops = []
for s in structures:
    fp = [(x, z - SHIFT) for x, z in s['footprint']]
    tops.append((shapely.prepared.prep(Polygon(fp).buffer(.05)), s['baseY'] - .1, s['baseY'] + s['height'] + .12))
free = []
for i in cand:
    x, y, z = cen[i]
    pt = shapely.geometry.Point(x, z)
    if any(y0 <= y <= y1 and poly.contains(pt) for poly, y0, y1 in tops):
        continue
    if any(y <= top + .3 and np.hypot(x, z - mz) < 3.3 for mz, top in MAIN):
        continue
    if any(x0 <= x <= x1 and z0 <= z <= z1 and y >= fy for x0, x1, z0, z1, fy in FUNNELS):
        continue
    free.append(i)
levels_y = {}
for i in free:
    levels_y.setdefault(round(cen[i, 1] / .04) * .04, []).append(i)
platforms = []
for yq in sorted(levels_y):
    group = levels_y[yq]
    img = Image.new('L', (NX, NZ), 0)
    d = ImageDraw.Draw(img)
    for i in group:
        d.polygon([to_px(p[0], p[2]) for p in T[i]], fill=255)
    m = np.array(img) > 0
    m = ndimage.binary_closing(m, structure=np.ones((5, 5), bool))
    m = ndimage.binary_opening(m, structure=np.ones((6, 6), bool))   # drops anything under 0.3 m across
    lab, n = ndimage.label(m)
    objs = ndimage.find_objects(lab)
    for k in range(1, n + 1):
        box = objs[k - 1]
        sub = lab[box] == k
        if sub.sum() * CELL * CELL < PLATFORM_AREA:
            continue
        poly = mask_polygon(sub, box)
        if poly is None or poly.area < PLATFORM_AREA:
            continue
        y_top = float(np.mean([cen[i, 1] for i in group]))
        fp = [[round(x, 3), rz(z)] for x, z in list(poly.exterior.coords)[:-1]]
        a = np.array(fp)
        platforms.append(dict(baseY=round(y_top - SLAB, 3), height=SLAB, levels=0, kind='platform', footprint=fp,
                              bounds=[round(a[:, 0].min(), 2), round(a[:, 1].min(), 2), round(a[:, 0].max(), 2), round(a[:, 1].max(), 2)]))
print(len(platforms), 'thin platforms from', len(free), 'uncovered horizontal faces')
structures.extend(platforms)

# A small block standing clear of everything (a lintel before a recessed door, a slab off a wall) is carried to the
# nearest block it faces within 0.4 m: its outline grows by the gap, so the two meet.
def touches(a, b, gap=.06):
    if a['baseY'] > b['baseY'] + b['height'] + gap or b['baseY'] > a['baseY'] + a['height'] + gap:
        return False
    return Polygon(a['footprint']).buffer(gap).intersects(Polygon(b['footprint']))


def on_deck(s):
    fp = np.array(s['footprint'])
    zmid = (fp[:, 1].min() + fp[:, 1].max()) / 2 - SHIFT
    near = min(SECTIONS, key=lambda q: abs(q['z'] - zmid))
    return s['baseY'] <= near['points'][-1][1] + .3


supported = {id(s) for s in structures if on_deck(s)}
changed = True
while changed:
    changed = False
    for s in structures:
        if id(s) not in supported and any(id(o) in supported and touches(s, o) for o in structures if o is not s):
            supported.add(id(s))
            changed = True
grown = 0
for s in sorted(structures, key=lambda s: s['baseY']):
    if id(s) in supported or s['height'] > 2.0:
        continue
    poly = Polygon(s['footprint'])
    best = None
    for o in structures:
        if o is s or id(o) not in supported or o['baseY'] > s['baseY'] + s['height'] or s['baseY'] > o['baseY'] + o['height']:
            continue
        d = poly.distance(Polygon(o['footprint']))
        if d < .4 and (best is None or d < best):
            best = d
    if best is not None:
        # a small loft becomes a prism of its widest ring, which the grown outline then carries
        s.pop('surface', None)
        s['kind'] = 'prism'
        g = poly.buffer(best + .05, join_style=2)
        g = shapely.geometry.polygon.orient(Polygon(g.exterior).simplify(.02), 1.0)
        s['footprint'] = [[round(x, 3), round(z, 3)] for x, z in list(g.exterior.coords)[:-1]]
        supported.add(id(s))
        grown += 1
print(grown, 'free-standing small blocks carried to their neighbours')

structures.sort(key=lambda s: (s['bounds'][1], s['baseY']))
for i, s in enumerate(structures):
    s['id'] = f"{'deckhouse' if s['height'] >= .6 else 'platform'}-{i + 1:03d}"
json.dump(dict(zShift=SHIFT, structures=structures), open(args[2], 'w'))
print(len(structures), 'structures;', sum(1 for s in structures if s['kind'] == 'loft'), 'lofted;',
      sum(len(s['footprint']) for s in structures), 'footprint points;', sum(len(s.get('surface', {}).get('triangles', [])) for s in structures), 'surface triangles')

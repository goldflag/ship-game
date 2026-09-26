"""Nagato guard rails: stanchions and two courses along the exposed deck edges (forecastle head, forecastle deck
block, upper deck aft) and round the exposed roof edges of the measured superstructure prisms. Rails stay out of
the gun arcs and from under turning gunhouses (Kit.in_arc)."""
import math
from mathutils import Vector
from nagato_kit import ZC
from nagato_tiers import TIERS


def rail3(kit, assembly, col, pts, height=1.0, spacing=1.5):
    """Rail along a polyline of authoring points (x, y, deck z), following the deck's own sheer."""
    for a, b in zip(pts, pts[1:]):
        a, b = Vector(a), Vector(b)
        seg = (b - a).length
        if seg < 1e-3:
            continue
        for h in (height * .5, height):
            kit.wire(assembly, col, tuple(a + Vector((0, 0, h))), tuple(b + Vector((0, 0, h))), .016)
        n = max(1, round(seg / spacing))
        for i in range(n):
            p = a.lerp(b, i / n)
            kit.wire(assembly, col, tuple(p), tuple(p + Vector((0, 0, height))), .022)
    if len(pts) > 1:
        p = Vector(pts[-1])
        kit.wire(assembly, col, tuple(p), tuple(p + Vector((0, 0, height))), .022)


def _inside(poly, x, z):
    c = False
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            c = not c
    return c


def _nearest(poly, x, z):
    best = (1e9, x, z)
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        dx, dz = bx - ax, bz - az
        t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / max(1e-12, dx * dx + dz * dz)))
        px, pz = ax + t * dx, az + t * dz
        d = math.hypot(x - px, z - pz)
        if d < best[0]:
            best = (d, px, pz)
    return best


def _samples(poly, step):
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))
    turn = 1 if area > 0 else -1
    out = []
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        L = math.hypot(bx - ax, bz - az)
        if L < 1e-6:
            continue
        nx, nz = -(bz - az) / L * turn, (bx - ax) / L * turn
        n = max(1, int(L / step))
        for i in range(n):
            t = i / n
            out.append((ax + (bx - ax) * t, az + (bz - az) * t, nx, nz))
    return out


def _corners(pts, degrees=8):
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        u = (b[0] - a[0], b[1] - a[1])
        v = (c[0] - b[0], c[1] - b[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        if lu < 1e-9 or lv < 1e-9:
            continue
        if (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < math.cos(math.radians(degrees)):
            out.append(b)
    out.append(pts[-1])
    return out


def roof_rails(kit, col, structures, zone, height=1.0, inset=.08, clearance=.35, only=None, exclude=None):
    """Rails round every exposed roof edge of the structures whose middle lies in zone(x, top, z) (runtime frame);
    `only` limits the rails to those structure ids while every structure still counts as cover above."""
    for s in structures:
        if only is not None and s['id'] not in only:
            continue
        poly = [tuple(p) for p in s['footprint']]
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        top = s['baseY'] + s['height']
        if not zone((min(xs) + max(xs)) / 2, top, (min(zs) + max(zs)) / 2):
            continue
        above = [[tuple(p) for p in o['footprint']] for o in structures if o is not s and top - .06 <= o['baseY'] <= top + .6]
        samples = _samples(poly, .25)
        if not samples:
            continue
        flags = [not any(_inside(a, x, z) or _nearest(a, x, z)[0] < clearance for a in above) and not (exclude and exclude(x, z))
                 for x, z, _, _ in samples]
        pieces = []
        if all(flags):
            pieces.append(([(x + nx * inset, z + nz * inset) for x, z, nx, nz in samples], True))
        else:
            k0 = next((i for i in range(len(flags)) if flags[i] and not flags[i - 1]), None)
            if k0 is None:
                continue
            run = []
            for j in range(len(samples) + 1):
                i = (k0 + j) % len(samples)
                if j < len(samples) and flags[i]:
                    x, z, nx, nz = samples[i]
                    run.append((x + nx * inset, z + nz * inset))
                    continue
                if len(run) > 2:
                    pieces.append((run, False))
                run = []
        for run, closed in pieces:
            pts = _corners(run)
            if closed:
                pts = pts + [pts[0]]
            rail3(kit, s['id'], col, [(-z_, -x_, top) for x_, z_ in pts], height, 1.4)


def deck_edges(kit, D):
    """Rails along the loft's exposed deck edges: the forecastle head and the upper deck abaft the forecastle block."""
    col = kit.collections['Deck fittings']
    h = D['hull']
    secs = h['sections']
    fc = next(s for s in D['structures'] if s['id'] == 'forecastle-001')
    fc_zs = [p[1] for p in fc['footprint']]
    fc_front, fc_back = min(fc_zs), max(fc_zs)
    for side in (-1, 1):
        runs = [[]]
        for s in sorted(secs, key=lambda s: -s['station']):
            z = h['length'] / 2 - s['station']
            hb, deck = s['points'][-1]
            if hb < .6:
                continue
            # Skip the casemate shelf beside the forecastle block's wall (reference z -57.5 to 12).
            if -55.3 < z < 14.2:
                if runs[-1]:
                    runs.append([])
                continue
            runs[-1].append((-z, -side * (hb - .1), deck))
        for run in runs:
            if len(run) > 2:
                rail3(kit, 'deck-rails', col, run[::2] + ([run[-1]] if len(run) % 2 == 0 else []), 1.0, 1.6)
    # The forecastle block's deck edge (the casemate walkway) where nothing stands on it.
    roof_rails(kit, col, D['structures'], lambda x, y, z: True, 1.0, .1, .5, only={'forecastle-001'}, exclude=lambda x, z: z < fc_front + .8)


def build(kit, D):
    col = kit.collections['Superstructure']
    # Open tiers carry the reference's own bulwarks instead (nagato_tiers).
    structures = [s for s in D['structures'] if not s['id'].startswith(('funnel-', 'forecastle-')) and s['id'] not in TIERS]
    roof_rails(kit, col, D['structures'], lambda x, y, z: y > 8.0, 1.0, .08, .35, only={s['id'] for s in structures})
    deck_edges(kit, D)

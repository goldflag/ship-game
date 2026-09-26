"""Bridge glazing: the portholes and windows the reference paints on its bridge, set into this recipe's own walls.

The rows (new_orleans_windows_data.py, written by authoring/windows.py) were read off orthographic renders of the
approved GameModels3D pasc107 B_Hull model's textures, with the depth of the wall each lies on (reference frame:
x starboard, y up, z toward the stern, metres). No reference geometry or texture is loaded here. Each opening is
projected along its view onto the first wall of this model that faces it; openings whose wall here stands more than
`TOLERANCE` from the reference's (a block traced differently there) or would be glazed at a grazing angle are left
out. Portholes get a rolled rim.
"""
import math

from mathutils import Vector

from new_orleans_kit import P
from new_orleans_windows_data import FRONT, SIDE

TOLERANCE = .35
PROUD, SUNK = .015, .02  # glass face in front of the wall, and how far the pane is let into it
MIN_OPENING = .15


def _openings():
    """(kind, corners of the opening as view rays [(origin, direction)], expected wall point, size)."""
    for kind, z0, z1, y0, y1, wx in SIDE:
        for sign in (1, -1):
            d = Vector((0, 1 if sign > 0 else -1, 0))  # authoring +Y is port: a ray from starboard runs toward +Y
            corners = [(Vector(P(sign * 60, y, z)), d) for z, y in ((z0, y0), (z1, y0), (z1, y1), (z0, y1))]
            yield kind, corners, Vector(P(sign * abs(wx), (y0 + y1) / 2, (z0 + z1) / 2)), (z1 - z0, y1 - y0)
    for kind, x0, x1, y0, y1, wz in FRONT:
        d = Vector((-1, 0, 0))  # from ahead (authoring +X is the bow) toward the stern
        corners = [(Vector(P(x, y, -120)), d) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        yield kind, corners, Vector(P((x0 + x1) / 2, (y0 + y1) / 2, wz)), (x1 - x0, y1 - y0)


def _plate(outline, n, proud=PROUD, sunk=SUNK):
    """A closed pane from an outline in the wall plane: its face `proud` of it, its back `sunk` into it."""
    front = [p + n * proud for p in outline]
    back = [p - n * sunk for p in outline]
    k = len(outline)
    faces = [tuple(range(k)), tuple(k + i for i in reversed(range(k)))] + [(i, k + i, k + (i + 1) % k, (i + 1) % k) for i in range(k)]
    return front + back, faces


def _ring(centre, a, b, r0, r1, n, face, back):
    """A flat rim round a porthole: inner radius r0, outer r1, standing `face` proud and let `back` into the wall."""
    vv, ff = [], []
    for i in range(n):
        t = math.tau * i / n
        u = a * math.cos(t) + b * math.sin(t)
        for r in (r0, r1):
            vv.append(centre + u * r)
    nrm = a.cross(b)
    out = [v + nrm * face for v in vv] + [v - nrm * back for v in vv]
    m = 2 * n
    for i in range(n):
        j = (i + 1) % n
        ff.append((2 * i, 2 * i + 1, 2 * j + 1, 2 * j))                     # face
        ff.append((m + 2 * i, m + 2 * j, m + 2 * j + 1, m + 2 * i + 1))     # back
        ff.append((2 * i + 1, m + 2 * i + 1, m + 2 * j + 1, 2 * j + 1))     # outer edge
        ff.append((2 * i, 2 * j, m + 2 * j, m + 2 * i))                     # inner edge
    return out, ff


def build(D, kit):
    tree = kit.support.tree
    panes, skipped = [], 0
    for kind, corners, expect, (w, h) in _openings():
        if min(w, h) < MIN_OPENING:
            skipped += 1
            continue
        o = sum((c[0] for c in corners), Vector()) / 4
        d = corners[0][1]
        hit, n, _, _ = tree.ray_cast(o, d, 200)
        if hit is None or (hit - expect).dot(d) ** 2 > TOLERANCE ** 2:
            skipped += 1
            continue
        n = n.normalized()
        if n.dot(d) > 0:
            n = -n
        facing = -n.dot(d)
        if facing < .35:
            skipped += 1
            continue
        if kind == 'window':
            outline = [oc + dc * ((hit - oc).dot(n) / dc.dot(n)) for oc, dc in corners]
            a = b = None
        else:
            a = Vector((0, 0, 1)).cross(n)
            if a.length < .2:
                skipped += 1
                continue
            a.normalize()
            b = n.cross(a)
            r = min(w, h) / 2
            outline = [hit + r * (a * math.cos(math.tau * i / 12) + b * math.sin(math.tau * i / 12)) for i in range(12)]
        # The pane's own outline must lie on the wall: every corner finds the wall within 6 cm.
        if any(tree.ray_cast(p + n * .1, -n, .16)[0] is None for p in outline):
            skipped += 1
            continue
        panes.append((facing, hit, max(w, h), outline, n, kind, a, b, min(w, h) / 2))
    # A window seen in both views (a canted face) is glazed once, from the view that faces it best.
    kept = []
    for pane in sorted(panes, key=lambda p: -p[0]):
        if all((pane[1] - k[1]).length > .6 * max(pane[2], k[2]) for k in kept):
            kept.append(pane)
    vv, ff, rv, rf = [], [], [], []
    for _, hit, _, outline, n, kind, a, b, r in kept:
        v, f = _plate(outline, n)
        ff += [tuple(len(vv) + i for i in face) for face in f]
        vv += [tuple(p) for p in v]
        if kind == 'porthole':
            v, f = _ring(hit, a, b, r * .98, r * 1.3, 12, .035, .02)
            rf += [tuple(len(rv) + i for i in face) for face in f]
            rv += [tuple(p) for p in v]
    col = kit.collections['Superstructure']
    if vv:
        kit.tag(kit.mesh('bridge-glazing.glass', vv, ff, 'glass', col), 'bridge-glazing')
    if rv:
        kit.tag(kit.mesh('bridge-glazing.porthole rims', rv, rf, 'edge', col), 'bridge-glazing')
    print('New Orleans bridge glazing:', len(kept), 'openings glazed,', len(panes) - len(kept), 'duplicates,', skipped, 'left out')

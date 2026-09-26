"""Glazing: the windows and portholes the reference paints on its bridge, deckhouses and hull, set into
this recipe's own walls.

The rows were read off orthographic textured renders of the approved GameModels3D pasc106 model, with
the depth of the wall each lies on (reference frame: x starboard, y up, z toward the stern, metres);
`.build/pensacola/measure/windows_detect.py` and `windows_table.py` regenerate them. No reference
geometry or texture is loaded here. Each opening is projected along its view onto the first wall of
this model that faces it; openings whose wall here stands more than `TOLERANCE` from the reference's
(a block traced differently there, a searchlight or gun port seen in front of a wall) or would be
glazed at a grazing angle are left out. Portholes get a rolled rim (a scuttle, seated on the plating
by the shared wall-fitting pass); windows are panes let into the wall.
"""
import math
from mathutils import Vector
from pensacola_kit import P

TOLERANCE = .35
PROUD, SUNK = .015, .02  # glass face in front of the wall, and how far the pane is let into it
MIN_OPENING = .18

# ---- measured openings (written by .build/pensacola/measure/windows_table.py)
# (kind, z0, z1, y0, y1, port wall x): seen from port, mirrored to starboard.
SIDE = [
    ('porthole', -52.7, -52.54, 1.26, 1.42, -4.812),
    ('porthole', -44.32, -44.08, 8.96, 9.24, -4.056),
    ('porthole', -41.84, -41.58, 6.54, 6.84, -5.394),
    ('porthole', -41.84, -41.58, 8.8, 9.08, -5.393),
    ('porthole', -41.48, -41.32, 0.78, 0.94, -6.479),
    ('porthole', -40.8, -40.54, 6.5, 6.8, -5.953),
    ('porthole', -40.8, -40.54, 8.76, 9.04, -5.952),
    ('porthole', -38.5, -38.12, 8.64, 9.02, -6.361),
    ('porthole', -37.28, -36.9, 6.34, 6.72, -6.361),
    ('porthole', -37.28, -36.9, 8.6, 9.0, -6.361),
    ('porthole', -36.06, -35.68, 6.3, 6.68, -6.361),
    ('porthole', -34.84, -34.46, 6.26, 6.64, -6.361),
    ('porthole', -34.84, -34.46, 8.54, 8.94, -6.361),
    ('porthole', -33.6, -33.2, 8.5, 8.9, -6.361),
    ('porthole', -33.58, -33.2, 6.22, 6.6, -6.361),
    ('porthole', -33.24, -32.94, 10.94, 11.32, -1.548),
    ('porthole', -32.88, -32.58, 3.62, 3.9, -8.099),
    ('porthole', -32.34, -31.96, 6.18, 6.58, -6.361),
    ('porthole', -32.34, -31.96, 8.48, 8.88, -6.361),
    ('porthole', -31.64, -31.26, 5.76, 6.06, -6.439),
    ('porthole', -31.6, -31.32, 3.56, 3.86, -8.193),
    ('porthole', -31.12, -30.74, 6.16, 6.54, -6.361),
    ('porthole', -31.12, -30.74, 8.44, 8.84, -6.361),
    ('porthole', -29.84, -29.46, 6.12, 6.52, -6.361),
    ('porthole', -29.84, -29.46, 8.4, 8.8, -6.361),
    ('porthole', -28.56, -28.16, 8.4, 8.74, -6.361),
    ('porthole', -28.42, -28.22, 16.4, 16.66, -4.647),
    ('porthole', -28.06, -27.72, 16.26, 16.64, -2.086),
    ('porthole', -27.88, -27.58, 3.4, 3.7, -8.415),
    ('porthole', -27.28, -26.88, 10.92, 11.32, -3.678),
    ('porthole', -27.24, -26.86, 8.38, 8.76, -6.361),
    ('porthole', -26.52, -26.34, 21.74, 21.98, -1.044),
    ('porthole', -26.52, -26.22, 3.38, 3.66, -8.52),
    ('porthole', -26.34, -26.14, 21.74, 21.98, -1.233),
    ('porthole', -26.34, -26.14, 22.02, 22.28, -1.232),
    ('porthole', -24.1, -23.82, 3.3, 3.58, -8.741),
    ('porthole', -22.28, -22.02, 16.56, 16.84, -7.623),
    ('porthole', -21.84, -21.54, 3.24, 3.52, -8.829),
    ('porthole', -20.38, -20.02, 8.18, 8.54, -3.849),
    ('porthole', -19.46, -19.18, 3.22, 3.5, -8.995),
    ('porthole', -17.58, -17.28, 3.18, 3.46, -9.016),
    ('porthole', -15.12, -14.84, 3.1, 3.38, -9.112),
    ('porthole', -12.54, -12.26, 3.1, 3.38, -9.136),
    ('porthole', -10.22, -9.94, 3.06, 3.34, -9.156),
    ('porthole', -6.74, -6.46, 3.06, 3.34, -9.182),
    ('porthole', -2.64, -2.36, 2.94, 3.22, -9.228),
    ('porthole', -0.04, 0.24, 2.9, 3.18, -9.253),
    ('porthole', 5.4, 5.68, 2.94, 3.22, -9.277),
    ('porthole', 6.7, 6.98, 2.9, 3.18, -9.279),
    ('porthole', 8.04, 8.42, 5.4, 5.78, -9.099),
    ('porthole', 8.32, 8.6, 2.9, 3.18, -9.278),
    ('porthole', 9.26, 9.64, 5.4, 5.78, -9.099),
    ('porthole', 10.54, 10.92, 5.4, 5.78, -9.099),
    ('porthole', 11.12, 11.4, 2.88, 3.16, -9.277),
    ('porthole', 11.82, 12.2, 5.4, 5.78, -9.099),
    ('porthole', 13.04, 13.32, 2.88, 3.16, -9.275),
    ('porthole', 13.12, 13.52, 5.4, 5.78, -9.099),
    ('porthole', 14.38, 14.76, 5.4, 5.78, -9.099),
    ('porthole', 14.72, 15.0, 2.84, 3.14, -9.276),
    ('porthole', 15.7, 16.08, 5.44, 5.82, -9.099),
    ('porthole', 16.98, 17.36, 5.44, 5.82, -9.099),
    ('porthole', 17.5, 17.8, 2.86, 3.14, -9.268),
    ('porthole', 19.52, 19.82, 2.86, 3.14, -9.262),
    ('porthole', 22.22, 22.52, 5.44, 5.72, -9.099),
    ('porthole', 23.82, 24.1, 5.44, 5.72, -9.099),
    ('porthole', 24.28, 24.56, 2.78, 3.08, -9.253),
    ('porthole', 25.16, 25.44, 5.44, 5.72, -9.099),
    ('porthole', 26.5, 26.8, 5.44, 5.72, -9.099),
    ('porthole', 26.82, 27.12, 2.76, 3.04, -9.248),
    ('porthole', 27.9, 28.2, 5.42, 5.72, -9.099),
    ('porthole', 29.16, 29.44, 2.78, 3.08, -9.238),
    ('porthole', 31.74, 32.02, 2.8, 3.08, -9.189),
    ('porthole', 34.1, 34.38, 2.8, 3.08, -9.136),
    ('porthole', 36.54, 36.84, 2.8, 3.08, -9.069),
    ('porthole', 39.46, 40.08, 4.0, 4.6, -7.89),
    ('porthole', 40.12, 40.4, 2.8, 3.08, -8.951),
    ('porthole', 40.46, 40.64, 16.8, 16.96, -3.098),
    ('porthole', 40.66, 40.84, 16.8, 16.96, -3.098),
    ('porthole', 42.04, 42.28, 13.16, 13.44, -2.108),
    ('porthole', 43.58, 43.74, 0.42, 0.58, -9.013),
    ('porthole', 44.34, 44.62, 2.74, 3.04, -8.781),
    ('porthole', 45.1, 45.48, 5.36, 5.74, -7.399),
    ('porthole', 47.16, 47.46, 2.7, 2.98, -8.674),
    ('porthole', 49.38, 49.66, 2.72, 3.0, -8.569),
    ('porthole', 51.1, 51.4, 2.72, 3.02, -8.461),
    ('porthole', 52.82, 53.1, 2.76, 3.04, -8.347),
    ('porthole', 73.38, 73.54, 0.46, 0.64, -6.606),
    ('window', -45.24, -44.92, 11.52, 12.18, -1.512),
    ('window', -35.22, -34.92, 19.96, 20.2, -1.283),
    ('window', -34.58, -34.3, 20.42, 20.64, -1.305),
    ('window', -33.72, -33.28, 16.38, 17.0, -1.204),
    ('window', -33.2, -32.74, 16.38, 17.0, -1.583),
    ('window', -32.5, -32.06, 16.38, 17.0, -2.076),
    ('window', -31.98, -31.52, 16.38, 17.0, -2.455),
    ('window', -31.08, -30.48, 16.38, 17.0, -2.733),
    ('window', -26.52, -26.34, 22.02, 22.28, -1.043),
    ('window', 40.74, 41.02, 18.72, 18.94, -1.311),
    ('window', 41.36, 41.64, 18.26, 18.5, -1.284),
]
# (kind, x0, x1, y0, y1, wall z): seen from ahead.
FRONT = [
    ('porthole', -9.6, -9.44, 7.24, 7.44, 22.157),
    ('porthole', -4.74, -4.54, 16.4, 16.66, -28.327),
    ('porthole', -2.16, -1.86, 12.34, 12.74, -43.861),
    ('porthole', -1.32, -1.14, 21.74, 21.98, -26.244),
    ('porthole', -1.14, -0.94, 21.74, 21.98, -26.433),
    ('porthole', -1.14, -0.92, 22.02, 22.28, -26.44),
    ('porthole', 0.94, 1.12, 22.02, 22.26, -26.442),
    ('porthole', 0.94, 1.14, 21.74, 21.98, -26.433),
    ('porthole', 2.44, 2.62, 19.16, 19.38, -28.482),
    ('window', -2.64, -2.34, 16.38, 17.08, -31.701),
    ('window', -2.26, -1.94, 16.38, 17.08, -32.246),
    ('window', -1.76, -1.46, 16.38, 17.08, -32.932),
    ('window', -1.38, -1.08, 16.38, 17.08, -33.464),
    ('window', -1.32, -1.14, 22.02, 22.28, -26.243),
    ('window', -0.92, -0.64, 19.98, 20.2, -35.576),
    ('window', -0.66, -0.38, 31.66, 31.98, -29.094),
    ('window', -0.62, -0.02, 16.38, 17.08, -33.871),
    ('window', 0.02, 0.62, 16.38, 17.08, -33.871),
    ('window', 0.38, 0.64, 31.66, 31.98, -29.094),
    ('window', 0.64, 0.9, 19.98, 20.2, -35.576),
    ('window', 1.08, 1.38, 16.38, 17.08, -33.464),
    ('window', 1.46, 1.76, 16.38, 17.08, -32.932),
    ('window', 1.86, 2.16, 12.34, 12.82, -43.861),
    ('window', 1.96, 2.24, 16.38, 17.08, -32.246),
    ('window', 2.34, 2.62, 16.38, 17.08, -31.715),
    ('window', 3.88, 4.2, 12.6, 13.34, -36.697),
    ('window', 4.56, 4.72, 16.4, 16.64, -28.327),
]
# ---- end of measured openings


def _openings():
    """(kind, corners of the opening as view rays [(origin, direction)], expected wall point, view)."""
    for kind, z0, z1, y0, y1, wx in SIDE:
        for sign in (-1, 1):
            d = Vector((0, 1 if sign > 0 else -1, 0))  # authoring +Y is port: rays run inboard
            corners = [(Vector(P(sign * 60, y, z)), d) for z, y in ((z0, y0), (z1, y0), (z1, y1), (z0, y1))]
            yield kind, corners, Vector(P(sign * abs(wx), (y0 + y1) / 2, (z0 + z1) / 2)), (z1 - z0, y1 - y0)
    for kind, x0, x1, y0, y1, wz in FRONT:
        d = Vector((-1, 0, 0))
        corners = [(Vector(P(x, y, -120)), d) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        yield kind, corners, Vector(P((x0 + x1) / 2, (y0 + y1) / 2, wz)), (x1 - x0, y1 - y0)


def _plate(outline, n):
    """A closed pane from an outline in the wall plane: glass face PROUD of it, back SUNK into it."""
    front = [p + n * PROUD for p in outline]
    back = [p - n * SUNK for p in outline]
    k = len(outline)
    faces = [tuple(range(k)), tuple(k + i for i in reversed(range(k)))] + [(i, k + i, k + (i + 1) % k, (i + 1) % k) for i in range(k)]
    return front + back, faces


def _rim(centre, n, r, a, b):
    """A rolled scuttle rim: a flat ring 6 cm wide standing 3 cm proud round the glass."""
    vv, ff = [], []
    k = 14
    for depth in (-.01, .03):
        for rr in (r, r + .06):
            for i in range(k):
                ang = math.tau * i / k
                vv.append(tuple(centre + n * depth + rr * (a * math.cos(ang) + b * math.sin(ang))))
    # rings: 0 inner back, 1 outer back, 2 inner front, 3 outer front
    ring = lambda q, i: q * k + i % k
    for i in range(k):
        ff.append((ring(2, i), ring(3, i), ring(3, i + 1), ring(2, i + 1)))
        ff.append((ring(3, i), ring(1, i), ring(1, i + 1), ring(3, i + 1)))
        ff.append((ring(0, i), ring(2, i), ring(2, i + 1), ring(0, i + 1)))
        ff.append((ring(1, i), ring(0, i), ring(0, i + 1), ring(1, i + 1)))
    return vv, ff


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
        a = b = None
        if kind == 'window':
            outline = [oc + dc * ((hit - oc).dot(n) / dc.dot(n)) for oc, dc in corners]
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
    # An opening seen in both views (a canted face) is glazed once, from the view that faces it best.
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
            v, f = _rim(hit, n, r, a, b)
            rf += [tuple(len(rv) + i for i in face) for face in f]
            rv += v
    col = kit.collections['Superstructure']
    if vv:
        kit.tag(kit.mesh('glazing.glass', vv, ff, 'glass', col), 'glazing')
    if rv:
        kit.tag(kit.mesh('portholes scuttle rim', rv, rf, 'edge', col), 'glazing')
    print('Pensacola glazing:', len(kept), 'openings glazed,', len(panes) - len(kept), 'duplicates,', skipped, 'left out')

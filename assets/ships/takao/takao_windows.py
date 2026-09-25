"""Bridge glazing: the windows and portholes the reference paints on its bridge, set into this recipe's
own walls.

The rows were read off orthographic renders of the approved GameModels3D pjsc708 model's textures,
with the depth of the wall each lies on (reference frame: x starboard, y up, z toward the stern,
metres); `.build/takao/windows_detect.py` and `windows_depth.py` regenerate them. No reference
geometry or texture is loaded here. Each opening is projected along its view onto the first wall of
this model that faces it; openings whose wall here stands more than `TOLERANCE` from the reference's
(a block traced differently there) or would be glazed at a grazing angle are left out.
"""
import math
from mathutils import Vector
from takao_kit import P

TOLERANCE = .35
PROUD, SUNK = .015, .02  # glass face in front of the wall, and how far the pane is let into it
MIN_OPENING = .2

# (kind, z0, z1, y0, y1, port wall x): seen from port, mirrored to starboard.
SIDE = [
    ('window', -26.744, -26.556, 19.163, 19.875, -0.481),
    ('window', -26.462, -25.863, 19.444, 19.875, -0.819),
    ('window', -25.806, -25.206, 19.444, 19.875, -1.011),
    ('porthole', -21.231, -20.931, 19.106, 19.425, -1.806),
    ('window', -26.462, -25.863, 18.956, 19.387, -0.819),
    ('window', -25.806, -25.206, 18.956, 19.387, -1.011),
    ('window', -29.462, -29.012, 16.444, 16.875, -1.806),
    ('window', -28.938, -28.506, 16.444, 16.875, -2.299),
    ('window', -28.45, -28.038, 16.444, 16.875, -2.758),
    ('window', -27.869, -27.288, 16.444, 16.875, -3.014),
    ('window', -27.212, -26.594, 16.444, 16.875, -2.98),
    ('window', -26.519, -25.844, 16.444, 16.875, -2.943),
    ('porthole', -24.025, -23.669, 16.069, 16.406, -1.229),
    ('porthole', -22.9, -22.6, 16.087, 16.406, -1.693),
    ('window', -29.462, -29.012, 15.975, 16.387, -1.806),
    ('window', -28.938, -28.506, 15.975, 16.387, -2.299),
    ('window', -28.45, -28.038, 15.975, 16.387, -2.758),
    ('window', -27.869, -27.288, 15.975, 16.387, -3.014),
    ('window', -27.212, -26.594, 15.975, 16.387, -2.98),
    ('window', -26.519, -25.844, 15.975, 16.387, -2.943),
    ('window', -21.156, -20.837, 15.863, 16.181, -2.283),
    ('porthole', -28.694, -28.375, 13.988, 14.306, -2.144),
    ('porthole', -22.431, -22.113, 13.537, 13.856, -3.235),
    ('window', -24.663, -24.344, 13.537, 13.838, -3.224),
    ('porthole', -27.175, -26.856, 13.5, 13.819, -2.594),
    ('window', -19.225, -18.887, 13.463, 13.781, -3.248),
    ('porthole', -20.669, -20.331, 13.444, 13.762, -3.252),
    ('porthole', -26.294, -25.994, 13.331, 13.65, -2.838),
    ('porthole', -30.156, -29.95, 11.306, 11.569, -2.971),
    ('porthole', -16.788, -16.488, 11.231, 11.55, -5.601),
    ('porthole', -25.15, -24.812, 9.075, 9.394, -5.833),
    ('porthole', -23.837, -23.519, 9.038, 9.356, -5.85),
    ('porthole', -29.406, -29.087, 8.963, 9.319, -4.779),
    ('porthole', -19.506, -19.188, 7.556, 7.875, -5.995),
]
# (kind, x0, x1, y0, y1, wall z): seen from ahead.
FRONT = [
    ('porthole', 1.215, 1.395, 22.215, 22.395, -22.332),
    ('porthole', -1.395, -1.215, 22.215, 22.395, -23.894),
    ('window', 0.255, 0.645, 19.155, 19.875, -26.675),
    ('window', 0.03, 0.195, 19.155, 19.875, -26.808),
    ('window', -0.195, -0.045, 19.155, 19.875, -26.807),
    ('window', -0.645, -0.255, 19.155, 19.875, -26.675),
    ('window', -2.505, -2.1, 16.44, 16.89, -28.719),
    ('window', -2.025, -1.83, 16.44, 16.875, -29.11),
    ('window', -2.97, -2.58, 16.44, 16.875, -28.226),
    ('window', 2.58, 2.97, 16.455, 16.86, -28.226),
    ('window', 2.1, 2.505, 16.455, 16.86, -28.719),
    ('window', 1.815, 2.025, 16.455, 16.86, -29.118),
    ('window', -1.83, -1.65, 16.44, 16.83, -29.306),
    ('window', 1.155, 1.53, 16.29, 16.68, -29.462),
    ('window', 0.39, 0.72, 16.275, 16.68, -29.462),
    ('window', 0.015, 0.33, 16.275, 16.68, -29.462),
    ('window', -0.765, -0.45, 16.275, 16.68, -29.462),
    ('window', -1.065, -0.84, 16.275, 16.68, -29.462),
    ('porthole', -1.545, -1.215, 16.275, 16.68, -29.462),
    ('window', 0.78, 1.065, 16.29, 16.665, -29.462),
    ('window', -0.39, -0.06, 16.275, 16.665, -29.462),
    ('window', -1.155, -0.99, 16.275, 16.62, -29.462),
    ('window', 2.58, 2.97, 15.975, 16.38, -28.226),
    ('window', 2.1, 2.505, 15.975, 16.38, -28.719),
    ('window', 1.83, 2.025, 15.975, 16.38, -29.11),
    ('window', 1.65, 1.815, 15.975, 16.38, -29.313),
    ('window', -2.025, -1.65, 15.975, 16.38, -29.204),
    ('window', -2.505, -2.1, 15.975, 16.38, -28.719),
    ('window', -2.97, -2.58, 15.975, 16.38, -28.226),
    ('porthole', 0.81, 1.14, 13.125, 13.455, -30.426),
    ('porthole', -1.215, -0.9, 13.14, 13.455, -30.426),
    ('porthole', 2.19, 2.4, 12.99, 13.17, -30.195),
    ('porthole', -2.4, -2.205, 12.99, 13.17, -30.195),
    ('window', 1.275, 1.575, 11.625, 11.925, -30.607),
    ('porthole', 0.54, 0.87, 11.625, 11.925, -30.607),
    ('window', -0.225, -0.06, 11.61, 11.925, -30.608),
    ('porthole', -0.915, -0.6, 11.625, 11.925, -30.607),
    ('porthole', -1.575, -1.29, 11.625, 11.925, -30.607),
    ('porthole', -3.09, -2.85, 11.295, 11.565, -30.059),
    ('window', 5.955, 6.09, 9.69, 9.84, -20.966),
    ('window', -6.105, -5.955, 9.69, 9.84, -20.966),
    ('porthole', 1.26, 1.545, 9.39, 9.705, -31.146),
    ('porthole', 0.465, 0.795, 9.375, 9.705, -31.148),
    ('porthole', -0.345, -0.06, 9.375, 9.705, -31.148),
    ('porthole', -1.545, -1.215, 9.39, 9.705, -31.146),
    ('porthole', -2.355, -2.025, 9.375, 9.705, -31.148),
    ('porthole', -4.845, -4.695, 9.0, 9.195, -29.283),
]


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
        else:
            a = Vector((0, 0, 1)).cross(n)
            if a.length < .2:
                skipped += 1
                continue
            a.normalize()
            b = n.cross(a)
            r = min(w, h) / 2
            outline = [hit + r * (a * math.cos(math.tau * i / 10) + b * math.sin(math.tau * i / 10)) for i in range(10)]
        # The pane's own outline must lie on the wall: every corner finds the wall within 6 cm.
        if any(tree.ray_cast(p + n * .1, -n, .16)[0] is None for p in outline):
            skipped += 1
            continue
        panes.append((facing, hit, max(w, h), outline, n))
    # A window seen in both views (a canted face) is glazed once, from the view that faces it best.
    kept = []
    for facing, hit, size, outline, n in sorted(panes, key=lambda p: -p[0]):
        if all((hit - k[1]).length > .6 * max(size, k[2]) for k in kept):
            kept.append((facing, hit, size, outline, n))
    vv, ff = [], []
    for _, _, _, outline, n in kept:
        v, f = _plate(outline, n)
        ff += [tuple(len(vv) + i for i in face) for face in f]
        vv += [tuple(p) for p in v]
    if vv:
        ob = kit.mesh('bridge-glazing.glass', vv, ff, 'glass', kit.collections['Superstructure'])
        kit.tag(ob, 'bridge-glazing')
    print('Takao bridge glazing:', len(kept), 'openings glazed,', len(panes) - len(kept), 'duplicates,', skipped, 'left out')

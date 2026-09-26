"""Glazing: the windows and portholes the reference paints on its bridge and deckhouses, set into this recipe's own
walls.

The rows were read off orthographic renders of the approved GameModels3D pasc006 model's textures (its hull group,
seen from abeam, ahead, astern and from six bearings round the rounded bridge and after superstructure), with the
point of the wall each lies on (reference frame: x starboard, y up, z toward the stern, metres) and the bearing it
was read from (degrees clockwise from the bow). Starboard rows are mirrored to port. No reference geometry or texture
is loaded here. Each opening is projected along its view onto the first wall of this model that faces it; openings
whose wall here stands more than `TOLERANCE` from the reference's, that would be glazed at a grazing angle, or whose
outline would hang off the wall are left out.
"""
import math
from mathutils import Vector
from atlanta_kit import P

TOLERANCE = .35
PROUD, SUNK = .012, .02    # glass face in front of the wall, and how far the pane is let into it

# (kind, bearing it was read from, x, y, z of the wall point, width, height)
OPENINGS = [
    ('porthole', 90, 3.429, 7.023, -43.656, 0.31, 0.32),
    ('porthole', 90, 4.211, 6.953, -41.083, 0.3, 0.34),
    ('porthole', 0, 3.47, 8.346, -39.728, 0.27, 0.32),
    ('porthole', 90, 4.929, 6.651, -36.462, 0.32, 0.31),
    ('porthole', 75, 3.34, 9.023, -34.685, 0.25, 0.24),
    ('porthole', 90, 5.23, 6.462, -32.249, 0.33, 0.31),
    ('porthole', 90, 3.421, 8.93, -31.673, 0.26, 0.23),
    ('porthole', 90, 3.421, 8.928, -31.089, 0.25, 0.23),
    ('porthole', 90, 5.303, 6.399, -30.975, 0.32, 0.32),
    ('porthole', 90, 5.378, 6.304, -29.666, 0.32, 0.31),
    ('porthole', 90, 3.421, 8.769, -28.609, 0.25, 0.23),
    ('porthole', 0, 1.384, 12.171, -28.233, 0.27, 0.26),
    ('porthole', 90, 5.448, 6.208, -27.975, 0.32, 0.31),
    ('window', 30, -0.034, 14.461, -27.866, 0.19, 0.27),
    ('porthole', 0, 0.821, 14.473, -27.714, 0.27, 0.27),
    ('porthole', 90, 3.421, 8.771, -27.537, 0.25, 0.24),
    ('porthole', 55, 2.571, 12.149, -27.532, 0.26, 0.26),
    ('porthole', 30, 1.527, 14.46, -27.377, 0.21, 0.27),
    ('porthole', 55, 2.165, 14.474, -26.835, 0.27, 0.28),
    ('porthole', 55, 2.612, 14.473, -26.185, 0.21, 0.27),
    ('porthole', 90, 5.52, 6.067, -26.102, 0.32, 0.32),
    ('porthole', 75, 2.834, 14.481, -25.343, 0.26, 0.28),
    ('porthole', 90, 5.559, 6.007, -24.864, 0.32, 0.33),
    ('porthole', 90, 3.421, 12.109, -23.812, 0.26, 0.25),
    ('porthole', 90, 5.597, 5.979, -23.645, 0.3, 0.34),
    ('porthole', 90, 3.421, 8.447, -23.111, 0.32, 0.32),
    ('window', 0, 6.476, 10.052, -22.019, 0.28, 0.17),
    ('porthole', 90, 5.653, 5.891, -21.876, 0.33, 0.32),
    ('window', 0, 0.421, 17.309, -20.842, 0.4, 0.19),
    ('porthole', 90, 5.692, 5.828, -20.631, 0.34, 0.34),
    ('window', 55, 1.165, 17.307, -20.326, 0.4, 0.2),
    ('window', 90, 1.447, 17.309, -19.405, 0.4, 0.19),
    ('porthole', 90, 5.749, 5.765, -18.82, 0.33, 0.32),
    ('window', 90, 1.038, 17.309, -18.521, 0.31, 0.19),
    ('window', 90, 2.003, 14.354, -17.839, 0.31, 0.22),
    ('porthole', 90, 3.421, 8.184, -17.407, 0.3, 0.31),
    ('porthole', 0, 7.756, 7.633, -17.315, 0.16, 0.18),
    ('porthole', 0, 7.538, 8.299, -17.226, 0.17, 0.22),
    ('porthole', 90, 3.285, 8.182, -15.21, 0.29, 0.31),
    ('window', 55, 7.359, 7.325, -15.131, 0.3, 0.2),
    ('porthole', 90, 3.24, 11.4, -14.554, 0.24, 0.25),
    ('porthole', 90, 3.421, 5.682, -13.86, 0.24, 0.24),
    ('porthole', 90, 0.258, 18.215, -13.703, 0.19, 0.18),
    ('porthole', 90, 3.074, 11.38, -13.37, 0.23, 0.25),
    ('porthole', 90, 7.411, 7.297, -12.871, 0.18, 0.16),
    ('window', 90, 3.421, 5.743, -12.508, 0.27, 0.2),
    ('porthole', 90, 3.421, 5.673, -11.343, 0.3, 0.33),
    ('window', 30, 2.886, 5.611, -7.869, 0.16, 0.32),
    ('window', 90, 5.013, 7.101, -5.235, 0.75, 0.35),
    ('porthole', 90, 5.187, 5.49, -4.791, 0.32, 0.32),
    ('porthole', 90, 5.187, 5.446, -2.99, 0.33, 0.32),
    ('porthole', 90, 5.187, 5.434, -0.485, 0.32, 0.32),
    ('porthole', 90, 5.187, 5.436, 1.801, 0.32, 0.34),
    ('porthole', 90, 0.368, 8.966, 2.243, 0.2, 0.26),
    ('porthole', 90, 5.187, 5.444, 3.754, 0.34, 0.32),
    ('porthole', 90, 1.091, 14.327, 4.646, 0.16, 0.18),
    ('porthole', 90, 1.259, 14.282, 5.064, 0.28, 0.31),
    ('window', 90, 5.187, 5.426, 6.776, 0.17, 0.32),
    ('porthole', 90, 5.187, 5.411, 8.623, 0.34, 0.31),
    ('porthole', 90, 0.515, 14.935, 11.11, 0.19, 0.2),
    ('porthole', 90, 2.234, 7.798, 12.489, 0.33, 0.33),
    ('porthole', 90, 2.234, 7.799, 14.633, 0.33, 0.33),
    ('porthole', 90, 2.234, 7.797, 15.945, 0.34, 0.32),
    ('porthole', 90, 2.234, 5.189, 16.937, 0.34, 0.31),
    ('porthole', 90, 2.234, 7.797, 17.646, 0.34, 0.34),
    ('porthole', 90, 2.234, 5.19, 18.827, 0.32, 0.32),
    ('porthole', 90, 2.234, 10.308, 19.301, 0.26, 0.25),
    ('window', 105, 1.339, 13.31, 19.543, 0.4, 0.19),
    ('porthole', 90, 2.234, 7.797, 19.703, 0.33, 0.32),
    ('window', 180, 0.557, 13.309, 20.38, 0.38, 0.19),
    ('porthole', 90, 2.234, 5.189, 20.621, 0.33, 0.32),
    ('porthole', 90, 2.234, 10.312, 21.194, 0.25, 0.24),
    ('porthole', 90, 2.234, 10.309, 22.633, 0.27, 0.25),
    ('porthole', 90, 2.234, 7.797, 22.755, 0.33, 0.33),
    ('porthole', 90, 2.234, 7.798, 24.263, 0.33, 0.34),
    ('porthole', 90, 2.234, 7.797, 25.059, 0.32, 0.32),
    ('porthole', 180, 1.528, 9.802, 26.666, 0.17, 0.16),
    ('porthole', 125, 0.048, 9.621, 27.554, 0.16, 0.19),
    ('porthole', 90, 2.234, 5.239, 28.092, 0.33, 0.31),
    ('porthole', 90, 2.234, 5.235, 29.307, 0.33, 0.32),
    ('window', 125, 1.022, 5.234, 30.385, 0.2, 0.34),
]


def _frame(n):
    """Horizontal and vertical unit axes in the plane of a wall with outward normal n."""
    a = Vector((0, 0, 1)).cross(n)
    if a.length < .2:
        return None
    a.normalize()
    return a, n.cross(a)


def _disc(centre, a, b, r, k=12):
    return [centre + r * (a * math.cos(math.tau * i / k) + b * math.sin(math.tau * i / k)) for i in range(k)]


def _prism(vv, ff, ring, n, front, back):
    """A closed slab from a planar outline, `front` proud of it and `back` behind it along n."""
    base = len(vv)
    k = len(ring)
    vv += [p + n * front for p in ring] + [p - n * back for p in ring]
    ff += [tuple(base + i for i in range(k)), tuple(base + k + i for i in reversed(range(k)))]
    ff += [(base + i, base + k + i, base + k + (i + 1) % k, base + (i + 1) % k) for i in range(k)]


def _ring(vv, ff, centre, a, b, r0, r1, n, front, k=12, start=0.0, stop=math.tau):
    """A flat annulus (or an arc of one) standing `front` proud of the wall."""
    full = stop - start >= math.tau - 1e-6
    m = k if full else k + 1
    base = len(vv)
    for i in range(m):
        t = start + (stop - start) * i / k
        d = a * math.cos(t) + b * math.sin(t)
        vv += [centre + d * r0 + n * front, centre + d * r1 + n * front, centre + d * r1 - n * SUNK, centre + d * r0 - n * SUNK]
    for i in range(k):
        j = (i + 1) % m if full else i + 1
        p, q = base + 4 * i, base + 4 * j
        ff += [(p, p + 1, q + 1, q), (p + 1, p + 2, q + 2, q + 1), (p + 3, p, q, q + 3)]
    if not full:
        e = base + 4 * k
        ff += [(base + 3, base + 2, base + 1, base), (e, e + 1, e + 2, e + 3)]


def build(D, kit):
    tree = kit.support.tree
    glass_v, glass_f, rim_v, rim_f = [], [], [], []
    placed, skipped = 0, 0
    for kind, bearing, x, y, z, w, h in OPENINGS:
        for sign in ((1, -1) if x > .05 else (1,)):
            az = math.radians(bearing * sign)
            d = Vector((-math.cos(az), math.sin(az), 0))           # authoring frame: the view ray toward the wall
            expect = Vector(P(sign * x, y, z))
            origin = expect - d * 2.0
            hit, n, _, dist = tree.ray_cast(origin, d, 4.0)
            if hit is None or abs(dist - 2.0) > TOLERANCE:
                skipped += 1
                continue
            n = n.normalized()
            if n.dot(d) > 0:
                n = -n
            if -n.dot(d) < .5:
                skipped += 1
                continue
            axes = _frame(n)
            if axes is None:
                skipped += 1
                continue
            a, b = axes
            if kind == 'porthole':
                r = max(.11, min(.19, min(w, h) * .52))
                outline = _disc(hit, a, b, r + .06, 10)
            else:
                outline = [hit + a * (sa * w / 2) + b * (sb * h / 2) for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            # The opening's own outline must lie on the wall: every point finds the wall within 6 cm.
            if any(tree.ray_cast(p + n * .1, -n, .16)[0] is None for p in outline):
                skipped += 1
                continue
            if kind == 'porthole':
                _prism(glass_v, glass_f, _disc(hit, a, b, r, 12), n, PROUD, SUNK)
                _ring(rim_v, rim_f, hit, a, b, r, r + .055, n, .035, 12)
                _ring(rim_v, rim_f, hit, a, b, r + .09, r + .13, n, .06, 6, math.radians(15), math.radians(165))
            else:
                _prism(glass_v, glass_f, outline, n, PROUD, SUNK)
                for i in range(4):
                    p, q = outline[i], outline[(i + 1) % 4]
                    e = (q - p).normalized()
                    s = n.cross(e).normalized() * .03
                    bar = [p - e * .03 - s, q + e * .03 - s, q + e * .03 + s, p - e * .03 + s]
                    _prism(rim_v, rim_f, bar, n, .03, SUNK)
            placed += 1
    if glass_v:
        kit.tag(kit.mesh('deckhouse-glazing.glass', [tuple(v) for v in glass_v], glass_f, 'glass', kit.collections['Superstructure']), 'deckhouse-glazing')
    if rim_v:
        kit.tag(kit.mesh('deckhouse-glazing.frames', [tuple(v) for v in rim_v], rim_f, 'naval', kit.collections['Superstructure']), 'deckhouse-glazing')
    print('Atlanta glazing:', placed, 'openings glazed,', skipped, 'left out')

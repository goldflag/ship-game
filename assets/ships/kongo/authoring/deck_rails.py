"""Original deck-edge rails, interrupted by the authored casemate openings."""
import math


def outside_openings(a, b, openings):
    """Clip a rail span to the deck remaining outside each recess footprint."""
    def cross(u, v):
        return u[0] * v[1] - u[1] * v[0]

    def inside(p, polygon):
        result = False
        for c, d in zip(polygon, polygon[1:] + polygon[:1]):
            if (c[1] > p[1]) != (d[1] > p[1]):
                if p[0] < c[0] + (p[1] - c[1]) * (d[0] - c[0]) / (d[1] - c[1]):
                    result = not result
        return result

    direction = (b[0] - a[0], b[1] - a[1])
    cuts = {0.0, 1.0}
    for polygon in openings:
        for c, d in zip(polygon, polygon[1:] + polygon[:1]):
            edge = (d[0] - c[0], d[1] - c[1])
            denominator = cross(direction, edge)
            if abs(denominator) < 1e-10:
                continue
            offset = (c[0] - a[0], c[1] - a[1])
            t = cross(offset, edge) / denominator
            u = cross(offset, direction) / denominator
            if 0 < t < 1 and 0 <= u <= 1:
                cuts.add(t)
    point = lambda t: (a[0] + t * direction[0], a[1] + t * direction[1])
    cuts = sorted(cuts)
    for lo, hi in zip(cuts, cuts[1:]):
        if any(inside(point((lo + hi) / 2), polygon) for polygon in openings):
            continue
        # Keep the whole terminal post on the remaining deck, including its radius.
        margin = .04 / math.dist(a, b)
        lo += margin if lo > 0 else 0
        hi -= margin if hi < 1 else 0
        if hi > lo:
            yield point(lo), point(hi)


def create(rod, mats, deck, width, openings):
    for sign in [-1, 1]:
        for start, end in [(-109, -33), (53, 109)]:
            points = [(x, sign * (width(x) - .14)) for x in range(start, end + 1, 2)]
            posts = set()
            for a, b in zip(points, points[1:]):
                for c, d in outside_openings(a, b, openings):
                    posts.update([c, d])
                    # Keep wire heights while extending the posts into the cambered skin.
                    for height in [.46, .91]:
                        rod('deck.rail-wire', (*c, deck(c[0]) + height),
                            (*d, deck(d[0]) + height), .014, mats['edge'], vertices=5)
            for x, y in sorted(posts):
                rod('deck.rail-post', (x, y, deck(x)), (x, y, deck(x) + .91),
                    .026, mats['naval'], vertices=6)

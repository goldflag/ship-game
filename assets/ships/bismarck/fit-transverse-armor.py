"""Fit the six original transverse plate IDs to the authored hull sections.

Run explicitly after a hull edit, then compile/review the changed blueprint.
This edits authoring data; the renderer and simulation consume the same polygons.
Thickness is normal to the transverse mid-surface. Intersect section half-planes
at both solid faces, leaving 25 mm of clearance inside the reconstructed shell.
The resulting convex inscribed boundaries are estimates, not builder offsets.
"""
import json
from pathlib import Path

path = Path(__file__).with_name('blueprint.json')
blueprint = json.loads(path.read_text())
hull = blueprint['hull']
CLEARANCE = .025


def section(z):
    station = hull['length'] / 2 - z
    for a, b in zip(hull['sections'], hull['sections'][1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / (b['station'] - a['station'])
            return [(w + (ww-w)*t, y + (yy-y)*t)
                    for (w, y), (ww, yy) in zip(a['points'], b['points'])]
    raise ValueError(f'Transverse station outside hull: {station}')


def clip(points, distance):
    result = []
    for a, b in zip(points, points[1:] + points[:1]):
        da, db = distance(a), distance(b)
        if da >= 0:
            result.append(a)
        if (da >= 0) != (db >= 0):
            t = da / (da-db)
            result.append(tuple(u + (v-u)*t for u, v in zip(a, b)))
    return result


for plate in blueprint['armor']:
    if not plate['id'].startswith(('forward-transverse-', 'aft-transverse-')):
        continue
    z = plate['center'][2]
    half = plate['thicknessMm'] / 2000
    zs = [z-half, z+half] + [hull['length']/2-s['station'] for s in hull['sections']
                            if z-half < hull['length']/2-s['station'] < z+half]
    sections = [section(zz) for zz in zs]
    layer = int(plate['id'].rsplit('-', 1)[1])
    low, high = [(-7.6, -3.4), (-3.4, .97), (.97, 5.67)][layer]
    low = max(low, max(s[0][1] for s in sections) + CLEARANCE)
    high = min(high, min(s[-1][1] for s in sections) - CLEARANCE)
    points = [(-hull['beam']/2, low), (hull['beam']/2, low),
              (hull['beam']/2, high), (-hull['beam']/2, high)]
    for s in sections:
        for (wa, ya), (wb, yb) in zip(s, s[1:]):
            if yb-ya < 1e-8 or yb <= low or ya >= high:
                continue
            slope = (wb-wa) / (yb-ya)
            for sign in (-1, 1):
                points = clip(points, lambda p: wa + (p[1]-ya)*slope - CLEARANCE - sign*p[0])
    # Removing a convex corner only moves the boundary farther inside. Retain
    # the schema's 16-vertex limit without widening an edge across the bilge.
    while len(points) > 16:
        def area(i):
            a, b, c = points[i-1], points[i], points[(i+1) % len(points)]
            return abs((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]))
        points.pop(min(range(len(points)), key=area))
    vertices = [[round(x, 6), round(y, 6), z] for x, y in points]
    plate['plate']['vertices'] = vertices
    bounds = [(min(p[i] for p in vertices), max(p[i] for p in vertices)) for i in range(3)]
    plate['center'] = [round((a+b)/2, 6) for a, b in bounds]
    plate['size'] = [round(max(.001, b-a), 6) for a, b in bounds]
    plate['provenance']['note'] = ('Thickness family retained; convex boundary fitted inside the authored hull '
        'at both physical plate faces with 25 mm clearance. Lower aft boundary follows the rising keel. '
        'Reconstructed geometry, not an original bulkhead drawing.')
    print(plate['id'], len(vertices), 'vertices')

path.write_text(json.dumps(blueprint, indent=2) + '\n')

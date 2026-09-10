"""Refit the original belt families after editing the authored hull.

Short planar strips follow the hull shoulders instead of spanning the curved
midship side with one inset chord. Retain each original armor ID and add stable
section IDs. Thicknesses, materials and longitudinal coverage remain unchanged.
Run explicitly, then compile, build and inspect the armor solids.
"""
import bisect
import copy
import json
import math
import re
from pathlib import Path

path = Path(__file__).with_name('blueprint.json')
blueprint = json.loads(path.read_text())
hull = blueprint['hull']
stations = [s['station'] for s in hull['sections']]


def width(z, y):
    station = hull['length'] / 2 - z
    i = max(0, min(len(stations)-2, bisect.bisect_right(stations, station)-1))
    a, b = hull['sections'][i:i+2]
    t = (station-a['station']) / (b['station']-a['station'])
    points = [(u+(w-u)*t, v+(q-v)*t)
              for (u, v), (w, q) in zip(a['points'], b['points'])]
    hits = [u+(w-u)*(y-v)/(q-v) for (u, v), (w, q) in zip(points, points[1:])
            if v <= y <= q and q-v > 1e-8]
    if not hits:
        raise ValueError(f'Belt outside hull height at {z}, {y}')
    return max(hits)


pattern = re.compile(r'^((?:port|starboard)-(main-belt|teak-backing|belt-support|upper-belt)-\d+)(?:-section-\d+)?$')
groups = {}
for plate in blueprint['armor']:
    match = pattern.match(plate['id'])
    if match:
        groups.setdefault(match[1], []).append(plate)

replacement = {}
for original_id, plates in groups.items():
    template = next(p for p in plates if p['id'] == original_id)
    family = pattern.match(original_id)[2]
    vertices = [v for p in plates for v in p['plate']['vertices']]
    low, high = min(v[1] for v in vertices), max(v[1] for v in vertices)
    z0, z1 = min(v[2] for v in vertices), max(v[2] for v in vertices)
    count = math.ceil((z1-z0)/10)
    zs = [z0+(z1-z0)*i/count for i in range(count+1)]
    anchor = 0 if z0 <= 0 <= z1 else (z0+z1)/2
    original_section = min(range(count), key=lambda i: abs((zs[i]+zs[i+1])/2-anchor))
    sign = -1 if original_id.startswith('port') else 1
    # Vertical slabs are conservatively inscribed at both layer heights.
    # Keep timber and steel backing behind the 320 mm main belt.
    inset = {'main-belt': .16, 'teak-backing': .345, 'belt-support': .38,
             'upper-belt': template['thicknessMm']/2000}[family]
    result = []
    for i, (a, b) in enumerate(zip(zs, zs[1:])):
        wa, wb = (min(width(z, y) for y in [low, high]) for z in [a, b])
        inset_normal = (inset+.025)*math.sqrt(1+((wb-wa)/(b-a))**2)
        xa, xb = sign*(wa-inset_normal), sign*(wb-inset_normal)
        p = copy.deepcopy(template)
        p['id'] = original_id if i == original_section else f'{original_id}-section-{i}'
        p['name'] = template['name'].split(' · section ')[0] + f' · section {i+1}'
        p['plate']['vertices'] = [[round(x, 6), y, round(z, 6)]
                                  for x, y, z in [(xa, low, a), (xb, low, b),
                                                  (xb, high, b), (xa, high, a)]]
        p['plate']['surfaceId'] = original_id
        bounds = [(min(v[k] for v in p['plate']['vertices']),
                   max(v[k] for v in p['plate']['vertices'])) for k in range(3)]
        p['center'] = [(a+b)/2 for a, b in bounds]
        p['size'] = [max(.001, b-a) for a, b in bounds]
        p['provenance']['note'] = ('Original thickness family retained; short planar strips fitted '
            'to authored hull sections. Boundaries are modeling estimates, not shipyard offsets.')
        result.append(p)
    replacement[original_id] = result

result = []
for p in blueprint['armor']:
    match = pattern.match(p['id'])
    if not match:
        result.append(p)
    elif p['id'] == match[1]:
        result.extend(replacement[match[1]])
assert {p['id'] for p in blueprint['armor'] if '-section-' not in p['id']} <= {p['id'] for p in result}
blueprint['armor'] = result
path.write_text(json.dumps(blueprint, indent=2)+'\n')
print(f'Refitted {len(groups)} belt panels as {sum(map(len, replacement.values()))} strips')

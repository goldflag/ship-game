"""Original revision-4 shape parameters, applied to the version-1 blueprint.

Run from any directory before ship:compile. This authoring helper reads only our
blueprint. The sparse design controls below were chosen by visual review of the
credited orthographic rasters; they are not extracted game vertices or offsets.
The blueprint remains the canonical, editable input to the shared pipeline.
"""
from pathlib import Path
import json
import math

path = Path(__file__).with_name('blueprint.json')
b = json.loads(path.read_text())
h = b['hull']
b['configuration'] = 'Early round-bridge Fletcher; revision 5, hull, superstructure and fittings re-measured from GameModels3D pasd021'


def linear(table, s):
    for (a, u), (c, v) in zip(table, table[1:]):
        if a <= s <= c:
            return u + (v-u) * (s-a) / (c-a)
    return table[0][1] if s < table[0][0] else table[-1][1]


# Revision 5 hull: the canoe body measured from GameModels3D pasd021 (A_Hull) at 142 stations,
# fine at the raked stem and the round counter (authoring/lines.json; our z = reference z + 0.466 m).
# The skeg, sonar dome, rudder, shaft bossings, brackets and bilge keels are drawn by build.py.
lines = json.loads(Path(__file__).with_name('authoring').joinpath('lines.json').read_text())
assert abs(lines['length'] - h['length']) < 1e-9
h['sections'] = [{'station': s['station'], 'points': s['points']} for s in lines['sections']]
h['halfBreadths'] = [[s['station'], round(max(w for w, _ in s['points']), 4)] for s in h['sections']]
h['deckHeights'] = [[s['station'], s['points'][-1][1]] for s in h['sections']]
h['keelHeights'] = [[s['station'], s['points'][0][1]] for s in h['sections']]
h['beam'] = round(2 * max(w for _, w in h['halfBreadths']), 2)
h['draft'] = round(-min(k for _, k in h['keelHeights']), 2)
h['depth'] = round(max(d for _, d in h['deckHeights']) - min(k for _, k in h['keelHeights']), 2)


def section_width(pts, y):
    """Outermost half-breadth of one section at height y (0 outside its height range)."""
    w = 0.0
    for (w0, y0), (w1, y1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            w = max(w, max(w0, w1) if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (y - y0) / (y1 - y0))
    return w


def section_area(pts, y_lo, y_hi, dy=.02):
    y = max(y_lo, pts[0][1]); area = 0.0
    while y < min(y_hi, pts[-1][1]):
        area += 2 * section_width(pts, y + dy / 2) * dy; y += dy
    return area


# Waterplane and reserve buoyancy of the measured body, by trapezoids over the stations.
secs = h['sections']
wp = sum((b['station'] - a['station']) * (section_width(a['points'], 0) + section_width(b['points'], 0))
         for a, b in zip(secs, secs[1:]))
h['waterplaneAreaM2'] = round(wp)
h['reserveBuoyancyM3'] = 1350  # gameplay value; the stability model supersedes it
decks = [(s, d) for s, d in h['deckHeights']]
fair = linear


def chamfer(x0, x1, w, c=.4):
    return [(x0, -w+c), (x0+c, -w), (x1-c, -w), (x1, -w+c),
            (x1, w-c), (x1-c, w), (x0+c, w), (x0, w-c)]


def round_front(back, centre, rx, ry):
    return [(back, -ry)] + [(centre+rx*math.cos(-math.pi/2+i*math.pi/24),
                             ry*math.sin(-math.pi/2+i*math.pi/24)) for i in range(25)] + [(back, ry)]


def structure(id, name, outline, base, top):
    return {'id': id, 'name': name, 'footprint': [[round(-y, 5), round(-x, 5)] for x, y in outline],
            'baseY': base, 'height': round(top-base, 5), 'material': 'naval'}


core = round_front(15.7, 21.05, 3.55, 2.65)
pilot_core = round_front(15.7, 21.05, 3.55, 2.72)
b['structures'] = [
    structure('forward-deckhouse', 'Forward deckhouse / raised Mount 52 deck',
              round_front(12.6, 31.55, 2.35, 3.32), 3.18, 7.05),
    structure('bridge', 'Continuous round-front bridge and chart house', core, 7.05, 9.28),
    structure('pilot-house', 'Round-front pilothouse with projecting navigation wings', pilot_core, 9.28, 11.10),
    structure('forward-funnel', 'Raked forward funnel',
              [(10.40+1.83*math.cos(i*math.tau/32), 1.48*math.sin(i*math.tau/32)) for i in range(32)], 5.65, 13.55),
    structure('aft-funnel', 'Raked after funnel',
              [(-4.10+1.83*math.cos(i*math.tau/32), 1.48*math.sin(i*math.tau/32)) for i in range(32)], 5.65, 12.70),
    structure('aft-deckhouse', 'After deckhouse / mounts 53 and 54',
              chamfer(-35.1, -16.2, 3.25, .8), 2.76, 5.70),
    structure('machinery-deckhouse', 'Boiler and torpedo deckhouse',
              chamfer(-17.6, 12.8, 3.2, .25), 2.90, 5.65),
    structure('aft-aa-house', 'Raised after AA support house',
              chamfer(-28.0, -23.6, 1.85, .45), 5.70, 7.68),
]
# Funnel plating is generated from the same original loft as the visible jacket.
for s in b['structures']:
    if 'funnel' not in s['id']:
        continue
    outline = [(-z, -x) for x, z in s['footprint']]
    cx = sum(x for x, _ in outline)/len(outline)
    rx = (max(x for x, _ in outline)-min(x for x, _ in outline))/2
    ry = max(y for _, y in outline)
    vertices = []
    n = 32
    for t, scale in [(0, 1.03), (.14, 1), (.79, .94), (1, .82)]:
        for i in range(n):
            a = i*math.tau/n
            x = cx-.15*s['height']*t+rx*scale*math.cos(a)
            y = ry*scale*math.sin(a)
            z = s['baseY']+s['height']*t+.90*math.cos(a)*t*t+.30*math.sin(a)**2*t**5
            vertices.append([-y, z, -x])
    triangles = []
    for k in range(3):
        for i in range(n):
            a = k*n+i; c = k*n+(i+1)%n
            triangles.extend([[a, c, c+n], [a, c+n, a+n]])
    for i in range(1, n-1):
        triangles.extend([[0, i+1, i], [3*n, 3*n+i, 3*n+i+1]])
    s['surface'] = {'vertices': vertices, 'triangles': triangles}

for m in b['mounts']:
    id = m['id']
    # Mk 30's training axis lies forward of its enclosure centre. Original
    # blueprint positions, estimated from matching whole-ship raster views.
    gun_x = {'gun-1':39.0, 'gun-2':31.7, 'gun-3':-19.6, 'gun-4':-31.8, 'gun-5':-40.3}
    if id in gun_x: m['position'][2] = -gun_x[id]
    if id == 'gun-1':
        m['position'][1] = round(fair(decks, -m['position'][2]+h['length']/2)+.07, 5)
    if id == 'gun-2':
        m['position'][1] = 6.70
    if id in ['oerlikon-1', 'oerlikon-2']:
        m['position'][0] = math.copysign(3.65, m['position'][0])
        m['position'][1] = 7.12
    if id == 'bofors-aft':
        m['position'][1] = 7.70
    if id in ['oerlikon-3', 'oerlikon-4', 'oerlikon-5', 'oerlikon-6']:
        m['position'][1] = round(fair(decks, -m['position'][2]+h['length']/2)+.12, 5)
for launcher in b['torpedoLaunchers']:
    launcher['position'][1] = 5.68
    for tube in b['torpedoTubes']:
        if tube['launcherId'] == launcher['id']:
            tube['position'][1] = 6.52
b['viewpoints']['bridge'] = [0, 12.62, -22.4]
# Keep the steering and after-magazine envelopes within the raised afterbody.
for c in b['compartments']:
    if c['id'] == 'steering-room-space':
        c['center'][1] = 1.0; c['size'][1] = 2.6; c['capacityM3'] = 58
    if c['id'] == 'aft-magazine-space':
        c['center'][1] = 0; c['size'][1] = 3.8
for m in b['modules']:
    if m['id'] == 'steering-room':
        m['center'][1] = 1.0; m['size'][1] = 1.9
    if m['id'] == 'aft-magazine':
        m['center'][1] = 0; m['size'][1] = 2.5
b['obstructions'] = []
for s in b['structures']:
    if 'surface' in s:
        vertices = s['surface']['vertices']
        lo = [min(p[i] for p in vertices) for i in range(3)]
        hi = [max(p[i] for p in vertices) for i in range(3)]
    else:
        lo = [min(p[0] for p in s['footprint']), s['baseY'], min(p[1] for p in s['footprint'])]
        hi = [max(p[0] for p in s['footprint']), s['baseY']+s['height'], max(p[1] for p in s['footprint'])]
    b['obstructions'].append({'id': s['id'], 'center': [(a+c)/2 for a, c in zip(lo, hi)],
                              'size': [c-a for a, c in zip(lo, hi)]})
b['accuracy']['exterior'] = 'Original round-bridge Fletcher reconstruction. The hull and superstructure corrections are retained; revision 4 adds original Mk30 gunhouse facets and handed screw lofts. Navy general arrangements and matching reference rasters guide the reconstruction; exact offsets, propeller pitch distribution, load datum and outfit remain interpreted.'
path.write_text(json.dumps(b, indent=2)+'\n')
print('Revision 5 blueprint:', len(h['sections']), 'measured hull stations; stable weapon IDs preserved')

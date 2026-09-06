"""Original revision-3 shape parameters, applied to the version-1 blueprint.

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
b['configuration'] = 'Early round-bridge Fletcher; original reconstruction, revision 3 with corrected hull and superstructure proportions'


def linear(table, s):
    for (a, u), (c, v) in zip(table, table[1:]):
        if a <= s <= c:
            return u + (v-u) * (s-a) / (c-a)
    return table[0][1] if s < table[0][0] else table[-1][1]


def fair(table, s):
    """Monotone Hermite fairing between original design stations."""
    def slope(j):
        if j == 0:
            return (table[1][1]-table[0][1])/(table[1][0]-table[0][0])
        if j == len(table)-1:
            return (table[-1][1]-table[-2][1])/(table[-1][0]-table[-2][0])
        l = (table[j][1]-table[j-1][1])/(table[j][0]-table[j-1][0])
        r = (table[j+1][1]-table[j][1])/(table[j+1][0]-table[j][0])
        return 0 if l*r <= 0 else 2*l*r/(l+r)
    for i, ((a, u), (c, v)) in enumerate(zip(table, table[1:])):
        if a <= s <= c:
            q = (s-a)/(c-a)
            return ((2*q**3-3*q*q+1)*u + (q**3-2*q*q+q)*(c-a)*slope(i)
                    + (-2*q**3+3*q*q)*v + (q**3-q*q)*(c-a)*slope(i+1))
    return table[0][1] if s < table[0][0] else table[-1][1]


# Stern station = 0, bow = 114.7 m. A broad transom, full forebody and nearly
# straight raked stem replace revision 2's canoe-shaped ends.
breadths = [(0, 2.35), (.5, 2.85), (1.5, 3.75), (3.5, 4.22), (8, 4.65),
            (18, 5.25), (30, 5.72), (42, 6.03), (50, 6.05), (59, 5.99),
            (70, 5.72), (80, 5.34), (90, 4.80), (100, 3.82), (105, 3.08),
            (109, 2.32), (112, 1.49), (113.5, .83), (114.3, .34), (114.7, .012)]
decks = [(0, 2.72), (25, 2.72), (42, 2.78), (58, 3.05), (70, 3.48),
         (80, 4.00), (90, 4.65), (100, 5.37), (108, 5.84), (114.7, 6.12)]
keels = [(0, 2.46), (.35, 1.5), (1.1, -.55), (2, -.66), (7, -.92),
         (14, -1.55), (22, -2.62), (32, -3.70), (40, -4.2), (102, -4.2),
         (110.5, -4.05), (112.25, -3.95), (112.7, -3.40),
         (113.0, -1.95), (113.4, .05), (114, 3.1), (114.7, 6.10)]
stations = sorted(set([float(i) for i in range(115)] +
                      [s for table in [breadths, decks, keels] for s, _ in table]))
h['halfBreadths'] = [[s, round(fair(breadths, s), 5)] for s in stations]
h['deckHeights'] = [[s, round(fair(decks, s), 5)] for s in stations]
h['keelHeights'] = [[s, round(linear(keels, s), 5)] for s in stations]
h['depth'] = 10.32
h['sections'] = []
# The section blends a flat floor / rounded bilge amidships into a fine V entry.
# Upper topsides gain flare forward; the keel stays deep almost to the stem.
section_levels = [0, .012, .045, .105, .20, .34, .51, .73, 1]
mid = [0, .28, .53, .76, .90, .975, 1, 1, 1]
fore = [0, .045, .12, .24, .39, .54, .69, .84, 1]
for s, w in h['halfBreadths']:
    k = linear(keels, s)
    d = fair(decks, s)
    transition = max(0, min(1, (s-74)/36))
    transition = transition*transition*(3-2*transition)
    points = [[round(w*(a+(c-a)*transition), 5), round(k+(d-k)*f, 5)]
              for f, a, c in zip(section_levels, mid, fore)]
    h['sections'].append({'station': s, 'points': points})


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
    if id == 'gun-1':
        m['position'][1] = round(fair(decks, -m['position'][2]+h['length']/2)+.07, 5)
    if id == 'gun-2':
        m['position'][1] = 7.05
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
b['accuracy']['exterior'] = 'Original round-bridge Fletcher reconstruction. Revision 3 corrects stem, transom, deck sheer and bridge massing against matching reference rasters; detailed hull offsets, load datum and exact outfit remain interpreted.'
path.write_text(json.dumps(b, indent=2)+'\n')
print('Revision 3 blueprint:', len(stations), 'original hull stations; stable weapon IDs preserved')

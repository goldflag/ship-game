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


def runtime(points):
    """(runtime x, runtime z) half-outline, starboard, bow to stern -> mirrored Blender outline."""
    half = [(-z, -x) for x, z in points]
    return half + [(xb, -yb) for xb, yb in reversed(half)]


# Revision 5 superstructure, traced from GameModels3D pasd021 plan cuts (our frame, z = reference z + 0.466).
fwd_house = runtime([(1.70, -33.41), (2.19, -33.0), (2.54, -32.5), (2.75, -32.0), (3.00, -31.5), (3.15, -31.0),
                     (3.27, -30.0), (3.42, -28.0), (3.51, -25.0), (3.66, -22.0), (3.83, -20.0), (3.93, -17.30)])
aft_house = runtime([(2.20, 17.30), (2.50, 17.60), (2.50, 34.0), (2.10, 35.2), (1.45, 35.9)])
aa_house = runtime([(2.07, 22.98), (2.46, 23.40), (2.46, 26.0), (2.09, 26.5), (1.86, 27.0), (1.58, 27.5), (1.00, 28.0), (.60, 28.29)])
core = round_front(17.34, 21.87, 2.5, 2.5)
pilot_core = round_front(16.66, 21.87, 2.5, 2.49)
b['structures'] = [
    structure('forward-deckhouse', 'Forward deckhouse / raised Mount 52 deck', fwd_house, 3.18, 6.82),
    structure('bridge', 'Continuous round-front bridge and chart house', core, 6.30, 9.10),
    structure('pilot-house', 'Round-front pilothouse under the open bridge', pilot_core, 9.10, 11.25),
    structure('forward-funnel', 'Raked forward funnel',
              [(9.78+1.75*math.cos(i*math.tau/32), 1.45*math.sin(i*math.tau/32)) for i in range(32)], 5.90, 13.55),
    structure('aft-funnel', 'Raked after funnel',
              [(-4.22+1.75*math.cos(i*math.tau/32), 1.45*math.sin(i*math.tau/32)) for i in range(32)], 5.60, 12.76),
    structure('aft-deckhouse', 'After deckhouse / mounts 53 and 54', aft_house, 2.50, 5.07),
    structure('machinery-deckhouse', 'Boiler and torpedo deckhouse', chamfer(-2.5, 11.3, 3.1, .25), 2.90, 5.76),
    structure('torpedo-deckhouse', 'Narrow after torpedo-mount deckhouse', chamfer(-13.86, -2.5, 1.42, .15), 2.80, 5.38),
    structure('uptake-casing', 'Fore funnel uptake casing', chamfer(11.3, 16.9, 1.46, .2), 3.50, 6.05),
    structure('aft-aa-house', 'Raised after AA support house', aa_house, 5.00, 7.05),
]
# Funnel plating is generated from the same original loft as the visible jacket (build.py uses the
# same rings and cap rise: keep FUNNEL_RINGS and FUNNEL_CAP in step there).
FUNNEL_RINGS = [(0, 1.02), (.14, 1), (.79, .98), (1, .92)]
FUNNEL_CAP = {'forward-funnel': .72, 'aft-funnel': .55}
for s in b['structures']:
    if 'funnel' not in s['id']:
        continue
    outline = [(-z, -x) for x, z in s['footprint']]
    cx = sum(x for x, _ in outline)/len(outline)
    rx = (max(x for x, _ in outline)-min(x for x, _ in outline))/2
    ry = max(y for _, y in outline)
    vertices = []
    n = 32
    for t, scale in FUNNEL_RINGS:
        for i in range(n):
            a = i*math.tau/n
            x = cx-.15*s['height']*t+rx*scale*math.cos(a)
            y = ry*scale*math.sin(a)
            z = s['baseY']+s['height']*t+FUNNEL_CAP[s['id']]*math.cos(a)*t*t
            vertices.append([-y, z, -x])
    triangles = []
    for k in range(3):
        for i in range(n):
            a = k*n+i; c = k*n+(i+1)%n
            triangles.extend([[a, c, c+n], [a, c+n, a+n]])
    for i in range(1, n-1):
        triangles.extend([[0, i+1, i], [3*n, 3*n+i, 3*n+i+1]])
    s['surface'] = {'vertices': vertices, 'triangles': triangles}

# Mounts on the GameModels3D hardpoints (ship:hardpoints pasd021; our z = reference z + 0.466). The
# hardpoint height is the mount's base plane: the barbette ring or pad it stands on.
HARDPOINT = {
    'gun-1': (0, 5.385, -38.497), 'gun-2': (0, 7.289, -31.328), 'gun-3': (0, 5.42, 19.12),
    'gun-4': (0, 5.42, 31.786), 'gun-5': (0, 3.027, 39.52), 'bofors-aft': (0, 7.041, 26.587),
    # 20 mm: the bridge pair on the reference's 01-level tubs, the waist pairs on its main-deck positions.
    # (the bridge pair 6 cm above the hardpoint: our 01 roof follows the sheer to 6.70 m there)
    'oerlikon-1': (-3.072, 6.72, -25.524), 'oerlikon-2': (3.072, 6.72, -25.524),
    'oerlikon-3': (-4.357, 2.829, 11.646), 'oerlikon-4': (4.358, 2.829, 11.646),
    'oerlikon-5': (-4.357, 2.774, 14.085), 'oerlikon-6': (4.358, 2.774, 14.085),
}
for m in b['mounts']:
    if m['id'] in HARDPOINT:
        m['position'] = [round(v, 4) for v in HARDPOINT[m['id']]]
# Quintuple banks: pivot on the reference hardpoints; tube muzzles 4.65 m ahead of the pivot.
BANKS = {'torpedo-forward': (5.811, -2.015), 'torpedo-aft': (5.523, 11.161)}
for launcher in b['torpedoLaunchers']:
    y, z = BANKS[launcher['id']]
    launcher['position'] = [0, y, z]
    for tube in b['torpedoTubes']:
        if tube['launcherId'] == launcher['id']:
            tube['position'][1] = round(y + .93, 4)
            tube['position'][2] = round(z - 4.65, 4)
for mod in b['modules']:
    if mod['id'] == 'equipment-torpedo-forward':
        mod['center'] = [0, round(5.811 + .95, 3), round(-2.015 - .5, 3)]
    if mod['id'] == 'equipment-torpedo-aft':
        mod['center'] = [0, round(5.523 + .95, 3), round(11.161 - .5, 3)]
# Depth charges: K-guns on the reference's two pairs (z 25.9, 29.3) and a third pair 3.5 m aft; the
# stern racks on the reference's racks, releasing over the counter.
DC = {'dc-thrower-port-1': (-4.47, 25.866), 'dc-thrower-starboard-1': (4.47, 25.866),
      'dc-thrower-port-2': (-4.39, 29.336), 'dc-thrower-starboard-2': (4.39, 29.336),
      'dc-thrower-port-3': (-4.25, 32.8), 'dc-thrower-starboard-3': (4.25, 32.8),
      'dc-rack-port': (-2.23, 57.2), 'dc-rack-starboard': (2.23, 57.2)}
for launcher in b['depthChargeLaunchers']:
    x, z = DC[launcher['id']]
    launcher['position'][0] = x; launcher['position'][2] = z
    if 'rack' in launcher['id']:
        launcher['position'][1] = 3.25
    for mod in b['modules']:
        if mod['id'] == launcher['launcherModuleId']:
            mod['center'][0] = x
            mod['center'][2] = round(z - 2.6, 3) if 'rack' in launcher['id'] else z
            if 'rack' in launcher['id']:
                mod['center'][1] = 3.3
for mod in b['modules']:
    if mod['id'] == 'equipment-mk37-director':
        mod['center'] = [0, 14.45, -19.91]
b['viewpoints']['bridge'] = [0, 12.62, -22.4]


def hull_contains(x, y, z):
    """Python port of src/ships/hull.ts hullContains for the section loft."""
    station = h['length']/2 - z
    if station < 0 or station > h['length']:
        return False
    secs = h['sections']
    i = max(1, next((k for k, sec in enumerate(secs) if sec['station'] >= station), 1))
    a, c = secs[i-1], secs[i]
    t = (station - a['station'])/(c['station'] - a['station'])
    pts = [(w + (v-w)*t, yy + (q-yy)*t) for (w, yy), (v, q) in zip(a['points'], c['points'])]
    if y < pts[0][1] - 1e-7 or y > pts[-1][1] + 1e-7:
        return False
    width = 0.0
    for (aw, ay), (bw, by) in zip(pts, pts[1:]):
        if ay - 1e-7 <= y <= by + 1e-7:
            width = max(width, max(aw, bw) if by - ay < 1e-7 else aw + (bw-aw)*(y-ay)/(by-ay))
    return abs(x) <= width + 1e-7


def inside(center, size):
    return all(hull_contains(center[0]+sx*size[0]/2, center[1]+sy*size[1]/2, center[2]+sz*size[2]/2)
               for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1))


# Re-seat the below-deck rooms inside the re-measured hull with the smallest change: lift the floor
# off the rounder bilge first (up to 0.4 m), then narrow (up to 15%), in 5 cm steps; flood capacity
# is kept unless it would exceed 95% of the smaller box. Deckhouse magazines stay where they are, and
# the fine forebody still clips a few lower corners of the forepeak and forward magazine envelopes.
def outside_corners(center, size):
    return sum(not hull_contains(center[0]+sx*size[0]/2, center[1]+sy*size[1]/2, center[2]+sz*size[2]/2)
               for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1))


# Revision 4 room envelopes (below the main deck); re-seated from these each run, so the step is idempotent.
ROOM_BASE = {
    'forepeak-space': ([0, -0.6, -49], [3, 5, 10], 105),
    'forward-magazine-space': ([0, -0.6, -34], [6.4, 5, 15], 336),
    'boiler-forward-space': ([0, -0.6, -16], [8, 5, 13], 364),
    'engine-forward-space': ([0, -0.6, -2], [8, 5, 13], 364),
    'boiler-aft-space': ([0, -0.6, 12], [8, 5, 13], 364),
    'engine-aft-space': ([0, -0.6, 25], [7.4, 5, 11], 285),
    'aft-magazine-space': ([0, 0, 38], [6, 3.8, 10], 210),
    'steering-room-space': ([0, 1, 48], [4.5, 2.6, 7], 58),
    'forward-magazine': ([0, -0.6, -34], [5.12, 3.2, 12], None),
    'boiler-forward': ([0, -0.6, -16], [6.4, 3.2, 10.4], None),
    'engine-forward': ([0, -0.6, -2], [6.4, 3.2, 10.4], None),
    'boiler-aft': ([0, -0.6, 12], [6.4, 3.2, 10.4], None),
    'engine-aft': ([0, -0.6, 25], [5.92, 3.2, 8.8], None),
    'aft-magazine': ([0, 0, 38], [4.8, 2.5, 8], None),
    'steering-room': ([0, 1, 48], [3.6, 1.9, 5.6], None),
    'support-generator-1': ([2.4, -1.85, -12.1], [1.2, 1, 1.2], None),
    'support-generator-2': ([2.22, -1.85, 28.3], [1.2, 1, 1.2], None),
}
for room in [r for r in b['compartments'] + b['modules'] if r['id'] in ROOM_BASE]:
    base_c, base_sz, base_cap = ROOM_BASE[room['id']]
    room['center'], room['size'] = list(base_c), list(base_sz)
    if base_cap is not None:
        room['capacityM3'] = base_cap
    c, sz = room['center'], room['size']
    y0, w0, l0 = sz[1], sz[0], sz[2]
    while outside_corners(c, sz) and sz[1] > y0 - .4:
        sz[1] = round(sz[1] - .05, 4); c[1] = round(c[1] + .025, 4)
    while outside_corners(c, sz) and sz[0] > .85*w0:
        sz[0] = round(sz[0] - .05, 4)
    if outside_corners(c, sz):
        sz[0] = w0  # narrowing alone cannot seat it: keep the original width
    if 'capacityM3' in room:
        room['capacityM3'] = round(min(room['capacityM3'], .95*sz[0]*sz[1]*sz[2]), 1)
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

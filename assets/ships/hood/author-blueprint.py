"""Original HMS Hood, May 1941: dimensional and gameplay reconstruction. Writes blueprint.json.

The editable blueprint is the versioned asset; this retained study records how its
hull stations, mounts, superstructure tiers, protection and internals were made.
authoring/lines.json holds control-station offsets measured, like a lines plan, from
the approved GameModels3D pbsb507 viewing reference; mount datums, tier outlines and
plate thicknesses below were read the same way. No reference mesh or texture is read.
Run before author-flood-spaces / author-stability / author-local-damage, then ship:build.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
lines = json.loads((HERE / 'authoring/lines.json').read_text())
L = lines['length']; LOW, HIGH, H0 = lines['LOW'], lines['HIGH'], lines['H0']


def levels(keel, deck):
    h0 = H0 if keel < H0 - 1.0 else keel + (deck - keel) * .75
    return [keel + (h0 - keel) * u for u in LOW] + [h0 + (deck - h0) * u for u in HIGH]


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


# ---------------------------------------------------------------- hull stations
rows = sorted(lines['rows'], key=lambda r: -r[0])  # stern first: station = L/2 - z
stern_row, bow_row = rows[0], rows[-1]
sections = [dict(station=0.0, points=[[0, round(y, 4)] for y in levels(stern_row[1] + .3, stern_row[2])])]
for z, keel, deck, ws in rows:
    sections.append(dict(station=round(L / 2 - z, 4), points=[[round(w, 4), round(y, 4)] for w, y in zip(ws, levels(keel, deck))]))
tip_keel = bow_row[2] - .45
sections.append(dict(station=L, points=[[0, round(y, 4)] for y in levels(tip_keel, bow_row[2])]))
DRAFT = -min(p[1] for s in sections for p in s['points'])
TOP = max(p[1] for s in sections for p in s['points'])
BEAM = 2 * max(p[0] for s in sections for p in s['points']) + .002
DEPTH = TOP + DRAFT


def section_at(z):
    st = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= st <= b['station']:
            t = 0 if b['station'] == a['station'] else (st - a['station']) / (b['station'] - a['station'])
            return [(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t) for pa, pb in zip(a['points'], b['points'])]
    return sections[0]['points'] if st < 0 else sections[-1]['points']


def half(z, y):
    """Hull half-breadth at runtime (z, y); zero outside the body."""
    ps = section_at(z)
    if y < ps[0][1] or y > ps[-1][1]:
        return 0.0
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        if y0 <= y <= y1:
            return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (y - y0) / (y1 - y0)
    return ps[-1][0]


def deck_at(z):
    return section_at(z)[-1][1]


def area_below(ps, level):
    a = 0.0
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        lo, hi = y0, min(y1, level)
        if hi <= lo:
            continue
        wa = w0; wb = w0 + (w1 - w0) * ((hi - y0) / (y1 - y0) if y1 > y0 else 0)
        a += (wa + wb) / 2 * (hi - lo)
    return 2 * a


def integrate(f):
    total = 0.0
    for a, b in zip(sections, sections[1:]):
        total += (f(a['points']) + f(b['points'])) / 2 * (b['station'] - a['station'])
    return total


VOLUME = integrate(lambda ps: area_below(ps, 0))
FULL = integrate(lambda ps: area_below(ps, 1e9))


def half_at_level(ps, level):
    if level < ps[0][1] or level > ps[-1][1]:
        return 0.0
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        if y0 <= level <= y1:
            return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (level - y0) / (y1 - y0)
    return 0.0


WATERPLANE = integrate(lambda ps: 2 * half_at_level(ps, 0))
MASS = VOLUME * 1025

b = dict(schemaVersion=1, id='hood', name='HMS Hood',
    configuration='May 1941 exterior as at the Denmark Strait sortie; GameModels3D pbsb507 reference waterline',
    coordinates='meters-y-up-bow-negative-z', modelUrl='/models/hood.glb',
    hull=dict(kind='authored-stations-v1', length=L, beam=round(BEAM, 4), draft=round(DRAFT, 4), depth=round(DEPTH, 4),
        massKg=round(MASS), waterplaneAreaM2=round(WATERPLANE, 1), reserveBuoyancyM3=round(FULL - VOLUME, 1),
        halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
        deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
        keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
        sections=sections),
    # Provisional 1941 service speed (the reference model carries no machinery data).
    handling=dict(forwardSpeed=29 * .5144444444, reverseSpeed=3.8, acceleration=.2, braking=.26, rudderRate=.3, maxYawRate=.024),
    mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
    viewpoints=dict(bridge=[0, 26.6, -36.2]),
    structuralPlating=dict(hullMm=26, superstructureMm=16, note='Game collision skin: 26 mm hull and 16 mm superstructure steel, the plate families the approved reference model carries outside its armour schedule. Not a recovered scantling plan.'),
    accuracy=dict(
        exterior='Original May 1941 reconstruction against the approved GameModels3D pbsb507 model: hull lines, tier outlines and mount datums measured from it; geometry authored independently. Fidelity to that model, not an independent historical survey.',
        internals='Estimated magazines, boiler and engine rooms, partitions, flooding and stability for inspectable combat; not an as-built internal survey.',
        weapons='Eight 15-inch Mk II, fourteen 4-inch Mk XIX and three octuple pom-poms fire; ballistics and damage are shared game calibration. The four quadruple .50 Vickers and five UP projectors are visual only.'))
H = b['hull']
DECK_MID = deck_at(0)

# ---------------------------------------------------------------- mounts
# Reference turret datums (runtime frame, hull centred): train/elevation origins.
for mid, name, pos, bearing in [('main-a', 'A turret', [0, 7.35, -75.466], 0), ('main-b', 'B turret', [0, 10.45, -60.746], 0),
                                ('main-x', 'X turret', [0, 7.27, 72.694], 180), ('main-y', 'Y turret', [0, 4.23, 88.714], 180)]:
    b['mounts'].append(dict(id=mid, name=name, partId='bl-15-mkii-twin', battery='main', position=pos, bearingDeg=bearing,
                            rangefinder=True, magazineId='magazine-' + mid[-1]))
for mid, name, pos, bearing in [('secondary-p1', 'P1 4-inch', [-12.02, 9.2, 2.944], -90), ('secondary-s1', 'S1 4-inch', [12.02, 9.2, 2.944], 90),
                                ('secondary-p2', 'P2 4-inch', [-10.23, 9.2, 25.414], -90), ('secondary-s2', 'S2 4-inch', [10.23, 9.2, 25.414], 90),
                                ('secondary-p3', 'P3 4-inch', [-9.13, 9.2, 43.204], -90), ('secondary-s3', 'S3 4-inch', [9.13, 9.2, 43.204], 90)]:
    b['mounts'].append(dict(id=mid, name=name, partId='qf-4-mkxix-twin', battery='secondary', position=pos, bearingDeg=bearing,
                            rangefinder=False, traverseDeg=100, magazineId='magazine-4in-aft' if pos[2] > 20 else 'magazine-4in-fwd'))
b['mounts'].append(dict(id='secondary-c', name='Centreline 4-inch', partId='qf-4-mkxix-twin', battery='secondary', position=[0, 9.2, 60.984],
                        bearingDeg=180, rangefinder=False, magazineId='magazine-4in-aft'))
for mid, name, pos, bearing, trav in [('pom-pom-p', 'Port pom-pom', [-12.75, 9.2, -13.816], -90, 110), ('pom-pom-s', 'Starboard pom-pom', [12.75, 9.2, -13.816], 90, 110),
                                      ('pom-pom-aft', 'After pom-pom', [1.74, 11.91, 51.284], 180, 165)]:
    b['mounts'].append(dict(id=mid, name=name, partId='qf-2pdr-mkvi-octuple', battery='secondary', position=pos, bearingDeg=bearing,
                            rangefinder=False, traverseDeg=trav))

# ---------------------------------------------------------------- superstructure tiers
# Outlines [runtime x, runtime z], measured at mid-tier and simplified to symmetric plan shapes.
P = {
'shelter-deck-forward':[[-13.5,-5.85],[-13.5,-0.45],[-14.9,1.55],[-14.9,5.35],[-13.0,8.85],[-13.1,10.65],[-15.0,13.45],[-15.0,17.65],[-13.3,20.25],[-13.2,22.85],[-14.9,27.95],[-14.5,41.35],[-13.65,42.8],[13.65,42.8],[14.5,41.35],[14.9,27.95],[13.2,22.85],[13.3,20.25],[15.0,17.65],[15.0,13.45],[13.1,10.65],[13.0,8.85],[14.9,5.35],[14.9,1.55],[13.5,-0.45],[13.5,-5.85],[14.9,-9.05],[15.4,-13.95],[14.5,-18.95],[14.5,-22.65],[11.3,-25.85],[11.1,-30.35],[11.8,-32.05],[10.9,-33.65],[10.9,-36.85],[7.3,-40.25],[4.6,-46.75],[5.1,-47.25],[2.9,-47.95],[2.25,-50.8],[0,-51.4],[-2.25,-50.8],[-2.9,-47.95],[-5.1,-47.25],[-4.6,-46.75],[-7.3,-40.25],[-10.9,-36.85],[-10.9,-33.65],[-11.8,-32.05],[-11.1,-30.35],[-11.3,-25.85],[-14.5,-22.65],[-14.5,-18.95],[-15.4,-13.95],[-14.9,-9.05]],
'shelter-deck-aft':[[-2.9,62.75],[-1.45,64.3],[1.45,64.3],[2.9,62.75],[3.9,59.95],[13.65,42.8],[-13.65,42.8],[-3.9,59.95]],
'forward-superstructure':[[8.33,-29.57],[7.5,-40.05],[4.5,-46.85],[4.8,-47.25],[3.25,-47.75],[0.95,-51.1],[0,-51.3],[-0.95,-51.1],[-3.25,-47.75],[-4.8,-47.25],[-4.5,-46.85],[-7.5,-40.05],[-8.33,-29.57],[-5.0,-29.57],[-4.7,-28.35],[-4.35,-29.57],[4.35,-29.57],[4.7,-28.35],[5.0,-29.57]],
}


def ellipse(cz, rx, rz, n=32, cx=0.0):
    return [[round(cx + rx * math.sin(math.tau * i / n), 3), round(cz + rz * math.cos(math.tau * i / n), 3)] for i in range(n)]


def rect(x0, x1, z0, z1):
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]


def clip_aft(outline, z_max):
    """Clip a footprint to z <= z_max (Sutherland-Hodgman against one plane)."""
    out = []
    for a, b in zip(outline, outline[1:] + outline[:1]):
        ina, inb = a[1] <= z_max, b[1] <= z_max
        if ina: out.append(a)
        if ina != inb:
            t = (z_max - a[1]) / (b[1] - a[1]); out.append([round(a[0] + (b[0] - a[0]) * t, 3), z_max])
    return out


def clip_fore(outline, z_min):
    """Clip a footprint to z >= z_min."""
    return [[x, -z] for x, z in clip_aft([[x, -z] for x, z in outline], -z_min)]


def structure(id, name, footprint, base, top, material='naval'):
    b['structures'].append(dict(id=id, name=name, footprint=footprint, baseY=round(base, 4), height=round(top - base, 4), material=material))


def sym(half):
    """Mirror a starboard half outline, listed from the after centreline round to the forward one."""
    pts = [[round(x, 3), round(z, 3)] for x, z in half]
    return pts + [[-x, z] for x, z in reversed(pts) if x > 1e-6]


structure('shelter-deck-forward', 'Shelter deck and forecastle superstructure', P['shelter-deck-forward'], DECK_MID, 9.2)
structure('shelter-deck-aft', 'After shelter deck over the quarterdeck break', P['shelter-deck-aft'], 2.48, 9.2)
structure('forward-superstructure', 'Forward superstructure', P['forward-superstructure'], 9.2, 12.0)
# Bridge, measured tier by tier on the reference: enclosed houses are solid tiers; the open decks
# (14.15, 16.55, 19.8 m) are thin plates whose bulwarks the recipe draws. The houses stop under each deck.
for side, sign in [('port', -1), ('starboard', 1)]:
    structure('searchlight-sponson-' + side, side.title() + ' searchlight sponson',
              [[sign * x, z] for x, z in [(6.5, -26.0), (7.7, -26.1), (8.65, -27.3), (9.3, -27.5), (9.3, -30.1), (8.9, -30.8), (8.2, -31.15), (8.33, -29.57), (6.5, -29.57)]], 11.85, 12.0)
structure('bridge-base', 'Conning-tower platform', sym([(0, -40.0), (2.27, -40.0), (1.9, -41.0), (1.9, -43.65), (4.8, -43.65), (4.8, -41.9), (5.35, -41.7), (6.45, -41.8),
                                                       (6.9, -40.85), (7.05, -40.9), (4.68, -46.5), (4.5, -47.65), (3.05, -47.75), (0, -47.75)]), 12.0, 14.13)
structure('conning-tower', 'Armoured conning tower', ellipse(-47.55, 3.2, 3.95, 24), 12.0, 16.5)
structure('conning-tower-hood', 'Conning-tower hood', ellipse(-46.37, 2.52, 2.55, 24), 16.5, 17.3)
structure('conning-tower-hood-upper', 'Conning-tower hood, upper tier', ellipse(-45.9, 1.75, 1.72, 20), 17.3, 18.36)
structure('conning-tower-sight-hood', 'Conning-tower sighting hood', sym([(0, -46.85), (1.58, -46.85), (2.0, -47.25), (2.08, -47.6), (1.88, -48.05), (1.05, -48.67), (0, -48.92)]), 17.3, 17.8)
structure('bridge-lower', 'Lower bridge trunk', sym([(0, -33.97), (1.9, -33.97), (2.18, -34.25), (2.2, -37.8), (1.1, -38.3), (0, -38.3)]), 12.0, 16.4)
for side, sign in [('port', -1), ('starboard', 1)]:
    structure('signal-house-' + side, side.title() + ' signal house', [[sign * x, z] for x, z in [(2.85, -28.45), (5.07, -28.45), (5.07, -32.2), (4.7, -32.8), (3.45, -32.85), (2.85, -32.3)]], 12.0, 14.0)
    structure('bridge-side-house-' + side, side.title() + ' flag deck house', [[sign * x, z] for x, z in [(2.83, -28.45), (5.07, -28.45), (5.07, -32.15), (4.65, -32.85), (2.83, -30.5)]], 14.15, 16.4)
structure('bridge-deck-lower', 'Lower bridge deck', sym([(0, -26.9), (2.05, -26.9), (1.8, -27.2), (1.8, -27.7), (2.8, -27.72), (3.1, -28.42), (5.07, -28.45), (5.07, -33.2), (2.27, -40.0), (0, -40.0)]), 14.0, 14.15)
structure('bridge-flag', 'Admiral bridge deck', sym([(0, -26.85), (2.38, -26.85), (2.8, -28.4), (5.05, -28.45), (5.05, -33.3), (4.43, -33.9), (3.38, -37.5), (1.1, -39.77), (0, -39.77)]), 16.4, 16.55)
structure('bridge-middle-aft', 'Admiral bridge after house', rect(-2.38, 2.38, -29.6, -26.85), 16.55, 18.6)
structure('bridge-middle', 'Admiral bridge house', sym([(0, -29.6), (2.38, -29.6), (3.4, -29.8), (3.62, -30.2), (3.6, -30.6), (2.85, -30.7), (2.93, -32.05), (3.48, -32.45),
                                                        (3.48, -34.2), (2.2, -34.75), (2.28, -37.7), (0.9, -39.08), (0, -39.08)]), 16.55, 19.65)
structure('bridge-upper-deck', 'Upper bridge deck', sym([(0, -28.38), (1.7, -28.38), (3.0, -28.57), (4.7, -29.57), (5.23, -30.3), (5.18, -30.8), (4.85, -31.23), (3.68, -31.65), (3.78, -32.5),
                                                         (3.88, -32.65), (3.88, -33.05), (4.68, -36.65), (4.5, -36.83), (3.15, -36.83), (0.9, -39.08), (0, -39.08)]), 19.65, 19.8)
structure('bridge-aft-house', 'Upper bridge after house', rect(-2.8, 2.8, -29.62, -28.48), 19.8, 22.25)
structure('bridge-upper', 'Upper bridge', sym([(0, -31.57), (2.15, -31.57), (2.28, -31.75), (2.2, -34.7), (4.2, -34.67), (4.68, -36.5), (4.55, -36.8), (2.2, -36.83), (2.18, -37.8), (0.9, -39.08), (0, -39.1)]), 19.8, 22.25)
structure('bridge-navigation', 'Navigating bridge', sym([(0, -30.45), (2.45, -30.42), (2.7, -30.77), (3.2, -30.77), (3.62, -31.5), (4.23, -34.6), (4.38, -34.8), (2.2, -34.8), (2.18, -38.1), (0.9, -39.38), (0, -39.38)]), 22.25, 23.35)
structure('bridge-compass', 'Compass platform house', sym([(0, -30.75), (2.2, -30.62), (2.73, -31.25), (2.6, -31.52), (2.18, -31.65), (2.18, -35.1), (0, -35.1)]), 23.35, 24.55)
structure('forward-funnel-casing', 'Forward funnel casing', [[-5.5, -27.2], [5.5, -27.2], [5.5, -17.0], [4.0, -16.6], [-4.0, -16.6], [-5.5, -17.0]], 9.2, 10.97)
structure('forward-funnel', 'Forward funnel', ellipse(-22.42, 2.9, 3.9, 32), 10.97, 23.32)
structure('midships-deckhouse', 'Midships deckhouse', [[-5.1, -14.5], [5.1, -14.5], [5.2, -8.9], [5.25, 3.3], [3.5, 4.6], [-3.5, 4.6], [-5.25, 3.3], [-5.2, -8.9]], 9.2, 10.97)
structure('midships-deckhouse-upper', 'Midships deckhouse, upper tier', [[-5.1, -14.5], [5.1, -14.5], [5.1, -7.8], [-5.1, -7.8]], 10.97, 12.93)
structure('searchlight-tower', 'Midships searchlight tower', rect(-1.35, 1.35, -13.7, -9.7), 12.93, 15.99)
structure('after-funnel', 'After funnel', ellipse(-2.82, 2.9, 3.9, 32), 10.97, 23.32)
structure('after-control-tower', 'After control position', [[-2.8, 34.3], [2.8, 34.3], [4.0, 35.6], [3.2, 38.5], [2.4, 42.0], [1.2, 44.6], [-1.2, 44.6], [-2.4, 42.0], [-3.2, 38.5], [-4.0, 35.6]], 9.2, 16.25)
structure('after-deckhouse', 'After deckhouse', [[-2.8, 49.0], [2.8, 49.0], [2.8, 53.2], [-2.8, 53.2]], 9.2, 11.79)
structure('after-deckhouse-roof', 'After gun platform', [[-4.7, 45.8], [4.7, 45.8], [4.8, 51.5], [3.6, 53.9], [0, 54.3], [-3.6, 53.9], [-4.8, 51.5]], 11.79, 11.91, 'roof')

# Coarse firing-clearance proxies: each footprint split into <=10 m slices, kept inside the visual.
for s in b['structures']:
    pts = s['footprint']; zs = [p[1] for p in pts]; z0, z1 = min(zs), max(zs)
    n = max(1, math.ceil((z1 - z0) / 10))
    for i in range(n):
        a = z0 + (z1 - z0) * i / n; c = z0 + (z1 - z0) * (i + 1) / n
        xs = []
        for (x0, za), (x1, zb) in zip(pts, pts[1:] + pts[:1]):
            for zz in [a, c, (a + c) / 2]:
                if min(za, zb) <= zz <= max(za, zb) and za != zb:
                    xs.append(x0 + (x1 - x0) * (zz - za) / (zb - za))
            if a <= za <= c:
                xs.append(x0)
        if len(xs) < 2:
            continue
        w = max(xs) - min(xs) - .4; d = c - a - .2
        if w <= .2 or d <= .2:
            continue
        b['obstructions'].append(dict(id=s['id'] + ('' if n == 1 else f'-{i + 1}'), center=[round((max(xs) + min(xs)) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((a + c) / 2, 3)],
                                      size=[round(w, 3), round(s['height'], 3), round(d, 3)]))

# ---------------------------------------------------------------- rooms and machinery
def fit_room(center, size, margin=.35):
    """Shrink a room's width until every corner lies inside the authored hull."""
    x, y, z = center
    for k in range(60):
        w = size[0] * (1 - k / 60)
        ok = all(abs(x) + w / 2 <= half(zz, yy) - margin for zz in [z - size[2] / 2, z, z + size[2] / 2] for yy in [y - size[1] / 2, y, y + size[1] / 2])
        if ok:
            return [w, size[1], size[2]]
    raise ValueError('room does not fit: ' + str(center))


def room(id, name, center, size, kind=None, role=None, hp=150):
    size = fit_room(center, size)
    cid = id + '-room'
    b['compartments'].append(dict(id=cid, name=name + ' space', center=center, size=size, capacityM3=round(math.prod(size) * .78, 3), pumpM3PerSecond=.014))
    if kind:
        m = dict(id=id, name=name, kind=kind, center=center, size=[round(s * .72, 4) for s in size], hp=hp, compartmentId=cid, immersionToleranceM=.8)
        if role:
            m['role'] = role
        b['modules'].append(m)


for mid, z in [('a', -75.466), ('b', -60.746), ('x', 72.694), ('y', 88.714)]:
    room('magazine-' + mid, mid.upper() + ' 15-inch magazine and shell room', [0, -5.2, z], [15, 7, 12.5], 'magazine', hp=210)
room('magazine-4in-fwd', 'Forward 4-inch magazine', [0, -5.2, -49.5], [12, 6, 6], 'magazine', hp=90)
room('magazine-4in-aft', 'After 4-inch magazine', [0, -5.2, 60.0], [12, 6, 6], 'magazine', hp=90)
groups = []
for i, (sign, zb) in enumerate([(-1, -33.5), (1, -33.5), (-1, -7.5), (1, -7.5)], 1):
    boilers = []
    for j, dz in enumerate([6.5, -6.5], 1):
        bid = f'boiler-{i}-{j}'; boilers.append(bid)
        room(bid, f'Boiler room {i}.{j}', [sign * 5.0, -5.0, zb + dz], [8.6, 8, 12.4], 'engine', 'boiler', 170)
    tid = f'turbine-{i}'
    room(tid, f'Turbine set {i}', [sign * 5.0, -5.0, 12.5 + (i - 1) // 2 * 16.0], [8.6, 8, 15.4], 'engine', 'turbine', 180)
    groups.append(dict(id=f'drive-{i}', share=.25, boilerIds=boilers, driveIds=[tid], shaftIds=[]))
room('steering', 'Steering gear', [0, -2.4, 107.5], [7, 4, 8], 'steering', hp=150)
b['propulsion'] = dict(groups=groups, basis='Four equal turbine/shaft trains, each fed by two of eight boiler-room groups (Hood carried 24 small-tube boilers). Room bounds and routing are estimated; shafts aggregated with turbines.')

# Fixed directors at the reference housings; coverage is gameplay authoring.
main_ids = ['main-a', 'main-b', 'main-x', 'main-y']
sec_ids = [m['id'] for m in b['mounts'] if m['partId'] == 'qf-4-mkxix-twin']
pp_ids = [m['id'] for m in b['mounts'] if m['partId'] == 'qf-2pdr-mkvi-octuple']
for id, name, center, size, serves in [
    ('equipment-dct-foretop', 'Foretop 15-inch director', [0, 34.4, -33.69], [3.8, 2.8, 4.2], main_ids),
    ('equipment-ct-director', 'Conning-tower 15-inch director', [0, 18.2, -45.85], [3.4, 2.2, 3.2], main_ids),
    ('equipment-hacs-p', 'Port HACS Mk III', [-7.6, 15.6, -29.5], [2.6, 2.4, 2.8], sec_ids),
    ('equipment-hacs-s', 'Starboard HACS Mk III', [7.6, 15.6, -29.5], [2.6, 2.4, 2.8], sec_ids),
    ('equipment-hacs-aft', 'After HACS Mk III', [0, 19.1, 39.5], [2.6, 2.4, 2.8], sec_ids),
    ('equipment-pom-pom-director-p', 'Port pom-pom director', [-4.4, 21.0, -30.4], [1.4, 1.6, 1.4], pp_ids),
    ('equipment-pom-pom-director-s', 'Starboard pom-pom director', [4.4, 21.0, -30.4], [1.4, 1.6, 1.4], pp_ids),
    ('equipment-pom-pom-director-aft', 'After pom-pom director', [0, 17.0, 42.8], [1.4, 1.6, 1.4], pp_ids)]:
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', center=center, size=size, hp=65,
                             protectionMm=10, immersionToleranceM=.3, servesMountIds=serves))

# ---------------------------------------------------------------- protection
def plate(id, name, vs, mm, exterior=False, note='Thickness as carried by the approved reference model; placement simplified to planar plates.'):
    vs = [[round(n, 4) for n in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]; hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[(a + c) / 2 for a, c in zip(lo, hi)], size=[max(.001, c - a) + 1e-4 for a, c in zip(lo, hi)],
        thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
        provenance=dict(sourceId='gm3d-pbsb507-armour', basis='plan-measured', note=note)))


def split(z0, z1, step):
    n = max(1, math.ceil((z1 - z0) / step))
    return [(z0 + (z1 - z0) * i / n, z0 + (z1 - z0) * (i + 1) / n) for i in range(n)]


def belt(key, name, z0, z1, y0, y1, mm, exterior=True, inset=.02):
    for side, sign in [('port', -1), ('starboard', 1)]:
        for j, (a, c) in enumerate(split(z0, z1, 10)):
            wa = half(a, (y0 + y1) / 2) - inset; wc = half(c, (y0 + y1) / 2) - inset
            plate(f'{key}-{side}-{j}', f'{side.title()} {name}', [[sign * wa, y0, a], [sign * wc, y0, c], [sign * wc, y1, c], [sign * wa, y1, a]], mm, exterior)


belt('belt-main', 'main belt', -76.6, 92.2, -2.8, .5, 305)
belt('belt-middle', 'middle belt', -72.9, 86.4, .5, 2.8, 178)
belt('belt-upper', 'upper belt', -72.9, 42.4, 2.8, 5.3, 127)
belt('belt-upper-aft', 'upper belt, after section', 42.4, 48.5, .5, 2.4, 102)
belt('belt-bow', 'bow belt', -104.0, -76.6, -2.8, 2.5, 127)
belt('belt-stern', 'stern belt', 92.2, 106.7, -2.8, -.2, 152)
belt('belt-lower', 'lower belt strake', -78.5, 92.2, -3.7, -2.8, 76)
for j, (a, c) in enumerate(split(-76.6, 88.8, 10)):
    for side, sign in [('port', -1), ('starboard', 1)]:
        outer = min(13.3, half(a, -2.8) - .6, half(c, -2.8) - .6); inner = min(10.7, outer - 2.4)
        plate(f'slope-{side}-{j}', f'{side.title()} sloped main deck', [[sign * inner, -.2, a], [sign * inner, -.2, c], [sign * outer, -2.8, c], [sign * outer, -2.8, a]], 51)
    inner = min(10.7, half(a, -2.8) - 3.0, half(c, -2.8) - 3.0)
    plate(f'main-deck-{j}', 'Main armoured deck', [[-inner, -.2, a], [inner, -.2, a], [inner, -.2, c], [-inner, -.2, c]], 76)
for j, (a, c) in enumerate(split(-75.5, 42.6, 10)):
    y = min(deck_at(a), deck_at(c)) - .05; w = min(half(a, y - .2), half(c, y - .2)) - .25
    plate(f'upper-deck-{j}', 'Upper deck', [[-w, y, a], [w, y, a], [w, y, c], [-w, y, c]], 51)
for key, name, z, y0, y1, mm in [('bulkhead-forward', 'Forward armoured bulkhead', -76.6, -2.8, 5.3, 127), ('bulkhead-aft', 'After armoured bulkhead', 92.2, -2.8, 2.4, 127)]:
    w = min(half(z, y0), half(z, y1)) - .2
    plate(key, name, [[-w, y0, z], [w, y0, z], [w, y1, z], [-w, y1, z]], mm)
for mid, bands in [('main-a', [(-.2, 2.5, 127), (2.5, 3.8, 254), (3.8, 7.47, 305)]), ('main-b', [(-.2, 2.5, 127), (2.5, 5.5, 152), (5.5, 10.57, 305)]),
                   ('main-x', [(-.2, 2.5, 152), (2.5, 7.39, 305)]), ('main-y', [(-.2, 1.7, 254), (1.7, 4.35, 305)])]:
    m = next(m for m in b['mounts'] if m['id'] == mid); z = m['position'][2]; r = 4.95
    for y0, y1, mm in bands:
        for i in range(24):
            a = i * math.tau / 24; c = (i + 1) * math.tau / 24
            plate(f'{mid}-barbette-{int(y0 * 10)}-{i}', m['name'] + ' barbette', [[r * math.cos(a), y0, z + r * math.sin(a)], [r * math.cos(c), y0, z + r * math.sin(c)],
                  [r * math.cos(c), y1, z + r * math.sin(c)], [r * math.cos(a), y1, z + r * math.sin(a)]], mm)
ct = ellipse(-47.55, 3.2, 3.95, 16)
for i, (p0, p1) in enumerate(zip(ct, ct[1:] + ct[:1])):
    plate(f'conning-tower-{i}', 'Conning tower', [[p0[0], 13.4, p0[1]], [p1[0], 13.4, p1[1]], [p1[0], 16.5, p1[1]], [p0[0], 16.5, p0[1]]], 280)
plate('conning-tower-roof', 'Conning-tower roof', [[x, 16.5, z] for x, z in reversed(ct)], 127)

b['underwaterProtection'] = dict(version=1, basis='Provisional gameplay underwater defense: external bulges over the citadel, central side coverage and 40% reductions estimated from the reference bulge and 38 mm torpedo bulkhead, not measured historical protection ratings. Ends and keel remain unprotected.',
    zones=[dict(id=f'{side}-underwater-defense', name=f'{side.title()} underwater defense', center=[sign * 13.3, -5.2, 7.8], size=[4.4, 9, 157], damageReduction=.4, breachReduction=.4)
           for side, sign in [('port', -1), ('starboard', 1)]])
# Installation interlocks: the four 15-inch houses and barrels against the tall tiers ahead
# and abaft them and against their superfiring neighbours (A/B and X/Y).
body = dict(center=[0, 1.6, 1.25], size=[9.6, 2.9, 11.7])
b['mountClearance'] = dict(version=1, marginM=.03,
    basis='Provisional CPU motion interlocks: gunhouse boxes enclose the catalog 15-inch Mk II shell and its roof fittings; barrels use the catalog base radius through the full recoil stroke. Tested against the tiers a trained or depressed barrel can reach and against the superfiring neighbour. Game clearance envelopes, not verified historical mechanical stops.',
    mounts=[dict(mountId=m, barrelRadiusM=.5, body=body) for m in main_ids],
    structures=[dict(structureId=s, topExtensionM=.9) for s in ['forward-superstructure', 'bridge-base', 'conning-tower', 'shelter-deck-aft']],
    neighbors=[['main-a', 'main-b'], ['main-x', 'main-y']])
b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=240, roomFuelSeconds=140, mountFuelSeconds=50, suppressionPerSecond=.065,
    portablePumpM3PerSecond=.09, repairHpPerSecond=.5, repairCeiling=.6, patchM2PerSecond=.012, maxPatchM2=.3, flashProtection=.85,
    basis='Shared provisional battleship crew/fuel/repair calibration; not historical manning, flash trials or damage-control performance.')
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='white-ensign', position=[0, 10.2, 128.6], width=4.2, staffHeight=5.9)],
                radars=[dict(id='radar-279', nodeId='radar-279.yaw', rpm=4), dict(id='radar-284', nodeId='dct-foretop.yaw', rpm=2, sweepDeg=50)])
b['localDamage'] = dict(version=1, regions=[], basis='Replaced by author-local-damage.ts.')

write(HERE / 'blueprint.json', b)
print(f'Hood: L {L} m, beam {BEAM:.2f} m, draft {DRAFT:.2f} m, displacement {MASS / 1000:.0f} t, waterplane {WATERPLANE:.0f} m2, '
      f'{len(b["mounts"])} mounts, {len(b["structures"])} structures, {len(b["armor"])} plates, {len(b["compartments"])} rooms')

"""Original USS Alaska (CB-1) 1944-45 blueprint authoring, GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was
first made and can rebuild everything except the measured hull stations and
superstructure tiers, which it keeps from the current blueprint unless fresh
measurement files are passed:

  python3 assets/ships/alaska/author-blueprint.py [--loft loft.json] [--structures superstructure.json]

The measurement files are produced in ignored .build/alaska/ from the cached
`bun run ship:reference pasc510` view (station outlines sampled by height, deck
line by downward rays, deckhouse tiers by plan slices). They hold our own
sampled offsets, never source triangles. Mount datums, armour zones and plate
thicknesses are read from the approved GameModels3D model and are provisional
game calibration, not a historical survey. Run afterwards:
author-flood-spaces.ts, author-stability.ts, author-local-damage.ts and
author-damage-control.ts alaska.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = -1.995          # reference z of the hull's mid-length; runtime z = reference z - ZC
L = 246.706          # stem to transom at the reference waterline datum
DRAFT = 9.851
DEPTH = 14.262       # keel to the midships weather deck


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


def rz(z):
    return round(z - ZC, 4)


args = argparse.ArgumentParser()
args.add_argument('--loft')
args.add_argument('--structures')
args.add_argument('--keep-gameplay', action='store_true',
                  help='carry compartments, connections, modules, flood regions, local damage and stability over from the current blueprint (they come from the later authoring helpers)')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
if opts.loft:
    loft = json.loads(Path(opts.loft).read_text())
    sections = sorted(({'station': s['station'], 'points': s['points']} for s in loft['sections']), key=lambda s: s['station'])
    # A hawse recess reads as a dip in the deck line; replace such stations by their neighbours' blend.
    for i in range(2, len(sections) - 2):
        near = sorted(sections[j]['points'][-1][1] for j in (i - 2, i - 1, i + 1, i + 2))
        if abs(sections[i]['points'][-1][1] - (near[1] + near[2]) / 2) > .3:
            a, b = sections[i - 1], sections[i + 1]
            t = (sections[i]['station'] - a['station']) / (b['station'] - a['station'])
            sections[i]['points'] = [[round(p[0] + (q[0] - p[0]) * t, 4), round(p[1] + (q[1] - p[1]) * t, 4)] for p, q in zip(a['points'], b['points'])]
    sections[0]['station'] = 0
    last = sections[-1]
    n = len(last['points'])
    top = max(p[1] for p in last['points'])
    # Stem head: the raked stem closes on one vertical line at the reference's forward-most point.
    sections.append({'station': L, 'points': [[0, round(top - .75 + .75 * k / (n - 1), 4)] for k in range(n)]})
    for s in sections:
        s['station'] = round(s['station'], 4)
        for p in s['points']:
            p[1] = max(p[1], -DRAFT)
else:
    sections = previous['hull']['sections']


def area_below(points, level):
    pts = [(w, y) for w, y in points]
    total = 0
    for (w0, y0), (w1, y1) in zip(pts, pts[1:]):
        lo, hi = y0, min(y1, level)
        if hi <= lo:
            continue
        f = (hi - y0) / (y1 - y0) if y1 > y0 else 1
        total += (w0 + (w0 + (w1 - w0) * f)) / 2 * (hi - lo) * 2
    return total


def breadth_at(points, level):
    ys = [p[1] for p in points]
    if level < ys[0] or level > ys[-1]:
        return 0
    return interp([(p[1], p[0]) for p in points], level)


def integrate(fn):
    return sum((fn(a) + fn(b)) / 2 * (b['station'] - a['station']) for a, b in zip(sections, sections[1:]))


volume = integrate(lambda s: area_below(s['points'], 0))
above = integrate(lambda s: area_below(s['points'], 50)) - volume
waterplane = integrate(lambda s: 2 * breadth_at(s['points'], 0))
beam = 2 * max(p[0] for s in sections for p in s['points'])
hull = dict(kind='authored-stations-v1', length=L, beam=round(beam, 4), draft=DRAFT, depth=DEPTH,
            massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round(above * .55, 1),
            halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
            deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
            keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
            sections=sections)


def deck_y(z):
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / (b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='alaska', name='USS Alaska',
         configuration='CB-1 · 1944-45 exterior after the GameModels3D pasc510 A hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/alaska.glb', hull=hull,
         handling=dict(forwardSpeed=round(33 * .5144444, 4), reverseSpeed=4, acceleration=.17, braking=.2, rudderRate=.34, maxYawRate=.02),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 25.3, rz(-12.0)]),
         structuralPlating=dict(hullMm=27, superstructureMm=16, note='Bow and stern shell and deckhouse plating thicknesses read from the approved GameModels3D armour model; used as provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and deckhouse tiers measured from the approved GameModels3D pasc510 A hull at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Nine 12-inch/50 Mk 8, twelve 5-inch/38 Mk 12 on Mk 32 Mod 12, fourteen shielded quad 40 mm Bofors and thirty-four 20 mm Oerlikons at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference datums)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
MAIN = [('main-1', 'Turret 1', [0, 5.955, -60.676], 0), ('main-2', 'Turret 2', [0, 8.75, -44.985], 0), ('main-3', 'Turret 3', [0, 5.702, 61.284], 180)]
for id, name, (x, y, z), bearing in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 12-inch', partId='us-12in50-mk8-triple', battery='main', position=[x, y, rz(z)], bearingDeg=bearing,
                            rangefinder=True, magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE_MAIN))
SECONDARY = [([0, 10.572, -31.962], 0, [-140, 140]), ([-10.789, 7.493, -18.64], 0, [-142, 0]), ([10.79, 7.493, -18.64], 0, [0, 142]),
             ([-10.901, 7.397, 26.939], 180, [0, 160]), ([10.899, 7.397, 26.939], 180, [-160, 0]), ([0, 9.602, 48.86], 180, [-140, 140])]
for i, ((x, y, z), bearing, limits) in enumerate(SECONDARY, 1):
    b['mounts'].append(dict(id=f'secondary-{i}', name=f'5-inch mount {i}', partId='us-5in38-mk32-mod12', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, traverseLimitsDeg=limits, rangefinder=False,
                            magazineId='secondary-magazine-forward' if z < 0 else 'secondary-magazine-after', fire=FIRE_LIGHT))
BOFORS = [([0, 9.24, -117.22], 0), ([-5.06, 10.1, -25.82], -90), ([5.06, 10.1, -25.82], 90), ([0, 15.53, -24.79], 0), ([-6.53, 11.16, -13.94], -90),
          ([6.53, 11.16, -13.94], 90), ([-5.89, 9.36, 31.98], -90), ([5.89, 9.36, 31.98], 90), ([-7.62, 7.08, 37.96], -90), ([7.62, 7.08, 37.96], 90),
          ([-6.15, 4.64, 97.09], -135), ([6.15, 4.64, 97.09], 135), ([-3.71, 4.42, 117.66], 180), ([3.71, 4.42, 117.66], 180)]
# Reference datums a few centimetres below our loft's deck (sheer and camber): the rotating base would sit in
# the plating, so these stand on a raised foundation plate instead (runtime y, metres).
SEATED = {'bofors-11': 4.75, 'bofors-12': 4.75, 'bofors-13': 4.47, 'bofors-14': 4.47,
          'oerlikon-1': 6.7, 'oerlikon-2': 6.7, 'oerlikon-3': 6.53, 'oerlikon-4': 6.53}
for i, ((x, y, z), bearing) in enumerate(BOFORS, 1):
    y = SEATED.get(f'bofors-{i}', y)
    b['mounts'].append(dict(id=f'bofors-{i}', name=f'40-mm quad {i}', partId='us-40mm-bofors-mk2-shielded-quad', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT))
OERLIKON = [([-4.95, 6.59, -91.89], -45), ([4.95, 6.61, -91.89], 45), ([-5.2, 6.44, -88.97], -45), ([5.2, 6.44, -88.97], 45),
            ([-9.99, 4.85, -47.89], -45), ([9.99, 4.85, -47.89], 45), ([-10.55, 4.79, -45.01], -45), ([10.55, 4.79, -45.01], 45),
            ([-11.82, 5.72, -28.23], -90), ([11.82, 5.72, -28.23], 90), ([-12.09, 5.72, -25.4], -90), ([12.09, 5.72, -25.4], 90),
            ([-7.25, 7.19, 11.0], -90), ([7.26, 7.19, 11.0], 90), ([-12.51, 4.41, 12.58], -90), ([12.51, 4.41, 12.58], 90),
            ([-12.51, 4.41, 15.64], -90), ([12.51, 4.41, 15.64], 90), ([-7.25, 7.19, 17.36], -90), ([7.26, 7.19, 17.37], 90),
            ([-12.41, 5.41, 20.03], -90), ([12.41, 5.41, 20.03], 90), ([-12.41, 5.81, 33.85], -90), ([12.41, 5.81, 33.85], 90),
            ([-12.3, 4.57, 36.77], -90), ([12.3, 4.57, 36.77], 90), ([-11.07, 4.41, 44.59], -90), ([11.07, 4.41, 44.59], 90),
            ([-11.07, 4.41, 47.75], -90), ([11.07, 4.41, 47.75], 90), ([-9.71, 4.46, 76.39], -135), ([9.72, 4.46, 76.39], 135),
            ([-9.31, 4.47, 79.39], -135), ([9.31, 4.47, 79.39], 135)]
for i, ((x, y, z), bearing) in enumerate(OERLIKON, 1):
    y = SEATED.get(f'oerlikon-{i}', y)
    b['mounts'].append(dict(id=f'oerlikon-{i}', name=f'20-mm single {i}', partId='us-20mm-oerlikon-mk4-iowa', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT))

# ---------------------------------------------------------------- superstructure
FUNNEL = dict(x=0, z0=11.75, z1=19.98, half=2.3, base=9.1, top=24.6)
if opts.structures:
    raw = json.loads(Path(opts.structures).read_text())

    def centroid(poly):
        return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)

    def inside_funnel(s):
        x, z = centroid(s['poly'])
        return abs(x) < FUNNEL['half'] + .2 and rz(FUNNEL['z0']) - .2 < z < rz(FUNNEL['z1']) + .2 and s['base'] > FUNNEL['base'] - .3

    def area(poly):
        return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2

    def fill(poly):
        xs, zs = [p[0] for p in poly], [p[1] for p in poly]
        return area(poly) / max(1e-6, (max(xs) - min(xs)) * (max(zs) - min(zs)))

    # Thin rings are bulwarks and splinter walls, which the recipe builds as open plating.
    blocks = [s for s in raw if s['kind'] == 'block' and not inside_funnel(s) and fill(s['poly']) > .3]
    # Measured roofs found by an upward ray can belong to a platform above an open-topped
    # column; these recorded corrections come from the reference's own plan slices.
    for s in blocks:
        x, z = centroid(s['poly'])
        if abs(x) < .5 and abs(z - rz(-10.73)) < .6 and abs(s['base'] - 24.15) < .1:
            s['top'] = 26.0

    def touches(p, q, gap=.35):
        (ax0, az0), (ax1, az1) = [min(v[0] for v in p['poly']), min(v[1] for v in p['poly'])], [max(v[0] for v in p['poly']), max(v[1] for v in p['poly'])]
        (bx0, bz0), (bx1, bz1) = [min(v[0] for v in q['poly']), min(v[1] for v in q['poly'])], [max(v[0] for v in q['poly']), max(v[1] for v in q['poly'])]
        return ax0 < bx1 + gap and bx0 < ax1 + gap and az0 < bz1 + gap and bz0 < az1 + gap

    # A block measured only by its upper part (nothing beneath it) stands on the weather deck.
    def contains(poly, pt):
        x, z = pt
        c = False
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
                c = not c
        return c
    def overlaps(p, q):
        return any(contains(q, v) for v in p) or any(contains(p, v) for v in q)

    for s in blocks:
        c = centroid(s['poly'])
        deck = deck_y(c[1])
        if s['base'] <= deck + .5 or s['top'] - s['base'] < .2 or area(s['poly']) > 20:
            continue
        near = [k for k in blocks + [p for p in raw if p['kind'] == 'plate'] if k is not s and overlaps(s['poly'], k['poly'])]
        if any(-.05 < s['base'] - k['top'] < .05 for k in near):
            continue
        under = [k for k in near if .05 <= s['base'] - k['top'] < .35]
        s['base'] = max(k['top'] for k in under) if under else round(deck, 3)
    def edge_gap(p, q):
        def seg(pt, a, b):
            ax, az, bx, bz = a[0], a[1], b[0], b[1]
            dx, dz = bx - ax, bz - az
            t = max(0, min(1, ((pt[0] - ax) * dx + (pt[1] - az) * dz) / max(1e-12, dx * dx + dz * dz)))
            return math.hypot(pt[0] - ax - t * dx, pt[1] - az - t * dz)
        return min(min(seg(v, a, b) for a, b in zip(q, q[1:] + q[:1])) for v in p)

    def carried(s, k):
        if not touches(s, k):
            return False
        on_top = -.05 < s['base'] - k['top'] < .4 and overlaps(s['poly'], k['poly'])
        on_wall = k['base'] - .3 <= s['base'] <= k['top'] + .3 and (overlaps(s['poly'], k['poly']) or min(edge_gap(s['poly'], k['poly']), edge_gap(k['poly'], s['poly'])) < .3)
        return on_top or on_wall

    # A plate stays only when a deckhouse wall or roof carries it; mast platforms belong to the recipe's masts.
    plates = [s for s in raw if s['kind'] == 'plate' and not inside_funnel(s) and s['top'] < 33 and any(carried(s, k) for k in blocks)]
    # Close measured seams between stacked pieces: a plate resting over a block drops onto it.
    for s in plates:
        under = [k for k in blocks if .02 < s['base'] - k['top'] < .4 and overlaps(s['poly'], k['poly'])]
        if under:
            s['base'] = max(k['top'] for k in under)
    structures = []
    for k, s in enumerate(sorted(blocks + plates, key=lambda s: (centroid(s['poly'])[1], s['base']))):
        x, z = centroid(s['poly'])
        region = 'Forward superstructure' if z < -3 else 'Aircraft deck' if z < 11 else 'After superstructure'
        kind = 'platform' if s['kind'] == 'plate' else 'deckhouse'
        structures.append(dict(id=f'{kind}-{k + 1:03d}', name=f'{region} {kind} {s["base"]:.1f}-{s["top"]:.1f} m',
                               footprint=s['poly'], baseY=s['base'], height=round(s['top'] - s['base'], 3), material='naval'))
    n = 48
    stadium = []
    for i in range(n):
        a = i * math.tau / n
        cx = FUNNEL['x'] + FUNNEL['half'] * math.cos(a)
        straight = (FUNNEL['z1'] - FUNNEL['z0']) / 2 - FUNNEL['half']
        cz = (FUNNEL['z0'] + FUNNEL['z1']) / 2 + math.copysign(straight, math.sin(a)) + FUNNEL['half'] * math.sin(a)
        stadium.append([round(cx, 3), rz(cz)])
    structures.append(dict(id='funnel', name='Funnel', footprint=stadium, baseY=FUNNEL['base'], height=round(FUNNEL['top'] - FUNNEL['base'], 3), material='naval',
                           exhaust=dict(position=[0, FUNNEL['top'], rz((FUNNEL['z0'] + FUNNEL['z1']) / 2)], width=4.0, length=7.6)))
else:
    structures = previous['structures']


# ---------------------------------------------------------------- corrections from the 2026 accuracy pass
# Measured tiers the reference's own plan and elevation cuts contradict, applied after either source of
# structures and idempotent, so a rerun keeps them. Tapers give a structure a lofted `surface` (drawn);
# its footprint prism stays the hit and obstruction proxy.
def frustum(fp, y0, y1, ring):
    lo = [ring(x, z, y0) for x, z in fp]
    hi = [ring(x, z, y1) for x, z in fp]
    n = len(fp)
    vertices = [[round(x, 4), round(y0, 4), round(z, 4)] for x, z in lo] + [[round(x, 4), round(y1, 4), round(z, 4)] for x, z in hi]
    triangles = [[0, i, i + 1] for i in range(1, n - 1)] + [[n, n + i + 1, n + i] for i in range(1, n - 1)]
    for i in range(n):
        j = (i + 1) % n
        triangles += [[i, j, n + j], [i, n + j, n + i]]
    return dict(vertices=vertices, triangles=triangles)


def mirrored(s, new_id):
    t = json.loads(json.dumps(s))
    t['id'] = new_id
    t['footprint'] = [[round(-x, 3), z] for x, z in reversed(s['footprint'])]
    return t


def disc(cx, cz, r, x_limit, n=28):
    """A round platform clipped where it meets the ship's side (|x| <= x_limit)."""
    pts = []
    for i in range(n):
        a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
        p = (cx + r * math.cos(a0), cz + r * math.sin(a0))
        q = (cx + r * math.cos(a1), cz + r * math.sin(a1))
        if abs(p[0]) <= x_limit:
            pts.append(p)
        if (abs(p[0]) - x_limit) * (abs(q[0]) - x_limit) < 0:
            edge = math.copysign(x_limit, p[0] if abs(p[0]) > x_limit else q[0])
            t = (edge - p[0]) / (q[0] - p[0])
            pts.append((edge, p[1] + (q[1] - p[1]) * t))
    return [[round(x, 3), round(z, 3)] for x, z in pts]


RAKE = .1435    # the forward tower face leans aft 1.98 m over 13.8 m (reference x = 1.2 cut)


def refine(structures):
    by_id = {s['id']: s for s in structures}
    # Phantom solids: the funnel-side searchlight platforms and their hanging boxes were extruded to the
    # 01 deck; a duplicate inner tower tier; the port-only forward tub floor (tub floors are drawn per mount).
    # The three tall columns behind the funnel are the exhaust pipe and after-arm web, which the recipe draws.
    out = [s for s in structures if s['id'] not in ('deckhouse-084', 'deckhouse-085', 'deckhouse-058', 'platform-077',
                                                    'deckhouse-090', 'deckhouse-091', 'deckhouse-093')]
    for sid in ('deckhouse-086', 'deckhouse-087'):
        if sid in by_id:
            by_id[sid].update(baseY=19.1, height=1.74)
    f = by_id['funnel']
    f['height'] = round(25.05 - f['baseY'], 3)
    f['exhaust']['position'][1] = 26.0
    # The 01 deckhouse round the funnel: its full breadth stops at the tub deck (7.16); above it only the
    # narrower kingpost houses (deckhouse-094) stand, so Oerlikons 13/14/19/20 sit on the tub deck.
    by_id['deckhouse-095']['height'] = round(7.16 - by_id['deckhouse-095']['baseY'], 3)
    # Supports whose tops coincide with a light-AA datum drop 3 cm so the mount's own tub floor seats it.
    for sid, top in (('deckhouse-041', 11.13), ('deckhouse-042', 11.13), ('platform-102', 9.33), ('platform-103', 9.33),
                     ('deckhouse-115', 7.05), ('platform-027', 15.5), ('deckhouse-088', 5.37), ('deckhouse-089', 5.37)):
        s = by_id[sid]
        s['height'] = round(top - s['baseY'], 3)
    for sid in ('deckhouse-112', 'deckhouse-113'):
        by_id[sid].update(baseY=5.72, height=.06)
    for sid in ('deckhouse-135', 'deckhouse-136'):
        by_id[sid]['height'] = round(6.272 - by_id[sid]['baseY'], 3)
    # Mirror halves the plan cuts found on one side only.
    ids = {s['id'] for s in out}
    if 'platform-036-starboard' not in ids:
        out.append(mirrored(by_id['platform-036'], 'platform-036-starboard'))
    if 'deckhouse-115-port' not in ids:
        out.append(mirrored(by_id['deckhouse-115'], 'deckhouse-115-port'))
    # Round sponson decks under the after wing 5-inch mounts (reference 7.10-7.18 m, radius 4.2 m).
    for side, sign in (('port', -1), ('starboard', 1)):
        sid = f'platform-5in-aft-{side}'
        if sid not in ids:
            out.append(dict(id=sid, name=f'After superstructure platform 7.1-7.2 m ({side} 5-inch sponson)',
                            footprint=disc(sign * 10.9, 28.94, 4.2, 13.65), baseY=7.1, height=.08, material='naval'))
    # The forward tower leans aft and its upper tier narrows (reference cuts x = 1.2 and z = -5).
    by_id['deckhouse-055']['surface'] = frustum(by_id['deckhouse-055']['footprint'], 10.411, 21.934,
                                                lambda x, z, y: (x, z + (RAKE * (y - 15.4) if z < -5 else 0)))
    by_id['deckhouse-057']['surface'] = frustum(by_id['deckhouse-057']['footprint'], 21.992, 24.118,
                                                lambda x, z, y: (x * (1 - (y - 21.992) * .0904 / 2.28), z + (RAKE * (y - 21.992) + .1 if z < -5 else 0)))
    by_id['deckhouse-056']['surface'] = frustum(by_id['deckhouse-056']['footprint'], 24.149, 28.753,
                                                lambda x, z, y: (x * (2.086 - (y - 24.149) * .0904) / 2.05, z + (RAKE * (y - 24.149) + .185 if z < -5 else 0)))
    return out


structures = refine(structures)
b['structures'] = structures

# Firing obstructions: boxes kept inside the visual walls for substantial blocks. Each outline is
# cut into fore-and-aft strips of at most 3 m so a stepped deckhouse is not boxed at its widest.
for s in structures:
    poly = s['footprint']
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    if s['height'] < 1.2 or (max(xs) - min(xs)) * (max(zs) - min(zs)) < 6:
        continue
    n = max(1, math.ceil((max(zs) - min(zs)) / 3))
    for k in range(n):
        z0 = min(zs) + (max(zs) - min(zs)) * k / n
        z1 = min(zs) + (max(zs) - min(zs)) * (k + 1) / n
        pts = [p[0] for p in poly if z0 <= p[1] <= z1]
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            for zc in (z0, z1):
                if (az - zc) * (bz - zc) < 0:
                    pts.append(ax + (bx - ax) * (zc - az) / (bz - az))
        if len(pts) < 2 or max(pts) - min(pts) < .6 or z1 - z0 < .6:
            continue
        b['obstructions'].append(dict(id=f"{s['id']}-{k}", center=[round((min(pts) + max(pts)) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((z0 + z1) / 2, 3)],
                                      size=[round(max(pts) - min(pts) - .4, 3), round(s['height'], 3), round(z1 - z0 - .2, 3)]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: barrels (with the full recoil stroke) may not enter the deckhouse
# prisms they can reach, and the superfiring pair may not cross. Game clearance, not
# verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
clear_mounts, reach = [], {}
INTERLOCKED_AA = ('bofors-5', 'bofors-6')   # quads beside the forward tower, whose barrels reach its side houses
for m in b['mounts']:
    if m['battery'] != 'main' and m['partId'] != 'us-5in38-mk32-mod12' and m['id'] not in INTERLOCKED_AA:
        continue
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(w['barrelBaseRadius'] * .75, 3))
    if m['battery'] == 'main':
        entry['body'] = dict(center=[0, 1.37, 1.6], size=[9.92, 2.62, 12.65])
    clear_mounts.append(entry)
    reach[m['id']] = (m['position'], w['muzzleForward'] + 1.5, m['position'][1] + w['pivotHeight'])
nearby = []
for st in structures:
    xs = [p[0] for p in st['footprint']]
    zs = [p[1] for p in st['footprint']]
    best = None
    for (x, y, z), r, pivot in reach.values():
        dx = max(min(xs) - x, 0, x - max(xs))
        dz = max(min(zs) - z, 0, z - max(zs))
        if math.hypot(dx, dz) <= r and st['baseY'] < pivot + 2 and st['baseY'] + st['height'] > pivot - 3:
            best = min(best if best is not None else 1e9, math.hypot(dx, dz))
    if best is not None:
        nearby.append((best, st['id']))
nearby = [sid for _, sid in sorted(nearby)[:128]]
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for the main and 5-inch mounts and the two quad 40 mm beside the forward tower against the measured deckhouse prisms they can reach, including the full recoil stroke, and between the superfiring forward turrets. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=1.15 if any(st['id'] == sid and st['height'] < .3 and (abs(st['baseY'] + st['height'] - 21.99) < .1 or abs(st['baseY'] + st['height'] - 28.845) < .1) for st in structures) else 0) for sid in nearby],
                           neighbors=[['main-1', 'main-2'], ['main-2', 'secondary-1']])

# ---------------------------------------------------------------- rooms, machinery, directors
def room(id, name, center, size, kind=None, role=None, hp=150, fire=None):
    cid = id + '-room'
    compartment = dict(id=cid, name=name + ' space', center=center, size=size, capacityM3=round(math.prod(size) * .78, 1), pumpM3PerSecond=.016)
    if fire:
        compartment['fire'] = dict(fire, ventPosition=[center[0], round(deck_y(center[2]) + .5, 3), center[2]])
    b['compartments'].append(compartment)
    if kind:
        module = dict(id=id, name=name, kind=kind, compartmentId=cid, center=center, size=[round(v * .8, 3) for v in size], hp=hp, immersionToleranceM=.8)
        if role:
            module['role'] = role
        b['modules'].append(module)


MAG = dict(fuelSeconds=150, ignitionHeat=.65, heatPerDamage=.014)
ENG = dict(fuelSeconds=240, ignitionHeat=.55, heatPerDamage=.014)
room('magazine-forward', 'Forward 12-inch magazine', [0, -5.2, -50.5], [12, 7, 24], 'magazine', hp=240, fire=MAG)
room('magazine-after', 'After 12-inch magazine', [0, -5.2, 62.5], [12, 7, 13], 'magazine', hp=220, fire=MAG)
room('secondary-magazine-forward', 'Forward 5-inch magazine', [0, -5.2, -33.5], [10, 6, 8], 'magazine', hp=140, fire=MAG)
room('secondary-magazine-after', 'After 5-inch magazine', [0, -5.2, 52], [10, 6, 7], 'magazine', hp=140, fire=MAG)
room('aa-ammunition-forward', 'Forward 40-mm ready ammunition', [0, 1.1, -24], [8, 2, 8], 'magazine', hp=90, fire=MAG)
room('aa-ammunition-after', 'After 40-mm ready ammunition', [0, 1.1, 36], [8, 2, 8], 'magazine', hp=90, fire=MAG)
spaces = [('fireroom-1', 'No. 1 fireroom', -21.0, 13), ('engine-room-1', 'No. 1 engine room', -7.0, 13), ('fireroom-2', 'No. 2 fireroom', 7.0, 13), ('engine-room-2', 'No. 2 engine room', 21.5, 14)]
for id, name, z, length in spaces:
    kind_role = ('boiler' if id.startswith('fire') else 'turbine')
    room(id, name, [0, -5.0, z], [20, 8, length], 'engine', kind_role, 220, ENG)
room('shaft-alley', 'Shaft alley', [0, -6.4, 38], [10, 4, 17], fire=ENG)
for i, x in enumerate([-3.9, -1.3, 1.3, 3.9], 1):
    b['modules'].append(dict(id=f'shaft-{i}', name=f'Shaft {i}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[x, -6.8, 38], size=[.7, 1.1, 15], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -1.25, rz(103.15)], [12, 2.2, 11], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='forward-drive', share=.5, boilerIds=['fireroom-1'], driveIds=['engine-room-1'], shaftIds=['shaft-1', 'shaft-4']),
    dict(id='after-drive', share=.5, boilerIds=['fireroom-2'], driveIds=['engine-room-2'], shaftIds=['shaft-2', 'shaft-3'])],
    basis='Provisional unit machinery: alternating firerooms and engine rooms feeding two shaft pairs with equal shares. Room bounds and routing are estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
SEC_IDS = [m['id'] for m in b['mounts'] if m['partId'] == 'us-5in38-mk32-mod12']
BOFORS_M = [m for m in b['mounts'] if m['id'].startswith('bofors-')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


director('mk38-forward', 'Forward Mk 38 main director', [0, 32.24, -7.707], MAIN_IDS, [3.2, 2.2, 3.2], 70, 10)
director('mk38-after', 'After Mk 38 main director', [0, 20.393, 33.164], MAIN_IDS, [3.2, 2.2, 3.2], 70, 10)
director('mk37-forward', 'Forward Mk 37 director', [0, 17.805, -17.016], SEC_IDS, [3.2, 2.2, 3.4], 65, 6)
director('mk37-after', 'After Mk 37 director', [0, 14.109, 41.217], SEC_IDS, [3.2, 2.2, 3.4], 65, 6)
SMALL = [('mk57', [0, 11.19, -111.26]), ('mk51', [0, 12.76, -27.61]), ('mk51', [-4.15, 12.76, -20.88]), ('mk51', [4.15, 12.76, -20.88]),
         ('mk57', [0, 17.3, -20.49]), ('mk57', [-2.94, 15.11, -17.27]), ('mk57', [2.94, 15.11, -17.27]), ('mk57', [-3.54, 16.07, -11.49]),
         ('mk57', [3.54, 16.07, -11.49]), ('mk57', [-4.15, 11.95, 29.02]), ('mk57', [4.15, 11.95, 29.02]), ('mk51', [-3.28, 14.02, 31.31]),
         ('mk51', [3.28, 14.02, 31.31]), ('mk57', [-3.54, 11.1, 38.12]), ('mk57', [3.54, 11.1, 38.12]), ('mk51', [0, 11.66, 43.84]),
         ('mk57', [-1.38, 6.65, 93.78]), ('mk57', [1.38, 6.65, 93.78]), ('mk57', [-1.77, 6.5, 110.94]), ('mk57', [1.77, 6.5, 110.94])]
for i, (kind, (x, y, z)) in enumerate(SMALL, 1):
    near = min(BOFORS_M, key=lambda m: math.dist([x, y, rz(z)], m['position']))
    director(f'{kind}-{i}', f'{"Mk 57" if kind == "mk57" else "Mk 51"} AA director {i}', [x, y, z], [near['id']], [.9, 1.5, .9], 25, 3)

# ---------------------------------------------------------------- protection (GameModels3D armour thicknesses)
def plate(id, name, vs, mm, exterior=False, note='Thickness from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pasc510-armour', basis='inferred', note=note)))


CIT_FWD, CIT_AFT = rz(-67.2), rz(67.6)
SEG = 14
for side, sign in [('port', -1), ('starboard', 1)]:
    for j in range(SEG):
        z0 = CIT_FWD + (CIT_AFT - CIT_FWD) * j / SEG
        z1 = CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / SEG
        for label, y0, y1, mm in [('main belt', -.4, 2.4, 229), ('lower belt', -2.7, -.4, 178), ('upper side', 2.4, None, 28)]:
            top0 = deck_y(z0) if y1 is None else y1
            top1 = deck_y(z1) if y1 is None else y1
            vs = [[sign * half_breadth(z0, y0) * .998, y0, z0], [sign * half_breadth(z1, y0) * .998, y0, z1],
                  [sign * half_breadth(z1, top1) * .998, top1, z1], [sign * half_breadth(z0, top0) * .998, top0, z0]]
            # The shell is curved, so each band is two planar triangles.
            plate(f'belt-{side}-{j}-{label.replace(" ", "-")}-a', f'{side.title()} {label}', vs[:3], mm, True)
            plate(f'belt-{side}-{j}-{label.replace(" ", "-")}-b', f'{side.title()} {label}', [vs[0], vs[2], vs[3]], mm, True)
for j in range(SEG):
    z0 = CIT_FWD + (CIT_AFT - CIT_FWD) * j / SEG
    z1 = CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / SEG
    for label, y, mm, factor in [('armoured deck', 2.4, 102, .99), ('splinter deck', -.4, 19, .64)]:
        w0, w1 = half_breadth(z0, y) * factor, half_breadth(z1, y) * factor
        plate(f'{label.replace(" ", "-")}-{j}', label.capitalize(), [[-w0, y, z0], [w0, y, z0], [w1, y, z1], [-w1, y, z1]], mm)
for end, z, mm in [('forward', CIT_FWD, 260), ('after', CIT_AFT, 260)]:
    w = half_breadth(z, 2.4) * .99
    wl = half_breadth(z, -6) * .99
    plate('citadel-' + end, end.title() + ' armoured bulkhead', [[-wl, -6, z], [wl, -6, z], [w, 2.4, z], [-w, 2.4, z]], mm)
    plate('citadel-' + end + '-lower', end.title() + ' lower bulkhead', [[-wl * .8, -9.5, z], [wl * .8, -9.5, z], [wl, -6, z], [-wl, -6, z]], 51)
for m in b['mounts'][:3]:
    r = 5.13
    x, top, z = m['position']
    for band, (y0, y1, mm) in enumerate([(2.4, top + .06, 330), (-.4, 2.4, 70)]):
        for i in range(24):
            a, c = i * math.tau / 24, (i + 1) * math.tau / 24
            plate(f"{m['id']}-barbette-{band}-{i}", m['name'] + (' barbette' if band == 0 else ' lower barbette'),
                  [[r * math.cos(a), y0, z + r * math.sin(a)], [r * math.cos(c), y0, z + r * math.sin(c)], [r * math.cos(c), y1, z + r * math.sin(c)], [r * math.cos(a), y1, z + r * math.sin(a)]], mm)
# Conning tower (reference ss_bridge plates) and the steering-gear box.
ct = dict(x0=-2.3, x1=2.3, y0=12.8, y1=14.9, z0=rz(-26.4), z1=rz(-22.8))
for id, vs, mm in [('ct-port', [[ct['x0'], ct['y0'], ct['z0']], [ct['x0'], ct['y0'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z0']]], 269),
                   ('ct-starboard', [[ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x1'], ct['y1'], ct['z0']]], 269),
                   ('ct-front', [[ct['x0'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x0'], ct['y1'], ct['z0']]], 269),
                   ('ct-back', [[ct['x0'], ct['y0'], ct['z1']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 269),
                   ('ct-roof', [[ct['x0'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 127)]:
    plate(id, 'Conning tower', vs, mm, True)
sg = dict(x=5.2, y0=-2.4, y1=-.1, z0=rz(96.7), z1=rz(109.6))
for id, vs, mm in [('steering-port', [[-sg['x'], sg['y0'], sg['z0']], [-sg['x'], sg['y0'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z0']]], 269),
                   ('steering-starboard', [[sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [sg['x'], sg['y1'], sg['z0']]], 269),
                   ('steering-forward', [[-sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y1'], sg['z0']], [-sg['x'], sg['y1'], sg['z0']]], 269),
                   ('steering-after', [[-sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 269),
                   ('steering-roof', [[-sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 102)]:
    plate(id, 'Steering-gear protection', vs, mm)
b['underwaterProtection'] = dict(version=1, basis='Estimated side-protection system behind the belt; reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'side-{side}', name=f'{side.title()} side protection', center=[sign * 10.5, -5.2, round((CIT_FWD + CIT_AFT) / 2, 3)],
                                             size=[5, 8, round(CIT_AFT - CIT_FWD - 4, 3)], damageReduction=.35, breachReduction=.35) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='us-48', position=[0, round(deck_y(rz(120.9)) + 4.3, 3), rz(120.9)], width=3.6, staffHeight=4.3)],
                radars=[dict(id='radar-sk', nodeId='radar-sk.yaw', rpm=6, phaseDeg=0), dict(id='radar-sg-forward', nodeId='radar-sg-forward.yaw', rpm=15, phaseDeg=47),
                        dict(id='radar-sg-after', nodeId='radar-sg-after.yaw', rpm=15, phaseDeg=133),
                        dict(id='mk38-forward', nodeId='mk38-forward.yaw', rpm=2, sweepDeg=55, phaseDeg=94), dict(id='mk38-after', nodeId='mk38-after.yaw', rpm=2, sweepDeg=55, phaseDeg=141),
                        dict(id='mk37-forward', nodeId='mk37-forward.yaw', rpm=2, sweepDeg=55, phaseDeg=188), dict(id='mk37-after', nodeId='mk37-after.yaw', rpm=2, sweepDeg=55, phaseDeg=235)])
b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=300, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.09, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Provisional large-cruiser crew and finite-stores calibration between the fleet cruiser and battleship values; not historical manning or damage-control performance.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                      basis='Placeholder; author-local-damage.ts replaces it.')
if opts.keep_gameplay and previous:
    for key in ('compartments', 'connections', 'modules', 'localDamage', 'floodRegions', 'stability'):
        if key in previous:
            b[key] = previous[key]
write(HERE / 'blueprint.json', b)
print(f'Authored alaska: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-flood-spaces, author-stability, author-local-damage, author-damage-control.')

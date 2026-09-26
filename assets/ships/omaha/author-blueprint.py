"""Original USS Omaha (CL-4) blueprint authoring, GameModels3D fit A (1923 hull), GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and rebuilds it:

  python3 assets/ships/omaha/author-blueprint.py [--structures a.json,b.json]

Hull: `authoring/lines.json` is `bun run ship:lines omaha --ref pasc005 --format sections` over the cached
pasc005 view (fit A, hull `asc005_omaha_1923`); the fixes below are measured on the same reference and
recorded here as tables: the weather deck at the side (the tool's deck reads the forward and after
superstructures, whose sides run flush with the hull, and the torpedo pockets' floors), the centreline keel (the
tool stops on the flat midships bottom 0.3 m above it), and stations that caught a bilge keel, a shaft bossing or
a casemate sponson, which are replaced by their neighbours. Superstructure blocks are traced from plan cuts of
the reference every 0.1 m (`ship:slice --plan`, measurement files in ignored .build/omaha/); they are kept from
the current blueprint unless `--structures` is passed. Mount datums are the reference hardpoints, armour zones
and thicknesses its armour model (`asc005_omaha_1923` armour); other gameplay values are provisional game
calibration. Run afterwards, always passing `omaha`: author-local-damage (new ship only), author-flood-spaces,
author-stability and author-damage-control.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZSHIFT = 0.7523      # runtime z = reference z + ZSHIFT (ship:lines centres the hull on its length)
SPEED_KN = 35
BREAK = 41.60        # reference z of the step from the upper deck down to the quarterdeck


def rz(z):
    """Reference z -> runtime z."""
    return round(z + ZSHIFT, 4)


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


args = argparse.ArgumentParser()
args.add_argument('--structures')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
lines = json.loads((HERE / 'authoring/lines.json').read_text())
L = lines['length']
LOW = [0, 0.004, 0.012, 0.025, 0.045, 0.07, 0.1, 0.14, 0.19, 0.25, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.87, 0.94, 1]
HIGH = [0.25, 0.5, 0.75, 1]
H0, END_MARGIN, END_FRACTION = 1.5, 1.0, 0.75

# Weather deck at the side, reference z -> height, measured with vertical probes of the reference deck and its
# armour model's deck plates: the forecastle sheer runs on under the forward superstructure to the upper deck,
# which falls to 6.0 m at the after superstructure; the quarterdeck lies abaft BREAK.
DECK_FWD = [(-85.7, 10.00), (-83.5, 9.93), (-81.0, 9.82), (-79.0, 9.74), (-77.0, 9.64), (-75.0, 9.54), (-73.0, 9.45), (-70.0, 9.32),
            (-68.0, 9.23), (-66.0, 9.13), (-64.0, 9.04), (-60.0, 8.86), (-58.0, 8.78), (-56.0, 8.70), (-54.5, 8.64), (-53.1, 8.58),
            (-46.0, 8.21), (-43.4, 8.06), (-36.2, 7.66), (-35.0, 7.648), (-33.4, 7.64), (-31.4, 7.59), (-29.4, 7.53), (-27.4, 7.40),
            (-25.4, 7.33), (-23.4, 7.27), (-21.4, 7.21), (-19.4, 7.12), (-17.4, 7.06), (-15.4, 7.00), (-13.4, 6.95), (-11.4, 6.89),
            (-9.4, 6.84), (-7.4, 6.79), (-5.4, 6.72), (-3.4, 6.67), (-1.4, 6.62), (0.6, 6.57), (2.6, 6.54), (4.6, 6.48), (6.6, 6.44),
            (8.6, 6.42), (10.6, 6.38), (12.6, 6.35), (14.6, 6.32), (16.6, 6.28), (18.6, 6.25), (20.6, 6.20), (24.0, 6.17), (28.0, 6.13),
            (30.6, 6.10), (32.6, 6.10), (34.6, 6.08), (36.6, 6.05), (38.6, 6.03), (40.6, 6.00), (BREAK - .05, 5.99)]
DECK_AFT = [(BREAK + .05, 3.53), (44.0, 3.542), (46.0, 3.559), (48.0, 3.567), (50.0, 3.58), (52.0, 3.593), (54.0, 3.607), (56.0, 3.62),
            (60.0, 3.643), (62.6, 3.65), (64.6, 3.67), (66.6, 3.68), (68.6, 3.69), (70.6, 3.72), (72.6, 3.73), (74.6, 3.75), (76.6, 3.78),
            (78.6, 3.80), (80.6, 3.82), (84.2, 3.82)]


def deck_ref(zr):
    return interp(DECK_FWD, zr) if zr < BREAK else interp(DECK_AFT, zr)


# Centreline keel: the reference's flat keel stands at -3.953 m from the forefoot to abaft the after magazine;
# the lines' walk stops 0.3 m above it on the flat midships bottom (bottom only 0.35 m deep over 7 m).
KEEL_FLAT = (-76.5, 50.0, -3.953)
# Torpedo pockets (their floors are not the deck) and the after casemate sponsons: bridged from neighbours.
BRIDGE_Z = [(20.8, 32.4)]


def level_heights(keel, deck):
    h0 = H0 if keel < H0 - END_MARGIN else keel + (deck - keel) * END_FRACTION
    return [keel + (h0 - keel) * u for u in LOW] + [h0 + (deck - h0) * u for u in HIGH]


def width_at(profile, y):
    """Half-breadth at height y along a measured (height, half-breadth) outline, flat past its ends."""
    if y <= profile[0][0]:
        return profile[0][1]
    if y >= profile[-1][0]:
        return profile[-1][1]
    return interp(profile, y)


# Stem: the lowest hull point at each station of the raked stem and forefoot (reference cuts; the lines' running
# median lags it by up to 1.7 m). The loft's end stations stand at the stem head and just abaft the stern.
STEM = [(-85.62, 9.95), (-85.40, 9.60), (-85.20, 8.70), (-85.00, 7.66), (-84.80, 6.26), (-84.50, 4.20), (-84.00, 1.03),
        (-83.50, -1.72), (-83.00, -3.40), (-82.40, -3.40)]
BOW_END, STERN_END = -85.62, 83.85

measured = []
for s in lines['sections']:
    zr = L / 2 - s['station'] - ZSHIFT
    profile = sorted(((p[1], p[0]) for p in s['points']), key=lambda q: q[0])
    keel = profile[0][0]
    if KEEL_FLAT[0] < zr < KEEL_FLAT[1] and keel > KEEL_FLAT[2] + .05:
        profile = [(KEEL_FLAT[2], 0.0)] + [q for q in profile[1:]]
        keel = KEEL_FLAT[2]
    if zr < STEM[-1][0]:
        keel = interp(STEM, zr)
        profile = [(keel, 0.0)] + [q for q in profile[1:] if q[0] > keel + .02]
    measured.append(dict(zr=zr, keel=keel, profile=profile))
# End stations: a sliver at the stem head and one closing the cruiser stern under its deck edge.
tip = lambda zr, keel, deck: dict(zr=zr, keel=keel, profile=[(keel, 0.0), (deck, .04)])
measured.append(tip(BOW_END, interp(STEM, BOW_END), deck_ref(BOW_END)))
measured.append(tip(STERN_END, .8, 3.82))
measured.sort(key=lambda e: e['zr'])


def resample(entry, deck):
    heights = level_heights(entry['keel'], deck)
    return [[0.0 if k == 0 else max(0.0, width_at(entry['profile'], y)), y] for k, y in enumerate(heights)]


rows = []
for e in measured:
    deck = deck_ref(e['zr'])
    rows.append(dict(zr=e['zr'], keel=e['keel'], deck=deck, points=resample(e, deck), entry=e))
# Stations 0.1 m either side of the break, from the nearest measured outline.
for zr in (BREAK - .05, BREAK + .05):
    near = min(measured, key=lambda e: abs(e['zr'] - zr))
    rows.append(dict(zr=zr, keel=near['keel'], deck=deck_ref(zr), points=resample(near, deck_ref(zr)), entry=near))
rows = [r for r in rows if not (BREAK - .9 < r['zr'] < BREAK + .9 and abs(abs(r['zr'] - BREAK) - .05) > 1e-6)]
rows.sort(key=lambda r: r['zr'])


# Outliers: a station whose outline below the waterline stands off its neighbours by more than 0.35 m has caught
# a bilge keel, bossing or bracket; it and the torpedo pockets are rebuilt from the nearest good stations.
def bad(i):
    r = rows[i]
    if any(a <= r['zr'] <= b for a, b in BRIDGE_Z):
        return True
    if i < 2 or i > len(rows) - 3 or abs(r['zr'] - BREAK) < 1:
        return False

    def deviates(a, c):
        t = (r['zr'] - a['zr']) / (c['zr'] - a['zr'])
        pa = sorted(((p[1], p[0]) for p in a['points'][1:]), key=lambda q: q[0])
        pc = sorted(((p[1], p[0]) for p in c['points'][1:]), key=lambda q: q[0])
        for w, y in r['points'][1:]:
            if y > 0:
                break
            if abs(w - (width_at(pa, y) * (1 - t) + width_at(pc, y) * t)) > .35:
                return True
        return False
    # A station is an outlier only when it stands off both its near and its next neighbours.
    return deviates(rows[i - 1], rows[i + 1]) and deviates(rows[i - 2], rows[i + 2])


flags = [bad(i) for i in range(len(rows))]
replaced = []
for i, r in enumerate(rows):
    if not flags[i]:
        continue
    a = next(rows[j] for j in range(i - 1, -1, -1) if not flags[j])
    c = next(rows[j] for j in range(i + 1, len(rows)) if not flags[j])
    t = (r['zr'] - a['zr']) / (c['zr'] - a['zr'])
    keel = a['keel'] * (1 - t) + c['keel'] * t
    blend = dict(zr=r['zr'], keel=keel, profile=sorted(
        ((y, width_at(a['entry']['profile'], y) * (1 - t) + width_at(c['entry']['profile'], y) * t)
         for y in sorted({q[0] for q in a['entry']['profile']} | {q[0] for q in c['entry']['profile']}) if y >= keel), key=lambda q: q[0]))
    blend['profile'] = [(keel, 0.0)] + [q for q in blend['profile'] if q[0] > keel + 1e-6]
    r['points'] = resample(blend, r['deck'])
    replaced.append(round(r['zr'], 2))

sections = []
for r in rows:
    station = round(L / 2 - (r['zr'] + ZSHIFT), 4)
    sections.append({'station': station, 'points': [[round(w, 4), round(y, 4)] for w, y in r['points']]})
sections.sort(key=lambda s: s['station'])
sections[0]['station'] = 0
sections[-1]['station'] = round(L, 4)


def area_below(points, level):
    total = 0
    for (w0, y0), (w1, y1) in zip(points, points[1:]):
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
    best = 0
    for (w0, y0), (w1, y1) in zip(points, points[1:]):
        if min(y0, y1) <= level <= max(y0, y1) and abs(y1 - y0) > 1e-9:
            best = max(best, w0 + (w1 - w0) * (level - y0) / (y1 - y0))
    return best


def integrate(fn):
    return sum((fn(a) + fn(b)) / 2 * (b['station'] - a['station']) for a, b in zip(sections, sections[1:]))


volume = integrate(lambda s: area_below(s['points'], 0))
above = integrate(lambda s: area_below(s['points'], 50)) - volume
waterplane = integrate(lambda s: 2 * breadth_at(s['points'], 0))
beam = 2 * max(p[0] for s in sections for p in s['points'])
DRAFT = round(-min(p[1] for s in sections for p in s['points']), 3)
DEPTH = round(DRAFT + deck_ref(0), 3)
hull = dict(kind='authored-stations-v1', length=round(L, 4), beam=round(beam, 4), draft=DRAFT, depth=DEPTH,
            massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round(above * .55, 1),
            halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
            deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
            keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
            sections=sections)


def deck_y(z):
    """Weather-deck height at runtime z (bow negative)."""
    return deck_ref(z - ZSHIFT)


def half_breadth(z, y):
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='omaha', name='Omaha',
         configuration='Omaha (CL-4) · 1923 exterior after the GameModels3D pasc005 fit A (hull asc005_omaha_1923) · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/omaha.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=4.5, acceleration=.2, braking=.2, rudderRate=.45, maxYawRate=.026),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 17.6, rz(-43.0)]),
         structuralPlating=dict(hullMm=13, superstructureMm=10, note='Hull and superstructure plating read from the approved GameModels3D armour model (13 mm bow and stern plating, 10 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure blocks measured from the approved GameModels3D pasc005 fit A (hull asc005_omaha_1923) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Ten 6-inch/53: two twin Mk 16 turrets and eight Mk 13 singles (two open drums, six casemates); eight 1.1-inch/75 quadruple mounts, four .50-calibre Browning M2 and twelve 21-inch tubes in four trainable triple mounts, at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference hardpoint datums)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
b['mounts'].append(dict(id='main-1', name='Turret 1 6-inch twin', partId='us-6in53-mk16-twin', battery='main', position=[0, 9.026, rz(-61.176)],
                        bearingDeg=0, rangefinder=False, magazineId='magazine-forward', fire=FIRE_MAIN))
b['mounts'].append(dict(id='main-2', name='Turret 2 6-inch twin', partId='us-6in53-mk16-twin', battery='main', position=[0, 3.759, rz(67.181)],
                        bearingDeg=180, rangefinder=False, magazineId='magazine-after', fire=FIRE_MAIN))
# Eight single 6-inch/53: bearing is the centre of each gun's arc (the rest rule trains it fore or aft), with
# limits that keep the gun off the casemate walls. The reference stows the forward guns at 0-4 degrees and the after
# guns at 165-180.
CASEMATES = [('casemate-1', 'Port forward lower casemate', 'us-6in53-mk13-casemate', -5.502, 10.035, -49.467, -1, 'forward'),
             ('casemate-2', 'Starboard forward lower casemate', 'us-6in53-mk13-casemate', 5.502, 10.035, -49.467, 1, 'forward'),
             ('casemate-3', 'Port forward upper gun', 'us-6in53-mk13-single', -4.242, 12.476, -49.462, -1, 'forward'),
             ('casemate-4', 'Starboard forward upper gun', 'us-6in53-mk13-single', 4.242, 12.476, -49.462, 1, 'forward'),
             ('casemate-5', 'Port after lower casemate', 'us-6in53-mk13-casemate', -6.931, 4.269, 45.923, -1, 'after'),
             ('casemate-6', 'Starboard after lower casemate', 'us-6in53-mk13-casemate', 6.931, 4.269, 45.923, 1, 'after'),
             ('casemate-7', 'Port after upper casemate', 'us-6in53-mk13-casemate', -5.571, 7.347, 45.923, -1, 'after'),
             ('casemate-8', 'Starboard after upper casemate', 'us-6in53-mk13-casemate', 5.571, 7.347, 45.923, 1, 'after')]
ARCS = {'forward': (65, 65), 'after': (115, 65)}
for id, name, part, x, y, z, side, end in CASEMATES:
    centre, half = ARCS[end]
    b['mounts'].append(dict(id=id, name=name + ' 6-inch', partId=part, battery='secondary', position=[x, y, rz(z)], bearingDeg=side * centre,
                            traverseLimitsDeg=[-half, half], rangefinder=False,
                            magazineId='magazine-forward' if end == 'forward' else 'magazine-after', fire=FIRE_MAIN))
# Eight 1.1-inch/75 quadruple mounts and four .50-calibre Browning M2 (reference HP_AGA datums).
QUADS = [(-7.071, 6.729, -6.913, -90), (7.071, 6.729, -6.913, 90), (-6.493, 6.554, 0.402, -90), (6.493, 6.554, 0.402, 90),
         (-7.091, 6.390, 8.657, -90), (7.091, 6.390, 8.657, 90), (-3.129, 9.256, 44.151, -135), (3.399, 9.256, 45.123, 135)]
for i, (x, y, z, bearing) in enumerate(QUADS, 1):
    b['mounts'].append(dict(id=f'aa-quad-{i}', name=f'1.1-inch quad {i}', partId='us-11in75-quad', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 20 else 'aa-ammunition-after', fire=FIRE_LIGHT))
BROWNINGS = [(-6.017, 10.359, -38.357, -90), (6.017, 10.359, -38.357, 90), (-2.920, 3.605, 55.182, -135), (2.921, 3.605, 55.182, 135)]
for i, (x, y, z, bearing) in enumerate(BROWNINGS, 1):
    b['mounts'].append(dict(id=f'mg-{i}', name=f'.50-calibre Browning {i}', partId='us-50cal-browning-m2', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT))

# ---------------------------------------------------------------- torpedo mounts
# Four trainable triple 21-inch mounts: the forward pair on the main deck in pockets in the hull side under the upper
# deck, the after pair on the upper deck. Pivots and muzzle datums from the reference (HP_AGT and its gunFire
# points, 0.732 m apart and 3.23 m forward of the pivot along the tubes). Tubes are authored at zero train; the
# reference also stows every mount trained forward.
TORPEDO = [('torpedo-1', -7.248, 3.503, 24.341, 0.825, -1), ('torpedo-2', 7.248, 3.503, 24.341, 0.825, 1),
           ('torpedo-3', -6.573, 6.012, 36.210, 0.825, -1), ('torpedo-4', 6.573, 6.012, 36.210, 0.825, 1)]
b['torpedoLaunchers'] = []
b['torpedoTubes'] = []
for id, x, y, z, rise, side in TORPEDO:
    # The pocket mounts can train only until the tubes' after ends meet the pocket's back wall (about 35 degrees);
    # the upper-deck pair train across the beam.
    arc = ([[15, 35]] if side > 0 else [[-35, -15]]) if y < 5 else ([[40, 140]] if side > 0 else [[-140, -40]])
    b['torpedoLaunchers'].append(dict(id=id, name=f'Triple 21-inch mount {id[-1]}', position=[x, y, rz(z)], traverseRateDeg=8, launchArcsDeg=arc))
    for k, dx in enumerate([-.732, 0, .732], 1):
        b['torpedoTubes'].append(dict(id=f'{id}-tube-{k}', name=f'Mount {id[-1]} tube {k}', partId='us-mk15-fast',
                                      position=[round(x + dx, 3), round(y + rise, 3), rz(z - 3.227)], bearingDeg=0, arcDeg=2, ammo=1,
                                      magazineId='torpedo-magazine', launcherId=id, launcherModuleId=f'{id}-equipment'))
    b['modules'].append(dict(id=f'{id}-equipment', name=f'Torpedo mount {id[-1]}', kind='launcher', placement='fixed', torpedoLauncherId=id,
                             center=[x, round(y + .8, 3), rz(z - 1.0)], size=[2.4, 1.6, 7.8], hp=80, protectionMm=6))

# ---------------------------------------------------------------- superstructure
FUNNELS = [('funnel-1', 'No. 1 funnel', -23.00, 20.81), ('funnel-2', 'No. 2 funnel', -13.78, 20.81),
           ('funnel-3', 'No. 3 funnel', 4.97, 20.31), ('funnel-4', 'No. 4 funnel', 14.47, 20.11)]


def ellipse(cx, cz, hx, hz, n=24, fore=None):
    """Plan ellipse (runtime x, z) centred on (cx, cz); `fore` stretches the forward half (bow is -z)."""
    pts = []
    for k in range(n):
        a = math.tau * k / n
        dz = math.sin(a) * hz
        if fore is not None and dz < 0:
            dz *= fore / hz
        pts.append([round(cx + hx * math.cos(a), 3), round(cz + dz, 3)])
    return pts


def ccw(ring):
    signed = sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(ring, ring[1:] + ring[:1]))
    return ring if signed > 0 else list(reversed(ring))


if opts.structures:
    traced = [s for path in opts.structures.split(',') for s in json.loads(Path(path).read_text())['structures']]
    structures = []
    for s in traced:
        structures.append(dict(id=s['id'], name=s.get('name') or f"Deckhouse {s['baseY']:.1f}-{s['baseY'] + s['height']:.1f} m",
                               footprint=ccw(s['footprint']), baseY=s['baseY'], height=s['height'], material='naval'))
    # A tier that begins a level or two over the roof below it (a level lost between tracks) reaches down to that roof.
    def inside(p, ring):
        x, z = p
        hit = False
        for (x0, z0), (x1, z1) in zip(ring, ring[1:] + ring[:1]):
            if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
                hit = not hit
        return hit
    for s in structures:
        cx = sum(p[0] for p in s['footprint']) / len(s['footprint'])
        cz = sum(p[1] for p in s['footprint']) / len(s['footprint'])
        below = [o['baseY'] + o['height'] for o in structures if o is not s and inside((cx, cz), o['footprint'])
                 and 0 < s['baseY'] - (o['baseY'] + o['height']) <= .31]
        if below:
            top = max(below)
            s['height'] = round(s['height'] + s['baseY'] - top, 3)
            s['baseY'] = round(top, 3)
    structures = [s for s in structures if not s['id'].startswith('mid-')]
else:
    structures = [s for s in previous['structures'] if not s['id'].startswith(('funnel', 'after-house-low', 'midships', 'fwd-shelter'))] if previous else []

# The forward superstructure's lowest tier reaches down to the forecastle deck under it.
for s in structures:
    if s['id'] == 'fwd-00':
        low = min(deck_y(p[1]) for p in s['footprint'])
        s['height'] = round(s['baseY'] + s['height'] - (low - .05), 3)
        s['baseY'] = round(low - .05, 3)
# After superstructure, lowest tier: quarterdeck to the upper-deck level, open to the side over the lower after
# casemates (measured plan cut at 5.2 m, reference frame x, z; mirrored).
HALF = [(41.0, round(half_breadth(rz(41.0), 5.0) - .03, 3)), (42.17, 7.57), (44.17, 7.23), (43.40, 5.57), (47.70, 4.23), (48.27, 5.93), (50.33, 5.17)]
ring = [[x, rz(z)] for z, x in HALF] + [[-x, rz(z)] for z, x in reversed(HALF)]
structures.append(dict(id='after-house-low', name='After superstructure 3.5-6.1 m', footprint=ccw(ring), baseY=3.50, height=2.62, material='naval'))
# Midships deckhouses between the funnels (traced outlines, simplified): engine-room house abaft No. 2 funnel and the
# boiler-room vent casings either side of the centreline between Nos. 1 and 2 and between Nos. 3 and 4.
for id, name, x0, x1, z0, z1, top in [('midships-house', 'Midships deckhouse', -3.16, 3.16, -11.70, -5.66, 10.00),
                                      ('midships-casing-1p', 'Boiler-room casing', -3.42, -0.94, -21.61, -17.09, 8.60),
                                      ('midships-casing-1s', 'Boiler-room casing', 0.94, 3.42, -21.61, -17.09, 8.60),
                                      ('midships-casing-2p', 'Boiler-room casing', -3.50, -0.94, 6.67, 11.27, 8.60),
                                      ('midships-casing-2s', 'Boiler-room casing', 0.94, 3.50, 6.67, 11.27, 8.60)]:
    zc = (z0 + z1) / 2
    base = round(deck_ref(zc) - .05, 3)
    structures.append(dict(id=id, name=name, footprint=[[x0, rz(z0)], [x1, rz(z0)], [x1, rz(z1)], [x0, rz(z1)]], baseY=base,
                           height=round(top - base, 3), material='naval'))
# Forward shelter on the 12.5 m deck between the upper 6-inch guns (reference roof 14.73-14.78 m, x +-3.4 to +-3.6,
# z -53.1 to -51.3): the plan tracks lost it because its walls run on into the guns' screens. Its after face stands
# 0.8 m forward of the reference's so the upper guns' breeches, trained right aft with full recoil, pass clear.
structures.append(dict(id='fwd-shelter', name='Forward shelter', footprint=ccw([[-3.4, rz(-53.1)], [3.4, rz(-53.1)], [3.45, rz(-52.1)], [-3.45, rz(-52.1)]]),
                       baseY=12.5, height=2.28, material='naval'))
for id, name, zc, rim in FUNNELS:
    base = round(deck_ref(zc) - .05, 3)
    structures.append(dict(id=id + '-boot', name=name + ' boot', footprint=ellipse(0, rz(zc - .335), 1.83, 2.135, 24), baseY=base,
                           height=round(7.95 - base, 3), material='naval'))
    structures.append(dict(id=id, name=name, footprint=ellipse(0, rz(zc), 1.57, 1.62, 28), baseY=7.9, height=round(rim - 7.9, 3), material='naval',
                           exhaust=dict(position=[0, rim, rz(zc)], width=3.14, length=3.24)))
structures = [s for s in structures if s['id'] != 'fwd-08']  # a stray level of the tripod's foot, carried by nothing


# The 6-inch training drums turn inside round recesses in the casemate walls: each block that stands beside a
# drum gives up the drum's working circle (3.67 m drum, 6 cm clearance), as the reference's walls do.
def notch(poly, c, r, steps=28):
    """Footprint minus a circle that crosses its boundary: the arc inside the footprint replaces the cut edge."""
    inside = lambda p: (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < r * r
    n = len(poly)
    start = next((i for i in range(n) if not inside(poly[i])), None)
    if start is None:
        return None
    seq = poly[start:] + poly[:start]
    out, entry = [], None
    for i in range(n):
        a, e = seq[i], seq[(i + 1) % n]
        if entry is None:
            out.append(a)
        dx, dz = e[0] - a[0], e[1] - a[1]
        fx, fz = a[0] - c[0], a[1] - c[1]
        qa, qb, qc = dx * dx + dz * dz, 2 * (fx * dx + fz * dz), fx * fx + fz * fz - r * r
        disc = qb * qb - 4 * qa * qc
        ts = []
        if qa > 1e-12 and disc > 0:
            root = math.sqrt(disc)
            ts = sorted(t for t in ((-qb - root) / (2 * qa), (-qb + root) / (2 * qa)) if 0 < t < 1)
        for t in ts:
            p = [a[0] + dx * t, a[1] + dz * t]
            if entry is None:
                entry = p
                out.append(p)
            else:
                a0 = math.atan2(entry[1] - c[1], entry[0] - c[0])
                a1 = math.atan2(p[1] - c[1], p[0] - c[0])
                sweep = (a0 - a1) % math.tau
                k = max(2, int(steps * sweep / math.tau))
                out += [[c[0] + r * math.cos(a0 - sweep * j / k), c[1] + r * math.sin(a0 - sweep * j / k)] for j in range(1, k)]
                out.append(p)
                entry = None
    return [[round(x, 3), round(z, 3)] for x, z in out]


DRUMS = [(x, y0, y1, z) for x, y0, y1, z in [(-5.502, 10.035, 11.745, -49.467), (5.502, 10.035, 11.745, -49.467),
                                               (-4.242, 13.197, 14.907, -49.462), (4.242, 13.197, 14.907, -49.462),
                                               (-6.931, 4.269, 5.979, 45.923), (6.931, 4.269, 5.979, 45.923),
                                               (-5.571, 7.347, 9.057, 45.923), (5.571, 7.347, 9.057, 45.923)]]
lifted = []
for s in structures:
    for x, y0, y1, z in DRUMS:
        top = s['baseY'] + s['height']
        overlap = min(top, y1) - max(s['baseY'], y0)
        if overlap <= 0:
            continue
        cut = notch(s['footprint'], (x, rz(z)), 1.93)
        if not cut:
            continue
        if y0 - .001 < top <= y0 + .06 and s['baseY'] < y0 - .2:
            # The drum stands on this block: its roof comes down to the drum's sole.
            s['height'] = round(y0 - s['baseY'], 3)
        elif y1 - .06 <= s['baseY'] < y1 + .001 and top > y1 + .12:
            # The block roofs the drum: its floor lifts clear of the drum's top.
            lifted.append((s, s['baseY'], round(y1 + .05, 3)))
            s['height'] = round(top - (y1 + .05), 3)
            s['baseY'] = round(y1 + .05, 3)
        elif overlap > .02 and len(cut) >= 3:
            s['footprint'] = ccw(cut)
# The tiers that carried a lifted floor rise with it (their drum recesses keep the drum clear), so no daylight shows
# between them.
def box2(s):
    xs, zs = [p[0] for p in s['footprint']], [p[1] for p in s['footprint']]
    return min(xs), max(xs), min(zs), max(zs)


for roof, old, new in lifted:
    rx0, rx1, rz0, rz1 = box2(roof)
    for s in structures:
        x0, x1, z0, z1 = box2(s)
        if abs(s['baseY'] + s['height'] - old) < .01 and x0 < rx1 and rx0 < x1 and z0 < rz1 and rz0 < z1:
            s['height'] = round(new - s['baseY'], 3)
b['structures'] = structures

# Firing obstructions: boxes kept inside the visual walls for substantial blocks, cut into fore-and-aft strips of at
# most 3 m so a stepped deckhouse is not boxed at its widest.
for s in structures:
    poly = s['footprint']
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    if s['height'] < 1.0 or (max(xs) - min(xs)) * (max(zs) - min(zs)) < 4:
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
# Boats on their chocks and the catapults: barrels stop at them and cannot fire through them.
for name, (x0, x1), (y0, y1), (z0, z1) in [('launch', (4.25, 7.62), (8.0, 11.0), (-34.2, -22.0)), ('motor-boat', (5.62, 7.99), (7.4, 10.4), (-20.1, -9.5)),
                                           ('catapult', (4.9, 8.3), (7.0, 8.6), (11.0, 27.6))]:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: barrels (with the full recoil stroke) and gunhouses may not enter the blocks they can reach,
# and neighbouring mounts may not cross. Game clearance, not verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
BODIES = {'us-6in53-mk13-single': dict(center=[0, 1.58, 0], size=[3.7, 1.72, 3.7]),
          'us-6in53-mk13-casemate': dict(center=[0, .86, 0], size=[3.7, 1.72, 3.7]),
          'us-11in75-quad': dict(center=[0, .95, .25], size=[2.2, 1.9, 2.2]),
          'us-50cal-browning-m2': dict(center=[0, .95, 0], size=[.6, 1.9, .9])}
clear_mounts, reach = [], {}
for m in b['mounts']:
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(max(w['barrelBaseRadius'] * .85, .05), 3))
    if m['partId'] == 'us-6in53-mk16-twin':
        # Mk 16 gunhouse in the yaw frame: 6.15 m long from 1.61 m ahead of the pivot, 3.09 m wide, 2.85 m tall.
        entry['body'] = dict(center=[0, 1.49, 1.47], size=[3.2, 2.8, 6.2])
    else:
        entry['body'] = BODIES[m['partId']]
    clear_mounts.append(entry)
    reach[m['id']] = (m['position'], w['muzzleForward'] + 1.0, m['position'][1] + w['pivotHeight'])
pairs = []
ids = [m['id'] for m in b['mounts']]
for i, a in enumerate(ids):
    for c in ids[i + 1:]:
        (pa, ra, _), (pc, rc, _) = reach[a], reach[c]
        if math.hypot(pa[0] - pc[0], pa[2] - pc[2]) < ra + rc - 1.0 and abs(pa[1] - pc[1]) < 3.2:
            pairs.append((math.hypot(pa[0] - pc[0], pa[2] - pc[2]), [a, c]))
neighbors = [p for _, p in sorted(pairs)[:128]]
nearby = []
for st in structures:
    xs = [p[0] for p in st['footprint']]
    zs = [p[1] for p in st['footprint']]
    best = None
    for (x, y, z), r, pivot in reach.values():
        dx = max(min(xs) - x, 0, x - max(xs))
        dz = max(min(zs) - z, 0, z - max(zs))
        if math.hypot(dx, dz) <= r and st['baseY'] < pivot + r * .8 and st['baseY'] + st['height'] > pivot - 3:
            best = min(best if best is not None else 1e9, math.hypot(dx, dz))
    if best is not None:
        nearby.append((best, st['id']))
nearby = [sid for _, sid in sorted(nearby)[:128]]
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for every mount (6-inch twins and singles, 1.1-inch and .50-calibre) against the measured superstructure blocks they can reach, including the full recoil stroke, and between neighbouring mounts whose working circles overlap. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby], neighbors=neighbors)


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
# Magazines inside the 25 mm boxes the reference's armour model draws (forward z -66.9 to -52.0, after 42.1 to 58.9).
room('magazine-forward', 'Forward 6-inch magazines', [0, -1.25, rz(-59.5)], [9.0, 3.6, 14.2], 'magazine', hp=200, fire=MAG)
room('magazine-after', 'After 6-inch magazines', [0, -1.7, rz(50.5)], [4.2, 2.3, 16.2], 'magazine', hp=160, fire=MAG)
room('torpedo-magazine', 'Torpedo warhead locker', [0, 4.7, rz(24.5)], [6.0, 2.2, 7.0], 'magazine', hp=90, fire=MAG)
room('aa-ammunition-forward', 'Forward light AA ready ammunition', [0, 8.9, rz(-40.0)], [4.0, 2.0, 5.0], 'magazine', hp=70, fire=MAG)
room('aa-ammunition-after', 'After light AA ready ammunition', [0, 4.9, rz(48.0)], [3.0, 2.0, 5.0], 'magazine', hp=70, fire=MAG)
# Machinery inside the 76 mm citadel (reference z -26.6 to 31.2): four boiler rooms under the funnels, then the
# turbine rooms; four shafts.
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -21.0), ('boiler-room-2', 'No. 2 boiler room', -10.0), ('boiler-room-3', 'No. 3 boiler room', 1.0),
           ('boiler-room-4', 'No. 4 boiler room', 11.5)]
for id, name, z in BOILERS:
    room(id, name, [0, .3, rz(z)], [15.5, 6.8, 10.2], 'engine', 'boiler', 200, ENG)
TURBINES = [('engine-room-port', 'Port engine room', -3.9), ('engine-room-starboard', 'Starboard engine room', 3.9)]
for id, name, x in TURBINES:
    room(id, name, [x, .3, rz(24.5)], [7.6, 6.8, 13.0], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -1.6, rz(38.5)], [9.0, 3.6, 13.0], fire=ENG)
SHAFTS = [('shaft-1', -6.6), ('shaft-2', -3.4), ('shaft-3', 3.4), ('shaft-4', 6.6)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[round(x * .6, 3), -2.4, rz(38.5)],
                             size=[.7, 1.1, 10], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, .45, rz(76.0)], [5.6, 2.4, 9.8], 'steering', hp=150, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port'], shaftIds=['shaft-1']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-port'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-starboard'], shaftIds=['shaft-3']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard'], shaftIds=['shaft-4'])],
    basis='Provisional four-shaft machinery: four boiler rooms under the funnels and two turbine rooms abaft them, one group per shaft with equal shares. Room bounds and routing are game estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main' or m['id'].startswith('casemate')]
AA_PORT = [m['id'] for m in b['mounts'] if m['id'].startswith(('aa-', 'mg-')) and m['position'][0] < 0]
AA_STBD = [m['id'] for m in b['mounts'] if m['id'].startswith(('aa-', 'mg-')) and m['position'][0] >= 0]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_AD): Mk 7 directors on the foremast top and on the after tower; 3.6 m rangefinders
# on the conning tower and the after tower.
director('main-director', 'Forward Mk 7 director', [0, 27.869, -42.476], MAIN_IDS, [1.3, 1.6, 1.3], 40, 6)
director('after-director', 'After Mk 7 director', [0, 10.320, 45.524], MAIN_IDS, [1.3, 1.6, 1.3], 40, 6)
director('rangefinder-forward', 'Forward 3.6 m rangefinder', [0, 18.053, -44.692], MAIN_IDS + AA_PORT + AA_STBD, [4.0, 1.8, 1.4], 30, 6)
director('rangefinder-after', 'After 3.6 m rangefinder', [0, 12.270, 40.184], MAIN_IDS + AA_PORT + AA_STBD, [4.0, 1.8, 1.4], 30, 6)


# ---------------------------------------------------------------- protection (GameModels3D armour model)
def plate(id, name, vs, mm, exterior=False, note='Thickness and zone from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pasc005-armour', basis='inferred', note=note)))


def quad(prefix, name, a, b_, c, d, mm, exterior=False):
    """Two planar triangles over a possibly twisted quad (reference x, y, z), mirrored to port."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        m = lambda v: [sign * v[0], v[1], rz(v[2])]
        plate(f'{prefix}-{side}-a', f'{side.title()} {name}', [m(a), m(b_), m(c)], mm, exterior)
        plate(f'{prefix}-{side}-b', f'{side.title()} {name}', [m(a), m(c), m(d)], mm, exterior)


def band(prefix, name, z0, z1, seg, y0, y1, mm, inset=.998):
    """Plates on the loft's side between two heights (callables of reference z allowed), in `seg` strips."""
    for j in range(seg):
        za = z0 + (z1 - z0) * j / seg
        zb = z0 + (z1 - z0) * (j + 1) / seg
        ya0, ya1 = y0(za) if callable(y0) else y0, y1(za) if callable(y1) else y1
        yb0, yb1 = y0(zb) if callable(y0) else y0, y1(zb) if callable(y1) else y1
        quad(f'{prefix}-{j}', name, (half_breadth(rz(za), ya0) * inset, ya0, za), (half_breadth(rz(zb), yb0) * inset, yb0, zb),
             (half_breadth(rz(zb), yb1) * inset, yb1, zb), (half_breadth(rz(za), ya1) * inset, ya1, za), mm, True)


# Citadel belt, 76 mm (3 in), on the hull side from 2.5 m below the waterline to the main deck over the machinery
# (reference z -26.6 to 31.2; the belt top falls from 4.58 m forward to 3.67 m aft).
belt_top = lambda z: interp([(-26.6, 4.58), (-22.8, 4.49), (-4.8, 4.05), (3.3, 3.90), (20.7, 3.90), (31.2, 3.67)], z)
band('belt', 'citadel belt', -26.56, 31.24, 12, -2.50, belt_top, 76)
# Citadel deck, 37 mm (1.5 in), at the belt top, in strips across the loft.
for j in range(12):
    za = -26.56 + (31.24 + 26.56) * j / 12
    zb = -26.56 + (31.24 + 26.56) * (j + 1) / 12
    ya, yb = belt_top(za), belt_top(zb)
    wa, wb = half_breadth(rz(za), ya) * .985, half_breadth(rz(zb), yb) * .985
    plate(f'citadel-deck-{j}', 'Citadel deck', [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], 37)
# Citadel ends: 37 mm forward transverse bulkhead, 76 mm after.
for id, name, z, mm in [('citadel-forward', 'Forward citadel bulkhead', -26.56, 37), ('citadel-after', 'After citadel bulkhead', 31.24, 76)]:
    top = belt_top(z)
    wt, wb = half_breadth(rz(z), top) * .98, half_breadth(rz(z), -2.5) * .98
    plate(id, name, [[-wb, -2.5, rz(z)], [wb, -2.5, rz(z)], [wt, top, rz(z)], [-wt, top, rz(z)]], mm)
# Magazine boxes, 25 mm (arti): forward z -66.9 to -52.0 (6.0 m half-breadth aft, 3.6 m forward, to 0.75 m), after
# z 42.1 to 58.9 (2.16 m, -2.94 to -0.49 m).
for id, name, (z0, z1), (w0, w1), (y0, y1) in [('magazine-forward', 'Forward magazine box', (-66.91, -52.03), (3.57, 5.90), (-3.18, .75)),
                                                ('magazine-after', 'After magazine box', (42.09, 58.86), (2.16, 2.16), (-2.94, -.49))]:
    for side, sign in [('port', -1), ('starboard', 1)]:
        plate(f'{id}-{side}-a', name + ' side', [[sign * w0, y0, rz(z0)], [sign * w1, y0, rz(z1)], [sign * w1, y1, rz(z1)]], 25)
        plate(f'{id}-{side}-b', name + ' side', [[sign * w0, y0, rz(z0)], [sign * w1, y1, rz(z1)], [sign * w0, y1, rz(z0)]], 25)
    plate(f'{id}-top', name + ' crown', [[-w0, y1, rz(z0)], [w0, y1, rz(z0)], [w1, y1, rz(z1)], [-w1, y1, rz(z1)]], 25)
    plate(f'{id}-front', name + ' forward end', [[-w0, y0, rz(z0)], [w0, y0, rz(z0)], [w0, y1, rz(z0)], [-w0, y1, rz(z0)]], 25)
    plate(f'{id}-back', name + ' after end', [[-w1, y0, rz(z1)], [w1, y0, rz(z1)], [w1, y1, rz(z1)], [-w1, y1, rz(z1)]], 25)
# Upper side (16 mm) from the main deck to the upper deck, and the upper deck (16 mm), over the citadel and aft to
# the after superstructure (upcas).
band('upper-side', 'upper side plating', -26.56, 41.4, 14, belt_top, lambda z: deck_ref(z) - .02, 16)
for j in range(14):
    za = -26.56 + (41.4 + 26.56) * j / 14
    zb = -26.56 + (41.4 + 26.56) * (j + 1) / 14
    ya, yb = deck_ref(za) - .01, deck_ref(zb) - .01
    wa, wb = half_breadth(rz(za), ya - .05) * .98, half_breadth(rz(zb), yb - .05) * .98
    plate(f'upper-deck-{j}', 'Upper deck', [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], 16)
# Conning station (ss_bridge): 37 mm box round the pilot house, 15.74 to 18.05 m (reference x 2.6, z -46.0 to -41.4).
for id, vs in [('conning-front', [[-2.6, 15.74, -45.97], [2.6, 15.74, -45.97], [2.6, 18.05, -45.97], [-2.6, 18.05, -45.97]]),
               ('conning-back', [[-2.6, 15.74, -41.37], [2.6, 15.74, -41.37], [2.6, 18.05, -41.37], [-2.6, 18.05, -41.37]]),
               ('conning-port', [[-2.6, 15.74, -45.97], [-2.6, 15.74, -41.37], [-2.6, 18.05, -41.37], [-2.6, 18.05, -45.97]]),
               ('conning-starboard', [[2.6, 15.74, -45.97], [2.6, 15.74, -41.37], [2.6, 18.05, -41.37], [2.6, 18.05, -45.97]]),
               ('conning-roof', [[-2.6, 18.05, -45.97], [2.6, 18.05, -45.97], [2.6, 18.05, -41.37], [-2.6, 18.05, -41.37]])]:
    plate(id, 'Conning station', [[x, y, rz(z)] for x, y, z in vs], 37)
# Steering gear box: 38 mm ends, 21 mm crown (reference z 71.1 to 80.9).
for id, vs, mm in [('steering-forward', [[-3.82, -.75, 71.11], [3.82, -.75, 71.11], [3.82, 1.65, 71.11], [-3.82, 1.65, 71.11]], 38),
                   ('steering-after', [[-1.54, -.75, 80.88], [1.54, -.75, 80.88], [1.54, 1.65, 80.88], [-1.54, 1.65, 80.88]], 38),
                   ('steering-roof', [[-3.82, 1.65, 71.11], [3.82, 1.65, 71.11], [1.54, 1.65, 80.88], [-1.54, 1.65, 80.88]], 21)]:
    plate(id, 'Steering-gear protection', [[x, y, rz(z)] for x, y, z in vs], mm)

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (reference HP_flag_nation); both Mk 7 directors train.
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='us-48', position=[0, 27.6, rz(38.05)], width=2.6, staffHeight=0)],
                radars=[dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=30),
                        dict(id='after-director', nodeId='after-director.yaw', rpm=2, sweepDeg=55, phaseDeg=170)])
b['damageControl'] = dict(version=1, teams=3, setupSeconds=8, repairPoints=240, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.08, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Placeholder; author-damage-control.ts writes the shared fleet defaults.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, round(L, 3)])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
# Keep the committed local damage and damage control the helpers wrote; flood spaces and stability follow the hull
# and rooms, so rerun author-flood-spaces.ts and author-stability.ts after this script.
if previous:
    for key in ['localDamage', 'damageControl']:
        if key in previous and not (key == 'localDamage' and previous[key]['regions'][0]['id'] == 'hull-placeholder'):
            b[key] = previous[key]
write(HERE / 'blueprint.json', b)
print(f'Authored omaha: {len(sections)} sections ({len(replaced)} bridged: {replaced}), {round(volume * 1.025)} t at the reference waterline, '
      f'draft {DRAFT} m, beam {round(beam, 2)} m, {len(b["mounts"])} mounts, {len(structures)} structures, {len(b["armor"])} armour plates.')

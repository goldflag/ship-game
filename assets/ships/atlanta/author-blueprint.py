"""Original USS Atlanta (CL-51) blueprint authoring (1942 fit), GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and
rebuilds everything except the measured superstructure blocks, which it keeps from the
current blueprint unless a fresh measurement file is passed:

  python3 assets/ships/atlanta/author-blueprint.py [--structures structures.json]

The hull comes from `authoring/lines.json`, measured with `bun run ship:lines atlanta --ref
pasc006` (see its note for the capped passes it merges), with the stem and the raked
transom shaped from the reference's centreline profile below. The superstructure blocks are
traced from `ship:slice pasc006 --plan` cuts every 5 cm of the hull group, followed up
through the levels into prisms (ignored `.build/atlanta/`, never reference triangles).
Mount datums come from the reference hardpoints, armour zones and thicknesses from its
armour model (asc006_atlanta_1942); both are provisional game calibration, not a historical
survey. Run afterwards: author-local-damage (new ship only), author-flood-spaces,
author-stability and author-damage-control, always passing `atlanta`.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
# Frame: runtime z = reference z + ZS. The hull runs from the stem head (reference z -82.58)
# to the top of the raked transom on the centreline (82.18) at the reference waterline datum.
BOW_REF, STERN_REF = -82.58, 82.18
ZS = round(-(BOW_REF + STERN_REF) / 2, 4)   # 0.2
L = round(STERN_REF - BOW_REF, 4)           # 164.76
DRAFT = 6.251        # keel below the reference waterline
DEPTH = 9.89         # keel to the weather deck amidships (3.64 m above the waterline)
SPEED_KN = 32.5


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


def rz(z):
    """Reference z -> runtime z."""
    return round(z + ZS, 4)


args = argparse.ArgumentParser()
args.add_argument('--structures')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
LINES = json.loads((HERE / 'authoring/lines.json').read_text())
LOW = [0, 0.004, 0.012, 0.025, 0.045, 0.07, 0.1, 0.14, 0.19, 0.25, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.87, 0.94, 1]
HIGH = [0.2, 0.4, 0.6, 0.75, 0.85, 0.92, 0.96, 0.985, 1]


def levels(keel, deck):
    """ship:lines' level rule (H0 1.5 m, end margin 1 m, end fraction 0.75) for a re-keeled section."""
    h0 = 1.5 if keel < 0.5 else keel + (deck - keel) * .75
    return [keel + (h0 - keel) * u for u in LOW] + [h0 + (deck - h0) * u for u in HIGH]


def width_at(points, y):
    """Half-breadth of a measured section at height y (held at the end values)."""
    pts = sorted(((p[1], p[0]) for p in points))
    return interp(pts, y)


lines_half = LINES['length'] / 2 - LINES['zShift']   # lines station = lines_half - reference z
measured = []
for s in LINES['sections']:
    zref = lines_half - s['station']
    measured.append((zref, [list(p) for p in s['points']]))
measured.sort(key=lambda m: m[0])
# The stem on the centreline profile (ship:slice --section x=0.02): nearly upright from the keel to the
# waterline, then raked forward to the stem head. Forward of the stem bar's after edge the section starts
# where the stem crosses it; ship:lines' running keel median ran those few ends too low or too high.
STEM = [(-2.0, -80.76), (0.0, -80.79), (1.0, -80.86), (2.0, -80.94), (3.0, -81.08), (4.0, -81.31), (5.0, -81.58),
        (6.0, -81.90), (7.0, -82.24), (7.9, -82.54), (8.0, -82.58)]
# Two stations through the anchor pockets (reference z -75.3 and -76.3) followed the hawse pipes inboard at the top:
# a station whose upper half-breadths leave both neighbours' by over 0.3 m takes their mean instead.
# One station (reference z 1.7) caught the tip of a bilge keel below the bilge: the same rule on the lower
# points, at 2 m (that station sits 4.9 m out). The bilge keels themselves are fittings (atlanta_fittings.underwater).
def off_line(i, a, b, points):
    (za, pa), (z, p), (zb, pb) = measured[a], measured[i], measured[b]
    t = (z - za) / (zb - za)
    return max(abs(p[k][0] - (pa[k][0] * (1 - t) + pb[k][0] * t)) for k in points)


for points, limit, why in ((range(-6, 0), .3, 'anchor pocket'), (range(1, 10), 2.0, 'bilge keel')):
    bad = [i for i in range(2, len(measured) - 2) if min(off_line(i, i - 1, i + 1, points), off_line(i, i - 2, i + 2, points)) > limit]
    for i in bad:
        a = max(j for j in range(i) if j not in bad)
        b = min(j for j in range(i + 1, len(measured)) if j not in bad)
        (za, pa), (z, p), (zb, pb) = measured[a], measured[i], measured[b]
        t = (z - za) / (zb - za)
        measured[i] = (z, [[round(pa[k][0] * (1 - t) + pb[k][0] * t, 4), round(pa[k][1] * (1 - t) + pb[k][1] * t, 4)] for k in range(len(p))])
        print(f'hull: station at reference z {z:.2f} replaced by its neighbours ({why})')
fixed = []
for zref, pts in measured:
    if zref < -80.78:
        keel = interp([(z, y) for y, z in sorted(STEM, key=lambda p: p[1])], zref)
        deck = pts[-1][1]
        keel = min(keel, deck - .12)
        ys = levels(keel, deck)
        pts = [[0.0, round(keel, 4)]] + [[round(max(.004, width_at(pts, y)), 4), round(y, 4)] for y in ys[1:]]
    fixed.append((zref, pts))
# The raked, rounded transom: aft of reference z 80.2 the stations are the 80.2 m section cut by the transom
# face measured on the profiles (z = 80.76 + 0.335 y - 0.069 x^2: 18 degrees of rake, rounded in plan).
TRANSOM = lambda y, x: 80.76 + .335 * y - .069 * x * x
base_z, base_pts = max((m for m in fixed if m[0] <= 80.21), key=lambda m: m[0])
fixed = [m for m in fixed if m[0] <= 80.21]
deck_aft = base_pts[-1][1]
for zref in (80.45, 80.7, 80.95, 81.2, 81.45, 81.7, 81.9, 82.05, STERN_REF):
    keel = max(base_pts[0][1], (zref - 80.76) / .335 + .01)
    keel = min(keel, deck_aft - .06)
    ys = levels(keel, deck_aft)
    pts = [[0.0, round(keel, 4)]]
    for y in ys[1:]:
        reach = TRANSOM(y, 0) - zref
        w = min(width_at(base_pts, y), math.sqrt(max(0.0, reach / .069)))
        pts.append([round(max(.004, w), 4), round(y, 4)])
    fixed.append((zref, pts))
fixed.sort(key=lambda m: m[0])
# The stem head closes the loft at the bow end of the length (a sliver at the deck, reference z -82.58).
stem_deck = fixed[0][1][-1][1]
fixed.insert(0, (BOW_REF, [[0.0, round(stem_deck - .08, 4)]] + [[.004, round(y, 4)] for y in levels(stem_deck - .08, stem_deck)[1:]]))
sections = [{'station': round(STERN_REF - zref, 4), 'points': pts} for zref, pts in fixed]
sections.sort(key=lambda s: s['station'])
assert len({len(s['points']) for s in sections}) == 1


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
hull = dict(kind='authored-stations-v1', length=L, beam=round(beam, 4), draft=DRAFT, depth=DEPTH,
            massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round(above * .55, 1),
            halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
            deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
            keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
            sections=sections)


def deck_y(z):
    """Weather-deck height at the side at runtime z (bow negative)."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='atlanta', name='Atlanta',
         configuration='CL-51 · 1942 exterior after the GameModels3D pasc006 A hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/atlanta.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=5, acceleration=.22, braking=.2, rudderRate=.45, maxYawRate=.026),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 16.9, rz(-22.2)]),
         structuralPlating=dict(hullMm=13, superstructureMm=10, note='Hull and superstructure plating read from the approved GameModels3D armour model (13 mm constructional hull and weather decks, 10 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure blocks measured from the approved GameModels3D pasc006 A hull (asc006_atlanta_1942) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Sixteen 5-inch/38 in eight twin Mk 32 Mod 12 mounts (six on the centreline, two in the waist), four 1.1-inch/75 quadruple mounts, eight 20 mm Oerlikon Mk 4, two trainable quadruple 21-inch torpedo mounts, six depth-charge throwers and two stern tracks at the reference datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference datums)
FIRE_MAIN = dict(fuelSeconds=80, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# Eight twin 5-inch/38 Mk 32 Mod 12 (HP_AGM): three superfiring forward, two in the waist trained aft, three
# aft. Travel follows the reference's horizontal sectors (ship frame, clockwise): the forward mounts +-146/150
# degrees about the bow, the after ones +-148/150 about the stern, the waist mounts from astern round their own
# beam to 14 degrees off the bow.
MAIN = [('main-1', 'No. 1 5-inch mount', 0, 6.561, -52.602, 0, dict(traverseDeg=146), 'magazine-forward'),
        ('main-2', 'No. 2 5-inch mount', 0, 8.595, -44.094, 0, dict(traverseDeg=150), 'magazine-forward'),
        ('main-3', 'No. 3 5-inch mount', 0, 10.497, -35.584, 0, dict(traverseDeg=150), 'magazine-forward'),
        ('main-4', 'No. 4 5-inch mount (port waist)', -5.347, 4.284, 23.508, 180, dict(traverseLimitsDeg=[0, 166]), 'magazine-after'),
        ('main-5', 'No. 5 5-inch mount (starboard waist)', 5.348, 4.284, 23.508, 180, dict(traverseLimitsDeg=[-166, 0]), 'magazine-after'),
        ('main-6', 'No. 6 5-inch mount', 0, 7.970, 33.887, 180, dict(traverseDeg=150), 'magazine-after'),
        ('main-7', 'No. 7 5-inch mount', 0, 6.273, 42.228, 180, dict(traverseDeg=148), 'magazine-after'),
        ('main-8', 'No. 8 5-inch mount', 0, 4.455, 50.784, 180, dict(traverseDeg=150), 'magazine-after')]
for id, name, x, y, z, bearing, travel, magazine in MAIN:
    b['mounts'].append(dict(id=id, name=name, partId='us-5in38-mk32-mod12', battery='main', position=[x, y, rz(z)], bearingDeg=bearing,
                            rangefinder=False, magazineId=magazine, fire=FIRE_MAIN, **travel))
# 1.1-inch/75 quadruple (HP_AGA_3/4 on the bridge-wing sponsons, 9 and 12 aft) and 20 mm Oerlikon Mk 4 singles.
QUAD = [('aa-quad-1', 'Port 1.1-inch quad', -5.781, 9.108, -19.766, -90), ('aa-quad-2', 'Starboard 1.1-inch quad', 5.781, 9.108, -19.766, 90),
        ('aa-quad-3', 'After 1.1-inch quad', 0, 10.005, 26.757, 180), ('aa-quad-4', 'Stern 1.1-inch quad', 0, 4.389, 75.948, 180)]
SINGLE = [('aa-20mm-1', -2.770, 9.840, -29.044, -35), ('aa-20mm-2', 2.771, 9.840, -29.044, 37),
          ('aa-20mm-3', -5.959, 6.308, 3.701, -90), ('aa-20mm-4', 5.960, 6.308, 3.699, 90),
          ('aa-20mm-5', -5.959, 6.308, 8.129, -90), ('aa-20mm-6', 5.961, 6.308, 8.129, 90),
          ('aa-20mm-7', -3.357, 4.241, 69.223, -150), ('aa-20mm-8', 3.357, 4.241, 69.225, 150)]
# The light AA rest with their barrels at 30 degrees, as the reference stows them (its HP_gunFire datums stand about 2 m
# over the pivots). Level at rest, the bridge-front pair's barrels lay 3 cm over their splinter shield and the
# installation interlock held them there for good.
for id, name, x, y, z, bearing in QUAD:
    b['mounts'].append(dict(id=id, name=name, partId='us-11in75-quad', battery='secondary', position=[x, y, rz(z)], bearingDeg=bearing,
                            rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT,
                            initialElevationDeg=30))
for i, (id, x, y, z, bearing) in enumerate(SINGLE, 1):
    b['mounts'].append(dict(id=id, name=f'20 mm Oerlikon {i}', partId='us-20mm-oerlikon-mk4', battery='secondary', position=[x, y, rz(z)], bearingDeg=bearing,
                            rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT,
                            initialElevationDeg=30))
    if id in ('aa-20mm-7', 'aa-20mm-8'):
        # The stern pair stand in 1 m tubs: an installed depression stop keeps the muzzles over the splinter shield.
        b['mounts'][-1]['elevationMinDeg'] = -2
    elif id in ('aa-20mm-3', 'aa-20mm-4', 'aa-20mm-5', 'aa-20mm-6'):
        # The waist four stand inside their double shield, its top 0.1 m under the trunnions: no depression.
        b['mounts'][-1]['elevationMinDeg'] = 0

# ---------------------------------------------------------------- torpedo mounts
# Two trainable quadruple 21-inch Mk 14 mounts on the main deck abreast the after superstructure (HP_AGT_1/2),
# pivots at the reference datums, tubes 0.666 m apart. The reference stows them trained aft: its tubes run 3.33 m
# forward of the pivot to the breeches and the trainer's cab and 4.72 m aft to the scarfed muzzles. The game trains
# tubes from zero (forward), so the mount is authored as the reference's turned end for end: muzzles 4.72 m ahead of
# the pivot and breeches 3.33 m abaft it; trained aft it matches the reference, and trained to the beam the short
# breech end swings clear of the waist deckhouse (x 2.22) as the reference's does. Each trains out over its own side
# and fires within 30 degrees of the beam, as the reference's sectors allow.
TORPEDO_PIVOT_Z, TORPEDO_MUZZLE, TORPEDO_BREECH = 14.936, 4.724, 3.326
b['torpedoLaunchers'] = []
b['torpedoTubes'] = []
for id, name, x, side in [('torpedo-port', 'Port quadruple torpedo mount', -5.902, -1), ('torpedo-starboard', 'Starboard quadruple torpedo mount', 5.903, 1)]:
    b['torpedoLaunchers'].append(dict(id=id, name=name, position=[x, 3.66, rz(TORPEDO_PIVOT_Z)], traverseRateDeg=18,
                                      traverseLimitsDeg=[-180, 0] if side < 0 else [0, 180], launchArcsDeg=[[-120, -60]] if side < 0 else [[60, 120]]))
    for k, dx in enumerate([-.999, -.333, .333, .999], 1):
        b['torpedoTubes'].append(dict(id=f'{id}-tube-{k}', name=f'{name.split(" quadruple")[0]} tube {k}', partId='us-mk15-fast',
                                      position=[round(x + dx, 3), 4.493, rz(TORPEDO_PIVOT_Z - TORPEDO_MUZZLE)], bearingDeg=0, arcDeg=2, ammo=1,
                                      magazineId='torpedo-magazine', launcherId=id, launcherModuleId=f'{id}-equipment'))
    b['modules'].append(dict(id=f'{id}-equipment', name=name, kind='launcher', placement='fixed', torpedoLauncherId=id,
                             center=[x, 4.95, rz(TORPEDO_PIVOT_Z - (TORPEDO_MUZZLE - TORPEDO_BREECH) / 2)], size=[2.8, 2.6, 8.0],
                             hp=90, protectionMm=6, immersionToleranceM=.3))

# ---------------------------------------------------------------- depth charges
# Six throwers on the quarterdeck (HP_AGB_1-6) and two stern roller tracks (HP_AGB_7/8), released at the
# reference datums; charges, rates and ammunition follow the fleet's Mk 6 calibration (Fletcher, Gleaves).
b['depthChargeLaunchers'] = []
THROWERS = [('dc-thrower-port-1', 'Port thrower 1', -3.983, 3.94, 59.529), ('dc-thrower-starboard-1', 'Starboard thrower 1', 3.986, 3.94, 59.529),
            ('dc-thrower-port-2', 'Port thrower 2', -3.856, 3.993, 62.519), ('dc-thrower-starboard-2', 'Starboard thrower 2', 3.755, 3.993, 62.519),
            ('dc-thrower-port-3', 'Port thrower 3', -3.774, 4.039, 64.979), ('dc-thrower-starboard-3', 'Starboard thrower 3', 3.642, 4.039, 65.586)]
for id, name, x, y, z in THROWERS:
    side = -1 if x < 0 else 1
    b['depthChargeLaunchers'].append(dict(id=id, name=name, partId='us-mk6-depth-charge', position=[round(x + side * .45, 3), round(y + .75, 3), rz(z)],
                                          velocity=[side * 12, 9, 0], ammo=2, magazineId='depth-charge-magazine', launcherModuleId=f'equipment-{id}'))
    b['modules'].append(dict(id=f'equipment-{id}', name=name, kind='launcher', placement='fixed', center=[x, round(y + .45, 3), rz(z)], size=[.8, .9, 1.2],
                             hp=45, protectionMm=3, immersionToleranceM=.25))
for id, name, x in [('dc-track-port', 'Port stern track', -.933), ('dc-track-starboard', 'Starboard stern track', .933)]:
    b['depthChargeLaunchers'].append(dict(id=id, name=name, partId='us-mk6-depth-charge', position=[x, 4.3, rz(82.15)], velocity=[0, 0, 2], ammo=8,
                                          magazineId='depth-charge-magazine', launcherModuleId=f'equipment-{id}'))
    b['modules'].append(dict(id=f'equipment-{id}', name=name, kind='launcher', placement='fixed', center=[x, 4.95, rz(80.7)], size=[1.3, 1.4, 4.1],
                             hp=70, protectionMm=3, immersionToleranceM=.25))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    measured_structures = json.loads(Path(opts.structures).read_text())['structures']
    structures = []
    for s in measured_structures:
        entry = dict(id=s['id'], name=s['name'], footprint=s['footprint'], baseY=s['baseY'], height=s['height'], material='naval')
        if s.get('surface'):
            entry['surface'] = s['surface']
        if s.get('exhaust'):
            entry['exhaust'] = s['exhaust']
        structures.append(entry)
else:
    structures = previous['structures']
# The two lookout stations are open wells in the reference (sections and plan cuts), not the solid blocks the level
# tracing made of their walls: the bridge's aft station floored at 15.4 m round the forward Mk 37 tower, and the after
# superstructure's floored at 11.5 m forward of the after tower, with the after Mk 44's tub on the 02 deck abaft it.
# Their walls are drawn by atlanta_fittings.lookout_stations; the towers stand on the floors.
AFTER_STATION_FLOOR = [(-1.29, 12.99), (-2.05, 13.63), (-2.33, 13.71), (-2.55, 14.05), (-2.55, 14.25), (-2.31, 14.53), (-2.23, 14.77), (-2.23, 18.21),
                       (-1.47, 18.73), (1.45, 18.73), (2.21, 18.25), (2.21, 14.81), (2.29, 14.57), (2.57, 14.25), (2.57, 14.05), (2.35, 13.75),
                       (2.15, 13.71), (1.35, 13.03), (1.11, 13.03), (.79, 13.39), (.55, 13.47), (-.53, 13.47), (-.77, 13.39), (-1.13, 12.99)]
structures = [s for s in structures if s['id'] not in ('bridge-23', 'bridge-24', 'after-superstructure-09', 'after-superstructure-10')]
for s in structures:
    top = s['baseY'] + s['height']
    if s['id'] == 'bridge-25':
        s['name'], s['baseY'], s['height'] = 'Forward Mk 37 tower 15.4-18.3 m', 15.395, round(top - 15.395, 3)
    elif s['id'] == 'after-superstructure-12':
        s['name'], s['baseY'], s['height'] = 'After Mk 37 tower 11.0-13.8 m', 11.045, round(top - 11.045, 3)
    elif s['id'] == 'midships-02':
        # The waist galleries' support beams at 6.1 m were traced into this 01-deck slab as spikes out through the
        # 20 mm shields; the galleries themselves are drawn by the fittings, so the slab stops at the deckhouse side.
        s['footprint'] = [p for p in s['footprint'] if not (abs(p[0]) > 5.22 and 1.5 < p[1] < 10.6)]
    elif s['id'] == 'after-superstructure-08':
        s['name'], s['footprint'], s['height'] = 'After lookout station floor 11.0-11.5 m', [list(p) for p in AFTER_STATION_FLOOR], round(11.5 - s['baseY'], 3)
b['structures'] = structures

# Firing obstructions: boxes kept inside the visual walls for substantial blocks, cut into fore-and-aft strips of
# at most 3 m so a stepped deckhouse is not boxed at its widest. Each box takes the breadth the block keeps over the
# whole strip (the narrowest chord), and a strip that narrows by more than a fifth (a rounded front) is halved down to
# 0.75 m, so the boxes step in with the walls: boxed at their widest, the pilot house's rounded front stood 0.9 m
# ahead of its own face and froze the bridge-front 20 mm at rest.
def chord(poly, z):
    """The footprint's breadth (x0, x1) across the fore-and-aft station z, or None."""
    xs = []
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az - z) * (bz - z) < 0 or (az == z) != (bz == z):
            if az == bz:
                continue
            xs.append(ax + (bx - ax) * (z - az) / (bz - az))
    return (min(xs), max(xs)) if len(xs) >= 2 else None


def inscribed(poly, z0, z1):
    """The breadth the footprint keeps over the whole strip, and its widest breadth there."""
    m = max(2, math.ceil((z1 - z0) / .25))
    spans = [chord(poly, z0 + .05 + (z1 - z0 - .1) * j / m) for j in range(m + 1)]
    spans = [c for c in spans if c]
    if not spans:
        return None, 0.0
    lo, hi = max(c[0] for c in spans), min(c[1] for c in spans)
    return ((lo, hi) if hi - lo > 0 else None), max(c[1] for c in spans) - min(c[0] for c in spans)


def strips(poly, z0, z1):
    span, widest = inscribed(poly, z0, z1)
    if span and (span[1] - span[0] >= .8 * widest or z1 - z0 <= .75):
        return [(z0, z1, span)]
    if z1 - z0 <= .75:
        return []
    zm = (z0 + z1) / 2
    return strips(poly, z0, zm) + strips(poly, zm, z1)


for s in structures:
    poly = s['footprint']
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    if s['height'] < 1.0 or (max(xs) - min(xs)) * (max(zs) - min(zs)) < 6 or s.get('exhaust'):
        continue
    n = max(1, math.ceil((max(zs) - min(zs)) / 3))
    k = 0
    for i in range(n):
        for z0, z1, (x0, x1) in strips(poly, min(zs) + (max(zs) - min(zs)) * i / n, min(zs) + (max(zs) - min(zs)) * (i + 1) / n):
            if x1 - x0 < .6 or z1 - z0 < .6:
                continue
            b['obstructions'].append(dict(id=f"{s['id']}-{k}", center=[round((x0 + x1) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((z0 + z1) / 2, 3)],
                                          size=[round(x1 - x0 - .4, 3), round(s['height'], 3), round(z1 - z0 - .2, 3)]))
            k += 1
# The funnels stop shells and barrels too.
for s in structures:
    if s.get('exhaust'):
        xs = [p[0] for p in s['footprint']]
        zs = [p[1] for p in s['footprint']]
        b['obstructions'].append(dict(id=f"{s['id']}-casing", center=[0, round(s['baseY'] + s['height'] / 2, 3), round((min(zs) + max(zs)) / 2, 3)],
                                      size=[round(max(xs) - min(xs) - .2, 3), round(s['height'] - .6, 3), round(max(zs) - min(zs) - .2, 3)]))
# Whaleboats, the motor launch and the crane pillar (reference misc parts): barrels stop at them.
for name, (x0, x1), (y0, y1), (z0, z1) in [('whaleboat-port', (-7.1, -5.1), (6.3, 8.2), (-17.4, -9.5)), ('whaleboat-starboard', (5.1, 7.1), (6.3, 8.2), (-17.4, -9.5)),
                                           ('motor-launch', (1.0, 4.2), (6.7, 10.0), (-10.0, 2.3)), ('motor-launch-port', (-4.2, -1.0), (6.7, 10.0), (-10.0, 2.3))]:
    b['obstructions'].append(dict(id=name, center=[round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)], size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: the 5-inch barrels (with the full recoil stroke) and gunhouses may not enter the blocks they
# can reach, and neighbouring mounts may not cross. Game clearance, not verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
BODIES = {'us-5in38-mk32-mod12': dict(center=[0, 1.57, .47], size=[4.8, 3.05, 5.25]),
          'us-11in75-quad': dict(center=[0, 1.0, .1], size=[2.5, 2.0, 2.4]),
          'us-20mm-oerlikon-mk4': dict(center=[0, 1.0, .3], size=[1.4, 2.0, 1.2])}
clear_mounts, reach = [], {}
for m in b['mounts']:
    w = catalog[m['partId']]
    clear_mounts.append(dict(mountId=m['id'], barrelRadiusM=round(max(w['barrelBaseRadius'] * .85, .05), 3), body=BODIES[m['partId']]))
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
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for every mount (5-inch, 1.1-inch and 20 mm) against the measured superstructure blocks they can reach, including the full recoil stroke, and between neighbouring mounts whose working circles overlap. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby], neighbors=neighbors)

# ---------------------------------------------------------------- rooms, machinery, directors
def room(id, name, center, size, kind=None, role=None, hp=150, fire=None):
    cid = id + '-room'
    compartment = dict(id=cid, name=name + ' space', center=center, size=size, capacityM3=round(math.prod(size) * .78, 1), pumpM3PerSecond=.014)
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
# 5-inch magazines inside the armoured boxes the reference's armour model draws: forward (reference z -54.5 to
# -31.6, 8.8 m wide) and after (25.4 to 52.7, 5.8 m wide), both under the 32 mm deck at y -1.83.
room('magazine-forward', 'Forward 5-inch magazines', [0, -4.0, rz(-43.0)], [8.4, 4.2, 22.0], 'magazine', hp=200, fire=MAG)
room('magazine-after', 'After 5-inch magazines', [0, -3.8, rz(39.0)], [5.6, 3.8, 26.0], 'magazine', hp=200, fire=MAG)
room('aa-ammunition-forward', 'Forward light AA ready ammunition', [0, 5.3, rz(-24.0)], [5.0, 1.8, 4.0], 'magazine', hp=70, fire=MAG)
room('aa-ammunition-after', 'After light AA ready ammunition', [0, 4.8, rz(28.0)], [4.0, 1.8, 3.5], 'magazine', hp=70, fire=MAG)
room('torpedo-magazine', 'Torpedo ready service', [0, 4.6, rz(17.0)], [4.0, 1.6, 5.0], 'magazine', hp=80, fire=MAG)
room('depth-charge-magazine', 'Depth charge ready service', [0, 3.0, rz(62.0)], [5.0, 1.6, 6.0], 'magazine', hp=80, fire=MAG)
# Machinery in the 89 mm belted citadel (reference z -31.6 to 25.4): a unit arrangement of forward fireroom,
# forward engine room, after fireroom and after engine room, the firerooms under their funnels. Two shafts.
room('fireroom-1', 'Forward fireroom', [0, -2.8, rz(-22.0)], [12.4, 6.4, 17.0], 'engine', 'boiler', 220, ENG)
room('engine-room-1', 'Forward engine room', [0, -2.8, rz(-6.5)], [13.6, 6.4, 13.0], 'engine', 'turbine', 200, ENG)
room('fireroom-2', 'After fireroom', [0, -2.8, rz(6.5)], [13.6, 6.4, 12.0], 'engine', 'boiler', 220, ENG)
room('engine-room-2', 'After engine room', [0, -2.8, rz(18.5)], [12.8, 6.4, 12.0], 'engine', 'turbine', 200, ENG)
# Shaft alleys outboard of the after magazine, from the after engine room to where the shafts leave the hull.
for side, x in [('port', -3.7), ('starboard', 3.7)]:
    room(f'shaft-alley-{side}', f'{side.title()} shaft alley', [x, -3.1, rz(36.0)], [1.6, 2.2, 20.0], fire=ENG)
    b['modules'].append(dict(id=f'shaft-{side}', name=f'{side.title()} shaft', kind='engine', role='shaft', compartmentId=f'shaft-alley-{side}-room',
                             center=[x, -3.1, rz(36.0)], size=[.6, 1.0, 17.0], hp=90, immersionToleranceM=.8))
# Steering gear in the reference's 25 mm box (reference z 61.5 to 72.5, 4.3 m wide, y -2.1 to 0.1), over the rudder.
room('steering', 'Steering gear', [0, -1.0, rz(67.0)], [4.3, 2.2, 11.0], 'steering', hp=150, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='forward-unit', share=.5, boilerIds=['fireroom-1'], driveIds=['engine-room-1'], shaftIds=['shaft-starboard']),
    dict(id='after-unit', share=.5, boilerIds=['fireroom-2'], driveIds=['engine-room-2'], shaftIds=['shaft-port'])],
    basis='Provisional two-shaft unit machinery: each fireroom and engine room pair drives one shaft. Room bounds and routing are game estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_AD): Mk 37 forward and aft, Mk 44 for the 1.1-inch quads.
director('mk37-forward', 'Forward Mk 37 director', [0, 18.344, -19.485], MAIN_IDS, [3.2, 2.6, 3.9], 70, 13)
director('mk37-after', 'After Mk 37 director', [0, 14.313, 19.06], MAIN_IDS, [3.2, 2.6, 3.9], 60, 13)
for id, name, pos, serves in [('mk44-port', 'Port Mk 44 director', [-5.61, 7.038, -24.024], ['aa-quad-1']),
                              ('mk44-starboard', 'Starboard Mk 44 director', [5.611, 7.038, -24.009], ['aa-quad-2']),
                              ('mk44-after', 'After Mk 44 director', [-.012, 11.115, 22.116], ['aa-quad-3']),
                              ('mk44-stern', 'Stern Mk 44 director', [0, 5.589, 72.657], ['aa-quad-4'])]:
    director(id, name, pos, serves, [1.4, 1.9, 1.4], 30, 4)

# ---------------------------------------------------------------- protection (GameModels3D armour model)
def plate(id, name, vs, mm, exterior=False, note='Thickness and zone from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pasc006-armour', basis='inferred', note=note)))


def quad(prefix, name, a, b_, c, d, mm, exterior=False):
    """Two planar triangles over a possibly twisted quad (reference x, y, z), mirrored to port."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        m = lambda v: [sign * v[0], v[1], rz(v[2])]
        plate(f'{prefix}-{side}-a', f'{side.title()} {name}', [m(a), m(b_), m(c)], mm, exterior)
        plate(f'{prefix}-{side}-b', f'{side.title()} {name}', [m(a), m(c), m(d)], mm, exterior)


def band(prefix, name, zs, y0, y1, mm, exterior=True):
    """A plate band on the loft's outer shell between heights y0(z) and y1(z) (reference z stations)."""
    for j, (za, zb) in enumerate(zip(zs, zs[1:])):
        ya0, ya1, yb0, yb1 = y0(za), y1(za), y0(zb), y1(zb)
        quad(f'{prefix}-{j}', name, (half_breadth(rz(za), ya0) * .998, ya0, za), (half_breadth(rz(zb), yb0) * .998, yb0, zb),
             (half_breadth(rz(zb), yb1) * .998, yb1, zb), (half_breadth(rz(za), ya1) * .998, ya1, za), mm, exterior)


# The belt's top edge and the armoured deck over it follow the same line: 2.0 m forward, 1.0 m amidships.
BELT_TOP = [(-31.56, 2.0), (-24.72, 1.71), (-16.2, 1.39), (-8.16, 1.16), (-.25, 1.0), (15.98, 1.07), (21.64, 1.13), (25.38, 1.16)]
belt_top = lambda z: interp(BELT_TOP, z)
CIT = [z for z, _ in BELT_TOP]
band('belt', 'main belt', CIT, lambda z: -1.83, belt_top, 89)
band('lower-belt', 'lower belt', [-31.56, -28.14, -24.72], lambda z: -3.3, lambda z: -1.83, 51)
band('magazine-belt', 'forward magazine belt', [-54.47, -46.83, -39.2, -31.56], lambda z: -3.3, lambda z: -1.83, 51)
# Armoured deck (32 mm) at the belt top over the citadel, and over the magazine boxes at y -1.83.
for j, (za, zb) in enumerate(zip(CIT, CIT[1:])):
    ya, yb = belt_top(za), belt_top(zb)
    wa, wb = half_breadth(rz(za), ya) * .985, half_breadth(rz(zb), yb) * .985
    plate(f'armoured-deck-{j}', 'Armoured deck', [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], 32)
for id, name, z0, z1, w0, w1 in [('magazine-deck-forward', 'Forward magazine deck', -54.47, -31.56, 2.58, 4.39),
                                 ('magazine-deck-after', 'After magazine deck', 25.38, 52.66, 2.88, 1.51)]:
    plate(id, name, [[-w0, -1.83, rz(z0)], [w0, -1.83, rz(z0)], [w1, -1.83, rz(z1)], [-w1, -1.83, rz(z1)]], 32)
# Magazine box sides (25 mm) and bottoms (6 mm), citadel bulkheads (89 mm) and magazine end bulkheads (25 mm).
quad('magazine-side-forward', 'forward magazine side', (4.39, -4.14, -54.47), (4.39, -4.14, -31.56), (4.39, -1.83, -31.56), (4.39, -1.83, -54.47), 25)
quad('magazine-side-after', 'after magazine side', (2.88, -3.74, 25.38), (2.88, -3.74, 52.66), (2.88, -1.81, 52.66), (2.88, -1.81, 25.38), 25)
for id, name, z, x0, x1, y0, y1, mm in [('bulkhead-forward', 'Forward citadel bulkhead', -31.56, 5.89, 6.46, -6.25, 2.0, 89),
                                          ('bulkhead-after', 'After citadel bulkhead', 25.38, 7.83, 7.83, -6.25, 1.16, 89),
                                          ('bulkhead-forward-magazine', 'Forward magazine bulkhead', -54.47, 2.58, 5.03, -4.14, -1.83, 25),
                                          ('bulkhead-after-magazine', 'After magazine bulkhead', 52.66, 1.51, 1.51, -3.74, -1.81, 25)]:
    plate(id, name, [[-x0, y0, rz(z)], [x0, y0, rz(z)], [x1, y1, rz(z)], [-x1, y1, rz(z)]], mm)
# Constructional sides (13 mm) above the belt to the weather deck, ends of the hull and the weather deck.
band('upper-side', 'upper side plating', [-54.47 + i * (52.66 + 54.47) / 20 for i in range(21)],
     lambda z: belt_top(z) if -31.56 <= z <= 25.38 else -1.83, lambda z: deck_y(rz(z)) - .03, 13)
for j in range(24):
    za = -54.47 + (52.66 + 54.47) * j / 24
    zb = -54.47 + (52.66 + 54.47) * (j + 1) / 24
    ya, yb = deck_y(rz(za)) - .01, deck_y(rz(zb)) - .01
    wa, wb = half_breadth(rz(za), ya - .05) * .98, half_breadth(rz(zb), yb - .05) * .98
    plate(f'weather-deck-{j}', 'Weather deck', [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], 13)
# Barbettes (32 mm) under each 5-inch mount, radius 1.87 m, down to the armour model's barbette floors.
BARBETTE_FLOOR = {'main-1': 3.42, 'main-2': 5.40, 'main-3': 7.54, 'main-4': 1.13, 'main-5': 1.13, 'main-6': 3.65, 'main-7': 3.71, 'main-8': 1.59}
for m in b['mounts'][:8]:
    x, top, z = m['position']
    floor = BARBETTE_FLOOR[m['id']]
    for i in range(16):
        a, c = i * math.tau / 16, (i + 1) * math.tau / 16
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[x + 1.87 * math.cos(a), floor, z + 1.87 * math.sin(a)], [x + 1.87 * math.cos(c), floor, z + 1.87 * math.sin(c)],
               [x + 1.87 * math.cos(c), top, z + 1.87 * math.sin(c)], [x + 1.87 * math.cos(a), top, z + 1.87 * math.sin(a)]], 32)
# Conning tower (65 mm sides, 32 mm roof) in the bridge at reference z -27.9 to -24.7, y 12.8 to 15.2.
CT = [(-2.84, -26.3), (-2.3, -27.5), (0, -27.87), (2.3, -27.5), (2.84, -26.3), (2.6, -24.72), (-2.6, -24.72)]
for i, ((ax, az), (bx, bz)) in enumerate(zip(CT, CT[1:] + CT[:1])):
    plate(f'conning-tower-{i}', 'Conning tower', [[ax, 12.82, rz(az)], [bx, 12.82, rz(bz)], [bx, 15.18, rz(bz)], [ax, 15.18, rz(az)]], 65)
plate('conning-tower-roof', 'Conning tower roof', [[x, 15.18, rz(z)] for x, z in CT], 32)
# Conning-tower floor (16 mm), barbette decks and floors (16 mm) and the magazine floors (6 mm), as the armour model
# has them.
plate('conning-tower-floor', 'Conning tower floor', [[x, 12.82, rz(z)] for x, z in CT], 16)
BARBETTE_DECK = {'main-1': (6.12, 5.89), 'main-2': (7.95, 7.91), 'main-3': (9.85, 9.85), 'main-4': (3.65, 3.64), 'main-5': (3.65, 3.64),
                 'main-6': (7.32, 7.32), 'main-7': (5.62, 5.62), 'main-8': (3.85, 3.79)}
for m in b['mounts'][:8]:
    x, _, z = m['position']
    fwd, aft = BARBETTE_DECK[m['id']]
    ring = [(x + 1.86 * math.cos(i * math.tau / 16), z + 1.86 * math.sin(i * math.tau / 16)) for i in range(16)]
    plate(f"{m['id']}-barbette-deck", m['name'] + ' barbette deck', [[px, round((fwd + aft) / 2, 3), pz] for px, pz in ring], 16)
    plate(f"{m['id']}-barbette-floor", m['name'] + ' barbette floor', [[px, BARBETTE_FLOOR[m['id']], pz] for px, pz in ring], 16)
for id, name, z0, z1, w0, w1, y in [('magazine-floor-forward', 'Forward magazine floor', -54.47, -31.56, 2.58, 4.39, -4.14),
                                    ('magazine-floor-after', 'After magazine floor', 25.38, 52.66, 2.88, 1.51, -3.74)]:
    plate(id, name, [[-w0, y, rz(z0)], [w0, y, rz(z0)], [w1, y, rz(z1)], [-w1, y, rz(z1)]], 6)
# Bottom plating (20 mm) from the forefoot to the run: the flat keel strake and the garboards up to the armour model's
# upper edge at each of its stations, fitted to the loft.
BOTTOM = [(-80.4, -5.11), (-78.75, -5.11), (-72.72, -5.13), (-64.59, -5.2), (-54.47, -5.3), (-47.42, -5.38), (-38.28, -5.45),
          (-31.56, -5.52), (-24.72, -5.6), (-8.16, -5.88), (-.25, -5.91), (15.98, -5.71), (25.38, -5.36), (38.43, -4.52),
          (44.49, -4.04), (52.66, -3.74), (58.0, -3.5)]
# The loft's forefoot and run lift off the keel line: the plating starts and ends where the flat keel has breadth.
# The loft's flat of bottom lies at 6.14-6.17 m under the waterline: the keel strake spans it at 6.1 m.
BOTTOM = [(z, top) for z, top in BOTTOM if half_breadth(rz(z), -6.1) > .1]
for j, ((za, ta), (zb, tb)) in enumerate(zip(BOTTOM, BOTTOM[1:])):
    zone = 'Bow' if zb <= -31.56 else 'Citadel' if zb <= 25.38 else 'Stern'
    ka, kb = half_breadth(rz(za), -6.1) * .998, half_breadth(rz(zb), -6.1) * .998
    plate(f'bottom-{j}-keel', f'{zone} bottom plating', [[-ka, -6.1, rz(za)], [ka, -6.1, rz(za)], [kb, -6.1, rz(zb)], [-kb, -6.1, rz(zb)]], 20, True)
    quad(f'bottom-{j}', f'{zone.lower()} bottom plating', (ka, -6.1, za), (kb, -6.1, zb), (half_breadth(rz(zb), tb) * .998, tb, zb),
         (half_breadth(rz(za), ta) * .998, ta, za), 20, True)
# Steering-gear box (25 mm).
for id, vs in [('steering-port', [[-2.15, -2.1, rz(61.51)], [-2.15, -2.1, rz(72.47)], [-2.15, .1, rz(72.47)], [-2.15, .1, rz(61.51)]]),
               ('steering-starboard', [[2.15, -2.1, rz(61.51)], [2.15, -2.1, rz(72.47)], [2.15, .1, rz(72.47)], [2.15, .1, rz(61.51)]]),
               ('steering-forward', [[-2.15, -2.1, rz(61.51)], [2.15, -2.1, rz(61.51)], [2.15, .1, rz(61.51)], [-2.15, .1, rz(61.51)]]),
               ('steering-after', [[-2.15, -2.1, rz(72.47)], [2.15, -2.1, rz(72.47)], [2.15, .1, rz(72.47)], [-2.15, .1, rz(72.47)]]),
               ('steering-roof', [[-2.15, .1, rz(61.51)], [2.15, .1, rz(61.51)], [2.15, .1, rz(72.47)], [-2.15, .1, rz(72.47)]])]:
    plate(id, 'Steering-gear protection', vs, 25)

# ---------------------------------------------------------------- rig
# At sea the US ensign flies from the after mast's gaff (reference HP_flag_nation); the SC-1 air-search
# aerial on the foremast head and both Mk 37 directors turn.
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='us-48', position=[0, 24.34, rz(13.13)], width=3.0, staffHeight=0)],
                radars=[dict(id='radar-sc1', nodeId='radar-sc1.yaw', rpm=5, phaseDeg=0),
                        dict(id='mk37-forward', nodeId='mk37-forward.yaw', rpm=2, sweepDeg=55, phaseDeg=40),
                        dict(id='mk37-after', nodeId='mk37-after.yaw', rpm=2, sweepDeg=55, phaseDeg=160)])
b['damageControl'] = dict(version=1, teams=3, setupSeconds=8, repairPoints=240, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.08, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Placeholder; author-damage-control.ts writes the shared fleet defaults.')
if previous and previous.get('localDamage') and previous['localDamage'].get('regions') and previous['localDamage']['regions'][0]['id'] != 'hull-placeholder':
    # Keep the local-damage and damage-control calibration the helpers wrote (author-local-damage is not rerun on an
    # existing ship); flood spaces and stability are rebuilt by their helpers after every run of this script.
    for key in ('localDamage', 'damageControl'):
        if key in previous:
            b[key] = previous[key]
else:
    b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                            basis='Placeholder; author-local-damage.ts replaces it.')
write(HERE / 'blueprint.json', b)
print(f'Authored atlanta: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, beam {beam:.2f} m, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["obstructions"])} obstructions, {len(b["armor"])} armour plates.')

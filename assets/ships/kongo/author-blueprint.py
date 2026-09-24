"""Original IJN Kongō 1942 blueprint authoring, GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was
first made and can rebuild everything except the measured hull stations and
superstructure prisms, which it keeps from the current blueprint unless fresh
measurement files are passed:

  python3 assets/ships/kongo/author-blueprint.py [--loft loft.json] [--structures superstructure.json]

The measurement files are produced in ignored .build/kongo/ from the cached
`bun run ship:reference pjsb007 --hull B_Hull` view: station outlines sampled by
height (hull body united with the anti-torpedo bulges, pinned to the keel, the
bulge top, the casemate ledge and the deck), and superstructure prisms from
plan-cut wall masks and roof columns grouped into height bands. They hold our
own sampled offsets, never source triangles. Mount datums, armour zones and
plate thicknesses are read from the approved GameModels3D model and are
provisional game calibration, not a historical survey. Run afterwards:
author-flood-spaces.ts, author-stability.ts, author-local-damage.ts and
author-damage-control.ts kongo.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = -0.1755         # reference z of the hull's mid-length; runtime z = reference z - ZC
L = 221.751          # stem head to the stern at the reference waterline datum
DRAFT = 9.15
DEPTH = 15.778       # keel to the midships forecastle deck


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
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
if opts.loft:
    loft = json.loads(Path(opts.loft).read_text())
    sections = [{'station': round(s['station'], 4), 'points': [[round(w, 4), round(max(y, -DRAFT), 4)] for w, y in s['points']]}
                for s in sorted(loft['sections'], key=lambda s: s['station'])]
    sections[0]['station'] = 0
    sections[-1]['station'] = L
else:
    sections = previous['hull']['sections']


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
    for (w0, y0), (w1, y1) in zip(points, points[1:]):
        if y0 <= level <= y1:
            return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (level - y0) / (y1 - y0)
    return points[-1][0]


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
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


# Inner hull (the original shell inside the anti-torpedo bulges), sampled from the reference hull body:
# reference z, then half breadth at y = -8.1, -3.24, -2.54, 0 and 1.36 m. The belt stands on this line.
INNER_Y = [-8.1, -3.24, -2.54, 0.0, 1.36]
INNER = [(-66, 2.28, 6.72, 7.08, 7.79, 8.02), (-64, 2.39, 7.07, 7.44, 8.15, 8.38), (-62, 2.84, 7.44, 7.78, 8.49, 8.68), (-60, 3.38, 7.83, 8.11, 8.83, 8.98),
         (-58, 3.93, 8.16, 8.44, 9.16, 9.31), (-56, 4.48, 8.49, 8.77, 9.50, 9.64), (-54, 5.03, 8.84, 9.11, 9.83, 9.96), (-52, 5.43, 9.21, 9.44, 10.16, 10.25),
         (-50, 5.87, 9.55, 9.76, 10.47, 10.51), (-48, 6.33, 9.86, 10.07, 10.74, 10.76), (-46, 6.78, 10.18, 10.38, 11.02, 11.04), (-44, 7.22, 10.49, 10.69, 11.29, 11.31),
         (-42, 7.67, 10.80, 11.01, 11.57, 11.58), (-40, 8.13, 11.12, 11.32, 11.85, 11.79), (-38, 8.54, 11.39, 11.58, 12.08, 11.94), (-36, 8.88, 11.57, 11.75, 12.24, 12.08),
         (-34, 9.19, 11.74, 11.92, 12.39, 12.24), (-32, 9.49, 11.91, 12.09, 12.55, 12.39), (-30, 9.79, 12.08, 12.26, 12.71, 12.55), (-28, 10.11, 12.26, 12.43, 12.86, 12.69),
         (-26, 10.44, 12.43, 12.60, 13.01, 12.80), (-24, 10.71, 12.59, 12.73, 13.08, 12.88), (-22, 10.90, 12.72, 12.86, 13.15, 12.95), (-20, 11.09, 12.86, 12.99, 13.22, 13.02),
         (-18, 11.29, 12.99, 13.12, 13.29, 13.09), (-16, 11.48, 13.14, 13.25, 13.36, 13.16), (-14, 11.68, 13.28, 13.38, 13.43, 13.23), (-12, 11.84, 13.37, 13.46, 13.46, 13.26),
         (-10, 11.93, 13.35, 13.42, 13.45, 13.25), (-8, 12.02, 13.33, 13.39, 13.44, 13.24), (-6, 12.10, 13.30, 13.36, 13.42, 13.23), (-4, 12.18, 13.27, 13.33, 13.41, 13.21),
         (-2, 12.25, 13.24, 13.30, 13.39, 13.20), (0, 12.33, 13.22, 13.26, 13.38, 13.19), (2, 12.32, 13.20, 13.24, 13.36, 13.17), (4, 12.28, 13.18, 13.21, 13.34, 13.15),
         (6, 12.23, 13.16, 13.19, 13.32, 13.13), (8, 12.18, 13.13, 13.17, 13.30, 13.11), (10, 12.14, 13.11, 13.14, 13.28, 13.09), (12, 12.09, 13.08, 13.12, 13.26, 13.06),
         (14, 12.04, 13.06, 13.09, 13.23, 13.04), (16, 11.95, 13.02, 13.06, 13.18, 12.97), (18, 11.82, 12.97, 13.01, 13.10, 12.89), (20, 11.67, 12.93, 12.97, 13.02, 12.81),
         (22, 11.51, 12.88, 12.92, 12.94, 12.73), (24, 11.34, 12.84, 12.87, 12.87, 12.65), (26, 11.18, 12.78, 12.83, 12.79, 12.57), (28, 10.98, 12.70, 12.76, 12.70, 12.49),
         (30, 10.60, 12.53, 12.59, 12.55, 12.40), (32, 10.21, 12.36, 12.42, 12.40, 12.31), (34, 9.84, 12.19, 12.25, 12.25, 12.20), (36, 9.48, 12.02, 12.08, 12.11, 12.05),
         (38, 9.11, 11.85, 11.91, 11.96, 11.90), (40, 8.68, 11.68, 11.74, 11.81, 11.76), (42, 8.24, 11.53, 11.57, 11.66, 11.61), (44, 7.80, 11.37, 11.40, 11.51, 11.46),
         (46, 7.22, 11.16, 11.20, 11.34, 11.30), (48, 6.47, 10.89, 10.95, 11.14, 11.12), (50, 5.57, 10.63, 10.70, 10.94, 10.92), (52, 4.94, 10.36, 10.44, 10.73, 10.74),
         (54, 4.11, 10.05, 10.17, 10.52, 10.54), (56, 3.43, 9.75, 9.92, 10.30, 10.32), (58, 2.72, 9.43, 9.66, 10.08, 10.11), (60, 2.27, 9.12, 9.35, 9.86, 9.88),
         (62, 1.95, 8.82, 9.12, 9.64, 9.66), (64, 1.67, 8.51, 8.89, 9.42, 9.43), (66, 1.43, 8.16, 8.54, 9.16, 9.17), (68, 1.18, 7.67, 8.14, 8.80, 8.83),
         (70, 0.99, 7.21, 7.71, 8.43, 8.51), (72, 0.73, 6.78, 7.27, 8.04, 8.15)]


def inner_breadth(zref, y):
    zs = [r[0] for r in INNER]
    col = [interp(list(zip(INNER_Y, r[1:])), y) for r in INNER]
    return interp(list(zip(zs, col)), zref)


b = dict(schemaVersion=1, id='kongo', name='IJN Kongō',
         configuration='Kongō · 1942 exterior after the GameModels3D pjsb007 B hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/kongo.glb', hull=hull,
         handling=dict(forwardSpeed=round(30.5 * .5144444, 4), reverseSpeed=4, acceleration=.2, braking=.25, rudderRate=.32, maxYawRate=.025),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 23.4, rz(-37.6)]),
         structuralPlating=dict(hullMm=19, superstructureMm=13, note='Hull, bulge and deckhouse plating thicknesses read from the approved GameModels3D armour model (19 mm constructional plating, 13 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure prisms measured from the approved GameModels3D pjsb007 B hull (jsb007_kongo_1942) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Eight 35.6 cm/45 Type 41 in four twin turrets, fourteen 15.2 cm Type 41 casemates, eight 12.7 cm/40 Type 89 in four open twin mounts, twelve 25 mm Type 96 in six twin mounts and ten 13.2 mm Type 93 (four twin, two single) at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference datums)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# The Kongō turret recipe carries its yaw datum 3.326 m below the reference gunhouse floor (its
# 3.4 m working floor sits on the reference turret base), so the barbettes rise to the source ring.
MAIN_DY = -3.326
MAIN = [('main-1', 'No. 1 turret', (7.742, -60.101), 0, False), ('main-2', 'No. 2 turret', (10.68, -47.421), 0, True),
        ('main-3', 'No. 3 turret', (8.934, 24.254), 180, True), ('main-4', 'No. 4 turret', (6.032, 65.7), 180, False)]
for id, name, (y, z), bearing, rangefinder in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 35.6 cm', partId='type41-356-kongo-twin', battery='main', position=[0, round(y + MAIN_DY, 3), rz(z)],
                            bearingDeg=bearing, rangefinder=rangefinder, magazineId='magazine-forward' if z < 0 else f'magazine-{id[-1]}', fire=FIRE_MAIN))
# Fourteen 15.2 cm casemates on the upper-deck ledge (reference HP_JGS rows; source bearings are the fore/aft rest).
# bearingDeg is the arc centre; traverseDeg narrows the catalog half-sector to the embrasure.
CASEMATES = [(9.498, -45.951, 55, 55), (10.405, -33.618, 80, 70), (11.091, -18.313, 85, 70), (11.4, -5.118, 95, 70),
             (11.312, 8.334, 100, 70), (10.866, 19.898, 115, 65), (9.404, 28.89, 125, 55)]
for side, sign in [('p', -1), ('s', 1)]:
    for i, (x, z, centre, half) in enumerate(CASEMATES, 1):
        b['mounts'].append(dict(id=f'casemate-{side}{i}', name=f'{"Port" if sign < 0 else "Starboard"} casemate {i} 15.2 cm', partId='type41-152-kongo-casemate',
                                battery='secondary', position=[round(sign * x, 3), 4.704, rz(z)], bearingDeg=sign * centre, traverseDeg=half, rangefinder=False,
                                magazineId='secondary-magazine-forward' if z < -10 else 'secondary-magazine-after', fire=FIRE_LIGHT))
HA = [('ha-1', -9.987, 7.409, -27.414, -90), ('ha-2', 9.981, 7.409, -27.414, 90), ('ha-3', -6.367, 8.792, -2.234, -90), ('ha-4', 6.368, 8.792, -2.234, 90)]
for id, x, y, z, bearing in HA:
    b['mounts'].append(dict(id=id, name=f'12.7 cm HA mount {id[-1]}', partId='type89-127-yamato-open-twin', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, traverseDeg=90, rangefinder=False, magazineId='ha-magazine', fire=FIRE_LIGHT))
AA25 = [(-8.539, 10.375, -18.948, -90), (8.543, 10.375, -18.948, 90), (-3.282, 15.81, -16.5, -90), (3.309, 15.81, -16.5, 90),
        (-3.45, 15.942, 1.796, -90), (3.45, 15.942, 1.796, 90)]
for i, (x, y, z, bearing) in enumerate(AA25, 1):
    b['mounts'].append(dict(id=f'aa25-{i}', name=f'25 mm twin {i}', partId='type96-25-mogami-2', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition', fire=FIRE_LIGHT))
AA13 = [('type93-13-twin', -1.914, 22.974, -35.085, 0), ('type93-13-twin', 1.914, 22.974, -35.085, 0), ('type93-13-twin', -3.789, 13.106, -34.216, -75),
        ('type93-13-twin', 3.775, 13.106, -34.216, 75), ('type93-13-single', -4.158, 22.419, -30.804, -45), ('type93-13-single', 4.145, 22.419, -30.804, 45)]
for i, (part, x, y, z, bearing) in enumerate(AA13, 1):
    b['mounts'].append(dict(id=f'mg13-{i}', name=f'13.2 mm {"twin" if part.endswith("twin") else "single"} {i}', partId=part, battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition', fire=FIRE_LIGHT))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    structures = json.loads(Path(opts.structures).read_text())
else:
    structures = previous['structures']
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
# CPU motion envelopes: main barrels (with the full recoil stroke) and gunhouses may not enter the
# prisms they can reach, and the superfiring forward pair may not cross. Game clearance, not
# verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
clear_mounts, reach = [], {}
for m in b['mounts']:
    if m['battery'] != 'main' and not m['id'].startswith('ha-'):
        continue
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(w['barrelBaseRadius'] * .75, 3))
    if m['battery'] == 'main':
        entry['body'] = dict(center=[0, 4.7, 1.27], size=[10.6 if m['rangefinder'] else 9.0, 2.6, 11.56])
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
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for the main and 12.7 cm mounts against the measured superstructure prisms they can reach, including the full recoil stroke, and between the superfiring forward turrets. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=[['main-1', 'main-2']])

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
room('magazine-forward', 'Forward 35.6 cm magazines', [0, -5.2, rz(-53.8)], [12, 6.4, 23], 'magazine', hp=260, fire=MAG)
room('magazine-3', 'No. 3 turret magazine', [0, -5.2, rz(24.3)], [14, 6.4, 11], 'magazine', hp=220, fire=MAG)
room('magazine-4', 'No. 4 turret magazine', [0, -5.2, rz(64.6)], [11, 6, 11], 'magazine', hp=220, fire=MAG)
room('secondary-magazine-forward', 'Forward 15.2 cm magazine', [0, -5.2, rz(-37.5)], [14, 6.4, 7], 'magazine', hp=150, fire=MAG)
room('secondary-magazine-after', 'After 15.2 cm magazine', [0, -5.2, rz(33.5)], [14, 6.4, 6], 'magazine', hp=150, fire=MAG)
room('ha-magazine', '12.7 cm and light AA magazine', [0, -1.8, rz(-15.5)], [10, 2.6, 6], 'magazine', hp=110, fire=MAG)
room('aa-ammunition', 'Light AA ready ammunition', [0, 2.4, rz(-9)], [8, 2.2, 6], 'magazine', hp=90, fire=MAG)
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -27.5, 14), ('boiler-room-2', 'No. 2 boiler room', -13.5, 14),
           ('boiler-room-3', 'No. 3 boiler room', 0.5, 14), ('boiler-room-4', 'No. 4 boiler room', 12.0, 9)]
for id, name, z, length in BOILERS:
    room(id, name, [0, -4.9, rz(z)], [21, 7.5, length], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -5.2, 36.5), ('engine-room-starboard-forward', 'Starboard forward engine room', 5.2, 36.5),
            ('engine-room-port-after', 'Port after engine room', -4.6, 49.5), ('engine-room-starboard-after', 'Starboard after engine room', 4.6, 49.5)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -5.2, rz(z)], [8.6 if abs(x) > 5 else 7.8, 6.8, 12], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -6.3, rz(76)], [10, 3.6, 20], fire=ENG)
SHAFTS = [('shaft-1', -4.2), ('shaft-2', -1.5), ('shaft-3', 1.5), ('shaft-4', 4.2)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[x, -6.6, rz(76)], size=[.7, 1.1, 18], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -2.4, rz(83)], [8.5, 3.2, 16], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four boiler rooms under the funnels and four turbine rooms between No. 3 and No. 4 turrets, one group per shaft with equal shares. Room bounds and routing are estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
CAS_P = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-p')]
CAS_S = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-s')]
HA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('ha-')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


director('main-director', 'Main battery director and 10 m rangefinder', [0, 32.87, -29.98], MAIN_IDS, [3.2, 2.6, 3.4], 80, 13)
director('after-director', 'After main battery director', [0, 16.75, 13.19], MAIN_IDS, [3.4, 2.4, 3.2], 60, 10)
director('secondary-director-port', 'Port secondary director', [-4.45, 23.96, -27.49], CAS_P, [2.2, 1.4, 4.2], 40, 6)
director('secondary-director-starboard', 'Starboard secondary director', [4.45, 23.96, -27.49], CAS_S, [2.2, 1.4, 4.2], 40, 6)
director('ha-director-port', 'Port Type 94 high-angle director', [-6.0, 15.26, -27.95], HA_IDS, [2.6, 2.6, 4.2], 45, 6)
director('ha-director-starboard', 'Starboard Type 94 high-angle director', [6.03, 15.26, -27.95], HA_IDS, [2.6, 2.6, 4.2], 45, 6)

# ---------------------------------------------------------------- protection (GameModels3D armour thicknesses)
def plate(id, name, vs, mm, exterior=False, note='Thickness from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pjsb007-armour', basis='inferred', note=note)))


def band(prefix, name, zref0, zref1, seg, y0, y1, mm, exterior, width):
    """Side plates between two heights on both sides; width(zref, y) gives the half breadth."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        for j in range(seg):
            za = zref0 + (zref1 - zref0) * j / seg
            zb = zref0 + (zref1 - zref0) * (j + 1) / seg
            vs = [[sign * width(za, y0), y0, rz(za)], [sign * width(zb, y0), y0, rz(zb)], [sign * width(zb, y1), y1, rz(zb)], [sign * width(za, y1), y1, rz(za)]]
            # The shell is curved, so each band is two planar triangles.
            plate(f'{prefix}-{side}-{j}-a', f'{side.title()} {name}', vs[:3], mm, exterior)
            plate(f'{prefix}-{side}-{j}-b', f'{side.title()} {name}', [vs[0], vs[2], vs[3]], mm, exterior)


CIT_FWD, CIT_AFT = -64.78, 70.38
# Main belt on the original shell inside the bulges, with its lower strake and the 102 mm lower side.
band('belt', 'main belt', CIT_FWD, CIT_AFT, 24, -2.54, 1.36, 203, True, lambda z, y: inner_breadth(z, y) * .998)
band('belt-lower-edge', 'belt lower edge', CIT_FWD, CIT_AFT, 24, -3.24, -2.54, 203, True, lambda z, y: inner_breadth(z, y) * .998)
band('lower-side', 'lower side armour', CIT_FWD, CIT_AFT, 24, -8.1, -3.24, 102, False, lambda z, y: inner_breadth(z, y) * .99)
# Upper belt over the casemate level: hull side to the ledge, then the casemate wall to the forecastle deck.
band('upper-belt', 'upper belt', -58.03, 30.46, 20, 1.40, 4.33, 152, True, lambda z, y: half_breadth(rz(z), y) * .998)
band('casemate-wall', 'casemate armour', -44.0, 30.46, 20, 4.40, 6.58, 152, True, lambda z, y: half_breadth(rz(z), 5.5) * .998)
band('bow-belt', 'forward belt', -106.0, CIT_FWD, 12, -2.54, 1.36, 76, True, lambda z, y: half_breadth(rz(z), y) * .996)
band('stern-belt', 'after belt', CIT_AFT, 93.05, 6, -2.54, 1.36, 76, True, lambda z, y: half_breadth(rz(z), y) * .996)
for j in range(24):
    za = CIT_FWD + (CIT_AFT - CIT_FWD) * j / 24
    zb = CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / 24
    wa, wb = inner_breadth(za, 0) * .82, inner_breadth(zb, 0) * .82
    plate(f'armoured-deck-{j}', 'Armoured deck', [[-wa, 0.01, rz(za)], [wa, 0.01, rz(za)], [wb, 0.01, rz(zb)], [-wb, 0.01, rz(zb)]], 120)
    for side, sign in [('port', -1), ('starboard', 1)]:
        ia, ib = inner_breadth(za, -2.54) * .99, inner_breadth(zb, -2.54) * .99
        vs = [[sign * wa, 0.01, rz(za)], [sign * wb, 0.01, rz(zb)], [sign * ib, -2.54, rz(zb)], [sign * ia, -2.54, rz(za)]]
        plate(f'deck-slope-{side}-{j}-a', f'{side.title()} armoured deck slope', vs[:3], 110)
        plate(f'deck-slope-{side}-{j}-b', f'{side.title()} armoured deck slope', [vs[0], vs[2], vs[3]], 110)
    ma, mb = inner_breadth(za, 1.36) * .97, inner_breadth(zb, 1.36) * .97
    plate(f'middle-deck-{j}', 'Middle deck', [[-ma, 1.36, rz(za)], [ma, 1.36, rz(za)], [mb, 1.36, rz(zb)], [-mb, 1.36, rz(zb)]], 38)
for j in range(16):
    za = -61.27 + (35.56 + 61.27) * j / 16
    zb = -61.27 + (35.56 + 61.27) * (j + 1) / 16
    ua, ub = half_breadth(rz(za), 4.3) * .97, half_breadth(rz(zb), 4.3) * .97
    plate(f'upper-deck-{j}', 'Upper deck over the casemates', [[-ua, 4.36, rz(za)], [ua, 4.36, rz(za)], [ub, 4.36, rz(zb)], [-ub, 4.36, rz(zb)]], 38)
for end, z, mm, top in [('forward', CIT_FWD, 127, 0.01), ('after', CIT_AFT, 203, 0.01)]:
    w = inner_breadth(z, 0) * .98
    wl = inner_breadth(z, -8.1) * .98
    plate('citadel-' + end, end.title() + ' armoured bulkhead', [[-wl, -8.1, rz(z)], [wl, -8.1, rz(z)], [w, top, rz(z)], [-w, top, rz(z)]], mm)
    wu = inner_breadth(z, 1.36) * .98
    plate('citadel-' + end + '-upper', end.title() + ' belt bulkhead', [[-w, top, rz(z)], [w, top, rz(z)], [wu, 1.36, rz(z)], [-wu, 1.36, rz(z)]], 127 if end == 'forward' else 203)
for end, z in [('forward', -61.27), ('after', 32.2)]:
    w = half_breadth(rz(z), 4.3) * .97
    plate(f'casemate-bulkhead-{end}', f'{end.title()} casemate bulkhead', [[-w, 1.36, rz(z)], [w, 1.36, rz(z)], [w, 6.6, rz(z)], [-w, 6.6, rz(z)]], 152)
for m in b['mounts'][:4]:
    r = 4.68
    x, _, z = m['position']
    top = m['position'][1] - MAIN_DY
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[r * math.cos(a), 1.36, z + r * math.sin(a)], [r * math.cos(c), 1.36, z + r * math.sin(c)], [r * math.cos(c), top, z + r * math.sin(c)], [r * math.cos(a), top, z + r * math.sin(a)]], 229)
# Conning tower (reference ss_bridge plates) and the steering-gear box.
ct = dict(x0=-2.47, x1=2.57, y0=12.89, y1=15.26, z0=rz(-40.89), z1=rz(-36.71))
for id, vs, mm in [('ct-port', [[ct['x0'], ct['y0'], ct['z0']], [ct['x0'], ct['y0'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z0']]], 254),
                   ('ct-starboard', [[ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x1'], ct['y1'], ct['z0']]], 254),
                   ('ct-front', [[ct['x0'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x0'], ct['y1'], ct['z0']]], 254),
                   ('ct-back', [[ct['x0'], ct['y0'], ct['z1']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 254),
                   ('ct-roof', [[ct['x0'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 127)]:
    plate(id, 'Conning tower', vs, mm, True)
sg = dict(x=5.9, y0=-4.16, y1=-.68, z0=rz(70.38), z1=rz(93.05))
for id, vs, mm in [('steering-port', [[-sg['x'], sg['y0'], sg['z0']], [-sg['x'], sg['y0'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z0']]], 25),
                   ('steering-starboard', [[sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [sg['x'], sg['y1'], sg['z0']]], 25),
                   ('steering-after', [[-3.87, -4.16, sg['z1']], [3.87, -4.16, sg['z1']], [3.87, 1.36, sg['z1']], [-3.87, 1.36, sg['z1']]], 127),
                   ('steering-roof', [[-sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 89)]:
    plate(id, 'Steering-gear protection', vs, mm)
b['underwaterProtection'] = dict(version=1, basis='Estimated anti-torpedo bulge and side-protection system outside the belt; reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'bulge-{side}', name=f'{side.title()} anti-torpedo bulge', center=[sign * 12.6, -4.6, rz(2.8)],
                                             size=[3.4, 7.6, 108], damageReduction=.4, breachReduction=.4) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='ijn', position=[0, round(deck_y(rz(109.2)) + 5.6, 3), rz(109.2)], width=4.0, staffHeight=5.6)],
                radars=[dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=40),
                        dict(id='after-director', nodeId='after-director.yaw', rpm=2, sweepDeg=55, phaseDeg=160)])
b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=320, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.09, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Provisional battleship crew and finite-stores calibration; not historical manning or damage-control performance.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
write(HERE / 'blueprint.json', b)
print(f'Authored kongo: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-flood-spaces, author-stability, author-local-damage, author-damage-control.')

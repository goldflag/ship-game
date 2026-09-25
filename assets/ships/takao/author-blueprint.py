"""Original IJN Takao blueprint authoring (1944 fit), GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and
rebuilds everything except the measured hull stations and superstructure blocks, which it
keeps from the current blueprint unless fresh measurement files are passed:

  python3 assets/ships/takao/author-blueprint.py [--loft loft.json] [--structures a.json,b.json]

The measurement files are produced in ignored .build/takao/ from the cached
`bun run ship:reference pjsc708` view (ARP Takao's default configuration, the Takao-class
1944 hull `jsc038_atago_1944`): station outlines of the hull shell and its bulges sampled by
arc length from the keel to the weather-deck edge (bilge keels, shafts, rudder and the
shelter deck left out), and superstructure blocks traced from plan cuts every 0.1 m,
followed up through the levels into prisms or, where the walls taper, lofted blocks. They
hold our own sampled offsets, never source triangles. Mount datums come from the reference
hardpoints, armour zones and thicknesses from its armour model; both are provisional game
calibration, not a historical survey. Run afterwards: author-local-damage (new ship only),
author-flood-spaces, author-stability and author-damage-control, always passing `takao`.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = 1.4895          # reference z of the hull's mid-length; runtime z = reference z - ZC
L = 203.955          # stem head to the stern's after end at the reference waterline datum
DRAFT = 7.14         # keel below the reference waterline
DEPTH = 10.97        # keel to the midships weather deck
SPEED_KN = 34.25


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
    sections = [{'station': round(s['station'], 4), 'points': [[round(w, 4), round(y, 4)] for w, y in s['points']]}
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
    """Weather-deck height at runtime z (bow negative)."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='takao', name='Takao',
         configuration='Takao · 1944 exterior after the GameModels3D pjsc708 default fit (Takao-class 1944 hull) · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/takao.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=5, acceleration=.2, braking=.18, rudderRate=.42, maxYawRate=.022),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 17.4, rz(-24.4)]),
         structuralPlating=dict(hullMm=25, superstructureMm=16, note='Hull and superstructure plating read from the approved GameModels3D armour model (25 mm constructional hull, 16 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure blocks measured from the approved GameModels3D pjsc708 default configuration (Takao-class 1944 hull jsc038_atago_1944) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Ten 20.3 cm/50 in five twin Model E turrets, eight 12.7 cm/40 Type 89 in four open twin mounts, 25 mm Type 96 in six triple, six twin and thirty single mounts, and sixteen 610 mm tubes in four trainable quadruple mounts at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference datums)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# Five twin 20.3 cm Model E turrets: Nos. 2 and 4 carry the roof rangefinder, No. 3 faces aft.
MAIN = [('main-1', 'No. 1 turret', 5.012, -58.666, 0, False), ('main-2', 'No. 2 turret', 7.579, -50.263, 0, True),
        ('main-3', 'No. 3 turret', 4.781, -41.747, 180, False), ('main-4', 'No. 4 turret', 7.542, 51.021, 180, True),
        ('main-5', 'No. 5 turret', 4.703, 59.556, 180, False)]
for id, name, y, z, bearing, rangefinder in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 20.3 cm', partId='type3-203-furutaka-twin-rf' if rangefinder else 'type3-203-furutaka-twin',
                            battery='main', position=[0, y, rz(z)], bearingDeg=bearing, rangefinder=rangefinder,
                            magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE_MAIN))
# No. 3 turret stows trained aft with its muzzles 0.7 m short of the bridge front at the horizontal;
# it rests elevated so the barrels clear the bridge face (game rest pose, not a documented stowage).
b['mounts'][2]['initialElevationDeg'] = 25
# Four open twin 12.7 cm Type 89 on the shelter-deck sponsons; bearing is the centre of the beam arc.
HA = [('ha-1', -7.501, 6.324, -10.045, -90), ('ha-2', 7.502, 6.324, -10.045, 90), ('ha-3', -7.443, 6.324, 10.868, -90), ('ha-4', 7.443, 6.324, 10.868, 90)]
for id, x, y, z, bearing in HA:
    b['mounts'].append(dict(id=id, name=f'12.7 cm HA mount {id[-1]}', partId='type89-127-a1-twin', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='ha-magazine', fire=FIRE_LIGHT))
# 25 mm Type 96: reference HP_JGA datums (x, y, z, bearing) by mounting.
AA3 = [(-7.456, 7.98, 5.055, -90), (7.457, 7.98, 5.055, 90), (-4.029, 10.151, 14.397, -90), (4.029, 10.151, 14.397, 90),
       (-3.106, 3.192, 85.88, 180), (3.125, 3.192, 85.88, 180)]
AA2 = [(-5.143, 11.706, -28.02, -90), (5.143, 11.706, -28.02, 90), (-5.686, 10.583, -7.932, -90), (5.687, 10.583, -7.932, 90),
       (-4.834, 10.586, 6.563, -90), (4.834, 10.586, 6.563, 90)]
AA1 = [(-4.131, 4.505, -73.239, -15), (4.131, 4.505, -73.239, 15), (-4.842, 4.382, -70.747, -35), (4.842, 4.382, -70.747, 35),
       (-4.096, 4.269, -68.272, -45), (4.097, 4.269, -68.272, 45), (-5.607, 3.884, -32.793, -45), (5.607, 3.884, -32.793, 45),
       (-6.874, 3.878, -30.945, -45), (6.874, 3.878, -30.945, 45), (-7.761, 3.866, -28.558, -45), (7.761, 3.866, -28.558, 45),
       (-9.48, 6.17, -0.846, -90), (9.48, 6.17, -0.846, 90), (-7.0, 8.009, 1.508, -90), (7.001, 8.009, 1.508, 90),
       (-9.48, 6.174, 6.555, -90), (9.48, 6.174, 6.555, 90), (-7.796, 6.17, 16.586, -90), (7.796, 6.17, 16.586, 90),
       (-4.425, 6.129, 41.519, -90), (4.425, 6.129, 41.519, 90), (-7.9, 3.852, 43.901, -90), (7.9, 3.852, 43.901, 90),
       (-5.56, 3.797, 67.949, -150), (5.56, 3.797, 67.949, 150), (-5.136, 3.766, 71.619, -165), (5.136, 3.766, 71.619, 165),
       (-2.403, 3.089, 90.794, -170), (2.405, 3.089, 90.794, 170)]
for kind, part, rows, label in [('aa3', 'type96-25-triple', AA3, 'triple'), ('aa2', 'type96-25-mogami-2', AA2, 'twin'), ('aa1', 'type96-25-kongo-single', AA1, 'single')]:
    for i, (x, y, z, bearing) in enumerate(rows, 1):
        # The after triples stand in shallow wells the loft cannot cut: they sit on the deck instead.
        y = max(y, round(deck_y(rz(z)) + .02, 3)) if abs(x) < half_breadth(rz(z), deck_y(rz(z)) - .05) else y
        b['mounts'].append(dict(id=f'{kind}-{i}', name=f'25 mm {label} {i}', partId=part, battery='secondary', position=[x, y, rz(z)],
                                bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after',
                                fire=FIRE_LIGHT))

# ---------------------------------------------------------------- torpedo mounts
# Four trainable quadruple 610 mm mounts on the upper deck under the shelter deck, training out
# through the side openings: pivots and muzzle datums from the reference (HP_JGT and its gunFire
# points, 0.75 m apart and 3.58 m from the pivot along the tubes). Trainable tubes are authored at
# zero train, so the after pair rests trained forward like the forward pair; the reference stows
# it trained aft.
TORPEDO = [('torpedo-1', -7.5, -12.693, 0, -1), ('torpedo-2', 7.5, -12.693, 0, 1), ('torpedo-3', -7.5, 4.424, 180, -1), ('torpedo-4', 7.5, 4.424, 180, 1)]
b['torpedoLaunchers'] = []
b['torpedoTubes'] = []
for id, x, z, rest, side in TORPEDO:
    arc = [[40, 140]] if side > 0 else [[-140, -40]]
    b['torpedoLaunchers'].append(dict(id=id, name=f'Quadruple 610 mm mount {id[-1]}', position=[x, 4.221, rz(z)], traverseRateDeg=8, launchArcsDeg=arc))
    for k, dx in enumerate([-1.125, -.375, .375, 1.125], 1):
        b['torpedoTubes'].append(dict(id=f'{id}-tube-{k}', name=f'Mount {id[-1]} tube {k}', partId='ijn-610-type93-game',
                                      position=[round(x + dx, 3), 4.663, rz(z - 3.579)], bearingDeg=0, arcDeg=2, ammo=1,
                                      magazineId='torpedo-magazine', launcherId=id, launcherModuleId=f'{id}-equipment'))
    b['modules'].append(dict(id=f'{id}-equipment', name=f'Torpedo mount {id[-1]}', kind='launcher', placement='fixed', torpedoLauncherId=id,
                             center=[x, 4.72, rz(z)], size=[3.4, 1.1, 8.4], hp=90, protectionMm=6))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    measured = [s for path in opts.structures.split(',') for s in json.loads(Path(path).read_text())['structures']]
    structures = []
    for s in measured:
        entry = dict(id=s['id'], name=s.get('name') or f"{'Deckhouse' if s['height'] >= .6 else 'Platform'} {s['baseY']:.1f}-{s['baseY'] + s['height']:.1f} m",
                     footprint=s['footprint'], baseY=s['baseY'], height=s['height'], material='naval')
        if s.get('surface'):
            entry['surface'] = s['surface']
        if s.get('exhaust'):
            entry['exhaust'] = s['exhaust']
        structures.append(entry)
    # Names by region; the top block of each funnel carries its exhaust (the smoke's mouth).
    NAMES = {'bridge-base': 'Bridge base', 'bridge': 'Bridge tier', 'forward-funnel': 'Forward funnel', 'after-funnel': 'After funnel',
             'midships': 'Midships deckhouse', 'aft': 'After deckhouse', 'compass-bridge': 'Compass bridge', 'upper-bridge': 'Upper bridge'}
    for s in structures:
        prefix = s['id'].rsplit('-', 1)[0]
        if prefix in NAMES:
            s['name'] = f"{NAMES[prefix]} {s['baseY']:.1f}-{s['baseY'] + s['height']:.1f} m"
    for prefix in ['forward-funnel', 'after-funnel']:
        tops = [s for s in structures if s['id'].startswith(prefix + '-')]
        top = max(tops, key=lambda s: s['baseY'] + s['height'])
        if top.get('surface'):
            vs = top['surface']['vertices']
            y1 = max(v[1] for v in vs)
            ring = [v for v in vs if abs(v[1] - y1) < 1e-6]
        else:
            y1 = top['baseY'] + top['height']
            ring = [[x, y1, z] for x, z in top['footprint']]
        xs, zs = [v[0] for v in ring], [v[2] for v in ring]
        top['exhaust'] = dict(position=[0, round(y1, 3), round((min(zs) + max(zs)) / 2, 3)], width=round(max(xs) - min(xs), 3), length=round(max(zs) - min(zs), 3))
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

# Stowed boats and the catapults' girders: barrels stop at them and cannot fire through them.
BOATS = [('cutter', (6.12, 8.46), (6.27, 7.8), (-22.3, -13.2)), ('motor-boat', (2.0, 5.0), (4.1, 6.9), (18.4, 29.6)),
         ('catapult', (9.2, 10.45), (6.4, 7.95), (14.8, 34.3))]
for name, (x0, x1), (y0, y1), (z0, z1) in BOATS:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))
b['obstructions'].append(dict(id='motor-launch', center=[0, 5.0, rz(22.66)], size=[2.8, 1.8, 12.2]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: the main and 12.7 cm barrels (with the full recoil stroke) and gunhouses
# may not enter the blocks they can reach, and neighbouring turrets may not cross. Game clearance,
# not verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
# Rotating carriages of the open mounts in the yaw frame (x across, y up, z aft): the 12.7 cm A1
# twin's cradle, seats and shield frame, and the 25 mm triples', twins' and singles' pedestals,
# seats and magazines, all behind their trunnions.
BODIES = {'type89-127-a1-twin': dict(center=[0, 1.2, .35], size=[2.9, 2.4, 2.6]),
          'type96-25-triple': dict(center=[0, .95, .3], size=[2.0, 1.9, 1.7]),
          'type96-25-mogami-2': dict(center=[0, .95, .25], size=[1.7, 1.9, 1.6]),
          'type96-25-kongo-single': dict(center=[0, .9, .25], size=[.8, 1.8, 1.2])}
clear_mounts, reach = [], {}
for m in b['mounts']:
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(max(w['barrelBaseRadius'] * .85, .05), 3))
    if m['battery'] == 'main':
        # Model E gunhouse in the yaw frame: 8.28 m long from 2.91 m ahead of the pivot, 6.0 m wide
        # (6.9 m across the rangefinder ends), roof and perimeter rail to 2.9 m.
        entry['body'] = dict(center=[0, 1.47, 1.23], size=[6.9 if m['rangefinder'] else 6.1, 2.86, 8.3])
    else:
        entry['body'] = BODIES[m['partId']]
    clear_mounts.append(entry)
    reach[m['id']] = (m['position'], w['muzzleForward'] + 1.0, m['position'][1] + w['pivotHeight'])
# Neighbouring mounts whose working circles overlap at similar heights interlock against each other.
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
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for every mount (20.3 cm, 12.7 cm and 25 mm) against the measured superstructure blocks they can reach, including the full recoil stroke, and between neighbouring mounts whose working circles overlap. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=neighbors)

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
# Magazines inside the armoured boxes the reference's armour model draws (forward z -56.5 to -35.8,
# after z 46.8 to 62.2, both under the 47 mm deck at y -0.29).
room('magazine-forward', 'Forward 20.3 cm magazines', [0, -3.6, rz(-46.2)], [10.5, 5.8, 20], 'magazine', hp=220, fire=MAG)
room('magazine-after', 'After 20.3 cm magazines', [0, -3.6, rz(54.5)], [12.5, 5.8, 15], 'magazine', hp=200, fire=MAG)
room('ha-magazine', '12.7 cm magazine', [0, -3.4, rz(-31.5)], [11, 5.2, 7], 'magazine', hp=110, fire=MAG)
room('torpedo-magazine', 'Torpedo room reserve', [0, 5.0, rz(-3.5)], [5.8, 1.6, 30], 'magazine', hp=90, fire=MAG)
room('aa-ammunition-forward', 'Forward light AA ready ammunition', [0, 1.9, rz(-36.5)], [7, 2.2, 5], 'magazine', hp=80, fire=MAG)
room('aa-ammunition-after', 'After light AA ready ammunition', [0, 1.9, rz(38.5)], [7, 2.2, 6], 'magazine', hp=80, fire=MAG)
# Machinery between the magazines: three boiler rooms under the funnels, then the engine rooms.
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -28.0, 14), ('boiler-room-2', 'No. 2 boiler room', -13.5, 14), ('boiler-room-3', 'No. 3 boiler room', 1.0, 14)]
for id, name, z, length in BOILERS:
    room(id, name, [0, -3.0, rz(z)], [14.5, 6.6, length], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -3.8, 15.0), ('engine-room-starboard-forward', 'Starboard forward engine room', 3.8, 15.0),
            ('engine-room-port-after', 'Port after engine room', -3.8, 30.0), ('engine-room-starboard-after', 'Starboard after engine room', 3.8, 30.0)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -3.0, rz(z)], [7.4, 6.6, 14], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -4.8, rz(68.5)], [10, 3.6, 12], fire=ENG)
SHAFTS = [('shaft-1', -7.1), ('shaft-2', -3.5), ('shaft-3', 3.5), ('shaft-4', 7.1)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[x * .6, -5.2, rz(68.5)],
                             size=[.7, 1.1, 10], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -.4, rz(90)], [4, 3.0, 11], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-2', 'boiler-room-3'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: three boiler rooms under the funnels and four turbine rooms aft of them, one group per shaft with equal shares. Room bounds and routing are game estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
HA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('ha-')]
AA_PORT = [m['id'] for m in b['mounts'] if m['id'].startswith('aa') and m['position'][0] < 0]
AA_STBD = [m['id'] for m in b['mounts'] if m['id'].startswith('aa') and m['position'][0] >= 0]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_JD): Type 94 main directors forward and aft, Type 91 high-angle
# directors on the bridge wings, Type 95 25 mm directors abreast the forward funnel.
director('main-director', 'Type 94 main battery director', [0, 21.06, -23.10], MAIN_IDS, [3.0, 2.2, 3.0], 80, 13)
director('after-director', 'After Type 94 director', [0, 12.50, 14.35], MAIN_IDS, [2.8, 2.2, 2.8], 60, 10)
director('ha-director-port', 'Port Type 91 high-angle director', [-6.06, 12.71, -22.10], HA_IDS, [2.2, 2.2, 2.4], 45, 6)
director('ha-director-starboard', 'Starboard Type 91 high-angle director', [6.06, 12.71, -22.10], HA_IDS, [2.2, 2.2, 2.4], 45, 6)
director('aa-director-port', 'Port Type 95 25 mm director', [-3.62, 11.17, -0.79], AA_PORT, [1.4, 1.6, 1.4], 30, 4)
director('aa-director-starboard', 'Starboard Type 95 25 mm director', [3.62, 11.17, -0.79], AA_STBD, [1.4, 1.6, 1.4], 30, 4)

# ---------------------------------------------------------------- protection (GameModels3D armour model)
def plate(id, name, vs, mm, exterior=False, note='Thickness and zone from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pjsc708-armour', basis='inferred', note=note)))


def quad(prefix, name, a, b_, c, d, mm, exterior=False):
    """Two planar triangles over a possibly twisted quad, mirrored to port."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        m = lambda v: [sign * v[0], v[1], rz(v[2])]
        plate(f'{prefix}-{side}-a', f'{side.title()} {name}', [m(a), m(b_), m(c)], mm, exterior)
        plate(f'{prefix}-{side}-b', f'{side.title()} {name}', [m(a), m(c), m(d)], mm, exterior)


# Citadel belt on the inner shell behind the bulges, as (reference z, x at y -2.52, x at the top).
# Machinery: 102 mm from y -2.52 to 1.52; magazines: 127 mm from y -2.52 to -0.29.
BELT_M = [(-35.75, 6.88, 7.71), (-32.09, 7.02, 7.95), (-18.56, 7.85, 8.83), (3.06, 8.24, 9.20), (21.64, 8.50, 9.36), (31.17, 8.40, 9.24), (46.80, 8.08, 8.79)]
for j, ((za, ba, ta), (zb, bb, tb)) in enumerate(zip(BELT_M, BELT_M[1:])):
    quad(f'belt-{j}', 'main belt', (ba, -2.52, za), (bb, -2.52, zb), (tb, 1.52, zb), (ta, 1.52, za), 102)
for j, (za, zb, ba, bb, ta, tb) in enumerate([(-56.52, -35.75, 4.96, 6.88, 5.47, 7.41), (46.80, 62.17, 8.08, 7.52, 8.56, 7.78)]):
    quad(f'magazine-belt-{j}', 'magazine belt', (ba, -2.52, za), (bb, -2.52, zb), (tb, -.29, zb), (ta, -.29, za), 127)
# Lower citadel side down to the bottom of the bulge: 58 mm under the machinery belt, 38 mm at the magazines.
LOWER_M = [(-35.75, 5.72, 5.14), (-32.09, 5.90, 5.48), (-18.56, 6.57, 6.74), (3.06, 7.61, 7.36), (21.64, 7.40, 7.23), (31.17, 7.02, 7.02), (46.80, 6.53, 5.26)]
for j, ((za, ma, la), (zb, mb, lb)) in enumerate(zip(LOWER_M, LOWER_M[1:])):
    ba, bb = BELT_M[j][1], BELT_M[j + 1][1]
    quad(f'lower-side-{j}', 'lower citadel side', (ma, -3.14, za), (mb, -3.14, zb), (bb, -2.52, zb), (ba, -2.52, za), 58)
    quad(f'lower-side-{j}-low', 'lower citadel side', (la, -6.10, za), (lb, -6.10, zb), (mb, -3.14, zb), (ma, -3.14, za), 58)
quad('magazine-side-fwd', 'magazine side', (2.99, -6.15, -56.52), (5.14, -6.10, -35.75), (6.88, -2.52, -35.75), (4.96, -2.52, -56.52), 38)
quad('magazine-side-aft', 'magazine side', (5.26, -6.10, 46.80), (3.14, -6.10, 62.17), (7.52, -2.52, 62.17), (8.08, -2.52, 46.80), 38)
# Citadel decks: 35 mm over the machinery at y 1.52, 47 mm over the magazines at y -0.29.
for j, ((za, _, ta), (zb, _, tb)) in enumerate(zip(BELT_M, BELT_M[1:])):
    plate(f'citadel-deck-{j}', 'Citadel deck', [[-ta, 1.52, rz(za)], [ta, 1.52, rz(za)], [tb, 1.52, rz(zb)], [-tb, 1.52, rz(zb)]], 35)
for j, (za, zb, ta, tb) in enumerate([(-56.52, -35.75, 5.47, 7.41), (46.80, 62.17, 8.56, 7.78)]):
    plate(f'magazine-deck-{j}', 'Magazine deck', [[-ta, -.29, rz(za)], [ta, -.29, rz(za)], [tb, -.29, rz(zb)], [-tb, -.29, rz(zb)]], 47)
# Transverse bulkheads.
for id, name, z, x0, x1, y0, y1, mm in [('bulkhead-forward-magazine', 'Forward magazine bulkhead', -56.52, 3.74, 5.47, -7.14, -.29, 76),
                                          ('bulkhead-forward-machinery', 'Forward machinery bulkhead', -35.75, 7.01, 7.71, -6.10, 1.52, 63),
                                          ('bulkhead-after-machinery', 'After machinery bulkhead', 46.80, 8.34, 8.79, -6.10, 1.52, 89),
                                          ('bulkhead-after-magazine', 'After magazine bulkhead', 62.17, 7.78, 7.78, -7.14, -.29, 76)]:
    plate(id, name, [[-x0, y0, rz(z)], [x0, y0, rz(z)], [x1, y1, rz(z)], [-x1, y1, rz(z)]], mm)
# Upper side (27 mm) from the belt to the weather deck, and the bulge's outer plating (27 mm), both on the loft.


def band(prefix, name, z0, z1, seg, y0, y1, mm):
    for j in range(seg):
        za = z0 + (z1 - z0) * j / seg
        zb = z0 + (z1 - z0) * (j + 1) / seg
        ya0, ya1 = y0(za) if callable(y0) else y0, y1(za) if callable(y1) else y1
        yb0, yb1 = y0(zb) if callable(y0) else y0, y1(zb) if callable(y1) else y1
        quad(f'{prefix}-{j}', name, (half_breadth(rz(za), ya0) * .998, ya0, za), (half_breadth(rz(zb), yb0) * .998, yb0, zb),
             (half_breadth(rz(zb), yb1) * .998, yb1, zb), (half_breadth(rz(za), ya1) * .998, ya1, za), mm, True)


band('upper-side', 'upper side plating', -58.68, 62.17, 24, -.29, lambda z: deck_y(rz(z)) - .02, 27)
band('bulge', 'bulge plating', -62.0, 70.0, 22, -5.9, -.35, 27)
# Weather deck over the citadel (the model's 41 mm casemate deck), in strips that follow the deck line.
for j in range(24):
    za = -58.68 + (62.17 + 58.68) * j / 24
    zb = -58.68 + (62.17 + 58.68) * (j + 1) / 24
    ya, yb = deck_y(rz(za)) - .01, deck_y(rz(zb)) - .01
    wa, wb = half_breadth(rz(za), ya - .05) * .98, half_breadth(rz(zb), yb - .05) * .98
    plate(f'weather-deck-{j}', 'Weather deck', [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], 41)
# Barbettes: 76 mm above the weather deck, 25 mm below it down to the citadel deck.
for m in b['mounts'][:5]:
    x, top, z = m['position']
    floor = deck_y(z) - .02
    low = 1.52 if -35.75 - ZC < z < 46.8 - ZC else -.29
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[2.97 * math.cos(a), floor, z + 2.97 * math.sin(a)], [2.97 * math.cos(c), floor, z + 2.97 * math.sin(c)],
               [2.97 * math.cos(c), top, z + 2.97 * math.sin(c)], [2.97 * math.cos(a), top, z + 2.97 * math.sin(a)]], 76)
        if i % 2 == 0:
            a2 = (i + 2) * math.tau / 24
            plate(f"{m['id']}-barbette-lower-{i // 2}", m['name'] + ' lower barbette',
                  [[2.49 * math.cos(a), low, z + 2.49 * math.sin(a)], [2.49 * math.cos(a2), low, z + 2.49 * math.sin(a2)],
                   [2.49 * math.cos(a2), floor, z + 2.49 * math.sin(a2)], [2.49 * math.cos(a), floor, z + 2.49 * math.sin(a)]], 25)
# Steering gear box.
for id, vs, mm in [('steering-port', [[-2.09, -2.03, rz(84.41)], [-2.09, -2.03, rz(95.67)], [-2.09, 1.05, rz(95.67)], [-2.09, 1.05, rz(84.41)]], 51),
                   ('steering-starboard', [[2.09, -2.03, rz(84.41)], [2.09, -2.03, rz(95.67)], [2.09, 1.05, rz(95.67)], [2.09, 1.05, rz(84.41)]], 51),
                   ('steering-forward', [[-2.09, -2.03, rz(84.41)], [2.09, -2.03, rz(84.41)], [2.09, 1.24, rz(84.41)], [-2.09, 1.24, rz(84.41)]], 38),
                   ('steering-after', [[-1.17, -2.03, rz(95.67)], [1.17, -2.03, rz(95.67)], [1.17, .7, rz(95.67)], [-1.17, .7, rz(95.67)]], 38),
                   ('steering-roof', [[-2.09, 1.05, rz(84.41)], [2.09, 1.05, rz(84.41)], [2.09, 1.05, rz(95.67)], [-2.09, 1.05, rz(95.67)]], 25)]:
    plate(id, 'Steering-gear protection', vs, mm)
b['underwaterProtection'] = dict(version=1, basis='Estimated anti-torpedo bulge and lower citadel side outside the machinery; reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'bulge-{side}', name=f'{side.title()} anti-torpedo bulge', center=[sign * 8.6, -3.3, rz(3.0)],
                                             size=[2.6, 5.6, 100], damageReduction=.3, breachReduction=.3) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (reference HP_flag_nation); the Type 21 air-search
# aerial on the foremast top and both Type 94 directors turn.
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='ijn', position=[0, 31.2, rz(46.64)], width=3.2, staffHeight=0)],
                radars=[dict(id='type21-radar', nodeId='type21-radar.yaw', rpm=4),
                        dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=40),
                        dict(id='after-director', nodeId='after-director.yaw', rpm=2, sweepDeg=55, phaseDeg=160)])
b['damageControl'] = dict(version=1, teams=3, setupSeconds=8, repairPoints=240, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.08, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Placeholder; author-damage-control.ts writes the shared fleet defaults.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
# The gameplay helpers rewrite localDamage, the flood spaces and partitions, stability and
# damageControl from these rooms; rerun all four after this script (see the README).
write(HERE / 'blueprint.json', b)
print(f'Authored takao: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-local-damage, author-flood-spaces, author-stability, author-damage-control.')

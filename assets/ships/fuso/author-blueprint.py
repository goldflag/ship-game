"""Original IJN Fusō 1943 blueprint authoring, GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was
first made and can rebuild everything except the measured hull stations and
superstructure prisms, which it keeps from the current blueprint unless fresh
measurement files are passed:

  python3 assets/ships/fuso/author-blueprint.py [--loft loft.json] [--structures superstructure.json]

The measurement files are produced in ignored .build/fuso/ from the cached
`bun run ship:reference pjsb006 --hull B_Hull` view: station outlines as the
starboard envelope of every hull crossing (keel, flat bottom, bulge, casemate
ledge, forecastle wall and deck, cut with the HullSlicer behind ship:lines), and
superstructure prisms grouped from plan cuts every 5 cm (the planPolygons behind
ship:slice --plan, mirrored). They hold our own sampled offsets, never source
triangles. Mount datums come from the reference's HP_ nodes (ship:hardpoints);
armour zones and plate thicknesses from the reference's armour model; both are
provisional game calibration, not a historical survey. Run afterwards:
author-local-damage.ts (new ship only), author-flood-spaces.ts,
author-stability.ts and author-damage-control.ts fuso.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = -1.095          # reference z of the hull's mid-length; runtime z = reference z - ZC
L = 212.526          # stem head to the stern at the reference waterline datum
DRAFT = 9.684        # the flat bottom below the reference y = 0 design waterline
DEPTH = 16.353       # keel to the midships forecastle deck (6.669 m)
LEDGE = 4.055        # upper deck: the casemate ledge and the quarterdeck
FORECASTLE = 6.669


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


def rz(z):
    """Reference z -> runtime z."""
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
    """Deck at side at runtime z."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    """Loft half-breadth at runtime z and height y."""
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='fuso', name='IJN Fusō',
         configuration='Fusō · 1943 exterior after the GameModels3D pjsb006 B hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/fuso.glb', hull=hull,
         handling=dict(forwardSpeed=round(24.7 * .5144444, 4), reverseSpeed=4, acceleration=.16, braking=.22, rudderRate=.3, maxYawRate=.022),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 29.2, rz(-31.8)]),
         structuralPlating=dict(hullMm=26, superstructureMm=16, note='Hull, bulge and deckhouse plating thicknesses read from the approved GameModels3D armour model (26 mm constructional plating, 16 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure prisms measured from the approved GameModels3D pjsb006 B hull (jsb006_fuso_1943) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Twelve 35.6 cm/45 Type 41 in six twin turrets, fourteen 15.2 cm/50 Type 41 casemates, eight 12.7 cm/40 Type 89 in four open twin mounts and thirty-seven 25 mm Type 96 (ten twin, seventeen single) at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference datums)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# The Kongō turret recipe carries its yaw datum 3.326 m below the gunhouse floor, where the reference's HP_JGM
# nodes sit; the gunhouse, roof slope and barrel reach of the 1942 variant match the reference's jgm006/jgm007
# within 0.4 m (its after end is pointed where Fusō's is rounded). jgm007 carries the roof rangefinder.
MAIN_DY = -3.326
MAIN = [('main-1', 'No. 1 turret', (8.092, -58.988), 0, False), ('main-2', 'No. 2 turret', (11.229, -45.564), 0, True),
        ('main-3', 'No. 3 turret', (7.851, -8.898), 0, True), ('main-4', 'No. 4 turret', (10.04, 22.146), 180, True),
        ('main-5', 'No. 5 turret', (7.884, 51.341), 180, True), ('main-6', 'No. 6 turret', (4.974, 65.157), 180, False)]
MAGAZINE_OF = {'main-1': 'magazine-forward', 'main-2': 'magazine-forward', 'main-3': 'magazine-3', 'main-4': 'magazine-4',
               'main-5': 'magazine-after', 'main-6': 'magazine-after'}
for id, name, (y, z), bearing, rangefinder in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 35.6 cm', partId='type41-356-kongo-1942-twin', battery='main', position=[0, round(y + MAIN_DY, 3), rz(z)],
                            bearingDeg=bearing, rangefinder=rangefinder, magazineId=MAGAZINE_OF[id], fire=FIRE_MAIN))
# Fourteen 15.2 cm casemates in the forecastle wall's embrasures (reference HP_JGS rows). The Kongō casemate's
# bore stands 1.4 m over its datum; the reference bore is 0.96 m over its node, so the datum drops 0.44 m to
# keep the bore at 5.85 m. bearingDeg is the arc centre and traverseDeg the half-sector.
CAS_Y = 4.45
CASEMATES = [(10.21, -43.72, 60, 55), (11.314, -31.441, 80, 65), (12.04, -18.3, 85, 65), (12.405, -3.134, 90, 65),
             (12.395, 14.21, 95, 65), (12.36, 23.376, 105, 65), (10.394, 35.648, 120, 55)]
for side, sign in [('p', -1), ('s', 1)]:
    for i, (x, z, centre, half) in enumerate(CASEMATES, 1):
        b['mounts'].append(dict(id=f'casemate-{side}{i}', name=f'{"Port" if sign < 0 else "Starboard"} casemate {i} 15.2 cm', partId='type41-152-kongo-casemate',
                                battery='secondary', position=[round(sign * x, 3), CAS_Y, rz(z)], bearingDeg=sign * centre, traverseDeg=half, rangefinder=False,
                                magazineId='secondary-magazine-forward' if z < -10 else 'secondary-magazine-after', fire=FIRE_LIGHT))
# Open 12.7 cm Type 89 twins: the catalog's A1 mount was measured on the same GameModels3D visual (jgs009).
HA = [('ha-1', -5.458, 10.106, -28.116, -90), ('ha-2', 5.588, 10.164, -27.864, 90), ('ha-3', -3.949, 17.755, 43.449, -90), ('ha-4', 4.052, 17.755, 43.449, 90)]
for id, x, y, z, bearing in HA:
    b['mounts'].append(dict(id=id, name=f'12.7 cm HA mount {id[-1]}', partId='type89-127-a1-twin', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='ha-magazine', fire=FIRE_LIGHT))
# 25 mm Type 96 (B_AirDefense): reference HP_JGA rows, jga019 twins and jga018 singles.
AA = [(1, 'single', 7.734, 9.168, -36.568, 45), (2, 'twin', 1.371, 16.18, -36.555, 25), (3, 'twin', -1.308, 16.186, -36.547, -25),
      (4, 'single', -9.412, 9.176, -34.966, -90), (5, 'single', 3.978, 12.147, -31.854, 45), (6, 'single', -2.514, 21.903, -30.987, 0),
      (7, 'single', 3.152, 21.915, -30.645, 30), (8, 'single', -7.713, 6.684, -22.503, -55), (9, 'single', 8.184, 6.684, -22.498, 35),
      (10, 'twin', -1.396, 24.764, -20.612, -135), (11, 'twin', 1.47, 24.764, -20.612, 130), (12, 'twin', -3.492, 9.044, 2.279, -90),
      (13, 'twin', 3.327, 9.044, 2.279, 90), (14, 'single', 12.002, 6.684, 7.736, 90), (15, 'single', -12.59, 6.683, 7.757, -90),
      (16, 'twin', -8.202, 9.045, 13.929, -90), (17, 'twin', 8.202, 9.045, 13.929, 90), (18, 'single', -12.201, 6.684, 16.798, -90),
      (19, 'single', 11.984, 6.672, 16.809, 90), (20, 'single', -10.723, 6.684, 28.515, -90), (21, 'single', 10.746, 6.672, 28.528, 90),
      (22, 'single', -9.889, 6.681, 35.174, -125), (23, 'single', 9.887, 6.68, 35.201, 125), (24, 'twin', -7.602, 6.678, 43.707, -135),
      (25, 'twin', 7.602, 6.678, 43.707, 135), (26, 'single', -8.331, 4.056, 57.808, -135), (27, 'single', 9.053, 4.061, 57.813, 135)]
for i, kind, x, y, z, bearing in AA:
    b['mounts'].append(dict(id=f'aa25-{i}', name=f'25 mm {kind} {i}', partId='type96-25-mogami-2' if kind == 'twin' else 'type96-25-kongo-single',
                            battery='secondary', position=[x, y, rz(z)], bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition', fire=FIRE_LIGHT))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    structures = json.loads(Path(opts.structures).read_text())
    for s in structures:
        s.pop('area', None)
        s.pop('levels', None)
else:
    structures = previous['structures']


def centre(s):
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] for p in s['footprint']]
    return (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2


# Recorded corrections to the measured prisms. The forecastle's ground tackle (cable plates, spurling pipes,
# stoppers, windlasses and capstans) and the quarterdeck capstan are drawn by the recipe, so the prisms the
# plan cuts made of them go. The funnel's many measured layers become one exhaust stadium and a forward
# casing (below); the searchlight and lookout platforms round it stay.
DROP_BOXES = [(-120, -69.5), (69.5, 120)]          # runtime z ranges of the ground tackle
FUNNEL_LAYERS = {'deckhouse-141', 'platform-143', 'deckhouse-144', 'deckhouse-145', 'platform-146', 'deckhouse-147', 'deckhouse-148',
                 'platform-150', 'platform-151', 'platform-152', 'deckhouse-153', 'platform-154', 'platform-155', 'deckhouse-156', 'platform-140'}
STRUCTURE_EDITS = {sid: None for sid in FUNNEL_LAYERS}
if opts.structures:
    structures = [s for s in structures if not any(z0 <= centre(s)[1] <= z1 for z0, z1 in DROP_BOXES)]
structures = [dict(s, **STRUCTURE_EDITS[s['id']]) if STRUCTURE_EDITS.get(s['id']) else s for s in structures if s['id'] not in STRUCTURE_EDITS or STRUCTURE_EDITS[s['id']] is not None]
# Funnel: a stadium measured on plan cuts 16-23.5 m (4.68 m by 6.64 m about reference z 9.67), from the top of
# the casing at 12.28 m to the cap at 23.88 m; the casing ahead of it carries the forward searchlight platform.
if not any(s['id'] == 'funnel' for s in structures):
    half, length, zc = 2.34, 6.64, rz(9.67)
    straight = length / 2 - half
    ring = []
    for i in range(40):
        a = i * math.tau / 40
        ring.append([round(half * math.cos(a), 3), round(zc + math.copysign(straight, math.sin(a)) + half * math.sin(a), 3)])
    structures.append(dict(id='funnel', name='Funnel', footprint=ring, baseY=12.28, height=11.6, material='naval',
                           exhaust=dict(position=[0, 23.88, round(zc, 3)], width=2 * half, length=length)))
    structures.append(dict(id='funnel-casing', name='Funnel forward casing 12.3-15.4 m', footprint=[[-2.4, rz(3.5)], [2.4, rz(3.5)], [2.4, rz(6.5)], [-2.4, rz(6.5)]],
                           baseY=12.28, height=3.15, material='naval'))
# The port quarter's sponson under the stowed aircraft crane (reference plan cut at 3.9 m, z 88.4-96.6): the
# loft is symmetric, so this one-sided shelf is its own block, reaching into the hull on its inboard side.
if not any(s['id'] == 'crane-sponson' for s in structures):
    structures.append(dict(id='crane-sponson', name='Port quarter crane sponson', baseY=3.78, height=.265, material='naval',
                           footprint=[[-5.6, 88.2], [-7.2, 88.37], [-7.8, 89.29], [-8.0, 90.01], [-8.0, 90.45], [-6.84, 95.85], [-6.18, 96.47], [-5.08, 96.61], [-4.4, 96.2]]))
structures.sort(key=lambda s: (s['id'] != 'funnel', s['id']))
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

# Stowed boats: reference boat bounds (x, y, z ranges, runtime z), so barrels stop at and cannot fire through them.
BOATS = [('cutter-pagoda', (4.4, 8.4), (9.28, 10.9), (-38.5, -29.2)), ('launch-midships', (5.2, 9.3), (6.7, 8.55), (-2.2, 9.3)),
         ('motor-boat', (5.3, 9.4), (6.66, 10.85), (16.2, 33.2)), ('launch-aft', (4.3, 8.3), (6.75, 8.6), (26.3, 38.6))]
for name, (x0, x1), (y0, y1), (z0, z1) in BOATS:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), round((z0 + z1) / 2, 3)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: main barrels (with the full recoil stroke) and gunhouses may not enter the prisms
# they can reach, and superfiring pairs may not cross. Game clearance, not verified historical stops.
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
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for the main and 12.7 cm mounts against the measured superstructure prisms they can reach, including the full recoil stroke, and between the superfiring turret pairs. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=[['main-1', 'main-2'], ['main-5', 'main-6']])

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
# Magazines under the barbettes, inside the citadel (runtime z).
room('magazine-forward', 'Nos. 1 and 2 turrets 35.6 cm magazines', [0, -5.4, -51.4], [12, 6.4, 23], 'magazine', hp=260, fire=MAG)
room('magazine-3', 'No. 3 turret magazine', [0, -5.4, -7.8], [14, 6.4, 10], 'magazine', hp=220, fire=MAG)
room('magazine-4', 'No. 4 turret magazine', [0, -5.4, 23.2], [14, 6.4, 10], 'magazine', hp=220, fire=MAG)
room('magazine-after', 'Nos. 5 and 6 turrets 35.6 cm magazines', [0, -5.2, 59.3], [12, 6.2, 23], 'magazine', hp=260, fire=MAG)
room('secondary-magazine-forward', 'Forward 15.2 cm magazine', [0, -5.4, -37.5], [14, 6.4, 5], 'magazine', hp=150, fire=MAG)
room('secondary-magazine-after', 'After 15.2 cm magazine', [0, -5.4, 30.8], [14, 6.4, 5], 'magazine', hp=150, fire=MAG)
room('ha-magazine', '12.7 cm and light AA magazine', [0, -1.8, -18.0], [10, 2.6, 5], 'magazine', hp=110, fire=MAG)
room('aa-ammunition', 'Light AA ready ammunition', [0, 2.4, -14.0], [8, 2.2, 5], 'magazine', hp=90, fire=MAG)
# Six boilers in four rooms between Nos. 2 and 3 turrets and under the funnel, four turbine rooms between
# Nos. 4 and 5; four shafts to the screws. Room bounds are estimates.
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -30.5, 11), ('boiler-room-2', 'No. 2 boiler room', -19.0, 11),
           ('boiler-room-3', 'No. 3 boiler room', 3.4, 12), ('boiler-room-4', 'No. 4 boiler room', 13.0, 7)]
for id, name, z, length in BOILERS:
    room(id, name, [0, -5.0, z], [22, 7.5, length], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -5.4, 33.3), ('engine-room-starboard-forward', 'Starboard forward engine room', 5.4, 33.3),
            ('engine-room-port-after', 'Port after engine room', -5.0, 42.3), ('engine-room-starboard-after', 'Starboard after engine room', 5.0, 42.3)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -5.2, z], [9.0 if abs(x) > 5.2 else 8.4, 6.8, 8.5], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -6.0, 76.0], [14, 3.6, 18], fire=ENG)
SHAFTS = [('shaft-1', -6.1), ('shaft-2', -2.8), ('shaft-3', 2.8), ('shaft-4', 6.1)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[x, -6.4, 76.0], size=[.7, 1.1, 16], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -2.4, 83.5], [9.5, 3.2, 17], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four boiler rooms between Nos. 2 and 3 turrets and under the funnel, four turbine rooms between Nos. 4 and 5 turrets, one group per shaft with equal shares. Room bounds and routing are estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
CAS_P = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-p')]
CAS_S = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-s')]
HA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('ha-')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference HP_JD and HP_JF datums (reference z).
director('main-director', 'Main battery director and 10 m rangefinder', [0, 39.515, -30.415], MAIN_IDS, [3.6, 3.2, 3.8], 80, 16)
director('after-director', 'After main battery director', [0, 24.375, 47.201], MAIN_IDS, [2.4, 1.8, 2.4], 60, 16)
director('secondary-director-port', 'Port secondary director and 3.5 m rangefinder', [-4.488, 23.049, -28.212], CAS_P, [3.8, 1.4, 2.0], 40, 6)
director('secondary-director-starboard', 'Starboard secondary director and 3.5 m rangefinder', [4.512, 23.045, -28.227], CAS_S, [3.8, 1.4, 2.0], 40, 6)
director('ha-director-port', 'Port Type 91 high-angle director', [-5.182, 22.941, -21.4], HA_IDS, [2.4, 1.8, 2.4], 45, 6)
director('ha-director-starboard', 'Starboard Type 91 high-angle director', [5.199, 22.946, -21.4], HA_IDS, [2.4, 1.8, 2.4], 45, 6)

# ---------------------------------------------------------------- protection (GameModels3D armour thicknesses)
def plate(id, name, vs, mm, exterior=False, note='Thickness from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pjsb006-armour', basis='inferred', note=note)))


def band(prefix, name, z0, z1, seg, y0, y1, mm, exterior, width):
    """Side plates between two heights on both sides over runtime z0..z1; width(z, y) gives the half breadth."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        for j in range(seg):
            za = z0 + (z1 - z0) * j / seg
            zb = z0 + (z1 - z0) * (j + 1) / seg
            vs = [[sign * width(za, y0), y0, round(za, 4)], [sign * width(zb, y0), y0, round(zb, 4)], [sign * width(zb, y1), y1, round(zb, 4)], [sign * width(za, y1), y1, round(za, 4)]]
            # The shell is curved, so each band is two planar triangles.
            plate(f'{prefix}-{side}-{j}-a', f'{side.title()} {name}', vs[:3], mm, exterior)
            plate(f'{prefix}-{side}-{j}-b', f'{side.title()} {name}', [vs[0], vs[2], vs[3]], mm, exterior)


# Belt half-breadths at 2.29 m below and 0.87 m above the waterline, sampled from station cuts of the
# armour model's belt zones every 2 m (runtime z): the belt stands on the hull body inside the bulges.
BELT = [(-104, 0.52, 0.59), (-102, 1.17, 1.36), (-100, 1.83, 2.04), (-98, 2.48, 2.71), (-96, 3.03, 3.26), (-94, 3.51, 3.75), (-92, 3.99, 4.25), (-90, 4.48, 4.74),
        (-88, 4.96, 5.23), (-86, 5.43, 5.70), (-84, 5.81, 6.07), (-82, 6.20, 6.42), (-80, 6.56, 6.76), (-78, 6.87, 7.07), (-76, 7.19, 7.37), (-74, 7.49, 7.66),
        (-72, 7.77, 7.94), (-70, 8.06, 8.19), (-68, 8.34, 8.44), (-66, 8.63, 8.69), (-64, 8.91, 8.94), (-62, 9.20, 9.20), (-60, 9.48, 9.48), (-58, 9.76, 9.77),
        (-56, 10.04, 10.05), (-54, 10.32, 10.34), (-52, 10.61, 10.62), (-50, 10.89, 10.90), (-48, 11.17, 11.18), (-46, 11.45, 11.46), (-44, 11.73, 11.74), (-42, 12.01, 12.02),
        (-40, 12.30, 12.30), (-38, 12.58, 12.58), (-36, 12.86, 12.86), (-34, 13.14, 13.14), (-32, 13.36, 13.36), (-30, 13.50, 13.50), (-28, 13.64, 13.64), (-26, 13.79, 13.79),
        (-24, 13.93, 13.93), (-22, 14.07, 14.07), (-20, 14.21, 14.21), (-18, 14.25, 14.25), (-16, 14.29, 14.29), (-14, 14.33, 14.33), (-12, 14.38, 14.38), (-10, 14.42, 14.42),
        (-8, 14.46, 14.46), (-6, 14.50, 14.50), (-4, 14.54, 14.54), (-2, 14.59, 14.59), (0, 14.63, 14.63), (2, 14.67, 14.67), (4, 14.71, 14.71), (6, 14.75, 14.75),
        (8, 14.78, 14.78), (10, 14.73, 14.73), (12, 14.69, 14.69), (14, 14.65, 14.65), (16, 14.61, 14.61), (18, 14.57, 14.57), (20, 14.53, 14.53), (22, 14.49, 14.49),
        (24, 14.45, 14.45), (26, 14.40, 14.40), (28, 14.36, 14.36), (30, 14.32, 14.32), (32, 14.28, 14.28), (34, 14.24, 14.24), (36, 14.16, 14.15), (38, 14.03, 14.01),
        (40, 13.90, 13.86), (42, 13.78, 13.71), (44, 13.65, 13.57), (46, 13.52, 13.42), (48, 13.39, 13.28), (50, 13.21, 13.09), (52, 12.95, 12.86), (54, 12.70, 12.63),
        (56, 12.45, 12.41), (58, 12.20, 12.18), (60, 11.95, 11.95), (62, 11.70, 11.72), (64, 11.45, 11.49), (66, 11.20, 11.27), (68, 10.94, 11.01), (70, 10.67, 10.72),
        (72, 10.37, 10.42), (74, 10.04, 10.11), (76, 9.70, 9.80), (78, 9.37, 9.48), (80, 8.92, 9.04), (82, 8.45, 8.58), (84, 7.98, 8.12), (86, 7.52, 7.67),
        (88, 7.05, 7.21), (90, 6.58, 6.75)]
UPPER_BELT = [(-50, 10.90), (-48, 11.18), (-46, 11.46), (-44, 11.74), (-42, 12.02), (-40, 12.30), (-38, 12.58), (-36, 12.86), (-34, 13.14), (-32, 13.36),
              (-30, 13.50), (-28, 13.64), (-26, 13.79), (-24, 13.93), (-22, 14.07), (-20, 14.21), (-18, 14.25), (-16, 14.29), (-14, 14.33), (-12, 14.38),
              (-10, 14.42), (-8, 14.46), (-6, 14.50), (-4, 14.54), (-2, 14.59), (0, 14.63), (2, 14.67), (4, 14.71), (6, 14.75), (8, 14.78),
              (10, 14.73), (12, 14.69), (14, 14.65), (16, 14.61), (18, 14.57), (20, 14.53), (22, 14.49), (24, 14.45), (26, 14.40), (28, 14.36),
              (30, 14.32), (32, 14.28), (34, 14.24), (36, 14.15), (38, 14.01), (40, 13.86)]
BELT_LOW, BELT_TOP = -2.29, 0.87


def belt_x(z, y):
    lo = interp([(r[0], r[1]) for r in BELT], z)
    hi = interp([(r[0], r[2]) for r in BELT], z)
    return (lo + (hi - lo) * (y - BELT_LOW) / (BELT_TOP - BELT_LOW)) * .998


def upper_x(z, y):
    return interp(UPPER_BELT, z) * .998


# Zone boundaries, runtime z (reference + 1.095).
Z_BOW, Z_FWD, Z_CIT_F, Z_UP_F, Z_CIT_A, Z_ST_305, Z_ST_229, Z_ST_102 = -104.7, -62.86, -32.87, -51.82, 49.08, 40.2, 66.98, 91.43
band('bow-belt', 'bow belt', Z_BOW, Z_FWD, 10, BELT_LOW, BELT_TOP, 102, True, belt_x)
band('forward-belt', 'forward belt', Z_FWD, Z_CIT_F, 8, BELT_LOW, BELT_TOP, 229, True, belt_x)
band('belt', 'main belt', Z_CIT_F, Z_ST_305, 20, BELT_LOW, BELT_TOP, 305, True, belt_x)
band('belt-aft', 'main belt', Z_ST_305, Z_CIT_A, 3, BELT_LOW, BELT_TOP, 305, True, belt_x)
band('after-belt', 'after belt', Z_CIT_A, Z_ST_229, 5, BELT_LOW, BELT_TOP, 229, True, belt_x)
band('stern-belt', 'stern belt', Z_ST_229, Z_ST_102, 7, BELT_LOW, BELT_TOP, 102, True, belt_x)
band('upper-belt', 'upper belt', Z_UP_F, Z_ST_305, 22, BELT_TOP, LEDGE, 203, True, upper_x)
# Casemate armour on the forecastle wall, from the ledge to the forecastle deck, on the loft's wall.
band('casemate-wall', 'casemate armour', -54.1, 53.35, 36, LEDGE + .02, FORECASTLE - .02, 152, True, lambda z, y: half_breadth(z, 5.3) * .998)
# Lower side below the belt (26 mm) is constructional plating; the bulges carry the underwater protection zone.
for j in range(24):
    za = Z_FWD + (Z_CIT_A - Z_FWD) * j / 24
    zb = Z_FWD + (Z_CIT_A - Z_FWD) * (j + 1) / 24
    plate(f'armoured-deck-{j}', 'Armoured deck', [[-9.31, 0.01, round(za, 4)], [9.31, 0.01, round(za, 4)], [9.31, 0.01, round(zb, 4)], [-9.31, 0.01, round(zb, 4)]], 99)
    for side, sign in [('port', -1), ('starboard', 1)]:
        if Z_CIT_F <= (za + zb) / 2 <= Z_CIT_A:
            # Amidships the deck runs flat to the belt (51 mm outboard of the 99 mm centre strip).
            wa, wb = belt_x(za, 0) * .99, belt_x(zb, 0) * .99
            vs = [[sign * 9.31, 0.01, round(za, 4)], [sign * 9.31, 0.01, round(zb, 4)], [sign * wb, 0.01, round(zb, 4)], [sign * wa, 0.01, round(za, 4)]]
            plate(f'deck-outboard-{side}-{j}', f'{side.title()} armoured deck outboard', vs, 51)
        else:
            # Forward of the citadel belt the deck slopes down to the belt's lower edge (76 mm).
            ia, ib = belt_x(za, BELT_LOW) * .99, belt_x(zb, BELT_LOW) * .99
            vs = [[sign * 9.31, 0.01, round(za, 4)], [sign * 9.31, 0.01, round(zb, 4)], [sign * ib, BELT_LOW, round(zb, 4)], [sign * ia, BELT_LOW, round(za, 4)]]
            plate(f'deck-slope-{side}-{j}-a', f'{side.title()} armoured deck slope', vs[:3], 76)
            plate(f'deck-slope-{side}-{j}-b', f'{side.title()} armoured deck slope', [vs[0], vs[2], vs[3]], 76)
# The after magazines' deck (131 mm) with 102 mm slopes to the belt.
for j in range(6):
    za = Z_CIT_A + (71.01 - Z_CIT_A) * j / 6
    zb = Z_CIT_A + (71.01 - Z_CIT_A) * (j + 1) / 6
    plate(f'after-deck-{j}', 'After armoured deck', [[-9.31, 0.01, round(za, 4)], [9.31, 0.01, round(za, 4)], [9.31, 0.01, round(zb, 4)], [-9.31, 0.01, round(zb, 4)]], 131)
    for side, sign in [('port', -1), ('starboard', 1)]:
        ia, ib = belt_x(za, BELT_LOW) * .99, belt_x(zb, BELT_LOW) * .99
        vs = [[sign * 9.31, 0.01, round(za, 4)], [sign * 9.31, 0.01, round(zb, 4)], [sign * ib, BELT_LOW, round(zb, 4)], [sign * ia, BELT_LOW, round(za, 4)]]
        plate(f'after-slope-{side}-{j}-a', f'{side.title()} after deck slope', vs[:3], 102)
        plate(f'after-slope-{side}-{j}-b', f'{side.title()} after deck slope', [vs[0], vs[2], vs[3]], 102)
# Bow lower deck (57 mm at 1.74 m), casemate deck under the forecastle (35 mm) and the upper deck ahead of the belt.
for j in range(8):
    za = Z_BOW + 2 + (Z_FWD - Z_BOW - 2) * j / 8
    zb = Z_BOW + 2 + (Z_FWD - Z_BOW - 2) * (j + 1) / 8
    wa, wb = min(9.08, half_breadth(za, 1.74) * .97), min(9.08, half_breadth(zb, 1.74) * .97)
    plate(f'bow-deck-{j}', 'Bow protective deck', [[-wa, 1.74, round(za, 4)], [wa, 1.74, round(za, 4)], [wb, 1.74, round(zb, 4)], [-wb, 1.74, round(zb, 4)]], 57)
for j in range(22):
    za = -60.29 + (53.35 + 60.29) * j / 22
    zb = -60.29 + (53.35 + 60.29) * (j + 1) / 22
    wa, wb = half_breadth(za, FORECASTLE - .05) * .97, half_breadth(zb, FORECASTLE - .05) * .97
    plate(f'casemate-deck-{j}', 'Forecastle deck over the casemates', [[-wa, FORECASTLE - .01, round(za, 4)], [wa, FORECASTLE - .01, round(za, 4)], [wb, FORECASTLE - .01, round(zb, 4)], [-wb, FORECASTLE - .01, round(zb, 4)]], 35)
# Armoured bulkheads (reference cit_/cas_ transverse zones).
for id, z, mm, x0, y0, y1 in [('citadel-forward', Z_FWD, 241, 9.08, -9.68, 0.0), ('citadel-after', 71.01, 140, 10.53, -7.4, 0.0),
                              ('casemate-forward-lower', -60.29, 203, 10.65, 0.87, LEDGE), ('casemate-forward-upper', -60.29, 152, 8.9, LEDGE, FORECASTLE)]:
    plate(id, id.replace('-', ' ').capitalize() + ' bulkhead', [[-x0, y0, z], [x0, y0, z], [x0, y1, z], [-x0, y1, z]], mm)
for side, sign in [('port', -1), ('starboard', 1)]:
    # The after casemate bulkhead closes the upper belt obliquely to the barbette of No. 5 turret.
    plate(f'casemate-after-{side}', 'After casemate bulkhead', [[sign * 13.8, 0.0, 40.2], [sign * 4.8, 0.0, 53.35], [sign * 4.8, LEDGE, 53.35], [sign * 13.8, LEDGE, 40.2]], 203)
# Barbettes: 305 mm above the forecastle deck, 216 mm below it on the superfiring turrets, down to the armoured deck.
for m in b['mounts'][:6]:
    r = 4.82
    x, _, z = m['position']
    top = m['position'][1] - MAIN_DY
    splits = [(0.01, FORECASTLE, 216 if top > FORECASTLE + .5 else 305), (FORECASTLE, top, 305)] if top > FORECASTLE + .05 else [(0.01, top, 305)]
    for k, (y0, y1, mm) in enumerate(splits):
        for i in range(24):
            a, c = i * math.tau / 24, (i + 1) * math.tau / 24
            plate(f"{m['id']}-barbette-{k}-{i}", m['name'] + ' barbette',
                  [[r * math.cos(a), y0, z + r * math.sin(a)], [r * math.cos(c), y0, z + r * math.sin(c)], [r * math.cos(c), y1, z + r * math.sin(c)], [r * math.cos(a), y1, z + r * math.sin(a)]], mm)
# Conning towers (reference ss_bridge zones): forward 305 mm sides and 76 mm roof, after 152 mm.
for tag, (x0, x1, y0, y1, z0, z1, side_mm) in {'ct': (-3.36, 3.36, 12.14, 15.57, rz(-37.55), rz(-33.43), 305),
                                                  'after-ct': (-3.94, 3.94, 11.31, 14.04, rz(40.86), rz(43.7), 152)}.items():
    name = 'Conning tower' if tag == 'ct' else 'After control tower'
    for id, vs, mm in [(f'{tag}-port', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], side_mm),
                       (f'{tag}-starboard', [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], side_mm),
                       (f'{tag}-front', [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], side_mm),
                       (f'{tag}-back', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], side_mm),
                       (f'{tag}-roof', [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 76)]:
        plate(id, name, vs, mm, True)
# Steering gear (reference rudder zones): 83 mm sides, 70 mm roof, 102 mm after bulkhead.
sg = dict(x=5.18, y0=-2.29, y1=0.0, z0=71.01, z1=91.43)
for id, vs, mm in [('steering-port', [[-sg['x'], sg['y0'], sg['z0']], [-sg['x'], sg['y0'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z0']]], 83),
                   ('steering-starboard', [[sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [sg['x'], sg['y1'], sg['z0']]], 83),
                   ('steering-after', [[-6.42, -4.89, sg['z1']], [6.42, -4.89, sg['z1']], [6.42, 0.87, sg['z1']], [-6.42, 0.87, sg['z1']]], 102),
                   ('steering-roof', [[-sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 70)]:
    plate(id, 'Steering-gear protection', vs, mm)
b['underwaterProtection'] = dict(version=1, basis='Estimated anti-torpedo bulge and side-protection system outside the belt (the reference armour model gives the bulge only as 26 mm plating); reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'bulge-{side}', name=f'{side.title()} anti-torpedo bulge', center=[sign * 15.05, -4.6, 0.1],
                                             size=[2.5, 8.4, 125], damageReduction=.4, breachReduction=.4) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (reference HP_flag_nation).
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='ijn', position=[0, 39.4, rz(46.22)], width=4.0, staffHeight=0)],
                radars=[dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=40),
                        dict(id='after-director', nodeId='after-director.yaw', rpm=2, sweepDeg=55, phaseDeg=160)])
b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=320, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.09, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Provisional battleship crew and finite-stores calibration; not historical manning or damage-control performance.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
write(HERE / 'blueprint.json', b)
print(f'Authored fuso: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-flood-spaces, author-stability, author-local-damage, author-damage-control.')

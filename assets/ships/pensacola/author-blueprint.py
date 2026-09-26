"""Original USS Pensacola (CA-24) blueprint authoring (1942 fit), GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and
rebuilds everything except the measured superstructure blocks, which it keeps from the current
blueprint unless a fresh measurement file is passed:

  python3 assets/ships/pensacola/author-blueprint.py [--structures blocks.json]

Hull lines come from `authoring/lines.json`, written by `bun run ship:lines pensacola --ref pasc106
--format sections --widest-below 1.5 --span -87.80,90.65 --high 0.125,0.25,0.375,0.5,0.625,0.75,0.875,1`
over the cached GameModels3D pasc106 A hull (asc043_pensacola_1942). `repair_sections` below
drops the few stations whose shell walk failed and restores the flat keel the centreline
profile shows. Superstructure blocks are traced from `ship:slice --plan` cuts of the same
reference every 0.1 m (the measurement files and the tracing script live in ignored
.build/pensacola/). They hold our own sampled offsets, never source triangles. Mount datums come
from the reference hardpoints, armour zones and thicknesses from its armour model
(asc043_pensacola_1942 armour); both are provisional game calibration, not a historical survey.
Run afterwards: author-local-damage (new ship only), author-flood-spaces, author-stability and
author-damage-control, always passing `pensacola`.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = 1.425           # reference z of the hull's mid-length; runtime z = reference z - ZC
DRAFT = 6.614        # keel below the reference waterline (the flat keel of the centreline profile)
SPEED_KN = 32.5
KEEL_Y = -6.614
FLAT_KEEL = (-82.9, 68.3)   # reference z span of the flat keel


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
args.add_argument('--structures')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
LINES = json.loads((HERE / 'authoring/lines.json').read_text())
L = LINES['length']
HALF = L / 2 - LINES['zShift']   # station = HALF - reference z


def repair_sections(raw):
    """Measured sections, less the stations whose shell walk failed:
    - narrower than 5 cm (the walk lost the stem bar at the forefoot);
    - in the body, a second point already at the side (the walk stepped over the bilge keel and never
      turned the bilge, leaving a false flat bottom 0.6 m high);
    - a deck more than 0.3 m off its neighbours' (the walk climbed the flush midships deckhouse side).
    The flat keel of the centreline profile (-6.614 m from z -82.9 to 68.3) replaces the walk's keel, which
    stops 0.3 m from the centreline and misses the bottom's rise of floor. The stern and stem end
    stations close the loft at the measured ends."""
    rows = []
    for s in sorted(raw, key=lambda s: s['station']):
        pts = [list(p) for p in s['points']]
        z = HALF - s['station']
        widest = max(p[0] for p in pts)
        if widest < .05:
            continue
        if abs(z) < 70 and pts[1][0] > .72 * widest:
            continue
        rows.append(dict(station=s['station'], z=z, points=pts))
    keep = []
    for i, r in enumerate(rows):
        near = [rows[j]['points'][-1][1] for j in range(max(0, i - 2), min(len(rows), i + 3)) if j != i]
        near.sort()
        median = near[len(near) // 2] if len(near) % 2 else (near[len(near) // 2 - 1] + near[len(near) // 2]) / 2
        if abs(r['points'][-1][1] - median) > .3 and abs(r['z']) < 80:
            continue
        keep.append(r)
    out = []
    for r in keep:
        pts = r['points']
        if FLAT_KEEL[0] < r['z'] < FLAT_KEEL[1]:
            pts[0][1] = min(pts[0][1], KEEL_Y)
        out.append({'station': round(r['station'], 4), 'points': [[round(w, 4), round(y, 4)] for w, y in pts]})
    # Stern end: the round stern closes 0.7 m aft of the last measured station; stem head at L.
    first = out[0]
    if first['station'] > .05:
        out.insert(0, {'station': 0, 'points': [[round(w * .25, 4), y] for w, y in first['points']]})
    out[-1]['station'] = round(L, 4)
    return out


sections = repair_sections(LINES['sections'])


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


def deck_y(z):
    """Weather-deck height at runtime z (bow negative)."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def deck_ref(zref):
    return deck_y(rz(zref))


def half_breadth(z, y):
    """Loft half-breadth at runtime z and height y."""
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


DEPTH = round(deck_y(0) - KEEL_Y, 3)
hull = dict(kind='authored-stations-v1', length=L, beam=round(beam, 4), draft=DRAFT, depth=DEPTH,
            massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round(above * .55, 1),
            halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
            deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
            keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
            sections=sections)

CONFIG = 'CA-24 · 1942 exterior after the GameModels3D pasc106 A hull (asc043_pensacola_1942) · reference design waterline'
b = dict(schemaVersion=1, id='pensacola', name='Pensacola', configuration=CONFIG,
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/pensacola.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=5, acceleration=.2, braking=.18, rudderRate=.4, maxYawRate=.022),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 16.2, rz(-31.0)]),
         structuralPlating=dict(hullMm=25, superstructureMm=13, note='Hull and superstructure plating read from the approved GameModels3D armour model (25 mm hull and upper side, 13 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure blocks measured from the approved GameModels3D pasc106 A hull (asc043_pensacola_1942) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Ten 8-inch/55 in two twin Mk 14 Mod 2 and two triple Mk 14 Mod 1 turrets, eight 5-inch/25 Mk 19 open mounts, four 1.1-inch/75 quadruple mounts and eight 20 mm Oerlikon Mk 4 at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference hardpoint datums)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# Low twin Mk 14 Mod 2 turrets (Nos. 1 and 4) and superfiring triple Mk 14 Mod 1 turrets (Nos. 2 and 3).
MAIN = [('main-1', 'No. 1 turret', 'us-8in55-mk14-mod2-twin', 6.380, -55.659, 0),
        ('main-2', 'No. 2 turret', 'us-8in55-mk14-mod1-triple', 10.278, -42.238, 0),
        ('main-3', 'No. 3 turret', 'us-8in55-mk14-mod1-triple', 7.818, 51.152, 180),
        ('main-4', 'No. 4 turret', 'us-8in55-mk14-mod2-twin', 4.346, 64.150, 180)]
for id, name, part, y, z, bearing in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 8-inch/55', partId=part, battery='main', position=[0, y, rz(z)], bearingDeg=bearing,
                            rangefinder=True, magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE_MAIN))
# Eight 5-inch/25 Mk 19 open mounts (reference HP_AGS): the forward four on the sponsons abreast the bridge,
# the after four on the midships superstructure deck. Bearing is the centre of each beam arc.
SECONDARY = [(-7.176, 9.351, -28.800), (7.176, 9.349, -28.800), (-7.176, 9.105, -19.426), (7.176, 9.108, -19.426),
             (-6.643, 6.571, 18.880), (6.642, 6.571, 18.880), (-6.831, 6.571, 26.424), (6.831, 6.571, 26.424)]
for i, (x, y, z) in enumerate(SECONDARY, 1):
    b['mounts'].append(dict(id=f'sec-{i}', name=f'5-inch/25 mount {i}', partId='us-5in25-mk19-single', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=90 if x > 0 else -90, rangefinder=False, magazineId='secondary-magazine-forward' if z < 0 else 'secondary-magazine-after',
                            fire=FIRE_LIGHT))
# Four 1.1-inch/75 quadruple mounts (HP_AGA_5, 6, 11, 12): on the bridge wings and on the quarterdeck.
QUADS = [(-5.316, 14.915, -25.755, -90), (5.316, 14.915, -25.755, 90), (-2.587, 3.813, 80.151, 180), (2.588, 3.813, 80.151, 180)]
for i, (x, y, z, bearing) in enumerate(QUADS, 1):
    b['mounts'].append(dict(id=f'aa1-{i}', name=f'1.1-inch quadruple mount {i}', partId='us-11in75-quad', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT))
# Eight 20 mm Oerlikon Mk 4 (HP_AGA_1-4 on the foretop, 7-10 on the mainmast platform).
OERLIKONS = [(-2.619, 24.905, -28.653, -45), (2.619, 24.905, -28.653, 45), (-2.907, 24.905, -26.715, -90), (2.907, 24.905, -26.715, 90),
             (-2.899, 15.296, 38.517, -60), (2.900, 15.296, 38.517, 60), (-1.869, 15.278, 43.073, -135), (1.869, 15.278, 43.073, 135)]
for i, (x, y, z, bearing) in enumerate(OERLIKONS, 1):
    b['mounts'].append(dict(id=f'aa20-{i}', name=f'20 mm Oerlikon {i}', partId='us-20mm-oerlikon-mk4', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 0 else 'aa-ammunition-after', fire=FIRE_LIGHT))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    measured = json.loads(Path(opts.structures).read_text())['structures']
    structures = []
    for s in measured:
        entry = dict(id=s['id'], name=s['name'], footprint=s['footprint'], baseY=s['baseY'], height=s['height'], material='naval')
        for key in ('surface', 'exhaust'):
            if s.get(key):
                entry[key] = s[key]
        structures.append(entry)
elif previous and previous.get('structures') and not previous['structures'][0]['id'].startswith('bridge'):
    structures = previous['structures']
else:
    structures = []
b['structures'] = structures

# Firing obstructions: boxes kept inside the visual walls for substantial blocks. Each outline is
# cut into fore-and-aft strips of at most 3 m so a stepped deckhouse is not boxed at its widest.
for s in structures:
    poly = s['footprint']
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    if s['height'] < 1.2 or (max(xs) - min(xs)) * (max(zs) - min(zs)) < 6 or s.get('exhaust'):
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
# Stowed boats and the catapults: barrels stop at them and cannot fire through them (reference z, x, y spans).
BOATS = [('whaleboat', (4.6, 6.6), (6.5, 7.9), (21.6, 29.2)), ('catapult', (5.4, 9.2), (6.2, 8.2), (-14.4, -0.9))]
for name, (x0, x1), (y0, y1), (z0, z1) in BOATS:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: barrels (with the full recoil stroke) and carriages may not enter the blocks
# they can reach, and neighbouring mounts whose working circles overlap may not cross. Game
# clearance, not verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
# Rotating bodies in the yaw frame (x across, y up, z aft): the Mk 14 gunhouses from their catalog
# meshes, and the open mounts' carriages, platforms and seats.
BODIES = {'us-8in55-mk14-mod1-triple': dict(center=[0, 1.67, 2.97], size=[5.9, 3.31, 9.2]),
          'us-8in55-mk14-mod2-twin': dict(center=[0, 1.66, 3.0], size=[4.78, 3.29, 9.25]),
          'us-5in25-mk19-single': dict(center=[0, 1.02, .35], size=[2.9, 1.62, 3.0]),
          'us-11in75-quad': dict(center=[0, .95, .3], size=[2.4, 1.9, 2.3]),
          'us-20mm-oerlikon-mk4': dict(center=[0, .85, .25], size=[.8, 1.7, 1.1])}
clear_mounts, reach = [], {}
for m in b['mounts']:
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(max(w['barrelBaseRadius'] * (.85 if m['battery'] == 'main' else 1), .05), 3),
                 body=BODIES[m['partId']])
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
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for every mount (8-inch, 5-inch, 1.1-inch and 20 mm) against the measured superstructure blocks they can reach, including the full recoil stroke, and between neighbouring mounts whose working circles overlap. Game clearance envelopes, not verified historical mechanical stops.',
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
# Magazines inside the armoured boxes the reference's armour model draws: forward z -61.1 to -21.3 under
# the 38 mm deck at y 1.29, after z 35.9 to 68.6 under the 38 mm deck at y -0.03.
room('magazine-forward', 'Forward 8-inch magazines', [0, -2.6, rz(-49.0)], [9.5, 6.2, 22], 'magazine', hp=220, fire=MAG)
room('magazine-after', 'After 8-inch magazines', [0, -3.4, rz(55.5)], [8.6, 5.4, 22], 'magazine', hp=200, fire=MAG)
room('secondary-magazine-forward', 'Forward 5-inch magazine', [0, -2.6, rz(-31.5)], [11, 6.2, 8], 'magazine', hp=110, fire=MAG)
room('secondary-magazine-after', 'After 5-inch magazine', [0, -3.4, rz(40.5)], [9, 5.4, 7], 'magazine', hp=110, fire=MAG)
room('aa-ammunition-forward', 'Forward light AA ready ammunition', [0, 2.8, rz(-27.0)], [6, 2.4, 5], 'magazine', hp=80, fire=MAG)
room('aa-ammunition-after', 'After light AA ready ammunition', [0, 2.0, rz(74.0)], [6, 2.4, 5], 'magazine', hp=80, fire=MAG)
# Machinery inside the 76 mm belt (z -21.3 to 35.9): four firerooms under the funnels, then the engine rooms.
BOILERS = [('boiler-room-1', 'No. 1 fireroom', -16.6, 9.0), ('boiler-room-2', 'No. 2 fireroom', -7.4, 9.0), ('boiler-room-3', 'No. 3 fireroom', 1.8, 9.0),
           ('boiler-room-4', 'No. 4 fireroom', 11.0, 9.0)]
for id, name, z, length in BOILERS:
    room(id, name, [0, -2.6, rz(z)], [15.5, 6.6, length], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -3.9, 20.5), ('engine-room-starboard-forward', 'Starboard forward engine room', 3.9, 20.5),
            ('engine-room-port-after', 'Port after engine room', -3.9, 30.5), ('engine-room-starboard-after', 'Starboard after engine room', 3.9, 30.5)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -2.6, rz(z)], [7.6, 6.6, 9.6], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -4.0, rz(72.0)], [9, 3.2, 12], fire=ENG)
SHAFTS = [('shaft-1', -6.5), ('shaft-2', -2.9), ('shaft-3', 2.9), ('shaft-4', 6.5)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[round(x * .55, 3), -4.4, rz(72.0)],
                             size=[.7, 1.1, 10], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, .8, rz(85.8)], [7.8, 1.6, 7.2], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four firerooms under the funnels and four turbine rooms aft of them, one group per shaft with equal shares. Room bounds and routing are game estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
SEC_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('sec-')]
QUAD_FWD = [m['id'] for m in b['mounts'] if m['id'] in ('aa1-1', 'aa1-2')]
QUAD_AFT = [m['id'] for m in b['mounts'] if m['id'] in ('aa1-3', 'aa1-4')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_AD): the Mk 22 on the foretop and the Mk 18 aft for the 8-inch turrets,
# the Mk 19s for the 5-inch battery, Mk 44s for the 1.1-inch quadruple mounts.
director('main-director', 'Mk 22 main battery director', [0, 34.748, -26.932], MAIN_IDS, [2.4, 1.9, 2.4], 60, 10)
director('after-director', 'Mk 18 after main battery director', [0, 12.009, 42.556], MAIN_IDS, [2.2, 1.8, 2.2], 50, 8)
director('secondary-director-forward', 'Forward Mk 19 5-inch director', [0, 18.662, -34.047], SEC_IDS, [2.6, 2.2, 2.6], 50, 8)
director('secondary-director-after', 'After Mk 19 5-inch director', [0, 16.959, 40.490], SEC_IDS, [2.6, 2.2, 2.6], 50, 8)
director('aa-director-port', 'Port Mk 44 director', [-2.466, 17.688, -28.210], QUAD_FWD, [1.2, 1.4, 1.2], 30, 4)
director('aa-director-starboard', 'Starboard Mk 44 director', [2.466, 17.688, -28.210], QUAD_FWD, [1.2, 1.4, 1.2], 30, 4)
director('aa-director-after-port', 'After port Mk 44 director', [-2.587, 4.755, 76.680], QUAD_AFT, [1.2, 1.4, 1.2], 30, 4)
director('aa-director-after-starboard', 'After starboard Mk 44 director', [2.588, 4.755, 76.680], QUAD_AFT, [1.2, 1.4, 1.2], 30, 4)


# ---------------------------------------------------------------- protection (GameModels3D armour model)
def plate(id, name, vs, mm, exterior=False, note='Thickness and zone from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pasc106-armour', basis='inferred', note=note)))


def quad(prefix, name, a, b_, c, d, mm, exterior=False):
    """Two planar triangles over a possibly twisted quad (reference z), mirrored to port."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        m = lambda v: [sign * v[0], v[1], rz(v[2])]
        plate(f'{prefix}-{side}-a', f'{side.title()} {name}', [m(a), m(b_), m(c)], mm, exterior)
        plate(f'{prefix}-{side}-b', f'{side.title()} {name}', [m(a), m(c), m(d)], mm, exterior)


def band(prefix, name, z0, z1, seg, y0, y1, mm, inset=.998, exterior=True):
    """Side plating on the loft between heights y0 and y1 (numbers or functions of reference z)."""
    for j in range(seg):
        za = z0 + (z1 - z0) * j / seg
        zb = z0 + (z1 - z0) * (j + 1) / seg
        ya0, ya1 = y0(za) if callable(y0) else y0, y1(za) if callable(y1) else y1
        yb0, yb1 = y0(zb) if callable(y0) else y0, y1(zb) if callable(y1) else y1
        quad(f'{prefix}-{j}', name, (half_breadth(rz(za), ya0) * inset, ya0, za), (half_breadth(rz(zb), yb0) * inset, yb0, zb),
             (half_breadth(rz(zb), yb1) * inset, yb1, zb), (half_breadth(rz(za), ya1) * inset, ya1, za), mm, exterior)


def deck_plates(prefix, name, z0, z1, seg, y, mm, inset=.985):
    for j in range(seg):
        za = z0 + (z1 - z0) * j / seg
        zb = z0 + (z1 - z0) * (j + 1) / seg
        ya, yb = (y(za), y(zb)) if callable(y) else (y, y)
        wa, wb = half_breadth(rz(za), ya - .05) * inset, half_breadth(rz(zb), yb - .05) * inset
        plate(f'{prefix}-{j}', name, [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], mm)


CIT_FWD, CIT_MID, CIT_AFT, CIT_END = -61.14, -21.33, 35.91, 68.61
# Main belt on the shell: 102 mm over the forward magazines (y -2.11 to 1.29), 76 mm over the machinery (to 1.61).
band('belt-fwd', 'magazine belt', CIT_FWD, CIT_MID, 10, -2.11, 1.29, 102)
band('belt', 'machinery belt', CIT_MID, CIT_AFT, 12, -2.11, 1.61, 76)
# Lower citadel side, 25 mm, from the belt down to the turn of the bilge.
band('lower-side', 'lower citadel side', CIT_FWD, CIT_AFT, 16, -5.2, -2.11, 25)
# After magazines: a 102 mm inner box (x 4.46, y -2.11 to -0.03) behind a 19 mm outer belt.
quad('after-magazine-side', 'after magazine side', (4.46, -2.11, CIT_AFT), (4.46, -2.11, CIT_END), (4.46, -.03, CIT_END), (4.46, -.03, CIT_AFT), 102)
band('stern-belt', 'after belt', CIT_AFT, CIT_END, 6, -2.11, -.03, 19)
# Upper side from the belt to the weather deck, 25 mm, over the whole protected length.
band('upper-side', 'upper side plating', CIT_FWD, CIT_MID, 8, 1.29, lambda z: deck_ref(z) - .03, 25)
band('upper-side-mid', 'upper side plating', CIT_MID, CIT_AFT, 12, 1.61, lambda z: deck_ref(z) - .03, 25)
band('upper-side-aft', 'upper side plating', CIT_AFT, CIT_END, 6, -.03, lambda z: deck_ref(z) - .03, 25)
# Protective decks: 38 mm over the magazines, 25 mm over the machinery.
deck_plates('magazine-deck-fwd', 'Forward magazine deck', CIT_FWD, CIT_MID, 8, 1.29, 38)
deck_plates('machinery-deck', 'Machinery deck', CIT_MID, CIT_AFT, 12, 1.61, 25)
plate('magazine-deck-aft', 'After magazine deck', [[-4.46, -.03, rz(CIT_AFT)], [4.46, -.03, rz(CIT_AFT)], [4.46, -.03, rz(CIT_END)], [-4.46, -.03, rz(CIT_END)]], 38)
# Weather deck over the citadel (25 mm), in strips that follow the sheer.
deck_plates('weather-deck', 'Weather deck', CIT_FWD, CIT_END, 26, lambda z: deck_ref(z) - .01, 25, .98)
# Transverse bulkheads.
for id, name, z, x0, x1, y0, y1, mm in [('bulkhead-forward', 'Forward magazine bulkhead', CIT_FWD, 3.72, 3.72, -6.6, 1.29, 65),
                                          ('bulkhead-forward-upper', 'Forward upper bulkhead', CIT_FWD, 5.54, 5.54, 1.29, 6.05, 6),
                                          ('bulkhead-machinery-forward', 'Forward machinery bulkhead', CIT_MID, 9.02, 9.02, -.03, 1.61, 25),
                                          ('bulkhead-machinery-after', 'After machinery bulkhead', CIT_AFT, 9.39, 9.39, -6.6, 1.16, 25),
                                          ('bulkhead-after', 'After magazine bulkhead', CIT_END, 7.2, 7.2, -6.6, -.03, 65)]:
    plate(id, name, [[-x0, y0, rz(z)], [x0, y0, rz(z)], [x1, y1, rz(z)], [-x1, y1, rz(z)]], mm)
# Barbettes: 19 mm, radius 2.66 m, from the protective deck to each gunhouse sole.
BARBETTE_R = 2.66
for m in b['mounts'][:4]:
    x, top, z = m['position']
    low = 1.29 if z < rz(CIT_MID) else -.03
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[BARBETTE_R * math.cos(a), low, z + BARBETTE_R * math.sin(a)], [BARBETTE_R * math.cos(c), low, z + BARBETTE_R * math.sin(c)],
               [BARBETTE_R * math.cos(c), top, z + BARBETTE_R * math.sin(c)], [BARBETTE_R * math.cos(a), top, z + BARBETTE_R * math.sin(a)]], 19)
# Conning tower (32 mm) in the bridge base.
CT = (2.78, 12.27, 14.92, -33.91, -30.13)
for id, vs in [('conning-tower-front', [[-CT[0], CT[1], rz(CT[3])], [CT[0], CT[1], rz(CT[3])], [CT[0], CT[2], rz(CT[3])], [-CT[0], CT[2], rz(CT[3])]]),
               ('conning-tower-back', [[-CT[0], CT[1], rz(CT[4])], [CT[0], CT[1], rz(CT[4])], [CT[0], CT[2], rz(CT[4])], [-CT[0], CT[2], rz(CT[4])]]),
               ('conning-tower-port', [[-CT[0], CT[1], rz(CT[3])], [-CT[0], CT[1], rz(CT[4])], [-CT[0], CT[2], rz(CT[4])], [-CT[0], CT[2], rz(CT[3])]]),
               ('conning-tower-starboard', [[CT[0], CT[1], rz(CT[3])], [CT[0], CT[1], rz(CT[4])], [CT[0], CT[2], rz(CT[4])], [CT[0], CT[2], rz(CT[3])]]),
               ('conning-tower-roof', [[-CT[0], CT[2], rz(CT[3])], [CT[0], CT[2], rz(CT[3])], [CT[0], CT[2], rz(CT[4])], [-CT[0], CT[2], rz(CT[4])]])]:
    plate(id, 'Conning tower', vs, 32)
# Steering-gear box: 65 mm sides and ends, 25 mm roof.
SG = (4.27, 1.52, -.03, 1.63, 82.13, 89.52)
for id, vs, mm in [('steering-port', [[-SG[0], SG[2], rz(SG[4])], [-SG[1], SG[2], rz(SG[5])], [-SG[1], SG[3], rz(SG[5])], [-SG[0], SG[3], rz(SG[4])]], 65),
                   ('steering-starboard', [[SG[0], SG[2], rz(SG[4])], [SG[1], SG[2], rz(SG[5])], [SG[1], SG[3], rz(SG[5])], [SG[0], SG[3], rz(SG[4])]], 65),
                   ('steering-forward', [[-SG[0], SG[2], rz(SG[4])], [SG[0], SG[2], rz(SG[4])], [SG[0], SG[3], rz(SG[4])], [-SG[0], SG[3], rz(SG[4])]], 65),
                   ('steering-after', [[-SG[1], SG[2], rz(SG[5])], [SG[1], SG[2], rz(SG[5])], [SG[1], SG[3], rz(SG[5])], [-SG[1], SG[3], rz(SG[5])]], 65),
                   ('steering-roof', [[-SG[0], SG[3], rz(SG[4])], [SG[0], SG[3], rz(SG[4])], [SG[1], SG[3], rz(SG[5])], [-SG[1], SG[3], rz(SG[5])]], 25)]:
    plate(id, 'Steering-gear protection', vs, mm)

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (reference HP_flag_nation); the CXAM aerial on the
# foremast top turns, and the Mk 22 and after Mk 18 main battery directors train.
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='us-48', position=[0, 23.9, rz(29.6)], width=2.8, staffHeight=0)],
                radars=[dict(id='cxam-radar', nodeId='cxam-radar.yaw', rpm=5),
                        dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=40),
                        dict(id='after-director', nodeId='after-director.yaw', rpm=2, sweepDeg=55, phaseDeg=160)])
b['damageControl'] = dict(version=1, teams=3, setupSeconds=8, repairPoints=240, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.08, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Placeholder; author-damage-control.ts writes the shared fleet defaults.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
# Keep the gameplay helpers' output when the blueprint already has it (rerun them after hull or room changes).
if previous:
    for key in ('localDamage', 'floodRegions', 'stability', 'damageControl'):
        if key in previous and not (key in ('localDamage', 'damageControl') and 'Placeholder' in previous[key].get('basis', '')):
            b[key] = previous[key]
write(HERE / 'blueprint.json', b)
print(f'Authored pensacola: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, beam {beam:.2f} m, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates, {len(b["obstructions"])} obstructions.')

"""Original IJN Hyūga 1942 blueprint authoring, GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and
rebuilds everything except the measured hull stations and superstructure prisms, which it
keeps from the current blueprint unless fresh measurement files are passed:

  python3 assets/ships/hyuga/author-blueprint.py [--loft loft.json] [--structures structures.json]

The measurement files are produced in ignored .build/hyuga/ from the cached
`bun run ship:reference pjsb517` view (hull A, the only one; visual jsb049_hyuga_1942) with the
repository's own measurement code: hull stations walked by the ship:lines station walker from the
widest point of the shell up to the upper-deck edge or casemate ledge, then the forecastle's side or
wall read off ship:slice --plan footprints up to the forecastle deck edge found by vertical probes;
superstructure prisms from --plan raster cuts every 0.1 m of the hull group, mirrored, with our loft
and the main barbettes cleared, followed up through the levels into bands. They hold our own sampled
offsets, never source triangles. Mount datums come from the reference hardpoints (HP_*). The
repository tools do not expose the reference's armour model, so protection is provisional game
calibration. Run afterwards: author-local-damage (new ship only), author-flood-spaces,
author-stability and author-damage-control, always passing `hyuga`.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = -1.125          # reference z of the hull's mid-length; runtime z = reference z - ZC
L = 215.25           # stem head to the stern at the reference waterline datum
DRAFT = 9.7305       # keel below the reference waterline
DEPTH = 16.37        # keel to the midships forecastle deck
SPEED_KN = 25.3


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
    """Loft deck (runtime z) at the centreline."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    """Loft half-breadth at runtime z and height y."""
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='hyuga', name='IJN Hyūga',
         configuration='Hyūga · 1942 exterior after the GameModels3D pjsb517 A hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/hyuga.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=4, acceleration=.19, braking=.24, rudderRate=.32, maxYawRate=.024),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 27.0, rz(-37.2)]),
         structuralPlating=dict(hullMm=19, superstructureMm=13, note='Hull, bulge and deckhouse plating are provisional game values matching the fleet\'s battleship calibration; the repository tools do not expose the reference\'s armour model.'),
         accuracy=dict(exterior='Original loft and superstructure prisms measured from the approved GameModels3D pjsb517 A hull (jsb049_hyuga_1942) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Twelve 35.6 cm/45 Type 41 in six twin turrets, sixteen 14 cm/50 3rd Year Type casemates, eight 12.7 cm/40 Type 89 in four open twin mounts and twenty 25 mm Type 96 in ten twin mounts at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference datums, HP_*)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
MAIN_PART = 'type41-356-hyuga-twin'
# The Ise-class turret's yaw datum is the reference gunhouse floor (HP_JGM); the recipe raises each
# barbette to the bearing plane 0.25 m below it.
MAIN_DY = 0.0
MAIN = [('main-1', 'No. 1 turret', (8.078, -61.497), 0), ('main-2', 'No. 2 turret', (11.147, -48.649), 0),
        ('main-3', 'No. 3 turret', (9.143, 9.498), 180), ('main-4', 'No. 4 turret', (6.074, 22.049), 180),
        ('main-5', 'No. 5 turret', (8.898, 52.88), 180), ('main-6', 'No. 6 turret', (6.074, 65.43), 180)]
MAGAZINE = {'main-1': 'magazine-forward', 'main-2': 'magazine-forward', 'main-3': 'magazine-midships', 'main-4': 'magazine-midships',
            'main-5': 'magazine-after', 'main-6': 'magazine-after'}
for id, name, (y, z), bearing in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 35.6 cm', partId=MAIN_PART, battery='main', position=[0, round(y + MAIN_DY, 3), rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId=MAGAZINE[id], fire=FIRE_MAIN))
# Sixteen 14 cm casemates on the upper-deck ledge under the forecastle (HP_JGS; the reference stows them fore
# and aft). The mount datum is the casemate's seat, 0.86 m below the reference drum datum, on the ledge.
# bearingDeg is the arc centre (port sense; the starboard twin mirrors it); traverseDeg the half-sector.
CASEMATES = [(8.751, -55.711, 62, 55), (10.404, -49.906, 72, 62), (11.412, -42.021, 80, 64), (12.03, -35.05, 85, 64),
             (12.414, -27.283, 90, 58), (12.583, -19.995, 95, 50), (12.65, -10.776, 105, 62), (11.218, -5.539, 115, 58)]
for side, sign in [('p', -1), ('s', 1)]:
    for i, (x, z, centre, half) in enumerate(CASEMATES, 1):
        b['mounts'].append(dict(id=f'casemate-{side}{i}', name=f'{"Port" if sign < 0 else "Starboard"} casemate {i} 14 cm', partId='type3-140-hyuga-casemate',
                                battery='secondary', position=[round(sign * x, 3), round(5.211 - .86, 3), rz(z)], bearingDeg=sign * centre, traverseDeg=half,
                                rangefinder=False, magazineId='secondary-magazine-forward' if z < -30 else 'secondary-magazine-after', fire=FIRE_LIGHT))
HA = [('ha-1', -3.772, 12.24, -32.532, -90), ('ha-2', 3.773, 12.24, -32.532, 90), ('ha-3', -10.987, 7.131, -23.479, -90), ('ha-4', 10.988, 7.131, -23.479, 90)]
for id, x, y, z, bearing in HA:
    b['mounts'].append(dict(id=id, name=f'12.7 cm HA mount {id[-1]}', partId='type89-127-yamato-open-twin', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, traverseDeg=90, rangefinder=False, magazineId='ha-magazine', fire=FIRE_LIGHT))
AA25 = [(-2.172, 20.897, -33.943, -50), (2.172, 20.897, -33.943, 50), (-3.02, 26.4, -25.402, -90), (3.02, 26.4, -25.402, 90),
        (-4.09, 17.22, -7.413, -90), (4.09, 17.22, -7.413, 90), (-4.956, 17.478, 1.959, -90), (4.956, 17.478, 1.959, 90),
        (-3.249, 16.514, 38.574, -90), (3.249, 16.514, 38.574, 90)]
for i, (x, y, z, bearing) in enumerate(AA25, 1):
    b['mounts'].append(dict(id=f'aa25-{i}', name=f'25 mm twin {i}', partId='type96-25-mogami-2', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition', fire=FIRE_LIGHT))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    structures = json.loads(Path(opts.structures).read_text())['structures']
else:
    structures = previous['structures']
# Recorded corrections to the measured prisms, one per line: None drops a prism, a dict overrides fields.
STRUCTURE_EDITS = {}
structures = [dict(s, **STRUCTURE_EDITS[s['id']]) if STRUCTURE_EDITS.get(s['id']) else s for s in structures if s['id'] not in STRUCTURE_EDITS or STRUCTURE_EDITS[s['id']] is not None]


def regularize(poly, tol=.08, snap=math.tan(math.radians(5))):
    """Straighten a raster-traced outline: Douglas-Peucker at tol, then near-axis edges snapped square."""
    def rdp(pts):
        if len(pts) < 3:
            return pts
        (ax, az), (bx, bz) = pts[0], pts[-1]
        dx, dz = bx - ax, bz - az
        n = math.hypot(dx, dz) or 1e-9
        d = [abs((px - ax) * dz - (pz - az) * dx) / n for px, pz in pts[1:-1]]
        k = max(range(len(d)), key=d.__getitem__)
        if d[k] <= tol:
            return [pts[0], pts[-1]]
        return rdp(pts[:k + 2])[:-1] + rdp(pts[k + 1:])
    far = max(range(len(poly)), key=lambda i: math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]))
    ring = rdp(poly[:far + 1])[:-1] + rdp(poly[far:] + poly[:1])[:-1]
    if len(ring) < 3:
        return poly
    pts = [list(p) for p in ring]
    for _ in range(2):
        for i in range(len(pts)):
            a, c = pts[i], pts[(i + 1) % len(pts)]
            dx, dz = c[0] - a[0], c[1] - a[1]
            if abs(dx) <= snap * abs(dz):
                a[0] = c[0] = (a[0] + c[0]) / 2
            elif abs(dz) <= snap * abs(dx):
                a[1] = c[1] = (a[1] + c[1]) / 2
    out = []
    for p in pts:
        p = [round(p[0], 3), round(p[1], 3)]
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > .02:
            out.append(p)
    if len(out) > 3 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= .02:
        out.pop()
    area = sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(out, out[1:] + out[:1])) / 2
    before = sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(poly, poly[1:] + poly[:1])) / 2
    # Keep the traced outline if straightening collapsed or reversed it.
    return out if len(out) >= 3 and area * before > 0 and abs(area) > .8 * abs(before) else poly


if opts.structures:
    structures = [dict(s, footprint=regularize(s['footprint'])) for s in structures]
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

# Stowed boats (reference boat bounds: x, y and z ranges), so barrels stop at and cannot fire through them.
BOATS = [('dinghy', (5.41, 8.75), (6.98, 8.14), (-55.51, -49.69)), ('cutter-pagoda-outer', (6.64, 9.99), (9.17, 10.78), (-42.58, -33.51)),
         ('cutter-pagoda-inner', (3.0, 7.37), (9.17, 10.78), (-42.83, -34.2)), ('cutter-waist', (4.45, 9.21), (6.82, 8.42), (-7.07, 1.39)),
         ('cutter-quarter', (6.04, 8.94), (4.48, 6.09), (12.48, 21.74)), ('cutter-after', (1.91, 4.74), (4.5, 6.03), (26.88, 36.11)),
         ('motor-launch', (1.09, 4.95), (10.11, 11.79), (-23.46, -11.26))]
for name, (x0, x1), (y0, y1), (z0, z1) in BOATS:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))
for name, (x0, x1), (y0, y1), (z0, z1) in [('motor-boat-17m', (3.8, 8.04), (9.11, 14.81), (-24.18, -6.43)), ('landing-craft', (-8.59, -3.87), (9.58, 14.75), (-22.2, -7.46)),
                                           ('catapult', (2.14, 7.3), (4.77, 8.6), (74.34, 93.98))]:
    b['obstructions'].append(dict(id=name, center=[round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                  size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: the main and 12.7 cm barrels (with the full recoil stroke) and gunhouses may
# not enter the prisms they can reach, and superfiring pairs may not cross. Game clearance, not
# verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
clear_mounts, reach = [], {}
for m in b['mounts']:
    if m['battery'] != 'main' and not m['id'].startswith(('ha-', 'casemate-')):
        continue
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(w['barrelBaseRadius'] * .75, 3))
    if m['battery'] == 'main':
        # The Ise-class gunhouse in the yaw frame (x across, y up, z aft): 10.8 m long from 3.95 m ahead of the
        # pivot, 8.6 m wide, from its floor to the periscope hood over the roof ridge.
        entry['body'] = dict(center=[0, 1.7, 1.45], size=[8.6, 3.4, 10.8])
    clear_mounts.append(entry)
    rise = (w['muzzleForward'] + 1.5) * math.sin(math.radians(w['elevationMaxDeg']))
    reach[m['id']] = (m['position'], w['muzzleForward'] + 1.5, m['position'][1] + w['pivotHeight'], rise)
nearby = []
for st in structures:
    xs = [p[0] for p in st['footprint']]
    zs = [p[1] for p in st['footprint']]
    best = None
    for (x, y, z), r, pivot, rise in reach.values():
        dx = max(min(xs) - x, 0, x - max(xs))
        dz = max(min(zs) - z, 0, z - max(zs))
        if math.hypot(dx, dz) <= r and st['baseY'] < pivot + rise + 1 and st['baseY'] + st['height'] > pivot - 3:
            best = min(best if best is not None else 1e9, math.hypot(dx, dz))
    if best is not None:
        nearby.append((best, st['id']))
nearby = [sid for _, sid in sorted(nearby)[:128]]
# Superfiring pairs, No. 1 turret and the forward casemates, and neighbouring casemates on each side interlock.
pairs = [['main-1', 'main-2'], ['main-3', 'main-4'], ['main-5', 'main-6'], ['main-1', 'casemate-p1'], ['main-1', 'casemate-s1']]
for side in 'ps':
    pairs += [[f'casemate-{side}{i}', f'casemate-{side}{i + 1}'] for i in range(1, len(CASEMATES))]
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for the main, 14 cm and 12.7 cm mounts against the measured superstructure prisms they can reach, including the full recoil stroke, between the superfiring turret pairs, No. 1 turret and the forward casemates, and neighbouring casemates. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=pairs)

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
# Magazines under each superfiring pair; boiler rooms under the funnel between No. 2 and No. 3 barbettes;
# engine rooms between No. 4 and No. 5 barbettes (game estimates).
room('magazine-forward', 'Forward 35.6 cm magazines', [0, -5.4, rz(-55.0)], [13, 6.4, 22], 'magazine', hp=260, fire=MAG)
room('magazine-midships', 'Midships 35.6 cm magazines', [0, -5.4, rz(15.8)], [16, 6.4, 20], 'magazine', hp=260, fire=MAG)
room('magazine-after', 'After 35.6 cm magazines', [0, -5.4, rz(59.2)], [14, 6.2, 20], 'magazine', hp=260, fire=MAG)
room('secondary-magazine-forward', 'Forward 14 cm magazine', [0, -5.4, rz(-40.0)], [16, 6.4, 6], 'magazine', hp=150, fire=MAG)
room('secondary-magazine-after', 'After 14 cm magazine', [0, -5.4, rz(1.5)], [18, 6.4, 5], 'magazine', hp=150, fire=MAG)
room('ha-magazine', '12.7 cm and light AA magazine', [0, -1.9, rz(-30.5)], [11, 2.6, 5], 'magazine', hp=110, fire=MAG)
room('aa-ammunition', 'Light AA ready ammunition', [0, 2.4, rz(-21.0)], [8, 2.2, 5], 'magazine', hp=90, fire=MAG)
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -32.0, 9), ('boiler-room-2', 'No. 2 boiler room', -22.5, 9),
           ('boiler-room-3', 'No. 3 boiler room', -13.0, 9), ('boiler-room-4', 'No. 4 boiler room', -4.0, 8)]
for id, name, z, length in BOILERS:
    room(id, name, [0, -4.9, rz(z)], [22, 7.5, length], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -5.2, 32.5), ('engine-room-starboard-forward', 'Starboard forward engine room', 5.2, 32.5),
            ('engine-room-port-after', 'Port after engine room', -5.0, 42.5), ('engine-room-starboard-after', 'Starboard after engine room', 5.0, 42.5)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -5.2, rz(z)], [9.0, 6.8, 9.5], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -6.3, rz(76.0)], [12, 3.6, 12], fire=ENG)
SHAFTS = [('shaft-1', -6.5), ('shaft-2', -2.8), ('shaft-3', 2.8), ('shaft-4', 6.5)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[x * .8, -6.5, rz(76.0)], size=[.7, 1.1, 10], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -2.4, rz(92.0)], [8.0, 3.2, 12], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four boiler rooms under the funnel between No. 2 and No. 3 barbettes and four turbine rooms between No. 4 and No. 5, one group per shaft with equal shares. Room bounds and routing are estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
CAS_P = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-p')]
CAS_S = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-s')]
HA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('ha-')]
AA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('aa25-')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_JD/HP_JF): the Type 94 main director and 10 m rangefinder atop the pagoda,
# the after Type 94 director, the secondary rangefinders on the pagoda wings, the Type 91 high-angle
# directors and the Type 95 25 mm directors.
director('main-director', 'Type 94 main battery director and 10 m rangefinder', [0, 35.98, -31.95], MAIN_IDS, [3.2, 2.6, 3.4], 80, 13)
director('after-director', 'After Type 94 director', [0, 20.11, 44.27], MAIN_IDS, [2.4, 2.2, 2.6], 60, 10)
director('secondary-director-port', 'Port secondary rangefinder', [-6.10, 21.85, -26.50], CAS_P, [2.4, 1.4, 4.6], 40, 6)
director('secondary-director-starboard', 'Starboard secondary rangefinder', [6.10, 21.85, -26.50], CAS_S, [2.4, 1.4, 4.6], 40, 6)
director('ha-director-port', 'Port Type 91 high-angle director', [-7.31, 18.52, -26.50], HA_IDS, [2.4, 1.8, 2.4], 45, 6)
director('ha-director-starboard', 'Starboard Type 91 high-angle director', [7.31, 18.52, -26.50], HA_IDS, [2.4, 1.8, 2.4], 45, 6)
director('aa-director-port', 'Port Type 95 25 mm director', [-2.43, 31.98, -32.06], AA_IDS, [1.6, 1.6, 1.4], 30, 4)
director('aa-director-starboard', 'Starboard Type 95 25 mm director', [2.43, 31.98, -32.06], AA_IDS, [1.6, 1.6, 1.4], 30, 4)

# ---------------------------------------------------------------- protection (provisional game calibration)
NOTE = 'Provisional game protection with the fleet\'s capital-ship calibration, placed on the authored loft; the repository tools do not expose the reference\'s armour model.'


def plate(id, name, vs, mm, exterior=False, note=NOTE):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='game-calibration-ise-class', basis='inferred', note=note)))


def band(prefix, name, zref0, zref1, seg, y0, y1, mm, exterior, width):
    """Side plates between two heights on both sides; width(zref, y) gives the half breadth."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        for j in range(seg):
            za = zref0 + (zref1 - zref0) * j / seg
            zb = zref0 + (zref1 - zref0) * (j + 1) / seg
            ya0, ya1 = (y0(za) if callable(y0) else y0), (y1(za) if callable(y1) else y1)
            yb0, yb1 = (y0(zb) if callable(y0) else y0), (y1(zb) if callable(y1) else y1)
            vs = [[sign * width(za, ya0), ya0, rz(za)], [sign * width(zb, yb0), yb0, rz(zb)], [sign * width(zb, yb1), yb1, rz(zb)], [sign * width(za, ya1), ya1, rz(za)]]
            # The shell is curved, so each band is two planar triangles.
            plate(f'{prefix}-{side}-{j}-a', f'{side.title()} {name}', vs[:3], mm, exterior)
            plate(f'{prefix}-{side}-{j}-b', f'{side.title()} {name}', [vs[0], vs[2], vs[3]], mm, exterior)


def inner(zref, y):
    """The original shell inside the anti-torpedo bulges: the loft at that height less the bulge."""
    return max(1.0, half_breadth(rz(zref), y) - 2.1)


CIT_FWD, CIT_AFT = -68.0, 72.0
# Main belt on the original shell inside the bulges, then the lower side down to the bulge's foot.
band('belt', 'main belt', CIT_FWD, CIT_AFT, 28, -2.6, 1.4, 299, True, inner)
band('lower-side', 'lower side armour', CIT_FWD, CIT_AFT, 28, -6.0, -2.6, 102, False, lambda z, y: inner(z, y) * .99)
# Upper belt from the belt to the upper deck, and the casemate armour on the forecastle wall.
band('upper-belt', 'upper belt', -62.0, 30.0, 20, 1.4, 4.1, 203, True, lambda z, y: half_breadth(rz(z), y) * .996)
band('casemate-wall', 'casemate armour', -58.0, -3.0, 16, lambda z: deck_y(rz(z)) - 2.1, lambda z: deck_y(rz(z)) - .15, 152, True,
     lambda z, y: half_breadth(rz(z), y) * .996)
band('bow-belt', 'forward belt', -104.0, CIT_FWD, 12, -2.6, 1.4, 102, True, lambda z, y: half_breadth(rz(z), y) * .996)
band('stern-belt', 'after belt', CIT_AFT, 100.0, 8, -2.6, 1.4, 102, True, lambda z, y: half_breadth(rz(z), y) * .996)
for j in range(28):
    za = CIT_FWD + (CIT_AFT - CIT_FWD) * j / 28
    zb = CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / 28
    wa, wb = inner(za, 1.4) * .98, inner(zb, 1.4) * .98
    plate(f'armoured-deck-{j}', 'Armoured deck', [[-wa, 1.4, rz(za)], [wa, 1.4, rz(za)], [wb, 1.4, rz(zb)], [-wb, 1.4, rz(zb)]], 102)
    ua, ub = half_breadth(rz(za), 4.0) * .97, half_breadth(rz(zb), 4.0) * .97
    plate(f'upper-deck-{j}', 'Upper deck', [[-ua, 4.05, rz(za)], [ua, 4.05, rz(za)], [ub, 4.05, rz(zb)], [-ub, 4.05, rz(zb)]], 32)
for end, z, mm in [('forward', CIT_FWD, 203), ('after', CIT_AFT, 203)]:
    w = inner(z, 1.4) * .98
    wl = inner(z, -6.0) * .98
    plate('citadel-' + end, end.title() + ' armoured bulkhead', [[-wl, -6.0, rz(z)], [wl, -6.0, rz(z)], [w, 1.4, rz(z)], [-w, 1.4, rz(z)]], mm)
for m in b['mounts'][:6]:
    r = 4.75
    x, top, z = m['position']
    top -= MAIN_DY
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[r * math.cos(a), 1.4, z + r * math.sin(a)], [r * math.cos(c), 1.4, z + r * math.sin(c)], [r * math.cos(c), top, z + r * math.sin(c)], [r * math.cos(a), top, z + r * math.sin(a)]], 299)
# Conning tower at the foot of the pagoda, and the steering-gear box.
ct = dict(x0=-2.5, x1=2.5, y0=9.3, y1=12.2, z0=rz(-44.8), z1=rz(-40.6))
for id, vs, mm in [('ct-port', [[ct['x0'], ct['y0'], ct['z0']], [ct['x0'], ct['y0'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z0']]], 305),
                   ('ct-starboard', [[ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x1'], ct['y1'], ct['z0']]], 305),
                   ('ct-front', [[ct['x0'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x0'], ct['y1'], ct['z0']]], 305),
                   ('ct-back', [[ct['x0'], ct['y0'], ct['z1']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 305),
                   ('ct-roof', [[ct['x0'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 152)]:
    plate(id, 'Conning tower', vs, mm, True)
sg = dict(x=5.0, y0=-4.2, y1=-.6, z0=rz(84.0), z1=rz(100.0))
for id, vs, mm in [('steering-port', [[-sg['x'], sg['y0'], sg['z0']], [-sg['x'], sg['y0'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z0']]], 76),
                   ('steering-starboard', [[sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [sg['x'], sg['y1'], sg['z0']]], 76),
                   ('steering-after', [[-3.4, -4.2, sg['z1']], [3.4, -4.2, sg['z1']], [3.4, -.6, sg['z1']], [-3.4, -.6, sg['z1']]], 102),
                   ('steering-roof', [[-sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 76)]:
    plate(id, 'Steering-gear protection', vs, mm)
b['underwaterProtection'] = dict(version=1, basis='Estimated anti-torpedo bulge and side-protection system outside the belt; reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'bulge-{side}', name=f'{side.title()} anti-torpedo bulge', center=[sign * 15.2, -3.8, rz(2.0)],
                                             size=[3.2, 7.4, 128], damageReduction=.4, breachReduction=.4) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (reference HP_flag_nation).
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='ijn', position=[0, 30.76, rz(45.41)], width=4.0, staffHeight=0)], radars=[])
b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=320, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.09, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Placeholder; author-damage-control.ts writes the shared fleet defaults.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
# The gameplay helpers rewrite localDamage, the flood spaces and partitions, stability and
# damageControl from these rooms; rerun all four after this script (see the README).
write(HERE / 'blueprint.json', b)
print(f'Authored hyuga: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-local-damage, author-flood-spaces, author-stability, author-damage-control.')

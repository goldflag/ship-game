"""Pensacola blueprint authoring: a Blender-recipe preset scaffolded by `ship:new --legacy`.

The editable blueprint is the versioned asset. This recipe records how it was made and
rebuilds it. Every table below starts as a placeholder sized for a generic cruiser so the
starter compiles and builds; replace each one with values measured from the approved
reference (docs/ship-pipeline.md, Blender-recipe presets; assets/ships/alaska is a worked
example):

  python3 assets/ships/pensacola/author-blueprint.py [--loft loft.json]

`--loft` takes measured sections as {"sections": [{"station", "points": [[half breadth, height], ...]}]},
station in meters from the transom (0) to the stem (L), points from the keel up to the deck
edge, the same count in every section. Keep reference downloads and measurements in ignored
.build/. After any hull, structure or mount change run author-flood-spaces.ts,
author-stability.ts and, on a new ship, author-local-damage.ts and author-damage-control.ts
(see the README), then `bun run ship:build pensacola`.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
# Placeholder principal dimensions; replace with the reference's.
L = 180.0            # stem to transom at the design waterline
BEAM = 19.0
DRAFT = 6.4
DEPTH = 12.5         # keel to the midships weather deck
SPEED_KN = 32
STATIONS = 41
POINTS = 9


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


args = argparse.ArgumentParser()
args.add_argument('--loft')
opts = args.parse_args()

# ---------------------------------------------------------------- hull
def starter_section(s):
    """Placeholder section at fraction s of the length, from the transom (0) to the stem (1)."""
    fore = max(0, (s - .62) / .38)
    aft = max(0, (.25 - s) / .25)
    half = BEAM / 2 * (1 - fore ** 1.8) * (1 - .3 * aft ** 1.5)
    keel = -DRAFT + (DRAFT + 1) * fore ** 3 + DRAFT * .55 * aft ** 2
    deck = DEPTH - DRAFT + 2.2 * fore ** 2 + .4 * aft
    n = 2.2 + 2.8 * (1 - max(fore, aft))    # full midships, fine ends
    return [[round(half * (1 - (1 - k / (POINTS - 1)) ** n) ** (1 / n), 4), round(keel + (deck - keel) * k / (POINTS - 1), 4)] for k in range(POINTS)]


if opts.loft:
    sections = sorted(({'station': s['station'], 'points': s['points']} for s in json.loads(Path(opts.loft).read_text())['sections']), key=lambda s: s['station'])
else:
    sections = [{'station': round(L * i / (STATIONS - 1), 4), 'points': starter_section(i / (STATIONS - 1))} for i in range(STATIONS)]


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
    """Weather-deck height at runtime z (bow negative)."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / (b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


b = dict(schemaVersion=1, id='pensacola', name='Pensacola',
         configuration='Scaffolded starter · replace with the approved vessel, year and fit',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/pensacola.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=4, acceleration=.17, braking=.2, rudderRate=.34, maxYawRate=.02),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         structuralPlating=dict(hullMm=20, superstructureMm=12, note='Scaffold placeholder plating; replace with the reference or a stated game estimate.'),
         accuracy=dict(exterior='Scaffold placeholder hull and deckhouses; replace with the approved reference measurements.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates.',
                       weapons='Scaffold placeholder armament; ballistics, rates and damage are shared game calibration.'))

# ---------------------------------------------------------------- superstructure
# Prisms: footprint [x, z] in runtime meters (+X starboard, -Z bow), base and height in meters.
def rect(x0, x1, z0, z1):
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]


def structure(id, name, footprint, base, height, **extra):
    b['structures'].append(dict(id=id, name=name, footprint=footprint, baseY=round(base, 3), height=height, material='naval', **extra))


BRIDGE_Z = -.12 * L
structure('bridge', 'Bridge deckhouse', rect(-4, 4, BRIDGE_Z - 5, BRIDGE_Z + 5), deck_y(BRIDGE_Z), 6)
structure('bridge-upper', 'Upper bridge', rect(-3, 3, BRIDGE_Z - 3, BRIDGE_Z + 2), deck_y(BRIDGE_Z) + 6, 3)
FUNNEL = dict(z=.03 * L, half=1.8, length=6, height=12)
stadium = []
for i in range(32):
    a = i * math.tau / 32
    straight = FUNNEL['length'] / 2 - FUNNEL['half']
    stadium.append([round(FUNNEL['half'] * math.cos(a), 3), round(FUNNEL['z'] + math.copysign(straight, math.sin(a)) + FUNNEL['half'] * math.sin(a), 3)])
funnel_base = deck_y(FUNNEL['z'])
# A funnel is an exhaust structure; the smoke test counts it (ship:register adds the row).
structure('funnel', 'Funnel', stadium, funnel_base, FUNNEL['height'],
          exhaust=dict(position=[0, round(funnel_base + FUNNEL['height'], 3), FUNNEL['z']], width=2 * FUNNEL['half'], length=FUNNEL['length']))
structure('after-deckhouse', 'After deckhouse', rect(-3.5, 3.5, .1 * L, .17 * L), deck_y(.13 * L), 3)
b['viewpoints'] = dict(bridge=[0, round(deck_y(BRIDGE_Z) + 9.5, 3), round(BRIDGE_Z - 1, 3)])

# Firing obstructions: fore-and-aft strips of at most 3 m, so a stepped deckhouse is never
# boxed at its widest (turret clearance tests barrels against every obstruction box).
for s in b['structures']:
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] for p in s['footprint']]
    if s['height'] < 1.2 or 'exhaust' in s:
        continue
    n = max(1, math.ceil((max(zs) - min(zs)) / 3))
    for k in range(n):
        z0, z1 = min(zs) + (max(zs) - min(zs)) * k / n, min(zs) + (max(zs) - min(zs)) * (k + 1) / n
        b['obstructions'].append(dict(id=f"{s['id']}-{k}", center=[round((min(xs) + max(xs)) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((z0 + z1) / 2, 3)],
                                      size=[round(max(xs) - min(xs) - .4, 3), round(s['height'], 3), round(z1 - z0 - .2, 3)]))

# ---------------------------------------------------------------- mounts
# Catalog part IDs from `bun run part:list`; declare each part's `part:inputs` in recipe-inputs.json.
FIRE = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
MAIN = [('main-1', 'Turret A', -.26 * L, 0), ('main-2', 'Turret Y', .28 * L, 180)]
for id, name, z, bearing in MAIN:
    b['mounts'].append(dict(id=id, name=name, partId='us-8in55-mk14-mod1-triple', battery='main', position=[0, round(deck_y(z) + .6, 3), round(z, 3)],
                            bearingDeg=bearing, rangefinder=True, magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE))

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
LOW = round(-DRAFT + 2.4, 3)
room('magazine-forward', 'Forward magazine', [0, LOW, round(-.24 * L, 3)], [8, 4, 12], 'magazine', hp=200, fire=MAG)
room('magazine-after', 'After magazine', [0, LOW, round(.26 * L, 3)], [8, 4, 12], 'magazine', hp=200, fire=MAG)
room('boiler-room', 'Boiler room', [0, LOW, round(-.04 * L, 3)], [14, 4.5, 18], 'engine', 'boiler', 200, ENG)
room('engine-room', 'Engine room', [0, LOW, round(.07 * L, 3)], [14, 4.5, 18], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alley', [0, round(-DRAFT + 1.6, 3), round(.2 * L, 3)], [8, 2.4, 14], fire=ENG)
for i, x in enumerate([-2.2, 2.2], 1):
    b['modules'].append(dict(id=f'shaft-{i}', name=f'Shaft {i}', kind='engine', role='shaft', compartmentId='shaft-alley-room',
                             center=[x, round(-DRAFT + 1.4, 3), round(.2 * L, 3)], size=[.6, 1, 12], hp=90, immersionToleranceM=.5))
room('steering', 'Steering gear', [0, round(-DRAFT * .3, 3), round(.44 * L, 3)], [8, 2, 7], 'steering', hp=140, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[dict(id='main-drive', share=1, boilerIds=['boiler-room'], driveIds=['engine-room'], shaftIds=['shaft-1', 'shaft-2'])],
                       basis='Scaffold placeholder machinery: one boiler room and one engine room on two shafts.')
b['modules'].append(dict(id='main-director', name='Main battery director', kind='fire-control', placement='fixed', servesMountIds=[m['id'] for m in b['mounts']],
                         center=[0, round(deck_y(BRIDGE_Z) + 10, 3), round(BRIDGE_Z, 3)], size=[2.4, 2, 2.4], hp=60, protectionMm=10))

# ---------------------------------------------------------------- protection
def plate(id, name, vs, mm, exterior=False, note='Scaffold placeholder protection; replace with the reference or a stated game estimate.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='scaffold', basis='inferred', note=note)))


CIT_FWD, CIT_AFT, SEG = -.3 * L, .32 * L, 8
BELT_LOW, BELT_TOP = -1.5, 2.2
for side, sign in [('port', -1), ('starboard', 1)]:
    for j in range(SEG):
        z0, z1 = CIT_FWD + (CIT_AFT - CIT_FWD) * j / SEG, CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / SEG
        vs = [[sign * half_breadth(z0, BELT_LOW) * .998, BELT_LOW, z0], [sign * half_breadth(z1, BELT_LOW) * .998, BELT_LOW, z1],
              [sign * half_breadth(z1, BELT_TOP) * .998, BELT_TOP, z1], [sign * half_breadth(z0, BELT_TOP) * .998, BELT_TOP, z0]]
        # The shell is curved, so each belt band is two planar triangles.
        plate(f'belt-{side}-{j}-a', f'{side.title()} belt', vs[:3], 100, True)
        plate(f'belt-{side}-{j}-b', f'{side.title()} belt', [vs[0], vs[2], vs[3]], 100, True)
for j in range(SEG):
    z0, z1 = CIT_FWD + (CIT_AFT - CIT_FWD) * j / SEG, CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / SEG
    w0, w1 = half_breadth(z0, BELT_TOP) * .99, half_breadth(z1, BELT_TOP) * .99
    plate(f'armoured-deck-{j}', 'Armoured deck', [[-w0, BELT_TOP, z0], [w0, BELT_TOP, z0], [w1, BELT_TOP, z1], [-w1, BELT_TOP, z1]], 50)
for end, z in [('forward', CIT_FWD), ('after', CIT_AFT)]:
    w, wl = half_breadth(z, BELT_TOP) * .99, half_breadth(z, BELT_LOW) * .99
    plate('citadel-' + end, end.title() + ' armoured bulkhead', [[-wl, BELT_LOW, z], [wl, BELT_LOW, z], [w, BELT_TOP, z], [-w, BELT_TOP, z]], 100)

# ---------------------------------------------------------------- damage control
# Placeholders that compile; author-damage-control.ts and author-local-damage.ts replace them.
b['damageControl'] = dict(version=1, teams=3, setupSeconds=8, repairPoints=240, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.08, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Scaffold placeholder; author-damage-control.ts writes the shared fleet defaults.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
# An ensign (rig.ensigns, designs us-48, white-ensign, ijn, kriegsmarine) and radar pivots
# (rig.radars) go here once the brief names the nation and fit; see assets/ships/alaska.
write(HERE / 'blueprint.json', b)
print(f'Authored pensacola: {len(sections)} sections, {round(volume * 1.025)} t at the design waterline, {len(b["mounts"])} mounts, '
      f'{len(b["structures"])} structures, {len(b["armor"])} armour plates.')

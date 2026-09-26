"""Original IJN Nagato 1944 blueprint authoring, GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was first made and rebuilds
everything except the superstructure prisms, which it keeps from the current blueprint unless a fresh
measurement file is passed:

  python3 assets/ships/nagato/author-blueprint.py [--loft lines.json] [--structures superstructure.json]

The hull loft is `authoring/lines.json`, measured from the cached `bun run ship:reference pjsb010 --hull B_Hull`
view with `bun run ship:lines` (see that file's note). The superstructure prisms were grouped in ignored
.build/nagato/ from `ship:slice pjsb010 --plan y --sym --parts hull` cuts every 0.1 m: a band of levels whose
outline stays the same becomes one prism, and the forecastle deck block (casemate shelf to forecastle deck) is
the 5.0 m outline aft of the loft's forecastle break. Both hold our own sampled offsets, never source triangles.
Mount datums are the reference's HP_ nodes (`bun run ship:hardpoints pjsb010`). Protection, machinery,
magazines and every weapon value are provisional game calibration, not a historical survey: the repository's
reference tools expose no armour model. Run afterwards (see the README): author-local-damage.ts (first build
only), author-flood-spaces.ts, author-stability.ts and author-damage-control.ts nagato.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZC = -2.2            # runtime z = reference z - ZC (the loft is centred on its 225.2 m length)
L = 225.2            # stem to stern at the reference waterline datum
DRAFT = 9.3
DEPTH = 15.8         # keel to the midships forecastle deck
SPEED_KN = 25.0


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
args.add_argument('--loft', default=str(HERE / 'authoring/lines.json'))
args.add_argument('--structures')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
loft = json.loads(Path(opts.loft).read_text())
sections = [{'station': round(s['station'], 4), 'points': [[round(w, 4), round(max(y, -DRAFT), 4)] for w, y in s['points']]}
            for s in sorted(loft['sections'], key=lambda s: s['station'])]
sections[0]['station'] = 0
sections[-1]['station'] = L


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


def deck_y(z):
    """Loft deck height at runtime z (bow negative)."""
    return interp([(L / 2 - s['station'], s['points'][-1][1]) for s in reversed(sections)], z)


def half_breadth(z, y):
    station = L / 2 - z
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


volume = integrate(lambda s: area_below(s['points'], 0))
above = integrate(lambda s: area_below(s['points'], 50)) - volume
waterplane = integrate(lambda s: 2 * breadth_at(s['points'], 0))
beam = 2 * max(p[0] for s in sections for p in s['points'])

b = dict(schemaVersion=1, id='nagato', name='IJN Nagato',
         configuration='Nagato · 1944 exterior after the GameModels3D pjsb010 B hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/nagato.glb',
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=3.6, acceleration=.16, braking=.22, rudderRate=.3, maxYawRate=.021),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 27.6, rz(-33.6)]),
         structuralPlating=dict(hullMm=19, superstructureMm=13, note='Constructional plating of 19 mm on the hull and 13 mm on the superstructure; provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure prisms measured from the approved GameModels3D pjsb010 B hull (jsb010_nagato_1944) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Eight 41 cm/45 Type 3 in four twin turrets, eighteen 14 cm/50 3rd Year Type casemates, eight 12.7 cm/40 Type 89 in four twin mounts and 25 mm Type 96 in fourteen triple, twelve twin and twelve single mounts at the reference mount datums (twelve further singles are fixed fittings). Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    structures = json.loads(Path(opts.structures).read_text())
else:
    structures = previous['structures']
# Recorded corrections to the measured prisms, one per line: None drops a prism, a dict overrides fields.
STRUCTURE_EDITS = {
    'deckhouse-005': None,            # a scrap of the accommodation-ladder platform outboard of the upper deck
    'platform-065': None,             # one level of the sloped catwalk abaft the pagoda top, clear of every modelled wall
    'platform-075': None,             # ladder landings on the pagoda's after legs, which stand 3 m clear of the
    'platform-076': None,             # stepped prisms that model those legs
    'deckhouse-070': None,            # the lip under the 20.6 m platform's nose, closed down over the bridge windows
}
structures = [dict(s, **STRUCTURE_EDITS[s['id']]) if STRUCTURE_EDITS.get(s['id']) else s for s in structures
              if s['id'] not in STRUCTURE_EDITS or STRUCTURE_EDITS[s['id']] is not None]
# Structures the plan cuts cannot see. The compass bridge's windscreen is a single glazed plate round the roofed bridge
# between its deck and the 20.5 m platform (`ship:slice pjsb010 --section y=19.7`), open to the pagoda trunk aft:
# closed across the after ends of its arms.
STRUCTURE_ADDITIONS = [
    dict(id='compass-bridge', name='Compass bridge 19.05-20.45 m', baseY=19.05, height=1.4,
         footprint=[[-2.195, -40.090], [-3.235, -36.830], [-3.235, -35.550], [-4.600, -34.260], [-4.600, -33.140], [4.600, -33.140], [4.600, -34.260], [3.235, -35.550], [3.235, -36.830], [2.195, -40.090]]),
    # The deck abaft the pagoda at 17.4 m where the two 25 mm singles (HP_JGA) stand, with its bulwark and the rounded
    # ends outboard (sections y=17.6 and probes: plate 17.39-17.47 m, carried 2 cm up so its top is not coplanar with
    # the pagoda tier it meets); the level grouping folded it into the pagoda's narrower tiers.
    dict(id='platform-pagoda-aft', name='Pagoda after platform 17.40-17.49 m', baseY=17.4, height=.09,
         footprint=[[-6.410, -26.550], [-6.425, -26.490], [-7.500, -26.490], [-7.710, -26.210], [-7.710, -25.940], [-7.500, -25.670], [-6.630, -25.670], [-6.650, -25.590], [-6.550, -25.190], [-6.290, -24.940], [-5.960, -24.800], [5.880, -24.800], [6.210, -24.940], [6.470, -25.190], [6.560, -25.590], [6.541, -25.670], [7.500, -25.670], [7.710, -25.940], [7.710, -26.210], [7.500, -26.490], [6.344, -26.490], [6.330, -26.550], [6.200, -27.000], [-6.290, -27.000]]),
    # The deck under the compass bridge at 17.9 m inside the wall that rises to the windscreen, open aft (section
    # y=18.6, probes); the plan cuts saw only its thin wall.
    dict(id='deck-pagoda-lower-bridge', name='Pagoda deck 17.80-17.885 m', baseY=17.8, height=.085,
         footprint=[[-2.240, -40.090], [-2.550, -39.130], [-3.280, -36.830], [-3.280, -35.550], [-4.240, -34.640], [-4.640, -34.260], [-4.640, -29.130], [-5.590, -28.070], [-6.170, -27.430], [-6.280, -27.070], [-6.330, -26.870], [6.250, -26.870], [6.200, -27.070], [6.090, -27.430], [5.130, -28.490], [4.560, -29.130], [4.560, -34.260], [4.160, -34.640], [3.190, -35.550], [3.190, -36.830], [2.460, -39.130], [2.150, -40.090]]),
]
structures = [s for s in structures if s['id'] not in {a['id'] for a in STRUCTURE_ADDITIONS}] + STRUCTURE_ADDITIONS
structures = [{k: v for k, v in s.items() if k in ('id', 'name', 'footprint', 'baseY', 'height', 'material', 'exhaust', 'surface')} for s in structures]


def ear_clips(points):
    """The runtime's footprint triangulation (src/game/hullStructure.ts cap): False where it finds no ear."""
    def cross(a, b, c):
        return (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) - (points[b][1] - points[a][1]) * (points[c][0] - points[a][0])
    n = len(points)
    ids = list(range(n))
    if sum(points[i][0] * points[(i + 1) % n][1] - points[i][1] * points[(i + 1) % n][0] for i in range(n)) < 0:
        ids.reverse()
    while len(ids) > 2:
        for i in range(len(ids)):
            a, b, c = ids[i - 1], ids[i], ids[(i + 1) % len(ids)]
            if abs(cross(a, b, c)) < 1e-9 or not (cross(a, b, c) < 0 or any(
                    q not in (a, b, c) and cross(a, b, q) >= -1e-9 and cross(b, c, q) >= -1e-9 and cross(c, a, q) >= -1e-9 for q in ids)):
                ids.pop(i)
                break
        else:
            return False
    return True


# A traced outline's runs of millimetre steps can leave the runtime triangulation no ear: drop points within 1 cm of
# the last kept one and points within 2 mm of the line through their neighbours.
for s in structures:
    if s.get('surface') or ear_clips(s['footprint']):
        continue
    pts = []
    for q in s['footprint']:
        if not pts or math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1]) >= .01:
            pts.append(q)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            pa, pb, pc = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            base = math.hypot(pc[0] - pa[0], pc[1] - pa[1])
            if base < 1e-9 or abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])) / base < .002:
                pts.pop(i)
                changed = True
                break
    if not ear_clips(pts):
        raise SystemExit(f"{s['id']}: footprint cannot be triangulated")
    s['footprint'] = pts
for s in structures:
    s.setdefault('material', 'naval')
b['structures'] = structures


def footprint_area(poly):
    return abs(sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(poly, poly[1:] + poly[:1]))) / 2


# The forecastle deck block is watertight hull above the upper deck: it counts toward reserve buoyancy.
forecastle_volume = sum(footprint_area(s['footprint']) * s['height'] for s in structures if s['id'].startswith('forecastle-'))
b['hull'] = dict(kind='authored-stations-v1', length=L, beam=round(beam, 4), draft=DRAFT, depth=DEPTH,
                 massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round((above + forecastle_volume) * .55, 1),
                 halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
                 deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
                 keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
                 sections=sections)
b = {k: b[k] for k in ['schemaVersion', 'id', 'name', 'configuration', 'coordinates', 'modelUrl', 'hull', 'handling', 'mounts', 'armor',
                       'compartments', 'modules', 'connections', 'obstructions', 'structures', 'viewpoints', 'structuralPlating', 'accuracy']}

# ---------------------------------------------------------------- mounts (reference HP_ datums, reference frame)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# The catalog turrets were built against this reference's own gun visuals (jgm046 at A and Y, jgm047 at B,
# jgm048 at No. 3), so each sole sits exactly on its HP_JGM datum.
MAIN = [('main-1', 'No. 1 turret', 'type3-410-nagato-twin', (7.452, -63.715), 0, False),
        ('main-2', 'No. 2 turret', 'type3-410-nagato-twin-rf', (10.722, -49.296), 0, True),
        ('main-3', 'No. 3 turret', 'type3-410-nagato-twin-rf-aft', (8.199, 48.326), 180, True),
        ('main-4', 'No. 4 turret', 'type3-410-nagato-twin', (4.793, 63.18), 180, False)]
# The superfiring pair rest at 8 degrees, their barrels astride the lower turret's rear-roof arch and davit (1.6 m
# across, to 4.76 m over its sole); laid lower within about 10 degrees of the centreline they pass through them, as
# the reference's own turrets would (the arch and davit are left out of the envelope below: see the README).
REST_ELEVATION = {'main-2': 8, 'main-3': 8}
for id, name, part, (y, z), bearing, rangefinder in MAIN:
    mount = dict(id=id, name=name + ' 41 cm', partId=part, battery='main', position=[0, y, rz(z)], bearingDeg=bearing,
                 rangefinder=rangefinder, magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE_MAIN)
    if id in REST_ELEVATION:
        mount['initialElevationDeg'] = REST_ELEVATION[id]
    b['mounts'].append(mount)
# Eighteen 14 cm casemates (HP_JGS, jgs053): the forward lower row on the casemate shelf, the upper row on the
# forecastle deck and the after pair each side on the upper deck. bearingDeg is the arc centre; the reference
# rests them trained fore or aft along the side, which the rest rule reproduces.
CASEMATES = [('l1', 12.397, 4.031, -33.607), ('u1', 8.620, 6.933, -29.641), ('l2', 12.956, 4.026, -25.290), ('u2', 9.275, 6.933, -20.315),
             ('l3', 13.260, 4.026, -17.313), ('u3', 9.647, 6.933, -12.342), ('l4', 13.208, 4.026, -9.136), ('a1', 12.789, 3.780, 14.484),
             ('a2', 11.512, 3.780, 21.540)]
CASEMATE_ARC = {'l': (90, 80), 'u': (90, 80), 'a': (90, 75)}
# Degrees of train from the beam toward the bow and toward the stern where the barrel stays clear of the ship:
# No. 1 upper stops short of the pagoda base overhang, No. 3 upper of the boat crane, No. 4 lower of the deck-edge
# sponson and the sheet anchor, the first after gun of the sponson above it (sweep contacts; game stops).
CASEMATE_LIMITS = {'u1': (80, 65), 'u3': (80, 35), 'l4': (80, 35), 'a1': (60, 75), 'a2': (60, 75)}
for side, sign in [('p', -1), ('s', 1)]:
    for key, x, y, z in CASEMATES:
        centre, half = CASEMATE_ARC[key[0]]
        mount = dict(id=f'casemate-{side}{key}', name=f'{"Port" if sign < 0 else "Starboard"} casemate {key} 14 cm', partId='type3-140-nagato-casemate',
                     battery='secondary', position=[round(sign * x, 3), y, rz(z)], bearingDeg=sign * centre, traverseDeg=half, rangefinder=False,
                     magazineId='secondary-magazine-forward' if z < 0 else 'secondary-magazine-after', fire=FIRE_LIGHT)
        if key in CASEMATE_LIMITS:
            fwd, aft = CASEMATE_LIMITS[key]
            # Compass sense relative to the arc centre: toward the bow is negative on the starboard side.
            mount['traverseLimitsDeg'] = [-aft, fwd] if sign < 0 else [-fwd, aft]
        b['mounts'].append(mount)
# Four twin 12.7 cm Type 89 (HP_JGS 1, 23, 24, 25; jgs009 is the catalog A1 twin's own reference visual).
HA = [('ha-1', -8.417, 11.404, -25.208, -90), ('ha-2', 8.417, 11.404, -25.208, 90), ('ha-3', -6.418, 8.315, 15.782, -110), ('ha-4', 6.419, 8.315, 15.782, 110)]
for id, x, y, z, bearing in HA:
    b['mounts'].append(dict(id=id, name=f'12.7 cm HA mount {id[-1]}', partId='type89-127-a1-twin', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='ha-magazine', fire=FIRE_LIGHT))
# 25 mm Type 96 (HP_JGA): triples jga173, twins jga019, singles jga018, reference datum and rest bearing.
TRIPLES = [(-6.198, 9.320, -41.004, -90), (6.198, 9.320, -41.004, 90), (0, 13.527, -23.213, 180), (-13.422, 6.446, -2.049, -90), (13.422, 6.446, -2.049, 90),
           (-13.330, 6.451, 3.851, -90), (13.331, 6.451, 3.851, 90), (-2.415, 4.382, 96.447, -135), (2.415, 4.382, 96.447, 135), (0, 4.407, 99.039, 180)]
TWINS = [(-3.736, 20.616, -36.208, -45), (3.737, 20.616, -36.208, 45), (-4.861, 13.535, -33.970, -90), (4.862, 13.535, -33.970, 90),
         (-4.958, 21.096, -29.211, -90), (4.958, 21.096, -29.211, 90), (-8.616, 11.352, -19.326, -90), (8.616, 11.352, -19.326, 90),
         (-4.344, 14.835, 0.963, -90), (4.346, 14.835, 0.963, 90), (-2.838, 17.228, 2.694, -90), (2.838, 17.228, 2.694, 90)]
# A blueprint holds at most 64 mounts: the twelve singles of the forecastle-head and quarterdeck groups
# (HP_JGA 1-5, 7 and 38-43) are fixed fittings drawn by the recipe (nagato_kit.FIXED_SINGLES); these train.
SINGLES = [(-10.446, 6.492, -46.744, -45), (10.523, 6.491, -46.738, 45), (-11.433, 6.486, -42.318, -45), (11.759, 6.483, -42.315, 45),
           (-5.743, 17.484, -28.125, -90), (5.744, 17.484, -28.125, 90), (-1.155, 20.249, 19.643, -119), (1.128, 20.246, 19.751, 109),
           (-12.466, 3.705, 45.527, -135), (12.644, 3.675, 43.749, 135), (-12.090, 3.759, 49.410, -135), (12.173, 3.747, 48.509, 135)]
# The two singles inside the mainmast tripod work only abaft and outboard of its legs, over the searchlight-control
# sights, never depressed; the two on the deck abaft the pagoda work outboard, clear of the wall under the compass
# bridge forward and their deck's bulwark aft (game stops, not historical ones).
SINGLE_STOPS = {5: dict(traverseDeg=50), 6: dict(traverseDeg=50),
                7: dict(bearingDeg=-110, traverseDeg=40, elevationMinDeg=0), 8: dict(bearingDeg=110, traverseDeg=40, elevationMinDeg=0)}
for group, part, rows, label in [('aa3', 'type96-25-triple', TRIPLES, 'triple'), ('aa2', 'type96-25-mogami-2', TWINS, 'twin'),
                                 ('aa1', 'type96-25-kongo-single', SINGLES, 'single')]:
    for i, (x, y, z, bearing) in enumerate(rows, 1):
        mount = dict(id=f'{group}-{i}', name=f'25 mm {label} {i}', partId=part, battery='secondary', position=[x, y, rz(z)],
                     bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition', fire=FIRE_LIGHT)
        if group == 'aa1' and i in SINGLE_STOPS:
            mount.update(SINGLE_STOPS[i])
        b['mounts'].append(mount)
# Two triples on the roofs of Nos. 2 and 3 turrets train with them (HP_JGM_2/3_HP_JGA; neutral datums).
for parent, rows in [('main-2', [(-1.900, 13.998, -48.096, 0), (1.901, 13.998, -48.098, 0)]), ('main-3', [(1.899, 11.475, 47.109, 180), (-1.899, 11.475, 47.109, 180)])]:
    for i, (x, y, z, bearing) in enumerate(rows, 1):
        b['mounts'].append(dict(id=f'aa3-{parent[-1]}{i}', name=f'25 mm triple on No. {parent[-1]} turret {i}', partId='type96-25-triple', battery='secondary',
                                position=[x, y, rz(z)], bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition', fire=FIRE_LIGHT, parentMountId=parent))

# ---------------------------------------------------------------- firing obstructions
# Boxes kept inside the visual walls for substantial blocks. Each outline is cut into fore-and-aft strips of at
# most 3 m so a stepped deckhouse is not boxed at its widest.
for s in structures:
    poly = s['footprint']
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    if s['height'] < 1.2 or (max(xs) - min(xs)) * (max(zs) - min(zs)) < 6 or 'exhaust' in s:
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
# The 6 m dinghy stowed on the forecastle deck abreast the bridge (the reference's part bounds, with its chocks, oars
# and gripes to 8.0 m) lies in No. 1 turret's depressed arc trained well aft: its barrels stop at it.
b['obstructions'].append(dict(id='dinghy-stowage', center=[-7.083, 7.26, rz(-53.203)], size=[2.2, 1.52, 6.3]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes for every hull-mounted gun except the casemates (whose drums turn half inside their wall
# recesses): barrels with the full recoil stroke and the rotating bodies may not enter the measured prisms they can
# reach, and neighbouring mounts whose working circles overlap may not cross (Takao's scheme). Game clearance, not
# verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
# Rotating bodies in the yaw frame (x across, y up, z aft): the 41 cm gunhouses below; the open mounts' carriages,
# seats and magazines behind their trunnions.
BODIES = {'type89-127-a1-twin': dict(center=[0, 1.2, .35], size=[2.9, 2.4, 2.6]),
          'type96-25-triple': dict(center=[0, .95, .3], size=[2.0, 1.9, 1.7]),
          'type96-25-mogami-2': dict(center=[0, .95, .25], size=[1.7, 1.9, 1.6]),
          'type96-25-kongo-single': dict(center=[0, .9, .25], size=[.8, 1.8, 1.2])}
clear_mounts, reach = [], {}
for m in b['mounts']:
    if m['partId'].startswith('type3-140') or m.get('parentMountId'):
        continue
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(max(w['barrelBaseRadius'] * .8, .05), 3))
    if m['battery'] == 'main':
        # Gunhouses measured on the catalog turrets: a box over the full-width middle and capsules for the tapered
        # face and after end, so the corners the real houses cut away do not meet their neighbours. The plain turrets
        # (the lower of each superfiring pair): the middle 10.2 m across to 3.72 m from 3.05 m ahead of the axis to
        # 4.0 m abaft it, the face (8.2 m across, to 3.62 m, to 5.6 m ahead) and after end (8.1 m across, to 3.87 m,
        # to 7.27 m abaft); their rear-roof arch and davit are left out (see the README). No. 2: the middle 10.4 m
        # across to 4.05 m and 5.0 m abaft, the face (8.2 m across, to 2.7 m) and after end (8.1 m across, to 4.0 m,
        # to 7.1 m abaft); No. 3: 11.2 m across to 4.18 m and 7.8 m abaft, and its face (9.5 m across). Both carry
        # their rangefinder end hoods (4.8-6.0 m out, to 4.56 m, No. 3 to 5.05 m) and roof sight hood.
        if not m['rangefinder']:
            entry['body'] = dict(center=[0, 1.86, .475], size=[10.2, 3.72, 7.05])
            entry['fittings'] = [dict(joint='yaw', a=[-2.3, 1.81, -4.31], b=[2.3, 1.81, -4.31], radiusM=1.81),
                                 dict(joint='yaw', a=[-2.43, 2.24, 5.64], b=[2.43, 2.24, 5.64], radiusM=1.63)]
        else:
            aft = m['partId'].endswith('rf-aft')
            if aft:
                entry['body'] = dict(center=[0, 2.09, 2.425], size=[11.2, 4.18, 10.75])
                entry['fittings'] = [dict(joint='yaw', a=[-3.4, 1.35, -4.3], b=[3.4, 1.35, -4.3], radiusM=1.3)]
            else:
                entry['body'] = dict(center=[0, 2.025, .975], size=[10.4, 4.05, 8.05])
                entry['fittings'] = [dict(joint='yaw', a=[-2.8, 1.35, -4.3], b=[2.8, 1.35, -4.3], radiusM=1.3)]
                entry['fittings'] += [dict(joint='yaw', a=[-3.0, y, 6.05], b=[3.0, y, 6.05], radiusM=1.06) for y in (1.0, 3.0)]
            hy, h0, h1 = (4.29, 3.13, 5.71) if aft else (3.8, 2.48, 5.06)
            cy, cz = (5.02, 6.08) if aft else (4.79, 5.43)
            entry['fittings'] += [dict(joint='yaw', a=[s * 5.38, hy, h0], b=[s * 5.38, hy, h1], radiusM=.76) for s in (-1, 1)]
            entry['fittings'].append(dict(joint='yaw', a=[-.7, cy, cz], b=[0, cy, cz], radiusM=.6 if aft else .55))
    else:
        entry['body'] = BODIES[m['partId']]
    clear_mounts.append(entry)
    reach[m['id']] = (m['position'], w['muzzleForward'] + (1.5 if m['battery'] == 'main' else 1.0), m['position'][1] + w['pivotHeight'])
pairs = []
ids = list(reach)
for i, a in enumerate(ids):
    for c in ids[i + 1:]:
        (pa, ra, _), (pc, rc, _) = reach[a], reach[c]
        if math.hypot(pa[0] - pc[0], pa[2] - pc[2]) < ra + rc - 1.0 and abs(pa[1] - pc[1]) < 3.6:
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
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for every hull-mounted gun but the casemates (41 cm, 12.7 cm and 25 mm) against the measured superstructure prisms they can reach, including the full recoil stroke, and between neighbouring mounts whose working circles overlap. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=neighbors)

# ---------------------------------------------------------------- rooms, machinery, directors (reference z)
def room(id, name, center, size, kind=None, role=None, hp=150, fire=None):
    cid = id + '-room'
    center = [center[0], center[1], rz(center[2])]
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
room('magazine-forward', 'Forward 41 cm magazines', [0, -5.4, -56.5], [15, 6.4, 26], 'magazine', hp=280, fire=MAG)
room('magazine-after', 'After 41 cm magazines', [0, -5.2, 55.8], [14, 6.0, 25], 'magazine', hp=280, fire=MAG)
room('secondary-magazine-forward', 'Forward 14 cm magazine', [0, -5.4, -39.5], [16, 6.4, 7], 'magazine', hp=150, fire=MAG)
room('secondary-magazine-after', 'After 14 cm magazine', [0, -5.2, 39.2], [16, 6.2, 6], 'magazine', hp=150, fire=MAG)
room('ha-magazine', '12.7 cm and light AA magazine', [0, -1.8, -31.0], [12, 2.6, 6], 'magazine', hp=110, fire=MAG)
room('aa-ammunition', 'Light AA ready ammunition', [0, 2.2, -22.0], [9, 2.2, 6], 'magazine', hp=90, fire=MAG)
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -29.5, 11), ('boiler-room-2', 'No. 2 boiler room', -18.5, 11),
           ('boiler-room-3', 'No. 3 boiler room', -7.5, 11), ('boiler-room-4', 'No. 4 boiler room', 3.5, 11)]
for id, name, z, length in BOILERS:
    room(id, name, [0, -4.9, z], [23, 7.5, length], 'engine', 'boiler', 230, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -5.4, 15.5), ('engine-room-starboard-forward', 'Starboard forward engine room', 5.4, 15.5),
            ('engine-room-port-after', 'Port after engine room', -5.0, 29.0), ('engine-room-starboard-after', 'Starboard after engine room', 5.0, 29.0)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -5.2, z], [9.4 if abs(x) > 5.2 else 8.8, 6.8, 12.5], 'engine', 'turbine', 210, ENG)
room('shaft-alley', 'Shaft alleys', [0, -5.6, 76.0], [10, 3.4, 16], fire=ENG)
SHAFTS = [('shaft-1', -4.6), ('shaft-2', -1.6), ('shaft-3', 1.6), ('shaft-4', 4.6)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[x, -5.9, rz(76.0)], size=[.7, 1.1, 15], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -2.2, 90.5], [8.0, 3.2, 13], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four boiler rooms under the funnel and four turbine rooms between the funnel and No. 3 turret, one group per shaft with equal shares. Room bounds and routing are estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
CAS_P = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-p')]
CAS_S = [m['id'] for m in b['mounts'] if m['id'].startswith('casemate-s')]
HA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('ha-')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


director('main-director', 'Main battery director (Type 94) and 10 m rangefinder', [0, 37.41, -31.55], MAIN_IDS, [3.5, 1.9, 3.5], 80, 13)
director('after-director', 'After main battery control and 4.5 m rangefinders', [0, 17.58, 23.53], MAIN_IDS, [8.0, 1.2, 3.2], 60, 10)
director('secondary-director-port', 'Port secondary director and 4.5 m rangefinder', [-4.41, 24.52, -34.52], CAS_P, [2.4, 1.2, 4.9], 40, 6)
director('secondary-director-starboard', 'Starboard secondary director and 4.5 m rangefinder', [4.41, 24.52, -34.52], CAS_S, [2.4, 1.2, 4.9], 40, 6)
director('ha-director-port', 'Port Type 91 high-angle director', [-11.55, 12.05, -4.71], HA_IDS, [2.7, 2.0, 2.7], 45, 6)
director('ha-director-starboard', 'Starboard Type 91 high-angle director', [11.55, 12.05, -4.71], HA_IDS, [2.7, 2.0, 2.7], 45, 6)

# ---------------------------------------------------------------- protection (provisional game values)
NOTE = ('Commonly published Nagato protection values used as provisional game calibration; zones fitted to the authored loft. '
        'The repository reference tools expose no armour model for pjsb010.')


def plate(id, name, vs, mm, exterior=False, note=NOTE):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='game-calibration-nagato', basis='inferred', note=note)))


def inner(zref, y):
    """The original shell inside the anti-torpedo bulges: 90% of the loft's half breadth (29 m original beam)."""
    return half_breadth(rz(zref), y) * .9


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


CIT_FWD, CIT_AFT = -70.5, 70.0            # reference z of the armoured citadel ends (Nos. 1 and 4 barbettes)
band('belt', 'main belt', CIT_FWD, CIT_AFT, 28, -1.6, 1.8, 305, True, inner)
band('belt-lower', 'lower belt', CIT_FWD, CIT_AFT, 28, -3.4, -1.6, 229, True, inner)
band('lower-side', 'lower side protection', CIT_FWD, CIT_AFT, 28, -7.6, -3.4, 76, False, lambda z, y: inner(z, y) * .99)
band('upper-belt', 'upper belt', -58.0, 58.0, 22, 1.8, 3.66, 229, True, lambda z, y: half_breadth(rz(z), y) * .996)
band('bow-belt', 'forward belt', -104.0, CIT_FWD, 10, -1.6, 1.8, 102, True, lambda z, y: half_breadth(rz(z), y) * .996)
band('stern-belt', 'after belt', CIT_AFT, 96.0, 8, -1.6, 1.8, 102, True, lambda z, y: half_breadth(rz(z), y) * .996)
fc = next((s for s in structures if s['id'] == 'forecastle-001'), None)
if fc:
    # Casemate battery walls: splinter plating on the forecastle block's sides between the shelf and the deck.
    band('casemate-wall', 'casemate battery plating', -55.0, 12.0, 16, 3.8, 6.4, 25, True,
         lambda z, y: max((abs(x) for x, zz in fc['footprint'] if abs(zz - rz(z)) < 1.2), default=10) * .995)
for j in range(28):
    za = CIT_FWD + (CIT_AFT - CIT_FWD) * j / 28
    zb = CIT_FWD + (CIT_AFT - CIT_FWD) * (j + 1) / 28
    wa, wb = inner(za, 1.8) * .98, inner(zb, 1.8) * .98
    plate(f'armoured-deck-{j}', 'Armoured deck', [[-wa, 1.8, rz(za)], [wa, 1.8, rz(za)], [wb, 1.8, rz(zb)], [-wb, 1.8, rz(zb)]], 102)
    for side, sign in [('port', -1), ('starboard', 1)]:
        ia, ib = inner(za, -1.6) * .98, inner(zb, -1.6) * .98
        ma, mb = wa * .8, wb * .8
        vs = [[sign * ma, 1.8, rz(za)], [sign * mb, 1.8, rz(zb)], [sign * ib, -1.6, rz(zb)], [sign * ia, -1.6, rz(za)]]
        plate(f'deck-slope-{side}-{j}-a', f'{side.title()} armoured deck slope', vs[:3], 76)
        plate(f'deck-slope-{side}-{j}-b', f'{side.title()} armoured deck slope', [vs[0], vs[2], vs[3]], 76)
    uy = min(deck_y(rz(za)), deck_y(rz(zb)), 3.72) - .04
    ua, ub = half_breadth(rz(za), uy) * .97, half_breadth(rz(zb), uy) * .97
    plate(f'upper-deck-{j}', 'Upper deck', [[-ua, uy, rz(za)], [ua, uy, rz(za)], [ub, uy, rz(zb)], [-ub, uy, rz(zb)]], 69)
for end, z, mm in [('forward', CIT_FWD, 305), ('after', CIT_AFT, 305)]:
    w, wl = inner(z, 1.8) * .98, inner(z, -7.6) * .98
    plate('citadel-' + end, end.title() + ' armoured bulkhead', [[-wl, -7.6, rz(z)], [wl, -7.6, rz(z)], [w, 1.8, rz(z)], [-w, 1.8, rz(z)]], mm)
for m in b['mounts'][:4]:
    r = 4.85
    x, top, z = m['position']
    floor = 1.8
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[r * math.cos(a), floor, z + r * math.sin(a)], [r * math.cos(c), floor, z + r * math.sin(c)], [r * math.cos(c), top, z + r * math.sin(c)], [r * math.cos(a), top, z + r * math.sin(a)]], 305)
# Conning tower in the pagoda base and the steering-gear box.
ct = dict(x0=-2.6, x1=2.6, y0=9.4, y1=12.6, z0=rz(-42.2), z1=rz(-37.6))
for id, vs, mm in [('ct-port', [[ct['x0'], ct['y0'], ct['z0']], [ct['x0'], ct['y0'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z0']]], 369),
                   ('ct-starboard', [[ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x1'], ct['y1'], ct['z0']]], 369),
                   ('ct-front', [[ct['x0'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x0'], ct['y1'], ct['z0']]], 369),
                   ('ct-back', [[ct['x0'], ct['y0'], ct['z1']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 369),
                   ('ct-roof', [[ct['x0'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 203)]:
    plate(id, 'Conning tower', vs, mm, True)
sg = dict(x=5.2, y0=-4.4, y1=-.4, z0=rz(84.0), z1=rz(97.0))
for id, vs, mm in [('steering-port', [[-sg['x'], sg['y0'], sg['z0']], [-sg['x'], sg['y0'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z0']]], 102),
                   ('steering-starboard', [[sg['x'], sg['y0'], sg['z0']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [sg['x'], sg['y1'], sg['z0']]], 102),
                   ('steering-after', [[-sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y0'], sg['z1']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 152),
                   ('steering-roof', [[-sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z0']], [sg['x'], sg['y1'], sg['z1']], [-sg['x'], sg['y1'], sg['z1']]], 102)]:
    plate(id, 'Steering-gear protection', vs, mm)
b['underwaterProtection'] = dict(version=1, basis='Estimated anti-torpedo bulge and side-protection system outside the belt; reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'bulge-{side}', name=f'{side.title()} anti-torpedo bulge', center=[sign * 15.6, -4.2, rz(0.0)],
                                             size=[2.6, 7.6, 132], damageReduction=.4, breachReduction=.4) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (HP_flag_nation).
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='ijn', position=[0, 39.5, rz(20.4)], width=4.2, staffHeight=0)],
                radars=[dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=40)])
if previous and previous.get('damageControl') and 'Scaffold' not in previous['damageControl'].get('basis', ''):
    b['damageControl'] = previous['damageControl']
else:
    b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=340, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                              portablePumpM3PerSecond=.09, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                              basis='Provisional battleship crew and finite-stores calibration; not historical manning or damage-control performance.')
# Local damage is authored once by its helper and kept across reruns; flood spaces and stability are
# recomputed by their helpers after every run.
if previous and previous.get('localDamage') and 'Placeholder' not in previous['localDamage'].get('basis', ''):
    b['localDamage'] = previous['localDamage']
b.setdefault('localDamage', dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                                 basis='Placeholder; author-local-damage.ts replaces it.'))
write(HERE / 'blueprint.json', b)
print(f'Authored nagato: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-flood-spaces, author-stability, author-local-damage, author-damage-control.')

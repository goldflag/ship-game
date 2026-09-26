"""Original USS New Orleans (CA-32) blueprint authoring (1944 fit), GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and rebuilds it:

  python3 assets/ships/new-orleans/author-blueprint.py [--structures structures.json] [--keep-gameplay]

- Hull: `authoring/lines.json`, measured with `authoring/measure-lines.ts` (the shared ship:lines walk) over the
  cached `bun run ship:reference pasc107 --hull B_Hull --name pasc107-b` view of GameModels3D vehicle pasc107
  (hull asc014_new_orlean_1944, configuration B_Hull).
- Superstructure: blocks measured with `authoring/plans.ts` and `authoring/structures.py` (plan cuts every 0.05 m,
  carried up into prisms and lofted blocks), passed with `--structures`; without it the current blueprint's blocks
  are kept.
- Mounts at the reference's hardpoint datums, each foot on the deck the reference stands it on; armour zones and
  thicknesses from the reference's armour model (asc014_new_orlean_1944 armour), placed on this loft; directors at
  the reference director datums. Machinery, magazines, flood spaces and stability are provisional game estimates.
- Interlocks: the traced bulwarks and tubs within a gun's reach (`new_orleans_walls.py`, from `authoring/walls.py`)
  become 6 cm structures the barrels are tested against, the ready-use lockers by the guns (`new_orleans_lockers.py`)
  firing obstructions, and a light gun whose barrel would rest on the wall ahead of it rests elevated.

Run afterwards: author-local-damage (new ship only), author-flood-spaces, author-stability and author-damage-control,
always passing `new-orleans` (see the README). `--keep-gameplay` keeps the current blueprint's local damage, flood
regions, compartment connections, stability and damage control, and its rooms and modules as the helpers left them,
for a change that does not touch them (it then reproduces the blueprint exactly).
"""
import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from new_orleans_lockers import LOCKERS  # noqa: E402
from new_orleans_walls import WALLS  # noqa: E402
LINES = json.loads((HERE / 'authoring/lines.json').read_text())
ZS = LINES['zShift']     # runtime z = reference z + ZS
L = LINES['length']      # stem head to the stern's after end at the reference waterline datum
SPEED_KN = 32.7


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
args.add_argument('--keep-gameplay', action='store_true')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
sections = [{'station': round(s['station'], 4), 'points': [[round(w, 4), round(y, 4)] for w, y in s['points']]}
            for s in sorted(LINES['sections'], key=lambda s: s['station'])]
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
DRAFT = round(-min(s['points'][0][1] for s in sections), 3)


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


DEPTH = round(deck_y(0) + DRAFT, 3)
hull = dict(kind='authored-stations-v1', length=L, beam=round(beam, 4), draft=DRAFT, depth=DEPTH,
            massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round(above * .55, 1),
            halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
            deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
            keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
            sections=sections)

b = dict(schemaVersion=1, id='new-orleans', name='New Orleans',
         configuration='USS New Orleans (CA-32) · 1944 exterior after the GameModels3D pasc107 B_Hull fit (hull asc014_new_orlean_1944) · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/new-orleans.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=5, acceleration=.19, braking=.18, rudderRate=.4, maxYawRate=.022),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 17.6, rz(-31.0)]),
         structuralPlating=dict(hullMm=25, superstructureMm=13, note='Hull and superstructure plating read from the approved GameModels3D armour model (25 mm constructional hull, 13 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure blocks measured from the approved GameModels3D pasc107 B_Hull configuration (hull asc014_new_orlean_1944) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Nine 8-inch/55 in three triple CA-32 pattern turrets, eight single 5-inch/25 Mk 19, six quadruple 40 mm Bofors Mk 2, seventeen twin and nine single 20 mm Oerlikons at the reference mount datums. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference hardpoints)
# (id, name, x, deck y under the foot, reference z, bearing): the foot stands on the deck the reference stands
# the mount on (HP nodes sit up to 5 cm below it). Bearings are the reference's; a wing 5-inch mount's bearing
# is the centre of its beam arc, so the game rests it trained fore or aft.
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
MAIN = [('main-1', 'No. 1 turret', 7.780, -56.506, 0), ('main-2', 'No. 2 turret', 9.834, -41.839, 0), ('main-3', 'No. 3 turret', 4.734, 56.789, 180)]
for id, name, y, z, bearing in MAIN:
    b['mounts'].append(dict(id=id, name=name + ' 8-inch', partId='us-8in55-ca32-triple', battery='main', position=[0, y, rz(z)],
                            bearingDeg=bearing, rangefinder=True, magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE_MAIN))
SECONDARY = [(-6.857, 8.811, -27.748), (6.857, 8.811, -27.748), (-6.81, 6.233, -15.772), (6.81, 6.233, -15.772),
             (-6.157, 6.233, -6.477), (6.158, 6.233, -6.477), (-6.835, 6.233, 2.472), (6.836, 6.233, 2.472)]
for i, (x, y, z) in enumerate(SECONDARY, 1):
    b['mounts'].append(dict(id=f'secondary-{i}', name=f'5-inch mount {i}', partId='us-5in25-mk19-single', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=-90 if x < 0 else 90, rangefinder=False, magazineId='secondary-magazine', fire=FIRE_LIGHT))
BOFORS = [(-5.44, 12.159, -22.717, -90), (5.441, 12.159, -22.719, 90), (6.882, 9.753, 33.552, 90), (-5.436, 9.753, 38.82, -90),
          (-3.891, 4.019, 76.286, 180), (3.891, 4.019, 76.286, 180)]
TWIN = [(-1.593, 8.391, -82.729, -90), (1.593, 8.391, -82.729, 90), (-4.171, 6.719, -49.045, -90), (4.172, 6.719, -49.045, 90),
        (-3.885, 9.681, -8.28, -90), (3.885, 9.681, -8.28, 90), (-1.557, 12.297, -7.107, -50.24), (1.563, 12.279, -4.492, 130.7),
        (-3.885, 9.681, -3.316, -90), (3.885, 9.681, -3.316, 90), (-2.883, 9.686, .443, -90), (2.885, 9.686, .443, 90),
        (-2.919, 9.686, 4.65, -90), (2.918, 9.686, 4.65, 90), (-4.828, 3.683, 49.512, -90), (4.829, 3.683, 49.512, 90), (0, 9.753, 51.339, 180)]
SINGLE = [(-4.614, 8.811, -33.652, -90), (4.614, 8.811, -33.652, 90), (-2.118, 12.159, -32.209, -60), (2.118, 12.159, -32.208, 60),
          (-8.31, 9.753, 31.29, -90), (7.191, 9.753, 38.281, 120), (5.948, 9.753, 40.67, 120), (-4.203, 12.854, 45.287, -120),
          (4.203, 12.854, 45.287, 120)]
for kind, part, rows, label in [('bofors', 'us-40mm-bofors-mk2-quad', BOFORS, '40 mm quad'),
                                ('oerlikon-twin', 'us-20mm-oerlikon-mk24-hsienyang', TWIN, '20 mm twin'),
                                ('oerlikon', 'us-20mm-oerlikon-mk4', SINGLE, '20 mm')]:
    for i, (x, y, z, bearing) in enumerate(rows, 1):
        b['mounts'].append(dict(id=f'{kind}-{i}', name=f'{label} {i}', partId=part, battery='secondary', position=[x, y, rz(z)],
                                bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-forward' if z < 10 else 'aa-ammunition-after',
                                fire=FIRE_LIGHT))

# ---------------------------------------------------------------- superstructure
if opts.structures:
    measured = json.loads(Path(opts.structures).read_text())['structures']
    structures = []
    for s in measured:
        entry = dict(id=s['id'], name=s.get('name') or f"{'Deckhouse' if s['height'] >= .6 else 'Platform'} {s['baseY']:.1f}-{s['baseY'] + s['height']:.1f} m",
                     footprint=s['footprint'], baseY=s['baseY'], height=s['height'], material='naval')
        if s.get('surface'):
            entry['surface'] = s['surface']
        structures.append(entry)
else:
    # the measured blocks as they stand; the walls' interlock copies are rebuilt below from new_orleans_walls.py
    structures = [s for s in previous['structures'] if not s['id'].startswith('wall-')]


def region(s):
    """Where a measured block stands, by the reference's layout (runtime z)."""
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] - ZS for p in s['footprint']]
    zc, top = (min(zs) + max(zs)) / 2, s['baseY'] + s['height']
    if -16.5 < zc < -7.5 and top > 12.5 and max(xs) - min(xs) < 6.5:
        return 'forward-funnel'
    if -3.0 < zc < 6.5 and top > 12.5 and max(xs) - min(xs) < 6.5:
        return 'after-funnel'
    if zc < -16.0:
        return 'bridge'
    if zc < 12.0:
        return 'midships'
    if zc < 29.0:
        return 'aircraft'
    return 'after-superstructure'


NAMES = {'bridge': 'Bridge', 'forward-funnel': 'Forward funnel', 'after-funnel': 'After funnel', 'midships': 'Midships deckhouse',
         'aircraft': 'Catapult tower', 'after-superstructure': 'After superstructure'}
if opts.structures:
    for s in structures:
        r = region(s)
        s['name'] = f"{NAMES[r]} {s['baseY']:.1f}-{s['baseY'] + s['height']:.1f} m"
        s['id'] = r + '-' + s['id'].split('-')[-1]
    structures = [s for s in structures if not s['id'].startswith(('forward-funnel-', 'after-funnel-'))]

# Funnels: raked extrusions of one measured section (plan cuts of the reference every metre up the stack: the
# same rounded outline at every height, its centre moving aft with height), from the top of the uptake casing to
# the rim. Section as (distance aft of the centre, half-breadth); the steam pipes aft are drawn by the recipe.
FUNNEL_SECTION = [(-2.87, 0), (-2.8, .30), (-2.6, .87), (-2.4, 1.12), (-2.2, 1.32), (-2.0, 1.41), (-1.8, 1.48), (-1.5, 1.58), (-1.0, 1.66),
                  (0, 1.66), (1.0, 1.60), (1.5, 1.43), (1.8, 1.30), (2.0, 1.07), (2.2, .73), (2.4, .30), (2.45, 0)]
# (id, name, reference centre z at y_ref, rake per metre of height, y_ref, base y, rim y)
FUNNELS = [('forward-funnel', 'Forward funnel', -13.852, .1125, 11.0, 7.8, 20.0),
           ('after-funnel', 'After funnel', 3.265, .1046, 9.7, 8.2, 19.3)]


def funnel_ring(zc, y):
    fore = [(w, y, zc + dz) for dz, w in FUNNEL_SECTION]
    return fore + [(-w, y, zc + dz) for dz, w in reversed(FUNNEL_SECTION[1:-1])]


structures = [s for s in structures if s['id'] not in ('forward-funnel', 'after-funnel')]
for id, name, z_ref, rake, y_ref, y0, y1 in FUNNELS:
    # A ring 1.0 m under the rim bounds the sooted cap band the recipe paints black.
    heights = (y0, y1 - 1.0, y1)
    rings = [funnel_ring(z_ref + rake * (y - y_ref), y) for y in heights]
    n = len(rings[0])
    verts = [[round(x, 4), round(y, 4), rz(z)] for ring in rings for x, y, z in ring]
    tris = []
    for r in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            a, c = r * n, (r + 1) * n
            tris += [[a + i, a + j, c + j], [a + i, c + j, c + i]]
    top = (len(rings) - 1) * n
    tris += [[0, k + 1, k] for k in range(1, n - 1)]
    tris += [[top, top + k, top + k + 1] for k in range(1, n - 1)]
    widest = rings[0]
    zc1 = z_ref + rake * (y1 - y_ref)
    structures.append(dict(id=id, name=f'{name} {y0:.1f}-{y1:.1f} m', footprint=[[round(x, 4), rz(z)] for x, _, z in widest], baseY=y0, height=round(y1 - y0, 3),
                           material='naval', surface=dict(vertices=verts, triangles=tris),
                           exhaust=dict(position=[0, y1, rz(zc1 - .2)], width=3.3, length=5.2)))


# ---------------------------------------------------------------- corrections to the measured blocks
def block(sid, base=None, top=None):
    """A measured block these corrections expect, checked so that a re-measurement that moves it fails loudly."""
    s = next((s for s in structures if s['id'] == sid), None)
    if s is None or (base is not None and abs(s['baseY'] - base) > .06) or (top is not None and abs(s['baseY'] + s['height'] - top) > .06):
        sys.exit(f'{sid} is not the block the open-bridge and loft corrections expect; re-check them after re-measuring')
    return s


# Open decks measured as solid slabs (authoring/enclosures.py): the lower bridge round the pilothouse (bridge-012), the
# open navigating bridge (bridge-025) and the midships 20 mm tub (midships-051) are dropped, the director platform abaft
# its tower (bridge-028, bridge-029) cut back, and the pilothouse, the director tower's base and the tub's tower carried
# down to their decks; new_orleans_walls.py carries the bulwarks round them.
sys.path.insert(0, str(HERE / 'authoring'))
from enclosures import correct  # noqa: E402
correct(structures)

# The open navigating bridge. The reference's deck at 17.5 m runs unbroken from the bulwark to the pilothouse top
# (bridge-018), but the plan trace left bridge-010 a sawtoothed U round it that misses the pilothouse's outline by up to
# 0.3 m, so the sea showed through the deck. The deck takes its outer outline (runtime metres) and meets the
# pilothouse along the pilothouse's own outline.
OPEN_BRIDGE = [(4.08, -28.09), (4.3, -28.31), (4.3, -30.56), (2.98, -33.34), (-2.92, -33.39), (-3.1, -33.26), (-4.3, -30.56),
               (-4.3, -28.31), (-4.17, -28.14)]
deck, house = block('bridge-010', 17.4, 17.5), block('bridge-018', 14.9, 17.5)
aft_z = -28.12
edge = list(zip(house['footprint'], house['footprint'][1:] + house['footprint'][:1]))
cut = sorted(((ax + (bx - ax) * (aft_z - az) / (bz - az), aft_z) for (ax, az), (bx, bz) in edge if min(az, bz) < aft_z < max(az, bz)))
if len(cut) != 2:
    sys.exit('bridge-018 no longer crosses the open-bridge deck’s after edge twice; re-check the open-bridge correction')
ring = house['footprint']
start = next(i for i in range(len(ring)) if ring[i][1] < aft_z <= ring[i - 1][1])
ring = ring[start:] + ring[:start]
forward = [tuple(p) for p in ring[:next(i for i, p in enumerate(ring) if p[1] >= aft_z)]]
if forward[0][0] > forward[-1][0]:
    forward.reverse()
# outer outline round the bow side from starboard aft to port aft, then the pilothouse's forward outline from port to starboard
deck['footprint'] = [[x, z] for x, z in OPEN_BRIDGE] + [list(cut[0])] + [list(p) for p in forward] + [list(cut[1])]

# The after deckhouse (6.2 to 9.7 m) was lofted through twelve plan levels whose 5 cm trace noise and small steps
# crumpled its sides into visible shading ripples. Its walls stand nearly plumb to 8.8 m and flare out to the deck
# edge above, so the loft keeps three of its levels, all 128 points of each, and rules straight walls between them.
after = block('after-superstructure-079', 6.2, 9.7)
keep = [6.2, 8.775, 9.7]
verts, tris = after['surface']['vertices'], after['surface']['triangles']
ys = sorted({round(v[1], 4) for v in verts})
n = len(verts) // len(ys)
if any(not any(abs(y - k) < 1e-3 for y in ys) for k in keep):
    sys.exit('after-superstructure-079 no longer has the plan levels its simplification keeps')
if len(ys) > len(keep):
    level = {y: i for i, y in enumerate(ys)}
    rings = [level[next(y for y in ys if abs(y - k) < 1e-3)] for k in keep]
    side = [t for t in tris if {i // n for i in t} == {0, 1}]
    bottom = [t for t in tris if {i // n for i in t} == {0}]
    top_cap = [t for t in tris if {i // n for i in t} == {len(ys) - 1}]
    new_tris = [[i for i in t] for t in bottom]
    for a in range(len(rings) - 1):
        new_tris += [[i % n + (a if i // n == 0 else a + 1) * n for i in t] for t in side]
    new_tris += [[i % n + (len(rings) - 1) * n for i in t] for t in top_cap]
    after['surface'] = dict(vertices=[verts[old * n + k] for old in rings for k in range(n)], triangles=new_tris)

# The director tower (bridge-030, 20.85 to 21.95 m) was lofted through six plan levels a few centimetres apart, and
# bridge-029 under it repeats its outline to 20.45 m: the seams and the loft's small bulges read as ledges and smeared
# shading on what the reference shows as one plumb-sided block. The tower is one prism of its 21.475 m level from
# 20.45 m, standing on bridge-028 (the tower's foot and the Mk 51 tubs' brackets); bridge-029 goes.
tower = block('bridge-030', None, 21.95)
if 'surface' in tower:
    verts = tower['surface']['vertices']
    ys = sorted({round(v[1], 4) for v in verts})
    n = len(verts) // len(ys)
    k = min(range(len(ys)), key=lambda i: abs(ys[i] - 21.475))
    if abs(ys[k] - 21.475) > .01:
        sys.exit('bridge-030 no longer has the 21.475 m level its prism keeps; re-check the tower correction')
    tower['footprint'] = [[round(v[0], 4), round(v[2], 4)] for v in verts[k * n:(k + 1) * n]]
    del tower['surface']
    tower['baseY'], tower['height'] = 20.45, 1.5
    tower['name'] = f"Bridge {tower['baseY']:.1f}-{tower['baseY'] + tower['height']:.1f} m"
tower_foot = next((s for s in structures if s['id'] == 'bridge-029'), None)
if tower_foot is not None:
    block('bridge-029', 20.45, 20.85)
    structures.remove(tower_foot)
b['structures'] = structures


def point_in(x, z, poly):
    c = False
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < ax + (bx - ax) * (z - az) / (bz - az):
            c = not c
    return c


def shared_area(A, B, cell=.1):
    """Plan area two footprints share, on a 10 cm grid (as ship:check's coplanar-top test counts it)."""
    ax, az = [p[0] for p in A['footprint']], [p[1] for p in A['footprint']]
    bx, bz = [p[0] for p in B['footprint']], [p[1] for p in B['footprint']]
    x0, x1, z0, z1 = max(min(ax), min(bx)), min(max(ax), max(bx)), max(min(az), min(bz)), min(max(az), max(bz))
    if x0 >= x1 or z0 >= z1:
        return 0
    n = 0
    for i in range(int((x1 - x0) / cell) + 1):
        for k in range(int((z1 - z0) / cell) + 1):
            x, z = x0 + (i + .5) * cell, z0 + (k + .5) * cell
            if x < x1 and z < z1 and point_in(x, z, A['footprint']) and point_in(x, z, B['footprint']):
                n += 1
    return n * cell * cell


def footprint_area(s):
    p = s['footprint']
    return abs(sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(p, p[1:] + p[:1]))) / 2


# Two measured blocks whose tops meet in one plane over the same deck (a slab laid over a slab) would z-fight: the
# smaller stops 5 cm under the larger's top (ship:check counts tops within 3 cm as one plane).
for i, A in enumerate(structures):
    for B in structures[i + 1:]:
        if abs(A['baseY'] + A['height'] - B['baseY'] - B['height']) > .03 or 'surface' in A or 'surface' in B:
            continue
        if shared_area(A, B) >= .25:
            low = min((A, B), key=footprint_area)
            low['height'] = round(max(.01, max(A['baseY'] + A['height'], B['baseY'] + B['height']) - .05 - low['baseY']), 3)
            low['name'] = low['name'].rsplit(' ', 2)[0] + f" {low['baseY']:.1f}-{low['baseY'] + low['height']:.1f} m"

# Firing obstructions: boxes kept inside the visual walls for substantial blocks. Each outline is cut into
# fore-and-aft strips of at most 3 m, and each strip boxes only the runs across the ship that lie inside the outline
# all along the strip, so a stepped deckhouse is not boxed at its widest and a gun standing in a notch of a block
# (its working circle cut out) is not boxed in.
def inside_runs(poly, z):
    xs = sorted(ax + (bx - ax) * (z - az) / (bz - az) for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1])
                if min(az, bz) <= z < max(az, bz))
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]


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
        if z1 - z0 < .6:
            continue
        runs = None
        for j in range(9):
            here = inside_runs(poly, z0 + .1 + (z1 - z0 - .2) * j / 8)
            runs = here if runs is None else [(max(a, c), min(e, f)) for a, e in runs for c, f in here if min(e, f) - max(a, c) > 0]
        for r, (x0, x1) in enumerate(run for run in runs if run[1] - run[0] >= .6):
            b['obstructions'].append(dict(id=f"{s['id']}-{k}" + (f'-{r + 1}' if r else ''),
                                          center=[round((x0 + x1) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((z0 + z1) / 2, 3)],
                                          size=[round(x1 - x0 - .4, 3), round(s['height'], 3), round(z1 - z0 - .2, 3)]))

# Stowed boats and the catapults: barrels stop at them and cannot fire through them (reference bounds).
STOWED = [('whaleboat', (6.8, 8.8), (6.01, 7.77), (7.37, 15.31)), ('catapult', (5.16, 8.98), (9.53, 11.56), (6.83, 28.32))]
for name, (x0, x1), (y0, y1), (z0, z1) in STOWED:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))
# The forecastle ahead of No. 1 turret rises with its sheer into the barrels at full depression: boxes whose tops
# follow the deck there stop them (reference z; each top at the deck's height at the box's forward end).
for k, (z0, z1) in enumerate([(-62.0, -59.0), (-65.0, -62.0), (-68.0, -65.0)]):
    top = deck_y(rz(z0))
    half = half_breadth(rz(z0), top - .05) * .95
    b['obstructions'].append(dict(id=f'forecastle-deck-{k + 1}', center=[0, round(top - .3, 3), rz((z0 + z1) / 2)], size=[round(2 * half, 3), .6, round(z1 - z0, 3)]))
# The boat winch on the quarterdeck (reference bounds), under No. 3 turret's barrels at full depression.
b['obstructions'].append(dict(id='boat-winch', center=[0.04, 4.1, rz(65.65)], size=[1.6, .5, 2.4]))


def ribbon(pts, t=.03):
    """A wall polyline's outline, `t` either side of it and mitred at its bends (runtime x, z)."""
    def unit(v):
        n = math.hypot(*v)
        return (v[0] / n, v[1] / n) if n > 1e-9 else (1.0, 0.0)
    left, right = [], []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        c = pts[min(len(pts) - 1, i + 1)]
        if i == 0 or i == len(pts) - 1:
            d = unit((c[0] - a[0], c[1] - a[1]))
            nrm, scale = (-d[1], d[0]), 1.0
        else:
            d0, d1 = unit((p[0] - a[0], p[1] - a[1])), unit((c[0] - p[0], c[1] - p[1]))
            n0, n1 = (-d0[1], d0[0]), (-d1[1], d1[0])
            nrm = unit((n0[0] + n1[0], n0[1] + n1[1]))
            scale = 1 / max(.5, nrm[0] * n0[0] + nrm[1] * n0[1])
        left.append([round(p[0] + nrm[0] * t * scale, 4), round(p[1] + nrm[1] * t * scale, 4)])
        right.append([round(p[0] - nrm[0] * t * scale, 4), round(p[1] - nrm[1] * t * scale, 4)])
    return left + right[::-1]


def seg_dist(p, a, c):
    dx, dz = c[0] - a[0], c[1] - a[1]
    L2 = dx * dx + dz * dz
    t = 0 if L2 < 1e-12 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)


def ear_clips(points):
    """Whether the runtime's ear clipper (structure.rs and hullStructure.ts `cap`) triangulates this footprint."""
    def cross(a, c, e):
        return (points[c][0] - points[a][0]) * (points[e][1] - points[a][1]) - (points[c][1] - points[a][1]) * (points[e][0] - points[a][0])
    n = len(points)
    area = sum(points[i][0] * points[(i + 1) % n][1] - points[i][1] * points[(i + 1) % n][0] for i in range(n))
    ids = list(range(n))[::-1 if area < 0 else 1]
    while len(ids) > 2:
        for i in range(len(ids)):
            a, c, e = ids[i - 1], ids[i], ids[(i + 1) % len(ids)]
            if abs(cross(a, c, e)) < 1e-9:
                ids.pop(i)
                break
            if cross(a, c, e) < 0 or any(p not in (a, c, e) and cross(a, c, p) >= -1e-9 and cross(c, e, p) >= -1e-9 and cross(e, a, p) >= -1e-9 for p in ids):
                continue
            ids.pop(i)
            break
        else:
            return False
    return True


def clipped(piece):
    """A wall piece split in halves until each half's ribbon is a footprint the runtime can triangulate."""
    if len(piece) <= 2 or ear_clips(ribbon(piece)):
        return [piece]
    half = len(piece) // 2
    return clipped(piece[:half + 1]) + clipped(piece[half:])


def pieces(pts):
    """A wall split where its ribbon could fold over itself: at bends sharper than 100 degrees, in runs of at most 60
    points, and a closed tub into halves."""
    out, run = [], [pts[0]]
    for i in range(1, len(pts)):
        run.append(pts[i])
        if 0 < i < len(pts) - 1:
            a, p, c = pts[i - 1], pts[i], pts[i + 1]
            u = (p[0] - a[0], p[1] - a[1])
            v = (c[0] - p[0], c[1] - p[1])
            nu, nv = math.hypot(*u), math.hypot(*v)
            turn = math.degrees(math.acos(max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv))))) if nu > 1e-9 and nv > 1e-9 else 0
            if turn > 100 or len(run) >= 60:
                out.append(run)
                run = [p]
    out.append(run)
    if len(out) == 1 and len(pts) > 3 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < .02:
        half = len(pts) // 2
        out = [pts[:half + 1], pts[half:]]
    return [r for r in out if len(r) >= 2 and sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(r, r[1:])) > .05]


# Bulwarks, splinter screens and gun tubs within a gun's reach are structures too, 6 cm ribbons along the traced walls
# (new_orleans_walls.py, which the recipe draws as plating), so the installation interlocks stop a barrel at them.
guns = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
WALL_IDS = []
for i, w in enumerate(WALLS):
    for side, sign in ((('', 1), ('-port', -1)) if w['mirror'] else (('', 1),)):
        pts = [[sign * x, z] for x, z in w['pts']]
        near = []
        for m in b['mounts']:
            part = guns[m['partId']]
            mx, my, mz = m['position']
            reach = part['muzzleForward'] + .6
            d = min(seg_dist((mx, mz), a, c) for a, c in zip(pts, pts[1:]))
            if d < reach and w['top'] > my and w['base'] < my + part['pivotHeight'] + reach:
                near.append(d / reach)
        if not near:
            continue
        for k, piece in enumerate([q for p in pieces(pts) for q in clipped(p)]):
            sid = f'wall-{i:03d}{side}-{k + 1}'
            structures.append(dict(id=sid, name=f"Bulwark {w['base']:.1f}-{w['top']:.1f} m", footprint=ribbon(piece), baseY=w['base'],
                                   height=round(w['top'] - w['base'], 3), material='naval'))
            WALL_IDS.append((min(near), sid))

# Ready-use lockers within a gun's reach (new_orleans_lockers.py, reference frame) are firing obstructions: barrels
# stop at them. The recipe seats each on the deck under it, up to a few centimetres off the reference's height, so each
# box stands 0.25 m taller than its locker.
for k, (x, y, z, sx, sy, sz) in enumerate(LOCKERS):
    if any(math.hypot(m['position'][0] - x, m['position'][2] - rz(z)) < guns[m['partId']]['muzzleForward'] + 1.0
           and abs(m['position'][1] - (y - sy / 2)) < 3 for m in b['mounts']):
        b['obstructions'].append(dict(id=f'locker-{k + 1}', center=[x, round(y + .125, 3), rz(z)], size=[sx, round(sy + .25, 3), sz]))
# So are the four posts under the midships 20 mm platform (new_orleans_fittings.py, reference frame), in the twin
# mounts' working circles on the tub floor.
for k, (x, z) in enumerate([(-2.54, -8.16), (2.54, -8.16), (-2.54, -3.44), (2.54, -3.44)]):
    b['obstructions'].append(dict(id=f'platform-post-{k + 1}', center=[x, 10.825, rz(z)], size=[.2, 2.35, .2]))

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: barrels (with the full recoil stroke) and rotating carriages may not enter the blocks they
# can reach, and neighbouring mounts whose working circles overlap may not cross. Game clearance, not verified
# historical stops. Carriages in the yaw frame (x across, y up, z aft), measured on the catalog parts.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
# The CA-32 gunhouse box stops at 2.8 m, under the superfiring turret's barrels at rest over No. 1's roof, and at the
# gunhouse's measured 6.42 m breadth with 9 cm a side (a 7 m box met the carriages of the 20 mm twins abaft No. 1's
# after corners and shut them out of every bearing abaft their beam); the rangefinder hoods standing out 4.34 m from
# the centreline at the back are two capsules each on the training frame.
BODIES = {'us-8in55-ca32-triple': dict(center=[0, 1.4, 1.69], size=[6.6, 2.8, 9.35]),
          'us-5in25-mk19-single': dict(center=[0, 1.0, .35], size=[2.9, 1.66, 3.1]),
          'us-40mm-bofors-mk2-quad': dict(center=[0, .95, .3], size=[3.0, 1.9, 2.4]),
          'us-20mm-oerlikon-mk24-hsienyang': dict(center=[0, .95, .25], size=[1.6, 1.9, 1.4]),
          'us-20mm-oerlikon-mk4': dict(center=[0, .9, .25], size=[.8, 1.8, 1.2])}
FITTINGS = {'us-8in55-ca32-triple': [dict(joint='yaw', a=[s * 2.95, 2.25, z], b=[s * 4.0, 2.25, z], radiusM=.42) for s in (-1, 1) for z in (4.95, 5.65)]}
clear_mounts, reach = [], {}
for m in b['mounts']:
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(max(w['barrelBaseRadius'] * .85, .05), 3), body=BODIES[m['partId']])
    if m['partId'] in FITTINGS:
        entry['fittings'] = FITTINGS[m['partId']]
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
# Blocks and walls a barrel can reach, nearest first as a share of that barrel's reach, at most 128.
nearby = list(WALL_IDS)
wall_ids = {sid for _, sid in WALL_IDS}
for st in structures:
    if st['id'] in wall_ids:
        continue
    xs = [p[0] for p in st['footprint']]
    zs = [p[1] for p in st['footprint']]
    best = None
    for (x, y, z), r, pivot in reach.values():
        dx = max(min(xs) - x, 0, x - max(xs))
        dz = max(min(zs) - z, 0, z - max(zs))
        if math.hypot(dx, dz) <= r and st['baseY'] < pivot + r * .8 and st['baseY'] + st['height'] > pivot - 3:
            best = min(best if best is not None else 1e9, math.hypot(dx, dz) / r)
    if best is not None:
        nearby.append((best, st['id']))
print(f'{len(nearby)} blocks and walls within a barrel\'s reach ({len(WALL_IDS)} walls); keeping {min(128, len(nearby))}')
if len(nearby) > 128:
    print('  beyond the 128 kept (share of reach):', ', '.join(f'{sid} ({d:.2f})' for d, sid in sorted(nearby)[128:]))
nearby = [sid for _, sid in sorted(nearby)[:128]]
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for every mount (8-inch, 5-inch, 40 mm and 20 mm) against the measured superstructure blocks they can reach, including the full recoil stroke, and between neighbouring mounts whose working circles overlap. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=neighbors)


# A light gun whose barrel would rest on the tub wall or screen in front of it (the catalog parts' trunnions stand
# lower against the reference's walls than its own guns do) rests elevated just enough to clear it, as the interlocks
# test it: the barrel from 0.65 m behind the trunnion (and the recoil stroke) to the muzzle, 2 cm to spare.
def rest_blocked(m, elev):
    w = catalog[m['partId']]
    x, y, z = m['position']
    h, e = math.radians(m['bearingDeg']), math.radians(elev)
    fwd, side = (math.sin(h), -math.cos(h)), (math.cos(h), math.sin(h))
    r = max(w['barrelBaseRadius'] * .85, .05) + .03 + .02
    listed = [st for st in structures if st['id'] in set(nearby)]
    for i in range(w['barrelCount']):
        off = (i - (w['barrelCount'] - 1) / 2) * w['barrelSpacing']

        def at(f):
            along = f - w['trunnionForward']
            fx = w['trunnionForward'] + along * math.cos(e)
            return (x + fwd[0] * fx + side[0] * off, y + w['pivotHeight'] + along * math.sin(e), z + fwd[1] * fx + side[1] * off)
        a, c = at(w['trunnionForward'] - .65 - (w.get('recoilM') or 0)), at(w['muzzleForward'] + .05)
        for k in range(41):
            p = [a[j] + (c[j] - a[j]) * k / 40 for j in range(3)]
            for o in b['obstructions']:
                if all(abs(p[j] - o['center'][j]) <= o['size'][j] / 2 + r for j in range(3)):
                    return True
            for st in listed:
                if not st['baseY'] - r <= p[1] <= st['baseY'] + st['height'] + r:
                    continue
                poly = st['footprint']
                edges = list(zip(poly, poly[1:] + poly[:1]))
                inside = False
                for (ax, az), (bx, bz) in edges:
                    if (az > p[2]) != (bz > p[2]) and p[0] < ax + (bx - ax) * (p[2] - az) / (bz - az):
                        inside = not inside
                if inside or min(seg_dist((p[0], p[2]), q, s) for q, s in edges) < r:
                    return True
    return False


for m in b['mounts']:
    if m['battery'] == 'main' or not rest_blocked(m, 1):
        continue
    for elev in range(5, 46, 5):
        if not rest_blocked(m, elev):
            m['initialElevationDeg'] = elev
            print(f"{m['id']} rests at {elev} degrees, clear of the wall in front of it")
            break
    else:
        print(f"warning: {m['id']} is blocked at rest at every elevation up to 45 degrees")


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
# Magazines inside the armoured boxes the reference's armour model draws: forward z -61.1 to -25.2 under the 83 mm
# crown at y -1.86, after z 37.0 to 62.3 under the 57 mm crown at y -1.16 (reference z).
room('magazine-forward', 'Forward 8-inch magazines', [0, -3.1, rz(-45.5)], [9.0, 2.4, 23.0], 'magazine', hp=220, fire=MAG)
room('secondary-magazine', '5-inch magazine', [0, -3.1, rz(-29.6)], [12.4, 2.4, 8.4], 'magazine', hp=110, fire=MAG)
room('magazine-after', 'After 8-inch magazine', [0, -2.4, rz(52.0)], [8.6, 2.4, 20.5], 'magazine', hp=200, fire=MAG)
room('aa-ammunition-forward', 'Forward light AA ready ammunition', [0, 2.9, rz(-37.5)], [6, 2.2, 5], 'magazine', hp=80, fire=MAG)
room('aa-ammunition-after', 'After light AA ready ammunition', [0, 2.3, rz(40.0)], [6, 2.2, 5], 'magazine', hp=80, fire=MAG)
# Machinery in the citadel (reference z -25.2 to 37.0): four firerooms under the funnels, then two engine rooms.
FIREROOMS = [('fireroom-1', 'No. 1 fireroom', -20.2), ('fireroom-2', 'No. 2 fireroom', -11.2), ('fireroom-3', 'No. 3 fireroom', -2.2), ('fireroom-4', 'No. 4 fireroom', 6.8)]
for id, name, z in FIREROOMS:
    room(id, name, [0, -2.8, rz(z)], [15.0, 7.4, 8.8], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Forward engine room, port', -3.9, 17.4), ('engine-room-starboard-forward', 'Forward engine room, starboard', 3.9, 17.4),
            ('engine-room-port-after', 'After engine room, port', -3.9, 30.0), ('engine-room-starboard-after', 'After engine room, starboard', 3.9, 30.0)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -2.8, rz(z)], [7.6, 7.4, 12.2], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -4.9, rz(47.5)], [9.4, 3.4, 20.5], fire=ENG)
SHAFTS = [('shaft-1', -6.8), ('shaft-2', -3.7), ('shaft-3', 3.7), ('shaft-4', 6.8)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[round(x * .6, 3), -5.2, rz(47.5)],
                             size=[.7, 1.1, 16], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -1.15, rz(73.9)], [6.0, 2.2, 12.3], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['fireroom-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['fireroom-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['fireroom-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['fireroom-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four firerooms under the funnels and two engine rooms aft of them, one group per shaft with equal shares. Room bounds and routing are game estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
SEC_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('secondary-')]
BOFORS_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('bofors-')]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_AD): Mk 31 main-battery directors on the foremast top and aft, Mk 28 5-inch directors
# behind each, six Mk 51 40 mm directors beside their quads.
director('mk31-forward', 'Forward Mk 31 main-battery director', [0, 21.954, -28.444], MAIN_IDS, [2.9, 1.2, 2.9], 60, 10)
director('mk31-after', 'After Mk 31 main-battery director', [0, 15.963, 49.017], MAIN_IDS, [2.9, 1.2, 2.9], 50, 10)
director('mk28-forward', 'Forward Mk 28 5-inch director', [0, 21.989, -24.535], SEC_IDS, [3.6, 2.2, 3.0], 50, 8)
director('mk28-after', 'After Mk 28 5-inch director', [0, 16.119, 46.232], SEC_IDS, [3.6, 2.2, 3.0], 45, 8)
for i, (x, y, z, serves) in enumerate([(-3.003, 20.619, -23.499, ['bofors-1']), (3.003, 20.619, -23.499, ['bofors-2']),
                                       (-3.553, 13.764, 42.762, ['bofors-4']), (3.553, 13.764, 42.762, ['bofors-3']),
                                       (-2.386, 5.046, 72.509, ['bofors-5']), (2.386, 5.046, 72.509, ['bofors-6'])], 1):
    director(f'mk51-{i}', f'Mk 51 40 mm director {i}', [x, y, z], serves, [.9, 1.7, .9], 25, 4)


# ---------------------------------------------------------------- protection (GameModels3D armour model)
def plate(id, name, vs, mm, exterior=False, note='Thickness and zone from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pasc107-armour', basis='inferred', note=note)))


def quad(prefix, name, a, b_, c, d, mm, exterior=False, mirror=True):
    """Two planar triangles over a possibly twisted quad (reference z), mirrored to port."""
    for side, sign in ([('port', -1), ('starboard', 1)] if mirror else [('centre', 1)]):
        m = lambda v: [sign * v[0], v[1], rz(v[2])]
        plate(f'{prefix}-{side}-a', f'{side.title()} {name}' if mirror else name, [m(a), m(b_), m(c)], mm, exterior)
        plate(f'{prefix}-{side}-b', f'{side.title()} {name}' if mirror else name, [m(a), m(c), m(d)], mm, exterior)


def hb(zref, y, inset=.998):
    return half_breadth(rz(zref), y) * inset


def band(prefix, name, z0, z1, seg, y0, y1, mm, exterior=True):
    """Side plating on the loft between two heights, in segments (reference z)."""
    for j in range(seg):
        za = z0 + (z1 - z0) * j / seg
        zb = z0 + (z1 - z0) * (j + 1) / seg
        quad(f'{prefix}-{j}', name, (hb(za, y0), y0, za), (hb(zb, y0), y0, zb), (hb(zb, y1), y1, zb), (hb(za, y1), y1, za), mm, exterior)


def flat(prefix, name, z0, z1, seg, y, mm, inset=.985, xmax=None):
    """A deck across the loft at height y, in strips that follow the hull (reference z)."""
    for j in range(seg):
        za = z0 + (z1 - z0) * j / seg
        zb = z0 + (z1 - z0) * (j + 1) / seg
        wa, wb = hb(za, y - .02, inset), hb(zb, y - .02, inset)
        if xmax:
            wa, wb = min(wa, xmax), min(wb, xmax)
        plate(f'{prefix}-{j}', name, [[-wa, y, rz(za)], [wa, y, rz(za)], [wb, y, rz(zb)], [-wb, y, rz(zb)]], mm)


# Main belt, 127 mm, on the outer shell from y -1.86 to 1.57 over the machinery (reference z -25.2 to 37.0), and the
# 32 mm side forward of it to the forward magazine bulkhead.
band('belt', 'main belt', -25.2, 36.99, 26, -1.86, 1.57, 127)
band('forward-side', 'forward side plating', -61.08, -25.2, 14, -1.86, 1.57, 32)
# Armoured decks: 57 mm over the machinery at the belt top, 57 mm at y -1.86 forward and y -1.16 aft over the
# magazine flats, with the forward magazines' 83 mm crown.
flat('citadel-deck', 'Citadel deck', -25.2, 36.99, 20, 1.57, 57)
flat('forward-deck', 'Forward armoured deck', -61.08, -25.2, 12, -1.86, 57)
plate('forward-magazine-crown', 'Forward magazine crown', [[-6.59, -1.84, rz(-61.08)], [6.59, -1.84, rz(-61.08)], [6.59, -1.84, rz(-25.2)], [-6.59, -1.84, rz(-25.2)]], 83)
flat('after-deck', 'After armoured deck', 36.99, 62.33, 10, -1.16, 57)
# Magazine boxes: 102 mm sides (the forward box narrows from 6.59 to 2.63 m half-breadth toward the bow), 76 mm ends.
quad('forward-magazine-side', 'forward magazine side', (6.59, -4.08, -25.2), (2.63, -4.08, -61.08), (2.63, -1.86, -61.08), (6.59, -1.86, -25.2), 102)
quad('after-magazine-side', 'after magazine side', (4.70, -3.50, 36.99), (4.70, -3.50, 52.58), (4.70, -1.16, 52.58), (4.70, -1.16, 36.99), 102)
quad('after-magazine-side-aft', 'after magazine side', (4.70, -3.50, 52.58), (3.30, -3.50, 62.33), (3.30, -1.16, 62.33), (4.70, -1.16, 52.58), 102)
for id, name, z, x0, x1, y0, y1, mm in [('forward-magazine-end', 'Forward magazine end bulkhead', -61.08, 3.84, 3.84, -7.11, -1.86, 76),
                                          ('forward-citadel-bulkhead', 'Forward citadel bulkhead', -25.2, None, None, -6.6, 1.57, 89),
                                          ('after-citadel-bulkhead', 'After citadel bulkhead', 36.99, None, None, -6.6, 1.57, 89),
                                          ('after-magazine-end', 'After magazine end bulkhead', 62.33, None, None, -6.0, -1.16, 76)]:
    xa = x0 if x0 is not None else hb(z, y0, .99)
    xb = x1 if x1 is not None else hb(z, y1, .99)
    plate(id, name, [[-xa, y0, rz(z)], [xa, y0, rz(z)], [xb, y1, rz(z)], [-xb, y1, rz(z)]], mm)
# Citadel bottom, 40 mm: the flat keel strake and the rising floor either side (reference z -25.2 to 37.0).
plate('citadel-bottom-flat', 'Citadel bottom', [[-2.89, -7.02, rz(-25.2)], [2.89, -7.02, rz(-25.2)], [2.89, -7.02, rz(36.99)], [-2.89, -7.02, rz(36.99)]], 40)
quad('citadel-bottom-floor', 'citadel bottom', (2.89, -7.02, -25.2), (2.89, -7.02, 36.99), (6.6, -5.85, 36.99), (6.6, -5.85, -25.2), 40)
# Barbettes, 127 mm, from the armoured deck to each gunhouse sole (armour model: 2.96 m radius).
for m, low in zip(b['mounts'][:3], (-1.86, -1.86, -1.16)):
    x, top, z = m['position']
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[2.96 * math.cos(a), low, z + 2.96 * math.sin(a)], [2.96 * math.cos(c), low, z + 2.96 * math.sin(c)],
               [2.96 * math.cos(c), top, z + 2.96 * math.sin(c)], [2.96 * math.cos(a), top, z + 2.96 * math.sin(a)]], 127)
# Conning tower: 127 mm sides round a faceted front, 76 mm roof, 38 mm floor (reference y 12.16 to 14.73).
CT = [(-.57, -32.45), (.57, -32.45), (.86, -32.11), (.86, -30.86), (2.17, -30.86), (2.17, -29.65), (-2.17, -29.65), (-2.17, -30.86), (-.86, -30.86), (-.86, -32.11)]
for i, ((xa, za), (xc, zc)) in enumerate(zip(CT, CT[1:] + CT[:1])):
    plate(f'conning-tower-{i}', 'Conning tower', [[xa, 12.16, rz(za)], [xc, 12.16, rz(zc)], [xc, 14.73, rz(zc)], [xa, 14.73, rz(za)]], 127)
for id, name, y, mm in [('conning-tower-roof', 'Conning tower roof', 14.73, 76), ('conning-tower-floor', 'Conning tower floor', 12.16, 38)]:
    for k, tri in enumerate([(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 5), (0, 5, 6), (0, 6, 7), (0, 7, 8), (0, 8, 9)]):
        plate(f'{id}-{k}', name, [[CT[i][0], y, rz(CT[i][1])] for i in tri], mm)
# Steering-gear box: 51 mm sides, 57 mm forward end and roof, 63 mm after end (reference z 67.7 to 80.0).
for id, vs, mm in [('steering-port', [[-3.01, -2.25, 67.73], [-3.01, -2.25, 80.03], [-3.01, -.05, 80.03], [-3.01, -.05, 67.73]], 51),
                   ('steering-starboard', [[3.01, -2.25, 67.73], [3.01, -2.25, 80.03], [3.01, -.05, 80.03], [3.01, -.05, 67.73]], 51),
                   ('steering-forward', [[-3.01, -2.25, 68.91], [3.01, -2.25, 68.91], [3.01, -.05, 67.73], [-3.01, -.05, 67.73]], 57),
                   ('steering-after', [[-3.01, -2.25, 79.61], [3.01, -2.25, 79.61], [3.01, -.05, 80.03], [-3.01, -.05, 80.03]], 63),
                   ('steering-roof', [[-3.01, -.05, 67.73], [3.01, -.05, 67.73], [3.01, -.05, 80.03], [-3.01, -.05, 80.03]], 57)]:
    plate(id, 'Steering-gear protection', [[v[0], v[1], rz(v[2])] for v in vs], mm)

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the mainmast gaff (reference HP_flag_nation); the SK, both SG and the SM aerials and
# the four large directors turn.
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='us-48', position=[0, 29.43, rz(42.5)], width=3.0, staffHeight=0)],
                radars=[dict(id='radar-sk', nodeId='radar-sk.yaw', rpm=6, phaseDeg=0),
                        dict(id='radar-sg-forward', nodeId='radar-sg-forward.yaw', rpm=15, phaseDeg=47),
                        dict(id='radar-sg-after', nodeId='radar-sg-after.yaw', rpm=15, phaseDeg=133),
                        dict(id='radar-sm', nodeId='radar-sm.yaw', rpm=4, phaseDeg=200),
                        dict(id='mk31-forward', nodeId='mk31-forward.yaw', rpm=2, sweepDeg=55, phaseDeg=94),
                        dict(id='mk31-after', nodeId='mk31-after.yaw', rpm=2, sweepDeg=55, phaseDeg=141),
                        dict(id='mk28-forward', nodeId='mk28-forward.yaw', rpm=2, sweepDeg=55, phaseDeg=188),
                        dict(id='mk28-after', nodeId='mk28-after.yaw', rpm=2, sweepDeg=55, phaseDeg=235)])

if opts.keep_gameplay and previous:
    for key in ['localDamage', 'floodRegions', 'connections', 'stability', 'damageControl']:
        if key in previous:
            b[key] = previous[key]
    # the rooms and modules as the helpers left them (fire vents, support generators, the side and end flood spaces)
    for key in ['compartments', 'modules']:
        before = {c['id']: c for c in previous[key]}
        ids = {c['id'] for c in b[key]}
        b[key] = [before.get(c['id'], c) for c in b[key]] + [c for c in previous[key] if c['id'] not in ids]
if 'damageControl' not in b:
    b['damageControl'] = dict(version=1, teams=3, setupSeconds=8, repairPoints=240, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                              portablePumpM3PerSecond=.08, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                              basis='Placeholder; author-damage-control.ts writes the shared fleet defaults.')
if 'localDamage' not in b:
    b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                            basis='Placeholder; author-local-damage.ts replaces it.')
if not ear_clips(deck['footprint']):
    sys.exit('the corrected open-bridge deck outline does not triangulate; check OPEN_BRIDGE against bridge-018')
if not ear_clips(tower['footprint']):
    sys.exit('the director tower prism outline does not triangulate; check the tower correction')
write(HERE / 'blueprint.json', b)
print(f'Authored new-orleans: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, draft {DRAFT} m, beam {round(beam, 2)} m, '
      f'{len(b["mounts"])} mounts, {len(structures)} structures, {len(b["armor"])} armour plates, {len(b["obstructions"])} obstructions. '
      'Next: author-local-damage, author-flood-spaces, author-stability, author-damage-control.')

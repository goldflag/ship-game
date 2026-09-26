"""Original IJN Ise blueprint authoring: the 1944-45 hybrid battleship, GameModels3D-only brief.

The editable blueprint is the versioned asset. This recipe records how it was made and rebuilds
everything except the measured hull stations and superstructure prisms, which it keeps from the
current blueprint unless fresh measurement files are passed:

  python3 assets/ships/ise/author-blueprint.py [--lines a.json --lines-capped b.json] [--plan plan.json]

Measurements come from the cached `bun run ship:reference pjsb526` (A hull, every component) and
live in ignored .build/ise/:

- `--lines`: `bun run ship:lines ise --high 0.12,0.25,0.38,0.47,0.555,0.58,0.65,0.73,0.82,0.91,1`
  (the dense upper levels bracket the old casemate ledge at 0.567 of the height from 1.5 m to the deck).
- `--lines-capped`: the same with `--deck-below 4.87`, used between the hangar's ends, where the hangar
  walls run flush with the hull and the tool would otherwise follow them up to the flight deck.
- `--plan`: plan cuts of the reference's hull group (`ship:slice --plan`, mirrored, 5 cm levels) by
  region, grouped here into prisms.

They hold our own sampled offsets and outlines, never source triangles. Mount datums are the reference
hardpoints; armour zones and plate thicknesses are read from the reference's public armour model
(jsb048_ise_hybrid_1945 armour). Everything is provisional game calibration, not a historical survey.
Run afterwards: author-local-damage (first time only), author-flood-spaces, author-stability,
author-damage-control ise.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ZS = 1.2292          # runtime z = reference z + ZS: the hull (-108.729 to 106.271 in the reference) centred on its length
DRAFT = 9.42         # keel depth under the reference design waterline
SPEED_KN = 25.3
H0 = 1.5
HIGH = [0.12, 0.25, 0.38, 0.47, 0.555, 0.58, 0.65, 0.73, 0.82, 0.91, 1]


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va if abs(b - a) < 1e-9 else va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


def rz(z):
    """Reference z (toward the stern) to runtime z."""
    return round(z + ZS, 4)


args = argparse.ArgumentParser()
args.add_argument('--lines')
args.add_argument('--lines-capped')
args.add_argument('--plan')
opts = args.parse_args()
previous = json.loads((HERE / 'blueprint.json').read_text()) if (HERE / 'blueprint.json').exists() else None

# ---------------------------------------------------------------- hull
# The forecastle wall between the old casemate ledge (about 0.567 of the way from 1.5 m to the deck) and the
# forecastle deck is a sawtooth in plan: each former casemate embrasure is a V-shaped recess whose floor is a
# rounded cap about 0.8 m high. Reference z, starboard half-breadth: the wall at 5.6 m (the same at 6.2 m) and
# the caps at 5.1 m, every 0.5 m. Fittings at the wall (z -16) are left out.
FCSL_WALL = [(-74.0, 8.11), (-73.5, 8.12), (-73.0, 8.12), (-72.5, 8.13), (-72.0, 8.14), (-71.5, 8.15), (-71.0, 8.16), (-70.5, 8.17), (-70.0, 8.18),
             (-69.5, 8.19), (-69.0, 8.20), (-68.5, 8.21), (-68.0, 8.22), (-67.5, 8.23), (-67.0, 8.24), (-66.5, 8.24), (-66.0, 8.25), (-65.5, 8.26),
             (-65.0, 8.27), (-64.5, 8.28), (-64.0, 8.29), (-63.5, 8.30), (-63.0, 8.31), (-62.5, 8.32), (-62.0, 8.33), (-61.5, 8.34), (-61.0, 8.35),
             (-60.5, 8.35), (-60.0, 8.36), (-59.5, 8.37), (-59.0, 8.38), (-58.5, 8.39), (-58.0, 8.40), (-57.5, 8.41), (-57.0, 8.42), (-56.5, 8.56),
             (-56.0, 8.79), (-55.5, 9.02), (-55.0, 9.23), (-54.5, 9.91), (-54.0, 10.22), (-53.5, 10.21), (-53.0, 10.21), (-52.5, 10.20), (-52.0, 10.19),
             (-51.5, 10.18), (-51.0, 10.16), (-50.5, 10.38), (-50.0, 10.60), (-49.5, 10.82), (-49.0, 11.10), (-48.5, 11.52), (-48.0, 11.87), (-47.5, 11.99),
             (-47.0, 11.97), (-46.5, 11.88), (-46.0, 11.80), (-45.5, 11.72), (-45.0, 11.64), (-44.5, 11.55), (-44.0, 11.47), (-43.5, 11.38), (-43.0, 11.31),
             (-42.5, 11.43), (-42.0, 11.55), (-41.5, 11.67), (-41.0, 11.90), (-40.5, 12.31), (-40.0, 12.54), (-39.5, 12.48), (-39.0, 12.38), (-38.5, 12.27),
             (-38.0, 12.17), (-37.5, 12.07), (-37.0, 11.97), (-36.5, 11.86), (-36.0, 11.79), (-35.5, 11.99), (-35.0, 12.18), (-34.5, 12.38), (-34.0, 12.63),
             (-33.5, 12.92), (-33.0, 13.00), (-32.5, 12.92), (-32.0, 12.85), (-31.5, 12.78), (-31.0, 12.70), (-30.5, 12.63), (-30.0, 12.56), (-29.5, 12.48),
             (-29.0, 12.41), (-28.5, 12.33), (-28.0, 12.35), (-27.5, 12.40), (-27.0, 12.45), (-26.5, 12.51), (-26.0, 12.91), (-25.5, 13.27), (-25.0, 13.50),
             (-24.5, 13.52), (-24.0, 13.41), (-23.5, 13.25), (-23.0, 13.09), (-22.5, 12.93), (-22.0, 12.76), (-21.5, 12.62), (-21.0, 12.46), (-20.5, 12.60),
             (-20.0, 12.75), (-19.5, 12.92), (-19.0, 13.25), (-18.5, 13.76), (-18.0, 13.86), (-17.5, 13.87), (-17.0, 13.87), (-16.5, 13.88), (-16.0, 13.885),
             (-15.5, 13.89), (-15.0, 13.90), (-14.5, 13.90), (-14.0, 13.91)]
FCSL_CAPS = [(-57.5, 8.98), (-57.0, 9.48), (-56.5, 9.86), (-56.0, 9.99), (-55.5, 10.05), (-55.0, 10.11), (-54.5, 10.17),
             (-52.0, 10.37), (-51.5, 10.85), (-51.0, 11.29), (-50.5, 11.58), (-50.0, 11.68), (-49.5, 11.74), (-49.0, 11.82), (-48.5, 11.89), (-48.0, 11.96),
             (-44.0, 11.73), (-43.5, 12.12), (-43.0, 12.39), (-42.5, 12.60), (-42.0, 12.63), (-41.5, 12.63), (-41.0, 12.61), (-40.5, 12.59),
             (-37.0, 12.15), (-36.5, 12.62), (-36.0, 13.03), (-35.5, 13.25), (-35.0, 13.28), (-34.5, 13.23), (-34.0, 13.16), (-33.5, 13.09),
             (-29.0, 12.99), (-28.5, 13.31), (-28.0, 13.54), (-27.5, 13.66), (-27.0, 13.66), (-26.5, 13.61), (-26.0, 13.57), (-25.5, 13.53),
             (-21.5, 13.37), (-21.0, 13.64), (-20.5, 13.80), (-20.0, 13.83), (-19.5, 13.84), (-19.0, 13.85), (-18.5, 13.86)]
FCSL = (-74.0, -14.2)       # reference z of the sampled forecastle wall
HANGAR = (41.9, 91.05)      # reference z between which the hangar walls stand flush on the hull
CAP_TOP, WALL_FROM = 5.25, 5.45


def load_lines(path):
    d = json.loads(Path(path).read_text())
    return [(L0 / 2 - s['station'] - sh, [list(p) for p in s['points']]) for L0, sh in [(d['length'], d['zShift'])] for s in d['sections']]


def outline_at(points, y):
    """Half-breadth of a keel-to-deck section at height y (points sorted by height)."""
    return interp([(p[1], p[0]) for p in points], y)


def redeck(points, deck):
    """Resample a section's upper levels to a lower deck edge, following its own outline."""
    low = points[:len(points) - len(HIGH)]
    return low + [[round(outline_at(points, H0 + (deck - H0) * f), 4), round(H0 + (deck - H0) * f, 4)] for f in HIGH]


def blend(a, b, t):
    return [[round(pa[0] + (pb[0] - pa[0]) * t, 4), round(pa[1] + (pb[1] - pa[1]) * t, 4)] for pa, pb in zip(a, b)]


if opts.lines:
    rows = [r for r in load_lines(opts.lines) if not (HANGAR[0] < r[0] < HANGAR[1])]
    # Hangar region: the capped measurement, its deck brought down to the upper deck, which rises from 4.51 m
    # at the hangar's forward end to the quarterdeck's 4.85 m at its after end.
    for z, pts in load_lines(opts.lines_capped):
        if HANGAR[0] < z < HANGAR[1]:
            rows.append((z, redeck(pts, 4.51 + (4.848 - 4.51) * (z - HANGAR[0]) / (HANGAR[1] - HANGAR[0]))))
    rows.sort(key=lambda r: r[0])
    # Deck-edge fittings the tool followed: a deck more than 0.5 m off its neighbours' median within 7 m (a ledge
    # taken for the deck over No. 1 turret), or an upper outline more than 0.25 m off the line between its
    # neighbours at the stern (fairleads and anchor bolsters). Neither occurs next to the forecastle break.
    def deck(r):
        return r[1][-1][1]
    keep = []
    for i, r in enumerate(rows):
        near = sorted(deck(o) for o in rows if o is not r and abs(o[0] - r[0]) < 7)
        if abs(r[0] + 13.8) > 1.5 and near and abs(deck(r) - near[len(near) // 2]) > .5:
            continue
        keep.append(r)
    rows = keep
    for _ in range(3):
        keep = [rows[0]]
        for a, r, b in zip(rows, rows[1:], rows[2:]):
            if r[0] > 92:
                t = (r[0] - a[0]) / (b[0] - a[0])
                if any(abs(p[0] - (pa[0] + (pb[0] - pa[0]) * t)) > .25 for p, pa, pb in zip(r[1][-4:], a[1][-4:], b[1][-4:])):
                    continue
            keep.append(r)
        keep.append(rows[-1])
        rows = keep
    # The forecastle wall and its embrasure caps, every 0.5 m: the lower levels blend between the measured
    # stations either side, the levels above the ledge take the sampled wall (caps up to 5.25 m, wall from 5.45 m).
    zone = [r for r in rows if FCSL[0] - 3 <= r[0] <= FCSL[1] + 1]
    rows = [r for r in rows if not FCSL[0] <= r[0] <= FCSL[1]]
    caps = dict(FCSL_CAPS)
    for z, wall in FCSL_WALL:
        if z > FCSL[1]:
            continue
        a = max((r for r in zone if r[0] <= z), key=lambda r: r[0])
        b = min((r for r in zone if r[0] >= z), key=lambda r: r[0])
        pts = blend(a[1], b[1], 0 if b[0] == a[0] else (z - a[0]) / (b[0] - a[0]))
        top = pts[-1][1]
        ledge = H0 + (top - H0) * .567
        cap = max(wall, caps.get(z, wall))
        for p in pts:
            if p[1] > ledge + .02:
                p[0] = round(cap if p[1] <= CAP_TOP else wall if p[1] >= WALL_FROM else cap + (wall - cap) * (p[1] - CAP_TOP) / (WALL_FROM - CAP_TOP), 4)
        rows.append((z, pts))
    rows.sort(key=lambda r: r[0])
    L = round(rows[-1][0] - rows[0][0], 4)
    assert abs(rows[-1][0] + rows[0][0] + 2 * ZS) < .002, 'ZS must centre the measured hull'
    sections = [{'station': round(L / 2 - rz(z), 4), 'points': [[round(max(0, w), 4), round(max(y, -DRAFT), 4)] for w, y in pts]} for z, pts in reversed(rows)]
    sections[0]['station'] = 0
    sections[-1]['station'] = L
else:
    sections = previous['hull']['sections']
    L = previous['hull']['length']


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
hull = dict(kind='authored-stations-v1', length=L, beam=round(beam, 4), draft=DRAFT, depth=round(DRAFT + 4.512, 3),
            massKg=round(volume * 1025, 1), waterplaneAreaM2=round(waterplane, 1), reserveBuoyancyM3=round(above * .55, 1),
            halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
            deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
            keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
            sections=sections)


def deck_y(zr):
    """Weather-deck height at reference z."""
    return interp([(L / 2 - s['station'] - ZS, s['points'][-1][1]) for s in reversed(sections)], zr)


def half_breadth(zr, y):
    station = L / 2 - rz(zr)
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return breadth_at(a['points'], y) * (1 - t) + breadth_at(b['points'], y) * t
    return 0


print(f'hull: {len(sections)} sections, L {L} m, beam {round(beam, 2)} m, {round(volume * 1.025)} t at the reference waterline')


b = dict(schemaVersion=1, id='ise', name='IJN Ise',
         configuration='Ise · 1944-45 hybrid battleship after the GameModels3D pjsb526 A hull · reference design waterline',
         coordinates='meters-y-up-bow-negative-z', modelUrl='/models/ise.glb', hull=hull,
         handling=dict(forwardSpeed=round(SPEED_KN * .5144444, 4), reverseSpeed=4, acceleration=.18, braking=.24, rudderRate=.3, maxYawRate=.022),
         mounts=[], armor=[], compartments=[], modules=[], connections=[], obstructions=[], structures=[],
         viewpoints=dict(bridge=[0, 26.8, rz(-37.0)]),
         structuralPlating=dict(hullMm=26, superstructureMm=16, note='Hull, hangar and deckhouse plating thicknesses read from the approved GameModels3D armour model (26 mm constructional plating, 16 mm superstructure); provisional game values, not a verified plating schedule.'),
         accuracy=dict(exterior='Original loft and superstructure prisms measured from the approved GameModels3D pjsb526 A hull (jsb048_ise_hybrid_1945) at its design waterline; fittings are independently modelled approximations. No historical-accuracy claim.',
                       internals='Machinery, magazines, flood spaces and stability are provisional game estimates; the visual reference does not establish internal plans.',
                       weapons='Eight 35.6 cm/45 Type 41 in four twin turrets, sixteen 12.7 cm/40 Type 89 in eight open twin mounts, 25 mm Type 96 in twenty-seven triple and eleven single mounts at the reference mount datums. The six 12 cm AA rocket launchers are visual fittings. Ballistics, rates and damage are shared provisional game calibration.'))

# ---------------------------------------------------------------- mounts (reference hardpoints)
FIRE_MAIN = dict(fuelSeconds=90, ignitionHeat=.5, heatPerDamage=.014)
FIRE_LIGHT = dict(fuelSeconds=45, ignitionHeat=.5, heatPerDamage=.014)
# The Kongo twin carries its bore axis 4.17 m over its yaw datum; the reference bore axis is 0.834 m over the
# hardpoint, so the datum sits 3.336 m below it and the gunhouse floor lands 6 cm over the reference's. The
# superfiring turrets stand 0.15 m higher still: the stand-in gunhouse carries a roof guard rail (0.72 m over the
# roof's after end) that the reference's gunhouses do not, and the lift lets the lower turret's rail pass under
# the upper gunhouse's floor where their after overhangs cross.
MAIN_DY = -3.336
SUPERFIRING_LIFT = .15
MAIN = [('main-1', 'No. 1 turret', 8.388, -61.497, 0), ('main-2', 'No. 2 turret', 11.457, -48.895, 0),
        ('main-3', 'No. 3 turret', 9.653, 9.498, 180), ('main-4', 'No. 4 turret', 6.485, 22.049, 180)]
for id, name, y, z, bearing in MAIN:
    lift = SUPERFIRING_LIFT if id in ('main-2', 'main-3') else 0
    b['mounts'].append(dict(id=id, name=name + ' 35.6 cm', partId='type41-356-kongo-1942-twin', battery='main', position=[0, round(y + MAIN_DY + lift, 3), rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='magazine-forward' if z < 0 else 'magazine-after', fire=FIRE_MAIN))
# Open 12.7 cm twins (reference HP_JGS; jgs158 is the Yamato open mount's own reference visual).
HA = [(-6.118, 7.913, -39.931, -90), (6.119, 7.913, -39.931, 90), (-3.817, 12.551, -32.727, -90), (3.818, 12.551, -32.727, 90),
      (-10.987, 7.442, -23.535, -90), (10.988, 7.442, -23.535, 90), (-7.408, 5.267, -1.212, -90), (7.409, 5.267, -1.212, 90)]
for i, (x, y, z, bearing) in enumerate(HA, 1):
    b['mounts'].append(dict(id=f'ha-{i}', name=f'12.7 cm HA mount {i}', partId='type89-127-yamato-open-twin', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, traverseDeg=100, rangefinder=False, magazineId='ha-magazine', fire=FIRE_LIGHT))
# 25 mm Type 96 (reference HP_JGA): open triples (jga181) and singles (jga174), numbered by the source hardpoint.
AA3 = [(1, 0, 17.693, -41.106, 0), (2, -2.809, 21.521, -33.849, -90), (3, 2.81, 21.521, -33.849, 90), (4, -3.292, 32.43, -32.236, -90),
       (5, 3.293, 32.43, -32.236, 90), (6, -3.561, 26.604, -25.664, -90), (7, 3.561, 26.604, -25.664, 90), (8, -3.813, 21.521, -24.516, -135),
       (9, 3.813, 21.521, -24.516, 135), (10, -4.455, 17.931, -7.312, -90), (11, 4.455, 17.931, -7.312, 90), (12, -4.68, 17.931, 2.135, -90),
       (13, 4.68, 17.931, 2.135, 90), (14, -3.354, 17.019, 38.412, -135), (15, 3.354, 17.019, 38.412, 135), (16, -3.354, 17.019, 44.612, -135),
       (17, 3.354, 17.019, 44.612, 135), (18, -17.458, 8.703, 51.44, -90), (19, 17.459, 8.703, 51.44, 90), (22, -16.717, 8.703, 58.857, -90),
       (23, 16.718, 8.703, 58.857, 90), (28, -15.459, 8.703, 73.76, -90), (29, 15.459, 8.703, 73.76, 90), (32, -13.204, 8.703, 80.808, -90),
       (33, 13.205, 8.703, 80.808, 90), (42, -4.387, 10.731, 105.237, 180), (43, 4.387, 10.731, 105.237, 180)]
AA1 = [(20, -5.161, 10.832, 55.101, -135), (21, 5.162, 10.832, 55.101, 135), (24, -3.72, 10.832, 62.384, -135), (25, 3.72, 10.832, 62.384, 135),
       (26, -3.72, 10.832, 69.756, -135), (27, 3.72, 10.832, 69.756, 135), (30, -3.72, 10.832, 76.212, -135), (31, 3.72, 10.832, 76.212, 135),
       (34, -4.773, 10.832, 87.717, 180), (35, 4.773, 10.832, 87.717, 180), (44, 0, 10.745, 105.594, 180)]
for n, x, y, z, bearing in AA3:
    b['mounts'].append(dict(id=f'aa25-{n}', name=f'25 mm triple {n}', partId='type96-25-triple', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition' if z < 30 else 'aa-ammunition-after', fire=FIRE_LIGHT))
for n, x, y, z, bearing in AA1:
    b['mounts'].append(dict(id=f'aa25-{n}', name=f'25 mm single {n}', partId='type96-25-kongo-single', battery='secondary', position=[x, y, rz(z)],
                            bearingDeg=bearing, rangefinder=False, magazineId='aa-ammunition-after', fire=FIRE_LIGHT))
# The 25 mm triples on the hangar's side sponsons stand up to 17.46 m from the centreline, outside the hull.
b['mountEnvelope'] = dict(beam=36.0, length=L)
# The six 12 cm 28-tube AA rocket launchers (HP_JGA_36-41, jga195) are visual fittings drawn by the recipe: the
# simulation has no rocket weapon type.
ROCKETS = [(-9.603, 7.983, 94.709, -90), (9.603, 7.983, 94.709, 90), (-9.258, 7.983, 98.15, -90), (9.258, 7.983, 98.15, 90),
           (-8.907, 7.983, 101.501, -90), (8.907, 7.983, 101.501, 90)]

# ---------------------------------------------------------------- superstructure
# Measured prisms. Plan cuts of the reference hull group every 5 cm (mirrored; gaps up to 1.2 m bridged so
# window and door openings close; features under 0.3 m dropped) in three overlapping regions whose floors
# clear the hull decks (forecastle from 7.12 m, midships from 4.57 m, hangar and stern from 4.95 m) are
# rasterised on a 10 cm grid. Each grid column's solid runs (gaps of up to 15 cm bridged, 1.2 m above 12 m) start
# and end at heights snapped to the levels where many columns start or end (a deck, a roof, a platform), or else
# to steps of 0.3 to 1 m by the run's length; columns sharing a start and an end form a block, traced back to an
# outline. Blocks that do not
# rise clear of the hull deck are hull; ones starting within 0.6 m of the deck reach down to it.


def regularize(poly, tol=.1, snap=math.tan(math.radians(5))):
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
    area = sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(out, out[1:] + out[:1])) / 2
    before = sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(poly, poly[1:] + poly[:1])) / 2
    return out if len(out) >= 3 and area * before > 0 and abs(area) > .85 * abs(before) else poly


def triangulable(poly):
    """True when the simulation's ear clipping (naval-sim structure.rs `cap`) can cap this outline: a thin sliver that
    Douglas-Peucker folds across itself, or an outline pinched at a vertex, leaves it no ear and fails the battle."""
    def cross(a, b, c):
        return (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0])
    area = sum(p[0] * poly[(i + 1) % len(poly)][1] - p[1] * poly[(i + 1) % len(poly)][0] for i, p in enumerate(poly))
    ids = list(range(len(poly)))[::-1 if area < 0 else 1]
    while len(ids) > 2:
        for i in range(len(ids)):
            a, b, c = ids[i - 1], ids[i], ids[(i + 1) % len(ids)]
            if abs(cross(a, b, c)) < 1e-9:
                break
            if cross(a, b, c) > 0 and not any(p not in (a, b, c) and cross(a, b, p) >= -1e-9 and cross(b, c, p) >= -1e-9
                                              and cross(c, a, p) >= -1e-9 for p in ids):
                break
        else:
            return False
        ids.pop(i)
    return True


def fit_ring(raw, tol=.08):
    """A regularized outline of at most 160 points that the simulation can cap, straightened less where the first try
    folds; None when even the traced outline cannot be capped."""
    ring = regularize(raw, tol)
    while len(ring) > 160:
        tol *= 1.5
        ring = regularize(raw, tol)
    while not triangulable(ring) and tol > .01:
        tol /= 2
        finer = regularize(raw, tol)
        if len(finer) <= 250:
            ring = finer
    return ring if triangulable(ring) else None


def deck_under(poly):
    """Lowest and highest hull deck under an outline (reference frame), sampled at its corners and centre."""
    pts = poly + [[sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)]]
    decks = [deck_y(p[1]) for p in pts if abs(p[0]) <= half_breadth(p[1], deck_y(p[1]) - .05) + .05]
    return (min(decks), max(decks)) if decks else (None, None)


def components(cells, W):
    """4-connected components of a set of grid cell indices r * W + c."""
    cells, out = set(cells), []
    while cells:
        seed = cells.pop()
        comp, stack = [seed], [seed]
        while stack:
            i = stack.pop()
            r = i // W
            for j in (i - 1, i + 1, i - W, i + W):
                if j in cells and (abs(j - i) == W or j // W == r):
                    cells.remove(j)
                    comp.append(j)
                    stack.append(j)
        out.append(comp)
    return out


def loop_area(loop):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(loop, loop[1:] + loop[:1])) / 2


def hole_free(comp, W, depth=0):
    """Split a cell set with holes (a platform round a tower, a tub round a gun) along the grid column through
    its largest hole until every piece is simply connected, so no block fills the space it encloses."""
    holes = [l for l in cell_loops(comp, W) if loop_area(l) < 0]
    if not holes or depth > 10:
        return [comp]
    hole = min(holes, key=loop_area)
    split = round(sum(p[0] for p in hole) / len(hole))
    out = []
    for part in ([i for i in comp if i % W < split], [i for i in comp if i % W >= split]):
        for sub in components(part, W):
            out += hole_free(sub, W, depth + 1)
    return out


def cell_loops(comp, W):
    """Boundary loops of a cell set as grid corner points (c, r): outer ones counter-clockwise, holes clockwise."""
    cells = set(comp)
    nxt = {}
    for i in comp:
        r, c = divmod(i, W)
        if i - W not in cells:
            nxt.setdefault((c, r), []).append((c + 1, r))
        if not (i + 1 in cells and (i + 1) // W == r):
            nxt.setdefault((c + 1, r), []).append((c + 1, r + 1))
        if i + W not in cells:
            nxt.setdefault((c + 1, r + 1), []).append((c, r + 1))
        if not (i - 1 in cells and (i - 1) // W == r):
            nxt.setdefault((c, r + 1), []).append((c, r))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop, at = [start], start
        while True:
            to = nxt[at].pop()
            if not nxt[at]:
                del nxt[at]
            if to == start:
                break
            loop.append(to)
            at = to
            if at not in nxt:
                break
        loops.append(loop)
    return loops


def outline(comp, W):
    """Outer boundary of a cell set, counter-clockwise, as grid corner points (c, r), straight runs merged."""
    best = max(cell_loops(comp, W), key=loop_area)
    corners = [p for i, p in enumerate(best) if (best[i - 1][0] - p[0]) * (best[(i + 1) % len(best)][1] - p[1]) != (best[i - 1][1] - p[1]) * (best[(i + 1) % len(best)][0] - p[0])]
    return corners


MAX_MEASURED = 232


def measured_prisms(cuts, cell=.1, gap=3):
    import numpy as np
    from PIL import Image, ImageDraw
    found = []
    for region, levels in cuts.items():
        n = len(levels)
        step = round(levels[1]['y'] - levels[0]['y'], 4)
        pts = [q for lv in levels for p in lv['polygons'] for q in p['ring']]
        x0, z0 = min(q[0] for q in pts) - .5, min(q[1] for q in pts) - .5
        W = int((max(q[0] for q in pts) + .5 - x0) / cell) + 2
        H = int((max(q[1] for q in pts) + .5 - z0) / cell) + 2
        start = np.full(W * H, -1, np.int32)
        last = np.full(W * H, -1, np.int32)
        runs = []
        # The hull below its own deck is not structure: per grid row, the deck height and the widest half-breadth.
        row_z = z0 + (np.arange(H) + .5) * cell
        row_deck = np.array([deck_y(z) if -L / 2 - ZS <= z <= L / 2 - ZS else -99 for z in row_z])
        row_half = np.array([max(half_breadth(z, y) for y in (-3, 0, 2, 4, 6)) + .1 for z in row_z])
        col_x = np.abs(x0 + (np.arange(W) + .5) * cell)
        # The guns' working space is not structure: a traced gun tub or platform fills solid round the mount.
        # From just over each mount's seat, clear its carriage circle and, for the 25 mm mounts (which carry no
        # interlocks), the barrels' reach over their training arc. The 12.7 cm mounts' barrels are stopped by
        # their interlocks against the blocks instead.
        cx = x0 + (np.arange(W) + .5) * cell
        cz = z0 + (np.arange(H) + .5) * cell
        carve = []
        for gx, gz, gy, carriage, reach, bearing, half in guns:
            dx, dz = cx[None, :] - gx, cz[:, None] - gz
            r = np.hypot(dx, dz)
            ang = (np.degrees(np.arctan2(dx, -dz)) - bearing + 540) % 360 - 180
            mask = (r <= carriage) | ((r <= reach) & (np.abs(ang) <= half + 16))
            carve.append((gy, np.nonzero(mask)))
        # Each main turret's barbette well is the recipe's own cylinder and the guns' breeches swing down into it
        # at full elevation: nothing measured stands inside 4.9 m of its axis up to the gunhouse roof.
        wells = [(m['position'][1] + 6.2, np.nonzero(np.hypot(cx[None, :] - m['position'][0], cz[:, None] - (m['position'][2] - ZS)) <= 4.9))
                 for m in b['mounts'] if m['battery'] == 'main']
        for k, lv in enumerate(levels):
            img = Image.new('L', (W, H), 0)
            draw = ImageDraw.Draw(img)
            for p in lv['polygons']:
                # A cut that closes round the whole hull (4,500 m2 on single levels where the shell's strakes line
                # up) is the hull, not a deckhouse; the largest real blocks, the flight deck and hangar, are under 2,000 m2.
                if .15 <= p['area'] < 3000:
                    draw.polygon([((x - x0) / cell, (z - z0) / cell) for x, z in p['ring']], fill=1)
            grid = np.asarray(img, dtype=np.uint8) > 0
            hull_rows = np.nonzero(row_deck >= lv['y'] - .03)[0]
            if len(hull_rows):
                grid[hull_rows] &= col_x[None, :] > row_half[hull_rows, None]
            for gy, where in carve:
                if gy + .08 < lv["y"] < gy + 3.4:
                    grid[where] = False
            for top, where in wells:
                if lv['y'] < top:
                    grid[where] = False
            on = grid.reshape(-1)
            # Above the hull's working decks the towers' open galleries and window bands are bridged up to
            # 1.2 m; lower down, 15 cm.
            done = np.nonzero(~on & (start >= 0) & (k - last > (gap if lv['y'] < 12 else 24)))[0]
            if len(done):
                runs.append(np.stack([done, start[done], last[done]], 1))
                start[done] = -1
            start[on & (start < 0)] = k
            last[on] = k
        done = np.nonzero(start >= 0)[0]
        runs.append(np.stack([done, start[done], last[done]], 1))
        runs = np.concatenate(runs)

        # Ends away from a common level round to a step that grows with the run, so a tall tower's columns,
        # whose tops differ by a few centimetres, stay one block: 0.3 m under 3 m, 0.6 m under 10 m, 1 m above.
        span = runs[:, 2] - runs[:, 1]
        quantum = np.where(span < 60, 6, np.where(span < 200, 12, 20))

        def snapped(values):
            hist = np.bincount(values, minlength=n)
            peaks = np.array([k for k in range(n) if hist[k] >= 25 and hist[k] == hist[max(0, k - 3):k + 4].max()])
            out = ((values + quantum // 2) // quantum) * quantum
            if len(peaks):
                d = np.abs(values[:, None] - peaks[None, :])
                j = d.argmin(1)
                near = d[np.arange(len(values)), j] <= 3
                out[near] = peaks[j[near]]
            return np.clip(out, 0, n - 1)
        s, e = snapped(runs[:, 1]), snapped(runs[:, 2])
        e = np.maximum(e, s)
        # Snapping must not lift a block back into a gun's working space: a run that starts below a carve ends
        # under it.
        ys = np.array([lv['y'] for lv in levels])
        floor_level = np.full(W * H, n, np.int64)
        for gy, where in carve:
            first = int(np.searchsorted(ys, gy + .08, side='right'))
            cells = where[0] * W + where[1]
            floor_level[cells] = np.minimum(floor_level[cells], first)
        cap = floor_level[runs[:, 0]]
        clip = (s < cap) & (e >= cap)
        e = np.where(clip, cap - 1, e)
        # A column whose start and end few others share (a tower's cell whose top sits between two common levels)
        # joins a neighbouring column's block when their runs overlap over most of their height, so a tall tower
        # is not left pitted with dropped cells.
        cells_of = runs[:, 0]
        for _ in range(4):
            key = s.astype(np.int64) * 100000 + e
            _, inverse, counts = np.unique(key, return_inverse=True, return_counts=True)
            size = counts[inverse]
            small = np.nonzero(size < 30)[0]
            big = np.nonzero(size >= 30)[0]
            if not len(small) or not len(big):
                break
            big = big[np.argsort(cells_of[big], kind='stable')]
            big_cells = cells_of[big]
            best = np.full(len(small), -1)
            best_share = np.zeros(len(small))
            col = cells_of[small] % W
            for shift, ok in ((-1, col > 0), (1, col + 1 < W), (-W, np.ones(len(small), bool)), (W, np.ones(len(small), bool))):
                nb = cells_of[small] + shift
                lo = np.searchsorted(big_cells, nb, 'left')
                hi = np.searchsorted(big_cells, nb, 'right')
                for k in range(int((hi - lo).max(initial=0))):
                    has = ok & (lo + k < hi)
                    j = big[np.minimum(lo + k, len(big) - 1)]
                    overlap = np.minimum(e[small], e[j]) - np.maximum(s[small], s[j])
                    share = overlap / np.maximum(1, np.maximum(e[small] - s[small], e[j] - s[j]))
                    take = has & (share >= .7) & (share > best_share)
                    best = np.where(take, j, best)
                    best_share = np.where(take, share, best_share)
            moved = best >= 0
            if not moved.any():
                break
            s[small[moved]] = s[best[moved]]
            e[small[moved]] = e[best[moved]]
        key = s.astype(np.int64) * 100000 + e
        order = np.argsort(key, kind='stable')
        bounds = np.nonzero(np.diff(key[order]))[0] + 1
        for group in np.split(order, bounds):
            if len(group) < 30:
                continue
            k0, k1 = int(s[group[0]]), int(e[group[0]])
            for whole in components(runs[group, 0].tolist(), W):
                if len(whole) < 30:
                    continue
                for comp in hole_free(whole, W):
                    if len(comp) < 30:
                        continue
                    ring = [[round(x0 + c * cell, 3), round(z0 + r * cell, 3)] for c, r in outline(comp, W)]
                    xs, zs = [q[0] for q in ring], [q[1] for q in ring]
                    found.append(dict(region=region, base=round(levels[k0]['y'] - step / 2, 3), top=round(levels[k1]['y'] + step / 2, 3), ring=ring,
                                      area=len(comp) * cell * cell, bounds=dict(min=[min(xs), min(zs)], max=[max(xs), max(zs)]),
                                      cells=comp, grid=(W, x0, z0)))
    # Hull, not structure: anything that does not clear the deck under it; and slivers.
    kept = []
    for p in found:
        lo, hi = deck_under(p['ring'])
        if lo is not None and p['top'] <= hi + .12:
            continue
        if p['area'] < .6 and p['top'] - p['base'] < .4 or p['area'] < 3 and p['top'] - p['base'] < .12:
            continue
        p['deck'] = lo
        kept.append(p)
    # Duplicates from the overlapping regions.
    out = []
    for p in sorted(kept, key=lambda p: (p['base'], p['bounds']['min'][1])):
        if any(abs(p['base'] - q['base']) < .08 and abs(p['top'] - q['top']) < .08 and
               all(abs(p['bounds'][k][i] - q['bounds'][k][i]) < .12 for k in ('min', 'max') for i in (0, 1)) for q in out):
            continue
        out.append(p)
    # Reach down to the deck when a block starts just above it and nothing else stands under it.
    for p in out:
        if p['deck'] is not None and 0 < p['base'] - p['deck'] <= .6:
            below = [q for q in out if q is not p and abs(q['top'] - p['base']) < .06 and
                     q['bounds']['min'][0] < p['bounds']['max'][0] and p['bounds']['min'][0] < q['bounds']['max'][0] and
                     q['bounds']['min'][1] < p['bounds']['max'][1] and p['bounds']['min'][1] < q['bounds']['max'][1]]
            if not below:
                p['base'] = round(p['deck'] - .02, 3)
    structures = []
    # Blocks under 0.5 m2 in plan (ladders, pipes, small lockers) are left to the recipe's fittings; larger
    # small ones stay, as pedestals and seats that fittings stand on.
    small = lambda ring, h: abs(sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(ring, ring[1:] + ring[:1]))) / 2 < .5
    out = [p for p in out if not small(p['ring'], p['top'] - p['base'])]
    # The blueprint holds at most 256 blocks: keep the ones with the most visible surface (plan area plus wall
    # area), leaving room for the recipe's own.
    wall = lambda p: sum(math.hypot(a[0] - c[0], a[1] - c[1]) for a, c in zip(p['ring'], p['ring'][1:] + p['ring'][:1])) * (p['top'] - p['base'])
    print(f'measured blocks: {len(out)}, the blueprint keeps {MAX_MEASURED}')
    # Blocks the 12.7 cm barrels can reach come first: their interlocks see only blueprint structures.
    def by_ha(p):
        return any(max(p['bounds']['min'][0] - gx, 0, gx - p['bounds']['max'][0]) ** 2 + max(p['bounds']['min'][1] - gz, 0, gz - p['bounds']['max'][1]) ** 2 < 4.9 ** 2
                   and p['base'] < gy + 4.2 and p['top'] > gy - 1 for gx, gz, gy, carriage, reach, _, _ in guns if not reach)
    ranked = sorted(out, key=lambda p: (not by_ha(p), -(p['area'] + wall(p))))
    for i, p in enumerate(ranked):
        p["rank"] = i
    # The rest are drawn by the recipe from ise_blocks.py, as geometry that fittings can stand on.
    minor = []
    for i, p in enumerate(sorted(ranked, key=lambda p: (p['bounds']['min'][1], p['base']))):
        ring = fit_ring(p['ring'])
        if ring is None:
            # A sliver whose traced outline pinches where cells meet corner to corner: grown by a cell all round.
            W, gx0, gz0 = p['grid']
            cells = set(p['cells'])
            grown = cells | {j for i in cells for j in (i - W, i + W)} | {j for i in cells for j in (i - 1, i + 1) if j // W == i // W}
            ring = fit_ring([[round(gx0 + c * cell, 3), round(gz0 + r * cell, 3)] for c, r in outline(sorted(grown), W)])
        if ring is None:
            print(f"dropped a {p['area']:.1f} m2 block at {p['base']:.1f}-{p['top']:.1f} m whose outline cannot be capped")
            continue
        zc = (p['bounds']['min'][1] + p['bounds']['max'][1]) / 2
        label = 'Forward' if zc < -13.8 else 'Midships' if zc < 42.4 else 'After'
        block = dict(id=f"block-{i:03d}", name=f"{label} superstructure {p['base']:.1f}-{p['top']:.1f} m",
                     footprint=[[x, rz(z)] for x, z in ring], baseY=p['base'], height=round(p['top'] - p['base'], 3), material='naval')
        (structures if p["rank"] < MAX_MEASURED else minor).append(block)
    return structures, minor


PARTS = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
# Working space per secondary and AA mount (reference x, z, seat y, carriage radius, barrel reach, bearing, half arc).
CARRIAGE = {'type96-25-triple': 1.42, 'type96-25-kongo-single': 1.18, 'type89-127-yamato-open-twin': 2.62}
guns = []
for m in b['mounts']:
    if m['battery'] == 'main':
        continue
    w = PARTS[m['partId']]
    reach = w['muzzleForward'] + .2 if m['partId'].startswith('type96') else 0
    guns.append((m['position'][0], m['position'][2] - ZS, m['position'][1], CARRIAGE[m['partId']], reach, m['bearingDeg'], m.get('traverseDeg', w['traverseDeg'])))

if opts.plan:
    structures, minor_blocks = measured_prisms(json.loads(Path(opts.plan).read_text()))
else:
    structures = previous['structures']
    import importlib.util
    spec = importlib.util.spec_from_file_location('ise_blocks', HERE / 'ise_blocks.py')
    blocks_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(blocks_module)
    minor_blocks = blocks_module.BLOCKS
# Recorded corrections to the measured blocks, by id: None drops a block the recipe draws itself (the barbettes
# under the turrets, which the recipe builds as cylinders), a dict overrides fields.
STRUCTURE_EDITS = {}
structures = [dict(s, **STRUCTURE_EDITS[s['id']]) if STRUCTURE_EDITS.get(s['id']) else s for s in structures
              if s['id'] not in STRUCTURE_EDITS or STRUCTURE_EDITS[s['id']] is not None]
BARBETTES = [(z, 4.8) for _, _, _, z, _ in MAIN]


def inside_barbette(s):
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] - ZS for p in s['footprint']]
    return any(abs((max(xs) + min(xs)) / 2) < .3 and abs((max(zs) + min(zs)) / 2 - z) < .3 and max(xs) - min(xs) < 2 * r + .5 for z, r in BARBETTES)


structures = [s for s in structures if not inside_barbette(s)]
# Measured pieces the column raster cannot see, added from single plan cuts (reference outline (x, z), base, top):
# the after tower's cantilevered control platform (under the raster's 0.3 m2 component floor, plan at 18.5 m), and
# the pagoda's three glazed fronts, whose walls are thinner than the plan cuts' 0.3 m feature floor and enclose no
# solid, so the raster leaves them open between their floor and roof: the lower bridge's wedge (18.65-21.42 m,
# walls from the front at z -36.45 to the tower legs), the upper bridge's pointed room (29.89-32.31 m) and the small
# compass room over it (32.43-34.76 m). Outlines are the outer walls of `ship:slice pjsb526 --plan <y> --min-thickness
# 0.02 --close 0.25` at 19.4, 20.0, 30.4, 31.9 and 33.5 m; heights run from the floor under each to the roof over it.
EXTRA = [('after-control-platform', 'After tower control platform',
          [(-1.4, 44.6), (1.4, 44.6), (1.4, 48.69), (-1.4, 48.69)], 17.72, 19.37),
         ('lower-bridge', 'Lower bridge', [(-2.06, -36.45), (2.06, -36.45), (4.08, -30.5), (-4.08, -30.5)], 18.65, 21.42),
         ('upper-bridge', 'Upper bridge', [(-0.94, -35.45), (0.94, -35.45), (2.88, -32.75), (2.2, -32.5), (-2.2, -32.5),
                                           (-2.88, -32.75)], 29.89, 32.31),
         ('compass-room', 'Compass room', [(-1.38, -35.5), (1.38, -35.5), (1.5, -35.2), (1.5, -33.85), (-1.5, -33.85),
                                           (-1.5, -35.2)], 32.43, 34.76)]
structures = [s for s in structures if s['id'] not in {e[0] for e in EXTRA}]
for sid, name, outline_ref, y0, y1 in EXTRA:
    structures.append(dict(id=sid, name=name, footprint=[[x, rz(z)] for x, z in outline_ref], baseY=y0,
                           height=round(y1 - y0, 3), material='naval'))


def plan_area(poly):
    return abs(sum(a[0] * c[1] - c[0] * a[1] for a, c in zip(poly, poly[1:] + poly[:1]))) / 2


def box_overlap(a, c):
    ax = [p[0] for p in a['footprint']]
    az = [p[1] for p in a['footprint']]
    cx = [p[0] for p in c['footprint']]
    cz = [p[1] for p in c['footprint']]
    return min(ax) < max(cx) and min(cx) < max(ax) and min(az) < max(cz) and min(cz) < max(az)


def poly_distance(poly, x, z):
    """Distance from (x, runtime z) to a footprint; zero inside it."""
    inner = False
    best = 1e9
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            inner = not inner
        dx, dz = bx - ax, bz - az
        t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / max(1e-12, dx * dx + dz * dz)))
        best = min(best, math.hypot(x - ax - t * dx, z - az - t * dz))
    return 0.0 if inner else best


# A tub's floor or locker that the plan cuts end a few centimetres over a gun's seat, inside its carriage circle
# but not under the gun itself, would rub the gun's turning base: it ends 1 cm under the seat, unless something
# stands on it. Platforms (over 12 m2) and whatever a gun stands on are seats and stay.
seat_blocks = [s for s in structures + minor_blocks if any(abs(s['baseY'] + s['height'] - gy) < .25 and
               poly_distance(s['footprint'], gx, gz + ZS) == 0 for gx, gz, gy, *_ in guns)]
for gx, gz, gy, carriage, reach, _, _ in guns:
    for s in structures + minor_blocks:
        top = s['baseY'] + s['height']
        if not gy - .005 < top <= gy + .2 or s['baseY'] >= gy - .07 or any(s is q for q in seat_blocks) or plan_area(s['footprint']) > 12:
            continue
        d = poly_distance(s['footprint'], gx, gz + ZS)
        if d >= carriage + .05:
            continue
        if any(o is not s and abs(o['baseY'] - top) < .07 and box_overlap(o, s) for o in structures + minor_blocks):
            continue
        s['height'] = round(gy - .01 - s['baseY'], 3)


# Overlapping blocks that end at the same height would share a top plane (z-fighting, doubled plating):
# the smaller one stops 5 cm short.
for _ in range(6):
    clashes = 0
    for a in structures:
        for c in structures:
            if a is c or abs(a['baseY'] + a['height'] - c['baseY'] - c['height']) > .035 or not box_overlap(a, c):
                continue
            small_one = a if plan_area(a['footprint']) < plan_area(c['footprint']) else c
            if small_one['height'] > .06:
                small_one['height'] = round(small_one['height'] - .05, 3)
                clashes += 1
    if not clashes:
        break


def contains(poly, x, z):
    c = False
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            c = not c
    return c


# The funnel: the blocks standing over its uptake above 21.3 m (the trunk narrows to 5.0 by 6.8 m under a
# black cap whose open top is at 25.9 m, centred 3.55 m abaft reference midships). Its topmost block carries
# the exhaust datum the smoke reads.
FUNNEL = dict(x=0, z=-3.55, base=21.3, width=4.8, length=6.4)
funnel = sorted((s for s in structures if FUNNEL['base'] < s['baseY'] + s['height'] < 27 and contains(s['footprint'], 0, rz(FUNNEL['z']))),
                key=lambda s: s['baseY'] + s['height'])
for s in funnel:
    s['name'] = 'Funnel ' + s['name'].split('superstructure ')[-1].split('Funnel ')[-1]
    s['funnel'] = True
if funnel:
    top = funnel[-1]
    top['exhaust'] = dict(position=[0, round(top['baseY'] + top['height'], 3), rz(FUNNEL['z'])], width=FUNNEL['width'], length=FUNNEL['length'])
structures = [{k: v for k, v in s.items() if k != 'funnel'} | ({'id': s['id'] + '-funnel'} if s.get('funnel') and not s['id'].endswith('-funnel') else {}) for s in structures]
uncapped = [s['id'] for s in structures if not triangulable(s['footprint'])]
assert not uncapped, f'the simulation cannot cap these footprints: {uncapped}'
b['structures'] = structures


# Posts under blocks that rest on nothing: whatever carried them in the reference (lattice legs, knees, thin
# pillars) is under the plan cuts' 0.3 m minimum. A block is carried when some point of its underside lies
# within 10 cm of the deck or another block's top; otherwise up to four posts drop from it to what lies below.
def inside(poly, x, z):
    c = False
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            c = not c
    return c


ALL_BLOCKS = structures + minor_blocks


def surface_below(x, zr, y, skip):
    """Highest deck or block top at or below y over (x, reference z)."""
    best = -99.0
    d = deck_y(zr)
    if -L / 2 < zr + ZS < L / 2 and abs(x) <= half_breadth(zr, d - .05) + .05 and d <= y + .05:
        best = d
    for o in ALL_BLOCKS:
        if o is skip:
            continue
        top = o['baseY'] + o['height']
        if best < top <= y + .05 and o['baseY'] < y and inside(o['footprint'], x, zr + ZS):
            best = top
    return best


def mount_space(x, zr):
    """True inside a gun's working circle (posts stay out of it)."""
    return any(math.hypot(x - gx, zr - gz) < (max(carriage, reach) if reach else carriage) + .2 for gx, gz, gy, carriage, reach, _, _ in guns) or \
        any(math.hypot(x, zr - z) < 7.2 for _, _, _, z, _ in MAIN)


def carried(s, x, zr):
    """True when the deck or another block reaches the block's underside at (x, reference z): a surface within
    10 cm under it, or something the block's base passes into."""
    base, top = s['baseY'], s['baseY'] + s['height']
    d = deck_y(zr)
    if -L / 2 < zr + ZS < L / 2 and abs(x) <= half_breadth(zr, d - .05) + .05 and base - .05 <= d <= top:
        return True
    return any(o is not s and o['baseY'] <= base + .05 and o['baseY'] + o['height'] >= base - .05 and inside(o['footprint'], x, zr + ZS)
               for o in ALL_BLOCKS)


def edge_gap(a, c):
    """Smallest distance from a vertex of either outline to an edge of the other."""
    def point_edges(p, poly):
        best = 1e9
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            dx, dz = bx - ax, bz - az
            t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / max(1e-12, dx * dx + dz * dz)))
            best = min(best, math.hypot(p[0] - ax - t * dx, p[1] - az - t * dz))
        return best
    return min(min(point_edges(p, c) for p in a), min(point_edges(p, a) for p in c))


def side_attached(s):
    """True when a block standing beside this one over at least 10 cm of its height touches its walls."""
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] for p in s['footprint']]
    for o in ALL_BLOCKS:
        if o is s or min(s['baseY'] + s['height'], o['baseY'] + o['height']) - max(s['baseY'], o['baseY']) < .1:
            continue
        ox = [p[0] for p in o['footprint']]
        oz = [p[1] for p in o['footprint']]
        if min(ox) > max(xs) + .1 or min(xs) > max(ox) + .1 or min(oz) > max(zs) + .1 or min(zs) > max(oz) + .1:
            continue
        if edge_gap(s["footprint"], o["footprint"]) <= .05:
            return True
    return False



def samples_of(s):
    """The outline (reference frame), its vertex centroid and sample points inside it (a hooked or C-shaped outline's
    centroid can lie outside it)."""
    fp = [(p[0], p[1] - ZS) for p in s['footprint']]
    cx, cz = sum(p[0] for p in fp) / len(fp), sum(p[1] for p in fp) / len(fp)
    pts = [(cx, cz)] + [(px + (cx - px) * f, pz + (cz - pz) * f) for px, pz in fp for f in (.15, .03)]
    return fp, cx, cz, [q for q in pts if inside(fp, *q)]


def rests_on(s, o):
    """True when s's underside rests on o or passes into it at one of s's sample points."""
    base = s['baseY']
    if not (o['baseY'] <= base + .05 and o['baseY'] + o['height'] >= base - .05):
        return False
    return any(inside(o['footprint'], x, z + ZS) for x, z in samples_of(s)[3])


def beside(s, o):
    if min(s['baseY'] + s['height'], o['baseY'] + o['height']) - max(s['baseY'], o['baseY']) < .1:
        return False
    return edge_gap(s['footprint'], o['footprint']) <= .05


def on_deck(s):
    base, top = s['baseY'], s['baseY'] + s['height']
    for x, z in samples_of(s)[3]:
        d = deck_y(z)
        if -L / 2 < z + ZS < L / 2 and abs(x) <= half_breadth(z, d - .05) + .05 and base - .05 <= d <= top:
            return True
    return False


# Contacts between blocks (bounding boxes within 10 cm first), then everything reachable from the deck.
boxes = []
for s in ALL_BLOCKS:
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] for p in s['footprint']]
    boxes.append((min(xs), max(xs), min(zs), max(zs), s['baseY'], s['baseY'] + s['height']))
links = {i: set() for i in range(len(ALL_BLOCKS))}
for i, a in enumerate(ALL_BLOCKS):
    ax0, ax1, az0, az1, ay0, ay1 = boxes[i]
    for j in range(i + 1, len(ALL_BLOCKS)):
        bx0, bx1, bz0, bz1, by0, by1 = boxes[j]
        if bx0 > ax1 + .1 or ax0 > bx1 + .1 or bz0 > az1 + .1 or az0 > bz1 + .1 or by0 > ay1 + .06 or ay0 > by1 + .06:
            continue
        c = ALL_BLOCKS[j]
        if rests_on(a, c) or rests_on(c, a) or beside(a, c):
            links[i].add(j)
            links[j].add(i)
reached = {i for i, s in enumerate(ALL_BLOCKS) if on_deck(s)}


def spread():
    stack = list(reached)
    while stack:
        i = stack.pop()
        for j in links[i]:
            if j not in reached:
                reached.add(j)
                stack.append(j)


spread()
posts = []
for i in sorted(range(len(ALL_BLOCKS)), key=lambda i: ALL_BLOCKS[i]['baseY']):
    if i in reached:
        continue
    s = ALL_BLOCKS[i]
    fp, cx, cz, _ = samples_of(s)
    base = s['baseY']
    feet = []
    for px, pz in sorted(fp, key=lambda p: -math.hypot(p[0] - cx, p[1] - cz)):
        fx, fz = px + (cx - px) * .25, pz + (cz - pz) * .25
        if inside(fp, fx, fz) and all(math.hypot(fx - a, fz - c) > 1.2 for a, c in feet) and not mount_space(fx, fz):
            feet.append((fx, fz))
        if len(feet) == 4:
            break
    if not feet:
        # A thin or hooked outline: any point inside it, on a 0.2 m lattice, nearest its centroid.
        xs, zs = [q[0] for q in fp], [q[1] for q in fp]
        grid = [(min(xs) + .1 + .2 * a, min(zs) + .1 + .2 * c) for a in range(int((max(xs) - min(xs)) / .2) + 1) for c in range(int((max(zs) - min(zs)) / .2) + 1)]
        grid = [q for q in grid if inside(fp, *q) and not mount_space(*q)]
        if grid:
            feet = [min(grid, key=lambda q: math.hypot(q[0] - cx, q[1] - cz))]
    area = plan_area(fp)
    r = .06 if area < 6 else .09 if area < 30 else .13
    added = 0
    for fx, fz in feet:
        floor = surface_below(fx, fz, base - .01, s)
        if 0 < base - floor < 14:
            posts.append([round(fx, 3), rz(fz), round(floor - .02, 3), round(base + .02, 3), r])
            added += 1
    if not added and not feet:
        # All of it lies in a gun's working circle (a mount's own seat platform): it reaches down to what is under
        # it, as a drum, when that is close.
        floor = surface_below(cx, cz, base - .01, s)
        if 0 < base - floor <= 1.5:
            s['height'] = round(s['height'] + base - floor + .02, 3)
            s['baseY'] = round(floor - .02, 3)
            added = 1
    if added:
        reached.add(i)
        spread()
# A minor block still reaching nothing (a thin plate high over open space whose brackets fall under the cuts'
# minimum) is left out rather than stood on posts over 14 m tall.
for i, s in enumerate(ALL_BLOCKS):
    if i not in reached and s in minor_blocks:
        s['unsupported'] = True
print(f'unsupported structures: {[s["id"] for i, s in enumerate(ALL_BLOCKS) if i not in reached and s not in minor_blocks]}')
minor_blocks = [s for s in minor_blocks if not s.pop('unsupported', False)]
# Mounts with interlocks (the main turrets and the 12.7 cm twins) and the radius their barrels reach.
INTERLOCKED = [(m['position'][0], m['position'][2], PARTS[m['partId']]['muzzleForward'] + 1.5) for m in b['mounts'] if m['battery'] == 'main' or m['id'].startswith('ha-')]


def near_interlocked(x, z, pad=0.0):
    return any(math.hypot(x - mx, z - mz) <= r + pad for mx, mz, r in INTERLOCKED)


# Posts within an interlocked mount's reach are obstructions too, so its barrels stop at them.
for i, (x, z, y0, y1, r) in enumerate(posts):
    if near_interlocked(x, z):
        b['obstructions'].append(dict(id=f'post-{i}', center=[x, round((y0 + y1) / 2, 3), z], size=[round(2 * r + .1, 3), round(y1 - y0, 3), round(2 * r + .1, 3)]))
table = ',\n'.join('    ' + json.dumps(m) for m in minor_blocks)
(HERE / 'ise_blocks.py').write_text('"""Measured superstructure blocks beyond the blueprint\'s 256-structure limit, and the posts under blocks\n'
                                    'that rest on nothing, written by author-blueprint.py: geometry the recipe draws and fittings stand on."""\n'
                                    f'BLOCKS = [\n{table}\n]\n# [x, z, foot y, head y, radius] in the runtime frame\nPOSTS = {json.dumps(posts)}\n')
print(f'posts: {len(posts)}')
print(f'structures: {len(structures)}')

# Firing obstructions: boxes kept inside the visual walls for substantial blocks, each outline cut into
# fore-and-aft strips so a stepped deckhouse is not boxed at its widest. Within an interlocked mount's reach the
# barrels stop on these boxes as well as on the blocks themselves, so there the strips are 2 m and each box spans
# only what the block fills along its whole strip (a slanted wall is boxed at its narrowest, a tapering tip not at
# all); elsewhere they only stop the line of fire, in 10 m strips at the block's widest (the blueprint holds at
# most 256 obstructions).
def inscribed_span(poly, z0, z1):
    span = None
    levels = {z0 + .05, (z0 + z1) / 2, z1 - .05} | {p[1] + d for p in poly if z0 < p[1] < z1 for d in (-.01, .01)}
    for zc in sorted(z + 1e-6 for z in levels if z0 < z < z1):
        xs_at = sorted(ax + (bx - ax) * (zc - az) / (bz - az) for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1])
                       if (az - zc) * (bz - zc) < 0)
        runs = list(zip(xs_at[::2], xs_at[1::2]))
        if not runs:
            return None
        if span is None:
            span = max(runs, key=lambda r: r[1] - r[0])
        else:
            best = max(runs, key=lambda r: min(r[1], span[1]) - max(r[0], span[0]))
            span = (max(span[0], best[0]), min(span[1], best[1]))
        if span[1] - span[0] < 1.0:
            return None
    return span


for s in structures:
    poly = s['footprint']
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    if s['height'] < 1.2 or (max(xs) - min(xs)) * (max(zs) - min(zs)) < 6:
        continue
    near = any(near_interlocked(x, z, 1.0) for x, z in poly)
    n = max(1, math.ceil((max(zs) - min(zs)) / (2 if near else 10)))
    for k in range(n):
        z0 = min(zs) + (max(zs) - min(zs)) * k / n
        z1 = min(zs) + (max(zs) - min(zs)) * (k + 1) / n
        if near:
            span = inscribed_span(poly, z0, z1)
        else:
            pts = [p[0] for p in poly if z0 <= p[1] <= z1]
            for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
                for zc in (z0, z1):
                    if (az - zc) * (bz - zc) < 0:
                        pts.append(ax + (bx - ax) * (zc - az) / (bz - az))
            span = (min(pts), max(pts)) if len(pts) >= 2 and max(pts) - min(pts) >= 1.0 else None
        if span is None or z1 - z0 < .6:
            continue
        b['obstructions'].append(dict(id=f"{s['id']}-{k}", center=[round((span[0] + span[1]) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((z0 + z1) / 2, 3)],
                                      size=[round(span[1] - span[0] - .4, 3), round(s['height'], 3), round(z1 - z0 - .2, 3)]))


# The drawn blocks beyond the blueprint's structure limit (ise_blocks.py) are invisible to the interlocks, so each
# one a main turret's barrels can reach (inside the trained arc, between the barrels' lowest and highest heights
# there, and 0.64 m short of the muzzles in plan: the interlock's barrel capsule already reaches that far past
# them) is boxed at its bounds, 10 cm inside.
def barrel_reach(s, m):
    x, y, z = m['position']
    trunnion = y + PARTS[m['partId']]['pivotHeight']
    for (ax, az), (bx, bz) in zip(s['footprint'], s['footprint'][1:] + s['footprint'][:1]):
        steps = max(1, int(math.hypot(bx - ax, bz - az) / .25))
        for k in range(steps):
            px, pz = ax + (bx - ax) * k / steps, az + (bz - az) * k / steps
            h = math.hypot(px - x, pz - z)
            off = (math.degrees(math.atan2(px - x, -(pz - z))) - m['bearingDeg'] + 540) % 360 - 180
            if h > PARTS[m['partId']]['muzzleForward'] - .64 or (abs(off) > 146 and h > 5):
                continue
            if s['baseY'] < trunnion + max(0.0, h - 1) * math.tan(math.radians(43)) + .7 and \
                    s['baseY'] + s['height'] > trunnion - h * math.tan(math.radians(5)) - .7:
                return True
    return False


for s in minor_blocks:
    if any(m['battery'] == 'main' and barrel_reach(s, m) for m in b['mounts']):
        xs = [p[0] for p in s['footprint']]
        zs = [p[1] for p in s['footprint']]
        b['obstructions'].append(dict(id=f"minor-{s['id']}", center=[round((min(xs) + max(xs)) / 2, 3), round(s['baseY'] + s['height'] / 2, 3), round((min(zs) + max(zs)) / 2, 3)],
                                      size=[round(max(.05, max(xs) - min(xs) - .2), 3), round(s['height'], 3), round(max(.05, max(zs) - min(zs) - .2), 3)]))
# Stowed boats: reference boat bounds (x, y, z ranges), so barrels stop at and cannot fire through them.
BOATS = [('cutter-pagoda', (7.4, 9.9), (9.7, 11.31), (-36.0, -26.71)), ('motor-launch', (1.09, 4.95), (10.12, 11.79), (-23.5, -11.3)),
         ('cutter-turret-4', (6.08, 9.01), (4.86, 6.47), (11.93, 21.12))]
for name, (x0, x1), (y0, y1), (z0, z1) in BOATS:
    for side, sign in [('port', -1), ('starboard', 1)]:
        b['obstructions'].append(dict(id=f'{name}-{side}', center=[round(sign * (x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), rz((z0 + z1) / 2)],
                                      size=[round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)]))
# The dinghy on the forecastle, under No. 1 turret's depressed barrels when trained to port: the boat's own bounds
# (on low chocks, gunwale 8.39 m), which the barrels clear at a close-range broadside's elevation.
b['obstructions'].append(dict(id='dinghy', center=[-4.425, 7.755, rz(-69.743)], size=[1.61, 1.27, 6.23]))
# The catapult girders (a 1 m lattice from 9.8 to 10.8 m with its rails, on a turntable), in eighteen 1.4 m boxes
# along each slant so the boxes hug the girder (No. 3's barrels reach its inner end, No. 4's its middle when
# elevated) and stop the barrels at it.
for s_, bearing in ((-1, 19.7), (1, -19.7)):
    fx, fz = math.sin(math.radians(bearing)), -math.cos(math.radians(bearing))
    cuts = [-9.4 + 25.7 * k / 18 for k in range(19)]
    for k, (u0, u1) in enumerate(zip(cuts, cuts[1:])):
        ax, az = s_ * 13.207 + fx * u0, 32.928 + fz * u0
        bx, bz = s_ * 13.207 + fx * u1, 32.928 + fz * u1
        b['obstructions'].append(dict(id=f'catapult-{"port" if s_ < 0 else "starboard"}-{k}', center=[round((ax + bx) / 2, 3), 10.4, rz((az + bz) / 2)],
                                      size=[round(abs(bx - ax) + 1.1, 3), 1.3, round(abs(bz - az) + 1.1, 3)]))
# The superfiring turrets' barbettes need no boxes: at its 145 degree train limit the lower turret's barrels pass
# 6 m from the upper barbette's axis, and a box there would stop the upper turret's own breeches at elevation.

# ---------------------------------------------------------------- installation interlocks
# CPU motion envelopes: main barrels (with the full recoil stroke) and gunhouses may not enter the blocks they
# can reach, and each superfiring pair may not cross. Game clearance, not verified historical stops.
catalog = {p['id']: p for p in json.loads((ROOT / 'assets/parts/guns.json').read_text())['parts']}
clear_mounts, reach = [], {}
for m in b['mounts']:
    if m['battery'] != 'main' and not m['id'].startswith('ha-'):
        continue
    w = catalog[m['partId']]
    entry = dict(mountId=m['id'], barrelRadiusM=round(w['barrelBaseRadius'] * .75, 3))
    if m['battery'] == 'main':
        # Gunhouse bodies from the 3.4 m working floor to the 6.0 m roof, as on Kongo; the upper turret of each
        # superfiring pair from 3.8 m, clear of the roof guard rail the stand-in gunhouse carries on the lower one,
        # so the pair trains together to either beam (the lower 0.4 m of the upper gunhouse is out of the lower
        # turret's reach at its 145 degree train limit). That rail (its top rail 0.72 m over the sloped roof along
        # each shoulder, at the part's posts) is a chain of thin capsules on the lower turret's yaw frame, so the
        # upper turret's depressed barrels stop over it.
        lower = m['id'] in ('main-1', 'main-4')
        entry['body'] = dict(center=[0, 4.7 if lower else 4.9, 1.27], size=[9.0, 2.6 if lower else 2.2, 11.56])
        if lower:
            posts = [(-5.55, 3.18), (-4.15, 3.65), (-1.65, 3.65), (.7, 3.57), (1.55, 3.23)]
            top = [(y, 4.8 + (3.35 - x) / 10.25 * 1.2 + .72, -x) for x, y in posts]
            entry['fittings'] = [dict(joint='yaw', a=[s * a[0], round(a[1], 3), a[2]], b=[s * c[0], round(c[1], 3), c[2]], radiusM=.06)
                                 for s in (-1, 1) for a, c in zip(top, top[1:])]
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
# Neighbours: each superfiring pair, and No. 2 with the forward 12.7 cm pair abaft it, whose raised barrels its
# depressed barrels can reach when trained on the after quarters.
b['mountClearance'] = dict(version=1, marginM=.03, basis='Provisional CPU motion interlocks for the main and 12.7 cm mounts against the measured superstructure blocks they can reach, including the full recoil stroke, between the superfiring turret pairs and between No. 2 turret and the forward 12.7 cm pair. Game clearance envelopes, not verified historical mechanical stops.',
                           mounts=clear_mounts, structures=[dict(structureId=sid, topExtensionM=0) for sid in nearby],
                           neighbors=[['main-1', 'main-2'], ['main-3', 'main-4'], ['main-2', 'ha-1'], ['main-2', 'ha-2']])

# ---------------------------------------------------------------- rooms, machinery, directors
def room(id, name, center, size, kind=None, role=None, hp=150, fire=None):
    cid = id + '-room'
    compartment = dict(id=cid, name=name + ' space', center=center, size=size, capacityM3=round(math.prod(size) * .78, 1), pumpM3PerSecond=.016)
    if fire:
        compartment['fire'] = dict(fire, ventPosition=[center[0], round(deck_y(center[2] - ZS) + .5, 3), center[2]])
    b['compartments'].append(compartment)
    if kind:
        module = dict(id=id, name=name, kind=kind, compartmentId=cid, center=center, size=[round(v * .8, 3) for v in size], hp=hp, immersionToleranceM=.8)
        if role:
            module['role'] = role
        b['modules'].append(module)


MAG = dict(fuelSeconds=150, ignitionHeat=.65, heatPerDamage=.014)
ENG = dict(fuelSeconds=240, ignitionHeat=.55, heatPerDamage=.014)
# Inside the armoured citadel (z -68.4 to 70.3 in the reference's armour model, under the 0.72 m armoured deck).
room('magazine-forward', 'Forward 35.6 cm magazines', [0, -4.7, rz(-55.5)], [13, 7.2, 21], 'magazine', hp=260, fire=MAG)
room('magazine-after', 'After 35.6 cm magazines', [0, -4.7, rz(15.8)], [16, 7.2, 21], 'magazine', hp=260, fire=MAG)
room('ha-magazine', '12.7 cm magazine', [0, -4.7, rz(-40.5)], [12, 7.2, 5], 'magazine', hp=120, fire=MAG)
room('aa-ammunition', 'Forward light AA ready ammunition', [0, 2.6, rz(-30)], [9, 2.4, 6], 'magazine', hp=90, fire=MAG)
room('aa-ammunition-after', 'After light AA ready ammunition', [0, 2.6, rz(56)], [10, 2.4, 8], 'magazine', hp=90, fire=MAG)
BOILERS = [('boiler-room-1', 'No. 1 boiler room', -32.5), ('boiler-room-2', 'No. 2 boiler room', -21.5),
           ('boiler-room-3', 'No. 3 boiler room', -10.5), ('boiler-room-4', 'No. 4 boiler room', .5)]
for id, name, z in BOILERS:
    room(id, name, [0, -4.9, rz(z)], [22, 7.8, 10.6], 'engine', 'boiler', 220, ENG)
TURBINES = [('engine-room-port-forward', 'Port forward engine room', -5.4, 34.5), ('engine-room-starboard-forward', 'Starboard forward engine room', 5.4, 34.5),
            ('engine-room-port-after', 'Port after engine room', -5.2, 48.0), ('engine-room-starboard-after', 'Starboard after engine room', 5.2, 48.0)]
for id, name, x, z in TURBINES:
    room(id, name, [x, -4.9, rz(z)], [9.6, 7.4, 12.8], 'engine', 'turbine', 200, ENG)
room('shaft-alley', 'Shaft alleys', [0, -5.6, rz(66)], [14, 4.2, 14], fire=ENG)
SHAFTS = [('shaft-1', -7.1), ('shaft-2', -2.87), ('shaft-3', 2.87), ('shaft-4', 7.1)]
for id, x in SHAFTS:
    b['modules'].append(dict(id=id, name=f'Shaft {id[-1]}', kind='engine', role='shaft', compartmentId='shaft-alley-room', center=[round(x * .75, 3), -5.9, rz(66)],
                             size=[.7, 1.1, 12], hp=90, immersionToleranceM=.8))
room('steering', 'Steering gear', [0, -1.2, rz(90)], [9, 3.2, 12], 'steering', hp=160, fire=dict(fuelSeconds=80, ignitionHeat=.45, heatPerDamage=.014))
b['propulsion'] = dict(groups=[
    dict(id='outer-port', share=.25, boilerIds=['boiler-room-1'], driveIds=['engine-room-port-forward'], shaftIds=['shaft-1']),
    dict(id='outer-starboard', share=.25, boilerIds=['boiler-room-2'], driveIds=['engine-room-starboard-forward'], shaftIds=['shaft-4']),
    dict(id='inner-port', share=.25, boilerIds=['boiler-room-3'], driveIds=['engine-room-port-after'], shaftIds=['shaft-2']),
    dict(id='inner-starboard', share=.25, boilerIds=['boiler-room-4'], driveIds=['engine-room-starboard-after'], shaftIds=['shaft-3'])],
    basis='Provisional four-shaft machinery: four boiler rooms between No. 2 and No. 3 turrets and four turbine rooms abaft No. 4 turret, one group per shaft with equal shares. Room bounds and routing are game estimates; the approved exterior reference does not show them.')
MAIN_IDS = [m['id'] for m in b['mounts'] if m['battery'] == 'main']
HA_IDS = [m['id'] for m in b['mounts'] if m['id'].startswith('ha-')]
AA_PORT = [m['id'] for m in b['mounts'] if m['id'].startswith('aa25') and m['position'][0] < 0]
AA_STBD = [m['id'] for m in b['mounts'] if m['id'].startswith('aa25') and m['position'][0] >= 0]


def director(id, name, pos, serves, size, hp, mm):
    b['modules'].append(dict(id=id, name=name, kind='fire-control', placement='fixed', servesMountIds=serves,
                             center=[pos[0], round(pos[1] + size[1] / 2, 3), rz(pos[2])], size=size, hp=hp, protectionMm=mm))


# Reference director datums (HP_JD): Type 94 main directors on the pagoda and the after tower, Type 94
# high-angle directors abreast the pagoda, 25 mm control positions abreast the funnel.
director('main-director', 'Main battery director and 10 m rangefinder', [0, 36.35, -32.09], MAIN_IDS, [3.3, 2.1, 3.2], 80, 13)
director('after-director', 'After main battery director', [0, 20.05, 44.85], MAIN_IDS, [3.3, 2.1, 3.2], 60, 10)
director('ha-director-port', 'Port Type 94 high-angle director', [-7.26, 18.3, -26.74], HA_IDS, [2.7, 2.3, 4.8], 45, 6)
director('ha-director-starboard', 'Starboard Type 94 high-angle director', [7.26, 18.3, -26.74], HA_IDS, [2.7, 2.3, 4.8], 45, 6)
director('aa-director-port', 'Port 25 mm control position', [-3.59, 19.6, 4.38], AA_PORT, [1.1, 1.3, 1.1], 30, 4)
director('aa-director-starboard', 'Starboard 25 mm control position', [3.59, 19.6, 4.38], AA_STBD, [1.1, 1.3, 1.1], 30, 4)

# ---------------------------------------------------------------- protection (GameModels3D armour model)
def plate(id, name, vs, mm, exterior=False, note='Thickness and zone from the approved GameModels3D armour model; placement fitted to the authored loft. Provisional game protection.'):
    vs = [[round(c, 4) for c in v] for v in vs]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id, name=name, center=[round((a + c) / 2, 5) for a, c in zip(lo, hi)], size=[round(max(.001, c - a) + 2e-5, 5) for a, c in zip(lo, hi)],
                           thicknessMm=mm, plate=dict(vertices=vs, material='steel', exterior=exterior),
                           provenance=dict(sourceId='gamemodels3d-pjsb526-armour', basis='inferred', note=note)))


def quad(prefix, name, a, b_, c, d, mm, exterior=False):
    """Two planar triangles over a possibly twisted quad (reference z), mirrored to port."""
    for side, sign in [('port', -1), ('starboard', 1)]:
        m = lambda v: [sign * v[0], v[1], rz(v[2])]
        plate(f'{prefix}-{side}-a', f'{side.title()} {name}', [m(a), m(b_), m(c)], mm, exterior)
        plate(f'{prefix}-{side}-b', f'{side.title()} {name}', [m(a), m(c), m(d)], mm, exterior)


# Main belt on the original shell inside the bulges: (reference z, x at y -2.13, x at y 1.377), read off the
# armour model's cas_belt plates. 200 mm lower edge (-2.13 to -1.60), 299 mm belt (to 1.38), 199 mm upper belt
# (to the upper deck, 4.51-4.61 m), forward of 47.4 m.
BELT = [(-53.43, 10.725, 10.946), (-33.27, 13.018, 13.104), (-18.2, 14.107, 14.143), (-6.66, 14.431, 14.431), (10.54, 14.732, 14.622),
        (32.05, 13.944, 13.944), (37.95, 13.521, 13.521), (52.34, 12.245, 12.455), (60.02, 11.369, 11.457)]
UPPER = [(-53.43, 11.149, 4.61), (-46.21, 11.82, 4.57), (-39.46, 12.447, 4.52), (-33.27, 13.021, 4.512), (-25.05, 13.477, 4.512), (-18.2, 13.857, 4.512),
         (-6.66, 13.989, 4.512), (10.54, 14.059, 4.512), (32.05, 13.944, 4.512), (37.95, 13.077, 4.512), (47.4, 12.347, 4.54)]


def belt_x(z, y):
    lo, hi = interp([(r[0], r[1]) for r in BELT], z), interp([(r[0], r[2]) for r in BELT], z)
    return lo + (hi - lo) * (y + 2.13) / (1.377 + 2.13)


for j, ((za, ba, ta), (zb, bb, tb)) in enumerate(zip(BELT, BELT[1:])):
    quad(f'belt-lower-{j}', 'belt lower edge', (ba, -2.13, za), (bb, -2.13, zb), (belt_x(zb, -1.602), -1.602, zb), (belt_x(za, -1.602), -1.602, za), 200, True)
    quad(f'belt-{j}', 'main belt', (belt_x(za, -1.602), -1.602, za), (belt_x(zb, -1.602), -1.602, zb), (tb, 1.377, zb), (ta, 1.377, za), 299, True)
UPPER_Z = [r[0] for r in UPPER]
for j, ((za, wa, ya), (zb, wb, yb)) in enumerate(zip(UPPER, UPPER[1:])):
    quad(f'upper-belt-{j}', 'upper belt', (belt_x(za, 1.377), 1.377, za), (belt_x(zb, 1.377), 1.377, zb), (wb, yb, zb), (wa, ya, za), 199, True)
# 149 mm side of the midships deckhouse over the uptakes (upper deck to 6.81 m, z -6.66 to 9.50).
quad('uptake-side', 'uptake side armour', (13.99, 4.512, -6.655), (14.05, 4.512, 9.498), (14.05, 6.811, 9.498), (13.99, 6.811, -6.655), 149, True)
# Armoured deck at 0.72 m: 167 mm over the forward magazines, 57 mm over the boilers, 152 mm abaft No. 3 turret;
# 32 mm slopes down to the belt's lower edge.
DECK_ZONES = [(-66.3, -37.87, 167), (-37.87, 6.77, 57), (6.77, 60.02, 152)]
for i, (z0, z1, mm) in enumerate(DECK_ZONES):
    seg = max(1, round((z1 - z0) / 6))
    for j in range(seg):
        za, zb = z0 + (z1 - z0) * j / seg, z0 + (z1 - z0) * (j + 1) / seg
        wa, wb = belt_x(max(za, -53.43), .723) * .8, belt_x(max(zb, -53.43), .723) * .8
        plate(f'armoured-deck-{i}-{j}', 'Armoured deck', [[-wa, .723, rz(za)], [wa, .723, rz(za)], [wb, .723, rz(zb)], [-wb, .723, rz(zb)]], mm)
        ba, bb = belt_x(max(za, -53.43), -2.13) * .99, belt_x(max(zb, -53.43), -2.13) * .99
        quad(f'deck-slope-{i}-{j}', 'armoured deck slope', (wa, .723, za), (wb, .723, zb), (bb, -2.13, zb), (ba, -2.13, za), 32)
# Casemate (upper) deck at the upper deck and forecastle, 35 mm, over the citadel.
for j in range(16):
    za, zb = -53.43 + (47.4 + 53.43) * j / 16, -53.43 + (47.4 + 53.43) * (j + 1) / 16
    ya, yb = min(deck_y(za), 4.61) - .02, min(deck_y(zb), 4.61) - .02
    wa, wb = half_breadth(za, ya - .05) * .97, half_breadth(zb, yb - .05) * .97
    plate(f'upper-deck-{j}', 'Upper deck', [[-wa, ya, rz(za)], [wa, ya, rz(za)], [wb, yb, rz(zb)], [-wb, yb, rz(zb)]], 44)
# Transverse bulkheads.
for id, name, z, x0, x1, y0, y1, mm in [('bulkhead-forward', 'Forward armoured bulkhead', -68.43, 5.02, 7.84, -9.42, -.1, 203),
                                          ('bulkhead-forward-belt', 'Forward belt bulkhead', -53.43, 10.7, 11.15, -2.13, 4.61, 199),
                                          ('bulkhead-after', 'After armoured bulkhead', 70.26, 4.8, 4.8, -9.42, .723, 230),
                                          ('bulkhead-after-belt', 'After belt bulkhead', 60.02, 11.37, 11.46, -2.13, 2.11, 224),
                                          ('bulkhead-hangar', 'After upper belt bulkhead', 47.4, 12.3, 12.35, 2.11, 4.55, 199)]:
    plate(id, name, [[-x0, y0, rz(z)], [x0, y0, rz(z)], [x1, y1, rz(z)], [-x1, y1, rz(z)]], mm)
# Barbettes, 299 mm down to the armoured deck (the model's 162 and 100 mm lower rings on No. 2 are folded in).
for m in b['mounts'][:4]:
    x, _, z = m['position']
    top = m['position'][1] - MAIN_DY
    for i in range(24):
        a, c = i * math.tau / 24, (i + 1) * math.tau / 24
        r = 4.799
        plate(f"{m['id']}-barbette-{i}", m['name'] + ' barbette',
              [[r * math.cos(a), .723, z + r * math.sin(a)], [r * math.cos(c), .723, z + r * math.sin(c)], [r * math.cos(c), top, z + r * math.sin(c)],
               [r * math.cos(a), top, z + r * math.sin(a)]], 299)
# Conning tower (reference ss_bridge plates): 265 mm sides, 158 mm roof.
ct = dict(x0=-2.137, x1=2.137, y0=13.92, y1=16.279, z0=rz(-41.424), z1=rz(-37.7))
for id, vs, mm in [('ct-port', [[ct['x0'], ct['y0'], ct['z0']], [ct['x0'], ct['y0'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z0']]], 265),
                   ('ct-starboard', [[ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x1'], ct['y1'], ct['z0']]], 265),
                   ('ct-front', [[ct['x0'], ct['y0'], ct['z0']], [ct['x1'], ct['y0'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x0'], ct['y1'], ct['z0']]], 265),
                   ('ct-back', [[ct['x0'], ct['y0'], ct['z1']], [ct['x1'], ct['y0'], ct['z1']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 265),
                   ('ct-roof', [[ct['x0'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z0']], [ct['x1'], ct['y1'], ct['z1']], [ct['x0'], ct['y1'], ct['z1']]], 158)]:
    plate(id, 'Conning tower', vs, mm, True)
# Steering gear: the 100 mm after belt (z 65.9 to 97.4), 51 mm roof and the 100 mm after bulkhead.
for side, sign in [('port', -1), ('starboard', 1)]:
    for j in range(4):
        za, zb = 65.92 + (97.37 - 65.92) * j / 4, 65.92 + (97.37 - 65.92) * (j + 1) / 4
        xa, xb = half_breadth(za, -.7) * .96, half_breadth(zb, -.7) * .96
        plate(f'steering-belt-{side}-{j}', f'{side.title()} after belt', [[sign * xa, -2.13, rz(za)], [sign * xb, -2.13, rz(zb)], [sign * xb, .723, rz(zb)], [sign * xa, .723, rz(za)]], 100, True)
for j in range(4):
    za, zb = 60.02 + (97.37 - 60.02) * j / 4, 60.02 + (97.37 - 60.02) * (j + 1) / 4
    wa, wb = half_breadth(za, -.5) * .9, half_breadth(zb, -.5) * .9
    plate(f'steering-roof-{j}', 'Steering-gear deck', [[-wa, -.511, rz(za)], [wa, -.511, rz(za)], [wb, -.511, rz(zb)], [-wb, -.511, rz(zb)]], 51)
plate('steering-after', 'Steering-gear after bulkhead', [[-1.88, -2.13, rz(97.37)], [1.88, -2.13, rz(97.37)], [1.88, .723, rz(97.37)], [-1.88, .723, rz(97.37)]], 100)
b['underwaterProtection'] = dict(version=1, basis='Estimated anti-torpedo bulge and side-protection system outside the belt; reductions are provisional game calibration, not a trials result.',
                                 zones=[dict(id=f'bulge-{side}', name=f'{side.title()} anti-torpedo bulge', center=[sign * 15.2, -4.6, rz(3.0)],
                                             size=[3.2, 8.4, 130], damageReduction=.4, breachReduction=.4) for side, sign in [('port', -1), ('starboard', 1)]])

# ---------------------------------------------------------------- rig
# At sea the ensign flies from the after mast's gaff (reference HP_flag_nation).
b['rig'] = dict(version=1, ensigns=[dict(id='national-ensign', design='ijn', position=[0, 31.58, rz(46.06)], width=3.6, staffHeight=0)],
                radars=[dict(id='main-director', nodeId='main-director.yaw', rpm=2, sweepDeg=55, phaseDeg=40),
                        dict(id='after-director', nodeId='after-director.yaw', rpm=2, sweepDeg=55, phaseDeg=160)])
b['damageControl'] = dict(version=1, teams=4, setupSeconds=8, repairPoints=320, roomFuelSeconds=180, mountFuelSeconds=80, suppressionPerSecond=.1,
                          portablePumpM3PerSecond=.09, repairHpPerSecond=.8, repairCeiling=.6, patchM2PerSecond=.004, maxPatchM2=.4, flashProtection=.9,
                          basis='Provisional battleship crew and finite-stores calibration; not historical manning or damage-control performance.')
b['localDamage'] = dict(version=1, regions=[dict(id='hull-placeholder', name='Hull', kind='hull', durabilityFraction=1, center=[0, 0, 0], size=[round(beam, 3), 30, L])],
                        basis='Placeholder; author-local-damage.ts replaces it.')
# Keep what the gameplay helpers wrote (local damage, flood spaces, stability, damage control) when the blueprint
# is rebuilt; rerun them after a hull, structure or mount change.
if previous:
    for key in ('localDamage', 'floodRegions', 'stability', 'damageControl', 'connections'):
        if key in previous and (key != 'localDamage' or previous[key]['regions'][0]['id'] != 'hull-placeholder'):
            b[key] = previous[key]
    b['compartments'] += [c for c in previous['compartments'] if c['id'].startswith(('flood-strip-', 'flood-end-', 'reserve-cell-'))]
write(HERE / 'blueprint.json', b)
print(f'Authored ise: {len(sections)} sections, {round(volume * 1.025)} t at the reference waterline, {len(b["mounts"])} mounts, '
      f'{len(structures)} structures, {len(b["armor"])} armour plates. Next: author-local-damage (first time), author-flood-spaces, author-stability, author-damage-control.')

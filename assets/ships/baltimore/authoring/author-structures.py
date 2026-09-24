"""Write Baltimore's deckhouses, mount seats and the records that follow them from outlines and heights
measured (plan cuts, top height map, hardpoints) on the approved GameModels3D pasc108 A_Hull viewing reference.
Our frame is reference z + 0.216 m. This helper reads no reference mesh or texture; it holds the reviewed
numbers, and the blueprint remains the runtime contract.

    python3 assets/ships/baltimore/authoring/author-structures.py

It rewrites `structures`, the positions and rest bearings of every mount (IDs, parts and weapons unchanged),
the mount markers in `localDamage`, the director modules, `obstructions` and the bridge viewpoint. Run
seat-armor.py afterwards so the barbettes follow their turrets.
"""
import json, math
from pathlib import Path

DIR = Path(__file__).resolve().parents[1]
path = DIR / 'blueprint.json'
b = json.loads(path.read_text())
H = b['hull']; L = H['length']


def deck_at(z):
    """Deck height at the side at runtime z (the loft's deck line)."""
    st = L / 2 - z; t = H['deckHeights']
    for (a, u), (c, v) in zip(t, t[1:]):
        if a <= st <= c:
            return u + (v - u) * (st - a) / (c - a)
    return t[0][1] if st < t[0][0] else t[-1][1]


DECK = 6.26          # the main deck amidships (flat from z -45 to +50)


def mirror(half):
    """Close a starboard half outline [(x, z)] listed bow to stern (x >= 0) into a symmetric footprint."""
    right = [(round(x, 3), round(z, 3)) for x, z in half]
    left = [(-x, z) for x, z in reversed(right) if x > 1e-9]
    pts = right + left
    return [[x, z] for x, z in pts]


def rect(x, z0, z1, x0=None):
    x0 = -x if x0 is None else x0
    return [[x, z0], [x, z1], [x0, z1], [x0, z0]]


def ellipse(cx, cz, rx, rz, n=24):
    return [[round(cx + rx * math.cos(-math.tau * i / n), 4), round(cz + rz * math.sin(-math.tau * i / n), 4)] for i in range(n)]


def rounded(cx, cz, hx, hz, r, n=3):
    """Rounded rectangle centred (cx, cz) with half sizes hx, hz."""
    out = []
    for sx, sz, a0 in [(1, -1, -90), (1, 1, 0), (-1, 1, 90), (-1, -1, 180)]:
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            out.append([round(cx + sx * (hx - r) + r * math.cos(a), 4), round(cz + sz * (hz - r) + r * math.sin(a), 4)])
    return out


def block(id, name, footprint, base, top, material='naval'):
    return {'id': id, 'name': name, 'footprint': footprint, 'baseY': round(base, 4), 'height': round(top - base, 4), 'material': material}


def oval_stack(id, name, c0, c1, rx0, rz0, rx1, rz1, base, top, n=28):
    """A raked oval funnel: ring (centre z c0, half sizes rx0, rz0) at base to ring (c1, rx1, rz1) at top."""
    ring = lambda cz, rx, rz, y: [[round(rx * math.cos(math.tau * i / n), 4), y, round(cz + rz * math.sin(math.tau * i / n), 4)] for i in range(n)]
    vs = ring(c0, rx0, rz0, base) + ring(c1, rx1, rz1, top); tri = []
    for i in range(1, n - 1):
        tri += [[0, i + 1, i], [n, n + i, n + i + 1]]
    for i in range(n):
        j = (i + 1) % n; tri += [[i, j, j + n], [i, j + n, i + n]]
    fp = [[x, z] for x, y, z in ring(c0, rx0, rz0, base)]
    return {'id': id, 'name': name, 'footprint': fp, 'baseY': base, 'height': round(top - base, 4), 'material': 'naval',
            'surface': {'vertices': vs, 'triangles': tri}}


def loft_block(id, name, bottom, base, top_ring, top, material='naval'):
    """A solid between two outlines of equal point count (bottom at base, top_ring at top)."""
    n = len(bottom); vs = [[x, base, z] for x, z in bottom] + [[x, top, z] for x, z in top_ring]; tri = []
    for i in range(1, n - 1):
        tri += [[0, i, i + 1], [n, n + i + 1, n + i]]
    for i in range(n):
        j = (i + 1) % n; tri += [[i, j + n, j], [i, i + n, j + n]]
    return {'id': id, 'name': name, 'footprint': bottom, 'baseY': base, 'height': round(top - base, 4), 'material': material,
            'surface': {'vertices': vs, 'triangles': tri}}


S = []
# ---- Forward superstructure --------------------------------------------------------------------------------
# 01 deckhouse: pointed front abaft turret 2, full-width sponsons under the wing 5-inch mounts, a narrow after
# part to the forward funnel casing.
S.append(block('forward-deckhouse', 'Forward 01 deckhouse', mirror([
    (1.65, -36.48), (7.1, -27.73), (7.1, -20.33), (7.55, -19.88), (8.9, -19.88), (8.9, -14.88), (5.25, -14.88),
    (5.1, -16.63), (4.65, -17.08), (3.85, -17.08), (3.4, -16.63), (3.4, -11.03), (2.6, -10.53), (2.6, -6.0)]), DECK, 8.70))
# Forward funnel uptake casing from the main deck to its 15.1 m shelf.
S.append(loft_block('forward-funnel-casing', 'Forward funnel uptake casing', rounded(0, -2.94, 3.7, 3.04, .35), DECK,
                    rounded(0, -2.66, 3.7, 3.32, .35), 15.10))
# 02 level; the armoured conning position forms its rounded front.
S.append(block('conning-tower', 'Armored conning position', mirror([
    (0, -24.58), (1.6, -24.58), (2.35, -24.5), (2.7, -24.23), (2.65, -22.4), (2.6, -20.63)]), 8.70, 12.62))
S.append(block('forward-upper-deck', 'Forward 02 deckhouse', mirror([
    (2.6, -20.63), (3.1, -20.13), (3.1, -19.03), (2.6, -18.53), (2.6, -6.0)]), 8.70, 12.62))
# The bridge rises in galleries: each level's deck overhangs the house below it and carries a splinter
# bulwark (drawn by the recipe); the houses stand inside them.
S.append(block('bridge-03-deck', 'Bridge 03 gallery deck', mirror([
    (0, -26.5), (0.35, -26.5), (1.05, -26.25), (4.9, -24.03), (4.9, -23.23), (4.55, -22.88), (3.75, -22.68),
    (3.5, -22.43), (3.5, -10.88)]), 12.62, 12.70, 'roof'))
S.append(block('bridge-lower', 'Bridge 03 house', mirror([
    (0, -24.58), (0.15, -24.58), (1.35, -24.18), (2.1, -23.43), (2.6, -22.33), (2.7, -11.13), (2.45, -10.88)]), 12.70, 15.02))
S.append(block('bridge-04-deck', 'Bridge 04 gallery deck', mirror([
    (0, -26.18), (0.65, -26.18), (1.85, -25.78), (2.45, -25.38), (3.5, -24.03), (3.5, -10.83), (1.55, -9.08)]), 15.02, 15.10, 'roof'))
S.append(block('bridge-flag', 'Bridge 04 house', mirror([
    (0, -24.58), (0.75, -24.48), (1.25, -24.28), (2.4, -22.93), (2.7, -21.73), (2.7, -12.03), (2.55, -11.88)]), 15.10, 17.32))
S.append(block('bridge-navigation-deck', 'Open navigating bridge', mirror([
    (0, -25.08), (1.55, -25.08), (1.8, -24.83), (3.5, -21.63), (3.5, -18.73), (4.5, -17.73), (4.5, -16.83),
    (3.95, -16.28), (3.35, -16.08), (2.6, -15.33), (2.6, -11.23), (2.45, -11.08)]), 17.32, 17.40, 'roof'))
S.append(block('bridge-pilot-house', 'Pilot house', mirror([
    (1.5, -20.63), (2.5, -19.63), (2.5, -19.23), (1.3, -18.03), (1.3, -16.23), (1.7, -15.63), (1.7, -15.23), (2.7, -14.03),
    (2.7, -12.03), (2.55, -11.88)]), 17.40, 19.50))
# Sky lookout house on the pilot house roof, under the 5-inch director pedestal.
S.append(block('bridge-lookout-house', 'Sky lookout house', mirror([
    (1.3, -19.88), (1.3, -18.63), (2.3, -17.93), (2.7, -17.03), (2.7, -16.53), (3.1, -15.43), (3.1, -11.63), (2.95, -11.48)]), 19.50, 20.80))
S.append(block('bridge-director-tower', 'Forward 8-inch director tower', mirror([
    (0, -22.78), (0.55, -22.68), (1.3, -22.03), (1.5, -21.63), (1.5, -20.83), (1.3, -20.43), (1.1, -19.88)]), 17.40, 21.43))
S.append(block('bridge-director-pedestal', 'Forward 5-inch director pedestal', rounded(0, -13.18, 1.5, 1.5, .6), 20.80, 23.72))
# ---- After superstructure -----------------------------------------------------------------------------------
S.append(block('after-funnel-base', 'After funnel 01 base', rounded(0, 13.91, 5.1, 1.39, .25), DECK, 8.70))
# The after casing's fore face slopes aft as it rises.
S.append(loft_block('after-funnel-casing', 'After funnel uptake casing', rounded(0, 16.27, 3.7, 3.25, .35), DECK,
                    rounded(0, 16.72, 3.7, 2.8, .35), 15.80))
S.append(block('aft-deckhouse-front', 'After 01 deckhouse, mainmast base', rect(4.1, 19.52, 23.62), DECK, 8.70))
S.append(block('aft-deckhouse', 'After deckhouse', mirror([
    (1.7, 21.0), (1.7, 22.27), (2.15, 23.62), (2.9, 23.87), (2.9, 37.0), (2.1, 37.4)]), DECK, 12.85))
# The 20 mm gallery abaft the after deckhouse, cantilevered from its end at 11.8 m.
S.append(block('aft-deckhouse-tail', 'After 20 mm gallery', mirror([
    (2.1, 37.0), (2.1, 38.97), (1.35, 39.72), (0.95, 39.92)]), 11.70, 11.80, 'roof'))
S.append(block('aft-platform', 'After 02 gallery deck', mirror([
    (3.35, 22.12), (4.05, 22.12), (4.55, 22.32), (5.1, 22.87), (5.1, 24.37), (3.9, 25.27), (3.9, 27.37), (4.3, 28.17),
    (3.8, 28.87), (3.9, 33.37), (4.9, 34.77), (4.9, 35.97), (3.95, 36.92)]), 12.85, 13.00, 'roof'))
S.append(block('aft-upper-deck', 'After 03 deckhouse', mirror([
    (1.15, 23.22), (1.7, 23.77), (1.7, 25.57), (2.5, 26.37), (2.5, 29.77), (1.9, 30.37), (1.9, 31.57), (2.5, 32.17),
    (2.5, 33.97), (1.3, 34.97), (1.3, 36.17), (0.35, 36.92)]), 13.00, 15.00))
S.append(block('aft-director-tower', 'After 5-inch director pedestal', rounded(0, 28.22, 1.5, 1.5, .6), 15.00, 19.10))
# The 04 level at the head of the after superstructure and its Mk 51 platform wings.
S.append(block('aft-04-house', 'After 04 house', mirror([
    (1.25, 23.32), (1.7, 23.77), (1.7, 25.57), (2.0, 25.87), (1.6, 26.27), (1.3, 26.77)]), 15.00, 17.20))
S.append(block('aft-04-platform', 'After 04 platform', mirror([
    (1.25, 23.32), (2.55, 23.32), (3.45, 23.12), (4.3, 23.67), (4.5, 24.27), (4.2, 25.2), (3.0, 26.0), (1.6, 26.27)]), 17.20, 17.30, 'roof'))
S.append(block('aft-main-director-pedestal', 'After 8-inch director pedestal', rounded(0, 35.35, 1.45, 1.5, .6), 15.00, 16.45))
S.append(block('aft-5in-deckhouse', 'After 5-inch mount deckhouse', mirror([
    (3.35, 39.42), (3.5, 45.77), (2.7, 46.27), (1.85, 45.92)]), DECK, 8.60))
for side, sign in [('port', -1), ('starboard', 1)]:
    S.append(block(f'after-5in-pedestal-{side}', f'After 5-inch mount pedestal, {side}',
                   [[sign * x, z] for x, z in rounded(7.85, 30.1, 2.05, 2.4, .6)], DECK, 8.60))
S.append(block('hangar-coaming', 'Hangar hatch coaming', rect(5.0, 64.0, 77.0), 6.30, 6.62, 'edge'))
S.append(block('stern-aa-sponson', 'Stern 40 mm sponson', ellipse(0, 101.3, 2.65, 2.6), 6.75, 7.41))
# ---- Funnels: narrow oval stacks above their casings, the fore face raked --------------------------------------
S.append(oval_stack('forward-funnel', 'Forward Funnel', -2.11, -1.625, 1.5, 2.66, 1.6, 2.425, 15.10, 22.8))
S.append(oval_stack('after-funnel', 'After Funnel', 16.54, 16.9, 1.5, 2.76, 1.4, 2.45, 15.80, 21.8))

# ---- Mounts on the reference hardpoints (reference z + 0.216) ------------------------------------------------
SHIFT = .216
HP = {  # mount id: (x, y, z_ref, bearing)
    'main-1': (0, 7.311, -57.70, 0), 'main-2': (0, 10.164, -44.554, 0), 'main-3': (0, 7.457, 57.135, 180),
    'secondary-51': (0, 10.257, -30.471, 0),
    'secondary-52': (-7.057, 9.138, -17.878, 270), 'secondary-53': (7.057, 9.138, -17.878, 90),
    'secondary-54': (-7.668, 8.805, 30.12, 270), 'secondary-55': (7.667, 8.805, 30.12, 90),
    'secondary-56': (0, 9.077, 43.363, 180),
    'bofors-01': (0, 7.179, -74.285, 0),
    'bofors-02': (-5.808, 6.30, -37.756, 300), 'bofors-03': (5.808, 6.30, -37.756, 60),
    'bofors-04': (-7.551, 11.364, -6.316, 270), 'bofors-05': (7.551, 11.364, -6.316, 90),
    'bofors-06': (-6.829, 11.364, 6.033, 270), 'bofors-07': (6.829, 11.364, 6.033, 90),
    'bofors-08': (-7.992, 11.364, 18.086, 270), 'bofors-09': (7.992, 11.364, 18.086, 90),
    'bofors-10': (-7.218, 6.30, 38.414, 240), 'bofors-11': (7.218, 6.30, 38.414, 120),
    'bofors-12': (-1.285, 7.614, 101.003, 180),
}
# The reference hardpoint is the foot of each gunhouse. Our catalog gunhouses start 0.05 m (8-inch) and
# 0.25 m (5-inch) above their mount datum, and the 40 mm tub deck is the datum itself.
LIFT = {'main': .05, 'secondary': .25}
for m in b['mounts']:
    x, y, z, brg = HP[m['id']]
    lift = 0 if m['partId'].startswith('us-40mm') else LIFT[m['battery']]
    m['position'] = [x, round(y - lift, 4), round(z + SHIFT, 4)]
    m['bearingDeg'] = brg
mounts = {m['id']: m for m in b['mounts']}
for r in b['localDamage']['regions']:
    if r.get('mountId') in mounts:
        r['center'] = list(mounts[r['mountId']]['position'])

# 40 mm tubs. Beside the funnels they stand on pedestals rising from the main deck; the others sit on the deck.
# The recipe draws the tubs; these are their hit and clearance proxies (the tub deck lies 0.2 m below the mount).
PEDESTALS = {'bofors-04': (7.7, -6.08, 1.9, 2.4), 'bofors-06': (5.8, 6.32, 2.4, 2.4), 'bofors-08': (8.05, 18.32, 1.75, 2.4)}
tubs = [('bofors-02', 'bofors-03'), ('bofors-04', 'bofors-05'), ('bofors-06', 'bofors-07'), ('bofors-08', 'bofors-09'), ('bofors-10', 'bofors-11')]
for i, pair in enumerate(tubs):
    for sign, mid in zip([-1, 1], pair):
        x, y, z = mounts[mid]['position']
        base = round(deck_at(z), 3)
        if pair[0] in PEDESTALS:
            px, pz, hx, hz = PEDESTALS[pair[0]]
            S.append(block(f'aa-pedestal-{sign}-{i}', '40 mm tub pedestal', rounded(sign * px, pz + SHIFT, hx, hz, .6), DECK, round(y - .2, 3)))
            base = round(y - .2, 3)
        S.append(block(f'aa-platform-{sign}-{i}', '40 mm splinter tub', ellipse(x, z, 2.6, 2.6, 24), base, round(y + .94, 3)))

# ---- Directors and the records that follow them --------------------------------------------------------------
DIRECTORS = {  # module id: (z, base y, Mk 34?)
    'equipment-forward-main-director': (-21.513 + SHIFT, 21.432, True),
    'equipment-forward-dp-director': (-13.444 + SHIFT, 23.723, False),
    'equipment-after-dp-director': (27.996 + SHIFT, 19.101, False),
    'equipment-after-main-director': (35.247 + SHIFT, 16.449, True),
}
for mod in b['modules']:
    if mod['id'] in DIRECTORS:
        z, y, main = DIRECTORS[mod['id']]
        h = mod['size'][1]
        mod['center'] = [0, round(y + .7 + h / 2, 4), round(z, 4)]

# Firing-corridor obstructions: the upper works the guns must not shoot through.
b['obstructions'] = [
    {'id': 'bridge', 'center': [0, 16.2, -17.8], 'size': [7.2, 15.9, 16.6]},
    {'id': 'forward-stack', 'center': [0, 14.6, -2.3], 'size': [7.4, 16.8, 6.8]},
    {'id': 'aft-stack', 'center': [0, 14.4, 16.3], 'size': [7.4, 16.2, 6.6]},
    {'id': 'aft-house', 'center': [0, 11.6, 30.5], 'size': [5.8, 10.8, 16.8]},
]
b['viewpoints']['bridge'] = [0, 19.3, -24.2]
# Installation interlocks (the Alaska and Enterprise encoding): barrels of the 8-inch and 5-inch mounts stop at
# the deckhouses they can reach and at the obstruction boxes; superfiring neighbours stop at each other.
# Recipe-only fittings the barrels can reach are kept out of their arcs instead.
b['mountClearance'] = {
    'version': 1, 'marginM': .03,
    'basis': 'Provisional CPU motion interlocks for the three 8-inch turrets and six twin 5-inch mounts: barrels use the catalog base radius against the measured deckhouses, galleries and obstruction boxes they can reach, and the superfiring pairs interlock with each other. Game clearance envelopes, not verified historical mechanical stops.',
    'mounts': [{'mountId': id, 'barrelRadiusM': .3, 'body': {'center': [0, 1.69, 1.28], 'size': [8.48, 3.3, 9.62]}} for id in ['main-1', 'main-2', 'main-3']]
              + [{'mountId': f'secondary-5{i}', 'barrelRadiusM': .195} for i in range(1, 7)],
    'structures': [{'structureId': id, 'topExtensionM': {'bridge-03-deck': 1.25, 'bridge-04-deck': 1.45, 'aft-platform': 1.0, 'aft-deckhouse-tail': 1.0}.get(id, 0)} for id in [
        'forward-deckhouse', 'conning-tower', 'forward-upper-deck', 'bridge-03-deck', 'bridge-lower', 'bridge-04-deck',
        'forward-funnel-casing', 'after-funnel-base', 'after-funnel-casing', 'aft-deckhouse-front', 'aft-deckhouse',
        'aft-deckhouse-tail', 'aft-platform', 'aft-5in-deckhouse', 'after-5in-pedestal-port', 'after-5in-pedestal-starboard']],
    'neighbors': [['main-1', 'main-2'], ['main-2', 'secondary-51'], ['main-3', 'secondary-56']],
}
# The ensign staff stands on the stern 40 mm sponson's after rim.
b['rig']['ensigns'][0]['position'] = [0, 10.9, 103.3]
b['structures'] = S


def js(o):
    return {k: js(v) for k, v in o.items()} if isinstance(o, dict) else [js(v) for v in o] if isinstance(o, list) else int(o) if isinstance(o, float) and o.is_integer() else o


path.write_text(json.dumps(js(b), indent=2, ensure_ascii=False) + '\n')
print(len(S), 'structures;', len(b['mounts']), 'mounts re-seated')

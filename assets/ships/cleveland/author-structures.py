"""Cleveland superstructure records from measured tables. Rewrites the named blueprint `structures` in place
(same IDs, same order); every other record is left alone. Idempotent.

The tables are outlines and heights measured, like a lines plan, from the approved GameModels3D pasc208 (Hull A)
viewing reference in the runtime frame (metres, +x starboard, y up from the reference waterline, -z bow); no
reference mesh is read here. Run: python3 assets/ships/cleveland/author-structures.py, then ship:build.
"""
import json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
N = 40  # points per funnel ring

# Funnel cross-section: an egg, blunt forward and tapering aft, as [distance from the fore end / length,
# half-breadth / maximum], measured at 17 m on the forward funnel (3.77 m by 2.56 m); both funnels share it.
EGG = [(0, 0), (.066, .56), (.133, .80), (.199, .88), (.265, .96), (.332, 1), (.531, 1), (.597, .945), (.663, .89),
       (.729, .835), (.796, .75), (.862, .62), (.928, .48), (1, 0)]


def egg_w(s):
    for (a, wa), (b, wb) in zip(EGG, EGG[1:]):
        if a <= s <= b:
            return wa + (wb - wa) * (s - a) / (b - a)
    return 0.0


def ring(front, aft, half, y, top=None):
    """N points around an egg from `front` (bow-most z) to `aft`, starboard side first. `top(z)` gives a
    per-point height for a sloping rim."""
    out = []
    for i in range(N):
        t = i / N
        s = (1 - math.cos(math.tau * t)) / 2
        side = 1 if t <= .5 else -1
        # an even spread of the ends: bias s toward the ends' rounding
        z = front + s * (aft - front)
        x = side * half * egg_w(s)
        out.append([round(x, 4), round(top(z) if top else y, 4), round(z, 4)])
    return out


def funnel(ident, name, base, collar, rake, z_at, half, cowl_half, cowl_front, cowl_aft, cowl_rake, top_at, lip=.10):
    """Surface of a raked egg funnel from `base` to the collar, a flared collar band, then a narrower cowl whose
    open top is the sloping plane top_at(z). z_at(y) -> (front, aft) of the body; the body is upright below
    12.75 m, where the bridge casing encloses it."""
    rings = []
    body = [base, 12.75] + [12.75 + (collar - 12.75) * k / 6 for k in range(1, 7)]
    for y in body:
        f, a = z_at(max(y, 12.75))
        rings.append(ring(f, a, half, y))
    f, a = z_at(collar)
    # collar: a 0.4 m band flared 6 cm, then the step in to the cowl
    rings.append(ring(f - .06, a + .06, half + .06, collar + .02))
    rings.append(ring(f - .06, a + .06, half + .06, collar + .42))
    y0 = collar + .44
    rings.append(ring(cowl_front, cowl_aft, cowl_half, y0))
    # cowl: its front rakes aft at cowl_rake per metre; the open top follows the sloping plane
    def cowl_ring(frac):
        def top(z):
            return y0 + (top_at(z) - y0) * frac
        # front/aft at the local height: iterate on the raked front edge
        fr = cowl_front + cowl_rake * (top_at(cowl_front) - y0) * frac
        return ring(fr, cowl_aft, cowl_half, None, top)
    rings.append(cowl_ring(.5))
    rings.append(cowl_ring(1.0))
    # lip and throat inside the open top
    outer = rings[-1]
    cx = sum(p[0] for p in outer) / N; cz = sum(p[2] for p in outer) / N
    inner = [[round(cx + (p[0] - cx) * (1 - lip / max(cowl_half, .1)), 4), p[1], round(cz + (p[2] - cz) * (1 - lip / 1.7), 4)] for p in outer]
    throat = [[p[0], round(p[1] - .6, 4), p[2]] for p in inner]
    rings += [inner, throat]
    V = [p for r in rings for p in r]
    T = []
    for r in range(len(rings) - 1):
        for i in range(N):
            j = (i + 1) % N
            a, b, c, d = r * N + i, r * N + j, (r + 1) * N + j, (r + 1) * N + i
            T += [[a, b, c], [a, c, d]]
    ys = [p[1] for p in V]
    foot = [[p[0], p[2]] for p in rings[0]]
    return dict(id=ident, name=name, footprint=foot, baseY=base, height=round(max(ys) - base, 4), material='naval',
                surface=dict(vertices=V, triangles=T))


def forward_funnel():
    # Body centre 5.06 m forward of midships at 14 m, raked aft 0.0925 m per metre; 3.77 m long, 2.56 m wide.
    z_at = lambda y: (-5.06 + .0925 * (y - 14) - 1.885, -5.06 + .0925 * (y - 14) + 1.885)
    # Cowl: 2.18 m wide, 3.45 m long, its open top the plane through (z -3.59, 23.0) and (z -4.81, 23.5).
    top = lambda z: 23.0 + .41 * (-3.59 - z)
    return funnel('forward-funnel', 'Forward Funnel', 8.27, 21.1, .0925, z_at, 1.28, 1.09, -6.12, -2.62, .26, top)


def after_funnel():
    # Body centre 6.95 m aft of midships at 13 m, raked aft 0.09 m per metre.
    z_at = lambda y: (6.95 + .09 * (y - 13) - 1.885, 6.95 + .09 * (y - 13) + 1.885)
    top = lambda z: 22.0 + .40 * (9.08 - z)
    return funnel('after-funnel', 'After Funnel', 8.27, 20.62, .09, z_at, 1.28, 1.09, 6.02, 9.52, .27, top)


def closed(half):
    """Starboard half listed bow to stern -> ring: starboard stern-to-bow, then port bow-to-stern (the blueprint's
    order); centreline points appear once."""
    ring = [(x, z) for x, z in reversed(half)] + [(-x, z) for x, z in half if x > 1e-9]
    out = []
    for x, z in ring:
        q = [round(x + 0.0, 4), round(z, 4)]
        if not out or q != out[-1]:
            out.append(q)
    if out[0] == out[-1]:
        out.pop()
    return out


def prism(ident, name, base, top, half, material='naval'):
    return dict(id=ident, name=name, footprint=closed(half), baseY=base, height=round(top - base, 4), material=material)


# Outlines: starboard half, bow to stern, [x, z] runtime metres, traced on the reference's walls and decks.
DECKHOUSE_01 = [(1.28, -37.44), (2.18, -35.70), (2.30, -35.02), (2.22, -34.34), (3.06, -33.70), (5.06, -28.74), (5.42, -28.14),
                (5.78, -27.26), (6.22, -26.26), (6.26, -21.10), (7.56, -20.88), (7.90, -20.50), (7.90, -16.50), (7.60, -16.16),
                (6.88, -16.08), (6.74, -15.78), (6.74, -10.80)]
UPTAKE = [(2.14, -10.80), (2.14, -5.90), (2.00, -4.96), (1.66, -4.10), (0.93, -3.27), (0, -2.94)]
BRIDGE_01 = [(1.69, -27.20), (2.17, -24.81), (2.17, -10.80)]
BRIDGE_01_ROOF = [(0, -26.04), (1.03, -25.77), (1.69, -25.35), (2.17, -24.81), (2.17, -10.80)]
WALKWAY_10 = [(2.17, -24.60), (2.38, -24.60), (3.07, -23.54), (3.16, -12.18), (2.17, -12.18)]
DECK_02 = [(0, -26.04), (1.03, -25.77), (1.69, -25.35), (2.17, -24.81), (2.18, -22.41), (3.49, -22.41), (5.03, -20.46), (5.04, -18.70),
           (5.65, -18.69), (5.65, -17.36), (5.04, -17.35), (5.04, -15.03), (5.41, -14.88), (5.68, -14.54), (5.77, -14.07), (5.68, -13.60),
           (5.41, -13.25), (5.03, -13.11), (5.03, -11.75), (4.41, -11.31), (2.18, -9.76), (2.18, -5.94), (2.00, -4.96), (1.66, -4.10),
           (0.93, -3.27), (0, -2.94)]
HOUSE_03 = [(0, -26.05), (0.98, -25.81), (1.80, -25.27), (2.32, -24.63), (3.40, -22.95), (3.56, -22.43), (2.26, -22.41), (2.00, -22.31),
            (1.88, -22.03), (1.88, -14.50)]
DECK_03 = [(0, -26.39), (0.19, -26.39), (0.51, -26.13), (0.66, -25.79), (1.04, -25.70), (1.66, -25.31), (1.82, -25.10), (2.22, -25.11),
           (2.61, -24.98), (2.85, -24.58), (2.78, -23.73), (3.44, -22.74), (3.44, -18.60), (4.06, -18.50), (4.58, -18.28), (4.98, -17.95),
           (5.24, -17.51), (5.66, -13.27), (5.47, -12.83), (5.17, -12.60), (5.22, -12.51), (1.05, -10.90), (0.59, -10.55), (0.38, -10.23),
           (0, -10.10)]
HOUSE_04 = [(0, -25.03), (0.25, -24.99), (0.65, -24.87), (1.19, -24.41), (1.43, -23.93), (1.47, -22.49), (1.65, -22.27), (2.43, -21.73),
            (2.43, -21.17), (1.65, -20.63), (1.43, -20.25), (1.47, -18.61), (2.39, -17.81), (2.55, -17.45), (2.55, -17.05), (2.39, -16.73),
            (2.43, -14.89)]
ROOF_04 = [(0, -25.03), (0.64, -24.89), (1.16, -24.48), (1.44, -23.89), (1.44, -22.43), (2.45, -21.76), (2.45, -21.15), (1.44, -20.46),
           (1.44, -18.57), (2.41, -17.80), (2.42, -16.59), (3.09, -15.63), (3.10, -11.96)]
MK34_TOWER = [(0, -17.94), (0.55, -17.90), (1.05, -17.70), (1.35, -17.35), (1.42, -16.95), (1.42, -16.05), (1.35, -15.65), (1.05, -15.30),
              (0.55, -15.10), (0, -15.06)]
MIDSHIPS_01 = [(4.54, -2.40), (4.54, 12.55)]
MIDSHIPS_01_ROOF = [(5.37, -3.29), (5.37, -1.55), (7.39, -1.55), (8.35, -1.18), (9.04, -0.54), (9.48, 0.26), (9.63, 1.16), (9.48, 2.05),
                    (9.04, 2.86), (8.35, 3.50), (7.38, 3.86), (5.37, 3.86), (5.37, 12.55)]
AFTER_01 = [(4.54, 12.55), (7.20, 12.55), (7.34, 14.06), (8.20, 14.36), (8.46, 14.74), (8.46, 18.46), (8.12, 18.88), (5.68, 18.92),
            (5.34, 19.46), (5.34, 32.70), (5.12, 33.08), (4.68, 33.36), (3.20, 33.36), (3.00, 34.24), (2.04, 34.24), (1.76, 33.72),
            (0, 33.72)]
AFTER_BLOCK = [(0, 4.40), (0.74, 4.90), (1.29, 5.45), (1.73, 6.29), (1.98, 7.40), (2.13, 9.00), (2.13, 25.17), (0.79, 26.91), (0, 26.91)]
AFTER_BLOCK_01 = [(0, 4.40), (0.74, 4.90), (1.29, 5.45), (1.73, 6.29), (1.98, 7.40), (2.13, 9.00), (2.13, 19.95), (3.57, 19.95),
                  (3.57, 23.23), (2.13, 25.17), (0.79, 26.91), (0, 26.91)]
AFTER_02 = [(0, 4.53), (0.65, 4.91), (1.27, 5.43), (1.70, 6.23), (1.98, 7.46), (2.14, 9.80), (3.16, 9.80), (3.16, 11.71), (2.14, 11.72),
            (2.14, 13.91), (3.74, 13.91), (4.62, 14.11), (5.40, 14.63), (5.92, 15.40), (6.12, 16.36), (5.92, 17.31), (5.40, 18.08),
            (4.62, 18.61), (3.66, 18.80), (3.66, 24.18), (0.77, 27.72), (0, 27.72)]
AFTER_03 = [(0, 12.28), (1.78, 12.28), (2.81, 12.85), (2.80, 13.95), (1.99, 14.73), (1.98, 15.93), (1.42, 17.80), (1.42, 23.63),
            (1.14, 24.21), (0.63, 24.62), (0, 24.76)]
MAST_HOUSE = [(0, 11.43), (1.42, 11.43), (1.42, 13.94), (2.25, 13.95), (2.25, 15.06), (1.42, 15.07), (1.41, 15.64), (0, 15.64)]
MAST_HOUSE_ROOF = [(0, 9.39), (0.18, 9.39), (0.49, 9.71), (0.62, 10.15), (1.42, 11.43), (1.42, 13.94), (2.25, 13.95), (2.25, 15.06),
                   (1.42, 15.07), (1.41, 15.64), (0, 15.64)]

STRUCTURES = {
    # 01 level: forward deckhouse with the 5-inch sponsons, the uptake casing through the waist, midships and after houses.
    'forward-deckhouse': lambda: prism('forward-deckhouse', 'Forward Deckhouse', 5.6, 8.27, DECKHOUSE_01),
    'forward-uptake': lambda: prism('forward-uptake', 'Forward uptake casing', 5.6, 12.57, UPTAKE),
    'center-deckhouse': lambda: prism('center-deckhouse', 'Center Deckhouse', 5.6, 8.11, MIDSHIPS_01),
    'center-deckhouse-roof': lambda: prism('center-deckhouse-roof', 'Midships 01 deck and Bofors sponsons', 8.11, 8.27, MIDSHIPS_01_ROOF),
    'after-deckhouse': lambda: prism('after-deckhouse', 'After Deckhouse', 5.6, 8.27, AFTER_01),
    # Forward bridge: the block, the 10.3 m walkway, the 02 deck, the 03 chart house, the 03 deck, the 04 pilot house and roof.
    'forward-bridge-lower': lambda: prism('forward-bridge-lower', 'Forward Bridge Lower', 8.27, 10.32, BRIDGE_01),
    'forward-bridge-lower-platform': lambda: prism('forward-bridge-lower-platform', 'Forward bridge walkway', 10.16, 10.32, WALKWAY_10),
    'forward-bridge-middle': lambda: prism('forward-bridge-middle', 'Forward Bridge Middle', 10.32, 12.57, BRIDGE_01_ROOF),
    'forward-bridge-middle-platform': lambda: prism('forward-bridge-middle-platform', 'Forward Bridge Middle platform', 12.57, 12.73, DECK_02),
    'forward-bridge-upper': lambda: prism('forward-bridge-upper', 'Forward Bridge Upper', 12.73, 14.89, HOUSE_03),
    'forward-bridge-upper-platform': lambda: prism('forward-bridge-upper-platform', 'Forward Bridge Upper platform', 14.89, 15.05, DECK_03),
    'pilot-house': lambda: prism('pilot-house', 'Pilot House', 15.05, 17.1, HOUSE_04),
    'pilot-house-platform': lambda: prism('pilot-house-platform', 'Pilot house roof and lookout platform', 17.1, 17.25, ROOF_04),
    'main-director-tower': lambda: prism('main-director-tower', 'Main Director Tower', 17.25, 21.27, MK34_TOWER),
    # After superstructure: the block round the after funnel casing, its 02 deck, the 03 house and the mast house.
    'after-bridge-lower': lambda: prism('after-bridge-lower', 'After Bridge Lower', 8.27, 10.48, AFTER_BLOCK_01),
    'after-bridge-upper': lambda: prism('after-bridge-upper', 'After Bridge Upper', 10.48, 12.64, AFTER_BLOCK),
    'after-bridge-upper-platform': lambda: prism('after-bridge-upper-platform', 'After Bridge Upper platform', 12.64, 12.8, AFTER_02),
    'after-bridge-top': lambda: prism('after-bridge-top', 'After Bridge Top', 12.8, 15.45, AFTER_03),
    'after-mast-house': lambda: prism('after-mast-house', 'After mast house', 15.45, 17.51, MAST_HOUSE),
    'after-mast-house-platform': lambda: prism('after-mast-house-platform', 'After mast platform', 17.51, 17.67, MAST_HOUSE_ROOF),
    'forward-funnel': forward_funnel,
    'after-funnel': after_funnel,
}
# New records go after these existing ones.
AFTER = {'forward-uptake': 'forward-deckhouse', 'center-deckhouse-roof': 'center-deckhouse',
         'forward-bridge-lower-platform': 'forward-bridge-lower', 'pilot-house-platform': 'pilot-house',
         'after-mast-house': 'after-bridge-top', 'after-mast-house-platform': 'after-mast-house'}

if __name__ == '__main__':
    path = HERE / 'blueprint.json'
    b = json.loads(path.read_text())
    ids = [s['id'] for s in b['structures']]
    for ident, make in STRUCTURES.items():
        new = make()
        if ident in ids:
            i = ids.index(ident); old = b['structures'][i]
            keys = list(old.keys())
            b['structures'][i] = {k: new[k] for k in keys if k in new} | {k: v for k, v in new.items() if k not in keys}
        else:
            i = ids.index(AFTER[ident]) + 1
            b['structures'].insert(i, new); ids.insert(i, ident)
        print(f"{ident:32s} {new['baseY']:6.2f} -> {new['baseY'] + new['height']:6.2f}  {len(new['footprint'])} points")
    path.write_text(json.dumps(b, indent=2, ensure_ascii=False) + '\n')

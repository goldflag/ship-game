"""Fubuki hull stations from lines.json, the control-station offsets measured like a lines plan from the approved
GameModels3D pjsd106 viewing reference. This helper reads no reference mesh or texture.

    python3 assets/ships/fubuki/authoring/hull.py      # rewrites only blueprint.hull

definition.py builds its base hull through hull_from_lines() as well. After a hull change run
author-flood-spaces.ts, then author-stability.ts with `stability` removed (docs/ship-pipeline.md).
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DRAFT = 3.22


def hull_from_lines(mass_kg):
    lines = json.loads((HERE / 'lines.json').read_text())
    L = lines['length']; LOW, HIGH, H0 = lines['LOW'], lines['HIGH'], lines['H0']

    def levels(keel, deck):
        h0 = H0 if keel < H0 - 1.0 else keel + (deck - keel) * .6
        return [keel + (h0 - keel) * u for u in LOW] + [h0 + (deck - h0) * u for u in HIGH[:-1]] + [deck]

    rows = sorted(lines['rows'], key=lambda r: -r[0])
    # A vertical forecastle break bulkhead: the last forecastle row and the first main-deck row sit 5 cm apart.
    brk = lines['BREAK']
    for r in rows:
        if r[0] < brk and r[0] > brk - .3: r[0] = round(brk - .025, 3)
        if r[0] > brk and r[0] < brk + .3: r[0] = round(brk + .025, 3)
    sections = []
    for z, keel, deck, ws in rows:
        pts = [[round(w, 4), round(y, 4)] for w, y in zip(ws, levels(max(keel, -DRAFT), deck))]
        pts.append([0, round(deck + .005, 4)])  # deck crown closes the envelope
        sections.append({'station': round(L / 2 - z, 4), 'points': pts})
    # Ends: the stern row becomes the end section; the stem head closes on the centreline.
    sections[0]['station'] = 0
    bow = rows[-1]
    tip_deck = bow[2] + .08
    sections.append({'station': L, 'points': [[0, round(y, 4)] for y in levels(tip_deck - .55, tip_deck)] + [[0, round(tip_deck + .005, 4)]]})
    beam = round(2 * max(p[0] for s in sections for p in s['points']) + .002, 3)
    deck_edge = lambda s: s['points'][-2]
    hull = {
        'kind': 'authored-stations-v1', 'length': L, 'beam': beam, 'draft': DRAFT,
        'depth': round(max(deck_edge(s)[1] for s in sections) + DRAFT + .01, 3), 'massKg': mass_kg,
        'halfBreadths': [[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
        'deckHeights': [[s['station'], deck_edge(s)[1]] for s in sections],
        'keelHeights': [[s['station'], s['points'][0][1]] for s in sections],
        'sections': sections,
    }
    wp, vol, full = integrate(sections)
    hull['waterplaneAreaM2'] = round(wp, 1)
    # The fleet's destroyer estimate; the simulation reads it only for a ship without `stability`.
    hull['reserveBuoyancyM3'] = RESERVE_M3
    return hull, vol


RESERVE_M3 = 1100


def integrate(S):
    def area_below(ps, level):
        a = 0.0
        for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
            hi = min(y1, level)
            if hi <= y0: continue
            wb = w0 + (w1 - w0) * ((hi - y0) / (y1 - y0) if y1 > y0 else 0)
            a += (w0 + wb) / 2 * (hi - y0)
        return 2 * a

    def half_at(ps, level):
        if level < ps[0][1] or level > ps[-1][1]: return 0.0
        for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
            if y0 <= level <= y1:
                return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (level - y0) / (y1 - y0)
        return 0.0

    def over(f):
        return sum((f(a['points']) + f(b['points'])) / 2 * (b['station'] - a['station']) for a, b in zip(S, S[1:]))
    return over(lambda ps: 2 * half_at(ps, 0)), over(lambda ps: area_below(ps, 0)), over(lambda ps: area_below(ps, 1e9))


if __name__ == '__main__':
    path = HERE.parent / 'blueprint.json'
    b = json.loads(path.read_text())
    hull, volume = hull_from_lines(b['hull']['massKg'])
    b['hull'] = hull
    path.write_text(json.dumps(b, indent=2) + '\n')
    print(f"{len(hull['sections'])} sections x {len(hull['sections'][0]['points'])} points; beam {hull['beam']} depth {hull['depth']} "
          f"displacement {volume * 1.025:.0f} t ({volume:.0f} m3) waterplane {hull['waterplaneAreaM2']} reserve {hull['reserveBuoyancyM3']}")

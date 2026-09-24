"""Write the blueprint hull from lines.json, the control-station offsets measured like a lines plan from the
approved GameModels3D pasc108 A_Hull viewing reference (see ../README.md). This helper reads no reference mesh
or texture; the blueprint remains the runtime contract.

    python3 assets/ships/baltimore/authoring/author-hull.py

Only `hull` changes. Stated mass and reserve buoyancy are game values and are kept; the waterplane area is
integrated from the new sections. After running it follow the pipeline's gameplay-data order (flood spaces,
then stability with the old `stability` removed) and re-seat the armour on the new shell.
"""
import json
from pathlib import Path

DIR = Path(__file__).resolve().parents[1]
lines = json.loads(Path(__file__).with_name('lines.json').read_text())
L = lines['length']; LOW, HIGH, H0 = lines['LOW'], lines['HIGH'], lines['H0']


def levels(keel, deck):
    # Twenty levels from the keel to just above the belt's upper edge, six from there to the deck edge, so the
    # belt step and the forward flare keep their own points at every station.
    h0 = H0 if keel < H0 - 1 else keel + (deck - keel) * .75
    return [keel + (h0 - keel) * u for u in LOW] + [h0 + (deck - h0) * u for u in HIGH]


rows = sorted(lines['rows'], key=lambda r: -r[0])      # stern (z = +L/2, station 0) first
sections = []
for i, (z, keel, deck, ws) in enumerate(rows):
    if i == len(rows) - 1:
        ws = [0.0] * len(ws)                            # a knife stem head at the bow end
    sections.append({'station': round(L / 2 - z, 4), 'points': [[round(w, 4), round(y, 4)] for w, y in zip(ws, levels(keel, deck))]})
sections[0]['station'] = 0
sections[-1]['station'] = L


def area_below(ps, level):
    a = 0.0
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        lo, hi = y0, min(y1, level)
        if hi <= lo:
            continue
        wb = w0 + (w1 - w0) * ((hi - y0) / (y1 - y0) if y1 > y0 else 0)
        a += (w0 + wb) / 2 * (hi - lo)
    return 2 * a


def half_at(ps, level):
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        if y0 <= level <= y1:
            return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (level - y0) / (y1 - y0)
    return 0.0


def integrate(f):
    return sum((f(a['points']) + f(b['points'])) / 2 * (b['station'] - a['station']) for a, b in zip(sections, sections[1:]))


volume = integrate(lambda ps: area_below(ps, 0))
waterplane = integrate(lambda ps: 2 * half_at(ps, 0))
outline = [[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections]
deck = [[s['station'], s['points'][-1][1]] for s in sections]
keel = [[s['station'], s['points'][0][1]] for s in sections]
path = DIR / 'blueprint.json'
blueprint = json.loads(path.read_text())
hull = blueprint['hull']
draft = round(-min(k for _, k in keel), 3)
hull.update({
    'length': L,
    'beam': round(2 * max(w for _, w in outline), 3),
    'draft': draft,
    'depth': round(max(d for _, d in deck) + draft, 3),
    'waterplaneAreaM2': round(waterplane),
    'halfBreadths': outline, 'deckHeights': deck, 'keelHeights': keel, 'sections': sections,
})


def js(o):
    return {k: js(v) for k, v in o.items()} if isinstance(o, dict) else [js(v) for v in o] if isinstance(o, list) else int(o) if isinstance(o, float) and o.is_integer() else o


path.write_text(json.dumps(js(blueprint), indent=2, ensure_ascii=False) + '\n')
print(f"hull: {len(sections)} sections x {len(sections[0]['points'])} points, length {L}, beam {hull['beam']}, draft {draft}, "
      f"depth {hull['depth']}, displaced volume {volume:.0f} m3 ({volume * 1.025:.0f} t), waterplane {waterplane:.0f} m2, stated mass {hull['massKg'] / 1000:.0f} t")

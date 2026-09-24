"""Write the blueprint's hull stations from the measured lines table.

`lines.json` holds control-station offsets measured like a lines plan from the approved
GameModels3D pjsd718 viewing reference (runtime z, bow -Z): the keel, the deck at the side
and the half-breadth at fixed fractions of the keel-to-deck height. This helper reads no
reference mesh; only the hull block of `blueprint.json` changes, everything else is kept.

    python3 assets/ships/yukikaze/authoring/hull.py
"""
import json
from pathlib import Path

DIR = Path(__file__).resolve().parents[1]
lines = json.loads(Path(__file__).with_name('lines.json').read_text())
L = lines['length']; LEVELS = lines['levels']; HALF = L / 2


def js(o):
    if isinstance(o, dict): return {k: js(v) for k, v in o.items()}
    if isinstance(o, list): return [js(v) for v in o]
    if isinstance(o, float): return int(o) if o.is_integer() else o
    return o


sections = []
for z, keel, deck, ws in sorted(lines['rows'], key=lambda r: -r[0]):
    station = round(HALF - z, 4)
    points = [[round(w, 4), round(keel + (deck - keel) * u, 4)] for w, u in zip(ws, LEVELS)]
    sections.append({'station': station, 'points': points})
sections[0]['station'] = 0; sections[-1]['station'] = L


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


def integrate(f):
    return sum((f(a['points']) + f(b['points'])) / 2 * (b['station'] - a['station']) for a, b in zip(sections, sections[1:]))


displaced = integrate(lambda ps: area_below(ps, 0)); full = integrate(lambda ps: area_below(ps, 1e9))
waterplane = integrate(lambda ps: 2 * half_at(ps, 0))
outline = [[s['station'], max(p[0] for p in s['points'])] for s in sections]
deck = [[s['station'], s['points'][-1][1]] for s in sections]
keel = [[s['station'], s['points'][0][1]] for s in sections]
beam = round(2 * max(w for _, w in outline) + .002, 3)
draft = round(-min(k for _, k in keel), 3)

path = DIR / 'blueprint.json'
bp = json.loads(path.read_text())
h = bp['hull']
h.update({'beam': beam, 'draft': draft, 'depth': round(max(d for _, d in deck) + draft, 3),
          'waterplaneAreaM2': round(waterplane), 'reserveBuoyancyM3': round(full - displaced),
          'halfBreadths': outline, 'deckHeights': deck, 'keelHeights': keel, 'sections': sections})
path.write_text(json.dumps(js(bp), indent=2, ensure_ascii=False) + '\n')
print(f'{len(sections)} sections x {len(LEVELS)} points; beam {beam} draft {draft} depth {h["depth"]}; '
      f'displaced {displaced:.0f} m3 ({displaced * 1.025:.0f} t), waterplane {waterplane:.0f} m2, reserve {full - displaced:.0f} m3')

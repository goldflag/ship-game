"""Cleveland hull stations from authoring/lines.json. Rewrites the geometric fields of blueprint.json `hull` only.

authoring/lines.json holds control-station offsets measured, like a lines plan, from the approved GameModels3D
pasc208 (Hull A) viewing reference at that model's waterline; no reference mesh is read here. Beam, draft, depth,
the station tables and sections come from the rows. The game values massKg, waterplaneAreaM2 and
reserveBuoyancyM3 are kept (stability's buoyancy scale reconciles the stated mass with the loft). Idempotent.
After a hull change: regenerate flood spaces, then stability (remove `stability` first), then ship:build.
Run: python3 assets/ships/cleveland/author-hull.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
lines = json.loads((HERE / 'authoring/lines.json').read_text())
L = lines['length']


def area_below(ps, level):
    a = 0.0
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        lo, hi = y0, min(y1, level)
        if hi <= lo:
            continue
        wb = w0 + (w1 - w0) * ((hi - y0) / (y1 - y0) if y1 > y0 else 0)
        a += (w0 + wb) / 2 * (hi - lo)
    return 2 * a


def integrate(sections, f):
    return sum((f(a['points']) + f(b['points'])) / 2 * (b['station'] - a['station']) for a, b in zip(sections, sections[1:]))


def hull(previous):
    # Stern first: station = L/2 - z.
    sections = [dict(station=round(L / 2 - z, 4), points=[[round(w, 4), round(y, 4)] for w, y in pts])
                for z, pts in sorted(lines['rows'], key=lambda r: -r[0])]
    sections[0]['station'] = 0.0
    sections[-1]['station'] = L
    draft = -min(p[1] for s in sections for p in s['points'])
    top = max(p[1] for s in sections for p in s['points'])
    h = dict(previous)
    h.update(kind='authored-stations-v1', length=L,
             beam=round(2 * max(p[0] for s in sections for p in s['points']) + .002, 3),
             draft=round(draft, 3),
             # Keel to the highest deck edge (the stem head), as before.
             depth=round(top + draft, 3),
             halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
             deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
             keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
             sections=sections)
    return h


if __name__ == '__main__':
    path = HERE / 'blueprint.json'
    b = json.loads(path.read_text())
    keys = list(b['hull'].keys())
    h = hull(b['hull'])
    b['hull'] = {k: h[k] for k in keys} | {k: v for k, v in h.items() if k not in keys}
    path.write_text(json.dumps(b, indent=2, ensure_ascii=False) + '\n')
    volume = integrate(h['sections'], lambda ps: area_below(ps, 0))
    print(f"Cleveland hull: {len(h['sections'])} sections x {len(h['sections'][0]['points'])} points, beam {h['beam']} m, "
          f"draft {h['draft']} m, depth {h['depth']} m; loft displaces {volume * 1.025:.0f} t at the reference waterline "
          f"(stated mass {h['massKg'] / 1000:.0f} t)")

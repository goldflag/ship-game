"""King George V hull stations from authoring/lines.json. Rewrites blueprint.json `hull` only.

authoring/lines.json holds control-station offsets measured, like a lines plan, from the approved
GameModels3D pbsb107 viewing reference at that model's waterline; no reference mesh is read here.
Draft, depth, beam, waterplane and reserve buoyancy come from the sections; mass is the displacement
at the reference waterline (seawater 1025 kg/m3). Idempotent. After a hull change: refit internals,
regenerate flood spaces and stability (see README), then ship:build.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
lines = json.loads((HERE / 'authoring/lines.json').read_text())
L = lines['length']; LOW, MID, TOP, GEN = lines['LOW'], lines['MID'], lines['TOP'], lines['GEN']
BOOT = -1.1  # boot-topping lower edge; build.py paints by these two ring heights (and y = 0)


def levels(keel, deck):
    """Ring heights: twenty from the keel to the boot top, the waterline, belt step and three to the deck."""
    if keel <= -1.6 and deck >= 3.4:
        return [keel + (BOOT - keel) * u for u in LOW] + MID + [MID[-1] + (deck - MID[-1]) * u for u in TOP]
    return [keel + (deck - keel) * u for u in GEN]


def build_sections():
    rows = sorted(lines['rows'], key=lambda r: -r[0])  # stern first: station = L/2 - z
    # Stern: the counter closes on its knuckle just below the waterline. Bow: a short stem head.
    sections = [dict(station=0.0, points=[[0, round(y, 4)] for y in levels(-1.9, -.9)])]
    for z, keel, deck, ws in rows:
        sections.append(dict(station=round(L / 2 - z, 4), points=[[round(w, 4), round(y, 4)] for w, y in zip(ws, levels(keel, deck))]))
    bow = rows[-1]
    sections.append(dict(station=L, points=[[0, round(y, 4)] for y in levels(bow[2] - .45, bow[2])]))
    return sections


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
    if level < ps[0][1] or level > ps[-1][1]:
        return 0.0
    for (w0, y0), (w1, y1) in zip(ps, ps[1:]):
        if y0 <= level <= y1:
            return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (level - y0) / (y1 - y0)
    return 0.0


def integrate(sections, f):
    return sum((f(a['points']) + f(b['points'])) / 2 * (b['station'] - a['station']) for a, b in zip(sections, sections[1:]))


def section_at(sections, station):
    for a, b in zip(sections, sections[1:]):
        if a['station'] <= station <= b['station']:
            t = 0 if b['station'] == a['station'] else (station - a['station']) / (b['station'] - a['station'])
            return [(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t) for pa, pb in zip(a['points'], b['points'])]
    raise ValueError(station)


def hull():
    sections = build_sections()
    draft = -min(p[1] for s in sections for p in s['points'])
    midship = section_at(sections, L / 2)
    volume = integrate(sections, lambda ps: area_below(ps, 0))
    full = integrate(sections, lambda ps: area_below(ps, 1e9))
    return dict(kind='authored-stations-v1', length=L,
        beam=round(2 * max(p[0] for s in sections for p in s['points']), 4),
        draft=round(draft, 4),
        # Keel (lowest point) to the upper deck at side amidships; build.py seats the superstructure on
        # depth - draft, the midship deck height.
        depth=round(midship[-1][1] + draft, 4),
        massKg=round(volume * 1025),
        waterplaneAreaM2=round(integrate(sections, lambda ps: 2 * half_at(ps, 0)), 1),
        reserveBuoyancyM3=round(full - volume, 1),
        halfBreadths=[[s['station'], round(max(p[0] for p in s['points']), 4)] for s in sections],
        deckHeights=[[s['station'], s['points'][-1][1]] for s in sections],
        keelHeights=[[s['station'], s['points'][0][1]] for s in sections],
        sections=sections)


if __name__ == '__main__':
    path = HERE / 'blueprint.json'
    b = json.loads(path.read_text())
    h = hull()
    b['hull'] = h
    path.write_text(json.dumps(b, indent=2) + '\n')
    print(f"KGV hull: {len(h['sections'])} sections, draft {h['draft']} m, depth {h['depth']} m, beam {h['beam']} m, "
          f"{h['massKg'] / 1000:.0f} t at the reference waterline, waterplane {h['waterplaneAreaM2']} m2")

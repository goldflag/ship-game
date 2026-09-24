"""Kongō hull region: the hull sides, the forecastle deck forward of the pagoda (reference
z < -48), deck-edge rails over the whole length and everything below the waterline.

Owns ground tackle, the bow crest and jackstaff, portholes, bilge keels, stern anchors,
screws, shafts, brackets and rudders. Datums are reference-frame measurements converted by `P`.
"""
import math
from kongo_kit import P

# Measured prisms this module draws itself (build.py skips their generic extrusion).
CLAIMED_STRUCTURES = set()


def build(D, kit):
    cols = kit.cols
    deck = cols['Deck fittings']
    under = cols['Underwater fittings']
    sup = kit.support

    # ------------------------------------------------------------ ground tackle and bow
    for s in (-1, 1):
        hx, hy, hz = P(s * 3.05, 5.25, -101.2)
        kit.part('rod', f'anchor-{s}', deck, 'hawse ring', (hx, hy, hz - .3), (hx + .35, hy - s * .1, hz + .15), .42, 'edge', vertices=16)
        kit.part('box', f'anchor-{s}', deck, 'stock', (hx - .4, hy, hz - .7), (.6, .35, 1.6), 'edge')
        kit.part('box', f'anchor-{s}', deck, 'fluke', (hx - .4, hy, hz - 1.6), (1.2, .5, .5), 'edge')
        cx, cy, cz = P(s * 2.2, 7.05, -94.0)
        kit.cylz(f'windlass-{s}', deck, 'capstan', (cx, cy, cz), .45, .5, 'edge', 16)
        kit.cylz(f'windlass-{s}', deck, 'capstan head', (cx, cy, cz + .5), .5, .12, 'edge', 16)
        for t in range(9):
            a = P(s * (2.2 + (3.05 - 2.2) * t / 8), 7.06 - .8 * max(0, t - 6) / 2, -94.0 - 7.2 * t / 8)
            kit.part('box', f'windlass-{s}', deck, 'cable link', a, (.36, .14, .08), 'edge')
    x, y, z = P(0, 7.93, -111.03)
    kit.part('rod', 'chrysanthemum', deck, 'crest', (x - .05, y, z), (x + .1, y, z), .68, 'gold', vertices=16)
    kit.part('rod', 'jackstaff', deck, 'staff', P(0, 7.45, -110.3), P(0, 15.6, -110.3), .05, 'naval', vertices=8)
    for s in (-1, 1):
        kit.part('box', f'stern-anchor-{s}', deck, 'anchor', P(s * 4.46, 3.0, 91.98), (.8, .3, 2.3), 'edge')

    # ------------------------------------------------------------ screws, shafts, brackets and rudders
    for id, (rx, ry, rz_), shaft_z in [('screw-1', (-6.72, -5.39, 78.92), 60.0), ('screw-2', (-3.31, -6.49, 86.53), 72.0),
                                       ('screw-3', (3.46, -6.35, 86.53), 72.0), ('screw-4', (6.87, -5.24, 78.92), 60.0)]:
        x, y, z = P(rx, ry, rz_)
        kit.part('rod', id, under, 'hub', (x + .5, y, z), (x - .45, y, z), .36, 'bronze', vertices=16, r2=.22)
        for k in range(3):
            a = k * math.tau / 3 + (.3 if rx < 0 else -.3)
            mid = (x, y + math.cos(a) * .8, z + math.sin(a) * .8)
            kit.part('box', id, under, 'blade', mid, (.1, .75, 1.55), 'bronze').rotation_euler = (a - math.pi / 2, .35 if rx < 0 else -.35, 0)
        sx, sy, sz = P(rx, ry + .15, shaft_z)
        kit.part('rod', id, under, 'shaft', (x + .5, y, z), (sx, sy, sz), .23, 'edge', vertices=12)
        bx, by, bz = P(rx, ry + .05, rz_ - 3.2)
        foot = sup.below(bx, by * .6, bz + 4)
        kit.part('rod', id, under, 'bracket', (bx, by, bz), (bx, by * .55, foot + .05), .14, 'naval', vertices=8)
        kit.part('rod', id, under, 'bracket', (bx, by, bz), (bx, by * 1.08, foot + .05), .14, 'naval', vertices=8)
    for id, rx in [('rudder-port', -2.29), ('rudder-starboard', 2.29)]:
        pts = [P(rx, -4.55, 88.2), P(rx, -4.55, 94.8), P(rx, -8.3, 94.1), P(rx, -9.0, 91.0), P(rx, -8.6, 88.6)]
        outline = [(p[0], p[2]) for p in pts]
        n = len(outline)
        vv = [(a, P(rx, 0, 0)[1] + s * .35, b) for s in (-1, 1) for a, b in outline]
        ff = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        kit.tag(kit.mesh(id + '.blade', vv, ff, 'antifouling', under), id)
        x, y, z = P(rx, -4.5, 90.2)
        kit.part('rod', id, under, 'stock', (x, y, z - .2), (x, y, z + .9), .2, 'antifouling', vertices=10)

    # ------------------------------------------------------------ deck-edge rails
    H = D['hull']
    L = H['length']
    secs = H['sections']

    def edge(station):
        for a, b in zip(secs, secs[1:]):
            if a['station'] <= station <= b['station']:
                t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
                pa, pb = a['points'][-1], b['points'][-1]
                return pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t
        return secs[-1]['points'][-1]
    # Casemate drums turn in the forecastle embrasures below the deck edge: no rail over them.
    drums = [(-m['position'][2], -m['position'][0]) for m in D['mounts'] if m['partId'].endswith('casemate')]
    for side in (-1, 1):
        pts = []
        for i in range(0, 441):
            st = 1.0 + (L - 3.5) * i / 440
            w, h = edge(st)
            pts.append((st - L / 2, side * max(0, w - .08), h))
        run = []
        for p, q in zip(pts, pts[1:]):
            near_drum = any(math.hypot(p[0] - dx, p[1] - dy) < 1.7 or math.hypot(q[0] - dx, q[1] - dy) < 1.7 for dx, dy in drums)
            if abs(p[2] - q[2]) > .35 or abs(p[1] - q[1]) > .8 or near_drum:
                if len(run) > 1:
                    kit.rail('deck-rails', deck, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)
                run = []
                continue
            run.append(p)
        if len(run) > 1:
            kit.rail('deck-rails', deck, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)

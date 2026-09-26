"""Hyūga hull region: weather-deck fittings, ground tackle, the bow crest and jackstaff, boats' fenders,
deck-edge rails and everything below the waterline.

Owns the fittings table (ventilators, hatches, winches, reels, fairleads, cleats, life buoys, capstans,
paravanes, anchors, ammunition boxes, lamps and ladders at the reference's positions and sizes), the
anchors in their hawses, the four three-bladed screws with their shafts and brackets, the inner shaft
skegs and the twin rudders. Datums are reference-frame measurements converted by `P`.
"""
import math
from mathutils import Vector
from hyuga_kit import P, ZC
from hyuga_fittings_table import FITTINGS
from hyuga_windows import WINDOWS

CLAIMED_STRUCTURES = set()


def build(D, kit):
    cols = kit.cols
    deck = cols['Deck fittings']
    under = cols['Underwater fittings']
    deck_fittings(kit, deck)
    anchors(kit, deck)
    crest_and_staffs(kit, deck)
    kit.windows('hull-portholes', cols['Hull and decks'], WINDOWS['hull'])
    screws_and_rudders(kit, under)
    deck_edge_rails(D, kit, deck)


def seat(kit, x, y, top, fallback):
    """Deck or roof under (x, y) (authoring frame) at or below `top`, else `fallback`."""
    return kit.try_below(x, y, top, fallback)


# ---------------------------------------------------------------- weather-deck fittings from the table
def deck_fittings(kit, col):
    n = 0
    for kind, rows in FITTINGS.items():
        for cx, y0, cz, sx, sy, sz in rows:
            n += 1
            A = f'{kind}-{n}'
            x, y, _ = P(cx, 0, cz)
            if kind in ('searchlight', 'dinghy', 'cutter', 'motor-launch', 'motor-boat', 'landing-craft', 'screw', 'anchor', 'float', 'binocular', 'fender'):
                continue        # drawn by their own regions
            L, W, Hh = sz, sx, sy          # authoring: X along the ship (reference z), Y across (reference x)
            if kind in ('life-buoy', 'fender'):
                # Hung on a wall or bulwark: pressed against the first surface inboard, or left out.
                c = Vector((x, y, y0 + Hh / 2))
                inward = Vector((0, -1 if y > 0 else 1, 0))
                hit = kit.try_along(tuple(c - inward * .6), tuple(inward), 2.5)
                if hit is None:
                    continue
                y = hit.y - inward.y * (min(L, W) * .5 + .02)
                floor = y0
            elif kind not in ('ladder', 'leadsman-platform'):
                floor = seat(kit, x, y, y0 + .5, None)
                if floor is None or floor < y0 - .6:
                    continue            # nothing under it here: its wall or rail mount is not modelled
                if kit.in_arc((x, y, floor), (x, y, floor + Hh)):
                    continue            # under a gun's sweep: the barrels would strike it
            else:
                floor = y0
            if kind == 'mushroom-vent':
                r = min(L, W) / 2
                kit.cylz(A, col, 'trunk', (x, y, floor), r * .5, Hh * .75, 'naval', 12)
                kit.cylz(A, col, 'cap', (x, y, floor + Hh * .68), r, Hh * .32, 'naval', 16, r2=r * .55)
            elif kind == 'cowl-vent':
                r = min(L, W) / 2
                kit.cylz(A, col, 'trunk', (x, y, floor), r * .55, Hh * .7, 'naval', 12)
                cowl = kit.part('rod', A, col, 'cowl', (x, y, floor + Hh * .72), (x + r * .6, y, floor + Hh * .95), r * .8, 'naval', vertices=14, r2=r * .95)
                kit.part('rod', A, col, 'mouth', (x + r * .6, y, floor + Hh * .95), (x + r * .65, y, floor + Hh * .96), r * .8, 'dark', vertices=14)
            elif kind == 'box-vent':
                kit.part('box', A, col, 'trunk', (x, y, floor + Hh * .38), (L * .8, W * .8, Hh * .76), 'naval')
                kit.part('box', A, col, 'hood', (x, y, floor + Hh * .85), (L, W, Hh * .3), 'naval')
                kit.part('box', A, col, 'louvre', (x + L * .5, y, floor + Hh * .66), (.02, W * .7, Hh * .2), 'dark')
            elif kind == 'hatch':
                kit.part('box', A, col, 'coaming', (x, y, floor + Hh * .42), (L, W, Hh * .84), 'naval')
                kit.part('box', A, col, 'cover', (x, y, floor + Hh * .92), (L + .06, W + .06, Hh * .16), 'roof')
                for s in (-1, 1):
                    kit.part('box', A, col, 'dog', (x + s * L * .3, y + W * .5 + .02, floor + Hh * .6), (.08, .05, .1), 'edge')
            elif kind == 'winch':
                kit.part('box', A, col, 'bed', (x, y, floor + .08), (L, W, .16), 'naval')
                along = L >= W
                a, b = ((x - L * .38, y), (x + L * .38, y)) if along else ((x, y - W * .38), (x, y + W * .38))
                kit.part('rod', A, col, 'drum', (a[0], a[1], floor + Hh * .5), (b[0], b[1], floor + Hh * .5), min(L, W) * .3, 'naval', vertices=16)
                for p in (a, b):
                    kit.part('rod', A, col, 'warping end', (p[0], p[1], floor + Hh * .5), (p[0] + (b[0] - a[0]) * .08, p[1] + (b[1] - a[1]) * .08, floor + Hh * .5), min(L, W) * .22, 'edge', vertices=12)
                kit.part('box', A, col, 'motor', (x - (0 if along else L * .25), y - (W * .25 if along else 0), floor + Hh * .38), (min(L, W) * .5, min(L, W) * .5, Hh * .6), 'naval')
            elif kind == 'reel':
                along = L >= W
                half = (L if along else W) * .42
                a = (x - half, y, floor + Hh * .55) if along else (x, y - half, floor + Hh * .55)
                b = (x + half, y, floor + Hh * .55) if along else (x, y + half, floor + Hh * .55)
                kit.part('rod', A, col, 'drum', a, b, Hh * .35, 'wood', vertices=16)
                for p in (a, b):
                    kit.part('rod', A, col, 'flange', p, (p[0] + (b[0] - a[0]) * .03, p[1] + (b[1] - a[1]) * .03, p[2]), Hh * .45, 'naval', vertices=16)
                    kit.part('rod', A, col, 'stand', (p[0], p[1], floor), p, .04, 'naval', vertices=6)
            elif kind == 'fairlead':
                kit.part('box', A, col, 'base', (x, y, floor + .06), (L, W, .12), 'naval')
                for s in (-1, 1):
                    kit.cylz(A, col, 'roller', (x + s * L * .25, y, floor + .1), min(L, W) * .22, Hh * .8, 'naval', 12)
            elif kind == 'cleat':
                kit.part('box', A, col, 'base', (x, y, floor + .05), (L, W, .1), 'naval')
                for s in (-1, 1):
                    kit.cylz(A, col, 'bitt', (x + s * L * .28, y, floor), min(L, W) * .3, Hh, 'naval', 12)
            elif kind == 'life-buoy':
                c = Vector((x, y, y0 + Hh / 2))
                r = max(L, W, Hh) * .36
                u = Vector((1, 0, 0))
                pts = [c + (u * math.cos(t) + Vector((0, 0, 1)) * math.sin(t)) * r for t in [i * math.tau / 10 for i in range(11)]]
                for i, (p, q) in enumerate(zip(pts, pts[1:])):
                    kit.part('rod', A, col, 'ring', tuple(p), tuple(q), .07, 'white' if i % 2 == 0 else 'antifouling', vertices=6)
            elif kind == 'capstan':
                r = min(L, W) / 2
                kit.part('box', A, col, 'bed plate', (x, y, floor + .03), (r * 2.6, r * 2.6, .06), 'naval')
                kit.cylz(A, col, 'barrel', (x, y, floor), r * .8, Hh * .6, 'naval', 8, r2=r * .7)
                kit.cylz(A, col, 'head', (x, y, floor + Hh * .6), r * .9, Hh * .18, 'naval', 16)
                for i in range(8):
                    a = math.tau * (i + .5) / 8
                    kit.part('box', A, col, 'whelp', (x + math.cos(a) * r * .75, y + math.sin(a) * r * .75, floor + Hh * .3), (.1, .1, Hh * .55), 'naval')
            elif kind == 'paravane':
                c = Vector((x, y, y0 + Hh * .55))
                kit.part('rod', A, col, 'body', tuple(c - Vector((L * .45, 0, 0))), tuple(c + Vector((L * .4, 0, 0))), Hh * .2, 'naval', vertices=10, r2=Hh * .1)
                kit.part('box', A, col, 'plane', tuple(c + Vector((-L * .1, 0, 0))), (L * .3, W * .9, .04), 'naval')
                for s in (-.3, .3):
                    kit.part('box', A, col, 'chock', (c.x + s * L, y, floor + (c.z - floor) / 2), (.12, .3, c.z - floor), 'naval')
            elif kind == 'ammunition-box':
                kit.part('box', A, col, 'locker', (x, y, floor + Hh / 2), (L, W, Hh), 'naval')
                kit.part('box', A, col, 'lid', (x, y, floor + Hh + .02), (L + .04, W + .04, .04), 'roof')
            elif kind == 'fender':
                c = Vector((x, y, y0 + Hh / 2))
                kit.part('rod', A, col, 'lanyard', tuple(c + Vector((0, 0, Hh * .4))), tuple(c + Vector((0, 0, Hh * .55))), .015, 'edge', vertices=4)
                kit.part('rod', A, col, 'fender', tuple(c - Vector((0, 0, Hh * .4))), tuple(c + Vector((0, 0, Hh * .4))), min(L, W) * .45, 'wood', vertices=10)
            elif kind == 'lamp':
                kit.cylz(A, col, 'lamp post', (x, y, floor), .04, max(.1, y0 + Hh * .6 - floor), 'naval', 6)
                kit.cylz(A, col, 'lamp', (x, y, y0 + Hh * .55), min(L, W) * .35, Hh * .45, 'naval', 10)
            elif kind == 'antenna':
                kit.part('rod', A, col, 'antenna', (x, y, floor), (x, y, y0 + Hh), .03, 'edge', vertices=5)
            elif kind == 'ladder':
                # Accommodation ladder stowed along the hull side.
                side = 1 if y > 0 else -1
                a = Vector((x - L / 2, y, y0 + .1))
                b = Vector((x + L / 2, y, y0 + Hh - .1))
                kit.part('box', A, col, 'ladder stringer', tuple((a + b) / 2), (L, .12, Hh * .5), 'naval')
                kit.part('box', A, col, 'ladder platform', (x + L / 2 - .4, y, y0 + Hh - .1), (.8, .9, .08), 'naval')
            elif kind == 'leadsman-platform':
                kit.part('box', A, col, 'platform', (x, y, y0 + .05), (L, W, .1), 'naval')
                for s in (-1, 1):
                    kit.part('rod', A, col, 'bracket', (x + s * L * .4, y - math.copysign(W * .45, y), y0), (x + s * L * .4, y + math.copysign(W * .4, y), y0 - .6), .03, 'naval', vertices=5)


# ---------------------------------------------------------------- anchors
def anchor(kit, assembly, col, hawse, crown, s, scale=1.0):
    """Stockless anchor housed against the hull: shank from the hawse to the crown, arms and palms."""
    h, c = Vector(hawse), Vector(crown)
    kit.part('rod', assembly, col, 'shank', h, c, .15 * scale, 'black', vertices=10, r2=.13 * scale)
    axis = (c - h).normalized()
    across = axis.cross(Vector((0, s, 0))).normalized()
    for t in (-1, 1):
        tip = c + across * t * 1.0 * scale - axis * .7 * scale
        kit.part('rod', assembly, col, 'arm', c, tip, .13 * scale, 'black', vertices=8)
        kit.part('box', assembly, col, 'palm', tuple(tip - axis * .1 * scale), (.5 * scale, .2 * scale, .5 * scale), 'black')
    kit.part('box', assembly, col, 'crown', tuple(c), (.55 * scale, .38 * scale, .55 * scale), 'black')


def anchors(kit, col):
    for s in (-1, 1):
        side = 'port' if s > 0 else 'starboard'        # authoring +Y is port
        # Bower anchors housed in their hawses on the bow (reference anchor bounds), cast out to the shell.
        x, _, _ = P(0, 0, -102.1)
        hit = kit.try_along((x, 0, 6.9), (0, s, 0), 8.0)
        wall = hit.y if hit else s * 2.35
        anchor(kit, f'bower-anchor-{side}', col, (x, wall + s * .22, 7.25), (x - 1.5, wall + s * .28, 4.9), s)
        kit.part('rod', f'bower-anchor-{side}', col, 'hawse lip', (x + .1, wall - s * .02, 7.3), (x + .1, wall + s * .12, 7.3), .36, 'naval', vertices=14)
        # Stern anchors in their hawses under the quarterdeck.
        x, _, _ = P(0, 0, 99.9)
        hit = kit.try_along((x, 0, 2.9), (0, s, 0), 8.0)
        wall = hit.y if hit else s * 3.05
        anchor(kit, f'stern-anchor-{side}', col, (x, wall + s * .18, 3.6), (x - .6, wall + s * .22, 2.05), s, .6)


def crest_and_staffs(kit, col):
    # Gold chrysanthemum on the stem head (reference JM306-309 datum).
    x, y, z = P(0, 7.55, -108.55)
    hx = kit.try_along((x - 1.5, 0, 7.55), (1, 0, 0), 4.0)
    x = hx.x if hx else x
    kit.part('rod', 'chrysanthemum', col, 'crest', (x - .05, 0, 7.55), (x + .1, 0, 7.55), .42, 'gold', vertices=16)
    for i in range(16):
        a = math.tau * i / 16
        kit.part('box', 'chrysanthemum', col, 'petal', (x + .08, .3 * math.cos(a), 7.55 + .3 * math.sin(a)), (.06, .11, .11), 'gold')
    fx, fy, _ = P(0, 0, -107.6)
    floor = kit.try_below(fx, fy, 9.5, 8.0)
    kit.part('rod', 'jackstaff', col, 'staff', (fx, fy, floor), (fx, fy, floor + 7.4), .05, 'naval', vertices=8)


# ---------------------------------------------------------------- screws, shafts, brackets, skegs and rudders
def screw(kit, id, col, hub, pitch_hand, R=1.8):
    """Three-bladed screw on a tapered boss; blades lofted with pitch and skew."""
    hx, hy, hz = hub
    kit.part('rod', id, col, 'boss', (hx + .5, hy, hz), (hx - .45, hy, hz), .36, 'bronze', vertices=16, r2=.2)
    root, pitch = .34, 3.9
    for k in range(3):
        base = k * math.tau / 3
        vv = []
        radii = [root + (R - root) * i / 6 for i in range(7)]
        for r in radii:
            f = (r - root) / (R - root)
            chord = 1.4 * math.sqrt(max(0, 1 - (f - .45) ** 2 / .62 ** 2)) + .18
            phi = math.atan(pitch / (math.tau * r))
            skew = .35 * f * f
            thick = .09 * (1 - f) + .025
            for side in (1, -1):
                for c in (-.5, -.2, .15, .5):
                    ang = base + (c * chord) / r * math.cos(phi) * pitch_hand + skew * pitch_hand
                    ax = -c * chord * math.sin(phi) + side * thick * (1 - abs(c) * 1.6) * .5 * math.cos(phi)
                    vv.append((hx + ax, hy + r * math.cos(ang), hz + r * math.sin(ang)))
        n = 8
        ff = []
        for i in range(len(radii) - 1):
            for j in range(3):
                a, b = i * n + j, (i + 1) * n + j
                ff.append((a, a + 1, b + 1, b))
                ff.append((a + 4 + 1, a + 4, b + 4, b + 4 + 1))
            ff.append((i * n, (i + 1) * n, (i + 1) * n + 4, i * n + 4))
            ff.append((i * n + 3 + 4, (i + 1) * n + 3 + 4, (i + 1) * n + 3, i * n + 3))
        t = (len(radii) - 1) * n
        ff.append((t, t + 4, t + 5, t + 1))
        ff.append((t + 1, t + 5, t + 6, t + 2))
        ff.append((t + 2, t + 6, t + 7, t + 3))
        if pitch_hand > 0:
            ff = [tuple(reversed(f)) for f in ff]
        ob = kit.mesh(f'{id}.blade', vv, ff, 'bronze', col, True)
        for poly in ob.data.polygons:
            poly.use_smooth = True
        kit.tag(ob, id)


def rudder(kit, id, col, rx):
    """Streamlined rudder blade (reference z 85.9-92.8, 4.7 m deep) under a stock into the counter."""
    zs = [85.86, 86.1, 86.6, 87.4, 88.4, 89.5, 90.7, 91.8, 92.5, 92.8]
    top = [-4.9, -4.75, -4.7, -4.68, -4.68, -4.7, -4.72, -4.75, -4.8, -4.9]
    bot = [-4.9, -8.7, -9.1, -9.3, -9.36, -9.36, -9.3, -9.15, -8.9, -4.9]
    c0, c1 = zs[0], zs[-1]
    vv = []
    for z, yt, yb in zip(zs, top, bot):
        u = (z - c0) / (c1 - c0)
        f = 1.4845 * math.sqrt(u) - .63 * u - 1.758 * u * u + 1.4215 * u ** 3 - .5075 * u ** 4
        t = max(.02, .4 * f / .5)
        for sx, yy in ((-1, yb), (1, yb), (1, yt), (-1, yt)):
            vv.append(P(rx + sx * t, yy, z))
    n = len(zs)
    ff = [(4 * i + j, 4 * i + (j + 1) % 4, 4 * (i + 1) + (j + 1) % 4, 4 * (i + 1) + j) for i in range(n - 1) for j in range(4)]
    ff += [(3, 2, 1, 0), (4 * (n - 1), 4 * (n - 1) + 1, 4 * (n - 1) + 2, 4 * (n - 1) + 3)]
    kit.tag(kit.mesh(id + '.blade', vv, ff, 'antifouling', col), id)
    x, y, z = P(rx, -4.7, 88.2)
    hull = kit.try_along((x, y, z), (0, 0, 1), 4.0)
    top_z = hull.z + .2 if hull else -4.2
    kit.part('rod', id, col, 'stock', (x, y, z - .1), (x, y, top_z), .22, 'antifouling', vertices=12)


def screws_and_rudders(kit, col):
    sup = kit.support
    # Screws (reference propeller bounds): outer pair at z 75.1, inner pair at z 84.2.
    for id, (rx, ry, rz_), shaft_from in [('screw-1', (-7.11, -6.43, 75.12), 62.0), ('screw-2', (-2.86, -7.17, 84.18), 74.0),
                                          ('screw-3', (2.87, -7.17, 84.18), 74.0), ('screw-4', (7.11, -6.43, 75.12), 62.0)]:
        x, y, z = P(rx, ry, rz_)
        screw(kit, id, col, (x, y, z), 1 if rx < 0 else -1)
        sx, sy, sz = P(rx, ry + .6, shaft_from)
        kit.part('rod', id, col, 'shaft', (x + .5, y, z), (sx, sy, sz), .24, 'edge', vertices=12)
        # A-bracket two metres ahead of the screw, its legs into the hull.
        bx, by, bz = P(rx, ry + .08, rz_ - 1.9)
        kit.part('rod', id, col, 'bracket boss', (bx + .45, by, bz), (bx - .45, by, bz), .33, 'antifouling', vertices=12)
        for dy in (-.9, .9):
            target = (bx, by + dy * 1.4, bz + 2.4)
            hit = kit.try_along((bx, by, bz), Vector(target) - Vector((bx, by, bz)), 5.0)
            end = tuple(hit + (hit - Vector((bx, by, bz))).normalized() * .15) if hit else target
            kit.part('rod', id, col, 'bracket', (bx, by, bz), end, .13, 'antifouling', vertices=8)
    # Inner shaft skegs (reference z 73-83 at x 2.86, down to y -7.96).
    for s in (-1, 1):
        A = f'skeg-{"port" if s < 0 else "starboard"}'
        pts = [(73.0, -7.6), (75.5, -7.95), (80.0, -7.96), (83.0, -7.6)]
        vv = []
        for zr, yb in pts:
            x, y, _ = P(s * 2.86, 0, zr)
            top = kit.try_along((x, y, yb), (0, 0, 1), 6.0)
            yt = top.z + .1 if top else yb + 2.0
            for dx in (-.35, .35):
                vv += [(x, y + dx, yb), (x, y + dx, yt)]
        n = len(pts)
        ff = []
        for i in range(n - 1):
            a, b = 4 * i, 4 * (i + 1)
            ff += [(a, b, b + 1, a + 1), (a + 3, b + 3, b + 2, a + 2), (a, a + 2, b + 2, b), (a + 1, b + 1, b + 3, a + 3)]
        ff += [(0, 1, 3, 2), (4 * (n - 1) + 2, 4 * (n - 1) + 3, 4 * (n - 1) + 1, 4 * (n - 1))]
        ob = kit.mesh(A + '.skeg', vv, ff, 'antifouling', col)
        kit.tag(ob, A)
    for id, rx in [('rudder-port', -1.87), ('rudder-starboard', 1.87)]:
        rudder(kit, id, col, rx)


# ---------------------------------------------------------------- deck-edge rails
def deck_edge_rails(D, kit, col):
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
                    kit.rail('deck-rails', col, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)
                run = []
                continue
            run.append(p)
        if len(run) > 1:
            kit.rail('deck-rails', col, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)

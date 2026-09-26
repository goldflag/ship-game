"""Nagato hull fittings: deck gear at the reference datums (vents, bitts, fairleads, winches, capstans, hatches,
reels, lockers, lamps, life buoys), ground tackle, the four three-bladed screws on their shafts and brackets, the
twin rudders, bilge keels and the chrysanthemum on the stem.

Datums are the cached pjsb010 reference's part bounds (nagato_gear.GEAR) and profile cuts, converted by `P`.
"""
import math
from mathutils import Vector
from nagato_kit import P, ZC
from nagato_gear import GEAR


def rows(kind):
    return [r[1:] for r in GEAR if r[0] == kind]


def loft_half_breadth(D, zref, y):
    """Half breadth of the authored loft at reference z and height y (0 outside the section)."""
    h = D['hull']
    station = h['length'] / 2 - (zref - ZC)
    secs = h['sections']

    def at(points):
        ys = [p[1] for p in points]
        if y < ys[0] or y > ys[-1]:
            return 0
        for (w0, y0), (w1, y1) in zip(points, points[1:]):
            if y0 <= y <= y1:
                return w0 if y1 - y0 < 1e-9 else w0 + (w1 - w0) * (y - y0) / (y1 - y0)
        return points[-1][0]
    for a, b in zip(secs, secs[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return at(a['points']) * (1 - t) + at(b['points']) * t
    return 0


def loft_keel(D, zref):
    h = D['hull']
    station = h['length'] / 2 - (zref - ZC)
    secs = h['sections']
    for a, b in zip(secs, secs[1:]):
        if a['station'] <= station <= b['station']:
            t = (station - a['station']) / max(1e-9, b['station'] - a['station'])
            return a['points'][0][1] * (1 - t) + b['points'][0][1] * t
    return secs[0]['points'][0][1]


def gear(kit):
    col = kit.collections['Deck fittings']
    A = 'deck-gear'

    # Main gunhouses sweep a circle round their axes from the sole up: gear there must stay under the sole.
    turrets = []
    for m in kit.D['mounts']:
        if m['battery'] == 'main':
            tx, ty, tz = -m['position'][2], -m['position'][0], m['position'][1]
            turrets.append((tx, ty, tz, 8.0 if m['partId'].endswith('rf-aft') else 7.4))

    def clear_of_turrets(cx, cy, cz, top, r):
        return all(math.hypot(cx - tx, cy - ty) > rr + r or top < tz - .05 for tx, ty, tz, rr in turrets)

    def seated(x, foot, z, height=1.0, r=.5):
        """Authoring foot point on the deck or roof under a datum, or None when nothing stands within 35 cm or the
        fitting would stand in a main gunhouse's swept circle."""
        cx, cy, cz = P(x, foot, z)
        floor = kit.below(cx, cy, cz + .3, -99.0)
        if cz - floor > .35 or not clear_of_turrets(cx, cy, floor, floor + height, r):
            return None
        return (cx, cy, floor)
    for x, y, z, sx, sy, sz, foot in rows('mushroom-vent'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        r = max(sx, sz) / 2
        kit.cylz(A, col, 'vent trunk', (cx, cy, cz - .02), r * .55, sy * .7, 'naval', 12)
        kit.cylz(A, col, 'vent head', (cx, cy, cz + sy * .66), r, sy * .3, 'naval', 16, r2=r * .75)
    for x, y, z, sx, sy, sz, foot in rows('cowl-vent'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        r = min(sx, sz) / 2
        kit.cylz(A, col, 'cowl trunk', (cx, cy, cz - .02), r * .6, sy * .65, 'naval', 10)
        kit.part('rod', A, col, 'cowl head', (cx, cy, cz + sy * .62), (cx + r * .9, cy, cz + sy * .62), r * .75, 'naval', vertices=12)
        kit.part('rod', A, col, 'cowl mouth', (cx + r * .9, cy, cz + sy * .62), (cx + r * .95, cy, cz + sy * .62), r * .6, 'dark', vertices=12)
    for x, y, z, sx, sy, sz, foot in rows('box-vent'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.boxc(A, col, 'ventilator housing', (cx, cy, cz + sy * .4), (sz, sx, sy * .8), 'naval')
        kit.boxc(A, col, 'ventilator louvres', (cx, cy, cz + sy * .88), (sz * 1.04, sx * 1.04, sy * .14), 'painted-edge')
    for x, y, z, sx, sy, sz, foot in rows('bitts'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        along = sz >= sx
        n = 2
        kit.boxc(A, col, 'bitts bed', (cx, cy, cz + .04), (sz, sx, .08), 'naval')
        for t in (-1, 1):
            off = (sz / 2 - .25) * t
            px, py = (cx + off, cy) if along else (cx, cy + (sx / 2 - .25) * t)
            kit.cylz(A, col, 'bollard', (px, py, cz + .06), .17, sy * .8, 'naval', 12)
            kit.cylz(A, col, 'bollard cap', (px, py, cz + .06 + sy * .8), .21, .06, 'naval', 12)
    for x, y, z, sx, sy, sz, foot in rows('fairlead'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.boxc(A, col, 'fairlead base', (cx, cy, cz + .08), (sz, sx, .16), 'naval')
        for t in (-1, 1):
            kit.cylz(A, col, 'fairlead roller', (cx + t * sz * .28, cy, cz + .16), .14, sy * .55, 'edge', 10)
    for x, y, z, sx, sy, sz, foot in rows('winch'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.boxc(A, col, 'winch bed', (cx, cy, cz + .1), (sz * .9, sx * .9, .2), 'naval')
        kit.boxc(A, col, 'winch motor', (cx - sz * .25, cy, cz + sy * .45), (sz * .4, sx * .6, sy * .55), 'naval')
        drum_axis = Vector((0, 1, 0)) if sx > sz else Vector((1, 0, 0))
        c = Vector((cx + sz * .15, cy, cz + sy * .55))
        kit.part('rod', A, col, 'winch drum', tuple(c - drum_axis * .45), tuple(c + drum_axis * .45), .3, 'edge', vertices=14)
    for x, y, z, sx, sy, sz, foot in rows('capstan'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.cylz(A, col, 'capstan base', (cx, cy, cz), sx * .5, .12, 'naval', 20)
        kit.cylz(A, col, 'capstan barrel', (cx, cy, cz + .12), sx * .3, sy * .7, 'edge', 20, r2=sx * .26)
        kit.cylz(A, col, 'capstan head', (cx, cy, cz + .12 + sy * .7), sx * .38, sy * .18, 'edge', 20)
    for x, y, z, sx, sy, sz, foot in rows('hatch'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.boxc(A, col, 'hatch coaming', (cx, cy, cz + min(sy, .5) * .5), (sz, sx, min(sy, .5)), 'naval')
        kit.boxc(A, col, 'hatch lid', (cx, cy, cz + min(sy, .5) + .02), (sz + .06, sx + .06, .04), 'roof')
    for x, y, z, sx, sy, sz, foot in rows('reel'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        axis = Vector((1, 0, 0)) if sz > sx else Vector((0, 1, 0))
        c = Vector((cx, cy, cz + sy * .55))
        for t in (-1, 1):
            kit.boxc(A, col, 'reel stand', tuple(c + axis * t * .45 - Vector((0, 0, sy * .27))), (.08, .08, sy * .55) if axis.x else (.08, .08, sy * .55), 'naval')
        kit.part('rod', A, col, 'reel drum', tuple(c - axis * .42), tuple(c + axis * .42), sy * .42, 'edge', vertices=16)
    for x, y, z, sx, sy, sz, foot in rows('locker'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.boxc(A, col, 'locker', (cx, cy, cz + sy / 2), (sz, sx, sy), 'wood' if sy < 1 else 'naval')
    for x, y, z, sx, sy, sz, foot in rows('leadsman-platform'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.boxc(A, col, 'leadsman platform', (cx, cy, cz + .08), (sz, sx, .12), 'naval')
    for x, y, z, sx, sy, sz, foot in rows('lamp'):
        at = seated(x, foot, z, sy, max(sx, sz) / 2)
        if at is None:
            continue
        cx, cy, cz = at
        kit.cylz(A, col, 'lamp', (cx, cy, cz), max(.08, min(sx, sz) * .4), sy, 'naval', 10)
        kit.cylz(A, col, 'lamp lens', (cx, cy, cz + sy * .45), max(.07, min(sx, sz) * .38), sy * .3, 'glass', 10)
    for x, y, z, sx, sy, sz, foot in rows('life-buoy'):
        c = Vector(P(x, y, z))
        n = Vector((0, 1, 0)) if sx < sz else Vector((1, 0, 0))
        r = sy * .5 - .06
        pts = []
        u = n.cross(Vector((0, 0, 1))).normalized()
        for i in range(13):
            a = math.tau * i / 12
            pts.append(tuple(c + u * r * math.cos(a) + Vector((0, 0, r * math.sin(a)))))
        kit.polyline('life-buoys', col, pts, .06, 'white', 6)
    for x, y, z, sx, sy, sz, foot in rows('paravane'):
        a = Vector(P(x, foot + .45, z - sz / 2 + .3))
        b = Vector(P(x, foot + .45, z + sz / 2 - .3))
        kit.part('rod', 'paravanes', col, 'paravane body', tuple(a), tuple(b), .28, 'naval', vertices=12, r2=.16)
        mid = a.lerp(b, .6)
        kit.boxc('paravanes', col, 'paravane fin', tuple(mid), (.9, 1.3, .04), 'naval')
        kit.boxc('paravanes', col, 'paravane chock', (mid.x, mid.y, (P(x, foot, z)[2] + mid.z) / 2), (.5, .5, mid.z - P(x, foot, z)[2]), 'naval')
    for x, y, z, sx, sy, sz, foot in rows('accommodation-ladder'):
        c = Vector(P(x, y, z))
        kit.boxc('accommodation-ladders', col, 'ladder', tuple(c), (sz, .7, .12), 'naval')
        for t in (-1, 1):
            kit.boxc('accommodation-ladders', col, 'ladder stringer', (c.x, c.y + t * .35, c.z + .08), (sz, .06, .16), 'edge')
    for x, y, z, sx, sy, sz, foot in rows('antenna'):
        c = Vector(P(x, foot, z))
        kit.part('rod', 'pagoda-mast', kit.collections['Sensors and masts'], 'antenna mast', tuple(c), tuple(c + Vector((0, 0, sy))), .05, 'black', vertices=6)
        kit.boxc('pagoda-mast', kit.collections['Sensors and masts'], 'antenna spreader', tuple(c + Vector((0, 0, sy * .8))), (.1, sx, .06), 'black')


def ground_tackle(kit, D):
    col = kit.collections['Deck fittings']
    A = 'ground-tackle'
    # Bower anchors housed in their hawse pipes at the bow, the stern anchors, and the sheet anchors amidships.
    for x, y, z, sx, sy, sz, foot in rows('bower-anchor'):
        s = 1 if x > 0 else -1
        c = Vector(P(x, y, z))
        shank_top = c + Vector((0, 0, sy * .38))
        shank_bot = c - Vector((0, 0, sy * .38))
        kit.part('rod', A, col, 'anchor shank', tuple(shank_top), tuple(shank_bot), .13 if sy > 2.5 else .09, 'black', vertices=8)
        for t in (-1, 1):
            kit.part('rod', A, col, 'anchor fluke', tuple(shank_bot), tuple(shank_bot + Vector((t * sz * .35, 0, sy * .22))), .1 if sy > 2.5 else .07, 'black', vertices=6)
        kit.part('rod', A, col, 'hawse lip', tuple(shank_top + Vector((0, -s * .05, .1))), tuple(shank_top + Vector((0, s * .25, .1))), .42 if sy > 2.5 else .3, 'naval', vertices=16)
    for x, y, z, sx, sy, sz, foot in rows('sheet-anchor'):
        c = Vector(P(x, y, z))
        kit.boxc(A, col, 'sheet anchor bed', tuple(c), (sz, .25, sy * .8), 'naval')
        kit.part('rod', A, col, 'sheet anchor shank', tuple(c + Vector((0, 0, sy * .35))), tuple(c - Vector((0, 0, sy * .35))), .1, 'black', vertices=8)
    # Cables from the hawse pipes aft to the capstans on the forecastle (the reference's cable runs).
    capstan = next(r for r in rows('capstan') if r[2] < 0)
    cz = capstan[2]
    for s in (-1, 1):
        start = Vector(P(s * 2.95, 7.47, -104.8))
        pipe = Vector(P(s * 2.4, 7.3, -96.0))
        end = Vector(P(s * .9, capstan[6] + .12, cz - .6))
        for a, b in ((start, pipe), (pipe, end)):
            n = max(2, int((b - a).length / .45))
            for i in range(n):
                p = a.lerp(b, (i + .5) / n)
                d = (b - a).normalized()
                kit.part('rod', A, col, 'cable link', tuple(p - d * .2), tuple(p + d * .2), .09, 'black', vertices=6)
        kit.cylz(A, col, 'navel pipe', (pipe.x, pipe.y, pipe.z - .15), .3, .2, 'naval', 12)
        kit.boxc(A, col, 'cable stopper', tuple(pipe.lerp(end, .3) + Vector((0, 0, .1))), (.8, .45, .25), 'naval')


def underwater(kit, D):
    col = kit.collections['Underwater fittings']
    # Four three-bladed screws (HP datums of cm001/cm032), turning outward, on shafts run forward into the hull.
    for side, kind in [(-1, 'screw-port'), (1, 'screw-starboard')]:
        for x, y, z, sx, sy, sz, foot in rows(kind):
            A = f'screw-{"port" if side < 0 else "starboard"}-{"outer" if abs(x) > 7 else "inner"}'
            hub = Vector(P(x, y, z))
            r = max(sx, sy) / 2
            kit.part('rod', A, col, 'hub', tuple(hub + Vector((sz * .35, 0, 0))), tuple(hub - Vector((sz * .45, 0, 0))), .42, 'bronze', vertices=16, r2=.2)
            for k in range(3):
                a = math.tau * k / 3 + (0 if side > 0 else math.pi / 3)
                n = Vector((0, math.cos(a), math.sin(a)))
                t = Vector((0, -math.sin(a), math.cos(a))) * side
                pts = []
                for u in (0.0, .35, .7, 1.0):
                    rr = .24 + (r - .24) * u
                    chord = .95 * math.sin(math.pi * (.25 + .6 * u)) + .2
                    pts.append((hub + n * rr + t * chord * .5 + Vector((chord * .18, 0, 0)), hub + n * rr - t * chord * .5 - Vector((chord * .18, 0, 0))))
                vv = [tuple(p) for pair in pts for p in pair]
                ff = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(3)]
                ob = kit.mesh(A + '.blade', vv, ff, 'bronze', col, True)
                kit.tag(ob, A)
                ob2 = kit.mesh(A + '.blade back', vv, [tuple(reversed(f)) for f in ff], 'bronze', col, True)
                kit.tag(ob2, A)
            # Shaft forward until it is well inside the loft, with an A-bracket near the screw.
            zin = z
            while zin > z - 40 and loft_half_breadth(D, zin, y) < abs(x) + .5:
                zin -= .5
            a = Vector(P(x, y, z))
            b = Vector(P(x, y + .25, zin - 1.0))
            kit.part('rod', A, col, 'shaft', tuple(a), tuple(b), .26, 'edge', vertices=12)
            kit.part('rod', A, col, 'shaft boss', tuple(a.lerp(b, .08)), tuple(a.lerp(b, .15)), .38, 'antifouling', vertices=14)
            br = a.lerp(b, .11)
            for dx, up in ((-1.2, 1), (1.6, 1)):
                target_y = y + 2.6
                tz = z - sz * .45 - 3.0
                hb = loft_half_breadth(D, tz, target_y)
                top = Vector(P(math.copysign(max(.5, min(hb - .3, abs(x) + dx)), x), target_y, tz))
                kit.beam(A, col, 'shaft bracket', tuple(br), tuple(top), .12, .5, 'antifouling')
    # Twin rudders abaft the inner screws (x = +/-2.3 profile cuts: leading edge 88.2, trailing edge 94.6).
    for s in (-1, 1):
        A = f'rudder-{"port" if s < 0 else "starboard"}'
        x = s * 2.3
        prof = []
        for u in [0, .05, .15, .3, .5, .7, .85, 1]:
            zz = 88.2 + (94.6 - 88.2) * u
            half = .3 * math.sin(math.pi * min(1, u * 1.4 + .08)) * (1 - .55 * u) + .02
            prof.append((zz, half))
        top_y = [loft_keel(D, zz) + .9 for zz, _ in prof]
        bot = [-9.05 + .5 * max(0, u - .75) / .25 for u in [0, .05, .15, .3, .5, .7, .85, 1]]
        vv = []
        for (zz, half), ty, by_ in zip(prof, top_y, bot):
            for yy in (by_, ty):
                for t in (-1, 1):
                    vv.append(P(x + t * half, yy, zz))
        n = len(prof)
        ff = []
        for i in range(n - 1):
            a, b = 4 * i, 4 * (i + 1)
            ff += [(a, b, b + 2, a + 2), (a + 1, a + 3, b + 3, b + 1), (a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3)]
        ff += [(0, 2, 3, 1), (4 * (n - 1), 4 * (n - 1) + 1, 4 * (n - 1) + 3, 4 * (n - 1) + 2)]
        ob = kit.mesh(A + '.blade', vv, ff, 'antifouling', col, True)
        kit.tag(ob, A)
        stock = Vector(P(x, top_y[2], 88.2 + (94.6 - 88.2) * .22))
        kit.part('rod', A, col, 'stock', tuple(stock - Vector((0, 0, .2))), tuple(stock + Vector((0, 0, 1.2))), .22, 'antifouling', vertices=12)
    # Bilge keels at the turn of the bilge over the middle body.
    for s in (-1, 1):
        A = 'bilge-keel-' + ('port' if s < 0 else 'starboard')
        pts = []
        for zz in [-46 + 4 * i for i in range(21)]:
            keel = loft_keel(D, zz)
            yb = keel + 1.1
            hb = loft_half_breadth(D, zz, yb)
            pts.append((zz, hb, yb))
        vv, ff = [], []
        for zz, hb, yb in pts:
            root = Vector(P(s * (hb - .15), yb + .12, zz))
            tip = Vector(P(s * (hb + .55), yb - .55, zz))
            vv += [tuple(root), tuple(tip)]
        for i in range(len(pts) - 1):
            ff.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        ob = kit.mesh(A + '.plate', vv, ff, 'antifouling', col)
        kit.tag(ob, A)
        ob2 = kit.mesh(A + '.plate back', vv, [tuple(reversed(f)) for f in ff], 'antifouling', col)
        kit.tag(ob2, A)


def stem(kit):
    # The gold chrysanthemum crest on the stem head (jm306-309: about 1.1 m across), facing forward.
    col = kit.collections['Hull and decks']
    A = 'chrysanthemum'
    c = Vector(P(0, 7.72, -114.64))
    n = Vector((1, 0, 0))
    kit.part('rod', A, col, 'crest', tuple(c - n * .05), tuple(c + n * .03), .56, 'gold', vertices=16)
    kit.part('rod', A, col, 'crest boss', tuple(c + n * .03), tuple(c + n * .07), .16, 'gold', vertices=12)
    for k in range(16):
        a = math.tau * k / 16
        p = c + n * .03 + Vector((0, .42 * math.cos(a), .42 * math.sin(a)))
        kit.part('rod', A, col, 'petal', tuple(p), tuple(p + n * .03), .09, 'gold', vertices=6)


def build(kit, D):
    gear(kit)
    ground_tackle(kit, D)
    underwater(kit, D)
    stem(kit)

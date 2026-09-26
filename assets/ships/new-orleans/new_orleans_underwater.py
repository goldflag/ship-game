"""New Orleans underwater gear: four screws on their shafts, bossings and brackets, the rudder, the bilge keels and the
propeller guards.

Positions are reference-frame datums read off the approved GameModels3D pasc107 B_Hull model (the screws' part
bounds, profile and plan cuts of the stern) and converted once by `P`; shapes are original approximations at the
measured sizes. No reference geometry is loaded.
"""
import math

import bmesh
from mathutils import Vector

from new_orleans_kit import P, ZS


def V(x, y, z):
    return Vector(P(x, y, z))


def recalc(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def hull_half(kit, zref, y):
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZS)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])

            def w(sec):
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (y - y0) / (y1 - y0))
                return best
            return w(s0) * (1 - t) + w(s1) * t
    return 0.0


def keel_y(kit, zref):
    H = kit.D['hull']
    station = H['length'] / 2 - (zref + ZS)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][0][1] * (1 - t) + s1['points'][0][1] * t
    return -7.0


def screw(kit, col, aid, c):
    kit.part('rod', aid, col, 'hub', c + Vector((.5, 0, 0)), c + Vector((-.45, 0, 0)), .34, 'bronze', r2=.3, vertices=14)
    kit.part('rod', aid, col, 'hub cone', c + Vector((-.45, 0, 0)), c + Vector((-.9, 0, 0)), .3, 'bronze', r2=.06, vertices=14)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        sections = []
        for r, w in ((.28, .6), (.8, .85), (1.3, .8), (1.74, .4)):
            le = (c.x - w * .15, c.y + r * ca - w * sa * .5, c.z + r * sa + w * ca * .5)
            te = (c.x + w * .15, c.y + r * ca + w * sa * .5, c.z + r * sa - w * ca * .5)
            sections.append((le, te))
        vv = []
        for le, te in sections:
            for dx in (-.03, .03):
                vv += [(le[0] + dx, le[1], le[2]), (te[0] + dx, te[1], te[2])]
        ff = []
        for i in range(len(sections) - 1):
            a0, b0 = 4 * i, 4 * (i + 1)
            ff += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, b0 + 2, b0 + 3, a0 + 3), (a0, b0, b0 + 2, a0 + 2), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
        last = 4 * (len(sections) - 1)
        ff += [(0, 2, 3, 1), (last, last + 1, last + 3, last + 2)]
        recalc(kit.tag(kit.mesh(aid + '.blade', vv, ff, 'bronze', col), aid))


def build(D, kit):
    col = kit.collections['Underwater fittings']
    # Screws (cm002/cm033, 3.55 m across): the outer pair abreast the after turret, the inner pair further aft.
    SHAFTS = [(-6.775, -4.5, 60.15, 'outer'), (6.775, -4.5, 60.15, 'outer'), (-3.685, -4.96, 74.53, 'inner'), (3.685, -4.96, 74.53, 'inner')]
    for x, y, z, hub in SHAFTS:
        s = -1 if x < 0 else 1
        aid = f'screw-{"port" if x < 0 else "starboard"}-{hub}'
        c = V(x, y, z)
        screw(kit, col, aid, c)
        if hub == 'inner':
            # The inner shafts leave the hull in long bossings (reference z 54.4 to 63.2) and run aft to a
            # two-armed bracket 2.4 m ahead of the screw.
            start = V(x * .8, -3.75, 50.0)
            kit.part('rod', aid, col, 'shaft', start, c + Vector((.5, 0, 0)), .2, 'bronze', vertices=12)
            boss0, boss1 = V(x * .88, -3.95, 53.8), V(x, -4.35, 63.4)
            kit.part('rod', aid, col, 'bossing', boss0, boss1, .5, 'antifouling', r2=.3, vertices=14)
            kit.part('rod', aid, col, 'bossing tail', boss1, boss1 + (boss1 - boss0).normalized() * 1.2, .3, 'antifouling', r2=.2, vertices=14)
            hubz = 72.0
            h = V(x, -4.9, hubz)
            kit.part('rod', aid, col, 'bracket hub', h + Vector((.5, 0, 0)), h - Vector((.5, 0, 0)), .32, 'antifouling', vertices=12)
            for dx, target in ((-.7, (x * .55, keel_y(kit, hubz))), (.9, (x * 1.12, None))):
                tx = target[0]
                ty = target[1] if target[1] is not None else -2.6
                if target[1] is None:
                    tx = s * (hull_half(kit, hubz, -2.6) - .05)
                kit.beam(aid, col, 'bracket arm', h, V(tx, ty + .3, hubz), .6, .12, 'antifouling', up=(1, 0, 0))
        else:
            # The outer shafts leave the hull just ahead of the screw, on a short bossing and one bracket.
            start = V(x * .85, -4.0, 50.5)
            kit.part('rod', aid, col, 'shaft', start, c + Vector((.5, 0, 0)), .2, 'bronze', vertices=12)
            boss0, boss1 = V(x * .9, -4.1, 51.8), V(x, -4.45, 56.6)
            kit.part('rod', aid, col, 'bossing', boss0, boss1, .45, 'antifouling', r2=.28, vertices=14)
            h = V(x, -4.47, 57.6)
            kit.part('rod', aid, col, 'bracket hub', h + Vector((.45, 0, 0)), h - Vector((.45, 0, 0)), .3, 'antifouling', vertices=12)
            kit.beam(aid, col, 'bracket arm', h, V(s * (hull_half(kit, 57.6, -2.4) - .05), -2.1, 57.6), .55, .12, 'antifouling', up=(1, 0, 0))
            kit.beam(aid, col, 'bracket arm', h, V(x * .7, -3.2, 57.6), .55, .12, 'antifouling', up=(1, 0, 0))
    # Balanced rudder on the centreline behind the inner screws (reference z 75.7 to 81.9, foot at -6.8 m).
    aid = 'rudder'

    def foil(y, z0, z1, t, n=12):
        up = [(z0 + (z1 - z0) * i / n, t * 2.6 * math.sqrt(max(0, i / n)) * (1 - i / n) ** 1.1) for i in range(n + 1)]
        right = [(w, y, z) for z, w in up]
        left = [(-w, y, z) for z, w in reversed(up[1:-1])]
        return [P(*p) for p in right + left]
    top = max(keel_y(kit, 78.8) + .15, -2.95)
    kit.loft(aid, col, 'rudder blade', [foil(-6.8, 75.75, 81.85, .25), foil(top, 75.7, 81.9, .27)], 'antifouling', True, True, False)
    kit.part('rod', aid, col, 'rudder stock', V(0, top - .3, 77.1), V(0, top + 1.2, 77.1), .24, 'antifouling', vertices=12)
    # Bilge keels at the turn of the bilge (reference z -25 to +35), plates standing out and down from the loft.
    for s in (-1, 1):
        zs = [-25.0 + (35.0 + 25.0) * i / 12 for i in range(13)]
        for z0, z1 in zip(zs, zs[1:]):
            ends = []
            for z in (z0, z1):
                ends.append(V(s * (hull_half(kit, z, -6.25) - .05), -6.25, z))
            out = Vector((0, -s * .72, -.72)).normalized()
            taper0 = 1.0 if z0 > -20 and z1 < 30 else .55
            mid = [e + out * .42 * taper0 for e in ends]
            kit.beam('bilge-keels', col, 'bilge keel', mid[0], mid[1], .05, .85 * taper0, 'antifouling', tuple(out))
    # Propeller guards abreast the outer screws (reference y 1.6 to 1.8 m, out to 9.37 m, z 57 to 61).
    for s in (-1, 1):
        root0 = V(s * (hull_half(kit, 57.0, 1.7) - .05), 1.69, 57.0)
        root1 = V(s * (hull_half(kit, 61.3, 1.7) - .05), 1.69, 61.3)
        o0, o1 = V(s * 9.3, 1.69, 58.4), V(s * 9.3, 1.69, 60.2)
        for a, b in ((root0, o0), (o0, o1), (o1, root1)):
            kit.part('rod', 'propeller-guards', col, 'guard rail', a, b, .1, 'naval', vertices=10)
        kit.boxc('propeller-guards', col, 'guard plate', (o0 + o1) / 2 + Vector((0, s * -.55, 0)), ((o1 - o0).length + .2, 1.1, .05), 'naval')

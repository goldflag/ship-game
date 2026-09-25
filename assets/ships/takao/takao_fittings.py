"""Takao fittings: torpedo rooms and mounts, masts and the aircraft crane, catapults, directors,
rangefinders, radars, searchlights, boats, deck gear and underwater gear.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the
approved GameModels3D pjsc708 model and converted once by `P`; shapes are original
approximations of the reference's fittings at their measured sizes. No reference geometry is loaded.
"""
import math
import bmesh
from mathutils import Vector, Matrix
from takao_kit import P, R, ZC

# Measured blocks drawn here instead: the torpedo rooms' open sides replace their prisms.
CLAIMED_STRUCTURES = {'torpedo-room-port', 'torpedo-room-starboard'}


def V(x, y, z):
    return Vector(P(x, y, z))


def local(ob, pivot):
    """Parent a freshly built object to an unrotated pivot, keeping its authored place."""
    ob.location = Vector(ob.location) - Vector(pivot.location)
    ob.parent = pivot
    return ob


def taper(kit, aid, col, label, a, b, r0, r1, material='naval', n=16):
    return kit.part('rod', aid, col, label, V(*a), V(*b), r0, material, r2=r1, vertices=n)


def hull_half(kit, zref, y):
    """Loft half-breadth at a reference z and height (from the compiled sections)."""
    H = kit.D['hull']
    station = H['length'] / 2 - (zref - ZC)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])

            def w(sec):
                best = 0
                for (w0, y0), (w1, y1) in zip(sec['points'], sec['points'][1:]):
                    if min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-9:
                        best = max(best, w0 + (w1 - w0) * (y - y0) / (y1 - y0))
                return best if best else sec['points'][-1][0]
            return w(s0) * (1 - t) + w(s1) * t
    return 0.0


def deck(kit, zref):
    H = kit.D['hull']
    station = H['length'] / 2 - (zref - ZC)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][-1][1] * (1 - t) + s1['points'][-1][1] * t
    return 3.83


# ---------------------------------------------------------------- torpedo rooms and mounts
OPENINGS = [(-18.05, -10.45, 4.28, 5.48), (-4.85, .85, 4.3, 5.52), (2.45, 10.0, 4.18, 5.45)]   # ref z0, z1, y0, y1 (starboard, mirrored)


def torpedo_rooms(D, kit):
    col = kit.collections['Superstructure']
    aid = 'torpedo-rooms'
    z0, z1 = -20.3, 15.8
    for sign in (-1, 1):
        # Side wall flush with the hull, from the weather deck to the shelter deck, with the three
        # rounded firing openings the tubes train through.
        n = 72
        zs = [z0 + (z1 - z0) * i / n for i in range(n + 1)]
        outer = [(sign * hull_half(kit, z, 3.83) * .999, z) for z in zs]
        vv, ff = [], []
        ys = [3.83, 5.96]
        for (x, z) in outer:
            for y in ys:
                vv.append(P(x, y, z))
            for y in ys:
                vv.append(P(x - sign * .1, y, z))
        for i in range(n):
            a, b = 4 * i, 4 * (i + 1)
            ff += [(a, b, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2), (a, a + 2, b + 2, b), (a + 1, b + 1, b + 3, a + 3)]
        ff += [(0, 1, 3, 2), (4 * n, 4 * n + 2, 4 * n + 3, 4 * n + 1)]
        wall = kit.tag(kit.mesh(f'Torpedo room wall {sign}', vv, ff, 'naval', col), aid)
        bm = bmesh.new()
        bm.from_mesh(wall.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(wall.data)
        bm.free()
        for (oz0, oz1, oy0, oy1) in OPENINGS:
            cut = rounded_cutter(kit, sign, oz0, oz1, oy0, oy1)
            mod = wall.modifiers.new('opening', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.object = cut
            mod.solver = 'EXACT'
            import bpy
            bpy.context.view_layer.objects.active = wall
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(cut, do_unlink=True)
            # A rolled frame round the opening.
            ring = rounded_outline(oz0, oz1, oy0, oy1, 28)
            pts = [V(sign * (hull_half(kit, z, 3.83) + .02), y, z) for z, y in ring]
            for p, q in zip(pts, pts[1:] + pts[:1]):
                kit.member(aid, col, p, q, .05, 'naval', 6)
        # Floor of the room above the weather deck and the inner casing wall's plating.
        kit.prism(aid, col, 'room floor', [P(sign * 3.55, 0, z0)[:2], P(sign * 9.7, 0, z0)[:2], P(sign * 9.7, 0, z1)[:2], P(sign * 3.55, 0, z1)[:2]], 3.83, 4.04, 'naval', 'roof')
    # Launcher rails across the room floor and the reserve torpedoes on their bogies.
    for sign in (-1, 1):
        for x in (6.1, 6.85, 7.6, 8.35, 9.1):
            kit.member(aid, col, V(sign * x, 4.07, -19.5), V(sign * x, 4.07, 14.8), .035, 'edge', 4)
        for k in range(4):
            x = sign * (6.37 + .75 * k)
            kit.part('rod', aid, col, 'reserve torpedo', V(x, 4.63, -8.54), V(x, 4.63, .46), .305, 'dark', vertices=12)
            for zz in (-7.2, -4.0, -.8):
                kit.boxc(aid, col, 'torpedo bogie', V(x, 4.3, zz), (.5, .6, .45), 'edge')


def rounded_outline(z0, z1, y0, y1, n):
    r = min((y1 - y0) / 2, (z1 - z0) / 2)
    pts = []
    corners = [(z1 - r, y1 - r, 0), (z0 + r, y1 - r, 90), (z0 + r, y0 + r, 180), (z1 - r, y0 + r, 270)]
    for cz, cy, a0 in corners:
        for k in range(n // 4 + 1):
            a = math.radians(a0 + 90 * k / (n // 4))
            pts.append((cz + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def rounded_cutter(kit, sign, z0, z1, y0, y1):
    ring = rounded_outline(z0, z1, y0, y1, 28)
    inner, outer = 8.9, 11.2
    vv = [P(sign * x, y, z) for x in (inner, outer) for z, y in ring]
    n = len(ring)
    ff = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    ob = kit.mesh('opening cutter', vv, ff, 'naval', kit.collections['Superstructure'])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def torpedo_mounts(D, kit):
    col = kit.collections['Torpedoes']
    for launcher in D['torpedoLaunchers']:
        lid = launcher['id']
        x, y, z = R(launcher['position'])
        floor = kit.below(x, y, z - .05)
        kit.cylz(lid, col, 'barbette', (x, y, floor - .01), 1.2, z - floor + .02, 'naval', 32)
        pivot = kit.empty(lid + '.yaw', (x, y, z), assembly=lid, col=col)
        local(kit.cylz(lid, col, 'turntable', (x, y, z), 1.16, .14, 'edge', 32), pivot)
        local(kit.boxc(lid, col, 'training platform', (x - 1.0, y, z + .22), (5.6, 3.4, .12), 'roof'), pivot)
        local(kit.boxc(lid, col, 'training seat', (x - 3.6, y + 1.9 * (1 if y > 0 else -1), z + .7), (.5, .5, .9), 'edge'), pivot)
        for xx in (-3.2, -.6, 1.9):
            local(kit.boxc(lid, col, 'tube saddle', (x + xx, y, z + .3), (.16, 3.25, .26), 'edge'), pivot)
        for tube in [t for t in D['torpedoTubes'] if t['launcherId'] == lid]:
            mx, my, mz = R(tube['position'])
            muzzle = Vector((mx, my, mz))
            breech = muzzle - Vector((8.4, 0, 0))
            local(kit.part('rod', lid, col, '610 mm tube', breech, muzzle, .34, 'naval', vertices=20), pivot)
            local(kit.part('rod', lid, col, 'tube mouth', muzzle - Vector((.03, 0, 0)), muzzle + Vector((.005, 0, 0)), .29, 'dark', vertices=20), pivot)
            local(kit.part('rod', lid, col, 'breech door', breech - Vector((.14, 0, 0)), breech + Vector((.1, 0, 0)), .38, 'edge', vertices=20), pivot)
            for xx in (-7.0, -4.7, -2.4, -.45):
                c = muzzle + Vector((xx, 0, 0))
                local(kit.part('rod', lid, col, 'tube band', c - Vector((.05, 0, 0)), c + Vector((.05, 0, 0)), .365, 'edge', vertices=20), pivot)
            kit.empty(tube['id'] + '.muzzle', tuple(muzzle - Vector(pivot.location)), pivot, lid, col)


# ---------------------------------------------------------------- masts and crane
def foremast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    # Tripod: the raked main leg from the bridge top and two side legs from the shelter deck.
    taper(kit, aid, col, 'main leg', (0, 8.68, -17.17), (0, 25.1, -13.45), .42, .28)
    for s in (-1, 1):
        taper(kit, aid, col, 'side leg', (s * 4.57, 6.1, -11.69), (s * .25, 25.0, -13.8), .5, .3)
        taper(kit, aid, col, 'leg foot', (s * 4.62, 6.12, -11.66), (s * 4.55, 6.5, -11.72), .7, .55)
        # Yards rising outboard from the masthead, with footropes.
        taper(kit, aid, col, 'yard', (s * .1, 24.65, -13.7), (s * 7.34, 26.98, -13.7), .1, .06, 'naval', 10)
        kit.wire(aid, col, V(s * .6, 24.5, -13.55), V(s * 7.0, 26.6, -13.55), .012, False)
        # Diagonal braces between the side legs and the main leg at the bridge-top level.
        kit.member(aid, col, V(s * 3.8, 11.3, -11.57), V(s * 1.25, 13.92, -11.56), .07)
        kit.member(aid, col, V(s * 3.83, 11.42, -12.21), V(s * 1.25, 13.91, -12.21), .07)
        kit.member(aid, col, V(s * 3.72, 6.05, -13.69), V(s * 3.63, 10.02, -12.14), .1)
        kit.member(aid, col, V(s * 3.05, 6.05, -10.87), V(s * 3.62, 10.0, -12.17), .1)
    # Masthead platform and the Type 21 stand.
    kit.boxc(aid, col, 'masthead platform', V(0, 25.1, -13.37), (2.33, 1.8, .08), 'roof')
    kit.part('rod', aid, col, 'stand bracket', V(0, 24.19, -11.75), V(0, 24.19, -13.81), .12, 'naval', vertices=10)
    kit.boxc(aid, col, 'lookout platform', V(0, 22.05, -13.8), (1.0, 1.7, .08), 'roof')
    for yy, z0, z1, w in ((15.72, -15.63, -12.92, 2.1), (16.28, -15.54, -13.02, 2.0), (18.33, -15.57, -13.42, 1.5), (18.86, -15.49, -13.48, 1.4)):
        for s in (-1, 1):
            kit.boxc(aid, col, 'mast platform', V(s * (.15 + w / 2), yy, (z0 + z1) / 2), (z1 - z0, w, .07), 'roof')
    kit.boxc(aid, col, 'radar office', V(0, 19.35, -14.15), (1.8, 2.1, 2.05), 'naval')
    kit.ladder(aid, col, V(0, 9.2, -16.75), V(0, 24.7, -13.28), (0, 1, 0), .42)


def mainmast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'mainmast'
    kit.part('rod', aid, col, 'main pole', V(0, 3.76, 42.06), V(0, 24.0, 42.08), .34, 'naval', r2=.3, vertices=16)
    for s in (-1, 1):
        taper(kit, aid, col, 'side leg', (s * 3.2, 3.76, 45.0), (s * .12, 22.6, 42.4), .2, .17)
        kit.cylz(aid, col, 'leg shoe', V(s * 3.2, 3.8, 45.0), .32, .25, 'naval', 12)
        taper(kit, aid, col, 'yard', (0, 26.14, 43.34), (s * 4.17, 26.15, 44.99), .07, .045, 'naval', 8)
        # The crane's heel frame round the pole.
        kit.member(aid, col, V(s * 2.59, 6.34, 44.23), V(s * .39, 8.18, 42.12), .085)
        kit.member(aid, col, V(s * .42, 6.22, 42.15), V(s * 2.52, 8.29, 44.16), .085)
        kit.member(aid, col, V(s * 2.38, 8.28, 44.04), V(s * .5, 10.54, 42.11), .08)
        kit.member(aid, col, V(s * .43, 8.27, 42.15), V(s * 2.02, 10.56, 43.79), .08)
    kit.part('rod', aid, col, 'topmast', V(0, 22.4, 43.4), V(0, 33.08, 43.4), .15, 'naval', r2=.08, vertices=12)
    kit.part('rod', aid, col, 'masthead box', V(0, 22.57, 42.72), V(0, 25.87, 42.72), .45, 'naval', vertices=12)
    kit.part('rod', aid, col, 'gaff', V(0, 28.6, 43.57), V(0, 31.42, 46.66), .07, 'naval', r2=.045, vertices=8)
    kit.part('rod', aid, col, 'topmast yard', V(-3.3, 30.9, 43.3), V(3.3, 30.9, 43.3), .07, 'naval', r2=.07, vertices=8)
    for yy, hw, z0, z1 in ((10.68, 2.17, 41.2, 44.12), (13.4, 1.71, 42.08, 45.14), (17.1, .98, 42.12, 43.88), (22.57, 2.4, 41.62, 44.09)):
        kit.boxc(aid, col, 'mast platform', V(0, yy, (z0 + z1) / 2), (z1 - z0, 2 * hw, .1), 'roof')
    kit.boxc(aid, col, 'crane post', V(0, 8.33, 44.35), (.75, 1.0, 4.6), 'naval')
    kit.ladder(aid, col, V(-.33, 11.49, 41.9), V(-.33, 22.5, 41.9), (1, 0, 0), .18)
    # Aircraft crane: a lattice jib from its heel on the mainmast forward over the catapults.
    heel, head = V(0, 11.1, 41.7), V(0, 16.35, 23.1)
    kit.lattice('aircraft-crane', col, heel, head, .9, .9, 16, .07, .04)
    kit.member('aircraft-crane', col, V(0, 11.0, 42.0), V(0, 13.6, 42.2), .12)
    kit.part('rod', 'aircraft-crane', col, 'jib head sheave', head + Vector((0, -.3, -.2)), head + Vector((0, .3, -.2)), .28, 'black', vertices=12)
    kit.wire('aircraft-crane', col, head + Vector((0, 0, -.3)), head + Vector((0, 0, -3.2)), .015, False)
    kit.part('rod', 'aircraft-crane', col, 'hook', head + Vector((0, 0, -3.2)), head + Vector((0, 0, -3.6)), .08, 'edge', vertices=8)
    kit.wire('aircraft-crane', col, V(0, 23.0, 42.5), head + Vector((0, 0, .2)), .02, False)


# ---------------------------------------------------------------- aviation
def catapults(D, kit):
    col = kit.collections['Boats and aviation']
    for s in (-1, 1):
        aid = 'catapult-' + ('port' if s < 0 else 'starboard')
        px, py, pz = 9.831 * s, 5.672, 26.172
        base = kit.below(*V(px, py, pz)[:2], py + 2)
        kit.cylz(aid, col, 'turntable pedestal', V(px, 0, pz)[:2] + (base,), 1.25, py + .45 - base, 'naval', 28)
        kit.cylz(aid, col, 'turntable', V(px, py + .45, pz), 1.45, .18, 'edge', 28)
        # Kure Type 2 powder catapult: a 19.8 m lattice girder trained forward on its turntable
        # (reference 14.6 to 34.5 m aft of the reference origin), the launch carriage at the
        # aircraft's start datum.
        a, b = V(px, 6.95, 34.3), V(px, 7.2, 14.8)
        kit.lattice(aid, col, a, b, 1.25, 1.05, 16, .07, .04)
        kit.boxc(aid, col, 'rail deck', (a + b) / 2 + Vector((0, 0, .57)), ((a - b).length, .85, .08), 'edge')
        for t in (-.34, .34):
            kit.member(aid, col, a + Vector((0, t, .64)), b + Vector((0, t, .64)), .05, 'edge', 6)
        kit.boxc(aid, col, 'carriage', V(px, 7.85, 28.2), (1.7, 1.25, .35), 'edge')
        kit.boxc(aid, col, 'breech housing', V(px, 7.35, 33.6), (1.6, 1.4, 1.05), 'naval')
        for zz in (22.0, 30.2):
            kit.member(aid, col, V(px, py + .6, pz), V(px, 6.55, zz), .16)


# ---------------------------------------------------------------- fire control and sensors
def directors(D, kit):
    col = kit.collections['Sensors and masts']
    for did, (x, y, z), face, size in [('main-director', (0, 21.059, -23.104), 0, (3.1, 1.62, 3.15)), ('after-director', (0, 12.504, 14.345), 180, (3.1, 1.62, 3.15))]:
        bx, by, bz = P(x, y, z)
        pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
        s = 1 if face == 0 else -1
        local(kit.cylz(did, col, 'director base', (bx, by, bz), 1.1, .35, 'naval', 28), pivot)
        local(kit.boxc(did, col, 'director hood', (bx, by, bz + .95), (2.6, 2.9, 1.2), 'naval'), pivot)
        local(kit.boxc(did, col, 'director roof', (bx, by, bz + 1.6), (2.2, 2.5, .12), 'roof'), pivot)
        for side in (-1, 1):
            local(kit.part('rod', did, col, 'sight port', (bx + s * 1.25, by + side * .8, bz + 1.1), (bx + s * 1.36, by + side * .8, bz + 1.1), .14, 'glass', vertices=12), pivot)
            local(kit.part('rod', did, col, 'sight hood', (bx + s * 1.15, by + side * .8, bz + 1.1), (bx + s * 1.34, by + side * .8, bz + 1.1), .2, 'naval', vertices=12), pivot)
    # Type 91 high-angle directors on the bridge wings and Type 95 25 mm directors abreast the funnels.
    for s in (-1, 1):
        side = 'port' if s < 0 else 'starboard'
        for aid, (x, y, z), (w, h, l) in [(f'ha-director-{side}', (s * 6.057, 12.707, -22.104), (2.38, 1.75, 2.37)),
                                          (f'aa-director-{side}', (s * 3.621, 11.169, -.79), (2.15, 2.13, 2.13))]:
            c = V(x, y, z)
            floor = kit.below(c.x, c.y, c.z + .2, c.z)
            if c.z - floor > .02:
                kit.cylz(aid, col, 'director pedestal', Vector((c.x, c.y, floor - .01)), w * .3, c.z - floor + .02, 'naval', 16)
            kit.cylz(aid, col, 'director base', c, w * .38, .3, 'naval', 20)
            kit.cylz(aid, col, 'director body', c + Vector((0, 0, .3)), w * .45, h - .5, 'naval', 20)
            kit.boxc(aid, col, 'optics', c + Vector((0, 0, h - .1)), (.7, w, .35), 'naval')
            for t in (-1, 1):
                kit.part('rod', aid, col, 'lens', c + Vector((.2, t * w / 2, h - .1)), c + Vector((.2, t * (w / 2 + .12), h - .1)), .12, 'glass', vertices=10)


def rangefinders(D, kit):
    col = kit.collections['Sensors and masts']
    # 6 m duplex rangefinder over the bridge top (HP_JF_3), trained with the tower.
    aid = 'rangefinder-6m'
    c = V(0, 22.537, -18.917)
    kit.cylz(aid, col, 'pedestal', c, .55, .55, 'naval', 20)
    kit.part('rod', aid, col, 'rangefinder tube', c + Vector((0, -3.2, 1.0)), c + Vector((0, 3.2, 1.0)), .32, 'naval', vertices=16)
    kit.boxc(aid, col, 'operator house', c + Vector((-.1, 0, .9)), (1.9, 2.0, .9), 'naval')
    for t in (-1, 1):
        kit.boxc(aid, col, 'end hood', c + Vector((0, t * 3.1, 1.0)), (.7, .45, .7), 'naval')
    # 4.5 m rangefinders in their hoods on the tower tops (HP_JF_4/5), and 1.5 m sets on the compass bridge.
    for s in (-1, 1):
        aid = 'rangefinder-4m5-' + ('port' if s < 0 else 'starboard')
        c = V(s * 6.054, 14.028, -15.462)
        kit.cylz(aid, col, 'hood base', c, 1.0, .35, 'naval', 20)
        kit.boxc(aid, col, 'rangefinder hood', c + Vector((0, 0, .9)), (4.6, 1.5, 1.1), 'naval')
        for t in (-1, 1):
            kit.boxc(aid, col, 'end hood', c + Vector((t * 2.2, 0, .9)), (.45, 1.9, .8), 'naval')
        aid = 'rangefinder-1m5-' + ('port' if s < 0 else 'starboard')
        c = V(s * 2.799, 14.385, -29.944)
        floor = kit.below(c.x, c.y, c.z + .2, c.z)
        kit.cylz(aid, col, 'pillar', Vector((c.x, c.y, floor - .01)), .12, c.z + .68 - floor, 'naval', 10)
        kit.part('rod', aid, col, 'rangefinder', c + Vector((0, -.8, .75)), c + Vector((0, .8, .75)), .1, 'naval', vertices=10)


def radars(D, kit):
    col = kit.collections['Sensors and masts']
    # Type 21 bedspring aerial on its stand at the foremast head (HP_JRS_3), trained by the rig.
    rid = 'type21-radar'
    bx, by, bz = P(0, 25.094, -13.704)
    pivot = kit.empty(rid + '.yaw', (bx, by, bz), assembly=rid, col=col)
    local(kit.cylz(rid, col, 'turntable', (bx, by, bz), .35, .22, 'edge', 16), pivot)
    local(kit.boxc(rid, col, 'stand', (bx, by, bz + .6), (.3, .3, .9), 'naval'), pivot)
    frame = []
    w, h, zc = 2.9, 2.3, bz + 1.1 + 1.15
    for i in range(6):
        yy = -w / 2 + w * i / 5
        local(kit.part('rod', rid, col, 'aerial bar', (bx - .1, by + yy, zc - h / 2), (bx - .1, by + yy, zc + h / 2), .025, 'edge', vertices=5), pivot)
    for j in range(5):
        zz = zc - h / 2 + h * j / 4
        local(kit.part('rod', rid, col, 'aerial bar', (bx - .1, by - w / 2, zz), (bx - .1, by + w / 2, zz), .025, 'edge', vertices=5), pivot)
    local(kit.boxc(rid, col, 'reflector screen', (bx + .12, by, zc), (.04, w, h), 'dark'), pivot)
    # Type 22 horn pairs on the bridge top (HP_JRS_1/2) and the Type 13 ladder aerial on the foremast (HP_JRS_4).
    for s in (-1, 1):
        aid = 'type22-radar-' + ('port' if s < 0 else 'starboard')
        c = V(s * 2.226, 20.875, -17.983)
        kit.boxc(aid, col, 'radar office', c + Vector((0, 0, .15)), (1.4, .8, .3), 'naval')
        for t in (-1, 1):
            a = c + Vector((.1, t * .22, .75))
            kit.part('rod', aid, col, 'horn', a + Vector((-.5, 0, 0)), a + Vector((.6, 0, 0)), .12, 'naval', r2=.42, vertices=12)
    aid = 'type13-radar'
    base = V(0, 19.494, -11.85)
    for t in (-1, 1):
        kit.part('rod', aid, col, 'aerial rail', base + Vector((0, t * .5, 0)), base + Vector((0, t * .5, 4.6)), .03, 'edge', vertices=6)
    for k in range(9):
        kit.part('rod', aid, col, 'aerial element', base + Vector((0, -.95, .3 + k * .5)), base + Vector((0, .95, .3 + k * .5)), .02, 'edge', vertices=5)
    # Two brackets from the aerial's frame back to the foremast's main leg.
    for k, yy in enumerate((20.4, 23.4)):
        leg_z = -17.17 + (yy - 8.68) / (25.1 - 8.68) * (17.17 - 13.45)
        kit.member(aid, col, V(0, yy, -11.85), V(0, yy, leg_z + .05), .06)


def searchlights(D, kit):
    col = kit.collections['Sensors and masts']
    for i, (x, y, z) in enumerate([(7.13, 10.2, -.85), (-7.13, 10.2, -.92), (3.22, 12.2, 10.43), (-3.22, 12.2, 10.36)], 1):
        aid = f'searchlight-{i}'
        c = V(x, y - .85, z)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        kit.cylz(aid, col, 'pedestal', Vector((c.x, c.y, floor)), .28, c.z - floor + .55, 'naval', 14)
        kit.boxc(aid, col, 'yoke', c + Vector((0, 0, .65)), (.4, 1.3, .2), 'naval')
        kit.part('rod', aid, col, 'barrel', c + Vector((-.4, 0, 1.05)), c + Vector((.45, 0, 1.05)), .62, 'naval', vertices=20)
        kit.part('rod', aid, col, 'lens', c + Vector((.45, 0, 1.05)), c + Vector((.5, 0, 1.05)), .56, 'glass', vertices=20)


# ---------------------------------------------------------------- boats
def boat(kit, aid, col, c, length, beam, depth, heading=0.0, covered=False):
    """Original lofted boat hull on its keel point c (authoring frame), bow toward +X."""
    rings = []
    n = 13
    for i in range(n):
        t = i / (n - 1)
        x = (t - .5) * length
        fore = max(0, (t - .6) / .4)
        aft = max(0, (.25 - t) / .25)
        half = beam / 2 * (1 - fore ** 1.7) * (1 - .35 * aft ** 2) + .02
        top = depth * (1 + .25 * fore ** 2)
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append((x, -half * math.cos(a), top - depth * .85 * math.sin(a) ** 1.4 * (1 - .4 * fore) - depth * .15))
        rings.append(ring)
    rot = Matrix.Rotation(heading, 3, 'Z')
    rings = [[tuple(Vector(c) + rot @ Vector(p)) for p in ring] for ring in rings]
    hull = kit.loft(aid, col, 'boat hull', rings, 'white', True, True, True)
    if covered:
        kit.boxc(aid, col, 'cabin', Vector(c) + rot @ Vector((-length * .12, 0, depth * .85 + .42)), (length * .45, beam * .6, .9), 'white', heading)
    else:
        for k in range(4):
            kit.boxc(aid, col, 'thwart', Vector(c) + rot @ Vector(((k - 1.5) * length * .2, 0, depth * .6)), (.2, beam * .85, .06), 'wood', heading)
    return hull


def boats(D, kit):
    col = kit.collections['Boats and aviation']
    # 9 m cutters in chocks on the shelter deck abreast the forward funnel, under their davits.
    for s in (-1, 1):
        aid = 'cutter-' + ('port' if s < 0 else 'starboard')
        keel = V(s * 7.29, 6.27, -17.75)
        boat(kit, aid, col, keel, 9.1, 2.35, 1.5)
        for dz in (-2.6, 2.6):
            chock = V(s * 7.29, 6.16, -17.75 + dz)
            kit.boxc(aid, col, 'chock', chock + Vector((0, 0, .06)), (.3, 1.4, .12), 'edge')
            top = V(s * 7.29, 9.55, -17.75 + dz * 1.38)
            foot = V(s * 8.9, 6.16, -17.75 + dz * 1.38)
            kit.part('rod', aid, col, 'davit', foot, top, .11, 'naval', vertices=10)
            kit.part('rod', aid, col, 'davit head', top, top + Vector((0, s * -.6, -.3)), .09, 'naval', vertices=8)
            kit.wire(aid, col, top + Vector((0, s * -.6, -.35)), V(s * 7.29, 7.6, -17.75 + dz * 1.2), .015, False)
    # Motor boats and the 12 m launch stowed in cradles on the deck abaft the shelter deck.
    for s in (-1, 1):
        aid = 'motor-boat-' + ('port' if s < 0 else 'starboard')
        keel = V(s * 3.5, 4.1, 23.98)
        boat(kit, aid, col, keel, 11.2, 3.0, 1.9, 0, True)
        for dz in (-3.5, 0, 3.5):
            kit.boxc(aid, col, 'cradle', V(s * 3.5, 3.97, 23.98 + dz), (.3, 1.6, .3), 'edge')
    aid = 'motor-launch'
    boat(kit, aid, col, V(0, 4.1, 22.66), 12.2, 2.8, 1.7, 0, False)
    for dz in (-4, 0, 4):
        kit.boxc(aid, col, 'cradle', V(0, 3.97, 22.66 + dz), (.3, 1.4, .3), 'edge')


# ---------------------------------------------------------------- lattice pedestals
# Tapered four-legged lattice towers from the shelter deck (reference components at these datums):
# the Type 95 directors' towers abreast the forward funnel, the searchlights' abaft the after
# funnel and the 25 mm twins' between them.
TOWERS = [(3.645, -.81, 6.13, 11.21), (3.195, 10.395, 6.13, 11.21), (4.8, 6.37, 6.04, 10.51)]


def towers(D, kit):
    col = kit.collections['Superstructure']
    for x, z, y0, y1 in TOWERS:
        for s in (-1, 1):
            aid = f'lattice-tower-{"port" if s < 0 else "starboard"}-{z:+.0f}'
            c = V(s * x, 0, z)
            floor = kit.below(c.x, c.y, y0 + .3, y0)
            top = y1 - .08
            b, t = 1.05, .62
            corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
            legs = [(Vector((c.x + i * b, c.y + j * b, floor)), Vector((c.x + i * t, c.y + j * t, top))) for i, j in corners]
            for lo, hi in legs:
                kit.member(aid, col, lo, hi, .075, 'naval', 8)
            levels = 4
            for k in range(levels + 1):
                f = k / levels
                ring = [lo.lerp(hi, f) for lo, hi in legs]
                for p, q in zip(ring, ring[1:] + ring[:1]):
                    kit.member(aid, col, p, q, .045, 'naval', 6)
                if k < levels:
                    nxt = [lo.lerp(hi, (k + 1) / levels) for lo, hi in legs]
                    for i in range(4):
                        kit.member(aid, col, ring[i], nxt[(i + 1) % 4], .035, 'naval', 5)
            kit.boxc(aid, col, 'foot plate', Vector((c.x, c.y, floor + .025)), (2.35, 2.35, .06), 'edge')


# ---------------------------------------------------------------- deck gear
def deck_gear(D, kit):
    col = kit.collections['Deck fittings']
    aid = 'ground-tackle'
    # Bow anchors housed in their hawse pipes, cables led to the windlasses; stern anchors.
    for s in (-1, 1):
        # Stockless anchor housed at the hawse outlet: shank up into the pipe, crown and flukes
        # lying against the flared bow (reference 1.7 m long, 1.0 m high).
        for zz, yy, size in ((-92.7, 5.05, (.9, .32, .3)), (-92.25, 4.55, (1.35, .5, .22))):
            hb = hull_half(kit, zz, yy)
            kit.boxc(aid, col, 'anchor', V(s * (hb + size[2] / 2 - .02), yy, zz), (size[0], size[2], size[1]), 'black')
        hb = hull_half(kit, -92.25, 4.3)
        kit.boxc(aid, col, 'anchor fluke', V(s * (hb + .08), 4.3, -91.9), (.5, .16, .45), 'black')
        kit.part('rod', aid, col, 'hawse pipe', V(s * 1.9, 6.4, -97.6), V(s * 1.45, 5.3, -92.8), .3, 'naval', vertices=14)
        for i in range(10):
            p = V(s * (1.45 - .03 * i), 5.28 - .02 * i + .02, -92.8 + i * 1.3)
            kit.part('rod', aid, col, 'cable', p, p + Vector((-.9, 0, 0)), .06, 'edge', vertices=6)
        kit.cylz(aid, col, 'windlass', V(s * 1.21, 5.35, -80.22), .56, .45, 'naval', 16)
        kit.cylz(aid, col, 'windlass cap', V(s * 1.21, 5.8, -80.22), .66, .11, 'edge', 16)
        st = V(s * 2.73, 1.81, 98.85)
        kit.boxc(aid, col, 'stern anchor', st + Vector((0, s * .25, 0)), (.3, .3, 1.3), 'black')
    # Raised cable deck under the windlasses (reference 4.14 m wide, 78.7 to 87.1 m forward).
    c = V(0, 0, -82.86)
    floor = kit.below(c.x, c.y, 5.6, 4.6)
    kit.boxc(aid, col, 'cable deck', Vector((c.x, c.y, (floor + 5.59) / 2 - .05)), (8.39, 4.14, 5.59 - floor + .1), 'edge')
    # Bollards, fairleads, winches and the after capstan at the reference positions.
    for x, y, z in [(3.58, 5.29, -84.22), (-3.58, 5.29, -84.22), (5.21, 4.41, -67.56), (-5.21, 4.41, -67.56), (8.8, 4.05, 40.26), (-8.79, 4.04, 40.26)]:
        c = V(x, y - .45, z)
        kit.boxc('bollards', col, 'bollard base', c, (2.2, .75, .15), 'edge')
        for d in (-.65, .65):
            kit.cylz('bollards', col, 'bitt', c + Vector((d, 0, 0)), .22, .7, 'naval', 12)
    for x, y, z in [(5.09, 4.74, -77.48), (-5.09, 4.74, -77.48), (9.04, 3.88, 44.95), (-9.04, 3.88, 44.95), (-4.05, 5.63, -89.07), (4.06, 5.64, -89.07)]:
        c = V(x, y - .3, z)
        kit.boxc('fairleads', col, 'fairlead', c, (1.0, .45, .3), 'edge')
        for d in (-.3, .3):
            kit.cylz('fairleads', col, 'roller', c + Vector((d, 0, .1)), .13, .45, 'naval', 10)
    for x, y, z in [(-3.75, 4.59, -50.28), (3.6, 4.49, 50.43)]:
        c = V(x, y - .6, z)
        kit.boxc('winches', col, 'winch bed', c, (2.1, .9, .3), 'edge')
        kit.part('rod', 'winches', col, 'winch drum', c + Vector((0, -.6, .48)), c + Vector((0, .6, .48)), .35, 'naval', vertices=14)
    kit.cylz('capstan', col, 'after capstan', V(.44, 3.1, 85.72), .45, .55, 'naval', 16)
    # Ventilators: the large mushroom heads (1.6 m across, 1.1 m tall) and the small ones (0.7 m) on the
    # weather decks at the reference positions. One a turret's gunhouse sweeps over (the rear corners
    # reach 6.2 m from the pivot) stays 6 cm below its sole.
    soles = [(*R(m['position'])[:2], m['position'][1] + m['weapon'].get('gunhouseBaseHeight', 0)) for m in D['mounts'] if m['battery'] == 'main']
    for x, y, z, r, h in [(-.01, 4.67, -64.53, .8, 1.11), (.81, 4.19, -36.47, .8, 1.11), (-2.45, 4.19, -38.08, .8, 1.11), (.18, 4.24, 55.33, .8, .96),
                          (-2.91, 4.23, 53.73, .8, .96), (3.15, 4.24, 55.48, .8, .96), (1.71, 4.46, -61.97, .35, .92), (1.14, 4.21, -46.46, .35, .92),
                          (-.62, 4.23, -37.39, .35, .92), (.18, 4.21, -46.11, .35, .92), (-.66, 4.23, -36.37, .35, .92), (1.91, 4.23, -38.21, .35, .92)]:
        c = V(x, 0, z)
        floor = kit.below(c.x, c.y, y + .5, y - .5)
        top = floor + h
        for mx, my, sole in soles:
            if math.hypot(c.x - mx, c.y - my) - r < 6.2 and top > sole - .06:
                print('Takao ventilator', (x, z), 'lowered under the gunhouse from', round(top, 3), 'to', round(sole - .06, 3), 'floor', round(floor, 3))
                top = sole - .06
        h = top - floor
        kit.cylz('ventilators', col, 'ventilator trunk', Vector((c.x, c.y, floor - .01)), r * .55, h - .2, 'naval', 16)
        kit.cylz('ventilators', col, 'ventilator head', Vector((c.x, c.y, top - .22)), r, .22, 'naval', 16, r2=r * .8)
    # Paravanes stowed by No. 3 barbette, smoke floats at the stern, leadsman's platforms at the bow.
    for x, z in [(3.31, -36.22), (-2.88, -36.04)]:
        c = V(x, 4.0, z)
        c.z = kit.below(c.x, c.y, 5.0, 3.9) - .12
        kit.part('rod', 'paravanes', col, 'paravane body', c + Vector((-1.6, 0, .35)), c + Vector((1.6, 0, .35)), .22, 'naval', vertices=10)
        kit.boxc('paravanes', col, 'paravane plane', c + Vector((-.6, 0, .35)), (.9, 1.2, .04), 'naval')
    for x, z in [(1.08, 101.65), (1.37, 100.75), (-1.07, 101.63), (-1.46, 100.74)]:
        kit.cylz('smoke-floats', col, 'smoke float', V(x, 2.95, z), .28, .9, 'black', 12)
    for s in (-1, 1):
        kit.boxc('leadsman', col, 'leadsman platform', V(s * 1.98, 6.64, -96.75), (1.2, 1.3, .08), 'edge')
    # Jack staff at the stem, flagstaff at the stern, the chrysanthemum on the stem head.
    kit.part('rod', 'staffs', col, 'jack staff', V(0, 6.9, -99.4), V(0, 13.45, -99.4), .06, 'naval', r2=.03, vertices=8)
    kit.part('rod', 'staffs', col, 'ensign staff', V(0, 2.95, 103.3), V(0, 8.0, 103.5), .07, 'naval', r2=.035, vertices=8)
    kit.part('rod', 'crest', col, 'chrysanthemum', V(0, 7.53, -100.34), V(0, 7.53, -100.48), .4, 'brass', vertices=16)
    # Raised gun platforms for the after 25 mm triples.
    for x in (3.12, -3.11):
        c = V(x, 3.07, 85.88)
        floor = kit.below(c.x, c.y, c.z + .3, c.z - .2)
        kit.cylz('stern-gun-decks', col, 'gun deck', Vector((c.x, c.y, floor)), 1.65, 3.19 - floor, 'naval', 24)


# ---------------------------------------------------------------- underwater
def underwater(D, kit):
    col = kit.collections['Underwater fittings']
    # Four screws on their shafts; the outer pair on A-brackets, the inner pair further aft.
    for x, y, z, hub in [(6.95, -5.06, 77.81, 'outer'), (-6.95, -5.06, 77.81, 'outer'), (3.28, -5.79, 89.74, 'inner'), (-3.28, -5.79, 89.74, 'inner')]:
        aid = f'screw-{"port" if x < 0 else "starboard"}-{hub}'
        c = V(x, y, z)
        kit.part('rod', aid, col, 'hub', c + Vector((.7, 0, 0)), c + Vector((-.5, 0, 0)), .42, 'bronze', r2=.36, vertices=14)
        kit.part('rod', aid, col, 'hub cone', c + Vector((-.5, 0, 0)), c + Vector((-1.0, 0, 0)), .36, 'bronze', r2=.08, vertices=14)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            sections = []
            for r, w in ((.3, .7), (.9, .95), (1.35, .85), (1.62, .45)):
                le = (c.x - w * .15, c.y + r * ca - w * sa * .5, c.z + r * sa + w * ca * .5)
                te = (c.x + w * .15, c.y + r * ca + w * sa * .5, c.z + r * sa - w * ca * .5)
                sections.append((le, te))
            vv = []
            for le, te in sections:
                for dx in (-.035, .035):
                    vv += [(le[0] + dx, le[1], le[2]), (te[0] + dx, te[1], te[2])]
            ff = []
            for i in range(len(sections) - 1):
                a0, b0 = 4 * i, 4 * (i + 1)
                ff += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, b0 + 2, b0 + 3, a0 + 3), (a0, b0, b0 + 2, a0 + 2), (a0 + 1, a0 + 3, b0 + 3, b0 + 1)]
            last = 4 * (len(sections) - 1)
            ff += [(0, 2, 3, 1), (last, last + 1, last + 3, last + 2)]
            ob = kit.mesh(aid + '.blade', vv, ff, 'bronze', col)
            kit.tag(ob, aid)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(ob.data)
            bm.free()
        shaft_start = V(x * .82, -4.6, z - (22 if hub == 'outer' else 20))
        kit.part('rod', aid, col, 'shaft', shaft_start, c + Vector((.7, 0, 0)), .24, 'bronze', vertices=12)
        floor_y = y + 1.2
        if hub == 'outer':
            for dy in (1,):
                kit.member(aid, col, c + Vector((2.2, 0, 0)), V(x * .62, y + 1.9, z - 2.2), .12)
                kit.member(aid, col, c + Vector((2.2, 0, 0)), V(x * 1.02, y + 2.3, z - 2.2), .12)
        else:
            kit.member(aid, col, c + Vector((1.8, 0, 0)), V(x * .55, y + 2.6, z - 1.8), .12)
            kit.member(aid, col, c + Vector((1.8, 0, 0)), V(x * 1.25, y + 2.4, z - 1.8), .12)
    # Balanced rudder on the centreline behind the inner screws.
    aid = 'rudder'

    def foil(y, z0, z1, t, n=10):
        up = [(z0 + (z1 - z0) * i / n, t * 2.6 * math.sqrt(max(0, i / n)) * (1 - i / n) ** 1.1) for i in range(n + 1)]
        right = [(w, y, z) for z, w in up]
        left = [(-w, y, z) for z, w in reversed(up[1:-1])]
        return [P(*p) for p in right + left]
    kit.loft(aid, col, 'rudder blade', [foil(-7.0, 92.3, 97.7, .26), foil(-3.05, 92.1, 98.2, .3)], 'antifouling', True, True, False)
    kit.part('rod', aid, col, 'rudder stock', V(0, -3.2, 93.3), V(0, -2.5, 93.3), .22, 'antifouling', vertices=10)
    # Bilge keels along the turn of the bulge (reference 23.5 m forward to 39 m aft of the origin),
    # plates standing out and down from the hull, in segments that follow the loft.
    for s in (-1, 1):
        zs = [-23.3 + (38.8 + 23.3) * i / 8 for i in range(9)]
        for z0, z1 in zip(zs, zs[1:]):
            ends = []
            for z in (z0, z1):
                root = V(s * (hull_half(kit, z, -5.75) - .06), -5.75, z)
                ends.append(root)
            out = Vector((0, -s * .82, -.57))
            mid = [e + out * .5 for e in ends]
            kit.beam('bilge-keels', col, 'bilge keel', mid[0], mid[1], .05, 1.0, 'antifouling', tuple(out))


def railings(D, kit):
    """Guard rails along the weather-deck edge and the shelter-deck edge; the gun arcs stay clear
    (Kit.in_arc), as the reference's collapsible rails do."""
    col = kit.collections['Deck fittings']
    for s in (-1, 1):
        for z0, z1, shelter in ((-98.4, -25.6, False), (26.9, 102.6, False), (-19.6, 21.2, True)):
            n = max(2, int(abs(z1 - z0) / 1.8))
            pts = []
            for i in range(n + 1):
                z = z0 + (z1 - z0) * i / n
                y = 6.16 if shelter else deck(kit, z)
                x = hull_half(kit, z, 3.83 if shelter else y - .02) - .12
                pts.append((V(s * x, y, z), y))
            for (a, ya), (b, yb) in zip(pts, pts[1:]):
                for h in (.5, 1.0):
                    kit.wire('railings', col, a + Vector((0, 0, h)), b + Vector((0, 0, h)), .016, True)
                kit.wire('railings', col, a, a + Vector((0, 0, 1.0)), .022, True)
            kit.wire('railings', col, pts[-1][0], pts[-1][0] + Vector((0, 0, 1.0)), .022, True)


def mast_bracing(D, kit):
    """Lattice bracing of the mainmast's lower tripod, as the reference frames it."""
    col = kit.collections['Sensors and masts']
    aid = 'mainmast'
    pole = lambda y: V(0, y, 42.07)
    leg = lambda s, y: V(s * (3.2 - (y - 3.76) / (22.6 - 3.76) * 3.08), y, 45.0 - (y - 3.76) / (22.6 - 3.76) * 2.6)
    levels = [4.4, 6.3, 8.2, 10.1, 12.0]
    for s in (-1, 1):
        for y0, y1 in zip(levels, levels[1:]):
            kit.member(aid, col, pole(y0), leg(s, y1), .05, 'naval', 5)
            kit.member(aid, col, leg(s, y0), pole(y1), .05, 'naval', 5)
        for y in levels:
            kit.member(aid, col, pole(y), leg(s, y), .05, 'naval', 5)
    for y0, y1 in zip(levels, levels[1:]):
        kit.member(aid, col, leg(-1, y0), leg(1, y1), .05, 'naval', 5)
        kit.member(aid, col, leg(1, y0), leg(-1, y1), .05, 'naval', 5)


def build(D, kit):
    towers(D, kit)
    railings(D, kit)
    mast_bracing(D, kit)
    torpedo_rooms(D, kit)
    torpedo_mounts(D, kit)
    foremast(D, kit)
    mainmast(D, kit)
    catapults(D, kit)
    directors(D, kit)
    rangefinders(D, kit)
    radars(D, kit)
    searchlights(D, kit)
    boats(D, kit)
    deck_gear(D, kit)
    underwater(D, kit)
    kit.build_wires()

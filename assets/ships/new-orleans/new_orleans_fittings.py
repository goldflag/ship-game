"""New Orleans fittings: masts, directors, radars, aviation, boats, deck gear and underwater gear.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the approved GameModels3D
pasc107 B_Hull model and converted once by `P`; shapes are original approximations of the reference's fittings at
their measured sizes. No reference geometry is loaded.
"""
import math

import bmesh
from mathutils import Vector

from new_orleans_kit import P, R, ZS


def V(x, y, z):
    return Vector(P(x, y, z))


def local(ob, pivot):
    """Parent a freshly built object to an unrotated pivot, keeping its authored place."""
    ob.location = Vector(ob.location) - Vector(pivot.location)
    ob.parent = pivot
    return ob


def taper(kit, aid, col, label, a, b, r0, r1, material='naval', n=16):
    return kit.part('rod', aid, col, label, V(*a), V(*b), r0, material, r2=r1, vertices=n)


# ---------------------------------------------------------------- directors
def mk51(kit, aid, col, x, y, z, bearing):
    """Mk 51 40 mm director: pedestal, yoke and the box sight with its two eyepieces (reference 0.84 x 1.73 m)."""
    base = V(x, y, z)
    kit.cylz(aid, col, 'pedestal', base, .2, 1.05, 'naval', 16)
    kit.cylz(aid, col, 'pedestal foot', base, .3, .08, 'edge', 16)
    pivot = kit.empty(aid + '.yaw', tuple(base + Vector((0, 0, 1.05))), assembly=aid, col=col)
    pivot.rotation_euler.z = math.radians(-bearing)
    local(kit.boxc(aid, col, 'sight box', tuple(base + Vector((0, 0, 1.35))), (.62, .4, .42), 'naval'), pivot)
    local(kit.boxc(aid, col, 'sight window', tuple(base + Vector((.315, 0, 1.4))), (.03, .3, .16), 'glass'), pivot)
    for s in (-1, 1):
        local(kit.part('rod', aid, col, 'handle', base + Vector((-.3, s * .28, 1.25)), base + Vector((-.1, s * .28, 1.25)), .025, 'edge', vertices=6), pivot)
    local(kit.boxc(aid, col, 'gyro housing', tuple(base + Vector((-.15, 0, 1.62))), (.36, .3, .16), 'painted-edge'), pivot)


def directors(D, kit):
    col = kit.collections['Sensors and masts']
    # Mk 31 main-battery directors (reference ad008: 2.88 m across, 1.19 m high): a low round house with a sloped
    # hood and the rangefinder's short tubes, training on a ring.
    for aid, (x, y, z) in [('mk31-forward', (0, 21.954, -28.444)), ('mk31-after', (0, 15.963, 49.017))]:
        c = V(x, y, z)
        kit.cylz(aid, col, 'training ring', c - Vector((0, 0, .04)), 1.3, .12, 'edge', 40)
        pivot = kit.empty(aid + '.yaw', tuple(c), assembly=aid, col=col)
        if aid == 'mk31-after':
            pivot.rotation_euler.z = math.pi
        local(kit.cylz(aid, col, 'house', c + Vector((0, 0, .08)), 1.28, .72, 'naval', 40, r2=1.18), pivot)
        local(kit.cylz(aid, col, 'roof', c + Vector((0, 0, .8)), 1.18, .06, 'roof', 40, r2=1.1), pivot)
        local(kit.boxc(aid, col, 'rangefinder hood', tuple(c + Vector((.5, 0, 1.0))), (.9, .9, .34), 'naval'), pivot)
        for s in (-1, 1):
            local(kit.part('rod', aid, col, 'rangefinder tube', c + Vector((.9, s * .24, 1.0)), c + Vector((1.52, s * .24, 1.0)), .09, 'naval', vertices=10), pivot)
            local(kit.part('rod', aid, col, 'lens', c + Vector((1.5, s * .24, 1.0)), c + Vector((1.54, s * .24, 1.0)), .07, 'glass', vertices=10), pivot)
        local(kit.boxc(aid, col, 'hatch', tuple(c + Vector((-.45, 0, .86))), (.6, .55, .06), 'edge'), pivot)
    # Mk 28 5-inch directors (reference ad009: 3.57 m wide, 5.67 m high with the Mk 4 array): a tapered pedestal,
    # the square director house with side hoods and the six-dish Mk 4 antenna on the roof.
    for aid, (x, y, z), heading in [('mk28-forward', (0, 21.989, -24.535), 0), ('mk28-after', (0, 16.119, 46.232), math.pi)]:
        c = V(x, y, z)
        kit.cylz(aid, col, 'pedestal', c, .55, 2.1, 'naval', 20, r2=.42)
        kit.cylz(aid, col, 'pedestal foot', c, .8, .12, 'edge', 20)
        pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, 2.1))), assembly=aid, col=col)
        pivot.rotation_euler.z = heading
        top = c + Vector((0, 0, 2.1))
        local(kit.boxc(aid, col, 'director house', tuple(top + Vector((.1, 0, 1.2))), (2.6, 2.3, 2.3), 'naval'), pivot)
        local(kit.boxc(aid, col, 'house roof', tuple(top + Vector((.1, 0, 2.38))), (2.66, 2.36, .06), 'roof'), pivot)
        for s in (-1, 1):
            local(kit.boxc(aid, col, 'rangefinder hood', tuple(top + Vector((.3, s * 1.4, 1.6))), (.8, .5, .6), 'naval'), pivot)
            local(kit.part('rod', aid, col, 'rangefinder end', top + Vector((.3, s * 1.62, 1.6)), top + Vector((.3, s * 1.78, 1.6)), .12, 'edge', vertices=10), pivot)
        local(kit.boxc(aid, col, 'front window', tuple(top + Vector((1.41, 0, 1.75))), (.04, 1.2, .3), 'glass'), pivot)
        for i in range(3):
            for s in (-1, 1):
                p = top + Vector((.9 - i * .75, s * .45, 2.8))
                local(kit.boxc(aid, col, 'Mk 4 reflector', tuple(p), (.12, .75, .7), 'painted-edge', yaw=0), pivot)
                local(kit.part('rod', aid, col, 'reflector strut', p - Vector((.1, 0, .35)), p - Vector((.1, 0, .04)), .03, 'edge', vertices=6), pivot)
    # Mk 51 40 mm directors beside their quads (reference HP_AD_3..6, 9, 10).
    for i, (x, y, z, bearing) in enumerate([(-3.003, 20.619, -23.499, -90), (3.003, 20.619, -23.499, 90), (-3.553, 13.764, 42.762, -90),
                                             (3.553, 13.764, 42.762, 90), (-2.386, 5.046, 72.509, 180), (2.386, 5.046, 72.509, 180)], 1):
        mk51(kit, f'mk51-{i}', col, x, y, z, bearing)


# ---------------------------------------------------------------- radars
def radars(D, kit):
    col = kit.collections['Sensors and masts']
    # SK air-search bedspring on the foremast top (reference ars006: 5.13 m wide, 5.83 m high).
    aid = 'radar-sk'
    c = V(0, 31.438, -22.351)
    kit.cylz(aid, col, 'pedestal', c, .35, .5, 'naval', 16)
    pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, .5))), assembly=aid, col=col)
    top = c + Vector((0, 0, .5))
    local(kit.boxc(aid, col, 'rotator housing', tuple(top + Vector((0, 0, .25))), (.8, .8, .5), 'naval'), pivot)
    frame = top + Vector((-.35, 0, 3.1))
    for dy in (-2.5, 2.5):
        local(kit.part('rod', aid, col, 'frame upright', frame + Vector((0, dy, -2.6)), frame + Vector((0, dy, 2.6)), .045, 'naval', vertices=6), pivot)
    for dz in (-2.6, -1.3, 0, 1.3, 2.6):
        local(kit.part('rod', aid, col, 'frame rail', frame + Vector((0, -2.5, dz)), frame + Vector((0, 2.5, dz)), .04, 'naval', vertices=6), pivot)
    local(kit.boxc(aid, col, 'mesh reflector', tuple(frame + Vector((-.08, 0, 0))), (.03, 5.0, 5.2), 'edge'), pivot)
    for dy in (-1.9, -.6, .6, 1.9):
        for dz in (-1.95, -.65, .65, 1.95):
            local(kit.boxc(aid, col, 'dipole', tuple(frame + Vector((.25, dy, dz))), (.05, .9, .06), 'painted-edge'), pivot)
    for s in (-1, 1):
        local(kit.part('rod', aid, col, 'back strut', top + Vector((0, s * .35, .5)), frame + Vector((-.1, s * 2.0, 1.8)), .035, 'naval', vertices=6), pivot)
        local(kit.part('rod', aid, col, 'back strut', top + Vector((0, s * .35, .5)), frame + Vector((-.1, s * 2.0, -1.8)), .035, 'naval', vertices=6), pivot)
    # SG surface-search sets on both topmasts (reference ars004: 1.29 x 1.23 x 0.69 m).
    for aid, (x, y, z) in [('radar-sg-forward', (0, 38.931, -19.27)), ('radar-sg-after', (0, 37.647, 38.234))]:
        c = V(x, y, z)
        kit.cylz(aid, col, 'drive', c, .14, .28, 'edge', 12)
        pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, .28))), assembly=aid, col=col)
        base = c + Vector((0, 0, .28))
        vv, ff = [], []
        n = 9
        for i in range(n + 1):
            a = -.6 + 1.2 * i / n
            for zz in (.05, .92):
                vv.append((base.x + .28 * (1 - math.cos(a * 1.3)) - .3, base.y + .64 * math.sin(a) / math.sin(.6), base.z + zz))
        for i in range(n):
            ff.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
        dish = kit.tag(kit.mesh(aid + '.reflector', vv, ff, 'painted-edge', col), aid)
        local(dish, pivot)
        local(kit.part('rod', aid, col, 'feed', base + Vector((-.3, 0, .48)), base + Vector((.28, 0, .48)), .04, 'edge', vertices=6), pivot)
        local(kit.boxc(aid, col, 'feed horn', tuple(base + Vector((.3, 0, .48))), (.1, .16, .12), 'edge'), pivot)
    # SM fighter-direction dish on the mainmast platform (reference arf012: 2.45 m across).
    aid = 'radar-sm'
    c = V(0, 30.14, 41.289)
    kit.cylz(aid, col, 'pedestal', c, .45, .9, 'naval', 16)
    pivot = kit.empty(aid + '.yaw', tuple(c + Vector((0, 0, .9))), assembly=aid, col=col)
    top = c + Vector((0, 0, .9))
    local(kit.boxc(aid, col, 'yoke', tuple(top + Vector((0, 0, .45))), (.5, 1.2, .9), 'naval'), pivot)
    rings = []
    for k, (r, dx) in enumerate([(.05, .55), (.6, .42), (1.0, .22), (1.22, 0)]):
        rings.append([(top.x + dx, top.y + r * math.cos(math.tau * i / 24), top.z + 1.3 + r * math.sin(math.tau * i / 24)) for i in range(24)])
    dish = kit.loft(aid, col, 'dish', rings, 'painted-edge', False, False, True)
    local(dish, pivot)
    local(kit.part('rod', aid, col, 'feed support', top + Vector((.55, 0, 1.3)), top + Vector((1.1, 0, 1.3)), .04, 'edge', vertices=6), pivot)


# ---------------------------------------------------------------- underwater
def underwater(D, kit):
    col = kit.collections['Underwater fittings']
    # Four screws (reference cm002/cm033: 3.55 m across): the outer pair abreast the after turret, the inner further aft.
    for x, y, z, hub in [(-6.775, -4.5, 60.15, 'outer'), (6.775, -4.5, 60.15, 'outer'), (-3.685, -4.96, 74.53, 'inner'), (3.685, -4.96, 74.53, 'inner')]:
        aid = f'screw-{"port" if x < 0 else "starboard"}-{hub}'
        c = V(x, y, z)
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
            ob = kit.mesh(aid + '.blade', vv, ff, 'bronze', col)
            kit.tag(ob, aid)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(ob.data)
            bm.free()


def build(D, kit):
    directors(D, kit)
    radars(D, kit)
    underwater(D, kit)
    kit.build_wires()

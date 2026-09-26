"""Omaha fittings: torpedo pockets and mounts, funnel caps, masts, directors, rangefinders, searchlights,
aviation, boats, deck gear and underwater gear.

Positions are reference-frame datums (x starboard, y up, z toward the stern) read off the approved
GameModels3D pasc005 model and converted once by `P`; shapes are original approximations of the
reference's fittings at their measured sizes. No reference geometry is loaded.
"""
import math
import bpy
import bmesh
from mathutils import Vector
from omaha_kit import P, R, ZSHIFT


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
    station = H['length'] / 2 - (zref + ZSHIFT)
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
    station = H['length'] / 2 - (zref + ZSHIFT)
    secs = H['sections']
    for s0, s1 in zip(secs, secs[1:]):
        if s0['station'] <= station <= s1['station']:
            t = (station - s0['station']) / max(1e-9, s1['station'] - s0['station'])
            return s0['points'][-1][1] * (1 - t) + s1['points'][-1][1] * t
    return 6.0


# ---------------------------------------------------------------- torpedo pockets
# The forward torpedo mounts stand on the main deck in pockets let into the hull side under the upper deck
# (reference: 9.0 m long from z 20.55 to 29.55, 5 m deep to a back wall at x 4.0, floor 3.53 m, head 5.95 m).
POCKET = dict(z0=20.55, z1=29.55, back=4.0, floor=3.53, head=5.95)


def torpedo_pockets(D, kit, hull):
    for sign in (-1, 1):
        a = V(sign * POCKET['back'], POCKET['floor'], POCKET['z1'])
        b = V(sign * 12.0, POCKET['head'], POCKET['z0'])
        lo = [min(a[i], b[i]) for i in range(3)]
        hi = [max(a[i], b[i]) for i in range(3)]
        cutter = kit.box('pocket cutter', [(l + h) / 2 for l, h in zip(lo, hi)], [h - l for l, h in zip(lo, hi)], 'hullgray', kit.collections['Hull and decks'])
        mod = hull.modifiers.new('pocket', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = hull
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    # Faces the cut made: walls and ceiling take the hull paint, the floor the deck paint (build.py sorts them).
    names = [m.name for m in hull.data.materials]
    return names


# ---------------------------------------------------------------- torpedo mounts
def torpedo_mounts(D, kit):
    """Triple 21-inch mounts (reference agt042): a pedestal and saddle carrying three tubes 8.0 m long, 0.69 m across
    and 0.732 m apart, their muzzles 3.23 m ahead of the pivot with flanged doors, their after ends tapered, clamped
    by bands; the trainer's sight post over the middle tube. Authored at zero train."""
    col = kit.collections['Torpedoes']
    for launcher in D['torpedoLaunchers']:
        lid = launcher['id']
        x, y, z = R(launcher['position'])
        floor = kit.below(x, y, z + .3, z)
        kit.cylz(lid, col, 'pedestal', (x, y, floor - .02), .62, z - floor + .02 + .12, 'naval', 24)
        pivot = kit.empty(lid + '.yaw', (x, y, z), assembly=lid, col=col)
        local(kit.cylz(lid, col, 'training ring', (x, y, z + .10), .74, .10, 'edge', 28), pivot)
        local(kit.cylz(lid, col, 'turntable', (x, y, z + .20), .55, .21, 'naval', 20), pivot)
        local(kit.boxc(lid, col, 'saddle', (x, y, z + .62), (1.10, 2.20, .42), 'naval'), pivot)
        tubes = [t for t in D['torpedoTubes'] if t['launcherId'] == lid]
        for tube in tubes:
            mx, my, mz = R(tube['position'])
            axis_y, axis_z = my, mz
            front = mx + .136            # flanged muzzle door, 3.36 m ahead of the pivot
            back = mx - 7.873            # after end, 4.65 m abaft the pivot
            taper_at = back + 3.0
            ring = 16
            prof = [(front, .345), (taper_at, .345), (back + .25, .23), (back, .20)]
            vv = [(px, axis_y + r * math.cos(math.tau * k / ring), axis_z + r * math.sin(math.tau * k / ring)) for px, r in prof for k in range(ring)]
            ff = [(j * ring + k, (j + 1) * ring + k, (j + 1) * ring + (k + 1) % ring, j * ring + (k + 1) % ring) for j in range(len(prof) - 1) for k in range(ring)]
            ff += [tuple(range(ring)), tuple(reversed(range((len(prof) - 1) * ring, len(prof) * ring)))]
            local(kit.solid(kit.tag(kit.mesh(lid + '.21-inch tube', vv, ff, 'naval', col, True), lid)), pivot)
            local(kit.part('rod', lid, col, 'muzzle door', (front - .02, axis_y, axis_z), (front + .06, axis_y, axis_z), .37, 'edge', vertices=16), pivot)
            local(kit.part('rod', lid, col, 'door hinge', (front + .02, axis_y - .38, axis_z - .12), (front + .02, axis_y - .38, axis_z + .12), .04, 'edge', vertices=6), pivot)
            for bx in (front - 1.9, front - 2.8, front - 4.1, front - 5.3):
                local(kit.part('rod', lid, col, 'tube band', (bx - .05, axis_y, axis_z), (bx + .05, axis_y, axis_z), .37, 'edge', vertices=16), pivot)
            kit.empty(tube['id'] + '.muzzle', tuple(Vector((mx, axis_y, axis_z)) - Vector(pivot.location)), pivot, lid, col)
        # Trainer's sight post and seat over the middle tube (reference 1.1 to 1.8 m).
        local(kit.boxc(lid, col, 'sight post', (x + .41, y - .37 * (1 if y > 0 else -1), z + 1.40), (.18, .18, .70), 'naval'), pivot)
        local(kit.part('rod', lid, col, 'sight', (x + .15, y - .37 * (1 if y > 0 else -1), z + 1.78), (x + .75, y - .37 * (1 if y > 0 else -1), z + 1.78), .05, 'edge', vertices=8), pivot)
        local(kit.boxc(lid, col, 'trainer seat', (x - .5, y - .37 * (1 if y > 0 else -1), z + 1.32), (.35, .35, .08), 'edge'), pivot)


# ---------------------------------------------------------------- funnel caps
def funnel_caps(D, kit):
    """Each funnel's rain cap: a shallow dished disc on four stays over the rim (reference: the cap's plate
    0.33-0.41 m above the rim, 3.5 m across)."""
    col = kit.collections['Superstructure']
    for s in D['structures']:
        ex = s.get('exhaust')
        if not ex:
            continue
        aid = s['id'] + '-cap'
        x, y, z = R(ex['position'])
        rim = y
        hx, hz = ex['length'] / 2, ex['width'] / 2
        ring0 = kit.disc_ring(24, hz + .12, (x, y, rim + .33), rx=hx + .12)
        ring1 = kit.disc_ring(24, hz * .35, (x, y, rim + .52), rx=hx * .35)
        kit.loft(aid, col, 'cap', [ring0, [(p[0], p[1], p[2] + .06) for p in ring0], ring1], 'black', True, True, True)
        for k in range(4):
            ang = math.tau * (k + .5) / 4
            px, py = x + (hx - .06) * math.cos(ang), y + (hz - .06) * math.sin(ang)
            kit.member(aid, kit.collections['Superstructure'], (px, py, rim - .25), (px, py, rim + .34), .05, 'black', 6)


# ---------------------------------------------------------------- masts
def foremast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'foremast'
    # Raked pole from the bridge to the truck (reference: 0.33 m at 19 m, 0.09 m at 60 m, 4.3 m of rake aft).
    taper(kit, aid, col, 'pole', (0, 15.7, -42.45), (0, 25.0, -41.45), .34, .33)
    taper(kit, aid, col, 'topmast', (0, 25.0, -41.45), (0, 45.0, -38.93), .33, .19)
    taper(kit, aid, col, 'topgallant', (0, 45.0, -38.93), (0, 59.55, -37.6), .19, .07)
    # Tripod legs from the bridge-top deck aft and outboard up to the pole under the top.
    for s in (-1, 1):
        taper(kit, aid, col, 'leg', (s * 3.46, 15.7, -37.2), (s * .25, 25.6, -40.3), .30, .28)
    # Fighting top: platform, the director's house and rails (reference 25.45 to 31 m).
    kit.boxc(aid, col, 'top platform', V(0, 25.45, -40.5), (3.6, 3.2, .1), 'roof')
    kit.boxc(aid, col, 'top house', V(0, 26.6, -40.9), (2.4, 2.4, 2.2), 'naval')
    kit.boxc(aid, col, 'director platform', V(0, 27.85, -41.77), (2.1, 2.5, .1), 'roof')
    kit.rail(aid, col, [(V(0, 0, -40.8)[0] + dx, dy) for dx, dy in ((1.05, 1.25), (-1.05, 1.25), (-1.05, -1.25), (1.05, -1.25))], 25.5, .9, 1.0, True, False)
    # Lookout box and yards on the topmast.
    kit.boxc(aid, col, 'lookout', V(0, 45.0, -38.6), (.8, .8, 1.3), 'naval')
    for yy, span in ((50.0, 2.2), (55.0, 1.1)):
        kit.part('rod', aid, col, 'yard', V(-span, yy, -38.4 + (yy - 50) * .05), V(span, yy, -38.4 + (yy - 50) * .05), .07, 'naval', vertices=8)


def mainmast(D, kit):
    col = kit.collections['Sensors and masts']
    aid = 'mainmast'
    base = kit.below(*V(0, 0, 33.2)[:2], 12.0, 6.0)
    taper(kit, aid, col, 'pole', (0, base - .05, 33.15), (0, 24.5, 33.92), .36, .30)
    taper(kit, aid, col, 'topmast', (0, 24.5, 33.92), (0, 50.0, 35.27), .30, .13)
    taper(kit, aid, col, 'topgallant', (0, 50.0, 35.27), (0, 67.3, 36.39), .13, .035)
    # Boat derrick post aft of the pole.
    post_base = kit.below(*V(0, 0, 31.96)[:2], 12.0, 6.0)
    taper(kit, aid, col, 'derrick post', (0, post_base - .05, 31.96), (0, 24.5, 31.96), .17, .11)
    kit.boxc(aid, col, 'lookout', V(0, 45.5, 34.8), (.8, .8, 1.3), 'naval')
    for yy, span in ((50.0, 2.2), (55.0, 1.2)):
        kit.part('rod', aid, col, 'yard', V(-span, yy, 35.3 + (yy - 50) * .1), V(span, yy, 35.3 + (yy - 50) * .1), .07, 'naval', vertices=8)


# ---------------------------------------------------------------- fire control
def directors(D, kit):
    """Mk 7 pedestal directors (reference ad054, 1.55 m tall) on the foremast top and the after tower, each trained by
    the rig about its own yaw node; a seat pedestal carries each to its datum where the deck below falls short."""
    col = kit.collections['Sensors and masts']
    for did, (x, y, z), face in [('main-director', (0, 27.869, -42.476), 0), ('after-director', (0, 10.320, 45.524), 180)]:
        bx, by, bz = P(x, y, z)
        floor = kit.below(bx, by, bz + .3, bz)
        if bz - floor > .03:
            kit.cylz(did, col, 'director stand', (bx, by, floor - .02), .40, bz - floor + .03, 'naval', 20)
        pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
        s = 1 if face == 0 else -1
        local(kit.cylz(did, col, 'base', (bx, by, bz - .02), .417, .135, 'naval', 16), pivot)
        local(kit.cylz(did, col, 'pedestal', (bx, by, bz + .11), .258, .83, 'naval', 12, r2=.20), pivot)
        for k in range(4):
            a = math.tau * (k + .5) / 4
            local(kit.part('rod', did, col, 'strut', (bx + .30 * math.cos(a), by + .30 * math.sin(a), bz + .12),
                           (bx + .22 * math.cos(a), by + .22 * math.sin(a), bz + .94), .012, 'edge', vertices=5), pivot)
        local(kit.cylz(did, col, 'deck ring', (bx, by, bz + .936), .306, .037, 'edge', 20), pivot)
        local(kit.boxc(did, col, 'sight head', (bx + s * .02, by, bz + 1.08), (.44, .30, .26), 'naval'), pivot)
        local(kit.boxc(did, col, 'head roof', (bx + s * .02, by, bz + 1.225), (.40, .26, .03), 'edge'), pivot)
        for t in (-1, 1):
            a = (bx - s * .15, by + t * .28, bz + 1.05)
            b = (bx + s * .38, by + t * .28, bz + 1.05)
            local(kit.part('rod', did, col, 'telescope', a, b, .045, 'edge', vertices=10), pivot)
            local(kit.part('rod', did, col, 'objective', b, (b[0] + s * .03, b[1], b[2]), .038, 'glass', vertices=10), pivot)
            local(kit.part('rod', did, col, 'eyepiece', (a[0] - s * .06, a[1], a[2]), a, .03, 'dark', vertices=8), pivot)
        local(kit.part('rod', did, col, 'training handwheel', (bx - s * .25, by - .17, bz + .80), (bx - s * .25, by - .21, bz + .80), .12, 'edge', vertices=10), pivot)


def rangefinders(D, kit):
    """3.6 m rangefinders (reference af052): a housing 1.25 m deep and 1.54 m tall on a turntable, the tube's arms
    reaching 2 m either side, on the conning station and on the after tower."""
    col = kit.collections['Sensors and masts']
    for aid, (x, y, z), face in [('rangefinder-forward', (0, 18.053, -44.692), 0), ('rangefinder-after', (0, 12.270, 40.184), 180)]:
        c = V(x, y, z)
        floor = kit.below(c.x, c.y, c.z + .3, c.z)
        if c.z - floor > .03:
            kit.cylz(aid, col, 'stand', (c.x, c.y, floor - .02), .45, c.z - floor + .03, 'naval', 20)
        s = 1 if face == 0 else -1
        kit.cylz(aid, col, 'turntable', c, .605, .315, 'naval', 16)
        kit.boxc(aid, col, 'housing', c + Vector((s * .08, 0, .315 + .77)), (1.25, 1.83, 1.54), 'naval')
        kit.boxc(aid, col, 'housing roof', c + Vector((s * .08, 0, 1.87)), (1.29, 1.87, .03), 'edge')
        for t in (-1, 1):
            kit.boxc(aid, col, 'arm', c + Vector((s * .36, t * 1.45, 1.56)), (.24, 1.08, .30), 'naval')
            kit.boxc(aid, col, 'arm window', c + Vector((s * .49, t * 1.95, 1.56)), (.02, .10, .12), 'glass')
        kit.cylz(aid, col, 'sight port', c + Vector((s * .70, .43, 1.29)), .09, .18, 'edge', 8)


def build(D, kit):
    directors(D, kit)
    rangefinders(D, kit)
    torpedo_mounts(D, kit)
    funnel_caps(D, kit)
    foremast(D, kit)
    mainmast(D, kit)
    kit.build_wires()

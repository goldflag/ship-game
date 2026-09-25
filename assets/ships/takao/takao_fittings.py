"""Takao fittings: torpedo mounts, directors and sensors with their moving joints, masts and
deck gear. Positions are reference-frame datums (see takao_kit.P)."""
import math
from mathutils import Vector
from takao_kit import P, R

# Measured blocks this module draws itself (their prisms still support fittings until removed).
CLAIMED_STRUCTURES = set()


def local(ob, pivot):
    """Parent a freshly built object to an unrotated pivot, keeping its authored place."""
    ob.location = Vector(ob.location) - Vector(pivot.location)
    ob.parent = pivot
    return ob


def torpedo_mounts(D, kit):
    col = kit.collections['Torpedoes']
    for launcher in D['torpedoLaunchers']:
        lid = launcher['id']
        x, y, z = R(launcher['position'])
        floor = kit.below(x, y, z + .1)
        kit.cylz(lid, col, 'foundation', (x, y, floor - .01), 1.05, z - floor + .02, 'naval', 32)
        pivot = kit.empty(lid + '.yaw', (x, y, z), assembly=lid, col=col)
        local(kit.cylz(lid, col, 'turntable', (x, y, z), 1.12, .16, 'edge', 32), pivot)
        local(kit.boxc(lid, col, 'cross frame', (x - 1.2, y, z + .3), (6.2, 3.3, .2), 'naval'), pivot)
        for xx in (-2.6, .2, 2.6):
            local(kit.boxc(lid, col, 'tube saddle', (x + xx - 1.2, y, z + .38), (.18, 3.3, .34), 'edge'), pivot)
        for tube in [t for t in D['torpedoTubes'] if t['launcherId'] == lid]:
            mx, my, mz = R(tube['position'])
            muzzle = Vector((mx, my, mz))
            breech = muzzle - Vector((8.2, 0, 0))
            local(kit.part('rod', lid, col, '610 mm tube', breech, muzzle, .33, 'naval', vertices=20), pivot)
            local(kit.part('rod', lid, col, 'tube mouth', muzzle - Vector((.02, 0, 0)), muzzle + Vector((.01, 0, 0)), .29, 'dark', vertices=20), pivot)
            local(kit.part('rod', lid, col, 'breech', breech - Vector((.08, 0, 0)), breech + Vector((.12, 0, 0)), .37, 'edge', vertices=20), pivot)
            for xx in (-6.4, -4.0, -1.6, .6):
                c = muzzle + Vector((xx, 0, 0))
                local(kit.part('rod', lid, col, 'tube band', c - Vector((.04, 0, 0)), c + Vector((.04, 0, 0)), .35, 'edge', vertices=20), pivot)
            kit.empty(tube['id'] + '.muzzle', tuple(muzzle - Vector(pivot.location)), pivot, lid, col)


def directors(D, kit):
    col = kit.collections['Sensors and masts']
    # Type 94 main directors: forward on the bridge top, aft on the after control station.
    for did, (x, y, z), face in [('main-director', (0, 21.059, -23.104), 0), ('after-director', (0, 12.504, 14.345), 180)]:
        bx, by, bz = P(x, y, z)
        pivot = kit.empty(did + '.yaw', (bx, by, bz), assembly=did, col=col)
        s = 1 if face == 0 else -1
        local(kit.cylz(did, col, 'director base', (bx, by, bz), 1.25, .5, 'naval', 28), pivot)
        local(kit.boxc(did, col, 'director hood', (bx + s * .1, by, bz + 1.15), (2.6, 2.3, 1.3), 'naval'), pivot)
        local(kit.boxc(did, col, 'director roof', (bx + s * .1, by, bz + 1.85), (2.2, 2.0, .15), 'roof'), pivot)
        for side in (-1, 1):
            local(kit.part('rod', did, col, 'sight port', (bx + s * 1.36, by + side * .7, bz + 1.35), (bx + s * 1.42, by + side * .7, bz + 1.35), .12, 'glass', vertices=12), pivot)


def radars(D, kit):
    col = kit.collections['Sensors and masts']
    # Type 21 bedspring aerial on its stand at the foremast head (HP_JRS_3).
    rid = 'type21-radar'
    bx, by, bz = P(0, 25.094, -13.704)
    pivot = kit.empty(rid + '.yaw', (bx, by, bz), assembly=rid, col=col)
    local(kit.cylz(rid, col, 'turntable', (bx, by, bz), .35, .25, 'edge', 16), pivot)
    local(kit.boxc(rid, col, 'aerial frame', (bx, by, bz + 1.35), (.14, 2.4, 2.0), 'edge'), pivot)


def build(D, kit):
    torpedo_mounts(D, kit)
    directors(D, kit)
    radars(D, kit)
    kit.build_wires()

"""Nagato boats, boat cranes and aviation: the 17 m motor boats and 12 m launches amidships, the 11 m motor boat and
9 m cutter on the upperworks, the 6 m dinghy, the two jib boat cranes with their slung boats, the small davits, the
stowed boom, the Kure Type 2 catapult on its turntable and the aircraft deck's trolley rails.

Datums are the cached pjsb010 reference's part bounds (nagato_gear.GEAR), converted by `P`.
"""
import math
from mathutils import Vector
from nagato_kit import P, LINO
from nagato_gear import GEAR


def rows(kind):
    return [r[1:] for r in GEAR if r[0] == kind]


def build(kit):
    col = kit.collections['Boats and aviation']
    # Motor boats and launches along the forecastle deck beside the funnel; cutter across the upperworks.
    for i, (x, y, z, sx, sy, sz, foot) in enumerate(rows('motor-boat-17'), 1):
        bx, by, _ = P(x, 0, z)
        kit.motor_boat(f'motor-boat-{i}', bx, by, foot + .55, sz * .93, 2.9, 2.1, col)
    for i, (x, y, z, sx, sy, sz, foot) in enumerate(rows('motor-launch-12'), 1):
        bx, by, _ = P(x, 0, z)
        kit.motor_boat(f'motor-launch-{i}', bx, by, foot + .35, sz * .97, min(sx, 3.0) * .9, 1.35, col, chocks=(.25, .5, .75))
    for x, y, z, sx, sy, sz, foot in rows('motor-boat-11'):
        bx, by, _ = P(x, 0, z)
        kit.motor_boat('motor-boat-11', bx, by, foot + .45, sz * .95, 2.6, 1.7, col, chocks=(.25, .5, .75))
    for x, y, z, sx, sy, sz, foot in rows('cutter-9'):
        # Stowed athwartships: its length runs across the ship.
        bx, by, _ = P(x, 0, z)
        hull, st = kit.boat_hull('cutter.hull', col, 0, 0, 0, sx * .97, sz * .9, 1.0, 'white', 'wood', 1, .5, .32, (.28, .12), .55)
        kit.tag(hull, 'cutter')
        hull.rotation_euler.z = math.pi / 2
        hull.location = (bx, by, foot + .3)
        for t in (-.3, 0, .3):
            floor = kit.below(bx, by + t * sx, foot + .3, foot)
            kit.boxc('cutter', col, 'chock', (bx, by + t * sx, (floor + foot + .32) / 2), (.7, .18, foot + .32 - floor), 'naval')
    for x, y, z, sx, sy, sz, foot in rows('dinghy-6'):
        bx, by, _ = P(x, 0, z)
        kit.open_boat('dinghy', bx, by, foot + .25, sz * .95, sx * .85, .8, col)

    # Jib boat cranes at the deck edge abreast the funnel, each with a slung cutter swung in.
    for i, (x, y, z, sx, sy, sz, foot) in enumerate(rows('boat-crane'), 1):
        C = f'boat-crane-{i}'
        s = 1 if x > 0 else -1
        post = P(s * 12.6, foot, z)
        kit.cylz(C, col, 'post', post, .42, 5.6, 'naval', 16)
        kit.cylz(C, col, 'post foot', post, .62, .3, 'naval', 16)
        top = Vector(post) + Vector((0, 0, 5.6))
        kit.cylz(C, col, 'slewing head', tuple(top), .5, .5, 'naval', 16)
        head = Vector(P(s * 17.9, foot + 7.2, z))
        heel = top + Vector((0, 0, .2))
        kit.lattice(C, col, tuple(heel), tuple(head), .45, .45, 6)
        kit.member(C, col, tuple(top + Vector((0, 0, .5))), tuple(head + Vector((0, 0, .2))), .03, 'edge', 3)
        kit.part('rod', C, col, 'head sheave', tuple(head + Vector((.18, 0, 0))), tuple(head - Vector((.18, 0, 0))), .22, 'black', vertices=8)
        hang = head - Vector((0, 0, 1.0))
        kit.member(C, col, tuple(head), tuple(hang), .03, 'black', 4)
        kit.boxc(C, col, 'hook block', tuple(hang), (.25, .2, .35), 'black')
        st = kit.open_boat(C + '-boat', hang.x, hang.y, hang.z - 1.65, 7.0, 1.9, .9, col, chocks=None)
        for t in (.26, .68):
            px, w, k, g = st(t)
            kit.member(C + '-boat', col, (px, hang.y, g - .25), tuple(hang - Vector((0, 0, .15))), .025, 'black', 4)
    # Small davits by No. 2 turret and aft; the stowed boom along the port upper deck.
    # (The two small davits abreast No. 1 turret stand in its barrels' depressed sweep and are left out.)
    for x, y, z, sx, sy, sz, foot in rows('davit'):
        D = f'davit-{"port" if x < 0 else "starboard"}-{abs(round(z))}'
        s = 1 if x > 0 else -1
        bx, by, bz = P(x, foot, z)
        # Seat the post on the deck: step inboard from the datum until a deck lies within 30 cm under it.
        for k in range(12):
            floor = kit.below(bx, by, bz + .4, -99.0)
            if abs(floor - bz) < .3:
                bz = floor
                break
            by += s * .2
        height = max(1.3, sy)
        kit.cylz(D, col, 'post', (bx, by, bz), .12, height, 'naval', 10)
        tip = (bx, by - s * .75, bz + height + .2)
        kit.member(D, col, (bx, by, bz + height), tip, .1, 'naval', 8)
        kit.member(D, col, tip, (tip[0], tip[1], tip[2] - .8), .015, 'edge', 3)
    for x, y, z, sx, sy, sz, foot in rows('stowed-boom'):
        B = 'stowed-boom'
        a, b = Vector(P(x, foot + .45, z - sz / 2 + .4)), Vector(P(x, foot + .45, z + sz / 2 - .4))
        kit.lattice(B, col, tuple(a), tuple(b), .7, .6, 14)
        for t in (.12, .5, .88):
            p = a.lerp(b, t)
            kit.boxc(B, col, 'crutch', (p.x, p.y, (foot + p.z - .3) / 2), (.2, .5, p.z - .3 - foot + .02), 'naval')

    # Kure Type 2 catapult on its turntable on the aircraft deck, trained to port as the reference stows it.
    for x, y, z, sx, sy, sz, foot in rows('catapult'):
        A = 'catapult'
        cx, cy, cz = P(-.046, foot, 30.848)
        kit.cylz(A, col, 'turntable pedestal', (cx, cy, cz), 1.35, .9, 'naval', 28)
        kit.cylz(A, col, 'training race', (cx, cy, cz + .9), 1.5, .14, 'edge', 28)
        kit.cylz(A, col, 'pivot housing', (cx, cy, cz + 1.04), 1.0, .4, 'naval', 20)
        # The girder runs across the ship: from x = -11.6 to 8.3 (reference), 1.4 m deep, tapering at the ends.
        a, b = Vector(P(8.2, foot + 2.2, 30.85)), Vector(P(-11.5, foot + 2.2, 30.85))
        kit.lattice(A, col, tuple(a), tuple(b), 1.2, 1.4, 16)
        kit.boxc(A, col, 'track', tuple(a.lerp(b, .5) + Vector((0, 0, .76))), (1.0, (a - b).length, .08), 'edge')
        kit.boxc(A, col, 'launch carriage', tuple(a.lerp(b, .8) + Vector((0, 0, .95))), (1.2, 1.6, .3), 'naval')
        for t in (.25, .75):
            p = a.lerp(b, t)
            kit.member(A, col, (cx, cy, cz + 1.4), (p.x, p.y, p.z - .7), .08, 'naval', 6)
    for x, y, z, sx, sy, sz, foot in rows('aircraft-rail'):
        A = f'aircraft-trolley-{"port" if x < 0 else "starboard"}'
        cx, cy, cz = P(x, foot, z)
        for t in (-1, 1):
            kit.boxc(A, col, 'trolley rail', (cx, cy + t * .55, cz + .06), (sz, .12, .12), 'edge')
        kit.boxc(A, col, 'trolley', (cx, cy, cz + .55), (1.6, 1.3, .25), 'naval')
        for t in (-1, 1):
            for u in (-1, 1):
                kit.part('rod', A, col, 'trolley leg', (cx + u * .6, cy + t * .55, cz + .1), (cx + u * .6, cy + t * .55, cz + .45), .06, 'naval', vertices=8)
        kit.lattice(A, col, (cx - .6, cy, cz + .7), (cx + .6, cy, cz + 1.3), .9, .5, 2)
    aircraft_deck(kit, col)


def _inside(poly, x, z):
    c = False
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            c = not c
    return c


def aircraft_deck(kit, col):
    """Pale strips over the linoleum aircraft deck (textured top render: across the deck every 2.0 m from runtime
    z 22.25 to 46.25, and one either side 3.77 m off the centre line), laid only where the deck is open."""
    A = 'aircraft-deck'
    z0, z1, half = LINO
    deck = 6.5
    blocks = [s['footprint'] for s in kit.D['structures'] if s['baseY'] <= deck + .05 < s['baseY'] + s['height']
              and not s['id'].startswith('forecastle-')]
    turrets = [(m['position'][0], m['position'][2], 6.3) for m in kit.D['mounts'] if m['battery'] == 'main']

    def open_deck(x, z):
        return not any(_inside(f, x, z) for f in blocks) and all((x - tx) ** 2 + (z - tz) ** 2 > r * r for tx, tz, r in turrets)

    def strip(a, b, width):
        """Runs of open deck along a runtime line a -> b (x, z), each laid as one strip."""
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / .2))
        pts = [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]
        run = []
        for p in pts + [None]:
            if p is not None and open_deck(*p):
                run.append(p)
                continue
            if len(run) > 2:
                (xa, za), (xb, zb) = run[0], run[-1]
                h = kit.below(-(za + zb) / 2, -(xa + xb) / 2, deck + .3, deck)
                kit.beam(A, col, 'deck strip', (-za, -xa, h + .008), (-zb, -xb, h + .008), width, .016, 'wood')
            run = []
    for k in range(13):
        z = 22.25 + 2.0 * k
        strip((-half, z), (half, z), .22)
    for x in (-3.77, 3.77):
        strip((x, z0), (x, z1), .22)

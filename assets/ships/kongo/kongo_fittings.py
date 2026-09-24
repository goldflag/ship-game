"""Original Kongō topside and underwater fittings, proportioned to the approved GameModels3D
pjsb007 B hull. Datums are reference-frame measurements converted by `P`; shapes are simplified
original constructions. No reference geometry is loaded."""
import math
from mathutils import Vector
from blender_rig import radar_pivot
from kongo_kit import P, ZC


def build_fittings(D, kit):
    cols = kit.cols
    masts = cols['Sensors and masts']
    deck = cols['Deck fittings']
    boats = cols['Boats and aviation']
    under = cols['Underwater fittings']
    sup = kit.support

    # ------------------------------------------------------------ funnels
    for f in D['structures']:
        if not f['id'].endswith('funnel'):
            continue
        xs = [p[0] for p in f['footprint']]
        zs = [p[1] for p in f['footprint']]
        half, length = (max(xs) - min(xs)) / 2, max(zs) - min(zs)
        cx = -(min(zs) + max(zs)) / 2
        base, top = f['baseY'], f['baseY'] + f['height']
        pts = [(cx + a, b) for a, b in kit.stadium(half + .025, length + .05, 40)]
        # Black cap band over the upper 2.2 m, a rolled rim and the funnel-top grating and rain caps.
        kit.prism(f['id'], cols['Superstructure'], 'black cap', pts, top - 2.2, top + .01, 'black')
        rim = [(cx + a, b) for a, b in kit.stadium(half + .09, length + .18, 40)]
        kit.prism(f['id'], cols['Superstructure'], 'rim', rim, top - .12, top + .04, 'black')
        inner = [(cx + a, b) for a, b in kit.stadium(half - .2, length - .4, 36)]
        kit.prism(f['id'], cols['Superstructure'], 'cap coaming', inner, top, top + .55, 'black')
        for i in range(-5, 6):
            kit.part('rod', f['id'], cols['Superstructure'], 'grating bar', (cx + i * length * .085, -(half - .25), top + .5), (cx + i * length * .085, half - .25, top + .5), .03, 'black', vertices=5)
        for dx in (-length * .22, length * .22):
            kit.cylz(f['id'], cols['Superstructure'], 'rain cap post', (cx + dx, 0, top + .5), .08, .45, 'black', 8)
            kit.part('box', f['id'], cols['Superstructure'], 'rain cap', (cx + dx, 0, top + 1.0), (.5, .9, .12), 'black')
        # Steam pipes up the after face and a band of hand-rail brackets.
        for dy in (-.7, .7):
            kit.part('rod', f['id'], cols['Superstructure'], 'steam pipe', (cx - length / 2 - .12, dy, base + 1.0), (cx - length / 2 - .12, dy, top + .6), .09, 'naval', vertices=10)
        for zz in (base + 4.5, base + 8.2):
            kit.prism(f['id'], cols['Superstructure'], 'band', [(cx + a, b) for a, b in kit.stadium(half + .05, length + .1, 40)], zz, zz + .1, 'naval')

    # ------------------------------------------------------------ mainmast, topmast and derrick
    A = 'mainmast'
    foot = P(0, 8.8, 1.66)
    head = P(0, 31.2, 1.66)
    kit.part('rod', A, masts, 'pole', foot, P(0, 21.5, 1.66), .44, 'naval', vertices=20)
    kit.part('rod', A, masts, 'pole black', P(0, 21.5, 1.66), head, .44, 'black', vertices=20)
    for s in (-1, 1):
        f0 = P(s * 5.05, 8.8, 6.5)
        f1 = P(s * 0.25, 30.4, 1.95)
        mid = P(s * 1.02, 26.0, 3.05)
        kit.part('rod', A, masts, 'strut', f0, mid, .36, 'naval', vertices=16, r2=.34)
        kit.part('rod', A, masts, 'strut black', mid, f1, .34, 'black', vertices=16, r2=.3)
    kit.part('rod', A, masts, 'topmast', P(0, 31.0, 0.71), P(0, 40.7, 0.71), .07, 'black', vertices=10, r2=.05)
    kit.part('box', A, masts, 'masthead platform', P(0, 31.25, 1.4), (2.2, 1.6, .12), 'black')
    kit.part('rod', A, masts, 'yard', P(-3.2, 34.2, 0.71), P(3.2, 34.2, 0.71), .06, 'black', vertices=8)
    kit.cylz(A, masts, 'day light', P(0, 40.7, 0.71), .16, .7, 'black', 12)
    kit.part('rod', A, masts, 'gaff', P(0, 36.8, 0.71), P(0, 38.2, 4.4), .05, 'black', vertices=8)
    # Derrick boom stepped at the mast foot, topped forward over the boat stowage.
    kit.part('rod', 'derrick', masts, 'boom', P(0, 13.6, 0.9), P(0, 27.6, -4.2), .24, 'black', vertices=14, r2=.14)
    kit.cylz('derrick', masts, 'gooseneck', P(0, 13.0, 1.0), .35, .8, 'naval', 16)
    kit.wire('derrick', masts, P(0, 27.6, -4.2), P(0, 30.4, 1.2), .03, check=False)
    kit.wire('derrick', masts, P(0, 27.6, -4.2), P(0, 14.2, -4.4), .02, check=False)

    # ------------------------------------------------------------ pagoda top: main director and pole mast
    A = 'main-director'
    x, y, z = P(0, 32.87, -29.98)
    kit.cylz(A, masts, 'barbette', (x, y, z - .02), 1.35, .5, 'naval', 32)
    moving = [kit.cylz(A, masts, 'training ring', (x, y, z + .45), 1.45, .18, 'edge', 32)]
    hood = [(x + a, y + b) for a, b in [(1.9, -1.2), (1.9, 1.2), (.9, 1.6), (-2.3, 1.6), (-2.3, -1.6), (.9, -1.6)]]
    moving.append(kit.prism(A, masts, 'hood', hood, z + .6, z + 2.9, 'naval', 'roof'))
    moving.append(kit.part('rod', A, masts, 'rangefinder', (x - .8, y - 5.2, z + 2.2), (x - .8, y + 5.2, z + 2.2), .32, 'naval', vertices=16))
    for s in (-1, 1):
        moving.append(kit.part('box', A, masts, 'rangefinder hood', (x - .8, y + s * 5.05, z + 2.2), (.9, .7, .95), 'naval'))
        moving.append(kit.part('box', A, masts, 'objective', (x - .33, y + s * 5.05, z + 2.25), (.05, .44, .34), 'glass'))
    for dy in (-.8, 0, .8):
        moving.append(kit.part('box', A, masts, 'sight port', (x + 1.92, y + dy, z + 2.25), (.04, .42, .3), 'glass'))
    radar_pivot('main-director.yaw', (x, y, z + .45), moving)
    kit.part('rod', 'pagoda-mast', masts, 'pole', P(0, 35.4, -30.9), P(0, 43.0, -30.9), .12, 'black', vertices=10, r2=.07)
    kit.part('rod', 'pagoda-mast', masts, 'yard', P(-3.6, 38.8, -30.9), P(3.6, 38.8, -30.9), .06, 'black', vertices=8)

    # ------------------------------------------------------------ after director and rangefinders
    A = 'after-director'
    x, y, z = P(0, 16.754, 13.194)
    kit.cylz(A, masts, 'barbette', (x, y, z - .02), 1.25, .45, 'naval', 32)
    moving = [kit.cylz(A, masts, 'training ring', (x, y, z + .4), 1.35, .16, 'edge', 32)]
    hood = [(x + a, y + b) for a, b in [(-1.7, -1.1), (-1.7, 1.1), (-.8, 1.5), (1.9, 1.5), (1.9, -1.5), (-.8, -1.5)]]
    moving.append(kit.prism(A, masts, 'hood', hood, z + .55, z + 2.6, 'naval', 'roof'))
    moving.append(kit.part('rod', A, masts, 'rangefinder', (x + .6, y - 2.4, z + 2.0), (x + .6, y + 2.4, z + 2.0), .24, 'naval', vertices=16))
    for s in (-1, 1):
        moving.append(kit.part('box', A, masts, 'rangefinder hood', (x + .6, y + s * 2.35, z + 2.0), (.7, .55, .7), 'naval'))
    radar_pivot('after-director.yaw', (x, y, z + .4), moving)
    for id, (rx, ry, rz_), width, bearing in [('rf-pagoda-port', (-2.831, 21.65, -36.311), 1.5, 0), ('rf-pagoda-starboard', (2.832, 21.65, -36.299), 1.5, 0),
                                              ('rf-secondary-port', (-4.453, 23.964, -27.489), 4.5, -90), ('rf-secondary-starboard', (4.44, 23.964, -27.489), 4.5, 90),
                                              ('rf-after-port', (-2.626, 15.501, 16.276), 4.8, 180), ('rf-after-starboard', (2.607, 15.501, 16.276), 4.8, 180)]:
        x, y, z = P(rx, ry, rz_)
        kit.cylz(id, masts, 'pedestal', (x, y, z), .22, .75, 'naval', 16)
        a = math.radians(bearing)
        fx, fy = math.cos(a), -math.sin(a)          # facing, authoring frame
        px, py = -fy, fx                            # across the tube
        c = Vector((x, y, z + 1.0))
        kit.part('rod', id, masts, 'tube', c - Vector((px, py, 0)) * width / 2, c + Vector((px, py, 0)) * width / 2, .16 if width < 2 else .22, 'naval', vertices=14)
        for s in (-1, 1):
            kit.part('box', id, masts, 'hood', tuple(c + Vector((px, py, 0)) * s * width / 2), (.45, .45, .5), 'naval')
        kit.part('box', id, masts, 'operator shield', tuple(c - Vector((fx, fy, 0)) * .45 + Vector((0, 0, -.1))), (.8, .9, .9), 'naval')

    # ------------------------------------------------------------ high-angle directors on the pagoda wings
    for id, rx, bearing in [('ha-director-port', -6.0, -90), ('ha-director-starboard', 6.03, 90)]:
        x, y, z = P(rx, 15.26, -27.946)
        kit.cylz(id, masts, 'seat', (x, y, z), 1.05, .3, 'naval', 24)
        s = 1 if rx < 0 else -1
        house = [(x + a, y + s * b) for a, b in [(-1.9, -.8), (1.6, -.8), (2.1, -.2), (2.1, 1.25), (-1.9, 1.25)]]
        kit.prism(id, masts, 'housing', house, z + .3, z + 2.5, 'naval', 'roof')
        kit.part('rod', id, masts, 'rangefinder', (x - .2, y - s * .9, z + 2.1), (x - .2, y + s * 1.9, z + 2.1), .15, 'naval', vertices=12)
        for dx in (-1.2, -.4, .4, 1.2):
            kit.part('box', id, masts, 'window', (x + dx, y + s * 1.27, z + 1.8), (.5, .04, .4), 'glass')

    # ------------------------------------------------------------ searchlights
    LIGHTS = [(5.08, 20.75, -27.54), (-5.08, 20.75, -27.54), (2.65, 18.01, -26.29), (-2.65, 18.01, -26.29), (5.9, 12.85, -21.58), (-5.9, 12.85, -21.58),
              (2.8, 14.81, -4.16), (-2.8, 14.81, -4.16), (1.89, 16.88, -13.72), (-1.89, 16.88, -13.72)]
    for i, (rx, ry, rz_) in enumerate(LIGHTS, 1):
        A = f'searchlight-{i}'
        x, y, z = P(rx, ry, rz_)
        kit.cylz(A, masts, 'pedestal', (x, y, z), .22, .55, 'naval', 12)
        kit.part('box', A, masts, 'yoke', (x, y, z + .75), (.25, 1.05, .5), 'naval')
        drum = kit.part('rod', A, masts, 'drum', (x - .45, y, z + 1.15), (x + .4, y, z + 1.15), .55, 'naval', vertices=20)
        kit.part('rod', A, masts, 'glass', (x + .4, y, z + 1.15), (x + .45, y, z + 1.15), .5, 'glass', vertices=20)
        kit.part('rod', A, masts, 'vent', (x - .45, y, z + 1.15), (x - .6, y, z + 1.15), .3, 'naval', vertices=12)

    # ------------------------------------------------------------ boats and their cradles
    F = BoatMaker(kit, boats)
    F.boat('motor-boat-port', (-5.17, 8.8, -12.82), 15.3, 2.95, cabin=True)
    F.boat('motor-boat-starboard', (5.18, 8.8, -12.82), 15.3, 2.95, cabin=True)
    F.boat('launch-port', (-9.34, 6.74, -11.37), 12.4, 3.2, cabin=True)
    F.boat('launch-starboard', (9.35, 6.74, -11.37), 12.4, 3.2, cabin=True)
    F.boat('cutter-1', (-9.61, 6.77, 8.04), 9.2, 2.45)
    F.boat('cutter-2', (9.61, 6.77, 8.04), 9.2, 2.45)
    F.boat('cutter-3', (-9.71, 4.52, 46.46), 9.2, 2.45)
    F.boat('cutter-4', (9.44, 4.52, 46.44), 9.2, 2.45)

    # ------------------------------------------------------------ boat cranes beside the forward funnel
    for id, rx in [('crane-port', -12.9), ('crane-starboard', 12.9)]:
        s = -1 if rx < 0 else 1
        base = P(rx * .74, 4.76, -11.6)
        x, y, z = base
        floor = sup.below(x, y, 8.0)
        kit.cylz(id, boats, 'post', (x, y, floor), .38, 13.6 - floor, 'naval', 18)
        kit.lattice(id, boats, (x, y, 12.8), P(rx, 12.6, -15.7), .5, .55, 6)
        kit.part('rod', id, boats, 'hoist wire', P(rx, 12.6, -15.7), P(rx, 8.2, -15.7), .02, 'edge', vertices=5)
        kit.part('box', id, boats, 'winch house', (x - s * .0, y, floor + .5), (1.4, 1.2, 1.0), 'naval')

    # ------------------------------------------------------------ catapult on the aircraft deck
    A = 'catapult'
    x, y, z = P(0, 6.618, 50.157)
    kit.cylz(A, boats, 'turntable', (x, y, z), 1.8, .35, 'naval', 40)
    kit.cylz(A, boats, 'pivot', (x, y, z + .35), .9, .5, 'edge', 24)
    kit.lattice(A, boats, P(0, 7.55, 57.1), P(0, 7.55, 37.4), 1.1, .9, 16, .07, .04)
    kit.part('box', A, boats, 'launching carriage', P(0, 8.2, 54.6), (2.2, 1.3, .3), 'naval')
    for dz in (-4.0, 4.0):
        kit.part('rod', A, boats, 'support leg', P(0, 7.1, 50.157 + dz), P(0, 6.95, 50.157 + dz * .4), .12, 'naval', vertices=8)

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
    kit.cylz('capstan-aft', deck, 'capstan', P(0, 4.36, 78.28), .5, .6, 'edge', 16)

    # ------------------------------------------------------------ screws, shafts, brackets and rudders
    for id, (rx, ry, rz_), shaft_z in [('screw-1', (-6.72, -5.39, 78.92), 60.0), ('screw-2', (-3.31, -6.49, 86.53), 72.0),
                                       ('screw-3', (3.46, -6.35, 86.53), 72.0), ('screw-4', (6.87, -5.24, 78.92), 60.0)]:
        x, y, z = P(rx, ry, rz_)
        hub = kit.part('rod', id, under, 'hub', (x + .5, y, z), (x - .45, y, z), .36, 'bronze', vertices=16, r2=.22)
        for k in range(3):
            a = k * math.tau / 3 + (.3 if rx < 0 else -.3)
            tip = (x, y + math.cos(a) * 1.62, z + math.sin(a) * 1.62)
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
    for side in (-1, 1):
        pts = []
        for i in range(0, 441):
            st = 1.0 + (L - 3.5) * i / 440
            w, h = edge(st)
            pts.append((st - L / 2, side * max(0, w - .08), h))
        run = []
        for p, q in zip(pts, pts[1:]):
            if abs(p[2] - q[2]) > .35 or abs(p[1] - q[1]) > .8:
                if len(run) > 1:
                    kit.rail('deck-rails', deck, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)
                run = []
                continue
            run.append(p)
        if len(run) > 1:
            kit.rail('deck-rails', deck, [(a, b) for a, b, _ in run], sum(c for _, _, c in run) / len(run), 1.0, 1.6)
    kit.build_wires()


class BoatMaker:
    """Open and cabin boats in simple cradles, bow toward the ship's bow."""

    def __init__(self, kit, col):
        self.kit, self.col = kit, col

    def boat(self, id, ref_base, length, beam, cabin=False):
        kit, col = self.kit, self.col
        rx, ry, rz_ = ref_base
        x, y, z = P(rx, ry, rz_)
        depth = beam * .42
        keel = z + .35
        n = 14
        rings = []
        for i in range(n + 1):
            t = i / n
            u = abs(t - .5) * 2
            w = beam / 2 * (1 - u ** 3 * (.85 if t > .5 else .55))
            d = depth * (1 - .35 * u ** 2)
            rings.append([(x + (t - .5) * length, y + a * w, keel + depth - d * b) for a, b in [(-1, 0), (-.8, .7), (-.35, 1), (.35, 1), (.8, .7), (1, 0)]])
        vv = [p for r in rings for p in r]
        k = 6
        ff = [(j * k + i, j * k + i + 1, (j + 1) * k + i + 1, (j + 1) * k + i) for j in range(n) for i in range(k - 1)]
        ff += [tuple(range(k)), tuple(reversed(range(n * k, n * k + k)))]
        kit.tag(kit.mesh(id + '.hull', vv, ff, 'white', col, True), id)
        kit.part('box', id, col, 'gunwale', (x, y, keel + depth), (length * .96, beam * .98, .08), 'wood')
        if cabin:
            kit.part('box', id, col, 'cabin', (x - length * .06, y, keel + depth + .45), (length * .42, beam * .7, .9), 'white')
            kit.part('box', id, col, 'cabin roof', (x - length * .06, y, keel + depth + .92), (length * .44, beam * .74, .06), 'canvas')
        for dx in (-length * .3, length * .3):
            floor = kit.support.below(x + dx, y, keel)
            kit.part('box', id, col, 'cradle', (x + dx, y, (floor + keel + .15) / 2), (.25, beam * .85, max(.1, keel + .15 - floor)), 'naval')

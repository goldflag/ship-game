"""Shared vocabulary for the Fusō recipe's region modules (adapted from the Kongō recipe's kit).

Positions in the region modules are reference-frame datums read off the approved
GameModels3D pjsb006 B hull (x starboard, y up, z toward the stern, metres), converted
once by `P` to the authoring frame (+X bow, +Y port, +Z up). No reference geometry is loaded.
"""
import math
import bpy
from mathutils import Vector

ZC = -1.095


def P(x, y, z):
    """Reference-frame point -> authoring frame (+X bow, +Y port, +Z up)."""
    return (-(z - ZC), -x, y)


class Kit:
    def __init__(self, D, helpers, materials, collections, support):
        self.D, self.h, self.m, self.cols, self.support = D, helpers, materials, collections, support
        self.mesh, self.cyl, self.rod, self.box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
        self.wires = {}
        self.arcs = []
        for m in D['mounts']:
            w = m['weapon']
            if m['battery'] != 'main' and not m['id'].startswith(('ha-', 'aa25-', 'mg13-', 'casemate-')):
                continue
            mx, my, mz = -m['position'][2], -m['position'][0], m['position'][1]
            if w.get('gunhouseMesh'):
                house = max((v[0] ** 2 + v[1] ** 2) ** .5 for v in w['gunhouseMesh']['vertices']) + .2
            else:
                house = max(w['gunhouseSize'][:2]) * .6
            self.arcs.append((mx, my, mz, house, w))

    def sweep_ceiling(self, x, y):
        """Height a fitting at authoring (x, y) must stay under to clear the gunhouses turning over it and the main
        barrels at full depression (None where no main mount reaches), and whether it stands in a light gun's working
        circle (where it cannot stand at all)."""
        ceiling = None
        for m in self.D['mounts']:
            w = m['weapon']
            mx, my, mz = -m['position'][2], -m['position'][0], m['position'][1]
            d = math.hypot(x - mx, y - my)
            if m['battery'] == 'main':
                house = max((v[0] ** 2 + v[1] ** 2) ** .5 for v in w['gunhouseMesh']['vertices']) + .2 if w.get('gunhouseMesh') else max(w['gunhouseSize'][:2]) * .6
                top = None
                if d < house:
                    top = mz + w.get('gunhouseBaseHeight', 0) - .06
                if d < w['muzzleForward'] + .6:
                    low = mz + w['pivotHeight'] + math.sin(math.radians(w['elevationMinDeg'])) * max(0, d - w['trunnionForward']) - w.get('barrelBaseRadius', .4) - .15
                    top = low if top is None else min(top, low)
                if top is not None:
                    ceiling = top if ceiling is None else min(ceiling, top)
            elif m['id'].startswith(('aa25-', 'ha-')) and d < (3.1 if m['id'].startswith('ha-') else 1.45) and abs(mz - self._last_floor) < 1.0:
                return -1e9
        return ceiling

    _last_floor = 0.0

    def floor(self, x, y, ceiling):
        """Support height under (x, y) below `ceiling`, or None where nothing authored stands there."""
        try:
            return self.support.below(x, y, ceiling)
        except ValueError:
            return None

    def hit(self, origin, direction, distance):
        """First authored surface along a ray: (location, normal), or None."""
        loc, normal, _, _ = self.support.tree.ray_cast(Vector(origin), Vector(direction).normalized(), distance)
        return None if loc is None else (loc, normal)

    # ------------------------------------------------------------ primitives with ownership
    def tag(self, ob, assembly):
        ob['assemblyId'] = assembly
        return ob

    def part(self, kind, assembly, col, label, *args, **kw):
        return self.tag(self.h[kind](assembly + '.' + label, *args, col=col, **kw), assembly)

    def cylz(self, assembly, col, label, center, r, h, material='naval', vertices=24, r2=None):
        """Vertical cylinder from its base centre."""
        x, y, z = center
        return self.part('cyl', assembly, col, label, (x, y, z + h / 2), r, h, material, vertices=vertices, r2=r2)

    def prism(self, assembly, col, label, pts, z0, z1, material='naval', top_material=None, smooth=False):
        """Extrude a closed plan outline [(x, y), ...] (authoring frame) between two heights."""
        n = len(pts)
        vv = [(x, y, z) for z in (z0, z1) for x, y in pts]
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
        order = list(range(n)) if area > 0 else list(reversed(range(n)))
        ff = [tuple(reversed(order)), tuple(i + n for i in order)] + [(order[i], order[(i + 1) % n], order[(i + 1) % n] + n, order[i] + n) for i in range(n)]
        ob = self.tag(self.mesh(assembly + '.' + label, vv, ff, material, col, smooth), assembly)
        if top_material:
            ob.data.materials.append(self.m[top_material])
            ob.data.polygons[1].material_index = 1
        for f in ob.data.polygons[:2]:
            f.use_smooth = False
        return ob

    def stadium(self, half, length, n=32):
        """Plan outline (x along the ship, y across) of a stadium: straight sides with round ends."""
        straight = max(0, length / 2 - half)
        pts = []
        for i in range(n):
            a = i * math.tau / n
            pts.append((math.copysign(straight, math.cos(a)) + half * math.cos(a), half * math.sin(a)))
        return pts

    def ringwall(self, assembly, col, x, y, z, r, height, start=0, end=360, thickness=.07, material='naval'):
        """Open-topped splinter wall with a rolled rim; start/end in degrees about +X."""
        n = max(8, round((end - start) / 8))
        vv = []
        for radius, hh in [(r, 0), (r, height), (r - thickness, height), (r - thickness, 0)]:
            for i in range(n + 1):
                a = math.radians(start + (end - start) * i / n)
                vv.append((x + radius * math.cos(a), y + radius * math.sin(a), z + hh))
        k = n + 1
        ff = [(j * k + i, j * k + i + 1, (j + 1) * k + i + 1, (j + 1) * k + i) for j in range(3) for i in range(n)]
        if end - start < 360:
            ff.extend([(0, k, 2 * k, 3 * k), (n, k + n, 2 * k + n, 3 * k + n)])
        lip = len(vv)
        for radius, hh in [(r + .04, height - .04), (r + .04, height + .025)]:
            for i in range(n + 1):
                a = math.radians(start + (end - start) * i / n)
                vv.append((x + radius * math.cos(a), y + radius * math.sin(a), z + hh))
        ff += [(k + i, k + i + 1, lip + i + 1, lip + i) for i in range(n)]
        ff += [(lip + i, lip + i + 1, lip + k + i + 1, lip + k + i) for i in range(n)]
        ff += [(lip + k + i, lip + k + i + 1, 2 * k + i + 1, 2 * k + i) for i in range(n)]
        return self.tag(self.mesh(assembly + '.splinter wall', vv, ff, material, col), assembly)

    def lattice(self, assembly, col, a, b, w, h, n=None, chord=.06, web=.035):
        a, b = Vector(a), Vector(b)
        d = (b - a)
        length = d.length
        d.normalize()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = Vector((0, 1, 0))
        side.normalize()
        up = side.cross(d).normalized()
        n = n or max(4, int(length / 1.2))
        for s in (-1, 1):
            for u in (-1, 1):
                self.part('rod', assembly, col, 'chord', a + side * s * w / 2 + up * u * h / 2, b + side * s * w / 2 + up * u * h / 2, chord, 'naval', vertices=6)
        for i in range(n):
            p, q = a.lerp(b, i / n), a.lerp(b, (i + 1) / n)
            for s in (-1, 1):
                self.part('rod', assembly, col, 'web', p + side * s * w / 2 - up * h / 2, q + side * s * w / 2 + up * h / 2, web, 'edge', vertices=5)
            self.part('rod', assembly, col, 'tie', p - side * w / 2 + up * h / 2, p + side * w / 2 + up * h / 2, web, 'edge', vertices=5)

    # ------------------------------------------------------------ rails and wires
    def in_arc(self, a, b):
        """Rails stay out of the main, 12.7 cm and light AA barrels' arcs and from under turning gunhouses."""
        for p in (a, b, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)):
            for mx, my, mz, house, w in self.arcs:
                d = math.hypot(p[0] - mx, p[1] - my)
                if d < house and max(a[2], b[2]) > mz - .05:
                    return True
                low = mz + w['pivotHeight'] + math.sin(math.radians(w['elevationMinDeg'])) * max(0, d - w['trunnionForward']) - w.get('barrelBaseRadius', .4) - .15
                if d < w['muzzleForward'] + .6 and max(a[2], b[2]) > low:
                    return True
        return False

    def wire(self, assembly, col, a, b, r=.018, check=True, material='edge', sides=3):
        """A thin member merged per assembly and material: wires (edge, three sides) or painted members."""
        if check and self.in_arc(a, b):
            return
        self.wires.setdefault((assembly, col.name, material), (col, []))[1].append((Vector(a), Vector(b), r, sides))

    def member(self, assembly, col, a, b, r=.04, material='naval', sides=6):
        self.wire(assembly, col, a, b, r, False, material, sides)

    def polyline(self, assembly, col, pts, r=.035, material='naval', sides=6):
        for a, b in zip(pts, pts[1:]):
            self.member(assembly, col, a, b, r, material, sides)

    def ladder(self, assembly, col, a, b, across, width=.42, step=.35, chord=.045, rung=.025, material='naval'):
        """Two chords from a to b, `width` apart along `across`, with rungs every `step`."""
        a, b = Vector(a), Vector(b)
        u = Vector(across).normalized() * (width / 2)
        for s in (-1, 1):
            self.member(assembly, col, a + u * s, b + u * s, chord, material, 6)
        n = max(1, round((b - a).length / step))
        for i in range(1, n):
            p = a.lerp(b, i / n)
            self.member(assembly, col, p - u, p + u, rung, material, 4)

    def xbrace(self, assembly, col, p0, p1, p2, p3, r=.035, material='naval'):
        """Crossed diagonals over the panel p0-p1-p2-p3 (corners in order)."""
        self.member(assembly, col, p0, p2, r, material, 4)
        self.member(assembly, col, p1, p3, r, material, 4)

    def beam(self, assembly, col, label, a, b, width, depth, material='naval', up=(0, 0, 1)):
        """A rectangular girder from a to b: `width` across (horizontal, square to the run) and `depth`
        in the plane of the run and `up`."""
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        w = d.cross(Vector(up)).normalized() * (width / 2)
        h = w.cross(d).normalized() * (depth / 2)
        vv = [tuple(p + w * sw + h * sh) for p in (a, b) for sw, sh in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        ob = self.mesh(assembly + '.' + label, vv, ff, material, col)
        # Outward winding whichever way the run points.
        c = sum((Vector(v) for v in vv), Vector()) / 8
        p0 = ob.data.polygons[2]
        if p0.normal.dot(Vector(p0.center) - c) < 0:
            ob.data.flip_normals()
        return self.tag(ob, assembly)

    def sheave(self, assembly, col, center, axis, r=.25, t=.12, material='black'):
        """A block: a short cylinder across `axis` (the sheave's spindle)."""
        c, a = Vector(center), Vector(axis).normalized() * (t / 2)
        return self.part('rod', assembly, col, 'block', c - a, c + a, r, material, vertices=12)

    def rail(self, assembly, col, pts, z, height=1.0, spacing=1.6, closed=False, check=True):
        """Stanchions and three courses along a polyline of (x, y) points at deck height z."""
        seq = list(pts) + ([pts[0]] if closed else [])
        for (ax, ay), (bx, by) in zip(seq, seq[1:]):
            seg = math.hypot(bx - ax, by - ay)
            if seg < 1e-3:
                continue
            for h in (height * .33, height * .66, height):
                self.wire(assembly, col, (ax, ay, z + h), (bx, by, z + h), .016, check)
            n = max(1, round(seg / spacing))
            for i in range(n + (0 if closed else 1)):
                t = i / n
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                self.wire(assembly, col, (px, py, z), (px, py, z + height), .022, check)

    def build_wires(self):
        for (assembly, _, material), (col, segs) in self.wires.items():
            vv, ff = [], []
            for a, b, r, sides in segs:
                d = b - a
                if d.length < 1e-4:
                    continue
                d.normalize()
                u = d.cross(Vector((0, 0, 1))) if abs(d.z) < .95 else d.cross(Vector((1, 0, 0)))
                u.normalize()
                w = d.cross(u)
                k = len(vv)
                for p in (a, b):
                    for i in range(sides):
                        ang = math.tau * i / sides + (math.pi / sides if sides == 4 else 0)
                        vv.append(tuple(p + (u * math.cos(ang) + w * math.sin(ang)) * r))
                ff += [(k + i, k + (i + 1) % sides, k + sides + (i + 1) % sides, k + sides + i) for i in range(sides)]
            if ff:
                label = '.wires' if material == 'edge' else '.members' if material == 'naval' else '.' + material + ' members'
                self.tag(self.mesh(assembly + label, vv, ff, material, col), assembly)
        self.wires = {}

    # ------------------------------------------------------------ mounts
    def barbette_details(self, mount, floor, top):
        """Bolted top ring and a shallow drip band on the fixed barbette."""
        x, y = -mount['position'][2], -mount['position'][0]
        col = self.cols['Main and secondary batteries']
        self.cylz(mount['id'], col, 'barbette top ring', (x, y, top - .16), 4.72, .12, 'naval', vertices=72)
        if top - floor > 1.2:
            self.cylz(mount['id'], col, 'barbette band', (x, y, floor + .45), 4.68, .1, 'naval', vertices=72)

    def gun_tub(self, mount, floor):
        """Walled tub round an AA or 12.7 cm mount, with a floor and supports down to the structure below."""
        kind = mount['partId']
        x, y, z = -mount['position'][2], -mount['position'][0], mount['position'][1]
        col = self.cols['Light AA'] if kind.startswith(('type96', 'type93')) else self.cols['Main and secondary batteries']
        r, height = (3.05, 1.3) if kind.startswith('type89') else (1.75, 1.2) if kind.startswith('type96') else (1.25, 1.1)
        if .01 < z - floor <= .2:
            # A shallow step: the tub floor itself fills down to the platform.
            self.cylz(mount['id'], col, 'tub floor', (x, y, floor), r, z - floor, 'roof', vertices=36)
        elif z - floor > .2:
            self.cylz(mount['id'], col, 'tub floor', (x, y, z - .16), r, .16, 'roof', vertices=36)
            drop = z - .16 - floor
            if drop > 2.6:
                self.cylz(mount['id'], col, 'tub column', (x, y, floor), r * .45, drop + .02, 'naval', vertices=24)
            elif .02 < drop < 1.0 and kind.startswith('type89'):
                # A low 12.7 cm tub stands on a solid drum down to the deck.
                self.cylz(mount['id'], col, 'tub drum', (x, y, floor), r * .97, drop + .02, 'naval', vertices=36)
            elif drop > .02:
                for a in range(0, 360, 90):
                    ax, ay = math.cos(math.radians(a)), math.sin(math.radians(a))
                    foot = self.support.below(x + ax * r * .45, y + ay * r * .45, z - .17)
                    self.part('rod', mount['id'], col, 'tub knee', (x + ax * r * .9, y + ay * r * .9, z - .16), (x + ax * r * .45, y + ay * r * .45, foot), .08, 'naval', vertices=8)
        # Walls open inboard for access; the outboard side is closed.
        outboard = math.degrees(math.atan2(y, 0.001)) if abs(y) > .5 else (0 if mount['bearingDeg'] == 0 else 180)
        span = 300 if kind.startswith('type89') else 280
        start = outboard - span / 2
        self.ringwall(mount['id'], col, x, y, z, r, height, start, start + span)

    # ------------------------------------------------------------ boats
    def boat_hull(self, name, col, x, y, keel, length, beam, depth, outer='white', inner='wood', bow=1, transom=.55,
                  rise=.4, sheer=(.3, .1), well=0.0, stations=18):
        """Round-bilge hull along authoring X centred at (x, y) with its keel at `keel`; bow=+1 puts the stem
        toward +X, -1 toward -X. well > 0 leaves an open boat: inner walls and a floor `well` below the gunwale.
        Returns the object and station(t) -> (x, half-breadth, keel, gunwale), t 0 at the transom and 1 at the stem."""
        def station(t):
            if t < .45:
                w = beam / 2 * (1 - (1 - transom) * ((.45 - t) / .45) ** 2)
            else:
                w = beam / 2 * max(.03, 1 - ((t - .45) / .55) ** 2.2)
            k = keel + depth * rise * max(0, (t - .7) / .3) ** 2 + depth * .12 * max(0, (.1 - t) / .1)
            g = keel + depth + sheer[0] * max(0, (t - .55) / .45) ** 2 + sheer[1] * max(0, (.35 - t) / .35) ** 2
            return x + bow * (t - .5) * length, w, k, g
        loops = []
        for i in range(stations + 1):
            px, w, k, g = station(i / stations)
            side = []
            for phi in (90, 68, 46, 26, 10):
                c, sn = math.cos(math.radians(phi)), math.sin(math.radians(phi))
                side.append((sn ** .6 * w, k + (g - k) * (1 - c ** .75)))
            # Starboard gunwale, round the keel, port gunwale; then the open boat's inner walls and floor.
            loop = [(px, y - a, b) for a, b in side] + [(px, y, k)] + [(px, y + a, b) for a, b in reversed(side)]
            if well > 0:
                wi = max(.01, w - .07)
                floor = max(k + .05, g - well)
                loop += [(px, y + wi, g), (px, y + wi, floor), (px, y - wi, floor), (px, y - wi, g)]
            loops.append(loop)
        n = len(loops[0])
        vv = [p for loop in loops for p in loop]
        ff, inside = [], []
        for i in range(stations):
            for j in range(n):
                a, b = i * n + j, i * n + (j + 1) % n
                if j >= 10:
                    inside.append(len(ff))
                ff.append((a, b, b + n, a + n))
        ff += [tuple(reversed(range(n))), tuple(range(stations * n, stations * n + n))]
        if bow < 0:
            ff = [tuple(reversed(f)) for f in ff]
        ob = self.mesh(name, vv, ff, outer, col, True)
        ob.data.materials.append(self.m[inner])
        for i in inside:
            ob.data.polygons[i].material_index = 1
        for i in inside + [len(ff) - 2, len(ff) - 1]:
            ob.data.polygons[i].use_smooth = False
        return ob, station

    def cradles(self, id, col, station, y, ts, width):
        """Keel chocks from the supporting deck up under the hull at stations ts."""
        for t in ts:
            px, w, k, g = station(t)
            floor = self.support.below(px, y, k - .02)
            self.part('box', id, col, 'cradle', (px, y, (floor + k + .12) / 2), (.14, width, max(.08, k + .12 - floor)), 'naval')

    def gunwale_band(self, id, col, station, y, material='naval', r=.045, drop=0.0):
        for s in (-1, 1):
            pts = [(px, y + s * max(.01, w - .01), g - drop) for px, w, k, g in (station(i / 16) for i in range(17))]
            self.polyline(id, col, pts, r, material, 5)

    def motor_boat(self, id, ref_center, length, beam, keel_y, col=None, chocks=(.28, .44, .63, .85), wheelhouse=1.2, mast=True):
        """Decked 15 m motor boat: grey hull, wood deck, forward trunk, wheelhouse and after cabin with windows.
        ref_center: reference (centre x, centre z); the keel rests at keel_y."""
        col = col or self.cols['Boats and aviation']
        x, y, _ = P(ref_center[0], 0, ref_center[1])
        hull, st = self.boat_hull(id + '.hull', col, x, y, keel_y, length, beam, 2.2, 'naval', 'wood', 1, .72, .45, (.25, .05))
        self.tag(hull, id)
        self.gunwale_band(id, col, st, y, 'naval', .05)
        self.cradles(id, col, st, y, chocks, .95)
        g = st(.5)[3]
        for label, t0, t1, width, height in [('forward trunk', .62, .84, 1.9, .45), ('wheelhouse', .47, .54, 1.6, wheelhouse), ('after cabin', .2, .43, 2.2, .85)]:
            a, b = st(t0)[0], st(t1)[0]
            deck = min(st(t0)[3], st(t1)[3])
            self.part('box', id, col, label, ((a + b) / 2, y, deck + height / 2 - .02), (abs(b - a), width, height + .04), 'naval')
            self.part('box', id, col, label + ' roof', ((a + b) / 2, y, deck + height + .02), (abs(b - a) + .1, width + .1, .05), 'roof')
        wx = st(.54)[0]
        self.part('box', id, col, 'wheelhouse glass', (wx + .01, y, g + wheelhouse - .25), (.03, 1.4, .32), 'glass')
        for s in (-1, 1):
            for i in range(4):
                px = st(.23 + i * .055)[0]
                self.part('box', id, col, 'cabin glass', (px, y + s * 1.11, g + .55), (.4, .03, .26), 'glass')
            for i in range(3):
                px = st(.65 + i * .07)[0]
                self.part('rod', id, col, 'trunk port', (px, y + s * .94, g + .25), (px, y + s * .97, g + .25), .09, 'glass', vertices=10)
        if mast:
            self.part('rod', id, col, 'mast', (st(.47)[0], y, g + wheelhouse), (st(.47)[0], y, g + 2.0), .04, 'naval', vertices=6)
            self.part('rod', id, col, 'ensign staff', (st(.01)[0], y, g), (st(.01)[0], y, g + 1.7), .03, 'naval', vertices=6)

    def covered_launch(self, id, ref_center, length, beam, keel_y, col=None, chocks=(.19, .39, .63, .85), hood='canvas'):
        """12 m motor launch under a canvas hood (or a varnished cabin top) with a row of windows each side."""
        col = col or self.cols['Boats and aviation']
        x, y, _ = P(ref_center[0], 0, ref_center[1])
        hull, st = self.boat_hull(id + '.hull', col, x, y, keel_y, length, beam, 1.42, 'naval', 'wood', 1, .72, .35, (.4, .05))
        self.tag(hull, id)
        self.gunwale_band(id, col, st, y, 'naval', .05)
        self.cradles(id, col, st, y, chocks, 1.0)
        # Canvas hood: a round-topped tunnel between the stern sheets and the fore deck.
        rings = []
        m = 12
        for i in range(m + 1):
            t = .11 + (.89 - .11) * i / m
            px, w, k, g = st(t)
            end = 1 - .55 * max(0, abs(i - m / 2) / (m / 2) - .75) / .25
            wc, hc = (w - .14) * (end ** .5), 1.05 * end
            prof = [(-1, 0), (-1, .62), (-.82, .9), (-.42, 1), (.42, 1), (.82, .9), (1, .62), (1, 0)]
            rings.append([(px, y + a * wc, g - .02 + b * hc) for a, b in prof])
        k = len(rings[0])
        vv = [p for r in rings for p in r]
        ff = [(i * k + j + 1, i * k + j, (i + 1) * k + j, (i + 1) * k + j + 1) for i in range(m) for j in range(k - 1)]
        ff += [tuple(range(k)), tuple(reversed(range(m * k, m * k + k)))]
        self.tag(self.mesh(id + '.hood', vv, ff, hood, col, True), id)
        for s in (-1, 1):
            for i in range(6):
                px, w, k_, g = st(.2 + i * .115)
                self.part('box', id, col, 'hood window', (px, y + s * (w - .13), g + .6), (.42, .03, .2), 'glass')

    def open_boat(self, id, ref_center, length, beam, keel_y, depth, col=None, bow=1, outer='white', inner='wood',
                  chocks=(.22, .5, .78), band='naval'):
        """Pulling boat or cutter: open hull with thwarts and stowed oars."""
        col = col or self.cols['Boats and aviation']
        x, y, _ = P(ref_center[0], 0, ref_center[1])
        hull, st = self.boat_hull(id + '.hull', col, x, y, keel_y, length, beam, depth, outer, inner, bow, .5, .32, (.28, .12), .55)
        self.tag(hull, id)
        self.gunwale_band(id, col, st, y, band, .04)
        for t in (.26, .4, .54, .68):
            px, w, k, g = st(t)
            self.part('box', id, col, 'thwart', (px, y, g - .26), (.22, 2 * (w - .07), .05), 'wood')
        for s in (-1, 1):
            a, b = st(.18), st(.8)
            self.part('rod', id, col, 'oar', (a[0], y + s * .35, a[3] - .26), (b[0], y + s * .35, b[3] - .26), .035, 'wood', vertices=6)
        if chocks:
            self.cradles(id, col, st, y, chocks, .9)
        return st

    def searchlight(self, id, ref, col=None):
        """Searchlight on a pedestal and yoke at a reference datum (pedestal foot)."""
        col = col or self.cols['Sensors and masts']
        x, y, z = P(*ref)
        # The pedestal stands on whatever platform lies under the measured datum.
        floor = self.support.below(x, y, z + .05)
        floor = floor if z - floor < 1.0 else z
        self.cylz(id, col, 'pedestal', (x, y, floor), .22, z + .55 - floor, 'naval', 12)
        self.part('box', id, col, 'yoke', (x, y, z + .75), (.25, 1.05, .5), 'naval')
        self.part('rod', id, col, 'drum', (x - .45, y, z + 1.15), (x + .4, y, z + 1.15), .55, 'naval', vertices=20)
        self.part('rod', id, col, 'glass', (x + .4, y, z + 1.15), (x + .45, y, z + 1.15), .5, 'glass', vertices=20)
        self.part('rod', id, col, 'vent', (x - .45, y, z + 1.15), (x - .6, y, z + 1.15), .3, 'naval', vertices=12)

    def rangefinder(self, id, ref, width, bearing, col=None):
        """Open rangefinder on a pedestal with end hoods and an operator shield; bearing 0 faces the bow."""
        col = col or self.cols['Sensors and masts']
        x, y, z = P(*ref)
        self.cylz(id, col, 'pedestal', (x, y, z), .22, .75, 'naval', 16)
        a = math.radians(bearing)
        fx, fy = math.cos(a), -math.sin(a)
        px, py = -fy, fx
        c = Vector((x, y, z + 1.0))
        self.part('rod', id, col, 'tube', c - Vector((px, py, 0)) * width / 2, c + Vector((px, py, 0)) * width / 2, .16 if width < 2 else .22, 'naval', vertices=14)
        for s in (-1, 1):
            self.part('box', id, col, 'hood', tuple(c + Vector((px, py, 0)) * s * width / 2), (.45, .45, .5), 'naval')
        self.part('box', id, col, 'operator shield', tuple(c - Vector((fx, fy, 0)) * .45 + Vector((0, 0, -.1))), (.8, .9, .9), 'naval')

    # ------------------------------------------------------------ measured windows, roof rails and knees
    def windows(self, assembly, col, rows, zone=None):
        """Dark glass panes and rimmed portholes from a measured table (runtime frame rows:
        kind, x, y, z, width, height, normal x, normal z), merged into two meshes per assembly."""
        panes, rims = ([], []), ([], [])

        def quad(buf, c, u, w, h, d):
            vv, ff = buf
            k = len(vv)
            for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                p = c + u * (a * w / 2) + Vector((0, 0, b * h / 2)) + d
                vv.append(tuple(p))
            ff.append((k, k + 1, k + 2, k + 3))

        def disc(buf, c, u, n, r, sides=12):
            vv, ff = buf
            k = len(vv)
            vv.append(tuple(c))
            for i in range(sides):
                a = math.tau * i / sides
                vv.append(tuple(c + u * (r * math.cos(a)) + Vector((0, 0, r * math.sin(a)))))
            ff += [(k, k + 1 + i, k + 1 + (i + 1) % sides) for i in range(sides)]

        for kind, x, y, z, w, h, nx, nz in rows:
            if zone and not zone(x, y, z):
                continue
            c = Vector((-z, -x, y))
            n = Vector((-nz, -nx, 0))          # outward normal, authoring frame
            u = Vector((0, 0, 1)).cross(n).normalized()
            if kind == 'port':
                r = min(w, h) / 2
                disc(rims, c + n * .012, u, n, r + .06, 14)
                disc(panes, c + n * .02, u, n, r * .92, 12)
            else:
                quad(rims, c, u, w + .08, h + .08, n * .012)
                quad(panes, c, u, w, h, n * .02)
        for (vv, ff), material, label in [(rims, 'painted-edge', 'window frames'), (panes, 'glass', 'window glass')]:
            if ff:
                self.tag(self.mesh(assembly + '.' + label, vv, ff, material, col), assembly)

    @staticmethod
    def _inside(poly, x, z):
        c = False
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
                c = not c
        return c

    @staticmethod
    def _nearest(poly, x, z):
        """Nearest point on a polygon outline and its distance (plan, runtime x/z)."""
        best = (1e9, x, z)
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            dx, dz = bx - ax, bz - az
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / max(1e-12, dx * dx + dz * dz)))
            px, pz = ax + t * dx, az + t * dz
            d = math.hypot(x - px, z - pz)
            if d < best[0]:
                best = (d, px, pz)
        return best

    def _samples(self, poly, step):
        """Points round a closed outline every ~step metres, with the inward normal at each."""
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))
        turn = 1 if area > 0 else -1
        out = []
        for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
            L = math.hypot(bx - ax, bz - az)
            if L < 1e-6:
                continue
            nx, nz = -(bz - az) / L * turn, (bx - ax) / L * turn
            n = max(1, int(L / step))
            for i in range(n):
                t = i / n
                out.append((ax + (bx - ax) * t, az + (bz - az) * t, nx, nz, i == 0))
        return out

    @staticmethod
    def _corners(pts, degrees=8):
        """Keep a polyline's ends and the points where it turns."""
        if len(pts) < 3:
            return pts
        out = [pts[0]]
        for a, b, c in zip(pts, pts[1:], pts[2:]):
            u = (b[0] - a[0], b[1] - a[1]); v = (c[0] - b[0], c[1] - b[1])
            lu, lv = math.hypot(*u), math.hypot(*v)
            if lu < 1e-9 or lv < 1e-9:
                continue
            if (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < math.cos(math.radians(degrees)):
                out.append(b)
        out.append(pts[-1])
        return out

    def roof_rails(self, assembly, col, structures, zone, height=1.0, inset=.08, clearance=.3):
        """Rails round every exposed roof edge of the structures inside a zone (zone(x, y, z), runtime frame)."""
        for s in structures:
            poly = [tuple(p) for p in s['footprint']]
            xs = [p[0] for p in poly]
            zs = [p[1] for p in poly]
            top = s['baseY'] + s['height']
            if not zone((min(xs) + max(xs)) / 2, top, (min(zs) + max(zs)) / 2):
                continue
            above = [[tuple(p) for p in o['footprint']] for o in structures if o is not s and top - .06 <= o['baseY'] <= top + .35]
            samples = self._samples(poly, .25)
            flags = [not any(self._inside(a, x, z) or self._nearest(a, x, z)[0] < clearance for a in above) for x, z, _, _, _ in samples]
            if not samples:
                continue
            if all(flags):
                pts = self._corners([(x + nx * inset, z + nz * inset) for x, z, nx, nz, _ in samples])
                self.rail(assembly, col, [(-z_, -x_) for x_, z_ in pts], top, height, 1.4, closed=True)
                continue
            # Start at an exposed sample that follows a covered one so runs do not wrap.
            k0 = next(i for i in range(len(flags)) if flags[i] and not flags[i - 1]) if any(flags) else 0
            run = []
            for j in range(len(samples) + 1):
                i = (k0 + j) % len(samples)
                if j < len(samples) and flags[i]:
                    x, z, nx, nz, _ = samples[i]
                    run.append((x + nx * inset, z + nz * inset))
                    continue
                if len(run) > 2:
                    self.rail(assembly, col, [(-z_, -x_) for x_, z_ in self._corners(run)], top, height, 1.4)
                run = []

    def overhang_knees(self, assembly, col, structures, zone, spacing=2.0, min_overhang=.5):
        """Triangular knee brackets under the overhanging edges of structures inside a zone."""
        for s in structures:
            poly = [tuple(p) for p in s['footprint']]
            xs = [p[0] for p in poly]
            zs = [p[1] for p in poly]
            if not zone((min(xs) + max(xs)) / 2, s['baseY'], (min(zs) + max(zs)) / 2) or s['baseY'] < 7.2:
                continue
            below = [[tuple(p) for p in o['footprint']] for o in structures if o is not s and abs(o['baseY'] + o['height'] - s['baseY']) < .06]
            if not below:
                continue
            for x, z, nx, nz, corner in self._samples(poly, spacing):
                if any(self._inside(b, x, z) for b in below):
                    continue
                d, fx, fz = min(self._nearest(b, x, z) for b in below)
                if d < min_overhang or d > 2.2:
                    continue
                a = Vector((-z, -x, s['baseY'] - .01))
                b = Vector((-fz, -fx, s['baseY'] - .01))
                c = Vector((-fz, -fx, s['baseY'] - min(.6, d * .7)))
                side = (a - b).cross(Vector((0, 0, 1)))
                if side.length < 1e-6:
                    continue
                side = side.normalized() * .03
                vv = [tuple(p + side * sgn) for sgn in (-1, 1) for p in (a, b, c)]
                ff = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
                self.tag(self.mesh(assembly + '.knee', vv, ff, 'naval', col), assembly)

"""Shared vocabulary for the Nagato recipe: materials, primitives with ownership, merged wires, boats and optics.

Fitting positions in the recipe modules are reference-frame datums read off the approved GameModels3D pjsb010
B hull (x starboard, y up, z toward the stern, metres), converted once by `P` to the authoring frame (+X bow,
+Y port, +Z up). No reference geometry is loaded.
"""
import math
import bpy
import bmesh
from mathutils import Vector

ZC = -2.2  # runtime z = reference z - ZC
# The linoleum aircraft deck on the forecastle deck (runtime z from, z to, half breadth), read off the textured top render.
LINO = (20.5, 47.3, 11.0)


def P(x, y, z):
    """Reference-frame point -> authoring frame (+X bow, +Y port, +Z up)."""
    return (-(z - ZC), -x, y)


def R(p):
    """Runtime-frame point [x, y, z] -> authoring frame."""
    return (-p[2], -p[0], p[1])


# Linear-RGB interpretations of the reference's texture swatches; appearance.json binds the named paints.
COLORS = {'naval': (.112, .118, .137), 'hullgray': (.112, .118, .137), 'roof': (.094, .098, .113), 'deck': (.100, .076, .054),
          'linoleum': (.072, .040, .031), 'antifouling': (.105, .050, .039), 'black': (.012, .012, .013), 'edge': (.038, .038, .040),
          'painted-edge': (.088, .093, .108), 'dark': (.012, .013, .014), 'glass': (.02, .04, .05), 'canvas': (.55, .53, .44),
          'wood': (.19, .13, .075), 'white': (.42, .43, .42), 'bronze': (.36, .27, .12), 'gold': (.62, .45, .12), 'red': (.40, .03, .02)}

# Twelve 25 mm singles the blueprint cannot hold as mounts (64 at most): the forecastle-head and quarterdeck
# groups (HP_JGA 1-5, 7 and 38-43), drawn with the same catalog recipe as fixed fittings at their rest bearing.
FIXED_SINGLES = [(-5.463, 7.067, -89.792, -45), (5.463, 7.067, -89.792, 45), (-6.228, 6.947, -85.941, -45), (6.228, 6.947, -85.941, 45),
                 (-7.107, 6.866, -82.890, -45), (7.488, 6.867, -82.884, 45), (-5.440, 4.322, 86.103, -135), (5.391, 4.310, 86.098, 135),
                 (-4.939, 4.340, 88.791, -135), (4.890, 4.337, 88.787, 135), (-4.459, 4.352, 91.373, -135), (4.410, 4.383, 91.368, 135)]


class Kit:
    def __init__(self, D, collection_names):
        self.D = D
        self.support = None
        scene = bpy.context.scene
        self.collections = {}
        for name in collection_names:
            col = bpy.data.collections.new(name)
            scene.collection.children.link(col)
            self.collections[name] = col
        self.materials = {}
        for key, color in COLORS.items():
            m = bpy.data.materials.new('Nagato ' + key)
            m.diffuse_color = (*color, 1)
            m.use_nodes = True
            p = m.node_tree.nodes.get('Principled BSDF')
            p.inputs['Base Color'].default_value = (*color, 1)
            p.inputs['Roughness'].default_value = .76
            p.inputs['Metallic'].default_value = .05
            self.materials[key] = m
        self.helpers = dict(mesh=self.mesh, cyl=self.cyl, rod=self.rod, box=self.box)
        self.wires = {}
        self.arcs = []
        for m in D['mounts']:
            w = m['weapon']
            mx, my, mz = R(m['position'])
            if w.get('gunhouseMesh'):
                house = max((v[0] ** 2 + v[1] ** 2) ** .5 for v in w['gunhouseMesh']['vertices']) + .2
            else:
                house = max(w['gunhouseSize'][:2]) * .55
            self.arcs.append((mx, my, mz, house, w, m))

    # ------------------------------------------------------------ basic primitives (template helpers)
    def mat(self, value):
        return self.materials[value] if isinstance(value, str) else value

    def mesh(self, name, vertices, faces, material=None, col=None, smooth=False):
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], faces)
        data.update()
        ob = bpy.data.objects.new(name, data)
        (col or self.collections['Hull and decks']).objects.link(ob)
        if material is not None:
            data.materials.append(self.mat(material))
        for poly in data.polygons:
            poly.use_smooth = smooth
        return ob

    def cyl(self, name, loc, radius, depth, material='naval', col=None, vertices=24, r2=None):
        r2 = radius if r2 is None else r2
        depth = max(.002, depth)
        vv = [(r * math.cos(math.tau * i / vertices), r * math.sin(math.tau * i / vertices), z) for r, z in [(radius, -depth / 2), (r2, depth / 2)] for i in range(vertices)]
        ff = [tuple(reversed(range(vertices))), tuple(range(vertices, 2 * vertices))] + [(i, (i + 1) % vertices, (i + 1) % vertices + vertices, i + vertices) for i in range(vertices)]
        ob = self.mesh(name, vv, ff, material, col, True)
        ob.location = loc
        ob.data.polygons[0].use_smooth = False
        ob.data.polygons[1].use_smooth = False
        return ob

    def rod(self, name, a, b, r, material='edge', col=None, r2=None, vertices=10):
        a, b = Vector(a), Vector(b)
        ob = self.cyl(name, (a + b) / 2, r, (b - a).length, material, col, vertices, r2)
        ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
        return ob

    def box(self, name, loc, dim, material='naval', col=None, bev=0):
        dx, dy, dz = [v / 2 for v in dim]
        vv = [(sx * dx, sy * dy, sz * dz) for sx, sy, sz in [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1)]]
        ob = self.mesh(name, vv, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material, col)
        ob.location = loc
        return ob

    # ------------------------------------------------------------ primitives with ownership
    def tag(self, ob, assembly):
        ob['assemblyId'] = assembly
        return ob

    def part(self, kind, assembly, col, label, *args, **kw):
        return self.tag(self.helpers[kind](assembly + '.' + label, *args, col=col, **kw), assembly)

    def cylz(self, assembly, col, label, center, r, h, material='naval', vertices=24, r2=None):
        """Vertical cylinder from its base centre (authoring frame)."""
        x, y, z = center
        return self.part('cyl', assembly, col, label, (x, y, z + h / 2), r, h, material, vertices=vertices, r2=r2)

    def boxc(self, assembly, col, label, center, size, material='naval', yaw=0.0):
        """Box from its centre in the authoring frame, size (along x, along y, up)."""
        ob = self.part('box', assembly, col, label, center, size, material)
        ob.rotation_euler.z = yaw
        return ob

    def prism(self, assembly, col, label, pts, z0, z1, material='naval', top_material=None, smooth=False):
        """Extrude a closed plan outline [(x, y), ...] (authoring frame) between two heights."""
        n = len(pts)
        vv = [(x, y, z) for z in (z0, z1) for x, y in pts]
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))
        order = list(range(n)) if area > 0 else list(reversed(range(n)))
        ff = [tuple(reversed(order)), tuple(i + n for i in order)] + [(order[i], order[(i + 1) % n], order[(i + 1) % n] + n, order[i] + n) for i in range(n)]
        ob = self.tag(self.mesh(assembly + '.' + label, vv, ff, material, col, smooth), assembly)
        if top_material:
            ob.data.materials.append(self.materials[top_material])
            ob.data.polygons[1].material_index = 1
        for f in ob.data.polygons[:2]:
            f.use_smooth = False
        return ob

    def loft(self, assembly, col, label, rings, material='naval', cap_bottom=True, cap_top=True, smooth=True, top_material=None):
        """Loft closed rings of equal point count [(x, y, z), ...] (authoring frame), bottom to top."""
        n = len(rings[0])
        vv = [tuple(p) for ring in rings for p in ring]
        ff = []
        for j in range(len(rings) - 1):
            for i in range(n):
                ff.append((j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i))
        caps = []
        if cap_bottom:
            ff.append(tuple(reversed(range(n))))
            caps.append(len(ff) - 1)
        if cap_top:
            ff.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
            caps.append(len(ff) - 1)
        ob = self.tag(self.mesh(assembly + '.' + label, vv, ff, material, col, smooth), assembly)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(ob.data)
        bm.free()
        if top_material and cap_top:
            ob.data.materials.append(self.materials[top_material])
            ob.data.polygons[caps[-1]].material_index = 1
        for i in caps:
            ob.data.polygons[i].use_smooth = False
        return ob

    def ring(self, n, r, center=(0, 0, 0), rx=None, phase=0.0):
        cx, cy, cz = center
        rx = r if rx is None else rx
        return [(cx + rx * math.cos(phase + math.tau * i / n), cy + r * math.sin(phase + math.tau * i / n), cz) for i in range(n)]

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
        else:
            ff.extend([(j * k + n, j * k, (j + 1) * k, (j + 1) * k + n) for j in range(3)])
        return self.tag(self.mesh(assembly + '.splinter wall', vv, ff, material, col), assembly)

    def empty(self, node_id, loc, parent=None, assembly=None, col=None):
        o = bpy.data.objects.new(node_id, None)
        (col or self.collections['Sensors and masts']).objects.link(o)
        o.location = loc
        o.parent = parent
        o['nodeId'] = node_id
        o['assemblyId'] = assembly or node_id.rsplit('.', 1)[0]
        return o

    # ------------------------------------------------------------ supports
    def below(self, x, y, z, fallback=None):
        try:
            return self.support.below(x, y, z)
        except ValueError:
            if fallback is None:
                raise
            return fallback

    def above(self, x, y, z, reach=3.0, fallback=None):
        """Height of the first structure surface over (x, y) above z (a platform's underside), within reach."""
        try:
            return self.support.along((x, y, z), (0, 0, 1), reach).z
        except ValueError:
            if fallback is None:
                raise
            return fallback

    def toward(self, origin, direction, reach, fallback=None):
        """First structure surface from an authoring point along a direction, within reach."""
        try:
            return self.support.along(origin, direction, reach)
        except ValueError:
            if fallback is None:
                raise
            return Vector(fallback)

    # ------------------------------------------------------------ rails and wires
    def in_arc(self, a, b):
        """Rails stay out of the gun arcs and from under turning gunhouses."""
        for p in (a, b, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)):
            for mx, my, mz, house, w, m in self.arcs:
                d = math.hypot(p[0] - mx, p[1] - my)
                if d < house and max(a[2], b[2]) > mz - .05:
                    return True
                low = mz + w['pivotHeight'] + math.sin(math.radians(w['elevationMinDeg'])) * max(0, d - w['trunnionForward']) - w.get('barrelBaseRadius', .4) - .15
                if d < w['muzzleForward'] + .6 and max(a[2], b[2]) > low:
                    return True
        return False

    def wire(self, assembly, col, a, b, r=.018, check=True, material='edge', sides=3):
        """A thin member merged per assembly and material."""
        if check and self.in_arc(a, b):
            return
        self.wires.setdefault((assembly, col.name, material), (col, []))[1].append((Vector(a), Vector(b), r, sides))

    def member(self, assembly, col, a, b, r=.04, material='naval', sides=6):
        self.wire(assembly, col, a, b, r, False, material, sides)

    def polyline(self, assembly, col, pts, r=.035, material='naval', sides=6):
        for a, b in zip(pts, pts[1:]):
            self.member(assembly, col, a, b, r, material, sides)

    def ladder(self, assembly, col, a, b, across, width=.42, step=.35, chord=.045, rung=.025, material='naval'):
        a, b = Vector(a), Vector(b)
        u = Vector(across).normalized() * (width / 2)
        for s in (-1, 1):
            self.member(assembly, col, a + u * s, b + u * s, chord, material, 6)
        n = max(1, round((b - a).length / step))
        for i in range(1, n):
            p = a.lerp(b, i / n)
            self.member(assembly, col, p - u, p + u, rung, material, 4)

    def beam(self, assembly, col, label, a, b, width, depth, material='naval', up=(0, 0, 1)):
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        w = d.cross(Vector(up))
        if w.length < 1e-6:
            w = Vector((0, 1, 0))
        w = w.normalized() * (width / 2)
        h = w.cross(d).normalized() * (depth / 2)
        vv = [tuple(p + w * sw + h * sh) for p in (a, b) for sw, sh in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        ff = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        ob = self.mesh(assembly + '.' + label, vv, ff, material, col)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(ob.data)
        bm.free()
        return self.tag(ob, assembly)

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
                self.member(assembly, col, a + side * s * w / 2 + up * u * h / 2, b + side * s * w / 2 + up * u * h / 2, chord, 'naval', 6)
        for i in range(n):
            p, q = a.lerp(b, i / n), a.lerp(b, (i + 1) / n)
            for s in (-1, 1):
                self.member(assembly, col, p + side * s * w / 2 - up * h / 2, q + side * s * w / 2 + up * h / 2, web, 'naval', 5)
            self.member(assembly, col, p - side * w / 2 + up * h / 2, p + side * w / 2 + up * h / 2, web, 'naval', 5)
            self.member(assembly, col, p - side * w / 2 - up * h / 2, p + side * w / 2 - up * h / 2, web, 'naval', 5)

    def rail(self, assembly, col, pts, z, height=1.0, spacing=1.6, closed=False, check=True):
        """Stanchions and two courses along a polyline of (x, y) points at deck height z."""
        seq = list(pts) + ([pts[0]] if closed else [])
        for (ax, ay), (bx, by) in zip(seq, seq[1:]):
            seg = math.hypot(bx - ax, by - ay)
            if seg < 1e-3:
                continue
            for h in (height * .5, height):
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
                q = d.to_track_quat('Z', 'Y')
                base = len(vv)
                for p in (a, b):
                    for k in range(sides):
                        ang = math.tau * k / sides
                        vv.append(tuple(p + q @ Vector((r * math.cos(ang), r * math.sin(ang), 0))))
                for k in range(sides):
                    k2 = (k + 1) % sides
                    ff.append((base + k, base + k2, base + sides + k2, base + sides + k))
                ff.append(tuple(base + k for k in reversed(range(sides))))
                ff.append(tuple(base + sides + k for k in range(sides)))
            if vv:
                label = ' wires' if material == 'edge' else ' members' if material == 'naval' else ' ' + material + ' members'
                ob = self.mesh(assembly + label, vv, ff, material, col)
                self.tag(ob, assembly)
        self.wires = {}

    # ------------------------------------------------------------ boats
    def boat_hull(self, name, col, x, y, keel, length, beam, depth, outer='white', inner='wood', bow=1, transom=.55,
                  rise=.4, sheer=(.3, .1), well=0.0, stations=18):
        """Round-bilge hull along authoring X centred at (x, y) with its keel at `keel`; bow=+1 puts the stem toward
        +X. well > 0 leaves an open boat. Returns the object and station(t) -> (x, half-breadth, keel, gunwale)."""
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
        ob.data.materials.append(self.materials[inner])
        for i in inside:
            ob.data.polygons[i].material_index = 1
        for i in inside + [len(ff) - 2, len(ff) - 1]:
            ob.data.polygons[i].use_smooth = False
        return ob, station

    def cradles(self, id, col, station, y, ts, width, floor=None):
        """Keel chocks from the supporting deck up under the hull at stations ts."""
        for t in ts:
            px, w, k, g = station(t)
            base = floor if floor is not None else self.below(px, y, k - .02, k - .6)
            self.boxc(id, col, 'cradle', (px, y, (base + k + .12) / 2), (.16, width, max(.08, k + .12 - base)), 'naval')

    def gunwale_band(self, id, col, station, y, material='naval', r=.045, drop=0.0):
        for s in (-1, 1):
            pts = [(px, y + s * max(.01, w - .01), g - drop) for px, w, k, g in (station(i / 16) for i in range(17))]
            self.polyline(id, col, pts, r, material, 5)

    def motor_boat(self, id, x, y, keel_y, length, beam, depth=2.2, col=None, chocks=(.28, .44, .63, .85), floor=None, bow=1):
        """Decked motor boat: hull, wood deck, forward trunk, wheelhouse and after cabin with windows."""
        col = col or self.collections['Boats and aviation']
        hull, st = self.boat_hull(id + '.hull', col, x, y, keel_y, length, beam, depth, 'white', 'wood', bow, .72, .45, (.25, .05))
        self.tag(hull, id)
        self.gunwale_band(id, col, st, y, 'naval', .05)
        if chocks:
            self.cradles(id, col, st, y, chocks, .95, floor)
        g = st(.5)[3]
        for label, t0, t1, width, height in [('forward trunk', .62, .84, beam * .6, .45), ('wheelhouse', .47, .54, beam * .52, 1.2), ('after cabin', .2, .43, beam * .72, .85)]:
            a, b = st(t0)[0], st(t1)[0]
            deck = min(st(t0)[3], st(t1)[3])
            self.boxc(id, col, label, ((a + b) / 2, y, deck + height / 2 - .02), (abs(b - a), width, height + .04), 'white')
            self.boxc(id, col, label + ' roof', ((a + b) / 2, y, deck + height + .02), (abs(b - a) + .1, width + .1, .05), 'roof')
        wx = st(.54)[0]
        self.boxc(id, col, 'wheelhouse glass', (wx + .01 * bow, y, g + .95), (.03, beam * .45, .32), 'glass')
        for s in (-1, 1):
            for i in range(4):
                px = st(.23 + i * .055)[0]
                self.boxc(id, col, 'cabin glass', (px, y + s * (beam * .36 + .01), g + .55), (.4, .03, .26), 'glass')
        self.part('rod', id, col, 'mast', (st(.47)[0], y, g + 1.2), (st(.47)[0], y, g + 2.0), .04, 'naval', vertices=6)
        return st

    def open_boat(self, id, x, y, keel_y, length, beam, depth, col=None, bow=1, outer='white', inner='wood', chocks=(.22, .5, .78), floor=None):
        """Pulling boat or cutter: open hull with thwarts and stowed oars."""
        col = col or self.collections['Boats and aviation']
        hull, st = self.boat_hull(id + '.hull', col, x, y, keel_y, length, beam, depth, outer, inner, bow, .5, .32, (.28, .12), .55)
        self.tag(hull, id)
        self.gunwale_band(id, col, st, y, 'naval', .04)
        for t in (.26, .4, .54, .68):
            px, w, k, g = st(t)
            self.boxc(id, col, 'thwart', (px, y, g - .26), (.22, 2 * (w - .07), .05), 'wood')
        for s in (-1, 1):
            a, b = st(.18), st(.8)
            self.part('rod', id, col, 'oar', (a[0], y + s * .35, a[3] - .26), (b[0], y + s * .35, b[3] - .26), .035, 'wood', vertices=6)
        if chocks:
            self.cradles(id, col, st, y, chocks, .9, floor)
        return st

    # ------------------------------------------------------------ optics and lights
    def searchlight(self, id, x, y, z, bearing=0, col=None, drum=.55):
        """Searchlight on a pedestal and yoke with its foot at (x, y, z) (authoring frame); bearing about +Z."""
        col = col or self.collections['Sensors and masts']
        a = math.radians(bearing)
        f = Vector((math.cos(a), math.sin(a), 0))
        s = Vector((-math.sin(a), math.cos(a), 0))
        c = Vector((x, y, z))
        self.cylz(id, col, 'pedestal', (x, y, z), .2, .55, 'naval', 12)
        yoke = self.boxc(id, col, 'yoke', (x, y, z + .75), (.25, drum * 2 + .1, .5), 'naval', a)
        self.part('rod', id, col, 'drum', tuple(c - f * .45 + Vector((0, 0, 1.15))), tuple(c + f * .4 + Vector((0, 0, 1.15))), drum, 'naval', vertices=20)
        self.part('rod', id, col, 'glass', tuple(c + f * .4 + Vector((0, 0, 1.15))), tuple(c + f * .45 + Vector((0, 0, 1.15))), drum * .9, 'glass', vertices=20)
        self.part('rod', id, col, 'vent', tuple(c - f * .45 + Vector((0, 0, 1.15))), tuple(c - f * .6 + Vector((0, 0, 1.15))), drum * .55, 'naval', vertices=12)
        for sg in (-1, 1):
            self.part('rod', id, col, 'trunnion', tuple(c + s * sg * drum + Vector((0, 0, 1.15))), tuple(c + s * sg * (drum + .08) + Vector((0, 0, 1.15))), .07, 'edge', vertices=8)
        return yoke

    def rangefinder(self, id, x, y, z, width, bearing=0, col=None, tube=None, hood=.45, pedestal=.75):
        """Open rangefinder on a pedestal with end hoods and an operator shield; bearing about +Z (0 faces the bow)."""
        col = col or self.collections['Sensors and masts']
        a = math.radians(bearing)
        fx, fy = math.cos(a), math.sin(a)
        px, py = -fy, fx
        c = Vector((x, y, z + pedestal + .25))
        self.cylz(id, col, 'pedestal', (x, y, z), .22, pedestal, 'naval', 16)
        r = tube or (.16 if width < 2 else .22)
        self.part('rod', id, col, 'tube', tuple(c - Vector((px, py, 0)) * width / 2), tuple(c + Vector((px, py, 0)) * width / 2), r, 'naval', vertices=14)
        for s in (-1, 1):
            self.boxc(id, col, 'hood', tuple(c + Vector((px, py, 0)) * s * width / 2), (hood, hood, hood * 1.1), 'naval', a)
            self.part('rod', id, col, 'window', tuple(c + Vector((px, py, 0)) * s * width / 2 + Vector((fx, fy, 0)) * hood / 2),
                      tuple(c + Vector((px, py, 0)) * s * width / 2 + Vector((fx, fy, 0)) * (hood / 2 + .03)), hood * .3, 'glass', vertices=10)
        self.boxc(id, col, 'operator shield', tuple(c - Vector((fx, fy, 0)) * .45 + Vector((0, 0, -.1))), (.8, .9, .9), 'naval', a)

    # ------------------------------------------------------------ measured windows
    def windows(self, assembly, col, rows):
        """Dark glass panes and rimmed portholes from a measured table (runtime frame rows:
        kind, x, y, z, width, height, normal x, normal z), merged into two meshes per assembly."""
        panes, rims = ([], []), ([], [])

        def quad(buf, c, u, w, h, d):
            vv, ff = buf
            k = len(vv)
            for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                vv.append(tuple(c + u * (a * w / 2) + Vector((0, 0, b * h / 2)) + d))
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
            c = Vector((-z, -x, y))
            n = Vector((-nz, -nx, 0))
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

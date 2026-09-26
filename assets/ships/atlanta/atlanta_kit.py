"""Shared vocabulary for the Atlanta recipe: materials, primitives with ownership, merged wires.

Fitting positions are reference-frame datums read off the approved GameModels3D pasc006 model
(x starboard, y up, z toward the stern, metres), converted once by `P` to the authoring frame
(+X bow, +Y port, +Z up). No reference geometry is loaded.
"""
import math
import bpy
import bmesh
from mathutils import Vector

ZS = 0.2  # runtime z = reference z + ZS


def P(x, y, z):
    """Reference-frame point -> authoring frame (+X bow, +Y port, +Z up)."""
    return (-(z + ZS), -x, y)


def R(p):
    """Runtime-frame point [x, y, z] -> authoring frame."""
    return (-p[2], -p[0], p[1])


# Linear-RGB interpretations of the reference's default (plain) texture; appearance.json binds the named paints.
COLORS = {'naval': (.127, .165, .175), 'hullgray': (.127, .165, .175), 'roof': (.023, .034, .042), 'deck': (.023, .034, .042),
          'antifouling': (.150, .058, .030), 'black': (.012, .012, .013), 'edge': (.07, .085, .095), 'painted-edge': (.105, .13, .145),
          'dark': (.012, .013, .014), 'glass': (.02, .04, .05), 'canvas': (.2, .21, .2), 'wood': (.19, .13, .075),
          'white': (.62, .64, .62), 'bronze': (.36, .27, .12), 'red': (.40, .03, .02), 'brass': (.45, .33, .12), 'green': (.02, .30, .05)}


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
            m = bpy.data.materials.new('Atlanta ' + key)
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

    # ------------------------------------------------------------ basic primitives
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

    def wall(self, assembly, col, label, pts, z0, z1, thickness=.05, material='naval', closed=True, top_material=None):
        """A thin wall standing on a plan polyline [(x, y), ...] (authoring frame): splinter shields and bulwarks.
        The wall's outer face lies on the line; it is thickened inward (to the left of a counter-clockwise ring)."""
        seq = list(pts)
        if closed:
            area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(seq, seq[1:] + seq[:1]))
            if area < 0:
                seq.reverse()
        n = len(seq)
        inner = []
        for i in range(n):
            p = Vector(seq[i])
            a = Vector(seq[i - 1]) if (closed or i > 0) else None
            c = Vector(seq[(i + 1) % n]) if (closed or i < n - 1) else None
            normals = []
            for u, v in ((a, p), (p, c)):
                if u is None or v is None:
                    continue
                d = (v - u)
                if d.length < 1e-6:
                    continue
                d.normalize()
                normals.append(Vector((-d.y, d.x)))
            nrm = sum(normals, Vector((0, 0))).normalized() if normals else Vector((0, 0))
            inner.append(p + nrm * thickness)
        outer = [Vector(q) for q in seq]
        vv = [(q.x, q.y, z) for ring in (outer, inner) for z in (z0, z1) for q in ring]
        # index helpers: outer bottom 0..n-1, outer top n..2n-1, inner bottom 2n.., inner top 3n..
        ob_, ot, ib, it = 0, n, 2 * n, 3 * n
        ff = []
        segs = range(n) if closed else range(n - 1)
        for i in segs:
            j = (i + 1) % n
            ff += [(ob_ + i, ob_ + j, ot + j, ot + i), (ib + j, ib + i, it + i, it + j), (ot + i, ot + j, it + j, it + i), (ib + i, ib + j, ob_ + j, ob_ + i)]
        if not closed:
            ff += [(ob_, ot, it, ib), (ob_ + n - 1, ib + n - 1, it + n - 1, ot + n - 1)]
        ob = self.tag(self.mesh(assembly + '.' + label, vv, ff, material, col), assembly)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(ob.data)
        bm.free()
        if top_material:
            ob.data.materials.append(self.materials[top_material])
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

    # ------------------------------------------------------------ guns
    def barbette(self, mount, floor=None):
        """A 5-inch mount's barbette, 1.87 m in radius (armour model), from the deck or roof under it up to the
        gunhouse's roller race."""
        x, y, z = R(mount['position'])
        floor = self.below(x, y, z - .05) if floor is None else floor
        col = self.collections['Main battery']
        aid = mount['id']
        if z - floor > .03:
            self.cylz(aid, col, 'barbette', (x, y, floor - .02), 1.87, z - floor + .02, 'naval', 64)
            self.cylz(aid, col, 'barbette coaming', (x, y, floor), 1.93, .08, 'edge', 64)

    def gun_seat(self, mount, radius=None):
        """A pedestal from the supporting deck to a light mount's datum when it stands above it."""
        x, y, z = R(mount['position'])
        floor = self.below(x, y, z + .3)
        gap = z - floor
        if gap > .03:
            r = radius or max(.35, mount['weapon']['barbetteRadius'] * .75)
            self.cylz(mount['id'], self.collections['Light AA'], 'pedestal', (x, y, floor - .01), r, gap + .012, 'naval', 20)

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

    def ladder(self, assembly, col, a, b, across, width=.42, step=.35, chord=.03, rung=.02, material='naval'):
        a, b = Vector(a), Vector(b)
        u = Vector(across).normalized() * (width / 2)
        for s in (-1, 1):
            self.member(assembly, col, a + u * s, b + u * s, chord, material, 6)
        n = max(1, round((b - a).length / step))
        for i in range(1, n):
            p = a.lerp(b, i / n)
            self.member(assembly, col, p - u, p + u, rung, material, 4)

    def beam(self, assembly, col, label, a, b, width, depth, material='naval', up=(0, 0, 1)):
        """A rectangular bar from a to b: struts, brackets, girders."""
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
                ob = self.mesh(f'{assembly} {material} members', vv, ff, material, col)
                self.tag(ob, assembly)

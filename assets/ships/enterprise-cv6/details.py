"""Shared original detail vocabulary for the Enterprise recipe; executed in build.py's scope.

Authoring axes: bow +X, port +Y, up +Z. Every helper appends to a `Kit`, which emits one mesh
per material group, so small fittings stay cheap in triangles and objects. Region modules
(sponsons.py, fittings.py, island.py) use only this vocabulary and build.py's primitives.
"""
from mathutils import Matrix, Vector

class Kit:
    """Accumulates many small parts into one mesh (one material slot per key)."""
    def __init__(self, name, col, assembly=None):
        self.name, self.col, self.assembly = name, col, assembly
        self.v, self.f, self.m, self.keys = [], [], [], []

    def _mi(self, key):
        if key not in self.keys: self.keys.append(key)
        return self.keys.index(key)

    def add(self, verts, faces, key='naval'):
        k = len(self.v); i = self._mi(key)
        self.v.extend(tuple(p) for p in verts)
        for f in faces:
            self.f.append(tuple(k + j for j in f)); self.m.append(i)

    def box(self, c, size, yaw=0.0, key='naval', pitch=0.0):
        sx, sy, sz = (s / 2 for s in size)
        R = Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(pitch, 3, 'Y')
        c = Vector(c)
        vs = [c + R @ Vector(p) for p in [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                                          (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]]
        self.add(vs, [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)], key)

    def rod(self, a, b, r, key='naval', sides=6, r2=None, caps=True):
        a, b = Vector(a), Vector(b); d = b - a
        if d.length < 1e-6: return
        t = d.normalized(); up = Vector((0, 0, 1)) if abs(t.z) < .95 else Vector((1, 0, 0))
        u = t.cross(up).normalized(); w = t.cross(u).normalized(); r2 = r if r2 is None else r2
        vs = [p + (u * math.cos(k * math.tau / sides) + w * math.sin(k * math.tau / sides)) * rr
              for p, rr in [(a, r), (b, r2)] for k in range(sides)]
        fs = [(k, (k + 1) % sides, (k + 1) % sides + sides, k + sides) for k in range(sides)]
        if caps: fs += [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
        self.add(vs, fs, key)

    def tube(self, pts, r, key='edge', sides=5, closed=False):
        pts = [Vector(p) for p in pts]; n = len(pts)
        if n < 2: return
        vs = []
        for i in range(n):
            a = pts[i - 1] if (closed or i > 0) else None; b = pts[(i + 1) % n] if (closed or i < n - 1) else None
            t = ((pts[i] - a).normalized() if a is not None else Vector()) + ((b - pts[i]).normalized() if b is not None else Vector())
            t = t.normalized() if t.length > 1e-6 else Vector((1, 0, 0))
            up = Vector((0, 0, 1)) if abs(t.z) < .95 else Vector((1, 0, 0))
            u = t.cross(up).normalized(); w = t.cross(u).normalized()
            vs += [pts[i] + (u * math.cos(k * math.tau / sides) + w * math.sin(k * math.tau / sides)) * r for k in range(sides)]
        fs = []
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            fs += [(i * sides + k, i * sides + (k + 1) % sides, j * sides + (k + 1) % sides, j * sides + k) for k in range(sides)]
        self.add(vs, fs, key)

    def prism(self, outline, bottom, top, key='naval'):
        """Vertical prism over a 2D outline (counter-clockwise preferred)."""
        if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1])) < 0: outline = list(reversed(outline))
        n = len(outline)
        vs = [(x, y, z) for z in [bottom, top] for x, y in outline]
        fs = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.add(vs, fs, key)

    def wall(self, path, z, height, thickness=.04, key='naval', closed=False, coping=.022):
        """Plated screen/bulwark along a 2D path with real thickness and a rolled top edge."""
        inner = offset_path(path, thickness, closed); n = len(path)
        zb = z if callable(z) else (lambda x, y: z)
        vs = [(x, y, zb(x, y)) for x, y in path] + [(x, y, zb(x, y) + height) for x, y in path] + \
             [(x, y, zb(x, y) + height) for x, y in inner] + [(x, y, zb(x, y)) for x, y in inner]
        fs = []
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            for a, b in [(0, 1), (1, 2), (2, 3), (3, 0)]: fs.append((a * n + i, a * n + j, b * n + j, b * n + i))
        if not closed: fs += [(0, 3 * n, 2 * n, n), (n - 1, 2 * n - 1, 3 * n - 1, 4 * n - 1)]
        self.add(vs, fs, key)
        if coping:
            self.tube([(x, y, zb(x, y) + height) for x, y in offset_path(path, thickness / 2, closed)], coping, key, 4, closed)

    def rail(self, path, z, height=1.0, spacing=1.8, closed=False, courses=2, post=.022, wire=.012):
        at = z if callable(z) else (lambda x, y: z)
        pts = list(path) + ([path[0]] if closed else [])
        posts = []
        for a, b in zip(pts, pts[1:]):
            cnt = max(1, math.ceil(math.dist(a, b) / spacing))
            posts += [(a[0] + (b[0] - a[0]) * i / cnt, a[1] + (b[1] - a[1]) * i / cnt) for i in range(cnt)]
        if not closed: posts.append(pts[-1])
        for x, y in posts: self.rod((x, y, at(x, y)), (x, y, at(x, y) + height), post, 'naval', 4, caps=False)
        for k in range(courses):
            dz = height * (k + 1) / courses
            self.tube([(x, y, at(x, y) + dz) for x, y in pts], wire if k < courses - 1 else wire * 1.4, 'edge', 4)

    def ladder(self, a, b, width=.45, rung=.3, key='edge'):
        a, b = Vector(a), Vector(b); d = b - a; t = d.normalized()
        side = t.cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-6 else Vector((0, 1, 0))
        for s in [-1, 1]: self.rod(a + side * s * width / 2, b + side * s * width / 2, .022, key, 4, caps=False)
        n = max(1, int(d.length / rung))
        for i in range(1, n):
            p = a + d * i / n; self.rod(p - side * width / 2, p + side * width / 2, .014, key, 4, caps=False)

    def ladder_on(self, x, y, z0, z1, normal, width=.42, standoff=.16):
        """Vertical ladder on a wall whose outward normal is `normal` (2D)."""
        n = Vector((*normal, 0)).normalized(); t = Vector((-n.y, n.x, 0))
        base = Vector((x, y, 0)) + n * standoff
        for s in [-1, 1]:
            p = base + t * s * width / 2
            self.rod((p.x, p.y, z0), (p.x, p.y, z1), .022, 'edge', 4, caps=False)
            for zz in [z0 + .3, (z0 + z1) / 2, z1 - .3]:
                w = Vector((x, y, 0)) + t * s * width / 2
                self.rod((w.x, w.y, zz), (p.x, p.y, zz), .018, 'edge', 4, caps=False)
        for k in range(1, int((z1 - z0) / .3)):
            zz = z0 + k * .3; p = base
            self.rod(tuple(p - t * width / 2 + Vector((0, 0, zz))), tuple(p + t * width / 2 + Vector((0, 0, zz))), .014, 'edge', 4, caps=False)

    def emit(self, smooth=False):
        if not self.f: return None
        o = mesh(self.name, self.v, self.f, None, self.col, smooth)
        for key in self.keys: o.data.materials.append(M[key])
        for p, i in zip(o.data.polygons, self.m): p.material_index = i
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()
        if self.assembly: o['assemblyId'] = self.assembly
        return o


def offset_path(points, offset, closed):
    """Mitred 2D offset of a polyline (positive = left of travel)."""
    n = len(points); result = []
    for i in range(n):
        p = Vector((*points[i], 0))
        prev = Vector((*points[i - 1], 0)) if (closed or i > 0) else None
        nxt = Vector((*points[(i + 1) % n], 0)) if (closed or i < n - 1) else None
        normals = []
        for a, b in [(prev, p), (p, nxt)]:
            if a is None or b is None: continue
            d = b - a
            if d.length < 1e-6: continue
            d.normalize(); normals.append(Vector((-d.y, d.x, 0)))
        if not normals: result.append(points[i]); continue
        m = sum(normals, Vector()); m = m.normalized() if m.length > 1e-6 else normals[0]
        q = p + m * offset / max(.35, m.dot(normals[0])); result.append((q.x, q.y))
    return result


def arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ---- Fittings (each adds to a kit) -------------------------------------------------------

def locker(k, x, y, z, size=(1.0, .55, .8), yaw=0.0, key='naval'):
    """Ready-service locker: body, overhanging lid, two hinges and a hasp."""
    L, W, H = size
    k.box((x, y, z + H / 2), (L, W, H), yaw, key)
    k.box((x, y, z + H + .03), (L + .06, W + .06, .06), yaw, 'roof')
    c, s = math.cos(yaw), math.sin(yaw)
    for d in [-L * .3, L * .3]:
        k.box((x + c * d - s * (W / 2 + .02), y + s * d + c * (W / 2 + .02), z + H - .05), (.12, .03, .05), yaw, 'edge')
    k.box((x - s * (-W / 2 - .02), y + c * (-W / 2 - .02), z + H - .12), (.06, .03, .1), yaw, 'edge')


def hose_rack(k, x, y, z, normal):
    """Fire hose rack on a wall: bracket, coiled hose drum and nozzle."""
    n = Vector((*normal, 0)).normalized(); t = Vector((-n.y, n.x, 0)); c = Vector((x, y, z))
    k.box(tuple(c + n * .06), (.08, .5, .08), math.atan2(n.y, n.x), 'edge')
    k.rod(tuple(c + n * .08), tuple(c + n * .30), .26, 'canvas', 10)
    k.rod(tuple(c + n * .19 - Vector((0, 0, .26))), tuple(c + n * .19 - Vector((0, 0, .5)) + t * .08), .03, 'bronze', 5)


def extinguisher(k, x, y, z, normal):
    n = Vector((*normal, 0)).normalized(); c = Vector((x, y, z)) + n * .12
    k.rod(tuple(c), tuple(c + Vector((0, 0, .6))), .09, 'edge', 6)
    k.box(tuple(Vector((x, y, z + .45)) + n * .03), (.05, .22, .06), math.atan2(n.y, n.x), 'edge')


def floater_basket(k, x, y, z, length=2.1, yaw=0.0):
    """Floater-net basket: a slatted open box with rounded ends on two brackets."""
    c, s = math.cos(yaw), math.sin(yaw)
    def P(u, v, w): return (x + c * u - s * v, y + s * u + c * v, z + w)
    k.box(P(0, 0, .04), (length, .44, .06), yaw, 'edge')
    for v in [-.21, .21]:
        for w in [.18, .42]: k.rod(P(-length / 2, v, w), P(length / 2, v, w), .018, 'edge', 4, caps=False)
    for u in [-length / 2 + .05 + i * (length - .1) / 5 for i in range(6)]:
        k.tube([P(u, -.21, .05), P(u, -.23, .48), P(u, .23, .48), P(u, .21, .05)], .014, 'edge', 4)
    k.box(P(0, 0, .30), (length - .12, .38, .38), yaw, 'canvas')


def carley(k, x, y, z, length=2.4, height=1.1, yaw=0.0, wall=None):
    """Carley float carried on edge against a wall: an oval tube with a grating, strapped to two cradles."""
    c, s = math.cos(yaw), math.sin(yaw)
    def P(u, w, v=0.0): return Vector((x + c * u - s * v, y + s * u + c * v, z + w))
    r = height / 2; a = length / 2 - r; seg = 7
    ring = [P(a + r * math.cos(t), r * math.sin(t)) for t in [-math.pi / 2 + math.pi * i / seg for i in range(seg + 1)]] + \
           [P(-a + r * math.cos(t), r * math.sin(t)) for t in [math.pi / 2 + math.pi * i / seg for i in range(seg + 1)]]
    k.tube(ring, .11, 'raft', 5, closed=True)
    k.box(tuple(P(0, 0)), (2 * a + .3, .04, height - .3), yaw, 'raft')
    for u in [-a * .6, a * .6]:
        k.tube([P(u, -r - .08, -.14), P(u, -r - .08, .16), P(u, r + .05, .16)], .02, 'edge', 4)
    if wall is not None:
        for u in [-a * .6, a * .6]: k.rod(P(u, -r - .08, .0), P(u, -r - .08, wall), .035, 'naval', 5)


def ready_box(k, x, y, z, yaw=0.0):
    """20 mm / 1.1-inch ready-service ammunition box on legs."""
    k.box((x, y, z + .55), (.9, .5, .55), yaw, 'naval')
    k.box((x, y, z + .86), (.96, .56, .06), yaw, 'roof')
    c, s = math.cos(yaw), math.sin(yaw)
    for u, v in [(-.38, -.2), (.38, -.2), (-.38, .2), (.38, .2)]:
        px, py = x + c * u - s * v, y + s * u + c * v
        k.rod((px, py, z), (px, py, z + .28), .025, 'edge', 4, caps=False)


def bollard(k, x, y, z, yaw=0.0):
    c, s = math.cos(yaw), math.sin(yaw)
    k.box((x, y, z + .04), (1.3, .5, .08), yaw, 'edge')
    for u in [-.35, .35]:
        px, py = x + c * u, y + s * u
        k.rod((px, py, z), (px, py, z + .55), .16, 'edge', 10)
        k.rod((px, py, z + .55), (px, py, z + .62), .2, 'edge', 10)


def chock(k, x, y, z, yaw=0.0):
    """Open fairlead chock at the deck edge."""
    c, s = math.cos(yaw), math.sin(yaw)
    k.box((x, y, z + .05), (.9, .35, .1), yaw, 'edge')
    for u in [-.3, .3]:
        k.box((x + c * u, y + s * u, z + .25), (.14, .3, .32), yaw, 'edge')


def voice_pipe(k, pts):
    k.tube(pts, .035, 'edge', 5)


def signal_lamp(k, x, y, z, yaw=0.0):
    """Signal searchlight on a pedestal with hood and shutter."""
    c, s = math.cos(yaw), math.sin(yaw)
    k.rod((x, y, z), (x, y, z + .75), .05, 'naval', 6)
    k.rod((x - c * .2, y - s * .2, z + .95), (x + c * .25, y + s * .25, z + .95), .2, 'naval', 10)
    k.rod((x + c * .25, y + s * .25, z + .95), (x + c * .27, y + s * .27, z + .95), .17, 'glass', 10)
    k.box((x, y, z + .8), (.18, .3, .1), yaw, 'edge')


def anchor(k, x, y, z, yaw=0.0, lean=0.0):
    """Stockless (Navy type) anchor hanging from its hawse pipe: shank, crown and two flukes."""
    c, s = math.cos(yaw), math.sin(yaw)
    def P(u, v, w): return (x + c * u - s * v, y + s * u + c * v, z + w)
    k.rod(P(0, 0, 0), P(0, 0, -1.9), .1, 'edge', 6)
    k.rod(P(0, 0, .05), P(0, 0, -.1), .17, 'edge', 6)
    k.box(P(0, 0, -2.0), (.5, 1.1, .3), yaw, 'edge')
    for v in [-1, 1]:
        k.add([P(-.2, v * .35, -2.1), P(.2, v * .35, -2.1), P(.28, v * .55, -1.1), P(-.28, v * .55, -1.1),
               P(-.14, v * .5, -2.1), P(.14, v * .5, -2.1), P(.2, v * .66, -1.15), P(-.2, v * .66, -1.15)],
              [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'edge')


def reel(k, x, y, z, radius=.42, length=1.2):
    """Mooring-line reel: two feet, cheeks with rims, and the wound rope drum (athwartships axis)."""
    zc = z + radius + .18
    for sg in [-1, 1]:
        k.box((x, y + sg * length / 2, z + .35), (.16, .14, .7), 0, 'naval')
        k.rod((x, y + sg * length / 2 - .05, zc), (x, y + sg * length / 2 + .05, zc), radius, 'naval', 14)
    k.rod((x, y - length / 2 + .05, zc), (x, y + length / 2 - .05, zc), radius * .8, 'canvas', 14, caps=False)
    for i in range(4):
        yy = y - length * .36 + length * .72 * i / 3
        k.rod((x, yy - .03, zc), (x, yy + .03, zc), radius * .83, 'canvas', 14, caps=False)
    k.rod((x - .25, y - length / 2 - .2, zc), (x - .25, y - length / 2 - .05, zc), .04, 'edge', 5)

"""Shared original detail vocabulary for the Iowa recipe; executed in build.py's scope.

Authoring axes: bow +X, port +Y, up +Z. Runtime blueprint points are [x, y, z]
with +x starboard and -z bow, so a runtime point maps to (-z, -x, y). Every
helper builds one continuous mesh per call where it can, so fine fittings stay
within the model's triangle budget. Region files (forward, tower, midships, aft,
deck) and the light AA mechanisms (aa.py) use only this vocabulary and the
primitives defined in build.py.
"""

def to_blender(p):
    """Runtime [x, y, z] (starboard, up, aft) to authoring (bow, port, up)."""
    return (-p[2], -p[0], p[1])

def outline_of(s):
    return [(-z, -x) for x, z in s['footprint']]

def structure(id):
    return next(s for s in D['structures'] if s['id'] == id)

def structure_top(id):
    s = structure(id); return s['baseY'] + s['height']

def mount(id):
    return next(m for m in D['mounts'] if m['id'] == id)

def mount_point(id):
    return to_blender(mount(id)['position'])

def _offset_path(points, offset, closed):
    """Mitred 2D offset of a polyline (positive = left of travel)."""
    n = len(points); result = []
    for i in range(n):
        p = Vector((*points[i], 0))
        prev = Vector((*points[i - 1], 0)) if (closed or i > 0) else None
        nxt = Vector((*points[(i + 1) % n], 0)) if (closed or i < n - 1) else None
        normals = []
        for a, b in [(prev, p), (p, nxt)]:
            if a is None or b is None: continue
            d = (b - a); d.z = 0
            if d.length < 1e-6: continue
            d.normalize(); normals.append(Vector((-d.y, d.x, 0)))
        if not normals: result.append(points[i]); continue
        m = sum(normals, Vector()); m = m.normalized() if m.length > 1e-6 else normals[0]
        scale = 1 / max(.35, m.dot(normals[0]))
        q = p + m * offset * scale; result.append((q.x, q.y))
    return result

def tube_path(name, points, radius, material='edge', sides=6, closed=False, col=None):
    """One continuous low-sided tube along a 3D polyline (rails, coping, pipes, cables)."""
    pts = [Vector(p) for p in points]; n = len(pts)
    if n < 2: return None
    vv = []; ff = []
    for i in range(n):
        a = pts[i - 1] if (closed or i > 0) else None; b = pts[(i + 1) % n] if (closed or i < n - 1) else None
        t = ((pts[i] - a).normalized() if a is not None else Vector()) + ((b - pts[i]).normalized() if b is not None else Vector())
        t = t.normalized() if t.length > 1e-6 else Vector((1, 0, 0))
        up = Vector((0, 0, 1)) if abs(t.z) < .95 else Vector((1, 0, 0))
        u = t.cross(up).normalized(); w = t.cross(u).normalized()
        for k in range(sides):
            ang = k * math.tau / sides
            vv.append(tuple(pts[i] + (u * math.cos(ang) + w * math.sin(ang)) * radius))
    segs = n if closed else n - 1
    for i in range(segs):
        j = (i + 1) % n
        for k in range(sides):
            ff.append((i * sides + k, i * sides + (k + 1) % sides, j * sides + (k + 1) % sides, j * sides + k))
    if not closed:
        ff.append(tuple(reversed(range(sides)))); ff.append(tuple(range((n - 1) * sides, n * sides)))
    return mesh(name, vv, ff, material, col, True)

def shell_wall(name, path, z, height, thickness=.05, closed=False, material='naval', coping=.024, col=None):
    """Splinter plating, bulwarks and parapets as one mesh with real thickness.

    `path` runs along the outer face; the plate thickens to its left. A rolled
    edge follows the top unless `coping` is 0."""
    inner = _offset_path(path, thickness, closed); n = len(path)
    vv = [(x, y, z) for x, y in path] + [(x, y, z + height) for x, y in path] + [(x, y, z + height) for x, y in inner] + [(x, y, z) for x, y in inner]
    ff = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        for a, b in [(0, 1), (1, 2), (2, 3), (3, 0)]:
            ff.append((a * n + i, a * n + j, b * n + j, b * n + i))
    if not closed:
        ff.append((0, 3 * n, 2 * n, n)); ff.append((n - 1, 2 * n - 1, 3 * n - 1, 4 * n - 1))
    obj = mesh(name, vv, ff, material, col)
    if coping:
        edge = [(x, y, z + height) for x, y in _offset_path(path, thickness / 2, closed)]
        tube_path(name + ' rolled edge', edge, coping, 'naval', 5, closed, col)
    return obj

def platform(name, outline, top, thickness=.12, material='roof', col=None):
    """A flat deck or platform slab whose upper surface is at `top`."""
    if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1])) < 0: outline = list(reversed(outline))
    n = len(outline)
    return mesh(name, [(x, y, z) for z in [top - thickness, top] for x, y in outline],
                [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)], material, col)

def circle(cx, cy, r, n=24, start=0, end=math.tau):
    full = abs(end - start - math.tau) < 1e-6
    count = n if full else n + 1
    return [(cx + r * math.cos(start + (end - start) * i / n), cy + r * math.sin(start + (end - start) * i / n)) for i in range(count)]

def gun_tub(name, x, y, z, r, height=.9, deck=True, segments=32, gap=None, col=None):
    """Round splinter tub: floor disc and a continuous plated ring, optionally open over `gap` (start, end radians)."""
    if deck: platform(name + ' floor', circle(x, y, r, segments), z, .11, 'roof', col)
    if gap:
        start, end = gap[1], gap[0] + math.tau
        shell_wall(name + ' splinter plating', circle(x, y, r, segments, start, end), z, height, col=col)
    else:
        shell_wall(name + ' splinter plating', list(reversed(circle(x, y, r, segments))), z, height, closed=True, col=col)

def knee(name, top, wall, drop, width=.05, col=None):
    """Triangular bracket under a platform: `top` is the outboard point on the platform soffit,
    `wall` the point on the supporting wall at the same height; the web runs down `drop` metres."""
    t, w = Vector(top), Vector(wall); low = w - Vector((0, 0, drop))
    side = (t - w).cross(Vector((0, 0, 1)))
    side = side.normalized() * width / 2 if side.length > 1e-6 else Vector((width / 2, 0, 0))
    pts = [w, t, low]
    vv = [tuple(p + side * s) for s in [-1, 1] for p in pts]
    return mesh(name, vv, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], 'naval', col)

def rail(name, path, z, height=.95, spacing=1.6, closed=False, courses=2, col=None):
    """Guard rail: stanchions and continuous wire courses; `z` may be a number or a function of (x, y)."""
    at = z if callable(z) else (lambda x, y: z)
    pts = list(path) + ([path[0]] if closed else [])
    posts = []
    for a, b in zip(pts, pts[1:]):
        count = max(1, math.ceil(math.dist(a, b) / spacing))
        posts.extend((a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count) for i in range(count))
    if not closed: posts.append(pts[-1])
    for x, y in posts: rod(name + ' stanchion', (x, y, at(x, y)), (x, y, at(x, y) + height), .022, 'naval', vertices=5)
    for k in range(courses):
        dz = height * (k + 1) / courses
        tube_path(name + ' wire', [(x, y, at(x, y) + dz) for x, y in pts], .013 if k < courses - 1 else .018, 'edge', 4, False)

def porthole(name, x, y, z, normal, r=.19, col=None):
    """Rimmed scuttle on a wall whose outward normal is `normal` (a 2D direction)."""
    n = Vector((*normal, 0)).normalized(); p = Vector((x, y, z))
    rod(name + ' rim', tuple(p - n * .01), tuple(p + n * .05), r, 'edge', col, vertices=10)
    rod(name + ' glass', tuple(p + n * .05), tuple(p + n * .058), r * .72, 'glass', col, vertices=10)

def door(name, x, y, z, normal, width=.72, height=1.78, col=None):
    """Watertight door with frame, leaf, dogs and handwheel on a wall facing `normal`."""
    n = Vector((*normal, 0)).normalized(); t = Vector((-n.y, n.x, 0)); c = Vector((x, y, z)); a = math.atan2(n.y, n.x)
    o = box(name + ' frame', tuple(c + n * .03 + Vector((0, 0, height / 2))), (.06, width + .12, height + .12), 'edge', col); o.rotation_euler.z = a
    o = box(name + ' leaf', tuple(c + n * .07 + Vector((0, 0, height / 2))), (.05, width, height), 'naval', col); o.rotation_euler.z = a
    for zz in [.35, height - .35]:
        for s in [-1, 1]: rod(name + ' dog', tuple(c + n * .09 + t * s * width * .42 + Vector((0, 0, zz))), tuple(c + n * .15 + t * s * width * .42 + Vector((0, 0, zz))), .025, 'edge', col, vertices=5)
    rod(name + ' handwheel', tuple(c + n * .10 + Vector((0, 0, height * .55))), tuple(c + n * .13 + Vector((0, 0, height * .55))), .12, 'edge', col, vertices=10)

def louvre(name, x, y, z, normal, width=1.1, height=.8, col=None):
    """Ventilation louvre panel with a rain hood, on a wall facing `normal`."""
    n = Vector((*normal, 0)).normalized(); c = Vector((x, y, z)); a = math.atan2(n.y, n.x)
    o = box(name + ' recess', tuple(c + n * .02), (.04, width, height), 'dark', col); o.rotation_euler.z = a
    for i in range(max(3, int(height / .14))):
        o = box(name + ' slat', tuple(c + n * .05 + Vector((0, 0, -height / 2 + .07 + i * .14))), (.10, width, .035), 'naval', col); o.rotation_euler.z = a; o.rotation_euler.y = 0
    o = box(name + ' hood', tuple(c + n * .09 + Vector((0, 0, height / 2 + .04))), (.22, width + .10, .05), 'roof', col); o.rotation_euler.z = a

def locker(name, x, y, z, size=(1.0, .6, .7), bearing=0, material='naval', col=None):
    """Ready-use ammunition or stores locker: body, lid lip and hasp. `bearing` turns it about Z (radians)."""
    w, d, h = size
    o = box(name + ' body', (x, y, z + h / 2), (w, d, h), material, col); o.rotation_euler.z = bearing
    o = box(name + ' lid', (x, y, z + h + .025), (w + .05, d + .05, .05), 'roof', col); o.rotation_euler.z = bearing
    fx, fy = math.cos(bearing), math.sin(bearing)
    o = box(name + ' hasp', (x - fy * (d / 2 + .02), y + fx * (d / 2 + .02), z + h - .08), (.10, .03, .12), 'edge', col); o.rotation_euler.z = bearing

def mushroom_vent(name, x, y, z, r=.3, height=.5, col=None):
    cyl(name + ' coaming', (x, y, z + height * .45), r * .75, height * .9, 'naval', col, vertices=12)
    cyl(name + ' cap', (x, y, z + height + .05), r, .12, 'naval', col, vertices=12, r2=r * .55)

def cowl_vent(name, x, y, z, r=.28, height=1.3, bearing=0, col=None):
    """Bent ventilator with a bell mouth facing `bearing` (radians about Z)."""
    fx, fy = math.cos(bearing), math.sin(bearing)
    path = [(x, y, z), (x, y, z + height * .75), (x + fx * r * .6, y + fy * r * .6, z + height * .95), (x + fx * r * 1.3, y + fy * r * 1.3, z + height)]
    tube_path(name + ' trunk', path, r * .7, 'naval', 10)
    rod(name + ' bell mouth', path[-1], (path[-1][0] + fx * r * .35, path[-1][1] + fy * r * .35, path[-1][2]), r * .72, 'naval', col, vertices=12, r2=r * 1.15)
    rod(name + ' mouth opening', (path[-1][0] + fx * r * .34, path[-1][1] + fy * r * .34, path[-1][2]), (path[-1][0] + fx * r * .36, path[-1][1] + fy * r * .36, path[-1][2]), r * 1.05, 'dark', col, vertices=12)

def hose_reel(name, x, y, z, bearing=0, col=None):
    """Compact fire-hose reel on a bracket (low-poly substitute for Fittings.reel)."""
    fx, fy = math.cos(bearing), math.sin(bearing)
    for s in [-1, 1]:
        o = box(name + ' bracket', (x - fy * s * .28, y + fx * s * .28, z + .32), (.08, .06, .64), 'naval', col); o.rotation_euler.z = bearing
    rod(name + ' drum', (x - fy * .26, y + fx * .26, z + .55), (x + fy * .26, y - fx * .26, z + .55), .26, 'canvas', col, vertices=12)
    for s in [-1, 1]: rod(name + ' cheek', (x - fy * s * .25, y + fx * s * .25, z + .55), (x - fy * s * .27, y + fx * s * .27, z + .55), .34, 'naval', col, vertices=12)

def extinguisher_rack(name, x, y, z, bearing=0, count=3, col=None):
    """Upright CO2 bottles in a wall rack."""
    fx, fy = math.cos(bearing), math.sin(bearing)
    for i in range(count):
        s = (i - (count - 1) / 2) * .26
        cyl(name + ' bottle', (x - fy * s, y + fx * s, z + .62), .11, 1.24, 'white', col, vertices=8)
    o = box(name + ' strap', (x, y, z + .95), (.05, count * .26 + .1, .05), 'edge', col); o.rotation_euler.z = bearing

def searchlight(name, x, y, z, r=.55, bearing=0):
    before = set(scene.objects); cyl(name + ' pedestal', (x, y, z + .22), .19, .44, vertices=12)
    for sign in [-1, 1]:
        box(name + ' fork', (x, y + sign * (r + .06), z + .67), (.11, .11, .83))
        rod(name + ' axle', (x, y + sign * r, z + .98), (x, y + sign * (r + .13), z + .98), .06, 'edge', vertices=8)
    rod(name + ' drum', (x - .23, y, z + .98), (x + .29, y, z + .98), r, 'naval', vertices=24)
    rod(name + ' lens', (x + .29, y, z + .98), (x + .305, y, z + .98), r * .85, 'glass', vertices=24)
    tube_path(name + ' bezel', [(x + .31, y + r * .96 * math.cos(i * math.tau / 24), z + .98 + r * .96 * math.sin(i * math.tau / 24)) for i in range(24)], .036, 'naval', 5, True)
    if bearing:
        rotation = Matrix.Rotation(bearing, 4, 'Z'); origin = Vector((x, y, z))
        for obj in set(scene.objects) - before:
            obj.location = origin + rotation.to_3x3() @ (obj.location - origin); obj.rotation_euler = (rotation.to_3x3() @ obj.rotation_euler.to_matrix()).to_euler()

def _turned(before, x, y, z, bearing):
    if not bearing: return
    bpy.context.view_layer.update()
    rotation = Matrix.Translation((x, y, z)) @ Matrix.Rotation(bearing, 4, 'Z') @ Matrix.Translation((-x, -y, -z))
    for obj in set(scene.objects) - before: obj.matrix_world = rotation @ obj.matrix_world

def mk51(name, x, y, z, bearing=0):
    """Mk.51 anti-aircraft director: pedestal, yoke and Mk.14 gyro sight with handlebars.

    `z` is the deck it stands on; `bearing` (radians about Z) is where the sight
    looks at rest. Matches the approved model's 0.84 x 1.73 x 0.83 m envelope."""
    before = set(scene.objects)
    cyl(name + ' base flange', (x, y, z + .03), .30, .06, 'edge', vertices=10)
    cyl(name + ' pedestal', (x, y, z + .55), .13, 1.0, 'naval', vertices=8, r2=.11)
    cyl(name + ' training head', (x, y, z + 1.09), .20, .10, 'edge', vertices=10)
    for s in [-1, 1]: box(name + ' yoke arm', (x, y + s * .21, z + 1.28), (.14, .04, .34), 'naval')
    box(name + ' Mk.14 sight body', (x + .02, y, z + 1.40), (.46, .34, .30), 'naval')
    o = box(name + ' Mk.14 reflector hood', (x + .20, y, z + 1.59), (.16, .30, .08), 'naval'); o.rotation_euler.y = -.35
    box(name + ' reflector glass', (x + .245, y, z + 1.48), (.02, .24, .14), 'glass')
    box(name + ' eyepiece', (x - .24, y, z + 1.45), (.06, .12, .10), 'dark')
    tube_path(name + ' handlebars', [(x - .20, y - .33, z + 1.33), (x - .36, y - .33, z + 1.33), (x - .36, y + .33, z + 1.33), (x - .20, y + .33, z + 1.33)], .022, 'edge', 5)
    _turned(before, x, y, z, bearing)

def mk57(name, x, y, z, bearing=0):
    """Mk.57 blind-fire director: Mk.51-style stand with an enclosed sight head and a small Mk.29-type dish."""
    before = set(scene.objects)
    cyl(name + ' base flange', (x, y, z + .03), .34, .06, 'edge', vertices=10)
    cyl(name + ' pedestal', (x, y, z + .50), .15, .90, 'naval', vertices=8, r2=.13)
    box(name + ' director body', (x, y, z + 1.20), (.62, .52, .44), 'naval')
    box(name + ' sight window', (x + .312, y, z + 1.26), (.02, .30, .12), 'glass')
    rod(name + ' dish arm', (x - .05, y, z + 1.42), (x + .05, y, z + 1.62), .03, 'edge', vertices=5)
    rod(name + ' radar dish', (x + .05, y, z + 1.66), (x + .21, y, z + 1.66), .08, 'naval', vertices=12, r2=.42)
    rod(name + ' dish feed', (x + .21, y, z + 1.66), (x + .44, y, z + 1.66), .018, 'edge', vertices=5)
    tube_path(name + ' handlebars', [(x - .26, y - .30, z + 1.10), (x - .40, y - .30, z + 1.10), (x - .40, y + .30, z + 1.10), (x - .26, y + .30, z + 1.10)], .022, 'edge', 5)
    _turned(before, x, y, z, bearing)

def director_tub(name, x, y, z, r=1.05, height=1.0, col=None):
    """Round splinter tub for a Mk.51/Mk.57 director, floor at `z`."""
    gun_tub(name, x, y, z, r, height, True, 20, col=col)

def gallery(name, x0, x1, wall_y, depth, z, shield=1.15, knees=True, drop=1.1, end_walls=True, col=None):
    """20 mm gallery sponson projecting outboard from a wall at `wall_y` (sign gives the side).

    Deck slab from x0 to x1 with its top at `z`, a continuous splinter shield on
    the outboard edge and ends, and pierced knees down to the wall below."""
    s = 1 if wall_y > 0 else -1; y0 = wall_y - s * .05; y1 = wall_y + s * depth
    platform(name + ' gallery deck', [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z, .12, 'roof', col)
    path = ([(x0, y0)] if end_walls else []) + [(x0, y1), (x1, y1)] + ([(x1, y0)] if end_walls else [])
    if s < 0: path = list(reversed(path))
    shell_wall(name + ' splinter shield', path, z, shield, col=col)
    if knees:
        count = max(2, math.ceil((x1 - x0) / 2.6) + 1)
        for i in range(count):
            x = x0 + .3 + (x1 - x0 - .6) * i / (count - 1)
            knee(name + ' knee', (x, y1 - s * .15, z - .12), (x, wall_y, z - .12), drop, col=col)

AA_INSTALLED = set()

def default_aa_installation(m):
    """The previous generic Bofors tub or Oerlikon disc and pole; replaced mount by mount by region files."""
    a, z, c = m['position']; x, y = -c, -a
    is_bofors = m['weapon']['caliberM'] > .03; radius = 2.36 if is_bofors else 1.20
    before = set(scene.objects)
    if is_bofors: gun_tub(m['name'], x, y, z, radius, .85)
    else: cyl(m['name'] + ' deck', (x, y, z - .055), radius, .11, 'roof', vertices=16)
    parent_mount = next((p for p in D['mounts'] if p['id'] == m.get('parentMountId')), None)
    support = parent_mount['position'][1] + parent_mount['weapon']['gunhouseSize'][2] if parent_mount else surface_height(x, y, z)
    if z > deckz(x) + .18 and z > support + .18:
        rod(m['name'] + ' support', (x, y, support - .05), (x, y, z - .06), .20, 'naval', vertices=10)
        inner = y - math.copysign(min(2.0, abs(y)), y) if abs(y) > .1 else y
        for dx in [-radius * .65, radius * .65]: rod(m['name'] + ' knee', (x + dx, inner, support), (x + dx, y, z - .08), .085, 'naval', vertices=6)
    if parent_mount:
        parent = next(o for o in scene.objects if o.get('nodeId') == parent_mount['id'] + '.yaw')
        bpy.context.view_layer.update()
        for obj in set(scene.objects) - before:
            if obj.parent is None:
                world = obj.matrix_world.copy(); obj.parent = parent; obj.matrix_parent_inverse = Matrix.Identity(4); obj.matrix_world = world
                obj['assemblyId'] = m['id']
    else:
        for obj in set(scene.objects) - before: obj['assemblyId'] = m['id']

def director_details(m,base):
    """The low Mk.38 and sloped Mk.37 heads have distinct optics and antennas."""
    a,z,c=m['center'];x,y=-c,-a;main='main' in m['id'];before=set(scene.objects)
    def head(bottom,top,z0,z1):
        n=len(bottom);vv=[(x+a,y+b,zz) for poly,zz in [(bottom,z0),(top,z1)] for a,b in poly]
        return mesh('Mk.38 armored head' if main else 'Mk.37 armored head',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'naval')
    cyl('Director training race',(x,y,base+.13),1.57,.26,'edge',vertices=40)
    if main:
        bottom=[(-1.76,-1.12),(-1.31,-1.50),(1.34,-1.50),(1.76,-1.06),(1.76,1.06),(1.34,1.50),(-1.31,1.50),(-1.76,1.12)]
        top=[(-1.35,-.95),(-1.05,-1.20),(1.03,-1.20),(1.39,-.86),(1.39,.86),(1.03,1.20),(-1.05,1.20),(-1.35,.95)]
        head(bottom,bottom,base+.24,base+.64);head(bottom,top,base+.64,base+1.59)
        for side in [-1,1]:
            box('Mk.38 armored rangefinder wing',(x+.18,y+side*3.057,base+.61),(1.024,3.314,1.06))
            box('Mk.38 wing optical bezel',(x+.706,y+side*4.42,base+.53),(.065,.29,.55),'edge')
            box('Mk.38 wing objective',(x+.749,y+side*4.42,base+.53),(.025,.17,.41),'glass')
            for yy in [side*1.75,side*3.15,side*4.60]:
                rod('Mk.38 wing roof rail post',(x-.2,y+yy,base+1.14),(x-.2,y+yy,base+1.38),.018,'naval',vertices=6)
            rod('Mk.38 wing roof rail',(x-.2,y+side*1.75,base+1.38),(x-.2,y+side*4.60,base+1.38),.018,'naval',vertices=6)
        for yy in [-.77,.77]:
            box('Mk.38 sight cover',(x+1.53,y+yy,base+1.01),(.18,.37,.55))
            box('Mk.38 vision slit',(x+1.63,y+yy,base+.88),(.025,.23,.24),'dark')
        # The approved fit has a long covered instrument above the head,
        # alongside a smaller rectangular unit on its own four-legged stand.
        for side in [-1,1]:
            for xx in [-.76,.12]:rod('Covered instrument trestle',(x+xx,y+side*1.24,base+1.59),(x-.28,y+side*1.24,base+2.37),.050,'naval',vertices=8)
        cross=[(-.76,2.56),(-.73,2.90),(-.58,3.10),(.08,3.10),(.24,2.94),(.27,2.59),(.12,2.36),(-.57,2.36)]
        vv=[(x+xx,y+yy,base+zz) for yy in [-2.05,2.05] for xx,zz in cross]
        mesh('Main director covered instrument',vv,[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],'naval',smooth=True)
        for yy in [-1.65,-1.1,-.55,0,.55,1.1,1.65]:
            path=[(x+xx,y+yy,base+zz+.006) for xx,zz in cross[:5]]
            for a,b in zip(path,path[1:]):rod('Instrument cover seam',a,b,.009,'edge',vertices=4)
        for xx in [-.65,.15]:
            for yy in [2.17,2.77]:rod('Director auxiliary instrument leg',(x+xx,y+yy,base+1.14),(x-.20,y+(yy-2.47)*.5+2.47,base+2.19),.036,'naval',vertices=8)
        box('Director auxiliary instrument',(x-.20,y+2.47,base+2.44),(.62,.69,.48))
        box('Director auxiliary window',(x+.123,y+2.47,base+2.44),(.025,.43,.15),'glass')
    else:
        bottom=[(-1.95,-1.24),(-1.59,-1.48),(1.61,-1.48),(1.96,-1.14),(1.96,1.14),(1.61,1.48),(-1.59,1.48),(-1.95,1.24)]
        top=[(-1.84,-1.19),(-1.49,-1.43),(.35,-1.43),(.53,-1.10),(.53,1.10),(.35,1.43),(-1.49,1.43),(-1.84,1.19)]
        head(bottom,bottom,base+.25,base+.70);head(bottom,top,base+.70,base+2.59)
        for yy in [-.74,0,.74]:
            for zz,dx,h in [(1.18,1.61,.34),(1.93,1.02,.33)]:
                obj=box('Mk.37 observation bezel',(x+dx,y+yy,base+zz),(.065,.43,h),'edge');obj.rotation_euler.y=-.648
                obj=box('Mk.37 dark observation port',(x+dx+.031,y+yy,base+zz+.02),(.028,.29,h-.12),'glass');obj.rotation_euler.y=-.648
            obj=box('Mk.37 raised shutter',(x+.59,y+yy,base+2.75),(.07,.43,.57));obj.rotation_euler.y=-.12
            rod('Mk.37 shutter hinge',(x+.72,y+yy-.22,base+2.46),(x+.72,y+yy+.22,base+2.46),.028,'edge',vertices=8)
            obj=box('Mk.37 lower shutter',(x+1.89,y+yy,base+.92),(.42,.43,.055));obj.rotation_euler.y=.22
        for side in [-1,1]:
            rod('Mk.37 rangefinder sleeve',(x-.22,y+side*1.4,base+1.45),(x-.22,y+side*2.31,base+1.45),.12,'naval',vertices=16)
            rod('Mk.37 rangefinder objective',(x-.03,y+side*2.24,base+1.45),(x+.04,y+side*2.24,base+1.45),.10,'glass',vertices=16)
            box('Mk.37 rangefinder end',(x-.18,y+side*2.24,base+1.45),(.33,.27,.29))
        # Curved two-tier open radar screens, with diagonal support trusses.
        for side in [-1,1]:
            rod('Mk.37 radar tripod',(x-.80,y+side*.95,base+2.59),(x-.28,y+side*.40,base+4.02),.050,'naval',vertices=8)
            rod('Mk.37 radar tripod',(x+.23,y+side*.95,base+2.59),(x-.28,y+side*.40,base+4.02),.050,'naval',vertices=8)
        for z0,z1,depth in [(3.15,3.98,.50),(4.27,5.0,.38)]:
            path=[(-.22+depth*((i/8-.5)**2*4),z0+(z1-z0)*i/8) for i in range(9)]
            for xx,zz in [path[0],path[-1]]:rod('Mk.37 radar horizontal frame',(x+xx,y-1.19,base+zz),(x+xx,y+1.19,base+zz),.028,'naval',vertices=8)
            for yy in [-1.19,1.19]:
                for a,b in zip(path,path[1:]):rod('Mk.37 curved radar rail',(x+a[0],y+yy,base+a[1]),(x+b[0],y+yy,base+b[1]),.025,'naval',vertices=6)
            for i in range(-9,10):
                for a,b in zip(path,path[1:]):rod('Mk.37 radar mesh',(x+a[0],y+i*.125,base+a[1]),(x+b[0],y+i*.125,base+b[1]),.008,'edge',vertices=4)
            for xx,zz in path[1:-1]:rod('Mk.37 radar mesh',(x+xx,y-1.19,base+zz),(x+xx,y+1.19,base+zz),.008,'edge',vertices=4)
        rod('Mk.37 radar spine',(x-.15,y,base+2.59),(x-.15,y,base+4.95),.048,'naval',vertices=8)
    Fittings(helpers,materials,COL).ladder('Director rear access',(x-1.98,y,base+.1),(x-1.89,y,base+(1.55 if main else 2.56)),.44,normal='x')
    angle=math.pi if 'aft' in m['id'] else math.pi/2 if 'port' in m['id'] else -math.pi/2 if 'starboard' in m['id'] else 0
    if angle:
        bpy.context.view_layer.update();rotation=Matrix.Translation((x,y,base))@Matrix.Rotation(angle,4,'Z')@Matrix.Translation((-x,-y,-base))
        for obj in set(scene.objects)-before:obj.matrix_world=rotation@obj.matrix_world


def fire_control(id):
    """Foundation and head for one fire-control module; the caller chooses ASSEMBLY."""
    global COL
    saved=COL;COL=collections['Masts and directors']
    m=next(m for m in D['modules'] if m['id']==id)
    a,z,c=m['center'];x,y=-c,-a;main='main' in m['id'];base=z-m['size'][1]/2
    support=surface_height(x,y,base)
    if base>support:cyl(m['name']+' foundation',(x,y,(base+support)/2),1.3 if main else 1.65,base-support+.08,vertices=24)
    director_details(m,base)
    COL=saved

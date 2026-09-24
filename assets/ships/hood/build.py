"""Original HMS Hood, May 1941. Blueprint-driven local Blender recipe.

Blender frame: bow +X, port +Y, up +Z, reference waterline Z=0. The blueprint owns
hull stations, mount datums and superstructure tiers; this recipe draws them and adds
the fittings. Registered original components are reused through their builders. The
approved GameModels3D pbsb507 model was the viewing reference; nothing of it is read.
Run through `bun run ship:build hood`.
"""
import bpy
import bmesh
import importlib.util
import json
import math
import os
import sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
sys.path.insert(0, str(ROOT / 'assets/parts'))
from library import create_mount as create_shared_mount
from catalog_records import catalog
from blender_components import create_gun_mount
from blender_rig import radar_pivot, create_flagstaffs
OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene; scene.unit_settings.system = 'METRIC'; scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Hood studio'); scene.world.color = (.08, .1, .12)
collections = {}
for name in ['Hull and decks', 'Batteries', 'Superstructure', 'Funnels', 'Masts and directors', 'Light AA', 'Boats', 'Deck fittings', 'Underwater fittings', 'Simulation volumes']:
    c = bpy.data.collections.new(name); scene.collection.children.link(c); collections[name] = c
COL = collections['Hull and decks']; ASSEMBLY = 'hull'

# Linear RGB. The blue-grey interprets the approved reference's "1941" scheme.
colors = {'naval': (.112, .155, .165), 'hullgray': (.105, .148, .158), 'roof': (.092, .108, .118), 'edge': (.062, .072, .08),
          'canvas': (.34, .34, .30), 'dark': (.013, .018, .02), 'deck': (.42, .32, .20), 'antifouling': (.26, .07, .045),
          'boot': (.02, .022, .024), 'bronze': (.39, .29, .10), 'glass': (.028, .072, .084), 'white': (.71, .73, .70),
          'red': (.37, .04, .04), 'blue': (.03, .07, .17), 'black': (.025, .028, .03), 'bright': (.5, .5, .47),
          'wood': (.35, .25, .14), 'rope': (.33, .29, .22)}
materials = {}
for key, color in colors.items():
    m = bpy.data.materials.new('Hood ' + key); m.diffuse_color = (*color, 1); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .76; p.inputs['Metallic'].default_value = .08
    materials[key] = m
materials['painted-edge'] = materials['edge']; materials['underwater'] = materials['antifouling']
# Teak weather decks: appearance.json names their stain and plank sizes; the game draws the planks.
materials['deck'].name = 'Hood teak deck'


def mesh(name, vertices, faces, material=None, col=None, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    ob = bpy.data.objects.new(name, data); (col or COL).objects.link(ob); ob['assemblyId'] = ASSEMBLY
    if isinstance(material, str): material = materials[material]
    if material: data.materials.append(material)
    for poly in data.polygons: poly.use_smooth = smooth
    return ob


def box(name, loc, dim, material='naval', col=None, bev=0):
    dx, dy, dz = [v / 2 for v in dim]
    vertices = [(sx * dx, sy * dy, sz * dz) for sx, sy, sz in [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1)]]
    ob = mesh(name, vertices, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material, col); ob.location = loc
    return ob


def cyl(name, loc, radius, depth, material='naval', col=None, vertices=24, r2=None):
    r2 = radius if r2 is None else r2; depth = max(.002, depth)
    vv = [(r * math.cos(2 * math.pi * i / vertices), r * math.sin(2 * math.pi * i / vertices), z) for r, z in [(radius, -depth / 2), (r2, depth / 2)] for i in range(vertices)]
    ff = [tuple(reversed(range(vertices))), tuple(range(vertices, 2 * vertices))] + [(i, (i + 1) % vertices, (i + 1) % vertices + vertices, i + vertices) for i in range(vertices)]
    ob = mesh(name, vv, ff, material, col, True); ob.location = loc
    ob.data.polygons[0].use_smooth = False; ob.data.polygons[1].use_smooth = False
    return ob


def rod(name, a, b, r, material='edge', col=None, r2=None, vertices=10):
    a, b = Vector(a), Vector(b); ob = cyl(name, (a + b) / 2, r, (b - a).length, material, col, vertices, r2)
    ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler(); return ob


def prism(name, outline, base, height, material='naval', col=None, top_material=None):
    if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1])) < 0: outline = list(reversed(outline))
    n = len(outline); vv = [(x, y, z) for z in [base, base + height] for x, y in outline]
    ob = mesh(name, vv, [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)], material, col)
    if top_material:
        ob.data.materials.append(materials[top_material]); ob.data.polygons[1].material_index = 1
    return ob


def tube(name, points, r=.045, material='naval', vertices=8):
    for a, b in zip(points, points[1:]): rod(name, a, b, r, material, vertices=vertices)


def hoop(name, center, rx, ry, tubeR, material='naval', n=32, k=6):
    x, y, z = center; vs = []
    for i in range(n):
        a = math.tau * i / n
        for j in range(k):
            b = math.tau * j / k; vs.append((x + (rx + tubeR * math.cos(b)) * math.cos(a), y + (ry + tubeR * math.cos(b)) * math.sin(a), z + tubeR * math.sin(b)))
    return mesh(name, vs, [(i * k + j, ((i + 1) % n) * k + j, ((i + 1) % n) * k + (j + 1) % k, i * k + (j + 1) % k) for i in range(n) for j in range(k)], material, smooth=True)


def rail(name, points, height=1.0, spacing=2.4):
    for a, b in zip(points, points[1:]):
        a, b = Vector(a), Vector(b); length = (b - a).length
        if length < .05: continue
        for h in [.45, height]: rod(name + ' wire', a + Vector((0, 0, h)), b + Vector((0, 0, h)), .018, 'edge', vertices=5)
        steps = max(1, math.ceil(length / spacing))
        for j in range(steps):
            p = a + (b - a) * (j / steps); rod(name + ' stanchion', p, p + Vector((0, 0, height)), .026, 'naval', vertices=6)


def ladder(name, a, b, w=.6):
    a, b = Vector(a), Vector(b); n = max(3, round((b - a).length / .3)); across = Vector((0, w / 2, 0)) if abs(a.x - b.x) >= abs(a.y - b.y) else Vector((w / 2, 0, 0))
    for side in [-1, 1]: rod(name + ' stile', a + across * side, b + across * side, .035, 'naval', vertices=6)
    for i in range(n + 1):
        p = a.lerp(b, i / n); rod(name + ' tread', p - across, p + across, .03, 'edge', vertices=6)


def octagon(x, y, l, w, c=.25):
    return [(x - l / 2, y - w / 2 + c), (x - l / 2 + c, y - w / 2), (x + l / 2 - c, y - w / 2), (x + l / 2, y - w / 2 + c), (x + l / 2, y + w / 2 - c), (x + l / 2 - c, y + w / 2), (x - l / 2 + c, y + w / 2), (x - l / 2, y + w / 2 - c)]


def pivot(id, loc, col=None):
    ob = bpy.data.objects.new(id, None); (col or COL).objects.link(ob); ob.location = loc; ob['nodeId'] = id; ob['assemblyId'] = ASSEMBLY
    return ob


def attach_world(objects, parent):
    bpy.context.view_layer.update()
    for ob in objects:
        world = ob.matrix_world.copy(); ob.parent = parent; ob.matrix_parent_inverse = Matrix.Identity(4); ob.matrix_world = world
    bpy.context.view_layer.update()


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b: return va + (vb - va) * (s - a) / (b - a) if b > a else va
    return points[0][1] if s < points[0][0] else points[-1][1]


H = D['hull']; L = H['length']
deckz = lambda x: interp(H['deckHeights'], max(0, min(L, x + L / 2)))


def sidewidth(x, z):
    station = max(0, min(L, x + L / 2)); ss = H['sections']
    for aa, bb in zip(ss, ss[1:]):
        if aa['station'] <= station <= bb['station']:
            t = (station - aa['station']) / (bb['station'] - aa['station']) if bb['station'] > aa['station'] else 0
            ps = [(a + (b[0] - a) * t, c + (b[1] - c) * t) for (a, c), b in zip(aa['points'], bb['points'])]
            if z < ps[0][1] or z > ps[-1][1]: return 0
            for (w0, z0), (w1, z1) in zip(ps, ps[1:]):
                if z0 <= z <= z1: return w0 + (w1 - w0) * (z - z0) / max(.00001, z1 - z0)
            return ps[-1][0]
    return 0


def blender(p):
    """Runtime (x starboard, y up, z aft) -> Blender (bow, port, up)."""
    return (-p[2], -p[0], p[1])


def registered(builder, part_id, loc, yaw=0.0, assembly=None, col=None, scale=1.0):
    """Install a registered original construction component at a Blender location."""
    global ASSEMBLY
    reg = catalog('assets/parts/construction-library.json')
    entry = reg['builders'][builder]
    if 'geometry' not in sys.modules:
        spec = importlib.util.spec_from_file_location('geometry', ROOT / 'assets/parts/construction/geometry.py')
        base = importlib.util.module_from_spec(spec); sys.modules['geometry'] = base; spec.loader.exec_module(base)
    spec = importlib.util.spec_from_file_location('hood_component_' + builder.replace('-', '_'), ROOT / entry['path'])
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    part = next(p for p in catalog('assets/parts/construction.json')['equipment'] if p['id'] == part_id)
    before = set(scene.objects)
    helpers = dict(mesh=mesh, cyl=cyl, rod=rod, box=box)
    root = getattr(module, entry['function'])(part, col or COL, helpers, materials)
    root.location = loc; root.rotation_euler.z = yaw; root.scale = (scale, scale, scale)
    name = assembly or part_id
    for ob in set(scene.objects) - before:
        ob['assemblyId'] = name
        if 'nodeId' in ob.keys(): del ob['nodeId']
        ob.name = name + ' ' + ob.name.replace('component.', '')
    return root


# ------------------------------------------------------------------ hull
vv = []; ff = []; n = len(H['sections'][0]['points']); ring = 2 * n
for section in H['sections']:
    x = section['station'] - L / 2; pts = section['points']
    vv.extend([(x, -y, z) for y, z in pts] + [(x, y, z) for y, z in reversed(pts)])
for i in range(len(H['sections']) - 1):
    for j in range(ring): ff.append((i * ring + j, (i + 1) * ring + j, (i + 1) * ring + (j + 1) % ring, i * ring + (j + 1) % ring))
hull = mesh('Hood original section hull', vv, ff, None, smooth=True); hull['nodeId'] = 'hull.surface'
for key in ['hullgray', 'antifouling', 'boot', 'deck', 'naval']: hull.data.materials.append(materials[key])
bm = bmesh.new(); bm.from_mesh(hull.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.00000001)
for z in [-.38, .04]:
    bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=.0000001, plane_co=(0, 0, z), plane_no=(0, 0, 1))
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(hull.data); bm.free()
for p in hull.data.polygons:
    c = p.center; top = deckz(c.x)
    if c.z > top - .03 and p.normal.z > .5: p.material_index = 3; p.use_smooth = False
    elif c.z > top - .03 and abs(p.normal.z) <= .5 and abs(c.y) < sidewidth(c.x, c.z - .05) - .05: p.material_index = 4; p.use_smooth = False
    elif c.z < -.38: p.material_index = 1
    elif c.z < .04: p.material_index = 2
    else: p.material_index = 0

# ------------------------------------------------------------------ batteries
COL = collections['Batteries']
helpers = dict(mesh=mesh, cyl=cyl, rod=rod, box=box)
for mount in D['mounts']:
    ASSEMBLY = mount['id']; spec = mount['weapon']
    x, y, z = blender(mount['position'])
    if mount['battery'] == 'main':
        top = z + spec.get('gunhouseBaseHeight', .25) - .25
        base = deckz(x) - .2
        cyl(mount['name'] + ' • armoured barbette', (x, y, (base + top) / 2), 5.0, top - base, 'hullgray', COL, 64)
        hoop(mount['name'] + ' • barbette lip', (x, y, top - .06), 5.0, 5.0, .05, 'edge', n=64, k=5)
    if spec.get('mountingStyle') == 'pom-pom':
        create_gun_mount(mount, COL, helpers, materials, deckz)
    else:
        create_shared_mount(mount, COL, helpers, materials)
    if mount['partId'] == 'qf-4-mkxix-twin':
        # Low splinter tub on the shelter deck, open toward the ship's centreline.
        r = 3.25; sign = 1 if y > 0 else -1 if y < 0 else 0
        centre = math.atan2(sign, 0) if sign else math.pi
        arc = [centre + math.radians(a) for a in range(-115, 116, 10)]
        pts = [(x + r * math.cos(a), y + r * math.sin(a)) for a in arc]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            ob = box('4-inch splinter shield', ((ax + bx) / 2, (ay + by) / 2, z + .55), (math.hypot(bx - ax, by - ay) + .02, .06, 1.1), 'naval')
            ob.rotation_euler.z = math.atan2(by - ay, bx - ax)
        tube('4-inch shield capping', [(px, py, z + 1.1) for px, py in pts], .035, 'edge', 6)
        for a in arc[::4]:
            rod('4-inch shield stay', (x + r * math.cos(a), y + r * math.sin(a), z + 1.0), (x + (r - .7) * math.cos(a), y + (r - .7) * math.sin(a), z + .02), .03, 'naval', vertices=6)

# ------------------------------------------------------------------ superstructure
COL = collections['Superstructure']
TEAK_TOPS = set()
S = {s['id']: s for s in D['structures']}
for s in D['structures']:
    if s['id'].endswith('funnel'): continue
    ASSEMBLY = s['id']; outline = [(-z, -x) for x, z in s['footprint']]; base = s['baseY']; top = base + s['height']
    prism(s['name'], outline, base, s['height'], 'naval', top_material='deck' if s['id'] in TEAK_TOPS else 'roof')
    prism(s['name'] + ' deck edge', outline, top, .06, 'roof')
    # Scuttles and eyebrows on the long walls; glazing on the bridge tiers.
    glazed = s['id'] in ('bridge-navigation', 'bridge-upper', 'bridge-flag')
    for a, b in zip(outline, outline[1:] + outline[:1]):
        ax, ay = a; bx, by = b; length = math.hypot(bx - ax, by - ay)
        if length < 1.2 or s['height'] < 1.3: continue
        nx, ny = (by - ay) / length, -(bx - ax) / length
        if nx * ((ax + bx) / 2 - sum(p[0] for p in outline) / len(outline)) + ny * ((ay + by) / 2 - sum(p[1] for p in outline) / len(outline)) < 0: nx, ny = -nx, -ny
        if glazed and nx > .35:
            count = max(1, int(length / .9))
            for k in range(count):
                t = (k + .5) / count; px = ax + (bx - ax) * t + nx * .015; py = ay + (by - ay) * t + ny * .015
                ob = box('Bridge window', (px, py, top - .55), (length / count * .72, .03, .55), 'glass'); ob.rotation_euler.z = math.atan2(by - ay, bx - ax)
            continue
        count = int(length / 3.2)
        for k in range(count):
            t = (k + .5) / count; px = ax + (bx - ax) * t + nx * .01; py = ay + (by - ay) * t + ny * .01; zz = top - .95
            if zz < base + .6: continue
            rod('Scuttle rim', (px, py, zz), (px + nx * .05, py + ny * .05, zz), .15, 'edge', vertices=12)
            rod('Scuttle glass', (px + nx * .052, py + ny * .052, zz), (px + nx * .06, py + ny * .06, zz), .105, 'glass', vertices=12)

# Wall fittings: watertight doors, louvred vents and stowed Carley floats on the tiers that
# carry them in the reference, set on the outward face of each long wall.
def wall_frame(a, b, t, outline):
    ax, ay = a; bx, by = b; length = math.hypot(bx - ax, by - ay)
    nx, ny = (by - ay) / length, -(bx - ax) / length
    cx = sum(p[0] for p in outline) / len(outline); cy = sum(p[1] for p in outline) / len(outline)
    if nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0: nx, ny = -nx, -ny
    return ax + (bx - ax) * t, ay + (by - ay) * t, nx, ny, math.atan2(by - ay, bx - ax)


def door(name, x, y, z, nx, ny, angle):
    for label, off, size, mat in [('frame', .03, (1.0, .06, 1.95), 'edge'), ('leaf', .07, (.84, .05, 1.78), 'naval')]:
        box(name + ' ' + label, (x + nx * off, y + ny * off, z + size[2] / 2 + .08), size, mat).rotation_euler.z = angle
    for h in [.45, 1.0, 1.55]:
        box(name + ' dog', (x + nx * .11 + math.cos(angle) * .34, y + ny * .11 + math.sin(angle) * .34, z + h), (.12, .06, .05), 'edge').rotation_euler.z = angle


def vent(name, x, y, z, nx, ny, angle, w=1.1, h=.8):
    box(name + ' box', (x + nx * .12, y + ny * .12, z + h / 2 + .2), (w, .24, h), 'naval').rotation_euler.z = angle
    for k in range(5):
        box(name + ' louvre', (x + nx * .25, y + ny * .25, z + .3 + k * h / 5.5), (w * .86, .05, .05), 'dark').rotation_euler.z = angle


def carley(name, x, y, z, nx, ny, angle):
    ring = hoop(name, (0, 0, 0), 1.0, .55, .16, 'canvas', n=20, k=6)
    ring.rotation_euler = (math.pi / 2, 0, angle); ring.location = (x + nx * .2, y + ny * .2, z)
    for dz in [-.35, .35]: box(name + ' bracket', (x + nx * .1, y + ny * .1, z + dz), (.1, .2, .06), 'edge').rotation_euler.z = angle


ASSEMBLY = 'wall-fittings'
for sid, doors, vents, floats in [('shelter-deck-forward', 9, 7, 6), ('shelter-deck-aft', 2, 2, 2), ('forward-superstructure', 4, 3, 4),
                                  ('midships-deckhouse', 2, 2, 0), ('after-control-tower', 2, 2, 2), ('bridge-flag', 2, 0, 2), ('signal-house-port', 1, 1, 0), ('signal-house-starboard', 1, 1, 0)]:
    s = S[sid]; o = [(-z, -x) for x, z in s['footprint']]; base = s['baseY']
    walls = sorted([(math.hypot(b[0] - a[0], b[1] - a[1]), a, b) for a, b in zip(o, o[1:] + o[:1])], key=lambda w: -w[0])
    walls = [w for w in walls if w[0] > 3.0]
    for i in range(doors):
        length, a, b = walls[i % len(walls)]
        x, y, nx, ny, ang = wall_frame(a, b, .3 + .4 * ((i // len(walls)) % 2), o); door(sid + ' door', x, y, base, nx, ny, ang)
    for i in range(vents):
        length, a, b = walls[(i + 1) % len(walls)]
        x, y, nx, ny, ang = wall_frame(a, b, .62 - .25 * ((i // len(walls)) % 2), o); vent(sid + ' vent', x, y, base, nx, ny, ang)
    for i in range(floats):
        length, a, b = walls[(i + 2) % len(walls)]
        x, y, nx, ny, ang = wall_frame(a, b, .45 + .3 * ((i // len(walls)) % 2), o)
        if s['height'] > 2.2: carley(sid + ' Carley float', x, y, base + min(s['height'] - .9, 2.2), nx, ny, ang)
# Ready-use lockers beside the 4-inch mounts and ladders between the tiers.
ASSEMBLY = 'ready-use-lockers'
for m in D['mounts']:
    if m['partId'] != 'qf-4-mkxix-twin': continue
    x, y, z = blender(m['position']); sign = 1 if y > 0 else -1 if y < 0 else 0
    for dx in ([-4.2, 4.2] if sign else [-4.2]):
        yy = y - sign * 1.2 if sign else 1.6
        box('Ready-use locker', (x + dx, yy, z + .5), (1.4, .8, 1.0), 'naval'); box('Locker lid', (x + dx, yy, z + 1.03), (1.46, .86, .07), 'roof')
ASSEMBLY = 'tier-ladders'
for x, y, z0, z1 in [(28.6, 8.3, 9.2, 12.0), (28.6, -8.3, 9.2, 12.0), (35.0, 6.9, 12.0, 14.13), (35.0, -6.9, 12.0, 14.13), (-45.0, 3.4, 9.2, 11.79), (-35.0, 3.9, 9.2, 13.2)]:
    ladder('Tier ladder', (x - (z1 - z0) * .55, y, z0 + .05), (x, y, z1 + .02), .6)
    for s_ in [-1, 1]: rod('Ladder handrail', (x - (z1 - z0) * .55, y + s_ * .3, z0 + .9), (x, y + s_ * .3, z1 + .9), .022, 'edge', vertices=5)

# Open compass platform: windscreen and rails on the upper tiers.
ASSEMBLY = 'bridge-fittings'
cp = [(-z, -x) for x, z in S['bridge-compass']['footprint']]; ctop = S['bridge-compass']['baseY'] + S['bridge-compass']['height']
rail('Compass platform rail', [(x, y, ctop) for x, y in cp + cp[:1]], 1.05, 1.6)
nav = [(-z, -x) for x, z in S['bridge-navigation']['footprint']]; ntop = S['bridge-navigation']['baseY'] + S['bridge-navigation']['height']
rail('Navigating bridge rail', [(x, y, ntop) for x, y in nav + nav[:1]], 1.0, 2.0)
for sid in ['bridge-base', 'bridge-upper', 'forward-superstructure', 'after-control-tower', 'after-deckhouse-roof', 'midships-deckhouse-upper', 'conning-tower-hood']:
    o = [(-z, -x) for x, z in S[sid]['footprint']]; t = S[sid]['baseY'] + S[sid]['height']
    rail(S[sid]['name'] + ' rail', [(x, y, t) for x, y in o + o[:1]], .95, 2.4)
# Shelter deck guard rails follow the deck edge.
for sid in ['shelter-deck-forward', 'shelter-deck-aft']:
    o = [(-z, -x) for x, z in S[sid]['footprint']]
    for a, b in zip(o, o[1:] + o[:1]):
        if abs(a[0] + 42.8) < .01 and abs(b[0] + 42.8) < .01: continue
        rail('Shelter deck rail', [(a[0], a[1], 9.2), (b[0], b[1], 9.2)], 1.0, 2.4)
# Wing platforms carrying the forward HACS and 12 ft rangefinders.
for side in [-1, 1]:
    prism('HACS sponson', [(28.0, side * 5.5), (31.4, side * 5.5), (31.4, side * 9.3), (28.0, side * 9.3)], 14.0, .14, 'roof')
    rail('HACS sponson rail', [(28.0, side * 9.3, 14.14), (31.4, side * 9.3, 14.14), (31.4, side * 5.5, 14.14)], .95, 1.2)
    for xx in [28.3, 31.1]: rod('HACS sponson strut', (xx, side * 9.0, 13.98), (xx, side * 5.6, 12.1), .06, 'naval', vertices=8)
    prism('Rangefinder wing', [(35.3, side * 3.8), (37.2, side * 3.8), (37.2, side * 6.2), (35.3, side * 6.2)], 14.0, .12, 'roof')
    # Pom-pom director wings abreast the upper bridge.
    prism('Pom-pom director wing', [(28.4, side * 2.8), (31.9, side * 2.8), (31.9, side * 5.6), (28.4, side * 5.6)], 19.18, .12, 'roof')
    rail('Pom-pom director wing rail', [(28.4, side * 5.6, 19.3), (31.9, side * 5.6, 19.3), (31.9, side * 2.8, 19.3)], .95, 1.2)
    for xx in [28.7, 31.6]: rod('Director wing strut', (xx, side * 5.4, 19.16), (xx, side * 3.0, 17.9), .06, 'naval', vertices=8)
    rod('Rangefinder wing strut', (36.2, side * 6.0, 13.98), (36.2, side * 3.9, 12.1), .06, 'naval', vertices=8)

# ------------------------------------------------------------------ funnels
COL = collections['Funnels']
for sid in ['forward-funnel', 'after-funnel']:
    s = S[sid]; zc = sum(p[1] for p in s['footprint']) / len(s['footprint'])
    registered('hood-forward-funnel', 'hood-forward-funnel', (-zc, 0, s['baseY']), 0, sid, COL)

# ------------------------------------------------------------------ foremast, spotting top and director
COL = collections['Masts and directors']; ASSEMBLY = 'foremast'
black = 'black'
rod('Foremast pole', (33.45, 0, 12.0), (33.45, 0, 32.0), .53, 'naval', r2=.46, vertices=20)
rod('Foremast upper pole', (33.45, 0, 32.0), (33.45, 0, 38.8), .40, black, r2=.30, vertices=16)
rod('Foretopmast', (33.45, 0, 38.8), (33.45, 0, 45.2), .17, black, r2=.07, vertices=10)
for side in [-1, 1]:
    rod('Foremast tripod leg', (29.2, side * 4.9, 12.0), (32.8, side * .8, 31.6), .47, 'naval', r2=.42, vertices=16)
    rod('Upper leg collar', (32.65, side * 1.05, 29.6), (32.8, side * .8, 31.6), .48, black, vertices=16)
    for zz in [16.0, 20.5, 25.4]:
        t = (zz - 12.0) / 19.6; px = 29.2 + 3.6 * t; py = side * (4.9 - 4.1 * t)
        rod('Tripod cross tie', (px, py, zz), (33.45, 0, zz), .07, 'naval', vertices=8)
ladder('Foremast ladder', (33.95, 0, 25.0), (33.95, 0, 31.5), .45)
star = [(38.7, 0), (34.6, 1.7), (31.2, 5.1), (29.4, 2.7), (27.1, 0), (29.4, -2.7), (31.2, -5.1), (34.6, -1.7)]
prism('Spotting top platform', star, 32.1, .22, black)
rail('Spotting top rail', [(x, y, 32.32) for x, y in star + star[:1]], .9, 1.4)
cyl('Spotting top support cone', (33.2, 0, 31.4), .8, 1.4, black, vertices=24, r2=2.1)
# Small lookout platform and signal gaff abaft the pole below the top.
prism('Mast lookout platform', octagon(30.6, 0, 2.0, 2.6, .3), 28.9, .12, black)
rail('Mast lookout rail', [(x, y, 29.02) for x, y in octagon(30.6, 0, 2.0, 2.6, .3)], .9, 1.2)
for side in [-1, 1]: rod('Lookout bracket', (29.7, side * 1.1, 28.9), (32.9, side * .5, 27.6), .06, black, vertices=8)
rod('Signal gaff', (32.9, 0, 29.2), (27.6, 0, 29.3), .07, black, vertices=8)
house = [(38.9, 0), (38.0, 1.2), (36.1, 1.3), (35.4, 1.9), (34.4, 2.0), (33.2, 2.8), (31.1, 2.8), (31.1, -2.8), (33.2, -2.8), (34.4, -2.0), (35.4, -1.9), (36.1, -1.3), (38.0, -1.2)]
prism('Spotting top house', house, 32.32, 2.55, black)
prism('Spotting top roof', house, 34.87, .08, black)
for side in [-1, 1]:
    for zz in [33.2, 34.2]:
        box('Spotting top window', (38.0, side * .7, zz + .2), (.02, 1.0, .35), 'glass').rotation_euler.z = side * math.radians(-50)
for zz, span in [(29.3, 9.8), (34.9, 9.3), (44.0, 2.2)]:
    rod('Foremast yard', (33.2, -span, zz), (33.2, span, zz), .08, black, r2=.08, vertices=10)
    for side in [-1, 1]:
        rod('Yard lift', (33.2, side * span * .92, zz), (33.45, 0, zz + 2.2), .016, 'edge', vertices=4)
        for k in range(1, 5): rod('Signal halyard', (33.2, side * span * k / 5, zz), (29.5, side * 5.5, 25.2), .007, 'edge', vertices=4)
for side in [-1, 1]:
    rod('Foremast shroud', (33.45, side * .4, 30.5), (27.5, side * 9.0, 14.2), .014, 'edge', vertices=4)
ASSEMBLY = 'dct-foretop'; before = set(scene.objects)
dct = octagon(33.7, 0, 4.4, 3.6, .55)
cyl('DCT roller path', (33.7, 0, 35.05), 1.5, .3, 'edge', vertices=32)
prism('DCT cabinet', dct, 35.2, 2.1, 'naval')
prism('DCT hood', octagon(33.4, 0, 3.0, 3.0, .45), 37.3, .9, 'naval')
box('DCT sight ports', (35.92, 0, 36.6), (.03, 2.2, .42), 'glass')
rod('DCT rangefinder', (33.3, -3.4, 36.7), (33.3, 3.4, 36.7), .22, 'naval', vertices=20)
for side in [-1, 1]:
    prism('DCT rangefinder hood', octagon(33.3, side * 3.4, 1.0, .7, .15), 36.3, .8, 'naval')
    rod('284 arm', (33.4, side * .9, 38.2), (34.2, side * 2.4, 38.8), .06, 'naval', vertices=8)
# Type 284 aerial: one broad mattress of vertical dipoles across the director roof.
for dz in [-.52, .52]: rod('284 aerial frame', (34.2, -3.4, 39.25 + dz), (34.2, 3.4, 39.25 + dz), .045, 'edge', vertices=6)
for k in range(28): rod('284 dipole', (34.2, -3.35 + k * .248, 38.78), (34.2, -3.35 + k * .248, 39.72), .018, 'naval', vertices=5)
for dz in [-.25, 0, .25]: rod('284 aerial wire', (34.23, -3.35, 39.25 + dz), (34.23, 3.35, 39.25 + dz), .012, 'edge', vertices=4)
node = pivot('dct-foretop.yaw', (33.7, 0, 35.05)); attach_world(set(scene.objects) - before - {node}, node)

# Conning-tower director with its 30 ft rangefinder (reference BD_1 housing).
ASSEMBLY = 'ct-director'; before = set(scene.objects)
cyl('CT director roller', (45.85, 0, 18.55), 1.6, .3, 'edge', vertices=32)
prism('CT director cabinet', octagon(45.85, 0, 3.4, 2.8, .5), 18.7, 1.5, 'naval')
prism('CT director roof', octagon(45.6, 0, 2.8, 2.4, .45), 20.2, .45, 'roof')
rod('30 ft rangefinder', (45.1, -5.1, 19.8), (45.1, 5.1, 19.8), .24, 'naval', vertices=20)
for side in [-1, 1]: prism('30 ft rangefinder hood', octagon(45.1, side * 5.1, 1.0, .7, .15), 19.4, .8, 'naval')
box('CT director sight port', (47.52, 0, 19.6), (.03, 1.8, .4), 'glass')
node = pivot('ct-director.yaw', (45.85, 0, 18.4)); attach_world(set(scene.objects) - before - {node}, node)


def director(id, x, y, z, kind):
    """HACS Mk III (curved hood, side optics) or pom-pom director (pedestal sight)."""
    global ASSEMBLY
    ASSEMBLY = id; before = set(scene.objects)
    if kind == 'hacs':
        cyl('HACS roller', (x, y, z + .2), .95, .4, 'edge', vertices=28)
        prism('HACS cabinet', octagon(x, y, 2.6, 2.1, .38), z + .4, 1.4, 'naval')
        arch = [(-1.2, 1.25), (-1.1, 2.0), (-.65, 2.45), (.2, 2.6), (.85, 2.3), (1.25, 1.6)]
        vs = [(x + dx, y + side * 1.0, z + zz) for side in [-1, 1] for dx, zz in arch]
        mesh('HACS curved roof', vs, [(i, i + 1, i + 7, i + 6) for i in range(5)], 'naval')
        for side in [-1, 1]:
            rod('HACS optical tube', (x - .25, y + side * .95, z + 1.6), (x - .25, y + side * 1.9, z + 1.6), .16, 'naval', vertices=14)
            box('HACS rangefinder hood', (x - .25, y + side * 1.95, z + 1.6), (.7, .42, .6), 'naval')
        box('HACS sight aperture', (x + 1.27, y, z + 1.65), (.025, 1.4, .45), 'dark')
    else:
        cyl('Director pedestal', (x, y, z + .45), .22, .9, 'naval', vertices=12)
        box('Director optical body', (x, y, z + 1.05), (.62, .65, .36), 'naval')
        for dy in [-.35, .35]: rod('Director binocular', (x - .1, y + dy, z + 1.15), (x + .5, y + dy, z + 1.15), .1, 'edge', vertices=10)
        rod('Director sight rail', (x + .15, y, z + .6), (x + .15, y, z + 1.55), .035, 'naval', vertices=6)
    node = pivot(id + '.yaw', (x, y, z)); attach_world(set(scene.objects) - before - {node}, node)


for id, (x, y, z), kind in [('hacs-p', (29.5, 7.6, 14.14), 'hacs'), ('hacs-s', (29.5, -7.6, 14.14), 'hacs'), ('hacs-aft', (-39.5, 0, 18.3), 'hacs'),
                            ('pom-pom-director-p', (30.4, 4.4, 19.3), 'pp'), ('pom-pom-director-s', (30.4, -4.4, 19.3), 'pp'), ('pom-pom-director-aft', (-42.8, 0, 16.25), 'pp')]:
    director(id, x, y, z, kind)
ASSEMBLY = 'hacs-aft-pedestal'
cyl('After HACS pedestal', (-39.5, 0, 17.25), 1.02, 2.1, 'naval', vertices=24)
for side in [-1, 1]:
    ASSEMBLY = 'rangefinder-12ft-' + ('p' if side > 0 else 's'); before = set(scene.objects)
    cyl('12 ft rangefinder pedestal', (36.2, side * 5.0, 14.6), .2, .9, 'naval', vertices=12)
    rod('12 ft rangefinder', (36.2, side * 5.0 - 1.85, 15.2), (36.2, side * 5.0 + 1.85, 15.2), .13, 'naval', vertices=14)
    for dy in [-1.85, 1.85]: box('Rangefinder end window', (36.2, side * 5.0 + dy, 15.2), (.22, .08, .22), 'dark')
    node = pivot(ASSEMBLY + '.yaw', (36.2, side * 5.0, 14.14)); attach_world(set(scene.objects) - before - {node}, node)

# Mainmast: vertical lower mast, offset topmast, raked tripod legs, triangular signal platform.
ASSEMBLY = 'mainmast'
rod('Main lower mast', (-28.6, 0, 9.2), (-28.6, 0, 27.6), .6, 'naval', r2=.5, vertices=18)
rod('Main topmast', (-30.1, 0, 24.6), (-30.1, 0, 43.5), .25, 'black', r2=.08, vertices=12)
box('Mast doubling', (-29.35, 0, 26.2), (2.2, .9, 3.2), 'black')
for side in [-1, 1]:
    rod('Mainmast tripod leg', (-32.0, side * 3.4, 9.2), (-29.2, side * .45, 24.8), .5, 'naval', r2=.4, vertices=14)
    for zz in [14.0, 19.0]:
        t = (zz - 9.2) / 15.6; rod('Mainmast cross tie', (-32.0 + 2.8 * t, side * (3.4 - 2.95 * t), zz), (-28.6, 0, zz), .07, 'naval', vertices=8)
prism('Mainmast top', octagon(-29.3, 0, 2.6, 2.4, .35), 24.55, .15, 'black')
rail('Mainmast top rail', [(x, y, 24.7) for x, y in octagon(-29.3, 0, 2.6, 2.4, .35)], .85, 1.2)
signal = [(-26.5, 0), (-29.9, 4.9), (-33.6, 0), (-29.9, -4.9)]
prism('Signal platform', signal, 28.05, .15, 'black')
rail('Signal platform rail', [(x, y, 28.2) for x, y in signal + signal[:1]], .9, 1.5)
cyl('Signal platform cone', (-30.1, 0, 27.3), .35, 1.5, 'black', vertices=20, r2=1.9)
for x, y in signal: rod('Signal platform strut', (x * .92 - 2.4, y * .85, 28.05), (-30.1, 0, 26.2), .05, 'black', vertices=6)
for zz in [20.7, 22.3, 23.8]:
    rod('Mast signal lamp', (-28.0, 0, zz), (-27.55, 0, zz), .26, 'naval', vertices=16)
    rod('Mast lamp lens', (-27.55, 0, zz), (-27.53, 0, zz), .21, 'bright', vertices=16)
    rod('Lamp bracket', (-28.0, 0, zz - .25), (-27.7, 0, zz - .25), .04, 'edge', vertices=6)
prism('Masthead lookout', octagon(-30.1, 0, 1.1, 1.0, .2), 38.6, 1.0, 'black')
rod('Main topmast yard', (-30.1, -1.8, 42.0), (-30.1, 1.8, 42.0), .05, 'black', vertices=8)
ladder('Mainmast ladder', (-28.0, 0, 9.4), (-28.0, 0, 24.5), .45)
for side in [-1, 1]:
    rod('Mainmast shroud', (-30.1, side * .3, 38.0), (-30.1, side * 4.9, 28.2), .014, 'edge', vertices=4)
    rod('Mainmast backstay', (-30.1, side * .3, 42.5), (-33.6, side * 3.0, 28.2), .014, 'edge', vertices=4)
ASSEMBLY = 'radar-279'; before = set(scene.objects)
for dz in [0, .8]:
    rod('Type 279 crossbar', (-30.1, -1.8, 43.4 + dz), (-30.1, 1.8, 43.4 + dz), .04, 'edge', vertices=6)
    for yy in [-1.6, -.8, 0, .8, 1.6]: rod('Type 279 dipole', (-30.5, yy, 43.4 + dz), (-29.7, yy, 43.4 + dz), .022, 'naval', vertices=6)
radar_pivot('radar-279.yaw', (-30.1, 0, 43.4), set(scene.objects) - before)
ASSEMBLY = 'ensign-gaff'
rod('Ensign gaff', (-30.4, 0, 24.8), (-38.4, 0, 29.4), .09, 'black', r2=.05, vertices=10)
rod('Gaff peak halyard', (-38.4, 0, 29.4), (-30.3, 0, 34.0), .012, 'edge', vertices=4)
cyl('Gaff jaws', (-30.35, 0, 24.8), .22, .4, 'black', vertices=12)
ASSEMBLY = 'wireless-aerials'
for y in [-.4, .4]: rod('Wireless aerial', (33.45, y, 42.5), (-30.1, y, 40.5), .01, 'edge', vertices=4)

# ------------------------------------------------------------------ light AA, UP projectors and searchlights
COL = collections['Light AA']


def up_projector(id, x, y, z, bearing, parent=None):
    """20-barrel UP projector: tube cluster in a boxed cradle on a training pedestal."""
    global ASSEMBLY
    ASSEMBLY = id; before = set(scene.objects)
    cyl('UP training base', (0, 0, .12), .75, .24, 'edge', vertices=24)
    cyl('UP pedestal', (0, 0, .55), .38, .7, 'naval', vertices=16)
    for side in [-1, 1]:
        box('UP trunnion bracket', (0, side * 1.0, 1.05), (.5, .1, .7), 'naval')
    body = box('UP projector box', (.05, 0, 1.55), (1.45, 1.9, 1.5), 'naval'); body.rotation_euler.y = math.radians(-35)
    for i in range(4):
        for j in range(5):
            ob = rod('UP barrel mouth', (0, 0, 0), (0, 0, .03), .1, 'dark', vertices=10)
            local = Matrix.Translation((.05, 0, 1.55)) @ Matrix.Rotation(math.radians(-35), 4, 'Y') @ Matrix.Translation((.735, -.72 + j * .36, -.54 + i * .36)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
            ob.matrix_world = local
    box('UP loading platform', (-.9, 0, .32), (.9, 1.8, .08), 'roof')
    for side in [-1, 1]: rod('UP handwheel', (-.4, side * .98, .9), (-.4, side * 1.12, .9), .2, 'edge', vertices=16)
    node = pivot(id + '.yaw', (0, 0, 0)); attach_world(set(scene.objects) - before - {node}, node)
    node.location = (x, y, z); node.rotation_euler.z = -math.radians(bearing)
    if parent: attach_world([node], parent)
    return node


def vickers_quad(id, x, y, z, bearing):
    """Quadruple .50 Vickers Mk III: stacked guns, side drums, pedestal and sights."""
    global ASSEMBLY
    ASSEMBLY = id; before = set(scene.objects)
    cyl('Vickers pedestal foot', (0, 0, .08), .42, .16, 'edge', vertices=16)
    cyl('Vickers pedestal', (0, 0, .5), .16, .8, 'naval', vertices=12)
    box('Vickers cradle', (.15, 0, 1.05), (.9, .36, .62), 'naval')
    for side in [-1, 1]:
        box('Vickers trunnion', (.05, side * .22, 1.05), (.2, .1, .2), 'edge')
        cyl('Vickers ammunition drum', (.1, side * .38, 1.05), .24, .16, 'edge', vertices=20).rotation_euler.x = math.pi / 2
    for i in range(4):
        zz = .82 + i * .155
        rod('Vickers water jacket', (-.25, 0, zz), (.72, 0, zz), .045, 'naval', vertices=10)
        rod('Vickers barrel', (.72, 0, zz), (1.28, 0, zz), .016, 'edge', vertices=8)
        rod('Vickers muzzle booster', (1.25, 0, zz), (1.34, 0, zz), .026, 'edge', vertices=8)
    for side in [-1, 1]:
        box('Vickers gunner shoulder rest', (-.45, side * .32, 1.0), (.14, .22, .3), 'canvas')
        rod('Vickers sight arm', (-.1, side * .35, 1.45), (.3, side * .35, 1.45), .02, 'edge', vertices=6)
    ring = hoop('Vickers ring sight', (0, 0, 0), .12, .12, .012, 'edge', n=16, k=4); ring.rotation_euler.y = math.pi / 2; ring.location = (.32, 0, 1.55)
    node = pivot(id + '.yaw', (0, 0, 0)); attach_world(set(scene.objects) - before - {node}, node)
    node.location = (x, y, z); node.rotation_euler.z = -math.radians(bearing)


def searchlight(id, x, y, z, big=True, facing=0):
    global ASSEMBLY
    ASSEMBLY = id; r = .56 if big else .32
    cyl('Searchlight pedestal', (x, y, z + .35), .22 if big else .14, .7, 'naval', vertices=12)
    for dy in [-r - .08, r + .08]: rod('Searchlight yoke', (x, y + dy, z + .6), (x, y + dy, z + .6 + r * 1.3), .06, 'naval', vertices=8)
    ob = rod('Searchlight barrel', (x - r * .9, y, z + .6 + r * 1.25), (x + r * .9, y, z + .6 + r * 1.25), r, 'naval', vertices=28)
    rod('Searchlight lens', (x + r * .9, y, z + .6 + r * 1.25), (x + r * .92, y, z + .6 + r * 1.25), r * .88, 'bright', vertices=28)


# UP projectors on raised sponsons and on B turret roof; the Vickers quads on bridge and after wings.
for side in [-1, 1]:
    for (x, y), bearing in [((22.2, 10.97), 90), ((-15.5, 13.14), 90)]:
        ASSEMBLY = 'up-sponson'
        o = [(x + 2.3 * math.cos(a * math.tau / 24), side * y + 2.1 * math.sin(a * math.tau / 24)) for a in range(24)]
        prism('UP sponson platform', o, 9.2, .12, 'roof')
        arc = [p for p in o if side * (p[1] - side * y) > -.6]
        for (ax, ay), (bx, by) in zip(arc, arc[1:]):
            ob = box('UP sponson bulwark', ((ax + bx) / 2, (ay + by) / 2, 9.8), (math.hypot(bx - ax, by - ay) + .02, .05, 1.1), 'naval'); ob.rotation_euler.z = math.atan2(by - ay, bx - ax)
        up_projector(f'up-{"p" if side > 0 else "s"}-{"fwd" if x > 0 else "aft"}', x, side * y, 9.32, -side * bearing)
yawB = next(o for o in scene.objects if o.get('nodeId') == 'main-b.yaw')
_bgh = next(m['weapon'] for m in D['mounts'] if m['id'] == 'main-b')['gunhouseMesh']['vertices']
# Seat the roof projector on the B gunhouse roof: highest shell vertex near its station, plus the turret datum.
_roof = max(z for x, y, z in _bgh if abs(x - (55.12 - 60.746)) < 1.2 and abs(y) < 1.5)
up_projector('up-main-b', 55.12, 0, 10.45 + _roof - .02, 0, None)
upb = next(o for o in scene.objects if o.get('nodeId') == 'up-main-b.yaw'); attach_world([upb], yawB)
for (x, y, z), bearing in [((42.38, 5.39, 14.13), -90), ((42.38, -5.39, 14.13), 90), ((-37.69, 6.71, 11.82), -90), ((-37.69, -6.71, 11.82), 90)]:
    ASSEMBLY = 'vickers-platform'
    o = octagon(x, y, 2.6, 2.4, .4) if z < 13 else [(x + 1.35 * math.cos(a * math.tau / 20), y + 1.35 * math.sin(a * math.tau / 20)) for a in range(20)]
    prism('Vickers platform', o, z - .14, .14, 'roof')
    rail('Vickers platform rail', [(px, py, z) for px, py in o if (py - y) * y >= -.2 * abs(y)] , .9, 1.2)
    if z < 13:
        rod('Vickers platform support', (x, y, z - .14), (x, y * .6, 9.2), .1, 'naval', vertices=8)
    else:
        # Knee brackets carry the forward platforms off the bridge-base wall.
        for dx in [-.8, .8]: rod('Vickers platform knee', (x + dx, y, z - .14), (x + dx, y * .72, z - 1.7), .07, 'naval', vertices=8)
    vickers_quad(f'vickers-{"p" if y > 0 else "s"}-{"fwd" if x > 0 else "aft"}', x, y, z, bearing)
for id, (x, y, z), big in [('searchlight-20-pf', (28.75, 4.5, 17.2), False), ('searchlight-20-sf', (28.75, -4.5, 17.2), False),
                           ('searchlight-20-pl', (27.85, 8.7, 12.45), False), ('searchlight-20-sl', (27.85, -8.7, 12.45), False),
                           ('searchlight-44-pm', (-3.0, 7.5, 11.6), True), ('searchlight-44-sm', (-3.0, -7.5, 11.6), True),
                           ('searchlight-44-pa', (-35.0, 5.3, 13.3), True), ('searchlight-44-sa', (-35.0, -5.3, 13.3), True),
                           ('searchlight-44-pt', (-36.6, 2.5, 16.25), True), ('searchlight-44-st', (-36.6, -2.5, 16.25), True)]:
    if z < 16:
        ASSEMBLY = 'searchlight-platform'; pr = 1.7 if big else 1.1
        o = [(x + pr * math.cos(a * math.tau / 20), y + pr * math.sin(a * math.tau / 20)) for a in range(20)]
        prism('Searchlight platform', o, z - .12, .12, 'roof')
        rail('Searchlight platform rail', [(px, py, z) for px, py in o + o[:1]], .9, 1.4)
        rod('Searchlight platform column', (x, y, z - .12), (x, y, 9.2 if z < 13 else 12.0), .16, 'naval', vertices=12)
    searchlight(id, x, y, z, big)

# ------------------------------------------------------------------ boats and boat stowage
COL = collections['Boats']


def boat(name, x, y, z, length, width, motor=False, cabin=False, seat=None):
    global ASSEMBLY
    ASSEMBLY = name; n = 32; outline = []
    for i in range(n):
        t = i * math.tau / n; xx = length / 2 * math.cos(t); yy = width / 2 * math.sin(t) * (1 - .22 * math.cos(t)); outline.append((xx, yy))
    vs = []
    for scale, zz in [(.62, 0), (.9, .45), (1, .82), (.93, .84), (.7, .3)]:
        vs.extend([(x + xx * scale, y + yy * scale, z + zz + (.18 * abs(xx / (length / 2)) ** 3 if zz > .7 else 0)) for xx, yy in outline])
    ff = [tuple(reversed(range(n))), tuple(range(4 * n, 5 * n))] + [(j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i) for j in range(4) for i in range(n)]
    mesh('Boat hull', vs, ff, 'naval', smooth=True)
    tube('Boat gunwale', [(x + xx, y + yy, z + .84 + .18 * abs(xx / (length / 2)) ** 3) for xx, yy in outline + outline[:1]], .045, 'wood', 6)
    for dx in [-length * .28, -length * .08, length * .14, length * .32]: box('Boat thwart', (x + dx, y, z + .62), (.26, width * .78, .07), 'wood')
    floor = z - .36 if seat is None else seat
    for dx in [-length * .26, length * .26]:
        box('Boat chock', (x + dx, y, (z + .1 + floor) / 2), (.3, width * .82, z + .1 - floor), 'edge')
    if cabin:
        box('Boat cabin', (x + length * .08, y, z + 1.15), (length * .34, width * .7, .75), 'white')
        box('Boat cabin glass', (x + length * .25, y, z + 1.25), (.02, width * .5, .35), 'glass')
        rod('Boat exhaust', (x - length * .05, y, z + .9), (x - length * .05, y, z + 1.9), .09, 'edge', vertices=10)


for name, (x, y, z), (l, w), motor, cabin in [
        ('boat-pinnace-p', (-12.9, 3.1, 9.95), (13.9, 3.8), True, True), ('boat-pinnace-s', (-12.9, -2.9, 9.95), (12.9, 3.8), True, True),
        ('boat-whaler-p', (-13.0, 3.1, 11.05), (8.5, 1.8), False, False), ('boat-whaler-s', (-13.0, -3.0, 11.05), (8.4, 1.9), False, False),
        ('boat-motor-1', (-28.3, 5.4, 9.95), (10.7, 2.7), True, True), ('boat-motor-2', (-14.4, 7.9, 9.95), (10.7, 2.7), True, True),
        ('boat-motor-3', (-13.7, -6.2, 9.95), (10.7, 2.7), True, True), ('boat-gig', (-28.9, -5.1, 9.6), (9.8, 1.8), False, False),
        ('boat-motor-25-p', (5.4, 11.8, 9.6), (7.6, 2.3), True, True), ('boat-motor-25-s', (15.9, -7.5, 9.6), (7.6, 2.3), True, True),
        ('boat-motor-16', (11.4, -3.4, 13.25), (4.9, 1.7), True, False), ('boat-dinghy', (11.4, 3.4, 13.25), (4.8, 1.7), False, False)]:
    boat(name, x, y, z, l, w, motor, cabin, seat={'boat-motor-16': 12.93, 'boat-dinghy': 12.93}.get(name, 9.2 if z < 10.5 else None))
ASSEMBLY = 'boat-skids'
for x in [-6.0, -9.0, -16.5, -19.5, -25.0, -31.5]:
    for side in [-1, 1]:
        rod('Boat skid beam', (x, side * .6, 9.9), (x, side * 8.8, 9.9), .09, 'naval', vertices=8)
        rod('Boat skid pillar', (x, side * 8.4, 9.2), (x, side * 8.4, 9.9), .08, 'naval', vertices=8)
# 32 ft cutters swung out on davits abreast the after superstructure.
for side in [-1, 1]:
    boat('boat-cutter-' + ('p' if side > 0 else 's'), -36.9, side * 17.1, 9.8, 10.3, 2.7)
    ASSEMBLY = 'cutter-davits'
    for dx in [-4.2, 4.2]:
        tube('Cutter davit', [(-36.9 + dx, side * 14.2, 9.2), (-36.9 + dx, side * 15.0, 13.4), (-36.9 + dx, side * 17.1, 13.9)], .1, 'naval', 12)
        rod('Davit fall', (-36.9 + dx, side * 17.1, 13.9), (-36.9 + dx * .8, side * 17.1, 10.6), .015, 'edge', vertices=4)

# ------------------------------------------------------------------ deck fittings
COL = collections['Deck fittings']
ASSEMBLY = 'deck-rails'
for side in [-1, 1]:
    for x0, x1 in [(-L / 2 + 1.5, -43.0), (51.6, L / 2 - 2.0)]:
        pts = [(x, side * max(.05, sidewidth(x, deckz(x) - .01) - .15), deckz(x)) for x in [x0 + i * (x1 - x0) / 60 for i in range(61)]]
        rail('Deck perimeter', pts, 1.0, 2.4)
ASSEMBLY = 'forecastle'
for side in [-1, 1]:
    for x in [103.5, 108.5]:
        zz = deckz(x); y = side * 2.6
        cyl('Capstan foundation', (x, y, zz + .1), .95, .2, 'roof', vertices=32)
        cyl('Capstan', (x, y, zz + .6), .62, .8, 'naval', vertices=24)
        cyl('Capstan drum lip', (x, y, zz + 1.05), .74, .12, 'edge', vertices=24)
    for k in range(70):
        x = 107 + k * .2; yy = side * (2.4 + k * .012); zz = deckz(x)
        ob = hoop('Anchor chain link', (x, yy, zz + .1), .13, .08, .025, 'edge', n=10, k=5)
        if k % 2: ob.rotation_euler.x = math.pi / 2; ob.location = (0, yy + zz + .1, zz + .1 - yy)
    x = 121.0; zz = 5.3; yy = side * (sidewidth(x, zz) + .05)
    h = hoop('Hawse lip', (0, 0, 0), .62, .44, .12, 'naval', n=24, k=6); h.rotation_euler.x = math.pi / 2; h.location = (x, yy, zz + .3)
    rod('Anchor shank', (x, yy, zz + .5), (x - 1.0, yy, zz - 1.7), .14, 'edge', vertices=12)
    rod('Anchor crown', (x - 1.8, yy, zz - 1.7), (x - .2, yy, zz - 2.0), .19, 'edge', vertices=12)
    for dx in [-1.85, -.25]:
        mesh('Anchor fluke', [(x + dx, yy, zz - 1.85), (x + dx + .45, yy + side * .35, zz - .6), (x + dx - .35, yy + side * .35, zz - .7)], [(0, 1, 2)], 'edge')
    box('Paravane', (45.5, side * 5.6, 7.2), (3.0, .6, .8), 'naval')
    rod('Paravane nose', (47.0, side * 5.6, 7.2), (47.4, side * 5.6, 7.2), .28, 'naval', r2=.05, vertices=12)
for x in [-120, -110, -98, -60, 64, 75, 96, 115]:
    for side in [-1, 1]:
        ASSEMBLY = 'bollards'; y = side * max(.6, sidewidth(x, deckz(x) - .05) - 1.1); z = deckz(x)
        box('Bollard base', (x, y, z + .06), (1.5, .8, .12), 'roof')
        for dx in [-.45, .45]:
            cyl('Mooring bollard', (x + dx, y, z + .45), .2, .75, 'naval', vertices=16)
            cyl('Bollard cap', (x + dx, y, z + .84), .25, .1, 'edge', vertices=16)
for x in [-118, -104, -90, -56, 58, 70, 92, 99]:
    for side in [-1, 1]:
        ASSEMBLY = 'deck-hatches'; z = deckz(x); y = side * min(3.0, sidewidth(x, z - .05) * .4)
        prism('Hatch coaming', octagon(x, y, 1.4, .95, .14), z, .25, 'roof')
        prism('Hatch leaf', octagon(x, y, 1.28, .84, .1), z + .25, .07, 'naval')
for x in [-100, -80, 62, 80]:
    for side in [-1, 1]:
        ASSEMBLY = 'ventilators'; z = deckz(x); y = side * max(1.2, sidewidth(x, z - .05) - 2.8)
        box('Ventilator trunk', (x, y, z + .6), (1.1, .8, 1.2), 'naval')
        for k in range(6): box('Ventilator louvre', (x + .56, y, z + .22 + k * .16), (.05, .7, .045), 'dark')
ASSEMBLY = 'jackstaff'
rod('Jackstaff', (131.0, 0, deckz(130.5)), (131.0, 0, deckz(130.5) + 4.2), .06, 'naval', r2=.03, vertices=10)
ASSEMBLY = 'hull-scuttles'
for x in list(range(-104, -48, 3)) + list(range(50, 118, 3)):
    for side in [-1, 1]:
        for z in ([3.9, 5.2] if x > 0 else [1.0]):
            if z > deckz(x) - .5: continue
            y = side * (sidewidth(x, z) + .015)
            if abs(y) < .3: continue
            rod('Hull scuttle rim', (x, y, z), (x, y + side * .04, z), .15, 'edge', vertices=12)
            rod('Hull scuttle glass', (x, y + side * .042, z), (x, y + side * .05, z), .105, 'dark', vertices=12)

# ------------------------------------------------------------------ underwater fittings
COL = collections['Underwater fittings']
for i, (y, x, z) in enumerate([(-6.9, -103.0, -7.1), (-3.3, -115.1, -7.9), (3.3, -115.1, -7.9), (6.9, -103.0, -7.1)], 1):
    ASSEMBLY = 'shaft-' + str(i)
    ystart = y * .75
    rod('Propeller shaft', (x + 32, ystart, z + 2.2), (x, y, z), .26, 'edge', vertices=16)
    for sign in [-1, 1]: rod('A-bracket strut', (x + 1.6, y, z), (x + 3.4, y * .8 + sign * 1.2, z + 2.6), .17, 'antifouling', vertices=10)
    before = set(scene.objects); rod('Propeller hub', (x - 1.0, y, z), (x + .7, y, z), .48, 'bronze', r2=.26, vertices=24)
    for j in range(3):
        a = math.tau * j / 3 + (.3 if y > 0 else -.3); shape = [(.35, -.14), (1.0, -.58), (1.8, -.42), (2.1, .08), (1.65, .65), (.62, .48)]
        vs = [(x + .2 * r, y + r * math.cos(a) - t * math.sin(a), z + r * math.sin(a) + t * math.cos(a)) for r, t in shape]
        mesh('Three-bladed propeller', vs, [tuple(range(len(vs)))], 'bronze')
    node = pivot('propeller-' + str(i) + '.spin', (x, 0, 0)); node.location = (x, y, z); attach_world(set(scene.objects) - before - {node}, node)
ASSEMBLY = 'rudder'; before = set(scene.objects)
vs = [(x, s * .34, z) for s in [-1, 1] for x, z in [(-116.6, -3.6), (-123.3, -3.9), (-123.1, -9.0), (-116.8, -9.0)]]
mesh('Balanced rudder', vs, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'antifouling')
rod('Rudder stock', (-118.6, 0, -3.6), (-118.6, 0, -2.2), .3, 'edge', vertices=12)
node = pivot('rudder.yaw', (-118.6, 0, -6.0)); attach_world(set(scene.objects) - before - {node}, node)
for side in [-1, 1]:
    ASSEMBLY = 'bilge-keel-' + str(side)
    pts = [(x, side * sidewidth(x, -8.6), -8.6) for x in [-50, -30, -10, 10, 30, 50, 70]]
    for a, b in zip(pts, pts[1:]): mesh('Bilge keel', [a, b, (b[0], b[1] + side * .7, b[2] - .3), (a[0], a[1] + side * .7, a[2] - .3)], [(0, 1, 2, 3)], 'antifouling')

# ------------------------------------------------------------------ landmarks, simulation volumes, appearance
COL = collections['Masts and directors']; ASSEMBLY = 'landmarks'
for id, pos in [('funnel-cap', (22.42, 0, 23.3)), ('foremast-top', (33.45, 0, 45.2)), ('mainmast-top', (-30.1, 0, 44.1)), ('fore-director', (33.7, 0, 35.05)), ('bridge-front', (39.5, 0, 25.0))]:
    pivot('landmark.' + id, pos)
COL = collections['Simulation volumes']
for group in ['armor', 'modules', 'compartments', 'obstructions']:
    for v in D[group]:
        ASSEMBLY = v['id']; x, y, z = v['center']; sx, sy, sz = v['size']
        ob = box(group + '.' + v['id'], (-z, -x, y), (sz, sx, sy), 'dark'); ob['exportRole'] = 'simulation'; ob.display_type = 'WIRE'; ob.hide_render = True
scene['definitionHash'] = D['contentHash']; scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'Game reconstruction against the approved GameModels3D pbsb507 model; see the ship README.'
create_flagstaffs(D)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Hood original source:', len(scene.objects), 'objects')

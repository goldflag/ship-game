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
# Window bands read off the reference's painted glazing: height of the band centre above the tier
# base, band height and which walls carry it.
# Optional Blender-x window (fore-and-aft range) limits the band to the walls the reference glazes.
GLAZING = {'bridge-middle': (1.72, .36, 'fwdside', 34.5, 99), 'bridge-navigation': (.66, .42, 'fwd', -99, 99), 'bridge-compass': (.72, .36, 'side', -99, 99),
           'bridge-upper': (1.95, .5, 'side', 31.5, 34.75), 'after-control-tower-upper': (2.6, .3, 'aftside', -44.2, -41.2)}
S = {s['id']: s for s in D['structures']}
for s in D['structures']:
    if s['id'].endswith('funnel'): continue
    ASSEMBLY = s['id']; outline = [(-z, -x) for x, z in s['footprint']]; base = s['baseY']; top = base + s['height']
    prism(s['name'], outline, base, s['height'], 'naval', top_material='deck' if s['id'] in TEAK_TOPS else 'roof')
    prism(s['name'] + ' deck edge', outline, top, .06, 'roof')
    # Scuttles on the long walls; window bands where the reference paints them.
    glazing = GLAZING.get(s['id'])
    for a, b in zip(outline, outline[1:] + outline[:1]):
        ax, ay = a; bx, by = b; length = math.hypot(bx - ax, by - ay)
        if length < (.7 if glazing else 1.2) or s['height'] < 1.0: continue
        nx, ny = (by - ay) / length, -(bx - ax) / length
        if nx * ((ax + bx) / 2 - sum(p[0] for p in outline) / len(outline)) + ny * ((ay + by) / 2 - sum(p[1] for p in outline) / len(outline)) < 0: nx, ny = -nx, -ny
        if glazing:
            above, tall, facing, x0, x1 = glazing
            if x0 <= (ax + bx) / 2 <= x1 and ((facing == 'fwd' and nx > .35) or (facing == 'fwdside' and nx > -.3) or (facing == 'aftside' and nx < .3) or (facing == 'side' and abs(ny) > .7)):
                count = max(1, int(length / .85))
                for k in range(count):
                    t = (k + .5) / count; px = ax + (bx - ax) * t + nx * .015; py = ay + (by - ay) * t + ny * .015
                    ob = box('Bridge window', (px, py, base + above), (length / count * .62, .03, tall), 'glass'); ob.rotation_euler.z = math.atan2(by - ay, bx - ax)
            continue
        if s['height'] < 1.3: continue
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
for sid, doors, vents, floats in [('shelter-deck-forward', 6, 5, 4), ('shelter-deck-midships', 2, 2, 2), ('well-casing-forward', 2, 2, 0), ('well-casing-aft', 2, 1, 0),
                                  ('shelter-deck-aft', 2, 2, 2), ('forward-superstructure', 4, 3, 4),
                                  ('midships-deckhouse', 2, 2, 0), ('after-control-tower', 2, 2, 2), ('bridge-lower', 1, 0, 0), ('signal-house-port', 1, 1, 0), ('signal-house-starboard', 1, 1, 0)]:
    s = S[sid]; o = [(-z, -x) for x, z in s['footprint']]; base = s['baseY']
    walls = sorted([(math.hypot(b[0] - a[0], b[1] - a[1]), a, b) for a, b in zip(o, o[1:] + o[:1])], key=lambda w: -w[0])
    walls = [w for w in walls if w[0] > 3.0]
    if not walls: continue
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
    for dx in ([-4.2, 4.2] if sign else [4.2]):
        yy = y - sign * 1.2 if sign else 1.6
        box('Ready-use locker', (x + dx, yy, z + .5), (1.4, .8, 1.0), 'naval'); box('Locker lid', (x + dx, yy, z + 1.03), (1.46, .86, .07), 'roof')
ASSEMBLY = 'tier-ladders'
for x, y, z0, z1 in [(-45.0, 3.4, 9.2, 11.79), (-35.0, 3.9, 9.2, 13.3)]:
    ladder('Tier ladder', (x - (z1 - z0) * .55, y, z0 + .05), (x, y, z1 + .02), .6)
    for s_ in [-1, 1]: rod('Ladder handrail', (x - (z1 - z0) * .55, y + s_ * .3, z0 + .9), (x, y + s_ * .3, z1 + .9), .022, 'edge', vertices=5)


def rt(pts):
    """Runtime [x, z] outline -> Blender (bow, port) points."""
    return [(-z, -x) for x, z in pts]


def pair(half):
    """A starboard polyline and its port mirror (runtime x, z)."""
    return [half, [(-x, z) for x, z in half]]


def across(half):
    """A starboard half polyline running to the centreline, continued down the port side."""
    return [(-x, z) for x, z in half] + [(x, z) for x, z in reversed(half) if x > 1e-6]


def bulwark(name, pts, base, top, material='naval', t=.06, cap='edge'):
    """Thin plated screen along a Blender polyline from base to top, with a capping rail."""
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        length = math.hypot(bx - ax, by - ay)
        if length < .02: continue
        ob = box(name, ((ax + bx) / 2, (ay + by) / 2, (base + top) / 2), (length + t, t, top - base), material); ob.rotation_euler.z = math.atan2(by - ay, bx - ax)
    if cap: tube(name + ' capping', [(x, y, top) for x, y in pts], .035, cap, 6)


# Bridge: open decks carry plated bulwarks (canvas dodgers abaft the admiral's bridge); the houses
# between them are blueprint tiers. Heights and outlines follow the reference's decks.
ASSEMBLY = 'bridge-fittings'
for half in pair([(6.5, -26.5), (6.5, -26.0), (7.7, -26.1), (8.65, -27.3), (9.3, -27.5), (9.3, -30.1), (8.9, -30.8), (8.2, -31.15), (7.5, -40.05), (7.05, -40.9)]):
    bulwark('Superstructure roof screen', rt(half), 12.0, 13.0)
for half in pair([(5.07, -32.15), (5.07, -33.2), (1.22, -42.55), (1.22, -43.45)]):
    bulwark('Lower bridge screen', rt(half), 14.15, 15.2)
for half in pair([(5.05, -28.45), (5.05, -33.3)]):
    bulwark('Admiral bridge dodger', rt(half), 16.55, 17.6, 'canvas')
bulwark('Admiral bridge screen', rt(across([(5.05, -33.3), (4.43, -33.9), (3.38, -37.5), (1.1, -39.77), (0, -39.77)])), 16.55, 17.9)
for half in pair([(2.8, -28.55), (3.0, -28.57), (4.7, -29.57), (5.23, -30.3), (5.18, -30.8), (4.85, -31.23), (3.68, -31.65), (3.78, -32.5), (3.88, -32.65), (3.88, -33.05), (4.2, -34.67)]):
    bulwark('Upper bridge screen', rt(half), 19.8, 21.1)
bulwark('Upper bridge fore screen', rt(across([(4.5, -36.83), (3.15, -36.83), (0.9, -39.08), (0, -39.08)])), 19.8, 21.1)
bulwark('Compass platform screen', rt(across([(2.18, -35.1), (1.62, -35.1), (1.62, -39.38), (0, -39.38)])), 23.35, 24.85)
for half in pair([(2.7, -30.77), (3.2, -30.77), (3.62, -31.5), (4.23, -34.6), (4.38, -34.8), (2.18, -34.95)]):
    rail('Navigating bridge roof rail', [(x, y, 23.35) for x, y in rt(half)], 1.0, 1.6)
for half in pair([(4.68, -36.5), (4.55, -36.8), (2.2, -36.83)]):
    rail('Wing cab rail', [(x, y, 22.25) for x, y in rt(half)], .95, 1.2)
# Sky lookout wings on the compass-platform house roof, screened outboard.
for side in [-1, 1]:
    prism('Lookout wing', [(30.8, side * 2.1), (34.67, side * 2.1), (34.67, side * 2.9), (30.8, side * 2.9)], 24.45, .1, 'roof')
    bulwark('Lookout wing screen', [(30.8, side * 2.1), (30.8, side * 2.9), (34.67, side * 2.9), (34.67, side * 2.1)], 24.55, 25.55)
for half in pair([(7.05, -40.9), (4.68, -46.5), (4.5, -47.65), (3.05, -47.75)]):
    rail('Conning-tower platform rail', [(x, y, 14.13) for x, y in rt(half)], .95, 1.6)
for sid in ['midships-deckhouse-upper']:
    o = [(-z, -x) for x, z in S[sid]['footprint']]; t = S[sid]['baseY'] + S[sid]['height']
    rail(S[sid]['name'] + ' rail', [(x, y, t) for x, y in o + o[:1]], .95, 2.4)
# After control tower: screened roof, searchlight lobes off the lower block, pom-pom tub and the
# ventilator standing through the gun platform.
ASSEMBLY = 'after-fittings'
o = [(-z, -x) for x, z in S['after-control-tower-roof']['footprint']]
bulwark('After control roof screen', o + o[:1], 16.25, 17.3)
for side in [-1, 1]:
    lobe = rt([(side * x, z) for x, z in [(2.8, 34.9), (3.2, 34.0), (4.4, 33.6), (5.3, 33.5), (6.4, 33.9), (7.0, 35.0), (6.5, 36.1), (5.3, 36.6), (4.12, 37.5)]])
    bulwark('Searchlight lobe screen', lobe, 13.3, 14.1)
    cyl('Searchlight tower', (-35.0, side * 5.3, 11.18), .5, 3.96, 'naval', vertices=16)
o = [(-z, -x) for x, z in S['after-deckhouse-roof']['footprint']]
i = next(k for k, (x, y) in enumerate(o) if x > -46 and y < 0)  # starboard front corner
aft = o[i:] + o[:i]  # round the after end to the port front corner
bulwark('Pom-pom tub', [(aft[0][0], -1.2)] + aft + [(aft[-1][0], 1.2)], 11.25, 12.9)
rod('Ventilator pipe', (-46.05, 0, 9.2), (-46.05, 0, 14.2), .2, 'naval', vertices=12)
cyl('Ventilator cowl', (-46.05, 0, 14.3), .25, .22, 'black', vertices=14)
# Shelter deck guard rails follow the deck edge (not the joints between its pieces).
SEAMS = [9.3, -26.6, -42.8]
for sid in ['shelter-deck-forward', 'shelter-deck-well-roof', 'shelter-deck-midships', 'shelter-deck-aft']:
    o = [(-z, -x) for x, z in S[sid]['footprint']]
    for a, b in zip(o, o[1:] + o[:1]):
        if any(abs(a[0] - k) < .01 and abs(b[0] - k) < .01 for k in SEAMS): continue
        # The pom-pom sponson screens stand in for the rail abreast the pom-poms.
        pieces = [(a, b)]
        if min(abs(a[1]), abs(b[1])) > 14 and max(a[0], b[0]) > 10.75 and min(a[0], b[0]) < 18.9:
            lerp = lambda x: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
            lo, hi = sorted([a, b])
            pieces = [(lo, lerp(10.75))] if lo[0] < 10.75 else []
            pieces += [(lerp(18.9), hi)] if hi[0] > 18.9 else []
        for p, q in pieces:
            rail('Shelter deck rail', [(p[0], p[1], 9.2), (q[0], q[1], 9.2)], 1.0, 2.4)


def half_width(outline, x):
    """Largest |y| where a Blender-frame outline crosses the station x."""
    ys = [ay + (by - ay) * (x - ax) / (bx - ax) for (ax, ay), (bx, by) in zip(outline, outline[1:] + outline[:1]) if (ax - x) * (bx - x) <= 0 and ax != bx]
    return max(abs(y) for y in ys) if ys else 0


# The well under the shelter deck: pillars, deck beams from the casings to the deck edge, and the
# plated bulwark along the upper deck.
ASSEMBLY = 'shelter-deck-well'
roof = [(-z, -x) for x, z in S['shelter-deck-well-roof']['footprint']]
casings = [[(-z, -x) for x, z in S[c]['footprint']] for c in ['well-casing-forward', 'well-casing-aft']]
for side in [-1, 1]:
    for z in [-5.98, -.48, 3.16, 6.82, 12.31, 15.96, 19.62, 23.28]:
        for y in [10.49, 12.84]:
            box('Well pillar', (-z, side * y, (5.33 + 8.95) / 2), (.1, .1, 8.95 - 5.33), 'naval')
    k = 0
    while -26.5 + k * 1.22 < 9.2:
        x = -26.5 + k * 1.22; k += 1
        inner = max(half_width(c, x) for c in casings); outer = half_width(roof, x) - .1
        if outer - inner > .3:
            box('Well deck beam', (x, side * (inner + outer) / 2, 8.85), (.12, outer - inner, .2), 'naval')
    pts = [(x, side * (sidewidth(x, deckz(x) - .01) - .04)) for x in [-26.6 + i * 35.9 / 24 for i in range(25)]]
    bulwark('Well bulwark', pts, 5.3, 6.5)
    for x, y in pts[2::5]:
        rod('Bulwark stay', (x, y * .985, 6.4), (x, y * .94, 5.35), .04, 'naval', vertices=6)
for side in [-1, 1]:
    # Forward HACS on a plated column off the superstructure roof, reached by a short bridge.
    box('HACS column', (29.7, side * 7.6, 13.18), (1.3, 1.2, 2.36), 'naval')
    box('HACS column cap', (29.7, side * 7.6, 14.3), (1.5, 1.4, .1), 'roof')
    box('HACS column walkway', (29.75, side * 6.04, 13.06), (1.0, 1.95, 2.12), 'naval')
    rail('HACS walkway rail', [(29.25, side * 5.1, 14.13), (29.25, side * 7.0, 14.13)], .95, 1.2)
    # Plated webs carry the searchlight sponsons aft of the superstructure.
    box('Sponson web', (27.8, side * 8.25, 10.52), (3.55, .5, 2.64), 'naval')
    # Knee plates under the pom-pom director wings.
    mesh('Director wing knee', [(29.4, side * 3.6, 19.65), (31.2, side * 3.6, 19.65), (30.3, side * 3.6, 18.85), (29.4, side * 5.1, 19.65), (31.2, side * 5.0, 19.65), (30.3, side * 3.6, 19.65)],
         [(0, 3, 2), (1, 2, 4), (0, 2, 1), (3, 4, 2)], 'naval')
    # Rounded ready-use lockers under the lower bridge deck.
    box('Bridge locker', (34.2, side * 4.15, 12.55), (3.7, 1.66, 1.1), 'naval')
    box('Bridge locker top', (34.2, side * 4.15, 13.15), (3.6, 1.3, .1), 'roof')
    # 10 in signal lamps on the sponson screens.
    for x, y in [(26.4, 7.93), (30.0, 9.2)]:
        rod('Signal lamp bracket', (x, side * y, 13.0), (x, side * y, 13.12), .06, 'edge', vertices=6)
        rod('10 in signal lamp', (x - .22, side * y, 13.3), (x + .22, side * y, 13.3), .15, 'black', vertices=12)
    # Sky lookouts, pelorus and binnacle on the compass platform.
    for x, y, z in [(32.7, 1.95, 24.55), (33.6, 1.95, 24.55), (36.2, .95, 23.35)]:
        cyl('Lookout pedestal', (x, side * y, z + .45), .08, .9, 'naval', vertices=8)
        box('Lookout sight', (x, side * y, z + 1.05), (.5, .3, .26), 'black')
    cyl('Pelorus', (33.5, side * 3.65, 20.55), .12, 1.5, 'naval', vertices=10)
ASSEMBLY = 'semaphore'
rod('Semaphore post', (41.0, -1.55, 14.13), (41.0, -1.55, 18.3), .07, 'black', vertices=8)
for a in [-30, 30]:
    rod('Semaphore arm', (41.0, -1.55, 18.2), (41.0 + 1.15 * math.sin(math.radians(a)), -1.55, 18.2 - 1.15 * math.cos(math.radians(a))), .09, 'black', vertices=6)
ASSEMBLY = 'bridge-fittings'
cyl('Captain sight pedestal', (38.58, 0, 24.1), .1, 1.5, 'naval', vertices=10)
box('Captain sight', (38.58, 0, 25.0), (.55, .45, .35), 'black')

# ------------------------------------------------------------------ funnels
COL = collections['Funnels']
for sid in ['forward-funnel', 'after-funnel']:
    s = S[sid]; zc = sum(p[1] for p in s['footprint']) / len(s['footprint'])
    registered('hood-forward-funnel', 'hood-forward-funnel', (-zc, 0, s['baseY']), 0, sid, COL)

# ------------------------------------------------------------------ foremast, spotting top and director
COL = collections['Masts and directors']; ASSEMBLY = 'foremast'
black = 'black'
# The reference foremast stops at the spotting top: no topmast above the director.
rod('Foremast pole', (33.45, 0, 12.0), (33.45, 0, 32.0), .5, 'naval', r2=.44, vertices=20)
rod('Foremast upper pole', (33.45, 0, 32.0), (33.45, 0, 35.2), .38, black, r2=.34, vertices=16)
for side in [-1, 1]:
    rod('Foremast tripod leg', (29.05, side * 4.39, 12.0), (32.58, side * .72, 31.6), .44, 'naval', r2=.42, vertices=16)
    rod('Upper leg collar', (32.22, side * 1.09, 29.6), (32.58, side * .72, 31.6), .45, black, vertices=16)
ladder('Foremast ladder', (33.95, 0, 25.0), (33.95, 0, 31.5), .45)
# Spotting top: platform on radiating web plates, a lower after house and a taller forward one.
top = [(29.88, 0), (29.88, 1.5), (29.32, 2.05), (29.27, 2.65), (29.55, 3.18), (30.15, 3.53), (30.9, 3.23), (31.25, 2.73), (32.05, 2.73), (32.08, 4.0),
       (32.7, 4.03), (32.9, 3.48), (38.6, 1.28), (38.85, .23), (39.35, .23)]
top = top + [(x, -y) for x, y in reversed(top) if y > 0]
prism('Spotting top platform', top, 32.66, .24, black)
rail('Spotting top rail', [(x, y, 32.9) for x, y in top + top[:1] if x < 32.2 or x > 34.4], .9, 1.4)
# Radiating web plates run from the platform edge down to a flat-bottomed keel round the pole.
box('Spotting top keel', (33.0, 0, 31.95), (4.4, .6, 1.42), black)
for ex, ey in [(27.0, 0), (28.0, 1.9), (29.6, 3.8), (32.2, 3.9), (35.0, 1.7), (37.5, 2.3), (39.2, 0)]:
    for side in ([1] if ey == 0 else [-1, 1]):
        e = Vector((ex, side * ey, 32.66)); c = Vector((33.0, 0, 32.66)); m = c + (e - c) * .38; m.z = 31.25
        mesh('Spotting top web', [e, c, (33.0, 0, 31.25), m], [(0, 1, 2, 3), (3, 2, 1, 0)], black)
        rod('Web flange', (ex, side * ey, 32.6), m, .05, black, vertices=6)
aft_house = [(31.2, 0), (31.2, 2.78), (33.3, 2.73), (33.85, 2.53), (34.3, 2.03)]
aft_house = aft_house + [(x, -y) for x, y in reversed(aft_house) if y > 0]
fwd_house = [(34.3, 2.1), (35.5, 1.97), (36.3, 1.38), (37.4, 1.17), (38.55, .97), (39.08, .4)]
fwd_house = fwd_house + [(x, -y) for x, y in reversed(fwd_house)]
prism('Spotting top after house', aft_house, 32.9, 1.85, black, top_material='roof')
prism('Spotting top forward house', fwd_house, 32.9, 2.3, black, top_material='roof')
for outline, zz in [(aft_house, 34.4), (fwd_house, 34.85)]:
    for (ax, ay), (bx, by) in zip(outline, outline[1:] + outline[:1]):
        length = math.hypot(bx - ax, by - ay)
        if length < .7 or abs(ax + bx) / 2 < 31.3: continue
        count = max(1, int(length / .75))
        for k in range(count):
            t = (k + .5) / count; nx, ny = (by - ay) / length, -(bx - ax) / length
            if nx * ((ax + bx) / 2 - 34.5) + ny * (ay + by) / 2 < 0: nx, ny = -nx, -ny
            box('Spotting top window', (ax + (bx - ax) * t + nx * .015, ay + (by - ay) * t + ny * .015, zz), (length / count * .7, .03, .34), 'glass').rotation_euler.z = math.atan2(by - ay, bx - ax)
# Signal post and yard over the after end of the top; lower yard under the lookout platform.
box('Signal post', (30.15, 0, 33.9), (.4, .35, 2.1), black)
rod('Signal post strut', (28.1, 0, 32.9), (30.0, 0, 34.8), .07, black, vertices=8)
for zz, span, x in [(29.18, 9.8, 29.85), (34.9, 9.3, 30.2)]:
    rod('Foremast yard', (x, -span, zz), (x, span, zz), .08, black, r2=.08, vertices=10)
    for side in [-1, 1]:
        rod('Yard lift', (x, side * span * .92, zz), (x, side * .3, zz + 1.6), .016, 'edge', vertices=4)
        for k in range(1, 5): rod('Signal halyard', (x, side * span * k / 5, zz), (29.6, side * 4.7, 21.1), .007, 'edge', vertices=4)
rod('Signal boom', (29.9, 0, 32.85), (24.9, 0, 32.95), .08, black, r2=.05, vertices=8)
# Signal lamps on outriggers from the after corners, daylight lanterns and sirens.
for side in [-1, 1]:
    rod('Lamp outrigger', (30.0, side * 3.4, 32.75), (30.0, side * 5.75, 32.75), .05, black, vertices=6)
    rod('Lamp post', (30.0, side * 5.75, 30.8), (30.0, side * 5.75, 34.2), .04, black, vertices=6)
    for zz in [31.3, 33.8]:
        cyl('Signal lamp', (30.0, side * 5.75, zz), .12, .4, black, vertices=10)
        box('Signal lamp lens', (30.0, side * 5.87, zz), (.14, .02, .14), 'bright')
    cyl('Daylight lantern', (32.37, side * 3.65, 33.2), .16, .66, black, vertices=10)
    rod('Siren', (32.29, side * 1.5, 29.6), (32.29, side * 1.5, 30.4), .12, 'bright', r2=.06, vertices=10)
# Small lookout platform abaft the pole below the top.
lookout = [(29.6, 1.1), (33.3, 2.15), (33.3, -2.15), (29.6, -1.1)]
prism('Mast lookout platform', lookout, 28.9, .12, black)
rail('Mast lookout rail', [(x, y, 29.02) for x, y in lookout + lookout[:1]], .9, 1.2)
for side in [-1, 1]: rod('Lookout bracket', (29.8, side * 1.1, 28.9), (32.2, side * 1.0, 27.8), .06, black, vertices=8)
rod('Signal gaff', (32.9, 0, 29.05), (27.4, 0, 29.1), .07, black, vertices=8)
# 15 in director (reference BRS_1): cabinet with a sloped face and the rangefinder inside its front
# plate; the Type 284 trough on struts above.
ASSEMBLY = 'dct-foretop'; before = set(scene.objects)
cyl('DCT pedestal', (33.15, 0, 35.3), 1.15, 1.1, 'naval', vertices=28)
cyl('DCT roller path', (33.15, 0, 35.8), 1.3, .12, 'edge', vertices=28)
profile = [(31.55, 35.85), (35.6, 35.85), (35.6, 36.3), (34.2, 37.6), (31.55, 37.6)]
vs = [(bx, side * 1.85, bz) for side in [-1, 1] for bx, bz in profile]; n = len(profile)
mesh('DCT cabinet', vs, [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, i + n, (i + 1) % n + n, (i + 1) % n) for i in range(n)], 'naval')
box('DCT front plate', (35.75, 0, 36.45), (.3, 4.4, 1.2), 'naval')
box('DCT sight ports', (35.91, 0, 36.6), (.03, 3.6, .3), 'glass')
rod('DCT horn', (35.9, 0, 36.1), (36.3, 0, 36.1), .12, 'naval', r2=.3, vertices=12)
box('DCT roof hatch', (32.8, 0, 37.72), (1.1, 1.0, .14), 'roof')
for side in [-1, 1]:
    rod('284 strut', (33.15, side * 1.1, 37.6), (33.15, side * 1.1, 38.65), .06, 'naval', vertices=8)
    rod('284 brace', (33.15, side * 1.9, 37.6), (33.15, side * 3.2, 38.65), .05, 'naval', vertices=6)
box('Type 284 aerial trough', (33.15, 0, 39.0), (.3, 6.8, .7), 'naval')
box('284 trough face', (33.29, 0, 39.0), (.02, 6.6, .56), 'dark')
node = pivot('dct-foretop.yaw', (33.15, 0, 35.3)); attach_world(set(scene.objects) - before - {node}, node)

# Conning-tower director with its 30 ft rangefinder (reference BD_1 housing): a twelve-sided
# cabinet with a sloped face, the long rangefinder across its after end.
ASSEMBLY = 'ct-director'; before = set(scene.objects)
dodec = [(45.88 + 1.87 * math.cos(math.tau * (i + .5) / 12), 1.87 * math.sin(math.tau * (i + .5) / 12)) for i in range(12)]
prism('CT director roller', dodec, 18.36, .3, 'edge')
prism('CT director cabinet', dodec, 18.66, .5, 'naval')
profile = [(44.0, 19.1), (47.78, 19.1), (47.78, 19.3), (46.4, 20.42), (45.3, 20.42), (45.1, 20.6), (44.0, 20.6)]
vs = [(bx, side * 1.55, bz) for side in [-1, 1] for bx, bz in profile]; n = len(profile)
mesh('CT director hood', vs, [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(i, i + n, (i + 1) % n + n, (i + 1) % n) for i in range(n)], 'naval')
rod('30 ft rangefinder', (44.55, -5.1, 20.15), (44.55, 5.1, 20.15), .36, 'naval', vertices=20)
for side in [-1, 1]:
    box('30 ft rangefinder end', (44.55, side * 4.95, 20.15), (.9, .5, .9), 'naval')
    box('Rangefinder window', (44.55, side * 5.21, 20.15), (.35, .03, .3), 'dark')
    rod('Rangefinder stay', (44.9, side * 1.5, 19.3), (44.7, side * 3.7, 19.95), .05, 'naval', vertices=6)
face = lambda s_, d: (47.78 - 1.38 * s_ + .63 * d, 19.3 + 1.12 * s_ + .777 * d)
(ax_, az_), (bx_, bz_) = face(.35, .015), face(.6, .015)
mesh('CT director sight port', [(ax_, -.75, az_), (ax_, .75, az_), (bx_, .75, bz_), (bx_, -.75, bz_)], [(0, 1, 2, 3)], 'glass')
node = pivot('ct-director.yaw', (45.88, 0, 18.36)); attach_world(set(scene.objects) - before - {node}, node)


def director(id, x, y, z, kind):
    """HACS Mk III (curved hood, side optics) or pom-pom director (pedestal sight)."""
    global ASSEMBLY
    ASSEMBLY = id; before = set(scene.objects)
    if kind == 'hacs':
        cyl('HACS pedestal', (x, y, z + .35), .62, .7, 'naval', vertices=20, r2=.55)
        cyl('HACS roller', (x, y, z + .75), .9, .1, 'edge', vertices=28)
        prism('HACS cabinet', octagon(x, y, 2.6, 2.0, .38), z + .8, 1.5, 'naval')
        prism('HACS roof', octagon(x - .05, y, 2.5, 1.9, .5), z + 2.3, .12, 'roof')
        box('HACS sighting hood', (x + .55, y, z + 2.47), (.9, .9, .22), 'naval')
        for side in [-1, 1]:
            rod('HACS optical tube', (x - .25, y + side * 1.0, z + 1.75), (x - .25, y + side * 2.3, z + 1.75), .16, 'naval', vertices=14)
            box('HACS rangefinder hood', (x - .25, y + side * 2.3, z + 1.75), (.62, .36, .56), 'naval')
        box('HACS sight aperture', (x + 1.27, y, z + 1.9), (.025, 1.3, .4), 'dark')
    else:
        cyl('Director pedestal', (x, y, z + .45), .22, .9, 'naval', vertices=12)
        box('Director optical body', (x, y, z + 1.05), (.62, .65, .36), 'naval')
        for dy in [-.35, .35]: rod('Director binocular', (x - .1, y + dy, z + 1.15), (x + .5, y + dy, z + 1.15), .1, 'edge', vertices=10)
        rod('Director sight rail', (x + .15, y, z + .6), (x + .15, y, z + 1.55), .035, 'naval', vertices=6)
    node = pivot(id + '.yaw', (x, y, z)); attach_world(set(scene.objects) - before - {node}, node)


for id, (x, y, z), kind in [('hacs-p', (29.7, 7.6, 14.36), 'hacs'), ('hacs-s', (29.7, -7.6, 14.36), 'hacs'), ('hacs-aft', (-39.5, 0, 18.3), 'hacs'),
                            ('pom-pom-director-p', (30.4, 4.4, 19.8), 'pp'), ('pom-pom-director-s', (30.4, -4.4, 19.8), 'pp'), ('pom-pom-director-aft', (-42.8, 0, 16.25), 'pp')]:
    director(id, x, y, z, kind)
ASSEMBLY = 'hacs-aft-pedestal'
cyl('After HACS pedestal', (-39.55, 0, 17.27), 1.2, 2.05, 'naval', vertices=24, r2=.55)
for side in [-1, 1]:
    # 12 ft rangefinders on plated towers from the superstructure roof, tube fore and aft.
    ASSEMBLY = 'rangefinder-tower-' + ('p' if side > 0 else 's')
    cyl('Rangefinder tower', (36.25, side * 5.3, 13.6), .8, 3.2, 'naval', vertices=20)
    cyl('Rangefinder tower cap', (36.25, side * 5.3, 15.24), .84, .08, 'roof', vertices=20)
    ASSEMBLY = 'rangefinder-12ft-' + ('p' if side > 0 else 's'); before = set(scene.objects)
    cyl('12 ft rangefinder pedestal', (36.25, side * 5.3, 15.4), .3, .32, 'naval', vertices=12)
    rod('12 ft rangefinder', (34.35, side * 5.3, 15.72), (38.15, side * 5.3, 15.72), .15, 'naval', vertices=14)
    for dx in [-1.75, 1.75]:
        box('Rangefinder end hood', (36.25 + dx, side * 5.3, 15.72), (.4, .42, .4), 'naval')
        box('Rangefinder end window', (36.25 + dx * 1.13, side * 5.3, 15.72), (.03, .22, .2), 'dark')
    node = pivot(ASSEMBLY + '.yaw', (36.25, side * 5.3, 15.24)); attach_world(set(scene.objects) - before - {node}, node)

# Mainmast (reference): lower mast to the top at 24.6 m, topmast doubled abaft it from 22.8 m to
# 42.4 m, raked tripod legs, a small signal platform, a lookout platform and the Type 279 array.
ASSEMBLY = 'mainmast'
rod('Main lower mast', (-28.8, 0, 9.2), (-28.8, 0, 24.7), .55, 'naval', r2=.47, vertices=18)
rod('Main topmast', (-30.2, 0, 22.8), (-30.2, 0, 42.4), .17, 'black', r2=.14, vertices=12)
cyl('Topmast cap', (-30.2, 0, 42.45), .2, .12, 'black', vertices=12)
box('Mast doubling', (-29.5, 0, 23.7), (1.4, .8, 1.8), 'black')
# The lower mast carries on as a plated column to a skirt under the signal platform.
box('Mast column', (-28.85, 0, 25.85), (.9, .9, 2.5), 'naval')
skirt_top = [(-26.35, 1.5), (-26.7, 1.9), (-30.3, 1.9), (-31.2, 1.1), (-31.2, -1.1), (-30.3, -1.9), (-26.7, -1.9), (-26.35, -1.5)]
skirt_bot = [(max(-29.3, min(-28.4, x)), max(-.45, min(.45, y))) for x, y in skirt_top]
n = len(skirt_top)
mesh('Signal platform skirt', [(x, y, 28.3) for x, y in skirt_top] + [(x, y, 27.1) for x, y in skirt_bot],
     [tuple(reversed(range(n, 2 * n)))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)], 'black')
for side in [-1, 1]:
    rod('Mainmast tripod leg', (-31.93, side * 3.35, 9.2), (-29.43, side * .48, 24.6), .5, 'naval', r2=.4, vertices=14)
signal = [(-26.35, 1.5), (-26.7, 1.9), (-30.3, 1.9), (-31.2, 1.1), (-31.2, -1.1), (-30.3, -1.9), (-26.7, -1.9), (-26.35, -1.5)]
prism('Signal platform', signal, 28.3, .15, 'black')
rail('Signal platform rail', [(x, y, 28.45) for x, y in signal + signal[:1]], .9, 1.5)
rod('Signal yard boom', (-31.2, 0, 28.25), (-33.55, 0, 28.25), .06, 'black', vertices=8)
# Signal yard across the platform on triangular web plates off the column.
rod('Signal platform yard', (-29.9, -5.95, 28.3), (-29.9, 5.95, 28.3), .07, 'black', vertices=8)
for side in [-1, 1]:
    mesh('Signal yard web', [(-29.9, side * 1.9, 28.25), (-29.9, side * 5.0, 28.25), (-29.9, side * .45, 27.4)], [(0, 1, 2), (2, 1, 0)], 'black')
# Small platform round the topmast heel above the doubling.
heel = octagon(-30.0, 0, 1.4, 2.0, .25)
prism('Topmast heel platform', heel, 24.6, .1, 'black')
rail('Topmast heel rail', [(x, y, 24.7) for x, y in heel + heel[:1]], .85, 1.0)
mesh('Signal boom web', [(-31.2, 0, 28.2), (-33.5, 0, 28.2), (-30.5, 0, 27.4)], [(0, 1, 2), (2, 1, 0)], 'black')
box('Signal locker', (-27.1, 1.2, 28.85), (.6, .5, .8), 'naval')
for zz in [20.7, 22.3, 23.8]:
    rod('Mast signal lamp', (-28.25, 0, zz), (-27.8, 0, zz), .26, 'naval', vertices=16)
    rod('Mast lamp lens', (-27.8, 0, zz), (-27.78, 0, zz), .21, 'bright', vertices=16)
    rod('Lamp bracket', (-28.3, 0, zz - .25), (-27.95, 0, zz - .25), .04, 'edge', vertices=6)
ladder('Mainmast ladder', (-28.18, 0, 9.4), (-28.18, 0, 24.5), .45)
# Lookout platform abaft the topmast, the yard across it and the signal gaff above.
prism('Masthead platform', [(-30.4, .8), (-31.96, .8), (-31.96, -.8), (-30.4, -.8)], 40.62, .12, 'black')
rail('Masthead platform rail', [(-30.45, .8, 40.74), (-31.96, .8, 40.74), (-31.96, -.8, 40.74), (-30.45, -.8, 40.74)], .95, 1.0)
rod('Masthead platform brace', (-31.9, 0, 40.62), (-30.4, 0, 39.9), .06, 'black', vertices=6)
rod('Main topmast yard', (-30.25, -6.0, 41.05), (-30.25, 6.0, 41.05), .1, 'black', r2=.1, vertices=8)
for side in [-1, 1]:
    rod('Main yard lift', (-30.25, side * 5.7, 41.05), (-30.25, side * .2, 42.35), .014, 'edge', vertices=4)
    rod('Mainmast shroud', (-30.25, side * .3, 38.0), (-28.5, side * 1.9, 28.45), .014, 'edge', vertices=4)
rod('Signal gaff', (-31.96, 0, 40.8), (-35.2, 0, 42.9), .07, 'black', r2=.05, vertices=8)
rod('Signal gaff lift', (-35.2, 0, 42.9), (-30.25, 0, 42.4), .012, 'edge', vertices=4)
rod('Signal gaff halyard', (-35.2, 0, 42.9), (-35.6, 0, 17.3), .01, 'edge', vertices=4)
ASSEMBLY = 'radar-279'
rod('Type 279 pole', (-30.85, 0, 40.74), (-30.85, 0, 47.4), .08, 'black', r2=.05, vertices=8)
box('Type 279 office', (-30.85, .35, 41.4), (.35, .3, 1.3), 'black')
rod('Type 279 crossarm', (-30.85, -.35, 45.4), (-30.85, .35, 45.4), .03, 'edge', vertices=6)

before = set(scene.objects)
# Transmitting and receiving arrays: two H frames of athwartships bars on the pole.
for zz in [44.2, 47.3]:
    for dx in [-.78, .78]:
        rod('Type 279 frame bar', (-30.85 + dx, -2.18, zz), (-30.85 + dx, 2.18, zz), .045, 'naval', vertices=6)
    for dy in [-.5, 0, .5]:
        rod('Type 279 frame rung', (-31.63, dy, zz), (-30.07, dy, zz), .035, 'naval', vertices=6)
    for side in [-1, 1]:
        rod('Type 279 stay', (-30.85, 0, zz + .9 if zz < 47 else zz - .9), (-30.85, side * 1.6, zz), .01, 'edge', vertices=4)
radar_pivot('radar-279.yaw', (-30.85, 0, 44.2), set(scene.objects) - before)
ASSEMBLY = 'ensign-gaff'
rod('Ensign gaff', (-30.55, 0, 24.8), (-38.4, 0, 29.4), .09, 'black', r2=.05, vertices=10)
rod('Gaff peak halyard', (-38.4, 0, 29.4), (-30.35, 0, 34.0), .012, 'edge', vertices=4)
cyl('Gaff jaws', (-30.6, 0, 24.8), .22, .4, 'black', vertices=12)
ASSEMBLY = 'wireless-aerials'
for y in [-.3, .3]:
    rod('Wireless aerial', (24.9, y, 32.95), (-30.25, y, 41.2), .01, 'edge', vertices=4)
    rod('Wireless aerial', (30.15, y, 35.1), (-30.25, y, 36.5), .01, 'edge', vertices=4)

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
        box('Vickers gunner shoulder rest', (-.36, side * .3, 1.0), (.14, .22, .3), 'canvas')
        rod('Vickers sight arm', (-.1, side * .35, 1.3), (.3, side * .35, 1.3), .02, 'edge', vertices=6)
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


# UP projectors in splinter tubs on the shelter deck (a tall inboard screen, low sides), with their
# ready-use lockers; one more on B turret roof. Runtime (z, |x|) outlines from the reference.
UP_TUBS = [((-22.24, 11.31), [(-20.1, 14.45), (-22.7, 14.35), (-24.8, 12.3), (-24.5, 10.2)],
            [(-24.5, 10.2), (-23.8, 9.45), (-23.1, 8.95), (-22.2, 8.8), (-21.4, 8.95), (-20.7, 9.45), (-20.2, 10.15), (-20.1, 11.0)], [(-20.1, 11.0), (-20.1, 14.45)],
            [(-18.43, 12.87, .62, 1.17), (-19.1, 12.87, .62, 1.17), (-24.75, 9.7, .6, 1.2), (-25.33, 9.7, .55, 1.2), (-25.0, 8.7, 1.15, .6)]),
           ((15.49, 13.48), [(13.4, 13.15), (13.4, 14.9), (17.55, 14.9), (17.55, 13.15)],
            [(17.55, 13.15), (17.4, 12.35), (16.95, 11.7), (16.3, 11.25), (15.5, 11.08), (14.7, 11.25), (14.0, 11.7), (13.5, 12.35), (13.4, 13.15)], [],
            [(18.8, 12.35, .6, 1.2), (18.15, 12.35, .6, 1.2), (11.3, 11.75, .6, 1.2), (12.05, 11.75, .6, 1.2), (12.8, 11.75, .6, 1.2)])]
for side in [-1, 1]:
    for (z, x), low, high, low2, lockers in UP_TUBS:
        ASSEMBLY = 'up-tub'
        bl = lambda pts: [(-pz, side * px) for pz, px in pts]
        bulwark('UP tub side', bl(low), 9.2, 10.5)
        if low2: bulwark('UP tub side', bl(low2), 9.2, 10.5)
        bulwark('UP tub screen', bl(high), 9.2, 11.2)
        for pz, px in high[1:-1:2]:
            rod('UP tub stiffener', (-pz, side * px, 9.2), (-pz, side * px, 11.1), .04, 'naval', vertices=5)
        ASSEMBLY = 'up-ready-use-lockers'
        for lz, lx, dz, dx in lockers:
            box('UP ready-use locker', (-lz, side * lx, 9.75), (dz, dx, 1.1), 'naval')
            box('Locker lid', (-lz, side * lx, 10.33), (dz + .04, dx + .04, .06), 'roof')
        up_projector(f'up-{"p" if side > 0 else "s"}-{"fwd" if z < 0 else "aft"}', -z, side * x, 9.2, -side * 90)
yawB = next(o for o in scene.objects if o.get('nodeId') == 'main-b.yaw')
_bgh = next(m['weapon'] for m in D['mounts'] if m['id'] == 'main-b')['gunhouseMesh']['vertices']
# Seat the roof projector on the B gunhouse roof: highest shell vertex near its station, plus the turret datum.
_roof = max(z for x, y, z in _bgh if abs(x - (55.12 - 60.746)) < 1.2 and abs(y) < 1.5)
up_projector('up-main-b', 55.12, 0, 10.45 + _roof - .02, 0, None)
upb = next(o for o in scene.objects if o.get('nodeId') == 'up-main-b.yaw'); attach_world([upb], yawB)
for (x, y, z), bearing in [((42.38, 5.39, 14.13), -90), ((42.38, -5.39, 14.13), 90), ((-37.69, 6.71, 11.82), -90), ((-37.69, -6.71, 11.82), 90)]:
    ASSEMBLY = 'vickers-platform'
    if z < 13:
        o = octagon(x, y, 2.6, 2.4, .4)
        prism('Vickers platform', o, z - .14, .14, 'roof')
        rail('Vickers platform rail', [(px, py, z) for px, py in o if (py - y) * y >= -.2 * abs(y)] , .9, 1.2)
        box('Vickers platform support', (x - .45, y, (9.2 + z - .14) / 2), (1.85, 1.16, z - .14 - 9.2), 'naval')
    else:
        # The forward quads stand on the conning-tower platform in splinter tubs open inboard.
        sign = 1 if y > 0 else -1
        arc = [math.atan2(sign, 0) + math.radians(a) for a in range(-120, 121, 15)]
        bulwark('Vickers tub', [(x + 1.3 * math.cos(a), y + 1.3 * math.sin(a)) for a in arc], z, z + 1.0)
    vickers_quad(f'vickers-{"p" if y > 0 else "s"}-{"fwd" if x > 0 else "aft"}', x, y, z, bearing)
for id, (x, y, z), big, stand in [('searchlight-20-pf', (28.73, 4.47, 16.55), False, None), ('searchlight-20-sf', (28.73, -4.47, 16.55), False, None),
                                  ('searchlight-20-pl', (27.8, 8.65, 12.0), False, None), ('searchlight-20-sl', (27.8, -8.65, 12.0), False, None),
                                  ('searchlight-44-pm', (-3.0, 7.5, 11.6), True, 9.2), ('searchlight-44-sm', (-3.0, -7.5, 11.6), True, 9.2),
                                  ('searchlight-44-pa', (-35.0, 5.3, 13.3), True, None), ('searchlight-44-sa', (-35.0, -5.3, 13.3), True, None),
                                  ('searchlight-44-pt', (-36.6, 2.5, 16.25), True, None), ('searchlight-44-st', (-36.6, -2.5, 16.25), True, None)]:
    if stand is not None:
        ASSEMBLY = 'searchlight-platform'; pr = 1.7 if big else 1.1
        o = [(x + pr * math.cos(a * math.tau / 20), y + pr * math.sin(a * math.tau / 20)) for a in range(20)]
        prism('Searchlight platform', o, z - .12, .12, 'roof')
        rail('Searchlight platform rail', [(px, py, z) for px, py in o + o[:1]], .9, 1.4)
        rod('Searchlight platform column', (x, y, z - .12), (x, y, stand), .16, 'naval', vertices=12)
    searchlight(id, x, y, z, big)

# ------------------------------------------------------------------ boats and boat stowage
COL = collections['Boats']


def boat(name, x, y, z, length, width, motor=False, cabin=False, seat=None, depth=.82, cabin_top=None):
    """Boat hull from its keel z; depth is the gunwale height amidships, cabin_top the cabin roof."""
    global ASSEMBLY
    ASSEMBLY = name; n = 32; outline = []; k = depth / .82
    for i in range(n):
        t = i * math.tau / n; xx = length / 2 * math.cos(t); yy = width / 2 * math.sin(t) * (1 - .22 * math.cos(t)); outline.append((xx, yy))
    vs = []
    for scale, zz in [(.62, 0), (.9, .45), (1, .82), (.93, .84), (.7, .3)]:
        vs.extend([(x + xx * scale, y + yy * scale, z + zz * k + (.18 * abs(xx / (length / 2)) ** 3 if zz > .7 else 0)) for xx, yy in outline])
    ff = [tuple(reversed(range(n))), tuple(range(4 * n, 5 * n))] + [(j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i) for j in range(4) for i in range(n)]
    mesh('Boat hull', vs, ff, 'naval', smooth=True)
    tube('Boat gunwale', [(x + xx, y + yy, z + .84 * k + .18 * abs(xx / (length / 2)) ** 3) for xx, yy in outline + outline[:1]], .045, 'wood', 6)
    for dx in [-length * .28, -length * .08, length * .14, length * .32]:
        c = dx / (length / 2); span = .95 * width * math.sqrt(1 - c * c) * (1 - .22 * c) + .04
        box('Boat thwart', (x + dx, y, z + .62 * k), (.26, span, .07), 'wood')
    floor = z - .36 if seat is None else seat
    for dx in [-length * .26, length * .26]:
        box('Boat chock', (x + dx, y, (z + .1 + floor) / 2), (.3, width * .82, z + .1 - floor), 'edge')
    if cabin:
        top = cabin_top if cabin_top is not None else z + 1.525 * k
        base = z + .7 * k
        box('Boat cabin', (x + length * .08, y, (base + top) / 2), (length * .34, width * .7, top - base), 'white')
        box('Boat cabin glass', (x + length * .25, y, top - .3), (.02, width * .5, .3), 'glass')
        rod('Boat exhaust', (x - length * .05, y, base), (x - length * .05, y, top + .3), .09, 'edge', vertices=10)


# Boats at the reference stowage (runtime z, x and keel height): the 45 ft pinnaces are open boats
# with the whalers nested in them; the others sit in chocks on the shelter deck or, for the 16 ft
# boats, in cradles abreast the midships deckhouse.
for name, (z, x, keel), (l, w), cabin, depth, top, seat in [
        ('boat-pinnace-p', (12.89, -3.13, 9.32), (13.9, 3.84), False, 1.45, None, 9.2), ('boat-pinnace-s', (12.91, 2.93, 9.33), (12.9, 3.76), False, 1.45, None, 9.2),
        ('boat-whaler-p', (13.03, -3.13, 10.73), (8.5, 1.77), False, 1.15, None, 9.85), ('boat-whaler-s', (13.04, 2.96, 10.64), (8.45, 1.92), False, 1.15, None, 9.85),
        ('boat-motor-1', (28.29, -5.4, 9.37), (10.7, 2.65), True, 1.35, 11.75, 9.2), ('boat-motor-2', (14.39, -7.88, 9.36), (10.7, 2.65), True, 1.35, 11.75, 9.2),
        ('boat-motor-3', (13.68, 6.23, 9.36), (10.7, 2.65), True, 1.35, 11.75, 9.2), ('boat-gig', (28.88, 5.1, 9.49), (9.75, 1.75), False, 1.2, None, 9.2),
        ('boat-motor-25-p', (-5.45, -11.85, 9.32), (7.6, 2.29), True, 1.15, 11.3, 9.2), ('boat-motor-25-s', (-15.89, 7.52, 9.32), (7.6, 2.29), True, 1.15, 11.3, 9.2),
        ('boat-motor-16', (-11.67, 5.89, 12.07), (4.9, 1.68), False, 1.0, None, 10.97), ('boat-dinghy', (-11.72, -5.95, 12.22), (4.85, 1.75), False, .8, None, 10.97)]:
    boat(name, -z, -x, keel, l, w, cabin, cabin, seat, depth, top)
ASSEMBLY = 'boat-crutches'
for z in [10.6, 22.25]:
    box('Boat crutch', (-z, 0, 10.93), (.3, 4.2, .22), 'naval')
    for side in [-1, 1]: rod('Crutch post', (-z, side * 1.8, 9.2), (-z, side * 1.8, 10.82), .07, 'naval', vertices=8)
# 32 ft cutters swung out on low davits abreast the after superstructure.
for side in [-1, 1]:
    boat('boat-cutter-' + ('p' if side > 0 else 's'), -36.95, side * 17.13, 9.4, 10.3, 2.69, depth=1.25)
    ASSEMBLY = 'cutter-davits'
    for x in [-33.0, -40.05]:
        tube('Cutter davit', [(x, side * 14.3, 9.2), (x, side * 14.5, 11.6), (x, side * 16.7, 12.1)], .1, 'naval', 12)
        rod('Davit fall', (x, side * 16.7, 12.05), (-33.65 if x > -36 else -39.83, side * 17.13, 10.4), .015, 'edge', vertices=4)
# Boat derricks: the main derrick stowed along the centreline from the mainmast heel, and a derrick
# each side from beside the after funnel, topped up over the boats.
ASSEMBLY = 'boat-derricks'
rod('Main derrick', (-28.3, 0, 11.65), (-8.7, 0, 12.25), .3, 'naval', r2=.2, vertices=14)
box('Derrick gooseneck', (-28.55, 0, 11.65), (.5, .5, .5), 'black')
rod('Gooseneck pin', (-28.55, 0, 11.4), (-28.55, 0, 9.2), .12, 'black', vertices=8)
cyl('Derrick head block', (-8.85, 0, 11.7), .18, .45, 'black', vertices=10)
rod('Derrick fall', (-8.85, 0, 12.2), (-8.85, 0, 11.5), .02, 'edge', vertices=4)
rod('Derrick topping lift', (-8.8, 0, 12.4), (-29.2, 0, 27.3), .02, 'edge', vertices=4)
for side in [-1, 1]:
    rod('Boat derrick', (4.9, side * 5.0, 11.1), (-6.2, side * 4.45, 13.95), .17, 'naval', r2=.12, vertices=12)
    box('Boat derrick heel', (5.0, side * 5.0, 11.03), (.5, .5, .12), 'black')
# Pom-pom sponsons: a plated overhang with a curved screen, on brackets from the ship's side.
ASSEMBLY = 'pom-pom-sponsons'
for side in [-1, 1]:
    arc = [(-10.75, 14.72), (-10.7, 15.2), (-11.1, 15.45), (-11.6, 15.65), (-12.2, 15.9), (-13.4, 16.07), (-14.6, 16.02), (-15.9, 15.8), (-17.0, 15.4), (-18.0, 15.0), (-18.9, 14.52)]
    outline = [(-z, side * x) for z, x in arc]
    prism('Pom-pom sponson', outline, 9.05, .15, 'roof')
    bulwark('Pom-pom sponson screen', outline[1:-1], 9.2, 10.2)
    bulwark('Pom-pom sponson aft screen', [(10.75, side * 12.15), (10.75, side * 14.72)], 9.2, 10.2)
    for z in [-11.6, -13.4, -15.2, -17.0]:
        x = max(px for pz, px in arc if abs(pz - z) < .9)
        mesh('Sponson bracket', [(-z, side * 14.62, 9.05), (-z, side * (x - .08), 9.05), (-z, side * 14.62, 7.95)], [(0, 1, 2), (2, 1, 0)], 'naval')
# Davits over the 16 ft boats abreast the midships deckhouse.
ASSEMBLY = 'boat-davits'
for z, x in [(-11.67, 5.89), (-11.72, -5.95)]:
    for dz in [-1.7, 1.7]:
        tube('Boat davit', [(-z + dz, -x * .87, 10.97), (-z + dz, -x * .87, 13.9), (-z + dz, -x, 14.3)], .07, 'naval', 10)
        rod('Davit fall', (-z + dz, -x, 14.25), (-z + dz * .9, -x, 13.0), .012, 'edge', vertices=4)
    rod('Boat derrick topping lift', (-6.1, side * 4.45, 14.0), (2.8, side * 2.4, 22.0), .016, 'edge', vertices=4)

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
# Scuttles where the reference paints them: one row along the forecastle forward of A turret and one
# along the quarterdeck, each following the sheer (runtime z, height).
SCUTTLES = [(z, 4.72 + (-z - 73.6) * .0257) for z in [-73.6, -76.02, -78.38, -79.63, -82.1, -83.32, -85.78, -89.48, -91.9, -94.31, -96.7, -101.65, -103.87, -105.7, -108.12, -110.23]]
SCUTTLES += [(82.1, 3.27), (83.0, 3.28)] + [(z, 1.69 + (z - 87.98) * .0149) for z in [87.98, 91.65, 95.45, 97.75, 99.72, 102.51, 105.19, 107.89, 109.75, 112.51, 114.32, 117.39, 119.49, 122.25, 124.1, 125.9, 127.75]]
for zr, z in SCUTTLES:
    x = -zr
    for side in [-1, 1]:
        y = side * (sidewidth(x, z) + .015)
        if abs(y) < .3: continue
        rod('Hull scuttle rim', (x, y, z), (x, y + side * .04, z), .15, 'edge', vertices=12)
        rod('Hull scuttle glass', (x, y + side * .042, z), (x, y + side * .05, z), .105, 'dark', vertices=12)

# ------------------------------------------------------------------ underwater fittings
COL = collections['Underwater fittings']


def screw(name, x, y, z, radius, count, hand, cmax, skew=.22, pitch=1.0):
    """Built-up screw (as Iowa's): broad elliptical blades with skew, rake, helical pitch and a thick
    root, each a closed mesh, turning about the shaft axis (Blender X, aft = -X)."""
    nr, nc = 9, 7; hub = .2 * radius; P = pitch * 2 * radius
    for b in range(count):
        a0 = b * math.tau / count + .3; v = []
        for side in (-1, 1):
            for k in range(nr):
                t = math.sin(math.pi / 2 * k / (nr - 1)); r = hub + (radius - hub) * t
                chord = cmax * (.62 + .38 * math.sin(math.pi / 2 * t / .6) if t < .6 else math.sqrt(max(0., 1 - ((t - .6) / .4) ** 2))) + .02
                phi = math.atan2(P, math.tau * r); th = (.09 * radius * (1 - t) + .02)
                for j in range(nc):
                    u = -math.cos(math.pi * j / (nc - 1)); sc = u * chord / 2; half = th * math.sqrt(max(0., 1 - u * u)) / 2 + .004
                    tang = sc * math.cos(phi) + side * half * math.sin(phi); ax = -sc * math.sin(phi) * hand + side * half * math.cos(phi) - .06 * radius * t
                    ang = a0 - hand * skew * t ** 1.5 + hand * tang / r
                    v.append((x + ax, y + r * math.cos(ang), z + r * math.sin(ang)))
        stride = nr * nc; faces = []
        for k in range(nr - 1):
            for j in range(nc - 1):
                n = k * nc + j; faces.extend([(n, n + nc, n + nc + 1, n + 1), (stride + n, stride + n + 1, stride + n + nc + 1, stride + n + nc)])
        edge = list(range(nc)) + [k * nc + nc - 1 for k in range(1, nr)] + [(nr - 1) * nc + j for j in range(nc - 2, -1, -1)] + [k * nc for k in range(nr - 2, 0, -1)]
        faces.extend((n, edge[(i + 1) % len(edge)], stride + edge[(i + 1) % len(edge)], stride + n) for i, n in enumerate(edge))
        o = mesh(name + ' blade', v, faces, 'bronze', smooth=True)
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()


def to_hull(x, y, z, dy, dz, step=.05):
    """March from (y, z) along (dy, dz) at station x until inside the hull; that point, .08 m in."""
    for k in range(400):
        yy, zz = y + dy * step * k, z + dz * step * k
        if abs(yy) <= sidewidth(x, zz) - .08: return (x, yy, zz)
    return (x, y + dy * step * 400, z + dz * step * 400)


def loft(name, rings, material):
    """Closed loft through equal-length rings of points, capped at both ends."""
    n = len(rings[0]); vs = [p for r in rings for p in r]
    ff = [tuple(reversed(range(n))), tuple(range((len(rings) - 1) * n, len(rings) * n))]
    ff += [(i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j) for i in range(len(rings) - 1) for j in range(n)]
    ob = mesh(name, vs, ff, material, smooth=True)
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
    return ob


# Four shafts in heavy sleeves on V brackets to the hull, three-bladed screws (reference pbsb507:
# 4.15 m, sleeves about 1.1 m across).
for i, (y, x, z) in enumerate([(-6.9, -103.0, -7.1), (-3.3, -115.1, -7.9), (3.3, -115.1, -7.9), (6.9, -103.0, -7.1)], 1):
    ASSEMBLY = 'shaft-' + str(i); sgn = 1 if y > 0 else -1
    ystart = y * .75
    rod('Propeller shaft', (x + 32, ystart, z + 2.2), (x + 1.2, y, z), .5, 'antifouling', r2=.55, vertices=16)
    rod('Shaft sleeve end', (x + 1.2, y, z), (x + .75, y, z), .55, 'antifouling', r2=.42, vertices=16)
    bx = x + 2.4
    for dy, dz in [(-sgn * .15, 1.0), (-sgn * 1.0, .45)]:
        rod('A-bracket arm', (bx, y, z), to_hull(bx, y, z, dy, dz), .16, 'antifouling', vertices=10)
    cyl('A-bracket boss', (bx, y, z), .62, .9, 'antifouling', vertices=16).rotation_euler.y = math.pi / 2
    before = set(scene.objects)
    rod('Propeller hub', (x - .75, y, z), (x + .75, y, z), .45, 'bronze', r2=.42, vertices=20)
    rod('Propeller cap', (x - .75, y, z), (x - 1.6, y, z), .45, 'bronze', r2=.1, vertices=20)
    screw('Three-bladed screw', x, y, z, 2.08, 3, sgn, 1.75)
    node = pivot('propeller-' + str(i) + '.spin', (x, 0, 0)); node.location = (x, y, z); attach_world(set(scene.objects) - before - {node}, node)
# Semi-balanced rudder behind the sternpost: runtime (height, leading z, trailing z, half thickness).
ASSEMBLY = 'rudder'; before = set(scene.objects)
FOIL = [(0, 0), (.08, 1), (.3, 1.1), (.6, .7), (1, 0), (.6, -.7), (.3, -1.1), (.08, -1)]
rings = []
for h, z0, z1, t in [(-4.75, 118.6, 123.25, .26), (-7.15, 118.6, 123.1, .27), (-7.3, 115.85, 123.05, .27), (-9.8, 115.6, 122.55, .2), (-10.15, 116.0, 121.9, .12)]:
    rings.append([(-(z0 + (z1 - z0) * u), t * v, h) for u, v in FOIL])
loft('Semi-balanced rudder', rings, 'antifouling')
rod('Rudder stock', (-118.75, 0, -4.8), (-118.75, 0, -2.2), .3, 'edge', vertices=12)
node = pivot('rudder.yaw', (-118.6, 0, -6.0)); attach_world(set(scene.objects) - before - {node}, node)
for side in [-1, 1]:
    ASSEMBLY = 'bilge-keel-' + str(side)
    pts = [(x, side * sidewidth(x, -8.6), -8.6) for x in [-50, -30, -10, 10, 30, 50, 70]]
    for a, b in zip(pts, pts[1:]): mesh('Bilge keel', [a, b, (b[0], b[1] + side * .7, b[2] - .3), (a[0], a[1] + side * .7, a[2] - .3)], [(0, 1, 2, 3)], 'antifouling')

# ------------------------------------------------------------------ landmarks, simulation volumes, appearance
COL = collections['Masts and directors']; ASSEMBLY = 'landmarks'
for id, pos in [('funnel-cap', (22.42, 0, 23.3)), ('foremast-top', (33.45, 0, 39.35)), ('mainmast-top', (-30.85, 0, 47.4)), ('fore-director', (33.15, 0, 35.3)), ('bridge-front', (39.5, 0, 25.0))]:
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

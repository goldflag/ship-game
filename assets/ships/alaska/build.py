"""Original USS Alaska (CB-1) recipe, 1944-45 fit, plain grey.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The
shared exporter owns the sole basis conversion. Proportions follow the approved
GameModels3D pasc510 A hull; no reference geometry or texture is loaded.
"""
import bpy
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
from blender_fidelity import authored_hull, authored_structure
from blender_supports import SupportSurface
from blender_rig import create_flagstaffs
sys.path.insert(0, str(ROOT / 'assets/parts'))
from library import create_mount
sys.path.insert(0, str(Path(__file__).parent))
from fittings import build_fittings

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Alaska review world')
scene.world.color = (.08, .10, .12)
collections = {}
for name in ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Sensors and masts', 'Aircraft handling', 'Deck fittings', 'Underwater fittings']:
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    collections[name] = col

# Plain grey (reference no-camouflage paint): haze-grey sides and upperworks, deck-blue
# decks and roofs, red-oxide bottom. Linear RGB interpretations of the source swatches.
colors = {'naval': (.127, .16, .178), 'hullgray': (.127, .16, .178), 'roof': (.026, .039, .05), 'deck': (.026, .039, .05),
          'edge': (.07, .085, .095), 'painted-edge': (.105, .13, .145), 'dark': (.015, .018, .02), 'canvas': (.2, .21, .2),
          'antifouling': (.16, .052, .03), 'bronze': (.36, .27, .12), 'glass': (.025, .065, .085), 'white': (.62, .64, .62)}
materials = {}
for key, color in colors.items():
    m = bpy.data.materials.new('Alaska ' + key)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .76
    p.inputs['Metallic'].default_value = .05
    materials[key] = m


def mat(value):
    return materials[value] if isinstance(value, str) else value


def mesh(name, vertices, faces, material=None, col=None, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    (col or collections['Hull and decks']).objects.link(ob)
    if material is not None:
        data.materials.append(mat(material))
    for poly in data.polygons:
        poly.use_smooth = smooth
    return ob


def cyl(name, loc, radius, depth, material='naval', col=None, vertices=24, r2=None):
    r2 = radius if r2 is None else r2
    depth = max(.002, depth)
    vv = [(r * math.cos(math.tau * i / vertices), r * math.sin(math.tau * i / vertices), z) for r, z in [(radius, -depth / 2), (r2, depth / 2)] for i in range(vertices)]
    ff = [tuple(reversed(range(vertices))), tuple(range(vertices, 2 * vertices))] + [(i, (i + 1) % vertices, (i + 1) % vertices + vertices, i + vertices) for i in range(vertices)]
    ob = mesh(name, vv, ff, material, col, True)
    ob.location = loc
    ob.data.polygons[0].use_smooth = False
    ob.data.polygons[1].use_smooth = False
    return ob


def rod(name, a, b, r, material='edge', col=None, r2=None, vertices=10):
    a, b = Vector(a), Vector(b)
    ob = cyl(name, (a + b) / 2, r, (b - a).length, material, col, vertices, r2)
    ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return ob


def box(name, loc, dim, material='naval', col=None, bev=0):
    dx, dy, dz = [v / 2 for v in dim]
    vv = [(sx * dx, sy * dy, sz * dz) for sx, sy, sz in [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1)]]
    ob = mesh(name, vv, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material, col)
    ob.location = loc
    return ob


helpers = dict(mesh=mesh, cyl=cyl, rod=rod, box=box)
H = D['hull']
L = H['length']


def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va + (vb - va) * (s - a) / (b - a)
    return points[0][1] if s < points[0][0] else points[-1][1]


def deckz(x):
    return interp(H['deckHeights'], x + L / 2)


def width(x):
    return interp(H['halfBreadths'], max(0, min(L, x + L / 2)))


# ---------------------------------------------------------------- hull
hull = authored_hull(H, mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
hull.data.materials.append(materials['deck'])
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        face.material_index = 2

# ---------------------------------------------------------------- superstructure
S = {s['id']: s for s in D['structures']}
shells = []
for s in D['structures']:
    ob = authored_structure(s, mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials['roof'])
    for face in ob.data.polygons:
        if s['id'] == 'funnel':
            face.use_smooth = abs(face.normal.z) < .8
        elif face.normal.z > .8:
            face.material_index = 1
    shells.append(ob)
# The after 5-inch sponson decks ring their barbettes: barbettes and tubs seat on the deck below them.
support = SupportSurface([hull, *[o for o in shells if not o['assemblyId'].startswith('platform-5in')]])

# ---------------------------------------------------------------- guns
tub_col = collections['Light AA']


def ringwall(name, x, y, z, r, height, start=0, end=360, assembly=None, thickness=.07):
    n = max(8, round((end - start) / 8))
    vv = []
    for radius, h in [(r, 0), (r, height), (r - thickness, height), (r - thickness, 0)]:
        for i in range(n + 1):
            a = math.radians(start + (end - start) * i / n)
            vv.append((x + radius * math.cos(a), y + radius * math.sin(a), z + h))
    k = n + 1
    ff = [(j * k + i, j * k + i + 1, (j + 1) * k + i + 1, (j + 1) * k + i) for j in range(3) for i in range(n)]
    if end - start < 360:
        ff.extend([(0, k, 2 * k, 3 * k), (n, k + n, 2 * k + n, 3 * k + n)])
    # A rolled top edge: an outward lip on the same mesh gives the tub a finished rim.
    lip = len(vv)
    for radius, h in [(r + .05, height - .04), (r + .05, height + .03)]:
        for i in range(n + 1):
            a = math.radians(start + (end - start) * i / n)
            vv.append((x + radius * math.cos(a), y + radius * math.sin(a), z + h))
    ff += [(k + i, k + i + 1, lip + i + 1, lip + i) for i in range(n)]
    ff += [(lip + i, lip + i + 1, lip + k + i + 1, lip + k + i) for i in range(n)]
    ff += [(lip + k + i, lip + k + i + 1, 2 * k + i + 1, 2 * k + i) for i in range(n)]
    ob = mesh(name, vv, ff, 'naval', tub_col)
    ob['assemblyId'] = assembly or name
    return ob


for mount in D['mounts']:
    x, y, z = -mount['position'][2], -mount['position'][0], mount['position'][1]
    kind = mount['partId']
    col = collections['Light AA'] if kind.startswith('us-40') or kind.startswith('us-20') else collections['Main and secondary batteries']
    # Start above the sole: a few reference datums sit a hair below the local deck.
    floor = min(z, support.below(x, y, z + .5))
    radius = mount['weapon']['barbetteRadius']
    gap = z - floor
    if kind.startswith(('us-12in', 'us-5in')):
        if gap > .02:
            ob = cyl(mount['id'] + '.barbette', (x, y, (floor + z) / 2), radius, gap + .02, 'naval', col, 64 if radius > 3 else 40)
            ob['assemblyId'] = mount['id']
    else:
        bofors = kind.startswith('us-40')
        tub_r = 2.55 if bofors else 1.55
        # The splinter tub stands on a floor whenever its rim would not reach the supporting surface:
        # the ring is probed as well as the centre, since small pedestal blocks and sponsons are
        # narrower than the tub.
        def under(px, py):
            try:
                return min(z, support.below(px, py, z + .5))
            except ValueError:      # outboard of the deck edge
                return z - 5
        probes = [(x + math.cos(a) * tub_r * .9, y + math.sin(a) * tub_r * .9) for a in [i * math.tau / 8 for i in range(8)]]
        ring = min([under(px, py) for px, py in probes if abs(py) < width(px) - .1] or [z])
        if gap > .02 or z - ring > .02:
            deck = cyl(mount['id'] + '.tub floor', (x, y, z - .08), tub_r, .16, 'roof', col, 36 if bofors else 24)
            deck['assemblyId'] = mount['id']
            below = floor
            drop = z - .16 - below
            if drop > 2.6:
                post = cyl(mount['id'] + '.tub column', (x, y, below + drop / 2), tub_r * .72, drop + .02, 'naval', col, 32)
                post['assemblyId'] = mount['id']
            elif drop > .02:
                for a in range(0, 360, 90 if bofors else 120):
                    ax, ay = math.cos(math.radians(a)), math.sin(math.radians(a))
                    foot = support.below(x + ax * tub_r * .45, y + ay * tub_r * .45, z - .17)
                    k = rod(mount['id'] + '.tub knee', (x + ax * tub_r * .9, y + ay * tub_r * .9, z - .16), (x + ax * tub_r * .45, y + ay * tub_r * .45, foot), .08, 'naval', col, vertices=8)
                    k['assemblyId'] = mount['id']
        # Bofors tubs are closed rings. Oerlikon tubs face the mount's bearing and open inboard for
        # access; at the deck edge the ring stops at the ship's side, where a straight bulwark closes it
        # (the reference's deck-edge mounts stand inside the side plating, not on sponsons).
        if bofors:
            ringwall(mount['id'] + '.splinter tub', x, y, z, tub_r, 1.15, 0, 360, mount['id'])
        else:
            outboard = -mount.get('bearingDeg', 0)
            arcs = [(outboard - 125, outboard + 125)]
            edge = width(x) - .06
            if abs(y) + tub_r > edge and abs(y) < edge:
                sgn = 1 if y > 0 else -1
                h = 90 - abs(math.degrees(math.asin(max(-1, min(1, (edge - abs(y)) / tub_r)))))
                c = 90 * sgn
                rel = ((outboard - c + 180) % 360) - 180
                arcs = [(c + a, c + b) for a, b in ((rel - 125, -h), (h, rel + 125)) if b - a > 4]
                p1 = (x + tub_r * math.cos(math.radians(c - h)), y + tub_r * math.sin(math.radians(c - h)))
                p2 = (x + tub_r * math.cos(math.radians(c + h)), y + tub_r * math.sin(math.radians(c + h)))
                length = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                side = box(mount['id'] + '.deck-edge bulwark', ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, z + .525), (length, .07, 1.05), 'naval', col)
                side.rotation_euler.z = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
                side['assemblyId'] = mount['id']
            for k, (a, b) in enumerate(arcs):
                ringwall(mount['id'] + '.splinter tub' + ('' if k == 0 else f' {k}'), x, y, z, tub_r, 1.05, a, b, mount['id'])
    create_mount(mount, col, helpers, materials)

# ---------------------------------------------------------------- fittings
build_fittings(D, helpers, materials, collections, support, deckz, width)

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Alaska original recipe:', len(scene.objects), 'objects; source saved')

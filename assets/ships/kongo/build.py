"""Original IJN Kongō recipe, 1942 fit, the reference's no-camouflage paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The
shared exporter owns the sole basis conversion. Proportions follow the approved
GameModels3D pjsb007 B hull; no reference geometry or texture is loaded.
Region modules (kongo_*.py) each build one part of the ship from the shared
helpers passed to them.
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
from kongo_kit import Kit
import kongo_pagoda
import kongo_midships
import kongo_aft
import kongo_hull

# Region modules in build order; each may claim measured prisms it draws itself.
REGIONS = [kongo_pagoda, kongo_midships, kongo_aft, kongo_hull]
CLAIMED = set().union(*(region.CLAIMED_STRUCTURES for region in REGIONS))

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Kongō review world')
scene.world.color = (.08, .10, .12)
collections = {}
for name in ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Sensors and masts', 'Boats and aviation', 'Deck fittings', 'Underwater fittings']:
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    collections[name] = col

# Reference no-camouflage paint: blue-grey hull and upperworks, natural wood weather decks,
# linoleum aircraft deck and bridge floors, red-oxide bottom, black funnel caps and mast heads.
# Linear RGB interpretations of the source swatches; appearance.json binds the named paints.
colors = {'naval': (.100, .104, .120), 'hullgray': (.100, .104, .120), 'roof': (.088, .091, .104), 'deck': (.100, .076, .054),
          'linoleum': (.072, .040, .031), 'edge': (.038, .038, .040), 'painted-edge': (.082, .085, .097), 'dark': (.012, .013, .014),
          'black': (.012, .012, .013), 'canvas': (.55, .53, .44), 'antifouling': (.105, .050, .039), 'bronze': (.36, .27, .12),
          'glass': (.02, .04, .05), 'wood': (.19, .13, .075), 'white': (.62, .64, .62), 'gold': (.62, .45, .12)}
materials = {}
for key, color in colors.items():
    m = bpy.data.materials.new('Kongō ' + key)
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

# ---------------------------------------------------------------- hull
hull = authored_hull(H, mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
for key in ['deck', 'roof', 'linoleum']:
    hull.data.materials.append(materials[key])
ZC = -0.1755
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        zref = -face.center.x + ZC
        face.material_index = 2
        # The casemate ledge outboard of the forecastle wall is steel; the forecastle's
        # after tail around the catapult is the linoleum aircraft deck.
        if 4.2 < face.center.z < 4.5 and zref < 57.2:
            face.material_index = 3
        elif face.center.z > 6.5 and 35.4 < zref < 57.5:
            face.material_index = 4

# ---------------------------------------------------------------- superstructure
shells = []
for s in D['structures']:
    ob = authored_structure(s, mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials['roof'])
    ob.data.materials.append(materials['black'])
    funnel = s['id'].endswith('funnel')
    for face in ob.data.polygons:
        if funnel:
            face.use_smooth = abs(face.normal.z) < .8
            if face.normal.z > .8:
                face.material_index = 2
        elif face.normal.z > .8:
            face.material_index = 1
    shells.append(ob)
support = SupportSurface([hull, *shells])
# Claimed prisms still support fittings; their region draws the visible replacement.
for ob in [o for o in shells if o['assemblyId'] in CLAIMED]:
    shells.remove(ob)
    bpy.data.objects.remove(ob, do_unlink=True)
kit = Kit(D, helpers, materials, collections, support)

# ---------------------------------------------------------------- guns
arm = collections['Main and secondary batteries']
light = collections['Light AA']
for mount in D['mounts']:
    x, y, z = -mount['position'][2], -mount['position'][0], mount['position'][1]
    kind = mount['partId']
    col = light if kind.startswith(('type96', 'type93')) else arm
    radius = mount['weapon']['barbetteRadius']
    if mount['battery'] == 'main':
        # The Kongō turret recipe bears on a shallow roller ring 3.14 m above its yaw datum;
        # the ship owns the barbette from the supporting deck up to that plane.
        top = z + 3.14
        floor = support.below(x, y, top - .05)
        ob = cyl(mount['id'] + '.barbette', (x, y, (floor + top) / 2), 4.62, top - floor + .02, 'naval', arm, 72)
        ob['assemblyId'] = mount['id']
        kit.barbette_details(mount, floor, top)
    else:
        floor = min(z, support.below(x, y, z + .5))
        if z - floor > .02 and not kind.startswith(('type96', 'type93', 'type89')):
            ob = cyl(mount['id'] + '.barbette', (x, y, (floor + z) / 2), radius, z - floor + .02, 'naval', col, 40)
            ob['assemblyId'] = mount['id']
        if kind.startswith(('type96', 'type93', 'type89')):
            kit.gun_tub(mount, floor)
    create_mount(mount, col, helpers, materials)

# ---------------------------------------------------------------- regions
for region in REGIONS:
    region.build(D, kit)
kit.build_wires()

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Kongō original recipe:', len(scene.objects), 'objects; source saved')

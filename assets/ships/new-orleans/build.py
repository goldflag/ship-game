"""New Orleans recipe: a Blender-recipe preset scaffolded by `ship:new --legacy`.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared
exporter owns the sole basis conversion. The starter builds the lofted hull, the blueprint's
deckhouse prisms and the catalog mounts; add the ship's own geometry below (or in region
modules such as fittings.py on a large ship) and declare every shared file it reads in
recipe-inputs.json. No reference geometry or texture is loaded.
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

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('New Orleans review world')
scene.world.color = (.08, .10, .12)
collections = {}
for name in ['Hull and decks', 'Superstructure', 'Armament', 'Deck fittings']:
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    collections[name] = col

# Linear RGB placeholders; appearance.json binds each role to a named paint and finish.
colors = {'naval': (.127, .16, .178), 'hullgray': (.127, .16, .178), 'roof': (.07, .08, .09), 'deck': (.07, .08, .09),
          'edge': (.07, .085, .095), 'painted-edge': (.105, .13, .145), 'dark': (.015, .018, .02),
          'antifouling': (.16, .052, .03), 'glass': (.025, .065, .085)}
materials = {}
for key, color in colors.items():
    m = bpy.data.materials.new('New Orleans ' + key)
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


# Shared part builders call these helpers.
helpers = dict(mesh=mesh, cyl=cyl, rod=rod, box=box)

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
hull.data.materials.append(materials['deck'])
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        face.material_index = 2

# ---------------------------------------------------------------- superstructure
shells = []
for s in D['structures']:
    ob = authored_structure(s, mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials['roof'])
    for face in ob.data.polygons:
        if 'exhaust' in s:
            face.use_smooth = abs(face.normal.z) < .8
        elif face.normal.z > .8:
            face.material_index = 1
    shells.append(ob)
support = SupportSurface([hull, *shells])

# ---------------------------------------------------------------- guns
for mount in D['mounts']:
    x, y, z = -mount['position'][2], -mount['position'][0], mount['position'][1]
    floor = min(z, support.below(x, y, z + .5))
    radius = mount['weapon']['barbetteRadius']
    # Every mount stands on something: a barbette closes the gap to the deck below.
    if z - floor > .02:
        ob = cyl(mount['id'] + '.barbette', (x, y, (floor + z) / 2), radius, z - floor + .02, 'naval', collections['Armament'], 64 if radius > 3 else 40)
        ob['assemblyId'] = mount['id']
    create_mount(mount, collections['Armament'], helpers, materials)

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'Scaffold starter; see README'
create_flagstaffs(D)
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts/ships'))
from blender_wall_fittings import seat_wall_fittings
seat_wall_fittings(scene)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('New Orleans recipe:', len(scene.objects), 'objects; source saved')

"""Build a construction scene .blend from scene.json (written by `ship:blender-import`).

Everything arrives already in Blender axes (+X bow, +Y port, +Z up, metres). Collections:
Reference (locked custom hull and balconies), Blocks (hull pieces), Equipment (one empty per row,
with a wire box as a display proxy), Loads (wire boxes). Identity is stored in custom properties;
object names are only labels. Nothing here reads published models or references.
"""
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scene import SCENE_VERSION, mesh_hash, shape_hash  # noqa: E402

scene_path = os.environ['CONSTRUCTION_SCENE']
blend_path = os.environ['CONSTRUCTION_BLEND']
with open(scene_path) as f:
    document = json.load(f)
if document['version'] != SCENE_VERSION:
    raise RuntimeError('Unsupported scene version %r' % document['version'])

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


collections = {role: collection(name) for role, name in (
    ('reference', 'Reference'), ('block', 'Blocks'), ('equipment', 'Equipment'), ('load', 'Loads'))}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


materials = {}
for paint in document['paints']:
    m = bpy.data.materials.new(paint['id'])
    m.use_fake_user = True  # the whole paint palette stays in the file for new pieces
    hex_color = paint['color'].lstrip('#')
    rgb = [srgb_to_linear(int(hex_color[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    m.diffuse_color = (*rgb, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
        bsdf.inputs['Roughness'].default_value = 0.7
    materials[paint['id']] = m


def place(obj, item):
    obj.location = item['location']
    obj.rotation_mode = 'XYZ'
    obj.rotation_euler = (0.0, 0.0, math.radians(item['yawDeg']))


def mesh_object(name, mesh, target):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v) for v in mesh['vertices']], [], [tuple(f) for f in mesh['faces']])
    data.validate(clean_customdata=False)
    data.update()
    obj = bpy.data.objects.new(name, data)
    target.objects.link(obj)
    return obj


def lock(obj):
    obj.lock_location = (True, True, True)
    obj.lock_rotation = (True, True, True)
    obj.lock_scale = (True, True, True)
    obj.hide_select = True


created = []
for item in document['objects']:
    role = item['role']
    if role == 'equipment':
        obj = bpy.data.objects.new(item['id'], None)
        collections['equipment'].objects.link(obj)
        obj.empty_display_type = 'ARROWS'
        obj.empty_display_size = 1.0
        obj['partId'] = item['partId']
        obj['seat'] = bool(item.get('seat', False))
        place(obj, item)
        proxy = item.get('proxy')
        if proxy:
            sx, sy, sz = (s / 2 for s in proxy['size'])
            corners = [(x * sx, y * sy, z * sz) for x, y, z in (
                (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
            box = mesh_object(item['id'] + ' (bounds)', {'vertices': corners, 'faces': [
                (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]}, collections['equipment'])
            box.location = proxy['center']
            box.parent = obj
            box.display_type = 'WIRE'
            box.hide_render = True
            box['constructionRole'] = 'proxy'
            lock(box)
    else:
        obj = mesh_object(item['id'], item['mesh'], collections[role])
        place(obj, item)
        if item.get('paint') in materials:
            obj.data.materials.append(materials[item['paint']])
            obj['constructionPaint'] = item['paint']
        if role == 'load':
            obj.display_type = 'WIRE'
            obj['massKg'] = float(item['massKg'])
            obj['loadName'] = item['loadName']
        if role == 'reference':
            lock(obj)
    obj['constructionId'] = item['id']
    obj['constructionRole'] = role
    obj['constructionKind'] = item['kind']
    obj['importName'] = obj.name
    created.append(obj)

bpy.context.view_layer.update()
for obj in created:
    geometry = mesh_hash(obj)
    obj['meshHash'] = geometry
    obj['shapeHash'] = shape_hash(obj, geometry)

scene['constructionScene'] = SCENE_VERSION
scene['constructionShip'] = document['ship']
scene['constructionRevision'] = document['revision']
scene['constructionFileRevision'] = document['fileRevision']
scene['constructionImported'] = json.dumps(document['imported'])
bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
print('CONSTRUCTION_SCENE_OBJECTS', len(created))

"""Dump a construction scene .blend to JSON for `ship:blender-export`. Reads only; never saves.

Per object: name, type, collections, parent, simple custom properties, matrix_world (row-major),
the current identity hashes (blender/scene.py) and, for meshes, the evaluated geometry in local axes
with per-polygon material indices and the material slot names. All interpretation, frame conversion
included, happens in TypeScript (scripts/construction/blenderScene.ts).
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scene import mesh_hash, material_names, shape_hash  # noqa: E402

blend_path = os.environ['CONSTRUCTION_BLEND']
dump_path = os.environ['CONSTRUCTION_DUMP']
bpy.ops.wm.open_mainfile(filepath=blend_path)
scene = bpy.context.scene
bpy.context.view_layer.update()


def simple(value):
    if isinstance(value, (bool, int, float, str)):
        return value
    try:
        return [simple(v) for v in value]
    except TypeError:
        return None


def props(id_block):
    return {key: simple(id_block[key]) for key in id_block.keys() if simple(id_block[key]) is not None}


objects = []
depsgraph = bpy.context.evaluated_depsgraph_get()
for obj in scene.objects:
    entry = {
        'name': obj.name,
        'type': obj.type,
        'collections': [c.name for c in obj.users_collection],
        'parent': obj.parent.name if obj.parent else None,
        'props': props(obj),
        'matrix': [list(row) for row in obj.matrix_world],
    }
    geometry = mesh_hash(obj)
    entry['meshHash'] = geometry
    entry['shapeHash'] = shape_hash(obj, geometry)
    if obj.type == 'MESH':
        evaluated = obj.evaluated_get(depsgraph)
        me = evaluated.to_mesh()
        entry['mesh'] = {
            'vertices': [list(v.co) for v in me.vertices],
            'faces': [list(p.vertices) for p in me.polygons],
            'faceMaterials': [p.material_index for p in me.polygons],
            'materials': material_names(obj),
        }
        evaluated.to_mesh_clear()
    objects.append(entry)

with open(dump_path, 'w') as f:
    json.dump({'version': 1, 'file': blend_path, 'scene': props(scene), 'objects': objects}, f)
print('CONSTRUCTION_SCENE_DUMPED', len(objects))

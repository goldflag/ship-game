"""Identity hashes for construction scenes, shared by import_scene.py and export_scene.py.

An object's identity is its custom properties, never its name: Blender renames duplicates `.001`.
The import stores `shapeHash` and `meshHash` computed here from the finished object; the export
computes them again with the same function, so an object nobody touched compares equal and is
skipped, and one that was only moved keeps its mesh hash.
"""
import hashlib

import bpy

SCENE_VERSION = 1
# Object properties that take part in the shape hash besides geometry and transform.
HASHED_PROPS = ('partId', 'seat', 'massKg', 'loadName')


def mesh_hash(obj):
    """Geometry only: local vertex positions and polygon topology."""
    h = hashlib.sha256()
    if obj.type == 'MESH':
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = evaluated.to_mesh()
        for v in me.vertices:
            h.update(('%.5f,%.5f,%.5f;' % tuple(v.co)).replace('-0.00000', '0.00000').encode())
        for p in me.polygons:
            h.update((','.join(str(i) for i in p.vertices) + ';').encode())
        evaluated.to_mesh_clear()
    return h.hexdigest()[:24]


def material_names(obj):
    return [slot.material.name if slot.material else None for slot in obj.material_slots]


def shape_hash(obj, geometry=None):
    """Everything the export reads: geometry, polygon materials, world transform and hashed properties."""
    h = hashlib.sha256()
    h.update((geometry if geometry is not None else mesh_hash(obj)).encode())
    if obj.type == 'MESH':
        h.update(('|'.join(name or '' for name in material_names(obj))).encode())
        h.update(','.join(str(p.material_index) for p in obj.data.polygons).encode())
    for row in obj.matrix_world:
        h.update(('%.6f,%.6f,%.6f,%.6f;' % tuple(row)).replace('-0.000000', '0.000000').encode())
    for key in HASHED_PROPS:
        if key in obj.keys():
            h.update(('%s=%r;' % (key, obj[key])).encode())
    return h.hexdigest()[:24]

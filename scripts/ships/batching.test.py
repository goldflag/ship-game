"""Regression: exporter batching preserves Blender join topology and UVs.

Run with Blender --background --factory-startup --python-exit-code 1 --python.
"""
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).parent))
from blender_batching import join_mesh_data, values

material_a = bpy.data.materials.new('paint A')
material_b = bpy.data.materials.new('paint B')


def fixture(suffix):
    objects = []
    for i in range(2):
        data = bpy.data.meshes.new('warped panel' + suffix)
        data.from_pydata([(0, 0, 0), (2, 0, .015), (2, 2, 0), (0, 2, -.002)], [], [(0, 1, 2, 3)])
        data.materials.append(material_a if i else material_b)
        uv = data.uv_layers.new(name='Metric paint')
        uv.data.foreach_set('uv', np.array([0, 0, 1, 0, 1, 1, 0, 1], dtype=np.float32))
        other = data.uv_layers.new(name='Detail')
        other.data.foreach_set('uv', np.array([0, 0, .1, 0, .1, .1, 0, .1], dtype=np.float32))
        data.uv_layers.active_index = 1
        obj = bpy.data.objects.new(f'panel {i}' + suffix, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.matrix_world = Matrix.Translation((i * 3, i, .5)) @ Matrix.Rotation(.32 + .16*i, 4, 'Z')
        objects.append(obj)
    return objects


original = fixture(' old')
actual = fixture(' new')
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for obj in original: obj.select_set(True)
bpy.context.view_layer.objects.active = original[0]
bpy.ops.object.join()
join_mesh_data(actual)
a, b = original[0].data, actual[0].data
assert np.allclose(values(a.vertices, 'co', 3, np.float32), values(b.vertices, 'co', 3, np.float32), rtol=0, atol=1e-6)
for group, prop, width in [('loops', 'vertex_index', 1), ('loops', 'edge_index', 1), ('edges', 'vertices', 2), ('polygons', 'loop_start', 1), ('polygons', 'loop_total', 1), ('polygons', 'material_index', 1)]:
    assert np.array_equal(values(getattr(a, group), prop, width), values(getattr(b, group), prop, width)), (group, prop)
for layer in a.uv_layers:
    assert np.array_equal(values(layer.data, 'uv', 2, np.float32), values(b.uv_layers[layer.name].data, 'uv', 2, np.float32))
a.calc_loop_triangles(); b.calc_loop_triangles()
assert [tuple(t.vertices) for t in a.loop_triangles] == [tuple(t.vertices) for t in b.loop_triangles]
assert list(a.materials) == list(b.materials)
assert a.uv_layers.active_index == b.uv_layers.active_index
print('PASS: Blender join vertices, polygon loops, triangulation, material slots, edges and UVs preserved')

"""Blender regression test: convoy primitives match the original operators.

blender --background --factory-startup --python-exit-code 1 --python scripts/ships/primitives.test.py
"""
import ast
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector

root = Path(__file__).resolve().parents[2]
source = ast.parse((root / 'assets/ships/convoy/geometry-v2.py').read_text())
functions = ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef)
                            and node.name in {'primitive', 'box', 'cyl'}], type_ignores=[])
namespace = {'bpy': bpy, 'bmesh': bmesh, 'Matrix': Matrix, 'col': bpy.context.scene.collection}
exec(compile(functions, 'convoy primitive helpers', 'exec'), namespace)


def snapshot(obj):
    mesh = obj.data
    return (tuple(obj.location), [tuple(v.co) for v in mesh.vertices],
            [(tuple(p.vertices), p.use_smooth) for p in mesh.polygons],
            [[tuple(v.uv) for v in layer.data] for layer in mesh.uv_layers])


for dimensions, bevel in [((2, 3, 4), .035), ((.1, .2, .3), .035), ((1, 1, 1), 0), ((.2, .3, .4), .2)]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(3, 2, 1))
    original = bpy.context.object
    original.scale = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel and min(dimensions) > .12:
        modifier = original.modifiers.new('edge', 'BEVEL')
        modifier.width = min(bevel, min(dimensions) / 5)
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    actual = namespace['box']('box', (3, 2, 1), dimensions, None, bev=bevel)
    assert snapshot(original) == snapshot(actual), ('box', dimensions, bevel)

for segments, radius, end_radius, depth in [(20, .4, .2, 2), (10, .1, .1, 1), (6, .5, 0, 3), (8, .2, .3, .001)]:
    bpy.ops.mesh.primitive_cone_add(vertices=segments, radius1=radius, radius2=end_radius, depth=depth, location=(1, 2, 3))
    original = bpy.context.object
    for face in original.data.polygons: face.use_smooth = len(face.vertices) == 4
    actual = namespace['cyl']('cone', (1, 2, 3), radius, depth, None, vertices=segments, r2=end_radius)
    assert snapshot(original) == snapshot(actual), ('cone', segments, radius, end_radius)
print('PASS: convoy primitive vertices, faces, smoothing and UVs exactly match Blender operators')

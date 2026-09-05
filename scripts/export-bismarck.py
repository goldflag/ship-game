"""Export a compact runtime model; never modify the source blend file.

Usage: blender --background --python scripts/export-bismarck.py
Override BISMARCK_SOURCE to use a different source location.
Preserves collection boundaries for future armament work, merges static parts.
"""
import bpy
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = os.environ.get('BISMARCK_SOURCE', '/Users/bill/models/bismarck/Bismarck_1941.blend')
bpy.ops.wm.open_mainfile(filepath=source)

for obj in list(bpy.data.objects):
    if obj.type not in {'MESH', 'CURVE'} or any('Studio' in c.name for c in obj.users_collection):
        bpy.data.objects.remove(obj, do_unlink=True)

# Apply curves and bevels, then batch the thousands of fittings by collection.
for obj in list(bpy.context.scene.objects):
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_render = False
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = next(iter(bpy.context.scene.objects))
bpy.ops.object.convert(target='MESH')

for collection in list(bpy.data.collections):
    objects = [o for o in collection.objects if o.type == 'MESH']
    if not objects:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = collection.name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

# glTF cannot represent Blender's procedural brick shader. Bake the original
# teak into a repeating texture and project deck UVs at the same meter scale.
teak = next(m for m in bpy.data.materials if m.name.startswith('Teak decking'))
image = bpy.data.images.new('Bismarck teak planks', width=2048, height=512, alpha=False)
image_node = teak.node_tree.nodes.new('ShaderNodeTexImage')
image_node.image = image
teak.node_tree.nodes.active = image_node
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))
bake_plane = bpy.context.object
bake_plane.scale = (10, 1.28, 1)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bake_plane.data.materials.append(teak)
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.device = 'CPU'
bpy.context.scene.cycles.samples = 1
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=0)
image.pack()
bpy.data.objects.remove(bake_plane, do_unlink=True)
principled = teak.node_tree.nodes.get('Principled BSDF')
teak.node_tree.links.new(image_node.outputs['Color'], principled.inputs['Base Color'])
for link in list(principled.inputs['Normal'].links):
    teak.node_tree.links.remove(link)
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or teak not in list(obj.data.materials):
        continue
    uv_layer = obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
    for polygon in obj.data.polygons:
        if obj.data.materials[polygon.material_index] != teak:
            continue
        for loop_index in polygon.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index]
            point = obj.matrix_world @ vertex.co
            uv_layer.data[loop_index].uv = ((point.x + 10) / 20, (point.y + 1.28) / 2.56)

output = root / 'public/models/bismarck.glb'
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', export_yup=True,
    export_cameras=False, export_lights=False, export_animations=False,
    export_extras=True, export_apply=True,
)
print(f'Exported {output} ({output.stat().st_size / 1048576:.1f} MiB)')

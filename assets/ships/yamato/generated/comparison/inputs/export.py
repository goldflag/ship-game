"""Common articulated ship exporter. Operates on a build copy, never the baseline."""
import bpy
import os
import math
import json
from pathlib import Path
from mathutils import Matrix

output_dir = Path(os.environ['SHIP_OUTPUT'])
definition = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.wm.open_mainfile(filepath=str(output_dir / 'source.blend'))

for obj in list(bpy.data.objects):
    if obj.get('exportRole') == 'simulation' or any('Studio' in c.name or 'Measurement' in c.name for c in obj.users_collection) or obj.type not in {'MESH', 'CURVE', 'EMPTY'}:
        bpy.data.objects.remove(obj, do_unlink=True)
for collection in bpy.data.collections:
    collection.hide_viewport=False;collection.hide_render=False
for obj in list(bpy.context.scene.objects):
    obj.hide_set(False);obj.hide_viewport=False;obj.hide_render=False
bpy.ops.object.select_all(action='DESELECT')
convertible=[o for o in bpy.context.scene.objects if o.type in {'MESH','CURVE'}]
for obj in convertible:obj.select_set(True)
bpy.context.view_layer.objects.active=convertible[0]
bpy.ops.object.convert(target='MESH')

# Batch within a single parent + assembly, preserving logical and articulated boundaries.
buckets={}
for obj in bpy.context.scene.objects:
    if obj.type!='MESH' or obj.get('nodeId')=='hull.surface':continue
    key=(obj.parent.name if obj.parent else '', obj.get('assemblyId',''), obj.users_collection[0].name)
    buckets.setdefault(key,[]).append(obj)
for key,objects in buckets.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    bpy.context.object.name=(key[0] or key[1] or key[2])+'.mesh'

# glTF cannot represent Blender's procedural brick shader. Bake the original
# teak into a repeating texture and project deck UVs at the same meter scale.
teak = next((m for m in bpy.data.materials if m.name.startswith('Teak decking')), None)
if teak is not None:
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
    

# Change basis for every local frame AND mesh, so exported coordinates are already
# +Y up, -Z bow. Runtime performs no additional model rotation.
bpy.context.view_layer.update()
rotation=Matrix.Rotation(math.pi/2,4,'Z')
inverse=rotation.inverted()
local_frames={o:o.matrix_local.copy() for o in bpy.context.scene.objects}
meshes=set()
for obj in bpy.context.scene.objects:
    if obj.type=='MESH' and obj.data not in meshes:
        obj.data.transform(rotation);meshes.add(obj.data)
for obj,frame in local_frames.items():
    obj.matrix_parent_inverse=Matrix.Identity(4)
    obj.matrix_local=rotation @ frame @ inverse
bpy.context.view_layer.update()
bpy.context.scene['definitionHash']=definition['contentHash']
bpy.ops.export_scene.gltf(
    filepath=str(output_dir/'model.glb'),export_format='GLB',export_yup=True,
    export_cameras=False,export_lights=False,export_animations=False,
    export_extras=True,export_apply=True,
)
print('EXPORTED',output_dir/'model.glb',flush=True)

"""Blender: build runtime tree/rock LODs and alpha-cutout forest impostors.

blender --background --python scripts/export-harbor-assets.py
Run fetch-harbor-assets.py first. Original CC0 source files stay in /tmp.
"""
import bpy
import math
import sys
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/tmp/bismarck-harbor-source')
OUTPUT = ROOT / 'public/harbor'


def process(asset, name, budget, tree=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / asset / (asset + '.gltf')))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # The source contains three separate example firs. A hillside billboard must
    # represent one rooted tree; a flat three-tree strip floats across slopes.
    if name == 'fir':
        keep = next(o for o in meshes if o.name.startswith('fir_tree_01_a'))
        for other in meshes:
            if other != keep:
                bpy.data.objects.remove(other, do_unlink=True)
        meshes = [keep]
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bounds = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
    low = Vector(tuple(min(p[i] for p in bounds) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in bounds) for i in range(3)))
    base = [obj.matrix_world @ v.co for v in obj.data.vertices if (obj.matrix_world @ v.co).z < low.z + .06]
    root_x = sum(p.x for p in base) / len(base) if tree else (low.x + high.x)/2
    root_y = sum(p.y for p in base) / len(base) if tree else (low.y + high.y)/2
    obj.location -= Vector((root_x, root_y, low.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    height = high.z - low.z
    print('SOURCE', asset, 'height', height, 'polygons', len(obj.data.polygons), flush=True)

    if tree:
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 24
        scene.cycles.use_denoising = True
        scene.render.film_transparent = True
        scene.render.resolution_x = 768
        scene.render.resolution_y = 1024
        scene.render.resolution_percentage = 100
        scene.world = bpy.data.worlds.new('Forest ambient')
        scene.world.use_nodes = True
        scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.58, 0.68, 0.8, 1)
        scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
        scene.view_settings.view_transform = 'Standard'
        light = bpy.data.lights.new('Daylight', 'SUN')
        light.energy = 2.2
        light.angle = 0.2
        sun = bpy.data.objects.new('Daylight', light)
        scene.collection.objects.link(sun)
        sun.rotation_euler = (math.radians(28), math.radians(-24), math.radians(-35))
        data = bpy.data.cameras.new('Impostor camera')
        data.type = 'ORTHO'
        data.ortho_scale = max(height * 1.12, (high.x-low.x) * 1.48, (high.y-low.y) * 1.48)
        camera = bpy.data.objects.new('Impostor camera', data)
        scene.collection.objects.link(camera)
        target = Vector((0, 0, height / 2))
        camera.location = target + Vector((0, -height * 3, 0))
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = camera
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.filepath = str(OUTPUT / (name + '-impostor.png'))
        bpy.ops.render.render(write_still=True)
        # Runtime card dimensions and trunk origin match the rendered framing.
        import json
        (OUTPUT / (name + '.json')).write_text(json.dumps({'height': height, 'cardHeight': data.ortho_scale, 'cardWidth': data.ortho_scale * .75}))

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    tri = obj.modifiers.new('Triangulate', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    reduction = obj.modifiers.new('Runtime LOD', 'DECIMATE')
    reduction.ratio = min(1, budget / max(1, len(obj.data.polygons)))
    bpy.ops.object.modifier_apply(modifier=reduction.name)
    obj.name = name
    for material in obj.data.materials:
        if material and material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    image = node.image
                    if max(image.size) > 1024:
                        ratio = 1024/max(image.size)
                        image.scale(int(image.size[0]*ratio), int(image.size[1]*ratio))
                    image.pack()
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / (name + '.glb')), export_format='GLB', use_selection=True, export_apply=True)
    print('EXPORTED', name, len(obj.data.polygons), flush=True)


if '--rock-only' not in sys.argv:
    if '--props-only' not in sys.argv:
        process('tree_small_02', 'broadleaf', 12000, tree=True)
        process('fir_tree_01', 'fir', 15000, tree=True)
if '--props-only' not in sys.argv and '--trees-only' not in sys.argv:
    process('rock_09', 'coastal-rock', 1800)
if '--rock-only' not in sys.argv and '--trees-only' not in sys.argv:
    process('wooden_military_crate', 'cargo-crate', 750)
    process('barrel_03', 'cargo-barrel', 900)

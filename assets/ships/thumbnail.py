"""Bake a transparent port thumbnail from the validated runtime GLB."""
import json
import os
from pathlib import Path

import bpy
from mathutils import Vector

out = Path(os.environ['SHIP_OUTPUT'])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(out / 'model.glb'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 600
scene.render.resolution_y = 180
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'

world = bpy.data.worlds.new('Thumbnail studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.65, .75, .9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .6
scene.world = world

# Blender's glTF importer maps runtime +Y up/-Z bow to +Z up/+Y bow.
# Fit actual vertices: batched fittings can have rotated local bounding boxes
# whose empty corners extend far beyond the visible ship.
points = [obj.matrix_world @ vertex.co for obj in scene.objects
          if obj.type == 'MESH' for vertex in obj.data.vertices]
if not points:
    raise RuntimeError('The runtime model contains no meshes')
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (low + high) / 2
distance = (high - low).length
camera_data = bpy.data.cameras.new('Port thumbnail')
camera = bpy.data.objects.new('Port thumbnail', camera_data)
scene.collection.objects.link(camera)
camera.location = center + Vector((-1, .35, .45)).normalized() * distance * 2
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.clip_end = distance * 4
scene.camera = camera
bpy.context.view_layer.update()
projected = [camera.matrix_world.inverted() @ p for p in points]
left, right = min(p.x for p in projected), max(p.x for p in projected)
bottom, top = min(p.y for p in projected), max(p.y for p in projected)
camera.location += camera.rotation_euler.to_matrix() @ Vector(((left + right) / 2, (bottom + top) / 2, 0))
camera_data.ortho_scale = max(right - left, (top - bottom) * 600 / 180) * 1.08

for name, direction, energy, color in [
    ('Key', (-1, 1, 2), 2.5, (1, .93, .82)),
    ('Fill', (1, -1, 1), 1.0, (.75, .85, 1)),
]:
    data = bpy.data.lights.new(name, 'SUN')
    data.energy = energy
    data.angle = .2
    data.color = color
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()

scene.render.filepath = str(out / 'thumbnail.png')
bpy.ops.render.render(write_still=True)
(out / 'thumbnail-camera.json').write_text(json.dumps({
    'input': 'validated runtime GLB',
    'importedAxes': 'bow +Y, starboard +X, up +Z',
    'projection': 'orthographic',
    'location': list(camera.location),
    'rotationEuler': list(camera.rotation_euler),
    'scale': camera_data.ortho_scale,
    'resolution': [600, 180],
}, indent=2) + '\n')

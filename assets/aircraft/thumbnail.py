"""Bake squadron-card imagery from the validated original runtime aircraft GLB."""
import hashlib
import json
import os
from pathlib import Path

import bpy
from mathutils import Vector

source = Path(os.environ['AIRCRAFT_MODEL'])
out = Path(os.environ['AIRCRAFT_OUTPUT'])
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 320
scene.render.resolution_y = 144
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'

world = bpy.data.worlds.new('Aircraft thumbnail studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.65, .75, .9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
scene.world = world

# glTF imports to Blender with +Z up and the aircraft nose along +Y.
# Use the actual neutral articulated model; never write changes into its source.
points = [obj.matrix_world @ vertex.co for obj in scene.objects
          if obj.type == 'MESH' for vertex in obj.data.vertices]
if not points:
    raise RuntimeError('Aircraft GLB contains no meshes')
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (low + high) / 2
span = (high - low).length
data = bpy.data.cameras.new('Squadron card')
camera = bpy.data.objects.new('Squadron card', data)
scene.collection.objects.link(camera)
camera.location = center + Vector((-1.15, 1.8, 1.25)).normalized() * span * 2
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
data.type = 'ORTHO'
data.clip_end = span * 4
scene.camera = camera
bpy.context.view_layer.update()
projected = [camera.matrix_world.inverted() @ p for p in points]
left, right = min(p.x for p in projected), max(p.x for p in projected)
bottom, top = min(p.y for p in projected), max(p.y for p in projected)
camera.location += camera.rotation_euler.to_matrix() @ Vector(((left + right) / 2, (bottom + top) / 2, 0))
data.ortho_scale = max(right - left, (top - bottom) * 320 / 144) * 1.06
for name, direction, energy, color in [
    ('Key', (-1, 1, 2), 2.5, (1, .93, .82)),
    ('Fill', (1, -1, 1), 1.1, (.75, .85, 1)),
]:
    light_data = bpy.data.lights.new(name, 'SUN')
    light_data.energy = energy
    light_data.angle = .2
    light_data.color = color
    light = bpy.data.objects.new(name, light_data)
    scene.collection.objects.link(light)
    light.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()

scene.render.filepath = str(out / 'thumbnail.png')
bpy.ops.render.render(write_still=True)
(out / 'render.json').write_text(json.dumps({
    'schemaVersion': 1,
    'aircraftId': os.environ['AIRCRAFT_ID'],
    'method': 'local-blender',
    'blenderVersion': bpy.app.version_string,
    'modelHash': hashlib.sha256(source.read_bytes()).hexdigest(),
    'recipeHash': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'imageHash': hashlib.sha256((out / 'thumbnail.png').read_bytes()).hexdigest(),
    'importedAxes': 'nose +Y, starboard +X, up +Z',
    'projection': 'orthographic',
    'location': list(camera.location),
    'rotationEuler': list(camera.rotation_euler),
    'scale': data.ortho_scale,
    'resolution': [320, 144],
}, indent=2) + '\n')

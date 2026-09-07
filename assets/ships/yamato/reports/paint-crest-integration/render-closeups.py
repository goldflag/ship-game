"""Repeatable textured close-ups of the exact published Yamato GLB."""
import json
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/yamato.glb'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
world = bpy.data.worlds.new('Crest review studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.32, .4, .5, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
scene.world = world
for name, position, energy in [('Key', (-3, 5, 6), 2.5), ('Fill', (4, 1, 3), 1.1)]:
    data = bpy.data.lights.new(name, 'SUN'); data.energy = energy; data.angle = .25
    light = bpy.data.objects.new(name, data); scene.collection.objects.link(light)
    light.rotation_euler = (-Vector(position)).to_track_quat('-Z', 'Y').to_euler()
views = [
    ('crest-front', (0, 150, 10.4), (0, 131.5, 10.17), 2.8),
    ('crest-quarter', (8, 145, 14), (0, 130.8, 10.0), 6),
    ('crest-side', (12, 134, 11.2), (0, 131.4, 10.1), 3.4),
]
for name, position, target, scale in views:
    data = bpy.data.cameras.new(name); data.type = 'ORTHO'; data.ortho_scale = scale; data.clip_end = 1000
    camera = bpy.data.objects.new(name, data); scene.collection.objects.link(camera)
    camera.location = position
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera; scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
definition = json.loads((ROOT / 'public/models/yamato.json').read_text())
(OUT / 'cameras.json').write_text(json.dumps({'contentHash': definition['contentHash'], 'input': 'published GLB',
    'tool': 'local Blender 5.2 / Cycles', 'importedAxes': 'bow +Y, starboard +X, up +Z',
    'views': views}, indent=2) + '\n')

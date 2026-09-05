"""Read-only close review views, supplementing the shared five-view ship:review.

Run with local Blender --background --python this/file.py after ship:build.
No camera, material or geometry edits are saved back to the original scene.
"""
import json
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
definition = json.loads((ROOT / 'public/models/yamato.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(HERE / 'generated/source.blend'))
scene = bpy.context.scene
assert scene.get('definitionHash') == definition['contentHash'], 'Build Yamato before reviewing.'
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.studiolight_rotate_z = .45
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'
scene.world.color = (.16, .19, .22)
scene.render.resolution_percentage = 100
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.image_settings.file_format = 'PNG'
folder = HERE / 'generated/review/details'
folder.mkdir(parents=True, exist_ok=True)
views = [
    ('bridge-quarter', (37, -80, 47), (-8, 0, 25), 49),
    ('superstructure-profile', (-17, -160, 24), (-17, 0, 24), 79),
    ('forward-battery', (80, -65, 36), (40, 0, 9), 65),
    ('stern-quarter', (-155, -70, 32), (-108, 0, 3), 71),
]
for name, location, target, scale in views:
    data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, data)
    scene.collection.objects.link(camera)
    camera.location = location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = scale
    data.clip_end = 1000
    scene.camera = camera
    scene.render.filepath = str(folder / (name + '.png'))
    bpy.ops.render.render(write_still=True)
(folder / 'cameras.json').write_text(json.dumps({
    'contentHash': definition['contentHash'],
    'projection': 'orthographic',
    'authoringAxes': 'bow +X, port +Y, up +Z',
    'views': views,
}, indent=2) + '\n')

"""Transparent diagnostic profiles from the actual source, using fixed cameras.
Local Blender: blender -b --python assets/ships/convoy/render-alpha-profiles-v2.py
Does not edit/save the original model or change any geometry.
"""
import bpy
import json
from pathlib import Path
from mathutils import Vector

folder=Path(__file__).resolve().parent
for ship in ['flower-corvette','liberty-cargo','victory-cargo']:
    generated=folder.parent/ship/'generated'
    record=json.loads((generated/'review/cameras.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(generated/'source.blend'))
    scene=bpy.context.scene
    if scene.get('definitionHash')!=record['contentHash']:raise RuntimeError('Stale source/review '+ship)
    for obj in scene.objects:
        obj.hide_render=obj.get('exportRole')=='simulation' or any('Studio' in c.name or 'Measurement' in c.name for c in obj.users_collection)
    name,location,target,scale,w,h=next(v for v in record['views'] if v[0]=='profile')
    data=bpy.data.cameras.new('Transparent diagnostic profile');camera=bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(camera);camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=scale;data.clip_end=2000;scene.camera=camera
    scene.render.engine='BLENDER_WORKBENCH'
    scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
    scene.render.film_transparent=True
    scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.filepath=str(generated/'review/profile-alpha.png')
    bpy.ops.render.render(write_still=True)

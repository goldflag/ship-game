"""Repeatable source review cameras. Uses Workbench to make geometry easy to inspect."""
import bpy
import json
import os
from pathlib import Path
from mathutils import Vector

out = Path(os.environ['SHIP_OUTPUT'])
definition = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.wm.open_mainfile(filepath=str(out/'source.blend'))
scene = bpy.context.scene
if scene.get('definitionHash') != definition['contentHash']:
    raise RuntimeError('Source is stale. Run ship:build before ship:review.')
for obj in scene.objects:
    obj.hide_render = obj.get('exportRole') == 'simulation' or any('Studio' in c.name or 'Measurement' in c.name for c in obj.users_collection)
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'
scene.world.color = (.055,.075,.095)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
folder = out/'renders'
folder.mkdir(exist_ok=True)
length = definition['hull']['length']
points = [obj.matrix_world @ Vector(corner) for obj in scene.objects
          if obj.type == 'MESH' and not obj.hide_render for corner in obj.bound_box]
low = min(p.z for p in points)
high = max(p.z for p in points)
center_height = (low + high) / 2
height = high - low
views = [
    ('profile',(0,-length*2,center_height),(0,0,center_height),max(length*1.1,height*1.1*1600/520),1600,520),
    ('plan',(0,0,length*2),(0,0,0),length*1.1,1600,520),
    ('bow',(length*2,0,center_height),(0,0,center_height),max(definition['hull']['beam']*1.1,height*1.1),800,800),
    ('stern',(-length*2,0,center_height),(0,0,center_height),max(definition['hull']['beam']*1.1,height*1.1),800,800),
    ('quarter',(length*.8,-length*1.2,length*.7),(0,0,8),length*1.15,1400,900),
]
for name,location,target,scale,w,h in views:
    data=bpy.data.cameras.new('Review '+name)
    camera=bpy.data.objects.new('Review '+name,data)
    scene.collection.objects.link(camera)
    camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    if name=='plan':camera.rotation_euler=(0,0,0)
    data.type='ORTHO';data.ortho_scale=scale;data.clip_end=length*10
    scene.camera=camera
    scene.render.resolution_x=w;scene.render.resolution_y=h
    scene.render.filepath=str(folder/(name+'.png'))
    bpy.ops.render.render(write_still=True)
(folder/'cameras.json').write_text(json.dumps({'contentHash':definition['contentHash'],'projection':'orthographic','authoringAxes':'bow +X, port +Y, up +Z','views':views},indent=2)+'\n')

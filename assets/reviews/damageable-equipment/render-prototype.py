"""Review-only closeups of the retained experimental component, not authoring input."""
import bpy,json,math,os
from pathlib import Path
from mathutils import Vector
stage=Path(os.environ['SHIP_OUTPUT']);out=Path(os.environ['EQUIPMENT_REVIEW_OUTPUT'])
bpy.ops.wm.open_mainfile(filepath=str(stage/'source.blend'))
scene=bpy.context.scene
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True;scene.display.shading.background_type='WORLD';scene.world.color=(.055,.075,.095)
scene.render.resolution_x=1100;scene.render.resolution_y=850;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
for o in scene.objects:o.hide_render=o.get('exportRole')=='simulation' or any('Studio' in c.name or 'Measurement' in c.name for c in o.users_collection)
data=bpy.data.cameras.new('Equipment camera');cam=bpy.data.objects.new('Equipment camera',data);scene.collection.objects.link(cam)
cam.location=(10,14,18.5);target=Vector((4,6.6,14.25));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=8;scene.camera=cam
for elevation in [0,40,80]:
 for o in scene.objects:
  if o.get('nodeId','').startswith('pom-pom-1.') and o.get('nodeId','').endswith('.elevation'):o.rotation_euler.y=-math.radians(elevation)
 scene.render.filepath=str(out/f'component-elevation-{elevation}.png');bpy.ops.render.render(write_still=True)
(out/'closeups.json').write_text(json.dumps({'contentHash':scene.get('definitionHash'),'elevationDeg':[0,40,80],'status':'experimental; not a historical-accuracy or clearance certification'},indent=2)+'\n')

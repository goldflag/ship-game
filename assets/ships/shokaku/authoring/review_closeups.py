"""Unobstructed mechanism views of the exact source, plus support views.

Isolation is a review operation only; no production object is removed or saved.
The omitted hull cannot be used to infer ship clearance: see static-sweep.json.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
scene=bpy.context.scene
assert scene.get('definitionHash')==D['contentHash']
OUT=ROOT/'reports'/('geometry-'+D['contentHash'][:8]);OUT.mkdir(exist_ok=True)
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH';scene.display.shading.background_type='WORLD'
scene.world.color=(.22,.25,.28)
scene.view_settings.view_transform='Standard';scene.view_settings.exposure=.7
scene.render.resolution_x=1200;scene.render.resolution_y=900
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
data=bpy.data.cameras.new('review-closeup');cam=bpy.data.objects.new('review-closeup',data)
scene.collection.objects.link(cam);scene.camera=cam;data.type='ORTHO'
rows=[]
def render(name,location,target,scale,**notes):
    cam.location=location;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    data.ortho_scale=scale;scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    rows.append(dict(name=name,location=list(location),target=list(target),scaleM=scale,**notes))
seen=set()
for mount in D['mounts']:
    if mount['partId'] in seen:continue
    seen.add(mount['partId']);heavy=mount['weapon']['caliberM']>.1
    root=bpy.data.objects[mount['id']+'.base'];yaw=bpy.data.objects[mount['id']+'.yaw']
    owned={root,*root.children_recursive}
    for o in scene.objects:
        if o.type=='MESH':o.hide_render=o not in owned
    bpy.context.view_layer.update();matrix=yaw.matrix_world
    target=(1 if heavy else .25,0,1.65 if heavy else .9);scale=9 if heavy else 4.7
    for label,location in [('side',(0,14,4)),('rear',(-10,-7,5))]:
        render(mount['partId']+'-'+label,matrix@Vector(location),matrix@Vector(target),scale,
               assembly=mount['id'],isolation='Own mount only, neutral elevation 1 degree; hull omitted for hidden mechanisms')
for o in scene.objects:
    if o.type=='MESH':o.hide_render=o.get('exportRole')=='simulation'
render('open127-gallery',(82,26,14),(75.7,14.8,12.4),13)
render('gallery-understructure',(-57,-28,7),(-55.7,-16.05,10.7),14)
render('funnel-underside',(9,-29,7),(7,-16,11.5),24)
(OUT/'closeup-cameras.json').write_text(json.dumps({'contentHash':D['contentHash'],'projection':'orthographic','views':rows},indent=2)+'\n')

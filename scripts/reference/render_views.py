"""Shared neutral cameras for raster comparison. No geometry authoring code imports this."""
import bpy, hashlib, json, math
from mathutils import Vector

def render_views(plan, folder, objects, source):
    folder.mkdir(parents=True, exist_ok=True)
    scene=bpy.context.scene
    scene.render.engine='BLENDER_WORKBENCH'
    sh=scene.display.shading
    sh.light='STUDIO';sh.studiolight_rotate_z=math.radians(25)
    sh.color_type='SINGLE';sh.single_color=(.55,.57,.59)
    sh.show_shadows=True;sh.show_cavity=True;sh.cavity_type='BOTH'
    sh.show_specular_highlight=False;sh.show_object_outline=True
    sh.background_type='WORLD';scene.world.color=(.92,.93,.94)
    scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.resolution_percentage=100
    scene.view_settings.view_transform='Standard'
    captures=[]
    for v in plan['views']:
        allowed=v.get('visibility','all')
        for ob in objects:
            role=ob.get('referenceRole',ob.get('assemblyId',''))
            ob.hide_render = ob.get('exportRole')=='simulation' or (allowed!='all' and not any(t in role for t in allowed))
        camdata=bpy.data.cameras.new(v['id']);cam=bpy.data.objects.new(v['id'],camdata);scene.collection.objects.link(cam)
        cam.location=v['position'];cam.rotation_euler=(Vector(v['target'])-cam.location).to_track_quat('-Z','Y').to_euler()
        if v.get('rotationEuler') is not None:cam.rotation_euler=v['rotationEuler']
        camdata.type=v.get('projection','ORTHO');camdata.ortho_scale=v['spanM'];camdata.lens=v.get('lensMm',50);camdata.clip_end=3000
        scene.camera=cam;scene.render.resolution_x=v['resolution'][0];scene.render.resolution_y=v['resolution'][1]
        scene.render.filepath=str(folder/(v['id']+'.png'));bpy.ops.render.render(write_still=True)
        captures.append({**v,'image':v['id']+'.png','imageSha256':hashlib.sha256((folder/(v['id']+'.png')).read_bytes()).hexdigest(),'cameraMatrixWorld':[list(row) for row in cam.matrix_world],'crop':'full image; no post-render crop','pixelsPerMeter':max(v['resolution'])/v['spanM'] if camdata.type=='ORTHO' else None,'source':source,'material':'neutral texture-free clay; no source UVs or textures loaded','axes':'Blender +X bow, +Y port, +Z up','historicallyVerified':False})
        bpy.data.objects.remove(cam,do_unlink=True)
    return captures

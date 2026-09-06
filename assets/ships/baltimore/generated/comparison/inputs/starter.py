"""Minimal original hull and reusable guns for a new ship recipe. Not a historical model."""
import bpy
import json
import os
import sys
from pathlib import Path
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_components import create_gun_mount
out=Path(os.environ['SHIP_OUTPUT'])
definition=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
collection=bpy.data.collections.new('Ship components');scene.collection.children.link(collection)
materials={}
for key,color in {'naval':(.38,.43,.45,1),'roof':(.22,.26,.28,1),'edge':(.18,.2,.22,1),'hullgray':(.28,.33,.35,1),'canvas':(.48,.48,.42,1),'dark':(.03,.035,.04,1)}.items():
    m=bpy.data.materials.new(key);m.diffuse_color=color;m.use_nodes=True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color
    materials[key]=m
def mesh(name,vertices,faces,material,col,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);col.objects.link(obj)
    if material:obj.data.materials.append(material)
    for polygon in data.polygons:polygon.use_smooth=smooth
    return obj
def finish(obj,name,material,col):
    obj.name=name
    for c in list(obj.users_collection):c.objects.unlink(obj)
    col.objects.link(obj);obj.data.materials.append(material)
    return obj
def cyl(name,loc,radius,depth,material,col,vertices=32,r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if r2 is None else r2,depth=max(.001,depth),location=loc)
    return finish(bpy.context.object,name,material,col)
def rod(name,a,b,r,material,col,r2=None,vertices=12):
    a,b=Vector(a),Vector(b);obj=cyl(name,(a+b)/2,r,(b-a).length,material,col,vertices,r2)
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return obj
def box(name,loc,dim,material,col,bev=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object;obj.scale=dim
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,material,col)
def interpolate(stations,t):
    for (a,va),(b,vb) in zip(stations,stations[1:]):
        if a<=t<=b:return va+(vb-va)*(t-a)/(b-a)
    return stations[0][1] if t<stations[0][0] else stations[-1][1]
h=definition['hull'];vertices=[];faces=[]
for station,width in h['halfBreadths']:
    x=station-h['length']/2;top=interpolate(h['deckHeights'],station);bottom=interpolate(h['keelHeights'],station)
    vertices.extend([(x,-width,top),(x,width,top),(x,width*.6,bottom),(x,-width*.6,bottom)])
for i in range(len(h['halfBreadths'])-1):
    for j in range(4):faces.append((i*4+j,(i+1)*4+j,(i+1)*4+(j+1)%4,i*4+(j+1)%4))
faces.extend([(3,2,1,0),tuple((len(h['halfBreadths'])-1)*4+j for j in range(4))])
hull=mesh('Hull',vertices,faces,materials['hullgray'],collection);hull['nodeId']='hull.surface'
for mount in definition['mounts']:
    create_gun_mount(mount,collection,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,lambda x:interpolate(h['deckHeights'],x+h['length']/2))
scene['definitionHash']=definition['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))

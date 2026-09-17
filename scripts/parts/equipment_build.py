"""Build registered original non-gun equipment with the common ship exporter."""
import bpy
import bmesh
import json
import os
import runpy
import sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'assets/parts/construction'))
from library import create_equipment
out=Path(os.environ['SHIP_OUTPUT'])
definition=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
part=definition['equipment']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
col=bpy.data.collections.new('Original equipment');scene.collection.children.link(col)
sys.path.insert(0, str(ROOT / 'assets/parts'))
from materials import create_materials
materials = create_materials()

def mesh(name,vertices,faces,material,col,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
    obj=bpy.data.objects.new(name,data);col.objects.link(obj);data.materials.append(material)
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

def box(name,loc,size,material,col,bev=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,material,col)

root=create_equipment(part,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials)
for socket in definition.get('sockets',[]):
    name='component.socket.'+socket['id']
    o=bpy.data.objects.new(name,None);col.objects.link(o);o.parent=root
    x,y,z=socket['position'];o.location=(-z,-x,y)
    o['nodeId']=name;o['assemblyId']='component';o['socketKind']=socket['kind']
scene['definitionHash']=definition['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
runpy.run_path(str(ROOT/'scripts/ships/export.py'),run_name='__main__')

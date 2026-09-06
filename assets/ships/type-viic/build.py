"""Original early-war Type VIIC; blueprint stations and independently authored fittings.
Blender: +X bow, +Y port, +Z up. Reference images never become textures.
"""
import bpy, json, math, os, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts/ships'))
from blender_components import create_gun_mount
out=Path(os.environ['SHIP_OUTPUT']);definition=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
col=bpy.data.collections.new('Type VIIC original assemblies');scene.collection.children.link(col)
materials={}
colors={'naval':(.36,.40,.41,1),'roof':(.21,.25,.26,1),'edge':(.12,.15,.16,1),'hullgray':(.27,.31,.32,1),'canvas':(.39,.40,.35,1),'dark':(.018,.026,.027,1),'underwater':(.085,.11,.12,1),'deck':(.24,.25,.22,1),'bronze':(.34,.25,.10,1)}
for key,color in colors.items():
 m=bpy.data.materials.new('VIIC '+key);m.diffuse_color=color;m.use_nodes=True
 bsdf=m.node_tree.nodes['Principled BSDF'];bsdf.inputs['Base Color'].default_value=color;bsdf.inputs['Roughness'].default_value=.72 if key!='bronze' else .35;bsdf.inputs['Metallic'].default_value=.1 if key!='bronze' else .7;materials[key]=m

def mesh(name,vertices,faces,material,collection=col,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update();obj=bpy.data.objects.new(name,data);collection.objects.link(obj)
 if material:data.materials.append(material)
 for p in data.polygons:p.use_smooth=smooth
 obj['assemblyId']=name.split('.')[0];return obj

def finish(obj,name,material,collection):
 obj.name=name
 for c in list(obj.users_collection):c.objects.unlink(obj)
 collection.objects.link(obj);obj.data.materials.append(material);obj['assemblyId']=name.split('.')[0];return obj

def cyl(name,loc,radius,depth,material,collection=col,vertices=24,r2=None):
 bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if r2 is None else r2,depth=max(.001,depth),location=loc)
 return finish(bpy.context.object,name,material,collection)

def rod(name,a,b,r,material,collection=col,r2=None,vertices=12):
 a,b=Vector(a),Vector(b);obj=cyl(name,(a+b)/2,r,(b-a).length,material,collection,vertices,r2);obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return obj

def box(name,loc,dim,material,collection=col,bev=.02):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object;obj.scale=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(obj,name,material,collection)

def empty(name,loc):
 obj=bpy.data.objects.new(name,None);col.objects.link(obj);obj.location=loc;obj['nodeId']=name;obj['assemblyId']=name.split('.')[0];return obj

def attach(obj,parent):
 bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world

def interp(table,s):
 for (a,va),(b,vb) in zip(table,table[1:]):
  if a<=s<=b:return va+(vb-va)*(s-a)/(b-a)
 return table[0][1] if s<table[0][0] else table[-1][1]
h=definition['hull'];half=h['length']/2;deckz=lambda x:interp(h['deckHeights'],x+half);width=lambda x:interp(h['halfBreadths'],x+half)
verts=[]
for section in h['sections']:
 pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])];verts.extend([(section['station']-half,w,z) for w,z in ring])
n=len(ring);faces=[]
for i in range(len(h['sections'])-1):
 for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
faces.extend([tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))])
hull=mesh('hull.envelope',verts,faces,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface';hull.data.materials.append(materials['underwater'])
for face in hull.data.polygons:face.material_index=1 if sum(hull.data.vertices[i].co.z for i in face.vertices)/len(face.vertices)<0 else 0
# Timber casing deck, longitudinal drainage slots, free-flood openings and hatches.
v=[]
for s,w in h['halfBreadths']:
 x=s-half;v += [(x,-w*.526,deckz(x)+.018),(x,w*.526,deckz(x)+.018)]
mesh('deck.timber',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(h['halfBreadths'])-1)],materials['deck'])
for i in range(119):
 x=-29.5+i*.5;w=width(x)
 for side in (-1,1):
  for lane in range(1,4):
   y=side*(.14+lane*.30)
   if abs(y)<w*.49 and not(-5<x<5.2):box('deck.drainage-slot',(x,y,deckz(x)+.025),(.34,.045,.007),materials['dark'])
  if w>.9:box('casing.flood-slot',(x,side*w*.985,.52),(.31,.028,.115),materials['dark'])
for x in (-25,-18,-10,6.7,13,20,26):
 cyl('deck.access-hatch',(x,0,deckz(x)+.07),.38,.1,materials['edge']);cyl('deck.hatch-lid',(x,0,deckz(x)+.13),.32,.035,materials['naval']);rod('deck.hatch-handle',(x-.1,0,deckz(x)+.18),(x+.1,0,deckz(x)+.18),.025,materials['edge'])
# Tower footprint is shared with CPU structural plating.
s=definition['structures'][0];outline=[(-z,-x) for x,z in s['footprint']];base=s['baseY'];top=base+s['height'];n=len(outline)
v=[(x,y,z) for z in (base,top) for x,y in outline]
mesh('conning-tower.fairing',v,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(range(n,2*n))],materials['naval'],smooth=True)
bridge=[(3.6,-.57),(3.25,-.95),(2.3,-1.05),(.3,-1.02),(-.5,-.65),(-.7,0),(-.5,.65),(.3,1.02),(2.3,1.05),(3.25,.95),(3.6,.57)]
for i in range(len(bridge)):
 a,b=bridge[i],bridge[(i+1)%len(bridge)];mesh('bridge.windbreak',[(*a,top),(*b,top),(*b,5.14),(*a,5.14)],[(0,1,2,3)],materials['naval']);rod('bridge.lip',(*a,5.15),(*b,5.15),.04,materials['edge'])
mesh('bridge.floor',[(x,y,top+.01) for x,y in bridge],[tuple(range(len(bridge)))],materials['dark'])
cyl('wintergarten.platform',(-2.8,0,4.18),1.4,.14,materials['roof'],vertices=40)
for i in range(17):
 a=math.pi*.15+i/16*math.pi*1.7;x,y=-2.8-math.sin(a)*1.38,math.cos(a)*1.38
 rod('wintergarten.stanchion',(x,y,4.2),(x,y,5.05),.025,materials['edge'])
 if i:rod('wintergarten.rail',previous,(x,y,5.05),.028,materials['edge'])
 previous=(x,y,5.05)
for x,z in ((.45,8.4),(1.6,7.6)):
 cyl('periscopes.housing',(x,0,4.75),.23,1.4,materials['hullgray']);rod('periscopes.shaft',(x,0,4.9),(x,0,z),.065,materials['edge'],r2=.043);rod('periscopes.head',(x,0,z),(x+.18,0,z),.065,materials['naval'])
for i in range(32):
 a,b=i*math.tau/32,(i+1)*math.tau/32;rod('antenna.loop',(2.7,.52+math.sin(a)*.32,5.77+math.cos(a)*.32),(2.7,.52+math.sin(b)*.32,5.77+math.cos(b)*.32),.025,materials['edge'])
rod('antenna.stem',(2.7,.52,5.1),(2.7,.52,5.45),.04,materials['edge'])
for side in (-1,1):
 rod('tower.air-intake',(-.6,side*.91,2),(-.6,side*.91,4.2),.13,materials['edge'])
 for z in (2,2.35,2.7,3.05,3.4,3.75):rod('tower.ladder-rung',(-1.4,side*.4,z),(-1.4,side*.8,z),.028,materials['edge'])
 previous=None
 for x in range(-9,10):
  y,z=side*width(x)*.50,deckz(x);rod('rails.stanchion',(x,y,z),(x,y,z+.85),.025,materials['edge'])
  if previous:
   rod('rails.top',previous,(x,y,z+.85),.02,materials['edge']);rod('rails.middle',(previous[0],previous[1],previous[2]-.4),(x,y,z+.45),.018,materials['edge'])
  previous=(x,y,z+.85)
for end in (-31,32):
 anchor=(end,0,deckz(end)+.7);rod('rigging.end-post',(end,0,deckz(end)),anchor,.035,materials['edge']);tower=(-2.5 if end<0 else 2.5,0,5.8);middle=((end+tower[0])/2,0,(anchor[2]+tower[2])/2-.25);rod('rigging.wire',anchor,middle,.012,materials['dark']);rod('rigging.wire',middle,tower,.012,materials['dark'])
for x in (-29,29):
 for y in (-.18,.18):cyl('deck.bollard',(x,y,deckz(x)+.19),.075,.3,materials['edge'])
# Independent appendage pivots retained for future depth controls.
for side in (-1,1):
 label='port' if side>0 else 'starboard'
 for x,z,span,chord in ((26,-1.15,1.65,1.5),(-27,-1.5,1.55,1.45)):
  y=side*max(.5,width(x)*.72);pivot=empty(('bow-plane-' if x>0 else 'stern-plane-')+label+'.pivot',(x,y,z));plane=mesh(pivot.name+'.blade',[(x-chord/2,y,z),(x+chord/2,y,z),(x+chord*.35,y+side*span,z),(x-chord*.65,y+side*span,z),(x,y+side*span*.4,z-.12)],[(0,1,2,3),(0,4,1),(1,4,2),(2,4,3),(3,4,0)],materials['underwater']);attach(plane,pivot)
 rod('shafts.'+label,(-20,side*1.02,-2.45),(-28.6,side*1.04,-2.45),.09,materials['edge'])
 screw=empty('propeller-'+label+'.pivot',(-28.6,side*1.04,-2.45));hub=rod('propeller-'+label+'.hub',(-28.15,side*1.04,-2.45),(-29.1,side*1.04,-2.45),.17,materials['bronze'],r2=.04);attach(hub,screw)
 for i in range(3):
  a=i*math.tau/3;points=[(-28.6,side*1.04+math.cos(a+d)*r,-2.45+math.sin(a+d)*r) for r,d in ((.12,-.2),(.72,-.12),(.83,.28),(.35,.62))];blade=mesh('propeller-'+label+'.blade',points,[(0,1,2,3)],materials['bronze']);attach(blade,screw)
 rudder=empty('rudder-'+label+'.pivot',(-30,side*.8,-1.8));attach(box('rudder-'+label+'.blade',(-30.1,side*.8,-2.25),(1.2,.11,1.7),materials['underwater']),rudder)
for tube in definition['torpedoTubes']:
 x,y,z=tube['position'];pos=(-z,-x,y);direction=1 if tube['bearingDeg']==0 else -1;socket=empty(tube['id']+'.muzzle',pos);socket.rotation_euler.z=-math.radians(tube['bearingDeg']);rod(tube['id']+'.rim',(pos[0]-.16*direction,pos[1],pos[2]),pos,.31,materials['edge'],vertices=32);rod(tube['id']+'.mouth',pos,(pos[0]+.008*direction,pos[1],pos[2]),.2665,materials['dark'],vertices=32)
for mount in definition['mounts']:create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
scene['definitionHash']=definition['contentHash'];bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))

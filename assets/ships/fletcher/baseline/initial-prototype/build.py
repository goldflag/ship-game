"""Original early-war Fletcher-class destroyer; blueprint-driven stations and fittings.
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
col=bpy.data.collections.new('Fletcher original assemblies');scene.collection.children.link(col)
materials={}
colors={'naval':(.36,.40,.41,1),'roof':(.21,.25,.26,1),'edge':(.12,.15,.16,1),'hullgray':(.27,.31,.32,1),'canvas':(.39,.40,.35,1),'dark':(.018,.026,.027,1),'underwater':(.24,.055,.04,1),'deck':(.12,.16,.20,1),'bronze':(.34,.25,.10,1)}
for key,color in colors.items():
 m=bpy.data.materials.new('Fletcher '+key);m.diffuse_color=color;m.use_nodes=True
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
h=definition['hull'];half=h['length']/2
width=lambda x:interp(h['halfBreadths'],x+half)
deckz=lambda x:interp(h['deckHeights'],x+half)
# Original hull, with a continuous sheer and rounded bilge sections.
verts=[]
for section in h['sections']:
 pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
 verts.extend([(section['station']-half,w,z) for w,z in ring])
n=len(ring);faces=[]
for i in range(len(h['sections'])-1):
 for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
faces.extend([tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))])
hull=mesh('hull.envelope',verts,faces,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface';hull.data.materials.append(materials['underwater'])
for face in hull.data.polygons:face.material_index=1 if sum(hull.data.vertices[i].co.z for i in face.vertices)/len(face.vertices)<-.18 else 0
v=[]
for s,w in h['halfBreadths']:
 x=s-half;v.extend([(x,-w,deckz(x)+.025),(x,w,deckz(x)+.025)])
mesh('deck.steel',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(h['halfBreadths'])-1)],materials['deck'])
# Blueprint tiers and funnel casings also define CPU obstruction/inspection geometry.
for s in definition['structures']:
 outline=[(-z,-x) for x,z in s['footprint']];bottom=s['baseY'];top=bottom+s['height']
 if 'funnel' in s['id']:
  cx=sum(p[0] for p in outline)/len(outline);rx=(max(p[0] for p in outline)-min(p[0] for p in outline))/2;ry=max(p[1] for p in outline)
  outline=[(cx+rx*math.cos(i*math.tau/32),ry*math.sin(i*math.tau/32)) for i in range(32)]
 n=len(outline);vs=[(x,y,z) for z in [bottom,top] for x,y in outline]
 o=mesh(s['id']+'.walls',vs,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(range(n,2*n))],materials['naval'],smooth='funnel' in s['id'])
 mesh(s['id']+'.roof',[(x,y,top+.018) for x,y in outline],[tuple(range(n))],materials['deck'])
 if 'funnel' in s['id']:
  mesh(s['id']+'.cap',[(x,y,z) for z in [top-.75,top+.06] for x,y in outline],[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(range(n,2*n))],materials['dark'],smooth=True)
  for y in (-ry,ry):rod(s['id']+'.steam-pipe',(cx-1,y,bottom),(cx-1,y,top+.45),.09,materials['edge'])
 else:
  for i in range(n):rod(s['id']+'.rim',(*outline[i],top+.04),(*outline[(i+1)%n],top+.04),.035,materials['edge'])
# Bridge windows and narrow wings, director pedestal and Mk 37-inspired rangefinder.
for y in [-2,-1,0,1,2]:box('bridge.front-window',(24.02,y,9.9),(.035,.65,.58),materials['dark'])
for side in [-1,1]:
 for x in [19,20.1,21.2,22.3]:box('bridge.side-window',(x,side*2.82,9.9),(.65,.035,.58),materials['dark'])
 box('bridge.wing',(21,side*3.5,8.72),(4,2.2,.16),materials['roof'])
 box('bridge.wing-wall',(22.9,side*3.5,9.08),(.12,2.2,.6),materials['naval'])
cyl('director.base',(17,0,11),1.05,.8,materials['naval'])
box('director.housing',(17,0,12.05),(2.8,2.2,1.6),materials['naval'])
rod('director.rangefinder',(17,-2.4,12.5),(17,2.4,12.5),.2,materials['edge'])
for y in [-2.4,2.4]:box('director.ears',(17,y,12.5),(.6,.5,.65),materials['naval'])
# Tripod foremast and open radar grids; each is original primitive geometry.
rod('mast.main',(12.8,0,6),(12.3,0,22.4),.18,materials['edge'],r2=.08)
for side in [-1,1]:rod('mast.tripod',(11.8,side*2.8,5.9),(12.6,0,17.5),.12,materials['edge'],r2=.06)
rod('mast.yard',(12.5,-5.2,17.7),(12.5,5.2,17.7),.065,materials['edge'])
for z in [20.3,20.65,21,21.35,21.7]:rod('radar.horizontal',(12.3,-2.1,z),(12.3,2.1,z),.026,materials['edge'])
for i in range(13):
 y=-2.1+i*.35;rod('radar.vertical',(12.3,y,20.3),(12.3,y,21.7),.024,materials['edge'])
rod('mast.aft',(-18,0,5.6),(-18.2,0,13.6),.085,materials['edge'],r2=.035)
for side in [-1,1]:
 rod('rigging.fore',(12.3,side*4.8,17.7),(37,side*2.5,deckz(37)+.2),.012,materials['dark'])
 rod('rigging.aft',(12.3,side*4.8,17.7),(-18.2,side*.1,13.6),.012,materials['dark'])
# Two independent quintuple tube assemblies. Muzzles are children of shared yaw empties.
for launcher in definition['torpedoLaunchers']:
 a,b,c=launcher['position'];x,y,z=-c,-a,b
 cyl(launcher['id']+'.race',(x,y,z+.15),1.45,.3,materials['edge'])
 pivot=empty(launcher['id']+'.yaw',(x,y,z))
 pieces=[]
 pieces.append(box(launcher['id']+'.platform',(x,y,z+.35),(5,3.7,.22),materials['roof']))
 for tube in [t for t in definition['torpedoTubes'] if t['launcherId']==launcher['id']]:
  a,b,c=tube['position'];m=(-c,-a,b)
  pieces.append(rod(tube['id']+'.tube',(m[0]-7.8,m[1],m[2]),m,.31,materials['naval'],vertices=24))
  pieces.append(rod(tube['id']+'.mouth',m,(m[0]+.015,m[1],m[2]),.269,materials['dark'],vertices=24))
  for dx in [-1.1,-3.2,-5.4,-7]:pieces.append(rod(tube['id']+'.band',(m[0]+dx-.045,m[1],m[2]),(m[0]+dx+.045,m[1],m[2]),.34,materials['edge'],vertices=24))
  socket=empty(tube['id']+'.muzzle',m);attach(socket,pivot)
 pieces.append(box(launcher['id']+'.control',(x-1.1,1.85,z+1.05),(.9,.65,.9),materials['naval']))
 for piece in pieces:attach(piece,pivot)
# Two stern tracks and six K-gun throwers. Release sockets are authoritative.
for launcher in definition['depthChargeLaunchers']:
 a,b,c=launcher['position'];x,y,z=-c,-a,b
 empty(launcher['id']+'.release',(x,y,z))
 if 'rack' in launcher['id']:
  for side in [-1,1]:
   box(launcher['id']+'.rail',(x+2.25,y+side*.55,z-.2),(5.2,.09,.13),materials['edge'])
   for dx in [0,1.6,3.2,4.8]:rod(launcher['id']+'.leg',(x+dx,y+side*.55,deckz(x)),(x+dx,y+side*.55,z+.3),.045,materials['naval'])
  for dx in [.4,1.35,2.3,3.25,4.2]:
   rod(launcher['id']+'.charge',(x+dx,y-.36,z+.12),(x+dx,y+.36,z+.12),.23,materials['naval'],vertices=20)
 else:
  side=1 if y>0 else -1
  cyl(launcher['id']+'.base',(x,y,deckz(x)+.12),.3,.24,materials['edge'])
  rod(launcher['id']+'.projector',(x,y,deckz(x)+.2),(x,y+side*.33,z+.2),.12,materials['naval'])
  rod(launcher['id']+'.charge',(x-.36,y,z+.25),(x+.36,y,z+.25),.23,materials['naval'],vertices=20)
# Low railings preserve the sheer. Bow anchors, chain, mooring gear and fittings.
for side in [-1,1]:
 previous=None
 for i in range(57):
  x=-56+i*2;y=side*max(0,width(x)-.14);z=deckz(x)
  rod('rails.stanchion',(x,y,z),(x,y,z+.88),.025,materials['edge'])
  if previous:
   for height in [.45,.87]:rod('rails.wire',(previous[0],previous[1],previous[2]+height),(x,y,z+height),.016,materials['edge'])
  previous=(x,y,z)
 for x in [49,52,-50,-46,32]:
  yy=side*width(x)*.68;box('deck.bollard-base',(x,yy,deckz(x)+.05),(.9,.45,.1),materials['edge'])
  for dx in [-.25,.25]:cyl('deck.bollard',(x+dx,yy,deckz(x)+.27),.10,.44,materials['naval'])
 rod('anchor.chain',(51,side*.8,deckz(51)+.04),(54.5,side*1.1,deckz(54.5)+.04),.08,materials['edge'])
 rod('anchor.stock',(51.5,side*width(51.5),2.5),(52.1,side*width(51.5),3.45),.08,materials['edge'])
 rod('anchor.flukes',(51.2,side*width(51.5),2.75),(52,side*width(51.5),2.35),.085,materials['edge'])
 # Whaleboats carried alongside the forward funnel.
 boat=cyl('boats.hull',(4,side*4.3,4.05),1,1,materials['canvas'],vertices=24);boat.scale=(3,.72,.6)
 box('boats.interior',(4,side*4.3,4.47),(4.7,.82,.09),materials['dark'])
 for x in [1.8,6.2]:rod('boats.davit',(x,side*4,3),(x,side*4,6),.065,materials['edge']);rod('boats.davit-arm',(x,side*4,6),(x,side*4.7,6),.065,materials['edge'])
 for x in [-16,12,28]:
  for dx in range(3):cyl('deck.vent',(x+dx*.48,side*3.1,deckz(x)+.37),.15,.65,materials['naval'])
for x in [-14,-9,0,35,46]:box('deck.hatch',(x,0,deckz(x)+.09),(1.1,.75,.16),materials['naval'])
# Raised after AA platform and ready-service lockers.
box('aa-platform.deck',(-27,0,7.2),(4.1,4.2,.2),materials['roof'])
for y in [-1.8,1.8]:rod('aa-platform.support',(-27,y,5.6),(-27,y,7.1),.08,materials['edge'])
for x in [-29,-25]:box('aa-platform.ammunition', (x,0,5.95),(.65,1.8,.7),materials['naval'])
# Twin screws and rudder retain their independent pivot sockets.
for side in [-1,1]:
 label='port' if side>0 else 'starboard';y=side*1.9
 rod('shafts.'+label,(-32,y,-2.2),(-49,y,-2.5),.13,materials['edge'])
 pivot=empty('propeller-'+label+'.pivot',(-49,y,-2.5));attach(rod('propeller-'+label+'.hub',(-48.4,y,-2.5),(-49.6,y,-2.5),.25,materials['bronze'],r2=.08),pivot)
 for i in range(3):
  a=i*math.tau/3
  points=[(-49,y+math.cos(a+d)*r,-2.5+math.sin(a+d)*r) for r,d in [(.18,-.2),(1.25,-.08),(1.36,.3),(.45,.75)]]
  attach(mesh('propeller-'+label+'.blade',points,[(0,1,2,3)],materials['bronze']),pivot)
rudder=empty('rudder.pivot',(-53,0,-1.9));attach(box('rudder.blade',(-53.2,0,-2.05),(2.6,.18,2.7),materials['underwater']),rudder)
for mount in definition['mounts']:create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
scene['definitionHash']=definition['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))

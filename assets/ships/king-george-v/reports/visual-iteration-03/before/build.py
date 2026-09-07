"""Original HMS King George V, early 1941. Blueprint-driven local Blender recipe.
Primitive mesh helpers adapted from this project's independently authored Baltimore.
All lasting geometry lives here or in the component catalog; reference art is not read.
"""
import bpy
import bmesh
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
OUT=Path(os.environ['SHIP_OUTPUT'])
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world=bpy.data.worlds.new('King George V studio');scene.world.color=(.08,.1,.12)
collections={}
for name in ['Hull and decks','Batteries','Superstructure','Sensors and masts','Aircraft handling','Light AA','Deck fittings','Underwater fittings','Simulation volumes']:
 col=bpy.data.collections.new(name);scene.collection.children.link(col);collections[name]=col
COL=collections['Hull and decks'];ASSEMBLY='hull'
colors={'naval':(.32,.345,.35,1),'hullgray':(.245,.275,.29,1),'roof':(.20,.23,.24,1),'edge':(.115,.135,.145,1),'canvas':(.36,.37,.34,1),'dark':(.013,.019,.022,1),'deck':(.42,.32,.20,1),'antifouling':(.24,.054,.035,1),'boot':(.025,.032,.034,1),'bronze':(.39,.29,.10,1),'glass':(.028,.072,.084,1),'white':(.71,.73,.7,1),'red':(.37,.04,.04,1),'blue':(.03,.07,.17,1),'aircraft':(.22,.29,.28,1)}
materials={}
for key,color in colors.items():
 m=bpy.data.materials.new('KGV '+key);m.diffuse_color=color;m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.76;p.inputs['Metallic'].default_value=.08
 materials[key]=m
teak=materials['deck'];teak.name='Teak decking · KGV original'
nodes=teak.node_tree.nodes;links=teak.node_tree.links;brick=nodes.new('ShaderNodeTexBrick');coord=nodes.new('ShaderNodeNewGeometry')
brick.inputs['Color1'].default_value=(.35,.27,.16,1);brick.inputs['Color2'].default_value=(.47,.37,.23,1);brick.inputs['Mortar'].default_value=(.13,.12,.10,1)
brick.inputs['Scale'].default_value=1;brick.inputs['Mortar Size'].default_value=.003;brick.inputs['Brick Width'].default_value=3.4;brick.inputs['Row Height'].default_value=.16
brick.offset=.5;brick.offset_frequency=2;links.new(coord.outputs['Position'],brick.inputs['Vector']);links.new(brick.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
def mesh(name,vertices,faces,material=None,col=None,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
 ob=bpy.data.objects.new(name,data);(col or COL).objects.link(ob);ob['assemblyId']=ASSEMBLY
 if isinstance(material,str):material=materials[material]
 if material: data.materials.append(material)
 for poly in data.polygons:poly.use_smooth=smooth
 return ob

def box(name,loc,dim,material='naval',col=None,bev=0):
 dx,dy,dz=[v/2 for v in dim]
 vertices=[(sx*dx,sy*dy,sz*dz) for sx,sy,sz in [(-1,-1,-1),(-1,1,-1),(1,1,-1),(1,-1,-1),(-1,-1,1),(-1,1,1),(1,1,1),(1,-1,1)]]
 ob=mesh(name,vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,col);ob.location=loc
 return ob

def cyl(name,loc,radius,depth,material='naval',col=None,vertices=24,r2=None):
 r2=radius if r2 is None else r2;depth=max(.002,depth)
 vv=[(r*math.cos(2*math.pi*i/vertices),r*math.sin(2*math.pi*i/vertices),z) for r,z in [(radius,-depth/2),(r2,depth/2)] for i in range(vertices)]
 ff=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
 ob=mesh(name,vv,ff,material,col,True);ob.location=loc
 ob.data.polygons[0].use_smooth=False;ob.data.polygons[1].use_smooth=False
 return ob

def rod(name,a,b,r,material='edge',col=None,r2=None,vertices=10):
 a,b=Vector(a),Vector(b);ob=cyl(name,(a+b)/2,r,(b-a).length,material,col,vertices,r2)
 ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return ob

def ellipse(name,x,y,z,rx,ry,height,material='naval',lean=0,n=32):
 vv=[(x+shift+rx*math.cos(2*math.pi*i/n),y+ry*math.sin(2*math.pi*i/n),zz) for shift,zz in [(0,z),(lean,z+height)] for i in range(n)]
 ff=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 ob=mesh(name,vv,ff,material,smooth=True)
 for p in list(ob.data.polygons)[:2]:p.use_smooth=False
 return ob

def prism(name,outline,base,height,material='naval'):
 if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outline,outline[1:]+outline[:1]))<0:outline=list(reversed(outline))
 n=len(outline);vv=[(x,y,z) for z in [base,base+height] for x,y in outline]
 return mesh(name,vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material)

def perimeter_wall(name,outline,z,height=.88,thickness=.055):
 # Thin independent splinter plates leave the actual platform surface visible.
 for i,(a,b) in enumerate(zip(outline,outline[1:]+outline[:1])):
  ax,ay=a;bx,by=b;length=math.hypot(bx-ax,by-ay)
  if length<.02:continue
  ob=box(name+' plate '+str(i),((ax+bx)/2,(ay+by)/2,z+height/2),(length,thickness,height),'naval')
  ob.rotation_euler.z=math.atan2(by-ay,bx-ax)
  rod(name+' top rail',(ax,ay,z+height),(bx,by,z+height),.027,'edge',vertices=6)

def interp(points,s):
 for (a,va),(b,vb) in zip(points,points[1:]):
  if a<=s<=b:return va+(vb-va)*(s-a)/(b-a)
 return points[0][1] if s<points[0][0] else points[-1][1]

H=D['hull'];L=H['length'];DECK=H['depth']-H['draft']
deckz=lambda x:interp(H['deckHeights'],max(0,min(L,x+L/2)))
width=lambda x:interp(H['halfBreadths'],max(0,min(L,x+L/2)))
def sidewidth(x,z):
 station=max(0,min(L,x+L/2));ss=H['sections']
 for aa,bb in zip(ss,ss[1:]):
  if aa['station']<=station<=bb['station']:
   t=(station-aa['station'])/(bb['station']-aa['station']);ps=[(a+(b[0]-a)*t,c+(b[1]-c)*t) for (a,c),b in zip(aa['points'],bb['points'])]
   for (w0,z0),(w1,z1) in zip(ps,ps[1:]):
    if z0<=z<=z1:return w0+(w1-w0)*(z-z0)/max(.00001,z1-z0)
   return ps[-1][0] if z>ps[-1][1] else ps[0][0]
 return 0
vv=[];ff=[];n=len(H['sections'][0]['points']);ring=2*n
for section in H['sections']:
 x=section['station']-L/2;pts=section['points']
 vv.extend([(x,-y,z) for y,z in pts]+[(x,y,z) for y,z in reversed(pts)])
for i in range(len(H['sections'])-1):
 for j in range(ring):ff.append((i*ring+j,(i+1)*ring+j,(i+1)*ring+(j+1)%ring,i*ring+(j+1)%ring))
ff.extend([tuple(reversed(range(ring))),tuple((len(H['sections'])-1)*ring+j for j in range(ring))])
hull=mesh('KGV original section hull',vv,ff,None,smooth=True);hull['nodeId']='hull.surface'
for key in ['hullgray','antifouling','boot','deck']:hull.data.materials.append(materials[key])
for p in hull.data.polygons:
 zs=[vv[i][2] for i in p.vertices]
 if len(p.vertices)==4 and all(i%ring in [n-1,n] for i in p.vertices):p.material_index=3;p.use_smooth=False
 elif max(zs)<=-1.099:p.material_index=1
 elif max(zs)<=.001:p.material_index=2
 else:p.material_index=0

bm=bmesh.new();bm.from_mesh(hull.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.00000001)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(hull.data);bm.free()

def pivot(id,loc):
 ob=bpy.data.objects.new(id,None);COL.objects.link(ob);ob.location=loc;ob['nodeId']=id;ob['assemblyId']=ASSEMBLY
 return ob
def attach_world(objects,parent):
 bpy.context.view_layer.update()
 for ob in objects:
  world=ob.matrix_world.copy();ob.parent=parent;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_world=world
 bpy.context.view_layer.update()
def rail(name,points,height=1.05):
 for i,(a,b) in enumerate(zip(points,points[1:])):
  a,b=Vector(a),Vector(b);length=(b-a).length
  for h in [.34,.68,height]:rod(name+' wire',a+Vector((0,0,h)),b+Vector((0,0,h)),.019,'edge',vertices=5)
  for j in range(max(1,math.ceil(length/2.5))):
   p=a+(b-a)*(j/max(1,math.ceil(length/2.5)));rod(name+' stanchion',p,p+Vector((0,0,height)),.028,'naval',vertices=6)

# Small reusable original fabrication details, all dimensions in metres.
def octagon(x,y,l,w,c=.25):
 return [(x-l/2,y-w/2+c),(x-l/2+c,y-w/2),(x+l/2-c,y-w/2),(x+l/2,y-w/2+c),(x+l/2,y+w/2-c),(x+l/2-c,y+w/2),(x-l/2+c,y+w/2),(x-l/2,y+w/2-c)]
def tube(name,points,r=.045,material='naval',vertices=8):
 for a,b in zip(points,points[1:]):rod(name,a,b,r,material,vertices=vertices)
def hoop(name,center,rx,ry,tubeR,material='naval',n=32,k=6):
 x,y,z=center;vs=[]
 for i in range(n):
  a=math.tau*i/n
  for j in range(k):
   b=math.tau*j/k;vs.append((x+(rx+tubeR*math.cos(b))*math.cos(a),y+(ry+tubeR*math.cos(b))*math.sin(a),z+tubeR*math.sin(b)))
 return mesh(name,vs,[(i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k) for i in range(n) for j in range(k)],material,smooth=True)
def ladder(name,a,b,w=.68,steps=None):
 a,b=Vector(a),Vector(b);n=steps or max(3,round((b-a).length/.28));across=Vector((0,w/2,0))
 for side in [-1,1]:
  rod(name+' stile',a+across*side,b+across*side,.038,'naval',vertices=6)
  if abs(a.x-b.x)>.5:rod(name+' handrail',a+across*side+Vector((0,0,.8)),b+across*side+Vector((0,0,.8)),.025,'naval',vertices=6)
 for i in range(n+1):
  pos=a.lerp(b,i/n);rod(name+' tread',pos-across,pos+across,.034,'edge',vertices=6)
def door(name,x,y,z,angle=0):
 before=set(scene.objects)
 ob=box(name+' frame',(x,y,z+.87),(.92,.10,1.78),'edge');ob.rotation_euler.z=angle
 ob=prism(name+' watertight leaf',octagon(0,0,.78,1.63,.18),0,.085,'naval')
 ob.rotation_euler=(math.pi/2,0,angle);ob.location=(x,y-.065,z+.87)
 # Hinge and dogs are on the outward-facing side of this local door.
 for h in [.27,.86,1.45]:
  ob=box(name+' dog',(x+.36,y-.125,z+h),(.15,.07,.055),'edge');ob.rotation_euler.z=angle
 return set(scene.objects)-before
def vent(name,x,y,z,w=1.0,h=.65):
 box(name+' box',(x,y,z),(w,.22,h),'naval');box(name+' recess',(x,y-.12,z),(w*.84,.018,h*.82),'dark')
 for i in range(max(3,round(h/.12))):box(name+' louvre',(x,y-.155,z-h*.36+i*.12),(w*.84,.08,.045),'naval')
def life_raft(name,x,y,z,vertical=False):
 before=set(scene.objects)
 hoop(name+' cork float',(0,0,0),1.05,.61,.19,'canvas',n=28,k=8)
 for xx in [-.7,-.35,0,.35,.7]:box(name+' grating',(xx,0,-.08),(.06,.91,.07),'deck')
 for yy in [-.3,0,.3]:box(name+' grating',(0,yy,-.08),(1.65,.06,.07),'deck')
 for a in range(8):
  t=math.tau*a/8;rod(name+' web strap',(1.02*math.cos(t),.59*math.sin(t),-.22),(1.02*math.cos(t),.59*math.sin(t),.22),.035,'edge',vertices=6)
 node=bpy.data.objects.new(name+' placement',None);COL.objects.link(node);node.location=(x,y,z)
 if vertical:node.rotation_euler.x=math.pi/2
 for ob in set(scene.objects)-before-{node}:ob.parent=node

def gallery(name,outline,z,wall=.95):
 prism(name+' deck',outline,z,.13,'roof');perimeter_wall(name+' bulwark',outline,z+.13,wall,.055)
 for x,y in outline:
  if abs(y)>4:mesh(name+' support bracket',[(x,y,z),(x,y*.73,z),(x,y*.73,z-1.1)],[(0,1,2)],'naval')

def gun_rod(name,a,b,r,material='edge',col=None,r2=None,vertices=10):
 # British gun slides were exposed; the generic helper's canvas bag is a
 # metal slide/jacket here, as seen in IWM A3655. The common joints stay intact.
 if 'canvas mantlet' in name:material=materials['edge'];name=name.replace('canvas mantlet','gun slide')
 return rod(name,a,b,r,material,col,r2,vertices)
COL=collections['Batteries']
for mount in D['mounts']:
 ASSEMBLY=mount['id'];spec=mount['weapon'];main=mount['battery']=='main'
 gunhouse=create_gun_mount(mount,COL,dict(mesh=mesh,cyl=cyl,rod=gun_rod,box=box),materials,deckz)
 if not main:
  # Render each fabricated wall panel with one normal, while the catalog
  # keeps triangulated collision faces and the independently authored roof.
  shape=spec['gunhouseMesh'];fc=[];mat=[];skip=set()
  for i,f in enumerate(shape['faces']):
   if i in skip:continue
   if f['id'].startswith('wall-') and f['id'].endswith('-a'):
    g=shape['faces'][i+1];fc.append(f['indices']+[g['indices'][-1]]);skip.add(i+1)
   else:fc.append(f['indices'])
   mat.append(1 if f['finish']=='roof' else 0)
  data=bpy.data.meshes.new('Mk I fabricated wall panels');data.from_pydata([(a,b,mount['position'][1]+c) for a,b,c in shape['vertices']],[],fc);data.update()
  data.materials.append(materials['naval']);data.materials.append(materials['roof'])
  for poly,m in zip(data.polygons,mat):poly.material_index=m
  old=gunhouse.data;gunhouse.data=data;bpy.data.meshes.remove(old)
 if main:
  # Recessed gunports are render detail on the catalog's closed armor envelope.
  # The CPU enclosure intentionally retains its simplified complete face plate.
  shape=spec['gunhouseMesh'];base=mount['position'][1]
  vv=[(a,b,base+c) for a,b,c in shape['vertices']]
  kept=[f for f in shape['faces'] if f['id'] not in ['wall-0-3-a','wall-0-3-b','wall-1-3-a','wall-1-3-b']]
  ff=[f['indices'] for f in kept];mi=[1 if f['finish']=='roof' else 0 for f in kept]
  front=5.6 if spec['barrelCount']==4 else 4.55;topfront=4.85 if spec['barrelCount']==4 else 3.85;edge=5.48 if spec['barrelCount']==4 else 4.32
  def face_x(z):return front+(topfront-front)*(z-.25)/3.45
  def patch(ys,zs,inset=0,material=0):
   idx=len(vv);vv.extend([(face_x(z)-inset,y,base+z) for y,z in zip(ys,zs)]);ff.append(list(range(idx,idx+len(ys))));mi.append(material)
  def panel(y0,y1,z0,z1):patch([y0,y1,y1,y0],[z0,z0,z1,z1])
  axes=[(i-(spec['barrelCount']-1)/2)*spec['barrelSpacing'] for i in range(spec['barrelCount'])];last=-edge
  for gy in axes:
   panel(last,gy-.75,.25,3.7);last=gy+.75
   panel(gy-.75,gy+.75,.25,.72);panel(gy-.75,gy+.75,3.63,3.7)
   ys=[gy-.75,gy+.75,gy+.75,gy-.75];zs=[.72,.72,3.63,3.63];idx=len(vv)
   vv.extend([(face_x(z)-inset,y,base+z) for inset in [0,.90] for y,z in zip(ys,zs)])
   for k in range(4):ff.append([idx+k,idx+(k+1)%4,idx+4+(k+1)%4,idx+4+k]);mi.append(0)
   ff.append([idx+4,idx+5,idx+6,idx+7]);mi.append(2)
  panel(last,edge,.25,3.7)
  data=bpy.data.meshes.new('Original 14-inch face with recessed ports');data.from_pydata(vv,[],ff);data.update()
  for key in ['naval','roof','dark']:data.materials.append(materials[key])
  for poly,material in zip(data.polygons,mi):poly.material_index=material
  old=gunhouse.data;gunhouse.data=data;bpy.data.meshes.remove(old)
 yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
 before=set(scene.objects);Hh=spec['gunhouseSize'][2];W=spec['gunhouseSize'][1]
 if main:
  quad=spec['barrelCount']==4;front=5.6 if quad else 4.55;topfront=4.85 if quad else 3.85
  for i in range(spec['barrelCount']):
   gy=((spec['barrelCount']-1)/2-i)*spec['barrelSpacing'];r=.76
   # Recessed elevation slot silhouette, matching the sloping face. Barrels
   # and their moving slide conceal the lower center of each dark opening.
   # Dark backing is 0.9 m inside the real catalog face apertures.
   box('Gunport interior shadow',(front-1.40,gy,2.13),(.025,1.40,2.92),'dark')
  # Narrow welded/bolted roof joints and sheet lips, at human fitting scale.
  for x in [-4.7,-1.4,1.8]:rod('Gunhouse roof joint',(x,-W*.43,Hh+.014),(x,W*.43,Hh+.014),.014,'edge',vertices=5)
  for side in [-1,1]:
   ob=prism('Rangefinder faceted end hood',octagon(-3.9 if quad else -2.8,side*(spec['rangefinderWidth']/2+.08),1.68,1.05,.22),Hh-1.47,1.25)
   box('Optical end window',(-3.13 if quad else -2.03,side*(spec['rangefinderWidth']/2+.08),Hh-.81),(.02,.47,.45),'glass')
   ladder('Gunhouse access',(-5.6 if quad else -4.65,side*2.3,.36),(-5.6 if quad else -4.65,side*2.3,Hh+.06),w=.54)
   for x in [-1.4,2.0]:
    prism('Gunlayer periscope',octagon(x,side*(W*.36),.65,.55,.08),Hh,.36)
    box('Periscope glass',(x+.331,side*(W*.36),Hh+.18),(.02,.33,.17),'glass')
   for x in [-4.5,-2.0,.5,3]:box('Roof edge fastening',(x,side*(W*.445),Hh+.03),(.11,.11,.075),'edge')
 else:
  # Armoured cheeks either side of the gun cradles; Mk I high rear hood.
  for side in [-1,1]:
   prism('5.25-inch raised cheek',[(1.0,side*1.48),(2.35,side*1.48),(2.35,side*2.10),(1,side*2.15)],1.40,.72)
   box('Secondary optical slit',(2.365,side*1.80,2.32),(.02,.27,.22),'glass')
   ladder('Secondary rear ladder',(-2.77,side*.89,.25),(-2.77,side*.89,2.72),w=.40)
   box('Ventilation cheek',(-1.6,side*2.21,2.3),(.9,.16,.65),'naval')
  cyl('Secondary escape hatch',(-1.20,0,3.08),.37,.10,'naval',vertices=24)
  hoop('Hatch rim',(-1.20,0,3.12),.37,.37,.026,'edge',n=24,k=5)
  for yy in [-.85,.85]:box('Secondary rear access',(-2.805,yy,1.20),(.05,.72,1.27),'roof')
  for yy in [-.48,.48]:
   box('5.25-inch elevation slot',(2.73,yy,1.72),(.015,.56,1.30),'dark')
 for ob in set(scene.objects)-before:ob.parent=yaw
 # Mounting aprons, railings and ladders stay fixed on the elevated platforms.
 if not main:
  x,y,z=-mount['position'][2],-mount['position'][0],mount['position'][1]
  cyl('Secondary platform apron',(x,y,z-.02),3.28,.15,'roof',vertices=48)
  pts=[(x+3.19*math.cos(a*math.tau/40),y+3.19*math.sin(a*math.tau/40),z+.05) for a in range(41)]
  rail('Secondary platform',pts,.85)
  if z>DECK+1:
   cyl('Raised secondary support',(x,y,(z+DECK)/2),2.87,z-DECK,'naval',vertices=48)
   ladder('Secondary access',(x+5,y,DECK+.12),(x+2.7,y,z+.15))

COL=collections['Superstructure']
for structure in D['structures']:
 ASSEMBLY=structure['id'];outline=[(-z,-x) for x,z in structure['footprint']];z=structure['baseY'];top=z+structure['height']
 if 'funnel' in structure['id']:continue
 if structure['id']=='compass-shelter':
  cx=sum(p[0] for p in outline)/len(outline);n=len(outline);roof=[(cx+(a-cx)*.85,b*.88) for a,b in outline]
  vs=[(a,b,z) for a,b in outline]+[(a,b,top) for a,b in roof]
  mesh('Sloping compass shelter',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'naval')
 else:prism(structure['name'],outline,z,structure['height'],structure['material'])
 prism('Deck edge plate',outline,top,.07,'roof')
 if structure['id'] in ['tower-base','tower-middle']:
  perimeter_wall(structure['name']+' parapet',outline,top,.87)
 if structure['height']<.8:continue
 for a,b in zip(outline,outline[1:]+outline[:1]):
  ax,ay=a;bx,by=b;length=math.hypot(bx-ax,by-ay);nx=(by-ay)/length;ny=-(bx-ax)/length
  glazing=structure['id'] in ['tower-upper-bridge','compass-shelter']
  count=max(1,int(length/(.68 if glazing else 2.9)))
  for k in range(count):
   t=(k+.5)/count;px=ax+(bx-ax)*t+nx*.014;py=ay+(by-ay)*t+ny*.014
   if glazing or structure['id']=='tower-admirals':
    h=1.30 if glazing and structure['height']>1 else .47;ww=length/count*.77
    ob=box('Bridge glazed pane',(px,py,top-h/2-.18),(ww,.025,h),'glass');ob.rotation_euler.z=math.atan2(by-ay,bx-ax)
    if glazing:
     rod('Bridge mullion',(ax+(bx-ax)*k/count,ay+(by-ay)*k/count,z+.14),(ax+(bx-ax)*k/count,ay+(by-ay)*k/count,top),.026,'naval',vertices=6)
   elif structure['id'] not in ['hacs-forward-tower','director-aft-base']:
    zz=top-.90
    rod('Scuttle rim',(px,py,zz),(px+nx*.06,py+ny*.06,zz),.16,'edge',vertices=14)
    rod('Scuttle glass',(px+nx*.062,py+ny*.062,zz),(px+nx*.073,py+ny*.073,zz),.115,'glass',vertices=14)
    # Eyebrow to divert water above the circular scuttle.
    rod('Scuttle eyebrow',(px-.17*(bx-ax)/length+nx*.07,py-.17*(by-ay)/length+ny*.07,zz+.17),(px+.17*(bx-ax)/length+nx*.07,py+.17*(by-ay)/length+ny*.07,zz+.17),.02,'naval',vertices=6)

# KGV's distinct projecting bridge wings and recessed open working galleries.
ASSEMBLY='bridge-galleries'
for side in [-1,1]:
 gallery('Signal wing',[(13,side*4.5),(16,side*7.8),(24.2,side*7.8),(27,side*5.8),(23,side*4.5)],DECK+9.24,.95)
 gallery('Lower bridge wing',[(17,side*3.1),(18,side*6.0),(24.3,side*6.0),(28.1,side*3.2)],DECK+12.27,.9)
 gallery('Navigation wing',[(17.0,side*2.65),(17,side*5.6),(24.5,side*5.6),(25.5,side*3.7)],DECK+15.18,.90)
 # Independent optical lookouts on the wing decks.
 for x,z in [(20.3,DECK+10.3),(23,DECK+13.3),(21,DECK+16.3)]:
  cyl('Lookout pedestal',(x,side*5.15,z-.28),.13,.8,'naval',vertices=10)
  for dy in [-.16,.16]:rod('Binocular telescope',(x-.25,side*5.15+dy,z+.2),(x+.40,side*5.15+dy,z+.2),.095,'edge',vertices=10)
 for x,z in [(13.1,DECK+9.15),(20,DECK+12.2)]:
  gallery('Director observation tub',[(x+1.15*math.cos(a*math.tau/20),side*6.25+1.15*math.sin(a*math.tau/20)) for a in range(20)],z,.9)
 # Companionway from weather deck to shelter and signal bridge.
 ladder('Long shelter stair',(25,side*8.3,DECK+.15),(20.8,side*8.3,DECK+3.22))
 ladder('Signal stair',(13.5,side*8.17,DECK+3.25),(17.7,side*8.17,DECK+6.23))
 ladder('Bridge stair',(18,side*5.5,DECK+9.22),(21.6,side*5.5,DECK+12.33))
 for x,z in [(26.7,DECK+.2),(20,DECK+3.25),(26.3,DECK+6.28)]:
  before=set(scene.objects);door('Bridge watertight door',x,-8.24,z)
  if side==1:
   for ob in set(scene.objects)-before:ob.location.y=-ob.location.y;ob.scale.y=-1
 for x,z in [(17,DECK+1.2),(27,DECK+1.2),(21,DECK+4.5),(15,DECK+7.1)]:
  before=set(scene.objects);vent('Bridge intake',x,-8.26,z,1.2,.8)
  if side==1:
   for ob in set(scene.objects)-before:ob.location.y=-ob.location.y;ob.scale.y=-1
 for x,z in [(21,DECK+1.45),(25,DECK+4.4),(18,DECK+7.2)]:life_raft('Bridge Carley float',x,side*8.42,z,True)
 for x in [15.2,23.7,27.8]:
  tube('Bridge downpipe',[(x,side*7.94,DECK+.3),(x,side*7.94,DECK+5.8),(x-.3,side*7.94,DECK+6.1)],.045)
 # Slender vertical strengthening and level seams, not giant external ribs.
 for x in [16,19,22,25]:rod('Shelter seam',(x,side*8.217,DECK+.1),(x,side*8.217,DECK+2.98),.012,'edge',vertices=5)

ASSEMBLY='bridge-instruments'
for side in [-1,1]:
 for x,z in [(13.1,DECK+9.15),(20,DECK+12.2)]:
  y=side*6.25
  cyl('Pom-pom director pedestal',(x,y,z+.48),.23,.8,'naval',vertices=12)
  box('Pom-pom director optical body',(x,y,z+1.05),(.62,.65,.36),'naval')
  for dy in [-.35,.35]:rod('Director binocular',(x-.1,y+dy,z+1.15),(x+.48,y+dy,z+1.15),.10,'edge',vertices=10)
  rod('Director sight rail',(x+.15,y,z+.65),(x+.15,y,z+1.55),.035,'naval',vertices=6)
 for x,z in [(15.7,DECK+11.0),(17.8,DECK+14.1),(23,DECK+11.0)]:
  box('Bridge signal equipment',(x,side*4.3,z),(.46,.26,.6),'naval')
 for x,z in [(18,DECK+6.15),(24,DECK+9.15)]:
  for k in range(5):box('Signal flag locker',(x+k*.3,side*6.5,z+.32),(.27,.58,.55),'canvas')
 # Navigation-bridge external catwalk and the slender awning supports.
 pts=[(31.25,side*3.0,DECK+15.1),(30.95,side*3.95,DECK+15.1),(26.2,side*3.95,DECK+15.1)]
 rail('Navigation catwalk rail',pts,.83)
 for x in [26.2,28.5,30.95]:
  rod('Bridge awning support',(x,side*3.99,DECK+15.1),(x,side*3.99,DECK+17.05),.032,'naval',vertices=6)
for z in [DECK+17.1,DECK+19.2]:
 outline=octagon(15.1,0,3.7,3.8,.42);prism('HACS service deck',outline,z,.11,'roof')
 rail('HACS service rail',[(x,y,z+.11) for x,y in outline+[outline[0]]],.85)
ladder('HACS tower external ladder',(16.56,0,DECK+9.3),(16.56,0,DECK+21.15),w=.52)
for z in [DECK+12.4,DECK+15,DECK+18.5]:
 rod('HACS tower scuttle',(16.55,-.6,z),(16.58,-.6,z),.18,'edge',vertices=14)
 rod('HACS tower scuttle glass',(16.585,-.6,z),(16.60,-.6,z),.12,'glass',vertices=14)
# Open aft-facing hangar mouths. Doors are split with an inset dark cavity.
ASSEMBLY='hangar-doors'
for side in [-1,1]:
 box('Hangar doorway',(-4.035,side*4.4,DECK+3.4),(.02,6.0,5.25),'dark')
 for y in [side*1.40,side*7.35]:box('Hangar portal jamb',(-4.10,y,DECK+3.4),(.20,.14,5.35),'naval')
 box('Hangar lintel',(-4.1,side*4.4,DECK+6.03),(.2,6.1,.2),'naval')
 for j in range(5):box('Folded hangar door',(-4.18,side*(6.6+j*.14),DECK+3.35),(.1,.10,4.9),'roof')
 # Repeated aircraft rails pass into the hangar at deck level.
 for yy in [side*2.8,side*5.8]:rod('Aircraft handling deck track',(-12,yy,DECK+.08),(-3.9,yy,DECK+.08),.04,'edge',vertices=6)

# Funnel jackets with open rim, internal uptake and arched cap grating.
COL=collections['Superstructure']
for id,x in [('forward-funnel',.8),('after-funnel',-23.4)]:
 ASSEMBLY=id;z=DECK+5.6;top=DECK+18.;rx=3.48;ry=2.75;n=56
 vv=[]
 for zz,rrx,rry in [(z,rx,ry),(top,rx,ry),(top,rx-.20,ry-.20),(top-1.8,rx-.20,ry-.20)]:
  vv.extend([(x+rrx*math.cos(i*math.tau/n),rry*math.sin(i*math.tau/n),zz) for i in range(n)])
 ff=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
 funnel=mesh('Open oval funnel jacket',vv,ff,'naval',smooth=True)
 ellipse('Soot inside funnel',x,0,top-1.75,rx-.22,ry-.22,.03,'dark',n=48)
 for zz in [z+4.0,top-.35]:hoop('Funnel circumferential band',(x,0,zz),rx+.025,ry+.025,.055,'naval',n=48)
 hoop('Rolled funnel mouth',(x,0,top),rx,ry,.14,'roof',n=56,k=8)
 for xx in [-2,-1,0,1,2]:
  half=ry*math.sqrt(1-(xx/rx)**2);tube('Funnel cap lattice',[(x+xx,-half,top+.03),(x+xx,-half*.55,top+.48),(x+xx,0,top+.60),(x+xx,half*.55,top+.48),(x+xx,half,top+.03)],.042,'edge')
 tube('Funnel cap spine',[(x-rx,0,top),(x-rx*.5,0,top+.55),(x+rx*.5,0,top+.55),(x+rx,0,top)],.055,'edge')
 for side in [-1,1]:
  for dx in [-1.8,-.55,.7]:
   tube('Funnel steam pipe',[(x+dx,side*2.69,z+.1),(x+dx,side*2.79,top-1.45),(x+dx-.23,side*2.8,top-1.07),(x+dx-.58,side*2.8,top-1.0)],.085,'naval',vertices=10)
  # Shape of the pipe and its flared steam whistle is visible against the sea.
  tube('Steam whistle',[(x+2.4,side*1.9,z+1),(x+2.4,side*1.9,z+8.2),(x+2.1,side*1.9,z+8.55),(x+1.80,side*1.9,z+8.6)],.12)
 ladder('Funnel maintenance ladder',(x-3.51,0,z+.2),(x-3.51,0,top+.06),w=.56)
 for zz in [z+2,z+4,z+6,z+8,z+10]:
  # Brackets attach to the funnel instead of floating level lines.
  for yy in [-.28,.28]:rod('Ladder bracket',(x-3.45,yy,zz),(x-3.65,yy,zz),.025,'edge',vertices=6)
 # Searchlight galleries sit about halfway up the visible stack.
 platform=[(x+3.7*math.cos(a*math.tau/40),3.08*math.sin(a*math.tau/40)) for a in range(40)]
 prism('Funnel searchlight walk',platform,DECK+12.0,.14,'roof')
 rail('Funnel gallery rail',[(a,b,DECK+12.14) for a,b in platform+[platform[0]]],.95)

COL=collections['Sensors and masts']
def director(id,x,y,z,main=False):
 global ASSEMBLY
 ASSEMBLY=id;before=set(scene.objects)
 cyl('Director roller',(x,y,z+.25),1.38 if main else 1.0,.5,'edge',vertices=32)
 if main:
  shape=octagon(x,y,3.6,3.7,.45);prism('DCT lower cabinet',shape,z+.47,1.90)
  prism('DCT raised sight enclosure',octagon(x-.6,y,2.1,3.5,.32),z+2.37,1.0)
  box('DCT forward sight ports',(x+1.81,y,z+1.92),(.025,1.73,.45),'glass')
  span=4.5
  rod('DCT transverse optical tube',(x-.45,y-span,z+2.12),(x-.45,y+span,z+2.12),.23,'naval',vertices=20)
  for sign in [-1,1]:prism('DCT optical hood',octagon(x-.45,y+sign*span,1.15,.76,.16),z+1.70,.85)
  ladder('DCT access',(x-1.81,y,z+.35),(x-1.81,y,z+3.28),w=.51)
 else:
  # HACS Mk IV rotating high-angle director, curved rear and sloping nose.
  prism('HACS cabinet',octagon(x,y,2.7,2.2,.40),z+.45,1.45)
  for side in [-1,1]:
   rod('HACS optical tube',(x-.25,y+side*.95,z+1.70),(x-.25,y+side*2.0,z+1.70),.17,'naval',vertices=16)
   box('HACS rangefinder hood',(x-.25,y+side*2.05,z+1.70),(.72,.45,.65),'naval')
  # Curved director hood, built with an original bent plate cross section.
  arch=[(-1.27,1.30),(-1.17,2.09),(-.70,2.57),(.20,2.71),(.85,2.42),(1.31,1.69)]
  vv=[(x+dx,y+side*1.04,z+zz) for side in [-1,1] for dx,zz in arch]
  mesh('HACS curved roof',vv,[(i,i+1,i+7,i+6) for i in range(5)],'naval')
  box('HACS sight aperture',(x+1.33,y,z+1.73),(.025,1.48,.48),'dark')
  for side in [-1,1]:rod('HACS roof rib',(x-.98,y+side*.70,z+2.30),(x+.75,y+side*.70,z+2.48),.045,'edge',vertices=6)
 node=pivot(id+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)
 return node
director('dct-forward',22.3,0,DECK+16.35,True)
director('dct-after',-45,0,DECK+8.1,True)
for id,x,y,z in [('hacs-p-forward',15.1,2.35,DECK+21.2),('hacs-s-forward',15.1,-2.35,DECK+21.2),('hacs-p-after',-40,3.2,DECK+9.2),('hacs-s-after',-40,-3.2,DECK+9.2)]:director(id,x,y,z)
ASSEMBLY='hacs-platforms'
gallery('Forward HACS platform',octagon(15.1,0,4.4,9.0,.75),DECK+21.04,.48)
gallery('Aft HACS platform',octagon(-40,0,4.4,8.8,.65),DECK+9.05,.52)
# 1941 Type 284 mattress on the 14-inch DCT; no late Type 271 lantern.
ASSEMBLY='radar-284';before=set(scene.objects)
for side in [-1,1]:
 yy=side*2.10
 for dz in [-.52,.52]:rod('284 aerial frame',(24.4,yy-1.94,DECK+20.2+dz),(24.4,yy+1.94,DECK+20.2+dz),.045,'edge',vertices=6)
 for k in range(16):rod('284 vertical dipole',(24.4,yy-1.89+k*.25,DECK+19.72),(24.4,yy-1.89+k*.25,DECK+20.68),.022,'naval',vertices=6)
 for dz in [-.25,0,.25]:rod('284 aerial wire',(24.43,yy-1.89,DECK+20.2+dz),(24.43,yy+1.89,DECK+20.2+dz),.013,'edge',vertices=5)
 rod('284 supporting arm',(22.8,side*1.3,DECK+18.5),(24.4,side*2,DECK+20.2),.067,'naval',vertices=8)
node=pivot('radar-284.yaw',(22.3,0,DECK+19.2));attach_world(set(scene.objects)-before-{node},node)
for name,x,top,spread in [('foremast',9.4,36.8,3.3),('mainmast',-42.7,33.1,2.6)]:
 ASSEMBLY=name;base=DECK+3.05;platformZ=top-7.5
 rod(name+' lower pole',(x,0,base),(x-.70,0,platformZ),.30,'naval',r2=.20,vertices=16)
 rod(name+' upper pole',(x-.7,0,platformZ),(x-.9,0,top+1.0),.145,'naval',r2=.045,vertices=12)
 for side in [-1,1]:
  rod(name+' tripod',(x-4.0,side*spread,DECK+6.25),(x-.70,side*.42,platformZ),.22,'naval',r2=.13,vertices=12)
  for k in range(1,5):
   t=k/5;zz=DECK+6.25+(platformZ-DECK-6.25)*t;dy=spread*(1-t)+.42*t;dx=-4.0*(1-t)-.70*t
   rod('Tripod cross tie',(x+dx,-dy,zz),(x+dx,dy,zz),.055,'naval',vertices=8)
 gallery(name+' lookout platform',octagon(x-.8,0,3.1,5.0,.6),platformZ,.0)
 rail('Mast platform guard',[(a,b,platformZ+.13) for a,b in octagon(x-.8,0,3.1,5,.6)+[octagon(x-.8,0,3.1,5,.6)[0]]],.90)
 for side in [-1,1]:rod('Mast platform support',(x-.8,side*2.4,platformZ),(x-.2,side*.4,platformZ-1.75),.075,'naval',vertices=8)
 ladder('Mast vertical ladder',(x+.30,0,DECK+6.3),(x-.45,0,top-.1),w=.47)
 for zz,span in [(top-2,4.5),(platformZ+1.2,6.0)]:
  rod('Tapered signal yard',(x-.8,-span,zz),(x-.8,span,zz),.062,'naval',vertices=10)
  for side in [-1,1]:
   rod('Yard lift',(x-.8,side*span,zz),(x-.9,0,zz+2.0),.018,'edge',vertices=5)
   for k in range(1,6):rod('Signal halyard',(x-.8,side*k*span/6,zz),(x-1.4,side*2.5,DECK+7.2),.008,'edge',vertices=4)
 # Early paired Type 279 aerials at the masthead, matched to the period photo.
 for dz in [0,.85]:
  rod('Type 279 crossbar',(x-.9,-1.7,top+dz),(x-.9,1.7,top+dz),.045,'edge',vertices=6)
  for yy in [-1.5,-.75,0,.75,1.5]:rod('Type 279 dipole',(x-1.28,yy,top+dz),(x-.52,yy,top+dz),.025,'naval',vertices=6)
 for side in [-1,1]:rod('Mast standing rigging',(x-.8,side*.7,platformZ+.5),(x-7,side*7,DECK+6.3),.013,'edge',vertices=5)
ASSEMBLY='wireless-aerials'
for y in [-.36,.36]:rod('Between-mast wireless aerial',(8.5,y,35),(-43.6,y,31.5),.010,'edge',vertices=5)
for x in [.8,-23.4]:
 for side in [-1,1]:
  ASSEMBLY='searchlights';z=DECK+12.14;yy=side*4.0
  outline=[(x-1.4+1.35*math.cos(a*math.tau/24),yy+1.15*math.sin(a*math.tau/24)) for a in range(24)]
  gallery('Searchlight wing',outline,z,.85)
  cyl('Searchlight pedestal',(x-1.4,yy,z+.40),.22,.75,'naval',vertices=12)
  for dx in [-.55,.55]:rod('Searchlight yoke',(x-1.4+dx,yy,z+.55),(x-1.4+dx,yy,z+1.25),.08,'naval',vertices=8)
  rod('Searchlight casing',(x-1.4,yy-.45,z+1.3),(x-1.4,yy+.45,z+1.3),.54,'naval',vertices=28)
  rod('Searchlight silvered lens',(x-1.4,yy+side*.46,z+1.3),(x-1.4,yy+side*.475,z+1.3),.47,'glass',vertices=28)

COL=collections['Aircraft handling'];ASSEMBLY='catapult'
# Transverse double-ended catapult amidships; open working deck around it.
for x in [-11.4,-10.2]:
 rod('Catapult rail',(x,-15.4,DECK+1.6),(x,15.4,DECK+1.6),.11,'edge',vertices=8)
 rod('Catapult lower rail',(x,-15.0,DECK+.55),(x,15.0,DECK+.55),.09,'naval',vertices=8)
 for k in range(20):
  y=-15+k*1.5;rod('Catapult diagonal',(x,y,DECK+.55),(x,y+1.5,DECK+1.6),.045,'naval',vertices=6)
box('Catapult launch carriage',(-10.8,0,DECK+1.82),(2.2,2.8,.3),'edge')
for side in [-1,1]:
 ASSEMBLY='crane-'+('port' if side==1 else 'starboard');x=-18;y=side*7.7;z=DECK+5.8;before=set(scene.objects)
 cyl('Aircraft crane pedestal',(x,y,DECK+2.9),.66,5.8,'naval',vertices=20)
 boomA=Vector((x,y,z+2));boomB=Vector((4,side*7.7,z+4.1))
 for offset in [-.5,.5]:
  rod('Crane upper chord',boomA+Vector((0,offset,.7)),boomB+Vector((0,offset,.12)),.09,'naval',vertices=8)
  rod('Crane lower chord',boomA+Vector((0,offset,-.7)),boomB+Vector((0,offset,-.12)),.09,'naval',vertices=8)
  for k in range(12):
   t=k/12;u=(k+1)/12;p=boomA.lerp(boomB,t);q=boomA.lerp(boomB,u)
   rod('Crane lattice',p+Vector((0,offset,-.7*(1-t))),q+Vector((0,offset,.7*(1-u))),.04,'edge',vertices=6)
 rod('Crane hoist',boomB,boomB+Vector((0,0,-3)),.02,'edge',vertices=5)
 box('Crane operator house',(x-.75,y,z+.05),(2.0,1.65,2.0),'naval')
 box('Crane cabin window',(x+.26,y,z+.40),(.02,1.24,.58),'glass')
 cyl('Crane geared turntable',(x,y,z-.65),1.25,.3,'edge',vertices=28)
 rod('Crane hoist drum',(x-1.8,y-.58,z+.35),(x-1.8,y+.58,z+.35),.42,'edge',vertices=20)
 rod('Crane supporting stay',(x-1.8,y,z+3.4),boomB,.045,'edge',vertices=6)
 rod('Crane back stay',(x-1.8,y,z+3.4),(x-2.4,y,z-.5),.09,'naval',vertices=8)
 rod('Crane kingpost',(x-.4,y,z-.5),(x-1.8,y,z+3.4),.13,'naval',vertices=10)
 for k in range(12):
  t=k/12;u=(k+1)/12;pa=boomA.lerp(boomB,t);pb=boomA.lerp(boomB,u)
  rod('Crane top cross brace',pa+Vector((0,-.5,.7*(1-t))),pb+Vector((0,.5,.7*(1-u))),.035,'naval',vertices=6)
  rod('Crane lower cross brace',pa+Vector((0,.5,-.7*(1-t))),pb+Vector((0,-.5,-.7*(1-u))),.035,'naval',vertices=6)
 ladder('Crane pedestal ladder',(x-.8,y,DECK+.2),(x-.8,y,z-.4),w=.55)
 rail('Crane maintenance balcony',[(x+xx,y+yy,z-.5) for xx,yy in [(-1.8,-1.2),(1.4,-1.2),(1.4,1.2),(-1.8,1.2),(-1.8,-1.2)]],.9)
 node=pivot(ASSEMBLY+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)

def boat(name,x,y,z,length=9,width=2.7,motor=False):
 global ASSEMBLY
 ASSEMBLY=name;n=36;vs=[]
 outline=[]
 for i in range(n):
  t=i*math.tau/n;xx=length/2*math.cos(t);yy=width/2*math.sin(t)*(1-.20*math.cos(t));outline.append((xx,yy))
 for scale,zz in [(.72,0),(1,.65),(.90,.67),(.64,.16)]:
  vs.extend([(x+xx*scale,y+yy*scale,z+zz+(.20*abs(xx/(length/2))**3 if zz>.5 else 0)) for xx,yy in outline])
 ff=[tuple(reversed(range(n))),tuple(range(3*n,4*n))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
 hull=mesh('Clinker boat hull and open well',vs,ff,'naval',smooth=True)
 for level in [.24,.43]:tube('Boat strake',[(x+xx*(.75+.25*level/.65),y+yy*(.75+.25*level/.65),z+level) for xx,yy in outline+[outline[0]]],.022,'edge',vertices=5)
 tube('Boat gunwale',[(x+xx,y+yy,z+.67+.20*abs(xx/(length/2))**3) for xx,yy in outline+[outline[0]]],.055,'canvas',vertices=6)
 for dx in [-length*.28,-length*.10,length*.12,length*.30]:box('Boat wooden thwart',(x+dx,y,z+.51),(.29,width*.76,.09),'deck')
 for dx in [-length*.25,length*.25]:
  box('Boat cradle',(x+dx,y,z-.23),(.22,width,.4),'edge')
  for sign in [-1,1]:rod('Boat cradle brace',(x+dx,y+sign*width*.47,z+.09),(x+dx,y+sign*width*.34,z-.44),.07,'naval',vertices=6)
 if motor:
  prism('Motor launch cabin',octagon(x+.45,y,length*.27,width*.70,.25),z+.66,.95,'canvas')
  box('Launch wheelhouse glass',(x+.45+length*.135,y,z+1.25),(.02,width*.52,.45),'glass')
  for side in [-1,1]:box('Launch side glass',(x+.5,y+side*width*.352,z+1.24),(length*.19,.02,.40),'glass')
  box('Launch cabin roof',(x+.45,y,z+1.67),(length*.29,width*.76,.10),'white')
  rod('Launch exhaust',(x-.55,y,z+.7),(x-.55,y,z+2.12),.11,'edge',vertices=10)
  rod('Boat propeller shaft',(x-length*.4,y,z+.05),(x-length*.53,y,z-.16),.055,'edge',vertices=6)
 else:
  for side in [-1,1]:rod('Stowed boat oar',(x-length*.38,y+side*.36,z+.65),(x+length*.35,y+side*.36,z+.65),.032,'deck',vertices=6)
for i,(x,y,l,w) in enumerate([(-30.5,-5.8,11.2,2.8),(-30.5,5.8,11.2,2.8),(-33,-2.1,9.3,2.6),(-33,2.1,9.3,2.6),(-40.2,0,6.8,2.0)]):boat('boat-'+str(i+1),x,y,DECK+6.30,l,w,i<2)
# Boat-deck pillars and open walkway make the level separation legible.
ASSEMBLY='boat-deck-support'
for x in [-20,-26,-31,-36]:
 for side in [-1,1]:
  rod('Boat deck pillar',(x,side*7.7,DECK+3.1),(x,side*7.7,DECK+6.02),.105,'naval',vertices=10)
  rod('Boat deck knee',(x,side*7.7,DECK+5.2),(x+1.1,side*7.7,DECK+6.0),.07,'naval',vertices=8)
for side in [-1,1]:
 ladder('Boat deck access',(-42.1,side*7,DECK+.1),(-37.8,side*7,DECK+3.2))
 for x in [-36,-30,-22]:life_raft('Aft shelter Carley float',x,side*8.54,DECK+1.55,True)
 rail('Boat deck edge',[(x,side*(8.44 if x>-37 else 3.5),DECK+6.22) for x in [-42,-37,-32,-27,-22,-18]],.95)
# Small independently authored Walrus: amphibious hull, biplane wings, pusher engine.
ASSEMBLY='walrus';x=-10.8;y=1.2;z=DECK+2.3
outline=[(x-4.8,y),(x-3.6,y-.55),(x+2.3,y-.8),(x+5,y),(x+2.3,y+.8),(x-3.6,y+.55)]
prism('Walrus boat fuselage',outline,z,1.25,'aircraft')
for zz in [z+.95,z+3.0]:
 prism('Walrus wing',[(x-.5,y-6.95),(x+1.7,y-6.3),(x+1.7,y+6.3),(x-.5,y+6.95)],zz,.13,'aircraft')
for side in [-1,1]:
 for dx in [-.25,1.25]:rod('Walrus interplane strut',(x+dx,y+side*4.6,z+1),(x+dx,y+side*4.6,z+3),.045,'edge',vertices=6)
 ellipse('Wingtip float',x+.6,y+side*5.4,z-.2,1.0,.27,.4,'naval',n=12)
box('Walrus canopy',(x+2,y,z+1.48),(1.7,1.1,.65),'glass')
rod('Walrus engine',(x-.2,y,z+2.7),(x-1.4,y,z+2.7),.43,'edge',vertices=16)
rod('Walrus pusher propeller',(x-1.45,y-1.1,z+2.7),(x-1.45,y+1.1,z+2.7),.06,'dark',vertices=6)
prism('Walrus tailplane',[(x-4.4,y-2.05),(x-3.2,y-2.05),(x-3.2,y+2.05),(x-4.4,y+2.05)],z+1.5,.12,'aircraft')
mesh('Walrus fin',[(x-4.4,y,z+1),(x-4.4,y,z+3),(x-3.1,y,z+1.3)],[(0,1,2)],'aircraft')
for side in [-1,1]:
 for key,r in [('blue',.59),('white',.39),('red',.19)]:
  cyl('RAF roundel',(x+.55,y+side*5.0,z+3.145+(.002 if key=='white' else .004 if key=='red' else 0)),r,.003,key,vertices=24)

COL=collections['Light AA']
for i,(x,y,z) in enumerate([(4,6.6,DECK+6.28),(4,-6.6,DECK+6.28),(-24.2,6.6,DECK+6.28),(-24.2,-6.6,DECK+6.28)]):
 ASSEMBLY='pom-pom-'+str(i+1)
 outline=[(x+2.75*math.cos(a*math.tau/32),y+2.62*math.sin(a*math.tau/32)) for a in range(32)]
 gallery('Pom-pom splinter platform',outline,z,.83)
 before=set(scene.objects)
 cyl('Pom-pom geared roller',(x,y,z+.27),.91,.30,'edge',vertices=28)
 cyl('Pom-pom pedestal',(x,y,z+.67),.46,.70,'naval',vertices=20)
 box('Pom-pom open cradle',(x-.25,y,z+1.16),(1.3,1.98,.36),'edge')
 for yy in [-.81,-.27,.27,.81]:
  for zz in [z+1.14,z+1.60]:
   rod('2-pounder water jacket',(x-.33,y+yy,zz),(x+.94,y+yy,zz+.41),.094,'naval',vertices=12)
   rod('2-pounder barrel',(x+.9,y+yy,zz+.4),(x+2.05,y+yy,zz+.78),.052,'edge',vertices=12)
   rod('2-pounder muzzle',(x+2.03,y+yy,zz+.773),(x+2.11,y+yy,zz+.797),.07,'naval',vertices=10)
   box('Pom-pom breech',(x-.65,y+yy,zz-.03),(.55,.20,.23),'naval')
 for sign in [-1,1]:
  box('Pom-pom ammunition feed',(x-.4,y+sign*1.28,z+1.37),(1.3,.60,.76),'naval')
  box('Feed-box lid',(x-.4,y+sign*1.28,z+1.77),(1.35,.66,.07),'roof')
  box('Gunner seat',(x-1.15,y+sign*.72,z+.80),(.5,.48,.11),'canvas')
  rod('Control wheel axis',(x-.9,y+sign*1.20,z+1.04),(x-.9,y+sign*1.48,z+1.04),.08,'edge',vertices=10)
 rod('Pom-pom sight',(x-.2,y,z+1.85),(x-.2,y,z+2.3),.04,'edge',vertices=6)
 node=pivot(ASSEMBLY+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)
def up_launcher(id,x,y,z,parent=None):
 global ASSEMBLY
 ASSEMBLY=id;before=set(scene.objects)
 cyl('UP pedestal',(x,y,z+.35),.55,.7,'naval',vertices=16)
 box('UP rocket projector',(x,y,z+1.4),(1.4,1.85,1.6),'naval')
 for i in range(4):
  for j in range(5):rod('UP tube opening',(x+.705,y-.7+j*.35,z+.85+i*.35),(x+.725,y-.7+j*.35,z+.85+i*.35),.105,'dark',vertices=10)
 if parent:
  for ob in set(scene.objects)-before:ob.parent=parent
yawB=next(o for o in scene.objects if o.get('nodeId')=='main-b.yaw')
yawY=next(o for o in scene.objects if o.get('nodeId')=='main-y.yaw')
up_launcher('up-main-b',-1.8,0,3.72,yawB)
up_launcher('up-main-y',-2.0,2.25,3.72,yawY)
up_launcher('up-waist-1',-2.0,-2.25,3.72,yawY)
up_launcher('up-waist--1',-88,0,deckz(-88)+.18)

COL=collections['Deck fittings'];ASSEMBLY='deck-rails'
for side in [-1,1]:
 points=[(x,side*max(.04,sidewidth(x,deckz(x))-.19),deckz(x)+.07) for x in [(-L/2+2)+i*(L-4)/100 for i in range(101)]]
 rail('Deck perimeter',points)
# Upper-side scuttles follow the authored section shape. These small fittings
# add scale without changing the measured or simulated hull envelope.
ASSEMBLY='hull-scuttles'
for x in list(range(-100,-66,3))+list(range(61,101,3)):
 for side in [-1,1]:
  for z in [3.5,5.15]:
   y=side*(sidewidth(x,z)+.018)
   rod('Hull scuttle rim',(x,y,z),(x,y+side*.045,z),.155,'edge',vertices=12)
   rod('Hull scuttle glass',(x,y+side*.047,z),(x,y+side*.055,z),.108,'dark',vertices=12)
ASSEMBLY='bridge-access'
for x,y,z in [(26.5,5.5,DECK+6.2),(27.5,-6.8,DECK+3.2),(-38,8.0,DECK+3.2)]:
 for side in [-1,1]:rod('Ladder handrail',(x-1.8,y+side*.37,z),(x,y+side*.37,z+2.8),.035,'edge',vertices=6)
 for k in range(10):rod('Ladder tread',(x-1.8+k*.18,y-.35,z+k*.28),(x-1.8+k*.18,y+.35,z+k*.28),.045,'naval',vertices=6)
# Forecastle: chain beds, stockless anchors, breakwater gussets and capstans.
ASSEMBLY='forecastle'
for side in [-1,1]:
 y=side*3.0
 for x in [83,88]:
  zz=deckz(x);cyl('Capstan foundation',(x,y,zz+.18),1.00,.30,'roof',vertices=32)
  cyl('Anchor capstan',(x,y,zz+.62),.64,.8,'naval',vertices=24)
  cyl('Capstan drum lip',(x,y,zz+1.07),.76,.12,'edge',vertices=24)
  for k in range(8):
   t=math.tau*k/8;box('Capstan rim bolt',(x+.6*math.cos(t),y+.6*math.sin(t),zz+1.14),(.09,.09,.08),'naval')
 for k in range(76):
  x=86+k*.21;yy=y+side*k*.038;zz=deckz(x)
  # Interleaved oval links read correctly in closer deck views.
  ob=hoop('Anchor chain link',(x,yy,zz+.12),.145,.090,.027,'edge',n=10,k=5)
  if k%2:ob.rotation_euler.x=math.pi/2;ob.location=(0,yy+zz+.12,zz+.12-yy)
 for xx in [89,97]:
  box('Chain stopper bed',(xx,side*3.5,deckz(xx)+.16),(1.2,.65,.27),'roof')
  box('Chain compressor',(xx,side*3.5,deckz(xx)+.51),(.42,.71,.4),'naval')
 x=102;zz=deckz(x)-1.7;yy=side*(sidewidth(x,zz)+.05)
 before=set(scene.objects);h=hoop('Hawse lip',(0,0,0),.68,.47,.13,'naval',n=28,k=8);h.rotation_euler.x=math.pi/2;h.location=(x,yy,zz+.3)
 rod('Anchor shank',(x,yy,zz+.6),(x-1.05,yy,zz-1.55),.15,'edge',vertices=12)
 rod('Anchor crown',(x-1.93,yy,zz-1.55),(x-.20,yy,zz-1.88),.20,'edge',vertices=12)
 for dx in [-1.95,-.28]:
  vs=[(x+dx,yy,zz-1.70),(x+dx+.45,yy+side*.35,zz-.42),(x+dx-.36,yy+side*.35,zz-.53)]
  mesh('Anchor fluke',vs,[(0,1,2)],'edge')
for x in [76,-73]:
 for side in [-1,1]:
  for t0,t1 in zip([0,.2,.4,.6,.8],[.2,.4,.6,.8,1]):
   y0=side*(width(x)-.5)*t0;y1=side*(width(x)-.5)*t1;x0=x-2*t0;x1=x-2*t1;z0=deckz(x0);z1=deckz(x1)
   mesh('Breakwater splinter plate',[(x0,y0,z0),(x0,y0,z0+1.0-.4*t0),(x1,y1,z1+1.0-.4*t1),(x1,y1,z1)],[(0,1,2,3)],'naval')
   mesh('Breakwater triangular brace',[(x1,y1,z1+.95-.4*t1),(x1,y1,z1),(x1-1,y1,z1)],[(0,1,2)],'naval')
for x in [-103,-97,-88,-78,69,80,94,106]:
 for side in [-1,1]:
  ASSEMBLY='bollards';y=side*max(.6,sidewidth(x,deckz(x))-1.05);z=deckz(x)
  box('Bollard base',(x,y,z+.08),(1.6,.9,.13),'roof')
  for dx in [-.48,.48]:
   cyl('Mooring bollard',(x+dx,y,z+.47),.22,.78,'naval',vertices=16)
   cyl('Bollard cap',(x+dx,y,z+.87),.27,.11,'edge',vertices=16)
  hoop('Fairlead oval',(x-.3,y,z+.35),.64,.3,.12,'naval',n=24,k=6)
  if abs(x)<100:
   for k in range(5):hoop('Coiled hawser',(x+1.4,y-side*.8,z+.055),.43+k*.055,.43+k*.055,.028,'canvas',n=24,k=5)
for x in [-100,-95,-82,-76,-54,62,69,95,104]:
 for side in [-1,1]:
  ASSEMBLY='deck-hatches';z=deckz(x);y=side*min(3.0,sidewidth(x,z)*.40)
  prism('Raised hatch coaming',octagon(x,y,1.4,.93,.14),z,.25,'roof')
  prism('Hatch leaf',octagon(x,y,1.29,.82,.10),z+.25,.075,'naval')
  for xx in [-.45,.45]:box('Hatch hinge',(x+xx,y+.43,z+.27),(.18,.13,.12),'edge')
  rod('Hatch handle',(x-.14,y,z+.37),(x+.14,y,z+.37),.032,'edge',vertices=6)
for x in [-80,-55,62,79]:
 for side in [-1,1]:
  ASSEMBLY='ventilators';z=deckz(x);y=side*max(1,sidewidth(x,z)-2.6)
  box('Ventilator trunk',(x,y,z+.65),(1.1,.8,1.25),'naval')
  for k in range(6):box('Ventilator louvre',(x+.56,y,z+.25+k*.16),(.055,.70,.045),'dark')
# Human-scale lockers, reels and ventilators around the gun working decks.
for x in [-71,-50,-18,-5,31,40,60,72]:
 for side in [-1,1]:
  ASSEMBLY='deck-services';z=deckz(x);y=side*max(1.5,sidewidth(x,z)-2.0)
  for dx in [-.64,.64]:
   box('Ready-use locker',(x+dx,y,z+.49),(.94,.69,.93),'naval')
   box('Locker sloped lid',(x+dx,y,z+.98),(1.01,.77,.08),'roof')
   box('Locker door handle',(x+dx,y-side*.36,z+.52),(.13,.04,.06),'edge')
  rod('Hose reel axle',(x+2,y-.58,z+.52),(x+2,y+.58,z+.52),.08,'naval',vertices=8)
  for yy in [-.52,.52]:rod('Hose reel flange',(x+2,y+yy-.04,z+.52),(x+2,y+yy+.04,z+.52),.43,'naval',vertices=20)
  rod('Hose reel',(x+2,y-.40,z+.52),(x+2,y+.40,z+.52),.33,'edge',vertices=20)
# Subtle sheer strakes and plate seams follow the actual authored side surface.
ASSEMBLY='hull-plating'
for side in [-1,1]:
 for zz in [1.05,4.62]:
  for x in range(-98,106,2):
   a=(x,side*(sidewidth(x,zz)+.024),zz);b=(x+2,side*(sidewidth(x+2,zz)+.024),zz)
   mesh('Hull strake lip',[a,b,(b[0],b[1]+side*.045,zz+.06),(a[0],a[1]+side*.045,zz+.06)],[(0,1,2,3)],'naval')
 for x in [-72,-45,-22,1,25,47,63]:
  ps=[(x,side*(sidewidth(x,zz)+.025),zz) for zz in [-2,-1,0,1,2,3,4,5]]
  tube('Hull expansion seam',ps,.012,'edge',vertices=5)
 for x in [-88,-58,-20,22,59,86]:
  zz=5.2;yy=side*(sidewidth(x,zz)+.055)
  for h in [0,.32,.64]:rod('Ship side access rung',(x-.28,yy,zz+h),(x+.28,yy,zz+h),.025,'naval',vertices=6)
ASSEMBLY='ensign'
rod('Ensign staff',(-111,0,DECK),(-111,0,DECK+5.2),.07,'naval',vertices=10)
# Original geometric white ensign, visually static in this version.
box('White ensign',(-109.3,0,DECK+4.1),(3.3,.015,1.7),'white')
box('Ensign horizontal cross',(-109.3,-.012,DECK+4.1),(3.3,.02,.24),'red')
box('Ensign vertical cross',(-109.3,-.014,DECK+4.1),(.24,.025,1.7),'red')
box('Ensign canton',(-110.12,-.028,DECK+4.53),(1.5,.02,.72),'blue')
for sign in [-1,1]:
 ob=box('Canton saltire',(-110.12,-.042,DECK+4.53),(1.63,.022,.08),'white');ob.rotation_euler.y=sign*.447
box('Canton cross',(-110.12,-.045,DECK+4.53),(1.5,.02,.14),'white')
box('Canton upright',(-110.12,-.046,DECK+4.53),(.14,.02,.72),'white')

COL=collections['Underwater fittings']
for i,(y,x) in enumerate([(-8,-83),(-3.8,-92),(3.8,-92),(8,-83)],1):
 ASSEMBLY='shaft-'+str(i);z=-5.95
 rod('Shaft',(x+26,y*.87,z+1),(x,y,z),.24,'edge',vertices=16)
 for sign in [-1,1]:rod('A-bracket',(x+1.5,y,z),(x+4,y+sign*1.5,z+2.3),.19,'antifouling',vertices=12)
 before=set(scene.objects);rod('Screw hub',(x-1.2,y,z),(x+.8,y,z),.53,'bronze',r2=.28,vertices=24)
 for j in range(3):
  a=math.tau*j/3;shape=[(.38,-.15),(1.1,-.63),(1.95,-.45),(2.21,.10),(1.75,.73),(.70,.51)]
  vs=[(x+.22*r,y+r*math.cos(a)-t*math.sin(a),z+r*math.sin(a)+t*math.cos(a)) for r,t in shape]
  mesh('Three-bladed screw',vs,[tuple(range(len(vs)))],'bronze')
 node=pivot('propeller-'+str(i)+'.spin',(x,y,z));attach_world(set(scene.objects)-before-{node},node)
for side in [-1,1]:
 ASSEMBLY='rudder-'+('port' if side==1 else 'starboard');x=-99;y=side*3.0;before=set(scene.objects)
 vs=[(x+dx,y+s*.20,z) for s in [-1,1] for dx,z in [(1,-3.2),(-3.5,-3.6),(-4.2,-8.5),(1.8,-8.5)]]
 mesh('Balanced rudder',vs,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'antifouling')
 node=pivot(ASSEMBLY+'.yaw',(x,y,-4));attach_world(set(scene.objects)-before-{node},node)
# Bilge keels run below the turn of bilge; no external reference geometry.
for side in [-1,1]:
 ASSEMBLY='bilge-keel-'+str(side)
 pts=[(x,side*sidewidth(x,-5.8),-5.8) for x in [-60,-45,-20,0,25,45]]
 for a,b in zip(pts,pts[1:]):mesh('Bilge keel fin',[a,b,(b[0],b[1]+side*.65,b[2]-.35),(a[0],a[1]+side*.65,a[2]-.35)],[(0,1,2,3)],'antifouling')

COL=collections['Sensors and masts'];ASSEMBLY='landmarks'
for id,pos in [('funnel-cap',(.8,0,DECK+18)),('foremast-top',(8.5,0,37.8)),('mainmast-top',(-43.6,0,34.1)),('fore-director',(22.3,0,DECK+16.35)),('bridge-front',(31,0,DECK+16.95))]:pivot('landmark.'+id,pos)

COL=collections['Simulation volumes']
for group in ['armor','modules','compartments','obstructions']:
 for v in D[group]:
  ASSEMBLY=v['id'];x,y,z=v['center'];sx,sy,sz=v['size']
  ob=box(group+'.'+v['id'],(-z,-x,y),(sz,sx,sy),'dark');ob['exportRole']='simulation';ob.display_type='WIRE';ob.hide_render=True
scene['definitionHash']=D['contentHash'];scene['historicalConfiguration']=D['configuration']
scene['accuracyStatus']='Game reconstruction; see discrepancy register for evidence and limits.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('King George V original source:',len(scene.objects),'objects')

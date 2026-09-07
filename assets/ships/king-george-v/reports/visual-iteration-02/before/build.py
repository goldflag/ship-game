"""Original HMS King George V, early 1941. Blueprint-driven local Blender recipe.
Primitive mesh helpers adapted from this project's independently authored Baltimore.
All lasting geometry lives here or in the component catalog; reference art is not read.
"""
import bpy
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
colors={'naval':(.25,.29,.31,1),'hullgray':(.20,.24,.26,1),'roof':(.16,.19,.20,1),'edge':(.115,.135,.145,1),'canvas':(.36,.37,.34,1),'dark':(.013,.019,.022,1),'deck':(.42,.32,.20,1),'antifouling':(.24,.054,.035,1),'boot':(.025,.032,.034,1),'bronze':(.39,.29,.10,1),'glass':(.028,.072,.084,1),'white':(.71,.73,.7,1),'red':(.37,.04,.04,1),'blue':(.03,.07,.17,1),'aircraft':(.22,.29,.28,1)}
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
  for h in [.48,height]:rod(name+' wire',a+Vector((0,0,h)),b+Vector((0,0,h)),.019,'edge',vertices=5)
  for j in range(max(1,math.ceil(length/2.5))):
   p=a+(b-a)*(j/max(1,math.ceil(length/2.5)));rod(name+' stanchion',p,p+Vector((0,0,height)),.028,'naval',vertices=6)

COL=collections['Batteries']
for mount in D['mounts']:
 ASSEMBLY=mount['id'];create_gun_mount(mount,COL,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
 yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
 # Original periscopes, seams and sight ports follow their actual yaw joint.
 for lateral in [-2.1,2.1] if mount['battery']=='main' else [-1.35,1.35]:
  z=mount['weapon']['gunhouseSize'][2]
  ob=box('Gunlayer sight',(0,lateral,z+.14),(.42,.3,.28),'naval');ob.parent=yaw
  ob=box('Gunlayer glass',(.215,lateral,z+.14),(.018,.18,.12),'glass');ob.parent=yaw

COL=collections['Superstructure']
for s in D['structures']:
 ASSEMBLY=s['id'];outline=[(-z,-x) for x,z in s['footprint']];z=s['baseY'];top=z+s['height']
 prism(s['name'],outline,z,s['height'],s['material'])
 if 'funnel' in s['id']:
  x=sum(p[0] for p in outline)/len(outline)
  ellipse('Funnel black cap',x,0,top-.45,3.66,3.06,.55,'edge')
  ellipse('Recessed exhaust',x,0,top+.105,3.32,2.72,.02,'dark')
  for dx in [-1.25,1.25]:
   box('Internal exhaust divider',(x+dx,0,top+.08),(.12,5.1,.28),'edge')
  for side in [-1,1]:
   for dx in [-1.8,0,1.8]:rod('Funnel steam pipe',(x+dx,side*2.93,z+.4),(x+dx,side*2.93,top-.9),.12,'naval',vertices=10)
  for k in range(12):rod('Funnel ladder rung',(x-3.58,-.36,z+k*.68),(x-3.58,.36,z+k*.68),.024,'edge',vertices=6)
 else:
  prism('Deck edge lip',outline,top,.07,'roof')
  if s['id'].startswith('tower-') or s['id']=='boat-deck':
   perimeter_wall(s['name']+' parapet',outline,top,.72)
  if s['height']>1:
   for a,b in zip(outline,outline[1:]+outline[:1]):
    ax,ay=a;bx,by=b;length=math.hypot(bx-ax,by-ay)
    for k in range(1,max(2,int(length/1.45))):
     t=k/max(2,int(length/1.45));px=ax+(bx-ax)*t;py=ay+(by-ay)*t
     # Window slits on bridges; circular scuttles on lower deckhouses.
     if 'bridge' in s['id']:
      ob=box('Bridge window',(px,py,top-.85),(.80,.022,.63),'glass');ob.rotation_euler.z=math.atan2(by-ay,bx-ax)
     else:
      nx=(by-ay)/max(length,.01);ny=-(bx-ax)/max(length,.01)
      rod('Scuttle brass rim',(px,py,top-.8),(px+nx*.055,py+ny*.055,top-.8),.18,'edge',vertices=12)
      rod('Scuttle glass',(px+nx*.056,py+ny*.056,top-.8),(px+nx*.066,py+ny*.066,top-.8),.12,'glass',vertices=12)
# Visible hangar openings and shutters, facing the central aircraft deck.
for side in [-1,1]:
 box('Hangar sliding door',(-4.025,side*4.5,DECK+2.5),(.035,5.5,4.8),'dark')
 for y in range(10):box('Hangar door corrugation',(-4.05,side*(1.9+y*.55),DECK+2.5),(.08,.035,4.8),'edge')

COL=collections['Sensors and masts']
def director(id,x,y,z,main=False):
 global ASSEMBLY
 ASSEMBLY=id;before=set(scene.objects)
 cyl('Director pedestal',(x,y,z+.5),1.55 if main else 1.05,1,'naval',vertices=24)
 box('Director enclosure',(x,y,z+1.7),(3.5,3.6,1.6) if main else (2.1,2.2,1.8),'naval')
 span=4.8 if main else 2.2
 rod('Optical rangefinder',(x,y-span,z+1.9),(x,y+span,z+1.9),.23 if main else .16,'naval',vertices=16)
 for side in [-1,1]:box('Director end hood',(x,y+side*span,z+1.9),(.8,.45,.62),'naval')
 node=pivot(id+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)
 return node
director('dct-forward',18.2,0,DECK+18.3,True)
director('dct-after',-45.5,0,DECK+7.8,True)
for id,x,y,z in [('hacs-p-forward',18,6.6,DECK+12.2),('hacs-s-forward',18,-6.6,DECK+12.2),('hacs-p-after',-40,6.1,DECK+5.8),('hacs-s-after',-40,-6.1,DECK+5.8)]:director(id,x,y,z)
# Main Type 284 rectangular mattress antenna, individually retained.
ASSEMBLY='radar-284';before=set(scene.objects)
for y in [-2.9,2.9]:
 box('Type 284 panel',(20.4,y,DECK+21.5),(.08,2.7,.95),'edge')
 for k in range(7):rod('Radar dipole',(20.46,y-1.2+k*.4,DECK+21.1),(20.46,y-1.2+k*.4,DECK+21.9),.025,'naval',vertices=6)
node=pivot('radar-284.yaw',(18.2,0,DECK+20.5));attach_world(set(scene.objects)-before-{node},node)
for name,x,top,spread in [('foremast',9.4,33.7,3.4),('mainmast',-42.7,30.8,2.9)]:
 ASSEMBLY=name
 rod(name+' pole',(x,0,DECK+4),(x-1.2,0,top),.31,'naval',r2=.085,vertices=16)
 for side in [-1,1]:rod(name+' tripod',(x-3.2,side*spread,DECK+5.7),(x-.8,0,top-7),.19,'naval',r2=.12,vertices=12)
 for z,span in [(top-2,5.3),(top-6,7.2)]:
  rod('Signal yard',(x-1,-span,z),(x-1,span,z),.065,'edge',vertices=8)
  for side in [-1,1]:
   rod('Yard brace',(x-1,side*span,z),(x-1.15,0,z+2),.028,'edge',vertices=6)
   for k in range(1,5):rod('Signal halyard',(x-1,side*(.9+k*1.1),z),(x-2,side*2.9,DECK+7),.009,'edge',vertices=4)
 # Early Type 279 aerial pairs at the mastheads.
 for dz in [0,.75]:
  rod('Type 279 crossbar',(x-1.2,-1.6,top+dz),(x-1.2,1.6,top+dz),.05,'edge',vertices=6)
  for y in [-1.5,-.75,0,.75,1.5]:rod('Type 279 dipole',(x-1.55,y,top+dz),(x-.85,y,top+dz),.025,'naval',vertices=6)
rod('Wireless aerial',(8.2,0,32),(-43.9,0,29.5),.012,'edge',vertices=5)
for x,z in [(.8,DECK+13),(-23.4,DECK+13)]:
 for side in [-1,1]:
  ASSEMBLY='searchlights';ellipse('Searchlight platform',x-1,side*3.2,z,1.8,1.3,.16,'roof',n=20)
  cyl('Searchlight pedestal',(x-1,side*3.5,z+.6),.20,1,'naval',vertices=12)
  rod('Searchlight casing',(x-1,side*3.3,z+1.2),(x-1,side*4.0,z+1.2),.55,'naval',vertices=20)
  rod('Searchlight lens',(x-1,side*4.01,z+1.2),(x-1,side*4.03,z+1.2),.46,'glass',vertices=20)

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
 node=pivot(ASSEMBLY+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)

def boat(name,x,y,z,length=9,width=2.7):
 global ASSEMBLY
 ASSEMBLY=name;outline=[(-length/2,0),(-length*.36,-width*.45),(length*.28,-width/2),(length/2,0),(length*.28,width/2),(-length*.36,width*.45)]
 prism('Boat hull',[(x+a,y+b) for a,b in outline],z,.8,'naval')
 prism('Boat interior',[(x+a*.86,y+b*.8) for a,b in outline],z+.8,.06,'deck')
 for dx in [-2,0,2]:box('Boat thwart',(x+dx,y,z+.92),(.3,width*.77,.1),'canvas')
 for dx in [-length*.25,length*.25]:box('Boat cradle',(x+dx,y,z-.25),(.25,width,.5),'edge')
for i,(x,y,l,w) in enumerate([(-31,-5.6,10,2.8),(-31,5.6,10,2.8),(-33,-2,8,2.3),(-33,2,8,2.3),(-40.2,0,6,1.9)]):boat('boat-'+str(i+1),x,y,DECK+5.9,l,w)
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
for i,(x,y,z) in enumerate([(0,7.0,DECK+6.3),(0,-7.0,DECK+6.3),(-27,7.2,DECK+5.9),(-27,-7.2,DECK+5.9)]):
 ASSEMBLY='pom-pom-'+str(i+1);before=set(scene.objects)
 cyl('Octuple pom-pom platform',(x,y,z),2.0,.18,'roof',vertices=32)
 cyl('Pom-pom pedestal',(x,y,z+.58),.45,1,'naval',vertices=16)
 box('Pom-pom receiver',(x,y,z+1.1),(1.25,2.1,.85),'naval')
 for yy in [-.81,-.27,.27,.81]:
  for zz in [z+.94,z+1.4]:rod('2-pounder barrel',(x+.5,y+yy,zz),(x+2.1,y+yy,zz+.06),.054,'edge',vertices=10)
 for sign in [-1,1]:box('Pom-pom ammunition feed',(x,y+sign*1.25,z+1.05),(1.3,.6,.65),'edge')
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
for mount in [D['mounts'][1],D['mounts'][2]]:
 yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
 up_launcher('up-'+mount['id'],-1.8,0,3.72,yaw)
for side in [-1,1]:up_launcher('up-waist-'+str(side),-46,side*7.3,DECK)

COL=collections['Deck fittings'];ASSEMBLY='deck-rails'
for side in [-1,1]:
 points=[(x,side*(width(x)*.982-.16),deckz(x)+.07) for x in [(-L/2+2)+i*(L-4)/100 for i in range(101)]]
 rail('Deck perimeter',points)
# Upper-side scuttles follow the authored section shape. These small fittings
# add scale without changing the measured or simulated hull envelope.
ASSEMBLY='hull-scuttles'
for x in list(range(-100,-66,3))+list(range(61,101,3)):
 for side in [-1,1]:
  for z in [3.5,5.15]:
   y=side*width(x)*(1-.018*z/DECK)
   rod('Hull scuttle rim',(x,y,z),(x,y+side*.045,z),.155,'edge',vertices=12)
   rod('Hull scuttle glass',(x,y+side*.047,z),(x,y+side*.055,z),.108,'dark',vertices=12)
ASSEMBLY='bridge-access'
for x,y,z in [(26.5,5.5,DECK+6.2),(27.5,-6.8,DECK+3.2),(-38,8.0,DECK+3.2)]:
 for side in [-1,1]:rod('Ladder handrail',(x-1.8,y+side*.37,z),(x,y+side*.37,z+2.8),.035,'edge',vertices=6)
 for k in range(10):rod('Ladder tread',(x-1.8+k*.18,y-.35,z+k*.28),(x-1.8+k*.18,y+.35,z+k*.28),.045,'naval',vertices=6)
# Flush upper deck, breakwaters, anchor chains, capstans and mooring gear.
ASSEMBLY='forecastle'
for side in [-1,1]:
 y=side*3.6
 for x in [84,89]:cyl('Anchor capstan',(x,y,DECK+.58),.60,1.1,'naval',vertices=20)
 for k in range(50):
  x=87+k*.30;yy=y+side*k*.055
  ob=box('Anchor chain link',(x,yy,DECK+.12),(.33,.22,.11),'edge');ob.rotation_euler.z=.15*side+(math.pi/2 if k%2 else 0)
 # Visible stockless anchor at hawse, independently authored.
 x=102;yy=side*max(.4,width(x)-.03);zz=DECK-1.8
 rod('Anchor shank',(x,yy,zz+.7),(x-1.1,yy,zz-1.4),.16,'edge',vertices=10)
 rod('Anchor crown',(x-2,yy,zz-1.35),(x-.25,yy,zz-1.8),.18,'edge',vertices=10)
 for dx in [-1.9,-.3]:mesh('Anchor fluke',[(x+dx,yy,zz-1.55),(x+dx+.45,yy+side*.35,zz-.45),(x+dx-.35,yy+side*.35,zz-.55)],[(0,1,2)],'edge')
for x in [76,-73]:
 for side in [-1,1]:
  mesh('Breakwater',[(x,0,DECK),(x,0,DECK+.85),(x-2,side*(width(x)-.5),DECK+.4),(x-2,side*(width(x)-.5),DECK)],[(0,1,2,3)],'naval')
for x in [-99,-90,-80,73,92,102]:
 for side in [-1,1]:
  ASSEMBLY='bollards';y=side*max(1,width(x)-1.2)
  box('Bollard base',(x,y,DECK+.1),(2,.9,.18),'edge')
  for dx in [-.55,.55]:cyl('Mooring bollard',(x+dx,y,DECK+.55),.2,.9,'naval',vertices=12)
for x in [-96,-85,-76,64,70,96]:
 for side in [-1,1]:
  ASSEMBLY='deck-hatches';box('Deck hatch',(x,side*2,DECK+.16),(1.4,.9,.25),'roof')
for x in [-80,-55,62,79]:
 for side in [-1,1]:
  ASSEMBLY='ventilators';y=side*max(1,width(x)-2.6)
  box('Ventilator trunk',(x,y,DECK+.65),(1.1,.8,1.25),'naval')
  for k in range(5):box('Ventilator louvers',(x+.56,y,DECK+.3+k*.18),(.04,.7,.05),'dark')
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
 pts=[(x,side*width(x)*.91,-5.8) for x in [-60,-45,-20,0,25,45]]
 for a,b in zip(pts,pts[1:]):mesh('Bilge keel fin',[a,b,(b[0],b[1]+side*.65,b[2]-.35),(a[0],a[1]+side*.65,a[2]-.35)],[(0,1,2,3)],'antifouling')

COL=collections['Simulation volumes']
for group in ['armor','modules','compartments','obstructions']:
 for v in D[group]:
  ASSEMBLY=v['id'];x,y,z=v['center'];sx,sy,sz=v['size']
  ob=box(group+'.'+v['id'],(-z,-x,y),(sz,sx,sy),'dark');ob['exportRole']='simulation';ob.display_type='WIRE';ob.hide_render=True
scene['definitionHash']=D['contentHash'];scene['historicalConfiguration']=D['configuration']
scene['accuracyStatus']='Game reconstruction; see discrepancy register for evidence and limits.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('King George V original source:',len(scene.objects),'objects')

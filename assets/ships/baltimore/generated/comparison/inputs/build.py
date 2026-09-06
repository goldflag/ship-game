"""Original USS Baltimore reconstruction, October 1943 fit.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up.
The shared exporter owns the sole basis conversion. Archival reference art is
never used as a texture. See references/measurements.json for evidence limits.
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
from blender_fidelity import authored_hull, authored_structure, Fittings, loft_breadth
OUT=Path(os.environ['SHIP_OUTPUT'])
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world=bpy.data.worlds.new('Baltimore review world');scene.world.color=(.08,.10,.12)
collections={}
for name in ['Hull and decks','Main and secondary batteries','Superstructure','Sensors and masts','Aircraft handling','Light AA','Deck fittings','Underwater fittings','Simulation volumes']:
 col=bpy.data.collections.new(name);scene.collection.children.link(col);collections[name]=col
COL=collections['Hull and decks'];ASSEMBLY='hull'
colors={'naval':(.19,.255,.31,1),'roof':(.11,.17,.22,1),'edge':(.085,.12,.15,1),'hullgray':(.17,.23,.285,1),'canvas':(.28,.31,.31,1),'dark':(.018,.023,.028,1),'antifouling':(.26,.067,.042,1),'boot':(.035,.043,.049,1),'bronze':(.36,.27,.12,1),'glass':(.025,.075,.095,1),'white':(.68,.7,.68,1),'aircraft':(.19,.26,.32,1),'aircraft-light':(.40,.44,.45,1)}
materials={}
for key,color in colors.items():
 m=bpy.data.materials.new('Baltimore '+key);m.diffuse_color=color;m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.72;p.inputs['Metallic'].default_value=.08
 materials[key]=m

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
H=D['hull'];L=H['length']
deckz=lambda x:interp(H['deckHeights'],x+L/2)
width=lambda x:interp(H['halfBreadths'],max(0,min(L,x+L/2)))
# Retained class-informed sections, with the same surface used by CPU hits.
hull=authored_hull(H,mesh,COL,[materials[k] for k in ['hullgray','antifouling','boot']],True)
S={s['id']:s for s in D['structures']}
# Articulated main and secondary mounts are generated through the shared catalog.
COL=collections['Main and secondary batteries']
for mount in D['mounts']:
 ASSEMBLY=mount['id']
 create_gun_mount(mount,COL,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
 Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL).gun_details(mount)
 # Baltimore's transverse rangefinder is near the BACK of the long gunhouse.
 # Its placement is retained here rather than inheriting German mount placement.
 if mount['battery']=='main':
  yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
  details=[]
  details.append(rod('Turret rangefinder',(-5.207,-3.98,2.16),(-5.207,3.98,2.16),.20,'naval',vertices=16))
  for side in [-1,1]:
   details.append(box('Rangefinder armored hood',(-5.207,side*3.98,2.16),(.68,.5,.58),'naval'))
   details.append(box('Rangefinder glass',(-5.36,side*4.235,2.2),(.22,.018,.16),'glass'))
  for lateral in [-2.5,-.86,.86,2.5]:
   details.append(cyl('Gunlayer periscope hood',(1.02,lateral,3.16),.17,.35,'naval',vertices=12))
   details.append(box('Periscope sight',(1.16,lateral,3.2),(.025,.14,.10),'glass'))
  for ob in details:ob.parent=yaw
# Blueprint deckhouses and their deck lips.
COL=collections['Superstructure']
for s in D.get('structures',[]):
 if s['id'] in ['forward-funnel','after-funnel','conning-tower'] or s['id'].startswith('aa-platform'):continue
 ASSEMBLY=s['id'];outline=[(-z,-x) for x,z in s['footprint']]
 authored_structure(s,mesh,materials,COL)
 if s['height']>.5:prism(s['name']+' deck rim',outline,s['baseY']+s['height'],.075,'roof')
 if s['id'] in ['bridge-wings','bridge-navigation-deck','bridge-platform','bridge-air-defense-platform']:
  perimeter_wall(s['name'],outline,s['baseY']+s['height'])
# Stack casings are oval, raked slightly aft, with open-looking black exhausts.
for name,x,top in [('forward-funnel',3.8,23.2),('after-funnel',-15.6,22.0)]:
 ASSEMBLY=name
 authored_structure(S[name],mesh,materials,COL)
 ellipse(name+' cap',x-1.25,0,top,3.55,2.7,.4,'edge')
 ellipse(name+' exhaust',x-1.25,0,top+.405,3.20,2.35,.018,'dark')
 for side in [-1,1]:
  for dx in [-1.5,0,1.5]:rod('Funnel steam pipe',(x+dx,side*2.65,10),(x+dx-1.1,side*2.65,top+.65),.11,'naval',vertices=10)
 for z in [13,17,20]:
  # Elliptical maintenance bands.
  pts=[(x-(z-10)/(top-10)*1.25+3.43*math.cos(a*math.tau/40),2.59*math.sin(a*math.tau/40),z) for a in range(41)]
  for a,b in zip(pts,pts[1:]):rod('Stack band',a,b,.028,'edge',vertices=6)
ASSEMBLY='conning-tower'
ellipse('Armored conning tower',23,0,7.8,2.75,2.4,4.2)
for side in [-1,1]:
 for x in [21.5,23,24.5]:box('Conning tower vision slit',(x,side*2.35,11.3),(.6,.04,.15),'dark')
# Navy bridge windows follow the traced wall rather than the old broad block.
ASSEMBLY='bridge-pilot-house'
pilot=next(s for s in D['structures'] if s['id']=='bridge-pilot-house')
outline=[(-z,-x) for x,z in pilot['footprint']]
for i,(a,b) in enumerate(zip(outline,outline[1:]+outline[:1])):
 if max(a[0],b[0])<18:continue
 length=math.dist(a,b);n=max(1,int(length/1.0));angle=math.atan2(b[1]-a[1],b[0]-a[0])
 for j in range(n):
  t=(j+.5)/n;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
  ob=box('Navigating bridge window',(x,y,pilot['baseY']+1.23),(min(.68,length/n*.73),.065,.48),'glass');ob.rotation_euler.z=angle
for side in [-1,1]:
 for x in [12,1,-24,-34]:
  box('Watertight door',(x,side*(6.45 if x>0 else 6.25),6.35),(.77,.045,1.65),'edge')
  for dx in [-.22,.22]:cyl('Door dog',(x+dx,side*(6.49 if x>0 else 6.29),6.35),.035,.04,'naval',vertices=8)
 for x in [8,11,-26,-30]:
  box('Vent louver',(x,side*5.34,9.0),(1.25,.06,1),'edge')
  for z in [8.7,8.9,9.1,9.3]:box('Vent slat',(x,side*5.38,z),(1.18,.03,.035),'naval')
# Directors, antennae and pole masts in the 1943 silhouette.
COL=collections['Sensors and masts']
def radar_grid(name,x,y,z,w,h,normal='x'):
 # Physical rod mesh, no source texture or opaque plane.
 def pt(a,b):return (x,y+a,z+b) if normal=='x' else (x+a,y,z+b)
 for i in range(13):
  a=-w/2+w*i/12;rod(name+' vertical',pt(a,-h/2),pt(a,h/2),.027,'edge',vertices=6)
 for i in range(9):
  b=-h/2+h*i/8;rod(name+' horizontal',pt(-w/2,b),pt(w/2,b),.027,'edge',vertices=6)
 for a,b in [((-w/2,-h/2),(w/2,h/2)),((-w/2,h/2),(w/2,-h/2))]:rod(name+' brace',pt(*a),pt(*b),.046,'naval',vertices=6)

def director(id,x,z,main=False):
 global ASSEMBLY
 ASSEMBLY=id
 cyl(id+' base',(x,0,z+.35),1.32 if main else 1.15,.7,'edge',vertices=32)
 if main:ellipse(id+' Mk 34 shield',x,0,z+.7,1.45,1.28,2.0)
 else:
  # The Mk 37 housing is rectangular on the Navy plan; its round support is separate.
  pts=[(x-1.50,-1.35),(x+1.15,-1.35),(x+1.45,-1.05),(x+1.45,1.05),(x+1.15,1.35),(x-1.50,1.35)]
  prism(id+' Mk 37 housing',pts,z+.7,2.35)
  prism(id+' Mk 37 roof',pts,z+3.05,.06,'roof')
  for y in [-.65,.65]:box(id+' telescope port',(x+1.475,y,z+2.35),(.035,.5,.42),'glass')
 half=2.8 if main else 2.3;rfz=z+(1.8 if main else 2.10)
 rod(id+' rangefinder',(x,-half,rfz),(x,half,rfz),.23,'naval',vertices=16)
 for y in [-half,half]:box(id+' rangefinder hood',(x,y,rfz),(.7,.44,.7),'naval')
 if main:radar_grid(id+' Mk 8 antenna',x,0,z+3.65,2.75,1.05)
 else:
  radar_grid(id+' Mk 4 antenna',x,0,z+4.35,2.75,1.65)
  for y in [-.70,.70]:rod('Mk 4 aerial support',(x-.45,y,z+3.11),(x,y,z+4.3),.07,'edge')
# The original bridge sheet and dated Navy profile agree: 8-inch directors
# occupy the lower, outward stations; 5-inch directors are higher and inboard.
director('forward-main-director',21.4,17.85,True)
director('after-main-director',-36,10.94,True)
director('forward-dp-director',14.1,22.89)
director('after-dp-director',-27.7,20.14)
for name,x,y,base,top in [('foremast',7.8,0,10.4,38.0),('mainmast',-24.2,0,10.4,37.0)]:
 ASSEMBLY=name
 rod(name+' pole',(x,y,base),(x-1.5,y,top),.3,'naval',r2=.075,vertices=16)
 for side in [-1,1]:rod(name+' stay',(x+4,side*2.7,base),(x-.6,0,base+(top-base)*.57),.13,'naval',r2=.09,vertices=10)
 z=top-6.4;mx=x-1.15
 rod(name+' yard',(mx,-5.5,z),(mx,5.5,z),.09,'naval',r2=.055,vertices=12)
 for side in [-1,1]:rod(name+' yard brace',(mx,0,z+3),(mx,side*5.5,z),.033,'edge',vertices=6)
 if name=='mainmast':radar_grid('SK search array',x-1.5,0,top-1.9,4.9,3.1)
 else:
  box('SG radar scanner',(x-1.5,0,top-.6),(.42,1.35,.35),'naval')
  rod('Forward mast top',(x-1.5,0,top),(x-1.5,0,top+1.1),.025,'edge',vertices=6)
 for side in [-1,1]:
  rod('Signal halyard',(mx,side*4.8,z),(x+1,side*3.2,14.5),.012,'edge',vertices=5)
rod('Main aerial',(6.3,0,36),(-25.7,0,35),.013,'edge',vertices=5)
# Aircraft handling deck: twin catapults, twin cranes and hangar hatch.
COL=collections['Aircraft handling']
def lattice(name,a,b,width_,height):
 a,b=Vector(a),Vector(b);direction=(b-a).normalized();side=direction.cross(Vector((0,0,1))).normalized()*width_/2;up=Vector((0,0,height/2))
 for s in [-1,1]:
  for z in [-1,1]:rod(name+' chord',a+s*side+z*up,b+s*side+z*up,.07,'naval',vertices=8)
 for i in range(10):
  p=a+(b-a)*i/10;q=a+(b-a)*(i+1)/10
  for s in [-1,1]:rod(name+' web',p+s*side-up,q+s*side+up,.037,'edge',vertices=6)
 for i in range(11):
  p=a+(b-a)*i/10;rod(name+' tie',p-side+up,p+side+up,.045,'naval',vertices=6)
for side in [-1,1]:
 ASSEMBLY='catapult-port' if side>0 else 'catapult-starboard'
 y=side*4.7
 cyl('Catapult pedestal',(-82.5,y,6.75),1.0,1.5,'naval',vertices=24)
 lattice('Powder catapult',(-90,y,7.7),(-73,y,7.7),1.05,.75)
 for dy in [-.35,.35]:rod('Catapult rail',(-90,y+dy,8.1),(-73,y+dy,8.1),.055,'edge')
 box('Aircraft launch trolley',(-82,y,8.2),(1.5,1.5,.28),'edge')
 ASSEMBLY='crane-port' if side>0 else 'crane-starboard'
 y=side*7.1
 cyl('Aircraft crane foundation',(-97,y,7.0),.95,1.4,'naval',vertices=24)
 lattice('Crane tower',(-97,y,7.7),(-95.6,y,15.5),.95,.95)
 lattice('Crane boom',(-95.6,y,15.5),(-82.1,y,16.0),.75,.75)
 rod('Crane backstay',(-97,y,7.7),(-95.6,y,17),.055,'edge')
 rod('Crane boom cable',(-95.6,y,17),(-82.1,y,16.0),.026,'edge',vertices=6)
 rod('Crane hook cable',(-82.1,y,16.0),(-82.1,y,11.5),.025,'edge',vertices=6)
 cyl('Crane sheave',(-82.1,y,15.95),.21,.15,'edge',vertices=16)
 box('Crane winch',(-96.3,y,7.7),(1.4,1.3,.8),'naval')
# Original indicative OS2U-3 shapes. Dimensions are retained here for future
# replacement with a versioned original component (span 10.97 m, length 10.31 m).
def aircraft(id,x,y,z):
 global ASSEMBLY
 ASSEMBLY=id
 n=16;stations=[(-5.15,.06),(-4.3,.27),(-2.0,.55),(0,.62),(2,.64),(3.5,.55),(4.5,.46),(5.15,.04)]
 verts=[(x+a,y+rad*math.cos(math.tau*j/n),z+rad*math.sin(math.tau*j/n)) for a,rad in stations for j in range(n)]
 faces=[(i*n+j,(i+1)*n+j,(i+1)*n+(j+1)%n,i*n+(j+1)%n) for i in range(len(stations)-1) for j in range(n)]
 mesh('OS2U fuselage',verts,faces,'aircraft',smooth=True)
 prism('OS2U main wing',[(x+1.9,y-.7),(x+.8,y-5.485),(x-1.15,y-5.35),(x-1.65,y-.7),(x-1.65,y+.7),(x-1.15,y+5.35),(x+.8,y+5.485),(x+1.9,y+.7)],z-.12,.12,'aircraft')
 prism('OS2U tailplane',[(x-3.15,y),(x-3.7,y-1.8),(x-4.8,y-1.8),(x-4.7,y+1.8),(x-3.7,y+1.8)],z+.05,.08,'aircraft')
 mesh('OS2U fin',[(x-4.7,y,z),(x-4.65,y,z+1.45),(x-3.9,y,z+1.3),(x-3.0,y,z)],[(0,1,2,3)],'aircraft')
 box('OS2U cockpit',(x+.3,y,z+.65),(2.0,.7,.48),'glass')
 for a in [-.6,.1,.8]:box('OS2U canopy frame',(x+a,y,z+.9),(.04,.74,.04),'naval')
 ellipse('OS2U main float',x+.0,y,z-2.0,3.6,.42,.6,'aircraft-light')
 for dx in [-1.3,1.3]:
  for side in [-1,1]:rod('Float strut',(x+dx,y+side*.38,z-.2),(x+dx,y+side*.2,z-1.4),.05,'edge')
 for side in [-1,1]:
  ellipse('OS2U wing float',x-.4,y+side*4.2,z-1.1,1.05,.17,.28,'aircraft-light')
  rod('Wing float strut',(x-.4,y+side*4.2,z-.1),(x-.4,y+side*4.2,z-1.0),.04,'edge')
 rod('OS2U propeller',(x+4.7,y,z-1.1),(x+4.7,y,z+1.1),.065,'dark')
aircraft('kingfisher-port',-81,4.7,10.2)
aircraft('kingfisher-starboard',-81,-4.7,10.2)
# AA is visual equipment, as in the baseline ship; it does not silently turn the
# 5-inch battery into a mixed-caliber simulation battery.
COL=collections['Light AA']
def tub(name,x,y,z,r,height=.95,start=0,end=math.tau):
 n=40;vv=[(x+rad*math.cos(start+(end-start)*j/n),y+rad*math.sin(start+(end-start)*j/n),zz) for rad,zz in [(r,z),(r,z+height),(r-.065,z+height),(r-.065,z)] for j in range(n+1)]
 step=n+1;ff=[]
 for strip in range(3):
  for j in range(n):ff.append((strip*step+j,strip*step+j+1,(strip+1)*step+j+1,(strip+1)*step+j))
 return mesh(name,vv,ff,'naval')
def bofors(id,x,y,z,bearing):
 global ASSEMBLY
 ASSEMBLY=id
 cyl('40 mm gun tub deck',(x,y,z-.10),2.2,.20,'roof',vertices=40)
 tub('40 mm splinter shield',x,y,z,2.18,1.04)
 cyl('Bofors pedestal',(x,y,z+.36),.50,.72,'edge',vertices=20)
 angle=math.radians(bearing)
 def pt(a,b,c):return (x+a*math.cos(angle)-b*math.sin(angle),y+a*math.sin(angle)+b*math.cos(angle),z+c)
 base=box('Bofors carriage',pt(0,0,.9),(1.1,1.95,.8),'naval');base.rotation_euler.z=angle
 for lateral in [-.67,-.25,.25,.67]:
  rod('40 mm barrel',pt(.15,lateral,1.33),pt(2.05,lateral,1.56),.057,'edge',r2=.038,vertices=10)
  breech=box('40 mm breech',pt(-.5,lateral,1.23),(.9,.23,.35),'edge');breech.rotation_euler.z=angle
  box('40 mm clip guide',pt(-.43,lateral,1.57),(.32,.20,.38),'naval')
 for lateral in [-1.0,1.0]:
  seat=box('Bofors seat',pt(-.78,lateral,.8),(.37,.34,.08),'canvas');seat.rotation_euler.z=angle
for i,(x,y,z,b) in enumerate([(76,0,None,0),(45,7.5,6.1,70),(45,-7.5,6.1,-70),(26,8.1,8.0,70),(26,-8.1,8.0,-70),(-28,8.0,7.9,100),(-28,-8.0,7.9,-100),(-50,7.1,5.8,100),(-50,-7.1,5.8,-100),(-68,7.1,6.0,160),(-68,-7.1,6.0,-160),(-97,0,None,180)]):
 bofors(f'bofors-{i+1:02}',x,y,deckz(x)+.1 if z is None else z,b)
for i,(x,side) in enumerate([(x,side) for x in [94,89,65,60,37,33,8,-6,-40,-58,-89,-93] for side in [-1,1]]):
 ASSEMBLY=f'oerlikon-{i+1:02}';y=side*max(1.2,width(x)-.7);z=deckz(x)+.1
 cyl('Oerlikon stand',(x,y,z+.56),.14,1.12,'naval',vertices=14)
 cyl('Oerlikon base',(x,y,z+.05),.33,.1,'edge',vertices=16)
 rod('20 mm barrel',(x,y,z+1.25),(x+.27,y+side*.92,z+1.6),.026,'edge',vertices=8)
 shield=box('Oerlikon shield',(x,y+side*.35,z+1.06),(.85,.055,.67),'naval');shield.rotation_euler.z=-side*.27
 rod('20 mm drum',(x-.08,y,z+1.42),(x+.15,y,z+1.42),.18,'dark',vertices=14)
# Deck fittings and railing use per-assembly meshes, retaining logical ownership.
COL=collections['Deck fittings']
for side in [-1,1]:
 ASSEMBLY='hull-rails-port' if side>0 else 'hull-rails-starboard'
 points=[]
 for i in range(111):
  x=-L/2+.8+(L-1.6)*i/110;y=side*max(.08,width(x)-.18);z=deckz(x)+.04
  if abs(x+97)<2.2:continue
  points.append((x,y,z))
  rod('Rail stanchion',(x,y,z),(x,y,z+1.0),.022,'naval',vertices=6)
 for a,b in zip(points,points[1:]):
  if b[0]-a[0]>3:continue
  for h in [.35,.68,1.0]:rod('Guardrail',(a[0],a[1],a[2]+h),(b[0],b[1],b[2]+h),.012,'naval',vertices=5)
 ASSEMBLY='hull-openings-port' if side>0 else 'hull-openings-starboard'
 for x in range(-75,81,4):
  for z in [3.15,4.25]:
   if z>deckz(x)-.5:continue
   y=side*(width(x)*.998+.012)
   rod('Scuttle rim',(x,y,z),(x,y+side*.035,z),.13,'naval',vertices=16)
   rod('Dark scuttle',(x,y+side*.04,z),(x,y+side*.045,z),.087,'dark',vertices=14)
 for x in [-92,-64,-42,62,86,96]:
  ASSEMBLY='mooring-fittings';y=side*max(.6,width(x)-1.4);z=deckz(x)
  box('Bollard bed',(x,y,z+.1),(1.2,.7,.2),'roof')
  for dx in [-.32,.32]:cyl('Bollard',(x+dx,y,z+.42),.15,.6,'edge',vertices=16)
 for x in [2,-5]:
  ASSEMBLY='boats';y=side*4.2
  Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL).boat('26-foot motor whaleboat',x,y,10.7,7.92,2.04,False)
  for dx in [-2.3,2.3]:rod('Boat davit',(x+dx,y+side*.8,8.0),(x+dx,y+side*.8,12.3),.09,'naval')
 for x in [19,10,-23,-31]:
  for yy in [side*5.55,side*6.1]:
   ASSEMBLY='life-rafts';z=10.65 if x>0 else 10.6
   # Elliptical raft perimeter made of original tubular pieces.
   pts=[(x+1.05*math.cos(i*math.tau/20),yy+.37*math.sin(i*math.tau/20),z) for i in range(21)]
   for a,b in zip(pts,pts[1:]):rod('Carley float',a,b,.11,'canvas',vertices=8)
   for dx in [-.5,0,.5]:rod('Raft grating',(x+dx,yy-.22,z),(x+dx,yy+.22,z),.025,'edge',vertices=6)
# Anchor windlasses, chain runs, breakwaters, vents and deck hatches.
ASSEMBLY='forecastle-ground-tackle'
for side in [-1,1]:
 y=side*2.0;x=90;z=deckz(x)
 cyl('Anchor windlass',(x,y,z+.4),.52,.8,'edge',vertices=24)
 for i in range(38):
  xx=88+i*.28;yy=y+(xx-88)*side*.15
  if abs(yy)>width(xx)-.25:break
  ob=cyl('Anchor chain link',(xx,yy,deckz(xx)+.11),.075,.09,'edge',vertices=8)
 for dx in [-.55,.55]:rod('Anchor fluke',(97+dx,side*width(97),6.8),(96.2,side*width(96.2),5.8),.095,'edge')
for x in [68,-64]:
 ASSEMBLY='breakwaters'
 for side in [-1,1]:
  rod('Breakwater upper edge',(x,0,deckz(x)+.8),(x-1.3,side*(width(x)-.5),deckz(x)+.25),.045,'naval')
  mesh('Breakwater plate',[(x,0,deckz(x)),(x,0,deckz(x)+.8),(x-1.3,side*(width(x)-.5),deckz(x)+.25),(x-1.3,side*(width(x)-.5),deckz(x))],[(0,1,2,3)],'naval')
for x in [-62,-58,60,66,83]:
 for side in [-1,1]:
  ASSEMBLY='deck-hatches';y=side*2.8
  box('Raised hatch',(x,y,deckz(x)+.18),(1.4,.85,.30),'roof')
  rod('Hatch handle',(x-.16,y,deckz(x)+.35),(x+.16,y,deckz(x)+.35),.02,'naval',vertices=6)
# Four staggered screws. Class docking-plan comparison establishes the large
# fore/aft separation and shaft offsets; Baltimore-specific pitch is still open.
COL=collections['Underwater fittings']
for i,(y,x,z,radius) in enumerate([(-7.5438,-71.5,-4.72,2.27),(-3.6576,-87.4,-5.28,2.09),(3.6576,-87.4,-5.28,2.09),(7.5438,-71.5,-4.72,2.27)]):
 ASSEMBLY=f'shaft-{i+1}'
 rod('Propeller shaft',(x+24,y*.98,z+.4),(x,y,z),.18,'edge',vertices=20)
 for side in [-1,1]:rod('Shaft strut',(x+1.8,y,z),(x+2.8,y+side*1.65,z+2.25),.19,'antifouling',vertices=12)
 rod('Propeller hub',(x-1,y,z),(x+1,y,z),.45,'bronze',r2=.26,vertices=24)
 for blade in range(4):
  a=math.tau*blade/4
  shape=[(.32,-.12),(.9,-.45),(1.78,-.34),(2.03,.20),(1.65,.65),(.7,.51)]
  shape=[(r*radius/2.03,t*radius/2.03) for r,t in shape]
  vertices=[(x+.28*r,y+r*math.cos(a)-tangent*math.sin(a),z+r*math.sin(a)+tangent*math.cos(a)) for r,tangent in shape]
  mesh('Propeller blade',vertices,[tuple(range(len(vertices)))],'bronze')
ASSEMBLY='rudder'
# Traced class rudder silhouette: about 21 ft bottom chord, with the balanced
# forward cut-out. The 20 7/8 in projection shown on Quincy is not silently
# equated with Baltimore's separately tabulated maximum navigational draft.
stock_x=-91.99
outline=[(-4.19,5.10),(.56,4.63),(.56,3.57),(-.64,3.57),(-.64,2.72),(2.99,2.72),(2.21,-.530225),(-4.19,-.530225)]
verts=[(stock_x+x,side*.22,z-H['draft']) for side in [-1,1] for x,z in outline]
n=len(outline)
mesh('Balanced rudder',verts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'antifouling')
rod('Rudder stock',(stock_x,0,-2.4),(stock_x,0,1.4),.32,'edge',vertices=20)
# Dated 1943 bridge plan and commissioning/profile photographs: access,
# platform support, director optics, ventilators and handling machinery.
COL=collections['Superstructure'];ASSEMBLY='superstructure-service-fittings'
fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL)
for sign in [-1,1]:
 for a,b in [((9,sign*4.8,8.25),(13,sign*4.8,10.75)),((14,sign*3.3,10.75),(18,sign*3.3,13.08)),((12.5,sign*2.55,13.1),(15.5,sign*2.55,15.35)),((-29,sign*4.8,8.3),(-25,sign*4.8,10.75))]:fit.stairs('External access stair',a,b,.72)
 fit.ladder('Aft director tower ladder',(-28.2,sign*1.65,11),(-28.2,sign*1.65,20.0),.58)
 for x,z in [(6,6.1),(-3,6.1),(-29,6.1),(-39,6.1)]:fit.door('Watertight deckhouse door',x,sign*6.45,z)
 for x in [4,8,-3,-26,-31,-35]:fit.vent('Machinery uptake grille',x,sign*5.32,9.2,1.4,1.15)
 for id in ['bridge-wings','bridge-navigation-deck','bridge-air-defense-platform','aft-platform']:
  s=S[id]
  for xx,zz in s['footprint'][::3]:
   y=-xx;x=-zz
   if y*sign>2.7:fit.knee('Gallery underside knee',x,sign*min(2.1,abs(y)*.65),y,s['baseY'],1.0)
 for x,top in [(3.8,23.2),(-15.6,22)]:
  fit.ladder('Funnel maintenance ladder',(x,sign*2.7,10.7),(x-1.25,sign*2.7,top),.6)
  fit.vent('Uptake intake',x,sign*3.12,9.05,2.0,1.25)
  # The photographed walkway wraps the oval funnel shoulder.
  pts=[(x-1+3.9*math.cos(i*math.tau/32),3.0*math.sin(i*math.tau/32)) for i in range(32)]
  for a,b in zip(pts,pts[1:]+pts[:1]):rod('Funnel handrail',(*a,top-1.4),(*b,top-1.4),.029,'edge')
COL=collections['Deck fittings'];ASSEMBLY='forecastle-and-mooring-machinery';fit.col=COL
for sign in [-1,1]:
 for x in [59,68,-62,-74,-91]:fit.reel('Mooring rope reel',x,sign*max(1.0,width(x)-2.1),deckz(x)+.08,.43,1.05)
 fit.chain('Bower chain',(88,sign*2,deckz(88)+.18),(96,sign*3.1,deckz(96)+.18),.34)
 for x in [67,-64]:
  y=sign*3.6;z=deckz(x)
  box('Companionway coaming',(x,y,z+.38),(1.7,.94,.76),'naval')
  box('Companionway weather cover',(x,y,z+.80),(1.85,1.03,.10),'roof')
  for dx in [-.5,.5]:rod('Hatch hinge',(x+dx,y-.3,z+.86),(x+dx,y+.3,z+.86),.042,'edge')
COL=collections['Aircraft handling'];ASSEMBLY='aircraft-handling-machinery';fit.col=COL
for sign in [-1,1]:
 fit.reel('Crane hoist drum',-96.4,sign*7.1,7.5,.4,1.15)
 fit.ladder('Crane tower ladder',(-97,sign*7.6,8),(-95.6,sign*7.6,15.5),.44)
 fit.ring('Crane lifting hook',(-82.1,sign*7.1,11.45),.20,.045,'y',segments=14)
 for x in [-89,-85,-81,-77]:
  for dy in [-.35,.35]:fit.ring('Catapult trolley roller',(x,sign*4.7+dy,8.1),.115,.035,'y',segments=10)
 for i,x in enumerate([-93,-89,-85,-81,-77,-73]):
  box('Hangar hatch cross seam',(x,0,6.89),(.045,5.5,.035),'edge')
COL=collections['Light AA'];ASSEMBLY='aa-service-fittings';fit.col=COL
for x,y,z in [(45,7.5,6.1),(26,8.1,8),(-28,8,7.9),(-50,7.1,5.8),(-68,7.1,6)]:
 for sign in [-1,1]:
  fit.knee('40 mm platform supporting web',x,sign*(y-2),sign*(y+1.8),z-.2,1.1)
  fit.reel('40 mm training handwheel',x-.72,sign*y,z+.35,.17,.25)
  for dx in [-1.2,1.2]:
   box('40 mm ready-service locker',(x+dx,sign*(y-1.0),z+.38),(.64,.52,.74),'naval')
   box('Ready-service locker lid',(x+dx,sign*(y-1.0),z+.77),(.70,.58,.07),'roof')
# Named simulation volumes are retained in Blender and excluded from exports.
COL=collections['Simulation volumes']
for group in ['armor','modules','compartments','obstructions']:
 for v in D[group]:
  ASSEMBLY=v['id'];x,y,z=v['center'];sx,sy,sz=v['size']
  ob=box(group+'.'+v['id'],(-z,-x,y),(sz,sx,sy),'dark');ob['exportRole']='simulation';ob.display_type='WIRE';ob.hide_render=True
scene['definitionHash']=D['contentHash']
scene['historicalConfiguration']=D['configuration']
scene['accuracyStatus']='Under review: see the source and discrepancy registers'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('Baltimore original recipe:',len(scene.objects),'objects; source saved')

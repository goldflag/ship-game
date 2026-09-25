"""Original USS Baltimore reconstruction, October 1943 fit, on hull lines, deckhouses and mount stations measured
from the approved GameModels3D pasc108 model (see authoring/ and the README). No reference mesh or texture is read.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up.
The shared exporter owns the sole basis conversion.
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
from blender_supports import SupportSurface
from blender_rig import radar_pivot
from blender_fidelity import authored_hull, authored_structure, Fittings, loft_breadth
sys.path.insert(0,str(ROOT/'assets/parts'))
from aa_articulation import articulate_aa
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
colors['wood_deck']=colors['roof']
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

def perimeter_wall(name,outline,z,height=.88,thickness=.055,skip=None):
 # Thin independent splinter plates leave the actual platform surface visible. A gallery that ends against
 # its house has no plate across that end (skip 'aft' or 'fore').
 aft=min(p[0] for p in outline);fore=max(p[0] for p in outline)
 for i,(a,b) in enumerate(zip(outline,outline[1:]+outline[:1])):
  ax,ay=a;bx,by=b;length=math.hypot(bx-ax,by-ay)
  if length<.02:continue
  if skip=='aft' and max(ax,bx)<aft+.05:continue
  if skip=='fore' and min(ax,bx)>fore-.05:continue
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
hull.data.materials.append(materials['wood_deck'])
for face in hull.data.polygons:
 if face.normal.z>.96:face.material_index=len(hull.data.materials)-1
S={s['id']:s for s in D['structures']}
# Articulated main and secondary mounts are generated through the shared catalog.
COL=collections['Main and secondary batteries']
for mount in D['mounts']:
 if mount['partId']=='us-40mm-bofors-baltimore-quad':continue
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
DECK=6.26
# Blueprint deckhouses, gallery decks and their splinter bulwarks. Outlines and heights are measured on the
# approved GameModels3D pasc108 model (see authoring/author-structures.py).
COL=collections['Superstructure']
GALLERIES={'bridge-03-deck':(1.25,'aft'),'bridge-04-deck':(1.45,'aft'),'bridge-navigation-deck':(1.4,'aft'),'aft-platform':(1.0,None),'aft-deckhouse-tail':(1.0,'fore')}
COVERED={'conning-tower','forward-upper-deck','bridge-lower','bridge-flag','aft-deckhouse'}
for s in D.get('structures',[]):
 if s['id'] in ['forward-funnel','after-funnel'] or s['id'].startswith('aa-platform'):continue
 ASSEMBLY=s['id'];outline=[(-z,-x) for x,z in s['footprint']]
 authored_structure(s,mesh,materials,COL)
 if s['height']>.5 and s['id'] not in COVERED:prism(s['name']+' deck rim',outline,s['baseY']+s['height'],.075,'roof')
 if s['id'] in GALLERIES:perimeter_wall(s['name'],outline,s['baseY']+s['height'],GALLERIES[s['id']][0],skip=GALLERIES[s['id']][1])
structure_support=SupportSurface([hull,*COL.objects]);funnel_shells={}
def wall(x,z,sign,reach=14):
 """Half-breadth of the outboard face of the superstructure at authoring x and height z on side sign (+1 port)."""
 return abs(structure_support.along((x,sign*reach,z),(0,-sign,0),reach).y)
# Oval stacks above the uptake casings: the fore face rakes aft, the top carries a raked smoke hood.
# (base centre z, top centre z, base half-breadth, base half-length, top half-breadth, top half-length, base,
#  top, hood rise, walkway height, walkway overhang abeam and aft, walkway arc)
FUNNELS={'forward-funnel':(-2.11,-1.625,1.5,2.66,1.6,2.425,15.10,22.8,1.75,18.5,1.45,.8,(40,320)),
 'after-funnel':(16.54,16.9,1.5,2.76,1.4,2.45,15.80,21.8,1.35,19.8,.55,.55,(0,360))}
def stack_ring(c0,c1,rx0,rz0,rx1,rz1,base,top,z,grow=0,n=36,growx=None,arc=(0,360)):
 t=(z-base)/(top-base);c=c0+(c1-c0)*t;rx=rx0+(rx1-rx0)*t+(grow if growx is None else growx);rz=rz0+(rz1-rz0)*t+grow
 a0,a1=[math.radians(v) for v in arc];full=arc==(0,360);m=n if full else n+1
 return [(-c+rz*math.cos(a0+(a1-a0)*i/n),rx*math.sin(a0+(a1-a0)*i/n),z) for i in range(m)]
for name,(c0,c1,rx0,rz0,rx1,rz1,base,top,rise,walk,wx,wz,arc) in FUNNELS.items():
 ASSEMBLY=name
 # Author the identified shell first so the rigid export bucket retains its ID.
 funnel_shells[name]=authored_structure(S[name],mesh,materials,COL)
 X1=-c1
 ellipse(name+' cap band',X1,0,top-.1,rz1+.08,rx1+.08,.3,'edge')
 # Raked cowl: the casing continues above the stack top as a smoke hood whose top rises toward the fore edge,
 # narrowing a little; a grating covers its sloped top.
 n=32;back=X1-rz1;span=2*rz1
 lift=lambda x:top+.45+rise*(x-back)/span
 lower=[(X1+rz1*math.cos(math.tau*i/n),rx1*math.sin(math.tau*i/n)) for i in range(n)]
 upper=[(X1+.25+rz1*.86*math.cos(math.tau*i/n),rx1*.94*math.sin(math.tau*i/n)) for i in range(n)]
 v=[(x,y,top-.02) for x,y in lower]+[(x,y,lift(x)) for x,y in upper]
 mesh(name+' smoke hood',v,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'naval')
 mesh(name+' smoke hood grating',[(x,y,lift(x)+.01) for x,y in upper],[tuple(range(n))],'dark')
 for i in range(1,8):
  xx=X1+.25-rz1*.86+2*rz1*.86*i/8;half=rx1*.94*math.sqrt(max(0,1-((xx-X1-.25)/(rz1*.86))**2))
  rod(name+' hood bar',(xx,-half,lift(xx)+.05),(xx,half,lift(xx)+.05),.035,'edge',vertices=6)
 rim=[(x,y,lift(x)+.02) for x,y in upper]
 for a,b in zip(rim,rim[1:]+rim[:1]):rod(name+' hood rim',a,b,.04,'edge',vertices=6)
 # Bands, the funnel walkway and its handrail, ladders and the steam pipes on the after face.
 for z in [base+1.2,(base+top)/2+.9,top-.9]:
  pts=stack_ring(c0,c1,rx0,rz0,rx1,rz1,base,top,z,.02,32)
  for a,b in zip(pts,pts[1:]+pts[:1]):rod('Stack band',a,b,.028,'edge',vertices=6)
 inner=stack_ring(c0,c1,rx0,rz0,rx1,rz1,base,top,walk,-.02,32,arc=arc);outer=stack_ring(c0,c1,rx0,rz0,rx1,rz1,base,top,walk,wz,32,wx,arc)
 k=len(inner);closed=arc==(0,360)
 mesh(name+' walkway',inner+outer,[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k if closed else k-1)],'roof')
 rail=stack_ring(c0,c1,rx0,rz0,rx1,rz1,base,top,walk+1.0,wz-.03,32,wx-.03,arc)
 for a,b in zip(rail,rail[1:]+(rail[:1] if closed else [])):rod('Funnel handrail',a,b,.029,'edge',vertices=6)
 for p in rail[::4]:rod('Funnel handrail stanchion',(p[0],p[1],walk),p,.025,'edge',vertices=6)
 for p,q in zip(inner[::8],outer[::8]):rod('Walkway bracket',(p[0],p[1],walk-.9),(q[0],q[1],walk-.02),.05,'naval',vertices=6)
 for sign in [-1,1]:
  fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL)
  fit.ladder('Funnel maintenance ladder',(-c0-.9,sign*(rx0*.95+.1),base),(-c1-.9,sign*(rx1*.95+.1),top),.5)
  rod('Funnel steam pipe',(-(c0+rz0*.97)-.12,sign*.35,base),(-(c1+rz1*.97)-.12,sign*.35,top+.7),.11,'naval',vertices=10)
# Uptake casings: grilles near the top of each side, and the handrail round the casing shelf.
fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL)
for casing,xs,z in [('forward-funnel-casing',[.6,1.9,3.2,4.5],13.9),('after-funnel-casing',[-14.8,-16.0,-17.2,-18.4],14.6)]:
 ASSEMBLY=casing
 for sign in [-1,1]:
  for x in xs:fit.vent('Uptake grille',x,sign*3.72,z,1.0,.8)
 s=S[casing];top=s['baseY']+s['height']
 ring=[(v[0],v[2]) for v in s['surface']['vertices'][len(s['footprint']):]] if s.get('surface') else s['footprint']
 outline=[(-zz,-xx) for xx,zz in ring]
 for a,b in zip(outline[::2],outline[2::2]+outline[:1]):
  for h in [.55,1.0]:rod('Casing handrail',(*a,top+h),(*b,top+h),.024,'edge',vertices=5)
  rod('Casing stanchion',(*a,top),(*a,top+1.0),.024,'edge',vertices=5)
# Guard rails round the open 01 roofs, left off where a 5-inch sponson's gunhouse sweeps the edge and where the
# next house stands on the edge.
SWEPT=[Vector((-m['position'][2],-m['position'][0],0)) for m in D['mounts'] if m['battery'] in ('main','secondary') and not m['partId'].startswith('us-40mm')]
def roof_rail(id,keep,clear=3.9):
 global ASSEMBLY
 ASSEMBLY=id;s=S[id];top=s['baseY']+s['height'];pts=s['footprint']
 swept=lambda p:any((Vector((p.x,p.y,0))-c).length<clear for c in SWEPT)
 for (x0,z0),(x1,z1) in zip(pts,pts[1:]+pts[:1]):
  if not keep(x0,z0,x1,z1):continue
  a=Vector((-z0,-x0,top));b=Vector((-z1,-x1,top));n=max(1,math.ceil((b-a).length/1.6))
  for i in range(n):
   p,q=a.lerp(b,i/n),a.lerp(b,(i+1)/n)
   if swept(p) or swept(q):continue
   for r in [p,q]:rod('Roof rail stanchion',r,r+Vector((0,0,1.0)),.024,'edge',vertices=5)
   for h in [.5,1.0]:rod('Roof guard rail',p+Vector((0,0,h)),q+Vector((0,0,h)),.02,'edge',vertices=5)
roof_rail('forward-deckhouse',lambda x0,z0,x1,z1:min(abs(x0),abs(x1))>=3.3 and max(abs(x0),abs(x1))<=7.2 and not (abs(x0)>=7.0 and abs(x1)>=7.0))
roof_rail('after-funnel-base',lambda x0,z0,x1,z1:min(abs(x0),abs(x1))>=4.5)
roof_rail('aft-deckhouse-front',lambda x0,z0,x1,z1:min(abs(x0),abs(x1))>=4.0 and abs(z0-z1)>1)
ASSEMBLY='conning-tower'
for sign in [-1,1]:
 for x in [22.2,23.4,24.3]:box('Conning tower vision slit',(x,sign*wall(x,12.1,sign),12.1),(.5,.06,.14),'dark')
# Round scuttles on the bridge house fronts, as the reference paints them.
for id,z,count in [('bridge-lower',14.3,7),('bridge-flag',16.75,7)]:
 ASSEMBLY=id;pts=[(-zz,-xx) for xx,zz in S[id]['footprint']];front=max(p[0] for p in pts)
 for i in range(count):
  a=math.pi*(.18+.64*i/(count-1));y=math.cos(a)*2.4
  sign=1 if y>=0 else -1;hit=structure_support.along((front+2,y,z),(-1,0,0),6)
  rod('Bridge scuttle',(hit.x+.01,y,z),(hit.x+.06,y,z),.2,'glass',vertices=14)
  rod('Scuttle rim',(hit.x-.01,y,z),(hit.x+.04,y,z),.25,'edge',vertices=14)
# Directors: Mk 34 (8-inch) and Mk 37 (5-inch) at the reference stations, with the 1943 Mk 8 and Mk 4 arrays.
COL=collections['Sensors and masts']
director_support=SupportSurface([hull,*collections['Superstructure'].objects])
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
 floor=director_support.below(x,0,z)
 if z-floor>.015:cyl(id+' station foundation',(x,0,(floor+z)/2),1.32 if main else 1.15,z-floor+.02,'naval',vertices=32)
 cyl(id+' base',(x,0,z+.18),1.32 if main else 1.2,.36,'edge',vertices=32)
 before=set(scene.objects)
 if main:
  ellipse(id+' Mk 34 shield',x,0,z+.36,1.6,1.3,1.35)
  ellipse(id+' Mk 34 roof',x,0,z+1.71,1.55,1.25,.06,'roof')
 else:
  # The Mk 37 housing is rectangular with chamfered fore corners; its round support is separate.
  pts=[(x-1.95,-1.35),(x+1.2,-1.35),(x+1.55,-1.0),(x+1.55,1.0),(x+1.2,1.35),(x-1.95,1.35)]
  prism(id+' Mk 37 housing',pts,z+.36,1.95)
  prism(id+' Mk 37 roof',pts,z+2.31,.06,'roof')
  for y in [-.65,.65]:box(id+' telescope port',(x+1.575,y,z+1.7),(.035,.5,.42),'glass')
 half=2.92 if main else 2.39;rfz=z+(.95 if main else 1.5)
 rod(id+' rangefinder',(x,-half,rfz),(x,half,rfz),.23,'naval',vertices=16)
 for y in [-half,half]:box(id+' rangefinder hood',(x,y,rfz),(.7,.44,.7),'naval')
 if main:
  radar_grid(id+' Mk 8 antenna',x,0,z+2.75,2.75,1.05)
  # Mk 8 array is carried on the Mk 34 roof, as in the dated Navy profiles.
  for y in [-.65,.65]:rod(id+' Mk 8 aerial support',(x,y,z+1.75),(x,y,z+2.75),.075,'naval',vertices=10)
 else:
  radar_grid(id+' Mk 4 antenna',x,0,z+3.55,2.75,1.65)
  for y in [-.70,.70]:rod('Mk 4 aerial support',(x-.45,y,z+2.37),(x,y,z+3.5),.07,'edge')
 radar_pivot(id+'.yaw',(x,0,z+.36),set(scene.objects)-before)
# 8-inch directors on the lower, outward stations, 5-inch directors higher and inboard (reference hardpoints).
director('forward-main-director',21.297,21.432,True)
director('after-main-director',-35.463,16.449,True)
director('forward-dp-director',13.228,23.723)
director('after-dp-director',-28.212,19.101)
# Masts on the reference axes. The foremast carries the SG at its topmast, the mainmast the SK on its
# platform (the preset's 1943 radar fit; the reference places a bedspring forward and a dish aft).
FORE=((8.66,12.62),(7.13,33.0));MAIN=((-21.9,8.70),(-23.35,29.2))
ASSEMBLY='foremast'
(fx0,fz0),(fx1,fz1)=FORE
rod('foremast pole',(fx0,0,fz0),(fx1,0,fz1+.4),.32,'naval',r2=.2,vertices=16)
for side in [-1,1]:rod('foremast leg',(fx0+2.2,side*2.0,15.10),(fx0-.3,0,fz0+6.5),.13,'naval',r2=.1,vertices=10)
box('Foremast platform',(5.8,0,33.1),(5.4,3.0,.12),'roof')
for a,b in [((3.1,-1.5),(8.5,-1.5)),((8.5,-1.5),(8.5,1.5)),((8.5,1.5),(3.1,1.5)),((3.1,1.5),(3.1,-1.5))]:
 for h in [.5,1.0]:rod('Foremast platform rail',(*a,33.16+h),(*b,33.16+h),.022,'edge',vertices=5)
 for t in [0,.5]:p=Vector(a).lerp(Vector(b),t);rod('Foremast platform stanchion',(p.x,p.y,33.1),(p.x,p.y,34.18),.025,'edge',vertices=5)
for x in [3.3,8.3]:
 for y in [-1.4,1.4]:rod('Foremast platform bracket',(x,y,33.05),(fx1+(x-fx1)*.25,0,31.6),.05,'naval',vertices=6)
rod('foremast topmast',(4.2,0,33.1),(4.2,0,39.0),.14,'naval',r2=.07,vertices=12)
pole_x=lambda z:fx0+(fx1-fx0)*(z-fz0)/(fz1-fz0)
for z,half in [(31.6,5.76),(24.7,4.94)]:
 x=pole_x(z)
 rod('foremast yard',(x,-half,z),(x,half,z),.09,'naval',r2=.055,vertices=12)
 for side in [-1,1]:rod('foremast yard brace',(pole_x(z+2.2),0,z+2.2),(x,side*half*.8,z),.033,'edge',vertices=6)
before=set(scene.objects)
box('SG radar scanner',(4.2,0,39.1),(.42,1.35,.35),'naval')
radar_pivot('radar-sg.yaw',(4.2,0,39.1),set(scene.objects)-before)
rod('Forward mast top',(4.2,0,39.3),(4.2,0,39.9),.025,'edge',vertices=6)
for side in [-1,1]:rod('Signal halyard',(pole_x(31.6),side*5.2,31.6),(11.5,side*2.4,17.4),.012,'edge',vertices=5)
ASSEMBLY='mainmast'
(mx0,mz0),(mx1,mz1)=MAIN
rod('mainmast pole',(mx0,0,mz0),(mx1,0,mz1+.3),.45,'naval',r2=.25,vertices=16)
main_x=lambda z:mx0+(mx1-mx0)*(z-mz0)/(mz1-mz0)
for side in [-1,1]:rod('mainmast leg',(-20.0,side*2.6,8.70),(mx0-.2,0,mz0+13.5),.14,'naval',r2=.1,vertices=10)
box('Mainmast platform',(-23.2,0,29.2),(6.6,3.0,.12),'roof')
for a,b in [((-19.9,-1.5),(-26.5,-1.5)),((-26.5,-1.5),(-26.5,1.5)),((-26.5,1.5),(-19.9,1.5)),((-19.9,1.5),(-19.9,-1.5))]:
 for h in [.5,1.0]:rod('Mainmast platform rail',(*a,29.26+h),(*b,29.26+h),.022,'edge',vertices=5)
 for t in [0,.5]:p=Vector(a).lerp(Vector(b),t);rod('Mainmast platform stanchion',(p.x,p.y,29.2),(p.x,p.y,30.28),.025,'edge',vertices=5)
for x in [-20.2,-26.2]:
 for y in [-1.4,1.4]:rod('Mainmast platform bracket',(x,y,29.15),(mx1+(x-mx1)*.25,0,27.6),.05,'naval',vertices=6)
rod('mainmast topmast',(-21.2,0,29.2),(-21.2,0,35.8),.13,'naval',r2=.06,vertices=12)
rod('mainmast yard',(main_x(28.0),-4.9,28.0),(main_x(28.0),4.9,28.0),.08,'naval',r2=.05,vertices=12)
for side in [-1,1]:rod('mainmast yard brace',(main_x(29.2),0,29.2),(main_x(28.0),side*4.0,28.0),.033,'edge',vertices=6)
before=set(scene.objects)
radar_grid('SK search array',-25.1,0,31.35,4.9,3.1)
for y in [-.8,.8]:rod('SK pedestal',(-25.1,y,29.26),(-25.1,y,29.8),.08,'naval',vertices=8)
radar_pivot('radar-sk.yaw',(-25.1,0,29.26),set(scene.objects)-before)
rod('Main aerial',(4.2,0,39.2),(-21.2,0,35.6),.013,'edge',vertices=5)
# Aircraft handling: two catapults on turntables at the reference quarter stations, stern cranes whose jibs
# stow forward and outboard, and the hangar hatch.
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
CAT_X=-79.48;CAT_Y=6.6
for side in [-1,1]:
 ASSEMBLY='catapult-port' if side>0 else 'catapult-starboard'
 y=side*CAT_Y;floor=deckz(CAT_X)
 cyl('Catapult pedestal',(CAT_X,y,(floor+7.83)/2),1.05,7.83-floor,'naval',vertices=24)
 lattice('Powder catapult',(-90.4,y,8.2),(-69.1,y,8.2),1.05,.75)
 for dy in [-.35,.35]:rod('Catapult rail',(-90.4,y+dy,8.6),(-69.1,y+dy,8.6),.055,'edge')
 box('Aircraft launch trolley',(-80.2,y,8.72),(1.5,1.5,.24),'edge')
 ASSEMBLY='crane-port' if side>0 else 'crane-starboard'
 y=side*5.45;floor=deckz(-98.4);tip=(-88.2,side*8.3,15.8)
 cyl('Aircraft crane foundation',(-98.4,y,floor+.4),.95,.8,'naval',vertices=24)
 lattice('Crane tower',(-98.4,y,floor+.8),(-96.6,y,13.0),.95,.95)
 lattice('Crane boom',(-96.6,y,13.0),tip,.75,.75)
 rod('Crane backstay',(-98.4,y,floor+.8),(-96.6,y,14.5),.055,'edge')
 rod('Crane boom cable',(-96.6,y,14.5),tip,.026,'edge',vertices=6)
 rod('Crane hook cable',tip,(tip[0],tip[1],11.5),.025,'edge',vertices=6)
 cyl('Crane sheave',(tip[0],tip[1],tip[2]-.05),.21,.15,'edge',vertices=16)
 box('Crane winch',(-97.6,y,floor+.4),(1.4,1.3,.8),'naval')
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
aircraft('kingfisher-port',-80.2,CAT_Y,10.86)
aircraft('kingfisher-starboard',-80.2,-CAT_Y,10.86)
# Quad Bofors retain their original fittings with independent combat joints.
# The smaller single 20 mm guns remain visual equipment.
COL=collections['Light AA']
aa_support=SupportSurface([hull,*collections['Superstructure'].objects])
def tub(name,x,y,z,r,height=.95,start=0,end=math.tau):
 n=40;vv=[(x+rad*math.cos(start+(end-start)*j/n),y+rad*math.sin(start+(end-start)*j/n),zz) for rad,zz in [(r,z),(r,z+height),(r-.065,z+height),(r-.065,z)] for j in range(n+1)]
 step=n+1;ff=[]
 for strip in range(3):
  for j in range(n):ff.append((strip*step+j,strip*step+j+1,(strip+1)*step+j+1,(strip+1)*step+j))
 return mesh(name,vv,ff,'naval')
def bofors(mount):
 global ASSEMBLY
 ASSEMBLY=mount['id'];w=mount['weapon'];px,pz,py=mount['position'];x,y,z=-py,-px,pz
 # Keep the repaired stationary foundation outside the aiming hierarchy.
 # The stern quad stands off the centreline of its round sponson, as on the reference.
 tx,ty=TUB_CENTRE.get(mount['id'],(x,y))
 floor=aa_support.below(x,y,z+.5)
 if z-.20-floor>.015:cyl(ASSEMBLY+' fixed foundation',(tx,ty,(floor+z-.20)/2),1.9,z-.20-floor+.02,'naval',vertices=32)
 cyl('40 mm gun tub deck',(tx,ty,z-.10),2.6,.20,'roof',vertices=40)
 tub('40 mm splinter shield',tx,ty,z,2.58,.94)
 frame=[cyl('Bofors pedestal',(0,0,.36),.50,.72,'edge',vertices=20),
        box('Bofors carriage',(0,0,.9),(1.1,1.95,.8),'naval')]
 for lateral in [-1.0,1.0]:
  frame.append(rod('Bofors seat bracket',(0,lateral*.45,.42),(-.78,lateral,.76),.06,'naval',vertices=8))
  frame.append(box('Bofors seat',(-.78,lateral,.8),(.37,.34,.08),'canvas'))
 barrels=[];elevation=math.radians(1);direction=Vector((math.cos(elevation),0,math.sin(elevation)))
 for i in range(w['barrelCount']):
  lateral=((w['barrelCount']-1)/2-i)*w['barrelSpacing']
  start=Vector((w['trunnionForward'],lateral,w['pivotHeight']));tip=start+direction*(w['muzzleForward']-w['trunnionForward'])
  barrel=rod('40 mm barrel',start,tip,.057,'edge',r2=.038,vertices=10)
  breech=box('40 mm breech',start-direction*.65+Vector((0,0,-.1)),(.9,.23,.35),'edge');breech.rotation_euler.y=-elevation
  clip=box('40 mm clip guide',start-direction*.58+Vector((0,0,.24)),(.32,.20,.38),'naval');clip.rotation_euler.y=-elevation
  barrels.append([barrel,breech,clip])
 articulate_aa(mount,COL,frame,barrels)
TUB_CENTRE={'bofors-12':(-101.3,0)}
for mount in D['mounts']:
 if mount['partId']=='us-40mm-bofors-baltimore-quad':bofors(mount)
# Mk 51 director tubs on the after 04 platform wings (the directors themselves are not in the preset's fit).
ASSEMBLY='aft-04-platform'
for side in [-1,1]:tub('Director tub',-24.37,side*3.1,17.30,.85,1.0)
# Twenty-four single 20 mm at the reference stations (23 of them hardpoints; the 24th pairs the one on the
# after deckhouse tail), in splinter tubs; where the reference raises one on a pedestal, a pedestal carries it.
OERLIKONS=[(-94.38,1.705,8.727),(-35.17,1.419,8.69),(-28.19,5.40,8.69),(-26.09,5.844,8.69),(-1.13,8.985,8.973),
 (12.19,9.249,8.973),(22.60,8.477,6.239),(25.33,8.477,6.239),(23.57,3.766,13.043),(31.13,2.96,13.037),(38.45,1.1,11.775),(66.57,7.779,6.344)]
for i,(k,side) in enumerate([(k,side) for k in range(len(OERLIKONS)) for side in [-1,1]]):
 zr,xr,hp=OERLIKONS[k];ASSEMBLY=f'oerlikon-{i+1:02}';x=-zr;y=side*xr;floor=aa_support.below(x,y,hp+.3)
 if hp-floor>.2:
  cyl('Oerlikon pedestal',(x,y,(floor+hp)/2),.75,hp-floor,'naval',vertices=20)
  cyl('Oerlikon platform',(x,y,hp-.05),1.05,.1,'roof',vertices=24)
 z=max(floor,hp-.05) if hp-floor>.2 else floor
 tub('Oerlikon splinter tub',x,y,z,1.0,.95)
 cyl('Oerlikon stand',(x,y,z+.56),.14,1.12,'naval',vertices=14)
 cyl('Oerlikon base',(x,y,z+.05),.33,.1,'edge',vertices=16)
 rod('Oerlikon cradle',(x,y,z+1.05),(x,y,z+1.28),.11,'naval',vertices=12)
 rod('Oerlikon receiver',(x-.08,y-side*.22,z+1.18),(x+.08,y+side*.27,z+1.38),.085,'naval',vertices=10)
 rod('20 mm barrel',(x,y,z+1.25),(x+.27,y+side*.92,z+1.6),.026,'edge',vertices=8)
 shield=box('Oerlikon shield',(x,y+side*.35,z+1.06),(.85,.055,.67),'naval');shield.rotation_euler.z=-side*.27
 for dx in [-.25,.25]:rod('Oerlikon shield bracket',(x,y,z+.85),(x+dx,y+side*.35,z+.87),.033,'naval',vertices=8)
 rod('20 mm drum',(x-.08,y,z+1.42),(x+.15,y,z+1.42),.18,'dark',vertices=14)
# Deck fittings and railing use per-assembly meshes, retaining logical ownership.
COL=collections['Deck fittings']
STEM_BULWARK=80.0
for side in [-1,1]:
 ASSEMBLY='hull-rails-port' if side>0 else 'hull-rails-starboard'
 points=[]
 for i in range(111):
  x=-L/2+.8+(L-1.6)*i/110;y=side*max(.08,width(x)-.18);z=deckz(x)+.005
  if x>STEM_BULWARK:continue
  points.append((x,y,z))
  rod('Rail stanchion',(x,y,z),(x,y,z+1.0),.022,'naval',vertices=6)
 for a,b in zip(points,points[1:]):
  if b[0]-a[0]>3:continue
  for h in [.35,.68,1.0]:rod('Guardrail',(a[0],a[1],a[2]+h),(b[0],b[1],b[2]+h),.012,'naval',vertices=5)
 # The forecastle bulwark: the shell plating continues above the deck from the stem to abreast the anchors.
 ASSEMBLY='hull'
 xs=[STEM_BULWARK+(L/2-STEM_BULWARK)*i/60 for i in range(61)]
 # Its top runs about 1.1 m above the deck and sweeps up to the stem head at 9.9 m.
 top=lambda x:deckz(x)+interp([(STEM_BULWARK,0),(STEM_BULWARK+2.5,1.1),(92.0,1.15),(99.1,1.3),(L/2,9.92-deckz(L/2))],x)
 ring=[]
 for x in xs:
  w=width(x);d=deckz(x)-.05;t=top(x);o=w+.22*(t-d);k=min(1,max(0,(L/2-x)/.6))
  ring.append([(x,side*w,d),(x,side*o,t),(x,side*max(0,o-.08*k),t),(x,side*max(0,w-.08*k),d)])
 v=[p for r in ring for p in r];f=[]
 for j in range(len(ring)-1):
  for k in range(3):f.append((j*4+k,j*4+k+1,(j+1)*4+k+1,(j+1)*4+k))
 f.append((0,1,2,3))
 mesh('Forecastle bulwark',v,f,'hullgray')
 ASSEMBLY='hull-openings-port' if side>0 else 'hull-openings-starboard'
 for x in range(-75,81,4):
  for z in [3.15,4.25]:
   if z>deckz(x)-.5:continue
   y=side*(loft_breadth(H,x,z)-.025)
   rod('Scuttle rim',(x,y,z),(x,y+side*.035,z),.13,'naval',vertices=16)
   rod('Scuttle glass',(x,y+side*.04,z),(x,y+side*.045,z),.087,'glass',vertices=14)
 for x in [-92,-64,-42,62,86]:
  ASSEMBLY='mooring-fittings';y=side*max(.6,width(x)-1.4);z=deckz(x)
  box('Bollard bed',(x,y,z+.1),(1.2,.7,.2),'roof')
  for dx in [-.32,.32]:cyl('Bollard',(x+dx,y,z+.42),.15,.6,'edge',vertices=16)
 # Two 26-foot motor whaleboats stowed at the deck edge between the funnels, under the 40 mm tubs.
 ASSEMBLY='boats';x=-5.67;y=side*9.35;floor=deckz(x)
 Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL).boat('26-foot motor whaleboat',x,y,7.5,7.92,2.04,False)
 for dx in [-2.14,2.06]:
  for dy in [-.55,.55]:rod('Boat cradle post',(x+dx,y+dy,floor),(x+dx,y+dy,7.35),.07,'naval',vertices=8)
 for dx in [-3.13,3.13]:
  rod('Boat davit',(x+dx,side*(width(x)-.15),floor),(x+dx,side*(width(x)+.05),9.6),.1,'naval',vertices=10)
  rod('Boat davit arm',(x+dx,side*(width(x)+.05),9.6),(x+dx,side*9.35,10.0),.08,'naval',vertices=10)
  rod('Boat fall',(x+dx,side*9.35,10.0),(x+dx*.8,side*9.35,8.2),.02,'edge',vertices=5)
 for x,yy,base in [(22.3,4.0,None),(22.3,4.6,None),(24.3,4.0,None),(24.3,4.6,None),(-13.9,4.15,None),(-13.9,4.7,None)]:
  ASSEMBLY='life-rafts';yy=side*yy;z=aa_support.below(x,yy,11)+.12
  # Elliptical raft perimeter made of original tubular pieces.
  pts=[(x+1.05*math.cos(i*math.tau/20),yy+.27*math.sin(i*math.tau/20),z) for i in range(21)]
  for a,b in zip(pts,pts[1:]):rod('Carley float',a,b,.11,'canvas',vertices=8)
  for dx in [-.5,0,.5]:rod('Raft grating',(x+dx,yy-.18,z),(x+dx,yy+.18,z),.025,'edge',vertices=6)
# Ground tackle: capstans abaft the hawses, chain runs, breakwaters, vents and deck hatches.
ASSEMBLY='forecastle-ground-tackle'
fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL)
for side in [-1,1]:
 y=side*2.76;x=79.25;z=deckz(x)
 cyl('Anchor capstan',(x,y,z+.4),.5,.8,'edge',vertices=24)
 cyl('Capstan head',(x,y,z+.85),.58,.12,'naval',vertices=24)
 fit.chain('Bower chain',(x+.6,y,z+.18),(91.3,side*(width(91.3)-.35),deckz(91.3)+.18),.34)
 # Stockless bower anchor housed in its hawse at the flare: shank, crown and two flukes, and the hawse lip.
 hx=92.1;d=deckz(hx);hy=side*(loft_breadth(H,hx,d-.9)+.12)
 rod('Hawse pipe lip',(hx+.35,hy-side*.08,d-.25),(hx+.35,hy+side*.02,d-.25),.32,'edge',vertices=16)
 rod('Anchor shank',(hx+.35,hy,d-.25),(hx-.55,hy,d-1.9),.11,'edge',vertices=8)
 box('Anchor crown',(hx-.6,hy,d-2.0),(.5,.3,.3),'edge')
 for dx in [-1,1]:
  mesh('Anchor fluke',[(hx-.6+dx*.2,hy-side*.1,d-2.05),(hx-.6+dx*.95,hy-side*.1,d-1.55),(hx-.6+dx*.6,hy-side*.1,d-1.25),
   (hx-.6+dx*.2,hy+side*.12,d-2.05),(hx-.6+dx*.95,hy+side*.12,d-1.55),(hx-.6+dx*.6,hy+side*.12,d-1.25)],
   [(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'edge')
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
# Four staggered screws on the reference shaft stations, the balanced rudder, the centreline skeg and the
# bilge keels.
COL=collections['Underwater fittings']
hull_support=SupportSurface([hull])
for i,(y,x,z,radius) in enumerate([(-7.02,-71.38,-5.17,1.64),(-3.49,-86.5,-5.17,1.64),(3.49,-86.5,-5.17,1.64),(7.02,-71.38,-5.17,1.64)]):
 ASSEMBLY=f'shaft-{i+1}'
 rod('Propeller shaft',(x+24,y*.98,z+.4),(x,y,z),.18,'edge',vertices=20)
 # A V bracket just ahead of the screw, each arm carried up to the shell.
 sx=x+2.1;sz=z+.4*2.1/24
 inboard=-1 if y>0 else 1
 for dy,dz in [(.25,1),(1.1,1.6)]:
  d=Vector((0,inboard*dy,dz)).normalized();hit=hull_support.along((sx,y,sz),d,8)
  rod('Shaft strut',(sx,y,sz),tuple(hit+d*.12),.17,'antifouling',vertices=12)
 cyl('Strut boss',(sx,y,sz),.3,.9,'antifouling',vertices=16).rotation_euler.y=math.pi/2
 rod('Propeller hub',(x-.8,y,z),(x+.8,y,z),.38,'bronze',r2=.22,vertices=24)
 # Four pitched blades (pitch ratio about 1.1), handed outward, with an elliptical outline.
 hand=1 if y>0 else -1;pitch=1.1*2*radius;centre=Vector((x,y,z))
 R=[.22,.36,.5,.64,.78,.9,1.0];C=[.30,.42,.50,.52,.48,.38,.10]
 for blade in range(4):
  a=math.tau*blade/4+.4;u=Vector((0,math.cos(a),math.sin(a)));w=Vector((0,-math.sin(a),math.cos(a)))
  v=[]
  for rr,cc in zip(R,C):
   r=rr*radius;c=cc*radius;phi=math.atan(pitch/(math.tau*r));t=.05*(1.15-rr)
   chord=(w*math.cos(phi)*hand+Vector((1,0,0))*math.sin(phi)).normalized();normal=chord.cross(u).normalized()
   mid=centre+u*r+w*(.1*radius*rr*rr*hand)
   le=mid+chord*c*.5;te=mid-chord*c*.4
   v+=[tuple(le+normal*t*.3),tuple(te+normal*t),tuple(te-normal*t),tuple(le-normal*t*.3)]
  f=[(j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k) for j in range(len(R)-1) for k in range(4)]
  f+=[(len(v)-4,len(v)-3,len(v)-2,len(v)-1),(3,2,1,0)]
  mesh('Propeller blade',v,f,'bronze')
ASSEMBLY='rudder'
# Traced class rudder silhouette: about 21 ft bottom chord, with the balanced forward cut-out, placed on the
# reference rudder (fore edge 88.4 m, after edge 95.7 m abaft midships, foot 7.86 m below the waterline).
stock_x=-91.48
outline=[(-95.64,-2.30),(-88.44,-2.78),(-88.44,-5.0),(-89.27,-7.79),(-95.64,-7.79)]
verts=[(x,side*.18,z) for side in [-1,1] for x,z in outline]
n=len(outline)
mesh('Balanced rudder',verts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'antifouling')
rod('Rudder stock',(stock_x,0,-2.4),(stock_x,0,1.4),.32,'edge',vertices=20)
ASSEMBLY='hull'
keel=lambda x:interp(H['keelHeights'],x+L/2)
skeg=[(x,-6.82 if x>-73.0 else -6.82+(x+73.0)/(-75.4+73.0)*2.62) for x in [-36.5+(-75.2+36.5)*i/26 for i in range(27)]]
sv=[];sf=[]
for x,bottom in skeg:
 top=keel(x)+.3
 sv+=[(x,-.21,bottom),(x,.21,bottom),(x,.21,top),(x,-.21,top)]
for j in range(len(skeg)-1):
 for k in range(4):sf.append((j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k))
sf+=[(3,2,1,0),((len(skeg)-1)*4,(len(skeg)-1)*4+1,(len(skeg)-1)*4+2,(len(skeg)-1)*4+3)]
mesh('Centreline skeg',sv,sf,'antifouling')
BILGE=[(26,8.6,-4.65),(20,8.81,-4.78),(12,8.87,-5.07),(0,8.97,-5.22),(-12,9.03,-5.17),(-20,9.03,-5.0),(-28,9.0,-4.7),(-32,8.6,-4.62)]
for side in [-1,1]:
 bv=[];bf=[]
 for j,(x,w,z) in enumerate(BILGE):
  end=j in (0,len(BILGE)-1);rz=z+.3;rw=loft_breadth(H,x,rz)-.06
  tw,tz=(rw+.15,rz-.15) if end else (w,z)
  for off in [-.05,.05]:bv+=[(x,side*(rw+off),rz+off),(x,side*(tw+off),tz+off)]
 for j in range(len(BILGE)-1):
  a=j*4;b=a+4
  bf+=[(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a+1,a+3,b+3,b+1)]
 mesh('Bilge keel',bv,bf,'antifouling')
# Access, platform support, ventilators and handling machinery on the measured superstructure.
COL=collections['Superstructure'];ASSEMBLY='superstructure-service-fittings'
fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,COL)
for sign in [-1,1]:
 # Stairs from the main deck to the 01 level, and from the 01 level to the 02 house side.
 for a,b in [((8.3,sign*3.3,DECK),(11.6,sign*3.3,8.70)),((-26.9,sign*3.55,DECK),(-23.7,sign*3.55,8.70))]:
  fit.stairs('External access stair',a,b,.72)
  # Handrail stanchions at both ends of each stringer.
  a,b=Vector(a),Vector(b);d=b-a;side=Vector((-d.y,d.x,0)).normalized()*.36
  for p in [a,b]:
   for s_ in [-1,1]:rod('External access stair stanchion',p+side*s_,p+side*s_+Vector((0,0,.9)),.028,'edge',vertices=6)
 fit.ladder('Aft director tower ladder',(-28.22,sign*1.55,15.0),(-28.22,sign*1.55,19.1),.5)
 fit.ladder('Forward director pedestal ladder',(13.18,sign*1.55,19.5),(13.18,sign*1.55,23.72),.5)
 fit.ladder('Bridge house ladder',(12.3,sign*2.72,12.70),(12.3,sign*2.72,15.1),.5)
 for x,z in [(24.0,DECK),(8.9,DECK),(13.0,8.70),(11.0,8.70),(-21.5,DECK),(-26.0,DECK),(-33.0,DECK)]:fit.door('Watertight door',x,sign*wall(x,z+1.0,sign),z)
 for x,z in [(9.8,DECK+1.2),(-34.3,DECK+1.4),(-36.3,DECK+1.4)]:fit.vent('Machinery vent',x,sign*wall(x,z,sign),z,1.4,1.1)
 for id in ['bridge-03-deck','bridge-04-deck','bridge-navigation-deck','aft-platform']:
  s=S[id]
  for xx,zz in s['footprint'][::3]:
   y=-xx;x=-zz
   if y*sign>2.9:fit.knee('Gallery underside knee',x,sign*min(2.2,abs(y)*.6),y,s['baseY'],1.0)
COL=collections['Deck fittings'];ASSEMBLY='forecastle-and-mooring-machinery';fit.col=COL
for sign in [-1,1]:
 # Clear of the forward turret's depressed barrels.
 for x in [76.5,-62,-74,-91]:fit.reel('Mooring rope reel',x,sign*max(1.0,width(x)-2.1),deckz(x)+.005,.43,1.05)
 for x in [67,-64]:
  y=sign*3.6;z=deckz(x)
  box('Companionway coaming',(x,y,z+.38),(1.7,.94,.76),'naval')
  box('Companionway weather cover',(x,y,z+.80),(1.85,1.03,.10),'roof')
  for dx in [-.5,.5]:rod('Hatch hinge',(x+dx,y-.3,z+.86),(x+dx,y+.3,z+.86),.042,'edge')
COL=collections['Aircraft handling'];ASSEMBLY='aircraft-handling-machinery';fit.col=COL
for sign in [-1,1]:
 fit.reel('Crane hoist drum',-99.4,sign*5.45,deckz(-99.4),.4,1.15)
 fit.ladder('Crane tower ladder',(-98.4,sign*5.95,deckz(-98.4)+.8),(-96.6,sign*5.95,13.0),.44)
 fit.ring('Crane lifting hook',(-88.2,sign*8.3,11.45),.20,.045,'y',segments=14)
 for x in [-87.5,-83.5,-76.5,-72.5]:
  for dy in [-.35,.35]:fit.ring('Catapult trolley roller',(x,sign*CAT_Y+dy,8.6),.115,.035,'y',segments=10)
for i,x in enumerate([-75,-73,-71,-69,-67,-65]):
 box('Hangar hatch cross seam',(x,0,6.635),(.045,9.5,.03),'edge')
COL=collections['Light AA'];ASSEMBLY='aa-service-fittings';fit.col=COL
for mount in D['mounts']:
 if mount['partId']!='us-40mm-bofors-baltimore-quad' or mount['id'] in ('bofors-01','bofors-12'):continue
 px,pz,py=mount['position'];x,y=-py,-px;sign=1 if y>0 else -1
 for dx in [-1.3,1.3]:
  yy=y-sign*3.05
  try:z=aa_support.below(x+dx,yy,pz+.2)
  except ValueError:continue
  if pz-z>2.5:continue
  box('40 mm ready-service locker',(x+dx,yy,z+.37),(.64,.52,.74),'naval')
  box('Ready-service locker lid',(x+dx,yy,z+.76),(.70,.58,.07),'roof')
# Named simulation volumes are retained in Blender and excluded from exports.
COL=collections['Simulation volumes']
for group in ['armor','modules','compartments','obstructions']:
 for v in D[group]:
  ASSEMBLY=v['id'];x,y,z=v['center'];sx,sy,sz=v['size']
  ob=box(group+'.'+v['id'],(-z,-x,y),(sz,sx,sy),'dark');ob['exportRole']='simulation';ob.display_type='WIRE';ob.hide_render=True
scene['definitionHash']=D['contentHash']
scene['historicalConfiguration']=D['configuration']
scene['accuracyStatus']='Under review: see the source and discrepancy registers'
from blender_rig import create_flagstaffs
create_flagstaffs(D)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('Baltimore original recipe:',len(scene.objects),'objects; source saved')

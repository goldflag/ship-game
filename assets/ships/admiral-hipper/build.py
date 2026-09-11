"""Original Admiral Hipper construction for the approved GameModels3D A fit.

All hull sections and structural footprints are original blueprint inputs.
No reference mesh, texture, cache or external transform is read by this recipe.
Authoring: forward +X, port +Y, up +Z; export converts to runtime once.
"""
import bpy, math, json, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
sys.path.insert(0,str(ROOT/'assets/parts'))
from blender_fidelity import authored_hull,authored_structure,Fittings
from library import create_mount
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text());OUT=Path(os.environ['SHIP_OUTPUT']);H=D['hull'];L=H['length']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='Admiral Hipper';scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world=bpy.data.worlds.new('Hipper studio');scene.world.color=(.055,.075,.095)
C={}
for name in ['Hull','Deck','Superstructure','Guns','Masts','Fittings','Underwater','Torpedoes']:
 col=bpy.data.collections.new(name);scene.collection.children.link(col);C[name]=col
COL=C['Hull'];OWNER='hull'
sys.path.insert(0,str(Path(__file__).parent/'authoring'))
from platforms import PLATFORMS
platform_ids={p[0] for p in PLATFORMS}
appearance=json.loads(Path(__file__).with_name('appearance.json').read_text())
colors={'canvas':(.35,.34,.29),'dark':(.015,.02,.024),'strip':(.40,.31,.15),'bronze':(.42,.33,.13),'glass':(.023,.04,.045),'white':(.65,.63,.58),'rope':(.18,.16,.12)}
colors.update({role:appearance['palette'][binding['paint']] for role,binding in appearance['materials'].items()})
M={}
for key,color in colors.items():
 m=bpy.data.materials.new('Hipper '+key);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.72;p.inputs['Metallic'].default_value=.0;M[key]=m

def mesh(name,verts,faces,material=None,col=None,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);(col or COL).objects.link(o);o['assemblyId']=OWNER
 if isinstance(material,str):material=M[material]
 if material:data.materials.append(material)
 for p in data.polygons:p.use_smooth=smooth
 return o

def box(name,loc,size,material='naval',col=None,bev=0):
 x,y,z=[n/2 for n in size];v=[(a*x,b*y,c*z) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 o=mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,col);o.location=loc;return o

def cyl(name,loc,radius,depth,material='naval',col=None,vertices=24,r2=None):
 n=vertices;r2=radius if r2 is None else r2
 v=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in [(radius,-depth/2),(r2,depth/2)] for i in range(n)]
 f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 o=mesh(name,v,f,material,col);o.location=loc
 for p in list(o.data.polygons)[2:]:p.use_smooth=True
 return o

def rod(name,a,b,r,material='edge',col=None,r2=None,vertices=10):
 a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,max(.0001,(b-a).length),material,col,vertices,r2);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def prism(name,points,base,top,mat='naval',col=None):
 n=len(points);v=[(x,y,z) for z in (base,top) for x,y in points];return mesh(name,v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat,col)

def ellipse(name,x,y,z,rx,ry,h,mat='naval',col=None,n=40):
 pts=[(x+rx*math.cos(i*math.tau/n),y+ry*math.sin(i*math.tau/n)) for i in range(n)];return prism(name,pts,z,z+h,mat,col)

def interp(points,s):
 for (a,va),(b,vb) in zip(points,points[1:]):
  if a<=s<=b:return va+(vb-va)*(s-a)/(b-a)
 return points[0][1] if s<points[0][0] else points[-1][1]
def deck(x):return interp(H['deckHeights'],x+L/2)
def width(x):return interp(H['halfBreadths'],x+L/2)
def attach(o,parent,keep=False):
 if keep:
  bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=parent;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_world=world
 else:o.parent=parent
 return o

def empty(id,loc=(0,0,0),parent=None):
 o=bpy.data.objects.new(id,None);COL.objects.link(o);o.location=loc;o['nodeId']=id;o['assemblyId']=OWNER;o.parent=parent;return o

def rails(name,pts,h=.85,closed=False,spacing=2.1):
 pairs=list(zip(pts,pts[1:]+([pts[0]] if closed else [])))
 for a,b in pairs:
  a,b=Vector(a),Vector(b)
  for z in (.40,h):rod(name+' wire',a+Vector((0,0,z)),b+Vector((0,0,z)),.015,'edge',vertices=5)
  n=max(1,math.ceil((b-a).length/spacing))
  for i in range(n):p=a.lerp(b,i/n);rod(name+' stanchion',p,p+Vector((0,0,h)),.026,'naval',vertices=6)

def wall(name,pts,z,h=.8,t=.05):
 for a,b in zip(pts,pts[1:]+[pts[0]]):
  x,y=a;u,v=b;o=box(name,((x+u)/2,(y+v)/2,z+h/2),(math.hypot(u-x,v-y),t,h));o.rotation_euler.z=math.atan2(v-y,u-x)

def detail():return Fittings(dict(mesh=mesh,box=box,cyl=cyl,rod=rod),dict(**M,teak=M['wood']),COL)
helpers=dict(mesh=mesh,box=box,cyl=cyl,rod=rod)
hull=authored_hull(H,mesh,COL,[M['hullgray'],M['underwater']])
COL=C['Deck'];OWNER='deck'
for a,b in zip(H['sections'],H['sections'][1:]):
 x0,x1=a['station']-L/2,b['station']-L/2;w0,w1=a['points'][-1][0],b['points'][-1][0];z0,z1=deck(x0)+.015,deck(x1)+.015
 mesh('Continuous steel deck',[(x0,-w0,z0),(x1,-w1,z1),(x1,w1,z1),(x0,w0,z0)],[(0,1,2,3)],'roof')
 mesh('Timber weather deck',[(x0,-max(0,w0-.20),z0+.012),(x1,-max(0,w1-.20),z1+.012),(x1,max(0,w1-.20),z1+.012),(x0,max(0,w0-.20),z0+.012)],[(0,1,2,3)],'wood')
# The source has open launching bays in the weather-deck guardrails.
for side in [-1,1]:
 for lo,hi in [(-L/2,-27.3),(-16.8,-13.85),(-9.6,15.2),(25.9,L/2)]:
  xs=[lo]+[station-L/2 for station,w in H['halfBreadths'] if lo<station-L/2<hi]+[hi]
  pts=[(x,side*max(0,width(x)-.14),deck(x)+.04) for x in xs]
  rails('Weather deck rail',pts,h=.90,spacing=2.0)
COL=C['Superstructure']
for s in D['structures']:
 OWNER=s['id'];structure=authored_structure(s,mesh,M,COL)
 if s['id'].startswith('funnel-') and s['id'] not in platform_ids:
  structure.data.materials.append(M['dark'])
  for face in structure.data.polygons:
   if face.normal.z>.9:face.material_index=1
 # Paint the authored top faces without adding height above the declared
 # supporting deck, which is also the equipment installation datum.
 if not s.get('surface') and s['id'] not in platform_ids and not s['id'].startswith(('funnel-','bulwark-')):
  pts=[(-z,-x) for x,z in s['footprint']];top=s['baseY']+s['height']
  structure.data.materials.append(M['roof'])
  for face in structure.data.polygons:
   if face.normal.z>.9:face.material_index=len(structure.data.materials)-1

manual_start=set(scene.objects)
for pid,pts,z,h in PLATFORMS:
 if pid=='aft-director-gallery' or pid.startswith('platform-105-'):
  OWNER=pid;prism(pid+' timber surface',pts,z,z+.012,'wood')
# Open observation levels have thin walls and physically braced overhangs.
def platform(name,pts,z,base,wallheight=.85,mat='linoleum',rail=False,anchor=None):
 global OWNER
 OWNER=name
 pts=next(p[1] for p in PLATFORMS if p[0]==name)
 prism(name+' walking surface',pts,z,z+.018,mat)
 if rail:rails(name+' edge',[(x,y,z) for x,y in pts],wallheight,True)
 # Bulwarks are thin blueprint structures, leaving the working platform hollow.
 for x,y in pts:
  if abs(y)>2.2:rod(name+' supporting knee',(x,y*.97,z-.17),(max(anchor[0],min(anchor[1],x)) if anchor else x,math.copysign(anchor[2],y) if anchor else y*.50,base),.067,'naval',vertices=6)
platform('bridge-wings',[(26,-6.9),(31.3,-6.9),(33,-5.3),(32.7,-3),(26,-3),(26,3),(32.7,3),(33,5.3),(31.3,6.9),(26,6.9)],12.1,9.5,.84)
platform('signal-gallery',[(16.0,-3.2),(19,-5.7),(24.8,-5.7),(24.8,5.7),(19,5.7),(16,3.2)],19.30,17,.86,anchor=(22,25,2))
platform('forward-aa-gallery',[(25.7,-3.05),(29.9,-3.05),(31,-2),(31,2),(29.9,3.05),(25.7,3.05)],22.5,20.2,1.1,anchor=(22,25.5,1.4))
platform('tower-top-gallery',[(19.2,-4.9),(24,-4.9),(26.7,-3.5),(27.0,3.5),(24,4.9),(19.2,4.9)],25.05,23.2,1.03,anchor=(22,25,1.4))
platform('navigation-gallery',[(27,-4.7),(35,-5.85),(41.8,-5.35),(43.9,-3.6),(45.05,-1.3),(45.05,1.3),(43.9,3.6),(41.8,5.35),(35,5.85),(27,4.7)],12.1,10.8,.84,anchor=(28,43,3))
# Funnel ring platform and inclined open cap. The smoke opening is a real hole.
pts=[(9+5.5*math.cos(i*math.tau/36),4.2*math.sin(i*math.tau/36)) for i in range(36)]
platform('funnel-searchlight-gallery',pts,16.2,14.6,.86,'roof')
OWNER='funnel-cap';n=48;verts=[]
for cx,rx,ry,z,slope in [(10.7,5.3,2.26,18.75,0),(9.7,4.0,1.67,21.77,.425),(9.7,3.85,1.52,21.77,.425),(10.7,5.12,2.08,18.75,0)]:
 for i in range(n):
  a=i*math.tau/n;x=cx+rx*math.cos(a);verts.append((x,ry*math.sin(a),z+slope*(x-cx)))
faces=[(j*n+i,j*n+(i+1)%n,((j+1)%4)*n+(i+1)%n,((j+1)%4)*n+i) for j in range(4) for i in range(n)]
mesh('Swept open funnel cap',verts,faces,'roof',smooth=True)
for xx in [7.3,8.5,9.7,10.9,12.1]:
 yy=1.52*math.sqrt(1-((xx-9.7)/3.85)**2)
 rod('Funnel rain grating',(xx,-yy,21.77+.425*(xx-9.7)),(xx,yy,21.77+.425*(xx-9.7)),.042,'edge')
# The grating is tied to the cap's rim by longitudinal rails.
for yy in [-.55,.55]:rod('Funnel grate rail',(6.05,yy,20.22),(13.35,yy,23.32),.035,'edge')
# Original searchlights: fork bearings and drum backs meet their platform bases.
OWNER='searchlights'
for x,y,z in [(9.3,-3.9,16.3),(9.3,3.9,16.3),(-17.4,-1.7,15.6),(-17.4,1.7,15.6)]:
 sign=1 if y>0 else -1
 if x<0:
  ellipse('Mainmast light landing',x,y,z-.18,1.1,1.0,.18,'roof')
  for xx in [x-.6,x+.6]:rod('Mainmast landing brace',(-16,sign*.4,13.4),(xx,y,z-.18),.08)
 light_start=set(scene.objects)
 cyl('Searchlight sole',(x,y,z+.08),.45,.16,'edge')
 cyl('Searchlight training column',(x,y,z+.43),.22,.60)
 yy=y+sign*.35
 for dx in [-.74,.74]:
  rod('Searchlight fork',(x,y,z+.70),(x+dx,yy,z+1.0),.065)
  rod('Searchlight fork upright',(x+dx,yy,z+1.0),(x+dx,yy,z+1.46),.07)
 rod('Searchlight trunnion',(x-.78,yy,z+1.45),(x+.78,yy,z+1.45),.09,'edge')
 rod('Searchlight drum',(x,y+sign*.12,z+1.45),(x,y+sign*.84,z+1.45),.67,vertices=40)
 rod('Searchlight lens rim',(x,y+sign*.80,z+1.45),(x,y+sign*.91,z+1.45),.70,'edge',vertices=40)
 rod('Searchlight lens',(x,y+sign*.912,z+1.45),(x,y+sign*.92,z+1.45),.61,'glass',vertices=40)
 detail().ring('Searchlight protective rim',(x,y+sign*.94,z+1.45),.60,.025,'y')
 if x<0:
  bpy.context.view_layer.update()
  turn=Matrix.Translation((x,y,z))@Matrix.Rotation(-sign*math.pi/2,4,'Z')@Matrix.Translation((-x,-y,-z))
  for o in set(scene.objects)-light_start:o.matrix_world=turn@o.matrix_world
# Windows occupy the actual wall segments, with a painted sill and frame.
def windows(sid,z,height=.48,spacing=.85):
 s=next(s for s in D['structures'] if s['id']==sid);pts=[(-b,-a) for a,b in s['footprint']]
 for a,b in zip(pts,pts[1:]+pts[:1]):
  ax,ay=a;bx,by=b;length=math.hypot(bx-ax,by-ay);n=max(1,int(length/spacing))
  if length<.5:continue
  dx,dy=(bx-ax)/length,(by-ay)/length
  for i in range(n):
   x=ax+(bx-ax)*(i+.5)/n+dy*.025+1.3;y=ay+(by-ay)*(i+.5)/n-dx*.025
   o=box(sid+' window frame',(x,y,z),(.62,.075,height+.10),'edge');o.rotation_euler.z=math.atan2(dy,dx)
   o=box(sid+' recessed glazing',(x+dy*.044,y-dx*.044,z),(.51,.018,height),'glass');o.rotation_euler.z=math.atan2(dy,dx)
windows('bridge-lower',11.55,.43,.95);windows('bridge-navigation',14.05,.43,.95);windows('tower-wheelhouse',18.65,.46,.9)
# Spherical stabilized AA director covers, seated on their own shafts.
for x,y,base,top in [(23.6,-5,7.12,14.1),(23.6,5,7.12,14.1),(-19,-4.7,7.18,12.3),(-19,4.7,7.18,12.3)]:
 OWNER='aa-director-'+str(x)+'-'+str(y)
 cyl('AA director shaft',(x,y,(base+top)/2),1.10,top-base)
 cyl('AA director collar',(x,y,top),1.75,.30,'edge')
 verts=[];rings=12;slices=32
 for j in range(rings+1):
  a=-.60+(math.pi*.5+.60)*j/rings;r=1.95*math.cos(a)
  for i in range(slices):b=i*math.tau/slices;verts.append((x+r*math.cos(b),y+r*math.sin(b),top+1.21+1.95*math.sin(a)))
 fs=[(j*slices+i,j*slices+(i+1)%slices,(j+1)*slices+(i+1)%slices,(j+1)*slices+i) for j in range(rings) for i in range(slices)]
 mesh('Rounded SL8 director cover',verts,fs,'naval',smooth=True)
 rod('Director optical cross tube',(x,y-2.2,top+1.6),(x,y+2.2,top+1.6),.20,'naval',vertices=20)
 for sy in [-1,1]:rod('Director optic',(x+.18,y+sy*1.75,top+1.6),(x+.38,y+sy*1.75,top+1.6),.18,'glass',vertices=20)
# Round seven-metre director bodies with raised shoulder housings and
# separately guarded outer optical tubes, as shown in the approved A fit.
for x,base in [(23.7,27.5),(-31.6,14.2)]:
 OWNER='main-director-'+str(x);start=set(scene.objects)
 if x>0:cyl('Director fixed neck',(x,0,27.31),1.40,.38)
 cyl('Director roof',(x,0,base+2.39),1.39,.025,'roof',vertices=32)
 for sy in [-1,1]:
  box('Rangefinder shoulder brow',(x-.15,sy*1.88,base+2.37),(1.97,1.40,.07),'roof')
  rod('Outer optical tube',(x-.23,sy*2.42,base+1.68),(x-.23,sy*3.92,base+1.68),.29,'naval',vertices=24)
  for yy in [2.55,3.22,3.92]:
   for dx in [-.38,.38]:rod('Optical guard side',(x-.23+dx,sy*yy,base+1.30),(x-.23+dx,sy*yy,base+2.02),.019)
   for zz in [1.30,2.02]:rod('Optical guard tie',(x-.61,sy*yy,base+zz),(x+.15,sy*yy,base+zz),.019)
  for dx in [-.38,.38]:rod('Optical guard rail',(x-.23+dx,sy*2.48,base+2.02),(x-.23+dx,sy*3.92,base+2.02),.019)
 for yy in [-.28,.28]:rod('Director access ladder',(x-1.40,yy,base+.25),(x-1.40,yy,base+2.37),.020)
 for zz in [.25,.55,.85,1.15,1.45,1.75,2.05,2.35]:rod('Director ladder rung',(x-1.40,-.28,base+zz),(x-1.40,.28,base+zz),.018)
 if x<0:
  bpy.context.view_layer.update();turn=Matrix.Translation((x,0,base))@Matrix.Rotation(math.pi,4,'Z')@Matrix.Translation((-x,0,-base))
  for o in set(scene.objects)-start:o.matrix_world=turn@o.matrix_world
# Masts: source forward tripod and taller aft handling mast.
COL=C['Masts'];OWNER='masts'
rod('Foremast lower',(19.6,0,9.5),(19.6,0,34.7),.20,'naval',r2=.09)
rod('Foremast top',(19.6,0,34.7),(19.5,0,39.7),.09,'edge',r2=.03)
for sy in [-1,1]:rod('Foremast leg',(18,sy*1.7,9.5),(19.6,0,28),.14,'naval',r2=.07)
rod('Mainmast lower',(-15.8,0,7.2),(-16.0,0,31),.30,'naval',r2=.12)
rod('Mainmast upper',(-16.0,0,31),(-16.1,0,47.6),.12,'edge',r2=.027)
for sy in [-1,1]:rod('Mainmast tripod',(-18.8,sy*1.6,7.18),(-16.0,0,28),.18,'naval',r2=.08)
for x,z,span in [(19.6,26.8,7.1),(19.6,34.4,7),(-16.0,30.5,7.4),(-16.1,39.0,6.0)]:
 rod('Mast yard',(x,-span,z),(x,span,z),.055,'edge',r2=.04)
 for sy in [-1,1]:rod('Yard brace',(x,0,z+2.7),(x,sy*span,z),.019,'edge',vertices=5)
rod('Aerial between masts',(19.5,0,39.5),(-16.1,0,45.1),.014,'rope',vertices=5)
rod('Aft director mast',(-31.6,0,16.45),(-31.6,0,25.4),.07,'edge',r2=.025)
# Accepted source propeller gap is approximated with original mirrored blades.
COL=C['Underwater'];OWNER='propulsion'
for x,y,z,hand in [(-79.7,0,-6.6,-1),(-76.6,-5.7,-5.45,-1),(-76.6,5.7,-5.45,1)]:
 rod('Propeller shaft',(x+18,y*.72,z+1),(x,y,z),.17,'edge',vertices=20)
 rod('Shaft bearing',(x+1.4,y,z),(x-.3,y,z),.26,'naval',vertices=24)
 for dy in [-.7,.7]:rod('Shaft bracket',(x+1.3,y,z),(x+4,y+dy,z+1.5),.13,'naval')
 rod('Propeller boss',(x+.3,y,z),(x-.85,y,z),.36,'bronze',r2=.15,vertices=24)
 for i in range(3):
  a=i*math.tau/3;vs=[(x+dx,y+r*math.cos(a+hand*angle),z+r*math.sin(a+hand*angle)) for r,angle,dx in [(.25,0,0),(.90,.1,.03),(1.65,.3,-.12),(1.70,.68,-.28),(1.0,.91,-.4),(.3,.7,-.2)]]
  o=mesh('Original screw blade',vs,[tuple(range(6))],'bronze');m=o.modifiers.new('Blade thickness','SOLIDIFY');m.thickness=.055
rod('Rudder stock',(-85.1,0,-1.3),(-85.1,0,-4.5),.18,'edge')
prism('Rudder blade',[(-83.9,-.13),(-89.6,-.13),(-89.6,.13),(-83.9,.13)],-6.3,-2.8,'underwater')
# Ship-owned mounting platforms, with real columns/knees beneath overhangs.
COL=C['Superstructure'];OWNER='gun-platforms'
for side in [-1,1]:
 for x,y,z,inner,base in [(31.7,8.4,7.1,6.0,4.64),(-10.4,8.3,4.5,7.8,2.5),(-28.7,7.4,7.18,5.2,4.73)]:
  yy=side*y;pts=[(x+2.7*math.cos(i*math.tau/32),yy+(3.0 if x>-20 else 2.1)*math.sin(i*math.tau/32)) for i in range(32)]
  # The blueprint renders and collides this cantilever floor.
  for xx in [x-1.5,x+1.5]:detail().knee('105 platform web',xx,side*inner,side*(y+1.6),z-.18,2.0)
  # Open outboard edge clears the gun's barrel depression; source safety rails
  # sit at the remote aft and forward ends of the sponson.
  if x>0: rails('105 platform perimeter',[(27.6,side*6.8,z),(27.6,side*9.8,z),(28.5,side*9.8,z),(29.3,side*10.55,z),(31,side*11.4,z),(32.8,side*11.4,z),(34,side*10.6,z),(35,side*9.55,z),(36.5,side*8.65,z)],.78)
  elif x<-20:rails('105 platform perimeter',[(-32.62,side*7.72,z),(-32.05,side*9.05,z),(-31.6,side*10.06,z),(-29.75,side*10.11,z),(-27.9,side*10.16,z),(-26.13,side*10.19,z),(-24.78,side*8.55,z),(-24,side*7.7,z)],.78)
 for x,y,z,base in [(36,6,9.4,7.12),(-26.3,4.5,10.1,7.18),(-42.5,5.3,7.2,4.77)]:
  yy=side*y;rx,ry=(2,1.45) if x==-26.3 else (1.55,1.35)
  pts=[(x+rx*math.cos(i*math.tau/28),yy+ry*math.sin(i*math.tau/28)) for i in range(28)]
  # The blueprint renders and collides this light-AA floor.
  cyl('Platform supporting column',(x,yy,(base+z-.13)/2),.20,z-.13-base)
  for dx in [-.85,.85]:rod('AA platform knee',(x+dx,yy,z-.14),(x,yy,z-1),.06)
  # The blueprint supplies the half-circle outboard bulwark and access gap.
for side in [-1,1]:
 rails('Middle 105 outboard safety rail',[(-12.55,side*10.38,4.71),(-11.3,side*11.10,4.71),(-9.7,side*11.14,4.71),(-8.3,side*10.40,4.71)],.95,spacing=2.0)
 for xx in [-11.3,-9.7]:detail().knee('Middle 105 edge knee',xx,side*9.85,side*11.1,4.56,.9)
# Boat stowage decks and original open boats match the visible grouped fit.
COL=C['Fittings'];OWNER='boats';f=detail()
for side in [-1,1]:
 y=side*5.2
 for x in [9.24,15.44]:
  box('Boat stowage cross beam',(x,y,8.18),(.35,3.0,.22),'edge')
  for yy in [side*4.4,side*6.2]:rod('Boat rack leg',(x,yy,4.7),(x,yy,8.15),.09)
 f.boat('Traffic boat',12.4,y,8.30,11.7,2.65,True)
 xx,yy,zz=11.4 if side<0 else 12.7,side*(7.7 if side<0 else 8.0),7.8
 f.boat('Torpedo cutter',xx,yy,zz,7.5,1.82,False)
 for dx in [-2.0,2.0]:
  rod('Cutter cradle outrigger',(xx+dx,side*6.0,zz-.15),(xx+dx,yy,zz-.15),.10)
  rod('Cutter rack brace',(xx+dx,side*6.0,4.8),(xx+dx,yy,zz-.15),.08)
 # The forward cutter hangs above the torpedo bay in its own end-supported
 # frame. There are no deck-to-cradle diagonal legs across the launcher's path.
 f.boat('Forward suspended cutter',22,side*9.2,8.9,7.5,1.82,False)
 for lat in [7.6,9.2]:
  for xx in [17.05,26.55]:
   rod('Cutter gantry upright',(xx,side*lat,4.7),(xx,side*lat,11.35),.13,r2=.11)
  rod('Cutter gantry head',(17.05,side*lat,11.35),(26.55,side*lat,11.35),.13)
  rod('Cutter gantry sill',(17.05,side*lat,7.85),(26.55,side*lat,7.85),.085)
  rod('Cutter gantry diagonal',(17.05,side*lat,6.15),(26.55,side*lat,11.15),.043)
  rod('Cutter gantry diagonal',(26.55,side*lat,6.15),(17.05,side*lat,11.15),.043)
 for xx in [17.05,26.55]:rod('Cutter gantry crosshead',(xx,side*7.6,11.35),(xx,side*9.2,11.35),.10)
 for xx in [19.98,23.95]:
  rod('Suspended cutter cradle',(xx,side*7.6,8.72),(xx,side*9.7,8.72),.09)
  rod('Cutter cradle stay',(xx,side*7.6,7.85),(xx,side*9.2,8.72),.055)
  for lat in [8.45,9.95]:rod('Cutter lifting sling',(xx,side*9.2,11.32),(xx,side*lat,9.7),.018,'rope',vertices=5)
# Aft motor launch cradles connect to the hangar side framing.
for x,y,z,l,w,cabin in [(-11.3,-5.3,10.2,9,2.35,True),(-11.5,5.5,10.2,10,2.4,False)]:
 for xx in [x-2.5,x+2.5]:
  rod('Aft launch shelf',(xx,y*.62,9.94),(xx,y+(.9 if y>0 else -.9),9.94),.11)
  rod('Shelf diagonal',(xx,y*.62,7.4),(xx,y,9.94),.10)
 f.boat('Aft launch',x,y,z,l,w,cabin)
# Catapult: turntable and a narrow lattice track on the hangar roof.
OWNER='catapult';x=-9.1;z=12.2
cyl('Catapult bearing',(x,0,z+.14),1.18,.28,'edge')
for yy in [-.43,.43]:
 rod('Catapult upper rail',(x-5.2,yy,z+1.08),(x+7.4,yy,z+1.08),.065,'edge')
 rod('Catapult lower chord',(x-5.2,yy,z+.40),(x+7.4,yy,z+.40),.06)
 for i in range(13):
  xx=x-5.2+i*.97;rod('Catapult lattice',(xx,yy,z+.4),(xx+.97,yy,z+1.08),.035)
for xx in [x-4,x-2,x,x+2,x+4,x+6]:rod('Catapult cross tie',(xx,-.45,z+.75),(xx,.45,z+.75),.035)
box('Catapult shuttle',(x+2.0,0,z+1.19),(1.9,1.25,.18),'edge')
for yy in [-.52,.52]:rod('Aircraft cradle',(x+1.3,yy,z+1.27),(x+2.6,yy,z+1.27),.052)
# Hangar roof rails, aft door shutters and maintenance stairs.
for yy in [-3.50,3.50]:
 rails('Hangar roof safety rail',[(-14.4,yy,12.2),(1.9,yy,12.2)],.74)
for yy in [-2.5,-1.5,-.5,.5,1.5,2.5]:box('Hangar door shutter',(-15.82,yy,8.0),(.08,.98,5.5),'edge')
for side in [-1,1]:
 f.stairs('Hangar side access',(-2,side*6.4,4.65),(-7.1,side*4.0,10.0),.75)
# Correctly seated small optical finders, exposed binocular stations and sights.
COL=C['Superstructure'];OWNER='bridge-fittings'
for x,y,z,span in [(35.6,0,14.8,6),(28.6,0,16.9,3.5),(27.2,-6.5,12.4,3.5),(27.2,6.5,12.4,3.5)]:
 cyl('Covered finder base',(x,y,z+.12),.65,.24,'edge')
 box('Finder weather housing',(x,y,z+(.38 if span==6 else .61)),(1.15 if span==6 else 2.40,1.30,.60 if span==6 else .93))
 rod('Finder optical tube',(x,y-span/2,z+.6),(x,y+span/2,z+.6),.19)
 for side in [-1,1]:
  box('Finder end cover',(x,y+side*(span/2-.2),z+.6),(.59,.51,.61))
  rod('Finder lens',(x+.30,y+side*(span/2-.2),z+.60),(x+.33,y+side*(span/2-.2),z+.6),.10,'glass')
# Support the forward conning roof optical instrument at its shown height.
ellipse('Conning instrument roof',35.6,0,12.85,2.6,2.3,1.95)
for x,y,z in [(35.5,-4,12.5),(35.5,4,12.5),(25.6,-3.6,25.1),(25.6,3.6,25.1),(33.7,-4,12.7),(33.7,4,12.7),(30.9,0,14.4),(29.7,-5.1,12.1),(29.7,5.1,12.1)]:
 cyl('Optical station base',(x,y,z+.07),.27,.14,'edge');cyl('Optical station column',(x,y,z+.52),.10,.90)
 for yy in [y-.1,y+.1]:rod('Binocular tube',(x-.15,yy,z+1.03),(x+.35,yy,z+1.12),.075,'edge')
# Watertight accesses, ventilation louvers, portholes and pipe runs on actual walls.
COL=C['Fittings'];OWNER='access-and-ventilation';f=detail()
for side in [-1,1]:
 for x,y,z in [(38,6.93,5.0),(27,4.50,7.25),(-28,6.53,4.9),(-38,6.53,4.9),(-32,4.88,7.3),(-4,3.59,4.8)]:f.door('Watertight door',x,side*y,z)
 for x,y,z,w,h in [(-30,6.55,6.0,1.6,1.6),(-36,6.55,6,2.0,1.6),(-40,4.29,8.5,1.1,1.5),(22,5.08,6,1.6,1.2),(39,4.46,8.4,1.1,1.0),(10,2.06,13.0,1.0,1.5)]:f.vent('Intake grille',x,side*y,z,w,h)
 for x,y,z in [(22,5.09,6.45),(24,5.09,6.45),(34,6.94,6.45),(37,6.94,6.45),(-23,4.72,6.15),(-27,6.53,6.15),(-34,6.53,6.15),(-37,6.53,6.15)]:
  rod('Porthole glass',(x,side*y,z),(x,side*(y+.025),z),.18,'glass',vertices=20)
  f.ring('Porthole rim',(x,side*(y+.025),z),.20,.027,'y')
 for x,y,z0,z1,wall_y in [(23,2.88,10,16.8,2.75),(23,3.13,17,19.3,3),(23,1.93,19.4,25.1,1.8),(-35.2,4.0,9.8,11.8,3.89),(-34.5,1.56,11.9,14.2,1.45)]:
  f.ladder('Vertical access ladder',(x,side*y,z0),(x,side*y,z1),.6)
  for zz in [z0+.2,z1-.2]:
   for dx in [-.3,.3]:rod('Ladder wall stay',(x+dx,side*wall_y,zz),(x+dx,side*y,zz),.03)
 f.stairs('Forward shelter stairs',(48,side*6.3,4.8),(45.1,side*6.3,7.12))
 f.stairs('Aft shelter stairs',(-49,side*4.3,4.8),(-45.5,side*5.6,7.2))
 f.reel('Shelter hose reel',23.1,side*7.5,7.12,.40,.85)
 f.reel('Aft mooring reel',-69.0,side*5.5,4.95,.43,1.05)
# Hull portholes at source-like two rows, with their sides attached to the loft.
OWNER='hull-fittings'
def side_width(x,z):
 ss=x+L/2
 for a,b in zip(H['sections'],H['sections'][1:]):
  if a['station']<=ss<=b['station']:
   t=(ss-a['station'])/(b['station']-a['station']);pts=[(v+(w-v)*t,h+(j-h)*t) for (v,h),(w,j) in zip(a['points'],b['points'])]
   for (v,h),(w,j) in zip(pts,pts[1:]):
    if h<=z<=j:return v+(w-v)*(z-h)/max(.00001,j-h)
 return width(x)

for side in [-1,1]:
 for x in range(-88,85,4):
  for z in [1.65,3.65]:
   yy=side_width(x-1.3,z)-.04
   rod('Hull porthole glazing',(x,side*yy,z),(x,side*(yy+.08),z),.13,'glass',vertices=16)
   f.ring('Hull porthole lip',(x,side*(yy+.07),z),.15,.018,'y',segments=12)
 # Mooring bitts and chocks follow the deck's original beam curve.
 for x in [-97,-89,-76,-62,65,78,91,98]:
  yy=side*(width(x-1.3)-.65);zz=deck(x-1.3)
  box('Bollard base',(x,yy,zz+.055),(1.4,.75,.11),'edge')
  for dx in [-.43,.43]:cyl('Mooring bollard',(x+dx,yy,zz+.36),.16,.58,'edge');cyl('Bollard cap',(x+dx,yy,zz+.67),.20,.075,'edge')
 # Anchor handling from the forecastle capstans into the hawse openings.
 for x in [83,88]:
  yy=side*2.25;zz=deck(x-1.3)
  cyl('Anchor capstan bed',(x,yy,zz+.10),.68,.20,'edge');cyl('Anchor capstan drum',(x,yy,zz+.48),.40,.60);cyl('Capstan head',(x,yy,zz+.81),.59,.15,'edge')
 f.chain('Anchor cable',(83,side*2.25,deck(81.7)+.15),(99.3,side*.85,deck(98)+.17),.25)
 # Forecastle breakwater mounted on the deck, with triangular rear stays.
 for i in range(6):
  ya=side*(.8+i*.85);yb=side*(.8+(i+1)*.85);xa=73.5-abs(ya)*.8;xb=73.5-abs(yb)*.8
  wall('Breakwater',[(xa,ya),(xb,yb)],deck(xa-1.3),.85,.07)
  rod('Breakwater stay',(xa,ya,deck(xa-1.3)+.75),(xa-1.0,ya,deck(xa-1.3)),.042)
for x in [-83,-77,-70,67,75]:
 zz=deck(x-1.3);box('Deck hatch coaming',(x,0,zz+.12),(1.45,1.15,.24));box('Deck hatch lid',(x,0,zz+.27),(1.51,1.2,.07),'roof')
rod('Bow jackstaff',(103,0,6.5),(104,0,12.9),.048,'edge')
rod('Stern staff',(-101.2,0,5.0),(-104.3,0,12.8),.048,'edge')
for a,b in [((103,0,6.5),(19.5,0,39.5)),((-101.2,0,5),(-16.1,0,45.1))]:rod('Longitudinal aerial',a,b,.012,'rope',vertices=5)

# Hand-authored fittings use the auxiliary visual datum; center them once.
for ob in set(scene.objects)-manual_start:
 if ob.parent is None:ob.location.x-=1.3
# Fixed barbettes meet the actual ship deck; only rotating floors move.
COL=C['Guns']
for mount in D['mounts']:
 if mount['battery']=='main':
  OWNER=mount['id'];a,z,c=mount['position'];x,y=-c,-a;bottom=deck(x);top=z-.20
  cyl('Main fixed barbette',(x,y,(bottom+top)/2),mount['weapon']['barbetteRadius'],max(.02,top-bottom),'hullgray')
for mount in D['mounts']:create_mount(mount,COL,helpers,M)
# Original trainable triple tubes. The blueprint owns every runtime socket.
COL=C['Torpedoes']
for launcher in D.get('torpedoLaunchers',[]):
 OWNER=launcher['id'];a,z,c=launcher['position'];x,y=-c,-a
 base=deck(x);cyl('Torpedo foundation',(x,y,(base+z)/2),1.0,max(.05,z-base),'edge')
 root=empty(OWNER+'.yaw',(x,y,z))
 def put(o):o.parent=root;return o
 put(cyl('Torpedo training race',(0,0,.07),.97,.14,'edge'))
 put(box('Triple tube bed',(-.35,0,.15),(4.9,2.4,.16)))
 for tube in [t for t in D['torpedoTubes'] if t.get('launcherId')==OWNER]:
  ta,tz,tc=tube['position'];xx,yy,zz=-tc-x,-ta-y,tz-z
  empty(tube['id']+'.muzzle',(xx,yy,zz),root)
  put(rod('Torpedo tube shell',(-3.35,yy,zz),(2.20,yy,zz),.31,'naval',vertices=24))
  # Open forward guide troughs taper upward at their tips. Inner and outer
  # skins give the exposed rim real thickness without capping the opening.
  n=17;rings=[(2.20,1),(3.50,1),(4.40,.45),(xx,.05)]
  verts=[(tx,yy+rad*math.cos(math.pi+i*math.pi/(n-1)),zz+rad*factor*math.sin(math.pi+i*math.pi/(n-1))) for rad in [.31,.286] for tx,factor in rings for i in range(n)]
  faces=[];offset=len(rings)*n
  for j in range(len(rings)-1):
   for i in range(n-1):
    a=j*n+i;faces.extend([(a,a+1,a+1+n,a+n),(offset+a+n,offset+a+1+n,offset+a+1,offset+a)])
   for i in [0,n-1]:
    a=j*n+i;faces.append((a,a+n,offset+a+n,offset+a))
  for j in [0,len(rings)-1]:
   for i in range(n-1):
    a=j*n+i;faces.append((a,a+1,offset+a+1,offset+a))
  put(mesh('Open launching trough',verts,faces,'naval',smooth=True))
  put(rod('Tube rear cover',(-3.48,yy,zz),(-3.32,yy,zz),.33,'edge',vertices=24))
  for tx in [-2.6,-1.0,.8,2.0]:
   put(rod('Tube retaining band',(tx-.04,yy,zz),(tx+.04,yy,zz),.335,'edge',vertices=24))
   put(box('Tube saddle',(tx,yy,.27),(.19,.64,.22)))
  put(rod('Impulse pipe',(-2.7,yy,zz+.37),(.7,yy,zz+.37),.055,'edge'))
  for tx in [-2.8,-1.6,-.4]:
   put(box('Firing valve',(tx,yy,zz+.43),(.22,.19,.17)))
   put(rod('Valve linkage',(tx,yy,zz+.49),(tx,yy+.22,zz+.49),.019,'edge'))
  for dz in [-.16,.16]:
   put(box('Rear cover hinge',(-3.45,yy+.28,zz+dz),(.18,.10,.11),'edge'))
   put(rod('Cover hinge pin',(-3.45,yy+.28,zz+dz-.07),(-3.45,yy+.28,zz+dz+.07),.026,'edge'))
 for sign in [-1,1]:
  put(rod('Launcher compressed air flask',(-3.1,sign*1.22,.29),(-.6,sign*1.22,.29),.16,'edge',r2=.12,vertices=20))
  for tx in [-2.65,-1.0]:put(box('Air flask saddle',(tx,sign*1.22,.19),(.18,.37,.27)))
  put(rod('Air manifold',(-.6,sign*1.22,.29),(-.4,sign*.72,.79),.045,'edge'))
  put(box('Control shelter side',(1.78,sign*1.45,1.08),(1.45,.055,.96)))
  put(mesh('Flared shelter rim',[(1.03,sign*1.45,1.56),(2.51,sign*1.45,1.56),(2.72,sign*1.57,1.70),(.94,sign*1.57,1.70)],[(0,1,2,3)],'naval'))
  put(rod('Shelter support',(1.2,sign*.95,.24),(1.2,sign*1.45,.75),.055))
 put(box('Control shelter front',(2.50,0,1.14),(.06,2.9,.90)))
 put(box('Control station floor',(1.70,0,.84),(1.6,2.9,.075),'roof'))
 put(box('Launcher instrument console',(1.89,0,1.05),(.47,1.2,.36),'edge'))
 for yy in [-.4,0,.4]:
  put(rod('Setting dial',(1.63,yy,1.11),(1.60,yy,1.11),.09,'dark',vertices=20))
  put(rod('Setting lever',(1.68,yy,1.24),(1.45,yy,1.36),.023,'edge'))
 for yy in [-1.25,1.25]:
  put(rod('Control platform handrail',(1.04,yy,.88),(1.04,yy,1.63),.024))
  put(rod('Control platform rail',(1.04,yy,1.63),(.10,yy,1.58),.024))
  put(rod('Control platform stanchion',(.10,yy,.24),(.10,yy,1.58),.024))
 put(rod('Torpedo sight stalk',(2.1,0,1.22),(2.1,0,1.78),.04,'edge'))
 put(rod('Torpedo optical sight',(1.9,0,1.80),(2.38,0,1.80),.052,'edge'))
 put(rod('Training drive column',(0,0,.20),(0,0,.88),.13,'edge'))
 put(box('Training gear housing',(0,0,.70),(.65,.50,.35)))
sys.path.insert(0,str(ROOT/'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene,M,Path(__file__).with_name('appearance.json'))
from decking import apply_decking
apply_decking(scene,M,Path(__file__).with_name('appearance.json'))
scene['definitionHash']=D['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))

"""Original Mogami A-hull/203 mm geometry. Run through ship:build mogami.

Blueprint uses runtime metres; helpers use forward +X, port +Y, up +Z. The shared
exporter performs the sole basis conversion. No reference mesh or texture is read.
"""
import bpy, math, json, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_components import create_gun_mount
from blender_fidelity import authored_hull,authored_structure,Fittings,loft_breadth
from guns import create_mount
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text());OUT=Path(os.environ['SHIP_OUTPUT']);H=D['hull'];L=H['length']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='Mogami';scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world=bpy.data.worlds.new('Mogami studio');scene.world.color=(.075,.095,.12)
C={}
for name in ['Hull','Deck','Superstructure','Guns','Masts','Fittings','Underwater','Torpedoes']:
 col=bpy.data.collections.new(name);scene.collection.children.link(col);C[name]=col
COL=C['Hull'];OWNER='hull'
colors={'naval':(.125,.145,.16),'roof':(.105,.12,.13),'edge':(.19,.215,.235),'hullgray':(.13,.15,.16),'canvas':(.25,.275,.23),'dark':(.024,.028,.03),'underwater':(.20,.225,.13),'linoleum':(.235,.14,.085),'strip':(.56,.42,.21),'bronze':(.42,.33,.13),'glass':(.027,.066,.076),'white':(.75,.73,.64),'rope':(.23,.205,.155),'wood':(.27,.18,.105)}
M={}
for key,color in colors.items():
 m=bpy.data.materials.new('Mogami '+key);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.72;p.inputs['Metallic'].default_value=.12 if key not in ['canvas','linoleum','rope','wood'] else 0;M[key]=m

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
# Original small tonal variation across the hull plates. All color stays on the hull.
for base in ['hullgray','underwater']:
 for k in range(4):
  m=M[base].copy();m.name='Mogami '+base+' plate '+str(k);color=tuple(c*(.94+k*.025) for c in colors[base]);m.diffuse_color=(*color,1);m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*color,1);hull.data.materials.append(m)
for p in hull.data.polygons:
 x=sum(hull.data.vertices[i].co.x for i in p.vertices)/len(p.vertices);z=sum(hull.data.vertices[i].co.z for i in p.vertices)/len(p.vertices)
 p.material_index=2+(4 if z<0 else 0)+int(abs(math.sin(x*.31+z*2.1))*3.99)
COL=C['Deck'];OWNER='deck'
for a,b in zip(H['sections'],H['sections'][1:]):
 x0,x1=a['station']-L/2,b['station']-L/2;w0,w1=a['points'][-1][0],b['points'][-1][0];z0,z1=deck(x0)+.018,deck(x1)+.018
 mesh('Deck steel margin',[(x0,-w0,z0),(x1,-w1,z1),(x1,w1,z1),(x0,w0,z0)],[(0,1,2,3)],'roof')
 if x0<78 and x1>-98:
  mesh('Brown linoleum deck',[(x0,-max(0,w0-.35),z0+.016),(x1,-max(0,w1-.35),z1+.016),(x1,max(0,w1-.35),z1+.016),(x0,max(0,w0-.35),z0+.016)],[(0,1,2,3)],'linoleum')
for x in range(-96,79,3):
 w=max(0,width(x)-.35);box('Linoleum brass retaining strip',(x,0,deck(x)+.045),(.028,2*w,.016),'strip')
for side in (-1,1):
 for x in range(-97,100,3):
  end=min(x+3,100)
  # Torpedo launch ports have open rails; torpedoes clear the deck's edge.
  if -45<x<-7:continue
  rails('Deck edge',[(x,side*max(0,width(x)-.17),deck(x)+.03),(end,side*max(0,width(end)-.17),deck(end)+.03)],.88,spacing=2.5)
COL=C['Superstructure']
from superstructure import create_superstructure
create_superstructure(D,COL,helpers,M,deck)
# Articulated enclosed turrets and intricate open deck guns.
COL=C['Guns']
for m in D['mounts']:
 OWNER=m['id'];before=set(scene.objects)
 if m['battery']=='main':
  create_gun_mount(dict(m,rangefinder=False),COL,helpers,M,deck)
  from main_guns import finish_main_mount
  finish_main_mount(m,COL,helpers,M)
 else:
  yaw=create_mount(m,COL,helpers,M)
# Torpedo deck/aircraft-handling deck is raised over the clear launcher bays.
COL=C['Fittings'];OWNER='aircraft-deck'
# Aircraft tracks sit on the aft part of the continuous raised central deck.
for a,b in [((-46,-3.6,7.63),(-29,7.8,7.43)),((-46,3.6,7.63),(-29,-7.8,7.43))]:
 for off in (-.38,.38):rod('Aircraft trolley rail',(a[0],a[1]+off,a[2]),(b[0],b[1]+off,b[2]),.065,'edge')
for y in (-7.8,7.8):rod('Aircraft perimeter track',(-39,y,7.56),(-27,y,7.41),.075,'edge')
for x in (-39,-29):rod('Aircraft cross track',(x,-7.8,7.55),(x,7.8,7.55),.075,'edge')
# Paired lattice catapults with bearings, beds, traversing rails and deck brackets.
for sy in (-1,1):
 y=sy*9.7;OWNER='catapult-'+str(sy);cyl('Catapult foundation',(-26.48,y,5.8),1.2,2.35);cyl('Catapult roller',(-26.48,y,7.03),1.35,.25,'edge')
 for yy in (y-.65,y+.65):
  for zz in (7.35,8.3):rod('Catapult chord',(-39,yy,zz),(-20,yy,zz),.075,'naval')
  for i in range(12):
   x=-39+i*19/12;end=x+19/12;rod('Catapult diagonal',(x,yy,7.35),(end,yy,8.3),.055,'edge');rod('Catapult upright',(x,yy,7.35),(x,yy,8.3),.055,'edge')
 for x in (-39,-36,-33,-30,-27,-24,-21):rod('Catapult crossbeam',(x,y-.65,7.45),(x,y+.65,7.45),.06,'naval')
 box('Catapult carriage',(-27,y,8.4),(1.4,1.5,.18),'edge')
 for yy in (y-.58,y+.58):rod('Catapult carriage saddle',(-27,yy,8.4),(-27,yy,9),.10,'naval')
 # Boats stowed on real cradles beside the aft director.
 for x in (-17,-26):
  by=sy*4.5;z=7.30
  for xx in (x-2,x+2):box('Boat cradle',(xx,by,z+.2),(.3,2.0,.4),'wood')
  detail().boat('Ship service boat',x,by,z+.4,7.7,2.0,cabin=x==-17)
# Lattice mainmast, light foremast and the handling crane.
COL=C['Masts'];OWNER='mast-aft'
for sy in (-1,1):rod('Mainmast leg',(-13,sy*1.45,7.28),(-14.0,sy*.5,25.0),.19,'naval',r2=.11)
rod('Mainmast crown',(-14,0,23),(-14.4,0,35.1),.10,'naval',r2=.045)
for z in range(10,25,2):
 w=1.45-(z-7.28)/17.72*.95;x=-13-(z-7.28)/17.72
 rod('Mainmast horizontal',(x,-w,z),(x,w,z),.07,'naval')
 rod('Mainmast diagonal',(x,-w,z),(x-.12,max(.5,w-.2),z+2),.047,'edge')
rod('Main yard',(-14.2,-7,29.3),(-14.2,7,29.3),.085,'naval')
for sy in (-1,1):rod('Main yard stay',(-14.4,0,33.5),(-14.2,sy*7,29.3),.025,'edge')
# Crane pedestal joins the mast foundation; boom chords terminate at hinge plates.
cyl('Crane pedestal',(-15.4,0,11.75),.7,8.95)
for yy in (-.5,.5):
 rod('Crane boom lower',(-15.4,yy,16.2),(-34.7,yy,18.4),.10,'naval')
 rod('Crane boom upper',(-15.4,yy,17.2),(-34.7,yy,18.7),.085,'naval')
 for i in range(12):
  t=i/12;u=(i+1)/12;rod('Crane web',(-15.4-19.3*t,yy,16.2+2.2*t),(-15.4-19.3*u,yy,17.2+1.5*u),.042,'edge')
rod('Crane hoist',(-14.2,0,25),(-34.7,0,18.7),.025,'edge');rod('Crane hanging hook',(-34.7,0,18.4),(-34.7,0,16.5),.027,'edge')
rod('Crane hook crook',(-34.7,0,16.5),(-34.9,0,16.4),.065,'edge')
OWNER='mast-fore'
for yy in (-1.2,1.2):rod('Foremast leg',(17.2,yy,deck(17.2)),(16.8,0,23.4),.14,'naval',r2=.08)
rod('Foremast pole',(16.8,0,21),(15.4,0,29.4),.075,'edge',r2=.035)
rod('Foremast yard',(16.6,-4.5,24),(16.6,4.5,24),.06,'naval')
for yy in (-1,1):rod('Fore yard brace',(16.1,0,25.5),(16.6,yy*4.5,24),.033,'edge')
# Open radar grids, seated on their mast platforms. Rotation is a visual estimate.
for name,x,z,w,h in [('Fore radar',16.8,25,3.0,2.4),('Aft radar',-14,20.2,1.5,3.8)]:
 rod(name+' pedestal',(x,0,z-1),(x,0,z+h),.07,'edge')
 for i in range(9):y=-w/2+w*i/8;rod(name+' vertical',(x,y,z),(x,y,z+h),.022,'edge',vertices=6)
 for j in range(8):zz=z+j*h/7;rod(name+' crosswire',(x,-w/2,zz),(x,w/2,zz),.022,'edge',vertices=6)
rod('Mainmast forward leg',(-10.8,0,7.28),(-14,0,25),.20)
rod('Mainmast after leg',(-16.4,0,7.28),(-14,0,25),.18)
for z in range(10,25,2):
 t=(z-7.28)/17.72;u=(z+2-7.28)/17.72
 a=-16.4+2.4*t;b=-10.8-3.2*t;c=-16.4+2.4*u;d=-10.8-3.2*u
 rod('Mainmast side crossbar',(a,0,z),(b,0,z),.075)
 rod('Mainmast side lattice',(a,0,z),(d,0,z+2),.06)
rod('Foremast after leg',(13.9,0,4.7),(16.8,0,23.4),.16)
rod('Foremast forward leg',(20.1,0,7.2),(16.8,0,23.4),.15)
for z in range(9,23,2):
 a=13.9+(16.8-13.9)*(z-4.7)/18.7;b=20.1+(16.8-20.1)*(z-7.2)/16.2
 d=20.1+(16.8-20.1)*(z+2-7.2)/16.2
 rod('Foremast lattice',(a,0,z),(d,0,z+2),.05);rod('Foremast crossbar',(a,0,z),(b,0,z),.065)
# These optical platforms projected beyond the casing: connect them back to it.
for sy in (-1,1):
 rod('Optics diagonal',(14.85,sy*3.0,4.7),(14.85,sy*5.16,12.08),.14)
 rod('Optics transverse bearer',(18.5,sy*3.4,12.08),(14.85,sy*5.16,12.08),.11)

rod('Stern signal staff',(-98,0,deck(-98)),(-98,0,12.1),.055,'naval')
# Ropes and aerials have supported endpoints.
for sy in (-1,1):
 rod('Wireless aerial',(15.4,sy*.15,29.4),(-14.4,sy*.4,35.1),.010,'dark',vertices=5)
 rod('Forward stay',(15.4,0,29.4),(31,sy*4,7.24),.012,'dark',vertices=5)
 rod('After stay',(-14.4,0,35.1),(-98,0,12.1),.012,'dark',vertices=5)
 for y in (1.5,3,4.3):rod('Signal halyard',(16.6,sy*y,24),(24,sy*3,14.3),.009,'rope',vertices=5)
# Independent trainable quadruple launchers: stable pivots and muzzle sockets.
COL=C['Torpedoes']
for launcher in D['torpedoLaunchers']:
 OWNER=launcher['id'];a,z,c=launcher['position'];x,y=-c,-a
 cyl('Torpedo foundation',(x,y,(deck(x)+z+.08)/2),1.2,z+.08-deck(x),'naval')
 pivot=empty(OWNER+'.yaw',(x,y,z))
 attach(cyl('Torpedo roller',(0,0,.16),1.28,.2,'edge'),pivot)
 attach(box('Launcher cross frame',(0,0,.34),(8.5,3.15,.22),'naval'),pivot)
 for tube in [t for t in D['torpedoTubes'] if t['launcherId']==OWNER]:
  a,b,c=tube['position'];p=Vector((-c-x,-a-y,b-z));rear=p-Vector((8.5,0,0))
  attach(rod('610 mm tube',rear,p,.33,'naval',vertices=24),pivot)
  attach(rod('Torpedo mouth',p,p+Vector((.012,0,0)),.303,'dark',vertices=24),pivot)
  attach(rod('Breech end',rear-Vector((.05,0,0)),rear+Vector((.06,0,0)),.36,'edge',vertices=24),pivot)
  for xx in (-3.8,-2,0,2,3.8):
   attach(rod('Tube reinforcing band',(xx-.035,p.y,p.z),(xx+.035,p.y,p.z),.35,'edge',vertices=20),pivot)
  attach(rod('Torpedo release linkage',rear+Vector((.2,.28,.18)),p+Vector((-.5,.28,.18)),.022,'edge'),pivot)
  empty(tube['id']+'.muzzle',tuple(p),pivot)
 for xx in (-2.8,0,2.8):attach(box('Tube support saddle',(xx,0,.4),(.17,3.2,.35),'edge'),pivot)
# Small fittings: seated anchors, capstans, bollards, hatches, vents and reels.
COL=C['Fittings'];OWNER='deck-fittings'
for x in (-94,-88,-76,-68,74,82,91):
 z=deck(x);w=width(x)
 for sy in (-1,1):
  y=sy*max(.5,w-1)
  box('Bollard base',(x,y,z+.08),(1.4,.7,.16),'edge')
  for xx in (x-.4,x+.4):cyl('Mooring bitt',(xx,y,z+.40),.20,.63);cyl('Bitt cap',(xx,y,z+.73),.26,.08,'edge')
for x in (-93,-79,-71,72,78):
 z=deck(x);box('Deck hatch coaming',(x,0,z+.12),(1.4,1.3,.22),'edge');box('Deck hatch',(x,0,z+.25),(1.27,1.17,.065),'naval')
 for y in (-.35,.35):rod('Hatch dog',(x-.36,y,z+.30),(x-.18,y,z+.30),.025,'edge')
for x in (83,88):
 z=deck(x)
 for y in (-1.35,1.35):
  cyl('Anchor capstan',(x,y,z+.45),.53,.9);cyl('Capstan crown',(x,y,z+.94),.64,.12,'edge')
for sy in (-1,1):
 detail().chain('Anchor cable',(89,sy*1.4,deck(89)+.09),(96,sy*1.45,deck(96)+.06),.30)
 x=94;y=sy*width(x)
 rod('Anchor shank',(x,y*.99,deck(x)-1),(x-1.25,y,deck(x)-2.3),.12,'edge')
 rod('Anchor crown',(x-1.25,y,deck(x)-2.3),(x-1.25,sy*(abs(y)+.2),deck(x)-1.5),.13,'edge')
 for x in (-76,78):detail().reel('Cable reel',x,sy*2.6,deck(x),.43,1.05)
 for x in range(-92,94,4):
  w=loft_breadth(H,x,3.3)
  if w>.5:
   o=cyl('Hull porthole',(x,sy*(w+.004),3.3),.13,.018,'dark',vertices=12);o.rotation_euler.x=math.pi/2
   rod('Porthole eyebrow',(x-.14,sy*(w+.026),3.49),(x+.14,sy*(w+.026),3.49),.018,'edge',vertices=6)
# The bow badge follows the approved model; no unsupported cloth ensign added.
x=100.28;z=7.50
rod('Chrysanthemum backing',(x-.10,0,z),(x+.02,0,z),.37,'bronze',vertices=32)
for i in range(16):
 a=i*math.tau/16;rod('Chrysanthemum petal',(x+.035,.075*math.cos(a),z+.075*math.sin(a)),(x+.03,.32*math.cos(a),z+.32*math.sin(a)),.035,'strip',vertices=8)
# Shafts, A-brackets, four three-bladed screws and a seated central rudder.
COL=C['Underwater'];OWNER='propulsion'
for sy in (-1,1):
 for end,y in [(-86.9,2.85),(-75.4,6.93)]:
  y*=sy;z=-4
  rod('Propeller shaft',(end+17,y*.72,-3.0),(end,y,z),.16,'edge',vertices=20)
  rod('Shaft bearing',(end+2,y,z),(end-1,y,z),.26,'naval',vertices=24)
  for dy in (-.7,.7):rod('Shaft A-bracket',(end+2,y,z),(end+5,y+dy,-2.1),.11,'naval')
  rod('Propeller boss',(end+.3,y,z),(end-1,y,z),.38,'bronze',r2=.12,vertices=24)
  for i in range(3):
   a=i*math.tau/3;verts=[]
   for rr,ang,dx in [(.28,a,.0),(.95,a+.30,-.10),(1.55,a+.44,-.25),(1.48,a+.82,-.55),(.83,a+.82,-.4),(.28,a+.35,-.1)]:verts.append((end+dx,y+rr*math.cos(ang),z+rr*math.sin(ang)))
   o=mesh('Propeller blade',verts,[tuple(range(6))],'bronze');mod=o.modifiers.new('Blade thickness','SOLIDIFY');mod.thickness=.055
rod('Rudder stock',(-93.6,0,-.3),(-93.6,0,-3.8),.18,'edge')
mesh('Rudder',[(-96.5,-.12,-3.6),(-93,-.12,-3.7),(-92.8,-.12,-.8),(-96,-.12,-.8),(-96.5,.12,-3.6),(-93,.12,-3.7),(-92.8,.12,-.8),(-96,.12,-.8)],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'underwater')
scene['definitionHash']=D['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))

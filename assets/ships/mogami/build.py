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
colors={'canvas':(.25,.275,.23),'dark':(.024,.028,.03),'strip':(.56,.42,.21),'bronze':(.42,.33,.13),'glass':(.027,.066,.076),'white':(.75,.73,.64),'rope':(.23,.205,.155)}
appearance=json.loads(Path(__file__).with_name('appearance.json').read_text())
colors.update({role:appearance['palette'][binding['paint']] for role,binding in appearance['materials'].items()})
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
# Deck-edge half-breadth (the widest point amidships is the underwater bulge, not the deck edge).
EDGE=[(s['station'],s['points'][-1][0]) for s in H['sections']]
def width(x):return interp(EDGE,x+L/2)
def keel(x):return interp(H['keelHeights'],x+L/2)
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
# Spatial paint variation is applied by the shared appearance recipe below.
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
# Aircraft tracks: the reference's X of trolley rails between the catapults, with perimeter and cross tracks.
for a,b in [((-41,-3.6,7.55),(-24,7.8,7.38)),((-41,3.6,7.55),(-24,-7.8,7.38))]:
 for off in (-.38,.38):rod('Aircraft trolley rail',(a[0],a[1]+off,a[2]),(b[0],b[1]+off,b[2]),.065,'edge')
for y in (-7.8,7.8):rod('Aircraft perimeter track',(-34,y,7.47),(-22,y,7.39),.075,'edge')
for x in (-34,-24):rod('Aircraft cross track',(x,-7.8,7.46),(x,7.8,7.40),.075,'edge')
# Catapults as measured: a truss girder (deep aft, tapering forward) on a turntable over a half-round sponson
# built out from the hull side, with the aircraft-handling A-frame and jib over the turntable.
for sy in (-1,1):
 y=sy*9.72;OWNER='catapult-'+str(sy);xp=-26.5
 # Sponson: half-round deck flush with the hull side, coned down to the shell.
 n=16;top=[];bot=[]
 for i in range(n+1):
  a=math.pi*i/n;top.append((-26.0+2.6*math.cos(a),sy*(8.95+2.75*math.sin(a)),7.34));bot.append((-26.0+1.4*math.cos(a),sy*(8.45+.9*math.sin(a)),4.1))
 v=top+bot;m=len(top)
 f=[(i,i+1,m+i+1,m+i) for i in range(m-1)]+[tuple(range(m)),tuple(range(2*m-1,m-1,-1)),(0,m,2*m-1,m-1)]
 o=mesh('Catapult sponson',v,f,'hullgray')
 cyl('Catapult turntable',(xp,y,7.55),1.25,.42,'naval',vertices=24)
 cyl('Catapult roller path',(xp,y,7.80),1.32,.10,'edge',vertices=24)
 def chord_low(x):return 7.85 if x<=-27.3 else 7.85+(x+27.3)/12.3*.65
 for yy in (y-.7,y+.7):
  rod('Catapult top chord',(-34.8,yy,9.05),(-15.0,yy,9.05),.07,'naval')
  rod('Catapult bottom chord',(-34.8,yy,7.85),(-27.3,yy,7.85),.07,'naval');rod('Catapult bottom chord',(-27.3,yy,7.85),(-15.0,yy,8.5),.07,'naval')
  xs=[-34.8+19.8*i/14 for i in range(15)]
  for a,b in zip(xs,xs[1:]):
   rod('Catapult upright',(a,yy,chord_low(a)),(a,yy,9.05),.045,'edge',vertices=6);rod('Catapult diagonal',(a,yy,chord_low(a)),(b,yy,9.05),.04,'edge',vertices=6)
 for x in (-34.8,-31,-27.3,-24,-20,-15.0):
  rod('Catapult crossbeam',(x,y-.7,9.05),(x,y+.7,9.05),.06,'naval');rod('Catapult crossbeam',(x,y-.7,chord_low(x)),(x,y+.7,chord_low(x)),.05,'naval')
 box('Catapult rail bed',(-24.9,y,9.12),(19.8,.9,.06),'edge')
 box('Catapult carriage',(-33.6,y,9.3),(1.4,1.3,.3),'edge')
 for yy in (y-.58,y+.58):rod('Catapult carriage saddle',(-33.6,yy,9.35),(-33.6,yy,9.85),.08,'naval')
 for x in (-17.5,-21.5,-25.2,-28.5,-31.5):
  for yy in (y-.74,y+.74):
   o=cyl('Catapult sheave',(x,yy,8.55 if x>-27 else 8.4),.26,.06,'edge',vertices=12);o.rotation_euler.x=math.pi/2
 for yy in (y-.62,y+.62):rod('Catapult A-frame leg',(-26.55,yy,9.1),(-26.55,y,11.0),.06,'naval')
 rod('Catapult jib',(-25.0,y,9.1),(-23.4,y,10.9),.06,'naval');rod('Catapult jib stay',(-26.55,y,11.0),(-23.4,y,10.9),.02,'edge')
 box('Catapult control cabin',(-24.4,y,9.27),(1.2,.9,.3),'naval')
# Boats as on the reference: a 15 m motor boat nested over a 12 m motor launch on each side abreast the
# mainmast, and a 9 m cutter on the starboard side by the forward funnel.
OWNER='deck-fittings'
for sy in (-1,1):
 x0=-14.9;detail().boat('Motor launch',x0,sy*5.55,7.62,12.3,2.9)
 detail().boat('Motor boat',x0,sy*5.35,8.95,12.4,2.4,cabin=True)
 for fx in (-.27,.26):
  xx=x0+fx*12.4;box('Boat stack crossbar',(xx,sy*5.4,8.86),(.24,3.5,.12),'roof')
  for s in (-1,1):rod('Boat stack post',(xx,sy*5.4+s*1.7,7.34),(xx,sy*5.4+s*1.7,8.86),.06,'naval',vertices=8)
detail().boat('Cutter',15.55,-8.5,7.6,9.3,2.4)
# Masts and crane, measured on the reference (runtime x, y, z -> blender (-z, -x, y)).
COL=C['Masts']
def B(x,y,z):return Vector((-z,-x,y))
def beam(name,a,b,w,h,mat='naval',up=Vector((1,0,0))):
 """Box girder from a to b: width w across, depth h along `up` (blender forward by default)."""
 a,b=Vector(a),Vector(b);d=(b-a).normalized();u=(up-d*up.dot(d)).normalized();v=d.cross(u)
 vs=[tuple(p+u*su*h/2+v*sv*w/2) for p in (a,b) for su,sv in ((-1,-1),(1,-1),(1,1),(-1,1))]
 return mesh(name,vs,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],mat)
# Mainmast: an A-frame of box-girder legs from the raised deck, a central king post carrying the crane
# heel, a railed platform at the head of the legs, a tapered head and a pole topmast with a yard.
OWNER='mast-aft'
def mleg(sx,y):return B(sx*(2.62-.107*(y-8.5)),y,12.10+.1055*(y-8.5))
for sx in (-1,1):
 beam('Mainmast leg',mleg(sx,7.3),mleg(sx,23.5),.52,.52)
for y in (12.6,15.3,18.9,20.8):beam('Mainmast cross girder',mleg(-1,y),mleg(1,y),.36,.40,up=Vector((0,0,1)))
for sx in (-1,1):rod('Mainmast leg brace',mleg(sx,12.6),mleg(-sx,15.3),.09,'naval')
beam('Mainmast head',B(0,23.3,13.75),B(0,26.3,13.6),1.1,.62)
cyl('Mainmast head cap',B(0,26.4,13.6),.62,.18,'naval')
beam('Crane king post',B(0,8.45,14.8),B(0,26.0,14.85),.6,.52)
beam('Mainmast head tie',B(0,25.6,13.6),B(0,25.6,14.85),.3,.3,up=Vector((0,0,1)))
# Platform at the head of the legs with its rails and brackets.
pts=[(13.0,4.1),(14.9,4.1),(14.9,-4.1),(13.0,-4.1)]
mesh('Mainmast platform',[(-z,x,yy) for yy in (23.75,23.87) for z,x in pts],[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'roof')
rails('Mainmast platform',[(-13.0,-4.05,23.87),(-14.9,-4.05,23.87),(-14.9,4.05,23.87),(-13.0,4.05,23.87)],.9,True,1.6)
for sx in (-1,1):rod('Mainmast platform bracket',tuple(mleg(sx,21.8)),(-13.9,sx*3.6,23.75),.07,'naval')
rod('Main topmast',tuple(B(0,23.3,13.37)),tuple(B(0,35.2,13.37)),.125,'naval',r2=.05)
rod('Main yard',tuple(B(-3.1,33.9,13.3)),tuple(B(3.1,33.9,13.3)),.065,'naval')
for sx in (-1,1):rod('Main yard stay',tuple(B(0,35.0,13.37)),tuple(B(sx*3.1,33.9,13.3)),.02,'edge')
# Lattice ladder mast on the forward face of the A-frame.
for sx in (-.21,.21):
 for sz in (11.29,11.71):rod('Ladder mast corner',tuple(B(sx,18.4,sz)),tuple(B(sx,23.0,sz)),.035,'naval',vertices=6)
for y in (18.4,19.55,20.7,21.85,23.0):
 for (xa,za),(xb,zb) in (((-.21,11.29),(.21,11.29)),((-.21,11.71),(.21,11.71)),((-.21,11.29),(-.21,11.71)),((.21,11.29),(.21,11.71))):rod('Ladder mast rung',tuple(B(xa,y,za)),tuple(B(xb,y,zb)),.025,'edge',vertices=6)
 if y<23:
  for sx in (-.21,.21):rod('Ladder mast lattice',tuple(B(sx,y,11.29)),tuple(B(sx,y+1.15,11.71)),.022,'edge',vertices=6)
for y in (18.9,22.4):
 for sx in (-1,1):rod('Ladder mast stay',tuple(B(sx*.21,y,11.7)),tuple(mleg(sx,y)),.05,'naval')
# Crane: a tapered box-girder boom pivoting on the king post, lightening holes, two hooks.
heel,tip=B(0,16.15,15.2),B(0,18.75,34.8)
n=10
for i in range(n):
 a=heel.lerp(tip,i/n);b=heel.lerp(tip,(i+1)/n);w0=1.0-.6*i/n;w1=1.0-.6*(i+1)/n
 beam('Crane boom',a,b,(w0+w1)/2,.5-.15*(i+.5)/n,up=Vector((0,0,1)))
for i in range(1,14):
 c=heel.lerp(tip,i/14);w=(1.0-.6*i/14)/2+.005
 for s in (-1,1):
  o=cyl('Crane boom lightening hole',(c.x,s*w,c.z),.13,.012,'dark',vertices=10);o.rotation_euler.x=math.pi/2
rod('Crane heel pin',(heel.x,-.62,heel.z),(heel.x,.62,heel.z),.14,'edge',vertices=12)
for zz in (29.3,34.0):
 t=(zz-15.2)/(34.8-15.2);c=heel.lerp(tip,t)
 rod('Crane fall',(c.x,0,c.z-.2),(c.x,0,c.z-1.2),.018,'dark',vertices=5)
 o=cyl('Crane hook block',(c.x,0,c.z-1.45),.22,.5,'edge',vertices=8,r2=.08)
 rod('Crane hanging hook',(c.x,0,c.z-1.7),(c.x,0,c.z-2.2),.03,'edge');rod('Crane hook crook',(c.x,0,c.z-2.2),(c.x-.22,0,c.z-2.05),.05,'edge')
rod('Crane topping lift',tuple(B(0,25.9,14.95)),(tip.x,0,tip.z+.2),.022,'dark',vertices=5)
rod('Crane hoist',tuple(B(0,25.4,15.0)),tuple(heel.lerp(tip,(29.3-15.2)/19.6)+Vector((0,0,.2))),.018,'dark',vertices=5)
# Foremast: a tripod standing on the forward funnel's trunk (centreline fore leg, splayed after legs),
# braced lattice, an enclosed room at mid-height, a flared head, a V-yard, the radar and a raked gaff.
OWNER='mast-fore'
def ffore(y):return B(0,y,-18.95+.0993*(y-10.5))
AFT=[(10.5,2.71,-15.53),(13.5,1.82,-15.99),(16.0,1.07,-16.38),(18.0,.66,-16.61),(20.0,.55,-16.73),(24.3,.30,-16.95)]
def faft(sx,y):
 for (y0,x0,z0),(y1,x1,z1) in zip(AFT,AFT[1:]):
  if y<=y1 or y1==AFT[-1][0]:
   t=(y-y0)/(y1-y0);return B(sx*(x0+(x1-x0)*t),y,z0+(z1-z0)*t)
rod('Foremast leg',tuple(ffore(10.45)),tuple(ffore(24.3)),.13,'naval',r2=.115)
for sx in (-1,1):
 for (y0,_,_),(y1,_,_) in zip(AFT,AFT[1:]):rod('Foremast leg',tuple(faft(sx,max(11.0,y0))),tuple(faft(sx,y1)),.125,'naval',vertices=10)
 rod('Foremast leg foot',tuple(faft(sx,11.2)),tuple(B(sx*1.9,11.2,-15.6)),.09,'naval')
levels=[11.3,13.2,15.1,17.05,19.4,21.0,22.6,24.2]
for y0,y1 in zip(levels,levels[1:]):
 for sx in (-1,1):
  rod('Foremast brace',tuple(ffore(y0)),tuple(faft(sx,y1)),.045,'edge',vertices=6);rod('Foremast brace',tuple(faft(sx,y0)),tuple(ffore(y1)),.045,'edge',vertices=6)
 rod('Foremast brace',tuple(faft(-1,y0)),tuple(faft(1,y1)),.045,'edge',vertices=6);rod('Foremast brace',tuple(faft(1,y0)),tuple(faft(-1,y1)),.045,'edge',vertices=6)
for y in levels:
 for sx in (-1,1):rod('Foremast ring',tuple(ffore(y)),tuple(faft(sx,y)),.05,'naval',vertices=6)
 rod('Foremast ring',tuple(faft(-1,y)),tuple(faft(1,y)),.05,'naval',vertices=6)
box('Foremast room',tuple(B(0,18.25,-17.3)),(1.6,1.7,2.3),'naval')
for sx in (-1,1):box('Foremast room window',tuple(B(sx*.86,18.7,-17.6)),(.5,.02,.35),'glass')
pts=[(-16.3,1.3),(-19.3,1.3),(-19.3,-1.3),(-16.3,-1.3)]
mesh('Foremast platform',[(-z,x,yy) for yy in (16.95,17.05) for z,x in pts],[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'roof')
rails('Foremast platform',[(18.15,1.25,17.05),(19.25,1.25,17.05),(19.25,-1.25,17.05),(18.15,-1.25,17.05)],.9,False,1.2)
# Masthead platform on a triangular bracket; the radar frame and a searchlight stand on it.
box('Foremast head platform',tuple(B(0,24.33,-16.5)),(2.4,1.3,.12),'roof')
mesh('Foremast head bracket',[tuple(B(s*.12,y,z)) for s in (-1,1) for y,z in ((24.27,-15.9),(24.27,-17.0),(23.1,-16.95))],[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'naval')
box('Radar base',tuple(B(0,25.28,-17.3)),(.5,2.1,.3),'naval')
rod('Radar post',tuple(B(0,24.4,-17.1)),tuple(B(0,27.3,-17.1)),.06,'edge')
rod('Radar back stay',tuple(B(0,25.9,-16.6)),tuple(B(0,27.0,-17.07)),.03,'edge')
for i in range(9):
 xx=-1.5+3.0*i/8;rod('Fore radar vertical',tuple(B(xx,25.45,-17.3)),tuple(B(xx,27.0,-17.3)),.022,'edge',vertices=6)
for j in range(7):
 yy=25.45+1.55*j/6;rod('Fore radar crosswire',tuple(B(-1.5,yy,-17.3)),tuple(B(1.5,yy,-17.3)),.022,'edge',vertices=6)
cyl('Masthead searchlight pedestal',tuple(B(0,23.75,-18.85)),.12,.5,'edge',vertices=8)
rod('Masthead searchlight',tuple(B(0,24.1,-18.65)),tuple(B(0,24.1,-19.15)),.28,'naval',vertices=14)
rod('Masthead searchlight bracket',tuple(ffore(23.5)),tuple(B(0,23.5,-18.85)),.05,'naval')
for sx in (-1,1):
 rod('Fore yard arm',tuple(B(sx*.35,24.1,-16.97)),tuple(B(sx*6.6,25.95,-16.97)),.07,'naval',r2=.04)
 rod('Fore yard strut',tuple(B(sx*.25,23.3,-16.95)),tuple(B(sx*2.1,24.65,-16.97)),.045,'edge')
 for fx in (2.1,3.5,4.6):
  cyl('Yard signal fitting',tuple(B(sx*fx,24.1+1.85*(fx-.35)/6.25+.2,-16.97)),.07,.35,'edge',vertices=8)
rod('Foremast gaff heel bar',tuple(faft(-1,22.4)),tuple(faft(1,22.4)),.05,'naval')
rod('Foremast gaff',tuple(B(0,22.4,-16.76)),tuple(B(0,28.9,-13.7)),.075,'naval',r2=.04)
# Side rangefinders stand on columns from the raised deck.
OWNER='bridge-fittings'
for sy in (-1,1):
 cyl('Rangefinder column',(14.85,sy*5.16,(7.30+12.10)/2),.55,12.10-7.30,'naval')
 for zz in (8.2,9.2,10.2,11.2):rod('Column ladder rung',(14.85+.56,sy*5.16-.2,zz),(14.85+.56,sy*5.16+.2,zz),.02,'edge',vertices=6)
rod('Stern signal staff',(-99.7,0,deck(-99.7)),(-100.25,0,12.0),.055,'naval')
# Ropes and aerials have supported endpoints.
OWNER='mast-fore'
for sy in (-1,1):
 rod('Wireless aerial',(13.7,sy*.05,28.9),(-13.37,sy*.1,35.0),.010,'dark',vertices=5)
 rod('Forward stay',(17.3,0,27.2),(31,sy*4,7.24),.012,'dark',vertices=5)
 rod('After stay',(-13.37,0,35.1),(-100.25,0,12.0),.012,'dark',vertices=5)
 for fx in (1.5,3.0,4.3):rod('Signal halyard',(16.97,sy*fx,24.1+1.85*(fx-.35)/6.25),(24,sy*3,14.3),.009,'rope',vertices=5)
# Framed torpedo-bay openings in the raised deck's side (keyhole forward, chamfered rectangle aft).
COL=C['Fittings'];OWNER='deck'
BAYSIDE=[(8.2,10.0),(18.4,9.96),(25,9.94),(30.2,9.8),(38.8,9.57),(39.7,9.55)]
def bayw(z):return interp([(a,w) for a,w in BAYSIDE],z)
c=.3
for outline in ([(11.33,5.1+c),(11.33+c,5.1),(15.4,5.1),(15.4+c,4.72+.1),(18.9-c,4.72+.1),(18.9,4.72+.1+c),(18.9,6.3-c),(18.9-c,6.3),(11.33+c,6.3),(11.33,6.3-c)],
                [(31.55,5.1+c),(31.55+c,5.1),(39.1-c,5.1),(39.1,5.1+c),(39.1,6.3-c),(39.1-c,6.3),(31.55+c,6.3),(31.55,6.3-c)]):
 for sy in (-1,1):
  pts=[(-z,-sy*(bayw(z)+.035),y) for z,y in outline]
  for a,b in zip(pts,pts[1:]+pts[:1]):rod('Torpedo bay frame',a,b,.07,'naval',vertices=8)
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
# Deck fittings at the reference's positions (runtime x, z -> blender -z, -x): windlasses and cable runs,
# bollards, fairleads, hatches, ventilators, reels, winches, davits and the quarterdeck gun rails.
COL=C['Fittings'];OWNER='deck-fittings'
def P(x,z):return (-z,-x)
def on_deck(x,z,raised=False):
 bx,by=P(x,z);return bx,by,(7.30 if raised else deck(bx))
def bollards(x,z,ang=0,raised=False):
 bx,by,d=on_deck(x,z,raised);c,s=math.cos(ang),math.sin(ang)
 o=box('Bollard base',(bx,by,d+.08),(1.8,.62,.16),'edge');o.rotation_euler.z=ang
 for k in (-.5,.5):cyl('Mooring bitt',(bx+k*c,by+k*s,d+.42),.21,.68);cyl('Bitt cap',(bx+k*c,by+k*s,d+.78),.27,.08,'edge')
def fairlead(x,z):
 bx,by,d=on_deck(x,z);box('Roller fairlead base',(bx,by,d+.1),(1.1,.6,.2),'edge')
 for k in (-.28,.28):cyl('Fairlead roller',(bx+k,by,d+.45),.14,.55,'edge',vertices=10)
def hatch(x,z,l,w,h=.25,raised=False):
 bx,by,d=on_deck(x,z,raised);box('Deck hatch coaming',(bx,by,d+h/2),(l,w,h),'edge');box('Deck hatch',(bx,by,d+h+.03),(l-.12,w-.12,.06),'naval')
def vent(x,z,r=.3,h=.8,raised=False):
 bx,by,d=on_deck(x,z,raised);cyl('Ventilator trunk',(bx,by,d+h/2),r*.7,h,'naval',vertices=12);cyl('Ventilator cowl',(bx,by,d+h+.12),r,.24,'naval',vertices=12,r2=r*.6)
def cable(name,pts,z0):
 """Low-poly stud-link cable along deck points (blender coords), alternate links flat and upright."""
 for (ax,ay,az),(bx,by,bz) in zip(pts,pts[1:]):
  a,b=Vector((ax,ay,az)),Vector((bx,by,bz));dv=(b-a);n=max(1,int(dv.length/.34));dn=dv.normalized();side=Vector((-dn.y,dn.x,0)).normalized()
  for i in range(n):
   c=a.lerp(b,(i+.5)/n);up=side if i%2 else Vector((0,0,1))
   ring=[c+dn*math.cos(k*math.tau/6)*.22+up*math.sin(k*math.tau/6)*.13 for k in range(6)]
   for q,r in zip(ring,ring[1:]+ring[:1]):rod(name+' link',tuple(q),tuple(r),.04,'edge',vertices=4)
# Forecastle: two windlasses abreast at z -77.4, cables forward to the stoppers and hawse pipes.
for sy in (-1,1):
 bx,by,d=on_deck(sy*1.0,-77.4)
 cyl('Windlass base',(bx,by,d+.15),.75,.3,'edge');cyl('Windlass gypsy',(bx,by,d+.55),.58,.5,'naval');cyl('Windlass cap',(bx,by,d+.86),.66,.12,'edge')
 pts=[];
 for x,z in ((sy*1.0,-78.3),(sy*.95,-83.0),(sy*1.1,-88.0),(sy*2.2,-91.5),(sy*2.45,-92.6)):
  qx,qy,qd=on_deck(x,z);pts.append((qx,qy,qd+.1))
 cable('Anchor cable',pts,0)
 for z in (-80.5,-86.0):
  qx,qy,qd=on_deck(sy*(1.0 if z>-84 else 1.05),z);box('Cable stopper',(qx,qy,qd+.15),(.9,.5,.3),'edge')
 qx,qy,qd=on_deck(sy*2.45,-92.7);cyl('Hawse pipe deck flange',(qx,qy,qd+.05),.42,.1,'edge')
 bollards(sy*4.1,-82.0,sy*.12);fairlead(sy*4.3,-85.7);bollards(sy*5.7,-63.9,sy*.05)
 qx,qy,qd=on_deck(sy*2.25,-94.6);box('Leadsman platform',(qx,qy,qd+.35),(1.15,1.0,.1),'roof')
 rod('Leadsman platform leg',(qx,qy,qd),(qx,qy,qd+.35),.05,'edge')
bollards(0,-91.8,math.pi/2)
for x,z in ((-3.0,-89.6),(2.5,-92.7)):vent(x,z,.3,.55)
# Forecastle abaft the windlasses: hatches, skylight, reels and the winches forward of No. 2 barbette.
for x,z,l,w in ((.46,-75.5,1.8,1.1),(.46,-70.0,1.7,.86),(.46,-73.4,.53,.8),(-.47,-70.4,.83,1.53),(3.3,-62.5,1.8,1.1),(-1.98,-58.0,1.4,1.2),(-5.1,-51.4,1.0,.66),(5.1,-51.4,1.0,.66)):hatch(x,z,l,w)
# Reels and winches sit under the gunhouse overhang of No. 1/No. 2: kept low enough for it to pass over.
for x,z in ((.48,-71.4),(-.8,-71.6),(-2.2,-69.2),(-3.25,-67.3),(2.0,-68.8),(2.8,-67.8)):
 bx,by,d=on_deck(x,z);detail().reel('Cable reel',bx,by,d,.27,.8)
for x,z in ((-1.5,-56.6),(2.07,-58.9)):
 bx,by,d=on_deck(x,z);box('Deck winch bed',(bx,by,d+.08),(1.0,2.0,.16),'edge');rod('Deck winch drum',(bx,by-.7,d+.44),(bx,by+.7,d+.44),.27,'naval',vertices=14)
 box('Deck winch motor',(bx,by+.95,d+.36),(.7,.5,.56),'naval')
for x,z in ((-.95,-57.9),(.58,-57.4),(1.35,-57.4),(1.62,-58.1),(0,-58.6),(-1.68,-62.1),(3.2,-53.5),(2.7,-54.2),(-1.3,-69.3)):vent(x,z,.25,.55)
for sy in (-1,1):
 bx,by,d=on_deck(sy*6.55,-58.7);rod('Boat davit',(bx,by,d),(bx,by,d+2.0),.08,'naval');rod('Boat davit arm',(bx,by,d+2.0),(bx,by-sy*.45,d+2.2),.07,'naval')
bx,by,d=on_deck(.13,-59.95);box('Stowed accommodation ladder',(bx,by,d+.12),(2.0,7.2,.2),'edge')
# Quarterdeck: raised hatches, skylights and vents abaft No. 5, the after capstan, bollards and davit cranes.
for sy in (-1,1):
 for z in (80.8,85.3):hatch(sy*2.58,z,.5,1.0,.95)
 for z in (75.6,76.7,77.9):hatch(sy*2.56,z,1.0,.67)
 for z in (88.8,89.9):hatch(sy*.85,z,1.0,.67)
 for z in (52.9,54.1):hatch(sy*4.1,z,1.0,.67)
 hatch(sy*6.0,61.7,.7,.47,.2)
 bollards(sy*5.45,83.5,-sy*.35);bollards(sy*8.8,45.2,sy*.05)
 qx,qy,qd=on_deck(sy*4.8,89.7);cyl('Davit crane post',(qx,qy,qd+.4),.18,.8,'naval',vertices=10);rod('Davit crane jib',(qx,qy,qd+.8),(qx-1.9,qy,qd+.62),.08,'naval')
for x,z,l,w in ((0,80.25,1.7,1.1),(-.27,86.8,1.8,1.1),(-1.0,71.4,1.7,1.1),(2.55,68.7,1.8,1.1),(2.8,55.1,1.8,1.1),(-.33,69.5,1.4,1.2),(0,67.7,.86,2.6),(0,65.9,1.0,1.33)):hatch(x,z,l,w)
qx,qy,qd=on_deck(1.0,84.85);cyl('After capstan',(qx,qy,qd+.25),.36,.5,'naval');cyl('After capstan crown',(qx,qy,qd+.52),.42,.08,'edge')
for x,z in ((.29,70.9),(0,56.5),(-.35,82.2),(0,78.6),(.76,79.1),(-1.44,58.05),(-2.1,55.0),(-3.13,60.2),(1.08,55.45)):vent(x,z,.25,.6)
qx,qy,qd=on_deck(0,94.8);box('Skylight',(qx,qy,qd+.25),(.62,.62,.5),'naval')
for x,z in ((2.6,66.6),(4.1,61.0)):
 bx,by,d=on_deck(x,z);detail().reel('Cable reel',bx,by,d,.27,.8)
# Bulwarked gun decks around the quarterdeck 25 mm mounts (reference: 0.8 m).
for sy in (-1,1):
 m=next(m for m in D['mounts'] if m['id']==('aa-12' if sy>0 else 'aa-11'))
 cx,cz=m['position'][0],m['position'][2];pts=[]
 for k in range(8):
  a=(k+.5)*math.tau/8;pts.append(P(cx+1.45*math.cos(a)/math.cos(math.pi/8),cz+1.96*math.sin(a)/math.cos(math.pi/8)))
 z=deck(pts[0][0])
 for a,b in zip(pts,pts[1:]+pts[:1]):
  o=box('Gun deck bulwark',((a[0]+b[0])/2,(a[1]+b[1])/2,z+.4),(math.dist(a,b)+.05,.06,.8),'naval');o.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
  rod('Gun deck bulwark cap',(a[0],a[1],z+.8),(b[0],b[1],z+.8),.035,'edge',vertices=6)
for sy in (-1,1):
 # Stocked anchors housed against the flared bow at the reference's hawse (z -93.2, 3.9-5.5 m).
 x0,z0,x1,z1=93.9,5.5,92.6,4.0
 y0=sy*(loft_breadth(H,x0,z0)+.10);y1=sy*(loft_breadth(H,x1,z1)+.14)
 rod('Anchor shank',(x0,y0,z0),(x1,y1,z1),.12,'edge')
 rod('Anchor crown',(x1+.45,sy*(abs(y1)-.02),z1-.35),(x1-.45,sy*(abs(y1)+.05),z1+.35),.13,'edge')
 # Stern anchor on the quarter, as on the reference (z 90-91.2, 2.8-4.9 m).
 xs=-90.6;rod('Stern anchor shank',(xs,sy*(loft_breadth(H,xs,4.75)+.1),4.75),(xs,sy*(loft_breadth(H,xs,3.05)+.12),3.05),.1,'edge')
 rod('Stern anchor crown',(xs-.5,sy*(loft_breadth(H,xs,3.1)+.1),3.25),(xs+.5,sy*(loft_breadth(H,xs,3.1)+.1),3.25),.1,'edge')
 rod('Hawse pipe lip',(x0+.1,sy*(loft_breadth(H,x0+.1,z0+.25)+.02),z0+.25),(x0+.1,sy*(loft_breadth(H,x0+.1,z0+.25)+.14),z0+.25),.28,'edge',vertices=16)
 for x in range(-92,94,4):
  w=loft_breadth(H,x,3.3)
  if w>.5:
   o=cyl('Hull porthole',(x,sy*(w+.004),3.3),.13,.018,'glass',vertices=12);o.rotation_euler.x=math.pi/2
   rod('Porthole eyebrow',(x-.14,sy*(w+.026),3.49),(x+.14,sy*(w+.026),3.49),.018,'edge',vertices=6)
# The bow badge follows the approved model; no unsupported cloth ensign added.
x=100.28;z=7.50
rod('Chrysanthemum backing',(x-.10,0,z),(x+.02,0,z),.37,'bronze',vertices=32)
for i in range(16):
 a=i*math.tau/16;rod('Chrysanthemum petal',(x+.035,.075*math.cos(a),z+.075*math.sin(a)),(x+.03,.32*math.cos(a),z+.32*math.sin(a)),.035,'strip',vertices=8)
# Underwater appendages measured on the reference: four screws on long shafts with bossings and V brackets,
# twin rudders behind the inner screws and the bilge keels (the centreline skeg is part of the hull loft).
COL=C['Underwater'];OWNER='propulsion'
def breadth_at(x,h):
 st=x+L/2
 for a,b in zip(H['sections'],H['sections'][1:]):
  if a['station']<=st<=b['station']:
   t=(st-a['station'])/(b['station']-a['station']);pa,pb=a['points'],b['points']
   pts=[(wa+(wb-wa)*t,ya+(yb-ya)*t) for (wa,ya),(wb,yb) in zip(pa,pb)]
   if h<=pts[0][1]:return 0.
   for (w0,y0),(w1,y1) in zip(pts,pts[1:]):
    if y0<=h<=y1:return w0 if y1-y0<1e-9 else w0+(w1-w0)*(h-y0)/(y1-y0)
   return pts[-1][0]
 return 0.
def hull_under(x,lateral):
 """Height of the hull shell above a point `lateral` metres off the centreline (scanning up from the keel)."""
 h=keel(x)
 while h<3 and breadth_at(x,h)<abs(lateral):h+=.02
 return h
def blade(name,x0,y0,z0,hand,phase):
 R=1.40;radii=[.30+(R-.30)*k/6 for k in range(7)];chord=[.62,.92,1.10,1.18,1.12,.92,.40];pitch=3.1
 verts=[];faces=[];n=5
 for k,(r,c) in enumerate(zip(radii,chord)):
  skew=.30*(r-.30)/(R-.30);half=c/(2*r)
  for j in range(n):
   u=-1+2*j/(n-1);th=phase+hand*(skew+half*u)
   verts.append((x0-.10*(r-.3)-hand*pitch/math.tau*(th-phase-hand*skew)*hand,y0+r*math.cos(th),z0+r*math.sin(th)))
 for k in range(6):
  for j in range(n-1):faces.append((k*n+j,k*n+j+1,(k+1)*n+j+1,(k+1)*n+j))
 o=mesh(name,verts,faces,'bronze',None,True);mod=o.modifiers.new('Blade thickness','SOLIDIFY');mod.thickness=.07;mod.offset=0
 return o
for sy in (-1,1):
 # (screw plane, screw centre, shaft start inside the hull, bossing end, bracket station)
 for xp,(yp,zp),(xs,ys,zs),xb,xv in [(-87.3,(2.85,-3.78),(-72,2.15,-4.2),-79.5,-85.9),(-75.9,(6.93,-3.70),(-58,6.60,-3.85),-68,-74.4)]:
  yp*=sy;ys*=sy
  rod('Propeller shaft',(xs,ys,zs),(xp+.55,yp,zp),.17,'edge',vertices=16)
  t=(xb-xs)/(xp-xs);rod('Shaft bossing',(xs,ys,zs),(xb,ys+(yp-ys)*t,zs+(zp-zs)*t),.42,'underwater',r2=.22,vertices=20)
  t=(xv-xs)/(xp-xs);sx,sz=ys+(yp-ys)*t,zs+(zp-zs)*t
  rod('Shaft bracket barrel',(xv+.6,sx,sz),(xv-.6,sx,sz),.27,'underwater',vertices=18)
  for lat in (abs(sx)-1.35,abs(sx)+1.0):
   # Streamlined strut: 0.8 m chord, 0.16 m thick, from the barrel up into the shell.
   top=hull_under(xv,lat)+.15;a=Vector((xv,sx,sz));b=Vector((xv,sy*lat,top));d=(b-a).normalized();side=d.cross(Vector((1,0,0))).normalized()
   v=[a+Vector((dx,0,0))+side*s*th for dx,th in [(.4,0),(0,.08),(-.4,0),(0,-.08)] for s in (1,)]+[b+Vector((dx,0,0))+side*s*th for dx,th in [(.4,0),(0,.08),(-.4,0),(0,-.08)] for s in (1,)]
   mesh('Shaft bracket strut',[tuple(q) for q in v],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'underwater')
  rod('Propeller boss',(xp+.55,yp,zp),(xp-.25,yp,zp),.30,'bronze',r2=.26,vertices=20)
  rod('Propeller boss cap',(xp-.25,yp,zp),(xp-.70,yp,zp),.26,'bronze',r2=.05,vertices=20)
  for i in range(3):blade('Propeller blade',xp,yp,zp,sy,i*math.tau/3+.5)
 # Twin rudders abaft the inner screws: streamlined, stocks into the counter.
 yr=sy*2.0;xa,xt=-89.7,-94.1
 prof=[(xa,hull_under(xa,2.0)+.15),(xa-.05,-4.15),(xa-.35,-4.4),(xt+.55,-4.4),(xt,-3.95),(xt,hull_under(xt,2.0)+.15)]
 thick=lambda x:.13-.09*(xa-x)/(xa-xt)
 v=[(x,yr+s*thick(x),z) for s in (-1,1) for x,z in prof];n=len(prof)
 f=[tuple(range(n)),tuple(range(2*n-1,n-1,-1))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh('Rudder',v,f,'underwater')
 rod('Rudder stock',(xa-1.0,yr,prof[0][1]-.4),(xa-1.0,yr,hull_under(xa-1.0,2.0)+.6),.14,'edge',vertices=12)
# Bilge keels on the bulge's lower edge (z -24..34 on the reference).
OWNER='hull'
for sy in (-1,1):
 xs=[24-i*2.9 for i in range(21)];v=[];f=[]
 for i,x in enumerate(xs):
  root=breadth_at(x,-4.45)-.06;fade=min(1,(24-x)/6,(x+34)/6);tip=root+.9*max(.05,fade)
  v+=[(x,sy*root,-4.42),(x,sy*tip,-4.43),(x,sy*tip,-4.48),(x,sy*root,-4.50)]
 for i in range(len(xs)-1):
  a=4*i;b=a+4
  for k in range(4):f.append((a+k,a+(k+1)%4,b+(k+1)%4,b+k))
 f+=[(0,1,2,3),(len(v)-1,len(v)-2,len(v)-3,len(v)-4)]
 mesh('Bilge keel',v,f,'underwater')
sys.path.insert(0,str(ROOT/'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene,M,Path(__file__).with_name('appearance.json'))
scene['definitionHash']=D['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))

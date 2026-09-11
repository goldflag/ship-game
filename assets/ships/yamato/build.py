"""Original Yamato exterior reconstruction. All geometry is authored here, in metres.

Bow +X, port +Y, up +Z, trial waterline Z=0. The blueprint owns dimensions and
weapon placement. Reference configuration and remaining limits are in README.md.
No reference mesh or texture is imported. Run through `bun run ship:build yamato`.
"""
import bpy
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
from blender_supports import SupportSurface
from blender_rig import radar_pivot
from blender_fidelity import authored_hull, authored_structure, Fittings, loft_breadth
sys.path.insert(0,str(ROOT/'assets/parts'))
from aa_articulation import articulate_aa
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
OUT=Path(os.environ['SHIP_OUTPUT']);H=D['hull'];L=H['length']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world.color=(.08,.10,.13)

def group(name):
 c=bpy.data.collections.new(name);scene.collection.children.link(c);return c
HULL=group('01 Hull and underwater body');DECK=group('02 Decks and fittings')
GUNS=group('03 Articulated main and secondary batteries');SUPER=group('04 Bridge and directors')
FUNNEL=group('05 Funnel');AA=group('06 Antiaircraft fittings');MAST=group('07 Masts radar and rigging')
AFT=group('08 Aircraft deck boats and handling gear');UNDER=group('09 Shafts screws and tandem rudders')

def mat(name,c,metal=.12,rough=.55):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*c,1)
 p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
naval=mat('Kure gray - interpreted paint',(.255,.285,.305));roof=mat('Horizontal gray',(.21,.24,.26))
edge=mat('Painted fittings',(.31,.335,.345));hullgray=mat('Hull gray',(.235,.27,.29))
canvas=mat('Gun blast bags',(.61,.60,.53),0,.88);dark=mat('Recesses and funnel interior',(.017,.023,.029),0,.8)
red=mat('Antifouling red oxide',(.29,.065,.045),.04,.78);bronze=mat('Propeller bronze',(.40,.29,.13),.72,.35)
glass=mat('Bridge glazing',(.028,.059,.073),.36,.2);wire=mat('Rigging steel',(.07,.085,.09),.2,.65)
teak=mat('Teak decking - original procedural planks',(.47,.40,.25),0,.8)
n=teak.node_tree.nodes;l=teak.node_tree.links;geo=n.new('ShaderNodeNewGeometry');mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(.2,6.25,1)
l.new(geo.outputs['Position'],mapping.inputs[0]);brick=n.new('ShaderNodeTexBrick');brick.inputs['Scale'].default_value=1;brick.inputs['Brick Width'].default_value=1;brick.inputs['Row Height'].default_value=1
brick.inputs['Mortar Size'].default_value=.011;brick.inputs['Color1'].default_value=(.46,.395,.25,1);brick.inputs['Color2'].default_value=(.54,.475,.315,1);brick.inputs['Mortar'].default_value=(.27,.245,.18,1)
l.new(mapping.outputs['Vector'],brick.inputs['Vector']);l.new(brick.outputs['Color'],n['Principled BSDF'].inputs['Base Color'])

def mesh(name,verts,faces,material,col,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);col.objects.link(o)
 if material:data.materials.append(material)
 for p in data.polygons:p.use_smooth=smooth
 o['assemblyId']=col.name.split(' ',1)[1].lower().replace(' ','-');return o

def cyl(name,loc,radius,depth,material,col,vertices=24,r2=None):
 radius2=radius if r2 is None else r2;vs=[]
 for z,r in ((-depth/2,radius),(depth/2,radius2)):
  vs.extend([(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z) for i in range(vertices)])
 fs=[tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
 o=mesh(name,vs,fs,material,col);o.location=loc
 for p in o.data.polygons[2:]:p.use_smooth=True
 return o

def rod(name,a,b,r,material,col,r2=None,vertices=10):
 a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,material,col,vertices,r2);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def box(name,loc,dim,material,col,bev=0):
 a,b,c=[v/2 for v in dim];v=[(-a,-b,-c),(a,-b,-c),(a,b,-c),(-a,b,-c),(-a,-b,c),(a,-b,c),(a,b,c),(-a,b,c)]
 o=mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,col);o.location=loc;return o

def prism(name,outline,bottom,top,material,col):
 n=len(outline);return mesh(name,[(x,y,bottom) for x,y in outline]+[(x,y,top) for x,y in outline],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,col)

def rounded(name,x,y,z,sx,sy,height,material,col,cut=.20):
 a,b=sx/2,sy/2;q=min(a,b)*cut
 outline=[(x-a+q,y-b),(x+a-q,y-b),(x+a,y-b+q),(x+a,y+b-q),(x+a-q,y+b),(x-a+q,y+b),(x-a,y+b-q),(x-a,y-b+q)]
 return prism(name,outline,z,z+height,material,col)

def interp(st,t):
 if t<=st[0][0]:return st[0][1]
 for (a,va),(b,vb) in zip(st,st[1:]):
  if a<=t<=b:
   u=(t-a)/(b-a);return va+(vb-va)*u
 return st[-1][1]
def deck(x):return interp(H['deckHeights'],x+L/2)
def breadth(x):return interp(H['halfBreadths'],x+L/2)

# Hull and CPU hits share every original station, including the recurve.
stations=[s['station'] for s in H['sections']]
hull=authored_hull(H,mesh,HULL,[hullgray,red])
S={s['id']:s for s in D['structures']}
def structure(id,col=SUPER):
 return authored_structure(S[id],mesh,dict(naval=naval,roof=roof),col)

# Deck planks are an original material; steel strips and ends are separate meshes.
for i,(sa,sb) in enumerate(zip(stations,stations[1:])):
 a,b=sa-L/2,sb-L/2;wa,wb=breadth(a),breadth(b);za,zb=deck(a)+.035,deck(b)+.035
 material=teak if -69<(a+b)/2<85 else roof
 mesh('Deck surface',[(a,-wa,za),(b,-wb,zb),(b,wb,zb),(a,wa,za)],[(0,1,2,3)],material,DECK)
 for side in (-1,1):
  mesh('Steel deck margin',[(a,side*wa,za+.02),(b,side*wb,zb+.02),(b,side*max(0,wb-.55),zb+.02),(a,side*max(0,wa-.55),za+.02)],[(0,1,2,3)],roof,DECK)
  if a<L/2-3.2 and math.floor(sa/2.2)!=math.floor(sb/2.2) and wa>2:
   rod('Rail stanchion',(a,side*(wa-.15),za),(a,side*(wa-.15),za+.95),.033,edge,DECK,vertices=6)
  if a<L/2-3.2:
   # The forepeak's solid crest bulwark replaces the open guard wires. End the
   # last wire inside its return instead of carrying rails across the ornament.
   end=min(b,L/2-3.2);end_y=max(0,breadth(end)-(.07 if end<b else .15))
   for h in (.4,.92):
    rod('Deck guard wire',(a,side*max(0,wa-.15),za+h),(end,side*end_y,deck(end)+.035+h),.014,wire,DECK,vertices=5)

# Main batteries retain all barrel pivots, recoil joints and sockets.
materials=dict(naval=naval,roof=roof,edge=edge,hullgray=hullgray,canvas=canvas,dark=dark)
for mount in D['mounts']:
 if mount['partId']=='type89-127-yamato-twin':continue
 create_gun_mount(mount,GUNS,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deck)
 gun_finish=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),dict(**materials,glass=glass),GUNS)
 gun_finish.gun_details(mount)

# Gallery outlines are independent authored polygons; the blueprint carries the
# inspected GameModels3D silhouette and the runtime structural surfaces.
def perimeter_band(name,outline,z,height,material,col,thickness=.075):
 # A real, open-topped splinter wall, rather than a solid platform-sized box.
 cx=sum(p[0] for p in outline)/len(outline);cy=sum(p[1] for p in outline)/len(outline)
 inner=[]
 for x,y in outline:
  r=math.hypot(x-cx,y-cy);inner.append((x-(x-cx)*thickness/r,y-(y-cy)*thickness/r))
 n=len(outline);v=[(x,y,zz) for zz in (z,z+height) for ring in (outline,inner) for x,y in ring];fs=[]
 for i in range(n):
  j=(i+1)%n
  fs.extend([(i,j,2*n+j,2*n+i),(n+j,n+i,3*n+i,3*n+j),(2*n+i,2*n+j,3*n+j,3*n+i),(j,i,n+i,n+j)])
 return mesh(name,v,fs,material,col)

# The approved pjsb018 A_Hull has a battered lower body, a narrow vertical
# operations tower and separate galleries. Blueprint surfaces own those forms.
def structure_outline(id):return [(-z,-x) for x,z in S[id]['footprint']]

def shaped_gallery(id,name,solid=True):
 s=S[id];outline=structure_outline(id);z=s['baseY'];h=s['height']-.16
 prism(name+' deck',outline,z,z+.16,roof,SUPER)
 if solid:perimeter_band(name+' splinter wall',outline,z+.16,h,naval,SUPER,.065)
 # Gallery knees actually enter the wall at their inner feet. The former
 # constant .68 scaled footprint left triangular webs hanging away from it.
 support=SupportSurface([o for o in SUPER.objects if o.get('nodeId') in ('bridge-foundation.surface','bridge-trunk.surface','operations-tower.surface')])
 for i,(a,b) in enumerate(zip(outline,outline[1:]+outline[:1])):
  length=math.dist(a,b)
  for j in range(max(1,math.ceil(length/1.35))):
   t=(j+.5)/max(1,math.ceil(length/1.35));x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
   if not solid:
    rod(name+' guard stanchion',(x,y,z+.16),(x,y,z+1.05),.027,edge,SUPER,vertices=6)
   if abs(y)<.8:continue
   try:foot=support.along((x,y,z-.15),(0,-math.copysign(1,y),0),20)
   except ValueError:continue
   if abs(foot[1]-y)<.20:continue
   # Closed plate thickness keeps knees legible from the front and below.
   pts=[(x-.035,y,z),(x-.035,foot[1],z),(x-.035,foot[1],z-.9),(x+.035,y,z),(x+.035,foot[1],z),(x+.035,foot[1],z-.9)]
   mesh(name+' bracket',pts,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],edge,SUPER)
  for hrail in ([s['height']] if solid else [.58,1.05]):rod(name+' rim',(*a,z+hrail),(*b,z+hrail),.027,edge,SUPER,vertices=6)

rounded('Central shelter deck',-19,0,8.515,55,21.5,2.285,naval,SUPER)
structure('bridge-foundation');structure('bridge-trunk');structure('operations-tower')
structure('conning-tower')
prism('Conning tower roof',[(-z,-x) for x,y,z in S['conning-tower']['surface']['vertices'][-48:]],19.35,19.52,roof,SUPER)
# Narrow slit band, front rain hood and vertical seams on the conning tower.
for i in range(11):
 a=-math.pi*.7+i*math.pi*1.4/10
 x=4.85+2.73*math.cos(a);y=2.82*math.sin(a)
 o=box('Conning tower vision slit',(x,y,18.95),(.40,.08,.12),dark,SUPER);o.rotation_euler.z=a+math.pi/2
shaped_gallery('lower-lookout','Lower signal bridge')
shaped_gallery('second-lookout','Secondary lookout bridge')
structure('forward-lookout-room')
perimeter_band('Forward lookout rain hood',structure_outline('forward-lookout-room'),25.12,.09,edge,SUPER,.09)
# Upper navigating room: near-vertical side walls, a modest glazed band,
# separate roof station, and external knees below the forward overhang.
nav_outline=structure_outline('first-bridge')
prism('First navigation bridge lower wall',nav_outline,32.4,33.02,naval,SUPER)
perimeter_band('First navigation bridge glazing',nav_outline,33.02,.78,glass,SUPER,.025)
for a,b in zip(nav_outline,nav_outline[1:]+nav_outline[:1]):
 count=max(1,math.ceil(math.dist(a,b)/.64))
 for i in range(count):
  t=i/count;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
  rod('First navigation bridge mullion',(x,y,33.0),(x,y,33.84),.026,naval,SUPER,vertices=6)
perimeter_band('Navigation window sill',nav_outline,32.96,.10,edge,SUPER,.10)
prism('Navigation roof',nav_outline,33.80,34.40,naval,SUPER)
shaped_gallery('air-defense','Air defence station')
# Lower forward face changes width without covering the entire tower in a
# glazed belt. The reference carries small apertures and open lookout tubs.
for side in (-1,1):
 for z in (27.65,30.1):
  for xx in (-3.1,-1.9):
   rod('Operations room scuttle',(xx,side*3.34,z),(xx,side*3.40,z),.115,dark,SUPER,vertices=12)
 # A rear-facing ladder has transverse rungs; both rails clear the curved
 # aft wall. Each stand-off is seated by an actual forward surface ray.
 ladder_support=SupportSurface([o for o in SUPER.objects if o.get('nodeId') in ('bridge-trunk.surface','operations-tower.surface') or o.name.startswith(('First navigation bridge lower wall','Navigation roof'))])
 if side==1:
  for y in (-.32,.32):rod('Bridge access ladder rail',(-6.12,y,22.25),(-6.12,y,34.4),.032,edge,SUPER,vertices=6)
  for i in range(42):rod('Bridge access ladder rung',(-6.12,-.32,22.3+i*.29),(-6.12,.32,22.3+i*.29),.023,edge,SUPER,vertices=6)
  for z in (23,26,29,32,34):
   for y in (-.32,.32):
    foot=ladder_support.along((-6.12,y,z),(1,0,0),6)
    rod('Bridge ladder stand-off',foot,(-6.12,y,z),.045,naval,SUPER,vertices=8)
 # Narrow, supported optical tubs on the tower shoulders.
 for x,z,r in [(-3.9,26.2,1.05)]:
  y=side*3.75;outline=[(x+r*math.cos(i*math.tau/20),y+r*math.sin(i*math.tau/20)) for i in range(20)]
  cyl('Bridge optical tub support',(x,y,z-.65),.28,1.3,naval,SUPER,20,r2=r)
  prism('Bridge optical tub deck',outline,z,z+.12,roof,SUPER)
  perimeter_band('Bridge optical tub wall',outline,z+.12,.85,naval,SUPER,.065)
  rod('Optical tub inboard brace',(x,side*2.9,z-1.1),(x,y,z-.8),.13,naval,SUPER,vertices=10)
  cyl('Binocular pedestal',(x,y,z+.57),.10,.9,edge,SUPER,12)
  rod('Binocular optics',(x-.25,y,z+1.05),(x+.25,y,z+1.05),.11,dark,SUPER,vertices=10)
 for xx in (-3.9,-2.5,-1.1):
  cyl('Air defence binocular stand',(xx,side*2.7,34.96),.08,.9,naval,SUPER,12)
  rod('Air defence binocular',(xx-.23,side*2.7,35.45),(xx+.23,side*2.7,35.45),.10,dark,SUPER,vertices=10)
 # Open signal wings are deliberately separate from the enclosed room.
 pts=[(-5.6,side*3.0),(-9.5,side*9.7),(-8.95,side*9.9),(-3.8,side*3.4)]
 prism('Upper signal wing',pts,34.85,35.03,roof,SUPER)
 for a,b in zip(pts,pts[1:]+pts[:1]):
  rod('Signal wing guard rail',(*a,35.88),(*b,35.88),.023,edge,SUPER,vertices=6)
  count=max(1,math.ceil(math.dist(a,b)/1.3))
  for i in range(count):
   t=i/count;xx=a[0]+(b[0]-a[0])*t;yy=a[1]+(b[1]-a[1])*t
   rod('Signal wing stanchion',(xx,yy,35.0),(xx,yy,35.88),.023,edge,SUPER,vertices=6)
 foot=ladder_support.along((-5.1,side*2.7,31.25),(0,-side,0),6)
 rod('Signal wing lower strut',foot,(-9.2,side*9.7,34.88),.09,edge,SUPER,vertices=10)
rod('Forward small rangefinder bracket',(3.12,0,28.65),(4.126,0,28.75),.19,naval,SUPER,vertices=12)
rounded('Forward small rangefinder housing',4.126,0,28.72,1.2,.78,.83,naval,SUPER,cut=.35)
rod('Forward small rangefinder optical base',(4.126,-.96,29.10),(4.126,.96,29.10),.16,edge,SUPER,vertices=16)
for side in (-1,1):
 box('Upper bridge instrument box',(3.21,side*1.27,31.40),(.25,.72,.68),naval,SUPER)
 box('Upper bridge instrument aperture',(3.345,side*1.27,31.44),(.025,.43,.24),dark,SUPER)
# Main director and its optical base, mounted on the measured upper station.
cyl('Main director fixed pedestal',(-1.76,0,35.265),1.95,1.45,naval,SUPER,40)
director_before=set(scene.objects)
cyl('Main director bearing lower',(-1.76,0,36.0895),2.031,.207,naval,SUPER,40)
cyl('Main director bearing collar',(-1.76,0,36.4025),2.210,.419,naval,SUPER,40)
director_outline=structure_outline('main-director-drum')
prism('Main director faceted housing',director_outline,36.61,38.15,naval,SUPER)
prism('Main director housing roof',director_outline,38.15,38.30,roof,SUPER)
cyl('Director cupola collar',(-1.76,0,38.435),1.78,.29,naval,SUPER,32)
prism('Type 98 main director',structure_outline('main-director-head'),38.578,40.749,naval,SUPER)
prism('Director cap',structure_outline('main-director-head'),40.749,40.84,roof,SUPER)
for side in (-1,1):
 # Aft-set, tapered box arms join the broad rear shoulders of the housing.
 prism('Rangefinder arm root',[(-3.873,side*1.4),(-2.503,side*1.4),(-2.503,side*4.498),(-3.873,side*4.498)],36.94,38.13,naval,SUPER)
 v=[]
 for y,x0,x1,low,high in [(side*4.49,-3.760,-2.614,36.94,38.13),(side*6.81,-3.663,-2.712,37.02,38.05)]:
  v.extend([(x0,y,low),(x1,y,low),(x1,y,high),(x0,y,high)])
 mesh('Tapered rangefinder arm',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],naval,SUPER)
 rounded('Main rangefinder end hood',-3.1785,side*7.4765,37.02,.909,1.351,1.026,naval,SUPER,cut=.14)
 rod('Main rangefinder outer optics',(-2.95,side*8.05,37.56),(-2.95,side*8.362,37.56),.20,edge,SUPER,vertices=16)
 box('Main rangefinder forward optical hood',(-2.69,side*7.95,37.64),(.444,.42,.48),naval,SUPER)
 box('Main rangefinder aperture',(-2.46,side*7.95,37.64),(.02,.23,.25),dark,SUPER)
 for y in (side*2.9,side*6.3):
  rod('Rangefinder underside bracket',(-3.1,y,36.99),(-1.76,side*1.7,36.35),.075,edge,SUPER,vertices=10)
box('Director forward optical hood',(-.3115,.024,39.8875),(1.369,.98,.439),naval,SUPER)
box('Director forward optical aperture',(.382,.024,39.8875),(.025,.61,.23),dark,SUPER)
rod('Director roof sight',(-1.3,0,40.82),(-1.3,0,41.30),.06,edge,SUPER,vertices=12)
def aerial_x(z):return -3.3-(z-40.45)*1.75/3.73
rod('Director aerial mast',(aerial_x(40.45),0,40.45),(aerial_x(44.916),0,44.916),.045,edge,SUPER,r2=.02,vertices=8)
for i in range(24):
 a=i*math.tau/24;bb=(i+1)*math.tau/24;za=42.60+.53*math.sin(a);zb=42.60+.53*math.sin(bb)
 rod('Director aerial loop',(aerial_x(za),.38*math.cos(a),za),(aerial_x(zb),.38*math.cos(bb),zb),.035,edge,SUPER,vertices=6)
for z in (42.1,43.0):rod('Director aerial crossarm',(aerial_x(z),-.35,z),(aerial_x(z),.35,z),.025,edge,SUPER,vertices=6)
main_director_parts=set(scene.objects)-director_before
# Aft director stands ahead of the after 15.5 cm turret.
rounded('Aft director foundation',-39,0,10.8,9,10,4.6,naval,SUPER)
cyl('Aft director column',(-38.6,0,18.1),2.4,5.5,naval,SUPER,32)
cyl('Aft director upper housing',(-38.6,0,22.8),2.05,3.9,naval,SUPER,32)
rod('10 metre aft rangefinder',(-38.6,-5,20.1),(-38.6,5,20.1),.42,naval,SUPER,vertices=16)
rounded('Aft fire control head',-38.6,0,24.6,2.5,2.7,1.0,naval,SUPER)

# Narrow capsule uptake and raked rim from the approved model comparison.
# Derive shell bands and fittings from the same original blueprint rings.
fverts=S['funnel-jacket']['surface']['vertices']
frings=[[(-z,-x,y) for x,y,z in fverts[i:i+48]] for i in range(0,len(fverts),48)]
structure('funnel-jacket',FUNNEL)
cap=frings[-1];mesh('Funnel smoke opening',[(x,y,z-.14) for x,y,z in cap],[tuple(range(48))],dark,FUNNEL)
for row in frings[1:]:
 for i in range(48):rod('Funnel shell band',row[i],row[(i+1)%48],.045,edge,FUNNEL,vertices=6)
for j in (3,9,15,21,27,33,39,45):
 for a,b in zip(frings[1:],frings[2:]):rod('Funnel stiffener',a[j],b[j],.070,edge,FUNNEL,vertices=7)
for y in (-1.4,-.7,0,.7,1.4):
 extent=2.466+1.894*math.sqrt(1-(y/1.894)**2)
 rod('Funnel cap grille',(-23.3-extent,y,29.45-.15*extent),(-23.3+extent,y,29.45+.15*extent),.035,edge,FUNNEL,vertices=6)
funnel_support=SupportSurface(FUNNEL.objects)
for side in (-1,1):
 # Bent external steam lines follow the rake on the narrow capsule shell.
 for offset in (-2.0,0,2.0):
  route=[(-19.1+offset,side*3.18,15.0),(-20.7+offset,side*2.60,19.5),(-21.7+offset,side*2.08,23.5),(-23.1+offset,side*2.08,28.8)]
  for a,b in zip(route,route[1:]):rod('Funnel steam line',a,b,.10,edge,FUNNEL,vertices=12)
  for x,y,z in route[1:]:
   foot=funnel_support.along((x,y,z),(0,-side,0),8)
   rod('Steam pipe clamp',foot,(x,y,z),.052,edge,FUNNEL,vertices=8)

# Auxiliary directors, searchlights and Type 89 dual-purpose mounts.
def light(name,x,y,z,bearing):
 a=math.radians(bearing)
 def pt(f,s,h):return (x+f*math.cos(a)-s*math.sin(a),y+f*math.sin(a)+s*math.cos(a),z+h)
 cyl(name+' stand',(x,y,z+.4),.26,.8,naval,SUPER,16)
 rod(name+' casing',pt(-.48,0,1.4),pt(.48,0,1.4),.85,naval,SUPER,vertices=32)
 rod(name+' 150 cm reflector',pt(.49,0,1.4),pt(.51,0,1.4),.75,glass,SUPER,vertices=32)
 for s in (-.97,.97):
  rod(name+' cradle',pt(0,s,.25),pt(0,s,1.4),.07,edge,SUPER,vertices=8)
  rod(name+' axle',pt(0,s,1.4),pt(0,s*.78,1.4),.12,edge,SUPER,vertices=12)
 rod(name+' reflector horizontal brace',pt(.53,-.75,1.4),pt(.53,.75,1.4),.018,edge,SUPER,vertices=6)
 rod(name+' reflector vertical brace',pt(.53,0,.65),pt(.53,0,2.15),.018,edge,SUPER,vertices=6)
controller_support=SupportSurface(SUPER.objects)
for side in (-1,1):
 pts=[(.5,side*2.1),(2.72,side*2.1),(2.72,side*4.35),(2.40,side*4.82),(1.86,side*4.965),(1.07,side*4.74),(.5,side*3.55)]
 prism('Forward controller wing',pts,22.65,22.77,roof,SUPER)
 for x in (1.15,2.35):
  foot=controller_support.along((x,side*4.6,21.6),(0,-side,0),8)
  rod('Forward controller wing knee',foot,(x,side*4.65,22.70),.12,naval,SUPER,vertices=10)
searchlight_support=SupportSurface([*HULL.objects,*SUPER.objects])
for side in (-1,1):
 # Museum searchlight article explicitly describes three 150 cm lights per side.
 for xx,zz in [(-16.0,18.2),(-23.5,20.1),(-31.0,20.1)]:
  # The museum photograph shows a lower forward station and two raised tubs.
  cy=side*6.1
  outline=[(xx+1.8*math.cos(i*math.tau/24),cy+1.8*math.sin(i*math.tau/24)) for i in range(24)]
  floor=searchlight_support.below(xx,cy,zz-2.6)
  cyl('Searchlight lower pedestal',(xx,cy,(floor+zz-2.0)/2),.76,zz-2.0-floor+.02,naval,SUPER,24)
  cyl('Searchlight gallery support',(xx,cy,zz-1.0),.75,2.0,naval,SUPER,20,r2=1.8)
  prism('Searchlight gallery deck',outline,zz,zz+.18,roof,SUPER)
  perimeter_band('Searchlight gallery bulwark',outline,zz+.18,.7,naval,SUPER)
  light('150 cm searchlight',xx,cy,zz+.18,side*90)
 for xx,yy,zz in [(1.71,4.46,22.81),(4.54,1.63,26.13),(-38.85,6.24,15.07),(-8.14,5.62,17.87),(-11.25,6.03,18.72)]:
  floor=searchlight_support.below(xx,side*yy,zz)
  if zz-floor>.02:cyl('HA director foundation',(xx,side*yy,(floor+zz)/2),.65,zz-floor+.02,naval,SUPER,24)
  compact=zz==26.13
  width=2.169 if compact else 2.217
  height=1.284 if compact else 1.918
  shoulder=.35 if compact else .60
  cyl('HA director pedestal',(xx,side*yy,zz+(shoulder+.04)/2),.48,shoulder+.04,naval,SUPER,24)
  rounded('HA director hood',xx,side*yy,zz+shoulder,2.262 if compact else 2.206,width,height-shoulder,naval,SUPER,cut=.42)
  box('HA director optical window',(xx+1.11,side*yy,zz+height-.49),(.06,.85,.26),glass,SUPER)
  box('HA director window brow',(xx+1.15,side*yy,zz+height-.30),(.20,1.03,.08),edge,SUPER)


# Heavy AA uses blueprint joints; 25 mm fittings retain visual assembly ownership.
# Counts, detailed positions and performance remain under review.
def blast_shield(name,x,y,z,length,width,height,bearing):
 # Rounded blast hoods, as photographed on the museum model. The roof curves
 # in the firing direction; the basic geometry is not a conical gun tub.
 ang=math.radians(bearing)
 profile=[(-.5,0),(.5,0),(.5,.34),(.47,.61),(.37,.83),(.19,.97),(-.06,1),(-.35,.97),(-.5,.84)]
 v=[]
 for side in (-1,1):
  for a,h in profile:
   b=side*width/2;v.append((x+a*length*math.cos(ang)-b*math.sin(ang),y+a*length*math.sin(ang)+b*math.cos(ang),z+h*height))
 n=len(profile);fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,v,fs,naval,AA)

def aa25(id,x,y,z,shield=True,bearing=90):
 before=set(scene.objects);ang=math.radians(bearing)
 def pt(a,b,h):return (x+a*math.cos(ang)-b*math.sin(ang),y+a*math.sin(ang)+b*math.cos(ang),z+h)
 cyl(id+' base',(x,y,z+.18),1.42,.36,roof,AA,20)
 if shield:
  blast_shield(id+' rounded shield',x,y,z+.25,2.65,2.5,1.95,bearing)
  for b in (-.24,0,.24):
   for a,aa,h,hh in [(.18,.66,1.96,1.83),(.66,1.08,1.83,1.48),(1.08,1.23,1.48,1.02)]:
    rod(id+' gun slot',pt(a,b,h+.25),pt(aa,b,hh+.25),.07,dark,AA,vertices=8)
 else:
  cyl(id+' pedestal',(x,y,z+.63),.26,.95,naval,AA,12)
  rounded(id+' seat',x-.45*math.cos(ang),y-.45*math.sin(ang),z+.45,1.3,1.6,.28,naval,AA)
  # Triple cradle joins the three breeches to the pedestal. Each barrel used
  # to be an isolated pair of rods above the top of the stand.
  rod(id+' trunnion axle',pt(0,-.42,1.30),pt(0,.42,1.30),.14,edge,AA,vertices=12)
  for b in [-.38,.38]:rod(id+' carriage cheek',pt(0,b,.70),pt(0,b,1.30),.11,naval,AA,vertices=10)
  rod(id+' carriage crosshead',pt(0,-.38,.78),pt(0,.38,.78),.12,naval,AA,vertices=10)
 for b in (-.24,0,.24):
  rod(id+' breech',pt(-.25,b,1.3),pt(.55,b,1.48),.14,naval,AA,vertices=8)
  rod(id+' 25 mm barrel',pt(.45,b,1.45),pt(2.05,b,1.86),.055,edge,AA,r2=.038,vertices=8)
 for ob in set(scene.objects)-before:ob['assemblyId']=id

def aa127(mount,shield):
 id=mount['id'];w=mount['weapon'];px,pz,py=mount['position'];x,y,z=-py,-px,pz
 platform=cyl(id+' platform',(x,y,z+.2),2.35,.4,roof,AA,32);platform['assemblyId']=id
 before=set(scene.objects)
 cyl(id+' pivot',(0,0,.65),.85,.9,naval,AA,24)
 if shield:
  blast_shield(id+' rounded blast shield',0,0,.35,4.5,4.1,2.65,0)
 else:
  rod(id+' saddle',(0,-1.3,.9),(0,1.3,.9),.22,naval,AA,vertices=12)
  rod(id+' trunnion axle',(w['trunnionForward'],-1.3,w['pivotHeight']),(w['trunnionForward'],1.3,w['pivotHeight']),.21,edge,AA,vertices=12)
  for b in (-1.3,1.3):
   box(id+' trunnion shield',(.15,b,1.4),(1.8,.12,2.1),naval,AA)
 frame=set(scene.objects)-before;barrels=[]
 direction=Vector((math.cos(math.radians(1)),0,math.sin(math.radians(1))))
 for b in (w['barrelSpacing']/2,-w['barrelSpacing']/2):
  start=Vector((w['trunnionForward'],b,w['pivotHeight']));tip=start+direction*(w['muzzleForward']-w['trunnionForward'])
  barrels.append([
   rod(id+' breech',start-direction*1.55,start+direction*.2,.28,naval,AA,vertices=12),
   rod(id+' 127 mm barrel',start,tip,.17,edge,AA,r2=.1,vertices=12),
  ])
 articulate_aa(mount,AA,frame,barrels)
# Build the galleries before sampling foundations; a gun must not raycast its
# own platform as the support beneath it.
for side in (-1,1):
 structure(f'aa-gallery-{side}',AA)
aa_support=SupportSurface([*HULL.objects,*SUPER.objects,*AA.objects,*GUNS.objects])
def aa_foundation(name,x,y,top,radius):
 floor=aa_support.below(x,y,top)
 if top-floor>.015:
  return cyl(name,(x,y,(floor+top)/2),radius,top-floor+.02,naval,AA,24)
for mount in D['mounts']:
 if mount['partId']=='type89-127-yamato-twin':
  # Lower mounts have blast hoods; upper mounts retain their repaired supports.
  shield=int(mount['id'].rsplit('-',1)[1])<=3
  px,pz,py=mount['position']
  if shield:
   cyl('Raised HA sponson',(-py,-px,pz-2.55),3.05,5.1,naval,SUPER,28)
  else:
   foundation=aa_foundation('Open HA mount raised foundation',-py,-px,pz,2.35)
   if foundation:foundation['assemblyId']=mount['id']
  aa127(mount,shield)
for side in (-1,1):
 # Dense outer rows and the curved ends of the AA citadel.
 for i,(xx,yy,zz) in enumerate([(-7.8,18,9),(-13.4,18.5,9),(-19,18.5,9),(-24.6,18.5,9),(-30.2,18.5,9),(-35.5,15.8,10),(-39,12.3,11),(-41,8.5,11.4),(0,14.8,10),(.4,10.5,11.4),(-.3,6.9,12.1),(-37.7,5.5,13.3)]):
  aa_foundation('25 mm gallery base',xx,side*yy,zz,1.6)
  aa25(f'aa-citadel-{side}-{i+1}',xx,side*yy,zz,True,side*90)
 for i,(xx,yy) in enumerate([(-50,10.7),(-45,13.0),(-40,14.2),(18,11.0),(26,12.0),(36,10.6),(-72,10.5)]):
  aa_foundation('Deck 25 mm foundation',xx,side*yy,deck(xx)+.12,1.40)
  aa25(f'aa-deck-{side}-{i+1}',xx,side*yy,deck(xx)+.12,False,side*90)
 for i,xx in enumerate((-105,-98)):
  rounded('Quarterdeck AA sponson',xx,side*12.5,5.7,5.5,7.0,.90,naval,AFT)
  aa25(f'aa-quarter-{side}-{i+1}',xx,side*14.4,6.6,True,side*90)
 aa25(f'aa-stern-{side}',-127,side*3.4,5.8,False,180)
 for i,xx in enumerate((-33,-17)):
  aa_foundation('Upper 25 mm foundation',xx,side*4.2,18.3,1.4)
  aa25(f'aa-upper-{side}-{i+1}',xx,side*4.2,18.3,False,side*90)
 for m in D['mounts'][1:3]:
  # Roof mounts move with the main gunhouse, independently of the barrels.
  mx=-m['position'][2];rear=math.cos(math.radians(m['bearingDeg']));before=set(scene.objects)
  aa_foundation('Turret roof 25 mm plinth',mx-4.4*rear,side*4,m['position'][1]+6.75,1.40)
  aa25(f'aa-roof-{m["id"]}-{side}',mx-4.4*rear,side*4,m['position'][1]+6.75,False,side*90)
  bpy.context.view_layer.update();yaw=bpy.data.objects[m['id']+'.yaw']
  for ob in set(scene.objects)-before:
   world=ob.matrix_world.copy();ob.parent=yaw;ob.matrix_world=world
# Six single 25 mm fittings, separate authored assemblies.
for i,(x,y) in enumerate([(-119,-4),(-119,4),(-93,-9),(-93,9),(-53,-5),(-53,5)]):
 z=deck(x);cyl(f'aa-single-{i+1} pedestal',(x,y,z+.6),.15,1.2,naval,AA,12)
 rod(f'aa-single-{i+1} barrel',(x,y,z+1.2),(x+1.35,y,z+1.7),.048,edge,AA,vertices=8)

# Tripod mainmast and open radar aerials. Sizes are interpreted from elevations.
for a in [(-28,-3.8,16),(-28,3.8,16),(-35,0,14)]:rod('Tripod mast leg',a,(-37,0,39.6),.24,edge,MAST,r2=.13,vertices=12)
rod('Mainmast yard',(-34.5,-12,33),(-34.5,12,33),.12,edge,MAST,vertices=10)
for z in (24,29,34):
 t=(z-16)/(39.6-16);xx=-28-9*t;yy=3.8*(1-t)
 rod('Mast cross brace',(xx,-yy,z),(xx,yy,z),.1,edge,MAST,vertices=8)
# The aft signal outrigger is a braced extension of the tripod, as shown in
# the retained 1945 elevation; its dimensions remain interpreted.
rod('Signal spar upper stay',(-37,0,39.6),(-43,0,36),.12,edge,MAST,vertices=8)
rod('Signal spar lower brace',(-36.1,0,28),(-43,0,36),.12,edge,MAST,vertices=8)
rod('Signal spar',(-43,-7,36),(-43,7,36),.075,wire,MAST,vertices=8)
for side in (-1,1):
 for y in (2,4,6,8,10):rod('Signal halyard',(-34.5,side*y,33),(-29,side*5.8,16.4),.015,wire,MAST,vertices=5)
 for a,b in [((-37,0,39.6),(-1.76,0,39.4)),((-1.76,0,39.4),(128,0,12.0)),((-43,side*7,36),(-128,side*2,10.5))]:rod('Aerial wire',a,b,.018,wire,MAST,vertices=5)
radar_before=set(bpy.context.scene.objects)
# Type 21 frames follow the measured low rectangular screens over the aft arms.
for side in (-1,1):
 for y in (side*3.147,side*7.608):rod('Type 21 radar support',(-3.10,y,37.56),(-2.85,y,38.46),.065,edge,MAST,vertices=8)
 for y in (side*2.844,side*7.815):rod('Type 21 outer frame',(-2.85,y,38.436),(-2.85,y,39.714),.045,edge,MAST,vertices=8)
 for i in range(10):
  y=side*(3.147+i*(7.608-3.147)/9)
  rod('Type 21 array vertical',(-2.85,y,38.668),(-2.85,y,39.508),.025,edge,MAST,vertices=6)
 for z in (38.436,38.668,39.088,39.508,39.714):rod('Type 21 array horizontal',(-2.85,side*2.844,z),(-2.85,side*7.815,z),.028,edge,MAST,vertices=6)
radar_pivot('radar-21.yaw',(-1.76,0,37.55),(set(bpy.context.scene.objects)-radar_before)|main_director_parts)
tower_support=SupportSurface(SUPER.objects)
for side in (-1,1):
 outline=[(-2.52,side*3.25),(-2.52,side*5.35),(-2.15,side*5.79),(-.54,side*5.79),(-.17,side*5.35),(-.17,side*3.25)]
 prism('Type 22 radar wing',outline,31.53,31.65,roof,SUPER)
 for x in (-2.2,-.5):
  foot=tower_support.along((x,side*4.3,30.45),(0,-side,0),8)
  rod('Radar wing cantilever',foot,(x,side*5.6,31.55),.11,naval,SUPER,vertices=10)
 # The source platform has no high outboard rail in the horn sweep.
 perimeter_band('Radar wing edge',outline,31.65,.055,edge,SUPER,.045)
 cyl('Type 22 seated pedestal',(-1.322,side*5.424,31.78),.2175,.30,naval,MAST,16)
 radar_before=set(bpy.context.scene.objects)
 def radar_pt(f,h):return (-1.322+f*math.cos(math.radians(35)),side*(5.424+f*math.sin(math.radians(35))),31.53+h)
 rod('Type 22 radar upright',radar_pt(0,.34),radar_pt(0,1.33),.069,naval,MAST,vertices=12)
 for h,back,neck,front,r_mid,r_mouth in [(.771,.0075,.633,1.2075,.141,.258),(1.3005,-.5535,.066,.4965,.1305,.219)]:
  rod('Type 22 horn throat',radar_pt(back,h),radar_pt(neck,h),.069,naval,MAST,r2=r_mid,vertices=20)
  rod('Type 22 horn flare',radar_pt(neck,h),radar_pt(front,h),r_mid,naval,MAST,r2=r_mouth,vertices=20)
  rod('Type 22 horn aperture',radar_pt(front+.002,h),radar_pt(front+.008,h),r_mouth*.89,dark,MAST,vertices=20)
  rod('Type 22 horn saddle',radar_pt(0,h-.08),radar_pt(back+.17,h),.035,edge,MAST,vertices=8)
 radar_pivot('radar-22-'+('port' if side==1 else 'starboard')+'.yaw',(-1.322,side*5.424,31.53),set(bpy.context.scene.objects)-radar_before)
 for z in (30,33):rod('Type 13 mounting arm',(-35-2*(z-14)/25.6,0,z),(-35.5,0,z),.08,edge,MAST,vertices=8)
 rod('Type 13 aerial spine',(-35.5,0,29.8),(-35.5,0,34.2),.07,edge,MAST,vertices=8)
 for z in (30,31,32,33,34):rod('Type 13 aerial dipole',(-35.5,-.85,z),(-35.5,.85,z),.038,edge,MAST,vertices=6)

# Stern aircraft deck. Long transfer rails are distinct from the short catapults.
rounded('Aircraft handling deck',-97,0,5.72,60,23.5,.28,roof,AFT,cut=.25)
for side in (-1,1):
 for offset in (-.22,.22):rod('Aircraft transfer rail',(-111,side*9.7+offset,6.04),(-70,side*16+offset,8.0),.09,edge,AFT,vertices=8)
 aa=Vector((-127,side*10.3,7.0));bb=Vector((-109,side*9.7,7.0))
 for h in (0,.9):rod('Catapult longeron',aa+Vector((0,0,h)),bb+Vector((0,0,h)),.13,edge,AFT,vertices=10)
 for i in range(12):
  a=aa.lerp(bb,i/12);b=aa.lerp(bb,(i+1)/12)
  rod('Catapult lattice',a,b+Vector((0,0,.9)),.063,edge,AFT,vertices=7)
  rod('Catapult cross tie',a,a+Vector((0,0,.9)),.063,edge,AFT,vertices=7)
 cyl('Catapult turntable',(-115,side*10,6.45),1.4,1.1,naval,AFT,24)
# Central aircraft lift hatch and crane.
rounded('Aircraft lift hatch',-118,0,6.02,9.3,8.2,.13,dark,AFT)
cyl('Aircraft crane pedestal',(-106,0,7.2),1.6,2.5,naval,AFT,24)
rod('Crane heel bearing',(-106,-.8,8.7),(-106,.8,8.7),.22,naval,AFT,vertices=12)
cyl('Crane heel column',(-106,0,8.5),.55,.7,naval,AFT,20)
for xx,zz in [(-106,10.4),(-128,10.4)]:rod('Crane transverse tie',(xx,-.65,zz),(xx,.65,zz),.10,edge,AFT,vertices=8)
for y in (-.65,.65):
 rod('Crane boom chord',(-106,y,8.7),(-128,y,10.2),.12,edge,AFT,vertices=8)
 rod('Crane boom upper',(-106,y,10.4),(-128,y,10.4),.1,edge,AFT,vertices=8)
 for i in range(11):rod('Crane boom lattice',(-106-2*i,y,8.7+i*.135),(-108-2*i,y,10.4),.055,edge,AFT,vertices=6)
rod('Crane support mast',(-106,0,8),(-105,0,14),.2,naval,AFT,vertices=12)
rod('Crane hoist',(-105,0,14),(-128,0,10.4),.035,wire,AFT,vertices=6)
rod('Crane hook line',(-128,0,10.4),(-128,0,7.0),.035,wire,AFT,vertices=6)
# Boat-bay framing follows the recessed hull's actual floor and roof edges.
# Constant +/-14 m posts projected outside the narrowing stern, producing
# unsupported hanging legs even when their heads touched a crossbeam.
for side in (-1,1):
 for x in (-99,-94,-88,-83):
  y=side*(min(loft_breadth(H,x,2.45),loft_breadth(H,x,5.92))-.03)
  rod('Boat bay frame',(x,y,2.45),(x,y,5.92),.065,edge,AFT,vertices=8)
  rod('Boat bay frame head',(x,side*10.95,5.92),(x,y,5.92),.08,edge,AFT,vertices=8)

# Four screws and two rudders on the centreline in tandem.
for side in (-1,1):
 for prop_index,(sx,yy,ex) in enumerate([(-67,8.2,-106),(-78,4.8,-115)]):
  yy*=side;rod('Propeller shaft',(sx,yy,-7.3),(ex,yy,-7.8),.34,edge,UNDER,vertices=18)
  rod('Shaft support',(ex+3,yy,-7.7),(ex+9,yy*.72,-5),.24,hullgray,UNDER,vertices=12)
  rod('Screw hub',(ex-1.1,yy,-7.8),(ex+1.4,yy,-7.8),.59,bronze,UNDER,r2=.28,vertices=20)
  # Kure Museum gives 5 m diameter. Rounded, pitched blades are independently
  # authored from the museum's stern view, with opposite handedness port/stbd.
  for k in range(3):
   a=k*math.tau/3+(.2 if side<0 else 0);v=[];fs=[];rows=17;cols=9
   for i in range(rows):
    t=i/(rows-1);rad=.48+2.02*t
    half_angle=.13+.42*math.sin(math.pi*t)**.7
    if i==rows-1:half_angle=0
    for j in range(cols):
     u=2*j/(cols-1)-1;theta=a+side*(.26*t+u*half_angle)
     v.append((ex+.18*t+side*u*(.45-.2*t)*math.sin(math.pi*t)**.5,yy+math.cos(theta)*rad,-7.8+math.sin(theta)*rad))
   for i in range(rows-1):
    for j in range(cols-1):
     n=i*cols+j;fs.append((n,n+1,n+1+cols,n+cols))
   o=mesh('Five metre three-bladed screw',v,fs,bronze,UNDER,True)
   o['assemblyId']=f'propeller-{"port" if side>0 else "starboard"}-{"outer" if prop_index==0 else "inner"}'
   mod=o.modifiers.new('Cast blade thickness','SOLIDIFY');mod.thickness=.055
# Rounded aft edges and stepped balance portions replace the rectangular slabs.
# Museum photographs establish the silhouette; exact stock stations are pending.
for name,x,z,sx,sz in [('Main rudder',-121,-7.8,7.3,5.1),('Auxiliary rudder',-105,-8.3,4.8,3.9)]:
 outline=[(-.5,.5),(.10,.5),(.10,-.08),(.5,-.08),(.5,-.39),(.43,-.5),(-.43,-.5),(-.5,-.39)]
 v=[(x+a*sx,side*.22,z+b*sz) for side in (-1,1) for a,b in outline];n=len(outline)
 fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 o=mesh(name,v,fs,red,UNDER);o['assemblyId']=name.lower().replace(' ','-')
 # The museum's underside view shows a stock entering the hull above each blade.
 foot=SupportSurface([hull]).along((x-sx*.2,0,z+sz*.5),(0,0,1),12)
 stock=rod(name+' stock',(x-sx*.2,0,z+sz*.35),foot,.26,hullgray,UNDER,vertices=16)
 stock['assemblyId']=o['assemblyId']
 for dz in (-.35,-.1,.15,.38):rod('Rudder plating seam',(x-sx*.46,-.225,z+sz*dz),(x+sx*(.43 if dz<-.1 else .06),-.225,z+sz*dz),.025,hullgray,UNDER,vertices=6)
for side in (-1,1):
 mesh('Bilge keel',[(-68,side*16,-8.3),(41,side*16,-8.3),(39,side*17.0,-9.4),(-66,side*17.0,-9.4)],[(0,1,2,3)],red,UNDER)

# Foredeck anchor gear and scattered fittings.
for side in (-1,1):
 cyl('Anchor capstan',(95,side*3.5,deck(95)+.6),.9,1.2,edge,DECK,24)
 # Source anchor shanks fall forward beneath the forecastle flare. Their
 # upper hawse collars sit through the deck; the crown and flukes hang from it.
 top=(125.35,side*3.95,9.44);bottom=(128.45,side*3.84,7.86)
 mouth_z=deck(125.35)
 cyl('Hawse mouth collar',(125.35,side*3.95,mouth_z+.08),.40,.28,hullgray,DECK,24)
 rod('Hawse seating',(125.35,side*3.95,mouth_z-.08),top,.20,hullgray,DECK,vertices=16)
 rod('Anchor shank',top,bottom,.16,edge,DECK,vertices=12)
 rod('Anchor crown',(128.45,side*2.96,7.82),(128.45,side*4.70,7.82),.23,edge,DECK,vertices=12)
 for offset in (-.76,.76):
  y=side*3.84+offset
  rod('Anchor curved arm',(128.45,side*3.84,7.86),(127.55,y,7.30),.19,edge,DECK,vertices=12)
  mesh('Anchor fluke',[(127.7,y-.24,7.28),(127.7,y+.24,7.28),(126.4,y+.35,8.74),(126.4,y-.35,8.74),(127.9,y-.24,7.37),(127.9,y+.24,7.37)],[(0,1,2,3),(4,3,2,5),(0,4,5,1),(0,3,4),(1,5,2)],edge,DECK)
 for x in (70,83,103,115,-57,-78,-118):
  y=side*max(1,breadth(x)-1.2);z=deck(x)
  for dx in (-.4,.4):cyl('Mooring bollard',(x+dx,y,z+.42),.23,.8,edge,DECK,12)
  box('Bollard bed',(x,y,z+.08),(1.8,.85,.14),roof,DECK)
 for x in (-60,-52,-43,-31,-17,12,23,61):
  y=side*min(10,breadth(x)-1.6);z=deck(x)
  rounded('Ventilator',x,y,z,1.3,.9,.8,naval,DECK)
  box('Ventilator grille',(x+.66,y,z+.5),(.025,.72,.42),dark,DECK)
for x,y in [(87,0),(58,-5),(58,5),(-57,6),(-59,-6),(20,9)]:rounded('Deck access hatch',x,y,deck(x)+.06,2.1,1.3,.18,roof,DECK)
# Breakwater sweeps aft of the forecastle gear.
for side in (-1,1):
 for i in range(14):
  y=side*(i+.5)*.85;x=67-3.2*(abs(y)/12)**2;z=deck(x)
  o=box('Foredeck breakwater',(x,y,z+.5),(.16,.90,1.0),naval,DECK);o.rotation_euler.z=-side*.4
for x,height in ((130,4.5),(-130,7.6)):
 rod('Jack staff',(x,0,deck(x)),(x,0,deck(x)+height),.065,edge,MAST,r2=.035,vertices=10)

# Original one-metre gilded bow chrysanthemum. Kure's 2026 museum renewal
# report corrects the former 1.5 m estimate using the 2016 wreck survey.
# Petal relief and the local bow bulwark are interpretations of retained photos;
# no photo pixels or external mesh enter this construction.
crestcol=group('10 Bow chrysanthemum')
gold=mat('Chrysanthemum gold leaf',(.83,.52,.105),.78,.34)
goldshadow=mat('Chrysanthemum recessed gold',(.36,.205,.037),.65,.42)
crest_x=L/2+.055;crest_z=deck(L/2)+.77
# A solid curved bulwark, seated through the existing forecastle deck, supports
# the ornament. Its return wings follow the authored sheer rather than floating
# a disc in front of the pointed stem.
outline=[]
for side,offsets in [(-1,[3.2,2.7,2.1,1.5,1.0,.6,.3,.12,0]),(1,[.12,.3,.6,1.0,1.5,2.1,2.7,3.2])]:
 for offset in offsets:
  x=L/2-offset;y=side*max(0,breadth(x)-.045)
  height=1.18+.32*math.exp(-offset*1.7)-.15*math.sin(offset*2)
  outline.append((x,y,deck(x)-.065,height))
v=[]
for x,y,z,h in outline:
 v.extend([(x,y,z),(x,y,z+h),(x-.075,y*.992,z),(x-.075,y*.992,z+h)])
fs=[]
for i in range(len(outline)-1):
 a=i*4;b=a+4
 fs.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a+1,b+1,b+3,a+3),(a,a+2,b+2,b)])
fs.extend([(0,1,3,2),tuple((len(outline)-1)*4+j for j in [0,2,3,1])])
support=mesh('Crest bow bulwark',v,fs,hullgray,crestcol)
support['assemblyId']='bow-crest-support'
for a,b in zip(outline,outline[1:]):
 rim=rod('Bow bulwark rolled lip',(a[0],a[1],a[2]+a[3]),(b[0],b[1],b[2]+b[3]),.037,edge,crestcol,vertices=8)
 rim['assemblyId']='bow-crest-support'
back=rod('Chrysanthemum seated backing',(crest_x-.23,0,crest_z),(crest_x+.025,0,crest_z),.455,goldshadow,crestcol,vertices=64)
back['assemblyId']='bow-crest'

def crest_petal(name,angle,depth,finish,radial_center,radial_radius,tangent_radius):
 # Closed rounded relief, with a domed face and a flat back joined to the boss.
 n=32;vs=[]
 for scale,raised in [(1,0),(1,.018),(.70,depth*.78)]:
  for i in range(n):
   t=math.tau*i/n;r=radial_center+radial_radius*math.cos(t)*scale;w=tangent_radius*math.sin(t)*scale
   vs.append((crest_x+raised,r*math.sin(angle)+w*math.cos(angle),crest_z+r*math.cos(angle)-w*math.sin(angle)))
 vs.append((crest_x+depth,radial_center*math.sin(angle),crest_z+radial_center*math.cos(angle)))
 faces=[tuple(reversed(range(n)))]
 for j in range(2):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 faces.extend((2*n+i,2*n+(i+1)%n,3*n) for i in range(n))
 ob=mesh(name,vs,[tuple(reversed(face)) for face in faces],finish,crestcol,True);ob['assemblyId']='bow-crest'
 return ob
for i in range(16):
 crest_petal('Chrysanthemum rear petal %02d'%i,(i+.5)*math.tau/16,.055,goldshadow,.315,.18,.067)
 crest_petal('Chrysanthemum front petal %02d'%i,i*math.tau/16,.13,gold,.29,.21,.079)
hub=rod('Chrysanthemum central boss',(crest_x-.01,0,crest_z),(crest_x+.155,0,crest_z),.082,gold,crestcol,vertices=48,r2=.074)
hub['assemblyId']='bow-crest'
# Discrete glazed portholes avoid unsupported shader tricks.
for side in (-1,1):
 for i in range(92):
  x=-119+i*2.65;z=min(deck(x)-1.45,5.9);y=side*(loft_breadth(H,x,z)-.04)
  if -74<x<62 and i%3:continue
  rod('Hull scuttle',(x,y,z),(x,y+side*.065,z),.12,dark,HULL,vertices=10)
# Reference-led service details: Kure bridge/forward-turret photographs, S-06-2
# gallery arrangement and O-45 machinery. Dimensions remain authored estimates.
fm=dict(**materials,glass=glass)
fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,SUPER)
for side in [-1,1]:
 fit.stairs('Lower bridge stair',(-8.5,side*4.8,18.7),(-5.5,side*4.8,22.25))
 fit.stairs('Tower access stair',(-4.5,side*4.25,22.25),(-1.3,side*4.25,25.77),.68)
 for x,z,w in [(-9,9.7,2.3),(-18,9.7,2.2),(-27,9.7,2.2),(-36,9.7,1.8)]:fit.vent('Shelter ventilation',x,side*(6.5 if x==-3 else 10.8),z,w,1.25)
 for x in [-12,-34]:fit.door('Shelter access',x,side*10.8,8.7)
 for x in [-32,-26,-20,-14,-8]:fit.knee('AA gallery bracket',x,side*16.5,side*20.1,8.5,1.2)
 # Raised directors have sight slits and split hoods instead of blank drums.
 for x,z in [(-38.6,23),(-1.76,39.4)]:
  for dx in [-.65,.65]:
   yy=(2.05 if x==-38.6 else 1.8)*math.sqrt(1-(dx/(2.05 if x==-38.6 else 1.8))**2)
   box('Director optical slit',(x+dx,side*(yy-.035),z),(.38,.12,.20),glass,SUPER)
fit.col=FUNNEL
for side in [-1,1]:
 fit.ladder('Funnel inspection ladder',(-19.6,side*2.88,17),(-23.25,side*2.02,29.7),.58)
 for x in [-21.5,-17.2]:
  fit.vent('Funnel base air intake',x,side*3.60,13.4,2.0,1.7)
fit.col=DECK
for side in [-1,1]:
 for x in [59,76,87,-57,-75]:fit.reel('Mooring line reel',x,side*min(12,breadth(x)-2),deck(x)+.025,.58,1.4)
 for x in [82,-62]:
  fit.door('Deck trunk access',x,side*3.2,deck(x),.7,1.2)
  rounded('Companionway coaming',x,side*3.0,deck(x),1.5,1.1,1.3,naval,DECK)
 # Chain links follow the rising forecastle; machinery has a warping head.
 for start,end in [(95,100),(100,105),(105,110),(110,115),(115,120),(120,125.35)]:
  ya=side*(3.5+.45*(start-95)/30.35);yb=side*(3.5+.45*(end-95)/30.35)
  fit.chain('Bower anchor chain',(start,ya,deck(start)+.12),(end,yb,deck(end)+.12),.5)
 for x in [95]:
  cyl('Windlass gear casing',(x-1.1,side*3.5,deck(x)+.43),.68,.78,naval,DECK,32)
  rod('Windlass axle',(x-1.1,side*2.65,deck(x)+.65),(x-1.1,side*4.35,deck(x)+.65),.18,edge,DECK,vertices=16)
  fit.ring('Windlass brake wheel',(x-1.1,side*4.4,deck(x)+.65),.37,.043,'y')
  for a in (0,math.pi/2):rod('Windlass brake spoke',(x-1.1-.37*math.cos(a),side*4.4,deck(x)+.65-.37*math.sin(a)),(x-1.1+.37*math.cos(a),side*4.4,deck(x)+.65+.37*math.sin(a)),.035,edge,DECK,vertices=6)
fit.col=AFT
for side in [-1,1]:
 fit.reel('Aircraft crane winch',-104,side*1.5,6.0,.52,1.2)
 for i,x in enumerate([-97.5,-86.5]):fit.boat('Recessed motor launch',x,side*12.0,2.9,11 if i==0 else 9,2.0,i==0)
 for x in [-122,-116]:
  fit.ring('Catapult carriage wheel',(x,side*10.0,7.1),.21,.045,'y',segments=12)
 for x in [-99,-94,-88,-83]:
  rod('Boat bay upper beam',(x,side*10.95,5.92),(x,side*(loft_breadth(H,x,5.92)-.03),5.92),.08,naval,AFT,vertices=8)
 fit.ladder('Aircraft deck access',(-75,side*9,5.95),(-70,side*9,8.0),.7)
scene['definitionHash']=D['contentHash'];scene['configuration']=D['configuration']
scene['historicalAccuracy']='GameModels3D pjsb018 geometry comparison; not historical certification'
from blender_rig import create_flagstaffs
create_flagstaffs(D)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,dict(materials,teak=teak,underwater=red),Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('Authored Yamato:',len(scene.objects),'objects',flush=True)

"""Original Yamato exterior reconstruction. All geometry is authored here, in metres.

Bow +X, port +Y, up +Z, trial waterline Z=0. The blueprint owns dimensions and
weapon placement. Numeric interpretations are tracked in reports/discrepancies.md.
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

def smooth_interp(st,t):
 # Shape-preserving cubic interpolation: no overshoot beyond the authored stem.
 if t<=st[0][0]:return st[0][1]
 if t>=st[-1][0]:return st[-1][1]
 slopes=[(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(st,st[1:])]
 tangent=[slopes[0]]
 for a,b in zip(slopes,slopes[1:]):tangent.append(0 if a*b<=0 else 2*a*b/(a+b))
 tangent.append(slopes[-1])
 for i,((a,va),(b,vb)) in enumerate(zip(st,st[1:])):
  if a<=t<=b:
   u=(t-a)/(b-a);return (2*u**3-3*u*u+1)*va+(u**3-2*u*u+u)*(b-a)*tangent[i]+(-2*u**3+3*u*u)*vb+(u**3-u*u)*(b-a)*tangent[i+1]

# Lofted hull, with the forefoot cut back at the waterline and a lower bulb.
# Section fullness is interpreted until original hull lines can be measured.
stations=sorted(set([i*L/180 for i in range(181)]+[p[0] for k in ('halfBreadths','deckHeights','keelHeights') for p in H[k]]))
vs=[];rings=[]
for s in stations:
 x=s-L/2;w=breadth(x);zt=deck(x);zb=interp(H['keelHeights'],s)
 fore=max(0,min(1,(x-65)/60));stern=max(0,min(1,(-x-85)/44))
 # S-06-2 printed p.10 gives 36.9 m trial waterline beam. The shell flares
 # above it and encloses the underwater bulge; it is not a vertical box side.
 wl_ratio=36.9/H['beam']
 contour=[(1,zt),(.975,zt*.56),(wl_ratio-fore*.13,0),(.986-fore*.22,zb*.28),(.996-fore*.32,zb*.55),(.948-fore*.26,zb*.79),(.84-fore*.17,zb*.93),(.65-fore*.12,zb*.989),(.32,zb),(0,zb)]
 # Densify each vertical segment before bending the cutwater. Its silhouette
 # now follows the continuous curve instead of nine large straight edges.
 contour=[(a[0]+(b[0]-a[0])*i/4,a[1]+(b[1]-a[1])*i/4) for a,b in zip(contour,contour[1:]) for i in range(4)]+[contour[-1]]
 ring=[]
 for side in (1,-1):
  points=contour if side==1 else list(reversed(contour[:-1]))
  for width,z in points:
   # Interpreted side-profile cutwater. The upper stem retains the 263 m datum.
   cut=fore**5*smooth_interp([(-10.4,6.0),(-9.6,4.0),(-8.5,2.8),(-7.5,2.4),(-6,3.0),(-4,5.3),(-2,6.8),(0,7.0),(3,4.3),(6,1.8),(9.4,0)],z)
   ring.append(len(vs));vs.append((x-cut,w*width*side,z))
 rings.append(ring)
faces=[]
for a,b in zip(rings,rings[1:]):
 for j in range(len(a)):faces.append((a[j],b[j],b[(j+1)%len(a)],a[(j+1)%len(a)]))
faces.extend([tuple(reversed(rings[0])),tuple(rings[-1])])
hull=mesh('Yamato hull envelope',vs,faces,hullgray,HULL,True);hull['nodeId']='hull.surface';hull['assemblyId']='hull';hull.data.materials.append(red)
for p in hull.data.polygons:
 z=sum(hull.data.vertices[i].co.z for i in p.vertices)/len(p.vertices)
 if z<-.02:p.material_index=1

# Deck planks are an original material; steel strips and ends are separate meshes.
for i,(sa,sb) in enumerate(zip(stations,stations[1:])):
 a,b=sa-L/2,sb-L/2;wa,wb=breadth(a),breadth(b);za,zb=deck(a)+.035,deck(b)+.035
 material=teak if -69<(a+b)/2<85 else roof
 mesh('Deck surface',[(a,-wa,za),(b,-wb,zb),(b,wb,zb),(a,wa,za)],[(0,1,2,3)],material,DECK)
 for side in (-1,1):
  mesh('Steel deck margin',[(a,side*wa,za+.02),(b,side*wb,zb+.02),(b,side*max(0,wb-.55),zb+.02),(a,side*max(0,wa-.55),za+.02)],[(0,1,2,3)],roof,DECK)
  if i%2==0 and wa>2:
   rod('Rail stanchion',(a,side*(wa-.15),za),(a,side*(wa-.15),za+.95),.033,edge,DECK,vertices=6)
  for h in (.4,.92):
   rod('Deck guard wire',(a,side*max(0,wa-.15),za+h),(b,side*max(0,wb-.15),zb+h),.014,wire,DECK,vertices=5)

# Main batteries retain all barrel pivots, recoil joints and sockets.
materials=dict(naval=naval,roof=roof,edge=edge,hullgray=hullgray,canvas=canvas,dark=dark)
for mount in D['mounts']:
 create_gun_mount(mount,GUNS,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deck)

# Bridge outlines and gallery construction are original geometry interpreted
# from the museum's bridge photograph. Elevations remain provisional (Y-07).
def bridge_outline(x,sx,sy):
 return [(x+a*sx,b*sy) for a,b in [(-.5,-.35),(-.39,-.5),(.10,-.5),(.33,-.43),(.5,-.23),(.5,.23),(.33,.43),(.10,.5),(-.39,.5),(-.5,.35)]]

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

def bridge_gallery(name,x,z,sx,sy,wall_height=1.05):
 outline=bridge_outline(x,sx,sy);prism(name+' deck',outline,z,z+.19,roof,SUPER)
 perimeter_band(name+' splinter wall',outline,z+.19,wall_height,naval,SUPER)
 for (a,b),(c,d) in zip(outline,outline[1:]+outline[:1]):
  rod(name+' cap rail',(a,b,z+.19+wall_height),(c,d,z+.19+wall_height),.035,edge,SUPER,vertices=6)
 # Plate knees visibly support the overhang below each gallery.
 for xx,yy in outline:
  if xx<x-sx*.35:continue
  v=[(xx,yy,z),(x+(xx-x)*.68,yy*.68,z),(x+(xx-x)*.68,yy*.68,z-1.05)]
  mesh(name+' support knee',v,[(0,1,2)],edge,SUPER)

def bridge_windows(name,x,z,sx,sy,height=.72):
 outline=bridge_outline(x,sx,sy)
 perimeter_band(name+' glazing',outline,z,height,glass,SUPER,.025)
 for (a,b),(c,d) in zip(outline,outline[1:]+outline[:1]):
  count=max(1,math.ceil(math.hypot(c-a,d-b)/.74))
  for i in range(count):
   t=i/count;xx=a+(c-a)*t;yy=b+(d-b)*t
   rod(name+' mullion',(xx,yy,z-.04),(xx,yy,z+height+.04),.033,naval,SUPER,vertices=6)
 perimeter_band(name+' sill',outline,z-.09,.09,naval,SUPER,.10)
 perimeter_band(name+' lintel',outline,z+height,.10,naval,SUPER,.10)

# Broad machinery deck and compact tower; no Bismarck superstructure is reused.
rounded('Central shelter deck',-19,0,8.515,55,21.5,2.285,naval,SUPER)
prism('Forward bridge foundation',bridge_outline(-3.2,13.8,14.3),10.8,18.2,naval,SUPER)
# Rounded armored conning tower projects from the forward foundation.
o=cyl('Forward conning tower',(3.0,0,13.6),4.2,5.2,hullgray,SUPER,48);o.scale.x=.86
o=cyl('Conning tower roof',(3.0,0,16.25),4.3,.20,roof,SUPER,48);o.scale.x=.86
for i in range(13):
 a=-math.pi*.7+i*math.pi*1.4/12
 p=(3+3.64*math.cos(a),4.23*math.sin(a),15.3)
 q=(3+3.67*math.cos(a),4.27*math.sin(a),15.3)
 rod('Conning tower vision slit',p,q,.10,dark,SUPER,vertices=8)
prism('Bridge trunk lower',bridge_outline(-3,11,10.5),18.2,24.8,naval,SUPER)
prism('Operations room tower',bridge_outline(-3.6,8,8.5),24.8,31.2,naval,SUPER)
bridge_gallery('Lower bridge lookout',-1.5,18.3,17.8,16.6,.95)
bridge_windows('Second navigation bridge',-2.3,21.15,13.4,12.9)
bridge_gallery('Second bridge lookout',-2.3,22.0,14.3,14.2,1.0)
prism('First navigation bridge lower wall',bridge_outline(-3.5,9.5,11.8),31.1,31.85,naval,SUPER)
bridge_windows('First navigation bridge',-3.5,31.85,9.5,11.8,.83)
bridge_gallery('Air defence station',-3.5,32.8,10.1,12.2,1.25)
for side in (-1,1):
 for z in (25.7,28.0,30.1):
  for xx in (-5.4,-3.0):rod('Operations room scuttle',(xx,side*4.255,z),(xx,side*4.3,z),.14,dark,SUPER,vertices=12)
 for xx in (-5.8,-3.9,-2.0):
  cyl('Air defence binocular stand',(xx,side*4.9,33.45),.09,.9,naval,SUPER,12)
  rod('Air defence binocular', (xx-.25,side*4.9,33.95),(xx+.25,side*4.9,33.95),.11,dark,SUPER,vertices=10)
 # Side ladders and the forward tower's external stiffening are visible in
 # museum photographs; exact rung count and plate thickness are interpreted.
 for xx in (-6.8,-6.15):rod('Bridge access ladder rail',(xx,side*4.5,24),(xx,side*4.5,31.4),.038,edge,SUPER,vertices=6)
 for i in range(24):rod('Bridge access ladder rung',(-6.8,side*4.5,24+i*.30),(-6.15,side*4.5,24+i*.30),.025,edge,SUPER,vertices=6)
for side in (-1,1):
 rounded('Bridge wing binocular station',-2.6,side*7.0,18.5,5,3.3,.85,naval,SUPER)
 for x in (0,-2.7,-5.4):
  cyl('Binocular pedestal',(x,side*7,19.7),.14,.8,edge,SUPER,12)
  rod('Binocular optics',(x-.25,side*7,20.2),(x+.3,side*7,20.2),.16,dark,SUPER,vertices=10)
# Main director and its 15 metre optical base.
cyl('Main director rotating drum',(-3.5,0,35.1),3.1,2.3,naval,SUPER,40)
rod('15 metre bridge rangefinder',(-3.5,-7.5,35.4),(-3.5,7.5,35.4),.59,naval,SUPER,vertices=20)
for side in (-1,1):rounded('Main rangefinder end hood',-3.5,side*7.4,34.8,2.1,1.25,1.3,naval,SUPER)
cyl('Type 98 main director',(-3.2,0,37.35),1.8,2.2,naval,SUPER,40)
cyl('Director cap',(-3.2,0,38.5),1.9,.28,roof,SUPER,32)
for angle in (0,110,250):
 a=math.radians(angle)
 o=box('Director optical hood',(-3.2+1.8*math.cos(a),1.8*math.sin(a),37.55),(.65,1.1,.58),naval,SUPER);o.rotation_euler.z=a
 rod('Director optical aperture',(-3.2+2.13*math.cos(a),2.13*math.sin(a),37.55),(-3.2+2.16*math.cos(a),2.16*math.sin(a),37.55),.12,dark,SUPER,vertices=10)
rod('Director roof sight',(-2.7,0,38.64),(-2.7,0,39.10),.10,edge,SUPER,vertices=12)
# Aft director stands ahead of the after 15.5 cm turret.
rounded('Aft director foundation',-39,0,10.8,9,10,4.6,naval,SUPER)
cyl('Aft director column',(-38.6,0,18.1),2.4,5.5,naval,SUPER,32)
cyl('Aft director upper housing',(-38.6,0,22.8),2.05,3.9,naval,SUPER,32)
rod('10 metre aft rangefinder',(-38.6,-5,20.1),(-38.6,5,20.1),.42,naval,SUPER,vertices=16)
rounded('Aft fire control head',-38.6,0,24.6,2.5,2.7,1.0,naval,SUPER)

# Curved funnel uptake, from the naval damage section and museum silhouette.
# Each authored row is z, longitudinal centre, x radius, y radius. The cap is
# sloped with the rake; neither source establishes exact shell offsets.
funnel_sections=[(11,-19.1,8.2,4.65),(13,-19.8,7.9,4.55),(15,-21.0,6.8,4.35),(17,-22.1,5.7,4.10),(20,-23.1,4.55,3.9),(24,-24.35,4.15,3.72),(28,-25.55,4.1,3.60),(30.4,-26.25,4.05,3.55)]
def funnel_ring(z,x,sx,sy,cap_slope=0):return [(x+sx*math.cos(i*math.tau/48),sy*math.sin(i*math.tau/48),z+cap_slope*sx*math.cos(i*math.tau/48)) for i in range(48)]
frings=[funnel_ring(*row,.25 if i==len(funnel_sections)-1 else 0) for i,row in enumerate(funnel_sections)]
fv=[p for row in frings for p in row];ff=[]
for j in range(len(frings)-1):
 for i in range(48):ff.append((j*48+i,j*48+(i+1)%48,(j+1)*48+(i+1)%48,(j+1)*48+i))
mesh('Curved raked funnel uptake',fv,ff,naval,FUNNEL,True)
cap=frings[-1];mesh('Funnel smoke opening',[(x,y,z-.14) for x,y,z in cap],[tuple(range(48))],dark,FUNNEL)
for row in frings[1:]:
 for i in range(48):rod('Funnel shell band',row[i],row[(i+1)%48],.045,edge,FUNNEL,vertices=6)
for j in (3,9,15,21,27,33,39,45):
 for a,b in zip(frings[1:],frings[2:]):rod('Funnel stiffener',a[j],b[j],.070,edge,FUNNEL,vertices=7)
for y in (-2.6,-1.3,0,1.3,2.6):
 extent=4.05*math.sqrt(1-(y/3.55)**2)
 rod('Funnel cap grille',(-26.25-extent,y,30.42-.25*extent),(-26.25+extent,y,30.42+.25*extent),.045,edge,FUNNEL,vertices=6)
for side in (-1,1):
 for xx in (-30.6,-16):cyl('Steam pipe',(xx,side*3.3,17),.24,11.8,edge,FUNNEL,16)

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
for side in (-1,1):
 # Museum searchlight article explicitly describes three 150 cm lights per side.
 for xx,zz in [(-16.0,18.2),(-23.5,20.1),(-31.0,20.1)]:
  # The museum photograph shows a lower forward station and two raised tubs.
  cy=side*6.1
  outline=[(xx+1.8*math.cos(i*math.tau/24),cy+1.8*math.sin(i*math.tau/24)) for i in range(24)]
  cyl('Searchlight gallery support',(xx,cy,zz-1.3),.75,2.6,naval,SUPER,20,r2=1.8)
  prism('Searchlight gallery deck',outline,zz,zz+.18,roof,SUPER)
  perimeter_band('Searchlight gallery bulwark',outline,zz+.18,.7,naval,SUPER)
  light('150 cm searchlight',xx,cy,zz+.18,side*90)
 for xx,zz in [(0,21),(-6,25),(-35,16)]:
  cyl('HA director pedestal',(xx,side*5.9,zz),1.4,2,naval,SUPER,24)
  rounded('HA director hood',xx,side*5.9,zz+1,2.8,2.4,1.5,naval,SUPER)

# AA fittings retain stable assembly ownership; these are visual equipment like
# the baseline ship's AA. Counts and detailed positions remain under review.
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
 for b in (-.24,0,.24):
  rod(id+' breech',pt(-.25,b,1.3),pt(.55,b,1.48),.14,naval,AA,vertices=8)
  rod(id+' 25 mm barrel',pt(.45,b,1.45),pt(2.05,b,1.86),.055,edge,AA,r2=.038,vertices=8)
 for ob in set(scene.objects)-before:ob['assemblyId']=id

def aa127(id,x,y,z,shield,bearing):
 before=set(scene.objects);ang=math.radians(bearing)
 def pt(a,b,h):return (x+a*math.cos(ang)-b*math.sin(ang),y+a*math.sin(ang)+b*math.cos(ang),z+h)
 cyl(id+' platform',(x,y,z+.2),2.35,.4,roof,AA,32)
 cyl(id+' pivot',(x,y,z+.65),.85,.9,naval,AA,24)
 if shield:
  blast_shield(id+' rounded blast shield',x,y,z+.35,4.5,4.1,2.65,bearing)
 else:
  for b in (-1.3,1.3):
   o=box(id+' trunnion shield',pt(.15,b,1.4),(1.8,.12,2.1),naval,AA);o.rotation_euler.z=ang
 for b in (-.65,.65):
  rod(id+' breech',pt(-1,b,1.65),pt(.75,b,2.25),.28,naval,AA,vertices=12)
  rod(id+' 127 mm barrel',pt(.55,b,2.2),pt(4.8,b,3.9),.17,edge,AA,r2=.1,vertices=12)
 for ob in set(scene.objects)-before:ob['assemblyId']=id
for side in (-1,1):
 for i,xx in enumerate((-9,-19.5,-30)):
  cyl('Raised HA sponson',(xx,side*12.1,10.75),3.05,5.1,naval,SUPER,28)
  aa127(f'ha-{side}-{i+1}',xx,side*12.1,13.3,True,side*90)
 for i,xx in enumerate((-13.2,-24.2,-33.7)):
  aa127(f'ha-{side}-{i+4}',xx,side*7.3,15.1,False,side*90)
 # Dense outer rows and the curved ends of the AA citadel.
 for i,(xx,yy,zz) in enumerate([(-7.8,18,9),(-13.4,18.5,9),(-19,18.5,9),(-24.6,18.5,9),(-30.2,18.5,9),(-35.5,15.8,10),(-39,12.3,11),(-41,8.5,11.4),(0,14.8,10),(.4,10.5,11.4),(-.3,6.9,12.1),(-37.7,5.5,13.3)]):
  cyl('25 mm gallery base',(xx,side*yy,zz-.35),1.6,.7,naval,AA,20)
  aa25(f'aa-citadel-{side}-{i+1}',xx,side*yy,zz,True,side*90)
 for i,(xx,yy) in enumerate([(-50,10.7),(-45,13.0),(-40,14.2),(18,11.0),(26,12.0),(36,10.6),(-72,10.5)]):aa25(f'aa-deck-{side}-{i+1}',xx,side*yy,deck(xx)+.12,False,side*90)
 for i,xx in enumerate((-105,-98)):
  rounded('Quarterdeck AA sponson',xx,side*12.5,5.7,5.5,7.0,.75,naval,AFT)
  aa25(f'aa-quarter-{side}-{i+1}',xx,side*14.4,6.6,True,side*90)
 aa25(f'aa-stern-{side}',-127,side*3.4,5.8,False,180)
 for i,xx in enumerate((-33,-17)):aa25(f'aa-upper-{side}-{i+1}',xx,side*4.2,18.3,False,side*90)
 for m in D['mounts'][1:3]:
  # Roof mounts move with the main gunhouse, independently of the barrels.
  mx=-m['position'][2];rear=math.cos(math.radians(m['bearingDeg']));before=set(scene.objects)
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
for z in (24,29,34):rod('Mast cross brace',(-28-(z-16)*.38,-2,z),(-28-(z-16)*.38,2,z),.1,edge,MAST,vertices=8)
rod('Signal spar',(-43,-7,36),(-43,7,36),.075,wire,MAST,vertices=8)
for side in (-1,1):
 for y in (2,4,6,8,10):rod('Signal halyard',(-34.5,side*y,33),(-29,side*5.8,16.4),.015,wire,MAST,vertices=5)
 for a,b in [((-37,0,39.6),(-3.5,0,37.8)),((-3.5,0,37.8),(128,0,12.0)),((-43,side*7,36),(-128,side*2,10.5))]:rod('Aerial wire',a,b,.018,wire,MAST,vertices=5)
# Two Type 21 arrays sit over the ends of the 15 m rangefinder, as visible
# in the museum bridge photographs. Their framing remains interpreted.
for side in (-1,1):
 for y in (side*3.3,side*7.3):rod('Type 21 radar support',(-3.5,y,35.4),(-3.5,y,38.5),.08,edge,MAST,vertices=8)
 for i in range(9):
  y=side*(3.3+i*.5)
  rod('Type 21 array vertical',(-3.5,y,36.5),(-3.5,y,38.5),.035,edge,MAST,vertices=6)
 for z in (36.5,37.15,37.8,38.5):rod('Type 21 array horizontal',(-3.5,side*3.3,z),(-3.5,side*7.3,z),.035,edge,MAST,vertices=6)
for side in (-1,1):
 for z in (27.8,28.55):rod('Type 22 radar horn',(-1,side*5,z),(1.0,side*5,z),.19,naval,MAST,r2=.52,vertices=16)
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
for y in (-.65,.65):
 rod('Crane boom chord',(-106,y,8.7),(-128,y,10.2),.12,edge,AFT,vertices=8)
 rod('Crane boom upper',(-106,y,10.4),(-128,y,10.4),.1,edge,AFT,vertices=8)
 for i in range(11):rod('Crane boom lattice',(-106-2*i,y,8.7+i*.135),(-108-2*i,y,10.4),.055,edge,AFT,vertices=6)
rod('Crane support mast',(-106,0,8),(-105,0,14),.2,naval,AFT,vertices=12)
rod('Crane hoist',(-105,0,14),(-128,0,10.4),.035,wire,AFT,vertices=6)
rod('Crane hook line',(-128,0,10.4),(-128,0,7.0),.035,wire,AFT,vertices=6)
# Actual side boat recesses cut into the authored hull, with an inboard back wall.
for side in (-1,1):
 # Rounded ends visible in the museum's stern view. The bay length, height
 # and inboard limit remain interpreted, not newly certified measurements.
 outline=[]
 for xc,start in ((-114.8,math.pi/2),(-83.2,-math.pi/2)):
  for i in range(17):
   a=start+i*math.pi/16;outline.append((xc+1.7*math.cos(a),4.2+1.7*math.sin(a)))
 n=len(outline);v=[(x,y,z) for y in (side*11,side*25) for x,z in outline]
 fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 cutter=mesh('Temporary rounded boat bay cutter',v,fs,dark,AFT)
 bpy.context.view_layer.update()
 modifier=hull.modifiers.new('Boat bay opening','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
 bpy.context.view_layer.objects.active=hull
 bpy.ops.object.modifier_apply(modifier=modifier.name)
 bpy.data.objects.remove(cutter,do_unlink=True)
 rounded('Boat recess back wall',-99,side*11.03,2.5,35,.08,3.4,dark,AFT)
 for j,x in enumerate((-105,-92)):
  y=side*12.0;z=3.1;length=11 if j==0 else 9
  outline=[(x-length/2,y),(x-length*.34,y-1.05),(x+length*.38,y-1.05),(x+length/2,y),(x+length*.38,y+1.05),(x-length*.34,y+1.05)]
  prism('Motor launch hull',outline,z,z+1.0,naval,AFT);rounded('Motor launch cabin',x, y,z+1,4,1.5,.8,edge,AFT)
 for x in (-116,-110,-103,-96,-89,-82):rod('Boat bay frame',(x,side*14.0,2.6),(x,side*14.0,5.6),.065,edge,AFT,vertices=8)

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
 for dz in (-.35,-.1,.15,.38):rod('Rudder plating seam',(x-sx*.46,-.225,z+sz*dz),(x+sx*(.43 if dz<-.1 else .06),-.225,z+sz*dz),.025,hullgray,UNDER,vertices=6)
for side in (-1,1):
 mesh('Bilge keel',[(-68,side*16,-8.3),(41,side*16,-8.3),(39,side*17.0,-9.4),(-66,side*17.0,-9.4)],[(0,1,2,3)],red,UNDER)

# Foredeck anchor gear and scattered fittings.
for side in (-1,1):
 cyl('Anchor capstan',(95,side*3.5,deck(95)+.6),.9,1.2,edge,DECK,24)
 for i in range(46):
  t=i/45;x=94+t*32;y=side*(3.5+t*1.4);z=deck(x)+.17
  rod('Anchor chain link',(x-.21,y-.1,z),(x+.21,y+.1,z),.075,wire,DECK,vertices=6)
 rod('Anchor shank',(124,side*6.0,4.8),(121,side*6.7,3.6),.15,edge,DECK,vertices=12)
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
# Discrete glazed portholes avoid unsupported shader tricks.
for side in (-1,1):
 for i in range(92):
  x=-119+i*2.65;y=side*(breadth(x)+.016);z=min(deck(x)-1.45,5.9)
  if -74<x<62 and i%3:continue
  rod('Hull scuttle',(x,y,z),(x,y+side*.055,z),.12,dark,HULL,vertices=10)
scene['definitionHash']=D['contentHash'];scene['configuration']=D['configuration']
scene['historicalAccuracy']='Unverified reconstruction; see discrepancy register'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('Authored Yamato:',len(scene.objects),'objects',flush=True)

"""Shared scene, materials and primitives for the Yamato recipe modules.

Importing this module resets the Blender scene and reads the staged geometry
definition. Every region module does `from yamato_kit import *` so that its code
reads the same names as the original single-file recipe. Bow +X, port +Y, up +Z,
trial waterline Z=0; all dimensions are metres.
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
from library import create_mount as create_shared_mount
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

stations=[s['station'] for s in H['sections']]
S={s['id']:s for s in D['structures']}
def structure(id,col=SUPER):
 return authored_structure(S[id],mesh,dict(naval=naval,roof=roof),col)

materials=dict(naval=naval,roof=roof,edge=edge,hullgray=hullgray,canvas=canvas,dark=dark)

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

fm=dict(**materials,glass=glass)


def ha_director(xx,yy,zz,support,compact=False):
 # Type 95 (compact) and machine-gun control stations share one hooded form.
 floor=support.below(xx,yy,zz)
 if zz-floor>.02:cyl('HA director foundation',(xx,yy,(floor+zz)/2),.65,zz-floor+.02,naval,SUPER,24)
 width=2.169 if compact else 2.217
 height=1.284 if compact else 1.918
 shoulder=.35 if compact else .60
 cyl('HA director pedestal',(xx,yy,zz+(shoulder+.04)/2),.48,shoulder+.04,naval,SUPER,24)
 rounded('HA director hood',xx,yy,zz+shoulder,2.262 if compact else 2.206,width,height-shoulder,naval,SUPER,cut=.42)
 box('HA director optical window',(xx+1.11,yy,zz+height-.49),(.06,.85,.26),glass,SUPER)
 box('HA director window brow',(xx+1.15,yy,zz+height-.30),(.20,1.03,.08),edge,SUPER)

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
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount as create_shared_mount
from blender_rig import radar_pivot
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
# Teak weather decks: appearance.json names their stain and plank sizes; the game draws the planks.
materials['deck'].name='KGV teak deck'
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

def gallery(name,outline,z,wall=.95,brackets=True):
 prism(name+' deck',outline,z,.13,'roof');perimeter_wall(name+' bulwark',outline,z+.13,wall,.055)
 for x,y in outline:
  if brackets and abs(y)>4:mesh(name+' support bracket',[(x,y,z),(x,y*.73,z),(x,y*.73,z-1.1)],[(0,1,2)],'naval')

def gun_rod(name,a,b,r,material='edge',col=None,r2=None,vertices=10):
 # British gun slides were exposed; the generic helper's canvas bag is a
 # metal slide/jacket here, as seen in IWM A3655. The common joints stay intact.
 if 'canvas mantlet' in name:material=materials['edge'];name=name.replace('canvas mantlet','gun slide')
 return rod(name,a,b,r,material,col,r2,vertices)
COL=collections['Batteries']
for mount in D['mounts']:
 if mount['weapon'].get('mountingStyle')=='pom-pom':continue
 ASSEMBLY=mount['id'];spec=mount['weapon'];main=mount['battery']=='main'
 if main:
  # The ship owns only the fixed support; the registered original owns the
  # gunhouse, bearing, barrels and closed articulated gun-port covers.
  x,y,z=-mount['position'][2],-mount['position'][0],mount['position'][1]
  support_top=z+spec.get('gunhouseBaseHeight',.25)-.25
  cyl(mount['name']+' • armored barbette',(x,y,(deckz(x)+support_top)/2),
      spec['barbetteRadius'],max(.02,support_top-deckz(x)),'hullgray',COL,64)
  create_shared_mount(mount,COL,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials)
  continue
 gunhouse=create_gun_mount(mount,COL,dict(mesh=mesh,cyl=cyl,rod=gun_rod,box=box),materials,deckz)
 if main:
  # Independently authored Mk VII jacket: a longer parallel rear sleeve and
  # light forward chase. Keep every existing elevation/recoil/muzzle empty.
  for recoil in [o for o in scene.objects if o.get('assemblyId')==mount['id'] and o.get('nodeId','').endswith('.recoil')]:
   for ob in list(recoil.children):
    if ob.type=='MESH':bpy.data.objects.remove(ob,do_unlink=True)
   before_barrel=set(scene.objects)
   length=spec['muzzleForward']-spec['trunnionForward']
   profile=[(-.62,.60),(.43,.54),(3.80,.46),(3.85,.40),(length-1.0,.263),(length,.256)]
   for (a,ra),(b,rb) in zip(profile,profile[1:]):
    rod('Mk VII stepped jacket and chase',(a,0,0),(b,0,0),ra,'edge',r2=rb,vertices=32)
   rod('Mk VII recessed bore',(length+.005,0,0),(length+.025,0,0),spec['caliberM']/2,'dark',vertices=28)
   for ob in set(scene.objects)-before_barrel:ob.parent=recoil
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
  # The simulation retains the complete closed face envelope. The visible
  # face uses round-bottomed elevation ports and a thin continuous top band.
  shape=spec['gunhouseMesh'];base=mount['position'][1];n=len(shape['vertices'])//2
  roof_points=sorted({(x,z) for x,y,z in shape['vertices'][n:]})
  front=max(x for x,y,z in shape['vertices']);front_z=interp(roof_points,front)
  front_bottom=max(abs(y) for x,y,z in shape['vertices'][:n] if x==front)
  front_top=max(abs(y) for x,y,z in shape['vertices'][n:] if x==front)
  vv=[(a,b,base+c) for a,b,c in shape['vertices']];ff=[];mi=[]
  for f in shape['faces']:
   if f['id'].startswith('front-'):continue
   if f['id'].startswith('roof-front-'):continue
   if f['id'].startswith('wall-') and f['id'].endswith('-b'):continue
   indices=f['indices']
   if f['id'].startswith('wall-') and f['id'].endswith('-a'):
    mate=next(g for g in shape['faces'] if g['id']==f['id'][:-1]+'b')
    indices=indices+[mate['indices'][-1]]
   ff.append(indices);mi.append(1 if f['finish']=='roof' else 0)
  def face_edge(z):return front_bottom+(front_top-front_bottom)*(z-.25)/(front_z-.25)
  def patch(ys,zs,inset=0,material=0):
   idx=len(vv);vv.extend([(front-inset,y,base+z) for y,z in zip(ys,zs)])
   ff.append(list(range(idx,idx+len(ys))));mi.append(material)
  def panel(y0,y1,z0,z1):patch([y0,y1,y1,y0],[z0,z0,z1,z1])
  axes=[(i-(spec['barrelCount']-1)/2)*spec['barrelSpacing'] for i in range(spec['barrelCount'])]
  radius=.74;zc=spec['pivotHeight']-.27;port_top=front_z
  # RN plate 2 shows the gun openings cutting into the forward roof. Build
  # a single planar, scalloped edge; the CPU armor stays a closed envelope.
  ridge_x=-2.8 if spec['barrelCount']==4 else -1.0
  roof_outline=[(x,y,z) for x,y,z in shape['vertices'][n:] if x>=ridge_x]
  notched=[]
  for a,b in zip(roof_outline,roof_outline[1:]+roof_outline[:1]):
   notched.append(a)
   if a[0]==front and b[0]==front:
    for gy in axes:
     for k in range(17):
      t=math.pi-k*math.pi/16;x=front-.92*math.sin(t)
      notched.append((x,gy+radius*math.cos(t),interp(roof_points,x)))
  idx=len(vv);vv.extend([(x,y,base+z) for x,y,z in notched]);ff.append(list(range(idx,len(vv))));mi.append(1)
  for i,gy in enumerate(axes):
   last=axes[i-1]+radius if i else -front_bottom
   patch([last,gy-radius,gy-radius,axes[i-1]+radius if i else -front_top],[.25,.25,front_z,front_z])
   # Lower edge is a semicircle, as visible in the 1940 construction photo.
   arc=[(gy+radius*math.cos(a),zc+radius*math.sin(a)) for a in [math.pi+k*math.pi/12 for k in range(13)]]
   for (ya,za),(yb,zb) in zip(arc,arc[1:]):patch([ya,yb,yb,ya],[.25,.25,zb,za])
   aperture=arc+[(gy+radius,port_top),(gy-radius,port_top)]
   idx=len(vv);vv.extend([(front-inset,y,base+z) for inset in [0,.92] for y,z in aperture]);count=len(aperture)
   for k in range(count):
    if k==count-2:continue
    ff.append([idx+k,idx+(k+1)%count,idx+count+(k+1)%count,idx+count+k]);mi.append(0)
   ff.append([idx+count+k for k in range(count)]);mi.append(2)
  patch([axes[-1]+radius,front_bottom,front_top,axes[-1]+radius],[.25,.25,front_z,front_z])
  data=bpy.data.meshes.new('Original upright 14-inch face with rounded ports');data.from_pydata(vv,[],ff);data.update()
  for key in ['naval','roof','dark']:data.materials.append(materials[key])
  for poly,material in zip(data.polygons,mi):poly.material_index=material
  old=gunhouse.data;gunhouse.data=data;bpy.data.meshes.remove(old)
 yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
 if main:
  # Replace the generic detached optical boxes and level roof hatches.
  for ob in list(scene.objects):
   if ob.get('assemblyId')==mount['id'] and any(label in ob.name for label in ['transverse rangefinder','rangefinder hood','roof hatch']):
    bpy.data.objects.remove(ob,do_unlink=True)
 before=set(scene.objects);Hh=spec['gunhouseSize'][2];W=spec['gunhouseSize'][1]
 if main:
  quad=spec['barrelCount']==4
  roof_z=lambda x:interp(roof_points,x)
  ridge=-2.8 if quad else -1.0
  # Shallow fore/aft crown with narrow plate joints; no broad upper bevel.
  for x in ([-6.2,ridge,3.8] if quad else [-5.6,ridge,3.8]):
   half=interp(sorted({(a,abs(b)) for a,b,c in shape['vertices'][n:] if b<0}),x)
   rod('Gunhouse roof plate joint',(x,-half,roof_z(x)+.018),(x,half,roof_z(x)+.018),.017,'naval',vertices=6)
   for yy in [-half+.18,half-.18]:
    for dx in [-.12,.12]:cyl('Roof plate bolt',(x+dx,yy,roof_z(x+dx)+.038),.043,.046,'edge',vertices=8)
  # The broad projecting rangefinder covers grow out of the rear roof, with
  # flared ends and a 41 ft / 30 ft optical baseline. Dimensions are interpreted.
  rx=spec['rangefinderForward'];root_y=W*.35;tip_y=spec['rangefinderWidth']/2+(.65 if quad else .50)
  for side in [-1,1]:
   outline=[(rx-.86,side*root_y),(rx+.86,side*root_y),(rx+1.07,side*(tip_y-.14)),(rx+.99,side*tip_y),(rx-1.00,side*tip_y),(rx-1.08,side*(tip_y-.14))]
   if side<0:outline.reverse()
   hv=[(x,y,roof_z(x)+dz) for dz in [-.92,.035] for x,y in outline];hn=len(outline)
   hf=[tuple(reversed(range(hn))),tuple(range(hn,hn*2))]+[(i,(i+1)%hn,(i+1)%hn+hn,i+hn) for i in range(hn)]
   mesh('Integrated flared rangefinder end cover',hv,hf,'naval')
   z=roof_z(rx)-.44
   rod('Rangefinder end access cover',(rx,side*(tip_y+.012),z),(rx,side*(tip_y+.052),z),.28,'naval',vertices=24)
   for dx in [-.66,.66]:box('Rangefinder cover hinge',(rx+dx,side*(tip_y+.046),z),(.12,.08,.30),'edge')
   box('Rangefinder forward glass',(rx+1.065,side*(tip_y-.23),z),(.035,.30,.25),'glass')
   # Rear access follows the curved back wall, instead of floating beside it.
   ly=side*(2.3 if quad else 1.65)
   lx=interp(sorted({(abs(y),x) for x,y,z in shape['vertices'][:5]}),abs(ly))-.055
   ladder('Gunhouse rear access',(lx,ly,.28),(lx,ly,roof_z(lx)+.08),w=.46)
   hx=-6.4 if quad else -5.4;hy=side*(3.4 if quad else 1.05)
   cyl('Gunhouse escape cover',(hx,hy,roof_z(hx)+.055),.35,.09,'naval',vertices=28)
   rod('Escape-cover handle',(hx-.14,hy,roof_z(hx)+.14),(hx+.14,hy,roof_z(hx)+.14),.028,'edge',vertices=6)
  for gy in [(a+b)/2 for a,b in zip(axes,axes[1:])]:
   box('Gunlayer face sight',(front+.018,gy,front_z-.63),(.03,.20,.37),'dark')
   box('Gunlayer sight hood',(front+.08,gy,front_z-.39),(.20,.29,.09),'naval')
  # D-shaped sill protects the exposed forward portion of the roller ring.
  sill_r=spec['barbetteRadius']+.15;angle=math.acos(front/sill_r)
  sill=[(sill_r*math.cos(a),sill_r*math.sin(a)) for a in [-angle+2*angle*i/32 for i in range(33)]]
  prism('Forward D-shaped barbette sill',sill,.16,.20,'naval')
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
  # Raised pairs stand on the blueprint's shelter-deck sponsons; the deck pairs on their own aprons.
  apron=3.0 if z>DECK+1 else 3.28
  seat=7.35 if z>DECK+1 else deckz(x)
  cyl('Secondary platform apron',(x,y,(seat+z+.055)/2),apron,z+.055-seat,'roof',vertices=48)
  pts=[(x+(apron-.09)*math.cos(a*math.tau/40),y+(apron-.09)*math.sin(a*math.tau/40),z+.05) for a in range(41)]
  rail('Secondary platform',pts,.85)

COL=collections['Superstructure']
# Deck levels measured from the GameModels3D reference (author-structures.py holds the block table).
BLOCK=10.25;HANGAR=12.0;SHELTER=7.35
PARAPETS=['tower-base','tower-lower-bridge','tower-upper-bridge','after-tower-top']
PLAIN=['hacs-forward-tower','hacs-tower-step','compass-platform','director-aft-base','director-forward-base','director-aft-seat','after-tower-top','bridge-top','foremast-house']
for structure in D['structures']:
 ASSEMBLY=structure['id'];outline=[(-z,-x) for x,z in structure['footprint']];z=structure['baseY'];top=z+structure['height']
 if 'funnel' in structure['id']:continue
 if structure['id']=='compass-shelter':
  cx=sum(p[0] for p in outline)/len(outline);n=len(outline);roof=[(cx+(a-cx)*.94,b*.92) for a,b in outline]
  vs=[(a,b,z) for a,b in outline]+[(a,b,top) for a,b in roof]
  mesh('Sloping compass shelter',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'naval')
 else:prism(structure['name'],outline,z,structure['height'],structure['material'])
 prism('Deck edge plate',outline if structure['id']!='compass-shelter' else roof,top,.07,'roof')
 if structure['id'] in PARAPETS:
  perimeter_wall(structure['name']+' parapet',outline,top,.87)
 if structure['height']<.8 or structure['id'] in PLAIN or structure['id'].startswith('sponson'):continue
 glazing=structure['id']=='compass-shelter';small=structure['id'] in ['tower-admirals','tower-upper-bridge']
 for a,b in zip(outline,outline[1:]+outline[:1]):
  ax,ay=a;bx,by=b;length=math.hypot(bx-ax,by-ay);nx=(by-ay)/length;ny=-(bx-ax)/length
  count=max(1,int(length/(.68 if glazing else 1.05 if small else 2.9)))
  for k in range(count):
   t=(k+.5)/count;px=ax+(bx-ax)*t+nx*.014;py=ay+(by-ay)*t+ny*.014
   if glazing or small:
    h=.95 if glazing else .5;ww=length/count*.77 if glazing else .5
    ob=box('Bridge glazed pane',(px,py,top-h/2-(.22 if glazing else .55)),(ww,.025,h),'glass');ob.rotation_euler.z=math.atan2(by-ay,bx-ax)
    if glazing:
     rod('Bridge mullion',(ax+(bx-ax)*k/count,ay+(by-ay)*k/count,z+.14),(ax+(bx-ax)*k/count,ay+(by-ay)*k/count,top-.05),.026,'naval',vertices=6)
   else:
    zz=top-.90
    rod('Scuttle rim',(px,py,zz),(px+nx*.06,py+ny*.06,zz),.16,'edge',vertices=14)
    rod('Scuttle glass',(px+nx*.062,py+ny*.062,zz),(px+nx*.073,py+ny*.073,zz),.115,'glass',vertices=14)
    # Eyebrow to divert water above the circular scuttle.
    rod('Scuttle eyebrow',(px-.17*(bx-ax)/length+nx*.07,py-.17*(by-ay)/length+ny*.07,zz+.17),(px+.17*(bx-ax)/length+nx*.07,py+.17*(by-ay)/length+ny*.07,zz+.17),.02,'naval',vertices=6)

# Open director platforms on the navigating-bridge wings, lookouts and the working stairs and doors.
ASSEMBLY='bridge-galleries'
DIRECTOR_TUBS=[(16.97,5.46,18.02),(14.74,4.55,19.2)]
for side in [-1,1]:
 for x,y,z in DIRECTOR_TUBS:
  gallery('Director platform',[(x+1.25*math.cos(a*math.tau/20),side*y+1.25*math.sin(a*math.tau/20)) for a in range(20)],z,.9)
 for x,y,z in [(20.5,6.2,15.62),(23.6,4.9,15.62),(24.6,3.85,20.82)]:
  cyl('Lookout pedestal',(x,side*y,z+.4),.13,.8,'naval',vertices=10)
  for dy in [-.16,.16]:rod('Binocular telescope',(x-.25,side*y+dy,z+.9),(x+.40,side*y+dy,z+.9),.095,'edge',vertices=10)
 # Companionways from the upper deck to the 10.25 m deck and up the tower platforms.
 ladder('Long shelter stair',(24.0,side*9.3,DECK+.15),(19.6,side*9.3,BLOCK+.07))
 ladder('Signal stair',(16.0,side*7.35,11.07),(19.4,side*7.35,15.62))
 ladder('Bridge stair',(20.6,side*5.6,15.62),(18.1,side*5.6,18.22))
 for x,z in [(18.2,DECK+.2),(6.4,DECK+.2)]:
  before=set(scene.objects);door('Bridge watertight door',x,-8.84,z)
  if side==1:
   for ob in set(scene.objects)-before:ob.location.y=-ob.location.y;ob.scale.y=-1
 for x,z in [(17.2,DECK+1.2),(19.8,DECK+4.2)]:
  before=set(scene.objects);vent('Bridge intake',x,-8.86,z,1.2,.8)
  if side==1:
   for ob in set(scene.objects)-before:ob.location.y=-ob.location.y;ob.scale.y=-1
 for x,z in [(13.8,DECK+1.45),(16.4,DECK+4.4)]:life_raft('Bridge Carley float',x,side*9.02,z,True)
 for x in [15.2,19.2]:
  tube('Bridge downpipe',[(x,side*8.9,DECK+.3),(x,side*8.9,BLOCK-.3),(x-.3,side*8.9,BLOCK)],.045)
 # Slender vertical strengthening and level seams, not giant external ribs.
 for x in [7,10,13,16,19]:rod('Shelter seam',(x,side*8.817,DECK+.1),(x,side*8.817,BLOCK-.1),.012,'edge',vertices=5)

ASSEMBLY='bridge-instruments'
for side in [-1,1]:
 for x,y,z in DIRECTOR_TUBS:
  y=side*y
  cyl('Pom-pom director pedestal',(x,y,z+.48),.23,.8,'naval',vertices=12)
  box('Pom-pom director optical body',(x,y,z+1.05),(.62,.65,.36),'naval')
  for dy in [-.35,.35]:rod('Director binocular',(x-.1,y+dy,z+1.15),(x+.48,y+dy,z+1.15),.10,'edge',vertices=10)
  rod('Director sight rail',(x+.15,y,z+.65),(x+.15,y,z+1.55),.035,'naval',vertices=6)
 for x,y,z in [(21.0,4.6,15.62),(24.5,4.35,15.62),(22.6,3.8,20.82)]:
  box('Bridge signal equipment',(x,side*y,z+.3),(.46,.26,.6),'naval')
 for k in range(5):box('Signal flag locker',(18.4+k*.3,side*7.6,11.07+.32),(.27,.58,.55),'canvas')
ladder('HACS tower external ladder',(11.85,0,21.97),(11.85,0,25.5),w=.52)
# Signal platform round the foremast, abaft the tower.
gallery('Foremast platform',octagon(9.85,0,4.3,8.0,.8),16.45,.9)

# Open aft-facing hangar mouths in the after face of the forward block, either side of the uptakes.
ASSEMBLY='hangar-doors'
for side in [-1,1]:
 box('Hangar doorway',(-3.315,side*4.8,DECK+2.63),(.02,6.0,5.1),'dark')
 for y in [side*1.75,side*7.85]:box('Hangar portal jamb',(-3.39,y,DECK+2.63),(.20,.14,5.2),'naval')
 box('Hangar lintel',(-3.39,side*4.8,DECK+5.2),(.2,6.1,.2),'naval')
 for j in range(5):box('Folded hangar door',(-3.47,side*(7.0+j*.14),DECK+2.58),(.1,.10,4.9),'roof')
 # Repeated aircraft rails pass into the hangar at deck level.
 for yy in [side*2.8,side*5.8]:rod('Aircraft handling deck track',(-12,yy,DECK+.08),(-3.2,yy,DECK+.08),.04,'edge',vertices=6)

# Funnel jackets with open rim, internal uptake and arched cap grating: straight-sided stacks with
# round ends, as the reference's; the after funnel keeps a wider casing to the searchlight level.
COL=collections['Superstructure']
FUNNELS=[('forward-funnel',.58,6.05,3.9,HANGAR,23.7,None),('after-funnel',-23.86,6.73,3.1,BLOCK,23.7,(17.0,6.85,4.2))]
def stadium_ring(x,L,W,z,n=20):
 r=W/2;a=L/2-r
 fore=[(x+a+r*math.cos(t),r*math.sin(t),z) for t in [-math.pi/2+math.pi*i/n for i in range(n+1)]]
 aft=[(x-a+r*math.cos(t),r*math.sin(t),z) for t in [math.pi/2+math.pi*i/n for i in range(n+1)]]
 return fore+aft
def funnel_half(L,W,dx):
 r=W/2;a=L/2-r
 return r if abs(dx)<=a else math.sqrt(max(0,r*r-(abs(dx)-a)**2))
for id,x,L,W,base,top,casing in FUNNELS:
 ASSEMBLY=id
 layers=[stadium_ring(x,L,W,base),stadium_ring(x,L,W,top),stadium_ring(x,L-.4,W-.4,top),stadium_ring(x,L-.4,W-.4,top-1.8)]
 vv=[p for l in layers for p in l];n=len(layers[0])
 ff=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
 mesh('Open funnel jacket',vv,ff,'naval',smooth=True)
 mesh('Soot inside funnel',stadium_ring(x,L-.44,W-.44,top-1.75),[tuple(range(n))],'dark')
 if casing:
  ctop,cL,cW=casing;cv=stadium_ring(x,cL,cW,base)+stadium_ring(x,cL,cW,ctop);m=len(cv)//2
  mesh('Funnel base casing',cv,[tuple(range(m,2*m))]+[(i,(i+1)%m,(i+1)%m+m,i+m) for i in range(m)],'naval')
  tube('Casing top band',stadium_ring(x,cL+.05,cW+.05,ctop-.1)+[stadium_ring(x,cL+.05,cW+.05,ctop-.1)[0]],.05,'naval',vertices=6)
 for zz in [top-5.2,top-.35]:
  ring=stadium_ring(x,L+.05,W+.05,zz);tube('Funnel circumferential band',ring+[ring[0]],.055,'naval',vertices=6)
 ring=stadium_ring(x,L-.1,W-.1,top+.02);tube('Rolled funnel mouth',ring+[ring[0]],.13,'roof',vertices=8)
 for dx in [-2,-1,0,1,2]:
  half=funnel_half(L,W,dx)-.05
  if half<.3:continue
  tube('Funnel cap lattice',[(x+dx,-half,top+.03),(x+dx,-half*.55,top+.40),(x+dx,0,top+.50),(x+dx,half*.55,top+.40),(x+dx,half,top+.03)],.042,'edge')
 tube('Funnel cap spine',[(x-L/2+.1,0,top),(x-L/4,0,top+.47),(x+L/4,0,top+.47),(x+L/2-.1,0,top)],.055,'edge')
 for side in [-1,1]:
  for dx in [-L/2+W/2+.1,0,L/2-W/2-.1]:
   y0=side*(W/2+.1);z0=(casing[0] if casing else base)+.1
   tube('Funnel steam pipe',[(x+dx,y0,z0),(x+dx,y0,top-1.45),(x+dx-.23,y0,top-1.07),(x+dx-.58,y0,top-1.0)],.085,'naval',vertices=10)
  # Shape of the pipe and its flared steam whistle is visible against the sea.
  tube('Steam whistle',[(x+L/2+.14,side*.6,(casing[0] if casing else base)+.1),(x+L/2+.14,side*.6,top-2.2),(x+L/2-.1,side*.6,top-1.85),(x+L/2-.4,side*.6,top-1.8)],.12)
 ladder('Funnel maintenance ladder',(x-L/2-.06,0,top-6.2),(x-L/2-.06,0,top+.06),w=.56)
 for zz in [top-5,top-3.5,top-2,top-.6]:
  for yy in [-.28,.28]:rod('Ladder bracket',(x-L/2+.05,yy,zz),(x-L/2-.12,yy,zz),.025,'edge',vertices=6)

COL=collections['Sensors and masts']
def director(id,x,y,z,main=False):
 global ASSEMBLY
 ASSEMBLY=id;before=set(scene.objects)
 cyl('Director roller',(x,y,z+.25),1.38 if main else 1.0,.5,'edge',vertices=32)
 if main:
  shape=octagon(x,y,3.6,3.7,.45);prism('DCT lower cabinet',shape,z+.47,1.90)
  prism('DCT raised sight enclosure',octagon(x-.6,y,2.1,3.5,.32),z+2.37,1.0)
  box('DCT forward sight ports',(x+1.81,y,z+1.92),(.025,1.73,.45),'glass')
  # Compact rangefinder hoods at the cabinet sides, as the reference's directors.
  span=2.2
  rod('DCT transverse optical tube',(x-.45,y-span,z+2.12),(x-.45,y+span,z+2.12),.23,'naval',vertices=20)
  for sign in [-1,1]:prism('DCT optical hood',octagon(x-.45,y+sign*span,1.15,.76,.16),z+1.70,.85)
  ladder('DCT access',(x-1.81,y,z+.35),(x-1.81,y,z+3.28),w=.51)
 else:
  # HACS Mk IV rotating high-angle director, curved rear and sloping nose.
  prism('HACS cabinet',octagon(x,y,2.7,2.2,.40),z+.45,1.85)
  for side in [-1,1]:
   rod('HACS optical tube',(x-.25,y+side*.95,z+2.0),(x-.25,y+side*2.25,z+2.0),.19,'naval',vertices=16)
   box('HACS rangefinder hood',(x-.25,y+side*2.3,z+2.0),(.8,.5,.75),'naval')
  # Curved director hood, built with an original bent plate cross section.
  arch=[(-1.27,1.70),(-1.17,2.55),(-.70,3.10),(.20,3.30),(.85,2.95),(1.31,2.10)]
  vv=[(x+dx,y+side*1.04,z+zz) for side in [-1,1] for dx,zz in arch]
  mesh('HACS curved roof',vv,[(i,i+1,i+7,i+6) for i in range(5)],'naval')
  box('HACS sight aperture',(x+1.33,y,z+2.05),(.025,1.48,.48),'dark')
  for side in [-1,1]:rod('HACS roof rib',(x-.98,y+side*.70,z+2.80),(x+.75,y+side*.70,z+3.02),.045,'edge',vertices=6)
 node=pivot(id+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)
 return node
# Director datums at the reference hardpoints (forward and after DCT, two HACS each side of each tower).
DCT_FWD=(20.71,23.27);DCT_AFT=(-50.13,12.28)
director('dct-forward',DCT_FWD[0],0,DCT_FWD[1],True)
director('dct-after',DCT_AFT[0],0,DCT_AFT[1],True)
for id,x,y,z in [('hacs-p-forward',13.21,4.004,25.605),('hacs-s-forward',13.21,-4.004,25.605),('hacs-p-after',-43.32,3.879,14.781),('hacs-s-after',-43.32,-3.879,14.781)]:director(id,x,y,z)
ASSEMBLY='hacs-platforms'
gallery('Forward HACS platform',octagon(13.2,0,3.4,10.6,.7),25.45,.48,False)
gallery('Aft HACS platform',octagon(-43.4,0,3.0,10.6,.6),14.62,.52,False)
for y in [-1.0,1.0]:rod('After tower overhang strut',(-46.25,y,13.6),(-47.4,y,14.58),.09,'naval',vertices=8)
# 1941 Type 284 mattress on the 14-inch DCT; no late Type 271 lantern.
ASSEMBLY='radar-284';before=set(scene.objects);dx,dz=DCT_FWD
for side in [-1,1]:
 yy=side*2.10
 for zz in [-.52,.52]:rod('284 aerial frame',(dx+2.1,yy-1.94,dz+3.85+zz),(dx+2.1,yy+1.94,dz+3.85+zz),.045,'edge',vertices=6)
 for k in range(16):rod('284 vertical dipole',(dx+2.1,yy-1.89+k*.25,dz+3.37),(dx+2.1,yy-1.89+k*.25,dz+4.33),.022,'naval',vertices=6)
 for zz in [-.25,0,.25]:rod('284 aerial wire',(dx+2.13,yy-1.89,dz+3.85+zz),(dx+2.13,yy+1.89,dz+3.85+zz),.013,'edge',vertices=5)
 rod('284 supporting arm',(dx+.5,side*1.3,dz+2.15),(dx+2.1,side*2,dz+3.85),.067,'naval',vertices=8)
node=pivot('radar-284.yaw',(dx,0,dz+2.85));attach_world(set(scene.objects)-before-{node},node)
attach_world([node],bpy.data.objects['dct-forward.yaw'])
# Tripod masts from the reference: the foremast's legs splay aft to the hangar roofs and carry a
# starfish at 30.5 m; the mainmast's legs splay forward to the boat deck. Type 279 at both mastheads.
MASTS=[dict(name='foremast',x=8.8,foot=BLOCK,plat=(30.5,8.1,5.2,6.2),top=40.84,tx=7.42,legs=((4.2,3.9,HANGAR),(8.45,.42,28.2)),yards=[(39.1,3.1),(33.1,6.0)],shroud=(2.8,7.5,HANGAR)),
       dict(name='mainmast',x=-43.3,foot=14.62,plat=(27.0,-43.2,2.4,3.0),top=34.89,tx=-43.85,legs=((-39.1,3.8,BLOCK),(-42.85,.5,25.6)),yards=[(33.9,4.2),(29.4,3.4)],shroud=(-49.0,4.2,BLOCK))]
MASTHEAD={}
for M in MASTS:
 name=M['name'];ASSEMBLY=name;x=M['x'];top=M['top'];tx=M['tx'];pz,px,pl,pw=M['plat']
 rod(name+' lower pole',(x,0,M['foot']),(x,0,pz),.30,'naval',r2=.24,vertices=16)
 # The topmast steps aft at the starfish and stands vertical to the masthead.
 rod(name+' topmast',(tx,0,pz-.4),(tx,0,top+1.2),.20,'naval',r2=.07,vertices=12)
 if abs(tx-x)>.3:rod(name+' topmast heel',(x,0,pz-.4),(tx,0,pz-.4),.2,'naval',vertices=10)
 (fx,fy,fz),(hx,hy,hz)=M['legs']
 for side in [-1,1]:
  rod(name+' tripod',(fx,side*fy,fz),(hx,side*hy,hz),.22,'naval',r2=.14,vertices=12)
 plat=octagon(px,0,pl,pw,.6)
 gallery(name+' lookout platform',plat,pz,.0)
 rail('Mast platform guard',[(a,b,pz+.13) for a,b in plat+[plat[0]]],.90)
 for side in [-1,1]:rod('Mast platform support',(px,side*pw*.4,pz),(x,side*.25,pz-1.75),.075,'naval',vertices=8)
 ladder('Mast vertical ladder',(x+.36,0,M['foot']+.1),(x+.36,0,pz-.05),w=.47)
 for zz,span in M['yards']:
  yx=tx if zz>pz else x
  rod('Tapered signal yard',(yx,-span,zz),(yx,span,zz),.062,'naval',vertices=10)
  for side in [-1,1]:
   rod('Yard lift',(yx,side*span,zz),(yx,0,zz+2.0),.018,'edge',vertices=5)
   for k in range(1,6):rod('Signal halyard',(yx,side*k*span/6,zz),(fx+(hx-fx)*.3,side*(fy+(hy-fy)*.3),fz+(hz-fz)*.3),.008,'edge',vertices=4)
 # Early paired Type 279 aerials at the masthead, where the reference carries its masthead array.
 before=set(scene.objects)
 for dz in [0,.85]:
  rod('Type 279 crossbar',(tx,-1.7,top+dz),(tx,1.7,top+dz),.045,'edge',vertices=6)
  for yy in [-1.5,-.75,0,.75,1.5]:rod('Type 279 dipole',(tx-.38,yy,top+dz),(tx+.38,yy,top+dz),.025,'naval',vertices=6)
 radar_pivot('radar-279-'+name+'.yaw',(tx,0,top),set(scene.objects)-before)
 sx,sy,sz=M['shroud']
 for side in [-1,1]:rod('Mast standing rigging',(px,side*.7,pz+.5),(sx,side*sy,sz+.05),.013,'edge',vertices=5)
 zz,span=M['yards'][0];MASTHEAD[name]=(tx,zz)
ASSEMBLY='wireless-aerials'
(fx,fz),(mx,mz)=MASTHEAD['foremast'],MASTHEAD['mainmast']
for y in [-.36,.36]:rod('Between-mast wireless aerial',(fx,y,fz),(mx,y,mz),.010,'edge',vertices=5)
# Searchlights: a pair on the house abaft the fore funnel, a pair on sponsons off the after funnel casing.
for cx,cy,z in [(-2.6,2.2,17.07),(-24.1,3.15,17.0)]:
 for side in [-1,1]:
  ASSEMBLY='searchlights';yy=side*cy
  if cx<-10:gallery('Searchlight wing',[(cx+1.2*math.cos(a*math.tau/24),yy+1.05*math.sin(a*math.tau/24)) for a in range(24)],z-.13,.85)
  cyl('Searchlight pedestal',(cx,yy,z+.40),.22,.75,'naval',vertices=12)
  for dx in [-.55,.55]:rod('Searchlight yoke',(cx+dx,yy,z+.55),(cx+dx,yy,z+1.25),.08,'naval',vertices=8)
  rod('Searchlight casing',(cx,yy-.45,z+1.3),(cx,yy+.45,z+1.3),.54,'naval',vertices=28)
  rod('Searchlight silvered lens',(cx,yy+side*.46,z+1.3),(cx,yy+side*.475,z+1.3),.47,'glass',vertices=28)

COL=collections['Aircraft handling'];ASSEMBLY='catapult'
# Transverse double-ended catapult across the waist at the reference's station; open working deck around it.
CAT=-11.3
for x in [CAT-.6,CAT+.6]:
 rod('Catapult rail',(x,-16.0,DECK+1.2),(x,16.0,DECK+1.2),.11,'edge',vertices=8)
 rod('Catapult lower rail',(x,-15.6,DECK+.45),(x,15.6,DECK+.45),.09,'naval',vertices=8)
 for k in range(20):
  y=-15.6+k*1.56;rod('Catapult diagonal',(x,y,DECK+.45),(x,y+1.56,DECK+1.2),.045,'naval',vertices=6)
box('Catapult launch carriage',(CAT,0,DECK+1.42),(2.2,2.8,.3),'edge')
for side in [-1,1]:
 ASSEMBLY='crane-'+('port' if side==1 else 'starboard');x=-22.1;y=side*8.1;z=BLOCK+.75;before=set(scene.objects)
 # Round sponson at the forward corner of the boat deck carries each crane.
 cyl('Crane sponson',(x,y,BLOCK-.2),1.55,.4,'roof',vertices=28)
 rod('Crane sponson bracket',(x,side*7.65,BLOCK-.4),(x,side*7.65,BLOCK-2.2),.12,'naval',vertices=8)
 cyl('Aircraft crane pedestal',(x,y,(BLOCK+z)/2),.66,z-BLOCK,'naval',vertices=20)
 boomA=Vector((x,y,z+1.75));boomB=Vector((-2.0,side*9.0,z+2.25))
 for offset in [-.5,.5]:
  rod('Crane upper chord',boomA+Vector((0,offset,.7)),boomB+Vector((0,offset,.12)),.09,'naval',vertices=8)
  rod('Crane lower chord',boomA+Vector((0,offset,-.7)),boomB+Vector((0,offset,-.12)),.09,'naval',vertices=8)
  for k in range(12):
   t=k/12;u=(k+1)/12;p=boomA.lerp(boomB,t);q=boomA.lerp(boomB,u)
   rod('Crane lattice',p+Vector((0,offset,-.7*(1-t))),q+Vector((0,offset,.7*(1-u))),.04,'edge',vertices=6)
 rod('Crane hoist',boomB,boomB+Vector((0,0,-1.2)),.02,'edge',vertices=5)
 box('Crane operator house',(x-.75,y,z+.05),(2.0,1.65,2.0),'naval')
 box('Crane cabin window',(x+.26,y,z+.40),(.02,1.24,.58),'glass')
 cyl('Crane geared turntable',(x,y,z-.3),1.25,.3,'edge',vertices=28)
 rod('Crane hoist drum',(x-1.8,y-.58,z+.35),(x-1.8,y+.58,z+.35),.42,'edge',vertices=20)
 rod('Crane supporting stay',(x-1.8,y,z+3.4),boomB,.045,'edge',vertices=6)
 rod('Crane back stay',(x-1.8,y,z+3.4),(x-2.4,y,z-.15),.09,'naval',vertices=8)
 rod('Crane kingpost',(x-.4,y,z-.15),(x-1.8,y,z+3.4),.13,'naval',vertices=10)
 for k in range(12):
  t=k/12;u=(k+1)/12;pa=boomA.lerp(boomB,t);pb=boomA.lerp(boomB,u)
  rod('Crane top cross brace',pa+Vector((0,-.5,.7*(1-t))),pb+Vector((0,.5,.7*(1-u))),.035,'naval',vertices=6)
  rod('Crane lower cross brace',pa+Vector((0,.5,-.7*(1-t))),pb+Vector((0,-.5,-.7*(1-u))),.035,'naval',vertices=6)
 rail('Crane maintenance balcony',[(x+xx,y+yy,z-.15) for xx,yy in [(-1.8,-1.2),(1.4,-1.2),(1.4,1.2),(-1.8,1.2),(-1.8,-1.2)]],.9)
 node=pivot(ASSEMBLY+'.yaw',(x,y,z));attach_world(set(scene.objects)-before-{node},node)

def boat(name,x,y,z,length=9,width=2.7,motor=False):
 global ASSEMBLY
 ASSEMBLY=name;n=36;vs=[];k=min(1.45,max(1,length/9))
 outline=[]
 for i in range(n):
  t=i*math.tau/n;xx=length/2*math.cos(t);yy=width/2*math.sin(t)*(1-.20*math.cos(t));outline.append((xx,yy))
 for scale,zz in [(.72,0),(1,.65),(.90,.67),(.64,.16)]:
  vs.extend([(x+xx*scale,y+yy*scale,z+zz*k+(.20*abs(xx/(length/2))**3 if zz>.5 else 0)) for xx,yy in outline])
 ff=[tuple(reversed(range(n))),tuple(range(3*n,4*n))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
 hull=mesh('Clinker boat hull and open well',vs,ff,'naval',smooth=True)
 for level in [.24,.43]:tube('Boat strake',[(x+xx*(.75+.25*level/.65),y+yy*(.75+.25*level/.65),z+level*k) for xx,yy in outline+[outline[0]]],.022,'edge',vertices=5)
 tube('Boat gunwale',[(x+xx,y+yy,z+.67*k+.20*abs(xx/(length/2))**3) for xx,yy in outline+[outline[0]]],.055,'canvas',vertices=6)
 for dx in [-length*.28,-length*.10,length*.12,length*.30]:box('Boat wooden thwart',(x+dx,y,z+.51*k),(.29,width*.76,.09),'deck')
 for dx in [-length*.25,length*.25]:
  box('Boat cradle',(x+dx,y,z-.23),(.22,width,.4),'edge')
  for sign in [-1,1]:rod('Boat cradle brace',(x+dx,y+sign*width*.47,z+.09),(x+dx,y+sign*width*.34,z-.44),.07,'naval',vertices=6)
 if motor:
  top=z+.66*k
  prism('Motor launch cabin',octagon(x+.45,y,length*.27,width*.70,.25),top,.95*k,'canvas')
  box('Launch wheelhouse glass',(x+.45+length*.135,y,top+.59*k),(.02,width*.52,.45),'glass')
  for side in [-1,1]:box('Launch side glass',(x+.5,y+side*width*.352,top+.58*k),(length*.19,.02,.40),'glass')
  box('Launch cabin roof',(x+.45,y,top+1.0*k),(length*.29,width*.76,.10),'white')
  rod('Launch exhaust',(x-.55,y,top+.04),(x-.55,y,top+1.46*k),.11,'edge',vertices=10)
  rod('Boat propeller shaft',(x-length*.4,y,z+.05),(x-length*.53,y,z-.16),.055,'edge',vertices=6)
 else:
  for side in [-1,1]:rod('Stowed boat oar',(x-length*.38,y+side*.36,z+.65*k),(x+length*.35,y+side*.36,z+.65*k),.032,'deck',vertices=6)
# Boats on the boat deck in two columns each side, clear of the after pom-poms and the mainmast legs.
for i,(x,y,l,w) in enumerate([(-36.6,7.3,11.2,2.8),(-36.6,-7.3,11.2,2.8),(-33.35,3.9,9.3,2.6),(-33.35,-3.9,9.3,2.6),(-32.6,0,6.8,2.0)]):boat('boat-'+str(i+1),x,y,BLOCK+.43,l,w,i<4)
# Boat-deck edge rails, Carley floats and access on the after deckhouse.
ASSEMBLY='boat-deck-support'
for side in [-1,1]:
 ladder('Boat deck access',(-17.4,side*5.5,DECK+.1),(-19.5,side*5.5,BLOCK+.07))
 for x,y,z in [(-25.8,7.72,8.9),(-38.6,9.12,7.6),(-41.6,9.12,7.6)]:life_raft('Aft shelter Carley float',x,side*y,z,True)
 rail('Boat deck edge',[(x,side*y,BLOCK+.07) for x,y in [(-19.8,7.45),(-30.8,7.45),(-31.2,8.45),(-37.0,8.45),(-37.8,8.85),(-43.8,8.85),(-50.8,2.6)]],.95)
# Small independently authored Walrus: amphibious hull, biplane wings, pusher engine.
ASSEMBLY='walrus';x=CAT;y=1.2;z=DECK+1.6
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
# Early-1941 stations: a pair on the hangar roofs abreast the fore funnel, a pair on the boat deck abreast
# the after funnel (clear of the cranes). Their exact 1941 datums remain unresolved (equipment-evidence.json).
for i,(x,y,z) in enumerate([(4,7.0,HANGAR),(4,-7.0,HANGAR),(-26.2,5.2,BLOCK),(-26.2,-5.2,BLOCK)]):
 ASSEMBLY='pom-pom-'+str(i+1)
 outline=[(x+2.75*math.cos(a*math.tau/32),y+2.62*math.sin(a*math.tau/32)) for a in range(32)]
 gallery('Pom-pom splinter platform',outline,z,.83)
 mount=next((m for m in D['mounts'] if m['id']==ASSEMBLY),None)
 if mount:
  create_gun_mount(mount,COL,dict(mesh=mesh,cyl=cyl,rod=gun_rod,box=box),materials,DECK)
 else:
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
def mounting_roof(mount_id,x):
 spec=next(m['weapon'] for m in D['mounts'] if m['id']==mount_id)
 vs=spec['gunhouseMesh']['vertices'];return interp(sorted({(a,c) for a,b,c in vs[len(vs)//2:]}),x)
up_launcher('up-main-b',-3.2,0,mounting_roof('main-b',-3.2),yawB)
up_launcher('up-main-y',-2.0,2.25,mounting_roof('main-y',-2.0),yawY)
up_launcher('up-waist-1',-2.0,-2.25,mounting_roof('main-y',-2.0),yawY)
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
  for z in [DECK-3.24,DECK-1.59]:
   y=side*(sidewidth(x,z)+.018)
   rod('Hull scuttle rim',(x,y,z),(x,y+side*.045,z),.155,'edge',vertices=12)
   rod('Hull scuttle glass',(x,y+side*.047,z),(x,y+side*.055,z),.108,'dark',vertices=12)
ASSEMBLY='bridge-access'
# Ladders from the upper deck onto the raised 5.25-inch sponsons.
for x,y,z in [(-3.25,10.6,DECK),(-3.25,-10.6,DECK),(-27.4,10.6,DECK)]:
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
 for zz in [DECK-5.69,DECK-2.12]:
  for x in range(-98,106,2):
   a=(x,side*(sidewidth(x,zz)+.024),zz);b=(x+2,side*(sidewidth(x+2,zz)+.024),zz)
   mesh('Hull strake lip',[a,b,(b[0],b[1]+side*.045,zz+.06),(a[0],a[1]+side*.045,zz+.06)],[(0,1,2,3)],'naval')
 for x in [-72,-45,-22,1,25,47,63]:
  ps=[(x,side*(sidewidth(x,zz)+.025),zz) for zz in [DECK-8.74+k for k in range(8)]]
  tube('Hull expansion seam',ps,.012,'edge',vertices=5)
 for x in [-88,-58,-20,22,59,86]:
  zz=DECK-1.54;yy=side*(sidewidth(x,zz)+.055)
  for h in [0,.32,.64]:rod('Ship side access rung',(x-.28,yy,zz+h),(x+.28,yy,zz+h),.025,'naval',vertices=6)
ASSEMBLY='ensign'
rod('Ensign staff',(-111,0,DECK),(-111,0,DECK+5.2),.07,'naval',vertices=10)

COL=collections['Underwater fittings']
def hull_bottom(x,y):
 """Height of the hull surface under (x, y): the lowest level whose half-breadth reaches |y|."""
 z=-11
 while z<0 and sidewidth(x,z)<abs(y):z+=.05
 return z
# Four three-bladed screws at the reference's stations: the outer pair forward, the inner pair by the rudder.
for i,(y,x,z) in enumerate([(-8.71,-87.15,-6.0),(-4.94,-97.34,-7.05),(4.94,-97.34,-7.05),(8.71,-87.15,-6.0)],1):
 ASSEMBLY='shaft-'+str(i);ex=x+(9 if abs(y)>6 else 11)
 rod('Shaft',(ex,y*.97,hull_bottom(ex,y*.97)+.25),(x,y,z),.24,'edge',vertices=16)
 bx=x+2.6;hb=hull_bottom(bx,y)
 rod('Shaft bossing',(x+1.3,y,z+.06),(x+5.5,y,z+.26),.42,'antifouling',r2=.34,vertices=16)
 for sign in [-1,1]:rod('A-bracket',(bx,y,z+.1),(bx+.4,y+sign*.9,hull_bottom(bx+.4,y+sign*.9)+.1),.19,'antifouling',vertices=12)
 before=set(scene.objects);rod('Screw hub',(x-1.2,y,z),(x+.8,y,z),.53,'bronze',r2=.28,vertices=24)
 for j in range(3):
  a=math.tau*j/3;shape=[(.38,-.15),(1.05,-.60),(1.85,-.43),(2.07,.10),(1.65,.69),(.66,.48)]
  vs=[(x+.22*r,y+r*math.cos(a)-t*math.sin(a),z+r*math.sin(a)+t*math.cos(a)) for r,t in shape]
  mesh('Three-bladed screw',vs,[tuple(range(len(vs)))],'bronze')
 node=pivot('propeller-'+str(i)+'.spin',(x,y,z));attach_world(set(scene.objects)-before-{node},node)
# The reference's single balanced centreline rudder behind the skeg. Both rudder assemblies keep their
# pivots on its stock; each carries one half of the blade's thickness, so they turn as one blade.
RUDDER=[(-98.05,-6.2),(-100.05,-5.5),(-102.7,-4.98),(-104.7,-4.55),(-106.05,-4.35),(-104.95,-9.9),(-104.35,-10.3),(-98.55,-10.3),(-98.05,-9.8)]
for side in [-1,1]:
 ASSEMBLY='rudder-'+('port' if side==1 else 'starboard');before=set(scene.objects)
 vs=[(x,s*side*.46,z) for s in [0,1] for x,z in RUDDER];n=len(RUDDER)
 mesh('Balanced rudder',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'antifouling')
 if side==1:rod('Rudder stock',(-100.05,0,-6.25),(-100.05,0,-5.4),.28,'antifouling',vertices=12)
 node=pivot(ASSEMBLY+'.yaw',(-100.05,0,-6.0));attach_world(set(scene.objects)-before-{node},node)
# The reference's forefoot projects forward of the lofted stem below 6.6 m; a thin centreline wedge
# carries it (station sections cannot hold the separated forefoot).
ASSEMBLY='hull';COL=collections['Hull and decks']
FOREFOOT=[(110.6,-10.45),(111.3,-10.42),(111.79,-10.2),(111.84,-9.8),(111.75,-9.0),(111.5,-7.8),(111.25,-6.6),(111.1,-6.35),(110.79,-10.0)]
n=len(FOREFOOT);half=lambda bx:.06+.24*max(0,min(1,(111.84-bx)/1.2))
mesh('Forefoot',[(bx,s*half(bx),z) for s in [-1,1] for bx,z in FOREFOOT],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'antifouling')
COL=collections['Underwater fittings']
# Bilge keels at the turn of the bilge over the midbody, as on the reference.
for side in [-1,1]:
 ASSEMBLY='bilge-keel-'+str(side)
 pts=[(x,side*sidewidth(x,-9.75),-9.75) for x in [-30,-18,-6,6,18,30]]
 for a,b in zip(pts,pts[1:]):mesh('Bilge keel fin',[a,b,(b[0],b[1]+side*.5,b[2]-.5),(a[0],a[1]+side*.5,a[2]-.5)],[(0,1,2,3)],'antifouling')

COL=collections['Sensors and masts'];ASSEMBLY='landmarks'
for id,pos in [('funnel-cap',(.58,0,24.3)),('foremast-top',(7.42,0,42.04)),('mainmast-top',(-43.85,0,36.09)),('fore-director',(DCT_FWD[0],0,DCT_FWD[1])),('bridge-front',(28.6,0,22.5))]:pivot('landmark.'+id,pos)

COL=collections['Simulation volumes']
for group in ['armor','modules','compartments','obstructions']:
 for v in D[group]:
  ASSEMBLY=v['id'];x,y,z=v['center'];sx,sy,sz=v['size']
  ob=box(group+'.'+v['id'],(-z,-x,y),(sz,sx,sy),'dark');ob['exportRole']='simulation';ob.display_type='WIRE';ob.hide_render=True
scene['definitionHash']=D['contentHash'];scene['historicalConfiguration']=D['configuration']
scene['accuracyStatus']='Game reconstruction; see discrepancy register for evidence and limits.'
from blender_rig import create_flagstaffs
create_flagstaffs(D)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('King George V original source:',len(scene.objects),'objects')

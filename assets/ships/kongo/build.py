"""Original Kongō reconstruction. Blender metres: +X bow, +Y port, +Z up."""
import bpy,bmesh,json,math,os,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount
from blender_rig import create_flagstaffs
sys.path.insert(0,str(Path(__file__).resolve().parent/'authoring'))
from floatplane import create as create_floatplane
from deck_rails import create as create_deck_rails
from turret_roof import create as create_turret_roof
from weather_deck import geometry as weather_geometry, height as weather_height, prepare_mesh as prepare_weather_mesh
out=Path(os.environ['SHIP_OUTPUT'])
d=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='Kongo 1944 original';scene.unit_settings.system='METRIC'
col=bpy.data.collections.new('Kongo original');scene.collection.children.link(col)
colors={'naval':(.19,.215,.23,1),'roof':(.17,.19,.20,1),'hullgray':(.18,.20,.215,1),
 'dark':(.018,.022,.026,1),'edge':(.105,.12,.13,1),'wood':(.37,.29,.16,1),
 'red':(.22,.055,.038,1),'canvas':(.55,.52,.40,1),'glass':(.048,.09,.10,1),'bronze':(.36,.28,.10,1)}
mats={}
for key,color in colors.items():
 # Palette values describe displayed sRGB colors; Blender shader inputs are linear.
 color=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in color[:3])+(color[3],)
 m=bpy.data.materials.new('Kongo '+key);m.diffuse_color=color;m.use_nodes=True
 bs=m.node_tree.nodes['Principled BSDF'];bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=.75
 if key=='glass':
  # Thin clear panes retain the mullions and the depth of the open bridge rooms.
  # Alpha exports directly to glTF and does not add CPU armor behind the glazing.
  bs.inputs['Alpha'].default_value=.16
  bs.inputs['Roughness'].default_value=.22
  m.diffuse_color=(*color[:3],.16)
  m.surface_render_method='DITHERED'
 mats[key]=m
# Aviation linoleum keeps its original color with its own surface finish.
mats['linoleum']=mats['red'].copy();mats['linoleum'].name='Kongo linoleum'
def mesh(name,vs,fs,mat,col=col,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(vs,[],fs);data.update()
 o=bpy.data.objects.new(name,data);col.objects.link(o)
 if mat:data.materials.append(mat)
 for p in data.polygons:p.use_smooth=smooth
 o['assemblyId']=name.split('.')[0];return o
def box(name,loc,dim,mat,col=col,bev=0):
 x,y,z=[v/2 for v in dim]
 o=mesh(name,[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
 [(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],mat,col)
 o.location=loc;return o
def cyl(name,loc,radius,depth,mat,col=col,vertices=32,r2=None):
 r2=radius if r2 is None else r2;n=vertices
 vs=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for z,r in [(-depth/2,radius),(depth/2,r2)] for i in range(n)]
 fs=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,2*n))]
 o=mesh(name,vs,fs,mat,col,True);o.location=loc
 for p in o.data.polygons[-2:]:p.use_smooth=False
 return o
def rod(name,a,b,r,mat,col=col,r2=None,vertices=10):
 a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,mat,col,vertices,r2)
 o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def joint(name,position,objects):
 node=bpy.data.objects.new(name,None);col.objects.link(node);node.location=position;node['nodeId']=name
 bpy.context.view_layer.update()
 for o in objects:
  world=o.matrix_world.copy();o.parent=node;o.matrix_world=world
 return node
def oval(x,y,rx,ry,n=32):return [(x+rx*math.cos(i*math.tau/n),y+ry*math.sin(i*math.tau/n)) for i in range(n)]
def rect(x0,x1,y0,y1,c=.4):
 return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]
def prism(name,outline,z0,z1,mat=None,topscale=1):
 n=len(outline);cx=sum(x for x,y in outline)/n;cy=sum(y for x,y in outline)/n
 vs=[(x,y,z0) for x,y in outline]+[(cx+(x-cx)*topscale,cy+(y-cy)*topscale,z1) for x,y in outline]
 fs=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,n*2))]
 return mesh(name,vs,fs,mat or mats['naval'])
def rail(name,outline,z,h=.9,closed=True):
 pts=outline+[outline[0]] if closed else outline
 for a,b in zip(pts,pts[1:]):
  distance=math.dist(a,b);steps=max(1,math.ceil(distance/2))
  for i in range(steps):
   x=a[0]+(b[0]-a[0])*i/steps;y=a[1]+(b[1]-a[1])*i/steps
   rod(name+'.post',(x,y,z),(x,y,z+h),.025,mats['naval'],vertices=6)
  for hh in [min(.36,h*.5),h]:
   rod(name+'.wire',(*a,z+hh),(*b,z+hh),.014,mats['edge'],vertices=5)
def shield(name,outline,z,h=.8):
 for a,b in zip(outline,outline[1:]+[outline[0]]):
  # Closed thin metal plates; geometry has thickness for underside inspection.
  delta=Vector((b[0]-a[0],b[1]-a[1],0));mid=((a[0]+b[0])/2,(a[1]+b[1])/2,z+h/2)
  o=box(name,mid,(delta.length,.07,h),mats['naval']);o.rotation_euler.z=math.atan2(delta.y,delta.x)
def interp(t,s):
 for (a,u),(b,v) in zip(t,t[1:]):
  if a<=s<=b:return u+(v-u)*(s-a)/(b-a)
 return t[0][1] if s<t[0][0] else t[-1][1]
h=d['hull'];half=h['length']/2
deck=lambda x:interp(h['deckHeights'],x+half)
width=lambda x:interp([(s['station'],s['points'][-1][0]) for s in h['sections']],x+half)
vs=[]
for s in h['sections']:
 ring=s['points']+[[-w,z] for w,z in reversed(s['points'][1:])]
 vs.extend((s['station']-half,w,z) for w,z in ring)
n=len(ring);fs=[]
for i in range(len(h['sections'])-1):
 fs.extend((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for j in range(n))
fs += [tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))]
o=mesh('hull.envelope',vs,fs,mats['hullgray'],smooth=True);o['nodeId']='hull.surface'
o.data.materials.append(mats['red'])
# Split the authored shell at a horizontal paint line rather than painting whole station quads.
bm=bmesh.new();bm.from_mesh(o.data)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
 dist=.00001,plane_co=(0,0,-1.3),plane_no=(0,0,1),clear_inner=False,clear_outer=False)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
for face in bm.faces:face.material_index=1 if face.calc_center_median().z < -1.30001 else 0
bm.to_mesh(o.data);bm.free()
# The same closed weather-deck skin supplies the CPU contact surface.
vs, weather_faces = weather_geometry(h)
prepare_weather_mesh(mesh('deck.weather',vs,weather_faces,mats['wood']).data)
# The connected stem cap uses the same original surface as CPU structure hits.
stem=next(s for s in d['structures'] if s['id']=='bow-stem-cap')['surface']
mesh('bow.stem-cap',[(-z,-x,y) for x,y,z in stem['vertices']],stem['triangles'],mats['naval'])
# Shared original belt recipe preserves the same well surfaces in CPU contacts.
from casemate_belt import create as create_casemate_belt, openings as belt_openings
create_casemate_belt(prism,d['mounts'],mats['naval'],mats['wood'])
casemate_openings=[]
for mount,mouth in belt_openings(d['mounts']):
 casemate_openings.append(mouth)
 a,z,c=mount['position'];x,y=-c,-a
 cutter=prism('temporary-casemate-cut',mouth,z-.02,7.46)
 for name in ['hull.envelope','deck.weather']:
  target=bpy.data.objects[name];bpy.context.view_layer.objects.active=target
  mod=target.modifiers.new('Authored casemate recess','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
  bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.data.objects.remove(cutter,do_unlink=True)
 cyl(mount['id']+'.hull-seat',(x,y,z-.07),1.34,.14,mats['naval'],vertices=48)
# Four three-bladed screws and two rounded rudders, as seen below the reference stern.
for sign in [-1,1]:
 for idx,(x,y,z,start) in enumerate([(-78.10,7.34,-4.65,-62),(-85.32,4.43,-5.61,-67)]):
  yy=sign*y;name=f'shaft-{sign}-{idx}'
  rod(name+'.tube',(start,yy*.8,z+.4),(x-1.8,yy,z),.23,mats['red'],vertices=20,r2=.20)
  rod(name+'.fairing',(start,yy*.8,z+.4),(start-4,yy*.85,z+.3),.75,mats['red'],vertices=24,r2=.28)
  rod(name+'.bracket',(x+1,yy*.78,z+1.65),(x+.2,yy,z),.18,mats['red'],vertices=12)
  screw_objects=set(col.objects)
  rod(name+'.hub',(x,yy,z),(x-2.0,yy,z),.40,mats['bronze'],vertices=24,r2=.12)
  for blade in range(3):
   angle=blade*math.tau/3+(.4 if sign>0 else -.4)
   vs=[]
   for thickness in [-.04,.04]:
    for j in range(16):
     t=j*math.tau/16;r=1.0+.84*math.cos(t);tangent=.56*math.sin(t)
     u=r*math.cos(angle)-tangent*math.sin(angle);v=r*math.sin(angle)+tangent*math.cos(angle)
     vs.append((x-1.0+sign*tangent*.45+thickness,yy+u,z+v))
   faces=[tuple(reversed(range(16))),tuple(range(16,32))]+[(j,(j+1)%16,(j+1)%16+16,j+16) for j in range(16)]
   mesh(name+f'.blade-{blade}',vs,faces,mats['bronze'],smooth=True)
  joint(f'propeller-{1+idx+(2 if sign>0 else 0)}.spin',(x-1.0,yy,z),set(col.objects)-screw_objects)
 # Rudder stock enters the hull; the broad blade is thickest around that stock.
 yy=sign*1.53
 rudder_objects=set(col.objects)
 rod(f'rudder-{sign}.stock',(-90.18,yy,-1.8),(-90.18,yy,-7.4),.24,mats['red'],vertices=20)
 profile=[(-87.7,-3.15),(-92.8,-3.35),(-95.0,-4.0),(-95.7,-5.0),(-95.6,-6.4),(-94.7,-7.65),(-92.8,-8.15),(-89.2,-7.95),(-88.2,-7.3)]
 n=len(profile);vs=[(x,yy+dy,z) for dy in [-.26,.26] for x,z in profile]
 mesh(f'rudder-{sign}.blade',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)],mats['red'],smooth=True)
 joint('rudder-'+('port' if sign>0 else 'starboard')+'.yaw',(-90.18,yy,-3.15),set(col.objects)-rudder_objects)
# Individually shaped pagoda rooms, open galleries and raked mast structure.
from foundations import create as create_foundations
create_foundations(dict(prism=prism),mats)
from superstructure import create as create_superstructure
create_superstructure(dict(mesh=mesh,prism=prism,rod=rod,cyl=cyl,box=box,rail=rail,
                          shield=shield,oval=oval,rect=rect),mats)
# Funnel deck and two distinct elliptic funnels.
# Independently lofted casings: narrow trunks swell into rounded shoulders,
# then turn inward at a genuinely open mouth. The source's two plan shapes
# differ; no solid lid or painted disk substitutes for the opening.
def funnel_ring(x,rx,ry,z,n=64):
 result=[]
 for i in range(n):
  a=i*math.tau/n;c,ss=math.cos(a),math.sin(a)
  result.append((x+rx*math.copysign(abs(c)**.84,c),ry*math.copysign(abs(ss)**.84,ss),z))
 return result
for name,x,rx,ry,lip in [('forward',8.88,2.78,1.93,22.35),('after',-6.94,2.39,2.13,22.55)]:
 n=64
 profiles=[(7.55,rx,ry),(16.8,rx,ry),(18.3,rx+.05,ry+.10),
           (20.6,rx+.27,2.46),(21.45,rx+.28,2.46),
           (21.85,rx+.13,2.36),(lip,rx-.10,2.10)]
 # Return wall and a dark well are below the lip and remain visible from above.
 rings=[funnel_ring(x,a,b,z) for z,a,b in profiles]
 rings += [funnel_ring(x,rx-.18,2.02,lip),funnel_ring(x,rx-.20,1.98,20.7),
           funnel_ring(x,rx-.35,1.75,18.7)]
 faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
        for j in range(len(rings)-1) for i in range(n)]
 faces.append(tuple(reversed(range(n))))
 faces.append(tuple((len(rings)-1)*n+i for i in range(n)))
 ob=mesh('funnel.'+name,[v for ring in rings for v in ring],faces,mats['naval'],smooth=True)
 ob.data.materials.append(mats['dark'])
 for face in ob.data.polygons:
  if face.index>=6*n:face.material_index=1
 def dims(z):
  return interp([(h,a) for h,a,b in profiles],z),interp([(h,b) for h,a,b in profiles],z)
 def ring_wire(label,z,a,b,r=.025):
  ring=funnel_ring(x,a,b,z)
  for start,end in zip(ring,ring[1:]+ring[:1]):rod('funnel.'+name+label,start,end,r,mats['edge'],vertices=6)
 for z in [10.8,13.1,16.6,18.5,20.6]:
  a,b=dims(z);ring_wire('-seam',z,a+.015,b+.015,.014)
 ring_wire('-mouth-bead',lip+.035,rx-.09,2.11,.035)
 # Raised grille has a rim, stays and bowed transverse bars attached to it.
 ring_wire('-grille-rim',lip+.19,rx-.04,2.16,.024)
 for i in range(16):
  a=i*math.tau/16
  p0=funnel_ring(x,rx-.09,2.11,lip,16)[i]
  p1=funnel_ring(x,rx-.04,2.16,lip+.19,16)[i]
  rod('funnel.'+name+'-rim-stay',p0,p1,.017,mats['edge'],vertices=6)
 for fraction in [-.60,0,.60]:
  xx=x+(rx-.04)*fraction;w=2.16*(1-abs(fraction)**(2/.84))**(.84/2)
  for j in range(12):
   t0=-1+j/6;t1=-1+(j+1)/6
   rod('funnel.'+name+'-grille-bow',(xx,w*t0,lip+.19+.48*(1-t0*t0)),
       (xx,w*t1,lip+.19+.48*(1-t1*t1)),.023,mats['edge'],vertices=6)
 spine=[(x+(rx-.04)*f,0,lip+(.19 if abs(f)==1 else .67)) for f in [-1,-.6,0,.6,1]]
 for a,b in zip(spine,spine[1:]):
  rod('funnel.'+name+'-grille-spine',a,b,.023,mats['edge'],vertices=6)
 # Side ladders follow the shoulder and have short physical wall stand-offs.
 for sign in [-1,1]:
  xx=x+.25
  heights=[7.55,16.8,18.3,20.6,21.45,21.85,lip]
  for dx in [-.22,.22]:
   for z0,z1 in zip(heights,heights[1:]):
    rod('funnel.'+name+'-ladder-rail',(xx+dx,sign*(dims(z0)[1]+.15),z0),
        (xx+dx,sign*(dims(z1)[1]+.15),z1),.024,mats['edge'],vertices=6)
  for j in range(int((lip-7.55)/.28)+1):
   z=7.55+j*.28;yy=sign*(dims(z)[1]+.15)
   rod('funnel.'+name+'-ladder-rung',(xx-.22,yy,z),(xx+.22,yy,z),.022,mats['edge'],vertices=6)
  for z in [8,11,14,17,20,21.8]:
   for dx in [-.22,.22]:rod('funnel.'+name+'-ladder-foot',(xx+dx,sign*dims(z)[1],z),(xx+dx,sign*(dims(z)[1]+.15),z),.025,mats['naval'],vertices=6)
  # External pipes terminate in the paired heads visible above the forward rim.
  xx=x+(rx*.74 if name=='forward' else -.85)
  yy=sign*(ry+.38)
  rod('funnel.'+name+'-steam-pipe',(xx,yy,7.55),(xx,yy,lip+.55),.105,mats['naval'],vertices=16)
  for z in [10,14.5,18,21.4]:
   rod('funnel.'+name+'-pipe-bracket',(xx,sign*(ry*.73),z),(xx,yy,z),.045,mats['edge'],vertices=8)
   cyl('funnel.'+name+'-pipe-flange',(xx,yy,z),.15,.06,mats['edge'],vertices=16)
  rod('funnel.'+name+'-head-bridge',(xx-.34,yy,lip+.55),(xx+.34,yy,lip+.55),.09,mats['dark'],vertices=12)
  for dx in [-.34,.34]:cyl('funnel.'+name+'-head',(xx+dx,yy,lip+.58),.14,.66,mats['dark'],vertices=16)
 if name=='forward':
  # Rounded external screen behind the elevated AA gallery, open at the rear.
  outline=[(x+3.37*math.cos(a),2.43*math.sin(a)) for a in
           [-math.pi*.62+i*math.pi*1.24/48 for i in range(49)]]
  for a,b in zip(outline,outline[1:]):
   mesh('funnel.forward-aa-screen',[(*a,15.0),(*b,15.0),(*b,20.1),(*a,20.1)],[(0,1,2,3)],mats['naval'],smooth=True)
   rod('funnel.forward-screen-edge',(*a,20.1),(*b,20.1),.025,mats['edge'],vertices=6)
  for sign in [-1,1]:
   for z in [15.2,17.5,19.8]:rod('funnel.forward-screen-bracket',(x+rx*.73,sign*ry*.72,z),(x+3.37*.73,sign*2.43*.72,z),.05,mats['naval'],vertices=8)
# After director and lattice mainmast.
from aftertower import create as create_aftertower
create_aftertower(dict(mesh=mesh,prism=prism,rod=rod,cyl=cyl,box=box,rail=rail,
                       shield=shield,oval=oval,rect=rect),mats)
for y in [-3.2,3.2]:
 rod('mast.tripod',(-7,y,7.55),(-3.8,0,28.7),.20,mats['naval'],r2=.09,vertices=16)
rod('mast.forward-leg',(-.5,0,7.55),(-3.8,0,28.7),.24,mats['naval'],r2=.1)
rod('mast.column',(-4.9,0,7.55),(-3.0,0,32.0),.48,mats['naval'],r2=.30,vertices=20)
rod('mast.top',(-3.0,0,30),(-2.8,0,39.8),.13,mats['naval'],r2=.04)
for z,w in [(25.5,5),(29.0,4.2),(35.5,3.4)]:
 x=-4.9+(z-7.55)/(32-7.55)*1.9 if z<=32 else -3+(z-30)/9.8*.2
 rod('mast.yard',(x,-w,z),(x,w,z),.07,mats['naval'])
# Paired boat-hoisting booms, bearings and reeved sheaves on the mainmast.
for sign in [-1,1]:
 y=sign*1.4
 cyl(f'crane-{sign}.foundation',(-1.5,y,8.6),.48,2.1,mats['naval'])
 rod(f'crane-{sign}.pivot',(-1.5,y-.42,9.7),(-1.5,y+.42,9.7),.30,mats['edge'],vertices=20)
 rod(f'crane-{sign}.boom',(-1.5,y,9.7),(8.0,y,31.4),.20,mats['naval'],r2=.10,vertices=16)
 for yy in [y-.18,y+.18]:
  rod(f'crane-{sign}.head-sheave',(8,yy-.05,31.4),(8,yy+.05,31.4),.35,mats['edge'],vertices=20)
  rod(f'crane-{sign}.topping-wire',(-3.0,yy,31.9),(8,yy,31.7),.018,mats['edge'],vertices=6)
  rod(f'crane-{sign}.hoist-wire',(8,yy,31.3),(8,yy,24.0),.017,mats['edge'],vertices=6)
 rod(f'crane-{sign}.lower-block',(8,y-.25,24),(8,y+.25,24),.25,mats['naval'],vertices=16)
 rod(f'crane-{sign}.hook-shank',(8,y,24),(8,y,23.5),.055,mats['edge'],vertices=10)
 for i in range(8):
  a=math.pi+i*math.pi/8;b=a+math.pi/8
  rod(f'crane-{sign}.hook',(8+.16*math.cos(a),y,23.5+.16*math.sin(a)),(8+.16*math.cos(b),y,23.5+.16*math.sin(b)),.045,mats['edge'],vertices=8)
# Forward gallery shares its deck and pierced plating with CPU authoring.
from forward_gallery import create as create_forward_gallery
create_forward_gallery(dict(mesh=mesh,prism=prism,rod=rod,box=box),mats)
from galleries import create as create_galleries
create_galleries(dict(mesh=mesh,prism=prism,rod=rod,shield=shield,oval=oval,rect=rect),mats)
# Standing rigging and signal halyards follow the inspected mast-to-deck layout.
rod('fore-jack.staff',(108.2,0,deck(108.2)),(108.2,0,15.0),.07,mats['naval'],r2=.035,vertices=10)
rod('mast.antenna-yard',(-2.93,-2.6,33.5),(-2.93,2.6,33.5),.055,mats['naval'],vertices=10)
for sign in [-1,1]:
 # The source antenna runs terminate on spars and the after wireless mast,
 # rather than the previously invented quarterdeck anchors beside turret 3.
 rod('foremast.stay',(108.2,sign*.04,14.7),(36.8,sign*.35,31.73),.014,mats['edge'],vertices=5)
 rod('foremast.antenna',(108.2,sign*.04,14.5),(-2.93,sign*2.6,33.5),.012,mats['edge'],vertices=5)
 rod('pagoda.antenna',(25.0,sign*2.2,32.11),(-2.93,sign*2.6,33.5),.014,mats['edge'],vertices=5)
 rod('mainmast.antenna',(-2.93,sign*2.6,33.5),(-65.25,0,26.24),.012,mats['edge'],vertices=5)
 for fraction in [.18,.42]:
  p=(-2.8+(-65.25+2.8)*fraction,0,39.78+(26.24-39.78)*fraction)
  rod('mainmast.antenna-lead',p,(-15.5,sign*2.5,15.8),.01,mats['edge'],vertices=5)
rod('mainmast.top-antenna',(-2.8,0,39.78),(-65.25,0,26.24),.014,mats['edge'],vertices=5)
# After wireless mast sits on the fourth turret and trains with it below.
# Deck-edge stanchions follow the authored sheer, with openings at casemates.
create_deck_rails(rod,mats,deck,width,casemate_openings)
# Original boat-deck hulls, covers and cradles, reconstructed from the inspected view.
def launch(name,x,y,z,length,beam,covered=True,cabin=False):
 outline=[]
 for u,w in [(-.5,.0),(-.44,.31),(-.30,.48),(0,.50),(.34,.39),(.50,0),(.34,-.39),(0,-.50),(-.30,-.48),(-.44,-.31)]:
  outline.append((x+u*length,y+w*beam))
 # Lower hull is tapered to its keel, with a separate gunwale and interior floor.
 n=len(outline);vs=[(x+(a-x)*.70,y+(b-y)*.30,z) for a,b in outline]+[(a,b,z+.85) for a,b in outline]
 mesh(name+'.hull',vs,[tuple(reversed(range(n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mats['naval'])
 prism(name+'.interior',[(x+(a-x)*.91,y+(b-y)*.82) for a,b in outline],z+.55,z+.59,mats['wood'])
 for a,b in zip(outline,outline[1:]+[outline[0]]):rod(name+'.gunwale',(*a,z+.87),(*b,z+.87),.065,mats['edge'],vertices=8)
 if covered:
  # A low arched canvas cover is supported by the boat's gunwales.
  vs=[]
  for u,w in [(-.48,.02),(-.39,.35),(-.24,.47),(0,.49),(.24,.43),(.40,.24),(.49,.01)]:
   for angle in [0,math.pi/6,math.pi/3,math.pi/2,2*math.pi/3,5*math.pi/6,math.pi]:
    vs.append((x+u*length,y+beam*w*math.cos(angle),z+.85+beam*.32*math.sin(angle)))
  mesh(name+'.canvas',vs,[(i*7+j,i*7+j+1,(i+1)*7+j+1,(i+1)*7+j) for i in range(6) for j in range(6)],mats['canvas'],smooth=True)
 elif cabin:
  box(name+'.cabin',(x-.5,y,z+1.2),(length*.48,beam*.76,1.15),mats['naval'])
  box(name+'.cabin-roof',(x-.5,y,z+1.8),(length*.51,beam*.81,.12),mats['edge'])
  for sign in [-1,1]:
   for dx in [-1.8,-.8,.2,1.2]:box(name+'.window',(x+dx,y+sign*beam*.385,z+1.37),(.65,.025,.48),mats['glass'])
 else:
  for j in range(7):box(name+'.thwart',(x+(j-3)*length*.095,y,z+.8),(.18,beam*.76,.09),mats['wood'])
 for dx in [-length*.28,length*.28]:
  base=7.55 if x> -20 else deck(x+dx)
  box(name+'.cradle',(x+dx,y,(base+z)/2),(.24,beam*.75,z-base),mats['naval'])
  rod(name+'.cradle-arm',(x+dx,y-beam*.38,z),(x+dx,y-beam*.46,z+.52),.07,mats['naval'])
  rod(name+'.cradle-arm',(x+dx,y+beam*.38,z),(x+dx,y+beam*.46,z+.52),.07,mats['naval'])
for sign in [-1,1]:
 launch(f'boat.covered-inner-{sign}',12,sign*7.6,8.35,12.0,2.55)
 launch(f'boat.covered-outer-{sign}',1.4,sign*9.15,7.95,12.2,2.5)
 launch(f'boat.motor-{sign}',7.0,sign*5.4,9.0,11.3,2.15,False,True)
 launch(f'boat.cutter-{sign}',-33.5,sign*6.8,7.25,7.0,1.7,False,False)
# Foredeck ground tackle. Dimensions and arrangement follow the approved close view.
# Each chain link is an original swept oval; alternating planes leave open eyes.
def chain_link(name,center,along,tilt):
 tangent=Vector(along).normalized();side=Vector((-tangent.y,tangent.x,0))
 cross=side*math.cos(tilt)+Vector((0,0,1))*math.sin(tilt)
 normal=tangent.cross(cross).normalized();center=Vector(center);vs=[];n=12;k=5
 for i in range(n):
  a=math.tau*i/n;p=center+tangent*(.17*math.cos(a))+cross*(.095*math.sin(a))
  radial=(tangent*math.cos(a)+cross*math.sin(a)).normalized()
  for j in range(k):
   q=p+.029*(radial*math.cos(math.tau*j/k)+normal*math.sin(math.tau*j/k));vs.append(tuple(q))
 mesh(name,vs,[(i*k+j,i*k+(j+1)%k,((i+1)%n)*k+(j+1)%k,((i+1)%n)*k+j) for i in range(n) for j in range(k)],mats['edge'],smooth=True)
from capstans import create as create_capstan
def capstan(name,x,y,r=.62,height=.75):
 create_capstan(dict(cyl=cyl,rod=rod),mats,lambda u:weather_height(h,u,y),name,x,y,r,height)
for sign in [-1,1]:
 hawse_x=98;hawse_y=sign*min(2.3,width(hawse_x)-.95)
 start=Vector((hawse_x,hawse_y,weather_height(h,hawse_x,hawse_y)+.14));end=Vector((76,sign*3.1,deck(76)+.14))
 delta=end-start;steps=round(delta.length/.24)
 # Sloping rubbing bed sits directly on the cambered deck.
 outline=[(hawse_x+.7,hawse_y-.55),(hawse_x+.7,hawse_y+.55),(75.0,sign*3.1+.63),(75.0,sign*3.1-.63)]
 vs=[(x,y,weather_height(h,x,y)+off) for off in [-.01,.065] for x,y in outline]
 mesh('ground-tackle.chain-bed',vs,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mats['edge'])
 for i in range(steps):
  p=start+delta*(i/(steps-1));p.z=weather_height(h,p.x,p.y)+.17
  chain_link('ground-tackle.chain-link',p,delta,.65 if i%2 else -.65)
 # Hawse opening and raised collar, with chain visibly entering the throat.
 prism('ground-tackle.hawse-base',oval(hawse_x,hawse_y,.9,.58,24),weather_height(h,hawse_x,hawse_y)+.06,weather_height(h,hawse_x,hawse_y)+.19,mats['naval'])
 prism('ground-tackle.hawse-throat',oval(hawse_x,hawse_y,.54,.29,24),weather_height(h,hawse_x,hawse_y)+.19,weather_height(h,hawse_x,hawse_y)+.205,mats['dark'])
 for i in range(5):
  chain_link('ground-tackle.hawse-chain',(hawse_x+i*.16,hawse_y,weather_height(h,hawse_x,hawse_y)+.23-i*.035),(1,0,-.2),.65 if i%2 else -.65)
 capstan('ground-tackle.wildcat',76,sign*3.1,.62,.48)
 # The approved foredeck is clear at X=75.9, Y=±1.7; the previous extra
 # warping heads here were unsupported additions directly below the muzzles.
 # Paired bollards share a bolted deck plate.
 for x,y in [(103,1.3),(94,4.9),(83,7.1),(68,9.5)]:
  y=sign*min(y,width(x+.75)-.65);z=weather_height(h,x,y)+.05
  box('mooring.bollard-plate',(x,y,z),(1.5,.72,.12),mats['naval'])
  for dx in [-.45,.45]:
   cyl('mooring.bollard',(x+dx,y,z+.40),.22,.69,mats['naval'])
   cyl('mooring.bollard-head',(x+dx,y,z+.73),.29,.12,mats['edge'])
 for x,y in [(88,1.0),(79,5.0),(69,3.8)]:
  y*=sign;z=weather_height(h,x,y)-.02
  prism('foredeck.hatch-coaming',rect(x-.65,x+.65,y-.45,y+.45,.1),z+.02,z+.25,mats['edge'])
  box('foredeck.hatch-lid',(x,y,z+.29),(1.34,.94,.08),mats['naval'])
  for dx in [-.46,.46]:rod('foredeck.hatch-dog',(x+dx,y-.38,z+.34),(x+dx,y+.38,z+.34),.025,mats['edge'],vertices=6)
capstan('ground-tackle.center-capstan',85,0,.78,1.12)
# Raised aircraft handling deck, centerline turntable, lattice launch track and rails.
flight_plate=next(s for s in d['structures'] if s['id']=='aviation-deck')
flight_core=next(s for s in d['structures'] if s['id']=='aviation-deckhouse')
flight_outline=[(-z,-x) for x,z in flight_plate['footprint']]
core_outline=[(-z,-x) for x,z in flight_core['footprint']]
prism('aviation.deckhouse',core_outline,flight_core['baseY'],flight_core['baseY']+flight_core['height'])
prism('aviation.linoleum',flight_outline,flight_plate['baseY'],flight_plate['baseY']+flight_plate['height'],mats['linoleum'])
from aviation_fittings import create as create_aviation_fittings
create_aviation_fittings(dict(box=box,rod=rod),mats,flight_outline)
cyl('catapult.fixed-seat',(-50.36,0,7.445),1.7,.39,mats['naval'],vertices=48)
cyl('catapult.roller',(-50.36,0,7.72),1.62,.16,mats['edge'],vertices=48)
catapult_aft,catapult_forward=-58.02,-38.44
catapult_bay=(catapult_forward-catapult_aft)/14
for y in [-.65,.65]:
 for z in [7.86,8.7]:rod('catapult.chord',(catapult_aft,y,z),(catapult_forward,y,z),.085,mats['naval'],vertices=8)
 for j in range(14):
  x=catapult_aft+j*catapult_bay
  rod('catapult.web',(x,y,7.86),(x+catapult_bay,y,8.7),.047,mats['naval'],vertices=6)
  rod('catapult.web',(x,y,8.7),(x+catapult_bay,y,7.86),.047,mats['naval'],vertices=6)
for x in [catapult_aft+i*catapult_bay for i in range(15)]:rod('catapult.cross-beam',(x,-.65,8.7),(x,.65,8.7),.055,mats['naval'],vertices=6)
for y in [-.43,.43]:rod('catapult.launch-rail',(catapult_aft,y,8.8),(catapult_forward,y,8.8),.065,mats['edge'],vertices=8)
box('catapult.carriage',(-50.36,0,8.92),(2.2,1.25,.22),mats['naval'])
create_floatplane(dict(mesh=mesh,rod=rod,box=box,joint=joint),mats)
# Original main-battery seats; fitted articulated gunhouses follow in the next assembly pass.
for num,x,z in [(1,60.1,5.15),(2,47.3,8.44),(3,-24.2,5.99),(4,-65.25,3.64)]:
 base=min(deck(x),z)
 cyl(f'barbette-{num}.wall',(x,0,(base+z)/2),4.4,max(.12,z-base),mats['naval'],vertices=64)
from aft_aa_seats import create as create_aft_aa_seats
create_aft_aa_seats(dict(mesh=mesh,cyl=cyl),mats,h,d['mounts'])
# Shared equipment uses the registered original builders.
for mount in d['mounts']:
 create_mount(mount,col,dict(mesh=mesh,box=box,cyl=cyl,rod=rod),mats)
 # Roof-mounted AA inherit main-turret training while retaining their own joints.
 if mount.get('parentMountId'):
  bpy.context.view_layer.update()
  base=bpy.data.objects[mount['id']+'.base']
  world=base.matrix_world.copy()
  base.parent=bpy.data.objects[mount['parentMountId']+'.yaw']
  base.matrix_world=world
# Raised roof platforms belong to the main turret's yaw frame.
for parent_id in ['main-2','main-3']:
 yaw=bpy.data.objects[parent_id+'.yaw']
 before=set(col.objects)
 create_turret_roof(parent_id,dict(prism=prism,mesh=mesh,box=box,rod=rod),mats)
 for o in set(col.objects)-before:
  o.parent=yaw;o['assemblyId']=parent_id
# The source's slender after wireless mast is carried by turret No. 4.
yaw=bpy.data.objects['main-4.yaw'];before=set(col.objects)
for y in [-.75,.75]:rod('after-wireless.leg',(0,y,5.17),(0,0,22.6),.055,mats['naval'],vertices=8)
for z in [7,9,11,13,15,17,19,21]:
 w=.75*(22.6-z)/(22.6-5.17)
 rod('after-wireless.rung',(0,-w,z),(0,w,z),.028,mats['naval'],vertices=6)
for o in set(col.objects)-before:o.parent=yaw;o['assemblyId']='main-4'
scene['definitionHash']=d['contentHash']
create_flagstaffs(d)
sys.path.insert(0,str(ROOT/'assets/ships/appearance'))
from surface import apply_appearance
from decking import apply_decking
apply_appearance(scene,mats,Path(__file__).with_name('appearance.json'))
apply_decking(scene,mats,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))

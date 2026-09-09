"""Original Yukikaze geometry. Author metres, +X bow, +Y port, +Z up.
Only blueprint/catalog/original recipes are loaded. Reference geometry is excluded.
"""
import bpy,bmesh,json,math,os,sys,importlib.util
from pathlib import Path
from mathutils import Vector,Matrix
from array import array
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
from blender_barrels import barrel_layout
out=Path(os.environ['SHIP_OUTPUT']);definition=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='Yukikaze original';scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
col=bpy.data.collections.new('Yukikaze original assemblies');scene.collection.children.link(col)
materials={}
colors={'naval':(.24,.27,.29,1),'hullgray':(.22,.25,.27,1),'roof':(.19,.22,.24,1),'deck':(.19,.22,.23,1),'edge':(.12,.15,.17,1),'canvas':(.44,.46,.43,1),'dark':(.018,.024,.027,1),'glass':(.055,.10,.12,1),'underwater':(.17,.15,.095,1),'bronze':(.28,.23,.12,1),'rope':(.25,.24,.20,1),'white':(.62,.64,.61,1),'wood':(.27,.19,.13,1),'wear':(.31,.33,.34,1),'linoleum':(.27,.115,.055,1)}
for key,color in colors.items():
 m=bpy.data.materials.new('Yukikaze '+key);m.diffuse_color=color;m.use_nodes=True
 bs=m.node_tree.nodes['Principled BSDF'];bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=.72;bs.inputs['Metallic'].default_value=.14
 materials[key]=m
def mesh(name, vertices, faces, material, collection=col, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); collection.objects.link(obj)
    if material: data.materials.append(material)
    for p in data.polygons: p.use_smooth = smooth
    obj['assemblyId'] = name.split('.')[0]
    return obj

def cyl(name, loc, radius, depth, material, collection=col, vertices=24, r2=None):
    r2 = radius if r2 is None else r2; depth = max(.001,depth)
    vs = [(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z)
          for z,r in [(-depth/2,radius),(depth/2,r2)] for i in range(vertices)]
    fs = [(i,(i+1)%vertices,vertices+(i+1)%vertices,vertices+i) for i in range(vertices)]
    fs += [tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]
    o = mesh(name,vs,fs,material,collection,True); o.location=loc
    o.data.polygons[-1].use_smooth=False; o.data.polygons[-2].use_smooth=False
    return o

def rod(name, a, b, r, material, collection=col, r2=None, vertices=10):
    a,b = Vector(a),Vector(b)
    o = cyl(name,(a+b)/2,r,(b-a).length,material,collection,vertices,r2)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return o

def box(name, loc, dim, material, collection=col, bev=.035):
    x,y,z = (d/2 for d in dim)
    vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    o=mesh(name,vs,[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],material,collection)
    o.location=loc
    if bev:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=min(bev,min(dim)*.24); mod.segments=2
    return o

def empty(name,loc):
    o=bpy.data.objects.new(name,None);col.objects.link(o);o.location=loc
    o['nodeId']=name;o['assemblyId']=name.split('.')[0];return o

def attach(obj,parent):
    bpy.context.view_layer.update(); world=obj.matrix_world.copy()
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_world=world

def local(obj,parent,assembly=None):
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4)
    if assembly:obj['assemblyId']=assembly
    return obj

def tube_path(name,points,r,mat,sides=8,closed=False):
    pts=[Vector(p) for p in points];verts=[];n=len(pts)
    for i,p in enumerate(pts):
        delta=pts[(i+1)%n]-pts[(i-1)%n] if closed else pts[min(i+1,n-1)]-pts[max(i-1,0)]
        q=delta.to_track_quat('Z','Y')
        verts += [p+q@Vector((r*math.cos(j*math.tau/sides),r*math.sin(j*math.tau/sides),0)) for j in range(sides)]
    faces=[]
    for i in range(n if closed else n-1):
        k=(i+1)%n
        faces += [(i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j) for j in range(sides)]
    if not closed:faces += [tuple(reversed(range(sides))),tuple((n-1)*sides+j for j in range(sides))]
    return mesh(name,verts,faces,mat,smooth=True)

def outline_oval(cx,cy,rx,ry,n=48):return [(cx+rx*math.cos(i*math.tau/n),cy+ry*math.sin(i*math.tau/n)) for i in range(n)]
def outline_rect(x0,x1,y0,y1,c=.18):return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]

def prism(name,outline,z0,z1,mat=materials['naval'],roof=True):
    n=len(outline);vs=[(x,y,z) for z in [z0,z1] for x,y in outline]
    faces=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n)))]
    if roof:faces += [tuple(range(n,2*n))]
    o=mesh(name,vs,faces,mat)
    if roof:
        o.data.materials.append(materials['deck']);o.data.polygons[-1].material_index=1
    return o

def bulwark(name,outline,z,height=.85,thick=.065,closed=True):
    # Visible shell thickness and a rolled upper edge, with openings left as real openings.
    n=len(outline);center=Vector((sum(p[0] for p in outline)/n,sum(p[1] for p in outline)/n))
    inside=[]
    for p in outline:
        p=Vector(p);inside.append(tuple(p+(center-p).normalized()*thick))
    verts=[(x,y,zz) for shape,zz in [(outline,z),(outline,z+height),(inside,z+height),(inside,z)] for x,y in shape]
    faces=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i),(2*n+i,2*n+j,3*n+j,3*n+i)])
    mesh(name+'.plating',verts,faces,materials['naval'])
    tube_path(name+'.cap',[(x,y,z+height+.01) for x,y in outline],.034,materials['edge'],closed=closed)
    for i in range(0,n,max(1,n//12)):
        x,y=inside[i];rod(name+'.stiffener',(x,y,z+.07),(x,y,z+height-.035),.028,materials['edge'],vertices=6)

def rails(name,points,height=.94,closed=False,spacing=1.8):
    dense=[]
    count=len(points) if closed else len(points)-1
    for i in range(count):
        a,b=Vector(points[i]),Vector(points[(i+1)%len(points)]);steps=max(1,math.ceil((b-a).length/spacing))
        dense += [tuple(a.lerp(b,j/steps)) for j in range(steps)]
    if not closed:dense.append(points[-1])
    # Source's lowered foregun lifelines leave the barrel sweep unobstructed.
    def height_at(x):return .52 if name=='rails.perimeter' and 35<x<49 else height
    for p in dense:rod(name+'.stanchion',p,(p[0],p[1],p[2]+height_at(p[0])),.024,materials['edge'],vertices=6)
    for ratio in [1/3,2/3,1]:tube_path(name+'.lifeline',[(x,y,z+height_at(x)*ratio) for x,y,z in dense],.010 if ratio<1 else .017,materials['edge'],sides=6,closed=closed)

def ladder(name,a,b,w=.55):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/.29))
    for side in [-1,1]:rod(name+'.rail',a+Vector((0,side*w/2,0)),b+Vector((0,side*w/2,0))+(b-a).normalized()*.65,.026,materials['edge'],vertices=8)
    for i in range(n+1):
        p=a.lerp(b,i/n);rod(name+'.rung',p+Vector((0,-w/2,0)),p+Vector((0,w/2,0)),.023,materials['naval'],vertices=8)

def stairs(name,a,b,w=.70):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b.z-a.z)/.23))
    for side in [-1,1]:
        offset=Vector((0,side*w/2,0));rod(name+'.stringer',a+offset,b+offset,.06,materials['edge'])
        rod(name+'.handrail',a+offset+Vector((0,0,.8)),b+offset+Vector((0,0,.8)),.026,materials['naval'])
        for t in [0,.5,1]:
            p=a.lerp(b,t)+offset;rod(name+'.post',p,p+Vector((0,0,.8)),.025,materials['naval'])
    for i in range(n+1):
        p=a.lerp(b,i/n);box(name+'.tread',p,(abs(b.x-a.x)/n+.06,w,.055),materials['roof'],bev=.006)

def portlight(name,center,normal,r=.18):
    p=Vector(center);v=Vector(normal)
    rod(name+'.rim',p-v*.012,p+v*.045,r,materials['edge'],vertices=20)
    rod(name+'.glass',p+v*.046,p+v*.055,r*.76,materials['glass'],vertices=20)
    # Rain eyebrow remains visible in close views.
    tangent=Vector((-v.y,v.x,0));up=Vector((0,0,1))
    tube_path(name+'.eyebrow',[p+v*.075+tangent*(r*1.08*math.cos(i*math.pi/10))+up*(r*1.08*math.sin(i*math.pi/10)) for i in range(11)],.018,materials['naval'],sides=6)

def door(name,x,y,z,side=1,w=.66,h=1.55):
    box(name+'.frame',(x,y-side*.035,z+h/2),(w,.12,h),materials['edge'],bev=.025)
    outline=[(x-w/2,z+.12),(x-w/2+.12,z),(x+w/2-.12,z),(x+w/2,z+.12),(x+w/2,z+h-.12),(x+w/2-.12,z+h),(x-w/2+.12,z+h),(x-w/2,z+h-.12)]
    o=mesh(name+'.gasket',[(a,y,b) for a,b in outline],[tuple(range(8))],materials['dark'])
    mesh(name+'.leaf',[(x+(a-x)*.92,y+side*.028,z+h/2+(b-z-h/2)*.97) for a,b in outline],[tuple(range(8))],materials['naval'])
    for dz in [.35,1.15]:
        rod(name+'.hinge',(x-w/2+.06,y+side*.075,z+dz-.1),(x-w/2+.06,y+side*.075,z+dz+.1),.028,materials['edge'])
        box(name+'.dog',(x+w*.33,y+side*.065,z+dz),(.14,.06,.035),materials['edge'],bev=.005)
    rod(name+'.handle',(x+w*.28,y+side*.12,z+.72),(x+w*.28,y+side*.12,z+.9),.021,materials['edge'])
    for dz in [.72,.90]:rod(name+'.handle-foot',(x+w*.28,y+side*.025,z+dz),(x+w*.28,y+side*.12,z+dz),.020,materials['edge'])

def locker(name,loc,dim=(.62,.5,.72)):
    x,y,z=loc;box(name+'.box',loc,dim,materials['naval'])
    box(name+'.lid',(x,y,z+dim[2]/2+.024),(dim[0]+.035,dim[1]+.035,.045),materials['roof'],bev=.012)
    for xx in [-.18,.18]:box(name+'.latch',(x+xx,y-dim[1]/2-.018,z+.1),(.045,.04,.11),materials['edge'],bev=.006)

exec(compile((ROOT/'assets/ships/yukikaze/refinements.py').read_text(), 'yukikaze/refinements.py', 'exec'), globals())

exec(compile((ROOT/'assets/ships/yukikaze/torpedo-assemblies.py').read_text(), 'yukikaze-torpedo-assemblies', 'exec'), globals())
h=definition['hull'];half=h['length']/2
def interp(table,s):
 for (a,u),(b,v) in zip(table,table[1:]):
  if a<=s<=b:return u+(v-u)*(s-a)/(b-a)
 return table[0][1] if s<table[0][0] else table[-1][1]
width=lambda x:interp(h['halfBreadths'],x+half)
deckz=lambda x:interp(h['deckHeights'],x+half)
# Independently interpreted sections and continuous cambered deck.
verts=[]
for section in h['sections']:
 pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
 verts.extend((section['station']-half,w,z) for w,z in ring)
n=len(ring);faces=[]
for i in range(len(h['sections'])-1):faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for j in range(n)]
faces += [tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))]
hull=mesh('hull.envelope',verts,faces,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface'
verts=[]
for s,w in h['halfBreadths']:
 x=s-half;z=deckz(x)+.012;verts += [(x,-w,z),(x,0,z+.045),(x,w,z)]
mesh('deck.main',verts,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(len(h['halfBreadths'])-1) for j in range(2)],materials['deck'])
for lo,hi in [(35.8,53),(-53,-32.5),(23.1,35.7)]:
 xs=[lo]+[s-half for s,w in h['halfBreadths'] if lo<s-half<hi]+[hi]
 vs=[(x,sign*(width(x)-.30),deckz(x)+.07) for x in xs for sign in [-1,1]]
 mesh('deck.linoleum',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(xs)-1)],materials['linoleum'])
 for x in [lo+i*1.9 for i in range(int((hi-lo)/1.9)+1)]:rod('deck.retaining-strip',(x,-width(x)+.3,deckz(x)+.085),(x,width(x)-.3,deckz(x)+.085),.012,materials['bronze'],vertices=5)
for sign in [-1,1]:
 pts=[(s-half,sign*max(.03,w-.09),deckz(s-half)+.04) for s,w in h['halfBreadths'] if 1<s<h['length']-1]
 rails('rails.perimeter',pts,height=.86,spacing=2.2)
 tube_path('hull.sheer-strake',pts,.034,materials['edge'],sides=6)
 for x in range(-48,53,3):
  z=deckz(x)-.7;y=sign*(width(x)*.989)
  portlight('hull.portlight',(x,y,z),(0,sign,0),.11)
# Definition-owned superstructure silhouettes.
for s in definition['structures']:
 if 'funnel' in s['id'] or s['id'] in ['torpedo-working-deck','midships-aa-deck']:continue
 outline=[(-z,-x) for x,z in s['footprint']]
 prism(s['id']+'.walls',outline,s['baseY'],s['baseY']+s['height'])
 tube_path(s['id']+'.edge',[(x,y,s['baseY']+s['height']+.02) for x,y in outline],.045,materials['edge'],closed=True)
 if s['id'] not in ['director-house','wheelhouse','bridge-lower','bridge-middle','bridge-after']:
  w=max(abs(y) for x,y in outline);xmin=min(x for x,y in outline);xmax=max(x for x,y in outline)
  for sign in [-1,1]:
   for x in [xmin+.9+i*2.5 for i in range(max(1,int((xmax-xmin-1)/2.5)))]:
    if s['id']=='after-deckhouse' and x < -29.2:continue
    door(s['id']+'.door',x,sign*(w+.03),s['baseY']+.12,sign,h=min(1.65,s['height']-.2))
refined_bridge()
# Forward AA shelf and outboard single-gun walkways with structural knees.
prism('bridge.forward-aa-platform',outline_rect(30.3,34.0,-1.75,1.75,.45),6.72,6.9)
for sign in [-1,1]:
 rod('bridge.forward-aa-column',(32.6,sign*1.15,deckz(32.6)),(32.6,sign*1.15,6.78),.20,materials['naval'],vertices=20)
 prism('bridge.side-walkway',outline_rect(24.2,33.7,sign*3.7-.55,sign*3.7+.55,.12),4.60,4.72)
 for x in [25,28,31.7]:rod('bridge.walkway-knee',(x,sign*2.1,4.7),(x,sign*3.8,4.67),.07,materials['edge'])
 bulwark('bridge.forward-aa-shield',[(34,sign*1.35),(33.6,sign*1.75),(30.3,sign*1.75)],6.9,.65,closed=False)

refined_midships_platforms()
refined_funnels()
# Original masts, optical fittings and rigging.
for label,x,zbase,ztop in [('foremast',21,4.7,22.91),('aftmast',-21.2,5.15,15.18)]:
 top=(x-1.0,0,ztop)
 rod(label+'.pole',(x,0,deckz(x) if label=='foremast' else zbase),top,.14,materials['edge'],r2=.035,vertices=16)
 if label=='foremast':
  for sign in [-1,1]:rod(label+'.tripod',(x-2.1,sign*1.65,deckz(x-2.1)),(x-.55,0,15.3),.10,materials['naval'],r2=.055)
  for z in [7,9,11,13]:
   for sign in [-1,1]:rod(label+'.brace',(x-2.1+1.55*(z-deckz(x-2.1))/(15.3-deckz(x-2.1)),sign*1.65*(15.3-z)/(15.3-deckz(x-2.1)),z),(x-(z+2-deckz(x))/(ztop-deckz(x)),0,z+2),.032,materials['edge'])
 for z,span in [(ztop-1.5,1.6),(ztop-4.6,2.3)]:
  xx=x-(z-zbase)/(ztop-zbase);rod(label+'.yard',(xx,-span,z),(xx,span,z),.035,materials['edge'])
  for sign in [-1,1]:rod(label+'.yard-stay',(xx,sign*span,z),(x-.9,0,min(ztop,z+2)),.009,materials['dark'],vertices=5)
 ladder(label+'.ladder',(x,0,zbase),(x-1,0,ztop-1),.32)
for xx,zz in [(20.025,22.5),(-22.182,15.0)]:rod('rigging.aerial-crossbar',(xx,-.48,zz),(xx,.48,zz),.035,materials['edge'])
for sign in [-1,1]:
 for xx,zz in [(57,6),(-57,2.9)]:rod('rigging.deck-padeye',(xx,sign*.2,deckz(xx)),(xx,sign*.2,zz),.028,materials['edge'])
 rod('rigging.aerial',(20,sign*.45,22.5),(-22.2,sign*.45,15.0),.009,materials['dark'],vertices=5)
 rod('rigging.bow-stay',(20,0,22.5),(57,sign*.2,6),.009,materials['dark'],vertices=5)
 rod('rigging.stern-stay',(-22.2,0,15),(-57,sign*.2,2.9),.009,materials['dark'],vertices=5)
 for xx,yy in [(25,2.1),(19.1,1.25)]:rod('rigging.shroud',(20.16,0,20),(xx,sign*yy,8.84),.01,materials['dark'],vertices=5)
# Paired Type 22 horns, mast platforms and the director's optical rangefinder.
prism('radar.platform',outline_rect(20.2,23.3,-.75,.75,.1),13.3,13.45)
rod('radar.platform-knee',(20.542,0,12),(22.7,0,13.35),.08,materials['naval'])
for z in [13.9,14.65]:
 rod('radar.horn',(21.35,0,z),(23.15,0,z),.12,materials['naval'],r2=.25,vertices=24)
 rod('radar.horn-mouth',(23.16,0,z),(23.18,0,z),.205,materials['dark'],vertices=24)
 rod('radar.horn-support',(21.5,0,13.4),(21.5,0,z),.07,materials['edge'])
# Bridge after block and the long supported steam trunk seen on the approved fit.
for sign in [-1,1]:
 tube_path('bridge.long-steam-trunk',[(22,sign*1.63,4.5),(21.8,sign*1.7,5.8),(21.3,sign*1.7,6.5),(13.9,sign*1.63,9.3),(13.4,sign*1.5,10.5),(13.3,sign*1.5,11.4)],.145,materials['naval'],sides=16)
 for x,z in [(21.4,6.4),(13.9,9.3)]:rod('bridge.trunk-bracket',(x,sign*1.3,z),(x,sign*1.7,z),.055,materials['edge'])
 tube_path('bridge.trunk-intake',[(20.2,sign*1.63,2.80),(20.2,sign*1.63,3.8),(20.5,sign*1.63,4.4),(21.2,sign*1.63,4.55),(22,sign*1.63,4.5)],.30,materials['naval'],sides=20)
 # Torpedo reload housings seated along the central working deck.
 prism('torpedo-reload.housing',outline_rect(8.0,16.8,sign*2.3-.45,sign*2.3+.45,.18),2.80,3.65)
 for x in [8.5,11,14,16]:box('torpedo-reload.stiffener',(x,sign*2.3,3.67),(.045,.9,.055),materials['edge'],bev=.004)
 # Thin bilge keels follow the original lower hull side.
 pts=[(-29,sign*5.15,-2.4),(-25,sign*5.48,-2.4),(8,sign*5.46,-2.4),(12,sign*5.1,-2.4)]
 # Inner edge embeds into the bilge at every station.
 vs=[(x,y,z) for x,y,z in pts]+[(x,sign*width(x)*.86,z+.25) for x,y,z in pts]
 ob=mesh('hull.bilge-keel',vs,[(0,1,5,4),(1,2,6,5),(2,3,7,6)],materials['hullgray']);mod=ob.modifiers.new('Bilge keel plate','SOLIDIFY');mod.thickness=.04
# After searchlight shelf and access rail.
prism('searchlight.platform',outline_rect(-6.8,-3.9,-1.35,1.35,.3),6.90,7.12)
for sign in [-1,1]:rod('searchlight.platform-knee',(-5.4,sign*.85,5.5),(-5.4,sign*1.3,6.94),.085,materials['naval'])
# Main gun articulation, followed by original Type C details.
helpers=dict(mesh=mesh,cyl=cyl,rod=rod,box=box)
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount as create_shared_mount
for mount in [m for m in definition['mounts'] if m['battery']=='main']:
 create_shared_mount(mount,col,dict(helpers,deck_height=(lambda xx:5.15) if mount['id']=='main-2' else deckz),materials)
# Type 96 triple recipe reused from the original catalog collection.
module=importlib.util.spec_from_file_location('ijn_original',ROOT/'assets/parts/ijn-carrier-guns/geometry.py');ijn=importlib.util.module_from_spec(module);module.loader.exec_module(ijn)
for m in [m for m in definition['mounts'] if 'triple' in m['id']]:
 yaw=ijn.create_mount(m,col,helpers,materials)
 # This destroyer variant has a narrower original carriage than the carrier fit.
 for o in list(col.objects):
  if o.get('assemblyId')==m['id'] and o.type=='MESH' and o.parent==yaw:
   o.location.y*=.79
   for v in o.data.vertices:v.co.y*=.79
# Single Type 96: conical pedestal, yoke, receiver, top magazine and shoulder cradle.
for m in [m for m in definition['mounts'] if 'single' in m['id']]:
 name=m['id'];sp=m['weapon'];a,z,c=m['position'];base=empty(name+'.base',(-c,-a,z));yaw=empty(name+'.yaw',(0,0,0));yaw.parent=base;yaw.rotation_euler.z=-math.radians(m['bearingDeg'])
 def lc(o,p=yaw):return local(o,p,name)
 lc(cyl(name+'.foundation',(0,0,.07),.35,.14,materials['edge'],vertices=32),base)
 # Source single mount: low pedestal and an open fork raked aft of its axis.
 trunnion=sp['trunnionForward']
 lc(cyl(name+'.pedestal',(0,0,.45),.16,.64,materials['naval'],vertices=24,r2=.105))
 lc(box(name+'.saddle',(0,0,.80),(.34,.40,.12),materials['naval']))
 for side in [-1,1]:
  profile=[(.14,.77),(-.10,.77),(trunnion-.12,1.40),(trunnion,1.54),(trunnion+.13,1.40)]
  vs=[(xx,side*.17+dy,zz) for dy in [-.035,.035] for xx,zz in profile];nn=len(profile)
  lc(mesh(name+'.open-fork',vs,[tuple(reversed(range(nn))),tuple(range(nn,2*nn))]+[(i,(i+1)%nn,(i+1)%nn+nn,i+nn) for i in range(nn)],materials['naval']))
  lc(rod(name+'.bearing',(trunnion,side*.10,1.46),(trunnion,side*.24,1.46),.10,materials['edge'],vertices=20))
 lc(rod(name+'.trunnion-axle',(trunnion,-.23,1.46),(trunnion,.23,1.46),.045,materials['edge']))
 for angle in [0,120,240]:
  theta=math.radians(angle);vs=[(.12*math.cos(theta),.12*math.sin(theta),.16),(.29*math.cos(theta),.29*math.sin(theta),.16),(.10*math.cos(theta),.10*math.sin(theta),.42)]
  gusset=mesh(name+'.foot-gusset',vs,[(0,1,2)],materials['naval']);mod=gusset.modifiers.new('Gusset thickness','SOLIDIFY');mod.thickness=.022;lc(gusset,base)
 elev=empty(name+'.center.elevation',(trunnion,0,1.46));elev.parent=yaw;elev.rotation_euler.y=-math.radians(1)
 rec=empty(name+'.center.recoil',(0,0,0));rec.parent=elev
 muzzle=empty(name+'.center.muzzle',(sp['muzzleForward']-trunnion,0,0));muzzle.parent=rec
 lc(box(name+'.receiver',(-.32,0,0),(.72,.15,.18),materials['edge']),rec)
 lc(box(name+'.cradle',(-.13,0,-.10),(.74,.18,.10),materials['naval']),elev)
 lc(box(name+'.magazine-socket',(-.28,0,.13),(.28,.20,.10),materials['naval']),rec)
 lc(box(name+'.box-magazine',(-.28,0,.37),(.27,.17,.40),materials['edge']),rec)
 lc(box(name+'.magazine-cap',(-.28,0,.58),(.30,.19,.04),materials['naval']),rec)
 lc(rod(name+'.gas-cylinder',(-.1,0,-.10),(.70,0,-.10),.032,materials['naval']),elev)
 length=sp['muzzleForward']-trunnion
 lc(rod(name+'.barrel',(0,0,0),(length,0,0),.041,materials['edge'],r2=.025,vertices=20),rec)
 for j in range(12):
  o=rod(name+'.cooling-ring',(.14+j*.04,0,0),(.155+j*.04,0,0),.047,materials['naval'],vertices=16);lc(o,rec)
 lc(rod(name+'.flash-hider',(length-.12,0,0),(length,0,0),.03,materials['edge'],r2=.055,vertices=20),rec)
 lc(rod(name+'.bore',(length-.002,0,0),(length+.002,0,0),.0125,materials['dark'],vertices=20),rec)
 for s in [-1,1]:
  lc(tube_path(name+'.shoulder-rest',[(-.45,s*.08,-.05),(-.64,s*.27,-.1),(-.67,s*.27,.08)],.018,materials['edge']),elev)
  lc(rod(name+'.charging-handle',(-.44,s*.08,.03),(-.48,s*.18,.07),.014,materials['naval']),rec)
 lc(rod(name+'.sight-bracket',(-.1,0,-.05),(-.1,.17,.31),.018,materials['naval']),elev)
 lc(tube_path(name+'.ring-sight',[(.13,.17+.10*math.cos(j*math.tau/24),.31+.10*math.sin(j*math.tau/24)) for j in range(24)],.009,materials['edge'],closed=True),elev)
 lc(rod(name+'.sight-rail',(-.35,.17,.31),(.13,.17,.31),.012,materials['edge']),elev)
# Reference-matched original Type 93 quadruple launchers.
for l in definition['torpedoLaunchers']:refined_torpedo_launcher(l)
# Depth charge dumpers, projector and original ready-charge rack.
for l in definition['depthChargeLaunchers']:
 name=l['id'];a,z,c=l['position'];x,y=-c,-a
 empty(name+'.release',(x,y,z))
 if name!='depth-charge-7':
  for sign in [-1,1]:
   rod(name+'.track',(x-.45,y+sign*.26,deckz(x)+.16),(x+.5,y+sign*.26,deckz(x)+.16),.05,materials['edge'])
   for xx in [x-.35,x+.35]:rod(name+'.foot',(xx,y+sign*.26,deckz(x)),(xx,y+sign*.26,z),.035,materials['naval'])
  rod(name+'.charge',(x,y-.34,z+.19),(x,y+.34,z+.19),.22,materials['naval'],vertices=24)
  for sign in [-1,1]:rod(name+'.drum-band',(x,y+sign*.25-.02,z+.19),(x,y+sign*.25+.02,z+.19),.24,materials['edge'],vertices=24)
 else:
  cyl(name+'.pedestal',(x,y,3.15),.28,.75,materials['naval'],vertices=24)
  rod(name+'.cross-projector',(x,-.7,3.65),(x,.7,3.65),.14,materials['edge'],vertices=24)
  for sign in [-1,1]:rod(name+'.brace',(x,sign*.6,deckz(x)),(x,sign*.2,3.5),.06,materials['naval'])
for xx in [-45.3,-44.8]:
 for yy in [-1.1,-.55,0,.55,1.1]:
  rod('charge-rack.drum',(xx-.3,yy,3.7),(xx+.3,yy,3.7),.22,materials['naval'],vertices=20)
  for dx in [-.28,.28]:rod('charge-rack.band',(xx+dx-.015,yy,3.7),(xx+dx+.015,yy,3.7),.235,materials['edge'],vertices=20)
for yy in [-1.4,1.4]:
 for xx in [-45.6,-44.5]:rod('charge-rack.post',(xx,yy,deckz(xx)),(xx,yy,4.2),.04,materials['naval'])
 tube_path('charge-rack.rails',[(-45.6,yy,3.45),(-44.5,yy,3.45),(-44.5,yy,4.2),(-45.6,yy,4.2)],.035,materials['edge'])
# Boats in original cradles, with gunwales, ribs and supported davits.
for sign in [-1,1]:
 cx,cy,z=-3.8,sign*4.35,4.6;L=8;B=2.05
 stations=[(-4,.1,.30),(-3.3,.55,-.05),(-2,.89,-.25),(0,1,-.4),(2,.86,-.20),(3.3,.48,.10),(4,.02,.65)]
 vs=[(cx+x,cy+yy,z+zz) for x,w,k in stations for yy,zz in [(-w*B/2,.70),(-w*B*.43,.05),(0,k),(w*B*.43,.05),(w*B/2,.70)]]
 ob=mesh('boat.shell',vs,[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(6) for j in range(4)],materials['wood'],smooth=True)
 mod=ob.modifiers.new('Boat plating','SOLIDIFY');mod.thickness=.045
 for s in [-1,1]:tube_path('boat.gunwale',[(cx+x,cy+s*w*B/2,z+.70) for x,w,k in stations],.055,materials['naval'])
 for xx in [-2,-.8,.7,1.9]:box('boat.thwart',(cx+xx,cy,z+.40),(.30,1.7,.075),materials['wood'])
 box('boat.floor',(cx,cy,z-.12),(4.7,.85,.065),materials['wood'])
 for xx in [-2.4,2.4]:
  x=cx+xx
  for s in [-1,1]:rod('boat.cradle',(x,cy+s*.70,deckz(x)),(x,cy+s*.65,z+.05),.10,materials['naval'])
  rod('boat.cradle-crosspiece',(x,cy-.8,z-.05),(x,cy+.8,z-.05),.10,materials['naval'])
  tube_path('boat.davit',[(x,sign*3.55,deckz(x)),(x,sign*3.55,6.05),(x,sign*3.8,6.55),(x,cy,6.55)],.07,materials['naval'],sides=12)
  rod('boat.fall',(x,cy,6.55),(x,cy,z+.9),.014,materials['rope'])
  for s in [-1,1]:rod('boat.sling',(x,cy,z+.9),(x,cy+s*.8,z+.7),.018,materials['rope'])
# Shaft lines and handed propellers. Port screw is the approved mirrored approximation.
for sign in [-1,1]:
 a=(-33,sign*1.45,-1.6);b=(-50.8,sign*2.75,-2.75)
 rod('propulsion.shaft',a,b,.17,materials['edge'],vertices=24)
 for x in [-46.5,-49]:
  rod('propulsion.strut',(x,sign*3.2,-.3),(x,sign*2.6,-2.65),.12,materials['naval'],vertices=16)
  rod('propulsion.strut',(x,sign*1.1,-1.5),(x,sign*2.6,-2.65),.11,materials['naval'],vertices=16)
 rod('propulsion.hub',(-50.2,sign*2.75,-2.75),(-51.25,sign*2.75,-2.75),.28,materials['bronze'],r2=.08,vertices=24)
 for j in range(3):
  theta=j*math.tau/3;vs=[]
  for radius,halfchord,sweep in [(.20,.12,0),(.55,.33,.13),(.9,.35,.25),(1.14,.18,.36),(1.17,.02,.39)]:
   for u in [-1,1]:
    t=theta+sign*(sweep+u*halfchord/max(radius,.2));vs.append((-50.6+sign*u*halfchord*.65,sign*2.75+radius*math.cos(t),-2.75+radius*math.sin(t)))
  ob=mesh('propulsion.screw-blade',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(4)],materials['bronze'],smooth=True)
  mod=ob.modifiers.new('Cast blade thickness','SOLIDIFY');mod.thickness=.055
rudder_outline=[(-56.6,-.75),(-53.9,-.75),(-53.5,-1.20),(-53.7,-2.60),(-54.2,-3.35),(-55.8,-3.35),(-56.35,-2.90),(-56.7,-1.5)]
vs=[(x,y,z) for y in [-.15,.15] for x,z in rudder_outline];n=len(rudder_outline)
mesh('rudder.blade',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['naval'])
rod('rudder.stock',(-54.7,0,-1),(-54.7,0,1.4),.14,materials['edge'])
# Bitts, fairleads, capstan, anchors, chain runs and restrained working fittings.
for sign in [-1,1]:
 for x in [-52,37,50,54]:
  y=sign*width(x)*.7;z=deckz(x)
  box('mooring.foot',(x,y,z+.08),(1.0,.45,.15),materials['edge'])
  for xx in [-.3,.3]:
   cyl('mooring.bitt',(x+xx,y,z+.35),.12,.5,materials['naval'],vertices=16)
   cyl('mooring.cap',(x+xx,y,z+.60),.17,.05,materials['edge'],vertices=16)
 for x in [24,27.4,36.5,-22.5,-40]:locker('equipment.ready-locker',(x,sign*2.45,deckz(x)+.37),(.65,.45,.70))
 x=53;y=sign*(width(x)-.1);z=3.4
 rod('anchor.shank',(x,y,z),(x-1.0,y,z-.65),.085,materials['edge'],vertices=12)
 rod('anchor.stock',(x-1.0,y-.35,z-.65),(x-1.0,y+.35,z-.65),.10,materials['edge'])
 for yy in [-.35,.35]:rod('anchor.fluke',(x-1,y+yy,z-.65),(x-.55,y+yy,z-.25),.12,materials['edge'],r2=.025)
 for i in range(40):
  x=48+i*.12;yy=sign*(.62+(x-48)*.06);zz=deckz(x)+.16
  tube_path('anchor.chain',[(x+.065*math.cos(j*math.tau/10),yy+.038*math.sin(j*math.tau/10),zz) for j in range(10)],.019,materials['edge'],sides=5,closed=True)
for x in [-50,48]:
 z=deckz(x);cyl('mooring.capstan',(x,0,z+.28),.42,.55,materials['naval'],vertices=28);cyl('mooring.capstan-lid',(x,0,z+.60),.47,.12,materials['edge'],vertices=28)
for x in [-48,-40,36,51]:
 z=deckz(x);box('deck.hatch',(x,0,z+.14),(1.1,.8,.22),materials['naval'])
 for y in [-.28,.28]:rod('deck.hatch-grab',(x-.18,y,z+.3),(x+.18,y,z+.3),.023,materials['edge'])
for x in [-23,-6,11,36]:
 for sign in [-1,1]:
  y=sign*(1.7 if x in [-6,11] else 2.4);z=deckz(x)
  cyl('ventilator.stalk',(x,y,z+.5),.19,1.0,materials['naval'],vertices=20)
  tube_path('ventilator.cowl',[(x,y,z+.8),(x-.1,y,z+1.13),(x-.4,y,z+1.13)],.23,materials['naval'],sides=16)
  rod('ventilator.mouth',(x-.4,y,z+1.13),(x-.42,y,z+1.13),.19,materials['dark'],vertices=20)
# Searchlight on the aft uptake platform, with yoke and pedestal.
cyl('searchlight.column',(-5.4,0,6.45),.34,1.75,materials['naval'],vertices=24)
rod('searchlight.cross-bearing',(-5.4,-.52,7.25),(-5.4,.52,7.25),.085,materials['edge'])
for sign in [-1,1]:rod('searchlight.yoke',(-5.4,sign*.52,6.8),(-5.4,sign*.52,7.8),.07,materials['edge'])
rod('searchlight.drum',(-5.8,0,7.9),(-4.9,0,7.9),.52,materials['naval'],vertices=32)
rod('searchlight.lens',(-4.89,0,7.9),(-4.87,0,7.9),.46,materials['glass'],vertices=32)
# Baked original hull paint, with light seams and waterline weathering.
wtex,htex=1024,256;pixels=array('f')
for j in range(htex):
 z=-4+j/(htex-1)*11
 for i in range(wtex):
  x=-half+i/(wtex-1)*h['length'];grain=(math.sin(i*12.99+j*78.233)*43758.5453)%1
  base=(.12,.105,.065) if z<-.15 else (.20,.23,.25)
  tide=.025*math.exp(-abs(z+.1)*4);streak=max(0,math.sin(x*3.9))**20*.03
  seam=.97 if i%27==0 or j%18==0 else 1
  pixels.extend([max(.005,c*seam+tide+(grain-.5)*.013-streak) for c in base]+[1])
paint=bpy.data.images.new('Yukikaze original hull paint',width=wtex,height=htex,alpha=False);paint.colorspace_settings.name='Non-Color';paint.pixels.foreach_set(pixels);paint.pack()
mat=materials['hullgray'];node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=paint;node.extension='EXTEND';mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
bpy.context.view_layer.update()
for o in col.objects:
 if o.type!='MESH':continue
 if materials['hullgray'] in list(o.data.materials):
  uv=o.data.uv_layers.new(name='OriginalPaintUV')
  for p in o.data.polygons:
   for li in p.loop_indices:
    v=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=((v.x+half)/h['length'],(v.z+4)/11)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
scene['definitionHash']=definition['contentHash'];scene['authoringRevision']=1
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
print('YUKIKAZE ORIGINAL',len(col.objects),'objects',flush=True)

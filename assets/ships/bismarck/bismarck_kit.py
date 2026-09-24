"""Shared vocabulary of the Bismarck recipe: scene setup, collections, materials, primitive builders,
hull queries and fittings more than one region uses (directors, searchlights, pole masts).

Blender frame: +X bow, +Y port, +Z up, standard waterline Z=0. Runtime (x, y, z) is Blender (-z, -x, y).
Regions import everything with `from bismarck_kit import *` and add objects to these collections.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
from contextlib import contextmanager
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount as create_library_mount
from blender_supports import SupportSurface
from blender_rig import radar_pivot
OUT=Path(os.environ['SHIP_OUTPUT']);DEF=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text());H=DEF['hull']
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene['definitionHash']=DEF['contentHash'];scene['authoring']='Original construction primitives; GameModels3D pgsb708 A fit visual refinement'
def group(name):
 c=bpy.data.collections.new(name);scene.collection.children.link(c);return c
hullcol=group('01 Hull and deck');supercol=group('02 Superstructure');gunscol=group('03 Articulated batteries');detailcol=group('04 Fittings');undercol=group('05 Underwater');simcol=group('14 Simulation volumes')
def material(name,color,metal=.12,rough=.62):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
materials={k:material(k,c) for k,c in {'naval':(.28,.325,.345),'roof':(.10,.135,.155),'edge':(.205,.25,.275),'hullgray':(.22,.28,.315),'canvas':(.48,.445,.355),'dark':(.018,.027,.034),'deck':(.49,.36,.205),'oxide':(.245,.052,.031),'boot':(.025,.035,.043),'glass':(.025,.067,.091),'bronze':(.43,.26,.075),'light':(.51,.56,.57),'wood':(.27,.14,.055),'rope':(.32,.27,.18)}.items()}
def mesh(name,verts,faces,mat,col,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();ob=bpy.data.objects.new(name,data);col.objects.link(ob)
 if mat:data.materials.append(mat)
 for p in data.polygons:p.use_smooth=smooth
 return ob
def box(name,loc,size,mat,col):
 x,y,z=[v/2 for v in size];vs=[(a*x,b*y,c*z) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 ob=mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,col);ob.location=loc;return ob
def cyl(name,loc,radius,depth,mat,col,vertices=24):
 vs=[(radius*math.cos(math.tau*i/vertices),radius*math.sin(math.tau*i/vertices),z) for z in [-depth/2,depth/2] for i in range(vertices)]
 fs=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
 ob=mesh(name,vs,fs,mat,col,True);ob.data.polygons[0].use_smooth=False;ob.data.polygons[1].use_smooth=False;ob.location=loc;return ob
def rod(name,a,b,radius,mat,col,r2=None,vertices=10):
 delta=Vector(b)-Vector(a);length=delta.length
 if length<1e-6:return None
 r2=radius if r2 is None else r2
 vs=[(r*math.cos(math.tau*i/vertices),r*math.sin(math.tau*i/vertices),z) for z,r in [(-length/2,radius),(length/2,r2)] for i in range(vertices)]
 fs=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
 ob=mesh(name,vs,fs,mat,col,True);ob.data.polygons[0].use_smooth=False;ob.data.polygons[1].use_smooth=False;ob.location=(Vector(a)+Vector(b))/2;ob.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return ob
helpers={'mesh':mesh,'cyl':cyl,'box':box,'rod':rod}
def extrude(name,pts,z,h,mat,col,bevel=0):
 pts=list(pts)
 if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))<0:pts.reverse()
 n=len(pts);ob=mesh(name,[(x,y,zz) for zz in [z,z+h] for x,y in pts],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat,col)
 if bevel:
  mod=ob.modifiers.new('Small fabricated edge','BEVEL');mod.width=bevel;mod.segments=1;mod.affect='EDGES'
 return ob
def rounded_rect(cx,cy,length,width,r=.5,steps=4):
 return [(cx+sx*(length/2-r)+r*math.cos(a),cy+sy*(width/2-r)+r*math.sin(a)) for sx,sy,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)] for a in [math.radians(start+i*90/steps) for i in range(steps+1)]]
def ellipse(cx,cy,rx,ry,n=40):return [(cx+rx*math.cos(math.tau*i/n),cy+ry*math.sin(math.tau*i/n)) for i in range(n)]
def polyline(name,pts,r=.027,mat=None,col=None,closed=False,vertices=6):
 pts=[Vector(p) for p in pts]
 if len(pts)<2:return
 if (pts[-1]-pts[0]).length<1e-7:pts.pop();closed=True
 vs=[];n=vertices
 for i,p in enumerate(pts):
  prev=pts[(i-1)%len(pts)] if closed or i else p
  nxt=pts[(i+1)%len(pts)] if closed or i<len(pts)-1 else p
  tangent=(nxt-prev).normalized();u=tangent.cross(Vector((0,0,1)))
  if u.length<.01:u=tangent.cross(Vector((0,1,0)))
  u.normalize();v=tangent.cross(u)
  vs.extend(p+r*(u*math.cos(math.tau*j/n)+v*math.sin(math.tau*j/n)) for j in range(n))
 fs=[]
 for i in range(len(pts) if closed else len(pts)-1):
  a=i*n;b=((i+1)%len(pts))*n
  fs.extend((a+j,a+(j+1)%n,b+(j+1)%n,b+j) for j in range(n))
 if not closed:fs.extend([tuple(reversed(range(n))),tuple((len(pts)-1)*n+j for j in range(n))])
 return mesh(name,vs,fs,mat or materials['edge'],col or detailcol,True)
def rail(name,pts,height=.94,spacing=1.85,closed=True,col=None):
 col=col or detailcol;pts=[Vector(p) for p in pts];seq=list(zip(pts,pts[1:]+([pts[0]] if closed else [])))
 remaining=0.0
 for a,b in seq:
  delta=b-a;length=delta.length
  if length<1e-7:continue
  while remaining<length:
   p=a+delta*(remaining/length);rod(name+' stanchion',p,p+Vector((0,0,height)),.026,materials['edge'],col,vertices=5);remaining+=spacing
  remaining-=length
 for dz in [height*.38,height*.7,height]:polyline(name+' wire',[p+Vector((0,0,dz)) for p in pts],.014,materials['edge'],col,closed,5)
def ring(name,center,normal,radius,tube=.035,mat=None,n=20):
 axis=Vector(normal).normalized();u=axis.cross(Vector((0,0,1)))
 if u.length<.1:u=axis.cross(Vector((0,1,0)))
 u.normalize();v=axis.cross(u);c=Vector(center)
 pts=[c+radius*(u*math.cos(math.tau*i/n)+v*math.sin(math.tau*i/n)) for i in range(n)]
 polyline(name,pts,tube,mat or materials['edge'],closed=True,vertices=5)
def porthole(name,center,normal,r=.17):
 c=Vector(center);n=Vector(normal).normalized()
 rod(name+' mounting sleeve',c-n*.10,c+n*.016,r+.015,materials['naval'],detailcol,vertices=14)
 rod(name+' dark glazing',c,c+n*.022,r,materials['dark'],detailcol,vertices=14)
 ring(name+' rim',c+n*.026,n,r+.02,.023,n=14)
 # A short eyebrow casts a legible shadow without a textured decal.
 u=n.cross(Vector((0,0,1))).normalized();pts=[c+n*.03+u*(r*1.12*math.cos(a))+Vector((0,0,r*1.12*math.sin(a))) for a in [math.pi*.15+i*math.pi*.7/6 for i in range(7)]]
 polyline(name+' eyebrow',pts,.03,materials['naval'])
def ladder(name,start,end,width=.58):
 a,b=Vector(start),Vector(end);delta=b-a;side=Vector((0,width/2,0))
 if abs(delta.y)>abs(delta.x):side=Vector((width/2,0,0))
 for s in [-1,1]:rod(name+' rail',a+s*side,b+s*side,.035,materials['light'],detailcol,vertices=6)
 for i in range(math.ceil(delta.length/.28)+1):
  p=a+delta*(i/max(1,math.ceil(delta.length/.28)));rod(name+' rung',p-side,p+side,.023,materials['edge'],detailcol,vertices=6)
def stairs(name,start,end,width=.9):
 a,b=Vector(start),Vector(end);n=max(2,math.ceil(abs(b.z-a.z)/.25));flat=Vector((b.x-a.x,b.y-a.y,0));side=Vector((-flat.y,flat.x,0)).normalized()*width/2
 for i in range(n+1):
  p=a+(b-a)*(i/n);tread=box(name+' tread',p,(max(.25,flat.length/n),width,.07),materials['edge'],detailcol);tread.rotation_euler.z=math.atan2(flat.y,flat.x)
 for sign in [-1,1]:
  rod(name+' stringer',a+side*sign,b+side*sign,.075,materials['naval'],detailcol,vertices=6)
  for i in range(0,n+1,3):
   p=a+(b-a)*(i/n)+side*sign;rod(name+' handrail post',p,p+Vector((0,0,.85)),.026,materials['edge'],detailcol,vertices=5)
  rod(name+' handrail',a+side*sign+Vector((0,0,.85)),b+side*sign+Vector((0,0,.85)),.026,materials['edge'],detailcol,vertices=6)
def vent(name,loc,size,side=1):
 x,y,z=loc;sx,sy,sz=size;box(name+' trunk',loc,size,materials['naval'],detailcol);box(name+' recess',(x,y+side*(sy/2+.012),z),(sx*.86,.025,sz*.8),materials['dark'],detailcol)
 for i in range(max(3,round(sz/.13))):box(name+' louvre',(x,y+side*(sy/2+.035),z-sz*.36+i*sz*.72/max(2,round(sz/.13)-1)),(sx*.9,.09,.045),materials['edge'],detailcol)
def hatch(name,x,y,z,sx=1.0,sy=.72):
 extrude(name+' coaming',rounded_rect(x,y,sx,sy,.12,2),z,.14,materials['edge'],detailcol)
 box(name+' cover',(x,y,z+.17),(sx*.86,sy*.82,.07),materials['naval'],detailcol)
 for a in [-.31,.31]:box(name+' hinge',(x+a*sx,y-sy*.4,z+.23),(.13,.12,.07),materials['edge'],detailcol)
 rod(name+' handle',(x-.14,y,z+.25),(x+.14,y,z+.25),.024,materials['dark'],detailcol,vertices=6)
def door(name,x,y,z,sign=1,width=.76,height=1.72):
 box(name+' frame',(x,y,z+height/2),(width+.1,.14,height+.1),materials['edge'],detailcol)
 box(name+' panel',(x,y+sign*.032,z+height/2),(width,.06,height),materials['naval'],detailcol)
 for dz in [.34,height-.34]:box(name+' hinge',(x-width*.46,y+sign*.095,z+dz),(.13,.08,.13),materials['edge'],detailcol)
 ring(name+' wheel',(x+width*.17,y+sign*.1,z+height*.53),(0,sign,0),.11,.015,n=12)
def interp(table,s):
 for (a,x),(b,y) in zip(table,table[1:]):
  if a<=s<=b:return x+(y-x)*(s-a)/(b-a)
 return table[-1][1]
def deckz(x):return interp(H['deckHeights'],x+H['length']/2)
def width(x):return interp(H['halfBreadths'],x+H['length']/2)
def section_at(x):
 s=x+H['length']/2
 for a,b in zip(H['sections'],H['sections'][1:]):
  if a['station']<=s<=b['station']:
   t=(s-a['station'])/(b['station']-a['station']);return [(w+(q[0]-w)*t,z+(q[1]-z)*t) for (w,z),q in zip(a['points'],b['points'])]
 return H['sections'][-1]['points']
def side_width(x,z):
 p=section_at(x);hits=[]
 for (wa,za),(wb,zb) in zip(p,p[1:]):
  if za-1e-6<=z<=zb+1e-6:hits.append(max(wa,wb) if abs(zb-za)<1e-6 else wa+(wb-wa)*(z-za)/(zb-za))
 return max(hits) if hits else width(x)
def house_side(pts,x,sign):
 hits=[]
 for a,b in zip(pts,pts[1:]+pts[:1]):
  if min(a[0],b[0])-1e-6<=x<=max(a[0],b[0])+1e-6 and abs(b[0]-a[0])>1e-6:
   y=a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);normal=Vector((a[1]-b[1],b[0]-a[0],0)).normalized()
   if normal.y*sign<0:normal=-normal
   hits.append((y,normal))
 return (max(hits,key=lambda h:h[0]) if sign>0 else min(hits,key=lambda h:h[0])) if hits else (0,Vector((0,sign,0)))
structures={s['id']:s for s in DEF['structures']}
@contextmanager
def legacy_frame():
 # The bridge, stair and funnel detail pass was authored 2 m forward of the blueprint frame
 # (footprints read as -z+2) and is shifted back as one set. New work uses the true frame.
 before=set(bpy.data.objects)
 yield
 for ob in set(bpy.data.objects)-before:ob.location.x-=2.0
# Blueprint buildings, thin deck edges, supported galleries and side-wall fittings.
def draw_structure(s):
 pts=[(-z,-x) for x,z in s['footprint']];z=s['baseY'];top=z+s['height'];roof=s['material']=='roof'
 if s.get('surface'):
  shape=s['surface'];vs=[(-zz,-xx,yy) for xx,yy,zz in shape['vertices']]
  ob=mesh(s['name'],vs,shape['triangles'],materials[s['material']],supercol,s['id']=='funnel-jacket')
 else:ob=extrude(s['name'],pts,z,s['height'],materials[s['material']],supercol,.025 if roof else .035)
 ob['assemblyId']='superstructure-'+s['id']
 if s['id']=='navigation-roof':ob.data.materials.clear();ob.data.materials.append(materials['naval'])
 if s['id']=='funnel-jacket':return
 if roof:
  shields={'bridge-wings':1.35,'fore-aa-platform':.98,'foretop-platform':1.30,'aft-director-platform':.74,'tower-lower-gallery':.60}
  if s['id'] in ['navigation-roof','foretop-roof','bridge-admiral-platform','conning-platform']:return
  if s['id']=='signal-platform':
   # Leave optical ports in the guardrail for the transverse nightfinders.
   chain=[]
   for a,b in zip(pts,pts[1:]+pts[:1]):
    ts=[0,1]+[(cut-a[0])/(b[0]-a[0]) for cut in [14.05,16.15] if abs(b[0]-a[0])>1e-7 and min(a[0],b[0])<cut<max(a[0],b[0])]
    ts=sorted(ts)
    for lo,hi in zip(ts,ts[1:]):
     pa=tuple(a[k]+(b[k]-a[k])*lo for k in [0,1]);pb=tuple(a[k]+(b[k]-a[k])*hi for k in [0,1])
     gap=14.05<(pa[0]+pb[0])/2<16.15 and abs((pa[1]+pb[1])/2)>5.5
     if gap:
      if len(chain)>1:rail(s['id'],[(x,y,top+.005) for x,y in chain],.85,1.55,False,col=supercol)
      chain=[]
     else:
      if not chain:chain=[pa]
      chain.append(pb)
   if len(chain)>1:rail(s['id'],[(x,y,top+.005) for x,y in chain],.85,1.55,False,col=supercol)
  elif s['id'] not in shields:rail(s['id'],[(x,y,top+.005) for x,y in pts],.85,1.55,col=supercol)
  if s['id'] in shields:
   # Sheet bulwarks and their inclined wind lip break up the repeated open
   # handrails. Leave the after edge open for passage and mast access.
   aft=min(x for x,y in pts)
   for a,b in zip(pts,pts[1:]+pts[:1]):
    if (a[0]+b[0])/2<aft+.9:
     rail(s['id']+' after guard',[(x,y,top+.025) for x,y in [a,b]],.9,1.55,False,col=supercol)
     continue
    normal=Vector((a[1]-b[1],b[0]-a[0],0)).normalized();mid=Vector(((a[0]+b[0])/2,(a[1]+b[1])/2,0))
    if normal.dot(mid-Vector(((aft+max(x for x,y in pts))/2,0,0)))<0:normal=-normal
    shield=shields[s['id']];vs=[(x,y,zz) for zz in [top+.04,top+shield] for x,y in [a,b]]
    ob=mesh('Gallery splinter bulwark',vs,[(0,1,3,2)],materials['naval'],supercol)
    mod=ob.modifiers.new('Fabricated plate thickness','SOLIDIFY');mod.thickness=.045
    lip=[Vector((x,y,top+shield)) for x,y in [a,b]];mesh('Gallery wind deflector',[tuple(v) for v in lip]+[tuple(v+normal*.17+Vector((0,0,.13))) for v in lip],[(0,1,3,2)],materials['edge'],supercol)
    count=math.ceil((Vector(b)-Vector(a)).length/1.4) if (Vector(b)-Vector(a)).length>.65 else 0
    for i in range(count):
     p=Vector(a)+(Vector(b)-Vector(a))*((i+.5)/count);rod('Bulwark stiffener',(p.x,p.y,top+.08),(p.x,p.y,top+shield-.04),.025,materials['edge'],supercol,vertices=5)
  # Gallery brackets connect the outer lip to the enclosed central support.
  for x,y in pts:
   if abs(y)>4.3:
    # Forward lobes overhang the tower's front as well as its sides. Keep the
    # inner end inside the tapered core instead of leaving a hanging strut.
    tower=s['id'] in ['signal-platform','fore-aa-platform','foretop-platform','foretop-roof']
    inner=(max(12.8,min(14.8,x)),math.copysign(1.65,y),z-1.6) if tower else (x,y*.56,z-1.2)
    rod(s['id']+' knee',(x,y,z-.02),inner,.07,materials['naval'],supercol,vertices=6)
 else:
  # Steel deck overhang and drainage lip emphasize real deck boundaries.
  if s.get('surface'):
   # Follow the authored upper ring on sloped enclosures; a horizontal lip floats above their nose.
   ringpts=[(-zz,-xx,yy) for xx,yy,zz in s['surface']['vertices'][-len(pts):]]
   polyline(s['id']+' deck edge',ringpts,.035,materials['roof'],supercol,True,6)
  elif s['id']!='tower-mast-base':
   extrude(s['id']+' deck lip',pts,top,.06,materials['roof'],supercol)
  for sign in [-1,1]:
   yy=sign*max(abs(y) for x,y in pts);lo=min(x for x,y in pts)+2.6;hi=max(x for x,y in pts)-2.6
   if hi>lo and s['height']>2.0 and s['id'] not in ['funnel-base','tower-mast-base','bridge-wheelhouse','foretop-control','conning-tower','tower-upper-shaft']:
    for x in [lo+i*2.2 for i in range(max(1,int((hi-lo)/2.2)))]:
     yy,normal=house_side(pts,x,sign);porthole(s['id']+' scuttle',Vector((x,yy,top-1.12))+normal*.05,normal,.16)
    xx=(lo+hi)/2;yy,normal=house_side(pts,xx,sign)
    if abs(normal.x)<.15:door(s['id']+' watertight door',xx,yy+sign*.05,z+.13,sign)
def stair_landing(name,x,y,z,inner,width=1.15):
 box(name+' landing',(x,(y+inner)/2,z-.09),(width,abs(y-inner)+.45,.18),materials['roof'],supercol)
 for dx in [-width*.36,width*.36]:rod(name+' landing knee',(x+dx,y,z-.18),(x+dx,inner,z-.95),.07,materials['naval'],supercol,vertices=6)
# The conning enclosure and crown now come from the blueprint, with the same
# structural surfaces used for CPU hits. Its director remains on the original axis.
def director(name,x,z,span,base):
 # Original interpretation of pgsb708 A_Finders: a tall rounded rectangular
 # housing, tapered optical arms and external service platforms. The A fit
 # has no mattress aerial; retain the existing articulated sensor IDs.
 cyl(name+' foundation',(x,0,base+.10),1.60,.20,materials['edge'],detailcol,40)
 before=set(bpy.context.scene.objects)
 bottom=base+.16;top=z+1.13
 pts=rounded_rect(x,0,3.25,3.5,.70,5)
 extrude(name+' armored hood',pts,bottom,top-bottom,materials['naval'],detailcol,.035)
 extrude(name+' crown edge',rounded_rect(x,0,3.38,3.62,.73,5),top,.12,materials['edge'],detailcol)
 # Very shallow hipped crown instead of a thick floating lid.
 crown=rounded_rect(x,0,3.30,3.54,.71,5);n=len(crown)
 mesh(name+' hipped crown',[(a,b,top+.12) for a,b in crown]+[(x,0,top+.27)],[(i,(i+1)%n,n) for i in range(n)],materials['naval'],detailcol)
 polyline(name+' horizontal plating joint',[(a,b,bottom+.62) for a,b in pts],.016,materials['edge'],closed=True)
 for sign in [-1,1]:
  # Cast arm transition, taper, optic casing and bolted sleeves are distinct.
  extrude(name+' tube junction',[(x-.59,sign*1.34),(x+.60,sign*1.34),(x+.43,sign*2.12),(x-.41,sign*2.12)],z-.38,.78,materials['naval'],detailcol)
  rod(name+' tapered optical tube',(x,sign*1.72,z),(x,sign*(span/2-.33),z),.245,materials['naval'],detailcol,.18,24)
  for yy in [2.05,span/2-.70]:
   rod(name+' optical tube collar',(x,sign*(yy-.08),z),(x,sign*(yy+.08),z),.27,materials['edge'],detailcol,vertices=24)
  yy=sign*(span/2-.25)
  extrude(name+' optical end housing',rounded_rect(x,yy,.74,.69,.16,3),z-.29,.58,materials['naval'],detailcol,.025)
  rod(name+' forward lens sleeve',(x+.28,yy,z),(x+.45,yy,z),.145,materials['edge'],detailcol,vertices=20)
  rod(name+' forward optic',(x+.449,yy,z),(x+.46,yy,z),.111,materials['glass'],detailcol,vertices=20)
  # Narrow maintenance step, triangulated arms and a rail behind each optic.
  a,b=sign*1.65,sign*(span/2+.06)
  box(name+' optical service step',(x-.38,(a+b)/2,z-.57),(.62,abs(b-a),.08),materials['edge'],detailcol)
  for yy in [sign*2.0,sign*(span/2-.32)]:
   rod(name+' service step brace',(x-.45,sign*1.42,z-.97),(x-.45,yy,z-.58),.033,materials['edge'],detailcol,vertices=6)
   rod(name+' optical service stanchion',(x-.70,yy,z-.55),(x-.70,yy,z+.40),.021,materials['edge'],detailcol,vertices=5)
  rod(name+' optical service handrail',(x-.70,a,z+.4),(x-.70,b,z+.4),.021,materials['edge'],detailcol,vertices=5)
  # Handholds physically terminate on the hood's after corner.
  for dz in [bottom+.30+i*.27 for i in range(max(1,int((top-bottom-.3)/.27)))]:
   polyline(name+' casing ladder rung',[(x-1.48,sign*1.42,dz),(x-1.63,sign*1.52,dz),(x-1.63,sign*1.17,dz),(x-1.48,sign*1.13,dz)],.020,materials['light'])
 if name=='Aft main director':
  rod(name+' after director mast',(x,0,top+.17),(x,0,top+4.8),.11,materials['edge'],detailcol,.045,16)
  rod(name+' after director yard',(x,-1.9,top+3.75),(x,1.9,top+3.75),.040,materials['edge'],detailcol,vertices=8)
  for yy in [-1.9,1.9]:rod(name+' after director yard stay',(x,yy,top+3.75),(x,0,top+4.55),.012,materials['edge'],detailcol,vertices=5)
 elif name!='Conning director':
  rod(name+' roof aerial',(x,0,top+.18),(x,0,top+1.35),.022,materials['edge'],detailcol,vertices=6)
  for yy in [-.6,.6]:rod(name+' aerial stay',(x,yy,top+.15),(x,0,top+.83),.012,materials['edge'],detailcol,vertices=5)
 else:cyl(name+' roof vent',(x,0,top+.26),.12,.30,materials['naval'],detailcol,12)
 radar_pivot({'Fore main director':'fumo-fore.yaw','Conning director':'fumo-conning.yaw','Aft main director':'fumo-aft.yaw'}[name],(x,0,base+.16),set(bpy.context.scene.objects)-before)
# Searchlights are open mechanical drums, not the forward AA weather domes.
def searchlight(name,x,y,z,bearing,radius=.75):
 axis=Vector((math.cos(bearing),math.sin(bearing),.08)).normalized()
 side=Vector((-math.sin(bearing),math.cos(bearing),0));up=axis.cross(side)
 def p(a,b,h):return Vector((x,y,z))+axis*a+side*b+up*h
 cyl(name+' deck sole',(x,y,z+.03),.55,.26,materials['edge'],detailcol,28)
 cyl(name+' swivel pedestal',(x,y,z+.29),.32,.40,materials['naval'],detailcol,24)
 cyl(name+' training ring',(x,y,z+.50),.53,.13,materials['edge'],detailcol,28)
 center=Vector((x,y,z+1.45));width=radius+.13
 # Flat fork cheeks and a continuous crosshead, seated on the training ring.
 rod(name+' yoke crosshead',(x-side.x*width,y-side.y*width,z+.58),(x+side.x*width,y+side.y*width,z+.58),.12,materials['naval'],detailcol,vertices=12)
 for sign in [-1,1]:
  coords=[(-.22,.57),(.25,.57),(.36,1.36),(.18,1.62),(-.18,1.62),(-.32,1.28)]
  vs=[tuple(Vector((x,y,z))+axis*a+side*(sign*width+t)+Vector((0,0,h))) for t in [-.055,.055] for a,h in coords];n=len(coords)
  mesh(name+' cast yoke cheek',vs,[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['naval'],detailcol)
  rod(name+' trunnion',center+side*sign*(radius-.1),center+side*sign*(radius+.23),.15,materials['edge'],detailcol,vertices=20)
  ring(name+' elevating handwheel',center+side*sign*(radius+.25)-axis*.07,(side*sign),.22,.025,materials['edge'],18)
  for a in range(3):
   hub=center+side*sign*(radius+.25)-axis*.07
   rod(name+' handwheel spoke',hub,hub+(axis*math.cos(a*math.tau/3)+up*math.sin(a*math.tau/3))*.22,.016,materials['edge'],detailcol,vertices=5)
 # Stepped rear cover, circumferential bands and a recessed shuttered face.
 rod(name+' drum body',center-axis*.48,center+axis*.43,radius,materials['naval'],detailcol,vertices=40)
 rod(name+' rear cap',center-axis*.57,center-axis*.47,radius*.84,materials['naval'],detailcol,radius,40)
 rod(name+' rear access cover',center-axis*.61,center-axis*.565,radius*.44,materials['edge'],detailcol,vertices=28)
 for a in [-.35,.30]:ring(name+' drum reinforcing band',center+axis*a,axis,radius+.028,.042,materials['edge'],36)
 rod(name+' recessed lens',center+axis*.437,center+axis*.445,radius*.91,materials['glass'],detailcol,vertices=40)
 ring(name+' lens flange',center+axis*.46,axis,radius,.057,materials['light'],36)
 for h in [-.48,0,.48]:
  half=math.sqrt(radius**2-h**2)*.91
  rod(name+' shutter rail',center+axis*.485+up*h-side*half,center+axis*.485+up*h+side*half,.024,materials['naval'],detailcol,vertices=6)
 for i in range(8):
  d=side*math.cos(i*math.tau/8)+up*math.sin(i*math.tau/8)
  rod(name+' rim clamp',center+d*(radius+.035)+axis*.35,center+d*(radius+.035)+axis*.49,.045,materials['edge'],detailcol,vertices=8)
 rod(name+' top ventilation neck',center+up*radius*.9,center+up*(radius+.10),.15,materials['naval'],detailcol,vertices=16)
 rod(name+' top ventilation cap',center+up*(radius+.10),center+up*(radius+.14),.21,materials['edge'],detailcol,vertices=20)
 box(name+' power housing',(x,y,z+.61),(.44,.48,.27),materials['naval'],detailcol)

def searchlight_cup(name,x,y,z,deep=True):
 # Open shell with a tapered underside rooted into the gallery, not a sphere.
 count=40
 rings=([(z-1.14,.56),(z-.86,1.10),(z-.37,1.43),(z+.68,1.60),(z+.68,1.51),(z+.05,1.46)] if deep else [(z-.12,1.48),(z+.04,1.48)])
 vs=[(x+r*math.cos(i*math.tau/count),y+r*math.sin(i*math.tau/count),zz) for zz,r in rings for i in range(count)]
 fs=[(j*count+i,j*count+(i+1)%count,(j+1)*count+(i+1)%count,(j+1)*count+i) for j in range(len(rings)-1) for i in range(count)]
 fs+=[tuple(reversed(range(count)))];mesh(name+' open cup shield',vs,fs,materials['naval'],detailcol,True)
 cyl(name+' cup floor',(x,y,z),1.48,.14,materials['roof'],detailcol,40)
 if deep:ring(name+' cup rolled edge',(x,y,z+.68),(0,0,1),1.555,.035,materials['edge'],40)
 else:rail(name+' platform rail',[(x+1.48*math.cos(a),y+1.48*math.sin(a),z+.04) for a in [i*math.tau/32 for i in range(32)]],.82,1.25)
 # Inboard passage and attachment saddle reach the gallery's flat deck.
 sign=1 if y>0 else -1
 box(name+' gallery saddle',(x,y-sign*.98,z-.09),(1.65,1.2,.18),materials['roof'],detailcol)
# Fore pole mast and aft mainmast, with yards, ladders, navigation platforms,
# signal halyards and properly grounded stays. All lines are original geometry.
def pole_mast(name,x,base,top):
 tip=Vector((x-.5,0,top));rod(name+' tapered pole',(x,0,base),tip,.31,materials['edge'],detailcol,.065,20)
 for sign in [-1,1]:rod(name+' lower support',(x+1.1,sign*2.0,base),(x-.18,0,base+10),.12,materials['naval'],detailcol,vertices=10)
 for zz,span in [(top-20,8.0),(top-12.5,11.5),(top-5.5,14.4),(top-1.5,6.4)]:
  if zz<base+2:continue
  xx=x-.5*(zz-base)/(top-base)
  rod(name+' yard',(xx,-span/2,zz),(xx,span/2,zz),.09,materials['edge'],detailcol,.045,10)
  for sign in [-1,1]:
   rod(name+' yard stay',(xx,sign*span/2,zz),tip-Vector((0,0,1.0)),.014,materials['dark'],detailcol,vertices=5)
   for k in [.25,.5,.82]:rod(name+' signal halyard',(xx,sign*span*k/2,zz),(x+1,sign*2.2,base+1.0),.012,materials['rope'],detailcol,vertices=4)
 for sign in [-1,1]:
  foot=(x-11,sign*5.5,deckz(x-11)+.1);rod(name+' standing stay',tip,foot,.021,materials['dark'],detailcol,vertices=5)
 ladder(name+' pole ladder',(x+.33,0,base+.4),(x-.15,0,top-2.0),.4)
 for i in range(12):
  t=i/11;zz=base+.4+(top-base-2.4)*t;xx=x+.33-.48*t;polex=x-.5*(zz-base)/(top-base)
  for yy in [-.2,.2]:rod(name+' ladder mounting lug',(polex,0,zz),(xx,yy,zz),.035,materials['edge'],detailcol,vertices=6)
 if name=='mainmast':
  cyl('Mainmast lookout platform',(x-.1,0,30.1),1.5,.16,materials['roof'],detailcol,24)
  rail('Mainmast lookout',[(px,py,30.18) for px,py in ellipse(x-.1,0,1.5,1.5,16)],.8,1.3)
  box('Mainmast enclosed lookout',(x-.1,0,28.9),(1.8,1.6,2.2),materials['naval'],detailcol)
  for sign in [-1,1]:box('Lookout window',(x-.1,sign*.81,29.5),(.95,.025,.55),materials['glass'],detailcol)
def consolidate_finish_uvs(scene):
    """Share one UV channel between disjoint Baltic and plain-painted faces.

    Preserve every original atlas coordinate. The shared finish only owns the
    faces whose materials explicitly sample SurfaceUV; these can occupy UVMap
    too without adding another full vertex attribute to this large model.
    """
    finish_materials = {
        material for material in bpy.data.materials
        if material.use_nodes and any(node.type == 'UVMAP' and node.uv_map == 'SurfaceUV'
                                      for node in material.node_tree.nodes)
    }
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        source = obj.data.uv_layers.get('SurfaceUV')
        if source is None:
            continue
        target = obj.data.uv_layers.get('UVMap')
        if target is None:
            source.name = 'UVMap'
            continue
        for face in obj.data.polygons:
            if obj.data.materials[face.material_index] in finish_materials:
                for index in face.loop_indices:
                    target.data[index].uv = source.data[index].uv
        obj.data.uv_layers.remove(source)
    for material in finish_materials:
        for node in material.node_tree.nodes:
            if node.type == 'UVMAP' and node.uv_map == 'SurfaceUV':
                node.uv_map = 'UVMap'

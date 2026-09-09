"""Original Bismarck exterior, 24 May 1941 at the separately stated standard draft.

The current refinement follows the approved GameModels3D pgsb708 A fit.
Reference geometry is inspection-only; all shapes below are original constructions. Blueprint polygons own major placements; this original recipe
owns construction/detail primitives. No source mesh or extracted transforms enter.
The separate original paint recipe applies the requested March–May Baltic scheme.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
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
# Original procedural teak. The common exporter bakes it to a repeating supported
# image. It replaces thousands of rod seams and has no external texture input.
teak=materials['deck'];teak.name='Teak decking · original 1941-02'
nodes=teak.node_tree.nodes;links=teak.node_tree.links;brick=nodes.new('ShaderNodeTexBrick');coord=nodes.new('ShaderNodeNewGeometry')
brick.inputs['Color1'].default_value=(.37,.255,.13,1);brick.inputs['Color2'].default_value=(.56,.43,.265,1);brick.inputs['Mortar'].default_value=(.13,.10,.062,1)
brick.inputs['Scale'].default_value=1;brick.inputs['Mortar Size'].default_value=.004;brick.inputs['Brick Width'].default_value=3.4;brick.inputs['Row Height'].default_value=.16
brick.offset=.5;brick.offset_frequency=2;links.new(coord.outputs['Position'],brick.inputs['Vector']);links.new(brick.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
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
# Closed original hull with a separate material boundary on the weather deck.
sections=H['sections'];vs=[];fs=[];n=2*len(sections[0]['points'])-1
for section in sections:
 s=section['station'];pts=section['points'];outline=pts+[[-w,z] for w,z in reversed(pts[1:])];vs.extend((s-H['length']/2,w,z) for w,z in outline)
for i in range(len(sections)-1):
 for j in range(n):fs.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
ob=mesh('Independently lofted hull',vs,fs,None,hullcol,True);ob['nodeId']='hull.surface';ob['assemblyId']='hull'
for k in ['hullgray','oxide','boot','deck']:ob.data.materials.append(materials[k])
for i,p in enumerate(ob.data.polygons):
 p.material_index=3 if i%n==len(sections[0]['points'])-1 else 1 if p.center.z<-1.3 else 2 if p.center.z<.1 else 0
 if p.material_index==3:p.use_smooth=False
bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();ob.data.update()
# Blueprint buildings, thin deck edges, supported galleries and side-wall fittings.
structures={s['id']:s for s in DEF['structures']}
for s in DEF['structures']:
 pts=[(-z,-x) for x,z in s['footprint']];z=s['baseY'];top=z+s['height'];roof=s['material']=='roof'
 if s.get('surface'):
  shape=s['surface'];vs=[(-zz,-xx,yy) for xx,yy,zz in shape['vertices']]
  ob=mesh(s['name'],vs,shape['triangles'],materials[s['material']],supercol,s['id']=='funnel-jacket')
 else:ob=extrude(s['name'],pts,z,s['height'],materials[s['material']],supercol,.025 if roof else .035)
 ob['assemblyId']='superstructure-'+s['id']
 if s['id']=='funnel-jacket':continue
 if roof:
  shields={'bridge-wings':1.35,'fore-aa-platform':.98,'foretop-platform':1.30,'aft-director-platform':.74}
  if s['id'] in ['navigation-roof','foretop-roof','bridge-admiral-platform','conning-platform']:continue
  if s['id'] not in shields:rail(s['id'],[(x,y,top+.005) for x,y in pts],.85,1.55,col=supercol)
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
    inner=(max(12.0,min(14.8,x)),math.copysign(2.15,y),z-1.6) if tower else (x,y*.56,z-1.2)
    rod(s['id']+' knee',(x,y,z-.02),inner,.07,materials['naval'],supercol,vertices=6)
 else:
  # Steel deck overhang and drainage lip emphasize real deck boundaries.
  extrude(s['id']+' deck lip',[(x*1.001,y*1.012) for x,y in pts],top,.10,materials['roof'],supercol)
  for sign in [-1,1]:
   yy=sign*max(abs(y) for x,y in pts);lo=min(x for x,y in pts)+2.6;hi=max(x for x,y in pts)-2.6
   if hi>lo and s['height']>2.0 and s['id'] not in ['funnel-base','tower-mast-base','bridge-wheelhouse','foretop-control','conning-tower']:
    for x in [lo+i*2.2 for i in range(max(1,int((hi-lo)/2.2)))]:
     yy,normal=house_side(pts,x,sign);porthole(s['id']+' scuttle',Vector((x,yy,top-1.12))+normal*.05,normal,.16)
    xx=(lo+hi)/2;yy,normal=house_side(pts,xx,sign)
    if abs(normal.x)<.15:door(s['id']+' watertight door',xx,yy+sign*.05,z+.13,sign)
# All ten active batteries retain the shared original joint and socket contract.
for mount in DEF['mounts']:
 if mount['partId']=='sk-c34-380-twin':create_library_mount(mount,gunscol,dict(helpers,deck_height=deckz),materials)
 elif mount['weapon']['caliberM']>.13:create_gun_mount(mount,gunscol,helpers,materials,deckz)
# Secondary gunhouse fabrication follows its existing yaw rig.
for mount in DEF['mounts']:
 if mount['weapon']['caliberM']<=.13 or mount['partId']=='sk-c34-380-twin':continue
 yaw=bpy.data.objects[mount['id']+'.yaw'];w=mount['weapon'];L,W,T=w['gunhouseSize']
 def mounted(ob):ob.parent=yaw;ob.matrix_parent_inverse=Matrix.Identity(4);ob['assemblyId']=mount['id'];return ob
 # The secondary's rear roof ridge, sloping roof and near-vertical walls are
 # catalog facets. These small original fittings are carried by the same yaw.
 mounted(box('Secondary rear access hatch',(-3.92,0,1.12),(.07,.78,1.18),materials['edge'],gunscol))
 mounted(box('Secondary rear hatch inset',(-3.97,0,1.12),(.035,.63,1.02),materials['naval'],gunscol))
 for yy in [-1.25,-.73]:mounted(rod('Secondary rear ladder rail',(-3.94,yy,.3),(-3.86,yy,2.20),.025,materials['edge'],gunscol,vertices=6))
 for zz in [.42+i*.26 for i in range(7)]:mounted(rod('Secondary rear ladder rung',(-3.94+.08*(zz-.3)/1.9, -1.25,zz),(-3.94+.08*(zz-.3)/1.9,-.73,zz),.022,materials['edge'],gunscol,vertices=6))
 for sign in [-1,1]:
  mounted(box('Secondary covered sight',(-.25,sign*2.32,1.52),(.63,.12,.32),materials['naval'],gunscol))
  mounted(box('Secondary sight glass',(.075,sign*2.32,1.52),(.026,.085,.14),materials['dark'],gunscol))
  for xx in [-2.7,-.6,1.2]:
   yy=sign*(2.15+(xx+3.9)*.4/5.9)
   mounted(box('Secondary drain',(xx,yy,.39),(.22,.05,.065),materials['dark'],gunscol))
 for a,b in zip([(-3.82,0,2.20),(-1.2,0,2.62),(1.95,0,2.10)], [(-1.2,0,2.62),(1.95,0,2.10),(2.55,0,1.87)]):mounted(rod('Secondary roof seam',a,b,.018,materials['edge'],gunscol,vertices=5))
 mounted(cyl('Secondary observation periscope',(-1.18,0,2.76),.095,.34,materials['naval'],gunscol,16))
 mounted(box('Secondary periscope head',(-1.12,0,2.94),(.26,.23,.15),materials['edge'],gunscol))
 for side in ['left','right']:
  parent=bpy.data.objects[mount['id']+'.'+side+'.recoil']
  for old in list(parent.children):
   if 'canvas mantlet' in old.name:bpy.data.objects.remove(old,do_unlink=True)
  vs=[];n=24;rings=[(-.38,.35),(-.16,.39),(.12,.34),(.48,.29),(.85,.235),(1.10,.208)]
  for xx,rr in rings:
   for i in range(n):
    a=math.tau*i/n;wrinkle=1+.055*math.cos(a*7+xx*10);vs.append((xx,rr*math.cos(a)*wrinkle,rr*.94*math.sin(a)*wrinkle))
  boot=mesh('Secondary pleated blast bag',vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)],materials['canvas'],gunscol,True)
  boot.parent=parent;boot.matrix_parent_inverse=Matrix.Identity(4);boot['assemblyId']=mount['id']
# Glazing follows the actual faceted wall, including the rounded forward bridge
# corners. The navigation house is forward of the separate conning enclosure.
def wall_windows(sid,z,height,spacing=.95):
 s=structures[sid];pts=[(-zz+2,-xx) for xx,zz in s['footprint']];aft=min(x for x,y in pts)
 for a,b in zip(pts,pts[1:]+pts[:1]):
  if (a[0]+b[0])/2<aft+.2:continue
  a,b=Vector((*a,0)),Vector((*b,0));delta=b-a;count=max(1,round(delta.length/spacing));normal=Vector((delta.y,-delta.x,0)).normalized()
  if normal.dot((a+b)/2-Vector(((aft+max(x for x,y in pts))/2,0,0)))<0:normal=-normal
  for i in range(count):
   start=a+delta*((i+.10)/count)+normal*.047;end=a+delta*((i+.90)/count)+normal*.047
   corners=[p+Vector((0,0,zz)) for zz in [z,z+height] for p in [start,end]]
   mesh(sid+' framed glass',corners,[(0,1,3,2)],materials['glass'],detailcol)
   polyline(sid+' window frame',[corners[j] for j in [0,1,3,2]],.033,materials['edge'],closed=True,vertices=6)
bridge_detail_before=set(bpy.data.objects)
wall_windows('bridge-wheelhouse',13.62,.66,1.02)
wall_windows('conning-tower',17.30,.12,1.3)
# The upper control house has small apertures; the former full window ribbon
# exaggerated its width. All service fittings bear on their actual deck or wall.
for sign in [-1,1]:
 for xx in [14.2,15.5,16.8]:
  pts=[(-zz+2,-xx) for xx,zz in structures['foretop-control']['footprint']]
  yy,normal=house_side(pts,xx,sign);porthole('Upper control aperture',Vector((xx,yy,28.35))+normal*.03,normal,.12)

def stair_landing(name,x,y,z,inner,width=1.15):
 box(name+' landing',(x,(y+inner)/2,z-.09),(width,abs(y-inner)+.45,.18),materials['roof'],supercol)
 for dx in [-width*.36,width*.36]:rod(name+' landing knee',(x+dx,y,z-.18),(x+dx,inner,z-.95),.07,materials['naval'],supercol,vertices=6)

for sign in [-1,1]:
 # Bridge wing instruments and a low locker fitted on the signal deck.
 box('Signal bridge locker',(10.7,sign*4.85,21.02),(2.3,.46,.74),materials['naval'],detailcol)
 for xx in [10.0,10.7,11.4]:box('Signal locker panel',(xx,sign*5.10,21.02),(.57,.035,.56),materials['edge'],detailcol)
 for xx,yy,zz in [(33.1,5.9,15.4),(10.6,5.8,20.65),(10.9,3.6,27.3)]:
  cyl('Bridge pelorus stand',(xx,sign*yy,zz+.44),.13,.88,materials['naval'],detailcol,16)
  cyl('Bridge pelorus dial',(xx,sign*yy,zz+.91),.27,.10,materials['edge'],detailcol,20)
  rod('Bridge sighting arm',(xx-.23,sign*yy,zz+.99),(xx+.3,sign*yy,zz+.99),.03,materials['dark'],detailcol,vertices=6)
 for name,a,b,inner in [
  ('Platform access',(46.7,9.2,5.75),(43.8,9.2,8.4),8.1),
  ('Forward exterior stair',(42.8,8.05,8.4),(39.5,8.05,10.75),6.9),
  ('Bridge stair',(35.4,7.2,10.75),(32.1,7.2,13.0),6.0),
  ('Navigation bridge stair',(30.2,7.2,13.0),(27.4,7.2,15.5),6.2),
  ('Signal bridge access',(21.8,5.1,15.5),(17.9,5.1,20.75),4.2),
  ('Searchlight gallery stair',(12.4,5.1,20.75),(17.1,5.1,24.72),4.4),
  ('Aft platform access',(-50.4,9.1,5.8),(-47.2,9.1,8.4),8.0),
  ('Aft deck stair',(-46.5,8.4,8.4),(-43.5,8.4,10.75),7.8),
  ('Aft control stair',(-41.5,6.7,10.75),(-38.3,6.7,13.2),5.9)]:
  a=(a[0],a[1]*sign,a[2]);b=(b[0],b[1]*sign,b[2]);stairs(name,a,b,.7);stair_landing(name,*b,inner*sign)
 # Deck vents and tower conduits sit on the revised walls rather than old offsets.
 for sid,z,xs in [('forward-battery-deck',9.35,[13,18,37,41]),('forward-shelter-deck',11.55,[19,27,34])]:
  pts=[(-zz+2,-xx) for xx,zz in structures[sid]['footprint']]
  for xx in xs:
   yy,normal=house_side(pts,xx,sign)
   if abs(normal.x)<.3:vent(sid+' intake',(xx,yy+sign*.06,z),(1.2,.20,1.0),sign)
 for xx in [-47,-42,-34]:vent('Aft intake',(xx,sign*8.8,9.3),(1.15,.25,1.0),sign)
 ladder('Lower tower service ladder',(12.35,sign*2.6,12.98),(12.35,sign*2.6,20.45),.45)
 ladder('Upper tower service ladder',(14.0,sign*2.65,24.7),(14.0,sign*2.65,29.55),.45)
 for zz in [14.0,16.0,18.0,20.0]:
  rod('Tower ladder mounting foot',(12.6,sign*2.6,zz),(12.35,sign*2.6,zz),.035,materials['edge'],detailcol,vertices=6)
 for zz in [16.5,19.0]:
  box('Tower service cabinet',(15.5,sign*3.46,zz),(1.05,.3,.75),materials['edge'],detailcol)
 polyline('Tower cable conduit',[(18.3,sign*2.8,13),(18.3,sign*2.8,20.5),(18.8,sign*2.7,23.0)],.042,materials['edge'],vertices=8)
 # The angular bridge visor is attached to the forward upper wall.
 for xx,yy in [(36.0,4.5),(35.0,5.9)]:
  rod('Bridge visor bracket',(xx,sign*yy,15.27),(xx+.62,sign*yy,14.36),.075,materials['edge'],supercol,vertices=6)
pts=[(-zz+2,-xx) for xx,zz in structures['bridge-wheelhouse']['footprint']]
front=[(x,y) for x,y in pts if x>34.7]
for a,b in zip(front,front[1:]):
 if abs(a[1]-b[1])<.002:continue
 mesh('Navigation bridge sloping weather brow',[(a[0],a[1],15.16),(b[0],b[1],15.16),(b[0]+.78,b[1]*1.07,14.18),(a[0]+.78,a[1]*1.07,14.18)],[(0,1,2,3)],materials['naval'],supercol)
# Funnel: a flared uptake foot, nearly straight-sided oblong jacket, projecting
# collar and smaller raked cap. Profiles come from the authored blueprint rings.
fx=-.6;N=64
verts=[(-z+2,-x,y) for x,y,z in structures['funnel-jacket']['surface']['vertices']]
jacket_rings=[verts[i:i+N] for i in range(0,len(verts),N)]
outer=jacket_rings[-1];inner=[(fx+(x-fx)*.945,y*.9,z-.05) for x,y,z in outer]
mesh('Funnel cap thickness',outer+inner,[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['edge'],supercol)
mesh('Funnel cap inner wall',inner+[(x,y,z-1.3) for x,y,z in inner],[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['dark'],supercol)
mesh('Recessed uptake darkness',[(x,y,z-1.27) for x,y,z in inner],[tuple(reversed(range(N)))],materials['dark'],supercol)
polyline('Funnel cap rolled lip',outer,.045,materials['light'],supercol,True,8)
for xx in [-4.8,-3.3,-1.8,-.3,1.2,2.7,4.1]:
 hits=[]
 for a,b in zip(outer,outer[1:]+outer[:1]):
  if min(a[0],b[0])<=xx<=max(a[0],b[0]) and abs(a[0]-b[0])>.0001:hits.append(a[1]+(b[1]-a[1])*(xx-a[0])/(b[0]-a[0]))
 if len(hits)>=2:rod('Funnel transverse cap grating',(xx,min(hits),24.3+.16*(xx-fx)),(xx,max(hits),24.3+.16*(xx-fx)),.035,materials['edge'],supercol,vertices=6)
for yy in [-1.25,0,1.25]:
 hits=[]
 for a,b in zip(outer,outer[1:]+outer[:1]):
  if min(a[1],b[1])<=yy<=max(a[1],b[1]) and abs(a[1]-b[1])>.0001:hits.append(a[0]+(b[0]-a[0])*(yy-a[1])/(b[1]-a[1]))
 if len(hits)>=2:
  a,b=min(hits),max(hits);rod('Funnel longitudinal cap grating',(a,yy,24.3+.16*(a-fx)),(b,yy,24.3+.16*(b-fx)),.038,materials['edge'],supercol,vertices=6)
for zz in [13.7,16.2,19.1,21.3,22.65]:
 pts=[]
 for i in range(N):
  a,b=next((a[i],b[i]) for a,b in zip(jacket_rings,jacket_rings[1:]) if a[i][2]<=zz<=b[i][2])
  t=(zz-a[2])/(b[2]-a[2]);pts.append(tuple(a[k]+(b[k]-a[k])*t for k in range(3)))
 polyline('Funnel plating collar',pts,.032,materials['edge'],supercol,True)
# Standing cowl ventilators follow the horizontal collar, outside the smaller cap.
for i in range(0,N,2):
 x,y,z=jacket_rings[3][i]
 cyl('Funnel collar ventilator',(x,y,23.51),.105,.62,materials['naval'],supercol,10)
 cyl('Funnel ventilator crown',(x,y,23.83),.12,.035,materials['edge'],supercol,10)
for sign in [-1,1]:
 for zz,length,w,yy in [(14.55,11.6,1.0,3.6),(17.45,12.2,2.6,4.4)]:
  pts=rounded_rect(fx-.6,sign*yy,length,w,.45,5);extrude('Funnel gallery',pts,zz,.2,materials['roof'],supercol)
  rail('Funnel gallery',[(x,y,zz+.2) for x,y in pts],.87,1.35,col=supercol)
  for xx in [-5.2,-2.8,-.3,2.2]:rod('Funnel gallery knee',(xx,sign*(yy+w*.44),zz),(xx,sign*2.65,zz-1.15),.065,materials['naval'],supercol,vertices=6)
 for xx in [-5.7,-5.25]:
  polyline('Funnel steam pipe',[(xx,sign*2.55,12),(xx,sign*2.55,20.1),(xx+.18,sign*2.7,22.5)],.065,materials['light'],supercol,vertices=8)
 stairs('Funnel gallery access',(-5.5,sign*4.0,14.75),(-2.4,sign*4.0,17.65),.6)
 ladder('Funnel upper ladder',(-3.8,sign*3.02,17.7),(-3.8,sign*3.02,22.95),.45)
 for xx in [-4.5,.7]:vent('Funnel lower uptake grille',(xx,sign*3.77,10.3),(1.5,.15,1.3),sign)

for ob in set(bpy.data.objects)-bridge_detail_before:
 ob.location.x-=2.0
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
director('Fore main director',14.2,31.1,10.5,29.8)
director('Conning director',25.0,19.55,7.0,18.3)
director('Aft main director',-37.8,17.5,10.5,16.2)
# Compact open 3 m night rangefinders, independently modeled from the
# approved pgsb708 gf004 fitting; these are distinct from enclosed SL-8 domes.
def night_rangefinder(name,x,y,base,axisz):
 cyl(name+' deck sole',(x,y,base+.035),.79,.07,materials['edge'],detailcol,24)
 rod(name+' tapered pedestal',(x,y,base+.07),(x,y,base+.65),.25,materials['naval'],detailcol,.19,16)
 cyl(name+' pedestal shoulder',(x,y,base+.65),.34,.13,materials['edge'],detailcol,20)
 box(name+' saddle',(x,y,axisz-.29),(.53,1.02,.17),materials['naval'],detailcol)
 rod(name+' optical baseline',(x,y-1.47,axisz),(x,y+1.47,axisz),.165,materials['naval'],detailcol,vertices=20)
 rod(name+' central instrument',(x,y-.43,axisz),(x,y+.43,axisz),.295,materials['naval'],detailcol,vertices=16)
 for sign in [-1,1]:
  for yy,r in [(.45,.32),(.93,.225)]:
   rod(name+' instrument collar',(x,y+sign*(yy-.055),axisz),(x,y+sign*(yy+.055),axisz),r,materials['edge'],detailcol,vertices=12)
  yy=y+sign*1.38
  extrude(name+' prismatic end casing',rounded_rect(x,yy,.47,.37,.075,2),axisz-.23,.46,materials['naval'],detailcol)
  rod(name+' end cover',(x,y+sign*1.52,axisz),(x,y+sign*1.57,axisz),.195,materials['edge'],detailcol,vertices=12)
  rod(name+' forward objective sleeve',(x+.19,yy,axisz-.04),(x+.58,yy,axisz-.04),.063,materials['naval'],detailcol,.049,12)
  rod(name+' objective glazing',(x+.579,yy,axisz-.04),(x+.59,yy,axisz-.04),.042,materials['glass'],detailcol,vertices=12)
  # Forks meet the bearing collars and the pedestal's crosshead continuously.
  polyline(name+' bearing fork',[(x-.22,y+sign*.44,axisz-.28),(x-.28,y+sign*.45,axisz-.09),(x,y+sign*.45,axisz)],.060,materials['naval'],vertices=6)
  rod(name+' yoke brace',(x,y,base+.48),(x+.22,y+sign*.44,axisz-.30),.046,materials['naval'],detailcol,vertices=6)
  box(name+' lower instrument box',(x-.37,y+sign*.34,base+.35),(.26,.30,.40),materials['naval'],detailcol)
  rod(name+' instrument box bracket',(x,y+sign*.23,base+.39),(x-.30,y+sign*.34,base+.39),.038,materials['edge'],detailcol,vertices=6)
  rod(name+' eyepiece',(x-.27,y+sign*.105,axisz+.12),(x-.48,y+sign*.105,axisz+.19),.052,materials['dark'],detailcol,vertices=10)
  hub=Vector((x-.31,y+sign*.60,axisz-.27))
  rod(name+' control shaft',(x-.12,y+sign*.42,axisz-.27),hub,.033,materials['edge'],detailcol,vertices=8)
  ring(name+' adjusting wheel',hub,(0,1,0),.14,.019,materials['edge'],12)
  for a in range(3):rod(name+' wheel spoke',hub,hub+Vector((math.cos(a*math.tau/3)*.14,0,math.sin(a*math.tau/3)*.14)),.014,materials['edge'],detailcol,vertices=5)
  polyline(name+' instrument cable',[(x-.43,y+sign*.30,axisz-.2),(x-.55,y+sign*.34,base+.12),(x-.18,y+sign*.25,base+.10)],.014,materials['dark'],vertices=5)
  ring(name+' lifting eye',(x,y+sign*.98,axisz+.255),(1,0,0),.038,.011,materials['edge'],8)
 box(name+' rear readout housing',(x-.37,y,axisz-.12),(.18,.55,.28),materials['naval'],detailcol)
 box(name+' upper adjustment block',(x,y,axisz+.31),(.24,.33,.10),materials['naval'],detailcol)
for sign in [-1,1]:night_rangefinder('Signal gallery night rangefinder',15.1,sign*5.5,20.65,21.65)
# Enclosed AA directors with the characteristic rounded weather covers.
def aa_director(name,x,y,z,base):
 cyl(name+' column',(x,y,(base+z-1.08)/2),1.0,max(.2,z-1.08-base),materials['naval'],detailcol,24)
 cyl(name+' ring',(x,y,z-1.0),1.65,.22,materials['edge'],detailcol,32)
 vs=[];latitudes=[(-1.05,1.55),(-.35,1.8),(.45,1.78),(1.25,1.36),(1.75,.5),(1.82,0)]
 for zz,r in latitudes:
  vs.extend((x+1.25*r*math.cos(math.tau*i/28),y+r*math.sin(math.tau*i/28),z+zz) for i in range(28))
 fs=[(j*28+i,j*28+(i+1)%28,(j+1)*28+(i+1)%28,(j+1)*28+i) for j in range(len(latitudes)-1) for i in range(28)]
 mesh(name+' weather dome',vs,fs,materials['naval'],detailcol,True)
 rod(name+' transverse optics',(x,y-2.0,z),(x,y+2.0,z),.42,materials['edge'],detailcol,vertices=24)
 for sign in [-1,1]:rod(name+' optical cap',(x,y+sign*2.0,z),(x,y+sign*2.035,z),.36,materials['dark'],detailcol,vertices=20)
 for zz in [-.45,.55]:
  rr=next(ra+(rb-ra)*(zz-za)/(zb-za) for (za,ra),(zb,rb) in zip(latitudes,latitudes[1:]) if za<=zz<=zb)
  polyline(name+' cover seam',[(x+1.25*rr*math.cos(math.tau*i/28),y+rr*math.sin(math.tau*i/28),z+zz) for i in range(28)],.02,materials['edge'],closed=True)
for sign in [-1,1]:
 aa_director('Forward AA director',15.0,sign*6.8,17.8,12.95)
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
searchlight_support=SupportSurface([*hullcol.objects,*supercol.objects])
for sign in [-1,1]:
 for xx,yy,zz,bearing in [(1.45,4.3,18.7,sign*1.25),(-7.7,3.8,17.7,sign*2.15)]:
  searchlight_cup('Funnel searchlight',xx,sign*yy,zz,deep=xx>0)
  searchlight('Funnel 1.5 m searchlight',xx,sign*yy,zz+.08,bearing)
 searchlight('Aft searchlight',-34.8,sign*4.8,searchlight_support.below(-34.8,sign*4.8,20)+.02,sign*2.5)
searchlight('Foretop 1.5 m searchlight',20.2,0,24.71,0)
# Fore pole mast and aft mainmast, with yards, ladders, navigation platforms,
# signal halyards and properly grounded stays. All lines are original geometry.
for name,x,base,top in [('foremast',6.4,5.73,40.3),('mainmast',-22.0,10.96,48.5)]:
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
for xx,zz in [(5.9,40),(-22.5,48)]:rod('Wireless spreader',(xx,-.42,zz),(xx,.42,zz),.045,materials['edge'],detailcol,vertices=8)
for yy in [-.38,.38]:
 a=Vector((5.9,yy,40.0));b=Vector((-22.5,yy,48.0));pts=[a+(b-a)*(i/16)-Vector((0,0,1.15*math.sin(math.pi*i/16))) for i in range(17)];polyline('Aerial span',pts,.015,materials['dark'],vertices=5)
# Stern flagstaff, bow jackstaff and rigged stern boat-handling derrick.
for x,top in [(-123,15.5),(124,11.5)]:rod('Ensign or jack staff',(x,0,deckz(x)),(x-.3,0,top),.08,materials['edge'],detailcol,.025,10)
rod('After derrick post',(-43,0,12.3),(-43,0,26.8),.13,materials['edge'],detailcol,.05,12)
rod('After derrick boom',(-43,0,16.0),(-48,0,21.5),.09,materials['edge'],detailcol,vertices=10)
rod('After derrick cable',(-43,0,26.5),(-48,0,21.5),.018,materials['dark'],detailcol,vertices=5)
# Aircraft hangar roof camber and folding leaves follow the approved model.
# The eaves and door sills follow the raised blueprint decks.
for name,x,y,length,breadth,base in [('Port single hangar',8.8,6.7,11.8,5.5,12.1),('Starboard single hangar',8.8,-6.7,11.8,5.5,12.1),('Double hangar',-24.6,0,12.8,14.2,13.2)]:
 rise=.85 if breadth<7 else 1.12
 arc=[(y+breadth*(i/16-.5),base+rise*math.sin(math.pi*i/16)) for i in range(17)]
 roofvs=[(xx,yy,zz) for xx in [x-length/2,x+length/2] for yy,zz in arc]
 mesh(name+' curved roof',roofvs,[(i,i+1,i+18,i+17) for i in range(16)]+[tuple(reversed(range(17))),tuple(range(17,34))],materials['roof'],supercol,True)
 for xx in [x-length/2+.15,x,x+length/2-.15]:polyline(name+' roof seam',[(xx,yy,zz+.025) for yy,zz in arc],.028,materials['edge'])
 # The double hangar opens forward; the side hangars open aft onto handling deck.
 xx=x+(length/2+.035)*(1 if breadth>7 else -1);floor=8.4;doorheight=base-floor-.12
 leaves=12 if breadth>7 else 6;opening=breadth-.65
 for i in range(leaves):
  yy=y-opening/2+opening*(i+.5)/leaves
  box(name+' folding door',(xx,yy,floor+doorheight/2),(.10,opening/leaves-.035,doorheight),materials['naval'],detailcol)
  for dz in [.65,2.1,3.55]:box(name+' door stiffener',(xx+(.065 if breadth>7 else -.065),yy,floor+dz),(.07,opening/leaves-.13,.055),materials['edge'],detailcol)
 rod(name+' door track',(xx,y-opening/2-.1,floor+doorheight+.1),(xx,y+opening/2+.1,floor+doorheight+.1),.075,materials['edge'],detailcol,vertices=8)
 for sign in [-1,1]:vent(name+' ventilation',(x, y+sign*(breadth/2+.035),base-1.15),(1.8,.12,1.1),sign)
# An aft cross-gallery carries the center searchlight and joins the side galleries.
extrude('Funnel aft cross gallery',rounded_rect(-8.15,0,2.3,9.7,.4,3),17.65,.18,materials['roof'],supercol)
rail('Funnel aft cross gallery',[(-9.28,-4.4,17.83),(-9.28,4.4,17.83)],.88,1.6,False)
for sign in [-1,1]:rod('Cross gallery bracket',(-9.1,sign*3,17.63),(-7.4,sign*3,16.1),.075,materials['naval'],supercol,vertices=6)

boat_support=SupportSurface([*hullcol.objects,*supercol.objects])
def boat(name,x,y,z,length,breadth,cabin=False):
 # Seat the keel consistently above the actual roof, including raised platforms.
 z=boat_support.below(x,y,z+5)+.40
 # Original pgsb708 visual interpretation: fine raked stem, flared topsides,
 # narrower rounded transom and visibly hollow timber interior. The closed
 # double skin gives an actual gunwale thickness rather than an open mesh rim.
 stations=[(-.50,.33,.24),(-.46,.63,.13),(-.36,.86,.04),(-.20,.97,0),(0,1,0),(.18,.94,.035),(.32,.74,.10),(.42,.44,.21),(.48,.15,.34),(.50,0,.40)]
 depth=breadth*.38
 def shape(t):
  for (a,wa,sa),(b,wb,sb) in zip(stations,stations[1:]):
   if a<=t<=b:
    f=(t-a)/(b-a);return (wa+(wb-wa)*f)*breadth/2,sa+(sb-sa)*f
  return 0,.4
 vs=[]
 for t,w,sheer in stations:
  xx=x+t*length;half=w*breadth/2
  # Continuous outer-to-inner section across both gunwales and bottom.
  vs.extend([(xx,y,z+sheer),(xx,y+half*.55,z+depth*.17+sheer),(xx,y+half*.84,z+depth*.55+sheer),(xx,y+half,z+depth+sheer),(xx,y+max(0,half-.065),z+depth+sheer-.035),(xx,y+max(0,half*.79-.045),z+depth*.55+sheer),(xx,y+max(0,half*.46-.035),z+depth*.26+sheer),(xx,y,z+depth*.20+sheer),(xx,y-max(0,half*.46-.035),z+depth*.26+sheer),(xx,y-max(0,half*.79-.045),z+depth*.55+sheer),(xx,y-max(0,half-.065),z+depth+sheer-.035),(xx,y-half,z+depth+sheer),(xx,y-half*.84,z+depth*.55+sheer),(xx,y-half*.55,z+depth*.17+sheer)])
 n=14;fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(stations)-1) for i in range(n)]
 fs.extend([tuple(reversed(range(n))),tuple(range((len(stations)-1)*n,len(stations)*n))])
 mesh(name+' closed clinker hull',vs,fs,materials['naval'] if cabin else materials['wood'],detailcol,True)
 gunwale=[(x+t*length,y+w*breadth/2,z+depth+sheer) for t,w,sheer in stations]+[(x+t*length,y-w*breadth/2,z+depth+sheer) for t,w,sheer in reversed(stations)]
 polyline(name+' rolled gunwale',gunwale,.045,materials['light'],closed=True,vertices=8)
 for sign in [-1,1]:
  for frac,spread in [(.32,.67),(.58,.85),(.80,.94)]:
   polyline(name+' plank lap',[(x+t*length,y+sign*w*breadth*.5*spread,z+depth*frac+sheer) for t,w,sheer in stations],.013,materials['edge'] if cabin else materials['wood'],vertices=5)
 # Floorboards fit the taper, with ribs tying floor and gunwale into one shell.
 for yy in [-.22,-.11,0,.11,.22]:
  box(name+' floorboard',(x-length*.02,y+yy*breadth,z+depth*.38),(length*.68,breadth*.102,.045),materials['wood'],detailcol)
 for t in [-.35,-.25,-.12,.02,.16,.29,.39]:
  half,sheer=shape(t);xx=x+t*length
  pts=[(xx,y-half+.055,z+depth+sheer-.04),(xx,y-half*.79,z+depth*.55+sheer),(xx,y-half*.46,z+depth*.26+sheer),(xx,y,z+depth*.21+sheer),(xx,y+half*.46,z+depth*.26+sheer),(xx,y+half*.79,z+depth*.55+sheer),(xx,y+half-.055,z+depth+sheer-.04)]
  polyline(name+' internal rib',pts,.027,materials['wood'],vertices=6)
 # Fine foredeck and transom capping boards close the extremities.
 for ta,tb in [(-.50,-.38),(.37,.50)]:
  cut=[(t,w,sh) for t,w,sh in stations if ta<=t<=tb]
  outline=[(x+t*length,y+w*breadth/2,z+depth+sh-.035) for t,w,sh in cut]+[(x+t*length,y-w*breadth/2,z+depth+sh-.035) for t,w,sh in reversed(cut)]
  mesh(name+' end deck',outline,[tuple(range(len(outline)))],materials['deck'],detailcol)
 # All cradle feet raycast original support surfaces; their arms meet the hull.
 for t in [-.27,.25]:
  xx=x+length*t;half,sheer=shape(t)
  box(name+' cradle crossbeam',(xx,y,z-.14),(.23,breadth*.83,.22),materials['edge'],detailcol)
  for sign in [-1,1]:
   yy=y+sign*breadth*.28;floor=boat_support.below(xx,yy,z-.27)
   box(name+' cradle leg',(xx,yy,(floor+z-.05)/2),(.21,.20,z-.05-floor+.02),materials['edge'],detailcol)
   rod(name+' fitted cradle arm',(xx,y,z-.12),(xx,y+sign*half*.85,z+depth*.55+sheer),.057,materials['edge'],detailcol,vertices=8)
 if cabin:
  # Long low after cabin, shallow sloped wheelhouse and a flush forward deck.
  outline=[(x+t*length,y+w*breadth*.49) for t,w,sh in stations]+[(x+t*length,y-w*breadth*.49) for t,w,sh in reversed(stations)]
  extrude(name+' launch deck',outline,z+depth-.015,.06,materials['deck'],detailcol)
  cabx=x-length*.13;cabbase=z+depth+.045;cabheight=.79
  pts=rounded_rect(cabx,y,length*.43,breadth*.67,.20,3)
  extrude(name+' cabin sides',pts,cabbase,cabheight,materials['naval'],detailcol,.025)
  roof=rounded_rect(cabx,y,length*.45,breadth*.71,.22,3)
  n=len(roof);ridge=[(a,b*.88+y*.12,cabbase+cabheight+.16) for a,b in roof]
  mesh(name+' cambered cabin roof',[(a,b,cabbase+cabheight) for a,b in roof]+ridge,[tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['canvas'],detailcol)
  for sign in [-1,1]:
   for t in [-.155,-.055,.065,.155]:
    xx=cabx+length*t;yy=y+sign*breadth*.339
    box(name+' framed cabin port',(xx,yy,cabbase+.48),(length*.074,.045,.42),materials['edge'],detailcol)
    box(name+' cabin glazing',(xx,yy+sign*.027,cabbase+.48),(length*.060,.025,.32),materials['glass'],detailcol)
   box(name+' windscreen frame',(cabx+length*.217,y+sign*breadth*.16,cabbase+.49),(.045,breadth*.27,.45),materials['edge'],detailcol)
   box(name+' windscreen',(cabx+length*.242-.018,y+sign*breadth*.16,cabbase+.49),(.020,breadth*.23,.35),materials['glass'],detailcol)
  hatch(name+' cabin hatch',cabx-length*.10,y,cabbase+cabheight+.17,.78,.62)
  for t in [-.43,.35]:
   for sign in [-1,1]:rod(name+' cleat',(x+length*t-.14,y+sign*breadth*.21,z+depth+.20),(x+length*t+.14,y+sign*breadth*.21,z+depth+.20),.024,materials['edge'],detailcol,vertices=8)
 else:
  for t in [-.29,-.12,.06,.23,.34]:
   half,sheer=shape(t);xx=x+length*t;seat=z+depth*.82+sheer
   box(name+' rowing thwart',(xx,y,seat),(.24,2*half*.91,.08),materials['deck'],detailcol)
   for sign in [-1,1]:
    rod(name+' seat knee',(xx,y+sign*half*.67,seat-.03),(xx,y+sign*half*.82,seat-.25),.035,materials['wood'],detailcol,vertices=6)
    rod(name+' rowlock socket',(xx,y+sign*half,z+depth+sheer-.025),(xx,y+sign*half,z+depth+sheer+.095),.025,materials['edge'],detailcol,vertices=8)
  for sign in [-1,1]:
   yy=y+sign*breadth*.21;zz=z+depth*.87+.09
   rod(name+' stowed oar shaft',(x-length*.33,yy,zz),(x+length*.23,yy,zz),.025,materials['wood'],detailcol,vertices=8)
   extrude(name+' shaped oar blade',[(x-length*.43,yy-.075),(x-length*.43,yy+.075),(x-length*.35,yy+.095),(x-length*.30,yy+.025),(x-length*.30,yy-.025),(x-length*.35,yy-.095)],zz-.015,.030,materials['wood'],detailcol)
for sign in [-1,1]:
 # The reference's forward bank consists of open rowing boats.
 for yy,length in [(4.9,8.5),(6.85,9.2),(8.8,10.0)]:
  boat('Forward cutter',9.5,sign*yy,12.5,length,1.65,False)
 boat('Aft motor launch',-24.3,sign*5.2,12.32,11.7,2.85,True)
 boat('Aft cutter',-25.3,sign*1.85,12.35,9.2,2.45,False)
 boat('After dinghy',-33.1,sign*6.9,9.56,7.6,2.05,False)

def truss(name,a,b,width,depth):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=axis.cross(Vector((0,0,1))).normalized()*width/2;up=axis.cross(side).normalized()*depth/2
 corners=[side+up,-side+up,-side-up,side-up]
 for j in range(4):rod(name+' end cross member',b+corners[j],b+corners[(j+1)%4],.055,materials['edge'],detailcol,vertices=8)
 for offset in corners:rod(name+' chord',a+offset,b+offset,.055,materials['edge'],detailcol,vertices=8)
 bays=max(3,math.ceil((b-a).length/1.6))
 for i in range(bays):
  lo=a+(b-a)*(i/bays);hi=a+(b-a)*((i+1)/bays)
  for j in range(4):
   k=(j+1)%4;rod(name+' cross member',lo+corners[j],lo+corners[k],.035,materials['naval'],detailcol,vertices=6)
   rod(name+' diagonal',lo+corners[j if i%2==0 else k],hi+corners[k if i%2==0 else j],.03,materials['naval'],detailcol,vertices=6)
for sign in [-1,1]:
 base=Vector((-6.5,sign*9.7,8.4));heel=base+Vector((0,0,2.2));tip=Vector((7.2,sign*6.6,22.0))
 cyl('Aircraft crane foundation',base+Vector((0,0,.28)),1.05,.56,materials['edge'],detailcol,32)
 cyl('Aircraft crane pedestal',base+Vector((0,0,1.4)),.78,2.45,materials['naval'],detailcol,32)
 cyl('Aircraft crane bearing',heel,1.04,.27,materials['edge'],detailcol,32)
 box('Aircraft crane winch housing',heel+Vector((-.65,0,.75)),(2.4,1.7,1.55),materials['naval'],detailcol)
 box('Aircraft crane operator window',heel+Vector((-.4,sign*.862,.94)),(1.1,.035,.55),materials['glass'],detailcol)
 truss('Aircraft crane lattice boom',heel,tip,.95,1.05)
 rod('Crane tip sheave axle',tip+Vector((0,-.55,0)),tip+Vector((0,.55,0)),.09,materials['edge'],detailcol,vertices=10)
 apex=heel+Vector((-.9,0,4.5));truss('Aircraft crane kingpost',heel+Vector((-1,0,.5)),apex,.65,.65)
 rod('Crane kingpost cable pin',apex+Vector((0,-.36,0)),apex+Vector((0,.36,0)),.09,materials['edge'],detailcol,vertices=10)
 for off in [-.28,.28]:
  rod('Crane topping cable',apex+Vector((0,off,0)),tip+Vector((0,off,0)),.021,materials['dark'],detailcol,vertices=6)
  rod('Crane hoisting cable',heel+Vector((-.6,off,1.8)),tip+Vector((0,off,-.13)),.018,materials['dark'],detailcol,vertices=5)
 rod('Crane suspended cable',tip,tip-Vector((0,0,1.85)),.024,materials['dark'],detailcol,vertices=6)
 ring('Crane sheave',tip,(0,1,0),.19,.045,materials['edge'],16)
 ring('Crane hook',tip-Vector((0,0,1.98)),(0,1,0),.14,.035,materials['edge'],12)
 ladder('Crane pedestal access',base+Vector((-.88,0,.1)),heel+Vector((-.88,0,.5)),.48)
# Transverse catapult with two rails, open web and launch trolley.
catapult_before=set(bpy.data.objects)
for xx in [-9.9,-8.2]:
 rod('Catapult longitudinal rail',(xx,-14,6.82),(xx,14,6.82),.09,materials['light'],detailcol,vertices=8)
 box('Catapult girder',(xx,0,6.43),(.17,28,.48),materials['edge'],detailcol)
 for yy in [-13+i*1.3 for i in range(21)]:
  rod('Catapult web',(xx,yy-.58,6.23),(xx,yy+.58,6.69),.04,materials['naval'],detailcol,vertices=6)
for yy in [-13.5,-9,-4.5,0,4.5,9,13.5]:box('Catapult sleeper',(-9.05,yy,6.45),(2.18,.22,.22),materials['naval'],detailcol)
box('Catapult trolley',(-9.05,0,7.0),(2.35,2.3,.24),materials['roof'],detailcol)
for yy in [-.9,.9]:
 for xx in [-9.9,-8.2]:rod('Trolley wheel',(xx-.10,yy,6.92),(xx+.10,yy,6.92),.20,materials['edge'],detailcol,vertices=16)

for ob in set(bpy.data.objects)-catapult_before:ob.location.z+=2.65

# Existing original AA geometry now uses the same blueprint joints as other guns.
# The two upper quad fittings retain their original decorative geometry.
aa_support=SupportSurface([*hullcol.objects,*supercol.objects])
def aa_mount(name,x,y,z,caliber,bearing=0,quad=False,mount=None):
 # Foundations use the authored deck edges. Outboard sponsons span back to a
 # wall with knees; a light gun is never left floating beside a narrowed house.
 if z>deckz(x)+.8:
  candidates=[]
  for s in DEF['structures']:
   pts=[(-zz,-xx) for xx,zz in s['footprint']];top=s['baseY']+s['height']
   if top<=z+.07 and top>z-4 and min(v[0] for v in pts)<x<max(v[0] for v in pts):
    wall,_=house_side(pts,x,1 if y>0 else -1);candidates.append((z-top+max(0,abs(y)-abs(wall))*.12,top,wall))
  if candidates:
   _,top,wall=min(candidates);r=.95 if caliber>.025 or quad else .65
   cyl(name+' supported foundation',(x,y,(top+z)/2),r,max(.12,z-top),materials['roof'],detailcol,24)
   if abs(y)+r>abs(wall):
    sign=1 if y>0 else -1;outer=y+sign*r;inner=wall-sign*.35
    box(name+' sponson deck',(x,(inner+outer)/2,z-.11),(2*r,abs(outer-inner),.22),materials['roof'],detailcol)
    for dx in [-r*.64,r*.64]:rod(name+' sponson knee',(x+dx,outer-sign*.08,z-.19),(x+dx,wall-sign*.2,top-1.05),.065,materials['naval'],detailcol,vertices=8)
 else:
  floor=aa_support.below(x,y,z)
  if z-floor>.015:cyl(name+' deck seating',(x,y,(floor+z)/2),1.50 if caliber>.08 else .76 if caliber>.025 else .42,z-floor+.02,materials['naval'],detailcol,24)
 before=set(bpy.data.objects);heavy=caliber>.08;medium=caliber>.025
 radius=1.50 if heavy else .76 if medium or quad else .42
 cyl(name+' deck ring',(0,0,.10),radius,.2,materials['edge'],detailcol,28)
 cyl(name+' pedestal',(0,0,.25 if heavy else .53),radius*.48,.30 if heavy else .86,materials['naval'],detailcol,20)
 axisz=1.63 if heavy else 1.30;length=4.70 if heavy else 2.22 if medium else 1.45
 # Cast saddle, bearing axle and barrel slide make a continuous carriage.
 fork_y=.80 if heavy else .45;fork_z=.43 if heavy else .65
 rod(name+' carriage crosshead',(0,-fork_y,.43 if heavy else .76),(0,fork_y,.43 if heavy else .76),.07 if heavy else .13,materials['naval'],detailcol,vertices=12)
 if heavy:
  # Outboard bearing stubs leave the twin receivers an open lowering well.
  for sign in [-1,1]:rod(name+' trunnion axle',(.12,sign*.60,axisz),(.12,sign*.82,axisz),.12,materials['edge'],detailcol,vertices=12)
 else:rod(name+' trunnion axle',(.12,-.52,axisz),(.12,.52,axisz),.12,materials['edge'],detailcol,vertices=12)
 if heavy:
  # Open-backed sloped shield, rather than a solid rectangular box.
  cross=[(-1.25,.58),(1.28,.58),(1.17,1.95),(.63,2.44),(-1.12,2.44)]
  vs=[(xx,yy,zz) for yy in [-1.47,1.47] for xx,zz in cross]
  mesh(name+' side shield',vs,[(0,1,2,3,4),(5,9,8,7,6)],materials['naval'],detailcol)
  # Two continuous gun slots cross the front, brow and overhead plate. The
  # barrels pass through all three planes as the carriage elevates to 80 deg.
  for low,high in [(-1.47,-.70),(-.12,.12),(.70,1.47)]:
   for a,b in zip(cross[1:4],cross[2:5]):
    mesh(name+' slotted shield plate',[(a[0],low,a[1]),(a[0],high,a[1]),(b[0],high,b[1]),(b[0],low,b[1])],[(0,1,2,3)],materials['naval'],detailcol)
  sill_x=1.28-(.70-.58)*.11/(1.95-.58)
  mesh(name+' shield lower sill',[(1.28,-1.47,.58),(1.28,1.47,.58),(sill_x,1.47,.70),(sill_x,-1.47,.70)],[(0,1,2,3)],materials['naval'],detailcol)
  for yy in [-1.05,1.05]:box(name+' loading deck',(-.3,yy,.515),(2.3,.84,.13),materials['roof'],detailcol)
 count=4 if quad else 2 if heavy or medium else 1
 barrel_groups=[]
 for i in range(count):
  barrel_before=set(bpy.data.objects)
  yy=(i%2-.5)*(.80 if heavy else .55) if count>1 else 0;zz=axisz+(i//2)*.34
  elev=math.radians(1) if mount else .18 if heavy else .40 if quad else .28;start=Vector((.12,yy,zz));direction=Vector((math.cos(elev),0,math.sin(elev)))
  rod(name+' receiver',start-direction*.8,start+direction*.5,.21 if heavy else .10,materials['naval'],detailcol,vertices=12)
  rod(name+' tapered barrel',start+direction*.3,start+direction*length,caliber*.78,materials['edge'],detailcol,caliber*.46,12)
  rod(name+' muzzle opening',start+direction*(length+.002),start+direction*(length+.035),caliber*.35,materials['dark'],detailcol,vertices=12)
  rod(name+' recoil cylinder',start+Vector((0,0,-.24)),start+direction*1.05+Vector((0,0,-.24)),.105 if heavy else .048,materials['naval'],detailcol,vertices=10)
  for a in (0,.65):rod(name+' recoil slide collar',start+direction*a,start+direction*a+Vector((0,0,-.24)),.09 if heavy else .055,materials['naval'],detailcol,vertices=10)
  if not heavy:box(name+' feed magazine',tuple(start+Vector((-.22,0,.14))),(.32,.24,.25),materials['dark'],detailcol)
  barrel_groups.append((yy,zz,elev,set(bpy.data.objects)-barrel_before))
 for sign in [-1,1]:
  rod(name+' trunnion',(0,sign*fork_y,fork_z),(0,sign*fork_y,axisz),.14 if heavy else .075,materials['naval'],detailcol,vertices=10)
  rod(name+' bearing cheek',(0,sign*fork_y,axisz),(.12,sign*fork_y,axisz),.14 if heavy else .08,materials['naval'],detailcol,vertices=10)
  cyl(name+' crew seat',(-.65,sign*(1.04 if heavy else .55),.72),.23,.11,materials['roof'],detailcol,16)
  rod(name+' seat support',(-.65,sign*(1.04 if heavy else .55),.2),(-.65,sign*(1.04 if heavy else .55),.68),.05,materials['edge'],detailcol,vertices=6)
  rod(name+' seat outrigger',(0,0,.40),(-.65,sign*(1.04 if heavy else .55),.40),.06,materials['naval'],detailcol,vertices=8)
  ring(name+' handwheel',(-.34,sign*(.83 if heavy else .45),1.14),(0,1,0),.22 if heavy else .13,.025,n=14)
  rod(name+' handwheel shaft',(0,sign*fork_y,1.14),(-.34,sign*(.83 if heavy else .45),1.14),.035,materials['edge'],detailcol,vertices=8)
  for a in range(3):rod(name+' handwheel spoke',(-.34,sign*(.83 if heavy else .45),1.14),(-.34+(.22 if heavy else .13)*math.cos(a*math.tau/3),sign*(.83 if heavy else .45),1.14+(.22 if heavy else .13)*math.sin(a*math.tau/3)),.018,materials['edge'],detailcol,vertices=6)
 rod(name+' sight bracket',(0,0,.43 if heavy else .65),(-.35,0,axisz+.5),.035,materials['edge'],detailcol,vertices=6)
 ring(name+' ring sight',(-.35,0,axisz+.54),(1,0,0),.11,.015,n=12)
 # Assemble in the local mount frame, then place the complete hierarchy.
 pieces=set(bpy.data.objects)-before
 # Snapshot once: refreshing the whole ship for each parent change is quadratic.
 bpy.context.view_layer.update()
 piece_matrices={ob:ob.matrix_world.copy() for ob in pieces}
 def joint(suffix,loc=(0,0,0),rotation=(0,0,0)):
  ob=bpy.data.objects.new(mount['id']+'.'+suffix,None);detailcol.objects.link(ob)
  ob.location=loc;ob.rotation_euler=rotation;ob['nodeId']=ob.name;ob['assemblyId']=mount['id'];return ob
 def attach(ob,parent,frame=Matrix.Identity(4)):
  ob.parent=parent;ob.matrix_parent_inverse=Matrix.Identity(4)
  ob.matrix_basis=frame.inverted()@piece_matrices[ob]
 if mount:
  pivot=joint('yaw')
  sides=['center'] if count==1 else ['left','right']
  # Authoring +Y is runtime -X, so the higher Y barrel is the left axis.
  for side,(yy,zz,elev,barrels) in zip(sides,sorted(barrel_groups,reverse=True,key=lambda v:v[0])):
   pitch=joint(side+'.elevation',(.12,yy,zz),(0,-elev,0));pitch.parent=pivot
   pitch_frame=Matrix.Translation((.12,yy,zz))@Matrix.Rotation(-elev,4,'Y')
   recoil=joint(side+'.recoil');recoil.parent=pitch
   muzzle=joint(side+'.muzzle',(length,0,0));muzzle.parent=recoil
   for ob in barrels:attach(ob,recoil,pitch_frame)
  for ob in pieces:
   ob['assemblyId']=mount['id']
   if ob.parent is None:attach(ob,pivot)
 else:
  pivot=bpy.data.objects.new(name+' visual mount',None);detailcol.objects.link(pivot)
  for ob in pieces:ob.parent=pivot;ob.matrix_parent_inverse=Matrix.Identity(4)
 pivot.location=(x,y,z);pivot.rotation_euler.z=bearing
for mount in DEF['mounts']:
 if mount['weapon']['caliberM']<=.13:
  a,b,c=mount['position'];aa_mount(mount['name'],-c,-a,b,mount['weapon']['caliberM'],bearing=-math.radians(mount['bearingDeg']),mount=mount)
for sign in [-1,1]:
 aa_mount('Quad 2 cm April 1941 fit',17.0,sign*4.65,24.72,.020,bearing=sign*.82,quad=True)

# Mooring machinery, proper stockless anchors, hatch coamings and hull scuttles.
def bollard(name,x,y,z):
 box(name+' sole',(x,y,z+.06),(1.35,.58,.12),materials['edge'],detailcol)
 for dx in [-.42,.42]:
  cyl(name+' post',(x+dx,y,z+.4),.18,.66,materials['edge'],detailcol,16)
  cyl(name+' head',(x+dx,y,z+.75),.24,.12,materials['naval'],detailcol,16)
def capstan(name,x,y,z,r=.58):
 cyl(name+' foundation',(x,y,z+.12),r*1.4,.24,materials['naval'],detailcol,24)
 cyl(name+' drum',(x,y,z+.55),r*.72,.76,materials['edge'],detailcol,24)
 for zz in [.25,.68,.94]:cyl(name+' flange',(x,y,z+zz),r,.12,materials['edge'],detailcol,28)
 cyl(name+' crown',(x,y,z+1.05),r*.78,.12,materials['light'],detailcol,24)
for sign in [-1,1]:
 for x in [-119,-108,-93,-61,54,91,108,120]:
  yy=sign*(width(x)-1.25);bollard('Double mooring bitt',x,yy,deckz(x)+.005)
  # Rolled oval fairlead at the sheer, separate from the inboard bitt.
  p=Vector((x+.9,sign*(width(x+.9)-.16),deckz(x+.9)+.4));ring('Deck edge fairlead',p,(0,1,0),.27,.09,materials['edge'],18)
 for x in [99.5,107.5]:capstan('Anchor windlass',x,sign*2.7,deckz(x)+.08,.66)
 # Paired chains lead across deck to the side hawse fittings. Interlocked rings
 # are confined to visible anchor runs to keep the playable mesh budget bounded.
 start=Vector((99.5,sign*2.7,deckz(99.5)+.23));end=Vector((119,sign*3.0,deckz(119)+.18));axis=(end-start).normalized()
 for i in range(66):
  p=start+(end-start)*(i/65);normal=Vector((0,0,1)) if i%2==0 else Vector((0,1,0));ring('Anchor chain link',p,normal,.12,.032,materials['dark'],10)
 for xx in [102,114]:box('Chain stopper',(xx,sign*2.9,deckz(xx)+.26),(.56,.6,.38),materials['edge'],detailcol)
 x=117.2;zz=deckz(x)-1.5;yy=sign*(side_width(x,zz)+.09)
 rod('Hawse recess',(x,yy,zz),(x,yy+sign*.025,zz),.53,materials['dark'],detailcol,vertices=24)
 ring('Hawse steel rim',(x,yy+sign*.04,zz),(0,sign,0),.55,.11,materials['naval'],24)
 rod('Anchor shank',(x,yy+sign*.25,zz-.12),(x-.65,yy+sign*.29,zz-2.50),.13,materials['edge'],detailcol,vertices=12)
 crown=Vector((x-.65,yy+sign*.29,zz-2.45));rod('Anchor crown',crown+Vector((-.62,0,0)),crown+Vector((.62,0,0)),.19,materials['edge'],detailcol,vertices=12)
 for dx in [-1,1]:
  a=crown+Vector((dx*.48,0,0));b=crown+Vector((dx*1.03,sign*.22,.98));rod('Anchor arm',a,b,.16,materials['edge'],detailcol,.11,10)
  verts=[tuple(b+Vector((u,v,w))) for u,v,w in [(-.3,-.16,0),(.3,-.16,0),(.18,.17,.55),(-.18,.17,.55),(-.3,-.05,0),(.3,-.05,0),(.18,.24,.55),(-.18,.24,.55)]]
  mesh('Anchor fluke',verts,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],materials['edge'],detailcol)
 capstan('After mooring capstan',-111,sign*2.4,deckz(-111)+.005,.47)
 # Two rows follow the actual loft surface, avoiding detached square scuttles.
 for x in range(-107,112,3):
  for z in [2.7,4.63]:
   if abs(x)<85 and z<3.0:continue
   if width(x)<2:continue
   yy=sign*(side_width(x,z)+.034);porthole('Hull round scuttle',(x,yy,z),(0,sign,0),.145)
 # Deck edge rails interpolate the blueprint sheer at every original station.
 pts=[(x,sign*(width(x)-.22),deckz(x)+.035) for x in [-122.5+i*2 for i in range(123)] if width(x)>.5]
 rail('Weather deck safety rail',pts,.98,2.0,False)
 # Subtle rubbing strip, much thinner than the silhouette-defining hull.
 pts=[(x,sign*(side_width(x,deckz(x)-.32)+.024),deckz(x)-.32) for x in range(-120,123,2)]
 polyline('Sheer strake edge',pts,.028,materials['edge'],vertices=5)
for x,y in [(83,0),(91,0),(112,0),(120,0),(-91,0),(-101,0),(-115,0),(57,8),(57,-8),(-64,8),(-64,-8),(1,14),(1,-14),(-47,12),(-47,-12)]:hatch('Weather deck hatch',x,y,deckz(x)+.005,1.35,.95)
for sign in [-1,1]:
 for x in [-103,-87,-52,48,61,86,113]:
  y=sign*min(width(x)-2.2,7.8);z=deckz(x)
  cyl('Mushroom vent stem',(x,y,z+.32),.18,.64,materials['naval'],detailcol,16)
  cyl('Mushroom vent hood',(x,y,z+.69),.34,.22,materials['naval'],detailcol,20)
 for x,y,z in [(30,9,9.4),(6,13,5.8),(-14,13,5.8),(-40,9.5,5.8),(-53,8.5,5.8)]:
  y*=sign;z=aa_support.below(x,y,z+3);box('Ready ammunition locker',(x,y,z+.62),(1.05,.64,1.24),materials['naval'],detailcol)
  box('Ammunition locker lid',(x,y,z+1.28),(1.1,.69,.08),materials['roof'],detailcol)
  rod('Locker handle',(x-.12,y+sign*.34,z+.8),(x+.12,y+sign*.34,z+.8),.022,materials['dark'],detailcol,vertices=6)
 for x,y,z in [(36,4.9,12.65),(7,10.7,8.6),(-42,7.9,9.4)]:
  y*=sign;z=aa_support.below(x,y,z+4)+.09;pts=[(xx,yy,z+.3) for xx,yy in rounded_rect(x,y,2.55,1.28,.56,5)];polyline('Carley float buoyant tube',pts,.17,materials['canvas'],closed=True,vertices=8)
  for xx in [-.85,-.45,0,.45,.85]:rod('Carley float floor',(x+xx,y-.52,z+.22),(x+xx,y+.52,z+.22),.033,materials['wood'],detailcol,vertices=6)
  for xx in [-.75,.75]:box('Carley float cradle',(x+xx,y,z+.025),(.12,1.12,.22),materials['edge'],detailcol)
 for x,y in [(80,5),(-97,5)]:
  y*=sign;z=deckz(x)+.55
  rod('Hose reel axle',(x,y-.55,z),(x,y+.55,z),.11,materials['edge'],detailcol,vertices=12)
  for yy in [-.38,.38]:rod('Hose reel flange',(x,y+yy-.035,z),(x,y+yy+.035,z),.53,materials['edge'],detailcol,vertices=24)
  rod('Hose drum',(x,y-.34,z),(x,y+.34,z),.37,materials['rope'],detailcol,vertices=24)
  for yy in [-.45,.45]:box('Reel support',(x,y+yy,z-.30),(.18,.12,.55),materials['naval'],detailcol)

# Original three-bladed screws: broad paddle outlines, reduced rake, helical
# pitch and thick roots into rounded bosses. Silhouettes were reviewed against
# approved GameModels3D pgsb708 A_Hull; the source loading datum is unverified.
# These visual shafts do not move the blueprint's machinery or combat sockets.
def screw_boss(x,y,z):
 rows=[(1.16,.30),(.83,.59),(.34,.73),(-.34,.72),(-.85,.61),(-1.18,.39),(-1.34,.08)]
 vs=[(x+dx,y+r*math.cos(math.tau*i/32),z+r*math.sin(math.tau*i/32)) for dx,r in rows for i in range(32)]
 fs=[tuple(reversed(range(32))),tuple(range((len(rows)-1)*32,len(rows)*32))]
 fs.extend((j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i) for j in range(len(rows)-1) for i in range(32))
 return mesh('Propeller boss',vs,[tuple(reversed(f)) for f in fs],materials['bronze'],undercol,True)
def shaft_bracket(name,a,b,chord=.72):
 # Closed foil strut: a wide axial chord and a narrow rounded trailing edge.
 a,b=Vector(a),Vector(b);radial=(b-a).normalized();side=radial.cross(Vector((1,0,0))).normalized()
 profile=[(-.52,0),(-.36,.10),(.16,.12),(.48,.04),(.54,0),(.48,-.04),(.16,-.12),(-.36,-.10)]
 vs=[p+Vector((u*chord,0,0))+side*v for p in [a,b] for u,v in profile];n=len(profile)
 fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,vs,[tuple(reversed(f)) for f in fs],materials['oxide'],undercol,True)
for y,xend in [(-6,-100),(0,-106),(6,-100)]:
 z=-6.8
 rod('Propeller shaft',(-69,y,-6.0),(xend+.6,y,z),.24,materials['edge'],undercol,vertices=24)
 rod('Shaft stern bearing',(xend+2.15,y,z+.08),(xend+.80,y,z+.02),.43,materials['oxide'],undercol,.36,24)
 screw_boss(xend,y,z)
 # Bearing struts penetrate the actual lofted counter, including the center
 # installation. Their upper feet are sampled from the hull, not free points.
 for sign in [-1,1]:
  bx=xend+2.1;by=y+sign*1.15;profile=section_at(bx);hits=[]
  for (wa,za),(wb,zb) in zip(profile,profile[1:]):
   if min(wa,wb)<=abs(by)<=max(wa,wb) and abs(wb-wa)>1e-6:hits.append(za+(zb-za)*(abs(by)-wa)/(wb-wa))
  foot=min(hits) if hits else -2.6
  shaft_bracket('Shaft A bracket',(bx,y,z+.05),(bx+.25,by,foot+.14),.94)
 for angle in [math.pi/2,math.pi/2+math.tau/3,math.pi/2+2*math.tau/3]:
  # Radial radius, tangential sweep, half chord. Sparse original controls are
  # interpolated for a continuous rounded edge without a pinched angular tip.
  controls=[(.55,-.08,.30),(.82,-.08,.52),(1.15,-.03,.79),(1.55,.03,1.02),(1.95,.07,1.02),(2.20,.06,.80),(2.35,.02,.44),(2.40,0,.035)]
  rows=[]
  for a,b in zip(controls,controls[1:]):
   for step in range(3):
    t=step/3;rows.append(tuple(u+(v-u)*t for u,v in zip(a,b)))
  rows.append(controls[-1]);cols=9;vs=[]
  for face in [-1,1]:
   for r,sweep,w in rows:
    pitch=math.atan2(3.6,math.tau*r)
    for i in range(cols):
     q=-1+2*i/(cols-1);chord=q*w;tangent=sweep+chord*math.cos(pitch)
     thickness=(.012+.105*(1-r/2.6))*math.sqrt(max(0,1-q*q))+.008
     axial=chord*math.sin(pitch)+.035*(r-.55)+face*thickness
     vs.append((xend+axial,y+r*math.cos(angle)-tangent*math.sin(angle),z+r*math.sin(angle)+tangent*math.cos(angle)))
  n=len(rows)*cols;fs=[]
  for face in [0,1]:
   for j in range(len(rows)-1):
    for i in range(cols-1):
     ids=(face*n+j*cols+i,face*n+j*cols+i+1,face*n+(j+1)*cols+i+1,face*n+(j+1)*cols+i);fs.append(ids if face else tuple(reversed(ids)))
  boundary=list(range(cols))+[j*cols+cols-1 for j in range(1,len(rows))]+list(range(n-2,n-cols-1,-1))+[j*cols for j in reversed(range(1,len(rows)-1))]
  fs.extend((a,b,b+n,a+n) for a,b in zip(boundary,boundary[1:]+boundary[:1]))
  blade=mesh('Twisted screw blade',vs,fs,materials['bronze'],undercol,True)
  bm=bmesh.new();bm.from_mesh(blade.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(blade.data);bm.free()
for y in [-3,3]:
 pts=[(-113.6,y),(-112.8,y-.20),(-109.7,y-.28),(-109.0,y-.14),(-109.0,y+.14),(-109.7,y+.28),(-112.8,y+.20)]
 extrude('Foil-section balanced rudder',pts,-5.8,3.75,materials['oxide'],undercol,.06)
 rod('Rudder stock',(-110.4,y,-5.5),(-110.4,y,-1.8),.19,materials['edge'],undercol,vertices=20)
for sign in [-1,1]:
 stations=[-49,-44,-32,-16,0,16,32,41,46];vs=[]
 for x in stations:
  z=-6.35;w=side_width(x,z);extension=.05 if x in [stations[0],stations[-1]] else .82
  vs.extend([(x,sign*w,z),(x,sign*(w+extension),z-.45),(x,sign*(w+extension),z-.52),(x,sign*w,z-.07)])
 fs=[(i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j) for i in range(len(stations)-1) for j in range(4)]+[(3,2,1,0),tuple(range((len(stations)-1)*4,len(stations)*4))]
 mesh('Closed tapered bilge keel',vs,fs,materials['oxide'],undercol)

for ob in scene.objects:
 if ob.type=='MESH' and not ob.get('assemblyId'):ob['assemblyId']='superstructure' if ob.users_collection[0] in [supercol,detailcol] else 'hull-underwater' if ob.users_collection[0]==undercol else 'hull'
# Inspectable volumes are omitted from the playable export; the game reads the
# identical definition. Existing armor and compartment IDs remain stable.
for a in DEF['armor']:
 if a.get('plate',{}).get('mountId'):continue
 v=[(-z,-x,y) for x,y,z in a['plate']['vertices']]
 ob=mesh(a['name'],v,[tuple(range(len(v)))],materials['oxide'],simcol);ob['exportRole']='simulation';ob.hide_render=True
for c in DEF['compartments']:
 x,y,z=c['center'];sx,sy,sz=c['size'];ob=box(c['name'],(-z,-x,y),(sz,sx,sy),materials['edge'],simcol);ob['exportRole']='simulation';ob.hide_render=True
simcol.hide_render=True;simcol.hide_viewport=True
for name,loc in [('funnel-cap',(-2.6,0,24.3)),('mainmast-top',(-22.5,0,48.5)),('fore-director',(14.2,0,31.1)),('conning-director',(25.0,0,19.55)),('aft-director',(-37.8,0,17.5))]:
 ob=bpy.data.objects.new('landmark.'+name,None);scene.collection.objects.link(ob);ob.location=loc;ob['nodeId']='landmark.'+name
sys.path.insert(0,str(Path(__file__).resolve().parent))
from paint import apply_paint, consolidate_finish_uvs
apply_paint(scene,materials,Path(__file__).with_name('paint-scheme.json'))
OUT.mkdir(parents=True,exist_ok=True)
from blender_rig import create_flagstaffs
create_flagstaffs(DEF)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,dict(materials,**{'baltic-'+key:bpy.data.materials['Baltic sides · '+key] for key in ['hullgray','naval','roof','edge']}),Path(__file__).with_name('appearance.json'))
consolidate_finish_uvs(scene)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('INDEPENDENT BISMARCK SOURCE 1941-04',len(scene.objects),'objects',flush=True)

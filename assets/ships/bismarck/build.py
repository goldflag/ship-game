"""Original Bismarck exterior, 24 May 1941 at the separately stated standard draft.

Version 2 interprets the retained historical plan, archival profile and raster
comparison pack. Blueprint polygons own major placements; this original recipe
owns construction/detail primitives. No source mesh or extracted transforms enter.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
OUT=Path(os.environ['SHIP_OUTPUT']);DEF=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text());H=DEF['hull']
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene['definitionHash']=DEF['contentHash'];scene['authoring']='Original polygon lofts and construction primitives, 1941-02; raster/historical interpretation only'
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
 for a,b in zip(pts,pts[1:]+([pts[0]] if closed else [])):rod(name,a,b,r,mat or materials['edge'],col or detailcol,vertices=vertices)
def rail(name,pts,height=.94,spacing=1.85,closed=True,col=None):
 col=col or detailcol;seq=list(zip(pts,pts[1:]+([pts[0]] if closed else [])))
 for a,b in seq:
  a,b=Vector(a),Vector(b);length=(b-a).length
  for i in range(max(1,math.ceil(length/spacing))):
   p=a+(b-a)*(i/max(1,math.ceil(length/spacing)));rod(name+' stanchion',p,p+Vector((0,0,height)),.026,materials['edge'],col,vertices=5)
  for dz in [height*.38,height*.7,height]:rod(name+' wire',a+Vector((0,0,dz)),b+Vector((0,0,dz)),.014,materials['edge'],col,vertices=5)
def ring(name,center,normal,radius,tube=.035,mat=None,n=20):
 axis=Vector(normal).normalized();u=axis.cross(Vector((0,0,1)))
 if u.length<.1:u=axis.cross(Vector((0,1,0)))
 u.normalize();v=axis.cross(u);c=Vector(center)
 pts=[c+radius*(u*math.cos(math.tau*i/n)+v*math.sin(math.tau*i/n)) for i in range(n)]
 polyline(name,pts,tube,mat or materials['edge'],closed=True,vertices=5)
def porthole(name,center,normal,r=.17):
 c=Vector(center);n=Vector(normal).normalized();rod(name+' dark glazing',c,c+n*.022,r,materials['dark'],detailcol,vertices=14)
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
 box(name+' frame',(x,y,z+height/2),(width+.1,.05,height+.1),materials['edge'],detailcol)
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
  rail(s['id'],[(x,y,top+.025) for x,y in pts],.94,1.55,col=supercol)
  if s['id'] in ['bridge-wings','bridge-admiral-platform','signal-platform','fore-aa-platform','foretop-platform','foretop-roof','aft-director-platform']:
   # Sheet bulwarks and their inclined wind lip break up the repeated open
   # handrails. Leave the after edge open for passage and mast access.
   aft=min(x for x,y in pts)
   for a,b in zip(pts,pts[1:]+pts[:1]):
    if (a[0]+b[0])/2<aft+.9:continue
    normal=Vector((a[1]-b[1],b[0]-a[0],0)).normalized();mid=Vector(((a[0]+b[0])/2,(a[1]+b[1])/2,0))
    if normal.dot(mid-Vector(((aft+max(x for x,y in pts))/2,0,0)))<0:normal=-normal
    vs=[(x,y,zz) for zz in [top+.06,top+.74] for x,y in [a,b]]
    ob=mesh('Gallery splinter bulwark',vs,[(0,1,3,2)],materials['naval'],supercol)
    mod=ob.modifiers.new('Fabricated plate thickness','SOLIDIFY');mod.thickness=.045
    lip=[Vector((x,y,top+.74)) for x,y in [a,b]];mesh('Gallery wind deflector',[tuple(v) for v in lip]+[tuple(v+normal*.13+Vector((0,0,.14))) for v in lip],[(0,1,3,2)],materials['edge'],supercol)
    count=max(1,math.ceil((Vector(b)-Vector(a)).length/1.4))
    for i in range(count):
     p=Vector(a)+(Vector(b)-Vector(a))*((i+.5)/count);rod('Bulwark stiffener',(p.x,p.y,top+.1),(p.x,p.y,top+.70),.025,materials['edge'],supercol,vertices=5)
  # Gallery brackets connect the outer lip to the enclosed central support.
  for x,y in pts:
   if abs(y)>4.3:rod(s['id']+' knee',(x,y,z-.02),(x,y*.56,z-1.2),.07,materials['naval'],supercol,vertices=6)
 else:
  # Steel deck overhang and drainage lip emphasize real deck boundaries.
  extrude(s['id']+' deck lip',[(x*1.001,y*1.012) for x,y in pts],top,.10,materials['roof'],supercol)
  for sign in [-1,1]:
   yy=sign*max(abs(y) for x,y in pts);lo=min(x for x,y in pts)+2.6;hi=max(x for x,y in pts)-2.6
   if hi>lo and s['height']>2.0 and s['id'] not in ['funnel-base','tower-mast-base','bridge-wheelhouse','foretop-control']:
    for x in [lo+i*2.2 for i in range(max(1,int((hi-lo)/2.2)))]:
     yy,normal=house_side(pts,x,sign);porthole(s['id']+' scuttle',Vector((x,yy,top-1.12))+normal*.05,normal,.16)
    xx=(lo+hi)/2;yy,normal=house_side(pts,xx,sign)
    if abs(normal.x)<.15:door(s['id']+' watertight door',xx,yy+sign*.05,z+.13,sign)
# All ten active batteries retain the shared original joint and socket contract.
for mount in DEF['mounts']:create_gun_mount(mount,gunscol,helpers,materials,deckz)
# Additional original gunhouse fabrication and service fittings follow yaw.
for mount in DEF['mounts']:
 yaw=bpy.data.objects[mount['id']+'.yaw'];w=mount['weapon'];L,W,T=w['gunhouseSize'];primary=w['caliberM']>.2
 def mounted(ob):ob.parent=yaw;ob.matrix_parent_inverse=Matrix.Identity(4);ob['assemblyId']=mount['id'];return ob
 for sign in [-1,1]:
  if not primary:mounted(box('Gunhouse side access',(-L*.14,sign*(W*.48),T*.46),(.6,.07,.65),materials['edge'],gunscol))
  for xx in [-L*.33,-L*.07,L*.17]:mounted(box('Gunhouse side drain',(xx,sign*W*.49,T*.2),(.27,.06,.09),materials['dark'],gunscol))
  # Rear access ladders and hatches, placed inside the original roof footprint.
  for zz in [T*.22+i*.28 for i in range(int(T*.65/.28))]:
   rearx=-8.55+max(0,zz-2.1)*(1.65/1.55) if primary else -L*.46
   mounted(rod('Gunhouse rear rung',(rearx,sign*W*.2-.25,zz),(rearx,sign*W*.2+.25,zz),.024,materials['edge'],gunscol,vertices=6))
  mounted(box('Gunhouse roof access',(-L*.26,sign*W*.22,T+.11),(1.0 if primary else .55,.76 if primary else .42,.12),materials['naval'],gunscol))
 if primary:
  for yy in [-2.65,0,2.65]:
   mounted(box('Gunhouse roof plate seam',(-1.95,yy,T+.017),(8.7,.025,.025),materials['edge'],gunscol))
   mounted(cyl('Gunhouse roof sight',(-3.7,yy,T+.25),.18,.35,materials['naval'],gunscol,16))
  for yy in [-1.2,1.2]:mounted(box('Rear ventilation hood',(-8.5,yy,1.3),(.26,.68,.84),materials['naval'],gunscol))
  for sign in [-1,1]:
   # Side ladders, covered sight slots and plate seams are on the sloped side
   # surface, with every new piece carried by the original yaw parent.
   def side_y(zz):return sign*(4.35-max(0,zz-2.10)/1.55+.045)
   for zz in [.50+i*.28 for i in range(12)]:mounted(rod('Main gunhouse side ladder',(-3.35,side_y(zz),zz),(-2.82,side_y(zz),zz),.025,materials['edge'],gunscol,vertices=6))
   for xx in [-3.35,-2.82]:
    for za,zb in [(.4,2.1),(2.1,3.6)]:mounted(rod('Main gunhouse ladder stringer',(xx,side_y(za),za),(xx,side_y(zb),zb),.032,materials['naval'],gunscol,vertices=6))
   cover=rounded_rect(-5.15,2.85,2.7,.84,.32,5);ncover=len(cover)
   vs=[(xx,side_y(zz)+sign*offset,zz) for offset in [0,.09] for xx,zz in cover]
   fs=[tuple(range(ncover,2*ncover))]+[(i,(i+1)%ncover,(i+1)%ncover+ncover,i+ncover) for i in range(ncover)]
   mounted(mesh('Gunhouse side optical cover',vs,fs,materials['naval'],gunscol))
   mounted(rod('Gunhouse side plate joint',(-6.9,side_y(2.1),2.1),(3.0,side_y(2.1),2.1),.022,materials['edge'],gunscol,vertices=6))
  for side in ['left','right']:
   parent=bpy.data.objects[mount['id']+'.'+side+'.recoil'];vs=[];n=24
   rings=[(1.0,.90),(1.3,1.02),(1.9,.89),(2.5,.70),(3.1,.55),(3.6,.44)]
   for xx,rr in rings:
    for i in range(n):
     a=math.tau*i/n;wrinkle=1+.04*math.cos(a*6+xx*7);vs.append((xx,rr*math.cos(a)*wrinkle,rr*.92*math.sin(a)*wrinkle))
   boot=mesh('Main gun pleated blast bag',vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)],materials['canvas'],gunscol,True)
   boot.parent=parent;boot.matrix_parent_inverse=Matrix.Identity(4);boot['assemblyId']=mount['id']
# Continuous glazed wheelhouse and foretop windows, with structural mullions.
for name,front,half,z,height in [('bridge',30.55,4.3,16.0,.85),('foretop',17.25,3.25,27.0,.75)]:
 for yy in [i*1.03 for i in range(-int(half),int(half)+1)]:
  box(name+' window frame',(front,yy,z+height/2),(.07,.89,height+.12),materials['edge'],detailcol)
  box(name+' glazing',(front+.043,yy,z+height/2),(.023,.76,height),materials['glass'],detailcol)
 for sign in [-1,1]:
  for x in ([22,23.5,25,26.5,28] if name=='bridge' else [11.4,12.8,14.2,15.6]):
   box(name+' side glass',(x,sign*(5.22 if name=='bridge' else 4.23),z+height/2),(.9,.035,height),materials['glass'],detailcol)
# Deckhouse equipment and stairs read at normal harbor inspection distances.
for sign in [-1,1]:
 for x in [12,18,32,39]:
  pts=[(-z,-x) for x,z in structures['forward-battery-deck']['footprint']];y,_=house_side(pts,x,sign);vent('Forward intake',(x,y+sign*.08,7.15),(1.2,.23,1.05),sign)
 for x in [-47,-42,-34]:vent('Aft intake',(x,sign*8.8,7.05),(1.15,.25,1.0),sign)
 stairs('Forward exterior stair',(39.5,sign*7.95,5.9),(36.0,sign*7.95,9.38))
 stairs('Bridge stair',(35.4,sign*6.7,9.4),(32.8,sign*6.7,12.63))
 stairs('Upper bridge stair',(21.5,sign*6.1,12.6),(18.6,sign*6.1,15.5))
 stairs('Aft deck stair',(-46,sign*8.5,5.85),(-42.6,sign*8.5,9.28))
 stairs('Aft control stair',(-41.6,sign*6.5,9.3),(-38.5,sign*6.5,12.5))
 for x in [13,37]:
  pipe=[(x,sign*9.1,5.8),(x,sign*9.1,8.1),(x+.5,sign*9.1,8.6),(x+1.8,sign*9.1,8.6)];polyline('Ventilation pipe',pipe,.11,materials['naval'],vertices=10)
 for zz,xx,yy in [(21.0,12.0,3.6),(24,13.0,3.6),(27.0,12.0,4.25)]:
  box('Tower equipment locker',(xx,sign*yy,zz),(.8,.35,.95),materials['edge'],detailcol)
 ladder('Foretower access',(10.1,sign*3.6,18.5),(10.1,sign*3.6,28.7),.52)
 # Lower tower access and exterior services meet the supporting shelter deck.
 ladder('Lower foretower access',(10.05,sign*2.4,9.4),(10.05,sign*2.4,20.5),.52)
 for zz in [15.9,19.1]:
  box('Tower service cabinet',(13.9,sign*3.55,zz),(1.35,.32,.86),materials['edge'],detailcol)
  box('Tower cabinet inset',(13.9,sign*3.73,zz),(1.10,.06,.61),materials['naval'],detailcol)
 polyline('Tower external cable conduit',[(16.2,sign*3.55,12.7),(16.2,sign*3.55,18.6),(15.1,sign*3.55,19.2),(15.1,sign*3.3,23.0)],.042,materials['edge'],vertices=8)
# Funnel jacket and forward-rising cap: a deliberately authored rounded oblong,
# with internal lip, collars, stays, steam pipes and multiple searchlight galleries.
fx=-2.4;N=64
verts=[(-z,-x,y) for x,y,z in structures['funnel-jacket']['surface']['vertices']]
outer=verts[-N:];inner=[(fx+(x-fx)*.905,y*.86,z-.08) for x,y,z in outer]
mesh('Funnel cap thickness',outer+inner,[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['edge'],supercol)
mesh('Funnel inner wall',inner+[(x,y,z-1.4) for x,y,z in inner],[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['dark'],supercol)
mesh('Recessed uptake darkness',[(x,y,z-1.36) for x,y,z in inner],[tuple(reversed(range(N)))],materials['dark'],supercol)
polyline('Funnel cap rolled lip',outer,.06,materials['light'],supercol,True,8)
for yy in [-2.8,-1.4,0,1.4,2.8]:rod('Funnel opening grate',(fx-4.8,yy,24.0),(fx+4.8,yy,25.8),.055,materials['edge'],supercol,vertices=8)
for xx in [-6.3,-4.3,-2.3,-.3,1.7]:rod('Funnel grate crossbar',(xx,-3.0,24.5+(xx-fx)*.19),(xx,3.0,24.5+(xx-fx)*.19),.055,materials['edge'],supercol,vertices=8)
for zz in [12.25,16.5,19.1,22.8]:
 pts=[(fx+5.65*math.cos(math.tau*i/48),3.56*math.sin(math.tau*i/48),zz) for i in range(48)];polyline('Funnel plating collar',pts,.045,materials['edge'],supercol,True)
for i in range(20):
 a=math.tau*i/20;x=fx+5.93*math.cos(a);y=3.72*math.sin(a);z=23.63+.2*math.cos(a)
 box('Cap ventilation slit',(x,y,z),(.21,.19,.48),materials['dark'],supercol)
 box('Cap ventilation cowl',(x,y,z+.30),(.32,.27,.14),materials['naval'],supercol)
for sign in [-1,1]:
 for zz,length,w in [(14.1,12.5,1.05),(17.65,13.2,1.6),(20.1,12.0,1.3)]:
  yy=sign*(3.65+w/2);pts=rounded_rect(fx-.2,yy,length,w,.45,3);extrude('Funnel gallery',pts,zz,.18,materials['roof'],supercol)
  rail('Funnel gallery',[(x,y,zz+.18) for x,y in pts],.88,1.5,col=supercol)
  for xx in [-6,-3,0,2]:rod('Funnel gallery knee',(xx,yy+sign*w*.45,zz),(xx,sign*3.0,zz-1.05),.065,materials['naval'],supercol,vertices=6)
 for xx in [-6.4,-5.9,-5.4]:
  polyline('Funnel steam pipe',[(xx,sign*3.2,9.3),(xx,sign*3.2,20.4),(xx+.3,sign*3.45,22.5),(xx+.5,sign*3.45,23.4)],.065,materials['light'],supercol,vertices=8)
 stairs('Funnel gallery access',(fx-4,sign*4.45,14.3),(fx-.3,sign*4.45,17.83),.7)
 ladder('Funnel upper ladder',(fx-5.8,sign*3.9,17.9),(fx-5.8,sign*3.9,23.4),.46)
 for xx in [-5.7,0.5]:vent('Funnel lower uptake grille',(xx,sign*5.04,9.6),(1.75,.12,1.5),sign)
# Deck-to-director supports prevent the floating equipment in iteration 1.
conning=extrude('Armored forward conning tower',rounded_rect(28.4,0,5.8,5.6,2.0,6),15.47,3.0,materials['naval'],supercol)
for yy in [-1.8,-.9,0,.9,1.8]:box('Conning vision slit',(31.28,yy,17.7),(.035,.56,.15),materials['dark'],detailcol)
for sign in [-1,1]:
 for xx in [26.7,28.0,29.3]:box('Conning side slit',(xx,sign*2.79,17.7),(.65,.035,.15),materials['dark'],detailcol)
rail('Conning roof',[(x,y,18.54) for x,y in rounded_rect(28.4,0,6.1,5.9,2.0,5)],.75,1.5)
def director(name,x,z,span,base):
 # Center of optical axis is z; each pedestal physically spans the supporting roof.
 cyl(name+' support column',(x,0,(base+z-.75)/2),1.55,max(.12,z-.75-base),materials['naval'],detailcol,32)
 cyl(name+' mounting ring',(x,0,z-.67),2.0,.20,materials['edge'],detailcol,40)
 pts=rounded_rect(x,0,3.3,3.7,1.2,5);extrude(name+' armored hood',pts,z-.56,1.28,materials['naval'],detailcol)
 extrude(name+' sloped crown',rounded_rect(x,0,3.1,3.5,1.15,5),z+.72,.2,materials['roof'],detailcol)
 rod(name+' optical tube',(x,-span/2,z),(x,span/2,z),.29,materials['naval'],detailcol,vertices=24)
 for sign in [-1,1]:
  extrude(name+' optical end hood',rounded_rect(x,sign*(span/2-.32),1.1,.85,.22,3),z-.45,.95,materials['naval'],detailcol)
  rod(name+' optic',(x+.55,sign*(span/2-.32),z),(x+.59,sign*(span/2-.32),z),.17,materials['dark'],detailcol,vertices=16)
 # FuMO mattress aerial on a real elevation frame, not disconnected wires.
 radarx=x+.65;radarz=z+1.9
 box(name+' radar back frame',(radarx,0,radarz),(.15,4.2,1.7),materials['edge'],detailcol)
 box(name+' radar recessed face',(radarx+.082,0,radarz),(.026,3.98,1.52),materials['dark'],detailcol)
 for yy in [-2.05+i*.41 for i in range(11)]:rod(name+' radar vertical',(radarx+.105,yy,radarz-.8),(radarx+.105,yy,radarz+.8),.017,materials['light'],detailcol,vertices=5)
 for dz in [-.78,-.39,0,.39,.78]:rod(name+' radar horizontal',(radarx+.12,-2.1,radarz+dz),(radarx+.12,2.1,radarz+dz),.02,materials['light'],detailcol,vertices=5)
 for yy in [-1.2,1.2]:rod(name+' radar support',(x,yy,z+.65),(radarx,yy,radarz-.5),.055,materials['edge'],detailcol,vertices=6)
 rod(name+' aerial',(x-.5,0,z+.9),(x-.5,0,z+3.25),.024,materials['edge'],detailcol,vertices=6)
director('Fore main director',13.4,32.0,10.5,29.21)
director('Conning director',27.6,20.6,7.0,18.48)
director('Aft main director',-37.8,17.5,10.5,16.2)
# Enclosed AA directors with the characteristic rounded weather covers.
def aa_director(name,x,y,z,base):
 cyl(name+' column',(x,y,(base+z-1.3)/2),1.0,max(.2,z-1.3-base),materials['naval'],detailcol,24)
 cyl(name+' ring',(x,y,z-1.0),1.65,.22,materials['edge'],detailcol,32)
 vs=[];latitudes=[(-1.05,1.55),(-.35,1.8),(.45,1.78),(1.25,1.36),(1.75,.5),(1.82,0)]
 for zz,r in latitudes:
  vs.extend((x+1.25*r*math.cos(math.tau*i/28),y+r*math.sin(math.tau*i/28),z+zz) for i in range(28))
 fs=[(j*28+i,j*28+(i+1)%28,(j+1)*28+(i+1)%28,(j+1)*28+i) for j in range(len(latitudes)-1) for i in range(28)]
 mesh(name+' weather dome',vs,fs,materials['naval'],detailcol,True)
 rod(name+' transverse optics',(x,y-2.0,z),(x,y+2.0,z),.42,materials['edge'],detailcol,vertices=24)
 for sign in [-1,1]:rod(name+' optical cap',(x,y+sign*2.0,z),(x,y+sign*2.035,z),.36,materials['dark'],detailcol,vertices=20)
 for zz in [-.45,.55]:polyline(name+' cover seam',[(x+2.0*math.cos(math.tau*i/28),y+1.63*math.sin(math.tau*i/28),z+zz) for i in range(28)],.02,materials['edge'],closed=True)
for sign in [-1,1]:
 aa_director('Forward AA director',15.8,sign*6.5,17.6,12.7)
 aa_director('Funnel AA director',.2,sign*5.35,21.1,17.83)
# Searchlights with glazed recessed faces, yokes and pedestals.
def searchlight(name,x,y,z,bearing):
 axis=Vector((math.cos(bearing),math.sin(bearing),.12)).normalized();c=Vector((x,y,z+1.05))
 cyl(name+' pedestal',(x,y,z+.32),.28,.64,materials['naval'],detailcol,16)
 side=Vector((-axis.y,axis.x,0))*.7
 for sign in [-1,1]:rod(name+' yoke',Vector((x,y,z+.5))+sign*side,c+sign*side,.09,materials['edge'],detailcol,vertices=8)
 rod(name+' drum',c-axis*.45,c+axis*.38,.66,materials['naval'],detailcol,vertices=28)
 rod(name+' lens',c+axis*.39,c+axis*.405,.57,materials['glass'],detailcol,vertices=24)
 ring(name+' lens rim',c+axis*.42,axis,.66,.055,materials['light'],24)
 rod(name+' shutter brace',c+axis*.44+side*.6,c+axis*.44-side*.6,.025,materials['edge'],detailcol,vertices=6)
for sign in [-1,1]:
 searchlight('Foretop 1.5 m searchlight',18.5,sign*5.1,23.46,sign*.75)
 searchlight('Funnel searchlight',-7.7,sign*4.65,17.86,sign*2.15)
 searchlight('Aft searchlight',-34.8,sign*4.8,12.52,sign*2.5)
searchlight('Funnel aft searchlight',-8.4,0,17.9,math.pi)
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
 if name=='mainmast':
  cyl('Mainmast lookout platform',(x-.1,0,30.1),1.5,.16,materials['roof'],detailcol,24)
  rail('Mainmast lookout',[(px,py,30.18) for px,py in ellipse(x-.1,0,1.5,1.5,16)],.8,1.3)
  box('Mainmast enclosed lookout',(x-.1,0,28.9),(1.8,1.6,2.2),materials['naval'],detailcol)
  for sign in [-1,1]:box('Lookout window',(x-.1,sign*.81,29.5),(.95,.025,.55),materials['glass'],detailcol)
for yy in [-.38,.38]:
 a=Vector((5.9,yy,40.0));b=Vector((-22.5,yy,48.0));pts=[a+(b-a)*(i/16)-Vector((0,0,1.15*math.sin(math.pi*i/16))) for i in range(17)];polyline('Aerial span',pts,.015,materials['dark'],vertices=5)
# Stern flagstaff, bow jackstaff and rigged stern boat-handling derrick.
for x,top in [(-123,15.5),(124,11.5)]:rod('Ensign or jack staff',(x,0,deckz(x)),(x-.3,0,top),.08,materials['edge'],detailcol,.025,10)
rod('After derrick post',(-43,0,12.5),(-43,0,26.8),.13,materials['edge'],detailcol,.05,12)
rod('After derrick boom',(-43,0,16.0),(-48,0,21.5),.09,materials['edge'],detailcol,vertices=10)
rod('After derrick cable',(-43,0,26.5),(-48,0,21.5),.018,materials['dark'],detailcol,vertices=5)
# Aircraft hangars: the roof curvature and folding door leaves are visible in
# the retained May plan. Dimensions below are independent raster estimates.
for name,x,y,length,breadth,base in [('Port single hangar',8.8,6.7,11.8,5.5,10.39),('Starboard single hangar',8.8,-6.7,11.8,5.5,10.39),('Double hangar',-24.6,0,12.8,14.2,10.85)]:
 rise=.85 if breadth<7 else 1.12
 arc=[(y+breadth*(i/16-.5),base+rise*math.sin(math.pi*i/16)) for i in range(17)]
 roofvs=[(xx,yy,zz) for xx in [x-length/2,x+length/2] for yy,zz in arc]
 mesh(name+' curved roof',roofvs,[(i,i+1,i+18,i+17) for i in range(16)]+[tuple(reversed(range(17))),tuple(range(17,34))],materials['roof'],supercol,True)
 for xx in [x-length/2+.15,x,x+length/2-.15]:polyline(name+' roof seam',[(xx,yy,zz+.025) for yy,zz in arc],.028,materials['edge'])
 # The double hangar opens forward; the side hangars open aft onto handling deck.
 xx=x+(length/2+.035)*(1 if breadth>7 else -1);floor=5.84;doorheight=4.4
 leaves=12 if breadth>7 else 6;opening=breadth-.65
 for i in range(leaves):
  yy=y-opening/2+opening*(i+.5)/leaves
  box(name+' folding door',(xx,yy,floor+doorheight/2),(.10,opening/leaves-.035,doorheight),materials['naval'],detailcol)
  for dz in [.65,2.1,3.55]:box(name+' door stiffener',(xx+(.065 if breadth>7 else -.065),yy,floor+dz),(.07,opening/leaves-.13,.055),materials['edge'],detailcol)
 rod(name+' door track',(xx,y-opening/2-.1,floor+doorheight+.1),(xx,y+opening/2+.1,floor+doorheight+.1),.075,materials['edge'],detailcol,vertices=8)
 for sign in [-1,1]:vent(name+' ventilation',(x, y+sign*(breadth/2+.035),8.35),(1.8,.12,1.1),sign)
# An aft cross-gallery carries the center searchlight and joins the side galleries.
extrude('Funnel aft cross gallery',rounded_rect(-8.15,0,2.3,9.7,.4,3),17.65,.18,materials['roof'],supercol)
rail('Funnel aft cross gallery',[(-9.28,-4.4,17.83),(-9.28,4.4,17.83)],.88,1.6,False)
for sign in [-1,1]:rod('Cross gallery bracket',(-9.1,sign*3,17.63),(-7.4,sign*3,16.1),.075,materials['naval'],supercol,vertices=6)

def boat(name,x,y,z,length,breadth,cabin=False):
 # A closed shell, recessed cockpit and separately modeled gunwale. The boats
 # are cradled above their supporting roofs rather than flat floating polygons.
 stations=[(-.5,.10,.34),(-.42,.74,.08),(-.24,.98,0),(.08,1.0,0),(.30,.83,.08),(.43,.46,.28),(.50,0,.52)]
 vs=[];ringcount=8;depth=breadth*.43
 for t,w,sheer in stations:
  xx=x+t*length;half=w*breadth/2
  vs.extend([(xx,y,z+sheer),(xx,y+half*.58,z+.14+sheer),(xx,y+half*.90,z+depth*.57+sheer),(xx,y+half,z+depth+sheer),(xx,y-half,z+depth+sheer),(xx,y-half*.90,z+depth*.57+sheer),(xx,y-half*.58,z+.14+sheer),(xx,y,z+sheer)])
 fs=[(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i) for j in range(len(stations)-1) for i in [0,1,2,4,5,6]]
 fs.extend([tuple(reversed(range(8))),tuple(range((len(stations)-1)*8,len(stations)*8))])
 mesh(name+' hull shell',vs,fs,materials['naval'] if cabin else materials['wood'],detailcol,True)
 gunwale=[(x+t*length,y+w*breadth/2,z+depth+sheer) for t,w,sheer in stations]+[(x+t*length,y-w*breadth/2,z+depth+sheer) for t,w,sheer in reversed(stations)]
 polyline(name+' gunwale',gunwale,.075,materials['light'],closed=True,vertices=8)
 floor=rounded_rect(x-length*.02,y,length*.68,breadth*.68,.35,4);extrude(name+' cockpit floor',floor,z+depth*.51,.07,materials['wood'],detailcol)
 for xx in [-.28,-.12,.08,.25]:box(name+' thwart',(x+length*xx,y,z+depth*.78),(.23,breadth*.72,.10),materials['deck'],detailcol)
 for xx in [-.27,.25]:
  box(name+' cradle',(x+length*xx,y,z-.19),(.22,breadth*.78,.32),materials['edge'],detailcol)
  for sign in [-1,1]:rod(name+' cradle arm',(x+length*xx,y,z-.22),(x+length*xx,y+sign*breadth*.45,z+depth*.4),.065,materials['edge'],detailcol,vertices=6)
 if cabin:
  extrude(name+' engine deck',rounded_rect(x-length*.17,y,length*.35,breadth*.81,.3,3),z+depth*.80,.21,materials['deck'],detailcol)
  cabx=x+length*.08;cabz=z+depth+.50
  box(name+' cabin',(cabx,y,cabz),(length*.32,breadth*.70,1.14),materials['naval'],detailcol)
  box(name+' cabin roof',(cabx,y,cabz+.61),(length*.34,breadth*.76,.12),materials['canvas'],detailcol)
  for sign in [-1,1]:
   for xx in [-.095,.035,.14]:box(name+' cabin side light',(cabx+length*xx,y+sign*breadth*.354,cabz+.2),(length*.08,.035,.48),materials['glass'],detailcol)
   box(name+' windscreen',(cabx+length*.162,y+sign*breadth*.18,cabz+.2),(.035,breadth*.24,.5),materials['glass'],detailcol)
  rod(name+' short boat mast',(cabx,y,cabz+.67),(cabx,y,cabz+1.8),.032,materials['edge'],detailcol,vertices=6)
 else:
  for sign in [-1,1]:rod(name+' stored oar',(x-length*.31,y+sign*breadth*.21,z+depth+.11),(x+length*.24,y+sign*breadth*.21,z+depth+.11),.03,materials['wood'],detailcol,vertices=6)
for sign in [-1,1]:
 boat('Forward motor launch',11.7,sign*6.7,11.52,11.1,2.75,True)
 boat('Aft motor launch',-24.3,sign*5.2,12.32,11.7,2.85,True)
 boat('Aft cutter',-25.3,sign*1.85,12.35,9.2,2.45,False)
 # A smaller dinghy is carried above the aft boat deck clear of the mainmast.
 boat('After dinghy',-33.1,sign*6.9,9.56,7.6,2.05,False)

def truss(name,a,b,width,depth):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=axis.cross(Vector((0,0,1))).normalized()*width/2;up=axis.cross(side).normalized()*depth/2
 corners=[side+up,-side+up,-side-up,side-up]
 for offset in corners:rod(name+' chord',a+offset,b+offset,.055,materials['edge'],detailcol,vertices=8)
 bays=max(3,math.ceil((b-a).length/1.6))
 for i in range(bays):
  lo=a+(b-a)*(i/bays);hi=a+(b-a)*((i+1)/bays)
  for j in range(4):
   k=(j+1)%4;rod(name+' cross member',lo+corners[j],lo+corners[k],.035,materials['naval'],detailcol,vertices=6)
   rod(name+' diagonal',lo+corners[j if i%2==0 else k],hi+corners[k if i%2==0 else j],.03,materials['naval'],detailcol,vertices=6)
for sign in [-1,1]:
 base=Vector((-6.5,sign*9.7,deckz(-6.5)));heel=base+Vector((0,0,2.2));tip=Vector((7.2,sign*6.6,22.0))
 cyl('Aircraft crane foundation',base+Vector((0,0,.28)),1.05,.56,materials['edge'],detailcol,32)
 cyl('Aircraft crane pedestal',base+Vector((0,0,1.4)),.78,2.45,materials['naval'],detailcol,32)
 cyl('Aircraft crane bearing',heel,1.04,.27,materials['edge'],detailcol,32)
 box('Aircraft crane winch housing',heel+Vector((-.65,0,.75)),(2.4,1.7,1.55),materials['naval'],detailcol)
 box('Aircraft crane operator window',heel+Vector((-.4,sign*.862,.94)),(1.1,.035,.55),materials['glass'],detailcol)
 truss('Aircraft crane lattice boom',heel,tip,.95,1.05)
 apex=heel+Vector((-.9,0,4.5));truss('Aircraft crane kingpost',heel+Vector((-1,0,.5)),apex,.65,.65)
 for off in [-.28,.28]:
  rod('Crane topping cable',apex+Vector((0,off,0)),tip+Vector((0,off,0)),.021,materials['dark'],detailcol,vertices=6)
  rod('Crane hoisting cable',heel+Vector((-.6,off,1.8)),tip+Vector((0,off,-.13)),.018,materials['dark'],detailcol,vertices=5)
 rod('Crane suspended cable',tip,tip-Vector((0,0,1.85)),.024,materials['dark'],detailcol,vertices=6)
 ring('Crane sheave',tip,(0,1,0),.19,.045,materials['edge'],16)
 ring('Crane hook',tip-Vector((0,0,1.98)),(0,1,0),.14,.035,materials['edge'],12)
 ladder('Crane pedestal access',base+Vector((-.88,0,.1)),heel+Vector((-.88,0,.5)),.48)
# Transverse catapult with two rails, open web and launch trolley.
for xx in [-9.9,-8.2]:
 rod('Catapult longitudinal rail',(xx,-14,6.82),(xx,14,6.82),.09,materials['light'],detailcol,vertices=8)
 box('Catapult girder',(xx,0,6.43),(.17,28,.48),materials['edge'],detailcol)
 for yy in [-13+i*1.3 for i in range(21)]:
  rod('Catapult web',(xx,yy-.58,6.23),(xx,yy+.58,6.69),.04,materials['naval'],detailcol,vertices=6)
for yy in [-13.5,-9,-4.5,0,4.5,9,13.5]:box('Catapult sleeper',(-9.05,yy,6.45),(2.18,.22,.22),materials['naval'],detailcol)
box('Catapult trolley',(-9.05,0,7.0),(2.35,2.3,.24),materials['roof'],detailcol)
for yy in [-.9,.9]:
 for xx in [-9.9,-8.2]:rod('Trolley wheel',(xx-.10,yy,6.92),(xx+.10,yy,6.92),.20,materials['edge'],detailcol,vertices=16)

# The light batteries are original visual fittings, separate from the ten CPU
# controlled main/secondary mount contracts. Fit counts follow kb-armament.
def aa_mount(name,x,y,z,caliber,bearing=0,quad=False):
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
    box(name+' sponson deck',(x,(inner+outer)/2,z-.11),(2*r,abs(outer-inner),.16),materials['roof'],detailcol)
    for dx in [-r*.64,r*.64]:rod(name+' sponson knee',(x+dx,outer-sign*.08,z-.19),(x+dx,wall-sign*.2,top-1.05),.065,materials['naval'],detailcol,vertices=8)
 before=set(bpy.data.objects);heavy=caliber>.08;medium=caliber>.025
 radius=1.50 if heavy else .76 if medium or quad else .42
 cyl(name+' deck ring',(0,0,.10),radius,.2,materials['edge'],detailcol,28)
 cyl(name+' pedestal',(0,0,.53),radius*.48,.86,materials['naval'],detailcol,20)
 axisz=1.63 if heavy else 1.30;length=4.70 if heavy else 2.22 if medium else 1.45
 if heavy:
  # Open-backed sloped shield, rather than a solid rectangular box.
  cross=[(-1.25,.58),(1.28,.58),(1.17,1.95),(.63,2.44),(-1.12,2.44)]
  vs=[(xx,yy,zz) for yy in [-1.47,1.47] for xx,zz in cross]
  mesh(name+' side shield',vs,[(0,1,2,3,4),(5,9,8,7,6),(1,6,7,2),(2,7,8,3),(3,8,9,4)],materials['naval'],detailcol)
  for yy in [-1.05,1.05]:box(name+' loading deck',(-.3,yy,.50),(2.3,.64,.13),materials['roof'],detailcol)
 count=4 if quad else 2 if heavy or medium else 1
 for i in range(count):
  yy=(i%2-.5)*(.80 if heavy else .55) if count>1 else 0;zz=axisz+(i//2)*.34
  elev=.18 if heavy else .40 if quad else .28;start=Vector((.12,yy,zz));direction=Vector((math.cos(elev),0,math.sin(elev)))
  rod(name+' receiver',start-direction*.8,start+direction*.5,.21 if heavy else .10,materials['naval'],detailcol,vertices=12)
  rod(name+' tapered barrel',start+direction*.3,start+direction*length,caliber*.78,materials['edge'],detailcol,caliber*.46,12)
  rod(name+' muzzle opening',start+direction*(length+.002),start+direction*(length+.035),caliber*.35,materials['dark'],detailcol,vertices=12)
  rod(name+' recoil cylinder',start+Vector((0,0,-.24)),start+direction*1.05+Vector((0,0,-.24)),.105 if heavy else .048,materials['naval'],detailcol,vertices=10)
  if not heavy:box(name+' feed magazine',tuple(start+Vector((-.22,0,.21))),(.32,.24,.25),materials['dark'],detailcol)
 for sign in [-1,1]:
  rod(name+' trunnion',(0,sign*.45,.65),(0,sign*.45,axisz),.14 if heavy else .075,materials['naval'],detailcol,vertices=10)
  cyl(name+' crew seat',(-.65,sign*(1.04 if heavy else .55),.72),.23,.11,materials['roof'],detailcol,16)
  rod(name+' seat support',(-.65,sign*(1.04 if heavy else .55),.2),(-.65,sign*(1.04 if heavy else .55),.68),.05,materials['edge'],detailcol,vertices=6)
  ring(name+' handwheel',(-.34,sign*(.83 if heavy else .45),1.14),(0,1,0),.22 if heavy else .13,.025,n=14)
 rod(name+' sight bracket',(-.35,0,axisz),(-.35,0,axisz+.5),.035,materials['edge'],detailcol,vertices=6)
 ring(name+' ring sight',(-.35,0,axisz+.54),(1,0,0),.11,.015,n=12)
 # One parent makes every local feature share placement and orientation.
 pivot=bpy.data.objects.new(name+' visual mount',None);detailcol.objects.link(pivot);pivot.location=(x,y,z);pivot.rotation_euler.z=bearing
 for ob in set(bpy.data.objects)-before-{pivot}:ob.parent=pivot;ob.matrix_parent_inverse=Matrix.Identity(4)
for sign in [-1,1]:
 for x,y in [(20,12.15),(.1,11.6),(-16.0,11.6),(-32.0,10.35)]:aa_mount('Twin 10.5 cm',x,sign*y,deckz(x)+.12,.105)
 for x,y,z in [(39.0,7.8,9.4),(16.5,8.1,12.65),(-37.6,7.4,9.4),(-49.0,6.7,9.4)]:aa_mount('Twin 3.7 cm',x,sign*y,z,.037,bearing=sign*.65)
 for x,y,z in [(42.5,5.5,9.4),(29.1,7.2,12.66),(22.7,8.65,15.6),(11.3,5.8,20.92),(-35.0,5.0,12.65),(-46.1,6.8,9.4)]:aa_mount('Single 2 cm',x,sign*y,z,.020,bearing=sign*.95)
 aa_mount('Quad 2 cm April 1941 fit',13.2,sign*6.05,26.46,.020,bearing=sign*.82,quad=True)

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
  yy=sign*(width(x)-1.25);bollard('Double mooring bitt',x,yy,deckz(x)+.03)
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
 capstan('After mooring capstan',-111,sign*2.4,deckz(-111)+.04,.47)
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
for x,y in [(83,0),(91,0),(112,0),(120,0),(-91,0),(-101,0),(-115,0),(57,8),(57,-8),(-64,8),(-64,-8),(1,14),(1,-14),(-47,12),(-47,-12)]:hatch('Weather deck hatch',x,y,deckz(x)+.03,1.35,.95)
for sign in [-1,1]:
 for x in [-103,-87,-52,48,61,86,113]:
  y=sign*min(width(x)-2.2,7.8);z=deckz(x)
  cyl('Mushroom vent stem',(x,y,z+.32),.18,.64,materials['naval'],detailcol,16)
  cyl('Mushroom vent hood',(x,y,z+.69),.34,.22,materials['naval'],detailcol,20)
 for x,y,z in [(30,9,9.4),(6,13,5.8),(-14,13,5.8),(-40,9.5,5.8),(-53,8.5,5.8)]:
  y*=sign;box('Ready ammunition locker',(x,y,z+.62),(1.05,.64,1.24),materials['naval'],detailcol)
  box('Ammunition locker lid',(x,y,z+1.28),(1.1,.69,.08),materials['roof'],detailcol)
  rod('Locker handle',(x-.12,y+sign*.34,z+.8),(x+.12,y+sign*.34,z+.8),.022,materials['dark'],detailcol,vertices=6)
 for x,y,z in [(36,4.9,12.65),(7,8.8,11.0),(-34,7.7,9.4),(-42,7.9,9.4)]:
  y*=sign;pts=[(xx,yy,z+.3) for xx,yy in rounded_rect(x,y,2.55,1.28,.56,5)];polyline('Carley float buoyant tube',pts,.17,materials['canvas'],closed=True,vertices=8)
  for xx in [-.85,-.45,0,.45,.85]:rod('Carley float floor',(x+xx,y-.46,z+.22),(x+xx,y+.46,z+.22),.033,materials['wood'],detailcol,vertices=6)
  for xx in [-.75,.75]:box('Carley float cradle',(x+xx,y,z+.025),(.12,1.12,.22),materials['edge'],detailcol)
 for x,y in [(80,5),(-97,5)]:
  y*=sign;z=deckz(x)+.55
  rod('Hose reel axle',(x,y-.55,z),(x,y+.55,z),.11,materials['edge'],detailcol,vertices=12)
  for yy in [-.38,.38]:rod('Hose reel flange',(x,y+yy-.035,z),(x,y+yy+.035,z),.53,materials['edge'],detailcol,vertices=24)
  rod('Hose drum',(x,y-.34,z),(x,y+.34,z),.37,materials['rope'],detailcol,vertices=24)
  for yy in [-.45,.45]:box('Reel support',(x,y+yy,z-.30),(.18,.12,.55),materials['naval'],detailcol)

# Three propellers with twisted, thick blades; independently authored original
# shapes. Shaft exits and foil-section rudders remain approximate below water.
for y,xend in [(-5,-103),(0,-108),(5,-103)]:
 rod('Propeller shaft',(-69,y,-7.0),(xend,y,-4.8),.23,materials['edge'],undercol,vertices=20)
 rod('Propeller boss',(xend+1.3,y,-4.8),(xend-.95,y,-4.8),.65,materials['bronze'],undercol,.35,32)
 for sign in [-1,1]:rod('Shaft A bracket',(xend+3,y,-4.9),(xend+3.5,y+sign*1.6,-2.6),.12,materials['oxide'],undercol,vertices=10)
 for angle in [0,math.tau/3,2*math.tau/3]:
  vs=[];rows=[(.48,.0,.25),(.9,.10,.55),(1.5,.19,.78),(2.05,.31,.73),(2.35,.46,.22),(2.4,.52,0)]
  for thickness in [-.035,.035]:
   for r,sweep,w in rows:
    for q in [-1,-.5,0,.5,1]:
     a=angle+sweep+q*w/max(r,1)*.6;pitch=.45*q*(1-r/3)
     vs.append((xend+pitch+thickness,y+r*math.cos(a),-4.8+r*math.sin(a)))
  n=len(rows)*5;fs=[]
  for face in [0,1]:
   for j in range(len(rows)-1):
    for i in range(4):
     ids=(face*n+j*5+i,face*n+j*5+i+1,face*n+(j+1)*5+i+1,face*n+(j+1)*5+i);fs.append(ids if face else tuple(reversed(ids)))
  boundary=list(range(5))+[j*5+4 for j in range(1,len(rows))]+list(range(n-2,n-6,-1))+[j*5 for j in reversed(range(1,len(rows)-1))]
  fs.extend((a,b,b+n,a+n) for a,b in zip(boundary,boundary[1:]+boundary[:1]))
  mesh('Twisted screw blade',vs,fs,materials['bronze'],undercol,True)
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
for name,loc in [('funnel-cap',(-2.4,0,25)),('mainmast-top',(-22.5,0,48.5)),('fore-director',(13.4,0,32)),('conning-director',(27.6,0,20.6)),('aft-director',(-37.8,0,17.5))]:
 ob=bpy.data.objects.new('landmark.'+name,None);scene.collection.objects.link(ob);ob.location=loc;ob['nodeId']='landmark.'+name
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('INDEPENDENT BISMARCK SOURCE 1941-02',len(scene.objects),'objects',flush=True)

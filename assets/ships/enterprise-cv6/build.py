"""Original, reproducible USS Enterprise CV-6 exterior reconstruction.

Major dimensions, loft sections, deck/island polygons and mounts are read from
blueprint compilation. Historical uncertainties are in reports/discrepancies.md.
Blender frame: bow +X, port +Y, up +Z; the common exporter changes basis once.
"""
from pathlib import Path
import bpy, bmesh, json, math, os, sys, random
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts/ships'))
from blender_components import create_gun_mount
from blender_fidelity import authored_hull, authored_structure, Fittings
OUT=Path(os.environ['SHIP_OUTPUT'])
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
H=D['hull'];rng=random.Random(19420604)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world.color=(.07,.09,.11)
COL={}
for name in ['Hull','Flight deck','Hangar and galleries','Island','Armament','Deck equipment','Underwater','Simulation']:
 c=bpy.data.collections.new(name);scene.collection.children.link(c);COL[name]=c
palette={'naval':(.19,.255,.32,1),'hullgray':(.15,.205,.265,1),'roof':(.14,.19,.24,1),
 'edge':(.095,.135,.175,1),'dark':(.016,.021,.027,1),'canvas':(.39,.405,.39,1),
 'deck':(.16,.20,.235,1),'elevator':(.18,.22,.25,1),'steel-deck':(.13,.175,.205,1),
 'antifouling':(.245,.080,.065,1),'boot':(.035,.042,.048,1),'bronze':(.37,.245,.095,1),
 'glass':(.035,.095,.125,1),'line':(.55,.55,.48,1),'hangar':(.40,.42,.415,1),'raft':(.26,.30,.30,1)}
M={}
for key,color in palette.items():
 m=bpy.data.materials.new(key);m.diffuse_color=color;m.use_nodes=True
 p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.78
 if key in ['bronze','edge']:p.inputs['Metallic'].default_value=.45
 if key=='glass':p.inputs['Roughness'].default_value=.22
 M[key]=m
for i in range(9):
 color=tuple(c*(.91+i*.023) for c in palette['deck'][:3])+(1,)
 m=bpy.data.materials.new('Stained Douglas fir '+str(i));m.diffuse_color=color;m.use_nodes=True
 m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color
 m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;M['plank'+str(i)]=m

def mesh(name,verts,faces,material,col,smooth=False):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
 o=bpy.data.objects.new(name,d);col.objects.link(o);o['assemblyId']=col.name.lower().replace(' ','-')
 if material:d.materials.append(material)
 for p in d.polygons:p.use_smooth=smooth
 return o

def box(name,loc,dim,material,col,bev=0):
 x,y,z=(v/2 for v in dim)
 vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
 o=mesh(name,vs,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],material,col);o.location=loc
 return o

def cyl(name,loc,radius,depth,material,col,vertices=24,r2=None):
 top=radius if r2 is None else r2
 vs=[(r*math.cos(i*2*math.pi/vertices),r*math.sin(i*2*math.pi/vertices),z) for z,r in [(-depth/2,radius),(depth/2,top)] for i in range(vertices)]
 fs=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
 o=mesh(name,vs,fs,material,col,True);o.location=loc
 o.data.polygons[0].use_smooth=False;o.data.polygons[1].use_smooth=False
 return o

def rod(name,a,b,r,material,col,r2=None,vertices=8):
 a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,max(.001,(b-a).length),material,col,vertices,r2)
 o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def poly(name,points,bottom,top,material,col):
 n=len(points);verts=[(x,y,z) for z in [bottom,top] for x,y in points]
 faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,verts,faces,material,col)

def empty(id,loc,col):
 o=bpy.data.objects.new(id,None);col.objects.link(o);o.location=loc;o['nodeId']=id;o['assemblyId']=id;return o

def interpolate(table,x):
 for (a,va),(b,vb) in zip(table,table[1:]):
  if a<=x<=b:return va+(vb-va)*(x-a)/(b-a)
 return table[0][1] if x<table[0][0] else table[-1][1]

def resample(points,n):
 # Arc-length samples preserve the rounded bilge and above-water flare.
 ds=[0]
 for a,b in zip(points,points[1:]):ds.append(ds[-1]+math.dist(a,b))
 return [(interpolate(list(zip(ds,[p[0] for p in points])),ds[-1]*i/(n-1)),interpolate(list(zip(ds,[p[1] for p in points])),ds[-1]*i/(n-1))) for i in range(n)]
# The blueprint now retains common section samples for rendering and CPU hits.
hull=authored_hull(H,mesh,COL['Hull'],[M['hullgray'],M['antifouling'],M['boot']],True)
# The hull is plated, not subdivided into an inflated generic canoe.
S={s['id']:s for s in D['structures']}
FLIGHT=S['flight-deck']['baseY']+S['flight-deck']['height'];MAIN=S['hangar-deck']['baseY']+S['hangar-deck']['height']
IY=-36.25*.3048
FT=.3048;FP=H['length']/2-18.75*FT
def frame(n):return FP-n*4*FT
def level(feet):return feet*FT-H['draft']
COMM,FLAG,NAV,ROOF,PILOT_ROOF=map(level,[87,94.5,102,109.5,111.75])
FCTRL,TOP_FLOOR,TOP_ROOF=map(level,[135.5,139.5,145.75])
STACK=level(129.875)
# Exterior belt follows the molded loft without altering the original offsets.
# C&R 189523 type sections: 4 inches, tapering to 2.5 inches between two and
# six feet below the contract 24 ft 4.5 in DWL. CV-5 plate 3 supplies the
# approximate frame 35–162 extent. The 5/8-inch shell allowance is inferred
# from class molded/over-plating breadth, not a verified CV-6 shell schedule.
def loft_width(x,z):
 return interpolate([(s['station']-H['length']/2,
  interpolate([(h,w) for w,h in s['points']],z)) for s in H['sections']],x)
xs=sorted({frame(162),frame(35),*[s['station']-H['length']/2 for s in H['sections'] if frame(162)<s['station']-H['length']/2<frame(35)]})
bottom,knee,top=map(level,[18.375,22.375,27.5])
zs=sorted({bottom,knee,top,*[z for z in [-1.4,.4] if bottom<z<top]})
for side,sign in [('port',1),('starboard',-1)]:
 verts=[];faces=[]
 for skin in [0,1]:
  for x in xs:
   for z in zs:
    armor=interpolate([(bottom,2.5),(knee,4),(top,4)],z)*FT/12
    allowance=(armor+(.625*FT/12)) if skin else -.002
    verts.append((x,sign*(loft_width(x,z)+allowance),z))
 rows=len(xs);columns=len(zs);outer=rows*columns
 for skin in [0,1]:
  start=skin*outer
  for i in range(rows-1):
   for j in range(columns-1):
    a=start+i*columns+j;b=a+columns;faces.append((a,b,b+1,a+1))
 for i in range(rows-1):
  for j in [0,columns-1]:
   a=i*columns+j;b=a+columns;faces.append((a,a+outer,b+outer,b))
 for i in [0,rows-1]:
  for j in range(columns-1):
   a=i*columns+j;faces.append((a,a+1,a+outer+1,a+outer))
 obj=mesh('External shell and tapered side armor '+side,verts,faces,None,COL['Hull'],True)
 obj['nodeId']='hull.side-belt-'+side;obj['assemblyId']='hull-shell-belt-'+side
 for key in ['hullgray','boot','antifouling']:obj.data.materials.append(M[key])
 for face in obj.data.polygons:
  z=sum(verts[v][2] for v in face.vertices)/len(face.vertices)
  face.material_index=2 if z < -1.4 else 1 if z < .4 else 0
 bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
structure_objects={}
for s in D['structures']:
 points=[(-z,-x) for x,z in s['footprint']]
 col=COL['Flight deck'] if s['id'].startswith(('flight-','elevator')) else COL['Hangar and galleries'] if s['id'].startswith(('hangar','gallery','portal','aa-gallery')) else COL['Island']
 obj=authored_structure(s,mesh,M,col)
 obj['nodeId']=s['id']+'.surface';obj['assemblyId']=s['id'];structure_objects[s['id']]=obj
 if s['id'].startswith('elevator'):
  # Preserve one independent lift datum per elevator for future flight operations.
  pivot=empty(s['id']+'.lift',(0,0,0),col);obj.parent=pivot
# Openings and the crown are durable blueprint surfaces, shared with CPU hits.
# Flight-deck plank surface. Geometry and colours are original, no reference textures.
outline=[(-z,-x) for x,z in S['flight-deck']['footprint']]
def span(y):
 hits=[]
 for (x1,y1),(x2,y2) in zip(outline,outline[1:]+outline[:1]):
  if min(y1,y2)<=y<max(y1,y2):hits.append(x1+(x2-x1)*(y-y1)/(y2-y1))
 return (min(hits),max(hits)) if hits else None
verts=[];fc=[];mat_indices=[]
for i in range(190):
 y=-11.5824+i*.149;y2=y+.144;a=span(y);b=span(y2)
 if not a or not b:continue
 lo=max(a[0],b[0]);hi=min(a[1],b[1]);x=lo
 while x<hi-.001:
  end=min(x+8+rng.uniform(-2,2),hi)
  # Skip the elevator rectangles. Slab below supplies tiny rounded-corner areas.
  intervals=[(x,end)]
  for id,s in S.items():
   if not id.startswith('elevator'):continue
   ps=[(-z,-xx) for xx,z in s['footprint']];xmin=min(p[0] for p in ps);xmax=max(p[0] for p in ps);ymin=min(p[1] for p in ps);ymax=max(p[1] for p in ps)
   if y<ymax and y2>ymin:
    intervals=[seg for a,b in intervals for seg in [(a,min(b,xmin)),(max(a,xmax),b)] if seg[1]>seg[0]+.003]
  for a,b in intervals:
   k=len(verts);verts.extend([(a,y,FLIGHT+.001),(b-.009,y,FLIGHT+.001),(b-.009,y2,FLIGHT+.001),(a,y2,FLIGHT+.001)]);fc.append((k,k+1,k+2,k+3));mat_indices.append(rng.randrange(9))
  x=end
planks=mesh('Blue-stained longitudinal planking',verts,fc,None,COL['Flight deck']);planks['assemblyId']='flight-deck-planking'
for i in range(9):planks.data.materials.append(M['plank'+str(i)])
for p,i in zip(planks.data.polygons,mat_indices):p.material_index=i
# Arresting wires are transverse, unlike the longitudinal catapult guide tracks.
for x in [-118,-113.7,-109.4,-90.4,-86.1,-81.8,-77.5,-73.2,-68.9,-64.6]:
 rod('Arresting wire',(x,-10.6,FLIGHT+.07),(x,10.6,FLIGHT+.07),.027,M['edge'],COL['Deck equipment'],vertices=6)
for x in [-57,-52,-47]:
 box('Crash-barrier sill',(x,0,FLIGHT+.038),(.11,22.0,.035),M['edge'],COL['Deck equipment'])
for y in [-3.3,3.3]:
 for offset in [-.09,.09]:box('Hydraulic catapult track',(90,y+offset,FLIGHT+.032),(48,.046,.025),M['edge'],COL['Deck equipment'])
# Tie-down strips at regular frame spacing. Small broken centerline as in 1942 views.
for x in range(-125,117,4):
 a=span(0)
 if a[0]<x<a[1]:
  ys=[y for y in [-10.8,-8,-5.2,-2.4,.4,3.2,6,8.8,11.6] if span(y) and span(y)[0]<x<span(y)[1]]
  for y in ys:box('Tie-down plate',(x,y,FLIGHT+.025),(.055,.34,.018),M['edge'],COL['Deck equipment'])
for x in range(-121,115,5):
 if all(abs(x-(-sum(p[1] for p in S[id]['footprint'])/len(S[id]['footprint'])))>8 for id in ['elevator-forward','elevator-middle','elevator-aft']):
  box('Deck centerline',(x,0,FLIGHT+.045),(2.5,.12,.018),M['line'],COL['Deck equipment'])
# C&R 189525: 4-inch camber over a 92-foot reference breadth. Preserve the
# annotated centerline height; a parabolic reconstruction supplies the fall.
# Cut transverse strips before bending, so caps, lift platforms and wires
# include the crown instead of bridging it with a single flat polygon.
bpy.context.view_layer.update()
for obj in [*COL['Flight deck'].objects,*COL['Deck equipment'].objects]:
 if obj.type!='MESH' or obj.get('nodeId') in [id+'.surface' for id in ['flight-deck','elevator-forward','elevator-middle','elevator-aft']]:continue
 mat=obj.matrix_world.copy();inv=mat.inverted();bm=bmesh.new();bm.from_mesh(obj.data)
 ys=[(mat@v.co).y for v in bm.verts];lo,hi=min(ys),max(ys)
 for y in range(math.floor(lo)+1,math.ceil(hi)):
  bmesh.ops.bisect_plane(bm,geom=[*bm.verts,*bm.edges,*bm.faces],dist=.000001,
   plane_co=inv@Vector((0,y,0)),plane_no=mat.to_3x3().transposed()@Vector((0,1,0)))
 for v in bm.verts:
  world=mat@v.co;world.z-=(4/12*FT)*(world.y/(46*FT))**2;v.co=inv@world
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
# Edge girders, catwalks and steel galleries keep the hangar open and inspectable.
def railing(points,z,name,col,closed=False):
 path=points+points[:1] if closed else points
 for a,b in zip(path,path[1:]):
  for h in [.37,.72,1.06]:rod(name+' rail',(*a,z+h),(*b,z+h),.022,M['edge'],col,vertices=6)
  n=max(1,math.ceil(math.dist(a,b)/2.25))
  for i in range(n):
   x=a[0]+(b[0]-a[0])*i/n;y=a[1]+(b[1]-a[1])*i/n
   rod(name+' stanchion',(x,y,z),(x,y,z+1.08),.025,M['naval'],col,vertices=6)
def screen(points,z,height,name,col,closed=False):
 path=points+points[:1] if closed else points
 for a,b in zip(path,path[1:]):
  dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
  if length<.001:continue
  nx,ny=-dy/length*.027,dx/length*.027
  poly(name,[(a[0]-nx,a[1]-ny),(b[0]-nx,b[1]-ny),(b[0]+nx,b[1]+ny),(a[0]+nx,a[1]+ny)],z,z+height,M['naval'],col)
for side,y in [('port',10.1),('starboard',-10.1)]:
 col=COL['Hangar and galleries']
 gallery=FLIGHT-7.5*FT;opening=gallery-MAIN
 # Open hangar has three separated openings and solid machinery/uptake sections.
 # Major hangar walls and portal frames are rendered from blueprint structures.
 for a,b in [(-69,-34),(31,67)]:
  box('Rolled hangar shutter',((a+b)/2,y,gallery-.36),(b-a,.24,.55),M['edge'],col)
  # Catwalk inside the open door retains a view through the ship.
  box('Hangar side walkway',((a+b)/2,y*.94,MAIN+.20),(b-a,1.0,.12),M['steel-deck'],col)
  railing([(a,y),(b,y)],MAIN,'Hangar',col)
 for x in range(-86,75,4):
  box('Gallery transverse beam',(x,0,FLIGHT-.46),(.13,23,.25),M['edge'],col)
 for a,b,yedge in [(-69,-34,14.2),(31,67,14.2),(-121,-109,13.1)]:
  yy=yedge if side=='port' else -yedge
  railing([(a,yy+(1 if yy>0 else -1)*.75),(b,yy+(1 if yy>0 else -1)*.75)],FLIGHT-.68,'AA gallery',col)
 for x in range(-82,72,6):
  # Flared brackets beneath the flight-deck cantilever.
  yy=y*1.18;rod('Cantilever bracket',(x,y,MAIN+4.2),(x,yy,FLIGHT-.4),.09,M['naval'],col)
# Open ends: forecastle deck, capstans and vertical flight-deck supports.
for x in [91,101,109]:
 for y in [-6.5,6.5]:
  z=interpolate(H['deckHeights'],x+H['length']/2)
  rod('Foredeck support',(x,y,z),(x,y,FLIGHT-.34),.19,M['naval'],COL['Hangar and galleries'])
  rod('Foredeck diagonal',(x-3,y,z),(x,y,FLIGHT-.34),.095,M['naval'],COL['Hangar and galleries'])
for x in [-122,-116,-110]:
 for y in [-6.2,6.2]:rod('Afterdeck support',(x,y,MAIN),(x,y,FLIGHT-.34),.16,M['naval'],COL['Hangar and galleries'])
# All guns are built from the catalog; single barrels are real single barrels.
for m in D['mounts']:
 x,y,z=-m['position'][2],-m['position'][0],m['position'][1];spec=m['weapon']
 if m['partId'].startswith('us-5'):
  rad=2.25
  cyl(m['id']+' gun platform',(x,y,z-.14),rad,.28,M['naval'],COL['Armament'],40)
  # A webbed sponson, not an armored battleship barbette.
  rod(m['id']+' diagonal support',(x,y*.72,z-3.2),(x,y,z-.22),.16,M['naval'],COL['Armament'])
  rod(m['id']+' fore support',(x-2,y*.76,z-2.6),(x-1,y,z-.22),.11,M['naval'],COL['Armament'])
  for a in [math.pi*i/16 for i in range(33)]:
   if math.sin(a)*y>0:continue
   # Low splinter screen at the inner arc; leave the outward firing side clear.
   p1=(x+rad*math.cos(a),y+rad*math.sin(a));p2=(x+rad*math.cos(a+.10),y+rad*math.sin(a+.10))
   screen([p1,p2],z,.65,m['id']+' platform screen',COL['Armament'])
 elif m['partId']=='us-11in75-quad':
  cyl(m['id']+' platform',(x,y,z-.12),2,.24,M['naval'],COL['Armament'],40)
  pts=[(x+2.0*math.cos(a*2*math.pi/32),y+2.0*math.sin(a*2*math.pi/32)) for a in range(32)]
  for a,b in zip(pts,pts[1:]+pts[:1]):
   o=mesh('Quad splinter tub',[(a[0],a[1],z),(b[0],b[1],z),(b[0],b[1],z+.8),(a[0],a[1],z+.8)],[(0,1,2,3)],M['naval'],COL['Armament']);o['assemblyId']=m['id']+'-platform'
 create_gun_mount(m,COL['Armament'],dict(mesh=mesh,cyl=cyl,rod=rod,box=box),M,lambda x:z)
# Exposed starboard walkway, around the island footprint.
box('Island AA gallery',(10,-15.5,FLIGHT-.15),(48,2.0,.3),M['naval'],COL['Island'])
railing([(-14,-16.45),(35,-16.45)],FLIGHT,'Island gallery',COL['Island'])
# Bridge glazing and perimeter handrails.
for key in ['flag-bridge','navigation-bridge','pilot-house','secondary-conning','fighting-top']:
 s=S[key];points=[(-z,-x) for x,z in s['footprint']];top=s['baseY']+s['height'];center=Vector((sum(p[0] for p in points)/len(points),sum(p[1] for p in points)/len(points)))
 for a,b in zip(points,points[1:]+points[:1]):
  a,b=Vector(a),Vector(b);n=max(1,int((b-a).length/1.02))
  for i in range(n):
   v=a+(b-a)*(i+.5)/n
   # The stack portion is plating and uptake trunks, not a row of bridge windows.
   if key=='flag-bridge' and frame(104)<v.x<frame(87.5):continue
   out=(v-center).normalized()*.03;v+=out
   o=box('Bridge window',(v.x,v.y,top-.74),(.68,.035,.57),M['glass'],COL['Island']);o.rotation_euler.z=math.atan2(b.y-a.y,b.x-a.x)
 railing(points,top,'Bridge',COL['Island'],True)
for key in ['communications-walkway','flag-walkway','navigation-wings','bridge-roof','pilot-roof','fighting-platform','fighting-roof','searchlight-platform-port','searchlight-platform-starboard']:
 s=S[key];points=[(-z,-x) for x,z in s['footprint']];z=s['baseY']+s['height']
 if key in ['navigation-wings','fighting-platform']:
  screen(points,z,1.15,key+' splinter shield',COL['Island'],True)
 else:railing(points,z,key,COL['Island'],True)
 for x,y in points:
  if abs(y-IY)>2.7:
   rod('Platform web support',(x,IY+math.copysign(2.1,y-IY),z-1.4),(x,y,z-.12),.065,M['naval'],COL['Island'])
for x in [frame(79.8),frame(83.3)]:
 for y in [IY-1.4,IY+1.4]:rod('Fighting-top support',(x,y,FCTRL),(x,y,TOP_FLOOR),.10,M['naval'],COL['Island'])
# Funnel: three distinct uptake openings and a tall rectangular casing with
# rounded shoulders, seen clearly in 19-N-29696.
for fr,diameter in [(100,11.5),(96,13.5),(92,13.5)]:
 x=frame(fr);radius=diameter*FT/2
 cyl('Funnel uptake',(x,IY,STACK+.025),radius,.05,M['dark'],COL['Island'],40)
 for angle in [0,math.pi/2]:
  rod('Uptake grille',(x-radius*.95*math.cos(angle),IY-radius*.95*math.sin(angle),STACK+.10),(x+radius*.95*math.cos(angle),IY+radius*.95*math.sin(angle),STACK+.10),.035,M['edge'],COL['Island'])
stack_outline=[(-z,-x) for x,z in S['funnel-cap']['footprint']]
railing(stack_outline,STACK,'Stack',COL['Island'],True)
for x in [frame(102.5),frame(89.7)]:
 for y in [IY-2.45,IY+2.45]:rod('Steam pipe',(x,y,FLAG),(x,y,STACK+.45),.10,M['naval'],COL['Island'],vertices=12)
# Tripod mast, fighting top, CXAM-1 and yards. Datum survives batching.
fore=empty('foremast.assembly',(0,0,0),COL['Island'])
MX=frame(80.5)
for a in [(frame(84),IY-1.8,NAV),(frame(84),IY+1.8,NAV),(frame(80),IY,NAV)]:
 rod('Tripod mast leg',a,(MX,IY,TOP_FLOOR),.36,M['naval'],COL['Island'],r2=.22,vertices=16)
rod('Foremast topmast',(frame(82),IY,TOP_FLOOR),(frame(82),IY,level(175+7/12)),.105,M['naval'],COL['Island'],r2=.045,vertices=12)
for height,half in [(145.75,7.1),(164,4.1)]:
 rod('Signal yard',(MX,IY-half,level(height)),(MX,IY+half,level(height)),.065,M['naval'],COL['Island'])
 for sign in [-1,1]:
  rod('Signal halyard',(MX,IY+sign*half,level(height)),(frame(80),IY+sign*2.3,ROOF),.009,M['edge'],COL['Island'],vertices=4)
  rod('Yard lift',(frame(82),IY,level(height+5)),(MX,IY+sign*half,level(height)),.016,M['edge'],COL['Island'],vertices=6)
# Radar grid is physically open and exports with a separate rotation pivot.
radar=empty('radar-cxam.yaw',(frame(80),IY,level(157.5)),COL['Island'])
for y in [-2.3+i*.46 for i in range(11)]:
 o=rod('CXAM vertical',(0,y,-2.25),(0,y,2.25),.023,M['edge'],COL['Island']);o.parent=radar;o['assemblyId']='radar-cxam'
for z in [-2.25+i*.45 for i in range(11)]:
 o=rod('CXAM horizontal',(0,-2.3,z),(0,2.3,z),.022,M['edge'],COL['Island']);o.parent=radar;o['assemblyId']='radar-cxam'
for y in [-2.3,2.3]:
 o=rod('CXAM brace',(-1,0,-2),(0,y,2.25),.035,M['naval'],COL['Island']);o.parent=radar;o['assemblyId']='radar-cxam'
rod('Radar support',(frame(80),IY,TOP_ROOF),(frame(80),IY,level(151)),.17,M['naval'],COL['Island'])
AX=frame(103.5)
rod('After mast',(AX,IY,ROOF),(AX,IY,level(166+2.875/12)),.14,M['naval'],COL['Island'],r2=.045)
for z,w in [(142,3.7),(158,3)]:rod('Aft signal yard',(AX,IY-w,level(z)),(AX,IY+w,level(z)),.06,M['naval'],COL['Island'])
for y in [IY-1,IY+1]:rod('Mast aerial',(frame(82),y,level(174)),(AX,y,level(165)),.011,M['edge'],COL['Island'],vertices=4)
# Mk 33 director stations and searchlights, interpreted from dated photos.
for id,x,z in [('forward',frame(71.5),PILOT_ROOF),('aft',frame(110.7),ROOF)]:
 cyl('Director support trunk',(x,IY,(COMM+z)/2),.38,z-COMM,M['naval'],COL['Island'],24)
 node=empty('director-'+id+'.yaw',(x,IY,z),COL['Island'])
 fittings=[cyl('Director pedestal',(0,0,.45),.76,.9,M['naval'],COL['Island'],24),
  box('Mk 33 director',(0,0,1.55),(2.2,2.5,1.4),M['naval'],COL['Island']),
  rod('Director rangefinder',(0,-2.4,1.9),(0,2.4,1.9),.15,M['edge'],COL['Island'],vertices=12)]
 for y in [-2.4,2.4]:fittings.append(box('Optical hood',(0,y,1.9),(.65,.42,.48),M['naval'],COL['Island']))
 for o in fittings:o.parent=node;o['assemblyId']='director-'+id
for x,y,z in [(frame(79.8),IY-1.2,TOP_ROOF+.75),(frame(79.8),IY+1.2,TOP_ROOF+.75),
              (frame(97.5),IY-3.5,ROOF+.8),(frame(94.5),IY-3.5,ROOF+.8),
              (frame(97.5),IY+3.5,ROOF+.8),(frame(94.5),IY+3.5,ROOF+.8)]:
 cyl('Searchlight pedestal',(x,y,z-.48),.22,.95,M['naval'],COL['Island'],16)
 rod('Searchlight housing',(x,y,z),(x+.7,y,z),.45,M['naval'],COL['Island'],vertices=24)
 rod('Searchlight glass',(x+.705,y,z),(x+.71,y,z),.38,M['glass'],COL['Island'],vertices=24)
# Twin side cranes: open lattice girders and separate slew nodes.
for id,x in [('forward',frame(75.5)),('aft',frame(109.5))]:
 z=COMM;y=-14.35
 pivot=empty('crane-'+id+'.yaw',(x,y,z),COL['Island']);before=set(scene.objects)
 cyl('Crane kingpost',(0,0,.8),.30,1.6,M['naval'],COL['Island'],20)
 start=Vector((0,0,1.6));end=start+Vector((8.3,0,4.2))
 for off in [-.27,.27]:
  rod('Crane chord',start+Vector((0,off,0)),end+Vector((0,off,0)),.075,M['naval'],COL['Island'])
 for i in range(10):
  a=start.lerp(end,i/10);b=start.lerp(end,(i+1)/10)
  rod('Crane lattice',a+Vector((0,-.27,0)),b+Vector((0,.27,0)),.035,M['naval'],COL['Island'])
 rod('Crane hoist',end,(end.x,end.y,-.5),.015,M['edge'],COL['Island'],vertices=4)
 for o in set(scene.objects)-before:o.parent=pivot;o['assemblyId']='crane-'+id
# Boat racks and Carley floats. No aircraft parked on deck, to expose geometry.
def boat(name,x,y,z,length,width):
 Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),M,COL['Deck equipment']).boat(name,x,y,z,length,width,length>10)
for side,sgn in [('port',1),('starboard',-1)]:
 for x,length in [(-79,10.7),(-45,8.5),(0,12.2),(14,9.1)]:
  y=sgn*11.55;boat(side+' boat',x,y,MAIN+.5,length,2.0)
  for xx in [x-length*.32,x+length*.32]:
   rod('Boat davit',(xx,y*.89,MAIN),(xx,y*.89,MAIN+4.4),.09,M['naval'],COL['Deck equipment'])
   rod('Davit head',(xx,y*.89,MAIN+4.4),(xx,y,MAIN+4.4),.09,M['naval'],COL['Deck equipment'])
for x in range(-86,82,9):
 for sign in [-1,1]:
  y=sign*12.4;z=FLIGHT-2.2
  # Oval raft rendered as two end arcs and longitudinal tubes.
  for xx in [-.53,.53]:
   for i in range(10):
    a=math.pi*(i/10-.5)+ (math.pi if xx<0 else 0);b=a+math.pi/10
    rod('Raft end',(x+xx+.36*math.cos(a),y,z+.36*math.sin(a)),(x+xx+.36*math.cos(b),y,z+.36*math.sin(b)),.095,M['raft'],COL['Deck equipment'])
  for zz in [-.36,.36]:rod('Raft side',(x-.53,y,z+zz),(x+.53,y,z+zz),.095,M['raft'],COL['Deck equipment'])
# Scuttles are dark recess discs, with gunmetal rims oriented in the hull side.
for x in range(-105,114,4):
 station=x+H['length']/2;w=interpolate(H['halfBreadths'],station)
 for z in [2.1,4.15,6.35]:
  # Estimate the local waterline flare from loft points at the nearest section.
  s=min(H['sections'],key=lambda p:abs(p['station']-station));breadth=interpolate([(p[1],p[0]) for p in s['points']],z)
  for sign in [-1,1]:
   yy=sign*(breadth+.025)
   rod('Hull scuttle',(x,yy,z),(x,yy+sign*.035,z),.125,M['dark'],COL['Hull'],vertices=12)
# Forecastle anchoring machinery and independent anchor shapes.
for sign in [-1,1]:
 y=sign*3.5;z=interpolate(H['deckHeights'],112+H['length']/2)
 cyl('Anchor capstan',(111,y,z+.42),.46,.84,M['edge'],COL['Deck equipment'],24)
 rod('Anchor cable',(111,y,z+.14),(120,sign*1.1,z+.14),.08,M['edge'],COL['Deck equipment'])
 x=115;yy=sign*5.1;zz=8.1
 rod('Anchor shank',(x,yy,zz),(x-1.25,yy,zz-1.5),.11,M['edge'],COL['Deck equipment'])
 rod('Anchor stock',(x-1,yy-.7,zz-1.15),(x-1,yy+.7,zz-1.15),.09,M['edge'],COL['Deck equipment'])
# Four shafts, four three-bladed screws, A brackets, bilge keels and one rudder.
for side,sign in [('port',1),('starboard',-1)]:
 # Longitudinal centers measured from the CV-5 1940 outboard profile frame grid.
 # Lateral centers and blade pitch still require CV-6 machinery drawings.
 for kind,y,fr in [('inner',3.6,175),('outer',7.5,161)]:
  y*=sign;x=frame(fr);z=level(6.5)
  exit_x=frame(fr-9)
  rod('Propeller shaft',(x,y,z),(exit_x,y*.94,z+.18),.21,M['edge'],COL['Underwater'],vertices=20)
  for dy in [-1.0,1.0]:rod('Shaft bracket',(x+1.4,y+dy,z+2.2),(x+1,y,z),.14,M['naval'],COL['Underwater'])
  rotor=empty('propeller-'+side+'-'+kind+'.spin',(x,y,z),COL['Underwater'])
  hub=rod('Propeller hub',(-.55,0,0),(.60,0,0),.42,M['bronze'],COL['Underwater'],r2=.27,vertices=24);hub.parent=rotor;hub['assemblyId']=rotor.name
  for blade in range(3):
   a=blade*2*math.pi/3;points=[(.18,.11),(.55,-.06),(.94,.05),(1,.28),(.76,.40),(.35,.32)]
   radius_m=(12+7/12)*FT/2;normalizer=max(math.hypot(r,t) for r,t in points)
   points=[(r/normalizer*radius_m,t/normalizer*radius_m) for r,t in points]
   verts=[]
   for thick in [-.055,.055]:
    for radius,tangential in points:verts.append((thick+.20*(radius/radius_m),radius*math.cos(a)-tangential*math.sin(a),radius*math.sin(a)+tangential*math.cos(a)))
   n=len(points);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
   o=mesh('Screw blade',verts,faces,M['bronze'],COL['Underwater'],True);o.parent=rotor;o['assemblyId']=rotor.name
 for x1,x2 in [(-63,51)]:
  y=sign*10.9
  poly('Bilge keel',[(x1,y*.96),(x2,y*.96),(x2-4,y+sign*.7),(x1+4,y+sign*.7)],-4.6,-4.51,M['antifouling'],COL['Underwater'])
# C&R 216500: axis 46 ft forward of AP, lower edge 4 in above molded baseline,
# 397 sq ft side area. The horn cutout follows the sister-ship profile; the named
# leading/trailing edge dimensions remain exact while scanned vertical readings
# are adjusted uniformly to that documented area. This is recorded as class
# reconstruction evidence, not a CV-6 rudder-detail drawing.
AP=FP-770*FT
rudder=empty('rudder.yaw',(AP+46*FT,0,level(0)),COL['Underwater'])
trailing=-(16+(10+7/8)/12);upper=12+(7+9/16)/12;lower=10+8.5/12
outline=[(trailing,.333333333),(trailing,16.6),(trailing+.65,17.75),(-2.4,16.4),
         (-2.4,15.4),(1.4,15.2),(1.4,12.8),(-2.4,12.8),(-2.4,10.9),
         (upper,10.9),(upper,10.0),(lower,.333333333)]
area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outline,outline[1:]+outline[:1])))/2
outline=[(x*FT,(1/3+(z-1/3)*397/area)*FT) for x,z in outline]
n=len(outline);verts=[(x,side*.26,z) for side in [-1,1] for x,z in outline]
faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
o=mesh('Single balanced rudder with horn clearance',verts,faces,M['antifouling'],COL['Underwater']);o.parent=rudder;o['assemblyId']='rudder'
# March 1942 island photo 19-N-29696: pierced platform webs, external ladders,
# uptake piping, rain hoods, gangways and crane winches. No later Bofors fit.
fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),M,COL['Island'])
for sign in [-1,1]:
 y=IY+sign*2.55
 for x in [frame(73),frame(85),frame(104)]:fit.door('Island watertight access',x,y,FLAG+.12,.72,1.8)
 for x in [frame(90),frame(94),frame(99),frame(103)]:fit.vent('Island ventilation trunk',x,y,COMM+.62,1.15,1.1)
 for x in [frame(75),frame(84)]:fit.stairs('Bridge exterior stair',(x-2.4,y,FLAG),(x+.7,y,NAV),.68)
 fit.ladder('Funnel external ladder',(frame(96),IY+sign*2.48,ROOF),(frame(96),IY+sign*2.48,STACK),.64)
 fit.ladder('Fighting top access',(MX-1,IY+sign*.9,ROOF),(MX-1,IY+sign*.9,TOP_FLOOR),.54)
 for x in [frame(96)-1.65,frame(96)+1.65]:fit.knee('Searchlight gallery pierced knee',x,IY+sign*2.2,IY+sign*4.2,ROOF-.2,1.4)
 for x in [frame(72),frame(75)]:fit.knee('Navigation wing pierced knee',x,IY+sign*2.1,IY+sign*5.0,NAV-.18,1.45)
 # Rounded air intakes and narrow pipe lagging beneath the stack walkway.
 for x in [frame(91),frame(98)]:
  rod('Uptake service pipe',(x,y,FLAG+.2),(x,y,STACK-.7),.065,M['naval'],COL['Island'],vertices=10)
  rod('Pipe elbow',(x,y,STACK-.7),(x+.45,y,STACK-.7),.065,M['naval'],COL['Island'],vertices=10)
for x,z in [(frame(71.5),PILOT_ROOF),(frame(110.7),ROOF)]:
 for sign in [-1,1]:
  box('Director optical hood',(x+.3,IY+sign*1.0,z+1.25),(.65,.40,.50),M['naval'],COL['Island'])
  box('Director sight aperture',(x+.64,IY+sign*1.0,z+1.25),(.02,.24,.28),M['glass'],COL['Island'])
fit.col=COL['Hangar and galleries']
for sign in [-1,1]:
 # Deep deck-end supports are open structural framing. Keep visible air below.
 for x in [87,93,99,105,111,-113,-119,-125]:
  y=sign*6.2;z=FLIGHT-.4
  fit.knee('Flight deck end cantilever',x,y,sign*10.8,z,3.0)
  rod('Deck end crossbeam',(x,-10.8,z),(x,10.8,z),.11,M['naval'],COL['Hangar and galleries'],vertices=8)
 for x in range(-84,74,8):fit.knee('Flight deck gallery web',x,sign*10.12,sign*13.5,FLIGHT-.36,1.65)
 for a,b in [(-69,-34),(31,67)]:
  for x in range(a+2,b,3):
   # Raised rolled shutters retain separate vertical slats and guide tracks.
   box('Shutter roll rib',(x,sign*10.29,FLIGHT-2.64),(.035,.055,.47),M['naval'],COL['Hangar and galleries'])
  for x in [a,b]:
   box('Hangar shutter guide',(x,sign*10.28,MAIN+2.6),(.13,.10,5.0),M['edge'],COL['Hangar and galleries'])
 for x in [-82,-74,-29,-18,0,17,26,71]:fit.vent('Gallery louver',x,sign*10.24,FLIGHT-1.35,1.65,.80)
 for x in [-77,-24,24,71]:fit.door('Hangar personnel door',x,sign*10.24,MAIN+.12,.8,1.9)
fit.col=COL['Deck equipment']
for sign in [-1,1]:
 for x in [-117,-105,-85,-65]:
  y=sign*10.7
  fit.ring('Arresting cable return sheave',(x,y,FLIGHT-.28),.28,.065,'x',segments=18)
  box('Arrestor sheave cover',(x,y,FLIGHT-.18),(.7,.35,.30),M['naval'],COL['Deck equipment'])
 for x in [104,95,-109,-119]:fit.reel('Deck end mooring reel',x,sign*4.0,MAIN+.2,.42,1.2)
 for x in [48,58,-51,-61]:
  box('20 mm magazine locker',(x,sign*13.4,FLIGHT-.27),(.9,.42,.7),M['naval'],COL['Deck equipment'])
  box('Magazine locker lid',(x,sign*13.4,FLIGHT+.10),(.96,.49,.07),M['roof'],COL['Deck equipment'])
 for x in [-79,-45,0,14]:
  for dx in [-2.4,2.4]:
   fit.ring('Davit block',(x+dx,sign*11.55,MAIN+4.2),.12,.035,'y',segments=12)
   rod('Boat fall',(x+dx,sign*11.55,MAIN+4.2),(x+dx,sign*11.55,MAIN+1.65),.021,M['edge'],COL['Deck equipment'],vertices=6)
# Elevator roller tracks and lip seams follow the retained platform perimeter.
for id in ['elevator-forward','elevator-middle','elevator-aft']:
 s=S[id];pts=[(-z,-x) for x,z in s['footprint']]
 for a,b in zip(pts,pts[1:]+pts[:1]):
  rod('Elevator edge seam',(*a,FLIGHT+.045),(*b,FLIGHT+.045),.019,M['edge'],COL['Deck equipment'],vertices=6)
  for i in range(3):
   x=a[0]+(b[0]-a[0])*(i+.5)/3;y=a[1]+(b[1]-a[1])*(i+.5)/3
   box('Elevator guide shoe',(x,y,FLIGHT-.35),(.16,.18,.5),M['edge'],COL['Deck equipment'])
# Non-rendering gameplay volumes remain in the retained source, never the GLB.
for kind in ['armor','modules','compartments','obstructions']:
 for v in D[kind]:
  a,b,c=v['center'];sx,sy,sz=v['size'];o=box(kind+':'+v['id'],(-c,-a,b),(sz,sx,sy),M['line'],COL['Simulation']);o['exportRole']='simulation';o.hide_render=True;o.display_type='WIRE';o.hide_set(True)
scene['definitionHash']=D['contentHash'];scene['configuration']=D['configuration'];scene['historicalAccuracy']='In progress; see discrepancy register'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('ENTERPRISE SOURCE',len(scene.objects),'objects',flush=True)

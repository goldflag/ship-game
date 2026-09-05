"""Independent Bismarck reconstruction, 24 May 1941 fit at a standard-draft datum.

Only the compiled blueprint and original component recipes are geometry inputs.
No baseline scene, reference mesh, extracted offset or game texture is opened.
Editable sections/footprints live in blueprint.json; evidence in modeling-spec.json.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
OUT=Path(os.environ['SHIP_OUTPUT']);DEF=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text());H=DEF['hull']
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene['definitionHash']=DEF['contentHash'];scene['authoring']='Independent sections and polygon primitives; no imported starting mesh'
def group(name):
 c=bpy.data.collections.new(name);scene.collection.children.link(c);return c
hullcol=group('01 Hull and deck');supercol=group('02 Superstructure');gunscol=group('03 Articulated batteries');detailcol=group('04 Fittings');undercol=group('05 Underwater');simcol=group('14 Simulation volumes')
def material(name,color,metal=.1):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.6;p.inputs['Metallic'].default_value=metal;return m
materials={k:material(k,c) for k,c in {'naval':(.48,.53,.55),'roof':(.19,.23,.25),'edge':(.33,.39,.42),'hullgray':(.28,.34,.37),'canvas':(.48,.46,.39),'dark':(.025,.035,.04),'deck':(.49,.36,.205),'oxide':(.28,.07,.045),'boot':(.045,.06,.065),'glass':(.04,.12,.16),'bronze':(.46,.29,.1)}.items()}
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
def rod(name,a,b,radius,mat,col,r2=None,vertices=12):
 delta=Vector(b)-Vector(a);length=delta.length
 if length<1e-6:return None
 r2=radius if r2 is None else r2
 vs=[(r*math.cos(math.tau*i/vertices),r*math.sin(math.tau*i/vertices),z) for z,r in [(-length/2,radius),(length/2,r2)] for i in range(vertices)]
 fs=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
 ob=mesh(name,vs,fs,mat,col,True);ob.location=(Vector(a)+Vector(b))/2;ob.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return ob
helpers={'mesh':mesh,'cyl':cyl,'box':box,'rod':rod}
def interp(table,s):
 for (a,x),(b,y) in zip(table,table[1:]):
  if a<=s<=b:return x+(y-x)*(s-a)/(b-a)
 return table[-1][1]
def deckz(x):return interp(H['deckHeights'],x+H['length']/2)
def width(x):return interp(H['halfBreadths'],x+H['length']/2)
# Closed independently lofted hull, with welded pole stations and outward normals.
sections=H['sections'];vs=[];fs=[];n=2*len(sections[0]['points'])-1
for section in sections:
 s=section['station'];pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
 vs.extend((s-H['length']/2,w,z) for w,z in ring)
for i in range(len(sections)-1):
 for j in range(n):fs.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
ob=mesh('Independently lofted hull',vs,fs,None,hullcol,True);ob['nodeId']='hull.surface';ob['assemblyId']='hull'
bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();ob.data.update()
for k in ['hullgray','oxide','boot','deck']:ob.data.materials.append(materials[k])
for p in ob.data.polygons:
 z=p.center.z
 p.material_index=3 if p.normal.z>.65 and z>5 else 1 if z<-1.3 else 2 if z<.1 else 0
 if p.material_index==3:p.use_smooth=False
# Plank seams, authored as slender deck lines following the independently parameterized outline.
for y in range(-17,18):
 valid=[s for s in range(2,250,2) if interp(H['halfBreadths'],s)>abs(y)+.4]
 if not valid:continue
 for sa,sb in zip(valid,valid[1:]):
  xa,xb=sa-125.25,sb-125.25
  rod('Deck seam',(xa,y,deckz(xa)+.016),(xb,y,deckz(xb)+.016),.014,materials['edge'],hullcol,vertices=3)
# The structures are separate editable polygon extrusions in the shared blueprint.
for s in DEF['structures']:
 pts=[(-z,-x) for x,z in s['footprint']];N=len(pts);verts=[(x,y,h) for h in [s['baseY'],s['baseY']+s['height']] for x,y in pts]
 ob=mesh(s['name'],verts,[tuple(reversed(range(N))),tuple(range(N,2*N))]+[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials[s['material']],supercol);ob['assemblyId']='superstructure-'+s['id']
 # Light platform edge lips retain deck tiers at oblique viewing distances.
 if s['material']=='roof':
  for a,b in zip(pts,pts[1:]+pts[:1]):rod(s['id']+' edge',(*a,s['baseY']+s['height']),(*b,s['baseY']+s['height']),.08,materials['edge'],supercol,vertices=6)
for mount in DEF['mounts']:create_gun_mount(mount,gunscol,helpers,materials,deckz)
# Independently shaped funnel: elliptical jacket, raked cap and dark recessed opening.
N=48;verts=[]
for z,rx,ry in [(11.47,6.2,4.6),(22.4,5.6,3.8),(23.5,5.7,3.9)]:
 for i in range(N):
  a=math.tau*i/N;verts.append((-2+rx*math.cos(a),ry*math.sin(a),z+.055*rx*math.cos(a)))
mesh('Funnel jacket',verts,[(j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i) for j in range(2) for i in range(N)],materials['naval'],supercol,True)['assemblyId']='superstructure-funnel'
mesh('Funnel opening',[(-2+5.3*math.cos(math.tau*i/N),3.6*math.sin(math.tau*i/N),23.2+.25*math.cos(math.tau*i/N)) for i in range(N)],[tuple(range(N))],materials['dark'],supercol)
for z in [14,18,21.2]:
 pts=[(-2+5.9*math.cos(math.tau*i/N),4.25*math.sin(math.tau*i/N),z) for i in range(N)]
 for a,b in zip(pts,pts[1:]+pts[:1]):rod('Funnel walkway edge',a,b,.075,materials['roof'],supercol,vertices=6)
# Glazing, doors, vents: original primitives, no image textures.
for y in [-4,-2.7,-1.35,0,1.35,2.7,4]:box('Wheelhouse glazing',(27.46,y,17.55),(.07,.95,.85),materials['glass'],supercol)
for sign in [-1,1]:
 for x in [11,15,19,23,27,31,35]:
  box('Lower bridge port', (x,sign*8.52,10.8),(.8,.06,.9),materials['dark'],supercol)
 for x in range(-43,40,4):box('Hull scuttle',(x,sign*(width(x)-.12),4.35),(.38,.04,.25),materials['dark'],detailcol)
# Major fire-control stations, FuMO arrays and two masts.
for name,x,z,span in [('fore',16,29.1,10.5),('conning',35,15.0,7),('aft',-38,16.5,10.5)]:
 cyl(name+' director',(x,0,z),2.15,1.6,materials['naval'],detailcol,32);rod(name+' rangefinder',(x,-span/2,z+.2),(x,span/2,z+.2),.3,materials['edge'],detailcol,vertices=16)
 for y in [-2,-1,0,1,2]:rod(name+' radar vertical',(x+.8,y,z+1.3),(x+.8,y,z+2.7),.028,materials['dark'],detailcol,vertices=5)
 for zz in [1.3,2,2.7]:rod(name+' radar horizontal',(x+.8,-2,z+zz),(x+.8,2,z+zz),.028,materials['dark'],detailcol,vertices=5)
for name,x,base,top in [('foremast',10,23,39),('mainmast',-23,10.7,48.5)]:
 rod(name,(x,0,base),(x-.9,0,top),.32,materials['edge'],detailcol,.07,16)
 for y in [-3.2,3.2]:rod(name+' support',(x+2,y,base),(x-.2,0,base+13),.16,materials['edge'],detailcol,vertices=10)
 for zz,span in [(top-7,11),(top-3,7)]:rod(name+' yard',(x-.7,-span/2,zz),(x-.7,span/2,zz),.09,materials['edge'],detailcol,vertices=10)
 rod(name+' stay',(x-.9,0,top),(x-13,0,deckz(x-13)),.025,materials['dark'],detailcol,vertices=4)
rod('Aerial span',(9.1,0,39),(-23.9,0,48.5),.02,materials['dark'],detailcol,vertices=4)
# Catapult, two service cranes and boats, intentionally simplified working envelopes.
box('Athwartships catapult',(-9,0,6.25),(2.0,28,.6),materials['roof'],detailcol)
for sign in [-1,1]:
 cyl('Crane pedestal',(-1,sign*9,7.1),.72,2.8,materials['naval'],detailcol)
 rod('Crane boom',(-1,sign*9,9), (12,sign*6,22),.17,materials['edge'],detailcol,vertices=10)
 rod('Crane cable',(-1,sign*9,11),(12,sign*6,22),.026,materials['dark'],detailcol,vertices=5)
 for x in [-21,-28]:
  hull=[(x-4.8,sign*8,11.0),(x-3.7,sign*8-1.2,10.3),(x+3.9,sign*8-1.0,10.3),(x+5,sign*8,10.6),(x+3.9,sign*8+1,10.3),(x-3.7,sign*8+1.2,10.3)]
  boat=mesh('Service boat',hull,[tuple(range(6))],materials['deck'],detailcol)
  box('Boat cabin',(x,sign*8,11.0),(3,1.5,1.1),materials['naval'],detailcol)
# Eight twin heavy AA envelopes; non-combat fittings remain distinct from active batteries.
for x,y in [(22,11),(22,-11),(6,12),(6,-12),(-26,11),(-26,-11),(-44,10),(-44,-10)]:
 z=7.0;cyl('10.5 cm AA pedestal',(x,y,z),1.5,1.0,materials['hullgray'],detailcol)
 box('10.5 cm AA shield',(x,y,z+1),(3.3,3.1,1.8),materials['naval'],detailcol)
 for offset in [-.5,.5]:rod('10.5 cm AA barrel',(x+.6,y+offset,z+1.5),(x+5,y+offset,z+2.4),.13,materials['edge'],detailcol,.07,12)
# Bow anchors and mooring fittings, plus rails with hull-driven endpoints.
for sign in [-1,1]:
 for x in [89,104]:
  cyl('Capstan',(x,sign*3,deckz(x)+.6),.62,1.2,materials['edge'],detailcol)
  rod('Anchor chain',(x,sign*3,deckz(x)+.1),(117,sign*3.8,deckz(117)+.1),.1,materials['dark'],detailcol,vertices=6)
 for x in range(-119,124,5):
  y=sign*(width(x)-.2);z=deckz(x)
  rod('Rail stanchion',(x,y,z),(x,y,z+1),.04,materials['edge'],detailcol,vertices=5)
 for x in range(-119,122,3):
  for dz in [.45,1.0]:rod('Deck rail',(x,sign*(width(x)-.2),deckz(x)+dz),(x+3,sign*(width(x+3)-.2),deckz(x+3)+dz),.025,materials['edge'],detailcol,vertices=4)
# Underwater geometry follows the photographed three-shaft/twin-rudder arrangement.
for y,xend in [(-5,-103),(0,-108),(5,-103)]:
 rod('Propeller shaft',(-65,y,-7.0),(xend,y,-4.5),.22,materials['edge'],undercol,vertices=16)
 rod('Propeller hub',(xend+1,y,-4.5),(xend-1,y,-4.5),.65,materials['bronze'],undercol,.4,20)
 for a in [0,math.tau/3,2*math.tau/3]:
  blade=[(xend,y+.45*math.cos(a),-4.5+.45*math.sin(a)),(xend-.35,y+2.35*math.cos(a+.15),-4.5+2.35*math.sin(a+.15)),(xend+.25,y+2.2*math.cos(a+.55),-4.5+2.2*math.sin(a+.55)),(xend+.4,y+.55*math.cos(a+.9),-4.5+.55*math.sin(a+.9))]
  mesh('Screw blade',blade,[(0,1,2,3)],materials['bronze'],undercol)
for y in [-3,3]:box('Rudder',(-111,y,-3.7),(4,.3,3.3),materials['oxide'],undercol)
for sign in [-1,1]:
 mesh('Bilge keel',[(-47,sign*14.5,-7),(-40,sign*16.4,-7.7),(37,sign*16.4,-7.7),(46,sign*14.5,-7)],[(0,1,2,3)],materials['oxide'],undercol)
for ob in scene.objects:
 if ob.type=='MESH' and not ob.get('assemblyId'):ob['assemblyId']='superstructure' if ob.users_collection[0] in [supercol,detailcol] else 'hull-underwater' if ob.users_collection[0]==undercol else 'hull'
# Inspectable volumes are not exported; game inspection reads the same definition.
for a in DEF['armor']:
 if a.get('plate',{}).get('mountId'):continue
 v=[(-z,-x,y) for x,y,z in a['plate']['vertices']]
 ob=mesh(a['name'],v,[tuple(range(len(v)))],materials['oxide'],simcol);ob['exportRole']='simulation';ob.hide_render=True
for c in DEF['compartments']:
 x,y,z=c['center'];sx,sy,sz=c['size'];ob=box(c['name'],(-z,-x,y),(sz,sx,sy),materials['edge'],simcol);ob['exportRole']='simulation';ob.hide_render=True
simcol.hide_render=True;simcol.hide_viewport=True
for name,loc in [('funnel-cap',(-2,0,23.5)),('mainmast-top',(-23.9,0,48.5))]:
 ob=bpy.data.objects.new('landmark.'+name,None);scene.collection.objects.link(ob);ob.location=loc;ob['nodeId']='landmark.'+name
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('INDEPENDENT BISMARCK SOURCE',len(scene.objects),'objects',flush=True)

"""Midships: funnel casing, cap, galleries and searchlight housings, side hangars and gig platforms, boats,
aircraft cranes, the transverse catapult, and the funnel-gallery 20 mm foundations.

Authored in the true blueprint frame (recipe x = -runtime z, recipe y = -runtime x). pgsb708 A supplies the
target shapes; every shape below is original construction.
"""
from bismarck_kit import *
def B(x,y,z):
 # Runtime (x starboard, y up, z aft) to the recipe frame.
 return (-z,-x,y)
def beam(name,a,b,w,h,mat=None,col=None,up=(0,0,1)):
 # Rectangular-section member from a to b: w across, h along `up` projected square to the axis.
 a,b=Vector(a),Vector(b);ax=(b-a).normalized();u=Vector(up)-ax*ax.dot(Vector(up))
 if u.length<1e-4:u=ax.orthogonal()
 u.normalize();s=ax.cross(u).normalized()
 vs=[tuple(p+s*sx*w/2+u*sy*h/2) for p in [a,b] for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
 return outward(mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat or materials['naval'],col or detailcol))
def outward(ob):
 # Consistent outward normals on a closed shell, whatever the mirror side it was built for.
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(ob.data);bm.free();return ob
def prism(name,ring_a,ring_b,mat,col):
 n=len(ring_a)
 return outward(mesh(name,list(ring_a)+list(ring_b),[tuple(range(n)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat,col))
def decal(name,pts,facing,mat):
 # A flat polygon wound so its normal faces `facing`.
 p=[Vector(q) for q in pts];nrm=(p[1]-p[0]).cross(p[2]-p[0])
 return mesh(name,pts,[tuple(range(len(pts))) if nrm.dot(Vector(facing))>0 else tuple(reversed(range(len(pts))))],mat,detailcol)
# ---------------------------------------------------------------- funnel
CAP_X=-2.01  # recipe x of the raked inner cap's centre (runtime z 2.01)
GALLERY=17.57  # searchlight gallery deck top
def cap_top(x):
 # The inner cap's mouth is one inclined plane: 25.0 m at its forward lip, 23.43 m aft.
 return 25.0+(23.43-25.0)*(-x+2.33)/(6.35+2.33)
def jacket_rings():
 V=[B(*v) for v in structures['funnel-jacket']['surface']['vertices']]
 return [V[i:i+64] for i in range(0,len(V),64)]
def band_at(rings,zz,step=2):
 pts=[]
 for i in range(0,64,step):
  for a,b in zip(rings,rings[1:]):
   if a[i][2]<=zz<=b[i][2] and b[i][2]>a[i][2]:
    t=(zz-a[i][2])/(b[i][2]-a[i][2]);pts.append(tuple(a[i][k]+(b[i][k]-a[i][k])*t for k in range(3)));break
 return pts
def nearest_wall(rings,p,zz):
 return min(band_at(rings,zz,1),key=lambda q:(q[0]-p[0])**2+(q[1]-p[1])**2)
def stadium(front,aft,hw,n):
 # n points evenly spaced along a stadium path (recipe frame, bow +x) with semicircular ends of radius hw.
 straight=(front-hw)-(aft+hw);per=2*straight+2*math.pi*hw;out=[]
 for i in range(n):
  s=per*i/n
  if s<straight:out.append((aft+hw+s,hw));continue
  s-=straight
  if s<math.pi*hw:a=s/hw;out.append((front-hw+hw*math.sin(a),hw*math.cos(a)));continue
  s-=math.pi*hw
  if s<straight:out.append((front-hw-s,-hw));continue
  a=(s-straight)/hw;out.append((aft+hw-hw*math.sin(a),-hw*math.cos(a)))
 return out
def wall_ladder(name,p0,z1,along,width=.44):
 # Vertical ladder standing off a wall: rails spaced along `along` (a horizontal unit vector), rungs every 0.3 m.
 p0=Vector(p0);d=Vector((along[0],along[1],0)).normalized()*width/2
 for s in [-1,1]:rod(name+' rail',p0+d*s,Vector((p0.x,p0.y,z1))+d*s,.03,materials['light'],detailcol,vertices=5)
 for i in range(1,int((z1-p0.z)/.3)+1):
  zz=p0.z+i*.3;c=Vector((p0.x,p0.y,zz));rod(name+' rung',c-d,c+d,.018,materials['edge'],detailcol,vertices=4)
def funnel_casing():
 rings=jacket_rings();casing=rings[:7];rim=rings[7];mouth=rings[9]
 # Rolled lip round the casing top and a ring of short hexagonal cowls on the flat ledge inside it.
 polyline('Funnel casing rolled rim',rim[::2],.065,materials['edge'],supercol,True,6)
 for x,y in stadium(2.93,-6.97,2.35,34):
  cyl('Funnel ledge cowl',(x,y,23.41),.15,.62,materials['naval'],supercol,6)
  cyl('Funnel ledge cowl cap',(x,y,23.74),.19,.05,materials['edge'],supercol,6)
 # Raked inner cap: rolled mouth, plate thickness, sooted inner wall and the uptake below.
 polyline('Funnel cap rolled mouth',mouth[::2],.045,materials['edge'],supercol,True,6)
 inner=[(CAP_X+(x-CAP_X)*.957,y*.94,z-.03) for x,y,z in mouth];N=64
 mesh('Funnel cap plate thickness',mouth+inner,[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['edge'],supercol)
 mesh('Funnel cap inner wall',inner+[(x,y,z-1.4) for x,y,z in inner],[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['dark'],supercol)
 mesh('Recessed uptake darkness',[(x,y,z-1.37) for x,y,z in inner],[tuple(reversed(range(N)))],materials['dark'],supercol)
 # Open protective grating in the plane of the mouth: transverse bars and two longitudinal stringers.
 def chord(xx):
  hits=[]
  for a,b in zip(inner,inner[1:]+inner[:1]):
   if min(a[0],b[0])<=xx<=max(a[0],b[0]) and abs(a[0]-b[0])>1e-4:hits.append(a[1]+(b[1]-a[1])*(xx-a[0])/(b[0]-a[0]))
  return (min(hits),max(hits)) if len(hits)>=2 else None
 for xx in [1.25,-.45,-2.15,-3.85,-5.55]:
  c=chord(xx)
  if c:rod('Funnel cap grating bar',(xx,c[0],cap_top(xx)-.1),(xx,c[1],cap_top(xx)-.1),.035,materials['edge'],supercol,vertices=6)
 for yy in [-.55,.55]:
  a,b=-6.1,2.1;rod('Funnel cap grating stringer',(a,yy,cap_top(a)-.14),(b,yy,cap_top(b)-.14),.04,materials['edge'],supercol,vertices=6)
 # Horizontal plating beads follow the casing, including its swept forward foot.
 for zz in [13.3,15.2,19.4,21.1,22.55]:
  polyline('Funnel plating bead',band_at(casing,zz),.028,materials['edge'],supercol,True,4)
 # Twin steam pipes up the middle of the after face, bent aft over the rim.
 for yy in [-.28,.28]:
  polyline('Funnel steam pipe',[(-7.4,yy,8.3),(-7.4,yy,23.0),(-7.55,yy,23.5),(-7.62,yy,24.3)],.085,materials['light'],supercol,vertices=8)
  for zz in [10.6,13.3,16.2,19.4,21.1]:rod('Steam pipe clip',(-7.4,yy,zz),(-7.2,yy,zz),.03,materials['edge'],supercol,vertices=5)
 # Sirens on the after and forward faces (pgsb708 siren positions), each on a bracket to the casing.
 for p in [B(-.17,21.01,7.66),B(-1.95,21.32,-3.29)]:
  w=nearest_wall(casing,p,p[2]-.35)
  rod('Funnel siren bracket',(w[0],w[1],p[2]-.35),(p[0],p[1],p[2]-.35),.03,materials['edge'],supercol,vertices=5)
  rod('Funnel siren trumpet',(p[0],p[1],p[2]-.55),(p[0],p[1],p[2]+.55),.07,materials['naval'],supercol,.14,8)
 for sign in [-1,1]:
  # Side ladders from the searchlight gallery to the rim, after ladders from the 01 deck to the galleries.
  wall_ladder('Funnel casing ladder',(-2.3,sign*2.84,GALLERY),23.08,(1,0))
  wall_ladder('Funnel after ladder',(-7.35,sign*1.05,10.38),GALLERY,(0,1))
  # Louvred fan-room intakes on the uptake base between the hangars' ends and the gallery column.
  vent('Funnel fan room intake',(-3.1,sign*2.83,10.05),(1.4,.14,1.25),sign)
 # Lower gallery round the after end, on struts to the casing.
 lower=14.7;path=[(-2.2,-3.55)]+[(-4.9-3.25*math.sin(a),-3.55*math.cos(a)) for a in [i*math.pi/12 for i in range(1,12)]]+[(-2.2,3.55)]
 inner_path=[nearest_wall(casing,(x,y,lower),lower) for x,y in path]
 vs=[(x,y,lower) for x,y in path]+[(x,y,lower) for x,y,_ in inner_path];n=len(path)
 deck=mesh('Funnel lower gallery',vs,[(i,i+1,n+i+1,n+i) for i in range(n-1)],materials['roof'],supercol)
 mod=deck.modifiers.new('Deck plate thickness','SOLIDIFY');mod.thickness=.12
 rail('Funnel lower gallery',[(x,y,lower+.005) for x,y in path],.9,1.5,False,col=supercol)
 for (x,y),(wx,wy,_) in list(zip(path,inner_path))[1::2]:
  rod('Funnel lower gallery strut',(x,y,lower-.1),(wx,wy,lower-1.3),.055,materials['naval'],supercol,vertices=6)
def funnel_gallery():
 # pgsb708 searchlight gallery (traced at 17.5 m): it wraps the after end of the casing from the forward
 # housings' rear edge, with round lobes carrying the after searchlights.
 stb=[(2.62,.88),(5.82,.88),(5.92,.98),(5.92,2.78),(6.28,3.66),(6.24,4.5),(5.2,8.42),(4.78,9.0),(4.26,9.32),(3.54,9.4),(2.94,9.24),(2.4,8.78),(2.14,8.4),(1.9,8.32)]
 outline=stb+[(-x,z) for x,z in reversed(stb)]
 pts=[(-z,-x) for x,z in outline]
 extrude('Funnel searchlight gallery',pts,GALLERY-.18,.18,materials['roof'],supercol)
 rail('Funnel searchlight gallery',[(-z,-x,GALLERY+.005) for x,z in outline],.9,1.5,False,col=supercol)
 rings=jacket_rings()
 for x,z in [(5.9,1.9),(6.1,3.7),(5.8,5.9),(5.0,8.5),(4.0,9.35),(2.9,9.2),(1.9,8.32)]:
  for sign in [-1,1]:
   p=(-z,-sign*x,GALLERY-.2);w=nearest_wall(rings,p,GALLERY-1.8)
   rod('Gallery bracket',p,w,.07,materials['naval'],supercol,vertices=6)
 # A curved walkway round the casing front joins the two forward searchlight bowls (pgsb708, 18.55 m),
 # with a small siren platform above it.
 cz=-.72;r0=2.62
 for level,r1,a0,a1,rails in [(18.6,3.88,.72,math.pi-.72,True),(20.62,4.15,1.05,math.pi-1.05,True)]:
  ang=[a0+(a1-a0)*i/12 for i in range(13)]
  outer=[(-(cz-r1*math.sin(a)),-r1*math.cos(a)) for a in ang];inner=[(-(cz-r0*math.sin(a)),-r0*math.cos(a)) for a in reversed(ang)]
  extrude('Funnel front walkway' if level<20 else 'Funnel siren platform',outer+inner,level-.1,.1,materials['roof'],supercol)
  if rails:rail('Funnel front walkway',[(x,y,level+.005) for x,y in outer],.9,1.3,False,col=supercol)
  for a in ang[1:-1:3]:
   rod('Funnel front walkway bracket',(-(cz-(r1-.15)*math.sin(a)),-(r1-.15)*math.cos(a),level-.12),(-(cz-(r0+.03)*math.sin(a)),-(r0+.03)*math.cos(a),level-1.3),.06,materials['naval'],supercol,vertices=6)
 # Fan room round the after foot of the casing: a low louvred house with a railed roof.
 fan=[(-6.35,-2.9),(-8.4,-2.9),(-8.4,2.9),(-6.35,2.9)]
 extrude('Funnel fan room',fan,8.3,2.0,materials['naval'],supercol,.03)
 extrude('Funnel fan room roof',[(-6.35,-2.96),(-8.46,-2.96),(-8.46,2.96),(-6.35,2.96)],10.3,.08,materials['roof'],supercol)
 rail('Funnel fan room',[(-6.4,-2.92,10.385),(-8.42,-2.92,10.385),(-8.42,2.92,10.385),(-6.4,2.92,10.385)],.85,1.3,False,col=supercol)
 for yy in [-1.6,1.6]:
  # Louvred intake on the after face: frame, dark recess and horizontal louvres.
  box('Funnel fan room louvre frame',(-8.45,yy,9.25),(.1,1.5,1.2),materials['naval'],detailcol)
  box('Funnel fan room louvre recess',(-8.51,yy,9.25),(.025,1.3,.98),materials['dark'],detailcol)
  for k in range(8):box('Funnel fan room louvre',(-8.54,yy,8.8+k*.13),(.09,1.36,.045),materials['edge'],detailcol)
 for sign in [-1,1]:
  vent('Funnel fan room side louvre',(-7.4,sign*2.97,9.3),(1.5,.14,1.1),sign)
  # Mushroom-headed exhaust cowls bent over the fan-room roof.
  polyline('Funnel fan exhaust cowl',[(-8.0,sign*1.0,10.38),(-8.0,sign*1.0,11.35),(-8.25,sign*1.0,11.65),(-8.55,sign*1.0,11.4)],.16,materials['naval'],supercol,vertices=8)
def forward_housing(name,sign):
 # pgsb708's forward searchlights stand in deep bowls on the casing sides: an ellipsoidal quarter shell
 # (outboard 3.0 m, fore and aft 2.05 m, 2.95 m deep below its 19.75 m rim) carried straight in to the casing,
 # with a 1.8 m platform inside and an arched hood against the casing above the light.
 zc=-1.45;xc=3.35;ax,az,ay=3.0,2.05,2.95;top=19.75;levels=[16.8,16.95,17.2,17.6,18.1,18.6,19.2,top];m=14
 def fullness(y):
  # Superelliptic depth profile: the pgsb708 bowl is fuller at its bottom than an ellipsoid.
  return (1-max(0.0,min(1.0,(top-y)/ay))**2.6)**(1/2.6)
 rings=[]
 for y in levels:
  s=fullness(y);ring=[(2.62,zc+az*s)]
  for i in range(m+1):
   a=math.pi*i/m;ring.append((xc+ax*s*math.sin(a),zc+az*s*math.cos(a)))
  ring.append((2.62,zc-az*s));rings.append([(-z,-sign*x,y) for x,z in ring])
 k=len(rings[0]);vs=[p for r in rings for p in r]
 fs=[(j*k+i,j*k+i+1,(j+1)*k+i+1,(j+1)*k+i) for j in range(len(rings)-1) for i in range(k-1)]
 bowl=mesh(name+' bowl',vs,fs,materials['naval'],supercol,True)
 mod=bowl.modifiers.new('Shell plate thickness','SOLIDIFY');mod.thickness=.06
 polyline(name+' rolled rim',rings[-1],.05,materials['edge'],supercol,False,5)
 s=fullness(18.6);floor=[(2.62,zc+az*s)]+[(xc+ax*s*math.sin(math.pi*i/m),zc+az*s*math.cos(math.pi*i/m)) for i in range(m+1)]+[(2.62,zc-az*s)]
 extrude(name+' platform',[(-z,-sign*x) for x,z in floor],18.5,.12,materials['roof'],supercol)
 # Arched hood: straight legs to 20.8 m and a flattened arch to 22.2 m, 1 m deep off the casing.
 arch=[(zc+1.87,18.62),(zc+1.87,20.8)]+[(zc+1.87*math.cos(a),20.8+1.4*math.sin(a)) for a in [i*math.pi/10 for i in range(1,10)]]+[(zc-1.87,20.8),(zc-1.87,18.62)]
 n=len(arch);vs=[(-z,-sign*x,y) for x in [2.6,3.62] for z,y in arch]
 hood=mesh(name+' arched hood',vs,[(i,i+1,n+i+1,n+i) for i in range(n-1)],materials['naval'],supercol)
 mod=hood.modifiers.new('Hood plate thickness','SOLIDIFY');mod.thickness=.06
 polyline(name+' hood edge',[(-z,-sign*3.64,y) for z,y in arch],.04,materials['edge'],supercol,False,5)
 for dz in [-1.2,0,1.2]:
  q=min(1.0,math.hypot((4.3-xc)/ax,dz/az));y=top-ay*(1-q**2.6)**(1/2.6)+.05
  rod(name+' bracket',(-(zc+dz),-sign*4.3,y),(-(zc+dz),-sign*2.66,15.4),.07,materials['naval'],supercol,vertices=6)
def funnel_searchlights():
 for sign in [-1,1]:
  forward_housing('Funnel forward searchlight housing',sign)
  x,y,_=B(sign*4.06,0,-1.45)
  searchlight('Funnel forward 1.5 m searchlight',x,y,18.7,-sign*1.25,.92)
  x,y,_=B(sign*3.76,0,7.42)
  searchlight('Funnel after 1.5 m searchlight',x,y,GALLERY+.06,-sign*2.15,.92)
# ---------------------------------------------------------------- hangars
HANGAR_EAVE=11.38;HANGAR_RIDGE=13.03
def draw_side_hangar(s):
 # pgsb708's single hangars: vertical walls to the eaves and an asymmetric pitched roof (ridge 2.75 m in from
 # the outer wall) whose inner slope ends in a flat strip against the uptake casing.
 pts=[(-z,-x) for x,z in s['footprint']];x0=min(p[0] for p in pts);x1=max(p[0] for p in pts)
 sign=1 if sum(p[1] for p in pts)>0 else -1
 inner=min(abs(p[1]) for p in pts);outer=max(abs(p[1]) for p in pts)
 ob=extrude(s['name'],pts,s['baseY'],HANGAR_EAVE-s['baseY'],materials['naval'],supercol,.035);ob['assemblyId']='superstructure-'+s['id']
 prof=[(outer+.14,HANGAR_EAVE-.03),(outer-2.75,HANGAR_RIDGE),(inner+.32,HANGAR_EAVE),(inner-.02,HANGAR_EAVE)]
 vs=[(x,sign*y,z) for x in [x0-.12,x1+.12] for y,z in prof];n=len(prof)
 roof=mesh(s['name']+' pitched roof',vs,[(i,i+1,n+i+1,n+i) for i in range(n-1)],materials['roof'],supercol);roof['assemblyId']='superstructure-'+s['id']
 mod=roof.modifiers.new('Roof plate thickness','SOLIDIFY');mod.thickness=.08;mod.offset=-1
 for x in [x0,x1]:
  gable=mesh(s['name']+' gable end',[(x,sign*outer,HANGAR_EAVE),(x,sign*(outer-2.75),HANGAR_RIDGE-.04),(x,sign*(inner+.32),HANGAR_EAVE)],[(0,1,2)],materials['naval'],supercol)
  gable['assemblyId']='superstructure-'+s['id']
 polyline(s['id']+' ridge',[(x0-.12,sign*(outer-2.75),HANGAR_RIDGE+.03),(x1+.12,sign*(outer-2.75),HANGAR_RIDGE+.03)],.05,materials['edge'],supercol)
 for x in [x0+2.3,x0+5.7,x0+9.1]:
  polyline(s['id']+' roof seam',[(x,sign*(outer+.1),HANGAR_EAVE+.03),(x,sign*(outer-2.75),HANGAR_RIDGE+.03),(x,sign*(inner+.32),HANGAR_EAVE+.03)],.022,materials['edge'])
 for x in [x0+1.9,x0+4.6,x0+7.3]:porthole(s['id']+' scuttle',(x,sign*(outer+.05),10.4),(0,sign,0),.16)
 door(s['id']+' watertight door',x0+1.1,sign*(outer+.05),8.43,sign)
 # pgsb708 shows plain gable ends; vertical stiffeners break up the after one.
 ridge=outer-2.75
 def roof_at(a):
  if a>=ridge:return HANGAR_RIDGE-(a-ridge)/2.75*(HANGAR_RIDGE-HANGAR_EAVE)
  return HANGAR_EAVE+max(0,a-inner-.32)/(ridge-inner-.32)*(HANGAR_RIDGE-HANGAR_EAVE)
 for f in [.25,.5,.75]:
  a=inner+(outer-inner)*f;top=roof_at(a)-.05
  box(s['id']+' gable stiffener',(x0-.05,sign*a,(8.35+top)/2),(.08,.12,top-8.35),materials['edge'],detailcol)
for _sid in ['hangar-port','hangar-starboard']:structure_drawers[_sid]=draw_side_hangar
def hangars():
 # The double hangar keeps its forward folding doors; its sides carry ventilation.
 name,x,y,length,breadth,base='Double hangar',-20.9,0,9.82,11.4,13.15
 xx=x+length/2+.035;floor=8.4;doorheight=base-floor-.12;leaves=12;opening=breadth-.65
 for i in range(leaves):
  yy=y-opening/2+opening*(i+.5)/leaves
  box(name+' folding door',(xx,yy,floor+doorheight/2),(.10,opening/leaves-.035,doorheight),materials['naval'],detailcol)
  for dz in [.65,2.1,3.55]:box(name+' door stiffener',(xx+.065,yy,floor+dz),(.07,opening/leaves-.13,.055),materials['edge'],detailcol)
 rod(name+' door track',(xx,y-opening/2-.1,floor+doorheight+.1),(xx,y+opening/2+.1,floor+doorheight+.1),.075,materials['edge'],detailcol,vertices=8)
 for sign in [-1,1]:vent(name+' ventilation',(x,y+sign*(breadth/2+.035),base-1.15),(1.8,.12,1.1),sign)
# ---------------------------------------------------------------- gig platforms
def draw_gig_platform(s):
 # Open skid platform cantilevered from the hangar wall; the 150 mm gunhouse sweeps beneath it.
 pts=[(-z,-x) for x,z in s['footprint']];x0=min(p[0] for p in pts);x1=max(p[0] for p in pts)
 y0=min(p[1] for p in pts);y1=max(p[1] for p in pts);top=s['baseY']+s['height']
 sign=1 if y0>0 else -1;inner=y0 if sign>0 else y1;outer=y1 if sign>0 else y0;my=(inner+outer)/2
 deck=box(s['name'],((x0+x1)/2,my,top-.04),(x1-x0,y1-y0,.08),materials['roof'],supercol);deck['assemblyId']='superstructure-'+s['id']
 for x in [x0+.12,(x0+x1)/2,x1-.12]:
  box(s['id']+' deck beam',(x,my,top-.2),(.2,y1-y0,.24),materials['naval'],supercol)
  rod(s['id']+' wall knee',(x,inner+sign*.04,top-1.45),(x,inner+sign*1.55,top-.3),.065,materials['naval'],supercol,vertices=6)
 for f in [.5,.97]:box(s['id']+' stringer',((x0+x1)/2,inner+(outer-inner)*f,top-.2),(x1-x0,.16,.22),materials['naval'],supercol)
 for xa,xb in [(x0+.12,(x0+x1)/2),((x0+x1)/2,x1-.12)]:
  for a,b in [(xa,xb),(xb,xa)]:rod(s['id']+' diagonal brace',(a,inner+sign*.1,top-.25),(b,outer-sign*.1,top-.25),.04,materials['naval'],supercol,vertices=4)
 rail(s['id']+' guard',[(x0,outer,top+.005),(x1,outer,top+.005)],.9,1.55,False,col=supercol)
for _sid in ['forward-port-gig-shelf','forward-starboard-gig-shelf']:structure_drawers[_sid]=draw_gig_platform
# ---------------------------------------------------------------- boats
boat_support=None
def boat(name,x,y,z,length,breadth,cabin=False,yaw=0,keel=None,support_surface=None,cradles=(-.27,.25)):
 before=set(bpy.data.objects)
 # Seat the keel consistently above the actual roof, including raised platforms.
 z=boat_support.below(x,y,z+5)+.40 if keel is None else keel
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
 for t in cradles:
  xx=x+length*t;half,sheer=shape(t)
  box(name+' cradle crossbeam',(xx,y,z-.03),(.23,breadth*.83,.12),materials['edge'],detailcol)
  for sign in [-1,1]:
   yy=y+sign*breadth*.28;foot=Vector((xx-x,yy-y,0));foot.rotate(Matrix.Rotation(yaw,3,'Z'));floor=(support_surface or boat_support).below(x+foot.x,y+foot.y,z+.025)
   box(name+' cradle leg',(xx,yy,(floor+z+.02)/2),(.21,.20,max(.04,z+.04-floor)),materials['edge'],detailcol)
   rod(name+' fitted cradle arm',(xx,y,z-.01),(xx,y+sign*half*.85,z+depth*.55+sheer),.057,materials['edge'],detailcol,vertices=8)
 if cabin:
  # Long low after cabin, shallow sloped wheelhouse and a flush forward deck.
  outline=[(x+t*length,y+w*breadth*.49) for t,w,sh in stations]+[(x+t*length,y-w*breadth*.49) for t,w,sh in reversed(stations)]
  extrude(name+' launch deck',outline,z+depth-.015,.06,materials['deck'],detailcol)
  gig='gig' in name.lower();cabx=x-length*(.08 if gig else .13);cabbase=z+depth+.045;cabheight=.90 if gig else .95;cablength=length*(.32 if gig else .43)
  pts=rounded_rect(cabx,y,cablength,breadth*.67,.20,3)
  extrude(name+' cabin sides',pts,cabbase,cabheight,materials['naval'],detailcol,.025)
  roof=rounded_rect(cabx,y,cablength+.20,breadth*.71,.22,3)
  n=len(roof);ridge=[(a,b*.88+y*.12,cabbase+cabheight+.16) for a,b in roof]
  mesh(name+' cambered cabin roof',[(a,b,cabbase+cabheight) for a,b in roof]+ridge,[tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['canvas'],detailcol)
  for sign in [-1,1]:
   for t in [-.155,-.055,.065,.155]:
    xx=cabx+cablength*t/.43;yy=y+sign*breadth*.339
    box(name+' framed cabin port',(xx,yy,cabbase+.48),(length*.074,.045,.42),materials['edge'],detailcol)
    box(name+' cabin glazing',(xx,yy+sign*.027,cabbase+.48),(length*.060,.025,.32),materials['glass'],detailcol)
   box(name+' windscreen frame',(cabx+cablength*.505,y+sign*breadth*.16,cabbase+.49),(.045,breadth*.27,.45),materials['edge'],detailcol)
   box(name+' windscreen',(cabx+cablength*.505+.027,y+sign*breadth*.16,cabbase+.49),(.020,breadth*.23,.35),materials['glass'],detailcol)
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
 # Rotate the original boat and cradle together; all cradle feet use world support.
 if yaw:
  transform=Matrix.Translation((x,y,0))@Matrix.Rotation(yaw,4,'Z')@Matrix.Translation((-x,-y,0))
  bpy.context.view_layer.update()
  for ob in set(bpy.data.objects)-before:ob.matrix_world=transform@ob.matrix_world
 return set(bpy.data.objects)-before
def boats():
 global boat_support
 boat_support=SupportSurface([*hullcol.objects,*supercol.objects])
 # The approved A fit has asymmetric forward stowage: two nested port cutters over the port hangar,
 # the captain's gig over the starboard hangar, and the admiral's gigs on the outboard skid platforms.
 for yy in [4.06,6.38]:
  cutter=boat('Port cutter',5.97,yy,12.63,8.70,2.07,False,keel=12.66)
  boat('Nested port longboat',6.0,yy,13.54,6.31,1.65,False,keel=13.56,support_surface=SupportSurface(list(cutter)))
 boat('Starboard captain gig',6.31,-3.88,12.39,9.21,2.56,True,keel=12.42)
 for sign in [-1,1]:
  boat('Admiral gig',6.85,sign*9.30,10.83,11.14,2.67,True,keel=10.84,cradles=(-.2,.3))
  boat('Outer aft motor launch',-21.95,sign*6.86,11.6,11.54,3.00,True,keel=11.60)
  # The inner launches lie with their bows toward the ship's side (pgsb708: 13.9 deg).
  boat('Inner aft motor launch',-19.56,sign*2.91,13.59,11.54,3.00,True,yaw=sign*math.radians(13.9),keel=13.59)
# ---------------------------------------------------------------- aircraft cranes
def crane(sign):
 # pgsb708 GM900 at the ship's side abreast the funnel: a slewing machinery base on the main deck with side
 # frames, winch drums and a rear gantry carrying the topping-sheave housing, and a two-legged tapered
 # box-girder jib stowed rising forward and inboard toward the tower (head at 21.6 m).
 O=Vector(B(sign*13.3,0,5.7));O.z=SupportSurface([*hullcol.objects]).below(O.x,O.y,9.0)
 D=Vector((.8235,sign*.5673,0));N=Vector((.5673,-sign*.8235,0));Z=Vector((0,0,1))
 yaw=math.atan2(D.y,D.x)
 def L(u,v,w):return O+D*u+N*v+Z*w
 def lbox(name,u,v,w,su,sv,sw,mat='naval'):
  ob=box(name,tuple(L(u,v,w)),(su,sv,sw),materials[mat],detailcol);ob.rotation_euler.z=yaw;return ob
 cyl('Aircraft crane slewing ring',tuple(L(0,.2,.12)),2.1,.24,materials['edge'],detailcol,28)
 lbox('Aircraft crane turntable',0,.2,.36,4.0,3.5,.24,'roof')
 for v in [-1.4,1.8]:
  # Side frames: tall plates with a lightening opening, rising toward the jib foot and the gantry.
  outline=[(-2.0,.48),(1.95,.48),(1.95,2.6),(1.5,3.05),(-1.1,3.05),(-2.0,2.6)]
  hole=[(-1.2,1.0),(.9,1.0),(.9,2.15),(-1.2,2.15)]
  prism('Aircraft crane side frame',[tuple(L(u,v-.07,w)) for u,w in outline],[tuple(L(u,v+.07,w)) for u,w in outline],materials['naval'],detailcol)
  for dv in [-.075,.075]:decal('Aircraft crane frame opening',[tuple(L(u,v+dv,w)) for u,w in hole],N*dv,materials['dark'])
 lbox('Aircraft crane machinery house',-.9,.2,1.35,2.0,3.0,1.75)
 lbox('Aircraft crane motor casing',1.45,.2,.95,.9,1.2,.9,'edge')
 for v,r in [(-.55,.55),(.95,.55)]:
  rod('Aircraft crane winch drum',tuple(L(.55,v-.55,1.05)),tuple(L(.55,v+.55,1.05)),r,materials['edge'],detailcol,vertices=14)
  for dv in [-.58,.58]:rod('Aircraft crane drum flange',tuple(L(.55,v+dv-.03,1.05)),tuple(L(.55,v+dv+.03,1.05)),r+.14,materials['naval'],detailcol,vertices=14)
 lbox('Aircraft crane operating platform',-.4,.2,3.12,3.2,3.5,.1,'roof')
 rail('Aircraft crane operating platform',[tuple(L(u,v,3.17)) for u,v in [(1.15,1.95),(-1.95,1.95),(-1.95,-1.55),(1.15,-1.55)]],.9,1.4,False)
 ladder('Aircraft crane base ladder',tuple(L(-2.25,1.2,.36)),tuple(L(-2.25,1.2,3.1)),.42)
 # Rear gantry: two posts from the base to the topping-sheave housing, whose arms reach forward to a spreader.
 for v in [-.75,1.15]:
  beam('Aircraft crane gantry post',L(-2.0,v,.4),L(-2.0,v,4.0),.22,.3,materials['naval'])
 rod('Aircraft crane sheave housing',tuple(L(-2.0,-.95,4.05)),tuple(L(-2.0,1.35,4.05)),.6,materials['naval'],detailcol,vertices=8)
 for v in [-.98,1.38]:rod('Aircraft crane sheave boss',tuple(L(-2.0,v,4.05)),tuple(L(-2.0,v+(-.08 if v<0 else .08),4.05)),.22,materials['edge'],detailcol,vertices=8)
 for v in [-.9,1.3]:beam('Aircraft crane topping arm',L(-1.75,v,4.4),L(.95,v,4.7),.16,.26,materials['naval'])
 rod('Aircraft crane topping spreader',tuple(L(.95,-1.15,4.7)),tuple(L(.95,1.55,4.7)),.1,materials['edge'],detailcol,vertices=8)
 # Jib: two tapered box legs from hinge pins at the frame heads to the head sheaves, with three diaphragms
 # and a wide spreader near the top that takes the topping lift.
 foot,head=Vector((1.7,0,2.75)),Vector((16.3,0,16.05))
 def leg(t,side):
  p=foot+(head-foot)*t;spread=1.62*(1-t)+.26*t;return L(p.x,.2*(1-t)+.05*t+side*spread,p.z)
 for side in [-1,1]:
  for a,b,w,h in [(0,.52,.42,.7),(.5,1,.32,.52)]:
   beam('Aircraft crane jib box girder',leg(a,side),leg(b,side),w,h,materials['naval'])
  rod('Aircraft crane jib hinge pin',tuple(L(foot.x,.2+side*1.3,foot.z)),tuple(L(foot.x,.2+side*1.95,foot.z)),.14,materials['edge'],detailcol,vertices=8)
 for t in [.22,.46,.66]:beam('Aircraft crane jib diaphragm',leg(t,-1),leg(t,1),.3,.42,materials['naval'])
 t=.79;a,b=leg(t,-1),leg(t,1);c=(a+b)/2;dv=(b-a).normalized()
 rod('Aircraft crane jib spreader',tuple(c-dv*.95),tuple(c+dv*.95),.1,materials['edge'],detailcol,vertices=8)
 hp=L(head.x+.2,.05,head.z+.1)
 beam('Aircraft crane head block',L(head.x-.7,.05,head.z-.45),L(head.x+.35,.05,head.z+.15),.66,.56,materials['naval'])
 for dv2 in [-.2,.2]:
  a=L(head.x+.25,.05+dv2-.06,head.z+.1);b=L(head.x+.25,.05+dv2+.06,head.z+.1)
  rod('Aircraft crane head sheave',tuple(a),tuple(b),.42,materials['edge'],detailcol,vertices=14)
 hook=hp-Vector((0,0,2.3))
 for dv2 in [-.1,.1]:rod('Aircraft crane fall',tuple(hp+N*dv2-Vector((0,0,.35))),tuple(hook+N*dv2+Vector((0,0,.35))),.018,materials['dark'],detailcol,vertices=5)
 cyl('Aircraft crane hook block',tuple(hook+Vector((0,0,.2))),.2,.45,materials['edge'],detailcol,10)
 ring('Aircraft crane hook',tuple(hook-Vector((0,0,.12))),tuple(D),.13,.035,materials['edge'],10)
 # Topping lift from the sheave housing to the spreader, hoist rope from the winch drum over the head sheave.
 for f in [-.7,0,.7]:rod('Aircraft crane topping lift',tuple(L(.95,.2+f*1.2,4.75)),tuple(c+dv*f),.018,materials['dark'],detailcol,vertices=5)
 for v in [-.2,.6]:rod('Aircraft crane hoist rope',tuple(L(.55,v,1.6)),tuple(L(head.x+.05,.05,head.z-.25)),.018,materials['dark'],detailcol,vertices=5)
def cranes():
 for sign in [-1,1]:crane(sign)
# ---------------------------------------------------------------- catapult
def catapult():
 # pgsb708 gc001: two box-girder halves (1.08-17.0 m either side of the centreline, 1.5 m wide, 0.78 m deep)
 # lying in the transverse trough of the 01 deckhouse, with hexagonal lightening holes, an open braced top,
 # end sheaves, a launch carriage with its trestles on each half, and pillars to the main deck outboard.
 xa,xb=-9.8,-11.25;xm=(xa+xb)/2;zb,zt=7.64,8.42;y0,y1=1.08,17.0
 for sign in [-1,1]:
  s=lambda y:sign*y
  for x in [xa,xb]:
   # Side plate with a tapered outer end.
   prof=[(y0,zb),(y1-1.2,zb),(y1,zb+.42),(y1,zt),(y0,zt)]
   prism('Catapult side plate',[(x-.025,s(y),z) for y,z in prof],[(x+.025,s(y),z) for y,z in prof],materials['naval'],detailcol)
   out=1 if x>xm else -1
   for y in [1.95,2.9,3.85,4.75,5.6,6.5]+[10.6,11.5,12.35,13.2,14.05,14.9]:
    decal('Catapult lightening hole',[(x+out*.03,s(y+.19*math.cos(math.tau*k/6)),8.03+.19*math.sin(math.tau*k/6)) for k in range(6)],(out,0,0),materials['dark'])
  box('Catapult bottom plate',(xm,s((y0+y1-1.2)/2),zb+.03),(xa-xb,y1-1.2-y0,.06),materials['naval'],detailcol)
  for x in [xa-.09,xb+.09]:rod('Catapult top flange',(x,s(y0),zt),(x,s(y1),zt),.07,materials['edge'],detailcol,vertices=6)
  bays=12
  for i in range(bays):
   ya=y0+(y1-y0)*i/bays;yb=y0+(y1-y0)*(i+1)/bays
   rod('Catapult top bracing',(xa-.09,s(ya),zt-.02),(xb+.09,s(yb),zt-.02),.04,materials['naval'],detailcol,vertices=4)
   rod('Catapult top batten',(xa-.09,s(ya),zt-.02),(xb+.09,s(ya),zt-.02),.035,materials['naval'],detailcol,vertices=4)
  for x in [xm+.33,xm-.33]:rod('Catapult carriage rail',(x,s(y0),zt+.07),(x,s(y1-.3),zt+.07),.045,materials['light'],detailcol,vertices=6)
  rod('Catapult outer sheave',(xa+.1,s(16.25),8.05),(xb-.1,s(16.25),8.05),.42,materials['edge'],detailcol,vertices=16)
  rod('Catapult inner sheave',(xa+.1,s(1.75),8.2),(xb-.1,s(1.75),8.2),.26,materials['edge'],detailcol,vertices=12)
  # Launch carriage stowed amidships of each half, with two braced trestles carrying the aircraft cradle.
  box('Catapult launch carriage',(xm,s(8.45),zt+.2),(1.3,2.95,.18),materials['roof'],detailcol)
  for y in [7.35,9.55]:rod('Catapult carriage wheels',(xa-.1,s(y),zt+.1),(xb+.1,s(y),zt+.1),.12,materials['edge'],detailcol,vertices=10)
  for x in [xa-.2,xb+.2]:
   rod('Catapult trestle post',(x,s(7.2),zt+.28),(x,s(7.2),10.62),.06,materials['edge'],detailcol,vertices=6)
   rod('Catapult trestle post',(x,s(9.85),zt+.28),(x,s(9.85),10.45),.06,materials['edge'],detailcol,vertices=6)
   rod('Catapult trestle strut',(x,s(9.85),10.45),(x,s(7.6),zt+.28),.05,materials['edge'],detailcol,vertices=6)
   rod('Catapult trestle strut',(x,s(7.2),10.62),(x,s(9.4),zt+.28),.04,materials['edge'],detailcol,vertices=6)
  for y,h in [(7.2,10.62),(9.85,10.45)]:rod('Catapult cradle crosshead',(xa-.2,s(y),h),(xb+.2,s(y),h),.06,materials['edge'],detailcol,vertices=6)
  # Pillars to the main deck where the catapult overhangs the deckhouse.
  for y,lean in [(12.95,0),(15.6,.4)]:
   for x in [xa-.15,xb+.15]:
    rod('Catapult support pillar',(x,s(y+lean),deckz(x)),(x,s(y),zb),.085,materials['naval'],detailcol,vertices=8)
# ---------------------------------------------------------------- AA foundations
own_foundations.update({'starboard-aa-20-3','port-aa-20-3'})
def aa_seats():
 # The funnel-gallery 20 mm guns stand on low pedestals bolted to the gallery deck.
 for m in DEF['mounts']:
  if m['id'] in ('starboard-aa-20-3','port-aa-20-3'):
   x,y,z=B(*m['position']);cyl(m['id']+' gallery seat',(x,y,(GALLERY+z)/2+.005),.5,z-GALLERY+.01,materials['edge'],detailcol,16)
def build():
 # Region entry point, after the forward region.
 funnel_casing();funnel_gallery();funnel_searchlights();hangars();boats();cranes();catapult()
 landmarks['funnel-cap']=(CAP_X,0,24.09)
def after_mounts():
 aa_seats()

"""Bridge tower, conning tower, galleries, main director and its radars."""
from yamato_kit import *
import bmesh


def loft(name,rings,material,col=SUPER,caps=(True,True),smooth=False):
 # Equal rings joined by quads: one closed solid for bowls, fairings and tapered girders.
 n=len(rings[0]);v=[p for r in rings for p in r];f=[]
 for j in range(len(rings)-1):f.extend((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n))
 sides=len(f)
 if caps[0]:f.append(tuple(reversed(range(n))))
 if caps[1]:f.append(tuple(range(len(v)-n,len(v))))
 o=mesh(name,v,f,material,col)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 for p in o.data.polygons:p.use_smooth=smooth and p.index<sides
 return o

def lathe(name,x,y,profile,material,col=SUPER,seg=16,caps=(True,True)):
 return loft(name,[[(x+r*math.cos(i*math.tau/seg),y+r*math.sin(i*math.tau/seg),z) for i in range(seg)] for r,z in profile],material,col,caps,True)

def both(port):
 # Port half listed aft to bow; returns the counter-clockwise closed outline.
 return [(x,-y) for x,y in port]+list(reversed(port))

def ring(pts,z):return [(x,y,z) for x,y in pts]

def scaled(pts,sx,sy,cx=0,cy=0):return [(cx+(x-cx)*sx,cy+(y-cy)*sy) for x,y in pts]

def grow(pts,d):
 # Offset a counter-clockwise outline outward by d, mitred at its corners.
 out=[]
 for a,b,c in zip(pts[-1:]+pts[:-1],pts,pts[1:]+pts[:1]):
  n1=((b[1]-a[1])/math.dist(a,b),(a[0]-b[0])/math.dist(a,b));n2=((c[1]-b[1])/math.dist(b,c),(b[0]-c[0])/math.dist(b,c))
  m=(n1[0]+n2[0],n1[1]+n2[1]);l=math.hypot(*m) or 1;m=(m[0]/l,m[1]/l);k=d/max(.4,m[0]*n1[0]+m[1]*n1[1])
  out.append((b[0]+m[0]*k,b[1]+m[1]*k))
 return out

def circle(x,y,r,n=16):return [(x+r*math.cos(i*math.tau/n),y+r*math.sin(i*math.tau/n)) for i in range(n)]


def control_pod(name,x,y,z,side,tub=0):
 # Hooded searchlight-control and lookout stations: a rounded shell open to
 # the beam, standing either on a deck or on its own conical tub.
 if tub:lathe(name+' tub',x,y,[(.22,z-tub),(.62,z-tub*.5),(.92,z-.12),(.95,z)],naval)
 lathe(name+' hood',x,y,[(.80,z),(.80,z+.92),(.72,z+1.20),(.50,z+1.38),(.08,z+1.44)],naval,caps=(False,True))
 box(name+' sighting opening',(x,y+side*.77,z+1.0),(.78,.08,.34),dark,SUPER)
 box(name+' hood brow',(x,y+side*.80,z+1.22),(.9,.12,.07),edge,SUPER)


def build():
 structure('bridge-foundation');structure('bridge-trunk');structure('operations-tower')
 structure('conning-tower')
 prism('Conning tower roof',[(-z,-x) for x,y,z in S['conning-tower']['surface']['vertices'][-48:]],19.35,19.52,roof,SUPER)
 # Narrow slit band, front rain hood and vertical seams on the conning tower.
 for i in range(11):
  a=-math.pi*.7+i*math.pi*1.4/10
  x=4.85+2.73*math.cos(a);y=2.82*math.sin(a)
  o=box('Conning tower vision slit',(x,y,18.95),(.40,.08,.12),dark,SUPER);o.rotation_euler.z=a+math.pi/2
 shaped_gallery('lower-lookout','Lower signal bridge')
 # The aft gallery sits on a shallow bowl that deepens toward the trunk.
 aft=structure_outline('lower-lookout')
 inner=[(-8.9,2.9),(-7.6,2.9),(-7.0,3.6),(-5.3,4.9),(-3.7,4.9),(-3.5,3.0)]
 loft('Lower signal bridge underside',[ring(aft,22.09),ring([(x,-y) for x,y in inner]+list(reversed(inner)),21.7)],naval)
 # Second lookout: the pjsb018 deck runs about 1.8 m further forward, where
 # its sides step in along the tower chamfer to the Type 98 director houses.
 S['second-lookout-full']=dict(S['second-lookout'],footprint=[[-y,-x] for x,y in both([(-3.54,3.05),(-2.62,5.08),(.9,5.02),(2.95,3.15)])])
 shaped_gallery('second-lookout-full','Secondary lookout bridge')
 structure('forward-lookout-room')
 perimeter_band('Forward lookout rain hood',structure_outline('forward-lookout-room'),25.12,.09,edge,SUPER,.09)
 # Forward lower signal gallery: an open deck wrapping the trunk with the
 # heavy rounded underside that dominates the reference bow view.
 fwd=both([(-3.55,5.0),(-1.5,4.95),(.3,4.9),(.55,5.2),(1.0,5.6),(1.71,5.76),(2.42,5.6),(2.87,5.15),(3.0,4.5),(4.4,2.9),(5.4,2.0)])
 loft('Forward signal gallery',[ring(fwd,23.1),ring(fwd,22.93),ring(scaled(fwd,.96,.9,1),22.5),ring(scaled(fwd,.9,.76,1),22.0),ring(scaled(fwd,.82,.6,1),21.4)],naval,smooth=True)
 prism('Forward signal gallery deck',fwd,23.1,23.13,roof,SUPER)
 perimeter_band('Forward signal gallery splinter wall',fwd,23.13,.95,naval,SUPER,.065)
 for side in (-1,1):
  # The gallery bulges round each high-angle director over a rounded tub.
  lathe('HA director tub',1.71,side*4.46,[(.25,21.95),(.78,22.12),(1.08,22.45),(1.2,22.85),(1.2,23.1)],naval)
 # Upper navigating room: near-vertical side walls, a modest glazed band,
 # separate roof station, and external knees below the forward overhang.
 nav_outline=structure_outline('first-bridge')
 prism('First navigation bridge lower wall',nav_outline,32.4,33.02,naval,SUPER)
 perimeter_band('First navigation bridge glazing',nav_outline,33.02,.78,glass,SUPER,.025)
 for a,b in zip(nav_outline,nav_outline[1:]+nav_outline[:1]):
  count=max(1,math.ceil(math.dist(a,b)/.64))
  for i in range(count):
   t=i/count;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
   rod('First navigation bridge mullion',(x,y,33.0),(x,y,33.84),.026,naval,SUPER,vertices=6)
 perimeter_band('Navigation window sill',nav_outline,32.96,.10,edge,SUPER,.10)
 prism('Navigation roof',nav_outline,33.80,34.40,naval,SUPER)
 # The air defence deck overhangs the windows on a sloped visor, and the
 # window ledge rides on a row of small knees round the bridge front.
 loft('Navigation bridge visor',[ring(nav_outline,33.84),ring(structure_outline('air-defense'),34.4)],naval,caps=(False,False))
 front=nav_outline[13:17];outer=grow(nav_outline,.5)[13:17]
 prism('Navigation bridge window ledge',outer+list(reversed(front)),32.86,32.96,edge,SUPER)
 v=[];fs=[]
 for (a,b),(c,d) in zip(zip(front,front[1:]),zip(outer,outer[1:])):
  count=max(1,round(math.dist(a,b)/.55))
  for i in range(count):
   t=(i+.5)/count;p=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);q=(c[0]+(d[0]-c[0])*t,c[1]+(d[1]-c[1])*t)
   ux,uy=(b[0]-a[0])/math.dist(a,b)*.03,(b[1]-a[1])/math.dist(a,b)*.03;k=len(v)
   for sgn in (-1,1):v.extend([(p[0]+sgn*ux,p[1]+sgn*uy,32.86),(q[0]+sgn*ux,q[1]+sgn*uy,32.86),(p[0]+sgn*ux,p[1]+sgn*uy,32.32)])
   fs.extend([(k,k+1,k+2),(k+5,k+4,k+3),(k,k+3,k+4,k+1),(k+1,k+4,k+5,k+2),(k+2,k+5,k+3,k)])
 mesh('Navigation bridge ledge knees',v,fs,naval,SUPER)
 shaped_gallery('air-defense','Air defence station')
 for side in (-1,1):
  # The forward chamfer is warped: the flat side runs further forward as it
  # rises, giving the curved shoulder under the navigating bridge.
  A=(-1.72,side*3.35);D=(3.15,side*1.8)
  rings=[ring([A,(bx,side*3.35),D],z) for z,bx in [(28.4,-1.62),(29.3,-1.2),(30.0,-.6),(30.6,-.1),(31.1,.5),(31.6,1.0),(32.4,1.0)]]
  loft('Operations tower shoulder fairing',rings,naval)
  # Type 22 platform: a rounded side tub over a deep radar sponson.
  tub=[(-1.4+1.8*math.cos(t*math.pi/10),side*(3.25+1.05*math.sin(t*math.pi/10))) for t in range(11)]+[(-3.2,side*2.9),(.4,side*2.9)]
  tub=tub if side==1 else list(reversed(tub))
  loft('Radar bridge side tub',[ring(tub,32.14),ring(tub,31.98)]+[ring(scaled(tub,k,k,-1.4,side*3.1),z) for k,z in [(.86,31.6),(.58,31.1),(.24,30.72)]],naval,smooth=True)
  perimeter_band('Radar bridge side tub wall',tub,32.14,.86,naval,SUPER,.06)
  for xx in (-.78,-1.49):
   cyl('Radar bridge binocular stand',(xx,side*3.96,32.55),.07,.82,naval,SUPER,8)
   rod('Radar bridge binocular',(xx-.22,side*3.96,33.0),(xx+.22,side*3.96,33.0),.09,dark,SUPER,vertices=8)
  # Two hooded searchlight-control stations on conical tubs, and a third on the gallery.
  for x,y,z in [(-3.71,4.14,27.48),(-5.20,2.95,28.18)]:
   control_pod('Searchlight control station',x,side*y,z,side,.95)
  control_pod('Searchlight control station',-2.54,side*4.17,23.13,side)
  # Type 98 mod 1 director houses flank the chamfer on the forward lookout deck.
  house=[(2.85,1.75),(2.85,3.05),(1.9,3.85),(.3,3.85),(.3,2.35)]
  house=[(x,side*y) for x,y in (house if side==1 else reversed(house))]
  prism('Type 98 director house',house,25.77,27.31,naval,SUPER)
  prism('Type 98 director house roof',house,27.31,27.37,roof,SUPER)
  cyl('Type 98 mod 1 director pedestal',(1.27,side*2.92,27.47),.2,.2,naval,SUPER,10)
  rounded('Type 98 mod 1 director',1.27,side*2.92,27.57,.56,.56,.42,naval,SUPER,cut=.3)
  box('Type 98 mod 1 director window',(1.56,side*2.92,27.84),(.03,.36,.1),glass,SUPER)
  # Twin 13 mm Type 93 machine guns on the lookout deck: visual only.
  id='aa-13mm-'+('port' if side==1 else 'starboard');before=set(scene.objects);x,y,z=-1.0,side*4.51,25.77
  cyl(id+' pedestal',(x,y,z+.42),.13,.84,naval,AA,10)
  box(id+' cradle',(x,y,z+.92),(.42,.5,.26),naval,AA)
  for dx in (-.14,.14):rod(id+' 13 mm barrel',(x+dx,y-side*.3,z+.98),(x+dx,y+side*.92,z+1.03),.035,edge,AA,vertices=6)
  box(id+' magazine',(x,y-side*.05,z+1.16),(.34,.22,.2),edge,AA)
  rod(id+' shoulder rest',(x-.3,y-side*.42,z+.9),(x+.3,y-side*.42,z+.9),.03,edge,AA,vertices=6)
  for ob in set(scene.objects)-before:ob['assemblyId']=id
  # Aft gallery fittings: flag lockers, sound detector, spotlight and signal lamp.
  box('Signal flag locker',(-8.75,side*2.0,22.7),(.35,2.0,.92),naval,SUPER)
  cyl('Sound detector pedestal',(-4.34,side*5.62,22.5),.16,.52,naval,SUPER,10)
  rounded('Sound detector housing',-4.34,side*5.62,22.76,.62,.95,1.3,naval,SUPER,cut=.4)
  box('Wing spotlight bracket',(-4.34,side*6.3,22.28),(.3,.5,.08),edge,SUPER)
  rod('Wing spotlight',(-4.34,side*6.62,22.26),(-4.34,side*6.62,22.62),.2,edge,SUPER,vertices=10)
  rod('Signal lamp post',(-4.47,side*4.36,22.24),(-4.47,side*4.36,24.2),.06,edge,SUPER,vertices=6)
  rod('Signal lamp',(-4.8,side*4.36,24.6),(-4.15,side*4.36,24.6),.3,naval,SUPER,vertices=12)
  box('Signal lamp yoke',(-4.47,side*4.36,24.28),(.5,.1,.2),edge,SUPER)
  # Fixed E27 radar-warning antennas.
  box('E27 radar antenna',(-8.62,side*3.33,22.83),(.78,.2,.6),edge,MAST)
  box('E27 radar antenna',(-.76,side*3.45,34.82),(.69,.18,.7),edge,MAST)
 # Lower forward face changes width without covering the entire tower in a
 # glazed belt. The reference carries small apertures and open lookout tubs.
 for side in (-1,1):
  for z in (27.65,30.1):
   for xx in (-3.1,-1.9):
    rod('Operations room scuttle',(xx,side*3.34,z),(xx,side*3.40,z),.115,dark,SUPER,vertices=12)
  # A rear-facing ladder has transverse rungs; both rails clear the curved
  # aft wall. Each stand-off is seated by an actual forward surface ray.
  ladder_support=SupportSurface([o for o in SUPER.objects if o.get('nodeId') in ('bridge-trunk.surface','operations-tower.surface') or o.name.startswith(('First navigation bridge lower wall','Navigation roof'))])
  if side==1:
   for y in (-.32,.32):rod('Bridge access ladder rail',(-6.12,y,22.25),(-6.12,y,34.4),.032,edge,SUPER,vertices=6)
   for i in range(42):rod('Bridge access ladder rung',(-6.12,-.32,22.3+i*.29),(-6.12,.32,22.3+i*.29),.023,edge,SUPER,vertices=6)
   for z in (23,26,29,32,34):
    for y in (-.32,.32):
     foot=ladder_support.along((-6.12,y,z),(1,0,0),6)
     rod('Bridge ladder stand-off',foot,(-6.12,y,z),.045,naval,SUPER,vertices=8)
  # Air defence station lookouts, at the pjsb018 binocular positions.
  for xx,yy in [(2.65,1.30),(1.95,2.10),(.92,2.88),(-.46,2.93),(-2.07,2.93),(-3.20,2.79),(-4.14,1.69)]:
   cyl('Air defence binocular stand',(xx,side*yy,34.98),.07,.84,naval,SUPER,8)
   rod('Air defence binocular',(xx-.23,side*yy,35.45),(xx+.23,side*yy,35.45),.10,dark,SUPER,vertices=8)
  # Open signal wings are deliberately separate from the enclosed room; each
  # is a girder that deepens toward the tower.
  pts=[(-5.2,side*1.9),(-9.5,side*9.7),(-8.95,side*9.9),(-3.8,side*3.1)]
  pts=pts if side==1 else list(reversed(pts))
  loft('Upper signal wing',[ring(pts,35.03),[(x,y,34.85-.85*max(0,1-(abs(y)-2)/6.5)) for x,y in pts]],roof)
  for a,b in [(p,q) for p,q in zip(pts,pts[1:]+pts[:1]) if max(abs(p[1]),abs(q[1]))>3.2]:
   rod('Signal wing guard rail',(*a,35.88),(*b,35.88),.023,edge,SUPER,vertices=6)
   count=max(1,math.ceil(math.dist(a,b)/1.3))
   for i in range(count):
    t=i/count;xx=a[0]+(b[0]-a[0])*t;yy=a[1]+(b[1]-a[1])*t
    rod('Signal wing stanchion',(xx,yy,35.0),(xx,yy,35.88),.023,edge,SUPER,vertices=6)
  foot=ladder_support.along((-5.1,side*2.7,31.25),(0,-side,0),6)
  rod('Signal wing lower strut',foot,(-9.2,side*9.7,34.88),.09,edge,SUPER,vertices=10)
  rod('Signal wing yard mast',(-9.22,side*9.8,35.0),(-9.22,side*9.8,36.7),.05,edge,MAST,vertices=6)
  cyl('Signal wing masthead lamp',(-9.22,side*9.8,36.78),.1,.18,edge,MAST,8)
  # Small 60 cm searchlights on the signal wing roots.
  cyl('Wing searchlight pedestal',(-4.58,side*3.43,35.18),.12,.3,naval,SUPER,8)
  rod('Wing searchlight',(-4.88,side*3.43,35.58),(-4.28,side*3.43,35.58),.33,naval,SUPER,vertices=12)
  rod('Wing searchlight lens',(-4.27,side*3.43,35.58),(-4.25,side*3.43,35.58),.28,glass,SUPER,vertices=12)
 # Centreline signal boom aft of the air defence station carries the Type A6.
 rod('Aft signal boom',(-5.72,0,35.45),(-10.4,0,35.1),.09,edge,MAST,vertices=8)
 rod('Aft signal boom stay',(-10.3,0,35.1),(-5.62,0,33.4),.04,edge,MAST,vertices=6)
 rod('Aft signal boom mast',(-10.4,0,35.1),(-10.4,0,36.6),.05,edge,MAST,vertices=6)
 rod('Type A6 radar mast',(-7.67,0,35.3),(-7.67,0,36.42),.035,edge,MAST,vertices=6)
 box('Type A6 radar antenna',(-7.67,0,36.12),(.62,.06,.5),edge,MAST)
 rod('Forward small rangefinder bracket',(3.12,0,28.65),(4.126,0,28.75),.19,naval,SUPER,vertices=12)
 rounded('Forward small rangefinder housing',4.126,0,28.72,1.2,.78,.83,naval,SUPER,cut=.35)
 rod('Forward small rangefinder optical base',(4.126,-.96,29.10),(4.126,.96,29.10),.16,edge,SUPER,vertices=16)
 for side in (-1,1):
  box('Upper bridge instrument box',(3.26,side*1.27,31.06),(.21,.72,.68),naval,SUPER)
  box('Upper bridge instrument aperture',(3.375,side*1.27,31.10),(.025,.43,.24),dark,SUPER)
 # Main director and its optical base, mounted on the measured upper station.
 cyl('Main director fixed pedestal',(-1.76,0,35.265),1.95,1.45,naval,SUPER,40)
 director_before=set(scene.objects)
 cyl('Main director bearing lower',(-1.76,0,36.0895),2.031,.207,naval,SUPER,40)
 cyl('Main director bearing collar',(-1.76,0,36.4025),2.210,.419,naval,SUPER,40)
 director_outline=structure_outline('main-director-drum')
 prism('Main director faceted housing',director_outline,36.61,38.15,naval,SUPER)
 prism('Main director housing roof',director_outline,38.15,38.30,roof,SUPER)
 cyl('Director cupola collar',(-1.76,0,38.435),1.78,.29,naval,SUPER,32)
 prism('Type 98 main director',structure_outline('main-director-head'),38.578,40.749,naval,SUPER)
 prism('Director cap',structure_outline('main-director-head'),40.749,40.84,roof,SUPER)
 for side in (-1,1):
  # Aft-set, tapered box arms join the broad rear shoulders of the housing.
  prism('Rangefinder arm root',[(-3.873,side*1.4),(-2.503,side*1.4),(-2.503,side*4.498),(-3.873,side*4.498)],36.94,38.13,naval,SUPER)
  v=[]
  for y,x0,x1,low,high in [(side*4.49,-3.760,-2.614,36.94,38.13),(side*6.81,-3.663,-2.712,37.02,38.05)]:
   v.extend([(x0,y,low),(x1,y,low),(x1,y,high),(x0,y,high)])
  mesh('Tapered rangefinder arm',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],naval,SUPER)
  rounded('Main rangefinder end hood',-3.1785,side*7.4765,37.02,.909,1.351,1.026,naval,SUPER,cut=.14)
  rod('Main rangefinder outer optics',(-2.95,side*8.05,37.56),(-2.95,side*8.362,37.56),.20,edge,SUPER,vertices=16)
  box('Main rangefinder forward optical hood',(-2.69,side*7.95,37.64),(.444,.42,.48),naval,SUPER)
  box('Main rangefinder aperture',(-2.46,side*7.95,37.64),(.02,.23,.25),dark,SUPER)
  for y in (side*2.9,side*6.3):
   rod('Rangefinder underside bracket',(-3.1,y,36.99),(-1.76,side*1.7,36.35),.075,edge,SUPER,vertices=10)
 box('Director forward optical hood',(-.3115,.024,39.8875),(1.369,.98,.439),naval,SUPER)
 box('Director forward optical aperture',(.382,.024,39.8875),(.025,.61,.23),dark,SUPER)
 rod('Director roof sight',(-1.3,0,40.82),(-1.3,0,41.30),.06,edge,SUPER,vertices=12)
 def aerial_x(z):return -3.3-(z-40.45)*1.75/3.73
 rod('Director aerial mast',(aerial_x(40.45),0,40.45),(aerial_x(44.916),0,44.916),.045,edge,SUPER,r2=.02,vertices=8)
 for i in range(24):
  a=i*math.tau/24;bb=(i+1)*math.tau/24;za=42.60+.53*math.sin(a);zb=42.60+.53*math.sin(bb)
  rod('Director aerial loop',(aerial_x(za),.38*math.cos(a),za),(aerial_x(zb),.38*math.cos(bb),zb),.035,edge,SUPER,vertices=6)
 for z in (42.1,43.0):rod('Director aerial crossarm',(aerial_x(z),-.35,z),(aerial_x(z),.35,z),.025,edge,SUPER,vertices=6)
 main_director_parts=set(scene.objects)-director_before
 radar_before=set(bpy.context.scene.objects)
 # Type 21 frames follow the measured low rectangular screens over the aft arms.
 for side in (-1,1):
  for y in (side*3.147,side*7.608):rod('Type 21 radar support',(-3.10,y,37.56),(-2.85,y,38.46),.065,edge,MAST,vertices=8)
  for y in (side*2.844,side*7.815):rod('Type 21 outer frame',(-2.85,y,38.436),(-2.85,y,39.714),.045,edge,MAST,vertices=8)
  for i in range(10):
   y=side*(3.147+i*(7.608-3.147)/9)
   rod('Type 21 array vertical',(-2.85,y,38.668),(-2.85,y,39.508),.025,edge,MAST,vertices=6)
  for z in (38.436,38.668,39.088,39.508,39.714):rod('Type 21 array horizontal',(-2.85,side*2.844,z),(-2.85,side*7.815,z),.028,edge,MAST,vertices=6)
 radar_pivot('radar-21.yaw',(-1.76,0,37.55),(set(bpy.context.scene.objects)-radar_before)|main_director_parts)
 for side in (-1,1):
  # A solid sponson under the Type 22 horns, deepening into the tower wall.
  outline=[(-2.52,side*3.25),(-2.52,side*5.35),(-2.15,side*5.79),(-.54,side*5.79),(-.17,side*5.35),(-.17,side*3.25)]
  outline=list(reversed(outline)) if side==1 else outline
  loft('Type 22 radar wing',[ring(outline,31.65),[(x,y,31.15+(abs(y)-3.25)/2.54*.3) for x,y in outline]],roof)
  # The source platform has no high outboard rail in the horn sweep.
  perimeter_band('Radar wing edge',outline,31.65,.055,edge,SUPER,.045)
  cyl('Type 22 seated pedestal',(-1.322,side*5.424,31.78),.2175,.30,naval,MAST,16)
  radar_before=set(bpy.context.scene.objects)
  def radar_pt(f,h):return (-1.322+f*math.cos(math.radians(35)),side*(5.424+f*math.sin(math.radians(35))),31.53+h)
  rod('Type 22 radar upright',radar_pt(0,.34),radar_pt(0,1.33),.069,naval,MAST,vertices=12)
  for h,back,neck,front,r_mid,r_mouth in [(.771,.0075,.633,1.2075,.141,.258),(1.3005,-.5535,.066,.4965,.1305,.219)]:
   rod('Type 22 horn throat',radar_pt(back,h),radar_pt(neck,h),.069,naval,MAST,r2=r_mid,vertices=20)
   rod('Type 22 horn flare',radar_pt(neck,h),radar_pt(front,h),r_mid,naval,MAST,r2=r_mouth,vertices=20)
   rod('Type 22 horn aperture',radar_pt(front+.002,h),radar_pt(front+.008,h),r_mouth*.89,dark,MAST,vertices=20)
   rod('Type 22 horn saddle',radar_pt(0,h-.08),radar_pt(back+.17,h),.035,edge,MAST,vertices=8)
  radar_pivot('radar-22-'+('port' if side==1 else 'starboard')+'.yaw',(-1.322,side*5.424,31.53),set(bpy.context.scene.objects)-radar_before)
 for side in (-1,1):
  # 4.5 m rangefinders on braced sponsons low on the tower flanks.
  x,y=-3.39,side*7.85
  # A tilted cone carries the sponson; its tip enters the battered tower flank.
  loft('Rangefinder sponson cone',[[(x+r*math.cos(i*math.tau/16),side*c+r*math.sin(i*math.tau/16),z) for i in range(16)] for c,r,z in [(7.85,1.6,16.75),(7.2,1.05,15.6),(6.5,.55,14.3),(6.0,.12,13.2)]],naval,smooth=True)
  box('Rangefinder sponson neck',(x,side*6.0,16.87),(1.8,2.3,.24),naval,SUPER)
  cyl('Rangefinder sponson deck',(x,y,16.87),1.6,.24,roof,SUPER,24)
  cyl('4.5 m rangefinder drum',(x,y,17.72),1.2,1.46,naval,SUPER,24)
  cyl('4.5 m rangefinder cupola',(x,y,18.62),.8,.36,naval,SUPER,16)
  rod('4.5 m rangefinder optical tube',(-5.85,side*7.55,17.85),(-.93,side*7.55,17.85),.21,naval,SUPER,vertices=12)
  for xx in (-5.66,-1.12):box('4.5 m rangefinder end hood',(xx,side*7.55,17.9),(.42,.5,.56),naval,SUPER)
  box('4.5 m rangefinder window',(x,side*9.04,17.95),(.8,.04,.22),dark,SUPER)
 # Aft annex: a raised block behind the tower carries the after high-angle
 # directors, one pair on tilted cone tubs and one on a strutted cross platform.
 annex=[(-12.6,-3.5),(-6.0,-3.5),(-5.5,-2.9),(-5.5,2.9),(-6.0,3.5),(-12.6,3.5),(-12.9,3.0),(-12.9,-3.0)]
 loft('Aft director annex',[ring(grow(annex,.45),10.75),ring(annex,13.6),ring(annex,17.0)],naval)
 prism('Aft director annex deck',annex,17.0,17.05,roof,SUPER)
 perimeter_band('Aft director annex bulwark',annex,17.05,.85,naval,SUPER,.06)
 box('Aft annex deckhouse',(-7.8,0,18.4),(4.0,4.0,2.8),naval,SUPER)
 prism('After director cross platform',[(-12.2,-6.9),(-10.3,-6.9),(-10.3,6.9),(-12.2,6.9)],18.48,18.72,roof,SUPER)
 box('After director platform pedestal',(-11.25,0,17.76),(1.6,4.6,1.44),naval,SUPER)
 for side in (-1,1):
  for xx in (-11.9,-10.6):rod('After director platform strut',(xx,side*3.45,17.2),(xx,side*6.4,18.5),.1,naval,SUPER,vertices=8)
  loft('HA director cone tub',[[(-8.14+r*math.cos(i*math.tau/16),side*c+r*math.sin(i*math.tau/16),z) for i in range(16)] for c,r,z in [(5.62,1.15,17.87),(5.5,1.0,17.3),(5.0,.6,16.1),(4.3,.15,14.6)]],naval,smooth=True)
 director_support=SupportSurface([*HULL.objects,*SUPER.objects])
 for side in (-1,1):
  for xx,yy,zz in [(1.71,4.46,22.81),(4.54,1.63,26.13),(-8.14,5.62,17.87),(-11.25,6.03,18.72)]:
   ha_director(xx,side*yy,zz,director_support,zz==26.13)
 # Tubs and pods that stand clear of the tower get solid knees into its wall.
 knee_support=SupportSurface([o for o in SUPER.objects if o.get('nodeId') in ('bridge-trunk.surface','operations-tower.surface')])
 for side in (-1,1):
  for x,y,z in [(-3.71,4.14,27.48),(-5.20,2.95,28.18)]:
   foot=knee_support.along((x,side*y,z-.3),(0,-side,0),4)
   box('Searchlight control tub knee',(x,(foot[1]+side*y)/2,z-.32),(.7,abs(side*y-foot[1])+.1,.5),naval,SUPER)
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,SUPER)
 for side in [-1,1]:
  fit.stairs('Lower bridge stair',(-10.5,side*2.9,17.05),(-5.5,side*2.9,22.25))
  # Raised directors have sight slits and split hoods instead of blank drums.
  for dx in [-.65,.65]:
   yy=1.8*math.sqrt(1-(dx/1.8)**2)
   box('Director optical slit',(-1.76+dx,side*(yy-.035),39.4),(.38,.12,.20),glass,SUPER)

"""Bridge tower, conning tower, galleries, main director and its radars."""
from yamato_kit import *


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
 shaped_gallery('second-lookout','Secondary lookout bridge')
 structure('forward-lookout-room')
 perimeter_band('Forward lookout rain hood',structure_outline('forward-lookout-room'),25.12,.09,edge,SUPER,.09)
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
 shaped_gallery('air-defense','Air defence station')
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
  # Narrow, supported optical tubs on the tower shoulders.
  for x,z,r in [(-3.9,26.2,1.05)]:
   y=side*3.75;outline=[(x+r*math.cos(i*math.tau/20),y+r*math.sin(i*math.tau/20)) for i in range(20)]
   cyl('Bridge optical tub support',(x,y,z-.65),.28,1.3,naval,SUPER,20,r2=r)
   prism('Bridge optical tub deck',outline,z,z+.12,roof,SUPER)
   perimeter_band('Bridge optical tub wall',outline,z+.12,.85,naval,SUPER,.065)
   rod('Optical tub inboard brace',(x,side*2.9,z-1.1),(x,y,z-.8),.13,naval,SUPER,vertices=10)
   cyl('Binocular pedestal',(x,y,z+.57),.10,.9,edge,SUPER,12)
   rod('Binocular optics',(x-.25,y,z+1.05),(x+.25,y,z+1.05),.11,dark,SUPER,vertices=10)
  for xx in (-3.9,-2.5,-1.1):
   cyl('Air defence binocular stand',(xx,side*2.7,34.96),.08,.9,naval,SUPER,12)
   rod('Air defence binocular',(xx-.23,side*2.7,35.45),(xx+.23,side*2.7,35.45),.10,dark,SUPER,vertices=10)
  # Open signal wings are deliberately separate from the enclosed room.
  pts=[(-5.6,side*3.0),(-9.5,side*9.7),(-8.95,side*9.9),(-3.8,side*3.4)]
  prism('Upper signal wing',pts,34.85,35.03,roof,SUPER)
  for a,b in zip(pts,pts[1:]+pts[:1]):
   rod('Signal wing guard rail',(*a,35.88),(*b,35.88),.023,edge,SUPER,vertices=6)
   count=max(1,math.ceil(math.dist(a,b)/1.3))
   for i in range(count):
    t=i/count;xx=a[0]+(b[0]-a[0])*t;yy=a[1]+(b[1]-a[1])*t
    rod('Signal wing stanchion',(xx,yy,35.0),(xx,yy,35.88),.023,edge,SUPER,vertices=6)
  foot=ladder_support.along((-5.1,side*2.7,31.25),(0,-side,0),6)
  rod('Signal wing lower strut',foot,(-9.2,side*9.7,34.88),.09,edge,SUPER,vertices=10)
 rod('Forward small rangefinder bracket',(3.12,0,28.65),(4.126,0,28.75),.19,naval,SUPER,vertices=12)
 rounded('Forward small rangefinder housing',4.126,0,28.72,1.2,.78,.83,naval,SUPER,cut=.35)
 rod('Forward small rangefinder optical base',(4.126,-.96,29.10),(4.126,.96,29.10),.16,edge,SUPER,vertices=16)
 for side in (-1,1):
  box('Upper bridge instrument box',(3.21,side*1.27,31.40),(.25,.72,.68),naval,SUPER)
  box('Upper bridge instrument aperture',(3.345,side*1.27,31.44),(.025,.43,.24),dark,SUPER)
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
 controller_support=SupportSurface(SUPER.objects)
 for side in (-1,1):
  pts=[(.5,side*2.1),(2.72,side*2.1),(2.72,side*4.35),(2.40,side*4.82),(1.86,side*4.965),(1.07,side*4.74),(.5,side*3.55)]
  prism('Forward controller wing',pts,22.65,22.77,roof,SUPER)
  for x in (1.15,2.35):
   foot=controller_support.along((x,side*4.6,21.6),(0,-side,0),8)
   rod('Forward controller wing knee',foot,(x,side*4.65,22.70),.12,naval,SUPER,vertices=10)
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
 tower_support=SupportSurface(SUPER.objects)
 for side in (-1,1):
  outline=[(-2.52,side*3.25),(-2.52,side*5.35),(-2.15,side*5.79),(-.54,side*5.79),(-.17,side*5.35),(-.17,side*3.25)]
  prism('Type 22 radar wing',outline,31.53,31.65,roof,SUPER)
  for x in (-2.2,-.5):
   foot=tower_support.along((x,side*4.3,30.45),(0,-side,0),8)
   rod('Radar wing cantilever',foot,(x,side*5.6,31.55),.11,naval,SUPER,vertices=10)
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
 director_support=SupportSurface([*HULL.objects,*SUPER.objects])
 for side in (-1,1):
  for xx,yy,zz in [(1.71,4.46,22.81),(4.54,1.63,26.13),(-8.14,5.62,17.87),(-11.25,6.03,18.72)]:
   ha_director(xx,side*yy,zz,director_support,zz==26.13)
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,SUPER)
 for side in [-1,1]:
  fit.stairs('Lower bridge stair',(-8.5,side*4.8,18.7),(-5.5,side*4.8,22.25))
  fit.stairs('Tower access stair',(-4.5,side*4.25,22.25),(-1.3,side*4.25,25.77),.68)
  # Raised directors have sight slits and split hoods instead of blank drums.
  for dx in [-.65,.65]:
   yy=1.8*math.sqrt(1-(dx/1.8)**2)
   box('Director optical slit',(-1.76+dx,side*(yy-.035),39.4),(.38,.12,.20),glass,SUPER)

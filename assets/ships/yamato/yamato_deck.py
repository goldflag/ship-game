"""Decks and hull fittings: planking and rails, ground tackle, hull scuttles, aircraft deck, boats, screws and rudders."""
from yamato_kit import *


def build():
 hull=next(o for o in HULL.objects if o.get('nodeId')=='hull.surface')
 # Deck planks are an original material; steel strips and ends are separate meshes.
 for i,(sa,sb) in enumerate(zip(stations,stations[1:])):
  a,b=sa-L/2,sb-L/2;wa,wb=breadth(a),breadth(b);za,zb=deck(a)+.035,deck(b)+.035
  material=teak if -69<(a+b)/2<85 else roof
  mesh('Deck surface',[(a,-wa,za),(b,-wb,zb),(b,wb,zb),(a,wa,za)],[(0,1,2,3)],material,DECK)
  for side in (-1,1):
   mesh('Steel deck margin',[(a,side*wa,za+.02),(b,side*wb,zb+.02),(b,side*max(0,wb-.55),zb+.02),(a,side*max(0,wa-.55),za+.02)],[(0,1,2,3)],roof,DECK)
   if a<L/2-3.2 and math.floor(sa/2.2)!=math.floor(sb/2.2) and wa>2:
    rod('Rail stanchion',(a,side*(wa-.15),za),(a,side*(wa-.15),za+.95),.033,edge,DECK,vertices=6)
   if a<L/2-3.2:
    # The forepeak's solid crest bulwark replaces the open guard wires. End the
    # last wire inside its return instead of carrying rails across the ornament.
    end=min(b,L/2-3.2);end_y=max(0,breadth(end)-(.07 if end<b else .15))
    for h in (.4,.92):
     rod('Deck guard wire',(a,side*max(0,wa-.15),za+h),(end,side*end_y,deck(end)+.035+h),.014,wire,DECK,vertices=5)
 # Stern aircraft deck. Long transfer rails are distinct from the short catapults.
 rounded('Aircraft handling deck',-97,0,5.72,60,23.5,.28,roof,AFT,cut=.25)
 for side in (-1,1):
  for offset in (-.22,.22):rod('Aircraft transfer rail',(-111,side*9.7+offset,6.04),(-70,side*16+offset,8.0),.09,edge,AFT,vertices=8)
  aa=Vector((-127,side*10.3,7.0));bb=Vector((-109,side*9.7,7.0))
  for h in (0,.9):rod('Catapult longeron',aa+Vector((0,0,h)),bb+Vector((0,0,h)),.13,edge,AFT,vertices=10)
  for i in range(12):
   a=aa.lerp(bb,i/12);b=aa.lerp(bb,(i+1)/12)
   rod('Catapult lattice',a,b+Vector((0,0,.9)),.063,edge,AFT,vertices=7)
   rod('Catapult cross tie',a,a+Vector((0,0,.9)),.063,edge,AFT,vertices=7)
  cyl('Catapult turntable',(-115,side*10,6.45),1.4,1.1,naval,AFT,24)
 # Central aircraft lift hatch and crane.
 rounded('Aircraft lift hatch',-118,0,6.02,9.3,8.2,.13,dark,AFT)
 cyl('Aircraft crane pedestal',(-106,0,7.2),1.6,2.5,naval,AFT,24)
 rod('Crane heel bearing',(-106,-.8,8.7),(-106,.8,8.7),.22,naval,AFT,vertices=12)
 cyl('Crane heel column',(-106,0,8.5),.55,.7,naval,AFT,20)
 for xx,zz in [(-106,10.4),(-128,10.4)]:rod('Crane transverse tie',(xx,-.65,zz),(xx,.65,zz),.10,edge,AFT,vertices=8)
 for y in (-.65,.65):
  rod('Crane boom chord',(-106,y,8.7),(-128,y,10.2),.12,edge,AFT,vertices=8)
  rod('Crane boom upper',(-106,y,10.4),(-128,y,10.4),.1,edge,AFT,vertices=8)
  for i in range(11):rod('Crane boom lattice',(-106-2*i,y,8.7+i*.135),(-108-2*i,y,10.4),.055,edge,AFT,vertices=6)
 rod('Crane support mast',(-106,0,8),(-105,0,14),.2,naval,AFT,vertices=12)
 rod('Crane hoist',(-105,0,14),(-128,0,10.4),.035,wire,AFT,vertices=6)
 rod('Crane hook line',(-128,0,10.4),(-128,0,7.0),.035,wire,AFT,vertices=6)
 # Boat-bay framing follows the recessed hull's actual floor and roof edges.
 # Constant +/-14 m posts projected outside the narrowing stern, producing
 # unsupported hanging legs even when their heads touched a crossbeam.
 for side in (-1,1):
  for x in (-99,-94,-88,-83):
   y=side*(min(loft_breadth(H,x,2.45),loft_breadth(H,x,5.92))-.03)
   rod('Boat bay frame',(x,y,2.45),(x,y,5.92),.065,edge,AFT,vertices=8)
   rod('Boat bay frame head',(x,side*10.95,5.92),(x,y,5.92),.08,edge,AFT,vertices=8)

 # Four screws and two rudders on the centreline in tandem.
 for side in (-1,1):
  for prop_index,(sx,yy,ex) in enumerate([(-67,8.2,-106),(-78,4.8,-115)]):
   yy*=side;rod('Propeller shaft',(sx,yy,-7.3),(ex,yy,-7.8),.34,edge,UNDER,vertices=18)
   rod('Shaft support',(ex+3,yy,-7.7),(ex+9,yy*.72,-5),.24,hullgray,UNDER,vertices=12)
   rod('Screw hub',(ex-1.1,yy,-7.8),(ex+1.4,yy,-7.8),.59,bronze,UNDER,r2=.28,vertices=20)
   # Kure Museum gives 5 m diameter. Rounded, pitched blades are independently
   # authored from the museum's stern view, with opposite handedness port/stbd.
   for k in range(3):
    a=k*math.tau/3+(.2 if side<0 else 0);v=[];fs=[];rows=17;cols=9
    for i in range(rows):
     t=i/(rows-1);rad=.48+2.02*t
     half_angle=.13+.42*math.sin(math.pi*t)**.7
     if i==rows-1:half_angle=0
     for j in range(cols):
      u=2*j/(cols-1)-1;theta=a+side*(.26*t+u*half_angle)
      v.append((ex+.18*t+side*u*(.45-.2*t)*math.sin(math.pi*t)**.5,yy+math.cos(theta)*rad,-7.8+math.sin(theta)*rad))
    for i in range(rows-1):
     for j in range(cols-1):
      n=i*cols+j;fs.append((n,n+1,n+1+cols,n+cols))
    o=mesh('Five metre three-bladed screw',v,fs,bronze,UNDER,True)
    o['assemblyId']=f'propeller-{"port" if side>0 else "starboard"}-{"outer" if prop_index==0 else "inner"}'
    mod=o.modifiers.new('Cast blade thickness','SOLIDIFY');mod.thickness=.055
 # Rounded aft edges and stepped balance portions replace the rectangular slabs.
 # Museum photographs establish the silhouette; exact stock stations are pending.
 for name,x,z,sx,sz in [('Main rudder',-121,-7.8,7.3,5.1),('Auxiliary rudder',-105,-8.3,4.8,3.9)]:
  outline=[(-.5,.5),(.10,.5),(.10,-.08),(.5,-.08),(.5,-.39),(.43,-.5),(-.43,-.5),(-.5,-.39)]
  v=[(x+a*sx,side*.22,z+b*sz) for side in (-1,1) for a,b in outline];n=len(outline)
  fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  o=mesh(name,v,fs,red,UNDER);o['assemblyId']=name.lower().replace(' ','-')
  # The museum's underside view shows a stock entering the hull above each blade.
  foot=SupportSurface([hull]).along((x-sx*.2,0,z+sz*.5),(0,0,1),12)
  stock=rod(name+' stock',(x-sx*.2,0,z+sz*.35),foot,.26,hullgray,UNDER,vertices=16)
  stock['assemblyId']=o['assemblyId']
  for dz in (-.35,-.1,.15,.38):rod('Rudder plating seam',(x-sx*.46,-.225,z+sz*dz),(x+sx*(.43 if dz<-.1 else .06),-.225,z+sz*dz),.025,hullgray,UNDER,vertices=6)
 for side in (-1,1):
  mesh('Bilge keel',[(-68,side*16,-8.3),(41,side*16,-8.3),(39,side*17.0,-9.4),(-66,side*17.0,-9.4)],[(0,1,2,3)],red,UNDER)

 # Foredeck anchor gear and scattered fittings.
 for side in (-1,1):
  cyl('Anchor capstan',(95,side*3.5,deck(95)+.6),.9,1.2,edge,DECK,24)
  # Source anchor shanks fall forward beneath the forecastle flare. Their
  # upper hawse collars sit through the deck; the crown and flukes hang from it.
  top=(125.35,side*3.95,9.44);bottom=(128.45,side*3.84,7.86)
  mouth_z=deck(125.35)
  cyl('Hawse mouth collar',(125.35,side*3.95,mouth_z+.08),.40,.28,hullgray,DECK,24)
  rod('Hawse seating',(125.35,side*3.95,mouth_z-.08),top,.20,hullgray,DECK,vertices=16)
  rod('Anchor shank',top,bottom,.16,edge,DECK,vertices=12)
  rod('Anchor crown',(128.45,side*2.96,7.82),(128.45,side*4.70,7.82),.23,edge,DECK,vertices=12)
  for offset in (-.76,.76):
   y=side*3.84+offset
   rod('Anchor curved arm',(128.45,side*3.84,7.86),(127.55,y,7.30),.19,edge,DECK,vertices=12)
   mesh('Anchor fluke',[(127.7,y-.24,7.28),(127.7,y+.24,7.28),(126.4,y+.35,8.74),(126.4,y-.35,8.74),(127.9,y-.24,7.37),(127.9,y+.24,7.37)],[(0,1,2,3),(4,3,2,5),(0,4,5,1),(0,3,4),(1,5,2)],edge,DECK)
  for x in (70,83,103,115,-57,-78,-118):
   y=side*max(1,breadth(x)-1.2);z=deck(x)
   for dx in (-.4,.4):cyl('Mooring bollard',(x+dx,y,z+.42),.23,.8,edge,DECK,12)
   box('Bollard bed',(x,y,z+.08),(1.8,.85,.14),roof,DECK)
  for x in (-60,-52,-43,-31,-17,12,23,61):
   y=side*min(10,breadth(x)-1.6);z=deck(x)
   rounded('Ventilator',x,y,z,1.3,.9,.8,naval,DECK)
   box('Ventilator grille',(x+.66,y,z+.5),(.025,.72,.42),dark,DECK)
 for x,y in [(87,0),(58,-5),(58,5),(-57,6),(-59,-6),(20,9)]:rounded('Deck access hatch',x,y,deck(x)+.06,2.1,1.3,.18,roof,DECK)
 # Breakwater sweeps aft of the forecastle gear.
 for side in (-1,1):
  for i in range(14):
   y=side*(i+.5)*.85;x=67-3.2*(abs(y)/12)**2;z=deck(x)
   o=box('Foredeck breakwater',(x,y,z+.5),(.16,.90,1.0),naval,DECK);o.rotation_euler.z=-side*.4
 for x,height in ((130,4.5),(-130,7.6)):
  rod('Jack staff',(x,0,deck(x)),(x,0,deck(x)+height),.065,edge,MAST,r2=.035,vertices=10)

 # Discrete glazed portholes avoid unsupported shader tricks.
 for side in (-1,1):
  for i in range(92):
   x=-119+i*2.65;z=min(deck(x)-1.45,5.9);y=side*(loft_breadth(H,x,z)-.04)
   if -74<x<62 and i%3:continue
   rod('Hull scuttle',(x,y,z),(x,y+side*.065,z),.12,dark,HULL,vertices=10)
 # Reference-led service details: Kure bridge/forward-turret photographs, S-06-2
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,DECK)
 for side in [-1,1]:
  for x in [59,76,87,-57,-75]:fit.reel('Mooring line reel',x,side*min(12,breadth(x)-2),deck(x)+.025,.58,1.4)
  for x in [82,-62]:
   fit.door('Deck trunk access',x,side*3.2,deck(x),.7,1.2)
   rounded('Companionway coaming',x,side*3.0,deck(x),1.5,1.1,1.3,naval,DECK)
  # Chain links follow the rising forecastle; machinery has a warping head.
  for start,end in [(95,100),(100,105),(105,110),(110,115),(115,120),(120,125.35)]:
   ya=side*(3.5+.45*(start-95)/30.35);yb=side*(3.5+.45*(end-95)/30.35)
   fit.chain('Bower anchor chain',(start,ya,deck(start)+.12),(end,yb,deck(end)+.12),.5)
  for x in [95]:
   cyl('Windlass gear casing',(x-1.1,side*3.5,deck(x)+.43),.68,.78,naval,DECK,32)
   rod('Windlass axle',(x-1.1,side*2.65,deck(x)+.65),(x-1.1,side*4.35,deck(x)+.65),.18,edge,DECK,vertices=16)
   fit.ring('Windlass brake wheel',(x-1.1,side*4.4,deck(x)+.65),.37,.043,'y')
   for a in (0,math.pi/2):rod('Windlass brake spoke',(x-1.1-.37*math.cos(a),side*4.4,deck(x)+.65-.37*math.sin(a)),(x-1.1+.37*math.cos(a),side*4.4,deck(x)+.65+.37*math.sin(a)),.035,edge,DECK,vertices=6)
 fit.col=AFT
 for side in [-1,1]:
  fit.reel('Aircraft crane winch',-104,side*1.5,6.0,.52,1.2)
  for i,x in enumerate([-97.5,-86.5]):fit.boat('Recessed motor launch',x,side*12.0,2.9,11 if i==0 else 9,2.0,i==0)
  for x in [-122,-116]:
   fit.ring('Catapult carriage wheel',(x,side*10.0,7.1),.21,.045,'y',segments=12)
  for x in [-99,-94,-88,-83]:
   rod('Boat bay upper beam',(x,side*10.95,5.92),(x,side*(loft_breadth(H,x,5.92)-.03),5.92),.08,naval,AFT,vertices=8)
  fit.ladder('Aircraft deck access',(-75,side*9,5.95),(-70,side*9,8.0),.7)

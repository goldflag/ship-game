"""Forward superstructure: battery and shelter decks, bridge, conning tower, tower, foretop, foremast,
forward directors, night rangefinders, AA directors and the foretop searchlight."""
from bismarck_kit import *
# Glazing follows the actual faceted wall, including the rounded forward bridge
# corners. The navigation house is forward of the separate conning enclosure.
def wall_windows(sid,z,height,spacing=.95,fill=.8):
 s=structures[sid];pts=[(-zz+2,-xx) for xx,zz in s['footprint']];aft=min(x for x,y in pts)
 for a,b in zip(pts,pts[1:]+pts[:1]):
  if (a[0]+b[0])/2<aft+.2:continue
  a,b=Vector((*a,0)),Vector((*b,0));delta=b-a;count=max(1,round(delta.length/spacing));normal=Vector((delta.y,-delta.x,0)).normalized()
  if normal.dot((a+b)/2-Vector(((aft+max(x for x,y in pts))/2,0,0)))<0:normal=-normal
  # The signal bridge has shallow forward apertures and tall side windows.
  # A continuous tall ribbon exaggerates the approved enclosure's front face.
  front_slit=sid=='signal-house' and normal.x>.8 and abs((a.y+b.y)/2)<2.5
  window_z,window_height,window_fill=(22.57,.24,.64) if front_slit else (z,height,fill)
  for i in range(count):
   start=a+delta*((i+(1-window_fill)/2)/count)+normal*.047;end=a+delta*((i+(1+window_fill)/2)/count)+normal*.047
   corners=[p+Vector((0,0,zz)) for zz in [window_z,window_z+window_height] for p in [start,end]]
   mesh(sid+' framed glass',corners,[(0,1,3,2)],materials['glass'],detailcol)
   polyline(sid+' window frame',[corners[j] for j in [0,1,3,2]],.033,materials['edge'],closed=True,vertices=6)
def bridge_details():
 # Runs inside legacy_frame(): authored 2 m forward, shifted back by the caller.
 wall_windows('bridge-wheelhouse',13.96,.37,1.25)
 wall_windows('signal-house',22.10,.80,1.05)
 wall_windows('conning-tower',17.30,.12,1.3)
 wall_windows('foretop-control',28.96,.14,2.4,.22)
 # The upper control house has small apertures; the former full window ribbon
 # exaggerated its width. All service fittings bear on their actual deck or wall.
 for sign in [-1,1]:
  for sid,zz,xx in [('tower-upper-shaft',19.25,16.15),('tower-upper-shaft',25.35,16.15),('tower-mast-base',16.25,20.0)]:
   pts=[(-zz+2,-xx) for xx,zz in structures[sid]['footprint']]
   yy,normal=house_side(pts,xx,sign);porthole('Tower wall aperture',Vector((xx,yy,zz))+normal*.04,normal,.18)
 for sign in [-1,1]:
  # Bridge wing instruments and a low locker fitted on the signal deck.
  box('Signal bridge locker',(12.9,sign*3.15,21.02),(2.3,.46,.74),materials['naval'],detailcol)
  for xx in [12.2,12.9,13.6]:box('Signal locker panel',(xx,sign*3.40,21.02),(.57,.035,.56),materials['edge'],detailcol)
  for xx,yy,zz in [(34.6,4.4,15.4),(12.5,2.8,20.65),(11.5,3.6,27.3)]:
   cyl('Bridge pelorus stand',(xx,sign*yy,zz+.44),.13,.88,materials['naval'],detailcol,16)
   cyl('Bridge pelorus dial',(xx,sign*yy,zz+.91),.27,.10,materials['edge'],detailcol,20)
   rod('Bridge sighting arm',(xx-.23,sign*yy,zz+.99),(xx+.3,sign*yy,zz+.99),.03,materials['dark'],detailcol,vertices=6)
  for name,a,b,inner in [
   ('Platform access',(46.7,9.2,5.75),(43.8,9.2,8.4),8.1),
   ('Forward exterior stair',(41.2,7.9,8.4),(36.0,7.9,13.1),7.45),
   ('Navigation bridge stair',(29.8,7.1,13.1),(27.4,7.1,15.4),5.85),
   ('Lower tower gun gallery stair',(24.3,4.65,15.4),(22.0,4.65,17.68),3.85),
   ('Signal bridge access',(12.3,3.1,17.68),(15.6,3.1,20.65),2.6),
   ('Searchlight gallery stair',(12.5,3.2,20.65),(17.2,3.2,24.65),2.9),
   ]:
   a=(a[0],a[1]*sign,a[2]);b=(b[0],b[1]*sign,b[2]);stairs(name,a,b,.7);stair_landing(name,*b,inner*sign)
  # The lower tower flight begins on a short aft landing tied into its wall.
  box('Tower stair aft landing',(12.55,sign*3.1,17.58),(1.05,.9,.20),materials['roof'],supercol)
  for yy in [2.8,3.4]:rod('Tower stair aft landing knee',(12.1,sign*yy,17.5),(13.1,sign*yy,16.8),.065,materials['naval'],supercol,vertices=6)
  # Deck vents and tower conduits sit on the revised walls rather than old offsets.
  for sid,z,xs in [('forward-battery-deck',9.35,[13,18,37,41]),('forward-shelter-deck',11.55,[19,27,34])]:
   pts=[(-zz+2,-xx) for xx,zz in structures[sid]['footprint']]
   for xx in xs:
    yy,normal=house_side(pts,xx,sign)
    if abs(normal.x)<.3:vent(sid+' intake',(xx,yy+sign*.06,z),(1.2,.20,1.0),sign)
  # Aft-facing service ladders follow the two actual tower walls.
  ladder('Lower tower service ladder',(12.65,sign*2.0,13.12),(12.65,sign*2.0,17.60),.45)
  for zz in [13.4,15.2,17.3]:
   rod('Lower ladder wall foot',(12.65,sign*2.0,zz),(12.94,sign*2.0,zz),.035,materials['edge'],detailcol,vertices=6)
  ladder('Upper tower service ladder',(14.3,sign*2.14,18.0),(14.3,sign*2.14,27.2),.45)
  for zz in [18.2,20.0,22.0,24.0,26.4]:
   rod('Upper ladder wall foot',(14.3,sign*2.14,zz),(14.3,sign*1.83,zz),.035,materials['edge'],detailcol,vertices=6)
  box('Tower service cabinet',(16.4,sign*4.14,16.5),(1.05,.3,.75),materials['edge'],detailcol)
  polyline('Tower cable conduit',[(18.3,sign*4.11,13.2),(18.3,sign*4.11,17.5)],.042,materials['edge'],vertices=8)
  # Low after signal-gallery walls leave the slender central shaft exposed above them.
  aft=[(11.0,0),(11.15,2.8),(11.55,3.75),(15.7,3.75),(16.45,3.3)]
  for a,b in zip(aft,aft[1:]):
   a=(a[0],sign*a[1]);b=(b[0],sign*b[1]);mesh('Open signal gallery bulwark',[(x,y,z) for z in [20.65,21.9] for x,y in [a,b]],[(0,1,3,2)],materials['naval'],supercol)
   rod('Signal gallery rim',(*a,21.9),(*b,21.9),.035,materials['edge'],supercol,vertices=6)
 # Broad windshield follows the after edge of the sloping hood.
 hood=[(37.2,7.6),(37.75,5.0),(38.05,3.05),(38.2,0),(38.05,-3.05),(37.75,-5.0),(37.2,-7.6)]
 for a,b in zip(hood,hood[1:]):
  mesh('Forward hood windshield',[(x,y,z) for z in [14.42,14.98] for x,y in [a,b]],[(0,1,3,2)],materials['naval'],supercol)
  rod('Forward hood deflector',(*a,14.98),(*b,14.98),.045,materials['edge'],supercol,vertices=6)
def directors():
 director('Fore main director',13.32,31.1,10.5,29.8)
 director('Conning director',25.0,19.55,7.0,18.3)
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
def night_rangefinders():
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
def aa_directors():
 for sign in [-1,1]:
  aa_director('Forward AA director',15.0,sign*6.8,17.8,12.95)
def foretop_searchlight():
 searchlight('Foretop 1.5 m searchlight',20.2,0,24.71,0)
def foremast():
 pole_mast('foremast',6.4,5.73,40.3)
def quad_20mm():
 # The two upper quad 2 cm fittings are decorative (no blueprint mount); the armament pass's
 # aa_mount builds them after the firing mounts, on the same support snapshot.
 import bismarck_armament as armament
 for sign in [-1,1]:
  armament.aa_mount('Quad 2 cm April 1941 fit',17.395,sign*4.092,24.65,.020,bearing=sign*.82,quad=True)
def build():
 # Region entry point, after the hull, blueprint structures and main/secondary batteries exist.
 with legacy_frame():bridge_details()
 directors();night_rangefinders();aa_directors();foretop_searchlight();foremast()
def after_mounts():
 # Runs after the armament pass has built every AA mount.
 quad_20mm()

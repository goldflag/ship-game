"""Original Fubuki A articulated banks and attached deck fittings.
Executed with the owning recipe's original helpers and blueprint definition.
"""
for l in definition['torpedoLaunchers']:
 name=l['id'];a,z,c=l['position'];x,y=-c,-a
 deck=4.95 if name=='torpedo-1' else deckz(x)+.02
 # Barbette ring from the deck (or torpedo deck) up to the training bearing.
 cyl(name+'.foundation',(x,y,(deck+z)/2),1.2,max(.05,z-deck),materials['naval'],vertices=48)
 pivot=empty(name+'.yaw',(x,y,z))
 def put(o):return local(o,pivot,name)
 put(cyl(name+'.bearing',(0,0,.03),1.25,.06,materials['edge'],vertices=48))
 put(cyl(name+'.turntable',(0,0,.09),1.40,.06,materials['naval'],vertices=48))
 # Working shield as measured: vertical sides 2.2 m out, roof rising forward from 1.58 to 2.05 m above the
 # bearing with a 1.1 m chamfer along both eaves, sloping front and a flat after face with the breeches outside.
 sections=[(-2.74,2.2,.12,1.58),(-2.3,2.2,.12,1.66),(1.15,2.2,.12,2.05),(1.51,2.2,.12,1.15)]
 roof=lambda xx:1.58+(2.05-1.58)*max(0,min(1,(xx+2.74)/(1.15+2.74)))
 vs=[]
 for xx,w,bottom,top in sections:
  vs += [(xx,-w,bottom),(xx,w,bottom),(xx,w,top-.45),(xx,w-.55,top-.225),(xx,w-1.1,top),(xx,-w+1.1,top),(xx,-w+.55,top-.225),(xx,-w,top-.45)]
 fs=[tuple(reversed(range(8))),tuple(range(24,32))]+[(k*8+j,k*8+(j+1)%8,(k+1)*8+(j+1)%8,(k+1)*8+j) for k in range(3) for j in range(8)]
 hood=put(mesh(name+'.working-shield',vs,fs,materials['naval']))
 bevel=hood.modifiers.new('Rounded shield corners','BEVEL');bevel.width=.04;bevel.segments=2
 for sign in [-1,1]:
  put(box(name+'.access-door',(-.6,sign*2.22,.8),(.65,.035,1.0),materials['naval'],bev=.06))
  for zz in [.55,1.05]:put(rod(name+'.door-dog',(-.86,sign*2.26,zz),(-.68,sign*2.26,zz),.02,materials['edge']))
  for xx in [-1.7,.4]:put(cyl(name+'.roof-hatch',(xx,sign*.55,roof(xx)+.02),.19,.045,materials['edge'],vertices=24))
  for zz in [.35,.65,.95,1.25]:
   put(tube_path(name+'.step',[(.7,sign*2.2,zz),(.7,sign*2.33,zz),(1.0,sign*2.33,zz),(1.0,sign*2.2,zz)],.018,materials['edge']))
  path=[(xx,sign*1.05,roof(xx)) for xx in [-2.7,-2.3,1.1]]
  put(tube_path(name+'.roof-rail',[(a,b,c+.17) for a,b,c in path],.018,materials['edge']))
  for a,b,c in path:put(rod(name+'.rail-foot',(a,b,c-.015),(a,b,c+.17),.019,materials['naval']))
 for t in [t for t in definition['torpedoTubes'] if t['launcherId']==name]:
  aa,zz,cc=t['position'];end=-cc-x;yy=-aa-y;zz-=z
  # The bore runs through the enclosure; the muzzle remains a real open trough.
  cutter=put(rod(name+'.bore-cutter',(-3.8,yy,zz),(2,yy,zz),.305,materials['dark'],vertices=24))
  mod=hood.modifiers.new('Tube bore','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
  bpy.context.view_layer.objects.active=hood;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
  N=24;v=[]
  for xx in [-3.55,1.9]:
   for r in [.337,.305]:v += [(xx,yy+r*math.cos(j*math.tau/N),zz+r*math.sin(j*math.tau/N)) for j in range(N)]
  f=[]
  for j in range(N):
   k=(j+1)%N;f += [(j,k,2*N+k,2*N+j),(N+j,3*N+j,3*N+k,N+k)]
   for off in [0,2*N]:f.append((off+j,off+N+j,off+N+k,off+k))
  put(mesh(name+'.tube',v,f,materials['naval'],smooth=True))
  v=[]
  for xx in [1.84,end]:
   for r in [.337,.305]:
    v += [(xx,yy+r*math.cos(j*math.pi/N),zz-r*math.sin(j*math.pi/N)) for j in range(N+1)]
  stride=2*(N+1);f=[]
  for j in range(N):
   f += [(j,j+1,stride+j+1,stride+j),(N+1+j,stride+N+1+j,stride+N+2+j,N+2+j)]
   for off in [0,stride]:f.append((off+j,off+N+1+j,off+N+2+j,off+j+1))
  for j in [0,N]:f.append((j,stride+j,stride+N+1+j,N+1+j))
  put(mesh(name+'.discharge-trough',v,f,materials['naval'],smooth=True))
  for xx in [2,2.65,3.3,3.95,end-.03]:put(tube_path(name+'.tube-band',[(xx,yy+.35*math.cos(j*math.pi/N),zz-.35*math.sin(j*math.pi/N)) for j in range(N+1)],.022,materials['edge']))
  for sign in [-1,1]:put(rod(name+'.trough-edge',(1.84,yy+sign*.32,zz),(end,yy+sign*.32,zz),.022,materials['edge']))
  put(rod(name+'.breech-collar',(-3.63,yy,zz),(-3.50,yy,zz),.365,materials['edge'],vertices=24))
  put(rod(name+'.breech-cover',(-3.7,yy,zz),(-3.63,yy,zz),.33,materials['naval'],vertices=24))
  for j in range(8):
   a=j*math.tau/8;put(box(name+'.breech-dog',(-3.715,yy+.28*math.cos(a),zz+.28*math.sin(a)),(.045,.06,.06),materials['edge'],bev=.005))
  put(rod(name+'.air-flask',(-3.25,yy+.22,zz-.24),(-1.6,yy+.22,zz-.24),.075,materials['naval'],vertices=16))
  put(tube_path(name+'.air-line',[(-3.25,yy+.22,zz-.24),(-3.4,yy+.23,zz+.24),(-2.6,yy+.23,zz+.35)],.023,materials['edge']))
  socket=empty(t['id']+'.muzzle',(end,yy,zz));local(socket,pivot,name)
 put(box(name+'.sight-hood',(1.36,0,1.66),(.3,.65,.32),materials['naval']))
 put(box(name+'.sight-slit',(1.515,0,1.7),(.014,.43,.10),materials['glass']))
# Reload lockers form the after deckhouse's sides: sheet-metal slats along both faces.
for side in [-1,1]:
 for dx in [-35.4+i*.25 for i in range(25)]:rod('torpedo-stowage.rib',(dx,side*3.13,3.5),(dx,side*3.13,5.3),.016,materials['edge'],vertices=6)
# Torpedo reload cranes at the deck edge abreast the midships AA platform: pedestals with jibs reaching outboard.
for x in [-20.7]:
 for sign in [-1,1]:
  cyl('reload-derrick.pedestal',(x,sign*4.72,(deckz(x)+4.7)/2),.2,4.7-deckz(x),materials['naval'],vertices=16)
  tube_path('reload-derrick.arm',[(x,sign*4.72,4.6),(x,sign*4.72,5.1),(x,sign*5.2,5.9),(x,sign*5.6,6.35)],.07,materials['naval'],sides=12)
  rod('reload-derrick.fall',(x,sign*5.6,6.3),(x,sign*5.6,5.3),.015,materials['rope'])
  box('reload-derrick.hook',(x,sign*5.6,5.25),(.12,.08,.14),materials['edge'],bev=.01)
# Foremast, as measured on the reference: a pole raked 6 deg aft from the forecastle deck, two after legs spread
# 3.2 m either side on the main deck and meeting the pole at 20.8 m, a lookout platform, a lamp platform,
# funnel-to-bridge struts, a lamp box and three yards (a long signal yard, a short topmast yard and a V pair).
pole_x=lambda z:21.61-.11*(z-5.4)
FORE_TOP=24.09
rod('foremast.pole',(pole_x(5.4),0,5.4),(pole_x(FORE_TOP),0,FORE_TOP),.11,materials['edge'],r2=.055,vertices=16)
rod('foremast.truck',(pole_x(FORE_TOP),0,FORE_TOP),(pole_x(FORE_TOP),0,FORE_TOP+.3),.02,materials['edge'],vertices=6)
leg=lambda side,t:Vector((18.11,side*3.2,deckz(18.11))).lerp(Vector((19.87,0,20.8)),t)
for side in [-1,1]:
 rod('foremast.tripod-leg',leg(side,0),leg(side,1),.1,materials['naval'],r2=.065,vertices=14)
 # Horizontal struts from the fore funnel to the after face of the bridge.
 rod('foremast.funnel-strut',(15.3,side*1.22,8.93),(22.33,side*1.3,8.93),.075,materials['naval'],vertices=12)
 rod('foremast.bridge-brace',(20.35,side*.72,10.1),(22.28,side*1.2,8.2),.05,materials['edge'],vertices=10)
for t in [.39,.62,.86]:
 a,b=leg(-1,t),leg(1,t);rod('foremast.leg-tie',a,b,.045,materials['edge'],vertices=10)
 rod('foremast.pole-tie',(a+b)/2,(pole_x(a.z),0,a.z),.04,materials['edge'],vertices=10)
# Lookout platform between the legs and the bridge, with a binocular pedestal.
prism('foremast.lookout-deck',outline_rect(18.95,22.3,-.9,.9,.15),10.05,10.19)
rails('foremast.lookout-rails',[(18.95,-.9,10.19),(22.1,-.9,10.19)],.85)
rails('foremast.lookout-rails',[(18.95,.9,10.19),(22.1,.9,10.19)],.85)
rails('foremast.lookout-rails',[(18.95,-.9,10.19),(18.95,.9,10.19)],.85)
cyl('foremast.binocular-pedestal',(19.65,0,10.19+.65),.12,1.3,materials['naval'],vertices=16)
rod('foremast.binocular',(19.35,0,11.62),(20.15,0,11.62),.09,materials['dark'],vertices=12)
for side in [-1,1]:rod('foremast.lookout-bracket',(19.05,side*.9,10.1),leg(side,.38),.05,materials['naval'],vertices=10)
# Lamp platform between the legs at 13.55 m, on the pole and a tie to the legs.
prism('foremast.lamp-platform',outline_rect(19.26,pole_x(13.55)+.05,-.33,.33,.08),13.47,13.55)
rails('foremast.lamp-rails',[(19.26,-.33,13.55),(19.26,.33,13.55)],.7)
rod('foremast.lamp-staff',(19.75,0,13.55),(19.75,0,16.2),.025,materials['edge'],vertices=8)
cyl('foremast.lamp',(19.55,0,13.8),.16,.36,materials['naval'],vertices=14)
rod('foremast.lamp-tie',(19.24,-.4,13.5),(19.24,.4,13.5),.04,materials['edge'])
for side in [-1,1]:rod('foremast.lamp-tie',(19.24,side*.4,13.5),leg(side,(13.5-deckz(18.11))/(20.8-deckz(18.11))),.04,materials['edge'])
# Lamp box on the fore side of the pole.
box('foremast.lamp-box',(pole_x(19.55)+.4,0,19.55),(.62,.72,1.3),materials['naval'],bev=.04)
# Yards: long signal yard, V yards raked aft, short topmast yard; halyards down the legs.
for z,span in [(18.68,4.14),(22.0,2.2)]:
 xx=pole_x(z);rod('foremast.yard',(xx,-span,z),(xx,span,z),.045,materials['edge'],r2=None,vertices=12)
 for side in [-1,1]:rod('foremast.yard-lift',(xx,side*span*.97,z),(pole_x(min(FORE_TOP,z+1.9)),0,min(FORE_TOP,z+1.9)),.008,materials['edge'],vertices=5)
for side in [-1,1]:
 rod('foremast.v-yard',(pole_x(20.7),0,20.7),(17.97,side*3.19,21.47),.05,materials['edge'],r2=.03,vertices=10)
 for span in [4.0,1.75]:rod('foremast.halyard',(pole_x(18.68),side*span,18.68),(pole_x(18.68)+.2,side*span*.45,10.3),.007,materials['dark'],vertices=5)
 rod('foremast.halyard',(17.97,side*3.1,21.45),(19.3,side*2.25,13.05),.007,materials['dark'],vertices=5)
ladder('foremast.ladder',(pole_x(13.6)-.2,0,13.6),(pole_x(18.6)-.2,0,18.6),.3)
# Aftermast: a single pole raked 7 deg aft from the upper AA step, step irons, a small ensign gaff; no yards.
aft_x=lambda z:-29.16-.129*(z-5.54)
AFT_TOP=18.11
rod('aftmast.pole',(aft_x(5.54),0,5.54),(aft_x(AFT_TOP),0,AFT_TOP),.09,materials['edge'],r2=.05,vertices=16)
for z in [8.5,10.0,11.5,13.0,14.5,16.0]:
 tube_path('aftmast.step-iron',[(aft_x(z)+.01,-.05,z),(aft_x(z)+.2,-.16,z),(aft_x(z)+.2,.16,z),(aft_x(z)+.01,.05,z)],.02,materials['edge'])
rod('aftmast.gaff',(aft_x(15.3),0,15.3),(-31.22,0,14.02),.04,materials['edge'],vertices=10)
# Spreaders at the mastheads carry the aerial and the stays.
rod('foremast.spreader',(pole_x(23.9),-.32,23.9),(pole_x(23.9),.32,23.9),.03,materials['edge'],vertices=8)
rod('aftmast.spreader',(aft_x(17.8),-.32,17.8),(aft_x(17.8),.32,17.8),.03,materials['edge'],vertices=8)
for side in [-1,1]:
 rod('rigging.aerial',(pole_x(23.9),side*.25,23.9),(aft_x(17.8),side*.25,17.8),.01,materials['dark'],vertices=5)
 # Jackstaff at the stem head; raked ensign staff at the stern with its own stay.
 for x,z0,x1,z1,mx,mz in [(58.6,deckz(58.6),58.6,10.5,pole_x(23.9),23.9),(-57.2,deckz(-57.2),-57.8,7.7,aft_x(17.8),17.8)]:
  rod('rigging.staff',(x,side*.08,z0),(x1,side*.08,z1),.03,materials['edge'],vertices=10)
  rod('rigging.stay',(x1,side*.08,z1),(mx,side*.25,mz),.009,materials['dark'],vertices=5)
 for x,y,z in [(26.4,3.3,12.76),(18.6,3.9,3.42)]:rod('rigging.shroud',(pole_x(22.6),0,22.6),(x,side*y,z),.009,materials['dark'],vertices=5)
 rod('rigging.shroud',(aft_x(16.5),0,16.5),(-20.2,side*.9,6.86),.008,materials['dark'],vertices=5)
# Optical instruments on real pedestals, including the midships torpedo rangefinder.
for name,x,z in [('bridge-rangefinder',23.727,13.512),('mid-rangefinder',-19.077,6.9135)]:
 cyl(name+'.column',(x,0,z+.65),.17,1.3,materials['naval'],vertices=24)
 rod(name+'.bar',(x,-1.08,z+1.42),(x,1.08,z+1.42),.16,materials['naval'],vertices=24)
 for side in [-1,1]:
  box(name+'.end-hood',(x,side*1.0,z+1.42),(.35,.28,.35),materials['naval'])
  rod(name+'.lens',(x+.18,side*1.0,z+1.42),(x+.19,side*1.0,z+1.42),.08,materials['glass'],vertices=16)
# The upper circular bridge enclosure is the director housing. Its aft optics
# are seated on a separate ledge at the approved rangefinder datum.
prism('bridge-rangefinder.ledge',outline_rect(23.2,24.25,-.5,.5,.1),12.74,13.512)
rod('main-director.roof-vent',(26.091,0,14.25),(26.091,0,14.45),.12,materials['naval'],vertices=20)
# Searchlight platform on its tower, rounded forward; searchlight on a pedestal and yoke.
platform('searchlight',[(-7.95,-.9),(-7.6,-1.25),(-6.0,-1.25),(-5.4,-.5),(-5.4,.5),(-6.0,1.25),(-7.6,1.25),(-7.95,.9)],8.3,[],False)
cyl('searchlight.pedestal',(-6.45,0,8.3+.35),.23,.7,materials['naval'],vertices=24)
for side in [-1,1]:rod('searchlight.yoke',(-6.45,side*.56,8.95),(-6.45,side*.56,9.82),.065,materials['edge'])
rod('searchlight.yoke-base',(-6.45,-.59,8.97),(-6.45,.59,8.97),.07,materials['edge'])
rod('searchlight.drum',(-6.9,0,9.75),(-6.0,0,9.75),.5,materials['naval'],vertices=32)
rod('searchlight.lens',(-6.0,0,9.75),(-5.98,0,9.75),.45,materials['glass'],vertices=32)
# After radio platform cantilevered from the searchlight tower, with the radio house and its loop antenna.
prism('radio-platform.deck',outline_rect(-10.8,-8.05,-2.5,2.5,.3),6.41,6.55)
rails('radio-platform.rails',[(-8.05,-2.5,6.55),(-10.8,-2.5,6.55),(-10.8,2.5,6.55),(-8.05,2.5,6.55)],.9)
for side in [-1,1]:
 for y in [side*1.0]:rod('radio-platform.bracket',(-7.3,y,6.19),(-10.6,y,6.41),.07,materials['naval'])
rod('radio-house.loop-mast',(-9.6,0,8.75),(-9.6,0,9.4),.04,materials['edge'],vertices=8)
tube_path('radio-house.loop',[(-9.6+.45*math.cos(a),0,9.85+.45*math.sin(a)) for a in [i*math.tau/20 for i in range(20)]],.025,materials['edge'],closed=True)
# Cutters beside the bridge as measured (7.2 m, keel at 6.41 m), in cradles under curved davits.
for side in [-1,1]:
 cx,cy,z=28.89,side*3.15,6.83
 stations=[(-3.6,.03,.30),(-2.96,.55,-.10),(-1.6,.86,-.35),(0,1,-.42),(1.6,.9,-.23),(2.96,.44,.05),(3.6,.02,.65)]
 vs=[(cx+xx,cy+yy,z+zz) for xx,w,k in stations for yy,zz in [(-w*.96,.7),(-w*.8,.02),(0,k),(w*.8,.02),(w*.96,.7)]]
 o=mesh('boat.shell',vs,[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(6) for j in range(4)],materials['wood'],smooth=True)
 mod=o.modifiers.new('Boat shell thickness','SOLIDIFY');mod.thickness=.04
 for sign in [-1,1]:tube_path('boat.gunwale',[(cx+xx,cy+sign*w*.96,z+.70) for xx,w,k in stations],.05,materials['naval'])
 for xx,w in [(-1.9,1.4),(-.9,1.6),(.25,1.72),(1.35,1.6),(2.25,1.25)]:box('boat.thwart',(cx+xx,cy,z+.37),(.29,w,.06),materials['wood'])
 box('boat.floor',(cx,cy,z-.13),(4.2,.7,.06),materials['wood'])
 for xx in [-1.9,1.9]:
  x=cx+xx
  for sign in [-1,1]:rod('boat.cradle',(x,cy+sign*.5,deckz(x)),(x,cy+sign*.55,z-.28),.085,materials['naval'])
  rod('boat.cradle-beam',(x,cy-.7,z-.32),(x,cy+.7,z-.32),.075,materials['edge'])
 for xx in [-1.55,1.55]:
  x=cx+xx
  tube_path('boat.davit',[(x,side*4.46,deckz(x)-.15),(x,side*4.46,7.9),(x,side*4.25,8.32),(x,side*3.8,8.44),(x,cy,8.36)],.07,materials['naval'],sides=12)
  rod('boat.fall',(x,cy,8.36),(x,cy,z+.9),.015,materials['rope'])
  for sign in [-1,1]:rod('boat.sling',(x,cy,z+.9),(x,cy+sign*.8,z+.7),.015,materials['rope'])
# Stern depth-charge thrower and four separate release cradles.
for l in definition['depthChargeLaunchers']:
 name=l['id'];a,z,c=l['position'];x,y=-c,-a;empty(name+'.release',(x,y,z))
 if name=='depth-charge-1':
  cyl(name+'.foot',(x,y,z+.1),.30,.2,materials['edge'],vertices=24)
  cyl(name+'.column',(x,y,z+.52),.15,.9,materials['naval'],vertices=24)
  rod(name+'.projector',(x-.20,y,z+.8),(x+.25,y,z+1.15),.12,materials['edge'])
  rod(name+'.charge',(x-.25,y-.38,z+1.12),(x-.25,y+.38,z+1.12),.22,materials['naval'],vertices=24)
 else:
  for side in [-1,1]:
   rod(name+'.track',(x-.43,y+side*.27,z+.1),(x+.45,y+side*.27,z+.1),.05,materials['edge'])
   for xx in [-.35,.35]:rod(name+'.foot',(x+xx,y+side*.27,deckz(x)),(x+xx,y+side*.27,z+.17),.04,materials['naval'])
  rod(name+'.charge',(x,y-.34,z+.24),(x,y+.34,z+.24),.22,materials['naval'],vertices=24)
  for side in [-1,1]:rod(name+'.drum-band',(x,y+side*.25-.015,z+.24),(x,y+side*.25+.015,z+.24),.235,materials['edge'],vertices=24)
# Screw shafts, A-brackets and handed three-blade propellers (1.5 m radius) as measured on the reference;
# twin rudders canted outward behind the screws. All struts and stocks run into the hull.
for side in [-1,1]:
 X=lambda v:side*v
 rod('propulsion.shaft',(-38.5,X(1.95),-2.0),(-53.2,X(2.14),-2.355),.16,materials['edge'],vertices=24)
 rod('propulsion.bracket-boss',(-50.3,X(2.13),-2.29),(-52.9,X(2.14),-2.34),.34,materials['underwater'],vertices=16)
 rod('propulsion.outer-strut',(-51.8,X(2.12),-.25),(-51.8,X(2.13),-2.05),.14,materials['underwater'],vertices=12)
 rod('propulsion.inner-strut',(-51.8,X(.9),-.45),(-51.8,X(1.95),-2.2),.12,materials['underwater'],vertices=12)
 rod('propulsion.hub',(-52.62,X(2.14),-2.355),(-53.5,X(2.14),-2.355),.3,materials['bronze'],vertices=24)
 rod('propulsion.cone',(-53.5,X(2.14),-2.355),(-54.4,X(2.14),-2.355),.3,materials['bronze'],r2=.05,vertices=24)
 for j in range(3):
  theta=math.pi/2+j*math.tau/3;vs=[]
  for r,hw,sweep in [(.28,.2,0),(.7,.42,.13),(1.15,.46,.24),(1.42,.26,.35),(1.5,.03,.39)]:
   for u in [-1,1]:
    a=theta+sweep+u*hw/max(r,.28);vs.append((-53.1+u*hw*.5,X(2.14)+side*r*math.cos(a),-2.355+r*math.sin(a)))
  o=mesh('propulsion.blade',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(4)],materials['bronze'],smooth=True);mod=o.modifiers.new('Cast blade thickness','SOLIDIFY');mod.thickness=.05
 # Rudder plate: leading edge at z 55.1, trailing edge 57.8, from the counter to 2.8 m down, canted 15 deg.
 outline=[(-55.1,-.15),(-57.8,-.08),(-57.85,-2.55),(-57.5,-2.85),(-55.4,-2.8),(-55.1,-2.5)]
 cant=lambda y:X(1.33-.27*y)
 vs=[(x,cant(y)+t*(.14 if x>-56.2 else .07),y) for t in [-1,1] for x,y in outline];n=len(outline)
 mesh('rudder.blade',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['underwater'])
 rod('rudder.stock',(-55.8,cant(-.3),-.3),(-55.8,cant(-.3),1.0),.13,materials['edge'])
# Anchors, capstans and shipboard fittings; each piece has a modeled deck attachment.
for side in [-1,1]:
 # Bollards and fairleads at the reference positions (forecastle and quarterdeck).
 for x,w in [(40.1,3.23),(45.3435,2.853),(52.6,1.7),(-44.3,4.12),(-50.1,3.7)]:
  y=side*w;z=deckz(x)
  box('mooring.base',(x,y,z+.09),(.9,.40,.18),materials['edge'])
  for dx in [-.27,.27]:
   cyl('mooring.bitt',(x+dx,y,z+.36),.10,.52,materials['naval'],vertices=16)
   cyl('mooring.cap',(x+dx,y,z+.62),.15,.045,materials['edge'],vertices=16)
 for x in [35,4,-10,-38]:locker('deck.ready-locker',(x,side*min(3,width(x)-.4),deckz(x)+.4),(.65,.52,.72))
 x=55;y=side*(width(x)-.08);z=4.65
 rod('anchor.shank',(x,y,z),(x-.55,y,z-.8),.08,materials['edge'])
 for sign in [-1,1]:
  rod('anchor.arm',(x-.55,y,z-.8),(x-.7,y+sign*.4,z-.85),.08,materials['edge'])
  rod('anchor.fluke',(x-.7,y+sign*.4,z-.85),(x-.2,y+sign*.4,z-.5),.10,materials['edge'],r2=.02)
 # Cable from the windlass over the stopper plates to the hawse pipes.
 for i in range(36):
  x=47.9+i*.205;y=side*(.25+.4*(x-47.9)/7.35);z=deckz(x)+.02
  tube_path('anchor.chain',[(x+.07*math.cos(j*math.tau/12),y+.039*math.sin(j*math.tau/12),z) for j in range(12)],.018,materials['edge'],sides=5,closed=True)
for x in [-50,47.5]:
 z=deckz(x);cyl('mooring.capstan',(x,0,z+.28),.42,.56,materials['naval'],vertices=24);cyl('mooring.capstan-top',(x,0,z+.6),.47,.09,materials['edge'],vertices=24)
for x in [-52,-47,-39,36,43.5]:
 z=deckz(x);box('deck.hatch',(x,.5,z+.17),(1.0,.75,.22),materials['naval'])
 for y in [.22,.78]:
  tube_path('deck.hatch-grab',[(x-.18,y,z+.29),(x-.18,y,z+.39),(x+.18,y,z+.39),(x+.18,y,z+.29)],.02,materials['edge'])
for x in [-48,34]:
 for side in [-1,1]:
  y=side*2;z=deckz(x)
  tube_path('ventilator.cowl',[(x,y,z),(x,y,z+.85),(x-.15,y,z+1.1),(x-.35,y,z+1.1)],.17,materials['naval'],sides=16)
  rod('ventilator.mouth',(x-.35,y,z+1.1),(x-.36,y,z+1.1),.14,materials['dark'],vertices=16)

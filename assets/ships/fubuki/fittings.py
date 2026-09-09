"""Original Fubuki A articulated banks and attached deck fittings.
Executed with the owning recipe's original helpers and blueprint definition.
"""
for l in definition['torpedoLaunchers']:
 name=l['id'];a,z,c=l['position'];x,y=-c,-a
 deck=5.0475 if name=='torpedo-1' else deckz(x)+.06
 cyl(name+'.foundation',(x,y,(deck+z+.18)/2),1.2,max(.05,z+.18-deck),materials['naval'],vertices=48)
 pivot=empty(name+'.yaw',(x,y,z))
 def put(o):return local(o,pivot,name)
 put(cyl(name+'.bearing',(0,0,.19),1.25,.25,materials['edge'],vertices=48))
 put(cyl(name+'.turntable',(0,0,.36),1.40,.13,materials['naval'],vertices=48))
 sections=[(-3.15,1.55,.75,1.82),(-2.05,2.25,.45,2.25),(1.28,2.31,.45,2.25),(1.75,2.13,.50,2.13)]
 vs=[]
 for xx,w,bottom,top in sections:
  vs += [(xx,-w,bottom),(xx,w,bottom),(xx,w,1.25),(xx,w-.20,top-.12),(xx,w-.38,top),(xx,-w+.38,top),(xx,-w+.20,top-.12),(xx,-w,1.25)]
 fs=[tuple(reversed(range(8))),tuple(range(24,32))]+[(k*8+j,k*8+(j+1)%8,(k+1)*8+(j+1)%8,(k+1)*8+j) for k in range(3) for j in range(8)]
 hood=put(mesh(name+'.working-shield',vs,fs,materials['naval']))
 bevel=hood.modifiers.new('Rounded shield corners','BEVEL');bevel.width=.05;bevel.segments=3
 for sign in [-1,1]:
  for xx in [-1,1]:put(rod(name+'.floor-beam',(xx,0,.39),(xx,sign*2.2,.50),.07,materials['edge']))
  put(box(name+'.access-door',(-.6,sign*2.32,1.22),(.65,.035,1.10),materials['naval'],bev=.06))
  for zz in [.93,1.48]:put(rod(name+'.door-dog',(-.86,sign*2.37,zz),(-.68,sign*2.37,zz),.02,materials['edge']))
  for xx in [-1.7,.65]:put(cyl(name+'.roof-hatch',(xx,sign*1.35,2.265),.19,.045,materials['edge'],vertices=24))
  for zz in [.65,.95,1.25,1.55,1.85]:
   w=2.29-max(0,zz-1.25)*.2
   put(tube_path(name+'.step',[(.8,sign*w,zz),(.8,sign*(w+.13),zz),(1.1,sign*(w+.13),zz),(1.1,sign*w,zz)],.018,materials['edge']))
  path=[(-3.08,sign*1.2,1.82),(-2.04,sign*1.83,2.25),(1.25,sign*1.9,2.25),(1.68,sign*1.7,2.13)]
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
 put(box(name+'.sight-hood',(1.74,0,1.7),(.22,.65,.35),materials['naval']))
 put(box(name+'.sight-slit',(1.858,0,1.77),(.014,.43,.10),materials['glass']))
# Reload shelters flank the deck between the banks; sheet-metal slats and supporting feet.
for x,z in [(6.3,3.5),(-33.3,3.4)]:
 for side in [-1,1]:
  y=side*3.0
  box('torpedo-stowage.body',(x,y,z+.67),(7.4,1.15,1.25),materials['naval'],bev=.08)
  for dx in [-3.1,3.1]:box('torpedo-stowage.foot',(x+dx,y,z+.09),(.3,1.2,.25),materials['edge'])
  for dx in [-3.5+i*.25 for i in range(29)]:rod('torpedo-stowage.rib',(x+dx,y+side*.59,z+.15),(x+dx,y+side*.59,z+1.28),.016,materials['edge'],vertices=6)
# Reload derricks over the aft shelters, with continuous deck-seated arms.
for x in [-30.0,-36.0]:
 for sign in [-1,1]:
  tube_path('reload-derrick.arm',[(x,sign*4.20,deckz(x)),(x,sign*4.20,5.80),(x,sign*3.95,6.60),(x,sign*3.25,7.15),(x,sign*2.75,7.22)],.075,materials['naval'],sides=16)
  rod('reload-derrick.fall',(x,sign*2.75,7.22),(x,sign*3.0,4.76),.015,materials['rope'])
# Masts: tripod forward, raked aftermast and supported yards/rigging.
for name,x,base,top in [('foremast',20.3,5.36,24.09),('aftmast',-29.2,5.54,17.9)]:
 rod(name+'.pole',(x,0,base),(x-1.15,0,top),.125,materials['edge'],r2=.03,vertices=16)
 if name=='foremast':
  for side in [-1,1]:
   rod(name+'.tripod-leg',(x-2.0,side*1.7,deckz(x-2)),(x-.65,0,16.0),.115,materials['naval'],r2=.065,vertices=14)
   for z in [7,10,13]:rod(name+'.brace',(x-2+(z-3.6)*1.35/12.4,side*1.7*(16-z)/12.4,z),(x-(z-base)/(top-base),0,z+1.6),.035,materials['edge'])
  prism('foremast.watch-platform',outline_rect(18.8,21,-.9,.9,.2),14.4,14.54)
  rails('foremast.watch-rails',[(18.8,-.9,14.54),(21,-.9,14.54),(21,.9,14.54),(18.8,.9,14.54)],.8,closed=True)
 for z,span in [(top-2,1.8),(top-5.3,3.1)]:
  xx=x-1.15*(z-base)/(top-base)
  rod(name+'.yard',(xx,-span,z),(xx,span,z),.04,materials['edge'],vertices=12)
  for side in [-1,1]:rod(name+'.yard-stay',(xx,side*span,z),(x-1.12,0,min(top,z+2.2)),.009,materials['edge'],vertices=5)
 ladder(name+'.ladder',(x-.1,0,base),(x-1.2,0,top-1),.3)
for side in [-1,1]:
 rod('rigging.aerial',(19.15,side*.25,23.9),(-30.35,side*.25,17.8),.01,materials['dark'],vertices=5)
 for x,z,mx,mz in [(58,8,19.15,23.9),(-58,4.8,-30.35,17.8)]:
  rod('rigging.staff',(x,side*.08,deckz(x)),(x,side*.08,z),.03,materials['edge'],vertices=10)
  rod('rigging.stay',(x,side*.08,z),(mx,side*.25,mz),.009,materials['dark'],vertices=5)
 for x,y,z in [(25,3.40,12.70),(18.6,3.7,3.55)]:rod('rigging.shroud',(19.2,0,22.6),(x,side*y,z),.009,materials['dark'],vertices=5)
# Optical instruments on real pedestals, including the midships torpedo rangefinder.
for name,x,z in [('bridge-rangefinder',23.727,13.512),('mid-rangefinder',-19.077,6.9135)]:
 cyl(name+'.column',(x,0,z+.58),.17,1.16,materials['naval'],vertices=24)
 rod(name+'.bar',(x,-1.08,z+1.42),(x,1.08,z+1.42),.16,materials['naval'],vertices=24)
 for side in [-1,1]:
  box(name+'.end-hood',(x,side*1.0,z+1.42),(.35,.28,.35),materials['naval'])
  rod(name+'.lens',(x+.18,side*1.0,z+1.42),(x+.19,side*1.0,z+1.42),.08,materials['glass'],vertices=16)
# The upper circular bridge enclosure is the director housing. Its aft optics
# are seated on a separate ledge at the approved rangefinder datum.
prism('bridge-rangefinder.ledge',outline_rect(22.7,24.2,-.6,.6,.1),12.70,13.512)
rod('main-director.roof-vent',(26.091,0,13.98),(26.091,0,14.22),.12,materials['naval'],vertices=20)
# Searchlight shelf aft of the second uptake.
platform('searchlight',outline_rect(-7.8,-5.5,-1.2,1.2,.3),7.92,[(-6.7,0,3.4)],False)
cyl('searchlight.pedestal',(-6.7,0,8.28),.23,.72,materials['naval'],vertices=24)
for side in [-1,1]:rod('searchlight.yoke',(-6.7,side*.46,8.45),(-6.7,side*.46,9.13),.065,materials['edge'])
rod('searchlight.drum',(-7.12,0,9.0),(-6.33,0,9.0),.48,materials['naval'],vertices=32)
rod('searchlight.lens',(-6.32,0,9.0),(-6.30,0,9.0),.43,materials['glass'],vertices=32)
# Cutters in twin cradles beside the bridge, with ribs and boat falls.
for side in [-1,1]:
 cx,cy,z=28.9,side*3.17,6.10
 stations=[(-4.5,.03,.30),(-3.7,.55,-.10),(-2,.86,-.35),(0,1,-.42),(2,.9,-.23),(3.7,.44,.05),(4.5,.02,.65)]
 vs=[(cx+xx,cy+yy,z+zz) for xx,w,k in stations for yy,zz in [(-w*.88,.7),(-w*.74,.02),(0,k),(w*.74,.02),(w*.88,.7)]]
 o=mesh('boat.shell',vs,[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(6) for j in range(4)],materials['wood'],smooth=True)
 mod=o.modifiers.new('Boat shell thickness','SOLIDIFY');mod.thickness=.04
 for sign in [-1,1]:tube_path('boat.gunwale',[(cx+xx,cy+sign*w*.88,z+.70) for xx,w,k in stations],.05,materials['naval'])
 for xx in [-2.4,-1.1,.3,1.7,2.8]:box('boat.thwart',(cx+xx,cy,z+.37),(.29,1.40,.06),materials['wood'])
 box('boat.floor',(cx,cy,z-.13),(5.2,.65,.06),materials['wood'])
 for xx in [-2.6,2.6]:
  x=cx+xx
  for sign in [-1,1]:rod('boat.cradle',(x,cy+sign*.5,deckz(x)),(x,cy+sign*.55,z+.04),.085,materials['naval'])
  rod('boat.cradle-beam',(x,cy-.7,z-.04),(x,cy+.7,z-.04),.075,materials['edge'])
  tube_path('boat.davit',[(x,side*4.1,deckz(x)),(x,side*4.1,7.7),(x,side*3.8,8.0),(x,cy,8.02)],.07,materials['naval'],sides=12)
  rod('boat.fall',(x,cy,8.02),(x,cy,z+.9),.015,materials['rope'])
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
# Screw shafts and handed three-blade propellers; all struts embedded in the hull.
for side in [-1,1]:
 rod('propulsion.shaft',(-35,side*1.6,-1.7),(-54,side*2.55,-1.95),.16,materials['edge'],vertices=24)
 for x in [-48,-51.8]:
  rod('propulsion.outer-strut',(x,side*3.4,-.2),(x,side*2.5,-1.94),.12,materials['naval'])
  rod('propulsion.inner-strut',(x,side*.8,-1.15),(x,side*2.5,-1.94),.10,materials['naval'])
 rod('propulsion.hub',(-53.6,side*2.55,-1.95),(-54.6,side*2.55,-1.95),.27,materials['bronze'],r2=.08,vertices=24)
 for j in range(3):
  theta=j*math.tau/3;vs=[]
  for r,hw,sweep in [(.20,.12,0),(.5,.27,.13),(.84,.31,.24),(1.04,.15,.35),(1.08,.015,.39)]:
   for u in [-1,1]:
    a=theta+side*(sweep+u*hw/max(r,.2));vs.append((-54.05+side*u*hw*.6,side*2.55+r*math.cos(a),-1.95+r*math.sin(a)))
  o=mesh('propulsion.blade',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(4)],materials['bronze'],smooth=True);mod=o.modifiers.new('Cast blade thickness','SOLIDIFY');mod.thickness=.045
outline=[(-58.0,-.5),(-56.0,-.5),(-55.7,-.9),(-55.9,-2.75),(-57.25,-2.8),(-57.9,-2.15)]
vs=[(x,y,z) for y in [-.12,.12] for x,z in outline];n=len(outline)
mesh('rudder.blade',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['underwater'])
rod('rudder.stock',(-56.8,0,-1.4),(-56.8,0,1.5),.14,materials['edge'])
# Anchors, capstans and shipboard fittings; each piece has a modeled deck attachment.
for side in [-1,1]:
 for x in [-56,-49,45.3435,53,56]:
  y=side*(2.853 if x==45.3435 else width(x)*.68);z=deckz(x)
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
 for i in range(36):
  x=50+i*.13;y=side*(.4+.09*(x-50));z=deckz(x)+.02
  tube_path('anchor.chain',[(x+.07*math.cos(j*math.tau/12),y+.039*math.sin(j*math.tau/12),z) for j in range(12)],.018,materials['edge'],sides=5,closed=True)
for x in [-50,50]:
 z=deckz(x);cyl('mooring.capstan',(x,0,z+.28),.42,.56,materials['naval'],vertices=24);cyl('mooring.capstan-top',(x,0,z+.6),.47,.09,materials['edge'],vertices=24)
for x in [-52,-47,-39,36,52]:
 z=deckz(x);box('deck.hatch',(x,.5,z+.17),(1.0,.75,.22),materials['naval'])
 for y in [.22,.78]:
  tube_path('deck.hatch-grab',[(x-.18,y,z+.29),(x-.18,y,z+.39),(x+.18,y,z+.39),(x+.18,y,z+.29)],.02,materials['edge'])
for x in [-48,34]:
 for side in [-1,1]:
  y=side*2;z=deckz(x)
  tube_path('ventilator.cowl',[(x,y,z),(x,y,z+.85),(x-.15,y,z+1.1),(x-.35,y,z+1.1)],.17,materials['naval'],sides=16)
  rod('ventilator.mouth',(x-.35,y,z+1.1),(x-.36,y,z+1.1),.14,materials['dark'],vertices=16)

"""Hull loft, deck fittings, mooring and anchor gear, scuttles, rails, staffs and underwater appendages.

The forecastle and quarterdeck gear, scuttle rows, shaft bossings, A-brackets, screws, twin rudders and bilge keels
are placed from the approved GameModels3D pgsb708 A_Hull at a common scale (reference z + 1.985 = runtime z,
y + 0.85); every shape here is an original construction.
"""
from bismarck_kit import *
def loft():
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
def edge(x):
 # Half-breadth of the weather deck edge.
 return side_width(x,deckz(x)-.02)
def hull_bottom(x,y):
 # Hull surface height under half-breadth y (the lowest loft crossing at that breadth).
 p=section_at(x)
 for (wa,za),(wb,zb) in zip(p,p[1:]):
  if min(wa,wb)<=abs(y)<=max(wa,wb) and abs(wb-wa)>1e-6:return za+(zb-za)*(abs(y)-wa)/(wb-wa)
 return p[0][1]
def side_normal(x,z,sign):
 # Outward normal of the loft side at (x, z) on one side, from finite differences of the half-breadth.
 dx=(side_width(x+.25,z)-side_width(x-.25,z))/.5;dz=(side_width(x,z+.2)-side_width(x,z-.2))/.4
 return Vector((-dx,sign,-dz)).normalized()
def recalc(ob):
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();return ob
def staffs():
 # Stern ensign staff and the jackstaff on the stem head.
 for x,top in [(-123,15.5),(123.9,11.5)]:rod('Ensign or jack staff',(x,0,deckz(x)),(x-.3,0,top),.08,materials['edge'],detailcol,.025,10)
def chain(name,pts,pitch=.5,length=.58,wide=.36,tube=.055):
 # Stud-link cable as one mesh: stadium-shaped links alternating flat and edge-up along a polyline.
 vs=[];fs=[];k=0;path=[Vector(p) for p in pts];half=length/2-wide/2
 for a,b in zip(path,path[1:]):
  d=b-a;count=max(1,round(d.length/pitch));axis=d.normalized();side=axis.cross(Vector((0,0,1)))
  if side.length<.1:side=Vector((0,1,0))
  side.normalize();up=side.cross(axis).normalized()
  for i in range(count):
   c=a+d*((i+.5)/count);u=up if k%2 else side;k+=1;normal=axis.cross(u)
   ring=[]
   for j in range(8):
    t=j*math.tau/8;ct=math.cos(t)
    ring.append(c+axis*((math.copysign(half,ct) if abs(ct)>1e-6 else 0)+wide/2*ct)+u*(wide/2*math.sin(t)))
   base=len(vs)
   for j,p in enumerate(ring):
    tangent=(ring[(j+1)%8]-ring[j-1]).normalized();out=tangent.cross(normal).normalized()
    if out.dot(p-c)<0:out=-out
    for q in range(4):vs.append(tuple(p+tube*(out*math.cos(q*math.tau/4)+normal*math.sin(q*math.tau/4))))
   for j in range(8):
    for q in range(4):
     a0=base+j*4+q;a1=base+j*4+(q+1)%4;b0=base+((j+1)%8)*4+q;b1=base+((j+1)%8)*4+(q+1)%4
     fs.append((a0,a1,b1,b0))
 return recalc(mesh(name,vs,fs,materials['dark'],detailcol,True))
def stockless_anchor(name,crown,shank_to,spread,s=1.0,span=1.2):
 # Original stockless anchor: tapered shank, cast crown, horseshoe arms curling back beside the shank and broad
 # flukes. crown: crown centre; shank_to: shank end (stopper or hawse); spread: direction across the arms.
 c=Vector(crown);t=Vector(shank_to);ax=(t-c).normalized();sp=Vector(spread);sp=(sp-ax*sp.dot(ax)).normalized();fl=ax.cross(sp).normalized()
 rod(name+' shank',c+ax*.2*s,t,.16*s,materials['edge'],detailcol,.12*s,10)
 rod(name+' shackle',t-ax*.1*s,t+ax*.3*s,.10*s,materials['edge'],detailcol,vertices=8)
 ob=box(name+' crown',tuple(c-ax*.05*s),(.6*s,.95*s,.46*s),materials['edge'],detailcol);ob.rotation_euler=Matrix((ax,sp,fl)).transposed().to_euler()
 k=span/1.2
 for sg in [-1,1]:
  # Arm: leaves the crown sideways, curls forward of it and sweeps back toward the shank end.
  arm=[c+sp*sg*.3*k-ax*.02*s,c+sp*sg*.8*k-ax*.12*s,c+sp*sg*1.05*k+ax*.25*s,c+sp*sg*1.02*k+ax*.75*s,c+sp*sg*.9*k+ax*1.05*s]
  polyline(name+' arm',[tuple(p) for p in arm],.14*s,materials['edge'],detailcol,False,8)
  # Broad fluke: a tapered cast plate at the arm end, pointing back along the shank.
  a,b=c+sp*sg*.95*k+ax*.8*s,c+sp*sg*.82*k+ax*1.75*s
  vs=[tuple(p+sp*w*s+fl*h*s) for p,wd in [(a,.3),(b,.16)] for w,h in [(-wd,-.08),(wd,-.08),(wd,.08),(-wd,.08)]]
  mesh(name+' fluke',vs,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],materials['edge'],detailcol)
 rod(name+' tripping palms',c-ax*.22*s-sp*.45*k,c-ax*.22*s+sp*.45*k,.11*s,materials['edge'],detailcol,vertices=8)
def windlass_capstan(name,x,y):
 # Cable capstan of the anchor windlass: bedplate, whelped barrel and a spoked head.
 z=deckz(x)
 cyl(name+' bedplate',(x,y,z+.07),1.08,.14,materials['naval'],detailcol,24)
 cyl(name+' whelped barrel',(x,y,z+.48),.74,.70,materials['edge'],detailcol,16)
 for i in range(8):
  a=i*math.tau/8;box(name+' whelp',(x+.74*math.cos(a),y+.74*math.sin(a),z+.48),(.16,.16,.64),materials['edge'],detailcol).rotation_euler.z=a
 cyl(name+' head',(x,y,z+.93),.98,.20,materials['edge'],detailcol,24)
 for i in range(8):
  a=i*math.tau/8;rod(name+' head spoke',(x,y,z+1.045),(x+.9*math.cos(a),y+.9*math.sin(a),z+1.045),.035,materials['dark'],detailcol,vertices=4)
 cyl(name+' boss',(x,y,z+1.07),.16,.08,materials['light'],detailcol,10)
def bitt_drum(name,x,y,width):
 # Paired squat bitts on one base with a small drum between them.
 z=deckz(x)
 box(name+' base',(x,y,z+.09),(2.6,width,.18),materials['naval'],detailcol)
 for dx in [-.73,.73]:
  cyl(name+' post',(x+dx,y,z+.5),.44,.64,materials['edge'],detailcol,8)
  cyl(name+' post cap',(x+dx,y,z+.84),.49,.06,materials['naval'],detailcol,8)
 cyl(name+' drum',(x,y,z+.48),.34,.6,materials['edge'],detailcol,12)
 for i in range(6):a=i*math.pi/6;rod(name+' drum vane',(x-.33*math.cos(a),y-.33*math.sin(a),z+.79),(x+.33*math.cos(a),y+.33*math.sin(a),z+.79),.02,materials['dark'],detailcol,vertices=4)
def bitts(name,x,y,gap=1.4):
 # Double mooring bitts on a welded sole plate.
 z=deckz(x);box(name+' sole',(x,y,z+.05),(gap+.6,.5,.1),materials['edge'],detailcol)
 for dx in [-gap/2,gap/2]:cyl(name+' post',(x+dx,y,z+.38),.2,.66,materials['edge'],detailcol,10);cyl(name+' head',(x+dx,y,z+.74),.26,.1,materials['naval'],detailcol,10)
def chock(name,x,y):
 # Closed mooring chock at the deck edge: sole, two cheeks and a top bar.
 z=deckz(x)
 box(name+' sole',(x,y,z+.06),(1.58,.6,.12),materials['edge'],detailcol)
 for dx in [-.64,.64]:box(name+' cheek',(x+dx,y,z+.3),(.3,.6,.48),materials['naval'],detailcol)
 box(name+' top bar',(x,y,z+.5),(1.58,.5,.08),materials['edge'],detailcol)
def hoop(name,x,y):
 # Upright fairlead hoop near the deck edge.
 z=deckz(x);box(name+' foot',(x,y,z+.05),(.72,.24,.1),materials['edge'],detailcol)
 for dx in [-.26,.26]:rod(name+' upright',(x+dx,y,z+.08),(x+dx,y,z+1.2),.05,materials['edge'],detailcol,vertices=6)
 rod(name+' head',(x-.3,y,z+1.2),(x+.3,y,z+1.2),.05,materials['edge'],detailcol,vertices=6)
def locker(name,x,y):
 # Hinged deck locker.
 z=deckz(x);box(name,(x,y,z+.28),(.8,.72,.56),materials['naval'],detailcol);box(name+' lid',(x,y,z+.585),(.86,.78,.05),materials['roof'],detailcol)
 for dx in [-.22,.22]:rod(name+' hinge',(x+dx-.07,y-.36,z+.57),(x+dx+.07,y-.36,z+.57),.03,materials['edge'],detailcol,vertices=6)
def bolster(name,sign,x0=110.05,x1=113.35):
 # Bulged anchor bolster at the deck edge: a rounded cheek swells out of the hull side under the stowed bower
 # anchor, capped by a low flat seat pad that carries the anchor's crown and outer fluke.
 mid=(x0+x1)/2;half=(x1-x0)/2;rings=[];vs=[];n=8
 for i in range(13):
  x=x0+(x1-x0)*i/12;e=math.sin(math.acos(max(-1,min(1,(x-mid)/half))));top=deckz(x)+.12;zb=top-.35-2.25*e
  ring=[(x,sign*(side_width(x,zb)-.08),zb)]
  for k in range(1,6):
   z=zb+(top-zb)*k/5;ring.append((x,sign*(side_width(x,min(z,deckz(x)-.05))+.6*e*math.sin(math.pi/2*k/5)),z))
  inner=edge(x)-.25-.75*e
  ring+=[(x,sign*inner,top),(x,sign*inner,deckz(x)-.3)]
  rings.append(len(vs));vs.extend(ring)
 fs=[tuple(range(n)),tuple(range(rings[-1],rings[-1]+n))]
 for r0,r1 in zip(rings,rings[1:]):fs.extend((r0+j,r0+(j+1)%n,r1+(j+1)%n,r1+j) for j in range(n))
 ob=recalc(mesh(name,vs,fs,materials['hullgray'],hullcol,True))
 # The seat pad (top) and its inner face are flat plate; only the cheek is smooth.
 for i,p in enumerate(ob.data.polygons):
  if i<2 or (i-2)%n in (5,6):p.use_smooth=False
 return ob
def deck_fittings(aa_support):
 # Forecastle: windlass capstans, stopper chains and cable stoppers, cables led forward to the bower anchors that
 # lie fore-and-aft on bulged bolsters at the deck edge; the stem anchor at the stem head; bitts, chocks, hoops and
 # the low V breakwater ahead of Anton. Quarterdeck: bitts with drums, chocks, hatches, companion hoods, lockers
 # and the port stern anchor.
 for sign in [-1,1]:
  windlass_capstan('Anchor windlass capstan',88.7,sign*2.6)
  x=92.75;z=deckz(x);box('Cable stopper',(x,sign*2.28,z+.17),(1.2,.52,.34),materials['naval'],detailcol)
  for dx in [-.3,.3]:rod('Cable stopper jaw',(x+dx,sign*2.28,z+.34),(x+dx+.12,sign*2.28,z+.52),.06,materials['edge'],detailcol,vertices=6)
  chain('Anchor cable',[(89.2,sign*1.98,deckz(89.2)+.12),(92.1,sign*2.28,deckz(92.1)+.12)])
  chain('Anchor cable',[(89.4,sign*3.3,deckz(89.4)+.12),(107.9,sign*3.3,deckz(107.9)+.12),(108.8,sign*3.12,deckz(108.8)+.14)])
  # Bower anchor on its bolster: shank aft to its stopper, crown forward, flukes flat on the seat.
  bolster('Anchor bolster',sign)
  box('Bower anchor stopper',(109.0,sign*3.12,deckz(109.0)+.18),(.5,.62,.36),materials['naval'],detailcol)
  # The arms lie rolled about the shank, the outer fluke down over the bolster's cheek.
  roll=math.radians(20)
  stockless_anchor('Bower anchor',(112.25,sign*3.12,deckz(112.25)+.36),(109.1,sign*3.12,deckz(109.1)+.3),(0,sign*math.cos(roll),-math.sin(roll)),1.0,1.25)
  bitts('Double mooring bitt',91.9,sign*7.45)
  chock('Deck edge chock',102.55,sign*min(5.45,edge(102.55)-.5))
  for x in [105.5,107.63]:hoop('Fairlead hoop',x,sign*(edge(x)-.55))
  # Quarterdeck.
  bitt_drum('Stern bitt',-96.85,sign*2.4,.95)
  chock('Deck edge chock',-101.2,sign*min(8.77,edge(-101.2)-.5))
  for x,y in [(-108.7,1.55),(-107.8,1.55),(-92.4,7.15),(-91.45,7.15),(-100.75,2.85),(-91.35,2.6)]:locker('Deck locker',x,sign*y)
  # Deck edge rails interpolate the blueprint sheer; the anchor bolsters interrupt them.
  xs=[-122.5+i*2 for i in range(123)]
  for part in [[x for x in xs if x<109.4],[x for x in xs if x>113.6]]:
   pts=[(x,sign*(edge(x)-.22),deckz(x)+.035) for x in part if edge(x)>.5]
   if len(pts)>1:rail('Weather deck safety rail',pts,.98,2.0,False)
  # Subtle rubbing strip, much thinner than the silhouette-defining hull.
  for part in [range(-120,110,2),range(114,123,2)]:
   pts=[(x,sign*(side_width(x,deckz(x)-.32)+.024),deckz(x)-.32) for x in part]
   polyline('Sheer strake edge',pts,.028,materials['edge'],vertices=5)
 # Centreline double bitt with its drum on the forecastle, and the two centreline vents.
 bitt_drum('Forecastle bitt',90.6,0,1.7)
 for x in [108.55,109.85]:
  z=deckz(x);cyl('Mushroom vent stem',(x,0,z+.3),.16,.6,materials['naval'],detailcol,12);cyl('Mushroom vent hood',(x,0,z+.64),.3,.2,materials['naval'],detailcol,16)
 # Stem anchor hangs in the stem head with its arms across the stem; short cable to its stopper on deck.
 x=121.4;box('Stem anchor stopper',(x,0,deckz(x)+.15),(.8,.6,.3),materials['naval'],detailcol)
 chain('Anchor cable',[(121.9,0,deckz(121.9)+.12),(123.3,0,deckz(123.3)+.12)],.42,.46,.29,.045)
 stockless_anchor('Stem anchor',(124.45,0,7.35),(122.95,0,deckz(122.95)-.25),(0,1,0),.95,1.35)
 # Low V breakwater ahead of Anton with a level top and knees on its after face.
 bw=[(77.9,9.9),(84.25,1.8),(84.25,-1.8),(77.9,-9.9)];top=7.38;samples=[]
 for (xa,ya),(xb,yb) in zip(bw,bw[1:]):
  n=max(1,math.ceil(math.hypot(xb-xa,yb-ya)/1.0))
  for i in range(n):samples.append((xa+(xb-xa)*i/n,ya+(yb-ya)*i/n))
 samples.append(bw[-1]);vs=[];fs=[]
 for x,y in samples:vs.extend([(x,y,deckz(x)-.05),(x,y,top)])
 for i in range(len(samples)-1):fs.append((2*i,2*i+2,2*i+3,2*i+1))
 ob=mesh('Breakwater plate',vs,fs,materials['naval'],supercol);mod=ob.modifiers.new('Plate thickness','SOLIDIFY');mod.thickness=.05
 polyline('Breakwater top rim',[(x,y,top) for x,y in samples],.035,materials['edge'],detailcol,False,5)
 for (x,y),(x2,y2) in zip(samples[::2],samples[2::2]):
  d=Vector((x2-x,y2-y,0)).normalized();back=Vector((-d.y,d.x,0))
  if back.x>0:back=-back
  z=deckz(x);ob=mesh('Breakwater knee',[(x,y,z),(x,y,top-.08),(x+back.x*.6,y+back.y*.6,z)],[(0,1,2)],materials['naval'],detailcol);ob.modifiers.new('Plate','SOLIDIFY').thickness=.03
 # Port stern anchor hangs in its quarter hawse; its cable runs forward to a stopper.
 x=-115.65;box('Stern anchor stopper',(x,.68,deckz(x)+.16),(1.6,.95,.32),materials['naval'],detailcol)
 box('Stern hawse deck plate',(-121.8,1.75,deckz(-121.8)+.03),(1.3,.9,.06),materials['edge'],detailcol)
 chain('Anchor cable',[(-121.4,1.72,deckz(-121.4)+.12),(-116.5,.7,deckz(-116.5)+.12)],.42,.46,.29,.045)
 zc=4.75;xc=-122.55;yc=side_width(xc,zc)+.28;ze=6.5;xe=-124.0;ye=side_width(xe,ze)-.05
 ax=Vector((xe-xc,ye-yc,ze-zc)).normalized();sp=ax.cross(Vector((0,1,0)))
 stockless_anchor('Stern anchor',(xc,yc,zc),(xe,ye,ze),tuple(sp),.8,.95)
 # Quarterdeck hatches and companion hoods.
 for x,y,sx,sy in [(-103.15,.45,1.5,1.25),(-102.9,-1.15,1.2,1.25),(114.05,-1.1,1.1,.9)]:hatch('Weather deck hatch',x,y,deckz(x)+.005,sx,sy)
 for x,y,sx,sy in [(-101.65,1.05,1.1,1.5),(-101.05,-1.12,1.45,1.85)]:
  z=deckz(x);extrude('Companion hood',rounded_rect(x,y,sx,sy,.3,3),z,.62,materials['naval'],detailcol,.03)
  extrude('Companion hood roof',rounded_rect(x,y,sx+.06,sy+.06,.32,3),z+.62,.05,materials['roof'],detailcol)
 # Hatches beside the superstructure stay where the main deck is open.
 for x,y in [(57,8),(57,-8),(-64,8),(-64,-8),(1,14),(1,-14),(-47,12),(-47,-12)]:
  if aa_support.below(x,y,deckz(x)+3)>deckz(x)+.1:continue
  hatch('Weather deck hatch',x,y,deckz(x)+.005,1.35,.95)
 # Hose reels on the open main deck at the ends of the superstructure.
 for x,y in [(51.6,6.6),(52.2,-6.3),(-59.5,8.6),(-59.5,-8.6),(-63.3,5.3),(-63.3,-5.3)]:
  z=deckz(x)
  if aa_support.below(x,y,z+3)>z+.1:continue
  z+=.55
  rod('Hose reel axle',(x,y-.55,z),(x,y+.55,z),.11,materials['edge'],detailcol,vertices=12)
  for yy in [-.38,.38]:rod('Hose reel flange',(x,y+yy-.035,z),(x,y+yy+.035,z),.53,materials['edge'],detailcol,vertices=24)
  rod('Hose drum',(x,y-.34,z),(x,y+.34,z),.37,materials['rope'],detailcol,vertices=24)
  for yy in [-.45,.45]:box('Reel support',(x,y+yy,z-.30),(.18,.12,.55),materials['naval'],detailcol)
 # Scuttles where the approved reference paints them: two rows in the forecastle side and two in the
 # quarterdeck side; the armoured belt amidships has none.
 rows=[[(84.3+(106.22-84.3)*i/8,1.97+1.05*i/8) for i in range(9)],[(86.43+(106.38-86.43)*i/7,4.81+.79*i/7) for i in range(8)],
       [(-95.2,4.37),(-96.6,4.36),(-98.03,4.35),(-99.47,4.37),(-100.73,4.4),(-102.07,4.48),(-103.39,4.55),(-105.07,4.53),(-106.1,4.55),(-108.51,4.61),
        (-110.51,4.64),(-111.48,4.65),(-112.99,4.69),(-114.13,4.75),(-115.89,4.82),(-117.09,4.82),(-118.76,4.88),(-120.04,4.97),(-121.97,4.99)],
       [(-95.12,2.04),(-97.77,2.07),(-100.52,2.16),(-103.13,2.19),(-104.46,2.25),(-106.52,2.24),(-107.56,2.28),(-109.28,2.32),(-110.32,2.36),
        (-112.84,2.4),(-114.19,2.45),(-115.8,2.48),(-117.38,2.5),(-119.01,2.51),(-120.6,2.6)]]
 for sign in [-1,1]:
  for row in rows:
   for x,z in row:
    n=side_normal(x,z,sign);yy=sign*side_width(x,z)
    porthole('Hull round scuttle',Vector((x,yy,z))+n*.034,n,.145)
def underwater():
 # Original three-bladed screws: broad paddle outlines, reduced rake, helical pitch and thick roots into rounded
 # bosses. Shaft lines, bossings, A-brackets, twin rudders and bilge keels follow the approved pgsb708 A_Hull.
 # These visual shafts do not move the blueprint's machinery or combat sockets.
 def screw_boss(x,y,z):
  rows=[(1.16,.30),(.83,.59),(.34,.73),(-.34,.72),(-.85,.61),(-1.18,.39),(-1.34,.08)]
  vs=[(x+dx,y+r*math.cos(math.tau*i/24),z+r*math.sin(math.tau*i/24)) for dx,r in rows for i in range(24)]
  fs=[tuple(reversed(range(24))),tuple(range((len(rows)-1)*24,len(rows)*24))]
  fs.extend((j*24+i,j*24+(i+1)%24,(j+1)*24+(i+1)%24,(j+1)*24+i) for j in range(len(rows)-1) for i in range(24))
  return recalc(mesh('Propeller boss',vs,fs,materials['bronze'],undercol,True))
 def strut(name,a,b,chord=.72):
  # Closed foil strut: a wide axial chord and a narrow rounded trailing edge.
  a,b=Vector(a),Vector(b);radial=(b-a).normalized();side=radial.cross(Vector((1,0,0))).normalized()
  profile=[(-.52,0),(-.36,.10),(.16,.12),(.48,.04),(.54,0),(.48,-.04),(.16,-.12),(-.36,-.10)]
  vs=[p+Vector((u*chord,0,0))+side*v for p in [a,b] for u,v in profile];n=len(profile)
  fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  return recalc(mesh(name,vs,fs,materials['oxide'],undercol,True))
 def screw(xhub,y,z,radius=2.15):
  screw_boss(xhub,y,z);k=radius/2.4
  for angle in [math.pi/2,math.pi/2+math.tau/3,math.pi/2+2*math.tau/3]:
   # Radial radius, tangential sweep, half chord. Sparse original controls are
   # interpolated for a continuous rounded edge without a pinched angular tip.
   controls=[(.55,-.08,.30),(.82,-.08,.52),(1.15,-.03,.79),(1.55,.03,1.02),(1.95,.07,1.02),(2.20,.06,.80),(2.35,.02,.44),(2.40,0,.035)]
   controls=[(r*k if r>.6 else r,s*k,w*k) for r,s,w in controls]
   rows=[]
   for a,b in zip(controls,controls[1:]):
    for step in range(3):
     t=step/3;rows.append(tuple(u+(v-u)*t for u,v in zip(a,b)))
   rows.append(controls[-1]);cols=9;vs=[]
   for face in [-1,1]:
    for r,sweep,w in rows:
     pitch=math.atan2(3.6*k,math.tau*r)
     for i in range(cols):
      q=-1+2*i/(cols-1);chord=q*w;tangent=sweep+chord*math.cos(pitch)
      thickness=(.012+.105*(1-r/(2.6*k)))*math.sqrt(max(0,1-q*q))+.008
      axial=chord*math.sin(pitch)+.035*(r-.55)+face*thickness
      vs.append((xhub+axial,y+r*math.cos(angle)-tangent*math.sin(angle),z+r*math.sin(angle)+tangent*math.cos(angle)))
   n=len(rows)*cols;fs=[]
   for face in [0,1]:
    for j in range(len(rows)-1):
     for i in range(cols-1):
      ids=(face*n+j*cols+i,face*n+j*cols+i+1,face*n+(j+1)*cols+i+1,face*n+(j+1)*cols+i);fs.append(ids if face else tuple(reversed(ids)))
   boundary=list(range(cols))+[j*cols+cols-1 for j in range(1,len(rows))]+list(range(n-2,n-cols-1,-1))+[j*cols for j in reversed(range(1,len(rows)-1))]
   fs.extend((a,b,b+n,a+n) for a,b in zip(boundary,boundary[1:]+boundary[:1]))
   recalc(mesh('Twisted screw blade',vs,fs,materials['bronze'],undercol,True))
 for sign in [-1,1]:
  # Long streamlined bossing around each wing shaft: a broad fairing where it leaves the bottom, narrowing to a
  # tube around the shaft that ends short of the A-bracket, leaving the shaft exposed between them.
  table=[(-68.2,6.3,.1,-7.78),(-70.0,6.35,1.2,-7.82),(-72.0,6.4,1.75,-7.82),(-74.0,6.25,1.9,-7.82),(-76.0,6.2,1.75,-7.75),(-78.0,6.1,1.45,-7.65),
         (-80.0,6.0,1.1,-7.58),(-82.0,5.95,.9,-7.48),(-84.0,5.93,.72,-7.33),(-86.0,5.93,.64,-7.19),(-88.0,5.95,.58,-7.03),(-90.0,5.96,.5,-6.86),(-91.6,5.98,.38,-6.8)]
  vs=[];rings=[]
  for x,yc,a,zb in table:
   top=hull_bottom(x,yc)+.35;zc=(top+zb)/2;b=max(.05,(top-zb)/2)
   rings.append(len(vs))
   for i in range(12):
    t=i*math.tau/12;vs.append((x,sign*(yc+a*math.cos(t)),zc+b*math.sin(t)))
  fs=[tuple(range(12)),tuple(range(rings[-1],rings[-1]+12))]
  for r0,r1 in zip(rings,rings[1:]):fs.extend((r0+i,r0+(i+1)%12,r1+(i+1)%12,r1+i) for i in range(12))
  recalc(mesh('Shaft bossing',vs,fs,materials['oxide'],undercol,True))
  # Exposed wing shaft, A-bracket barrel with a vertical arm to the bottom and a raking arm to the skeg, screw.
  y=sign*6.0
  rod('Propeller shaft',(-90.4,y,-6.46),(-99.2,y,-6.49),.33,materials['edge'],undercol,vertices=16)
  rod('Shaft A-bracket barrel',(-95.45,y,-6.46),(-98.6,y,-6.48),.72,materials['oxide'],undercol,.62,20)
  strut('Shaft A-bracket arm',(-97.0,sign*6.1,-6.1),(-97.0,sign*6.1,hull_bottom(-97.0,6.1)+.25),1.3)
  zf=-4.85;strut('Shaft A-bracket arm',(-97.0,sign*5.45,-6.3),(-97.0,sign*(side_width(-97.0,zf)-.1),zf),.95)
  screw(-100.05,y,-6.49)
  # Twin balanced rudders abreast of the centre screw's race.
  yr=sign*2.47
  pts=[(-114.65,yr),(-112.6,yr-.42),(-110.3,yr-.6),(-108.8,yr-.42),(-108.2,yr),(-108.8,yr+.42),(-110.3,yr+.6),(-112.6,yr+.42)]
  top=max(hull_bottom(x,2.47) for x in [-108.4,-111,-114.4])+.25
  extrude('Twin balanced rudder',pts,-6.95,top+6.95,materials['oxide'],undercol,.06)
  cyl('Rudder head bearing',(-110.3,yr,hull_bottom(-110.3,2.47)+.02),.55,.35,materials['oxide'],undercol,16)
  # Bilge keels along the midship bilge only.
  stations=[-27.3,-21.3,-15.4,-9.5,-3.6,2.3,8.2,14.1,20.0,25.9];vs=[]
  zc=[-7.06,-7.81,-8.26,-8.40,-8.35,-8.53,-8.31,-8.14,-7.68,-6.33];depth=[.05,.62,.95,1.05,1.08,1.08,1.05,.95,.6,.05]
  for x,z,dp in zip(stations,zc,depth):
   zr=z+.45*dp;w=side_width(x,zr)-.03;d=Vector((.72,-.69))*dp
   vs.extend([(x,sign*w,zr+.04),(x,sign*(w+d.x),zr+d.y+.02),(x,sign*(w+d.x),zr+d.y-.02),(x,sign*w,zr-.04)])
  fs=[(i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j) for i in range(len(stations)-1) for j in range(4)]+[(3,2,1,0),tuple(range((len(stations)-1)*4,len(stations)*4))]
  recalc(mesh('Bilge keel',vs,fs,materials['oxide'],undercol))
 # The centre shaft leaves the skeg's shaft tube; its screw turns just ahead of the twin rudders.
 rod('Propeller shaft',(-104.2,0,-7.05),(-106.4,0,-7.05),.36,materials['edge'],undercol,vertices=16)
 screw(-107.1,0,-7.05,2.0)
def build():
 # Region entry point, after the superstructure regions; the loft itself runs first of all (loft()).
 staffs()
def after_mounts(aa_support):
 deck_fittings(aa_support);underwater()

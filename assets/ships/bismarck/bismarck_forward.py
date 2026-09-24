"""Forward superstructure: battery and shelter decks, bridge, conning tower, tower, foretop, foremast,
forward directors, night rangefinders, AA directors and the foretop searchlight.

The tower follows the approved pgsb708 A fit level by level: a faceted octagonal core, galleries with
plated undersides on a joist grid, deep bulwarks with wind lips, SL-8 domes on tall pedestal towers and a
short pole foremast. Original construction throughout; new work is authored in the true frame
(Blender x = -runtime z); only bridge_details() keeps the legacy 2 m forward frame."""
from bismarck_kit import *

def plan(sid):
 # A blueprint footprint in the true Blender plan frame (x bow, y port).
 return [(-z,-x) for x,z in structures[sid]['footprint']]
def ccw(pts):
 pts=list(pts)
 if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))<0:pts.reverse()
 return pts
def outward(a,b):
 # Outward normal of edge a->b on a counter-clockwise ring.
 dx,dy=b[0]-a[0],b[1]-a[1];l=math.hypot(dx,dy) or 1
 return (dy/l,-dx/l)
def band(name,pts,z0,z1,thick=.05,closed=True,lip=None,mat=None,col=None):
 """A continuous plated wall (bulwark, screen) along a counter-clockwise chain, outer face on the chain.
 lip=(out,up) adds a thin outward-sloping wind deflector on its top edge. One mesh per call."""
 pts=list(pts);n=len(pts)
 if n<2:return None
 edges=[(i,(i+1)%n) for i in range(n if closed else n-1)]
 en=[outward(pts[i],pts[j]) for i,j in edges]
 vn=[]
 for k in range(n):
  ins=[e for e,(i,j) in enumerate(edges) if j==k];outs=[e for e,(i,j) in enumerate(edges) if i==k]
  ns=[en[e] for e in ins+outs]
  mx,my=sum(v[0] for v in ns),sum(v[1] for v in ns);l=math.hypot(mx,my) or 1;mx,my=mx/l,my/l
  scale=1/max(.45,mx*ns[0][0]+my*ns[0][1]);vn.append((mx*scale,my*scale))
 vs=[];fs=[]
 for (x,y),(nx,ny) in zip(pts,vn):
  vs+=[(x,y,z0),(x,y,z1),(x-nx*thick,y-ny*thick,z1),(x-nx*thick,y-ny*thick,z0)]
 for i,j in edges:
  a,b=4*i,4*j
  fs+=[(a,b,b+1,a+1),(a+1,b+1,b+2,a+2),(a+2,b+2,b+3,a+3)]
 if not closed:fs+=[(0,1,2,3),(4*(n-1)+3,4*(n-1)+2,4*(n-1)+1,4*(n-1))]
 if lip:
  out,up=lip;base=len(vs)
  for (x,y),(nx,ny) in zip(pts,vn):
   vs+=[(x+nx*out,y+ny*out,z1+up),(x+nx*out,y+ny*out,z1+up-.05),(x,y,z1-.05)]
  for i,j in edges:
   a,b=base+3*i,base+3*j
   fs+=[(a,b,4*j+1,4*i+1),(a+1,b+1,b,a),(a+2,b+2,b+1,a+1)]
 return mesh(name,vs,fs,mat or materials['naval'],col or supercol)
def boxes(name,specs,mat=None,col=None):
 # Many axis-aligned plates or bars in one mesh: specs are (cx,cy,cz,sx,sy,sz).
 vs=[];fs=[]
 for cx,cy,cz,sx,sy,sz in specs:
  k=len(vs);x,y,z=sx/2,sy/2,sz/2
  vs+=[(cx+a*x,cy+b*y,cz+c*z) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
  fs+=[tuple(k+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
 return mesh(name,vs,fs,mat or materials['naval'],col or supercol) if vs else None
def crossings(pts,axis,v):
 # Intervals of the line coord[axis]==v that lie inside the ring pts.
 o=1-axis;xs=[]
 for a,b in zip(pts,pts[1:]+pts[:1]):
  if (a[axis]-v)*(b[axis]-v)<0:xs.append(a[o]+(v-a[axis])/(b[axis]-a[axis])*(b[o]-a[o]))
 xs.sort();return list(zip(xs[0::2],xs[1::2]))
def minus(intervals,holes):
 out=[]
 for a,b in intervals:
  cur=[(a,b)]
  for h0,h1 in holes:
   nxt=[]
   for c0,c1 in cur:
    if h1<=c0 or h0>=c1:nxt.append((c0,c1));continue
    if h0>c0:nxt.append((c0,h0))
    if h1<c1:nxt.append((h1,c1))
   cur=nxt
  out+=cur
 return out
def joists(name,pts,z,spacing=1.05,depth=.24,width=.09,holes=(),col=None):
 """Plated platform underside: a grid of flanged beams under the deck plate at z, clipped to the platform
 and kept out of the houses (holes) that carry it."""
 specs=[]
 for axis in (0,1):
  o=1-axis;lo=min(p[axis] for p in pts);hi=max(p[axis] for p in pts);n=max(1,int((hi-lo)/spacing))
  for i in range(1,n+1):
   v=lo+(hi-lo)*i/(n+1)
   for a,b in minus(crossings(pts,axis,v),[h for hole in holes for h in crossings(hole,axis,v)]):
    a+=.05;b-=.05
    if b-a<.3:continue
    c=[0,0];c[axis]=v;c[o]=(a+b)/2;s=[0,0];s[axis]=width;s[o]=b-a
    specs.append((c[0],c[1],z-depth/2,s[0],s[1],depth))
    specs.append((c[0],c[1],z-depth+.02,s[0]+(.14 if axis==0 else 0),s[1]+(.14 if axis==1 else 0),.04))
 return boxes(name,specs,materials['naval'],col)
def strut(name,a,b,r=.085,col=None):
 return rod(name,a,b,r,materials['naval'],col or supercol,vertices=4)
def aerial_frame(name,x,y0,y1,z,drop,depth):
 # W/T aerial outrigger: a boom out to a light rectangular frame that hangs below its end.
 rod(name+' boom',(x,y0,z),(x,y1,z),.045,materials['edge'],detailcol,.03,5)
 rod(name+' boom brace',(x,y0,z-drop),(x,(y0+y1)/2,z),.02,materials['edge'],detailcol,vertices=4)
 polyline(name+' frame',[(x-depth/2,y1,z),(x+depth/2,y1,z),(x+depth/2,y1,z-drop),(x-depth/2,y1,z-drop)],.016,materials['edge'],closed=True,vertices=4)
 rod(name+' frame hanger',(x,y1,z),(x,y1,z-drop),.014,materials['edge'],detailcol,vertices=4)
def chains(pts,keep):
 # Split a closed ring into open runs of edges for which keep(a,b) is true.
 n=len(pts);flags=[keep(pts[i],pts[(i+1)%n]) for i in range(n)]
 if all(flags):return [pts+[pts[0]]]
 start=flags.index(False);runs=[];cur=[]
 for k in range(1,n+1):
  i=(start+k)%n
  if flags[i]:
   if not cur:cur=[pts[i]]
   cur.append(pts[(i+1)%n])
  elif cur:runs.append(cur);cur=[]
 if cur:runs.append(cur)
 return runs

# ---------------------------------------------------------------- tower galleries
# The fan of rod knees under every gallery is replaced by what the approved model shows: a flat
# plated underside on a joist grid, a few heavy square struts and deep bulwarks with a wind lip.
CORE=None
def core():
 global CORE
 if CORE is None:CORE=ccw(plan('tower-upper-shaft'))
 return CORE
def deck_plate(s):
 pts=ccw(plan(s['id']))
 ob=extrude(s['name'],pts,s['baseY'],s['height'],materials[s['material']],supercol,.025);ob['assemblyId']='superstructure-'+s['id']
 return pts
def open_rails(name,runs,z,height=.9,spacing=1.5):
 for run in runs:
  if len(run)>1:rail(name,[(x,y,z+.005) for x,y in run],height,spacing,False,col=supercol)
def draw_signal_platform(s):
 pts=deck_plate(s);top=s['baseY']+s['height']
 # Handrails round the deck except where the two night-rangefinder tubs stand.
 tubs=[(15.08,sign*5.5) for sign in [-1,1]]
 def covered(a,b):
  mx,my=(a[0]+b[0])/2,abs(a[1]+b[1])/2
  return (any(math.hypot(mx-tx,(a[1]+b[1])/2-ty)<2.05 for tx,ty in tubs) or (14.4<mx<18.7 and my<3.36)
   or (8.9<mx<14.5 and my>2.7))
 open_rails('signal-platform',chains(pts,lambda a,b:not covered(a,b)),top)
 for tx,ty in tubs:
  ring_pts=[(tx+1.36*math.cos(math.tau*(i+.5)/10),ty+1.36*math.sin(math.tau*(i+.5)/10)) for i in range(10)]
  band('Night rangefinder tub bulwark',ring_pts,top,top+.98,.05,True,(.1,.1))
  extrude('Night rangefinder tub floor',ring_pts,top,.04,materials['roof'],supercol)
 joists('signal-platform joist',pts,s['baseY'],holes=[core(),ccw(plan('signal-house'))])
 for sign in [-1,1]:
  # Heavy square struts carry the tubs down to the edge of the lower gallery.
  for xx in [14.35,15.65]:
   strut('Night rangefinder platform strut',(xx,sign*6.35,s['baseY']-.02),(xx,sign*3.98,17.66))
  strut('Night rangefinder strut brace',(14.35,sign*4.8,18.9),(15.65,sign*5.95,20.3),.05)
def draw_fore_aa_platform(s):
 pts=deck_plate(s);top=s['baseY']+s['height'];aft=min(x for x,y in pts)
 closed=lambda a,b:(a[0]+b[0])/2>=aft+.9
 for run in chains(pts,closed):band('Searchlight gallery splinter bulwark',run,top,top+.98,.05,False,(.14,.12))
 open_rails('fore-aa-platform',chains(pts,lambda a,b:not closed(a,b)),top)
 joists('fore-aa-platform joist',pts,s['baseY'],holes=[core()])
 # pgsb708 at y 23.4: a transverse locker across the signal house roof, a centre web out to the nose
 # and a plate under the nose (the rest of the gallery rides on the core and the struts below).
 boxes('Searchlight gallery nose web',[(17.575,0,23.55,.65,9.8,.7),(21.0,0,(23.1+s['baseY'])/2,.4,4.1,s['baseY']-23.1)])
 for sign in [-1,1]:
  # Struts from the signal house roof edges out to the gallery wings.
  for xx in [15.3,17.1,18.3]:strut('Searchlight gallery strut',(xx,sign*4.75,s['baseY']-.02),(xx,sign*3.15,23.22))
  # W/T aerial outriggers at the wing tips (pgsb708 shows frames below the wings).
  aerial_frame('Searchlight gallery aerial outrigger',17.1,sign*6.2,sign*9.2,24.36,.75,1.4)
def draw_foretop_platform(s):
 pts=deck_plate(s);top=s['baseY']+s['height'];aft=min(x for x,y in pts)
 closed=lambda a,b:(a[0]+b[0])/2>=aft+1.55
 for run in chains(pts,closed):band('Foretop splinter bulwark',run,top,top+1.06,.05,False,(.2,.3))
 open_rails('foretop-platform',chains(pts,lambda a,b:not closed(a,b)),top)
 joists('foretop-platform joist',pts,s['baseY'],holes=[core()])
 for sign in [-1,1]:
  for xa,yy,xb,ty,zz in [(9.3,4.5,11.2,1.33,25.3),(12.4,4.5,12.4,1.93,25.0),(15.2,2.6,15.2,1.95,25.2)]:
   strut('Foretop platform strut',(xa,sign*yy,s['baseY']-.02),(xb,sign*ty,zz))
def draw_tower_gallery(s):
 pts=deck_plate(s);top=s['baseY']+s['height'];aft=min(x for x,y in pts)
 closed=lambda a,b:(a[0]+b[0])/2>=aft+.9
 for run in chains(pts,closed):band('Lower tower gallery bulwark',run,top,top+.65,.05,False,(.1,.1))
 open_rails('tower-lower-gallery',chains(pts,lambda a,b:not closed(a,b)),top)
structure_drawers.update({'signal-platform':draw_signal_platform,'fore-aa-platform':draw_fore_aa_platform,
 'foretop-platform':draw_foretop_platform,'tower-lower-gallery':draw_tower_gallery})

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
 wall_windows('conning-tower',17.30,.12,1.3)
 wall_windows('foretop-control',28.96,.14,2.4,.22)
 # The upper control house has small apertures; the former full window ribbon
 # exaggerated its width. All service fittings bear on their actual deck or wall.
 for sign in [-1,1]:
  for sid,zz,xx in [('tower-mast-base',16.25,20.0)]:
   pts=[(-zz+2,-xx) for xx,zz in structures[sid]['footprint']]
   yy,normal=house_side(pts,xx,sign);porthole('Tower wall aperture',Vector((xx,yy,zz))+normal*.04,normal,.18)
 for sign in [-1,1]:
  # A low locker fitted on the signal deck.
  box('Signal bridge locker',(12.9,sign*3.15,21.02),(2.3,.46,.74),materials['naval'],detailcol)
  for xx in [12.2,12.9,13.6]:box('Signal locker panel',(xx,sign*3.40,21.02),(.57,.035,.56),materials['edge'],detailcol)
  for name,a,b,inner in [
   ('Forward exterior stair',(41.2,7.9,8.4),(36.0,7.9,13.1),7.45),
   ('Navigation bridge stair',(29.8,7.1,13.1),(27.4,7.1,15.4),5.85),
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

# ---------------------------------------------------------------- tower fittings (true frame)
def core_details():
 # Horizontal plating seams on the faceted core and the small after trunk the approved model carries.
 pts=core()
 for zz in [19.9,22.3,24.1,26.0]:polyline('Tower core plating seam',[(x,y,zz) for x,y in pts],.018,materials['edge'],supercol,True,4)
 box('Tower after trunk',(10.28,0,22.7),(1.26,2.7,4.1),materials['naval'],supercol)
 extrude('Tower after trunk cap',rounded_rect(10.28,0,1.36,2.8,.1,1),24.75,.06,materials['roof'],supercol)
 for sign in [-1,1]:
  for xx,zz in [(11.8,25.9),(13.2,25.9),(11.8,24.4),(11.4,22.1),(13.9,19.1)]:
   yy,normal=house_side(pts,xx,sign);porthole('Tower core scuttle',Vector((xx,yy,zz))+normal*.04,normal,.17)
def pelorus(name,x,y,deck,height=1.3):
 cyl(name+' stand',(x,y,deck+height/2),.12,height,materials['naval'],detailcol,12)
 cyl(name+' binnacle',(x,y,deck+height+.05),.24,.12,materials['edge'],detailcol,16)
 rod(name+' sighting vane',(x-.22,y,deck+height+.15),(x+.26,y,deck+height+.15),.025,materials['dark'],detailcol,vertices=4)
def target_giver(name,x,y,deck,bearing=0,height=1.0):
 # Pedestal-mounted target designation binocular: column, turning head, twin eyepieces and hood.
 c,s_=math.cos(bearing),math.sin(bearing)
 def p(a,b,h):return (x+a*c-b*s_,y+a*s_+b*c,deck+h)
 cyl(name+' foot',(x,y,deck+.03),.24,.06,materials['edge'],detailcol,12)
 rod(name+' column',p(0,0,.05),p(0,0,height-.1),.1,materials['naval'],detailcol,.08,10)
 hd=box(name+' sight head',p(0,0,height),(.52,.36,.28),materials['naval'],detailcol);hd.rotation_euler.z=bearing
 for sgn in [-1,1]:
  rod(name+' objective',p(.2,sgn*.1,height+.04),p(.42,sgn*.1,height+.04),.06,materials['edge'],detailcol,vertices=8)
  rod(name+' eyepiece',p(-.26,sgn*.08,height+.06),p(-.38,sgn*.08,height+.1),.03,materials['dark'],detailcol,vertices=6)
 hood=box(name+' weather hood',p(.02,0,height+.2),(.58,.42,.06),materials['edge'],detailcol);hood.rotation_euler.z=bearing
def flak_zag(name,x,y,deck,bearing=0):
 # AA target indicator: a heavier pedestal, a boxed sight with open sighting frame and a crew step.
 c,s_=math.cos(bearing),math.sin(bearing)
 def p(a,b,h):return (x+a*c-b*s_,y+a*s_+b*c,deck+h)
 cyl(name+' foot',(x,y,deck+.04),.36,.08,materials['edge'],detailcol,14)
 rod(name+' column',p(0,0,.08),p(0,0,.95),.15,materials['naval'],detailcol,.12,10)
 hd=box(name+' sight housing',p(0,0,1.12),(.72,.5,.4),materials['naval'],detailcol);hd.rotation_euler.z=bearing
 polyline(name+' sighting frame',[p(.36,-.28,1.3),p(.62,-.28,1.55),p(.62,.28,1.55),p(.36,.28,1.3)],.018,materials['edge'])
 for sgn in [-1,1]:rod(name+' eyepiece',p(-.36,sgn*.12,1.18),p(-.5,sgn*.12,1.22),.035,materials['dark'],detailcol,vertices=6)
 box(name+' crew step',p(-.45,0,.04),(.5,.6,.06),materials['edge'],detailcol).rotation_euler.z=bearing
def zeilsaeule(name,x,y,deck):
 # Night target-designation column: tall pedestal, binocular head with a folding hood.
 cyl(name+' foot',(x,y,deck+.03),.22,.06,materials['edge'],detailcol,12)
 rod(name+' column',(x,y,deck+.05),(x,y,deck+1.25),.11,materials['naval'],detailcol,.09,10)
 box(name+' head',(x,y,deck+1.36),(.44,.34,.26),materials['naval'],detailcol)
 for sgn in [-1,1]:rod(name+' binocular',(x+.12,y+sgn*.09,deck+1.42),(x+.36,y+sgn*.09,deck+1.42),.055,materials['edge'],detailcol,vertices=8)
 box(name+' hood',(x+.05,y,deck+1.56),(.5,.4,.05),materials['edge'],detailcol)
def raft(name,x,y,z,bearing,length=1.8,height=1.75):
 # Carley float stowed on edge against a wall: rolled rim, grating and two paddles.
 c,s_=math.cos(bearing),math.sin(bearing)
 def p(a,h):return (x+a*c,y+a*s_,z+h)
 rim=[p(a,h) for a,h in rounded_rect(0,0,length-.3,height-.3,.35,2)]
 polyline(name+' buoyant rim',rim,.17,materials['canvas'],detailcol,True,6)
 for a in [-.35,.35]:rod(name+' grating slat',p(a,-(height/2-.3)),p(a,height/2-.3),.035,materials['wood'],detailcol,vertices=4)
 for h in [-.3,.3]:rod(name+' grating bar',p(-(length/2-.3),h),p(length/2-.3,h),.03,materials['wood'],detailcol,vertices=4)
 for a in [-.18,.18]:rod(name+' paddle',p(a,-(height/2-.2)),p(a*1.4,height/2-.1),.04,materials['wood'],detailcol,vertices=4)
def window(name,c,normal,w,h):
 # A framed pane on a wall: c is the pane centre on the wall face, normal points outboard.
 n=Vector(normal).normalized();side=Vector((-n.y,n.x,0));c=Vector(c)+n*.025
 corners=[c+side*(sx*w/2)+Vector((0,0,sz*h/2)) for sz in (-1,1) for sx in (-1,1)]
 mesh(name+' glass',[tuple(v) for v in corners],[(0,1,3,2)],materials['glass'],detailcol)
 polyline(name+' frame',[corners[j] for j in [0,1,3,2]],.028,materials['edge'],closed=True,vertices=4)
def front_face(pts,y):
 # The foremost wall crossing at plan y, with its outward normal.
 best=None
 for a,b in zip(pts,pts[1:]+pts[:1]):
  if (a[1]-y)*(b[1]-y)<=0 and abs(b[1]-a[1])>1e-9:
   x=a[0]+(y-a[1])/(b[1]-a[1])*(b[0]-a[0])
   if best is None or x>best[0]:
    n=Vector((b[1]-a[1],a[0]-b[0],0)).normalized()
    if n.x<0:n=-n
    best=(x,n)
 return best
def house_windows():
 # Windows as the textured pgsb708 render paints them: tall panes round the signal house, a row of
 # small panes across the wheelhouse front.
 pts=ccw(plan('signal-house'))
 for yy in [0,.85,-.85,1.7,-1.7,2.55,-2.55]:
  x,n=front_face(pts,yy);window('Signal house window',(x,yy,22.285),n,.41,.69)
 for sign in [-1,1]:
  for xx in [15.4,16.1,16.75,17.4]:
   yy,n=house_side(pts,xx,sign);window('Signal house window',(xx,yy,22.285),n,.41,.69)
 pts=ccw(plan('bridge-wheelhouse'))
 for yy in [0,1.66,-1.66,3.22,-3.22,4.72,-4.72]:
  x,n=front_face(pts,yy);window('Wheelhouse window',(x,yy,14.725),n,.5,.25)
def forward_deck():
 # The forward 37 mm platform on the 01 deck: a splinter bulwark from the battery deck's angled face round the
 # deck edge and across the front of each gun, and two low stowage boxes angled forward (pgsb708 plan at 8.9 m).
 ring=plan('superstructure-platform')
 for sign in [-1,1]:
  run=[(37.6,5.8)]
  for xx in [38.6,40.6,42.2]:
   yy,_=house_side(ring,xx,sign);run.append((xx,abs(yy)-.06))
  run+=[(43.4,6.2),(43.4,2.8),(42.1,2.7)]
  pts=[(x,sign*y) for x,y in run]
  if sign>0:pts=pts[::-1]
  band('Forward 37 mm splinter bulwark',pts,8.3,9.25,.05,False,(.08,.06),col=detailcol)
  # Stays only where the guns' footboards never sweep: the after corner and the inboard end of the front plate.
  rod('Forward 37 mm bulwark stay',(38.3,sign*6.78,9.05),(38.95,sign*6.4,8.32),.03,materials['edge'],detailcol,vertices=4)
  rod('Forward 37 mm bulwark stay',(43.33,sign*3.2,9.05),(42.7,sign*3.2,8.32),.03,materials['edge'],detailcol,vertices=4)
  # Handrail along the 01 deck edge from the gun platform forward towards Bruno.
  edge=[(xx,house_side(ring,xx,sign)[0]-sign*.08,8.305) for xx in [43.5,44.5,45.5,46.4]]
  rail('Forward 01 deck edge rail',edge,.9,1.4,False,col=detailcol)
  a,b=Vector((44.9,sign*1.2,0)),Vector((48.0,sign*5.2,0));mid=(a+b)/2;ang=math.atan2(b.y-a.y,b.x-a.x)
  box('Forward deck stowage box',(mid.x,mid.y,8.66),((b-a).length,.45,.4),materials['naval'],detailcol).rotation_euler.z=ang
  for t in [.12,.5,.88]:
   q=a+(b-a)*t
   for off in [-.16,.16]:
    n=Vector((-math.sin(ang),math.cos(ang),0))*off
    rod('Forward deck stowage box leg',(q.x+n.x,q.y+n.y,8.3),(q.x+n.x,q.y+n.y,8.47),.03,materials['edge'],detailcol,vertices=4)
def tower_fittings():
 core_details();house_windows();forward_deck()
 for sign in [-1,1]:
  # Instruments at the reference stations (pgsb708 misc fittings), each on its own deck.
  pelorus('Signal deck pelorus',17.0,sign*3.94,20.66)
  pelorus('Bridge pelorus',21.8,sign*6.45,15.15,1.4)
  pelorus('Forward bridge pelorus',34.5,sign*6.76,13.05,1.35)
  target_giver('Foretop target giver',13.54,sign*3.87,27.3,height=1.2)
  flak_zag('Foretop flak target indicator',10.0,sign*3.91,27.3,bearing=sign*.35)
  for xx,yy in [(33.43,2.35),(30.22,4.15),(27.05,4.8)]:target_giver('Bridge target giver',xx,sign*yy,15.4)
  zeilsaeule('Bridge night director',32.58,sign*3.77,15.4)
  for xx,yy,deck in [(18.28,.88,27.3),(31.97,5.17,15.4),(35.04,5.5,13.05)]:target_giver('Bridge binocular',xx,sign*yy,deck,height=1.1)
  # Carley floats on the tower and bridge walls.
  raft('Tower wall raft',11.85,sign*4.66,14.26,0)
  raft('Gallery raft',11.86,sign*4.2,17.94,0)
  raft('Bridge wall raft',25.07,sign*6.2,14.42,-sign*math.atan2(2.15,9.1))
  # Signal lamps on the after signal-gallery wall and a fog horn under the searchlight gallery lobe.
  cyl('Signal lamp drum',(12.45,sign*4.03,22.25),.19,.36,materials['naval'],detailcol,12)
  rod('Signal lamp lens',(12.62,sign*4.03,22.25),(12.66,sign*4.03,22.25),.16,materials['glass'],detailcol,vertices=12)
  rod('Signal lamp bracket',(12.45,sign*4.03,21.9),(12.45,sign*3.76,21.9),.03,materials['edge'],detailcol,vertices=4)
  rod('Signal lamp post',(12.45,sign*4.03,21.9),(12.45,sign*4.03,22.08),.03,materials['edge'],detailcol,vertices=4)
  rod('Fog horn',(18.1,sign*4.06,23.83),(19.95,sign*4.06,23.83),.07,materials['edge'],detailcol,.28,12)
  rod('Fog horn hanger',(18.4,sign*4.06,23.83),(18.4,sign*4.06,24.37),.03,materials['edge'],detailcol,vertices=4)
  # Handrails round the exposed after part of the bridge deck, junction boxes and indicators inside
  # the foretop bulwark.
  rail('Bridge deck rail',[(17.35,sign*4.1,15.155),(17.35,sign*6.75,15.155),(22.1,sign*6.75,15.155),(26.15,sign*5.8,15.155)],.8,1.5,False,col=supercol)
  # Vertical ladders where pgsb708 has them: up the 01 deckhouse side clear of the forward 20 mm, and up the
  # tower base front from the bridge deck to the gun gallery (the former inclined flights crossed the guns).
  wall,n=house_side(plan('superstructure-platform'),46.6,sign)
  ladder('Platform access ladder',(46.6,wall+sign*.33,5.72),(46.6,wall+sign*.28,8.95),.5)
  for zz in [6.3,7.4,8.2]:rod('Platform access ladder foot',(46.6-.25,wall+sign*.28,zz),(46.6-.25,wall,zz),.03,materials['edge'],detailcol,vertices=4)
  ladder('Tower base front ladder',(21.72,sign*2.9,15.15),(21.72,sign*2.9,18.25),.45)
  for zz in [15.6,16.7,17.6]:rod('Tower base ladder foot',(21.72,sign*2.9,zz),(21.44,sign*2.9,zz),.03,materials['edge'],detailcol,vertices=4)
  # Four deep window bays across the tower base front, above the bridge deck (pgsb708 plan at 16.4 m).
  for y0,y1 in [(2.2,3.05),(.8,1.6)]:
   yc=sign*(y0+y1)/2
   box('Tower base window bay',(21.47,yc,16.2),(.04,y1-y0,1.1),materials['dark'],detailcol)
   polyline('Tower base window bay frame',[(21.5,sign*y0,15.65),(21.5,sign*y1,15.65),(21.5,sign*y1,16.75),(21.5,sign*y0,16.75)],.035,materials['edge'],closed=True,vertices=4)
  box('Foretop junction box',(12.52,sign*4.69,27.81),(.51,.22,.65),materials['naval'],detailcol)
  box('Foretop indicator',(14.43,sign*4.28,28.07),(.28,.28,.34),materials['naval'],detailcol)
  # Ready-use lockers from the approved stations.
  box('Tower ready-use locker',(11.32,sign*6.93,13.05+.6),(.75,1.47,1.2),materials['naval'],detailcol)
 box('Bridge ready-use locker',(25.27,-5.44,15.15+.6),(1.6,1.06,1.2),materials['naval'],detailcol)
 box('Bridge ready-use locker',(24.4,2.98,15.15+.6),(1.65,1.34,1.2),materials['naval'],detailcol)

# ---------------------------------------------------------------- directors
def fore_rangefinder():
 # pgsb708 gf001: a 10.5 m rangefinder with a chamfered hood over a narrower body on a turning drum,
 # arms with octagonal end housings and guard frames, and a tapered aerial mast. The fixed barbette
 # ring stays with the foretop; everything above it turns on fumo-fore.yaw.
 x=13.3;deck=29.8
 cyl('Fore main director barbette ring',(x,0,deck+.17),1.22,.34,materials['edge'],detailcol,28)
 before=set(bpy.context.scene.objects)
 cyl('Fore main director turning drum',(x,0,deck+.6),1.36,.52,materials['naval'],detailcol,28)
 extrude('Fore main director lower body',rounded_rect(x,0,2.73,3.08,.3,3),30.62,.5,materials['naval'],detailcol,.02)
 hood=[(x+1.69,1.55),(x+1.2,2.11),(x-1.4,2.11),(x-1.69,1.8),(x-1.69,-1.8),(x-1.4,-2.11),(x+1.2,-2.11),(x+1.69,-1.55)]
 extrude('Fore main director hood',hood,31.1,1.0,materials['naval'],detailcol,.03)
 crown=[(x+1.5,1.2),(x+1.0,1.55),(x-1.2,1.55),(x-1.45,1.3),(x-1.45,-1.3),(x-1.2,-1.55),(x+1.0,-1.55),(x+1.5,-1.2)]
 vs=[(a,b,32.1) for a,b in hood]+[(a,b,32.55) for a,b in crown];n=len(hood)
 mesh('Fore main director hipped roof',vs,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(range(2*n-1,n-1,-1))],materials['naval'],detailcol)
 polyline('Fore main director roof edge',[(a,b,32.1) for a,b in hood],.03,materials['edge'],detailcol,True,5)
 for sign in [-1,1]:
  rod('Fore main director optical arm',(x,sign*2.1,31.45),(x,sign*5.25,31.45),.21,materials['naval'],detailcol,.17,16)
  rod('Fore main director arm collar',(x,sign*2.6,31.45),(x,sign*2.75,31.45),.25,materials['edge'],detailcol,vertices=16)
  rod('Fore main director end housing',(x,sign*5.2,31.45),(x,sign*5.6,31.45),.3,materials['naval'],detailcol,vertices=8)
  rod('Fore main director objective',(x+.26,sign*5.4,31.45),(x+.33,sign*5.4,31.45),.12,materials['glass'],detailcol,vertices=10)
  # Guard frame along the after side of each arm.
  # Guard frame along the after side of each arm; its inboard post stands against the hood side.
  polyline('Fore main director arm guard',[(x-.45,sign*2.14,31.15),(x-.45,sign*5.65,31.15),(x-.45,sign*5.65,31.95),(x-.45,sign*2.14,31.95)],.022,materials['edge'],closed=True)
  for yy in [3.3,4.45]:rod('Fore main director guard stanchion',(x-.45,sign*yy,31.15),(x-.45,sign*yy,31.95),.02,materials['edge'],detailcol,vertices=4)
  rod('Fore main director guard bracket',(x-.45,sign*5.65,31.45),(x,sign*5.45,31.45),.03,materials['edge'],detailcol,vertices=4)
  for zz in [31.3,31.6,31.9]:rod('Fore main director hood rung',(x-1.72,sign*.25,zz),(x-1.72,sign*.6,zz),.018,materials['light'],detailcol,vertices=4)
 rod('Fore main director aerial mast',(x,0,32.55),(x,0,34.35),.07,materials['edge'],detailcol,.03,8)
 rod('Fore main director aerial spreader',(x,-.3,33.75),(x,.3,33.75),.03,materials['edge'],detailcol,vertices=4)
 for yy in [-.9,.9]:rod('Fore main director aerial stay',(x,0,33.5),(x-.2,yy,32.5),.01,materials['dark'],detailcol,vertices=4)
 radar_pivot('fumo-fore.yaw',(x,0,deck+.34),set(bpy.context.scene.objects)-before)
 landmarks['fore-director']=(x,0,31.5)
def conning_rangefinder():
 # pgsb708 gf003: the 7 m rangefinder on the conning tower, a tall rounded box on its barbette ring.
 x=25.0;deck=18.2
 cyl('Conning director barbette ring',(x,0,deck+.22),1.22,.44,materials['edge'],detailcol,28)
 before=set(bpy.context.scene.objects)
 extrude('Conning director armoured hood',rounded_rect(x,0,3.77,3.08,.45,3),18.66,2.2,materials['naval'],detailcol,.03)
 extrude('Conning director crown edge',rounded_rect(x,0,3.87,3.18,.48,3),20.86,.1,materials['edge'],detailcol)
 crown=rounded_rect(x,0,3.7,3.0,.44,3);n=len(crown)
 mesh('Conning director crown',[(a,b,20.96) for a,b in crown]+[(x,0,21.08)],[(i,(i+1)%n,n) for i in range(n)],materials['naval'],detailcol)
 polyline('Conning director plating joint',[(a,b,19.4) for a,b in rounded_rect(x,0,3.79,3.1,.45,3)],.016,materials['edge'],closed=True)
 for sign in [-1,1]:
  rod('Conning director optical arm',(x,sign*1.54,19.93),(x,sign*3.45,19.93),.2,materials['naval'],detailcol,.16,16)
  rod('Conning director end housing',(x,sign*3.4,19.93),(x,sign*3.73,19.93),.26,materials['naval'],detailcol,vertices=8)
  rod('Conning director objective',(x+.22,sign*3.56,19.93),(x+.28,sign*3.56,19.93),.1,materials['glass'],detailcol,vertices=10)
 cyl('Conning director roof vent',(x,-.5,21.35),.14,.55,materials['naval'],detailcol,10)
 cyl('Conning director vent cap',(x,-.5,21.65),.24,.06,materials['edge'],detailcol,12)
 radar_pivot('fumo-conning.yaw',(x,0,deck+.44),set(bpy.context.scene.objects)-before)
 landmarks['conning-director']=(x,0,19.93)
def directors():
 fore_rangefinder()
 conning_rangefinder()
# Compact open 3 m night rangefinders, independently modeled from the
# approved pgsb708 gf004 fitting; these are distinct from enclosed SL-8 domes.
def night_rangefinder(name,x,y,base,axisz):
 ped=axisz-.95
 cyl(name+' deck sole',(x,y,base+.035),.42,.07,materials['edge'],detailcol,16)
 rod(name+' tapered pedestal',(x,y,base+.07),(x,y,ped),.25,materials['naval'],detailcol,.19,16)
 cyl(name+' pedestal shoulder',(x,y,ped),.34,.13,materials['edge'],detailcol,20)
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
  rod(name+' yoke brace',(x,y,ped-.1),(x+.22,y+sign*.44,axisz-.30),.046,materials['naval'],detailcol,vertices=6)
  box(name+' lower instrument box',(x-.37,y+sign*.34,ped-.3),(.26,.30,.40),materials['naval'],detailcol)
  rod(name+' instrument box bracket',(x,y+sign*.2,ped-.26),(x-.30,y+sign*.34,ped-.26),.038,materials['edge'],detailcol,vertices=6)
  rod(name+' eyepiece',(x-.27,y+sign*.105,axisz+.12),(x-.48,y+sign*.105,axisz+.19),.052,materials['dark'],detailcol,vertices=10)
  hub=Vector((x-.31,y+sign*.60,axisz-.27))
  rod(name+' control shaft',(x-.12,y+sign*.42,axisz-.27),hub,.033,materials['edge'],detailcol,vertices=8)
  ring(name+' adjusting wheel',hub,(0,1,0),.14,.019,materials['edge'],12)
  for a in range(3):rod(name+' wheel spoke',hub,hub+Vector((math.cos(a*math.tau/3)*.14,0,math.sin(a*math.tau/3)*.14)),.014,materials['edge'],detailcol,vertices=5)
  ring(name+' lifting eye',(x,y+sign*.98,axisz+.255),(1,0,0),.038,.011,materials['edge'],8)
 box(name+' rear readout housing',(x-.37,y,axisz-.12),(.18,.55,.28),materials['naval'],detailcol)
 box(name+' upper adjustment block',(x,y,axisz+.31),(.24,.33,.10),materials['naval'],detailcol)
def night_rangefinders():
 # Raised on their tubs so the optical tube clears the tub bulwark, as on the approved model.
 for sign in [-1,1]:night_rangefinder('Signal gallery night rangefinder',15.1,sign*5.51,20.68,22.07)
def sl8_director(name,x,y):
 # pgsb708 gf005: the SL-8 AA director is a squat cylinder with a hemispherical dome, sight hoods fore
 # and aft and a shutter slot, carried on a tall 3.4 m cylindrical pedestal tower that rises from the
 # battery deck roof through the shelter deck's side.
 sign=1 if y>0 else -1
 cyl(name+' pedestal tower',(x,y,(10.4+15.3)/2),1.69,15.3-10.4,materials['naval'],supercol,28)
 ring(name+' pedestal plating seam',(x,y,13.9),(0,0,1),1.7,.02,materials['edge'],20)
 rod(name+' pedestal flare',(x,y,15.3),(x,y,15.95),1.69,materials['naval'],supercol,1.93,28)
 battery=plan('forward-battery-deck')
 for dx in [-1.0,.2]:
  # Knees carry the pedestal's outboard overhang onto the battery deck side.
  wall,_=house_side(battery,x+dx,sign)
  rod(name+' overhang knee',(x+dx,y+sign*1.35,10.38),(x+dx,wall+sign*.03,9.2),.075,materials['naval'],detailcol,vertices=4)
 rim=1.95
 cyl(name+' director drum',(x,y,(15.95+17.15)/2),rim,1.2,materials['naval'],detailcol,28)
 lat=[(17.15,rim),(17.55,1.88),(17.9,1.7),(18.2,1.38),(18.42,.98),(18.56,.52),(18.62,0)]
 vs=[(x+r*math.cos(math.tau*i/28),y+r*math.sin(math.tau*i/28),zz) for zz,r in lat for i in range(28)]
 fs=[(j*28+i,j*28+(i+1)%28,(j+1)*28+(i+1)%28,(j+1)*28+i) for j in range(len(lat)-1) for i in range(28)]
 mesh(name+' dome',vs,fs,materials['naval'],detailcol,True)
 cyl(name+' dome cap',(x,y,18.66),.34,.12,materials['edge'],detailcol,8)
 ring(name+' drum seam',(x,y,17.15),(0,0,1),rim+.01,.022,materials['edge'],20)
 # Sight hoods fore and aft and the forward shutter slot.
 box(name+' forward sight hood',(x+1.9,y,17.85),(.7,.55,.42),materials['naval'],detailcol)
 box(name+' after sight hood',(x-1.9,y,17.85),(.7,.55,.42),materials['naval'],detailcol)
 mesh(name+' shutter slot',[(x+(rim+.012)*math.cos(math.radians(v)),y+(rim+.012)*math.sin(math.radians(v)),zz) for zz in [16.55,16.8] for v in range(-36,37,12)],
  [(i,i+1,i+8,i+7) for i in range(6)],materials['dark'],detailcol)
 ring(name+' rangefinder port rim',(x,y+sign*(rim+.02),16.9),(0,sign,0),.22,.03,materials['edge'],10)
 rod(name+' optical port',(x,y+sign*(rim-.05),16.9),(x,y+sign*(rim+.06),16.9),.2,materials['dark'],detailcol,vertices=12)
 rod(name+' optical port (inboard)',(x,y-sign*(rim-.05),16.9),(x,y-sign*(rim+.06),16.9),.2,materials['dark'],detailcol,vertices=12)
 ladder(name+' pedestal ladder',(x-1.72,y,13.1),(x-1.72,y,15.9),.42)
def aa_directors():
 for sign in [-1,1]:sl8_director('Forward SL-8 AA director',15.08,sign*6.77)
def foretop_searchlight():
 cyl('Foretop searchlight column',(20.0,0,(24.62+25.34)/2),.42,25.34-24.62,materials['naval'],detailcol,16)
 cyl('Foretop searchlight column foot',(20.0,0,24.66),.6,.08,materials['edge'],detailcol,16)
 searchlight('Foretop 1.5 m searchlight',20.0,0,25.32,0,.9)
def foremast():
 # pgsb708 foremast: a single vertical pole behind the foretop, stepped on the signal deck's after
 # walkway, with one signal yard (flag halyards at +-2.3 m), a short topmast yard, and two pairs of long
 # W/T aerial spreaders at the gallery levels. The former long yards and deck-to-truck stays are gone.
 x=6.95;base=20.66;top=38.9
 cyl('Foremast step',(x,0,base+.1),.34,.2,materials['edge'],detailcol,12)
 rod('Foremast pole',(x,0,base+.1),(x,0,top),.19,materials['edge'],detailcol,.12,12)
 rod('Foremast topmast',(x,0,top),(x,0,41.2),.07,materials['edge'],detailcol,.025,8)
 rod('Foremast signal yard',(x,-2.33,36.1),(x,2.33,36.1),.065,materials['edge'],detailcol,.04,8)
 polyline('Foremast flag frame',[(x+.05,-2.05,36.05),(x+.05,-2.05,35.45),(x+.05,2.05,35.45),(x+.05,2.05,36.05)],.02,materials['edge'])
 for yy in [-1.0,0,1.0]:rod('Foremast flag frame bar',(x+.05,yy,35.45),(x+.05,yy,36.05),.015,materials['edge'],detailcol,vertices=4)
 rod('Foremast upper yard',(x,-1.4,38.5),(x,1.4,38.5),.045,materials['edge'],detailcol,.03,6)
 rod('Foremast truck',(x,0,41.2),(x,0,41.3),.06,materials['edge'],detailcol,vertices=8)
 # Short aerial gaff aft at 40 m: the fore end of the W/T aerial span to the mainmast (aft region) bears on it.
 rod('Foremast aerial gaff',(x,0,40.0),(5.75,0,40.0),.045,materials['edge'],detailcol,.03,6)
 rod('Foremast aerial gaff brace',(x,0,39.2),(5.95,0,40.0),.02,materials['edge'],detailcol,vertices=4)
 for sign in [-1,1]:
  # W/T aerial spreaders at the foretop level end in rectangular frames 8.4-10.5 m out (pgsb708).
  zz=27.2;y0,y1=sign*8.35,sign*10.5
  rod('Foremast aerial spreader',(x,sign*.17,zz),(5.45,y0,zz),.06,materials['edge'],detailcol,.035,6)
  rod('Foremast spreader brace',(x,sign*.17,zz-1.6),(6.1,sign*4.6,zz),.028,materials['edge'],detailcol,vertices=4)
  polyline('Foremast aerial frame',[(4.45,y0,zz),(6.47,y0,zz),(6.47,y1,zz),(4.45,y1,zz)],.02,materials['edge'],closed=True,vertices=4)
  for t in [1/3,2/3]:
   rod('Foremast aerial mat wire',(4.45,y0+(y1-y0)*t,zz),(6.47,y0+(y1-y0)*t,zz),.01,materials['dark'],detailcol,vertices=4)
   rod('Foremast aerial mat wire',(4.45+2.02*t,y0,zz),(4.45+2.02*t,y1,zz),.01,materials['dark'],detailcol,vertices=4)
  for xx in [4.45,6.47]:
   rod('Foremast aerial frame hanger',(xx,y1,zz),(xx,y1,zz-.7),.016,materials['edge'],detailcol,vertices=4)
  rod('Foremast aerial frame foot',(4.45,y1,zz-.7),(6.47,y1,zz-.7),.016,materials['edge'],detailcol,vertices=4)
  # Stays from the signal yard ends out to the frames, topping lifts to the pole and a shroud to the foretop.
  rod('Foremast yard stay',(x,sign*2.3,36.1),(5.45,y1,zz),.011,materials['dark'],detailcol,vertices=4)
  rod('Foremast topping lift',(x,sign*2.3,36.1),(x,0,38.0),.011,materials['dark'],detailcol,vertices=4)
  rod('Foremast shroud',(x,sign*.12,33.0),(8.95,sign*4.55,28.35),.014,materials['dark'],detailcol,vertices=4)
  # W/T aerial wires run forward from the frames to the searchlight gallery outriggers.
  rod('Foremast aerial wire',(6.47,sign*9.4,zz-.05),(17.1,sign*9.2,24.36),.01,materials['dark'],detailcol,vertices=4)
 # Ladder on the pole's after face, stood off by lugs.
 for i in range(int((35.4-(base+.6))/.36)):
  zz=base+.6+i*.36;rod('Foremast ladder rung',(x-.21,-.2,zz),(x-.21,.2,zz),.018,materials['light'],detailcol,vertices=4)
 for sign in [-1,1]:
  rod('Foremast ladder rail',(x-.21,sign*.2,base),(x-.21,sign*.2,35.5),.024,materials['light'],detailcol,vertices=4)
  for zz in [23.0,27.0,31.0,35.0]:rod('Foremast ladder lug',(x,0,zz),(x-.21,sign*.2,zz),.02,materials['edge'],detailcol,vertices=4)
def quad_20mm():
 # The two upper quad 2 cm fittings are decorative (no blueprint mount); the armament pass's
 # aa_mount builds them after the firing mounts, on the same support snapshot.
 import bismarck_armament as armament
 for sign in [-1,1]:
  armament.aa_mount('Quad 2 cm April 1941 fit',17.395,sign*4.092,24.65,.020,bearing=sign*.82,quad=True)
def build():
 # Region entry point, after the hull, blueprint structures and main/secondary batteries exist.
 with legacy_frame():bridge_details()
 tower_fittings();directors();night_rangefinders();aa_directors();foretop_searchlight();foremast()
def after_mounts():
 # Runs after the armament pass has built every AA mount.
 quad_20mm()

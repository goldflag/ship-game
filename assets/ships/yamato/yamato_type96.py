"""Type 96 25 mm mounts of the 1945 fit, one builder per GameModels3D pjsb018 visual.

closed_triple      jga179 closed triple: round splinter housing with a rolled roof edge
closed_triple_1945 jga180 1945 closed triple: square-edged housing, sloping roof and wings
open_triple        jga181 open triple: pedestal carriage, cradle, three guns and the crew's seats
single             jga018 single: cone pedestal, yoke, gun, magazine and shoulder rests

Visual fittings only: they neither train nor fire, so each gun lies at the reference pose
(30 degrees elevation, muzzles at the reference firing points). A builder takes the mount's
assembly id, its seat point (x, y, z in the ship frame) and its bearing (degrees, +X toward
+Y positive), and draws in the mount frame: +X muzzle, +Y left of the muzzle, +Z up, origin
on the seat plane. Each mount is one mesh per material; faces are wound outward by
construction, so rails and small parts need no caps where they enter a surface.
"""
from yamato_kit import *

ELEV=math.radians(30)
CE,SE=math.cos(ELEV),math.sin(ELEV)


class Mount:
 def __init__(s,id,x,y,z,deg):
  c,n=math.cos(math.radians(deg)),math.sin(math.radians(deg))
  s.id=id;s.P=lambda a,b,h:(x+a*c-b*n,y+a*n+b*c,z+h);s.parts={}
 def add(s,m,v,f,smooth=False):
  _,vs,fs,sm=s.parts.setdefault(m.name,(m,[],[],[]))
  o=len(vs);vs.extend(tuple(p) for p in v);fs.extend(tuple(i+o for i in q) for q in f);sm.extend([smooth]*len(f))
 def face(s,m,pts,hint):
  # One polygon, turned so that its normal agrees with hint.
  pts=[Vector(p) for p in pts];nv=Vector((0,0,0))
  for a,b in zip(pts,pts[1:]+pts[:1]):nv+=a.cross(b)
  s.add(m,pts if nv.dot(Vector(hint))>=0 else pts[::-1],[tuple(range(len(pts)))])
 def emit(s,label):
  for m,v,f,sm in s.parts.values():
   o=mesh(f'{s.id} {label}',[s.P(*p) for p in v],f,m,AA)
   for p,flag in zip(o.data.polygons,sm):p.use_smooth=flag


def basis(d):
 d=Vector(d).normalized();e=Vector((0,0,1)) if abs(d.z)<.9 else Vector((1,0,0))
 a=e.cross(d).normalized();return a,d.cross(a)

def hexa(s,m,p):
 # Eight corners ordered like the kit box (bottom ring, then top ring).
 s.add(m,p,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])

def block(s,m,c,size,pitch=0.,yaw=0.,roll=0.):
 # Box about centre c; its length runs along the pitched and yawed x axis.
 cp,sp,cy,sy,cr,sr=math.cos(pitch),math.sin(pitch),math.cos(yaw),math.sin(yaw),math.cos(roll),math.sin(roll)
 ex=Vector((cp*cy,cp*sy,sp));ey0=Vector((-sy,cy,0));ez0=ex.cross(ey0)
 ey=ey0*cr+ez0*sr;ez=ex.cross(ey);c=Vector(c);a,b,h=[d/2 for d in size]
 hexa(s,m,[c+ex*i*a+ey*j*b+ez*k*h for k in (-1,1) for i,j in ((-1,-1),(1,-1),(1,1),(-1,1))])

def tube(s,m,path,sides=6,caps=(False,True),smooth=True,phase=.5):
 # Swept circle through [(point, radius)]; one ring per sample, frames carried along the
 # path so cranked bars keep their section. Coincident samples make a flat step.
 pts=[Vector(p) for p,_ in path];n=len(pts)
 seg=[pts[i+1]-pts[i] for i in range(n-1)]
 seg=[d.normalized() if d.length>1e-9 else None for d in seg]
 for i in range(len(seg)):
  if seg[i] is None:seg[i]=next((d for d in seg[i+1:] if d is not None),None) or next(d for d in seg[:i][::-1] if d is not None)
 tang=[(seg[max(i-1,0)]+seg[min(i,n-2)]).normalized() for i in range(n)]
 a,b=basis(tang[0]);v=[];f=[]
 for i,(p,r) in enumerate(path):
  if i:a=(a-tang[i]*a.dot(tang[i])).normalized();b=tang[i].cross(a)
  v+=[pts[i]+(a*math.cos((k+phase)*math.tau/sides)+b*math.sin((k+phase)*math.tau/sides))*r for k in range(sides)]
 for i in range(n-1):
  f+=[(i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k) for k in range(sides)]
 if caps[0]:f.append(tuple(reversed(range(sides))))
 if caps[1]:f.append(tuple(range(len(v)-sides,len(v))))
 s.add(m,v,f,smooth)

def bar(s,m,pts,r,sides=4,caps=(False,False)):
 # A cranked rail or strut of constant section, swept through its corner points.
 tube(s,m,[(p,r) for p in pts],sides,caps,False)

def _outline(outline,flip,skip):
 # Orient an outline and carry the hidden-edge indices (edge i runs from point i to i+1).
 n=len(outline);area=sum(outline[i][0]*outline[(i+1)%n][1]-outline[(i+1)%n][0]*outline[i][1] for i in range(n))
 if (area<0)==flip:return outline,set(skip)
 return outline[::-1],{(n-2-i)%n for i in skip}

def slab(s,m,outline,y0,y1,skip=()):
 # Plate: an x-z outline extruded across y0..y1; skip lists hidden side edges.
 y0,y1=min(y0,y1),max(y0,y1);n=len(outline);pts,skip=_outline(outline,True,skip)
 v=[(x,y0,z) for x,z in pts]+[(x,y1,z) for x,z in pts]
 f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n) if i not in skip]
 s.add(m,v,f)

def prism(s,m,outline,z0,z1,bottom=False,skip=()):
 # Plan outline (x, y) extruded from z0 to z1; skip lists hidden side edges.
 n=len(outline);pts,skip=_outline(outline,False,skip)
 v=[(x,y,z0) for x,y in pts]+[(x,y,z1) for x,y in pts]
 f=[tuple(range(n,2*n))]+([tuple(reversed(range(n)))] if bottom else [])+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n) if i not in skip]
 s.add(m,v,f)

def ring(s,m,c,normal,R,r,n=8,k=3):
 # Hand wheel or ring sight: a torus of k-sided section.
 a,b=basis(normal);c=Vector(c);nn=a.cross(b);v=[]
 for i in range(n):
  t=i*math.tau/n;d=a*math.cos(t)+b*math.sin(t)
  v+=[c+d*(R+r*math.cos(j*math.tau/k))+nn*r*math.sin(j*math.tau/k) for j in range(k)]
 s.add(m,v,[(i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k) for i in range(n) for j in range(k)])

def band(s,m,stations,caps=(True,True),open_bottom=True):
 # Loft of x-z profiles at rising y stations; each profile runs from its rear foot, up and
 # over the top, to its front foot. The closing foot edge is left open (it sits on the seat).
 n=len(stations[0][1]);v=[];f=[]
 for y,prof in stations:v+=[(x,y,z) for x,z in prof]
 for i in range(len(stations)-1):
  f+=[(i*n+k,i*n+k+1,(i+1)*n+k+1,(i+1)*n+k) for k in range(n-1)]
  if not open_bottom:f.append((i*n+n-1,i*n,(i+1)*n,(i+1)*n+n-1))
 if caps[0]:f.append(tuple(reversed(range(n))))
 if caps[1]:f.append(tuple(range(len(v)-n,len(v))))
 s.add(m,v,f)

def interp1(table,x):
 if x<=table[0][0]:return table[0][1]
 for (a,va),(b,vb) in zip(table,table[1:]):
  if x<=b:return va+(vb-va)*(x-a)/(b-a)
 return table[-1][1]

def axis_point(muzzle,u,v=0.,b=0.):
 # Point u metres behind the muzzle along a 30 degree bore, v above it and b to port.
 x,z=muzzle;return (x-u*CE-v*SE,b,z-u*SE+v*CE)


# ---- Closed triples ---------------------------------------------------------------
# Plan: a 3.6 m drum. The gun well (|y|<0.40) is open from x=-0.42 forward over a 0.21 m
# floor; a curved shutter closes it behind the guns and two thin dividers separate the
# three slots. Ribs (0.40-0.57) and wings (1.13 out) curve down from the roof to the
# 0.37 m front step; between them the crew channels are sunk 0.17 m below the roof.
R=1.8
def _xr(y):return -math.sqrt(max(0.,R*R-y*y))
def _xf(y):return math.sqrt(max(0.,R*R-y*y))

def _housing(s,late):
 if late:
  roofz=lambda x,y:1.52-.08*abs(y)-.11*max(0.,-.42-x)
  rim=lambda x,y:9.
  rib=[(.1,1.52),(.45,1.35),(.72,1.07),(.78,.87),(.88,.37)]
  chan=[(-.42,1.3),(-.15,1.3),(.1,1.25),(.4,1.1),(.55,.78),(.64,.37)]
  wing=lambda x,y:interp1([(.1,1.4),(.35,1.3),(.5,1.15),(.62,.8),(.75,.37)],x)-(.25*(abs(y)-1.13) if x>.1 else 0)
  wingx=[.1,.35,.5,.62];wend=.75
 else:
  roofz=lambda x,y:1.52-.045*y*y-.075*max(0.,-.42-x)
  rim=lambda x,y:interp1([(0,1.15),(.07,1.32),(.19,1.41),(.4,1.6)],R-math.hypot(x,y))
  rib=[(.1,1.52),(.45,1.42),(.7,1.15),(.82,.85),(.93,.47),(1.05,.37)]
  chan=[(-.42,1.3),(0,1.3),(.2,1.22),(.35,1.1),(.57,.8),(.7,.37)]
  wing=lambda x,y:interp1([(.1,1.42),(.4,1.28),(.55,1.1),(.75,.55),(.88,.4),(.95,.37)],x)
  wingx=[.1,.4,.55,.75,.88];wend=.95
 top=lambda x,y:min(roofz(x,y),rim(x,y))
 def rear(y):
  # Rear wall and rolled (early) or square (1945) roof edge.
  x0=_xr(y)
  if late:return [(x0,0),(x0,top(x0+.001,y))]
  return [(x0,0),(x0,1.15),(x0+.07,top(x0+.07,y)),(x0+.19,top(x0+.19,y))]
 rx=lambda y:rear(y)+[(-.42,top(-.42,y))]
 for sg in (1,-1):
  ys=lambda a,b:(a*sg,b*sg) if sg>0 else (b*sg,a*sg)
  # Rib: the tall curved cheek either side of the gun well.
  def ribp(y):return rx(y)+[(x,min(top(x,y),z)) for x,z in rib[:-1]]+[(rib[-1][0],.37),(rib[-1][0],.21)]
  y0,y1=ys(.40,.57);band(s,naval,[(y0,ribp(y0)),(y1,ribp(y1))])
  # Crew channel: roof step, then a flat run curving down to the front step.
  def chp(y):return rx(y)+[(x,z) for x,z in chan]
  y0,y1=ys(.57,1.13);band(s,naval,[(y0,chp(y0)),(y1,chp(y1))],caps=(False,False))
  # Wing: the drum's shoulder falling forward to the step, clipped by the drum.
  def wp(y):
   xf=_xf(y)-.02;pts=rear(y)
   for i,x in enumerate(wingx):
    xx=min(x,xf-.012*(len(wingx)-i));pts.append((xx,min(top(xx,y),wing(xx,y))))
   xe=min(wend,xf);return pts+[(xe,.37),(xe,0)]
  st=[1.13,1.5,1.74]
  band(s,naval,[(y*sg,wp(y*sg)) for y in (st if sg>0 else st[::-1])],caps=(True,True))
  # Thin slot divider between two guns.
  def dvp(y):return [(-.42,.21),(-.42,top(-.42,y))]+[(x,min(top(x,y),z)) for x,z in rib if x<.88]+[(.88,interp1(rib,.88)),(.88,.21)]
  y0,y1=ys(.10,.17);band(s,naval,[(y0,dvp(y0)),(y1,dvp(y1))])
 # Rear body behind the well, across the centre line.
 band(s,naval,[(y,rx(y)+[(-.42,.21)]) for y in (-.4,0,.4)],caps=(False,False))
 # Front step and the gun well floor that notches it.
 for sg in (1,-1):
  arc=[(R*math.cos(t),sg*R*math.sin(t)) for t in [math.asin(.4/R)+(math.acos(.55/R)-math.asin(.4/R))*i/3 for i in range(4)]]
  prism(s,naval,[(.55,.4*sg)]+arc+[(.55,arc[-1][1])],0,.37,skip=(5,))
 prism(s,roof,[(-.42,-.4),(_xf(.4),-.4),(R,0),(_xf(.4),.4),(-.42,.4)],0,.21,skip=(4,))
 # Shutter: the curved plate that closes the well behind the guns.
 sh=[(.72,.21),(.69,.62),(.56,.98),(.33,1.24),(0,1.34),(-.42,1.34)]
 for (a,za),(b,zb) in zip(sh,sh[1:]):
  s.face(dark,[(a,-.4,za),(b,-.4,zb),(b,.4,zb),(a,.4,za)],(a+b,0,za+zb-1.1))


def _closed_guns(s,late):
 # Three barrels at the reference firing points; 1945 mounts carry longer flash hiders.
 for b in (-.279,0,.277):
  m=(1.428,1.414);hider=.34 if late else .24
  tube(s,edge,[(axis_point(m,1.0,0,b),.026),(axis_point(m,hider,0,b),.03),(axis_point(m,0,0,b),.05 if late else .045)],4,(False,True),False)

def _roof_details(s,late):
 # Two roof hatches, and a hand rail on four stanchions round the after roof edge.
 for sg in (1,-1):
  c=(-.9,.85*sg);prism(s,edge,[(c[0]+.19*math.cos(k*math.tau/5),c[1]+.19*math.sin(k*math.tau/5)) for k in range(5)],1.3,1.51 if not late else 1.49)
 zr=1.52 if not late else 1.47;rr=1.62 if not late else 1.7
 at=lambda t,z:(rr*math.cos(math.radians(t)),rr*math.sin(math.radians(t)),z)
 bar(s,edge,[at(t,zr) for t in (88,133,180,227,272)],.02,3)
 for t in (88,150,210,272):bar(s,edge,[at(t,1.3),at(t,zr)],.016,3)


def closed_triple(id,x,y,z,deg):
 s=Mount(id,x,y,z,deg);_housing(s,False);_closed_guns(s,False);_roof_details(s,False);s.emit('Type 96 closed triple')

def closed_triple_1945(id,x,y,z,deg):
 s=Mount(id,x,y,z,deg);_housing(s,True);_closed_guns(s,True);_roof_details(s,True);s.emit('Type 96 1945 closed triple')


# ---- Open triple -------------------------------------------------------------------
OPEN_MUZZLE=(1.435,1.82)

def open_triple(id,x,y,z,deg):
 s=Mount(id,x,y,z,deg);M=OPEN_MUZZLE
 # Training base: round foot ring, carriage deck and sloped front apron.
 prism(s,naval,[(.6*math.cos(k*math.tau/8+math.pi/8),.6*math.sin(k*math.tau/8+math.pi/8)) for k in range(8)],0,.05)
 prism(s,naval,[(-.5,-.48),(.44,-.48),(.44,.48),(-.5,.48)],.05,.14)
 hexa(s,naval,[(-.02,-.4,.14),(.44,-.4,.14),(.44,.4,.14),(-.02,.4,.14),(-.02,-.4,.36),(.44,-.4,.29),(.44,.4,.29),(-.02,.4,.36)])
 block(s,edge,(.53,0,.13),(.2,.16,.2))
 # Carriage side frames and inner cheek plates carry the trunnions; gear boxes ahead.
 frame=[(-.33,.14),(.61,.14),(.61,.36),(.46,.46),(.02,.9),(-.1,1.02),(-.24,.95),(-.33,.76)]
 for sg in (1,-1):
  slab(s,naval,frame,.47*sg,.53*sg)
  slab(s,naval,[(-.39,.39),(.39,.39),(.39,.6),(.05,.94),(-.39,.94)],.37*sg,.41*sg)
  tube(s,edge,[((-.06,.37*sg,.97),.07),((-.06,.58*sg,.97),.07)],6,(False,True),False)
  block(s,naval,(.5,.52*sg,.26),(.22,.17,.44))
 # Cradle and three receivers with their box magazines, bores at the reference spacing.
 block(s,naval,axis_point(M,1.98,-.12),(.86,.84,.05),ELEV)
 for sg in (1,-1):slab(s,naval,[axis_point(M,u,v)[::2] for u,v in ((2.4,-.13),(1.55,-.13),(1.55,.12),(2.4,.12))],.4*sg,.43*sg)
 for b in (-.286,0,.275):
  block(s,edge,axis_point(M,2.0,-.03,b),(.8,.2,.15),ELEV)
  block(s,edge,(-.36,b,.87),(.34,.1,.2),math.radians(17))
  block(s,naval,(-.38,b,1.08),(.28,.075,.4),math.radians(17))
  # Barrel: jacket, barrel and the flared flash hider.
  tube(s,edge,[(axis_point(M,1.67,0,b),.05),(axis_point(M,.86,0,b),.05),(axis_point(M,.86,0,b),.026),(axis_point(M,.27,0,b),.024),(axis_point(M,0,0,b),.045)],6,(True,True),False)
 # Spent-case chutes under the guns and the port elevating strut down to the gear box.
 bar(s,edge,[(.29,-.47,.5),(.29,.47,.5)],.035,4)
 for b in (-.286,0,.275):hexa(s,edge,[(.18,b-.07,.6),(.46,b-.07,.37),(.46,b+.07,.37),(.18,b+.07,.6),(.2,b-.07,.63),(.48,b-.07,.4),(.48,b+.07,.4),(.2,b+.07,.63)])
 bar(s,edge,[(.22,.44,1.1),(.5,.5,.44)],.02,4)
 # Rear shoulder pieces for the loaders and the cross bar behind the cradle.
 for b in (-.27,.27):bar(s,edge,[(-.6,b,.62),(-.8,b,.58),(-.84,b,.7),(-.78,b,.88)],.025,4,(False,True))
 bar(s,edge,[(-.82,-.28,.58),(-.82,.28,.58)],.02,4)
 # Sight bar across the cradle: the layer's sight head to port, the trainer's eyepiece to starboard.
 bar(s,edge,[(0,-.8,1.1),(0,.8,1.1)],.02,4,(True,True))
 tube(s,edge,[((.11,.59,1.2),.12),((.11,.59,1.27),.1)],8,(True,True),False)
 bar(s,edge,[(.02,.59,1.09),(.1,.59,1.21)],.025,4)
 block(s,edge,(0,-.78,1.12),(.08,.15,.1))
 for sg in (1,-1):
  # Seats with backrests on posts and arms to the frames; foot rests ahead on brackets.
  y0=.85*sg
  block(s,naval,(-.23,y0,.28),(.3,.3,.04))
  block(s,naval,(-.37,y0,.44),(.05,.3,.3),math.radians(10))
  bar(s,edge,[(-.2,y0,.27),(-.2,y0,0)],.025,4)
  bar(s,edge,[(-.2,y0,.18),(-.2,.5*sg,.18)],.02,4)
  bar(s,edge,[(.45,.5*sg,.17),(.55,y0,.17),(.7,y0,.19)],.022,4)
  block(s,edge,(.72,y0,.24),(.05,.28,.14),math.radians(-20))
 # Trainer's hand wheel on its shaft to the starboard gear box.
 c=Vector((.15,-.85,.62));nrm=Vector((-.66,0,.75));ring(s,edge,c,nrm,.16,.02,8,3)
 a,b2=basis(nrm)
 for d in (a,b2):bar(s,edge,[c-d*.16,c+d*.16],.012,4)
 bar(s,edge,[c,(.4,-.85,.34),(.47,-.56,.34)],.022,4)
 s.emit('Type 96 open triple')


# ---- Single ------------------------------------------------------------------------
SINGLE_MUZZLE=(1.196,2.019)

def single(id,x,y,z,deg):
 s=Mount(id,x,y,z,deg);M=SINGLE_MUZZLE
 # Pedestal: octagonal foot plate, four thin gussets, tapered column and pivot collar.
 prism(s,naval,[(.3*math.cos(k*math.tau/8+math.pi/8),.3*math.sin(k*math.tau/8+math.pi/8)) for k in range(8)],0,.04)
 for k in range(4):
  c,sn=math.cos(k*math.pi/2),math.sin(k*math.pi/2);t=Vector((-sn,c,0))
  p=[Vector((c*.1,sn*.1,.04)),Vector((c*.29,sn*.29,.04)),Vector((c*.1,sn*.1,.22))]
  s.face(naval,[q+t*.012 for q in p],t);s.face(naval,[q-t*.012 for q in p],-t)
 tube(s,naval,[((0,0,.04),.15),((0,0,.72),.085)],8,(False,False))
 tube(s,naval,[((0,0,.72),.095),((0,0,.83),.095)],8,(False,True),False)
 # Yoke: two arms leaning back from the pivot to the trunnions.
 arm=[(-.09,.8),(.1,.84),(-.18,1.12),(-.27,1.21),(-.38,1.14),(-.1,.83)]
 for sg in (1,-1):
  slab(s,naval,arm,.165*sg,.215*sg)
  tube(s,edge,[((-.27,.2*sg,1.09),.07),((-.27,.25*sg,1.09),.07)],6,(False,True),False)
 block(s,naval,(0,0,.85),(.22,.43,.07))
 # Gun: receiver and trunnion block, barrel jacket, barrel and flash hider; box magazine on top.
 block(s,edge,axis_point(M,1.9,-.07),(.9,.2,.2),ELEV)
 block(s,edge,axis_point(M,1.62,-.05),(.28,.36,.16),ELEV)
 tube(s,edge,[(axis_point(M,1.55),.05),(axis_point(M,.88),.05),(axis_point(M,.88),.024),(axis_point(M,.36),.022),(axis_point(M,0),.042)],6,(True,True),False)
 block(s,naval,(-.6,0,1.28),(.28,.1,.4),math.radians(15))
 # Rear frame, and the shoulder rests with hand grips on a bar to the gunner's side.
 bar(s,edge,[(-.77,-.09,.75),(-1.05,-.12,.75),(-1.05,.12,.75),(-.77,.09,.75)],.02,3)
 bar(s,edge,[(-.7,0,.84),(-.7,.51,.84)],.022,4,(False,True))
 for b in (.23,.48):
  bar(s,edge,[(-.7,b,.84),(-.8,b,.95),(-.95,b,.95),(-1.02,b,.9)],.03,3,(True,True))
  bar(s,edge,[(-.7,b,.84),(-.76,b,.48)],.02,4,(False,True))
 # Ring sight on an arm to port of the receiver.
 bar(s,edge,[(-.52,.05,1.0),(-.52,.35,1.2),(-.415,.35,1.3)],.018,4)
 ring(s,edge,(-.47,.35,1.39),(CE,0,SE),.11,.012,8,3)
 s.emit('Type 96 single')

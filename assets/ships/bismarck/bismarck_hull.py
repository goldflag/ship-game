"""Hull loft, deck fittings, mooring and anchor gear, scuttles, rails, staffs and underwater appendages.

Positions of the forecastle and quarterdeck gear, the outer shaft bossings, A-brackets, screws and twin rudders
follow the approved GameModels3D pgsb708 A_Hull at a common scale (reference z + 1.985 = runtime z, y + 0.85);
the shapes are original constructions.
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
 # Half-breadth of the weather deck edge (the widest point of a flared section is the deck edge;
 # amidships the slight tumblehome keeps the deck edge inside the waterline beam).
 return side_width(x,deckz(x)-.02)
def hull_bottom(x,y):
 # Lowest hull height at half-breadth y (the loft surface under a point off the centreline).
 p=section_at(x)
 for (wa,za),(wb,zb) in zip(p,p[1:]):
  if min(wa,wb)<=abs(y)<=max(wa,wb) and abs(wb-wa)>1e-6:return za+(zb-za)*(abs(y)-wa)/(wb-wa)
 return p[0][1]
def staffs():
 # Stern ensign staff and the jackstaff on the stem head.
 for x,top in [(-123,15.5),(123.9,11.5)]:rod('Ensign or jack staff',(x,0,deckz(x)),(x-.3,0,top),.08,materials['edge'],detailcol,.025,10)
def chain(name,pts,pitch=.5,length=.56,wide=.34,tube=.055):
 # Stud-link cable as one mesh: flat oval links alternating edge-up and flat along a polyline.
 vs=[];fs=[];k=0
 path=[Vector(p) for p in pts]
 for a,b in zip(path,path[1:]):
  d=b-a;count=max(1,round(d.length/pitch));axis=d.normalized();side=axis.cross(Vector((0,0,1)))
  if side.length<.1:side=Vector((0,1,0))
  side.normalize();up=side.cross(axis).normalized()
  for i in range(count):
   c=a+d*((i+.5)/count);u=up if k%2 else side;k+=1
   ring=[c+axis*(length/2-wide/2+wide/2*math.cos(t))*(1 if math.cos(t)>=0 else 1)+u*(wide/2*math.sin(t)) if abs(math.cos(t))<1e-9 else c+axis*((length/2-wide/2)*(1 if math.cos(t)>0 else -1)+wide/2*math.cos(t))+u*(wide/2*math.sin(t)) for t in [j*math.tau/8 for j in range(8)]]
   base=len(vs)
   for j,p in enumerate(ring):
    tangent=(ring[(j+1)%8]-ring[j-1]).normalized();nrm=tangent.cross(axis.cross(u) if True else u).normalized()
    out=(p-c).normalized();v2=tangent.cross(out).normalized()
    for q in range(4):
     ang=q*math.tau/4;vs.append(tuple(p+tube*(out*math.cos(ang)+v2*math.sin(ang))))
   for j in range(8):
    for q in range(4):
     a0=base+j*4+q;a1=base+j*4+(q+1)%4;b0=base+((j+1)%8)*4+q;b1=base+((j+1)%8)*4+(q+1)%4
     fs.append((a0,a1,b1,b0))
 return mesh(name,vs,fs,materials['dark'],detailcol,True)
def stockless_anchor(name,crown,shank_to,spread,scale=1.0):
 # Original stockless (Hall-pattern) anchor: tapered shank, cast crown with pivoting arms and broad flukes.
 # crown: head of the crown; shank_to: where the shank enters the hawse pipe; spread: unit vector across the arms.
 c=Vector(crown);t=Vector(shank_to);ax=(t-c).normalized();sp=Vector(spread).normalized();fl=ax.cross(sp).normalized()
 s=scale
 rod(name+' shank',c+ax*.25*s,t,.15*s,materials['edge'],detailcol,.12*s,10)
 rod(name+' shackle',t-ax*.05,t+ax*.35*s,.09*s,materials['edge'],detailcol,vertices=8)
 box_c=c-ax*.05*s;ob=box(name+' crown',tuple(box_c),(.55*s,1.35*s,.42*s),materials['edge'],detailcol)
 ob.rotation_euler=Matrix((ax,sp,fl)).transposed().to_euler()
 for sg in [-1,1]:
  root=c+sp*sg*.55*s;tip=root-ax*1.05*s+sp*sg*.15*s+fl*.25*s
  rod(name+' arm',root,tip,.17*s,materials['edge'],detailcol,.11*s,8)
  # Broad fluke: a thick tapered plate at the arm end, facing the stowage bolster.
  p0=tip;p1=tip-ax*.7*s+sp*sg*.12*s
  vs=[tuple(p+sp*w*s+fl*h*s) for p in [p0,p1] for w,h in [(-.26,-.08),(.26,-.08),(.26,.08),(-.26,.08)]]
  mesh(name+' fluke',[vs[0],vs[1],vs[2],vs[3],vs[4],vs[5],vs[6],vs[7]],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],materials['edge'],detailcol)
 rod(name+' tripping palms',c-ax*.25*s-sp*.62*s,c-ax*.25*s+sp*.62*s,.10*s,materials['edge'],detailcol,vertices=8)
def windlass_capstan(name,x,y):
 # Cable capstan of the anchor windlass: bedplate, whelped barrel, head with eight bar sockets.
 z=deckz(x)
 cyl(name+' bedplate',(x,y,z+.07),1.10,.14,materials['naval'],detailcol,24)
 cyl(name+' whelped barrel',(x,y,z+.48),.74,.70,materials['edge'],detailcol,16)
 for i in range(8):
  a=i*math.tau/8;box(name+' whelp',(x+.74*math.cos(a),y+.74*math.sin(a),z+.48),(.16,.16,.64),materials['edge'],detailcol).rotation_euler.z=a
 cyl(name+' head',(x,y,z+.93),1.02,.20,materials['edge'],detailcol,24)
 cyl(name+' head cap',(x,y,z+1.07),.62,.10,materials['light'],detailcol,20)
 for i in range(8):
  a=i*math.tau/8+math.tau/16;rod(name+' bar socket',(x+.55*math.cos(a),y+.55*math.sin(a),z+1.04),(x+.98*math.cos(a),y+.98*math.sin(a),z+1.04),.05,materials['dark'],detailcol,vertices=5)
def bitts(name,x,y,z,along=True,gap=.84):
 # Double mooring bitts on a welded sole plate.
 d=Vector((gap/2,0,0)) if along else Vector((0,gap/2,0));c=Vector((x,y,z))
 box(name+' sole',(x,y,z+.06),(1.35,.58,.12) if along else (.58,1.35,.12),materials['edge'],detailcol)
 for sg in [-1,1]:
  p=c+d*sg;cyl(name+' post',(p.x,p.y,z+.40),.18,.66,materials['edge'],detailcol,12);cyl(name+' head',(p.x,p.y,z+.75),.24,.12,materials['naval'],detailcol,12)
def fairlead(name,x,sign):
 # Rolled oval fairlead in the deck edge, on a short foundation.
 yy=sign*(edge(x)-.30);z=deckz(x)
 box(name+' foundation',(x,yy,z+.06),(.9,.46,.12),materials['edge'],detailcol)
 for dx in [-.26,.26]:cyl(name+' roller',(x+dx,yy,z+.33),.12,.42,materials['edge'],detailcol,10)
def deck_fittings(aa_support):
 # Forecastle: two windlass capstans with their engine house, cable stoppers, deck pipes and the chains led
 # forward to the hawses; bower anchors stowed high in the hawse bolsters at the deck edge; the centreline stem
 # anchor; the low V breakwater ahead of Anton. Quarterdeck: stern capstans, bitts, fairleads, stern anchor.
 for sign in [-1,1]:
  windlass_capstan('Anchor windlass capstan',88.7,sign*2.5)
  x=92.7;z=deckz(x);box('Cable stopper and chain pipe',(x,sign*2.45,z+.17),(1.15,.58,.34),materials['naval'],detailcol)
  for dx in [-.27,.27]:cyl('Chain pipe opening',(x+dx,sign*2.45,z+.345),.17,.02,materials['dark'],detailcol,10)
  # Deck end of the hawse pipe, where the cable leaves the deck for the bolster.
  x=108.7;z=deckz(x);cyl('Hawse deck pipe',(x,sign*3.1,z+.12),.50,.24,materials['edge'],detailcol,16);cyl('Hawse deck pipe opening',(x,sign*3.1,z+.245),.33,.02,materials['dark'],detailcol,12)
  chain('Anchor cable',[(89.9,sign*2.62,deckz(89.9)+.08),(98.0,sign*2.85,deckz(98)+.08),(108.3,sign*3.08,deckz(108.3)+.08)])
  chain('Anchor cable',[(89.3,sign*1.95,deckz(89.3)+.08),(92.2,sign*2.30,deckz(92.2)+.08)])
  # Bower anchor stowed with its crown in the bolster pocket at the deck edge and the shank in the hawse.
  xc=111.4;zc=deckz(xc)-.25;yc=sign*(edge(xc)-.55)
  stockless_anchor('Bower anchor',(xc,yc,zc),(109.1,sign*3.18,deckz(109.1)+.22),(.25,sign*.4,-.88),1.0)
  # Heavy rolled bolster lip around the hawse pocket.
  pts=[(x,sign*(edge(x)+.02),deckz(x)+.04) for x in [109.4+i*.45 for i in range(8)]]
  polyline('Hawse bolster lip',pts,.11,materials['naval'],detailcol,False,8)
  # Mooring bitts and deck-edge fairleads.
  for x,y in [(91.9,7.4),(102.6,5.5),(-91.8,7.25),(-108.2,1.55),(-100.9,2.9),(-90.0,2.6),(-118.5,3.4)]:
   bitts('Double mooring bitt',x,sign*min(y,edge(x)-1.0),deckz(x)+.005)
  for x in [93.8,104.4,-89.3,-101.3,-116.0]:fairlead('Deck edge fairlead',x,sign)
  # Stern capstans on their machinery bases.
  x=-96.9;z=deckz(x);box('Stern capstan base',(x,sign*2.4,z+.14),(1.6,1.3,.28),materials['naval'],detailcol)
  cyl('Stern capstan barrel',(x,sign*2.4,z+.55),.46,.56,materials['edge'],detailcol,16);cyl('Stern capstan head',(x,sign*2.4,z+.88),.66,.14,materials['edge'],detailcol,20)
  # Deck edge rails interpolate the blueprint sheer at every original station.
  pts=[(x,sign*(edge(x)-.22),deckz(x)+.035) for x in [-122.5+i*2 for i in range(123)] if edge(x)>.5]
  rail('Weather deck safety rail',pts,.98,2.0,False)
  # Subtle rubbing strip, much thinner than the silhouette-defining hull.
  pts=[(x,sign*(side_width(x,deckz(x)-.32)+.024),deckz(x)-.32) for x in range(-120,123,2) if not 109<x<113]
  polyline('Sheer strake edge',[p for p in pts if p[0]<109],.028,materials['edge'],vertices=5)
  polyline('Sheer strake edge',[p for p in pts if p[0]>113],.028,materials['edge'],vertices=5)
 # Windlass engine house between the capstans, with its circular ventilation grating.
 x=90.6;z=deckz(x);box('Windlass engine house',(x,0,z+.34),(2.5,1.75,.68),materials['naval'],detailcol)
 cyl('Windlass house grating',(x,0,z+.70),.62,.06,materials['edge'],detailcol,20)
 for i in range(6):a=i*math.pi/6;rod('Grating bar',(x-.58*math.cos(a),-.58*math.sin(a),z+.74),(x+.58*math.cos(a),.58*math.sin(a),z+.74),.018,materials['dark'],detailcol,vertices=4)
 # Centreline stem anchor in its stem hawse, with a short cable to its stopper.
 x=121.35;box('Stem anchor stopper',(x,0,deckz(x)+.14),(.8,.55,.28),materials['naval'],detailcol)
 chain('Anchor cable',[(121.8,0,deckz(121.8)+.07),(123.0,0,deckz(123.0)+.07)],.42,.44,.27,.045)
 stockless_anchor('Stem anchor',(124.35,0,deckz(124.35)-.55),(123.2,0,deckz(123.2)+.15),(0,1,0),.72)
 # Low V breakwater ahead of Anton, with knees on its after face.
 bw=[(78.6,9.1),(84.25,1.8),(84.25,-1.8),(78.6,-9.1)];h=.75;vs=[];fs=[]
 samples=[]
 for (xa,ya),(xb,yb) in zip(bw,bw[1:]):
  n=max(1,math.ceil(math.hypot(xb-xa,yb-ya)/1.0))
  for i in range(n):samples.append((xa+(xb-xa)*i/n,ya+(yb-ya)*i/n))
 samples.append(bw[-1])
 for x,y in samples:vs.extend([(x,y,deckz(x)-.05),(x,y,deckz(x)+h)])
 for i in range(len(samples)-1):fs.append((2*i,2*i+2,2*i+3,2*i+1))
 ob=mesh('Breakwater plate',vs,fs,materials['naval'],supercol);mod=ob.modifiers.new('Plate thickness','SOLIDIFY');mod.thickness=.05
 polyline('Breakwater top rim',[(x,y,deckz(x)+h) for x,y in samples],.035,materials['edge'],detailcol,False,5)
 for (x,y),(x2,y2) in zip(samples,samples[1:]):
  mx,my=(x+x2)/2,(y+y2)/2;d=Vector((x2-x,y2-y,0)).normalized();back=Vector((-d.y,d.x,0))
  if back.x>0:back=-back
  z=deckz(mx);mesh('Breakwater knee',[(mx,my,z),(mx,my,z+h*.85),(mx+back.x*.55,my+back.y*.55,z)],[(0,1,2)],materials['naval'],detailcol).modifiers.new('Plate','SOLIDIFY').thickness=.03
 # Stern anchor stowed in its hawse on the port quarter, cable led forward to a stopper.
 x=-115.6;box('Stern anchor stopper',(x,.5,deckz(x)+.14),(.8,.55,.28),materials['naval'],detailcol)
 chain('Anchor cable',[(-116.0,.55,deckz(-116)+.07),(-120.6,1.7,deckz(-120.6)+.07)],.42,.44,.27,.045)
 stockless_anchor('Stern anchor',(-122.9,edge(-122.9)-.2,deckz(-122.9)-.75),(-121.0,1.85,deckz(-121.0)+.15),(.35,.2,-.9),.62)
 # Scuttles: two rows along the loft; the upper row runs the length of the forecastle and quarterdeck sides.
 for sign in [-1,1]:
  for x in range(-107,112,3):
   for z in [2.7,4.63]:
    if abs(x)<85 and z<3.0:continue
    if 106<x<114:continue
    if edge(x)<2:continue
    yy=sign*(side_width(x,z)+.034);porthole('Hull round scuttle',(x,yy,z),(0,sign,0),.145)
 for x,y in [(114,-1.2),(98,0),(-101.5,1.3),(-101.5,-1.3),(-115,0),(57,8),(57,-8),(-64,8),(-64,-8),(1,14),(1,-14),(-47,12),(-47,-12)]:
  if deckz(x)>aa_support.below(x,y,deckz(x)+1.2)+.02:continue
  hatch('Weather deck hatch',x,y,deckz(x)+.005,1.35,.95)
 for sign in [-1,1]:
  for x,y in [(109.3,.6),(-96.0,8.9),(48,7.8),(61,7.8),(-52,7.8),(-87,7.8)]:
   y=sign*min(y,edge(x)-1.2);z=deckz(x)
   if y*sign<.3 and sign<0:continue
   cyl('Mushroom vent stem',(x,y,z+.32),.18,.64,materials['naval'],detailcol,16)
   cyl('Mushroom vent hood',(x,y,z+.69),.34,.22,materials['naval'],detailcol,20)
  for x,y in [(51.6,6.6),(-97,5)]:
   y*=sign;z=deckz(x)+.55
   rod('Hose reel axle',(x,y-.55,z),(x,y+.55,z),.11,materials['edge'],detailcol,vertices=12)
   for yy in [-.38,.38]:rod('Hose reel flange',(x,y+yy-.035,z),(x,y+yy+.035,z),.53,materials['edge'],detailcol,vertices=24)
   rod('Hose drum',(x,y-.34,z),(x,y+.34,z),.37,materials['rope'],detailcol,vertices=24)
   for yy in [-.45,.45]:box('Reel support',(x,y+yy,z-.30),(.18,.12,.55),materials['naval'],detailcol)
def underwater():
 # Original three-bladed screws: broad paddle outlines, reduced rake, helical pitch and thick roots into rounded
 # bosses. Shaft lines, bossings, A-brackets and the twin rudders follow the approved pgsb708 A_Hull.
 # These visual shafts do not move the blueprint's machinery or combat sockets.
 def screw_boss(x,y,z):
  rows=[(1.16,.30),(.83,.59),(.34,.73),(-.34,.72),(-.85,.61),(-1.18,.39),(-1.34,.08)]
  vs=[(x+dx,y+r*math.cos(math.tau*i/24),z+r*math.sin(math.tau*i/24)) for dx,r in rows for i in range(24)]
  fs=[tuple(reversed(range(24))),tuple(range((len(rows)-1)*24,len(rows)*24))]
  fs.extend((j*24+i,j*24+(i+1)%24,(j+1)*24+(i+1)%24,(j+1)*24+i) for j in range(len(rows)-1) for i in range(24))
  return mesh('Propeller boss',vs,[tuple(reversed(f)) for f in fs],materials['bronze'],undercol,True)
 def strut(name,a,b,chord=.72):
  # Closed foil strut: a wide axial chord and a narrow rounded trailing edge.
  a,b=Vector(a),Vector(b);radial=(b-a).normalized();side=radial.cross(Vector((1,0,0))).normalized()
  profile=[(-.52,0),(-.36,.10),(.16,.12),(.48,.04),(.54,0),(.48,-.04),(.16,-.12),(-.36,-.10)]
  vs=[p+Vector((u*chord,0,0))+side*v for p in [a,b] for u,v in profile];n=len(profile)
  fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  return mesh(name,vs,[tuple(reversed(f)) for f in fs],materials['oxide'],undercol,True)
 def screw(xhub,y,z,radius=2.2):
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
   blade=mesh('Twisted screw blade',vs,fs,materials['bronze'],undercol,True)
   bm=bmesh.new();bm.from_mesh(blade.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(blade.data);bm.free()
 for sign in [-1,1]:
  # Long streamlined bossing around each wing shaft, from where it leaves the bottom to the exposed shaft.
  table=[(-67.4,6.28,.05,-7.72),(-70.6,6.64,1.60,-7.82),(-73.6,6.35,2.02,-7.82),(-76.5,6.10,2.09,-7.72),(-79.5,5.90,2.02,-7.59),
         (-82.5,5.70,1.69,-7.44),(-85.5,5.68,1.31,-7.22),(-88.5,5.66,.97,-6.98),(-91.5,5.62,.75,-6.70),(-93.4,5.45,.42,-6.02),(-94.5,5.00,.05,-4.4)]
  vs=[];rings=[]
  for x,yc,a,zb in table:
   top=hull_bottom(x,yc)+.35;zc=(top+zb)/2;b=max(.05,(top-zb)/2)
   rings.append(len(vs))
   for i in range(12):
    t=i*math.tau/12;vs.append((x,sign*(yc+a*math.cos(t)),zc+b*math.sin(t)))
  fs=[tuple(range(12))[::-1 if sign>0 else 1],tuple(range(rings[-1],rings[-1]+12))[::1 if sign>0 else -1]]
  for r0,r1 in zip(rings,rings[1:]):fs.extend((r0+i,r0+(i+1)%12,r1+(i+1)%12,r1+i) for i in range(12))
  ob=mesh('Shaft bossing',vs,fs,materials['oxide'],undercol,True)
  bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
  # Exposed wing shaft, A-bracket barrel with its two foil arms (one to the bottom, one to the skeg), screw.
  y=sign*6.0
  rod('Propeller shaft',(-90.5,sign*5.95,-6.30),(-99.0,y,-6.49),.33,materials['edge'],undercol,vertices=16)
  rod('Shaft A-bracket barrel',(-95.45,y,-6.46),(-98.6,y,-6.48),.72,materials['oxide'],undercol,.62,20)
  strut('Shaft A-bracket arm',(-97.0,sign*6.1,-6.1),(-97.0,sign*6.1,hull_bottom(-97.0,6.1)+.2),1.55)
  zf=-4.85;strut('Shaft A-bracket arm',(-97.0,sign*5.45,-6.3),(-97.0,sign*(side_width(-97.0,zf)-.05),zf),1.35)
  screw(-100.0,y,-6.49)
  # Twin parallel rudders abreast of the centre screw's race.
  yr=sign*2.47
  pts=[(-114.65,yr),(-112.6,yr-.36),(-110.3,yr-.50),(-108.8,yr-.36),(-108.2,yr),(-108.8,yr+.36),(-110.3,yr+.50),(-112.6,yr+.36)]
  top=max(hull_bottom(x,2.47) for x in [-108.4,-111,-114.4])+.25
  extrude('Twin balanced rudder',pts,-6.95,top+6.95,materials['oxide'],undercol,.06)
  cyl('Rudder head bearing',(-110.3,yr,hull_bottom(-110.3,2.47)+.02),.55,.35,materials['oxide'],undercol,16)
  # Bilge keels along the midship bilge only (x -27 to +26).
  stations=[-27.3,-21.3,-15.4,-9.5,-3.6,2.3,8.2,14.1,20.0,25.9];vs=[]
  zc=[-7.06,-7.81,-8.26,-8.40,-8.35,-8.53,-8.31,-8.14,-7.68,-6.33];depth=[.05,.62,.95,1.05,1.08,1.08,1.05,.95,.6,.05]
  for x,z,dp in zip(stations,zc,depth):
   zr=z+.45*dp;w=side_width(x,zr)-.03;d=Vector((.72,-.69))*dp
   vs.extend([(x,sign*w,zr+.04),(x,sign*(w+d.x),zr+d.y+.02),(x,sign*(w+d.x),zr+d.y-.02),(x,sign*w,zr-.04)])
  fs=[(i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j) for i in range(len(stations)-1) for j in range(4)]+[(3,2,1,0),tuple(range((len(stations)-1)*4,len(stations)*4))]
  ob=mesh('Bilge keel',vs,fs,materials['oxide'],undercol)
  bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
 # Centre shaft leaves the skeg's shaft tube; its screw turns just ahead of the twin rudders.
 rod('Propeller shaft',(-105.4,0,-6.95),(-106.0,0,-6.95),.36,materials['edge'],undercol,vertices=16)
 screw(-107.2,0,-6.95)
def build():
 # Region entry point, after the superstructure regions; the loft itself runs first of all (loft()).
 staffs()
def after_mounts(aa_support):
 deck_fittings(aa_support);underwater()

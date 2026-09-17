"""Generic WW2-era forecastle deck gear, authored at fixed metre dimensions.

Nation-neutral originals in the style of construction/deck_fittings.py: not
reconstructions of a named vessel. Axes are forward/port/up, deck sole at Z=0,
everything static and in its stowed pose.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model

AXES={'x':((1,0,0),(0,1,0),(0,0,1)),'y':((0,1,0),(0,0,1),(1,0,0)),'z':((0,0,1),(1,0,0),(0,1,0))}


class Gear(Model):
    def lathe(self,name,profile,origin,axis='x',n=32,soft=False,closed=False,**kw):
        """Revolve [(t,r)] about an axis through origin. soft shares rings (smooth along the profile)."""
        A,u,v=map(Vector,AXES[axis]);o=Vector(origin)
        ring=lambda t,r:[o+A*t+r*(u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n)) for i in range(n)]
        verts=[];faces=[];k=len(profile)
        if soft:
            for t,r in profile:verts+=ring(t,r)
            for j in range(k if closed else k-1):
                a,b=j*n,((j+1)%k)*n
                faces+=[(a+i,a+(i+1)%n,b+(i+1)%n,b+i) for i in range(n)]
            ends=(0,(k-1)*n)
        else:
            for j in range(k if closed else k-1):
                a=len(verts);verts+=ring(*profile[j])+ring(*profile[(j+1)%k])
                faces+=[(a+i,a+(i+1)%n,a+n+(i+1)%n,a+n+i) for i in range(n)]
            ends=(0,len(verts)-n)
        if not closed:faces+=[tuple(range(ends[0],ends[0]+n)),tuple(range(ends[1],ends[1]+n))]
        obj=self.mesh(name,verts,faces,smooth=True,**kw)
        for f in obj.data.polygons:f.use_smooth=len(f.vertices)==4
        return obj

    def tube(self,name,points,radius,closed=False,sides=8,**kw):
        points=[Vector(p) for p in points];n=len(points);verts=[];pt=pn=None
        for i,p in enumerate(points):
            t=(points[(i+1)%n]-points[(i-1)%n]) if closed else (points[min(i+1,n-1)]-points[max(0,i-1)])
            t.normalize()
            if pt is None:
                ref=min((Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))),key=lambda a:abs(a.dot(t)))
                nor=t.cross(ref).normalized()
            else:
                nor=pt.rotation_difference(t)@pn;nor=(nor-t*nor.dot(t)).normalized()
            oth=t.cross(nor).normalized();pt,pn=t.copy(),nor.copy()
            verts+=[p+radius*(nor*math.cos(math.tau*j/sides)+oth*math.sin(math.tau*j/sides)) for j in range(sides)]
        faces=[]
        for i in range(n if closed else n-1):
            k=(i+1)%n
            faces+=[(i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j) for j in range(sides)]
        if not closed:faces+=[tuple(reversed(range(sides))),tuple(range((n-1)*sides,n*sides))]
        return self.mesh(name,verts,faces,smooth=True,**kw)

    def ring(self,name,center,radius,tube=.018,axis='z',count=28,**kw):
        A,u,v=map(Vector,AXES[axis]);c=Vector(center)
        return self.tube(name,[c+radius*(u*math.cos(i*math.tau/count)+v*math.sin(i*math.tau/count)) for i in range(count)],tube,closed=True,**kw)

    def hexa(self,name,corners,**kw):
        """Solid from 8 corners: bottom loop 0-3 then the matching top loop 4-7."""
        return self.mesh(name,[tuple(c) for c in corners],[(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],**kw)

    def extrude(self,name,outline,axis,lo,hi,**kw):
        """Convex outline extruded along x ((y,z) pairs) or y ((x,z) pairs)."""
        put=(lambda a,b,t:(t,a,b)) if axis=='x' else (lambda a,b,t:(a,t,b))
        n=len(outline)
        return self.mesh(name,[put(a,b,t) for t in [lo,hi] for a,b in outline],
                         [tuple(range(n)),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],**kw)

    def strip(self,name,top,bot,axis,lo,hi,**kw):
        """Section bounded by two matched polylines (may be concave), extruded along x or y."""
        put=(lambda a,b,t:(t,a,b)) if axis=='x' else (lambda a,b,t:(a,t,b))
        n=len(top);verts=[put(a,b,t) for t in [lo,hi] for a,b in list(top)+list(bot)];faces=[]
        for i in range(n-1):
            faces+=[(i,i+1,n+i+1,n+i),(2*n+i,2*n+i+1,3*n+i+1,3*n+i),(i,i+1,2*n+i+1,2*n+i),(n+i,n+i+1,3*n+i+1,3*n+i)]
        faces+=[(0,n,3*n,2*n),(n-1,2*n-1,4*n-1,3*n-1)]
        return self.mesh(name,verts,faces,**kw)

    def hexbolt(self,loc,r=.02,h=.025,**kw):
        self.cyl('bolt',loc,r,h,mat='edge',vertices=6,**kw)


def rounded_rect(x0,x1,y0,y1,r,seg=4):
    pts=[]
    for cx,cy,a0 in [(x1-r,y1-r,0),(x0+r,y1-r,90),(x0+r,y0+r,180),(x1-r,y0+r,270)]:
        for i in range(seg+1):
            a=math.radians(a0+90*i/seg);pts.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return pts


def hull2d(points):
    pts=sorted(set(points))
    def half(seq):
        out=[]
        for p in seq:
            while len(out)>1 and (out[-1][0]-out[-2][0])*(p[1]-out[-2][1])-(out[-1][1]-out[-2][1])*(p[0]-out[-2][0])<=0:out.pop()
            out.append(p)
        return out[:-1]
    return half(pts)+half(reversed(pts))


def coils(lo,hi,core,outer,pitch):
    """Bumpy lathe profile reading as wound rope or wire."""
    count=max(2,round((hi-lo)/pitch));step=(hi-lo)/count;prof=[(lo,core)]
    for i in range(count):
        prof+=[(lo+step*(i+.18),outer-.006),(lo+step*(i+.5),outer),(lo+step*(i+.82),outer-.006),(lo+step*(i+1),outer-.022)]
    prof[-1]=(hi,outer-.022);prof.append((hi,core))
    return prof


def create_paravane(part,col,helpers,materials):
    m=Gear(col,helpers,materials);z0=.62;R=.27
    body=[(1.62,.012),(1.59,.07),(1.50,.14),(1.34,.205),(1.12,.25),(.85,R),(.10,R),(-.50,.25),(-1.00,.19),(-1.42,.115),(-1.74,.06),(-1.80,.05)]
    m.lathe('float-body',body,(0,0,z0),'x',n=28,soft=True)
    for x in [.98,.02,-.62]:m.lathe('body-joint',[(-.025,R+.004 if x>-.5 else .245),(.025,R+.004 if x>-.5 else .245)],(x,0,z0),'x',n=28,mat='edge')
    m.lathe('nose-cap',[(1.50,.145),(1.59,.075),(1.625,.015)],(0,0,z0),'x',n=20,soft=True,mat='edge')
    # Horizontal towing plane through the fore body, with tip plates.
    plane=[(1.27,.30),(1.12,1.02),(.76,1.02),(.55,.30),(.55,-.30),(.76,-1.02),(1.12,-1.02),(1.27,-.30)]
    m.prism('towing-plane',plane,z0+.085,z0+.125)
    m.path('plane-leading-edge',[(1.12,-1.02,z0+.105),(1.27,-.30,z0+.105),(1.27,.30,z0+.105),(1.12,1.02,z0+.105)],.024,mat='edge',vertices=8)
    for side in [-1,1]:
        m.box('tip-plate',(.94,side*1.03,z0+.105),(.44,.025,.20),mat='edge')
        m.rod('plane-brace',(.90,side*.24,z0-.13),(.90,side*.80,z0+.085),.018,mat='edge',vertices=8)
    # Towing pylon and eye.
    m.box('tow-pylon',(.92,0,z0+.30),(.26,.05,.12),mat='edge')
    m.ring('tow-eye',(.92,0,z0+.41),.06,.018,'y',count=16,mat='edge')
    # Cutter jaw on the nose bracket.
    m.box('cutter-bracket',(1.40,0,z0+.235),(.26,.05,.10),mat='edge')
    j=(1.50,0,z0+.27)
    m.rod('cutter-jaw-upper',j,(1.90,0,z0+.50),.026,mat='edge',vertices=8)
    m.rod('cutter-jaw-lower',j,(1.92,0,z0+.22),.026,mat='edge',vertices=8)
    m.extrude('cutter-blade',[(1.52,z0+.27),(1.74,z0+.385),(1.75,z0+.245)],'y',-.02,.02,mat='dark')
    m.rod('cutter-pivot',(1.52,-.045,z0+.27),(1.52,.045,z0+.27),.03,mat='edge',vertices=8)
    # Tail: cruciform fins inside a protective ring, depth gear on top.
    fin=[(-1.12,.10),(-1.46,.41),(-1.78,.41),(-1.78,-.41),(-1.46,-.41),(-1.12,-.10)]
    m.prism('tail-fin-horizontal',fin,z0-.012,z0+.012)
    m.extrude('tail-fin-vertical',[(x,z0+r) for x,r in fin],'y',-.012,.012)
    for x in [-1.50,-1.76]:m.ring('tail-ring',(x,0,z0),.41,.02,'x',mat='edge')
    m.rod('rudder-post',(-1.80,0,z0-.30),(-1.80,0,z0+.30),.018,mat='edge',vertices=8)
    m.cyl('depth-valve',(-.30,0,z0+.27),.075,.07,mat='edge',vertices=16)
    m.cyl('depth-valve-cap',(-.30,0,z0+.315),.05,.03,mat='dark',vertices=12)
    m.ring('lifting-eye',(.30,0,z0+.30),.045,.014,'y',count=14,mat='edge')
    # Two deck chocks with lashing straps, tied together by skids.
    for x in [.30,-.90]:
        r=R if x>-.5 else .215
        top=[(r*math.sin(a),z0-r*math.cos(a)) for a in [math.radians(-66+132*i/10) for i in range(11)]]
        bot=[(-.46+.92*i/10,.035) for i in range(11)]
        m.strip('cradle',top,bot,'x',x-.07,x+.07,mat='roof')
        m.box('cradle-foot',(x,0,.0175),(.30,1.04,.035),mat='edge')
        for side in [-1,1]:
            for dx in [-.10,.10]:m.hexbolt((x+dx,side*.46,.045))
        rs=r+.012
        strap=[(x,-.44,.05),(x,-.40,.22)]+[(x,rs*math.sin(a),z0+rs*math.cos(a)) for a in [math.radians(-100+200*i/14) for i in range(15)]]+[(x,.40,.22),(x,.44,.05)]
        m.tube('lashing-strap',strap,.013,sides=6,mat='edge')
        for side in [-1,1]:m.rod('strap-screw',(x,side*.405,.10),(x,side*.428,.20),.024,mat='dark',vertices=8)
    for side in [-1,1]:m.box('chock-skid',(-.30,side*.34,.02),(1.50,.07,.04),mat='edge')
    return m.root


def create_breakwater(part,col,helpers,materials):
    m=Gear(col,helpers,materials);H=1.10;lean=.17;t=.035;ax=1.06;ex=-.94;ey=4.0
    for side in [1,-1]:
        d=Vector((ex-ax,side*ey,0)).normalized();out=Vector((d.y*side,-d.x*side,0));cx=out.x
        def P(s,o,z,side=side,out=out,cx=cx):
            o2=o+lean*z/H
            return Vector((ax+o2/cx,0,z)).lerp(Vector((ex,side*ey,z))+out*o2,s)
        def slab(name,s0,s1,o0,o1,z0,z1,P=P,**kw):
            m.hexa(name,[P(s,o,z) for z in [z0,z1] for s,o in [(s0,o0),(s1,o0),(s1,o1),(s0,o1)]],**kw)
        # Long members run in six bays so each piece fits the arm's collision box for that bay.
        bays=[(i/6,(i+1)/6) for i in range(6)]
        for a,b in bays:slab('plate',a,b,-t,0,.11,H)
        # Foot strakes between real drain slots.
        slots=7;w=.015;edges=[0]+[v for i in range(slots) for v in ((i+.5)/slots-w,(i+.5)/slots+w)]+[1]
        for a,b in zip(edges[0::2],edges[1::2]):
            slab('foot-strake',a,b,-t-.012,.012,0,.11)
            slab('foot-angle',a,b,.012,.10,0,.022,mat='edge')
        for a,b in bays:
            slab('slot-lintel',a,b,-t-.014,.014,.11,.135,mat='edge')
            slab('stiffener',a,b,-t-.11,-t,.60,.635,mat='edge')
            m.rod('rolled-top',P(a,-t/2,H),P(b,-t/2,H),.052,mat='edge',vertices=12)
        m.box('end-post-pad',tuple(P(1,-t/2,0)+Vector((0,0,.01))),(.16,.16,.02),mat='edge')
        m.rod('end-post',P(1,-t/2,.012),P(1,-t/2,H+.03),.05,mat='edge',vertices=10)
        for s in [.10,.22,.34,.46,.58,.70,.82,.93]:
            a,b,c=P(s,-t,0),P(s,-t,0)-out*.58,P(s,-t,.92)
            off=d*.014
            m.mesh('gusset',[tuple(p+q) for q in [-off,off] for p in [a,b,c]],[(0,1,2),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)])
            m.rod('gusset-flange',b+Vector((0,0,.026)),c,.02,mat='edge',vertices=6)
    # Stem post and centreline gusset at the apex.
    tip=lambda o,z:(ax+(o+lean*z/H)/.894,0,z)
    m.cyl('stem-post-pad',(ax-t/2/.894,0,.01),.10,.02,mat='edge',vertices=12)
    m.rod('stem-post',tip(-t/2,.016),tip(-t/2,H+.04),.062,mat='edge',vertices=12)
    xa=ax-(t+.02)/.894
    m.mesh('apex-gusset',[(xa,y,0) for y in [-.014,.014]]+[(xa-.85,y,0) for y in [-.014,.014]]+[(xa+lean*.95/H/.894,y,.95) for y in [-.014,.014]],
           [(0,2,4),(1,3,5),(0,1,3,2),(2,3,5,4),(4,5,1,0)])
    m.rod('apex-gusset-flange',(xa-.85,0,.028),(xa+lean*.95/H/.894,0,.95),.022,mat='edge',vertices=6)
    return m.root


def create_hawse_pipe(part,col,helpers,materials):
    m=Gear(col,helpers,materials);n=36;cx=.36
    plate=rounded_rect(-1.0,1.0,-.52,.52,.22,5)
    m.prism('wear-plate',plate,0,.022,mat='edge')
    for x in [-.88,-.55,-.2]:
        for side in [-1,1]:m.hexbolt((x,side*.44,.03),.022,.02)
    # Oval bolster casting: high at the fore lip, low and flared aft where the cable leads out.
    prof=[(.62,.44,0,0),(.60,.42,0,.09),(.555,.375,.005,.175),(.49,.31,.015,.225),(.43,.255,.03,.20)]
    dark=[(.43,.255,.03,.20),(.385,.215,.07,.11),(.33,.18,.15,.014)]
    def rings(rows):
        out=[]
        for a,b,dx,z in rows:
            for i in range(n):
                th=i*math.tau/n;f=.60+.40*(math.cos(th)+1)/2 if z>.05 else 1
                out.append((cx+dx+a*math.cos(th)*(1+.06*(1-f)),b*math.sin(th),z*f))
        return out
    quads=lambda k:[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(k-1) for i in range(n)]
    m.mesh('bolster',rings(prof),quads(len(prof))+[tuple(range(n))],smooth=True)
    m.mesh('pipe-mouth',rings(dark),quads(len(dark))+[tuple(range(2*n,3*n))],mat='dark',smooth=True)
    for i in range(10):
        th=math.radians(36*i+18);m.hexbolt((cx+.61*math.cos(th),.43*math.sin(th),.03),.02,.05)
    # Cable led from the pipe through the stopper.
    path=[Vector(p) for p in [(.66,0,.075),(.45,0,.10),(.20,0,.165),(-.06,0,.215),(-.35,0,.20),(-.80,0,.195),(-.96,0,.09)]]
    lengths=[(b-a).length for a,b in zip(path,path[1:])];total=sum(lengths);pitch=.112;count=int(total/pitch)
    def at(sd):
        for a,b,l in zip(path,path[1:],lengths):
            if sd<=l:return a.lerp(b,sd/l),(b-a).normalized()
            sd-=l
        return path[-1],(path[-1]-path[-2]).normalized()
    for k in range(count+1):
        c,T=at(min(total,k*pitch+.02));N=Vector((-T.z,0,T.x));S=Vector((0,1,0));W=S if k%2==0 else N
        pts=[]
        for e,a0 in [(1,-90),(-1,90)]:
            for i in range(6):
                a=math.radians(a0+180*i/5);pts.append(c+T*(e*.056)+(T*math.cos(a)+W*math.sin(a))*.044)
        m.tube('cable-link',pts,.021,closed=True,sides=6,mat='dark')
    # Guillotine chain stopper on a short pedestal.
    sx=-.52
    m.box('stopper-pedestal',(sx,0,.07),(.46,.52,.10))
    m.box('stopper-sole',(sx,0,.13),(.40,.20,.02),mat='edge')
    for side in [-1,1]:
        m.extrude('stopper-cheek',[(sx-.20,.12),(sx+.20,.12),(sx+.20,.26),(sx+.10,.33),(sx-.10,.33),(sx-.20,.26)],'y',side*.12-.03 if side>0 else -.18,side*.12+.06 if side>0 else -.09)
        for dx in [-.17,.17]:m.hexbolt((sx+dx,side*.225,.13))
    m.box('guillotine-bar',(sx,.0,.305),(.075,.46,.045),mat='edge')
    m.rod('guillotine-hinge',(sx-.06,-.215,.305),(sx+.06,-.215,.305),.035,mat='edge',vertices=10)
    m.rod('guillotine-pin',(sx,.215,.26),(sx,.215,.40),.018,mat='edge',vertices=8)
    m.ring('pin-toggle',(sx,.215,.425),.03,.009,'x',count=12,mat='edge')
    m.rod('stopper-lever',(sx,.22,.305),(sx,.50,.42),.02,mat='edge',vertices=8)
    m.rod('lever-grip',(sx,.44,.395),(sx,.515,.426),.03,mat='dark',vertices=8)
    # Blake slip and bottle screw led from a deck eye to the cable ahead of the stopper.
    a,b=Vector((-.16,-.42,.06)),Vector((.16,-.06,.19))
    m.box('slip-eye-pad',(a.x,a.y,.035),(.20,.16,.03),mat='edge')
    m.ring('slip-eye',(a.x,a.y,.085),.045,.015,'y',count=14,mat='edge')
    m.rod('slip-shank',a+Vector((0,0,.03)),b,.016,mat='edge',vertices=8)
    m.rod('bottle-screw',a.lerp(b,.30),a.lerp(b,.62),.034,mat='edge',vertices=10)
    m.rod('slip-tongue',a.lerp(b,.86),b+Vector((.06,.035,.0)),.028,mat='dark',vertices=8)
    return m.root


def create_cable_reel(part,col,helpers,materials):
    m=Gear(col,helpers,materials);z0=.68;fy=.46;gy=.60
    m.rod('shaft',(0,-.70,z0),(0,.69,z0),.035,mat='edge',vertices=12)
    m.lathe('drum-core',[(-fy,.20),(fy,.20)],(0,0,z0),'y',n=24)
    m.lathe('rope',coils(-fy+.02,fy-.02,.20,.385,.042),(0,0,z0),'y',n=28,soft=True,mat='roof')
    m.tube('rope-tail',[(.37,.30,z0+.06),(.40,.30,z0-.08),(.42,.30,.30),(.50,.30,.07),(.56,.31,.022),(.68,.27,.019)],.019,sides=8,mat='roof')
    for side in [-1,1]:
        y=side*fy
        m.lathe('flange-rim',[(-.016,.43),(-.016,.50),(.016,.50),(.016,.43)],(0,y,z0),'y',n=40,closed=True)
        m.ring('flange-bead',(0,y+side*.016,z0),.495,.014,'y',count=40,mat='edge')
        m.lathe('flange-hub',[(-.03,.105),(.03,.105),(.045,.07)] if side>0 else [(-.045,.07),(-.03,.105),(.03,.105)],(0,y,z0),'y',n=20)
        for i in range(6):
            a=i*math.tau/6+.26
            m.rod('flange-spoke',(.09*math.cos(a),y,z0+.09*math.sin(a)),(.44*math.cos(a),y,z0+.44*math.sin(a)),.022,vertices=8)
        # A-frame stand.
        yy=side*gy
        for e in [-1,1]:
            m.hexa('frame-leg',[(e*.46+dx,yy+dy,.03) for dx,dy in [(-.045,-.03),(.045,-.03),(.045,.03),(-.045,.03)]]+[(e*.03+dx,yy+dy,z0+.03) for dx,dy in [(-.045,-.03),(.045,-.03),(.045,.03),(-.045,.03)]])
            m.box('frame-foot',(e*.46,yy,.015),(.22,.16,.03),mat='edge')
            for dx in [-.075,.075]:m.hexbolt((e*.46+dx,yy+side*.05,.04),.016,.022)
        m.box('frame-tie',(0,yy,.27),(.64,.05,.06))
        m.lathe('bearing',[(-.05,.085),(.05,.085)],(0,yy,z0),'y',n=20,mat='edge')
        m.box('bearing-cap',(0,yy,z0+.085),(.20,.09,.04),mat='edge')
    for e in [-1,1]:m.box('base-rail',(e*.46,0,.045),(.07,2*gy-.10,.05),mat='edge')
    # Band brake with a hand lever.
    m.lathe('brake-drum',[(-.555,.27),(-.478,.27)],(0,0,z0),'y',n=32)
    m.lathe('brake-band',[(-.545,.283),(-.490,.283)],(0,0,z0),'y',n=32,mat='dark')
    m.box('brake-pivot',(.26,-.56,.27),(.07,.12,.08),mat='edge')
    m.rod('brake-lever',(.22,-.52,.27),(.64,-.52,.56),.02,mat='edge',vertices=8)
    m.rod('brake-grip',(.575,-.52,.515),(.655,-.52,.57),.03,mat='dark',vertices=8)
    m.rod('brake-link',(.30,-.52,.325),(.22,-.52,.52),.014,mat='edge',vertices=6)
    # Crank handle.
    m.lathe('crank-boss',[(.64,.06),(.70,.06)],(0,0,z0),'y',n=14,mat='edge')
    m.hexa('crank-arm',[(-.03,.655,z0),(.0,.655,z0+.035),(.0,.685,z0+.035),(-.03,.685,z0)]+[(.20,.655,z0-.26),(.235,.655,z0-.225),(.235,.685,z0-.225),(.20,.685,z0-.26)],mat='edge')
    m.rod('crank-handle',(.215,.67,z0-.243),(.215,.80,z0-.243),.026,mat='dark',vertices=10)
    return m.root


def create_deck_winch(part,col,helpers,materials):
    m=Gear(col,helpers,materials);z0=.74;mx=-.80;mz=.45
    m.box('bedplate',(-.17,0,.05),(1.96,2.04,.10))
    m.box('bedplate-lip',(-.17,0,.02),(2.04,2.12,.04),mat='edge')
    for x in [-1.10,-.48,.14,.74]:
        for side in [-1,1]:m.hexbolt((x,side*.97,.11),.026,.03)
    m.rod('main-shaft',(0,-1.30,z0),(0,1.30,z0),.06,mat='edge',vertices=14)
    # Central drum wound with wire.
    m.lathe('drum-flanges',[(-.46,.30),(-.46,.52),(-.415,.52),(-.415,.30),(.415,.30),(.415,.52),(.46,.52),(.46,.30)],(0,0,z0),'y',n=40)
    m.lathe('wire',coils(-.415,.415,.30,.405,.036),(0,0,z0),'y',n=32,soft=True,mat='edge')
    m.tube('wire-end',[(.40,.30,z0+.04),(.44,.30,z0-.12),(.43,.30,z0-.26)],.014,sides=6,mat='edge')
    m.box('wire-clamp',(.43,.30,z0-.28),(.06,.05,.04),mat='dark')
    for side in [-1,1]:
        m.ring('flange-bead',(0,side*.4375,z0),.52,.016,'y',count=40,mat='edge')
        # Bearing pedestals.
        y=side*.68
        m.extrude('pedestal',[(-.34,.10),(.34,.10),(.15,z0+.02),(.11,z0+.13),(-.11,z0+.13),(-.15,z0+.02)],'y',y-.065,y+.065)
        m.box('pedestal-foot',(0,y,.125),(.84,.24,.05),mat='edge')
        for e in [-1,1]:m.hexbolt((e*.37,y,.16),.024,.03)
        m.lathe('bearing',[(-.09,.14),(.09,.14)],(0,y,z0),'y',n=20,mat='edge')
        m.cyl('oil-cup',(0,y,z0+.17),.03,.07,mat='bronze',vertices=10)
        # Warping heads.
        head=[(0,.21),(.05,.21),(.12,.155),(.30,.135),(.40,.175),(.45,.235),(.49,.235),(.49,.09),(.52,.09)]
        m.lathe('warping-head',[(side*t,r) for t,r in head],(0,side*.78,z0),'y',n=28,soft=True)
        for i in range(5):
            a=i*math.tau/5
            m.rod('whelp',(.158*math.cos(a),side*.90,z0+.158*math.sin(a)),(.145*math.cos(a),side*1.12,z0+.145*math.sin(a)),.018,mat='edge',vertices=6)
        m.cyl('shaft-nut',(0,side*1.30,z0),.075,.04,mat='edge',vertices=6).rotation_euler=(math.pi/2,0,0)
    # Reduction gear case between drum and port pedestal, down to the motor pinion.
    case=hull2d([(.56*math.cos(i*math.tau/36),z0+.56*math.sin(i*math.tau/36)) for i in range(36)]+[(mx+.22*math.cos(i*math.tau/20),mz+.22*math.sin(i*math.tau/20)) for i in range(20)])
    m.extrude('gear-case',case,'y',.475,.60)
    grow=lambda pts,k:[((x-(-.25))*k+(-.25),(z-.64)*k+.64) for x,z in pts]
    m.extrude('gear-case-joint',grow(case,1.035),'y',.528,.548,mat='edge')
    m.box('gear-case-foot',(-.30,.5375,.14),(1.10,.16,.08),mat='edge')
    m.cyl('inspection-cover',(.0,.5375,z0+.555),.085,.04,mat='edge',vertices=12)
    # Motor housing with cooling ribs, end bell and terminal box.
    m.lathe('motor',[(-.62,.10),(-.60,.22),(-.52,.275),(.26,.275),(.33,.22),(.36,.10),(.475,.10)],(mx,0,mz),'y',n=32)
    for y in [-.44+i*.085 for i in range(8)]:m.lathe('motor-rib',[(-.014,.30),(.014,.30)],(mx,y,mz),'y',n=32,mat='edge')
    m.lathe('end-bell-cap',[(-.66,.07),(-.62,.11)],(mx,0,mz),'y',n=16,mat='dark')
    m.box('motor-feet',(mx,-.13,.16),(.62,.78,.12),mat='edge')
    m.box('terminal-box',(mx-.02,-.20,mz+.31),(.26,.30,.12))
    m.box('terminal-lid',(mx-.02,-.20,mz+.375),(.29,.33,.02),mat='edge')
    m.path('conduit',[(mx-.02,-.37,mz+.31),(mx-.02,-.80,mz+.31),(mx-.02,-.80,.10)],.028,mat='edge',vertices=8)
    # Band brake on the starboard flange with a foot-of-pedestal lever.
    m.lathe('brake-drum',[(-.60,.40),(-.47,.40)],(0,0,z0),'y',n=36)
    m.lathe('brake-band',[(-.585,.415),(-.485,.415)],(0,0,z0),'y',n=36,mat='dark')
    m.box('brake-anchor',(.38,-.535,.22),(.12,.12,.24),mat='edge')
    m.rod('brake-link',(.38,-.535,.34),(.36,-.535,z0-.20),.018,mat='edge',vertices=6)
    m.rod('brake-lever',(.34,-.535,.30),(.98,-.535,.92),.024,mat='edge',vertices=8)
    m.rod('brake-grip',(.90,-.535,.843),(1.0,-.535,.94),.034,mat='dark',vertices=8)
    # Control pedestal with reversing lever on a quadrant.
    px,py=.62,.30
    m.box('control-pedestal',(px,py,.50),(.22,.26,.80))
    m.box('control-head',(px,py,.93),(.27,.31,.07),mat='edge')
    quad=[(px+.17*math.cos(a),.965+.17*math.sin(a)) for a in [math.radians(20+140*i/8) for i in range(9)]]
    m.extrude('quadrant',quad,'y',py+.10,py+.12,mat='edge')
    m.rod('control-lever',(px,py+.075,.96),(px+.17,py+.075,1.34),.018,mat='edge',vertices=8)
    m.rod('control-knob',(px+.155,py+.075,1.305),(px+.185,py+.075,1.375),.032,mat='dark',vertices=10)
    m.box('controller-case',(px+.02,py-.02,.50),(.30,.18,.34),mat='edge')
    m.path('control-conduit',[(px-.11,py,.30),(-.30,py,.30),(-.30,py,.13)],.024,mat='edge',vertices=8)
    return m.root


def create_accommodation_ladder(part,col,helpers,materials):
    m=Gear(col,helpers,materials);sy=.36;zb=.30;dp=.24;L=3.78;zt=zb+dp
    for side in [-1,1]:
        y=side*sy
        m.box('stringer',(0,y,zb+dp/2),(2*L,.045,dp))
        for z in [zb+.0125,zt-.0125]:m.box('stringer-flange',(0,y+side*.018,z),(2*L,.085,.025),mat='edge')
        for x in [-L,L]:m.box('stringer-end',(x,y,zb+dp/2),(.05,.10,dp+.02),mat='edge')
        # Stanchions folded down along the stringer with the rails collapsed on top of them.
        for k in range(6):
            x=-3.35+k*1.22
            m.box('stanchion-hinge',(x,y,zt+.03),(.10,.07,.06),mat='edge')
            m.rod('folded-stanchion',(x,y,zt+.045),(x+.98,y,zt+.085),.019,mat='edge',vertices=8)
        m.rod('handrail',(-3.40,y,zt+.125),(3.55,y,zt+.125),.022,mat='edge',vertices=8)
        m.rod('mid-rail',(-3.40,y+side*.055,zt+.075),(3.55,y+side*.055,zt+.075),.016,mat='edge',vertices=8)
        m.lathe('lifting-pad',[(0,.07),(side*.035,.07)],(1.05,y+side*.0225,zb+dp/2),'y',n=12,mat='edge')
        m.ring('lifting-eye',(1.05,y+side*.075,zb+dp/2+.02),.04,.012,'y',count=12,mat='edge')
    # Treads: set for a ~38 degree working angle, so they lie canted when the ladder is stowed flat.
    count=25
    for i in range(count):
        x=-3.55+i*7.10/(count-1)
        tread=m.box('tread',(x,0,zb+dp/2),(.25,2*sy-.045,.028),mat='roof');tread.rotation_euler=(0,math.radians(38),0)
        nose=m.box('tread-nosing',(x+.098,0,zb+dp/2-.077),(.03,2*sy-.045,.034),mat='edge');nose.rotation_euler=(0,math.radians(38),0)
    # Upper platform folded back over the inboard end; lower platform folded over the outboard end.
    def platform(name,x0,x1,half,z):
        m.box(name+'-grating',((x0+x1)/2,0,z),(x1-x0-.06,2*half-.06,.03),mat='roof')
        for x in [x0+.03,x1-.03]:m.box(name+'-frame',(x,0,z),(.06,2*half,.06),mat='edge')
        for side in [-1,1]:m.box(name+'-frame',((x0+x1)/2,side*(half-.03),z),(x1-x0,.06,.06),mat='edge')
        bars=round((x1-x0)/.11)
        for i in range(1,bars):
            x=x0+(x1-x0)*i/bars;m.box(name+'-bar',(x,0,z+.018),(.022,2*half-.12,.012),mat='dark')
    zp=zt+.185
    platform('upper-platform',-3.98,-2.78,.52,zp)
    platform('lower-platform',2.92,3.80,.47,zp)
    for side in [-1,1]:
        for x,h in [(-3.72,.52),(3.72,.47)]:
            m.box('platform-hinge',(x,side*(sy),zt+.075),(.12,.06,.17),mat='edge')
        for x in [-2.95,3.08]:m.box('platform-rest',(x,side*sy,zt+.10),(.08,.10,.115),mat='roof')
    m.cyl('turntable',(-3.90,0,zt+.06),.15,.12,mat='edge',vertices=20)
    m.rod('turntable-pin',(-3.90,0,zt-.06),(-3.90,0,zp+.06),.04,mat='dark',vertices=10)
    m.box('head-crossbar',(-3.80,0,zb+dp/2),(.08,2*sy,.16),mat='edge')
    # Fender roller at the foot.
    m.rod('foot-roller',(3.90,-sy+.03,zb+.09),(3.90,sy-.03,zb+.09),.085,mat='roof',vertices=16)
    m.rod('roller-axle',(3.90,-sy-.05,zb+.09),(3.90,sy+.05,zb+.09),.022,mat='edge',vertices=8)
    for side in [-1,1]:m.hexa('roller-bracket',[(L-.05,side*sy-.02,zb),(3.98,side*sy-.02,zb+.03),(3.98,side*sy+.02,zb+.03),(L-.05,side*sy+.02,zb)]+[(L-.05,side*sy-.02,zt),(3.98,side*sy-.02,zb+.16),(3.98,side*sy+.02,zb+.16),(L-.05,side*sy+.02,zt)],mat='edge')
    # Two deck chocks with lashings.
    for x in [-2.20,2.20]:
        m.box('chock-sole',(x,0,.015),(.34,1.16,.03),mat='edge')
        m.box('chock',(x,0,.03+(zb-.03)/2),(.18,1.04,zb-.03),mat='roof')
        for side in [-1,1]:
            m.box('chock-horn',(x,side*(sy+.10),zb+.08),(.18,.08,.16),mat='roof')
            for dx in [-.12,.12]:m.hexbolt((x+dx,side*.53,.04),.018,.022)
            m.ring('lashing-eye',(x+.15,side*.50,.06),.035,.011,'x',count=12,mat='edge')
        xs=x+.15;top=zt+.16
        m.tube('lashing',[(xs,-.50,.07),(xs,-.47,top-.06),(xs,-.43,top),(xs,.43,top),(xs,.47,top-.06),(xs,.50,.07)],.013,sides=6,mat='dark')
        for side in [-1,1]:m.rod('lashing-screw',(xs,side*.494,.16),(xs,side*.481,.34),.024,mat='edge',vertices=8)
    return m.root

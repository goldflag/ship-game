"""Original Mogami raised decks, tower and swept uptakes; definition-driven surfaces.

All coordinates below are forward/port/up metres. No external geometry is loaded.
"""
import math
import bpy
from mathutils import Vector
from blender_fidelity import authored_structure, Fittings


def create_superstructure(d, col, helpers, materials, deck):
    owner='superstructure'
    def make(kind,*args,**kwargs):
        o=helpers[kind](*args,col=col,**kwargs);o['assemblyId']=owner;return o
    def mesh(name,v,f,mat='naval',smooth=False):return make('mesh',name,v,f,mat,smooth=smooth)
    def box(name,p,size,mat='naval'):return make('box',name,p,size,mat)
    def rod(name,a,b,r,mat='edge',vertices=10):return make('rod',name,a,b,r,mat,vertices=vertices)
    def cyl(name,p,r,h,mat='naval',vertices=32,r2=None):return make('cyl',name,p,r,h,mat,vertices=vertices,r2=r2)
    def plate(name,pts,z,h=.08,mat='roof'):
        n=len(pts);v=[(x,y,zz) for zz in (z,z+h) for x,y in pts]
        return mesh(name,v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat)
    def ellipse(name,x,y,z,rx,ry,h,mat='roof',n=32):return plate(name,[(x+rx*math.cos(i*math.tau/n),y+ry*math.sin(i*math.tau/n)) for i in range(n)],z,h,mat)
    def rail(name,pts,z,h=.8,closed=True):
        for a,b in zip(pts,pts[1:]+([pts[0]] if closed else [])):
            for zz in (z+h*.45,z+h):rod(name+' wire',(*a,zz),(*b,zz),.016,vertices=6)
            n=max(1,math.ceil(math.dist(a,b)/1.35))
            for i in range(n):
                p=(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n)
                rod(name+' post',(*p,z),(*p,z+h),.028,'naval',vertices=6)
    def rim(name,pts,z,h):
        for a,b in zip(pts,pts[1:]+[pts[0]]):
            o=box(name,((a[0]+b[0])/2,(a[1]+b[1])/2,z+h/2),(math.dist(a,b),.055,h));o.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
    def porthole(name,x,y,z,side=1,r=.14):
        rod(name+' dark glass',(x,y,z),(x,y+side*.035,z),r,'dark',vertices=16)
        pts=[(x+r*1.1*math.cos(i*math.tau/16),y+side*.05,z+r*1.1*math.sin(i*math.tau/16)) for i in range(16)]
        for a,b in zip(pts,pts[1:]+[pts[0]]):rod(name+' frame',a,b,.022,'edge',vertices=6)
    # Helpers for Fittings include explicit material/collection arguments; use the original helpers.
    fit=Fittings(helpers,dict(**materials,teak=materials['wood']),col)
    deck_parts=[]
    for s in d['structures']:
        owner=s['id']
        if owner in ['forward-funnel','after-funnel']:continue
        o=authored_structure(s,helpers['mesh'],materials,col)
        if owner.startswith('central-deck'):
            o.data.materials.append(materials['linoleum'])
            for p in o.data.polygons:
                if p.normal.z>.8:p.material_index=1
            deck_parts.append(s);continue
        pts=[(-z,-x) for x,z in s['footprint']];top=s['baseY']+s['height']
        if not s.get('surface'):plate(owner+' deck edge',pts,top,.055)
        if owner.startswith('secondary-platform'):
            x=sum(a for a,b in pts)/len(pts);y=sum(b for a,b in pts)/len(pts)
            outline=[(x+2.9*math.cos(i*math.tau/24),y+2.47*math.sin(i*math.tau/24)) for i in range(24)]
            plate('127 mm sponson deck',outline,7.24,.09)
            rim('127 mm sponson shield',outline,7.33,1.10)
            # The rounded lower skirt has a real connection to the central deck edge.
            v=[(x+rx*math.cos(i*math.tau/24),y+ry*math.sin(i*math.tau/24),z) for rx,ry,z in [(2.4,1.85,6.31),(2.9,2.47,7.24)] for i in range(24)]
            mesh('127 mm sponson bracket shell',v,[(i,(i+1)%24,(i+1)%24+24,i+24) for i in range(24)],'naval')
        elif owner.startswith('aa-platform') or owner=='bridge-forward-aa-platform':
            rim(owner+' shield',pts,top,.62)
            x=sum(a for a,b in pts)/len(pts);y=sum(b for a,b in pts)/len(pts)
            for xx in (x-.7,x+.7):rod('AA deck bracket',(xx,y*.66,7.3),(xx,y,s['baseY']),.11,'naval')
    # Raised-deck edge, brass strips and companionways follow its actual sheer.
    stations=sorted(set((-s['surface']['vertices'][i][2],abs(s['surface']['vertices'][i][0]),s['surface']['vertices'][i][1]) for s in deck_parts for i in range(2,len(s['surface']['vertices']),4)))
    owner='central-deck-forward'
    def level(x):
        for a,b in zip(stations,stations[1:]):
            if a[0]<=x<=b[0]:
                t=(x-a[0])/(b[0]-a[0]);return a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])
        return 0,7.3
    for x in range(-48,42,3):
        w,z=level(x);box('Central deck brass retaining strip',(x,0,z+.025),(.027,max(.1,2*w-.34),.018),'strip')
    for sign in (-1,1):
        for a,b in zip(stations,stations[1:]):
            length=math.dist(a[:2],b[:2]);n=max(1,math.ceil(length/1.5))
            for i in range(n):
                x=a[0]+(b[0]-a[0])*i/n;w,z=level(x)
                if -10<x<11:continue # uninterrupted openings into the gun sponsons
                rod('Central deck railing post',(x,sign*(w-.09),z),(x,sign*(w-.09),z+.8),.026,'naval',vertices=6)
            for i in range(n):
                xa=a[0]+(b[0]-a[0])*i/n;xb=a[0]+(b[0]-a[0])*(i+1)/n
                if -11<(xa+xb)/2<11:continue
                wa,za=level(xa);wb,zb=level(xb)
                for h in (.4,.8):rod('Central deck railing wire',(xa,sign*(wa-.09),za+h),(xb,sign*(wb-.09),zb+h),.017,vertices=6)
        fit.stairs('Forward raised-deck companionway',(40,sign*6.3,4.72),(36,sign*6.3,7.25),.72)
        fit.stairs('After raised-deck companionway',(-50.6,sign*6.2,5.1),(-46.7,sign*6.2,7.55),.72)
        # Continuous fascia; the torpedo bay stays open below the handling deck.
        for x in range(-38,-9,3):
            w,z=level(x);porthole('Raised deck scuttle',x,sign*(w+.012),z-.32,sign,.11)
    # Place details on the authored tower facets, including its changing lower width.
    bridge_triangles=[]
    for part in d['structures']:
        if part['id'] not in ['bridge-foundation','bridge-lower','bridge-upper']:continue
        vs=[(-z,-x,y) for x,y,z in part['surface']['vertices']]
        bridge_triangles.extend([[vs[i] for i in face] for face in part['surface']['triangles']])
    def tower_width(x,z):
        ys=[]
        for a,b,c in bridge_triangles:
            det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
            if abs(det)<1e-8:continue
            u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det
            v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det
            if min(u,v,1-u-v)>=-.0001:ys.append(abs(u*a[1]+v*b[1]+(1-u-v)*c[1]))
        return max(ys,default=0)
    owner='bridge-fittings'
    # Open observation wings wrap the narrower tapered tower, rather than another box tier.
    for sign in (-1,1):
        pts=[(20.3,sign*2.1),(20.4,sign*4.0),(24.8,sign*4.0),(25.7,sign*3.1),(25.5,sign*2.25)]
        plate('Observation wing',pts,15.60,.10);rail('Observation wing',pts,15.7,.82)
        for x in (21.1,24.0):rod('Wing underside bracket',(x,sign*2.2,13.7),(x,sign*3.8,15.6),.11,'naval')
        for x in (21.4,23.6):
            cyl('Lookout pedestal',(x,sign*3.25,14.35),.28,.5)
            box('Lookout housing',(x,sign*3.25,14.8),(.7,.6,.65))
            cyl('Binocular column',(x,sign*3.1,16.12),.07,.85,'naval',12)
            for dy in (-.10,.10):rod('Binocular optic',(x-.22,sign*3.1+dy,16.53),(x+.3,sign*3.1+dy,16.53),.075,'edge',vertices=12)
        # Side director wings and the large diagonal supporting tubes.
        pts=[(19,sign*3),(20,sign*7.5),(21.7,sign*8.5),(24,sign*6.2),(24.2,sign*3)]
        plate('Director wing deck',pts,9.64,.20);rail('Director wing deck',pts,9.84,.62)
        rod('Director wing diagonal',(21.25,sign*3.4,7.3),(21.25,sign*7.2,9.7),.25,'naval',vertices=16)
        cyl('Side director column',(21.25,sign*7.23,10.2),.59,.72)
        cyl('Side director enclosure',(21.25,sign*7.23,10.87),1.14,1.04)
        cyl('Side director sloped cap',(21.25,sign*7.23,11.49),1.13,.25,r2=.95)
        for x in (23,26.2,28.0):
            for z in (8.25,10.6,13.1,14.7):
                yy=tower_width(x,z)
                if yy:porthole('Bridge scuttle',x,sign*(yy+.012),z,sign)
        fit.ladder('Bridge access ladder',(21.0,sign*2.7,9.84),(21.0,sign*2.7,15.60),.55)
        for x in (23.0,26.2):
            rod('Bridge vertical seam',(x,sign*(tower_width(x,12.0)+.02),12.0),(x,sign*(tower_width(x,14.0)+.02),14.0),.012,'edge',vertices=6)
        # Smaller rear optics remain on fully supported platforms.
        ellipse('Optical platform',14.85,sign*5.16,12.08,2.1,1.0,.14)
        rod('Optical platform support',(14.85,sign*2.7,7.3),(14.85,sign*5.16,12.08),.2,'naval')
        cyl('Optical platform stem',(14.85,sign*5.16,12.37),.4,.44)
        rod('Side rangefinder',(13.2,sign*5.16,12.72),(16.55,sign*5.16,12.72),.19,'naval',vertices=20)
    nav=next(s for s in d['structures'] if s['id']=='bridge-navigation');pts=[(-z,-x) for x,z in nav['footprint']]
    for a,b in zip(pts,pts[1:]+pts[:1]):
        length=math.dist(a,b);n=max(1,round(length/.52))
        for i in range(n):
            t=(i+.5)/n;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            o=box('Navigation bridge window',(x,y,17.02),(length/n*.8,.055,.62),'glass');o.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
        for z in (16.65,17.40):rod('Window band sill',(*a,z),(*b,z),.045,'edge')
    compass=next(s for s in d['structures'] if s['id']=='bridge-compass');pts=[(-z,-x) for x,z in compass['footprint']]
    rim('Open compass deck parapet',pts,18.35,.62)
    for y in (-1.0,1.0):
        cyl('Compass binocular stand',(28.2,y,18.88),.08,1.08,'naval',12)
        for yy in (y-.11,y+.11):rod('Compass binocular',(28.0,yy,19.48),(28.5,yy,19.48),.08,'edge',vertices=12)
    # The rangefinder cabin is a broad drum with an upper director, not a tall plain cylinder.
    owner='main-director';x=23.88
    cyl('Director trunk',(x,0,17.32),1.6,3.24)
    cyl('Rangefinder rotating seat',(x,0,19.1),1.67,.30,'edge')
    cyl('Rangefinder lower drum',(x,0,19.68),1.65,.9)
    box('Rangefinder cabin',(x+.12,0,20.46),(3.72,3.2,1.20))
    cyl('Rangefinder cabin roof',(x,0,21.15),1.6,.19,'roof')
    rod('Six metre rangefinder',(x,-3.25,20.05),(x,3.25,20.05),.30,'naval',vertices=24)
    for y in (-3.25,3.25):
        rod('Rangefinder armored optical end',(x,y-.15,20.05),(x,y+.15,20.05),.37,'edge',vertices=20)
        box('Rangefinder optical slit',(x+.28,y,20.05),(.06,.23,.22),'glass')
    cyl('Type 95 upper director base',(x,0,21.37),1.38,.44)
    cyl('Type 95 director body',(x,0,22.0),1.35,.88)
    cyl('Type 95 director sloping roof',(x,0,22.62),1.35,.35,'roof',r2=1.12)
    for y in (-.78,0,.78):box('Director front window',(x+1.20,y,22.1),(.07,.46,.43),'glass')
    for y in (-1.63,1.63):
        porthole('Rangefinder cabin scuttle',x-.1,y,20.48,1 if y>0 else -1,.17)
    # Swept, joined funnel profiles are authored surfaces in the same runtime definition.
    for s in d['structures']:
        if s['id'] not in ['forward-funnel','after-funnel']:continue
        owner=s['id'];n=40;v=[(-z,-x,y) for x,y,z in s['surface']['vertices']]
        o=mesh(s['name']+' curved jacket',v,s['surface']['triangles'],'naval',True);o['nodeId']=owner+'.surface'
        solid=o.modifiers.new('Funnel jacket thickness','SOLIDIFY');solid.thickness=.065
        rings=[v[i:i+n] for i in range(0,len(v),n)];mouth=rings[-1]
        # A black sloping lining and arched spark guards follow the mouth instead of covering it.
        cx=sum(p[0] for p in mouth)/n
        inner=[(cx+(x-cx)*.955,y*.955,z-.85) for x,y,z in mouth]
        mesh(s['name']+' soot interior',inner,[tuple(range(n))],'dark')
        collar=[(x,y,z-.60) for x,y,z in mouth]+mouth
        mesh(s['name']+' blackened cap',collar,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'dark',True)
        for a,b in zip(mouth,mouth[1:]+mouth[:1]):rod('Funnel cap lip',a,b,.065,'edge')
        a=min(p[0] for p in mouth);b=max(p[0] for p in mouth);z=sum(p[2] for p in mouth)/n
        for yy in (-1.0,0,1.0):
            pts=[(a+.25+(b-a-.5)*i/8,yy,z+.24*(a+.25+(b-a-.5)*i/8-cx)+.33*math.sin(math.pi*i/8)) for i in range(9)]
            for q,r in zip(pts,pts[1:]):rod('Arched funnel spark guard',q,r,.034,'edge',vertices=8)
            for endpoint in (pts[0],pts[-1]):
                seat=min(mouth,key=lambda q:math.dist(q,endpoint))
                rod('Spark guard rim bracket',seat,endpoint,.04,'edge',vertices=8)
        for xx in (a+.75,cx,b-.75):rod('Funnel transverse grille',(xx,-1.65,z+.24*(xx-cx)+.18),(xx,1.65,z+.24*(xx-cx)+.18),.031,'edge',vertices=8)
        for ring in rings[1:-1:2]:
            for a,b in zip(ring,ring[1:]+ring[:1]):rod('Funnel jacket seam',a,b,.018,'edge',vertices=6)
        # Slender steam pipes and saddles follow the uptake curve on both sides.
        for sign in (-1,1):
            for offset in (-.5,.5):
                pts=[]
                for ring in rings:
                    x=sum(p[0] for p in ring)/n+offset;y=sign*(max(abs(p[1]) for p in ring)+.13);zz=sum(p[2] for p in ring)/n-.45
                    pts.append((x,y,zz))
                for a,b in zip(pts,pts[1:]):rod('Funnel steam pipe',a,b,.078,'naval',vertices=10)
                for x,y,z in pts[1::2]:rod('Steam pipe saddle',(x,y,z),(x,y-sign*.18,z),.034,'edge',vertices=6)
                rod('Steam pipe perforated cowl',pts[-1],(pts[-1][0],pts[-1][1],pts[-1][2]+.35),.115,'edge',vertices=12)
        ladder=[]
        for ring in rings:
            q=max(ring,key=lambda p:p[0]);ladder.append((q[0]+.065,0,q[2]))
        for a,b in zip(ladder,ladder[1:]):
            for yy in (-.25,.25):rod('Curved uptake ladder stringer',(a[0],yy,a[2]),(b[0],yy,b[2]),.028,'edge',vertices=6)
            n=max(1,math.ceil(math.dist(a,b)/.32))
            for i in range(n):
                x=a[0]+(b[0]-a[0])*i/n;z=a[2]+(b[2]-a[2])*i/n
                rod('Uptake ladder rung',(x,-.25,z),(x,.25,z),.023,'edge',vertices=6)
            rod('Uptake ladder attachment',(a[0],0,a[2]),(a[0]-.08,0,a[2]),.032,'naval',vertices=6)
    owner='funnel-aa-gallery'
    for sign in (-1,1):
        pts=[(-8.0,sign*3.0),(-7.7,sign*5.7),(2.7,sign*5.7),(3.0,sign*3.0)]
        plate('Funnel AA gallery side',pts,9.78,.11)
        for x in (-7.2,-1.0,2.0):
            rod('Gallery supporting column',(x,sign*3.9,7.32),(x,sign*3.9,9.78),.15,'naval',vertices=12)
        rail('AA gallery outer rail',[(x,sign*5.65) for x in (-7.6,-3.0,2.6)],9.89,.65,False)
        fit.stairs('Gallery access',(-11.0,sign*4.0,7.33),(-7.8,sign*4.0,9.89),.63)
    plate('Funnel gallery aft crosswalk',[(-8.0,-5.7),(-8.0,5.7),(-6.5,5.7),(-6.5,-5.7)],9.78,.11)
    # Aft director: low cabin, paired window bands and a compact raised hood.
    owner='aft-director';x=-18.68
    box('After navigation windows',(x+2.9,0,10.95),(.05,4.4,.55),'glass')
    cyl('After director lower ring',(x,0,11.7),1.38,.45)
    cyl('After director body',(x,0,12.78),1.36,1.70)
    cyl('After director rounded cap',(x,0,13.85),1.35,.44,'roof',r2=1.05)
    for y in (-.72,0,.72):box('After director window',(x+1.24,y,13.05),(.07,.42,.40),'glass')

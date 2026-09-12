"""Original Cleveland topside fittings, proportioned to the approved Hull A."""
import math
import bpy
from mathutils import Matrix
from blender_fidelity import Fittings, loft_breadth
from blender_rig import radar_pivot

def build_fittings(D,helpers,materials,col,deck_height):
    mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
    naval,roof,dark=(materials[k] for k in ['naval','roof','dark'])
    F=Fittings(helpers,materials,col)
    def tag(obj,name):obj['assemblyId']=name;return obj
    def beam(name,a,b,r=.06,mat=None):return tag(rod(name,a,b,r,mat or naval,col,vertices=8),name.split('.')[0])
    def ringwall(name,x,y,z,r,height=.85,start=0,end=360):
        n=max(8,round((end-start)/10));vv=[]
        for radius,h in [(r,0),(r,height),(r-.09,height),(r-.09,0)]:
            for i in range(n+1):
                a=math.radians(start+(end-start)*i/n);vv.append((x+radius*math.cos(a),y+radius*math.sin(a),z+h))
        k=n+1;ff=[]
        for j in range(3):
            for i in range(n):ff.append((j*k+i,j*k+i+1,(j+1)*k+i+1,(j+1)*k+i))
        ff.extend([(0,k,2*k,3*k),(n,k+n,2*k+n,3*k+n)])
        tag(mesh(name,vv,ff,naval,col),name)
    # Thin protective bulwarks leave the mount's mechanism unobstructed.
    for m in D['mounts']:
        if not m['id'].startswith('aa-'):continue
        x,y,z=-m['position'][2],-m['position'][0],m['position'][1]
        heavy=m['weapon']['caliberM']>.03
        r=({7:2.6,8:2.6,11:2.73,12:2.73,13:2.73,14:2.73,24:2.58,25:2.58}.get(int(m['id'][3:]),2.4)) if heavy else .95
        if m['id'] in ['aa-19','aa-20','aa-3','aa-4','aa-5','aa-6','aa-15','aa-16','aa-17','aa-18','aa-26','aa-27','aa-28','aa-29','aa-30','aa-31']:continue
        start,end={7:(310,550),8:(170,410),11:(335,655),12:(65,385),13:(270,600),14:(120,450),24:(20,245),25:(115,340)}.get(int(m['id'][3:]),(0,360))
        ringwall(m['id']+'.splinter tub',x,y,z,r,.72 if heavy else .85,start,end)
    # Tripod legs, fighting tops, yards and separate antenna poles.
    for name,x,bottom,top in [('foremast',10.9,8.27,28.1),('mainmast',-12,10.5,27)]:
        head=(x-1.2,0,top)
        for px,py in [(x+1,0),(x-3.1,-2.15),(x-3.1,2.15)]:
            beam(name+'.leg',(px,py,bottom),head,.19)
        tag(cyl(name+'.top',(head[0],0,top),1.4,.16,roof,col,24),name)
        yardx,yardz,span=(9.756,28.186,8.38) if name=='foremast' else (-11.30,26.852,5.07)
        beam(name+'.yard root',head,(yardx,0,yardz),.13)
        beam(name+'.yard',(yardx,-span,yardz),(yardx,span,yardz),.12)
        for y in [-span,-span*.55,span*.55,span]:
            beam(name+'.yard brace',(x,0,top-3.5),(yardx,y,yardz),.045)
            beam(name+'.signal halyard',(yardx,y,yardz),(x+1,y*.42,bottom+6),.018,dark)
        if name=='foremast':
            beam(name+'.antenna pole',(8.29,0,bottom+2),(7.19,0,34.62),.10)
            beam(name+'.pole brace',head,(7.19,0,33.62),.025)
        else:
            # The selected A mast carries the TDY pole forward of its fighting top.
            beam(name+'.upper bearer',head,(-9.14,0,27),.13)
            beam(name+'.upper bearer knee',(-11,0,24.2),(-9.14,0,27),.09)
            beam(name+'.antenna pole',(-9.14,0,27),(-9.14,0,33.914),.11)
            beam(name+'.pole brace',(-8.2,0,27),(-8.85,0,33.7),.025)
            beam(name+'.brace foot',(-9.14,0,27),(-8.2,0,27),.065)
            tag(cyl(name+'.pole cap',(-9.14,0,33.83),.31,.17,naval,col,16),name)
        F.ladder(name+'.ladder',(x+.2,.32,bottom+1),(head[0]+.2,.32,top-.2),.45)
    # Original TDY fan aerial: mast bearing, angled spine and thirteen dipoles.
    name='aerial-tdy';x,z=-9.14,33.914
    tag(cyl(name+'.bearing',(x,0,z+.29),.19,.58,naval,col,16),name)
    beam(name+'.column',(x,0,z+.5),(x-.35,0,z+2.45),.055)
    for y in [-.17,.17]:
        beam(name+'.lower spine',(x,y,z+1.08),(x-.35,y,z+2.25),.022)
        beam(name+'.upper spine',(x-.35,y,z+2.25),(x,y,z+3.427),.022)
        beam(name+'.hub brace',(x+.30,0,z+2.25),(x-.35,y,z+2.25),.035)
    for i in range(13):
        h=1.10+i*(3.39-1.10)/12
        xx=x-.35*(1-abs(h-2.25)/1.175)
        beam(name+'.dipole',(xx,-1.3455,z+h),(xx,1.3455,z+h),.017)
    beam(name+'.cross arm',(x+.30,-.72,z+2.25),(x+.30,.72,z+2.25),.022)
    # Mk.34 rangefinder director heads and cylindrical support trunks.
    for ident,x,z in [('forward',16.51,21.27),('after',-16.01,19.94)]:
        name='mk34-'+ident
        tag(cyl(name+'.bearing',(x,0,z+.15),1.22,.30,naval,col,32),name)
        tag(cyl(name+'.head',(x-.1,0,z+.91),1.45,1.52,naval,col,16),name)
        tag(box(name+'.roof',(x-.1,0,z+1.70),(2.6,2.45,.18),roof,col),name)
        beam(name+'.rangefinder',(x, -2.92,z+1.18),(x,2.92,z+1.18),.22)
        for y in [-2.75,2.75]:
            tag(box(name+'.optic',(x+.13,y,z+1.19),(.55,.34,.48),naval,col),name)
            tag(box(name+'.glass',(x+.415,y,z+1.19),(.025,.24,.31),dark,col),name)
        F.ladder(name+'.access',(x-1.55,0,z-2),(x-1.55,0,z+1.7),.5)
    # Mk.37 enclosed directors, with sloped front and sight apertures.
    for ident,x,z,bearing in [('forward',23.55,17.35,0),('after',-23.32,15.48,180)]:
        name='mk37-'+ident;sign=1 if bearing==0 else -1
        tag(cyl(name+'.bearing',(x,0,z+.2),1.55,.4,naval,col,24),name)
        vv=[(x+sign*a,b,z+c) for a,b,c in [(-1.65,-1.7,.35),(-1.65,1.7,.35),(1.8,1.7,.35),(1.8,-1.7,.35),(-1.65,-1.6,2.3),(-1.65,1.6,2.3),(.7,1.6,2.45),(.7,-1.6,2.45)]]
        tag(mesh(name+'.house',vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],naval,col),name)
        beam(name+'.rangefinder',(x,-2.39,z+1.1),(x,2.39,z+1.1),.19)
        for y in [-1.0,0,1.0]:
            tag(box(name+'.sight',(x+sign*1.17,y,z+1.83),(.3,.38,.3),dark,col),name)
    # Rectangular SK antenna, open lattice and rear structural braces.
    x,z=10.99,28.13;name='radar-sk'
    tag(cyl(name+'.pedestal',(x,0,z+.3),.40,.6,naval,col,20),name)
    for y in [-2.55,2.55]:beam(name+'.frame',(x,y,z+.6),(x,y,z+5.8),.055)
    for h in [0.6+i*.43 for i in range(13)]:beam(name+'.horizontal',(x,-2.55,z+h),(x,2.55,z+h),.023)
    for y in [-2.55+i*.425 for i in range(13)]:beam(name+'.vertical',(x,y,z+.6),(x,y,z+5.8),.023)
    for h in [.6,3.2,5.8]:
        beam(name+'.rear brace',(x-1,0,z+2.5),(x,-2.55,z+h),.055)
        beam(name+'.rear brace',(x-1,0,z+2.5),(x,2.55,z+h),.055)
    # SG rotating search aerial on the fore pole and SM lattice aft.
    for name,x,z,w,h in [('radar-sg',7.19,34.62,1.28,1.23),('radar-sm',-11.96,26.98,2.46,2.91)]:
        tag(cyl(name+'.base',(x,0,z+.22),.23,.44,naval,col,16),name)
        beam(name+'.stem',(x,0,z),(x,0,z+h),.075)
        for i in range(7):
            hh=.55+(h-.55)*i/6
            beam(name+'.grid',(x,-w/2,z+hh),(x,w/2,z+hh),.026)
        for y in [-w/2,0,w/2]:beam(name+'.upright',(x,y,z+.55),(x,y,z+h),.03)

    # Mk.51 local AA directors: pedestal, hand grips, optical head and foot plates.
    stations=[(-4.392,15.039,17.679),(4.392,15.039,17.679),(-4.674,15.039,15.236),(4.674,15.039,15.236),(-3.696,15.338,4.587),(3.696,15.338,4.587),(-3.06,14.973,-10.86),(3.06,14.973,-10.86),(2.841,12.803,-23.838),(-2.841,12.803,-24.234)]
    for i,(sx,z,x) in enumerate(stations):
        y=-sx;name=f'mk51-{i+1}'
        floor=z
        if i in [4,5,6,7]:
            anchorx=3.5 if i in [4,5] else -14
            anchory=math.copysign(1.65,y) if i in [4,5] else y
            tag(cyl(name+'.platform',(x,y,z-.1),.8,.2,roof,col,24),name)
            beam(name+'.platform bearer',(anchorx,anchory,z-.15),(x,y,z-.15),.14)
            beam(name+'.platform knee',(anchorx,anchory,z-1.7),(x,y,z-.2),.10)
        tag(cyl(name+'.foot',(x,y,floor+.075),.38,.15,naval,col,20),name)
        tag(cyl(name+'.column',(x,y,floor+.58),.13,1.05,naval,col,16),name)
        tag(box(name+'.instrument',(x-.07,y,floor+1.25),(.65,.60,.42),naval,col),name)
        for sy in [-.21,.21]:
            beam(name+'.eyepiece',(x+.1,y+sy,floor+1.50),(x+.3,y+sy,floor+1.56),.08,dark)
            beam(name+'.handgrip',(x-.28,y+sy,floor+1.1),(x-.42,y+sy,floor+.93),.035)
        tag(box(name+'.operator step',(x-.44,y,floor+.12),(.4,.56,.12),roof,col),name)
    # Deck-edge stanchions and three continuous rails follow the authored sheer.
    stations=D['hull']['sections']
    points=[(s['station']-D['hull']['length']/2,s['points'][-1][0],s['points'][-1][1]) for s in stations]
    for sign in [-1,1]:
        edge=[]
        for a,b in zip(points,points[1:]):
            n=max(1,math.ceil((b[0]-a[0])/2.5))
            for i in range(n):
                t=i/n;x=a[0]+(b[0]-a[0])*t;y=sign*max(0,a[1]+(b[1]-a[1])*t-.15);z=a[2]+(b[2]-a[2])*t
                if abs(x)>90:continue
                edge.append((x,y,z))
                beam('deck-rail.stanchion',(x,y,z),(x,y,z+.96),.026)
        for a,b in zip(edge,edge[1:]):
            for h in [.32,.64,.96]:beam('deck-rail.wire',(a[0],a[1],a[2]+h),(b[0],b[1],b[2]+h),.016)
    # Deckhouse openings and attached doors; no texture planes hovering off the hull.
    for ident,x,z in [('forward-deckhouse',30,6.3),('forward-deckhouse',20,6.1),('center-deckhouse',6,6.1),('center-deckhouse',-7,6.1),('after-deckhouse',-23,6.1),('after-deckhouse',-30,6.2)]:
        structure=next(s for s in D['structures'] if s['id']==ident)
        poly=[(-zz,-xx) for xx,zz in structure['footprint']]
        for offset,kind in [(0,'door'),(1.5,'vent')]:
            xx=x+offset;hits=[]
            for a,b in zip(poly,poly[1:]+poly[:1]):
                if min(a[0],b[0])<=xx<=max(a[0],b[0]) and abs(a[0]-b[0])>1e-6:
                    t=(xx-a[0])/(b[0]-a[0]);yy=a[1]+t*(b[1]-a[1])
                    if yy>0:hits.append((yy,(b[1]-a[1])/(b[0]-a[0])))
            yy,slope=max(hits)
            for sign in [-1,1]:
                before=set(col.objects)
                if kind=='door':F.door('deckhouse door',0,sign*.01,z,.72,1.55)
                else:F.vent('deckhouse louver',0,sign*.01,z+.65,.75,.65)
                transform=Matrix.Translation((xx,sign*yy,0))@Matrix.Rotation(math.atan(sign*slope),4,'Z')
                for obj in set(col.objects)-before:obj.matrix_world=transform@obj.matrix_world;tag(obj,ident)
    for x in [14,16,18,20,22,24]:
        for y in [-2.185,2.185]:
            F.ring('bridge scuttle',(x,y,10.05),.17,.034,'y',segments=12)
            ob=cyl('bridge scuttle glass',(x,y,10.05),.135,.025,dark,col,16);ob.rotation_euler.x=math.pi/2;tag(ob,'forward-bridge-lower')
    # Capstans, paired bitts, anchor cable runs and chain stoppers on the forecastle.
    for x in [71,78]:
        z=deck_height(x)
        for y in [-1.4,1.4]:
            tag(cyl('capstan.base',(x,y,z+.15),.64,.3,naval,col,24),'deck-capstans')
            tag(cyl('capstan.drum',(x,y,z+.58),.35,.7,dark,col,24),'deck-capstans')
            tag(cyl('capstan.head',(x,y,z+.97),.55,.12,naval,col,24),'deck-capstans')
    for x in [-83,-65,83]:
        for y in [-2.1,2.1]:
            z=deck_height(x)
            tag(box('bitts.foundation',(x,y,z+.08),(1.6,.65,.16),naval,col),'deck-bitts')
            for dx in [-.5,.5]:
                tag(cyl('bitts.post',(x+dx,y,z+.42),.17,.68,naval,col,16),'deck-bitts')
                tag(cyl('bitts.cap',(x+dx,y,z+.78),.23,.08,naval,col,16),'deck-bitts')
    for sign in [-1,1]:
        for i in range(33):
            x=72+i*.32;y=sign*1.45;z=deck_height(x)+.10
            F.ring('anchor cable',(x,y,z),.105,.029,'z' if i%2 else 'y',segments=8)
    # Original stockless anchors: forged shank, crown pin and paired flukes.
    # Rounded installation frames preserve the reference's seated hawse position.
    for sign in [-1,1]:
        name='anchor-'+('port' if sign>0 else 'starboard')
        center=(84.91,sign*2.94,5.40)
        upper=[(.881,-sign*.104,-sign*.46),(-sign*.375,.44,-.816),(sign*.288,.892,.349)]
        lower=[(.958,-sign*.317,sign*.0215),(sign*.13,.328,-.946),(sign*.29,.900,.352)]
        def point(v,frame):
            # Frame basis is lateral/up/forward; authored anchor dimensions are metres.
            lat=sum(v[k]*frame[k][0] for k in range(3))
            up=sum(v[k]*frame[k][1] for k in range(3))
            forward=sum(v[k]*frame[k][2] for k in range(3))
            return (center[0]+forward,center[1]+lat,center[2]+up)
        vv=[point((x,y,z),upper) for x,y,z in [(-.14,0,-.13),(-.14,3.75,-.13),(.14,3.75,-.13),(.14,0,-.13),(-.14,0,.13),(-.14,3.75,.13),(.14,3.75,.13),(.14,0,.13)]]
        tag(mesh(name+'.shank',vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],dark,col),name)
        tag(rod(name+'.crown pin',point((-.36,0,0),lower),point((.36,0,0),lower),.48,dark,col,vertices=16),name)
        for flank in [-1,1]:
            outline=[(.38,-.25),(.98,-.55),(1.18,-.34),(1.02,.12),(.99,1.15),(.80,1.65),(.60,1.40),(.46,.12)]
            vv=[point((thick,y,flank*z),lower) for thick in [-.13,.13] for z,y in outline]
            count=len(outline);ff=[tuple(reversed(range(count))),tuple(range(count,2*count))]
            ff.extend([(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)])
            tag(mesh(name+'.fluke',vv,ff,dark,col),name)
        F.ring(name+'.hawse lip',(82.1,sign*1.45,deck_height(82.1)+.035),.25,.065,'z',segments=20)
    # Original lattice handling crane at the stern, supported by a rotating pedestal.
    name='stern-crane';x=-88;z=deck_height(x)
    tag(cyl(name+'.foundation',(x,0,z+.45),.75,.9,naval,col,24),name)
    root=(x,0,z+.9);elbow=(-86.4,0,12.3);tip=(-78.8,0,14.1)
    for a,b,width in [(root,elbow,.75),(elbow,tip,.55)]:
        for y in [-width/2,width/2]:beam(name+'.chord',(a[0],y,a[2]),(b[0],y,b[2]),.09)
        beam(name+'.upper chord',(a[0],0,a[2]+.65),(b[0],0,b[2]+.65),.075)
        for i in range(8):
            t=i/8;u=(i+1)/8
            aa=(a[0]+(b[0]-a[0])*t,(-1 if i%2 else 1)*width/2,a[2]+(b[2]-a[2])*t)
            bb=(a[0]+(b[0]-a[0])*u,(-1 if (i+1)%2 else 1)*width/2,a[2]+(b[2]-a[2])*u)
            beam(name+'.web',aa,bb,.04)
            top=(a[0]+(b[0]-a[0])*u,0,a[2]+(b[2]-a[2])*u+.65)
            beam(name+'.upper web',aa,top,.04)
            beam(name+'.upper post',bb,top,.04)
        beam(name+'.root closure',(a[0],-width/2,a[2]),(a[0],0,a[2]+.65),.055)
        beam(name+'.root closure',(a[0],width/2,a[2]),(a[0],0,a[2]+.65),.055)
    beam(name+'.hoist wire',tip,(tip[0],0,9.6),.025,dark)
    F.ring(name+'.hook',(tip[0],0,9.45),.18,.055,'y',segments=12)
    # Long tapered bilge fins follow the corrected shell rather than floating
    # beside a fixed-width proxy. Their roots penetrate the skin by two centimetres.
    for sign in [-1,1]:
        name='bilge-keel-'+('port' if sign>0 else 'starboard');vv=[]
        for x,z,span in [(-34,-5.05,.04),(-25,-5.20,.85),(-10,-5.55,1.0),(5,-5.45,1.0),(20,-4.80,.85),(31,-4.40,.04)]:
            width=loft_breadth(D['hull'],x,z)-.02
            vv.extend([(x,sign*width,z+.03),(x,sign*(width+span),z-.35+.03),(x,sign*(width+span),z-.35-.03),(x,sign*width,z-.03)])
        ff=[(3,2,1,0),(20,21,22,23)]
        for i in range(5):
            for j in range(4):ff.append((i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j))
        tag(mesh(name,vv,ff,materials['antifouling'],col),name)
    # Four original screws and their shaft runs; locations measured from Hull A fittings.
    for i,(x,y,z,scale) in enumerate([(-58.7805,6.3705,-5.019,.8747),(-75.9075,3.1365,-5.445,.809),(-75.9075,-3.1365,-5.445,.809),(-58.7805,-6.3705,-5.007,.875)]):
        name=f'propeller-{i+1}';sign=1 if y>0 else -1
        root=(-36,sign*5,-4) if abs(y)>4 else (-55,sign*2.2,-4.7)
        beam(name+'.shaft',root,(x,y,z),.17)
        beam(name+'.shaft bracket',(x+3,y,z+.10),(x+3,y*.72,z+2),.18)
        beam(name+'.hub',(x,y,z),(x-1.9*scale,y,z),.30,materials['bronze'])
        radius=1.78*scale
        for blade in range(4):
            angle=blade*math.tau/4;vv=[]
            outline=[(.25,-.12),(.70,-.48),(1.30,-.42),(1.0,.20),(.50,.28)]
            for dx in [-.035,.035]:
                for radial,tangent in outline:
                    radial=radial/1.3*radius;tangent=tangent/1.3*radius*sign
                    vv.append((x-.65*scale+tangent*.55+dx,y+radial*math.cos(angle)-tangent*math.sin(angle),z+radial*math.sin(angle)+tangent*math.cos(angle)))
            ff=[(4,3,2,1,0),(5,6,7,8,9)]+[(j,(j+1)%5,(j+1)%5+5,j+5) for j in range(5)]
            tag(mesh(name+'.blade',vv,ff,materials['bronze'],col,True),name)
    # Centerline rudder blade and stock are joined to the counter stern.
    beam('rudder.stock',(-82,0,-1),(-82,0,-6.6),.20)
    outline=[(-79.8,-2.7),(-85.9,-3.1),(-85.5,-7.1),(-81.2,-7.3)]
    vv=[(x,y,z) for y in [-.16,.16] for x,z in outline]
    tag(mesh('rudder.blade',vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],naval,col),'rudder')

    # Projecting bridge platforms carry thin splinter bulwarks, with cabins set inboard.
    for structure in D['structures']:
        if not structure['id'].endswith('-platform'):continue
        poly=[(-z,-x) for x,z in structure['footprint']];z=structure['baseY']+structure['height'];name=structure['id']
        for a,b in zip(poly,poly[1:]+poly[:1]):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
            ob=box(name+'.bulwark',((a[0]+b[0])/2,(a[1]+b[1])/2,z+.42),(length,.085,.84),naval,col);ob.rotation_euler.z=math.atan2(dy,dx);tag(ob,name)
            beam(name+'.cap',(a[0],a[1],z+.85),(b[0],b[1],z+.85),.045)
            # End each diagonal at the closest point on the actual supporting
            # cabin, so changes to cabin width cannot leave a hanging bracket.
            if length>1:
                midx,midy=(a[0]+b[0])/2,(a[1]+b[1])/2
                cabin=next(s for s in D['structures'] if s['id']==name.removesuffix('-platform'))
                wall=[(-zz,-xx) for xx,zz in cabin['footprint']]
                candidates=[]
                for c,e in zip(wall,wall[1:]+wall[:1]):
                    vx,vy=e[0]-c[0],e[1]-c[1]
                    t=max(0,min(1,((midx-c[0])*vx+(midy-c[1])*vy)/(vx*vx+vy*vy)))
                    candidates.append((c[0]+t*vx,c[1]+t*vy))
                anchor=min(candidates,key=lambda p:(p[0]-midx)**2+(p[1]-midy)**2)
                if math.hypot(anchor[0]-midx,anchor[1]-midy)>.15:
                    beam(name+'.knee',(midx,midy,z-.18),(*anchor,z-.55),.09)

    # Twin longitudinal catapults in the reference's stowed alignment.
    for sign in [-1,1]:
        name='catapult-'+('port' if sign>0 else 'starboard');x,y,z=-72.49,sign*6.3015,7.5795
        deck=deck_height(x)
        tag(cyl(name+'.foundation',(x,y,(deck+z)/2),1.2,z-deck,naval,col,32),name)
        tag(cyl(name+'.turntable',(x,y,z+.12),1.4,.24,naval,col,32),name)
        for yy in [-.52,.52]:
            beam(name+'.lower chord',(x-10.9,y+yy,z+.35),(x+10.3,y+yy,z+.35),.075)
            beam(name+'.upper rail',(x-10.9,y+yy,z+.95),(x+10.3,y+yy,z+.95),.08)
        for i in range(22):
            a=x-10.9+i*.96;b=min(x+10.3,a+.96)
            for yy in [-.52,.52]:
                beam(name+'.diagonal',(a,y+yy,z+.35),(b,y+yy,z+.95),.045)
                beam(name+'.vertical',(a,y+yy,z+.35),(a,y+yy,z+.95),.035)
            beam(name+'.cross tie',(a,y-.52,z+.4),(a,y+.52,z+.4),.045)
        tag(box(name+'.launch carriage',(x+2,y,z+1.1),(1.1,1.5,.25),naval,col),name)
        for dx in [-.40,.40]:
            beam(name+'.float cradle',(x+2+dx,y-1.8,z+1.35),(x+2+dx,y+1.8,z+1.35),.065)
            for yy in [-1.6,1.6]:beam(name+'.cradle stay',(x+2,y,z+1.1),(x+2+dx,y+yy,z+1.35),.05)
        # End-bearing feet connect the long truss to its deck installation.
        for dx in [-8.8,8.8]:
            dz=deck_height(x+dx)
            beam(name+'.stowage rest',(x+dx,y,dz),(x+dx,y,z+.35),.10)
    # Oval liferafts with lashed slat floors and support cradles.
    beam('bow-staff.pole',(91.4,0,deck_height(91.4)),(91.4,0,14.15),.035)
    rafts=[(23.72,-7.59,8.22),(12.89,-7.83,8.22),(12.82,8.07,8.22),(23.69,7.39,8.22),(-27.34,-7.97,8.22),(-25.43,7.97,8.22),(-2.87,-.33,10.20),(-79.73,-6.09,6.80),(-76.16,6.09,6.74)]
    for i,(x,y,z) in enumerate(rafts):
        name=f'life-raft-{i+1}';n=32
        for j in range(n):
            a=j*math.tau/n;b=(j+1)*math.tau/n
            beam(name+'.float',(x+1.36*math.cos(a),y+.66*math.sin(a),z+.17),(x+1.36*math.cos(b),y+.66*math.sin(b),z+.17),.17)
        for dx in [-1,-.75,-.5,-.25,0,.25,.5,.75,1]:
            half=.5*math.sqrt(max(0,1-(dx/1.25)**2))
            tag(box(name+'.slat',(x+dx,y,z+.08),(.12,half*2,.08),roof,col),name)
        for dx in [-.8,.8]:
            beam(name+'.lash',(x+dx,y-.65,z+.23),(x+dx,y+.65,z+.23),.024,dark)
            beam(name+'.rack',(x+dx,y,z-.2),(x+dx,y,z),.07)
        if i==6:
            for dx in [-.8,.8]:beam(name+'.raised cradle',(x+dx,y,8.27),(x+dx,y,z-.2),.10)
        # Outboard racks are tied back into the deckhouse, never left suspended.
        if abs(y)>7:
            inner=math.copysign(5.25,y)
            for dx in [-.9,.9]:
                beam(name+'.rack arm',(x+dx,inner,z-.18),(x+dx,y,z-.18),.07)
                beam(name+'.rack knee',(x+dx,inner,z-1.1),(x+dx,y,z-.18),.06)

    # Two additional rafts stand against the forward deckhouse, on attached racks.
    for i,(x,y) in enumerate([(23.72,-6.46),(12.82,6.95)]):
        name=f'life-raft-upright-{i+1}';z=9.015
        for j in range(32):
            a=j*math.tau/32;b=(j+1)*math.tau/32
            beam(name+'.float',(x+1.36*math.cos(a),y,z+.66*math.sin(a)),(x+1.36*math.cos(b),y,z+.66*math.sin(b)),.17)
        for dx in [-1,-.75,-.5,-.25,0,.25,.5,.75,1]:
            half=.5*math.sqrt(max(0,1-(dx/1.25)**2))
            tag(box(name+'.slat',(x+dx,y,z),(.12,.08,half*2),roof,col),name)
        for dx in [-.8,.8]:
            beam(name+'.lash',(x+dx,y,z-.65),(x+dx,y,z+.65),.024,dark)
            for h in [-.55,.55]:
                beam(name+'.rack',(x+dx,math.copysign(6.20,y),z+h),(x+dx,y,z+h),.045)

    # Only aerials rotate; mast platforms and foundation pedestals remain fixed.
    for name,position in [('radar-sk',(10.99,0,28.13)),('radar-sg',(7.19,0,34.62)),('radar-sm',(-11.96,0,26.98))]:
        moving=[o for o in col.objects if o.get('assemblyId')==name and not o.name.startswith((name+'.base',name+'.pedestal'))]
        radar_pivot(name+'.yaw',position,moving)

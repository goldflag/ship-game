"""Original Cleveland topside fittings, proportioned to the approved Hull A."""
import math
import bpy
from mathutils import Matrix
from blender_fidelity import Fittings, loft_breadth
from blender_rig import radar_pivot

# Bofors splinter tubs; build.py floors each to its wall.
TUB_RADIUS={'aa-7':2.6,'aa-8':2.6,'aa-11':2.72,'aa-12':2.72,'aa-13':2.72,'aa-14':2.72,'aa-24':2.58,'aa-25':2.58}
# Platform bulwarks as the reference: height and which edges carry one (Blender x = -z runtime);
# 'rail' is an open guard rail.
BULWARKS={
    'forward-bridge-lower-platform':(1.3,lambda a,b:True),
    'forward-bridge-middle-platform':(1.2,lambda a,b:max(a[0],b[0])>9.7),
    'forward-bridge-upper-platform':(1.1,lambda a,b:max(a[0],b[0])>12.6),
    'pilot-house-platform':(1.1,lambda a,b:min(a[0],b[0])<18.4),
    'after-bridge-upper-platform':(1.2,lambda a,b:min(a[0],b[0])<-13.9),
    'after-mast-house-platform':('rail',None),
}

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
        r=TUB_RADIUS.get(m['id'],2.4) if heavy else .95
        # Only the 40 mm mounts have round tubs; the reference's 20 mm stand in deck-edge bulwarks
        # (upperworks.py) or in the open, and aa-19/20 are in the after 02 deck's sponsons.
        if not heavy or m['id'] in ['aa-19','aa-20']:continue
        start,end={7:(310,550),8:(170,410),11:(335,655),12:(65,385),13:(270,600),14:(120,450),24:(20,245),25:(115,340)}.get(int(m['id'][3:]),(0,360))
        ringwall(m['id']+'.splinter tub',x,y,z,r,.85,start,end)
    # Pole masts, funnel fittings and funnel galleries.
    from upperworks import build_upperworks
    build_upperworks(D,helpers,materials,col,F)
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
    for ident,x,z,bearing in [('forward',23.55,17.25,0),('after',-23.32,15.48,180)]:
        name='mk37-'+ident;sign=1 if bearing==0 else -1
        tag(cyl(name+'.bearing',(x,0,z+.2),1.55,.4,naval,col,24),name)
        vv=[(x+sign*a,b,z+c) for a,b,c in [(-1.65,-1.7,.35),(-1.65,1.7,.35),(1.8,1.7,.35),(1.8,-1.7,.35),(-1.65,-1.6,2.3),(-1.65,1.6,2.3),(.7,1.6,2.45),(.7,-1.6,2.45)]]
        tag(mesh(name+'.house',vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],naval,col),name)
        beam(name+'.rangefinder',(x,-2.39,z+1.1),(x,2.39,z+1.1),.19)
        for y in [-1.0,0,1.0]:
            tag(box(name+'.sight',(x+sign*1.17,y,z+1.83),(.3,.38,.3),dark,col),name)
    # Rectangular SK antenna, open lattice and rear structural braces.
    x,z=11.55,28.07;name='radar-sk'
    tag(cyl(name+'.pedestal',(x,0,z+.3),.40,.6,naval,col,20),name)
    tag(box(name+'.base housing',(x-.58,0,z+.6),(.85,2.4,1.2),naval,col),name)
    for y in [-2.55,2.55]:beam(name+'.frame',(x,y,z+.6),(x,y,z+5.8),.055)
    for h in [0.6+i*.43 for i in range(13)]:beam(name+'.horizontal',(x,-2.55,z+h),(x,2.55,z+h),.023)
    for y in [-2.55+i*.425 for i in range(13)]:beam(name+'.vertical',(x,y,z+.6),(x,y,z+5.8),.023)
    for h in [.6,3.2,5.8]:
        beam(name+'.rear brace',(x-1,0,z+2.5),(x,-2.55,z+h),.055)
        beam(name+'.rear brace',(x-1,0,z+2.5),(x,2.55,z+h),.055)
    # SG rotating search aerial on the fore pole and SM lattice aft.
    for name,x,z,w,h in [('radar-sg',7.17,34.62,1.28,1.23),('radar-sm',-11.9,27.21,2.46,2.91)]:
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
        if i in [6,7]:
            # Round platforms beside the mainmast on a column from the after 02 deck (12.8 m).
            # Round tubs beside the mainmast on a column and raking struts from the after 02 deck (12.8 m).
            px,py=-10.81,math.copysign(2.99,y)
            tag(cyl(name+'.platform',(px,py,z-.08),1.28,.16,roof,col,28),name)
            tag(cyl(name+'.platform column',(px,py,(12.8+z-.16)/2),.16,z-.16-12.8+.04,naval,col,12),name)
            for dx,dy in [(-1.0,0),(1.0,0),(0,-math.copysign(1.0,py))]:beam(name+'.platform strut',(px+dx*.6,py+dy*.6,12.8),(px+dx,py+dy,z-.16),.07)
            ringwall(name+'.tub',px,py,z,1.28,1.0,0,360)
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
    def edge_at(x):
        for a,b in zip(points,points[1:]):
            if a[0]<=x<=b[0]:
                t=(x-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t
        return points[-1][1],points[-1][2]
    # Stanchions every 2.5 m from the fantail bulwark (x -83.6) to the bow gun bulwark (x 83.4).
    xs=[-83.6+2.5*i for i in range(int((83.4+83.6)/2.5)+1)]+[83.4]
    for sign in [-1,1]:
        edge=[]
        for x in xs:
            w,z=edge_at(x);y=sign*max(0,w-.15)
            edge.append((x,y,z))
            beam('deck-rail.stanchion',(x,y,z),(x,y,z+.96),.026)
        for a,b in zip(edge,edge[1:]):
            for h in [.32,.64,.96]:beam('deck-rail.wire',(a[0],a[1],a[2]+h),(b[0],b[1],b[2]+h),.016)
    # Deckhouse openings and attached doors; no texture planes hovering off the hull.
    for ident,x,z in [('forward-deckhouse',30,6.3),('forward-deckhouse',13,6.1),('center-deckhouse',-1,6.1),('center-deckhouse',-8,6.1),('after-deckhouse',-23,6.1),('after-deckhouse',-30,6.2)]:
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
    # Capstans, bollards, mushroom ventilators and anchor cables at the reference's positions.
    for y in [-2.55,2.55]:
        x=70.1;z=deck_height(x)
        tag(cyl('capstan.base',(x,y,z+.15),.64,.3,naval,col,24),'deck-capstans')
        tag(cyl('capstan.drum',(x,y,z+.58),.35,.7,dark,col,24),'deck-capstans')
        tag(cyl('capstan.head',(x,y,z+.97),.55,.12,naval,col,24),'deck-capstans')
    for x,ay in [(77.68,3.92),(66.57,5.39),(53.55,6.59),(-58.72,8.02),(-84.53,6.25)]:
        for y in [-ay,ay]:
            z=deck_height(x)
            tag(box('bitts.foundation',(x,y,z+.08),(1.6,.65,.16),naval,col),'deck-bitts')
            for dx in [-.5,.5]:
                tag(cyl('bitts.post',(x+dx,y,z+.42),.17,.68,naval,col,16),'deck-bitts')
                tag(cyl('bitts.cap',(x+dx,y,z+.78),.23,.08,naval,col,16),'deck-bitts')
    # (The reference also has a low vent at z -63.5 under turret 1's rear overhang; our Mk 16 gunhouse would foul it.)
    for x,y,h,r in [(67.89,1.85,1.3,.85),(67.89,-1.85,1.3,.85),(64.83,-1.97,.85,.57),(-88.07,2.09,1.3,.85),(-88.07,-2.21,1.15,.85),
                    (-39.36,-1.66,1.3,.85),(-47.84,-1.85,1.3,.85),(35.82,0,.83,.85),(-61.24,3.07,.83,.85),(-62.97,-5.9,.83,.85),(-62.97,5.9,.83,.85)]:
        z=deck_height(x)
        if -4.5<x<30:z=8.27
        tag(cyl('deck-ventilator.stalk',(x,y,z+(h-.25)/2),.3,h-.25,naval,col,12),'deck-ventilators')
        tag(cyl('deck-ventilator.cap',(x,y,z+h-.14),r,.2,naval,col,20,r*.55),'deck-ventilators')
    # Anchor cables from the hawse pipes aft to the capstans; alternate links touch.
    for sign in [-1,1]:
        for i in range(37):
            x=82.6-i*.32;y=sign*(2.2+(2.55-2.2)*i/36);z=deck_height(x)
            if i%2:F.ring('anchor cable',(x,y,z+.025),.2,.03,'z',segments=8)
            else:F.ring('anchor cable',(x,y,z+.15),.16,.03,'y',segments=8)
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
        F.ring(name+'.hawse lip',(82.9,sign*2.2,deck_height(82.9)+.035),.25,.065,'z',segments=20)
    # Aircraft crane at the stern: a pedestal on the transom, a forward-leaning lattice post, a near-level
    # boom over the hatch and a backstay post, as the reference.
    name='stern-crane';x=-90.3;z=deck_height(x)
    tag(cyl(name+'.foundation',(x,0,z+.5),.85,1.0,naval,col,24),name)
    tag(cyl(name+'.slewing ring',(x,0,z+1.05),1.0,.12,naval,col,24),name)
    root=(x,0,z+1.1);elbow=(-88.7,0,15.35);tip=(-80.35,0,15.75)
    def truss(p0,p1,q0,q1,width,n,prefix):
        # Two chord pairs p0->p1 and q0->q1 (each a centreline line, split +/- width/2), battens and webs.
        for y in [-width/2,width/2]:
            beam(name+'.'+prefix+' chord',(p0[0],y,p0[2]),(p1[0],y,p1[2]),.085)
            beam(name+'.'+prefix+' back chord',(q0[0],y,q0[2]),(q1[0],y,q1[2]),.065)
        for i in range(n+1):
            t=i/n
            p=[p0[k]+(p1[k]-p0[k])*t for k in range(3)];q=[q0[k]+(q1[k]-q0[k])*t for k in range(3)]
            for y in [-width/2,width/2]:beam(name+'.batten',(p[0],y,p[2]),(q[0],y,q[2]),.035)
            beam(name+'.tie',(p[0],-width/2,p[2]),(p[0],width/2,p[2]),.03)
            if i<n:
                u=(i+1)/n;pn=[p0[k]+(p1[k]-p0[k])*u for k in range(3)]
                for y in [-width/2,width/2]:beam(name+'.web',(q[0],y,q[2]),(pn[0],y,pn[2]),.035)
    # Post: forward chords from the pedestal to the knuckle, the after chords 0.7 m behind them.
    truss((root[0]+.35,0,root[2]),(elbow[0]+.35,0,elbow[2]),(root[0]-.35,0,root[2]),(elbow[0]-.35,0,elbow[2]),.9,7,'post')
    # Boom: a level top chord to the sheave head, the lower chord curving down to the post at 13.9 m.
    lower=(-87.66,0,13.9)
    truss((elbow[0],0,elbow[2]),tip,(lower[0],0,lower[2]),(tip[0]+.3,0,tip[2]-.35),.6,8,'boom')
    tag(box(name+'.knuckle',elbow,(.6,.9,.5),naval,col),name)
    tag(box(name+'.sheave head',(tip[0],0,tip[2]-.1),(.6,.5,.6),naval,col),name)
    # Backstay post on the transom and its ties to the knuckle.
    back=(-92.6,0,10.5)
    beam(name+'.backstay post',(-91.6,0,deck_height(-91.6)),back,.12)
    tag(box(name+'.backstay head',back,(.6,.6,.6),naval,col),name)
    for y in [-.3,.3]:beam(name+'.backstay tie',(back[0],y,back[2]),(elbow[0]-.2,y,elbow[2]),.04,dark)
    beam(name+'.topping wire',(back[0],0,back[2]+.2),(tip[0],0,tip[2]),.025,dark)
    beam(name+'.hoist wire',(tip[0],0,tip[2]-.35),(tip[0],0,14.6),.025,dark)
    F.ring(name+'.hook',(tip[0],0,14.45),.18,.055,'y',segments=12)
    # Hangar hatch, the smoke generators on the transom.
    tag(box('stern-deck.hangar hatch',(-80.55,0,deck_height(-80.55)+.25),(12.9,5.8,.7),materials['roof'],col),'stern-deck')
    for y in [-2.55,2.55]:
        for dy in [-.2,.2]:
            ob=tag(cyl('stern-deck.smoke generator',(-91.1,y+dy,deck_height(-91.1)+.3),.2,1.4,naval,col,12),'stern-deck');ob.rotation_euler.y=math.pi/2
        tag(box('stern-deck.smoke generator rack',(-91.1,y,deck_height(-91.1)+.05),(1.5,.9,.1),naval,col),'stern-deck')
    # Skeg, rudder, bilge keels, shafts, screws, propeller guards and the fantail bulwark.
    from underwater import build_underwater
    build_underwater(D,helpers,materials,col)

    # Projecting bridge platforms carry thin splinter bulwarks, with cabins set inboard.
    for structure in D['structures']:
        if not structure['id'].endswith('-platform'):continue
        poly=[(-z,-x) for x,z in structure['footprint']];z=structure['baseY']+structure['height'];name=structure['id']
        height,keep=BULWARKS.get(name,(.84,lambda a,b:True))
        for a,b in zip(poly,poly[1:]+poly[:1]):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
            if height=='rail':
                for t in [0,.5] if length>1.2 else [0]:
                    px,py=a[0]+dx*t,a[1]+dy*t
                    beam(name+'.stanchion',(px,py,z),(px,py,z+.95),.025)
                for h in [.48,.95]:beam(name+'.rail',(a[0],a[1],z+h),(b[0],b[1],z+h),.018,dark)
            elif keep(a,b):
                ob=box(name+'.bulwark',((a[0]+b[0])/2,(a[1]+b[1])/2,z+height/2),(length,.085,height),naval,col);ob.rotation_euler.z=math.atan2(dy,dx);tag(ob,name)
                beam(name+'.cap',(a[0],a[1],z+height+.01),(b[0],b[1],z+height+.01),.045)
            # End each diagonal at the closest point on the actual supporting
            # cabin, so changes to cabin width cannot leave a hanging bracket.
            midx,midy=(a[0]+b[0])/2,(a[1]+b[1])/2
            # No knees where a gun trains under the platform.
            if length>1 and not any(math.hypot(midx+m['position'][2],midy+m['position'][0])<3.8 and m['position'][1]<z for m in D['mounts'] if m['id'].startswith(('secondary','main'))):
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

    # Twin longitudinal catapults in the reference's stowed alignment: a 1.1 m deep truss on a
    # cylindrical turntable pedestal, the launch carriage forward of the pedestal.
    for sign in [-1,1]:
        name='catapult-'+('port' if sign>0 else 'starboard');x,y,z=-72.49,sign*6.3015,7.60
        deck=deck_height(x)
        tag(cyl(name+'.foundation',(x,y,(deck+z)/2),1.85,z-deck,naval,col,32),name)
        tag(cyl(name+'.turntable',(x,y,z+.06),2.0,.12,naval,col,32),name)
        lo,hi=z+.15,z+1.25
        for yy in [-.62,.62]:
            beam(name+'.lower chord',(x-10.9,y+yy,lo),(x+10.9,y+yy,lo),.08)
            beam(name+'.upper rail',(x-10.9,y+yy,hi),(x+10.9,y+yy,hi),.09)
        n=18
        for i in range(n):
            a=x-10.9+i*21.8/n;b=a+21.8/n
            for yy in [-.62,.62]:
                beam(name+'.diagonal',(a,y+yy,lo if i%2 else hi),(b,y+yy,hi if i%2 else lo),.05)
                beam(name+'.counter diagonal',(a,y+yy,hi if i%2 else lo),(b,y+yy,lo if i%2 else hi),.035)
                beam(name+'.mid chord',(a,y+yy,(lo+hi)/2),(b,y+yy,(lo+hi)/2),.035)
                beam(name+'.vertical',(a,y+yy,lo),(a,y+yy,hi),.04)
            beam(name+'.cross tie',(a,y-.62,hi),(a,y+.62,hi),.04)
        for yy in [-.62,.62]:beam(name+'.vertical',(x+10.9,y+yy,lo),(x+10.9,y+yy,hi),.04)
        tag(box(name+'.launch carriage',(x+3.6,y,hi+.25),(2.2,1.4,.4),naval,col),name)
        tag(box(name+'.carriage cradle',(x+3.6,y,hi+.55),(.6,1.1,.3),naval,col),name)
        # End rests on the deck.
        for dx in [-10.3,9.6]:
            dz=deck_height(x+dx)
            beam(name+'.stowage rest',(x+dx,y,dz),(x+dx,y,lo),.12)
    # Oval liferafts with lashed slat floors and support cradles.
    beam('bow-staff.pole',(91.8,0,deck_height(91.8)),(91.8,0,13.9),.035)
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
        wall=6.26 if i==0 else 6.74
        for dx in [-.8,.8]:
            beam(name+'.lash',(x+dx,y,z-.65),(x+dx,y,z+.65),.024,dark)
            for h in [-.55,.55]:
                beam(name+'.rack',(x+dx,math.copysign(6.20,y),z+h),(x+dx,y,z+h),.045)
            # Bracket from the 01 deckhouse side up to the rack.
            beam(name+'.bracket',(x+dx,math.copysign(wall-.1,y),7.8),(x+dx,y,z-.55),.05)

    # Only aerials rotate; mast platforms and foundation pedestals remain fixed.
    for name,position in [('radar-sk',(11.55,0,28.07)),('radar-sg',(7.17,0,34.62)),('radar-sm',(-11.9,0,27.21))]:
        moving=[o for o in col.objects if o.get('assemblyId')==name and not o.name.startswith((name+'.base',name+'.pedestal'))]
        radar_pivot(name+'.yaw',position,moving)

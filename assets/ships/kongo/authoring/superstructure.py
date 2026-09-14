"""Original Kongō pagoda, authored from the approved model's inspected views.

Metres, +X bow / +Y port / +Z up. Named floors use scalar visual measurements;
all outlines, structure, glazing and fittings below are independent construction.
"""
import math

def create(h, mats):
    mesh, prism, rod, cyl, box, rail, shield, oval, rect = (h[k] for k in
        ('mesh','prism','rod','cyl','box','rail','shield','oval','rect'))
    steel, dark, glass, edge = (mats[k] for k in ('naval','dark','glass','edge'))
    def rounded(outline, radius=.3, steps=4):
        """Round original polygon corners, preserving the designed straight runs."""
        result=[]
        for i,p in enumerate(outline):
            a,b=outline[i-1],outline[(i+1)%len(outline)]
            da,db=math.dist(a,p),math.dist(b,p);r=min(radius,da*.35,db*.35)
            start=tuple(p[k]+(a[k]-p[k])*r/da for k in range(2))
            end=tuple(p[k]+(b[k]-p[k])*r/db for k in range(2))
            for j in range(steps+1):
                t=j/steps
                result.append(tuple((1-t)**2*start[k]+2*t*(1-t)*p[k]+t*t*end[k] for k in range(2)))
        return result
    def floor(name,outline,z,bulwark=0):
        prism('bridge.'+name,outline,z-.16,z)
        if bulwark:shield('bridge.'+name+'-shield',outline,z,bulwark)
    def walls(name,outline,bottom,sill,lintel,roof,glazed_aft=None):
        # A true glazed band between solid lower walls and a narrow roof beam.
        # No opaque box sits behind the windows.
        prism('bridge.'+name+'-sill',outline,bottom,sill)
        prism('bridge.'+name+'-roof',outline,lintel,roof)
        center=(sum(p[0] for p in outline)/len(outline),sum(p[1] for p in outline)/len(outline))
        # Frame spacing follows distance around the wall, independent of the
        # number of segments used to round a corner.
        cursor=0;next_frame=0
        for a,b in zip(outline,outline[1:]+outline[:1]):
            length=math.dist(a,b)
            if glazed_aft is None or min(a[0],b[0])>=glazed_aft:
                mesh('bridge.'+name+'-glass',[(*a,sill),(*b,sill),(*b,lintel),(*a,lintel)],[(0,1,2,3)],glass)
            while next_frame<cursor+length-1e-6:
                t=(next_frame-cursor)/length
                p=tuple(a[k]+(b[k]-a[k])*t for k in range(2))
                rod('bridge.'+name+'-mullion',(*p,sill),(*p,lintel),.027,steel,vertices=6)
                next_frame+=.82
            cursor+=length
        # Floor and a low interior center partition give the window band depth.
        box('bridge.'+name+'-interior',(*center,(sill+bottom)/2),(1.2,1.0,max(.1,sill-bottom)),dark)
    def ladder(name,x,y,z0,z1):
        for yy in [y-.20,y+.20]:rod('bridge.'+name+'-rail',(x,yy,z0),(x,yy,z1),.026,edge,vertices=6)
        for i in range(max(1,int((z1-z0)/.28))):
            z=z0+.15+i*.28;rod('bridge.'+name+'-rung',(x,y-.20,z),(x,y+.20,z),.023,edge,vertices=6)
    # Lower enclosed bridge and the forward conning station.
    base=rounded([(29.9,-1.55),(31.1,-4.55),(35.1,-4.55),(36.2,-3.3),
                  (36.2,3.3),(35.1,4.55),(31.1,4.55),(29.9,1.55)],.5)
    prism('bridge.lower',base,7.3,13.53)
    prism('bridge.stair-core',rect(27.5,31.3,-1.45,1.45,.3),7.3,17.64)
    prism('bridge.middle-room',rect(27.4,35.8,-2.8,2.8,.65),13.53,17.64)
    lower_walk=rounded([(23,-3.2),(31,-3.2),(31,3.2),(23,3.2)],.2)
    floor('lower-aft-walk',lower_walk,11.51)
    for sign in [-1,1]:
        rod('bridge.lower-cross-brace',(23.5,sign*3.1,8.6),(29.3,sign*1.5,11.35),.10,steel,vertices=8)
        rod('bridge.lower-cross-brace',(23.5,sign*3.1,11.35),(29.3,sign*1.5,8.6),.10,steel,vertices=8)
    # The inspected conning station has a broad oval body and an inset upper
    # shoulder. Its old projecting cap encroached on No. 2's rangefinder.
    conning=oval(38.15,0,1.92,2.94,64)
    prism('bridge.conning',conning,7.3,15.30)
    crown=oval(38.15,0,1.73,2.75,64)
    n=len(conning)
    vs=[(x,y,15.30) for x,y in conning]+[(x,y,15.49) for x,y in crown]
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    fs.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    mesh('bridge.conning-roof',vs,fs,steel)
    floor('lower-observation',rounded([(23,-4.1),(29,-4.1),(30,-5.6),(34.4,-5.6),(35.8,-4),
                                      (35.8,4),(34.4,5.6),(30,5.6),(29,4.1),(23,4.1)],.5),15.63,.65)
    # Three thick mast legs remain visible in the open rear of the pagoda.
    for sign in [-1,1]:
        rod('bridge.raked-leg',(22.8,sign*3.75,7.3),(27.3,sign*1.55,32.11),.46,steel,r2=.29,vertices=24)
    rod('bridge.front-mast',(32.55,0,11.5),(29.25,0,32.11),.55,steel,r2=.33,vertices=24)
    # Raked rear shell, with two large rounded openings on each side. The
    # openings are built as wall segments rather than black decals on a box.
    for sign in [-1,1]:
        def point(x,z):return (x,sign*(3.7-(z-7.3)*.079),z)
        bands=[(11.5,17.4),(19.4,23.8),(25.9,29.36),(30.8,32.11)]
        for z0,z1 in bands:
            aft0=22.8+(z0-7.3)*.155;aft1=22.8+(z1-7.3)*.155
            vs=[point(aft0,z0),point(28.9,z0),point(28.9,z1),point(aft1,z1)]
            mesh('bridge.rear-shell',vs,[(0,1,2,3)] if sign<0 else [(3,2,1,0)],steel)
        for z0,z1 in [(17.4,19.4),(23.8,25.9),(29.36,30.8)]:
            aft0=22.8+(z0-7.3)*.155;aft1=22.8+(z1-7.3)*.155
            # A rounded cutout retains thick corners and a metal reveal.
            # Construct the ring around it; no opaque backing closes the hole.
            cx=(aft0+28.9)/2;cz=(z0+z1)/2
            rx=(28.9-aft0)/2;rz=(z1-z0)/2
            outer=[];inner=[]
            for i in range(40):
                angle=i*math.tau/40;c,ss=math.cos(angle),math.sin(angle)
                scale=max(abs(c),abs(ss))
                zz=cz+rz*ss/scale
                left=22.8+(zz-7.3)*.155
                xx=left+(28.9-left)*(.5+.5*c/scale)
                outer.append(point(xx,zz))
                inner.append(point(cx+(rx-.30)*math.copysign(abs(c)**.42,c),
                                   cz+(rz-.17)*math.copysign(abs(ss)**.42,ss)))
            vs=outer+inner+[(x,y-sign*.07,z) for x,y,z in inner]
            faces=[]
            for i in range(40):
                j=(i+1)%40
                faces.extend([(i,j,40+j,40+i),(40+i,40+j,80+j,80+i)])
            mesh('bridge.rear-opening-frame',vs,faces if sign<0 else [tuple(reversed(f)) for f in faces],steel)
    # The rear mast shell is open between floors; a solid full-height core
    # here would fill the visible openings and the CPU firing paths.
    prism('bridge.rear-core',rect(27.6,28.8,-.72,.72,.2),15.43,17.4)
    # Broad navigation bridge: the continuous window band is a recognition feature.
    navigation=rounded([(25.2,-3.15),(29,-3.15),(30,-4.65),(34.8,-4.65),(36.15,-3.1),
                        (36.15,3.1),(34.8,4.65),(30,4.65),(29,3.15),(25.2,3.15)],.55)
    floor('navigation-floor',navigation,17.82)
    walls('navigation',navigation,17.82,18.95,19.88,20.30,glazed_aft=29)
    compass=rounded([(24.6,-3.6),(28.9,-3.6),(30,-5.45),(34.3,-5.45),(36.7,-3.3),
                     (36.7,3.3),(34.3,5.45),(30,5.45),(28.9,3.6),(24.6,3.6)],.45)
    floor('compass-deck',compass,20.43,.72)
    # Canvas windbreak follows the forward compass bulwark, in shallow folds.
    for a,b in zip(compass,compass[1:]+compass[:1]):
        if min(a[0],b[0])<29.0:continue
        length=math.dist(a,b);count=max(1,math.ceil(length/.22))
        vs=[]
        for i in range(count+1):
            t=i/count;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            offset=.070+.018*math.sin(t*math.pi*count)
            normal=((b[1]-a[1])/max(length,.001),-(b[0]-a[0])/max(length,.001))
            vs.extend([(x+normal[0]*offset,y+normal[1]*offset,20.72),
                       (x+normal[0]*offset,y+normal[1]*offset,21.35+.025*math.cos(t*math.pi*count))])
        mesh('bridge.compass-canvas',vs,[(2*i,2*i+2,2*i+3,2*i+1) for i in range(count)],mats['canvas'])
    compass_room=rounded([(30.05,-1.55),(33.1,-1.55),(34.65,-1.1),(34.65,1.1),(33.1,1.55),(30.05,1.55)],.6)
    walls('compass-room',compass_room,20.43,21.55,22.36,22.65)
    # The roof rises toward the floor above. A flat lid left a conspicuous
    # unsupported gap between the stacked bridge rooms in side/quarter views.
    compass_eaves=rounded([(29.8,-1.80),(33.2,-1.80),(34.95,-1.30),
                           (34.95,1.30),(33.2,1.80),(29.8,1.80)],.55)
    prism('bridge.compass-room-hip',compass_eaves,22.60,23.57,topscale=.70)
    for sign in [-1,1]:
        blister=rounded([(30.4,sign*1.3),(32.6,sign*1.3),(33.4,sign*1.8),(33.1,sign*2.25),(30.4,sign*2.25)],.4)
        if sign<0:blister.reverse()
        walls('compass-side-room',blister,20.43,20.78,21.45,21.61)
    # Individually shaped upper floors, with open side galleries around the mast.
    lower_gal=rounded([(25.0,-2.8),(29.3,-2.8),(30.3,-3.45),(33.86,-3.45),(33.86,3.45),
                       (30.3,3.45),(29.3,2.8),(25,2.8)],.48)
    floor('lower-upper-gallery',lower_gal,23.71,.82)
    cabin=rounded([(29.2,-1.75),(32.8,-1.75),(33.4,-1.0),(33.4,1.0),(32.8,1.75),(29.2,1.75)],.5)
    walls('upper-observation-room',cabin,23.71,24.65,25.46,25.66)
    cabin_eaves=rounded([(29.05,-1.95),(32.9,-1.95),(33.63,-1.16),
                         (33.63,1.16),(32.9,1.95),(29.05,1.95)],.5)
    prism('bridge.upper-observation-room-hip',cabin_eaves,25.61,26.33,topscale=.75)
    middle=rounded([(24.89,-3.2),(30.2,-4.1),(33.87,-4.1),(33.87,4.1),(30.2,4.1),(24.89,3.2)],.5)
    floor('middle-gallery',middle,26.47,.64)
    upper_room=rounded([(27.45,-1.35),(31.55,-1.35),(32.0,-.9),(32,.9),(31.55,1.35),(27.45,1.35)],.3)
    walls('upper-watch-room',upper_room,26.47,27.16,28.55,28.72)
    watch_eaves=rounded([(27.30,-1.55),(31.68,-1.55),(32.20,-1.03),
                         (32.20,1.03),(31.68,1.55),(27.30,1.55)],.35)
    prism('bridge.upper-watch-room-hip',watch_eaves,28.67,29.22,topscale=.80)
    # Forward folded screens have depth and separate vertical panels.
    for i in range(6):
        y=-2.5+i;front=34.02-.15*abs(y)
        for z in [26.54,27.1,27.66]:
            mesh('bridge.forward-screen',[(front,y-.47,z),(front,y+.47,z),(front+.18,y+.47,z+.52),(front+.18,y-.47,z+.52)],[(0,1,2,3)],steel)
        rod('bridge.screen-frame',(front+.20,y-.5,26.48),(front+.20,y-.5,28.22),.035,edge,vertices=6)
    upper_gal=rounded([(25,-2.4),(29.0,-3.9),(31.9,-3.9),(33.0,-2.8),(33.0,2.8),
                       (31.9,3.9),(29,3.9),(25,2.4)],.7)
    floor('upper-gallery',upper_gal,29.36,1.02)
    # The observer gallery is open above its bulwark, with a compact aft shelter.
    prism('bridge.upper-aft-shelter',rect(25.9,28.2,-1.15,1.15,.35),29.36,31.78)
    highest_room=rounded([(28.2,-1.7),(30.8,-1.7),(31.4,-1.05),(31.4,1.05),(30.8,1.7),(28.2,1.7)],.45)
    walls('highest-watch-room',highest_room,29.36,30.05,31.50,31.76)
    top=rounded([(23.98,-2.75),(26.1,-3.4),(27.2,-4.1),(28.6,-4.1),(29.4,-3.2),(34.15,-3.2),
                 (35.04,-2.1),(35.04,2.1),(34.15,3.2),(29.4,3.2),(28.6,4.1),(27.2,4.1),(26.1,3.4),(23.98,2.75)],.4)
    floor('director-deck',top,32.11,.90)
    # Floor beams and knees attach the projecting wings to the mast, without
    # evenly repeated full-width cross-braces at every level.
    for z,w,front in [(17.82,4.6,35),(20.43,5.4,35),(23.71,3.4,33),(26.47,4.1,33),(29.36,3.9,32),(32.11,3.2,34)]:
        for sign in [-1,1]:
            rod('bridge.floor-beam',(26.7,sign*1.2,z-.15),(front,sign*(w-.15),z-.15),.095,steel,vertices=8)
            rod('bridge.floor-knee',(28.0,sign*1.5,z-1.1),(31.2,sign*(w-.3),z-.2),.12,steel,vertices=8)
        if z<32:ladder('level-ladder',26.0,1.42,z,min(z+2.2,32.1))
    aft_walk=rounded([(20.7,-4.6),(26,-4.6),(26,4.6),(20.7,4.6)],.25)
    floor('navigation-aft-walk',aft_walk,17.82);rail('bridge.navigation-aft-rail',aft_walk,17.82,.85)
    for sign in [-1,1]:
        rod('bridge.navigation-aft-knee',(24.0,sign*2.8,16.1),(21.3,sign*4.25,17.66),.12,steel,vertices=8)
    # Paired aft signal wings are narrow diagonal walkways, not a solid shelf.
    for sign in [-1,1]:
        signal=[(27.2,sign*1.8),(27.2,sign*2.8),(18,sign*7.82),(17.5,sign*7.35),(23.8,sign*3.5)]
        if sign<0:signal.reverse()
        floor('signal-wing',signal,29.36);rail('bridge.signal-rail',signal,29.36,.85)
        rod('bridge.signal-knee',(27.2,sign*2.0,28.05),(18,sign*7.5,29.18),.13,steel,vertices=8)
        for i in range(8):
            f=i/7;x=23.4-5.5*f;y=sign*(3.9+3.8*f)
            cyl('bridge.signal-block',(x,y,29.07),.12,.19,mats['canvas'],vertices=10)
            rod('bridge.signal-halyard',(x,y,29.04),(22.7,sign*(4.1+i*.075),17.82),.009,edge,vertices=5)
    # Top optical stations: forward circular observation house, aft transverse
    # rangefinder, and the separate cylindrical upper housing.
    cyl('director.forward-seat',(30.8,0,32.88),1.75,1.54,steel,vertices=48)
    forward_house=oval(30.8,0,1.65,1.65,72)
    prism('director.forward-sill',forward_house,33.65,33.96)
    prism('director.forward-roof',forward_house,34.70,35.02)
    # Two actual forward viewing openings; the remaining circumference is
    # armored. Scalar radial checks of the approved model locate these arcs.
    for i in range(72):
        a=i*math.tau/72;b=(i+1)*math.tau/72
        degrees=(i+.5)*5
        if 20<degrees<50 or 310<degrees<340:continue
        outer=[(30.8+1.65*math.cos(t),1.65*math.sin(t),z)
               for z in [33.96,34.70] for t in [a,b]]
        inner=[(30.8+1.58*math.cos(t),1.58*math.sin(t),z)
               for z in [33.96,34.70] for t in [a,b]]
        mesh('director.forward-armor',outer+inner,
             [(0,1,3,2),(5,4,6,7),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],steel)
    rail('director.forward-roof-rail',forward_house[::6],35.02,.18)
    for sign in [-1,1]:
        rod('director.forward-optic-seat',(31.5,sign*.72,33.65),(31.5,sign*.72,34.2),.075,steel,vertices=10)
        for dy in [-.09,.09]:
            rod('director.forward-optic',(31.30,sign*.72+dy,34.23),(31.91,sign*.72+dy,34.28),.066,mats['bronze'],vertices=12)
    prism('director.rear-seat',oval(26.95,0,1.26,1.26,48),32.11,34.69,topscale=.88)
    prism('director.rangefinder-body',rect(25.86,28.04,-2.44,2.44,.65),35.0,36.15,topscale=.91)
    cyl('director.rangefinder-bearing',(26.95,0,34.93),1.08,.48,steel,vertices=40)
    rod('director.rangefinder',(26.95,-4.83,35.45),(26.95,4.83,35.45),.34,steel,vertices=24)
    for sign in [-1,1]:
        rod('director.rangefinder-end',(26.95,sign*4.6,35.45),(26.95,sign*4.84,35.45),.43,edge,vertices=24)
    cyl('director.upper-neck',(27.1,0,36.48),.91,.50,steel,vertices=32)
    cyl('director.upper-house',(27.1,0,37.95),1.12,2.47,steel,vertices=48)
    rail('director.upper-roof-rail',oval(27.1,0,1.12,1.12,12),39.185,.18)
    rod('director.aerial',(27.1,0,39.18),(27.1,0,40.10),.035,edge,vertices=8)
    rod('director.aerial-head',(26.7,0,40.10),(27.5,0,40.10),.05,edge,vertices=8)
    ladder('upper-director-ladder',25.93,.0,35.0,39.2)
    # Forward top-deck projection and direction-finding loop.
    loop_deck=[(33,-1),(37.15,-.55),(37.15,.55),(33,1)]
    floor('loop-platform',loop_deck,31.73);rail('bridge.loop-rail',loop_deck,31.73,.28)
    mesh('bridge.loop-knee',[(32.7,0,30.25),(37.15,0,31.57),(32.7,0,31.57)],[(0,1,2)],steel)
    for i in range(40):
        a=i*math.tau/40;b=(i+1)*math.tau/40
        rod('director.loop',(36.8,.48*math.cos(a),32.52+.48*math.sin(a)),(36.8,.48*math.cos(b),32.52+.48*math.sin(b)),.018,mats['bronze'],vertices=6)
    rod('director.loop-pedestal',(36.8,0,31.73),(36.8,0,32.98),.025,edge,vertices=6)
    # Open rectangular radar frame ahead of the upper housing. The lattice,
    # dipoles and diagonal stand-offs are original rods, not a flat image.
    for y in [-2.0,2.0]:
        rod('director.radar-frame',(28.7,y,36.75),(28.7,y,39.18),.035,edge,vertices=8)
        for z in [36.75,39.18]:rod('director.radar-standoff',(27.2,y*.4,z),(28.7,y,z),.027,edge,vertices=6)
    for z in [36.75,39.18]:rod('director.radar-frame',(28.7,-2,z),(28.7,2,z),.035,edge,vertices=8)
    for i in range(1,32):
        y=-2+i*.125;rod('director.radar-grid',(28.69,y,36.77),(28.69,y,39.16),.006,edge,vertices=4)
    for i in range(1,20):
        z=36.75+i*.1215;rod('director.radar-grid',(28.69,-1.98,z),(28.69,1.98,z),.006,edge,vertices=4)
    for y in [-1.1,0,1.1]:
        rod('director.radar-upright',(28.76,y,36.87),(28.76,y,39.08),.018,steel,vertices=6)
        for z in [37.0,37.65,38.3,38.95]:
            rod('director.radar-element-stem',(28.76,y,z),(29.08,y,z),.015,steel,vertices=6)
            rod('director.radar-dipole',(29.08,y-.21,z),(29.08,y+.21,z),.011,steel,vertices=6)
    # Small paired optical instruments retain fork, trunnions and two tubes.
    def binocular(x,y,z,bearing=0):
        angle=math.radians(bearing)
        def p(a,b,c):return (x+a*math.cos(angle)-b*math.sin(angle),y+a*math.sin(angle)+b*math.cos(angle),z+c)
        cyl('bridge.optics-foot',(x,y,z+.06),.18,.12,steel,vertices=12)
        rod('bridge.optics-column',p(0,0,.10),p(0,0,.92),.065,steel,r2=.045,vertices=10)
        rod('bridge.optics-trunnion',p(0,-.17,.96),p(0,.17,.96),.045,edge,vertices=8)
        for sign in [-1,1]:
            rod('bridge.optics-fork',p(0,sign*.17,.78),p(0,sign*.17,1.06),.025,steel,vertices=6)
            rod('bridge.optics-tube',p(-.17,sign*.095,1.05),p(.28,sign*.095,1.12),.061,edge,r2=.076,vertices=10)
            rod('bridge.optics-ocular',p(-.23,sign*.095,1.04),p(-.17,sign*.095,1.05),.04,mats['bronze'],vertices=8)
            rod('bridge.optics-lens',p(.28,sign*.095,1.12),p(.287,sign*.095,1.121),.060,glass,vertices=12)
    for z,locations in [
        (32.11,[(34.15,-1.9),(34.15,1.9),(33,-2.65),(33,2.65),(30.5,-2.7),(30.5,2.7),(28.1,-3.45),(28.1,3.45),(25,-2.2),(25,2.2)]),
        (29.36,[(32.3,-2.2),(32.3,2.2),(30.6,-3.2),(30.6,3.2),(28.4,-2.65),(28.4,2.65)]),
        (26.47,[(33.1,-2.9),(33.1,2.9),(30.6,-3.35),(30.6,3.35),(26.2,-2.6),(26.2,2.6)]),
        (23.71,[(33.2,-2.7),(33.2,2.7),(30.6,-2.6),(30.6,2.6)]),
        (20.43,[(35.7,-2.0),(35.7,2.0),(33.8,-4.3),(33.8,4.3),(30.8,-4.2),(30.8,4.2)]),
        (17.82,[(22,-3.7),(22,3.7)]),
        (15.63,[(33.1,-4.7),(33.1,4.7)])]:
        for x,y in locations:binocular(x,y,z,0 if x>32 else (-35 if y<0 else 35))
    # Compact horns on stalks at the top observation deck's two forward sides.
    for sign in [-1,1]:
        floor('horn-bracket',oval(30.25,sign*3.4,.58,.63,24),32.11)
        for x,z in [(30.05,33.12),(30.45,32.76)]:
            y=sign*3.75
            rod('director.horn-post',(x,y,32.11),(x,y,z),.035,steel,vertices=8)
            rod('director.horn',(x-.18,y,z),(x+.3,y,z+.12),.065,steel,r2=.20,vertices=20)
            rod('director.horn-mouth',(x+.3,y,z+.12),(x+.305,y,z+.122),.177,dark,vertices=20)
    # Searchlight yokes, lens rings and physically supported small galleries.
    for x,y,z in [(29.6,-4.3,23.71),(29.6,4.3,23.71),(22.7,-5.0,17.82),(22.7,5.0,17.82)]:
        sign=1 if y>0 else -1
        platform=oval(x,y,.63,.68,24);floor('searchlight-platform',platform,z)
        rail('bridge.searchlight-rail',platform,z,.55)
        root=(30.8,sign*.2,z-1.0) if z>20 else (24.5,sign*2.85,z-.9)
        rod('bridge.searchlight-knee',root,(x,y,z-.16),.08,steel,vertices=8)
        cyl('bridge.searchlight-pedestal',(x,y,z+.28),.16,.56,steel,vertices=16)
        rod('bridge.searchlight-bearing',(x,y-.44,z+.75),(x,y+.44,z+.75),.06,edge,vertices=10)
        for dy in [-.43,.43]:rod('bridge.searchlight-fork',(x,y+dy,z+.40),(x,y+dy,z+.96),.045,steel,vertices=8)
        rod('bridge.searchlight-drum',(x-.23,y,z+.97),(x+.20,y,z+.97),.39,steel,vertices=32)
        rod('bridge.searchlight-rim',(x+.20,y,z+.97),(x+.27,y,z+.97),.42,edge,vertices=32)
        rod('bridge.searchlight-lens',(x+.272,y,z+.97),(x+.277,y,z+.97),.365,mats['canvas'],vertices=32)
    # Lower optical directors are separate installations, not details of the
    # adjacent AA guns. Their dimensions and datums follow the inspected fit.
    def rangefinder_house(name,x,y,z,radius,height,span,along_x=False):
        prism('bridge.'+name+'-housing',oval(x,y,radius,radius,48),z,z+height)
        cyl('bridge.'+name+'-bearing',(x,y,z-.075),radius*1.025,.15,edge,vertices=40)
        prism('bridge.'+name+'-roof-lid',rect(x-radius*.68,x+radius*.68,y-radius*.64,y+radius*.64,.17),z+height,z+height+.055)
        axis=(1,0) if along_x else (0,1)
        for side in [-1,1]:
            a=(x+axis[0]*side*radius*.8,y+axis[1]*side*radius*.8,z+height*.60)
            b=(x+axis[0]*side*span/2,y+axis[1]*side*span/2,z+height*.60)
            rod('bridge.'+name+'-tube',a,b,.24,steel,vertices=24)
            c=(b[0]+axis[0]*side*.08,b[1]+axis[1]*side*.08,b[2])
            rod('bridge.'+name+'-end',b,c,.31,edge,vertices=24)
            # Narrow eyepiece and armored forehead on the forward face.
            box('bridge.'+name+'-brow',(x+radius-.015,y+side*.25,z+height*.66),(.08,.23,.15),edge)
            box('bridge.'+name+'-eyepiece',(x+radius+.035,y+side*.25,z+height*.66),(.025,.12,.055),mats['bronze'])
    for sign in [-1,1]:
        # Paired housings immediately behind the forward high AA platform.
        y=sign*2.68
        prism(f'bridge.forward-director-{sign}-foot',oval(38.94,y,.83,.83,32),16.60,16.85)
        rangefinder_house(f'forward-director-{sign}',38.94,y,16.85,.94,1.70,4.54)
        # The side platform has a splayed tower, open diagonals and a raised
        # inner rangefinder column; the outer optical hood remains open.
        platform=rounded([(18.1,sign*5.75),(22.3,sign*5.75),(22.3,sign*9.8),
                          (21.1,sign*11.2),(18.55,sign*11.2),(18.1,sign*9.7)],.45)
        if sign<0:platform.reverse()
        floor(f'side-director-{sign}-deck',platform,13.096,.68)
        # Pierced plate uprights and two spoke-braced bays are visible in the
        # approved close-up. The raised seat follows the support relationship
        # visible beside the forward uptake; its precise outline is provisional.
        support=f'bridge.side-director-support-{sign}'
        # Raised seat tied into the forward uptake foundation. The outboard
        # overhang bridges the casemate roof instead of bearing on its drum.
        seat=[(18.35,sign*6.05),(21.45,sign*6.05),(21.45,sign*10.95),(18.35,sign*10.95)]
        if sign<0:seat.reverse()
        prism(f'bridge.side-director-{sign}-seat',seat,7.52,7.76)
        def sheet(points,offset):
            n=len(points);vs=points+[tuple(p[k]+offset[k] for k in range(3)) for p in points]
            fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]
            fs += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
            mesh(support,vs,fs,steel)
        def upright_y(outer,z):
            t=(z-7.75)/(12.94-7.75)
            return sign*((10.8-.65*t) if outer else (6.05+.60*t))
        for x in [18.65,21.15]:
            for outer in [False,True]:
                def p(u,z,back=False):
                    width=.58-(z-7.75)*.035
                    return (x+(.055 if back else -.055),upright_y(outer,z)+sign*u*width/2,z)
                if not outer:
                    sheet([p(-1,7.75),p(1,7.75),p(1,12.94),p(-1,12.94)],(.11,0,0))
                    continue
                # Actual through-holes, with front/back faces and inner walls.
                # The lower uninterrupted web bears on the existing foot.
                sheet([p(-1,7.75),p(1,7.75),p(1,10.30),p(-1,10.30)],(.11,0,0))
                for z0,z1 in [(10.30,10.96),(10.96,11.62),(11.62,12.28),(12.28,12.94)]:
                    center=(z0+z1)/2;outer_ring=[];inner_ring=[]
                    for i in range(24):
                        angle=i*math.tau/24;u,v=math.cos(angle),math.sin(angle)
                        k=max(abs(u),abs(v))
                        outer_ring.append(p(u/k,center+(z1-z0)/2*v/k))
                        inner_ring.append((x-.055,upright_y(True,center+.19*v)+sign*.105*u,center+.19*v))
                    vs=outer_ring+inner_ring+[(xx+.11,yy,zz) for xx,yy,zz in outer_ring+inner_ring]
                    fs=[]
                    for i in range(24):
                        j=(i+1)%24
                        fs += [(i,j,24+j,24+i),(48+i,72+i,72+j,48+j),
                               (i,48+i,48+j,j),(24+i,24+j,72+j,72+i)]
                    mesh(support,vs,fs,steel)
            # Transverse lower plating and open upper tie beam.
            def cross_panel(z0,z1):
                sheet([(x-.055,upright_y(False,z0),z0),(x-.055,upright_y(True,z0),z0),
                       (x-.055,upright_y(True,z1),z1),(x-.055,upright_y(False,z1),z1)],(.11,0,0))
            cross_panel(7.75,8.30);cross_panel(10.24,10.40);cross_panel(12.72,12.94)
        # Outboard face: a solid lower skirt, framed openings and the small
        # central gussets where eight flat braces meet in each bay.
        def outer_point(x,z):return (x,upright_y(True,z),z)
        def outer_panel(points):sheet([outer_point(x,z) for x,z in points],(0,sign*.07,0))
        outer_panel([(18.40,7.75),(21.40,7.75),(21.37,8.30),(18.43,8.30)])
        for z0,z1 in [(8.30,10.32),(10.32,12.85)]:
            cx,cz=19.9,(z0+z1)/2
            for ex,ez in [(18.65,z0),(cx,z0),(21.15,z0),(21.15,cz),
                          (21.15,z1),(cx,z1),(18.65,z1),(18.65,cz)]:
                dx,dz=ex-cx,ez-cz;length=math.hypot(dx,dz);nx,nz=-dz/length*.035,dx/length*.035
                outer_panel([(cx+nx,cz+nz),(ex+nx,ez+nz),(ex-nx,ez-nz),(cx-nx,cz-nz)])
            outer_panel([(cx+.18*math.cos(i*math.tau/8),cz+.18*math.sin(i*math.tau/8)) for i in range(8)])
            outer_panel([(18.65,z0-.06),(21.15,z0-.06),(21.15,z0+.06),(18.65,z0+.06)])
        for y in [sign*6.7,sign*10.15]:
            box('bridge.side-director-deck-beam',(20.2,y,12.86),(4.2,.20,.16),steel)
        # Inner column is attached to this platform and carries the transverse
        # rangefinder along the ship's longitudinal axis.
        prism(f'bridge.side-rangefinder-{sign}-column',oval(20.33,sign*7.0,1.16,1.16,40),13.096,15.57)
        rangefinder_house(f'side-rangefinder-{sign}',20.33,sign*7.0,15.57,1.15,1.24,4.96,True)
        x,y=19.85,sign*9.875
        cyl('bridge.side-director-foot',(x,y,13.19),1.17,.18,steel,vertices=40)
        # Ring with a true open interior, then four narrow curved hood ribs.
        shield('bridge.side-director-ring',oval(x,y,1.18,1.18,48),13.27,.34)
        for angle in [0,math.pi/2,math.pi,3*math.pi/2]:
            for i in range(8):
                a=i*math.pi/16;b=(i+1)*math.pi/16
                def p(t,offset):
                    radial=1.17*math.cos(t)
                    return (x+radial*math.cos(angle)-offset*math.sin(angle),
                            y+radial*math.sin(angle)+offset*math.cos(angle),13.60+1.18*math.sin(t))
                mesh('bridge.side-director-hood',[p(a,-.12),p(a,.12),p(b,.12),p(b,-.12)],[(0,1,2,3)],steel)
        binocular(x+.45,y,13.28,0)
        # A small service bridge joins the platform to the pagoda's lower walk.
        walkway=[(22.3,sign*5.75),(25.2,sign*3.1),(25.6,sign*3.6),(22.3,sign*6.7)]
        if sign<0:walkway.reverse()
        floor('side-director-access',walkway,13.096);rail('bridge.side-director-access-rail',walkway,13.096,.85)
        ladder('side-director-ladder',18.45,sign*6.8,8.1,13.096)
    # Lower portholes and doors break up the actual enclosed walls.
    for sign in [-1,1]:
        for x,y,levels in [(32.5,4.55,[9.25,12.0]),(34.0,4.55,[9.25,12.0]),
                           (28.5,2.8,[14.3,16.3]),(30.5,2.8,[14.3,16.3]),(33.5,2.8,[14.3,16.3])]:
            for z in levels:
                rod('bridge.porthole-rim',(x,sign*(y+.015),z),(x,sign*(y+.065),z),.16,edge,vertices=20)
                rod('bridge.porthole-glass',(x,sign*(y+.067),z),(x,sign*(y+.070),z),.123,dark,vertices=20)
        box('bridge.access-door',(29.0,sign*2.83,14.7),(.68,.055,1.6),edge)
        box('bridge.access-door-face',(29.0,sign*2.87,14.7),(.58,.025,1.48),steel)
        rod('bridge.door-handle',(28.8,sign*2.90,14.6),(28.8,sign*2.90,14.77),.02,edge,vertices=6)
        for z in [14.0,16.1]:rod('bridge.lower-strake',(28.1,sign*2.815,z),(35.1,sign*2.815,z),.026,edge,vertices=6)

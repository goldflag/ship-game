"""Hull, main deck and 01/02 deckhouse walls: rails, mooring and anchor gear, hatches, boats,
aircraft handling, underwater appendages, and the doors, scuttles and louvres of the lower deckhouses.

Region: the whole length at or below the 02 deck walls. Executed in build.py's scope after aft.py.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL)
for id in ['deckhouse-main','deckhouse-secondary']:
    s=next(s for s in D['structures'] if s['id']==id);ASSEMBLY=id
    for side in [-1,1]:
        poly=[(-c,-a) for a,c in s['footprint']]
        def edge_y(x):
            values=[a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]) for a,b in zip(poly,poly[1:]+poly[:1]) if min(a[0],b[0])<=x<=max(a[0],b[0]) and abs(b[0]-a[0])>.001]
            return side*max(abs(v) for v in values)
        for x in [-36,-29,-18,-9,1,11]:
            y=edge_y(x)
            z=s['baseY']+1.7
            rod('Porthole rim',(x,y-.04,z),(x,y+.04,z),.19,'edge',vertices=16)
            rod('Porthole glass',(x,y-.051,z),(x,y+.051,z),.135,'glass',vertices=16)
        for x in [-34,-6,10]:F.door('Watertight door',x,edge_y(x),s['baseY']+.06,.72,1.78)
        for x in [-26,-15,3]:F.vent('Ventilator',x,edge_y(x),s['baseY']+.8,1.3,.7)

COL=collections['Deck fittings'];ASSEMBLY='hull';F=Fittings(helpers,materials,COL)
deck_tubs=[(-m['position'][2],-m['position'][0],2.36) for m in D['mounts']
           if .03<m['weapon']['caliberM']<.1 and not m.get('parentMountId')
           and abs(m['position'][1]-deckz(-m['position'][2]))<.5]
def rail_spans(a,b):
    # The fixed splinter tubs replace the deck rail through each gun pit.
    # Terminate wires at their plating, leaving the rotating crew platform clear.
    a,b=Vector(a),Vector(b);delta=b-a;cuts={0.,1.}
    for x,y,r in deck_tubs:
        dx,dy=a.x-x,a.y-y;aa=delta.x**2+delta.y**2
        bb=2*(dx*delta.x+dy*delta.y);cc=dx*dx+dy*dy-r*r
        disc=bb*bb-4*aa*cc
        if aa>0 and disc>0:
            for t in [(-bb-math.sqrt(disc))/(2*aa),(-bb+math.sqrt(disc))/(2*aa)]:
                if 0<t<1:cuts.add(t)
    cuts=sorted(cuts)
    for lo,hi in zip(cuts,cuts[1:]):
        p=a.lerp(b,(lo+hi)/2)
        if not any((p.x-x)**2+(p.y-y)**2<r*r for x,y,r in deck_tubs):yield a.lerp(b,lo),a.lerp(b,hi)
for side in [-1,1]:
    points=[]
    for s in H['sections']:
        x=s['station']-H['length']/2;w,z=s['points'][-1]
        if w>.5:points.append((x,side*(w-.12),z))
    for a,b in [span for a,b in zip(points,points[1:]) for span in rail_spans(a,b)]:
        steps=max(1,math.ceil(math.dist(a,b)/2.8))
        for i in range(steps+1):
            p=Vector(a).lerp(Vector(b),i/steps)
            rod('Deck rail stanchion',p,p+Vector((0,0,.90)),.028,'naval',vertices=6)
        for dz in [.32,.64,.92]:rod('Deck guard wire',Vector(a)+Vector((0,0,dz)),Vector(b)+Vector((0,0,dz)),.014,'edge',vertices=4)
    for x in [-121,-100,-79,72,101,123]:
        w=loft_breadth(H,x,deckz(x)-.02);y=side*max(.7,w-1)
        box('Bollard plinth',(x,y,deckz(x)+.10),(1.45,.63,.20),'edge')
        for dx in [-.43,.43]:cyl('Mooring bitt',(x+dx,y,deckz(x)+.42),.17,.55,vertices=12)
    for x in [-86,-75,52,77,103]:F.reel('Cable reel',x,side*max(1,loft_breadth(H,x,deckz(x)-.1)-2),deckz(x),.42,1)
    for i in range(108):
        x=99+i*.265
        F.ring('Anchor chain link',(x,side*1.10,deckz(x)+.20),.19,.035,'z' if i%2 else 'y',segments=10)
    cyl('Anchor windlass',(99,side*1.4,deckz(99)+.40),.59,.75,'edge',vertices=20)
    # Open boats sit on the main deck beneath the Oerlikon galleries.
    F.boat('Deck launch',-13.5,side*13.4,deckz(-13.5)+.08,8.4,2,False)
for x in [-116,-98,-87,-76,78,94,119]:
    for y in [-2.1,2.1]:
        z=deckz(x);box('Deck hatch coaming',(x,y,z+.17),(1.25,1.08,.34))
        box('Deck hatch lid',(x,y,z+.36),(1.31,1.14,.07),'roof')
        rod('Hatch handle',(x-.2,y,z+.44),(x+.2,y,z+.44),.025,vertices=6)
        for dx in [-.2,.2]:rod('Handle foot',(x+dx,y,z+.38),(x+dx,y,z+.44),.022,vertices=6)
        cyl('Vent coaming',(x-2,y,z+.1),.33,.2,vertices=16)
        cyl('Mushroom vent',(x-2,y,z+.39),.30,.48,vertices=16)
        cyl('Vent cowl',(x-2,y,z+.67),.42,.12,vertices=16)
for x,height in [(134,4.8),(-134,2.9)]:rod('Ensign staff',(x,0,deckz(x)),(x,0,deckz(x)+height),.045,'naval',r2=.025,vertices=10)

COL=collections['Aircraft handling'];ASSEMBLY='aircraft-handling'
for side in [-1,1]:
    x,y,z=-115.5,side*7.4,5.9
    for xx in [-121,-111]:
        bottom=deckz(xx);top=z+.66;cyl('Catapult support',(xx,y,(top+bottom)/2),.48,top-bottom+.04,vertices=16)
    for dy in [-.65,.65]:
        box('Catapult rail',(-115.5,y+dy,z+.9),(21,.13,.20),'edge')
        box('Catapult lower chord',(-115.5,y+dy,z+.39),(21,.12,.16))
    for j in range(14):
        xx=-126+j*1.5
        rod('Catapult cross beam',(xx,y-.65,z+.9),(xx,y+.65,z+.9),.058,'naval',vertices=6)
        for dy in [-.65,.65]:rod('Catapult lattice',(xx,y+dy,z+.40),(xx+1.5,y+dy,z+.87),.055,'naval',vertices=6)
    box('Catapult trolley',(-114,y,z+1.1),(2.4,1.5,.18),'roof')
x=-132.2;z=deckz(x)
cyl('Crane pedestal',(x,0,z+.7),.78,1.4,vertices=24)
for side in [-1,1]:
    rod('Crane tower',(x,side*.5,z+.7),(x+3.5,side*.5,z+6.6),.095,'naval',vertices=8)
    rod('Crane boom upper',(x+3.5,side*.5,z+6.6),(x+13,side*.5,z+7.2),.075,'naval',vertices=8)
    rod('Crane boom lower',(x+3.5,side*.5,z+5.9),(x+13,side*.5,z+6.7),.075,'naval',vertices=8)
    for j in range(8):
        xx=x+3.5+j*1.18
        rod('Crane lattice',(xx,side*.5,z+5.9+j*.1),(xx+1.18,side*.5,z+6.6+(j+1)*.075),.045,'naval',vertices=6)
rod('Crane cross brace',(x+13,-.5,z+7.2),(x+13,.5,z+7.2),.06,'naval',vertices=8)
rod('Crane hoist wire',(x+13,0,z+7.2),(x+13,0,z+4.7),.026,vertices=6)
F=Fittings(helpers,materials,COL);F.ring('Crane hook',(x+13,0,z+4.5),.20,.045,'y',segments=12)

COL=collections['Underwater fittings'];ASSEMBLY='hull'
for side in [-1,1]:
    poly=[(-121,side*3.25),(-87,side*3.9),(-79,side*3.8),(-87,side*4.3),(-121,side*3.65)]
    prism('Shaft skeg',poly,-8.85,7.1,'antifouling')
    for x,y,z in [(-111,side*6.4,-6.4),(-120,side*3.55,-7.1)]:
        rod('Screw shaft',(x+15,y,z+.4),(x,y,z),.22,'antifouling',vertices=16)
        rod('Shaft strut',(x+2,y,0),(x+2,y,z),.19,'antifouling',vertices=12)
        rod('Propeller hub',(x-.5,y,z),(x+.6,y,z),.48,'bronze',r2=.25,vertices=20)
        for j in range(4):
            a=j*math.tau/4;yy,zz=math.cos(a),math.sin(a)
            vv=[(x+.10,y+yy*.4,z+zz*.4),(x-.20,y+yy*2.6-zz*.55,z+zz*2.6+yy*.55),(x+.17,y+yy*2.55+zz*.42,z+zz*2.55-yy*.42),(x+.32,y+yy*.55,z+zz*.55)]
            vv=vv+[(a+.075,b,c) for a,b,c in vv]
            mesh('Screw blade',vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'bronze')
    y=side*3.5
    rod('Rudder stock',(-125.5,y,-2.1),(-125.5,y,1.8),.20,'antifouling',vertices=16)
    mesh('Rudder',[(x,y+dy,z) for dy in [-.18,.18] for x,z in [(-124,-1.8),(-130,-1.8),(-128.5,-8.9),(-125,-8.9)]],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'antifouling')

"""Original connected deck fittings; executed by Iowa's build recipe."""
COL=collections['Superstructure'];ASSEMBLY='bridge-wing';F=Fittings(helpers,materials,COL)
bridge_details()
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
COL=collections['Masts and directors'];F=Fittings(helpers,materials,COL)
for m in D['modules']:
    if m['kind']!='fire-control':continue
    ASSEMBLY=m['id'];a,z,c=m['center'];x,y=-c,-a;main='main' in m['id'];base=z-m['size'][1]/2
    support=surface_height(x,y,base)
    if base>support:cyl(m['name']+' foundation',(x,y,(base+support)/2),1.3 if main else 1.65,base-support+.08,vertices=24)
    director_details(m,base)
ASSEMBLY='foremast'
def foremast_x(z):return 1.2-2.2*(min(46.4,z)-24.2)/22.2
def aftermast_x(z):return -36.4-1.1*(min(36.1,z)-11.43)/24.67
rod('Foremast trunk',(1.2,0,24.2),(-1,0,46.4),.30,'naval',r2=.16,vertices=20)
rod('Foremast topmast',(-1,0,46.3),(-1,0,50.7),.065,'edge',r2=.025,vertices=12)
for side in [-1,1]:rod('Foremast lower strut',(4.0,side*2.65,24.54),(-.15,0,37.3),.1,'naval',vertices=10)
for z,width in [(31.5,7.3),(39.2,4.8),(43.4,2),(47.2,1.4)]:
    x=foremast_x(z)
    rod('Foremast yard',(x,-width,z),(x,width,z),.065,'naval',r2=.045,vertices=10)
    for side in [-1,1]:rod('Yard stay',(foremast_x(z+1.9),0,z+1.9),(x,side*width,z),.016,'edge',vertices=4)
F.ladder('Foremast ladder',(1,-.31,25),(-1.05,-.2,46.4),.35)
for z in [26,31,36,41,45]:
    t=(z-25)/21.4;rod('Mast ladder standoff',(foremast_x(z),0,z),(1-2.05*t,-.31+.11*t,z),.035,'naval',vertices=6)
box('Radar platform',(1.8,0,39.2),(6,2,.22),'roof')
for side in [-1,1]:rod('Radar platform knee',(-.4,side*.65,36.9),(3.2,side*.65,39.1),.085,'naval',vertices=8)
cyl('Search radar pedestal',(4,0,39.85),.44,1.25,vertices=20)
before=set(scene.objects);cx,cz,r=4,43.4,3.05
for rr in [r,r*.67]:
    for i in range(24):
        a,b=i*math.tau/24,(i+1)*math.tau/24
        rod('Circular radar frame',(cx,rr*math.cos(a),cz+rr*math.sin(a)),(cx,rr*math.cos(b),cz+rr*math.sin(b)),.055 if rr==r else .025,'edge',vertices=6)
for i in range(12):
    a=i*math.tau/12
    rod('Radar radial rib',(cx-.55,0,cz),(cx,r*math.cos(a),cz+r*math.sin(a)),.038,'edge',vertices=6)
for yy in [i*.28 for i in range(-10,11)]:
    hh=math.sqrt(max(0,r*r-yy*yy))
    rod('Radar screen',(cx,yy,cz-hh),(cx,yy,cz+hh),.011,'edge',vertices=4)
rod('Radar yoke',(cx,0,40.1),(cx-.55,0,cz),.17,'naval',vertices=14)
radar_pivot('radar-search.yaw',(4,0,39.2),set(scene.objects)-before)
ASSEMBLY='mainmast'
rod('After mast',(-36.4,0,11.43),(-37.5,0,36.1),.24,'naval',r2=.105,vertices=16)
for z,width in [(25.4,4.8),(33.6,2.5)]:
    x=aftermast_x(z)
    rod('After mast yard',(x,-width,z),(x,width,z),.06,'naval',vertices=10)
    for side in [-1,1]:rod('After mast stay',(aftermast_x(z+2),0,z+2),(x,side*width,z),.016,vertices=4)
for side in [-1,1]:
    rod('Main aerial',(foremast_x(39.2),side*4.8,39.2),(aftermast_x(33.6),side*2.5,33.6),.014,vertices=4)
    rod('Forward stay',(-1,0,46),(22,side*4,17.2),.017,vertices=4)
    rod('After stay',(-37.4,0,34.5),(-51,side*2.0,11.08),.017,vertices=4)

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

# Visible Mk.1/Mk.4 mechanisms, reconstructed from the approved close-ups.
# Carriage fittings train with yaw; feeds and sights elevate; the breech and
# cooling sleeves recoil with their barrel. No external meshes enter this recipe.
COL=collections['Light AA'];F=Fittings(helpers,materials,COL)
for m in D['mounts']:
    w=m['weapon']
    if w['caliberM']>=.1:continue
    ASSEMBLY=m['id'];yaw=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.yaw')
    heavy=w['caliberM']>.03;before=set(scene.objects)
    if heavy:
        # The Mk.1 has an open fork below its loading trays. A solid generic
        # pedestal at breech height would occupy the rearward elevation sweep.
        for obj in list(yaw.children):
            if obj.type=='MESH' and any(obj.name.startswith(m['id']+'.'+suffix) for suffix in ['pedestal','carriage-saddle','cradle','seat','sight']):
                bpy.data.objects.remove(obj,do_unlink=True)
        cyl('Bofors lower training drum',(0,0,.33),.52,.24,vertices=32,r2=.43)
        box('Bofors fork crossmember',(.075,0,.445),(.40,1.97,.11))
        for side in [-1,1]:
            box('Bofors bearing cheek',(.15,side*.9216,1.18),(.29,.16,1.47))
            rod('Bofors fork brace',(-.38,side*.9216,.45),(.15,side*.9216,1.53),.055,'naval',vertices=8)
        box('Bofors perforated crew platform',(-.50,0,.39),(2.10,2.42,.12),'roof')
        cyl('Training gear housing',(0,0,.29),.67,.21,'edge',vertices=40)
        for side in [-1,1]:
            for x in [-1.43,.25]:rod('Platform support',(0,0,.25),(x,side*1.15,.37),.07,'naval',vertices=8)
            rod('Crew guardrail',(-1.48,side*1.16,.47),(-1.48,side*1.16,1.12),.027,'naval',vertices=6)
            rod('Crew guardrail',(-1.48,side*1.16,1.12),(.22,side*1.16,1.12),.027,'naval',vertices=6)
            rod('Crew guardrail',(.22,side*1.16,1.12),(.22,side*1.16,.47),.027,'naval',vertices=6)
            box('Bofors drive housing',(.08,side*.66,.96),(.73,.43,.67))
            rod('Handwheel shaft',(-.25,side*.65,1.32),(-.25,side*.99,1.32),.042,'edge',vertices=10)
            F.ring('Bofors handwheel',(-.25,side*.99,1.32),.24,.023,'y',segments=18)
            for a in [0,math.tau/3,2*math.tau/3]:rod('Handwheel spoke',(-.25,side*.99,1.32),(-.25+.24*math.cos(a),side*.99,1.32+.24*math.sin(a)),.018,'edge',vertices=6)
            rod('Handwheel crank',(-.49,side*.99,1.32),(-.49,side*1.08,1.32),.029,'dark',vertices=8)
            box('Operator seat pan',(-.75,side*.84,.86),(.44,.42,.075),'edge')
            rod('Seat pedestal',(-.75,side*.84,.45),(-.75,side*.84,.84),.045,'naval',vertices=8)
            rod('Seat back bracket',(-.92,side*.84,.83),(-1.01,side*.84,1.12),.030,'naval',vertices=6)
            box('Operator seat back',(-1.015,side*.84,1.11),(.055,.41,.30),'edge')
            for x in [-.16,.18]:
                for z in [.75,1.17]:rod('Drive housing bolt',(x,side*.875,z),(x,side*.903,z),.027,'edge',vertices=6)
            box('Foot pedal',(-.11,side*.89,.58),(.22,.28,.045),'edge')
            rod('Pedal linkage',(-.11,side*.89,.60),(.14,side*.67,.84),.02,'edge',vertices=6)
    else:
        # Mk.4 twin shield plates have thickness, trimmed upper corners and
        # rear brackets. Replace only this variant's shared rectangular shields.
        for obj in list(yaw.children):
            if obj.type=='MESH' and obj.name.startswith(m['id']+'.shield'):
                obj.hide_render=True;obj.hide_set(True)
                bpy.data.objects.remove(obj,do_unlink=True)
        for side in [-1,1]:
            cy=side*.39
            yz=[(cy-.32,.75),(cy+.32,.75),(cy+.32,1.63),(cy+.21,1.82),(cy-.32,1.76)]
            n=len(yz);vv=[(x,y,z) for x in [.175,.205] for y,z in yz]
            mesh('Mk.4 splinter shield',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
            for z in [.86,1.25]:
                rod('Shield support',(.1,side*.18,1.1),(.17,cy,z),.030,'naval',vertices=8)
                for y in [cy-.21,cy+.21]:rod('Shield bolt',(.205,y,z),(.224,y,z),.022,'edge',vertices=6)
            rod('Pedestal locking lever',(0,side*.23,.70),(-.20,side*.37,.88),.024,'edge',vertices=8)
        cyl('Pedestal collar',(0,0,.91),.23,.085,'edge',vertices=24)
        for z in [.33,.66,1.02]:F.ring('Pedestal seam',(0,0,z),.206,.018,segments=16)
    attach_all(set(scene.objects)-before,yaw)
    for barrel in (['left','right'] if heavy else ['center']):
        elevation=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.'+barrel+'.elevation')
        recoil=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.'+barrel+'.recoil')
        before=set(scene.objects)
        if heavy:
            box('Bofors loading tray',(-.77,0,.06),(.90,.21,.075),'edge')
            for side in [-1,1]:
                box('Feed guide',(-.74,side*.12,.25),(.79,.04,.40))
                rod('Loader tray strut',(-.16,side*.13,-.04),(-1.18,side*.13,.08),.030,'naval',vertices=8)
            # Four rounds form the visible vertical clip, with separate cases.
            for x in [-1.03,-.84,-.65,-.46]:
                rod('Bofors feed round',(x,0,.14),(x,0,.50),.035,'bronze',r2=.025,vertices=8)
            rod('Recoil cylinder',(-.33,0,-.17),(.64,0,-.17),.086,'naval',r2=.064,vertices=16)
            for x in [.23+i*.034 for i in range(16)]:F.ring('Bofors cooling ring',(x,0,0),.084,.010,'x',segments=12)
        else:
            # The drum face is transverse to the gun, with a separate rim,
            # latch and stamped radial ribs, as visible behind the shield.
            for obj in list(elevation.children):
                if obj.type=='MESH' and any(obj.name.startswith(m['id']+'.'+suffix) for suffix in ['shoulder','sight']):bpy.data.objects.remove(obj,do_unlink=True)
            for obj in list(recoil.children):
                if obj.type=='MESH' and obj.name.startswith(m['id']+'.drum'):bpy.data.objects.remove(obj,do_unlink=True)
            rod('Oerlikon drum',(-.22,-.13,.23),(-.22,.13,.23),.24,'dark',vertices=28)
            for side in [-1,1]:
                F.ring('Drum retaining rim',(-.22,side*.137,.23),.235,.014,'y',segments=24)
                for a in [i*math.tau/8 for i in range(8)]:rod('Drum rib',(-.22,side*.145,.23),(-.22+.20*math.cos(a),side*.145,.23+.20*math.sin(a)),.010,'edge',vertices=4)
            box('Magazine latch',(-.44,0,.03),(.12,.26,.10),'edge')
            for x in [.16+i*.034 for i in range(9)]:F.ring('Oerlikon recoil spring',(x,0,0),.051,.007,'x',segments=10)
            for side in [-1,1]:
                rod('Shoulder rest',(-.52,side*.11,-.02),(-.91,side*.30,-.07),.025,'edge',vertices=8)
                box('Shoulder pad',(-.92,side*.30,-.06),(.09,.17,.20),'dark')
            rod('Cocking lever',(-.18,-.07,-.05),(-.18,-.28,-.07),.023,'edge',vertices=8)
        attach_all(set(scene.objects)-before,recoil)
        before=set(scene.objects)
        side=-1 if barrel=='left' else 1
        yy=side*.35 if heavy else .10
        rod('Sight bracket',(.02,0,.08),(.12,yy,.39),.023,'naval',vertices=8)
        F.ring('Ring sight',(.12,yy,.47),.15 if heavy else .11,.013,'x',segments=16)
        rod('Sight crosshair',(.12,yy-.10,.47),(.12,yy+.10,.47),.006,'edge',vertices=4)
        rod('Sight crosshair',(.12,yy,.37),(.12,yy,.57),.006,'edge',vertices=4)
        attach_all(set(scene.objects)-before,elevation)

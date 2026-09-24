"""Forward superstructure: bridge tiers, conning tower top, bridge galleries and their fittings.

Region: z < -8.5 m (runtime) above the 02 deck (11.05 m), plus the 01-level wing
AA positions beside the bridge. Executed in build.py's scope after every mount
exists; uses only details.py and the build.py primitives.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL);structures={s['id']:s for s in D['structures']}

def path_rail(name,path,z,height=.92):
    for a,b in zip(path,path[1:]):
        count=max(1,math.ceil(math.dist(a,b)/1.2))
        for i in range(count+1):
            t=i/count;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            rod(name+' stanchion',(x,y,z),(x,y,z+height),.022,'naval',vertices=6)
        for dz in [height*.48,height]:rod(name+' wire',(*a,z+dz),(*b,z+dz),.014,'edge',vertices=4)

def path_wall(name,path,z,height,thickness=.055):
    for a,b in zip(path,path[1:]):
        length=math.dist(a,b)
        obj=box(name,((a[0]+b[0])/2,(a[1]+b[1])/2,z+height/2),(length,thickness,height))
        obj.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
        rod(name+' coping',(*a,z+height),(*b,z+height),.024,'naval',vertices=6)

def window_band(s,z,height,predicate=lambda a,b:True):
    poly=outline_of(s)
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if not predicate(a,b):continue
        d=Vector((b[0]-a[0],b[1]-a[1],0));length=d.length
        if length<.22:continue
        normal=Vector((d.y,-d.x,0)).normalized()*.036
        count=max(1,round(length/.68));step=length/count
        for i in range(count):
            p=Vector((*a,z))+d*((i+.5)/count)+normal
            obj=box('Bridge glazing',p,(step-.055,.035,height),'glass');obj.rotation_euler.z=math.atan2(d.y,d.x)
        for dz in [-height/2,height/2]:rod('Bridge window frame',Vector((*a,z+dz))+normal,Vector((*b,z+dz))+normal,.028,'naval',vertices=6)

F=Fittings(helpers,materials,COL);structures={s['id']:s for s in D['structures']}
ASSEMBLY='bridge-wing';s=structures[ASSEMBLY];poly=outline_of(s)
window_band(s,16.69,.84,lambda a,b:not (a[0]<18 and b[0]<18))
# An open back gives access from the wing stairs to the roof bridge.
path_wall('Upper bridge splinter parapet',poly,17.575,1.042)
for side in [-1,1]:
    for x in [20.34,24.99]:
        y=side*(4.78 if x<22 else 3.61)
        rod('Bridge drain pipe',(x,y,15.22),(x,y,16.0),.032,'naval',vertices=8)
    # Sloped stair stringers and individual level treads.
    for yy in [side*4.0,side*4.80]:rod('Bridge stair stringer',(15.15,yy,15.195),(17.88,yy,17.575),.052,'naval',vertices=8)
    for i in range(10):
        t=i/9;box('Bridge stair tread',(15.15+2.73*t,side*4.40,15.195+2.38*t),(.34,.89,.05),'roof')
    for yy in [side*3.97,side*4.83]:
        rod('Bridge stair handrail',(15.15,yy,16.04),(17.88,yy,18.42),.025,'naval',vertices=8)
        for t in [0,.5,1]:rod('Stair rail post',(15.15+2.73*t,yy,15.195+2.38*t),(15.15+2.73*t,yy,16.04+2.38*t),.025,'naval',vertices=6)
# Raised windscreens cover only the forward part of the open upper bridge.
for a,b in zip(poly[3:7],poly[4:8]):
    d=Vector((b[0]-a[0],b[1]-a[1],0));count=max(1,round(d.length/.70))
    for i in range(count):
        q=Vector((*a,18.89))+d*((i+.5)/count)
        o=box('Open bridge windscreen',q,(d.length/count-.055,.045,.52),'glass');o.rotation_euler.z=math.atan2(d.y,d.x)
    rod('Windscreen top rail',(*a,19.16),(*b,19.16),.023,'naval',vertices=6)

ASSEMBLY='bridge-gallery';gallery=outline_of(structures[ASSEMBLY])
# Forward cabin replaces the gallery's outer windbreak ahead of the stairs.
for a,b in zip(gallery,gallery[1:]+gallery[:1]):
    if max(a[0],b[0])<=17.95:path_wall('Open bridge wing windbreak',[a,b],15.195,1.34)
for side in [-1,1]:
    for x,y in [(10.80,6.8),(14.1,6.20)]:
        # Inboard columns and high cantilevers clear the rotating Mk.32
        # gunhouse envelope below the wing, including intermediate train.
        inner=4.25
        rod('Bridge wing upright',(x,side*inner,11.43),(x,side*inner,15.17),.11,'naval',vertices=12)
        rod('Bridge wing diagonal',(x,side*3,11.43),(x,side*inner,15.16),.10,'naval',vertices=10)
        box('Bridge wing cap beam',(x,side*(y+inner)/2,15.165),(.16,y-inner,.06))
    # Pelorus and repeaters are seated on the open wing deck.
    cyl('Wing repeater pedestal',(11.75,side*5.70,15.57),.12,.75,vertices=12)
    cyl('Wing repeater head',(11.75,side*5.70,16.01),.23,.17,vertices=16)
ASSEMBLY='bridge-lower'
window_band(structures[ASSEMBLY],14.62,.79,lambda a,b:16<a[0]<24.5 and 16<b[0]<24.5)
for side in [-1,1]:
    F.door('Lower bridge wing door',14.35,side*3.01,13.1,.65,1.74)
    F.ladder('Conning trunk ladder',(25.77,side*1.16,8.65),(25.06,side*1.16,12.88),.42,normal='x')
for side in [-1,1]:
    ASSEMBLY='bridge-aa-port-platform' if side==1 else 'bridge-aa-starboard-platform'
    for x in [8.7,11.1]:
        rod('Bridge AA gallery column',(x,side*5.0,15.195),(x,side*5.0,18.01),.11,'naval',vertices=12)
        rod('Bridge AA gallery knee',(x,side*2.4,15.195),(x,side*6.5,18.01),.095,'naval',vertices=10)
ASSEMBLY='bridge-director-platform'
for side in [-1,1]:rod('Bridge director platform knee',(16.8,side*1.1,15.195),(16.8,side*1.8,17.48),.10,'naval',vertices=10)
ASSEMBLY='conning-top'
for angle in [-70,-35,0,35,70,155,205]:
    a=math.radians(angle);x=23.23+3.11*math.cos(a);y=2.89*math.sin(a)
    obj=box('Conning observation hood',(x,y,18.49),(.08,.66,.44));obj.rotation_euler.z=a
    obj=box('Conning vision slit',(x+.05*math.cos(a),y+.05*math.sin(a),18.49),(.025,.42,.065),'dark');obj.rotation_euler.z=a
ellipse('Conning roof compass plinth',23.23,0,19.10,.90,.68,.15,'naval',n=24)
cyl('Conning compass base',(23.23,0,19.41),.24,.40,vertices=20)
box('Conning compass binnacle',(23.23,0,19.82),(.39,.44,.53))
for x,y in [(24.65,-1.17),(24.65,1.17),(22.35,-1.9),(22.35,1.9)]:
    cyl('Conning vent base',(x,y,19.19),.21,.18,vertices=16)
    cyl('Conning short ventilator',(x,y,19.41),.13,.30,vertices=16)
    cyl('Conning vent cap',(x,y,19.58),.17,.055,vertices=16)
ASSEMBLY='bridge-wing'
ellipse('Forward searchlight platform',19.28,0,19.68,.92,1.13,.14,'roof',n=24)
for side in [-1,1]:
    rod('Searchlight platform leg',(19.28,side*.70,17.575),(19.28,side*.70,19.74),.10,'naval',vertices=10)
    rod('Searchlight platform knee',(20.8,side*.70,17.80),(19.28,side*.70,19.74),.07,'naval',vertices=8)
searchlight('Bridge searchlight',19.28,0,19.82,.61)


ASSEMBLY='director-secondary-forward';fire_control('director-secondary-forward')

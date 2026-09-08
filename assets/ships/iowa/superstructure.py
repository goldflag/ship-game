"""Original bridge, funnel and director fittings for the approved Iowa A fit."""

def outline_of(s):return [(-z,-x) for x,z in s['footprint']]

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

def searchlight(name,x,y,z,r=.55,bearing=0):
    before=set(scene.objects);cyl(name+' pedestal',(x,y,z+.22),.19,.44,vertices=16)
    for sign in [-1,1]:
        box(name+' fork',(x,y+sign*(r+.06),z+.67),(.11,.11,.83))
        rod(name+' axle',(x,y+sign*r,z+.98),(x,y+sign*(r+.13),z+.98),.06,'edge',vertices=10)
    rod(name+' drum',(x-.23,y,z+.98),(x+.29,y,z+.98),r,'naval',vertices=32)
    rod(name+' lens',(x+.29,y,z+.98),(x+.305,y,z+.98),r*.85,'glass',vertices=32)
    Fittings(helpers,materials,COL).ring(name+' bezel',(x+.31,y,z+.98),r*.96,.038,'x','naval',segments=32)
    if bearing:
        rotation=Matrix.Rotation(bearing,4,'Z');origin=Vector((x,y,z))
        for obj in set(scene.objects)-before:
            obj.location=origin+rotation.to_3x3()@(obj.location-origin);obj.rotation_euler=(rotation.to_3x3()@obj.rotation_euler.to_matrix()).to_euler()

def bridge_details():
    global ASSEMBLY
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

    for id in ['tower-platform','tower-crown']:
        ASSEMBLY=id;s=structures[id];poly=outline_of(s);z=s['baseY']+s['height']
        wall('Observation platform bulwark',poly,z,1.02 if id=='tower-platform' else 1.015,.06)
        for side in [-1,1]:
            for x in ([3.8,8.4] if id=='tower-platform' else [4.8,6.2,9.0]):
                y=3.2 if id=='tower-platform' or x>8 else 6.8
                rod('Observation wing supporting knee',(min(x,7.95),side*1.85,z-1.30),(x,side*y,z-.06),.075,'naval',vertices=8)
        for x,y in ([(9.7,-1.9),(9.7,1.9)] if id=='tower-platform' else [(5.6,-6.2),(5.6,6.2),(9.2,0)]):
            cyl('Observation instrument pedestal',(x,y,z+.34),.10,.68,vertices=12)
            rod('Observation binoculars',(x-.1,y-.22,z+.83),(x+.14,y-.22,z+.83),.068,'edge',vertices=10)
            rod('Observation binoculars',(x-.1,y+.22,z+.83),(x+.14,y+.22,z+.83),.068,'edge',vertices=10)
            rod('Binocular crosspiece',(x,y-.22,z+.74),(x,y+.22,z+.74),.058,'naval',vertices=10)
    ASSEMBLY='tower-upper'
    for side in [-1,1]:
        for z in [27.95,31.43]:
            y=side*(2.29-(z-24.532)/7.608*.38)
            for x in ([4.4,5.9,7.45] if z<30 else [7.45]):
                box('Tower observation coaming',(x,y,z),(.73,.065,.34))
                box('Tower observation slit',(x,y+side*.038,z),(.55,.025,.15),'glass')
        F.ladder('Upper tower access',(7.65,side*2.30,24.55),(7.65,side*1.97,32.20),.42)
        for z in [25,27,29,31]:rod('Tower ladder standoff',(7.65,side*(2.29-(z-24.532)/7.608*.38),z),(7.65,side*(2.30-(z-24.55)/7.65*.33),z),.035,'naval',vertices=6)
        # Routed conduits sit just proud of the sloping plating.
        path=[(5.1,side*2.25,24.57),(5.1,side*2.14,27.5),(3.2,side*2.14,27.5),(3.2,side*2.0,30.0),(2.7,side*2.0,30.0)]
        for a,b in zip(path,path[1:]):rod('Tower routed conduit',a,b,.045,'naval',vertices=8)
    ASSEMBLY='tower-base'
    for side in [-1,1]:
        for z in [14.1,17.5,21.0]:
            rod('Tower porthole coaming',(1.95,side*2.45,z),(1.95,side*2.54,z),.20,'naval',vertices=20)
            rod('Tower porthole',(1.95,side*2.55,z),(1.95,side*2.57,z),.145,'glass',vertices=20)
        for z in [12.5,18.4]:F.vent('Tower ventilation grille',4.9,side*2.51,z,1.20,1.70)
        F.door('Control tower watertight door',6.45,side*2.51,11.47,.78,1.90)
    ASSEMBLY='tower-director-column'
    for z in [33.55,34.66,35.75]:
        rx=2.25-(z-32.14)/4.4435*.30;ry=1.85-(z-32.14)/4.4435*.20
        path=[(6.55+rx*math.cos(i*math.tau/40),ry*math.sin(i*math.tau/40),z) for i in range(40)]
        for a,b in zip(path,path[1:]+path[:1]):rod('Director column horizontal seam',a,b,.018,'edge',vertices=4)

def director_details(m,base):
    """The low Mk.38 and sloped Mk.37 heads have distinct optics and antennas."""
    a,z,c=m['center'];x,y=-c,-a;main='main' in m['id'];before=set(scene.objects)
    def head(bottom,top,z0,z1):
        n=len(bottom);vv=[(x+a,y+b,zz) for poly,zz in [(bottom,z0),(top,z1)] for a,b in poly]
        return mesh('Mk.38 armored head' if main else 'Mk.37 armored head',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'naval')
    cyl('Director training race',(x,y,base+.13),1.57,.26,'edge',vertices=40)
    if main:
        bottom=[(-1.76,-1.12),(-1.31,-1.50),(1.34,-1.50),(1.76,-1.06),(1.76,1.06),(1.34,1.50),(-1.31,1.50),(-1.76,1.12)]
        top=[(-1.35,-.95),(-1.05,-1.20),(1.03,-1.20),(1.39,-.86),(1.39,.86),(1.03,1.20),(-1.05,1.20),(-1.35,.95)]
        head(bottom,bottom,base+.24,base+.64);head(bottom,top,base+.64,base+1.59)
        for side in [-1,1]:
            box('Mk.38 armored rangefinder wing',(x+.18,y+side*3.057,base+.61),(1.024,3.314,1.06))
            box('Mk.38 wing optical bezel',(x+.706,y+side*4.42,base+.53),(.065,.29,.55),'edge')
            box('Mk.38 wing objective',(x+.749,y+side*4.42,base+.53),(.025,.17,.41),'glass')
            for yy in [side*1.75,side*3.15,side*4.60]:
                rod('Mk.38 wing roof rail post',(x-.2,y+yy,base+1.14),(x-.2,y+yy,base+1.38),.018,'naval',vertices=6)
            rod('Mk.38 wing roof rail',(x-.2,y+side*1.75,base+1.38),(x-.2,y+side*4.60,base+1.38),.018,'naval',vertices=6)
        for yy in [-.77,.77]:
            box('Mk.38 sight cover',(x+1.53,y+yy,base+1.01),(.18,.37,.55))
            box('Mk.38 vision slit',(x+1.63,y+yy,base+.88),(.025,.23,.24),'dark')
        # The approved fit has a long covered instrument above the head,
        # alongside a smaller rectangular unit on its own four-legged stand.
        for side in [-1,1]:
            for xx in [-.76,.12]:rod('Covered instrument trestle',(x+xx,y+side*1.24,base+1.59),(x-.28,y+side*1.24,base+2.37),.050,'naval',vertices=8)
        cross=[(-.76,2.56),(-.73,2.90),(-.58,3.10),(.08,3.10),(.24,2.94),(.27,2.59),(.12,2.36),(-.57,2.36)]
        vv=[(x+xx,y+yy,base+zz) for yy in [-2.05,2.05] for xx,zz in cross]
        mesh('Main director covered instrument',vv,[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],'naval',smooth=True)
        for yy in [-1.65,-1.1,-.55,0,.55,1.1,1.65]:
            path=[(x+xx,y+yy,base+zz+.006) for xx,zz in cross[:5]]
            for a,b in zip(path,path[1:]):rod('Instrument cover seam',a,b,.009,'edge',vertices=4)
        for xx in [-.65,.15]:
            for yy in [2.17,2.77]:rod('Director auxiliary instrument leg',(x+xx,y+yy,base+1.14),(x-.20,y+(yy-2.47)*.5+2.47,base+2.19),.036,'naval',vertices=8)
        box('Director auxiliary instrument',(x-.20,y+2.47,base+2.44),(.62,.69,.48))
        box('Director auxiliary window',(x+.123,y+2.47,base+2.44),(.025,.43,.15),'glass')
    else:
        bottom=[(-1.95,-1.24),(-1.59,-1.48),(1.61,-1.48),(1.96,-1.14),(1.96,1.14),(1.61,1.48),(-1.59,1.48),(-1.95,1.24)]
        top=[(-1.84,-1.19),(-1.49,-1.43),(.35,-1.43),(.53,-1.10),(.53,1.10),(.35,1.43),(-1.49,1.43),(-1.84,1.19)]
        head(bottom,bottom,base+.25,base+.70);head(bottom,top,base+.70,base+2.59)
        for yy in [-.74,0,.74]:
            for zz,dx,h in [(1.18,1.61,.34),(1.93,1.02,.33)]:
                obj=box('Mk.37 observation bezel',(x+dx,y+yy,base+zz),(.065,.43,h),'edge');obj.rotation_euler.y=-.648
                obj=box('Mk.37 dark observation port',(x+dx+.031,y+yy,base+zz+.02),(.028,.29,h-.12),'glass');obj.rotation_euler.y=-.648
            obj=box('Mk.37 raised shutter',(x+.59,y+yy,base+2.75),(.07,.43,.57));obj.rotation_euler.y=-.12
            rod('Mk.37 shutter hinge',(x+.72,y+yy-.22,base+2.46),(x+.72,y+yy+.22,base+2.46),.028,'edge',vertices=8)
            obj=box('Mk.37 lower shutter',(x+1.89,y+yy,base+.92),(.42,.43,.055));obj.rotation_euler.y=.22
        for side in [-1,1]:
            rod('Mk.37 rangefinder sleeve',(x-.22,y+side*1.4,base+1.45),(x-.22,y+side*2.31,base+1.45),.12,'naval',vertices=16)
            rod('Mk.37 rangefinder objective',(x-.03,y+side*2.24,base+1.45),(x+.04,y+side*2.24,base+1.45),.10,'glass',vertices=16)
            box('Mk.37 rangefinder end',(x-.18,y+side*2.24,base+1.45),(.33,.27,.29))
        # Curved two-tier open radar screens, with diagonal support trusses.
        for side in [-1,1]:
            rod('Mk.37 radar tripod',(x-.80,y+side*.95,base+2.59),(x-.28,y+side*.40,base+4.02),.050,'naval',vertices=8)
            rod('Mk.37 radar tripod',(x+.23,y+side*.95,base+2.59),(x-.28,y+side*.40,base+4.02),.050,'naval',vertices=8)
        for z0,z1,depth in [(3.15,3.98,.50),(4.27,5.0,.38)]:
            path=[(-.22+depth*((i/8-.5)**2*4),z0+(z1-z0)*i/8) for i in range(9)]
            for xx,zz in [path[0],path[-1]]:rod('Mk.37 radar horizontal frame',(x+xx,y-1.19,base+zz),(x+xx,y+1.19,base+zz),.028,'naval',vertices=8)
            for yy in [-1.19,1.19]:
                for a,b in zip(path,path[1:]):rod('Mk.37 curved radar rail',(x+a[0],y+yy,base+a[1]),(x+b[0],y+yy,base+b[1]),.025,'naval',vertices=6)
            for i in range(-9,10):
                for a,b in zip(path,path[1:]):rod('Mk.37 radar mesh',(x+a[0],y+i*.125,base+a[1]),(x+b[0],y+i*.125,base+b[1]),.008,'edge',vertices=4)
            for xx,zz in path[1:-1]:rod('Mk.37 radar mesh',(x+xx,y-1.19,base+zz),(x+xx,y+1.19,base+zz),.008,'edge',vertices=4)
        rod('Mk.37 radar spine',(x-.15,y,base+2.59),(x-.15,y,base+4.95),.048,'naval',vertices=8)
    Fittings(helpers,materials,COL).ladder('Director rear access',(x-1.98,y,base+.1),(x-1.89,y,base+(1.55 if main else 2.56)),.44,normal='x')
    angle=math.pi if 'aft' in m['id'] else math.pi/2 if 'port' in m['id'] else -math.pi/2 if 'starboard' in m['id'] else 0
    if angle:
        bpy.context.view_layer.update();rotation=Matrix.Translation((x,y,base))@Matrix.Rotation(angle,4,'Z')@Matrix.Translation((-x,-y,-base))
        for obj in set(scene.objects)-before:obj.matrix_world=rotation@obj.matrix_world

def funnel_details(s,obj):
    global ASSEMBLY
    ASSEMBLY=s['id'];dx=0 if s['id']=='funnel-forward' else -24.70;dz=0 if dx==0 else -.60
    # Open the blueprint's exhaust closure for a recessed visual chimney.
    old=obj.data;last=len(s['surface']['vertices'])-42;verts=[tuple(v.co) for v in old.vertices]
    faces=[tuple(p.vertices) for p in old.polygons if not all(i>=last for i in p.vertices)]
    data=bpy.data.meshes.new(s['id']+' open hood');data.from_pydata(verts,[],faces);data.update()
    data.materials.append(materials['naval']);obj.data=data
    for p in data.polygons:p.use_smooth=True
    data.set_sharp_from_angle(angle=math.radians(38))
    n=64;vv=[]
    # The black lip is extruded normal to its raked plane, with an inner wall.
    for x,z,rx,ry in [(-4.16,27.792,2.175,1.65),(-4.56,28.5375,2.09,1.59),(-4.56,28.5375,1.94,1.44),(-4.16,26.94,1.94,1.44)]:
        vv.extend((x+rx*math.cos(i*math.tau/n)+dx,ry*math.sin(i*math.tau/n),z+.416*rx*math.cos(i*math.tau/n)+dz) for i in range(n))
    ff=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
    ff.append(tuple(reversed(range(3*n,4*n))));mesh('Raked black funnel lip and recessed uptake',vv,ff,'dark',smooth=True)
    for along in [-1.35,-.45,.45,1.35]:
        half=1.43*math.sqrt(1-(along/1.94)**2);x=-4.56+along+dx;z=28.47+.416*along+dz
        box('Funnel uptake grating',(x,0,z),(.09,2*half,.095),'edge')
    rod('Funnel grating spine',(-6.48+dx,0,27.67+dz),(-2.64+dx,0,29.27+dz),.045,'edge',vertices=8)
    F=Fittings(helpers,materials,COL)
    # Service walkway follows the jacket at the hood shoulder.
    poly=[(dx-4.30+(-z-dx+4.30)*1.10,-x*1.20) for x,y,z in s['surface']['vertices'][126:168]]
    n=len(poly)
    # Annular plate instead of a disk through the uptake.
    vv=[(x,y,26.155+dz+zz) for zz in [-.055,.055] for ring in [poly,[(dx-4.30+(x-dx+4.30)*.84,y*.83) for x,y in poly]] for x,y in ring]
    ff=[]
    for i in range(n):
        j=(i+1)%n
        for a,b in [(0,n),(2*n,0),(n,3*n),(3*n,2*n)]:ff.append((a+i,a+j,b+j,b+i))
    mesh('Funnel annular service walkway',vv,ff,'roof')
    path_rail('Funnel walkway rail',poly+[poly[0]],26.21+dz,.82)
    for i in range(0,n,3):
        x,y=poly[i];inner=Vector((dx-4.30+(x-dx+4.30)*.88,y*.82,25.17+dz));outer=Vector((x,y,26.10+dz));near=Vector((inner.x,inner.y,26.10+dz))
        tangent=Vector((-y,x-dx+4.30,0)).normalized()
        vv=[tuple(v+tangent*shift) for shift in [-.028,.028] for v in [inner,outer,near]]
        mesh('Funnel walkway plate knee',vv,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],'naval')
    for side in [-1,1]:
        F.ladder('Funnel jacket ladder',(-2.68+dx,side*2.56,13.0),(-2.68+dx,side*2.56,26.17+dz),.41)
        F.ladder('Funnel cap ladder',(-5.40+dx,side*2.31,26.21+dz),(-5.55+dx,side*1.96,27.44+dz),.37)
        for z in [26.3,27.2]:
            t=(z-26.21)/1.23;xx=-5.40-.15*t+dx;yy=2.31-.35*t
            rod('Funnel cap ladder shoe',(xx,side*1.75,z+dz),(xx,side*yy,z+dz),.028,'naval',vertices=6)
        for z in [14,18,22,25]:rod('Funnel ladder shoe',(-2.68+dx,side*2.30,z),(-2.68+dx,side*2.59,z),.030,'naval',vertices=6)
        # Two bent steam outlets emerge along the after edge of each hood.
        y=side*.63;path=[(-8.42+dx,y,12.0),(-8.42+dx,y,26.0+dz),(-8.61+dx,y,26.65+dz),(-8.83+dx,y,26.92+dz),(-9.12+dx,y,26.92+dz)]
        for a,b in zip(path,path[1:]):rod('Funnel gooseneck steam pipe',a,b,.104,'naval' if a[2]<25 else 'dark',vertices=12)
        for z in [15,20,24]:rod('Steam pipe bracket',(-7.72+dx,y,z),(-8.47+dx,y,z),.044,'naval',vertices=8)
    if dx:
        # The after funnel's searchlight gallery is carried from its jacket.
        for side in [-1,1]:
            ellipse('After funnel searchlight gallery',-28.7,side*4.00,20.40,1.45,1.36,.14,'roof',n=28)
            for x in [-29.4,-28.0]:rod('Searchlight gallery knee',(x,side*1.9,18.2),(x,side*4.1,20.4),.095,'naval',vertices=10)
            searchlight('After funnel searchlight',-28.7,side*4.00,20.54,.50,side*math.pi/2)

"""Aft superstructure: the after 03 deckhouse and its Mk.37 platform, the after fire-control tower with
its forward director platform, the Mk.38 and Mk.37 aft directors, the Mk.51/Mk.57 AA directors, the
40 mm and 20 mm positions on the 02 deck beside the tower, and the mainmast with its SG radar.

Region: above the 02 deck (11.05 m) aft of runtime z +30.6 m. Shapes are measured on the approved
GameModels3D Iowa (pasb018) in the runtime frame and authored here; nothing reads reference meshes.
Executed in build.py's scope after midships.py; uses details.py and the build.py primitives.
"""
import bmesh

def aft_region():
    # Everything below is local to this function so the region's helper names never collide with
    # other region files executed in the same build.py scope; only COL and ASSEMBLY are shared.
    global COL,ASSEMBLY
    structures={s['id']:s for s in D['structures']}
    D02,D03,DPLAT=11.05,13.0,16.64   # 02 deck, after 03 deck (aft-house-03), director platform (aft-director-platform)
    def B(x,y,z):return (-z,-x,y)     # runtime point -> authoring (bow +X, port +Y, up +Z)
    def P(x,z):return (-z,-x)         # runtime plan point -> authoring plan point
    def Ps(points):return [P(x,z) for x,z in points]

    def solid(name,vv,ff,material='naval',col=None,smooth=False):
        o=mesh(name,vv,ff,material,col,smooth)
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
        return o

    def _bar(vv,ff,a,b,r,up):
        d=(b-a).normalized();u=d.cross(up)
        if u.length<1e-6:u=d.orthogonal()
        u.normalize();w=d.cross(u).normalized();k=len(vv)
        for p in (a,b):
            for s,t in ((1,1),(-1,1),(-1,-1),(1,-1)):vv.append(tuple(p+u*(s*r)+w*(t*r)))
        ff.extend((k+i,k+(i+1)%4,k+4+(i+1)%4,k+4+i) for i in range(4))

    def ladder(name,a,b,across,width=.42,col=None):
        """Steel ladder as one mesh: square stringers and 0.3 m rungs from authoring point a to b."""
        a,b=Vector(a),Vector(b);c=Vector(across).normalized()*(width/2);vv=[];ff=[]
        for s in (-1,1):_bar(vv,ff,a+c*s,b+c*s,.026,c)
        n=max(2,round((b-a).length/.3))
        for i in range(1,n):
            p=a.lerp(b,i/n);_bar(vv,ff,p-c,p+c,.013,Vector((0,0,1)) if abs(c.normalized().z)<.9 else Vector((1,0,0)))
        return mesh(name,vv,ff,'edge',col)

    def ccw(ring):
        return ring if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1]))>0 else list(reversed(ring))

    def basket(name,p0,p1,out,depth,bottom,top,col=None):
        """Floater-net basket hung on a wall; p0->p1 run along the wall face (authoring plan), `out` points outboard."""
        o=Vector((*out,0)).normalized();a=Vector((*p0,0));b=Vector((*p1,0))
        ring=ccw([tuple(v.xy) for v in (a,b,b+o*depth,a+o*depth)])
        platform(name+' floor',ring,bottom+.05,.05,'naval',col)
        shell_wall(name+' sides',ring,bottom,top-bottom,.03,True,'naval',.018,col)
        platform(name+' net',ring,top-.12,.02,'canvas',col)
        for t in (.33,.67):
            q=a.lerp(b,t);rod(name+' strap',(q.x+o.x*depth,q.y+o.y*depth,bottom),(q.x+o.x*depth,q.y+o.y*depth,top),.016,'edge',col,vertices=4)

    def lamp(name,x,y,z,post,bearing=0,r=.2):
        """Small signal searchlight on a post (authoring point x, y on the deck at z)."""
        rod(name+' post',(x,y,z),(x,y,z+post),.045,'naval',vertices=6)
        fx,fy=math.cos(bearing),math.sin(bearing);c=Vector((x,y,z+post+r*.9))
        rod(name+' yoke',(x,y,z+post),tuple(c),.03,'edge',vertices=5)
        rod(name+' drum',tuple(c-Vector((fx,fy,0))*r),tuple(c+Vector((fx,fy,0))*r*.9),r,'naval',vertices=12)
        rod(name+' lens',tuple(c+Vector((fx,fy,0))*r*.9),tuple(c+Vector((fx,fy,0))*r*.95),r*.82,'glass',vertices=12)

    # --- After fire-control tower (aft-director-base): lofted from rounded sections traced at 13.3-21.0 m.
    TOWER=[(13.0,2.42,2.36,44.83,.35),(14.8,2.15,2.27,44.80,.55),(16.0,2.02,2.25,44.93,.70),(17.8,1.86,2.02,44.92,1.0),
           (19.0,1.74,1.84,44.90,1.25),(20.2,1.66,1.68,44.86,1.45),(21.2475,1.56,1.55,44.86,1.50)]
    def tower_at(y):
        for (y0,*p),(y1,*q) in zip(TOWER,TOWER[1:]):
            if y0<=y<=y1:t=(y-y0)/(y1-y0);return [u+(v-u)*t for u,v in zip(p,q)]
        return list((TOWER[0] if y<TOWER[0][0] else TOWER[-1])[1:])
    def tower_outline(y,grow=0,k=5):
        """Runtime (x, z) section of the tower at height y, grown outward by `grow`."""
        a,b,c,r=tower_at(y);a+=grow;b+=grow;r+=grow;pts=[]
        for q,(sx,sz) in enumerate([(1,1),(-1,1),(-1,-1),(1,-1)]):
            cx,cz=sx*(a-r),c+sz*(b-r)
            for i in range(k):
                t=math.radians(90*q+90*i/(k-1));pts.append((cx+r*math.cos(t),cz+r*math.sin(t)))
        return pts
    def tower_face(y,sign,grow=0):
        """Runtime z of the tower's forward (sign -1) or after (+1) face on the centreline."""
        a,b,c,r=tower_at(y);return c+sign*(b+grow)

    COL=collections['Superstructure'];ASSEMBLY='aft-director-base'
    tower=next(o for o in scene.objects if o.get('nodeId')=='aft-director-base.surface')
    for p in tower.data.polygons:p.use_smooth=True
    tower.data.set_sharp_from_angle(angle=math.radians(38))
    platform('Tower head flange',Ps(tower_outline(21.2475,.10)),21.23,.12,'roof')
    for y in [19.15,20.44]:
        ring=[B(x,y,z) for x,z in tower_outline(y,.14,4)]
        tube_path('Tower grab rail',ring,.022,'edge',4,True)
        for i in range(0,len(ring),2):
            x,z=tower_outline(y,.14,4)[i];xi,zi=tower_outline(y,-.02,4)[i]
            rod('Grab rail standoff',B(xi,y,zi),B(x,y,z),.014,'edge',vertices=4)
    # Floater-net baskets hung on the tower sides above the 03 deck.
    for s in [1,-1]:
        basket('Tower floater net basket',P(s*2.10,43.56),P(s*2.10,46.95),(0,-s),.72,14.38,15.20)
    # Open lookout box on the after face, its knees, the inclined ladder from the 03 deck and the
    # ladder up the after face to the Mk.38 platform.
    aft0=tower_face(16.85,1)
    platform('Tower after lookout box floor',Ps([(-.7,aft0-.15),(.7,aft0-.15),(.7,48.35),(-.7,48.35)]),16.85,.12)
    shell_wall('Tower after lookout box plating',Ps([(-.7,aft0+.02),(-.7,48.35),(.7,48.35),(.7,aft0+.02)]),16.73,1.22)
    for x in [-.5,.5]:knee('Lookout box knee',B(x,16.73,48.2),B(x,16.73,aft0-.05),1.0)
    ladder('Tower after inclined ladder',B(2.2,D03,47.72),B(.82,16.85,47.72),(1,0,0),.5)
    for x in [2.2,.82]:
        y=D03 if x>1 else 16.85
        rod('Inclined ladder handrail',B(x,y,47.45),B(x,y+.95,47.45),.02,'naval',vertices=5)
    rod('Inclined ladder handrail',B(2.2,D03+.95,47.45),B(.82,17.8,47.45),.02,'naval',vertices=5)
    ladder('Tower after ladder',B(-.36,17.2,tower_face(17.2,1,.16)),B(-.36,21.2,tower_face(21.2,1,.12)),(0,1,0),.4)
    ladder('Tower forward ladder',B(.45,DPLAT,tower_face(DPLAT,-1,.16)),B(.45,21.2,tower_face(21.2,-1,.14)),(0,1,0),.4)
    for y in [17.5,19.0,20.4]:
        for sign,x in [(1,-.36),(-1,.45)]:rod('Ladder standoff',B(x,y,tower_face(y,sign,-.05)),B(x,y,tower_face(y,sign,.15)),.014,'edge',vertices=4)
    door('Tower after door',*P(-1.0,tower_face(D03+.9,1)),D03,(-1,0),.66,1.74)
    for s in [1,-1]:
        box('Tower junction box',B(s*2.20,15.9,46.0),(.3,.1,.36),'naval')
        box('Tower junction box',B(s*1.98,18.1,44.2),(.26,.1,.3),'naval')

    # --- After 03 deckhouse (aft-house-03): deck rails, hung floater-net baskets, 02-to-03 ladders,
    # vent trunks on the 02 deck, junction boxes.
    ASSEMBLY='aft-house-03'
    for s in [1,-1]:
        rail('03 deck rail',Ps([(s*2.45,31.0),(s*2.45,42.3)]),D03,.96,1.6,False,3)
        basket('03 deck floater net basket',P(s*2.50,35.33),P(s*2.50,38.76),(0,-s),.70,12.75,13.85)
        ladder('02 to 03 ladder',B(s*2.62,D02,39.25),B(s*2.62,D03+.95,39.25),(1,0,0),.42)
        ladder('02 to 03 ladder',B(s*2.62,D02,48.70),B(s*2.62,D03+1.0,48.70),(1,0,0),.42)
        # Square ventilation trunks from the 02 deck with hooded heads, braced to the house wall.
        box('Ventilation trunk',B(s*3.08,(D02+15.0)/2,39.88),(.45,.52,15.0-D02))
        box('Ventilation trunk hood',B(s*3.08,15.08,39.88),(.62,.70,.16),'roof')
        box('Ventilation trunk grille',B(s*3.08,14.78,39.88),(.47,.54,.34),'dark')
        for y in [11.7,12.75]:rod('Trunk bracket',B(s*2.5,y,39.88),B(s*2.86,y,39.88),.03,'naval',vertices=5)
        for z in [36.6,41.3,50.5]:
            box('03 junction box',B(s*2.52,12.05,z),(.28,.08,.36),'naval')
        for z in [33.8,37.9]:porthole('03 scuttle',*P(s*2.5,z),12.1,(0,-s),.17)
        door('03 door to the 40 mm tub',*P(s*2.5,45.3),D02,(0,-s),.66,1.62)
        # Service pipe run along the house side below the deck edge, dropping to the 02 deck at each end.
        tube_path('03 service pipe',[B(s*2.54,D02+.05,31.4),B(s*2.54,12.55,31.4),B(s*2.54,12.55,44.2),B(s*2.54,D02+.05,44.2)],.045,'naval',6)
        for z in [34.5,38.4,41.9]:rod('Pipe clip',B(s*2.5,12.55,z),B(s*2.6,12.55,z),.03,'edge',vertices=4)

    # --- Mk.37 platform: overhang slabs beyond the house, splinter shield from the tower's after face
    # round the stern end (gaps at the two ladders), knees, lookout stands, instrument pedestals, Mk.51s.
    ASSEMBLY='aft-house-03'
    for s in [1,-1]:
        platform('Mk.37 platform overhang',Ps([(s*x,z) for x,z in [(2.5,49.1),(2.9,49.57),(3.44,50.0),(3.44,52.4),(3.2,51.95),(2.5,51.3)]]),D03,.16,'roof')
    tail=[(3.03,53.65),(1.8,55.8),(1.3,56.3),(.75,56.55),(0,56.62)];inner=[(2.6,54.3),(1.4,54.35),(1.05,54.8),(.55,55.2)]
    platform('Mk.37 platform stern overhang',Ps(tail[:-1]+[(0,56.62)]+[(-x,z) for x,z in reversed(tail[:-1])]+[(-x,z) for x,z in inner]+[(x,z) for x,z in reversed(inner)]),D03,.16,'roof')
    edge=[(2.5,49.1),(2.9,49.57),(3.44,50.0),(3.42,52.96),(1.8,55.8),(1.3,56.3),(.75,56.55)]
    shield=[(-x,z) for x,z in [(2.5,48.95)]+edge]+[(0,56.62)]+[(x,z) for x,z in reversed(edge)]+[(2.5,48.95)]
    shell_wall('Mk.37 platform splinter shield',Ps(shield),12.84,1.13,.05)
    for s in [1,-1]:
        shell_wall('Mk.37 platform splinter shield',Ps([(s*2.5,47.28),(s*2.5,48.45)] if s<0 else [(s*2.5,48.45),(s*2.5,47.28)]),12.84,1.13,.05)
        for wall,top in [((2.5,50.25),(3.3,50.25)),((2.0,54.33),(2.1,54.95)),((.9,54.93),(1.2,56.1))]:
            knee('Mk.37 platform knee',B(s*top[0],12.84,top[1]),B(s*wall[0],12.84,wall[1]),.8)
        for x,z in [(2.52,53.3),(1.18,55.5)]:
            # Lookout binocular stand with its circular guard rail.
            x=s*x;c=B(x,D03,z)
            cyl('Lookout stand foot',(c[0],c[1],D03+.02),.22,.04,'edge',vertices=8)
            rod('Lookout stand pedestal',(c[0],c[1],D03),(c[0],c[1],14.3),.06,'naval',vertices=6)
            box('Lookout binocular',(c[0],c[1],14.4),(.26,.34,.14),'edge')
            tube_path('Lookout guard ring',[(c[0]+.45*math.cos(i*math.tau/10),c[1]+.45*math.sin(i*math.tau/10),14.0) for i in range(10)],.018,'naval',4,True)
            for i in range(3):
                a=i*math.tau/3+.5;rod('Guard ring stanchion',(c[0]+.45*math.cos(a),c[1]+.45*math.sin(a),D03),(c[0]+.45*math.cos(a),c[1]+.45*math.sin(a),14.0),.018,'naval',vertices=4)
        c=B(s*2.7,D03,52.05)
        rod('Instrument pedestal',(c[0],c[1],D03),(c[0],c[1],14.05),.07,'naval',vertices=6)
        box('Instrument head',(c[0],c[1],14.25),(.3,.34,.36),'naval')
        box('Instrument window',(c[0]-.155,c[1],14.3),(.02,.24,.14),'glass')
    mushroom_vent('Stern end vent',*P(0,56.1),D03,.16,.42)
    COL=collections['Masts and directors']
    for s,id in [(1,'AD_33'),(-1,'AD_32')]:
        ASSEMBLY='aft-house-03';mk51('Mk.51 director '+id,*P(s*2.80,50.50),D03,-s*3*math.pi/4)

    # Mk.37 aft director on its own round foundation with a collar and head flange (13.0 to 14.98 m).
    m=next(m for m in D['modules'] if m['id']=='director-secondary-aft');base=m['center'][1]-m['size'][1]/2
    ASSEMBLY=m['id'];c=B(0,0,m['center'][2])
    cyl('Mk.37 foundation',(c[0],c[1],(D03+base)/2),1.45,base-D03+.02,'naval',vertices=16)
    cyl('Mk.37 foundation collar',(c[0],c[1],14.29),1.52,.07,'edge',vertices=16)
    cyl('Mk.37 foundation flange',(c[0],c[1],base-.04),1.60,.08,'naval',vertices=16)
    door('Mk.37 foundation door',c[0]+.2,c[1]+1.43,D03,(0,1),.62,1.5)
    director_details(m,base)
    # Mk.38 aft director directly on the tower head.
    m=next(m for m in D['modules'] if m['id']=='director-main-aft');ASSEMBLY=m['id']
    director_details(m,m['center'][1]-m['size'][1]/2)

    # --- Forward director platform (aft-director-platform, 16.64 m): Mk.51 tubs on columns, Mk.57 tubs,
    # rails, ladders from the 03 deck, struts to the tower and a signal lamp.
    COL=collections['Superstructure'];ASSEMBLY='aft-director-platform'
    for s in [1,-1]:
        cx,cz=s*3.04,40.96;c=B(cx,0,cz)
        octagon=[(c[0]+.86*math.cos(i*math.tau/8+math.pi/8),c[1]+.86*math.sin(i*math.tau/8+math.pi/8)) for i in range(8)]
        cyl('Mk.51 tub column',(c[0],c[1],(DPLAT+18.34)/2),.62,18.34-DPLAT+.02,'naval',vertices=8)
        platform('Mk.51 tub floor',octagon,18.44,.12,'roof')
        shell_wall('Mk.51 tub plating',list(reversed(octagon)),18.32,1.29,.045,True)
        # Ladder on the column's after-inboard face, clear of the Mk.57 tub, up over the tub rim.
        lx,lz=s*2.59,41.71
        ladder('Mk.51 tub ladder',B(lx,DPLAT,lz),B(lx,19.95,lz),(-.51,-s*.86,0),.4)
        for y in [17.3,18.1]:rod('Ladder standoff',B(s*2.72,y,41.49),B(lx,y,lz),.014,'edge',vertices=4)
        gun_tub('Mk.57 tub',*P(s*3.86,42.77),DPLAT,1.18,1.08,False,24,(math.radians(119-38),math.radians(119+38)) if s>0 else (math.radians(-119-38),math.radians(-119+38)))
        rail('Director platform rail',Ps([(s*2.03,45.0),(s*2.32,44.78),(s*4.5,43.78)]),DPLAT,1.0,1.3,False,2)
        rail('Director platform rail',Ps([(s*2.2,40.6),(s*2.72,40.3),(s*3.08,40.22),(s*3.62,40.44),(s*3.86,41.0),(s*3.9,41.44),(s*4.48,41.7)]),DPLAT,1.0,1.3,False,2)
        ladder('03 to director platform ladder',B(s*1.89,D03,40.81),B(s*1.89,DPLAT+1.0,40.81),(-.51,s*.35,0),.42)
        # Short diagonal struts from under the Mk.51 and Mk.57 lobes back to the tower's forward corners.
        for top,foot in [((3.3,40.6),(1.9,15.0,42.75)),((4.6,42.0),(2.1,14.9,43.3))]:
            rod('Director platform strut',B(s*top[0],16.40,top[1]),B(s*foot[0],foot[1],foot[2]),.08,'naval',vertices=6)
        lamp('Signal searchlight',*P(s*3.1,44.3),DPLAT,1.45,-s*math.pi/2)
    rail('Director platform rail',Ps([(-1.62,41.3),(-.67,42.22),(.67,42.22),(1.62,41.3)]),DPLAT,1.0,1.3,False,2)
    COL=collections['Masts and directors']
    for s,a,b in [(1,'AD_28','AD_30'),(-1,'AD_27','AD_29')]:
        ASSEMBLY='aft-director-platform'
        mk51('Mk.51 director '+a,*P(s*3.27,40.93),18.44,-s*math.pi/4)
        mk57('Mk.57 director '+b,*P(s*3.94,42.77),DPLAT,-s*math.pi/3)

    # --- 40 mm and 20 mm positions on the 02 deck beside the tower.
    COL=collections['Light AA']
    for s in [1,-1]:
        side='starboard' if s>0 else 'port'
        id='bofors-aft-platform-'+side;ASSEMBLY='aft-aa-installations'
        cx,cy=P(s*5.45,44.76);r=2.9;inboard=s*math.pi/2
        # Splinter tub, open towards the tower; its deck plate is a sponson where it passes the 02 deck's after taper.
        platform('Bofors tub deck',circle(cx,cy,r,28),11.09,.2,'roof')
        shell_wall('Bofors tub splinter plating',circle(cx,cy,r,26,inboard+math.pi/4,inboard+math.tau-math.pi/4),10.89,1.58,.05)
        shell_wall('Bofors ready-service racks',circle(cx,cy,r-.06,14,inboard+math.pi*.55,inboard+math.pi*1.45),D02,.95,.34,False,'naval',0)
        AA_INSTALLED.add(id)
        id='oerlikon-aft-platform-'+side
        x,y,z=mount_point(id)
        cyl('Oerlikon deck ring',(x,y,D02+.02),.46,.04,'edge',vertices=12)
        locker('Oerlikon ready-use locker',*P(s*3.05,50.9),D02,(1.0,.5,.7),0)
        AA_INSTALLED.add(id)

    # --- Mainmast: a pole stepped on a bracket behind the after funnel, struts to the funnel head, the
    # after signal platform with its long yard and gaff, the SG platform and radar (ARS_3), ladders and
    # a landing behind the funnel.
    COL=collections['Masts and directors'];ASSEMBLY='mainmast';MZ=34.71
    # The bracket narrows where the after funnel's steam pipes (midships.py) rise past it.
    platform('Mainmast step bracket',Ps([(-.48,32.84),(.48,32.84),(.48,33.35),(.75,33.5),(.75,35.3),(-.75,35.3),(-.75,33.5),(-.48,33.35)]),23.85,.12,'roof')
    for x in [-.42,.42]:knee('Mainmast step knee',B(x,23.73,35.1),B(x,23.73,32.94),1.6)
    rail('Mainmast step rail',Ps([(.74,34.25),(.74,35.28),(-.74,35.28),(-.74,33.52)]),23.85,.9,1.2,False,2)
    rod('Mainmast',B(0,23.85,MZ),B(0,35.25,MZ),.18,'naval',r2=.11,vertices=12)
    cyl('Mainmast collar',B(0,28.45,MZ),.25,.9,'naval',vertices=12)
    for s in [1,-1]:rod('Mainmast strut',B(0,28.4,MZ-.1),B(s*1.5,25.72,32.3),.075,'naval',vertices=8)
    ladder('Mainmast ladder',B(.27,24.0,MZ),B(.27,34.4,MZ),(1,0,0),.34)
    for y in [25,27,30,33.8]:rod('Mast ladder standoff',B(.1,y,MZ),B(.27,y,MZ),.014,'edge',vertices=4)
    ladder('Funnel after ladder',B(1.0,D03,32.95),B(1.0,24.8,32.95),(0,1,0),.42)
    for y in [14.5,17.0,19.5,22.0]:rod('Funnel ladder standoff',B(1.0,y,32.72),B(1.0,y,32.95),.016,'edge',vertices=4)
    # Landing behind the funnel on two posts from the 03 deck.
    platform('Mainmast landing',Ps([(-2.0,33.1),(2.0,33.1),(2.0,34.67),(-2.0,34.67)]),17.45,.1,'roof')
    for s in [1,-1]:rod('Landing post',B(s*1.76,D03,33.3),B(s*1.76,17.36,33.3),.07,'naval',vertices=6)
    rail('Landing rail',Ps([(1.3,33.1),(2.0,33.12),(2.0,34.65),(-2.0,34.65),(-2.0,33.12)]),17.45,1.05,1.3,False,2)
    # After signal platform (32.66 m), long yard with antenna posts at its after edge, gaff and boom.
    platform('Mainmast signal platform',Ps([(-1.8,34.9),(1.8,34.9),(1.8,36.65),(-1.8,36.65)]),32.66,.1,'roof')
    rail('Signal platform rail',Ps([(-.3,34.92),(-1.78,34.92),(-1.78,36.63),(1.78,36.63),(1.78,34.92),(.3,34.92)]),32.66,.9,1.2,False,2)
    for s in [1,-1]:
        for x in [.5,1.6]:rod('Signal platform brace',B(0,31.3,MZ+.12),B(s*x,32.56,36.4),.045,'naval',vertices=6)
        rod('Mainmast yard',B(0,32.74,36.52),B(s*6.1,32.74,36.52),.07,'naval',r2=.035,vertices=8)
        rod('Yard antenna post',B(s*6.0,32.74,36.52),B(s*6.0,34.0,36.52),.02,'edge',vertices=5)
        cyl('Yard antenna disc',B(s*6.0,34.0,36.52),.22,.03,'edge',vertices=10)
        rod('Yard lift',B(0,34.3,MZ),B(s*4.0,32.74,36.52),.012,'edge',vertices=4)
    rod('Mainmast gaff',B(0,31.45,MZ+.14),B(0,33.5,38.9),.06,'naval',r2=.035,vertices=8)
    rod('Mainmast signal boom',B(0,24.9,MZ+.19),B(0,26.0,37.49),.05,'naval',vertices=6)
    # SG platform (34.5 m) with rails and knees, and the SG antenna on its pedestal at ARS_3.
    platform('SG radar platform',Ps([(-.66,34.05),(.66,34.05),(.66,35.25),(-.66,35.25)]),34.5,.1,'roof')
    rail('SG platform rail',Ps([(-.64,34.07),(.64,34.07),(.64,35.23),(-.64,35.23)]),34.5,1.07,1.0,True,2)
    for dx,dz in [(.6,.5),(-.6,.5),(.6,-.55),(-.6,-.55)]:
        rod('SG platform bracket',B(dx*.15,33.75,MZ+dz*.15),B(dx,34.42,MZ+dz),.03,'naval',vertices=5)
    cyl('SG pedestal',B(0,35.37,MZ),.14,.36,'naval',vertices=10)
    cyl('SG training gear',B(0,35.6,MZ),.2,.16,'edge',vertices=12)
    rod('SG antenna arm',B(0,35.62,MZ),B(0,35.9,MZ+.05),.05,'naval',vertices=6)
    vv=[];ff=[];n=8
    for i in range(n+1):
        u=-.64+1.28*i/n;z=MZ+.03-.47*(u/.64)**2
        for y in [35.82,36.41]:
            for dz in [0,.035]:vv.append(B(u,y,z+dz))
    for i in range(n):
        a=4*i;b=4*(i+1)
        ff+=[(a,b,b+2,a+2),(a+1,a+3,b+3,b+1),(a,a+1,b+1,b),(a+2,b+2,b+3,a+3)]
    ff+=[(0,2,3,1),(4*n,4*n+1,4*n+3,4*n+2)]
    solid('SG reflector',vv,ff,'naval')
    rod('SG feed support',B(0,36.12,MZ+.02),B(0,36.12,MZ-.34),.02,'edge',vertices=4)
    box('SG feed horn',B(0,36.12,MZ-.38),(.12,.22,.12),'edge')

    # Rigging: main aerials from the foremast signal-yard tips (tower.py) to the mainmast yard, and the
    # foremast's forward stays from its head down to the navigation bridge roof.
    tips,head=FOREMAST_YARD_TIPS,FOREMAST_HEAD
    for s,tip in zip([1,-1],tips):
        rod('Main aerial',tip,B(-s*6.0,32.74,36.52),.014,vertices=4)
        rod('Forward stay',head,(22,s*4,structure_top('bridge-wing')),.017,vertices=4)

aft_region()

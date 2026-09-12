"""Original shielded Mk4 / paired Mk24 reconstruction of approved pzsd108 fit.

Retains the fleet's open-mount joint contract; no generated/reference assets.
The source labels its paired visual Mk20 and its equipment entry Mk24.
"""
import bpy, math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout

def create_mount(mount, col, helpers, materials):
    spec=mount['weapon'];name=mount['id'];twin=spec['barrelCount']==2
    gray,steel,dark=(materials[k] for k in ['naval','edge','dark'])
    mesh0,cyl0,rod0,box0=(helpers[k] for k in ['mesh','cyl','rod','box'])
    def mesh(n,v,f,m):return mesh0(name+'.'+n,v,f,m,col)
    def cyl(n,p,r,d,m,vertices=24,r2=None):return cyl0(name+'.'+n,p,r,d,m,col,vertices,r2)
    def rod(n,a,b,r,m,vertices=10,r2=None):return rod0(name+'.'+n,a,b,r,m,col,r2,vertices)
    def box(n,p,d,m):return box0(name+'.'+n,p,d,m,col,.006)
    def put(o,parent):
        o.parent=parent;o.matrix_parent_inverse=Matrix.Identity(4);o['assemblyId']=name;return o
    def joint(suffix,parent=None,p=(0,0,0)):
        o=bpy.data.objects.new(name+'.'+suffix,None);col.objects.link(o)
        o['nodeId']=name+'.'+suffix;o['assemblyId']=name;o.parent=parent;o.location=p;return o
    def ring(n,p,r,thick,parent,axis='X',segments=24,tilt=0):
        p=Vector(p)
        rotation=Matrix.Rotation(tilt,3,'Y')
        def v(a):return p+rotation@Vector((0,r*math.cos(a),r*math.sin(a)) if axis=='X' else (r*math.cos(a),0,r*math.sin(a)))
        for i in range(segments):put(rod(n,v(i*math.tau/segments),v((i+1)*math.tau/segments),thick,steel,vertices=6),parent)
    def shoulder_cup(parent,py,dx=0,dz=0):
        path=[(-.595,-.07),(-.735,-.02),(-.754,.085),(-.695,.185),(-.59,.187)]
        vv=[];ff=[]
        for i,(x,z) in enumerate(path):
            prev=Vector(path[max(0,i-1)]);nxt=Vector(path[min(len(path)-1,i+1)])
            tangent=(nxt-prev).normalized();normal=Vector((-tangent.y,tangent.x))*.018
            vv.extend((x+dx+normal.x*edge,py+dy,z+dz+normal.y*edge) for dy in [-.027,.027] for edge in [-1,1])
        for i in range(len(path)-1):
            a=i*4;b=a+4
            ff.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)])
        ff.extend([(0,1,3,2),(16,18,19,17)])
        put(mesh('shoulder-pad',vv,ff,dark),parent)
    a,z,c=mount['position'];root=joint('base',p=(-c,-a,z));yaw=joint('yaw',root)
    yaw.rotation_euler.z=-math.radians(mount['bearingDeg']);H=spec['pivotHeight'];fork=.24 if twin else .113
    tx=spec['trunnionForward'];tier=0 if twin else -.0225
    put(cyl('foot',(0,0,.025),spec['barbetteRadius'],.05,steel,vertices=8),root)
    for i in range(8):
        a=i*math.tau/8;put(cyl('holding-bolt',(.32*math.cos(a),.32*math.sin(a),.065),.023,.04,steel,vertices=6),root)
    put(cyl('tapered-pedestal',(0,0,.4995),.264 if twin else .2535,.879,gray,32,r2=.13),root)
    put(cyl('swivel-collar',(0,0,.90),.20,.17,steel,32),yaw)
    put(cyl('training-neck',(0,0,1.005),.102,.078,gray,32),yaw)
    put(box('saddle',(0,0,1.02),(.22,2*fork+.02,.04),gray),yaw)
    for side in [-1,1]:
        xz=[(-.27,1.13),(-.10,1.04),(.07,1.04),(.38,1.15),(.35,1.23),(.07,1.15),(-.10,1.15),(-.27,1.20)]
        vv=[(x,side*fork+dy,z+tier) for dy in [-.027,.027] for x,z in xz];n=len(xz)
        put(mesh('fork-cheek',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],gray),yaw)
        bearing_y=.24 if twin else .1005
        # Keep the single's exposed cap clear of the .066 m receiver half-width;
        # the retained trunnion carries the hidden mating connection.
        bearing_inner=bearing_y-.043 if twin else .067
        put(rod('bearing-cap',(tx,side*bearing_inner,H),(tx,side*(bearing_y+.043),H),.064,steel,vertices=6),yaw)
        # Split shield with a deep central clearance slot and chamfered shoulders.
        inner=.26 if twin else .16;outer=.79 if twin else .70
        bottom,top,shoulder=.9465+tier,1.668+tier,1.45+tier
        yz=[(inner,bottom),(outer,bottom),(outer,top),(inner+.12,top),(inner,shoulder)]
        yz=[(side*y,z) for y,z in yz];n=len(yz)
        shield_x=lambda z: .4725-(z-bottom)*.397
        vv=[(shield_x(z)+dx,y,z) for dx in [-.013,.013] for y,z in yz]
        put(mesh('shield-leaf',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],gray),yaw)
        for z in [.99+tier,1.41+tier]:
            for y in [inner+.08,outer-.08]:
                x=shield_x(z)
                put(rod('shield-brace',(.07,side*fork,1.12+tier),(x-.015,side*y,z),.020,steel),yaw)
                put(rod('shield-fastener',(x+.012,side*y,z),(x+.029,side*y,z),.018,steel,vertices=8),yaw)
    put(box('shield-cross-tie',(.465,0,.9575+tier),(.028,1.56 if twin else 1.39,.022),gray),yaw)
    wheel_center=Vector((-.02,-.27,.812) if twin else (-.112,-.2085,.812))
    wheel_u=Vector((1,0,0)) if twin else Vector((.866,-.5,0))
    wheel_axis=Vector((-wheel_u.y,wheel_u.x,0));wr=.195
    put(rod('height-adjust-shaft',wheel_center+wheel_axis*.14,wheel_center,.025,steel),yaw)
    for i in range(12):
        a=i*math.tau/12;b=(i+1)*math.tau/12
        put(rod('height-wheel',wheel_center+wheel_u*(wr*math.cos(a))+Vector((0,0,wr*math.sin(a))),wheel_center+wheel_u*(wr*math.cos(b))+Vector((0,0,wr*math.sin(b))),.013,steel,vertices=6),yaw)
    for a in [0,math.pi*2/3,math.pi*4/3]:put(rod('height-wheel-spoke',wheel_center,wheel_center+wheel_u*(wr*math.cos(a))+Vector((0,0,wr*math.sin(a))),.013,steel),yaw)
    def case_bag(barrel,lateral,elevation):
        # An independently lofted empty fabric catcher. Its front frame is fixed
        # to the carriage; the rear frame follows the cradle. Source dimensions
        # constrain the 30-degree display shape, not an imported surface.
        width=.055 if twin else .070
        front=Vector((tx+.1535,lateral,H-.120))
        rear_local=Vector((-.220,0,-.095))
        rear30=Vector((tx,lateral,H))+Matrix.Rotation(-math.pi/6,3,'Y')@rear_local
        front_marker=joint(barrel+'.case-bag-front',yaw,front)
        rear_marker=joint(barrel+'.case-bag-rear',elevation,rear_local)
        put(rod('case-bag-front-frame',(front.x,-fork,front.z),(front.x,fork,front.z),.012,steel,vertices=8),yaw)
        put(rod('case-bag-rear-frame',rear_local+Vector((0,-width,0)),rear_local+Vector((0,width,0)),.012,steel,vertices=8),elevation)
        for sign in [-1,1]:
            put(rod('case-bag-rear-ear',(-.22,sign*width,-.055),rear_local+Vector((0,sign*width,0)),.013,steel,vertices=8),elevation)
        perimeter=[(-1,-.8)]+[(q,-1) for q in [-.75,-.5,-.25,0,.25,.5,.75]]+[(1,-.8),(1,.8)]+[(q,1) for q in [.75,.5,.25,0,-.25,-.5,-.75]]+[(-1,.8)]
        n=len(perimeter)
        def points(degrees):
            rear=Vector((tx,lateral,H))+Matrix.Rotation(-math.radians(degrees),3,'Y')@rear_local
            delta=rear-rear30;result=[]
            # Rounded lower lobes and a recessed discharge seam preserve an
            # empty hanging shape, while the attachment frames retain their poses.
            levels=[(0,front.x,rear30.x,front.z,rear30.z),
                    (.12,tx+.065,tx-.26,H-.23,H-.23),
                    (.28,tx+.085,tx-.293,H-.34,H-.34),
                    (.48,tx+.062,tx-.286,H-.48,H-.48),
                    (.72,tx+.029,tx-.245,H-.61,H-.59),
                    (1,tx-.022,tx-.227,H-.655,H-.625)]
            theta=math.radians(degrees)
            for row in range(25):
                t=row/24
                upper=next((i for i in range(1,len(levels)) if levels[i][0]>=t),len(levels)-1)
                lo,hi=levels[upper-1],levels[upper];f=(t-lo[0])/(hi[0]-lo[0])
                xf,xb,zf,zb=[lo[i]+f*(hi[i]-lo[i]) for i in range(1,5)]
                for q,u in perimeter:
                    back=(1-q)/2
                    x=xf*(1-back)+xb*back;z=zf*(1-back)+zb*back
                    weight=back*(1-t*.72)
                    x+=delta.x*weight;z+=delta.z*weight
                    y=lateral+u*width*(1-.12*t)+math.sin(t*math.pi)*.007*math.sin(q*5+t*7)
                    if t or abs(q)<1:
                        # The cloth folds into the gap ahead of the descending
                        # receiver. Below its rear end it can hang freely.
                        if theta>.01 and z>H-(.82 if twin else .53)*math.sin(theta)-.10*math.cos(theta):
                            x=max(x,tx+(math.cos(theta)*(z-H)+.085)/math.sin(theta))
                        # Outside the actual tapered stand and swivel collar.
                        radius=max(.13,min(.264,(.264 if twin else .2535)-(z-.06)/.879*((.264 if twin else .2535)-.13)))
                        if .803<z<1.005:radius=max(radius,.20)
                        if z<1.035:
                            x=min(x,-math.sqrt(max(0,(radius+.020)**2-y**2)))
                    result.append(Vector((x,y,z)))
            return result
        faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(24) for i in range(n)]
        faces.append(tuple(reversed(range(24*n,25*n))))
        base=float(spec['elevationMinDeg']);angles=[float(a) for a in range(int(base)+5,int(spec['elevationMaxDeg'])+1,5)]
        if angles[-1]!=spec['elevationMaxDeg']:angles.append(float(spec['elevationMaxDeg']))
        bag=put(mesh('case-bag',points(base),faces,dark),yaw)
        bag['nodeId']=name+'.'+barrel+'.case-bag'
        bag['gunCoverElevationId']=name+'.'+barrel+'.elevation'
        bag['gunCoverBaseAngle']=base;bag['gunCoverAngles']=angles
        bag.shape_key_add(name='Basis')
        for i,angle in enumerate(angles):
            shape=bag.shape_key_add(name='Elevation '+str(angle))
            for v,p in zip(shape.data,points(angle)):v.co=p
            driver=shape.driver_add('value').driver;driver.type='SCRIPTED'
            var=driver.variables.new();var.name='pitch';var.type='TRANSFORMS'
            target=var.targets[0];target.id=elevation;target.transform_type='ROT_Y';target.transform_space='LOCAL_SPACE'
            before=angles[i-1] if i else base
            rising=f'(-pitch*57.29577951308232-({before}))/({angle-before})'
            if i+1<len(angles):
                after=angles[i+1];falling=f'({after}+pitch*57.29577951308232)/({after-angle})'
                driver.expression=f'max(0,min({rising},{falling}))'
            else:driver.expression=f'max(0,min(1,{rising}))'

    for barrel,lateral,vertical in barrel_layout(spec):
        elevation=joint(barrel+'.elevation',yaw,(spec['trunnionForward'],lateral,H));elevation.rotation_euler.y=-math.radians(1)
        recoil=joint(barrel+'.recoil',elevation)
        length=spec['muzzleForward']-spec['trunnionForward'];joint(barrel+'.muzzle',recoil,(length,0,0))
        sign=1 if lateral>=0 else -1
        # Each cradle seats in its outboard fork bearing. Both retained
        # elevation joints receive the same authoritative mount elevation.
        if twin:
            put(rod('trunnion',(0,0,0),(0,sign*fork-lateral,0),.078,steel,vertices=16),elevation)
        else:
            put(rod('trunnion',(0,-.1005,0),(0,.1005,0),.06,steel,vertices=16),elevation)
        profile=[(-.37,-.06),(.04,-.06),(.39,.02),(.39,.055),(.04,-.025),(-.37,-.025)]
        vv=[(x,y,z) for y in [-.0525,.0525] for x,z in profile];n=len(profile)
        put(mesh('cradle-rail',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],gray),elevation)
        put(box('receiver',(.01,0,0),(.76,.11 if twin else .132,.12),steel),recoil)
        put(box('breech-cap',(-.42,0,.002),(.09,.13,.14),gray),recoil)
        jacket_end=1.0
        put(rod('recoil-jacket',(.10,0,0),(jacket_end,0,0),.055,steel,vertices=20),recoil)
        put(rod('barrel',(jacket_end,0,0),(length,0,0),.035,steel,vertices=20,r2=.022),recoil)
        put(rod('muzzle-bore',(length,0,0),(length+.002,0,0),.010,dark,vertices=16),recoil)
        for i in range(20):ring('spring-coil',(.10+i*.034,0,0),.053,.004,recoil,segments=12)
        # Narrow twin drums lean outboard; both barrel/recoil chains remain independent.
        center=Vector((.11,sign*.112,.194 if twin else .1855))
        drum_tilt=0 if twin else math.radians(4.5)
        drum_rotation=Matrix.Rotation(drum_tilt,3,'Y')
        drum_axis=drum_rotation@Vector((1,0,0));radius=.1365;half_depth=.07 if twin else .088
        # The approved drums have ten flat sides; a smooth cylinder bulges
        # below their flat lower face and intrudes on the nearby bearing.
        vv=[tuple(center+drum_rotation@Vector((dx,radius*math.cos(i*math.tau/10),radius*math.sin(i*math.tau/10)))) for dx in [-half_depth,half_depth] for i in range(10)]
        ff=[tuple(reversed(range(10))),tuple(range(10,20))]+[(i,(i+1)%10,10+(i+1)%10,10+i) for i in range(10)]
        put(mesh('feed-drum',vv,ff,dark),recoil)
        rim_offset=.004 if twin else .001
        for dx in [-half_depth-rim_offset,half_depth+rim_offset]:
            p=center+drum_axis*dx
            # Keep the rolled lip inside the measured outer drum diameter.
            ring('drum-rim',p,radius-(.005 if twin else .008),.005 if twin else .003,recoil,segments=10,tilt=drum_tilt)
            for i in range(8):
                a=i*math.tau/8;put(rod('drum-pressed-rib',p+drum_rotation@Vector((0,.04*math.cos(a),.04*math.sin(a))),p+drum_rotation@Vector((0,radius*.89*math.cos(a),radius*.89*math.sin(a))),.006,steel,vertices=5),recoil)
        vv=[(center.x+dx,dy+offset,z) for offset,z in [(0,.025),(center.y,.18)] for dx,dy in [(-.07,-.042),(.07,-.042),(.07,.042),(-.07,.042)]]
        put(mesh('feed-neck',vv,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],steel),recoil)
        put(box('magazine-catch',(center.x-.12,center.y,.115),(.075,.11,.045),gray),recoil)
        if twin:
            # The source's shoulder cups curve in the vertical fore/aft plane.
            # The wider, downturned outboard strips are separate hand grips.
            py=sign*(.1875-abs(lateral))
            put(rod('shoulder-rest',(-.40,0,.015),(-.75,py,.045),.023,steel),elevation)
            shoulder_cup(elevation,py)
            put(rod('trigger-arm',(-.28,sign*.085,-.08),(-.415,sign*.35,-.20),.017,steel),elevation)
            put(rod('trigger-grip',(-.415,sign*.35,-.20),(-.55,sign*.45,-.235),.023,dark),elevation)
        else:
            put(rod('shoulder-crossbar',(-.424,-.234,0),(-.424,.234,0),.021,steel),elevation)
            for py in [-.2115,.1015]:
                put(rod('shoulder-rest',(-.424,py,0),(-.784,py,.13),.023,steel),elevation)
                shoulder_cup(elevation,py,dx=-.034,dz=.09)
                put(rod('trigger-arm',(-.424,py,.02),(-.48,py,.175),.014,steel),elevation)
                put(rod('trigger-grip',(-.48,py,.175),(-.605,py,.09),.019,dark),elevation)
        case_bag(barrel,lateral,elevation)
        # One central sight on the pair's non-recoiling cradle. The runtime
        # commands both elevation joints together; each recoil stays separate.
        if not twin or barrel=='left':
            sx=-.085;sy=.038-lateral if twin else -.057
            put(rod('sight-bracket',(-.48,0,.045),(sx,sy,.36),.012,steel),elevation)
            ring('ring-sight',(sx,sy,.43),.085,.006,elevation,segments=12)
            put(rod('sight-crosshair',(sx,sy-.085,.43),(sx,sy+.085,.43),.003,steel,vertices=4),elevation)
            put(rod('sight-crosshair',(sx,sy,.345),(sx,sy,.515),.003,steel,vertices=4),elevation)
    return yaw

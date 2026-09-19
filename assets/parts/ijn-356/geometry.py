"""Original 356 mm twin gunhouse refinements, using the shared joint/plate builder."""
import bpy,math
from blender_components import create_gun_mount
from blender_barrels import barrel_layout

def roof_z(x):
    return 4.8+(3.35-x)/10.25*1.2

def front_x(y,z):
    """Original center plate and raked cheeks, in turret-local metres.

    Outer cheek rake/angle follows the approved model's saved sections at
    lateral offsets 2.3 and 3 m. The center is a separate projecting plate;
    its ladder and sight hood are fittings, not additional roof thickness.
    """
    y=abs(y)
    center=4.51-.51*(z-3.4)
    outer=6.568-.51*z-.477*y
    if y>=1.935:return outer
    if y<=.375:return center
    edge=6.568-.51*z-.477*1.935
    return center+(edge-center)*(y-.375)/(1.935-.375)

def gunhouse_shape():
    """Original closed shell with two explicit front/roof gun-port loops."""
    vs=[];faces=[]
    def vertex(p):
        p=[round(n,6) for n in p]
        if p not in vs:vs.append(p)
        return vs.index(p)
    def triangle(label,a,b,c,finish='naval'):
        faces.append(dict(id=label,indices=[a,b,c],thicknessMm=127 if finish=='roof' else 25 if finish=='floor' else 254,material='steel',finish='naval' if finish=='floor' else finish))
    def quad(label,points,finish='naval'):
        a,b,c,d=points;triangle(label+'-a',a,b,c,finish);triangle(label+'-b',a,c,d,finish)
    # A finer shoulder replaces the former single broad diagonal facet.
    low_side=[(-6.17,-2.8),(-4.8,-4.5),(.75,-4.5),(1.70,-4.27),
              (2.50,-3.88),(front_x(3.3,3.4),-3.3)]
    crown_z=4.8
    for _ in range(12):crown_z=roof_z(front_x(3.3,crown_z))
    top_side=[(-6.23,-2.6,roof_z(-6.23)),(-4.8,-3.9,roof_z(-4.8)),
              (.30,-4.0,roof_z(.30)),(1.20,-3.96,roof_z(1.20)),
              (2.00,-3.67,roof_z(2.00)),(front_x(3.3,crown_z),-3.3,crown_z)]
    offsets=[-2.5,-1.935,-.375,.375,1.935,2.5]
    def front_point(y,z):
        if abs(y)==2.5:y=math.copysign(2.5-(z-3.4)/7,y)
        return vertex((front_x(y,z),y,z))
    low_front=[front_point(y,3.4) for y in offsets]
    sill=[front_point(y,3.45) for y in offsets]
    high_front=[]
    for y in offsets:
        z=4.8
        for _ in range(12):
            yy=math.copysign(2.5-(z-3.4)/7,y) if abs(y)==2.5 else y
            z=roof_z(front_x(yy,z))
        high_front.append(front_point(y,z))
    left_low=[vertex((x,y,3.4)) for x,y in low_side]
    left_high=[vertex(p) for p in top_side]
    right_low=[vertex((x,-y,3.4)) for x,y in reversed(low_side)]
    right_high=[vertex((x,-y,z)) for x,y,z in reversed(top_side)]
    low=left_low+low_front+right_low+[vertex((-7.05,0,3.4))]
    high=left_high+high_front+right_high+[vertex((-6.90,0,6.0))]
    front_start=len(left_low)
    for i in range(len(low)):
        j=(i+1)%len(low)
        if front_start<=i<front_start+5:continue
        # The outer post joins at the sill height, avoiding a T-junction.
        if i==front_start-1:
            a,b,c,d=low[i],low[j],high[j],high[i]
            triangle('shoulder-port-low',a,b,sill[0])
            triangle('shoulder-port-middle',a,sill[0],d)
            triangle('shoulder-port-high',sill[0],c,d)
        elif i==front_start+5:
            a,b,c,d=low[i],low[j],high[j],high[i]
            triangle('shoulder-starboard-low',a,b,sill[-1])
            triangle('shoulder-starboard-middle',b,c,sill[-1])
            triangle('shoulder-starboard-high',c,d,sill[-1])
        else:quad('wall-'+str(i),[low[i],low[j],high[j],high[i]])
    for i in range(5):
        quad('gunport-sill-'+str(i),[low_front[i],low_front[i+1],sill[i+1],sill[i]])
        if i in (0,2,4):quad('gunport-post-'+str(i),[sill[i],sill[i+1],high_front[i+1],high_front[i]])
    # Provisional internal recoil pans preserve the exterior sill and the
    # researched gun axes. The tails need space below the working floor;
    # this is original functional construction, not a sourced interior plan.
    pockets=[]
    for y in [-1.155,1.155]:
        points=[(.8,y-.55),(3.3,y-.55),(3.3,y+.55),(.8,y+.55)]
        pockets.append([vertex((x,yy,3.4)) for x,yy in points])
    import bmesh
    bm=bmesh.new();indices={}
    for loop in [low]+pockets:
        verts=[bm.verts.new(vs[i]) for i in loop]
        indices.update(zip(verts,loop))
        for a,b in zip(verts,verts[1:]+verts[:1]):bm.edges.new((a,b))
    bmesh.ops.triangle_fill(bm,edges=list(bm.edges),normal=(0,0,-1),use_beauty=True)
    for i,f in enumerate(bm.faces):
        ids=[indices[v] for v in f.verts]
        if f.normal.z>0:ids.reverse()
        triangle('floor-'+str(i),*ids,'floor')
    bm.free()
    for n,loop in enumerate(pockets):
        bottom=[vertex((*vs[i][:2],2.35)) for i in loop]
        for i in range(4):
            j=(i+1)%4
            quad(f'recoil-pan-{n}-wall-{i}',[loop[i],bottom[i],bottom[j],loop[j]],'floor')
        quad(f'recoil-pan-{n}-bottom',list(reversed(bottom)),'floor')
    # Ear-triangulate the roof in plan, retaining both open-ended cutouts.
    outline=left_high+[high_front[0]]
    for i in (1,3):
        outline += [high_front[i],vertex((2.05,offsets[i],roof_z(2.05))),
                    vertex((2.05,offsets[i+1],roof_z(2.05))),high_front[i+1]]
    outline += [high_front[-1]]+right_high+[high[-1]]
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    polygon=list(outline);n=0
    while len(polygon)>3:
        for i in range(len(polygon)):
            ids=[polygon[i-1],polygon[i],polygon[(i+1)%len(polygon)]]
            a,b,c=[vs[j] for j in ids]
            if cross(a,b,c)<=1e-9:continue
            if any(min(cross(a,b,vs[j]),cross(b,c,vs[j]),cross(c,a,vs[j]))>=-1e-9 for j in polygon if j not in ids):continue
            triangle('roof-'+str(n),*ids,'roof');n+=1;polygon.pop(i);break
        else:raise ValueError('Cannot triangulate original gunhouse roof')
    triangle('roof-'+str(n),*polygon,'roof')
    # The two remaining directed boundaries are intentional gun apertures.
    edges={}
    for f in faces:
        ids=f['indices']
        for a,b in zip(ids,ids[1:]+ids[:1]):
            if (b,a) in edges:del edges[b,a]
            else:edges[a,b]=True
    apertures=[]
    while edges:
        a,b=next(iter(edges));loop=[a];start=a
        while True:
            del edges[a,b];loop.append(b)
            if b==start:break
            following=[q for p,q in edges if p==b]
            if len(following)!=1:raise ValueError('Unexpected original shell boundary')
            a,b=b,following[0]
        apertures.append(dict(id='gun-port-'+str(len(apertures)+1),indices=list(reversed(loop[:-1]))))
    if len(apertures)!=2:raise ValueError('Expected exactly two original gun ports')
    return dict(version=1,vertices=vs,faces=faces,apertures=apertures,
                provenance=dict(sourceId='gamemodels3d-kongo-1944',basis='estimated',
                                note='Original reconstruction from approved model views and cheek sections. Armor thicknesses remain provisional game calibration.'))

def create_mount(mount,col,helpers,mats):
    spec=mount['weapon'];name=mount['id']
    house=create_gun_mount(mount,col,helpers,mats,lambda x:mount['position'][1])
    yaw=next(o for o in col.objects if o.get('nodeId')==name+'.yaw')
    mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
    def own(o):o.parent=yaw;o['assemblyId']=name;return o
    def bar(label,a,b,r=.026):return own(rod(name+'.'+label,a,b,r,mats['edge'],col,vertices=8))
    # Annular bearing/support walls leave the internal recoil pans clear.
    # Preserve the shared builder's exterior sizes, placement and ownership.
    for o in list(col.objects):
        if o.get('assemblyId')!=name or not any(k in o.name for k in [' • armored barbette',' • roller race']):continue
        old=o.data;r=max(math.hypot(v.co.x,v.co.y) for v in old.vertices)
        lo=min(v.co.z for v in old.vertices);hi=max(v.co.z for v in old.vertices)
        n=64;profile=[(r,lo),(r,hi),(3.95,hi),(3.95,lo)]
        verts=[(rr*math.cos(i*math.tau/n),rr*math.sin(i*math.tau/n),z) for rr,z in profile for i in range(n)]
        faces=[(j*n+i,j*n+(i+1)%n,((j+1)%4)*n+(i+1)%n,((j+1)%4)*n+i) for j in range(4) for i in range(n)]
        data=bpy.data.meshes.new(o.name+' annular support');data.from_pydata(verts,[],faces);data.update()
        for material in old.materials:data.materials.append(material)
        for face in data.polygons:face.use_smooth=face.index//n in [0,2]
        o.data=data
        if old.users==0:bpy.data.meshes.remove(old)
    if mount['rangefinder']:
        # The approved turret has broad armored optical wings, rather than
        # the shared exposed tube with small boxes at either end. Camera-
        # matched source views place their roof above the gunhouse aft roof.
        for o in list(col.objects):
            if o.parent==yaw and ('transverse rangefinder' in o.name or 'rangefinder hood' in o.name):
                bpy.data.objects.remove(o,do_unlink=True)
        rx=spec['rangefinderForward'];tip=spec['rangefinderWidth']/2+.47
        z0,z1=5.10,6.20;front=rx+.88
        for sign in [-1,1]:
            outline=[(rx-.90,.40),(rx-.90,tip-.72),(rx-.30,tip),
                     (front,tip),(front,.40)]
            outline=[(x,sign*y) for x,y in outline]
            if sign>0:outline.reverse()
            n=len(outline);vs=[(x,y,z) for z in [z0,z1] for x,y in outline]
            fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]
            for i,(a,b) in enumerate(zip(outline,outline[1:]+outline[:1])):
                if abs(a[0]-front)<1e-6 and abs(b[0]-front)<1e-6:continue
                j=(i+1)%n;fs.append((i,j,j+n,i+n))
            own(mesh(name+'.rangefinder-wing',vs,fs,mats['naval'],col))
            # A framed opening has a recessed back and optical objective;
            # it is not a dark rectangle on an unbroken front plate.
            lo,hi=sorted([sign*.40,sign*tip]);yl,yh=sorted([sign*4.43,sign*5.08])
            for a,b,c,d in [(lo,yl,z0,z1),(yh,hi,z0,z1),(yl,yh,z0,5.25),(yl,yh,6.06,z1)]:
                own(box(name+'.rangefinder-face',(front-.04,(a+b)/2,(c+d)/2),(.08,b-a,d-c),mats['naval'],col))
            own(box(name+'.rangefinder-recess',(front-.18,(yl+yh)/2,5.655),(.04,yh-yl,.81),mats['dark'],col))
            for yy in [yl,yh]:
                own(box(name+'.rangefinder-reveal',(front-.10,yy,5.655),(.20,.035,.81),mats['edge'],col))
            for zz in [5.25,6.06]:
                own(box(name+'.rangefinder-reveal',(front-.10,(yl+yh)/2,zz),(.20,yh-yl,.035),mats['edge'],col))
            cy=sign*4.755
            bar('rangefinder-objective',(front-.17,cy,5.59),(front-.065,cy,5.59),.145)
            own(rod(name+'.rangefinder-glass',(front-.075,cy,5.59),(front-.057,cy,5.59),.11,mats.get('glass',mats['dark']),col,vertices=20))
            # End housings straddle the side roof; these short webs meet the
            # exposed underside and the sloping side armor beneath it.
            for x in [rx-.25,rx+.45]:
                bar('rangefinder-bracket',(x,sign*3.80,5.05),(x,sign*4.50,5.12),.06)
            for y in [.45,1.9,3.4,tip-.12]:
                bar('rangefinder-roof-post',(rx+.68,sign*y,z1-.02),(rx+.68,sign*y,6.43),.018)
            bar('rangefinder-roof-rail',(rx+.68,sign*.45,6.43),(rx+.68,sign*(tip-.12),6.43),.018)
    # Replace the shared cylindrical mantlets with original turned barrels and
    # flexible bags. The stable yaw/elevation/recoil/socket chains are retained.
    for side,gy,_ in barrel_layout(spec):
        elevation=next(o for o in col.objects if o.get('nodeId')==name+'.'+side+'.elevation')
        recoil=next(o for o in col.objects if o.get('nodeId')==name+'.'+side+'.recoil')
        for o in list(recoil.children):
            if o.type=='MESH':bpy.data.objects.remove(o,do_unlink=True)
        T,H=spec['trunnionForward'],spec['pivotHeight']
        def local(o,parent):o.parent=parent;o['assemblyId']=name;return o
        profile=[(T-.75,.50),(5.45,.50),(7.65,.50),(7.70,.43),(11,.34),
                 (spec['muzzleForward'],.245),(spec['muzzleForward'],.178),
                 (spec['muzzleForward']-.65,.178)]
        n=40
        vs=[(x-T,r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n)) for x,r in profile for i in range(n)]
        fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
            for j in range(len(profile)-1) for i in range(n)]
        fs.append(tuple(reversed(range((len(profile)-1)*n,len(profile)*n))))
        barrel=local(mesh(name+'.'+side+'.turned-barrel',vs,fs,mats['edge'],col,True),recoil)
        barrel.data.materials.append(mats['dark'])
        for p in barrel.data.polygons:
            if p.index>=6*n:p.material_index=1
        barrel.data.set_sharp_from_angle(angle=math.radians(35))
        # Three locking straps and their longitudinal bridge are visible ahead
        # of the canvas; they recoil with the barrel rather than the gunhouse.
        for x in [6.15,6.80,7.45]:
            local(rod(name+'.barrel-locking-band',(x-T-.055,0,0),(x-T+.055,0,0),.545,mats['naval'],col,vertices=32),recoil)
            for sign in [-1,1]:
                local(box(name+'.barrel-band-lug',(x-T,sign*.505,.14),(.16,.105,.22),mats['edge'],col),recoil)
        local(box(name+'.barrel-strap-bridge',(6.8-T,0,.535),(1.42,.24,.095),mats['naval'],col),recoil)
        # Fixed bearing cheeks and the pitching trunnions physically connect
        # the gun to the floor. Recoil slides through their central sleeve.
        for sign in [-1,1]:
            y=gy+sign*.66
            own(box(name+'.bearing-post',(T,y,(3.4+H)/2),(.38,.19,H-3.4),mats['naval'],col))
            own(rod(name+'.bearing-cap',(T,y-.09,H),(T,y+.09,H),.19,mats['naval'],col,vertices=24))
            local(rod(name+'.trunnion-pin',(0,sign*.48,0),(0,sign*.66,0),.13,mats['edge'],col,vertices=20),elevation)
        # A square seam follows both the front aperture and its roof return.
        # Every shape keeps that seam fixed and pitches only the outer collar.
        rings=10;sectors=40;collar_x=5.45;collar_radius=.515
        def cover_points(degrees):
            theta=math.radians(degrees);c,s=math.cos(theta),math.sin(theta);result=[]
            for j in range(rings):
                t=j/(rings-1)
                for i in range(sectors):
                    a=i*math.tau/sectors;ca,sa=math.cos(a),math.sin(a);m=max(abs(ca),abs(sa))
                    z0=4.20+.75*sa/m;y0=.78*ca/m
                    x0=min(front_x(gy+y0,z0),3.35-(z0-4.8)*10.25/1.2)
                    along=collar_x-T;up=collar_radius*sa
                    end=(T+along*c-up*s,gy+collar_radius*ca,H+along*s+up*c)
                    p=[x0+(end[0]-x0)*t,gy+y0+(end[1]-gy-y0)*t,z0+(end[2]-z0)*t]
                    fold=math.sin(math.pi*t)*(.042*math.sin(a*7+t*4))
                    p[1]+=fold*ca;p[2]+=fold*sa-.10*math.sin(math.pi*t)
                    result.append(p)
            return result
        fs=[(j*sectors+i,j*sectors+(i+1)%sectors,(j+1)*sectors+(i+1)%sectors,(j+1)*sectors+i)
            for j in range(rings-1) for i in range(sectors)]
        cover=own(mesh(name+'.'+side+'.canvas-bag',cover_points(-5),fs,mats['canvas'],col,True))
        cover['nodeId']=name+'.'+side+'.cover';cover['gunCoverElevationId']=name+'.'+side+'.elevation'
        cover['gunCoverBaseAngle']=-5.0;cover['gunCoverAngles']=[float(a) for a in range(0,46,5)]
        cover.shape_key_add(name='Basis')
        for angle in range(0,46,5):
            shape=cover.shape_key_add(name='Elevation '+str(angle))
            for v,p in zip(shape.data,cover_points(angle)):v.co=p
            driver=shape.driver_add('value').driver;driver.type='SCRIPTED'
            var=driver.variables.new();var.name='pitch';var.type='TRANSFORMS'
            target=var.targets[0];target.id=elevation;target.transform_type='ROT_Y';target.transform_space='LOCAL_SPACE'
            driver.expression=f'max(0,1-abs(-pitch*57.29577951308232-{angle})/5)'
        # A narrow collar seam follows elevation and allows recoil inside it.
        for i in range(sectors):
            a=i*math.tau/sectors;b=(i+1)*math.tau/sectors
            local(rod(name+'.canvas-collar',(collar_x-T,collar_radius*math.cos(a),collar_radius*math.sin(a)),
                      (collar_x-T,collar_radius*math.cos(b),collar_radius*math.sin(b)),.018,mats['canvas'],col,vertices=6),elevation)
    # Seat the shared hatches on this gunhouse's longitudinally sloping roof.
    for o in col.objects:
        if o.parent==yaw and 'roof hatch' in o.name:o.location.z=roof_z(o.location.x)+.065
    # Four asymmetric rounded sight hoods visible in the approved top/front
    # views. The aperture, recessed objective and sloping cowl are physical.
    for index,(x,y,length,width) in enumerate([(2.10,0,.80,.44),
            (1.92,-2.55,.90,.46),(.80,-3.04,.90,.46),(1.80,2.55,1.20,.52)]):
        front=x+length/2;rear=x-length/2;z=roof_z(front)+.23
        n=20;vs=[]
        for xx,ry,rz,cz,power in [(rear,width*.46,.07,roof_z(rear)+.06,.4),
                           (front-.12,width/2,.23,z,.4),
                           (front,width/2,.20,z,.4),
                           (front,width/2-.045,.15,z,.4),
                           (front-.12,width/2-.045,.15,z,.4)]:
            for i in range(n):
                a=i*math.tau/n
                ca,sa=math.cos(a),math.sin(a)
                vs.append((xx,y+ry*math.copysign(abs(ca)**power,ca),
                           cz+rz*math.copysign(abs(sa)**power,sa)))
        fs=[tuple(reversed(range(n)))]
        fs += [(r*n+i,r*n+(i+1)%n,(r+1)*n+(i+1)%n,(r+1)*n+i)
               for r in range(4) for i in range(n)]
        own(mesh(name+'.sight-cowl-'+str(index+1),vs,fs,mats['naval'],col,True))
        own(box(name+'.sight-recess',(front-.135,y,z),(.04,width-.08,.31),mats['dark'],col))
        own(rod(name+'.sight-objective',(front-.125,y,z),(front-.105,y,z),.073,mats.get('glass',mats['dark']),col,vertices=20))
    # Centerline access ladder follows the projecting front plate between the
    # gun bags, then returns onto the roof toward the center sight hood.
    for yy in (-.29,.29):
        a=(front_x(yy,3.40)+.065,yy,3.40)
        b=(front_x(yy,4.80)+.065,yy,4.80)
        bar('front-ladder-stile',a,b,.024)
        bar('front-ladder-return',b,(2.65,yy,roof_z(2.65)+.065),.024)
    for z in (3.51,3.74,3.97,4.20,4.43,4.66):
        x=front_x(0,z)+.065
        bar('front-ladder-rung',(x,-.29,z),(x,.29,z),.021)
    for z in (3.48,4.65):
        for yy in (-.29,.29):
            x=front_x(yy,z)
            bar('front-ladder-foot',(x-.015,yy,z),(x+.065,yy,z),.027)
    # Rear ventilation grilles and access fittings.
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    shape=spec['gunhouseMesh']
    shell=BVHTree.FromPolygons(shape['vertices'],[f['indices'] for f in shape['faces']],all_triangles=True)
    H=spec['gunhouseSize'][2]
    for side in [-1,1]:
        y=side*2.6
        for x in [-6.0,-4.5]:
            own(box(name+'.roof-vent',(x,side*2.1,roof_z(x)+.12),(.72,.46,.22),mats['naval'],col))
            for j in range(4):
                own(box(name+'.vent-slat',(x-.26+j*.17,side*2.1,roof_z(x)+.2375),(.035,.42,.025),mats['edge'],col))
        # Access rungs and handrails are attached to the rear armor.
        for z in [3.6,3.95,4.3,4.65,5.0,5.35,5.7]:
            bar('ladder-rung',(-6.43,y-.27,z),(-6.43,y+.27,z))
        for yy in [y-.29,y+.29]:
            bar('ladder-stile',(-6.40,yy,3.4),(-6.40,yy,5.92))
        for z in [3.5,5.6]:
            for yy in [y-.29,y+.29]:
                contact=shell.ray_cast(Vector((-10,yy,z)),Vector((1,0,0)))[0]
                if contact is None:raise ValueError('Rear ladder foot misses the original gunhouse')
                bar('ladder-stand-off',(-6.40,yy,z),(contact.x+.035,yy,z))
        for x in [-5.3,-3.9,-2.5]:
            bar('roof-stanchion',(x,side*3.35,roof_z(x)-.02),(x,side*3.35,roof_z(x)+.12))
        bar('roof-handrail',(-5.3,side*3.35,roof_z(-5.3)+.12),(-2.5,side*3.35,roof_z(-2.5)+.12))
    return house

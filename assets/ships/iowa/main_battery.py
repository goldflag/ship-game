"""Original Mk.7 exterior and concealed mechanical connections.

Executed in Iowa's recipe scope. Dimensions are rounded observations of the
approved model; all meshes are constructed here, without external assets.
"""

def main_gun_cover(mount,side,gy,yaw,elevation):
    """Cloth endpoints remain seated; five-degree shapes follow the gun's pitch.

    Shape drivers provide the same visual loop in Blender that the renderer
    obtains from the exported angle metadata. Recoil slides inside the collar.
    """
    spec=mount['weapon'];n=40;rings=9
    def points(degrees):
        theta=math.radians(degrees);c,s=math.cos(theta),math.sin(theta);result=[]
        for j in range(rings):
            t=j/(rings-1)
            for i in range(n):
                a=i*math.tau/n;ca,sa=math.cos(a),math.sin(a)
                z0=1.92+1.20*math.copysign(abs(sa)**.72,sa)
                y0=1.035*math.copysign(abs(ca)**.70,ca)
                x0=6.03-(z0-.576)*2.255/2.624-.035
                along=6.91-spec['trunnionForward'];up=.647*sa
                end=Vector((spec['trunnionForward']+along*c-up*s,gy+.647*ca,spec['pivotHeight']+along*s+up*c))
                p=Vector((x0,gy+y0,z0)).lerp(end,t)
                fold=math.sin(math.pi*t)*(.045*math.sin(a*7+t*3))
                p.y+=fold*ca;p.z+=fold*sa-.10*math.sin(math.pi*t)
                result.append(p)
        return result
    faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(rings-1) for i in range(n)]
    cover=mesh('Mk.7 deforming canvas blast bag',points(0),faces,'canvas',smooth=True);parent_local(cover,yaw)
    cover['nodeId']=mount['id']+'.'+side+'.cover'
    cover['gunCoverElevationId']=mount['id']+'.'+side+'.elevation'
    cover['gunCoverAngles']=[float(a) for a in range(5,46,5)]
    cover.shape_key_add(name='Basis')
    for angle in range(5,46,5):
        shape=cover.shape_key_add(name='Elevation '+str(angle))
        for v,p in zip(shape.data,points(angle)):v.co=p
        driver=shape.driver_add('value').driver;driver.type='SCRIPTED'
        var=driver.variables.new();var.name='pitch';var.type='TRANSFORMS'
        target=var.targets[0];target.id=elevation;target.transform_type='ROT_Y';target.transform_space='LOCAL_SPACE'
        driver.expression=f'max(0,1-abs(-pitch*57.29577951308232-{angle})/5)'

def main_battery(gunhouse, mount):
    spec=mount['weapon'];yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
    before=set(scene.objects);F=Fittings(helpers,materials,COL)
    # Keep the catalog's armor envelope, opening only its visual face plating.
    old=gunhouse.data;shape=spec['gunhouseMesh'];vv=[tuple(v.co) for v in old.vertices];ff=[];indices=[]
    for p,f in zip(old.polygons,shape['faces']):
        if not f['id'].startswith('side-5-'):ff.append(tuple(p.vertices));indices.append(p.material_index)
    def face_x(z):return 6.03-(z-.576)*2.255/2.624
    def panel(y0,y1,z0,z1):
        start=len(vv);vv.extend((face_x(z),y,mount['position'][1]+z) for y,z in [(y0,z0),(y1,z0),(y1,z1),(y0,z1)])
        ff.append(tuple(range(start,start+4)));indices.append(0)
    centers=[-spec['barrelSpacing'],0,spec['barrelSpacing']];half=1.045
    panel(-5.05,5.05,.576,.72);panel(-5.05,5.05,3.13,3.2)
    ends=[-5.05]+[p for y in centers for p in [y-half,y+half]]+[5.05]
    for a,b in zip(ends[::2],ends[1::2]):panel(a,b,.72,3.13)
    data=bpy.data.meshes.new(mount['id']+' open armored face');data.from_pydata(vv,[],ff);data.update()
    for mat in [materials['naval'],materials['armor_roof']]:data.materials.append(mat)
    for p,i in zip(data.polygons,indices):p.material_index=i
    gunhouse.data=data
    for obj in list(yaw.children):
        if obj.type=='MESH' and 'roof hatch' in obj.name:bpy.data.objects.remove(obj,do_unlink=True)

    for side,gy in [('left',spec['barrelSpacing']),('center',0),('right',-spec['barrelSpacing'])]:
        elevation=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.'+side+'.elevation')
        recoil=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.'+side+'.recoil')
        for obj in list(recoil.children):
            if obj.type=='MESH':bpy.data.objects.remove(obj,do_unlink=True)
        # Continuous turned barrel, stepped chase, and a genuinely recessed bore.
        profile=[(3.90,.612),(6.91,.612),(8.316,.594),(8.35,.500),(9.249,.500),(12.136,.406),(18.888,.317),(18.888,.203),(18.18,.203)]
        n=40;verts=[(x-spec['trunnionForward'],r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n)) for x,r in profile for i in range(n)]
        faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(profile)-1) for i in range(n)]
        faces.append(tuple(reversed(range((len(profile)-1)*n,len(profile)*n))))
        barrel=mesh('Mk.7 stepped barrel and recessed bore',verts,faces,'edge',smooth=True);barrel.data.materials.append(materials['dark'])
        for p in barrel.data.polygons:
            if p.index>=7*n:p.material_index=1
        barrel.data.set_sharp_from_angle(angle=math.radians(35))
        parent_local(barrel,recoil)
        main_gun_cover(mount,side,gy,yaw,elevation)
        parent_local(F.ring('Canvas collar seam',(6.90-spec['trunnionForward'],0,0),.647,.024,'x','canvas',segments=32),elevation)
        # A retained cradle pitches on real trunnions; the barrel slides inside.
        n=32;verts=[(x,r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n)) for x,r in [(-.12,.625),(-.12,.695),(1.05,.625),(1.05,.695)] for i in range(n)]
        faces=[]
        for i in range(n):
            j=(i+1)%n
            for a,b in [(0,64),(96,32),(32,0),(64,96)]:faces.append((a+i,a+j,b+j,b+i))
        parent_local(mesh('Mk.7 retained recoil cradle',verts,faces,'naval',smooth=True),elevation)
        for sign in [-1,1]:
            parent_local(rod('Mk.7 trunnion pin',(0,sign*.67,0),(0,sign*.98,0),.16,'naval',vertices=16),elevation)
            box('Mk.7 floor-mounted bearing post',(spec['trunnionForward'],gy+sign*.91,(.161+spec['pivotHeight']+.18)/2),(.48,.24,spec['pivotHeight']+.18-.161))
        # Narrow ladders climb the face between the three gun ports.
    for y in [-4.61,-1.575,1.575,4.61]:
        a=(face_x(.66)+.045,y,.66);b=(face_x(3.06)+.045,y,3.06)
        F.ladder('Mk.7 face ladder',a,b,.36,normal='x')
        for z in [.85,2.8]:
            for dy in [-.18,.18]:rod('Face ladder shoe',(face_x(z),y+dy,z),(face_x(z)+.075,y+dy,z),.022,'naval',vertices=6)

    # Aft rangefinder hoods emerge from the tapered sides, with flanges and
    # forward-facing optics. Side sights are the two staggered small housings.
    rod('Mk.7 internal rangefinder tube',(-6.82,-7.38,2.48),(-6.82,7.38,2.48),.22,'naval',vertices=16)
    for sign in [-1,1]:
        box('Mk.7 rangefinder hood',(-6.82,sign*6.59,2.46),(1.75,2.35,1.20))
        box('Rangefinder seating flange',(-6.82,sign*5.48,2.44),(2.05,.14,1.46))
        box('Rangefinder window frame',(-5.929,sign*7.26,2.47),(.075,.49,1.03),'edge')
        box('Rangefinder optical glass',(-5.884,sign*7.26,2.47),(.025,.34,.88),'glass')
        # Rounded oval inspection cover on each outboard hood end.
        path=[(-6.82+.72*math.cos(i*math.tau/24),sign*7.78,2.46+.43*math.sin(i*math.tau/24)) for i in range(24)]
        for a,b in zip(path,path[1:]+path[:1]):rod('Rangefinder end-cover rim',a,b,.023,'naval',vertices=6)
        for x in [-7.73,-5.91]:
            for z in [1.86,2.2,2.54,2.99]:rod('Rangefinder flange bolt',(x,sign*5.55,z),(x,sign*5.61,z),.025,'edge',vertices=8)
        for x,y,z in [(1.18,6.31,2.43),(-.23,6.83,1.65)]:
            box('Mk.7 side sight flange',(x,sign*(y-.25),z),(.81,.16,.85))
            box('Mk.7 armored side sight',(x,sign*y,z),(.57,.65,.68))
            box('Mk.7 sight bezel',(x+.292,sign*y,z),(.055,.49,.54),'edge')
            box('Mk.7 sight lens',(x+.325,sign*y,z),(.018,.33,.39),'glass')
        # Ladder follows the inclined side armor instead of hovering vertically.
        F.ladder('Mk.7 side ladder',(-1.17,sign*6.52,.30),(-1.17,sign*5.92,3.17),.44,normal='y')
        for z in [.5,2.9]:
            y=6.58-(z-.161)*.20
            for x in [-1.39,-.95]:rod('Side ladder shoe',(x,sign*(y-.15),z),(x,sign*y,z),.026,'naval',vertices=6)
        # Rear safety basket: rails, ribs, and an open mesh floor, all attached.
        y0,y1=(.35,3.25) if sign==1 else (-3.25,-.35)
        for yy in [y0+i*(y1-y0)/12 for i in range(13)]:
            x=-9.46+.12*abs(yy)
            rod('Turret basket rib',(x,yy,3.17),(x-.35,yy,2.73),.018,'edge',vertices=6)
            rod('Turret basket floor',(x-.35,yy,2.73),(x-.52,yy,3.17),.018,'edge',vertices=6)
        for zz,dx in [(3.17,.03),(2.74,.35),(3.17,.53)]:
            rod('Turret basket edge',(-9.46+.12*abs(y0)-dx,y0,zz),(-9.46+.12*abs(y1)-dx,y1,zz),.026,'naval',vertices=6)
    for y in [-1.60,1.60]:
        cyl('Mk.7 roof periscope base',(-5.31,y,3.27),.16,.14,vertices=16)
        cyl('Mk.7 roof periscope',(-5.31,y,3.42),.09,.26,vertices=12)
        box('Mk.7 periscope head',(-5.25,y,3.55),(.25,.20,.15))
        box('Periscope lens',(-5.116,y,3.55),(.02,.14,.085),'glass')
    # Subtle plating joins, clipped to the actual narrowing roof perimeter.
    for x,halfwidth in [(-7.6,4.86),(-3.8,5.43),(.2,6.03)]:rod('Mk.7 roof plating seam',(x,-halfwidth,3.205),(x,halfwidth,3.205),.006,'edge',vertices=4)
    box('Mk.7 rear access cover',(-9.448,0,1.81),(.045,1.09,1.91))
    for y in [-.56,.56]:rod('Rear access coaming',(-9.481,y,.83),(-9.481,y,2.82),.024,'naval',vertices=6)
    attach_all(set(scene.objects)-before,yaw)

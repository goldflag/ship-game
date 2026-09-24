"""Midships: funnels and their AA decks, funnel searchlights, 40 mm funnel tubs, midships 02/03-level fittings.

Region: runtime z +4..+35 m above the 02 deck (11.05 m). Executed in build.py's scope after tower.py.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL);structures={s['id']:s for s in D['structures']}

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


for s in D['structures']:
    if s.get('exhaust'):
        funnel_details(s,next(o for o in scene.objects if o.get('nodeId')==s['id']+'.surface'))

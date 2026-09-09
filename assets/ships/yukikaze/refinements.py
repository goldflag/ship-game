"""Original close-view geometry for the approved Yukikaze fit.
Executed by build.py with its original geometry helpers; no external asset reads.
"""

def refined_main(mount,yaw):
    from mathutils.geometry import intersect_ray_tri
    from mathutils.bvhtree import BVHTree
    name=mount['id'];sp=mount['weapon'];shape=sp['gunhouseMesh']
    skin=BVHTree.FromPolygons([Vector(v) for v in shape['vertices']],[f['indices'] for f in shape['faces']],all_triangles=True)
    def put(o,parent=yaw):return local(o,parent,name)
    def roof(x,y):
        hits=[intersect_ray_tri(*[Vector(shape['vertices'][i]) for i in f['indices']],Vector((0,0,-1)),Vector((x,y,5))) for f in shape['faces']]
        return max((h.z for h in hits if h is not None),default=.3)
    # Shared sockets survive; replace only the generic external fittings.
    for o in list(col.objects):
        if o.get('assemblyId')==name and o.type=='MESH' and any(t in o.name for t in ['canvas mantlet',' • barrel','recessed bore','roof hatch']):bpy.data.objects.remove(o,do_unlink=True)
    for side,gy,_ in barrel_layout(sp):
        elev=next(o for o in col.objects if o.get('nodeId')==name+'.'+side+'.elevation')
        rec=next(o for o in col.objects if o.get('nodeId')==name+'.'+side+'.recoil')
        # Broad fabric boot seated at the trunnion, tapering around the recoiling chase.
        rings=[(-.30,.32,.64,.12),(.08,.34,.65,.06),(.55,.30,.43,-.02),(1.0,.23,.27,-.025),(1.48,.184,.184,0),(1.82,.184,.184,0)]
        vs=[];N=32
        for k,(x,ry,rz,cz) in enumerate(rings):
            for j in range(N):
                t=j*math.tau/N;fold=1+.028*math.cos(t*7+k*.8)
                vs.append((x,ry*math.cos(t)*fold,cz+rz*math.sin(t)*fold))
        fs=[(k*N+j,k*N+(j+1)%N,(k+1)*N+(j+1)%N,(k+1)*N+j) for k in range(len(rings)-1) for j in range(N)]
        put(mesh(name+'.blast-bag',vs,fs,materials['canvas'],smooth=True),elev)
        put(rod(name+'.boot-cuff',(1.76,0,0),(1.85,0,0),.19,materials['canvas'],vertices=32),elev)
        for a,b,ra,rb in [(-.2,1.9,.17,.17),(1.9,2.1,.17,.15),(2.1,4.56,.15,.116),(4.56,4.64,.116,.123)]:
            put(rod(name+'.chase',(a,0,0),(b,0,0),ra,materials['edge'],r2=rb,vertices=32),rec)
        put(rod(name+'.bore',(4.634,0,0),(4.644,0,0),.0635,materials['dark'],vertices=24),rec)
    # Low roof-edge safety rails; each foot follows the authored roof facets.
    path=[(1.05,-1.16),(.95,-1.85),(.57,-2.22),(-.90,-2.22),(-2.70,-1.80),(-3.32,-1.42),(-3.38,0),(-3.32,1.42),(-2.70,1.80),(-.90,2.22),(.57,2.22),(.95,1.85),(1.05,1.16)]
    pts=[(x,y,roof(x,y)) for x,y in path]
    put(tube_path(name+'.roof-edge-rail',[(x,y,z+.19) for x,y,z in pts],.019,materials['edge']))
    for x,y,z in pts:put(rod(name+'.rail-foot',(x,y,z-.012),(x,y,z+.19),.019,materials['naval']))
    # Circular deck plates, short grabs and the offset sighting hood seen in the source.
    for x,y in [(-2.6,-.6),(-2.6,.6),(-1.5,-1.65),(-1.5,1.65),(.60,-1.85),(.60,1.85),(-.80,-.53),(-.80,.53)]:
        put(cyl(name+'.roof-vent',(x,y,roof(x,y)+.027),.17,.054,materials['naval'],vertices=24))
    for y in [-.56,.56]:
        pts=[(-2.05,y,roof(-2.05,y)),(-2.05,y,roof(-2.05,y)+.16),(-.9,y,roof(-.9,y)+.16),(-.9,y,roof(-.9,y))]
        put(tube_path(name+'.roof-grab',pts,.018,materials['edge']))
    x,y=.05,-1.5;z=roof(x,y)
    put(box(name+'.sight-hood',(x,y,z+.19),(.60,.65,.36),materials['naval'],bev=.075))
    put(box(name+'.sight-glass',(x+.307,y,z+.2),(.012,.39,.14),materials['glass'],bev=.015))
    for sign in [-1,1]:
        # The handrails follow the tapered side rather than floating outside it.
        side=[(1.27,sign*1.05),(.98,sign*1.97),(.58,sign*2.35),(-.95,sign*2.35),(-2.8,sign*1.99),(-3.49,sign*1.18)]
        for z in [.38,1.03,1.96]:
            contacts=[skin.find_nearest(Vector((x,y,z)))[:2] for x,y in side]
            put(tube_path(name+'.side-rail',[p+n*.05 for p,n in contacts],.016,materials['edge']))
            for p,n in contacts:put(rod(name+'.side-rail-foot',p-n*.012,p+n*.05,.020,materials['naval']))
        put(box(name+'.rear-door',(-3.53,sign*.69,1.08),(.065,.73,1.36),materials['naval'],bev=.09))
        put(rod(name+'.door-handle',(-3.58,sign*.46,.94),(-3.58,sign*.46,1.10),.018,materials['edge']))
        for z in [.48,.83,1.18,1.53,1.88]:
            put(tube_path(name+'.rear-step',[(-3.48,sign*.16,z),(-3.62,sign*.16,z),(-3.62,sign*.36,z),(-3.48,sign*.36,z)],.018,materials['edge']))
    # Visible radial floor knees connect the overhanging apron to the bearing ring.
    for i in range(12):
        t=i*math.tau/12;x,y=math.cos(t),math.sin(t)
        r=1.48 if x>.5 else 1.83
        o=put(mesh(name+'.floor-knee',[(x*1.35,y*1.35,.055),(x*1.35,y*1.35,.30),(x*r,y*r,.30)],[(0,1,2)],materials['naval']));mod=o.modifiers.new('Knee plate thickness','SOLIDIFY');mod.thickness=.022

def refined_funnels():
    from mathutils.bvhtree import BVHTree
    for label,cx,base,top,rx,ry,rake,slope in [('forward',14.0,3.85,11.42,2.10,1.40,-.75,.32),('after',-2.8,5.64,9.98,1.48,1.15,-.34,.23)]:
        N=64
        # Sculpted uptake merges into a raked oval barrel. The mouth slopes down aft.

        surface=next(s for s in definition['structures'] if s['id']==label+'-funnel')['surface']
        vs=[(-z,-x,y) for x,y,z in surface['vertices']];fs=surface['triangles']
        skin=BVHTree.FromPolygons([Vector(v) for v in vs],fs,all_triangles=True)
        o=mesh(label+'-funnel.shell',vs,fs,materials['naval'],smooth=True);o.data.materials.append(materials['dark'])
        for p in o.data.polygons:
            if min(vs[i][2] for i in p.vertices)>=top-1.18-.001:p.material_index=1
        mod=o.modifiers.new('Funnel jacket thickness','SOLIDIFY');mod.thickness=.055
        mouth=lambda t:(cx+rake+rx*1.035*math.cos(t),ry*1.035*math.sin(t),top+slope*rx*math.cos(t))
        tube_path(label+'-funnel.rolled-lip',[mouth(j*math.tau/N) for j in range(N)],.040,materials['edge'],closed=True)
        # Interior throat is inset visibly below the open rim.
        mesh(label+'-funnel.throat',[(cx+rake+rx*.92*math.cos(j*math.tau/N),ry*.92*math.sin(j*math.tau/N),top-.75+slope*rx*math.cos(j*math.tau/N)) for j in range(N)],[tuple(range(N))],materials['dark'])
        # Arched cap stays, seated at both sides of the sloping mouth.
        for q in [-.65,0,.65]:
            a=math.asin(q);xx=math.sqrt(1-q*q)*rx*1.035
            pts=[]
            for j in range(17):
                x=-xx+2*xx*j/16;pts.append((cx+rake+x,q*ry*1.035,top+slope*x/1.035+.23*math.sin(math.pi*j/16)))
            tube_path(label+'-funnel.cap-stay',pts,.024,materials['edge'])
        tube_path(label+'-funnel.cap-spine',[(cx+rake,ry*1.035*(-1+2*j/16),top+.23*math.sin(math.pi*j/16)) for j in range(17)],.023,materials['edge'])
        for frac in [.26,.60,.83]:
            z=base+(top-base)*frac;dx=rake*frac
            tube_path(label+'-funnel.seam',[(cx+dx+rx*1.015*math.cos(j*math.tau/N),ry*1.015*math.sin(j*math.tau/N),z) for j in range(N)],.018,materials['edge'],closed=True)
        # A single forward ladder, with individual side grabs instead of four straight pipes.
        for z in [base+.22+j*.30 for j in range(int((top-base+.3)/.30))]:
            hit=skin.ray_cast(Vector((cx+rx+5,0,z)),Vector((-1,0,0)))[0]
            if hit is None:continue
            x=hit.x+.09
            tube_path(label+'-funnel.rung',[(x-.13,-.20,z),(x,-.20,z),(x,.20,z),(x-.13,.20,z)],.023,materials['edge'])
        for sign in [-1,1]:
            x=cx+rx+.12;y=sign*.48
            path=[(cx+rx+1.05,y,base-.03),(cx+rx+.50,y,base+.55),(x,y,base+1.6),(cx+rake+rx+.12,y,top-.90)]
            tube_path(label+'-funnel.vent-pipe',path,.10,materials['naval'],sides=16)
            tip=Vector(path[-1]);d=Vector((.4,sign*.17,.28));rod(label+'-funnel.cowl',tip,tip+d,.12,materials['naval'],r2=.24,vertices=24)
            rod(label+'-funnel.cowl-mouth',tip+d,tip+d*1.02,.205,materials['dark'],vertices=24)
            for z in [base+2,top-1.15]:
                dx=rake*(z-base)/(top-base);rod(label+'-funnel.pipe-bracket',(cx+dx+rx-.22,y,z),(cx+dx+rx+.18,y,z),.04,materials['naval'])
        if label=='forward':
            # The paired tall steam outlets terminate the long bridge trunk.
            for sign in [-1,1]:
                y=sign*1.54
                tube_path('forward-funnel.steam-outlet',[(13.9,y,9.3),(13.50,y,10.2),(13.30,y,11.1),(13.30,y,12.5)],.13,materials['naval'],sides=20)
                rod('forward-funnel.outlet-mouth',(13.30,y,12.47),(13.30,y,12.51),.10,materials['dark'],vertices=20)
            rod('forward-funnel.outlet-crosspipe',(13.30,-1.54,12.26),(13.30,1.54,12.26),.12,materials['naval'],vertices=20)
            # Long teardrop shoulder over the uptake's aft face.
            profile=[(14.2,.6,6.0),(11.5,1.25,6.0),(9.65,1.15,5.75),(10.6,.55,5.15),(13.9,.45,4.3)]
            vs=[(x,sign*y,z) for sign in [-1,1] for x,y,z in profile]
            mesh('forward-funnel.after-fairing',vs,[(0,1,2,3,4),(9,8,7,6,5)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],materials['naval'])
        # Fine external braces seat directly on the lower casing and jacket.
        for sign in [-1,1]:
            for x in [cx-rx,cx+rx]:rod(label+'-funnel.guy',(x,sign*ry*.72,base-.035),(cx+rake+sign*.45,sign*ry*.96,top-1.2),.008,materials['edge'],vertices=5)

def refined_bridge():
    # Upper bridge: curved front, rear wings and the shallow plated overhang.
    s=next(s for s in definition['structures'] if s['id']=='wheelhouse')
    outline=[(-z,-x) for x,z in s['footprint']]
    for o in list(col.objects):
        if o.name.startswith('wheelhouse.') and o.type=='MESH':bpy.data.objects.remove(o,do_unlink=True)
    N=len(outline);surface=s['surface'];vs=[(-z,-x,y) for x,y,z in surface['vertices']];fs=surface['triangles']
    mesh('wheelhouse.contoured-shell',vs,fs,materials['naval'])
    tube_path('bridge.roof-lip',[(x,y,10.42) for x,y in outline],.062,materials['naval'],closed=True)
    # Window band follows the bow curves but leaves the aft wings plated.
    for i,(x,y) in enumerate(outline):
        a=Vector((x,y,9.50));b=Vector((*outline[(i+1)%N],9.50));delta=b-a
        if (a.x+b.x)/2<26.55:continue
        normal=Vector((delta.y,-delta.x,0)).normalized()*.027;n=max(1,math.ceil(delta.length/.57))
        for j in range(n):
            q=a+delta*((j+.075)/n)+normal;r=a+delta*((j+.925)/n)+normal
            mesh('bridge.window',[q,r,r+Vector((0,0,.75)),q+Vector((0,0,.75))],[(0,1,2,3)],materials['glass'])
            for p in [q,r]:rod('bridge.window-mullion',p,p+Vector((0,0,.75)),.022,materials['naval'],vertices=8)
            for z in [0,.75]:rod('bridge.window-frame',q+Vector((0,0,z)),r+Vector((0,0,z)),.024,materials['naval'],vertices=8)
    tube_path('bridge.window-sill',[(x,y,9.43) for x,y in outline if x>26.35],.030,materials['edge'])
    for sign in [-1,1]:
        for x in [24.65,25.8]:
            rod('bridge.wing-knee',(x,sign*1.9,7.7),(x,sign*2.70,8.78),.045,materials['naval'])
        # Aft box sits above a genuinely open deck and its braced supports.
        rod('bridge.after-column',(19.25,sign*1.14,deckz(19.25)),(19.25,sign*1.14,6.1),.10,materials['naval'],vertices=16)
        rod('bridge.after-brace',(19.25,sign*1.14,4.8),(22.0,sign*1.14,6.1),.08,materials['naval'])
        bulwark('bridge.aft-screen',[(19.1,sign*1.25),(19.1,sign*.25),(21.7,sign*.25)],8.05,.88,closed=False)
        ladder('bridge.access-ladder',(23.95,sign*2.12,4.75),(23.95,sign*2.12,8.35),.38)
        door('bridge.lower-door',24.9,sign*2.045,4.80,sign,w=.59,h=1.48)
        for x in [26.2,27.3]:portlight('bridge.portlight',(x,sign*2.06,7.56),(0,sign,0),.115)
        # Ring buoy, brackets and the small paired deck ventilator cowls.
        center=Vector((24.45,sign*2.81,8.16))
        rod('bridge.buoy-bracket',(24.45,sign*2.03,8.16),center,.035,materials['naval'])
        tube_path('bridge.lifebuoy',[center+Vector((.33*math.cos(j*math.tau/40),0,.33*math.sin(j*math.tau/40))) for j in range(40)],.074,materials['canvas'],closed=True)
        for x in [23.0,25.0]:
            path=[(x,sign*2.4,4.72),(x,sign*2.4,5.8),(x+.10,sign*2.4,6.24),(x+.42,sign*2.4,6.48)]
            tube_path('bridge.deck-vent',path,.16,materials['naval'],sides=20)
            rod('bridge.deck-vent-hood',path[-1],(x+.69,sign*2.4,6.52),.19,materials['naval'],r2=.25,vertices=24)
            rod('bridge.deck-vent-mouth',(x+.69,sign*2.4,6.52),(x+.705,sign*2.4,6.52),.215,materials['dark'],vertices=24)
        # The reference's low solid outboard screens below the AA sweep.
        pts=[(x,sign*(width(x)-.19)) for x in [23.2,27.0,31.0,34.0]]
        bulwark('bridge.deck-screen',pts,4.72,.62,closed=False)
        # Signal lamps stand on the upper wing through a visible base and yoke.
        x,y=25.8,sign*2.12
        cyl('bridge.signal-base',(x,y,10.45),.15,.10,materials['naval'],vertices=20)
        rod('bridge.signal-pedestal',(x,y,10.45),(x,y,10.95),.05,materials['naval'])
        rod('bridge.signal-lamp',(x-.16,y,11.05),(x+.16,y,11.05),.13,materials['naval'],vertices=24)
        rod('bridge.signal-lens',(x+.16,y,11.05),(x+.17,y,11.05),.105,materials['glass'],vertices=24)
        for yy in [-.14,.14]:rod('bridge.signal-fork',(x,y,10.86),(x,y+yy,11.05),.025,materials['edge'])
    # Cylindrical Type 94 director head with forward optical housings.
    for sign in [-1,1]:
        box('director.optical-box',(26.34,sign*.42,11.75),(.34,.25,.92),materials['naval'],bev=.045)
        box('director.optical-aperture',(26.516,sign*.42,12.02),(.012,.14,.18),materials['glass'],bev=.006)
        rod('director.optical-grab',(26.52,sign*.42,11.40),(26.52,sign*.42,11.67),.024,materials['edge'])
    cyl('director.lower-bearing',(25.05,0,10.44),.94,.12,materials['edge'],vertices=48)
    for x in [25.15,25.8]:
        for sign in [-1,1]:
            y=sign*.98
            for z in [10.78,11.08,11.38,11.68]:tube_path('director.access-step',[(x,y,z),(x, y+sign*.12,z),(x+.18,y+sign*.12,z),(x+.18,y,z)],.017,materials['edge'])
    # Fine signal stays terminate on modeled deck eyelets.
    for sign in [-1,1]:
        for x,y,z in [(29.2,sign*.9,10.43),(24.5,sign*2.6,10.43)]:
            rod('bridge.signal-eye',(x,y,z-.03),(x,y,z+.09),.023,materials['naval'])
            rod('bridge.signal-stay',(x,y,z+.08),(20.16,sign*.15,20),.006,materials['edge'],vertices=5)

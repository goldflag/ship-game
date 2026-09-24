"""Original close-view geometry for the approved Yukikaze fit.
Executed by build.py with its original geometry helpers; no external asset reads.
"""

def refined_funnels():
    from mathutils.bvhtree import BVHTree
    # Measured on the approved model: base centre, base, mid-mouth height, half-length, half-width, rake, mouth slope.
    for label,cx,base,top,rx,ry,rake,slope in [('forward',13.85,3.85,11.27,1.95,1.1,-.1,.387),('after',-1.6,5.64,10.3,1.36,1.03,-.3,.265)]:
        N=64
        # Sculpted uptake merges into a raked oval barrel. The mouth slopes down aft.

        surface=next(s for s in definition['structures'] if s['id']==label+'-funnel')['surface']
        vs=[(-z,-x,y) for x,y,z in surface['vertices']];fs=surface['triangles']
        skin=BVHTree.FromPolygons([Vector(v) for v in vs],fs,all_triangles=True)
        o=mesh(label+'-funnel.shell',vs,fs,materials['naval'],smooth=True);o.data.materials.append(materials['dark'])
        # The cap band: every face above the fourth ring, which runs 1 m below the sloping mouth.
        ring=len(vs)//6
        for p in o.data.polygons:
            if min(p.vertices)>=4*ring:p.material_index=1
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
        # Ventilator trunks with side-facing cowls: fore and aft of the fore funnel, forward of the after one.
        pipes=[('front',.4)]+([('aft',0)] if label=='forward' else [])
        for end,y in pipes:
            if end=='front':
                x=cx+rx+.14
                path=[(cx+rx+1.3,y,base+.02),(cx+rx+.9,y,base+.7),(x,y,base+2.2),(cx+rake+rx+.18,y,top-.4)]
            else:
                x=cx-rx-.12
                path=[(x,y,6.3),(cx+rake-rx-.2,y,top-1.3)]
            tube_path(label+'-funnel.vent-pipe',path,.11,materials['naval'],sides=16)
            tip=Vector(path[-1]);d=Vector((0,-.42,.12));rod(label+'-funnel.cowl',tip,tip+d,.13,materials['naval'],r2=.26,vertices=24)
            rod(label+'-funnel.cowl-mouth',tip+d,tip+d*1.02,.22,materials['dark'],vertices=24)
            for z in [base+2.4,top-1.6]:
                dx=rake*(z-base)/(top-base);px=Vector(path[-1]).x
                if end=='front':rod(label+'-funnel.pipe-bracket',(cx+dx+rx-.22,y,z),(cx+dx+rx+.22,y,z),.04,materials['naval'])
                else:rod(label+'-funnel.pipe-bracket',(cx+dx-rx+.22,y,z),(cx+dx-rx-.2,y,z),.04,materials['naval'])
        if label=='forward':
            # Port steam pipe's run up the funnel side, turning in to the whistle frame on the centreline.
            y=1.56
            rod('forward-funnel.steam-riser',(14.0,y,9.6),(14.0,y,12.45),.12,materials['naval'],vertices=12)
            rod('forward-funnel.riser-mouth',(14.0,y,12.43),(14.0,y,12.47),.09,materials['dark'],vertices=12)
            rod('forward-funnel.outlet-stem',(14.0,0,10.9),(14.0,0,12.25),.09,materials['naval'],vertices=12)
            for z in [10.3,11.3]:rod('forward-funnel.riser-bracket',(14.0,y,z),(14.0,1.0,z),.04,materials['edge'])
            for x,z0 in [(13.6,11.4),(14.4,11.7)]:
                rod('forward-funnel.steam-outlet',(x,0,z0),(x,0,12.47),.11,materials['naval'],vertices=16)
                rod('forward-funnel.outlet-mouth',(x,0,12.45),(x,0,12.49),.08,materials['dark'],vertices=16)
            rod('forward-funnel.outlet-crosspipe',(13.6,0,12.25),(14.4,0,12.25),.09,materials['naval'],vertices=16)
            # Flared skirt round the funnel foot: an oval shelf reaching 1.8 m aft of the barrel.
            def oval(cz,a,b,z,n=48):return [(cz+a*math.cos(t),b*math.sin(t),z) for t in [i*math.tau/n for i in range(n)]]
            rings=[oval(13.5,2.3,1.35,4.95),oval(12.93,2.78,1.58,5.75),oval(12.93,2.78,1.58,5.95),oval(13.84,1.98,1.11,6.55)]
            n=48;vs=[p for r in rings for p in r]
            fs=[(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(3) for j in range(n)]
            mesh('forward-funnel.skirt',vs,fs,materials['naval'],smooth=True)
            tube_path('forward-funnel.skirt-edge',oval(12.93,2.8,1.6,5.95),.035,materials['edge'],closed=True)
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
    tube_path('bridge.roof-lip',[(x,y,10.80) for x,y in outline],.062,materials['naval'],closed=True)
    # Window band follows the bow curves but leaves the aft wings plated.
    for i,(x,y) in enumerate(outline):
        # The reference paints its windows 9.95-10.65 m round the front, back to the wing step.
        a=Vector((x,y,9.95));b=Vector((*outline[(i+1)%N],9.95));delta=b-a
        if (a.x+b.x)/2<26.9:continue
        normal=Vector((delta.y,-delta.x,0)).normalized()*.027;n=max(1,math.ceil(delta.length/.57))
        for j in range(n):
            q=a+delta*((j+.075)/n)+normal;r=a+delta*((j+.925)/n)+normal
            mesh('bridge.window',[q,r,r+Vector((0,0,.70)),q+Vector((0,0,.70))],[(0,1,2,3)],materials['glass'])
            for p in [q,r]:rod('bridge.window-mullion',p,p+Vector((0,0,.70)),.022,materials['naval'],vertices=8)
            for z in [0,.70]:rod('bridge.window-frame',q+Vector((0,0,z)),r+Vector((0,0,z)),.024,materials['naval'],vertices=8)
    tube_path('bridge.window-sill',[(x,y,9.88) for x,y in outline if x>26.7],.030,materials['edge'])
    for sign in [-1,1]:
        for x in [24.45,25.3]:
            rod('bridge.wing-knee',(x,sign*1.98,8.05),(x,sign*2.95,8.83),.045,materials['naval'])
        # Aft box sits above a genuinely open deck and its braced supports.
        # The after platform stands on a braced trestle over the main deck.
        for x in [19.6,23.7]:rod('bridge.after-column',(x,sign*1.3,deckz(19.6)),(x,sign*1.3,6.75),.10,materials['naval'],vertices=16)
        for a,b in [((19.6,2.9),(23.7,6.6)),((23.7,2.9),(19.6,6.6))]:rod('bridge.after-brace',(a[0],sign*1.3,a[1]),(b[0],sign*1.3,b[1]),.06,materials['naval'])
        rod('bridge.after-crossbar',(19.6,-1.3,6.6),(19.6,1.3,6.6),.06,materials['naval'])
        # Canvas-covered shelters on the after platform, outboard of the mast trestle.
        x0,x1=20.45 if sign>0 else 21.12,23.51
        box('bridge.shelter',((x0+x1)/2,sign*1.84,9.4),(x1-x0,.62,1.1),materials['canvas'],bev=.12)
        for xx in [x0+.25,(x0+x1)/2,x1-.25]:rod('bridge.shelter-batten',(xx,sign*1.52,9.93),(xx,sign*2.16,9.93),.02,materials['edge'])
        ladder('bridge.access-ladder',(23.95,sign*2.12,4.75),(23.95,sign*2.12,8.85),.38)
        door('bridge.lower-door',24.9,sign*2.045,4.80,sign,w=.59,h=1.48)
        for x in [26.2,27.3]:portlight('bridge.portlight',(x,sign*2.01,7.85),(0,sign,0),.115)
        # Ring buoy, brackets and the small paired deck ventilator cowls.
        center=Vector((24.45,sign*2.81,8.16))
        rod('bridge.buoy-bracket',(24.45,sign*2.03,8.16),center,.035,materials['naval'])
        rod('bridge.buoy-clip',center-Vector((0,0,.36)),center+Vector((0,0,.36)),.025,materials['naval'])
        tube_path('bridge.lifebuoy',[center+Vector((.33*math.cos(j*math.tau/40),0,.33*math.sin(j*math.tau/40))) for j in range(40)],.074,materials['canvas'],closed=True)
        # Low cowl ventilators on the forecastle deck beside the bridge, as measured (0.7 m tall).
        for x,y in [(24.72,3.24),(30.0,3.97)]:
            d=deckz(x);path=[(x,sign*y,d-.02),(x,sign*y,d+.32),(x+.06,sign*y,d+.5),(x+.2,sign*y,d+.56)]
            tube_path('bridge.deck-vent',path,.1,materials['naval'],sides=16)
            rod('bridge.deck-vent-hood',path[-1],(x+.36,sign*y,d+.58),.12,materials['naval'],r2=.17,vertices=20)
            rod('bridge.deck-vent-mouth',(x+.36,sign*y,d+.58),(x+.37,sign*y,d+.58),.15,materials['dark'],vertices=20)
        # The reference's low solid outboard screens below the AA sweep.
        pts=[(x,sign*(width(x)-.19)) for x in [23.2,27.0,31.0,34.0]]
        bulwark('bridge.deck-screen',pts,4.72,.62,closed=False)
        # Signal lamps stand on the upper wing through a visible base and yoke.
        x,y=25.8,sign*2.12
        cyl('bridge.signal-base',(x,y,10.83),.15,.10,materials['naval'],vertices=20)
        rod('bridge.signal-pedestal',(x,y,10.83),(x,y,11.33),.05,materials['naval'])
        rod('bridge.signal-lamp',(x-.16,y,11.43),(x+.16,y,11.43),.13,materials['naval'],vertices=24)
        rod('bridge.signal-lens',(x+.16,y,11.43),(x+.17,y,11.43),.105,materials['glass'],vertices=24)
        for yy in [-.14,.14]:rod('bridge.signal-fork',(x,y,11.24),(x,y+yy,11.43),.025,materials['edge'])
    # Cylindrical Type 94 director head with forward optical housings.
    for sign in [-1,1]:
        box('director.optical-box',(26.43,sign*.42,11.72),(.34,.25,.92),materials['naval'],bev=.045)
        box('director.optical-aperture',(26.606,sign*.42,11.99),(.012,.14,.18),materials['glass'],bev=.006)
        rod('director.optical-grab',(26.61,sign*.42,11.37),(26.61,sign*.42,11.64),.024,materials['edge'])
    cyl('director.lower-bearing',(25.2,0,10.83),1.02,.12,materials['edge'],vertices=48)
    for x in [25.15,25.8]:
        for sign in [-1,1]:
            y=sign*1.09
            for z in [11.1,11.4,11.7,12.0]:tube_path('director.access-step',[(x,y,z),(x, y+sign*.12,z),(x+.18,y+sign*.12,z),(x+.18,y,z)],.017,materials['edge'])
    # Fine signal stays terminate on modeled deck eyelets.
    for sign in [-1,1]:
        for x,y,z in [(29.2,sign*.9,10.81),(24.5,sign*2.6,10.81)]:
            rod('bridge.signal-eye',(x,y,z-.03),(x,y,z+.09),.023,materials['naval'])
            rod('bridge.signal-stay',(x,y,z+.08),(20.16,sign*.15,20),.006,materials['edge'],vertices=5)

"""Original Type 93 quadruple-bank and midships working-deck geometry.
Dimensions and silhouette interpreted from the approved pjsd718 model; no external reads.
Executed in build.py's helper namespace, with canonical placements from the blueprint.
"""

def refined_torpedo_launcher(l):
    name=l['id'];a,z,c=l['position'];x,y=-c,-a
    deck=3.697 if name=='torpedo-forward' else deckz(x)
    cyl(name+'.foundation',(x,y,(deck+z+.18)/2),1.38,z+.18-deck,materials['naval'],vertices=48)
    pivot=empty(name+'.yaw',(x,y,z))
    def put(o):return local(o,pivot,name)
    put(cyl(name+'.roller-race',(0,0,.19),1.42,.23,materials['edge'],vertices=64))
    put(cyl(name+'.turntable',(0,0,.34),1.52,.13,materials['naval'],vertices=64))
    # A long enclosed working shield with a tapered, descending after end.
    # +X is the open discharge end; all moving objects share the retained yaw joint.
    sections=[(-2.78,1.50,.92,1.78),(-1.38,2.05,.48,2.30),(1.96,2.18,.48,2.30),(2.35,1.98,.48,2.26)]
    vs=[]
    for xx,w,bottom,top in sections:
        vs += [(xx,-w,bottom),(xx,w,bottom),(xx,w,1.20),(xx,w-.17,top-.12),(xx,w-.33,top),(xx,-w+.33,top),(xx,-w+.17,top-.12),(xx,-w,1.20)]
    fs=[tuple(reversed(range(8))),tuple(range(24,32))]
    fs += [(k*8+j,k*8+(j+1)%8,(k+1)*8+(j+1)%8,(k+1)*8+j) for k in range(3) for j in range(8)]
    house=put(mesh(name+'.working-shield',vs,fs,materials['naval']))
    bevel=house.modifiers.new('Shield rolled corners','BEVEL');bevel.width=.075;bevel.segments=3
    from mathutils.bvhtree import BVHTree
    skin=BVHTree.FromPolygons([Vector(v) for v in vs],fs)
    def roof_height(xx,yy):
        hit=skin.ray_cast(Vector((xx,yy,5)),Vector((0,0,-1)))[0]
        return hit.z if hit else 2.3
    def side_width(xx,zz):
        hit=skin.ray_cast(Vector((xx,5,zz)),Vector((0,-1,0)))[0]
        return hit.y if hit else 2.0
    # Two suspended side skirts and radial beams seat the shield on its bearing.
    for sign in [-1,1]:
        put(box(name+'.skirt',(.88,sign*1.93,.30),(2.65,.32,.37),materials['naval']))
        for xx in [-1.1,1.1]:put(rod(name+'.floor-beam',(xx,0,.40),(xx,sign*1.98,.52),.085,materials['edge']))
    # Four tubes: curved discharge trough, reinforced rings, capped breech and air gear.
    for tube in [t for t in definition['torpedoTubes'] if t['launcherId']==name]:
        ta,tb,tc=tube['position'];end=-tc-x;yy=-ta-y;zz=tb-z
        # Open bore through the shield, with a complete tube wall and capped breech behind it.
        cutter=put(rod(name+'.bore-cutter',(-3.7,yy,zz),(2.6,yy,zz),.310,materials['dark'],vertices=32))
        cut=house.modifiers.new('Tube passage','BOOLEAN');cut.operation='DIFFERENCE';cut.object=cutter
        bpy.context.view_layer.objects.active=house
        bpy.ops.object.modifier_move_up(modifier=cut.name)
        bpy.ops.object.modifier_apply(modifier=cut.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
        wall=[];N=32
        for xx in [-3.47,2.39]:
            for radius in [.335,.305]:
                wall += [(xx,yy+radius*math.cos(j*math.tau/N),zz+radius*math.sin(j*math.tau/N)) for j in range(N)]
        faces=[]
        for j in range(N):
            k=(j+1)%N
            faces += [(j,k,2*N+k,2*N+j),(N+j,3*N+j,3*N+k,N+k)]
            for off in [0,2*N]:faces.append((off+j,off+N+j,off+N+k,off+k))
        put(mesh(name+'.tube-body',wall,faces,materials['naval'],smooth=True))
        # Open lower discharge cutaway visible in the primary model, with real wall thickness.
        points=[];N=32
        for xx in [2.34,end]:
            for radius in [.335,.305]:
                for j in range(N+1):
                    t=math.pi*j/N;points.append((xx,yy+radius*math.cos(t),zz+radius*math.sin(t)))
        stride=2*(N+1);faces=[]
        for j in range(N):
            faces += [(j,j+1,stride+j+1,stride+j),(N+1+j,stride+N+1+j,stride+N+2+j,N+2+j)]
            for off in [0,stride]:faces.append((off+j,off+N+1+j,off+N+2+j,off+j+1))
        for j in [0,N]:faces.append((j,stride+j,stride+N+1+j,N+1+j))
        put(mesh(name+'.discharge-trough',points,faces,materials['naval'],smooth=True))
        for xx in [2.42,3.08,3.65,4.23,4.82,end-.04]:
            put(tube_path(name+'.tube-hoop',[(xx,yy+.35*math.cos(j*math.pi/N),zz+.35*math.sin(j*math.pi/N)) for j in range(N+1)],.018,materials['edge']))
            put(box(name+'.tube-hoop-lug',(xx,yy,zz+.363),(.045,.095,.045),materials['naval'],bev=.005))
        for sign in [-1,1]:put(rod(name+'.discharge-edge',(2.34,yy+sign*.325,zz),(end,yy+sign*.325,zz),.023,materials['edge']))
        put(rod(name+'.breech-collar',(-3.52,yy,zz),(-3.34,yy,zz),.374,materials['edge'],vertices=32))
        put(rod(name+'.breech-door',(-3.60,yy,zz),(-3.52,yy,zz),.338,materials['naval'],vertices=32))
        for j in range(8):
            t=j*math.tau/8;py=yy+.337*math.cos(t);pz=zz+.337*math.sin(t)
            put(box(name+'.breech-dog',(-3.62,py,pz),(.06,.075,.055),materials['edge'],bev=.008))
        put(rod(name+'.hinge-pin',(-3.50,yy+.35,zz-.18),(-3.50,yy+.35,zz+.18),.032,materials['edge']))
        put(tube_path(name+'.breech-handle',[(-3.635,yy-.12,zz-.02),(-3.68,yy-.12,zz-.02),(-3.68,yy+.12,zz-.02),(-3.635,yy+.12,zz-.02)],.018,materials['edge']))
        put(rod(name+'.air-cylinder',(-3.12,yy+.24,zz-.26),(-1.1,yy+.24,zz-.26),.08,materials['naval'],vertices=16))
        put(tube_path(name+'.air-pipe',[(-3.12,yy+.24,zz-.26),(-3.25,yy+.28,zz),(-3.18,yy+.28,zz+.32),(-2.81,yy+.13,zz+.55)],.039,materials['edge'],sides=12))
        put(rod(name+'.firing-cylinder',(-3.03,yy+.11,zz+.53),(-2.55,yy+.11,zz+.53),.10,materials['naval'],vertices=16))
        put(rod(name+'.valve-stem',(-3.26,yy,zz+.26),(-3.26,yy,zz+.46),.025,materials['edge']))
        put(tube_path(name+'.valve-wheel',[(-3.26+.095*math.cos(j*math.tau/20),yy+.095*math.sin(j*math.tau/20),zz+.46) for j in range(20)],.012,materials['edge'],closed=True))
        for t in [0,math.tau/3,2*math.tau/3]:put(rod(name+'.valve-spoke',(-3.26,yy,zz+.46),(-3.26+.095*math.cos(t),yy+.095*math.sin(t),zz+.46),.009,materials['edge']))
        socket=empty(tube['id']+'.muzzle',(end,yy,zz));local(socket,pivot,name)
    # Hooded forward observation slit, access doors, climbing steps and perimeter grabs.
    put(box(name+'.sighting-hood',(2.36,0,1.82),(.18,.94,.64),materials['naval']))
    put(box(name+'.sighting-slit',(2.46,0,1.96),(.012,.68,.11),materials['glass'],bev=.004))
    for sign in [-1,1]:
        for xx in [.9,-.30,-1.12]:put(cyl(name+'.roof-plate',(xx,sign*1.23,2.315),.17,.035,materials['naval'],vertices=24))
        # Section interpolation keeps fitted plates and rails physically seated.
        def width_at(xx):
            for a,b in zip(sections,sections[1:]):
                if a[0]<=xx<=b[0]:return a[1]+(b[1]-a[1])*(xx-a[0])/(b[0]-a[0])
            return sections[-1][1]
        doorx=.12;w=width_at(doorx)
        # Upper door follows the shoulder slope rather than floating outside the plate.
        outline=[(-.30,.65),(.30,.65),(.30,1.20),(.30,1.55),(.20,1.66),(-.20,1.66),(-.30,1.55),(-.30,1.20)]
        dvs=[(doorx+xx,sign*(side_width(doorx+xx,zz)+.022),zz) for xx,zz in outline]
        door=put(mesh(name+'.access-door',dvs,[(0,1,2,7),(7,2,3,4,5,6)],materials['edge']));sol=door.modifiers.new('Door plating','SOLIDIFY');sol.thickness=.018
        for zz in [.81,1.43]:put(rod(name+'.door-dog',(doorx-.23,sign*(side_width(doorx-.23,zz)+.04),zz),(doorx-.10,sign*(side_width(doorx-.10,zz)+.04),zz),.019,materials['naval']))
        for xx in [1.62,-1.10]:
            pts=[(xx+dx,sign*(side_width(xx+dx,zz)+.015),zz) for dx,zz in [(-.225,1.31),(.225,1.31),(.225,1.79),(-.225,1.79)]]
            put(mesh(name+'.side-access-panel',pts,[(0,1,2,3)],materials['naval']))
        for zz in [.60,.89,1.18,1.47,1.76]:
            xx=-.43;w=width_at(xx)-max(0,zz-1.2)*.17/.98
            put(tube_path(name+'.side-step',[(xx-.17,sign*w,zz),(xx-.17,sign*(w+.10),zz),(xx+.17,sign*(w+.10),zz),(xx+.17,sign*w,zz)],.018,materials['edge']))
        edge=[(2.28,sign*1.88,2.30),(1.94,sign*1.98,2.34),(-1.37,sign*1.86,2.34),(-2.70,sign*1.31,1.84)]
        edge=[(a,b,roof_height(a,b)) for a,b,c in edge]
        put(tube_path(name+'.roof-rail',[(a,b,c+.18) for a,b,c in edge],.017,materials['edge']))
        for a,b,c in edge:put(rod(name+'.rail-foot',(a,b,c-.016),(a,b,c+.18),.016,materials['naval']))
        put(tube_path(name+'.lower-handrail',[(2.34,sign*1.99,1.02),(1.96,sign*2.22,1.02),(-1.37,sign*2.09,1.02),(-2.7,sign*1.56,1.02)],.018,materials['edge']))
        for xx in [1.7,.9,-.7,-1.5,-2.4]:
            w=width_at(xx);put(rod(name+'.handrail-bracket',(xx,sign*(w-.025),1.02),(xx,sign*(w+.055),1.02),.018,materials['naval']))
    for yy in [-.95,0,.95]:
        put(tube_path(name+'.roof-grab',[(-.9,yy,2.30),(-.9,yy,2.47),(1.55,yy,2.47),(1.55,yy,2.30)],.016,materials['edge']))

def refined_midships_platforms():
    # Both deck footprints are canonical blueprint structures; no duplicate shell data.
    for ident in ['torpedo-working-deck','midships-aa-deck']:
        s=next(q for q in definition['structures'] if q['id']==ident)
        outline=[(-z,-x) for x,z in s['footprint']]
        prism(ident+'.platform',outline,s['baseY'],s['baseY']+s['height'])
        tube_path(ident+'.edge',[(x,y,s['baseY']+s['height']+.01) for x,y in outline],.035,materials['edge'],closed=True)
    for sign in [-1,1]:
        rod('midships-aa-deck.column',(.5,sign*2.8,deckz(.5)),(.5,sign*2.8,6.17),.24,materials['naval'],vertices=24)
        for x,y in [(1.7,sign*3.1),(-.7,sign*3.8),(.5,sign*1.5)]:rod('midships-aa-deck.knee',(.5,sign*2.8,5.18),(x,y,6.12),.09,materials['edge'])
        # Low plated round gun tubs connect directly to the aft uptake platform.
        rim=[(.5+1.60*math.cos(t),sign*(2.8+1.45*math.sin(t))) for t in [i*math.pi/16 for i in range(17)]]
        bulwark('midships-aa-deck.tub',rim,6.25,.32,closed=False)
        ladder('midships-aa-deck.ladder',(-1.25,sign*2.25,3.697),(-1.25,sign*2.25,6.25),.44)
        for xx in [2,5.8,9]:box('torpedo-working-deck.side-stiffener',(xx,sign*2.50,3.24),(.08,.09,.85),materials['naval'],bev=.01)

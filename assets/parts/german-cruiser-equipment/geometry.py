"""Reusable original Hipper fittings, adapted from original Hipper build.py.

No published or reference model is an input. Datums are explicit in construction.json.
Engineering package internals and ratings are provisional gameplay estimates.
"""
import sys, math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model

def create_funnel_cap(part,col,helpers,materials):
    m=Model(col,helpers,materials);n=48;verts=[]
    # Original jacket-top datum; lower uptake and gallery remain editable ship structure.
    for cx,rx,ry,z,slope in [(0,5.3,2.26,0,0),(-1,4,1.67,3.02,.425),(-1,3.85,1.52,3.02,.425),(0,5.12,2.08,0,0)]:
        for i in range(n):
            a=i*math.tau/n;x=cx+rx*math.cos(a);verts.append((x,ry*math.sin(a),z+slope*(x-cx)))
    m.mesh('open-cap',verts,[(j*n+i,j*n+(i+1)%n,((j+1)%4)*n+(i+1)%n,((j+1)%4)*n+i) for j in range(4) for i in range(n)],mat='roof',smooth=True)
    for x in [-3.4,-2.2,-1,.2,1.4]:
        y=1.52*math.sqrt(1-((x+1)/3.85)**2);m.rod('rain-grating',(x,-y,3.02+.425*(x+1)),(x,y,3.02+.425*(x+1)),.042,mat='edge')
    for y in [-.55,.55]:m.rod('grate-rail',(-4.65,y,1.47),(2.65,y,4.57),.035,mat='edge')
    return m.root

def create_screw(part,col,helpers,materials):
    m=Model(col,helpers,materials);spin=m.empty('spin',(0,0,0),m.root)
    hand=1 if part['id'].endswith('port') else -1
    m.rod('shaft-seat',(.3,0,0),(1.6,0,0),.17,mat='edge')
    m.rod('boss',(.3,0,0),(-.85,0,0),.36,r2=.15,mat='bronze',vertices=24,parent=spin)
    for i in range(3):
        a=i*math.tau/3;v=[(dx,r*math.cos(a+hand*t),r*math.sin(a+hand*t)) for r,t,dx in [(.25,0,0),(.9,.1,.03),(1.65,.3,-.12),(1.70,.68,-.28),(1,.91,-.4),(.3,.7,-.2)]]
        o=m.mesh('blade',v,[tuple(range(6))],mat='bronze',parent=spin);o.modifiers.new('Blade thickness','SOLIDIFY').thickness=.055
    return m.root

def create_rudder(part,col,helpers,materials):
    m=Model(col,helpers,materials);yaw=m.empty('yaw',(0,0,0),m.root)
    m.rod('stock',(0,0,0),(0,0,-3.2),.18,mat='edge',parent=yaw)
    outline=[(1.2,-1.5),(-4.25,-1.5),(-4.5,-1.75),(-4.5,-4.68),(-4.2,-5),( .9,-5),(1.2,-4.72)]
    v=[(x,y,z) for y in [-.22,.22] for x,z in outline];n=len(outline)
    m.mesh('foil',v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat='underwater',parent=yaw)
    return m.root

def create_steam_package(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Explicit generic turbine/boiler package, with service clearance inside its 12x4x20m envelope.
    m.box('bed',(0,0,.16),(20,12,.32),mat='edge')
    for x in [-6,-1,4]:
        for y in [-3.2,3.2]:
            m.rod('boiler-shell',(x-1.8,y,1.7),(x+1.8,y,1.7),1.35,mat='roof',vertices=32)
            m.rod('steam-main',(x,y,2.9),(x,y,3.6),.22,mat='edge')
    m.rod('turbine-case',(6.5,0,1.4),(9.2,0,1.4),1.05,vertices=40)
    m.rod('steam-header',(-7,-3.2,3.6),(7,-3.2,3.6),.22,mat='edge')
    m.rod('steam-crossover',(7,-3.2,3.6),(7,0,1.8),.22,mat='edge')
    return m.root

def create_triple_launcher(part,col,helpers,materials):
    m=Model(col,helpers,materials);m.cyl('fixed-seat',(0,0,.04),.97,.08,mat='edge')
    yaw=m.empty('yaw',(0,0,0),m.root)
    m.cyl('training-race',(0,0,.1),.97,.12,mat='edge',parent=yaw)
    m.box('triple-bed',(-.35,0,.15),(4.9,2.4,.16),parent=yaw)
    for i,offset in enumerate(part['tubeOffsets']):
        x,y,z=-offset[2],-offset[0],offset[1]
        m.rod('tube-shell',(-3.35,y,z),(2.20,y,z),.31,vertices=24,parent=yaw)
        n=17;rings=[(2.20,1),(3.50,1),(4.40,.45),(x,.05)]
        v=[(tx,y+r*math.cos(math.pi+j*math.pi/(n-1)),z+r*f*math.sin(math.pi+j*math.pi/(n-1))) for r in [.31,.286] for tx,f in rings for j in range(n)];faces=[];k=len(rings)*n
        for j in range(3):
            for q in range(n-1):
                a=j*n+q;faces.extend([(a,a+1,a+1+n,a+n),(k+a+n,k+a+1+n,k+a+1,k+a)])
            for q in [0,n-1]:
                a=j*n+q;faces.append((a,a+n,k+a+n,k+a))
        for j in [0,3]:
            for q in range(n-1):
                a=j*n+q;faces.append((a,a+1,k+a+1,k+a))
        m.mesh('open-trough',v,faces,smooth=True,parent=yaw)
        m.rod('breech',(-3.48,y,z),(-3.32,y,z),.33,mat='edge',parent=yaw,vertices=24)
        for tx in [-2.6,-1,.8,2]:
            m.rod('band',(tx-.04,y,z),(tx+.04,y,z),.335,mat='edge',parent=yaw,vertices=24)
            m.box('saddle',(tx,y,.27),(.19,.64,.22),parent=yaw)
        m.rod('impulse-pipe',(-2.7,y,z+.37),(.7,y,z+.37),.055,mat='edge',parent=yaw)
        for tx in [-2.8,-1.6,-.4]:
            m.box('firing-valve',(tx,y,z+.43),(.22,.19,.17),mat='edge',parent=yaw)
            m.rod('linkage',(tx,y,z+.49),(tx,y+.22,z+.49),.019,mat='edge',parent=yaw)
        for dz in [-.16,.16]:
            m.box('hinge',(-3.45,y+.28,z+dz),(.18,.10,.11),mat='edge',parent=yaw)
        m.empty('tube-'+str(i+1)+'.muzzle',(x,y,z),yaw)
    for side in [-1,1]:
        m.rod('air-flask',(-3.1,side*1.22,.29),(-.6,side*1.22,.29),.16,r2=.12,mat='edge',parent=yaw)
        for tx in [-2.65,-1]:m.box('flask-saddle',(tx,side*1.22,.19),(.18,.37,.27),parent=yaw)
        m.rod('manifold',(-.6,side*1.22,.29),(-.4,side*.72,.79),.045,mat='edge',parent=yaw)
        m.box('shelter',(1.78,side*1.45,1.08),(1.45,.055,.96),parent=yaw)
        m.mesh('shelter-rim',[(1.03,side*1.45,1.56),(2.51,side*1.45,1.56),(2.72,side*1.57,1.70),(.94,side*1.57,1.70)],[(0,1,2,3)],parent=yaw)
        m.rod('shelter-brace',(1.2,side*.95,.24),(1.2,side*1.45,.75),.055,parent=yaw)
    m.box('front',(2.5,0,1.14),(.06,2.9,.9),parent=yaw)
    m.box('floor',(1.7,0,.84),(1.6,2.9,.075),mat='roof',parent=yaw)
    m.box('console',(1.89,0,1.05),(.47,1.2,.36),mat='edge',parent=yaw)
    for y in [-.4,0,.4]:m.rod('dial',(1.63,y,1.11),(1.60,y,1.11),.09,mat='dark',parent=yaw)
    m.rod('sight-stalk',(2.1,0,1.22),(2.1,0,1.78),.04,mat='edge',parent=yaw)
    m.rod('sight',(1.9,0,1.8),(2.38,0,1.8),.052,mat='edge',parent=yaw)
    return m.root

def create_sl_eight(part,col,helpers,materials):
    m=Model(col,helpers,materials);m.cyl('collar',(0,0,.15),1.75,.30,mat='edge');v=[];n=32
    for j in range(13):
        a=-.60+(math.pi*.5+.60)*j/12;r=1.95*math.cos(a)
        for i in range(n):
            b=i*math.tau/n;v.append((r*math.cos(b),r*math.sin(b),1.36+1.95*math.sin(a)))
    m.mesh('stabilized-cover',v,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(12) for i in range(n)],smooth=True)
    m.rod('optical-cross-tube',(0,-2.2,1.75),(0,2.2,1.75),.20,vertices=20)
    for side in [-1,1]:m.rod('optic',(.18,side*1.75,1.75),(.38,side*1.75,1.75),.18,mat='dark',vertices=20)
    return m.root

def create_catapult(part,col,helpers,materials):
    m=Model(col,helpers,materials);m.cyl('bearing',(0,0,.20),1.18,.40,mat='edge')
    for y in [-.43,.43]:
        m.rod('upper-rail',(-5.2,y,1.08),(7.4,y,1.08),.065,mat='edge')
        m.rod('lower-chord',(-5.2,y,.40),(7.4,y,.40),.06)
        for i in range(13):
            x=-5.2+i*.97;m.rod('lattice',(x,y,.4),(x+.97,y,1.08),.035)
    for x in [-4,-2,0,2,4,6]:m.rod('cross-tie',(x,-.45,.75),(x,.45,.75),.035)
    m.box('shuttle',(2,0,1.19),(1.9,1.25,.18),mat='edge')
    for y in [-.52,.52]:m.rod('cradle',(1.3,y,1.27),(2.6,y,1.27),.052)
    return m.root

def create_launch(part,col,helpers,materials):
    import bpy
    sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts/ships'))
    from blender_fidelity import Fittings
    m=Model(col,helpers,materials)
    length,beam,cabin={'german-cutter-750':(7.5,1.82,False),'german-traffic-boat-1170':(11.7,2.65,True),'german-motor-launch-900':(9,2.35,True),'german-open-launch-1000':(10,2.4,False)}[part['id']]
    before=set(col.objects)
    # The original cradle's bottom is 0.16 m below its hull datum.
    Fittings(helpers,materials,col).boat('component.launch',0,0,.16,length,beam,cabin)
    for obj in set(col.objects)-before:
        obj['assemblyId']='component';m.attach(obj,m.root)
    # Central transverse seating beam physically joins the two cradles.
    m.box('cradle-keel',(0,0,.08),(length*.55,.16,.16),mat='edge')
    return m.root

def create_guarded_optic(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.rod('optical-tube',(0,0,0),(1.375,0,0),.29,vertices=24)
    for x in [.04,.7,1.375]:
        for y in [-.38,.38]:m.rod('guard-post',(x,y,-.38),(x,y,.34),.019)
        for z in [-.38,.34]:m.rod('guard-tie',(x,-.38,z),(x,.38,z),.019)
    for y in [-.38,.38]:m.rod('guard-rail',(.04,y,.34),(1.375,y,.34),.019)
    return m.root

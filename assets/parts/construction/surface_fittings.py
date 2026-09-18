"""Original shallow door/vent hardware and rail-free U-rung ladder sample.

Blender X=0 is the supporting wall; positive X is outward. The flat panel and
relief hardware are separately marked so installation preserves their depth.
"""
import math
from geometry import Model
from windows import outline


def create_surface_fitting(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    w, h, depth = part['size']
    center = part['boundsCenter'][1]
    door = part['wallMount'] == 'door'
    round_vent = part['id'] == 'generic-round-wall-vent'
    watertight = part['id'] == 'generic-watertight-door'
    radius = w/2 if round_vent else min(w,h)*(.1 if watertight else .025)
    def panel(name, width, height, radius, z, x=0, mat='roof'):
        return m.mesh(name, [(x,y,t+z) for y,t in outline(width,height,radius)], [tuple(range(len(outline(width,height,radius))))],mat=mat)
    panel('flush-panel',w,h,radius,center,mat='roof' if door else 'dark')
    def box(name,loc,size,mat='naval'):
        return m.box('relief-'+name,loc,size,mat=mat)
    def rod(name,a,b,r,mat='naval'):
        return m.rod('relief-'+name,a,b,r,mat=mat,vertices=10)
    if door:
        # A narrow reveal, restrained hinges, handle escutcheon and lower wear plate.
        m.path('relief-reveal',[(.004,y,z+center) for y,z in outline(w-.035,h-.035,max(.008,radius-.018))],.007,closed=True,mat='dark',vertices=6)
        for z in [h*.24,h*.76]:
            box('hinge-leaf',(.014,-w*.39,z),(.028,.105,.10))
            rod('hinge-pin',(.028,-w*.42,z-.075),(.028,-w*.42,z+.075),.017,mat='painted-edge')
        if watertight:
            z=h*.49;r=w*.19;x=depth-.016
            rod('wheel-spindle',(.005,0,z),(x,0,z),.028)
            m.path('relief-wheel',[(x,r*math.cos(i*math.tau/24),z+r*math.sin(i*math.tau/24)) for i in range(24)],.014,closed=True,mat='painted-edge',vertices=8)
            for i in range(4):
                a=i*math.tau/4;rod('wheel-spoke',(x,0,z),(x,r*math.cos(a),z+r*math.sin(a)),.01,mat='painted-edge')
            for side in [-1,1]:
                for z in [h*.18,h*.5,h*.82]:box('dog-latch',(.021,side*w*.40,z),(.042,.085,.04),mat='painted-edge')
        else:
            y=w*.31;z=h*.49
            box('handle-plate',(.009,y,z),(.018,.055,.16),mat='painted-edge')
            rod('handle-neck',(.014,y,z),(.045,y,z),.012,mat='painted-edge')
            rod('lever',(.045,y,z),(.045,y-.115,z),.012,mat='painted-edge')
            box('kick-plate',(.003,0,h*.12),(.006,w*.78,h*.13),mat='painted-edge')
        if part['id']=='generic-windowed-door':
            panel('relief-vision-seal',w*.49,h*.23,.035,h*.74,.005,'dark')
            panel('relief-vision-glass',w*.43,h*.20,.025,h*.74,.008,'glass')
    else:
        # Real shallow louvers over a dark backing, with no through-hull opening.
        if round_vent:
            r=w*.46
            m.path('relief-grille-ring',[(.016,r*math.cos(i*math.tau/40),r*math.sin(i*math.tau/40)) for i in range(40)],.018,closed=True,vertices=8)
            for i in range(-3,4):
                z=i*h*.11;half=math.sqrt(max(0,r*r-z*z))
                box('grille-bar',(.027,0,z),(.035,half*2,.017),mat='painted-edge')
        else:
            for side in [-1,1]:box('side-return',(.022,side*(w/2-.016),0),(.044,.032,h))
            count=max(3,round(h/.085))
            for i in range(count):
                z=-h/2+.045+i*(h-.09)/(count-1)
                m.mesh('relief-louver',[(.004,-w/2+.03,z+.025),(.004,w/2-.03,z+.025),(.055,w/2-.03,z-.019),(.055,-w/2+.03,z-.019)],[(0,1,2,3)],mat='naval')
    relief=m.empty('surface-relief',(0,0,0),m.root);relief['wallRelief']=True
    for o in list(m.root.children_recursive):
        if '.relief-' in o.name:
            o['wallRelief']=True
            m.attach(o,relief)
    return m.root


def create_ladder(part,col,helpers,materials):
    m=Model(col,helpers,materials);p=part['path'];half=p['widthM']/2;stand=p['standOffM'];radius=p['diameterM']/2
    count=math.ceil(3/p['postSpacingM'])
    for i in range(count+1):
        z=3*i/count
        # Each squared U has two independent wall sockets and a clear foothold.
        m.path('rung',[(0,-half,z),(stand,-half,z),(stand,half,z),(0,half,z)],radius,vertices=10)
    return m.root

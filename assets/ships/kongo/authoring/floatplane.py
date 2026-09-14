"""Original static twin-float reconnaissance aircraft from the approved ship view.

This is the aircraft shown aboard the reference, not a flight-simulation asset.
No source meshes or textures are read. Coordinates are local +X nose, +Y port;
Z uses the ship's authoring datum so the carriage attachment is explicit.
"""
import bpy, math

def create(helpers, ship_materials, origin_x=-50.36):
    mesh, rod, box = (helpers[k] for k in ('mesh', 'rod', 'box'))
    def material(name, rgb, alpha=1):
        m=bpy.data.materials.new('Kongo floatplane '+name);m.use_nodes=True
        color=tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb)+(alpha,)
        m.diffuse_color=color;bs=m.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=.63
        bs.inputs['Alpha'].default_value=alpha
        if alpha<1:m.surface_render_method='DITHERED'
        return m
    green=material('green',(.07,.25,.19));silver=material('underside',(.50,.52,.48))
    red=material('roundel',(.48,.09,.065));white=material('roundel border',(.79,.79,.71))
    glass=material('glazing',(.30,.40,.40),.22)
    dark=ship_materials['dark'];edge=ship_materials['edge']
    def p(v):return (v[0]+origin_x,v[1],v[2])
    def m(name,vs,fs,mat,smooth=False):return mesh('floatplane.'+name,[p(v) for v in vs],fs,mat,smooth=smooth)
    def r(name,a,b,radius,mat=green,**kwargs):return rod('floatplane.'+name,p(a),p(b),radius,mat,**kwargs)
    def b(name,where,size,mat=green):return box('floatplane.'+name,p(where),size,mat)
    # Editable sparse station lofts; a keel-shaped section distinguishes the floats.
    def loft(name,stations,mat,center_y=0,section=24,float_section=False):
        vs=[]
        for x,width,bottom,top in stations:
            for i in range(section):
                a=math.tau*i/section;y=width*math.cos(a)
                z=(top+bottom)/2+(top-bottom)/2*math.sin(a)
                if float_section and math.sin(a)<0:
                    z=bottom+(top-bottom)*.43*abs(math.cos(a))
                vs.append((x,center_y+y,z))
        fs=[tuple(reversed(range(section)))]
        fs += [(j*section+i,j*section+(i+1)%section,(j+1)*section+(i+1)%section,(j+1)*section+i)
               for j in range(len(stations)-1) for i in range(section)]
        fs.append(tuple(range((len(stations)-1)*section,len(stations)*section)))
        o=m(name,vs,[tuple(reversed(f)) for f in fs],mat,True)
        if float_section:
            o.data.materials.append(dark)
            for face in o.data.polygons:
                if face.center.z<8.5:face.material_index=1
        else:
            o.data.materials.append(silver)
            for face in o.data.polygons:
                if face.center.z<10.55:face.material_index=1
        return o
    fuselage_stations=[(3.8,.60,10.22,11.58),(3.0,.65,10.17,11.62),(2.1,.63,10.17,11.62),
         (.8,.54,10.20,11.60),(-.6,.47,10.30,11.59),(-2.0,.38,10.50,11.56),
         (-3.5,.25,10.83,11.55),(-4.8,.13,11.12,11.52),(-5.55,.025,11.35,11.43)]
    loft('fuselage',fuselage_stations,green)
    def station_at(stations,x):
        for a,c in zip(stations,stations[1:]):
            if c[0]<=x<=a[0]:
                t=(x-a[0])/(c[0]-a[0])
                return tuple(a[k]+t*(c[k]-a[k]) for k in range(1,4))
        raise ValueError('Aircraft surface sample outside station loft')
    # Curved painted discs follow the authored fuselage instead of floating flat
    # beside it. Concentric rings retain the curvature across the whole marking.
    for sign in [-1,1]:
        for radius,mat,offset in [(.46,white,.006),(.385,red,.009)]:
            vs=[];segments=48;rings=8
            for j in range(rings+1):
                rad=radius*max(j/rings,.0001)
                for i in range(segments):
                    a=math.tau*i/segments;x=-2.45+rad*math.cos(a);z=11.09+rad*math.sin(a)
                    width,bottom,top=station_at(fuselage_stations,x)
                    q=(z-(bottom+top)/2)/((top-bottom)/2)
                    y=sign*(width*math.sqrt(max(0,1-q*q))+offset)
                    vs.append((x,y,z))
            fs=[(j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i)
                for j in range(rings) for i in range(segments)]
            m('fuselage-roundel',vs,[tuple(reversed(f)) for f in fs] if sign<0 else fs,mat)
    # Cowling is open at the nose around a modeled radial engine.
    n=40;vs=[]
    for x,rad in [(3.65,.66),(4.42,.66),(4.51,.56),(4.51,.48),(4.35,.48)]:
        vs.extend((x,rad*math.cos(i*math.tau/n),10.91+rad*math.sin(i*math.tau/n)) for i in range(n))
    m('cowling',vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(4) for i in range(n)],dark,True)
    r('engine-crankcase',(4.24,0,10.91),(4.49,0,10.91),.23,edge,vertices=20)
    for i in range(14):
        a=i*math.tau/14
        r('engine-cylinder',(4.35,.2*math.cos(a),10.91+.2*math.sin(a)),(4.35,.48*math.cos(a),10.91+.48*math.sin(a)),.075,edge,vertices=8)
    propeller_objects=set(bpy.context.scene.objects)
    r('propeller-shaft',(4.35,0,10.91),(4.78,0,10.91),.12,edge,vertices=16)
    r('spinner',(4.63,0,10.91),(4.97,0,10.91),.24,silver,r2=.035,vertices=24)
    for i in range(3):
        a=math.tau*i/3;vs=[]
        for dx in [-.025,.025]:
            for j in range(18):
                t=math.tau*j/18;radius=.88+.64*math.cos(t);side=.115*math.sin(t)
                vs.append((4.61+dx+side*.35,radius*math.sin(a)+side*math.cos(a),10.91+radius*math.cos(a)-side*math.sin(a)))
        m('propeller-blade',vs,[tuple(reversed(range(18))),tuple(range(18,36))]+[(j,(j+1)%18,(j+1)%18+18,j+18) for j in range(18)],dark,True)
    helpers['joint']('floatplane.propeller.spin',p((4.61,0,10.91)),set(bpy.context.scene.objects)-propeller_objects)
    # Cambered wings with rounded tips and mild dihedral.
    stations=[(0,2.65,-.42,.19,10.53),(1.2,2.65,-.42,.18,10.53),(3.8,2.65,-.04,.14,10.62),
              (5.8,2.60,.62,.10,10.76),(6.6,2.35,1.12,.065,10.86),(7.08,2.05,1.55,.035,10.91),(7.229,1.83,1.82,.003,10.93)]
    def wing_values(y):
        y=abs(y)
        for a,c in zip(stations,stations[1:]):
            if a[0]<=y<=c[0]:
                f=(y-a[0])/(c[0]-a[0]);return [a[k]+(c[k]-a[k])*f for k in range(1,5)]
        return stations[-1][1:]
    def wing_top(x,y):
        lead,trail,thick,z=wing_values(y);u=max(0,min(1,(lead-x)/(lead-trail)))
        return z+thick*2*math.sqrt(u*(1-u))*(1-.45*u)+.03*math.sin(math.pi*u)
    for sign in [-1,1]:
        vs=[];n=24
        for y,lead,trail,thick,z in stations:
            for i in range(n):
                a=math.tau*i/n;u=(1-math.cos(a))/2
                vs.append((lead+(trail-lead)*u,sign*y,z+thick*math.sin(a)*(1-.45*u)+.03*math.sin(math.pi*u)))
        fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(stations)-1) for i in range(n)]
        fs += [tuple(reversed(range(n))),tuple(range((len(stations)-1)*n,len(stations)*n))]
        o=m('wing',vs,[tuple(reversed(f)) for f in fs] if sign>0 else fs,green,True);o.data.materials.append(silver)
        for face in o.data.polygons:
            if face.normal.z<-.1:face.material_index=1
        for radius,mat,offset in [(.75,white,.004),(.64,red,.008)]:
            vs=[(1.55,sign*5.03,wing_top(1.55,sign*5.03)+offset)]
            for i in range(49):
                a=math.tau*i/48;x=1.55+radius*math.cos(a);y=sign*5.03+radius*math.sin(a)
                vs.append((x,y,wing_top(x,y)+offset))
            m('wing-roundel',vs,[(0,i,i+1) for i in range(1,49)],mat)
        # Float bows, planing step and narrowing tails have independent control stations.
        loft('float',[(5.83,.015,8.56,8.66),(5.3,.32,8.19,8.96),(4.5,.54,8.01,9.11),
             (2.5,.58,7.98,9.17),(1.1,.56,7.98,9.15),(1.08,.56,8.19,9.15),
             (-.6,.38,8.51,9.10),(-2.3,.14,8.76,9.0),(-2.95,.035,8.82,8.93)],green,sign*1.75,float_section=True)
        for x,lower_x in [(2.4,3.15),(.65,.55)]:
            r('float-main-strut',(x,sign*1.73,10.44),(lower_x,sign*1.75,9.12),.075,green,vertices=10)
            r('float-inboard-brace',(x,sign*.46,10.39),(lower_x,sign*1.75,9.12),.045,green,vertices=8)
        for a,c in [((2.4,10.4),(.55,9.14)),((.65,10.4),(3.15,9.14))]:
            r('float-bracing-wire',(a[0],sign*1.75,a[1]),(c[0],sign*1.75,c[1]),.008,edge,vertices=5)
    # Tailplane and fin use original rounded outlines, with visible control seams.
    outline=[(-3.45,0),(-3.70,.8),(-4.10,1.75),(-4.55,2.15),(-5.0,2.2),(-5.32,1.7),(-5.43,.6),(-5.43,0)]
    for sign in [-1,1]:
        vs=[(x,sign*y,11.42+dz) for dz in [-.055,.055] for x,y in outline];n=len(outline)
        fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        m('tailplane',vs,[tuple(reversed(f)) for f in fs] if sign<0 else fs,green,True)
    # Round the upper outline while retaining the root and the source's straight
    # trailing edge. The outline remains a small independently authored polygon.
    fin=[(-3.65,11.45),(-4.10,12.43),(-4.47,12.87),(-4.8,12.96),(-5.12,12.82),(-5.3,12.46),(-5.38,11.45)]
    for _ in range(2):
        curved=[fin[0]]
        for i in range(1,len(fin)-1):
            before,point,after=fin[i-1:i+2]
            curved.extend([tuple(.18*a+.82*b for a,b in zip(before,point)),
                           tuple(.82*a+.18*b for a,b in zip(point,after))])
        fin=curved+[fin[-1]]
    vs=[(x,y,z) for y in [-.055,.055] for x,z in fin];n=len(fin)
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    m('fin',vs,[tuple(reversed(f)) for f in fs],green,True)
    for sign in [-1,1]:
        r('rudder-seam',(-4.98,sign*.057,11.48),(-4.98,sign*.057,12.83),.009,dark,vertices=5)
    # Glazed three-place cockpit; the dark well and seats remain visible beneath glazing.
    b('cockpit-well',(.55,0,11.64),(3.6,.72,.035),dark)
    for x in [1.55,.35,-.8]:
        b('seat',(x,0,11.66),(.34,.42,.12),edge);b('seat-back',(x-.14,0,11.84),(.09,.42,.37),edge)
    sections=[(2.35,.32,11.63),(1.88,.32,12.03),(1.25,.34,12.04),(.52,.34,12.04),(-.25,.33,12.04),(-1.25,.30,12.03)]
    for x,w,z in sections:
        r('canopy-frame',(x,-w,11.61),(x,-w,z),.016,green,vertices=6)
        r('canopy-frame',(x,w,11.61),(x,w,z),.016,green,vertices=6)
        r('canopy-bow',(x,-w,z),(x,w,z),.016,green,vertices=6)
    for a,c in zip(sections,sections[1:]):
        x,w,z=a;xx,ww,zz=c
        for sign in [-1,1]:
            m('canopy-pane',[(x,sign*w,11.61),(xx,sign*ww,11.61),(xx,sign*ww,zz),(x,sign*w,z)],[(0,1,2,3)],glass)
            r('canopy-longeron',(x,sign*w,z),(xx,sign*ww,zz),.015,green,vertices=6)
        m('canopy-roof',[(x,-w,z),(xx,-ww,zz),(xx,ww,zz),(x,w,z)],[(0,1,2,3)],glass)
    r('aerial',(-.28,0,12.03),(-.28,0,12.65),.014,green,vertices=6)
    # Carriage trestle supports the belly; floats hang clear on either side.
    for x in [-.75,.75]:
        for sign in [-1,1]:r('carriage-support',(x,sign*.48,9.02),(x,sign*.35,10.29),.055,edge,vertices=8)
        r('carriage-saddle',(x,-.42,10.29),(x,.42,10.29),.065,edge,vertices=10)

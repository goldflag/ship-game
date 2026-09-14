"""Original fixed small-boat appendages; generic engineering approximations.

Authored in metres at their own dimensions. No imported mesh or runtime scaling.
"""
import math
from geometry import Model


def create_small_propeller(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.rod('shaft-seat',(.12,0,0),(.42,0,0),.055,mat='edge',vertices=24)
    m.rod('bearing',(.28,0,0),(.42,0,0),.075,mat='underwater',vertices=24)
    spin=m.empty('spin',(0,0,0),m.root)
    m.rod('hub',(-.16,0,0),(.18,0,0),.10,mat='bronze',vertices=32,r2=.09,parent=spin)
    m.rod('cap',(-.30,0,0),(-.16,0,0),.02,mat='bronze',vertices=32,r2=.10,parent=spin)
    # Four rounded, closed blades with continuous twist and thick roots.
    # Shaft datum, right hand and 1.2 m nominal diameter are fixed by this variant.
    nr,nc=25,17
    for blade in range(4):
        angle=blade*math.tau/4;v=[]
        for side in [-1,1]:
            for k in range(nr):
                t=k/(nr-1);r=.075+.525*t
                chord=.085+.25*math.sin(math.pi*t)**.7
                if k==nr-1:chord=.004
                pitch=math.atan2(.72,math.tau*r)
                for j in range(nc):
                    u=-math.cos(math.pi*j/(nc-1));tangent=u*chord/2+.025*t*t
                    thick=(.035*(1-t)+.004)*math.sqrt(max(0,1-u*u))+.001
                    x=-tangent*math.sin(pitch)+.025*t+side*thick/2*math.cos(pitch)
                    tang=tangent*math.cos(pitch)+side*thick/2*math.sin(pitch)
                    v.append((x,-(r*math.cos(angle)-tang*math.sin(angle)),r*math.sin(angle)+tang*math.cos(angle)))
        stride=nr*nc;faces=[]
        for k in range(nr-1):
            for j in range(nc-1):
                n=k*nc+j;faces.extend([(n,n+nc,n+nc+1,n+1),(stride+n,stride+n+1,stride+n+nc+1,stride+n+nc)])
        edge=list(range(nc))+[k*nc+nc-1 for k in range(1,nr)]+[(nr-1)*nc+j for j in range(nc-2,-1,-1)]+[k*nc for k in range(nr-2,0,-1)]
        faces.extend((n,edge[(j+1)%len(edge)],stride+edge[(j+1)%len(edge)],stride+n) for j,n in enumerate(edge))
        m.mesh('blade-'+str(blade+1),v,faces,mat='bronze',smooth=True,parent=spin)
    return m.root


def create_small_rudder(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.cyl('bearing',(0,0,.40),.095,.20,mat='edge',vertices=24)
    yaw=m.empty('yaw',(0,0,0),m.root)
    m.cyl('stock',(0,0,-.10),.055,1.05,mat='edge',vertices=24,parent=yaw)
    # Balanced tapered foil: 0.8 m chord, 1 m blade depth, 0.075 m maximum thickness.
    profile=[(-.12,.025),(.04,.0375),(.18,.031),(.48,.018),(.68,.005)]
    verts=[]
    for z,chord_scale in [(.40,1),(-.6,.80)]:
        outline=[(-x*chord_scale,-thick,z) for x,thick in profile]+[(-x*chord_scale,thick,z) for x,thick in reversed(profile)]
        verts.extend(outline)
    n=len(profile)*2
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]
    m.mesh('foil',verts,faces,mat='underwater',parent=yaw)
    return m.root

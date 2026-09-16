"""Original generic capital-ship machinery and uptake, in forward/port/up metres.

Declared packages, not a historical plant reconstruction. External piping and
walkways are seated on the foundation; service clearance remains reserved.
"""
import math
from geometry import Model


def create_steam_plant(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    m.box('foundation', (0, 0, .18), (22, 10, .36), mat='edge')
    # Four boiler casings forward, with steam drums and furnace access covers.
    for x in [2, 7]:
        for y in [-2.4, 2.4]:
            m.box('boiler-seat', (x, y, .6), (4.5, 4.1, .5), mat='edge')
            m.box('boiler-casing', (x, y, 2.35), (4.2, 3.7, 3.1))
            m.rod('steam-drum', (x-1.8, y, 4.1), (x+1.8, y, 4.1), .6, mat='roof', vertices=32)
            for dy in [-.8,.8]:
                m.rod('furnace-cover', (x-2.14,y+dy,1.3),(x-2.04,y+dy,1.3),.45,mat='dark',vertices=24)
            m.rod('steam-riser', (x,y,4.1), (x,y,5.2), .16, mat='edge')
            m.rod('steam-header', (x,y,5.2), (-2,y,5.2), .16, mat='edge')
    # Separate turbine casings, reduction gearbox, condenser and output flanges.
    for y in [-2.4,2.4]:
        m.box('turbine-seat',(-4.5,y,.65),(6,3.1,.7),mat='edge')
        m.rod('turbine-casing',(-7,y,2),(-2,y,2),1.1,vertices=40)
        for x in [-6,-4,-2.3]:m.rod('casing-flange',(x-.08,y,2),(x+.08,y,2),1.2,mat='edge',vertices=40)
        m.rod('inlet',(-2,y,5.2),(-2,y,2),.16,mat='edge')
        m.box('reduction-gear',(-8.6,y,1.5),(2.4,2.8,2.3),mat='roof')
        m.rod('shaft-flange',(-10.8,y,1.5),(-9.8,y,1.5),.38,mat='edge',vertices=32)
    for y in [-4.6,4.6]:
        m.box('service-walkway',(0,y,.7),(20,.65,.15),mat='roof')
        for x in [-9,-6,-3,0,3,6,9]:m.rod('rail-post',(x,y,.7),(x,y,1.8),.035,mat='edge')
        for z in [1.3,1.8]:m.rod('service-rail',(-9,y,z),(9,y,z),.025,mat='edge')
    return m.root


def create_capital_funnel(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    n=64
    def ring(z, rx, ry):
        return [(-.085*z+rx*math.cos(i*math.tau/n),ry*math.sin(i*math.tau/n),z) for i in range(n)]
    rings=[ring(z,rx,ry) for z,rx,ry in [(0,4.7,2.9),(.5,4.5,2.7),(9.5,4.1,2.5),(10.7,4.2,2.6)]]
    m.mesh('uptake-jacket',[v for row in rings for v in row],[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)],smooth=True)
    top,inner,deep=ring(10.7,4.2,2.6),ring(10.7,3.95,2.35),ring(9.6,3.95,2.35)
    m.mesh('hood-lining',top+inner+deep,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(n+i,n+(i+1)%n,2*n+(i+1)%n,2*n+i) for i in range(n)]+[tuple(range(2*n,3*n))],mat='dark',smooth=True)
    for z,rx,ry in [(.12,4.68,2.88),(5,4.35,2.65),(9.5,4.14,2.54),(10.7,4.22,2.62)]:m.path('reinforcing-band',ring(z,rx,ry),.055,closed=True,mat='edge')
    for y in [-1.5,0,1.5]:
        half=4.2*math.sqrt(1-(y/2.6)**2)
        m.rod('grille',(-.9095-half,y,10.7),(-.9095+half,y,10.7),.05,mat='edge')
    m.ladder('access',(-4.95,0,.15),(-5.45,0,10.7),.65,mat='edge')
    for z in [.5,2.5,4.5,6.5,8.5,10.4]:
        x=-4.95-.5*(z-.15)/10.55
        for y in [-.325,.325]:m.rod('ladder-bracket',(x,y,z),(-4.1-.085*z,y,z),.055,mat='edge')
    for side in [-1,1]:
        m.rod('steam-pipe',(0,side*2.85,.15),(-.8,side*2.8,10.9),.10,mat='edge')
        for z in [1,3,5,7,9]:m.rod('pipe-bracket',(-.8*z/10.9,side*2.8,z),(-.8*z/10.9,side*2.4,z),.04,mat='edge')
    return m.root

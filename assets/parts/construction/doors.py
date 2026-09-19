"""Low-poly closed ship doors, interpreted from the owner's two door references.

Rounded coamings and pressed leaves; wheel, lever and dogged porthole variants.
X=0 is the wall, positive X is outward. No working hinge or hull opening.
"""
import math
from geometry import Model


def rounded(width, height, radius):
    points = []
    for y, z, start in [(width/2-radius, height/2-radius, 0),
                         (-width/2+radius, height/2-radius, 90),
                         (-width/2+radius, -height/2+radius, 180),
                         (width/2-radius, -height/2+radius, 270)]:
        for i in range(7):
            a = math.radians(start + i*15)
            points.append((y + radius*math.cos(a), z + radius*math.sin(a)))
    return points


def create_door(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    m.root['wallRelief'] = True
    w, h, depth = part['size']
    center = part['boundsCenter'][1]
    radius = w*.24
    wheel = part['id'] == 'generic-watertight-door'
    window = part['id'] == 'generic-windowed-door'

    def panel(name, width, height, r, x, z, mat):
        outline = rounded(width, height, r)
        m.mesh(name, [(x,y,t+z) for y,t in outline], [tuple(range(len(outline)))], mat=mat)

    def profile(name, rings, mat='naval', cap=False):
        # Each ring is (outward depth, width, height, corner radius).
        outlines = [rounded(width, height, r) for _,width,height,r in rings]
        n = len(outlines[0])
        vs = [(ring[0],y,z+center) for ring,outline in zip(rings,outlines) for y,z in outline]
        fs = [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(len(rings)-1) for i in range(n)]
        if cap:
            fs += [tuple(reversed(range(n))), tuple(range((len(rings)-1)*n,len(vs)))]
        m.mesh(name, vs, fs, mat=mat)

    def rod(name, a, b, r, mat='painted-edge', sides=6):
        m.rod(name, a, b, r, mat=mat, vertices=sides)

    def ring(name, y, z, r, thickness, back, front, mat='naval', segments=16):
        # Four-sided continuous ring instead of overlapping cylinder segments.
        vs = [(x,y+rr*math.cos(i*math.tau/segments),z+rr*math.sin(i*math.tau/segments))
              for i in range(segments) for rr,x in [(r-thickness,back),(r-thickness,front),(r,front),(r,back)]]
        fs = [(i*4+j,((i+1)%segments)*4+j,((i+1)%segments)*4+(j+1)%4,i*4+(j+1)%4)
              for i in range(segments) for j in range(4)]
        m.mesh(name, vs, fs, mat=mat)

    # Welded surround reaches the wall. The narrow dark gasket sits behind the
    # leaf, leaving a readable reveal rather than an oversized black outline.
    profile('coaming', [(0,w,h,radius),(.014,w-.018,h-.018,radius-.009),
                       (.024,w-.085,h-.085,radius-.0425),(.008,w-.099,h-.099,radius-.0495)])
    panel('gasket', w-.088,h-.088,radius-.044,.008,center,'dark')
    profile('pressed-leaf', [(.009,w-.113,h-.113,radius-.0565),
                            (.023,w-.113,h-.113,radius-.0565),
                            (.029,w-.129,h-.129,radius-.0645)],mat='roof',cap=True)

    for fraction in [.23,.5,.77] if window else [.26,.74]:
        z=center+h*(fraction-.5)
        m.box('hinge-strap',(.032,-w*.335,z),(.022,w*.225,.052))
        rod('hinge-knuckle',(.028,-w*.438,z-.060),(.028,-w*.438,z+.060),.021,mat='naval',sides=8)
        for end in [-1,1]:
            m.box('hinge-seat',(.017,-w*.438,z+end*.052),(.034,.057,.024))

    if wheel:
        z=center-.035; x=depth-.012; r=w*.188
        rod('wheel-boss',(.029,0,z),(x,0,z),.029,sides=8)
        ring('handwheel',0,z,r,.018,x-.007,x+.007,'painted-edge',20)
        for i in range(4):
            a=i*math.tau/4+.15
            rod('wheel-spoke',(x,0,z),(x,(r-.009)*math.cos(a),z+(r-.009)*math.sin(a)),.011)
        rod('wheel-nut',(x,0,z),(x+.01,0,z),.019,mat='bronze',sides=6)
        # Short perimeter dogs indicate the wheel-operated closure without
        # duplicating the six external hand levers of the windowed variant.
        for side in [-1,1]:
            for fraction in [.20,.5,.80]:
                z=center+h*(fraction-.5)
                m.box('locking-dog',(.031,side*w*.412,z),(.024,.077,.028),mat='painted-edge')
    else:
        y=w*.30; z=center-.07
        rod('handle-boss',(.029,y,z),(.045,y,z),.029,sides=8)
        rod('lever-handle',(.046,y,z),(.046,y-.13,z-.012),.014,sides=6)
        if window:
            z=center+h*.25; r=w*.168
            # Opaque glass with a raised round scuttle rim; no expensive boolean.
            angles=[i*math.tau/16 for i in range(16)]
            m.mesh('porthole-glass',[(.031,r*.84*math.cos(a),z+r*.84*math.sin(a)) for a in angles],[tuple(range(16))],mat='glass')
            ring('porthole-rim',0,z,r,.026,.029,.046,segments=16)
            for i in range(8):
                a=(i+.5)*math.tau/8
                y=(r-.013)*math.cos(a); zz=z+(r-.013)*math.sin(a)
                rod('scuttle-fastener',(.046,y,zz),(.050,y,zz),.008,sides=4)
            for side in [-1,1]:
                for fraction in ([.14,.38,.86] if side == -1 else [.18,.61,.83]):
                    z=center+h*(fraction-.5); y=side*w*.353
                    rod('dog-boss',(.029,y,z),(.043,y,z),.024,sides=6)
                    rod('dog-lever',(.044,y,z),(.044,y-side*.035,z-.09),.012,sides=6)
                    m.box('dog-catch',(.028,side*w*.416,z),(.024,.048,.032))
    return m.root

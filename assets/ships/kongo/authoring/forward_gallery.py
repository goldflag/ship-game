"""Original forward AA gallery, shared by the visual recipe and CPU surfaces.

Blender metres: +X forward, +Y port, +Z up. Dimensions follow inspected
sections of the approved model; no reference mesh is read by this recipe.
"""
import math


def outline():
    # Chamfered bow, parallel gun bays, rounded director shoulders and tapered
    # aft neck. Keep the neck long enough to meet the lower bridge casing.
    side=[(35.70,1.97),(38.02,3.08),(38.20,3.30),(38.40,3.49),
          (38.65,3.62),(38.90,3.66),(39.15,3.64),(39.40,3.55),
          (39.62,3.44),(42.62,3.44),(43.67,2.47)]
    return [(x,-y) for x,y in side]+list(reversed(side))


def create(h,mats):
    mesh=h['mesh'];prism=h['prism'];rod=h['rod'];box=h['box']
    steel=mats['naval'];edge=mats['edge']
    prefix='aa.forward-high'
    deck=outline()
    prism(prefix+'.deck',deck,16.52,16.62)

    # A closed narrow extrusion gives every web and opening a physical reveal.
    def plate(name,polygon,axis,offset,thickness=.045):
        def point(p,d):
            return (p[0],d,p[1]) if axis=='y' else (d,p[0],p[1])
        n=len(polygon)
        vertices=[point(p,d) for d in [offset-thickness/2,offset+thickness/2] for p in polygon]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        if axis=='y':faces=[tuple(reversed(f)) for f in faces]
        mesh(name,vertices,faces,steel)

    def lower(x):
        return 15.485+max(0,x-40.09)*(.2723)

    for sign in [-1,1]:
        y=sign*1.93
        name=prefix+f'.web-{sign}'
        plate(name,[(35.70,15.485),(36.55,15.485),(36.55,16.53),(35.70,16.53)],'y',y)
        for x0,x1,cx in [(36.55,37.80,37.18),(37.80,39.02,38.415),(39.02,40.09,39.63)]:
            cz=16.026;radius=.26
            inner=[(cx+radius*math.cos(i*math.tau/8),cz+radius*math.sin(i*math.tau/8)) for i in range(8)]
            outer=[(x1,cz),(x1,16.53),(cx,16.53),(x0,16.53),
                   (x0,cz),(x0,15.485),(cx,15.485),(x1,15.485)]
            for i in range(8):
                j=(i+1)%8
                plate(name,[outer[i],outer[j],inner[j],inner[i]],'y',y)
            # Rolled rim follows the octagonal opening without closing it.
            for a,b in zip(inner,inner[1:]+inner[:1]):
                rod(prefix+'.opening-rim', (a[0],y+sign*.025,a[1]),
                    (b[0],y+sign*.025,b[1]),.018,edge,vertices=6)
        plate(name,[(40.09,15.485),(43.65,16.455),(43.65,16.53),(40.09,16.53)],'y',y)
        # Paired flat knees terminate in foot plates on the conning body.
        plate(prefix+'.knee',[(39.67,14.12),(39.67,14.38),(41.73,16.18),(41.73,15.98)],'y',sign*1.84,.11)
        box(prefix+'.knee-foot',(39.66,sign*1.84,14.29),(.085,.34,.43),steel)
        plate(prefix+'.knee-tie',[(39.70,14.31),(39.77,14.36),(39.37,15.50),(39.30,15.48)],'y',sign*1.84,.055)
        # A narrow flange follows the underside of each longitudinal web.
        points=[(35.70,y,15.485),(40.09,y,15.485),(43.65,y,16.455)]
        for a,b in zip(points,points[1:]):rod(prefix+'.web-flange',a,b,.034,steel,vertices=6)

    # Cross-webs spread the loads out from the longitudinal perforated plates.
    # Their triangular outer ends meet the actual deck edge.
    for x,width in [(36.05,2.13),(37.75,2.95),(39.00,3.64),(40.75,3.42),(41.45,3.42),(42.20,3.42),(42.95,3.14)]:
        z=lower(x)
        plate(prefix+'.cross-web',[(-width,16.525),(-1.95,z),(1.95,z),(width,16.525)],'x',x)

    # The aft screen rises around the directors and slopes down to the gun bays.
    def top(x):return 17.49 if x<=39.55 else 17.02 if x>=40.55 else 17.49-(x-39.55)*.47
    shield_side=[(35.70,1.97),(38.02,3.08),(38.20,3.30),(38.40,3.49),
                 (38.65,3.62),(38.90,3.66),(39.15,3.64),(39.40,3.55),
                 (39.62,3.44),(40.55,3.44),(42.62,3.44),(43.67,2.47)]
    contour=[(x,-y) for x,y in shield_side]+list(reversed(shield_side))
    # The aft neck stays open into the bridge.
    for a,b in zip(contour,contour[1:]):
        dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
        nx=-dy/length*.03;ny=dx/length*.03
        vertices=[(p[0]+s*nx,p[1]+s*ny,z) for s in [-1,1] for p in [a,b] for z in [16.60,top(p[0])]]
        mesh(prefix+'.shield',vertices,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],steel)
        rod(prefix+'.shield-edge',(*a,top(a[0])),(*b,top(b[0])),.028,edge,vertices=8)

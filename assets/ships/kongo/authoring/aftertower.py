"""Original aft director tower and uptake access, in Blender ship coordinates."""
import math

def create(h,mats):
    mesh,prism,rod,cyl,box,rail,shield,oval,rect=(h[k] for k in
        ('mesh','prism','rod','cyl','box','rail','shield','oval','rect'))
    # The shared aft foundation is authored with the uptake deckhouses.
    # The approved model has a rounded aft face at X=-16.88 above the lower
    # plinth, with the forward face raking aft toward the director. A rectangular
    # tower here intruded into the third turret's rear corners.
    def aftertower_outline(front,radius=2.4,center=-14.48):
     return [(front,-radius),(front,radius)]+[(center+radius*math.cos(a),radius*math.sin(a)) for a in [math.pi/2+i*math.pi/16 for i in range(17)]]
    lower=aftertower_outline(-9.95);upper=aftertower_outline(-12.42);n=len(lower)
    mesh('aftertower.base',[(x,y,9.0) for x,y in lower]+[(x,y,18.2) for x,y in upper],
     [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,n*2))],mats['naval'])
    for z,w,aft in [(13.1,2.1,-17.9),(15.8,4,-18.45)]:
     outline=oval((aft-11.4)/2,0,(-11.4-aft)/2,w)
     prism('aftertower.gallery',outline,z-.2,z);rail('aftertower.rail',outline,z)
    # The aft director is the compact optical house in the approved model,
    # centered at X=-13.88. It has no transverse rangefinder tube.
    director_x=-13.88
    cyl('aftertower.director-seat',(director_x,0,18.30),1.67,.20,mats['edge'],vertices=48)
    prism('aftertower.director-cone',oval(director_x,0,1.67,1.67,48),18.4,19.08,topscale=.85)
    for i in range(12):
     a=i*math.tau/12
     rod('aftertower.director-rib',(director_x+1.63*math.cos(a),1.63*math.sin(a),18.43),
         (director_x+1.43*math.cos(a),1.43*math.sin(a),19.08),.037,mats['naval'],vertices=6)
    cyl('aftertower.director-sill',(director_x,0,19.19),1.44,.22,mats['naval'],vertices=64)
    for i in range(64):
     a=i*math.tau/64;b=(i+1)*math.tau/64;degrees=(i+.5)*360/64
     if 126<degrees<151 or 209<degrees<234:continue
     vs=[(director_x+r*math.cos(t),r*math.sin(t),z) for r in [1.44,1.37] for z in [19.30,20.30] for t in [a,b]]
     mesh('aftertower.director-wall',vs,[(0,1,3,2),(5,4,6,7),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],mats['naval'])
    cyl('aftertower.director-lintel',(director_x,0,20.34),1.44,.08,mats['naval'],vertices=64)
    prism('aftertower.director-roof',oval(director_x,0,1.48,1.48,64),20.38,20.55,topscale=.77)
    # External cable arches over the roof and enters a small junction box.
    for a,b in [((-12.15,0,18.40),(-12.15,0,20.70)),((-12.15,0,20.70),(-13.88,0,20.70)),((-13.88,0,20.70),(-13.88,0,20.52))]:
     rod('aftertower.director-cable',a,b,.035,mats['edge'],vertices=8)
    rod('aftertower.director-cable-foot',(-12.15,0,18.40),(-12.60,0,18.40),.035,mats['edge'],vertices=8)
    box('aftertower.director-junction',(-13.88,0,20.55),(.24,.19,.09),mats['edge'])
    for sign in [1]:
     # Ladder rails follow the raked front wall, with wall-mounted feet.
     for yy in [sign*.18,sign*.58]:
      rod('aftertower.ladder-rail',(-9.75,yy,9.0),(-12.22,yy,18.2),.024,mats['edge'],vertices=6)
     for j in range(33):
      z=9.05+j*.28;x=-9.75-(z-9)*2.47/9.2
      rod('aftertower.ladder-rung',(x,sign*.18,z),(x,sign*.58,z),.021,mats['edge'],vertices=6)
     for z in [9.2,12,15,18.2]:
      x=-9.75-(z-9)*2.47/9.2
      rod('aftertower.ladder-foot',(x,sign*.38,z),(x-.20,sign*.38,z),.025,mats['naval'],vertices=6)

    # Gallery access: narrow walkways beside the after uptake leave the mouth
    # and the space underneath open, as in the approved quarter view.
    for sign in [-1,1]:
     y0,y1=sorted([sign*2.52,sign*3.50])
     walkway=rect(-12.35,-4.0,y0,y1,.10)
     prism('aftertower.access-deck',walkway,16.04,16.17)
     rail('aftertower.access-rail',[(-12.35,sign*3.50),(-4.0,sign*3.50)],16.17,.88,False)
     rail('aftertower.access-inner-rail',[(-11.8,sign*2.52),(-4.0,sign*2.52)],16.17,.88,False)
     for step in range(4):
      x=-4.0+step*.32;top=16.17+(step+1)*.1875
      prism('aftertower.access-step',rect(x,x+.35,y0,y1,.03),top-.10,top)
     for y in [sign*2.62,sign*3.40]:
      rod('aftertower.access-stringer',(-4.1,y,16.0),(-2.66,y,16.78),.065,mats['naval'],vertices=8)
      rod('aftertower.access-step-rail',(-4.1,y,17.05),(-2.66,y,17.8),.022,mats['edge'],vertices=6)
      for x,z in [(-4.1,16.17),(-2.66,16.92)]:rod('aftertower.access-step-post',(x,y,z),(x,y,z+.88),.024,mats['naval'],vertices=6)
     for x in [-10.6,-4.0]:
      rod('aftertower.access-knee',(x,sign*2.0,15.0),(x,sign*3.45,16.04),.075,mats['naval'],vertices=8)

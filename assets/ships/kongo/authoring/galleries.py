"""Original fixed AA galleries, shared by rendering and contact authoring.

Blender metres: +X bow, +Y port, +Z up. Extracted without changing the existing
platform contours, support members, shield thicknesses or object names.
"""
import math


def create(helpers, mats):
    prism, rod, mesh, shield, oval, rect = (helpers[k] for k in
                                          ('prism', 'rod', 'mesh', 'shield', 'oval', 'rect'))
    # AA galleries have slab edges, deck-connected columns and cantilever knees.
    def gallery(name,outline,z,rootz,columns):
     prism(name+'.deck',outline,z-.18,z)
     for x,y in columns:
      rod(name+'.column',(x,y,rootz),(x,y,z-.15),.115,mats['naval'],vertices=12)
      for dx in [-.7,.7]:
       rod(name+'.knee',(x,y,z-.95),(x+dx,y,z-.17),.065,mats['naval'])
    for sign in [-1,1]:
     gallery(f'aa.compass-single-{sign}',oval(29.34,sign*4.31,1.05,.85),17.8,16.4,[(29.34,sign*4.1)])
     # Broadside twins sit in circular sponsons tied back to the central deck.
     for idx,(x,y,z) in enumerate([(25.94,10.19,7.75),(13.79,11.89,7.75),(2.07,6.85,9.45)]):
      yy=sign*y;outline=oval(x,yy,2.7,2.7)
      gallery(f'aa127.sponson-{sign}-{idx}',outline,z,5.3,[(x-1.3,yy-sign*.8),(x+1.3,yy-sign*.8)])
      for dx in [-1.5,1.5]:rod('aa127.sponson-brace',(x+dx,yy-sign*2.5,5.35),(x+dx,yy,z-.2),.16,mats['naval'])
     y0,y1=sorted([sign*4.8,sign*8.9])
     prism(f'aa.bridge-lower-{sign}.deckhouse',rect(31.8,40.1,y0,y1,.65),7.3,10.35)
     gallery(f'aa.bridge-lower-{sign}',rect(31.8,40.1,y0,y1,.65),10.51,7.3,[(33,sign*7.5),(38.6,sign*7.5)])
     shield(f'aa.bridge-lower-{sign}.shield',rect(31.8,40.1,y0,y1,.65),10.51,.48)
     for idx,(x,y,z,rootz) in enumerate([(34.02,4.31,13.67,10.51),(26.63,4.37,22.12,18.9),
      (14.52,4.28,14.98,7.55),(-2.2,3.33,16.92,7.55),(-15.73,3.25,16.17,12.0)]):
      yy=sign*y
      outline=oval(x,yy,1.7,1.5)
      if idx==1:
       prism(f'aa.high-{sign}-{idx}.deck',outline,z-.18,z)
       for dx in [-.75,.75]:rod(f'aa.high-{sign}-{idx}.bracket',(x+dx,sign*2.3,20.55),(x+dx,yy,z-.18),.14,mats['naval'])
      elif idx==4:
       # The after-tower gallery is cantilevered from its casing. Long free-ended
       # posts here hung above turret 3 and intruded into its train envelope.
       prism(f'aa.high-{sign}-{idx}.deck',outline,z-.18,z)
       for xx in [x-.60,x+.60]:
        vs=[(xx+dx,sign*y,z0) for dx in [-.035,.035]
            for y,z0 in [(1.5,z-1.30),(1.5,z-.18),(4.45,z-.18)]]
        mesh(f'aa.high-{sign}-{idx}.web',vs,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],mats['naval'])
      else:gallery(f'aa.high-{sign}-{idx}',outline,z,rootz,[(x-.8,yy),(x+.8,yy)])
      if idx in [0,1,2,3,4]:
       shield(f'aa.high-{sign}-{idx}.shield',outline,z,.52)
       if idx==0:prism(f'aa.high-{sign}-{idx}.pod',outline,10.51,z-.18)
     # Mainmast single-gun walkway beside the uptake.
     y0,y1=sorted([sign*3.85,sign*5.75])
     gallery(f'aa.mast-walk-{sign}',rect(-5.7,-.4,y0,y1,.25),11.77,7.55,[(-4.8,sign*4.5),(-1.3,sign*4.5)])
    funnel_aa=[(11.65,-2.8),(13.3,-2.8)]+[(13.3+2.35*math.cos(a),2.8*math.sin(a)) for a in [-math.pi/2+i*math.pi/24 for i in range(25)]]+[(11.65,2.8)]
    gallery('aa.funnel-front-high',funnel_aa,18.61,7.55,[(14.75,-2.0),(14.75,2.0)])
    shield('aa.funnel-front-high.shield',funnel_aa,18.61,.70)
    for sign in [-1,1]:
     for z0,z1 in [(8,11.5),(11.5,15),(15,18.43)]:
      rod('aa.funnel-front-high.diagonal',(14.75,sign*2,z0),(11.7,sign*1.8,z1),.09,mats['naval'],vertices=8)
      rod('aa.funnel-front-high.diagonal',(11.7,sign*1.8,z0),(14.75,sign*2,z1),.09,mats['naval'],vertices=8)
     rod('aa.funnel-front-high.inner-leg',(11.7,sign*1.8,7.55),(11.7,sign*1.8,18.43),.13,mats['naval'],vertices=12)

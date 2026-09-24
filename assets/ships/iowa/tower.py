"""Fore tower: tower base and upper tower, observation platforms, Mk.38 and side Mk.37 directors, foremast and radars.

Region: the tower from the 02 deck up (runtime z -12..+4), the foremast and its
rigging. Executed in build.py's scope after forward.py.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL);structures={s['id']:s for s in D['structures']}
for id in ['tower-platform','tower-crown']:
    ASSEMBLY=id;s=structures[id];poly=outline_of(s);z=s['baseY']+s['height']
    wall('Observation platform bulwark',poly,z,1.02 if id=='tower-platform' else 1.015,.06)
    for side in [-1,1]:
        for x in ([3.8,8.4] if id=='tower-platform' else [4.8,6.2,9.0]):
            y=3.2 if id=='tower-platform' or x>8 else 6.8
            rod('Observation wing supporting knee',(min(x,7.95),side*1.85,z-1.30),(x,side*y,z-.06),.075,'naval',vertices=8)
    for x,y in ([(9.7,-1.9),(9.7,1.9)] if id=='tower-platform' else [(5.6,-6.2),(5.6,6.2),(9.2,0)]):
        cyl('Observation instrument pedestal',(x,y,z+.34),.10,.68,vertices=12)
        rod('Observation binoculars',(x-.1,y-.22,z+.83),(x+.14,y-.22,z+.83),.068,'edge',vertices=10)
        rod('Observation binoculars',(x-.1,y+.22,z+.83),(x+.14,y+.22,z+.83),.068,'edge',vertices=10)
        rod('Binocular crosspiece',(x,y-.22,z+.74),(x,y+.22,z+.74),.058,'naval',vertices=10)
ASSEMBLY='tower-upper'
for side in [-1,1]:
    for z in [27.95,31.43]:
        y=side*(2.29-(z-24.532)/7.608*.38)
        for x in ([4.4,5.9,7.45] if z<30 else [7.45]):
            box('Tower observation coaming',(x,y,z),(.73,.065,.34))
            box('Tower observation slit',(x,y+side*.038,z),(.55,.025,.15),'glass')
    F.ladder('Upper tower access',(7.65,side*2.30,24.55),(7.65,side*1.97,32.20),.42)
    for z in [25,27,29,31]:rod('Tower ladder standoff',(7.65,side*(2.29-(z-24.532)/7.608*.38),z),(7.65,side*(2.30-(z-24.55)/7.65*.33),z),.035,'naval',vertices=6)
    # Routed conduits sit just proud of the sloping plating.
    path=[(5.1,side*2.25,24.57),(5.1,side*2.14,27.5),(3.2,side*2.14,27.5),(3.2,side*2.0,30.0),(2.7,side*2.0,30.0)]
    for a,b in zip(path,path[1:]):rod('Tower routed conduit',a,b,.045,'naval',vertices=8)
ASSEMBLY='tower-base'
for side in [-1,1]:
    for z in [14.1,17.5,21.0]:
        rod('Tower porthole coaming',(1.95,side*2.45,z),(1.95,side*2.54,z),.20,'naval',vertices=20)
        rod('Tower porthole',(1.95,side*2.55,z),(1.95,side*2.57,z),.145,'glass',vertices=20)
    for z in [12.5,18.4]:F.vent('Tower ventilation grille',4.9,side*2.51,z,1.20,1.70)
    F.door('Control tower watertight door',6.45,side*2.51,11.47,.78,1.90)
ASSEMBLY='tower-director-column'
for z in [33.55,34.66,35.75]:
    rx=2.25-(z-32.14)/4.4435*.30;ry=1.85-(z-32.14)/4.4435*.20
    path=[(6.55+rx*math.cos(i*math.tau/40),ry*math.sin(i*math.tau/40),z) for i in range(40)]
    for a,b in zip(path,path[1:]+path[:1]):rod('Director column horizontal seam',a,b,.018,'edge',vertices=4)


COL=collections['Masts and directors'];F=Fittings(helpers,materials,COL)
ASSEMBLY='foremast'
def foremast_x(z):return 1.2-2.2*(min(46.4,z)-24.2)/22.2
def aftermast_x(z):return -36.4-1.1*(min(36.1,z)-11.43)/24.67
rod('Foremast trunk',(1.2,0,24.2),(-1,0,46.4),.30,'naval',r2=.16,vertices=20)
rod('Foremast topmast',(-1,0,46.3),(-1,0,50.7),.065,'edge',r2=.025,vertices=12)
for side in [-1,1]:rod('Foremast lower strut',(4.0,side*2.65,24.54),(-.15,0,37.3),.1,'naval',vertices=10)
for z,width in [(31.5,7.3),(39.2,4.8),(43.4,2),(47.2,1.4)]:
    x=foremast_x(z)
    rod('Foremast yard',(x,-width,z),(x,width,z),.065,'naval',r2=.045,vertices=10)
    for side in [-1,1]:rod('Yard stay',(foremast_x(z+1.9),0,z+1.9),(x,side*width,z),.016,'edge',vertices=4)
F.ladder('Foremast ladder',(1,-.31,25),(-1.05,-.2,46.4),.35)
for z in [26,31,36,41,45]:
    t=(z-25)/21.4;rod('Mast ladder standoff',(foremast_x(z),0,z),(1-2.05*t,-.31+.11*t,z),.035,'naval',vertices=6)
box('Radar platform',(1.8,0,39.2),(6,2,.22),'roof')
for side in [-1,1]:rod('Radar platform knee',(-.4,side*.65,36.9),(3.2,side*.65,39.1),.085,'naval',vertices=8)
cyl('Search radar pedestal',(4,0,39.85),.44,1.25,vertices=20)
before=set(scene.objects);cx,cz,r=4,43.4,3.05
for rr in [r,r*.67]:
    for i in range(24):
        a,b=i*math.tau/24,(i+1)*math.tau/24
        rod('Circular radar frame',(cx,rr*math.cos(a),cz+rr*math.sin(a)),(cx,rr*math.cos(b),cz+rr*math.sin(b)),.055 if rr==r else .025,'edge',vertices=6)
for i in range(12):
    a=i*math.tau/12
    rod('Radar radial rib',(cx-.55,0,cz),(cx,r*math.cos(a),cz+r*math.sin(a)),.038,'edge',vertices=6)
for yy in [i*.28 for i in range(-10,11)]:
    hh=math.sqrt(max(0,r*r-yy*yy))
    rod('Radar screen',(cx,yy,cz-hh),(cx,yy,cz+hh),.011,'edge',vertices=4)
rod('Radar yoke',(cx,0,40.1),(cx-.55,0,cz),.17,'naval',vertices=14)
radar_pivot('radar-search.yaw',(4,0,39.2),set(scene.objects)-before)

for id in ['director-main-forward','director-secondary-port','director-secondary-starboard']:
    ASSEMBLY=id;fire_control(id)

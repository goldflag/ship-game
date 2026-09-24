"""Aft superstructure: after tower, Mk.38 and Mk.37 aft directors, mainmast, aft AA positions.

Region: runtime z > +35 m above the 01 deck. Executed in build.py's scope after midships.py.
"""
COL=collections['Masts and directors'];F=Fittings(helpers,materials,COL);structures={s['id']:s for s in D['structures']}
for id in ['director-main-aft','director-secondary-aft']:
    ASSEMBLY=id;fire_control(id)
COL=collections['Masts and directors']
ASSEMBLY='mainmast'
rod('After mast',(-36.4,0,11.05),(-37.5,0,36.1),.24,'naval',r2=.105,vertices=16)
for z,width in [(25.4,4.8),(33.6,2.5)]:
    x=aftermast_x(z)
    rod('After mast yard',(x,-width,z),(x,width,z),.06,'naval',vertices=10)
    for side in [-1,1]:rod('After mast stay',(aftermast_x(z+2),0,z+2),(x,side*width,z),.016,vertices=4)
for side in [-1,1]:
    rod('Main aerial',(foremast_x(39.2),side*4.8,39.2),(aftermast_x(33.6),side*2.5,33.6),.014,vertices=4)
    rod('Forward stay',(-1,0,46),(22,side*4,17.2),.017,vertices=4)
    rod('After stay',(-37.4,0,34.5),(-51,side*2.0,11.08),.017,vertices=4)


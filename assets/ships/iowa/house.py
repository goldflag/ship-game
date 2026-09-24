"""01 and 02 deckhouse levels: their walls (doors, scuttles, louvres, pipes, ladders and stairs from the
main deck to 01 and from 01 to 02), the 01 deck surface (boats, lockers, vents, hose reels), 01/02 edge
rails, and the 01-level AA galleries and tubs.

Region: the whole length, main deck to the 02 deck edge. Executed in build.py's scope after aft.py.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL)
for id in ['deckhouse-main','deckhouse-secondary']:
    s=next(s for s in D['structures'] if s['id']==id);ASSEMBLY=id
    for side in [-1,1]:
        poly=[(-c,-a) for a,c in s['footprint']]
        def edge_y(x):
            values=[a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]) for a,b in zip(poly,poly[1:]+poly[:1]) if min(a[0],b[0])<=x<=max(a[0],b[0]) and abs(b[0]-a[0])>.001]
            return side*max(abs(v) for v in values)
        for x in [-36,-29,-18,-9,1,11]:
            y=edge_y(x)
            z=s['baseY']+1.7
            rod('Porthole rim',(x,y-.04,z),(x,y+.04,z),.19,'edge',vertices=16)
            rod('Porthole glass',(x,y-.051,z),(x,y+.051,z),.135,'glass',vertices=16)
        for x in [-34,-6,10]:F.door('Watertight door',x,edge_y(x),s['baseY']+.06,.72,1.78)
        for x in [-26,-15,3]:F.vent('Ventilator',x,edge_y(x),s['baseY']+.8,1.3,.7)

COL=collections['Deck fittings'];ASSEMBLY='hull';F=Fittings(helpers,materials,COL)
for side in [-1,1]:
    # Open boats sit on the main deck beneath the Oerlikon galleries.
    F.boat('Deck launch',-13.5,side*13.4,deckz(-13.5)+.08,8.4,2,False)

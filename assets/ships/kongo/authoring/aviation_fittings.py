"""Original aircraft-deck beams, edge trim and handling rails.

Shared rendering/contact recipe in Blender metres (+X bow, +Y port, +Z up).
"""

def create(helpers, mats, flight_outline):
    box, rod = helpers['box'], helpers['rod']
    def flight_edges(x):
     ys=[]
     for a,b in zip(flight_outline,flight_outline[1:]+flight_outline[:1]):
      if min(a[0],b[0])<=x<max(a[0],b[0]):ys.append(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]))
     return min(ys),max(ys)
    for x in [-56,-54,-52,-50,-48,-46,-44,-42,-40,-38,-36,-34,-32]:
     y0,y1=flight_edges(x)
     box('aviation.deck-beam',(x,(y0+y1)/2,7.065),(.16,y1-y0,.19),mats['naval'])
     rod('aviation.deck-seam',(x,y0+.08,7.26),(x,y1-.08,7.26),.014,mats['canvas'],vertices=5)
    for a,b in zip(flight_outline,flight_outline[1:]+flight_outline[:1]):
     rod('aviation.deck-edge',(*a,7.22),(*b,7.22),.055,mats['naval'],vertices=8)
    for y in [-3.0,3.0]:
     rod('aviation.handling-rail',(-55.6,y,7.38),(-31.7,y,7.38),.055,mats['edge'],vertices=8)
     for x in [-55.5,-52,-48,-44,-40,-36,-32]:box('aviation.rail-foot',(x,y,7.32),(.22,.24,.14),mats['naval'])

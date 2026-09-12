"""Original foredeck capstans shared by rendering and CPU contact authoring."""
import math

def create(helpers, mats, deck, name, x, y, r=.62, height=.75):
 cyl, rod = helpers["cyl"], helpers["rod"]
 z=deck(x)+.055
 cyl(name+'.foot',(x,y,z+.09),r*1.32,.18,mats['naval'])
 cyl(name+'.drum',(x,y,z+.18+height/2),r,height,mats['edge'],r2=r*.82)
 cyl(name+'.head',(x,y,z+.18+height),r*1.15,.13,mats['naval'])
 for i in range(8):
  a=i*math.tau/8
  rod(name+'.rib',(x+r*math.cos(a),y+r*math.sin(a),z+.2),(x+r*.83*math.cos(a),y+r*.83*math.sin(a),z+height+.13),.035,mats['naval'],vertices=5)

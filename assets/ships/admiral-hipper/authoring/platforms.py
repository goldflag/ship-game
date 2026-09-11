"""Original platform floors shared by visual construction and combat clearance."""
import math
# Auxiliary +1.3 m longitudinal datum, converted on blueprint insertion.
FWD_105=[(27.6,6.8),(27.6,9.8),(28.5,9.8),(29.3,10.55),(31,11.4),(32.8,11.4),(34,10.6),(35,9.55),(36.5,8.65),(36.5,6.8)]
AFT_105=[(-33,6.5),(-32,9.3),(-31,10.13),(-27,10.2),(-26,10.1),(-24,7.7),(-24,5.5)]
AA40=[(33,4.48),(33,5.97),(34,7.09),(35,7.59),(36.8,7.59),(37.3,7.3),(39,6.13),(39,4.45)]
AA37=[(-28.5,3.85),(-28.5,4.7),(-28,5.3),(-27,5.95),(-26.3,6.065),(-24.5,6.065),(-24.5,3.85)]
AFT_GALLERY=[(-38.8,0),(-38,1.1),(-37,1.84),(-36,2.89),(-35,3.89),(-29,3.89),(-28,2.68),(-27.6,0),(-28,-2.68),(-29,-3.89),(-35,-3.89),(-36,-2.89),(-37,-1.84),(-38,-1.1)]
FUNNEL_GALLERY=[(4.25,0),(4.3,3.03),(4.5,3.39),(4.8,3.70),(5.5,4.07),(8,5.09),(8.8,5.45),(10.5,5.45),(11,3.3),(14,2.94),(15,2.53),(16,1.48),(16.5,0),(16,-1.48),(15,-2.53),(14,-2.94),(11,-3.3),(10.5,-5.45),(8.8,-5.45),(8,-5.09),(5.5,-4.07),(4.8,-3.70),(4.5,-3.39),(4.3,-3.03)]
PLATFORMS=[
 ('bridge-wings',[(26,-6.9),(31.3,-6.9),(33,-5.3),(32.7,-3),(26,-3),(26,3),(32.7,3),(33,5.3),(31.3,6.9),(26,6.9)],12.1,.84),
 ('signal-gallery',[(16,-3.2),(19,-5.7),(24.8,-5.7),(24.8,5.7),(19,5.7),(16,3.2)],19.3,.86),
 ('forward-aa-gallery',[(25.7,-3.05),(29.9,-3.05),(31,-2),(31,2),(29.9,3.05),(25.7,3.05)],22.5,1.1),
 ('tower-top-gallery',[(20.2,0),(20.3,-1.95),(20.4,-3.52),(20.5,-4.17),(21,-4.47),(22,-4.63),(23.5,-4.74),(25,-4.66),(26.1,-4.48),(26.5,-4.21),(26.7,-3.51),(26.8,0),(26.7,3.51),(26.5,4.21),(26.1,4.48),(25,4.66),(23.5,4.74),(22,4.63),(21,4.47),(20.5,4.17),(20.4,3.52),(20.3,1.95)],25.05,1.03),
 ('navigation-gallery',[(27,-4.7),(36,-4.74),(37.8,-5.66),(40.5,-5.66),(42,-4.4),(43.9,-3),(44.8,-1.8),(44.8,1.8),(43.9,3),(42,4.4),(40.5,5.66),(37.8,5.66),(36,4.74),(27,4.7)],12.1,.84),
 ('funnel-searchlight-gallery',FUNNEL_GALLERY,16.2,.86),
 ('aft-director-gallery',AFT_GALLERY,11.8,.84),
]
for side in [-1,1]:
 PLATFORMS.append(('middle-105-edge-'+('port' if side==1 else 'starboard'),[(x,side*y) for x,y in [(-12.55,10.20),(-12.55,10.38),(-11.3,11.10),(-9.7,11.14),(-8.3,10.40),(-8.3,10.20)]],4.71,0))
 for x,y,z in [(31.7,8.4,7.1),(-28.7,7.4,7.18)]:
  PLATFORMS.append(('platform-105-'+('port' if side==1 else 'starboard')+'-'+{31.7:'forward',-10.4:'middle',-28.7:'aft'}[x],[(xx,side*yy) for xx,yy in (FWD_105 if x>0 else AFT_105)],z,0))
 for x,y,z in [(36,6,9.4),(-26.3,4.5,10.1),(-42.5,5.3,7.2)]:
  rx,ry=(2,1.45) if x==-26.3 else (1.55,1.35)
  PLATFORMS.append(('platform-aa-'+('port' if side==1 else 'starboard')+'-'+str(abs(x)).replace('.','-'),([(xx,side*yy) for xx,yy in AA37] if x==-26.3 else [(xx,side*yy) for xx,yy in AA40] if x==36 else [(x+rx*math.cos(i*math.tau/28),side*y+ry*math.sin(i*math.tau/28)) for i in range(28)]),z,.72))
def install(blueprint):
 ids={p[0] for p in PLATFORMS};blueprint['structures']=[s for s in blueprint['structures'] if s['id'] not in ids and not s['id'].startswith(('platform-','bulwark-'))]
 clear_heights={}
 for id,pts,z,h in PLATFORMS:
  blueprint['structures'].append(dict(id=id,name=id.replace('-',' ').title(),footprint=[[-round(y,5),round(1.3-x,5)] for x,y in pts],baseY=round(z-.15,5),height=.15,material='naval'))
  clear_heights[id]=0
  if not h:continue
  # Curved bulwarks are open annular strips, not filled cylinders. Keeping each
  # strip together also bounds the number of CPU clearance structures.
  if id.startswith('platform-aa-') or id in ['tower-top-gallery','funnel-searchlight-gallery','aft-director-gallery']:
   cx=sum(x for x,y in pts)/len(pts);cy=sum(y for x,y in pts)/len(pts)
   half=len(pts)//2
   arcs=[pts[:half+1],pts[half:]+pts[:1]]
   if id.startswith('platform-aa-'):arcs=[pts[:6] if id.endswith('26-3') else pts[:7] if id.endswith('-36') else arcs[0 if '-port-' in id else 1]]
   thickness=.045 if id.startswith('platform-aa-') else .065
   for i,arc in enumerate(arcs):
    outer=[];inner=[]
    for x,y in arc:
     r=math.hypot(x-cx,y-cy);nx=(x-cx)/r*thickness/2;ny=(y-cy)/r*thickness/2
     outer.append((x+nx,y+ny));inner.append((x-nx,y-ny))
    wid='bulwark-'+id+'-'+str(i+1)
    blueprint['structures'].append(dict(id=wid,name='Bulwark · '+id.replace('-',' '),footprint=[[-round(y,5),round(1.3-x,5)] for x,y in outer+list(reversed(inner))],baseY=z,height=h,material='naval'))
    clear_heights[wid]=0
   continue
  edge_pts=pts
  pairs=list(zip(edge_pts,edge_pts[1:]+edge_pts[:1]))
  if id.startswith('platform-aa-'):
   side=1 if '-port-' in id else -1
   cy=sum(y for x,y in pts)/len(pts)
   pairs=[(a,b) for a,b in pairs if side*((a[1]+b[1])/2-cy)>0]
  thickness=.045 if id.startswith('platform-aa-') else .065
  for i,(a,b) in enumerate(pairs):
   dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
   nx,ny=-dy/length*thickness/2,dx/length*thickness/2
   wall=[(a[0]+nx,a[1]+ny),(b[0]+nx,b[1]+ny),(b[0]-nx,b[1]-ny),(a[0]-nx,a[1]-ny)]
   wid='bulwark-'+id+'-'+str(i+1)
   blueprint['structures'].append(dict(id=wid,name='Bulwark · '+id.replace('-',' '),footprint=[[-round(y,5),round(1.3-x,5)] for x,y in wall],baseY=z,height=h,material='naval'))
   clear_heights[wid]=0
 return clear_heights

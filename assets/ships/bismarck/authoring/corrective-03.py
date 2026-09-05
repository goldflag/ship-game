"""One-time original authoring of bow, turret facets and structural surfaces.

The written blueprint/catalog are build inputs. This script is an audit trail,
not a production dependency. Run once on the preserved iteration-02 blueprint.
Historical raster registration: bsdraw24m.png, 11.8523 px/m. No game mesh input.
"""
import json, math, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
ship=ROOT/'assets/ships/bismarck'
b=json.loads((Path(sys.argv[1]) if len(sys.argv)>1 else ship/'blueprint.json').read_text());h=b['hull']
assert 'structuralPlating' not in b, 'Already corrected; use the preceding blueprint to repeat authoring.'

def pchip(table,x):
 xs,ys=zip(*table);n=len(xs);hs=[b-a for a,b in zip(xs,xs[1:])];ds=[(b-a)/h for a,b,h in zip(ys,ys[1:],hs)];ms=[0.]*n
 for i in range(1,n-1):
  if ds[i-1]*ds[i]>0:
   w1=2*hs[i]+hs[i-1];w2=hs[i]+2*hs[i-1];ms[i]=(w1+w2)/(w1/ds[i-1]+w2/ds[i])
 def edge(h0,h1,d0,d1):
  m=((2*h0+h1)*d0-h0*d1)/(h0+h1)
  return 0 if m*d0<=0 else math.copysign(min(abs(m),3*abs(d0)),m) if d0*d1<=0 else m
 ms[0]=edge(hs[0],hs[1],ds[0],ds[1]);ms[-1]=edge(hs[-1],hs[-2],ds[-1],ds[-2])
 i=next((i for i in range(n-1) if xs[i]<=x<=xs[i+1]),n-2);t=(x-xs[i])/hs[i]
 return (2*t**3-3*t*t+1)*ys[i]+(t**3-2*t*t+t)*hs[i]*ms[i]+(-2*t**3+3*t*t)*ys[i+1]+(t**3-t*t)*hs[i]*ms[i+1]

old=h['sections']
def section(s):
 a,c=next((a,c) for a,c in zip(old,old[1:]) if a['station']<=s<=c['station']);t=(s-a['station'])/(c['station']-a['station'])
 return [[x+(y-x)*t for x,y in zip(p,q)] for p,q in zip(a['points'],c['points'])]

# The old waterline endpoints (6 and 247.55 m) gave the right total length but
# a wrong distribution of overhang. Register the curved stem at 244.2 m and
# counter at 2.65 m, keeping the documented 241.55 m waterline length. The
# technical reconstruction differs by ~1 m depending on depicted load/datum.
stem=[(225,-9.33),(237,-9.33),(240,-9.33),(241.7,-9.33),(242.15,-9.15),(242.45,-8.6),(242.6,-7.8),(242.65,-6.65),(242.85,-5.8),(243.2,-4.5),(243.6,-2.5),(244.2,0),(244.6,1.5),(245.3,3.45),(246.4,5.4),(248.1,7.35),(249.6,8.9),(250.5,9.3)]
sheer=[(210,section(210)[-1][1]),(225,8.0),(235,8.6),(240,8.88),(245,9.12),(250.5,9.3)]
stations=sorted(set([s['station'] for s in old]+[s for s,y in stem]+[2.65]+[240+i*.2 for i in range(53)]))
rows=[]
for s in stations:
 p=section(s);base=p[0][1];deck=p[-1][1];newbase=base;newdeck=deck
 if s>=225:newbase=pchip(stem,s)
 if s>=210:newdeck=pchip(sheer,s)
 if s<16:
  remap=pchip([(0,0),(2.65,6),(16,16),(20,20)],s);newbase=section(remap)[0][1]
 updated=[]
 for i,(w,y) in enumerate(p):
  if y<=0 and base<0:
   yy=newbase+(y-base)/(-base)*(max(0,newbase)-newbase)
  else:
   low=max(0,base);fraction=(y-low)/max(1e-8,deck-low)
   lownew=newbase if base>=0 else max(0,newbase)
   yy=lownew+fraction*(newdeck-lownew)
  if i==0:yy=newbase
  ww=w
  if s>=225:
   blend=max(0,min(1,(s-225)/16.7))
   factor=max(0,(244.2-s)/max(.001,247.55-s))**.65 if s<244.2 else 0
   if i<=16:
    ww=w*((1-blend)+blend*factor)
    if s>240 and i<5:ww*=max(0,(241.7-s)/1.7)
   else:
    waterwidth=p[16][0]*factor
    flare=waterwidth+(p[-1][0]-waterwidth)*max(0,(yy-max(0,newbase))/max(.00001,newdeck-max(0,newbase)))**.90
    ww=w*(1-blend)+flare*blend
  if newbase>=0 and i<=16:ww=0;yy=newbase
  if i==0:ww=0
  if s==250.5:ww=0;yy=9.3
  updated.append([round(max(0,ww),6),round(yy,6)])
 for i in range(1,len(updated)):updated[i][1]=max(updated[i][1],updated[i-1][1])
 rows.append({'station':round(s,6),'points':updated})
h['sections']=rows
for key,index,axis in [('halfBreadths',-1,0),('deckHeights',-1,1),('keelHeights',0,1)]:h[key]=[[s['station'],s['points'][index][axis]] for s in rows]
b['structuralPlating']={'hullMm':20,'superstructureMm':8,'note':'Provisional ordinary steel: 20 mm hull shell and 8 mm deckhouse/funnel walls. These are gameplay estimates, not a verified historical plating schedule. Authored surfaces register hits independently of armor; nearby exterior armor takes precedence.'}

def surface(verts,faces):
 triangles=[]
 for f in faces:
  for i in range(1,len(f)-1):triangles.append([f[0],f[i],f[i+1]])
 return {'vertices':[[-y,z,-x] for x,y,z in verts],'triangles':triangles}

# Move the already-authored tower taper and funnel jacket into the blueprint,
# allowing the CPU and Blender to use exactly the same substantive surfaces.
s=next(s for s in b['structures'] if s['id']=='tower-mast-base');pts=[(-z,-x) for x,z in s['footprint']];n=len(pts)
verts=[(13.95+(x-13.95)*scale+dx,y*scale,z) for z,scale,dx in [(s['baseY'],1,0),(20.5,1,0),(23.5,.88,.15),(26.41,.77,.25)] for x,y in pts]
faces=[list(reversed(range(n))),list(range(3*n,4*n))]+[[j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i] for j in range(3) for i in range(n)]
s['surface']=surface(verts,faces)
N=64;fx=-2.4
verts=[(fx+rx*math.cos(math.tau*i/N),ry*math.sin(math.tau*i/N),z+max(0,z-22.85)/2.15*1.12*math.cos(math.tau*i/N)) for z,rx,ry in [(11.52,6,3.65),(22.85,5.55,3.45),(23.75,5.85,3.7),(25,5.72,3.58)] for i in range(N)]
faces=[[j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i] for j in range(3) for i in range(N)]
b['structures'].append({'id':'funnel-jacket','name':'Funnel jacket','footprint':[[-y,-x] for x,y,z in verts[:N]],'baseY':11.52,'height':14.6,'material':'naval','surface':surface(verts,faces)})

# Main gunhouse: near-vertical lower wall, a real shoulder break and a planar
# octagonal roof. Rear overhang and narrower beam come from the registered top
# and profile drawings. The original pivot/barrel axes remain stable.
catalogpath=ROOT/'assets/parts/guns.json';catalog=json.loads(catalogpath.read_text());gun=next(p for p in catalog['parts'] if p['id']=='sk-c34-380-twin')
foot=[(-8.5,-3.55),(-7.05,-4.35),(3.15,-4.35),(5.65,-3.7),(5.65,3.7),(3.15,4.35),(-7.05,4.35),(-8.5,3.55)]
shoulder=[(x-(.3 if x>5 else 0),y,2.10) for x,y in foot]
roof=[(-6.85,-3.20,3.65),(-6.40,-3.35,3.65),(2.40,-3.35,3.65),(2.80,-3.20,3.65),(2.80,3.20,3.65),(2.40,3.35,3.65),(-6.40,3.35,3.65),(-6.85,3.20,3.65)]
verts=[(x,y,.25+max(0,(-x-5)/3.5)*.18) for x,y in foot]+shoulder+roof
faces=[]
def face(ids,name,mm,finish='naval',material='KC'):
 for i in range(1,len(ids)-1):faces.append({'id':name+(['-a','-b'][i-1] if len(ids)==4 else '-'+str(i)),'indices':[ids[0],ids[i],ids[i+1]],'thicknessMm':mm,'material':material,'finish':finish})
for j in range(2):
 for i in range(8):
  mm=(360 if i==3 else 320 if i==7 else 220) if j==0 else (180 if i in [0,2,3,4,6,7] else 150)
  face([j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i],('side-' if j==0 else 'slope-')+str(i),mm)
face(list(range(16,24)),'roof',130,'roof');face(list(reversed(range(8))),'floor',50,material='steel')
gun.pop('gunhouseShape',None);gun['gunhouseMesh']={'version':1,'vertices':verts,'faces':faces,'provenance':{'sourceId':'kb-protection','basis':'estimated','note':'Armor thickness family from the retained protection schematic; original facet geometry interpreted from the registered plan.'}};gun['gunhouseSize']=[14.15,8.7,3.65];gun['rangefinderForward']=-5.15
# Physical moving plates are compiled from these facets, eliminating the old
# separately edited copy and its nonplanar roof fan.
b['armor']=[a for a in b['armor'] if not a.get('plate',{}).get('mountId')]
(ship/'blueprint.json').write_text(json.dumps(b,indent=2)+'\n');catalogpath.write_text(json.dumps(catalog,indent=2)+'\n')
print(len(rows),'hull sections;',len(faces),'facets per main gunhouse; original axes retained')

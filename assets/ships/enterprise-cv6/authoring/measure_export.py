"""Measure the published GLB's actual vertices without Blender or a renderer.

Run after ship:build. This audits scale and datums; it does not certify a ship's
historical configuration or replace comparisons to dated CV-6 evidence.
"""
from pathlib import Path
import json, struct, math

SHIP=Path(__file__).resolve().parents[1]
ROOT=SHIP.parents[2]
data=(ROOT/'public/models/enterprise-cv6.glb').read_bytes()
assert data[:4]==b'glTF'
offset=12
while offset<len(data):
    length,kind=struct.unpack_from('<II',data,offset)
    chunk=data[offset+8:offset+8+length]
    if kind==0x4e4f534a:g=json.loads(chunk)
    if kind==0x004e4942:binary=chunk
    offset+=length+8
definition=json.loads((ROOT/'public/models/enterprise-cv6.json').read_text())

I=[[float(i==j) for j in range(4)] for i in range(4)]
def multiply(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def local(node):
    if 'matrix' in node:return [[node['matrix'][j*4+i] for j in range(4)] for i in range(4)]
    x,y,z,w=node.get('rotation',[0,0,0,1]);s=node.get('scale',[1,1,1]);t=node.get('translation',[0,0,0])
    m=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0],
       [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0],
       [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0],[0,0,0,1]]
    for i in range(3):
        for j in range(3):m[i][j]*=s[j]
        m[i][3]=t[i]
    return m
world={}
def visit(index,parent):
    node=g['nodes'][index];world[index]=multiply(parent,local(node))
    for child in node.get('children',[]):visit(child,world[index])
for index in g['scenes'][g.get('scene',0)]['nodes']:visit(index,I)

def accessor(index):
    a=g['accessors'][index];v=g['bufferViews'][a['bufferView']]
    code,size={5121:('B',1),5123:('H',2),5125:('I',4),5126:('f',4)}[a['componentType']]
    width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',width*size)
    return [struct.unpack_from('<'+code*width,binary,start+i*stride) for i in range(a['count'])]
def transformed(points,m):
    return [tuple(sum(m[i][j]*p[j] for j in range(3))+m[i][3] for i in range(3)) for p in points]
def primitives(index):
    node=g['nodes'][index]
    if 'mesh' in node:
        for primitive in g['meshes'][node['mesh']]['primitives']:
            points=transformed(accessor(primitive['attributes']['POSITION']),world[index])
            indices=[p[0] for p in accessor(primitive['indices'])] if 'indices' in primitive else list(range(len(points)))
            yield points,indices
    for child in node.get('children',[]):yield from primitives(child)
def find(id):
    return next(i for i,n in enumerate(g['nodes']) if n.get('extras',{}).get('nodeId')==id)
def points(id):return [p for vertices,_ in primitives(find(id)) for p in vertices]
def bounds(id):
    p=points(id);return [[f(v[a] for v in p) for a in range(3)] for f in [min,max]]
def breadth_at_y(id,y):
    crossings=[]
    ids=[id] if isinstance(id,str) else id
    for vertices,indices in (p for id in ids for p in primitives(find(id))):
        for i in range(0,len(indices),3):
            triangle=[vertices[n] for n in indices[i:i+3]]
            for a,b in zip(triangle,triangle[1:]+triangle[:1]):
                if min(a[1],b[1])<=y<=max(a[1],b[1]) and abs(b[1]-a[1])>1e-9:
                    t=(y-a[1])/(b[1]-a[1]);crossings.append(a[0]+(b[0]-a[0])*t)
    return max(crossings)-min(crossings)
def top_at(id,x,z):
    # Vertical intersection with actual exported triangles at a plan position.
    heights=[]
    for vertices,indices in primitives(find(id)):
        for i in range(0,len(indices),3):
            a,b,c=[vertices[n] for n in indices[i:i+3]]
            denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
            if abs(denominator)<1e-10:continue
            u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/denominator
            v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/denominator
            w=1-u-v
            if min(u,v,w)>=-1e-6:heights.append(u*a[1]+v*b[1]+w*c[1])
    return max(heights)

FT=.3048;draft=definition['hull']['draft'];rows=[]
def record(name,actual,reference,basis,unit='m'):
    rows.append(dict(measurement=name,actual=actual,reference=reference,difference=actual-reference,unit=unit,evidence=basis))
hb=bounds('hull.surface');deck=bounds('flight-deck.surface')
record('Steel hull length',hb[1][2]-hb[0][2],809.5*FT,'NHHC CV-6 DANFS dimensional header; loading/configuration must be distinguished')
record('Maximum upper molded hull breadth',hb[1][0]-hb[0][0],92*FT,'CV-5 1940 C&R 216500 main-deck molded breadth; class evidence')
record('Reference keel depth below Y=0',-hb[0][1],draft,'Declared full-load datum; actual Midway draft not established')
record('Flight-deck longitudinal extent',deck[1][2]-deck[0][2],802*FT,'NavSource as-built reference; CV-6 perimeter needs an independently matched plan')
record('Flight-deck maximum lateral extent',deck[1][0]-deck[0][0],86*FT,'NavSource as-built reference; excludes projecting galleries')
record('Flight-deck centerline height above baseline',top_at('flight-deck.surface',0,0)+draft,80*FT,'C&R 189525 annotated 80 ft molded; small wood allowance and as-built confirmation remain open')
record('Flight-deck camber fall at 10 m off centerline',top_at('flight-deck.surface',0,0)-top_at('flight-deck.surface',-10,0),(4/12*FT)*(10/(46*FT))**2,'C&R 189525: 4 inches in 92 feet; parabolic reconstruction between datums')
for name in ['forward','middle','aft']:
    b=bounds('elevator-'+name+'.surface')
    record(name.title()+' elevator length',b[1][2]-b[0][2],48*FT,'Class plan and as-built specifications')
    record(name.title()+' elevator width',b[1][0]-b[0][0],44*FT,'Class plan and as-built specifications')
for id,feet in [('communications-walkway',87),('flag-walkway',94.5),('navigation-wings',102),('bridge-roof',109.5),('pilot-roof',111.75),('funnel-cap',129.875),('fighting-platform',135.5),('fighting-roof',145.75)]:
    b=bounds(id+'.surface')
    record(id+' elevation above reference baseline',b[1][1]+draft,feet*FT,'C&R 189526 / CV-5 1940 C&R 216500 annotations; see contract/as-built differences')
record('Molded shell at class design waterline',breadth_at_y('hull.surface',(24+5.5/12)*FT-draft),(82+3.5/12)*FT,'CV-5 1940 molded breadth; NOT outside plating')
exterior=['hull.surface','hull.side-belt-port','hull.side-belt-starboard']
record('Exterior belt at class design waterline',breadth_at_y(exterior,(24+5.5/12)*FT-draft),(83+.75/12)*FT,'CV-5 over-plating beam; original contract molded loft plus 4-inch armor and inferred 5/8-inch shell allowance')
record('Exterior belt versus CV-6 published beam',breadth_at_y(exterior,(24+5.5/12)*FT-draft),(83+1/12)*FT,'NHHC CV-6 beam: class DWL used for measurement; as-built plating and loading still need reconciliation')
rudder_axis=world[find('rudder.yaw')]
AP=definition['hull']['length']/2-18.75*FT-770*FT
record('Rudder axis forward of AP',-rudder_axis[2][3]-AP,46*FT,'CV-5 1940 C&R 216500 explicit rudder axis datum; CV-6 corroboration open')
area=0
for vertices,indices in primitives(find('rudder.yaw')):
    for i in range(0,len(indices),3):
        a,b,c=[vertices[n] for n in indices[i:i+3]]
        area+=abs((b[1]-a[1])*(c[2]-a[2])-(c[1]-a[1])*(b[2]-a[2]))/4
record('Rudder projected side area',area,397*FT*FT,'CV-5 1940 area annotation; horn profile fitted from scanned drawing','m²')
report=dict(contentHash=definition['contentHash'],method='Actual GLB POSITION accessors, scene transforms and indexed triangles; no declared accessor bounds',
            historicalAccuracy='Not certified. Exact model dimensions do not close configuration, shape or source gaps.',measurements=rows)
(SHIP/'reports/dimensions.json').write_text(json.dumps(report,indent=2)+'\n')
for row in rows:print(f"{row['measurement']}: {row['actual']:.6f} {row['unit']}; reference {row['reference']:.6f}; difference {row['difference']:+.6f}")

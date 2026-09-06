"""Original fleet authoring record, revision 1. Run explicitly, never during builds.

Reads the preserved pre-pass blueprints and original catalog. It records the
result as versioned blueprint/component data. No game geometry or textures.
See each vessel's source/discrepancy registers for evidence and estimated values.
"""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SHIPS = ROOT / 'assets/ships'

def save(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')

def lerp(table, x):
    for (a, va), (b, vb) in zip(table, table[1:]):
        if a <= x <= b and b > a:
            return va + (vb-va)*(x-a)/(b-a)
    return table[0][1] if x <= table[0][0] else table[-1][1]

def smooth(table, x):
    """Monotone cubic interpolation, retaining every measured anchor."""
    if x <= table[0][0]: return table[0][1]
    if x >= table[-1][0]: return table[-1][1]
    d=[(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(table,table[1:])]
    slopes=[d[0]]+[0 if a*b<=0 else 2*a*b/(a+b) for a,b in zip(d,d[1:])]+[d[-1]]
    for i,((a,va),(b,vb)) in enumerate(zip(table,table[1:])):
        if a<=x<=b:
            t=(x-a)/(b-a)
            return (2*t**3-3*t*t+1)*va+(t**3-2*t*t+t)*(b-a)*slopes[i]+(-2*t**3+3*t*t)*vb+(t**3-t*t)*(b-a)*slopes[i+1]

def surface(vertices, faces):
    return dict(vertices=[[-y,z,-x] for x,y,z in vertices],
                triangles=[[f[0],f[i],f[i+1]] for f in faces for i in range(1,len(f)-1)])

def outline(x,y,length,width,cut=.3):
    a,b=length/2,width/2;c=min(a,b)*cut
    if not cut:return [(x-a,y-b),(x+a,y-b),(x+a,y+b),(x-a,y+b)]
    return [(x-a+c,y-b),(x+a-c,y-b),(x+a,y-b+c),(x+a,y+b-c),
            (x+a-c,y+b),(x-a+c,y+b),(x-a,y+b-c),(x-a,y-b+c)]

def ellipse(x,y,rx,ry,n=32):
    return [(x+rx*math.cos(i*math.tau/n),y+ry*math.sin(i*math.tau/n)) for i in range(n)]

def structure(b,id,name,points,base,top,material='naval',surf=None):
    s=dict(id=id,name=name,footprint=[[-y,-x] for x,y in points],baseY=base,height=top-base,material=material)
    if surf:s['surface']=surf
    b.setdefault('structures',[]).append(s)
    return s

def loft(b,id,name,rings,material='naval',caps=True):
    n=len(rings[0]);v=[p for ring in rings for p in ring]
    f=[[j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i] for j in range(len(rings)-1) for i in range(n)]
    if caps:f += [list(reversed(range(n))),list(range(len(v)-n,len(v)))]
    return structure(b,id,name,[(x,y) for x,y,z in rings[0]],min(p[2] for p in v),max(p[2] for p in v),material,surface(v,f))

def wall(b,id,name,points,z,height,thick=.075,deck=.18):
    # Combined open gallery: its central air volume never becomes a hit box.
    cx=sum(x for x,y in points)/len(points);cy=sum(y for x,y in points)/len(points)
    inner=[(x-(x-cx)*thick/math.hypot(x-cx,y-cy),y-(y-cy)*thick/math.hypot(x-cx,y-cy)) for x,y in points]
    n=len(points)
    v=[(x,y,zz) for ring,zz in [(points,z),(points,z+deck+height),(inner,z+deck+height),(inner,z+deck)] for x,y in ring]
    f=[list(reversed(range(n))),list(range(3*n,4*n))]
    for i in range(n):
        j=(i+1)%n
        f += [[i,j,n+j,n+i],[n+i,n+j,2*n+j,2*n+i],[2*n+i,2*n+j,3*n+j,3*n+i]]
    return structure(b,id,name,points,z,z+deck+height,'naval',surface(v,f))

def plate(b,id,name,verts,mm,source,material='steel',exterior=False,note='Thickness family retained; reconstructed extent and local plate boundaries remain estimates.'):
    # Split quads when their four corners do not share a plane. This preserves
    # the actual loft curvature instead of substituting a box for a belt.
    if len(verts)==4:
        a,u,v=verts[0],[verts[1][i]-verts[0][i] for i in range(3)],[verts[2][i]-verts[0][i] for i in range(3)]
        normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        if abs(sum(normal[i]*(verts[3][i]-a[i]) for i in range(3)))>1e-7:
            for k,ids in enumerate([[0,1,2],[0,2,3]]):plate(b,id+'-'+str(k),name,[verts[i] for i in ids],mm,source,material,exterior,note)
            return
    lo=[min(p[i] for p in verts) for i in range(3)];hi=[max(p[i] for p in verts) for i in range(3)]
    b['armor'].append(dict(id=id,name=name,center=[(a+c)/2 for a,c in zip(lo,hi)],size=[max(.001,c-a) for a,c in zip(lo,hi)],thicknessMm=mm,
        plate=dict(vertices=verts,material=material,exterior=exterior),provenance=dict(sourceId=source,basis='estimated',note=note)))

def width(h,s,y):
    for a,c in zip(h['sections'],h['sections'][1:]):
        if a['station']<=s<=c['station']:
            t=(s-a['station'])/(c['station']-a['station'])
            p=[[aa+(cc-aa)*t for aa,cc in zip(v,w)] for v,w in zip(a['points'],c['points'])]
            candidates=[max(wa,wb) if abs(yb-ya)<1e-8 else wa+(wb-wa)*(y-ya)/(yb-ya) for (wa,ya),(wb,yb) in zip(p,p[1:]) if ya-1e-8<=y<=yb+1e-8]
            return max(candidates,default=0)
    return 0

def belts(b,aft,fore,bottom,top,mm,source,offset=.01):
    h=b['hull'];L=h['length']
    xs=sorted({aft,fore,*[r['station']-L/2 for r in h['sections'] if aft<r['station']-L/2<fore]})
    # Keep about 5 m plate strips; sample hull at each boundary.
    xs=[xs[0]]+[x for i,x in enumerate(xs[1:-1]) if i%3==0]+[xs[-1]]
    for side in [-1,1]:
        for i,(a,c) in enumerate(zip(xs,xs[1:])):
            verts=[[side*(width(h,x+L/2,y)+offset),y,-x] for x,y in [(a,bottom),(c,bottom),(c,top),(a,top)]]
            plate(b,f'belt-{side}-{i}',('Starboard' if side>0 else 'Port')+' main belt',verts,mm,source,exterior=True)
    for label,x in [('forward',fore),('aft',aft)]:
        w=min(width(h,x+L/2,bottom),width(h,x+L/2,top))
        plate(b,'citadel-'+label,label.title()+' armored transverse bulkhead',[[-w,bottom,-x],[w,bottom,-x],[w,top,-x],[-w,top,-x]],mm,source)

def barbette(b,m,r,base,top,mm,source):
    x,y,z=m['position']
    for i in range(20):
        a=i*math.tau/20;c=(i+1)*math.tau/20
        plate(b,m['id']+'-barbette-'+str(i),m['name']+' barbette',[[x+r*math.cos(t),h,z+r*math.sin(t)] for t,h in [(a,base),(c,base),(c,top),(a,top)]],mm,source)

def gunhouse(g,rings,source,front,side,rear,roof,floor=12):
    n=len(rings[0]);v=[p for row in rings for p in row];faces=[]
    def facet(ids,id,mm,finish='naval'):
        for i in range(1,len(ids)-1):faces.append(dict(id=id+'-'+str(i),indices=[ids[0],ids[i],ids[i+1]],thicknessMm=mm,material='steel',finish=finish))
    for j in range(len(rings)-1):
        for i in range(n):
            # The octagonal outline runs from aft-port around the front to aft.
            role='front' if i in [2,3,4] else 'rear' if i in [0,6,7] else 'side'
            mm={'front':front,'rear':rear,'side':side}[role]
            facet([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i],f'{role}-{j}-{i}',mm)
    facet(list(range(len(v)-n,len(v))),'roof',roof,'roof')
    facet(list(reversed(range(n))),'floor',floor)
    g.pop('gunhouseShape',None)
    g['gunhouseMesh']=dict(version=1,vertices=v,faces=faces,provenance=dict(sourceId=source,basis='estimated',note='Original enclosure from retained section/photo evidence. Plate families are provisional where the primary plate schedule is absent; no uniform gunhouse box is added.'))

def yamato(b):
    h=b['hull'];L=h['length'];rows=[]
    # Independent constant-station reconstruction of the recurve and bulb.
    # O-45 and S-06-2 support the form, not exact offsets. Trial LWL stays 256 m.
    bow=[(-10.4,257),(-10,259),(-9.2,260.2),(-8,260.6),(-6.5,260),(-4,257.7),(-2,256.35),(0,256),(2,256.8),(4,258.2),(6,260.1),(8,262),(9.4,263)]
    base=[(0,-2.2),(4,-2.8),(11,-4.5),(20,-7.1),(30,-9.2),(45,-10.4),(257,-10.4),(259,-10),(260.2,-9.2),(260.6,-8),(260.7,6.6),(262,8),(263,9.4)]
    stations=sorted({round(L*i/210,6) for i in range(211)}|{s for k in ['halfBreadths','deckHeights','keelHeights'] for s,v in h[k]}|{s for y,s in bow}|{s for s,y in base}|{round(249+i*.2,6) for i in range(71)}|{round(L/2+x,6) for x in [-116.5,-116.3,-116,-115.5,-114.8,-83.2,-82.5,-82,-81.7,-81.5]})
    def root(s,a,c):
        rising=smooth(bow,c)>smooth(bow,a)
        for _ in range(45):
            mid=(a+c)/2
            if (smooth(bow,mid)<s)==rising:a=mid
            else:c=mid
        return (a+c)/2
    for s in stations:
        deck=lerp(h['deckHeights'],s)
        stem=root(s,0,9.4) if s>256 else 0
        if s>260.6:k=mid=upper=stem
        else:
            k=root(s,-10.4,-8) if s>257 else lerp(base,s)
            upper=root(s,-8,0) if s>256 else 0
            mid=max(k,min(-8,upper))
        # Explicit roots keep the recurved stem smooth. The gap from the bulb
        # to the upper stem has zero breadth, never a centerline filler face.
        ys=[k+(mid-k)*i/10 for i in range(11)]+[mid+(upper-mid)*i/12 for i in range(1,13)]+[stem]+[stem+(deck-stem)*i/12 for i in range(1,13)]
        x=s-L/2;cap=max(0,abs(x+99)-15.8)
        reach=math.sqrt(max(0,1.7**2-cap**2)) if cap<1.7 else 0
        low,high=4.2-reach,4.2+reach
        ys+= [max(k,min(deck,v)) for v in [low,low+min(.04,reach),high-min(.04,reach),high]]
        ys.sort();wl=max(0,k)
        pts=[]
        for i,y in enumerate(ys):
            cut=L-smooth(bow,y);f=max(0,min(1,(s-L/2-65)/60))**5
            source_s=min(L,s+cut*f)
            w=smooth(h['halfBreadths'],source_s)
            fore=max(0,min(1,(source_s-L/2-65)/60))
            ratio=lerp([(-10.4,0),(-10.28,.65),(-9.672,.84),(-8.216,.948),(-5.72,.996),(-2.912,.986),(0,36.9/38.9),(4.7684,.975),(8.515,1)],y)
            if y<0 and k>-10.4:ratio=lerp([(0,0),(.10,.65),(.22,.85),(.45,.975),(1,36.9/38.9)],(y-k)/max(.001,-k))
            if y>0:ratio=lerp([(0,36.9/38.9),(.56,.975),(1,1)],(y-wl)/max(.001,deck-wl))
            if s>225 and y<0:ratio*=1-fore*.16*min(1,-y/6)
            if s>=smooth(bow,y)-1e-6 and s>250:w=0
            if i==0:w=0
            w=max(0,min(h['beam']/2,w*ratio))
            if reach>.01 and low+.001<y<high-.001:w=min(w,11)
            pts.append([round(w,6),round(y,6)])
        rows.append(dict(station=s,points=pts))
    h['sections']=rows
    for key,index,axis in [('keelHeights',0,1),('deckHeights',-1,1)]:h[key]=[[s['station'],s['points'][index][axis]] for s in rows]
    b['structures']=[]
    def bridge(x,sx,sy):return [(x+a*sx,c*sy) for a,c in [(-.5,-.35),(-.39,-.5),(.10,-.5),(.33,-.43),(.5,-.23),(.5,.23),(.33,.43),(.10,.5),(-.39,.5),(-.5,.35)]]
    structure(b,'central-shelter','Central shelter deck',outline(-19,0,55,21.5,.2),8.515,10.8)
    for id,x,sx,sy,z,top in [('bridge-foundation',-3.2,13.8,14.3,10.8,18.2),('bridge-trunk',-3,11,10.5,18.2,24.8),('operations-tower',-3.6,8,8.5,24.8,31.2)]:
        points=bridge(x,sx,sy)
        # Gradual inward taper follows the tower rather than stacking boxes.
        loft(b,id,id.replace('-',' ').title(),[[(xx,yy,z) for xx,yy in points],[(x+(xx-x)*.92,yy*.93,top) for xx,yy in points]])
    structure(b,'conning-tower','Forward conning tower',ellipse(3,0,4.2*.86,4.2,48),11,16.2)
    structure(b,'first-bridge','First navigating bridge',bridge(-3.5,9.5,11.8),31.1,32.8)
    for id,x,z,sx,sy,hh in [('lower-lookout',-1.5,18.3,17.8,16.6,.95),('second-lookout',-2.3,22,14.3,14.2,1),('air-defense',-3.5,32.8,10.1,12.2,1.25)]:
        wall(b,id,id.replace('-',' ').title(),bridge(x,sx,sy),z,hh)
    structure(b,'aft-director-foundation','Aft director foundation',outline(-39,0,9,10,.2),10.8,15.4)
    for id,x,r,z,top in [('aft-director-column',-38.6,2.4,15.35,20.85),('aft-director-head',-38.6,2.05,20.85,24.75),('main-director-drum',-3.5,3.1,33.95,36.25),('main-director-head',-3.2,1.8,36.25,38.5)]:structure(b,id,id.replace('-',' ').title(),ellipse(x,0,r,r,40),z,top)
    funnel=[(11,-19.1,8.2,4.65),(13,-19.8,7.9,4.55),(15,-21,6.8,4.35),(17,-22.1,5.7,4.1),(20,-23.1,4.55,3.9),(24,-24.35,4.15,3.72),(28,-25.55,4.1,3.6),(30.4,-26.25,4.05,3.55)]
    loft(b,'funnel-jacket','Curved funnel jacket',[[(x+rx*math.cos(i*math.tau/48),ry*math.sin(i*math.tau/48),z+(.25*rx*math.cos(i*math.tau/48) if j==7 else 0)) for i in range(48)] for j,(z,x,rx,ry) in enumerate(funnel)],caps=False)
    for sign in [-1,1]:
        for i,x in enumerate([-9,-19.5,-30]):structure(b,f'ha-sponson-{sign}-{i}','127 mm sponson',ellipse(x,sign*12.1,3.05,3.05,32),8.2,13.3)
        # Continuous outboard AA gallery beneath the late triple-gun row.
        pts=[(-42,sign*11),(-38,sign*16),(-33,sign*20.2),(-8,sign*20.2),(2,sign*15.4),(3,sign*10.5)]
        if sign<0:pts.reverse()
        structure(b,f'aa-gallery-{sign}','Late AA outer gallery',pts,8.55,8.88,'roof')
        for i,x in enumerate([-105,-98]):structure(b,f'quarter-sponson-{sign}-{i}','Quarterdeck AA sponson',outline(x,sign*12.5,5.5,7,.2),5.7,6.45)
    b['armor']=[]
    belts(b,-74,66,-3.1,5.25,410,'usni-design-1953')
    plate(b,'armored-deck','Main armored deck',[[-15,5.2,74],[15,5.2,74],[15,5.2,-66],[-15,5.2,-66]],200,'usni-design-1953')
    for m in b['mounts']:
        if m['battery']=='main':barbette(b,m,7.1,-1,m['position'][1]+2.15,560,'usni-design-1953')

def baltimore(b):
    # Round the section segments while retaining all 120 original stations and
    # all 13 original cross-section anchor pairs (class, not as-built evidence).
    for row in b['hull']['sections']:
        old=row['points'];row['points']=[[round(smooth(list(enumerate([p[k] for p in old])),i/3),6) for k in range(2)] for i in range((len(old)-1)*3+1)]
    for id,x,top in [('forward-funnel',3.8,23.2),('after-funnel',-15.6,22)]:
        loft(b,id,id.replace('-',' ').title(),[[(x+dx+rx*math.cos(i*math.tau/40),ry*math.sin(i*math.tau/40),z) for i in range(40)] for z,dx,rx,ry in [(7.8,0,4.1,3.1),(10,0,3.4,2.55),(top,-1.25,3.4,2.55)]],caps=False)
    structure(b,'conning-tower','Armored conning tower',ellipse(23,0,2.75,2.4),7.8,12)
    for sign in [-1,1]:
        for i,(x,y,z) in enumerate([(45,7.5,6.1),(26,8.1,8),(-28,8,7.9),(-50,7.1,5.8),(-68,7.1,6)]):
            wall(b,f'aa-platform-{sign}-{i}','40 mm gallery and splinter tub',ellipse(x,sign*y,2.2,2.2,32),z-.2,1.04,.065,.2)
    b['armor']=[]
    belts(b,-64.5,64.5,-3.05,1.45,152.4,'fidelity-provisional-protection')
    plate(b,'armored-deck','Protective deck',[[-9.2,2.9,64.5],[9.2,2.9,64.5],[9.2,2.9,-64.5],[-9.2,2.9,-64.5]],63.5,'fidelity-provisional-protection')
    for m in b['mounts']:
        if m['battery']=='main':barbette(b,m,3.65,2.9,m['position'][1],152.4,'fidelity-provisional-protection')

def enterprise(b):
    # Identical arc-length sampling to the preceding original visual recipe.
    # The common 48-point count keeps the preceding rendered loft. Not every
    # original corner is a sample: CSV and pre-pass polylines remain preserved,
    # and this interpolation is explicitly an approximation, not new offsets.
    rows=b['hull']['sections']
    for row in rows:
        ds=[0]
        for a,c in zip(row['points'],row['points'][1:]):ds.append(ds[-1]+math.dist(a,c))
        row['_distance']=ds
    fractions=[i/47 for i in range(48)]
    for row in rows:
        ds=row.pop('_distance');p=row['points']
        row['points']=[[lerp(list(zip(ds,[v[k] for v in p])),ds[-1]*t) for k in range(2)] for t in fractions]
    # The prior terminal 2 mm width was a numerical cap aid, not a transcribed
    # offset. Exact centerline tips remove slender cap fans and keep end datums.
    for row in [rows[0],rows[-1]]:
        for p in row['points']:p[0]=0
    # Keep all original longitudinal stations; interpolation remains linear.
    b['armor']=[];h=b['hull'];L=h['length'];FT=.3048
    frame=lambda n:L/2-18.75*FT-n*4*FT
    level=lambda f:f*FT-h['draft']
    # C&R 189523 + CV-5 BGP: thin exterior belt, separate from the flight deck.
    bands=[(18.375+i,19.375+i,63.5+(i+.5)*9.525) for i in range(4)]+[(22.375,27.5,101.6)]
    for index,(lo,hi,mm) in enumerate(bands):
        start=len(b['armor']);belts(b,frame(162),frame(35),level(lo),level(hi),mm,'cv6-contract-1934',offset=.015875+mm/1000)
        for a in b['armor'][start:]:
            a['id']='band-'+str(index)+'-'+a['id']
            a['provenance']['note']='C&R 189523: lower 4 ft tapers 2.5 to 4 inches. Four one-foot bands use midpoint thickness (maximum local error 4.763 mm); upper band is 4 inches. Extent and end closures reconstructed from class frame evidence.'
    plate(b,'protective-deck','Protective deck',[[-11.5,2.1,74],[11.5,2.1,74],[11.5,2.1,-74],[-11.5,2.1,-74]],38.1,'cv5-asbuilt-1940')
    S={s['id']:s for s in b['structures']};FLIGHT=S['flight-deck']['baseY']+S['flight-deck']['height'];MAIN=S['hangar-deck']['baseY']+S['hangar-deck']['height'];gallery=FLIGHT-7.5*FT
    for side,y in [('port',10.1),('starboard',-10.1)]:
        for i,(a,c) in enumerate([(-90,-69),(-34,31),(67,75)]):structure(b,f'hangar-wall-{side}-{i}','Hangar side plating',outline((a+c)/2,y,c-a,.15,0),MAIN,gallery)
        structure(b,f'gallery-wall-{side}','Enclosed gallery side',outline(-7.5,y,166.4,.16,0),gallery,FLIGHT-.3)
        for i,(a,c) in enumerate([(-69,-34),(31,67)]):
            for j,x in enumerate([a,a+5,c-5,c]):structure(b,f'portal-{side}-{i}-{j}','Open hangar portal frame',outline(x,y,.25,.27,0),MAIN,gallery)
        for i,(a,c,edge) in enumerate([(-69,-34,14.2),(31,67,14.2),(-121,-109,13.1)]):structure(b,f'aa-gallery-{side}-{i}','20 mm gallery deck',outline((a+c)/2,math.copysign(edge,y),c-a,1.65,0),FLIGHT-.915,FLIGHT-.685,'steel-deck')
    funnel=S['funnel'];n=len(funnel['footprint'])
    v=[(-z,-x,funnel['baseY']) for x,z in funnel['footprint']]+[(-z,-x,S['funnel-cap']['baseY']+.12) for x,z in S['funnel-cap']['footprint']]
    funnel['surface']=surface(v,[[i,(i+1)%n,(i+1)%n+n,i+n] for i in range(n)])

def contain_spaces(b):
    # Existing room proxies have corners outside narrowed hull ends. Shrink only
    # as needed, recording gameplay envelopes rather than claiming new plans.
    h=b['hull']
    for c in b['compartments']:
        for attempt in range(100):
            valid=True
            for z in [c['center'][2]-c['size'][2]/2,c['center'][2]+c['size'][2]/2]:
                s=h['length']/2-z
                keel=lerp([(r['station'],r['points'][0][1]) for r in h['sections']],s)
                deck=lerp([(r['station'],r['points'][-1][1]) for r in h['sections']],s)
                for y in [c['center'][1]-c['size'][1]/2,c['center'][1]+c['size'][1]/2]:
                    if y<keel or y>deck or abs(c['center'][0])+c['size'][0]/2>width(h,s,y)-.08:valid=False
            if valid:break
            c['size']=[v*.97 for v in c['size']]
        if not valid:raise ValueError('Room center outside hull: '+c['id'])
        c['capacityM3']=min(c['capacityM3'],math.prod(c['size'])*.68)
        for m in b['modules']:
            if m['compartmentId']==c['id']:
                for k in range(3):
                    m['size'][k]=min(m['size'][k],c['size'][k]*.9)
                    reach=(c['size'][k]-m['size'][k])/2
                    m['center'][k]=max(c['center'][k]-reach,min(c['center'][k]+reach,m['center'][k]))

def interior(b):
    """Qualified arrangement, not hydrostatics or a complete subdivision plan."""
    rooms={r['id']:r for r in b['compartments']};modules={m['id']:m for m in b['modules']}
    def room(id,name,center,size):
        r=dict(id=id,name=name,center=center,size=size,capacityM3=math.prod(size)*.68,pumpM3PerSecond=.035)
        if id in rooms:rooms[id].update(r)
        else:b['compartments'].append(r);rooms[id]=r
        return r
    def module(id,name,compartment,center,size,hp):
        m=dict(id=id,name=name,kind='engine',compartmentId=compartment,center=center,size=size,hp=hp)
        if id in modules:modules[id].update(m)
        else:b['modules'].append(m);modules[id]=m
    if b['id']=='yamato':
        for i in range(1,4):
            m=modules['magazine-'+str(i)];z=m['center'][2]
            room(m['compartmentId'],f'No. {i} powder magazine (lower)',[0,-5.7,z],[14,4,18])
            m.update(name=f'No. {i} propellant magazine',center=[0,-5.7,z],size=[12,3,15])
            room(f'shell-room-{i}',f'No. {i} shell room (above powder)',[0,-.8,z],[14,5,18])
        # S-06-2 machinery arrangement + four-turbine primary account. Exact
        # transverse walls, boiler auxiliaries and local boundaries are estimates.
        for side,x in [('port',-9),('starboard',9)]:
            for suffix,z,length in [('',34,16),('-aft',47,10)]:
                id='engine-'+side+suffix;rid=id+'-space'
                room(rid,side.title()+(' after' if suffix else ' forward')+' turbine room',[x,-5,z],[9,7,length])
                module(id,side.title()+(' after' if suffix else ' forward')+' turbines',rid,[x,-5,z],[7,5,length-2],90)
        for row,z in enumerate([-.5,8.5,17.5]):
            for column,x in enumerate([-12,-4,4,12]):room(f'boiler-{row+1}-{column+1}',f'Boiler room {row+1}/{column+1}',[x,-5,z],[6.8,6.8,8])
    if b['id']=='baltimore':
        for rid,mid,z,length in [('forward-machinery','engine-forward',-3,17),('aft-machinery','engine-aft',27,14)]:
            room(rid,('Forward' if z<0 else 'After')+' turbine unit',[0,-1.8,z],[15,8,length])
            modules[mid].update(center=[0,-1.8,z],size=[12,6,length-2])
        for id,z,length in [('boiler-unit-forward',-20,15),('boiler-unit-aft',14,10)]:room(id,id.replace('-',' ').title(),[0,-1.8,z],[15,8,length])
    if b['id']=='enterprise-cv6':
        # The inherited Y=-2.7 m box sat below the rising counter. Steering
        # machinery is over the retained rudder stock, inside the afterbody.
        room('steering-space','Steering machinery above rudder stock',[0,4,102],[6,3,10])
        modules['steering-space-module'].update(center=[0,4,102],size=[4,2,7])
    # End spaces admit local flooding instead of assigning every bow hole to
    # a distant magazine. Bounds follow the hull; capacities remain gameplay.
    h=b['hull'];L=h['length']
    for id,station,fraction in [('forward-void',L*.92,.055),('after-void',L*.065,.045)]:
        length=L*fraction;a,c=station-length/2,station+length/2
        keel=max(lerp([(s['station'],s['points'][0][1]) for s in h['sections']],x) for x in [a,station,c])
        deck=min(lerp([(s['station'],s['points'][-1][1]) for s in h['sections']],x) for x in [a,station,c])
        height=min(4,max(.5,deck-keel-1));y=keel+1+height/2
        room(id,id.replace('-',' ').title()+' · provisional flooding space',[0,y,L/2-station],[min(6,h['beam']*.25),height,length])

def main():
    for id,fn,hullmm,supermm in [('yamato',yamato,25,8),('baltimore',baltimore,16,6),('enterprise-cv6',enterprise,15.875,6)]:
        path=SHIPS/id;b=json.loads((path/'reports/fidelity-01/before/blueprint.json').read_text());fn(b)
        b['structuralPlating']=dict(hullMm=hullmm,superstructureMm=supermm,note=f'Nominal {hullmm} mm hull / {supermm} mm structure steel, estimated for gameplay where no verified plate schedule exists. Exterior armor replaces coincident skin. Fit date and load datum stay separate.')
        interior(b);contain_spaces(b)
        b['accuracy']['internals']='Physical protection surfaces and contained provisional room envelopes. Thickness families, boundaries, capacities, flooding and ballistics remain estimates; see fidelity-01 evidence.'
        save(path/'blueprint.json',b)
        print(id,len(b['hull']['sections']),'sections',len(b['structures']),'structures',len(b['armor']),'fixed plates')
    cpath=ROOT/'assets/parts/guns.json';c=json.loads(cpath.read_text());guns={g['id']:g for g in c['parts']}
    g=guns['type94-460-triple']
    foot=[(-7.7,-4.7),(-5.8,-6.7),(4.7,-6.7),(6.9,-4.8),(6.9,4.8),(4.7,6.7),(-5.8,6.7),(-7.7,4.7)]
    mid=[(x-(.9 if x>4 else 0),y,4.35) for x,y in foot]
    top=[(-7.1,-4.25,6.7),(-5.5,-5.55,6.7),(2.6,-5.55,6.7),(3.45,-4.55,6.7),(3.45,4.55,6.7),(2.6,5.55,6.7),(-5.5,5.55,6.7),(-7.1,4.25,6.7)]
    gunhouse(g,[[(x,y,2.4) for x,y in foot],mid,top],'usntmj-o45',650,250,190,270,25)
    g['rangefinderForward']=-5.3
    g=guns['type3-155-triple'];foot=outline(0,0,6.4,6.9,.26)
    gunhouse(g,[[(x,y,.25) for x,y in foot],[(x-(.65 if x>0 else 0),y*.93,3.15) for x,y in foot]],'usntmj-o47',25,25,25,25,10)
    g=guns['us-8in55-mk12-triple'];foot=[(-6.096,-3.55),(-5.72,-3.9),(3.20,-3.55),(3.5306,-3.05),(3.5306,3.05),(3.20,3.55),(-5.72,3.9),(-6.096,3.55)]
    top=[(-6.096,-3.50,3.00355),(-5.72,-3.85,3.00355),(1.82,-3.2,3.00355),(1.82,-2.85,3.00355),(1.82,2.85,3.00355),(1.82,3.2,3.00355),(-5.72,3.85,3.00355),(-6.096,3.5,3.00355)]
    gunhouse(g,[[(x,y,.05) for x,y in foot],top],'op1112-517',203.2,95.25,38.1,76.2,25.4)
    g=guns['us-5in38-mk32-twin'];foot=outline(-.325,0,4.45,4.75,.11)
    gunhouse(g,[[(x,y,.25) for x,y in foot],[(x-(1.1 if x>0 else 0),y,2.7) for x,y in foot]],'baltimore-bgp-1943',31.75,31.75,31.75,31.75,12.7)
    save(cpath,c)

if __name__=='__main__':main()

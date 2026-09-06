"""Schematic-driven, independently modeled WWII aircraft. Blender MCP / batch recipe.
Meters; author +X nose,+Y port,+Z up. All shape stations live in shapes/<id>.json.
"""
import bpy, bmesh, math, json, os, hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.geometry import tessellate_polygon

ROOT=Path(os.environ.get('AIRCRAFT_ROOT',Path(__file__).resolve().parents[2]))
BASE=ROOT/'assets/aircraft';CATALOG=BASE/'catalog.json';RECIPE=BASE/'build.py'
CAT=json.loads(CATALOG.read_text());ID=os.environ['AIRCRAFT_ID']
SPEC=next(a for a in CAT['aircraft'] if a['id']==ID);G=SPEC['geometry']
S=json.loads((BASE/'shapes'/f'{ID}.json').read_text())
OUT=Path(os.environ.get('AIRCRAFT_OUTPUT',BASE/ID/'generated'));OUT.mkdir(parents=True,exist_ok=True)
hasher=hashlib.sha256(CATALOG.read_bytes()+b'\0'+RECIPE.read_bytes())
DETAIL=BASE/'detail_bombers.py'
hasher.update(b'\0detail_bombers.py\0'+DETAIL.read_bytes())
for entry in sorted(CAT['aircraft'],key=lambda a:a['id']):
    shape=BASE/'shapes'/f"{entry['id']}.json"
    hasher.update(b'\0'+entry['id'].encode()+b'\0'+shape.read_bytes())
HASH=hasher.hexdigest();L=SPEC['length'];SPAN=SPEC['wingspan'];HALF=SPAN/2
X=lambda u:L*(.5-u)
# Preserve the user's other scenes. Individual sources only contain this scene.
scene=bpy.data.scenes.new('Schematic aircraft '+ID)
if bpy.context.window:bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene['aircraftId']=ID;scene['contentHash']=HASH;scene['schemaVersion']=1
scene['coordinateContract']='runtime +X starboard,+Y up,-Z nose; meters'
collection=bpy.data.collections.new(ID+' original');scene.collection.children.link(collection)

def interp(rows,x,col):
    rows=sorted(rows,key=lambda p:p[0]);xs=[p[0] for p in rows]
    return float(np.interp(x,xs,[p[col] for p in rows]))

def smooth_interp(rows,x,col):
    # Shape-preserving cubic Hermite interpolation, without overshoot at tips/cowls.
    rows=sorted(rows,key=lambda p:p[0]);xx=np.array([p[0] for p in rows]);yy=np.array([p[col] for p in rows])
    if x<=xx[0]:return float(yy[0])
    if x>=xx[-1]:return float(yy[-1])
    k=int(np.searchsorted(xx,x))-1;ds=np.diff(yy)/np.diff(xx)
    def slope(i):
        if i==0:return ds[0]
        if i==len(xx)-1:return ds[-1]
        if ds[i-1]*ds[i]<=0:return 0
        return 2/(1/ds[i-1]+1/ds[i])
    t=(x-xx[k])/(xx[k+1]-xx[k]);d=xx[k+1]-xx[k]
    return float((2*t**3-3*t*t+1)*yy[k]+(t**3-2*t*t+t)*d*slope(k)+(-2*t**3+3*t*t)*yy[k+1]+(t**3-t*t)*d*slope(k+1))

def body_dims(u):return tuple(smooth_interp(S['fuselage'],u,c) for c in [1,2,3])

# A single original 2K color atlas replaces thousands of raised seam/decal polygons.
# Coordinates in this paint recipe correspond exactly to the procedural UV islands.
SIZE=2048;rng=np.random.default_rng(int(hashlib.sha256(ID.encode()).hexdigest()[:8],16))
SCHEMES={
 'japan-early':((.48,.50,.395),(.64,.65,.55),(.48,.50,.395)),
 'japan-green':((.055,.135,.095),(.61,.65,.59),(.065,.155,.105)),
 'us-early':((.27,.38,.44),(.68,.71,.70),(.27,.38,.44)),
 'us-tricolor':((.045,.095,.14),(.80,.82,.79),(.29,.40,.47)),
 'us-late':((.025,.065,.10),(.035,.078,.115),(.025,.065,.10)),
}
UP,LOW,SIDE=map(np.array,SCHEMES[G['scheme']])
paint=np.empty((SIZE,SIZE,4),dtype=np.float32);paint[:,:,:3]=UP;paint[:,:,3]=1
# Low-amplitude, spatially coherent paint variation; no random noisy camouflage.
yy,xx=np.mgrid[0:SIZE,0:SIZE];variation=(np.sin(xx*.046)*np.cos(yy*.024)+np.sin(xx*.008+yy*.017))*.0016
paint[:,:,:3]+=variation[:,:,None]
BODY=(.015,.02,.985,.295);WT=(.015,.32,.985,.51);WB=(.015,.535,.985,.725)
TU=(.015,.75,.245,.935);TB=(.265,.75,.495,.935);FL=(.515,.75,.745,.935);FR=(.765,.75,.995,.935)
SOLID=(.02,.955,.98,.99)
wingMin=min(p[1] for p in S['wing']);wingMax=max(p[2] for p in S['wing'])
tailMin=min(p[1] for p in S['horizontalTail']);tailMax=max(p[2] for p in S['horizontalTail'])
finMin=min(p[0] for p in S['fin']);finMax=max(p[0] for p in S['fin']);finLow=min(p[1] for p in S['fin']);finHigh=max(p[1] for p in S['fin'])

def uv_rect(rect,u,v):return (rect[0]+u*(rect[2]-rect[0]),rect[1]+v*(rect[3]-rect[1]))
def region(rect):return (slice(int(rect[1]*SIZE),int(rect[3]*SIZE)+1),slice(int(rect[0]*SIZE),int(rect[2]*SIZE)+1))

def fill(rect,color):
    sy,sx=region(rect);paint[sy,sx,:3]=color+variation[sy,sx,None]
fill(WB,LOW);fill(TB,LOW)
# Continuous paint demarcations are sampled per-pixel around the body circumference.
for py in range(int(BODY[1]*SIZE),int(BODY[3]*SIZE)+1):
    t=(py/SIZE-BODY[1])/(BODY[3]-BODY[1]);height=math.cos(t*math.tau)
    if G['scheme']=='us-tricolor':color=LOW if height<-.46 else (UP if height>.48 else SIDE)
    else:color=LOW if height<-.38 else UP
    paint[py,int(BODY[0]*SIZE):int(BODY[2]*SIZE),:3]=color+variation[py,int(BODY[0]*SIZE):int(BODY[2]*SIZE),None]

def line(a,b,color=(.04,.05,.055),width=1,alpha=.30,dash=0):
    x0,y0=[int(v*SIZE) for v in a];x1,y1=[int(v*SIZE) for v in b]
    n=max(abs(x1-x0),abs(y1-y0),1)
    for j in range(n+1):
        if dash and (j//dash)%2:continue
        x=int(x0+(x1-x0)*j/n);y=int(y0+(y1-y0)*j/n)
        loX=max(0,x-width//2);hiX=min(SIZE,x+width//2+1);loY=max(0,y-width//2);hiY=min(SIZE,y+width//2+1)
        paint[loY:hiY,loX:hiX,:3]=paint[loY:hiY,loX:hiX,:3]*(1-alpha)+np.array(color)*alpha

def panel(rect,u0,v0,u1,v1,alpha=.22):
    pts=[uv_rect(rect,u0,v0),uv_rect(rect,u1,v0),uv_rect(rect,u1,v1),uv_rect(rect,u0,v1)]
    for i in range(4):line(pts[i],pts[(i+1)%4],alpha=alpha)

def insignia(rect,cx,cy,rx,ry,japan=False,bars=False,rotation=0):
    c=uv_rect(rect,cx,cy);rx*=rect[2]-rect[0];ry*=rect[3]-rect[1]
    extent=1.8 if bars else 1.05
    x0=max(0,int((c[0]-rx*extent)*SIZE));x1=min(SIZE,int((c[0]+rx*extent)*SIZE)+1)
    y0=max(0,int((c[1]-ry*extent)*SIZE));y1=min(SIZE,int((c[1]+ry*extent)*SIZE)+1)
    Y0,X0=np.mgrid[y0:y1,x0:x1];a=(X0/SIZE-c[0])/rx;b=(Y0/SIZE-c[1])/ry
    x=a*math.cos(rotation)+b*math.sin(rotation);y=-a*math.sin(rotation)+b*math.cos(rotation)
    target=paint[y0:y1,x0:x1,:3]
    blue=(.015,.036,.074);white=(.83,.845,.79);red=(.56,.03,.028)
    if bars:
        mask=(abs(x)<1.72)&(abs(y)<.40);target[mask]=blue
        target[(abs(x)<1.59)&(abs(y)<.27)]=white
    target[x*x+y*y<1]=red if japan else blue
    if not japan:
        # Five point polygon winding test in local emblem coordinates.
        poly=[]
        for i in range(10):
            a=math.pi/2+i*math.pi/5;r=.95 if i%2==0 else .365;poly.append((math.cos(a)*r,math.sin(a)*r))
        inside=np.zeros(x.shape,dtype=bool)
        for i in range(10):
            a,b=poly[i],poly[(i+1)%10]
            inside^=((a[1]>y)!=(b[1]>y))&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1]+1e-10)+a[0])
        target[inside]=white

# Fuselage skin panels: restrained seams and staggered rivets at useful viewing distance.
for u in np.linspace(.16,.94,16):
    for v0,v1 in [(0,.24),(.26,.74),(.76,1)]:line(uv_rect(BODY,u,v0),uv_rect(BODY,u,v1),alpha=.26)
    line(uv_rect(BODY,u+.002,0),uv_rect(BODY,u+.002,1),color=(.15,.18,.18),alpha=.17,dash=5)
for v in [.13,.20,.30,.38,.62,.70,.80,.87]:line(uv_rect(BODY,.13,v),uv_rect(BODY,.95,v),alpha=.2)
# Access panels and fine chipping at high-traffic root skins.
for u in [.24,.31,.43,.52,.76]:
    for v in [.17,.67]:panel(BODY,u,v,u+.045,v+.045,.35)
for rect in [WT,WB]:
    for t in [.12,.20,.29,.39,.5,.61,.73,.84,.94]:
        for side in [-1,1]:line(uv_rect(rect,.5+side*t*.5,.1),uv_rect(rect,.5+side*t*.5,.97),alpha=.20)
    for v in [.16,.58,.78]:line(uv_rect(rect,.02,v),uv_rect(rect,.98,v),alpha=.22)
    for u in [.18,.27,.70,.79]:panel(rect,u,.24,u+.07,.38,.32)
for rect in [TU,TB]:
    line(uv_rect(rect,.02,.67),uv_rect(rect,.98,.67),alpha=.4)
    for u in np.linspace(.08,.92,12):line(uv_rect(rect,u,.55),uv_rect(rect,u,.98),alpha=.10)
for rect in [FL,FR]:
    for v in np.linspace(.08,.92,9):line(uv_rect(rect,.58,v),uv_rect(rect,.98,v),alpha=.13)
# Leading-edge identification and anti-slip walkways use UV plan coordinates.
if G['scheme']=='japan-green':
    for side in [-1,1]:
        pts=[]
        for t in np.linspace(.14,.47,30):
            lead=interp(S['wing'],t,1);trail=interp(S['wing'],t,2)
            p=uv_rect(WT,.5+side*t/2,(lead-wingMin)/(wingMax-wingMin))
            q=uv_rect(WT,.5+side*t/2,(lead+.06*(trail-lead)-wingMin)/(wingMax-wingMin))
            line(p,q,(.82,.53,.10),width=14,alpha=1)
for side in [-1,1]:
    for j in range(18):
        t=.105+j*.004
        lead=interp(S['wing'],t,1);trail=interp(S['wing'],t,2)
        line(uv_rect(WT,.5+side*t/2,(lead+.3*(trail-lead)-wingMin)/(wingMax-wingMin)),uv_rect(WT,.5+side*t/2,(trail-.04-wingMin)/(wingMax-wingMin)),(.025,.03,.029),width=2,alpha=.9)
# Small paint wear spots, mostly along root walkways; no geometry-based pseudo-rivets.
for i in range(160):
    u=.5+rng.choice([-1,1])*rng.uniform(.048,.083);v=rng.uniform(.4,.8)
    px,py=uv_rect(WT,u,v);x=int(px*SIZE);y=int(py*SIZE)
    paint[y:y+1,x:x+int(rng.integers(1,4)),:3]=(.22,.26,.27)
JP=SPEC['nation']=='Japan';late=G['scheme'] in ['us-tricolor','us-late']
for sign in [-1,1]:
    spanT=.70;lead=interp(S['wing'],spanT,1);trail=interp(S['wing'],spanT,2);centerU=(lead+trail)/2
    # Texture V increases aft, hence point the US star toward negative V.
    for rect,allowed in [(WT,JP or not late or sign==1),(WB,JP or not late or sign==-1)]:
        if allowed:insignia(rect,.5+sign*spanT/2,(centerU-wingMin)/(wingMax-wingMin),.57/SPAN,.57/(L*(wingMax-wingMin)),JP,late,math.pi)
for v in [.25,.75]:
    w,lo,hi=body_dims(.70);circ=math.pi*(w+(hi-lo)/2)
    insignia(BODY,.70,v,.32/L,.32/max(circ,.5),JP,late,0)
# Dark anti-glare strip ahead of windscreen; cowl finish has its own continuous material.
canStart=min(p[0] for p in S['canopy'])
for offset in [-1,1]:
    for v in np.linspace(.0,.075,35):line(uv_rect(BODY,.13,(v if offset==1 else 1-v)),uv_rect(BODY,canStart,(v if offset==1 else 1-v)),(.026,.032,.027),alpha=.65)
paint[:,:,:3]=np.clip(paint[:,:,:3],0,1)
paint[:,:,:3]=np.where(paint[:,:,:3]<=.0031308,paint[:,:,:3]*12.92,1.055*paint[:,:,:3]**(1/2.4)-.055)
image=bpy.data.images.new(ID+' original paint',width=SIZE,height=SIZE,alpha=False)
# Blender image pixels are linear scene values; this atlas is authored in sRGB.
image.colorspace_settings.name='sRGB';image.pixels.foreach_set(paint.ravel());image.filepath_raw=str(OUT/'airframe-basecolor.png');image.file_format='PNG';image.save();image.pack()
rough=bpy.data.images.new(ID+' original roughness',width=512,height=512,alpha=False)
rp=np.empty((512,512,4),dtype=np.float32);rp[:,:,:3]=(.50+variation[::4,::4,None]*4);rp[:,:,3]=1
rough.colorspace_settings.name='Non-Color';rough.pixels.foreach_set(rp.ravel());rough.filepath_raw=str(OUT/'airframe-roughness.png');rough.file_format='PNG';rough.save();rough.pack()

def material(name,color,metal=0,roughness=.48):
    m=bpy.data.materials.new(ID+'.'+name);m.use_backface_culling=True;m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=roughness
    return m
M={
 'skin':material('painted aluminum',UP,.12), 'cowl':material('cowling',(.025,.029,.025) if JP else UP,.15),
 'metal':material('machined metal',(.33,.35,.36),.72,.26), 'rubber':material('rubber and cockpit',(.014,.018,.018),.04,.77),
 'interior':material('cockpit interior',(.09,.14,.08),.1,.64),'frame':material('frames',UP,.15),
 'prop':material('propeller',(.018,.022,.024),.35,.4),'tip':material('propeller tips',(.9,.63,.10),.1,.4),
 'glass':material('canopy glass',(.18,.31,.34),.05,.12),'engine':material('engine steel',(.11,.13,.14),.65,.48),
}
p=M['skin'].node_tree.nodes.get('Principled BSDF');tex=M['skin'].node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;M['skin'].node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
rt=M['skin'].node_tree.nodes.new('ShaderNodeTexImage');rt.image=rough;M['skin'].node_tree.links.new(rt.outputs['Color'],p.inputs['Roughness'])
glass=M['glass'];glass.use_backface_culling=False;gp=glass.node_tree.nodes.get('Principled BSDF');gp.inputs['Alpha'].default_value=.25;glass.diffuse_color=(.18,.31,.34,.25)
glass.surface_render_method='BLENDED';glass.use_transparency_overlap=False
# Standard alpha blend exports portably, with an actual interior behind it.

def empty(n,pos=(0,0,0),parent=None,**props):
    o=bpy.data.objects.new(n,None);collection.objects.link(o);o.location=pos;o['nodeId']=n;o.empty_display_size=.15
    if parent:o.parent=parent;o.location=Vector(pos)-parent.location
    for k,v in props.items():o[k]=v
    return o
root=empty('aircraft.root',visualOnly=True,aircraftId=ID,assemblyId='airframe',restPose='gear extended; engine shaft level')

def mesh(name,verts,faces,mat='skin',parent=None,uvs=None,smooth=True):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);collection.objects.link(o)
    par=parent or root;o.parent=par;o.location=-par.location;o['assemblyId']=par.get('nodeId','airframe');data.materials.append(M[mat])
    for p in data.polygons:p.use_smooth=smooth
    uv=data.uv_layers.new(name='UVMap')
    for loop in data.loops:uv.data[loop.index].uv=uvs[loop.vertex_index] if uvs else (.08,.975)
    return o

def tube(name,points,radius,mat='metal',parent=None,n=8):
    pts=list(map(Vector,points));v=[];f=[]
    for i,p in enumerate(pts):
        d=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized();u=d.cross(Vector((0,0,1)))
        if u.length<.01:u=d.cross(Vector((0,1,0)))
        u.normalize();w=d.cross(u)
        for j in range(n):v.append(p+radius*(u*math.cos(j*math.tau/n)+w*math.sin(j*math.tau/n)))
    for i in range(len(pts)-1):
        for j in range(n):k=i*n+j;f.append((k,i*n+(j+1)%n,(i+1)*n+(j+1)%n,k+n))
    f.extend([tuple(reversed(range(n))),tuple((len(pts)-1)*n+j for j in range(n))])
    return mesh(name,v,f,mat,parent)

def cylinder(name,a,b,r,mat='metal',parent=None,n=16):return tube(name,[a,b],r,mat,parent,n)

def ball(name,center,scale,mat='metal',parent=None,n=24,rings=12):
    v=[];f=[]
    for i in range(rings+1):
        t=math.pi*i/rings
        for j in range(n):a=math.tau*j/n;v.append((center[0]+scale[0]*math.cos(t),center[1]+scale[1]*math.sin(t)*math.cos(a),center[2]+scale[2]*math.sin(t)*math.sin(a)))
    for i in range(rings):
        for j in range(n):f.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    return mesh(name,v,f,mat,parent)

def box(name,c,scale,mat='interior',parent=None):
    v=[(c[0]+x*scale[0]/2,c[1]+y*scale[1]/2,c[2]+z*scale[2]/2) for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    return mesh(name,v,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],mat,parent,smooth=False)

# Individually measured body loft. Smooth sections, independent upper/lower contours.
bodyRows=S['fuselage'];u0=bodyRows[0][0] if G.get('engine')=='inline' else S['cowling']['rearU'];u1=bodyRows[-1][0];N=48
us=sorted(set(list(np.linspace(u0,u1,75))+[p[0] for p in bodyRows if p[0]>=u0]));v=[];uv=[];f=[]
canopy=S['canopy'];cStart=min(p[0] for p in canopy);cEnd=max(p[0] for p in canopy)
for u in us:
    w,lo,hi=body_dims(u)
    for j in range(N+1):
        a=j*math.tau/N+math.pi/2;y=w*math.cos(a);z=(hi+lo)/2+(hi-lo)/2*math.sin(a)
        # Upper shoulders meet the measured canopy sill; the middle is cut out below.
        if cStart+.003<u<cEnd-.003 and math.sin(a)>0:
            cw=interp(canopy,u,1);cb=interp(canopy,u,2)
            if abs(y)<cw:z=cb
            else:
                blend=max(0,min(1,(w-abs(y))/max(.01,w-cw)))
                z=(hi+lo)/2+(cb-(hi+lo)/2)*math.sin(blend*math.pi/2)
        v.append((X(u),y,z));uv.append(uv_rect(BODY,u,j/N))
for i in range(len(us)-1):
    for j in range(N):
        k=i*(N+1)+j;u=(us[i]+us[i+1])/2;a=(j+.5)*math.tau/N+math.pi/2
        w,lo,hi=body_dims(u)
        if cStart+.006<u<cEnd-.008 and math.sin(a)>0 and abs(w*math.cos(a))<interp(canopy,u,1)*.96:continue
        f.append((k,k+1,k+N+2,k+N+1))
f.append(tuple((len(us)-1)*(N+1)+j for j in range(N)))
body=mesh('measured fuselage',v,f,uvs=uv)

# Main wings and tailplanes follow registered leading/trailing edges and dihedral.
def surf_point(rows,half,t,q,sign,thickness=.115):
    lead=smooth_interp(rows,t,1);trail=smooth_interp(rows,t,2);z=interp(rows,t,3);chord=L*(trail-lead)
    u=lead+(trail-lead)*q
    thick=5*thickness*chord*(.2969*math.sqrt(max(q,0))-.126*q-.3516*q*q+.2843*q**3-.1036*q**4)
    return (X(u),sign*half*t,z+.018*chord*math.sin(math.pi*q)),max(0,thick),u

def surface_piece(name,rows,half,t0,t1,q0,q1,sign,parent,upperRect,lowerRect,umin,umax,thickness=.115):
    ns=max(4,int((t1-t0)*30));nc=max(4,int((q1-q0)*18));v=[];uv=[];f=[]
    for layer in [1,-1]:
        for i in range(ns+1):
            t=t0+(t1-t0)*i/ns
            for j in range(nc+1):
                q=q0+(q1-q0)*(1-math.cos(math.pi*j/nc))/2;p,h,u=surf_point(rows,half,t,q,sign,thickness)
                v.append((p[0],p[1],p[2]+layer*h));uv.append(uv_rect(upperRect if layer==1 else lowerRect,.5+sign*t/2,(u-umin)/(umax-umin)))
    count=(ns+1)*(nc+1);row=nc+1
    for layer in [0,1]:
        for i in range(ns):
            for j in range(nc):k=layer*count+i*row+j;f.append((k,k+1,k+row+1,k+row))
    for i in range(ns):
        for j in [0,nc]:k=i*row+j;f.append((k,k+row,k+row+count,k+count))
    for i in [0,ns]:
        for j in range(nc):k=i*row+j;f.append((k,k+count,k+count+1,k+1))
    result=mesh(name,v,f,parent=parent,uvs=uv)
    for p in result.data.polygons:
        if p.index>=ns*nc*2:p.use_smooth=False
    return result

for sign,n in [(1,'port'),(-1,'starboard')]:
    aStart=S.get('extras',{}).get('aileronStart',.52);p,h,u=surf_point(S['wing'],HALF,aStart,.74,sign)
    aj=empty('control.aileron.'+n,p,root,axis='spanwise',limitDegrees=18)
    surface_piece('inner wing '+n,S['wing'],HALF,0,aStart,0,1,sign,root,WT,WB,wingMin,wingMax)
    surface_piece('outer wing '+n,S['wing'],HALF,aStart,1,0,.74,sign,root,WT,WB,wingMin,wingMax)
    surface_piece('aileron '+n,S['wing'],HALF,aStart,.985,.743,1,sign,aj,WT,WB,wingMin,wingMax)
    surface_piece('tip '+n,S['wing'],HALF,.985,1,.74,1,sign,root,WT,WB,wingMin,wingMax)
    # Shallow fairing blends the real wing root into the measured fuselage.
    fairRows=[]
    for t in [0,.08,.13,.18]:
        lead=interp(S['wing'],t,1);trail=interp(S['wing'],t,2)
        fairRows.append([t,lead-.008*(1-t/.18),trail+.022*(1-t/.18),interp(S['wing'],t,3)+.09*(1-t/.18)])
    surface_piece('wing root fillet '+n,fairRows,HALF,0,.18,0,1,sign,root,WT,WB,wingMin,wingMax,.105)
    # Tailplane and elevator share the specific planform for this airframe.
    tailHalf=S['tailSpan']/2;p,h,u=surf_point(S['horizontalTail'],tailHalf,.05,.66,sign,.075)
    ej=empty('control.elevator.'+n,p,root,axis='spanwise',limitDegrees=22)
    surface_piece('stabilizer '+n,S['horizontalTail'],tailHalf,0,1,0,.66,sign,root,TU,TB,tailMin,tailMax,.075)
    surface_piece('elevator '+n,S['horizontalTail'],tailHalf,0,1,.665,1,sign,ej,TU,TB,tailMin,tailMax,.075)

# Rounded fin silhouette from the actual drawing. Slice into leading fin and aft rudder.
def rounded_outline(poly):
    result=[];n=len(poly)
    for i in range(n):
        p0=np.array(poly[(i-1)%n]);p1=np.array(poly[i]);p2=np.array(poly[(i+1)%n]);p3=np.array(poly[(i+2)%n])
        for t in [0,.25,.5,.75]:
            value=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t**3)
            result.append(value.tolist())
    return result
finPoly=rounded_outline(S['fin']);hingeU=S.get('extras',{}).get('rudderHingeU',finMin+(finMax-finMin)*.61)
def clip_poly(poly,limit,keepLess):
    result=[]
    for i,p in enumerate(poly):
        q=poly[(i+1)%len(poly)];pin=(p[0]<=limit) if keepLess else (p[0]>=limit);qin=(q[0]<=limit) if keepLess else (q[0]>=limit)
        if pin:result.append(p)
        if pin!=qin:
            t=(limit-p[0])/(q[0]-p[0]);result.append([limit,p[1]+t*(q[1]-p[1])])
    return result

def fin_mesh(name,poly,parent):
    if len(poly)<3:return
    # Tessellate the actual concave outline: center fans incorrectly fill dorsal roots.
    centerU=sum(p[0] for p in poly)/len(poly);centerZ=sum(p[1] for p in poly)/len(poly);v=[];uv=[];faces=[];n=len(poly)
    inner=[(centerU+(u-centerU)*.995,centerZ+(z-centerZ)*.995) for u,z in poly]
    points=[Vector((X(u),z,0)) for u,z in inner]
    triangles=tessellate_polygon([points]);index={tuple(p):i for i,p in enumerate(points)}
    for sign in [-1,1]:
        for outline,thick in [(poly,.012),(inner,.065)]:
            for u,z in outline:
                v.append((X(u),sign*thick,z));uv.append(uv_rect(FL if sign==1 else FR,(u-finMin)/(finMax-finMin),(z-finLow)/(finHigh-finLow)))
    off=2*n
    for j in range(n):
        k=(j+1)%n
        faces.extend([(j,k,n+k,n+j),(off+j,off+n+j,off+n+k,off+k),(j,off+j,off+k,k)])
    for tri in triangles:
        inds=[p if isinstance(p,int) else index[tuple(p)] for p in tri]
        faces.extend([tuple(n+i for i in inds),tuple(off+n+i for i in reversed(inds))])
    mesh(name,v,faces,parent=parent,uvs=uv)
rj=empty('control.rudder',(X(hingeU),0,finLow+.1),root,axis='up',limitDegrees=25)
fin_mesh('vertical stabilizer',clip_poly(finPoly,hingeU-.0007,True),root)
fin_mesh('rudder',clip_poly(finPoly,hingeU+.0007,False),rj)

# Open cowling, curved lip and recessed engine. The old capped black tube is gone.
cowl=S['cowling'];cu=cowl['frontU'];cr=cowl['rearU'];radius=cowl['radiusM'];inline=G.get('engine')=='inline'
if not inline:
    # Registered outer width and upper/lower contours, including each type's taper.
    outerUs=sorted(set(list(np.linspace(cu,cr,13))+[p[0] for p in S['fuselage'] if cu<p[0]<cr]))
    cRows=[]
    for u in outerUs:
        w,lo,hi=body_dims(u);cRows.append((u,w,(lo+hi)/2,(hi-lo)/2))
    fw,flo,fhi=body_dims(cu);fc=(flo+fhi)/2;fr=(fhi-flo)/2
    for u,scale in [(cr,.90),(cu+.033,.87),(cu+.010,.87),(cu,.94)]:
        # Recessed interior is confined to the opening rather than following the belly.
        cRows.append((u,fw*scale,fc,fr*scale))
    v=[];faces=[];nr=48
    for u,w,centerZ,r in cRows:
        for j in range(nr):a=math.tau*j/nr;v.append((X(u),w*math.cos(a),centerZ+r*math.sin(a)))
    for i in range(len(cRows)):
        for j in range(nr):k=i*nr+j;faces.append((k,i*nr+(j+1)%nr,((i+1)%len(cRows))*nr+(j+1)%nr,((i+1)%len(cRows))*nr+j))
    mesh('measured open radial cowling',v,faces,'cowl')
    radius=min(fw,fr)*1.02
    engineU=cu+.023;cylinder('engine rear shadow',(X(engineU+.02),0,0),(X(engineU+.03),0,0),radius*.79,'rubber',n=32)
    cylinder('engine crankcase',(X(engineU),0,0),(X(engineU-.014),0,0),radius*.28,'engine',n=24)
    for j in range(9):
        a=math.tau*j/9
        p=(X(engineU),radius*.28*math.cos(a),radius*.28*math.sin(a));q=(X(engineU),radius*.73*math.cos(a),radius*.73*math.sin(a))
        cylinder('radial cylinder',p,q,radius*.115,'engine',n=10)
        for frac in [.40,.52,.64,.73]:
            rr=radius*frac;c=(X(engineU),rr*math.cos(a),rr*math.sin(a));cylinder('cylinder cooling fin',(c[0]-.025,c[1],c[2]),(c[0]+.025,c[1],c[2]),radius*.132,'metal',n=8)
        tube('pushrod',[(X(engineU-.013),radius*.23*math.cos(a),radius*.23*math.sin(a)),(X(engineU-.004),radius*.70*math.cos(a+.05),radius*.70*math.sin(a+.05))],.012,'metal')
    for j in range(16):
        a=math.tau*j/16
        tube('cowl flap seam',[(X(cr-.025),radius*math.cos(a),radius*math.sin(a)),(X(cr),radius*.975*math.cos(a),radius*.975*math.sin(a))],.004,'rubber',n=4)
else:
    for sign in [-1,1]:
        for j in range(6):
            u=cu+.07+j*.016;w,lo,hi=body_dims(u)
            tube('inline exhaust stack',[(X(u),sign*w*.96,.08),(X(u+.008),sign*(w+.1),.025)],.035,'engine')
    radiator=S['extras']['chinRadiator'];frontU=radiator['frontU'];rearU=radiator['rearU']
    bottom=radiator['zM']-radiator['heightM']/2;hw=radiator['widthM']/2
    rows=[]
    for t,widthFactor in [(0,.70),(.055,.94),(.14,1),(.48,.97),(.75,.88),(1,.48)]:
        u=frontU+t*(rearU-frontU);lo=bottom+.18*max(0,(t-.65)/.35)+.28*max(0,1-t/.14)**2
        rows.append((u,hw*widthFactor,lo,max(lo+.17,body_dims(u)[1]+.12)))
    v=[];f=[];n=24
    for u,w,lo,hi in rows:
        for j in range(n):
            a=j*math.tau/n;c=math.cos(a);sn=math.sin(a)
            v.append((X(u),w*math.copysign(abs(c)**.55,c),(lo+hi)/2+(hi-lo)/2*math.copysign(abs(sn)**.55,sn)))
    for i in range(len(rows)-1):
        for j in range(n):f.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    f.append(tuple((len(rows)-1)*n+j for j in range(n)))
    mesh('Judy measured deep chin radiator',v,f,'frame')
    # Recessed dark grille lies behind the leading lip, with visible cooling slats.
    openingU=frontU+.003;lo,hi=rows[0][2:]
    box('radiator recessed opening',(X(openingU),0,(lo+hi)/2),(.025,hw*1.30,(hi-lo)*.84),'rubber')
    for j in range(7):
        y=hw*(-.54+j*.18)
        tube('radiator grille slat',[(X(openingU-.001),y,lo+.035),(X(openingU-.001),y,hi-.035)],.008,'engine',n=4)
# Type-specific external intakes and exhausts.
if ID.startswith('f6f'):
    ball('Hellcat lower intake fairing',(X(cu+.045),0,-radius*.68),(.42,.50,.29),'cowl')
    ball('Hellcat intake opening',(X(cu+.008),0,-radius*.72),(.025,.37,.14),'rubber',n=20)
if ID.startswith('f4u'):
    for sign in [-1,1]:
        p,h,u=surf_point(S['wing'],HALF,.17,.03,sign)
        ball('Corsair wing root intake',(p[0]+.02,p[1],p[2]),(.026,.27,.07),'rubber',n=16,rings=8)
if G.get('exhaustStacks'):
    for sign in [-1,1]:
        for j in range(5):
            a=-.2-j*.20;u=cr-.015+j*.003
            tube('individual cowl exhaust',[(X(u),sign*radius*math.cos(a),radius*math.sin(a)),(X(u+.026),sign*(radius+.05)*math.cos(a),radius*math.sin(a)-.055)],.036,'engine')

# Transparent, smoothly modeled canopy with actual cockpit tubs and seats.
cs=sorted(canopy,key=lambda p:p[0]);canUs=sorted(set([p[0] for p in cs]+list(np.linspace(cs[0][0],cs[-1][0],30))))
cv=[];cf=[];arcs=16
for u in canUs:
    width=smooth_interp(cs,u,1);base=smooth_interp(cs,u,2);top=smooth_interp(cs,u,3)
    for j in range(arcs+1):
        a=math.pi*j/arcs;cv.append((X(u),width*math.cos(a),base+(top-base)*math.sin(a)**.75))
for i in range(len(canUs)-1):
    for j in range(arcs):k=i*(arcs+1)+j;cf.append((k,k+1,k+arcs+2,k+arcs+1))
if cs[0][3]-cs[0][2]>1e-5:cf.append(tuple(reversed(range(arcs+1))))
if cs[-1][3]-cs[-1][2]>1e-5:cf.append(tuple((len(canUs)-1)*(arcs+1)+j for j in range(arcs+1)))
mesh('clear cockpit glazing',cv,cf,'glass')
# Frames follow select measured station positions; curved bubble rear has sparse frames.
frameUs=S.get('extras',{}).get('canopyFrameU',[p[0] for p in cs])
if ID.startswith('f4u'):frameUs=[cs[0][0],cs[0][0]+.025,cs[-1][0]-.025,cs[-1][0]]
for u in frameUs:
    w=smooth_interp(cs,u,1);base=smooth_interp(cs,u,2);top=smooth_interp(cs,u,3)
    tube('canopy arch frame',[(X(u),w*math.cos(j*math.pi/20),base+(top-base)*math.sin(j*math.pi/20)**.75) for j in range(21)],.014,'frame')
for a in ([0,math.pi] if ID.startswith('f4u') else [0,math.pi/3,math.pi*2/3,math.pi]):
    tube('canopy longitudinal frame',[(X(u),smooth_interp(cs,u,1)*math.cos(a),smooth_interp(cs,u,2)+(smooth_interp(cs,u,3)-smooth_interp(cs,u,2))*math.sin(a)**.75) for u in canUs],.012,'frame')
# Recessed cockpit floor and coaming follow the measured cabin.
centerU=(cs[0][0]+cs[-1][0])/2;cabinLength=L*(cs[-1][0]-cs[0][0]);base=interp(cs,centerU,2);width=max(p[1] for p in cs)
box('cockpit well',(X(centerU),0,base-.29),(cabinLength*.87,width*1.65,.20),'interior')
seatCount=1 if SPEC['role'] in ['Fighter','Fighter-bomber'] else (3 if SPEC['role']=='Torpedo bomber' else 2)
seats=S.get('extras',{}).get('seatUs',[cs[0][0]+t*(cs[-1][0]-cs[0][0]) for t in np.linspace(.27,.72,seatCount)])
if SPEC['role'] in ['Fighter','Fighter-bomber']:seats=[cs[0][0]+(cs[-1][0]-cs[0][0])*.58]
for u in seats:
    w=interp(cs,u,1)
    # Keep equipment below the curved roof across its whole width and length.
    roof=min(smooth_interp(cs,t,3) for t in [u-.028,u,u+.022])
    base=min(interp(cs,u,2),roof-.42)
    box('seat pan',(X(u),0,base-.09),(.32,min(.40,w*1.5),.085),'interior')
    box('seat back',(X(u+.015),0,base+.09),(.065,min(.38,w*1.2),.39),'interior')
    for sy in [-.09,.09]:box('seat harness',(X(u+.010),sy,base+.12),(.074,.036,.34),'metal')
    box('instrument panel',(X(u-.024),0,base+.13),(.045,min(.49,w*1.6),.24),'rubber')
    for sy in [-.13,0,.13]:cylinder('instrument dial',(X(u-.020),sy,base+.16),(X(u-.016),sy,base+.16),.032,'metal',n=12)
    cylinder('control column',(X(u-.007),0,base-.15),(X(u-.012),0,base+.12),.015,'rubber')
# Dorsal turret position is independent of the cockpit and remains articulated.
if G.get('turret'):
    tu=S.get('extras',{}).get('turretU',cs[-1][0]+.025);tw,tl,th=body_dims(tu);tz=S.get('extras',{}).get('turretZ',th+.10)
    tj=empty('turret.yaw',(X(tu),0,tz),root,axis='up')
    ball('dorsal turret glazing',(X(tu),0,tz),(.48,.45,.43),'glass',tj,n=28,rings=14)
    cylinder('turret base',(X(tu),0,tz-.12),(X(tu),0,tz-.06),.43,'frame',tj,n=32)
    tube('turret bow',[(X(tu)+.48*math.cos(j*math.pi/20),0,tz+.43*math.sin(j*math.pi/20)) for j in range(21)],.014,'frame',tj)
    cylinder('turret gun',(X(tu+.01),0,tz+.12),(X(tu+.105),0,tz+.32),.024,'engine',tj,n=12)
# Antenna and hook remain thin, recognizable fittings.
mastU=S.get('extras',{}).get('antennaU',S.get('extras',{}).get('mastU',cs[-1][0]+.02));mw,ml,mh=body_dims(min(mastU,.98));mastZ=mh
mastTip=(X(mastU+.012),0,mastZ+S.get('extras',{}).get('antennaHeightM',S.get('extras',{}).get('mastHeightM',.38)))
tube('radio aerial mast',[(X(mastU),0,mastZ),mastTip],.014,'frame')
tube('aerial wire',[mastTip,(X(finMin+.02),0,finHigh-.12)],.0025,'rubber',n=4)

# Accurate propeller disc size from schematics, tapered twisted blades and hub.
PS=S['propeller'];propU=PS['u'];pr=PS['radiusM'];prop=empty('propeller.spin',(X(propU),0,0),root,axis='forward',continuous=True)
cylinder('propeller hub',(X(propU+.012),0,0),(X(max(0,propU-.015)),0,0),.115,'metal',prop,n=24)
for b in range(PS['blades']):
    angle=b*math.tau/PS['blades']+.22;shape=[(.09,.065),(.23,.135),(.42,.155),(.64,.13),(.83,.095),(.95,.056),(1,.008)];v=[];f=[]
    for side in [-1,1]:
        for t,width in shape:
            for edge in [-1,1]:
                tang=edge*width+(t-.2)*.055;rad=pr*t;twist=.12*(1-t)
                v.append((X(propU)+side*.012+edge*twist,rad*math.cos(angle)-tang*math.sin(angle),rad*math.sin(angle)+tang*math.cos(angle)))
    count=len(shape)*2
    for side in [0,1]:
        for i in range(len(shape)-1):k=side*count+i*2;f.append((k,k+1,k+3,k+2))
    for i in range(len(shape)-1):
        for j in [0,1]:k=i*2+j;f.append((k,k+2,k+2+count,k+count))
    f.extend([(0,1,count+1,count),(count-2,count-1,count*2-1,count*2-2)])
    blade=mesh('twisted propeller blade',v,f,'prop',prop);blade.data.materials.append(M['tip'])
    for p in blade.data.polygons:
        rr=sum(math.hypot(blade.data.vertices[i].co.y,blade.data.vertices[i].co.z) for i in p.vertices)/len(p.vertices)
        if rr>pr*.925:p.material_index=1
spinner=PS.get('spinnerLengthM',0)
if spinner>.025:
    # A proper conical/ogival spinner ending at the catalog nose datum.
    sr=min(radius*.34,.28);v=[];f=[];nn=32
    for t,r in [(0,sr),(.25,sr*.96),(.65,sr*.63),(.91,sr*.22),(1,.004)]:
        for j in range(nn):a=j*math.tau/nn;v.append((X(propU)+spinner*t,r*math.cos(a),r*math.sin(a)))
    for i in range(4):
        for j in range(nn):k=i*nn+j;f.append((k,i*nn+(j+1)%nn,(i+1)*nn+(j+1)%nn,k+nn))
    mesh('ogival spinner',v,f,'frame',prop)
else:ball('propeller hub cap',(X(propU*.35),0,0),(propU*L*.35,.13,.13),'metal',prop,n=20,rings=10)

# Landing gear: separate tyre, recessed hub, chrome oleo and correctly anchored braces.
GEAR=S['gear'];wheelR=GEAR['wheelRadiusM'];wheelZ=GEAR['wheelZM'];gx=X(GEAR['mainU'])
for sign,n in [(1,'port'),(-1,'starboard')]:
    gy=sign*GEAR['trackM']/2;t=abs(gy)/HALF;wingP,wh,_=surf_point(S['wing'],HALF,t,.33,sign)
    pivot=(gx,gy,wingP[2]+wh*.2)
    if G.get('narrowGear'):pivot=(gx+.05,sign*.35,body_dims(GEAR['mainU'])[1]+.3)
    gj=empty('gear.'+n,pivot,root,axis='forward',fixed=bool(G.get('fixedGear')))
    wheel=(gx+.06,gy,wheelZ)
    tube('main oleo housing',[pivot,(wheel[0],gy,wheelZ+.28)],.054,'frame',gj)
    tube('chrome oleo',[(wheel[0],gy,wheelZ+.43),wheel],.035,'metal',gj)
    tube('drag brace',[(pivot[0]-.34,pivot[1]*.74,pivot[2]+.015),(wheel[0],gy,wheelZ+.28)],.028,'metal',gj)
    if G.get('narrowGear'):
        tube('Wildcat retracting linkage',[(gx-.25,sign*.27,-.35),(gx,gy,wheelZ+.20)],.026,'metal',gj)
    # Revolved tyre cross-section creates rounded sidewalls and an open center.
    tv=[];tf=[];ns=32;profile=[(-.115,.49),(-.14,.70),(-.12,.93),(-.075,1),(0,1.015),(.075,1),(.12,.93),(.14,.70),(.115,.49)]
    for axial,rr in profile:
        for j in range(ns):a=j*math.tau/ns;tv.append((wheel[0]+wheelR*rr*math.cos(a),gy+axial,wheelZ+wheelR*rr*math.sin(a)))
    for i in range(len(profile)-1):
        for j in range(ns):k=i*ns+j;tf.append((k,i*ns+(j+1)%ns,(i+1)*ns+(j+1)%ns,k+ns))
    mesh('rounded main tyre',tv,tf,'rubber',gj)
    cylinder('wheel hub',(wheel[0],gy-.116,wheelZ),(wheel[0],gy+.116,wheelZ),wheelR*.49,'metal',gj,n=24)
    for sign2 in [-1,1]:
        cylinder('axle cap',(wheel[0],gy+sign2*.117,wheelZ),(wheel[0],gy+sign2*.125,wheelZ),wheelR*.18,'engine',gj,n=12)
        for j in range(6):
            a=j*math.tau/6;c=(wheel[0]+wheelR*.32*math.cos(a),gy+sign2*.119,wheelZ+wheelR*.32*math.sin(a))
            cylinder('hub recessed hole',c,(c[0],c[1]+sign2*.006,c[2]),wheelR*.07,'rubber',gj,n=8)
    if G.get('fixedGear'):
        spat=S['extras']['wheelSpat'];outline=rounded_outline(spat['sideOutline']);n=len(outline)
        centerU=sum(p[0] for p in outline)/n;centerZ=sum(p[1] for p in outline)/n
        v=[];f=[]
        for lateral,scale in [(-1,.64),(-.72,.91),(0,1),(.72,.91),(1,.64)]:
            for u,z in outline:v.append((X(centerU+(u-centerU)*scale),gy+lateral*spat['halfWidthM'],centerZ+(z-centerZ)*scale))
        for i in range(4):
            for j in range(n):f.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
        f.extend([tuple(reversed(range(n))),tuple(4*n+j for j in range(n))])
        mesh('Val measured swept wheel fairing',v,f,'frame',gj)
        # The leg fairing meets the long, asymmetrical wheel enclosure.
        tube('spat strut fairing',[pivot,(wheel[0]-.02,gy,wheelZ+.32)],.105,'frame',gj,n=12)
    elif not G.get('narrowGear'):
        dz=(pivot[2]+wheelZ+.18)/2
        door=box('main gear door',(gx-.06,gy+sign*.09,dz),(.31,.025,max(.12,pivot[2]-wheelZ-.12)),'frame',gj)
    # Dark well inset bounded by the actual wing root / underside.
    if not G.get('fixedGear') and not G.get('narrowGear'):
        ball('wheel well shadow',(gx,gy,wingP[2]-wh+.005),(.30,.22,.022),'rubber',n=20,rings=8)
tU=GEAR['tailU'];tz=GEAR['tailWheelZM'];tbase=body_dims(tU)[1]
tj=empty('gear.tail',(X(tU),0,tbase),root,axis='spanwise',fixed=bool(G.get('fixedGear')))
tube('tail oleo',[(X(tU),0,tbase),(X(tU+.006),0,tz)],.026,'metal',tj)
cylinder('tail tyre',(X(tU+.006),-.063,tz),(X(tU+.006),.063,tz),.135,'rubber',tj,n=24)
cylinder('tail hub',(X(tU+.006),-.066,tz),(X(tU+.006),.066,tz),.058,'metal',tj,n=16)
hu=.86;hz=body_dims(hu)[1];hook=empty('arrestor.hook',(X(hu),0,hz),root,axis='spanwise')
tube('arrestor hook',[(X(hu),0,hz),(X(.973),0,hz-.10),(X(.98),0,hz-.22),(X(.965),0,hz-.24)],.025,'metal',hook)
empty('socket.deck',(gx,0,wheelZ-wheelR),root);empty('socket.payload',(X(.46),0,body_dims(.46)[1]-.025),root)
# Flush short gun tubes follow the real wing leading edge, without overscaled rods.
if SPEC['role'] in ['Fighter','Fighter-bomber'] or G.get('turret'):
    for sign in [-1,1]:
        count=3 if ID.startswith(('f4f','f6f','f4u')) else 1
        for j in range(count):
            t=S.get('extras',{}).get('gunSpanFractions',[.27+k*.032 for k in range(count)])[j];p,h,u=surf_point(S['wing'],HALF,t,0,sign)
            cylinder('wing muzzle',p,(p[0]+.085,p[1],p[2]),.018,'engine',n=10)
# Aircraft-specific bomber equipment shares the same durable geometry helpers.
exec(compile(DETAIL.read_text(),str(DETAIL),'exec'),globals())

# Batch by rigid owner and retain semantic pivots. No merge across moving boundaries.
bpy.context.view_layer.update();buckets={}
for o in list(collection.objects):
    if o.type=='MESH':buckets.setdefault(o.parent,[]).append(o)
for parent,objects in buckets.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=parent['nodeId']+'.mesh';o['assemblyId']=parent['nodeId']
def clean_mesh(data):
    bm=bmesh.new();bm.from_mesh(data)
    # Weld parametric poles; UVs remain on face corners. Triangulate before testing
    # area because otherwise an apparently sound quad can export a collapsed half.
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.0000001)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    faces=list(bm.faces)
    points=np.array([[tuple(v.co) for v in face.verts] for face in faces],dtype=np.float64)
    areas=np.linalg.norm(np.cross(points[:,1]-points[:,0],points[:,2]-points[:,0]),axis=1)/2
    tiny=[face for face,area in zip(faces,areas) if area<1e-10]
    if tiny:bmesh.ops.delete(bm,geom=tiny,context='FACES')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
for o in collection.objects:
    if o.type=='MESH':clean_mesh(o.data)
# Preview lights are removed for export. Review actual PBR materials via Eevee.
scene.world=bpy.data.worlds.new(ID+' world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.20,.25,.30,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.55
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.resolution_percentage=100;scene.render.film_transparent=True
# Store the editable source without other scenes, only its dependent packed textures.
bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)
reviewObjects=[]
def area(name,loc,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;o=bpy.data.objects.new(name,data);collection.objects.link(o);o.location=loc;o.rotation_euler=(-Vector(loc)).to_track_quat('-Z','Y').to_euler();reviewObjects.append(o)
area('key',(L*.45,-SPAN*.55,L*1.0),1900,SPAN*.75);area('fill',(0,SPAN*.7,L*.5),1400,SPAN*.65);area('rim',(-L*.7,-SPAN*.05,L*.65),2200,SPAN*.6)
if os.environ.get('AIRCRAFT_REVIEW','1')=='1':
    folder=OUT/'review';folder.mkdir(exist_ok=True);scale=max(L,SPAN)
    cameraData=bpy.data.cameras.new(ID+' review');camera=bpy.data.objects.new(ID+' review',cameraData);collection.objects.link(camera);reviewObjects.append(camera);scene.camera=camera;cameraData.type='ORTHO'
    # Fit orthographic cameras to the projected model envelope; top/side drawings have matching projection.
    views=[('quarter',(scale*.9,-scale*1.3,scale*.72)),('top',(0,0,scale*2)),('side',(0,-scale*2,0)),('front',(scale*2,0,0)),('rear',(-scale*2,0,0)),('articulated',(scale*.9,-scale*1.3,scale*.72))]
    scene.render.engine='BLENDER_EEVEE';scene.render.film_transparent=False;scene.world.color=(.05,.07,.09);record=[]
    for name,location in views:
        if name=='articulated':
            prop.rotation_euler.x=.7;rj.rotation_euler.z=.30
            for o in collection.objects:
                nid=o.get('nodeId','')
                if nid.startswith('control.elevator'):o.rotation_euler.y=.28
                if nid.startswith('control.aileron'):o.rotation_euler.y=.23 if nid.endswith('port') else -.23
                if nid.startswith('gear.') and not o.get('fixed'):o.rotation_euler.x=.95 if nid.endswith('port') else -.95
                if nid.startswith('diveBrake.'):o.rotation_euler.y=.60*o.get('rotationMultiplier',1)
        target=Vector((0,0,.10));camera.location=location;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        if name=='top':camera.rotation_euler=(0,0,-math.pi/2)
        bpy.context.view_layer.update();pts=[o.matrix_world@Vector(c) for o in collection.objects if o.type=='MESH' for c in o.bound_box];inverse=camera.matrix_world.inverted();projected=[inverse@p for p in pts]
        width=max(p.x for p in projected)-min(p.x for p in projected);height=max(p.y for p in projected)-min(p.y for p in projected)
        cameraData.ortho_scale=max(width,height*4/3)*1.10;cameraData.clip_end=200
        scene.render.resolution_x=1400;scene.render.resolution_y=1050;scene.render.filepath=str(folder/(name+'.png'));bpy.ops.render.render(write_still=True)
        record.append({'name':name,'location':list(location),'target':list(target),'scale':cameraData.ortho_scale,'size':[1400,1050]})
    (folder/'cameras.json').write_text(json.dumps({'aircraftId':ID,'contentHash':HASH,'projection':'orthographic','authoringAxes':CAT['authoringAxes'],'views':record},indent=2)+'\n')
for o in collection.objects:
    if o.type=='EMPTY':o.rotation_euler=(0,0,0)
for o in reviewObjects:bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update();rotation=Matrix.Rotation(math.pi/2,4,'Z');inverse=rotation.inverted();frames={o:o.matrix_local.copy() for o in collection.objects}
for o in collection.objects:
    if o.type=='MESH':
        o.data.transform(rotation);clean_mesh(o.data)
for o,frame in frames.items():o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_local=rotation@frame@inverse
bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=True,export_image_format='AUTO')
export_glb(OUT/'model.glb')
for level,ratio in [(1,.45),(2,.20)]:
    lodMeshes=[]
    for obj in collection.objects:
        if obj.type=='MESH':
            original=obj.data
            mod=obj.modifiers.new('Distance detail','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True;mod.delimit={'UV','MATERIAL'}
            bpy.context.view_layer.update()
            reduced=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            obj.modifiers.remove(mod);clean_mesh(reduced);obj.data=reduced;lodMeshes.append((obj,original,reduced))
    scene['lodLevel']=level
    # Distance assets carry smaller maps as well as fewer triangles.
    smallColor=image.copy();smallColor.scale(SIZE//(2**level),SIZE//(2**level));smallColor.pack()
    smallRough=rough.copy();smallRough.scale(512//(2**level),512//(2**level));smallRough.pack()
    tex.image=smallColor;rt.image=smallRough
    export_glb(OUT/f'model-lod{level}.glb')
    tex.image=image;rt.image=rough
    bpy.data.images.remove(smallColor);bpy.data.images.remove(smallRough)
    for obj,original,reduced in lodMeshes:
        obj.data=original;bpy.data.meshes.remove(reduced)
scene['lodLevel']=0
for o in collection.objects:
    if o.type=='MESH':o.data.transform(inverse)
for o,frame in frames.items():o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_local=frame
bpy.context.view_layer.update()
if bpy.context.screen:
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            sp=area.spaces.active;sp.shading.type='MATERIAL';sp.overlay.show_overlays=False;sp.region_3d.view_distance=max(L,SPAN)*1.2;sp.region_3d.view_location=(0,0,0);sp.region_3d.view_rotation=Vector((1,-1.4,.8)).to_track_quat('Z','Y')
(OUT/'authoring.json').write_text(json.dumps({'schemaVersion':1,'aircraftId':ID,'contentHash':HASH,'method':os.environ.get('AIRCRAFT_METHOD','local-blender'),'blenderVersion':bpy.app.version_string,'originalGeometry':True,'shapeSource':f'shapes/{ID}.json','reference':S['reference'],'triangleBudget':40000},indent=2)+'\n')
print('AIRCRAFT_BUILT '+ID,flush=True)

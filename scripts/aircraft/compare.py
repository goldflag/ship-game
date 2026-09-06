#!/usr/bin/env python3
"""Project independently decoded GLB triangles onto retained reference rasters.

Usage: python3 scripts/aircraft/compare.py all | <aircraft-id> [--allow-stale]
No Blender, geometry authoring recipe, rendered camera, or source mesh is read.
Registration uses each preserved drawing's pixel datums; it never fits the model
silhouette to the reference. Shape stations are used only for residual reports.
"""
from __future__ import annotations
import argparse, hashlib, json, math, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/aircraft'
TYPE={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
COMP={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def clean(value):
    if isinstance(value,np.ndarray):return clean(value.tolist())
    if isinstance(value,np.generic):return clean(value.item())
    if isinstance(value,float):return round(value,6) if math.isfinite(value) else None
    if isinstance(value,dict):return {k:clean(v) for k,v in value.items()}
    if isinstance(value,(tuple,list)):return [clean(v) for v in value]
    return value

def load_glb(path):
    data=path.read_bytes()
    if len(data)<20 or struct.unpack_from('<III',data,0)!=(0x46546c67,2,len(data)):raise ValueError('Invalid GLB header')
    chunks={};offset=12
    while offset<len(data):
        size,kind=struct.unpack_from('<II',data,offset);offset+=8
        if offset+size>len(data):raise ValueError('Truncated GLB chunk')
        chunks[kind]=data[offset:offset+size];offset+=size
    doc=json.loads(chunks[0x4e4f534a]);binary=chunks[0x004e4942]
    def accessor(i):
        a=doc['accessors'][i]
        if 'sparse' in a:raise ValueError('Sparse accessor unsupported')
        view=doc['bufferViews'][a['bufferView']]
        if view.get('buffer',0)!=0:raise ValueError('External binary buffer unsupported')
        dtype=np.dtype(TYPE[a['componentType']]);count=COMP[a['type']]
        offset=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',dtype.itemsize*count)
        out=np.ndarray((a['count'],count),dtype=dtype,buffer=binary,offset=offset,strides=(stride,dtype.itemsize)).copy()
        if not np.all(np.isfinite(out)):raise ValueError('Non-finite accessor')
        return out
    def local(n):
        if 'matrix' in n:return np.array(n['matrix'],dtype=float).reshape(4,4,order='F')
        x,y,z,w=n.get('rotation',[0,0,0,1]);r=np.array([
            [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
            [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
            [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
        out=np.eye(4);out[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));out[:3,3]=n.get('translation',[0,0,0]);return out
    nodes=doc['nodes'];scene=doc['scenes'][doc.get('scene',0)];triangles=[];meshes=[];visited=set()
    def walk(i,parent,owners):
        if i in visited:raise ValueError('GLB scene has repeated/cyclic node')
        visited.add(i);node=nodes[i];frame=parent@local(node);owner=node.get('extras',{}).get('nodeId');chain=owners+([owner] if owner else [])
        if 'mesh' in node:
            ntri=0
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode',4)!=4:raise ValueError('Only triangle primitives supported')
                verts=accessor(primitive['attributes']['POSITION']);world=(np.c_[verts,np.ones(len(verts))]@frame.T)[:,:3]
                # Invert documented exported basis: runtime=(-sourceY, sourceZ, -sourceX).
                source=np.stack([-world[:,2],-world[:,0],world[:,1]],axis=1)
                indices=accessor(primitive['indices']).ravel().astype(int) if 'indices' in primitive else np.arange(len(source))
                if len(indices)%3 or np.any(indices>=len(source)):raise ValueError('Invalid triangle indices')
                tri=source[indices.reshape(-1,3)];triangles.append(tri);ntri+=len(tri)
            meshes.append({'name':node.get('name',''),'owners':chain,'triangles':ntri})
        for child in node.get('children',[]):walk(child,frame,chain)
    for index in scene['nodes']:walk(index,np.eye(4),[])
    if not triangles:raise ValueError('No GLB triangles')
    return np.concatenate(triangles),scene.get('extras',{}),meshes

def first(d,*keys,default=None):
    for k in keys:
        if k in d:return d[k]
    return default

def registration(shape,aircraft,view):
    ref=shape['reference'];reg=ref['registration'];L=aircraft['length'];S=aircraft['wingspan'];m=np.zeros((2,4));transform='identity'
    if view=='side':
        r=reg['side'];nose=first(r,'noseX','noseXPx',default=r.get('nosePx',[None])[0]);tail=first(r,'tailX','tailXPx',default=r.get('tailPx',[None])[0]);shaft=first(r,'engineShaftY','shaftYPx')
        delta=tail-nose;m[0]=[-delta/L,0,0,nose+delta/2];m[1]=[0,0,-abs(delta)/L,shaft]
    else:
        # Prefer original top plate registration over a transposed convenience copy.
        r=reg.get('top',reg.get('plan'))
        if not r:raise ValueError('No top/plan registration')
        if r.get('lengthAxis')=='y':
            nose=r['noseAxisPx'];tail=r['tailAxisPx'];center=r['centerPx'];ppm=r['spanPx']/S;delta=tail-nose
            m[0]=[0,-np.sign(delta)*ppm,0,center];m[1]=[-delta/L,0,0,nose+delta/2]
        elif isinstance(r.get('sourceTransform'),str) and r['sourceTransform'].startswith('x=492-sourceY'):
            # Vought F4U-1D original: longitudinal plan frame x=492-oldY, span=oldX-313.
            nose=492-r['noseXPx'];tail=492-r['tailXPx'];center=r['centerYPx'];delta=tail-nose;ppm=2*r['halfSpanPx']/S
            m[0]=[0,-np.sign(delta)*ppm,0,center];m[1]=[-delta/L,0,0,nose+delta/2]
        else:
            nose=first(r,'noseX','noseXPx','noseAxisPx');tail=first(r,'tailX','tailXPx','tailAxisPx');center=first(r,'centerY','centerYPx','centerPx');delta=tail-nose
            span=r['spanPx'] if 'spanPx' in r else (2*r['halfSpanPx'] if 'halfSpanPx' in r else abs(r['starboardTipY']-r['portTipY']))
            ppm=span/S;m[0]=[-delta/L,0,0,nose+delta/2];m[1]=[0,np.sign(delta)*ppm,0,center]
            trans=r.get('sourceTransform')
            if isinstance(trans,dict) and trans.get('operation')=='transpose':transform='transpose'
    image_path=ROOT/r.get('imagePath',ref['imagePath']);image=Image.open(image_path).convert('RGB')
    if transform=='transpose':image=image.transpose(Image.Transpose.TRANSPOSE)
    return m,image,image_path,r.get('boundsPx'),transform

def project(triangles,m):return np.c_[triangles.reshape(-1,3),np.ones(triangles.size//3)]@m.T

def render_overlay(triangles,m,reference,bounds,out,view,aircraft,stale=False):
    points=project(triangles,m).reshape(-1,3,2);flat=points.reshape(-1,2)
    lo=np.floor(flat.min(axis=0));hi=np.ceil(flat.max(axis=0))
    if bounds:lo=np.minimum(lo,bounds[:2]);hi=np.maximum(hi,bounds[2:])
    pad=max(8,int((hi[0]-lo[0])*.018));crop=(int(lo[0]-pad),int(lo[1]-pad),int(hi[0]+pad+1),int(hi[1]+pad+1))
    base=Image.new('RGB',(crop[2]-crop[0],crop[3]-crop[1]),'white');base.paste(reference,(-crop[0],-crop[1]))
    scale=2 if max(base.size)<=2000 else 1
    mask=Image.new('L',(base.width*scale,base.height*scale),0);draw=ImageDraw.Draw(mask)
    for triangle in points:
        p=(triangle-np.array(crop[:2]))*scale
        if abs((p[1,0]-p[0,0])*(p[2,1]-p[0,1])-(p[1,1]-p[0,1])*(p[2,0]-p[0,0]))>.01:draw.polygon([tuple(t) for t in p],fill=255)
    if scale>1:mask=mask.resize(base.size,Image.Resampling.LANCZOS)
    # A single translucent silhouette and crisp boundary: triangle overlaps do not accumulate opacity.
    overlay=base.copy();overlay.paste((224,40,48),mask=mask.point(lambda p:int(p*.25)))
    edge=mask.filter(ImageFilter.MaxFilter(3));inner=mask.filter(ImageFilter.MinFilter(3));edge_arr=np.maximum(np.asarray(edge).astype(int)-np.asarray(inner).astype(int),0).astype('uint8');overlay.paste((215,28,46),mask=Image.fromarray(edge_arr))
    display_scale=min(2,max(1,960/overlay.width));display=overlay.resize((round(overlay.width*display_scale),round(overlay.height*display_scale)),Image.Resampling.LANCZOS)
    head=52;canvas=Image.new('RGB',(display.width,head+display.height),(249,249,246));canvas.paste(display,(0,head));d=ImageDraw.Draw(canvas)
    d.text((10,8),f"{'STALE DIAGNOSTIC | ' if stale else ''}{aircraft['name']} | {view.upper()} | actual exported GLB in red",fill=(30,35,40))
    d.text((10,28),'Fixed reference datums; original drawing beneath. Gear and propeller poses may differ.',fill=(75,75,75))
    canvas.save(out/f'{view}-overlay.png');base.save(out/f'{view}-reference.png')
    silhouette=Image.new('RGB',base.size,'white');silhouette.paste((22,24,29),mask=mask);silhouette.save(out/f'{view}-silhouette.png')
    return {'referenceCropPx':crop,'overlayDisplayScale':display_scale,'overlayHeaderHeightPx':head,'projectionMatrixSourceToPixel':m.tolist(),'triangleCount':len(triangles),'projectedBoundsPx':[lo.tolist(),hi.tolist()], 'files':{'overlay':str((out/f'{view}-overlay.png').relative_to(ROOT)),'reference':str((out/f'{view}-reference.png').relative_to(ROOT)),'silhouette':str((out/f'{view}-silhouette.png').relative_to(ROOT))}}

def section_x(triangles,y,xlow,xhigh):
    # Independently intersect actual transformed triangles with a constant span plane.
    values=[]
    valid=(triangles[:,:,1].min(axis=1)<=y)&(triangles[:,:,1].max(axis=1)>=y)
    for tri in triangles[valid]:
        for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:
            da=a[1]-y;db=b[1]-y
            if abs(da)<1e-7 and xlow<=a[0]<=xhigh:values.append(a[0])
            if da*db<0:
                x=a[0]+(b[0]-a[0])*(-da)/(db-da)
                if xlow<=x<=xhigh:values.append(x)
    return (min(values),max(values)) if values else None

def vertical_ray(triangles,x,y):
    a=triangles[:,0,:2];b=triangles[:,1,:2];c=triangles[:,2,:2]
    ab=b-a;ac=c-a;ap=np.array([x,y])-a;den=ab[:,0]*ac[:,1]-ab[:,1]*ac[:,0]
    valid=abs(den)>1e-10;safe=np.where(valid,den,1)
    v=(ap[:,0]*ac[:,1]-ap[:,1]*ac[:,0])/safe;w=(ab[:,0]*ap[:,1]-ab[:,1]*ap[:,0])/safe;u=1-v-w
    valid&=(u>=-1e-6)&(v>=-1e-6)&(w>=-1e-6)
    z=u*triangles[:,0,2]+v*triangles[:,1,2]+w*triangles[:,2,2]
    return [float(z[valid].min()),float(z[valid].max())] if valid.any() else None

def wing_height_report(triangles,shape,aircraft):
    wing=np.array(shape['wing']);L=aircraft['length'];half=aircraft['wingspan']/2
    samples=sorted(set([.18,.36,.55,.75,.95,shape.get('extras',{}).get('gullBreakSpanFraction',.36)]));out=[]
    for t in samples:
        le=np.interp(t,wing[:,0],wing[:,1]);te=np.interp(t,wing[:,0],wing[:,2]);x=L*(.5-le-(te-le)*.3);expected=np.interp(t,wing[:,0],wing[:,3])
        for sign,name in [(1,'port'),(-1,'starboard')]:
            hit=vertical_ray(triangles,x,sign*t*half)
            out.append({'halfSpanFraction':t,'side':name,'chordFraction':.3,'sourceXM':x,'drawingWingDatumZM':expected,'actualBottomTopZM':hit,'actualMidSurfaceZM':sum(hit)/2 if hit else None,'note':'Actual GLB vertical ray; drawn wing datum differs from cambered airfoil mean. Attachments can extend the ray interval.'})
    return out

def station_report(triangles,shape,aircraft):
    L=aircraft['length'];S=aircraft['wingspan'];wing=np.array(shape['wing']);tail=np.array(shape['horizontalTail'])
    # Divide the longitudinal wing and tail regions. This selects measured physical
    # parts only; it does not clip vertices to the target outline or fit the model.
    split=(max(wing[:,2])+min(tail[:,1]))/2
    out=[]
    for frac in [.55,.70,.85,.95]:
        le=np.interp(frac,wing[:,0],wing[:,1]);te=np.interp(frac,wing[:,0],wing[:,2]);expected=np.array([L*(.5-le),L*(.5-te)])
        for sign,name in [(1,'port'),(-1,'starboard')]:
            actual=section_x(triangles,sign*frac*S/2,L*(.5-split),L*.6)
            if actual:
                lo,hi=actual;errors=np.array([hi,lo])-expected
                out.append({'halfSpanFraction':frac,'side':name,'expectedSourceXM':{'leading':expected[0],'trailing':expected[1]},'actualSourceXM':{'leading':hi,'trailing':lo},'errorM':{'leading':errors[0],'trailing':errors[1]}})
            else:out.append({'halfSpanFraction':frac,'side':name,'error':'No triangle intersects requested plane'})
    return out

def current_content_hash(catalog):
    hasher=hashlib.sha256((BASE/'catalog.json').read_bytes()+b'\0'+(BASE/'build.py').read_bytes())
    detail=BASE/'detail_bombers.py'
    if detail.exists():hasher.update(b'\0detail_bombers.py\0'+detail.read_bytes())
    for entry in sorted(catalog['aircraft'],key=lambda a:a['id']):hasher.update(b'\0'+entry['id'].encode()+b'\0'+(BASE/'shapes'/f"{entry['id']}.json").read_bytes())
    return hasher.hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('aircraft',nargs='?',default='all');parser.add_argument('--allow-stale',action='store_true',help='Make explicitly marked diagnostic overlays before rebuilding');args=parser.parse_args()
    catalog=json.loads((BASE/'catalog.json').read_text());entries=catalog['aircraft'] if args.aircraft=='all' else [a for a in catalog['aircraft'] if a['id']==args.aircraft]
    if not entries:parser.error('Unknown aircraft ID')
    expected_hash=current_content_hash(catalog);results=[]
    for aircraft in entries:
        id=aircraft['id'];shape_path=BASE/'shapes'/f'{id}.json';shape=json.loads(shape_path.read_text());glb_path=BASE/id/'generated/model.glb';triangles,scene,meshes=load_glb(glb_path)
        stale=scene.get('contentHash')!=expected_hash
        if stale and not args.allow_stale:raise ValueError(f'{id}: GLB content hash is stale; rebuild or pass --allow-stale for labeled diagnostics')
        out=BASE/id/'generated/comparison';out.mkdir(exist_ok=True);views={}
        for view in ['side','top']:
            m,image,path,bounds,transform=registration(shape,aircraft,view);views[view]=render_overlay(triangles,m,image,bounds,out,view,aircraft,stale);views[view].update({'sourceImage':str(path.relative_to(ROOT)),'sourceImageSha256':sha(path),'sourceImageTransform':transform})
        flat=triangles.reshape(-1,3);low=flat.min(axis=0);high=flat.max(axis=0);dims=high-low;stations=station_report(triangles,shape,aircraft)
        residuals=[abs(value) for row in stations for value in row.get('errorM',{}).values()]
        report={'schemaVersion':1,'aircraftId':id,'method':'Independent GLB binary vertices/indices plus composed scene transforms projected onto the retained original drawing. No fitting to the model, Blender scene, or review render camera.', 'status':'stale diagnostic' if stale else 'ready for visual review','historicalAccuracy':'Not certified. Export residuals verify interpretation of sampled drawing landmarks; drawings, hidden sections, and variant differences retain their source limitations.', 'sourceUrl':shape['reference']['sourceUrl'],'contentHash':scene.get('contentHash'),'expectedContentHash':expected_hash,'glbSha256':sha(glb_path),'shapeSha256':sha(shape_path),'comparatorSha256':sha(Path(__file__)),'axes':'meters, source +X nose +Y port +Z up; source=(-runtimeZ,-runtimeX,runtimeY)','boundsM':[low.tolist(),high.tolist()],'measured':{'lengthM':dims[0],'wingspanM':dims[1],'heightM':dims[2],'triangles':len(triangles),'meshes':len(meshes),'wingStationMaxAbsErrorM':max(residuals) if residuals else None},'drawingExpected':{'lengthM':aircraft['length'],'wingspanM':aircraft['wingspan']},'wingStations':stations,'wingSectionHeights':wing_height_report(triangles,shape,aircraft),'views':views,'limitations':shape['reference'].get('notes',[])}
        (out/'comparison.json').write_text(json.dumps(clean(report),indent=2)+'\n');results.append({'id':id,'status':report['status'],'glbSha256':report['glbSha256'],**clean(report['measured'])});print(json.dumps(results[-1]),flush=True)
    if args.aircraft=='all':(BASE/'reports/schematic-comparisons.json').write_text(json.dumps({'schemaVersion':1,'contentHash':expected_hash,'comparatorSha256':sha(Path(__file__)),'aircraft':results},indent=2)+'\n')
if __name__=='__main__':main()

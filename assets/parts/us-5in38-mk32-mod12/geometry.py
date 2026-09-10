"""Original AGS010 Mk.32 Mod.12 enclosure and fittings.

Proportioned against the approved Cleveland Hull A model. Reuses the original
shared joint/barrel builder; no external mesh or installed preview is an input.
The unresolved legacy Iowa enclosure remains a separate catalog variant.
"""
import math
import bpy
from blender_components import create_gun_mount
from blender_fidelity import Fittings


def create_mount(mount, collection, helpers, materials):
    spec=mount['weapon'];name=mount['id'];base=mount['position'][1]
    mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
    naval,edge,dark=(materials[k] for k in ['naval','edge','dark'])
    roof=materials.get('roof',naval)
    shell=create_gun_mount(mount,collection,helpers,materials,lambda x:base)
    yaw=next(o for o in bpy.context.scene.objects if o.get('nodeId')==name+'.yaw')
    # Keep the shared articulated barrel hierarchy. Open the source-shaped armor
    # shell at each gun slot, including the forward sloping roof.
    def clip(poly,axis,limit,sign):
        out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            da=sign*(a[axis]-limit);db=sign*(b[axis]-limit)
            if da>=0:out.append(a)
            if (da>=0)!=(db>=0):
                t=da/(da-db);out.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
        return out
    vv=[];ff=[];mi=[]
    def panel(poly,finish):
        if len(poly)<3:return
        start=len(vv);vv.extend((x,y,base+z) for x,y,z in poly);ff.append(tuple(range(start,len(vv))));mi.append(int(finish=='roof'))
    shape=spec['gunhouseMesh'];gaps=[(-spec['barrelSpacing']/2-.36,-spec['barrelSpacing']/2+.36),(spec['barrelSpacing']/2-.36,spec['barrelSpacing']/2+.36)]
    for face in shape['faces']:
        poly=[shape['vertices'][i] for i in face['indices']];finish=face['finish']
        if face['id'].startswith('roof-front-'):
            panel(clip(poly,0,.03,-1),finish);poly=clip(poly,0,.03,1)
        elif face['id'].startswith('front-slope-'):
            panel(clip(poly,2,1.35,-1),finish);poly=clip(poly,2,1.35,1)
        else:panel(poly,finish);continue
        low=-4
        for a,b in gaps:
            panel(clip(clip(poly,1,low,1),1,a,-1),finish);low=b
        panel(clip(poly,1,low,1),finish)
    data=bpy.data.meshes.new(name+'.open enclosure');data.from_pydata(vv,[],ff);data.update();data.materials.append(naval);data.materials.append(roof)
    for p,i in zip(data.polygons,mi):p.material_index=i
    shell.data=data
    for obj in list(yaw.children):
        if obj.type=='MESH' and 'roof hatch' in obj.name:bpy.data.objects.remove(obj,do_unlink=True)
    def attach(obj,parent=yaw):obj.parent=parent;obj['assemblyId']=name;return obj
    def local_box(suffix,loc,size,mat=naval):return attach(box(name+'.'+suffix,loc,size,mat,collection))
    def local_rod(suffix,a,b,r,mat=edge):return attach(rod(name+'.'+suffix,a,b,r,mat,collection,vertices=10))
    # The rear hatch and its raised guard follow the curved back, rather than
    # projecting a ladder from the absent square corner of the legacy enclosure.
    local_box('rear access hatch',(-3.015,0,1.55),(.045,.76,1.5))
    for z in [.95,1.6,2.2]:local_rod('hatch dog',(-3.05,-.29,z),(-3.05,-.12,z),.022)
    for y in [-.40,.40]:
        local_rod('rear access rail',(-2.90,y,3.08),(-2.90,y,3.70),.028)
        local_rod('roof access rail',(-2.90,y,3.70),(-2.55,y,3.70),.028)
    for z in [2.4,2.7,3.0]:local_rod('rear access rung',(-2.99,-.37,z),(-2.99,.37,z),.023)
    attach(cyl(name+'.roof vent',(-2.1,0,3.19),.14,.22,naval,collection,16))
    for side in [-1,1]:
        # Side observation boxes are carried by the vertical shell and form the
        # maximum measured width, outside the narrower curved armor envelope.
        local_box('side sight housing',(.95,side*2.405,2.22),(.48,.25,.32))
        local_box('side sight glass',(.95,side*2.54,2.22),(.31,.025,.20),dark)
    # Independently elevating curved gun shields: the source shows a roughly
    # 0.7 m radius cradle shield, with a central bore opening.
    for side in ['left','right']:
        elevation=next(o for o in bpy.context.scene.objects if o.get('nodeId')==name+'.'+side+'.elevation')
        for suffix,a,b in [('lower',-110,-14),('upper',14,110)]:
            n=20;angles=[math.radians(a+(b-a)*i/n) for i in range(n+1)];k=n+1
            vertices=[(r*math.cos(t),y,r*math.sin(t)) for r,y in [(.69,-.33),(.69,.33),(.725,-.33),(.725,.33)] for t in angles];faces=[]
            for i in range(n):faces.extend([(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),(i,2*k+i,2*k+i+1,i+1),(k+i,k+i+1,3*k+i+1,3*k+i)])
            faces.extend([(0,k,3*k,2*k),(n,2*k+n,3*k+n,k+n)])
            attach(mesh(name+'.'+side+' '+suffix+' gun shield',vertices,faces,naval,collection),elevation)
        for y in [-.31,.31]:attach(rod(name+'.shield brace',(-.1,y,0),(.70,y,0),.035,naval,collection,vertices=8),elevation)
    return yaw

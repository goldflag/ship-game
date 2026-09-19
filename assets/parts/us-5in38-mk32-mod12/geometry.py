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
    def local_rod(suffix,a,b,r,mat=edge):return attach(rod(name+'.'+suffix,a,b,r,mat,collection,vertices=6))
    # The rear hatch and its raised guard follow the curved back, rather than
    # projecting a ladder from the absent square corner of the legacy enclosure.
    def rear_x(y):
        a=abs(y)
        return (-2.985+.115*a/.87 if a<=.87 else -2.87+.24*(a-.87)/.55)-.025
    for y in [-1.35,-.75]:
        x=rear_x(y)
        local_rod('rear access rail',(x,y,3.06),(x,y,3.40),.028)
        local_rod('roof access rail',(x,y,3.40),(x+.35,y,3.40),.028)
        local_rod('roof access rail foot',(x+.35,y,3.40),(x+.35,y,3.06),.025)
    for z in [2.4,2.7,3.0]:local_rod('rear access rung',(rear_x(-1.35),-1.35,z),(rear_x(-.75),-.75,z),.023)
    # Rear roof sight hood is a prominent source silhouette, with stepped
    # cheeks and a forward dark observation opening.
    outline=[(-.32,3.10),(.32,3.10),(.32,3.64),(.23,3.76),(-.23,3.76),(-.32,3.64)]
    k=len(outline);vs=[(x,y,z) for x in [-2.68,-1.98] for y,z in outline]
    attach(mesh(name+'.roof sight hood',vs,[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,k+(i+1)%k,k+i) for i in range(k)],naval,collection))
    local_box('roof sight window',(-1.96,0,3.48),(.025,.30,.23),dark)
    attach(cyl(name+'.roof vent',(-2.1,0,3.19),.14,.22,naval,collection,16))
    for side in [-1,1]:
        # Side observation boxes are carried by the vertical shell and form the
        # maximum measured width, outside the narrower curved armor envelope.
        for z in [2.20]:
            local_box('side sight housing',(.95,side*2.405,z),(.48,.25,.32))
            local_box('side sight glass',(.95,side*2.54,z),(.31,.025,.20),dark)
    # Recessed steel port wells close the view into the hollow shell behind
    # each sliding shield, outside the positive-X gun sweep at every elevation.
    for lateral in [-spec['barrelSpacing']/2,spec['barrelSpacing']/2]:
        local_box('gun port rear wall',(-.26,lateral,2.08),(.04,.76,1.55))
        for sign in [-1,1]:
            outline=[(-.28,1.31),(1.36,1.31),(1.36,1.97),(.93,2.70),(-.28,2.86)]
            vertices=[(x,lateral+sign*.365+dy,z) for dy in [-.012,.012] for x,z in outline];k=len(outline)
            faces=[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
            attach(mesh(name+'.gun port cheek',vertices,faces,naval,collection))
    # Independently elevating curved gun shields: the source shows a roughly
    # 0.7 m radius cradle shield, with a central bore opening.
    for side in ['left','right']:
        elevation=next(o for o in bpy.context.scene.objects if o.get('nodeId')==name+'.'+side+'.elevation')
        for suffix,a,b in [('lower',-110,-14),('upper',14,110)]:
            n=10;angles=[math.radians(a+(b-a)*i/n) for i in range(n+1)];k=n+1
            vertices=[(r*math.cos(t),y,r*math.sin(t)) for r,y in [(.69,-.33),(.69,.33),(.725,-.33),(.725,.33)] for t in angles];faces=[]
            for i in range(n):faces.extend([(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),(i,2*k+i,2*k+i+1,i+1),(k+i,k+i+1,3*k+i+1,3*k+i)])
            faces.extend([(0,k,3*k,2*k),(n,2*k+n,3*k+n,k+n)])
            attach(mesh(name+'.'+side+' '+suffix+' gun shield',vertices,faces,naval,collection),elevation)
        for y in [-.31,.31]:attach(rod(name+'.shield brace',(-.1,y,0),(.70,y,0),.035,naval,collection,vertices=8),elevation)
    return yaw

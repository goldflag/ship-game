"""Original Cleveland Hull A triple turret; no external geometry inputs.

Local metres: +X firing, +Y port, +Z up. Hull installation owns the barbette.
Dimensions are a reduced original reconstruction against approved pasc208 A.
"""
import math
import bpy
from mathutils import Vector
from aa_articulation import articulate_aa


def create_mount(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval)
    canvas = materials.get('canvas', dark)
    before = set(bpy.context.scene.objects)
    # The circular bearing mates to the ship's fixed cylindrical barbette.
    cyl(n+'.roller', (0,0,.12), spec['barbetteRadius'], .24, edge, collection, 64)
    outline = [(-5.65,-2.15),(-5.18,-2.85),(-1.4,-3.12),(1.6,-2.92),(2.22,-2.5),
               (2.22,2.5),(1.6,2.92),(-1.4,3.12),(-5.18,2.85),(-5.65,2.15)]
    top = [(x-.1 if x>0 else x, y*.98, 2.78 if x<0 else 2.65) for x,y in outline]
    vertices = [(x,y,.22) for x,y in outline] + top
    faces = [tuple(reversed(range(10)))]
    # Three gun ports occupy the forward flat face; the other shell faces remain closed.
    for i in range(10):
        if i != 4: faces.append((i,(i+1)%10,(i+1)%10+10,i+10))
    body = mesh(n+'.gunhouse', vertices, faces, naval, collection)
    # Clip the original roof outline around three open elevation slots.
    def clip(poly,axis,limit,sign):
        out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            da=sign*(a[axis]-limit);db=sign*(b[axis]-limit)
            if da>=0:out.append(a)
            if (da>=0)!=(db>=0):
                t=da/(da-db);out.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
        return out
    def roof_panel(poly):
        if len(poly)>2:mesh(n+'.roof.panel',poly,[tuple(range(len(poly)))],roof,collection)
    roof_panel(clip(top,0,.65,-1))
    forward=clip(top,0,.65,1)
    gaps=sorted([(c-.43,c+.43) for c in [spec['barrelSpacing'],0,-spec['barrelSpacing']]])
    low=-4
    for a,b in gaps:
        roof_panel(clip(clip(forward,1,low,1),1,a,-1));low=b
    roof_panel(clip(forward,1,low,1))
    def panel(name,y0,y1,z0,z1):
        front=lambda z:2.22-.1*(z-.22)/(2.65-.22)
        return mesh(n+name,[(front(z0),y0,z0),(front(z0),y1,z0),(front(z1),y1,z1),(front(z1),y0,z1)],[(0,1,2,3)],naval,collection)
    panel('.front.sill',-2.5,2.5,.22,.70)
    centers=[spec['barrelSpacing'],0,-spec['barrelSpacing']]
    edges=sorted([(c-.43,c+.43) for c in centers])
    lo=-2.5
    for a,b in edges:
        panel('.front.web',lo,a,.70,2.65);lo=b
    panel('.front.web',lo,2.5,.70,2.65)
    # Rear access and roof fittings all attach directly to the yawing shell.
    box(n+'.rear.door',(-5.69,0,1.30),(.09,.9,1.95),naval,collection)
    for z in [.5,1.3,2.1]:rod(n+'.door.dog',(-5.76,-.32,z),(-5.76,-.14,z),.028,edge,collection,vertices=8)
    for y in [-2.1,2.1]:
        cyl(n+'.roof.hatch',(-3.6,y,2.84),.32,.13,roof,collection,24)
        cyl(n+'.roof.vent',(-4.8,y,2.91),.17,.26,naval,collection,20)
        for z in [.84,1.7]:
            o=cyl(n+'.side.optic',(.8,y/abs(y)*3.01,z),.14,.11,edge,collection,20)
            o.rotation_euler.x=math.pi/2
    for z in [.45,.78,1.11,1.44,1.77,2.10,2.43]:
        rod(n+'.face.ladder.rung',(2.31,.53,z),(2.31,.79,z),.024,edge,collection,vertices=8)
    for y in [.52,.80]:rod(n+'.face.ladder.rail',(2.27,y,.3),(2.17,y,2.68),.026,naval,collection,vertices=8)
    rod(n+'.roof.sight',(-.4,0,2.72),(-.4,0,3.42),.045,naval,collection,vertices=12)
    frame = list(set(bpy.context.scene.objects)-before)
    groups=[]
    for lateral in centers:
        start=set(bpy.context.scene.objects)
        pivot=spec['trunnionForward'];height=spec['pivotHeight'];muzzle=spec['muzzleForward']
        slope=math.tan(math.radians(1))
        def pt(x):return (x,lateral,height+(x-pivot)*slope)
        # Stepped jacket, chase and bored muzzle, owned by this barrel's recoil joint.
        sections=[(pivot,.22),(2.6,.20),(3.5,.17),(3.65,.135),(5.7,.105),(muzzle,.092)]
        for (a,ra),(b,rb) in zip(sections,sections[1:]):rod(n+'.barrel',pt(a),pt(b),ra,edge,collection,r2=rb,vertices=24)
        rod(n+'.bore',pt(muzzle+.005),pt(muzzle+.008),spec['caliberM']/2,dark,collection,vertices=24)
        # Pleated canvas mantlet around the rotating sleeve, at neutral elevation.
        rings=[(.95,.29),(1.30,.39),(1.7,.46),(2.1,.44),(2.45,.32),(2.70,.23)]
        vv=[];ff=[];sides=24
        for x,r in rings:
            for i in range(sides):
                a=i*math.tau/sides;rr=r*(1+.065*math.cos(6*a))
                vv.append((x,lateral+rr*math.cos(a),height+(x-pivot)*slope+rr*math.sin(a)))
        for j in range(len(rings)-1):
            for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;ff.append((a,b,b+sides,a+sides))
        mesh(n+'.canvas',vv,ff,canvas,collection,True)
        groups.append(list(set(bpy.context.scene.objects)-start))
    return articulate_aa(mount,collection,frame,groups)

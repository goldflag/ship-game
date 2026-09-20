"""Original Cleveland Hull A triple turret; no external geometry inputs.

Local metres: +X firing, +Y port, +Z up. Hull installation owns the barbette.
Dimensions are a reduced original reconstruction against approved pasc208 A.
"""
import math
import bpy
from mathutils import Vector
from aa_articulation import articulate_aa
from gun_bloomers import create_bloomer


def create_mount(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval)
    canvas = materials.get('canvas', dark)
    before = set(bpy.context.scene.objects)
    # The circular bearing mates to the ship's fixed cylindrical barbette.
    cyl(n+'.roller', (0,0,.12), spec['barbetteRadius'], .24, edge, collection, 32)
    outline = [(-5.40,-2.35),(-5.18,-2.70),(-1.4,-3.12),(1.6,-2.92),(2.22,-2.5),
               (2.22,2.5),(1.6,2.92),(-1.4,3.12),(-5.18,2.70),(-5.40,2.35)]
    # Face rake and rear tumblehome are visual recipe dimensions; ballistics stay canonical.
    top = [(x-1.12 if x>0 else x-.12, y*.96, 2.60) for x,y in outline]
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
    roof_panel(clip(top,0,1.00,-1))
    forward=clip(top,0,1.00,1)
    gaps=sorted([(c-.43,c+.43) for c in [spec['barrelSpacing'],0,-spec['barrelSpacing']]])
    low=-4
    for a,b in gaps:
        roof_panel(clip(clip(forward,1,low,1),1,a,-1));low=b
    roof_panel(clip(forward,1,low,1))
    def panel(name,y0,y1,z0,z1):
        front=lambda z:2.22-1.12*(z-.22)/(2.60-.22)
        return mesh(n+name,[(front(z0),y0,z0),(front(z0),y1,z0),(front(z1),y1,z1),(front(z1),y0,z1)],[(0,1,2,3)],naval,collection)
    panel('.front.sill',-2.5,2.5,.22,.70)
    centers=[spec['barrelSpacing'],0,-spec['barrelSpacing']]
    edges=sorted([(c-.43,c+.43) for c in centers])
    lo=-2.5
    for a,b in edges:
        panel('.front.web',lo,a,.70,2.60);lo=b
    panel('.front.web',lo,2.5,.70,2.60)
    # Rear access and roof fittings all attach directly to the yawing shell.
    # Paired rear access hoods replace the unsupported central door/hatch pattern.
    for y in [-1.65,1.65]:
        box(n+'.rear.access',(-5.50,y,1.35),(.14,.86,1.38),naval,collection)
        box(n+'.rear.hood',(-5.56,y,2.06),(.28,.94,.16),roof,collection)
    for side in [-1,1]:
        for z in [1.20,1.80]:
            o=cyl(n+'.side.optic',(.50,side*2.96,z),.14,.11,edge,collection,10)
            o.rotation_euler.x=math.pi/2
    for y in [-spec['barrelSpacing']/2,spec['barrelSpacing']/2]:
        for z in [.45,.78,1.11,1.44,1.77,2.10,2.43]:
            x=2.22-1.12*(z-.22)/2.38+.05
            rod(n+'.face.ladder.rung',(x,y-.13,z),(x,y+.13,z),.024,edge,collection,vertices=4)
        for dy in [-.13,.13]:
            rod(n+'.face.ladder.rail',(2.24,y+dy,.25),(1.12,y+dy,2.60),.023,naval,collection,vertices=4)
    rod(n+'.roof.sight',(-.4,0,2.59),(-.4,0,3.25),.045,naval,collection,vertices=12)
    frame = list(set(bpy.context.scene.objects)-before)
    groups=[]
    for lateral in centers:
        start=set(bpy.context.scene.objects)
        pivot=spec['trunnionForward'];height=spec['pivotHeight'];muzzle=spec['muzzleForward']
        slope=math.tan(math.radians(1))
        def pt(x):return (x,lateral,height+(x-pivot)*slope)
        # Stepped jacket, chase and bored muzzle, owned by this barrel's recoil joint.
        sections=[(pivot,.22),(2.6,.20),(3.5,.20),(3.65,.135),(5.7,.123),(muzzle,.108)]
        for (a,ra),(b,rb) in zip(sections,sections[1:]):
            barrel=rod(n+'.barrel',pt(a),pt(b),ra,edge,collection,r2=rb,vertices=12)
            for p in barrel.data.polygons:p.use_smooth=len(p.vertices)==4
        rod(n+'.bore',pt(muzzle+.005),pt(muzzle+.008),spec['caliberM']/2,dark,collection,vertices=12)
        groups.append(list(set(bpy.context.scene.objects)-start))
    yaw=articulate_aa(mount,collection,frame,groups)
    # Seam follows the full three-dimensional aperture: up the face, back over
    # the roof slot, and down again. The cloth stays attached at every pitch.
    contour=[(2.18,.455,1.675),(2.15,.455,2.18),(2.12,.455,2.68),
             (1.37,.455,2.70),(.62,.455,2.72),(.62,.23,2.72),(.62,0,2.72),
             (.62,-.23,2.72),(.62,-.455,2.72),(1.37,-.455,2.70),
             (2.12,-.455,2.68),(2.15,-.455,2.18),(2.18,-.455,1.675),
             (2.20,-.455,1.34),(2.215,-.455,1.0),(2.225,-.455,.675),
             (2.225,-.30,.675),(2.225,-.15,.675),(2.225,0,.675),
             (2.225,.15,.675),(2.225,.30,.675),(2.225,.455,.675),
             (2.215,.455,1.0),(2.20,.455,1.34)]
    # Seat the complete face/roof seam on the raked aperture.
    contour=[(max(1.00,x-1.02*max(0,min(1,(z-.22)/2.43))),y,z-.05*max(0,(z-.70)/2)) for x,y,z in contour]
    for side,lateral in zip(['left','center','right'],centers):
        cover=create_bloomer(mount,collection,helpers,materials,side,
                       [(x,y+lateral,z) for x,y,z in contour],2.70,.20,
                       rings=5,fold_depth=.065,slack=.08,fullness=.11,forward_fullness=.16)

        # Upper cloth folds stand proud of the roof return. Only interior rings
        # change; the seam and sliding cuff retain their exact attachment loci.
        for shape in cover.data.shape_keys.key_blocks:
            for j in range(1,4):
                for i in range(24):
                    shape.data[j*24+i].co.z += .40*math.sin(math.pi*j/4)*max(0,math.sin(i*math.tau/24))
    return yaw

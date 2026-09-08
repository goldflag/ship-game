"""Original E/E3 gunhouse fittings and gun-port geometry on stable shared joints."""
import math
import bpy
from mathutils import Matrix


def finish_main_mount(mount,collection,helpers,materials):
    mesh,box,cyl,rod=(helpers[k] for k in ('mesh','box','cyl','rod'))
    nodes={o.get('nodeId'):o for o in bpy.context.scene.objects if o.get('nodeId')}
    yaw=nodes[mount['id']+'.yaw'];created=set(bpy.context.scene.objects)
    def parent(o,node=yaw):o.parent=node;o.matrix_parent_inverse=Matrix.Identity(4);o['assemblyId']=mount['id'];return o
    def cube(name,p,size,mat='naval',node=yaw):return parent(box(name,p,size,mat,collection),node)
    def line(name,a,b,r,mat='edge',node=yaw,n=10):return parent(rod(name,a,b,r,mat,collection,vertices=n),node)
    def disc(name,p,r,h,mat='naval',node=yaw):return parent(cyl(name,p,r,h,mat,collection,vertices=24),node)
    members=[o for o in bpy.context.scene.objects if o.get('assemblyId')==mount['id']]
    body=next(o for o in members if 'sloped gunhouse' in o.name)
    for o in members:
        if 'roof hatch' in o.name or 'canvas mantlet' in o.name:bpy.data.objects.remove(o,do_unlink=True)
    # Recessed openings in the curved front face. Keep the armor's closed outer
    # envelope in the catalog; these visible recesses expose the seated mechanisms.
    for side,gy in [('left',-mount['weapon']['barrelSpacing']/2),('right',mount['weapon']['barrelSpacing']/2)]:
        cutter=cube('Temporary gun-port cutter',(2.65,gy,1.55),(3.0,1.12,2.20))
        bpy.context.view_layer.update();mod=body.modifiers.new('Recessed gun opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        bpy.context.view_layer.objects.active=body
        bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
        elevation=nodes[mount['id']+'.'+side+'.elevation']
        # Broad fabric bag with a drooping middle and narrow barrel collar.
        rings=[(-.60,.54,.75,-.05),(0,.54,.73,-.12),(.60,.44,.52,-.23),(1.30,.30,.32,-.14),(2.03,.24,.24,0)]
        v=[];n=24
        for j,(x,ry,rz,dz) in enumerate(rings):
            for i in range(n):
                t=i*math.tau/n;fold=1+.026*math.sin(i*3+j*1.7)
                v.append((x,ry*math.cos(t)*fold,dz+rz*math.sin(t)*fold))
        f=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)]
        parent(mesh('E mount canvas blast bag',v,f,materials['canvas'],collection,True),elevation)
        line('Blast bag forward lashing',(1.98,0,0),(2.08,0,0),.255,'rope',elevation,24)
        for y in (gy-.585,gy+.585):
            zs=[.08,.55,1.0,1.4,1.7,1.9,2.05]
            pts=[(1.12+1.55*math.sqrt(max(0,1-(z/2.08)**2))+.025,y,z) for z in zs]
            for a,b in zip(pts,pts[1:]):line('Gun opening armor rim',a,b,.04,'edge')
        cube('Gun opening top rim',(1.43,gy,2.10),(.45,1.26,.10),'naval')
        for y in (gy-.46,gy+.46):
            line('Mantlet cheek pivot',(1.62,y,1.28),(1.92,y,1.28),.16,'edge',n=20)
    # Flat roof, central sight, narrow plate joints and restrained fasteners.
    disc('Central roof sight drum',(-1.05,0,2.22),.39,.28)
    cube('Central roof sight hood',(-.95,0,2.38),(.88,.74,.17))
    cube('Roof sight glass',(-.495,0,2.35),(.018,.55,.13),'glass')
    for x in (-4.5,-2.7,-.4):line('Roof plate seam',(x,-2.42,2.085),(x,2.42,2.085),.013)
    for y in (-1.55,1.55):line('Roof longitudinal seam',(-4.9,y,2.085),(.80,y,2.085),.013)
    for sign in (-1,1):
        for x in (-4.65,-3.35,-2.05,-.75,.5):
            line('Gunhouse panel seam',(x,sign*2.823,.12),(x,sign*2.568,1.88),.013)
            for z in (.22,.51,.8,1.09,1.38,1.67,1.88):
                # Low-poly rivet heads stay seated on the sloped side armor.
                y=sign*(2.84-z*.145+.009)
                line('Gunhouse plate rivet',(x,y,z),(x,y+sign*.022,z),.022,'edge',n=6)
        line('Gunhouse horizontal seam',(-4.7,sign*2.69,1.04),(.6,sign*2.69,1.04),.013)
        # The reference's access fittings are on the rear face, not large side boxes.
        cube('Rear access panel',(-5.335,sign*.93,1.04),(.045,.65,1.3),'naval')
        for z in (.56,1.10,1.63):cube('Rear hatch hinge',(-5.365,sign*1.24,z),(.065,.12,.14),'edge')
        line('Rear hatch handle',(-5.38,sign*.8,.92),(-5.38,sign*.8,1.14),.027)
    if mount['rangefinder']:
        line('E mount rangefinder tube',(-3.9,-4.15,1.85),(-3.9,4.15,1.85),.18,'naval',n=24)
        for sign in (-1,1):
            y=sign*4.09
            cube('E mount armored optical hood',(-4.10,y,1.94),(1.74,.49,.96))
            cube('Rangefinder optical glass',(-3.218,y,1.95),(.018,.26,.31),'glass')
            line('Rangefinder inner bearing',(-3.9,sign*2.52,1.85),(-3.9,sign*3.55,1.85),.28,'naval',n=20)
    # Add a riveted skirt and narrow race rather than an unbroken white cylinder.
    radius=mount['weapon']['barbetteRadius']
    for i in range(24):
        t=i*math.tau/24
        line('Barbette race fastener',(radius*math.cos(t),radius*math.sin(t),-.13),(radius*math.cos(t),radius*math.sin(t),-.09),.035,'edge',n=6)
    for o in set(bpy.context.scene.objects)-created:o['assemblyId']=mount['id']

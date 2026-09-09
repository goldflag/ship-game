"""Original Type C turret extracted from Yukikaze source, with stable catalog joints."""
import bpy, math
from mathutils import Vector, Matrix
from blender_barrels import barrel_layout
from blender_components import create_gun_mount

def create_mount(mount,col,helpers,materials):
    materials=dict(materials)
    materials.setdefault('glass',materials['dark'])
    mesh0,cyl0,rod0,box0=(helpers[k] for k in ['mesh','cyl','rod','box'])
    def mesh(n,v,f,m,collection=col,smooth=False):return mesh0(n,v,f,m,collection,smooth)
    def cyl(n,p,r,d,m,collection=col,vertices=24,r2=None):return cyl0(n,p,r,d,m,collection,vertices,r2)
    def rod(n,a,b,r,m,collection=col,r2=None,vertices=10):return rod0(n,a,b,r,m,collection,r2,vertices)
    def box(n,p,d,m,collection=col,bev=.035):return box0(n,p,d,m,collection,bev)
    def local(obj,parent,assembly=None):
        obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4)
        if assembly:obj['assemblyId']=assembly
        return obj
    
    def tube_path(name,points,r,mat,sides=8,closed=False):
        pts=[Vector(p) for p in points];verts=[];n=len(pts)
        for i,p in enumerate(pts):
            delta=pts[(i+1)%n]-pts[(i-1)%n] if closed else pts[min(i+1,n-1)]-pts[max(i-1,0)]
            q=delta.to_track_quat('Z','Y')
            verts += [p+q@Vector((r*math.cos(j*math.tau/sides),r*math.sin(j*math.tau/sides),0)) for j in range(sides)]
        faces=[]
        for i in range(n if closed else n-1):
            k=(i+1)%n
            faces += [(i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j) for j in range(sides)]
        if not closed:faces += [tuple(reversed(range(sides))),tuple((n-1)*sides+j for j in range(sides))]
        return mesh(name,verts,faces,mat,smooth=True)
    
    def refined_main(mount,yaw):
        from mathutils.geometry import intersect_ray_tri
        from mathutils.bvhtree import BVHTree
        name=mount['id'];sp=mount['weapon'];shape=sp['gunhouseMesh']
        skin=BVHTree.FromPolygons([Vector(v) for v in shape['vertices']],[f['indices'] for f in shape['faces']],all_triangles=True)
        def put(o,parent=yaw):return local(o,parent,name)
        def roof(x,y):
            hits=[intersect_ray_tri(*[Vector(shape['vertices'][i]) for i in f['indices']],Vector((0,0,-1)),Vector((x,y,5))) for f in shape['faces']]
            return max((h.z for h in hits if h is not None),default=.3)
        # Shared sockets survive; replace only the generic external fittings.
        for o in list(col.objects):
            if o.get('assemblyId')==name and o.type=='MESH' and any(t in o.name for t in ['canvas mantlet',' • barrel','recessed bore','roof hatch']):bpy.data.objects.remove(o,do_unlink=True)
        for side,gy,_ in barrel_layout(sp):
            elev=next(o for o in col.objects if o.get('nodeId')==name+'.'+side+'.elevation')
            rec=next(o for o in col.objects if o.get('nodeId')==name+'.'+side+'.recoil')
            # Broad fabric boot seated at the trunnion, tapering around the recoiling chase.
            rings=[(-.30,.32,.64,.12),(.08,.34,.65,.06),(.55,.30,.43,-.02),(1.0,.23,.27,-.025),(1.48,.184,.184,0),(1.82,.184,.184,0)]
            vs=[];N=32
            for k,(x,ry,rz,cz) in enumerate(rings):
                for j in range(N):
                    t=j*math.tau/N;fold=1+.028*math.cos(t*7+k*.8)
                    vs.append((x,ry*math.cos(t)*fold,cz+rz*math.sin(t)*fold))
            fs=[(k*N+j,k*N+(j+1)%N,(k+1)*N+(j+1)%N,(k+1)*N+j) for k in range(len(rings)-1) for j in range(N)]
            put(mesh(name+'.blast-bag',vs,fs,materials['canvas'],smooth=True),elev)
            put(rod(name+'.boot-cuff',(1.76,0,0),(1.85,0,0),.19,materials['canvas'],vertices=32),elev)
            for a,b,ra,rb in [(-.2,1.9,.17,.17),(1.9,2.1,.17,.15),(2.1,4.56,.15,.116),(4.56,4.64,.116,.123)]:
                put(rod(name+'.chase',(a,0,0),(b,0,0),ra,materials['edge'],r2=rb,vertices=32),rec)
            put(rod(name+'.bore',(4.634,0,0),(4.644,0,0),.0635,materials['dark'],vertices=24),rec)
        # Low roof-edge safety rails; each foot follows the authored roof facets.
        path=[(1.05,-1.16),(.95,-1.85),(.57,-2.22),(-.90,-2.22),(-2.70,-1.80),(-3.32,-1.42),(-3.38,0),(-3.32,1.42),(-2.70,1.80),(-.90,2.22),(.57,2.22),(.95,1.85),(1.05,1.16)]
        pts=[(x,y,roof(x,y)) for x,y in path]
        put(tube_path(name+'.roof-edge-rail',[(x,y,z+.19) for x,y,z in pts],.019,materials['edge']))
        for x,y,z in pts:put(rod(name+'.rail-foot',(x,y,z-.012),(x,y,z+.19),.019,materials['naval']))
        # Circular deck plates, short grabs and the offset sighting hood seen in the source.
        for x,y in [(-2.6,-.6),(-2.6,.6),(-1.5,-1.65),(-1.5,1.65),(.60,-1.85),(.60,1.85),(-.80,-.53),(-.80,.53)]:
            put(cyl(name+'.roof-vent',(x,y,roof(x,y)+.027),.17,.054,materials['naval'],vertices=24))
        for y in [-.56,.56]:
            pts=[(-2.05,y,roof(-2.05,y)),(-2.05,y,roof(-2.05,y)+.16),(-.9,y,roof(-.9,y)+.16),(-.9,y,roof(-.9,y))]
            put(tube_path(name+'.roof-grab',pts,.018,materials['edge']))
        x,y=.05,-1.5;z=roof(x,y)
        put(box(name+'.sight-hood',(x,y,z+.19),(.60,.65,.36),materials['naval'],bev=.075))
        put(box(name+'.sight-glass',(x+.307,y,z+.2),(.012,.39,.14),materials['glass'],bev=.015))
        for sign in [-1,1]:
            # The handrails follow the tapered side rather than floating outside it.
            side=[(1.27,sign*1.05),(.98,sign*1.97),(.58,sign*2.35),(-.95,sign*2.35),(-2.8,sign*1.99),(-3.49,sign*1.18)]
            for z in [.38,1.03,1.96]:
                contacts=[skin.find_nearest(Vector((x,y,z)))[:2] for x,y in side]
                put(tube_path(name+'.side-rail',[p+n*.05 for p,n in contacts],.016,materials['edge']))
                for p,n in contacts:put(rod(name+'.side-rail-foot',p-n*.012,p+n*.05,.020,materials['naval']))
            put(box(name+'.rear-door',(-3.53,sign*.69,1.08),(.065,.73,1.36),materials['naval'],bev=.09))
            put(rod(name+'.door-handle',(-3.58,sign*.46,.94),(-3.58,sign*.46,1.10),.018,materials['edge']))
            for z in [.48,.83,1.18,1.53,1.88]:
                put(tube_path(name+'.rear-step',[(-3.48,sign*.16,z),(-3.62,sign*.16,z),(-3.62,sign*.36,z),(-3.48,sign*.36,z)],.018,materials['edge']))
        # Visible radial floor knees connect the overhanging apron to the bearing ring.
        for i in range(12):
            t=i*math.tau/12;x,y=math.cos(t),math.sin(t)
            r=1.48 if x>.5 else 1.83
            o=put(mesh(name+'.floor-knee',[(x*1.35,y*1.35,.055),(x*1.35,y*1.35,.30),(x*r,y*r,.30)],[(0,1,2)],materials['naval']));mod=o.modifiers.new('Knee plate thickness','SOLIDIFY');mod.thickness=.022
    
    # The ship provides any platform beneath this mounting's yaw datum.
    create_gun_mount(mount,col,helpers,materials,helpers.get('deck_height',lambda x:mount['position'][1]))
    name=mount['id'];yaw=next(o for o in col.objects if o.get('nodeId')==name+'.yaw')
    house=next(o for o in col.objects if o.get('assemblyId')==name and 'sloped gunhouse' in o.name)
    for face in house.data.polygons:face.use_smooth=True
    house.data.set_sharp_from_angle(angle=math.radians(32))
    bevel=house.modifiers.new('Rolled Type C edges','BEVEL');bevel.width=.14;bevel.segments=5
    normals=house.modifiers.new('Type C plate normals','WEIGHTED_NORMAL');normals.keep_sharp=True;normals.weight=35
    refined_main(mount,yaw)
    return yaw

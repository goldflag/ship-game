"""Original Type C turret extracted from Yukikaze source, with stable catalog joints."""
import bpy, math
from mathutils import Vector, Matrix
from blender_barrels import barrel_layout
from blender_components import create_gun_mount
from gun_bloomers import create_bloomer

def create_mount(mount,col,helpers,materials):
    materials=dict(materials)
    materials.setdefault('glass',materials['dark'])
    mesh0,cyl0,rod0,box0=(helpers[k] for k in ['mesh','cyl','rod','box'])
    def mesh(n,v,f,m,collection=col,smooth=False):return mesh0(n,v,f,m,collection,smooth)
    def cyl(n,p,r,d,m,collection=col,vertices=12,r2=None):return cyl0(n,p,r,d,m,collection,vertices,r2)
    def rod(n,a,b,r,m,collection=col,r2=None,vertices=10):return rod0(n,a,b,r,m,collection,r2,vertices)
    def box(n,p,d,m,collection=col,bev=.035):return box0(n,p,d,m,collection,bev)
    def local(obj,parent,assembly=None):
        obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4)
        if assembly:obj['assemblyId']=assembly
        if obj.type=='MESH' and '.chase' in obj.name:
            for polygon in obj.data.polygons:polygon.use_smooth=len(polygon.vertices)==4
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
    
    def refined_main(mount,yaw,shape):
        from mathutils.geometry import intersect_ray_tri
        from mathutils.bvhtree import BVHTree
        name=mount['id'];sp=mount['weapon']
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
            # The seam follows the original gunhouse face, while the cuff
            # pitches with the gun and lets the chase slide through on recoil.
            rim=[]
            for j in range(24):
                angle=j*math.tau/24;c,ss=math.cos(angle),math.sin(angle)
                square=max(abs(c),abs(ss))
                y=gy+.402*c/square;z=1.735+.635*ss/square
                # Follow the slot's front cheek, then its return 1.6 m aft
                # across the roof. A face-only rim leaves the roof cutout open.
                x=1.53-(z-1.10)*.13/.57 if z<=1.67 else 1.40-(z-1.67)*1.87/.70
                rim.append((x+.018,y,z))
            create_bloomer(mount,col,helpers,materials,side,rim,sp['trunnionForward']+1.82,.184,
                           rings=6,fold_depth=.045,slack=.075,fullness=.045,forward_fullness=.04)
            for a,b,ra,rb in [(-.2,1.9,.17,.17),(1.9,2.1,.17,.15),(2.1,4.56,.15,.116),(4.56,4.64,.116,.123)]:
                put(rod(name+'.chase',(a,0,0),(b,0,0),ra,materials['edge'],r2=rb,vertices=16),rec)
            put(rod(name+'.bore',(4.634,0,0),(4.644,0,0),.0635,materials['dark'],vertices=12),rec)
        # Low roof-edge safety rails; each foot follows the authored roof facets.
        path=[(1.23,-1.16),(1.12,-1.85),(.60,-2.15),(-.90,-2.22),(-2.70,-1.80),(-3.30,-1.42),(-3.44,0),(-3.30,1.42),(-2.70,1.80),(-.90,2.22),(.60,2.15),(1.12,1.85),(1.23,1.16)]
        pts=[(x,y,roof(x,y)) for x,y in path]
        put(tube_path(name+'.roof-edge-rail',[(x,y,z+.19) for x,y,z in pts],.019,materials['edge']))
        for x,y,z in pts:put(rod(name+'.rail-foot',(x,y,z-.012),(x,y,z+.19),.019,materials['naval']))
        # Circular deck plates, short grabs and the offset sighting hood seen in the source.
        for x,y in [(-2.6,-.6),(-2.6,.6),(-1.5,-1.65),(-1.5,1.65),(.60,-1.85),(.60,1.85),(-.80,-.53),(-.80,.53)]:
            put(cyl(name+'.roof-vent',(x,y,roof(x,y)+.027),.17,.054,materials['naval'],vertices=12))
        for y in [-.56,.56]:
            pts=[(-2.05,y,roof(-2.05,y)),(-2.05,y,roof(-2.05,y)+.16),(-.9,y,roof(-.9,y)+.16),(-.9,y,roof(-.9,y))]
            put(tube_path(name+'.roof-grab',pts,.018,materials['edge']))
        x,y=.40,1.50;z=roof(x,y)
        put(box(name+'.sight-hood',(x,y,z+.24),(.90,.65,.48),materials['naval'],bev=.075))
        put(box(name+'.sight-glass',(x+.457,y,z+.25),(.012,.39,.12),materials['glass'],bev=.015))
        for sign in [-1,1]:
            # The handrails follow the tapered side rather than floating outside it.
            side=[(1.60,sign*1.05),(1.40,sign*1.97),(.58,sign*2.35),(-.95,sign*2.35),(-2.8,sign*1.99),(-3.49,sign*1.18)]
            for z in [.38,1.03,1.66]:
                contacts=[skin.find_nearest(Vector((x,y,z)))[:2] for x,y in side]
                put(tube_path(name+'.side-rail',[p+n*.05 for p,n in contacts],.016,materials['edge']))
                for p,n in contacts:put(rod(name+'.side-rail-foot',p-n*.012,p+n*.05,.020,materials['naval']))
            put(box(name+'.rear-door',(-3.40,sign*.78,1.15),(.065,1.03,1.61),materials['naval'],bev=.09))
            put(rod(name+'.door-handle',(-3.442,sign*.46,.94),(-3.442,sign*.46,1.10),.018,materials['edge']))
            for z in [.37,2.04]:
                put(tube_path(name+'.rear-step',[(-3.48,sign*.16,z),(-3.62,sign*.16,z),(-3.62,sign*.36,z),(-3.48,sign*.36,z)],.018,materials['edge']))
        # Visible radial floor knees connect the overhanging apron to the bearing ring.
        for i in range(12):
            t=i*math.tau/12;x,y=math.cos(t),math.sin(t)
            r=1.58 if x>.5 else (2.23 if abs(y)>.70 else 2.85)
            o=put(mesh(name+'.floor-knee',[(x*1.35,y*1.35,.055),(x*1.35,y*1.35,.30),(x*r,y*r,.30)],[(0,1,2)],materials['naval']));mod=o.modifiers.new('Knee plate thickness','SOLIDIFY');mod.thickness=.022
    
    # The ship provides any platform beneath this mounting's yaw datum.
    create_gun_mount(mount,col,helpers,materials,helpers.get('deck_height',lambda x:mount['position'][1]))
    name=mount['id'];yaw=next(o for o in col.objects if o.get('nodeId')==name+'.yaw')
    house=next(o for o in col.objects if o.get('assemblyId')==name and 'sloped gunhouse' in o.name)
    # Original shell sections separate the rounded low forward shoulders
    # from the raised aft roof. Gun slots remain open through the roof return.
    stations=[(-3.55,.85,2.22,2.22),(-3.35,1.55,2.24,2.32),
              (-2.70,1.98,2.25,2.36),(-1.00,2.34,2.25,2.36),
              (-.15,2.34,2.20,2.36),(.50,2.34,1.66,1.66),
              (1.30,2.15,1.66,1.66),(1.60,1.75,1.66,1.66)]
    v=[];f=[]
    for x,w,edge,peak in stations:
        scale=min(1,w/1.3)
        for y in [-w,-max(w*.70,.925*scale),-.925*scale,-.145*scale,.145*scale,.925*scale,max(w*.70,.925*scale),w]:
            # Clamp inner ribs at the rounded stern.
            y=max(-w,min(w,y));z=edge+(peak-edge)*max(0,1-max(0,abs(y)-.925)/max(.01,w-.925))
            v.append((x-.25*max(0,min(1,(x-.30)/1.30))*(z-.30)/1.36,y,z))
        v += [(x,-w,.30),(x,w,.30)]
    for i in range(len(stations)-1):
        a=i*10;b=a+10
        for j in range(7):
            if i>=4 and j in [2,4]:continue
            f.append((a+j,b+j,b+j+1,a+j+1))
        f.extend([(a+8,b+8,b,a),(a+7,b+7,b+9,a+9),(a+9,b+9,b+8,a+8)])
    f.append(tuple([8]+list(range(8))+[9]))
    f.append(tuple(reversed([78]+list(range(70,78))+[79])))
    # Triangulate once for the contact queries as well as the rendered skin.
    from mathutils.geometry import tessellate_polygon
    triangles=[]
    for face in f:
        pts=[Vector(v[i]) for i in face]
        for tri in tessellate_polygon([pts]):triangles.append(tuple(face[q] if isinstance(q,int) else face[min(range(len(pts)),key=lambda j:(pts[j]-q).length_squared)] for q in tri))
    shape={'vertices':v,'faces':[{'indices':t} for t in triangles]}
    old=house.data;data=bpy.data.meshes.new(name+'.original-shell');data.from_pydata(v,[],triangles);data.update()
    for m in old.materials:data.materials.append(m)
    house.data=data
    # The generic installer authored the old vertices at the ship's world Z.
    # This replacement is entirely yaw-local, including installed ship builds.
    house.matrix_parent_inverse=Matrix.Identity(4);house.matrix_basis=Matrix.Identity(4)
    for face in house.data.polygons:face.use_smooth=abs(face.normal.z)<.15
    house.data.set_sharp_from_angle(angle=math.radians(28))
    bevel=house.modifiers.new('Rolled Type C edges','BEVEL');bevel.width=.12;bevel.segments=2
    bevel.angle_limit=math.radians(25)
    normals=house.modifiers.new('Type C plate normals','WEIGHTED_NORMAL');normals.keep_sharp=True;normals.weight=35
    refined_main(mount,yaw,shape)
    return yaw

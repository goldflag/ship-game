"""Original Mk30 enclosure and mechanisms extracted from Fletcher revision 4.

The same catalog facets, stable joints and fittings are reusable without loading
published assets. Standalone fidelity remains unreviewed; see README.md.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from blender_components import create_gun_mount

def create_mount(mount, col, helpers, materials, detail_adjust=None):
    materials=dict(materials)
    for key,fallback in [('roof','naval'),('hullgray','naval'),('canvas','naval')]: materials.setdefault(key,materials[fallback])
    mesh0,cyl0,rod0,box0=(helpers[k] for k in ['mesh','cyl','rod','box'])
    def mesh(name,vs,fs,mat,collection=col,smooth=False):return mesh0(name,vs,fs,mat,collection,smooth)
    def cyl(name,loc,radius,depth,mat,collection=col,vertices=24,r2=None):return cyl0(name,loc,radius,depth,mat,collection,vertices,r2)
    def rod(name,a,b,r,mat,collection=col,r2=None,vertices=10):return rod0(name,a,b,r,mat,collection,r2,vertices)
    def box(name,loc,dim,mat,collection=col,bev=.035):return box0(name,loc,dim,mat,collection,bev)
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

    before=set(col.objects)
    create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,lambda x: mount['position'][1]-(.5 if detail_adjust else 0))
    name=mount['id'];yaw=next(o for o in col.objects if o.get('nodeId')==name+'.yaw')
    recoil=next(o for o in col.objects if o.get('nodeId')==name+'.center.recoil')
    spec=mount['weapon'];H=spec['gunhouseSize'][2]
    elevation=next(o for o in col.objects if o.get('nodeId')==name+'.center.elevation')
    # Keep catalog joints/sockets; replace generic surface details and barrel only.
    for o in list(recoil.children):
        if o.type=='MESH':bpy.data.objects.remove(o,do_unlink=True)
    for o in set(col.objects)-before:
        if o.type=='MESH' and 'roof hatch' in o.name:bpy.data.objects.remove(o,do_unlink=True)
    house=next(o for o in set(col.objects)-before if o.type=='MESH' and 'sloped gunhouse' in o.name)
    bevel=house.modifiers.new('Mk30 rolled plate edges','BEVEL');bevel.width=.035;bevel.segments=3
    base_parts=set(col.objects)
    # Curved elevating shield slides inside the catalog's actual central recess.
    # It follows elevation, while the gun and weather sleeve also follow recoil.
    vs=[];n=49
    for y in [-.355,.355]:
        vs.append((0,y,0))
        for i in range(n):
            a=math.radians(-78+190*i/(n-1));vs.append((.99*math.cos(a),y,.99*math.sin(a)))
    fs=[]
    for i in range(1,n):
        fs += [(0,i+1,i),(n+1,n+1+i,n+2+i),(i,i+1,n+2+i,n+1+i)]
    fs += [(0,1,n+2,n+1),(0,n+1,2*n+1,n)]
    shield=local(mesh(name+'.elevating-shield',vs,fs,materials['naval']),elevation,name)
    for i,p in enumerate(shield.data.polygons):p.use_smooth=i%3==2 and i<3*(n-1)
    bm=bmesh.new();bm.from_mesh(shield.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(shield.data);bm.free()
    # Original elliptical fabric sleeve, with a rolled retaining ring.
    sections=[(.66,.32,.36),(.90,.36,.38),(1.18,.31,.28),(1.40,.22,.19),(1.53,.155,.155)]
    vs=[(x,ry*math.cos(j*math.tau/32),rz*math.sin(j*math.tau/32)) for x,ry,rz in sections for j in range(32)]
    fs=[(k*32+j,k*32+(j+1)%32,(k+1)*32+(j+1)%32,(k+1)*32+j) for k in range(len(sections)-1) for j in range(32)]
    local(mesh(name+'.weather-sleeve',vs,fs,materials['canvas'],smooth=True),recoil,name)
    length=spec['muzzleForward']-spec['trunnionForward']
    for a,b,r0,r1 in [(1.49,1.60,.156,.148),(1.60,2.05,.148,.125),(2.05,length,.125,.079)]:
        local(rod(name+'.barrel',(a,0,0),(b,0,0),r0,materials['edge'],r2=r1,vertices=32),recoil,name)
    local(rod(name+'.bore',(length+.002,0,0),(length+.012,0,0),spec['caliberM']/2,materials['dark'],vertices=32),recoil,name)
    for side in [-1,1]:
        y=side*1.503
        # Long side grab rails, short rear grab, and the pair of sight shutters.
        for a,b,z in [(-1.9,.28,1.02),(-2.55,-1.94,2.20)]:
            local(rod(name+'.side-handhold',(a,y,z),(b,y,z),.019,materials['edge']),yaw,name)
            for x in [a,b]:local(rod(name+'.handhold-standoff',(x,side*1.48,z),(x,y,z),.022,materials['edge']),yaw,name)
        shutter=local(box(name+'.sight-shutter',(.67,side*.91,2.72),(.12,.57,.28),materials['naval'],bev=.025),yaw,name)
        shutter.rotation_euler.y=math.radians(31)
        local(tube_path(name+'.gunport-guide',[(-.25,side*.44,3.09),(.50,side*.44,2.94),(1.39,side*.44,1.65)],.025,materials['edge']),yaw,name)
        deflector=local(box(name+'.gunport-deflector',(1.12,side*.51,2.08),(.10,.23,.49),materials['naval'],bev=.018),yaw,name)
        deflector.rotation_euler.y=math.radians(31)
        # Rear access doors sit on the rear face, not on the uninterrupted sides.
        local(box(name+'.rear-door',(-2.841,side*.68,1.69),(.045,.89,1.88),materials['naval'],bev=.06),yaw,name)
        for z in [.94,2.30]:local(rod(name+'.rear-door-hinge',(-2.89,side*1.04,z-.09),(-2.89,side*1.04,z+.09),.026,materials['edge']),yaw,name)
        local(rod(name+'.rear-door-handle',(-2.91,side*.35,1.55),(-2.91,side*.35,1.76),.022,materials['edge']),yaw,name)
        local(tube_path(name+'.roof-grab',[(-2.59,side*.91,3.15),(-2.59,side*.91,3.30),(-2.22,side*.91,3.30),(-2.22,side*.91,3.20)],.024,materials['edge']),yaw,name)
        local(box(name+'.front-step',(1.38,side*.83,.42),(.31,.62,.23),materials['naval'],bev=.016),yaw,name)
        local(tube_path(name+'.step-handle',[(1.52,side*.61,.45),(1.52,side*.61,.67),(1.52,side*1.04,.67),(1.52,side*1.04,.45)],.020,materials['edge']),yaw,name)
    for z in [.70,1.06,1.42,1.78,2.14,2.50,2.86]:
        local(rod(name+'.rear-ladder',(-2.93,-.23,z),(-2.93,.23,z),.021,materials['edge']),yaw,name)
        for side in [-1,1]:local(rod(name+'.ladder-foot',(-2.93,side*.23,z),(-2.80,side*.23,z),.020,materials['edge']),yaw,name)
    # Low aft equipment blister and visible train-ring fasteners.
    local(box(name+'.rear-equipment',(-2.95,0,.92),(.32,.95,.86),materials['naval'],bev=.05),yaw,name)
    for i in range(24):
        a=i*math.tau/24
        local(cyl(name+'.train-ring-bolt',(1.32*math.cos(a),1.32*math.sin(a),.295),.026,.06,materials['edge'],vertices=6),yaw,name)
    # Open mount-captain sight is a ring on a bracket, not a roof hatch.
    local(box(name+'.sight-bracket',(-1.84,-.56,3.36),(.13,.15,.31),materials['naval'],bev=.012),yaw,name)
    local(tube_path(name+'.sight-ring',[(-1.84,-.56+.145*math.cos(i*math.tau/32),3.66+.145*math.sin(i*math.tau/32)) for i in range(32)],.012,materials['edge'],closed=True),yaw,name)
    local(rod(name+'.sight-crosshair',(-1.84,-.705,3.66),(-1.84,-.415,3.66),.008,materials['edge']),yaw,name)
    local(rod(name+'.sight-crosshair',(-1.84,-.56,3.515),(-1.84,-.56,3.805),.008,materials['edge']),yaw,name)

    if detail_adjust:
        sx,sy,dz=detail_adjust
        for obj in set(col.objects)-base_parts:
            if obj.type=='MESH' and obj.parent==yaw and 'train-ring' not in obj.name:
                obj.location.x*=sx;obj.location.y*=sy;obj.location.z+=dz
                for v in obj.data.vertices:v.co.x*=sx;v.co.y*=sy
    return yaw


def create_mod_zero_mount(mount, col, helpers, materials):
    return create_mount(mount,col,helpers,materials,detail_adjust=(1.07,1.03,-.45))

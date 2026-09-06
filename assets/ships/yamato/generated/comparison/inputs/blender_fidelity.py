"""Original reusable geometry for authored surfaces and recognizable naval fittings.

These helpers consume our definition and caller-supplied materials only. They do
not read reference rasters, external models or network resources. Moving details
are parented explicitly to the existing yaw/recoil datums, never merged with them.
"""
import math
import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import intersect_ray_tri


def loft_breadth(h,forward,height):
    def at(points,y):
        for (w,a),(v,b) in zip(points,points[1:]):
            if a<=y<=b and b>a:return w+(v-w)*(y-a)/(b-a)
        return points[-1][0]
    station=forward+h['length']/2
    for a,b in zip(h['sections'],h['sections'][1:]):
        if a['station']<=station<=b['station']:
            t=(station-a['station'])/(b['station']-a['station'])
            return at(a['points'],height)*(1-t)+at(b['points'],height)*t
    return 0


def authored_structure(s, mesh, materials, collection):
    if s.get('surface'):
        vertices=[(-z,-x,y) for x,y,z in s['surface']['vertices']]
        faces=s['surface']['triangles']
    else:
        points=[(-z,-x) for x,z in s['footprint']];n=len(points)
        vertices=[(x,y,z) for z in [s['baseY'],s['baseY']+s['height']] for x,y in points]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh(s['name'],vertices,faces,materials[s['material']],collection)
    o['nodeId']=s['id']+'.surface';o['assemblyId']=s['id']
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    return o


def authored_hull(h, mesh, collection, materials, boot=False):
    vertices=[];faces=[];n=len(h['sections'][0]['points'])*2-1
    for s in h['sections']:
        pts=s['points'];x=s['station']-h['length']/2
        vertices.extend([(x,w,y) for w,y in pts]+[(x,-w,y) for w,y in reversed(pts[1:])])
    for j in range(len(h['sections'])-1):
        for i in range(n):
            a,b,c,d=j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i
            halves=[(a,b,d),(b,c,d)] if i>=len(h['sections'][0]['points']) else [(a,b,c),(a,c,d)]
            for ids in halves:
                if any(abs(vertices[k][1])>1e-7 for k in ids):faces.append(ids)
    for offset in [0,len(vertices)-n]:
        ring=vertices[offset:offset+n]
        area=sum(a[1]*b[2]-b[1]*a[2] for a,b in zip(ring,ring[1:]+ring[:1]))
        if abs(area)>1e-8:faces.append(tuple(range(offset,offset+n)))
    o=mesh('Blueprint lofted hull',vertices,faces,None,collection,True)
    o['nodeId']='hull.surface';o['assemblyId']='hull'
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.0000001)
    # Waterline paint boundaries split actual faces without changing the loft.
    for z in ([-1.1,-.25] if boot else [0]):
        bmesh.ops.bisect_plane(bm,geom=[*bm.verts,*bm.edges,*bm.faces],dist=.00000001,plane_co=(0,0,z),plane_no=(0,0,1))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    for material in materials:o.data.materials.append(material)
    for p in o.data.polygons:
        z=sum(o.data.vertices[i].co.z for i in p.vertices)/len(p.vertices)
        p.material_index=1 if z<(-1.1 if boot else -.00001) else 2 if boot and z<-.25 else 0
        if p.normal.z>.95:p.use_smooth=False
    return o


class Fittings:
    def __init__(self,helpers,materials,collection):
        self.mesh,self.cyl,self.rod,self.box=(helpers[k] for k in ['mesh','cyl','rod','box'])
        self.m=materials;self.col=collection

    def ring(self,name,center,radius,tube,normal='z',material='edge',segments=20):
        x,y,z=center
        def pt(a):
            u,v=radius*math.cos(a),radius*math.sin(a)
            return (x+u,y+v,z) if normal=='z' else (x+u,y,z+v) if normal=='y' else (x,y+u,z+v)
        for i in range(segments):self.rod(name,pt(i*math.tau/segments),pt((i+1)*math.tau/segments),tube,self.m[material],self.col,vertices=6)

    def ladder(self,name,a,b,width=.65):
        a,b=Vector(a),Vector(b);side=Vector((width/2,0,0))
        for sign in [-1,1]:self.rod(name+' stringer',a+side*sign,b+side*sign,.035,self.m['edge'],self.col,vertices=6)
        for i in range(max(2,math.ceil((b-a).length/.30))):
            p=a.lerp(b,i/max(1,math.ceil((b-a).length/.30)-1))
            self.rod(name+' rung',p-side,p+side,.025,self.m['edge'],self.col,vertices=6)

    def stairs(self,name,a,b,width=.8):
        a,b=Vector(a),Vector(b);delta=b-a;side=Vector((-delta.y,delta.x,0)).normalized()*width/2
        for sign in [-1,1]:
            self.rod(name+' stringer',a+side*sign,b+side*sign,.07,self.m['naval'],self.col,vertices=8)
            self.rod(name+' handrail',a+side*sign+Vector((0,0,.9)),b+side*sign+Vector((0,0,.9)),.029,self.m['edge'],self.col,vertices=6)
        n=max(3,math.ceil(abs(delta.z)/.23))
        for i in range(n):
            p=a.lerp(b,(i+.5)/n)
            o=self.box(name+' tread',p,(width,.28,.07),self.m['roof'],self.col)
            o.rotation_euler.z=math.atan2(side.y,side.x)

    def door(self,name,x,y,z,width=.8,height=1.7):
        sign=1 if y>=0 else -1
        self.box(name+' frame',(x,y,z+height/2),(width+.1,.09,height+.1),self.m['edge'],self.col)
        self.box(name+' leaf',(x,y+sign*.055,z+height/2),(width,.06,height),self.m['naval'],self.col)
        for zz in [.3,height-.3]:
            for dx in [-width*.4,width*.4]:
                self.rod(name+' dog',(x+dx-.06,y+sign*.10,z+zz),(x+dx+.06,y+sign*.10,z+zz),.025,self.m['edge'],self.col,vertices=6)
        self.ring(name+' wheel',(x,y+sign*.12,z+height*.57),.13,.023,'y',segments=12)

    def vent(self,name,x,y,z,width=1.2,height=.9):
        sign=1 if y>=0 else -1
        self.box(name+' recess',(x,y,z),(width,.06,height),self.m['dark'],self.col)
        for i in range(max(4,int(height/.12))):
            self.box(name+' louver',(x,y+sign*.045,z-height/2+.08+i*.12),(width,.13,.045),self.m['naval'],self.col)
        self.box(name+' rain hood',(x,y+sign*.06,z+height/2),(width+.12,.32,.08),self.m['roof'],self.col)

    def reel(self,name,x,y,z,radius=.48,length=1.1):
        for sign in [-1,1]:
            self.box(name+' foot',(x,y+sign*length/2,z+.35),(.16,.14,.7),self.m['naval'],self.col)
        self.rod(name+' rope drum',(x,y-length/2,z+radius+.18),(x,y+length/2,z+radius+.18),radius*.80,self.m.get('canvas',self.m['naval']),self.col,vertices=20)
        for sign in [-1,1]:
            yy=y+sign*length/2
            self.rod(name+' cheek',(x,yy-.05,z+radius+.18),(x,yy+.05,z+radius+.18),radius,self.m['naval'],self.col,vertices=24)
            self.ring(name+' rim',(x,yy,z+radius+.18),radius,.035,'y')
        for i in range(8):self.ring(name+' rope winding',(x,y-length*.42+length*.84*i/7,z+radius+.18),radius*.81,.022,'y','canvas',16)

    def chain(self,name,a,b,link=.42):
        a,b=Vector(a),Vector(b);direction=(b-a).normalized();side=Vector((-direction.y,direction.x,0)).normalized()
        n=max(1,math.ceil((b-a).length/(link*.70)))
        for i in range(n):
            p=a.lerp(b,i/n);up=side if i%2 else Vector((0,0,1))
            for j in range(12):
                aa=j*math.tau/12;bb=(j+1)*math.tau/12
                self.rod(name+' forged link',p+direction*math.cos(aa)*link*.5+up*math.sin(aa)*link*.3,p+direction*math.cos(bb)*link*.5+up*math.sin(bb)*link*.3,.045,self.m['edge'],self.col,vertices=6)

    def knee(self,name,x,inner,outer,z,drop):
        # Open triangular plate web, with a large lightening opening.
        points=[Vector((x,inner,z-drop)),Vector((x,outer,z)),Vector((x,inner,z))]
        center=sum(points,Vector())/3;inside=[center+(p-center)*.58 for p in points]
        v=[tuple(p) for p in points+inside]
        self.mesh(name+' pierced web',v,[(i,(i+1)%3,(i+1)%3+3,i+3) for i in range(3)],self.m['naval'],self.col)
        for a,b in zip(points,points[1:]+points[:1]):self.rod(name+' flange',a,b,.045,self.m['edge'],self.col,vertices=6)

    def boat(self,name,x,y,z,length,beam,cabin=False):
        # A curved, hollow, pointed launch, with sheer, gunwales and thwarts.
        rows=[(-.5,.02,.46),(-.44,.58,.29),(-.32,.89,.12),(-.13,1,0),(.12,.96,.04),(.33,.76,.18),(.46,.36,.41),(.5,0,.63)]
        verts=[]
        for fx,w,sheer in rows:
            for sign in [-1,1]:
                for f,h in [(0,0),(.5,.18),(1,.75),(.94,.75),(.45,.24),(0,.1)]:verts.append((x+fx*length,y+sign*f*w*beam/2,z+h+sheer))
        faces=[]
        for j in range(len(rows)-1):
            for sign in range(2):
                for i in range(5):
                    k=j*12+sign*6+i;faces.append((k,k+1,k+13,k+12))
        self.mesh(name+' hull shell',verts,faces,self.m['naval'],self.col,True)
        for sign in [-1,1]:
            for a,b in zip(rows,rows[1:]):self.rod(name+' gunwale',(x+a[0]*length,y+sign*a[1]*beam/2,z+.75+a[2]),(x+b[0]*length,y+sign*b[1]*beam/2,z+.75+b[2]),.055,self.m['edge'],self.col,vertices=8)
        for fx in [-.28,-.05,.18]:self.box(name+' thwart',(x+fx*length,y,z+.63),(.22,beam*.8,.09),self.m.get('canvas',self.m['roof']),self.col)
        for fx in [-.27,.26]:
            self.box(name+' cradle',(x+fx*length,y,z-.05),(.3,beam*1.1,.22),self.m['roof'],self.col)
        if cabin:
            self.box(name+' cabin',(x+.08*length,y,z+1.05),(length*.32,beam*.64,.82),self.m['naval'],self.col)
            self.box(name+' cabin roof',(x+.08*length,y,z+1.50),(length*.35,beam*.7,.12),self.m['roof'],self.col)
            for sign in [-1,1]:
                for fx in [-.025,.10]:self.box(name+' glazing',(x+fx*length,y+sign*beam*.326,z+1.2),(.52,.025,.32),self.m.get('glass',self.m['dark']),self.col)
        for sign in [-1,1]:self.rod(name+' boat oar',(x-length*.29,y+sign*beam*.24,z+.77),(x+length*.24,y+sign*beam*.24,z+.77),.035,self.m.get('canvas',self.m['edge']),self.col,vertices=6)

    def gun_details(self,mount):
        spec=mount['weapon'];yaw=bpy.data.objects.get(mount['id']+'.yaw')
        if not yaw or not spec.get('gunhouseMesh'):return
        before=set(bpy.context.scene.objects);L,W,H=spec['gunhouseSize'];scale=min(1.5,W/8)
        # Explicitly local details follow the existing turret yaw.
        for sign in [-1,1]:
            self.ladder(mount['name']+' service ladder',(-L*.30,sign*W*.48,.7),(-L*.30,sign*W*.48,H-.1),.5*scale)
            self.vent(mount['name']+' rear ventilation',-L*.36,sign*W*.48,H*.55,.6*scale,.46*scale)
            for x in [-L*.27,0]:
                self.rod(mount['name']+' roof handhold',(x,sign*W*.28,H+.09),(x+.65*scale,sign*W*.28,H+.09),.025,self.m['edge'],self.col,vertices=6)
        for x in [-L*.3,-L*.06]:
            self.box(mount['name']+' roof service seam',(x,0,H+.014),(.027,W*.59,.018),self.m['edge'],self.col)
        for ob in set(bpy.context.scene.objects)-before:
            ob.parent=yaw;ob['assemblyId']=mount['id']
        count=spec.get('barrelCount',2);ids=['left','center','right'] if count==3 else ['left','right']
        # Pleated bucklers bridge the gun opening to the recoiling barrel. Each
        # remains attached to its own barrel chain; mesh never spans two joints.
        for id in ids:
            recoil=bpy.data.objects.get(mount['id']+'.'+id+'.recoil')
            if not recoil:continue
            r=spec.get('barrelBaseRadius',.4);v=[];faces=[];n=32
            gy=((count-1)/2-ids.index(id))*spec['barrelSpacing']
            hits=[intersect_ray_tri(*[Vector(spec['gunhouseMesh']['vertices'][i]) for i in f['indices']],Vector((-1,0,0)),Vector((100,gy,spec['pivotHeight']))) for f in spec['gunhouseMesh']['faces']]
            front=max((p.x for p in hits if p is not None),default=spec['trunnionForward'])-spec['trunnionForward']
            for j in range(9):
                t=j/8;rr=r*(1.62-.60*t)
                for i in range(n):
                    a=i*math.tau/n;wave=1+.075*math.cos(a*12)*(1-t)
                    v.append((front-.08+1.25*t,rr*math.cos(a)*wave,rr*math.sin(a)*wave-.08*(1-t)))
            for j in range(8):
                for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
            ob=self.mesh(mount['name']+' pleated blast buckler',v,faces,self.m['canvas'],self.col,True)
            ob.parent=recoil;ob['assemblyId']=mount['id']

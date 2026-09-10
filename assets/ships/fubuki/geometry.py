"""Original ship primitives reused from Yukikaze authoring. Executed with this ship's collection/materials."""
def mesh(name, vertices, faces, material, collection=col, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); collection.objects.link(obj)
    if material: data.materials.append(material)
    for p in data.polygons: p.use_smooth = smooth
    obj['assemblyId'] = name.split('.')[0]
    return obj

def cyl(name, loc, radius, depth, material, collection=col, vertices=24, r2=None):
    r2 = radius if r2 is None else r2; depth = max(.001,depth)
    vs = [(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z)
          for z,r in [(-depth/2,radius),(depth/2,r2)] for i in range(vertices)]
    fs = [(i,(i+1)%vertices,vertices+(i+1)%vertices,vertices+i) for i in range(vertices)]
    fs += [tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]
    o = mesh(name,vs,fs,material,collection,True); o.location=loc
    o.data.polygons[-1].use_smooth=False; o.data.polygons[-2].use_smooth=False
    return o

def rod(name, a, b, r, material, collection=col, r2=None, vertices=10):
    a,b = Vector(a),Vector(b)
    o = cyl(name,(a+b)/2,r,(b-a).length,material,collection,vertices,r2)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return o

def box(name, loc, dim, material, collection=col, bev=.035):
    x,y,z = (d/2 for d in dim)
    vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    o=mesh(name,vs,[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],material,collection)
    o.location=loc
    if bev:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=min(bev,min(dim)*.24); mod.segments=2
    return o

def empty(name,loc):
    o=bpy.data.objects.new(name,None);col.objects.link(o);o.location=loc
    o['nodeId']=name;o['assemblyId']=name.split('.')[0];return o

def attach(obj,parent):
    bpy.context.view_layer.update(); world=obj.matrix_world.copy()
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_world=world

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

def outline_oval(cx,cy,rx,ry,n=48):return [(cx+rx*math.cos(i*math.tau/n),cy+ry*math.sin(i*math.tau/n)) for i in range(n)]
def outline_rect(x0,x1,y0,y1,c=.18):return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]

def prism(name,outline,z0,z1,mat=materials['naval'],roof=True):
    n=len(outline);vs=[(x,y,z) for z in [z0,z1] for x,y in outline]
    faces=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n)))]
    if roof:faces += [tuple(range(n,2*n))]
    o=mesh(name,vs,faces,mat)
    if roof:
        o.data.materials.append(materials['deck']);o.data.polygons[-1].material_index=1
    return o

def bulwark(name,outline,z,height=.85,thick=.065,closed=True):
    # Visible shell thickness and a rolled upper edge, with openings left as real openings.
    n=len(outline);center=Vector((sum(p[0] for p in outline)/n,sum(p[1] for p in outline)/n))
    inside=[]
    for p in outline:
        p=Vector(p);inside.append(tuple(p+(center-p).normalized()*thick))
    verts=[(x,y,zz) for shape,zz in [(outline,z),(outline,z+height),(inside,z+height),(inside,z)] for x,y in shape]
    faces=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i),(2*n+i,2*n+j,3*n+j,3*n+i)])
    mesh(name+'.plating',verts,faces,materials['naval'])
    tube_path(name+'.cap',[(x,y,z+height+.01) for x,y in outline],.034,materials['edge'],closed=closed)
    for i in range(0,n,max(1,n//12)):
        x,y=inside[i];rod(name+'.stiffener',(x,y,z+.07),(x,y,z+height-.035),.028,materials['edge'],vertices=6)

def rails(name,points,height=.94,closed=False,spacing=1.8):
    dense=[]
    count=len(points) if closed else len(points)-1
    for i in range(count):
        a,b=Vector(points[i]),Vector(points[(i+1)%len(points)]);steps=max(1,math.ceil((b-a).length/spacing))
        dense += [tuple(a.lerp(b,j/steps)) for j in range(steps)]
    if not closed:dense.append(points[-1])
    # Source's lowered foregun lifelines leave the barrel sweep unobstructed.
    def height_at(x):return height
    for p in dense:rod(name+'.stanchion',p,(p[0],p[1],p[2]+height_at(p[0])),.024,materials['edge'],vertices=6)
    for ratio in [1/3,2/3,1]:tube_path(name+'.lifeline',[(x,y,z+height_at(x)*ratio) for x,y,z in dense],.010 if ratio<1 else .017,materials['edge'],sides=6,closed=closed)

def ladder(name,a,b,w=.55):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/.29))
    for side in [-1,1]:rod(name+'.rail',a+Vector((0,side*w/2,0)),b+Vector((0,side*w/2,0))+(b-a).normalized()*.65,.026,materials['edge'],vertices=8)
    for i in range(n+1):
        p=a.lerp(b,i/n);rod(name+'.rung',p+Vector((0,-w/2,0)),p+Vector((0,w/2,0)),.023,materials['naval'],vertices=8)

def stairs(name,a,b,w=.70):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b.z-a.z)/.23))
    for side in [-1,1]:
        offset=Vector((0,side*w/2,0));rod(name+'.stringer',a+offset,b+offset,.06,materials['edge'])
        rod(name+'.handrail',a+offset+Vector((0,0,.8)),b+offset+Vector((0,0,.8)),.026,materials['naval'])
        for t in [0,.5,1]:
            p=a.lerp(b,t)+offset;rod(name+'.post',p,p+Vector((0,0,.8)),.025,materials['naval'])
    for i in range(n+1):
        p=a.lerp(b,i/n);box(name+'.tread',p,(abs(b.x-a.x)/n+.06,w,.055),materials['roof'],bev=.006)

def portlight(name,center,normal,r=.18):
    p=Vector(center);v=Vector(normal)
    rod(name+'.rim',p-v*.012,p+v*.045,r,materials['edge'],vertices=20)
    rod(name+'.glass',p+v*.046,p+v*.055,r*.76,materials['glass'],vertices=20)
    # Rain eyebrow remains visible in close views.
    tangent=Vector((-v.y,v.x,0));up=Vector((0,0,1))
    tube_path(name+'.eyebrow',[p+v*.075+tangent*(r*1.08*math.cos(i*math.pi/10))+up*(r*1.08*math.sin(i*math.pi/10)) for i in range(11)],.018,materials['naval'],sides=6)

def door(name,x,y,z,side=1,w=.66,h=1.55):
    box(name+'.frame',(x,y-side*.035,z+h/2),(w,.12,h),materials['edge'],bev=.025)
    outline=[(x-w/2,z+.12),(x-w/2+.12,z),(x+w/2-.12,z),(x+w/2,z+.12),(x+w/2,z+h-.12),(x+w/2-.12,z+h),(x-w/2+.12,z+h),(x-w/2,z+h-.12)]
    o=mesh(name+'.gasket',[(a,y,b) for a,b in outline],[tuple(range(8))],materials['dark'])
    mesh(name+'.leaf',[(x+(a-x)*.92,y+side*.028,z+h/2+(b-z-h/2)*.97) for a,b in outline],[tuple(range(8))],materials['naval'])
    for dz in [.35,1.15]:
        rod(name+'.hinge',(x-w/2+.06,y+side*.075,z+dz-.1),(x-w/2+.06,y+side*.075,z+dz+.1),.028,materials['edge'])
        box(name+'.dog',(x+w*.33,y+side*.065,z+dz),(.14,.06,.035),materials['edge'],bev=.005)
    rod(name+'.handle',(x+w*.28,y+side*.12,z+.72),(x+w*.28,y+side*.12,z+.9),.021,materials['edge'])
    for dz in [.72,.90]:rod(name+'.handle-foot',(x+w*.28,y+side*.025,z+dz),(x+w*.28,y+side*.12,z+dz),.020,materials['edge'])

def locker(name,loc,dim=(.62,.5,.72)):
    x,y,z=loc;box(name+'.box',loc,dim,materials['naval'])
    box(name+'.lid',(x,y,z+dim[2]/2+.024),(dim[0]+.035,dim[1]+.035,.045),materials['roof'],bev=.012)
    for xx in [-.18,.18]:box(name+'.latch',(x+xx,y-dim[1]/2-.018,z+.1),(.045,.04,.11),materials['edge'],bev=.006)


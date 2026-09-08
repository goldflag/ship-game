"""Original Iowa A geometry; never reads external meshes or reference textures.

Authoring +X bow, +Y port, +Z up. The shared exporter converts exactly once.
"""
import bpy
import json
import math
import os
import sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_components import create_gun_mount
from blender_fidelity import authored_hull, authored_structure, Fittings as BaseFittings, loft_breadth
from blender_rig import radar_pivot
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
OUT=Path(os.environ['SHIP_OUTPUT'])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='USS Iowa original authoring'
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world=bpy.data.worlds.new('Iowa review world');scene.world.color=(.08,.1,.12)
collections={}
for name in ['Hull and decks','Main battery','Secondary battery','Light AA','Superstructure','Masts and directors','Deck fittings','Aircraft handling','Underwater fittings']:
    c=bpy.data.collections.new(name);scene.collection.children.link(c);collections[name]=c
COL=collections['Hull and decks'];ASSEMBLY='hull'
colors={'naval':(.31,.37,.39,1),'hullgray':(.285,.335,.35,1),'roof':(.10,.145,.17,1),'edge':(.15,.185,.195,1),'canvas':(.075,.095,.103,1),'armor_roof':(.25,.315,.335,1),'dark':(.022,.028,.031,1),'antifouling':(.155,.17,.115,1),'boot':(.045,.05,.044,1),'glass':(.023,.066,.081,1),'bronze':(.31,.29,.16,1),'white':(.64,.67,.65,1)}
materials={}
for key,color in colors.items():
    m=bpy.data.materials.new('Iowa '+key);m.diffuse_color=color;m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.77;p.inputs['Metallic'].default_value=.08
    materials[key]=m

def mesh(name,vertices,faces,material=None,col=None,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);(col or COL).objects.link(obj);obj['assemblyId']=ASSEMBLY
    if isinstance(material,str):material=materials[material]
    if material:data.materials.append(material)
    for face in data.polygons:face.use_smooth=smooth
    return obj

def box(name,loc,dim,material='naval',col=None,bev=0):
    a,b,c=[v/2 for v in dim]
    vv=[(sx*a,sy*b,sz*c) for sx,sy,sz in [(-1,-1,-1),(-1,1,-1),(1,1,-1),(1,-1,-1),(-1,-1,1),(-1,1,1),(1,1,1),(1,-1,1)]]
    o=mesh(name,vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,col);o.location=loc;return o

def cyl(name,loc,radius,depth,material='naval',col=None,vertices=24,r2=None):
    r2=radius if r2 is None else r2;depth=max(.002,depth)
    vv=[(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z) for r,z in [(radius,-depth/2),(r2,depth/2)] for i in range(vertices)]
    ff=[tuple(reversed(range(vertices))),tuple(range(vertices,2*vertices))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
    o=mesh(name,vv,ff,material,col,True);o.location=loc
    for p in list(o.data.polygons)[:2]:p.use_smooth=False
    return o

def rod(name,a,b,r,material='edge',col=None,r2=None,vertices=10):
    a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,material,col,vertices,r2)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

class Fittings(BaseFittings):
    def ladder(self,name,a,b,width=.65,normal='y'):
        a,b=Vector(a),Vector(b);side=Vector((0,width/2,0)) if normal=='x' else Vector((width/2,0,0))
        for sign in [-1,1]:rod(name+' stringer',a+side*sign,b+side*sign,.035,'edge',self.col,vertices=6)
        count=max(2,math.ceil((b-a).length/.30))
        for i in range(count):
            p=a.lerp(b,i/(count-1));rod(name+' rung',p-side,p+side,.025,'edge',self.col,vertices=6)
    def ring(self,name,center,radius,tube,normal='z',material='edge',segments=20):
        # One continuous low-sided torus, without hidden end caps at every bend.
        vv=[];ff=[]
        for i in range(segments):
            a=i*math.tau/segments
            for j in range(4):
                b=j*math.tau/4;r=radius+tube*math.cos(b)
                u,v,w=r*math.cos(a),r*math.sin(a),tube*math.sin(b)
                p=(u,v,w) if normal=='z' else (u,w,v) if normal=='y' else (w,u,v)
                vv.append(tuple(c+d for c,d in zip(center,p)))
        for i in range(segments):
            for j in range(4):ff.append((i*4+j,((i+1)%segments)*4+j,((i+1)%segments)*4+(j+1)%4,i*4+(j+1)%4))
        return mesh(name,vv,ff,self.m[material],self.col,True)

def prism(name,outline,base,height,material='naval'):
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outline,outline[1:]+outline[:1]))<0:outline=list(reversed(outline))
    n=len(outline)
    return mesh(name,[(x,y,z) for z in [base,base+height] for x,y in outline],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material)

def ellipse(name,x,y,z,rx,ry,height,material='naval',lean=0,n=28):
    vv=[(x+shift+rx*math.cos(i*math.tau/n),y+ry*math.sin(i*math.tau/n),zz) for shift,zz in [(0,z),(lean,z+height)] for i in range(n)]
    return mesh(name,vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,smooth=True)

def wall(name,outline,z,height=.85,thickness=.045):
    for a,b in zip(outline,outline[1:]+outline[:1]):
        length=math.dist(a,b)
        if length<.001:continue
        o=box(name,((a[0]+b[0])/2,(a[1]+b[1])/2,z+height/2),(length,thickness,height));o.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
        rod(name+' rolled edge',(a[0],a[1],z+height),(b[0],b[1],z+height),.025,vertices=6)

def tub(name,x,y,z,r,height=.87):
    cyl(name+' deck',(x,y,z-.055),r,.11,'roof',vertices=40)
    wall(name+' splinter plating',[(x+r*math.cos(i*math.tau/40),y+r*math.sin(i*math.tau/40)) for i in range(40)],z,height,.045)

def parent_local(obj,parent):
    obj.parent=parent;obj['assemblyId']=parent.get('assemblyId',ASSEMBLY);return obj

def attach_all(objects,parent):
    for obj in objects:
        if obj.parent is None:parent_local(obj,parent)

def secondary_ports(gunhouse,mount):
    """Mk.32 slots and curved gun shields, independently built from the close-up.

    The visual openings continue into the roof for 85-degree elevation. Armor
    remains the explicit provisional combat surface in the component catalog.
    """
    spec=mount['weapon'];shape=spec['gunhouseMesh'];base=mount['position'][1]
    old=gunhouse.data;vv=[tuple(v.co) for v in old.vertices];ff=[];indices=[]
    for p,f in zip(old.polygons,shape['faces']):
        if not f['id'].startswith(('roof-','side-3-')):ff.append(tuple(p.vertices));indices.append(p.material_index)
    def panel(points,roof=False):
        start=len(vv);vv.extend((x,y,base+z) for x,y,z in points);ff.append(tuple(range(start,len(vv))));indices.append(int(roof))
    rear=.05;edge=spec['barrelSpacing']/2;half=.36
    def roof(points):panel([(x,y,3.45) for x,y in points],True)
    roof([(-2.9,-1.95),(-2.5,-2.52),(rear,-2.52),(rear,2.52),(-2.5,2.52),(-2.9,1.95)])
    roof([(rear,-edge+half),(1.32,-edge+half),(1.32,edge-half),(rear,edge-half)])
    roof([(rear,-2.52),(.92,-2.52),(1.32,-2.04),(1.32,-edge-half),(rear,-edge-half)])
    roof([(rear,edge+half),(1.32,edge+half),(1.32,2.04),(.92,2.52),(rear,2.52)])
    front=lambda z:2.16-.84*(z-.5)/2.95
    width=lambda z:2.1-.06*(z-.5)/2.95
    def face(lo,hi,z0,z1):
        low=lambda z:-width(z) if lo is None else lo
        high=lambda z:width(z) if hi is None else hi
        panel([(front(z0),low(z0),z0),(front(z0),high(z0),z0),(front(z1),high(z1),z1),(front(z1),low(z1),z1)])
    face(None,None,.5,1.44)
    for lo,hi in [(None,-edge-half),(-edge+half,edge-half),(edge+half,None)]:face(lo,hi,1.44,3.45)
    data=bpy.data.meshes.new(mount['id']+' open gun ports');data.from_pydata(vv,[],ff);data.update()
    for material in old.materials:data.materials.append(material)
    for p,i in zip(data.polygons,indices):p.material_index=i
    gunhouse.data=data
    collection=gunhouse.users_collection[0]
    def piece(name,vertices,faces,parent):
        data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update();data.materials.append(old.materials[0])
        obj=bpy.data.objects.new(mount['id']+'.'+name,data);collection.objects.link(obj);obj.parent=parent;obj['assemblyId']=mount['id']
        return obj
    def shield(name,a,b,y0,y1,parent):
        n=max(3,math.ceil((b-a)/5));angles=[math.radians(a+(b-a)*i/n) for i in range(n+1)];k=n+1
        verts=[(r*math.cos(t),y,r*math.sin(t)) for r,y in [(1.39,y0),(1.39,y1),(1.425,y0),(1.425,y1)] for t in angles]
        faces=[]
        for i in range(n):
            faces.extend([(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),
                          (i,2*k+i,2*k+i+1,i+1),(k+i,k+i+1,3*k+i+1,3*k+i)])
        faces.extend([(0,k,3*k,2*k),(n,2*k+n,3*k+n,k+n)])
        return piece(name,verts,faces,parent)
    for side in ['left','right']:
        parent=next(o for o in bpy.context.scene.objects if o.get('nodeId')==mount['id']+'.'+side+'.elevation')
        shield(side+' lower curved gun shield',-110,-12,-.33,.33,parent)
        shield(side+' upper curved gun shield',12,86,-.33,.33,parent)
        for sign in [-1,1]:
            shield(side+' shield bore cheek',-12,12,min(sign*.28,sign*.33),max(sign*.28,sign*.33),parent)
            y=sign*.31
            verts=[(x,y+dy,z) for x in [-.08,1.40] for dy,z in [(-.025,-.03),(.025,-.03),(.025,.03),(-.025,.03)]]
            piece(side+' gun shield support',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],parent)

def interp(points,s):
    for (a,v),(b,w) in zip(points,points[1:]):
        if a<=s<=b:return v+(w-v)*(s-a)/(b-a)
    return points[0][1] if s<points[0][0] else points[-1][1]

exec((Path(__file__).parent/'main_battery.py').read_text(),globals())
exec((Path(__file__).parent/'superstructure.py').read_text(),globals())

H=D['hull'];deckz=lambda x:interp(H['deckHeights'],x+H['length']/2)
def surface_height(x,y,ceiling):
    height=deckz(x)
    for s in D['structures']:
        poly=[(-c,-a) for a,c in s['footprint']];inside=False
        for a,b in zip(poly,poly[1:]+poly[:1]):
            if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:inside=not inside
        top=s['baseY']+s['height']
        if inside and top<=ceiling+.15:height=max(height,top)
    return height
helpers=dict(mesh=mesh,cyl=cyl,rod=rod,box=box)
hull=authored_hull(H,mesh,COL,[materials[k] for k in ['hullgray','antifouling','boot']],True)
hull.data.materials.append(materials['roof'])
for face in hull.data.polygons:
    if face.normal.z>.96:face.material_index=3
for y in [i*.38 for i in range(-43,44)]:
    for a,b in zip(H['halfBreadths'],H['halfBreadths'][1:]):
        if min(a[1],b[1])<abs(y)+.15:continue
        x0,x1=a[0]-H['length']/2,b[0]-H['length']/2
        rod('Deck seam',(x0,y,deckz(x0)+.011),(x1,y,deckz(x1)+.011),.008,'edge',vertices=4)

COL=collections['Superstructure']
for s in D['structures']:
    ASSEMBLY=s['id'];obj=authored_structure(s,mesh,materials,COL)
    obj.data.materials.append(materials['roof'])
    for face in obj.data.polygons:
        if face.normal.z>.8:face.material_index=1
    poly=[(-z,-x) for x,z in s['footprint']];top=s['baseY']+s['height']
    if s.get('exhaust'):funnel_details(s,obj)

for m in D['mounts']:
    if m['weapon']['caliberM']<.1:continue
    COL=collections['Main battery' if m['battery']=='main' else 'Secondary battery'];ASSEMBLY=m['id']
    gunhouse=create_gun_mount(m,COL,helpers,materials,deckz)
    yaw=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.yaw')
    before=set(scene.objects)
    if m['battery']=='main':
        main_battery(gunhouse,m)
    else:
        secondary_ports(gunhouse,m)
        for y in [-m['weapon']['barrelSpacing']/2,m['weapon']['barrelSpacing']/2]:
            for sign in [-1,1]:
                yy=y+sign*.40
                path=[(2.16-.84*(z-.5)/2.95+.025,yy,z) for z in [1.44,3.45]]+[(.05,yy,3.475)]
                for a,b in zip(path,path[1:]):
                    rod('5-inch port rim',a,b,.026,'naval',vertices=8)
                    for i in range(1,6):
                        q=Vector(a).lerp(Vector(b),i/6)
                        offset=Vector((.032,0,0)) if a[2]<3 else Vector((0,0,.032))
                        rod('Port rim bolt',q-offset*.3,q+offset,.022,'edge',vertices=8)
            rod('5-inch port upper rim',(.05,y-.40,3.475),(.05,y+.40,3.475),.026,'naval',vertices=8)
        for y in [-1,1]:
            cyl('5-inch roof optic',(-1.60,y,3.56),.13,.23,vertices=12)
            for z in [2.12,2.79]:
                x=2.16-.84*(z-.5)/2.95
                box('5-inch sight hood',(x+.025,y*1.82,z),(.23,.34,.35))
                box('5-inch observation window',(x+.148,y*1.82,z),(.025,.25,.25),'glass')
        box('5-inch rear door',(-3.015,0,1.5),(.055,.90,1.58))
        Fittings(helpers,materials,COL).ladder('5-inch rear ladder',(-3.06,-1.55,.5),(-3.06,-1.55,3.4),.48,normal='x')
        for z in [.8,2.8]:rod('5-inch ladder standoff',(-3.09,-1.55,z),(-2.82,-1.55,z),.025,'edge',vertices=6)
    attach_all(set(scene.objects)-before,yaw)

COL=collections['Light AA']
for m in D['mounts']:
    if m['weapon']['caliberM']>=.1:continue
    before=set(scene.objects)
    ASSEMBLY=m['id'];a,z,c=m['position'];x,y=-c,-a
    is_bofors=m['weapon']['caliberM']>.03;radius=2.36 if is_bofors else 1.20
    if is_bofors:tub(m['name'],x,y,z,radius,.85)
    else:cyl(m['name']+' deck',(x,y,z-.055),radius,.11,'roof',vertices=24)
    parent_mount=next((p for p in D['mounts'] if p['id']==m.get('parentMountId')),None)
    support=parent_mount['position'][1]+parent_mount['weapon']['gunhouseSize'][2] if parent_mount else surface_height(x,y,z)
    if z>deckz(x)+.18:
        rod(m['name']+' support',(x,y,support-.05),(x,y,z-.06),.20,'naval',vertices=12)
        inner=y-math.copysign(min(2.0,abs(y)),y) if abs(y)>.1 else y
        for dx in [-radius*.65,radius*.65]:rod(m['name']+' knee',(x+dx,inner,support),(x+dx,y,z-.08),.085,'naval',vertices=8)
    create_gun_mount(m,COL,helpers,materials,deckz)
    if parent_mount:
        parent=next(o for o in scene.objects if o.get('nodeId')==parent_mount['id']+'.yaw')
        bpy.context.view_layer.update()
        for obj in set(scene.objects)-before:
            if obj.parent is None:
                world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_world=world

# Additional independently authored fittings are executed in this recipe scope.
exec((Path(__file__).parent/'fittings.py').read_text(),globals())
# Consolidate static fittings within their exact assembly/joint frame. This
# keeps the editable source small without welding independent moving parts.
bpy.context.view_layer.update()
groups={}
for obj in list(scene.objects):
    if obj.type=='MESH' and not obj.get('nodeId') and not obj.get('battery'):
        key=(obj.parent,obj.get('assemblyId','hull'),obj.users_collection[0])
        groups.setdefault(key,[]).append(obj)
for (parent,assembly,col),objects in groups.items():
    if len(objects)<2:continue
    vv=[];ff=[];slots=[];indices=[];smooth=[]
    inverse=parent.matrix_world.inverted() if parent else Matrix.Identity(4)
    for obj in objects:
        transform=inverse@obj.matrix_world;offset=len(vv)
        vv.extend(tuple(transform@v.co) for v in obj.data.vertices)
        for p in obj.data.polygons:
            ff.append(tuple(offset+i for i in p.vertices));smooth.append(p.use_smooth)
            mat=obj.data.materials[p.material_index] if obj.data.materials else materials['naval']
            if mat not in slots:slots.append(mat)
            indices.append(slots.index(mat))
    ASSEMBLY=assembly;combined=mesh(assembly+' fittings',vv,ff,col=col);combined.parent=parent
    for mat in slots:combined.data.materials.append(mat)
    for p,index,s in zip(combined.data.polygons,indices,smooth):p.material_index=index;p.use_smooth=s
    for obj in objects:
        data=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
        if data.users==0:bpy.data.meshes.remove(data)
scene['definitionHash']=D['contentHash']
scene['authoringNote']='Original Iowa A geometry; accepted source limitations are in the ship README.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))

"""Original Iowa Mk.32/Mk.1/Mk.4 recipes extracted for exact-variant reuse.

Geometry comes from the original Iowa Python recipes, never installed previews.
Ship foundations and AA tubs belong to each installation.
"""
import math
import bpy
from blender_components import create_gun_mount
from blender_fidelity import Fittings
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

def create_mount(mount, collection, helpers, materials):
    materials=dict(materials)
    materials.setdefault("glass",materials["dark"])
    materials.setdefault("bronze",materials["edge"])
    scene=bpy.context.scene
    m=mount
    def mat(value):return materials[value] if isinstance(value,str) else value
    def mesh(name,vv,ff,material='naval',col=None,smooth=False):
        return helpers['mesh'](mount['id']+'.'+name,vv,ff,mat(material),col or collection,smooth)
    def cyl(name,loc,radius,depth,material='naval',col=None,vertices=24,r2=None):
        return helpers['cyl'](mount['id']+'.'+name,loc,radius,depth,mat(material),col or collection,vertices,r2)
    def rod(name,a,b,r,material='naval',col=None,r2=None,vertices=12):
        return helpers['rod'](mount['id']+'.'+name,a,b,r,mat(material),col or collection,r2,vertices)
    def box(name,loc,dim,material='naval',col=None,bev=0):
        return helpers['box'](mount['id']+'.'+name,loc,dim,mat(material),col or collection,bev)
    def attach_all(objects,parent):
        for obj in objects:
            if obj.parent is None:
                obj.parent=parent;obj['assemblyId']=mount['id']
    shell=create_gun_mount(mount,collection,helpers,materials,lambda x:mount['position'][1])
    yaw=next(o for o in scene.objects if o.get('nodeId')==mount['id']+'.yaw')
    F=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,collection)
    if mount['weapon']['caliberM']>.1:
        secondary_ports(shell,mount)
        before=set(scene.objects)
        cyl('gunhouse floor bearing',(0,0,.38),mount['weapon']['barbetteRadius'],.25,'edge',vertices=48)
        for y in [-1,1]:
            cyl('roof optic',(-1.60,y,3.56),.13,.23,vertices=12)
            for z in [2.12,2.79]:
                x=2.16-.84*(z-.5)/2.95
                box('sight hood',(x+.025,y*1.82,z),(.23,.34,.35))
                box('observation window',(x+.148,y*1.82,z),(.025,.25,.25),'glass')
        box('rear door',(-3.015,0,1.5),(.055,.90,1.58))
        for z in [.7,1.1,1.5,1.9,2.3,2.7,3.1]:rod('rear ladder rung',(-3.07,-1.8,z),(-3.07,-1.3,z),.025,'edge',vertices=8)
        for y in [-1.82,-1.28]:rod('rear ladder rail',(-3.07,y,.5),(-3.07,y,3.4),.026,'edge',vertices=8)
        attach_all(set(scene.objects)-before,yaw)
        return yaw
    D={'mounts':[mount]}
    for m in D['mounts']:
        w=m['weapon']
        if w['caliberM']>=.1:continue
        ASSEMBLY=m['id'];yaw=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.yaw')
        heavy=w['caliberM']>.03;before=set(scene.objects)
        if heavy:
            # The Mk.1 has an open fork below its loading trays. A solid generic
            # pedestal at breech height would occupy the rearward elevation sweep.
            for obj in list(yaw.children):
                if obj.type=='MESH' and any(obj.name.startswith(m['id']+'.'+suffix) for suffix in ['pedestal','carriage-saddle','cradle','seat','sight']):
                    bpy.data.objects.remove(obj,do_unlink=True)
            cyl('Bofors lower training drum',(0,0,.33),.52,.24,vertices=32,r2=.43)
            box('Bofors fork crossmember',(.075,0,.445),(.40,1.97,.11))
            for side in [-1,1]:
                box('Bofors bearing cheek',(.15,side*.9216,1.18),(.29,.16,1.47))
                rod('Bofors fork brace',(-.38,side*.9216,.45),(.15,side*.9216,1.53),.055,'naval',vertices=8)
            box('Bofors perforated crew platform',(-.50,0,.39),(2.10,2.42,.12),'roof')
            cyl('Training gear housing',(0,0,.29),.67,.21,'edge',vertices=40)
            for side in [-1,1]:
                for x in [-1.43,.25]:rod('Platform support',(0,0,.25),(x,side*1.15,.37),.07,'naval',vertices=8)
                rod('Crew guardrail',(-1.48,side*1.16,.47),(-1.48,side*1.16,1.12),.027,'naval',vertices=6)
                rod('Crew guardrail',(-1.48,side*1.16,1.12),(.22,side*1.16,1.12),.027,'naval',vertices=6)
                rod('Crew guardrail',(.22,side*1.16,1.12),(.22,side*1.16,.47),.027,'naval',vertices=6)
                box('Bofors drive housing',(.08,side*.66,.96),(.73,.43,.67))
                rod('Handwheel shaft',(-.25,side*.65,1.32),(-.25,side*.99,1.32),.042,'edge',vertices=10)
                F.ring('Bofors handwheel',(-.25,side*.99,1.32),.24,.023,'y',segments=18)
                for a in [0,math.tau/3,2*math.tau/3]:rod('Handwheel spoke',(-.25,side*.99,1.32),(-.25+.24*math.cos(a),side*.99,1.32+.24*math.sin(a)),.018,'edge',vertices=6)
                rod('Handwheel crank',(-.49,side*.99,1.32),(-.49,side*1.08,1.32),.029,'dark',vertices=8)
                box('Operator seat pan',(-.75,side*.84,.86),(.44,.42,.075),'edge')
                rod('Seat pedestal',(-.75,side*.84,.45),(-.75,side*.84,.84),.045,'naval',vertices=8)
                rod('Seat back bracket',(-.92,side*.84,.83),(-1.01,side*.84,1.12),.030,'naval',vertices=6)
                box('Operator seat back',(-1.015,side*.84,1.11),(.055,.41,.30),'edge')
                for x in [-.16,.18]:
                    for z in [.75,1.17]:rod('Drive housing bolt',(x,side*.875,z),(x,side*.903,z),.027,'edge',vertices=6)
                box('Foot pedal',(-.11,side*.89,.58),(.22,.28,.045),'edge')
                rod('Pedal linkage',(-.11,side*.89,.60),(.14,side*.67,.84),.02,'edge',vertices=6)
        else:
            # Mk.4 twin shield plates have thickness, trimmed upper corners and
            # rear brackets. Replace only this variant's shared rectangular shields.
            for obj in list(yaw.children):
                if obj.type=='MESH' and obj.name.startswith(m['id']+'.shield'):
                    obj.hide_render=True;obj.hide_set(True)
                    bpy.data.objects.remove(obj,do_unlink=True)
            for side in [-1,1]:
                cy=side*.39
                yz=[(cy-.32,.75),(cy+.32,.75),(cy+.32,1.63),(cy+.21,1.82),(cy-.32,1.76)]
                n=len(yz);vv=[(x,y,z) for x in [.175,.205] for y,z in yz]
                mesh('Mk.4 splinter shield',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
                for z in [.86,1.25]:
                    rod('Shield support',(.1,side*.18,1.1),(.17,cy,z),.030,'naval',vertices=8)
                    for y in [cy-.21,cy+.21]:rod('Shield bolt',(.205,y,z),(.224,y,z),.022,'edge',vertices=6)
                rod('Pedestal locking lever',(0,side*.23,.70),(-.20,side*.37,.88),.024,'edge',vertices=8)
            cyl('Pedestal collar',(0,0,.91),.23,.085,'edge',vertices=24)
            for z in [.33,.66,1.02]:F.ring('Pedestal seam',(0,0,z),.206,.018,segments=16)
        attach_all(set(scene.objects)-before,yaw)
        for barrel in (['left','right'] if heavy else ['center']):
            elevation=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.'+barrel+'.elevation')
            recoil=next(o for o in scene.objects if o.get('nodeId')==m['id']+'.'+barrel+'.recoil')
            before=set(scene.objects)
            if heavy:
                box('Bofors loading tray',(-.77,0,.06),(.90,.21,.075),'edge')
                for side in [-1,1]:
                    box('Feed guide',(-.74,side*.12,.25),(.79,.04,.40))
                    rod('Loader tray strut',(-.16,side*.13,-.04),(-1.18,side*.13,.08),.030,'naval',vertices=8)
                # Four rounds form the visible vertical clip, with separate cases.
                for x in [-1.03,-.84,-.65,-.46]:
                    rod('Bofors feed round',(x,0,.14),(x,0,.50),.035,'bronze',r2=.025,vertices=8)
                rod('Recoil cylinder',(-.33,0,-.17),(.64,0,-.17),.086,'naval',r2=.064,vertices=16)
                for x in [.23+i*.034 for i in range(16)]:F.ring('Bofors cooling ring',(x,0,0),.084,.010,'x',segments=12)
            else:
                # The drum face is transverse to the gun, with a separate rim,
                # latch and stamped radial ribs, as visible behind the shield.
                for obj in list(elevation.children):
                    if obj.type=='MESH' and any(obj.name.startswith(m['id']+'.'+suffix) for suffix in ['shoulder','sight']):bpy.data.objects.remove(obj,do_unlink=True)
                for obj in list(recoil.children):
                    if obj.type=='MESH' and obj.name.startswith(m['id']+'.drum'):bpy.data.objects.remove(obj,do_unlink=True)
                rod('Oerlikon drum',(-.22,-.13,.23),(-.22,.13,.23),.24,'dark',vertices=28)
                for side in [-1,1]:
                    F.ring('Drum retaining rim',(-.22,side*.137,.23),.235,.014,'y',segments=24)
                    for a in [i*math.tau/8 for i in range(8)]:rod('Drum rib',(-.22,side*.145,.23),(-.22+.20*math.cos(a),side*.145,.23+.20*math.sin(a)),.010,'edge',vertices=4)
                box('Magazine latch',(-.44,0,.03),(.12,.26,.10),'edge')
                for x in [.16+i*.034 for i in range(9)]:F.ring('Oerlikon recoil spring',(x,0,0),.051,.007,'x',segments=10)
                for side in [-1,1]:
                    rod('Shoulder rest',(-.52,side*.11,-.02),(-.91,side*.30,-.07),.025,'edge',vertices=8)
                    box('Shoulder pad',(-.92,side*.30,-.06),(.09,.17,.20),'dark')
                rod('Cocking lever',(-.18,-.07,-.05),(-.18,-.28,-.07),.023,'edge',vertices=8)
            attach_all(set(scene.objects)-before,recoil)
            before=set(scene.objects)
            side=-1 if barrel=='left' else 1
            yy=side*.35 if heavy else .10
            rod('Sight bracket',(.02,0,.08),(.12,yy,.39),.023,'naval',vertices=8)
            F.ring('Ring sight',(.12,yy,.47),.15 if heavy else .11,.013,'x',segments=16)
            rod('Sight crosshair',(.12,yy-.10,.47),(.12,yy+.10,.47),.006,'edge',vertices=4)
            rod('Sight crosshair',(.12,yy,.37),(.12,yy,.57),.006,'edge',vertices=4)
            attach_all(set(scene.objects)-before,elevation)
    return yaw

"""Original German cruiser mount variants, authored against approved pgsc108 A.

No source model, source textures or reference transforms are loaded. Dimensions
are editable catalog inputs. Installation supports belong to the ship recipe.
"""
import bpy, math
from mathutils import Matrix
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

class MountBuilder:
    def __init__(self,mount,col,h,m):
        self.mount,self.col,self.h,self.m=mount,col,h,m
        self.name=mount['id'];self.s=mount['weapon'];self.yaw=self.joint('yaw')
    def joint(self,suffix,parent=None,loc=(0,0,0)):
        o=bpy.data.objects.new(self.name+'.'+suffix,None);self.col.objects.link(o)
        o.location=loc;o.parent=parent;o['nodeId']=o.name;o['assemblyId']=self.name;return o
    def put(self,o,parent=None):
        o.parent=parent or self.yaw;o.matrix_parent_inverse=Matrix.Identity(4);o['assemblyId']=self.name;return o
    def box(self,n,p,s,m='naval',parent=None):return self.put(self.h['box'](self.name+'.'+n,p,s,self.m.get(m,self.m['naval']),self.col),parent)
    def cyl(self,n,p,r,d,m='naval',parent=None,r2=None):return self.put(self.h['cyl'](self.name+'.'+n,p,r,d,self.m.get(m,self.m['naval']),self.col,20,r2),parent)
    def rod(self,n,a,b,r,m='naval',parent=None,r2=None):return self.put(self.h['rod'](self.name+'.'+n,a,b,r,self.m.get(m,self.m['naval']),self.col,r2=r2,vertices=8),parent)
    def mesh(self,n,v,f,m='naval',parent=None):return self.put(self.h['mesh'](self.name+'.'+n,v,f,self.m.get(m,self.m['naval']),self.col),parent)
    def plate(self,n,profile,y0,y1,m='naval',parent=None):
        k=len(profile);return self.mesh(n,[(x,y,z) for y in [y0,y1] for x,z in profile],[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)],m,parent)
    def ring(self,n,p,r,axis='y',parent=None,wire=.012):
        x,y,z=p;pts=[(x+r*math.cos(i*math.tau/12),y,z+r*math.sin(i*math.tau/12)) if axis=='y' else (x,y+r*math.cos(i*math.tau/12),z+r*math.sin(i*math.tau/12)) for i in range(12)]
        for a,b in zip(pts,pts[1:]+pts[:1]):self.rod(n,a,b,wire,'edge',parent)
        return pts
    def wheel(self,n,p,r,parent=None):
        pts=self.ring(n,p,r,parent=parent)
        for i in [0,4,8]:self.rod(n+' spoke',p,pts[i],.012,'edge',parent)
        self.rod(n+' crank',pts[0],(pts[0][0],pts[0][1]+.09,pts[0][2]),.017,'edge',parent)
    def barrel(self,n,length,root,tip,bore,parent,start=.3):
        sleeve_end=2.10 if bore>.08 else start+.18
        rings=[(start,root),(sleeve_end,root),(sleeve_end+.04,root*.8),(length*.52,tip*1.25),(length-.05,tip),(length,tip),(length,bore),(length-.15,bore)]
        k=16 if bore>.08 else 12;v=[(x,r*math.cos(i*math.tau/k),r*math.sin(i*math.tau/k)) for x,r in rings for i in range(k)]
        self.mesh(n,v,[(j*k+i,j*k+(i+1)%k,(j+1)*k+(i+1)%k,(j+1)*k+i) for j in range(len(rings)-1) for i in range(k)],'edge',parent)
        self.rod(n+' bore shadow',(length-.155,0,0),(length-.15,0,0),bore*.98,'dark',parent)
    def gun_joints(self,side,y):
        s=self.s;e=self.joint(side+'.elevation',self.yaw,(s['trunnionForward'],y,s['pivotHeight']));e.rotation_euler.y=-math.radians(self.mount.get('initialElevationDeg',1))
        r=self.joint(side+'.recoil',e);self.joint(side+'.muzzle',r,(s['muzzleForward']-s['trunnionForward'],0,0));return e,r
    def finish(self):
        a,b,c=self.mount['position'];self.yaw.location=(-c,-a,b);self.yaw.rotation_euler.z=-math.radians(self.mount['bearingDeg']);return self.yaw


def create_main(mount,col,helpers,materials):
    b=MountBuilder(mount,col,helpers,materials);s=b.s
    b.cyl('bearing lower',(0,0,-.10),3.02,.20,'edge');b.cyl('rotating floor',(0,0,.015),3.08,.09)
    shape=s['gunhouseMesh']
    # Taper the aft footprint and rake the rear roof with the existing facets.
    vertices=[]
    for x,y,z in shape['vertices']:
        taper=1-.07*max(0,min(1,(-x-2)/3.45))
        # Move the aft roof break forward, retaining a level crown and
        # a continuous sloping rear shoulder beneath the rangefinder.
        xx=max(x,-3.65) if z>2.5 and x<-3.65 else x
        vertices.append((xx,y*taper,z))
    o=b.mesh('faceted gunhouse',vertices,[f['indices'] for f in shape['faces']])
    o.data.materials.append(materials.get('roof',materials['edge']))
    for p,f in zip(o.data.polygons,shape['faces']):p.material_index=int(f['finish']=='roof')
    for side,y,_ in barrel_layout(s):
        e,r=b.gun_joints(side,y);length=s['muzzleForward']-s['trunnionForward']
        b.barrel(side+' stepped barrel',length,.265,.139,.1015,r,start=.46)
        # Hidden breech cap omitted: spend its triangles on visible sight recesses.
    for y in [-2.62,2.62]:
        # The approved gunhouse has a flush rear roof, without the raised
        # rectangular hatches used on some other German turret variants.
        b.cyl('roof ventilator',(-1.3,y*.78,2.72),.15,.25,'edge')
        # Front sight flap follows the sloped face.
        o=b.box('front sight recess',(2.16,y,1.42),(.07,.63,.39),'dark');o.rotation_euler.y=-.34
        b.box('front sight hood',(2.17,y,1.64),(.22,.76,.08))
        b.box('front sight sill',(2.31,y,1.21),(.17,.76,.07))
        sign=y/abs(y)
        def ladder_y(z):return sign*(3.34-max(0,z-1.68)*.49)
        for z in [.42,.7,.98,1.26,1.54,1.82,2.1,2.38]:
            b.rod('side ladder rung',(-1.65,ladder_y(z),z),(-1.28,ladder_y(z),z),.025,'edge')
        # Square stringers seat against the flank and follow its roof chine.
        for x in [-1.65,-1.28]:
            for lo,hi in [(.42,1.68),(1.68,2.38)]:
                b.put(helpers['rod'](b.name+'.side ladder stringer',
                    (x,ladder_y(lo),lo),(x,ladder_y(hi),hi),.022,
                    materials['edge'],col,vertices=4))
        b.box('rear access hood',(-5.48,y*.72,1.49),(.14,.55,.65))
    if s['id']=='skc34-203-twin-rf':
        for sign in [-1,1]:
            b.plate('rangefinder armored wing',[(-4.55,2.03),(-4.55,2.98),(-4.35,3.11),(-2.60,3.11),(-2.60,2.10),(-2.85,1.98)],*sorted([sign*2.58,sign*4.02]))
            b.rod('optical lens',(-2.59,sign*3.65,2.47),(-2.54,sign*3.65,2.47),.22,'dark')
            b.box('lens brow',(-2.55,sign*3.65,2.75),(.22,.57,.10),'edge')
    for side,y,_ in barrel_layout(s):
        seam=[]
        for i in range(16):
            a=i*math.tau/16;z=1.32+.91*math.sin(a)
            x=2.6-.58*(z-.06)/1.62 if z<=1.68 else 2.02-.57*(z-1.68)/.96
            seam.append((x+.022,y+.48*math.cos(a),z))
        create_bloomer(mount,col,helpers,materials,side,seam,s['trunnionForward']+1.50,.267,rings=5,fold_depth=.050,slack=.085,fullness=.055)
    return b.finish()


def create_secondary(mount,col,helpers,materials):
    b=MountBuilder(mount,col,helpers,materials);s=b.s
    b.cyl('mounting flange',(0,0,.055),.85,.11,'edge');b.cyl('training pedestal',(0,0,.33),.35,.5);b.cyl('bearing',(0,0,.61),.48,.16,'edge')
    for yy in [-1.34,1.34]:b.box('carriage side footboard',(.15,yy,.60),(4.32,.38,.055),'roof')
    for xx in [-1.92,0,2.24]:b.box('carriage cross beam',(xx,0,.58),(.12,2.98,.06),'roof')
    b.rod('supported trunnion axle',(s['trunnionForward'],-1.10,s['pivotHeight']),(s['trunnionForward'],1.10,s['pivotHeight']),.115,'edge')
    # Long forward cheeks, rear access cutouts and an inward-sloping top lip.
    # Rounded original measurements of the approved C/31 shield.
    profile=[(-2.0,.58),(2.32,.58),(1.98,1.48),(-1.67,1.97),(-2.0,1.97),(-2.0,1.44),(-1.04,1.44),(-1.04,.91),(-2.0,.91)]
    for sign in [-1,1]:
        b.plate('side shield',profile,sign*1.42-.012,sign*1.42+.012)
        lip=[(-2,sign*1.43,1.96),(1.98,sign*1.43,1.48),(1.82,sign*1.23,1.65),(-1.75,sign*1.23,2.15)]
        ob=b.mesh('sloped upper lip',lip,[(0,1,2,3)])
        mod=ob.modifiers.new('Shield edge thickness','SOLIDIFY');mod.thickness=.022
        b.plate('forward shield cheek',[(2.32,.58),(1.98,1.48),(1.96,1.48),(2.29,.58)],sign*.97,sign*1.42)
        for x in [-1.65,-.6,1.0]:b.rod('shield bracket',(x,sign*.72,.61),(x,sign*1.40,1.47-.12*x),.037)
        b.box('shield service cover',(.10,sign*1.455,1.16),(.60,.035,.35),'edge')
        b.box('rear crew foot grate',(-2.25,sign*1.27,.60),(.62,.43,.055),'edge')
        b.rod('rear foot grate bearer',(-1.85,sign*1.27,.58),(-2.56,sign*1.27,.58),.042)
        b.cyl('crew seat',(-1.55,sign*1.15,1.09),.22,.10,'roof');b.rod('seat stem',(-1.55,sign*1.15,.63),(-1.55,sign*1.15,1.04),.049)
        b.wheel('elevation handwheel',(-.30,sign*1.70,1.10),.18)
        b.rod('control shaft',(-.3,sign*.65,1.10),(-.3,sign*1.70,1.10),.041)
        b.plate('control gearcase',[(-.63,.80),(-.02,.80),(.08,1.13),(-.20,1.40),(-.58,1.30)],*sorted([sign*1.28,sign*1.57]))
        b.box('trunnion bearing',(s['trunnionForward'],sign*.94,s['pivotHeight']-.16),(.63,.34,.66))
    # Sloped front armor connects the cheeks; slots leave both cradles free.
    half=s['barrelSpacing']/2;slot=.19
    for lo,hi in [(-1.42,-half-slot),(-half+slot,half-slot),(half+slot,1.42)]:
        b.plate('front shield web',[(2.32,.58),(1.98,1.48),(1.945,1.48),(2.285,.58)],lo,hi)
    for lo,hi in [(-1.42,0),(0,1.42)]:
        b.plate('continuous front sill',[(2.32,.58),(2.11,1.18),(2.075,1.18),(2.285,.58)],lo,hi)
    # The C/31 shield has a shallow V nose and a low central apron. This is
    # geometry only; keep the existing shared builder and trunnion contract.
    for ob in list(b.yaw.children):
        if ob.type=='MESH' and any(k in ob.name for k in ['front shield web','continuous front sill','forward shield cheek']):
            for v in ob.data.vertices:
                t=max(0,1-abs(v.co.y)/1.42)
                v.co.x+=.12*t
                if v.co.z<.65:v.co.z-=.22*t

    b.plate('front central housing',[(2.38,.35),(2.38,1.23),(2.17,1.45),(2.09,1.20),(2.09,.35)],-.23,.23)
    for sign in [-1,1]:
        b.cyl('front sight housing',(1.92,sign*1.10,1.56),.145,.30)
        b.cyl('front sight cap',(1.92,sign*1.10,1.73),.18,.065,'edge')
    for side,y,_ in barrel_layout(s):
        e,r=b.gun_joints(side,y);length=s['muzzleForward']-s['trunnionForward']
        b.plate(side+' cradle',[(-1.25,-.12),(-.65,-.32),(.66,-.32),(.74,.05),(.45,.28),(-1.25,.28)],-.28,.28,parent=e)
        b.rod(side+' breech',(-1.30,0,0),(.45,0,0),.19,parent=r)
        b.box(side+' breech block',(-1.28,0,0),(.31,.34,.36),'edge',r)
        b.box(side+' loading tray',(-1.32,0,-.18),(.44,.33,.08),'edge',e)
        for yy in [-.22,.22]:
            b.rod(side+' recuperator',(-.85,yy,.30),(.62,yy,.30),.095,parent=e)
            b.rod(side+' recuperator piston',(.58,yy,.30),(.95,yy,.30),.044,'edge',r)
        b.barrel(side+' barrel',length,.137,.071,.0525,r,start=.45)
        for xx in [.68,1.10]:b.rod(side+' barrel collar',(xx-.04,0,0),(xx+.04,0,0),.145,'edge',r)
        verts=[]
        for xx in [-1.10,-.80,.26,.55]:
            crown=.57 if -.9<xx<.4 else .40
            for i in range(7):
                a=i*math.pi/6;verts.append((xx,.30*math.cos(a),.12+crown*math.sin(a)))
        hood=b.mesh(side+' rounded receiver hood',verts,[(j*7+i,j*7+i+1,(j+1)*7+i+1,(j+1)*7+i) for j in range(3) for i in range(6)],parent=e)
        mod=hood.modifiers.new('Hood thickness','SOLIDIFY');mod.thickness=.018
        b.mesh(side+' receiver hood front',[(.555,yy,zz) for yy,zz in [(-.30,.12),(-.30,.28),(-.21,.42),(0,.52),(.21,.42),(.30,.28),(.30,.12)]],[tuple(range(7))],parent=e)
        for xx in [-.65,-.35,-.05]:b.box(side+' loading rail',(xx,0,.44),(.08,.43,.04),'edge',e)
    return b.finish()


def create_light(mount,col,helpers,materials):
    b=MountBuilder(mount,col,helpers,materials);s=b.s
    variant=s['id'];twin=variant=='flak38-m43u-20-twin';bofors=variant=='flak28-40-single'
    tr,z=s['trunnionForward'],s['pivotHeight']
    # Flak 28 has a low turntable and two outboard seated stations. The two
    # 20 mm variants use a tall cone with standing, elevating hand controls.
    base=.36 if bofors else (.82 if twin else .88)
    b.put(helpers['cyl'](b.name+'.sole',(0,0,.035),.48 if bofors else .36,.09,materials['edge'],col,12))
    b.cyl('tapered pedestal',(0,0,(base-.06)/2+.08),.40 if bofors else .25,base-.06,r2=.33 if bofors else .12)
    b.cyl('training bearing',(0,0,base),.42 if bofors else .15,.12,'edge')
    fw=.34 if bofors or twin else .18
    b.rod('supported transverse axle',(tr,-fw-.04,z),(tr,fw+.04,z),.055,'edge')
    for sign in [-1,1]:
        b.plate('fork',[(.12,base),(.15,base+.12),(tr+.07,z+.035),(tr-.07,z+.035),(-.09,base)],sign*fw-.025,sign*fw+.025)
        b.rod('trunnion pin',(tr,sign*(fw-.05),z),(tr,sign*(fw+.04),z),.055,'edge')
    if twin or bofors:
        shieldw=.66 if twin else 1.03
        front=.56 if twin else .765;low=.35 if twin else .365;top=1.94 if twin else 1.755
        upper=.23 if twin else .04
        for sign in [-1,1]:
            # The M43U shield has a taller right panel and a broad central slot.
            peak=top if not twin or sign>0 else 1.70
            xx=front+(upper-front)*(peak-low)/(top-low)
            shield=b.plate('shield plate',[(front,low),(xx,peak),(xx-.045,peak),(front-.045,low)],sign*(.38 if twin else .16),sign*shieldw)
            # Outer wings turn aft; the central strip remains forward of the
            # cradle and leaves the full elevation slot open.
            for v in shield.data.vertices:
                v.co.x-=max(0,abs(v.co.y)-(.38 if twin else .16))*(.22 if twin else .27)
            b.rod('shield brace',(.05,sign*.34,base+.1),(front+(upper-front)*.20/(top-low)-max(0,shieldw*.82-(.38 if twin else .16))*(.22 if twin else .27)-.02,sign*shieldw*.82,low+.20),.033)
        knee=low+(.45 if twin else .55);xx=front+(upper-front)*(knee-low)/(top-low)
        b.plate('shield lower web',[(front,low),(xx,knee),(xx-.045,knee),(front-.045,low)],-(.39 if twin else .17),.39 if twin else .17)
    if bofors:
        for sign in [-1,1]:
            b.box('carriage footboard',(-.24,sign*.68,.41),(1.75,.40,.07),'roof')
            b.rod('footboard beam',(0,0,.36),(0,sign*.86,.40),.055)
            b.rod('seat stalk',(-.82,sign*.68,.44),(-.94,sign*.68,.82),.044)
            b.put(helpers['cyl'](b.name+'.operator seat',(-.94,sign*.68,.84),.18,.07,materials.get('roof',materials['naval']),col,8))
            b.rod('backrest post',(-1.10,sign*.68,.84),(-1.10,sign*.68,1.11),.027)
            b.box('seat back',(-1.10,sign*.68,1.08),(.055,.30,.22),'roof')
            b.rod('foot rest support',(-.18,sign*.68,.44),(-.36,sign*.68,.59),.032)
            b.box('foot rest',(-.33,sign*.68,.61),(.34,.26,.035),'edge')
            b.wheel('control wheel',(-.39,sign*.51,1.09),.15)
            b.rod('control axle',(tr,sign*.34,z-.16),(-.39,sign*.51,1.09),.028)
    else:
        wz=.77 if twin else .98
        b.wheel('pedestal adjustment',(-.1,-.24,wz),.13 if twin else .18)
        b.rod('pedestal adjustment axle',(-.1,-.12,wz),(-.1,-.24,wz),.035,'edge')
        for sign in [-1,1]:
            b.box('spare magazine box',(-.13,sign*.28,.54),(.28,.17,.34),'edge')
            b.rod('magazine box bracket',(0,sign*.16,.65),(-.13,sign*.28,.65),.025)
    if not twin and not bofors:
        # The catcher is beside the receiver, suspended from the stationary
        # fork. Its open inner rim clears the swept gun and magazine opposite.
        rows=[(1.92,-.53,.34,.28),(1.84,-.53,.37,.40),(1.28,-.58,.33,.57),(1.08,-.60,.17,.52),(.99,-.60,.04,.46)]
        verts=[(cx+dx,yy,zz) for zz,cx,w,yy in rows for dx in [-w,w]]
        b.mesh('case catcher backing',verts,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(rows)-1)],'dark')
        for sign in [-1,1]:
            panels=[(cx+sign*w,lat,zz) for zz,cx,w,yy in rows for lat in [.26,yy]]
            b.mesh('catcher side panel',panels,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(rows)-1)],'dark')
        inner=[(cx+dx,.26,zz) for zz,cx,w,yy in rows for dx in [-w,w]]
        b.mesh('catcher inner panel',inner,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(rows)-1)],'dark')
        for zz,cx,w,yy in [rows[0],rows[2]]:
            b.rod('case frame support',(tr,.18,z),(cx+w,yy,zz),.022)
        for j,((zz,cx,w,yy),(vz,ux,q,vy)) in enumerate(zip(rows,rows[1:])):
            for sign in [-1,1]:b.rod('case net seam',(cx+sign*w,yy,zz),(ux+sign*q,vy,vz),.012,'dark')
    for side,y,_ in barrel_layout(s):
        e,r=b.gun_joints(side,y);length=s['muzzleForward']-tr
        if not bofors:
            for sign in ([-1 if y<0 else 1] if twin else [-1,1]):
                b.rod('control grip',(-.4,sign*.085,.10),(-.78,sign*.30,.11),.031,'dark',e)
                b.rod('control grip return',(-.78,sign*.30,.11),(-.85,sign*.30,-.08),.030,'dark',e)
        b.plate(side+' cradle',[(-.65,-.19),(.39,-.19),(.45,.10),(-.61,.14)],-.14,.14,parent=e)
        b.box(side+' receiver',(-.23,0,0),(.82,.19,.23),'edge',r)
        b.box(side+' breech',(-.65,0,0),(.13,.22,.24),'naval',r)
        b.rod(side+' recoil cylinder',(-.48,0,-.24),(.62,0,-.24),.054,parent=e)
        b.rod(side+' recoil rod',(-.65,0,-.24),(-.43,0,-.24),.026,'edge',r)
        b.rod(side+' cylinder clamp',(.3,0,-.24),(.3,0,-.10),.029,parent=e)
        b.barrel(side+' open barrel',length,.068 if bofors else .037,.032 if bofors else .016,s['caliberM']/2,r,start=.26)
        if bofors:
            b.box('vertical feed well',(-.25,0,.25),(.27,.22,.29),'naval',r)
            for xx in [-.33,-.22,-.11]:b.rod('loaded clip round',(xx,0,.18),(xx,0,.49),.025,'edge',r)
            b.rod('bofors conical muzzle',(length-.15,0,0),(length,0,0),.035,'edge',r,r2=.065)
        else:
            sign=(-1 if y<0 else 1) if twin else -1
            ob=b.box(side+' curved magazine',(-.18,sign*.25,.22),(.24,.37,.15),'dark',r);ob.rotation_euler.x=sign*.18
            b.box(side+' magazine catch',(-.06,sign*.12,.20),(.06,.10,.08),'edge',r)
        hand=1 if twin and y>0 else -1
        b.rod(side+' charging handle',(-.46,hand*.10,.01),(-.46,hand*.23,.01),.021,'edge',r)
        if not twin or y<0:
            sx=-.32 if bofors else -.11
            b.rod(side+' sight arm',(-.37,-.15,.11),(sx,-.20,.47),.022,parent=e)
            b.ring(side+' ring sight',(sx,-.20,.51),.105,'x',e,wire=.007)
            b.rod(side+' sight crosshair',(sx,-.10,.51),(sx,-.30,.51),.004,'edge',e)
            b.rod(side+' sight crosshair',(sx,-.20,.41),(sx,-.20,.61),.004,'edge',e)
        if twin and y<0:
            guard=[(0,-y,.20),(.60,-y,.20),(.85,-y,-.27),(2.45,-y,-.27)]
            for a,c in zip(guard,guard[1:]):b.rod('central bent guard',a,c,.018,'edge',e)
        b.rod(side+' rear grip',(-.68,0,0),(-.79,0,-.11),.024,'edge',r)
    if not twin and not bofors:
        # Correct this exact single mount's catcher, controls and feed hand.
        # Symmetric joints remain on the bore; only authored fittings reflect.
        reflection=Matrix.Diagonal((1,-1,1,1))
        for ob in b.yaw.children_recursive:
            if ob.type=='MESH':
                ob.data.transform(reflection);ob.data.flip_normals()
                ob.matrix_basis=reflection@ob.matrix_basis@reflection
    return b.finish()

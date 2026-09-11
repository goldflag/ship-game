"""Original German cruiser mount variants, authored against approved pgsc108 A.

No source model, source textures or reference transforms are loaded. Dimensions
are editable catalog inputs. Installation supports belong to the ship recipe.
"""
import bpy, math
from mathutils import Matrix
from blender_barrels import barrel_layout

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
    def cyl(self,n,p,r,d,m='naval',parent=None,r2=None):return self.put(self.h['cyl'](self.name+'.'+n,p,r,d,self.m.get(m,self.m['naval']),self.col,32,r2),parent)
    def rod(self,n,a,b,r,m='naval',parent=None,r2=None):return self.put(self.h['rod'](self.name+'.'+n,a,b,r,self.m.get(m,self.m['naval']),self.col,r2=r2,vertices=12),parent)
    def mesh(self,n,v,f,m='naval',parent=None):return self.put(self.h['mesh'](self.name+'.'+n,v,f,self.m.get(m,self.m['naval']),self.col),parent)
    def plate(self,n,profile,y0,y1,m='naval',parent=None):
        k=len(profile);return self.mesh(n,[(x,y,z) for y in [y0,y1] for x,z in profile],[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)],m,parent)
    def ring(self,n,p,r,axis='y',parent=None,wire=.012):
        x,y,z=p;pts=[(x+r*math.cos(i*math.tau/24),y,z+r*math.sin(i*math.tau/24)) if axis=='y' else (x,y+r*math.cos(i*math.tau/24),z+r*math.sin(i*math.tau/24)) for i in range(24)]
        for a,b in zip(pts,pts[1:]+pts[:1]):self.rod(n,a,b,wire,'edge',parent)
        return pts
    def wheel(self,n,p,r,parent=None):
        pts=self.ring(n,p,r,parent=parent)
        for i in [0,8,16]:self.rod(n+' spoke',p,pts[i],.012,'edge',parent)
        self.rod(n+' crank',pts[0],(pts[0][0],pts[0][1]+.09,pts[0][2]),.017,'edge',parent)
    def barrel(self,n,length,root,tip,bore,parent,start=.3):
        rings=[(start,root),(start+.18,root),(start+.22,root*.8),(length*.52,tip*1.25),(length-.05,tip),(length,tip),(length,bore),(length-.15,bore)]
        k=24;v=[(x,r*math.cos(i*math.tau/k),r*math.sin(i*math.tau/k)) for x,r in rings for i in range(k)]
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
    shape=s['gunhouseMesh'];o=b.mesh('faceted gunhouse',shape['vertices'],[f['indices'] for f in shape['faces']])
    o.data.materials.append(materials.get('roof',materials['edge']))
    for p,f in zip(o.data.polygons,shape['faces']):p.material_index=int(f['finish']=='roof')
    for side,y,_ in barrel_layout(s):
        e,r=b.gun_joints(side,y);length=s['muzzleForward']-s['trunnionForward']
        # Flexible canvas bellows joins the sloped face to the sliding barrel.
        k=24;rings=[(-.10,.73),(.28,.68),(.65,.55),(1.02,.37),(1.4,.265)]
        v=[(x,rad*math.cos(i*math.tau/k),rad*math.sin(i*math.tau/k)) for x,rad in rings for i in range(k)]
        b.mesh(side+' canvas boot',v,[(j*k+i,j*k+(i+1)%k,(j+1)*k+(i+1)%k,(j+1)*k+i) for j in range(4) for i in range(k)],'canvas',e)
        b.barrel(side+' stepped barrel',length,.265,.139,.1015,r,start=.46)
        b.rod(side+' breech',(-1.2,0,0),(.46,0,0),.28,parent=r)
    for y in [-2.62,2.62]:
        # The approved gunhouse has a flush rear roof, without the raised
        # rectangular hatches used on some other German turret variants.
        b.cyl('roof ventilator',(-1.3,y*.78,2.72),.15,.25,'edge')
        # Front sight flap follows the sloped face.
        o=b.box('front sight flap',(2.16,y,1.15),(.07,.63,.39),'edge');o.rotation_euler.y=-.34
        for z in [.42,.7,.98,1.26,1.54,1.82,2.1]:b.rod('side ladder rung',(-3.55,y/abs(y)*(3.36-max(0,z-1.68)*.49),z),(-3.18,y/abs(y)*(3.36-max(0,z-1.68)*.49),z),.025,'edge')
        for z in [.64,1.39]:
            b.rod('rear handrail',(-5.45,y-.30,z),(-5.45,y+.30,z),.023,'edge')
    if s['id']=='skc34-203-twin-rf':
        for sign in [-1,1]:
            b.box('rangefinder armored wing',(-3.45,sign*3.56,2.72),(1.45,.92,1.18))
            b.rod('optical lens',(-2.71,sign*3.65,2.72),(-2.66,sign*3.65,2.72),.22,'dark')
            b.box('lens brow',(-2.62,sign*3.65,2.97),(.22,.57,.10),'edge')
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
        for x in [-.12,.32]:
            for z in [1.05,1.27]:b.rod('cover bolt',(x,sign*1.47,z),(x,sign*1.49,z),.018,'edge')
        b.box('rear crew foot grate',(-2.25,sign*1.27,.60),(.62,.43,.055),'edge')
        b.rod('rear foot grate bearer',(-1.85,sign*1.27,.58),(-2.56,sign*1.27,.58),.042)
        b.cyl('crew seat',(-1.55,sign*1.15,1.09),.22,.10,'roof');b.rod('seat stem',(-1.55,sign*1.15,.63),(-1.55,sign*1.15,1.04),.049)
        b.wheel('elevation handwheel',(-.30,sign*1.70,1.10),.18)
        b.rod('control shaft',(-.3,sign*.65,1.10),(-.3,sign*1.70,1.10),.041)
        b.box('trunnion bearing',(s['trunnionForward'],sign*.94,s['pivotHeight']-.16),(.63,.34,.66))
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
            for i in range(13):
                a=i*math.pi/12;verts.append((xx,.30*math.cos(a),.12+crown*math.sin(a)))
        hood=b.mesh(side+' rounded receiver hood',verts,[(j*13+i,j*13+i+1,(j+1)*13+i+1,(j+1)*13+i) for j in range(3) for i in range(12)],parent=e)
        mod=hood.modifiers.new('Hood thickness','SOLIDIFY');mod.thickness=.018
        for xx in [-.65,-.35,-.05]:b.box(side+' loading rail',(xx,0,.44),(.08,.43,.04),'edge',e)
    return b.finish()


def create_light(mount,col,helpers,materials):
    b=MountBuilder(mount,col,helpers,materials);s=b.s
    variant=s['id'];twin=variant=='flak38-m43u-20-twin';bofors=variant=='flak28-40-single'
    tr,z=s['trunnionForward'],s['pivotHeight']
    # Flak 28 has a low turntable and two outboard seated stations. The two
    # 20 mm variants use a tall cone with standing, elevating hand controls.
    base=.36 if bofors else (.82 if twin else .88)
    b.cyl('sole',(0,0,.035),.48 if bofors else .36,.09,'edge')
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
            peak=top if not twin or sign<0 else 1.70
            xx=front+(upper-front)*(peak-low)/(top-low)
            b.plate('shield plate',[(front,low),(xx,peak),(xx-.045,peak),(front-.045,low)],sign*(.38 if twin else .16),sign*shieldw)
            b.rod('shield brace',(.05,sign*.34,base+.1),(front-.03,sign*shieldw*.82,low+.20),.033)
        knee=low+(.45 if twin else .55);xx=front+(upper-front)*(knee-low)/(top-low)
        b.plate('shield lower web',[(front,low),(xx,knee),(xx-.045,knee),(front-.045,low)],-(.39 if twin else .17),.39 if twin else .17)
    if bofors:
        for sign in [-1,1]:
            b.box('carriage footboard',(-.24,sign*.68,.41),(1.75,.40,.07),'roof')
            b.rod('footboard beam',(0,0,.36),(0,sign*.86,.40),.055)
            b.rod('seat stalk',(-.82,sign*.68,.44),(-.94,sign*.68,.82),.044)
            b.box('operator seat',(-.94,sign*.68,.84),(.34,.32,.07),'roof')
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
            for t in [i/12 for i in range(13)]:b.rod('case net warp',(cx-w+2*w*t,yy,zz),(ux-q+2*q*t,vy,vz),.006,'edge')
            for t in [i/6 for i in range(6)]:
                xx,hh,ww,lat=cx+(ux-cx)*t,zz+(vz-zz)*t,w+(q-w)*t,yy+(vy-yy)*t
                b.rod('case net weft',(xx-ww,lat,hh),(xx+ww,lat,hh),.006,'edge')
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
            b.rod('bofors muzzle collar',(length-.13,0,0),(length-.03,0,0),.049,'edge',r)
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
    return b.finish()

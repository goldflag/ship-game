"""Original Type 89 A1/Mod 2 and Type 96 carrier mounts.

S05/S06 references in Shokaku's register distinguish visible mechanisms from
estimated local dimensions. Stable yaw/elevation/recoil nodes use catalog data.
All helpers receive parent-local metres in the Blender forward/port/up frame.
"""
import math
import bpy
from blender_barrels import barrel_layout

def create_mount(mount,col,helpers,mats):
    mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
    spec=mount['weapon'];name=mount['id'];heavy=spec['caliberM']>.1
    shielded='mod2' in spec['id'] or 'shielded' in spec['id']
    gray,dark,steel=(mats[k] for k in ['naval','dark','edge'])
    before=set(bpy.context.scene.objects)
    def empty(suffix,parent=None,loc=(0,0,0)):
        o=bpy.data.objects.new(name+'.'+suffix,None);col.objects.link(o)
        o['nodeId']=o.name;o['assemblyId']=name;o.parent=parent;o.location=loc;return o
    def attach(o,parent):
        o.parent=parent;o['assemblyId']=name;return o
    def cube(label,loc,size,parent,mat=gray):return attach(box(name+'.'+label,loc,size,mat,col),parent)
    def bar(label,a,b,r,parent,mat=steel,vertices=10):return attach(rod(name+'.'+label,a,b,r,mat,col,vertices=vertices),parent)
    def drum(label,loc,r,h,parent,mat=gray,vertices=24):return attach(cyl(name+'.'+label,loc,r,h,mat,col,vertices),parent)
    def ring(label,center,r,parent,axis='y',tube=.018):
        x,y,z=center
        def point(a):
            if axis=='x':return (x,y+r*math.cos(a),z+r*math.sin(a))
            return (x+r*math.cos(a),y,z+r*math.sin(a)) if axis=='y' else (x+r*math.cos(a),y+r*math.sin(a),z)
        for i in range(20):bar(label,point(i*math.tau/20),point((i+1)*math.tau/20),tube,parent,vertices=6)
        for i in range(4):bar(label+'-spoke',center,point(i*math.pi/2),tube*.65,parent,vertices=6)
    a,b,c=mount['position'];root=empty('base',loc=(-c,-a,b));yaw=empty('yaw',root)
    yaw.rotation_euler.z=-math.radians(mount['bearingDeg'])
    drum('foundation',(0,0,.075),spec['barbetteRadius'],.15,root,steel,48)
    drum('roller-path',(0,0,.205),spec['barbetteRadius']*.84,.18,yaw,steel,48)
    # Roller bolts belong to the fixed seat; rotating floor is physically seated.
    for i in range(24 if heavy else 16):
        t=i*math.tau/(24 if heavy else 16);r=spec['barbetteRadius']*.92
        drum('foundation-bolt',(r*math.cos(t),r*math.sin(t),.157),.042 if heavy else .025,.035,root,steel,6)
    H=spec['pivotHeight'];T=spec['trunnionForward'];W=spec['gunhouseSize'][1]
    # Open fork on a low rotating base. A solid high central column would
    # occupy the descending breech/loader path at high elevation.
    drum('rotating-pedestal',(0,0,.40 if heavy else .35),.72 if heavy else .37,.38 if heavy else .30,yaw)
    cube('cross-saddle',(T*.35,0,.42 if heavy else .35),(.95 if heavy else .55,W*.68,.26 if heavy else .16),yaw)
    for sign in [-1,1]:
        y=sign*(1.27 if heavy else .8)
        bar('fork-leg',(T*.35,y,.42 if heavy else .35),(T,y,H*.65),.115 if heavy else .075,yaw,gray,20)
        cube('bearing-cheek',(T,y,H*.78),(.8 if heavy else .48,.19,H*.53),yaw)
        bar('trunnion-cap',(T,y-.13,H),(T,y+.13,H),.24 if heavy else .14,yaw,vertices=24)
        # Training/elevation operator's seats, shafts and handwheels.
        sy=sign*(1.48 if heavy else 1.04)
        bar('seat-floor-arm',(0,0,.26),(-.85,sy,.26),.045,yaw,gray)
        bar('seat-outrigger',(-.85,sy,.26),(-.85,sy,.65),.06,yaw,gray)
        bar('seat-post',(-.85,sy,.62),(-.85,sy,.93),.048,yaw,gray)
        cube('operator-seat',(-.85,sy,.96),(.42,.38,.085),yaw,steel)
        cube('seat-back',(-1.07,sy,1.12),(.065,.37,.30),yaw,steel)
        bar('control-shaft',(-.40,y,H*.57),(-.40,sy,H*.57),.05,yaw)
        cube('control-gearbox',(-.30,y,H*.57),(.40,.24,.32),yaw)
        bar('control-gearbox-support',(-.3,y,H*.57),(T,y,H*.57),.055,yaw,gray)
        ring('control-handwheel',(-.4,sy,H*.57),.24 if heavy else .18,yaw)
        cube('footrest',(-.4,sy,.4),(.42,.35,.065),yaw,steel)
        bar('footrest-bracket',(-.4,sy,.4),(-.85,sy,.70),.032,yaw,gray)
    # Bearing stubs terminate in the annular elevating seats. Do not put a
    # continuous solid axle through the recoiling receivers and gas systems.
    gap=.20 if heavy else .13
    intervals=[(-W*.36,W*.36)]
    for _,lateral,_ in barrel_layout(spec):
        intervals=[v for a,b in intervals for v in [(a,min(b,lateral-gap)),(max(a,lateral+gap),b)] if v[1]>v[0]]
    for a,b in intervals:bar('fixed-trunnion-shaft',(T,a,H),(T,b,H),.15 if heavy else .085,yaw,vertices=24)
    if heavy:
        # Hydraulic power unit and training gearbox sit on the rotating floor.
        cube('power-gearbox',(1.05,1.45,.49),(.65,.58,.42),yaw)
        bar('training-motor',(.5,1.45,.62),(1.05,1.45,.62),.21,yaw,vertices=20)
        bar('power-unit-seat',(.2,.6,.4),(1.05,1.45,.4),.10,yaw,gray)
        cube('fuze-setting-cabinet',(T+.2,1.53,H*.57),(.55,.38,.45),yaw)
        for y in [1.36,1.42]:
            bar('hydraulic-feed',(.8,1.45,.62),(.8,y,.62),.029,yaw)
            bar('hydraulic-pipe',(.8,y,.62),(.8,y,1.35),.029,yaw)
            bar('hydraulic-pipe-elbow',(.8,y,1.35),(T,y,1.35),.029,yaw)
            bar('hydraulic-terminal',(T,y,1.35),(T,1.27,1.35),.029,yaw)
    for side,lateral,vertical in barrel_layout(spec):
        elevation=empty(side+'.elevation',yaw,(T,lateral,H+vertical));elevation.rotation_euler.y=-math.radians(1)
        recoil=empty(side+'.recoil',elevation)
        length=spec['muzzleForward']-T;radius=spec['barrelBaseRadius']
        empty(side+'.muzzle',recoil,(length,0,0))
        seat=.24 if heavy else .16
        bar('elevating-bearing',(0,-seat,0),(0,seat,0),radius*1.65,elevation,vertices=24)
        cube('cradle-slide',(-.16,0,-.12 if heavy else -.06),(1.25 if heavy else .75,.37 if heavy else .14,.19 if heavy else .1),elevation)
        # Type 89's 5.284 m complete gun and 5.080 m bore include the chamber;
        # the original overlong breech block incorrectly enlarged the gun.
        cube('breech-ring',(-.44 if heavy else -.33,0,0),(.528 if heavy else .64,.40 if heavy else .15,.38 if heavy else .18),recoil,steel)
        cube('sliding-breech-block',(-.665 if heavy else -.55,0,.035),(.078 if heavy else .12,.45 if heavy else .17,.31 if heavy else .16),recoil)
        if heavy:
            bar('breech-neck',(-.30,0,0),(.08,0,0),radius*1.12,recoil,steel,24)
            bar('breech-operating-lever',(-.55,.22,.03),(-.68,.33,-.17),.024,recoil)
        else:bar('charging-handle',(-.43,.075,.02),(-.51,.16,.04),.013,recoil)
        for i,(start,end,scale0,scale1) in enumerate([(0,.32,1.0,.95),(.32,.66,.94,.8),(.66,1,.70,.60)]):
            attach(rod(name+'.barrel-'+str(i),(length*start,0,0),(length*end,0,0),radius*scale0,steel,col,vertices=20,r2=radius*scale1),recoil)
        bar('muzzle-bore',(length-.025,0,0),(length+.002,0,0),spec['caliberM']/2,recoil,dark,24)
        if heavy:
            # USNTMJ O-47(N)-1, enclosure G: paired upper cylinders, side
            # loader footholds, and a tray for the 0.971 m fixed round.
            for sy in [-.20,.20]:
                bar('upper-recoil-cylinder',(-.58,sy,.36),(1.55,sy,.36),.095,elevation,gray,20)
                bar('recoil-piston',(1.2,sy,.36),(1.82,sy,.36),.045,recoil,steel,16)
                for xx in [-.3,.7]:bar('cylinder-saddle',(xx,sy,.10),(xx,sy,.36),.055,elevation,gray)
            cube('loading-tray',(-1.24,0,-.20),(.971,.43,.07),elevation)
            for sy in [-.17,.17]:bar('loading-tray-support',(-.5,sy,-.12),(-1.24,sy,-.20),.035,elevation,gray)
            for sy in [-.22,.22]:bar('tray-rim',(-1.7255,sy,-.16),(-.7545,sy,-.16),.026,elevation)
            bar('rammer-track',(-1.69,.26,-.12),(-.60,.26,-.12),.065,elevation)
            cube('rammer-head',(-1.55,.26,-.12),(.16,.19,.19),elevation,steel)
            # Enclosure G places the loader's foothold behind and below the
            # breech/tray. Its local offset is estimated from that side view;
            # it must follow the rear loader frame, not project under the bore.
            cube('loader-platform',(-1.30,0,-.70),(.64,.61,.08),elevation,steel)
            for y in [-.24,.24]:bar('loader-platform-bracket',(-.55,y,-.14),(-1.30,y,-.70),.055,elevation,gray)
        else:
            # Top-mounted 15-round box magazines, receiver and ribbed gas system.
            cube('magazine-receiver',(-.28,0,.14),(.26,.20,.12),recoil)
            cube('15-round-magazine',(-.3,0,.35),(.27,.17,.37),recoil,steel)
            cube('magazine-cap',(-.3,0,.54),(.29,.19,.035),recoil)
            for sy in [-.09,.09]:
                for xx in [-.37,-.26]:bar('magazine-stiffener',(xx,sy,.19),(xx,sy,.51),.008,recoil,gray,6)
            bar('gas-cylinder',(-.27,0,-.095),(.61,0,-.095),.032,elevation,gray,12)
            for n in range(12):
                x=.15+n*.039
                o=cyl(name+'.barrel-cooling-ring',(x,0,0),radius*1.12,.017,steel,col,16);o.rotation_euler.y=math.pi/2;attach(o,recoil)
            attach(rod(name+'.conical-flash-hider',(length-.10,0,0),(length,0,0),.036,steel,col,vertices=20,r2=.057),recoil)
        # The sight bracket is seated on the elevating slide, so it follows the bore.
        if heavy or side=='center':
            sy=.32 if heavy else .18
            bar('sight-bracket',(-.1,0,-.04),(-.1,sy,.43 if heavy else .3),.025 if heavy else .016,elevation)
            bar('sight-telescope',(-.24,sy,.43 if heavy else .3),(.18,sy,.43 if heavy else .3),.055 if heavy else .032,elevation,steel)
            if not heavy:ring('ring-sight',(.18,sy,.30),.12,elevation,axis='x',tube=.009)
    if shielded:
        # Gas protection uses the carrier hood, not the much heavier Yamato shield.
        # Curved roof and vertical lower skirt are open at the two gun slots.
        length,width,height=spec['gunhouseSize'];width*=.98
        x0=-length*.48;x1=length*.28
        sections=[(-width/2,.35),(-width/2,height*.53),(-width*.41,height*.79),(-width*.23,height*.94),(0,height),(width*.23,height*.94),(width*.41,height*.79),(width/2,height*.53),(width/2,.35)]
        # Gun openings continue over the crown for high-angle elevation.
        # Keep a solid rear arch; roof strips are attached to that arch.
        slot_half=.32 if heavy else .16
        slots=[(lateral-slot_half,lateral+slot_half) for _,lateral,_ in barrel_layout(spec)]
        ys=sorted(set([p[0] for p in sections]+[v for slot in slots for v in slot]))
        roof=sections[1:-1]
        def height_at(y):
            for (a,h0),(b,h1) in zip(roof,roof[1:]):
                if a<=y<=b:return h0+(h1-h0)*(y-a)/(b-a)
            return height*.53
        verts=[];faces=[]
        def quad(points):
            n=len(verts);verts.extend(points);faces.append((n,n+1,n+2,n+3))
        split=T-.65
        for a,b in zip(ys,ys[1:]):
            for lo,hi in [(x0,split),(split,x1)]:
                if lo==split and any(s0<(a+b)/2<s1 for s0,s1 in slots):continue
                quad([(lo,a,height_at(a)),(hi,a,height_at(a)),(hi,b,height_at(b)),(lo,b,height_at(b))])
        for y in [-width/2,width/2]:quad([(x0,y,.35),(x1,y,.35),(x1,y,height*.53),(x0,y,height*.53)])
        n=len(verts);verts.extend((x0,y,z) for y,z in sections);faces.append(tuple(range(n,n+len(sections))))
        o=attach(mesh(name+'.curved-gas-hood',verts,faces,gray,col),yaw)
        solid=o.modifiers.new('Physical shield thickness','SOLIDIFY');solid.thickness=.035 if heavy else .02
        cube('front-apron',(x1,0,H-.85 if heavy else .48),(.045,width,.85 if heavy else .43),yaw)
        for y in [-width*.48,width*.48]:cube('front-cheek',(x1,y,H-.03),(.045,.12,1.6 if heavy else .9),yaw)
        for a,b in zip(ys,ys[1:]):
            if any(s0<(a+b)/2<s1 for s0,s1 in slots):continue
            bar('front-roof-edge',(x1,a,height_at(a)),(x1,b,height_at(b)),.025,yaw,gray)
        for y in [-width*.46,width*.46]:bar('hood-frame',(x0,y,.24),(x0,y,height*.57),.035,yaw,gray)
        for y in [-width*.46,width*.46]:bar('hood-underframe',(0,0,.26),(x0,y,.30),.065,yaw,gray)
        cube('rear-access-door',(x0-.01,0,1.06 if heavy else .83),(.045,.72 if heavy else .5,1.35 if heavy else .85),yaw,steel)
        bar('door-handle',(x0-.06,.21,.95),(x0-.06,.21,1.15),.029,yaw)
    for o in set(bpy.context.scene.objects)-before:o['assemblyId']=name
    return yaw

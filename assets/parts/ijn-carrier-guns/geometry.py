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
    def drum(label,loc,r,h,parent,mat=gray,vertices=12):return attach(cyl(name+'.'+label,loc,r,h,mat,col,vertices),parent)
    def cheek(label,profile,y,thickness,parent,mat=gray):
        n=len(profile);vs=[(x,y+dy,z) for dy in [-thickness/2,thickness/2] for x,z in profile]
        return attach(mesh(name+'.'+label,vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],mat,col),parent)
    def ring(label,center,r,parent,axis='y',tube=.018):
        x,y,z=center
        def point(a):
            if axis=='x':return (x,y+r*math.cos(a),z+r*math.sin(a))
            return (x+r*math.cos(a),y,z+r*math.sin(a)) if axis=='y' else (x+r*math.cos(a),y+r*math.sin(a),z)
        for i in range(12):bar(label,point(i*math.tau/12),point((i+1)*math.tau/12),tube,parent,vertices=6)
        for i in range(4):bar(label+'-spoke',center,point(i*math.pi/2),tube*.65,parent,vertices=6)
    a,b,c=mount['position'];root=empty('base',loc=(-c,-a,b));yaw=empty('yaw',root)
    yaw.rotation_euler.z=-math.radians(mount['bearingDeg'])
    drum('foundation',(0,0,.075),spec['barbetteRadius']*(1 if heavy or shielded else .72),.15,root,steel,24)
    drum('roller-path',(0,0,.205),spec['barbetteRadius']*(.84 if heavy or shielded else .60),.18,yaw,steel,24)
    # Roller bolts belong to the fixed seat; rotating floor is physically seated.
    for i in range(12 if shielded else (16 if heavy else 16)):
        t=i*math.tau/(12 if shielded else (16 if heavy else 16));r=spec['barbetteRadius']*(.92 if heavy or shielded else .65)
        drum('foundation-bolt',(r*math.cos(t),r*math.sin(t),.157),.042 if heavy else .025,.035,root,steel,6)
    H=spec['pivotHeight'];T=spec['trunnionForward'];W=spec['gunhouseSize'][1]
    # Open fork on a low rotating base. A solid high central column would
    # occupy the descending breech/loader path at high elevation.
    drum('rotating-pedestal',(0,0,.40 if heavy else .35),.72 if heavy else .37,.38 if heavy else .30,yaw)
    cube('cross-saddle',(T*.35,0,.42 if heavy else .35),(.95 if heavy else .55,W*.68,.26 if heavy else .16),yaw)
    seat_x=-.69 if shielded and not heavy else -.85
    for sign in [-1,1]:
        y=sign*(1.27 if heavy else .8)
        bar('fork-leg',(T*.35,y,.42 if heavy else .35),(T,y,H*.65),.115 if heavy else .075,yaw,gray,12)
        # The side plates rake into the bearing; a tall rectangular ear hides
        # the open carriage and does not reproduce the Type 96 silhouette.
        if not heavy:
            cheek('bearing-cheek',[(T-.43,.36),(T+.40,.36),(T+.16,H+.11),(T-.10,H+.14),(T-.28,H-.22)],y,.14,yaw)
        else:
            cheek('bearing-cheek',[(T-.46,.42),(T+.46,.42),(T+.26,H-.1),(T+.11,H+.15),(T-.15,H+.15),(T-.25,H-.1)],y,.19,yaw)
        bar('trunnion-cap',(T,y-.13,H),(T,y+.13,H),.24 if heavy else .14,yaw,vertices=12)
        # Training/elevation operator's seats, shafts and handwheels.
        sy=sign*(1.48 if heavy else 1.04)
        bar('seat-floor-arm',(0,0,.26),(seat_x,sy,.26),.045,yaw,gray)
        bar('seat-outrigger',(seat_x,sy,.26),(seat_x,sy,.65),.06,yaw,gray)
        bar('seat-post',(seat_x,sy,.62),(seat_x,sy,.93 if heavy else .69),.048,yaw,gray)
        cube('operator-seat',(seat_x,sy,.96 if heavy else .72),(.42,.38,.085),yaw,steel)
        cube('seat-back',(seat_x-.22,sy,1.12 if heavy else .84),(.065,.37,.30 if heavy else .20),yaw,steel)
        bar('control-shaft',(-.40,y,H*.57),(-.40,sy,H*.57),.05,yaw)
        cube('control-gearbox',(-.30,y,H*.57),(.40,.24,.32),yaw)
        bar('control-gearbox-support',(-.3,y,H*.57),(T,y,H*.57),.055,yaw,gray)
        ring('control-handwheel',(-.4,sy,H*.57),.24 if heavy else .18,yaw)
        cube('footrest',(-.4,sy,.4),(.42,.35,.065),yaw,steel)
        bar('footrest-bracket',(-.4,sy,.4),(seat_x,sy,.70),.032,yaw,gray)
    if not heavy:
        for yy in [-.64,.64]:
            bar('lower-carriage-runner',(-.72,yy,.32),(.65,yy,.32),.032,yaw,gray,6)
            bar('front-footboard-support',(.20,yy,.34),(.67,yy,.16),.030,yaw,gray,6)
        bar('front-carriage-tie',(.65,-.64,.32),(.65,.64,.32),.032,yaw,gray,6)
    # Bearing stubs terminate in the annular elevating seats. Do not put a
    # continuous solid axle through the recoiling receivers and gas systems.
    gap=.20 if heavy else .13
    intervals=[(-W*.36,W*.36)]
    for _,lateral,_ in barrel_layout(spec):
        intervals=[v for a,b in intervals for v in [(a,min(b,lateral-gap)),(max(a,lateral+gap),b)] if v[1]>v[0]]
    for a,b in intervals:bar('fixed-trunnion-shaft',(T,a,H),(T,b,H),.15 if heavy else .085,yaw,vertices=12)
    if heavy:
        # Hydraulic power unit and training gearbox sit on the rotating floor.
        cube('power-gearbox',(1.05,1.45,.49),(.65,.58,.42),yaw)
        bar('training-motor',(.5,1.45,.62),(1.05,1.45,.62),.21,yaw,vertices=12)
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
        bar('elevating-bearing',(0,-seat,0),(0,seat,0),radius*1.65,elevation,vertices=12)
        cube('cradle-slide',(-.16,0,-.12 if heavy else -.06),(1.25 if heavy else .75,.37 if heavy else .14,.19 if heavy else .1),elevation)
        # Type 89's 5.284 m complete gun and 5.080 m bore include the chamber;
        # the original overlong breech block incorrectly enlarged the gun.
        cube('breech-ring',(-.44 if heavy else -.33,0,0),(.528 if heavy else .64,.40 if heavy else .15,.38 if heavy else .18),recoil,steel)
        cube('sliding-breech-block',(-.665 if heavy else -.55,0,.035),(.078 if heavy else .12,.45 if heavy else .17,.31 if heavy else .16),recoil)
        if heavy:
            bar('breech-neck',(-.30,0,0),(.08,0,0),radius*1.12,recoil,steel,12)
            bar('breech-operating-lever',(-.55,.22,.03),(-.68,.33,-.17),.024,recoil)
        else:bar('charging-handle',(-.43,.075,.02),(-.51,.16,.04),.013,recoil)
        for i,(start,end,scale0,scale1) in enumerate([(0,.32,1.0,.95),(.32,.66,.94,.8),(.66,1,.70,.60)]):
            attach(rod(name+'.barrel-'+str(i),(length*start,0,0),(length*end,0,0),radius*scale0,steel,col,vertices=12,r2=radius*scale1),recoil)
        bar('muzzle-bore',(length-.025,0,0),(length+.002,0,0),spec['caliberM']/2,recoil,dark,12)
        if heavy:
            # USNTMJ O-47(N)-1, enclosure G: paired upper cylinders, side
            # loader footholds, and a tray for the 0.971 m fixed round.
            for sy in [-.20,.20]:
                bar('upper-recoil-cylinder',(-.58,sy,.36),(1.55,sy,.36),.095,elevation,gray,12)
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
            cheek('15-round-magazine',[(-.435,.18),(-.165,.18),(-.12,.49),(-.19,.55),(-.39,.55),(-.46,.46)],0,.17,recoil,steel)
            cube('magazine-cap',(-.29,0,.55),(.20,.19,.025),recoil)
            for sy in [-.09,.09]:
                for xx in [-.37,-.26]:bar('magazine-stiffener',(xx,sy,.19),(xx,sy,.51),.008,recoil,gray,6)
            bar('gas-cylinder',(-.27,0,-.095),(.61,0,-.095),.032,elevation,gray,12)
            for n in range(12):
                x=.15+n*.039
                o=cyl(name+'.barrel-cooling-ring',(x,0,0),radius*1.12,.017,steel,col,6);o.rotation_euler.y=math.pi/2;attach(o,recoil)
            attach(rod(name+'.conical-flash-hider',(length-.10,0,0),(length,0,0),.036,steel,col,vertices=12,r2=.057),recoil)
        # The sight bracket is seated on the elevating slide, so it follows the bore.
        if heavy or side=='center':
            sy=.32 if heavy else .18
            bar('sight-bracket',(-.1,0,-.04),(-.1,sy,.43 if heavy else .3),.025 if heavy else .016,elevation)
            bar('sight-telescope',(-.24,sy,.43 if heavy else .3),(.18,sy,.43 if heavy else .3),.055 if heavy else .032,elevation,steel)
            if not heavy:
                ring('ring-sight',(.18,sy,.30),.12,elevation,axis='x',tube=.009)
                bar('director-crossbar',(-.1,-.92-lateral,.30),(-.1,.92-lateral,.30),.022,elevation,gray,8)
                for yy in [-.92-lateral,.92-lateral]:cube('director-end',(-.1,yy,.30),(.13,.16,.07),elevation)
    if heavy and not shielded:
        # The open A1 still carries an operator's curved splinter screen and
        # the flanking machinery cabinets seen in the approved source. These
        # are distinct from the enclosing Mod 2 gas hood.
        vs=[];faces=[]
        for yy in [1.15,1.68]:
            for j in range(9):
                angle=math.radians(15+j*150/8)
                vs.append((-.60-1.05*math.cos(angle),yy,2.13+1.08*math.sin(angle)))
        for j in range(8):faces.append((j,j+1,j+10,j+9))
        panel=attach(mesh(name+'.operator-curved-screen',vs,faces,gray,col),yaw)
        solid=panel.modifiers.new('Operator shield plate','SOLIDIFY');solid.thickness=.035
        for yy in [1.15,1.68]:
            bar('screen-support',(-1.58,yy,.54),(-1.58,yy,2.42),.045,yaw,gray,8)
        for sy in [-1,1]:
            yy=sy*1.37
            cheek('side-machinery-cabinet',[(-.85,.38),(.68,.38),(.68,1.48 if sy<0 else 1.85),(.38,1.83 if sy<0 else 2.10),(-.85,1.83 if sy<0 else 2.10)],yy,.66,yaw)
            cube('cabinet-seat',(-.03,yy,.36),(1.36,.69,.12),yaw,steel)
            for zz in [.69,1.12,1.55]:
                cube('cabinet-access-panel',(.69,yy,zz),(.035,.46,.24),yaw)
                bar('cabinet-pull',(.718,yy-.09,zz),(.718,yy+.09,zz),.017,yaw,steel,6)
    if shielded:
        # Original polygonal smoke/gas enclosure. The circular plan, broad
        # skirt and sloping shoulders distinguish these from a rectangular
        # barrel-vault shelter. The existing bore and motion contract are kept.
        rx,ry,cx=(2.10,2.00,-.30) if heavy else (1.42,1.42,-.16)
        bottom=.25 if heavy else .48
        height=spec['gunhouseSize'][2]
        front=T+.85 if heavy else T+.56
        slot_half=.32 if heavy else .16
        slots=[(lateral-slot_half,lateral+slot_half) for _,lateral,_ in barrel_layout(spec)]
        ys=sorted(set([-ry,-ry*.92,-ry*.71,-ry*.38,0,ry*.38,ry*.71,ry*.92,ry]+[v for slot in slots for v in slot]))
        def extent(y):return rx*math.sqrt(max(0,1-(y/ry)**2))
        def rear(y):return cx-extent(y)*(.84 if heavy else .94)
        def forward(y):return min(front,cx+extent(y))
        def crown(y):return height*(1-.23*max(0,(abs(y)/ry-.30)/.70)) if heavy else height*(1-.10*max(0,(abs(y)/ry-.71)/.29))
        verts=[];faces=[]
        def panel(points):
            k=len(verts);verts.extend(points);faces.append(tuple(range(k,len(verts))))
        split=T-.85 if heavy else T-.62
        for a,b in zip(ys,ys[1:]):
            middle=(a+b)/2;inside=any(lo<middle<hi for lo,hi in slots)
            ra,rb=rear(a),rear(b);fa,fb=forward(a),forward(b)
            sa,sb=min(fa,max(ra,split)),min(fb,max(rb,split))
            ha,hb=crown(a),crown(b)
            # Rear shoulder connects the faceted side wall to the roof.
            panel([(cx-extent(a),a,bottom),(cx-extent(b),b,bottom),(rb,b,hb*.88),(ra,a,ha*.88)])
            panel([(ra,a,ha*.88),(rb,b,hb*.88),(sb,b,hb),(sa,a,ha)])
            nose_a=min(ha*.96,H+.38 if heavy else H-.16);nose_b=min(hb*.96,H+.38 if heavy else H-.16)
            if not inside:panel([(sa,a,ha),(sb,b,hb),(fb,b,nose_b),(fa,a,nose_a)])
            low=H-(.34 if heavy else .16)
            panel([(fa,a,bottom),(fa,a,min(low,nose_a) if inside else nose_a),(fb,b,min(low,nose_b) if inside else nose_b),(fb,b,bottom)])
        hood=attach(mesh(name+'.faceted-gas-hood',verts,faces,gray,col),yaw)
        solid=hood.modifiers.new('Physical shield thickness','SOLIDIFY');solid.thickness=.035 if heavy else .02
        # Continuous rotating skirt sits directly on the retained foundation.
        drum('hood-skirt',(cx,0,bottom/2),ry,bottom,yaw,gray,16)
        # Low rail follows the outer rear shoulder; every stanchion ends in it.
        for i in range(8):
            a=math.pi/2+i*math.pi/8;b=a+math.pi/8
            p=(cx+rx*.84*math.cos(a),ry*.94*math.sin(a),height*.95)
            q=(cx+rx*.84*math.cos(b),ry*.94*math.sin(b),height*.95)
            # The heavy hood has no high rear rail in the registered resource.
            if not heavy:
                bar('hood-roof-rail',p,q,.015,yaw,gray,6)
                bar('hood-rail-foot',(p[0],p[1],height*.86),p,.012,yaw,gray,6)
    for o in set(bpy.context.scene.objects)-before:o['assemblyId']=name
    return yaw

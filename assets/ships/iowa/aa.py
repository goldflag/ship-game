"""Light AA mechanisms for every Bofors Mk.1 quad and Oerlikon Mk.4, then the default
installation (tub or pedestal) for any AA mount a region file has not installed itself.

Region files add a mount ID to AA_INSTALLED when they build its tub, gallery or platform.
"""
# Visible Mk.1/Mk.4 mechanisms, reconstructed from the approved close-ups.
# Carriage fittings train with yaw; feeds and sights elevate; the breech and
# cooling sleeves recoil with their barrel. No external meshes enter this recipe.
COL=collections['Light AA'];F=Fittings(helpers,materials,COL)
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
        cyl('Bofors lower training drum',(0,0,.33),.52,.24,vertices=20,r2=.43)
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
            F.ring('Bofors handwheel',(-.25,side*.99,1.32),.24,.023,'y',segments=12)
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
        cyl('Pedestal collar',(0,0,.91),.23,.085,'edge',vertices=14)
        for z in [.46,1.02]:F.ring('Pedestal seam',(0,0,z),.206,.018,segments=12)
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
            for x in [.23+i*.054 for i in range(10)]:F.ring('Bofors cooling ring',(x,0,0),.084,.011,'x',segments=8)
        else:
            # The drum face is transverse to the gun, with a separate rim,
            # latch and stamped radial ribs, as visible behind the shield.
            for obj in list(elevation.children):
                if obj.type=='MESH' and any(obj.name.startswith(m['id']+'.'+suffix) for suffix in ['shoulder','sight']):bpy.data.objects.remove(obj,do_unlink=True)
            for obj in list(recoil.children):
                if obj.type=='MESH' and obj.name.startswith(m['id']+'.drum'):bpy.data.objects.remove(obj,do_unlink=True)
            rod('Oerlikon drum',(-.22,-.13,.23),(-.22,.13,.23),.24,'dark',vertices=16)
            for side in [-1,1]:
                F.ring('Drum retaining rim',(-.22,side*.137,.23),.235,.014,'y',segments=14)
                for a in [i*math.tau/8 for i in range(8)]:rod('Drum rib',(-.22,side*.145,.23),(-.22+.20*math.cos(a),side*.145,.23+.20*math.sin(a)),.010,'edge',vertices=4)
            box('Magazine latch',(-.44,0,.03),(.12,.26,.10),'edge')
            for x in [.16+i*.06 for i in range(5)]:F.ring('Oerlikon recoil spring',(x,0,0),.051,.008,'x',segments=8)
            for side in [-1,1]:
                rod('Shoulder rest',(-.52,side*.11,-.02),(-.91,side*.30,-.07),.025,'edge',vertices=8)
                box('Shoulder pad',(-.92,side*.30,-.06),(.09,.17,.20),'dark')
            rod('Cocking lever',(-.18,-.07,-.05),(-.18,-.28,-.07),.023,'edge',vertices=8)
        attach_all(set(scene.objects)-before,recoil)
        before=set(scene.objects)
        side=-1 if barrel=='left' else 1
        yy=side*.35 if heavy else .10
        rod('Sight bracket',(.02,0,.08),(.12,yy,.39),.023,'naval',vertices=8)
        F.ring('Ring sight',(.12,yy,.47),.15 if heavy else .11,.013,'x',segments=10)
        rod('Sight crosshair',(.12,yy-.10,.47),(.12,yy+.10,.47),.006,'edge',vertices=4)
        rod('Sight crosshair',(.12,yy,.37),(.12,yy,.57),.006,'edge',vertices=4)
        attach_all(set(scene.objects)-before,elevation)


COL=collections['Light AA']
for m in D['mounts']:
    if m['weapon']['caliberM']<.1 and m['id'] not in AA_INSTALLED:
        ASSEMBLY=m['id'];default_aa_installation(m)

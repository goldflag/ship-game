"""Original Type 93 13.2 mm single/twin mechanisms from approved Fubuki views.
Separate recipes/IDs from Type 96; no external geometry or texture reads.
"""
import bpy,math
from blender_barrels import barrel_layout

def create_mount(mount,col,helpers,materials):
    mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
    sp=mount['weapon'];name=mount['id'];twin=sp['barrelCount']==2
    gray,edge,dark=(materials[k] for k in ['naval','edge','dark'])
    bronze=materials.get('bronze',edge);wood=materials.get('wood',edge)
    def empty(suffix,parent=None,pos=(0,0,0)):
        o=bpy.data.objects.new(name+'.'+suffix,None);col.objects.link(o);o.parent=parent;o.location=pos;o['nodeId']=name+'.'+suffix;o['assemblyId']=name;return o
    def put(o,parent):o.parent=parent;o['assemblyId']=name;return o
    def drum(s,pos,r,h,p,m=gray,n=24,r2=None):return put(cyl(name+'.'+s,pos,r,h,m,col,vertices=n,r2=r2),p)
    def block(s,pos,size,p,m=gray):return put(box(name+'.'+s,pos,size,m,col,bev=.012),p)
    def bar(s,a,b,r,p,m=edge,n=12,r2=None):return put(rod(name+'.'+s,a,b,r,m,col,vertices=n,r2=r2),p)
    def ring(s,center,r,p,axis='y',m=bronze):
        x,y,z=center
        def pt(t):return (x,y+r*math.cos(t),z+r*math.sin(t)) if axis=='x' else (x+r*math.cos(t),y,z+r*math.sin(t))
        for j in range(24):bar(s,pt(j*math.tau/24),pt((j+1)*math.tau/24),.008,p,m,6)
        for j in range(4):bar(s+'-spoke',center,pt(j*math.pi/2),.005,p,m,6)
    x,z,y=mount['position'];base=empty('base',pos=(-y,-x,z));yaw=empty('yaw',base)
    yaw.rotation_euler.z=-math.radians(mount['bearingDeg'])
    radius=sp['barbetteRadius'];H=sp['pivotHeight'];T=sp['trunnionForward']
    drum('octagonal-foot',(0,0,.035),radius,.07,base,n=8)
    for i in range(8):
        a=i*math.tau/8;drum('hold-down-bolt',(radius*.83*math.cos(a),radius*.83*math.sin(a),.082),.020,.027,base,m=edge,n=6)
    drum('conical-pedestal',(0,0,.21 if twin else .5),radius*.72,.30 if twin else .88,yaw,n=24,r2=.085)
    if twin:
        for sign in [-1,1]:
            # Open raked cheek plates meet the pedestal saddle and gun bearings.
            points=[(.11,.31),(-.17,.31),(T-.18,H-.15),(T-.11,H+.04),(T+.12,H-.04)]
            vs=[(xx,sign*.22+dy,zz) for dy in [-.028,.028] for xx,zz in points];n=len(points)
            put(mesh(name+'.fork-cheek',vs,[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],gray,col),yaw)
            bar('trunnion-cap',(T,sign*.17,H),(T,sign*.28,H),.065,yaw)
            bar('seat-arm',(0,sign*.15,.30),(-.47,sign*.31,.31),.025,yaw,gray)
            bar('seat-support',(-.47,sign*.31,.31),(-.47,sign*.31,.45),.032,yaw)
            block('seat',(-.47,sign*.31,.46),(.23,.22,.035),yaw,wood)
            block('seat-back',(-.58,sign*.31,.58),(.02,.23,.22),yaw)
            bar('seat-back-support',(-.55,sign*.31,.44),(-.58,sign*.31,.64),.015,yaw)
            bar('control-spindle',(-.18,sign*.19,.53),(-.18,sign*.35,.53),.023,yaw)
            ring('training-handwheel',(-.18,sign*.36,.53),.12,yaw)
            block('foot-pedal',(.22,sign*.26,.24),(.14,.10,.025),yaw)
            bar('pedal-arm',(0,0,.27),(.22,sign*.26,.23),.017,yaw)
    else:
        block('saddle',(0,0,.98),(.18,.22,.09),yaw)
        for sign in [-1,1]:
            bar('raked-fork',(.05,sign*.09,.98),(T,sign*.10,H),.035,yaw,gray)
            bar('bearing',(T,sign*.055,H),(T,sign*.13,H),.057,yaw)
    for side,lateral,vertical in barrel_layout(sp):
        elev=empty(side+'.elevation',yaw,(T,lateral,H));elev.rotation_euler.y=-math.radians(1)
        recoil=empty(side+'.recoil',elev);length=sp['muzzleForward']-T
        empty(side+'.muzzle',recoil,(length,0,0))
        block('receiver',(-.27,0,0),(.53,.105,.13),recoil,edge)
        block('breech-cap',(-.53,0,.01),(.06,.12,.15),recoil)
        block('cradle',(-.20,0,-.08),(.55,.14,.075),elev)
        bar('gas-cylinder',(-.30,0,-.085),(.37,0,-.085),.020,elev,gray)
        bar('barrel',(-.02,0,0),(length-.075,0,0),.023,recoil,edge,20,r2=.014)
        for i in range(30):
            a=.08+i*.020
            if a<length-.15:bar('cooling-fin',(a,0,0),(a+.009,0,0),.029,recoil,gray,16)
        bar('muzzle-sleeve',(length-.08,0,0),(length,0,0),.018,recoil,edge,20,r2=.021)
        bar('bore',(length-.001,0,0),(length+.003,0,0),.0066,recoil,dark,16)
        block('magazine-socket',(-.20,0,.095),(.18,.13,.07),recoil)
        block('box-magazine',(-.22,0,.27),(.21,.09,.30),recoil,gray)
        for sign in [-1,1]:
            for x in [-.3,-.14]:bar('magazine-rib',(x,sign*.051,.15),(x,sign*.051,.41),.006,recoil,edge,6)
            for z in [.22,.34]:bar('inspection-aperture',(-.22,sign*.049,z),(-.22,sign*.057,z),.026,recoil,bronze,16)
        bar('charging-handle',(-.36,.054,.02),(-.42,.12,.025),.010,recoil)
        if not twin:
            for sign in [-1,1]:
                bar('shoulder-rest',(-.45,sign*.035,-.055),(-.60,sign*.18,-.08),.016,elev)
                bar('shoulder-pad',(-.60,sign*.18,-.08),(-.63,sign*.18,.06),.023,elev,wood)
        if side==('left' if twin else 'center'):
            bar('sight-support',(-.10,0,-.02),(-.10,.12,.26),.011,elev)
            bar('sight-rail',(-.37,.12,.26),(.18,.12,.26),.009,elev)
            ring('ring-sight',(.18,.12,.26),.075,elev,axis='x',m=edge)
    return yaw

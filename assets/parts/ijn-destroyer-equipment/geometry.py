"""Reusable original Japanese destroyer torpedo banks, adapted from the original Fubuki
(fittings.py) and Yukikaze (torpedo-assemblies.py) ship recipes.

No published or reference model is an input. The tube datums are the catalog's
tubeOffsets; the shield sections follow the owning ship recipe for that tube count.
Package masses are provisional gameplay estimates.
"""
import sys, math
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model

# (x, half width, bottom, top) stations of the enclosed working shield; +X is the discharge end.
SHIELDS={
    3:dict(sections=[(-3.15,1.55,.75,1.82),(-2.05,2.25,.45,2.25),(1.28,2.31,.45,2.25),(1.75,2.13,.50,2.13)],shoulder=1.25,inset=(.20,.38),race=1.25,table=1.40,tube=(-3.55,1.9),trough=1.84,bands=[2,2.65,3.3,3.95],door=-.6,hatches=[-1.7,.65]),
    4:dict(sections=[(-2.78,1.50,.92,1.78),(-1.38,2.05,.48,2.30),(1.96,2.18,.48,2.30),(2.35,1.98,.48,2.26)],shoulder=1.20,inset=(.17,.33),race=1.42,table=1.52,tube=(-3.47,2.39),trough=2.34,bands=[2.42,3.08,3.65,4.23,4.82],door=.12,hatches=[-1.12,-.30,.9]),
}

def create_shielded_bank(part,col,helpers,materials):
    m=Model(col,helpers,materials);offsets=part['tubeOffsets'];s=SHIELDS[len(offsets)]
    m.cyl('fixed-seat',(0,0,.06),s['race']-.05,.12,mat='edge',vertices=48)
    yaw=m.empty('yaw',(0,0,0),m.root)
    m.cyl('roller-race',(0,0,.19),s['race'],.24,mat='edge',vertices=48,parent=yaw)
    m.cyl('turntable',(0,0,.35),s['table'],.13,vertices=48,parent=yaw)
    a,b=s['inset'];vs=[]
    for xx,w,bottom,top in s['sections']:
        vs += [(xx,-w,bottom),(xx,w,bottom),(xx,w,s['shoulder']),(xx,w-a,top-.12),(xx,w-b,top),(xx,-w+b,top),(xx,-w+a,top-.12),(xx,-w,s['shoulder'])]
    fs=[tuple(reversed(range(8))),tuple(range(24,32))]+[(k*8+j,k*8+(j+1)%8,(k+1)*8+(j+1)%8,(k+1)*8+j) for k in range(3) for j in range(8)]
    shield=m.mesh('working-shield',vs,fs,parent=yaw)
    def width_at(xx):
        for p,q in zip(s['sections'],s['sections'][1:]):
            if p[0]<=xx<=q[0]:return p[1]+(q[1]-p[1])*(xx-p[0])/(q[0]-p[0])
        return s['sections'][-1][1]
    start,stop=s['tube'];N=24
    for i,offset in enumerate(offsets):
        end,yy,zz=-offset[2],-offset[0],offset[1]
        # The bore runs through the enclosure; the discharge end remains a real open trough.
        cutter=m.rod('bore-cutter',(start-.3,yy,zz),(stop+.4,yy,zz),.305,mat='dark',vertices=24,parent=yaw)
        cut=shield.modifiers.new('Tube bore','BOOLEAN');cut.operation='DIFFERENCE';cut.object=cutter
        bpy.context.view_layer.objects.active=shield;bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
        v=[]
        for xx in [start,stop]:
            for r in [.337,.305]:v += [(xx,yy+r*math.cos(j*math.tau/N),zz+r*math.sin(j*math.tau/N)) for j in range(N)]
        f=[]
        for j in range(N):
            k=(j+1)%N;f += [(j,k,2*N+k,2*N+j),(N+j,3*N+j,3*N+k,N+k)]
            for off in [0,2*N]:f.append((off+j,off+N+j,off+N+k,off+k))
        m.mesh('tube',v,f,smooth=True,parent=yaw)
        v=[]
        for xx in [s['trough'],end]:
            for r in [.337,.305]:v += [(xx,yy+r*math.cos(j*math.pi/N),zz-r*math.sin(j*math.pi/N)) for j in range(N+1)]
        stride=2*(N+1);f=[]
        for j in range(N):
            f += [(j,j+1,stride+j+1,stride+j),(N+1+j,stride+N+1+j,stride+N+2+j,N+2+j)]
            for off in [0,stride]:f.append((off+j,off+N+1+j,off+N+2+j,off+j+1))
        for j in [0,N]:f.append((j,stride+j,stride+N+1+j,N+1+j))
        m.mesh('discharge-trough',v,f,smooth=True,parent=yaw)
        for xx in s['bands']+[end-.03]:m.path('tube-band',[(xx,yy+.35*math.cos(j*math.pi/12),zz-.35*math.sin(j*math.pi/12)) for j in range(13)],.022,mat='edge',parent=yaw)
        for sign in [-1,1]:m.rod('trough-edge',(s['trough'],yy+sign*.32,zz),(end,yy+sign*.32,zz),.022,mat='edge',parent=yaw)
        m.rod('breech-collar',(start-.08,yy,zz),(start+.05,yy,zz),.365,mat='edge',vertices=24,parent=yaw)
        m.rod('breech-cover',(start-.15,yy,zz),(start-.08,yy,zz),.33,vertices=24,parent=yaw)
        for j in range(8):
            t=j*math.tau/8;m.box('breech-dog',(start-.165,yy+.28*math.cos(t),zz+.28*math.sin(t)),(.045,.06,.06),mat='edge',parent=yaw)
        m.rod('air-flask',(start+.3,yy+.22,zz-.24),(start+1.95,yy+.22,zz-.24),.075,vertices=16,parent=yaw)
        m.empty('tube-'+str(i+1)+'.muzzle',(end,yy,zz),yaw)
    front=s['sections'][-1]
    if len(offsets)==4:
        m.box('sighting-hood',(front[0]+.01,0,1.82),(.18,.94,.64),parent=yaw)
        m.box('sighting-slit',(front[0]+.11,0,1.96),(.012,.68,.11),mat='dark',parent=yaw)
    for sign in [-1,1]:
        for xx in [-1,1]:m.rod('floor-beam',(xx,0,.39),(xx,sign*(width_at(xx)-.1),.50),.07,mat='edge',parent=yaw)
        w=width_at(s['door'])
        m.box('access-door',(s['door'],sign*(w+.012),1.18),(.62,.035,1.02),mat='edge',parent=yaw)
        for zz in [.90,1.46]:m.rod('door-dog',(s['door']-.27,sign*(w+.05),zz),(s['door']-.10,sign*(w+.05),zz),.02,mat='edge',parent=yaw)
        for xx in s['hatches']:m.cyl('roof-hatch',(xx,sign*1.3,max(p[3] for p in s['sections'])+.015),.19,.045,mat='edge',vertices=24,parent=yaw)
        stepx=s['door']+1.4 if len(offsets)==3 else s['door']-.55
        for zz in [.65,.95,1.25,1.55,1.85]:
            sw=width_at(stepx)-max(0,zz-s['shoulder'])*.2
            m.path('step',[(stepx-.15,sign*sw,zz),(stepx-.15,sign*(sw+.12),zz),(stepx+.15,sign*(sw+.12),zz),(stepx+.15,sign*sw,zz)],.018,mat='edge',parent=yaw)
        rail=[(xx,sign*(w-b-.05),top) for xx,w,bottom,top in s['sections']]
        m.path('roof-rail',[(x,y,z+.17) for x,y,z in rail],.018,mat='edge',parent=yaw)
        for x,y,z in rail:m.rod('rail-foot',(x,y,z-.015),(x,y,z+.17),.019,parent=yaw)
    return m.root

"""Bismarck, May 1941 — measured exterior study. Run with Blender --background --python.

Metres, bow +X, port +Y, design waterline Z=0. See README.md for sources and limits.
"""
import bpy
import math
import json
import os
from mathutils import Vector, Matrix
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent
OUT = Path(os.environ.get('SHIP_OUTPUT', str(SOURCE_DIR / 'generated')))
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'renders').mkdir(exist_ok=True)
DEFINITION = json.loads(Path(os.environ.get('SHIP_DEFINITION', str(SOURCE_DIR.parents[2] / 'public/models/bismarck.json'))).read_text())
HULL_SPEC = DEFINITION['hull']
bpy.context.preferences.filepaths.save_version = 0
PI = math.pi
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name != 'Collection': bpy.data.collections.remove(c)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
scene.unit_settings.length_unit = 'METERS'
root = bpy.data.collections.get('Collection')
root.name = 'BISMARCK • May 1941 • 1 Blender unit = 1 m'
collections = {}
def group(name):
    c = bpy.data.collections.new(name)
    root.children.link(c)
    collections[name] = c
    return c
HULL=group('01 Hull • 250.50 × 36.00 m')
DECK=group('02 Upper deck • teak and fittings')
MAIN=group('03 Main battery • 4 × twin 38 cm')
SECOND=group('04 Secondary battery • 6 × twin 15 cm')
AA=group('05 Anti-aircraft batteries')
SUPER=group('06 Bridge and superstructure')
FUNNEL=group('07 Funnel and ventilation')
BOATS=group('08 Hangars • boats • cranes • catapult')
MASTS=group('09 Masts • radar • rigging')
DETAIL=group('10 Railings • ladders • deck hardware')
UNDER=group('11 Shafts • 3 screws • 2 rudders')
GUIDES=group('12 Measurement datums • hidden')
STUDIO=group('13 Studio • cameras and lighting')

def mat(name, color, metallic=0.0, rough=.5):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*color,1)
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metallic
    p.inputs['Roughness'].default_value=rough
    return m
naval=mat('Hellgrau • superstructure gray',(.48,.515,.53),.12,.48)
hullgray=mat('Dunkelgrau • hull gray',(.31,.355,.38),.17,.48)
roof=mat('Horizontal steel • dark gray',(.19,.225,.25),.18,.52)
edge=mat('Painted edges and fittings',(.39,.435,.46),.2,.4)
red=mat('Underwater • muted red oxide',(.27,.063,.042),.1,.62)
boot=mat('Boot topping • charcoal',(.042,.052,.057),.1,.6)
dark=mat('Openings and recesses',(.018,.027,.032),.05,.5)
glass=mat('Bridge glazing • smoke blue',(.045,.088,.105),.42,.23)
brass=mat('Propellers • manganese bronze',(.42,.275,.10),.72,.34)
canvas=mat('Blast bags • weathered canvas',(.36,.365,.34),0,.86)
wood=mat('Boat wood',(.29,.15,.065),0,.63)
wiremat=mat('Standing rigging',(.08,.10,.11),.32,.6)
teak=mat('Teak decking • scaled planks 5 m × 0.16 m',(.49,.35,.19),0,.68)
n=teak.node_tree.nodes; l=teak.node_tree.links
geo=n.new('ShaderNodeNewGeometry')
mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(.2,6.25,1)
l.new(geo.outputs['Position'],mapping.inputs[0])
brick=n.new('ShaderNodeTexBrick');brick.inputs['Scale'].default_value=1
brick.inputs['Brick Width'].default_value=1
brick.inputs['Row Height'].default_value=1
brick.inputs['Mortar Size'].default_value=.015
brick.inputs['Mortar Smooth'].default_value=.01
brick.inputs['Color1'].default_value=(.46,.32,.165,1)
brick.inputs['Color2'].default_value=(.59,.435,.255,1)
brick.inputs['Mortar'].default_value=(.19,.155,.105,1)
l.new(mapping.outputs['Vector'],brick.inputs['Vector'])
l.new(brick.outputs['Color'],n.get('Principled BSDF').inputs['Base Color'])
bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.13;bump.inputs['Distance'].default_value=.016
l.new(brick.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])

def assign(obj,name,material,col):
    obj.name=name
    for c in list(obj.users_collection):c.objects.unlink(obj)
    col.objects.link(obj)
    if material:obj.data.materials.append(material)
    return obj
def mesh(name,verts,faces,material,col,smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);col.objects.link(ob)
    if material:me.materials.append(material)
    if smooth:
        for p in me.polygons:p.use_smooth=True
    return ob
def bevel(ob,amount=.08,segments=2):
    mod=ob.modifiers.new('Small manufactured edge', 'BEVEL');mod.width=amount;mod.segments=segments
    return ob
def box(name,loc,dim,material=naval,col=SUPER,bev=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    ob=assign(bpy.context.object,name,material,col)
    ob.scale=dim
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bev:bevel(ob,bev)
    return ob
def cyl(name,loc,radius,depth,material=naval,col=SUPER,vertices=32,r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if r2 is None else r2,depth=depth,location=loc)
    ob=assign(bpy.context.object,name,material,col)
    for p in ob.data.polygons:p.use_smooth=len(p.vertices)==4
    return ob
def rod(name,a,b,r,material=edge,col=DETAIL,r2=None,vertices=12):
    a,b=Vector(a),Vector(b);v=b-a
    ob=cyl(name,(a+b)/2,r,v.length,material,col,vertices,r2)
    ob.rotation_euler=v.to_track_quat('Z','Y').to_euler()
    return ob
def curve(name,points,r=.035,material=edge,col=DETAIL,closed=False):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=1
    cu.bevel_depth=r;cu.bevel_resolution=1;cu.resolution_u=1
    s=cu.splines.new('POLY');s.points.add(len(points)-1)
    for p,v in zip(s.points,points):p.co=(*v,1)
    s.use_cyclic_u=closed
    ob=bpy.data.objects.new(name,cu);col.objects.link(ob);cu.materials.append(material)
    return ob
def prism(name,outline,z0,z1,material=naval,col=SUPER,inset=0):
    cx=sum(p[0] for p in outline)/len(outline);cy=sum(p[1] for p in outline)/len(outline)
    v=[(x,y,z0) for x,y in outline]+[(cx+(x-cx)*(1-inset),cy+(y-cy)*(1-inset),z1) for x,y in outline]
    n=len(outline);f=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    f += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,v,f,material,col)
def chamfer_outline(x,y,L,W,c=.6):
    return [(x-L/2+c,y-W/2),(x+L/2-c,y-W/2),(x+L/2,y-W/2+c),(x+L/2,y+W/2-c),(x+L/2-c,y+W/2),(x-L/2+c,y+W/2),(x-L/2,y+W/2-c),(x-L/2,y-W/2+c)]
def structure(name,x,y,L,W,z0,z1,c=.6,top=True,material=naval):
    outline=chamfer_outline(x,y,L,W,c)
    ob=prism(name,outline,z0,z1,material,SUPER)
    if top:prism(name+' • deck',outline,z1,z1+.12,roof,SUPER)
    return ob
def rail(name,pts,closed=True,spacing=2.3,h=1.05):
    for zh in (.36,.71,h):curve(name+' • wire',[(x,y,z+zh) for x,y,z in pts],.021,edge,DETAIL,closed)
    edges=list(zip(pts,pts[1:]+pts[:1])) if closed else list(zip(pts,pts[1:]))
    for a,b in edges:
        a,b=Vector(a),Vector(b);num=max(1,math.ceil((b-a).length/spacing))
        for i in range(num):
            p=a.lerp(b,i/num);rod(name+' • stanchion',p,p+Vector((0,0,h)),.031,edge,DETAIL,vertices=6)
def platform(name,x,y,L,W,z,c=.6,railing=True):
    pts=chamfer_outline(x,y,L,W,c)
    prism(name,pts,z-.16,z,roof,SUPER)
    if railing:rail(name,[(a,b,z) for a,b in pts])
    return pts

# Station dimensions are an interpolated reading of the cited top/profile drawings.
# The overall envelope and the four main turret longitudinal stations are fixed dimensions.
LOA=HULL_SPEC['length']; BEAM=HULL_SPEC['beam']; DRAFT=HULL_SPEC['draft']; DEPTH=HULL_SPEC['depth']
ST=HULL_SPEC['halfBreadths']
def interp(table,t):
    if t<=table[0][0]:return table[0][1]
    if t>=table[-1][0]:return table[-1][1]
    for i in range(len(table)-1):
        x0,y0=table[i];x1,y1=table[i+1]
        if x0<=t<=x1:
            d=(y1-y0)/(x1-x0)
            def slope(j):
                if j==0:return (table[1][1]-table[0][1])/(table[1][0]-table[0][0])
                if j==len(table)-1:return (table[-1][1]-table[-2][1])/(table[-1][0]-table[-2][0])
                da=(table[j][1]-table[j-1][1])/(table[j][0]-table[j-1][0]);db=(table[j+1][1]-table[j][1])/(table[j+1][0]-table[j][0])
                return 0 if da*db<=0 else 2*da*db/(da+db)
            u=(t-x0)/(x1-x0);h=x1-x0
            return (2*u**3-3*u*u+1)*y0+(u**3-2*u*u+u)*h*slope(i)+(-2*u**3+3*u*u)*y1+(u**3-u*u)*h*slope(i+1)
def width(x):return interp(ST,x+LOA/2)
def deckz(x):return interp(HULL_SPEC['deckHeights'],x+LOA/2)
def bottom(s):return interp(HULL_SPEC['keelHeights'],s)
N=360
xs=[-LOA/2+LOA*i/N for i in range(N+1)]
# Cross sections: broad, nearly flat bottom amidships, rounded bilge, fine ends, flared bow.
verts=[];faces=[];bands=[]
for x in xs:
    s=x+LOA/2;w=width(x);top=deckz(x);bot=bottom(s)
    fullness=interp([(0,.12),(20,.27),(45,.73),(70,1),(185,1),(215,.52),(240,.06),(250.5,0)],s)
    side=[(1,top),(.998,top-1.0),(.993,1.15),(.986,-1.15),(.983,-3.0),(.96,-5.0),(.88,-7.4),(.70,-8.85),(.38,-9.33),(0,-9.33)]
    ring=[]
    for fy,z in side:
        z=max(bot,z)
        if z<0:fy *= fullness+(1-fullness)*max(0,(z-bot)/max(.001,-bot))**.7
        ring.append((x,w*fy,z))
    ring+= [(a,-b,c) for a,b,c in reversed(ring[:-1])]
    verts+=ring
K=19
for i in range(N):
    for j in range(K-1):
        faces.append((i*K+j,(i+1)*K+j,(i+1)*K+j+1,i*K+j+1));bands.append(j)
    faces.append((i*K+K-1,(i+1)*K+K-1,(i+1)*K,i*K));bands.append(K-1)
faces.extend([tuple(reversed(range(K))),tuple(N*K+j for j in range(K))]);bands += [0,0]
hull=mesh('Hull • measured envelope • Atlantic bow',verts,faces,None,HULL,True)
for m in (hullgray,boot,red):hull.data.materials.append(m)
for p in hull.data.polygons:
    z=sum(hull.data.vertices[i].co.z for i in p.vertices)/len(p.vertices)
    p.material_index=2 if z<-1.15 else 1 if z<1.15 else 0
hull['nodeId']='hull.surface'
hull['length_overall_m']=LOA;hull['beam_m']=BEAM;hull['design_draught_m']=DRAFT
hull['accuracy']='Envelope fixed; hull stations interpreted from published orthographic views, not certified yard offsets.'
# Thin cambered teak upper deck.
v=[];f=[]
ny=20
for x in xs:
    for j in range(ny+1):
        t=-1+2*j/ny;v.append((x,width(x)*t,deckz(x)+.12*(1-t*t)+.045))
for i in range(N):
    for j in range(ny):
        k=i*(ny+1)+j;f.append((k,k+ny+1,k+ny+2,k+1))
deck=mesh('Upper deck • sheer and camber',v,f,teak,DECK,True)
for side in (-1,1):
    sheer=[(x,side*width(x),deckz(x)+.045) for x in xs]
    curve('Deck edge • steel margin',sheer,.13,edge,HULL)
    # Railings follow the deck sheer; gun working areas remain clear.
    sample=[-123+i*2.4 for i in range(103)]
    rail('Upper deck rail',[(x,side*max(0,width(x)-.22),deckz(x)+.075) for x in sample],False)
    # Main belt strip: narrow representation of exterior armor strake, no fictitious bulges.
    curve('Upper armor strake seam',[(x,side*(width(x)*.996+.012),3.45) for x in xs if -87<x<86],.055,edge,HULL)

# Barbette and angular turret meshes. Local +X points along the guns.
import sys
sys.path.insert(0,str(SOURCE_DIR.parents[2]/'scripts/ships'))
from blender_components import create_gun_mount
main_specs=[]
for mount in DEFINITION['mounts']:
    rx,rz,ry=mount['position']
    x=-ry;y=-rx;z=rz;angle=-math.radians(mount['bearingDeg'])
    ob=create_gun_mount(mount,MAIN if mount['battery']=='main' else SECOND,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),dict(naval=naval,roof=roof,edge=edge,hullgray=hullgray,canvas=canvas,dark=dark),deckz)
    if mount['battery']=='main':main_specs.append((mount['name'],x+122.5,z,angle))

# Forward superstructure: narrow tiered base, broad bridge wings and tower.
forebase=[(7,-7.9),(31,-8.2),(39,-5.8),(43,-3.9),(43,3.9),(39,5.8),(31,8.2),(7,7.9)]
prism('Forward deckhouse • first tier',forebase,5.76,8.42,naval,SUPER)
prism('Forward deckhouse • teak roof',forebase,8.42,8.55,teak,SUPER)
structure('Forward battery deckhouse',35,0,18,9.4,8.55,11.3,1.4)
structure('Bridge lower block',23.5,0,21,12.3,8.55,12.8,1.7)
platform('Admirals bridge wings',19,0,17,17.2,12.95,1.7)
structure('Bridge accommodation',20.5,0,12.5,10.6,12.95,16.25,1.2)
cyl('Armored forward conning tower',(16.2,0,15.0),2.7,5.0,hullgray,SUPER,48)
platform('Open navigating bridge',16.2,0,13.3,12.5,16.45,1.2)
structure('Navigation bridge • enclosed',16.1,0,8.7,8.8,16.45,20.25,.9)
platform('Bridge wings • lookout level',16.4,0,12.7,17.0,20.45,1.3)
structure('Tower lower trunk',14.3,0,7.8,7.2,20.45,24.25,.9)
structure('Tower upper trunk',13.2,0,6.8,6.0,24.25,27.7,.8)
platform('Foretop observation platform',13.6,0,10.3,12.0,28.0,.8)
structure('Foretop fire control enclosure',13.1,0,6.6,5.9,28.0,30.0,.8)
platform('Foretop roof',13.1,0,8.3,8.6,30.15,.75)

def windows(name,xs,y,z,w=.68,h=.62):
    for x in xs:box(name,(x,y,z),(w,.045,h),glass,SUPER,.03)
for side in (-1,1):
    windows('Navigation glazing',[12.8,13.75,14.7,15.65,16.6,17.55,18.5],side*4.405,19.4,.65,.78)
    windows('Upper bridge glazing',[11.6,12.6,13.6,14.6,15.6,16.6],side*3.605,23.55,.64,.62)
    for y in [-3,-2,-1,0,1,2,3]:box('Forward bridge window',(20.46,y,19.4),(.05,.67,.77),glass,SUPER)
    # Narrow slits of the armoured conning position.
    windows('Conning vision slit',[14.6,15.6,16.6,17.6],side*2.64,16.9,.56,.12)

def radar(name,x,y,z,facing=0,base=10.5):
    cyl(name+' • director pedestal',(x,y,z+.5),1.4,1.0,naval,MASTS,32)
    cyl(name+' • rotating cupola',(x,y,z+1.7),2.0,1.5,naval,MASTS,40)
    rod(name+' • optical base',(x,y-base/2,z+1.6),(x,y+base/2,z+1.6),.27,naval,MASTS,vertices=20)
    for s in (-1,1):box(name+' • optical end',(x,y+s*base/2,z+1.6),(.72,.60,.57),edge,MASTS)
    # FuMO 23 rectangular 4 x 2 m open lattice aerial, facing bow/aft.
    rx=x+math.cos(facing)*2.04
    for yy in (-2,2):rod(name+' • aerial frame',(rx,y+yy,z+1.05),(rx,y+yy,z+3.05),.046,wiremat,MASTS)
    for zz in (1.05,3.05):rod(name+' • aerial frame',(rx,y-2,z+zz),(rx,y+2,z+zz),.046,wiremat,MASTS)
    for j in range(1,8):rod(name+' • mesh vertical',(rx,y-2+j*.5,z+1.05),(rx,y-2+j*.5,z+3.05),.020,wiremat,MASTS,vertices=6)
    for j in range(1,4):rod(name+' • mesh horizontal',(rx,y-2,z+1.05+j*.5),(rx,y+2,z+1.05+j*.5),.020,wiremat,MASTS,vertices=6)
radar('Foretop • FuMO 23',13.1,0,30.2)
radar('Forward command post • FuMO 23',25.6,0,16.4,base=7.0)

# Aft superstructure with an open boat deck and lower mainmast.
aftbase=[(-64,-3.2),(-61,-5.3),(-49,-9),(-32,-10.1),(-15,-9),(-14,-6),(-14,6),(-15,9),(-32,10.1),(-49,9),(-61,5.3),(-64,3.2)]
prism('After deckhouse',aftbase,5.77,8.33,naval,SUPER)
prism('After deckhouse • teak roof',aftbase,8.33,8.47,teak,SUPER)
structure('After command block',-40.5,0,14.2,10.5,8.47,11.45,1.5)
platform('After command platform',-38.5,0,13.1,14.0,11.6,1.3)
structure('After fire control pedestal',-37.7,0,7.1,6.0,11.6,14.75,.8)
radar('Aft command post • FuMO 23',-37.7,0,14.9,PI)
structure('Mainmast lower house',-20.5,0,12,8.6,8.47,13.0,.8)
platform('After boat platform',-22,0,16.5,10.7,13.15,.8)

# One large oval funnel. Four side vents, grille cap and thin external steam pipes.
def ellipse_ring(cx,cy,rx,ry,z,n=64):return [(cx+rx*math.cos(2*PI*i/n),cy+ry*math.sin(2*PI*i/n),z) for i in range(n)]
def oval(name,cx,cy,rx,ry,z0,z1,material,col):
    return prism(name,[(a,b) for a,b,c in ellipse_ring(cx,cy,rx,ry,0)],z0,z1,material,col)
structure('Funnel uptake deckhouse',-1.7,0,13.0,11.6,5.76,11.0,1.0)
oval('Funnel • oval casing',-1.7,0,5.5,3.25,10.8,22.95,naval,FUNNEL)
oval('Funnel • upper cap',-1.7,0,5.7,3.42,22.9,24.25,edge,FUNNEL)
oval('Funnel • soot-black opening',-1.7,0,5.08,2.82,24.25,24.34,dark,FUNNEL)
curve('Funnel rim',ellipse_ring(-1.7,0,5.54,3.31,24.39),.12,edge,FUNNEL,True)
for xx in [-5.4,-3.6,-1.8,0,1.8]:
    half=2.65*math.sqrt(max(.01,1-((xx+1.7)/5.1)**2))
    rod('Funnel cap grille',(xx,-half,24.45),(xx,half,24.45),.085,wiremat,FUNNEL)
for side in (-1,1):
    rod('Steam pipe',(-6.8,side*2.6,9),(-6.8,side*2.6,23.6),.17,edge,FUNNEL,vertices=16)
    platform('Funnel searchlight gallery',-1.7,side*3.8,11.5,3.0,16.65,.5)
    box('Funnel side intake',(-1.7,side*3.33,19.8),(6,.24,2.5),edge,FUNNEL)
    for i in range(9):box('Funnel louver',(-1.7,side*3.49,18.72+i*.26),(5.6,.08,.07),dark,FUNNEL,0)

# Aircraft hangars: paired forward small hangars and large hangar aft of catapult.
def hangar(name,x,y,L,W,z,H):
    box(name+' • walls',(x,y,z+H/2),(L,W,H),naval,BOATS)
    # Curved barrel roof running longitudinally.
    vs=[];fs=[];steps=16
    for xx in (x-L/2,x+L/2):
        for j in range(steps+1):
            t=PI*j/steps;vs.append((xx,y+W/2*math.cos(t),z+H+.8*math.sin(t)))
    for j in range(steps):fs.append((j,j+1,j+steps+2,j+steps+1))
    mesh(name+' • cambered roof',vs,fs,roof,BOATS,True)
    # Shutter faces visible toward catapult.
    xx=x-L/2-.035 if x>0 else x+L/2+.035
    box(name+' • shutter',(xx,y,z+H*.46),(.06,W*.86,H*.89),edge,BOATS,0)
    for j in range(1,10):box(name+' • shutter seam',(xx+(.04 if x<0 else -.04),y,z+j*H*.085),(.025,W*.84,.038),dark,BOATS,0)
for s in (-1,1):hangar('Forward aircraft hangar',2.5,s*6.65,11,4.5,8.6,4.65)
hangar('After aircraft hangar',-19.2,0,12.0,9.0,5.85,5.5)
# Transverse fixed catapult centered around station 116: distinct from Tirpitz's arrangement.
catx=-10.25
for x in (catx-.55,catx+.55):
    rod('Catapult • transverse rail',(x,-17.4,7.72),(x,17.4,7.72),.10,edge,BOATS)
    rod('Catapult • lower chord',(x,-17.4,6.48),(x,17.4,6.48),.08,edge,BOATS)
for y in range(-17,18,2):
    for x in (catx-.55,catx+.55):rod('Catapult • lattice',(x,y,6.5),(x,y+1.7,7.72),.06,edge,BOATS)
    rod('Catapult • cross member',(catx-.65,y,7.72),(catx+.65,y,7.72),.07,edge,BOATS)
box('Catapult • launch carriage',(catx,-2.2,8.06),(2.2,2.7,.43),edge,BOATS)

def boat(name,x,y,z,L,W):
    # Pointed bow, rounded stern, concave interior, timber gunwale.
    profile=[(-.48,0),(-.43,-.36),(-.22,-.49),(.23,-.47),(.43,-.28),(.52,0),(.43,.28),(.23,.47),(-.22,.49),(-.43,.36)]
    outline=[(x+a*L,y+b*W) for a,b in profile]
    n=len(outline);vs=[(x+(a-x)*.68,y+(b-y)*.68,z) for a,b in outline]+[(a,b,z+1.0) for a,b in outline]
    fs=[tuple(reversed(range(n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh(name+' • hull',vs,fs,naval,BOATS)
    prism(name+' • interior',[(x+(a-x)*.9,y+(b-y)*.86) for a,b in outline],z+.55,z+.60,wood,BOATS)
    curve(name+' • gunwale',[(a,b,z+1.03) for a,b in outline],.07,wood,BOATS,True)
    for xx in (-.29,-.12,.08,.27):box(name+' • bench',(x+xx*L,y,z+.86),(.3,W*.72,.14),wood,BOATS)
    if L>10.7:
        box(name+' • motor cabin',(x-.2,y,z+1.26),(L*.36,W*.63,1.2),naval,BOATS)
        box(name+' • cabin roof',(x-.2,y,z+1.91),(L*.39,W*.70,.15),roof,BOATS)
        for s in (-1,1):
            for xx in (-1.1,0,1.1):box(name+' • cabin glazing',(x+xx,y+s*W*.322,z+1.41),(.65,.035,.44),glass,BOATS)
    for xx in (-L*.28,L*.28):box(name+' • cradle',(x+xx,y,z-.17),(.3,W*.90,.55),roof,BOATS)
for side in (-1,1):
    boat('Funnel motor launch',1.1,side*6.6,13.98,12.2,2.8)
    boat('After motor launch',-19.0,side*5.25,13.4,11.5,2.7)
    boat('After cutter',-21.0,side*8.0,10.0,9.5,2.45)
    boat('Nested utility boat',-19.7,side*3.35,14.9,8.0,2.1)

# Two lattice boat cranes alongside the funnel, booms housed forward.
for side in (-1,1):
    x,y=-5.5,side*12.7
    cyl('Boat crane • slewing base',(x,y,7.2),1.05,2.9,edge,BOATS,32)
    cyl('Boat crane • upright',(x,y,10.7),.58,5.2,naval,BOATS,24,r2=.38)
    start=Vector((x,y,11.3));end=Vector((x+14.0,y*.77,20.7))
    for offset in (-.45,.45):rod('Crane boom • chord',start+Vector((0,offset,0)),end+Vector((0,offset,0)),.115,edge,BOATS)
    for i in range(10):
        a=start.lerp(end,i/10);b=start.lerp(end,(i+1)/10)
        rod('Crane boom • diagonal',a+Vector((0,-.45,0)),b+Vector((0,.45,0)),.064,edge,BOATS)
        rod('Crane boom • diagonal',a+Vector((0,.45,0)),b+Vector((0,-.45,0)),.064,edge,BOATS)
    curve('Crane topping lift',[(x-1,y,11.6),(x,y,15.0),tuple(end)],.034,wiremat,BOATS)
    curve('Crane hoist',[tuple(end),(end.x,end.y,end.z-4)],.026,wiremat,BOATS)
    box('Crane hook',(end.x,end.y,end.z-4),(.23,.2,.36),wiremat,BOATS)

# Anti-aircraft mounts. Correct battery counts, simplified mount housings.
def aa_mount(name,x,y,z,bearing,kind='105'):
    r,H=(1.6,1.8) if kind=='105' else (.75,.9)
    col=AA
    cyl(name+' • pedestal',(x,y,z+.4),r*.66,.8,edge,col,24)
    def p(a,b,c):return (x+a*math.cos(bearing)-b*math.sin(bearing),y+a*math.sin(bearing)+b*math.cos(bearing),c)
    if kind=='105':
        outline=[(-1.8,-1.6),(1.2,-1.6),(1.65,-1.0),(1.65,1.0),(1.2,1.6),(-1.8,1.6)]
        ob=prism(name+' • shield',outline,z+.55,z+2.12,naval,col,.12);ob.location=(x,y,0);ob.rotation_euler.z=bearing
    else:
        box(name+' • gun cradle',(x,y,z+.95),(1.1,.8,.4),edge,col)
    length=5.2 if kind=='105' else 2.6
    for s in (-1,1):
        gy=s*(.53 if kind=='105' else .25)
        rod(name+' • barrel',p(.5,gy,z+1.45),p(length,gy,z+1.45+length*.22),.135 if kind=='105' else .052,edge,col,.08 if kind=='105' else .035,12)
    return
for side in (-1,1):
    for i,(x,y,z) in enumerate([(18.3,11.5,8.65),(1.7,10.8,6.0),(-17.0,10.6,8.6),(-32.3,10.0,8.6)]):
        aa_mount(f'10.5 cm {side:+} {i+1}',x,side*y,z,side*PI/2, '105')
    for i,(x,y,z) in enumerate([(42.7,6.0,8.6),(23.0,7.2,13.1),(-37.5,7.0,11.75),(-49.0,8.3,8.6)]):
        aa_mount(f'3.7 cm {side:+} {i+1}',x,side*y,z,side*PI/2,'37')
    # SL-8 antiaircraft directors.
    for x,y,z in [(15.6,7.0,15.0),(-27.0,6.7,13.5)]:
        cyl('SL-8 director • pedestal',(x,side*y,z),.85,1.8,naval,AA)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=(x,side*y,z+1.2))
        ob=assign(bpy.context.object,'SL-8 • spherical director',naval,AA);ob.scale=(1.2,1.2,1.0)
        rod('SL-8 • 4 m optical base',(x,side*y-2,z+1.45),(x,side*y+2,z+1.45),.17,edge,AA)
    for i,(x,y,z) in enumerate([(77,9.5,6.4),(54,8.2,6.2),(15.0,8.0,20.65),(-18.0,5.5,13.3),(-64,7.8,6.1),(-90,7.0,6.1)]):
        cyl('2 cm single • pedestal',(x,side*y,z+.5),.23,1.0,edge,AA,16)
        rod('2 cm single • barrel',(x,side*y,z+1),(x+.9,side*y+side*.9,z+1.55),.034,edge,AA,vertices=8)
    # Two late-April quadruple mounts flanking the foremast.
    qx,qy,qz=8.5,side*5.4,24.6
    platform('Quad Flak platform',qx,qy,3.4,3.3,qz,.35)
    cyl('2 cm Flakvierling • base',(qx,qy,qz+.35),.5,.7,edge,AA)
    box('Flakvierling • shield',(qx,qy+side*.4,qz+1.0),(1.9,.1,1.15),naval,AA)
    for dx in (-.34,.34):
        for zz in (.8,1.25):rod('Flakvierling • barrel',(qx+dx,qy,qz+zz),(qx+dx,qy+side*1.4,qz+zz+.45),.032,edge,AA,vertices=8)

# Masts and standing rigging, measured against the profile silhouette.
rod('Mainmast • lower',(-20,0,12.5),(-20,0,34.2),.40,naval,MASTS,.20,24)
rod('Mainmast • topmast',(-20,0,34.2),(-20,0,48.7),.16,edge,MASTS,.065,16)
rod('Foremast', (7.8,0,20.0),(7.8,0,42.6),.23,naval,MASTS,.065,16)
rod('Aft director mast',(-37.7,0,17.3),(-37.7,0,25.2),.12,edge,MASTS,.035,12)
for x,z,W in [(-20,29.0,17.8),(-20,34.8,11.0),(-20,39.7,6.5),(7.8,28.3,12),(7.8,34.4,8.8)]:
    rod('Signal yardarm',(x,-W/2,z),(x,W/2,z),.115,naval,MASTS,.075,16)
    for side in (-1,1):
        curve('Yard lift',[(x,0,z+3),(x,side*W/2,z)],.023,wiremat,MASTS)
        curve('Signal halyard',[(x,side*W/2,z),(x,side*3.0,15.5)],.017,wiremat,MASTS)
for y in (-2,-.7,.7,2):
    curve('Radio aerial • catenary',[(-20,y,39.7),(-13,y,38.5),(-6,y,37.85),(1,y,37.6),(7.8,y,38.1)],.022,wiremat,MASTS)
for side in (-1,1):
    curve('Mainmast shroud',[(-20,0,34.0),(-31,side*6.5,13.3)],.028,wiremat,MASTS)
    curve('Foremast shroud',[(7.8,0,35),(18,side*6,20.6)],.025,wiremat,MASTS)
    rod('Bridge angled support',(6.8,side*3.2,16.4),(10.2,side*3.0,24.3),.28,naval,SUPER,vertices=16)

# Portholes, watertight doors, vents and ladders enrich close views without changing silhouette.
def port(name,x,y,z,r=.16,col=DETAIL):
    s=1 if y>0 else -1
    rod(name+' • rim',(x,y,z),(x,y+s*.09,z),r*1.2,edge,col,vertices=12)
    rod(name+' • dark glass',(x,y+s*.092,z),(x,y+s*.104,z),r,dark,col,vertices=12)
for side in (-1,1):
    for x in [-117+i*2.6 for i in range(89)]:
        if x<-88 or x>87:port('Hull scuttle',x,side*width(x)*.996,deckz(x)-1.65,.155)
        if -114<x<-95 or 92<x<113:port('Lower hull scuttle',x,side*width(x)*.991,2.3,.145)
    for x in [-58+i*2.2 for i in range(18)]:port('After deckhouse scuttle',x,side*(9.0 if x<-35 else 9.5),7.25,.145)
    for x in [12+i*2.1 for i in range(13)]:port('Forward deckhouse scuttle',x,side*(7.95 if x<32 else 5.0),7.25,.15)
    for x in [15,19,23,27]:port('Bridge scuttle',x,side*6.18,11.25,.16)
    for x,y,z in [(30,6.2,10.3),(-44,5.3,10),(10,8,7.1),(-31,10.1,7.05)]:
        box('Watertight door',(x,side*y,z),(.8,.10,1.7),edge,DETAIL)
        rod('Door dog',(x+.25,side*(y+.09),z-.15),(x+.25,side*(y+.09),z+.15),.035,naval,DETAIL)
    for x,y,z in [(28,6.4,10.1),(4,9,7.5),(-17,8.7,8.5),(-37,5.4,10.2)]:
        box('Ventilator grille',(x,side*y,z),(3.0,.2,1.5),edge,DETAIL)
        for i in range(6):box('Ventilator louver',(x,side*(y+.12),z-.6+i*.23),(2.75,.06,.055),dark,DETAIL,0)
def ladder(name,a,b,width=.65):
    a,b=Vector(a),Vector(b)
    for s in (-1,1):rod(name+' • stringer',a+Vector((0,s*width/2,0)),b+Vector((0,s*width/2,0)),.047,edge,DETAIL)
    for i in range(max(2,int((b-a).length/.30))):
        p=a.lerp(b,i/max(2,int((b-a).length/.30)))
        rod(name+' • tread',p+Vector((0,-width/2,0)),p+Vector((0,width/2,0)),.044,edge,DETAIL,vertices=8)
for s in (-1,1):
    ladder('Forecastle companionway',(62,s*8.1,6.1),(54,s*8.1,9.1),.8)
    ladder('Bridge access',(33,s*6.7,8.6),(29,s*6.7,13.0),.75)
    ladder('Aft companionway',(-63,s*6.3,5.95),(-58,s*6.3,8.5),.7)
    ladder('Tower ladder',(10.5,s*3.7,20.6),(10.5,s*3.7,27.9),.55)
    ladder('Funnel ladder',(-6.75,s*1.25,11.1),(-6.75,s*1.25,24),.55)

# Searchlights.
for x,y,z in [(-3,5.0,17.2),(-3,-5,17.2),(16,6.7,21),(16,-6.7,21),(-22,5.3,14),(-22,-5.3,14)]:
    cyl('Searchlight pedestal',(x,y,z+.3),.24,.6,edge,DETAIL,16)
    rod('Searchlight drum',(x,y,z+.9),(x+1,y,z+.9),.54,naval,DETAIL,vertices=24)
    rod('Searchlight lens',(x+1.005,y,z+.9),(x+1.035,y,z+.9),.46,glass,DETAIL,vertices=24)

# Forecastle anchor gear and deck fittings.
for s in (-1,1):
    for x in (86,91):
        cyl('Anchor capstan',(x,s*2.65,deckz(x)+.53),.74,.85,edge,DECK,24)
        cyl('Capstan head',(x,s*2.65,deckz(x)+1.0),.86,.16,roof,DECK,24)
    path=[(90,s*2.65,deckz(90)+.15),(101,s*2.7,deckz(101)+.15),(112,s*3.2,deckz(112)+.15)]
    curve('Anchor cable • stud-link chain',path,.125,dark,DECK)
    for i in range(37):
        x=90+i*.60;y=s*(2.65+(x-90)/22*.55);z=deckz(x)+.21
        bpy.ops.mesh.primitive_torus_add(major_segments=8,minor_segments=4,location=(x,y,z),major_radius=.20,minor_radius=.055)
        ob=assign(bpy.context.object,'Anchor cable • individual link',edge,DECK);ob.scale=(1.4,.78,1)
        if i%2:ob.rotation_euler.x=PI/2
    x=112;y=s*(width(x)+.04);z=deckz(x)-.70
    port('Anchor hawse',x,y,z,.65,HULL)
    rod('Anchor shank',(x,y,z-.2),(x-1.2,y,z-2.0),.20,edge,HULL)
    rod('Anchor crown',(x-2.3,y,z-1.7),(x-.1,y,z-2.3),.22,edge,HULL)
    for xx in (x-2.25,x-.15):box('Anchor fluke',(xx,y,z-1.6),(.55,.25,.82),edge,HULL)
for x in [-115,-107,-91,-83,81,96,108,118]:
    for s in (-1,1):
        y=s*max(.7,width(x)-1.25);z=deckz(x)
        box('Mooring bollard base',(x,y,z+.16),(1.9,.83,.24),edge,DECK)
        for dx in (-.55,.55):
            cyl('Mooring bollard',(x+dx,y,z+.53),.22,.63,edge,DECK,12)
            cyl('Mooring bollard cap',(x+dx,y,z+.87),.28,.10,edge,DECK,12)
for x in [-107,-97,-87,-68,65,81,102]:
    for s in (-1,1):
        y=s*min(width(x)*.48,7.2);z=deckz(x)
        box('Deck access hatch',(x,y,z+.22),(1.45,1.1,.28),edge,DECK)
        rod('Hatch handle',(x-.25,y,z+.4),(x+.25,y,z+.4),.035,dark,DECK)
for x in [-74,-67,-52,47,57,74]:
    for s in (-1,1):
        y=s*min(10,width(x)-3);z=deckz(x)
        cyl('Mushroom vent',(x,y,z+.35),.22,.7,naval,DECK,16)
        cyl('Mushroom vent cap',(x,y,z+.73),.42,.15,edge,DECK,20)

# Underwater hull appendages: three independent shafts, three 4.7 m screws, twin rudders.
for side in (-1,1):
    curve('Bilge keel',[(x,side*(width(x)*.75),-7.85) for x in range(-38,40,2)],.19,red,UNDER)
def propeller(name,x,y,z):
    rod(name+' • hub',(x-1.0,y,z),(x+.6,y,z),.51,brass,UNDER,.34,32)
    # Three pitched blades, true 4.70 m tip diameter.
    for j in range(3):
        angle=2*PI*j/3
        raw=[(.33,-.23,.13),(.85,-.48,.1),(1.65,-.40,-.06),(2.33,-.02,-.38),(2.26,.39,-.49),(1.60,.64,-.31),(.81,.43,-.07)]
        vs=[]
        for thick in (-.055,.055):
            for r,t,ax in raw:
                vs.append((x+ax+thick,y+r*math.cos(angle)-t*math.sin(angle),z+r*math.sin(angle)+t*math.cos(angle)))
        n=len(raw);fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh(name+f' • blade {j+1}',vs,fs,brass,UNDER,True)
for y,x in [(0,-106.8),(-6.0,-100.0),(6.0,-100.0)]:
    rod('Propeller shaft',(-72,y*.72,-6.3),(x+.6,y,-7.20),.27,edge,UNDER,vertices=20)
    rod('Shaft fairing',(-70,y*.72,-6.15),(-90,y*.90,-6.85),.66,red,UNDER,.38,24)
    propeller('Center screw' if y==0 else ('Port screw' if y>0 else 'Starboard screw'),x,y,-7.2)
    if y:
        for s in (-1,1):rod('Shaft A-bracket',(x+3,y,-7.2),(x+6,y+s*1.8,-4.4),.22,red,UNDER)
for y in (-3.25,3.25):
    ob=prism('Balanced rudder • port' if y>0 else 'Balanced rudder • starboard',[(-114,y-.25),(-108.1,y-.25),(-107.6,y+.25),(-114,y+.25)],-8.9,-3.3,red,UNDER)
    rod('Rudder stock',(-110,y,-7.5),(-110,y,-2.4),.26,edge,UNDER)

# Inspect gameplay volumes in Blender by revealing this collection.
INTERNAL=group('14 Simulation volumes')
for category in ['modules','compartments','armor','obstructions']:
    for volume in DEFINITION[category]:
        a,b,c=volume['center'];sx,sy,sz=volume['size']
        ob=box(category+'.'+volume['id'],(-c,-a,b),(sz,sx,sy),red,INTERNAL,0)
        ob.display_type='WIRE';ob.hide_render=True;ob['exportRole']='simulation';ob['definitionId']=volume['id']
INTERNAL.hide_viewport=True;INTERNAL.hide_render=True
scene['definitionHash']=DEFINITION['contentHash']

# Hidden reference objects carry exact dimensional datums without polluting the model.
for name,loc in [('Stern extremity',(-125.25,0,0)),('Bow extremity',(125.25,0,0)),('Port beam',(0,18,0)),('Starboard beam',(0,-18,0)),('Design waterline',(0,0,0)),('Keel baseline',(0,0,-9.33))]:
    ob=bpy.data.objects.new(name,None);GUIDES.objects.link(ob);ob.location=loc;ob.empty_display_type='PLAIN_AXES';ob.empty_display_size=3
GUIDES.hide_viewport=True;GUIDES.hide_render=True

# Studio deliberately has no sea plane, so full hull proportions are visible.
ground=mat('Studio floor',(.045,.064,.083),.05,.7)
box('Studio ground',(0,0,-10.5),(2000,2000,.25),ground,STUDIO,0)
def camera(name,loc,target,scale):
    d=bpy.data.cameras.new(name);ob=bpy.data.objects.new(name,d);STUDIO.objects.link(ob)
    ob.location=loc;ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    d.type='ORTHO';d.ortho_scale=scale;d.clip_end=3000;d.lens=52
    return ob
hero=camera('01 • Three-quarter • orthographic',(182,-285,177),(0,0,9),281)
sidecam=camera('02 • Starboard profile • orthographic',(0,-400,17),(0,0,17),275)
topcam=camera('03 • Deck plan • orthographic',(0,0,400),(0,0,0),275)
topcam.rotation_euler=(0,0,0)
bowcam=camera('04 • Bow body view',(400,0,14),(0,0,14),78)
def light(name,loc,power,size,color,target=(0,0,0)):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    ob=bpy.data.objects.new(name,d);STUDIO.objects.link(ob);ob.location=loc
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
light('Key • large softbox',(45,-110,160),336000,120,(1.0,.91,.80))
light('Fill • sky',(-90,-15,115),204000,100,(.69,.81,1.0))
light('Rim • aft',(15,120,140),408000,105,(.83,.90,1))
scene.world.color=(.2,.2,.2)
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.23,.29,.37,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.45
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.cycles.max_bounces=6
scene.render.image_settings.file_format='PNG'
scene.render.resolution_percentage=100
scene.render.resolution_x=2400;scene.render.resolution_y=1400
scene.view_settings.view_transform='AgX'
scene.camera=hero
scene.render.film_transparent=False
scene['model']='Battleship Bismarck — May 1941 exterior study'
scene['scale']='1:1 in metres; overall hull 250.50 × 36.00 m'
scene['historical_basis']='KBismarck technical data, armament station list, Manuel P. González López plan/profile of 24 May 1941'
scene['limitations']='Overall dimensions and main turret stations constrained; interpreted hull lines and simplified fittings. No certified shipyard-offset reconstruction.'

# Opening view: whole ship, material colors, no light/camera clutter.
for ob in STUDIO.objects:
    if ob.type in {'LIGHT','CAMERA'} or ob.name=='Studio ground':ob.hide_set(True)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.clip_end=4000
            area.spaces.active.shading.type='SOLID'
            area.spaces.active.shading.color_type='MATERIAL'
            area.spaces.active.shading.light='STUDIO'
            area.spaces.active.shading.show_cavity=True
            area.spaces.active.overlay.show_floor=False
            area.spaces.active.overlay.show_axis_x=False
            area.spaces.active.overlay.show_axis_y=False
            region=area.spaces.active.region_3d
            region.view_distance=290
            region.view_location=Vector((0,0,9))
            region.view_rotation=hero.rotation_euler.to_quaternion()
            region.view_perspective='ORTHO'
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active=hull

# Save reproducible script and modelling notes inside the .blend.
for path in [Path(__file__),SOURCE_DIR/'README.md',SOURCE_DIR/'blueprint.json']:
    if path.exists():
        tx=bpy.data.texts.new(path.name);tx.write(path.read_text())
bpy.context.view_layer.update()
bounds=[hull.matrix_world@Vector(c) for c in hull.bound_box]
dims=[max(p[i] for p in bounds)-min(p[i] for p in bounds) for i in range(3)]
report={'hull_length_m':round(dims[0],4),'hull_beam_m':round(dims[1],4),'keel_z_m':round(min(p.z for p in bounds),4),'main_turrets':[{'name':n,'station_m':st,'x_m':st-122.5} for n,st,z,a in main_specs],'main_turret_pair_spacing_m':18.2,'main_guns':8,'secondary_guns':12,'heavy_aa_guns':16,'medium_aa_guns':16,'light_aa_guns':20,'screws':3,'rudders':2,'objects':len(bpy.data.objects),'mesh_vertices':sum(len(o.data.vertices) for o in bpy.data.objects if o.type=='MESH'),'limitations':scene['limitations']}
assert abs(dims[0]-LOA)<.001
assert abs(dims[1]-BEAM)<.001
assert abs(min(p.z for p in bounds)+DRAFT)<.001
(OUT/'dimensions.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('MODEL_SAVED',json.dumps(report),flush=True)
if os.environ.get('BISMARCK_SKIP_RENDER')!='1':
    for cam,filename,w,h in [(hero,'Bismarck_hero.png',2400,1400),(sidecam,'Bismarck_profile.png',2600,850),(topcam,'Bismarck_deck_plan.png',2600,900)]:
        scene.camera=cam;scene.render.resolution_x=w;scene.render.resolution_y=h
        scene.render.filepath=str(OUT/'renders'/filename)
        bpy.ops.render.render(write_still=True)
    scene.camera=hero;scene.render.resolution_x=2400;scene.render.resolution_y=1400
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('DONE',flush=True)

"""Original plan-led convoy component recipe, version 2.

Only the compiled blueprint and original gun catalog feed geometry. Coordinates:
Blender +X bow, +Y port, +Z up; export maps (-Y, Z, -X) into runtime.
Hull sections and deckhouses are the same surfaces used for CPU structure hits.
Cargo, rigging, boats and ASW fittings are independently authored approximations.
"""
import bpy
import bmesh
import json
import math
import os
import sys
from pathlib import Path
from mathutils import Vector, Matrix

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'scripts/ships'))
from blender_components import create_gun_mount

out = Path(os.environ['SHIP_OUTPUT'])
definition = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
flower = definition['id'] == 'flower-corvette'
collier = definition['id'] == 'liberty-collier'
victory = definition['id'] == 'victory-cargo'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
col = bpy.data.collections.new('Original plan-led convoy assemblies v2')
scene.collection.children.link(col)
palette = {
    'naval': (.55, .60, .59, 1) if flower else (.41, .45, .45, 1),
    'hullgray': (.48, .53, .52, 1) if flower else (.30, .35, .36, 1),
    'roof': (.26, .31, .32, 1), 'edge': (.16, .20, .21, 1),
    'dark': (.023, .033, .038, 1), 'underwater': (.25, .065, .042, 1),
    'deck': (.29, .31, .29, 1), 'canvas': (.59, .56, .44, 1),
    'hatch': (.38, .41, .37, 1), 'funnel': (.37, .40, .37, 1),
    'cargo': (.20, .26, .15, 1), 'wood': (.36, .24, .13, 1),
    'glass': (.048, .12, .15, 1), 'bronze': (.38, .25, .105, 1),
    'white': (.82, .84, .79, 1), 'blue': (.24, .44, .52, 1),
    'rust': (.24, .105, .055, 1), 'rope': (.28, .24, .16, 1),
}
materials = {}
for key, color in palette.items():
    mat = bpy.data.materials.new('Convoy ' + key)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = .30 if key == 'glass' else .78
    bsdf.inputs['Metallic'].default_value = .45 if key == 'bronze' else .08
    materials[key] = mat


def finish(obj, name, material, collection=None):
    obj.name = name
    for group in list(obj.users_collection):
        group.objects.unlink(obj)
    (collection or col).objects.link(obj)
    if material:
        obj.data.materials.append(material)
    obj['assemblyId'] = name.split('.')[0]
    return obj


def mesh(name, vertices, faces, material, collection=None, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    (collection or col).objects.link(obj)
    if material:
        data.materials.append(material)
    for face in data.polygons:
        face.use_smooth = smooth
    obj['assemblyId'] = name.split('.')[0]
    return obj


def box(name, location, dimensions, material, collection=None, bev=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.scale = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, material, collection)
    if bev and min(dimensions) > .12:
        modifier = obj.modifiers.new('Small fabricated edge', 'BEVEL')
        modifier.width = min(bev, min(dimensions) / 5)
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def cyl(name, location, radius, depth, material, collection=None, vertices=20, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if r2 is None else r2, depth=max(.001, depth), location=location)
    obj = finish(bpy.context.object, name, material, collection)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def rod(name, a, b, radius, material, collection=None, r2=None, vertices=10):
    a, b = Vector(a), Vector(b)
    obj = cyl(name, (a + b) / 2, radius, (b - a).length, material, collection, vertices, r2)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


def empty(name, location):
    obj = bpy.data.objects.new(name, None)
    col.objects.link(obj)
    obj.location = location
    obj['nodeId'] = name
    obj['assemblyId'] = name.split('.')[0]
    return obj


def attach(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = world
    obj['assemblyId'] = parent.get('assemblyId', parent.name)


def interp(table, at):
    for (a, va), (b, vb) in zip(table, table[1:]):
        if a <= at <= b:
            return va + (vb - va) * (at - a) / (b - a)
    return table[0][1] if at < table[0][0] else table[-1][1]


hull = definition['hull']
length = hull['length']
deck = lambda x: interp(hull['deckHeights'], x + length / 2)
width = lambda x: interp(hull['halfBreadths'], x + length / 2)
def surface_width(x,z):
    # Evaluate the authored hull itself for flush-mounted fittings.
    at=x+length/2
    def section_width(section):
        points=section['points']
        return interp([(h,w) for w,h in points],z)
    return interp([(s['station'],section_width(s)) for s in hull['sections']],at)
vertices, faces = [], []
for section in hull['sections']:
    x = section['station'] - length / 2
    vertices.extend([(x, -w, z) for w, z in section['points']])
    vertices.extend([(x, w, z) for w, z in reversed(section['points'])])
ring = len(hull['sections'][0]['points']) * 2
for i in range(len(hull['sections']) - 1):
    for j in range(ring):
        faces.append((i*ring+j, (i+1)*ring+j, (i+1)*ring+(j+1)%ring, i*ring+(j+1)%ring))
faces.extend([tuple(reversed(range(ring))), tuple((len(hull['sections'])-1)*ring+j for j in range(ring))])
shell = mesh('hull.surface', vertices, faces, None)
shell['nodeId'] = 'hull.surface'
for key in ['underwater', 'dark', 'hullgray', 'deck', 'blue']:
    shell.data.materials.append(materials[key])
bm = bmesh.new()
bm.from_mesh(shell.data)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(shell.data)
bm.free()
for face in shell.data.polygons:
    x, y, z = face.center
    top = abs(face.normal.z) > .85 and z > .5
    face.material_index = 3 if top else 0 if z < 0 else 1 if z < .42 else 2
    face.use_smooth = not top and abs(face.normal.z) < .85


def railing(name, points, height=.95, solid=False):
    for a, b in zip(points, points[1:]):
        if abs(a[2]-b[2]) > .65: continue
        if solid:
            obj = mesh(name+'.bulwark', [a,b,(b[0],b[1],b[2]+height),(a[0],a[1],a[2]+height)], [(0,1,2,3)], materials['naval'])
            mod = obj.modifiers.new('Steel bulwark', 'SOLIDIFY'); mod.thickness = .045
        else:
            rod(name+'.stanchion', a, (a[0],a[1],a[2]+height), .021, materials['naval'])
            for rise in [height*.5, height]:
                rod(name+'.wire', (a[0],a[1],a[2]+rise), (b[0],b[1],b[2]+rise), .011, materials['edge'], vertices=6)


for side in [-1, 1]:
    points = [(x, side*(width(x)-.065), deck(x)+.04) for x in [(-length/2+.8)+i*(length-1.6)/90 for i in range(91)]]
    railing('deck-rails', points, .75 if flower else .95)
    for x in ([22,26,-23,-27] if flower else [60,55,-57,-61]):
        y = side * width(x) * .76
        box('mooring.base',(x,y,deck(x)+.07),(1.05,.5,.14),materials['edge'])
        for offset in [-.3,.3]:
            cyl('mooring.bollard',(x+offset,y,deck(x)+.3),.12,.45,materials['edge'])

# Steel deckhouses exactly follow the blueprint footprints.
for structure in definition.get('structures', []):
    sid, base, height = structure['id'], structure['baseY'], structure['height']
    if sid == 'funnel':
        continue
    footprint = [(-z,-x) for x,z in structure['footprint']]
    n = len(footprint)
    vv = [(x,y,base) for x,y in footprint]+[(x,y,base+height) for x,y in footprint]
    ff = [tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj = mesh(sid+'.walls', vv, ff, materials[structure['material']])
    obj.data.materials.append(materials['roof' if 'hatch' not in sid else 'hatch' if collier else 'canvas'])
    obj.data.polygons[1].material_index = 1
    x0,x1 = min(p[0] for p in footprint),max(p[0] for p in footprint)
    y0,y1 = min(p[1] for p in footprint),max(p[1] for p in footprint)
    if height > 2 and sid != 'poop-house':
        for side in [-1,1]:
            for x in [x0+.8+i*1.3 for i in range(max(1,int((x1-x0-1.6)/1.3)))]:
                rod(sid+'.scuttle-rim',(x,side*(y1+.006),base+height*.58),(x,side*(y1+.034),base+height*.58),.16,materials['edge'],vertices=20)
                rod(sid+'.scuttle',(x,side*(y1+.034),base+height*.58),(x,side*(y1+.04),base+height*.58),.125,materials['dark'],vertices=20)
            box(sid+'.door',(x0+.75,side*(y1+.025),base+.90),(.65,.05,1.65),materials['edge'])
            box(sid+'.door-inset',(x0+.75,side*(y1+.056),base+.9),(.52,.018,1.5),materials['naval'],bev=0)
    if sid in ['wheelhouse','bridge-house']:
        for i in range(7):
            y = (i-3)*(y1-y0)/8
            box(sid+'.forward-window',(x1+.016,y,base+height*.66),(.03,(y1-y0)/10,.65),materials['glass'],bev=0)
        for side in [-1,1]:
            rod(sid+'.wing-support',(x0,side*y1,base-height*.3),(x1-.4,side*y1,base),.065,materials['edge'])
    if sid in ['bridge-wings','boat-deck']:
        corners=[(x0,y0,base+height),(x1,y0,base+height),(x1,y1,base+height),(x0,y1,base+height),(x0,y0,base+height)]
        points=[]
        for a,b in zip(corners,corners[1:]):
            steps=max(1,int((Vector(b)-Vector(a)).length/.85))
            points.extend([tuple(Vector(a).lerp(Vector(b),i/steps)) for i in range(steps)])
        points.append(corners[-1])
        railing(sid,points,1.03,solid=flower and sid=='bridge-wings')
    if sid.startswith('hatch-') and not collier:
        for x in [x0+.4+i*1.25 for i in range(int((x1-x0)/1.25))]:
            box('hatch-battens.strip',(x,0,base+height+.025),(.08,y1-y0,.05),materials['wood'],bev=0)


def ventilator(name,x,y,z,r=.32,height=1.6):
    # Swept quarter-turn cowl, with a rolled rim and genuinely recessed mouth.
    bend=r*1.2
    path=[(x,z,r),(x,z+height-bend,r)]
    for i in range(1,13):
        a=i*math.pi/24
        path.append((x+bend*(1-math.cos(a)),z+height-bend+bend*math.sin(a),r*(1+.45*i/12)))
    vv=[]; sides=20
    for i,(px,pz,rad) in enumerate(path):
        lo=path[max(0,i-1)];hi=path[min(len(path)-1,i+1)]
        tangent=Vector((hi[0]-lo[0],0,hi[1]-lo[1])).normalized()
        normal=Vector((-tangent.z,0,tangent.x))
        for j in range(sides):
            a=j*math.tau/sides; off=Vector((0,math.cos(a)*rad,0))+normal*math.sin(a)*rad
            vv.append(tuple(Vector((px,y,pz))+off))
    ff=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(len(path)-1) for j in range(sides)]
    mesh(name+'.swept-cowl',vv,ff,materials['naval'],smooth=True)
    mouth=x+bend
    rod(name+'.rolled-lip',(mouth-.025,y,z+height),(mouth+.04,y,z+height),r*1.49,materials['naval'],vertices=24)
    rod(name+'.mouth',(mouth+.041,y,z+height),(mouth+.046,y,z+height),r*1.25,materials['dark'],vertices=24)


def ladder(name, a, b, span=.6):
    for side in [-1,1]:
        rod(name+'.side',(a[0],a[1]+side*span/2,a[2]),(b[0],b[1]+side*span/2,b[2]),.029,materials['edge'])
    for i in range(int((Vector(b)-Vector(a)).length/.3)+1):
        t=i/max(1,int((Vector(b)-Vector(a)).length/.3)); p=Vector(a).lerp(Vector(b),t)
        rod(name+'.rung',(p.x,p.y-span/2,p.z),(p.x,p.y+span/2,p.z),.024,materials['edge'])


stack = next(s for s in definition['structures'] if s['id']=='funnel')
sx = -sum(p[1] for p in stack['footprint'])/len(stack['footprint'])
sz, sh = stack['baseY'], stack['height']
rx=(max(p[1] for p in stack['footprint'])-min(p[1] for p in stack['footprint']))/2
ry=(max(p[0] for p in stack['footprint'])-min(p[0] for p in stack['footprint']))/2
vv=[]; n=48
for h in [0,sh-1.45,sh-.18,sh]:
    for i in range(n):
        a=i*math.tau/n
        vv.append((sx+rx*math.cos(a),ry*math.sin(a),sz+h))
ff=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)]
f=mesh('funnel.jacket',vv,ff,materials['naval' if flower else 'funnel'],smooth=True)
f.data.materials.append(materials['dark'])
for p in f.data.polygons:
    if p.center.z>sz+sh-1.45:p.material_index=1
obj=cyl('funnel.recess',(sx,0,sz+sh-.16),ry*.9,.025,materials['dark'],vertices=48);obj.scale.x=rx/ry
ladder('funnel.ladder',(sx-rx-.05,0,sz),(sx-rx-.05,0,sz+sh-.12),.42)
for side in [-1,1]:
    rod('funnel.stay',(sx,side*ry,sz+sh-1),(sx-2.7,side*(ry+1.4),sz+.1),.012,materials['edge'],vertices=6)
    rod('funnel.steam-pipe',(sx,side*(ry+.11),sz),(sx,side*(ry+.11),sz+sh+.15),.045,materials['edge'])
    ventilator('boiler-vents',sx+.65,side*(ry+.2),sz,.37 if flower else .52,4.4 if flower else 2.7)


def lifeboat(name,x,y,z,scale=1):
    # Curved clinker-like dinghy shell, open interior and thwarts. Its nominal
    # 6.2 m length scales to the 16-foot boats shown on the Cobalt builder plan.
    n=48; vv=[]
    for longitudinal,transverse,h in [(.78,.18,0),(.91,.66,.23),(1,1,.65),(.97,.90,.61),(.76,.35,.18)]:
        for i in range(n):
            a=i*math.tau/n
            vv.append((x+3.1*math.cos(a)*longitudinal*scale,y+math.sin(a)*(1-.16*math.cos(a))*transverse*scale,z+h*scale))
    ff=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(4) for i in range(n)]
    ff.extend([tuple(reversed(range(n))),tuple(range(4*n,5*n))])
    obj=mesh(name+'.hull',vv,ff,materials['naval'],smooth=True)
    obj.data.materials.append(materials['wood'])
    for p in obj.data.polygons:
        if p.index>=n*3:p.material_index=1
    for i in range(n):
        rod(name+'.gunwale',vv[2*n+i],vv[2*n+(i+1)%n],.034*scale,materials['edge'],vertices=8)
    if flower:
        for dx in [-1.8,-.6,.6,1.8]:
            span=math.sqrt(1-(dx/3.1)**2)*1.7
            box(name+'.thwart',(x+dx*scale,y,z+.49*scale),(.22*scale,span*scale,.06*scale),materials['wood'],bev=0)
        for side in [-1,1]:
            rod(name+'.oar',(x-1.9*scale,y+side*.4*scale,z+.53*scale),(x+1.7*scale,y+side*.55*scale,z+.53*scale),.024*scale,materials['wood'])
    else:
        cloth=[*vv[2*n:3*n],(x,y,z+.81*scale)]
        mesh(name+'.canvas',cloth,[(i,(i+1)%n,n) for i in range(n)],materials['canvas'])
    for dx in [-1.8,1.8]:
        box(name+'.cradle',(x+dx*scale,y,z-.06*scale),(.19*scale,1.35*scale,.26*scale),materials['wood'])
    for dx in [-2,2]:
        rod(name+'.davit',(x+dx*scale,y*.85,z-.8),(x+dx*scale,y*.85,z+2.6*scale),.075,materials['edge'])
        rod(name+'.arm',(x+dx*scale,y*.85,z+2.6*scale),(x+dx*scale,y,z+2.1*scale),.075,materials['edge'])
        rod(name+'.fall',(x+dx*scale,y,z+2.1*scale),(x+dx*scale,y,z+.8*scale),.023,materials['rope'])


def raft(name,x,y,z,scale=1):
    vv=[]; steps=48; sides=8
    for i in range(steps):
        a=math.tau*i/steps
        for j in range(sides):
            b=math.tau*j/sides
            vv.append((x+math.cos(a)*(1.25+.16*math.cos(b))*scale,y+math.sin(a)*(.66+.16*math.cos(b))*scale,z+.16*math.sin(b)*scale))
    ff=[(i*sides+j,((i+1)%steps)*sides+j,((i+1)%steps)*sides+(j+1)%sides,i*sides+(j+1)%sides) for i in range(steps) for j in range(sides)]
    mesh(name+'.carley-float',vv,ff,materials['canvas'],smooth=True)
    for i in range(8):
        box(name+'.floor-slat',(x+(i-3.5)*.24*scale,y,z-.08*scale),(.16*scale,1.05*scale,.06*scale),materials['wood'],bev=0)


def ring_rail(name,x,y,z,rx,ry,height=.85,solid=False):
    points=[(x+rx*math.cos(i*math.tau/40),y+ry*math.sin(i*math.tau/40),z) for i in range(41)]
    railing(name,points,height,solid)


def platform(name,x,y,z,rx,ry,legs=True,shield=False):
    obj=cyl(name+'.deck',(x,y,z-.08),rx,.16,materials['deck'],vertices=48)
    obj.scale.y=ry/rx
    if legs:
        for i in range(8):
            a=i*math.tau/8;px=x+rx*.78*math.cos(a);py=y+ry*.78*math.sin(a)
            rod(name+'.leg',(px,py,deck(px)),(px,py,z-.15),.065,materials['naval'])
            rod(name+'.brace',(x,y,max(deck(x),z-1.4)),(px,py,z-.15),.045,materials['edge'])
    if shield:ring_rail(name+'.splinter-screen',x,y,z,rx,ry,.83,True)


def winch(name,x,y,z,scale=1):
    box(name+'.bed',(x,y,z+.12*scale),(1.6*scale,1.0*scale,.24*scale),materials['naval'])
    for side in [-1,1]:
        box(name+'.bearing',(x,y+side*.56*scale,z+.45*scale),(.7*scale,.1*scale,.60*scale),materials['naval'])
    rod(name+'.drum',(x,y-.5*scale,z+.51*scale),(x,y+.5*scale,z+.51*scale),.28*scale,materials['dark'],vertices=24)
    for offset in [-.5,.5]:
        rod(name+'.flange',(x,y+offset*scale-.04,z+.51*scale),(x,y+offset*scale+.04,z+.51*scale),.38*scale,materials['naval'],vertices=24)
    cyl(name+'.motor',(x+.62*scale,y,z+.34*scale),.18*scale,.45*scale,materials['edge'])


def mast(name,x,z,top,paired=False,derricks=True,directions=(-1,1)):
    pivot=empty(name+'.pivot',(x,0,z))
    if paired:
        for side in [-1,1]:
            attach(rod(name+'.kingpost',(x,side*1.05,z),(x,side*.82,top-5),.22,materials['naval'],r2=.14),pivot)
        attach(rod(name+'.crosshead',(x,-.85,top-5),(x,.85,top-5),.18,materials['naval']),pivot)
        attach(rod(name+'.aerial-pole',(x,.82,top-5),(x,.82,top),.10,materials['naval'],r2=.055),pivot)
    else:
        attach(rod(name+'.spar',(x,0,z),(x-.35,0,top),.26,materials['naval'],r2=.095),pivot)
    attach(rod(name+'.yard',(x,-2.8,top-1.2),(x,2.8,top-1.2),.065,materials['edge']),pivot)
    if derricks:
        for direction in directions:
            for side in [-1,1]:
                a=(x,side*.8,z+1.1);b=(x+direction*10.5,side*3.35,z+9.8)
                boom=empty(name+f'.boom-{direction}-{side}.pivot',a)
                attach(rod(name+'.derrick',a,b,.13,materials['naval'],r2=.09),boom)
                rod(name+'.lift',(x,side*.82,top-5.3),b,.013,materials['edge'],vertices=6)
                rod(name+'.fall',b,(b[0],b[1],z+1),.012,materials['rope'],vertices=6)
                winch(name+'.winch',x+direction*1.9,side*2.4,z,.8)
    for dx in [-7,7]:
        for side in [-1,1]:rod(name+'.shroud',(x,0,top-3),(x+dx,side*min(5,width(x+dx)*.85),deck(x+dx)+.2),.011,materials['edge'],vertices=6)
    ladder(name+'.ladder',(x-.29,0,z),(x-.29,0,top-3),.36)


if not flower:
    if collier:
        # Real collier layout: detached bridge, machinery aft, no cargo derricks.
        mast('navigation-mast',24.0,10.74,24.5,derricks=False)
        mast('mainmast',-38.0,5.55,24.2,derricks=False)
        for x in [59,40,21.0,0,-18,-37]:
            for side in [-1,1]:
                y=side*4.95;z=deck(x)
                rod('hatch-posts.upright',(x,y,z),(x,y,z+6.5),.15,materials['naval'],r2=.12)
                rod('hatch-posts.stay',(x,y,z+6.15),(x-5,y,z+.15),.022,materials['edge'])
                rod('hatch-posts.stay',(x,y,z+6.15),(x+5,y,z+.15),.022,materials['edge'])
                winch('hatch-winch',x,side*5.6,z,.7)
        for s in definition['structures']:
            if not s['id'].startswith('hatch-'):continue
            x=-sum(p[1] for p in s['footprint'])/4;z=s['baseY']+s['height']
            for dx in [-2.75,-1.5,0,1.5,2.75]:
                box('steel-covers.stiffener',(x+dx,0,z+.08),(.10,9.10,.16),materials['edge'],bev=.018)
            for side in [-1,1]:
                rod('steel-covers.hinge',(x-2.9,side*4.56,z+.035),(x+2.9,side*4.56,z+.035),.08,materials['naval'])
        for side in [-1,1]:
            lifeboat('aft-motorboats',-48,side*6.05,6.0,1.31)
            lifeboat('bridge-boats',21.5,side*5.0,6.0,.88)
            ladder('poop-access',(-33,side*5.3,deck(-33)),(-36,side*5.3,5.55))
            ladder('bridge-access',(18,side*4.9,deck(18)),(20.2,side*4.9,5.72))
    else:
        stations=[(28,26.0,True),(-36.0,26.0,True),(42,22.5,False)] if victory else [(40,23.5,False),(18,23.0,False),(-34,23.8,False)]
        for i,(x,top,paired) in enumerate(stations):mast('cargo-mast-'+str(i+1),x,deck(x),top,paired,directions=(1,) if victory and i==2 else (-1,1))
        if victory:
            for x in [-16.0,7.0]:
                for side in [-1,1]:
                    rod('house-kingposts.spar',(x,side*6.4,deck(x)),(x,side*6.4,19.8),.18,materials['naval'],r2=.11)
                    rod('house-kingposts.crossarm',(x,-6.4,19.8),(x,6.4,19.8),.065,materials['edge'])
                    direction=1 if x>0 else -1
                    a=(x,side*6.4,deck(x)+5);b=(x+direction*10.5,side*5.6,deck(x)+11.5)
                    boom=empty(f'house-kingposts.boom-{x}-{side}.pivot',a)
                    attach(rod('house-kingposts.derrick',a,b,.12,materials['naval'],r2=.085),boom)
                    rod('house-kingposts.lift',(x,side*6.4,19.6),b,.013,materials['edge'],vertices=6)
                    rod('house-kingposts.fall',b,(b[0],b[1],deck(b[0])+.6),.012,materials['rope'],vertices=6)
            rod('signal-mast.spar',(2,0,11.2),(2,0,22.5),.09,materials['naval'],r2=.045)
            cyl('foremast.crows-nest',(42,0,21.45),.68,.12,materials['naval'],vertices=24)
            ring_rail('foremast.nest-rail',42,0,21.51,.64,.64,.75)
        for side in [-1,1]:
            for x in [-10,-1.3]:lifeboat('lifeboats',x-(1.8 if victory else 0),side*6.3,deck(-3)+3.0,1.17)
            for x in [25,35,-24,-30]:ventilator('hold-vents',x,side*5.25,deck(x),.34,1.8)
            for x in [-16,11]:ladder('access-ladders',(x,side*5,deck(x)),(x-1.5,side*5,deck(-3)+2.8))
            for x in [26,-25]:raft('crew-rafts',x,side*6.1,deck(x)+.5)
    # Every weapon gets its real supporting platform, including after platforms.
    for m in definition['mounts']:
        if m['id'].startswith('bridge-aa-') and not (victory and m['id'].endswith('-2')):continue
        xx,yy,zz=-m['position'][2],-m['position'][0],m['position'][1]
        rad=2.35 if m['battery']=='main' else 1.75 if m['weapon']['caliberM']>.05 else 1.12
        platform(m['id']+'-platform',xx,yy,zz,rad,rad,shield=True)
else:
    # Port Arthur 19-Nov-1941 GA. All X/Z values registered to its side elevation.
    platform('fore-gun-platform',16.8,0,5.40,3.31,3.31,shield=False)
    ring_rail('fore-gun-safety',16.8,0,5.40,3.25,3.25,.64)
    for side in [-1,1]:
        # Separate splinter skirt below the raised deck, not a solid gun turret.
        rod('gun-platform-edge',(13.5,side*1.2,5.30),(16.8,side*3.25,5.30),.04,materials['naval'])
        lifeboat('escort-dinghies',-1.9,side*3.7,4.02,.787)
        raft('bridge-carley',3.95,side*4.0,3.9,.83)
        ladder('bridge-access',(11.8,side*2.45,2.65),(9.85,side*2.45,4.6),.67)
        ladder('compass-access',(4.8,side*2.25,3.50),(6.0,side*2.25,6.85),.62)
        ladder('gun-access',(12.9,side*1.1,4.65),(14.0,side*1.1,5.40),.6)
        for x in [-7,-11,-15]:
            box('ready-use-locker',(x,side*2.43,3.7),(1.15,.45,.45),materials['naval'])
        for x in [-10,-18]:
            ventilator('engine-vents',x,side*2.2,3.50,.22,1.25)
    # Broad aft bandstand on its own struts above the low engine casing.
    ring_rail('aft-bandstand-shield',-16.8,0,5.04,3.05,2.18,.88,True)
    for x in [-19.4,-17.2,-14.4]:
        for side in [-1,1]:
            rod('aft-bandstand.leg',(x,side*1.9,3.5),(x,side*1.9,4.9),.07,materials['naval'])
    # Skylights and casing hatches, with coamings, panes and battens.
    for x in [-12.1,-9.8]:
        box('engine-skylight.coaming',(x,0,3.60),(1.85,2.2,.22),materials['naval'])
        for side in [-1,1]:
            roof=box('engine-skylight.roof',(x,side*.55,3.86),(1.8,1.18,.075),materials['naval'])
            roof.rotation_euler.x=side*.22
            for dx in [-.52,0,.52]:
                cyl('engine-skylight.port',(x+dx,side*.54,3.96),.19,.027,materials['dark'],vertices=16)
    for x in [1.4,-5.5]:
        box('boiler-hatch.coaming',(x,0,3.61),(1.25,1.4,.20),materials['naval'])
        box('boiler-hatch.lid',(x,0,3.74),(1.35,1.5,.065),materials['deck'])
    # Tall main and foremast, with signal yards and the three long wireless wires.
    for name,x,z,top in [('foremast',12.10,2.65,19.0),('mainmast',-9.80,3.50,17.8)]:
        pivot=empty(name+'.pivot',(x,0,z))
        attach(rod(name+'.spar',(x,0,z),(x-.20,0,top),.18 if name=='foremast' else .13,materials['naval'],r2=.045),pivot)
        for h,span in [(top-2.7,2.6),(top-5.5,1.4)]:
            attach(rod(name+'.yard',(x-.16,-span,h),(x-.16,span,h),.052,materials['edge'],r2=.035),pivot)
            for side in [-1,1]:rod(name+'.halyard',(x-.16,side*span,h),(x-.2,side*min(span,2.2),z+.2),.008,materials['rope'],vertices=6)
        for dx in [-4.0,4.0]:
            for side in [-1,1]:rod(name+'.stay',(x-.13,0,top-3),(x+dx,side*3.8,deck(x+dx)+.1),.011,materials['edge'],vertices=6)
        ladder(name+'.ladder',(x-.19,0,z),(x-.19,0,top-3),.3)
    for y in [-.55,0,.55]:rod('wireless.aerial',(-10.0,y,17.2),(11.9,y,18.5),.009,materials['dark'],vertices=6)
    # Open compass bridge furniture and DF loop (not a later Type 271 lantern).
    cyl('compass.pedestal',(8,0,7.32),.15,.9,materials['edge'])
    cyl('compass.binnacle',(8,0,7.83),.30,.24,materials['bronze'])
    for side in [-1,1]:
        cyl('pelorus.stand',(8,side*2.7,7.35),.075,1.0,materials['edge'])
        cyl('pelorus.head',(8,side*2.7,7.88),.13,.11,materials['bronze'])
    loop=[]
    for i in range(41):
        a=i*math.tau/40;loop.append((8.85,.51*math.sin(a),9.65+.51*math.cos(a)))
    for a,b in zip(loop,loop[1:]):rod('df-loop.frame',a,b,.026,materials['edge'],vertices=8)
    rod('df-loop.stem',(8.85,0,8.8),(8.85,0,9.3),.05,materials['edge'])
    # Steam minesweeping winch, stern davits, Oropesa floats and two DC rails.
    winch('minesweep-winch',-22.9,0,deck(-22.9),1.50)
    for side in [-1,1]:
        for lane in [-.42,.42]:
            rod('depth-racks.rail',(-30,side*2.3+lane,4.15),(-25,side*1.6+lane,3.60),.055,materials['edge'])
        for i in range(5):
            x=-29.3+i*.87;y=side*(2.20-i*.12);z=deck(x)+.42
            rod('depth-racks.charge',(x,y-.40,z),(x,y+.40,z),.255,materials['naval'],vertices=20)
            for offset in [-.37,.37]:
                rod('depth-racks.hoop',(x,y+offset-.025,z),(x,y+offset+.025,z),.27,materials['edge'],vertices=20)
        x=-20.4;y=side*3.5;z=deck(x)
        cyl('depth-thrower.pedestal',(x,y,z+.4),.2,.8,materials['edge'])
        rod('depth-thrower.spigot',(x,y,z+.5),(x,y+side*.6,z+1.15),.08,materials['edge'])
        rod('depth-thrower.charge',(x-.42,y+side*.55,z+1.20),(x+.42,y+side*.55,z+1.20),.26,materials['naval'],vertices=20)
        rod('stern-davit.stem',(-28,side*2.8,deck(-28)),(-28,side*2.8,6.0),.08,materials['naval'])
        rod('stern-davit.arm',(-28,side*2.8,6),(-25.7,side*3.0,7.1),.065,materials['naval'])
        rod('stern-davit.fall',(-25.7,side*3,7.1),(-25.7,side*3,4.0),.011,materials['rope'])
        rod('oropesa-float.body',(-27.2,side*3.4,deck(-27.2)+.38),(-24.4,side*3.4,deck(-27.2)+.38),.32,materials['naval'],r2=.045,vertices=24)
    # Hull side scuttles: measured bands, absent below the reference waterline.
    for side in [-1,1]:
        for x in [15,17.2,19.4,21.6,23.8,26.0]:
            z=3.64;y=side*(surface_width(x,z)+.012)
            rod('forecastle-scuttles.rim',(x,y,z),(x,y+side*.035,z),.15,materials['edge'],vertices=20)
            rod('forecastle-scuttles.glass',(x,y+side*.036,z),(x,y+side*.04,z),.12,materials['dark'],vertices=20)
        for x in [-24,-20,-16,-12,-8,-4,0,4]:
            y=side*(surface_width(x,1.32)+.014)
            rod('hull-scuttles',(x,y,1.32),(x,y+side*.035,1.32),.115,materials['dark'],vertices=20)

# Bow ground tackle, capstan and anchor chains.
ax=length*.43
for side in [-1,1]:
    rod('anchors.chain',(ax,side*1.1,deck(ax)+.18),(length*.48,side*width(length*.48)*.7,deck(length*.48)+.15),.065 if flower else .09,materials['dark'])
    y=side*width(ax)
    rod('anchors.shank',(ax,y,deck(ax)-.3),(ax-.5,y,deck(ax)-1.5),.075,materials['edge'])
    rod('anchors.flukes',(ax-1,y,deck(ax)-1.1),(ax-.1,y,deck(ax)-1.7),.085,materials['edge'])
    cyl('windlass.drum',(ax,side*1.1,deck(ax)+.35),.32,.55,materials['edge'])
box('windlass.bed',(ax,0,deck(ax)+.15),(1.4,3,.3),materials['naval'])

# Original single screw and rudder retain independent stable pivots.
px = -26.0 if flower else -length*.445
pz = -1.85 if flower else -hull['draft']*.69
radius = 1.57 if flower else 2.55
rod('shaft-exterior.shaft',(px+length*.10,0,pz),(px,0,pz),.11 if flower else .2,materials['edge'])
prop = empty('propeller-main.pivot',(px,0,pz))
attach(rod('propeller-main.hub',(px+.5,0,pz),(px-.5,0,pz),.23 if flower else .4,materials['bronze'],r2=.10),prop)
for i in range(3 if flower else 4):
    a=i*math.tau/(3 if flower else 4)
    vv=[(px+dx,math.cos(a+angle)*r,pz+math.sin(a+angle)*r) for r,angle,dx in [(radius*.15,-.2,0),(radius*.8,-.2,.12),(radius,.12,0),(radius*.72,.48,-.18),(radius*.3,.65,-.13)]]
    obj=mesh('propeller-main.blade',vv,[tuple(range(5))],materials['bronze'])
    mod=obj.modifiers.new('Blade thickness','SOLIDIFY');mod.thickness=.06
    attach(obj,prop)
rudder_x=-27.5 if flower else px-length*.022
rudder=empty('rudder-main.pivot',(rudder_x,0,pz+.6))
if flower:
    outline=[(-29.3,-.15),(-28.7,.40),(-27.5,-.02),(-26.95,-.28),(-26.95,-2.55),(-27.35,-3.13),(-28.35,-3.25),(-29.15,-2.8),(-29.55,-1.4)]
else:
    outline=[(rudder_x+.3,pz+radius),(rudder_x+1.9,pz+radius*.65),(rudder_x+2.15,pz-radius*.55),(rudder_x+1.55,pz-radius),(rudder_x-1.25,pz-radius),(rudder_x-1.35,pz+radius*.5)]
vv=[(x,y,z) for y in [-.085,.085] for x,z in outline];n=len(outline)
ff=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
attach(mesh('rudder-main.blade',vv,ff,materials['underwater']),rudder)
attach(rod('rudder-main.stock',(rudder_x,0,pz),(rudder_x,0,deck(rudder_x)-.4),.10 if flower else .19,materials['edge']),rudder)
if flower:
    # Bilge-keel run visible on the original GA; transverse projection estimated.
    for side in [-1,1]:
        vv=[]
        for i in range(25):
            x=-10.2+i*18.0/24;z=-2.28
            y=surface_width(x,z);reach=.32*math.sin(math.pi*i/24)**.4
            vv.extend([(x,side*y,z),(x,side*(y+reach),z-.16)])
        obj=mesh('bilge-keels.plate',vv,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(24)],materials['underwater'])
        mod=obj.modifiers.new('Plate thickness','SOLIDIFY');mod.thickness=.025

for mount in definition['mounts']:
    create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deck)
    if mount['partId']=='bl-4in-mk9-single':
        yaw=bpy.data.objects.get(mount['id']+'.yaw')
        # Individually authored curved-shoulder shield, open aft; barrel slot stays free.
        for side in [-1,1]:
            yy=lambda y:side*y
            vv=[(1.05,yy(.22),.38),(1.05,yy(1.22),.38),(1.05,yy(1.22),1.69),(.92,yy(.94),2.13),(.87,yy(.22),2.13)]
            obj=mesh(mount['id']+'.shield-front',vv,[(0,1,2,3,4)],materials['naval'])
            obj.parent=yaw
            vv=[(1.05,yy(1.22),.38),(-1.24,yy(1.22),.38),(-1.24,yy(1.22),1.69),(.92,yy(1.22),1.69)]
            obj=mesh(mount['id']+'.shield-side',vv,[(0,1,2,3)],materials['naval']);obj.parent=yaw
            vv=[(.92,yy(1.22),1.69),(-1.24,yy(1.22),1.69),(-1.24,yy(.94),2.13),(.92,yy(.94),2.13)]
            obj=mesh(mount['id']+'.shield-shoulder',vv,[(0,1,2,3)],materials['naval']);obj.parent=yaw
        obj=mesh(mount['id']+'.shield-roof',[(-1.24,-.94,2.13),(.87,-.94,2.13),(.87,.94,2.13),(-1.24,.94,2.13)],[(0,1,2,3)],materials['roof']);obj.parent=yaw
    if mount['partId']=='lewis-303-twin':
        for side in ['left','right']:
            recoil=bpy.data.objects.get(mount['id']+'.'+side+'.recoil')
            obj=cyl(mount['id']+'.pan-magazine',(-.16,0,.13),.16,.07,materials['dark'],vertices=24);obj.parent=recoil

scene['definitionHash']=definition['contentHash']
scene['originalRecipe']='convoy-geometry-v2'
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))

"""Original Liberty / Flower component recipe, version 1.

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
troop = definition['id'] == 'liberty-troopship'
deck_cargo = definition['id'] == 'liberty-deck-cargo'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
col = bpy.data.collections.new('Original convoy assemblies v1')
scene.collection.children.link(col)
palette = {
    'naval': (.64, .70, .69, 1) if flower else (.34, .39, .40, 1),
    'hullgray': (.65, .71, .70, 1) if flower else (.27, .32, .33, 1),
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
width = lambda x: interp(hull['halfBreadths'], x + length / 2) * .96
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
    face.material_index = 3 if top else 0 if z < -.3 else 1 if z < .45 else 2
    if flower and not top and z > .45 and ((x > 8 and x < 19-z) or (-21+z < x < -9+z)):
        face.material_index = 4
    face.use_smooth = not top and abs(face.normal.z) < .85


def railing(name, points, height=.95, solid=False):
    for a, b in zip(points, points[1:]):
        if solid:
            obj = mesh(name+'.bulwark', [a,b,(b[0],b[1],b[2]+height),(a[0],a[1],a[2]+height)], [(0,1,2,3)], materials['naval'])
            mod = obj.modifiers.new('Steel bulwark', 'SOLIDIFY'); mod.thickness = .045
        else:
            rod(name+'.stanchion', a, (a[0],a[1],a[2]+height), .027, materials['edge'])
            for rise in [height*.5, height]:
                rod(name+'.wire', (a[0],a[1],a[2]+rise), (b[0],b[1],b[2]+rise), .018, materials['edge'], vertices=6)


for side in [-1, 1]:
    points = [(x, side*width(x), deck(x)+.04) for x in [(-length/2+.8)+i*(length-1.6)/90 for i in range(91)]]
    railing('deck-rails', points, .75 if flower else .95)
    for x in ([22,26,-23,-27] if flower else [60,55,-57,-61]):
        y = side * width(x) * .76
        box('mooring.base',(x,y,deck(x)+.07),(1.05,.5,.14),materials['edge'])
        for offset in [-.3,.3]:
            cyl('mooring.bollard',(x+offset,y,deck(x)+.3),.12,.45,materials['edge'])

# Steel deckhouses exactly follow the blueprint footprints.
for structure in definition.get('structures', []):
    sid, base, height = structure['id'], structure['baseY'], structure['height']
    if sid == 'funnel' or sid.startswith('deck-load-'):
        continue
    footprint = [(-z,-x) for x,z in structure['footprint']]
    n = len(footprint)
    vv = [(x,y,base) for x,y in footprint]+[(x,y,base+height) for x,y in footprint]
    ff = [tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj = mesh(sid+'.walls', vv, ff, materials[structure['material']])
    obj.data.materials.append(materials['roof' if 'hatch' not in sid else 'canvas'])
    obj.data.polygons[1].material_index = 1
    x0,x1 = min(p[0] for p in footprint),max(p[0] for p in footprint)
    y0,y1 = min(p[1] for p in footprint),max(p[1] for p in footprint)
    if height > 2 and sid != 'poop-house':
        for side in [-1,1]:
            for x in [x0+.8+i*1.3 for i in range(max(1,int((x1-x0-1.6)/1.3)))]:
                box(sid+'.porthole',(x,side*(y1+.013),base+height*.63),(.35,.03,.40),materials['glass'],bev=0)
            box(sid+'.door',(x0+.75,side*(y1+.025),base+.90),(.65,.05,1.65),materials['edge'])
            box(sid+'.door-inset',(x0+.75,side*(y1+.056),base+.9),(.52,.018,1.5),materials['naval'],bev=0)
    if sid in ['wheelhouse','bridge-house']:
        for i in range(7):
            y = (i-3)*(y1-y0)/8
            box(sid+'.forward-window',(x1+.016,y,base+height*.66),(.03,(y1-y0)/10,.65),materials['glass'],bev=0)
        for side in [-1,1]:
            rod(sid+'.wing-support',(x0,side*y1,base-height*.3),(x1-.4,side*y1,base),.065,materials['edge'])
    if sid in ['bridge-wings','boat-deck']:
        railing(sid,[(x0,y0,base+height),(x1,y0,base+height),(x1,y1,base+height),(x0,y1,base+height),(x0,y0,base+height)])
    if sid.startswith('hatch-'):
        for x in [x0+.4+i*1.25 for i in range(int((x1-x0)/1.25))]:
            box('hatch-battens.strip',(x,0,base+height+.025),(.08,y1-y0,.05),materials['wood'],bev=0)


def ventilator(name,x,y,z,r=.32,height=1.6):
    cyl(name+'.stem',(x,y,z+height*.45),r,height*.9,materials['naval'],r2=r*.92)
    rod(name+'.cowl',(x,y,z+height),(x+.60,y,z+height),r*1.5,materials['naval'],r2=r*1.8)
    rod(name+'.opening',(x+.601,y,z+height),(x+.625,y,z+height),r*1.50,materials['dark'])


def ladder(name, a, b, span=.6):
    for side in [-1,1]:
        rod(name+'.side',(a[0],a[1]+side*span/2,a[2]),(b[0],b[1]+side*span/2,b[2]),.029,materials['edge'])
    for i in range(int((Vector(b)-Vector(a)).length/.3)+1):
        t=i/max(1,int((Vector(b)-Vector(a)).length/.3)); p=Vector(a).lerp(Vector(b),t)
        rod(name+'.rung',(p.x,p.y-span/2,p.z),(p.x,p.y+span/2,p.z),.024,materials['edge'])


stack = next(s for s in definition['structures'] if s['id']=='funnel')
sx = -sum(p[1] for p in stack['footprint'])/len(stack['footprint'])
sz, sh = stack['baseY'], stack['height']
r = .94 if flower else 1.48
obj=cyl('funnel.jacket',(sx,0,sz+sh/2),r,sh,materials['naval' if flower else 'funnel'],vertices=36,r2=r*.92)
obj.scale.x=1.12
obj=cyl('funnel.black-cap',(sx,0,sz+sh-.35),r*.96,.85,materials['dark'],vertices=36);obj.scale.x=1.12
cyl('funnel.soot',(sx,0,sz+sh+.08),r*.83,.03,materials['dark'],vertices=36)
ladder('funnel.ladder',(sx-r*1.13,0,sz),(sx-r*1.13,0,sz+sh))
for side in [-1,1]:
    rod('funnel.stay',(sx,side*r,sz+sh-.8),(sx-2,side*(r+2),sz+.1),.016,materials['edge'],vertices=6)
    rod('funnel.steam-pipe',(sx,side*(r+.12),sz),(sx,side*(r+.12),sz+sh+.35),.045,materials['edge'])
    ventilator('ventilators',sx-2.4,side*(2 if flower else 3),sz if not flower else deck(sx-2.4),.25 if flower else .43,1.4 if flower else 2)


def lifeboat(name,x,y,z,scale=1):
    outline=[(-3,0),(-2.6,-.66),(-1.7,-1),(1.8,-.95),(2.8,-.55),(3.2,0),(2.8,.55),(1.8,.95),(-1.7,1),(-2.6,.66)]
    n=len(outline)
    vv=[(x+a*scale,y+b*scale,z+.65*scale) for a,b in outline]+[(x+a*.76*scale,y+b*.4*scale,z) for a,b in outline]
    mesh(name+'.hull',vv,[tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['naval'])
    mesh(name+'.canvas',vv[:n],[tuple(range(n))],materials['canvas'])
    for dx in [-2,2]:
        rod(name+'.davit',(x+dx*scale,y*.85,z-.8),(x+dx*scale,y*.85,z+2.6*scale),.075,materials['edge'])
        rod(name+'.arm',(x+dx*scale,y*.85,z+2.6*scale),(x+dx*scale,y,z+2.1*scale),.075,materials['edge'])
        rod(name+'.fall',(x+dx*scale,y,z+2.1*scale),(x+dx*scale,y,z+.8*scale),.023,materials['rope'])


def raft(name,x,y,z,scale=1):
    box(name+'.float',(x,y,z),(2.3*scale,1.3*scale,.32*scale),materials['canvas'])
    box(name+'.center',(x,y,z+.17*scale),(1.7*scale,.75*scale,.05),materials['wood'],bev=0)
    for dy in [-.55,.55]:
        rod(name+'.rope',(x-1.1*scale,y+dy*scale,z+.2*scale),(x+1.1*scale,y+dy*scale,z+.2*scale),.032,materials['rope'])


if not flower:
    # Three kingpost/mast stations service the five cargo hatches.
    for mi,(x,height) in enumerate([(40,25),(19,23),(-36,24)]):
        z=deck(x); name=f'cargo-mast-{mi+1}'
        pivot=empty(name+'.pivot',(x,0,z))
        for part in [cyl(name+'.mast',(x,0,z+height/2),.30,height,materials['naval'],r2=.11),rod(name+'.cross-tree',(x,-3,z+height*.75),(x,3,z+height*.75),.10,materials['edge'])]:attach(part,pivot)
        for direction in [-1,1]:
            for side in [-1,1]:
                a=(x,side*.8,z+1.3);b=(x+direction*9,side*3.0,z+5.5)
                boom=empty(name+f'.boom-{direction}-{side}.pivot',a)
                attach(rod(name+'.derrick',a,b,.12,materials['naval'],r2=.085),boom)
                rod(name+'.topping-lift',(x,side*.7,z+height*.65),b,.023,materials['edge'],vertices=6)
                rod(name+'.cargo-fall',b,(b[0],b[1],z+1),.02,materials['rope'],vertices=6)
                box(name+'.winch-base',(x+direction*1.6,side*2,z+.22),(1.2,1,.4),materials['naval'])
                rod(name+'.winch-drum',(x+direction*1.6,side*2-.4,z+.65),(x+direction*1.6,side*2+.4,z+.65),.28,materials['edge'])
        for end in [x-12,x+12]:
            for side in [-1,1]:rod(name+'.shroud',(x,0,z+height*.8),(end,side*min(5,width(end)*.85),deck(end)+.2),.022,materials['edge'],vertices=6)
        ladder(name+'.ladder',(x-.32,0,z),(x-.32,0,z+height*.75),.42)
    for side in [-1,1]:
        for x in [-7.4,1.0]:lifeboat('lifeboats',x,side*6.45,6.2,1.07)
        for x in [26,34,-24,-31]:ventilator('hold-vents',x,side*5.25,deck(x),.34,1.8)
        for x in [-15,14]:ladder('access-ladders',(x,side*5,deck(x)),(x-1.5,side*5,5.8))
    rod('signal-mast.stem',(6,0,11.05),(6,0,19),.10,materials['edge'],r2=.045)
    rod('signal-mast.yard',(6,-3.7,17),(6,3.7,17),.055,materials['edge'])
    for side in [-1,1]:rod('signal-mast.halyard',(6,side*3.5,17),(5.7,side*3.5,11.1),.016,materials['rope'],vertices=6)
    for x,y,z in [(59,0,deck(59)+1.25),(55,-3.5,deck(55)+1),(55,3.5,deck(55)+1),(-50,-5.1,deck(-50)+2.2),(-50,5.1,deck(-50)+2.2)]:
        radius=1.7 if x==59 else 1.05
        cyl('gun-platforms.floor',(x,y,z-.10),radius,.20,materials['roof'],vertices=32)
        cyl('gun-platforms.support',(x,y,(deck(x)+z)/2),.32,z-deck(x),materials['naval'])
    if troop:
        for side in [-1,1]:
            for x in [24,30,36,-22,-29,-35]:raft('troop-rafts',x,side*5.4,deck(x)+.6)
            for x in [-56]:cyl('troop-gun-platforms.floor',(x,side*4.4,deck(x)+2.2),1.65,.2,materials['roof'],vertices=32)
            for x in [25,35,-24,-32]:ventilator('troop-ventilation',x,side*4.1,deck(x),.25,2.3)
    elif deck_cargo:
        for x in [49,30,-27,-46]:
            for side in [-1,1]:
                y,z=side*2,deck(x)+.9
                for track in [-1,1]:
                    box('vehicle-cargo.track',(x,y+track*1.02,z+.45),(5.6,.45,.8),materials['dark'],bev=.15)
                    for dx in [-2,-1,0,1,2]:rod('vehicle-cargo.wheel',(x+dx,y+track*1.255,z+.46),(x+dx,y+track*1.28,z+.46),.28,materials['cargo'])
                box('vehicle-cargo.hull',(x,y,z+.95),(5.1,2,.95),materials['cargo'],bev=.25)
                cyl('vehicle-cargo.turret',(x-.35,y,z+1.75),.85,.75,materials['cargo'],vertices=12,r2=.70)
                rod('vehicle-cargo.barrel',(x+.05,y,z+1.9),(x+2.8,y,z+1.9),.09,materials['cargo'],r2=.05)
                for dx in [-2,2]:
                    for lateral in [-1,1]:rod('cargo-lashings.chain',(x+dx,y+lateral*1.1,z+.6),(x+dx+.7,y+lateral*1.7,z+.02),.024,materials['rope'])
        for x in [22,-18]:
            for y in [-5.5,5.5]:
                z=deck(x);box('crated-cargo.crate',(x,y,z+.75),(2.3,1.6,1.5),materials['wood'])
                for dx in [-.8,.8]:box('crated-cargo.strap',(x+dx,y,z+1.51),(.1,1.64,.05),materials['edge'],bev=0)
    else:
        for x in [25,-24]:
            for y in [-5.7,5.7]:raft('cargo-rafts',x,y,deck(x)+.5)
else:
    # Escort silhouette: high forecastle, open compass bridge and aft bandstand.
    cyl('fore-gun-platform.floor',(20,0,deck(20)+.16),2.45,.28,materials['deck'],vertices=36)
    cyl('aft-bandstand.floor',(-14,0,deck(-14)+2),2.05,.2,materials['roof'],vertices=36)
    for angle in [i*math.tau/8 for i in range(8)]:
        y=math.sin(angle)*1.6;x=-14+math.cos(angle)*1.6
        rod('aft-bandstand.leg',(x,y,deck(x)),(x,y,deck(-14)+1.95),.085,materials['edge'])
    for side in [-1,1]:
        lifeboat('escort-boats',-6,side*3.7,3.4,.66)
        raft('escort-rafts',-10.5,side*3.9,2.8,.85)
        ladder('bridge-access',(1,side*2.8,4.1),(2.2,side*2.8,6.65))
    # Compact Type 271 lantern, separate compass and mast/radar fittings.
    cyl('radar-lantern.base',(3.1,0,7.0),1.03,.7,materials['naval'])
    cyl('radar-lantern.glass',(3.1,0,7.85),.98,1.1,materials['glass'],vertices=12)
    cyl('radar-lantern.roof',(3.1,0,8.47),1.12,.18,materials['naval'],vertices=12,r2=.9)
    for i in range(12):
        a=i*math.tau/12;rod('radar-lantern.frame',(3.1+math.cos(a),math.sin(a),7.3),(3.1+math.cos(a),math.sin(a),8.4),.028,materials['naval'])
    cyl('compass.pedestal',(6.3,0,7.1),.2,.9,materials['edge'])
    cyl('compass.binnacle',(6.3,0,7.65),.37,.3,materials['bronze'])
    mast=empty('foremast.pivot',(9.3,0,4.1))
    attach(rod('foremast.spar',(9.3,0,4.1),(8.7,0,15.3),.16,materials['naval'],r2=.07),mast)
    rod('foremast.yard',(8.8,-3,12.8),(8.8,3,12.8),.06,materials['edge'])
    for side in [-1,1]:
        rod('foremast.shroud',(8.9,0,12.5),(12.2,side*3.9,4.2),.017,materials['edge'],vertices=6)
        rod('foremast.halyard',(8.8,side*2.8,12.8),(7.3,side*3,6.6),.012,materials['rope'],vertices=6)
    for y in [-.65,0,.65]:
        rod('mast-radar.aerial',(8.7,y,15),(8.7,y,16.1),.024,materials['edge'])
    rod('mast-radar.frame',(8.7,-.7,15.5),(8.7,.7,15.5),.023,materials['edge'])
    # Hedgehog cradle and 24 individually visible projectiles: display only.
    box('hedgehog.base',(13.8,1.5,4.5),(2.0,1.7,.5),materials['naval'])
    for row in range(4):
        for column in range(6):
            x,y=13.2+row*.32,.88+column*.25
            rod('hedgehog.projectile',(x,y,4.7),(x+.33,y,5.5),.065,materials['edge'],r2=.095)
    # Two stern racks, four throwers, ready-use depth-charge stowage.
    for side in [-1,1]:
        for y in [side*1.3,side*2.2]:rod('depth-racks.rail',(-30,y,2.0),(-23,y,2.45),.06,materials['edge'])
        for x in [-28.8,-27.7,-26.6,-25.5,-24.4]:
            rod('depth-racks.charge',(x,side*1.75-.43,2.5),(x,side*1.75+.43,2.5),.26,materials['naval'],vertices=16)
        for x in [-18.5,-22]:
            cyl('depth-throwers.pedestal',(x,side*3.5,deck(x)+.42),.24,.8,materials['edge'])
            rod('depth-throwers.spigot',(x,side*3.5,deck(x)+.5),(x,side*4.3,deck(x)+1.2),.10,materials['edge'])
            rod('depth-throwers.charge',(x-.42,side*4.1,deck(x)+1.25),(x+.42,side*4.1,deck(x)+1.25),.27,materials['naval'],vertices=16)
    for x in [-18,-20]:
        for y in [-1.8,1.8]:rod('depth-stowage.charge',(x,y-.45,deck(x)+.32),(x,y+.45,deck(x)+.32),.26,materials['naval'])

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
px = -length*.445
pz = -hull['draft']*.69
radius = 1.1 if flower else 2.55
rod('shaft-exterior.shaft',(px+length*.10,0,pz),(px,0,pz),.11 if flower else .2,materials['edge'])
prop = empty('propeller-main.pivot',(px,0,pz))
attach(rod('propeller-main.hub',(px+.5,0,pz),(px-.5,0,pz),.23 if flower else .4,materials['bronze'],r2=.10),prop)
for i in range(4):
    a=i*math.tau/4
    vv=[(px+dx,math.cos(a+angle)*r,pz+math.sin(a+angle)*r) for r,angle,dx in [(radius*.15,-.2,0),(radius*.8,-.2,.12),(radius,.12,0),(radius*.72,.48,-.18),(radius*.3,.65,-.13)]]
    obj=mesh('propeller-main.blade',vv,[tuple(range(5))],materials['bronze'])
    mod=obj.modifiers.new('Blade thickness','SOLIDIFY');mod.thickness=.06
    attach(obj,prop)
rudder=empty('rudder-main.pivot',(px-length*.022,0,pz+.6))
attach(box('rudder-main.blade',(px-length*.025,0,pz+.2),(length*.026,.15,radius*1.8),materials['underwater'],bev=.05),rudder)

for mount in definition['mounts']:
    create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deck)
    if mount['partId']=='bl-4in-mk9-single':
        yaw=bpy.data.objects.get(mount['id']+'.yaw')
        # Open-backed shield belongs to yaw; barrel/trunnion/recoil remain free.
        for name,loc,dim in [('front-left',(.85,-.83,1.28),(.07,.86,1.7)),('front-right',(.85,.83,1.28),(.07,.86,1.7)),('roof',(.1,0,2.14),(1.6,2.6,.06)),('port',(-.05,1.28,1.27),(1.8,.06,1.7)),('starboard',(-.05,-1.28,1.27),(1.8,.06,1.7))]:
            obj=box(mount['id']+'.shield-'+name,loc,dim,materials['naval'],bev=0)
            obj.parent=yaw;obj['assemblyId']=mount['id']

scene['definitionHash']=definition['contentHash']
scene['originalRecipe']='convoy-geometry-v1'
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))

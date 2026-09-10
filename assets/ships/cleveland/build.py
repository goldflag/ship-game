"""Original Cleveland hull loft. Reference geometry is never an authoring input."""
import bpy
import math
from mathutils import Vector
import json
import os
import sys
from array import array
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
from blender_fidelity import authored_hull, authored_structure
sys.path.insert(0, str(ROOT / "assets/parts"))
from library import create_mount
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
OUT = Path(os.environ['SHIP_OUTPUT'])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
collection = bpy.data.collections.new('Cleveland hull and decks')
scene.collection.children.link(collection)
def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .78
    return m
naval = material('Cleveland gray blue', (.075, .12, .15))
red = material('Cleveland antifouling', (.14, .043, .023))
boot = material('Cleveland boot topping', (.012, .019, .017))
deck = material('Cleveland dark deck', (.025, .043, .055))
def mesh(name, vertices, faces, mat, col, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    col.objects.link(obj)
    if mat: data.materials.append(mat)
    for p in data.polygons: p.use_smooth = smooth
    return obj
h = D['hull']
obj = authored_hull(h, mesh, collection, [naval, red, boot], boot=True)
hull_object = obj
obj.data.materials.append(deck)
for p in obj.data.polygons:
    if p.normal.z > .95 and p.center.z > 0: p.material_index = 3
def cyl(name,loc,radius,depth,mat,col,vertices=32,r2=None):
    n=vertices
    vv=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in [(radius,-depth/2),(radius if r2 is None else r2,depth/2)] for i in range(n)]
    ff=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    ob=mesh(name,vv,ff,mat,col,True);ob.location=loc
    ob.data.polygons[0].use_smooth=False;ob.data.polygons[1].use_smooth=False
    return ob
def rod(name,a,b,r,mat,col,r2=None,vertices=12):
    a,b=Vector(a),Vector(b);ob=cyl(name,(a+b)/2,r,(b-a).length,mat,col,vertices,r2)
    ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return ob
def box(name,loc,dim,mat,col,bev=0):
    vv=[(x*dim[0]/2,y*dim[1]/2,z*dim[2]/2) for x,y,z in [(-1,-1,-1),(-1,1,-1),(1,1,-1),(1,-1,-1),(-1,-1,1),(-1,1,1),(1,1,1),(1,-1,1)]]
    ob=mesh(name,vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,col);ob.location=loc;return ob
def deck_height(x):
    station=x+h['length']/2
    for (a,va),(b,vb) in zip(h['deckHeights'],h['deckHeights'][1:]):
        if a<=station<=b:return va+(vb-va)*(station-a)/(b-a)
    return h['deckHeights'][0][1]
materials=dict(hullgray=naval,glass=material("Cleveland optics",(.025,.07,.09)),bronze=material("Cleveland brass",(.32,.23,.09)),naval=naval,roof=deck,edge=boot,dark=boot,canvas=material('Cleveland gun canvas',(.075,.065,.055)))
materials['antifouling']=red
helpers=dict(mesh=mesh,cyl=cyl,rod=rod,box=box)
for structure in D.get('structures',[]):
    obj=authored_structure(structure,mesh,materials,collection)
    obj.data.materials.append(deck)
    for face in obj.data.polygons:
        if structure['id'].endswith('-funnel'):
            face.use_smooth=abs(face.normal.z)<.8
        elif face.normal.z>.8:face.material_index=1
# Original oval uptake jackets with measured rake and sloping open caps.
for name,x,bottom,top in [('forward-funnel',5.55,8.27,22.35),('after-funnel',-6.5,8.27,22.0)]:
    n=40;rake=-.094*(top-bottom)
    structure=next(s for s in D['structures'] if s['id']==name)
    vv=[(-z,-x,y) for x,y,z in structure['surface']['vertices']]
    throat=mesh(name+'.throat',vv[3*n:],[tuple(range(n))],boot,collection);throat['assemblyId']=name
    for z in [bottom+3,bottom+6,top-.3]:
        shift=-.094*(z-bottom)
        for i in range(n):
            a=i*math.tau/n;b=(i+1)*math.tau/n
            tilt=.47 if z>top-1 else 0
            ob=rod(name+'.band',(x+shift+1.9*math.cos(a),1.65*math.sin(a),z+tilt*math.cos(a)),(x+shift+1.9*math.cos(b),1.65*math.sin(b),z+tilt*math.cos(b)),.045,boot,collection,vertices=8);ob['assemblyId']=name
    for side in [-1,1]:
        rod(name+'.steam pipe',(x+.8,side*1.48,bottom),(x+rake+.8,side*1.48,top-.7),.085,naval,collection,vertices=10)

def inside_footprint(x,y,poly):
    inside=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside

for mount in D['mounts']:
    x,y,z=-mount['position'][2],-mount['position'][0],mount['position'][1]
    support=deck_height(x)
    for structure in D.get('structures',[]):
        roof=structure['baseY']+structure['height']
        if roof<=z+.08 and inside_footprint(-y,-x,structure['footprint']):support=max(support,roof)
    radius=mount['weapon']['barbetteRadius']
    if z>support+.02:
        base=cyl(mount['id']+'.barbette',(x,y,(support+z)/2),radius,z-support,naval,collection,48)
        base['assemblyId']=mount['id']
    # Elevated wing batteries stand on plated sponsons with diagonal knees.
    if mount['id'].startswith(('aa-','secondary-')) and z>support+.6:
        platform_radius=max(radius+.25,1.85 if mount['weapon']['caliberM']>.03 else .85)
        plate=cyl(mount['id']+'.platform',(x,y,z-.10),platform_radius,.20,deck,collection,32)
        plate['assemblyId']=mount['id']
        for dx,dy in [(platform_radius*.8,0),(-platform_radius*.8,0),(0,platform_radius*.8),(0,-platform_radius*.8)]:
            ob=rod(mount['id']+'.platform knee',(x+dx,y+dy,z-.2),(x,y,max(support,z-1.8)),.10,naval,collection,vertices=8)
            ob['assemblyId']=mount['id']
    create_mount(mount,collection,helpers,materials)
sys.path.insert(0,str(Path(__file__).parent))
from fittings import build_fittings
build_fittings(D,helpers,materials,collection,deck_height)
# Original baked paint, independently generated for each side. Packed pixels and
# explicit UVs preserve the weathered finish in the published glTF material.
width,height=2048,256;side_width=width//2;pixels=array('f')
def srgb(linear):return 12.92*linear if linear<=.0031308 else 1.055*linear**(1/2.4)-.055
low,span=-h['draft'],h['draft']+max(p[1] for p in h['deckHeights'])
def noise(x,y,seed):
    ix,iy=math.floor(x),math.floor(y);tx,ty=x-ix,y-iy
    tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty)
    def value(a,b):return (math.sin(a*127.1+b*311.7+seed*74.7)*43758.5453)%1
    return (value(ix,iy)*(1-tx)+value(ix+1,iy)*tx)*(1-ty)+(value(ix,iy+1)*(1-tx)+value(ix+1,iy+1)*tx)*ty
for j in range(height):
    z=low+j/(height-1)*span
    for i in range(width):
        side=i//side_width;u=(i%side_width)/(side_width-1);x=(u-.5)*h['length']
        base=(.14,.043,.023) if z < -1.1 else (.012,.019,.017) if z < -.25 else (.075,.12,.15)
        grain=(math.sin(i*12.99+j*78.233)*43758.5453)%1
        patch=(noise(x*.23,z*.65,side)-.5)*.7+(noise(x*.71,z*1.4,side+7)-.5)*.3
        panel=.995+.008*math.sin(math.floor((x+h['length']/2)/3.8)*2.91+math.floor(z/.9)*1.63)
        streak=max(0,(noise(x*2.7,0,side+12)-.68)/.32)**2*.012*max(0,1-abs(z-2.5)/5)
        tide=math.exp(-abs(z+.8)*2.4)
        pixels.extend([srgb(max(.003,min(1,c*panel*(1+.18*patch)+(grain-.5)*.006-streak+tide*t))) for c,t in zip(base,(.012,.018,.004))]+[1])
paint=bpy.data.images.new('Cleveland original hull paint',width=width,height=height,alpha=False)
paint.colorspace_settings.name='sRGB';paint.pixels.foreach_set(pixels);paint.pack()
paint_material=material('Cleveland weathered hull',(.075,.12,.15))
texture=paint_material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=paint;texture.extension='EXTEND'
paint_material.node_tree.links.new(texture.outputs['Color'],paint_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
for index,color in enumerate([naval.diffuse_color,red.diffuse_color,boot.diffuse_color]):
    painted=paint_material.copy();painted.diffuse_color=color;hull_object.data.materials[index]=painted
uv=hull_object.data.uv_layers.new(name='OriginalHullPaintUV')
for face in hull_object.data.polygons:
    side=0 if face.center.y>=0 else 1
    for loop_index in face.loop_indices:
        v=hull_object.data.vertices[hull_object.data.loops[loop_index].vertex_index].co
        # Half-texel inset prevents the two sides bleeding across the atlas seam.
        u=(side*side_width+.5+(v.x/h['length']+.5)*(side_width-1))/width
        uv.data[loop_index].uv=(u,(v.z-low)/span)
sys.path.insert(0,str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
scene['definitionHash'] = D['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))

"""Regression: actual shared gun recipe has a continuous mount at all poses.

Local Blender, no generated ship mutation. Tests every open catalog component,
including full recoil at the elevation limits, against physical mesh contact.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
from blender_open_guns import create_open_mount


def mesh(name, vertices, faces, material, col, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); col.objects.link(obj)
    return obj


def box(name, loc, size, material, col):
    x,y,z = [n/2 for n in size]
    obj = mesh(name, [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
               [(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)], material, col)
    obj.location = loc
    return obj


def cyl(name, loc, radius, depth, material, col, vertices=24, r2=None):
    n=vertices; top=radius if r2 is None else r2
    pts=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for z,r in [(-depth/2,radius),(depth/2,top)] for i in range(n)]
    obj=mesh(name,pts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,col)
    obj.location=loc
    return obj


def rod(name,a,b,radius,material,col,r2=None,vertices=12):
    a,b=Vector(a),Vector(b)
    obj=cyl(name,(a+b)/2,radius,(b-a).length,material,col,vertices,r2)
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return obj


def detached(col, name):
    bpy.context.view_layer.update()
    objects=[o for o in col.objects if o.type=='MESH']
    vertices=[[o.matrix_world @ v.co for v in o.data.vertices] for o in objects]
    trees=[BVHTree.FromPolygons(v,[list(p.vertices) for p in o.data.polygons]) for o,v in zip(objects,vertices)]
    connected={next(i for i,o in enumerate(objects) if o.name==name+'.foundation')}
    remaining=set(range(len(objects)))-connected
    while remaining:
        added=set()
        for i in remaining:
            for j in connected:
                if trees[i].overlap(trees[j]) or any(trees[j].find_nearest(v,.025)[0] is not None for v in vertices[i]) or any(trees[i].find_nearest(v,.025)[0] is not None for v in vertices[j]):
                    added.add(i);break
        if not added:break
        connected.update(added);remaining-=added
    return [objects[i].name for i in sorted(remaining)]


results=[]
for spec in json.loads((ROOT/'assets/parts/guns.json').read_text())['parts']:
    if spec.get('mountingStyle','enclosed')=='enclosed':continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col=bpy.data.collections.new('Test mount');bpy.context.scene.collection.children.link(col)
    name=spec['id'];mount=dict(id=name,weapon=spec,position=[0,0,0],bearingDeg=0)
    create_open_mount(mount,col,dict(mesh=mesh,box=box,cyl=cyl,rod=rod),dict(naval=None,dark=None,edge=None))
    for angle in [spec['elevationMinDeg'],0,spec['elevationMaxDeg']]:
        for recoil in [0,spec['recoilM']]:
            for o in col.objects:
                if o.name.endswith('.elevation'):o.rotation_euler.y=-math.radians(angle)
                if o.name.endswith('.recoil'):o.location.x=-recoil
            missing=detached(col,name)
            results.append(dict(part=name,elevation=angle,recoil=recoil,detached=missing))
    print(name, 'PASS' if not any(r['detached'] for r in results if r['part']==name) else 'FAIL', flush=True)
out=ROOT/'assets/ships/attachment-audit/reports/open-mounts.json'
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(results,indent=2)+'\n')
failures=[r for r in results if r['detached']]
assert not failures, json.dumps(failures[:3])
print('All', len(results), 'open-mount poses have continuous physical support.')

"""Write CPU rail and aviation-fitting surfaces from original shared recipes.

Run with Blender Python, then sync_gun_clearance.ts. No scene or generated mesh
is read; these are the same recipe primitives that render the fitted metal.
"""
import bpy, json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from deck_rails import create as create_rails
from casemate_belt import openings
from aviation_fittings import create as create_aviation
from capstans import create as create_capstan
from weather_deck import height as weather_height, geometry as weather_geometry, prepare_mesh as prepare_weather_mesh
from aft_aa_seats import create as create_aft_aa_seats
from sync_galleries import rod as collect_rod, mesh, write_structures

path = Path(__file__).resolve().parent.parent/'blueprint.json'
b = json.loads(path.read_text())
h = b['hull']
def interp(table, station):
    for (a, u), (c, v) in zip(table, table[1:]):
        if a <= station <= c:
            return u+(v-u)*(station-a)/(c-a)
    return table[0][1] if station < table[0][0] else table[-1][1]

def rail_rod(name, a, c, *args, **kwargs):
    side = 'port' if a[1] > 0 else 'starboard'
    end = 'forward' if a[0] >= 53 else 'aft'
    collect_rod(f'deck-rails-{side}-{end}', a, c, *args, **kwargs)

def box(name, center, size, *args, **kwargs):
    x, y, z = center
    a, c, d = (v/2 for v in size)
    vertices = [(x+u*a, y+v*c, z+w*d) for w in [-1,1] for v in [-1,1] for u in [-1,1]]
    faces = [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
    mesh(name, vertices, faces)

def cyl(name, loc, radius, depth, *args, vertices=32, r2=None):
    r2 = radius if r2 is None else r2
    points = [(loc[0]+r*math.cos(i*math.tau/vertices),
               loc[1]+r*math.sin(i*math.tau/vertices), loc[2]+z)
              for z, r in [(-depth/2, radius), (depth/2, r2)] for i in range(vertices)]
    faces = [(i, (i+1)%vertices, vertices+(i+1)%vertices, vertices+i) for i in range(vertices)]
    faces += [tuple(reversed(range(vertices))), tuple(range(vertices,2*vertices))]
    mesh(name, points, faces)

mats = dict(naval=None, edge=None, canvas=None)
create_rails(rail_rod, mats,
             lambda x: interp(h['deckHeights'], x+h['length']/2),
             lambda x: interp([(s['station'],s['points'][-1][0]) for s in h['sections']], x+h['length']/2),
             [outline for _, outline in openings(b['mounts'])])
plate = next(s for s in b['structures'] if s['id']=='aviation-deck')
create_aviation(dict(box=box, rod=collect_rod), mats, [(-z,-x) for x,z in plate['footprint']])
def capstan_helpers(group):
    return dict(cyl=lambda name, *a, **kw: cyl(group, *a, **kw),
                rod=lambda name, *a, **kw: collect_rod(group, *a, **kw))
for sign in [-1, 1]:
    create_capstan(capstan_helpers(f'wildcat-{sign}'), mats,
                   lambda x: weather_height(h, x, sign*3.1),
                   'ground-tackle.wildcat', 76, sign*3.1, .62, .48)
create_capstan(capstan_helpers('center-capstan'), mats,
               lambda x: weather_height(h, x, 0),
               'ground-tackle.center-capstan', 85, 0, .78, 1.12)
# Keep each installed seat/shield assembly as one disconnected surface.
create_aft_aa_seats(dict(
    mesh=lambda name, *a, **kw: mesh(name.split('.')[0], *a, **kw),
    cyl=lambda name, *a, **kw: cyl(name.split('.')[0], *a, **kw)), mats, h, b['mounts'])
# Apply the same original casemate cutters to the closed weather-deck skin.
# Temporary objects are constructed here; no generated scene is consumed.
vertices, faces = weather_geometry(h)
data = bpy.data.meshes.new('weather-contact');data.from_pydata(vertices, [], faces);data.update()
prepare_weather_mesh(data)
weather = bpy.data.objects.new('weather-contact', data);bpy.context.collection.objects.link(weather)
for mount, outline in openings(b['mounts']):
    n = len(outline)
    points = [(x,y,z) for z in (mount['position'][1]-.02, 7.46) for x,y in outline]
    triangles = [tuple(reversed(range(n))),tuple(range(n,n*2))]
    triangles += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    data = bpy.data.meshes.new('casemate-contact-cut');data.from_pydata(points, [], triangles);data.update()
    cutter = bpy.data.objects.new('casemate-contact-cut', data);bpy.context.collection.objects.link(cutter)
    bpy.context.view_layer.objects.active = weather
    mod = weather.modifiers.new('Authored casemate recess', 'BOOLEAN')
    mod.operation = 'DIFFERENCE';mod.solver = 'EXACT';mod.object = cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
# Blender tessellation preserves concave boundaries around the open wells.
weather.data.calc_loop_triangles()
mesh('weather-deck', [tuple(v.co) for v in weather.data.vertices],
     [tuple(t.vertices) for t in weather.data.loop_triangles])
bpy.data.objects.remove(weather, do_unlink=True)
write_structures(path, 'fixed-fitting-')

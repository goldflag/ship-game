"""Write CPU rail and aviation-fitting surfaces from original shared recipes.

Run with Blender Python, then sync_gun_clearance.ts. No scene or generated mesh
is read; these are the same recipe primitives that render the fitted metal.
"""
import json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from deck_rails import create as create_rails
from casemate_belt import openings
from aviation_fittings import create as create_aviation
from capstans import create as create_capstan
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
                   lambda x: interp(h['deckHeights'], x+h['length']/2),
                   'ground-tackle.wildcat', 76, sign*3.1, .62, .48)
create_capstan(capstan_helpers('center-capstan'), mats,
               lambda x: interp(h['deckHeights'], x+h['length']/2),
               'ground-tackle.center-capstan', 85, 0, .78, 1.12)
write_structures(path, 'fixed-fitting-')

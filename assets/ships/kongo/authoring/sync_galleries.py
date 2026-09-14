"""Write original fixed gallery metal to blueprint structures.

Run with Blender's Python for the same rod orientation math as the visual recipe.
This creates no scene objects and reads no generated or external geometry.
"""
import json, math, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from galleries import create

surfaces = {}

def mesh(name, vertices, faces, *args, **kwargs):
    suffixes = ('deck', 'column', 'knee', 'bracket', 'web', 'shield', 'pod',
                'deckhouse', 'diagonal', 'inner-leg')
    parts = name.rsplit('.', 1)
    key = parts[0] if parts[-1] in suffixes else name
    points, triangles = surfaces.setdefault(key, ([], []))
    offset = len(points)
    points.extend(tuple(p) for p in vertices)
    for face in faces:
        for i in range(1, len(face)-1):
            tri = (face[0], face[i], face[i+1])
            a, b, c = (Vector(vertices[j]) for j in tri)
            if (b-a).cross(c-a).length > 1e-8:
                triangles.append(tuple(offset+j for j in tri))

def prism(name, outline, z0, z1, *args):
    n = len(outline)
    points = [(x, y, z) for z in (z0, z1) for x, y in outline]
    faces = [(i, (i+1)%n, n+(i+1)%n, n+i) for i in range(n)]
    faces += [tuple(reversed(range(n))), tuple(range(n, n*2))]
    mesh(name, points, faces)

def rod(name, a, b, radius, *args, vertices=10, **kwargs):
    a, b = Vector(a), Vector(b)
    n = vertices
    rotation = (b-a).to_track_quat('Z', 'Y').to_matrix()
    # Apply the same rotation and origin as the original build's cylinder.
    center = (a+b)/2
    points = [center+rotation@Vector((radius*math.cos(i*math.tau/n),
                                    radius*math.sin(i*math.tau/n), z))
              for z in (-(b-a).length/2, (b-a).length/2) for i in range(n)]
    faces = [(i, (i+1)%n, n+(i+1)%n, n+i) for i in range(n)]
    faces += [tuple(reversed(range(n))), tuple(range(n, n*2))]
    mesh(name, points, faces)

def shield(name, outline, z, height=.8):
    for a, b in zip(outline, outline[1:]+[outline[0]]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        if length < 1e-8:
            continue
        nx, ny = -dy/length*.035, dx/length*.035
        prism(name, [(a[0]-nx, a[1]-ny), (b[0]-nx, b[1]-ny),
                     (b[0]+nx, b[1]+ny), (a[0]+nx, a[1]+ny)], z, z+height)

def oval(x, y, rx, ry, n=32):
    return [(x+rx*math.cos(i*math.tau/n), y+ry*math.sin(i*math.tau/n)) for i in range(n)]

def rect(x0, x1, y0, y1, c=.4):
    return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),
            (x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]

def write_structures(path, prefix):
    definition = json.loads(path.read_text())
    definition['structures'] = [s for s in definition['structures']
                                if not s['id'].startswith(prefix)]
    for name, (points, triangles) in surfaces.items():
        # Weld shared plate corners without changing the represented metal.
        vertices, remap, ids = [], [], {}
        for x, y, z in points:
            point = tuple(round(v, 8) for v in (-y, z, -x))
            if point not in ids:
                ids[point] = len(vertices)
                vertices.append(point)
            remap.append(ids[point])
        triangles = [tuple(remap[i] for i in t) for t in triangles]
        if len(vertices)>2048 or len(triangles)>4096:
            raise ValueError(f'{name}: gallery surface exceeds schema budget')
        xs, ys, zs = zip(*vertices)
        definition['structures'].append(dict(
            id=prefix+name.replace('.', '-'), name=name.replace('.', ' ').replace('-', ' '),
            footprint=[[min(xs),min(zs)],[max(xs),min(zs)],[max(xs),max(zs)],[min(xs),max(zs)]],
            baseY=min(ys), height=max(ys)-min(ys), material='naval',
            surface=dict(vertices=vertices, triangles=triangles)))
    path.write_text(json.dumps(definition, indent=2)+'\n')
    print(f'Synchronized {len(surfaces)} original {prefix} surfaces.')


if __name__ == '__main__':
    create(dict(mesh=mesh, prism=prism, rod=rod, shield=shield, oval=oval, rect=rect),
           dict(naval=None))
    write_structures(Path(__file__).resolve().parent.parent/'blueprint.json', 'fixed-gallery-')

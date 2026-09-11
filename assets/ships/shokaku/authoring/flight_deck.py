"""Original forward lift aperture, shared by deliberate blueprint regeneration.

Coordinates are runtime metres. Clip existing triangles so unrelated deck and
hangar faces retain their authored shape; only add the exposed slab edge.
"""
import json
from pathlib import Path


def partition_polygon(points, footprint):
    """Return polygon pieces outside a convex aperture and the inside piece."""
    area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(footprint, footprint[1:]+footprint[:1]))
    sign = 1 if area > 0 else -1
    outside = []
    for a,b in zip(footprint, footprint[1:]+footprint[:1]):
        if not points:
            break
        def distance(p):
            return sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]))
        inner, outer = [], []
        for p,q in zip(points, points[1:]+points[:1]):
            dp,dq = distance(p),distance(q)
            (inner if dp >= 0 else outer).append(p)
            if (dp >= 0) != (dq >= 0):
                t=dp/(dp-dq)
                hit=[p[i]+t*(q[i]-p[i]) for i in range(3)]
                inner.append(hit);outer.append(hit)
        if len(outer) >= 3:
            outside.append(outer)
        points=inner
    return outside, points


def prism_surface(structure):
    # Match the runtime structural_surfaces primitive exactly: wall triangles
    # first, then interleaved bottom/top ear-clipped caps. Triangle indices are
    # observable combat-contact identities even when the geometry is unchanged.
    shape=structure['footprint']; n=len(shape)
    vertices=[[x,y,z] for y in [structure['baseY'],structure['baseY']+structure['height']] for x,z in shape]
    triangles=[]
    for i in range(n):
        j=(i+1)%n;triangles.extend([[i,j,n+j],[i,n+j,n+i]])
    def cross(a,b,c):
        return (shape[b][0]-shape[a][0])*(shape[c][1]-shape[a][1])-(shape[b][1]-shape[a][1])*(shape[c][0]-shape[a][0])
    ids=list(range(n))
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(shape,shape[1:]+shape[:1]))<0:ids.reverse()
    while len(ids)>2:
        for i,b in enumerate(ids):
            a,c=ids[i-1],ids[(i+1)%len(ids)]
            if abs(cross(a,b,c))<1e-9:ids.pop(i);break
            if cross(a,b,c)<0 or any(p not in [a,b,c] and cross(a,b,p)>=-1e-9 and cross(b,c,p)>=-1e-9 and cross(c,a,p)>=-1e-9 for p in ids):continue
            triangles.extend([[a,b,c],[n+a,n+c,n+b]]);ids.pop(i);break
        else:raise ValueError('Structural footprint cannot be triangulated')
    return dict(vertices=vertices,triangles=triangles)


def cut_surface(surface, footprint, top_only=False):
    vertices=[];triangles=[];extra=[]
    def area2(points):
        a=points[0] if points else [0,0,0];total=0
        for b,c in zip(points[1:],points[2:]):
            u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
            total+=sum((u[(j+1)%3]*v[(j+2)%3]-u[(j+2)%3]*v[(j+1)%3])**2 for j in range(3))**.5
        return total
    def emit(points):
        start=len(vertices);vertices.extend(points)
        for i in range(1,len(points)-1):
            a,b,c=points[0],points[i],points[i+1]
            u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
            if sum((u[(j+1)%3]*v[(j+2)%3]-u[(j+2)%3]*v[(j+1)%3])**2 for j in range(3)) > 1e-16:
                triangles.append([start,start+i,start+i+1])
    ceiling=max(p[1] for p in surface['vertices'])
    for tri in surface['triangles']:
        first=len(triangles)
        points=[surface['vertices'][i] for i in tri]
        if top_only and any(abs(p[1]-ceiling)>1e-6 for p in points):
            emit(points)
        else:
            pieces,inside=partition_polygon(points,footprint)
            if area2(inside)<1e-9:emit(points)
            else:
                for piece in pieces:emit(piece)
        # Keep one fragment at the original triangle index; append additional
        # pieces only after every original face. Unaffected contacts keep IDs.
        if len(triangles)==first:raise ValueError('Aperture would remove an entire stable triangle')
        if len(triangles)>first+1:
            largest=max(range(first,len(triangles)),key=lambda i:area2([vertices[j] for j in triangles[i]]))
            triangles[first],triangles[largest]=triangles[largest],triangles[first]
        extra.extend(triangles[first+1:]);del triangles[first+1:]
    triangles.extend(extra)
    return dict(vertices=vertices,triangles=triangles)


def author_forward_aperture(blueprint):
    structures={s['id']:s for s in blueprint['structures']}
    shape=structures['elevator-forward']['footprint']
    deck=structures['flight-deck']
    center=[sum(p[i] for p in shape)/len(shape) for i in range(2)]
    def covers_center(triangle):
        points=[deck['surface']['vertices'][i] for i in triangle]
        a,b,c=points
        denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
        if abs(denominator)<1e-10:return False
        u=((b[2]-c[2])*(center[0]-c[0])+(c[0]-b[0])*(center[1]-c[2]))/denominator
        v=((c[2]-a[2])*(center[0]-c[0])+(a[0]-c[0])*(center[1]-c[2]))/denominator
        return min(u,v,1-u-v)>=-1e-9
    if not any(covers_center(t) for t in deck['surface']['triangles']):
        return
    deck['surface']=cut_surface(deck['surface'],shape)
    # These horizontal faces adjoin the flat forward deck; preserve its exact
    # octagonal platform outline and expose the existing 340 mm slab edge.
    vertices=deck['surface']['vertices'];triangles=deck['surface']['triangles']
    sign=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(shape,shape[1:]+shape[:1]))
    ring=shape if sign > 0 else list(reversed(shape))
    for a,b in zip(ring,ring[1:]+ring[:1]):
        n=len(vertices);vertices.extend([[a[0],14.41,a[1]],[b[0],14.41,b[1]],[b[0],14.75,b[1]],[a[0],14.75,a[1]]])
        triangles.extend([[n,n+1,n+2],[n,n+2,n+3]])
    casing=structures['upper-hangar']
    casing['surface']=cut_surface(casing.get('surface') or prism_surface(casing),shape,top_only=True)


if __name__ == '__main__':
    path=Path(__file__).resolve().parents[1]/'blueprint.json'
    blueprint=json.loads(path.read_text())
    author_forward_aperture(blueprint)
    path.write_text(json.dumps(blueprint,ensure_ascii=False,indent=2)+'\n')

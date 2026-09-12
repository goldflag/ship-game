"""Original weather-deck crown shared by rendering and fitted foundations."""

def interp(table, x):
    for (a, u), (b, v) in zip(table, table[1:]):
        if a <= x <= b:
            return u + (v-u)*(x-a)/(b-a)
    return table[0][1] if x < table[0][0] else table[-1][1]

def camber(x):
    return interp([(-110.5,.10),(-74,.15),(-33,.15),(-22,.10),(0,.10),(64,.10),(70,.285),(76,.33),(80,.22),
                   (86,.30),(94,.26),(101,.255),(109,.24),(109.5,0),(110.5,0)], x)

def height(hull, x, y=0):
    station = x + hull['length']/2
    edge = interp(hull['deckHeights'], station)
    width = interp([(s['station'],s['points'][-1][0]) for s in hull['sections']], station)
    return edge + .02 + (camber(x)-.02)*crown_fraction(x, y/width) if width > .001 else edge+.02


def crown_fraction(x, lateral_fraction):
    # The aft weather deck has a broad, nearly level middle and sloping wings.
    # Blend back to the existing foredeck section rather than adding a seam.
    plateau = interp([(-110.5, 0), (-74, .5), (-33, .5), (-22, 0)], x)
    return min(1, max(0, (1-abs(lateral_fraction))/max(.001, 1-plateau)))


def geometry(hull):
    vertices = []
    for section in hull['sections']:
        x = section['station']-hull['length']/2
        width, edge = section['points'][-1]
        plateau = interp([(-110.5, 0), (-74, .5), (-33, .5), (-22, 0)], x)
        shoulder = plateau if plateau > .001 else .5
        for fraction in (-1, -shoulder, 0, shoulder, 1):
            z = edge+.02+((camber(x)-.02)*crown_fraction(x, fraction) if width > .001 else 0)
            vertices.append((x, fraction*width, z))
    faces = [(i*5+j, (i+1)*5+j, (i+1)*5+j+1, i*5+j+1)
             for i in range(len(hull['sections'])-1) for j in range(4)]
    count = len(vertices)
    edges = {}
    for face in faces:
        for a, b in zip(face, face[1:]+face[:1]):
            key = tuple(sorted((a, b)))
            if key in edges:
                del edges[key]
            else:
                edges[key] = (a, b)
    faces += [tuple(i+count for i in reversed(face)) for face in faces[:]]
    faces += [(b, a, a+count, b+count) for a, b in edges.values()]
    vertices += [(x, y, z-.04) for x, y, z in vertices[:]]
    return vertices, faces


def prepare_mesh(data):
    """Close collapsed end sections and triangulate warped wings before cutting."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.000001)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if any(not edge.is_manifold for edge in bm.edges):
        raise ValueError('Weather-deck skin must be closed before cutting wells')
    bm.to_mesh(data)
    bm.free()

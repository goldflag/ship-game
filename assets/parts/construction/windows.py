"""Original closed naval window fittings. Back plane X=0, outward +X in Blender.

Opaque optics sit over the intact wall; these are not openings or interiors.
Generic proportions and mass estimates do not assert a historical variant.
"""
import math
from geometry import Model


def outline(width, height, radius, steps=8):
    points = []
    for cy, cz, angle in [(width/2-radius, height/2-radius, 0),
                          (-width/2+radius, height/2-radius, 90),
                          (-width/2+radius, -height/2+radius, 180),
                          (width/2-radius, -height/2+radius, 270)]:
        for i in range(steps+1):
            a = math.radians(angle+i*90/steps)
            points.append((cy+radius*math.cos(a), cz+radius*math.sin(a)))
    return points


def create_window(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    width, height, _ = part['size']
    round_port = part.get('wallMount') == 'porthole'
    radius = min(width, height)/2 if round_port else .13 if 'rounded' in part['id'] else .025
    outer = outline(width, height, radius)
    inner = outline(width-.12, height-.12, max(.008, radius-.06))
    n = len(outer)
    # Solid closed mounting flange behind the recessed glass.
    verts = [(x,y,z) for x in [0,.025] for y,z in outer]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]
    m.mesh('mounting-flange', verts, faces)
    # Raised continuous frame; a shallow recess gives the glazing real depth.
    verts = [(x,y,z) for shape,x in [(outer,.025),(outer,.07),(inner,.07),(inner,.025)] for y,z in shape]
    faces = [(k*n+i,k*n+(i+1)%n,((k+1)%4)*n+(i+1)%n,((k+1)%4)*n+i) for k in range(4) for i in range(n)]
    m.mesh('raised-frame', verts, faces)
    m.mesh('dark-gasket', [(.045,y,z) for y,z in inner], [tuple(range(n))], mat='dark')
    glass = [(y*.96,z*.96) for y,z in inner]
    m.mesh('closed-glazing', [(.047,y,z) for y,z in glass], [tuple(range(n))], mat='glass')
    # Visible mounting screws seated on the frame.
    for i in range(8 if round_port else 4):
        a = math.tau*i/8 if round_port else math.pi/4+math.pi*i/2
        y = (width/2-.028)*math.cos(a) if round_port else (width/2-max(.032,radius))*(1 if math.cos(a)>0 else -1)
        z = (height/2-.028)*math.sin(a) if round_port else (height/2-.032)*(1 if math.sin(a)>0 else -1)
        m.rod('frame-screw',(.065,y,z),(.076,y,z),.009,mat='bright')
    return m.root

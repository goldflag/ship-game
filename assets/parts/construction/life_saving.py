"""Original generic stowed lifesaving gear for repeated wall placement.

Rear brackets sit on X=0, outward is +X (runtime -Z). Eight-sided float
sections and four-sided grab lines keep every complete assembly below 1,000
triangles. No subdivision, small fasteners, textures or operating mechanisms.
"""
import math
from mathutils import Vector
from superstructure_fittings import Fitting


def loop(m, name, outline, depth, radius, role, sides=8, bands=()):
    """Closed planar sweep; bands are material faces, not additional geometry."""
    points = [Vector((0, y, z)) for y, z in outline]
    vertices = []
    for i, p in enumerate(points):
        tangent = (points[(i+1) % len(points)] - points[i-1]).normalized()
        outward = Vector((0, tangent.z, -tangent.y))
        for j in range(sides):
            angle = j * math.tau / sides
            vertices.append(p + Vector((depth + radius*math.sin(angle), 0, 0))
                            + outward * (radius*math.cos(angle)))
    for band in [False, True]:
        faces = [(i*sides+j, i*sides+(j+1) % sides,
                  ((i+1) % len(points))*sides+(j+1) % sides,
                  ((i+1) % len(points))*sides+j)
                 for i in range(len(points)) if (i in bands) == band
                 for j in range(sides)]
        if faces:
            m.mesh(name, vertices, faces, 'naval' if band else role)


def rack(m, width, height, depth):
    """Two wall rails, lower saddles and front lips physically retain the float."""
    for y in [-width*.28, width*.28]:
        m.box('wall-rail', (.02, y, 0), (.04, .06, height*.80), 'painted-edge')
        m.box('saddle', (depth/2, y, -height*.40), (depth, .07, .045), 'naval')
        m.box('retaining-lip', (depth-.018, y, -height*.40+.04), (.036, .07, .10), 'naval')


def create_life_ring(part, col, helpers, materials):
    m = Fitting(col, helpers, materials, wall=True)
    n, radius, section, depth = 24, .30, .085, .13
    outline = [(radius*math.cos(i*math.tau/n), radius*math.sin(i*math.tau/n)) for i in range(n)]
    loop(m, 'buoy', outline, depth, section, 'canvas', bands=(0, 6, 12, 18))
    # A loose perimeter grab line touches the float at four material bands.
    rope = [((.385 if i % 6 == 0 else .408)*math.cos(i*math.tau/n),
             (.385 if i % 6 == 0 else .408)*math.sin(i*math.tau/n)) for i in range(n)]
    loop(m, 'grab-line', rope, depth, .009, 'rope', sides=4)
    rack(m, .58, .78, .232)
    m.box('upper-clip', (.09, 0, .348), (.18, .055, .045), 'naval')
    return m.finish()


def create_life_raft(part, col, helpers, materials):
    m = Fitting(col, helpers, materials, wall=True)
    rectangular = part['id'].endswith('rectangular')
    width, height = (1.52, 2.20) if rectangular else (1.20, 1.85)
    section, depth = .13, .19
    # A capsule and a rounded rectangle are distinct silhouettes at game scale.
    corner = .26 if rectangular else width/2-section
    cy, cz = width/2-section-corner, height/2-section-corner
    outline = [(sy*cy+corner*math.cos(a), sz*cz+corner*math.sin(a))
               for sy, sz, start in [(1, 1, 0), (-1, 1, math.pi/2),
                                     (-1, -1, math.pi), (1, -1, 3*math.pi/2)]
               for a in [start+i*math.pi/8 for i in range(4)]]
    loop(m, 'float', outline, depth, section, 'canvas', bands=(0, 4, 8, 12))
    # A simple perimeter rope and wooden grating, with no dense woven net.
    rope = [(y*(1+section/(width/2-section)), z*(1+section/(height/2-section))) for y, z in outline]
    loop(m, 'grab-line', rope, depth, .012, 'rope', sides=4)
    inner_width = width-4*section
    for y in [-inner_width*.32, inner_width*.32]:
        m.box('grating-rail', (.12, y, 0), (.045, .055, height-.40), 'wood')
    for i in range(7 if rectangular else 5):
        z = (i-(3 if rectangular else 2))*.23
        m.box('grating-slat', (.151, 0, z), (.035, inner_width+.05, .085), 'wood')
    rack(m, width, height, .35)
    # Broad flat straps wrap from the wall rails across the stowed float.
    for z in [-height*.24, height*.24]:
        m.box('retaining-strap', (.328, 0, z), (.024, width-.13, .045), 'naval')
        for y in [-(width-.13)/2, (width-.13)/2]:
            m.box('strap-return', (.17, y, z), (.34, .03, .045), 'naval')
    return m.finish()

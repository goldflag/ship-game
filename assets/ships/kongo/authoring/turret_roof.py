"""Original carried AA platforms, reconstructed from the approved turret views.

Coordinates are local to the main turret yaw: +X forward, +Y port, +Z up.
The split deck preserves the two pointed gun bays and their central setback.
Plate thickness is provisional game calibration, not a historical armor claim.
"""
import math

FLOOR = 6.33
BOTTOM = 6.24
SHIELD_TOP = 7.06
HALF_DECK = [(-3.75, 0), (-3.75, 3.50), (-.55, 3.50),
             (.15, 1.94), (-.40, 0)]


def deck_halves():
    return [[(x, sign*y) for x, y in HALF_DECK] for sign in (-1, 1)]


def panels():
    """Convex plate faces consumed by both the render and CPU armor authors."""
    result = []
    for side, outline in zip(('starboard', 'port'), deck_halves()):
        # Triangles avoid a collinear seam at the two half-decks' common edge.
        for i in range(1, len(outline)-1):
            result.append((f'deck-{side}-{i}',
                           [(*outline[j], FLOOR) for j in (0, i, i+1)]))
        # The rear plate and the three outside cheek/side plates enclose a bay.
        for i, (a, b) in enumerate(zip(outline, outline[1:])):
            result.append((f'shield-{side}-{i}',
                           [(*a, FLOOR), (*b, FLOOR),
                            (*b, SHIELD_TOP), (*a, SHIELD_TOP)]))
    return result


def create(name, helpers, mats):
    prism, mesh, box, rod = (helpers[k] for k in ('prism', 'mesh', 'box', 'rod'))
    for side, outline in zip(('starboard', 'port'), deck_halves()):
        prism(name+'.aa-roof-platform-'+side, outline, BOTTOM, FLOOR)
    for label, face in panels():
        if not label.startswith('shield-'):
            continue
        a, b = face[:2]
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        # Closed 8 mm plates; the top capping and upright seams remain visible.
        nx, ny = -dy/length*.004, dx/length*.004
        vertices = [(x+nx, y+ny, z) for x, y, z in face]
        vertices += [(x-nx, y-ny, z) for x, y, z in face]
        mesh(name+'.aa-roof-'+label, vertices,
             [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
              (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], mats['naval'])
        rod(name+'.aa-roof-cap', (*a[:2], SHIELD_TOP),
            (*b[:2], SHIELD_TOP), .018, mats['edge'], vertices=8)
    # Thin plate columns seat on the sloped gunhouse roof and meet the floor.
    for x in (-3.10, -.85):
        roof = 4.8+(3.35-x)/10.25*1.2
        for y in (-2.7, 0, 2.7):
            box(name+'.aa-roof-column', (x, y, (roof+BOTTOM)/2),
                (.18, .10, BOTTOM-roof+.025), mats['naval'])
    # Rolled canvas rests against the side shields with three retaining bands.
    for side in (-1, 1):
        rod(name+'.aa-roof-canvas', (-3.15, side*3.53, 6.94),
            (-1.25, side*3.53, 6.94), .105, mats['canvas'], vertices=12)
        for x in (-3.05, -2.20, -1.35):
            box(name+'.aa-roof-canvas-strap', (x, side*3.535, 6.94),
                (.035, .22, .23), mats['edge'])


def clearance_surface():
    """Original installation contact proxy from the same primitive recipe.

    Circumscribed eight-sided rods conservatively contain the round canvas and
    rail caps. These contacts provide no armor protection or historical stops.
    """
    vertices, triangles = [], []
    def mesh(_name, points, faces, *_args, **_kwargs):
        offset = len(vertices)
        vertices.extend(points)
        triangles.extend([offset+f[0], offset+f[i], offset+f[i+1]]
                         for f in faces for i in range(1, len(f)-1))
    def prism(name, outline, z0, z1, *_args):
        n = len(outline)
        mesh(name, [(x,y,z) for z in (z0,z1) for x,y in outline],
             [tuple(reversed(range(n))), tuple(range(n,2*n))]+
             [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
    def box(name, center, size, *_args):
        x,y,z=center;dx,dy,dz=[v/2 for v in size]
        prism(name, [(x-dx,y-dy),(x+dx,y-dy),(x+dx,y+dy),(x-dx,y+dy)], z-dz,z+dz)
    def rod(name, a, b, radius, *_args, **_kwargs):
        direction=[b[i]-a[i] for i in range(3)]
        length=math.hypot(*direction);axis=[v/length for v in direction]
        # All recipe rods are horizontal; use vertical as the first radial axis.
        u=(0,0,1);v=(axis[1],-axis[0],0)
        n=8;r=radius/math.cos(math.pi/n)
        points=[tuple(p[j]+r*(u[j]*math.cos(i*math.tau/n)+v[j]*math.sin(i*math.tau/n)) for j in range(3)) for p in (a,b) for i in range(n)]
        mesh(name, points, [tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
    create('clearance',dict(mesh=mesh,prism=prism,box=box,rod=rod),dict(naval=None,edge=None,canvas=None))
    return dict(vertices=vertices,triangles=triangles)

"""Simple original boxes and racks based on the user's model screenshots.

Wall datum: X=0, outward +X. Deck datum: Z=0, front +X. Dimensions are
metres. Plain solids, flat panels and low-sided curves keep these repeated
background props inexpensive. Static geometry is batched by material role.
"""
import math
from mathutils import Vector
from geometry import Model


class Fitting(Model):
    def __init__(self, col, helpers, materials, wall=False):
        super().__init__(col, helpers, materials)
        self.groups = {}
        if wall:
            self.root['wallRelief'] = True

    def mesh(self, name, vertices, faces, mat='naval'):
        vs, fs = self.groups.setdefault(mat, ([], []))
        start = len(vs)
        vs.extend(vertices)
        fs.extend(tuple(start + i for i in face) for face in faces)

    def box(self, name, loc, size, mat='naval'):
        x, y, z = loc
        a, b, c = (v / 2 for v in size)
        self.mesh(name, [(x+dx, y+dy, z+dz) for dz in [-c, c]
                         for dx, dy in [(-a, -b), (a, -b), (a, b), (-a, b)]],
                  [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                   (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)

    def wedge(self, name, back, front, y, width, bottom, rear_top, front_top, mat='naval'):
        self.mesh(name, [(x, y+dy, z) for x, z in
                         [(back, bottom), (front, bottom), (front, front_top), (back, rear_top)]
                         for dy in [-width/2, width/2]],
                  [(0, 2, 4, 6), (1, 7, 5, 3), (0, 1, 3, 2),
                   (2, 3, 5, 4), (4, 5, 7, 6), (6, 7, 1, 0)], mat)

    def tube(self, name, points, radius, mat='canvas', closed=False):
        # Four-sided cross-section, with shared vertices at each bend.
        points = [Vector(p) for p in points]
        vertices = []
        for i, p in enumerate(points):
            tangent = (points[(i+1) % len(points)] - points[i-1]).normalized() if closed else (
                points[min(i+1, len(points)-1)] - points[max(i-1, 0)]).normalized()
            axis = Vector((1, 0, 0))
            u = tangent.cross(axis).normalized()
            v = tangent.cross(u).normalized()
            vertices.extend(p + radius * q for q in [u, v, -u, -v])
        spans = len(points) if closed else len(points)-1
        faces = [(i*4+j, i*4+(j+1)%4, ((i+1)%len(points))*4+(j+1)%4,
                  ((i+1)%len(points))*4+j) for i in range(spans) for j in range(4)]
        if not closed:
            faces += [(3, 2, 1, 0), tuple(range((len(points)-1)*4, len(points)*4))]
        self.mesh(name, vertices, faces, mat)

    def finish(self):
        for role, (vertices, faces) in self.groups.items():
            super().mesh(role, vertices, faces, mat=role)
        return self.root


def door(m, x, y, bottom, width, height, latch_side=1):
    """One plain door, two block hinges and a short rectangular handle."""
    z = bottom + height/2
    m.box('door', (x+.007, y, z), (.016, width, height))
    for dz in [-height*.31, height*.31]:
        m.box('hinge', (x+.016, y-latch_side*width*.47, z+dz), (.024, .024, .080), 'painted-edge')
    m.box('handle', (x+.027, y+latch_side*width*.34, z), (.033, .020, .095), 'dark')


def create_cabinet(part, col, helpers, materials):
    m = Fitting(col, helpers, materials, wall=True)
    paired = part['id'].endswith('-pair')
    w, h, depth = (.46, .56, .18) if paired else (.55, .76, .23)
    for y in [-.265, .265] if paired else [0]:
        m.box('body', (depth/2, y, 0), (depth, w, h), 'painted-edge')
        door(m, depth, y, -h/2+.020, w-.035, h-.040)
        m.wedge('lid', 0, depth+.055, y, w+.060, h/2-.012, h/2+.040, h/2+.004)
    return m.finish()


def create_cylinder_rack(part, col, helpers, materials):
    m = Fitting(col, helpers, materials, wall=True)
    for y in [-.43, .43]:
        m.box('upright', (.020, y, 0), (.040, .07, 1.28))
    m.box('shelf', (.18, 0, -.603), (.36, 1.03, .034))
    m.box('front-strap', (.303, 0, .22), (.030, .99, .065), 'painted-edge')
    for y in [-.48, .48]:
        m.box('strap-return', (.16, y, .22), (.32, .030, .065), 'painted-edge')
    for y in [-.36, -.12, .12, .36]:
        # Eight sides and one shoulder taper; the base sits on the shelf.
        profile = [(-.586, .103), (.405, .103), (.535, .035)]
        n = 8
        m.mesh('bottle', [(.186+r*math.cos(i*math.tau/n), y+r*math.sin(i*math.tau/n), z)
                          for z, r in profile for i in range(n)],
               [(k*n+i, k*n+(i+1)%n, (k+1)*n+(i+1)%n, (k+1)*n+i)
                for k in range(2) for i in range(n)] +
               [tuple(reversed(range(n))), tuple(range(2*n, 3*n))])
        m.box('valve', (.186, y, .565), (.045, .045, .062), 'dark')
    return m.finish()


def create_hose_rack(part, col, helpers, materials):
    m = Fitting(col, helpers, materials, wall=True)
    m.box('backplate', (.015, 0, .22), (.030, .51, .20))
    m.box('saddle', (.13, 0, .213), (.26, .43, .032))
    m.box('keeper', (.247, 0, .249), (.026, .46, .065), 'painted-edge')
    for x in [.09, .15]:
        m.tube('coil', [(x, .30*math.cos(i*math.tau/12), -.105+.30*math.sin(i*math.tau/12))
                        for i in range(12)], .030, closed=True)
    m.tube('tail', [(.15, .15, -.365), (.15, .31, -.40), (.15, .40, -.60)], .030)
    m.tube('nozzle', [(.15, .40, -.60), (.15, .57, -.735)], .035, 'bright')
    return m.finish()


def create_deck_box(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    w, h, d = part['size']
    variant = part['id'].removeprefix('generic-deck-')
    front, back = d/2-.055, -d/2+.025
    m.box('plinth', (0, 0, .025), (d-.045, w-.045, .050), 'painted-edge')
    if variant in ['locker-wide', 'locker-tall']:
        m.box('body', ((front+back)/2, 0, (h-.015)/2), (front-back, w-.040, h-.095), 'painted-edge')
        count = 2 if variant == 'locker-wide' else 1
        dw = (w-.075)/count
        for i in range(count):
            y = (i-(count-1)/2)*dw
            door(m, front, y, .075, dw-.012, h-.175, 1 if i == 0 else -1)
        m.wedge('lid', -d/2, d/2, 0, w, h-.065, h, h-.023)
    elif variant == 'open-bin':
        # A real recessed slot under a simple hood, without modeled contents.
        m.box('lower-bin', (0, 0, h*.345), (d-.035, w-.030, h*.59))
        for y in [-(w-.040)/2, (w-.040)/2]:
            m.box('hood-side', (0, y, h*.81), (d-.015, .035, h*.34))
        m.box('hood-back', (-d/2+.025, 0, h*.81), (.035, w-.045, h*.34))
        m.wedge('roof', -d/2, d/2, 0, w, h-.040, h, h-.012)
        m.box('slot-floor', (0, 0, h*.644), (d-.065, w-.065, .012), 'dark')
    else:
        slope = .16 if variant == 'locker-sloped' else 0
        m.wedge('body', back, front, 0, w-.040, .045, h-.055, h-.055-slope)
        m.wedge('lid', -d/2, d/2, 0, w, h-.065-slope, h, h-slope)
        # Two block clasps bridge the lid seam; no bolts, bevels or tubular pulls.
        for y in [-w*.29, w*.29]:
            m.box('clasp', (front+.025, y, h-slope-.055), (.055, .035, .090), 'painted-edge')
    return m.finish()

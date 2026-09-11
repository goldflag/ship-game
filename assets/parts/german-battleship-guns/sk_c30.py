"""Original 3.7 cm SK C/30 twin, extracted from Bismarck's original AA recipe.

The approved pgsb708 model's displayed 30 degree muzzle locations set the
rearward cradle, barrel spacing and axis height. Reference meshes are never
loaded here. Operating sectors in that source are empty; catalog travel is an
authored game approximation, not a historical or source mechanical-stop claim.
"""
import bpy
import math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    name, spec = mount['id'], mount['weapon']
    gray, edge, dark = (materials[k] for k in ['naval', 'edge', 'dark'])
    deck = materials.get('roof', edge)
    tr, height = spec['trunnionForward'], spec['pivotHeight']
    length = spec['muzzleForward'] - tr

    def joint(suffix, parent=None, loc=(0, 0, 0)):
        ob = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(ob)
        ob.location = loc
        ob.parent = parent
        ob['nodeId'] = ob.name
        ob['assemblyId'] = name
        return ob

    yaw = joint('yaw')

    def put(ob, parent=yaw):
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob['assemblyId'] = name
        return ob

    def tube(label, xa, xb, outer, inner, parent, material=edge, n=24):
        vertices = [(x, r * math.cos(i * math.tau / n), r * math.sin(i * math.tau / n))
                    for x, r in [(xa, outer), (xb, outer), (xb, inner), (xa, inner)] for i in range(n)]
        faces = [(ring*n+i, ring*n+(i+1)%n, ((ring+1)%4)*n+(i+1)%n, ((ring+1)%4)*n+i)
                 for ring in range(4) for i in range(n)]
        return put(mesh(name + '.' + label, vertices, faces, material, col, True), parent)

    def wheel(label, center, radius, parent=yaw):
        x, y, z = center
        pts = [(x + radius*math.cos(i*math.tau/20), y, z + radius*math.sin(i*math.tau/20))
               for i in range(20)]
        for a, b in zip(pts, pts[1:] + pts[:1]):
            put(rod(name + '.' + label + '.rim', a, b, .014, edge, col, vertices=6), parent)
        for i in range(3):
            put(rod(name + '.' + label + '.spoke', center, pts[round(i*20/3)%20], .014, edge, col, vertices=6), parent)

    # Low sole and bearing ring: the installation root is slightly above the
    # source deck, so the sole extends down to the actual support surface.
    put(cyl(name + '.mounting-sole', (0, 0, -.035), .49, .13, gray, col, 32))
    put(cyl(name + '.training-bearing', (0, 0, .16), .47, .26, edge, col, 32))
    put(cyl(name + '.pedestal', (0, 0, .61), .25, .82, gray, col, 24))
    put(cyl(name + '.pedestal-shoulder', (0, 0, 1.02), .30, .14, edge, col, 24))
    put(rod(name + '.carriage-crosshead', (.03, -.40, 1.16), (.03, .40, 1.16), .085, gray, col, vertices=16))

    # A rearward fork bears on the central pedestal, outside both breech paths.
    # The open well below the axis clears the descending receiver at +80 deg.
    profile = [(.23, .96), (.24, 1.29), (tr+.13, height+.10),
               (tr-.13, height+.10), (tr-.15, height-.20), (-.14, 1.02)]
    for sign in [-1, 1]:
        y = sign*.39
        verts = [(x, y+offset, z) for offset in [-.035, .035] for x, z in profile]
        n = len(profile)
        faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        put(mesh(name + '.cast-fork', verts, faces, gray, col))
        # Stub axles engage the elevating cradle at the exact transverse axis.
        put(rod(name + '.trunnion-stub', (tr, sign*.305, height), (tr, sign*.425, height), .085, edge, col, vertices=16))
        put(box(name + '.footboard', (.62, sign*.62, .155), (1.20, .58, .075), deck, col))
        put(rod(name + '.footboard-outrigger', (0, 0, .20), (.67, sign*.73, .20), .060, gray, col, vertices=8))
        put(rod(name + '.seat-post', (.65, sign*.76, .20), (.65, sign*.76, .70), .045, gray, col, vertices=8))
        put(cyl(name + '.crew-seat', (.65, sign*.76, .74), .20, .09, deck, col, 20))
        put(rod(name + '.handwheel-shaft', (.03, sign*.40, 1.10), (.66, sign*.76, .98), .035, edge, col, vertices=10))
        wheel('training-handwheel', (.66, sign*.78, .98), .16)
        put(box(name + '.control-housing', (.14, sign*.43, 1.10), (.29, .16, .27), gray, col))

    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (tr, y, height))
        elevation.rotation_euler.y = -math.radians(1)
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # The nonrecoiling annular cradle carries the sliding receiver. A real
        # bore between both surfaces avoids hiding the breech in a solid block.
        tube(side + '.receiver-cradle', -.18, .18, .139, .108, elevation, gray)
        put(rod(name + '.' + side + '.receiver', (-.80, 0, 0), (.50, 0, 0), .10, gray, col, vertices=20), recoil)
        put(box(name + '.' + side + '.breech-cap', (-.81, 0, 0), (.14, .18, .18), edge, col), recoil)
        put(box(name + '.' + side + '.top-feed', (-.43, 0, .135), (.38, .20, .15), dark, col), recoil)
        put(rod(name + '.' + side + '.recoil-cylinder', (-.32, 0, -.22), (.93, 0, -.22), .062, gray, col, vertices=14), recoil)
        put(rod(name + '.' + side + '.recoil-piston', (-.52, 0, -.22), (-.24, 0, -.22), .034, edge, col, vertices=12), recoil)
        for xx in [-.28, .64]:
            put(rod(name + '.' + side + '.slide-yoke', (xx, 0, -.22), (xx, 0, -.075), .037, edge, col, vertices=10), recoil)
        # Tapered open barrel. The outer muzzle always exceeds the 37 mm bore.
        n = 24
        rings = [(.30, .047), (.52, .043), (length, .023), (length, .0185), (length-.30, .0185)]
        verts = [(x, r*math.cos(i*math.tau/n), r*math.sin(i*math.tau/n)) for x, r in rings for i in range(n)]
        faces = [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
                 for j in range(len(rings)-1) for i in range(n)]
        put(mesh(name + '.' + side + '.barrel', verts, faces, edge, col, True), recoil)
        put(rod(name + '.' + side + '.bore-shadow', (length-.305, 0, 0), (length-.301, 0, 0), .0184, dark, col, vertices=24), recoil)
        # Small loading handle remains on the receiver during recoil.
        put(rod(name + '.' + side + '.charging-handle', (-.63, -.085, -.04), (-.63, -.17, -.04), .022, edge, col, vertices=8), recoil)

    # Sight bridge and ring are rooted on the pedestal between the twin guns.
    put(rod(name + '.sight-bracket', (.13, 0, 1.05), (.40, 0, 1.76), .030, gray, col, vertices=8))
    put(rod(name + '.sight-mount', (.40, 0, 1.76), (.59, 0, 1.76), .025, edge, col, vertices=8))
    put(rod(name + '.sight-ring-stem', (.59, 0, 1.70), (.59, 0, 1.77), .018, edge, col, vertices=8))
    n = 20
    pts = [(.59, .11*math.cos(i*math.tau/n), 1.82+.11*math.sin(i*math.tau/n)) for i in range(n)]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        put(rod(name + '.ring-sight', a, b, .012, edge, col, vertices=6))
    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw

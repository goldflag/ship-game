"""Original 38 cm SK C/34 twin: faceted house, optics and attached service fittings.

Visual proportions follow the approved GameModels3D pgsb708 configuration. No
reference geometry is loaded here. The catalog remains the armor/weapon source;
the common original constructor retains yaw, elevation, recoil and muzzle IDs.
"""
import bpy
import bmesh
import math
from mathutils import Matrix
from blender_components import create_gun_mount
from blender_barrels import barrel_layout


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    for key in ['roof', 'hullgray', 'canvas']:
        palette.setdefault(key, palette['naval'])
    name = mount['id']
    spec = mount['weapon']
    create_gun_mount(mount, col, helpers, palette,
                     helpers.get('deck_height', lambda x: mount['position'][1]))
    yaw = bpy.data.objects[name + '.yaw']
    naval, edge, dark, canvas = (palette[k] for k in ['naval', 'edge', 'dark', 'canvas'])

    def put(obj, parent=yaw):
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = name
        return obj

    # Replace the shared constructor's generic optics and fittings with the
    # exact variant's side housings. The armored shell and original rig stay.
    for obj in list(col.objects):
        if obj.type == 'MESH' and obj.get('assemblyId') == name and any(
                word in obj.name for word in ['roof hatch', 'transverse rangefinder',
                                              'rangefinder hood', 'canvas mantlet', ' • barrel', 'recessed bore']):
            bpy.data.objects.remove(obj, do_unlink=True)

    height = spec['gunhouseSize'][2]
    shoulder = 1.95

    def side_y(z, sign):
        return sign * (4.35 - max(0, z - shoulder) / (height - shoulder) + .025)

    # Plate joints, ladders and sight hoods are seated on the actual sloping
    # shoulder, rather than attached to a guessed outer bounding box.
    for sign in [-1, 1]:
        for za, zb in [(.42, shoulder), (shoulder, height - .08)]:
            for x in [-3.03, -2.60]:
                put(rod(name + '.side-ladder-rail', (x, side_y(za, sign), za),
                        (x, side_y(zb, sign), zb), .027, edge, col, vertices=8))
        for z in [.49 + i * .25 for i in range(12)]:
            put(rod(name + '.side-ladder-rung', (-3.04, side_y(z, sign) + sign*.015, z),
                    (-2.59, side_y(z, sign) + sign*.015, z), .022, edge, col, vertices=8))
        put(rod(name + '.side-plate-seam', (-7.15, sign*4.365, shoulder),
                (2.72, sign*4.365, shoulder), .018, edge, col, vertices=6))
        # The source's small shoulder sight is a tapered upright hood, separate
        # from the main rangefinder and rooted in the shoulder armor.
        x, y = .48, sign*3.91
        put(cyl(name + '.shoulder-sight', (x, y, 2.59), .17, .64, naval, col, 12))
        put(cyl(name + '.sight-cap', (x, y, 2.92), .21, .055, edge, col, 12))

        # All four gunhouses have the long side optical blister. Rangefinder
        # installations extend it outboard into a broad armored wing, with a
        # recessed forward optical face and a sliding shutter.
        depth = 2.05 if mount.get('rangefinder') else .13
        inner = 3.46 if mount.get('rangefinder') else 3.67
        outline = [(-6.10, 2.43), (-5.96, 2.16), (-5.65, 2.05),
                   (-3.62, 2.05), (-3.62, 3.28), (-5.65, 3.28),
                   (-5.96, 3.17), (-6.10, 2.91)]
        verts = [(x, sign*(inner+d), z) for d in [0, depth] for x,z in outline]
        n = len(outline)
        faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        wing = put(mesh(name + '.optical-wing', verts, faces, naval, col))
        bevel = wing.modifiers.new('Armored optical hood edge', 'BEVEL')
        bevel.width = .055; bevel.segments = 2
        if mount.get('rangefinder'):
            # The aperture faces forward, at the end of the side wing. Both
            # the bezel and shutter overlap the armored casing mechanically.
            y = sign*5.08
            put(rod(name + '.optic-bezel', (-3.66,y,2.74), (-3.54,y,2.74), .22, edge, col, vertices=16))
            put(rod(name + '.optic-glass', (-3.533,y,2.74), (-3.526,y,2.74), .15, dark, col, vertices=16))
            put(box(name + '.optic-shutter', (-3.53,sign*4.66,2.68), (.055,.43,.68), naval, col))
            for z in [2.21, 3.10]:
                put(rod(name + '.shutter-track', (-3.56,sign*4.34,z), (-3.56,sign*5.43,z), .027, edge, col, vertices=6))
        else:
            # Flush cover follows the shoulder instead of becoming a floating
            # slab when the large optical wings are omitted on Anton.
            cover = bpy.data.objects.get(name + '.optical-wing')
            if cover:
                for vertex in cover.data.vertices:
                    vertex.co.y = side_y(vertex.co.z, sign) + sign*(vertex.co.y*sign-inner)

        # Short front access rungs wrap down the outer gun port cheeks.
        for i,z in enumerate([.94, 1.38, 1.82]):
            x = 5.65 - .27*(z-.25)/1.70
            ya,yb = sign*2.89,sign*3.65
            put(rod(name + '.front-rung', (x+.065,ya,z), (x+.065,yb,z), .032, edge, col, vertices=8))
            for yy in [ya,yb]:
                put(rod(name + '.front-rung-foot', (x-.12,yy,z), (x+.07,yy,z), .03, naval, col, vertices=8))

        # The approved model has rear ventilation trunks and short grabs;
        # the former roof ladder/hatch placeholders are absent from this fit.
        put(box(name + '.rear-vent', (-8.66,sign*1.84,1.13), (.24,.48,1.56), naval, col))
        put(rod(name + '.rear-grab', (-8.66,sign*2.55,1.16),
                (-8.66,sign*2.80,1.16), .027, edge, col, vertices=8))
        for yy in [sign*2.55,sign*2.80]:
            put(rod(name + '.rear-grab-foot',(-8.68,yy,1.16),(-8.48,yy,1.16),.025,naval,col,vertices=8))

    # Broad pleated fabric seals wrap the barrels. Their inboard rings extend
    # behind the face so the attachment remains seated at combined elevation
    # and recoil poses. Barrels and muzzle sockets retain the original rig.
    for side, _, _ in barrel_layout(spec):
        parent = bpy.data.objects[name + '.' + side + '.recoil']
        rings = [(0,.80,1.14),(.9,.94,1.12),(1.65,.94,.94),
                 (2.3,.82,.72),(3.15,.67,.56),(4.0,.56,.54),(4.7,.52,.515)]
        verts=[];n=32
        for j,(x,ry,rz) in enumerate(rings):
            for i in range(n):
                a=math.tau*i/n;fold=1+.035*math.cos(a*7+j*.7)
                verts.append((x,ry*math.cos(a)*fold,rz*math.sin(a)*fold))
        faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
               for j in range(len(rings)-1) for i in range(n)]
        put(mesh(name + '.pleated-blast-bag', verts, faces, canvas, col, True), parent)
        recoil = bpy.data.objects[name + '.' + side + '.recoil']
        length = spec['muzzleForward'] - spec['trunnionForward']
        profile = [(-.2,.57),(4.55,.49),(4.80,.46),(8.45,.36),
                   (8.67,.31),(length,.245)]
        for (xa,ra),(xb,rb) in zip(profile,profile[1:]):
            barrel = put(rod(name + '.barrel-chase',(xa,0,0),(xb,0,0),ra,edge,col,r2=rb,vertices=32),recoil)
            if xb == length:
                bm = bmesh.new();bm.from_mesh(barrel.data)
                cap = max(bm.faces,key=lambda f:f.calc_center_median().z)
                bmesh.ops.delete(bm,geom=[cap],context='FACES_ONLY')
                bm.to_mesh(barrel.data);bm.free()
        # A physical annular muzzle rim and short dark bore cavity retain the
        # 380 mm opening; the ring is attached to the moving outer barrel.
        bore = spec['caliberM']/2
        vertices = [(x,r*math.cos(math.tau*i/32),r*math.sin(math.tau*i/32))
                    for x,r in [(length,.245),(length,bore),(length-.42,bore)]
                    for i in range(32)]
        faces = [(i,(i+1)%32,(i+1)%32+32,i+32) for i in range(32)]
        faces += [(i+32,(i+1)%32+32,(i+1)%32+64,i+64) for i in range(32)]
        put(mesh(name + '.muzzle-rim',vertices,faces,edge,col),recoil)
        put(rod(name + '.bore-interior',(length-.44,0,0),(length-.42,0,0),bore,dark,col,vertices=32),recoil)
    return yaw

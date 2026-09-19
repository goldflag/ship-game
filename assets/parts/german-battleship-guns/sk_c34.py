"""Original 38 cm SK C/34 twin: faceted house, optics and attached service fittings.

Visual proportions follow the approved GameModels3D pgsb708 configuration. No
reference geometry is loaded here. The catalog remains the armor/weapon source;
the common original constructor retains yaw, elevation, recoil and muzzle IDs.
"""
import bpy
import math
from mathutils import Matrix
from blender_components import create_gun_mount
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer


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

    # The original armor volumes keep their combat meaning. The visible aft
    # plate follows a shallow rounded plan and a higher curved roof break;
    # the former three-point rear made a deep triangular roof chamfer.
    shell = next(o for o in col.objects if o.type == 'MESH'
                 and o.get('assemblyId') == name and 'sloped gunhouse' in o.name)
    shape = spec['gunhouseMesh']
    vertices = [list(v) for v in shape['vertices']]
    for i in [0, 7, 8, 15]:
        vertices[i][0] = -8.05
    for i in [8, 15]:
        vertices[i][2] = 3.09
    faces = [f['indices'] for f in shape['faces']
             if not f['id'].startswith(('side-7', 'slope-7', 'floor-7'))]
    finishes = [f['finish'] for f in shape['faces']
                if not f['id'].startswith(('side-7', 'slope-7', 'floor-7'))]
    rear = []
    for layer in range(3):
        ring = []
        for i in range(9):
            y = -3.12 + 6.24*i/8
            x = -8.78 + .075*y*y if layer < 2 else -6.85
            z = .39 if layer == 0 else 2.75+.035*y*y if layer == 1 else 3.45
            ring.append(len(vertices))
            vertices.append((x, y if layer < 2 else y*3.2/3.12, z))
        rear.append(ring)
    for layer in range(2):
        for i in range(8):
            faces.append((rear[layer][i],rear[layer+1][i],rear[layer+1][i+1],rear[layer][i+1]))
            finishes.append('naval')
    faces.append(tuple(rear[0]))
    finishes.append('naval')
    # Shared endpoints use exactly the neighboring plate coordinates.
    for ring, ends in zip(rear, [(0,7),(8,15),(16,23)]):
        for index, old in zip((ring[0],ring[-1]),ends):
            vertices[index] = vertices[old]
    data = bpy.data.meshes.new(name + '.curved-aft-plates')
    # The common shell stores ship-height Z in mesh coordinates and cancels
    # it in the yaw-local object transform; preserve that installed contract.
    data.from_pydata([(x,y,z+mount['position'][1]) for x,y,z in vertices], [], faces)
    data.update()
    for mat in shell.data.materials: data.materials.append(mat)
    shell.data = data
    for face,finish in zip(data.polygons,finishes):
        face.material_index = 1 if finish == 'roof' else 0

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
        put(cyl(name + '.shoulder-sight', (x, y, 2.57), .22, .80, naval, col, 12))
        put(cyl(name + '.sight-cap', (x, y, 2.98), .25, .045, edge, col, 12))

        # All four gunhouses have the long side optical blister. Rangefinder
        # installations extend it outboard into a broad armored wing, with a
        # recessed forward optical face and a sliding shutter.
        depth = 2.05 if mount.get('rangefinder') else .035
        inner = 3.46 if mount.get('rangefinder') else 3.67
        outline = [(-6.10, 2.43), (-5.96, 2.16), (-5.65, 2.05),
                   (-3.62, 2.05), (-3.62, 3.28), (-5.65, 3.28),
                   (-5.96, 3.17), (-6.10, 2.91)]
        if not mount.get('rangefinder'):
            outline = [(-6.25, 3.28), (-6.22, 2.91), (-6.08, 2.56),
                       (-5.80, 2.30), (-5.40, 2.15), (-3.18, 2.15),
                       (-3.18, 3.28)]
        verts = [(x, sign*(inner+d), z) for d in [0, depth] for x,z in outline]
        n = len(outline)
        faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        wing = put(mesh(name + '.optical-wing', verts, faces, naval, col))
        bevel = wing.modifiers.new('Armored optical hood edge', 'BEVEL')
        bevel.width = .055; bevel.segments = 1
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
            cover = wing
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
        put(cyl(name + '.rear-vent', (-8.68,sign*1.84,1.38), .25, 1.92, naval, col, 12))
        put(rod(name + '.rear-grab', (-8.66,sign*2.55,1.16),
                (-8.66,sign*2.80,1.16), .027, edge, col, vertices=8))
        for yy in [sign*2.55,sign*2.80]:
            put(rod(name + '.rear-grab-foot',(-8.68,yy,1.16),(-8.48,yy,1.16),.025,naval,col,vertices=8))

    # Broad pleated fabric seals wrap the barrels. Their inboard rings extend
    # behind the face so the attachment remains seated at combined elevation
    # and recoil poses. Barrels and muzzle sockets retain the original rig.
    for side, _, _ in barrel_layout(spec):
        recoil = bpy.data.objects[name + '.' + side + '.recoil']
        length = spec['muzzleForward'] - spec['trunnionForward']
        # One connected surface spends its vertices on the sleeve shoulder and
        # long chase taper, with no hidden caps between each barrel section.
        profile = [(-.2,.57),(.40,.43),(4.90,.43),(6.08,.415),
                   (6.10,.345),(8.45,.325),(length,.275)]
        count = 20
        points = [(x,r*math.cos(math.tau*i/count),r*math.sin(math.tau*i/count))
                  for x,r in profile for i in range(count)]
        faces = [(j*count+i,j*count+(i+1)%count,
                  (j+1)*count+(i+1)%count,(j+1)*count+i)
                 for j in range(len(profile)-1) for i in range(count)]
        put(mesh(name + '.barrel-chase',points,faces,edge,col,True),recoil)
        # A physical annular muzzle rim and short dark bore cavity retain the
        # 380 mm opening; the ring is attached to the moving outer barrel.
        bore = spec['caliberM']/2
        vertices = [(x,r*math.cos(math.tau*i/16),r*math.sin(math.tau*i/16))
                    for x,r in [(length,.275),(length,bore),(length-.42,bore)]
                    for i in range(16)]
        faces = [(i,(i+1)%16,(i+1)%16+16,i+16) for i in range(16)]
        faces += [(i+16,(i+1)%16+16,(i+1)%16+32,i+32) for i in range(16)]
        put(mesh(name + '.muzzle-rim',vertices,faces,edge,col),recoil)
        put(rod(name + '.bore-interior',(length-.44,0,0),(length-.42,0,0),bore,dark,col,vertices=16),recoil)
    for side,y,_ in barrel_layout(spec):
        seam=[]
        for i in range(20):
            a=i*math.tau/20;z=1.55+1.12*math.copysign(abs(math.sin(a))**.65,math.sin(a))
            # Lower face and upper glacis share the same authored shell seam.
            x=5.65-.27*(z-.25)/1.70 if z<=1.95 else 5.38-2.26*(z-1.95)/1.50
            seam.append((x+.035,y+.72*math.copysign(abs(math.cos(a))**.75,math.cos(a)),z))
        cover = create_bloomer(mount,col,helpers,palette,side,seam,spec['trunnionForward']+4.70,.435,rings=5,slack=.18,fullness=.04)
        # A linear cloth loft can cross the jacket at high elevation. Keep its
        # intermediate rings outside the complete sliding sleeve, without
        # moving the fixed armor seam or the pitching cuff. The small radial
        # allowance also covers the chord between adjacent cloth vertices.
        angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
        for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < 20 or index >= 80:
                    continue
                delta = (point.co.x-spec['trunnionForward'], point.co.y-y,
                         point.co.z-spec['pivotHeight'])
                along = sum(delta[k]*axis[k] for k in range(3))
                radial = [delta[k]-along*axis[k] for k in range(3)]
                distance = math.sqrt(sum(v*v for v in radial))
                if 0 < distance < .465:
                    for k in range(3):
                        point.co[k] += radial[k]*(.465/distance-1)

    return yaw

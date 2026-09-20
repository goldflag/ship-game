"""Original Royal Navy King George V class gun mounts; no external geometry inputs.

Local metres: +X firing, +Y port, +Z up. Origin is the mount datum; the hull
installation owns the fixed barbette below z=0. Dimensions are hard-coded from
the King George V ship recipe (revision 4 gunhouse proportions).
"""
import math
import bpy
from aa_articulation import articulate_aa
from gun_bloomers import create_bloomer
from blender_barrels import barrel_layout

# Plan outlines run rear centre -> starboard -> face -> port (counter-clockwise from above).
QUAD_BASE = [(-8.3,0),(-8.14,-1.5),(-7.67,-3),(-6.92,-4.4),(-6.05,-5.42),(-2.8,-5.7822),(.5,-6.15),(4.9,-5.48),
             (4.9,5.48),(.5,6.15),(-2.8,5.7822),(-6.05,5.42),(-6.92,4.4),(-7.67,3),(-8.14,1.5)]
QUAD_ROOF = [(-8.3,0,2.72),(-8.14,-1.29,2.7316),(-7.67,-2.58,2.7658),(-6.92,-3.784,2.8204),(-6.05,-4.6612,2.8836),
             (-2.8,-4.9727,3.12),(.5,-5.289,3.0129),(4.9,-4.7128,2.87),(4.9,4.7128,2.87),(.5,5.289,3.0129),
             (-2.8,4.9727,3.12),(-6.05,4.6612,2.8836),(-6.92,3.784,2.8204),(-7.67,2.58,2.7658),(-8.14,1.29,2.7316)]
TWIN_BASE = [(-7,0),(-6.83,-1.15),(-6.32,-2.3),(-5.49,-3.4),(-4.5,-4.15),(.35,-4.60),(4.9,-3.34),
             (4.9,3.34),(.35,4.60),(-4.5,4.15),(-5.49,3.4),(-6.32,2.3),(-6.83,1.15)]
TWIN_ROOF = [(-7,0,3.1),(-6.83,-.989,3.1037),(-6.32,-1.978,3.1147),(-5.49,-2.924,3.1327),(-4.5,-3.569,3.1542),
             (.35,-3.96,3.23),(4.9,-2.87,2.87),(4.9,2.87,2.87),(.35,3.96,3.23),(-4.5,3.569,3.1542),
             (-5.49,2.924,3.1327),(-6.32,1.978,3.1147),(-6.83,.989,3.1037)]


def interp(points, s):
    points = sorted(points)
    if s <= points[0][0]: return points[0][1]
    for (a, va), (b, vb) in zip(points, points[1:]):
        if s <= b: return va + (vb - va) * (s - a) / (b - a) if b > a else vb
    return points[-1][1]


def multi_mesh(name, vertices, faces, indices, mats, collection):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    ob = bpy.data.objects.new(name, data); collection.objects.link(ob)
    for m in mats: data.materials.append(m)
    for poly, i in zip(data.polygons, indices): poly.material_index = i
    return ob


def prism(mesh, name, outline, z0, z1, material, collection):
    """Closed prism; z0/z1 may be callables of x. Outline counter-clockwise from above."""
    f0 = z0 if callable(z0) else (lambda x: z0)
    f1 = z1 if callable(z1) else (lambda x: z1)
    k = len(outline)
    vv = [(x, y, f0(x)) for x, y in outline] + [(x, y, f1(x)) for x, y in outline]
    ff = [tuple(reversed(range(k))), tuple(range(k, 2*k))] + [(i, (i+1) % k, (i+1) % k+k, i+k) for i in range(k)]
    return mesh(name, vv, ff, material, collection)


def ladder(rod, name, a, b, w, material, collection):
    ax, ay, az = a; bx, by, bz = b
    for s in [-w/2, w/2]:
        rod(name+'.rail', (ax, ay+s, az), (bx, by+s, bz), .028, material, collection, vertices=6)
        for x,y,z in [(ax,ay+s,az),(bx,by+s,bz)]:
            rod(name+'.foot',(x,y,z),(x+.10,y,z),.022,material,collection,vertices=6)
    steps = max(2, int((bz-az)/.32))
    for i in range(1, steps):
        t = i/steps; x = ax+(bx-ax)*t; z = az+(bz-az)*t
        rod(name+'.rung', (x, ay-w/2, z), (x, ay+w/2, z), .02, material, collection, vertices=6)


def pleated_bag(mesh, name, rings, lateral, axis_z, material, collection, pleats=7, depth=.05, sides=16):
    vv = []; ff = []
    for x, r in rings:
        for i in range(sides):
            a = i*math.tau/sides; rr = r*(1+depth*math.cos(pleats*a))
            vv.append((x, lateral+rr*math.cos(a), axis_z(x)+rr*math.sin(a)))
    for j in range(len(rings)-1):
        for i in range(sides):
            a = j*sides+i; b = j*sides+(i+1) % sides; ff.append((a, b, b+sides, a+sides))
    return mesh(name, vv, ff, material, collection, True)


def create_kgv_main(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']; n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval); canvas = materials.get('canvas', dark)
    count = spec['barrelCount']; quad = count == 4
    base = QUAD_BASE if quad else TWIN_BASE
    top = QUAD_ROOF if quad else TWIN_ROOF
    ridge = -2.8 if quad else .35
    width = 12.3 if quad else 9.44
    rf_x = -3.9 if quad else -4.3
    rf_w = 12.5 if quad else 9.14
    k = len(base); floor = .25; front = 4.9
    roof_points = sorted({(x, z) for x, y, z in top})
    roof_z = lambda x: interp(roof_points, x)
    front_z = roof_z(front)
    front_bottom = max(abs(y) for x, y in base if x == front)
    front_top = max(abs(y) for x, y, z in top if x == front)
    spacing = spec['barrelSpacing']
    axes = [(i-(count-1)/2)*spacing for i in range(count)]  # starboard -> port for face building
    before = set(bpy.context.scene.objects)

    # Refine the existing rounded rear outline with authored intermediate stations.
    # The triangle budget comes from eliminating internal barrel end caps below.
    refined_base, refined_top = [], []
    for i, a in enumerate(base):
        b = base[(i+1) % len(base)]; ta = top[i]; tb = top[(i+1) % len(top)]
        refined_base.append(a); refined_top.append(ta)
        limit = -6.0 if quad else -4.49
        if a[0] <= limit and b[0] <= limit:
            # Midpoint bows outward along the rear elliptical arc.
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            bulge = .035
            refined_base.append((mx-bulge, my))
            refined_top.append(((ta[0]+tb[0])/2-bulge,(ta[1]+tb[1])/2,(ta[2]+tb[2])/2))
    base, top = refined_base, refined_top
    k = len(base)

    # Roller path mates with the hull's fixed barbette; D-shaped sill shields its exposed front.
    # The twin's narrower shell still needs a shoulder outside the native well.
    ring = spec['barbetteRadius'] + (0 if quad else .05)
    cyl(n+'.roller', (0, 0, .125), ring, .25, edge, collection, 64)
    sill_r = ring+.15; ang = math.acos(min(.999, (front-.25)/sill_r))
    sill = [(sill_r*math.cos(a), sill_r*math.sin(a)) for a in [-ang+2*ang*i/24 for i in range(25)]]
    prism(mesh, n+'.barbette.sill', sill, .0, .36, naval, collection)

    # Slab-sided shell: floor, walls, shallow two-plane crowned roof, upright face with
    # round-bottomed elevation ports that cut back into the forward roof plate.
    vv = [(x, y, floor) for x, y in base]+list(top); ff = []; mi = []
    ff.append(list(reversed(range(k)))); mi.append(0)
    front_i = next(i for i in range(k) if base[i][0] == front and base[(i+1) % k][0] == front)
    for i in range(k):
        if i != front_i: ff.append([i, (i+1) % k, (i+1) % k+k, i+k]); mi.append(0)
    rear = [i+k for i in range(k) if top[i][0] <= ridge]
    rear = [i for i in rear if top[i-k][1] <= 0]+[i for i in rear if top[i-k][1] > 0]
    ff.append(rear); mi.append(1)
    radius = .74; zc = spec['pivotHeight']-.27; recess = .92
    notched = []
    fwd = [p for p in top if p[0] >= ridge]
    for a, b in zip(fwd, fwd[1:]+fwd[:1]):
        notched.append(a)
        if a[0] == front and b[0] == front:
            for gy in axes:
                for j in range(17):
                    t = math.pi-j*math.pi/16; x = front-recess*math.sin(t)
                    notched.append((x, gy+radius*math.cos(t), roof_z(x)))
    idx = len(vv); vv.extend(notched); ff.append(list(range(idx, len(vv)))); mi.append(1)

    def patch(ys, zs, inset=0, material=0):
        idx = len(vv); vv.extend([(front-inset, y, z) for y, z in zip(ys, zs)])
        ff.append(list(range(idx, idx+len(ys)))); mi.append(material)
    for i, gy in enumerate(axes):
        last = axes[i-1]+radius if i else -front_bottom
        patch([last, gy-radius, gy-radius, axes[i-1]+radius if i else -front_top], [floor, floor, front_z, front_z])
        arc = [(gy+radius*math.cos(a), zc+radius*math.sin(a)) for a in [math.pi+j*math.pi/12 for j in range(13)]]
        for (ya, za), (yb, zb) in zip(arc, arc[1:]): patch([ya, yb, yb, ya], [floor, floor, zb, za])
        aperture = arc+[(gy+radius, front_z), (gy-radius, front_z)]
        idx = len(vv); m = len(aperture)
        vv.extend([(front-inset, y, z if inset == 0 or z < front_z else roof_z(front-inset)) for inset in [0, recess] for y, z in aperture])
        for j in range(m):
            if j == m-2: continue
            ff.append([idx+j, idx+(j+1) % m, idx+m+(j+1) % m, idx+m+j]); mi.append(0)
        ff.append([idx+m+j for j in range(m)]); mi.append(2)
    patch([axes[-1]+radius, front_bottom, front_top, axes[-1]+radius], [floor, floor, front_z, front_z])
    multi_mesh(n+'.gunhouse', vv, ff, mi, [naval, roof, dark], collection)

    # Broad plate boundaries carry the roof silhouette; omit raised bolt rows.
    half_at = lambda x: interp({(a, abs(b)) for a, b, c in top if b <= 0}, x)
    # Flared rangefinder end covers growing out of the rear roof (41 ft / 30 ft baselines).
    root_y = width*.35; tip_y = rf_w/2+(.65 if quad else .50)
    for side in [-1, 1]:
        outline = [(rf_x-.86, side*root_y), (rf_x+.86, side*root_y), (rf_x+1.07, side*(tip_y-.14)),
                   (rf_x+.99, side*tip_y), (rf_x-1.00, side*tip_y), (rf_x-1.08, side*(tip_y-.14))]
        if side < 0: outline.reverse()
        # Chamfer the lower edge and outside corners: the source's end housings
        # hang below the roof rather than reading as square boxes on top of it.
        count_rf = len(outline)
        lower = [(rf_x+(x-rf_x)*.90, y-side*.045, roof_z(x)-1.08) for x,y in outline]
        belt = [(x,y,roof_z(x)-.91) for x,y in outline]
        upper = [(x,y,roof_z(x)+.015) for x,y in outline]
        rv = lower+belt+upper
        faces_rf = [tuple(reversed(range(count_rf))),tuple(range(2*count_rf,3*count_rf))]
        faces_rf += [(j*count_rf+i,j*count_rf+(i+1)%count_rf,(j+1)*count_rf+(i+1)%count_rf,(j+1)*count_rf+i)
                     for j in range(2) for i in range(count_rf)]
        mesh(n+'.rangefinder.cover',rv,faces_rf,naval,collection)
        z = roof_z(rf_x)-.48
        rod(n+'.rangefinder.cap', (rf_x, side*(tip_y-.01), z), (rf_x, side*(tip_y+.05), z), .28, naval, collection, vertices=12)
        for dx in [-.66, .66]: box(n+'.rangefinder.hinge', (rf_x+dx, side*(tip_y+.04), z), (.12, .08, .30), edge, collection)
        box(n+'.rangefinder.window', (rf_x+1.035, side*(tip_y-.30), z), (.04, .30, .25), dark, collection)
        # Rear access ladder leaning with the curved back wall.
        ly = 2.3 if quad else 1.65
        lx0 = interp({(abs(y), x) for x, y in base if x < ridge and y <= 0}, ly)-.06
        lx1 = interp({(abs(y), x) for x, y, zz in top if x < ridge and y <= 0}, ly)-.06
        ladder(rod, n+'.rear.ladder', (lx0, side*ly, floor+.03), (lx1, side*ly, roof_z(lx1)+.10), .46, edge, collection)
        # Low escape covers on the rear roof.
        hx = -6.4 if quad else -5.4; hy = side*(3.4 if quad else 1.05)
        cyl(n+'.roof.escape', (hx, hy, roof_z(hx)+.045), .35, .09, naval, collection, 16)
        rod(n+'.roof.escape.handle', (hx-.14, hy, roof_z(hx)+.12), (hx+.14, hy, roof_z(hx)+.12), .028, edge, collection, vertices=6)
        # The earlier generic tall mushroom array hid the clean roof crown.
        # Keep low hatch covers; the main source shows only a small forward vent.
    if quad:
        vx=3.3
        cyl(n+'.roof.vent.stem',(vx,0,roof_z(vx)+.075),.085,.15,naval,collection,10)
        cyl(n+'.roof.vent.cap',(vx,0,roof_z(vx)+.16),.14,.045,naval,collection,12,r2=.10)
    if not quad:
        # The approved twin carries a rear roof guardrail; short stanchions
        # grow directly from the roof, with the front corners kept clear.
        rail = [(-6.73,-.9),(-6.3,-1.85),(-5.5,-2.75),(-3.2,-3.55),(-.6,-3.82),
                (.15,-2.7),(.6,-1.35),(.75,0),(.6,1.35),(.15,2.7),
                (-.6,3.82),(-3.2,3.55),(-5.5,2.75),(-6.3,1.85),(-6.73,.9)]
        for x,y in rail:
            rod(n+'.roof.guard.post',(x,y,roof_z(x)),(x,y,3.23+.96),.026,edge,collection,vertices=6)
        for lift in [.46,.96]:
            for (xa,ya),(xb,yb) in zip(rail,rail[1:]+rail[:1]):
                rod(n+'.roof.guard.rail',(xa,ya,3.23+lift),(xb,yb,3.23+lift),.022,edge,collection,vertices=6)
    # Gunlayers' face sights between the guns.
    for gy in [(a+b)/2 for a, b in zip(axes, axes[1:])]:
        box(n+'.face.sight', (front+.012, gy, front_z-.63), (.03, .20, .37), dark, collection)
        box(n+'.face.sight.hood', (front+.08, gy, front_z-.39), (.20, .29, .09), naval, collection)
    # Rear door in the flat of the back wall.
    rear_x = base[0][0]
    box(n+'.rear.door', (rear_x-.02, 0, 1.25), (.08, .8, 1.7), roof, collection)
    for z in [.7, 1.8]: rod(n+'.rear.door.dog', (rear_x-.07, -.3, z), (rear_x-.07, -.12, z), .028, edge, collection, vertices=6)
    frame = list(set(bpy.context.scene.objects)-before)

    groups = []
    pivot = spec['trunnionForward']; height = spec['pivotHeight']; muzzle = spec['muzzleForward']
    slope = math.tan(math.radians(1)); length = muzzle-pivot
    for lateral in reversed(axes):  # port -> starboard
        start = set(bpy.context.scene.objects)
        az = lambda x: height+(x-pivot)*slope
        pt = lambda x: (x, lateral, az(x))
        # Mk VII: long parallel rear sleeve, step, light tapering chase.
        profile = [(-.62,.60),(.43,.50),(3.80,.475),(3.85,.365),
                   (length-.28,.254),(length-.12,.265),(length,.278)]
        # One lathed surface instead of independently capped cones: spend those
        # hidden caps on the shallow muzzle swell and a genuinely open bore.
        sides = 16
        bv = [(pivot+a,lateral+r*math.cos(i*math.tau/sides),az(pivot+a)+r*math.sin(i*math.tau/sides))
              for a,r in profile for i in range(sides)]
        bf = [(j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i)
              for j in range(len(profile)-1) for i in range(sides)]
        inner = len(bv); bore_r = spec['caliberM']/2
        bv += [(muzzle,lateral+bore_r*math.cos(i*math.tau/sides),az(muzzle)+bore_r*math.sin(i*math.tau/sides)) for i in range(sides)]
        bv += [(muzzle-.32,lateral+bore_r*math.cos(i*math.tau/sides),az(muzzle-.32)+bore_r*math.sin(i*math.tau/sides)) for i in range(sides)]
        outer=(len(profile)-1)*sides
        bf += [(outer+i,outer+(i+1)%sides,inner+(i+1)%sides,inner+i) for i in range(sides)]
        bf += [(inner+i,inner+(i+1)%sides,inner+sides+(i+1)%sides,inner+sides+i) for i in range(sides)]
        barrel = mesh(n+'.barrel',bv,bf,edge,collection,True)
        for poly in barrel.data.polygons:
            if poly.index//sides in [2,6]: poly.use_smooth=False
        mesh(n+'.bore',bv[inner+sides:],[tuple(reversed(range(sides)))],dark,collection)
        groups.append(list(set(bpy.context.scene.objects)-start))
    yaw = articulate_aa(mount, collection, frame, groups)
    for side, gy, _ in barrel_layout(spec):
        # Follow the complete round-bottom aperture, including its roof return.
        seam = []
        for i in range(24):
            if i == 0: x,y,z = front+.012,gy+radius+.018,zc
            elif i == 1: x,y,z = front+.012,gy+radius+.018,(zc+front_z)/2
            elif 2 <= i <= 10:
                a=(i-2)*math.pi/8;x=front-recess*math.sin(a)
                y=gy+(radius+.018)*math.cos(a);z=roof_z(x)+.018
            elif i == 11: x,y,z=front+.012,gy-radius-.018,(zc+front_z)/2
            else:
                a=math.pi+(i-12)*math.pi/12
                x,y,z=front+.012,gy+(radius+.018)*math.cos(a),zc+(radius+.018)*math.sin(a)
            seam.append((x,y,z))
        create_bloomer(mount,collection,helpers,materials,side,seam,front+.78,.480,rings=5,fold_depth=.022,slack=.022)
    return yaw



def create_kgv_secondary(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']; n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval); canvas = materials.get('canvas', dark)
    before = set(bpy.context.scene.objects)
    cyl(n+'.roller', (0, 0, .125), spec['barbetteRadius'], .25, edge, collection, 48)
    # Catalog armor facets are also the visual shell: one durable contour.
    shape=spec['gunhouseMesh']
    multi_mesh(n+'.gunhouse',shape['vertices'],[f['indices'] for f in shape['faces']],
               [int(f.get('finish')=='roof') for f in shape['faces']], [naval,roof],collection)

    # Elevation slots follow the face, the steep brow and the long glacis (guns reach 70 degrees).
    spacing = spec['barrelSpacing']; hw = .30
    path = [(2.72, 1.90), (2.72, 2.42), (2.5, 2.61), (1.05, 3.06)]
    for lateral in [spacing/2, -spacing/2]:
        sv = []; sf = []
        for (xa, za), (xb, zb) in zip(path, path[1:]):
            dx, dz = xb-xa, zb-za; l = math.hypot(dx, dz); nx, nz = dz/l*.012, -dx/l*.012
            i = len(sv)
            sv += [(xa+nx, lateral-hw, za+nz), (xa+nx, lateral+hw, za+nz), (xb+nx, lateral+hw, zb+nz), (xb+nx, lateral-hw, zb+nz)]
            sf.append((i, i+1, i+2, i+3))
        mesh(n+'.elevation.slot', sv, sf, dark, collection)
        # Raised coaming either side of each slot.
        for s in [-1, 1]:
            for (xa, za), (xb, zb) in zip(path[1:], path[2:]):
                rod(n+'.slot.coaming', (xa+.02, lateral+s*(hw+.03), za+.03), (xb+.02, lateral+s*(hw+.03), zb+.03), .035, naval, collection, vertices=6)
    for side in [-1, 1]:
        # Armoured cheeks beside the cradles, with the layer's/trainer's sight ports.
        outline = [(1.0, side*1.48), (2.35, side*1.48), (2.35, side*1.72), (1.0, side*2.0)]
        if side < 0: outline.reverse()
        prism(mesh, n+'.cheek', outline, 2.02, 2.88, naval, collection)
        box(n+'.cheek.sight', (2.355, side*1.60, 2.66), (.02, .18, .16), dark, collection)
        box(n+'.vent.cheek', (-1.0, side*2.24, 1.95), (.9, .10, .55), naval, collection)
        for z in [1.80, 1.95, 2.10]:
            box(n+'.vent.louvre', (-1.0, side*2.295, z), (.78, .02, .05), dark, collection)
        # Rear access doors on the angled back facets.
        mx, my = (-2.67-2.13)/2, (.92+1.77)/2; a = math.atan2(1.77-.92, -2.13+2.67)
        d = box(n+'.rear.door', (mx-.03*math.sin(a), side*(my+.03*math.cos(a)), 1.22), (.72, .05, 1.35), roof, collection)
        d.rotation_euler.z = side*a
    # Single rear ladder: vertical leg up the back wall, then a leg lying on the shoulder bevel.
    ladder(rod, n+'.rear.ladder', (-2.87, 0, .28), (-2.87, 0, 2.70), .42, edge, collection)
    ladder(rod, n+'.rear.ladder.upper', (-2.87, 0, 2.70), (-2.655, 0, 3.32), .42, edge, collection)
    for yy in [-1.10,1.10]:
        cyl(n+'.roof.hatch',(-1.15,yy,3.40),.46,.20,naval,collection,16)
        rod(n+'.roof.hatch.handle',(-1.30,yy,3.54),(-1.00,yy,3.54),.026,edge,collection,vertices=6)
        # Hinged rear hatch coamings and a supported optical periscope.
        box(n+'.roof.hatch.hinge',(-1.55,yy,3.47),(.10,.32,.12),naval,collection)
        for zz in [.60,.90,1.20,1.50]:
            rod(n+'.side.ladder.rung',(1.0,yy/abs(yy)*2.15,zz),(1.45,yy/abs(yy)*2.01,zz),.025,edge,collection,vertices=6)
    cyl(n+'.roof.periscope',(-1.60,0,3.58),.075,.56,naval,collection,10)
    box(n+'.roof.periscope.head',(-1.55,0,3.90),(.22,.16,.17),naval,collection)
    box(n+'.roof.sight',(.65,0,3.09),(.45,.44,.25),naval,collection)
    box(n+'.roof.sight.slit',(.88,0,3.13),(.02,.30,.08),dark,collection)
    frame = list(set(bpy.context.scene.objects)-before)

    groups = []
    pivot = spec['trunnionForward']; height = spec['pivotHeight']; muzzle = spec['muzzleForward']
    slope = math.tan(math.radians(1)); length = muzzle-pivot
    for lateral in [spacing/2, -spacing/2]:
        start = set(bpy.context.scene.objects)
        az = lambda x: height+(x-pivot)*slope
        pt = lambda x: (x, lateral, az(x))
        profile = [(-.55, .235), (2.10, .225), (2.15, .185), (2.30, .155), (2.34, .135), (length-.35, .098), (length-.30, .112), (length, .108)]
        for (a, ra), (b, rb) in zip(profile, profile[1:]):
            rod(n+'.barrel', pt(pivot+a), pt(pivot+b), ra, edge, collection, r2=rb, vertices=16)
        rod(n+'.muzzle.face', pt(muzzle-.002), pt(muzzle), .108, edge, collection, r2=spec['caliberM']/2, vertices=12)
        rod(n+'.bore', pt(muzzle+.003), pt(muzzle+.007), spec['caliberM']/2, dark, collection, vertices=12)
        # Exposed metal gun slide with a short canvas boot at the port.
        rod(n+'.slide', pt(pivot-.6), pt(2.78), .275, edge, collection, r2=.262, vertices=12)
        groups.append(list(set(bpy.context.scene.objects)-start))
    yaw=articulate_aa(mount,collection,frame,groups)
    for side,y,_ in barrel_layout(spec):
        seam=[]
        rim_path=[(2.74,2.30),(2.74,2.43),(2.52,2.63),(1.78,2.85),(1.05,3.08)]
        for i in range(20):
            if i<5: x,z=rim_path[i];dy=.32
            elif i==5: x,z,dy=1.03,3.09,0
            elif i<=10: x,z=rim_path[10-i];dy=-.32
            else:
                x=2.74;dy=[-.32,-.32,-.24,-.12,0,.12,.24,.32,.32][i-11];z=2.10 if i in [11,19] else 1.885
            seam.append((x,y+dy,z))
        create_bloomer(mount,collection,helpers,materials,side,seam,3.15,.228,rings=4,fold_depth=.018,slack=.01,fullness=.10,forward_fullness=.28)
    return yaw

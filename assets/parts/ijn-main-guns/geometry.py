"""Original IJN main-battery turrets as standalone articulated parts.

Yamato 46 cm triple, Yamato 15.5 cm triple and Mogami 20.3 cm E/E3 twin, ported
from the ship recipes to one mount at the origin. No external geometry inputs.
Local metres: +X firing, +Y port, +Z up; origin is the mount datum.
"""
import math
import bpy
from mathutils import Vector
from aa_articulation import articulate_aa
from gun_bloomers import create_bloomer


def _lerp(a, b, t):
    return a + (b - a) * t


def _shell(n, mesh, box, rings, fi, centers, port_half, pz0, pz1, naval, roof, dark, col):
    """Closed faceted gunhouse from stacked rings, front column `fi` pierced by gun ports."""
    m = len(rings[0])
    verts = [v for ring in rings for v in ring]
    faces = [tuple(reversed(range(m)))]
    for j in range(len(rings) - 1):
        for i in range(m):
            if i == fi: continue
            a = j * m + i; b = j * m + (i + 1) % m
            faces.append((a, b, b + m, a + m))
    mesh(n + '.gunhouse', verts, faces, naval, col)
    top = len(rings) - 1
    mesh(n + '.gunhouse.roof', rings[top], [tuple(range(m))], roof, col)
    # Front face profile: (z, x, y at starboard edge, y at port edge) per ring.
    levels = [(r[fi][2], r[fi][0], r[fi][1], r[(fi + 1) % m][1]) for r in rings]
    pz1 = min(pz1, levels[-1][0])
    def at(z):
        for (z0, x0, a0, b0), (z1, x1, a1, b1) in zip(levels, levels[1:]):
            if z <= z1 + 1e-9:
                t = (z - z0) / (z1 - z0)
                return _lerp(x0, x1, t), _lerp(a0, a1, t), _lerp(b0, b1, t)
        return levels[-1][1:]
    cuts = sorted(set([l[0] for l in levels] + [pz0, pz1]))
    gaps = sorted((c - port_half, c + port_half) for c in centers)
    fv = []; ff = []
    def quad(z0, z1, ya0, yb0, ya1, yb1):
        x0 = at(z0)[0]; x1 = at(z1)[0]; k = len(fv)
        fv.extend([(x0, ya0, z0), (x0, yb0, z0), (x1, yb1, z1), (x1, ya1, z1)]); ff.append((k, k + 1, k + 2, k + 3))
    for z0, z1 in zip(cuts, cuts[1:]):
        _, a0, b0 = at(z0); _, a1, b1 = at(z1)
        if z0 >= pz0 - 1e-9 and z1 <= pz1 + 1e-9:
            lo0, lo1 = a0, a1
            for ga, gb in gaps:
                quad(z0, z1, lo0, ga, lo1, ga); lo0 = lo1 = gb
            quad(z0, z1, lo0, b0, lo1, b1)
        else:
            quad(z0, z1, a0, b0, a1, b1)
    mesh(n + '.gunhouse.face', fv, ff, naval, col)
    # Unlit backing so an elevated gun exposes a dark chamber, not the far wall.
    back = min(at(pz0)[0], at(pz1)[0]) - .45
    for c in centers:
        box(n + '.port.chamber', (back, c, (pz0 + pz1) / 2), (.08, port_half * 2 + .5, pz1 - pz0 + .1), dark, col)
    return at


def _ladder(n, rod, a, b, width, edge, col, along=(1, 0, 0)):
    a, b = Vector(a), Vector(b); side = Vector(along) * width / 2
    for s in (-1, 1): rod(n + '.ladder.stringer', a + side * s, b + side * s, .035, edge, col, vertices=6)
    count = max(2, math.ceil((b - a).length / .30))
    for i in range(count):
        p = a.lerp(b, i / (count - 1))
        rod(n + '.ladder.rung', p - side, p + side, .025, edge, col, vertices=6)


def _vent(n, box, x, y, z, width, height, naval, roof, dark, col):
    sign = 1 if y >= 0 else -1
    box(n + '.vent.recess', (x, y, z), (width, .06, height), dark, col)
    for i in range(max(4, int(height / .12))):
        box(n + '.vent.louver', (x, y + sign * .045, z - height / 2 + .08 + i * .12), (width, .13, .045), naval, col)
    box(n + '.vent.hood', (x, y + sign * .06, z + height / 2), (width + .12, .32, .08), roof, col)


def _gun(n, rod, spec, lateral, sections, edge, dark, col):
    """Low-segment turned barrel group at the neutral one-degree elevation."""
    pivot = spec['trunnionForward']; height = spec['pivotHeight']; muzzle = spec['muzzleForward']
    slope = math.tan(math.radians(1))
    def pt(x, dy=0, dz=0): return (x, lateral + dy, height + (x - pivot) * slope + dz)
    for (a, ra), (b, rb) in zip(sections, sections[1:]):
        barrel = rod(n + '.barrel', pt(a), pt(b), ra, edge, col, r2=rb, vertices=16)
        for polygon in barrel.data.polygons: polygon.use_smooth = len(polygon.vertices) == 4
    rm = sections[-1][1]
    rod(n + '.muzzle.face', pt(muzzle - .004), pt(muzzle), rm, edge, col, r2=spec['caliberM'] / 2 * 1.02, vertices=16)
    rod(n + '.bore', pt(muzzle - .002), pt(muzzle + .002), spec['caliberM'] / 2, dark, col, vertices=12)
    # Fabric is built after articulation: its fixed perimeter must remain on
    # the gunhouse while the sleeve follows pitch and the chase recoils inside.


def _covers(mount, col, helpers, materials, face, centers, half, bottom, top, collar_x, radius, frame, groups):
    yaw = articulate_aa(mount, col, frame, groups)
    sides = ['left', 'center', 'right'] if len(centers) == 3 else ['left', 'right']
    for side, lateral in zip(sides, centers):
        rim = []
        for i in range(24):
            angle = i * math.tau / 24
            c, sn = math.cos(angle), math.sin(angle)
            square = max(abs(c), abs(sn))
            z = (top + bottom) / 2 + (top - bottom) / 2 * sn / square
            rim.append((face(z)[0] + .018, lateral + half * c / square, z))
        create_bloomer(mount, col, helpers, materials, side, rim, collar_x, radius,
                       rings=7, fold_depth=.014 if radius < .4 else .045, slack=.025 if radius < .4 else .06,
                       fullness=.085 if radius < .4 else .18, forward_fullness=.035)
    return yaw


def _roof_service(n, rod, cyl, L, W, H, scale, hatch_x, hatch_r, edge, col):
    for sign in (-1, 1):
        for x in (-L * .27, 0):
            y = sign * W * .28; end = x + .65 * scale
            rod(n + '.roof.handhold', (x, y, H + .09), (end, y, H + .09), .025, edge, col, vertices=6)
            for xx in (x, end): rod(n + '.roof.handhold.foot', (xx, y, H - .01), (xx, y, H + .09), .025, edge, col, vertices=6)
        cyl(n + '.roof.hatch', (hatch_x, sign * W * .29, H + .065), hatch_r, .13, edge, col, 12)
        rod(n + '.roof.hatch.hinge', (hatch_x - hatch_r, sign * W * .29 - hatch_r * .5, H + .1), (hatch_x - hatch_r, sign * W * .29 + hatch_r * .5, H + .1), .035, edge, col, vertices=6)
    for x in (-L * .3, -L * .06):
        rod(n + '.roof.seam', (x, -W * .295, H + .008), (x, W * .295, H + .008), .014, edge, col, vertices=6)


def create_yamato_main(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']; n = mount['id']; col = collection
    naval, roof, edge, hullgray, canvas, dark = (materials[k] for k in ['naval', 'roof', 'edge', 'hullgray', 'canvas', 'dark'])
    before = set(bpy.context.scene.objects)
    L, W, H = 14.6, 13.4, 6.7; floor = 2.4
    # The ship's yaw datum is 2.4 m below the gunhouse floor: a rotating stalk
    # fills what the ship's fixed barbette occupied, then the roller race.
    cyl(n + '.stalk', (0, 0, (floor - .25) / 2), spec['barbetteRadius'], floor - .25, naval, col, 32)
    cyl(n + '.roller', (0, 0, floor - .115), 6.525, .27, edge, col, 32)
    for z in (.7, 1.45): cyl(n + '.stalk.band', (0, 0, z), spec['barbetteRadius'] + .025, .09, edge, col, 32)
    rings = [
        [(-7.7, -4.7, 2.4), (-5.8, -6.7, 2.4), (4.7, -6.7, 2.4), (6.9, -4.8, 2.4), (6.9, 4.8, 2.4), (4.7, 6.7, 2.4), (-5.8, 6.7, 2.4), (-7.7, 4.7, 2.4)],
        [(-7.7, -4.7, 4.35), (-5.8, -6.7, 4.35), (3.8, -6.7, 4.35), (6, -4.8, 4.35), (6, 4.8, 4.35), (3.8, 6.7, 4.35), (-5.8, 6.7, 4.35), (-7.7, 4.7, 4.35)],
        [(-7.1, -4.25, 6.7), (-5.5, -5.55, 6.7), (2.6, -5.55, 6.7), (3.45, -4.55, 6.7), (3.45, 4.55, 6.7), (2.6, 5.55, 6.7), (-5.5, 5.55, 6.7), (-7.1, 4.25, 6.7)]]
    centers = [spec['barrelSpacing'], 0, -spec['barrelSpacing']]
    port_half = 1.02; pz0, pz1 = 3.55, 5.45
    face = _shell(n, mesh, box, rings, 3, centers, port_half, pz0, pz1, naval, roof, dark, col)
    # Heavy armoured port frames on the 650 mm face and glacis.
    for c in centers:
        for y in (c - port_half - .05, c + port_half + .05):
            zs = [pz0, 4.35, pz1]
            for za, zb in zip(zs, zs[1:]):
                rod(n + '.port.frame', (face(za)[0] + .03, y, za), (face(zb)[0] + .03, y, zb), .075, naval, col, vertices=8)
        for z in (pz0, pz1):
            rod(n + '.port.frame', (face(z)[0] + .03, c - port_half - .05, z), (face(z)[0] + .03, c + port_half + .05, z), .075, naval, col, vertices=8)
    # Knuckle strake and plate joints.
    knuckle = rings[1]
    for a, b in zip(knuckle, knuckle[1:] + knuckle[:1]):
        if a[0] == 6 and b[0] == 6: continue
        rod(n + '.knuckle', a, b, .04, edge, col, vertices=6)
    # 15 m rangefinder across the rear of the gunhouse, with tapered arms and hoods.
    rx = spec.get('rangefinderForward', -5.3); rz = H - .85; half = spec.get('rangefinderWidth', 15) / 2
    rod(n + '.rangefinder.tube', (rx, -half + .3, rz), (rx, half - .3, rz), .31, naval, col, vertices=12)
    for s in (-1, 1):
        rod(n + '.rangefinder.arm', (rx, s * 5.3, rz), (rx, s * (half - .55), rz), .62, naval, col, r2=.40, vertices=12)
        box(n + '.rangefinder.hood', (rx, s * (half - .1), rz), (1.35, .95, 1.05), naval, col)
        box(n + '.rangefinder.hood.roof', (rx - .02, s * (half - .1), rz + .56), (1.45, 1.05, .08), roof, col)
        box(n + '.rangefinder.aperture', (rx + .68, s * (half - .1), rz + .02), (.03, .5, .42), dark, col)
        box(n + '.rangefinder.shutter.rail', (rx + .69, s * (half - .1), rz + .27), (.04, .62, .05), edge, col)
    _roof_service(n, rod, cyl, L, W, H, 1.5, -2.7, .36, edge, col)
    # Commander's and sighting hoods toward the rear roof corners.
    for s in (-1, 1):
        box(n + '.roof.sight.hood', (-1.2, s * 4.75, H + .2), (1.1, .8, .42), naval, col)
        box(n + '.roof.sight.slit', (-.64, s * 4.75, H + .22), (.02, .5, .16), dark, col)
        cyl(n + '.roof.vent', (-6.2, s * 2.3, H + .16), .3, .32, naval, col, 16)
        cyl(n + '.roof.vent.cap', (-6.2, s * 2.3, H + .35), .4, .07, roof, col, 16)
        # Side sighting ports on the lower side armour.
        box(n + '.side.sight.port', (2.4, s * 6.72, 3.55), (.75, .1, .5), naval, col)
        box(n + '.side.sight.glass', (2.4, s * 6.78, 3.55), (.5, .02, .26), dark, col)
        _ladder(n, rod, (-4.38, s * 6.76, 2.45), (-4.38, s * 6.76, 4.35), .75, edge, col)
        _ladder(n, rod, (-4.38, s * 6.76, 4.35), (-4.38, s * 5.62, 6.68), .75, edge, col)
        _vent(n, box, -1.6, s * 6.7, 3.45, .9, .69, naval, roof, dark, col)
        # Rear access doors in the overhang plates.
        box(n + '.rear.door', (-7.72, s * 2.4, 3.4), (.07, .95, 1.75), naval, col)
        for z in (2.9, 3.9): box(n + '.rear.door.hinge', (-7.77, s * 2.85, z), (.07, .14, .18), edge, col)
        rod(n + '.rear.door.handle', (-7.79, s * 2.05, 3.3), (-7.79, s * 2.05, 3.55), .03, edge, col, vertices=6)
    rod(n + '.rear.rail', (-7.75, -4.2, 4.3), (-7.75, 4.2, 4.3), .03, edge, col, vertices=6)
    for x in (-3.2, .2):
        for s in (-1, 1): rod(n + '.side.seam', (x, s * 6.71, 2.45), (x, s * 6.71, 4.33), .018, edge, col, vertices=6)
    # Plate joins are paint/normal-scale detail at gameplay distance, not
    # proud round rods. Keep actual ladders, sights, hatches and port frames.
    for detail in list(set(bpy.context.scene.objects) - before):
        if '.seam' in detail.name or '.side.rivet' in detail.name:
            bpy.data.objects.remove(detail, do_unlink=True)
    frame = list(set(bpy.context.scene.objects) - before)
    groups = []
    pivot = spec['trunnionForward']; muzzle = spec['muzzleForward']; rad = spec['barrelBaseRadius']
    for lateral in centers:
        start = set(bpy.context.scene.objects)
        sections = [(pivot, rad * .90), (pivot + 2.2, rad * .90), (pivot + 2.25, rad * .83), (pivot + 4.6, rad * .76), (pivot + 4.8, rad * .64),
                    (muzzle - 2.0, rad * .43), (muzzle - .35, rad * .405), (muzzle - .3, rad * .45), (muzzle, rad * .45)]
        _gun(n, rod, spec, lateral, sections, edge, dark, col)
        groups.append(list(set(bpy.context.scene.objects) - start))
    return _covers(mount, col, helpers, materials, face, centers, port_half + .02, pz0 - .02, pz1 + .02, 8.05, .66, frame, groups)


def create_yamato_secondary(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']; n = mount['id']; col = collection
    naval, roof, edge, hullgray, canvas, dark = (materials[k] for k in ['naval', 'roof', 'edge', 'hullgray', 'canvas', 'dark'])
    before = set(bpy.context.scene.objects)
    L, W, H = 6.4, 6.9, 3.45; floor = .25
    def roof_height(x): return 3.45 - max(0, min(5.0, x + 2.368)) * 1.15 / 5.0
    cyl(n + '.roller', (0, 0, floor / 2), spec['barbetteRadius'], floor, edge, col, 32)
    a, b, c, d = 2.368, 3.45, 3.2, 2.618
    rings = [[(-a, -b, floor), (a, -b, floor), (c, -d, floor), (c, d, floor), (a, b, floor), (-a, b, floor), (-c, d, floor), (-c, -d, floor)],
             [(-a, -3.2085, H), (1.718, -3.2085, roof_height(1.718)), (2.55, -2.43474, roof_height(2.55)), (2.55, 2.43474, roof_height(2.55)), (1.718, 3.2085, roof_height(1.718)), (-a, 3.2085, H), (-c, 2.43474, H), (-c, -2.43474, H)]]
    centers = [spec['barrelSpacing'], 0, -spec['barrelSpacing']]
    port_half = .43; pz0, pz1 = .95, roof_height(2.55)
    face = _shell(n, mesh, box, rings, 2, centers, port_half, pz0, pz1, naval, roof, dark, col)
    for cy in centers:
        for y in (cy - port_half - .02, cy + port_half + .02):
            rod(n + '.port.frame', (face(pz0)[0] + .015, y, pz0), (face(pz1)[0] + .015, y, pz1), .04, naval, col, vertices=8)
        for z in (pz0, pz1):
            rod(n + '.port.frame', (face(z)[0] + .015, cy - port_half, z), (face(z)[0] + .015, cy + port_half, z), .04, naval, col, vertices=8)
    # The secondary's eight-metre rangefinder is a continuous armoured
    # roof housing, with deep tapered wings, not a thin exposed optical tube.
    rx=-2.10;rz=H-.08;half=spec.get('rangefinderWidth',8)/2
    outline=[(-.68,-.45),(.58,-.45),(.72,-.22),(.72,.42),(.51,.60),(-.68,.60)]
    k=len(outline);stations=[(-half,.80),(-3.35,1),(-2.2,1),(2.2,1),(3.35,1),(half,.80)]
    vs=[(rx+x*scale,y,rz+z+(0 if abs(y)>3.3 else .14)) for y,scale in stations for x,z in outline]
    fs=[tuple(reversed(range(k))),tuple(range((len(stations)-1)*k,len(stations)*k))]
    fs.extend((j*k+i,j*k+(i+1)%k,(j+1)*k+(i+1)%k,(j+1)*k+i) for j in range(len(stations)-1) for i in range(k))
    mesh(n+'.rangefinder.armoured-housing',vs,fs,naval,col)
    for side in [-1,1]:
        box(n+'.rangefinder.aperture',(rx+.64,side*(half-.22),rz+.05),(.025,.32,.54),dark,col)
        box(n+'.rangefinder.shutter',(rx+.66,side*(half-.22),rz+.06),(.025,.22,.43),edge,col)
        # Short roof rail rooted in the rangefinder crown.
        for yy in [side*.85,side*2.55]:rod(n+'.rangefinder.rail-post',(rx,yy,rz+.58),(rx,yy,rz+1.04),.024,edge,col,vertices=6)
        rod(n+'.rangefinder.rail',(rx,side*.85,rz+1.04),(rx,side*2.55,rz+1.04),.024,edge,col,vertices=6)
    scale = W / 8
    _roof_service(n, rod, cyl, L, W, H, scale, -1.2, .22, edge, col)
    for s in (-1, 1):
        side_y = lambda z: s * (b - (b - 3.2085) * (z - floor) / (H - floor) + .04)
        _ladder(n, rod, (-L * .30 + 1.4, side_y(.35), .35), (-L * .30 + 1.4, side_y(roof_height(-L * .30 + 1.4) - .05), roof_height(-L * .30 + 1.4) - .05), .5 * scale, edge, col)
        if s==1:box(n+'.roof.sight.hood',(.1,0,roof_height(.1)+.14),(.65,.62,.28),naval,col)
        for x in (-1.0, 1.0): rod(n + '.side.seam', (x, side_y(floor + .03) - s * .03, floor + .03), (x, side_y(H - .02) - s * .03, H - .02), .013, edge, col, vertices=6)
    cyl(n + '.roof.vent', (-2.55, 0, H + .12), .2, .24, naval, col, 16)
    cyl(n + '.roof.vent.cap', (-2.55, 0, H + .26), .27, .05, roof, col, 16)
    for ob in set(bpy.context.scene.objects) - before:
        if '.roof.' in ob.name and ob.type == 'MESH' and '.gunhouse.' not in ob.name:
            ob.location.z += roof_height(ob.location.x) - H
    # Plate joins are paint/normal-scale detail at gameplay distance, not
    # proud round rods. Keep actual ladders, sights, hatches and port frames.
    for detail in list(set(bpy.context.scene.objects) - before):
        if '.seam' in detail.name or '.side.rivet' in detail.name:
            bpy.data.objects.remove(detail, do_unlink=True)
    frame = list(set(bpy.context.scene.objects) - before)
    groups = []
    pivot = spec['trunnionForward']; muzzle = spec['muzzleForward']; rad = spec['barrelBaseRadius']
    for lateral in centers:
        start = set(bpy.context.scene.objects)
        sections = [(pivot, rad * .88), (pivot + 1.45, rad * .88), (pivot + 1.5, rad * .80), (pivot + 2.4, rad * .74), (pivot + 2.6, rad * .62),
                    (muzzle - 2.0, rad * .44), (muzzle - .2, rad * .41), (muzzle - .17, rad * .46), (muzzle, rad * .46)]
        _gun(n, rod, spec, lateral, sections, edge, dark, col)
        groups.append(list(set(bpy.context.scene.objects) - start))
    return _covers(mount, col, helpers, materials, face, centers, port_half + .02, pz0 - .02, pz1, 3.85, .27, frame, groups)


def create_mogami_main(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']; n = mount['id']; col = collection
    naval, roof, edge, hullgray, canvas, dark = (materials[k] for k in ['naval', 'roof', 'edge', 'hullgray', 'canvas', 'dark'])
    rangefinder = '-e-twin' in (mount.get('partId') or spec.get('id', ''))
    before = set(bpy.context.scene.objects)
    cyl(n + '.roller', (0, 0, .03), spec['barbetteRadius'], .06, edge, col, 32)
    for i in range(24):
        t = i * math.tau / 24; r = spec['barbetteRadius']
        rod(n + '.roller.fastener', (r * math.cos(t), r * math.sin(t), .03), ((r + .025) * math.cos(t), (r + .025) * math.sin(t), .03), .03, edge, col, vertices=6)
    # Rounded-corner footprint swept through five levels; the face curves back to the roof.
    k = .339411254969543; q = .1405887450304571
    def ring(front, rear, half, z):
        return [(front, half - .48, z), (front - q, half - q, z), (front - .48, half, z), (rear + .48, half, z), (rear + q, half - q, z), (rear, half - .48, z),
                (rear, -half + .48, z), (rear + q, -half + q, z), (rear + .48, -half, z), (front - .48, -half, z), (front - q, -half + q, z), (front, -half + .48, z)]
    rings = [ring(2.6697, -5.456, 2.8342, .04), ring(2.4791, -5.36, 2.695, 1), ring(2.0131, -5.29, 2.5935, 1.7),
             ring(1.5457, -5.26, 2.55, 2), ring(1.2718, -5.253, 2.53985, 2.07)]
    gap = spec['barrelSpacing'] / 2; centers = [gap, -gap]; port_half = .56
    face = _shell(n, mesh, box, rings, 11, centers, port_half, .45, 2.07, naval, roof, dark, col)
    for gy in centers:
        for y in (gy - .585, gy + .585):
            zs = [.45, .75, 1.0, 1.4, 1.7, 1.9, 2.0, 2.07]
            for za, zb in zip(zs, zs[1:]):
                rod(n + '.port.rim', (face(za)[0] + .025, y, za), (face(zb)[0] + .025, y, zb), .04, edge, col, vertices=8)
        rod(n + '.port.sill', (face(.45)[0] + .025, gy - .585, .45), (face(.45)[0] + .025, gy + .585, .45), .04, edge, col, vertices=8)
        box(n + '.port.top.rim', (1.43, gy, 2.10), (.45, 1.26, .10), naval, col)
        for y in (gy - .46, gy + .46):
            rod(n + '.mantlet.cheek.pivot', (1.62, y, 1.28), (1.92, y, 1.28), .16, edge, col, vertices=12)
    # Flat roof, central sight, narrow plate joints and restrained fasteners.
    cyl(n + '.roof.sight.drum', (-1.05, 0, 2.22), .39, .28, naval, col, 24)
    box(n + '.roof.sight.hood', (-.95, 0, 2.38), (.88, .74, .17), naval, col)
    box(n + '.roof.sight.glass', (-.495, 0, 2.35), (.018, .55, .13), dark, col)
    for x in (-4.5, -2.7, -.4): rod(n + '.roof.seam', (x, -2.42, 2.085), (x, 2.42, 2.085), .013, edge, col, vertices=6)
    for y in (-1.55, 1.55): rod(n + '.roof.seam.long', (-4.9, y, 2.085), (.80, y, 2.085), .013, edge, col, vertices=6)
    def side_y(z):
        for (z0, h0), (z1, h1) in zip([(.04, 2.8342), (1, 2.695), (1.7, 2.5935), (2, 2.55)], [(1, 2.695), (1.7, 2.5935), (2, 2.55), (2.07, 2.53985)]):
            if z <= z1: return _lerp(h0, h1, (z - z0) / (z1 - z0))
        return 2.53985
    for s in (-1, 1):
        for x in (-4.65, -3.35, -2.05, -.75, .5):
            for za, zb in [(.12, 1), (1, 1.7), (1.7, 1.95)]:
                rod(n + '.side.seam', (x, s * (side_y(za) + .004), za), (x, s * (side_y(zb) + .004), zb), .013, edge, col, vertices=6)
            for z in (.22, .51, .8, 1.09, 1.38, 1.67, 1.88):
                y = s * (side_y(z) + .002)
                rod(n + '.side.rivet', (x + .06, y, z), (x + .06, y + s * .022, z), .022, edge, col, vertices=6)
        rod(n + '.side.seam.horizontal', (-4.7, s * 2.697, 1.0), (.6, s * 2.697, 1.0), .013, edge, col, vertices=6)
        box(n + '.rear.access', (-5.335, s * .93, 1.04), (.045, .65, 1.3), naval, col)
        for z in (.56, 1.10, 1.63): box(n + '.rear.hinge', (-5.365, s * 1.24, z), (.065, .12, .14), edge, col)
        rod(n + '.rear.handle', (-5.38, s * .8, .92), (-5.38, s * .8, 1.14), .027, edge, col, vertices=6)
        cyl(n + '.roof.hatch', (-3.6, s * 1.9, 2.10), .27, .07, roof, col, 12)
    if rangefinder:
        rod(n + '.rangefinder.tube', (-3.9, -4.15, 1.85), (-3.9, 4.15, 1.85), .18, naval, col, vertices=12)
        for s in (-1, 1):
            y = s * 4.09
            box(n + '.rangefinder.hood', (-4.10, y, 1.94), (1.74, .49, .96), naval, col)
            box(n + '.rangefinder.hood.roof', (-4.12, y, 2.44), (1.82, .57, .05), roof, col)
            box(n + '.rangefinder.glass', (-3.222, y, 1.95), (.018, .26, .31), dark, col)
            rod(n + '.rangefinder.bearing', (-3.9, s * 2.52, 1.85), (-3.9, s * 3.55, 1.85), .28, naval, col, vertices=12)
            rod(n + '.rangefinder.brace', (-3.9, s * 3.4, 1.62), (-3.9, s * 2.72, .95), .06, naval, col, vertices=8)
    # Plate joins are paint/normal-scale detail at gameplay distance, not
    # proud round rods. Keep actual ladders, sights, hatches and port frames.
    for detail in list(set(bpy.context.scene.objects) - before):
        if '.seam' in detail.name or '.side.rivet' in detail.name:
            bpy.data.objects.remove(detail, do_unlink=True)
    frame = list(set(bpy.context.scene.objects) - before)
    groups = []
    pivot = spec['trunnionForward']; muzzle = spec['muzzleForward']; rad = spec['barrelBaseRadius']
    tip = max(rad * .40, spec['caliberM'] / 2 * 1.32)
    for lateral in centers:
        start = set(bpy.context.scene.objects)
        sections = [(pivot, rad * .86), (pivot + 2.4, rad * .80), (pivot + 2.6, rad * .70), (muzzle - 2.0, tip * 1.08), (muzzle, tip)]
        # Broad fabric bag with a drooping middle and narrow barrel collar.
        _gun(n, rod, spec, lateral, sections, edge, dark, col)
        groups.append(list(set(bpy.context.scene.objects) - start))
    return _covers(mount, col, helpers, materials, face, centers, port_half + .02, .43, 2.07, pivot + 2.03, .245, frame, groups)

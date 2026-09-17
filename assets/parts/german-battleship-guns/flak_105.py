"""Original 10.5 cm SK C/33 twin heavy AA as fitted in the Bismarck ship script.

Local metres: +X firing, +Y port, +Z up. Open-backed slotted shield on a
stabilised pedestal, twin close-set cradles, fuze-setting machines, layer and
trainer stations. No external geometry inputs.
"""
import math
import bpy
from mathutils import Vector
from aa_articulation import articulate_aa


def create_mount(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval)
    before = set(bpy.context.scene.objects)

    def plate(name, pts, offset, material):
        # Closed plate: `pts` is the outer face, `offset` points to the inner face.
        pts = [Vector(p) for p in pts]; offset = Vector(offset); k = len(pts)
        normal = Vector((0, 0, 0))
        for a, b in zip(pts, pts[1:]+pts[:1]):
            normal += Vector(((a.y-b.y)*(a.z+b.z), (a.z-b.z)*(a.x+b.x), (a.x-b.x)*(a.y+b.y)))
        if normal.dot(offset) > 0: pts.reverse()
        verts = [tuple(p) for p in pts]+[tuple(p+offset) for p in pts]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2*k)))]
        faces += [(i, i+k, (i+1) % k+k, (i+1) % k) for i in range(k)]
        return mesh(n+name, verts, faces, material, collection)

    def wheel(name, center, radius, axis):
        # Handwheel rim and spokes from short rods; axis is 'x' or 'y'.
        c = Vector(center); seg = 12
        def p(i):
            a = math.tau*i/seg
            return c+(Vector((0, math.cos(a), math.sin(a))) if axis == 'x' else Vector((math.cos(a), 0, math.sin(a))))*radius
        for i in range(seg): rod(n+name+'.rim', p(i), p(i+1), .022, edge, collection, vertices=6)
        for i in (0, 4, 8): rod(n+name+'.spoke', c, p(i), .016, edge, collection, vertices=6)

    pivot, height, muzzle = spec['trunnionForward'], spec['pivotHeight'], spec['muzzleForward']
    half = spec['barrelSpacing']/2
    # Deck ring, training drum and the crew platform that turns with the mount.
    cyl(n+'.deck.ring', (0, 0, .10), spec['barbetteRadius'], .20, edge, collection, 48)
    cyl(n+'.training.drum', (0, 0, .33), 1.12, .28, naval, collection, 32)
    deck = [(1.28,-1.47),(1.28,1.47),(-1.25,1.47),(-1.55,.95),(-1.55,-.95),(-1.25,-1.47)]
    plate('.platform', [(x, y, .58) for x, y in deck], (0, 0, -.12), roof)
    for s in [-1, 1]:
        for x in [-.9, .6]:
            rod(n+'.platform.knee', (x*.6, s*.9, .30), (x, s*1.40, .47), .05, naval, collection, vertices=8)
    # Stabilised pedestal, saddle and the two trunnion cheeks.
    cyl(n+'.pedestal', (0, 0, .70), .46, .26, naval, collection, 24, r2=.36)
    rod(n+'.crosshead', (0, -.92, .70), (0, .92, .70), .10, naval, collection, vertices=12)
    box(n+'.stabiliser.gearbox', (.45, 0, .74), (.5, .5, .32), naval, collection)
    cheek = [(-.42,.58),(.62,.58),(.36,1.78),(.12,1.86),(-.12,1.78)]
    for s in [-1, 1]:
        plate('.trunnion.cheek', [(x, s*.90, z) for x, z in cheek], (0, -s*.12, 0), naval)
        rod(n+'.trunnion.cap', (pivot, s*.89, height), (pivot, s*.96, height), .17, edge, collection, vertices=16)
        rod(n+'.trunnion.axle', (pivot, s*.58, height), (pivot, s*.80, height), .12, edge, collection, vertices=12)
    # Open-backed sloped shield with two continuous gun slots through the
    # front, brow and overhead plates (the guns elevate to 80 degrees).
    t = .035
    cross = [(-1.25,.58),(1.28,.58),(1.17,1.95),(.63,2.44),(-1.12,2.44)]
    for s in [-1, 1]:
        plate('.shield.side', [(x, s*1.47, z) for x, z in cross], (0, -s*t, 0), naval)
        for x in [-.55, .35]:
            rod(n+'.shield.stiffener', (x, s*1.485, .62), (x, s*1.485, 2.40), .025, naval, collection, vertices=6)
        rod(n+'.shield.grab', (-1.0, s*1.52, 1.5), (-.2, s*1.52, 1.5), .018, edge, collection, vertices=6)
        for x in [-1.0, -.2]:
            rod(n+'.shield.grab.foot', (x, s*1.47, 1.5), (x, s*1.52, 1.5), .016, edge, collection, vertices=6)
    slot = .19
    strips = [(-1.47, -half-slot), (-half+slot, half-slot), (half+slot, 1.47)]
    inward = lambda a, b: Vector((-(b[1]-a[1]), 0, b[0]-a[0])).normalized()*t
    for a, b in zip(cross[1:3], cross[2:4]):
        for lo, hi in strips:
            plate('.shield.strip', [(a[0], lo, a[1]), (a[0], hi, a[1]), (b[0], hi, b[1]), (b[0], lo, b[1])], inward(a, b), naval)
    roof_break = -.05
    for lo, hi in strips:
        plate('.shield.roof.strip', [(.63, lo, 2.44), (.63, hi, 2.44), (roof_break, hi, 2.44), (roof_break, lo, 2.44)], (0, 0, -t), naval)
    plate('.shield.roof', [(roof_break, -1.47, 2.44), (roof_break, 1.47, 2.44), (-1.12, 1.47, 2.44), (-1.12, -1.47, 2.44)], (0, 0, -t), naval)
    sill_x = 1.28-(.74-.58)*.11/(1.95-.58)
    plate('.shield.sill', [(1.28, -1.47, .58), (1.28, 1.47, .58), (sill_x, 1.47, .74), (sill_x, -1.47, .74)], (-t, 0, 0), naval)
    for lo, hi in strips:
        # Brow grab rails stop short of the gun slots.
        rod(n+'.shield.brow.rail', (.92, lo+.08, 2.24), (.92, hi-.08, 2.24), .018, edge, collection, vertices=6)
        for y in [lo+.08, hi-.08]:
            rod(n+'.shield.brow.rail.foot', (.86, y, 2.17), (.92, y, 2.24), .016, edge, collection, vertices=6)
    for s in [-1, 1]:
        # Layer / trainer telescopes look through shuttered ports in the front plate.
        y = s*1.16
        face = 1.28-.11*(1.80-.58)/1.37
        box(n+'.sight.port', (face+.005, y, 1.80), (.03, .26, .20), dark, collection)
        box(n+'.sight.shutter', (face+.02, y, 1.95), (.03, .30, .08), naval, collection)
        rod(n+'.sight.telescope', (.30, y, 1.80), (face-.05, y, 1.80), .055, edge, collection, vertices=10)
        rod(n+'.sight.eyepiece', (.12, y, 1.80), (.30, y, 1.80), .04, dark, collection, vertices=10)
        rod(n+'.sight.bracket', (.45, y, 1.75), (.30, s*.92, 1.55), .035, naval, collection, vertices=6)
        # Seats, handwheels and footrests for the two layers.
        cyl(n+'.crew.seat', (-.45, y, 1.02), .21, .08, roof, collection, 16)
        box(n+'.crew.seat.back', (-.66, y, 1.22), (.05, .36, .34), roof, collection)
        rod(n+'.crew.seat.post', (-.45, y, .58), (-.45, y, .98), .045, edge, collection, vertices=8)
        wheel('.handwheel', (.02, y, 1.30), .19, 'y')
        rod(n+'.handwheel.shaft', (.02, s*.92, 1.30), (.02, y+s*.04, 1.30), .03, edge, collection, vertices=8)
        box(n+'.footrest', (.30, y, .66), (.30, .34, .04), edge, collection)
        # Fuze-setting machine at each rear corner: cabinet, three shell cups, drive.
        fx, fy = -1.02, s*1.08
        box(n+'.fuze.setter', (fx, fy, .86), (.50, .62, .56), naval, collection)
        box(n+'.fuze.setter.dial', (fx-.255, fy, .98), (.02, .30, .18), dark, collection)
        for i in range(3):
            c = (fx, fy+(i-1)*.19, 1.14)
            cyl(n+'.fuze.cup', (c[0], c[1], 1.20), .075, .13, edge, collection, 12)
            cyl(n+'.fuze.cup.bore', (c[0], c[1], 1.267), .055, .004, dark, collection, 12)
        rod(n+'.fuze.drive', (fx+.25, fy, .80), (-.10, s*.84, .80), .035, edge, collection, vertices=8)
        # Rear safety rails leave the loading gangway clear between the breeches.
        posts = [(-1.25, s*1.45), (-1.53, s*.95), (-1.53, s*.42)]
        for px, py in posts:
            rod(n+'.rail.post', (px, py, .58), (px, py, 1.50), .022, edge, collection, vertices=6)
        for z in [1.04, 1.50]:
            for (ax, ay), (bx, by) in zip(posts, posts[1:]):
                rod(n+'.rail', (ax, ay, z), (bx, by, z), .018, edge, collection, vertices=6)
    # Open ring sight on the mount centreline, from the ship script.
    rod(n+'.ring.sight.bracket', (-.12, 0, .78), (-.42, 0, 2.10), .03, edge, collection, vertices=6)
    for i in range(12):
        a, b = (Vector((-.42, .11*math.cos(math.tau*j/12), 2.21+.11*math.sin(math.tau*j/12))) for j in (i, i+1))
        rod(n+'.ring.sight', a, b, .013, edge, collection, vertices=5)
    frame = list(set(bpy.context.scene.objects)-before)

    groups = []
    tilt = math.radians(1)
    for lateral in [half, -half]:
        start = set(bpy.context.scene.objects)
        origin = Vector((pivot, lateral, height)); along = Vector((math.cos(tilt), 0, math.sin(tilt)))
        up = Vector((-math.sin(tilt), 0, math.cos(tilt)))
        def pt(d, v=0.0): return origin+along*d+up*v
        def block(name, d, v, size, material):
            ob = box(n+name, pt(d, v), size, material, collection); ob.rotation_euler.y = -tilt; return ob
        # Cradle sleeve, breech ring and block, loading tray.
        rod(n+'.cradle', pt(-.55), pt(.62), .185, naval, collection, vertices=20)
        rod(n+'.cradle.collar', pt(.62), pt(.70), .205, edge, collection, vertices=20)
        rod(n+'.breech.ring', pt(-.80), pt(-.55), .20, edge, collection, vertices=20)
        block('.breech.block', -.76, 0, (.30, .30, .44), edge)
        block('.loading.tray', -1.0, -.12, (.34, .22, .05), naval)
        # Recuperator above and recoil brake below the sleeve.
        rod(n+'.recuperator', pt(-.45, .25), pt(.85, .25), .075, naval, collection, vertices=12)
        rod(n+'.recoil.brake', pt(-.30, -.25), pt(.95, -.25), .095, naval, collection, vertices=12)
        for d in (.05, .62):
            rod(n+'.recoil.yoke', pt(d, -.25), pt(d, .25), .07, naval, collection, vertices=8)
        rod(n+'.trunnion.boss', origin-Vector((0, .20, 0)), origin+Vector((0, .20, 0)), .13, edge, collection, vertices=12)
        # Stepped jacket, tapered chase and bored muzzle.
        length = muzzle-pivot
        sections = [(.55, .118), (1.55, .110), (1.62, .094), (length-.30, .070), (length-.26, .078), (length, .078)]
        for (a, ra), (b, rb) in zip(sections, sections[1:]):
            rod(n+'.barrel', pt(a), pt(b), ra, edge, collection, r2=rb, vertices=24)
        rod(n+'.bore', pt(length+.003), pt(length+.007), spec['caliberM']/2, dark, collection, vertices=24)
        groups.append(list(set(bpy.context.scene.objects)-start))
    return articulate_aa(mount, collection, frame, groups)

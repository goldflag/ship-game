"""Original 15 cm SK C/28 twin in the Drh LC/34 gunhouse; no external geometry inputs.

Local metres: +X firing, +Y port, +Z up. The faceted house (rear roof ridge,
forward slopes, clipped front corners) and its fittings follow the Bismarck
ship script's secondary battery. Hull installation owns the fixed barbette.
"""
import math
import bpy
from aa_articulation import articulate_aa
from gun_bloomers import create_bloomer
from blender_barrels import barrel_layout


def create_mount(mount, collection, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval)
    canvas = materials.get('canvas', dark)
    before = set(bpy.context.scene.objects)
    # Roller path mates to the ship's fixed cylindrical barbette.
    cyl(n+'.roller', (0, 0, .125), spec['barbetteRadius'], .25, edge, collection, 64)
    v = [(-3.9,-2.15,.25),(2,-2.55,.25),(2.75,-1.7,.25),(2.75,1.7,.25),(2,2.55,.25),(-3.9,2.15,.25),
         (-3.82,-2.02,2.18),(-1.2,-2.21,2.6),(1.95,-2.43,2.08),(2.55,-1.6,1.85),
         (2.55,1.6,1.85),(1.95,2.43,2.08),(-1.2,2.21,2.6),(-3.82,2.02,2.18)]
    # The front plate is built separately around the two gun ports.
    walls = [(5,4,3,2,1,0),(0,1,8,7,6),(1,2,9,8),(3,4,11,10),(4,5,13,12,11),(5,0,6,13)]
    mesh(n+'.gunhouse', v, walls, naval, collection)
    mesh(n+'.roof', v, [(6,7,12,13),(7,8,11,12),(8,9,10,11)], roof, collection)
    lateral = [spec['barrelSpacing']/2, -spec['barrelSpacing']/2]
    fx = lambda z: 2.75-.2*(z-.25)/1.6
    fy = lambda z: 1.7-.1*(z-.25)/1.6
    def panel(name, y0, y1, z0, z1, e0=False, e1=False):
        a0, a1 = (-fy(z0) if e0 else y0), (fy(z0) if e1 else y1)
        b0, b1 = (-fy(z1) if e0 else y0), (fy(z1) if e1 else y1)
        mesh(n+name, [(fx(z0),a0,z0),(fx(z0),a1,z0),(fx(z1),b1,z1),(fx(z1),b0,z1)], [(0,1,2,3)], naval, collection)
    port_w, port_lo, port_hi = .27, .80, 1.52
    panel('.front.sill', 0, 0, .25, port_lo, True, True)
    panel('.front.brow', 0, 0, port_hi, 1.85, True, True)
    panel('.front.web', 0, lateral[1]-port_w, port_lo, port_hi, True, False)
    panel('.front.web', lateral[1]+port_w, lateral[0]-port_w, port_lo, port_hi)
    panel('.front.web', lateral[0]+port_w, 0, port_lo, port_hi, False, True)
    # Dark cradle well behind the ports, closed off by the blast bags.
    box(n+'.port.well', (2.28, 0, 1.2), (.06, 3.1, 1.0), dark, collection)
    # Access rungs climb the face between the ports; grabs on the clipped cheeks.
    for z in [.5+i*.3 for i in range(5)]:
        rod(n+'.face.rung', (fx(z)+.07, -.2, z), (fx(z)+.07, .2, z), .022, edge, collection, vertices=6)
        for y in [-.2, .2]:
            rod(n+'.face.rung.foot', (fx(z)-.01, y, z), (fx(z)+.07, y, z), .02, edge, collection, vertices=6)
    for s in [-1, 1]:
        ca, cb = (2.12+.07, s*(2.47+.06), 1.45), (2.62+.07, s*(1.90+.06), 1.45)
        rod(n+'.cheek.grab', ca, cb, .022, edge, collection, vertices=6)
        for q in [ca, cb]:
            rod(n+'.cheek.grab.foot', (q[0]-.12, q[1]-s*.1, q[2]), q, .02, edge, collection, vertices=6)
        # Vertical plate joints on the long side walls.
        for x in [-2.0, .6]:
            w = 2.15+(x+3.9)*.4/5.9
            rod(n+'.side.seam', (x, s*(w+.005), .3), (x, s*(w-.107), 2.25), .016, edge, collection, vertices=5)
    # Rear access hatch and ladder, carried by the yawing shell.
    box(n+'.rear.hatch', (-3.90, 0, 1.12), (.07, .78, 1.18), edge, collection)
    box(n+'.rear.hatch.inset', (-3.945, 0, 1.12), (.035, .63, 1.02), naval, collection)
    for z in [.72, 1.52]:
        rod(n+'.rear.hatch.dog', (-3.97, .2, z), (-3.97, .34, z), .025, edge, collection, vertices=6)
    rear = lambda z: -3.94+.08*(z-.25)/1.93
    for y in [-1.25, -.73]:
        rod(n+'.rear.ladder.rail', (rear(.3)-.03, y, .3), (rear(2.2)-.03, y, 2.2), .025, edge, collection, vertices=6)
    for z in [.42+i*.26 for i in range(7)]:
        rod(n+'.rear.ladder.rung', (rear(z)-.03, -1.25, z), (rear(z)-.03, -.73, z), .022, edge, collection, vertices=6)
    for y in [1.0, 1.5]:
        box(n+'.rear.vent', (-3.93, y, 1.55), (.12, .34, .46), naval, collection)
    side = lambda x: 2.15+(x+3.9)*.4/5.9
    for s in [-1, 1]:
        # Covered gunlayer sights and floor drains on the near-vertical walls.
        box(n+'.side.sight', (-.25, s*(side(-.25)-.10), 1.52), (.63, .16, .32), naval, collection)
        box(n+'.side.sight.glass', (.075, s*(side(-.25)-.10), 1.52), (.026, .10, .14), dark, collection)
        for x in [-2.7, -.6, 1.2]:
            box(n+'.side.drain', (x, s*(side(x)-.015), .39), (.22, .05, .065), dark, collection)
        # Roof hatches on the rear roof and grab rails along the ridge flanks.
        rod(n+'.roof.grab', (-3.4, s*1.92, 2.34), (-1.6, s*2.05, 2.62), .02, edge, collection, vertices=6)
        for x, z in [(-3.4, 2.34), (-1.6, 2.62)]:
            rod(n+'.roof.grab.foot', (x, s*(1.92 if x < -2 else 2.05), z-.12), (x, s*(1.92 if x < -2 else 2.05), z), .018, edge, collection, vertices=6)
        if mount.get('rangefinder', False):
            # Transverse rangefinder: arm through the wall with a modest armored hood.
            rx, half, rz = spec.get('rangefinderForward', -1.95), spec.get('rangefinderWidth', 6.5)/2, 1.75
            rod(n+'.rangefinder.arm', (rx, s*2.0, rz), (rx, s*(half-.2), rz), .22, naval, collection, vertices=12)
            hood = [(-.42,-.30),(.30,-.30),(.42,-.12),(.42,.20),(.26,.32),(-.42,.32)]
            y0, y1 = sorted([s*(half-.45), s*half])
            hv = [(rx+a, y, rz+b) for y in [y0, y1] for a, b in hood]
            k = len(hood)
            mesh(n+'.rangefinder.hood', hv, [tuple(range(k)), tuple(reversed(range(k, 2*k)))]
                 + [(i, i+k, (i+1) % k+k, (i+1) % k) for i in range(k)], naval, collection)
            rod(n+'.rangefinder.bezel', (rx+.40, s*(half-.225), rz+.04), (rx+.45, s*(half-.225), rz+.04), .13, edge, collection, vertices=12)
            rod(n+'.rangefinder.glass', (rx+.45, s*(half-.225), rz+.04), (rx+.457, s*(half-.225), rz+.04), .09, dark, collection, vertices=12)
    # The no-rangefinder source has a low rear access cover, without the
    # former raised periscope/vent cluster and decorative roof seam rods.
    box(n+'.roof.access',(-2.85,.70,2.355),(.65,.58,.06),naval,collection)
    frame = list(set(bpy.context.scene.objects)-before)
    groups = []
    pivot, height, muzzle = spec['trunnionForward'], spec['pivotHeight'], spec['muzzleForward']
    slope = math.tan(math.radians(1))
    for y in lateral:
        start = set(bpy.context.scene.objects)
        def pt(x): return (x, y, height+(x-pivot)*slope)
        rad = spec.get('barrelBaseRadius', .25)
        sections = [(pivot-.45, rad*.76), (pivot+1.72, rad*.76), (pivot+1.80, rad*.64), (muzzle-1.4, rad*.43), (muzzle-.12, rad*.40), (muzzle-.10, rad*.46), (muzzle, rad*.46)]
        for (a, ra), (b, rb) in zip(sections, sections[1:]):
            rod(n+'.barrel', pt(a), pt(b), ra, edge, collection, r2=rb, vertices=16)
        rod(n+'.bore', pt(muzzle+.004), pt(muzzle+.008), spec['caliberM']/2, dark, collection, vertices=12)
        groups.append(list(set(bpy.context.scene.objects)-start))
    yaw = articulate_aa(mount, collection, frame, groups)
    for side,y,_ in barrel_layout(spec):
        seam=[]
        for i in range(16):
            a=i*math.tau/16;ca,sa=math.cos(a),math.sin(a)
            scale=1/max(abs(ca),abs(sa));z=1.16+.38*sa*scale
            seam.append((fx(z)+.016,y+.285*ca*scale,z))
        create_bloomer(mount,collection,helpers,materials,side,seam,pivot+1.10,.194,rings=4,fold_depth=.02,slack=.02)
    return yaw

"""Original open US naval mounts. Catalog dimensions and stable runtime joints.

Pedestal, breech, recoil slide and sights are independently authored primitives.
These are geometrical reconstructions, not imported commercial model components.
The Mk21/Mk24, defensive 3-inch modification, 1.1-inch and pom-pom source
registrations are related-variant references. Their open support wells and
receiver details are independent approximations, not certified exact mount fits.
"""
import math
import bpy
from blender_barrels import barrel_layout


def create_open_mount(mount, col, helpers, materials):
    mesh, cyl, raw_rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    def rod(*args, **kwargs):
        kwargs.setdefault('vertices', 8)
        return raw_rod(*args, **kwargs)
    spec = mount['weapon']
    style = spec['mountingStyle']
    gray, dark, steel = (materials[k] for k in ['naval', 'dark', 'edge'])
    count = spec.get('barrelCount', 2)
    name = mount['id']
    before = set(bpy.context.scene.objects)

    def empty(suffix, parent=None, loc=(0, 0, 0)):
        o = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(o)
        o['nodeId'] = o.name
        o['assemblyId'] = name
        o.parent = parent
        o.location = loc
        return o

    def attach(obj, parent):
        # Helpers author local coordinates; assign parent without preserving world.
        obj.parent = parent
        obj['assemblyId'] = name
        return obj

    def cheek(suffix, profile, lateral, thickness, parent, material=None):
        vertices = [(x, y, z) for y in [lateral-thickness/2, lateral+thickness/2] for x, z in profile]
        n = len(profile)
        faces = [tuple(range(n-1, -1, -1)), tuple(range(n, 2*n))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        return attach(mesh(name+'.'+suffix, vertices, faces, material or gray, col), parent)

    def wheel(suffix, center, radius, parent):
        # One connected triangular-section rim: no hidden cylinder end caps.
        vertices=[]
        for i in range(10):
            a=i*math.tau/10
            for j in range(3):
                b=j*math.tau/3
                r=radius+.016*math.cos(b)
                vertices.append((center[0]+r*math.cos(a),center[1]+.016*math.sin(b),center[2]+r*math.sin(a)))
        faces=[(i*3+j, ((i+1)%10)*3+j, ((i+1)%10)*3+(j+1)%3, i*3+(j+1)%3) for i in range(10) for j in range(3)]
        attach(mesh(name+'.'+suffix,vertices,faces,steel,col,True),parent)
        side = 1 if center[1] >= 0 else -1
        attach(rod(name+'.'+suffix+'-hub', (center[0],center[1]-side*.16,center[2]), (center[0],center[1]+side*.03,center[2]),.045,steel,col,vertices=6),parent)
        for angle in [0,math.tau/3,2*math.tau/3]:
            attach(rod(name+'.'+suffix+'-spoke',center,(center[0]+radius*math.cos(angle),center[1],center[2]+radius*math.sin(angle)),.012,steel,col,vertices=4),parent)

    x, y, z = mount['position']
    root = empty('base', loc=(-z, -x, y))
    yaw = empty('yaw', root)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    r = spec['barbetteRadius']
    trunnion, height = spec['trunnionForward'], spec['pivotHeight']
    width = spec['gunhouseSize'][1]
    hand_trained = spec['caliberM'] <= .020
    fork = min(width * .36, .19) if hand_trained else width * .36
    if spec['id']=='us-3in50-single':fork*=.63
    open_well = spec['id'] in ['us-5in38-mk21-single','us-3in50-single','us-11in75-quad','qf-2pdr-mkvi-octuple']
    if open_well:
        # A hollow rotating bed gives the descending breech a real rear well.
        # Continuous side webs carry the bearing cheeks from the foot/platform;
        # the front cross-member stays ahead of the full recoil/elevation sweep.
        inner = .62 if spec['id']=='us-5in38-mk21-single' else .43
        sides=20 if spec['id']=='us-5in38-mk21-single' else 12
        vertices=[(radius*math.cos(i*math.tau/sides),radius*math.sin(i*math.tau/sides),z)
                  for z in [0,.20] for radius in [inner,r] for i in range(sides)]
        faces=[]
        for i in range(sides):
            j=(i+1)%sides
            faces += [(i,j,sides+j,sides+i),(2*sides+i,3*sides+i,3*sides+j,2*sides+j),
                      (i,2*sides+i,2*sides+j,j),(sides+i,sides+j,3*sides+j,3*sides+i)]
        attach(mesh(name+'.foundation',vertices,faces,steel,col),root)
        foot=.31 if style=='pom-pom' else .20
        for sign in [-1,1]:
            cheek('open-bed-web',[(trunnion-.38,foot),(trunnion+.25,foot),
                                  (trunnion+.34,height*.59),(trunnion-.36,height*.59)],
                  sign*fork,.13,yaw)
            attach(box(name+'.carriage-side-rail',(.20,sign*fork,height*.43),
                       (1.30,.16,.18),gray,col),yaw)
        attach(box(name+'.carriage-front-crossmember',(.75,0,height*.43),
                   (.16,fork*2+.16,.18),gray,col),yaw)
    else:
        attach(cyl(name + '.foundation', (0, 0, .10), r, .20, steel, col, 16), root)
        attach(cyl(name + '.pedestal', (0, 0, height * .36), r * .52,
                   height * .65, gray, col, 12, r2=r * .34), yaw)
        attach(box(name + '.carriage-saddle', (trunnion * .5, 0, height * .51),
                   (max(.32, trunnion + .24), fork * 2 + .12, height * .20), gray, col), yaw)
    for side in [-1, 1]:
        cheek('cradle', [(trunnion-.40,height*.46),(trunnion+.28,height*.46),
                         (trunnion+.20,height+.12),(trunnion-.12,height+.14),
                         (trunnion-.48,height*.67)], side*fork, .12, yaw)
        attach(rod(name + '.trunnion-cover', (trunnion, side * (fork-.08), height),
                   (trunnion, side * (fork+.10), height),
                   .16 if style == 'open-pedestal' else .07, steel, col, vertices=12), yaw)
        if not hand_trained and not (spec['id']=='us-3in50-single' and side==-1):
            seat_y = side * width * .40
            attach(rod(name + '.seat-arm', (.75, side*fork, height * .43) if open_well else (0, 0, height * .43),
                       (-.45, seat_y, height * .43), .055, gray, col), yaw)
            attach(box(name + '.seat', (-.45, seat_y, height * .46),
                       (.4, .35, .09), gray, col), yaw)
    if spec['id'] in ['us-5in38-mk21-single','us-3in50-single','us-11in75-quad']:
        # Open mount identity comes from the carriage, controls and receiver,
        # not decorative tiny fasteners. Keep the existing installation datum.
        platform_width = width*.43
        for sign in ([-1,1] if spec['id']!='us-3in50-single' else [1]):
            attach(box(name+'.operator-step',(-.48,sign*platform_width,.36),(.98,.48,.07),gray,col),yaw)
            attach(rod(name+'.step-brace',(trunnion-.2,sign*fork,.3),(-.48,sign*platform_width,.36),.05,gray,col),yaw)
            attach(box(name+'.seat-back',(-.65,sign*width*.40,height*.62),(.08,.34,.34),gray,col),yaw)
            for offset in [-.12,.12]:
                attach(rod(name+'.seat-back-support',(-.61,sign*width*.40+offset,height*.46),
                           (-.61,sign*width*.40+offset,height*.62),.018,gray,col,vertices=6),yaw)
            attach(box(name+'.training-gearbox',(-.25,sign*fork,height*.72),(.50,.16,.20),gray,col),yaw)
            wheel('training-wheel',(-.35,sign*(fork+.13),height*.72),.19,yaw)
        if count == 4:
            cheek('rear-drive',[(-1.14,.34),(-.74,.34),(-.70,.66),(-.90,.81),(-1.14,.65)],0,width*.38,yaw)
            for sign in [-1,1]:
                attach(rod(name+'.control-yoke',(-.61,sign*fork,height*.78),(-.83,sign*fork,height+.36),.026,steel,col),yaw)
                attach(rod(name+'.control-yoke-top',(-.83,sign*fork,height+.36),(-.2,sign*fork,height+.36),.026,steel,col),yaw)
    if spec['id']=='us-3in50-single':
        # Front cast column connects the training bed to the raked trunnions;
        # the breech retains the open aft well throughout elevation and recoil.
        cheek('cast-pedestal',[(.12,.20),(.58,.20),(.48,height*.65),(.22,height*.79),(.08,height*.62)],0,.48,yaw)
        attach(box(name+'.pedestal-gear-cover',(.54,0,height*.38),(.10,.36,.32),gray,col),yaw)
    if style == 'oerlikon':
        # OP 909: shield brackets attach to the carriage; the standing gunlayer
        # uses a shoulder rest, not the two seats formerly shared with heavy guns.
        for side in [-1, 1]:
            attach(box(name + '.shield', (.2, side * .28, .92), (.025, .46, .62), gray, col), yaw)
            attach(rod(name + '.shield-bracket', (trunnion, side * fork, height * .66),
                       (.2, side * .28, .75), .032, gray, col), yaw)
    attach(rod(name + '.trunnion-shaft', (trunnion, -fork, height),
               (trunnion, fork, height), .075 if hand_trained else .13, steel, col), yaw)
    if style == 'pom-pom':
        # Original Mk VI layout: paired belt feeds and two stacked bore rows.
        # The tall bearing cheeks and cross-shafts carry both rows continuously.
        for sign in [-1, 1]:
            attach(box(name + '.row-bearing-cheek', (trunnion, sign * fork, height),
                       (.32, .16, spec['barrelVerticalSpacing'] + .42), gray, col), yaw)
            attach(box(name + '.feed-cabinet', (-.40, sign * 1.37, 1.27),
                       (1.28, .58, .88), gray, col), yaw)
            attach(box(name + '.feed-lid', (-.40, sign * 1.37, 1.74),
                       (1.34, .64, .06), steel, col), yaw)
            for z in [height - spec['barrelVerticalSpacing']/2, height + spec['barrelVerticalSpacing']/2]:
                attach(box(name + '.belt-guide', (-.36, sign * 1.01, z), (.24, .42, .08), steel, col), yaw)
                for link in range(5):
                    attach(rod(name + '.feed-round', (-.48, sign * (.84 + link * .075), z + .06),
                               (-.17, sign * (.84 + link * .075), z + .06), .033, steel, col, vertices=6), yaw)
            attach(rod(name + '.control-shaft', (-.62, sign * .96, .90), (-.62, sign * 1.23, .90), .045, steel, col), yaw)
            wheel('control-handwheel',(-.62,sign*1.23,.90),.19,yaw)
            # Three bent armor panels, seated on the serving platform. The
            # reference's large shield and aft operator station define its mass.

            cheek('outer-shield',[(.15,.31),(.94,.31),(.94,1.62),(.55,1.75),(.15,1.62)],sign*1.72,.055,yaw)
            attach(box(name+'.shield-front',(.94,sign*1.55,.9),(.055,.8,1.3),gray,col),yaw)
            attach(box(name+'.aft-seat',(-1.27,sign*.79,1.43),(.46,.42,.10),gray,col),yaw)
            if sign==1:cheek('aft-seat-back',[(-1.52,1.43),(-1.4,1.43),(-1.4,2.37),(-1.62,2.45),(-1.72,2.45)],sign*.79,.82,yaw)
            else:attach(box(name+'.aft-seat-back',(-1.49,sign*.79,1.62),(.06,.40,.28),gray,col),yaw)
            attach(rod(name+'.seat-stanchion',(-1.27,sign*.79,.3),(-1.27,sign*.79,1.43),.06,gray,col),yaw)
            attach(rod(name+'.director-upright',(-1.12,sign*.72,.33),(-1.12,sign*.72,2.13),.03,gray,col),yaw)
            attach(rod(name+'.director-side',(-1.12,sign*.72,2.13),(-.55,sign*.72,2.13),.03,gray,col),yaw)
        outline=[(-1.62,-1.15),(-1.25,-1.72),(-.25,-1.95),(.96,-1.75),(1.30,-1.10),(1.30,1.10),(.96,1.75),(-.25,1.95),(-1.25,1.72),(-1.62,1.15)]
        k=len(outline);vs=[(x,y,z) for z in [.19,.31] for x,y in outline]
        attach(mesh(name+'.serving-platform',vs,[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,k+(i+1)%k,k+i) for i in range(k)],gray,col),yaw)
        attach(rod(name+'.director-crossbar',(-.55,-.72,2.13),(-.55,.72,2.13),.03,gray,col),yaw)
    for side, lateral, vertical in barrel_layout(spec):
        elevation = empty(side + '.elevation', yaw, (trunnion, lateral, height))
        elevation.rotation_euler.y = -math.radians(1)
        cradle = empty(side + '.cradle', elevation, (0, 0, vertical)) if vertical else elevation
        recoil = empty(side + '.recoil', elevation, (0, 0, vertical))
        if style == 'pom-pom' and vertical < 0:
            attach(box(name + '.elevating-row-web', (0, 0, 0), (.19, .13, spec['barrelVerticalSpacing'] + .15), steel, col), elevation)
        length = spec['muzzleForward'] - trunnion
        empty(side + '.muzzle', recoil, (length, 0, 0))
        radius = spec.get('barrelBaseRadius', spec['caliberM'] * .85)
        # The slide stays with elevation while the barrel/breech recoil inside
        # it. Its circular bearing remains on the shaft at every elevation.
        attach(rod(name + '.elevating-bearing', (0, -.12, 0), (0, .12, 0),
                   max(.09, radius * 1.35), steel, col, vertices=12), cradle)
        attach(box(name + '.recoil-slide', (-.12, 0, -radius * .7),
                   (.64 + spec['recoilM'], max(.12, radius * 2.5), max(.10, radius * 1.4)), gray, col), cradle)
        small_defensive = spec['id']=='us-3in50-single'
        breech_x = -.35 if small_defensive else (-.5 if style=='open-pedestal' else -.25)
        breech_length = .65 if small_defensive else (1.1 if style=='open-pedestal' else .55)
        attach(box(name + '.breech', (breech_x,0,0), (breech_length,radius*3,radius*3),steel,col),recoil)
        attach(rod(name + '.barrel-root', (0, 0, 0), (length * .38, 0, 0), radius, steel, col,
                   r2=radius * .77, vertices=10), recoil)
        attach(rod(name + '.barrel-tube', (length * .38, 0, 0), (length, 0, 0), radius * .77, steel, col,
                   r2=max(spec['caliberM'] * .59, radius * .48), vertices=10), recoil)
        bore_points = [(length+.001, spec['caliberM']/2*math.cos(i*math.tau/10), spec['caliberM']/2*math.sin(i*math.tau/10)) for i in range(10)]
        attach(mesh(name+'.bore',bore_points,[tuple(range(10))],dark,col),recoil)
        if style == 'open-pedestal':
            attach(rod(name + '.recoil-cylinder', (-.65, 0, -.26), (1.1, 0, -.26), .14,
                       gray, col, vertices=10), recoil)
            if spec['id'] in ['us-5in38-mk21-single','us-3in50-single']:
                for sign in [-1,1]:
                    attach(rod(name+'.recuperator',(-.6,sign*radius*1.2,radius*1.7),(.96,sign*radius*1.2,radius*1.7),radius*.47,gray,col,vertices=8),recoil)
                receiver_scale=.7 if small_defensive else 1
                cheek('receiver-cheek',[(x*receiver_scale,z) for x,z in [(-.82,-radius),(.3,-radius),(.57,radius*.7),(.24,radius*2.8),(-.75,radius*2.8)]],0,radius*2.4,recoil)
                attach(box(name+'.breech-block',(-.82*receiver_scale,0,.04),(.17,radius*2.8,radius*2.7),dark,col),recoil)
            tray_x, tray_length = (-.65,.90) if small_defensive else (-.80,1.10)
            attach(box(name + '.loading-tray', (tray_x, 0, -.19), (tray_length, .48, .08), gray, col), cradle)
            attach(rod(name + '.loading-tray-bracket', (-.30, 0, -radius * .7),
                       (tray_x, 0, -.19), .075, gray, col), cradle)
        elif style == 'oerlikon':
            attach(cyl(name + '.drum', (-.12, 0, .15), .17, .17, dark, col, 20), recoil)
        else:
            attach(box(name + '.ammunition-feed', (-.20, 0, radius * 1.5 + .07),
                       (.48, .22, .35 if count == 4 else .18), gray, col), recoil)
        if hand_trained:
            for sign in [-1, 1]:
                attach(rod(name + '.shoulder-rest-arm', (-.30, 0, -.04),
                           (-.72, sign * .20, -.09), .028, gray, col), cradle)
                attach(box(name + '.shoulder-pad', (-.74, sign * .20, -.09),
                           (.08, .15, .22), dark, col), cradle)
            attach(rod(name + '.sight-support', (-.18, 0, .03),
                       (.10, 0, .35), .022, steel, col), cradle)
            attach(rod(name + '.sight', (0, 0, .35), (.27, 0, .35), .045, dark, col), cradle)
    if not hand_trained:
        for side in [-1, 1]:
            attach(rod(name + '.sight-support', (trunnion, side * fork, height * .85),
                       (.1, side * width * .43, height + .35), .025, steel, col), yaw)
            attach(rod(name + '.sight', (0, side * width * .43, height + .35),
                       (.27, side * width * .43, height + .35), .055, dark, col), yaw)
    for obj in set(bpy.context.scene.objects) - before:
        obj['assemblyId'] = name
    return yaw

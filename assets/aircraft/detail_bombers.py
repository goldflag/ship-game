"""Drawing-specific US bomber fittings; executed with build.py's authoring globals.

This module does not open Blender files, export, or change the active scene. The
retained per-aircraft extras supply its dimensions. Hole count and hidden-face
removal are game-mesh approximations, not claims of manufacturing fidelity.
"""


def _bomber_surface(t, q, sign, layer=1, clearance=.009):
    p, h, _ = surf_point(S['wing'], HALF, t, q, sign)
    return Vector((p[0], p[1], p[2] + layer * (h + clearance)))


def _bomber_remove_flap_skin(t0, t1, q0):
    """Remove the covered wing shell so real plate apertures reveal daylight.

    Selection uses physical wing coordinates, not mesh names or vertex indices.
    Control meshes remain independent. Border faces are kept; this leaves a
    narrow structural rim beneath each panel instead of an unsupported gap.
    """
    for ob in list(collection.objects):
        if ob.type != 'MESH' or not any(ob.name.startswith(prefix) for prefix in (
            'inner wing ', 'outer wing ', 'wing root fillet ',
        )):
            continue
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        remove = []
        for face in bm.faces:
            c = face.calc_center_median()
            t = abs(c.y) / HALF
            if not t0 + .002 < t < t1 - .002:
                continue
            lead = interp(S['wing'], t, 1)
            trail = interp(S['wing'], t, 2)
            u = .5 - c.x / L
            q = (u - lead) / max(.00001, trail - lead)
            if q > q0 + .012:
                remove.append(face)
        bmesh.ops.delete(bm, geom=remove, context='FACES')
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()


def _bomber_perforated_plate(name, t0, t1, q0, q1, sign, layer, owner, hole_diameter):
    """A closed thin plate assembled from matching cells with octagonal holes.

    The skin has 9 x 3 through holes; neighboring cell borders coincide and
    are welded. The 8-sided circles stay circular in the local physical plane,
    rather than stretching when the wing chord tapers. 27 apertures per plate.
    """
    columns, rows, ring_n = 9, 3, 8
    thickness = .007
    vertices, exterior_faces, inner_faces, wall_faces = [], [], [], []
    for i in range(columns):
        ta = t0 + (t1 - t0) * i / columns
        tb = t0 + (t1 - t0) * (i + 1) / columns
        tc = (ta + tb) * .5
        for j in range(rows):
            qa = q0 + (q1 - q0) * j / rows
            qb = q0 + (q1 - q0) * (j + 1) / rows
            qc = (qa + qb) * .5
            center = _bomber_surface(tc, qc, sign, layer)
            chord_axis = (_bomber_surface(tc, qb, sign, layer) - _bomber_surface(tc, qa, sign, layer)).normalized()
            span_raw = _bomber_surface(tb, qc, sign, layer) - _bomber_surface(ta, qc, sign, layer)
            span_axis = (span_raw - chord_axis * span_raw.dot(chord_axis)).normalized()
            normal = chord_axis.cross(span_axis).normalized()
            if normal.z * layer < 0:
                normal = -normal
            radius = min(hole_diameter * .5, span_raw.length * .25,
                         (_bomber_surface(tc, qb, sign, layer) - _bomber_surface(tc, qa, sign, layer)).length * .25)
            # Corner / midpoint border goes around the cell in the same order
            # as the circular hole: positive chord, then positive span.
            boundary = [(tc, qb), (tb, qb), (tb, qc), (tb, qa),
                        (tc, qa), (ta, qa), (ta, qc), (ta, qb)]
            outer = [_bomber_surface(t, q, sign, layer) for t, q in boundary]
            hole = [center + radius * (chord_axis * math.cos(k * math.tau / ring_n)
                                       + span_axis * math.sin(k * math.tau / ring_n))
                    for k in range(ring_n)]
            base = len(vertices)
            for offset in [Vector((0, 0, layer * thickness * .5)), Vector((0, 0, -layer * thickness * .5))]:
                vertices.extend([tuple(p + offset) for p in outer + hole])
            for k in range(ring_n):
                kk = (k + 1) % ring_n
                exterior_faces.append((base + k, base + kk, base + 8 + kk, base + 8 + k))
                inner_faces.append((base + 16 + k, base + 24 + k, base + 24 + kk, base + 16 + kk))
                wall_faces.append((base + 8 + k, base + 8 + kk, base + 24 + kk, base + 24 + k))
            # Only outer panel perimeter gets an edge wall. Shared cell edges
            # must stay open to one another so the welded plate is manifold.
            for k in range(ring_n):
                # The boundary starts on the aft midpoint; actual perimeter
                # edges are right=(7,0), top=(1,2), left=(3,4), bottom=(5,6).
                perimeter = ((i == 0 and k in (5, 6)) or (i == columns - 1 and k in (1, 2))
                             or (j == 0 and k in (3, 4)) or (j == rows - 1 and k in (7, 0)))
                if perimeter:
                    kk = (k + 1) % ring_n
                    wall_faces.append((base + k, base + 16 + k, base + 16 + kk, base + kk))
    faces = exterior_faces + inner_faces + wall_faces
    ob = mesh(name, vertices, faces, 'frame', owner, smooth=False)
    ob.data.materials.append(M['bomber.brakeInterior'])
    start = len(exterior_faces)
    for p in ob.data.polygons[start:start + len(inner_faces)]:
        p.material_index = 1
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000025)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    ob['perforationCount'] = columns * rows
    ob['holeDiameterM'] = hole_diameter
    ob['skinThicknessM'] = thickness
    ob['sourceDetail'] = 'Sparse physical apertures; game count reduced from source.'
    return ob


def _bomber_dive_brakes(extra):
    brake = extra.get('diveBrakes')
    if not brake:
        return
    t0 = max(brake['innerSpanFraction'], .11)
    t1 = min(brake['outerSpanFraction'], extra.get('aileronStart', .52) - .005)
    q0 = 1 - brake['chordFraction']
    # Keep a thin continuous rim at the extreme trailing edge.
    q1 = .992
    M['bomber.brakeInterior'] = material('dive brake interior', (.32, .045, .032), .12, .63)
    _bomber_remove_flap_skin(t0, t1, q0)
    for sign, side in [(1, 'port'), (-1, 'starboard')]:
        for layer in [1, -1]:
            upper = layer == 1
            joint_id = 'diveBrake.' + side if upper else 'diveBrake.lower.' + side
            pivot = _bomber_surface((t0 + t1) * .5, q0, sign, layer)
            owner = empty(joint_id, tuple(pivot), root, axis='spanwise', limitDegrees=45,
                          pairedNode='diveBrake.lower.' + side if upper else 'diveBrake.' + side,
                          rotationMultiplier=1 if upper else -1)
            _bomber_perforated_plate(('upper' if upper else 'lower') + ' perforated dive brake ' + side,
                                     t0, t1, q0, q1, sign, layer, owner, brake['holeDiameterM'])
            # Small hinge knuckles and operating link; their scale stays close
            # to the plate, and the mechanism belongs to the moving component.
            for fraction in [.08, .5, .92]:
                t = t0 + (t1 - t0) * fraction
                p = _bomber_surface(t, q0, sign, layer)
                cylinder('dive brake hinge knuckle', tuple(p - Vector((0, .038, 0))),
                         tuple(p + Vector((0, .038, 0))), .013, 'metal', owner, n=8)
            p = _bomber_surface(t0 + (t1 - t0) * .23, q0 + .065, sign, layer)
            tube('dive brake operating link', [tuple(p), tuple(p + Vector((.075, 0, -.065 * layer)))],
                 .010, 'engine', owner, n=6)


def _bomber_rear_gun(extra):
    gun = extra.get('rearGun')
    if not gun:
        return
    u = gun['u']
    z = gun['baseZM']
    # The mount sits in the aft opening; barrels remain realistically thin.
    # SBD and Helldiver use the common wartime twin flexible .30-cal mount.
    twin = ID in ('sbd-3-dauntless', 'sb2c-4-helldiver')
    ys = [-.052, .052] if twin else [0]
    mount = empty('defensiveGun.yaw', (X(u), 0, z), root, axis='up', limitDegrees=70)
    cylinder('rear gun pedestal', (X(u), 0, z - .17), (X(u), 0, z + .03), .026, 'engine', mount, n=10)
    for y in ys:
        box('rear gun receiver', (X(u + .017), y, z + .075), (.28, .050, .067), 'engine', mount)
        box('rear gun ammunition box', (X(u + .002), y + (-.075 if y < 0 else .075), z + .025),
            (.16, .080, .15), 'interior', mount)
        a = (X(u + .027), y, z + .090)
        b = (a[0] - gun['barrelLengthM'], y, z + .19)
        cylinder('rear flexible gun barrel', a, b, .014, 'engine', mount, n=10)
        sleeve = (a[0] - gun['barrelLengthM'] * .50, y, z + .14)
        cylinder('rear gun cooling sleeve', a, sleeve, .022, 'engine', mount, n=10)
        cylinder('rear gun muzzle bore', b, (b[0] - .015, y, b[2] + .002), .009, 'rubber', mount, n=8)
        tube('rear gun charging grip', [(X(u + .004), y, z + .09), (X(u - .008), y, z + .01)],
             .010, 'engine', mount, n=6)


def _bomber_sbd_intake_and_sight(extra):
    intake = extra.get('intake')
    if intake:
        u, width, height = intake['u'], intake['widthM'], intake['heightM']
        z = intake['topZM']
        # Open oblong intake, with a dark recessed throat and tapered sheet-metal
        # fairing running aft into the cowling. A solid ellipsoid would hide it.
        x0, x1 = X(u - .024), X(u + .022)
        verts = [(x0, -width / 2, z), (x0, width / 2, z),
                 (x0, width / 2, z + height), (x0, -width / 2, z + height),
                 (x1, -width * .40, z - .015), (x1, width * .40, z - .015),
                 (x1, width * .40, z + .026), (x1, -width * .40, z + .026)]
        mesh('SBD-3 upper carburetor scoop', verts,
             [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0), (4, 7, 6, 5)],
             'frame', smooth=False)
        tube('carburetor scoop rolled lip', verts[:4] + [verts[0]], .012, 'frame', n=6)
        box('carburetor recessed throat', (x0 - .023, 0, z + height * .5), (.008, width * .85, height * .76), 'rubber')
    sight = extra.get('telescopicSight')
    if sight:
        front, rear = sight['frontU'], sight['rearU']
        z = max(body_dims(front)[2], body_dims(rear)[2]) + sight['heightM']
        cylinder('Mk III telescopic sight tube', (X(front), 0, z), (X(rear), 0, z), .031, 'engine', n=12)
        for uu in [front + .012, rear - .012]:
            tube('telescopic sight support', [(X(uu), 0, body_dims(uu)[2]), (X(uu), 0, z)], .012, 'metal', n=6)
        cylinder('telescopic sight eyepiece', (X(rear - .006), 0, z), (X(rear + .008), 0, z), .041, 'rubber', n=12)
        cylinder('telescopic sight forward lens', (X(front) + .002, 0, z), (X(front) + .006, 0, z), .025, 'glass', n=12)


def _bomber_helldiver_cannon(extra):
    if ID != 'sb2c-4-helldiver':
        return
    for sign in [-1, 1]:
        for gun in extra.get('wingGuns', []):
            t = gun['spanFraction']
            p, _, _ = surf_point(S['wing'], HALF, t, 0, sign)
            z = p[2] - .025
            # Long faired cannon sleeves and short visible 20 mm muzzle.
            cylinder('Helldiver 20 mm cannon sleeve', (p[0] - .16, p[1], z),
                     (p[0] + .28, p[1], z), .043, 'frame', n=12)
            cylinder('Helldiver 20 mm cannon muzzle', (p[0] + .24, p[1], z),
                     (p[0] + .43, p[1], z), .018, 'engine', n=12)
            cylinder('Helldiver cannon bore', (p[0] + .431, p[1], z),
                     (p[0] + .434, p[1], z), .010, 'rubber', n=10)


def _bomber_details():
    if ID not in ('sbd-3-dauntless', 'tbd-1-devastator', 'sb2c-4-helldiver', 'tbf-1c-avenger'):
        return
    extra = S.get('extras', {})
    _bomber_dive_brakes(extra)
    _bomber_rear_gun(extra)
    # The TBD uses the same type of external telescope; its own retained
    # placement parameters prevent it inheriting the SBD's cowl geometry.
    if ID in ('sbd-3-dauntless', 'tbd-1-devastator'):
        _bomber_sbd_intake_and_sight(extra)
    _bomber_helldiver_cannon(extra)
    # All four are radial-engined. Do not invent an inline-engine radiator.
    # The Avenger mast/turret and their measured aliases are handled by build.py.


_bomber_details()

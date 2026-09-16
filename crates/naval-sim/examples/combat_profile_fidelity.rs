//! Quantitative, unpublished combat-profile comparison. No rendering dependency.
use naval_sim::{
    construction_geometry as cg,
    contacts::{ContactGeometry, ContactKind, contact_armor, ship_contacts},
    damage::Combatant,
    definition::*,
    floodwater::water_body,
    geometry::*,
    hydrostatics::HullHydrostatics,
    mount_clearance::{ClearancePose, MountClearance},
    shell::Shell,
};
use std::time::Instant;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let read =
        |p: &str| -> ShipDefinition { serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap() };
    let a = read(&args[1]);
    let b = read(&args[2]);
    // Immutable equipment, dry mass and authoring identities must remain exact.
    for (x, y) in [
        (
            serde_json::to_value(&a.mounts).unwrap(),
            serde_json::to_value(&b.mounts).unwrap(),
        ),
        (
            serde_json::to_value(&a.loading).unwrap(),
            serde_json::to_value(&b.loading).unwrap(),
        ),
        (
            serde_json::to_value(&a.construction).unwrap(),
            serde_json::to_value(&b.construction).unwrap(),
        ),
        (
            serde_json::to_value(&a.handling).unwrap(),
            serde_json::to_value(&b.handling).unwrap(),
        ),
    ] {
        assert_eq!(x, y);
    }
    let ah = HullHydrostatics::new(&a.hull, None);
    let bh = HullHydrostatics::new(&b.hull, None);
    let poses = [(0., 0.), (15., 3.), (-35., -7.), (90., 0.), (170., 10.)];
    let mut hydro = vec![];
    let mut water = vec![];
    let mut water_ms = [0.; 2];
    for (rd, pd) in poses {
        let (r, p) = (radians(rd), radians(pd));
        for y in [-6., -2., 0., 2., 6.] {
            let x = ah.sample(y, r, p);
            let z = bh.sample(y, r, p);
            hydro.push(serde_json::json!({"rollDeg":rd,"pitchDeg":pd,"y":y,"referenceM3":x.volume,"candidateM3":z.volume,"volumeErrorFraction":(z.volume-x.volume)/x.volume.max(1.),"centerErrorM":length(sub(z.center,x.center))}));
        }
        for room in &b.compartments {
            let old = a.compartments.iter().find(|c| c.id == room.id).unwrap();
            for f in [0., 0.1, 0.5, 0.9, 1.] {
                let t = Instant::now();
                let x = water_body(old, old.capacity_m3 * f, r, p);
                water_ms[0] += t.elapsed().as_secs_f64() * 1000.;
                let t = Instant::now();
                let y = water_body(room, room.capacity_m3 * f, r, p);
                water_ms[1] += t.elapsed().as_secs_f64() * 1000.;
                water.push(serde_json::json!({"room":room.id,"rollDeg":rd,"pitchDeg":pd,"fill":f,"levelErrorM":(x.level-y.level).abs(),"centerErrorM":if f>0.{length(sub(x.center,y.center))}else{0.},"areaErrorM2":(x.area-y.area).abs()}));
            }
        }
    }
    let ac = MountClearance::new(&a).unwrap().unwrap();
    let bc = MountClearance::new(&b).unwrap().unwrap();
    let actor = Combatant::new("probe", &a);
    let neutral: Vec<_> = actor.mounts.iter().map(ClearancePose::from).collect();
    let mut clear = vec![];
    let mut unsafe_clear = 0;
    let mut extra = 0;
    let mut total = 0;
    let mut blocked = 0;
    for (i, m) in a.mounts.iter().enumerate() {
        for neighbor in [0, 1] {
            for k in 0..13 {
                for ef in [0., 0.5, 1.] {
                    let mut ps = neutral.clone();
                    if neighbor == 1 {
                        for (j, s) in ps.iter_mut().enumerate() {
                            s.train += radians(if j % 2 == 0 { 35. } else { -35. });
                        }
                    }
                    let lim = m.traverse_limits_deg.unwrap_or([
                        -m.traverse_deg.unwrap_or(m.weapon.traverse_deg),
                        m.traverse_deg.unwrap_or(m.weapon.traverse_deg),
                    ]);
                    ps[i].train =
                        radians(lim[0] + (lim[1] - lim[0]) * k as f64 / 12.);
                    ps[i].elevation = radians(
                        m.elevation_min_deg.unwrap_or(m.weapon.elevation_min_deg) * (1. - ef)
                            + m.elevation_max_deg.unwrap_or(m.weapon.elevation_max_deg) * ef,
                    );
                    ps[i].recoil = if k % 2 == 0 { 0. } else { 1. };
                    let x = ac.minimum_clearance(&a, i, &ps, 1.).0;
                    let y = bc.minimum_clearance(&b, i, &ps, 1.).0;
                    total += 1;
                    if x <= 0. {
                        blocked += 1;
                    }
                    if x <= 0. && y > 0. {
                        unsafe_clear += 1;
                    }
                    if x > 0. && y <= 0. {
                        extra += 1;
                    }
                    if (x <= 0.) != (y <= 0.) {
                        clear.push(serde_json::json!({"mount":m.id,"neighbors":neighbor,"train":ps[i].train,"elevation":ps[i].elevation,"referenceGap":x,"candidateGap":y}));
                    }
                }
            }
        }
    }
    // Enclosure evidence at every original hull vertex and edge midpoint, at all
    // attitudes by rigid-transform invariance. This supplements, not replaces,
    // the bin/support construction argument; not an exhaustive collision proof.
    let cells = &b.hull.volume.as_ref().unwrap().cells;
    let mut tree = cg::Broadphase::new(8.);
    for c in cells {
        tree.insert(c);
    }
    let mut missed = 0;
    let mut tested = 0;
    for c in &a.hull.volume.as_ref().unwrap().cells {
        for f in c.faces.iter() {
            for i in 0..f.vertices.len() {
                for p in [
                    f.vertices[i],
                    scale(
                        add(f.vertices[i], f.vertices[(i + 1) % f.vertices.len()]),
                        0.5,
                    ),
                ] {
                    tested += 1;
                    if !tree
                        .candidates_box(sub(p, [1e-6; 3]), add(p, [1e-6; 3]))
                        .iter()
                        .any(|&j| cg::contains(&cells[j], p))
                    {
                        missed += 1;
                    }
                }
            }
        }
    }
    let ag = ContactGeometry::new(&a).unwrap();
    let bg = ContactGeometry::new(&b).unwrap();
    let aa = Combatant::new("hit", &a);
    let ba = Combatant::new("hit", &b);
    let mut hits = vec![];
    for z in (-90..=90).step_by(10) {
        for y in [-6., -2., 2., 6., 10., 16.] {
            for sign in [-1., 1.] {
                let from = [sign * 30., y, z as f64];
                let to = [-sign * 30., y, z as f64];
                let first = |d: &ShipDefinition, c: &Combatant, g: &ContactGeometry| {
                    ship_contacts(&Shell::default(), from, to, c, d, g)
                        .into_iter()
                        .find(|h| h.kind == ContactKind::Armor)
                };
                let x = first(&a, &aa, &ag);
                let q = first(&b, &ba, &bg);
                hits.push(serde_json::json!({"z":z,"y":y,"side":sign,"reference":x.as_ref().map(|h|serde_json::json!({"point":h.point,"thickness":contact_armor(&a,h).thickness_mm})),"candidate":q.as_ref().map(|h|serde_json::json!({"point":h.point,"thickness":contact_armor(&b,h).thickness_mm}))}));
            }
        }
    }
    println!(
        "{}",
        serde_json::json!({"hydro":hydro,"water":water,"waterQueryMs":water_ms,"clearance":{"samples":total,"referenceBlocked":blocked,"unsafeClear":unsafe_clear,"extraBlocked":extra,"changes":clear},"enclosure":{"samples":tested,"outside":missed},"damageRays":hits})
    );
}

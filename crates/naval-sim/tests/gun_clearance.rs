use naval_sim::{
    catalog::validate_definition,
    definition::ShipDefinition,
    geometry::radians,
    gun_clearance::{
        advance_gun_motion, clear_gun_motion, gun_clearance, segment_triangle_distance,
    },
    motion::ShipState,
    weapons::{Ammunition, MountState, Obstructions, update_mount},
};

fn kongo() -> ShipDefinition {
    let mut d: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/kongo.json")).unwrap();
    // Exercise authored constraints even before the next model publication.
    let blueprint: serde_json::Value =
        serde_json::from_str(include_str!("../../../assets/ships/kongo/blueprint.json")).unwrap();
    for m in &mut d.mounts {
        let input = blueprint["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == m.id)
            .unwrap();
        m.travel_clearance = serde_json::from_value(input["travelClearance"].clone()).unwrap();
    }
    d
}
#[test]
fn distances_cover_interiors_parallel_edges_and_crossings() {
    let (a, b, c) = ([-2.0, 0.0, -2.0], [2.0, 0.0, -2.0], [0.0, 0.0, 2.0]);
    assert_eq!(
        segment_triangle_distance([0.0, -1.0, 0.0], [0.0, 1.0, 0.0], a, b, c),
        0.0
    );
    assert_eq!(
        segment_triangle_distance([-0.1, 2.0, 0.0], [0.1, 2.0, 0.0], a, b, c),
        2.0
    );
    assert_eq!(
        segment_triangle_distance([-3.0, 0.0, -2.0], [3.0, 0.0, -2.0], a, b, c),
        0.0
    );
    assert_eq!(
        segment_triangle_distance([3.0, 0.0, -2.0], [4.0, 0.0, -2.0], a, b, c),
        1.0
    );
}
#[test]
fn carried_aa_clear_every_accepted_interval_including_full_recoil() {
    let d = kongo();
    validate_definition(&d).unwrap();
    assert_eq!(
        d.mounts
            .iter()
            .filter(|m| m.parent_mount_id.is_some() && m.travel_clearance.is_some())
            .count(),
        4
    );
    for m in d
        .mounts
        .iter()
        .filter(|m| m.parent_mount_id.is_some() && m.travel_clearance.is_some())
    {
        assert!(gun_clearance(m, 0.0, radians(1.0)) > 0.0);
        for angle in [-90.0, -70.0, -45.0, 0.0, 45.0, 70.0, 90.0] {
            let f = clear_gun_motion(m, 0.0, radians(1.0), radians(angle), radians(-10.0));
            assert!(f > 0.0 && f <= 1.0);
            for i in 0..=8 {
                let t = f * i as f64 / 8.0;
                assert!(
                    gun_clearance(m, radians(angle) * t, radians(1.0) - radians(11.0) * t) >= -1e-8
                );
            }
        }
    }
}
#[test]
fn aiming_stops_then_elevates_away_without_firing() {
    let d = kongo();
    let m = d.mounts.iter().find(|m| m.id == "aa25-01").unwrap();
    let states: Vec<_> = d.mounts.iter().map(MountState::new).collect();
    let mut s = MountState::new(m);
    s.loaded = Ammunition::He;
    let p = ShipState::new("clearance");
    let obstacles = Obstructions::new(&d);
    let ammo = s.ammo;
    for _ in 0..80 {
        update_mount(
            m,
            &mut s,
            &d,
            &p,
            Some([m.position[0], 0.0, m.position[2] - 100.0]),
            0.1,
            [0.0; 3],
            1.0,
            &obstacles,
            &states,
        );
    }
    assert_eq!(s.status, "blocked");
    assert!(gun_clearance(m, s.train, s.elevation) >= 0.0);
    let low = s.elevation;
    for _ in 0..20 {
        update_mount(
            m,
            &mut s,
            &d,
            &p,
            Some([m.position[0], 100.0, m.position[2] - 100.0]),
            0.1,
            [0.0; 3],
            1.0,
            &obstacles,
            &states,
        );
    }
    assert!(s.elevation > low + 0.1);
    assert_eq!(s.ammo, ammo);
}
#[test]
fn catalog_rejects_invalid_clearance_geometry() {
    for case in 0..6 {
        let mut d = kongo();
        let c = d
            .mounts
            .iter_mut()
            .find_map(|m| m.travel_clearance.as_mut())
            .unwrap();
        match case {
            0 => c.version = 2,
            1 => c.surface.triangles[0][0] = 999999.0,
            2 => c.surface.triangles[0] = [0.0; 3],
            3 => c.surface.vertices[0][0] = f64::NAN,
            4 => c.barrels[0].radius_m = -1.0,
            _ => c.barrels[0].to_m = c.barrels[0].from_m,
        };
        assert!(validate_definition(&d).is_err());
    }
}

#[test]
fn free_axis_reaches_a_clear_target_and_never_cuts_the_corner() {
    let d = kongo();
    let m = d.mounts.iter().find(|m| m.id == "aa25-02").unwrap();
    let (mut t, mut e) = (0.0, radians(1.0));
    for _ in 0..160 {
        let (nt, ne, _) = advance_gun_motion(
            m,
            t,
            e,
            radians(90.0).min(t + 0.02),
            radians(-10.0).max(e - 0.014),
        );
        assert!(gun_clearance(m, (t + nt) / 2.0, (e + ne) / 2.0) >= -1e-8);
        t = nt;
        e = ne;
    }
    assert!((t - radians(90.0)).abs() < 1e-8);
    assert!((e - radians(-10.0)).abs() < 1e-8);
}

#[test]
fn clear_endpoints_do_not_allow_tunneling_and_a_stop_can_reverse() {
    let d = kongo();
    let mut m = d.mounts.iter().find(|m| m.id == "aa25-01").unwrap().clone();
    m.weapon.barrel_count = Some(1.0);
    m.weapon.barrel_spacing = 0.0;
    m.weapon.pivot_height = 0.0;
    m.weapon.trunnion_forward = 0.0;
    m.weapon.recoil_m = 0.0;
    m.travel_clearance=Some(serde_json::from_value(serde_json::json!({"version":1,"barrels":[{"fromM":0,"toM":2,"heightM":0,"radiusM":0.05,"recoils":true}],"surface":{"vertices":[[-0.01,-1,-2],[0.01,-1,-2],[0,1,-2]],"triangles":[[0,1,2]]}})).unwrap());
    assert!(gun_clearance(&m, -0.5, 0.0) > 0.0 && gun_clearance(&m, 0.5, 0.0) > 0.0);
    let f = clear_gun_motion(&m, -0.5, 0.0, 0.5, 0.0);
    assert!(f < 0.5);
    let stopped = -0.5 + f;
    assert!(gun_clearance(&m, stopped, 0.0) >= 0.0);
    assert!(clear_gun_motion(&m, stopped, 0.0, -0.5, 0.0) > 0.99);
}

#[test]
fn main_and_casemate_barrels_stop_before_authored_structures_and_reverse() {
    let d = kongo();
    validate_definition(&d).unwrap();
    let mut cases = vec![
        ("main-2".to_string(), -145.0, 43.0),
        ("main-3".to_string(), -145.0, 43.0),
    ];
    for side in ["port", "starboard"] {
        for i in 1..=3 {
            cases.push((
                format!("casemate-{side}-{i}"),
                if side == "port" { -75.0 } else { 75.0 },
                -5.0,
            ));
        }
    }
    cases.push(("casemate-port-2".into(), -62.428845355, 16.815735405));
    cases.push(("casemate-starboard-2".into(), 56.25, 20.0));
    cases.push(("casemate-port-4".into(), -56.25, 20.0));
    cases.push(("casemate-starboard-4".into(), 56.25, 20.0));
    for (id, degrees, pitch) in cases {
        let m = d.mounts.iter().find(|m| m.id == id).unwrap();
        let (train, elevation, start) = (radians(degrees), radians(pitch), radians(1.0));
        assert!(
            gun_clearance(m, train, elevation) < 0.0,
            "{id}: fixture must expose a collision"
        );
        let fraction = clear_gun_motion(m, 0.0, start, train, elevation);
        assert!(fraction > 0.0 && fraction < 1.0);
        for i in 0..=24 {
            let f = fraction * i as f64 / 24.0;
            assert!(
                gun_clearance(m, train * f, start + (elevation - start) * f) >= 0.0,
                "{id}"
            );
        }
        assert!(
            clear_gun_motion(
                m,
                train * fraction,
                start + (elevation - start) * fraction,
                0.0,
                start
            ) > 0.999,
            "{id}: must reverse away from contact"
        );
    }
}

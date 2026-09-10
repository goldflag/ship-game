use naval_sim::{
    environment::{Island, TerrainField},
    recon::{COVERAGE_INTERVAL, VisualCues},
    rules::TeamId,
    sensors::{self, ContactKind, Sensors, VisualConditions, VisualEntity, VisualRules},
};

fn observer() -> VisualEntity {
    VisualEntity {
        id: "own-lookout".into(),
        team: TeamId::A,
        kind: ContactKind::Surface,
        position: [-3000.0, 0.0, 500.0],
        eye: [-3000.0, 20.0, 500.0],
        feature: [-3000.0, 25.0, 500.0],
        length_m: 100.0,
        preset_id: None,
        role: None,
        cues: VisualCues::default(),
        motion: Default::default(),
        aircraft: None,
        health: 1.0,
    }
}
fn target() -> VisualEntity {
    VisualEntity {
        id: "private-enemy".into(),
        team: TeamId::B,
        position: [-1000.0, 0.0, 500.0],
        eye: [-1000.0, 20.0, 500.0],
        feature: [-1000.0, 25.0, 500.0],
        ..observer()
    }
}
fn clear() -> VisualConditions {
    VisualConditions {
        visibility_m: 28000.0,
        light: 1.0,
    }
}

#[test]
fn coverage_is_sampled_sensor_eligibility_and_retains_only_last_survey_time() {
    let mut sensors = Sensors::default();
    let rules = VisualRules::default();
    let eye = observer();
    sensors.update(0, std::slice::from_ref(&eye), &[], &[], clear(), &rules);
    let coverage = sensors.coverage(TeamId::A);
    assert!(coverage.cells.len() > 20 && coverage.cells.len() <= 4096);
    for cell in &coverage.cells {
        assert_eq!(cell.last_observed_tick, 0);
        for [dx, dz] in [
            [0., 0.],
            [-500., -500.],
            [-500., 500.],
            [500., -500.],
            [500., 500.],
        ] {
            let p = [cell.x + dx, 5., cell.z + dz];
            let reference = VisualEntity {
                position: [p[0], 0., p[2]],
                feature: p,
                length_m: 100.,
                ..target()
            };
            assert!(
                sensors::observation_strength(&eye, &reference, 1, false, clear(), &rules).unwrap()
                    >= 0.25
            );
        }
    }
    sensors.update(COVERAGE_INTERVAL, &[], &[], &[], clear(), &rules);
    assert_eq!(sensors.coverage(TeamId::A), coverage);
    sensors.update(COVERAGE_INTERVAL * 2, &[eye], &[], &[], clear(), &rules);
    assert!(
        sensors
            .coverage(TeamId::A)
            .cells
            .iter()
            .all(|c| c.last_observed_tick == COVERAGE_INTERVAL * 2)
    );
    assert!(sensors.coverage(TeamId::B).cells.is_empty());
}

#[test]
fn terrain_horizon_and_weather_clip_search_history() {
    let rules = VisualRules::default();
    let low = observer();
    let island = Island {
        id: "ridge".into(),
        x: 0.,
        z: 500.,
        rx: 700.,
        rz: 2500.,
        height: 180.,
        seed: 1.,
        style: "tropical".into(),
    };
    let field = TerrainField {
        seed: 1.,
        style: "tropical".into(),
        samples: vec![1.; 257 * 257],
    };
    let mut surface = Sensors::default();
    let mut air = Sensors::default();
    let high = VisualEntity {
        kind: ContactKind::Aircraft,
        position: [-3000., 1500., 500.],
        eye: [-3000., 1500., 500.],
        ..low.clone()
    };
    surface.update(
        0,
        &[low],
        std::slice::from_ref(&island),
        std::slice::from_ref(&field),
        clear(),
        &rules,
    );
    air.update(
        0,
        std::slice::from_ref(&high),
        std::slice::from_ref(&island),
        std::slice::from_ref(&field),
        clear(),
        &rules,
    );
    let contains = |s: &Sensors| {
        s.coverage(TeamId::A)
            .cells
            .iter()
            .any(|c| c.x == 2500. && c.z == 500.)
    };
    assert!(!contains(&surface));
    assert!(contains(&air));
    let mut fog = Sensors::default();
    fog.update(
        0,
        &[high],
        &[island],
        &[field],
        VisualConditions {
            visibility_m: 3500.,
            light: 1.,
        },
        &rules,
    );
    assert!(!contains(&fog));
}

#[test]
fn unseen_damage_and_sinking_do_not_change_condition_or_coverage() {
    let rules = VisualRules::default();
    let mut a = Sensors::default();
    let mut b = Sensors::default();
    for tick in [0, 60, 120] {
        for sensor in [&mut a, &mut b] {
            sensor.update(tick, &[observer(), target()], &[], &[], clear(), &rules);
        }
    }
    let condition = a.contacts(TeamId::A)[0].visible_condition.clone().unwrap();
    assert!(!condition.fire && !condition.heavy_smoke && !condition.listing && !condition.sinking);
    let mut damaged = target();
    damaged.cues = VisualCues {
        fire: Some([-1000., 10., 500.]),
        smoke: Some([-1000., 20., 500.]),
        listing: true,
        sinking: true,
    };
    for tick in [300, 600, 6000] {
        a.update(tick, &[target()], &[], &[], clear(), &rules);
        b.update(
            tick,
            std::slice::from_ref(&damaged),
            &[],
            &[],
            clear(),
            &rules,
        );
        assert_eq!(a.contacts(TeamId::A), b.contacts(TeamId::A));
        assert_eq!(a.coverage(TeamId::A), b.coverage(TeamId::A));
    }
    b.update(6060, &[observer(), damaged], &[], &[], clear(), &rules);
    let report = b.contacts(TeamId::A).remove(0);
    let observed = report.visible_condition.as_ref().unwrap();
    assert!(observed.fire && observed.heavy_smoke && observed.listing && observed.sinking);
    assert_eq!(observed.observed_tick, 6060);
    assert!(!report.targetable());
    b.update(6600, &[], &[], &[], clear(), &rules);
    assert_eq!(
        b.contacts(TeamId::A)[0].visible_condition,
        report.visible_condition
    );
    assert!(
        !serde_json::to_string(&report)
            .unwrap()
            .contains("private-enemy")
    );
}

#[test]
fn a_visible_wreck_cannot_keep_observing_for_its_former_team() {
    let rules = VisualRules::default();
    let mut sensors = Sensors::default();
    let mut wreck = observer();
    wreck.cues.sinking = true;
    sensors.update(0, &[wreck, target()], &[], &[], clear(), &rules);
    assert!(sensors.contacts(TeamId::A).is_empty());
    assert!(sensors.coverage(TeamId::A).cells.is_empty());
    assert!(
        sensors.contacts(TeamId::B)[0]
            .visible_condition
            .as_ref()
            .unwrap()
            .sinking
    );
}

#[test]
fn a_large_spread_of_observers_keeps_coverage_storage_bounded() {
    let rules = VisualRules::default();
    let mut sensors = Sensors::default();
    let observers: Vec<_> = (0..230)
        .map(|i| {
            let x = (i % 20) as f64 * 2500.0 - 25000.0;
            let z = (i / 20) as f64 * 4000.0 - 24000.0;
            VisualEntity {
                id: format!("own-{i}"),
                kind: ContactKind::Aircraft,
                position: [x, 1000.0, z],
                eye: [x, 1000.0, z],
                feature: [x, 1000.0, z],
                ..observer()
            }
        })
        .collect();
    let started = std::time::Instant::now();
    for tick in [0, COVERAGE_INTERVAL, COVERAGE_INTERVAL * 2] {
        sensors.update(tick, &observers, &[], &[], clear(), &rules);
    }
    let coverage = sensors.coverage(TeamId::A);
    assert!(coverage.cells.len() > 1000 && coverage.cells.len() <= 4096);
    assert!(
        coverage
            .cells
            .iter()
            .all(|cell| cell.x.abs() < 32000.0 && cell.z.abs() < 32000.0)
    );
    eprintln!(
        "230-observer coverage: {} samples, 3 surveys in {:?}",
        coverage.cells.len(),
        started.elapsed()
    );
}

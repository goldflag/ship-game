use naval_sim::{
    environment::{Island, TerrainField},
    rules::{TICK_RATE, TeamId},
    sensors::{
        self, ContactKind, Sensors, TrackStatus, VisualConditions, VisualEntity, VisualRules,
    },
};
fn entity(id: &str, team: TeamId, kind: ContactKind, x: f64, altitude: f64) -> VisualEntity {
    VisualEntity {
        id: id.into(),
        team,
        kind,
        position: [x, altitude, 0.0],
        eye: [x, altitude + 15.0, 0.0],
        feature: [x, altitude + 25.0, 0.0],
        length_m: 250.0,
        preset_id: Some("private-preset".into()),
        role: None,
        cues: Default::default(),
        motion: Default::default(),
        aircraft: None,
        firing: false,
        health: 1.0,
        mounts: Vec::new(),
        launchers: Vec::new(),
    }
}
fn clear() -> VisualConditions {
    VisualConditions {
        visibility_m: 28000.0,
        light: 1.0,
    }
}
#[test]
fn close_contacts_are_immediately_identified_and_keep_the_same_contact_id() {
    let mut sensors = Sensors::default();
    let rules = VisualRules::default();
    let observer = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let target = entity(
        "private-enemy-id",
        TeamId::B,
        ContactKind::Surface,
        2000.0,
        0.0,
    );
    sensors.update(
        0,
        &[observer.clone(), target.clone()],
        &[],
        &[],
        clear(),
        &rules,
    );
    let first = sensors.contacts(TeamId::A);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].status, TrackStatus::Tracked);
    assert_eq!(first[0].classification.as_deref(), Some("Large warship"));
    assert_eq!(first[0].identified_preset_id, target.preset_id);
    assert!(
        !serde_json::to_string(&first)
            .unwrap()
            .contains("private-enemy-id")
    );
    for second in 1..=15 {
        sensors.update(
            second * TICK_RATE,
            &[observer.clone(), target.clone()],
            &[],
            &[],
            clear(),
            &rules,
        );
    }
    let track = sensors.contacts(TeamId::A).remove(0);
    assert_eq!(track.id, first[0].id);
    assert_eq!(track.status, TrackStatus::Tracked);
    assert_eq!(
        track.identified_preset_id.as_deref(),
        Some("private-preset")
    );
}
#[test]
fn marginal_reports_are_immediate_and_cadence_is_not_render_frame_dependent() {
    let rules = VisualRules::default();
    let observer = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let target = entity("enemy", TeamId::B, ContactKind::Surface, 10800.0, 0.0);
    let mut a = Sensors::default();
    let mut b = Sensors::default();
    let world = [observer, target];
    a.update(0, &world, &[], &[], clear(), &rules);
    assert_eq!(a.contacts(TeamId::A).len(), 1);
    for tick in 0..=15 * TICK_RATE {
        a.update(tick, &world, &[], &[], clear(), &rules);
        if tick.is_multiple_of(TICK_RATE) {
            b.update(tick, &world, &[], &[], clear(), &rules);
        }
    }
    assert_eq!(a.contacts(TeamId::A).len(), 1);
    assert_eq!(a.contacts(TeamId::A), b.contacts(TeamId::A));
}
#[test]
fn a_lost_report_uses_only_measured_motion_even_after_the_reporter_is_destroyed() {
    let rules = VisualRules::default();
    let observer = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let mut target = entity("enemy", TeamId::B, ContactKind::Surface, 2000.0, 0.0);
    let mut a = Sensors::default();
    let mut b = Sensors::default();
    for second in 0..=10 {
        target.position[0] += 12.0;
        target.eye[0] += 12.0;
        target.feature[0] += 12.0;
        let world = [observer.clone(), target.clone()];
        a.update(second * TICK_RATE, &world, &[], &[], clear(), &rules);
        b.update(second * TICK_RATE, &world, &[], &[], clear(), &rules);
    }
    let observed = a.contacts(TeamId::A)[0].clone();
    for second in 11..=100 {
        let mut hidden = target.clone();
        hidden.position = [-20000.0, 0.0, 5000.0];
        hidden.eye = hidden.position;
        hidden.feature = hidden.position;
        // Both worlds lose the only friendly reporter. The hidden enemy takes
        // radically different courses; the transmitted report stays identical.
        a.update(
            second * TICK_RATE,
            std::slice::from_ref(&target),
            &[],
            &[],
            clear(),
            &rules,
        );
        b.update(second * TICK_RATE, &[hidden], &[], &[], clear(), &rules);
        assert_eq!(a.contacts(TeamId::A), b.contacts(TeamId::A));
    }
    let stale = a.contacts(TeamId::A)[0].clone();
    assert_eq!(stale.measured_position, observed.measured_position);
    assert_eq!(stale.velocity, observed.velocity);
    assert_eq!(stale.status, TrackStatus::Stale);
    assert!(stale.uncertainty_m > observed.uncertainty_m);
    a.update(
        101 * TICK_RATE,
        &[observer, target],
        &[],
        &[],
        clear(),
        &rules,
    );
    assert_eq!(a.contacts(TeamId::A)[0].id, observed.id);
    assert_eq!(a.contacts(TeamId::A)[0].status, TrackStatus::Tracked);
}
#[test]
fn low_aircraft_have_shorter_signatures_and_high_search_has_a_longer_horizon() {
    let rules = VisualRules::default();
    let ship = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let low = entity("low", TeamId::B, ContactKind::Aircraft, 7000.0, 75.0);
    let high = entity("high", TeamId::B, ContactKind::Aircraft, 7000.0, 1000.0);
    assert!(sensors::observation_strength(&ship, &low, 1, false, clear(), &rules).is_none());
    assert!(sensors::observation_strength(&ship, &high, 1, false, clear(), &rules).is_some());
    let mut hull = entity("enemy", TeamId::B, ContactKind::Surface, 17000.0, 0.0);
    hull.length_m = 260.0;
    hull.feature[1] = 5.0;
    let mut scout = entity("scout", TeamId::A, ContactKind::Aircraft, 0.0, 1000.0);
    assert!(sensors::observation_strength(&scout, &hull, 1, false, clear(), &rules).is_some());
    scout.eye[1] = 1.0;
    assert!(sensors::observation_strength(&scout, &hull, 1, false, clear(), &rules).is_none());
    let fog = VisualConditions {
        visibility_m: 4500.0,
        light: 1.0,
    };
    assert!(sensors::observation_strength(&ship, &high, 100, true, fog, &rules).is_none());
}
#[test]
fn baked_terrain_blocks_lookouts_but_a_high_aircraft_can_see_over_it() {
    let island = Island {
        id: "ridge".into(),
        x: 0.0,
        z: 0.0,
        rx: 500.0,
        rz: 500.0,
        height: 180.0,
        seed: 1.0,
        style: "tropical".into(),
    };
    let field = TerrainField {
        seed: 1.0,
        style: "tropical".into(),
        samples: vec![1.0; 257 * 257],
    };
    let from = [-2000.0, 20.0, 0.0];
    let to = [2000.0, 25.0, 0.0];
    assert!(!sensors::line_visible(
        from,
        to,
        std::slice::from_ref(&island),
        std::slice::from_ref(&field)
    ));
    assert!(sensors::line_visible(
        [-2000.0, 1500.0, 0.0],
        to,
        &[island],
        &[field]
    ));
}

#[test]
fn binary_spotting_identifies_even_a_marginal_contact_on_the_first_check() {
    let mut sensors = Sensors::default();
    let rules = VisualRules::default();
    let observer = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let target = entity("enemy", TeamId::B, ContactKind::Surface, 10800.0, 0.0);
    sensors.update(0, &[observer, target.clone()], &[], &[], clear(), &rules);
    let contacts = sensors.contacts(TeamId::A);
    assert_eq!(
        contacts.len(),
        1,
        "in-range targets must appear immediately"
    );
    let contact = &contacts[0];
    assert_eq!(contact.status, TrackStatus::Tracked);
    assert_eq!(contact.identified_preset_id, target.preset_id);
    assert_eq!(contact.measured_position, target.position);
    assert_eq!(contact.uncertainty_m, 0.0);
    assert_eq!(contact.sources[0].strength, 1.0);
}

#[test]
fn current_contacts_follow_a_straight_course_without_rounding_jumps() {
    let mut sensors = Sensors::default();
    let rules = VisualRules::default();
    assert!(
        rules.cadence_ticks <= 6,
        "visible poses need at least 10 Hz samples"
    );
    let observer = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    for sample in 0..120 {
        let target = entity(
            "enemy",
            TeamId::B,
            ContactKind::Surface,
            10000.0 + sample as f64,
            0.0,
        );
        sensors.update(
            sample * rules.cadence_ticks,
            &[observer.clone(), target.clone()],
            &[],
            &[],
            clear(),
            &rules,
        );
        assert_eq!(
            sensors.contacts(TeamId::A)[0].measured_position,
            target.position
        );
    }
}

#[test]
fn surface_size_and_firing_boundaries_preserve_weather_and_horizon() {
    let observer = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let rules = VisualRules::default();
    for (length, base) in [(100.0, 9000.0), (180.0, 10000.0), (260.0, 11000.0)] {
        for firing in [false, true] {
            let limit = base + if firing { 1000.0 } else { 0.0 };
            for (distance, visible) in [(limit, true), (limit + 1.0, false)] {
                let mut target = entity("enemy", TeamId::B, ContactKind::Surface, distance, 0.0);
                target.length_m = length;
                target.firing = firing;
                let strength = |o: &VisualEntity, c| {
                    sensors::observation_strength(o, &target, 1, false, c, &rules)
                };
                assert_eq!(strength(&observer, clear()).is_some(), visible);
                assert!(
                    strength(
                        &observer,
                        VisualConditions {
                            visibility_m: 8000.0,
                            ..clear()
                        }
                    )
                    .is_none()
                );
                let mut low = observer.clone();
                low.eye[1] = 0.0;
                target.feature[1] = 0.0;
                assert!(
                    sensors::observation_strength(&low, &target, 1, false, clear(), &rules)
                        .is_none()
                );
            }
        }
    }
}

#[test]
fn forward_screen_is_visible_alongside_a_rear_battleship() {
    let own = entity("own", TeamId::A, ContactKind::Surface, 0.0, 0.0);
    let mut destroyer = entity("screen", TeamId::B, ContactKind::Surface, 8900.0, 0.0);
    destroyer.length_m = 100.0;
    let mut capital = entity("capital", TeamId::B, ContactKind::Surface, 10900.0, 0.0);
    capital.length_m = 260.0;
    let mut sensors = Sensors::default();
    sensors.update(
        0,
        &[own, destroyer, capital],
        &[],
        &[],
        clear(),
        &VisualRules::default(),
    );
    assert_eq!(sensors.contacts(TeamId::A).len(), 2);
}

#[test]
fn formation_visibility_is_shared_by_observers_and_recomputed_when_planes_separate() {
    let rules = VisualRules::default();
    let mut sensors = Sensors::default();
    let a = entity("lookout-a", TeamId::A, ContactKind::Aircraft, 0.0, 1000.0);
    let b = entity("lookout-b", TeamId::A, ContactKind::Aircraft, 0.0, 1000.0);
    // A pair is visible just beyond the single-aircraft limit.
    let range = rules.air_to_air_range_m * 1.03;
    let target = entity("target", TeamId::B, ContactKind::Aircraft, range, 1000.0);
    let neighbor = entity(
        "neighbor",
        TeamId::B,
        ContactKind::Aircraft,
        range + 10.0,
        1000.0,
    );
    let mut world = [a, b, target, neighbor];
    sensors.update(0, &world, &[], &[], clear(), &rules);
    let contact = sensors
        .contacts(TeamId::A)
        .into_iter()
        .find(|c| c.measured_position == world[2].position)
        .unwrap();
    assert_eq!(contact.sources.len(), 2);
    world[3].position[0] += 2000.0;
    world[3].eye[0] += 2000.0;
    world[3].feature[0] += 2000.0;
    sensors.update(rules.cadence_ticks, &world, &[], &[], clear(), &rules);
    let contact = sensors.contact(TeamId::A, &contact.id).unwrap();
    assert_eq!(
        contact.last_observed_tick, 0,
        "a departed neighbor must not keep extending detection range"
    );
}

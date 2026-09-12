use naval_sim::{
    damage::Combatant, definition::ShipDefinition, geometry::radians, torpedoes::train_launchers,
};

#[test]
fn launcher_stops_reverse_through_neutral_and_clamp_unreachable_aim() {
    let def: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/yukikaze.json")).unwrap();
    let mut actor = Combatant::new("player", &def);
    let launcher = &def.torpedo_launchers.as_ref().unwrap()[0];
    let limit = radians(launcher.traverse_limits_deg.unwrap()[1]);
    actor.launcher_trains.insert(launcher.id.clone(), limit);
    let aim = |angle: f64| {
        Some([
            launcher.position[0] + 1000.0 * angle.sin(),
            0.0,
            launcher.position[2] - 1000.0 * angle.cos(),
        ])
    };
    train_launchers(&mut actor, &def, &|_| aim(-limit), 1.0 / 60.0, None);
    assert!(actor.launcher_trains[&launcher.id] < limit);
    let mut neutral = false;
    for _ in 0..1000 {
        train_launchers(&mut actor, &def, &|_| aim(-limit), 1.0 / 60.0, None);
        let angle = actor.launcher_trains[&launcher.id];
        assert!(angle.abs() <= limit + 1e-10);
        neutral |= angle.abs() < 0.01;
    }
    assert!(neutral);
    assert!((actor.launcher_trains[&launcher.id] + limit).abs() < 1e-9);
    for _ in 0..1000 {
        train_launchers(&mut actor, &def, &|_| aim(radians(170.0)), 1.0 / 60.0, None);
    }
    assert!((actor.launcher_trains[&launcher.id] - limit).abs() < 1e-9);
}

#[test]
fn absent_travel_stops_preserve_wrapped_shortest_path() {
    let mut def: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/yukikaze.json")).unwrap();
    def.torpedo_launchers.as_mut().unwrap()[0].traverse_limits_deg = None;
    let launcher = &def.torpedo_launchers.as_ref().unwrap()[0];
    let mut actor = Combatant::new("player", &def);
    actor
        .launcher_trains
        .insert(launcher.id.clone(), radians(110.0));
    let target = -radians(110.0);
    train_launchers(
        &mut actor,
        &def,
        &|_| {
            Some([
                1000.0 * target.sin(),
                0.0,
                launcher.position[2] - 1000.0 * target.cos(),
            ])
        },
        1.0 / 60.0,
        None,
    );
    assert!(actor.launcher_trains[&launcher.id] > radians(110.0));
}

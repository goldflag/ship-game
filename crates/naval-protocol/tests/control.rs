use naval_protocol::*;
fn fixture() -> FleetControl {
    FleetControl::new([("a-1".into(), 0), ("a-2".into(), 0), ("b-1".into(), 1)]).unwrap()
}
fn envelope(seq: u32, epoch: u32, ship: &str, command: Command) -> CommandEnvelope {
    CommandEnvelope {
        sequence: seq,
        connection_epoch: epoch,
        ship_id: ship.into(),
        command,
    }
}
fn input() -> Command {
    Command::Input {
        input: HeldInput {
            manual_helm: None,
            throttle: 1.0,
            rudder: 0.0,
            aim: [0.0, 0.5, -5000.0],
            fire: true,
            battery: Battery::Main,
            weapon_group_id: None,
            ammunition: Ammo::Ap,
            depth_m: None,
            emergency_blow: None,
        },
    }
}
#[test]
fn ownership_switching_and_persistent_orders() {
    let mut f = fixture();
    assert_eq!(
        f.apply(0, envelope(1, 1, "b-1", input()), 0),
        Err(CommandError::Ownership)
    );
    f.apply(0, envelope(1, 1, "a-1", input()), 0).unwrap();
    f.apply(
        0,
        envelope(
            2,
            1,
            "a-1",
            Command::Move {
                position: [20.0, 30.0],
            },
        ),
        1,
    )
    .unwrap();
    f.apply(0, envelope(3, 1, "a-2", Command::Select), 2)
        .unwrap();
    assert!(f.ships["a-1"].input.is_none());
    assert!(matches!(
        f.ships["a-1"].movement,
        MovementOrder::Move { .. }
    ));
    assert_eq!(
        f.apply(0, envelope(4, 1, "a-1", input()), 3),
        Err(CommandError::NotSelected)
    );
    assert_eq!(
        f.apply(
            0,
            envelope(
                4,
                1,
                "a-2",
                Command::Focus {
                    target_id: "a-1".into()
                }
            ),
            3
        ),
        Err(CommandError::Target)
    );
    f.apply(
        0,
        envelope(
            4,
            1,
            "a-1",
            Command::Focus {
                target_id: "b-1".into(),
            },
        ),
        3,
    )
    .unwrap();
    assert!(matches!(
        f.ships["a-1"].movement,
        MovementOrder::Move { .. }
    ));
}
#[test]
fn input_expiry_and_old_socket_events_cannot_override_reconnect() {
    let mut f = fixture();
    f.apply(0, envelope(1, 1, "a-1", input()), 0).unwrap();
    f.expire_inputs(29);
    assert!(f.ships["a-1"].input.is_some());
    f.expire_inputs(30);
    assert!(f.ships["a-1"].input.is_none());
    f.apply(0, envelope(2, 1, "a-1", input()), 30).unwrap();
    assert!(f.disconnect(0, 1));
    assert!(f.ships["a-1"].input.is_none());
    assert_eq!(f.reconnect(0).unwrap(), 2);
    assert!(!f.disconnect(0, 1));
    assert_eq!(
        f.apply(0, envelope(3, 1, "a-1", input()), 31),
        Err(CommandError::StaleConnection)
    );
    f.apply(0, envelope(1, 2, "a-1", input()), 31).unwrap();
    assert_eq!(
        f.apply(0, envelope(1, 2, "a-1", Command::Hold), 31),
        Err(CommandError::Duplicate)
    );
}
#[test]
fn malformed_unbounded_and_nonfinite_inputs_fail_closed() {
    assert!(decode_command(br#"{"sequence":1,"connectionEpoch":1,"shipId":"a-1","playerId":"spoof","command":{"type":"select"}}"#).is_err());
    assert_eq!(
        decode_command(&vec![b' '; MAX_COMMAND_BYTES + 1]).unwrap_err(),
        CommandError::TooLarge
    );
    let mut f = fixture();
    assert_eq!(
        f.apply(
            0,
            envelope(
                1,
                1,
                "a-1",
                Command::Move {
                    position: [f64::NAN, 0.0]
                }
            ),
            0
        ),
        Err(CommandError::Bounds)
    );
    assert_eq!(
        f.apply(
            0,
            envelope(
                1,
                1,
                "a-1",
                Command::Move {
                    position: [40001.0, 0.0]
                }
            ),
            0
        ),
        Err(CommandError::Bounds)
    );
    f.ships.get_mut("a-1").unwrap().afloat = false;
    assert_eq!(
        f.apply(0, envelope(1, 1, "a-1", input()), 0),
        Err(CommandError::Lost)
    );
}

fn escort(leader: &str) -> Command {
    Command::Escort {
        leader_id: leader.into(),
        offset: [650.0, 350.0],
        radius_m: 1500.0,
    }
}

#[test]
fn escort_focus_weapons_and_manual_release_preserve_the_standing_task() {
    let mut f = fixture();
    f.apply(0, envelope(1, 1, "a-1", escort("a-2")), 0).unwrap();
    let movement = f.ships["a-1"].movement.clone();
    f.apply(
        0,
        envelope(
            2,
            1,
            "a-1",
            Command::Focus {
                target_id: "b-1".into(),
            },
        ),
        1,
    )
    .unwrap();
    f.apply(
        0,
        envelope(
            3,
            1,
            "a-1",
            Command::Weapons {
                policy: WeaponsPolicy::fleet_default(),
            },
        ),
        2,
    )
    .unwrap();
    f.apply(0, envelope(4, 1, "a-1", input()), 3).unwrap();
    f.apply(0, envelope(5, 1, "a-1", Command::ReleaseHelm), 4)
        .unwrap();
    assert_eq!(f.players[0].selected_ship_id, None);
    assert!(f.ships["a-1"].input.is_none());
    assert_eq!(f.ships["a-1"].movement, movement);
    assert_eq!(f.ships["a-1"].target_id.as_deref(), Some("b-1"));
    assert!(!f.ships["a-1"].weapons.torpedoes);
    assert!(f.ships["a-1"].weapons.guns && f.ships["a-1"].weapons.aa);
    assert_eq!(
        f.apply(0, envelope(6, 1, "a-1", input()), 5),
        Err(CommandError::NotSelected)
    );
    f.apply(0, envelope(6, 1, "a-1", Command::Select), 5)
        .unwrap();
    assert!(f.ships["a-1"].input.is_none());
    assert_eq!(f.ships["a-1"].movement, movement);
}

#[test]
fn invalid_escort_leaders_and_cycles_leave_orders_and_sequence_unchanged() {
    let mut f = fixture();
    for leader in ["missing", "b-1", "a-1"] {
        assert_eq!(
            f.apply(0, envelope(1, 1, "a-1", escort(leader)), 0),
            Err(CommandError::Escort)
        );
    }
    f.apply(0, envelope(1, 1, "a-1", escort("a-2")), 0).unwrap();
    assert_eq!(
        f.apply(0, envelope(2, 1, "a-2", escort("a-1")), 1),
        Err(CommandError::Escort)
    );
    assert_eq!(f.ships["a-2"].movement, MovementOrder::Autonomous);
    f.ships.get_mut("a-2").unwrap().afloat = false;
    assert_eq!(
        f.apply(0, envelope(2, 1, "a-1", escort("a-2")), 1),
        Err(CommandError::Escort)
    );
    f.apply(0, envelope(2, 1, "a-1", Command::Hold), 1).unwrap();
}

#[test]
fn route_append_is_bounded_and_rejections_do_not_erase_the_route() {
    let mut f = fixture();
    let route = |waypoints, append| Command::Route {
        waypoints,
        speed_mps: 12.0,
        looped: false,
        append,
    };
    assert_eq!(
        f.apply(
            0,
            envelope(1, 1, "a-1", route(vec![[0.0, -1000.0]], true)),
            0
        ),
        Err(CommandError::Route)
    );
    f.apply(
        0,
        envelope(1, 1, "a-1", route(vec![[0.0, -1000.0]], false)),
        0,
    )
    .unwrap();
    f.apply(
        0,
        envelope(2, 1, "a-1", route(vec![[1000.0, -1000.0]], true)),
        1,
    )
    .unwrap();
    let saved = f.ships["a-1"].movement.clone();
    assert_eq!(
        f.apply(
            0,
            envelope(3, 1, "a-1", route(vec![[1.0, 2.0]; 32], true)),
            2
        ),
        Err(CommandError::Route)
    );
    assert_eq!(f.ships["a-1"].movement, saved);
    assert_eq!(
        f.apply(
            0,
            envelope(3, 1, "a-1", route(vec![[f64::NAN, 0.0]], false)),
            2
        ),
        Err(CommandError::Bounds)
    );
    assert_eq!(f.ships["a-1"].movement, saved);
    let json =
        serde_json::to_vec(&envelope(3, 1, "a-1", route(vec![[0.0, -3000.0]], true))).unwrap();
    f.apply(0, decode_command(&json).unwrap(), 2).unwrap();
    let MovementOrder::Route { waypoints, .. } = &f.ships["a-1"].movement else {
        panic!("lost route")
    };
    assert_eq!(
        waypoints,
        &vec![[0.0, -1000.0], [1000.0, -1000.0], [0.0, -3000.0]]
    );
}

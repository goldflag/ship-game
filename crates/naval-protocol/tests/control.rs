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

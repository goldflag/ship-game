//! Development direction (`Session::direct`, the film driver's `LocalRuntime::direct`): any ship on
//! either side takes an order as its owner's, under the owner's validation, without spending the
//! owner's command sequence.
use naval_protocol::{Command, CommandEnvelope, CommandError, MovementOrder, session::Session};
use naval_sim::{
    battle::{Battle, BattleSetup, ShipSetup},
    bots::AiLevel,
    catalog::Catalog,
    rules::TeamId,
    vessel::Controller,
};
use std::{collections::BTreeMap, sync::Arc};

fn session() -> Session {
    let catalog = Catalog::load(&naval_sim::catalog::installed_manifest()).unwrap();
    let compiled: BTreeMap<_, _> = [(
        "fletcher".to_string(),
        Arc::new(catalog.compile("fletcher").unwrap()),
    )]
    .into();
    let ships = [("a", TeamId::A), ("b", TeamId::B)]
        .into_iter()
        .map(|(id, team)| ShipSetup {
            id: id.into(),
            preset_id: "fletcher".into(),
            team,
            controller: Controller::Bot,
            ai_level: AiLevel::Normal,
            spawn: None,
        })
        .collect();
    let battle = Battle::new(
        Arc::new(catalog),
        &compiled,
        BattleSetup {
            ships,
            seed: 7,
            map_id: "north-atlantic".into(),
            weather: "clear".into(),
            spawn_distance: 8000.0,
            wind_speed: None,
            time_of_day: None,
            mission_rules: None,
            air_rules: None,
        },
    )
    .unwrap();
    Session::new(battle, [TeamId::A, TeamId::B]).unwrap()
}
fn envelope(sequence: u32, ship: &str, command: Command) -> CommandEnvelope {
    CommandEnvelope {
        sequence,
        connection_epoch: 1,
        ship_id: ship.into(),
        command,
    }
}

#[test]
fn directed_orders_reach_either_side_under_the_owners_validation() {
    let mut session = session();
    for ship in ["a", "b"] {
        session
            .direct(
                ship,
                Command::Move {
                    position: [100.0, -200.0],
                },
            )
            .unwrap();
        assert!(matches!(
            session.control.ships[ship].movement,
            MovementOrder::Move { .. }
        ));
    }
    // A ship cannot be told to focus on itself, whoever directs it, and an unknown ship has no owner.
    assert_eq!(
        session.direct(
            "b",
            Command::Focus {
                target_id: "b".into()
            }
        ),
        Err(CommandError::Target)
    );
    assert_eq!(
        session.direct("nobody", Command::Hold),
        Err(CommandError::Ownership)
    );
}

#[test]
fn directed_orders_leave_the_owners_sequence_alone() {
    let mut session = session();
    session.direct("a", Command::Hold).unwrap();
    session.direct("b", Command::Hold).unwrap();
    // Each owner's own first command still carries sequence 1.
    session
        .apply(0, envelope(1, "a", Command::Autonomous))
        .unwrap();
    session
        .apply(1, envelope(1, "b", Command::Autonomous))
        .unwrap();
    assert_eq!(
        session.apply(0, envelope(1, "a", Command::Hold)),
        Err(CommandError::Duplicate)
    );
}

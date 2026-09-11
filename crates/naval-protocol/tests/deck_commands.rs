use naval_protocol::{Command, CommandEnvelope, CommandError, decode_command, session::Session};
use naval_sim::{
    air_rules::{ActiveFlights, AirRules, DeckCycle, DeckTimings, EndurancePolicy},
    battle::{Battle, BattleSetup, ShipSetup},
    bots::AiLevel,
    catalog::Catalog,
    deck_operations::{DeckAction, DeckPolicy},
    rules::TeamId,
    vessel::Controller,
};
use std::{collections::BTreeMap, sync::Arc};
fn envelope(sequence: u32, ship: &str, command: Command) -> CommandEnvelope {
    CommandEnvelope {
        sequence,
        connection_epoch: 1,
        ship_id: ship.into(),
        command,
    }
}
#[test]
fn deck_commands_validate_ids_and_cannot_bypass_flight_order_validation() {
    for command in [
        Command::Deck {
            flight_id: "group".into(),
            action: DeckAction::Launch,
        },
        Command::Deck {
            flight_id: "".into(),
            action: DeckAction::Raise,
        },
        Command::CancelDeck { request_id: 0 },
        Command::NextDeck { request_id: 0 },
        Command::NextDeck {
            request_id: u64::MAX,
        },
        Command::CancelDeck {
            request_id: u64::MAX,
        },
    ] {
        assert_eq!(
            decode_command(&serde_json::to_vec(&envelope(1, "carrier", command)).unwrap())
                .unwrap_err(),
            CommandError::Bounds
        );
    }
}
#[test]
fn owned_carriers_receive_deck_commands_without_taking_the_destroyer_helm() {
    let mut catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    // A trusted diagnostic profile exercises transport before the production
    // mission switches away from its explicit compatibility profile.
    let mut rules = AirRules::legacy();
    rules.id = "deck-command-test-v1".into();
    rules.group_size = Some(4);
    rules.deck_capacity = Some(24);
    rules.active_flights = ActiveFlights::Unlimited;
    rules.endurance = EndurancePolicy::Disabled;
    rules.deck_cycle = DeckCycle::Managed {
        startup_groups_per_role: 2,
        timings: DeckTimings {
            lift_seconds: 6.0,
            taxi_speed: 12.0,
            turn_radians_per_second: 0.7,
            rearm_seconds: 35.0,
            repair_seconds: 90.0,
        },
    };
    catalog.air_profiles.insert(rules.id.clone(), rules.clone());
    let compiled: BTreeMap<_, _> = ["enterprise-cv6", "shokaku", "fletcher"]
        .into_iter()
        .map(|id| (id.into(), Arc::new(catalog.compile(id).unwrap())))
        .collect();
    let ships = [
        ("enterprise", "enterprise-cv6", TeamId::A),
        ("escort", "fletcher", TeamId::A),
        ("shokaku", "shokaku", TeamId::A),
        ("enemy", "enterprise-cv6", TeamId::B),
    ]
    .into_iter()
    .map(|(id, preset, team)| ShipSetup {
        id: id.into(),
        preset_id: preset.into(),
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
            spawn_distance: 12000.0,
            wind_speed: None,
            mission_rules: None,
            air_rules: Some(rules),
        },
    )
    .unwrap();
    let mut session = Session::new(battle, [TeamId::A, TeamId::B]).unwrap();
    session
        .apply(0, envelope(1, "escort", Command::Select))
        .unwrap();
    for (sequence, carrier) in [(2, "enterprise"), (3, "shokaku")] {
        let flight = session.battle.aviation.wing(carrier).unwrap().flights[2]
            .id
            .clone();
        session
            .apply(
                0,
                envelope(
                    sequence,
                    carrier,
                    Command::Deck {
                        flight_id: flight,
                        action: DeckAction::Raise,
                    },
                ),
            )
            .unwrap();
    }
    let request = session
        .battle
        .aviation
        .wing("enterprise")
        .unwrap()
        .deck
        .as_ref()
        .unwrap()
        .queue[0]
        .id;
    // No simulation step is needed to display or cancel a paused command.
    assert_eq!(session.battle.tick, 0);
    session
        .apply(
            0,
            envelope(
                4,
                "enterprise",
                Command::CancelDeck {
                    request_id: request,
                },
            ),
        )
        .unwrap();
    assert!(
        session
            .battle
            .aviation
            .wing("enterprise")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .queue
            .is_empty()
    );
    assert_eq!(
        session
            .battle
            .aviation
            .wing("shokaku")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .queue
            .len(),
        1
    );
    assert_eq!(
        session.apply(
            0,
            envelope(
                5,
                "enemy",
                Command::CancelDeck {
                    request_id: request
                }
            )
        ),
        Err(CommandError::Ownership)
    );
    let enemy_flight = session.battle.aviation.wing("enemy").unwrap().flights[2]
        .id
        .clone();
    assert!(matches!(
        session.apply(
            0,
            envelope(
                5,
                "shokaku",
                Command::Deck {
                    flight_id: enemy_flight,
                    action: DeckAction::Raise
                }
            )
        ),
        Err(CommandError::Deck(_))
    ));
    session
        .apply(
            0,
            envelope(
                6,
                "shokaku",
                Command::CancelDeck {
                    request_id: request,
                },
            ),
        )
        .unwrap();
    assert!(matches!(
        session.apply(
            0,
            envelope(
                7,
                "shokaku",
                Command::CancelDeck {
                    request_id: request
                }
            )
        ),
        Err(CommandError::Deck(_))
    ));
    session
        .apply(
            0,
            envelope(
                8,
                "enterprise",
                Command::DeckPolicy {
                    policy: DeckPolicy::LaunchFirst,
                },
            ),
        )
        .unwrap();
    session
        .apply(
            0,
            envelope(
                9,
                "shokaku",
                Command::DeckPolicy {
                    policy: DeckPolicy::RecoverFirst,
                },
            ),
        )
        .unwrap();
    assert_eq!(
        session
            .battle
            .aviation
            .wing("enterprise")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .policy,
        DeckPolicy::LaunchFirst
    );
    assert_eq!(
        session
            .battle
            .aviation
            .wing("shokaku")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .policy,
        DeckPolicy::RecoverFirst
    );
    let groups = session
        .battle
        .aviation
        .wing("enterprise")
        .unwrap()
        .flights
        .clone();
    session
        .apply(
            0,
            envelope(
                10,
                "enterprise",
                Command::Deck {
                    flight_id: groups[2].id.clone(),
                    action: DeckAction::Raise,
                },
            ),
        )
        .unwrap();
    let raise = session
        .battle
        .aviation
        .wing("enterprise")
        .unwrap()
        .deck
        .as_ref()
        .unwrap()
        .queue[0]
        .id;
    assert!(
        matches!(session.apply(0, envelope(11, "enterprise", Command::NextDeck { request_id: raise })), Err(CommandError::Deck(reason)) if reason.contains("deck is full"))
    );
    for (sequence, group) in [(12, &groups[0]), (13, &groups[1])] {
        session
            .apply(
                0,
                envelope(
                    sequence,
                    "enterprise",
                    Command::Deck {
                        flight_id: group.id.clone(),
                        action: DeckAction::Stow,
                    },
                ),
            )
            .unwrap();
    }
    let next = session
        .battle
        .aviation
        .wing("enterprise")
        .unwrap()
        .deck
        .as_ref()
        .unwrap()
        .queue
        .last()
        .unwrap()
        .id;
    session
        .apply(
            0,
            envelope(14, "enterprise", Command::NextDeck { request_id: next }),
        )
        .unwrap();
    let deck = session
        .battle
        .aviation
        .wing("enterprise")
        .unwrap()
        .deck
        .as_ref()
        .unwrap();
    assert_eq!(deck.next_request_id, Some(next));
    assert_eq!(deck.queue[0].id, next);
    assert_eq!(deck.queue.len(), 3);
    assert_eq!(session.battle.tick, 0);
    assert!(matches!(
        session.apply(
            0,
            envelope(
                15,
                "enemy",
                Command::DeckPolicy {
                    policy: DeckPolicy::LaunchFirst
                }
            )
        ),
        Err(CommandError::Ownership)
    ));
    assert_eq!(
        session.control.players[0].selected_ship_id.as_deref(),
        Some("escort")
    );
    assert!(
        session
            .battle
            .aviation
            .wings
            .iter()
            .all(|w| w.state.planes.len() == 48)
    );
}

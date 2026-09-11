//! A strike whose report dies shifts to a ship the pilot can see, or returns
//! armed. It never orbits a sunk contact until endurance runs out.
use naval_sim::{
    air_rules::{ActiveFlights, AirRules, EndurancePolicy},
    aircraft::AirOrder,
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    rules::TeamId,
    sensors::{self, Knowledge, Sensors},
    vessel::Vessel,
};
use std::sync::{Arc, OnceLock};
fn catalog() -> &'static Catalog {
    static C: OnceLock<Catalog> = OnceLock::new();
    C.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn vessel(id: &str, preset: &str, team: TeamId, x: f64, z: f64) -> Vessel {
    let mut v = Vessel::new(id, team, Arc::new(catalog().compile(preset).unwrap()));
    v.motion.x = x;
    v.motion.z = z;
    v
}
fn setup(second_enemy: Option<f64>) -> (Vec<Vessel>, Aviation, Sensors) {
    let mut actors = vec![
        vessel("carrier", "enterprise-cv6", TeamId::A, 0.0, 0.0),
        vessel("enemy-1", "fletcher", TeamId::B, 0.0, -9000.0),
    ];
    if let Some(x) = second_enemy {
        actors.push(vessel("enemy-2", "fletcher", TeamId::B, x, -9000.0));
    }
    let mut rules = AirRules::legacy();
    rules.group_size = Some(4);
    rules.active_flights = ActiveFlights::Unlimited;
    rules.endurance = EndurancePolicy::Disabled;
    let mut air = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    air.airspace = Some(catalog().missions["pve-fleet-v1"].area.clone());
    (actors, air, Sensors::default())
}
fn observe(actors: &[Vessel], air: &Aviation, reports: &mut Sensors, tick: u64) {
    reports.update(
        tick,
        &sensors::entities(actors, air),
        &[],
        &[],
        sensors::VisualConditions::resolve(catalog(), "north-atlantic", "clear"),
        &sensors::VisualRules::default(),
    );
}
fn step(actors: &[Vessel], air: &mut Aviation, reports: &Sensors, tick: u64) {
    air.step(
        &mut AirContext {
            knowledge: Some(Knowledge {
                sensors: reports,
                tick,
                islands: &[],
                terrain: &[],
            }),
            actors,
            shells: &mut vec![],
            torpedoes: &mut vec![],
            releases: &mut vec![],
            sequence: &mut 0,
            events: &mut vec![],
            seed: 7,
            sea: None,
        },
        0.25,
        tick as f64 / 60.0,
    );
}
/// Put one dive-bomber flight in the air, mid-way to the enemy, and commit it
/// against the first enemy's report.
fn strike_in_flight(actors: &[Vessel], air: &mut Aviation, reports: &mut Sensors) -> String {
    let flight = air
        .squadron_flights(&actors[0])
        .into_iter()
        .find(|f| {
            air.wing("carrier")
                .unwrap()
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == "dive-bomber")
        })
        .unwrap();
    for tick in [60, 120, 180] {
        observe(actors, air, reports, tick);
    }
    let contact = reports
        .contacts(TeamId::A)
        .into_iter()
        .find(|c| c.kind == sensors::ContactKind::Surface)
        .unwrap()
        .id;
    assert!(air.command_squadron(
        &actors[0],
        &flight.id,
        AirOrder::Strike {
            contact_id: contact
        },
        actors,
        None
    ));
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| flight.plane_ids.contains(&p.id))
    {
        p.phase = "outbound".into();
        p.deck_slot = None;
        p.deck_position = None;
        p.position = [0.0, 850.0, -4000.0];
        p.previous_position = p.position;
        p.velocity = [0.0, 0.0, -85.0];
    }
    flight.id
}
fn flight_state(air: &Aviation, id: &str) -> (AirOrder, Option<String>, Vec<String>) {
    let wing = air.wing("carrier").unwrap();
    let f = wing.flights.iter().find(|f| f.id == id).unwrap();
    let phases = wing
        .planes
        .iter()
        .filter(|p| f.plane_ids.contains(&p.id))
        .map(|p| p.phase.clone())
        .collect();
    (f.order.clone(), f.notice.clone(), phases)
}

#[test]
fn a_strike_whose_target_sinks_attacks_the_ship_it_can_see_instead() {
    let (mut actors, mut air, mut reports) = setup(Some(3000.0));
    let flight = strike_in_flight(&actors, &mut air, &mut reports);
    let first = match flight_state(&air, &flight).0 {
        AirOrder::Strike { contact_id } => contact_id,
        _ => unreachable!(),
    };
    // Enemy-1 goes down and is never seen again; enemy-2 stays 3 km away.
    actors.remove(1);
    let mut retargeted = None;
    for tick in (240_u64..240 + 240 * 60).step_by(15) {
        if tick.is_multiple_of(60) {
            observe(&actors, &air, &mut reports, tick);
        }
        step(&actors, &mut air, &reports, tick);
        let (order, notice, _) = flight_state(&air, &flight);
        if let AirOrder::Strike { contact_id } = &order
            && contact_id != &first
        {
            retargeted = Some((tick, contact_id.clone(), notice));
            break;
        }
    }
    let (tick, contact, notice) = retargeted.expect("the strike must shift to the visible ship");
    assert!(
        tick <= 240 + 180 * 60,
        "retarget follows at most a minute of transit plus a 90 s search, took {} s",
        (tick - 240) / 60
    );
    let track = reports.contact(TeamId::A, &contact).unwrap();
    assert!(track.targetable());
    assert_eq!(
        notice.as_deref(),
        Some("Target lost · Attacking Small warship")
    );
    let wing = air.wing("carrier").unwrap();
    let f = wing.flights.iter().find(|f| f.id == flight).unwrap();
    assert!(
        wing.planes
            .iter()
            .filter(|p| f.plane_ids.contains(&p.id))
            .all(|p| p.target_id.as_deref() == Some(contact.as_str())),
        "every aircraft in the flight follows the flight's new target"
    );
}

#[test]
fn a_strike_with_no_visible_ship_left_returns_armed_within_the_search_window() {
    let (mut actors, mut air, mut reports) = setup(None);
    let flight = strike_in_flight(&actors, &mut air, &mut reports);
    actors.remove(1);
    let mut returned = None;
    for tick in (240_u64..240 + 300 * 60).step_by(15) {
        if tick.is_multiple_of(60) {
            observe(&actors, &air, &mut reports, tick);
        }
        step(&actors, &mut air, &reports, tick);
        let (_, notice, phases) = flight_state(&air, &flight);
        if phases
            .iter()
            .all(|p| p == "returning" || p == "landing" || p == "ready")
        {
            returned = Some((tick, notice));
            break;
        }
    }
    let (tick, notice) = returned.expect("the strike must turn for home");
    assert!(
        tick <= 240 + 180 * 60,
        "return follows at most a minute of transit plus a 90 s search, took {} s",
        (tick - 240) / 60
    );
    assert_eq!(notice.as_deref(), Some("Target lost · Returning armed"));
    let wing = air.wing("carrier").unwrap();
    let f = wing.flights.iter().find(|f| f.id == flight).unwrap();
    assert!(
        wing.planes
            .iter()
            .filter(|p| f.plane_ids.contains(&p.id))
            .all(|p| p.payload),
        "nobody drops a bomb on an empty sea"
    );
}

use naval_sim::{
    air_rules::{ActiveFlights, AirRules, EndurancePolicy},
    aircraft::AirOrder,
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    rules::TeamId,
    vessel::{CompiledShip, Controller, Vessel},
};
use std::sync::{Arc, OnceLock};

fn manifest() -> Vec<u8> {
    std::fs::read("../../.build/naval-content/manifest.json").unwrap()
}
fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| Catalog::load(&manifest()).unwrap())
}
fn carrier() -> Vessel {
    static SHIP: OnceLock<Arc<CompiledShip>> = OnceLock::new();
    let mut actor = Vessel::new(
        "carrier",
        TeamId::A,
        SHIP.get_or_init(|| {
            Arc::new(CompiledShip::new(catalog().definitions["enterprise-cv6"].clone()).unwrap())
        })
        .clone(),
    );
    actor.controller = Controller::Player;
    actor
}
fn patrol() -> AirOrder {
    AirOrder::Patrol {
        point: [5000.0, 600.0, -5000.0],
    }
}
fn step(aviation: &mut Aviation, actors: &[Vessel]) {
    let mut shells = vec![];
    let mut torpedoes = vec![];
    let mut releases = vec![];
    let mut sequence = 0;
    let mut events = vec![];
    aviation.step(
        &mut AirContext {
            knowledge: None,
            actors,
            shells: &mut shells,
            torpedoes: &mut torpedoes,
            releases: &mut releases,
            sequence: &mut sequence,
            events: &mut events,
            seed: 1,
            sea: None,
        },
        0.1,
        0.1,
    );
}

#[test]
fn content_profiles_are_required_and_selected_values_cannot_be_tampered_with() {
    let rules = AirRules::legacy();
    assert!(rules.validate_selection(catalog()).is_ok());
    let mut altered = rules.clone();
    altered.consolidation = naval_sim::air_rules::ConsolidationPolicy::Disabled;
    assert!(altered.validate_selection(catalog()).is_err());
    altered = rules.clone();
    altered.endurance = EndurancePolicy::Disabled;
    assert!(altered.validate_selection(catalog()).is_err());
    altered.id = "missing".into();
    assert!(altered.validate_selection(catalog()).is_err());
    let mut value: serde_json::Value = serde_json::from_slice(&manifest()).unwrap();
    value["airProfiles"] = serde_json::json!([]);
    assert!(Catalog::load(&serde_json::to_vec(&value).unwrap()).is_err());
    value["airProfiles"] = serde_json::json!([rules.clone(), rules.clone()]);
    assert!(Catalog::load(&serde_json::to_vec(&value).unwrap()).is_err());
    value["airProfiles"] = serde_json::json!([rules]);
    value["missions"][0]["airProfileId"] = serde_json::json!("missing");
    assert!(Catalog::load(&serde_json::to_vec(&value).unwrap()).is_err());
}

#[test]
fn unlimited_four_plane_groups_admit_a_full_wing_without_changing_inventory() {
    let actors = vec![carrier()];
    let actor = &actors[0];
    let mut rules = AirRules::legacy();
    rules.group_size = Some(4);
    rules.active_flights = ActiveFlights::Unlimited;
    let mut aviation =
        Aviation::with_rules(&actors, catalog().aircraft.clone(), rules.clone()).unwrap();
    let flights = aviation.squadron_flights(actor);
    assert_eq!(flights.len(), 12);
    let ids: Vec<_> = aviation
        .wing("carrier")
        .unwrap()
        .planes
        .iter()
        .map(|p| p.id.clone())
        .collect();
    for flight in flights {
        assert_eq!(
            aviation.launch_squadron(
                actor,
                &flight.squadron_id,
                None,
                Some(patrol()),
                &actors,
                Some(&flight.id),
                None
            ),
            4
        );
    }
    let wing = aviation.wing("carrier").unwrap();
    assert_eq!(wing.flights.len(), 12);
    assert!(wing.planes.iter().all(|p| p.phase == "queued"));
    assert_eq!(
        ids,
        wing.planes.iter().map(|p| p.id.clone()).collect::<Vec<_>>()
    );
    rules.deck_capacity = Some(24);
    assert!(
        Aviation::with_rules(&actors, catalog().aircraft.clone(), rules)
            .unwrap_err()
            .contains("authored deck")
    );
    // An explicit small allowance remains effective through the same admission path.
    let mut limited = AirRules::legacy();
    limited.active_flights = ActiveFlights::Limited { maximum: 1 };
    let mut aviation = Aviation::with_rules(&actors, catalog().aircraft.clone(), limited).unwrap();
    let flights = aviation.squadron_flights(actor);
    for (index, flight) in flights.iter().take(2).enumerate() {
        assert_eq!(
            aviation.launch_squadron(
                actor,
                &flight.squadron_id,
                None,
                Some(patrol()),
                &actors,
                Some(&flight.id),
                None
            ),
            if index == 0 { 6 } else { 0 }
        );
    }
}

#[test]
fn disabled_endurance_removes_order_recall_and_exhaustion_deadlines_but_keeps_combat_returns() {
    let actors = vec![carrier()];
    let actor = &actors[0];
    let mut rules = AirRules::legacy();
    rules.endurance = EndurancePolicy::Disabled;
    let mut aviation = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    let flight = aviation.squadron_flights(actor).remove(0);
    assert_eq!(
        aviation.launch_squadron(
            actor,
            &flight.squadron_id,
            None,
            Some(patrol()),
            &actors,
            Some(&flight.id),
            None
        ),
        6
    );
    for p in aviation
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .take(6)
    {
        p.phase = "outbound".into();
        p.flight_time = 2000.0;
        p.position = [5000.0, 600.0, -5000.0];
        p.velocity = [0.0, 0.0, -80.0];
    }
    let mut timed = aviation.clone();
    timed.rules = AirRules::legacy();
    let planes: Vec<_> = aviation
        .wing("carrier")
        .unwrap()
        .planes
        .iter()
        .take(6)
        .collect();
    assert!(aviation.valid_order(actor, &flight.id, &planes, &patrol(), &actors, false));
    assert!(!timed.valid_order(actor, &flight.id, &planes, &patrol(), &actors, false));
    step(&mut aviation, &actors);
    step(&mut timed, &actors);
    assert!(
        aviation
            .wing("carrier")
            .unwrap()
            .planes
            .iter()
            .take(6)
            .all(|p| p.phase == "outbound" && p.flight_time > 2000.0)
    );
    assert!(
        timed
            .wing("carrier")
            .unwrap()
            .planes
            .iter()
            .take(6)
            .all(|p| p.phase == "lost" && p.loss_reason.as_deref() == Some("Endurance exhausted"))
    );
    aviation.wing_mut("carrier").unwrap().planes[0].hp = 24.0;
    aviation.wing_mut("carrier").unwrap().planes[1].ammo = 0.0;
    step(&mut aviation, &actors);
    assert_eq!(
        aviation.wing("carrier").unwrap().planes[0].phase,
        "returning"
    );
    assert_eq!(
        aviation.wing("carrier").unwrap().planes[1].phase,
        "returning"
    );
    assert_eq!(
        aviation.wing("carrier").unwrap().planes[2].phase,
        "outbound"
    );
}

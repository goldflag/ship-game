use naval_sim::{
    aviation::Aviation,
    catalog::Catalog,
    mission::{self, MissionRules},
    motion::{HelmCommand, step_ship},
    rules::{TICK_RATE, TeamId},
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn mission() -> MissionRules {
    catalog().missions["pve-fleet-v1"].clone()
}
fn ship(id: &str, preset: &str, team: TeamId) -> Vessel {
    static CONTENT: OnceLock<BTreeMap<String, Arc<CompiledShip>>> = OnceLock::new();
    let content = CONTENT.get_or_init(|| {
        ["fletcher", "enterprise-cv6"]
            .into_iter()
            .map(|id| (id.into(), Arc::new(catalog().compile(id).unwrap())))
            .collect()
    });
    Vessel::new(id, team, content[preset].clone())
}
fn disable_weapons(a: &mut Vessel) {
    for m in &mut a.mounts {
        m.hp = 0.0;
    }
    for t in &mut a.torpedo_tubes {
        t.ammo = 0.0;
    }
}
#[test]
fn budgets_resolve_inventory_without_counting_carriers() {
    let m = mission();
    let fleet = m
        .budget
        .resolve(
            &["enterprise-cv6".into(), "enterprise-cv6".into()],
            catalog(),
        )
        .unwrap();
    assert_eq!(fleet.aircraft, 96);
    assert_eq!(fleet.ships, 2);
    assert!(
        m.budget
            .resolve(&vec!["fletcher".into(); 16], catalog())
            .unwrap_err()
            .contains("ships")
    );
    assert!(
        m.budget
            .resolve(&vec!["enterprise-cv6".into(); 3], catalog())
            .unwrap_err()
            .contains("aircraft")
    );
    assert!(
        m.budget
            .resolve(&vec!["iowa".into(); 5], catalog())
            .unwrap_err()
            .contains("tonnes")
    );
    assert!(m.budget.resolve(&["missing".into()], catalog()).is_err());
}
#[test]
fn trusted_profile_is_frozen_but_an_explicit_deadline_is_allowed() {
    let mut m = mission();
    assert!(m.validate_selection(catalog()).is_ok());
    assert_eq!(m.remaining_seconds(1800 * TICK_RATE), None);
    m.duration_seconds = Some(60);
    assert!(m.validate_selection(catalog()).is_ok());
    assert_eq!(m.remaining_seconds(30 * TICK_RATE), Some(30.0));
    m.budget.max_aircraft = 101;
    assert!(m.validate_selection(catalog()).is_err());
    m = mission();
    m.version = 2;
    assert!(m.validate_selection(catalog()).is_err());
}
#[test]
fn incapacity_distinguishes_immobility_reload_and_permanent_weapon_loss() {
    let mut a = ship("a", "fletcher", TeamId::A);
    for m in &mut a.mounts {
        m.reload = 90.0;
    }
    let engines: Vec<_> = a
        .definition()
        .modules
        .iter()
        .filter(|m| m.kind == "engine")
        .map(|m| m.id.clone())
        .collect();
    for m in &mut a.damage.modules {
        if engines.contains(&m.id) {
            m.hp = 0.0;
        }
    }
    assert!(!mission::permanently_incapable(&a, None));
    disable_weapons(&mut a);
    assert!(mission::permanently_incapable(&a, None));
}
#[test]
fn carrier_strike_capability_survives_service_interruption_but_fighters_alone_do_not() {
    let mut a = ship("a", "enterprise-cv6", TeamId::A);
    let mut aviation = Aviation::new(std::slice::from_ref(&a), catalog().aircraft.clone());
    disable_weapons(&mut a);
    let service = a
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .service_module_id
        .clone();
    let module = a
        .damage
        .modules
        .iter()
        .position(|m| m.id == service)
        .unwrap();
    a.damage.modules[module].hp = 1.0;
    let wing = &mut aviation.wings[0].state;
    assert!(!mission::permanently_incapable(&a, Some(wing)));
    a.damage.modules[module].hp = 0.0;
    assert!(mission::permanently_incapable(&a, Some(wing)));
    let strike = wing
        .planes
        .iter()
        .position(|p| p.role != "fighter")
        .unwrap();
    wing.planes[strike].phase = "returning".into();
    wing.planes[strike].payload = true;
    assert!(!mission::permanently_incapable(&a, Some(wing)));
    wing.planes[strike].payload = false;
    assert!(mission::permanently_incapable(&a, Some(wing)));
    a.damage.modules[module].hp = 100.0;
    for p in &mut wing.planes {
        if p.role != "fighter" {
            p.phase = "lost".into();
        }
    }
    assert!(mission::permanently_incapable(&a, Some(wing)));
}
#[test]
fn simultaneous_elimination_draws_and_aircraft_cannot_keep_a_sunk_fleet_alive() {
    let mut actors = vec![
        ship("a", "enterprise-cv6", TeamId::A),
        ship("b", "fletcher", TeamId::B),
    ];
    let aviation = Aviation::new(&actors, catalog().aircraft.clone());
    let mut m = mission();
    assert!(mission::evaluate(1801 * TICK_RATE, &actors, &aviation, &m, [1, 1]).is_none());
    m.duration_seconds = Some(60);
    assert_eq!(
        mission::evaluate(60 * TICK_RATE, &actors, &aviation, &m, [100, 1])
            .unwrap()
            .winner_team_id,
        None
    );
    m.duration_seconds = None;
    actors[0].damage.sunk = true;
    assert_eq!(
        mission::evaluate(1, &actors, &aviation, &m, [0, 1])
            .unwrap()
            .winner_team_id,
        Some(TeamId::B)
    );
    disable_weapons(&mut actors[1]);
    assert_eq!(
        mission::evaluate(1, &actors, &aviation, &m, [0, 1])
            .unwrap()
            .winner_team_id,
        None
    );
}
#[test]
fn circular_boundary_turns_under_physics_without_teleporting_or_eliminating_drifters() {
    let mut a = ship("a", "fletcher", TeamId::A);
    let area = mission().area;
    a.motion.x = 24100.0;
    a.motion.heading = std::f64::consts::FRAC_PI_2;
    a.motion.speed = 12.0;
    let handling = a.definition().handling.clone();
    let order = HelmCommand {
        throttle: 0.7,
        ..Default::default()
    };
    for _ in 0..120 * TICK_RATE {
        let command = area.constrain(&a, order);
        let before = [a.motion.x, a.motion.z];
        step_ship(&mut a.motion, command, &handling, 1.0, 1.0, None);
        assert!((before[0] - a.motion.x).hypot(before[1] - a.motion.z) < 1.0);
        assert!(area.contains([a.motion.x, a.motion.z], 0.0));
    }
    assert!(a.motion.x.hypot(a.motion.z) < 24000.0);
    a.motion.x = 25100.0;
    a.motion.z = 0.0;
    a.motion.speed = 0.0;
    let command = area.constrain(&a, order);
    step_ship(&mut a.motion, command, &handling, 0.0, 0.0, None);
    assert!((a.motion.x - 25100.0).abs() < 0.1);
    assert!(a.physical_loss().is_none());
}

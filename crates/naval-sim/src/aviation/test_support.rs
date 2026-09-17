//! Fixtures shared by the wing's unit tests: the built content manifest, a
//! player-controlled carrier, a launched flight held at the airborne decision
//! boundary, a fighter sweep against two inbound raids, and a three-ship
//! battle for presentation checks. Test-only; never compiled into the wing.
use super::{AirFlight, AirOrder, Aircraft, Aviation};
use crate::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    rules::TeamId,
    vessel::{CompiledShip, Controller, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
pub(super) fn catalog() -> &'static Catalog {
    &content().0
}
pub(super) fn carrier(id: &str, preset: &str, team: TeamId) -> Vessel {
    let mut a = Vessel::new(id, team, Arc::new(catalog().compile(preset).unwrap()));
    a.controller = Controller::Player;
    a
}
type Content = (Arc<Catalog>, BTreeMap<String, Arc<CompiledShip>>);
pub(super) fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = ["fletcher", "enterprise-cv6"]
            .into_iter()
            .map(|id| (id.into(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
/// One six-plane flight of `role`, launched and then moved to "outbound" at
/// 850 m so pilot tests start past the takeoff geometry.
pub(super) fn planes(role: &str) -> (AirFlight, Vec<Aircraft>) {
    let actors = vec![carrier("carrier", "enterprise-cv6", TeamId::A)];
    let mut air = Aviation::new(&actors, catalog().aircraft.clone());
    let squadron = actors[0]
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .squadrons
        .iter()
        .find(|s| s.role == role)
        .unwrap();
    assert_eq!(
        air.launch_squadron(
            &actors[0],
            &squadron.id,
            None,
            Some(AirOrder::Patrol {
                point: [0.0, 850.0, -5000.0]
            }),
            &actors,
            None,
            None
        ),
        6
    );
    let f = air.wing("carrier").unwrap().flights[0].clone();
    let mut ps: Vec<_> = air
        .planes()
        .into_iter()
        .filter(|p| f.plane_ids.contains(&p.id))
        .cloned()
        .collect();
    for (i, p) in ps.iter_mut().enumerate() {
        p.phase = "outbound".into();
        p.position = [i as f64 * 40.0, 850.0, 0.0];
        p.velocity = [0.0, 0.0, -85.0];
        p.heading = 0.0;
        p.pitch = 0.0;
        p.bank = 0.0;
        p.controls.gear = 0.0;
    }
    (f, ps)
}
/// Six CAP fighters at 850 m facing twelve hostiles: six low (90 m) and six
/// high (1500 m), all inbound.
pub(super) fn fighters() -> Vec<Aircraft> {
    let catalog = catalog();
    let carrier = Vessel::new(
        "home",
        TeamId::A,
        Arc::new(catalog.compile("enterprise-cv6").unwrap()),
    );
    let air = Aviation::new(&[carrier], catalog.aircraft.clone());
    let template = air.planes()[0].clone();
    (0..18)
        .map(|i| {
            let mut p = template.clone();
            p.id = format!("plane-{i:02}");
            p.phase = "outbound".into();
            p.hp = 100.;
            p.role = "fighter".into();
            p.ammo = 16.;
            p.flight_id = Some(if i < 6 { "cap" } else { "enemy" }.into());
            p.team = if i < 6 { TeamId::A } else { TeamId::B };
            p.position = if i < 6 {
                [i as f64 * 30., 850., -1500.]
            } else {
                [
                    (i % 6) as f64 * 35.,
                    if i < 12 { 90. } else { 1500. },
                    -4000.,
                ]
            };
            p.velocity = [0., 0., 85.];
            p
        })
        .collect()
}
/// Own carrier "own" against a hidden destroyer and carrier on team B.
pub(super) fn battle() -> Battle {
    let (catalog, compiled) = content();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships":[
            {"id":"own","presetId":"enterprise-cv6","team":"a","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"private-ship","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-5000,"heading":0}},
            {"id":"private-carrier","presetId":"enterprise-cv6","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":18000,"z":0,"heading":0}}
        ], "seed":12345,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0,
        "missionRules":catalog.missions["pve-fleet-v1"]
    })).unwrap();
    Battle::new(catalog.clone(), compiled, setup).unwrap()
}
/// Command a flight of `role` to patrol and start it airborne at `position`.
pub(super) fn launch(b: &mut Battle, owner: &str, role: &str, position: [f64; 3]) -> String {
    let actor = b.actors.iter().find(|a| a.motion.id == owner).unwrap();
    let f = b
        .aviation
        .squadron_flights(actor)
        .into_iter()
        .find(|f| {
            b.aviation
                .wing(owner)
                .unwrap()
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == role)
        })
        .unwrap();
    assert!(b.command_air(owner, &f.id, AirOrder::Patrol { point: position }));
    for (i, p) in b
        .aviation
        .wing_mut(owner)
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| f.plane_ids.contains(&p.id))
        .enumerate()
    {
        p.phase = "outbound".into();
        p.deck_slot = None;
        p.deck_position = None;
        p.position = [position[0] + i as f64 * 30.0, position[1], position[2]];
        p.previous_position = p.position;
        p.velocity = [0.0, 0.0, -85.0];
        p.heading = 0.0;
    }
    f.id
}

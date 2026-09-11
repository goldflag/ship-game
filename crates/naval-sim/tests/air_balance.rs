//! Controlled engagements use the real pilots, local visual reports, gun
//! solutions, fitted AA mounts, ammunition and damage. Start already airborne
//! so launch/recovery queues do not hide whether the interception works.
use naval_sim::{
    aircraft::AirOrder,
    anti_aircraft,
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    rules::TeamId,
    sensors::{self, Knowledge, Sensors, VisualConditions, VisualRules},
    vessel::{Controller, Vessel},
};
use std::sync::{Arc, OnceLock};

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn vessel(id: &str, preset: &str, team: TeamId, x: f64, z: f64) -> Vessel {
    let mut vessel = Vessel::new(id, team, Arc::new(catalog().compile(preset).unwrap()));
    vessel.controller = Controller::Player;
    vessel.motion.x = x;
    vessel.motion.z = z;
    vessel
}
fn launch(
    air: &mut Aviation,
    actors: &[Vessel],
    owner: &str,
    role: &str,
    position: [f64; 3],
    order: AirOrder,
) -> Vec<String> {
    let actor = actors.iter().find(|a| a.motion.id == owner).unwrap();
    let squadron = &actor
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .squadrons
        .iter()
        .find(|s| s.role == role)
        .unwrap()
        .id;
    assert_eq!(
        air.launch_squadron(actor, squadron, None, Some(order), actors, None, None),
        4
    );
    let mut ids = vec![];
    for (slot, p) in air
        .wing_mut(owner)
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.phase == "queued")
        .enumerate()
    {
        p.phase = "outbound".into();
        p.deck_slot = None;
        p.deck_position = None;
        p.deck_datum = None;
        p.position = [
            position[0] + (slot.div_ceil(2) * 27) as f64,
            position[1],
            position[2]
                + if slot == 0 {
                    0.0
                } else {
                    (slot.div_ceil(2) * 32) as f64 * if slot % 2 == 0 { 1.0 } else { -1.0 }
                },
        ];
        p.previous_position = p.position;
        p.velocity = [-85.0, 0.0, 0.0];
        p.heading = -std::f64::consts::FRAC_PI_2;
        p.pitch = 0.0;
        p.bank = 0.0;
        p.controls.gear = 0.0;
        p.flight_time = 30.0;
        ids.push(p.id.clone());
    }
    ids
}
#[derive(Debug, Default, PartialEq)]
struct Engagement {
    fighter_kills: usize,
    high_kills: usize,
    low_kills: usize,
    low_kills_before_release: usize,
    aa_kills: usize,
    fighter_shots: usize,
    aa_shots: usize,
    fighter_damage: f64,
    aa_damage: f64,
    releases: usize,
    survivors: usize,
    first_kill_seconds: Option<f64>,
}
/// Six bombers start 5 km from a carrier. When present, six fighters begin
/// 400 m behind them: CAP already in position, not a guarantee of interception
/// from any launch point. AA means the carrier plus zero/two/six Fletchers.
/// Transit bombers keep their payload and cross the fleet at 850 m.
fn engagement(scenario: &str, fighters: bool, aa: usize, seed: u32) -> Engagement {
    let c = catalog();
    let role = if matches!(scenario, "transit" | "mixed") {
        "dive-bomber"
    } else {
        scenario
    };
    let altitude = if role == "torpedo-bomber" {
        90.0
    } else {
        850.0
    };
    let mut actors = vec![
        vessel("defender", "enterprise-cv6", TeamId::A, 0.0, 0.0),
        vessel("attacker", "shokaku", TeamId::B, 14000.0, 0.0),
    ];
    for i in 1..aa {
        actors.push(vessel(
            &format!("escort-{i}"),
            "fletcher",
            TeamId::A,
            if i % 2 == 0 { -500.0 } else { 500.0 },
            (i.div_ceil(2) * 500) as f64 * if i % 2 == 0 { 1.0 } else { -1.0 },
        ));
    }
    let mut air = Aviation::with_rules(
        &actors,
        c.aircraft.clone(),
        c.air_profiles["pve-air-v1"].clone(),
    )
    .unwrap();
    // Calibrate the original six defenders; continuous relief is tested in
    // air_operations. The attacking carrier may still launch mixed groups.
    air.carrier_rules
        .get_mut("defender")
        .unwrap()
        .active_flights = Some(1);
    let mut ids = launch(
        &mut air,
        &actors,
        "attacker",
        role,
        [5000.0, altitude, 0.0],
        AirOrder::Patrol {
            point: [-6000.0, altitude, 0.0],
        },
    );
    if scenario == "mixed" {
        ids.extend(launch(
            &mut air,
            &actors,
            "attacker",
            "torpedo-bomber",
            [5000.0, 90.0, 650.0],
            AirOrder::Patrol {
                point: [-6000.0, 90.0, 0.0],
            },
        ));
    }
    if fighters {
        launch(
            &mut air,
            &actors,
            "defender",
            "fighter",
            [5400.0, altitude, 0.0],
            AirOrder::Defend { target_id: None },
        );
    }
    let mut reports = Sensors::default();
    let rules = VisualRules::default();
    let conditions = VisualConditions::resolve(c, "north-atlantic", "clear");
    // Establish normal local reports; the pilots never receive private enemies.
    for tick in (0..=360).step_by(60) {
        reports.update(
            tick,
            &sensors::entities(&actors, &air),
            &[],
            &[],
            conditions,
            &rules,
        );
    }
    if scenario != "transit" {
        let contact = reports.track(TeamId::B, "defender").unwrap().id.clone();
        for first in ids.chunks(4).map(|group| &group[0]) {
            let flight = air
                .wing("attacker")
                .unwrap()
                .flights
                .iter()
                .find(|f| f.plane_ids.contains(first))
                .unwrap()
                .id
                .clone();
            assert!(air.order_flight(
                &actors[1],
                &flight,
                AirOrder::Strike {
                    contact_id: contact.clone()
                },
                &actors
            ));
        }
    }
    let mut result = Engagement::default();
    let mut sequence = 0;
    for step in 0..180 * 60 {
        let tick = 360 + step as u64;
        reports.update(
            tick,
            &sensors::entities(&actors, &air),
            &[],
            &[],
            conditions,
            &rules,
        );
        let knowledge = Some(Knowledge {
            sensors: &reports,
            tick,
            islands: &[],
            terrain: &[],
        });
        let health = |air: &Aviation| {
            ids.iter()
                .map(|id| air.iter_planes().find(|p| p.id == *id).unwrap().hp.max(0.0))
                .collect::<Vec<_>>()
        };
        let before = health(&air);
        let mut events = vec![];
        air.step(
            &mut AirContext {
                knowledge,
                actors: &actors,
                shells: &mut vec![],
                torpedoes: &mut vec![],
                releases: &mut vec![],
                sequence: &mut sequence,
                events: &mut events,
                seed,
                sea: None,
            },
            1.0 / 60.0,
            tick as f64 / 60.0,
        );
        for (index, (before, after)) in before.into_iter().zip(health(&air)).enumerate() {
            let target = air.iter_planes().find(|p| p.id == ids[index]).unwrap();
            result.low_kills_before_release += usize::from(
                before > 0.0 && after == 0.0 && target.role == "torpedo-bomber" && target.payload,
            );
            result.fighter_damage += (before - after).max(0.0);
            result.fighter_kills += usize::from(before > 0.0 && after == 0.0);
        }
        result.fighter_shots += events.iter().filter(|e| e.kind == "aircraft-fire").count();
        let before = health(&air);
        for i in (0..actors.len()).filter(|i| aa > 0 && *i != 1) {
            for j in 0..actors[i].mounts.len() {
                let mut state = actors[i].mounts[j].clone();
                let mut events = vec![];
                anti_aircraft::update_observed(
                    &actors[i],
                    &actors[i].definition().mounts[j],
                    &mut state,
                    &actors,
                    &mut air,
                    1.0 / 60.0,
                    seed,
                    &mut sequence,
                    &mut events,
                    knowledge,
                );
                result.aa_shots += events.len();
                actors[i].mounts[j] = state;
            }
        }
        for (before, after) in before.into_iter().zip(health(&air)) {
            result.aa_damage += (before - after).max(0.0);
            result.aa_kills += usize::from(before > 0.0 && after == 0.0);
        }
        if result.first_kill_seconds.is_none() && health(&air).contains(&0.0) {
            result.first_kill_seconds = Some(step as f64 / 60.0);
        }
    }
    for id in ids {
        let p = air.iter_planes().find(|p| p.id == id).unwrap();
        result.releases += usize::from(!p.payload);
        result.survivors += usize::from(p.hp > 0.0);
        result.high_kills += usize::from(p.hp <= 0.0 && p.role == "dive-bomber");
        result.low_kills += usize::from(p.hp <= 0.0 && p.role == "torpedo-bomber");
    }
    result
}

#[test]
fn positioned_cap_intercepts_bombers_with_finite_ammunition() {
    for scenario in ["transit", "dive-bomber", "torpedo-bomber"] {
        let mut kills = 0;
        for seed in [1, 5739, 98765] {
            let result = engagement(scenario, true, 0, seed);
            eprintln!("{scenario}, seed {seed}: {result:?}");
            assert!(
                result.fighter_shots > 0 && result.fighter_shots <= 96,
                "{result:?}"
            );
            kills += result.fighter_kills;
        }
        // A useful CAP must kill more than the original one of eighteen
        // bombers, without requiring every flight to be completely wiped out.
        assert!(
            kills >= 6,
            "{scenario}: only {kills}/18 bombers intercepted"
        );
    }
}

#[test]
fn aa_retains_a_useful_layer_of_defense_against_committed_divers() {
    let mut single_damage = 0.0;
    let mut fleet_damage = 0.0;
    let mut fleet_kills = 0;
    for seed in [1, 5739, 98765] {
        let single = engagement("dive-bomber", false, 1, seed);
        let fleet = engagement("dive-bomber", false, 3, seed);
        eprintln!("seed {seed}: single={single:?}, fleet={fleet:?}");
        assert!(single.aa_shots > 0 && fleet.aa_shots > 0);
        single_damage += single.aa_damage;
        fleet_damage += fleet.aa_damage;
        fleet_kills += fleet.aa_kills;
    }
    assert!(single_damage > 100.0, "single ship AA became ineffective");
    assert!(
        fleet_damage > single_damage,
        "overlapping AA stopped helping"
    );
    assert!(
        (2..18).contains(&fleet_kills),
        "fleet AA kills {fleet_kills}/18"
    );
}

#[test]
fn fighter_cover_prevents_more_torpedo_releases_than_aa_alone() {
    let mut alone = 0;
    let mut covered = 0;
    for seed in [1, 5739, 98765] {
        let aa = engagement("torpedo-bomber", false, 3, seed);
        let combined = engagement("torpedo-bomber", true, 3, seed);
        eprintln!("seed {seed}: AA={aa:?}, combined={combined:?}");
        alone += aa.releases;
        covered += combined.releases;
    }
    assert!(
        covered + 4 <= alone,
        "CAP allowed {covered} releases; AA alone {alone}"
    );
}

#[test]
fn undefended_strikes_remain_viable_for_both_bomber_roles() {
    for role in ["dive-bomber", "torpedo-bomber"] {
        let result = engagement(role, false, 0, 5739);
        assert_eq!(result.releases, 4, "{role}: {result:?}");
        assert_eq!(result.survivors, 4, "{role}: {result:?}");
    }
}

#[test]
fn mixed_raid_cap_covers_both_altitudes_and_retains_ammunition() {
    for seed in [1, 5739, 98765] {
        let result = engagement("mixed", true, 0, seed);
        assert!(
            result.high_kills > 0 && result.low_kills > 0,
            "CAP left one altitude uncovered, seed {seed}: {result:?}"
        );
        assert!(
            result.low_kills_before_release > 0,
            "low-sector defense arrived after torpedo release, seed {seed}: {result:?}"
        );
        assert!(
            result.fighter_shots < 84,
            "CAP exhausted its next-wave reserve: {result:?}"
        );
        assert!(
            result.releases < 12,
            "CAP only engaged after every release: {result:?}"
        );
    }
}

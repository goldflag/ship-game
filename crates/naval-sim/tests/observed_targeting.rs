use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    sensors::TrackStatus,
    vessel::CompiledShip,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
type Content = (Arc<Catalog>, BTreeMap<String, Arc<CompiledShip>>);
fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = ["fletcher", "enterprise-cv6", "bismarck"]
            .into_iter()
            .map(|id| (id.to_owned(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
fn battle(distance: f64) -> Battle {
    let (catalog, compiled) = content();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"fletcher","team":"a","controller":"bot","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy-private-id","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-distance,"heading":std::f64::consts::PI}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0,
        "missionRules":catalog.missions["pve-fleet-v1"]
    })).unwrap();
    Battle::new(catalog.clone(), compiled, setup).unwrap()
}
#[test]
fn unobserved_opponents_do_not_create_targets_or_fire_solutions() {
    let mut battle = battle(16000.0);
    for _ in 0..60 {
        battle.step(&BTreeMap::new());
    }
    assert!(
        battle
            .sensors
            .contacts(naval_sim::rules::TeamId::A)
            .is_empty()
    );
    assert!(battle.actors[0].target_id.is_none());
    assert!(battle.actors[0].bot.as_ref().unwrap().track.is_none());
    assert!(battle.shells.is_empty());
}
#[test]
fn unseen_enemy_course_and_damage_cannot_change_captain_or_gun_solution() {
    let mut a = battle(2000.0);
    let mut b = battle(2000.0);
    for _ in 0..180 {
        a.step(&BTreeMap::new());
        b.step(&BTreeMap::new());
    }
    assert!(
        a.actors[0]
            .target_id
            .as_ref()
            .unwrap()
            .starts_with("contact-")
    );
    let observed = a.sensors.contacts(naval_sim::rules::TeamId::A)[0].clone();
    a.actors[1].motion.x = 20000.0;
    a.actors[1].motion.z = -15000.0;
    b.actors[1].motion.x = -20000.0;
    b.actors[1].motion.z = -15000.0;
    b.actors[1].motion.heading = 0.5;
    for mount in &mut b.actors[1].mounts {
        mount.hp = 65.0;
    }
    for _ in 0..1200 {
        a.step(&BTreeMap::new());
        b.step(&BTreeMap::new());
        let own_a = &a.actors[0];
        let own_b = &b.actors[0];
        assert_eq!(
            serde_json::to_value(own_a.helm).unwrap(),
            serde_json::to_value(own_b.helm).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&own_a.bot).unwrap(),
            serde_json::to_value(&own_b.bot).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&own_a.mounts).unwrap(),
            serde_json::to_value(&own_b.mounts).unwrap()
        );
    }
    let lost = a.sensors.contacts(naval_sim::rules::TeamId::A)[0].clone();
    assert_eq!(lost.status, TrackStatus::Lost);
    assert_eq!(lost.measured_position, observed.measured_position);
    assert!(
        a.actors[0]
            .bot
            .as_ref()
            .unwrap()
            .track
            .as_ref()
            .unwrap()
            .aim_points
            .is_none()
    );
}

#[test]
fn team_projection_omits_unobserved_fleets_private_totals_and_records() {
    use naval_sim::{rules::TeamId, snapshot::PresentationView};
    let mut a = battle(16000.0);
    a.step(&BTreeMap::new());
    let before = a
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert_eq!(before["actors"].as_array().unwrap().len(), 1);
    assert!(before["afloatKg"][1].is_null());
    assert!(before["contacts"].as_array().unwrap().is_empty());
    // Own vessels carry a live score sheet; the shell history and every other
    // team's records stay private.
    let scores = before["records"]["scores"].as_object().unwrap();
    assert!(!scores.is_empty());
    assert!(scores.keys().all(|id| {
        a.actors
            .iter()
            .any(|actor| actor.team == TeamId::A && actor.motion.id == *id)
    }));
    assert!(
        scores
            .values()
            .all(|score| score["damageLog"].as_array().unwrap().is_empty()
                && score["damageDealt"] == 0.0
                && score["frags"] == 0)
    );
    assert_eq!(before["records"]["shellHistory"], serde_json::json!([]));
    assert!(!before.to_string().contains("enemy-private-id"));
    a.actors[1].motion.x = 19000.0;
    a.actors[1].motion.heading = 0.7;
    for mount in &mut a.actors[1].mounts {
        mount.hp = 55.0;
        mount.ammo /= 2.0;
    }
    a.sequence += 180;
    let after = a
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(
        a.presentation_value(PresentationView::FullKnowledge)
            .unwrap()["actors"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn observed_enemy_is_a_report_and_silhouette_without_an_inspectable_damage_model() {
    use naval_sim::{rules::TeamId, snapshot::PresentationView};
    let mut a = battle(2000.0);
    for _ in 0..16 * naval_sim::rules::TICK_RATE {
        a.step(&BTreeMap::new());
    }
    let frame = a
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert_eq!(frame["actors"].as_array().unwrap().len(), 1);
    assert_eq!(frame["observedShips"].as_array().unwrap().len(), 1);
    assert!(!frame.to_string().contains("enemy-private-id"));
    assert!(frame["contacts"][0].get("damage").is_none());
    assert!(frame["observedShips"][0].get("mounts").is_none());
    assert!(
        frame["observedShips"][0]["health"]
            .as_f64()
            .is_some_and(|hp| (0.0..=1.0).contains(&hp))
    );
    assert!(
        frame["observedShips"][0]["id"]
            .as_str()
            .unwrap()
            .starts_with("contact-")
    );
    a.actors[1].motion.x = 19000.0;
    a.actors[1].motion.z = -15000.0;
    for _ in 0..120 {
        a.step(&BTreeMap::new());
    }
    let lost_view = a
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert!(lost_view["observedShips"].as_array().unwrap().is_empty());
    assert_eq!(lost_view["contacts"].as_array().unwrap().len(), 1);
}

#[test]
fn final_debrief_reveals_incapacity_without_adding_enemies_to_the_active_world() {
    use naval_sim::{rules::TeamId, snapshot::PresentationView};
    let mut a = battle(16000.0);
    let before = a
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert!(before.get("debrief").is_none());
    for mount in &mut a.actors[1].mounts {
        mount.hp = 0.0;
    }
    for tube in &mut a.actors[1].torpedo_tubes {
        tube.ammo = 0.0;
    }
    assert!(a.actors[1].physical_loss().is_none());
    a.step(&BTreeMap::new());
    assert_eq!(a.outcome.as_ref().unwrap().winner_team_id, Some(TeamId::A));
    let frame = a
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert_eq!(frame["actors"].as_array().unwrap().len(), 1);
    assert_eq!(frame["debrief"]["actors"].as_array().unwrap().len(), 2);
    assert_eq!(
        frame["debrief"]["shipOutcomes"]["enemy-private-id"],
        "incapacitated"
    );
    assert_eq!(frame["debrief"]["shipOutcomes"]["own"], "operational");
}

#[test]
fn visible_reports_publish_sampled_health_without_private_damage_or_changing_legacy_frames() {
    use naval_sim::{rules::TeamId, snapshot::PresentationView};
    let mut a = battle(2000.0);
    let mut b = battle(2000.0);
    for battle in [&mut a, &mut b] {
        battle.actors[1].damage.control.mounts[0].intensity = 0.8;
        battle.actors[1].motion.roll = 0.25;
    }
    a.actors[1].damage.integrity = 1.0;
    a.actors[1].mounts[0].ammo = 0.0;
    for battle in [&mut a, &mut b] {
        let entities = naval_sim::sensors::entities(&battle.actors, &battle.aviation);
        battle.sensors.update(
            0,
            &entities,
            &battle.islands,
            &battle.catalog.terrain,
            naval_sim::sensors::VisualConditions::resolve(
                &battle.catalog,
                "north-atlantic",
                "clear",
            ),
            &naval_sim::sensors::VisualRules::default(),
        );
    }
    let own = |battle: &Battle| {
        battle
            .presentation_value(PresentationView::Team(TeamId::A))
            .unwrap()
    };
    let mut damaged = own(&a);
    let mut intact = own(&b);
    assert_eq!(
        damaged["observedShips"][0]["health"],
        1.0 / a.actors[1].damage.max_integrity
    );
    assert_eq!(intact["observedShips"][0]["health"], 1.0);
    for frame in [&mut damaged, &mut intact] {
        frame["observedShips"][0]
            .as_object_mut()
            .unwrap()
            .remove("health");
    }
    assert_eq!(damaged, intact);
    let frame = own(&a);
    let condition = &frame["contacts"][0]["visibleCondition"];
    assert_eq!(condition["fire"], true);
    assert_eq!(condition["heavySmoke"], true);
    assert_eq!(condition["listing"], true);
    assert_eq!(condition["sinking"], false);
    assert_eq!(condition.as_object().unwrap().len(), 5);
    assert!(
        !frame["reconCoverage"]["cells"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let legacy = a
        .presentation_value(PresentationView::FullKnowledge)
        .unwrap();
    assert!(legacy.get("reconCoverage").is_none());
    assert!(legacy.get("contacts").is_none());
    assert!(!legacy.to_string().contains("visibleCondition"));
    a.actors[1].damage.integrity = 0.0;
    let entities = naval_sim::sensors::entities(&a.actors, &a.aviation);
    a.sensors.update(
        60,
        &entities,
        &a.islands,
        &a.catalog.terrain,
        naval_sim::sensors::VisualConditions::resolve(&a.catalog, "north-atlantic", "clear"),
        &naval_sim::sensors::VisualRules::default(),
    );
    assert_eq!(own(&a)["contacts"][0]["visibleCondition"]["sinking"], true);
    assert!(!a.sensors.contacts(TeamId::A)[0].targetable());
}

#[test]
fn a_newly_spotted_ship_has_an_exact_exterior_heading_even_when_stationary() {
    use naval_sim::{rules::TeamId, snapshot::PresentationView};
    let mut b = battle(6500.0);
    b.actors[1].motion.heading = 1.234;
    let position = [
        b.actors[1].motion.x,
        b.actors[1].motion.y,
        b.actors[1].motion.z,
    ];
    b.step(&BTreeMap::new());
    let frame = b
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    let exterior = &frame["observedShips"][0];
    assert_eq!(exterior["heading"], 1.234);
    assert_eq!(exterior["position"], serde_json::json!(position));
    assert_eq!(exterior["observers"], serde_json::json!(["own"]));
    assert_eq!(frame["contacts"][0]["identificationConfidence"], 1.0);
}

fn aircraft_loss_report(witnessed: bool) {
    use naval_sim::{
        rules::{TICK_RATE, TeamId},
        sensors::{self, VisualRules},
        snapshot::PresentationView,
    };
    let (catalog, compiled) = content();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"fletcher","team":"a","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy-carrier","presetId":"enterprise-cv6","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-16000,"heading":0}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0,
        "missionRules":catalog.missions["pve-fleet-v1"]
    })).unwrap();
    let mut battle = Battle::new(catalog.clone(), compiled, setup).unwrap();
    let plane = &mut battle.aviation.wings[0].state.planes[0];
    plane.phase = "outbound".into();
    plane.deck_position = None;
    plane.deck_slot = None;
    plane.position = [2000.0, 500.0, 0.0];
    let plane_id = plane.id.clone();
    let rules = VisualRules::default();
    let conditions = sensors::VisualConditions::resolve(catalog, "north-atlantic", "clear");
    battle.sensors.update(
        0,
        &sensors::entities(&battle.actors, &battle.aviation),
        &[],
        &[],
        conditions,
        &rules,
    );
    let contact_id = battle
        .sensors
        .track(TeamId::A, &plane_id)
        .unwrap()
        .id
        .clone();
    let plane = &mut battle.aviation.wings[0].state.planes[0];
    if !witnessed {
        plane.position = [30000.0, 500.0, 0.0];
    }
    plane.hp = 0.0;
    battle.step(&BTreeMap::new());
    assert_eq!(battle.aviation.wings[0].state.planes[0].phase, "lost");
    let frame = battle
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    let loss = frame["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "aircraft-lost");
    assert_eq!(loss.is_some(), witnessed);
    if let Some(loss) = loss {
        assert_eq!(
            loss["aircraft"]["id"], contact_id,
            "loss must retain its public identity"
        );
    }
    assert_eq!(
        frame["contacts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == contact_id),
        !witnessed
    );
    battle.sensors.update(
        300 * TICK_RATE,
        &sensors::entities(&battle.actors, &battle.aviation),
        &[],
        &[],
        conditions,
        &rules,
    );
    assert_eq!(
        battle.sensors.contact(TeamId::A, &contact_id).is_some(),
        !witnessed
    );
}

#[test]
fn witnessed_aircraft_loss_retires_its_map_contact() {
    aircraft_loss_report(true);
}

#[test]
fn unwitnessed_aircraft_loss_preserves_the_last_known_report() {
    aircraft_loss_report(false);
}

fn mixed_battle() -> Battle {
    let (catalog, compiled) = content();
    let setup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"bismarck","team":"a","controller":"bot","aiLevel":"hard","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"capital","presetId":"bismarck","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":6500,"z":0,"heading":0}},
            {"id":"screen","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":5500,"z":1500,"heading":0}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0,
        "missionRules":catalog.missions["pve-fleet-v1"]
    })).unwrap();
    Battle::new(catalog.clone(), compiled, setup).unwrap()
}

#[test]
fn batteries_choose_suitable_contacts_and_respect_focus_orders() {
    use naval_sim::{battle::Orders, rules::TeamId};
    let mut b = mixed_battle();
    b.step(&BTreeMap::new());
    let capital = b.sensors.track(TeamId::A, "capital").unwrap().id.clone();
    let screen = b.sensors.track(TeamId::A, "screen").unwrap().id.clone();
    let own = &b.actors[0];
    assert_eq!(own.target_id.as_ref(), Some(&capital));
    assert_eq!(
        own.secondary_bot
            .as_ref()
            .unwrap()
            .track
            .as_ref()
            .unwrap()
            .id,
        screen
    );
    assert!(!own.bot.as_ref().unwrap().ready(None));
    assert!(!own.secondary_bot.as_ref().unwrap().ready(None));
    let mut orders = BTreeMap::new();
    let mut order = Orders {
        target_id: Some(screen.clone()),
        ..Default::default()
    };
    orders.insert("own".into(), order.clone());
    b.step(&orders);
    assert_eq!(b.actors[0].target_id.as_ref(), Some(&screen));
    assert_eq!(
        b.actors[0]
            .secondary_bot
            .as_ref()
            .unwrap()
            .track
            .as_ref()
            .unwrap()
            .id,
        screen
    );
    order.target_id = Some(capital.clone());
    orders.insert("own".into(), order);
    b.step(&orders);
    assert_eq!(
        b.actors[0]
            .secondary_bot
            .as_ref()
            .unwrap()
            .track
            .as_ref()
            .unwrap()
            .id,
        capital
    );
}

#[test]
fn actual_gunfire_refreshes_visibility_and_silence_expires_it() {
    let mut b = mixed_battle();
    let mut fired = false;
    let mut main_fired = false;
    let mut secondary_fired = false;
    for _ in 0..30 * naval_sim::rules::TICK_RATE {
        b.step(&BTreeMap::new());
        let own = &b.actors[0];
        for (mount, state) in own.definition().mounts.iter().zip(&own.mounts) {
            if state.reload > 0.0 {
                if mount.battery == "main" { main_fired = true; }
                if mount.battery == "secondary" { secondary_fired = true; }
            }
        }
        if own.firing_visibility_seconds == 20.0 && main_fired && secondary_fired {
            fired = true;
            break;
        }
    }
    assert!(fired, "both batteries must fire real salvos at their separate contacts");
    assert!(naval_sim::sensors::entities(&b.actors, &b.aviation).iter().find(|e| e.id == "own").unwrap().firing);
    b.actors[0].bot.as_mut().unwrap().ai_level = naval_sim::bots::AiLevel::Static;
    b.actors[0].secondary_bot.as_mut().unwrap().ai_level = naval_sim::bots::AiLevel::Static;
    for _ in 0..21 * naval_sim::rules::TICK_RATE {
        b.step(&BTreeMap::new());
    }
    assert_eq!(b.actors[0].firing_visibility_seconds, 0.0);
    assert!(!naval_sim::sensors::entities(&b.actors, &b.aviation).iter().find(|e| e.id == "own").unwrap().firing);
}

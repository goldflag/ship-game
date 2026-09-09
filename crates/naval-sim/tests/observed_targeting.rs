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
        let compiled = ["fletcher", "enterprise-cv6"]
            .into_iter()
            .map(|id| {
                (
                    id.to_owned(),
                    Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap()),
                )
            })
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
    assert_eq!(
        before["records"],
        serde_json::json!({"scores":{},"shellHistory":[]})
    );
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

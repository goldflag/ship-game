use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

fn same(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (k, v) in a {
                same(v, &b[k], &format!("{path}.{k}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                same(a, b, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}

/// Portable pumping and flood connections travel only for the hull whose panel is
/// on screen; every other hull keeps its rooms in place but carries only the two
/// fields hull fire effects and the inspection view read. Compartments stay whole.
fn check_detail(actors: &[Value], detail: &[&str], path: &str) {
    assert!(!actors.is_empty(), "{path}");
    for actor in actors {
        let id = actor["motion"]["id"].as_str().unwrap();
        let kept = detail.contains(&id);
        let rooms = actor["damage"]["control"]["rooms"].as_array().unwrap();
        let pumping = actor["damage"]["control"]["pumping"].as_array().unwrap();
        let connections = actor["damage"]["connections"].as_array().unwrap();
        let compartments = actor["damage"]["compartments"].as_array().unwrap();
        assert!(!compartments.is_empty(), "{path} {id} compartments");
        assert_eq!(
            rooms.len(),
            compartments.len(),
            "{path} {id} rooms keep their compartment positions"
        );
        for room in rooms {
            let keys: Vec<_> = room
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            if kept {
                assert!(
                    keys.contains(&"fuel") && keys.contains(&"trend"),
                    "{path} {id} room detail"
                );
            } else {
                assert_eq!(keys, ["heat", "intensity"], "{path} {id} narrowed room");
            }
        }
        assert_eq!(!pumping.is_empty(), kept, "{path} {id} pumping");
        assert_eq!(!connections.is_empty(), kept, "{path} {id} connections");
        // Everything else the panel does not read stays exactly as before.
        assert!(
            actor["damage"]["control"]["mounts"].is_array(),
            "{path} {id}"
        );
        assert!(
            actor["damage"]["control"]["teams"].is_array(),
            "{path} {id}"
        );
    }
}

#[test]
fn streamed_large_battle_preserves_every_presentation_field_and_authority_state() {
    let catalog = Arc::new(
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap(),
    );
    let roster = [
        "bismarck",
        "yamato",
        "king-george-v",
        "baltimore",
        "fletcher",
        "flower-corvette",
        "bismarck",
        "yamato",
        "king-george-v",
        "baltimore",
        "fletcher",
        "baltimore",
        "fletcher",
        "enterprise-cv6",
        "shokaku",
    ];
    let mut compiled = BTreeMap::new();
    for id in roster {
        compiled
            .entry(id.into())
            .or_insert_with(|| Arc::new(catalog.compile(id).unwrap()));
    }
    let ships: Vec<_> = ["a", "b"].into_iter().flat_map(|team| roster.iter().enumerate().map(move |(i, id)| json!({
        "id":format!("{team}-{i}"),"presetId":id,"team":team,"controller":if team == "a" && i == 0 {"player"} else {"bot"},
        "aiLevel":"normal","spawn":null,
    }))).collect();
    let setup: BattleSetup = serde_json::from_value(
        json!({"ships":ships,"seed":0x6e617661_u32,"mapId":"north-atlantic",
        "weather":"map","spawnDistance":5000,"windSpeed":9}),
    )
    .unwrap();
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap();
    for tick in [0, 30, 120, 600] {
        while battle.tick < tick {
            battle.step(&BTreeMap::new());
        }
        let before = serde_json::to_string(&battle.snapshot()).unwrap();
        let expected: Value = serde_json::from_str(
            &serde_json::to_string(
                &battle
                    .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
                    .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
        let actual: Value =
            serde_json::from_str(&serde_json::to_string(&battle.presentation_snapshot()).unwrap())
                .unwrap();
        same(&actual, &expected, &format!("tick {tick}"));
        // The narrowed projections must also agree, field for field, and must
        // keep the detail hulls' damage-control state and drop everyone else's.
        let detail = ["a-0".to_string(), "b-0".to_string()];
        let expected: Value = serde_json::from_str(
            &serde_json::to_string(
                &battle
                    .detailed_presentation_value(
                        naval_sim::snapshot::PresentationView::FullKnowledge,
                        &detail,
                    )
                    .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
        let actual: Value = serde_json::from_str(
            &serde_json::to_string(&battle.detailed_presentation_snapshot(&detail)).unwrap(),
        )
        .unwrap();
        same(&actual, &expected, &format!("narrowed tick {tick}"));
        check_detail(
            actual["actors"].as_array().unwrap(),
            &["a-0", "b-0"],
            &format!("tick {tick}"),
        );
        assert_eq!(
            serde_json::to_string(&battle.snapshot()).unwrap(),
            before,
            "presentation must be read-only"
        );
    }
}

#[test]
fn streamed_team_hulls_preserve_visibility_targets_damage_and_debrief() {
    use naval_sim::{
        pve::{PvePlan, PveRequest},
        rules::TeamId,
        snapshot::PresentationView,
    };
    let catalog = Arc::new(
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap(),
    );
    let request: PveRequest = serde_json::from_value(json!({
        "version":1,"seed":17001,"mapId":"pacific-islands","weather":"clear","difficulty":"normal",
        "ships":[{"id":"own","presetId":"bismarck","groupId":"g"},
            {"id":"carrier","presetId":"enterprise-cv6","groupId":"g"},
            {"id":"escort","presetId":"fletcher","groupId":"g"}],
        "groups":[{"id":"g","name":"Fleet","station":"front"}]
    }))
    .unwrap();
    let plan = PvePlan::generate(&catalog, request).unwrap();
    let setup = plan.restart_setup();
    let compiled = setup
        .ships
        .iter()
        .map(|s| {
            (
                s.preset_id.clone(),
                Arc::new(catalog.compile(&s.preset_id).unwrap()),
            )
        })
        .collect();
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap();
    for tick in [0, 30, 600, 601] {
        while battle.tick < tick {
            battle.step(&BTreeMap::new());
        }
        if tick == 601 {
            battle.outcome = Some(serde_json::from_value(json!({"winnerTeamId":"a","reason":"destruction","finalTick":tick,"afloatKg":[1000,0]})).unwrap());
        }
        // Exercise both a resolvable friendly target and an unavailable ID.
        battle.actors[0].target_id = Some(if tick == 30 {
            "unavailable".into()
        } else {
            battle.actors[1].motion.id.clone()
        });
        for team in [TeamId::A, TeamId::B] {
            let before = serde_json::to_string(&battle.snapshot()).unwrap();
            let expected: Value = serde_json::from_str(
                &serde_json::to_string(
                    &battle
                        .presentation_value(PresentationView::Team(team))
                        .unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
            let actual: Value = serde_json::from_str(
                &serde_json::to_string(&battle.team_presentation_snapshot(team)).unwrap(),
            )
            .unwrap();
            same(&actual, &expected, &format!("team {team:?}, tick {tick}"));
            let detail = [battle.actors[0].motion.id.clone()];
            let expected: Value = serde_json::from_str(
                &serde_json::to_string(
                    &battle
                        .detailed_presentation_value(PresentationView::Team(team), &detail)
                        .unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
            let actual: Value = serde_json::from_str(
                &serde_json::to_string(&battle.detailed_team_presentation_snapshot(team, &detail))
                    .unwrap(),
            )
            .unwrap();
            same(
                &actual,
                &expected,
                &format!("narrowed team {team:?}, tick {tick}"),
            );
            check_detail(
                actual["actors"].as_array().unwrap(),
                &[&detail[0]],
                &format!("team {team:?}, tick {tick}"),
            );
            assert_eq!(before, serde_json::to_string(&battle.snapshot()).unwrap());
            assert!(
                actual["actors"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|a| a["team"] == serde_json::to_value(team).unwrap())
            );
        }
    }
}

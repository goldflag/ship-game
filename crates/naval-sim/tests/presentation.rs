use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    vessel::CompiledShip,
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
        compiled.entry(id.into()).or_insert_with(|| {
            Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap())
        });
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
                Arc::new(CompiledShip::new(catalog.definitions[&s.preset_id].clone()).unwrap()),
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

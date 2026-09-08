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
            &serde_json::to_string(&battle.presentation_value().unwrap()).unwrap(),
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

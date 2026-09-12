//! Current native carrier trajectories for the WASM parity check. Generated at
//! check time; the frozen TypeScript migration fixtures remain unchanged.
use naval_sim::{battle::Battle, catalog::Catalog, vessel::CompiledShip};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path, sync::Arc};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let catalog = Arc::new(Catalog::load(&std::fs::read(
        root.join(".build/naval-content/manifest.json"),
    )?)?);
    let compiled: BTreeMap<_, _> = catalog
        .definitions
        .iter()
        .map(|(id, d)| {
            Ok((
                id.clone(),
                Arc::new(CompiledShip::new(d.clone(), catalog.hydrostatics.get(id))?),
            ))
        })
        .collect::<Result<_, String>>()?;
    let fixture: Value = serde_json::from_slice(&std::fs::read(
        root.join("assets/gameplay/migration/battles.v1.json"),
    )?)?;
    let mut results = BTreeMap::new();
    for case in fixture["cases"].as_array().unwrap() {
        if !case["baseline"]["wings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["ownerId"] == "player")
        {
            continue;
        }
        let mut battle = Battle::new(
            catalog.clone(),
            &compiled,
            serde_json::from_value(case["setup"].clone())?,
        )?;
        let initial = serde_json::to_value(battle.snapshot())?;
        let wing = initial["wings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["ownerId"] == "player")
            .unwrap();
        let mut seen = std::collections::BTreeSet::new();
        let squadrons = wing["state"]["planes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["squadronId"].as_str().unwrap(),
                    p["role"].as_str().unwrap(),
                )
            })
            .filter(|(id, _)| seen.insert(*id));
        for (squadron, role) in squadrons {
            let order = if role == "fighter" {
                json!({"kind":"defend"})
            } else {
                json!({"kind":"attack","targetId":"enemy-1"})
            };
            assert!(battle.command_air(
                "player",
                &format!("player/{squadron}/squadron-1"),
                serde_json::from_value(order)?
            ));
        }
        let mut checkpoints = BTreeMap::new();
        for tick in 1..=case["duration"].as_u64().unwrap() * 60 {
            let battery = case["battery"].as_str().unwrap();
            let orders = json!({"player":{
                "helm":{"throttle":0.6,"rudder":if tick < 900 {0.4} else {0.0}},
                "guns":{"battery":battery,"aim":case["aims"][(tick-1) as usize],"fire":true,
                    "ammunition":{(battery):if tick < 1200 {"ap"} else {"he"}}},
                "movement":{"type":"autonomous"}
            }});
            battle.step(&serde_json::from_value(orders)?);
            if case["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["tick"] == tick)
            {
                checkpoints.insert(tick, serde_json::to_value(battle.snapshot())?);
            }
        }
        results.insert(case["id"].as_str().unwrap(), checkpoints);
    }
    serde_json::to_writer(std::io::stdout().lock(), &results)?;
    Ok(())
}

//! Hand-authored scenarios: the fixed order of battle is legal on its chart, the
//! briefing keeps the raid hidden, the deployment cannot be moved, the seed fixes
//! the raid, and victory points decide the result however the battle ends.
use naval_sim::{
    battle::Battle,
    bots::AiLevel,
    catalog::Catalog,
    pve::{Placement, PvePlan},
    rules::{FinishReason, TeamId},
    scenario::ScenarioRequest,
};
use std::{collections::BTreeMap, sync::Arc};

fn request(seed: u32, difficulty: AiLevel) -> ScenarioRequest {
    ScenarioRequest {
        version: 1,
        scenario_id: "savo-island".into(),
        seed,
        difficulty,
    }
}
fn authored(plan: &PvePlan, catalog: &Catalog) -> Vec<Placement> {
    plan.briefing(catalog)
        .setup
        .ships
        .iter()
        .map(|ship| Placement {
            id: ship.id.clone(),
            spawn: ship.spawn.clone().unwrap(),
        })
        .collect()
}
fn battle(catalog: &Arc<Catalog>, plan: &mut PvePlan) -> Battle {
    let setup = plan.deploy(catalog, authored(plan, catalog)).unwrap();
    let mut compiled = BTreeMap::new();
    for ship in &setup.ships {
        compiled
            .entry(ship.preset_id.clone())
            .or_insert_with(|| Arc::new(catalog.compile(&ship.preset_id).unwrap()));
    }
    Battle::new(catalog.clone(), &compiled, setup).unwrap()
}

#[test]
fn every_difficulty_sails_a_legal_night_action_and_briefs_only_the_owners_side() {
    let catalog = Catalog::installed();
    for difficulty in [AiLevel::Easy, AiLevel::Normal, AiLevel::Hard] {
        for seed in 1..=4 {
            let mut plan = PvePlan::scenario(&catalog, request(seed, difficulty)).unwrap();
            let briefing = plan.briefing(&catalog);
            let scenario = briefing.scenario.as_ref().unwrap();
            assert_eq!(scenario.time_of_day, "night");
            assert!(["overcast", "partly-cloudy"].contains(&scenario.weather.as_str()));
            assert_eq!(scenario.protected_ship_ids.len(), 4);
            assert_eq!(briefing.setup.ships.len(), 15);
            assert!(briefing.setup.ships.iter().all(|s| s.team == TeamId::A));
            let text = serde_json::to_string(&briefing).unwrap();
            for hidden in ["chokai", "takao", "mogami", "south-sweep", "north-strike"] {
                assert!(!text.contains(hidden), "the briefing names {hidden}");
            }
            // Battle::new checks every spawn against land, the area and the other ships.
            let battle = battle(&catalog, &mut plan);
            assert_eq!(battle.map_id, "iron-bottom-sound");
            assert!(battle.actors.iter().any(|a| a.team == TeamId::B));
        }
    }
}

#[test]
fn a_scenarios_ships_start_where_history_put_them() {
    let catalog = Catalog::installed();
    let mut plan = PvePlan::scenario(&catalog, request(7, AiLevel::Normal)).unwrap();
    let mut moved = authored(&plan, &catalog);
    moved[0].spawn.x += 500.0;
    assert!(plan.deploy(&catalog, moved).is_err());
    assert!(plan.deploy(&catalog, authored(&plan, &catalog)).is_ok());
}

#[test]
fn the_seed_fixes_the_raid_and_different_nights_bring_different_plans() {
    let catalog = Catalog::installed();
    let setup = |seed| {
        serde_json::to_value(
            PvePlan::scenario(&catalog, request(seed, AiLevel::Normal))
                .unwrap()
                .restart_setup(),
        )
        .unwrap()
    };
    assert_eq!(setup(11), setup(11));
    let mut plans = std::collections::BTreeSet::new();
    for seed in 1..=64 {
        let mut plan = PvePlan::scenario(&catalog, request(seed, AiLevel::Normal)).unwrap();
        let battle = battle(&catalog, &mut plan);
        plans.insert(
            plan.debrief(&battle)["scenario"]["plan"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    assert_eq!(plans.len(), 4, "{plans:?}");
}

#[test]
fn victory_points_decide_the_result_at_dawn_and_on_withdrawal() {
    let catalog = Catalog::installed();
    let mut plan = PvePlan::scenario(&catalog, request(3, AiLevel::Normal)).unwrap();
    let mut battle = battle(&catalog, &mut plan);
    let rules = battle.mission_rules.clone().unwrap();
    let deadline = rules.duration_seconds.unwrap() * naval_sim::rules::TICK_RATE;
    let evaluate = |battle: &Battle, tick: u64| {
        naval_sim::mission::evaluate(
            tick,
            &battle.actors,
            &battle.aviation,
            &rules,
            [1, 1],
            &battle.withdrawn,
        )
    };
    assert!(evaluate(&battle, 1).is_none());
    let transport = battle
        .actors
        .iter()
        .position(|a| a.motion.id == "barnett")
        .unwrap();
    battle.actors[transport].damage.sunk = true;
    // At dawn the whole raid is still in the sound: caught, it outscores one transport.
    let dawn = evaluate(&battle, deadline).unwrap();
    assert_eq!(dawn.reason, FinishReason::TimeLimit);
    assert_eq!(dawn.winner_team_id, Some(TeamId::A));
    let score = naval_sim::mission::score(
        &battle.actors,
        &battle.withdrawn,
        rules.objective.as_ref().unwrap(),
        true,
    );
    assert_eq!(score.points[1], 12);
    assert!(score.points[0] > 12);
    // Had it slipped away first, the transport would have been theirs for nothing.
    let raiders: Vec<_> = battle
        .actors
        .iter()
        .filter(|a| a.team == TeamId::B)
        .map(|a| a.motion.id.clone())
        .collect();
    battle.withdrawn.extend(raiders);
    let gone = evaluate(&battle, 1).unwrap();
    assert_eq!(gone.reason, FinishReason::Withdrawal);
    assert_eq!(gone.winner_team_id, Some(TeamId::B));
}

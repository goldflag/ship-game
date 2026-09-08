use naval_sim::rules::*;
use std::collections::BTreeMap;
fn ships() -> Vec<Survivor> {
    vec![
        Survivor {
            team: TeamId::A,
            displacement_kg: 100,
            physical_loss: None,
        },
        Survivor {
            team: TeamId::B,
            displacement_kg: 100,
            physical_loss: None,
        },
    ]
}
#[test]
fn exact_deadline_and_simultaneous_losses() {
    let r = Rules::default();
    let mut s = ships();
    assert!(evaluate_outcome(107999, &s, &r).is_none());
    let draw = evaluate_outcome(108000, &s, &r).unwrap();
    assert_eq!(draw.reason, FinishReason::TimeLimit);
    assert_eq!(draw.winner_team_id, None);
    s[1].physical_loss = Some(PhysicalLoss::Flooding);
    assert_eq!(
        evaluate_outcome(108000, &s, &r).unwrap().winner_team_id,
        Some(TeamId::A)
    );
    s[0].physical_loss = Some(PhysicalLoss::Capsize);
    let draw = evaluate_outcome(30, &s, &r).unwrap();
    assert_eq!(draw.winner_team_id, None);
    assert_eq!(draw.reason, FinishReason::Destruction);
}
#[test]
fn budget_boundaries_use_frozen_catalog_kg() {
    let r = Rules::default();
    let mut c = BTreeMap::new();
    for (id, kg, carrier) in [
        ("heavy", 100_000_000, false),
        ("carrier", 1, true),
        ("small", 1, false),
    ] {
        c.insert(
            id.into(),
            FleetEntry {
                ship_id: id.into(),
                displacement_kg: kg,
                carrier,
            },
        );
    }
    assert!(validate_fleet(&["heavy".into(), "heavy".into()], &c, &r).is_ok());
    assert!(matches!(
        validate_fleet(&["heavy".into(), "heavy".into(), "small".into()], &c, &r),
        Err(RuleError::OverBudget(_))
    ));
    assert!(validate_fleet(&vec!["small".into(); 8], &c, &r).is_ok());
    assert!(matches!(
        validate_fleet(&vec!["small".into(); 9], &c, &r),
        Err(RuleError::TooManyVessels(8))
    ));
    assert!(validate_fleet(&vec!["carrier".into(); 2], &c, &r).is_ok());
    assert!(matches!(
        validate_fleet(&vec!["carrier".into(); 3], &c, &r),
        Err(RuleError::TooManyCarriers(2))
    ));
    assert!(validate_fleet(&[], &c, &r).is_err());
    assert!(validate_fleet(&["unknown".into()], &c, &r).is_err());
    assert_eq!(match_displacement_kg(123.5), Some(124));
    assert_eq!(match_displacement_kg(f64::NAN), None);
}
#[test]
fn night_is_rare_and_sentinel_never_selected() {
    let r = Rules::default();
    let mut night = 0;
    for seed in 0..10000 {
        let e = select_environment(seed, &["ocean".into()], &["map".into(), "clear".into()], &r)
            .unwrap();
        assert_eq!(e.weather, "clear");
        night += usize::from(e.time_of_day == "night");
    }
    assert!((850..1150).contains(&night), "night count {night}");
}

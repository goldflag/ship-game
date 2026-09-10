use naval_sim::{
    aircraft::Aircraft,
    aircraft_tactics::fighter_target,
    aviation::Aviation,
    catalog::Catalog,
    rules::TeamId,
    vessel::{CompiledShip, Vessel},
};
use std::sync::{Arc, OnceLock};
fn fixture() -> Vec<Aircraft> {
    static C: OnceLock<Catalog> = OnceLock::new();
    let catalog = C.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    });
    let carrier = Vessel::new(
        "home",
        TeamId::A,
        Arc::new(CompiledShip::new(catalog.definitions["enterprise-cv6"].clone()).unwrap()),
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
#[test]
fn a_six_plane_cap_splits_between_high_and_low_inbound_tracks() {
    let all = fixture();
    let refs: Vec<_> = all.iter().collect();
    let assignments: Vec<_> = all[..6]
        .iter()
        .map(|p| {
            let mut p = p.clone();
            fighter_target(&mut p, &refs, [0.; 3], 1., None).unwrap()
        })
        .collect();
    assert!(
        assignments.iter().any(|i| *i < 12),
        "low approach uncovered: {assignments:?}"
    );
    assert!(
        assignments.iter().any(|i| *i >= 12),
        "high approach uncovered: {assignments:?}"
    );
    assert_eq!(
        assignments
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        6,
        "fighters pile onto the same target: {assignments:?}"
    );
}

#[test]
fn panic_does_not_spend_ammunition_on_a_distant_unsettled_solution() {
    use naval_sim::{
        air_gunnery::FireDiscipline,
        aircraft_tactics::{FighterAim, fighter_fire_ready},
    };
    let mut p = fixture().remove(0);
    p.pilot.fire_discipline = Some(FireDiscipline {
        panic: true,
        ..Default::default()
    });
    let gun = FighterAim {
        time: 0.7,
        alignment: 0.97,
        direction: [0., 0., -1.],
        distance: 500.,
        point: [0., 850., -2000.],
    };
    for _ in 0..120 {
        assert!(!fighter_fire_ready(&mut p, &gun, true, true, 1. / 60.));
    }
}

fn assignments(all: &[Aircraft]) -> Vec<String> {
    let refs: Vec<_> = all.iter().collect();
    all.iter()
        .filter(|p| p.team == TeamId::A)
        .map(|p| {
            let mut p = p.clone();
            let i = fighter_target(&mut p, &refs, [0.; 3], 1., None).unwrap();
            refs[i].id.clone()
        })
        .collect()
}
#[test]
fn allocation_is_order_independent_and_ignores_hidden_enemy_state() {
    let all = fixture();
    let expected = assignments(&all);
    let mut changed = all.clone();
    for p in &mut changed[6..] {
        p.hp = 1.;
        p.payload = !p.payload;
        p.role = "torpedo-bomber".into();
        p.flight_id = Some(p.id.clone());
    }
    assert_eq!(expected, assignments(&changed));
    changed[6..].reverse();
    assert_eq!(expected, assignments(&changed));
}
#[test]
fn six_fighters_allocate_without_duplicates_against_six_twelve_and_eighteen_tracks() {
    for count in [6, 12, 18] {
        let mut all = fixture();
        if count == 6 {
            all.truncate(12);
        } else if count == 18 {
            for i in 18..24 {
                let mut p = all[6 + i % 6].clone();
                p.id = format!("plane-{i:02}");
                p.position[0] += 200.;
                all.push(p);
            }
        }
        assert_eq!(
            assignments(&all)
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            6
        );
    }
}
#[test]
fn defenders_release_departing_tracks_but_explicit_intercepts_continue() {
    let mut all = fixture();
    all.truncate(7);
    all[6].velocity = [0., 0., -85.];
    let mut p = all[0].clone();
    p.pilot.hostile_id = Some(all[6].id.clone());
    p.pilot.think = 1.;
    let refs: Vec<_> = all.iter().collect();
    assert!(fighter_target(&mut p, &refs, [0.; 3], 1. / 60., None).is_none());
    assert!(fighter_target(&mut p, &refs, [0.; 3], 1. / 60., Some("enemy")).is_some());
}
#[test]
fn settled_close_fire_requires_reacquisition_and_a_clear_lane() {
    use naval_sim::aircraft_tactics::{FighterAim, fighter_fire_ready};
    let mut p = fixture().remove(0);
    p.bank = 0.;
    let gun = FighterAim {
        time: 0.3,
        alignment: 1.,
        direction: [0., 0., -1.],
        distance: 200.,
        point: [0., 850., -1700.],
    };
    assert!(!fighter_fire_ready(&mut p, &gun, true, true, 0.15));
    assert!(fighter_fire_ready(&mut p, &gun, true, true, 0.16));
    assert!(!fighter_fire_ready(&mut p, &gun, true, false, 0.1));
    assert!(!fighter_fire_ready(&mut p, &gun, true, true, 0.15));
    p.cooldown = 0.8;
    assert!(!fighter_fire_ready(&mut p, &gun, true, true, 1.));
    p.cooldown = 0.;
    assert!(!fighter_fire_ready(&mut p, &gun, true, true, 0.15));
}

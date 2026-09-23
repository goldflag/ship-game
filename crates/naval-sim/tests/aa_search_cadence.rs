//! Empty air searches obey the same bounded cadence as held tracks. A target
//! disappearing from a held track still triggers an immediate replacement.
use naval_sim::{
    anti_aircraft::{self, AA_SELECT_TICKS},
    aviation::Aviation,
    catalog::Catalog,
    rules::TeamId,
    vessel::{Controller, Fleet, Vessel},
    weapons::MountState,
};
use std::sync::Arc;

#[test]
fn no_target_search_waits_then_acquires_and_replaces_a_lost_track() {
    let catalog = Catalog::load(&naval_sim::catalog::installed_manifest()).unwrap();
    let mut ship = Vessel::new(
        "own",
        TeamId::A,
        Arc::new(catalog.compile("fletcher").unwrap()),
    );
    ship.controller = Controller::Player;
    let carrier = Vessel::new(
        "carrier",
        TeamId::B,
        Arc::new(catalog.compile("enterprise-cv6").unwrap()),
    );
    let mut air = Aviation::new(&[carrier], catalog.aircraft.clone());
    let index = ship
        .definition()
        .mounts
        .iter()
        .position(|m| anti_aircraft::range(m) >= 3000.)
        .unwrap();
    let mount = &ship.definition().mounts[index];
    let mut state = MountState::new(mount);
    let update = |state: &mut MountState, air: &mut Aviation| {
        anti_aircraft::update_observed_at(
            index,
            &ship,
            mount,
            state,
            Fleet::all(&[]),
            air,
            1. / 60.,
            17001,
            &mut 0,
            &mut vec![],
            None,
            &[],
        )
    };
    update(&mut state, &mut air);
    assert!(state.aa_track.is_none());
    let held = state.aa_select.unwrap();
    assert!((1..=AA_SELECT_TICKS).contains(&held));
    update(&mut state, &mut air);
    assert_eq!(
        state.aa_select,
        Some(held - 1),
        "an empty search must count down rather than rescan and reset"
    );

    let mut ids = Vec::new();
    for (i, plane) in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .take(2)
        .enumerate()
    {
        plane.phase = "outbound".into();
        plane.deck_slot = None;
        plane.deck_position = None;
        plane.deck_datum = None;
        plane.position = [0., 500., -1000. - i as f64 * 100.];
        plane.velocity = [0.; 3];
        plane.hp = 100.;
        ids.push(plane.id.clone());
    }
    assert_eq!(ids.len(), 2);
    for _ in 0..held - 1 {
        update(&mut state, &mut air);
        assert!(state.aa_track.is_none());
    }
    update(&mut state, &mut air);
    assert_eq!(state.aa_track.as_deref(), Some(ids[0].as_str()));
    assert!(state.aa_select.unwrap() > 0);
    air.plane_mut(&ids[0]).unwrap().hp = 0.;
    update(&mut state, &mut air);
    assert_eq!(
        state.aa_track.as_deref(),
        Some(ids[1].as_str()),
        "lost tracks must be replaced immediately"
    );
}

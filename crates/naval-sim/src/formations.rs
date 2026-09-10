//! The one station table both fleets sail from. The deployment chart, the
//! player's escort orders and the opposing admiral's task groups all read the
//! same offsets, so what a group looks like on the chart is the shape it keeps
//! at sea. Kept in lockstep with `src/ui/formationStations.ts`; the numbers and
//! the cell order in both files are pinned by tests on each side.
use crate::{definition::ShipDefinition, navigation::Formation};

/// What a hull is worth to a formation: where it belongs relative to the guide,
/// and how much room the guide leaves when it is the guide. This is the same
/// capability reading as the TypeScript `shipClassOf` and `pve::role`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum StationClass {
    Heavy,
    Cruiser,
    Auxiliary,
    Destroyer,
    Submarine,
}
impl StationClass {
    pub fn of(def: &ShipDefinition) -> Self {
        if def.submarine.is_some() {
            return Self::Submarine;
        }
        if def.air_wing.is_some() {
            return Self::Heavy;
        }
        let gun = def
            .mounts
            .iter()
            .filter(|m| crate::anti_aircraft::surface_allowed(def, m))
            .map(|m| m.weapon.caliber_m)
            .fold(0.0_f64, f64::max);
        if gun >= 0.28 {
            Self::Heavy
        } else if gun >= 0.15 {
            Self::Cruiser
        } else if def.hull.mass_kg >= 5_000_000.0 {
            // Light guns on a big hull is a tender or a transport; on a small
            // hull, a destroyer or corvette.
            Self::Auxiliary
        } else {
            Self::Destroyer
        }
    }
    /// Destroyers and submarines take the outer ring of a screen.
    fn screens(self) -> bool {
        matches!(self, Self::Destroyer | Self::Submarine)
    }
}

/// Interval `d` between ships in the column and line formations, measured from
/// the guide's hull. Close order: a battle line keeps 450 m, escorts 360 m, so a
/// group reads as one body and the guide's screen stays inside gun and lookout
/// range. Every value stays above [`MIN_STATION_OFFSET_M`].
pub fn role_interval(guide: StationClass) -> f64 {
    match guide {
        StationClass::Heavy => 450.0,
        StationClass::Auxiliary => 400.0,
        _ => 360.0,
    }
}
/// Ring radii of the screen: cruisers and heavies inside, destroyers outside.
pub const SCREEN_INNER_RADIUS_M: f64 = 700.0;
pub const SCREEN_OUTER_RADIUS_M: f64 = 1300.0;
/// The protocol rejects an escort station closer than this or beyond 5000 m, so
/// no offset the table produces may fall under it.
pub const MIN_STATION_OFFSET_M: f64 = 350.0;

/// One follower's berth in the sim's `[starboard, aft]` ship-local frame.
/// `slot` orders guide succession: slot 0 takes the guide if the guide is lost.
#[derive(Clone, Debug, PartialEq)]
pub struct Station {
    pub id: String,
    pub offset: [f64; 2],
    pub slot: u32,
}

/// Bearing of the `k`th of `count` stations on a ring: the first is dead ahead
/// and the rest alternate to starboard and port, so the bow is covered first.
fn ring_bearing(k: usize, count: usize) -> f64 {
    if k == 0 || count == 0 {
        return 0.0;
    }
    let step = std::f64::consts::TAU / count as f64;
    let n = k.div_ceil(2) as f64;
    if k % 2 == 1 { n * step } else { -n * step }
}
fn on_ring(radius: f64, bearing: f64) -> [f64; 2] {
    let (sin, cos) = bearing.sin_cos();
    [(radius * sin).round(), (-radius * cos).round()]
}
/// Two columns `d` apart with the guide at the head of the port column (x = 0);
/// the starboard column is at x = +d. The first follower takes the berth abeam
/// of the guide, then each rank astern fills port before starboard.
fn double_column_cell(i: usize, d: f64) -> [f64; 2] {
    if i == 0 {
        return [d, 0.0];
    }
    let j = i - 1;
    [
        if j % 2 == 1 { d } else { 0.0 },
        d * (j / 2 + 1) as f64,
    ]
}
/// Three columns at x = −d, 0, +d with the guide at the head of the centre
/// column. The first rank fills the wings abeam of the guide, then each rank
/// astern fills centre, port, starboard.
fn triple_column_cell(i: usize, d: f64) -> [f64; 2] {
    if i < 2 {
        return [if i == 0 { -d } else { d }, 0.0];
    }
    let j = i - 2;
    [
        match j % 3 {
            0 => 0.0,
            1 => -d,
            _ => d,
        },
        d * (j / 3 + 1) as f64,
    ]
}

/// Heavies nearest the guide, cruisers next, destroyers and boats outermost.
/// Ties keep the caller's order, so a group the owner arranged stays arranged.
fn role_order(followers: &[(String, StationClass)], guide: &str) -> Vec<(String, StationClass)> {
    let mut ordered: Vec<_> = followers.iter().filter(|f| f.0 != guide).cloned().collect();
    ordered.sort_by_key(|f| f.1);
    ordered
}

/// Escort stations for one guide and its followers. The guide itself is never
/// given a station; it is excluded from `followers` if it appears there.
pub fn formation_stations(
    formation: Formation,
    guide: (&str, StationClass),
    followers: &[(String, StationClass)],
) -> Vec<Station> {
    let ordered = role_order(followers, guide.0);
    let d = role_interval(guide.1);
    let cell = |i: usize| -> [f64; 2] {
        match formation {
            Formation::Column => [0.0, d * (i + 1) as f64],
            Formation::LineAbreast => [
                if i % 2 == 1 { -1.0 } else { 1.0 } * d * (i + 1).div_ceil(2) as f64,
                0.0,
            ],
            Formation::DoubleColumn => double_column_cell(i, d),
            Formation::TripleColumn => triple_column_cell(i, d),
            Formation::Screen => [0.0, 0.0],
        }
    };
    if formation != Formation::Screen {
        return ordered
            .into_iter()
            .enumerate()
            .map(|(i, ship)| Station {
                id: ship.0,
                offset: cell(i),
                slot: i as u32,
            })
            .collect();
    }
    // Destroyers and boats take the outer ring, everything else the inner ring,
    // and the inner ring takes the lower slots. A lone ring still starts dead
    // ahead, so the guide is never the first ship to meet a threat.
    let (outer, inner): (Vec<_>, Vec<_>) = ordered.into_iter().partition(|f| f.1.screens());
    let mut stations = Vec::with_capacity(inner.len() + outer.len());
    for (radius, ring) in [
        (SCREEN_INNER_RADIUS_M, inner),
        (SCREEN_OUTER_RADIUS_M, outer),
    ] {
        let count = ring.len();
        for (i, ship) in ring.into_iter().enumerate() {
            stations.push(Station {
                id: ship.0,
                offset: on_ring(radius, ring_bearing(i, count)),
                slot: stations.len() as u32,
            });
        }
    }
    stations
}

#[cfg(test)]
mod tests {
    use super::*;
    const FORMATIONS: [Formation; 5] = [
        Formation::Column,
        Formation::DoubleColumn,
        Formation::TripleColumn,
        Formation::Screen,
        Formation::LineAbreast,
    ];
    const CLASSES: [StationClass; 5] = [
        StationClass::Heavy,
        StationClass::Cruiser,
        StationClass::Auxiliary,
        StationClass::Destroyer,
        StationClass::Submarine,
    ];
    fn ships(classes: &[StationClass]) -> Vec<(String, StationClass)> {
        classes
            .iter()
            .enumerate()
            .map(|(i, class)| (format!("f{i}"), *class))
            .collect()
    }
    fn offsets(formation: Formation, guide: StationClass, classes: &[StationClass]) -> Vec<[f64; 2]> {
        formation_stations(formation, ("guide", guide), &ships(classes))
            .into_iter()
            .map(|s| s.offset)
            .collect()
    }

    #[test]
    fn a_column_falls_in_astern_at_the_guide_class_interval() {
        assert_eq!(
            offsets(
                Formation::Column,
                StationClass::Heavy,
                &[StationClass::Cruiser, StationClass::Destroyer]
            ),
            [[0.0, 450.0], [0.0, 900.0]]
        );
        assert_eq!(
            offsets(
                Formation::Column,
                StationClass::Destroyer,
                &[StationClass::Destroyer]
            ),
            [[0.0, 360.0]]
        );
        assert_eq!(
            offsets(
                Formation::Column,
                StationClass::Auxiliary,
                &[StationClass::Destroyer]
            ),
            [[0.0, 400.0]]
        );
    }
    #[test]
    fn columns_abeam_fill_across_then_astern() {
        assert_eq!(
            offsets(
                Formation::DoubleColumn,
                StationClass::Destroyer,
                &[StationClass::Destroyer; 3]
            ),
            [[360.0, 0.0], [0.0, 360.0], [360.0, 360.0]]
        );
        assert_eq!(
            offsets(
                Formation::DoubleColumn,
                StationClass::Destroyer,
                &[StationClass::Destroyer; 5]
            ),
            [
                [360.0, 0.0],
                [0.0, 360.0],
                [360.0, 360.0],
                [0.0, 720.0],
                [360.0, 720.0]
            ]
        );
        assert_eq!(
            offsets(
                Formation::TripleColumn,
                StationClass::Destroyer,
                &[StationClass::Destroyer; 3]
            ),
            [[-360.0, 0.0], [360.0, 0.0], [0.0, 360.0]]
        );
        assert_eq!(
            offsets(
                Formation::TripleColumn,
                StationClass::Heavy,
                &[StationClass::Destroyer; 6]
            ),
            [
                [-450.0, 0.0],
                [450.0, 0.0],
                [0.0, 450.0],
                [-450.0, 450.0],
                [450.0, 450.0],
                [0.0, 900.0]
            ]
        );
    }
    #[test]
    fn a_line_alternates_to_starboard_then_port() {
        assert_eq!(
            offsets(
                Formation::LineAbreast,
                StationClass::Heavy,
                &[StationClass::Destroyer; 4]
            ),
            [[450.0, 0.0], [-450.0, 0.0], [900.0, 0.0], [-900.0, 0.0]]
        );
    }
    #[test]
    fn a_screen_rings_the_guide_with_the_boats_outside() {
        let stations = formation_stations(
            Formation::Screen,
            ("guide", StationClass::Heavy),
            &ships(&[
                StationClass::Destroyer,
                StationClass::Cruiser,
                StationClass::Destroyer,
                StationClass::Destroyer,
            ]),
        );
        // The cruiser sorts ahead of the destroyers and takes the inner ring and
        // the lower slot even though it was listed second.
        let arc = SCREEN_OUTER_RADIUS_M * (std::f64::consts::TAU / 3.0).sin();
        assert_eq!(
            stations,
            [
                Station {
                    id: "f1".into(),
                    offset: [0.0, -SCREEN_INNER_RADIUS_M],
                    slot: 0
                },
                Station {
                    id: "f0".into(),
                    offset: [0.0, -SCREEN_OUTER_RADIUS_M],
                    slot: 1
                },
                Station {
                    id: "f2".into(),
                    offset: [arc.round(), SCREEN_OUTER_RADIUS_M * 0.5],
                    slot: 2
                },
                Station {
                    id: "f3".into(),
                    offset: [-arc.round(), SCREEN_OUTER_RADIUS_M * 0.5],
                    slot: 3
                },
            ]
        );
        assert_eq!(arc.round(), 1126.0);
    }
    #[test]
    fn the_guide_never_takes_a_station_of_its_own() {
        let stations = formation_stations(
            Formation::Column,
            ("guide", StationClass::Heavy),
            &[
                ("guide".into(), StationClass::Heavy),
                ("dd".into(), StationClass::Destroyer),
            ],
        );
        assert_eq!(stations.len(), 1);
        assert_eq!(stations[0].id, "dd");
    }
    /// The protocol rejects an escort station under 350 m or beyond 5000 m, so a
    /// table entry that broke either bound would be an unissuable order.
    #[test]
    fn every_station_of_every_formation_is_a_legal_escort_offset() {
        for formation in FORMATIONS {
            for guide in CLASSES {
                for count in 1..=9 {
                    let followers: Vec<_> = (0..count)
                        .map(|i| CLASSES[i % CLASSES.len()])
                        .collect();
                    let stations = formation_stations(formation, ("guide", guide), &ships(&followers));
                    assert_eq!(stations.len(), count);
                    for station in &stations {
                        let range = station.offset[0].hypot(station.offset[1]);
                        assert!(
                            (MIN_STATION_OFFSET_M..=5000.0).contains(&range),
                            "{formation:?} guide {guide:?} station {station:?} is {range} m out"
                        );
                    }
                    // Two ships never share a berth.
                    for (i, a) in stations.iter().enumerate() {
                        for b in stations.iter().skip(i + 1) {
                            let gap = (a.offset[0] - b.offset[0]).hypot(a.offset[1] - b.offset[1]);
                            assert!(
                                gap >= MIN_STATION_OFFSET_M,
                                "{formation:?} {:?} and {:?} are {gap} m apart",
                                a.id,
                                b.id
                            );
                        }
                    }
                }
            }
        }
    }
}

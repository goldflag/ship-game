//! Bounded hydraulic geometry for fragmented construction rooms.
//!
//! Authoring and impact geometry retain their exact solids. The water model
//! groups nearby pieces into weighted boxes with the same total capacity,
//! centroid and diagonal second moments. Partial fills deliberately approximate
//! small obstructions inside one room; room boundaries and connections remain.
use crate::definition::{Compartment, CompartmentCellsItem};

pub(super) const MAX_CELLS: usize = 64;

pub(super) fn compact(room: &Compartment) -> Option<Compartment> {
    let mut cells = crate::volume_proxy::boxes(room.volumes.as_ref()?, MAX_CELLS)?;
    canonical_order(&mut cells);
    let reference = Compartment {
        capacity_m3: room.capacity_m3,
        center: room.center,
        size: room.size,
        cells: Some(cells),
        ..Default::default()
    };
    if reference.cells.as_ref()?.len() <= 16 {
        return Some(reference);
    }
    // Keep the established 64-box model as the accuracy floor. Smaller models
    // must retain partial water levels and centers as well as full moments.
    let mut samples = vec![];
    for roll in [
        -180., -135., -90., -75., -60., -45., -30., -15., 0., 15., 30., 45., 60., 75., 90., 135.,
    ] {
        for pitch in [-30., -15., -7.5, 0., 7.5, 15., 30.] {
            let (roll, pitch) = (f64::to_radians(roll), f64::to_radians(pitch));
            for fill in [
                0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999, 1.,
            ] {
                let volume = room.capacity_m3 * fill;
                let body = super::water_body(&reference, volume, roll, pitch);
                samples.push((volume, roll, pitch, body.level, body.center));
            }
        }
    }
    let acceptable = |candidate: &Compartment| {
        samples.iter().all(|(volume, roll, pitch, level, center)| {
            let after = super::water_body(candidate, *volume, *roll, *pitch);
            (after.level - level).abs() <= 0.025
                // A nearly empty room's water centroid can move substantially
                // while moving very little mass. Bound the first-moment error
                // to 2 mm of full-room capacity, including those tiny fills.
                && crate::geometry::length(crate::geometry::sub(after.center, *center))
                    * volume / room.capacity_m3.max(1e-9) <= 0.002
        })
    };
    for budget in [16, 32] {
        let cells = crate::volume_proxy::boxes(room.volumes.as_ref()?, budget)?;
        if cells.len() >= reference.cells.as_ref()?.len() {
            continue;
        }
        let candidate = Compartment {
            cells: Some(cells),
            ..reference.clone()
        };
        if acceptable(&candidate) {
            return Some(candidate);
        }
    }
    // A globally smaller partition can disturb every water surface at once.
    // Try a bounded number of local merges instead, always comparing the whole
    // result with the ORIGINAL reference so approximation error cannot drift.
    let mut result = reference.clone();
    let mut attempts = 64;
    while attempts > 0 {
        let cells = result.cells.as_ref()?;
        let mut pairs = vec![];
        for i in 0..cells.len() {
            for j in 0..i {
                let (a, b) = (&cells[i], &cells[j]);
                if (0..3).any(|k| {
                    (a.center[k] - b.center[k]).abs() > (a.size[k] + b.size[k]) / 2. + 0.02
                }) {
                    continue;
                }
                let score: f64 = (0..3)
                    .map(|k| {
                        ((a.center[k] - b.center[k]) / (a.size[k] + b.size[k]).max(1e-9)).powi(2)
                    })
                    .sum();
                pairs.push(((score * 1e8).round() as i64, i, j));
            }
        }
        pairs.sort_unstable();
        let mut merged = false;
        for (_, i, j) in pairs {
            if attempts == 0 {
                break;
            }
            attempts -= 1;
            let mut candidate = result.clone();
            let cells = candidate.cells.as_mut()?;
            let combined = merge(&cells[i], &cells[j]);
            cells.remove(i);
            cells[j] = combined;
            if acceptable(&candidate) {
                result = candidate;
                merged = true;
                break;
            }
        }
        if !merged {
            break;
        }
    }
    Some(result)
}

fn merge(a: &CompartmentCellsItem, b: &CompartmentCellsItem) -> CompartmentCellsItem {
    let av = a.volume_m3.unwrap();
    let bv = b.volume_m3.unwrap();
    let volume = av + bv;
    let center = std::array::from_fn(|k| (a.center[k] * av + b.center[k] * bv) / volume);
    let size = std::array::from_fn(|k| {
        let variance = (av * (a.size[k].powi(2) / 12. + (a.center[k] - center[k]).powi(2))
            + bv * (b.size[k].powi(2) / 12. + (b.center[k] - center[k]).powi(2)))
            / volume;
        (12. * variance).sqrt()
    });
    CompartmentCellsItem {
        center,
        size,
        volume_m3: Some(volume),
    }
}

fn canonical_order(cells: &mut [CompartmentCellsItem]) {
    // Equivalent CSG partitions differ by roundoff. Stable geometric ordering
    // and quantized cost ties prevent that noise choosing a different merge.
    cells.sort_by_cached_key(|c| {
        std::array::from_fn::<i64, 7, _>(|i| {
            let value = if i < 3 {
                c.center[i]
            } else if i < 6 {
                c.size[i - 3]
            } else {
                c.volume_m3.unwrap()
            };
            (value * 1e8).round() as i64
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{construction_geometry as cg, floodwater::water_body};

    fn room() -> Compartment {
        let cells: Vec<_> = (0..16)
            .flat_map(|x| {
                (0..8).map(move |z| {
                    cg::box_cell([x as f64 * 0.5 - 3.75, -2., z as f64 - 3.5], [0.5, 4., 1.])
                })
            })
            .collect();
        Compartment {
            capacity_m3: cg::total(&cells).volume,
            center: [0., -2., 0.],
            size: [8., 4., 8.],
            volumes: Some(cells),
            ..Default::default()
        }
    }

    #[test]
    fn bounded_model_preserves_capacity_full_center_and_inertia() {
        let room = room();
        let proxy = compact(&room).unwrap();
        assert!(proxy.cells.as_ref().unwrap().len() <= MAX_CELLS);
        assert_eq!(proxy.capacity_m3, room.capacity_m3);
        let exact = cg::total(room.volumes.as_ref().unwrap());
        for (roll, pitch) in [(0., 0.), (0.7, -0.2), (3.1, 0.4)] {
            let body = water_body(&proxy, proxy.capacity_m3, roll, pitch);
            for i in 0..3 {
                assert!((body.center[i] - exact.center()[i]).abs() < 1e-9);
                assert!((body.inertia_m3([0.; 3])[i] - exact.inertia(1., [0.; 3])[i]).abs() < 1e-7);
            }
        }
    }

    #[test]
    fn upright_rectangular_room_keeps_partial_fill_level_and_center() {
        let room = room();
        let proxy = compact(&room).unwrap();
        let mut previous = f64::NEG_INFINITY;
        for i in 0..=100 {
            let fraction = i as f64 / 100.;
            let water = water_body(&proxy, room.capacity_m3 * fraction, 0., 0.);
            assert!(water.level >= previous);
            assert!((water.level - (-4. + 4. * fraction)).abs() < 1e-8);
            if i > 0 {
                assert!((water.center[1] - (-4. + 2. * fraction)).abs() < 1e-8);
                assert!(water.center[0].abs() < 1e-9 && water.center[2].abs() < 1e-9);
            }
            previous = water.level;
        }
    }

    #[test]
    fn fragment_subdivision_does_not_change_the_hydraulic_shape() {
        let shape = cg::clip(&cg::box_cell([0.; 3], [8., 4., 16.]), [0.6, 0.8, 0.], 1.).unwrap();
        let whole = Compartment {
            capacity_m3: cg::moments(&shape).volume,
            size: [8., 4., 16.],
            volumes: Some(vec![shape.clone()]),
            ..Default::default()
        };
        let pieces = (-4..4)
            .filter_map(|i| {
                let cell = cg::clip(&shape, [0., 0., 1.], (i + 1) as f64 * 2.)?;
                cg::clip(&cell, [0., 0., -1.], -(i as f64) * 2.)
            })
            .collect();
        let divided = Compartment {
            volumes: Some(pieces),
            ..whole.clone()
        };
        let a = compact(&whole).unwrap();
        let b = compact(&divided).unwrap();
        for (roll, pitch) in [(0., 0.), (0.23, 0.07), (2.7, -0.2)] {
            for fill in [0.001, 0.01, 0.1, 0.5, 0.9, 1.] {
                let a = water_body(&a, a.capacity_m3 * fill, roll, pitch);
                let b = water_body(&b, b.capacity_m3 * fill, roll, pitch);
                assert!((a.level - b.level).abs() < 1e-6);
                for i in 0..3 {
                    assert!((a.center[i] - b.center[i]).abs() < 1e-6);
                }
            }
        }
    }

    #[test]
    fn local_merges_preserve_full_water_mass_center_and_inertia() {
        let a = CompartmentCellsItem {
            center: [-1., -3., 4.],
            size: [2., 5., 3.],
            volume_m3: Some(17.),
        };
        let b = CompartmentCellsItem {
            center: [2., -2., 5.],
            size: [4., 3., 2.],
            volume_m3: Some(11.),
        };
        let make = |cells| Compartment {
            capacity_m3: 28.,
            cells: Some(cells),
            ..Default::default()
        };
        let before = make(vec![a.clone(), b.clone()]);
        let after = make(vec![merge(&a, &b)]);
        for (roll, pitch) in [(0., 0.), (0.63, 0.07), (3., -0.2)] {
            let a = water_body(&before, 28., roll, pitch);
            let b = water_body(&after, 28., roll, pitch);
            assert!(crate::geometry::length(crate::geometry::sub(a.center, b.center)) < 1e-9);
            for (a, b) in a.inertia_m3([0.; 3]).into_iter().zip(b.inertia_m3([0.; 3])) {
                assert!((a - b).abs() < 1e-7);
            }
        }
    }

    #[test]
    fn smaller_published_rooms_keep_water_levels_and_mass_distribution() {
        let def: crate::definition::ShipDefinition =
            serde_json::from_str(include_str!("../../../../public/models/valiant.json")).unwrap();
        let mut removed = 0;
        for room in &def.compartments {
            let volumes = room.volumes.as_ref().unwrap();
            let baseline = Compartment {
                capacity_m3: room.capacity_m3,
                center: room.center,
                size: room.size,
                cells: Some(crate::volume_proxy::boxes(volumes, 64).unwrap()),
                ..Default::default()
            };
            let smaller = compact(room).unwrap();
            removed +=
                baseline.cells.as_ref().unwrap().len() - smaller.cells.as_ref().unwrap().len();
            for (roll, pitch) in [
                (0., 0.),
                (0.23, 0.05),
                (-0.8, 0.17),
                (1.57, -0.11),
                (3.1, 0.07),
            ] {
                for fill in [0.001, 0.05, 0.25, 0.75, 0.95, 0.999, 1.] {
                    let a = water_body(&baseline, room.capacity_m3 * fill, roll, pitch);
                    let b = water_body(&smaller, room.capacity_m3 * fill, roll, pitch);
                    assert!(
                        (a.level - b.level).abs() < 0.1,
                        "{} {roll} {pitch} {fill}: {} vs {}",
                        room.name,
                        a.level,
                        b.level
                    );
                    let delta =
                        crate::geometry::length(crate::geometry::sub(a.center, b.center)) * fill;
                    assert!(delta < 0.01, "{} {roll} {pitch} {fill}: {delta}", room.name);
                }
            }
        }
        assert!(removed > 0);
    }
}

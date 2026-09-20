//! Grouped topology retains the original localized damage and waterplane samples.
use crate::{
    damage::ConnectionState,
    definition::{FloodConnection, Vec3},
    geometry::contains,
};

pub fn valid(c: &FloodConnection) -> bool {
    let Some(patches) = &c.patches else {
        return true;
    };
    !patches.is_empty()
        && c.armor_id.is_some()
        && c.thickness_mm.is_none()
        && c.area_m2.is_finite()
        && c.area_m2 > 0.
        && patches.iter().all(|p| {
            p.area_m2.is_finite()
                && p.area_m2 > 0.
                && p.position
                    .iter()
                    .chain(&p.bounds.center)
                    .all(|v| v.is_finite())
                && p.bounds.size.iter().all(|v| v.is_finite() && *v > 0.)
                && p.transfer_order.is_finite()
                && p.transfer_order >= 0.
                && p.transfer_order.fract() == 0.
        })
        && (patches.iter().map(|p| p.area_m2).sum::<f64>() - c.area_m2).abs()
            <= 1e-9_f64.max(c.area_m2 * 1e-10)
}

pub fn breach_at(c: &FloodConnection, state: &mut ConnectionState, point: Vec3, area: f64) -> bool {
    if c.bounds
        .as_ref()
        .is_some_and(|b| !contains(b.center, b.size, point))
    {
        return false;
    }
    if let Some(patches) = &c.patches {
        // A damaged group without local damage means all patches were breached
        // (e.g. magazine destruction); preserve that state when hit again.
        let fraction = if state.state == "damaged" {
            (state.damage_area_m2 / c.area_m2).clamp(0., 1.)
        } else {
            0.
        };
        let mut hit = false;
        for (i, p) in patches.iter().enumerate() {
            if !contains(p.bounds.center, p.bounds.size, point) {
                continue;
            }
            let damage = state
                .patch_damage_m2
                .get_or_insert_with(|| patches.iter().map(|p| p.area_m2 * fraction).collect());
            damage[i] = p.area_m2.min(damage[i] + area);
            hit = true;
        }
        if !hit {
            return false;
        }
        state.damage_area_m2 = state.patch_damage_m2.as_ref().unwrap().iter().sum();
    } else {
        state.damage_area_m2 = c.area_m2.min(state.damage_area_m2 + area);
    }
    state.state = "damaged".into();
    true
}

/// The old per-fragment fire paths were parallel; preserve their summed exposure.
pub fn fire_path(c: &FloodConnection, state: &ConnectionState) -> f64 {
    if state.state == "closed" {
        return 0.;
    }
    match &c.patches {
        Some(patches) if state.state == "damaged" => patches
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let area = state
                    .patch_damage_m2
                    .as_ref()
                    .map_or_else(|| p.area_m2 * state.damage_area_m2 / c.area_m2, |d| d[i]);
                (area / 0.5).min(1.)
            })
            .sum(),
        Some(patches) => patches.len() as f64,
        None if state.state == "damaged" => (state.damage_area_m2 / 0.5).min(1.),
        None => 1.,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definition::*;
    #[test]
    fn grouped_breach_preserves_height_holes_and_per_patch_caps() {
        let c = FloodConnection {
            area_m2: 2.,
            patches: Some(
                vec![0., 4.]
                    .into_iter()
                    .map(|y| FloodConnectionPatch {
                        area_m2: 1.,
                        position: [0., y, 0.],
                        bounds: FloodConnectionPatchBounds {
                            center: [0., y, 0.],
                            size: [1., 1., 0.1],
                        },
                        transfer_order: y,
                    })
                    .collect(),
            ),
            ..Default::default()
        };
        let mut malformed = c.clone();
        malformed.armor_id = Some("wall".into());
        assert!(valid(&malformed));
        malformed.patches.as_mut().unwrap()[0].area_m2 = -1.;
        assert!(!valid(&malformed));
        malformed.patches = Some(vec![]);
        assert!(!valid(&malformed));
        let mut s = ConnectionState {
            id: "wall".into(),
            state: "closed".into(),
            damage_area_m2: 0.,
            patch_damage_m2: None,
            from_index: 0,
            to_index: 1,
        };
        assert!(!breach_at(&c, &mut s, [0., 2., 0.], 0.2));
        assert!(s.patch_damage_m2.is_none());
        assert!(breach_at(&c, &mut s, [0., 4., 0.], 0.2));
        assert_eq!(s.patch_damage_m2, Some(vec![0., 0.2]));
        assert_eq!(fire_path(&c, &s), 0.4);
        breach_at(&c, &mut s, [0., 4., 0.], 2.);
        assert_eq!(s.damage_area_m2, 1.);
        assert_eq!(s.patch_damage_m2, Some(vec![0., 1.]));
        breach_at(&c, &mut s, [0., 0., 0.], 0.1);
        assert_eq!(s.patch_damage_m2, Some(vec![0.1, 1.]));
    }
}

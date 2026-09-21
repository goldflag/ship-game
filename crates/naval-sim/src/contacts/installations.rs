//! Combat-only proxies for generated gun supports. Authoring, rendered meshes,
//! mass, working wells and flood openings retain their 64-sided geometry.
use std::{
    collections::{BTreeMap, BTreeSet},
    f64::consts::TAU,
};

use super::{ContactKind, ShipContact};
use crate::{
    definition::{Armor, ShipDefinition, Vec3},
    geometry::*,
    protection::PlateHit,
    shell::Shell,
};

const SIDES: usize = 64;
const EPS: f64 = 1e-7;

#[cfg(test)]
mod tests;

#[derive(Clone, Debug)]
struct Ring {
    center: Vec3,
    radius: f64,
    inner: f64,
    low: f64,
    top: f64,
    angle: f64,
    outer: Vec<usize>,
    cap: Vec<usize>,
}

#[derive(Default)]
struct Faces {
    outer: Vec<(usize, usize)>,
    cap: Vec<(usize, usize)>,
}

fn near(a: Vec3, b: Vec3) -> bool {
    (0..3).all(|i| (a[i] - b[i]).abs() <= EPS)
}

impl Ring {
    fn new(armor: &[Armor], mut faces: Faces) -> Option<Self> {
        if faces.outer.len() != SIDES || faces.cap.len() != SIDES {
            return None;
        }
        faces.outer.sort_unstable();
        faces.cap.sort_unstable();
        let outer: Vec<_> = faces.outer.iter().map(|&(_, i)| i).collect();
        let cap: Vec<_> = faces.cap.iter().map(|&(_, i)| i).collect();
        for &i in outer.iter().chain(&cap) {
            let a = &armor[i];
            let p = a.plate.as_ref()?;
            if p.vertices.len() != 4
                || p.mount_id.is_some()
                || a.exterior != Some(false)
                || p.exterior != Some(false)
                || p.surface_id.as_ref() != Some(&a.id)
            {
                return None;
            }
        }
        let vertices = |i: usize| &armor[i].plate.as_ref().unwrap().vertices;
        let center = scale(
            outer.iter().fold([0.; 3], |a, &i| add(a, vertices(i)[0])),
            1. / SIDES as f64,
        );
        let v = vertices(outer[0]);
        let radius = (v[0][0] - center[0]).hypot(v[0][2] - center[2]);
        let inner_v = vertices(cap[0])[1];
        let inner = (inner_v[0] - center[0]).hypot(inner_v[2] - center[2]);
        let low = v[0][1];
        let top = v[1][1];
        let angle = (v[0][2] - center[2]).atan2(v[0][0] - center[0]);
        if !(radius > inner && inner > 0. && top > low) {
            return None;
        }
        // Recognize the complete generator output, never just an id prefix.
        // Edited, incomplete, non-circular or differently wound supports fall
        // back to ordinary plates. Each sector keeps its own armor properties.
        for i in 0..SIDES {
            let a = angle + i as f64 * TAU / SIDES as f64;
            let b = angle + (i + 1) as f64 * TAU / SIDES as f64;
            let at = |r: f64, y: f64, t: f64| [center[0] + r * t.cos(), y, center[2] + r * t.sin()];
            let wall = [
                at(radius, low, a),
                at(radius, top, a),
                at(radius, top, b),
                at(radius, low, b),
            ];
            let annulus = [
                at(radius, top, a),
                at(inner, top, a),
                at(inner, top, b),
                at(radius, top, b),
            ];
            if !vertices(outer[i])
                .iter()
                .zip(wall)
                .all(|(&a, b)| near(a, b))
                || !vertices(cap[i])
                    .iter()
                    .zip(annulus)
                    .all(|(&a, b)| near(a, b))
            {
                return None;
            }
        }
        Some(Self {
            center,
            radius,
            inner,
            low,
            top,
            angle,
            outer,
            cap,
        })
    }

    fn contact(&self, hit: PlateHit, cap: bool, ship: &str, armor: &[Armor]) -> ShipContact {
        let angle = (hit.point[2] - self.center[2]).atan2(hit.point[0] - self.center[0]);
        let sector = (angle - self.angle).rem_euclid(TAU) * SIDES as f64 / TAU;
        let i = (sector.floor() as usize).min(SIDES - 1);
        let ids = if cap { &self.cap } else { &self.outer };
        let key = |i: usize| format!("{ship}:armor:{}:plate", armor[ids[i]].id);
        let mut contact = ShipContact::new(hit, key(i), ContactKind::Armor, ids[i] as isize);
        // A hit exactly at a sector boundary must remain visited if roundoff
        // puts the next segment on the neighboring authored plate.
        if (sector - sector.round()).abs() < EPS {
            let neighbor = if sector.fract() < 0.5 {
                (i + SIDES - 1) % SIDES
            } else {
                (i + 1) % SIDES
            };
            contact.seam_keys.push(key(neighbor));
        }
        contact
    }

    fn contacts(
        &self,
        from: Vec3,
        to: Vec3,
        ship: &str,
        armor: &[Armor],
        out: &mut Vec<ShipContact>,
    ) {
        let center = [self.center[0], (self.low + self.top) / 2., self.center[2]];
        let size = [self.radius * 2., self.top - self.low, self.radius * 2.];
        if !segment_overlaps_box(from, to, center, size) {
            return;
        }
        let delta = sub(to, from);
        let origin = sub(from, self.center);
        let d2 = delta[0] * delta[0] + delta[2] * delta[2];
        let start = out.len();
        let mut push = |t: f64, cap: bool| {
            if !(-1e-9..=1. + 1e-9).contains(&t) {
                return;
            }
            let point = add(from, scale(delta, t.clamp(0., 1.)));
            let radial = [point[0] - self.center[0], 0., point[2] - self.center[2]];
            let r = length(radial);
            if (cap && (r < self.inner - EPS || r > self.radius + EPS))
                || (!cap && (point[1] < self.low - EPS || point[1] > self.top + EPS))
            {
                return;
            }
            let hit = PlateHit {
                t: t.clamp(0., 1.),
                point,
                normal: if cap { [0., 1., 0.] } else { normalize(radial) },
                on_edge: if cap {
                    (r - self.inner).abs() < EPS || (r - self.radius).abs() < EPS
                } else {
                    (point[1] - self.low).abs() < EPS || (point[1] - self.top).abs() < EPS
                },
            };
            let mut contact = self.contact(hit, cap, ship, armor);
            if let Some(previous) = out[start..].iter_mut().find(|p| near(p.point, point)) {
                // The top/wall rim is one crossing, using the less oblique
                // face, with both identities visited after penetration.
                if dot(contact.normal, delta).abs() > dot(previous.normal, delta).abs() {
                    std::mem::swap(previous, &mut contact);
                }
                previous.seam_keys.push(contact.key);
                previous.seam_keys.extend(contact.seam_keys);
            } else {
                out.push(contact);
            }
        };
        if d2 > 0. {
            let middle = -(origin[0] * delta[0] + origin[2] * delta[2]) / d2;
            let x = origin[0] + middle * delta[0];
            let z = origin[2] + middle * delta[2];
            let span2 = (self.radius * self.radius - x * x - z * z) / d2;
            // A tangent only touches the surface; it does not cross armor.
            if span2 > 0. {
                let span = span2.sqrt();
                push(middle - span, false);
                push(middle + span, false);
            }
        }
        if delta[1].abs() > 1e-10 {
            push((self.top - from[1]) / delta[1], true);
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct InstallationContacts {
    pointer: usize,
    len: usize,
    rings: Vec<Ring>,
    pub replaced: Vec<bool>,
}

impl InstallationContacts {
    pub fn new(def: &ShipDefinition) -> Self {
        let mut groups: BTreeMap<&str, Faces> = BTreeMap::new();
        if def.construction.is_some() {
            let protected: BTreeSet<_> = def
                .connections
                .iter()
                .filter_map(|c| c.armor_id.as_deref())
                .collect();
            for (i, a) in def.armor.iter().enumerate() {
                let Some((prefix, number)) = a.id.rsplit_once(':') else {
                    continue;
                };
                let Ok(number) = number.parse::<usize>() else {
                    continue;
                };
                let Some((equipment, face)) = prefix.rsplit_once(':') else {
                    continue;
                };
                if !equipment.starts_with("equipment:") {
                    continue;
                }
                // Protection-linked flood portals retain their literal plate.
                if protected.contains(a.id.as_str()) {
                    continue;
                }
                match face {
                    "installation-outer" => {
                        groups.entry(equipment).or_default().outer.push((number, i))
                    }
                    "installation-top" => {
                        groups.entry(equipment).or_default().cap.push((number, i))
                    }
                    _ => (),
                }
            }
        }
        let rings: Vec<_> = groups
            .into_values()
            .filter_map(|g| Ring::new(&def.armor, g))
            .collect();
        let mut replaced = vec![false; def.armor.len()];
        for ring in &rings {
            for &i in ring.outer.iter().chain(&ring.cap) {
                replaced[i] = true;
            }
        }
        Self {
            pointer: def.armor.as_ptr() as usize,
            len: def.armor.len(),
            rings,
            replaced,
        }
    }

    pub fn matches(&self, armor: &[Armor]) -> bool {
        self.pointer == armor.as_ptr() as usize && self.len == armor.len()
    }

    pub fn shape_count(&self) -> usize {
        self.rings.len() * 2
    }

    pub fn contacts(
        &self,
        shell: &Shell,
        from: Vec3,
        to: Vec3,
        ship: &str,
        armor: &[Armor],
        out: &mut Vec<ShipContact>,
    ) {
        for ring in &self.rings {
            ring.contacts(from, to, ship, armor, out);
        }
        out.retain(|hit| {
            !shell.visited.contains(&hit.key)
                && !hit.seam_keys.iter().any(|k| shell.visited.contains(k))
        });
    }
}

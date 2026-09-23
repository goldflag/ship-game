//! Equipment parents. An equipment row may name a hull piece or another equipment row as its
//! `parent`: the editing tools move, turn, copy, mirror and remove it with that parent.
//!
//! Parents are hull pieces, equipment that never trains (deck fittings, catalog and design-local,
//! masts, funnels and directors) and trainable guns. Only equipment that may float
//! (`construction::floats`) takes a parent. Under a fixed parent the link is a source relationship
//! only: the row keeps its own absolute `position` and `bearingDeg`, and nothing the compiler
//! derives reads it.
//!
//! A row with a gun anywhere up its chain is carried: it trains with the nearest such gun, its
//! carrier. Its `position` and `bearingDeg` stay absolute at the neutral pose (every train zero). A
//! carried gun's mount names its carrier as `parentMountId`, so the runtime composes its frame
//! (`mount_frames.rs`); a carried fitting is drawn under the carrier's yaw joint. Only deck fittings
//! (catalog and design-local) and light deck guns without a raised barbette may be carried: a mast
//! adds a fixed gun-arc obstruction and a barbette adds fixed hull material, neither of which could
//! train. A torpedo launcher cannot carry equipment yet. Mirrored by `src/ships/constructionParents.ts`.
use crate::construction::floats;
use crate::construction_custom_fittings::is_custom;
use crate::construction_installation::{deck_mounted, raised};
use crate::definition::*;
use std::collections::BTreeMap;

/// Diagnostic code of every parent fault.
pub const CODE: &str = "equipment-parent";
/// Parent links from a row up to the first hull piece or unparented row.
pub const MAX_DEPTH: usize = 8;

/// A row's part: a published catalog part, a design-local fitting (always a deck fitting), or
/// unknown (reported as a missing part later; its parent is not judged here).
enum Part<'a> {
    Catalog(&'a ConstructionEquipmentPart),
    Custom,
    Unknown,
}
fn part_of<'a>(catalog: &'a ConstructionCatalog, e: &ConstructionEquipment) -> Part<'a> {
    if is_custom(&e.part_id) {
        return Part::Custom;
    }
    catalog
        .equipment
        .iter()
        .find(|p| p.id == e.part_id)
        .map_or(Part::Unknown, Part::Catalog)
}

/// Whether this row may take a parent: exactly the equipment that may float.
fn may_have_parent(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    e: &ConstructionEquipment,
) -> Option<bool> {
    match part_of(catalog, e) {
        Part::Catalog(p) => Some(floats(c, catalog, e, p)),
        Part::Custom => Some(e.wall.is_none() && e.path.is_none()),
        Part::Unknown => None,
    }
}

/// Why this row cannot carry equipment, or `None` when it can.
fn carry_fault(catalog: &ConstructionCatalog, e: &ConstructionEquipment) -> Option<String> {
    let p = match part_of(catalog, e) {
        Part::Catalog(p) => p,
        Part::Custom if e.wall.is_none() && e.path.is_none() => return None,
        Part::Custom => {
            return Some(format!(
                "{} (wall or path fitting) cannot carry equipment; parents are hull pieces, guns, masts, funnels, directors and deck fittings",
                e.id
            ));
        }
        Part::Unknown => return None,
    };
    match p.kind.as_str() {
        "torpedo-launcher" => Some(format!(
            "{} is a trainable torpedo launcher; equipment cannot ride a launcher yet",
            e.id
        )),
        "gun" | "deck-fitting" | "mast" | "funnel" | "director"
            if p.placement == "deck"
                && p.path.is_none()
                && p.wall_mount.is_none()
                && e.wall.is_none()
                && e.path.is_none() =>
        {
            None
        }
        kind => Some(format!(
            "{} ({}) cannot carry equipment; parents are hull pieces, guns, masts, funnels, directors and deck fittings",
            e.id,
            if p.path.is_some() || e.path.is_some() {
                "connected path fitting"
            } else if p.wall_mount.is_some() || e.wall.is_some() {
                "wall fitting"
            } else {
                kind
            }
        )),
    }
}

/// Whether this row is a trainable gun, which carries its riders through its train.
fn trains(catalog: &ConstructionCatalog, e: &ConstructionEquipment) -> bool {
    matches!(part_of(catalog, e), Part::Catalog(p) if p.kind == "gun")
}

/// Why this row cannot ride a trainable gun, or `None` when it can: deck fittings (catalog and
/// design-local) and light deck guns without a raised barbette. Its other faults (wall, path, a
/// gun with a well) are reported first as a row that cannot float.
fn ride_fault(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    e: &ConstructionEquipment,
    carrier: &str,
) -> Option<String> {
    let p = match part_of(catalog, e) {
        Part::Catalog(p) => p,
        Part::Custom | Part::Unknown => return None,
    };
    match p.kind.as_str() {
        "deck-fitting" => None,
        "gun" if deck_mounted(c, catalog, p) && raised(e) == 0. => None,
        "gun" => Some(format!(
            "{} stands on a raised barbette, which is fixed hull material and cannot train with {carrier}; remove the barbette height",
            e.id
        )),
        kind => Some(format!(
            "{} ({kind}) cannot ride the trainable gun {carrier}; only deck fittings and light deck guns train with a gun",
            e.id
        )),
    }
}

fn fault(id: &str, parent: &str, message: String) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: "error".into(),
        code: CODE.into(),
        message,
        source_id: Some(id.to_owned()),
        related_source_ids: Some([parent.to_owned()].into()),
        ..Default::default()
    }
}

/// Every parent fault in source order, at most `limit`: an unknown, ambiguous or self parent, a
/// row that cannot float, a parent that cannot carry, a loop and a chain deeper than `MAX_DEPTH`.
/// Each row reports its own first fault; a chain that passes through a faulty row stops there
/// without blaming the rows below it.
pub(crate) fn check(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    limit: usize,
) -> Vec<ConstructionDiagnostic> {
    let mut out = vec![];
    if c.equipment.iter().all(|e| e.parent.is_none()) {
        return out;
    }
    let rows: BTreeMap<&str, &ConstructionEquipment> =
        c.equipment.iter().map(|e| (e.id.as_str(), e)).collect();
    let pieces: std::collections::BTreeSet<&str> =
        c.primitives.iter().map(|p| p.id.as_str()).collect();
    for e in &c.equipment {
        if out.len() >= limit {
            break;
        }
        let Some(parent) = e.parent.as_deref() else {
            continue;
        };
        let row = rows.get(parent).copied();
        let piece = pieces.contains(parent);
        let direct = if parent == e.id {
            Some(format!("{} names itself as its parent", e.id))
        } else if row.is_none() && !piece {
            Some(format!(
                "{} names the parent {parent}, which is neither a hull piece nor an equipment row",
                e.id
            ))
        } else if row.is_some() && piece {
            Some(format!(
                "{parent} is both a hull piece and an equipment row; rename one so the parent of {} is unambiguous",
                e.id
            ))
        } else if may_have_parent(c, catalog, e) == Some(false) {
            Some(format!(
                "{} needs hull support, so it cannot ride a parent; only equipment that may float (deck fittings, masts and light deck-mounted guns without a well) takes one",
                e.id
            ))
        } else {
            row.and_then(|r| carry_fault(catalog, r))
        };
        if let Some(message) = direct {
            out.push(fault(&e.id, parent, message));
            continue;
        }
        // Walk up to the first hull piece or unparented row, noting the first trainable gun.
        let mut seen = vec![e.id.as_str()];
        let mut current = parent;
        let mut depth = 1;
        let mut carrier = None;
        loop {
            if seen.contains(&current) {
                out.push(fault(
                    &e.id,
                    parent,
                    format!("The parents of {} loop back through {current}", e.id),
                ));
                break;
            }
            if carrier.is_none() && rows.get(current).is_some_and(|r| trains(catalog, r)) {
                carrier = Some(current);
            }
            let Some(next) = rows.get(current).and_then(|r| r.parent.as_deref()) else {
                if let Some(message) = carrier.and_then(|gun| ride_fault(c, catalog, e, gun)) {
                    out.push(fault(&e.id, parent, message));
                }
                break;
            };
            depth += 1;
            if depth > MAX_DEPTH {
                out.push(fault(
                    &e.id,
                    parent,
                    format!(
                        "{} rides more than {MAX_DEPTH} parents deep; attach it closer to the hull",
                        e.id
                    ),
                ));
                break;
            }
            seen.push(current);
            current = next;
        }
    }
    out
}

/// The trainable guns that carry each carried row, nearest (its carrier) first. Rows under fixed
/// parents only, or none, are absent, so a design without trainable parents gets an empty map. The
/// walk is bounded and stops at a loop or a missing row: it may run before `check` reports them.
pub(crate) fn carriers(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    if c.equipment.iter().all(|e| e.parent.is_none()) {
        return out;
    }
    let rows: BTreeMap<&str, &ConstructionEquipment> =
        c.equipment.iter().map(|e| (e.id.as_str(), e)).collect();
    for e in &c.equipment {
        let mut guns = vec![];
        let mut current = e.parent.as_deref();
        for _ in 0..=MAX_DEPTH {
            let Some(row) = current.and_then(|id| rows.get(id)) else {
                break;
            };
            if row.id == e.id {
                break;
            }
            if trains(catalog, row) && !guns.contains(&row.id) {
                guns.push(row.id.clone());
            }
            current = row.parent.as_deref();
        }
        if !guns.is_empty() {
            out.insert(e.id.clone(), guns);
        }
    }
    out
}

/// Whether one of two rows carries the other through its train.
pub(crate) fn carried_pair(carriers: &BTreeMap<String, Vec<String>>, a: &str, b: &str) -> bool {
    let carries = |row: &str, gun: &str| {
        carriers
            .get(row)
            .is_some_and(|g| g.iter().any(|g| g == gun))
    };
    carries(a, b) || carries(b, a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::{compile, to_json};

    fn part(id: &str, kind: &str, placement: &str) -> ConstructionEquipmentPart {
        ConstructionEquipmentPart {
            id: id.into(),
            name: id.into(),
            kind: kind.into(),
            placement: placement.into(),
            size: [1., 1., 1.],
            bounds_center: [0., 0.5, 0.],
            mass_kg: Some(200.),
            ..Default::default()
        }
    }
    fn row(id: &str, part_id: &str, position: Vec3, parent: Option<&str>) -> ConstructionEquipment {
        ConstructionEquipment {
            id: id.into(),
            part_id: part_id.into(),
            position,
            parent: parent.map(str::to_owned),
            ..Default::default()
        }
    }
    fn fixture() -> (ConstructionSource, ConstructionCatalog) {
        let bollard = ConstructionFittingDefinition {
            id: "fit-bollard".into(),
            name: "Bollard".into(),
            version: 1.,
            attach: "deck".into(),
            solids: vec![ConstructionFittingSolid {
                id: "post".into(),
                kind: "box".into(),
                size: [0.4, 0.6, 0.4],
                position: [0., 0.3, 0.],
                ..Default::default()
            }],
            ..Default::default()
        };
        (
            ConstructionSource {
                schema_version: 1.,
                id: "test-hull".into(),
                name: "Test hull".into(),
                coordinates: "meters-y-up-bow-negative-z".into(),
                revision: "one".into(),
                construction: ConstructionData {
                    version: 2.,
                    catalog_revision: "test".into(),
                    default_thickness_mm: 10.,
                    primitives: vec![ConstructionPrimitive {
                        id: "box".into(),
                        kind: "box".into(),
                        size: [10., 4., 20.],
                        ..Default::default()
                    }],
                    fittings: Some(vec![bollard]),
                    ..Default::default()
                },
            },
            ConstructionCatalog {
                schema_version: 1.,
                revision: "test".into(),
                weapons: PartCatalog {
                    schema_version: 1.,
                    ..Default::default()
                },
                equipment: vec![
                    part("gun-part", "gun", "deck"),
                    part("launcher-part", "torpedo-launcher", "deck"),
                    part("mast-part", "mast", "deck"),
                    part("engine-part", "engine", "internal"),
                ],
                ..Default::default()
            },
        )
    }
    fn faults(source: &ConstructionSource, catalog: &ConstructionCatalog) -> Vec<(String, String)> {
        compile(source, catalog)
            .diagnostics
            .into_iter()
            .filter(|d| d.code == CODE)
            .map(|d| (d.source_id.unwrap_or_default(), d.message))
            .collect()
    }

    #[test]
    fn a_parent_changes_nothing_the_compiler_derives() {
        let (mut source, catalog) = fixture();
        source.construction.equipment = vec![
            row("bollard-1", "design:fit-bollard", [2., 2., -5.], None),
            row("bollard-2", "design:fit-bollard", [2., 2.6, -5.], None),
            row("bollard-3", "design:fit-bollard", [-2., 2., -5.], None),
        ];
        let loose = compile(&source, &catalog);
        assert!(loose.definition.is_some(), "{:?}", loose.diagnostics);
        source.construction.equipment[1].parent = Some("bollard-1".into());
        source.construction.equipment[2].parent = Some("box".into());
        let parented = compile(&source, &catalog);
        assert!(parented.definition.is_some(), "{:?}", parented.diagnostics);
        // The definition carries its source and hashes; everything derived from them is identical.
        let derived = |d: &Option<ShipDefinition>| {
            let mut d = d.clone().unwrap();
            d.construction = None;
            d.content_hash = None;
            d.id = String::new();
            to_json(&d).unwrap()
        };
        assert_eq!(derived(&loose.definition), derived(&parented.definition));
        assert_eq!(
            to_json(&loose.loading).unwrap(),
            to_json(&parented.loading).unwrap()
        );
        assert_eq!(
            to_json(&loose.surfaces).unwrap(),
            to_json(&parented.surfaces).unwrap()
        );
        // Skip-if-absent: a source without parents serializes without the field.
        source.construction.equipment[1].parent = None;
        source.construction.equipment[2].parent = None;
        assert!(!to_json(&source).unwrap().contains("\"parent\""));
    }

    #[test]
    fn a_chain_of_eight_is_accepted_and_nine_is_refused() {
        let (mut source, catalog) = fixture();
        let mut rows = vec![row(
            "link-1",
            "design:fit-bollard",
            [0., 2., 0.],
            Some("box"),
        )];
        for i in 2..=8 {
            let parent = format!("link-{}", i - 1);
            rows.push(row(
                &format!("link-{i}"),
                "design:fit-bollard",
                [0., 2., 0.],
                Some(&parent),
            ));
        }
        source.construction.equipment = rows.clone();
        assert!(faults(&source, &catalog).is_empty());
        rows.push(row(
            "link-9",
            "design:fit-bollard",
            [0., 2., 0.],
            Some("link-8"),
        ));
        source.construction.equipment = rows;
        let found = faults(&source, &catalog);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].0, "link-9");
        assert!(
            found[0].1.contains("more than 8 parents deep"),
            "{}",
            found[0].1
        );
    }

    #[test]
    fn unknown_self_and_looping_parents_are_diagnostics_not_panics() {
        let (mut source, catalog) = fixture();
        source.construction.equipment = vec![
            row("a", "design:fit-bollard", [0., 2., 0.], Some("b")),
            row("b", "design:fit-bollard", [0., 2., 0.], Some("a")),
            row("c", "design:fit-bollard", [0., 2., 0.], Some("a")),
            row("d", "design:fit-bollard", [0., 2., 0.], Some("d")),
            row("e", "design:fit-bollard", [0., 2., 0.], Some("nowhere")),
        ];
        let result = compile(&source, &catalog);
        assert!(result.definition.is_none());
        let found = faults(&source, &catalog);
        let ids: Vec<_> = found.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, ["a", "b", "c", "d", "e"], "{found:?}");
        assert!(found[0].1.contains("loop back"), "{}", found[0].1);
        assert!(found[2].1.contains("loop back through"), "{}", found[2].1);
        assert!(found[3].1.contains("itself"), "{}", found[3].1);
        assert!(found[4].1.contains("nowhere"), "{}", found[4].1);
        let named = result
            .diagnostics
            .iter()
            .find(|d| d.source_id.as_deref() == Some("e"))
            .unwrap();
        assert_eq!(
            named.related_source_ids.as_deref(),
            Some(&["nowhere".to_owned()][..])
        );
    }

    #[test]
    fn guns_carry_launchers_cannot_and_supported_equipment_cannot_ride() {
        let (mut source, mut catalog) = fixture();
        // An explicitly empty occupancy declares a light deck gun without a well: it may float.
        catalog.equipment.push(ConstructionEquipmentPart {
            occupancy: Some(vec![]),
            ..part("light-gun-part", "gun", "deck")
        });
        let mut raised = row(
            "raised-on-gun",
            "light-gun-part",
            [1., 4., -6.],
            Some("gun"),
        );
        raised.gun = Some(ConstructionEquipmentGun {
            barbette_height_m: Some(1.),
            ..Default::default()
        });
        source.construction.equipment = vec![
            row("gun", "gun-part", [0., 2., -6.], None),
            row("tubes", "launcher-part", [0., 2., 6.], None),
            row("mast", "mast-part", [0., 2., 0.], None),
            row("engine", "engine-part", [0., -1., 0.], None),
            row("on-gun", "design:fit-bollard", [0., 4., -6.], Some("gun")),
            row(
                "light-on-gun",
                "light-gun-part",
                [-1., 4., -6.],
                Some("gun"),
            ),
            raised,
            row("mast-on-gun", "mast-part", [0., 5., -6.], Some("gun")),
            row("mast-on-rider", "mast-part", [0., 5., -6.], Some("on-gun")),
            row(
                "on-tubes",
                "design:fit-bollard",
                [0., 4., 6.],
                Some("tubes"),
            ),
            row(
                "on-engine",
                "design:fit-bollard",
                [0., 0., 0.],
                Some("engine"),
            ),
            row("gun-on-mast", "gun-part", [0., 8., 0.], Some("mast")),
            row(
                "light-on-mast",
                "design:fit-bollard",
                [0., 8., 0.],
                Some("mast"),
            ),
            row("mast-on-box", "mast-part", [3., 2., 0.], Some("box")),
        ];
        let found = faults(&source, &catalog);
        let by = |id: &str| {
            found
                .iter()
                .find(|(own, _)| own == id)
                .map(|(_, m)| m.as_str())
                .unwrap_or_default()
        };
        assert!(
            by("on-tubes").contains("cannot ride a launcher yet"),
            "{found:?}"
        );
        assert!(
            by("on-engine").contains("engine (engine) cannot carry"),
            "{found:?}"
        );
        assert!(
            by("gun-on-mast").contains("needs hull support"),
            "{found:?}"
        );
        assert!(by("raised-on-gun").contains("raised barbette"), "{found:?}");
        assert!(
            by("mast-on-gun").contains("cannot ride the trainable gun gun"),
            "{found:?}"
        );
        // Carried through a deck fitting that the gun carries.
        assert!(
            by("mast-on-rider").contains("cannot ride the trainable gun gun"),
            "{found:?}"
        );
        assert_eq!(found.len(), 6, "{found:?}");
        let carriers = carriers(&source.construction, &catalog);
        assert_eq!(carriers["on-gun"], ["gun"]);
        assert_eq!(carriers["light-on-gun"], ["gun"]);
        assert_eq!(carriers["mast-on-rider"], ["gun"]);
        assert!(!carriers.contains_key("light-on-mast"));
        assert!(!carriers.contains_key("gun"));
        assert!(carried_pair(&carriers, "gun", "light-on-gun"));
        assert!(carried_pair(&carriers, "light-on-gun", "gun"));
        assert!(!carried_pair(&carriers, "light-on-gun", "on-gun"));
    }

    #[test]
    fn nested_carriers_list_the_nearest_gun_first() {
        let (mut source, mut catalog) = fixture();
        catalog.equipment.push(ConstructionEquipmentPart {
            occupancy: Some(vec![]),
            ..part("light-gun-part", "gun", "deck")
        });
        source.construction.equipment = vec![
            row("lamp", "design:fit-bollard", [0., 6., -6.], Some("light")),
            row("light", "light-gun-part", [0., 5., -6.], Some("platform")),
            row("platform", "design:fit-bollard", [0., 4., -6.], Some("gun")),
            row("gun", "gun-part", [0., 2., -6.], None),
        ];
        assert!(faults(&source, &catalog).is_empty());
        let carriers = carriers(&source.construction, &catalog);
        assert_eq!(carriers["lamp"], ["light", "gun"]);
        assert_eq!(carriers["light"], ["gun"]);
        assert_eq!(carriers["platform"], ["gun"]);
        assert_eq!(carriers.len(), 3);
        source.construction.equipment[3].parent = Some("lamp".into());
        // A loop never hangs the walk; `check` reports it.
        let _ = super::carriers(&source.construction, &catalog);
    }
}

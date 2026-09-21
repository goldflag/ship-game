//! Included machinery auxiliaries, not additional free equipment or loading.
//! A 35 t package supplies one rated service unit; smaller packages scale down.
//! The compiler reserves shaft power and records pump/crew calibration using
//! existing definition fields. Runtime health belongs to the installed engine.
use crate::{
    damage::Combatant,
    definition::{
        ConstructionCatalog, ConstructionDiagnostic, DamageControlProfile, Module, SharedExhaust,
        ShipDefinition,
    },
    environment::SeaState,
    machinery::equipment_condition,
};

// Count work on each test thread without imposing timing thresholds or adding
// state to production builds.
#[cfg(test)]
thread_local! {
    static EXHAUST_EVALUATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

pub(crate) const AUXILIARY_POWER_SHARE: f64 = 0.02;
const FIXED_PUMP_M3_PER_SECOND: f64 = 0.02;

fn rating(mass_kg: f64) -> f64 {
    (mass_kg / 35_000.).clamp(0., 1.)
}

pub(crate) fn install(
    def: &mut ShipDefinition,
    catalog: &ConstructionCatalog,
) -> Option<ConstructionDiagnostic> {
    let source = def.construction.as_ref()?;
    let mut packages = 0;
    let mut teams = 0;
    let mut capacity = 0.;
    for e in &source.equipment {
        let p = catalog.equipment.iter().find(|p| p.id == e.part_id)?;
        if p.kind != "engine" || p.power_kw.unwrap_or(0.) <= 0. {
            continue;
        }
        let m = def.modules.iter().find(|m| m.id == e.id)?;
        let room = def
            .compartments
            .iter_mut()
            .find(|r| Some(&r.id) == m.compartment_id.as_ref())?;
        let pump = FIXED_PUMP_M3_PER_SECOND * rating(p.mass_kg.unwrap_or(0.));
        room.pump_m3_per_second += pump;
        capacity += pump;
        packages += 1;
        // Four people plus tools/spares are included in the declared service
        // allowance. A dry package with no allowance does not receive a crew.
        if p.service_mass_kg.unwrap_or(0.) >= 400. {
            teams += 1;
        }
    }
    if packages == 0 {
        return None;
    }
    let teams = teams.min(8);
    if teams > 0 {
        def.damage_control = DamageControlProfile {
            version: 1.,
            teams: teams as f64,
            setup_seconds: 4.,
            repair_points: teams as f64 * 40.,
            room_fuel_seconds: 0.,
            mount_fuel_seconds: 0.,
            suppression_per_second: 0.08,
            portable_pump_m3_per_second: 0.004,
            repair_hp_per_second: 0.5,
            repair_ceiling: 0.7,
            patch_m2_per_second: 0.0005,
            max_patch_m2: 0.03,
            flash_protection: 0.,
            basis: "Included machinery service allowance: one automatic four-person work party per package with at least 400 kg declared service load, maximum eight; finite spares, powered portable pumps, repair only surviving equipment to 70%; gameplay calibration, no additional mass".into(),
        };
    }
    Some(ConstructionDiagnostic {
        severity: "warning".into(),
        code: "auxiliary-services".into(),
        message: format!(
            "Auxiliaries reserve 2% rated power and provide {capacity:.4} m³/s fixed pumping with {teams} automatic work parties; engine health and shared exhaust capacity control service"
        ),
        source_id: None,
        ..Default::default()
    })
}

fn engine_rating(def: &ShipDefinition, engine: &Module) -> f64 {
    def.loading.as_ref().map_or(0., |l| {
        l.contributions
            .iter()
            .find(|c| c.id == engine.id && c.kind == "equipment")
            .map_or(0., |c| rating(c.mass_kg))
    })
}

/// Authoring relationships and service ratings do not change during battle.
/// Keep their module indices alongside the ship's other immutable lookups.
#[derive(Clone, Debug)]
pub(crate) struct Services {
    engines: Vec<ServiceEngine>,
}
#[derive(Clone, Debug)]
struct ServiceEngine {
    module: usize,
    rating: f64,
    exhaust: Vec<usize>,
}
impl Services {
    pub(crate) fn new(def: &ShipDefinition) -> Option<Self> {
        let source = def.construction.as_ref()?;
        let pool = def
            .propulsion
            .as_ref()
            .and_then(|p| p.shared_exhaust.as_ref());
        let engines: Vec<_> = def
            .modules
            .iter()
            .enumerate()
            .filter(|(_, m)| m.role.as_deref() == Some("combined-drive"))
            .filter(|(_, m)| {
                pool.is_none_or(|p| p.engines.iter().any(|e| e.id == m.id && e.kw > 0.))
            })
            .collect();
        Some(Self {
            engines: engines
                .iter()
                .map(|&(i, engine)| ServiceEngine {
                    module: i,
                    rating: engine_rating(def, engine),
                    exhaust: if pool.is_some() {
                        vec![]
                    } else {
                        def.modules
                            .iter()
                            .enumerate()
                            .filter(|(_, m)| m.role.as_deref() == Some("boiler"))
                            .filter(|(_, funnel)| {
                                source
                                    .equipment
                                    .iter()
                                    .find(|e| e.id == funnel.id)
                                    .is_some_and(|e| {
                                        e.power_source_id.as_deref() == Some(engine.id.as_str())
                                            || (e.power_source_id.is_none() && engines.len() == 1)
                                    })
                            })
                            .map(|(i, _)| i)
                            .collect()
                    },
                })
                .collect(),
        })
    }
    fn availability(
        &self,
        actor: &Combatant,
        def: &ShipDefinition,
        room: Option<&str>,
        sea: Option<(&SeaState, f64)>,
    ) -> f64 {
        // Rooms without a service engine have no supply. Check before evaluating
        // the shared exhaust pool, whose live state can require flood geometry.
        if !self.engines.iter().any(|engine| {
            room.is_none() || def.modules[engine.module].compartment_id.as_deref() == room
        }) {
            return 0.;
        }
        let shared = def
            .propulsion
            .as_ref()
            .and_then(|p| p.shared_exhaust.as_ref())
            .map(|pool| {
                (live_exhaust_fraction(actor, def, pool, sea) / AUXILIARY_POWER_SHARE).min(1.)
            });
        let mut total = 0.;
        let mut available = 0.;
        for engine in &self.engines {
            let m = &def.modules[engine.module];
            if room.is_some() && m.compartment_id.as_deref() != room {
                continue;
            }
            total += engine.rating;
            if let Some(service) = shared {
                available +=
                    engine.rating * equipment_condition(actor, def, m, sea).availability * service;
            } else if !engine.exhaust.is_empty() {
                let exhaust: f64 = engine
                    .exhaust
                    .iter()
                    .map(|&i| equipment_condition(actor, def, &def.modules[i], sea).availability)
                    .sum();
                available += engine.rating
                    * equipment_condition(actor, def, m, sea)
                        .availability
                        .min(exhaust / engine.exhaust.len() as f64);
            }
        }
        if total > 0. { available / total } else { 0. }
    }
}

/// Every running engine gets the same fraction of its available rated power.
pub(crate) fn exhaust_fraction(capacity: f64, demand: f64) -> f64 {
    if demand > 0. {
        (capacity / demand).clamp(0., 1.)
    } else {
        0.
    }
}

pub(crate) fn module_availability(
    actor: &Combatant,
    def: &ShipDefinition,
    id: &str,
    sea: Option<(&SeaState, f64)>,
) -> f64 {
    let module = match actor.index.of(def) {
        Some(ix) => ix.module(id).map(|i| &def.modules[i]),
        None => def.modules.iter().find(|m| m.id == id),
    };
    module.map_or(0., |m| equipment_condition(actor, def, m, sea).availability)
}

pub(crate) fn live_exhaust_fraction(
    actor: &Combatant,
    def: &ShipDefinition,
    pool: &SharedExhaust,
    sea: Option<(&SeaState, f64)>,
) -> f64 {
    #[cfg(test)]
    EXHAUST_EVALUATIONS.set(EXHAUST_EVALUATIONS.get() + 1);
    let capacity = pool
        .funnels
        .iter()
        .map(|f| f.kw * module_availability(actor, def, &f.id, sea))
        .sum();
    let demand = pool
        .engines
        .iter()
        .map(|e| e.kw * module_availability(actor, def, &e.id, sea))
        .sum();
    exhaust_fraction(capacity, demand)
}

/// Shared electrical bus, or the actual fixed pumps in one machinery room.
/// Propellers do not own auxiliary power; exhaust and engine immersion do.
pub(crate) fn availability(
    actor: &Combatant,
    def: &ShipDefinition,
    room: Option<&str>,
    sea: Option<(&SeaState, f64)>,
) -> f64 {
    if actor.damage.sunk {
        return 0.;
    }
    if let Some(services) = actor.index.of(def).and_then(|ix| ix.services.as_ref()) {
        return services.availability(actor, def, room, sea);
    }
    let Some(source) = &def.construction else {
        return 0.;
    };
    let pool = def
        .propulsion
        .as_ref()
        .and_then(|p| p.shared_exhaust.as_ref());
    let engines: Vec<_> = def
        .modules
        .iter()
        .filter(|m| m.role.as_deref() == Some("combined-drive"))
        .filter(|m| pool.is_none_or(|p| p.engines.iter().any(|e| e.id == m.id && e.kw > 0.)))
        .collect();
    if !engines
        .iter()
        .any(|engine| room.is_none() || engine.compartment_id.as_deref() == room)
    {
        return 0.;
    }
    let shared_service = pool
        .map(|pool| (live_exhaust_fraction(actor, def, pool, sea) / AUXILIARY_POWER_SHARE).min(1.));
    let mut total = 0.;
    let mut available = 0.;
    for engine in &engines {
        if room.is_some() && engine.compartment_id.as_deref() != room {
            continue;
        }
        let weight = engine_rating(def, engine);
        total += weight;
        if let Some(service) = shared_service {
            available +=
                weight * equipment_condition(actor, def, engine, sea).availability * service;
            continue;
        }
        // Compatibility with definitions compiled before shared exhaust ratings.
        let mut exhaust = 0.;
        let mut exhaust_count = 0;
        for funnel in def
            .modules
            .iter()
            .filter(|m| m.role.as_deref() == Some("boiler"))
        {
            let linked = source
                .equipment
                .iter()
                .find(|e| e.id == funnel.id)
                .is_some_and(|e| {
                    e.power_source_id.as_deref() == Some(engine.id.as_str())
                        || (e.power_source_id.is_none() && engines.len() == 1)
                });
            if linked {
                exhaust += equipment_condition(actor, def, funnel, sea).availability;
                exhaust_count += 1;
            }
        }
        if exhaust_count > 0 {
            available += weight
                * equipment_condition(actor, def, engine, sea)
                    .availability
                    .min(exhaust / exhaust_count as f64);
        }
    }
    if total > 0. { available / total } else { 0. }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_queries_skip_exhaust_for_rooms_without_engines() {
        let mut def: ShipDefinition =
            serde_json::from_str(include_str!("../../../public/models/valiant.json")).unwrap();
        let engine_room = def
            .modules
            .iter()
            .find(|m| m.role.as_deref() == Some("combined-drive"))
            .unwrap()
            .compartment_id
            .clone()
            .unwrap();
        let empty_room = def
            .compartments
            .iter()
            .find(|room| {
                !def.modules.iter().any(|m| {
                    m.role.as_deref() == Some("combined-drive")
                        && m.compartment_id.as_deref() == Some(room.id.as_str())
                })
            })
            .unwrap()
            .id
            .clone();
        for indexed in [true, false] {
            let mut actor = Combatant::new("services", &def);
            if !indexed {
                actor.index = Default::default();
            }
            for (room, calls) in [
                (None, 1),
                (Some(engine_room.as_str()), 1),
                (Some(empty_room.as_str()), 0),
                (Some("unknown"), 0),
            ] {
                EXHAUST_EVALUATIONS.set(0);
                let actual = availability(&actor, &def, room, None);
                assert_eq!(
                    EXHAUST_EVALUATIONS.get(),
                    calls,
                    "indexed={indexed}, room={room:?}"
                );
                if calls == 0 {
                    assert_eq!(actual.to_bits(), 0.0f64.to_bits());
                } else {
                    assert!(actual > 0.);
                }
            }
            actor.damage.sunk = true;
            EXHAUST_EVALUATIONS.set(0);
            assert_eq!(availability(&actor, &def, None, None), 0.);
            assert_eq!(EXHAUST_EVALUATIONS.get(), 0);
        }
        // A ship-wide query can also have no eligible engines.
        for module in &mut def.modules {
            if module.role.as_deref() == Some("combined-drive") {
                module.role = None;
            }
        }
        for indexed in [true, false] {
            let mut actor = Combatant::new("no-engines", &def);
            if !indexed {
                actor.index = Default::default();
            }
            EXHAUST_EVALUATIONS.set(0);
            assert_eq!(availability(&actor, &def, None, None), 0.);
            assert_eq!(EXHAUST_EVALUATIONS.get(), 0, "indexed={indexed}");
        }
    }
    // Compile real machinery into simple box rooms: this exercises the same
    // flood-water and immutable-index paths without Valiant's detailed cells.
    fn service_fixture() -> ShipDefinition {
        use crate::definition::{ConstructionEquipment, ConstructionSource};
        use serde_json::json;
        let catalog: ConstructionCatalog = serde_json::from_str(include_str!(
            "../../../public/models/components/catalog.json"
        ))
        .unwrap();
        let mut source: ConstructionSource = serde_json::from_value(json!({
            "schemaVersion": 1, "id": "services-test", "name": "Services test", "revision": "test",
            "coordinates": "meters-y-up-bow-negative-z",
            "construction": {
                "version": 2, "catalogRevision": catalog.revision, "defaultThicknessMm": 10,
                "primitives": [{ "id": "hull", "kind": "box", "position": [0,0,0], "size": [30,12,100], "rotationDeg": 0 }],
                "equipment": [], "surfaces": [],
                "boundaries": [
                    { "id": "center-wall", "axis": "x", "offset": 0, "thicknessMm": 10 },
                    { "id": "aft-wall", "axis": "z", "offset": 30, "thicknessMm": 10 }
                ],
                "loads": [{ "id": "outfit", "name": "Test load", "massKg": 8000000, "center": [3,-4,35], "size": [1,1,1] }]
            }
        })).unwrap();
        for (side, x, engine) in [
            ("port", -7.5, "generic-diesel-500kw"),
            ("starboard", 7.5, "generic-diesel-3000kw"),
        ] {
            for (kind, part_id, position) in [
                ("engine", engine, [x, -5.99, 0.]),
                ("funnel", "nelson-funnel", [x, 6., 0.]),
                ("screw", "generic-propeller-1200", [x, -5., 50.42]),
            ] {
                source.construction.equipment.push(ConstructionEquipment {
                    id: format!("{side}-{kind}"),
                    part_id: part_id.into(),
                    position,
                    power_source_id: (kind != "engine").then(|| format!("{side}-engine")),
                    ..Default::default()
                });
            }
        }
        // Include an armed mount so the capability comparison also exercises
        // magazine health and immersion, rather than only an unarmed hull.
        source.construction.equipment.push(ConstructionEquipment {
            id: "gun".into(),
            part_id: "us-20mm-oerlikon-mk4-hsienyang".into(),
            position: [-7.5, 6., -20.],
            ..Default::default()
        });
        let result = crate::construction::compile(&source, &catalog);
        let def = result
            .definition
            .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
        let services = Services::new(&def).unwrap();
        assert_eq!(services.engines.len(), 2);
        assert_ne!(services.engines[0].rating, services.engines[1].rating);
        assert_eq!(def.propulsion.as_ref().unwrap().groups.len(), 2);
        assert!(def.propulsion.as_ref().unwrap().shared_exhaust.is_some());
        assert!(def.stability.is_some());
        assert!(def.compartments.iter().all(|r| r.volumes.is_some()));
        assert!(def.compartments.iter().any(|r| {
            !services
                .engines
                .iter()
                .any(|e| def.modules[e.module].compartment_id.as_deref() == Some(r.id.as_str()))
        }));
        assert!(!def.mounts.is_empty());
        assert!(def.mounts[0].magazine_id.is_some());
        def
    }

    fn assert_matching_services(actor: &Combatant, def: &ShipDefinition) {
        let mut scanned = actor.clone();
        scanned.index = Default::default();
        for kind in ["engine", "generator", "steering"] {
            assert_eq!(
                crate::machinery::system_health(actor, def, kind, None).to_bits(),
                crate::machinery::system_health(&scanned, def, kind, None).to_bits(),
                "kind={kind}"
            );
        }
        for group in 0..def.propulsion.as_ref().unwrap().groups.len() {
            assert_eq!(
                crate::machinery::drive_health(actor, def, group, None).to_bits(),
                crate::machinery::drive_health(&scanned, def, group, None).to_bits(),
                "group={group}"
            );
        }
        let mut indexed_capability = actor.clone();
        let mut scanned_capability = scanned.clone();
        crate::capability::update(&mut indexed_capability, def, None);
        crate::capability::update(&mut scanned_capability, def, None);
        assert_eq!(
            serde_json::to_value(indexed_capability).unwrap(),
            serde_json::to_value(scanned_capability).unwrap()
        );
        for room in std::iter::once(None)
            .chain(def.compartments.iter().map(|c| Some(c.id.as_str())))
            .chain([Some("unknown")])
        {
            assert_eq!(
                availability(actor, def, room, None).to_bits(),
                availability(&scanned, def, room, None).to_bits(),
                "room={room:?}"
            );
        }
    }

    #[test]
    fn indexed_services_match_authoring_scans_as_machinery_floods_and_breaks() {
        use crate::machinery::EquipmentReason;
        let original = service_fixture();
        for shared in [false, true] {
            let mut def = original.clone();
            if !shared {
                // The fixture retains explicit per-engine funnel links for
                // definitions compiled before the shared exhaust pool.
                def.propulsion.as_mut().unwrap().shared_exhaust = None;
            }
            let mut actor = Combatant::new("services", &def);
            assert!(availability(&actor, &def, None, None) > 0.);
            assert_matching_services(&actor, &def);
            let mut conditions = vec![];
            for step in 0..5 {
                actor.motion.y = -(step as f64) * 2.;
                actor.motion.roll = step as f64 * 0.07;
                for (i, m) in actor.damage.modules.iter_mut().enumerate() {
                    m.hp = def.modules[i].hp * ((i + step) % 4) as f64 / 3.;
                }
                for (i, c) in actor.damage.compartments.iter_mut().enumerate() {
                    c.water_m3 = def.compartments[i].capacity_m3 * step as f64 / 4.;
                }
                actor.damage.sunk = step == 4;
                assert_matching_services(&actor, &def);
                conditions.extend(
                    def.modules
                        .iter()
                        .map(|m| equipment_condition(&actor, &def, m, None).reason),
                );
            }
            // Guard against a smaller fixture accidentally making a branch
            // vacuous: it must still encounter damage, destruction and water.
            for reason in [
                EquipmentReason::Damaged,
                EquipmentReason::Destroyed,
                EquipmentReason::Flooded,
            ] {
                assert!(
                    conditions.contains(&reason),
                    "shared={shared}, missing {reason:?}"
                );
            }
        }
    }

    #[test]
    fn published_valiant_services_match_authoring_scans() {
        let def: ShipDefinition =
            serde_json::from_str(include_str!("../../../public/models/valiant.json")).unwrap();
        let mut actor = Combatant::new("valiant", &def);
        assert_matching_services(&actor, &def);
        // Keep one real-geometry wet/damaged integration case; the small
        // fixture above owns the full damage/flooding/exhaust matrix.
        let engine = def
            .modules
            .iter()
            .position(|m| m.role.as_deref() == Some("combined-drive"))
            .unwrap();
        let room = def
            .compartments
            .iter()
            .position(|r| Some(&r.id) == def.modules[engine].compartment_id.as_ref())
            .unwrap();
        actor.damage.modules[engine].hp *= 0.5;
        actor.damage.compartments[room].water_m3 = def.compartments[room].capacity_m3 * 0.5;
        actor.motion.roll = 0.14;
        assert_matching_services(&actor, &def);
    }
}

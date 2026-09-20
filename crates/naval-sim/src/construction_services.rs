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

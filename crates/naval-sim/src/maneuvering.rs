//! Bounded planar force model. Geometry is reduced once, never clipped per tick.
//! Coefficients are provisional game hydrodynamics, not a performance certificate.
use crate::{
    construction_geometry as cg,
    damage::Combatant,
    definition::*,
    geometry::*,
    machinery::{equipment_condition, system_health},
    motion::{HelmCommand, SeaHandling},
    rules::DT,
};
const RHO: f64 = 1025.;
const STRIPS: usize = 12;

#[derive(Clone, Debug)]
pub struct Resistance {
    pub length: f64,
    pub beam: f64,
    pub draft: f64,
    pub wetted_area: f64,
    pub fullness: f64,
    pub frontal_area: f64,
    pub strips: Vec<(f64, f64)>, // local Z, projected lateral area
}
impl Resistance {
    pub fn new(def: &ShipDefinition) -> Self {
        let h = &def.hull;
        let waterline = def.loading.as_ref().map_or(0., |l| l.waterline_y);
        let mut result = Self {
            length: h.length.max(0.1),
            beam: h.beam.max(0.1),
            draft: (h.draft + waterline).max(0.1),
            wetted_area: 0.,
            fullness: 0.6,
            frontal_area: 0.,
            strips: Vec::with_capacity(STRIPS),
        };
        let mut areas = [0.; STRIPS];
        let mut zs = [0.; STRIPS];
        let mut volume = def.hull.mass_kg / RHO;
        if let Some(v) = &h.volume {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            // Construction surfaces are the exposed union boundary, not internal cell faces.
            for s in &v.surfaces {
                for p in cg::clip_polygon(&s.vertices, [0., 1., 0.], waterline) {
                    for i in 0..3 {
                        low[i] = low[i].min(p[i]);
                        high[i] = high[i].max(p[i]);
                    }
                }
            }
            if low[2].is_finite() {
                result.length = (high[2] - low[2]).max(0.1);
                result.beam = (high[0] - low[0]).max(0.1);
                result.draft = (high[1] - low[1]).max(0.1);
                for s in &v.surfaces {
                    let wet = cg::clip_polygon(&s.vertices, [0., 1., 0.], waterline);
                    let area = cg::area(&wet);
                    result.wetted_area += area;
                    // Cubed normal projection distinguishes a blunt face from a fine entry.
                    result.frontal_area += area * s.normal[2].abs().powi(3) * 0.5;
                    if s.normal[0].abs() < 1e-6 {
                        continue;
                    }
                    for i in 0..STRIPS {
                        let start = low[2] + result.length * i as f64 / STRIPS as f64;
                        let end = low[2] + result.length * (i + 1) as f64 / STRIPS as f64;
                        let clipped = cg::clip_polygon(
                            &cg::clip_polygon(&wet, [0., 0., -1.], -start),
                            [0., 0., 1.],
                            end,
                        );
                        areas[i] += cg::area(&clipped) * s.normal[0].abs() * 0.5;
                        zs[i] = (start + end) * 0.5;
                    }
                }
            }
        } else if !h.half_breadths.is_empty()
            && !h.keel_heights.is_empty()
            && !h.deck_heights.is_empty()
        {
            volume = 0.;
            let mut last_area = 0.;
            let mut last_width = 0.;
            let dz = result.length / STRIPS as f64;
            for i in 0..STRIPS {
                let station = (i as f64 + 0.5) * dz;
                let points: Vec<Vec3> = crate::hull::hull_section(h, station)
                    .iter()
                    .map(|p| [p[0], p[1], 0.])
                    .collect();
                let wet = cg::clip_polygon(&points, [0., 1., 0.], waterline);
                let area = cg::area(&wet);
                let width = wet.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max)
                    - wet.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
                let depth = waterline - wet.iter().map(|p| p[1]).fold(waterline, f64::min);
                for (a, b) in wet.iter().zip(wet.iter().cycle().skip(1)).take(wet.len()) {
                    if a[1] < waterline - 1e-6 || b[1] < waterline - 1e-6 {
                        result.wetted_area += length(sub(*a, *b)) * dz;
                    }
                }
                let width = width.max(0.);
                let slope = ((width - last_width) / dz).abs().min(1.);
                result.frontal_area += (area - last_area).abs() * slope.powi(2) * 0.5;
                last_area = area;
                last_width = width;
                volume += area * dz;
                areas[i] = depth * dz;
                zs[i] = h.length * 0.5 - station;
            }
            result.frontal_area += last_area * (last_width / dz).min(1.).powi(2) * 0.5;
        }
        result.wetted_area = result.wetted_area.max(1.);
        result.fullness = (volume / (result.length * result.beam * result.draft)).clamp(0.1, 1.);
        result.strips = zs.into_iter().zip(areas).filter(|(_, a)| *a > 0.).collect();
        result
    }
    /// R(v) = k(v) v |v|. Skin/form drag plus a smooth Froude-dependent wave term.
    pub fn coefficient(&self, speed: f64) -> f64 {
        let froude = speed.abs() / (9.81 * self.length).sqrt();
        let wave = 0.03
            * self.fullness.powi(2)
            * (self.beam / self.length).sqrt()
            * (froude / 0.4).powi(4).min(25.);
        0.5 * RHO
            * (self.wetted_area * (0.004 * (1. + self.fullness.powi(2)) + wave)
                + 0.18 * self.frontal_area)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MassProperties {
    pub mass: f64,
    pub center: Vec3,
    pub yaw_inertia: f64,
}
impl MassProperties {
    pub fn dry(d: &ShipDefinition) -> Self {
        let mass = d.hull.mass_kg.max(1.);
        Self {
            mass,
            center: d
                .loading
                .as_ref()
                .map(|l| l.center_of_gravity)
                .or_else(|| d.stability.as_ref().map(|s| s.dry_center_of_gravity))
                .unwrap_or([0.; 3]),
            yaw_inertia: d
                .loading
                .as_ref()
                .map_or(
                    mass * (d.hull.length.powi(2) + d.hull.beam.powi(2)) / 12.,
                    |l| l.inertia_kg_m2[1],
                )
                .max(1.),
        }
    }
    /// Reuses already refreshed floodwater moments at the hydrostatic cadence.
    pub fn flooded(d: &ShipDefinition, water: &[crate::floodwater::WaterBody]) -> Self {
        let dry = Self::dry(d);
        let mass = dry.mass + RHO * water.iter().map(|w| w.volume).sum::<f64>();
        let center = scale(
            water.iter().fold(scale(dry.center, dry.mass), |a, w| {
                add(a, scale(w.center, RHO * w.volume))
            }),
            1. / mass,
        );
        let delta = sub(dry.center, center);
        let yaw_inertia = dry.yaw_inertia
            + dry.mass * (delta[0].powi(2) + delta[2].powi(2))
            + RHO * water.iter().map(|w| w.inertia_m3(center)[1]).sum::<f64>();
        Self {
            mass,
            center,
            yaw_inertia,
        }
    }
}
#[derive(Clone, Debug)]
struct Propeller {
    module: Option<usize>,
    position: Vec3,
    bearing: f64,
    area: f64,
    feeds: Vec<(usize, f64)>,
}
#[derive(Clone, Debug)]
struct Rudder {
    module: Option<usize>,
    position: Vec3,
    bearing: f64,
    area: f64,
    wash: Vec<(usize, f64, f64)>,
}
#[derive(Clone, Debug)]
pub struct Maneuvering {
    pub resistance: Resistance,
    propellers: Vec<Propeller>,
    rudders: Vec<Rudder>,
    pub power_w: f64,
    drag_scale: f64,
    reverse_power: f64,
    reverse_advance: f64,
    fallback_drive: bool,
    pub estimated_speed: f64,
    power_curve: [f64; 33],
}

impl Maneuvering {
    pub fn new(d: &ShipDefinition) -> Self {
        let resistance = Resistance::new(d);
        let mass = MassProperties::dry(d);
        let constructed = d.loading.is_some() && d.hull.volume.is_some();
        let mut result = Self {
            resistance,
            propellers: vec![],
            rudders: vec![],
            power_w: 0.,
            drag_scale: 1.,
            reverse_power: 0.5,
            reverse_advance: f64::INFINITY,
            fallback_drive: false,
            estimated_speed: 0.,
            power_curve: [0.; 33],
        };
        let module = |id: &str| d.modules.iter().position(|m| m.id == id);
        if let Some(p) = &d.maneuvering {
            for prop in &p.propellers {
                if let Some(i) = module(&prop.module_id) {
                    result.propellers.push(Propeller {
                        module: Some(i),
                        position: d.modules[i].center,
                        bearing: prop.bearing_deg.to_radians(),
                        area: std::f64::consts::PI * prop.diameter_m.powi(2) / 4.,
                        feeds: vec![],
                    });
                }
            }
            for rudder in &p.rudders {
                if let Some(i) = module(&rudder.module_id) {
                    result.rudders.push(Rudder {
                        module: Some(i),
                        position: d.modules[i].center,
                        bearing: rudder.bearing_deg.to_radians(),
                        area: rudder.area_m2,
                        wash: vec![],
                    });
                }
            }
        } else {
            for (i, m) in d.modules.iter().enumerate() {
                if m.role.as_deref() == Some("shaft") {
                    // Older shaft modules include shaft runs; diameter comes from transverse extent.
                    result.propellers.push(Propeller {
                        module: Some(i),
                        position: m.center,
                        bearing: 0.,
                        area: std::f64::consts::PI * m.size[0].max(m.size[1]).powi(2) / 4.,
                        feeds: vec![],
                    });
                } else if m.kind == "steering" {
                    result.rudders.push(Rudder {
                        module: Some(i),
                        position: m.center,
                        bearing: 0.,
                        area: (m.size[1] * m.size[2]).max(0.1),
                        wash: vec![],
                    });
                }
            }
            // Missing appendage geometry on legacy content has explicit conservative virtual fittings.
            if result.propellers.is_empty() && !constructed {
                result.propellers.push(Propeller {
                    module: None,
                    position: [0., -d.hull.draft * 0.6, d.hull.length * 0.4],
                    bearing: 0.,
                    area: (d.hull.beam * 0.2).powi(2).max(0.1),
                    feeds: vec![],
                });
            }
            if result.rudders.is_empty() && !constructed {
                result.rudders.push(Rudder {
                    module: None,
                    position: [0., -d.hull.draft * 0.6, d.hull.length * 0.46],
                    bearing: 0.,
                    area: d.hull.length * d.hull.draft * 0.012,
                    wash: vec![],
                });
            }
        }
        if !constructed && d.maneuvering.is_none() {
            // A steering-room envelope is not a rudder blade. Infer its effective
            // area from the legacy maneuvering calibration, distributing it among
            // the retained steering modules. Explicit fittings never receive this adjustment.
            let area = result.rudders.iter().map(|r| r.area).sum::<f64>();
            let reference = mass.mass * d.handling.max_yaw_rate * crate::mobility::MAX_YAW_RATE
                / (RHO
                    * d.handling.forward_speed.max(0.1)
                    * 35_f64.to_radians().sin()
                    * 35_f64.to_radians().cos());
            let factor = (reference * 1.5 / area.max(0.01)).max(1.);
            for r in &mut result.rudders {
                r.area *= factor;
            }
        }
        result.power_w = if constructed {
            d.loading.as_ref().unwrap().power_kw * 1000.
        } else {
            // Infer installed effective power from authored acceleration and speed. This calibrates
            // old presets once; neither speed nor yaw is driven toward an authored target at runtime.
            let v = d.handling.forward_speed.max(0.1);
            mass.mass * d.handling.acceleration * crate::mobility::ACCELERATION * v * 1.5
        };
        for prop in &mut result.propellers {
            if let Some(groups) = d.propulsion.as_ref().map(|p| &p.groups) {
                for (i, g) in groups.iter().enumerate() {
                    if prop
                        .module
                        .is_some_and(|mi| g.shaft_ids.contains(&d.modules[mi].id))
                    {
                        prop.feeds
                            .push((i, g.share / g.shaft_ids.len().max(1) as f64));
                    }
                }
            }
        }
        result.fallback_drive =
            !constructed && result.propellers.iter().all(|p| p.feeds.is_empty());
        for rudder in &mut result.rudders {
            for (i, prop) in result.propellers.iter().enumerate() {
                let delta = sub(rudder.position, prop.position);
                let (s, c) = prop.bearing.sin_cos();
                let aft = delta[2] * c - delta[0] * s;
                let side = delta[0] * c + delta[2] * s;
                let diameter = (4. * prop.area / std::f64::consts::PI).sqrt();
                let radius = diameter * 0.5 + aft.abs() * 0.08;
                let weight = (1. - (side.hypot(delta[1]) / radius).powi(2)).max(0.)
                    * (1. - aft.abs() / (diameter * 6.).max(1.)).max(0.);
                if weight > 0. {
                    rudder.wash.push((
                        i,
                        if aft > 0. { weight } else { 0. },
                        if aft < 0. { weight } else { 0. },
                    ));
                }
            }
        }
        if !constructed {
            let v = d.handling.forward_speed.max(0.1);
            let thrust: f64 = result
                .propellers
                .iter()
                .map(|p| thrust(result.power_w * result.share(p), v, p.area))
                .sum();
            result.drag_scale = thrust / (result.resistance.coefficient(v) * v * v).max(1.);
            let vr = d.handling.reverse_speed.max(0.);
            // Older presets declare astern speed, not a propeller advance curve. Preserve
            // that calibration with declining astern efficiency, without making crash-back
            // thrust vanish while the ship is still moving ahead.
            let target = result.resistance.coefficient(vr) * result.drag_scale * vr * vr;
            let ratio = result.straight_thrust(vr, result.reverse_power) / target.max(1e-9);
            result.reverse_advance = if ratio > 1. {
                vr / (ratio - 1.).sqrt()
            } else {
                f64::INFINITY
            };
        }
        let (mut lo, mut hi) = (0., 100.);
        for _ in 0..48 {
            let v = (lo + hi) * 0.5;
            if result.straight_thrust(v, 1.)
                > result.resistance.coefficient(v) * result.drag_scale * v * v
            {
                lo = v;
            } else {
                hi = v;
            }
        }
        result.estimated_speed = if result.straight_thrust(0., 1.) > 1e-6 {
            (lo + hi) * 0.5
        } else {
            0.
        };
        for i in 1..33 {
            let v = result.estimated_speed * i as f64 / 32.;
            let drag = result.resistance.coefficient(v) * result.drag_scale * v * v;
            let (mut lo, mut hi) = (0., 1.);
            for _ in 0..24 {
                let mid = (lo + hi) * 0.5;
                if result.straight_thrust(v, mid) < drag {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            result.power_curve[i] = (lo + hi) * 0.5;
        }
        result
    }
    /// Engine order for a desired steady speed, interpolated from the compiled resistance curve.
    pub fn throttle_for_speed(&self, speed: f64, available: f64, mass_ratio: f64) -> f64 {
        if self.estimated_speed <= 0. || available <= 0. {
            return 0.;
        }
        let at = (speed / self.estimated_speed * 32.).clamp(0., 32.);
        let i = (at.floor() as usize).min(31);
        let power =
            self.power_curve[i] + (self.power_curve[i + 1] - self.power_curve[i]) * (at - i as f64);
        (power * mass_ratio.max(0.1).powf(2. / 3.) / available)
            .cbrt()
            .clamp(0., 1.)
    }
    pub fn available_speed(&self, available: f64, mass_ratio: f64) -> f64 {
        let power = available / mass_ratio.max(0.1).powf(2. / 3.);
        for i in 1..33 {
            if self.power_curve[i] >= power {
                let fraction = ((power - self.power_curve[i - 1])
                    / (self.power_curve[i] - self.power_curve[i - 1]).max(1e-12))
                .clamp(0., 1.);
                return self.estimated_speed * (i as f64 - 1. + fraction) / 32.;
            }
        }
        self.estimated_speed
    }
    pub fn estimated_handling(&self, d: &ShipDefinition) -> Handling {
        let v = self.estimated_speed;
        let m = MassProperties::dry(d);
        let angle = 35_f64.to_radians();
        let torque = self
            .rudders
            .iter()
            .map(|r| {
                RHO * r.area * v * v * angle.sin() * angle.cos() * (r.position[2] - m.center[2])
            })
            .sum::<f64>();
        let damping = self
            .resistance
            .strips
            .iter()
            .map(|(z, a)| 0.5 * RHO * v * a * (z - m.center[2]).powi(2))
            .sum::<f64>()
            + self
                .rudders
                .iter()
                .map(|r| {
                    RHO * v * r.area * angle.cos().powi(2) * (r.position[2] - m.center[2]).powi(2)
                })
                .sum::<f64>();
        let (mut lo, mut hi) = (0., v);
        for _ in 0..40 {
            let mid = (lo + hi) * 0.5;
            if self.straight_thrust(mid, self.reverse_power) * self.reverse_efficiency(-mid)
                > self.resistance.coefficient(mid) * self.drag_scale * mid * mid
            {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        Handling {
            forward_speed: v,
            reverse_speed: if v > 0. { (lo + hi) * 0.5 } else { 0. },
            acceleration: self.straight_thrust(0., 1.).max(0.) / m.mass,
            braking: (self.straight_thrust(v, self.reverse_power)
                + self.resistance.coefficient(v) * self.drag_scale * v * v)
                .max(0.)
                / m.mass,
            rudder_rate: d.handling.rudder_rate,
            max_yaw_rate: (torque / damping.max(1.)).abs(),
        }
    }
    fn reverse_efficiency(&self, axial: f64) -> f64 {
        1. / (1. + (axial.min(0.) / self.reverse_advance.max(0.01)).powi(2))
    }
    pub fn stopping_distance(&self, speed: f64, available: f64, mass: f64) -> f64 {
        let dv = speed.abs() / 32.;
        (0..32)
            .map(|i| {
                let v = (i as f64 + 0.5) * dv;
                v / self.braking_acceleration(v, available, mass).max(0.001) * dv
            })
            .sum()
    }
    pub fn braking_acceleration(&self, speed: f64, available: f64, mass: f64) -> f64 {
        (self.straight_thrust(speed, self.reverse_power * available)
            + self.resistance.coefficient(speed) * self.drag_scale * speed * speed)
            / mass.max(1.)
    }
    fn share(&self, p: &Propeller) -> f64 {
        if p.feeds.is_empty() {
            if self.fallback_drive {
                1. / self.propellers.len().max(1) as f64
            } else {
                0.
            }
        } else {
            p.feeds.iter().map(|(_, s)| s).sum()
        }
    }
    fn straight_thrust(&self, v: f64, power_fraction: f64) -> f64 {
        self.propellers
            .iter()
            .map(|p| {
                let alignment = p.bearing.cos();
                thrust(
                    self.power_w * self.share(p) * power_fraction,
                    v * alignment,
                    p.area,
                ) * alignment
            })
            .sum()
    }
}
fn thrust(power: f64, axial_speed: f64, area: f64) -> f64 {
    if power <= 0. {
        return 0.;
    }
    let induced = (power / (RHO * area.max(0.01))).cbrt();
    power / (axial_speed.abs().hypot(induced)).max(0.1)
}

/// Reject malformed optional physical profiles at both published and construction admission.
pub fn validate(d: &ShipDefinition) -> Result<(), String> {
    if d.propulsion.as_ref().is_some_and(|p| p.groups.len() > 128)
        || d.modules
            .iter()
            .filter(|m| m.role.as_deref() == Some("shaft") || m.kind == "steering")
            .count()
            > 128
    {
        return Err("Too many maneuvering systems".into());
    }
    let Some(p) = &d.maneuvering else {
        return Ok(());
    };
    if p.version != 1. || p.propellers.len() > 128 || p.rudders.len() > 128 {
        return Err("Invalid maneuvering profile".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for (id, bearing, dimension, propeller) in p
        .propellers
        .iter()
        .map(|p| (&p.module_id, p.bearing_deg, p.diameter_m, true))
        .chain(
            p.rudders
                .iter()
                .map(|r| (&r.module_id, r.bearing_deg, r.area_m2, false)),
        )
    {
        if !ids.insert(id)
            || !bearing.is_finite()
            || bearing.abs() > 360.
            || !dimension.is_finite()
            || dimension <= 0.
            || dimension > 10000.
            || !d.modules.iter().any(|m| {
                &m.id == id
                    && if propeller {
                        m.role.as_deref() == Some("shaft")
                    } else {
                        m.kind == "steering"
                    }
            })
        {
            return Err("Invalid maneuvering appendage".into());
        }
    }
    Ok(())
}

/// Apply a force impulse at a local position. Body axes are starboard and forward;
/// heading/yaw are clockwise, so a starboard propeller produces port yaw.
fn impulse(s: &mut crate::motion::ShipState, m: MassProperties, p: Vec3, fx: f64, forward: f64) {
    let r = sub(p, m.center);
    s.sway_speed += fx / m.mass;
    s.speed += forward / m.mass;
    s.yaw_rate += (-r[2] * fx - r[0] * forward) / m.yaw_inertia;
}
fn normal_drag(
    s: &mut crate::motion::ShipState,
    m: MassProperties,
    p: Vec3,
    n: [f64; 2],
    k: f64,
    flow: [f64; 2],
    lift: bool,
) {
    let r = sub(p, m.center);
    let velocity = [
        s.sway_speed - s.yaw_rate * r[2] + flow[0],
        s.speed - s.yaw_rate * r[0] + flow[1],
    ];
    let normal = velocity[0] * n[0] + velocity[1] * n[1];
    let lever = -r[2] * n[0] - r[0] * n[1];
    let inverse_mass = 1. / m.mass + lever * lever / m.yaw_inertia;
    let damping = k * if lift {
        velocity[0].hypot(velocity[1])
    } else {
        normal.abs()
    };
    // Implicit scalar drag cannot reverse the local normal velocity in one step.
    let j = -normal * damping * DT / (1. + damping * DT * inverse_mass);
    impulse(s, m, p, n[0] * j, n[1] * j);
}

/// Legacy presets without a stability profile still carry floodwater. Their rooms
/// use the existing box approximation; sample it at the same half-second cadence.
fn legacy_loading(actor: &Combatant, d: &ShipDefinition) -> MassProperties {
    let dry = MassProperties::dry(d);
    let body = |i: usize| {
        let room = &d.compartments[i];
        let volume = actor.damage.compartments[i]
            .water_m3
            .clamp(0., room.capacity_m3);
        let height = room.size[1] * volume / room.capacity_m3.max(1e-9);
        let center = [
            room.center[0],
            room.center[1] - (room.size[1] - height) * 0.5,
            room.center[2],
        ];
        (
            volume * RHO,
            center,
            (room.size[0].powi(2) + room.size[2].powi(2)) / 12.,
        )
    };
    let (mass, first) = (0..d.compartments.len()).fold(
        (dry.mass, scale(dry.center, dry.mass)),
        |(mass, first), i| {
            let (kg, center, _) = body(i);
            (mass + kg, add(first, scale(center, kg)))
        },
    );
    let center = scale(first, 1. / mass);
    let delta = sub(dry.center, center);
    let yaw_inertia = dry.yaw_inertia
        + dry.mass * (delta[0].powi(2) + delta[2].powi(2))
        + (0..d.compartments.len())
            .map(|i| {
                let (kg, p, intrinsic) = body(i);
                kg * (intrinsic + (p[0] - center[0]).powi(2) + (p[2] - center[2]).powi(2))
            })
            .sum::<f64>();
    MassProperties {
        mass,
        center,
        yaw_inertia,
    }
}

pub fn step(
    actor: &mut Combatant,
    d: &ShipDefinition,
    model: &Maneuvering,
    c: HelmCommand,
    sea: Option<SeaHandling>,
) {
    if d.stability.is_none() && !d.compartments.is_empty() && actor.motion.tick.is_multiple_of(30) {
        actor.motion_mass = legacy_loading(actor, d);
    }
    let h = d
        .submarine
        .as_ref()
        .filter(|_| actor.motion.depth() > 0.5)
        .map_or(&d.handling, |s| &s.submerged_handling);
    let throttle = if c.throttle.is_finite() {
        c.throttle.clamp(-1., 1.)
    } else {
        0.
    };
    let order = if c.rudder.is_finite() {
        c.rudder.clamp(-1., 1.)
    } else {
        0.
    };
    let m = actor.motion_mass;
    let global_power = if model.fallback_drive {
        system_health(actor, d, "engine", None)
    } else {
        0.
    };
    let global_steering = system_health(actor, d, "steering", None);
    let availability = |i: Option<usize>| {
        i.map_or(1., |i| {
            equipment_condition(actor, d, &d.modules[i], None).availability
        })
    };
    // Fixed bounded stack buffers avoid per-vessel per-tick allocation.
    let mut prop_power = [0.; 128];
    let mut rudder_health = [0.; 128];
    let mut groups = [0.; 128];
    if let Some(p) = &d.propulsion {
        for (i, _) in p.groups.iter().enumerate().take(128) {
            groups[i] = crate::machinery::drive_health(actor, d, i, None);
        }
    }
    for (i, p) in model.propellers.iter().enumerate() {
        let power = if p.feeds.is_empty() {
            model.share(p) * global_power
        } else {
            p.feeds.iter().map(|(g, share)| groups[*g] * share).sum()
        };
        prop_power[i] = power * availability(p.module);
    }
    for (i, r) in model.rudders.iter().enumerate() {
        rudder_health[i] = if r.module.is_some() {
            availability(r.module)
        } else {
            global_steering
        };
    }
    let s = &mut actor.motion;
    let target = order;
    let rudder_step = h.rudder_rate * crate::mobility::RUDDER_RATE * DT;
    s.rudder += (target - s.rudder).clamp(-rudder_step, rudder_step);
    let mut jets = [0.; 128];
    let reverse = if throttle < 0. {
        model.reverse_power
    } else {
        1.
    };
    let submerged_scale = if d.submarine.is_some() && s.depth() > 0.5 {
        (h.forward_speed / d.handling.forward_speed.max(0.1)).powi(3)
    } else {
        1.
    };
    let before_thrust = (s.speed, s.sway_speed, s.yaw_rate);
    for (i, p) in model.propellers.iter().enumerate() {
        let (sin, cos) = p.bearing.sin_cos();
        let r = sub(p.position, m.center);
        let axial = (before_thrust.1 - before_thrust.2 * r[2]) * sin
            + (before_thrust.0 - before_thrust.2 * r[0]) * cos;
        let power =
            model.power_w * prop_power[i] * throttle.abs().powi(3) * reverse * submerged_scale;
        let force = thrust(power, axial, p.area)
            * throttle.signum()
            * if throttle < 0. {
                model.reverse_efficiency(axial)
            } else {
                1.
            };
        impulse(s, m, p.position, force * sin * DT, force * cos * DT);
        jets[i] = force;
    }
    let load_scale = (m.mass / d.hull.mass_kg.max(1.)).max(0.1).powf(2. / 3.);
    let wave_scale = 1. / (1. - sea.map_or(0., |e| e.resistance).clamp(0., 0.8)).powi(3);
    let k = model.resistance.coefficient(s.speed) * model.drag_scale * load_scale * wave_scale;
    // Centered surge drag; no target speed, acceleration clamp, or artificial turn penalty.
    s.speed /= 1. + k * s.speed.abs() * DT / m.mass;
    for &(z, area) in &model.resistance.strips {
        normal_drag(
            s,
            m,
            [m.center[0], m.center[1], z],
            [1., 0.],
            0.5 * RHO * area * load_scale,
            [0., 0.],
            false,
        );
    }
    for (i, r) in model.rudders.iter().enumerate() {
        let mut flow = [0.; 2];
        for &(pi, ahead, astern) in &r.wash {
            let force = jets[pi];
            let p = &model.propellers[pi];
            let weight = if force >= 0. { ahead } else { astern };
            let jet = (2. * force.abs() / (RHO * p.area)).sqrt() * weight * force.signum();
            // Add only the wash excess, not ship speed a second time.
            let excess = s.speed.abs().hypot(jet) - s.speed.abs();
            flow[0] += p.bearing.sin() * excess * force.signum();
            flow[1] += p.bearing.cos() * excess * force.signum();
        }
        let angle = s.rudder * 35_f64.to_radians() - r.bearing;
        normal_drag(
            s,
            m,
            r.position,
            [angle.cos(), angle.sin()],
            RHO * r.area * rudder_health[i],
            flow,
            true,
        );
    }
    let old = s.heading;
    let dh = s.yaw_rate * DT;
    let (sin, cos) = dh.sin_cos();
    let u = s.speed * cos + s.sway_speed * sin;
    s.sway_speed = s.sway_speed * cos - s.speed * sin;
    s.speed = u;
    s.heading = (old + dh).rem_euclid(std::f64::consts::TAU);
    if let Some(e) = sea {
        let blend = 1. - (-DT / 20.).exp();
        s.drift_x += (e.drift[0] - s.drift_x) * blend;
        s.drift_z += (e.drift[1] - s.drift_z) * blend;
    }
    let v = s.velocity();
    // Rotate about the loaded CG while retaining the model's authored origin.
    let offset = |h: f64| {
        [
            h.cos() * m.center[0] - h.sin() * m.center[2],
            h.sin() * m.center[0] + h.cos() * m.center[2],
        ]
    };
    let before = offset(old);
    let after = offset(s.heading);
    s.x += v[0] * DT + before[0] - after[0];
    s.z += v[2] * DT + before[1] - after[1];
    s.distance += s.speed.hypot(s.sway_speed) * DT;
    s.tick += 1;
}

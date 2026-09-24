use crate::{
    definition::Hull,
    geometry::{Pose, clamp, local_to_world, wrap_angle},
    motion::{HelmCommand, SeaHandling, ShipState},
    terrain::Terrain,
    vessel::Vessel,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeaState {
    pub amplitude_m: f64,
    pub wavelength_m: f64,
    /// Radians: the waves run, and the wind and drift push, toward (cos d, sin d)
    /// in x and z, so 0 runs toward +x and pi/2 toward +z. Not a heading's frame
    /// (see `battle::Spawn::heading`): for a ship on heading h, d = h + pi/2 is a
    /// head sea, d = h - pi/2 a following sea, d = h a beam sea from port and
    /// d = h + pi one from starboard. Content gives it in degrees, as the map's
    /// `water.windDirection`.
    pub direction: f64,
    pub wind_mps: f64,
    pub phase: f64,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct SeaResponse {
    pub heave: f64,
    pub roll: f64,
    pub pitch: f64,
}
/// The wave-number, direction and angular frequency of one component. They
/// depend only on the sea state, so a sampler hoists them out of the sample
/// loop; the surviving expression is the original one, operand for operand.
#[derive(Clone, Copy, Debug)]
pub struct Wave {
    k: f64,
    cos: f64,
    sin: f64,
    omega: f64,
    phase: f64,
}
impl Wave {
    fn new(direction: f64, wavelength: f64, phase: f64) -> Self {
        let k = std::f64::consts::TAU / wavelength;
        Self {
            k,
            cos: direction.cos(),
            sin: direction.sin(),
            omega: (9.81 * k).sqrt(),
            phase,
        }
    }
    fn sample(&self, x: f64, z: f64, time: f64) -> f64 {
        (self.k * (x * self.cos + z * self.sin) - self.omega * time + self.phase).sin()
    }
    /// How much of this component's surface pressure remains `depth` below it.
    fn felt_at(&self, depth: f64) -> f64 {
        (-self.k * depth).exp()
    }
}
/// Where, as a fraction of draft, the wave pressure that heels a hull acts: about
/// the centre of its underwater body. Wave pressure fades with depth, faster for
/// shorter waves, so a deep hull feels a gentler slope than the surface shows
/// (the Smith effect) and a battleship rolls less than a destroyer in one sea.
pub const ROLL_PRESSURE_DEPTH: f64 = 0.5;
/// Both components of a sea state, resolved once for many samples.
#[derive(Clone, Copy, Debug)]
pub struct Waves([Wave; 2]);
impl SeaState {
    pub fn waves(&self) -> Waves {
        Waves([
            Wave::new(self.direction, self.wavelength_m, self.phase),
            Wave::new(
                self.direction + 0.8,
                self.wavelength_m * 0.57,
                self.phase + 2.0,
            ),
        ])
    }
    pub fn height(&self, x: f64, z: f64, time: f64) -> f64 {
        if self.amplitude_m == 0.0 {
            return 0.0;
        }
        self.height_at(&self.waves(), x, z, time)
    }
    pub fn height_at(&self, waves: &Waves, x: f64, z: f64, time: f64) -> f64 {
        if self.amplitude_m == 0.0 {
            return 0.0;
        }
        self.amplitude_m
            * (0.7 * waves.0[0].sample(x, z, time) + 0.3 * waves.0[1].sample(x, z, time))
    }
    pub fn response(&self, h: &Hull, p: &ShipState, submarine: bool, time: f64) -> SeaResponse {
        let attenuation = (-(if submarine { p.depth() } else { 0.0 }) / 8.0).exp();
        let waves = self.waves();
        let world = |x: f64, z: f64| {
            local_to_world(
                [x, 0.0, z],
                Pose {
                    x: p.x,
                    z: p.z,
                    heading: p.heading,
                    ..Pose::default()
                },
            )
        };
        let at = |x: f64, z: f64| {
            let point = world(x, z);
            self.height_at(&waves, point[0], point[2], time) * attenuation
        };
        let depth = h.draft * ROLL_PRESSURE_DEPTH;
        let felt = |x: f64| {
            if self.amplitude_m == 0.0 {
                return 0.0;
            }
            let point = world(x, 0.0);
            self.amplitude_m
                * (0.7 * waves.0[0].sample(point[0], point[2], time) * waves.0[0].felt_at(depth)
                    + 0.3 * waves.0[1].sample(point[0], point[2], time) * waves.0[1].felt_at(depth))
                * attenuation
        };
        let mut heave = 0.0;
        for z in [-0.4, -0.2, 0.0, 0.2, 0.4] {
            for x in [-0.3, 0.3] {
                heave += at(x * h.beam, z * h.length) / 10.0;
            }
        }
        SeaResponse {
            heave,
            roll: clamp(
                (felt(h.beam * 0.4) - felt(-h.beam * 0.4)) / (h.beam * 0.8),
                -0.18,
                0.18,
            ) + clamp(p.speed * p.yaw_rate / 9.81 * 0.3, -0.06, 0.06),
            pitch: clamp(
                (at(0.0, -h.length * 0.4) - at(0.0, h.length * 0.4)) / (h.length * 0.8),
                -0.08,
                0.08,
            ),
        }
    }
    pub fn handling(&self, h: &Hull, p: &ShipState, submarine: bool) -> SeaHandling {
        let submerged = submarine && p.depth() > 0.5;
        let encounter = (1.0 - (p.heading - self.direction).sin()) / 2.0;
        SeaHandling {
            resistance: if submerged {
                0.0
            } else {
                clamp(
                    self.amplitude_m / h.length.sqrt() * (0.7 + 2.3 * encounter),
                    0.0,
                    0.35,
                )
            },
            drift: if submerged {
                [0.0; 2]
            } else {
                [
                    self.direction.cos() * self.wind_mps * 0.015,
                    self.direction.sin() * self.wind_mps * 0.015,
                ]
            },
        }
    }
}
/// How close, beyond half its hull length, a ship lets the coast come before its
/// helm turns away. Navigation plans with the wider `SHORE_BUFFER_M`, so a planned
/// route never trips it; bots, direct moves and drifting ships do.
pub const LAND_CAUTION_M: f64 = 100.0;

/// The arena's land rule, applied after every helm decision: keep the look-ahead
/// and the hull off the coast. When the next stretch of the ship's heading (650 m,
/// or 50 s of travel) or the ship itself comes within half its hull length plus
/// [`LAND_CAUTION_M`] of land, the helm steers along the shore on the side the bow
/// already favours, leaning offshore along the escape direction the closer the
/// coast is, and straight out when the hull itself is inside that reserve. A bow
/// already on the shore (the hull within 20 m beyond its half length) backs off
/// first, swinging toward open water. A ship holding still well off the coast is
/// left alone. Over open sea it never acts.
pub fn avoid_land(a: &Vessel, command: HelmCommand, terrain: &Terrain) -> HelmCommand {
    if !terrain.has_land() {
        return command;
    }
    let p = &a.motion;
    let reserve = a.definition().hull.length / 2.0 + LAND_CAUTION_M;
    let (sin, cos) = p.heading.sin_cos();
    let own = terrain.clearance(p.x, p.z);
    let holding = command.throttle <= 0.0 && p.speed.abs() < 0.5;
    let look = 650.0f64.max(p.speed.abs() * crate::mobility::SHIP_PACE * 50.0);
    let ahead = [p.x + sin * look, p.z - cos * look];
    let closing = !holding && !terrain.segment_clear([p.x, p.z], ahead, reserve);
    if !closing && own >= reserve {
        return command;
    }
    // The coast to turn from: under the hull when the hull is inside the reserve,
    // otherwise the first stretch of the look-ahead that is.
    let probe = if own < reserve {
        [p.x, p.z]
    } else {
        (1..=8)
            .map(|k| {
                let reach = look * k as f64 / 8.0;
                [p.x + sin * reach, p.z - cos * reach]
            })
            .find(|q| terrain.clearance(q[0], q[1]) < reserve)
            .unwrap_or(ahead)
    };
    let away = terrain.escape(probe[0], probe[1]);
    let bow = [sin, -cos];
    let bearing = |v: [f64; 2]| v[0].atan2(-v[1]);
    // Which way to turn when the coast is nearly dead ahead: the way the hull is
    // already swinging, else the way its captain asked, else to starboard. Chosen
    // afresh each tick without it, the side flips and the rudder cancels itself.
    let swing = if p.yaw_rate.abs() > 0.01 {
        p.yaw_rate.signum()
    } else if command.rudder != 0.0 {
        command.rudder.signum()
    } else {
        1.0
    };
    let tangent = [-away[1], away[0]];
    let favour = bow[0] * tangent[0] + bow[1] * tangent[1];
    let along = if favour.abs() >= 0.3 {
        if favour > 0.0 {
            tangent
        } else {
            [-tangent[0], -tangent[1]]
        }
    } else if wrap_angle(bearing(tangent) - p.heading).signum() == swing {
        tangent
    } else {
        [-tangent[0], -tangent[1]]
    };
    let depth = ((reserve - terrain.clearance(probe[0], probe[1])) / reserve).clamp(0.0, 1.0);
    let lean = if own < reserve {
        4.0
    } else {
        0.5 + 1.5 * depth
    };
    let desired = [along[0] + away[0] * lean, along[1] + away[1] * lean];
    let mut error = wrap_angle(bearing(desired) - p.heading);
    if error.abs() > 2.6 {
        // A near reversal keeps the current swing rather than dithering at 180°.
        error = error.abs() * swing;
    }
    let opening = bow[0] * away[0] + bow[1] * away[1];
    let half = reserve - LAND_CAUTION_M;
    // Bow on the shore: back off, swinging the bow toward open water (the rudder
    // acts the other way astern), until the hull has room to turn.
    if opening < -0.2 && (own < half + 20.0 || (p.speed < -0.2 && own < half + 60.0)) {
        return HelmCommand {
            throttle: -0.6,
            rudder: -clamp(error * 2.0, -1.0, 1.0),
            ..command
        };
    }
    HelmCommand {
        throttle: if opening < 0.3 {
            0.4
        } else {
            command.throttle.max(0.4)
        },
        rudder: clamp(error * 2.0, -1.0, 1.0),
        ..command
    }
}

/// A battle's conditions: the calibrated sea, and the map's terrain placed in the
/// battle's world (open sea when the map has none).
#[derive(Clone, Debug)]
pub struct ResolvedEnvironment {
    pub sea: SeaState,
    pub terrain: Terrain,
}
impl crate::catalog::Catalog {
    /// Mission geography is centered on the visible circle and depends on the
    /// public mission capacity, never the private generated fleet size.
    pub fn resolve_pve_environment(
        &self,
        map_id: &str,
        weather: &str,
        seed: u32,
        rules: &crate::mission::MissionRules,
        wind: Option<f64>,
    ) -> Result<ResolvedEnvironment, crate::catalog::ContentError> {
        let mut environment =
            self.resolve_environment(map_id, weather, seed, rules.budget.max_ships, 16000.0, wind)?;
        environment.terrain.offset = [0.0, 0.0];
        Ok(environment)
    }
    /// Resolve CPU conditions from the frozen deployment manifest. Online callers
    /// always supply the server's rolled preset; custom callers may override wind.
    /// A bad selection is a `ContentError::Setup` naming the field, its value and
    /// the allowed range; bad installed content is `Invalid`, naming the entry.
    pub fn resolve_environment(
        &self,
        map_id: &str,
        weather: &str,
        seed: u32,
        team_size: usize,
        distance: f64,
        wind: Option<f64>,
    ) -> Result<ResolvedEnvironment, crate::catalog::ContentError> {
        use crate::catalog::ContentError;
        if !(1..=30).contains(&team_size) {
            return Err(ContentError::Setup(format!(
                "team size {team_size} outside 1..=30"
            )));
        }
        if !(1000.0..=20000.0).contains(&distance) {
            return Err(ContentError::Setup(format!(
                "spawnDistance {distance} outside 1000..=20000 m"
            )));
        }
        if let Some(w) = wind.filter(|w| !(0.0..=30.0).contains(w)) {
            return Err(ContentError::Setup(format!(
                "windSpeed {w} outside 0..=30 m/s"
            )));
        }
        let sea = self.resolve_sea(map_id, weather, seed, wind)?;
        // Custom and online battles centre the chart between the default spawn lines.
        let terrain = match self.map_terrain(map_id)? {
            None => Terrain::open_sea(),
            Some(id) => Terrain::placed(
                self.terrain.get(id).cloned().ok_or_else(|| {
                    let loaded: Vec<_> = self.terrain.keys().cloned().collect();
                    ContentError::Setup(format!(
                        "map {map_id:?} needs terrain {id:?}, which this content does not carry \
                         (loaded terrain: {})",
                        if loaded.is_empty() {
                            "none".into()
                        } else {
                            loaded.join(", ")
                        }
                    ))
                })?,
                [0.0, -distance / 2.0],
            ),
        };
        Ok(ResolvedEnvironment { sea, terrain })
    }
    /// The terrain id a map's `land.terrain` names; None for open sea. A value that is
    /// neither a non-empty string nor null is invalid content.
    pub fn map_terrain(&self, map_id: &str) -> Result<Option<&str>, crate::catalog::ContentError> {
        use crate::catalog::ContentError;
        let map = self.maps["maps"]
            .as_array()
            .and_then(|maps| maps.iter().find(|m| m["id"] == map_id))
            .ok_or_else(|| {
                ContentError::Setup(format!(
                    "unknown mapId {map_id:?}; installed maps: {}",
                    self.map_ids().unwrap_or_default().join(", ")
                ))
            })?;
        match &map["land"]["terrain"] {
            serde_json::Value::Null => Ok(None),
            serde_json::Value::String(id) if !id.is_empty() => Ok(Some(id.as_str())),
            other => Err(ContentError::Invalid(format!(
                "environment for map {map_id:?}: land.terrain is {other}, not a terrain id or null"
            ))),
        }
    }
    /// The calibrated CPU sea for a map, weather and wind. `wind` overrides the
    /// forecast; the caller validates its range.
    pub fn resolve_sea(
        &self,
        map_id: &str,
        weather: &str,
        seed: u32,
        wind: Option<f64>,
    ) -> Result<SeaState, crate::catalog::ContentError> {
        use crate::catalog::ContentError;
        let map = self.maps["maps"]
            .as_array()
            .and_then(|maps| maps.iter().find(|m| m["id"] == map_id))
            .ok_or_else(|| {
                ContentError::Setup(format!(
                    "unknown mapId {map_id:?}; installed maps: {}",
                    self.map_ids().unwrap_or_default().join(", ")
                ))
            })?;
        let forecast = self.conditions["weather"]
            .as_array()
            .and_then(|presets| presets.iter().find(|w| w["id"] == weather))
            .ok_or_else(|| {
                ContentError::Setup(format!(
                    "unknown weather {weather:?}; installed weather: {}",
                    self.weather_ids().unwrap_or_default().join(", ")
                ))
            })?;
        let invalid = |what: String| {
            ContentError::Invalid(format!(
                "environment for map {map_id:?}, weather {weather:?}: {what}"
            ))
        };
        let number = |value: &serde_json::Value, path: &str| {
            value
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or_else(|| invalid(format!("{path} is {value}, not a finite number")))
        };
        let wind_mps = wind.unwrap_or(
            number(&forecast["waves"]["windSpeed"], "waves.windSpeed")?
                * number(&map["water"]["windScale"], "water.windScale")?,
        );
        let calibration = &self.conditions["seaCalibration"];
        if calibration["version"].as_u64() != Some(1) {
            return Err(invalid(format!(
                "seaCalibration version is {}, not 1",
                calibration["version"]
            )));
        }
        let samples = calibration["samples"]
            .as_array()
            .filter(|samples| !samples.is_empty())
            .ok_or_else(|| invalid("seaCalibration has no samples".into()))?;
        let last = &samples[samples.len() - 1];
        let speed = wind_mps.clamp(0.0, number(&last["windSpeed"], "sea sample windSpeed")?);
        let upper = samples
            .iter()
            .position(|s| s["windSpeed"].as_f64().is_some_and(|w| w >= speed))
            .ok_or_else(|| invalid(format!("no sea sample reaches wind {speed} m/s")))?;
        let a = &samples[upper.saturating_sub(1)];
        let b = &samples[upper];
        let width = number(&b["windSpeed"], "sea sample windSpeed")?
            - number(&a["windSpeed"], "sea sample windSpeed")?;
        let t = if upper == 0 {
            0.0
        } else if width > 0.0 {
            (speed - number(&a["windSpeed"], "sea sample windSpeed")?) / width
        } else {
            return Err(invalid(format!(
                "sea samples {} and {upper} must ascend in windSpeed",
                upper - 1
            )));
        };
        let interpolate = |key: &str| -> Result<f64, ContentError> {
            let x = number(&a[key], key)?;
            Ok(x + (number(&b[key], key)? - x) * t)
        };
        let height = interpolate("significantHeightM")?
            * number(&map["water"]["amplitudeScale"], "water.amplitudeScale")?;
        let wavelength = interpolate("peakWavelengthM")?
            * number(&map["water"]["wavelengthScale"], "water.wavelengthScale")?;
        if height < 0.0 || wavelength <= 0.0 || wind_mps < 0.0 {
            return Err(invalid(format!(
                "resolved sea height {height} m, wavelength {wavelength} m and wind \
                 {wind_mps} m/s: height and wind must be non-negative, wavelength positive"
            )));
        }
        let direction = number(&map["water"]["windDirection"], "water.windDirection")?;
        Ok(SeaState {
            // Hm0 = 4 sqrt(variance); our independent 0.7/0.3 sine components
            // have variance amplitude_m^2 * (0.7^2 + 0.3^2) / 2. The renderer
            // draws the same significant height in metres.
            amplitude_m: height / (4.0 * (0.58_f64 / 2.0).sqrt()),
            wavelength_m: wavelength * 4.0,
            direction: direction * std::f64::consts::PI / 180.0,
            wind_mps,
            phase: seed as f64 / 4294967295.0 * std::f64::consts::TAU,
        })
    }
}

#[cfg(test)]
mod sea_calibration_tests {
    use super::*;

    #[test]
    fn wind_height_targets_and_interpolation_apply_to_every_map() {
        let catalog = crate::catalog::Catalog::installed();
        for map in catalog.maps["maps"].as_array().unwrap() {
            let id = map["id"].as_str().unwrap();
            let scale = map["water"]["amplitudeScale"].as_f64().unwrap();
            for (wind, height) in [
                (0.0, 0.0),
                (6.0, 0.9),
                (9.0, 1.8),
                (10.5, 2.25),
                (12.0, 2.7),
                (18.0, 5.5),
                (25.0, 8.8),
                (30.0, 11.3),
            ] {
                let sea = catalog
                    .resolve_environment(id, "map", 42, 1, 5000.0, Some(wind))
                    .unwrap()
                    .sea;
                assert!(
                    (sea.amplitude_m * 4.0 * (0.58_f64 / 2.0).sqrt() - height * scale).abs()
                        < 1e-10
                );
                assert_eq!(sea.wind_mps, wind);
                assert!(sea.wavelength_m > 0.0);
            }
            let mut previous = 0.0;
            for i in 0..=60 {
                let sea = catalog
                    .resolve_environment(id, "map", 42, 1, 5000.0, Some(i as f64 / 2.0))
                    .unwrap()
                    .sea;
                assert!(sea.amplitude_m >= previous);
                previous = sea.amplitude_m;
            }
            for forecast in catalog.conditions["weather"].as_array().unwrap() {
                let weather = forecast["id"].as_str().unwrap();
                let wind = forecast["waves"]["windSpeed"].as_f64().unwrap()
                    * map["water"]["windScale"].as_f64().unwrap();
                let legacy = catalog
                    .resolve_environment(id, weather, 42, 1, 5000.0, None)
                    .unwrap()
                    .sea;
                let explicit = catalog
                    .resolve_environment(id, weather, 42, 1, 5000.0, Some(wind))
                    .unwrap()
                    .sea;
                assert_eq!(legacy.amplitude_m, explicit.amplitude_m);
                assert_eq!(legacy.wavelength_m, explicit.wavelength_m);
            }
        }
    }

    /// Broken installed content names the map, weather and entry it failed on.
    #[test]
    fn broken_environment_content_names_its_entry() {
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&crate::catalog::installed_manifest()).unwrap();
        let map = &mut manifest["maps"]["maps"][0];
        let id = map["id"].as_str().unwrap().to_owned();
        map["water"]["windScale"] = serde_json::json!("x");
        let error = crate::catalog::Catalog::load(&serde_json::to_vec(&manifest).unwrap())
            .err()
            .expect("the manifest should be rejected")
            .to_string();
        assert_eq!(
            error,
            format!(
                "Invalid content: environment for map {id:?}, weather \"map\": \
                 water.windScale is \"x\", not a finite number"
            )
        );
    }

    #[test]
    fn calibrated_height_matches_the_cpu_surface_variance() {
        let sea = SeaState {
            amplitude_m: 5.5 / (4.0 * (0.58_f64 / 2.0).sqrt()),
            wavelength_m: 180.0,
            direction: 0.7,
            wind_mps: 18.0,
            phase: 1.3,
        };
        let waves = sea.waves();
        let (mut sum, mut squares) = (0.0, 0.0);
        let count = 16384;
        for i in 0..count {
            let h = sea.height_at(
                &waves,
                (i % 128) as f64 * 31.0,
                (i / 128) as f64 * 37.0,
                60.0,
            );
            sum += h;
            squares += h * h;
        }
        let variance = squares / count as f64 - (sum / count as f64).powi(2);
        assert!((4.0 * variance.sqrt() - 5.5).abs() < 0.01);
    }
}

use crate::{
    definition::{Hull, Vec3},
    geometry::{Pose, clamp, local_to_world, wrap_angle},
    motion::{HelmCommand, SeaHandling, ShipState},
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
#[derive(Clone, Debug, Deserialize)]
pub struct TerrainField {
    pub seed: f64,
    pub style: String,
    pub samples: Vec<f32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Island {
    pub id: String,
    pub x: f64,
    pub z: f64,
    pub rx: f64,
    pub rz: f64,
    pub height: f64,
    pub seed: f64,
    pub style: String,
}
pub fn island_rim(a: f64, s: f64) -> f64 {
    0.86 + 0.14 * (a * 3.0 + s).sin()
        + 0.075 * (a * 7.0 - s).sin()
        + 0.045 * (a * 13.0 + s * 0.7).sin()
        + 0.018 * (a * 29.0 - s * 0.3).sin()
}
pub fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = clamp((x - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
pub fn terrain_noise(x: f64, z: f64) -> f64 {
    let (ix, iz) = (x.floor(), z.floor());
    let (fx, fz) = (x - ix, z - iz);
    let u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let v = fz * fz * fz * (fz * (fz * 6.0 - 15.0) + 10.0);
    let hash = |a: f64, b: f64| {
        let n = (a as i32 as u32)
            .wrapping_mul(374761393)
            .wrapping_add((b as i32 as u32).wrapping_mul(668265263));
        let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
        (n ^ (n >> 16)) as f64 / 4294967295.0
    };
    let (a, b, c, d) = (
        hash(ix, iz),
        hash(ix + 1.0, iz),
        hash(ix, iz + 1.0),
        hash(ix + 1.0, iz + 1.0),
    );
    (a + (b - a) * u) * (1.0 - v) + (c + (d - c) * u) * v
}
impl Island {
    pub fn radius(&self, x: f64, z: f64) -> f64 {
        let (dx, dz) = ((x - self.x) / self.rx, (z - self.z) / self.rz);
        dx.hypot(dz) / island_rim(dz.atan2(dx), self.seed)
    }
    pub fn height_at(&self, field: &TerrainField, world_x: f64, world_z: f64) -> f64 {
        let (x, z) = ((world_x - self.x) / self.rx, (world_z - self.z) / self.rz);
        let r = x.hypot(z) / island_rim(z.atan2(x), self.seed);
        if r >= 1.0 {
            return ((1.0 - r) * 500.0).max(-45.0);
        }
        let (gx, gz) = (
            clamp((x / 1.22 + 1.0) * 0.5 * 256.0, 0.0, 255.999),
            clamp((z / 1.22 + 1.0) * 0.5 * 256.0, 0.0, 255.999),
        );
        let (ix, iz) = (gx.floor() as usize, gz.floor() as usize);
        let (u, v) = (gx - ix as f64, gz - iz as f64);
        let a = iz * 257 + ix;
        let f = &field.samples;
        let h = (f[a] as f64 * (1.0 - u) + f[a + 1] as f64 * u) * (1.0 - v)
            + (f[a + 257] as f64 * (1.0 - u) + f[a + 258] as f64 * u) * v;
        let inland = (1.0 - r) * self.rx.min(self.rz);
        let exposure = terrain_noise(x * 3.0 + self.seed, z * 3.0);
        let slope = if self.style == "tropical" {
            0.1 + 0.5 * smooth(0.4, 0.75, exposure)
        } else {
            0.07 + 0.62 * smooth(0.3, 0.8, exposure)
        };
        let raw = h * self.height;
        let beach = raw * (1.0 - (-inland * slope / raw.max(1.0)).exp());
        (raw + (beach - raw) * (1.0 - smooth(60.0, 500.0, inland))) * smooth(0.0, 4.0, inland)
    }
}
pub fn avoid_land(p: &ShipState, command: HelmCommand, islands: &[Island]) -> HelmCommand {
    for island in islands {
        let look = 650.0f64.max(p.speed.abs() * crate::mobility::SHIP_PACE * 50.0);
        let x = p.x + p.heading.sin() * look;
        let z = p.z - p.heading.cos() * look;
        if island.radius(x, z) > 1.3 && island.radius(p.x, p.z) > 1.2 {
            continue;
        }
        let away = (p.x - island.x).atan2(island.z - p.z);
        let rudder = clamp(wrap_angle(away - p.heading) * 2.0, -1.0, 1.0);
        return HelmCommand {
            throttle: 0.4,
            rudder: if rudder.abs() < 0.05 { 1.0 } else { rudder },
            ..command
        };
    }
    command
}
pub fn first_land_hit(
    islands: &[Island],
    fields: &[TerrainField],
    from: Vec3,
    to: Vec3,
) -> Option<(f64, Vec3)> {
    let near: Vec<_> = islands
        .iter()
        .filter(|i| {
            from[0].min(to[0]) <= i.x + i.rx * 1.2
                && from[0].max(to[0]) >= i.x - i.rx * 1.2
                && from[2].min(to[2]) <= i.z + i.rz * 1.2
                && from[2].max(to[2]) >= i.z - i.rz * 1.2
        })
        .collect();
    if near.is_empty() {
        return None;
    }
    let point = |t: f64| {
        [
            from[0] + (to[0] - from[0]) * t,
            from[1] + (to[1] - from[1]) * t,
            from[2] + (to[2] - from[2]) * t,
        ]
    };
    let solid = |p: Vec3| {
        let height = near.iter().fold(-45.0f64, |h, i| {
            h.max(
                i.height_at(
                    fields
                        .iter()
                        .find(|f| f.seed == i.seed && f.style == i.style)
                        .expect("validated terrain field"),
                    p[0],
                    p[2],
                ),
            )
        });
        p[1] <= height
    };
    let steps = ((to[0] - from[0]).hypot(to[2] - from[2]) / 20.0)
        .ceil()
        .max(1.0) as usize;
    if solid(from) {
        return Some((0.0, from));
    }
    for i in 1..=steps {
        if solid(point(i as f64 / steps as f64)) {
            let (mut a, mut b) = ((i - 1) as f64 / steps as f64, i as f64 / steps as f64);
            for _ in 0..16 {
                let mid = (a + b) / 2.0;
                if solid(point(mid)) {
                    b = mid;
                } else {
                    a = mid;
                }
            }
            return Some((b, point(b)));
        }
    }
    None
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEnvironment {
    pub sea: SeaState,
    pub islands: Vec<Island>,
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
        for island in &mut environment.islands {
            island.z += 8000.0;
        }
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
        let sea = SeaState {
            // Hm0 = 4 sqrt(variance); our independent 0.7/0.3 sine components
            // have variance amplitude_m^2 * (0.7^2 + 0.3^2) / 2. The renderer
            // draws the same significant height in metres.
            amplitude_m: height / (4.0 * (0.58_f64 / 2.0).sqrt()),
            wavelength_m: wavelength * 4.0,
            direction: direction * std::f64::consts::PI / 180.0,
            wind_mps,
            phase: seed as f64 / 4294967295.0 * std::f64::consts::TAU,
        };
        let lane = 2100.0f64.max(((team_size - 1) as f64 / 2.0).ceil() * 650.0 + 1000.0);
        let style = map["land"]["style"]
            .as_str()
            .ok_or_else(|| invalid("land.style is not a string".into()))?;
        let recipes = map["land"]["islands"]
            .as_array()
            .ok_or_else(|| invalid("land.islands is not an array".into()))?;
        let mut islands = Vec::new();
        for recipe in recipes {
            let id = recipe["id"]
                .as_str()
                .ok_or_else(|| invalid(format!("island id {} is not a string", recipe["id"])))?;
            let rx = number(&recipe["rx"], "island rx")?;
            let rz = number(&recipe["rz"], "island rz")?;
            let seed = number(&recipe["seed"], "island seed")?;
            if rx <= 0.0 || rz <= 0.0 {
                return Err(invalid(format!(
                    "island {id} radii rx {rx} m and rz {rz} m must be positive"
                )));
            }
            if !self
                .terrain
                .iter()
                .any(|f| f.seed == seed && f.style == style)
            {
                return Err(invalid(format!(
                    "island {id} has no baked terrain for seed {seed}, style {style}; \
                     rebuild content with bun scripts/multiplayer/content.ts"
                )));
            }
            islands.push(Island {
                id: id.into(),
                x: number(&recipe["side"], "island side")?
                    * (lane + rx * 1.25 + number(&recipe["offset"], "island offset")?),
                z: -distance / 2.0 + number(&recipe["along"], "island along")?,
                rx,
                rz,
                height: number(&recipe["height"], "island height")?,
                seed,
                style: style.into(),
            });
        }
        Ok(ResolvedEnvironment { sea, islands })
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

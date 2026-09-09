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
impl SeaState {
    pub fn height(&self, x: f64, z: f64, time: f64) -> f64 {
        if self.amplitude_m == 0.0 {
            return 0.0;
        }
        let sample = |direction: f64, wavelength: f64, phase: f64| {
            let k = std::f64::consts::TAU / wavelength;
            (k * (x * direction.cos() + z * direction.sin()) - (9.81 * k).sqrt() * time + phase)
                .sin()
        };
        self.amplitude_m
            * (0.7 * sample(self.direction, self.wavelength_m, self.phase)
                + 0.3
                    * sample(
                        self.direction + 0.8,
                        self.wavelength_m * 0.57,
                        self.phase + 2.0,
                    ))
    }
    pub fn response(&self, h: &Hull, p: &ShipState, submarine: bool, time: f64) -> SeaResponse {
        let attenuation = (-(if submarine { p.depth() } else { 0.0 }) / 8.0).exp();
        let at = |x: f64, z: f64| {
            let point = local_to_world(
                [x, 0.0, z],
                Pose {
                    x: p.x,
                    z: p.z,
                    heading: p.heading,
                    ..Pose::default()
                },
            );
            self.height(point[0], point[2], time) * attenuation
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
                (at(h.beam * 0.4, 0.0) - at(-h.beam * 0.4, 0.0)) / (h.beam * 0.8),
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
        let look = 650.0f64.max(p.speed.abs() * 50.0);
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
        let invalid = || ContentError::Invalid("invalid environment content or selection".into());
        if !(1..=30).contains(&team_size)
            || !distance.is_finite()
            || !(1000.0..=20000.0).contains(&distance)
            || wind.is_some_and(|w| !w.is_finite() || !(0.0..=30.0).contains(&w))
        {
            return Err(invalid());
        }
        let map = self.maps["maps"]
            .as_array()
            .and_then(|maps| maps.iter().find(|m| m["id"] == map_id))
            .ok_or_else(invalid)?;
        let forecast = self.conditions["weather"]
            .as_array()
            .and_then(|presets| presets.iter().find(|w| w["id"] == weather))
            .ok_or_else(invalid)?;
        let number = |value: &serde_json::Value| {
            value.as_f64().filter(|n| n.is_finite()).ok_or_else(invalid)
        };
        let (amplitude, wind_mps, wavelength) = if let Some(w) = wind {
            (
                0.24 * (w / 9.0).powf(1.2) * number(&map["water"]["amplitudeScale"])?,
                w,
                (20.0 * w / 9.0).max(4.0) * number(&map["water"]["wavelengthScale"])?,
            )
        } else {
            (
                number(&forecast["waves"]["amplitude"])? * number(&map["water"]["amplitudeScale"])?,
                number(&forecast["waves"]["windSpeed"])? * number(&map["water"]["windScale"])?,
                number(&forecast["waves"]["peakWavelength"])?
                    * number(&map["water"]["wavelengthScale"])?,
            )
        };
        if amplitude < 0.0 || wavelength <= 0.0 || wind_mps < 0.0 {
            return Err(invalid());
        }
        let sea = SeaState {
            amplitude_m: amplitude * 4.0,
            wavelength_m: wavelength * 4.0,
            direction: number(&map["water"]["windDirection"])? * std::f64::consts::PI / 180.0,
            wind_mps,
            phase: seed as f64 / 4294967295.0 * std::f64::consts::TAU,
        };
        let lane = 2100.0f64.max(((team_size - 1) as f64 / 2.0).ceil() * 650.0 + 1000.0);
        let style = map["land"]["style"].as_str().ok_or_else(invalid)?;
        let mut islands = Vec::new();
        for recipe in map["land"]["islands"].as_array().ok_or_else(invalid)? {
            let rx = number(&recipe["rx"])?;
            let rz = number(&recipe["rz"])?;
            let seed = number(&recipe["seed"])?;
            if rx <= 0.0
                || rz <= 0.0
                || !self
                    .terrain
                    .iter()
                    .any(|f| f.seed == seed && f.style == style)
            {
                return Err(invalid());
            }
            islands.push(Island {
                id: recipe["id"].as_str().ok_or_else(invalid)?.into(),
                x: number(&recipe["side"])? * (lane + rx * 1.25 + number(&recipe["offset"])?),
                z: -distance / 2.0 + number(&recipe["along"])?,
                rx,
                rz,
                height: number(&recipe["height"])?,
                seed,
                style: style.into(),
            });
        }
        Ok(ResolvedEnvironment { sea, islands })
    }
}

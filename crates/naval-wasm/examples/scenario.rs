//! A scripted battle: one ship under fixed player orders against a static
//! target, printing its state every tick as CSV. For questions like "how far
//! does Bismarck roll in a 20 m/s beam sea" or "does this design's forward
//! turret reach 40 degrees of elevation", without writing a test file.
//!
//! cargo run --profile test-fast -p naval-wasm --example scenario -- <ship> [flags] > run.csv
//!
//! cargo is at ~/.cargo/bin when it is not on PATH. The test-fast profile
//! rebuilds in seconds after `bun run rust:test`; --release gives the same
//! numbers after a longer build. The content manifest comes from
//! `bun run bootstrap` (or `bun scripts/multiplayer/content.ts`).
//!
//! `<ship>` is a preset id (`bismarck`) or a construction blueprint
//! (`assets/ships/valiant/blueprint.json`), compiled with the parts catalog of
//! its pinned revision, `public/models/components/catalogs/<revision>/catalog.json`,
//! or `--parts FILE`. Flags, all optional:
//!
//!   --seconds S          battle time to run (60)
//!   --every N            print every Nth tick (1; a tick is 1/60 s)
//!   --heading DEG        spawn heading, clockwise from -z (0 steams toward -z, 90 toward +x)
//!   --wind M/S           wind 0..=30 (0, a flat calm); sets the calibrated sea
//!   --sea head|following|port|starboard
//!                        where the waves come from, relative to the spawn heading
//!   --wind-dir DEG       or the absolute direction the waves run toward: 0 is +x, 90 is +z
//!   --map ID --weather ID --seed N    (north-atlantic, clear, 1)
//!   --target PRESET      the static enemy (fletcher), at --target-at X:Z (0:-12000)
//!   --helm T:THROTTLE:RUDDER
//!                        from T seconds on; throttle and rudder -1..=1, positive
//!                        rudder turns to starboard (1:0 from 0 s if none is given)
//!   --aim T:X:Y:Z[:fire] from T seconds on, aim --battery at a world point (and fire)
//!   --aim T:target[:fire]  at the target ship; T:hold keeps the guns still;
//!                        T:crew hands them to the crew. Guns hold until the first --aim.
//!   --crew LEVEL         the crew's AI level (static, which never engages: T:crew needs hard)
//!   --battery NAME       the battery the aim orders (main)
//!   --mounts all|BATTERY which mounts get columns (the --battery)
//!
//! Columns: tick, t (s), x, y, z (m), heading (deg, 0..360), speed (physical m/s
//! along the bow; the world moves SHIP_PACE times as fast), roll (deg, positive
//! heels to port), pitch (deg, positive bow up), yaw rate (deg/s), ordered
//! throttle and rudder, actual rudder, then per mount: bearing (deg from the
//! bow, positive to starboard), elevation (deg) and status.
//!
//! Example, Bismarck turning to starboard in a head sea and training on the target:
//!
//! cargo run --profile test-fast -p naval-wasm --example scenario -- bismarck --seconds 90 --every 60 \
//!     --wind 15 --sea head --helm 0:1:0 --helm 30:1:0.5 --aim 5:target
use naval_sim::{
    battle::{Battle, BattleSetup, Orders},
    catalog::Catalog,
    definition::{ConstructionCatalog, ConstructionSource},
    gunnery::PlayerGunOrders,
    motion::HelmCommand,
    mount_frames::mount_bearing,
    rules::DT,
};
use std::{collections::BTreeMap, sync::Arc, time::Instant};

#[derive(Clone, Copy)]
enum Aim {
    Hold,
    Crew,
    Point([f64; 3], bool),
    Target(bool),
}

/// `T:rest`, sorted by time; the order in force at `t` is the last one at or before it.
fn schedule<T>(mut entries: Vec<(f64, T)>) -> Vec<(f64, T)> {
    entries.sort_by(|a, b| a.0.total_cmp(&b.0));
    entries
}
fn at<T: Copy>(entries: &[(f64, T)], t: f64, default: T) -> T {
    entries
        .iter()
        .rev()
        .find(|(from, _)| *from <= t + 1e-9)
        .map_or(default, |(_, value)| *value)
}
fn number(text: &str, flag: &str) -> f64 {
    text.parse()
        .unwrap_or_else(|_| panic!("{flag}: {text:?} is not a number"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut ship = None;
    let (mut seconds, mut every, mut heading_deg, mut wind) = (60.0, 1u64, 0.0, 0.0);
    let (mut sea, mut wind_dir) = (None::<String>, None::<f64>);
    let (mut map, mut weather, mut seed) =
        ("north-atlantic".to_string(), "clear".to_string(), 1u32);
    let (mut target, mut target_at) = ("fletcher".to_string(), [0.0, -12000.0]);
    let (mut helm, mut aims) = (vec![], vec![]);
    let (mut battery, mut mounts, mut parts_path) = ("main".to_string(), None, None);
    let mut crew = "static".to_string();
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].as_str();
        let value = || {
            args.get(i + 1)
                .cloned()
                .unwrap_or_else(|| panic!("{flag} needs a value"))
        };
        match flag {
            "--seconds" => seconds = number(&value(), flag),
            "--every" => every = number(&value(), flag).max(1.0) as u64,
            "--heading" => heading_deg = number(&value(), flag),
            "--wind" => wind = number(&value(), flag),
            "--sea" => sea = Some(value()),
            "--wind-dir" => wind_dir = Some(number(&value(), flag)),
            "--map" => map = value(),
            "--weather" => weather = value(),
            "--seed" => seed = number(&value(), flag) as u32,
            "--target" => target = value(),
            "--target-at" => {
                let v = value();
                let (x, z) = v.split_once(':').expect("--target-at X:Z");
                target_at = [number(x, flag), number(z, flag)];
            }
            "--helm" => {
                let v = value();
                let parts: Vec<&str> = v.split(':').collect();
                assert!(parts.len() == 3, "--helm T:THROTTLE:RUDDER, got {v:?}");
                helm.push((
                    number(parts[0], flag),
                    (number(parts[1], flag), number(parts[2], flag)),
                ));
            }
            "--aim" => {
                let v = value();
                let usage = "--aim T:X:Y:Z[:fire], T:target[:fire], T:hold or T:crew";
                let (time, order) = v
                    .split_once(':')
                    .unwrap_or_else(|| panic!("{usage}, got {v:?}"));
                let (order, fire) = order
                    .strip_suffix(":fire")
                    .map_or((order, false), |order| (order, true));
                let aim = match order.split(':').collect::<Vec<_>>()[..] {
                    ["hold"] => Aim::Hold,
                    ["crew"] => Aim::Crew,
                    ["target"] => Aim::Target(fire),
                    [x, y, z] => {
                        Aim::Point([number(x, flag), number(y, flag), number(z, flag)], fire)
                    }
                    _ => panic!("{usage}, got {v:?}"),
                };
                aims.push((number(time, flag), aim));
            }
            "--battery" => battery = value(),
            "--crew" => crew = value(),
            "--mounts" => mounts = Some(value()),
            "--parts" => parts_path = Some(value()),
            other if other.starts_with("--") => panic!("unknown flag {other}"),
            other => {
                assert!(ship.is_none(), "one ship, got a second: {other}");
                ship = Some(other.to_string());
                i += 1;
                continue;
            }
        }
        i += 2;
    }
    let ship = ship.expect("usage: scenario <preset id | blueprint.json> [flags]; see the header of crates/naval-wasm/examples/scenario.rs");
    let (helm, aims) = (schedule(helm), schedule(aims));
    let heading = heading_deg.to_radians();

    let started = Instant::now();
    let installed = Catalog::installed();
    let (catalog, ship_id) = if ship.ends_with(".json") {
        let source: ConstructionSource =
            serde_json::from_slice(&std::fs::read(&ship).unwrap_or_else(|e| panic!("{ship}: {e}")))
                .unwrap_or_else(|e| panic!("{ship} is not a construction source: {e}"));
        let parts_path = parts_path.unwrap_or_else(|| {
            let pinned = format!(
                "public/models/components/catalogs/{}/catalog.json",
                source.construction.catalog_revision
            );
            if std::path::Path::new(&pinned).exists() {
                pinned
            } else {
                "public/models/components/catalog.json".into()
            }
        });
        let parts: ConstructionCatalog = serde_json::from_slice(
            &std::fs::read(&parts_path).unwrap_or_else(|e| panic!("{parts_path}: {e}")),
        )
        .unwrap_or_else(|e| panic!("{parts_path}: {e}"));
        let local = installed
            .with_constructions(std::slice::from_ref(&source), &parts)
            .unwrap_or_else(|e| panic!("{ship} does not compile: {e}"));
        let id = local
            .definitions
            .keys()
            .find(|id| !installed.definitions.contains_key(*id))
            .expect("the compiled design")
            .clone();
        eprintln!(
            "compiled {} as {id} with {parts_path} in {:.1} s",
            source.name,
            started.elapsed().as_secs_f64()
        );
        (Arc::new(local), id)
    } else {
        (installed, ship)
    };
    let compiled: BTreeMap<_, _> = [&ship_id, &target]
        .into_iter()
        .map(|id| {
            let ship = catalog.compile(id).unwrap_or_else(|e| panic!("{id}: {e}"));
            (id.clone(), Arc::new(ship))
        })
        .collect();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id": "own", "presetId": ship_id, "team": "a", "controller": "player", "aiLevel": crew,
             "spawn": {"x": 0, "z": 0, "heading": heading}},
            {"id": "target", "presetId": target, "team": "b", "controller": "bot", "aiLevel": "static",
             "spawn": {"x": target_at[0], "z": target_at[1], "heading": 0}}
        ],
        "seed": seed, "mapId": map, "weather": weather,
        "spawnDistance": target_at[0].hypot(target_at[1]).clamp(1000.0, 20000.0),
        "windSpeed": wind
    }))
    .unwrap();
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap_or_else(|e| panic!("{e}"));
    // The sea's direction is where the waves run to: a head sea runs against the bow.
    let direction = match sea.as_deref() {
        None => wind_dir,
        Some("head") => Some(heading_deg + 90.0),
        Some("following") => Some(heading_deg - 90.0),
        Some("port") => Some(heading_deg),
        Some("starboard") => Some(heading_deg + 180.0),
        Some(other) => panic!("--sea head|following|port|starboard, got {other}"),
    };
    if let Some(direction) = direction {
        battle
            .set_wind(wind, direction)
            .unwrap_or_else(|e| panic!("{e}"));
    }
    let own = battle
        .actors
        .iter()
        .position(|a| a.motion.id == "own")
        .unwrap();
    let definition = battle.actors[own].compiled.definition.clone();
    let columns: Vec<usize> = (0..definition.mounts.len())
        .filter(|&m| match mounts.as_deref() {
            Some("all") => true,
            Some(only) => definition.mounts[m].battery == only,
            None => definition.mounts[m].battery == battery,
        })
        .collect();
    eprintln!(
        "{} ({}), {} of {} mounts; sea {:.2} m amplitude, {:.0} m wavelength, running toward {:.0} deg; ready in {:.1} s",
        definition.name,
        ship_id,
        columns.len(),
        definition.mounts.len(),
        battle.sea.amplitude_m,
        battle.sea.wavelength_m,
        battle.sea.direction.to_degrees().rem_euclid(360.0),
        started.elapsed().as_secs_f64()
    );
    let mut header =
        "tick,t,x,y,z,heading,speed,roll,pitch,yaw_rate,throttle,rudder_order,rudder".to_string();
    for &m in &columns {
        let id = &definition.mounts[m].id;
        header += &format!(",{id}.bearing,{id}.elevation,{id}.status");
    }
    println!("{header}");
    let ticks = (seconds / DT).round() as u64;
    loop {
        let t = battle.tick as f64 * DT;
        let (throttle, rudder) = at(&helm, t, (1.0, 0.0));
        if battle.tick.is_multiple_of(every) {
            let a = &battle.actors[own];
            let p = &a.motion;
            let mut row = format!(
                "{},{t:.4},{:.3},{:.3},{:.3},{:.3},{:.4},{:.4},{:.4},{:.4},{throttle},{rudder},{:.4}",
                battle.tick,
                p.x,
                p.y,
                p.z,
                p.heading.to_degrees().rem_euclid(360.0),
                p.speed,
                p.roll.to_degrees(),
                p.pitch.to_degrees(),
                p.yaw_rate.to_degrees(),
                p.rudder
            );
            for &m in &columns {
                let state = &a.mounts[m];
                let bearing =
                    naval_sim::geometry::wrap_angle(mount_bearing(&definition.mounts[m], state));
                row += &format!(
                    ",{:.3},{:.3},{}",
                    bearing.to_degrees(),
                    state.elevation.to_degrees(),
                    state.status.as_str()
                );
            }
            println!("{row}");
        }
        // A sunk target ends the battle, and a finished battle no longer steps.
        if battle.tick >= ticks || battle.outcome.is_some() {
            break;
        }
        let target_point = battle
            .actors
            .iter()
            .find(|a| a.motion.id == "target")
            .map(|a| [a.motion.x, 0.0, a.motion.z]);
        let guns = |aim: Option<[f64; 3]>, fire: bool| {
            Some(PlayerGunOrders {
                battery: battery.clone(),
                weapon_group_id: None,
                aim,
                fire,
                ammunition: Default::default(),
            })
        };
        let orders = Orders {
            helm: Some(HelmCommand {
                throttle,
                rudder,
                ..Default::default()
            }),
            guns: match at(&aims, t, Aim::Hold) {
                Aim::Hold => guns(None, false),
                Aim::Crew => None,
                Aim::Point(point, fire) => guns(Some(point), fire),
                Aim::Target(fire) => guns(target_point, fire),
            },
            ..Default::default()
        };
        battle.step(&BTreeMap::from([("own".to_string(), orders)]));
    }
    if let Some(outcome) = &battle.outcome {
        eprintln!(
            "the battle ended at tick {}: {outcome:?}",
            outcome.final_tick
        );
    }
}

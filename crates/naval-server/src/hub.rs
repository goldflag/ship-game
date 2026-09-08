use crate::{
    persistence::Writer,
    worker::{self, MatchHandle, WorkerConfig},
};
use naval_sim::{
    battle::{BattleSetup, ShipSetup},
    bots::AiLevel,
    catalog::Catalog,
    rules::{self, Rules, TeamId},
    vessel::{CompiledShip, Controller},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    net::IpAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Version {
    pub protocol: u32,
    pub simulation_build: String,
    pub manifest_hash: String,
    pub rules_version: u32,
}
impl Version {
    pub fn matches(&self, catalog: &Catalog) -> bool {
        self.protocol == naval_protocol::PROTOCOL_VERSION
            && self.simulation_build == naval_sim::SIMULATION_BUILD
            && self.manifest_hash == catalog.manifest_hash
            && self.rules_version == Rules::default().version
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JoinMode {
    Queue,
    CreateInvite,
    JoinInvite,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Join {
    pub fleet: Vec<String>,
    pub version: Version,
    pub mode: JoinMode,
    pub invite_code: Option<String>,
}
#[derive(Clone)]
pub struct Seat {
    pub handle: MatchHandle,
    pub player: usize,
}
pub struct Ticket {
    pub fleet: Vec<String>,
    pub created: Instant,
    pub seat: Option<Seat>,
    pub invite: Option<String>,
}
pub struct Registry {
    pub tickets: HashMap<String, Ticket>,
    waiting: VecDeque<String>,
    invites: HashMap<String, String>,
    pub matches: Vec<MatchHandle>,
    rates: HashMap<IpAddr, (Instant, u32)>,
}
pub struct Hub {
    pub catalog: Arc<Catalog>,
    pub compiled: Arc<BTreeMap<String, Arc<CompiledShip>>>,
    pub registry: Mutex<Registry>,
    pub writer: Writer,
    pub max_matches: usize,
    pub draining: AtomicBool,
    pub origin: Option<String>,
    pub sockets: Arc<tokio::sync::Semaphore>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Admission {
    pub ticket: String,
    pub invite_code: Option<String>,
}
impl Hub {
    pub fn new(
        catalog: Arc<Catalog>,
        compiled: Arc<BTreeMap<String, Arc<CompiledShip>>>,
        writer: Writer,
        max_matches: usize,
        origin: Option<String>,
    ) -> Self {
        Self {
            catalog,
            compiled,
            writer,
            max_matches,
            origin,
            draining: AtomicBool::new(false),
            sockets: Arc::new(tokio::sync::Semaphore::new(128)),
            registry: Mutex::new(Registry {
                tickets: HashMap::new(),
                waiting: VecDeque::new(),
                invites: HashMap::new(),
                matches: vec![],
                rates: HashMap::new(),
            }),
        }
    }
    pub fn version(&self) -> Version {
        Version {
            protocol: naval_protocol::PROTOCOL_VERSION,
            simulation_build: naval_sim::SIMULATION_BUILD.into(),
            manifest_hash: self.catalog.manifest_hash.clone(),
            rules_version: Rules::default().version,
        }
    }
    pub fn join(&self, request: Join, ip: IpAddr) -> Result<Admission, String> {
        if self.draining.load(Ordering::Acquire) || !self.writer.healthy.load(Ordering::Acquire) {
            return Err("Server is draining or result storage is unavailable".into());
        }
        if !request.version.matches(&self.catalog) {
            return Err("Game content has changed. Reload before joining".into());
        }
        rules::validate_fleet(
            &request.fleet,
            &self.catalog.fleet_entries,
            &Rules::default(),
        )
        .map_err(|e| e.to_string())?;
        let now = Instant::now();
        let mut registry = self.registry.lock().map_err(|_| "Lobby unavailable")?;
        registry.clean(now);
        if registry.rates.len() >= 4096 && !registry.rates.contains_key(&ip) {
            return Err("Admission rate capacity reached; try again shortly".into());
        }
        let rate = registry.rates.entry(ip).or_insert((now, 0));
        if now.duration_since(rate.0) >= Duration::from_secs(10) {
            *rate = (now, 0)
        }
        if rate.1 >= 10 {
            return Err("Too many join attempts; wait a moment".into());
        }
        rate.1 += 1;
        if registry.tickets.len() >= 128 {
            return Err("Lobby is full".into());
        }
        let active = registry
            .matches
            .iter()
            .filter(|m| !m.finished.load(Ordering::Acquire))
            .count();
        if active >= self.max_matches {
            return Err("All match workers are occupied; try again shortly".into());
        }
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let mut code = None;
        let opponent = match request.mode {
            JoinMode::Queue => {
                let mut other = None;
                while let Some(id) = registry.waiting.pop_front() {
                    if registry.tickets.get(&id).is_some_and(|t| t.seat.is_none()) {
                        other = Some(id);
                        break;
                    }
                }
                other
            }
            JoinMode::CreateInvite => {
                let candidate = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
                code = Some(candidate);
                None
            }
            JoinMode::JoinInvite => {
                let code = request
                    .invite_code
                    .as_ref()
                    .ok_or("Enter an invite code")?
                    .trim()
                    .to_lowercase();
                if code.len() != 12 || !code.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err("Invalid invite code".into());
                }
                Some(
                    registry
                        .invites
                        .get(&code)
                        .filter(|id| registry.tickets.get(*id).is_some_and(|t| t.seat.is_none()))
                        .cloned()
                        .ok_or("Invite expired or already used")?,
                )
            }
        };
        if let Some(other) = opponent {
            let first = &registry.tickets[&other];
            let seed = uuid::Uuid::new_v4().as_u128() as u32;
            let maps = self.catalog.maps["maps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>();
            let weather = self.catalog.conditions["weather"]
                .as_array()
                .unwrap()
                .iter()
                .map(|w| w["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>();
            let environment = rules::select_environment(seed, &maps, &weather, &Rules::default())
                .map_err(|e| e.to_string())?;
            let owners = [
                environment.first_player_team,
                environment.first_player_team.other(),
            ];
            let ships = [&first.fleet, &request.fleet]
                .into_iter()
                .enumerate()
                .flat_map(|(player, fleet)| {
                    fleet.iter().enumerate().map(move |(i, id)| ShipSetup {
                        id: format!(
                            "{}-{}",
                            if owners[player] == TeamId::A {
                                "a"
                            } else {
                                "b"
                            },
                            i + 1
                        ),
                        preset_id: id.clone(),
                        team: owners[player],
                        controller: Controller::Bot,
                        ai_level: AiLevel::Normal,
                        spawn: None,
                    })
                })
                .collect();
            let setup = BattleSetup {
                ships,
                seed: environment.sea_seed,
                map_id: environment.map_id.clone(),
                weather: environment.weather.clone(),
                spawn_distance: Rules::default().spawn_distance_m as f64,
                wind_speed: None,
            };
            let id = uuid::Uuid::new_v4().to_string();
            let handle = match worker::spawn(
                id,
                setup,
                environment,
                self.catalog.clone(),
                self.compiled.clone(),
                self.writer.clone(),
                WorkerConfig::default(),
            ) {
                Ok(handle) => handle,
                Err(error) => {
                    if matches!(request.mode, JoinMode::Queue) {
                        registry.waiting.push_front(other);
                    }
                    return Err(error);
                }
            };
            registry.tickets.get_mut(&other).unwrap().seat = Some(Seat {
                handle: handle.clone(),
                player: 0,
            });
            registry.invites.retain(|_, id| id != &other);
            registry.tickets.insert(
                token.clone(),
                Ticket {
                    fleet: request.fleet,
                    created: now,
                    invite: None,
                    seat: Some(Seat {
                        handle: handle.clone(),
                        player: 1,
                    }),
                },
            );
            registry.matches.push(handle);
        } else {
            registry.tickets.insert(
                token.clone(),
                Ticket {
                    fleet: request.fleet,
                    created: now,
                    seat: None,
                    invite: code.clone(),
                },
            );
            if let Some(code) = &code {
                registry.invites.insert(code.clone(), token.clone());
            } else {
                registry.waiting.push_back(token.clone());
            }
        }
        Ok(Admission {
            ticket: token,
            invite_code: code,
        })
    }
    pub fn cancel(&self, token: &str) {
        if let Ok(mut r) = self.registry.lock()
            && r.tickets.get(token).is_some_and(|t| t.seat.is_none())
        {
            r.tickets.remove(token);
            r.waiting.retain(|t| t != token);
            r.invites.retain(|_, t| t != token);
        }
    }
}
impl Registry {
    fn clean(&mut self, now: Instant) {
        self.tickets.retain(|_, t| {
            now.duration_since(t.created)
                < Duration::from_secs(if t.seat.is_some() { 45 * 60 } else { 300 })
        });
        self.waiting.retain(|id| self.tickets.contains_key(id));
        self.invites.retain(|_, id| self.tickets.contains_key(id));
        self.matches.retain(|m| {
            !m.finished.load(Ordering::Acquire)
                || self
                    .tickets
                    .values()
                    .any(|t| t.seat.as_ref().is_some_and(|s| s.handle.id == m.id))
        });
        self.rates
            .retain(|_, (time, _)| now.duration_since(*time) < Duration::from_secs(60));
    }
}

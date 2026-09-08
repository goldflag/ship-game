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
    opponent: Option<String>,
    sockets: HashMap<uuid::Uuid, Instant>,
    disconnected: Instant,
}
pub struct Registry {
    pub tickets: HashMap<String, Ticket>,
    waiting: VecDeque<String>,
    invites: HashMap<String, String>,
    pub matches: Vec<MatchHandle>,
    rates: HashMap<IpAddr, (Instant, u32)>,
    global_rate: (Instant, u32),
}
pub struct Hub {
    pub catalog: Arc<Catalog>,
    pub compiled: Arc<BTreeMap<String, Arc<CompiledShip>>>,
    pub registry: Mutex<Registry>,
    pub writer: Writer,
    pub max_matches: usize,
    pub draining: AtomicBool,
    pub origin: Option<String>,
    pub trusted_proxies: Vec<IpAddr>,
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
        trusted_proxies: Vec<IpAddr>,
    ) -> Self {
        Self {
            catalog,
            compiled,
            writer,
            max_matches,
            origin,
            trusted_proxies,
            draining: AtomicBool::new(false),
            sockets: Arc::new(tokio::sync::Semaphore::new(128)),
            registry: Mutex::new(Registry {
                tickets: HashMap::new(),
                waiting: VecDeque::new(),
                invites: HashMap::new(),
                matches: vec![],
                rates: HashMap::new(),
                global_rate: (Instant::now(), 0),
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
        if now.duration_since(registry.global_rate.0) >= Duration::from_secs(10) {
            registry.global_rate = (now, 0);
        }
        if registry.global_rate.1 >= 256 {
            return Err("Global admission limit reached; wait a moment".into());
        }
        registry.global_rate.1 += 1;
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
            JoinMode::Queue => None,
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
                        .filter(|id| {
                            registry.tickets.get(*id).is_some_and(|t| t.seat.is_none())
                                && !registry
                                    .tickets
                                    .values()
                                    .any(|t| t.opponent.as_ref() == Some(*id))
                        })
                        .cloned()
                        .ok_or("Invite expired or already used")?,
                )
            }
        };
        registry.tickets.insert(
            token.clone(),
            Ticket {
                fleet: request.fleet,
                created: now,
                seat: None,
                invite: code.clone(),
                opponent,
                sockets: HashMap::new(),
                disconnected: now,
            },
        );
        if let Some(code) = &code {
            registry.invites.insert(code.clone(), token.clone());
        } else if matches!(request.mode, JoinMode::Queue) {
            registry.waiting.push_back(token.clone());
        }
        Ok(Admission {
            ticket: token,
            invite_code: code,
        })
    }
    pub fn attach(self: &Arc<Self>, token: &str) -> Result<TicketSocket, String> {
        let mut r = self.registry.lock().map_err(|_| "Lobby unavailable")?;
        r.clean(Instant::now());
        let ticket = r
            .tickets
            .get_mut(token)
            .ok_or("Session expired; join again")?;
        let id = uuid::Uuid::new_v4();
        ticket.sockets.insert(id, Instant::now());
        Ok(TicketSocket {
            hub: self.clone(),
            token: token.into(),
            id,
        })
    }
    pub fn pair(&self, token: &str) -> Result<(), String> {
        let mut registry = self.registry.lock().map_err(|_| "Lobby unavailable")?;
        registry.clean(Instant::now());
        let ticket = registry
            .tickets
            .get(token)
            .ok_or("Session expired; join again")?;
        if ticket.seat.is_some() || ticket.sockets.is_empty() {
            return Ok(());
        }
        if self.draining.load(Ordering::Acquire) || !self.writer.healthy.load(Ordering::Acquire) {
            return Err("Server is draining or result storage is unavailable".into());
        }
        if registry
            .matches
            .iter()
            .filter(|m| !m.finished.load(Ordering::Acquire))
            .count()
            >= self.max_matches
        {
            return Ok(());
        }
        let live = |id: &str| {
            registry
                .tickets
                .get(id)
                .is_some_and(|t| t.seat.is_none() && !t.sockets.is_empty())
        };
        let other = if let Some(other) = &ticket.opponent {
            if !registry.tickets.contains_key(other) {
                return Err("Invite host left the lobby".into());
            }
            live(other).then(|| other.clone())
        } else if ticket.invite.is_some() {
            registry
                .tickets
                .iter()
                .find(|(id, t)| t.opponent.as_deref() == Some(token) && live(id))
                .map(|(id, _)| id.clone())
        } else {
            registry
                .waiting
                .iter()
                .find(|id| id.as_str() != token && live(id))
                .cloned()
        };
        if let Some(other) = other {
            let first = &registry.tickets[&other];
            let second = &registry.tickets[token];
            let seed = uuid::Uuid::new_v4().as_u128() as u32;
            let maps = self.catalog.map_ids()?;
            let weather = self.catalog.weather_ids()?;
            let environment = rules::select_environment(seed, &maps, &weather, &Rules::default())
                .map_err(|e| e.to_string())?;
            let owners = [
                environment.first_player_team,
                environment.first_player_team.other(),
            ];
            let ships = [&first.fleet, &second.fleet]
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
                Err(error) => return Err(error),
            };
            registry
                .tickets
                .get_mut(&other)
                .ok_or("Opponent left")?
                .seat = Some(Seat {
                handle: handle.clone(),
                player: 0,
            });
            registry.tickets.get_mut(token).ok_or("Player left")?.seat = Some(Seat {
                handle: handle.clone(),
                player: 1,
            });
            registry.invites.retain(|_, id| id != &other && id != token);
            registry.waiting.retain(|id| id != &other && id != token);
            registry.matches.push(handle);
        }
        Ok(())
    }
    pub fn cancel(&self, token: &str) {
        if let Ok(mut r) = self.registry.lock() {
            if let Some(seat) = r.tickets.get(token).and_then(|t| t.seat.as_ref()) {
                // Pairing can win the race with cancellation before the browser
                // receives match metadata. The ticket still authorizes leaving
                // the loading barrier, but cannot cancel a running battle.
                let _ = seat.handle.commands.try_send(worker::Action::CancelLoading);
            } else {
                r.tickets.remove(token);
                r.waiting.retain(|t| t != token);
                r.invites.retain(|_, t| t != token);
            }
        }
    }
}
impl Registry {
    fn clean(&mut self, now: Instant) {
        for t in self.tickets.values_mut().filter(|t| t.seat.is_none()) {
            t.sockets
                .retain(|_, seen| now.duration_since(*seen) < Duration::from_secs(15));
        }
        self.tickets.retain(|_, t| {
            (t.seat.is_some()
                || !t.sockets.is_empty()
                || now.duration_since(t.disconnected) < Duration::from_secs(10))
                && now.duration_since(t.created)
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

/// A queued connection owns its liveness lease. Disconnecting cannot remove a
/// newer socket's lease or an assigned player's reconnect ticket.
pub struct TicketSocket {
    hub: Arc<Hub>,
    token: String,
    id: uuid::Uuid,
}
impl TicketSocket {
    pub fn touch(&self) {
        if let Ok(mut r) = self.hub.registry.lock()
            && let Some(t) = r.tickets.get_mut(&self.token)
            && let Some(seen) = t.sockets.get_mut(&self.id)
        {
            *seen = Instant::now();
        }
    }
}
impl Drop for TicketSocket {
    fn drop(&mut self) {
        if let Ok(mut r) = self.hub.registry.lock()
            && let Some(t) = r.tickets.get_mut(&self.token)
        {
            t.sockets.remove(&self.id);
            if t.sockets.is_empty() {
                t.disconnected = Instant::now();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Arc<Hub> {
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = Arc::new(BTreeMap::from([(
            "fletcher".into(),
            Arc::new(CompiledShip::new(catalog.definitions["fletcher"].clone()).unwrap()),
        )]));
        let path =
            std::env::temp_dir().join(format!("naval-lobby-{}.sqlite", uuid::Uuid::new_v4()));
        Arc::new(Hub::new(
            catalog,
            compiled,
            Writer::open(&path, 8).unwrap(),
            2,
            None,
            vec![],
        ))
    }
    fn request(h: &Hub) -> Join {
        Join {
            fleet: vec!["fletcher".into()],
            version: h.version(),
            mode: JoinMode::Queue,
            invite_code: None,
        }
    }
    #[test]
    fn ghost_and_closed_tickets_do_not_consume_live_opponents() {
        let h = fixture();
        let ip = "192.0.2.1".parse().unwrap();
        let ghost = h.join(request(&h), ip).unwrap().ticket;
        let a = h.join(request(&h), ip).unwrap().ticket;
        let b = h.join(request(&h), ip).unwrap().ticket;
        let closed = h.attach(&ghost).unwrap();
        drop(closed);
        let _a = h.attach(&a).unwrap();
        let _b = h.attach(&b).unwrap();
        h.pair(&b).unwrap();
        {
            let r = h.registry.lock().unwrap();
            assert!(r.tickets[&ghost].seat.is_none());
            assert_eq!(
                r.tickets[&a].seat.as_ref().unwrap().handle.id,
                r.tickets[&b].seat.as_ref().unwrap().handle.id
            );
        }
        h.cancel(&a);
        h.registry
            .lock()
            .unwrap()
            .tickets
            .get_mut(&ghost)
            .unwrap()
            .disconnected = Instant::now() - Duration::from_secs(11);
        assert!(h.attach(&ghost).is_err());
    }
    #[test]
    fn per_client_rate_budgets_are_independent_and_globally_bounded() {
        let h = fixture();
        let a = "192.0.2.1".parse().unwrap();
        let b = "192.0.2.2".parse().unwrap();
        for _ in 0..10 {
            let t = h.join(request(&h), a).unwrap();
            h.cancel(&t.ticket);
        }
        assert!(h.join(request(&h), a).is_err());
        let t = h.join(request(&h), b).unwrap();
        h.cancel(&t.ticket);
        h.registry.lock().unwrap().global_rate.1 = 256;
        assert!(
            h.join(request(&h), b)
                .err()
                .unwrap()
                .contains("Global admission")
        );
    }
}

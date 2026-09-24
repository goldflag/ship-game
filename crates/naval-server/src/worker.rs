use crate::persistence::Writer;
use naval_protocol::{
    CommandEnvelope, FleetControl,
    frame::{Connection, Phase},
    session::Session,
};
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    rules::{EnvironmentSelection, FinishReason, Rules},
    vessel::CompiledShip,
};
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    time::{Duration, Instant},
};
use tokio::sync::{oneshot, watch};
#[derive(Clone)]
pub struct MatchHandle {
    pub content: axum::body::Bytes,
    pub content_hash: String,
    pub id: String,
    pub commands: SyncSender<Action>,
    pub frames: watch::Receiver<Arc<Frame>>,
    pub setup: Arc<BattleSetup>,
    /// The immutable match baseline as every client receives it with its
    /// metadata; each publication is a `FrameUpdate` against it.
    pub baseline: Arc<serde_json::Value>,
    pub environment: EnvironmentSelection,
    pub finished: Arc<AtomicBool>,
}
pub struct Frame {
    pub bytes: Vec<u8>,
    pub epochs: [u32; 2],
    pub phase: &'static str,
}
pub enum Action {
    Connect {
        player: usize,
        reply: oneshot::Sender<Result<u32, String>>,
    },
    Ready {
        player: usize,
        epoch: u32,
    },
    Disconnect {
        player: usize,
        epoch: u32,
    },
    Input {
        player: usize,
        epoch: u32,
        command: CommandEnvelope,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Surrender {
        player: usize,
        epoch: u32,
    },
    Heartbeat {
        player: usize,
        epoch: u32,
    },
    CancelLoading,
    Shutdown,
}
pub struct WorkerConfig {
    pub load_timeout: Duration,
    pub reconnect_grace: Duration,
    pub countdown: Duration,
    pub lag_budget: Duration,
    pub heartbeat_timeout: Duration,
}
impl Default for WorkerConfig {
    fn default() -> Self {
        let r = Rules::default();
        Self {
            load_timeout: Duration::from_secs(r.load_timeout_seconds),
            reconnect_grace: Duration::from_secs(r.reconnect_grace_seconds),
            countdown: Duration::from_secs(3),
            lag_budget: Duration::from_millis(500),
            heartbeat_timeout: Duration::from_secs(15),
        }
    }
}

struct Connections {
    loaded: [bool; 2],
    online: [bool; 2],
    last_seen: [Instant; 2],
    absent: [Option<Instant>; 2],
}
impl Connections {
    fn new(now: Instant) -> Self {
        Self {
            loaded: [false; 2],
            online: [false; 2],
            last_seen: [now; 2],
            absent: [None; 2],
        }
    }

    /// Explicit socket loss and heartbeat expiry make the same transition.
    /// A stale socket cannot disconnect its replacement or extend its grace.
    fn disconnect(
        &mut self,
        control: &mut FleetControl,
        input_ready: &mut [bool; 2],
        player: usize,
        epoch: u32,
        now: Instant,
    ) {
        if control.disconnect(player, epoch) {
            self.online[player] = false;
            self.loaded[player] = false;
            input_ready[player] = false;
            self.absent[player].get_or_insert(now);
        }
    }
}

// The worker's public frame retains its string field for transport callers.
fn phase_name(phase: Phase) -> &'static str {
    match phase {
        Phase::Loading => "loading",
        Phase::Countdown => "countdown",
        Phase::Running => "running",
        Phase::Finished => "finished",
        Phase::Cancelled => "cancelled",
    }
}
#[allow(clippy::too_many_arguments)]
pub fn spawn(
    id: String,
    setup: BattleSetup,
    environment: EnvironmentSelection,
    catalog: Arc<Catalog>,
    compiled: Arc<BTreeMap<String, Arc<CompiledShip>>>,
    writer: Writer,
    config: WorkerConfig,
) -> Result<MatchHandle, String> {
    let battle = Battle::new(catalog.clone(), &compiled, setup.clone())?;
    let session = Session::new(
        battle,
        [
            environment.first_player_team,
            environment.first_player_team.other(),
        ],
    )
    .map_err(|e| e.to_string())?;
    let (baseline_delta, baseline_json) = session
        .server_baseline(Connection {
            phase: Phase::Loading,
            reason: None,
            connected: [false, false],
            loaded: [false, false],
            countdown: None,
        })
        .map_err(|e| e.to_string())?;
    let baseline: Arc<serde_json::Value> =
        Arc::new(serde_json::from_str(&baseline_json).map_err(|e| e.to_string())?);
    let metadata = json!({"id":id,"status":"loading","setup":setup,"environment":environment,"simulationBuild":naval_sim::SIMULATION_BUILD,"manifestHash":catalog.manifest_hash,"rules":Rules::default()});
    writer.submit(id.clone(), metadata.clone(), false)?;
    let (tx, rx) = mpsc::sync_channel(256);
    let finished = Arc::new(AtomicBool::new(false));
    let initial = Arc::new(Frame {
        bytes: vec![],
        epochs: [1, 1],
        phase: "loading",
    });
    let (frames, receiver) = watch::channel(initial);
    let handle = MatchHandle {
        content: axum::body::Bytes::from_static(b"{\"artifacts\":[]}"),
        content_hash: naval_sim::catalog::sha256(b"{\"artifacts\":[]}"),
        id: id.clone(),
        commands: tx,
        frames: receiver,
        setup: Arc::new(setup),
        baseline: baseline.clone(),
        environment,
        finished: finished.clone(),
    };
    let mut abort_record = metadata.clone();
    abort_record["status"] = json!("infrastructure-abort");
    abort_record["abortReason"] = json!("worker-panic");
    let completion = CompletionGuard {
        id: id.clone(),
        writer: writer.clone(),
        finished: finished.clone(),
        abort_record,
        committed: false,
    };
    std::thread::Builder::new()
        .name(format!("match-{id}"))
        .spawn(move || {
            let mut completion = completion;
            let mut session = session;
            session.input_ready = [false; 2];
            let mut record = metadata;
            let mut phase = Phase::Loading;
            let mut reason = None::<String>;
            let mut connections = Connections::new(Instant::now());
            let created = Instant::now();
            let mut countdown = None;
            let mut start = None;
            let mut last_publish = created - Duration::from_secs(1);
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                while !matches!(phase, Phase::Finished | Phase::Cancelled) {
                    let now = Instant::now();
                    for action in rx.try_iter().take(256) {
                        if matches!(phase, Phase::Finished | Phase::Cancelled) {
                            break;
                        }
                        match action {
                            Action::Connect { player, reply } => {
                                let epoch =
                                    session.control.reconnect(player).map_err(|e| e.to_string());
                                if epoch.is_ok() {
                                    connections.online[player] = true;
                                    connections.last_seen[player] = now;
                                    connections.loaded[player] = false;
                                    session.input_ready[player] = false;
                                    if phase == Phase::Running {
                                        connections.absent[player].get_or_insert(now);
                                    }
                                }
                                let _ = reply.send(epoch);
                            }
                            Action::Ready { player, epoch } => {
                                if session.control.players[player].epoch == epoch
                                    && connections.online[player]
                                {
                                    connections.loaded[player] = true;
                                    connections.last_seen[player] = now;
                                    session.input_ready[player] = true;
                                    connections.absent[player] = None;
                                }
                            }
                            Action::Disconnect { player, epoch } => {
                                connections.disconnect(
                                    &mut session.control,
                                    &mut session.input_ready,
                                    player,
                                    epoch,
                                    now,
                                );
                            }
                            Action::Input {
                                player,
                                epoch,
                                command,
                                reply,
                            } => {
                                if command.connection_epoch == epoch
                                    && session.control.players[player].epoch == epoch
                                    && connections.online[player]
                                {
                                    connections.last_seen[player] = now;
                                }
                                let accepted =
                                    if phase != Phase::Running || !connections.loaded[player] {
                                        Err("Battle is not ready".into())
                                    } else if command.connection_epoch != epoch {
                                        Err("Connection has been replaced".into())
                                    } else {
                                        session.apply(player, command).map_err(|e| e.to_string())
                                    };
                                let _ = reply.send(accepted);
                            }
                            Action::Surrender { player, epoch } => {
                                if session.control.players[player].epoch == epoch
                                    && connections.online[player]
                                {
                                    if phase == Phase::Running {
                                        session.finish(
                                            Some(session.owners[1 - player]),
                                            FinishReason::Forfeit,
                                        );
                                        phase = Phase::Finished
                                    } else {
                                        phase = Phase::Cancelled;
                                        reason = Some("Player left before battle".into());
                                    }
                                }
                            }
                            Action::Heartbeat { player, epoch } => {
                                if session.control.players[player].epoch == epoch {
                                    connections.last_seen[player] = now;
                                }
                            }
                            Action::CancelLoading => {
                                if matches!(phase, Phase::Loading | Phase::Countdown) {
                                    phase = Phase::Cancelled;
                                    reason = Some("Player left before battle".into());
                                }
                            }
                            Action::Shutdown => {
                                if phase == Phase::Running {
                                    session.finish(None, FinishReason::Infrastructure);
                                    phase = Phase::Finished
                                } else {
                                    phase = Phase::Cancelled;
                                    reason = Some("Server shutting down".into());
                                }
                            }
                        }
                    }
                    for player in 0..2 {
                        if connections.online[player]
                            && now.duration_since(connections.last_seen[player])
                                > config.heartbeat_timeout
                        {
                            let epoch = session.control.players[player].epoch;
                            connections.disconnect(
                                &mut session.control,
                                &mut session.input_ready,
                                player,
                                epoch,
                                now,
                            );
                        }
                    }
                    if phase == Phase::Loading {
                        if connections.loaded.iter().all(|v| *v) {
                            phase = Phase::Countdown;
                            countdown = Some(now + config.countdown)
                        } else if now.duration_since(created) >= config.load_timeout {
                            phase = Phase::Cancelled;
                            reason =
                                Some("Loading timed out; no battle result was recorded".into());
                        }
                    }
                    if phase == Phase::Countdown {
                        if !connections.loaded.iter().all(|v| *v) {
                            phase = Phase::Loading;
                            countdown = None
                        } else if now >= countdown.unwrap() {
                            phase = Phase::Running;
                            start = Some(now);
                        }
                    }
                    if phase == Phase::Running {
                        let expired = connections.absent.map(|t| {
                            t.is_some_and(|t| now.duration_since(t) >= config.reconnect_grace)
                        });
                        if expired.iter().all(|x| *x) {
                            session.finish(None, FinishReason::Abandoned)
                        } else if expired[0] || expired[1] {
                            let missing = usize::from(!expired[0]);
                            session.finish(Some(session.owners[1 - missing]), FinishReason::Forfeit)
                        }
                        if session.battle.outcome.is_none() {
                            let elapsed = now.duration_since(start.unwrap());
                            let due = (elapsed.as_secs_f64() * 60.0).floor() as u64;
                            let lag = elapsed.as_secs_f64() - session.battle.tick as f64 / 60.0;
                            if lag > config.lag_budget.as_secs_f64() {
                                session.finish(None, FinishReason::Infrastructure);
                                reason = Some("Server simulation exceeded its lag budget".into());
                            } else {
                                for _ in 0..due.saturating_sub(session.battle.tick).min(6) {
                                    session.step();
                                    if session.battle.outcome.is_some() {
                                        break;
                                    }
                                }
                            }
                        }
                        if session.battle.outcome.is_some() {
                            phase = Phase::Finished;
                        }
                    }
                    if now.duration_since(last_publish) >= Duration::from_millis(50)
                        || matches!(phase, Phase::Finished | Phase::Cancelled)
                    {
                        publish(
                            &session,
                            &baseline_delta,
                            phase,
                            reason.as_deref(),
                            connections.loaded,
                            connections.online,
                            countdown.map(|t| t.saturating_duration_since(now).as_secs_f64()),
                            &frames,
                        )?;
                        last_publish = now;
                    }
                    if !matches!(phase, Phase::Finished | Phase::Cancelled) {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                }
                Ok::<_, String>(())
            }));
            if !matches!(result, Ok(Ok(()))) {
                session.finish(None, FinishReason::Infrastructure);
                phase = Phase::Finished;
                reason = Some("Match worker failed".into());
                let _ = publish(
                    &session,
                    &baseline_delta,
                    phase,
                    reason.as_deref(),
                    connections.loaded,
                    connections.online,
                    None,
                    &frames,
                );
            }
            record["status"] = json!(phase);
            record["outcome"] = json!(session.battle.outcome);
            record["abortReason"] = json!(reason);
            record["records"] = json!(session.battle.records);
            // The slot stays reserved if durable results cannot be accepted. This prevents
            // an outage from growing an unbounded in-memory retry backlog.
            while writer.submit(id.clone(), record.clone(), true).is_err() {
                std::thread::sleep(Duration::from_secs(1));
            }
            drop(rx);
            // Results have been persisted at the deciding tick. Keep publishing
            // the aftermath while clients show their return-to-port countdown.
            if session.battle.outcome.as_ref().is_some_and(|o| {
                matches!(
                    o.reason,
                    FinishReason::Destruction | FinishReason::TimeLimit
                )
            }) {
                let aftermath_start = Instant::now();
                let final_tick = session.battle.tick;
                while aftermath_start.elapsed() < Duration::from_secs(16) {
                    let due = (aftermath_start.elapsed().as_secs_f64() * 60.0) as u64;
                    for _ in 0..due.saturating_sub(session.battle.tick - final_tick).min(6) {
                        session.battle.step_aftermath();
                    }
                    if last_publish.elapsed() >= Duration::from_millis(50) {
                        if publish(
                            &session,
                            &baseline_delta,
                            phase,
                            reason.as_deref(),
                            connections.loaded,
                            connections.online,
                            None,
                            &frames,
                        )
                        .is_err()
                        {
                            break;
                        }
                        last_publish = Instant::now();
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            completion.committed = true;
        })
        .map_err(|e| e.to_string())?;
    Ok(handle)
}
// Last-resort cleanup also covers panic recovery/serialization panicking.
struct CompletionGuard {
    id: String,
    writer: Writer,
    finished: Arc<AtomicBool>,
    abort_record: serde_json::Value,
    committed: bool,
}
impl Drop for CompletionGuard {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self
                .writer
                .submit(self.id.clone(), self.abort_record.clone(), true);
        }
        self.finished.store(true, Ordering::Release);
    }
}
#[allow(clippy::too_many_arguments)]
fn publish(
    session: &Session,
    baseline: &naval_sim::frame_delta::FrameDelta,
    phase: Phase,
    reason: Option<&str>,
    loaded: [bool; 2],
    online: [bool; 2],
    countdown: Option<f64>,
    tx: &watch::Sender<Arc<Frame>>,
) -> Result<(), String> {
    let epochs = std::array::from_fn(|i| session.control.players[i].epoch);
    let frame = session.server_frame(Connection {
        phase,
        reason,
        connected: online,
        loaded,
        countdown,
    });
    let bytes = crate::encoding::publish_bytes(baseline, session.battle.tick, &frame)?;
    tx.send_replace(Arc::new(Frame {
        bytes,
        epochs,
        phase: phase_name(phase),
    }));
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use naval_sim::{battle::ShipSetup, bots::AiLevel, rules::TeamId, vessel::Controller};

    #[test]
    fn disconnect_preserves_replacement_epoch_and_original_grace() {
        let now = Instant::now();
        let mut connections = Connections::new(now);
        let mut control = FleetControl::new([("ship-0".into(), 0), ("ship-1".into(), 1)]).unwrap();
        let mut input_ready = [true; 2];
        connections.online = [true; 2];
        connections.loaded = [true; 2];
        let epoch = control.players[0].epoch;

        connections.disconnect(&mut control, &mut input_ready, 0, epoch, now);
        assert_eq!(connections.online, [false, true]);
        assert_eq!(connections.loaded, [false, true]);
        assert_eq!(input_ready, [false, true]);
        assert_eq!(connections.absent, [Some(now), None]);

        // A replacement is still loading. Losing it must not restart the grace
        // that began at the original disconnect; only Ready clears that clock.
        let replacement = control.reconnect(0).unwrap();
        connections.online[0] = true;
        let later = now + Duration::from_secs(5);
        connections.disconnect(&mut control, &mut input_ready, 0, epoch, later);
        assert!(connections.online[0]);
        connections.disconnect(&mut control, &mut input_ready, 0, replacement, later);
        assert!(!connections.online[0]);
        assert_eq!(connections.absent[0], Some(now));
    }

    /// What a client holds after one update: the baseline it received with
    /// its metadata, patched.
    async fn frame(handle: &mut MatchHandle, phase: &str) -> serde_json::Value {
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                let f = handle.frames.borrow().clone();
                if f.phase == phase && !f.bytes.is_empty() {
                    let mut decoder = flate2::read::GzDecoder::new(f.bytes.as_slice());
                    let update: naval_sim::frame_delta::FrameUpdate =
                        serde_json::from_reader(&mut decoder).unwrap();
                    let mut value = (*handle.baseline).clone();
                    assert_eq!(update.base_tick, value["tick"].as_u64());
                    if let Some(delta) = &update.delta {
                        naval_sim::frame_delta::apply(&mut value, delta);
                    }
                    assert_eq!(value["tick"], update.tick);
                    return value;
                }
                handle.frames.changed().await.unwrap();
            }
        })
        .await
        .unwrap()
    }
    async fn connect(h: &MatchHandle, player: usize) -> u32 {
        let (reply, rx) = oneshot::channel();
        h.commands.send(Action::Connect { player, reply }).unwrap();
        tokio::time::timeout(Duration::from_secs(3), rx)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }
    fn fixture(config: WorkerConfig) -> MatchHandle {
        fixture_with_rules(config, None)
    }
    fn fixture_with_rules(
        config: WorkerConfig,
        mission_rules: Option<naval_sim::mission::MissionRules>,
    ) -> MatchHandle {
        let catalog = Arc::new(Catalog::load(&naval_sim::catalog::installed_manifest()).unwrap());
        let compiled = Arc::new(BTreeMap::from([(
            "fletcher".into(),
            Arc::new(catalog.compile("fletcher").unwrap()),
        )]));
        let setup = BattleSetup {
            ships: [TeamId::A, TeamId::B]
                .into_iter()
                .enumerate()
                .map(|(i, team)| ShipSetup {
                    id: format!("ship-{i}"),
                    preset_id: "fletcher".into(),
                    team,
                    controller: Controller::Bot,
                    ai_level: AiLevel::Normal,
                    spawn: None,
                })
                .collect(),
            seed: 5739,
            map_id: "north-atlantic".into(),
            weather: "clear".into(),
            spawn_distance: 5000.0,
            wind_speed: None,
            mission_rules,
            air_rules: None,
        };
        let id = uuid::Uuid::new_v4().to_string();
        let writer = Writer::memory(8).0;
        spawn(
            id,
            setup,
            EnvironmentSelection {
                map_id: "north-atlantic".into(),
                weather: "clear".into(),
                time_of_day: "morning".into(),
                sea_seed: 5739,
                first_player_team: TeamId::A,
            },
            catalog,
            compiled,
            writer,
            config,
        )
        .unwrap()
    }
    #[tokio::test]
    async fn finished_match_streams_aftermath_with_the_outcome_locked() {
        let mut rules: naval_sim::mission::MissionRules =
            serde_json::from_str(include_str!("../../../assets/gameplay/pve-mission.v1.json"))
                .unwrap();
        rules.duration_seconds = Some(1);
        let mut h = fixture_with_rules(
            WorkerConfig {
                load_timeout: Duration::from_secs(5),
                reconnect_grace: Duration::from_secs(5),
                countdown: Duration::from_millis(10),
                lag_budget: Duration::from_secs(3),
                heartbeat_timeout: Duration::from_secs(15),
            },
            Some(rules),
        );
        for player in 0..2 {
            let epoch = connect(&h, player).await;
            h.commands.send(Action::Ready { player, epoch }).unwrap();
        }
        let finished = frame(&mut h, "finished").await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        let aftermath = frame(&mut h, "finished").await;
        assert!(aftermath["tick"].as_u64().unwrap() > finished["tick"].as_u64().unwrap());
        assert_eq!(aftermath["outcome"], finished["outcome"]);
    }
    #[tokio::test]
    async fn load_barrier_reconnect_epochs_and_forfeit() {
        let mut h = fixture(WorkerConfig {
            load_timeout: Duration::from_secs(5),
            reconnect_grace: Duration::from_millis(450),
            countdown: Duration::from_millis(10),
            lag_budget: Duration::from_secs(3),
            heartbeat_timeout: Duration::from_secs(15),
        });
        let a = connect(&h, 0).await;
        let b = connect(&h, 1).await;
        h.commands
            .send(Action::Ready {
                player: 0,
                epoch: a,
            })
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(frame(&mut h, "loading").await["tick"], 0);
        h.commands
            .send(Action::Ready {
                player: 1,
                epoch: b,
            })
            .unwrap();
        let running = frame(&mut h, "running").await;
        assert!(running["actors"][0].get("bot").is_none());
        h.commands
            .send(Action::Disconnect {
                player: 0,
                epoch: a,
            })
            .unwrap();
        let replacement = connect(&h, 0).await;
        assert!(replacement > a);
        h.commands
            .send(Action::Ready {
                player: 0,
                epoch: replacement,
            })
            .unwrap();
        h.commands
            .send(Action::Disconnect {
                player: 0,
                epoch: a,
            })
            .unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        let resumed = frame(&mut h, "running").await;
        assert_eq!(resumed["connected"][0], true);
        assert!(resumed["tick"].as_u64().unwrap() > running["tick"].as_u64().unwrap());
        h.commands
            .send(Action::Disconnect {
                player: 0,
                epoch: replacement,
            })
            .unwrap();
        let finished = frame(&mut h, "finished").await;
        assert_eq!(finished["outcome"]["winnerTeamId"], "b");
        assert_eq!(finished["outcome"]["reason"], "forfeit");
        let tick = finished["tick"].clone();
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert_eq!(frame(&mut h, "finished").await["tick"], tick);
    }
    #[tokio::test]
    async fn epoch_valid_commands_keep_a_player_live_without_heartbeats() {
        let mut h = fixture(WorkerConfig {
            countdown: Duration::ZERO,
            heartbeat_timeout: Duration::from_millis(100),
            reconnect_grace: Duration::from_secs(2),
            ..Default::default()
        });
        let a = connect(&h, 0).await;
        let b = connect(&h, 1).await;
        for (player, epoch) in [(0, a), (1, b)] {
            h.commands.send(Action::Ready { player, epoch }).unwrap();
        }
        frame(&mut h, "running").await;
        for sequence in 1..=8 {
            for (player, epoch) in [(0, a), (1, b)] {
                let (reply, response) = oneshot::channel();
                h.commands
                    .send(Action::Input {
                        player,
                        epoch,
                        command: CommandEnvelope {
                            sequence,
                            connection_epoch: epoch,
                            ship_id: format!("ship-{player}"),
                            command: naval_protocol::Command::Hold,
                        },
                        reply,
                    })
                    .unwrap();
                assert!(response.await.unwrap().is_ok());
            }
            tokio::time::sleep(Duration::from_millis(35)).await;
        }
        assert_eq!(
            frame(&mut h, "running").await["connected"],
            json!([true, true])
        );
        h.commands.send(Action::Shutdown).unwrap();
        assert_eq!(
            frame(&mut h, "finished").await["outcome"]["reason"],
            "infrastructure"
        );
    }
    #[test]
    fn panic_guard_releases_slot_and_persists_abort() {
        let (writer, records) = Writer::memory(8);
        let finished = Arc::new(AtomicBool::new(false));
        let guard = CompletionGuard {
            id: "panic".into(),
            writer: writer.clone(),
            finished: finished.clone(),
            abort_record: json!({"status":"infrastructure-abort","abortReason":"worker-panic"}),
            committed: false,
        };
        assert!(
            std::thread::spawn(move || {
                let _guard = guard;
                panic!("injected finalization failure");
            })
            .join()
            .is_err()
        );
        assert!(finished.load(Ordering::Acquire));
        writer.flush().unwrap();
        let records = records.lock().unwrap();
        let (_, record, finished) = records
            .iter()
            .find(|(id, _, _)| id == "panic")
            .expect("the guard persists an abort record");
        assert!(finished);
        assert_eq!(record["abortReason"], "worker-panic");
    }
    #[tokio::test]
    async fn first_terminal_action_survives_later_surrenders_and_shutdown() {
        let mut h = fixture(WorkerConfig {
            countdown: Duration::ZERO,
            ..Default::default()
        });
        let a = connect(&h, 0).await;
        let b = connect(&h, 1).await;
        h.commands
            .send(Action::Ready {
                player: 0,
                epoch: a,
            })
            .unwrap();
        h.commands
            .send(Action::Ready {
                player: 1,
                epoch: b,
            })
            .unwrap();
        frame(&mut h, "running").await;
        h.commands
            .send(Action::Surrender {
                player: 0,
                epoch: a,
            })
            .unwrap();
        let _ = h.commands.send(Action::Surrender {
            player: 1,
            epoch: b,
        });
        let _ = h.commands.send(Action::Shutdown);
        let result = frame(&mut h, "finished").await;
        assert_eq!(result["outcome"]["reason"], "forfeit");
        assert_eq!(result["outcome"]["winnerTeamId"], "b");
    }
    #[tokio::test]
    async fn cancellation_after_pairing_does_not_wait_for_the_load_deadline() {
        let mut h = fixture(WorkerConfig::default());
        h.commands.send(Action::CancelLoading).unwrap();
        let cancelled = frame(&mut h, "cancelled").await;
        assert_eq!(cancelled["tick"], 0);
        assert!(cancelled["outcome"].is_null());
    }
    #[tokio::test]
    async fn load_failure_has_no_competitive_result() {
        let mut h = fixture(WorkerConfig {
            load_timeout: Duration::from_millis(100),
            ..Default::default()
        });
        let cancelled = frame(&mut h, "cancelled").await;
        assert_eq!(cancelled["tick"], 0);
        assert!(cancelled["outcome"].is_null());
    }
}

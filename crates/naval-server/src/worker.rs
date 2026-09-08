use crate::persistence::Writer;
use naval_protocol::{CommandEnvelope, session::Session};
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
    pub id: String,
    pub commands: SyncSender<Action>,
    pub frames: watch::Receiver<Arc<Frame>>,
    pub setup: Arc<BattleSetup>,
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
    Shutdown,
}
pub struct WorkerConfig {
    pub load_timeout: Duration,
    pub reconnect_grace: Duration,
    pub countdown: Duration,
    pub lag_budget: Duration,
}
impl Default for WorkerConfig {
    fn default() -> Self {
        let r = Rules::default();
        Self {
            load_timeout: Duration::from_secs(r.load_timeout_seconds),
            reconnect_grace: Duration::from_secs(r.reconnect_grace_seconds),
            countdown: Duration::from_secs(3),
            lag_budget: Duration::from_millis(500),
        }
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
    let baseline = Arc::new(
        session
            .battle
            .presentation_value()
            .map_err(|e| e.to_string())?,
    );
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
        id: id.clone(),
        commands: tx,
        frames: receiver,
        setup: Arc::new(setup),
        baseline: baseline.clone(),
        environment,
        finished: finished.clone(),
    };
    std::thread::Builder::new()
        .name(format!("match-{id}"))
        .spawn(move || {
            let mut session = session;
            session.input_ready = [false; 2];
            let mut record = metadata;
            let mut phase = "loading";
            let mut reason = None::<String>;
            let mut loaded = [false; 2];
            let mut online = [false; 2];
            let mut last_seen = [Instant::now(); 2];
            let mut absent = [None::<Instant>; 2];
            let created = Instant::now();
            let mut countdown = None;
            let mut start = None;
            let mut last_publish = created - Duration::from_secs(1);
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                while !matches!(phase, "finished" | "cancelled") {
                    let now = Instant::now();
                    for action in rx.try_iter().take(256) {
                        match action {
                            Action::Connect { player, reply } => {
                                let epoch =
                                    session.control.reconnect(player).map_err(|e| e.to_string());
                                if epoch.is_ok() {
                                    online[player] = true;
                                    last_seen[player] = now;
                                    loaded[player] = false;
                                    session.input_ready[player] = false;
                                    if phase == "running" {
                                        absent[player].get_or_insert(now);
                                    }
                                }
                                let _ = reply.send(epoch);
                            }
                            Action::Ready { player, epoch } => {
                                if session.control.players[player].epoch == epoch && online[player]
                                {
                                    loaded[player] = true;
                                    last_seen[player] = now;
                                    session.input_ready[player] = true;
                                    absent[player] = None;
                                }
                            }
                            Action::Disconnect { player, epoch } => {
                                if session.control.disconnect(player, epoch) {
                                    online[player] = false;
                                    loaded[player] = false;
                                    session.input_ready[player] = false;
                                    absent[player].get_or_insert(now);
                                }
                            }
                            Action::Input {
                                player,
                                epoch,
                                command,
                                reply,
                            } => {
                                let accepted = if phase != "running" || !loaded[player] {
                                    Err("Battle is not ready".into())
                                } else if command.connection_epoch != epoch {
                                    Err("Connection has been replaced".into())
                                } else {
                                    session.apply(player, command).map_err(|e| e.to_string())
                                };
                                let _ = reply.send(accepted);
                            }
                            Action::Surrender { player, epoch } => {
                                if session.control.players[player].epoch == epoch && online[player]
                                {
                                    if phase == "running" {
                                        session.finish(
                                            Some(session.owners[1 - player]),
                                            FinishReason::Forfeit,
                                        );
                                        phase = "finished"
                                    } else {
                                        phase = "cancelled";
                                        reason = Some("Player left before battle".into());
                                    }
                                }
                            }
                            Action::Heartbeat { player, epoch } => {
                                if session.control.players[player].epoch == epoch {
                                    last_seen[player] = now;
                                }
                            }
                            Action::Shutdown => {
                                if phase == "running" {
                                    session.finish(None, FinishReason::Infrastructure);
                                    phase = "finished"
                                } else {
                                    phase = "cancelled";
                                    reason = Some("Server shutting down".into());
                                }
                            }
                        }
                    }
                    for player in 0..2 {
                        if online[player]
                            && now.duration_since(last_seen[player]) > Duration::from_secs(15)
                        {
                            let epoch = session.control.players[player].epoch;
                            session.control.disconnect(player, epoch);
                            online[player] = false;
                            loaded[player] = false;
                            session.input_ready[player] = false;
                            absent[player].get_or_insert(now);
                        }
                    }
                    if phase == "loading" {
                        if loaded.iter().all(|v| *v) {
                            phase = "countdown";
                            countdown = Some(now + config.countdown)
                        } else if now.duration_since(created) >= config.load_timeout {
                            phase = "cancelled";
                            reason =
                                Some("Loading timed out; no battle result was recorded".into());
                        }
                    }
                    if phase == "countdown" {
                        if !loaded.iter().all(|v| *v) {
                            phase = "loading";
                            countdown = None
                        } else if now >= countdown.unwrap() {
                            phase = "running";
                            start = Some(now);
                        }
                    }
                    if phase == "running" {
                        let expired = absent.map(|t| {
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
                            phase = "finished";
                        }
                    }
                    if now.duration_since(last_publish) >= Duration::from_millis(50)
                        || matches!(phase, "finished" | "cancelled")
                    {
                        publish(
                            &session,
                            &baseline,
                            phase,
                            reason.as_deref(),
                            loaded,
                            online,
                            countdown.map(|t| t.saturating_duration_since(now).as_secs_f64()),
                            &frames,
                        )?;
                        last_publish = now;
                    }
                    if !matches!(phase, "finished" | "cancelled") {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                }
                Ok::<_, String>(())
            }));
            if !matches!(result, Ok(Ok(()))) {
                session.finish(None, FinishReason::Infrastructure);
                phase = "finished";
                reason = Some("Match worker failed".into());
                let _ = publish(
                    &session,
                    &baseline,
                    phase,
                    reason.as_deref(),
                    loaded,
                    online,
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
            finished.store(true, Ordering::Release);
        })
        .map_err(|e| e.to_string())?;
    Ok(handle)
}
#[allow(clippy::too_many_arguments)]
fn publish(
    session: &Session,
    baseline: &serde_json::Value,
    phase: &'static str,
    reason: Option<&str>,
    loaded: [bool; 2],
    online: [bool; 2],
    countdown: Option<f64>,
    tx: &watch::Sender<Arc<Frame>>,
) -> Result<(), String> {
    let mut data = session
        .battle
        .presentation_value()
        .map_err(|e| e.to_string())?;
    let epochs = std::array::from_fn(|i| session.control.players[i].epoch);
    let selected: Vec<_> = session
        .control
        .players
        .iter()
        .map(|p| &p.selected_ship_id)
        .collect();
    let root = data.as_object_mut().unwrap();
    root.insert("type".into(), json!("snapshot"));
    root.insert("phase".into(), json!(phase));
    root.insert("reason".into(), json!(reason));
    root.insert("loaded".into(), json!(loaded));
    root.insert("connected".into(), json!(online));
    root.insert("countdown".into(), json!(countdown));
    root.insert("selectedShipIds".into(), json!(selected));
    root.insert("connectionEpochs".into(), json!(epochs));
    let bytes = crate::encoding::delta_bytes(baseline, &data)?;
    tx.send_replace(Arc::new(Frame {
        bytes,
        epochs,
        phase,
    }));
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use naval_sim::{battle::ShipSetup, bots::AiLevel, rules::TeamId, vessel::Controller};
    async fn frame(handle: &mut MatchHandle, phase: &str) -> serde_json::Value {
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                let f = handle.frames.borrow().clone();
                if f.phase == phase && !f.bytes.is_empty() {
                    let mut decoder = flate2::read::GzDecoder::new(f.bytes.as_slice());
                    let delta: serde_json::Value = serde_json::from_reader(&mut decoder).unwrap();
                    let mut value = (*handle.baseline).clone();
                    for patch in delta["patches"].as_array().unwrap() {
                        let mut target = &mut value;
                        for key in patch[0].as_array().unwrap() {
                            target = if let Some(index) = key.as_u64() {
                                &mut target[index as usize]
                            } else {
                                &mut target[key.as_str().unwrap()]
                            };
                        }
                        *target = patch[1].clone();
                    }
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
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = Arc::new(BTreeMap::from([(
            "fletcher".into(),
            Arc::new(CompiledShip::new(catalog.definitions["fletcher"].clone()).unwrap()),
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
        };
        let id = uuid::Uuid::new_v4().to_string();
        let path = std::env::temp_dir().join(format!("naval-worker-{id}.sqlite"));
        let writer = Writer::open(&path, 8).unwrap();
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
    async fn load_barrier_reconnect_epochs_and_forfeit() {
        let mut h = fixture(WorkerConfig {
            load_timeout: Duration::from_secs(5),
            reconnect_grace: Duration::from_millis(450),
            countdown: Duration::from_millis(10),
            lag_budget: Duration::from_secs(3),
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

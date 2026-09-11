mod encoding;
mod hub;
mod persistence;
mod worker;
use axum::{
    Json, Router,
    extract::{
        ConnectInfo, DefaultBodyLimit, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use hub::{Hub, Version};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::BTreeMap,
    net::SocketAddr,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum ClientMessage {
    Hello {
        ticket: String,
        version: Version,
    },
    Ready {
        version: Version,
    },
    Command {
        envelope: naval_protocol::CommandEnvelope,
    },
    Surrender,
    Cancel,
    Ping {
        nonce: u32,
    },
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = std::env::var("NAVAL_MANIFEST")
        .unwrap_or_else(|_| ".build/naval-content/manifest.json".into());
    let catalog = Arc::new(naval_sim::catalog::Catalog::load(&std::fs::read(
        manifest,
    )?)?);
    let compiled: BTreeMap<_, _> = catalog
        .definitions
        .iter()
        .map(|(id, d)| {
            Ok((
                id.clone(),
                Arc::new(naval_sim::vessel::CompiledShip::new(
                    d.clone(),
                    catalog.hydrostatics.get(id),
                )?),
            ))
        })
        .collect::<Result<_, String>>()?;
    let max_matches = std::env::var("NAVAL_MAX_MATCHES")
        .ok()
        .map(|s| s.parse::<usize>())
        .transpose()?
        .unwrap_or(2);
    if !(1..=32).contains(&max_matches) {
        return Err("NAVAL_MAX_MATCHES must be between 1 and 32".into());
    }
    let writer = persistence::Writer::open(
        std::path::Path::new(
            &std::env::var("NAVAL_DATABASE")
                .unwrap_or_else(|_| ".naval-data/matches.sqlite".into()),
        ),
        max_matches * 4 + 32,
    )?;
    let state = Arc::new(Hub::new(
        catalog,
        Arc::new(compiled),
        writer,
        max_matches,
        std::env::var("NAVAL_ORIGIN").ok(),
        std::env::var("NAVAL_TRUSTED_PROXIES")
            .unwrap_or_default()
            .split(',')
            .filter(|v| !v.trim().is_empty())
            .map(|v| v.trim().parse())
            .collect::<Result<Vec<_>, _>>()?,
    ));
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/content", get(content))
        .route("/api/join", post(join))
        .route("/api/cancel", post(cancel))
        .route("/api/socket", get(socket))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(state.clone());
    let bind = std::env::var("NAVAL_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!(
        "Naval server listening on {bind}; {max_matches} match slots; build {}",
        naval_sim::SIMULATION_BUILD
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown(state))
    .await?;
    Ok(())
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Cancel {
    ticket: String,
}
async fn cancel(
    State(s): State<Arc<Hub>>,
    headers: HeaderMap,
    Json(request): Json<Cancel>,
) -> StatusCode {
    if !origin(&headers, &s) || request.ticket.len() != 64 {
        return StatusCode::BAD_REQUEST;
    }
    s.cancel(&request.ticket);
    StatusCode::NO_CONTENT
}
async fn health(State(s): State<Arc<Hub>>) -> impl IntoResponse {
    let healthy = s.writer.healthy.load(Ordering::Acquire) && !s.draining.load(Ordering::Acquire);
    let active = s
        .registry
        .lock()
        .map(|r| {
            r.matches
                .iter()
                .filter(|m| !m.finished.load(Ordering::Acquire))
                .count()
        })
        .unwrap_or(s.max_matches);
    (
        if healthy {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(json!({"ready":healthy,"activeMatches":active,"maxMatches":s.max_matches})),
    )
}
async fn content(State(s): State<Arc<Hub>>) -> Json<serde_json::Value> {
    Json(
        json!({"version":s.version(),"rules":naval_sim::rules::Rules::default(),"ships":s.catalog.fleet_entries.values().collect::<Vec<_>>()}),
    )
}
fn origin(headers: &HeaderMap, s: &Hub) -> bool {
    let Some(value) = headers.get("origin") else {
        return true;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    if let Some(allowed) = &s.origin {
        return value == allowed;
    }
    let Ok(uri) = value.parse::<axum::http::Uri>() else {
        return false;
    };
    matches!(uri.scheme_str(), Some("http" | "https"))
        && uri
            .authority()
            .is_some_and(|a| headers.get("host").and_then(|h| h.to_str().ok()) == Some(a.as_str()))
}
async fn join(
    State(s): State<Arc<Hub>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<hub::Join>,
) -> Response {
    if !origin(&headers, &s) {
        return (StatusCode::FORBIDDEN, "Origin is not allowed").into_response();
    }
    match s.join(request, client_ip(&headers, addr.ip(), &s.trusted_proxies)) {
        Ok(admission) => Json(admission).into_response(),
        Err(message) => (StatusCode::BAD_REQUEST, Json(json!({"error":message}))).into_response(),
    }
}
async fn socket(State(s): State<Arc<Hub>>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if !origin(&headers, &s) {
        return (StatusCode::FORBIDDEN, "Origin is not allowed").into_response();
    }
    let Ok(slot) = s.sockets.clone().try_acquire_owned() else {
        return (StatusCode::TOO_MANY_REQUESTS, "Too many connections").into_response();
    };
    ws.max_message_size(8192)
        .max_frame_size(8192)
        .on_upgrade(move |socket| async move {
            let _slot = slot;
            serve_socket(socket, s).await
        })
}
async fn send(socket: &mut WebSocket, value: serde_json::Value) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(2),
            socket.send(Message::Text(value.to_string().into()))
        )
        .await,
        Ok(Ok(()))
    )
}
async fn binary(socket: &mut WebSocket, frame: &worker::Frame) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(2),
            socket.send(Message::Binary(frame.bytes.clone().into()))
        )
        .await,
        Ok(Ok(()))
    )
}
async fn matched(
    socket: &mut WebSocket,
    s: &Hub,
    handle: &worker::MatchHandle,
    player: usize,
    epoch: u32,
) -> bool {
    let metadata = json!({"type":"matched","matchId":handle.id,"player":player,
        "team":if player==0 {handle.environment.first_player_team} else {handle.environment.first_player_team.other()},
        "connectionEpoch":epoch,"version":s.version(),"setup":handle.setup,"environment":handle.environment,"baseline":handle.baseline});
    let Ok(mut bytes) = encoding::snapshot_bytes(&metadata) else {
        return false;
    };
    bytes.insert(0, 0); // Protocol 3: non-droppable compressed metadata frame.
    bytes.len() <= 8 * 1024 * 1024
        && matches!(
            tokio::time::timeout(
                Duration::from_secs(15),
                socket.send(Message::Binary(bytes.into()))
            )
            .await,
            Ok(Ok(()))
        )
}
struct Rate {
    started: std::time::Instant,
    count: u32,
}
impl Rate {
    fn new() -> Self {
        Self {
            started: std::time::Instant::now(),
            count: 0,
        }
    }
    fn take(&mut self) -> bool {
        if self.started.elapsed() >= Duration::from_secs(1) {
            self.started = std::time::Instant::now();
            self.count = 0;
        }
        self.count += 1;
        self.count <= 90
    }
}
async fn serve_socket(mut socket: WebSocket, s: Arc<Hub>) {
    let hello = tokio::time::timeout(Duration::from_secs(5), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = hello else {
        return;
    };
    let Ok(ClientMessage::Hello { ticket, version }) = serde_json::from_str(&text) else {
        return;
    };
    if ticket.len() != 64 || !version.matches(&s.catalog) {
        send(
            &mut socket,
            json!({"type":"error","message":"Session or content mismatch"}),
        )
        .await;
        return;
    }
    let ticket_socket = match s.attach(&ticket) {
        Ok(lease) => lease,
        Err(message) => {
            send(&mut socket, json!({"type":"error","message":message})).await;
            return;
        }
    };
    let mut timer = tokio::time::interval(Duration::from_millis(100));
    let mut queue_heartbeat = tokio::time::interval(Duration::from_secs(5));
    let mut waited = false;
    let mut rate = Rate::new();
    let seat = loop {
        if let Err(message) = s.pair(&ticket) {
            send(&mut socket, json!({"type":"error","message":message})).await;
            return;
        }
        let state = s.registry.lock().ok().and_then(|r| {
            r.tickets
                .get(&ticket)
                .map(|t| (t.seat.clone(), t.invite.clone(), t.created.elapsed()))
        });
        let Some((seat, invite, age)) = state else {
            send(
                &mut socket,
                json!({"type":"error","message":"Session expired; join again"}),
            )
            .await;
            return;
        };
        if age > Duration::from_secs(if seat.is_some() { 45 * 60 } else { 300 }) {
            s.cancel(&ticket);
            return;
        }
        if let Some(seat) = seat {
            break seat;
        }
        if !waited {
            if !send(&mut socket, json!({"type":"queued","inviteCode":invite})).await {
                return;
            }
            waited = true;
        }
        tokio::select! {
            _ = timer.tick() => (),
            _ = queue_heartbeat.tick() => { if !matches!(tokio::time::timeout(Duration::from_secs(2), socket.send(Message::Ping(vec![1].into()))).await, Ok(Ok(()))) { return; } },
            message = socket.recv() => {
                if !rate.take() { return; }
                ticket_socket.touch();
                match message {
                    Some(Ok(Message::Text(text))) => match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(ClientMessage::Cancel) => { s.cancel(&ticket); return; }
                        Ok(ClientMessage::Ping { nonce }) => {
                            if !send(&mut socket, json!({"type":"pong","nonce":nonce})).await { return; }
                        }
                        _ => return,
                    },
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => (),
                    _ => return,
                }
            }
        }
    };
    let handle = seat.handle;
    let player = seat.player;
    let (reply, receive) = tokio::sync::oneshot::channel();
    if handle
        .commands
        .try_send(worker::Action::Connect { player, reply })
        .is_err()
    {
        let frame = handle.frames.borrow().clone();
        if matches!(frame.phase, "finished" | "cancelled")
            && matched(&mut socket, &s, &handle, player, frame.epochs[player]).await
        {
            binary(&mut socket, &frame).await;
        }
        return;
    }
    let Ok(Ok(Ok(epoch))) = tokio::time::timeout(Duration::from_secs(2), receive).await else {
        return;
    };
    if !matched(&mut socket, &s, &handle, player, epoch).await {
        let _ = handle
            .commands
            .try_send(worker::Action::Disconnect { player, epoch });
        return;
    }
    let mut frames = handle.frames.clone();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if !matches!(tokio::time::timeout(Duration::from_secs(2),socket.send(Message::Ping(vec![1].into()))).await, Ok(Ok(()))) { break; }
            }
            changed = frames.changed() => {
                if changed.is_err() { break; }
                let frame = frames.borrow_and_update().clone();
                // A subscriber can initially observe the pre-connect baseline.
                if frame.epochs[player] < epoch { continue; }
                if frame.epochs[player] > epoch {
                    send(&mut socket, json!({"type":"error","code":"replaced","message":"This connection was replaced by a new session"})).await;
                    break;
                }
                if !binary(&mut socket, &frame).await { break; }
                if matches!(frame.phase, "finished" | "cancelled") { break; }
            }
            message = socket.recv() => {
                if !rate.take() { break; }
                let text = match message {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        if handle.commands.try_send(worker::Action::Heartbeat { player, epoch }).is_err() { break; }
                        continue;
                    }
                    _ => break,
                };
                let Ok(message) = serde_json::from_str::<ClientMessage>(&text) else { break };
                let action = match message {
                    ClientMessage::Ready { version } if version.matches(&s.catalog) => worker::Action::Ready { player, epoch },
                    ClientMessage::Command { envelope } => {
                        let sequence = envelope.sequence;
                        let (reply, receive) = tokio::sync::oneshot::channel();
                        if handle.commands.try_send(worker::Action::Input { player, epoch, command: envelope, reply }).is_err() {
                            send(&mut socket, json!({"type":"error","message":"Command queue is full"})).await;
                            break;
                        }
                        match tokio::time::timeout(Duration::from_secs(2), receive).await {
                            Ok(Ok(result)) => {
                                if !send(&mut socket, json!({"type":"ack","sequence":sequence,"accepted":result.is_ok(),"error":result.err()})).await { break; }
                            }
                            _ => break,
                        }
                        continue;
                    }
                    ClientMessage::Surrender | ClientMessage::Cancel => worker::Action::Surrender { player, epoch },
                    ClientMessage::Ping { nonce } => {
                        let _ = handle.commands.try_send(worker::Action::Heartbeat { player, epoch });
                        if !send(&mut socket, json!({"type":"pong","nonce":nonce})).await { break; }
                        continue;
                    }
                    _ => break,
                };
                if handle.commands.try_send(action).is_err() { break; }
            }
        }
    }
    let _ = handle
        .commands
        .try_send(worker::Action::Disconnect { player, epoch });
}
async fn shutdown(s: Arc<Hub>) {
    termination_signal().await;
    s.draining.store(true, Ordering::Release);
    eprintln!("Draining: new matches are disabled; waiting for active battles");
    loop {
        let done = s
            .registry
            .lock()
            .map(|r| r.matches.iter().all(|m| m.finished.load(Ordering::Acquire)))
            .unwrap_or(true);
        if done {
            break;
        }
        tokio::select! {_=tokio::time::sleep(Duration::from_secs(1))=>(),_=termination_signal()=>{if let Ok(r)=s.registry.lock(){for m in &r.matches{let _=m.commands.try_send(worker::Action::Shutdown);}}}}
    }
    let writer = s.writer.clone();
    if let Err(error) = tokio::task::spawn_blocking(move || writer.flush())
        .await
        .unwrap_or_else(|e| Err(e.to_string()))
    {
        eprintln!("Result flush failed: {error}");
    }
}
async fn termination_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => (), _ = term.recv() => () }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

/// Walk the forwarding chain from the trusted socket peer toward the client.
/// An untrusted sender can never choose its rate-limit identity with a header.
fn client_ip(
    headers: &HeaderMap,
    peer: std::net::IpAddr,
    trusted: &[std::net::IpAddr],
) -> std::net::IpAddr {
    if !trusted.contains(&peer) {
        return peer;
    }
    let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) else {
        return peer;
    };
    let parts = value.split(',').collect::<Vec<_>>();
    if parts.len() > 16 {
        return peer;
    }
    let Ok(chain) = parts
        .iter()
        .map(|p| p.trim().parse::<std::net::IpAddr>())
        .collect::<Result<Vec<_>, _>>()
    else {
        return peer;
    };
    chain
        .into_iter()
        .rev()
        .find(|ip| !trusted.contains(ip))
        .unwrap_or(peer)
}
#[cfg(test)]
mod proxy_tests {
    use super::*;
    #[test]
    fn only_trusted_proxies_can_supply_client_addresses() {
        let proxy = "127.0.0.1".parse().unwrap();
        let client = "192.0.2.1".parse().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "203.0.113.99, 192.0.2.1".parse().unwrap(),
        );
        assert_eq!(client_ip(&headers, proxy, &[proxy]), client);
        assert_eq!(client_ip(&headers, client, &[proxy]), client);
        headers.insert("x-forwarded-for", "invalid, 192.0.2.1".parse().unwrap());
        assert_eq!(client_ip(&headers, proxy, &[proxy]), proxy);
    }
}

mod api;

use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use xcp_core::session::{SessionActor, SessionError, SessionHandle, SessionState};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{interval, Duration, MissedTickBehavior};
use xcp_core::xcp::{CanIds, SimulatedSlave, SimulatedTransport, XcpMaster};

type Session = SessionHandle;

#[derive(Serialize)]
struct Health {
    status: &'static str,
    mode: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct SymbolInfo {
    name: String,
    address: u64,
    address_hex: String,
    size: u64,
    kind: String,
}

#[derive(Serialize)]
struct ElfResult {
    symbols: Vec<SymbolInfo>,
    count: usize,
}

#[derive(Debug, Serialize)]
struct ApiError {
    error: String,
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        mode: "simulation",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn inspect_elf(
    body: axum::body::Bytes,
) -> Result<Json<ElfResult>, (StatusCode, Json<ApiError>)> {
    let symbols = xcp_core::elf::inspect_bytes(&body).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                error: error.to_string(),
            }),
        )
    })?;
    let symbols: Vec<SymbolInfo> = symbols
        .into_iter()
        .map(|symbol| SymbolInfo {
            name: symbol.name,
            address: symbol.address,
            address_hex: format!("0x{:X}", symbol.address),
            size: symbol.size,
            kind: symbol.kind,
        })
        .collect();
    let count = symbols.len();
    Ok(Json(ElfResult { symbols, count }))
}

#[derive(Serialize)]
struct SessionStatus {
    connected: bool,
    transport: &'static str,
}

#[derive(Deserialize)]
struct ReadRequest {
    address: u32,
    count: usize,
}

#[derive(Serialize)]
struct ReadResult {
    address: u32,
    bytes: Vec<u8>,
    hex: String,
}

/// Offload synchronous XCP worker calls so the Tokio I/O threads remain responsive.
async fn execute_xcp<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, SessionError> + Send + 'static,
) -> Result<T, (StatusCode, Json<ApiError>)> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(session_error)?
        .map_err(session_error)
}

async fn session_status(State(session): State<Session>) -> Json<SessionStatus> {
    let connected = tokio::task::spawn_blocking(move || session.state())
        .await
        .ok()
        .and_then(Result::ok)
        == Some(SessionState::Connected);
    Json(SessionStatus {
        connected,
        transport: "simulation",
    })
}

async fn session_connect(
    State(session): State<Session>,
) -> Result<Json<SessionStatus>, (StatusCode, Json<ApiError>)> {
    execute_xcp(move || session.connect()).await?;
    Ok(Json(SessionStatus {
        connected: true,
        transport: "simulation",
    }))
}

async fn session_disconnect(
    State(session): State<Session>,
) -> Result<Json<SessionStatus>, (StatusCode, Json<ApiError>)> {
    execute_xcp(move || session.disconnect()).await?;
    Ok(Json(SessionStatus {
        connected: false,
        transport: "simulation",
    }))
}

fn session_error(error: impl std::fmt::Display) -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiError {
            error: error.to_string(),
        }),
    )
}

async fn session_read(
    State(session): State<Session>,
    Json(request): Json<ReadRequest>,
) -> Result<Json<ReadResult>, (StatusCode, Json<ApiError>)> {
    if request.count == 0 || request.count > 4096 {
        return Err(session_error("count must be between 1 and 4096"));
    }
    let bytes = execute_xcp(move || session.read(request.address, request.count)).await?;
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(Json(ReadResult {
        address: request.address,
        bytes,
        hex,
    }))
}


#[derive(Deserialize)]
struct SnapshotRequest {
    signals: Vec<SnapshotSignalRequest>,
}

#[derive(Deserialize)]
struct SnapshotSignalRequest {
    name: String,
    address: u32,
    value_type: SnapshotValueType,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SnapshotValueType {
    U8,
    U16,
    U32,
    I8,
    I16,
    I32,
    F32,
    F64,
}

impl SnapshotValueType {
    fn byte_count(&self) -> usize {
        match self {
            Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::F64 => 8,
        }
    }

    fn decode(&self, bytes: &[u8]) -> f64 {
        match self {
            Self::U8 => f64::from(bytes[0]),
            Self::I8 => f64::from(bytes[0] as i8),
            Self::U16 => f64::from(u16::from_le_bytes([bytes[0], bytes[1]])),
            Self::I16 => f64::from(i16::from_le_bytes([bytes[0], bytes[1]])),
            Self::U32 => f64::from(u32::from_le_bytes(bytes.try_into().expect("four bytes"))),
            Self::I32 => f64::from(i32::from_le_bytes(bytes.try_into().expect("four bytes"))),
            Self::F32 => f64::from(f32::from_le_bytes(bytes.try_into().expect("four bytes"))),
            Self::F64 => f64::from_le_bytes(bytes.try_into().expect("eight bytes")),
        }
    }
}

#[derive(Serialize)]
struct SnapshotSample {
    name: String,
    address: u32,
    value: f64,
}

#[derive(Serialize)]
struct SnapshotResult {
    timestamp_ms: u128,
    samples: Vec<SnapshotSample>,
}

async fn session_snapshot(
    State(session): State<Session>,
    Json(request): Json<SnapshotRequest>,
) -> Result<Json<SnapshotResult>, (StatusCode, Json<ApiError>)> {
    if request.signals.is_empty() || request.signals.len() > 64 {
        return Err(session_error("signals must contain between 1 and 64 entries"));
    }
    if request
        .signals
        .iter()
        .any(|signal| signal.name.trim().is_empty() || signal.name.len() > 128)
    {
        return Err(session_error("signal names must contain 1 to 128 characters"));
    }

    // A single actor owns all MTA transitions; requests from multiple
    // WebSocket clients cannot corrupt one another's read operations.
    let samples = execute_xcp(move || {
        let mut samples = Vec::with_capacity(request.signals.len());
        for signal in request.signals {
            let bytes = session.read(signal.address, signal.value_type.byte_count())?;
            let value = signal.value_type.decode(&bytes);
            if !value.is_finite() {
                return Err(SessionError::Xcp(xcp_core::xcp::XcpError::InvalidResponse));
            }
            samples.push(SnapshotSample {
                name: signal.name,
                address: signal.address,
                value,
            });
        }
        Ok(samples)
    })
    .await?;

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(session_error)?
        .as_millis();
    Ok(Json(SnapshotResult { timestamp_ms, samples }))
}


#[derive(Deserialize)]
struct StreamConfig {
    interval_ms: u64,
    signals: Vec<SnapshotSignalRequest>,
}

/// Streams bounded periodic XCP snapshots to one connected WebSocket client.
/// Each connection owns its schedule; hardware DAQ and shared acquisition are separate work.
async fn stream_upgrade(
    ws: WebSocketUpgrade,
    State(session): State<Session>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| stream_client(socket, session))
}

async fn stream_client(mut socket: WebSocket, session: Session) {
    let config = match socket.recv().await {
        Some(Ok(Message::Text(text))) => serde_json::from_str::<StreamConfig>(&text).ok(),
        _ => None,
    };
    let Some(config) = config else {
        let _ = socket.send(Message::Text(r#"{"error":"expected stream configuration JSON"}"#.into())).await;
        return;
    };
    if !(20..=10_000).contains(&config.interval_ms)
        || config.signals.is_empty()
        || config.signals.len() > 64
        || config.signals.iter().any(|s| s.name.trim().is_empty() || s.name.len() > 128)
    {
        let _ = socket.send(Message::Text(r#"{"error":"invalid interval or signals"}"#.into())).await;
        return;
    }
    let mut ticker = interval(Duration::from_millis(config.interval_ms));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let request = SnapshotRequest {
                    signals: config.signals.iter().map(|s| SnapshotSignalRequest {
                        name: s.name.clone(), address: s.address,
                        value_type: s.value_type.clone(),
                    }).collect(),
                };
                let result = session_snapshot(State(session.clone()), Json(request)).await;
                let failed = result.is_err();
                let payload = match result {
                    Ok(Json(snapshot)) => serde_json::to_string(&snapshot).ok(),
                    Err((_, Json(error))) => serde_json::to_string(&error).ok(),
                };
                let Some(payload) = payload else { break };
                if socket.send(Message::Text(payload.into())).await.is_err() { break; }
                if failed { break; }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}


/// Build one simulator and one XCP command owner per server process.
fn simulated_session_actor() -> Result<SessionActor, xcp_core::xcp::XcpError> {
    let ids = CanIds::default();
    let mut slave = SimulatedSlave::new(0x1000, 65536);
    slave.load(0x1000, &1850u32.to_le_bytes())?;
    slave.load(0x1004, &88.5f32.to_le_bytes())?;
    let transport = SimulatedTransport::new(slave, ids);
    Ok(SessionActor::spawn(XcpMaster::new(transport, ids)))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let actor = simulated_session_actor()?;
    let session = actor.handle();
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/v1/health", get(api::v1::health))
        .route("/api/v1/sessions/current", get(api::v1::status))
        .route("/api/v1/sessions/current/reads", post(api::v1::read))
        .route("/api/elf/inspect", post(inspect_elf))
        .route("/api/xcp/status", get(session_status))
        .route("/api/xcp/connect", post(session_connect))
        .route("/api/xcp/disconnect", post(session_disconnect))
        .route("/api/xcp/read", post(session_read))
        .route("/api/xcp/snapshot", post(session_snapshot))
        .route("/api/xcp/stream", get(stream_upgrade))
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(session);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    println!("XCP Studio API: http://127.0.0.1:8080/api/health");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;

    #[test]
    fn decodes_simulator_engine_speed() {
        let bytes = 1850u32.to_le_bytes();
        assert_eq!(SnapshotValueType::U32.byte_count(), 4);
        assert_eq!(SnapshotValueType::U32.decode(&bytes), 1850.0);
    }

    #[test]
    fn decodes_simulator_coolant_temperature() {
        let bytes = 88.5f32.to_le_bytes();
        assert_eq!(SnapshotValueType::F32.decode(&bytes), 88.5);
    }

    #[tokio::test]
    async fn actor_backed_routes_connect_measure_and_disconnect() {
        let actor = simulated_session_actor().unwrap();
        let session = actor.handle();

        assert!(!session_status(State(session.clone())).await.0.connected);
        assert!(session_connect(State(session.clone())).await.unwrap().0.connected);

        let read = session_read(
            State(session.clone()),
            Json(ReadRequest {
                address: 0x1000,
                count: 4,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(read.bytes, 1850u32.to_le_bytes());

        let snapshot = session_snapshot(
            State(session.clone()),
            Json(SnapshotRequest {
                signals: vec![
                    SnapshotSignalRequest {
                        name: "Engine speed".into(),
                        address: 0x1000,
                        value_type: SnapshotValueType::U32,
                    },
                    SnapshotSignalRequest {
                        name: "Coolant".into(),
                        address: 0x1004,
                        value_type: SnapshotValueType::F32,
                    },
                ],
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(snapshot.samples.len(), 2);
        assert_eq!(snapshot.samples[0].value, 1850.0);
        assert_eq!(snapshot.samples[1].value, 88.5);

        assert!(!session_disconnect(State(session.clone())).await.unwrap().0.connected);
        let failure = session_read(
            State(session),
            Json(ReadRequest {
                address: 0x1000,
                count: 4,
            }),
        )
        .await;
        let failure = match failure {
            Ok(_) => panic!("disconnected actor must reject reads"),
            Err(error) => error,
        };
        assert!(failure.1 .0.error.contains("not connected"));
    }

    #[tokio::test]
    async fn parallel_actor_backed_reads_do_not_corrupt_mta() {
        let actor = simulated_session_actor().unwrap();
        let session = actor.handle();
        let _ = session_connect(State(session.clone())).await.unwrap();
        let tasks: Vec<_> = (0..16)
            .map(|_| {
                let current = session.clone();
                tokio::spawn(async move {
                    for _ in 0..16 {
                        let rpm = session_read(
                            State(current.clone()),
                            Json(ReadRequest {
                                address: 0x1000,
                                count: 4,
                            }),
                        )
                        .await
                        .unwrap()
                        .0;
                        assert_eq!(rpm.bytes, 1850u32.to_le_bytes());
                    }
                })
            })
            .collect();
        for task in tasks {
            task.await.unwrap();
        }
    }

    #[test]
    fn decodes_signed_values() {
        assert_eq!(SnapshotValueType::I16.decode(&(-123i16).to_le_bytes()), -123.0);
    }
}

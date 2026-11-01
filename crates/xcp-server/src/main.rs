use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use xcp_core::xcp::{CanIds, SimulatedSlave, SimulatedTransport, XcpMaster};

type Session = Arc<Mutex<Option<XcpMaster<SimulatedTransport>>>>;

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

#[derive(Serialize)]
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

async fn session_status(State(session): State<Session>) -> Json<SessionStatus> {
    let connected = session.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    Json(SessionStatus {
        connected,
        transport: "simulation",
    })
}

async fn session_connect(
    State(session): State<Session>,
) -> Result<Json<SessionStatus>, (StatusCode, Json<ApiError>)> {
    let mut guard = session.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        let ids = CanIds::default();
        let mut slave = SimulatedSlave::new(0x1000, 65536);
        slave
            .load(0x1000, &1850u32.to_le_bytes())
            .map_err(session_error)?;
        slave
            .load(0x1004, &88.5f32.to_le_bytes())
            .map_err(session_error)?;
        let transport = SimulatedTransport::new(slave, ids);
        let mut master = XcpMaster::new(transport, ids);
        master.connect().map_err(session_error)?;
        *guard = Some(master);
    }
    Ok(Json(SessionStatus {
        connected: true,
        transport: "simulation",
    }))
}

async fn session_disconnect(
    State(session): State<Session>,
) -> Result<Json<SessionStatus>, (StatusCode, Json<ApiError>)> {
    let mut guard = session.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(master) = guard.as_mut() {
        master.disconnect().map_err(session_error)?;
    }
    *guard = None;
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
    let mut guard = session.lock().unwrap_or_else(|e| e.into_inner());
    let master = guard
        .as_mut()
        .ok_or_else(|| session_error("XCP session not connected"))?;
    let bytes = master
        .read(request.address, request.count)
        .map_err(session_error)?;
    let hex = bytes
        .iter()
        .map(|b| format!("{b:02X}"))
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

#[derive(Deserialize)]
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
    if request.signals.iter().any(|signal| signal.name.trim().is_empty() || signal.name.len() > 128) {
        return Err(session_error("signal names must contain 1 to 128 characters"));
    }
    let mut guard = session.lock().unwrap_or_else(|e| e.into_inner());
    let master = guard.as_mut().ok_or_else(|| session_error("XCP session not connected"))?;
    let mut samples = Vec::with_capacity(request.signals.len());
    for signal in request.signals {
        let bytes = master.read(signal.address, signal.value_type.byte_count()).map_err(session_error)?;
        let value = signal.value_type.decode(&bytes);
        if !value.is_finite() {
            return Err(session_error("signal contains a non-finite value"));
        }
        samples.push(SnapshotSample { name: signal.name, address: signal.address, value });
    }
    let timestamp_ms = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(session_error)?.as_millis();
    Ok(Json(SnapshotResult { timestamp_ms, samples }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let session: Session = Arc::new(Mutex::new(None));
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/elf/inspect", post(inspect_elf))
        .route("/api/xcp/status", get(session_status))
        .route("/api/xcp/connect", post(session_connect))
        .route("/api/xcp/disconnect", post(session_disconnect))
        .route("/api/xcp/read", post(session_read))
        .route("/api/xcp/snapshot", post(session_snapshot))
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(session);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    println!("XCP Studio API: http://127.0.0.1:8080/api/health");
    axum::serve(listener, app).await?;
    Ok(())
}

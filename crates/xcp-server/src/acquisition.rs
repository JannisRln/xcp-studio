//! Single-owner acquisition scheduler with bounded multi-subscriber fanout.
//!
//! This initial implementation deliberately uses serialized XCP UPLOAD polling,
//! not ECU-side DAQ. An acquisition belongs to the Rust service, never to a
//! WebSocket client; subscribers cannot increase CAN/XCP request frequency.

use crate::api::v1::{error, ApiFailure};
use crate::{
    session_snapshot, Session, SnapshotRequest, SnapshotSignalRequest,
};
use axum::{
    extract::{
        rejection::JsonRejection,
        ws::{Message, WebSocket, WebSocketUpgrade},
        Extension, Path, State,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio::{
    sync::{broadcast, watch},
    time::{interval, Duration, Instant, MissedTickBehavior},
};
use xcp_core::session::SessionState;
use crate::SnapshotValueType;

const RUNNING: u8 = 1;
const STOPPED: u8 = 2;
const FAILED: u8 = 3;
const CHANNEL_CAPACITY: usize = 128;
const MAX_SUBSCRIBERS: usize = 16;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcquisitionConfig {
    pub interval_ms: u64,
    pub signals: Vec<SnapshotSignalRequest>,
}

impl AcquisitionConfig {
    fn validate(&self) -> Result<(), ApiFailure> {
        if !(20..=10_000).contains(&self.interval_ms) {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "INVALID_SAMPLE_INTERVAL",
                "interval_ms must be between 20 and 10000",
                false,
            ));
        }
        if self.signals.is_empty() || self.signals.len() > 64 {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "INVALID_SIGNALS",
                "1 to 64 signals are required",
                false,
            ));
        }
        let mut names = HashSet::with_capacity(self.signals.len());
        for signal in &self.signals {
            if signal.name.trim().is_empty() || signal.name.len() > 128
                || !names.insert(signal.name.as_str())
            {
                return Err(error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "INVALID_SIGNAL_NAME",
                    "signal names must be unique and 1 to 128 characters",
                    false,
                ));
            }
            let size = signal.value_type.byte_count() as u32;
            if signal.address.checked_add(size - 1).is_none() {
                return Err(error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "INVALID_SIGNAL_ADDRESS",
                    "signal address and size exceed the 32-bit ECU address space",
                    false,
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AcquisitionStatus {
    pub schema_version: u8,
    pub acquisition_id: String,
    pub state: &'static str,
    pub sampling_mode: &'static str,
    pub interval_ms: u64,
    pub signal_count: usize,
    pub signals: Vec<SnapshotSignalRequest>,
    pub sequence: u64,
    pub subscriber_count: usize,
    pub dropped_subscriber_frames: u64,
    pub error: Option<String>,
}

/// Finite values obtained from one successful sequential simulator read.
/// Valid does not imply a simultaneous ECU timestamp or a verified address.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SampleQuality { Valid }

/// The v1 acquisition accepts manually configured raw ECU addresses.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AddressOrigin { Manual }

/// Additive metadata is optional to preserve pre-extension v1 JSON fixtures.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcquisitionSampleV1 {
    pub name: String,
    pub address: u32,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_type: Option<crate::SnapshotValueType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<SampleQuality>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address_origin: Option<AddressOrigin>,
}

impl AcquisitionSampleV1 {
    /// Validate the wire value against its optional raw scalar type.
    /// Future nullable/missing samples require a separately reviewed contract.
    fn validate(&self) -> Result<(), &'static str> {
        if self.name.trim().is_empty() || self.name.len() > 128 || !self.value.is_finite() {
            return Err("invalid sample name or non-finite value");
        }
        let Some(kind) = &self.value_type else { return Ok(()); };
        if self.address.checked_add(kind.byte_count() as u32 - 1).is_none() {
            return Err("sample width exceeds 32-bit address space");
        }
        let valid = match kind {
            SnapshotValueType::U8 => self.value.fract() == 0.0 && (0.0..=255.0).contains(&self.value),
            SnapshotValueType::I8 => self.value.fract() == 0.0 && (-128.0..=127.0).contains(&self.value),
            SnapshotValueType::U16 => self.value.fract() == 0.0 && (0.0..=65535.0).contains(&self.value),
            SnapshotValueType::I16 => self.value.fract() == 0.0 && (-32768.0..=32767.0).contains(&self.value),
            SnapshotValueType::U32 => self.value.fract() == 0.0 && (0.0..=4294967295.0).contains(&self.value),
            SnapshotValueType::I32 => self.value.fract() == 0.0 && (-2147483648.0..=2147483647.0).contains(&self.value),
            SnapshotValueType::F32 | SnapshotValueType::F64 => true,
        };
        if valid { Ok(()) } else { Err("value exceeds declared scalar type range") }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcquisitionEvent {
    Samples {
        schema_version: u8,
        acquisition_id: String,
        sequence: u64,
        timestamp_ms: u128,
        monotonic_elapsed_ms: u64,
        dropped_since_previous: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        timestamp_origin: Option<&'static str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        monotonic_clock: Option<&'static str>,
        samples: Vec<AcquisitionSampleV1>,
    },
    Gap {
        schema_version: u8,
        acquisition_id: String,
        dropped: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        scope: Option<&'static str>,
    },
    Status {
        schema_version: u8,
        acquisition_id: String,
        state: &'static str,
        reason: &'static str,
    },
}

struct AcquisitionRun {
    id: String,
    config: AcquisitionConfig,
    tx: broadcast::Sender<AcquisitionEvent>,
    stop_tx: watch::Sender<bool>,
    state: AtomicU8,
    sequence: AtomicU64,
    subscribers: AtomicUsize,
    dropped: AtomicU64,
    last_error: Mutex<Option<String>>,
}

impl AcquisitionRun {
    fn status(&self) -> AcquisitionStatus {
        let state = match self.state.load(Ordering::Acquire) {
            RUNNING => "running",
            STOPPED => "stopped",
            _ => "failed",
        };
        AcquisitionStatus {
            schema_version: 1,
            acquisition_id: self.id.clone(),
            state,
            sampling_mode: "polling",
            interval_ms: self.config.interval_ms,
            signal_count: self.config.signals.len(),
            signals: self.config.signals.clone(),
            sequence: self.sequence.load(Ordering::Relaxed),
            subscriber_count: self.subscribers.load(Ordering::Relaxed),
            dropped_subscriber_frames: self.dropped.load(Ordering::Relaxed),
            error: self.last_error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        }
    }

    fn stop(&self) {
        if self.state.swap(STOPPED, Ordering::AcqRel) == RUNNING {
            let _ = self.stop_tx.send(true);
        }
    }

    fn subscribe(self: &Arc<Self>) -> Result<(Subscription, broadcast::Receiver<AcquisitionEvent>), ApiFailure> {
        if self.state.load(Ordering::Acquire) != RUNNING {
            return Err(error(
                StatusCode::CONFLICT,
                "ACQUISITION_NOT_RUNNING",
                "acquisition has stopped or failed",
                false,
            ));
        }
        let mut current = self.subscribers.load(Ordering::Acquire);
        loop {
            if current >= MAX_SUBSCRIBERS {
                return Err(error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "SUBSCRIBER_LIMIT",
                    "too many acquisition subscribers",
                    true,
                ));
            }
            match self.subscribers.compare_exchange_weak(
                current, current + 1, Ordering::AcqRel, Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(actual) => current = actual,
            }
        }
        let guard = Subscription { run: Arc::clone(self) };
        let receiver = self.tx.subscribe();
        if self.state.load(Ordering::Acquire) != RUNNING {
            return Err(error(StatusCode::CONFLICT, "ACQUISITION_NOT_RUNNING", "acquisition stopped during subscription", false));
        }
        Ok((guard, receiver))
    }
}

struct Subscription {
    run: Arc<AcquisitionRun>,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.run.subscribers.fetch_sub(1, Ordering::AcqRel);
    }
}

/// A single active or terminal acquisition per backend ECU session.
#[derive(Default)]
pub struct AcquisitionService {
    current: Mutex<Option<Arc<AcquisitionRun>>>,
    next_id: AtomicU64,
}

impl AcquisitionService {
    fn current(&self, id: &str) -> Result<Arc<AcquisitionRun>, ApiFailure> {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|run| run.id == id)
            .cloned()
            .ok_or_else(|| error(StatusCode::NOT_FOUND, "ACQUISITION_NOT_FOUND", "unknown acquisition ID", false))
    }

    fn start(&self, session: Session, config: AcquisitionConfig) -> Result<Arc<AcquisitionRun>, ApiFailure> {
        config.validate()?;
        let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if current.as_ref().is_some_and(|run| run.state.load(Ordering::Acquire) == RUNNING) {
            return Err(error(
                StatusCode::CONFLICT,
                "ACQUISITION_ALREADY_RUNNING",
                "stop the active acquisition before starting another",
                false,
            ));
        }
        let id = format!("acq-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (stop_tx, stop_rx) = watch::channel(false);
        let run = Arc::new(AcquisitionRun {
            id,
            config,
            tx,
            stop_tx,
            state: AtomicU8::new(RUNNING),
            sequence: AtomicU64::new(0),
            subscribers: AtomicUsize::new(0),
            dropped: AtomicU64::new(0),
            last_error: Mutex::new(None),
        });
        *current = Some(Arc::clone(&run));
        tokio::spawn(acquire(Arc::clone(&run), session, stop_rx));
        Ok(run)
    }

    pub fn stop_active(&self) {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(run) = current.as_ref() {
            run.stop();
        }
    }
}

async fn acquire(run: Arc<AcquisitionRun>, session: Session, mut stop_rx: watch::Receiver<bool>) {
    let started = Instant::now();
    let mut ticker = interval(Duration::from_millis(run.config.interval_ms));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut failed = false;

    loop {
        tokio::select! {
            biased;
            _ = stop_rx.changed() => break,
            _ = ticker.tick() => {
                if run.state.load(Ordering::Acquire) != RUNNING {
                    break;
                }
                let response = session_snapshot(
                    State(session.clone()),
                    Json(SnapshotRequest { signals: run.config.signals.clone() }),
                ).await;

                match response {
                    Ok(Json(snapshot)) => {
                        if run.state.load(Ordering::Acquire) != RUNNING {
                            break;
                        }
                        let sequence = run.sequence.fetch_add(1, Ordering::Relaxed) + 1;
                        let event = AcquisitionEvent::Samples {
                            schema_version: 1,
                            acquisition_id: run.id.clone(),
                            sequence,
                            timestamp_ms: snapshot.timestamp_ms,
                            monotonic_elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
                            dropped_since_previous: 0,
                            timestamp_origin: Some("host_utc_after_reads"),
                            monotonic_clock: Some("acquisition_elapsed"),
                            samples: snapshot.samples.into_iter().zip(run.config.signals.iter()).map(|(sample, signal)| AcquisitionSampleV1 {
                                name: sample.name,
                                address: sample.address,
                                value: sample.value,
                                value_type: Some(signal.value_type.clone()),
                                quality: Some(SampleQuality::Valid),
                                address_origin: Some(AddressOrigin::Manual),
                            }).inspect(|sample| debug_assert!(sample.validate().is_ok())).collect(),
                        };
                        // Broadcast send never waits for a slow client. Lagged receivers
                        // observe a gap and account the dropped frames independently.
                        let _ = run.tx.send(event);
                    }
                    Err((_, Json(cause))) => {
                        *run.last_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(cause.error);
                        run.state.store(FAILED, Ordering::Release);
                        failed = true;
                        break;
                    }
                }
            }
        }
    }

    if !failed {
        run.state.store(STOPPED, Ordering::Release);
    }
    let _ = run.tx.send(AcquisitionEvent::Status {
        schema_version: 1,
        acquisition_id: run.id.clone(),
        state: if failed { "failed" } else { "stopped" },
        reason: if failed { "xcp_read_error" } else { "operator_stop" },
    });
}

pub async fn create(
    State(session): State<Session>,
    Extension(service): Extension<Arc<AcquisitionService>>,
    payload: Result<Json<AcquisitionConfig>, JsonRejection>,
) -> Result<(StatusCode, Json<AcquisitionStatus>), ApiFailure> {
    let Json(config) = payload.map_err(|_| {
        error(StatusCode::BAD_REQUEST, "INVALID_JSON", "invalid acquisition configuration", false)
    })?;
    config.validate()?;
    let handle = session.clone();
    let connected = tokio::task::spawn_blocking(move || handle.state())
        .await
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "XCP_WORKER_STOPPED", "session worker failed", true))?
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "XCP_WORKER_STOPPED", "session worker unavailable", true))?;
    if connected != SessionState::Connected {
        return Err(error(StatusCode::CONFLICT, "XCP_SESSION_DISCONNECTED", "connect the XCP simulator first", false));
    }
    let run = service.start(session, config)?;
    Ok((StatusCode::CREATED, Json(run.status())))
}

/// Return the last backend acquisition so a browser can reattach after reload.
pub async fn current(
    Extension(service): Extension<Arc<AcquisitionService>>,
) -> Result<Json<AcquisitionStatus>, ApiFailure> {
    let current = service.current.lock().unwrap_or_else(|e| e.into_inner());
    let run = current.as_ref().ok_or_else(|| error(
        StatusCode::NOT_FOUND,
        "ACQUISITION_NOT_FOUND",
        "no acquisition has been created",
        false,
    ))?;
    Ok(Json(run.status()))
}

pub async fn status(
    Path(id): Path<String>,
    Extension(service): Extension<Arc<AcquisitionService>>,
) -> Result<Json<AcquisitionStatus>, ApiFailure> {
    Ok(Json(service.current(&id)?.status()))
}

pub async fn stop(
    Path(id): Path<String>,
    Extension(service): Extension<Arc<AcquisitionService>>,
) -> Result<Json<AcquisitionStatus>, ApiFailure> {
    let run = service.current(&id)?;
    run.stop();
    Ok(Json(run.status()))
}

pub async fn subscribe(
    Path(id): Path<String>,
    Extension(service): Extension<Arc<AcquisitionService>>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiFailure> {
    let run = service.current(&id)?;
    let (guard, receiver) = run.subscribe()?;
    Ok(ws.max_message_size(16 * 1024)
        .max_frame_size(16 * 1024)
        .on_upgrade(move |socket| send_events(socket, guard, receiver)))
}

async fn send_events(
    mut socket: WebSocket,
    subscription: Subscription,
    mut receiver: broadcast::Receiver<AcquisitionEvent>,
) {
    let run = Arc::clone(&subscription.run);
    let _guard = subscription;
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
            received = receiver.recv() => {
                let event = match received {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        run.dropped.fetch_add(dropped, Ordering::Relaxed);
                        AcquisitionEvent::Gap {
                            schema_version: 1,
                            acquisition_id: run.id.clone(),
                            dropped,
                            scope: Some("subscriber"),
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                let terminal = matches!(event, AcquisitionEvent::Status { .. });
                let Ok(payload) = serde_json::to_string(&event) else { break };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
                if terminal { break; }
            }

        }
    }
    let _ = socket.send(Message::Close(None)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simulated_session_actor;

    fn config() -> AcquisitionConfig {
        AcquisitionConfig {
            interval_ms: 20,
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
        }
    }

    #[test]
    fn wire_fixture_matches_serialized_sample_and_gap_events() {
        let sample = AcquisitionEvent::Samples {
            schema_version: 1,
            acquisition_id: "acq-1".into(),
            sequence: 1,
            timestamp_ms: 1761980000000,
            monotonic_elapsed_ms: 20,
            dropped_since_previous: 0,
            timestamp_origin: None,
            monotonic_clock: None,
            samples: vec![
                AcquisitionSampleV1 {
                    name: "Engine speed".into(),
                    address: 4096,
                    value: 1850.0,
                    value_type: None,
                    quality: None,
                    address_origin: None,
                },
                AcquisitionSampleV1 {
                    name: "Coolant".into(),
                    address: 4100,
                    value: 88.5,
                    value_type: None,
                    quality: None,
                    address_origin: None,
                },
            ],
        };
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/acquisition-sample.json"
        )).unwrap();
        assert_eq!(serde_json::to_value(sample).unwrap(), expected);

        let gap = AcquisitionEvent::Gap {
            schema_version: 1,
            acquisition_id: "acq-1".into(),
            dropped: 11,
            scope: None,
        };
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/acquisition-gap.json"
        )).unwrap();
        assert_eq!(serde_json::to_value(gap).unwrap(), expected);
        let scoped = AcquisitionEvent::Gap {
            schema_version: 1, acquisition_id: "acq-1".into(), dropped: 11,
            scope: Some("subscriber"),
        };
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/acquisition-gap-scoped.json"
        )).unwrap();
        assert_eq!(serde_json::to_value(scoped).unwrap(), expected);
        let failed = AcquisitionEvent::Status {
            schema_version: 1, acquisition_id: "acq-1".into(),
            state: "failed", reason: "xcp_read_error",
        };
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/acquisition-failed.json"
        )).unwrap();
        assert_eq!(serde_json::to_value(failed).unwrap(), expected);

        let enriched: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/acquisition-sample-qualified.json"
        )).unwrap();
        let encoded = serde_json::to_value(AcquisitionEvent::Samples {
            schema_version: 1,
            acquisition_id: "acq-1".into(),
            sequence: 1,
            timestamp_ms: 1761980000000,
            monotonic_elapsed_ms: 20,
            dropped_since_previous: 0,
            timestamp_origin: Some("host_utc_after_reads"),
            monotonic_clock: Some("acquisition_elapsed"),
            samples: vec![AcquisitionSampleV1 {
                name: "Engine speed".into(), address: 4096, value: 1850.0,
                value_type: Some(SnapshotValueType::U32), quality: Some(SampleQuality::Valid),
                address_origin: Some(AddressOrigin::Manual),
            }],
        }).unwrap();
        assert_eq!(encoded, enriched);
        let decoded: AcquisitionSampleV1 = serde_json::from_value(enriched["samples"][0].clone()).unwrap();
        assert!(matches!(decoded.quality, Some(SampleQuality::Valid)));
        assert!(decoded.validate().is_ok());
        for (kind, value) in [
            (SnapshotValueType::U8, 256.0),
            (SnapshotValueType::I8, -129.0),
            (SnapshotValueType::U16, -1.0),
            (SnapshotValueType::I16, 32768.0),
            (SnapshotValueType::U32, 4294967296.0),
            (SnapshotValueType::I32, 1.25),
        ] {
            let wrong = AcquisitionSampleV1 { value_type: Some(kind), value, ..decoded.clone() };
            assert!(wrong.validate().is_err());
        }
        let overflow = AcquisitionSampleV1 {
            address: u32::MAX, value_type: Some(SnapshotValueType::F64), ..decoded.clone()
        };
        assert!(overflow.validate().is_err());
        for invalid in [
            serde_json::json!({"name":"rpm","address":4096,"value":1850,"quality":"unknown"}),
            serde_json::json!({"name":"rpm","address":4096,"value":1850,"value_type":"u64"}),
            serde_json::json!({"name":"rpm","address":4096,"value":1850,"address_origin":"elf_verified"}),
            serde_json::json!({"name":"rpm","address":4294967296_u64,"value":1850}),
        ] { assert!(serde_json::from_value::<AcquisitionSampleV1>(invalid).is_err()); }
    }

    #[test]
    fn rejects_unknown_and_malformed_acquisition_request_types() {
        for invalid in [
            r#"{"interval_ms":100,"signals":[{"name":"rpm","address":4096,"value_type":"u64"}]}"#,
            r#"{"interval_ms":"100","signals":[{"name":"rpm","address":4096,"value_type":"u32"}]}"#,
            r#"{"interval_ms":100,"signals":[{"name":"rpm","address":4294967296,"value_type":"u32"}]}"#,
            r#"{"interval_ms":100,"signals":[],"unexpected":true}"#,
        ] {
            assert!(serde_json::from_str::<AcquisitionConfig>(invalid).is_err());
        }
        assert!(serde_json::from_str::<AcquisitionConfig>(
            r#"{"interval_ms":100,"signals":[{"name":"rpm","address":4096,"value_type":"u32"}]}"#
        ).unwrap().validate().is_ok());
    }

    #[test]
    fn validates_interval_names_addresses_and_signal_count() {
        let mut value = config();
        assert!(value.validate().is_ok());
        value.interval_ms = 19;
        assert_eq!(value.validate().unwrap_err().1 .0.error.code, "INVALID_SAMPLE_INTERVAL");
        value.interval_ms = 20;
        value.signals[1].name = value.signals[0].name.clone();
        assert_eq!(value.validate().unwrap_err().1 .0.error.code, "INVALID_SIGNAL_NAME");
        value.signals[1].name = "Coolant".into();
        value.signals[1].address = u32::MAX;
        assert_eq!(value.validate().unwrap_err().1 .0.error.code, "INVALID_SIGNAL_ADDRESS");
        value.signals.clear();
        assert_eq!(value.validate().unwrap_err().1 .0.error.code, "INVALID_SIGNALS");
    }

    #[tokio::test]
    async fn one_scheduler_feeds_two_subscribers_and_stop_is_idempotent() {
        let actor = simulated_session_actor().unwrap();
        let session = actor.handle();
        session.connect().unwrap();
        let service = AcquisitionService::default();
        let run = service.start(session, config()).unwrap();
        let (_a, mut first) = run.subscribe().unwrap();
        let (_b, mut second) = run.subscribe().unwrap();
        let a = tokio::time::timeout(Duration::from_secs(2), first.recv()).await.unwrap().unwrap();
        let b = tokio::time::timeout(Duration::from_secs(2), second.recv()).await.unwrap().unwrap();
        let (AcquisitionEvent::Samples { sequence: sa, samples, .. },
             AcquisitionEvent::Samples { sequence: sb, .. }) = (a, b) else {
            panic!("both subscribers must receive the same sample event")
        };
        assert_eq!(sa, sb);
        assert_eq!(samples[0].value, 1850.0);
        assert_eq!(samples[1].value, 88.5);
        assert_eq!(run.status().subscriber_count, 2);
        assert_eq!(run.status().sampling_mode, "polling");
        run.stop();
        run.stop();
        assert_eq!(run.status().state, "stopped");
        assert!(run.subscribe().is_err());
    }

    #[tokio::test]
    async fn bounded_broadcast_reports_lag_without_unbounded_buffer_growth() {
        let actor = simulated_session_actor().unwrap();
        let session = actor.handle();
        session.connect().unwrap();
        let service = AcquisitionService::default();
        let run = service.start(session, config()).unwrap();
        let (_guard, mut slow) = run.subscribe().unwrap();
        for sequence in 1..=(CHANNEL_CAPACITY as u64 + 10) {
            let _ = run.tx.send(AcquisitionEvent::Samples {
                schema_version: 1,
                acquisition_id: run.id.clone(),
                sequence,
                timestamp_ms: 0,
                monotonic_elapsed_ms: 0,
                dropped_since_previous: 0,
                timestamp_origin: None,
                monotonic_clock: None,
                samples: vec![],
            });
        }
        assert!(matches!(slow.try_recv(), Err(broadcast::error::TryRecvError::Lagged(_))));
        run.stop();
    }

    #[tokio::test]
    async fn cannot_start_two_acquisitions_for_one_ecu() {
        let actor = simulated_session_actor().unwrap();
        let session = actor.handle();
        session.connect().unwrap();
        let service = AcquisitionService::default();
        let first = service.start(session.clone(), config()).unwrap();
        let failed = service.start(session.clone(), config()).err().unwrap();
        assert_eq!(failed.0, StatusCode::CONFLICT);
        assert_eq!(failed.1 .0.error.code, "ACQUISITION_ALREADY_RUNNING");
        first.stop();
        let second = service.start(session, config()).unwrap();
        assert_ne!(first.id, second.id);
        second.stop();
    }

    #[tokio::test]
    async fn rejects_disconnected_session_before_allocating_acquisition() {
        let actor = simulated_session_actor().unwrap();
        let service = Arc::new(AcquisitionService::default());
        let result = create(
            State(actor.handle()),
            Extension(service.clone()),
            Ok(Json(config())),
        ).await.err().unwrap();
        assert_eq!(result.1 .0.error.code, "XCP_SESSION_DISCONNECTED");
        assert!(service.current.lock().unwrap().is_none());
    }
}

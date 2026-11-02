//! Bounded, deny-by-default diagnostic events for the simulator-first backend.
//!
//! No caller-provided messages, paths, ECU bytes, raw error strings or arbitrary
//! key/value fields can enter this store. Public wire exposure and lifecycle
//! instrumentation require separate integration/contract review (T-0016).
use serde::Serialize;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_EVENTS: usize = 1024;
pub const MAX_SUPPORT_BUNDLE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Subsystem {
    Session,
    Transport,
    Acquisition,
    WebSocket,
    DataQuality,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventCode {
    SessionConnecting,
    SessionConnected,
    SessionDisconnected,
    ConnectionLost,
    ReconnectRequested,
    RequestTimeout,
    XcpNegativeResponse,
    AcquisitionStarted,
    AcquisitionStopped,
    AcquisitionFailed,
    WebSocketDisconnected,
    WebSocketTimeout,
    MeasurementGap,
    EventQueueOverflow,
}

impl EventCode {
    fn classification(self) -> (Severity, Subsystem, &'static str) {
        use EventCode as C;
        use Severity as S;
        use Subsystem as U;
        match self {
            C::SessionConnecting => (S::Info, U::Session, "Connecting to ECU"),
            C::SessionConnected => (S::Info, U::Session, "ECU session connected"),
            C::SessionDisconnected => (S::Info, U::Session, "ECU session disconnected"),
            C::ConnectionLost => (S::Error, U::Transport, "ECU connection lost"),
            C::ReconnectRequested => (S::Warning, U::Session, "Reconnect requested"),
            C::RequestTimeout => (S::Error, U::Transport, "XCP request timed out"),
            C::XcpNegativeResponse => (S::Error, U::Transport, "XCP negative response"),
            C::AcquisitionStarted => (S::Info, U::Acquisition, "Acquisition started"),
            C::AcquisitionStopped => (S::Info, U::Acquisition, "Acquisition stopped"),
            C::AcquisitionFailed => (S::Error, U::Acquisition, "Acquisition failed"),
            C::WebSocketDisconnected => (S::Warning, U::WebSocket, "WebSocket disconnected"),
            C::WebSocketTimeout => (S::Warning, U::WebSocket, "WebSocket send timed out"),
            C::MeasurementGap => (S::Warning, U::DataQuality, "Measurement gap observed"),
            C::EventQueueOverflow => (S::Warning, U::DataQuality, "Diagnostic queue overflow"),
        }
    }

    fn accepts(self, detail: &Detail) -> bool {
        match self {
            Self::RequestTimeout | Self::WebSocketTimeout => matches!(detail, Detail::Timeout { .. }),
            Self::XcpNegativeResponse => matches!(detail, Detail::XcpResponse { .. }),
            Self::MeasurementGap => matches!(detail, Detail::Gap { .. }),
            Self::EventQueueOverflow => matches!(detail, Detail::QueueOverflow { .. }),
            Self::WebSocketDisconnected => matches!(detail, Detail::WebSocketClose { .. }),
            _ => matches!(detail, Detail::None),
        }
    }
}

/// Only scoped numeric or UUID-like opaque IDs can be exported. Human-readable
/// filenames, user IDs and arbitrary session labels are rejected, not escaped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct OpaqueId(String);

#[derive(Debug, Clone, Copy)]
pub enum IdScope {
    Request,
    Session,
    Acquisition,
    WebSocket,
}

impl IdScope {
    fn prefix(self) -> &'static str {
        match self {
            Self::Request => "request-",
            Self::Session => "session-",
            Self::Acquisition => "acq-",
            Self::WebSocket => "ws-",
        }
    }
}

impl OpaqueId {
    pub fn parse(scope: IdScope, raw: &str) -> Option<Self> {
        let suffix = raw.strip_prefix(scope.prefix())?;
        if suffix.is_empty()
            || suffix.len() > 48
            || !suffix.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        {
            return None;
        }
        Some(Self(raw.to_owned()))
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Correlation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquisition_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_id: Option<OpaqueId>,
}

impl Correlation {
    pub fn from_untrusted(
        request: Option<&str>,
        session: Option<&str>,
        acquisition: Option<&str>,
        websocket: Option<&str>,
    ) -> Self {
        Self {
            request_id: request.and_then(|value| OpaqueId::parse(IdScope::Request, value)),
            session_id: session.and_then(|value| OpaqueId::parse(IdScope::Session, value)),
            acquisition_id: acquisition.and_then(|value| OpaqueId::parse(IdScope::Acquisition, value)),
            websocket_id: websocket.and_then(|value| OpaqueId::parse(IdScope::WebSocket, value)),
        }
    }
}

/// No free-text or byte payload variants: context cannot contain secrets or ECU memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Detail {
    None,
    Timeout { elapsed_ms: u64 },
    XcpResponse { error_code: u8 },
    WebSocketClose { close_code: u16 },
    Gap { missing_frames: u64 },
    QueueOverflow { dropped_frames: u64 },
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticEvent {
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub severity: Severity,
    pub subsystem: Subsystem,
    pub code: EventCode,
    pub message: &'static str,
    pub correlation: Correlation,
    pub detail: Detail,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Counters {
    pub request_timeouts: u64,
    pub connection_losses: u64,
    pub negative_responses: u64,
    pub websocket_faults: u64,
    pub missing_frames: u64,
    pub reported_queue_drops: u64,
    pub evicted_events: u64,
}

impl Counters {
    fn observe(&mut self, code: EventCode, detail: &Detail) {
        match code {
            EventCode::RequestTimeout => {
                self.request_timeouts = self.request_timeouts.saturating_add(1);
            }
            EventCode::ConnectionLost => {
                self.connection_losses = self.connection_losses.saturating_add(1);
            }
            EventCode::XcpNegativeResponse => {
                self.negative_responses = self.negative_responses.saturating_add(1);
            }
            EventCode::WebSocketDisconnected | EventCode::WebSocketTimeout => {
                self.websocket_faults = self.websocket_faults.saturating_add(1);
            }
            EventCode::MeasurementGap => {
                if let Detail::Gap { missing_frames } = detail {
                    self.missing_frames = self.missing_frames.saturating_add(*missing_frames);
                }
            }
            EventCode::EventQueueOverflow => {
                if let Detail::QueueOverflow { dropped_frames } = detail {
                    self.reported_queue_drops =
                        self.reported_queue_drops.saturating_add(*dropped_frames);
                }
            }
            _ => {}
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum DiagnosticError {
    InvalidCapacity,
    InvalidDetail,
    InvalidClock,
    ConsentRequired,
    BundleTooLarge,
    Serialization,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    Simulator,
    Pcan,
    Vector,
    Unknown,
}

#[derive(Serialize)]
struct BuildContext {
    product: &'static str,
    version: &'static str,
    operating_system: &'static str,
    adapter: AdapterKind,
}

#[derive(Serialize)]
struct SupportBundle<'a> {
    format_version: u8,
    generated_at_ms: u64,
    context: BuildContext,
    events: Vec<&'a DiagnosticEvent>,
    counters: &'a Counters,
}

/// Locking, persistence, networking and producer registration belong to their
/// integration owners. This core uses an O(1), bounded ring and no telemetry.
pub struct Diagnostics {
    capacity: usize,
    next_sequence: u64,
    events: VecDeque<DiagnosticEvent>,
    counters: Counters,
}

impl Diagnostics {
    pub fn new(capacity: usize) -> Result<Self, DiagnosticError> {
        if !(1..=MAX_EVENTS).contains(&capacity) {
            return Err(DiagnosticError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            next_sequence: 1,
            events: VecDeque::with_capacity(capacity),
            counters: Counters::default(),
        })
    }

    pub fn events(&self) -> impl Iterator<Item = &DiagnosticEvent> {
        self.events.iter()
    }

    pub fn counters(&self) -> &Counters {
        &self.counters
    }

    pub fn record(
        &mut self,
        code: EventCode,
        correlation: Correlation,
        detail: Detail,
    ) -> Result<(), DiagnosticError> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| DiagnosticError::InvalidClock)?
            .as_millis();
        let timestamp_ms = u64::try_from(millis).map_err(|_| DiagnosticError::InvalidClock)?;
        self.record_at(timestamp_ms, code, correlation, detail)
    }

    /// Injection point for reproducible simulator fault tests.
    pub fn record_at(
        &mut self,
        timestamp_ms: u64,
        code: EventCode,
        correlation: Correlation,
        detail: Detail,
    ) -> Result<(), DiagnosticError> {
        if !code.accepts(&detail) {
            return Err(DiagnosticError::InvalidDetail);
        }
        let (severity, subsystem, message) = code.classification();
        if self.events.len() == self.capacity {
            self.events.pop_front();
            self.counters.evicted_events = self.counters.evicted_events.saturating_add(1);
        }
        self.events.push_back(DiagnosticEvent {
            sequence: self.next_sequence,
            timestamp_ms,
            severity,
            subsystem,
            code,
            message,
            correlation,
            detail: detail.clone(),
        });
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.counters.observe(code, &detail);
        Ok(())
    }

    /// Produces local JSON bytes *only* after an explicit operator decision.
    /// No upload, background collection, absolute paths or raw ECU data.
    pub fn export_approved(
        &self,
        operator_approved: bool,
        adapter: AdapterKind,
    ) -> Result<Vec<u8>, DiagnosticError> {
        self.export_limited(operator_approved, adapter, MAX_SUPPORT_BUNDLE_BYTES)
    }

    fn export_limited(
        &self,
        operator_approved: bool,
        adapter: AdapterKind,
        max_bytes: usize,
    ) -> Result<Vec<u8>, DiagnosticError> {
        if !operator_approved {
            return Err(DiagnosticError::ConsentRequired);
        }
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| DiagnosticError::InvalidClock)?
            .as_millis();
        let generated_at_ms = u64::try_from(millis).map_err(|_| DiagnosticError::InvalidClock)?;
        let bundle = SupportBundle {
            format_version: 1,
            generated_at_ms,
            context: BuildContext {
                product: "xcp-studio",
                version: env!("CARGO_PKG_VERSION"),
                operating_system: std::env::consts::OS,
                adapter,
            },
            events: self.events().collect(),
            counters: &self.counters,
        };
        let bytes = serde_json::to_vec(&bundle).map_err(|_| DiagnosticError::Serialization)?;
        if bytes.len() > max_bytes {
            return Err(DiagnosticError::BundleTooLarge);
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> Correlation {
        Correlation::from_untrusted(
            Some("request-01"),
            Some("session-dead"),
            Some("acq-12"),
            Some("ws-b"),
        )
    }

    #[test]
    fn correlated_faults_have_stable_codes_severity_and_timestamps() {
        let mut store = Diagnostics::new(8).unwrap();
        store
            .record_at(100, EventCode::ConnectionLost, ids(), Detail::None)
            .unwrap();
        store
            .record_at(101, EventCode::RequestTimeout, ids(), Detail::Timeout { elapsed_ms: 200 })
            .unwrap();
        store
            .record_at(102, EventCode::MeasurementGap, ids(), Detail::Gap { missing_frames: 4 })
            .unwrap();
        let events: Vec<_> = store.events().collect();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].severity, Severity::Error);
        assert_eq!(events[0].subsystem, Subsystem::Transport);
        assert_eq!(events[1].timestamp_ms, 101);
        assert_eq!(events[2].code, EventCode::MeasurementGap);
        assert_eq!(events[0].correlation.session_id, events[2].correlation.session_id);
        assert_eq!(store.counters().request_timeouts, 1);
        assert_eq!(store.counters().missing_frames, 4);
        assert_eq!(store.counters().connection_losses, 1);
    }

    #[test]
    fn rejects_private_paths_credentials_and_untrusted_labels() {
        let credentials = "password=hunter2";
        let private_path = r"C:\Users\alice\private\secret.elf";
        let linux_path = "/home/alice/ecu_dump.bin";
        for secret in [credentials, private_path, linux_path, "session-my_secret", "acq-secret"] {
            assert!(OpaqueId::parse(IdScope::Session, secret).is_none());
        }
        let ids = Correlation::from_untrusted(
            Some(credentials),
            Some(private_path),
            Some(linux_path),
            Some("ws-token=supersecret"),
        );
        let mut store = Diagnostics::new(1).unwrap();
        store.record_at(1, EventCode::AcquisitionFailed, ids, Detail::None).unwrap();
        let json = String::from_utf8(store.export_approved(true, AdapterKind::Unknown).unwrap()).unwrap();
        for secret in [credentials, private_path, linux_path, "supersecret", "ecu_dump"] {
            assert!(!json.contains(secret));
        }
        assert!(!json.contains("request_id"));
        assert!(!json.contains("session_id"));
    }

    #[test]
    fn ring_eviction_is_bounded_and_counts_faults() {
        assert!(matches!(Diagnostics::new(0), Err(DiagnosticError::InvalidCapacity)));
        assert!(matches!(Diagnostics::new(MAX_EVENTS + 1), Err(DiagnosticError::InvalidCapacity)));
        let mut store = Diagnostics::new(2).unwrap();
        for i in 0..100 {
            store.record_at(i, EventCode::WebSocketTimeout, ids(), Detail::Timeout { elapsed_ms: 10 }).unwrap();
        }
        let seq: Vec<_> = store.events().map(|item| item.sequence).collect();
        assert_eq!(seq, vec![99, 100]);
        assert_eq!(store.counters().evicted_events, 98);
        assert_eq!(store.counters().websocket_faults, 100);
    }

    #[test]
    fn invalid_event_details_fail_closed_and_dont_change_counts() {
        let mut store = Diagnostics::new(2).unwrap();
        assert_eq!(
            store.record_at(0, EventCode::RequestTimeout, ids(), Detail::Gap { missing_frames: 7 }),
            Err(DiagnosticError::InvalidDetail)
        );
        assert_eq!(store.events().count(), 0);
        assert_eq!(store.counters().request_timeouts, 0);
        store.record_at(1, EventCode::EventQueueOverflow, ids(), Detail::QueueOverflow { dropped_frames: 12 }).unwrap();
        store.record_at(2, EventCode::XcpNegativeResponse, ids(), Detail::XcpResponse { error_code: 0x22 }).unwrap();
        assert_eq!(store.counters().reported_queue_drops, 12);
        assert_eq!(store.counters().negative_responses, 1);
    }

    #[test]
    fn bundle_export_requires_consent_and_enforces_size_limit() {
        let mut store = Diagnostics::new(1).unwrap();
        store.record_at(1, EventCode::SessionConnected, ids(), Detail::None).unwrap();
        assert_eq!(store.export_approved(false, AdapterKind::Simulator), Err(DiagnosticError::ConsentRequired));
        assert_eq!(store.export_limited(true, AdapterKind::Simulator, 10), Err(DiagnosticError::BundleTooLarge));
        let bytes = store.export_approved(true, AdapterKind::Simulator).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["format_version"], 1);
        assert_eq!(json["context"]["adapter"], "simulator");
        assert_eq!(json["events"][0]["correlation"]["acquisition_id"], "acq-12");
        assert!(json.get("memory_bytes").is_none());
    }
}

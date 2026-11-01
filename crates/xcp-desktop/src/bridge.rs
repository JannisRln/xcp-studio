//! Optional read-only subscriber to the backend-owned acquisition.
//! This crate does not create an XCP master, issue a read command, or start acquisition.

use crate::fixture::{SampleFrame, SampleQuality};
use serde_json::Value;
use std::net::{SocketAddr, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc,
};
use std::time::Duration;
use tungstenite::client::client_with_config;
use tungstenite::protocol::WebSocketConfig;

const CHANNEL_DEPTH: usize = 256;
const WIRE_LIMIT: usize = 64 * 1024;
const SUBSCRIBER_ENDPOINT: &str = "127.0.0.1:8080";

#[derive(Debug)]
pub enum BridgeEvent {
    Frame(SampleFrame, [String; 2]),
    Gap(u64),
    Status(String),
    Error(String),
}

pub fn valid_acquisition_id(id: &str) -> bool {
    (5..=80).contains(&id.len())
        && id.starts_with("acq-")
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Only the existing backend broadcast stream is allowed; no HTTP POST, no ECU reads.
pub struct Subscription {
    pub events: Receiver<BridgeEvent>,
    cancel: Arc<AtomicBool>,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}

pub fn subscribe(acquisition_id: String) -> Result<Subscription, String> {
    if !valid_acquisition_id(&acquisition_id) {
        return Err("invalid acquisition ID (expected acq- with ASCII letters/digits/-/_)".into());
    }
    let (sender, receiver) = mpsc::sync_channel(CHANNEL_DEPTH);
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = Arc::clone(&cancel);
    std::thread::spawn(move || run(acquisition_id, sender, worker_cancel));
    Ok(Subscription { events: receiver, cancel })
}

fn run(id: String, tx: SyncSender<BridgeEvent>, cancel: Arc<AtomicBool>) {
    if let Err(error) = stream(&id, &tx, &cancel) {
        if !cancel.load(Ordering::Acquire) {
            let _ = tx.try_send(BridgeEvent::Error(error));
        }
    }
}

fn stream(id: &str, tx: &SyncSender<BridgeEvent>, cancel: &AtomicBool) -> Result<(), String> {
    let address: SocketAddr = SUBSCRIBER_ENDPOINT.parse().map_err(|e| format!("{e}"))?;
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|e| format!("loopback backend unavailable: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|e| format!("read timeout setup failed: {e}"))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| format!("write timeout setup failed: {e}"))?;

    let url = format!("ws://{SUBSCRIBER_ENDPOINT}/api/v1/acquisitions/{id}/stream");
    let config = WebSocketConfig::default()
        .max_message_size(Some(WIRE_LIMIT))
        .max_frame_size(Some(WIRE_LIMIT));
    let (mut socket, _) = client_with_config(url.as_str(), stream, Some(config))
        .map_err(|e| format!("read-only subscribe failed: {e}"))?;
    let mut dropped_locally: u64 = 0;
    loop {
        if cancel.load(Ordering::Acquire) {
            let _ = socket.close(None);
            break;
        }
        let message = match socket.read() {
            Ok(message) => message,
            Err(tungstenite::Error::Io(ref error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(tungstenite::Error::ConnectionClosed) => {
                let _ = tx.try_send(BridgeEvent::Status("stream closed".into()));
                break;
            }
            Err(error) => return Err(format!("subscriber stream ended: {error}")),
        };
        if message.is_close() {
            let _ = tx.try_send(BridgeEvent::Status("stream closed".into()));
            break;
        }
        if !message.is_text() {
            continue;
        }
        let text = message.to_text().map_err(|e| format!("invalid WS text: {e}"))?;
        let event = parse_event(text, id)?;
        if dropped_locally != 0 {
            match tx.try_send(BridgeEvent::Gap(dropped_locally)) {
                Ok(()) => dropped_locally = 0,
                Err(TrySendError::Full(_)) => {
                    dropped_locally = dropped_locally.saturating_add(1);
                    continue;
                }
                Err(TrySendError::Disconnected(_)) => break,
            }
        }
        match tx.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                dropped_locally = dropped_locally.saturating_add(1);
            }
            Err(TrySendError::Disconnected(_)) => break,
        }
    }
    Ok(())
}

/// Parse only the existing public v1 read-only stream. Unknown/invalid quality
/// is not promoted to a valid numeric measurement.
pub fn parse_event(payload: &str, acquisition_id: &str) -> Result<BridgeEvent, String> {
    if payload.len() > WIRE_LIMIT {
        return Err("oversized acquisition event".into());
    }
    let root: Value = serde_json::from_str(payload).map_err(|_| "invalid event JSON")?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(1)
        || root.get("acquisition_id").and_then(Value::as_str) != Some(acquisition_id)
    {
        return Err("unexpected acquisition or schema version".into());
    }
    match root.get("type").and_then(Value::as_str) {
        Some("gap") => {
            let count = root.get("dropped").and_then(Value::as_u64)
                .ok_or("invalid subscriber gap")?;
            Ok(BridgeEvent::Gap(count))
        }
        Some("status") => {
            let state = root.get("state").and_then(Value::as_str)
                .ok_or("missing acquisition state")?;
            Ok(BridgeEvent::Status(state.chars().take(32).collect()))
        }
        Some("samples") => {
            let timestamp_ms = root.get("timestamp_ms").and_then(Value::as_u64)
                .ok_or("missing host timestamp")?;
            let sequence = root.get("sequence").and_then(Value::as_u64)
                .ok_or("missing sequence")?;
            let samples = root.get("samples").and_then(Value::as_array)
                .ok_or("missing sample array")?;
            let mut values = [None, None];
            let mut quality = [SampleQuality::Missing; 2];
            let mut names = ["Signal A (raw)".to_string(), "Signal B (raw)".to_string()];
            for (i, sample) in samples.iter().take(2).enumerate() {
                let name = sample.get("name").and_then(Value::as_str)
                    .ok_or("missing sample name")?;
                if name.is_empty() || name.len() > 128 {
                    return Err("invalid sample name".into());
                }
                names[i] = name.to_owned();
                let wire_quality = sample.get("quality").and_then(Value::as_str);
                let finite = sample.get("value").and_then(Value::as_f64)
                    .filter(|v| v.is_finite());
                quality[i] = match (wire_quality, finite) {
                    (Some("valid"), Some(_)) => SampleQuality::DecodedValid,
                    (None, Some(_)) => SampleQuality::LegacyUnverified,
                    (Some("valid") | None, None) => SampleQuality::Missing,
                    _ => SampleQuality::Invalid,
                };
                if !matches!(quality[i], SampleQuality::Invalid) {
                    values[i] = finite;
                }
            }
            Ok(BridgeEvent::Frame(SampleFrame {
                timestamp_ms, sequence, values, quality, gap_before: false,
            }, names))
        }
        _ => Err("unsupported acquisition event".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_bounded_safe_ids_can_construct_loopback_url() {
        assert!(valid_acquisition_id("acq-1"));
        for invalid in ["abc", "acq-../secrets", "acq-1?x", "acq-1/", "acq-ä"] {
            assert!(!valid_acquisition_id(invalid));
        }
    }

    #[test]
    fn parses_backend_contract_without_starting_session() {
        let sample = include_str!("../../../contracts/v1/acquisition-sample.json");
        match parse_event(sample, "acq-1").unwrap() {
            BridgeEvent::Frame(frame, names) => {
                assert_eq!(frame.sequence, 1);
                assert_eq!(frame.values[0], Some(1850.0));
                assert_eq!(frame.quality[0], SampleQuality::LegacyUnverified);
                assert_eq!(names[0], "Engine speed");
            }
            _ => panic!("expected frame"),
        }
        let gap = include_str!("../../../contracts/v1/acquisition-gap-scoped.json");
        assert!(matches!(parse_event(gap, "acq-1"), Ok(BridgeEvent::Gap(_))));
    }

    #[test]
    fn checked_quality_is_not_physical_quality() {
        let data = include_str!("../../../contracts/v1/acquisition-sample-qualified.json");
        match parse_event(data, "acq-1").unwrap() {
            BridgeEvent::Frame(frame, _) =>
                assert_eq!(frame.quality[0], SampleQuality::DecodedValid),
            _ => panic!("expected numeric sample"),
        }
    }

    #[test]
    fn rejects_wrong_acquisition_and_invalid_values() {
        let sample = include_str!("../../../contracts/v1/acquisition-sample.json");
        assert!(parse_event(sample, "acq-other").is_err());
        let forged = r#"{"schema_version":1,"type":"samples","acquisition_id":"acq-1","sequence":4,"timestamp_ms":42,"samples":[{"name":"x","value":1,"quality":"invalid"}]}"#;
        match parse_event(forged, "acq-1").unwrap() {
            BridgeEvent::Frame(f, _) => {
                assert_eq!(f.values[0], None);
                assert_eq!(f.quality[0], SampleQuality::Invalid);
            },
            _ => panic!("expected frame"),
        }
    }
}

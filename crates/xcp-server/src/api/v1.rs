//! Additive version-one HTTP contracts for the simulator API.
//! Existing unversioned routes remain supported until consumers migrate.

use super::super::Session;
use xcp_core::session::{SessionError, SessionState};
use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

const SCHEMA_VERSION: u8 = 1;
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ApiErrorDetails {
    pub code: String,
    pub message: String,
    pub request_id: String,
    pub retryable: bool,
    /// Optional structured, non-sensitive validation diagnostics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ApiErrorEnvelope {
    pub schema_version: u8,
    pub error: ApiErrorDetails,
}

pub(crate) type ApiFailure = (StatusCode, Json<ApiErrorEnvelope>);
type ApiResult<T> = Result<Json<T>, ApiFailure>;

pub(crate) fn error(status: StatusCode, code: &str, message: impl Into<String>, retryable: bool) -> ApiFailure {
    let request_id = format!("request-{}", REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed));
    (
        status,
        Json(ApiErrorEnvelope {
            schema_version: SCHEMA_VERSION,
            error: ApiErrorDetails {
                code: code.to_owned(),
                message: message.into(),
                request_id,
                retryable,
                details: None,
            },
        }),
    )
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HealthV1 {
    pub schema_version: u8,
    pub status: String,
    pub mode: String,
    pub version: String,
}

pub async fn health() -> Json<HealthV1> {
    Json(HealthV1 {
        schema_version: SCHEMA_VERSION,
        status: "ok".into(),
        mode: "simulation".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SessionV1 {
    pub schema_version: u8,
    pub connected: bool,
    pub transport: String,
}

pub async fn status(State(session): State<Session>) -> Json<SessionV1> {
    let connected = tokio::task::spawn_blocking(move || session.state())
        .await
        .ok()
        .and_then(Result::ok)
        == Some(SessionState::Connected);
    Json(SessionV1 {
        schema_version: SCHEMA_VERSION,
        connected,
        transport: "simulation".into(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadRequestV1 {
    pub address: u32,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadResultV1 {
    pub schema_version: u8,
    pub address: u32,
    pub bytes: Vec<u8>,
    pub hex: String,
}

fn validate_read_request(request: &ReadRequestV1) -> Result<(), ApiFailure> {
    if !(1..=4096).contains(&request.count) {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_READ_COUNT",
            "count must be between 1 and 4096",
            false,
        ));
    }
    let length = u32::try_from(request.count).expect("validated maximum is 4096");
    if request.address.checked_add(length - 1).is_none() {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_ADDRESS_RANGE",
            "read would exceed the 32-bit address space",
            false,
        ));
    }
    Ok(())
}

/// Read simulator memory via the same serialized XCP master as legacy routes.
pub async fn read(
    State(session): State<Session>,
    payload: Result<Json<ReadRequestV1>, JsonRejection>,
) -> ApiResult<ReadResultV1> {
    let Json(request) = payload.map_err(|_| {
        error(
            StatusCode::BAD_REQUEST,
            "INVALID_JSON",
            "request must contain a 32-bit address and an integer count",
            false,
        )
    })?;
    validate_read_request(&request)?;

    let bytes = tokio::task::spawn_blocking(move || session.read(request.address, request.count))
        .await
        .map_err(|_| error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "XCP_WORKER_JOIN_FAILED",
            "XCP session worker could not complete the read",
            true,
        ))?
        .map_err(|cause| match cause {
            SessionError::Disconnected => error(
                StatusCode::CONFLICT,
                "XCP_SESSION_DISCONNECTED",
                "XCP simulator is not connected",
                false,
            ),
            SessionError::Faulted => error(
                StatusCode::SERVICE_UNAVAILABLE,
                "XCP_SESSION_FAULTED",
                "XCP simulator session faulted; reconnect explicitly",
                false,
            ),
            SessionError::WorkerStopped => error(
                StatusCode::SERVICE_UNAVAILABLE,
                "XCP_WORKER_STOPPED",
                "XCP session worker is unavailable",
                true,
            ),
            SessionError::Xcp(cause) => error(
                StatusCode::BAD_GATEWAY,
                "XCP_READ_FAILED",
                cause.to_string(),
                true,
            ),
        })?;
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(Json(ReadResultV1 {
        schema_version: SCHEMA_VERSION,
        address: request.address,
        bytes,
        hex,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_read_limits_and_overflow() {
        for count in [0, 4097, usize::MAX] {
            let failed = validate_read_request(&ReadRequestV1 { address: 0, count })
                .expect_err("count must be rejected");
            assert_eq!(failed.0, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(failed.1 .0.error.code, "INVALID_READ_COUNT");
        }
        let failed = validate_read_request(&ReadRequestV1 {
            address: u32::MAX,
            count: 2,
        })
        .expect_err("address overflow must be rejected");
        assert_eq!(failed.1 .0.error.code, "INVALID_ADDRESS_RANGE");
        validate_read_request(&ReadRequestV1 { address: u32::MAX, count: 1 })
            .expect("one byte at the end does not overflow");
    }

    #[test]
    fn rejects_unknown_request_fields_and_float_count() {
        for payload in [
            r#"{"address":4096,"count":4,"extra":true}"#,
            r#"{"address":4294967296,"count":4}"#,
            r#"{"address":4096,"count":1.5}"#,
            r#"{"address":4096}"#,
        ] {
            assert!(serde_json::from_str::<ReadRequestV1>(payload).is_err());
        }
    }

    #[tokio::test]
    async fn versioned_read_reports_disconnected_session() {
        let actor = crate::simulated_session_actor().expect("simulator initialization");
        let session = actor.handle();
        let failed = read(
            State(session),
            Ok(Json(ReadRequestV1 { address: 4096, count: 4 })),
        )
        .await
        .expect_err("read without a session must fail");
        assert_eq!(failed.0, StatusCode::CONFLICT);
        assert_eq!(failed.1 .0.error.code, "XCP_SESSION_DISCONNECTED");
        assert!(!failed.1 .0.error.request_id.is_empty());
    }

    #[test]
    fn shared_json_fixtures_match_rust_contracts() {
        let health: HealthV1 = serde_json::from_str(include_str!(
            "../../../../contracts/v1/health.json"
        ))
        .expect("health fixture");
        assert_eq!(health.schema_version, SCHEMA_VERSION);
        assert_eq!(health.mode, "simulation");

        let session: SessionV1 = serde_json::from_str(include_str!(
            "../../../../contracts/v1/session.json"
        ))
        .expect("session fixture");
        assert!(session.connected);

        let read: ReadResultV1 = serde_json::from_str(include_str!(
            "../../../../contracts/v1/read.json"
        ))
        .expect("read fixture");
        assert_eq!(read.bytes, [58, 7, 0, 0]);
        assert_eq!(read.hex, "3A 07 00 00");

        let failure: ApiErrorEnvelope = serde_json::from_str(include_str!(
            "../../../../contracts/v1/error-disconnected.json"
        ))
        .expect("error fixture");
        assert_eq!(failure.error.code, "XCP_SESSION_DISCONNECTED");
        assert_eq!(failure.schema_version, SCHEMA_VERSION);

        let validation: ApiErrorEnvelope = serde_json::from_str(include_str!(
            "../../../../contracts/v1/error-validation.json"
        )).expect("structured validation fixture");
        assert_eq!(validation.error.code, "INVALID_SAMPLE_INTERVAL");
        assert_eq!(validation.error.details.as_ref().unwrap()["field"], "interval_ms");
        let serialized = serde_json::to_value(validation).unwrap();
        assert_eq!(serialized["error"]["details"]["min"], 20);
        let unknown = serde_json::json!({"schema_version": 2, "error": {
            "code": "INVALID_JSON", "message": "invalid", "request_id": "req-1", "retryable": false
        }});
        // The wire version is validated by the TypeScript boundary, not serde's u8 type.
        assert_ne!(serde_json::from_value::<ApiErrorEnvelope>(unknown).unwrap().schema_version, SCHEMA_VERSION);
    }
}

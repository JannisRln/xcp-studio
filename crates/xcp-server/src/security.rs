//! Loopback API defenses and process-wide resource budgets.
//!
//! This guard is defense in depth, not authentication. Never expose it as a
//! remotely reachable ECU API without a separate security review.

use crate::api::v1::{error, ApiFailure};
use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub const MAX_JSON_BODY: usize = 16 * 1024;
pub const MAX_ELF_BODY: usize = 32 * 1024 * 1024;
pub const MAX_WS_MESSAGE: usize = 16 * 1024;
pub const MAX_INFLIGHT_REQUESTS: usize = 32;
pub const MAX_CONCURRENT_ELF: usize = 2;
pub const MAX_LEGACY_WS_CLIENTS: usize = 8;
pub const MAX_REQUESTS_PER_SECOND: u32 = 256;
pub const WS_CONFIG_TIMEOUT: Duration = Duration::from_secs(5);
pub const WS_SEND_TIMEOUT: Duration = Duration::from_secs(5);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const ELF_TIMEOUT: Duration = Duration::from_secs(30);
const RATE_WINDOW: Duration = Duration::from_secs(1);

const ACCEPTED_ORIGINS: &[&str] = &[
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://127.0.0.1:5173",
    "https://localhost:5173",
];

struct RateWindow {
    began: Instant,
    used: u32,
}

impl RateWindow {
    fn allow_at(&mut self, now: Instant) -> bool {
        if now.duration_since(self.began) >= RATE_WINDOW {
            self.began = now;
            self.used = 0;
        }
        if self.used >= MAX_REQUESTS_PER_SECOND {
            return false;
        }
        self.used += 1;
        true
    }
}

/// Resources shared across all API routes, rather than per request/client.
/// No client-provided fields configure or increase these budgets.
/// The permit survives an HTTP timeout while a CPU-bound ELF parse is still
/// running in spawn_blocking. Dropping a timed-out HTTP future cannot bypass
/// the parser concurrency budget.
pub struct ElfParsePermit {
    _slot: OwnedSemaphorePermit,
}

pub struct SecurityLimits {
    requests: Arc<Semaphore>,
    elf_parses: Arc<Semaphore>,
    legacy_websockets: Arc<Semaphore>,
    rate: Mutex<RateWindow>,
}

impl Default for SecurityLimits {
    fn default() -> Self {
        Self {
            requests: Arc::new(Semaphore::new(MAX_INFLIGHT_REQUESTS)),
            elf_parses: Arc::new(Semaphore::new(MAX_CONCURRENT_ELF)),
            legacy_websockets: Arc::new(Semaphore::new(MAX_LEGACY_WS_CLIENTS)),
            rate: Mutex::new(RateWindow {
                began: Instant::now(),
                used: 0,
            }),
        }
    }
}

impl SecurityLimits {
    fn allow_request(&self) -> bool {
        self.rate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .allow_at(Instant::now())
    }

    /// A permit is held for the entire lifetime of a legacy WS stream.
    /// Shared acquisition streams separately enforce their 16-subscriber cap.
    pub fn legacy_websocket_permit(&self) -> Result<OwnedSemaphorePermit, ApiFailure> {
        Arc::clone(&self.legacy_websockets)
            .try_acquire_owned()
            .map_err(|_| {
                error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "WEBSOCKET_CLIENT_LIMIT",
                    "too many legacy streaming clients",
                    true,
                )
            })
    }
}

fn valid_loopback_host(value: &str) -> bool {
    let (hostname, port) = match value.rsplit_once(':') {
        Some((hostname, port)) => (hostname, Some(port)),
        None => (value, None),
    };
    if !hostname.eq_ignore_ascii_case("localhost") && hostname != "127.0.0.1" {
        return false;
    }
    port.is_none_or(|number| number.parse::<u16>().is_ok_and(|value| value > 0))
}

fn validate(headers: &HeaderMap) -> Result<(), &'static str> {
    if headers.get_all(header::HOST).iter().count() != 1 {
        return Err("exactly one Host header is required");
    }
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or("missing or invalid Host header")?;
    if !valid_loopback_host(host) {
        return Err("only loopback Host headers are accepted");
    }

    if headers.get_all(header::ORIGIN).iter().count() > 1 {
        return Err("multiple Origin headers are not permitted");
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        let origin = origin.to_str().map_err(|_| "invalid Origin header")?;
        if !ACCEPTED_ORIGINS.contains(&origin) {
            return Err("origin is not authorized for the local XCP Studio API");
        }
    }

    if headers.get_all("sec-fetch-site").iter().count() > 1 {
        return Err("ambiguous browser fetch metadata");
    }
    if let Some(site) = headers.get("sec-fetch-site") {
        match site.to_str().map_err(|_| "invalid browser fetch metadata")? {
            "none" | "same-origin" | "same-site" => {}
            _ => return Err("cross-site browser requests are not permitted"),
        }
    }
    Ok(())
}

fn body_budget(path: &str) -> usize {
    if path == "/api/elf/inspect" {
        MAX_ELF_BODY
    } else {
        MAX_JSON_BODY
    }
}

fn validate_content_length(headers: &HeaderMap, path: &str) -> Result<(), StatusCode> {
    if headers.get_all(header::CONTENT_LENGTH).iter().count() > 1 {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(value) = headers.get(header::CONTENT_LENGTH) {
        let number = value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or(StatusCode::BAD_REQUEST)?;
        if number > body_budget(path) as u64 {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
    }
    Ok(())
}

/// The message is always an allowlisted constant, never a driver error,
/// uploaded filename, diagnostic path, token or untrusted user input.
pub fn safe_internal_error() -> &'static str {
    "XCP operation failed; inspect local diagnostics"
}

/// Wrap every HTTP route, including both WebSocket upgrade requests.
/// Body extractors additionally enforce limits for chunked/unknown-length bodies.
pub async fn local_api_guard(
    State(limits): State<Arc<SecurityLimits>>,
    request: Request,
    next: Next,
) -> Response {
    if let Err(message) = validate(request.headers()) {
        return error(StatusCode::FORBIDDEN, "LOCAL_ORIGIN_FORBIDDEN", message, false)
            .into_response();
    }
    let elf = request.uri().path() == "/api/elf/inspect";
    if let Err(status) = validate_content_length(request.headers(), request.uri().path()) {
        let code = if status == StatusCode::PAYLOAD_TOO_LARGE {
            "REQUEST_TOO_LARGE"
        } else {
            "INVALID_CONTENT_LENGTH"
        };
        return error(status, code, "invalid or oversized request body", false).into_response();
    }
    if !limits.allow_request() {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "REQUEST_RATE_LIMIT",
            "local API request rate exceeded",
            true,
        )
        .into_response();
    }
    let Ok(_request_permit) = Arc::clone(&limits.requests).try_acquire_owned() else {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "REQUEST_CONCURRENCY_LIMIT",
            "too many concurrent API requests",
            true,
        )
        .into_response();
    };
    let mut request = request;
    let _elf_permit = if elf {
        match Arc::clone(&limits.elf_parses).try_acquire_owned() {
            Ok(permit) => {
                let holder = Arc::new(ElfParsePermit { _slot: permit });
                request.extensions_mut().insert(Arc::clone(&holder));
                Some(holder)
            }
            Err(_) => {
                return error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "ELF_CONCURRENCY_LIMIT",
                    "too many concurrent ELF inspections",
                    true,
                )
                .into_response();
            }
        }
    } else {
        None
    };
    let deadline = if elf { ELF_TIMEOUT } else { HTTP_TIMEOUT };
    match tokio::time::timeout(deadline, next.run(request)).await {
        Ok(response) => response,
        Err(_) => error(
            StatusCode::GATEWAY_TIMEOUT,
            "REQUEST_TIMEOUT",
            "local API request deadline exceeded",
            true,
        )
        .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(host: &str, origin: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_str(host).unwrap());
        if let Some(origin) = origin {
            headers.insert(header::ORIGIN, HeaderValue::from_str(origin).unwrap());
        }
        headers
    }

    #[test]
    fn accepts_loopback_hosts_and_the_dev_server_origin() {
        assert!(validate(&headers("127.0.0.1:8080", None)).is_ok());
        assert!(validate(&headers("localhost:8080", Some("http://localhost:5173"))).is_ok());
        assert!(validate(&headers("127.0.0.1:8080", Some("http://127.0.0.1:5173"))).is_ok());
        assert!(validate(&headers("localhost:8080", Some("http://localhost:8080"))).is_ok());
        assert!(validate(&headers("LOCALHOST:8080", None)).is_ok());
    }

    #[test]
    fn denies_cross_site_dns_rebinding_and_ambiguous_headers() {
        for host in [
            "evil.example:8080", "localhost.evil.example:8080", "127.0.0.2:8080",
            "localhost:bad", "localhost:0", "localhost:65536",
        ] {
            assert!(validate(&headers(host, None)).is_err(), "{host}");
        }
        for origin in [
            "https://evil.example", "null", "http://localhost.evil.example:5173",
            "http://localhost:5174", "http://localhost:5173/evil",
        ] {
            assert!(validate(&headers("localhost:8080", Some(origin))).is_err(), "{origin}");
        }
        assert!(validate(&HeaderMap::new()).is_err());

        let mut duplicate_hosts = headers("localhost:8080", None);
        duplicate_hosts.append(header::HOST, HeaderValue::from_static("localhost:8080"));
        assert!(validate(&duplicate_hosts).is_err());
        let mut duplicate_origins = headers("localhost:8080", Some("http://localhost:5173"));
        duplicate_origins.append(header::ORIGIN, HeaderValue::from_static("https://evil.example"));
        assert!(validate(&duplicate_origins).is_err());
    }

    #[test]
    fn denies_cross_site_and_invalid_fetch_metadata_without_origin() {
        for site in ["cross-site", "evil", ""] {
            let mut headers = headers("127.0.0.1:8080", None);
            headers.insert("sec-fetch-site", HeaderValue::from_str(site).unwrap());
            assert!(validate(&headers).is_err(), "{site}");
        }
    }

    #[test]
    fn checks_route_specific_content_length_without_allocation() {
        assert_eq!(body_budget("/api/elf/inspect"), 32 * 1024 * 1024);
        assert_eq!(body_budget("/api/xcp/snapshot"), 16 * 1024);
        for (path, length, status) in [
            ("/api/xcp/read", "16385", StatusCode::PAYLOAD_TOO_LARGE),
            ("/api/elf/inspect", "33554433", StatusCode::PAYLOAD_TOO_LARGE),
            ("/api/xcp/read", "bad", StatusCode::BAD_REQUEST),
            ("/api/xcp/read", "18446744073709551616", StatusCode::BAD_REQUEST),
        ] {
            let mut headers = headers("localhost:8080", None);
            headers.insert(header::CONTENT_LENGTH, HeaderValue::from_str(length).unwrap());
            assert_eq!(validate_content_length(&headers, path), Err(status));
        }
        let mut headers = headers("localhost:8080", None);
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("16384"));
        assert!(validate_content_length(&headers, "/api/xcp/read").is_ok());
        headers.append(header::CONTENT_LENGTH, HeaderValue::from_static("1"));
        assert_eq!(
            validate_content_length(&headers, "/api/xcp/read"),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn fixed_window_rate_counter_recovers_after_expiry() {
        let start = Instant::now();
        let mut rate = RateWindow { began: start, used: 0 };
        for _ in 0..MAX_REQUESTS_PER_SECOND {
            assert!(rate.allow_at(start));
        }
        assert!(!rate.allow_at(start));
        assert!(rate.allow_at(start + RATE_WINDOW));
    }

    #[tokio::test]
    async fn connection_and_inflight_budgets_fail_closed_and_release() {
        let limits = SecurityLimits::default();
        let mut permits = Vec::new();
        for _ in 0..MAX_LEGACY_WS_CLIENTS {
            permits.push(limits.legacy_websocket_permit().unwrap());
        }
        let error = limits.legacy_websocket_permit().err().unwrap();
        assert_eq!(error.0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(error.1 .0.error.code, "WEBSOCKET_CLIENT_LIMIT");
        permits.pop();
        assert!(limits.legacy_websocket_permit().is_ok());

        let mut in_flight = Vec::new();
        for _ in 0..MAX_INFLIGHT_REQUESTS {
            in_flight.push(Arc::clone(&limits.requests).try_acquire_owned().unwrap());
        }
        assert!(Arc::clone(&limits.requests).try_acquire_owned().is_err());
        in_flight.pop();
        assert!(Arc::clone(&limits.requests).try_acquire_owned().is_ok());

        let _first = Arc::clone(&limits.elf_parses).try_acquire_owned().unwrap();
        let second = Arc::clone(&limits.elf_parses).try_acquire_owned().unwrap();
        assert!(Arc::clone(&limits.elf_parses).try_acquire_owned().is_err());
        drop(second);
        assert!(Arc::clone(&limits.elf_parses).try_acquire_owned().is_ok());
    }

    #[test]
    fn diagnostic_errors_never_echo_untrusted_private_details() {
        let sensitive = [
            r"C:\Users\operator\secret.a2l",
            "/home/operator/private/ecu.elf",
            "Authorization: Bearer super-secret-token",
            "ECU-VIN-123456789",
        ];
        for secret in sensitive {
            let message = safe_internal_error();
            assert!(!message.contains(secret));
            assert!(!message.contains("Bearer"));
        }
    }
}

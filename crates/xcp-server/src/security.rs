//! Loopback HTTP and WebSocket request guard.
//!
//! This is defense in depth against browser-origin CSRF, cross-site WebSocket
//! hijacking and DNS rebinding. It is not user authentication and does not
//! make the local ECU control API suitable for network exposure.

use axum::{
    extract::Request,
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use crate::api::v1::error;

const ACCEPTED_ORIGINS: &[&str] = &[
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://127.0.0.1:5173",
    "https://localhost:5173",
];

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
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or("missing or invalid Host header")?;
    if !valid_loopback_host(host) {
        return Err("only loopback Host headers are accepted");
    }

    if let Some(origin) = headers.get(header::ORIGIN) {
        let origin = origin.to_str().map_err(|_| "invalid Origin header")?;
        if !ACCEPTED_ORIGINS.contains(&origin) {
            return Err("origin is not authorized for the local XCP Studio API");
        }
    }

    if headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        == Some("cross-site")
    {
        return Err("cross-site browser requests are not permitted");
    }

    Ok(())
}

/// Apply to all HTTP routes, including WebSocket upgrades. CLI clients are
/// allowed without Origin only when their Host header is a loopback host.
pub async fn local_api_guard(request: Request, next: Next) -> Response {
    match validate(request.headers()) {
        Ok(()) => next.run(request).await,
        Err(message) => error(StatusCode::FORBIDDEN, "LOCAL_ORIGIN_FORBIDDEN", message, false)
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
    fn rejects_cross_site_origin_and_dns_rebinding_hosts() {
        for host in ["evil.example:8080", "localhost.evil.example:8080", "127.0.0.2:8080",
                     "localhost:bad", "localhost:0", "localhost:65536"] {
            assert!(validate(&headers(host, None)).is_err(), "{host}");
        }
        for origin in ["https://evil.example", "null", "http://localhost.evil.example:5173",
                       "http://localhost:5174", "http://localhost:5173/evil"] {
            assert!(validate(&headers("localhost:8080", Some(origin))).is_err(), "{origin}");
        }
        assert!(validate(&HeaderMap::new()).is_err());
    }

    #[test]
    fn rejects_browser_cross_site_fetch_without_origin() {
        let mut headers = headers("127.0.0.1:8080", None);
        headers.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(validate(&headers).is_err());
    }
}

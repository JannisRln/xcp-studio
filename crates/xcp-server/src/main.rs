use axum::{extract::DefaultBodyLimit, http::StatusCode, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/elf/inspect", post(inspect_elf))
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    println!("XCP Studio API: http://127.0.0.1:8080/api/health");
    axum::serve(listener, app).await?;
    Ok(())
}

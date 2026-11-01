//! Reported timings are observed in a native window; they are not an ECU rate.
//! CPU UI construction and inter-frame pacing do not include a GPU-present timestamp.

use serde_json::{json, Value};
use std::time::{Duration, Instant};

const ITERATIONS: usize = 80;

#[derive(Debug)]
pub struct BenchRun {
    pub size: usize,
    pub started: Instant,
    last_frame: Option<Instant>,
    update_ms: Vec<f64>,
    prior_frame_render_cpu_ms: Vec<f64>,
    intervals_ms: Vec<f64>,
    click_to_next_update_ms: Vec<f64>,
    queued_probe: Option<Instant>,
}

impl BenchRun {
    pub fn new(size: usize) -> Self {
        Self {
            size,
            started: Instant::now(),
            last_frame: None,
            update_ms: Vec::with_capacity(ITERATIONS),
            prior_frame_render_cpu_ms: Vec::with_capacity(ITERATIONS),
            intervals_ms: Vec::with_capacity(ITERATIONS),
            click_to_next_update_ms: Vec::new(),
            queued_probe: None,
        }
    }

    pub fn record_click(&mut self) {
        self.queued_probe = Some(Instant::now());
    }

    pub fn step(&mut self, frame_start: Instant, cpu_update: Duration, prior_eframe_cpu_seconds: Option<f32>) -> bool {
        if let Some(last) = self.last_frame {
            self.intervals_ms
                .push(frame_start.duration_since(last).as_secs_f64() * 1_000.0);
        }
        self.last_frame = Some(frame_start);
        if let Some(clicked) = self.queued_probe {
            if frame_start >= clicked {
                self.click_to_next_update_ms
                    .push(frame_start.duration_since(clicked).as_secs_f64() * 1_000.0);
                self.queued_probe = None;
            }
        }
        if let Some(seconds) = prior_eframe_cpu_seconds.filter(|s| s.is_finite() && *s >= 0.0) {
            self.prior_frame_render_cpu_ms.push(f64::from(seconds) * 1_000.0);
        }
        self.update_ms.push(cpu_update.as_secs_f64() * 1_000.0);
        self.update_ms.len() >= ITERATIONS
    }

    pub fn updates(&self) -> usize {
        self.update_ms.len()
    }

    pub fn report(&self) -> Value {
        let elapsed = self.started.elapsed().as_secs_f64();
        json!({
            "source": "native eframe/egui synthetic benchmark; NOT ECU measurements",
            "framesPerUpdate": self.size,
            "series": 2,
            "updates": self.updates(),
            "windowMs": 15000,
            "drawPointLimitPerLane": 1400,
            "elapsedSeconds": elapsed,
            "completedUpdatesHz": self.updates() as f64 / elapsed,
            "observedFramePacingFps": if self.intervals_ms.is_empty() {
                Value::Null
            } else {
                json!(1000.0 / (self.intervals_ms.iter().sum::<f64>()
                    / self.intervals_ms.len() as f64))
            },
            "cpuUiUpdateMs": percentiles(&self.update_ms),
            "previousFrameCpuIncludingRenderingMs": percentiles(&self.prior_frame_render_cpu_ms),
            "frameIntervalMs": percentiles(&self.intervals_ms),
            "clickToNextUpdateProxyMs": percentiles(&self.click_to_next_update_ms),
            "renderingLimitation": "App::ui timing excludes GPU work; eframe previous-frame CPU usage includes rendering CPU but excludes vsync wait and GPU present. OS input timestamp is NOT instrumented. FPS is frame pacing, not GPU completion. Do not compare these fields directly to browser update-to-second-rAF or ECU throughput."
        })
    }
}

pub fn percentiles(values: &[f64]) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let at = |p: f64| sorted[((sorted.len() - 1) as f64 * p).floor() as usize];
    json!({"p50": at(0.50), "p95": at(0.95), "p99": at(0.99),
        "max": sorted[sorted.len() - 1]})
}

/// Disk and OS-process sampling run on a worker, never in eframe::App::update.
pub fn save_report_async(size: usize, mut report: Value) {
    std::thread::spawn(move || {
        let mut system = sysinfo::System::new_all();
        system.refresh_all();
        let rss = system
            .process(sysinfo::Pid::from_u32(std::process::id()))
            .map(|p| p.memory());
        report["processResidentBytesAfterRun"] = json!(rss);
        report["memoryLimitation"] = json!(
            "Resident process memory is sampled after the trial, not peak GPU/VRAM usage. \
             Browser benchmark reports JS heap, which is not the same metric."
        );
        report["environment"] = json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "desktopVersion": env!("CARGO_PKG_VERSION"),
        });
        let path = format!("xcp-native-benchmark-{size}.json");
        if let Ok(serialized) = serde_json::to_string_pretty(&report) {
            if let Err(error) = std::fs::write(&path, serialized) {
                eprintln!("Unable to write {path}: {error}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_nearest_rank_matches_browser_harness() {
        let values: Vec<f64> = (0..101).map(f64::from).collect();
        assert_eq!(percentiles(&values)["p50"], 50.0);
        assert_eq!(percentiles(&values)["p95"], 95.0);
        assert_eq!(percentiles(&values)["p99"], 99.0);
        assert!(percentiles(&[]).is_null());
    }

    #[test]
    fn completes_at_80_recorded_ui_updates() {
        let mut run = BenchRun::new(2_000);
        for i in 0..80 {
            assert_eq!(run.step(Instant::now(), Duration::from_millis(2), Some(0.003)), i == 79);
        }
        assert_eq!(run.report()["updates"], 80);
        assert_eq!(run.report()["series"], 2);
    }
}

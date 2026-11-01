//! Native, sandboxed visualization spike. XCP transport and calibration remain
//! exclusively owned by the existing backend process.

mod benchmark;
mod bridge;
mod fixture;

use benchmark::{save_report_async, BenchRun};
use bridge::BridgeEvent;
use eframe::egui::{self, Color32, RichText};
use egui_dock::{DockArea, DockState, NodeIndex, TabViewer};
use egui_plot::{Legend, Line, Plot, PlotPoints, VLine};
use fixture::{
    advance_fixture, chart_segments, nearest_value, synthetic_frames, SampleFrame, ORIGIN_MS,
    PLOT_LIMIT,
};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::mpsc::TryRecvError;
use std::time::{Duration, Instant};
use std::{path::PathBuf, sync::Arc};

const MAX_LIVE_FRAMES: usize = 20_000;
const REPAINT_DELAY: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
enum Pane {
    Speed,
    Temperature,
    Signals,
    Status,
    Benchmark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Source {
    Synthetic,
    BackendSubscriber,
}

struct DesktopApp {
    dock: DockState<Pane>,
    frames: VecDeque<SampleFrame>,
    source: Source,
    receiver: Option<bridge::Subscription>,
    signal_names: [String; 2],
    visible: [bool; 2],
    cursors: [Option<u64>; 2],
    next_cursor: usize,
    last_sequence: Option<u64>,
    pending_gap: bool,
    subscriber_gaps: u64,
    latest_receipt: Option<Instant>,
    stream_status: String,
    next_synthetic_index: usize,
    synthetic_gap_next: bool,
    benchmark: Option<BenchRun>,
    reports: Vec<Value>,
    benchmark_completed: bool,
    screenshot_path: Option<PathBuf>,
    screenshot_requested: bool,
    screenshot_ui_frames: u64,
}

impl DesktopApp {
    fn new(cc: &eframe::CreationContext<'_>, acquisition_id: Option<String>, auto_bench: bool, screenshot_path: Option<PathBuf>) -> Self {
        cc.egui_ctx.set_visuals(egui::Visuals::dark());

        // Both independent plot lanes are visible at startup. Every pane can be
        // dragged, resized, tabbed, or detached by egui_dock.
        let mut dock = DockState::new(vec![Pane::Speed]);
        let [left, right] =
            dock.main_surface_mut().split_right(NodeIndex::root(), 0.52, vec![Pane::Temperature]);
        dock.main_surface_mut()
            .split_below(left, 0.68, vec![Pane::Signals, Pane::Benchmark]);
        dock.main_surface_mut()
            .split_below(right, 0.68, vec![Pane::Status]);

        let (receiver, source, status) = match acquisition_id {
            Some(id) => match bridge::subscribe(id.clone()) {
                Ok(rx) => (Some(rx), Source::BackendSubscriber,
                    format!("WAITING - subscribing to existing {id} (read-only)")),
                Err(error) => (None, Source::BackendSubscriber, format!("ERROR - {error}")),
            },
            None => (None, Source::Synthetic,
                "SYNTHETIC FIXTURE - no ECU session, no hardware".to_owned()),
        };
        let active_bench = auto_bench && source == Source::Synthetic;
        Self {
            dock,
            frames: if source == Source::Synthetic {
                synthetic_frames(2_000)
            } else {
                VecDeque::new()
            },
            source,
            receiver,
            signal_names: if source == Source::Synthetic {
                ["Fixture RPM".into(), "Fixture °C".into()]
            } else {
                ["Acquisition signal A (raw)".into(), "Acquisition signal B (raw)".into()]
            },
            visible: [true, true],
            cursors: [None, None],
            next_cursor: 0,
            last_sequence: None,
            pending_gap: false,
            subscriber_gaps: 0,
            latest_receipt: None,
            stream_status: status,
            next_synthetic_index: 2_000,
            synthetic_gap_next: false,
            benchmark: active_bench.then(|| BenchRun::new(2_000)),
            reports: Vec::new(),
            benchmark_completed: false,
            screenshot_path,
            screenshot_requested: false,
            screenshot_ui_frames: 0,
        }
    }

    fn reset_synthetic(&mut self, count: usize) {
        self.source = Source::Synthetic;
        // Never reconnect or start any ECU service from a synthetic trial.
        self.receiver = None;
        self.frames = synthetic_frames(count);
        self.signal_names = ["Fixture RPM".into(), "Fixture °C".into()];
        self.visible = [true, true];
        self.cursors = [None, None];
        self.next_synthetic_index = count;
        self.stream_status = "SYNTHETIC FIXTURE - not an ECU measurement".into();
        self.last_sequence = None;
        self.subscriber_gaps = 0;
        self.pending_gap = false;
        self.latest_receipt = None;
    }

    fn start_benchmark(&mut self) {
        self.reports.clear();
        self.benchmark_completed = false;
        self.reset_synthetic(2_000);
        self.benchmark = Some(BenchRun::new(2_000));
    }

    fn poll_backend(&mut self) {
        if self.source != Source::BackendSubscriber {
            return;
        }
        let Some(receiver) = self.receiver.as_ref() else {
            return;
        };
        // Bound the work in any single UI pass even if the producer is faster.
        for _ in 0..128 {
            match receiver.events.try_recv() {
                Ok(BridgeEvent::Frame(mut frame, names)) => {
                    if self.last_sequence.is_some_and(|seq| frame.sequence <= seq) {
                        self.pending_gap = true;
                        self.subscriber_gaps = self.subscriber_gaps.saturating_add(1);
                        continue;
                    }
                    let skipped = self.last_sequence.is_some_and(|seq| {
                        frame.sequence != seq.saturating_add(1)
                    });
                    let clock_regressed = self.frames.back().is_some_and(|last| {
                        frame.timestamp_ms < last.timestamp_ms
                    });
                    frame.gap_before = self.pending_gap || skipped || clock_regressed;
                    if skipped || clock_regressed {
                        self.subscriber_gaps = self.subscriber_gaps.saturating_add(1);
                    }
                    self.pending_gap = false;
                    self.last_sequence = Some(frame.sequence);
                    self.signal_names = names;
                    self.latest_receipt = Some(Instant::now());
                    self.stream_status = "LIVE - backend-owned acquisition subscriber".into();
                    if self.frames.len() == MAX_LIVE_FRAMES {
                        self.frames.pop_front();
                    }
                    self.frames.push_back(frame);
                }
                Ok(BridgeEvent::Gap(dropped)) => {
                    self.pending_gap = true;
                    self.subscriber_gaps = self.subscriber_gaps.saturating_add(dropped);
                    self.stream_status =
                        format!("GAP - {dropped} lost subscriber events (not ECU DAQ loss)");
                }
                Ok(BridgeEvent::Status(status)) => {
                    self.pending_gap = true;
                    self.stream_status = format!("STOPPED - backend acquisition: {status}");
                }
                Ok(BridgeEvent::Error(error)) => {
                    self.pending_gap = true;
                    self.stream_status = format!("ERROR - {error}");
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.receiver = None;
                    if !self.stream_status.starts_with("STOPPED") {
                        self.stream_status = "DISCONNECTED - read-only subscriber ended".into();
                    }
                    break;
                }
            }
        }
    }

    fn source_status(&self) -> String {
        if self.source == Source::Synthetic {
            return "SYNTHETIC - NOT ECU DATA".into();
        }
        if self.stream_status.starts_with("LIVE")
            && self.latest_receipt.is_some_and(|t| t.elapsed() > Duration::from_secs(2))
        {
            return "STALE - no new backend samples for >2s".into();
        }
        self.stream_status.clone()
    }

    fn toolbar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal_wrapped(|ui| {
            ui.heading("XCP Studio / Native measurement lab");
            ui.separator();
            let status_color = if self.source == Source::Synthetic {
                Color32::from_rgb(247, 198, 126)
            } else if self.source_status().starts_with("LIVE") {
                Color32::from_rgb(112, 236, 189)
            } else {
                Color32::from_rgb(247, 198, 126)
            };
            ui.colored_label(status_color, self.source_status());
        });
        ui.horizontal_wrapped(|ui| {
            ui.label(format!("{} frames", self.frames.len()));
            ui.separator();
            ui.label("Host timestamp; never hardware-synchronized");
            ui.separator();
            if self.source == Source::Synthetic {
                if ui.button("2,000 synthetic frames").clicked() {
                    self.reset_synthetic(2_000);
                    self.benchmark = None;
                }
                if ui.button("20,000 synthetic frames").clicked() {
                    self.reset_synthetic(20_000);
                    self.benchmark = None;
                }
                if ui.button("Insert synthetic gap").clicked() && self.benchmark.is_none() {
                    self.synthetic_gap_next = true;
                    advance_fixture(&mut self.frames, self.next_synthetic_index);
                    self.next_synthetic_index += 1;
                    if let Some(last) = self.frames.back_mut() {
                        last.gap_before = true;
                    }
                    self.synthetic_gap_next = false;
                }
                if ui.button("Benchmark 2k → 20k (80 updates each)").clicked() {
                    self.start_benchmark();
                }
            }
            if let Some(bench) = self.benchmark.as_mut() {
                if ui.button("Probe UI response").clicked() {
                    bench.record_click();
                }
                ui.label(format!("Trial: {} frames · {}/80", bench.size, bench.updates()));
            }
        });
        ui.separator();
    }
}

struct Panels<'a> {
    frames: &'a VecDeque<SampleFrame>,
    signal_names: &'a [String; 2],
    visible: &'a mut [bool; 2],
    cursors: &'a mut [Option<u64>; 2],
    next_cursor: &'a mut usize,
    source: Source,
    status: &'a str,
    subscriber_gaps: u64,
    reports: &'a [Value],
    completed: bool,
    bench_active: bool,
}

impl Panels<'_> {
    fn chart(&mut self, ui: &mut egui::Ui, channel: usize) {
        let color = if channel == 0 {
            Color32::from_rgb(112, 236, 189)
        } else {
            Color32::from_rgb(247, 198, 126)
        };
        let unit = if self.source == Source::Synthetic {
            if channel == 0 { "rpm" } else { "°C" }
        } else {
            "raw - unconverted"
        };
        ui.horizontal(|ui| {
            ui.checkbox(&mut self.visible[channel], &self.signal_names[channel]);
            ui.label(RichText::new(unit).color(color));
            ui.label("Wheel: zoom · Drag: pan · click: place A/B");
        });
        if !self.visible[channel] {
            ui.label("Signal hidden in this lane");
            return;
        }

        let segments = chart_segments(self.frames, channel, PLOT_LIMIT);
        let gaps: Vec<f64> = self.frames
            .iter()
            .rev()
            .filter(|f| f.gap_before)
            .take(32)
            .map(|f| f.timestamp_ms as f64 - ORIGIN_MS as f64)
            .collect();
        let label = self.signal_names[channel].clone();
        let height = (ui.available_height() - 72.0).max(160.0);
        Plot::new(format!("measurement-lane-{channel}"))
            .height(height)
            .legend(Legend::default())
            .x_axis_label("Host millisecond offset (not ECU-synchronized)")
            .y_axis_label(unit)
            .allow_zoom(true)
            .allow_drag(true)
            .allow_scroll(true)
            .allow_double_click_reset(true)
            .show(ui, |plot_ui| {
                for (i, segment) in segments.into_iter().enumerate() {
                    plot_ui.line(
                        Line::new(format!("{label} segment {i}"), PlotPoints::from(segment))
                            .name(label.clone())
                            .color(color)
                            .width(1.5),
                    );
                }
                for (i, x) in gaps.iter().enumerate() {
                    plot_ui.vline(
                        VLine::new(format!("subscriber/display gap {i}"), *x)
                            .color(Color32::from_rgb(249, 145, 81))
                            .width(1.0),
                    );
                }
                for (i, time) in self.cursors.iter().enumerate() {
                    if let Some(time) = time {
                        plot_ui.vline(
                            VLine::new(if i == 0 { "Cursor A" } else { "Cursor B" },
                                *time as f64 - ORIGIN_MS as f64)
                                .color(if i == 0 { Color32::YELLOW } else { Color32::LIGHT_BLUE })
                                .width(2.0),
                        );
                    }
                }
                if plot_ui.response().clicked() {
                    if let Some(pointer) = plot_ui.pointer_coordinate() {
                        let x = pointer.x + ORIGIN_MS as f64;
                        if x.is_finite() && x >= 0.0 {
                            let target = x as u64;
                            if let Some(closest) = self.frames.iter().min_by_key(|frame| {
                                frame.timestamp_ms.abs_diff(target)
                            }) {
                                self.cursors[*self.next_cursor] = Some(closest.timestamp_ms);
                                *self.next_cursor = 1 - *self.next_cursor;
                            }
                        }
                    }
                }
            });
        self.cursor_summary(ui, channel);
    }

    fn cursor_summary(&self, ui: &mut egui::Ui, channel: usize) {
        ui.horizontal_wrapped(|ui| {
            ui.label(format!("Next cursor: {}", if *self.next_cursor == 0 { "A" } else { "B" }));
            let [a, b] = *self.cursors;
            if let Some(a) = a {
                ui.label(format!("A: {a} ms / {:?}", nearest_value(self.frames, a, channel)));
            }
            if let Some(b) = b {
                ui.label(format!("B: {b} ms / {:?}", nearest_value(self.frames, b, channel)));
            }
            if let (Some(a), Some(b)) = (a, b) {
                let dt = a.abs_diff(b);
                let va = nearest_value(self.frames, a, channel);
                let vb = nearest_value(self.frames, b, channel);
                ui.label(format!("|Δt|: {dt} ms; ΔY: {:?}; Hz: {}",
                    va.zip(vb).map(|(x, y)| y - x),
                    if dt == 0 { "n/a".to_owned() } else {
                        format!("{:.3}", 1000.0 / dt as f64)
                    }));
            }
        });
    }

    fn signal_table(&mut self, ui: &mut egui::Ui) {
        ui.heading("Signal legend & latest values");
        ui.label("Raw snapshots only. No unverified physical conversion or ECU quality guarantee.");
        egui::Grid::new("signal-table").striped(true).show(ui, |ui| {
            ui.strong("Show");
            ui.strong("Signal");
            ui.strong("Last value");
            ui.strong("Quality");
            ui.strong("Origin");
            ui.end_row();
            for i in 0..2 {
                ui.checkbox(&mut self.visible[i], "");
                ui.label(&self.signal_names[i]);
                ui.label(match self.frames.back().and_then(|f| f.values[i]) {
                    Some(v) => format!("{v:.3}"),
                    None => "MISSING".into(),
                });
                let q = self.frames.back()
                    .map(|frame| frame.quality[i].label()).unwrap_or("WAITING");
                let color = if q == "VALID (decoded)" { Color32::LIGHT_GREEN }
                    else if q == "INVALID" || q == "MISSING" { Color32::LIGHT_RED }
                    else { Color32::YELLOW };
                ui.colored_label(color, q);
                ui.label(if self.source == Source::Synthetic { "synthetic" } else { "backend raw" });
                ui.end_row();
            }
        });
        ui.label(format!("Received frames in visualization: {}", self.frames.len()));
    }

    fn status_panel(&self, ui: &mut egui::Ui) {
        ui.heading("Acquisition & visualization status");
        ui.label(self.status);
        ui.label(format!("Subscriber/sequence gaps observed: {}", self.subscriber_gaps));
        ui.label(format!("Visible discontinuities: {}",
            self.frames.iter().filter(|f| f.gap_before).count()));
        ui.label("Gap events represent subscriber/UI loss, not proven ECU loss.");
        ui.label("Native viewer is read-only; connection and sampling remain owned by xcp-server.");
        ui.label("Samples are timestamped after sequential backend reads, not ECU-synchronized.");
        if self.source == Source::Synthetic {
            ui.colored_label(Color32::YELLOW, "SYNTHETIC BENCHMARK DATA - NO ECU");
        }
    }

    fn benchmark_panel(&self, ui: &mut egui::Ui) {
        ui.heading("Reproducible UI benchmark");
        ui.label("2k / 20k frames · 2 synthetic series · 80 replacements per run");
        ui.label("CPU UI construction and frame pacing; GPU present NOT instrumented.");
        ui.label("JSON files are written asynchronously in the process working directory.");
        if self.bench_active {
            ui.spinner();
            ui.label("Trial running");
        }
        if self.completed {
            ui.label("Both trials sampled (native Windows evidence requires Windows execution)");
        }
        egui::ScrollArea::vertical().show(ui, |ui| {
            for report in self.reports {
                ui.monospace(
                    serde_json::to_string_pretty(report)
                        .unwrap_or_else(|_| "unable to format report".into()),
                );
            }
        });
    }
}

impl TabViewer for Panels<'_> {
    type Tab = Pane;

    fn id(&mut self, tab: &mut Pane) -> egui::Id {
        egui::Id::new(*tab)
    }

    fn title(&mut self, tab: &mut Pane) -> egui::WidgetText {
        match tab {
            Pane::Speed => "RPM / Chart A",
            Pane::Temperature => "Temperature / Chart B",
            Pane::Signals => "Signal legend",
            Pane::Status => "Status & gaps",
            Pane::Benchmark => "Performance",
        }
        .into()
    }

    fn ui(&mut self, ui: &mut egui::Ui, tab: &mut Pane) {
        match tab {
            Pane::Speed => self.chart(ui, 0),
            Pane::Temperature => self.chart(ui, 1),
            Pane::Signals => self.signal_table(ui),
            Pane::Status => self.status_panel(ui),
            Pane::Benchmark => self.benchmark_panel(ui),
        }
    }
}

impl eframe::App for DesktopApp {
    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        let frame_start = Instant::now();
        self.poll_backend();
        if let Some(run) = &self.benchmark {
            let size = run.size;
            if self.frames.len() == size {
                advance_fixture(&mut self.frames, self.next_synthetic_index);
                self.next_synthetic_index += 1;
            }
        }

        self.toolbar(ui);
        let status = self.source_status();
        let mut panels = Panels {
            frames: &self.frames,
            signal_names: &self.signal_names,
            visible: &mut self.visible,
            cursors: &mut self.cursors,
            next_cursor: &mut self.next_cursor,
            source: self.source,
            status: &status,
            subscriber_gaps: self.subscriber_gaps,
            reports: &self.reports,
            completed: self.benchmark_completed,
            bench_active: self.benchmark.is_some(),
        };
        DockArea::new(&mut self.dock)
            .show_close_buttons(false)
            .show_inside(ui, &mut panels);

        if let Some(mut run) = self.benchmark.take() {
            let finished = run.step(frame_start, frame_start.elapsed(), frame.info().cpu_usage);
            if finished {
                let size = run.size;
                let report = run.report();
                self.reports.push(report.clone());
                save_report_async(size, report);
                if size == 2_000 {
                    self.reset_synthetic(20_000);
                    self.benchmark = Some(BenchRun::new(20_000));
                } else {
                    self.benchmark_completed = true;
                }
            } else {
                self.benchmark = Some(run);
            }
        }
        // This captures pixels generated by the *running eframe renderer*.
        // A screenshot request cannot be satisfied by a mockup or generated plot.
        self.screenshot_ui_frames = self.screenshot_ui_frames.saturating_add(1);
        let returned_image = ui.input(|i| {
            i.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(Arc::clone(image)),
                _ => None,
            })
        });
        if let (Some(image), Some(path)) = (returned_image, self.screenshot_path.take()) {
            // PNG encoding and filesystem I/O never run on the GUI callback.
            std::thread::spawn(move || {
                let mut rgba = Vec::with_capacity(image.pixels.len() * 4);
                for pixel in &image.pixels {
                    rgba.extend_from_slice(&pixel.to_array());
                }
                if let Err(error) = image::save_buffer(
                    &path,
                    &rgba,
                    image.size[0] as u32,
                    image.size[1] as u32,
                    image::ColorType::Rgba8,
                ) {
                    eprintln!("Native renderer screenshot failed: {error}");
                }
            });
        }
        if self.screenshot_path.is_some()
            && !self.screenshot_requested
            && self.screenshot_ui_frames >= 5
            && (self.source == Source::Synthetic || !self.frames.is_empty())
            && (self.benchmark.is_none() || self.benchmark_completed)
        {
            ui.ctx().send_viewport_cmd(
                egui::ViewportCommand::Screenshot(egui::UserData::default()),
            );
            self.screenshot_requested = true;
        }
        ui.ctx().request_repaint_after(REPAINT_DELAY);
    }
}

fn main() -> eframe::Result {
    let mut acquisition_id = None;
    let mut auto_bench = false;
    let mut screenshot_path = None;
    for arg in std::env::args().skip(1) {
        if arg == "--benchmark" {
            auto_bench = true;
        } else if let Some(path) = arg.strip_prefix("--screenshot=") {
            screenshot_path = Some(PathBuf::from(path));
        } else if let Some(id) = arg.strip_prefix("--subscribe-acquisition=") {
            acquisition_id = Some(id.to_owned());
        } else {
            eprintln!("Unknown argument: {arg}");
            eprintln!("Usage: xcp-desktop [--benchmark] [--screenshot=FILE.png] [--subscribe-acquisition=acq-ID]");
            std::process::exit(2);
        }
    }
    eframe::run_native(
        "XCP Studio / Native Measurement Lab",
        eframe::NativeOptions::default(),
        Box::new(move |cc| Ok(Box::new(DesktopApp::new(cc, acquisition_id, auto_bench, screenshot_path)))),
    )
}

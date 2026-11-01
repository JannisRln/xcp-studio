//! Identical deterministic inputs to the React/uPlot benchmark on PR #53.
//! No fixture is sourced from or labeled as an ECU measurement.

use std::collections::VecDeque;

pub const ORIGIN_MS: u64 = 1_761_980_000_000;
pub const PLOT_LIMIT: usize = 1_400;
pub const WINDOW_MS: u64 = 15_000;

#[derive(Clone, Debug, PartialEq)]
pub struct SampleFrame {
    pub timestamp_ms: u64,
    pub sequence: u64,
    pub values: [Option<f64>; 2],
    pub gap_before: bool,
}

impl SampleFrame {
    pub fn synthetic(i: usize) -> Self {
        Self {
            timestamp_ms: ORIGIN_MS + i as u64,
            sequence: i as u64,
            values: [
                Some(if i.is_multiple_of(683) { 8000.0 } else { 1850.0 }),
                Some(88.5 + (i % 17) as f64 / 10.0),
            ],
            gap_before: false,
        }
    }
}

pub fn synthetic_frames(count: usize) -> VecDeque<SampleFrame> {
    (0..count).map(SampleFrame::synthetic).collect()
}

/// Exactly matches the browser benchmark's drop-first, append-new operation.
pub fn advance_fixture(frames: &mut VecDeque<SampleFrame>, next_index: usize) {
    if !frames.is_empty() {
        frames.pop_front();
        frames.push_back(SampleFrame::synthetic(next_index));
    }
}

/// Return a bounded set of points, preserving the first, last and each bucket's extrema.
/// This is independent for each signal and never crosses a missing value or reported gap.
fn decimate(segment: &[[f64; 2]], limit: usize) -> Vec<[f64; 2]> {
    if segment.len() <= limit {
        return segment.to_vec();
    }
    if limit < 4 {
        return vec![segment[0], segment[segment.len() - 1]];
    }
    let bucket_count = (limit - 2) / 2;
    let inner = segment.len() - 2;
    let bucket_size = inner.div_ceil(bucket_count);
    let mut points = Vec::with_capacity(limit);
    points.push(segment[0]);
    for chunk in segment[1..segment.len() - 1].chunks(bucket_size) {
        let mut lo = 0;
        let mut hi = 0;
        for (index, point) in chunk.iter().enumerate() {
            if point[1] < chunk[lo][1] {
                lo = index;
            }
            if point[1] > chunk[hi][1] {
                hi = index;
            }
        }
        if lo <= hi {
            points.push(chunk[lo]);
            if lo != hi {
                points.push(chunk[hi]);
            }
        } else {
            points.push(chunk[hi]);
            points.push(chunk[lo]);
        }
    }
    points.push(segment[segment.len() - 1]);
    points
}

/// A separate polyline is emitted on either side of every missing sample or gap.
/// No "zero" measurement, interpolated point, or synthetic gap value is inserted.
pub fn chart_segments(
    frames: &VecDeque<SampleFrame>,
    channel: usize,
    max_points: usize,
) -> Vec<Vec<[f64; 2]>> {
    assert!(channel < 2);
    assert!(max_points >= 4);
    let last = frames.back().map(|f| f.timestamp_ms).unwrap_or(0);
    let first = last.saturating_sub(WINDOW_MS);
    let mut raw: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut current = Vec::new();
    for frame in frames.iter().filter(|f| f.timestamp_ms >= first) {
        if frame.gap_before && !current.is_empty() {
            raw.push(std::mem::take(&mut current));
        }
        match frame.values[channel].filter(|v| v.is_finite()) {
            Some(v) => current.push([frame.timestamp_ms as f64 - ORIGIN_MS as f64, v]),
            None => {
                if !current.is_empty() {
                    raw.push(std::mem::take(&mut current));
                }
            }
        }
    }
    if !current.is_empty() {
        raw.push(current);
    }
    // Prioritize newest segments when a faulty stream contains thousands of gaps.
    let visible = raw.len().min(max_points / 2);
    let budget = (max_points / visible.max(1)).max(2);
    let start = raw.len().saturating_sub(visible);
    raw.into_iter()
        .skip(start)
        .map(|segment| decimate(&segment, budget))
        .collect()
}

pub fn nearest_value(
    frames: &VecDeque<SampleFrame>,
    timestamp_ms: u64,
    channel: usize,
) -> Option<f64> {
    frames.iter()
        .filter(|f| !f.gap_before && f.values[channel].is_some())
        .min_by_key(|f| f.timestamp_ms.abs_diff(timestamp_ms))
        .and_then(|f| f.values[channel])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_2000_and_20000_frame_input_as_react() {
        for size in [2_000, 20_000] {
            let mut rows = synthetic_frames(size);
            assert_eq!(rows.len(), size);
            assert_eq!(rows[0].timestamp_ms, ORIGIN_MS);
            assert_eq!(rows[0].values, [Some(8000.0), Some(88.5)]);
            assert_eq!(rows[683].values[0], Some(8000.0));
            assert_eq!(rows[16].values[1], Some(90.1));
            assert_eq!(rows[size - 1].sequence, size as u64 - 1);
            advance_fixture(&mut rows, size);
            assert_eq!(rows.len(), size);
            assert_eq!(rows[0].sequence, 1);
            assert_eq!(rows.back().unwrap().sequence, size as u64);
        }
    }

    #[test]
    fn preserves_spike_under_decimation_and_bounded_output() {
        let frames = synthetic_frames(20_000);
        let lines = chart_segments(&frames, 0, PLOT_LIMIT);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].len() <= PLOT_LIMIT);
        assert!(lines[0].iter().any(|p| p[1] == 8000.0));
    }

    #[test]
    fn gaps_and_missing_values_never_connect() {
        let mut rows = synthetic_frames(40);
        rows[8].gap_before = true;
        rows[15].values[0] = None;
        rows[22].values[0] = Some(f64::NAN);
        let segments = chart_segments(&rows, 0, PLOT_LIMIT);
        assert_eq!(segments.len(), 4);
        assert_eq!(segments[0].last().unwrap()[0], 7.0);
        assert_eq!(segments[1].first().unwrap()[0], 8.0);
        assert_eq!(segments[1].last().unwrap()[0], 14.0);
        assert_eq!(segments[2].first().unwrap()[0], 16.0);
        assert_eq!(segments[3].first().unwrap()[0], 23.0);
    }

    #[test]
    fn empty_input_is_safe() {
        assert!(chart_segments(&VecDeque::new(), 1, 1_400).is_empty());
    }
}

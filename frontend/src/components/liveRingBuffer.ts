import type { MeasurementFrame, SignalDefinition } from "../core/api";

/**
 * Fixed-capacity, typed-array sample storage. Frames are written once and
 * never copied during rendering; each signal has a contiguous Float64Array.
 * The X axis uses backend monotonic elapsed time when available, otherwise
 * host timestamps (which are not guaranteed to be monotonic).
 */
export class LiveRingBuffer {
  readonly capacity: number;
  readonly time: Float64Array;
  private readonly values = new Map<string, Float64Array>();
  private start = 0;
  private lengthValue = 0;
  private previousTime = -Infinity;

  constructor(capacity = 32768) {
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 1_000_000)
      throw new Error("Invalid live buffer capacity");
    this.capacity = capacity;
    this.time = new Float64Array(capacity);
  }

  get length(): number { return this.lengthValue; }
  get newest(): number { return this.length ? this.time[this.index(this.length - 1)] : 0; }
  get oldest(): number { return this.length ? this.time[this.start] : 0; }
  get signalIds(): string[] { return [...this.values.keys()]; }

  reset(): void {
    this.start = 0;
    this.lengthValue = 0;
    this.previousTime = -Infinity;
    this.values.clear();
  }

  private index(logical: number): number {
    return (this.start + logical) % this.capacity;
  }

  /** Signal identity is stable across React remounts and acquisitions. */
  static key(signal: Pick<SignalDefinition, "name" | "address">): string {
    return `${signal.name}\u0000${signal.address}`;
  }

  append(frame: MeasurementFrame, signals: readonly SignalDefinition[]): boolean {
    const timestamp = frame.monotonic_elapsed_ms ?? frame.timestamp_ms;
    if (!Number.isFinite(timestamp) || timestamp <= this.previousTime) return false;
    const physical = this.lengthValue < this.capacity
      ? this.index(this.lengthValue)
      : this.start;
    if (this.lengthValue === this.capacity) this.start = this.index(1);
    else this.lengthValue++;
    this.time[physical] = timestamp;
    this.previousTime = timestamp;

    for (const signal of signals) {
      const key = LiveRingBuffer.key(signal);
      let data = this.values.get(key);
      if (!data) {
        data = new Float64Array(this.capacity);
        data.fill(Number.NaN);
        this.values.set(key, data);
      }
      const sample = frame.samples.find(item =>
        item.name === signal.name && item.address === signal.address);
      data[physical] = sample && Number.isFinite(sample.value)
        ? sample.value : Number.NaN;
    }
    return true;
  }

  at(index: number, key: string): { t: number; y: number } | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.lengthValue) return null;
    const data = this.values.get(key);
    if (!data) return null;
    const physical = this.index(index);
    return { t: this.time[physical], y: data[physical] };
  }

  lowerBound(time: number): number {
    let low = 0, high = this.lengthValue;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.time[this.index(middle)] < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  nearest(time: number): number {
    if (!this.length) return -1;
    const upper = this.lowerBound(time);
    if (upper <= 0) return 0;
    if (upper >= this.length) return this.length - 1;
    return Math.abs(this.time[this.index(upper)] - time) <
      Math.abs(this.time[this.index(upper - 1)] - time) ? upper : upper - 1;
  }

  /**
   * Pixel-bucket min/max downsampling. At most two extrema per pixel column,
   * in time order. Peaks are preserved even when thousands of points share a
   * pixel; work is linear in the visible range and memory bounded by width.
   */
  extrema(key: string, from: number, to: number, pixelWidth: number):
    Array<{ t: number; y: number }> {
    if (!this.length || !Number.isFinite(from) || !Number.isFinite(to) ||
        to <= from || !Number.isFinite(pixelWidth)) return [];
    const width = Math.max(1, Math.min(8192, Math.floor(pixelWidth)));
    const data = this.values.get(key);
    if (!data) return [];
    const output: Array<{ t: number; y: number }> = [];
    let cursor = this.lowerBound(from);
    let bucket = -1;
    let minimum = -1, maximum = -1;
    const flush = () => {
      if (minimum < 0) return;
      const first = Math.min(minimum, maximum);
      const last = Math.max(minimum, maximum);
      output.push({ t: this.time[this.index(first)], y: data[this.index(first)] });
      if (first !== last)
        output.push({ t: this.time[this.index(last)], y: data[this.index(last)] });
    };
    while (cursor < this.length) {
      const physical = this.index(cursor);
      const t = this.time[physical];
      if (t > to) break;
      const column = Math.min(width - 1, Math.max(0,
        Math.floor((t - from) / (to - from) * width)));
      if (column !== bucket) {
        flush();
        bucket = column;
        minimum = -1;
        maximum = -1;
      }
      if (Number.isFinite(data[physical])) {
        if (minimum < 0 || data[physical] < data[this.index(minimum)]) minimum = cursor;
        if (maximum < 0 || data[physical] > data[this.index(maximum)]) maximum = cursor;
      }
      cursor++;
    }
    flush();
    return output;
  }

  extent(keys: readonly string[], from: number, to: number): { low: number; high: number } {
    let low = Infinity, high = -Infinity;
    const begin = this.lowerBound(from);
    for (let i = begin; i < this.length; i++) {
      const physical = this.index(i);
      if (this.time[physical] > to) break;
      for (const key of keys) {
        const value = this.values.get(key)?.[physical];
        if (value !== undefined && Number.isFinite(value)) {
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
      }
    }
    if (!Number.isFinite(low)) return { low: 0, high: 1 };
    const margin = low === high ? Math.max(1, Math.abs(low) * 0.05) : (high - low) * 0.08;
    return { low: low - margin, high: high + margin };
  }
}

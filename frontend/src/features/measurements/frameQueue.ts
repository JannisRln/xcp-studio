import type { MeasurementFrame } from "../../core/api";

/** A bounded O(1) append queue between WebSocket delivery and React updates. */
export class PreviewFrameQueue {
  private readonly buffer: (MeasurementFrame | undefined)[];
  readonly capacity: number;
  private head = 0;
  private count = 0;

  constructor(capacity = 2000) {
    this.capacity = capacity;
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Preview queue capacity must be a positive integer");
    this.buffer = new Array<MeasurementFrame | undefined>(capacity);
  }

  get length(): number { return this.count; }

  push(frame: MeasurementFrame): void {
    this.buffer[(this.head + this.count) % this.capacity] = frame;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
  }

  drain(): MeasurementFrame[] {
    const result: MeasurementFrame[] = [];
    for (let index = 0; index < this.count; index++) {
      const slot = (this.head + index) % this.capacity;
      result.push(this.buffer[slot]!);
      this.buffer[slot] = undefined;
    }
    this.head = 0;
    this.count = 0;
    return result;
  }

  clear(): void {
    for (let index = 0; index < this.count; index++)
      this.buffer[(this.head + index) % this.capacity] = undefined;
    this.head = 0;
    this.count = 0;
  }
}

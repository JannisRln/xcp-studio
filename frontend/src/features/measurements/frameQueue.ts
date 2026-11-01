import type { MeasurementFrame } from "../../core/api";

/** Keep the pending UI batch bounded even when stream delivery outruns rendering. */
export function enqueuePreviewFrame(
  pending: MeasurementFrame[], frame: MeasurementFrame, capacity = 2000,
): void {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new Error("Preview queue capacity must be a positive integer");
  pending.push(frame);
  if (pending.length > capacity) pending.splice(0, pending.length - capacity);
}

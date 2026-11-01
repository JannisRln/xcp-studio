import type { MeasurementSample } from "../../core/api";
import type { AcquisitionState } from "./useAcquisition";
import type { LiveIndicator } from "./liveTelemetry";

export type QualitySample = MeasurementSample & {
  quality?: "valid";
  address_origin?: "manual";
};

/**
 * Browser delivery freshness and backend read quality are independent.
 * Older v1 senders omit quality; never promote an absent flag to valid.
 */
export function sampleQuality(
  connected: boolean,
  transportState: AcquisitionState,
  indicator: LiveIndicator,
  sample: QualitySample | undefined,
): "DISCONNECTED" | "INTERRUPTED" | "STALE" | "MISSING" | "VALID READ" | "UNVERIFIED" {
  if (!connected || indicator === "disconnected") return "DISCONNECTED";
  if (transportState === "error" || indicator === "error") return "INTERRUPTED";
  if (indicator === "stale") return "STALE";
  if (!sample || !Number.isFinite(sample.value)) return "MISSING";
  if (indicator !== "live") return "STALE";
  return sample.quality === "valid" ? "VALID READ" : "UNVERIFIED";
}

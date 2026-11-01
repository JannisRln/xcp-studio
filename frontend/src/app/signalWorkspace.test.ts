import { describe, expect, it } from "vitest";
import {
  addWorkspaceSignal, initialSignalWorkspace, removeWorkspaceSignal, toggleWorkspaceSignal,
} from "./signalWorkspace";

describe("workspace signal selection", () => {
  it("starts with the known simulator signals selected", () => {
    const state = initialSignalWorkspace();
    expect(state.selectedIds).toEqual(state.signals.map(signal => signal.id));
  });

  it("remembers deselected signals while adding new ones", () => {
    const state = initialSignalWorkspace();
    const deselected = toggleWorkspaceSignal(state, state.selectedIds[0]);
    const expanded = addWorkspaceSignal(deselected, "Battery voltage", 4104, "f32");
    expect(expanded.selectedIds).not.toContain(state.selectedIds[0]);
    expect(expanded.selectedIds).toContain("Battery voltage@1008");
  });

  it("does not select duplicates or nonexistent IDs", () => {
    const state = initialSignalWorkspace();
    const duplicate = addWorkspaceSignal(state, "Engine speed", 4096, "u32");
    expect(duplicate).toBe(state);
    expect(toggleWorkspaceSignal(state, "unknown")).toBe(state);
  });

  it("removes a signal from config and selection together", () => {
    const expanded = addWorkspaceSignal(initialSignalWorkspace(), "Throttle", 4108, "u8");
    const reduced = removeWorkspaceSignal(expanded, "Throttle@100c");
    expect(reduced.signals.some(signal => signal.name === "Throttle")).toBe(false);
    expect(reduced.selectedIds).not.toContain("Throttle@100c");
  });

  it("does not mutate state when toggling", () => {
    const original = initialSignalWorkspace();
    const next = toggleWorkspaceSignal(original, original.selectedIds[0]);
    expect(next).not.toBe(original);
    expect(original.selectedIds).toHaveLength(2);
    expect(next.selectedIds).toHaveLength(1);
  });

  it("validates addresses through the domain model", () => {
    expect(() => addWorkspaceSignal(initialSignalWorkspace(), "Invalid", 2 ** 32, "u32")).toThrow();
  });
});

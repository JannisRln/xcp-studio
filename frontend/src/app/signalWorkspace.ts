import type { SignalDefinition, SignalType } from "../core/api";
import { addSymbolSignal, defaultSignals } from "../core/signals";

export type SignalWorkspace = {
  signals: SignalDefinition[];
  selectedIds: string[];
};

export function initialSignalWorkspace(): SignalWorkspace {
  return {
    signals: [...defaultSignals],
    selectedIds: defaultSignals.map(signal => signal.id),
  };
}

/** Preserve existing exclusions and select only newly configured signals. */
export function addWorkspaceSignal(
  state: SignalWorkspace, name: string, address: number, type: SignalType,
): SignalWorkspace {
  const signals = addSymbolSignal(state.signals, name, address, type);
  const previous = new Set(state.signals.map(signal => signal.id));
  const newIds = signals.filter(signal => !previous.has(signal.id)).map(signal => signal.id);
  if (!newIds.length) return state;
  return { signals, selectedIds: [...state.selectedIds, ...newIds] };
}

export function toggleWorkspaceSignal(state: SignalWorkspace, id: string): SignalWorkspace {
  if (!state.signals.some(signal => signal.id === id)) return state;
  const selectedIds = state.selectedIds.includes(id)
    ? state.selectedIds.filter(item => item !== id)
    : [...state.selectedIds, id];
  return { ...state, selectedIds };
}

export function removeWorkspaceSignal(state: SignalWorkspace, id: string): SignalWorkspace {
  if (!state.signals.some(signal => signal.id === id)) return state;
  return {
    signals: state.signals.filter(signal => signal.id !== id),
    selectedIds: state.selectedIds.filter(item => item !== id),
  };
}

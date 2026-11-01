import type { SignalDefinition, SignalType } from "./api";

export const defaultSignals: SignalDefinition[] = [
  { id: "rpm", name: "Engine speed", address: 0x1000, value_type: "u32", unit: "rpm", color: "#55b6ff" },
  { id: "coolant", name: "Coolant temperature", address: 0x1004, value_type: "f32", unit: "°C", color: "#f6ae6c" },
];

export const signalTypes: SignalType[] = ["u8", "i8", "u16", "i16", "u32", "i32", "f32", "f64"];
export const palette = ["#55b6ff", "#f6ae6c", "#8ce0bd", "#c4a0ff", "#ff8da6", "#f5d46c", "#6ad8d8"];

export function addSymbolSignal(
  symbols: SignalDefinition[], name: string, address: number, value_type: SignalType = "u32",
): SignalDefinition[] {
  if (!Number.isSafeInteger(address) || address < 0 || address > 0xffffffff)
    throw new Error("XCP simulator supports only 32-bit addresses");
  if (symbols.some(signal => signal.address === address && signal.name === name)) return symbols;
  return [...symbols, {
    id: `${name}@${address.toString(16)}`,
    name, address, value_type, unit: "",
    color: palette[symbols.length % palette.length],
  }];
}

export function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(8, "0")}`;
}

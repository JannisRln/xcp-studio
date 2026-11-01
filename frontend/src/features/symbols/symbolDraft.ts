import { parseAddress } from "../../core/api";
import type { ElfResult, ElfSymbol, SignalDefinition, SignalType } from "../../core/api";

export const MAX_ELF_BYTES = 32 * 1024 * 1024;
const MAX_SYMBOLS = 250_000;

const widths: Record<SignalType, number> = {
  u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, f64: 8,
};

export type StagedSymbol = { name: string; address_hex: string; size: number; kind: string };

/** Validate inspection metadata without treating link-time addresses as runtime addresses. */
export function validateInspection(result: ElfResult): ElfSymbol[] {
  if (!result || !Array.isArray(result.symbols) || !Number.isSafeInteger(result.count) ||
      result.count !== result.symbols.length || result.count > MAX_SYMBOLS) {
    throw new Error("Invalid ELF inspection response: symbol count or list is inconsistent");
  }
  for (const item of result.symbols) {
    if (!item || typeof item.name !== "string" || typeof item.kind !== "string" ||
        typeof item.address_hex !== "string" || !/^0x[0-9a-f]+$/i.test(item.address_hex) ||
        !Number.isFinite(item.address) || !Number.isSafeInteger(item.size) || item.size < 0) {
      throw new Error("Invalid ELF inspection response: malformed symbol metadata");
    }
  }
  return result.symbols;
}

/** A staged symbol is an advisory reference, never evidence of ECU runtime mapping. */
export function validateManualSignal(
  nameInput: string,
  addressInput: string,
  type: SignalType | "",
  existing: readonly SignalDefinition[],
  staged: StagedSymbol | null,
): { name: string; address: number; type: SignalType } {
  const name = nameInput.trim();
  if (!name) throw new Error("Enter a signal name");
  if (new TextEncoder().encode(name).length > 128)
    throw new Error("Signal name must not exceed 128 UTF-8 bytes");
  if (!type || !Object.prototype.hasOwnProperty.call(widths, type))
    throw new Error("Select an explicit signal value type");
  const address = parseAddress(addressInput);
  const bytes = widths[type];
  if (address > 0xffffffff - (bytes - 1))
    throw new Error(`The ${type} value extends beyond the 32-bit address range`);
  if (staged && staged.size > 0 && bytes > staged.size)
    throw new Error(`Selected ${type} requires ${bytes} bytes, exceeding the ELF symbol's ${staged.size}-byte extent`);
  if (existing.some(signal => signal.name === name && signal.address === address))
    throw new Error("A signal with this name and address is already configured");
  return { name, address, type };
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      return "ELF import timed out. Verify that the backend is running, then retry.";
    if ("status" in error && typeof error.status === "number") {
      if (error.status === 413) return "ELF is too large for the backend (32 MiB maximum).";
      if (error.status === 400 || error.status === 422)
        return `ELF could not be inspected: ${error.message}`;
      return `ELF import failed (HTTP ${error.status}): ${error.message}`;
    }
    if (error instanceof TypeError)
      return "Cannot reach the ELF inspection service. Check the backend connection and retry.";
    return error.message;
  }
  return "ELF import failed. Check the file and backend connection.";
}

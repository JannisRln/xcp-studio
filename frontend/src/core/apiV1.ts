/** Explicit runtime validation at the untrusted HTTP boundary. */

export type HealthV1 = {
  schema_version: 1;
  status: string;
  mode: string;
  version: string;
};

export type SessionV1 = {
  schema_version: 1;
  connected: boolean;
  transport: string;
};

export type ReadResultV1 = {
  schema_version: 1;
  address: number;
  bytes: number[];
  hex: string;
};

export type ApiErrorV1 = {
  schema_version: 1;
  error: {
    code: string;
    message: string;
    request_id: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

export class VersionedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly requestId: string,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "VersionedApiError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isV1(value: unknown): value is Record<string, unknown> & { schema_version: 1 } {
  return isObject(value) && value.schema_version === 1;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseHealthV1(value: unknown): HealthV1 {
  if (!isV1(value) || !isString(value.status) || !isString(value.mode) || !isString(value.version))
    throw new Error("Unsupported or malformed v1 health response");
  return value as HealthV1;
}

export function parseSessionV1(value: unknown): SessionV1 {
  if (!isV1(value) || typeof value.connected !== "boolean" || !isString(value.transport))
    throw new Error("Unsupported or malformed v1 session response");
  return value as SessionV1;
}

export function parseReadV1(value: unknown): ReadResultV1 {
  if (!isV1(value) || typeof value.address !== "number" || !Number.isSafeInteger(value.address) ||
      (value.address as number) < 0 || (value.address as number) > 0xffffffff ||
      !Array.isArray(value.bytes) || value.bytes.length > 4096 ||
      !value.bytes.every((byte: unknown) => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255) ||
      typeof value.hex !== "string")
    throw new Error("Unsupported or malformed v1 memory read response");

  const expectedHex = (value.bytes as number[])
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
  if (value.hex !== expectedHex) throw new Error("Inconsistent v1 memory read bytes/hex");
  return value as ReadResultV1;
}

export function parseErrorV1(value: unknown): ApiErrorV1 {
  if (!isV1(value) || !isObject(value.error) ||
      !isString(value.error.code) || !isString(value.error.message) ||
      !isString(value.error.request_id) || typeof value.error.retryable !== "boolean" ||
      !/^[A-Z][A-Z0-9_]*$/.test(value.error.code as string) ||
      (value.error.details !== undefined && !isObject(value.error.details)))
    throw new Error("Malformed versioned API error");
  return value as ApiErrorV1;
}

async function requestV1<T>(
  path: string,
  decode: (value: unknown) => T,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    let error: ApiErrorV1;
    try {
      error = parseErrorV1(payload);
    } catch {
      throw new Error(`HTTP ${response.status}: unrecognized API error envelope`);
    }
    throw new VersionedApiError(
      response.status, error.error.code, error.error.request_id,
      error.error.retryable, error.error.message,
    );
  }
  return decode(payload);
}

export const apiV1 = {
  health: () => requestV1("/api/v1/health", parseHealthV1),
  status: () => requestV1("/api/v1/sessions/current", parseSessionV1),
  read: (address: number, count: number) => {
    if (!Number.isSafeInteger(address) || address < 0 || address > 0xffffffff ||
        !Number.isSafeInteger(count) || count < 1 || count > 4096 ||
        address + count - 1 > 0xffffffff)
      throw new Error("Invalid 32-bit memory read address or byte count");
    return requestV1("/api/v1/sessions/current/reads", parseReadV1, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, count }),
    });
  },
};

import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserDemo, simulatedValue } from "./browserDemo";
import { parseAcquisitionEvent, parseAcquisitionStatus } from "../core/acquisitionV1";

afterEach(() => vi.unstubAllGlobals());

describe("static GitHub Pages browser backend", () => {
  it("generates plausible, finite and changing test signals", () => {
    for (const address of [0x1000, 0x1004, 0x1008, 0x100c]) {
      const one = simulatedValue(address, 0);
      const two = simulatedValue(address, 3);
      expect(Number.isFinite(one) && Number.isFinite(two)).toBe(true);
      expect(one).not.toBe(two);
    }
  });

  it("supports real API contracts and two subscribers without network access", async () => {
    const externalFetch = vi.fn();
    const windowMock = {
      fetch: externalFetch as unknown as typeof fetch,
      WebSocket: class {},
    };
    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("location", {
      href: "https://jannisrln.github.io/xcp-studio/",
      origin: "https://jannisrln.github.io",
    });
    installBrowserDemo();
    const fetchDemo = windowMock.fetch;

    const health = await (await fetchDemo("/api/v1/health")).json() as { mode: string };
    expect(health.mode).toBe("browser-demo");
    const active = parseAcquisitionStatus(
      await (await fetchDemo("/api/v1/acquisitions/current")).json(),
    );
    expect(active.state).toBe("running");
    expect(active.signal_count).toBe(4);
    expect(active.sampling_mode).toBe("polling");
    expect(externalFetch).not.toHaveBeenCalled();

    const Socket = windowMock.WebSocket as unknown as typeof WebSocket;
    const first = new Socket("wss://jannisrln.github.io/api/v1/acquisitions/" +
      active.acquisition_id + "/stream");
    const second = new Socket("wss://jannisrln.github.io/api/v1/acquisitions/" +
      active.acquisition_id + "/stream");

    const nextSample = (socket: WebSocket) => new Promise<ReturnType<typeof parseAcquisitionEvent>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Demo stream did not emit")), 2000);
        socket.onmessage = event => {
          clearTimeout(timeout);
          resolve(parseAcquisitionEvent(JSON.parse(String(event.data)) as unknown));
        };
      },
    );
    try {
      const [one, two] = await Promise.all([nextSample(first), nextSample(second)]);
      expect(one.type).toBe("samples");
      expect(two.type).toBe("samples");
      if (one.type === "samples" && two.type === "samples") {
        expect(one.sequence).toBe(two.sequence);
        expect(one.samples).toHaveLength(4);
        expect(one.samples.every(signal => Number.isFinite(signal.value))).toBe(true);
      }
      const current = parseAcquisitionStatus(
        await (await fetchDemo("/api/v1/acquisitions/current")).json(),
      );
      expect(current.subscriber_count).toBe(2);

      const stopped = parseAcquisitionStatus(
        await (await fetchDemo("/api/v1/acquisitions/" + active.acquisition_id + "/stop", {
          method: "POST",
        })).json(),
      );
      expect(stopped.state).toBe("stopped");
      const session = await (await fetchDemo("/api/v1/sessions/current")).json() as {
        connected: boolean;
      };
      expect(session.connected).toBe(true);
    } finally {
      first.close();
      second.close();
      await fetchDemo("/api/v1/acquisitions/" + active.acquisition_id + "/stop", {
        method: "POST",
      });
    }
  });
});

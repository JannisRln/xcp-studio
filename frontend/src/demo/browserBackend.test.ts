import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBackend, simulatedValue } from "./browserBackend";
import { parseAcquisitionEvent, parseAcquisitionStatus } from "../core/acquisitionV1";

const originalWindow = globalThis.window;

function setup() {
  vi.stubGlobal("window", {
    location: { href: "https://example.com/xcp-studio/" },
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  });
  return new DemoBackend();
}
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWindow) vi.stubGlobal("window", originalWindow);
});

describe("GitHub Pages demo backend (never XCP hardware)", () => {
  it("creates smooth deterministic, visibly changing demo values", () => {
    const rpm = { name: "Engine speed", address: 4096, value_type: "u32" as const };
    const coolant = { name: "Coolant", address: 4100, value_type: "f32" as const };
    expect(simulatedValue(rpm, 0)).not.toBe(simulatedValue(rpm, 2000));
    expect(simulatedValue(coolant, 0)).not.toBe(simulatedValue(coolant, 4000));
    expect(simulatedValue(rpm, 1234)).toBe(simulatedValue(rpm, 1234));
  });

  it("connects and serves validated versioned status and bounded read", async () => {
    const demo = setup();
    expect((await (await demo.handle("/api/v1/health")).json()).mode).toBe("browser-demo");
    expect((await (await demo.handle("/api/v1/sessions/current")).json()).connected).toBe(false);
    const disconnected = await demo.handle("/api/v1/sessions/current/reads", {
      method:"POST", body: JSON.stringify({address:4096,count:4}),
    });
    expect(disconnected.status).toBe(409);
    await demo.handle("/api/xcp/connect", {method:"POST"});
    const read = await demo.handle("/api/v1/sessions/current/reads", {
      method:"POST", body: JSON.stringify({address:4096,count:4}),
    });
    expect(read.status).toBe(200);
    expect((await read.json()).bytes).toHaveLength(4);
    const bad = await demo.handle("/api/v1/sessions/current/reads", {
      method:"POST", body: JSON.stringify({address:4096,count:1e9}),
    });
    expect(bad.status).toBe(422);
    demo.stop();
  });

  it("fans out ONE acquisition to two independent WebSocket viewers", async () => {
    const demo = setup();
    await demo.handle("/api/xcp/connect", {method:"POST"});
    const config = {
      interval_ms:20,
      signals:[
        {name:"Engine speed",address:4096,value_type:"u32"},
        {name:"Coolant",address:4100,value_type:"f32"},
      ],
    };
    const started = await demo.handle("/api/v1/acquisitions", {
      method:"POST",body:JSON.stringify(config),
    });
    expect(started.status).toBe(201);
    const status = parseAcquisitionStatus(await started.json());
    const ids = status.acquisition_id;
    const first = demo.openSocket("wss://example.com/api/v1/acquisitions/"+ids+"/stream");
    const second = demo.openSocket("wss://example.com/api/v1/acquisitions/"+ids+"/stream");
    try {
      await Promise.resolve();
      expect(first.readyState).toBe(1);
      expect(second.readyState).toBe(1);
      const messages: unknown[] = [];
      first.addEventListener("message", (event) => messages.push(JSON.parse((event as MessageEvent).data)));
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(messages.length).toBeGreaterThan(1);
      const samples = messages.map(parseAcquisitionEvent);
      expect(samples.every(packet => packet.type === "samples")).toBe(true);
      expect((await (await demo.handle("/api/v1/acquisitions/current")).json()).subscriber_count).toBe(2);
      const notAnother = await demo.handle("/api/v1/acquisitions", {
        method:"POST",body:JSON.stringify(config),
      });
      expect(notAnother.status).toBe(409);
      const stopped = await demo.handle("/api/v1/acquisitions/"+ids+"/stop", {method:"POST"});
      expect((await stopped.json()).state).toBe("stopped");
      expect(first.readyState).toBe(3);
      expect(second.readyState).toBe(3);
    } finally {
      first.close();
      second.close();
      demo.stop();
    }
  });
});

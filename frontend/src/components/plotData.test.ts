import { describe, expect, it } from "vitest";
import type { MeasurementFrame, SignalDefinition } from "../core/api";
import { alignedPlotData, cursorValue } from "./plotData";

const signals: SignalDefinition[] = [
  { id:"rpm", name:"RPM", address:4096, value_type:"u32",unit:"rpm",color:"#00aaff" },
  { id:"temp", name:"Temp", address:4100, value_type:"f32",unit:"°C",color:"#ffaa00" },
];

describe("uPlot data alignment and decimation", () => {
  it("preserves first, last and narrow peaks across 10000 batches", () => {
    const frames: MeasurementFrame[] = Array.from({length:10000}, (_,i) => ({
      timestamp_ms:100000+i,
      samples:[
        {name:"RPM",address:4096,value:i===4898?9000:1800},
        {name:"Temp",address:4100,value:i===6000?-40:88.5},
      ],
    }));
    const [x,rpm,temp] = alignedPlotData(frames,signals,800);
    expect(x.length).toBeLessThanOrEqual(800);
    expect(x[0]).toBe(100000);
    expect(x[x.length-1]).toBe(109999);
    expect(rpm).toContain(9000);
    expect(temp).toContain(-40);
    expect(rpm.length).toBe(x.length);
    expect(temp.length).toBe(x.length);
  });

  it("sorts host-clock disorder, merges same-millisecond samples and omits bad numbers", () => {
    const frames: MeasurementFrame[] = [
      {timestamp_ms:4,samples:[{name:"RPM",address:4096,value:10}]},
      {timestamp_ms:3,samples:[{name:"RPM",address:4096,value:NaN}]},
      {timestamp_ms:4,samples:[{name:"RPM",address:4096,value:30}]},
    ];
    const [x,rpm,temp] = alignedPlotData(frames,signals);
    expect(x).toEqual([3,4]);
    expect(Number.isNaN(rpm[0])).toBe(true);
    expect(rpm[1]).toBe(30);
    expect(temp.every(Number.isNaN)).toBe(true);
  });

  it("produces cursor measurements and deltas from original frames", () => {
    const frames: MeasurementFrame[] = [
      {timestamp_ms:1000,samples:[{name:"RPM",address:4096,value:1800}]},
      {timestamp_ms:2000,samples:[{name:"RPM",address:4096,value:1900}]},
    ];
    const a=cursorValue(frames,signals[0],1200);
    const b=cursorValue(frames,signals[0],1900);
    expect(a).toEqual({time:1000,value:1800});
    expect(b).toEqual({time:2000,value:1900});
    expect(b!.value!-a!.value!).toBe(100);
    expect(cursorValue([],signals[0],1000)).toBeNull();
    expect(cursorValue(frames,signals[0],null)).toBeNull();
    expect(() => alignedPlotData(frames,signals,2)).toThrow();
  });
});

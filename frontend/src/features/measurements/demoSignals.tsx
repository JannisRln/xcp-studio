import React from "react";

export type Signal = { name: string; unit: string; color: string; base: number; amplitude: number; precision: number };
export const signals: Signal[] = [
  { name: "Engine speed", unit: "rpm", color: "#67b9ff", base: 1850, amplitude: 420, precision: 0 },
  { name: "Coolant temperature", unit: "°C", color: "#f5ad67", base: 88, amplitude: 3, precision: 1 },
  { name: "Battery voltage", unit: "V", color: "#a8e6b2", base: 13.8, amplitude: 0.35, precision: 2 },
  { name: "Throttle position", unit: "%", color: "#bd9cff", base: 34, amplitude: 18, precision: 1 },
  { name: "Intake pressure", unit: "kPa", color: "#f18fa7", base: 98, amplitude: 12, precision: 1 },
];
export const sample = (signal: Signal, tick: number) =>
  signal.base + Math.sin(tick * 0.17 + signals.indexOf(signal) * 1.4) * signal.amplitude
  + Math.sin(tick * 0.047 + signals.indexOf(signal)) * signal.amplitude * 0.24;
export function Sparkline({ signal, tick, large = false }: { signal: Signal; tick: number; large?: boolean }) {
  const values = Array.from({ length: 64 }, (_, index) => sample(signal, tick - 63 + index));
  const min = signal.base - signal.amplitude * 1.55;
  const max = signal.base + signal.amplitude * 1.55;
  const points = values.map((value, index) => `${(index / 63) * 600},${140 - ((value - min) / (max - min)) * 140}`).join(" ");
  return <svg className={large ? "spark large" : "spark"} viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label={`Simulated trend for ${signal.name}`}>
    {large && [35, 70, 105].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#29354a" strokeDasharray="4 5" />)}
    <polyline points={points} fill="none" stroke={signal.color} strokeWidth={large ? 2.8 : 3.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

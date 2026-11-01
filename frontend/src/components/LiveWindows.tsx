import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactGridLayout, { useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";

type Props = { chart: ReactNode; values: ReactNode };
const STORAGE_KEY = "xcp-studio-live-windows-v1";

export const DEFAULT_WINDOWS: Layout = [
  { i: "chart", x: 0, y: 0, w: 9, h: 17, minW: 5, minH: 9 },
  { i: "values", x: 9, y: 0, w: 3, h: 17, minW: 3, minH: 7 },
];

export function validateLayout(value: unknown): Layout | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const known = new Set(["chart", "values"]);
  if (!value.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const entry = item as Partial<LayoutItem>;
    return typeof entry.i === "string" && known.has(entry.i) &&
      [entry.x, entry.y, entry.w, entry.h].every(v =>
        typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 64) &&
      entry.w! > 0 && entry.h! > 0 && entry.x! + entry.w! <= 12;
  })) return null;
  if (new Set(value.map(item => (item as LayoutItem).i)).size !== 2) return null;
  return value as Layout;
}

function readSavedLayout(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateLayout(JSON.parse(raw)) ?? DEFAULT_WINDOWS : DEFAULT_WINDOWS;
  } catch {
    return DEFAULT_WINDOWS;
  }
}

/** Resizable windows only; uPlot Canvas owns all sample rendering. */
export function LiveWindows({ chart, values }: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [layout, setLayout] = useState<Layout>(readSavedLayout);
  const [locked, setLocked] = useState(false);
  const narrow = width < 900;
  const gridConfig = useMemo(() => ({
    cols: 12, rowHeight: 32, margin: [12, 12] as [number, number],
  }), []);

  const onLayoutChange = useCallback((next: Layout) => {
    if (narrow) return;
    const checked = validateLayout(next);
    if (!checked) return;
    setLayout(checked);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(checked)); } catch {
      // Private browsing can disable local storage; layout still works in-session.
    }
  }, [narrow]);

  const reset = () => {
    setLayout(DEFAULT_WINDOWS);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignored */ }
  };

  const content = (key: "chart" | "values", child: ReactNode) => <div
    key={key} className="live-window">
    <div className="measure-window-handle" aria-label={"Drag " + key + " window"}>
      <span className="window-drag-icon" aria-hidden="true">⠿</span>
      {key === "chart" ? "SIGNAL CHARTS" : "LIVE SIGNAL VALUES"}
      <span className="window-drag-hint">Drag · resize from corner</span>
    </div>
    <div className="live-window-body">{child}</div>
  </div>;

  return <section className="live-window-section" aria-label="Measurement windows">
    <div className="live-window-controls">
      <strong>Measurement windows</strong>
      <span className="muted">Canvas charts, independent measurement tools</span>
      <button type="button" className="button small" onClick={() => setLocked(value => !value)}
        aria-pressed={locked}>{locked ? "Unlock layout" : "Lock layout"}</button>
      <button type="button" className="button small" onClick={reset}>Reset layout</button>
    </div>
    <div ref={containerRef} className="live-grid-container">
      {!mounted || narrow
        ? <div className="live-window-stack">
            {content("chart", chart)}
            {content("values", values)}
          </div>
        : <ReactGridLayout
            width={width}
            layout={layout}
            gridConfig={gridConfig}
            dragConfig={{ enabled: !locked, handle: ".measure-window-handle" }}
            resizeConfig={{ enabled: !locked }}
            onLayoutChange={onLayoutChange}
          >
            {content("chart", chart)}
            {content("values", values)}
          </ReactGridLayout>}
    </div>
  </section>;
}

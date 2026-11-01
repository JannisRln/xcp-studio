import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorFallback } from "./AppErrorBoundary";
import { App } from "./App";

describe("dashboard page recovery", () => {
  it("renders accessible navigation and initial loading state", () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("API Checking");
    expect(markup).toContain("Live signal trends");
    expect(markup).toContain("Connect simulator");
    expect(markup).toContain("LIVE VIEW");
    expect(markup).toContain("Live signal values");
  });

  it("shows a recoverable accessible error without claiming ECU disconnect", () => {
    const markup = renderToStaticMarkup(<ErrorFallback error={new Error("Unexpected chart data")} onRetry={() => {}} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retry this view");
    expect(markup).toContain("Unexpected chart data");
    expect(markup).toContain("may still be active");
  });
});

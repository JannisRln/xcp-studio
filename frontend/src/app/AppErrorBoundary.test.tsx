import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorFallback } from "./AppErrorBoundary";

describe("dashboard page recovery", () => {
  it("shows a recoverable accessible error without claiming ECU disconnect", () => {
    const markup = renderToStaticMarkup(<ErrorFallback error={new Error("Unexpected chart data")} onRetry={() => {}} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retry this view");
    expect(markup).toContain("Unexpected chart data");
    expect(markup).toContain("may still be active");
  });
});

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onRecover?: () => void;
};

type State = { error: Error | null };

export function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return <section className="panel workspace-error" role="alert" aria-live="assertive">
    <h2>Workspace view could not be rendered</h2>
    <p>A display error occurred. The backend connection and ECU session may still be active.</p>
    <p className="muted">Details: {error.message || "Unknown rendering error"}</p>
    <button className="button primary" type="button" onClick={onRetry}>Retry this view</button>
  </section>;
}

/** Contains rendering errors inside one workspace page without resetting the entire shell. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("XCP Studio view rendering error", error, info.componentStack);
  }

  private recover = () => {
    this.setState({ error: null });
    this.props.onRecover?.();
  };

  render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={this.recover} />;
    }
    return this.props.children;
  }
}

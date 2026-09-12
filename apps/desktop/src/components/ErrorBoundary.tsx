import { Component, type ReactNode } from "react";
import { captureException } from "@sentry/react";

export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    onSettings: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    captureException(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="p-6 space-y-4 text-foreground bg-background">
        <p>Unable to load the app. Your local library is still saved.</p>
        <button
          className="underline mr-4"
          onClick={() => this.setState({ failed: false })}
        >
          Retry
        </button>
        <button className="underline" onClick={this.props.onSettings}>
          Connection settings
        </button>
      </div>
    );
  }
}

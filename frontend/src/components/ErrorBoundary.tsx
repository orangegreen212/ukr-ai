import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Catches render-time crashes so the UI shows the error instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 rounded-lg border border-red-500/40 bg-red-950/30 p-5 text-slate-200">
        <h1 className="text-base font-semibold text-white">Something went wrong</h1>
        <pre className="mt-3 whitespace-pre-wrap text-xs text-red-300">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          className="btn-ghost mt-4 text-xs"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}

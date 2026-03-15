import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";

type ThreadRenderBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: unknown) => void;
  resetKey: string;
};

type ThreadRenderBoundaryState = {
  hasError: boolean;
};

export class ThreadRenderBoundary extends Component<
  ThreadRenderBoundaryProps,
  ThreadRenderBoundaryState
> {
  public state: ThreadRenderBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ThreadRenderBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, _errorInfo: ErrorInfo): void {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: ThreadRenderBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

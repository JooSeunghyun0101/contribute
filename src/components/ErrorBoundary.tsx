import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/state-views';

interface Props {
  children: ReactNode;
  /** 이 값이 바뀌면 에러 상태를 자동 해제한다(예: 라우트 경로). */
  resetKey?: string;
  /** fallback 문구 커스터마이즈. */
  message?: string;
}

interface State {
  hasError: boolean;
}

/**
 * 렌더 예외를 잡아 백화면(전체 앱 다운) 대신 복구 가능한 안내를 보여준다.
 * 루트(앱 전체)와 라우트(페이지) 두 층에 둔다 — 한 페이지의 예외가 헤더·사이드바까지
 * 날려버리지 않도록.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 운영에서는 외부 로깅으로 보낼 수 있는 지점. 지금은 콘솔만.
    console.error('렌더 예외(ErrorBoundary):', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // 라우트 등 resetKey 변경 시 에러를 자동 해제 — 다른 페이지로 이동하면 복구.
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private handleRetry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <ErrorState
            message={
              this.props.message ??
              '화면을 표시하는 중 문제가 발생했습니다. 다시 시도하거나 잠시 후 새로고침해 주세요.'
            }
            onRetry={this.handleRetry}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

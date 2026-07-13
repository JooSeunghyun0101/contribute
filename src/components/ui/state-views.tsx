import * as React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { SpiralLoader } from '@/components/ui/loader';

/**
 * 목록 화면의 3-상태(로딩·오류·빈) 표시를 통일한다.
 *
 * 핵심 규칙: **오류를 빈 상태로 위장하지 않는다.** fetch 실패 시 빈 배열로 흐르면
 * 사용자는 "데이터가 없다"로 오해한다(전사 배포 시 장애가 "평가 사라짐" 민원이 됨).
 * 로더는 error 를 잡아 ErrorState 로 분기하고 "다시 시도"를 제공해야 한다.
 */

interface ErrorStateProps {
  /** 사용자에게 보일 친절한 한 줄(서버 원문 메시지 금지). */
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = '정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  onRetry,
  retryLabel = '다시 시도',
}) => (
  <div
    className="sd-card sd-card-lg"
    role="alert"
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14,
      textAlign: 'center',
      color: 'var(--fg)',
      padding: '40px 24px',
    }}
  >
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 48,
        height: 48,
        borderRadius: 'var(--r-pill)',
        background: 'var(--danger-bg)',
        color: 'var(--danger)',
      }}
    >
      <AlertTriangle size={22} />
    </div>
    <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>{message}</div>
    {onRetry && (
      <button type="button" className="sd-btn sd-btn-outline sd-btn-sm" onClick={onRetry}>
        {retryLabel}
      </button>
    )}
  </div>
);

interface EmptyStateProps {
  /** 비어 있는 이유를 안내하는 한 줄. */
  message: string;
  /** 다음 행동 유도(선택). */
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, action, icon }) => (
  <div
    className="sd-card sd-card-lg"
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14,
      textAlign: 'center',
      color: 'var(--fg-muted)',
      padding: '40px 24px',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 48,
        height: 48,
        borderRadius: 'var(--r-pill)',
        background: 'var(--bg-muted)',
        color: 'var(--fg-subtle)',
      }}
    >
      {icon ?? <Inbox size={22} aria-hidden />}
    </div>
    <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>{message}</div>
    {action}
  </div>
);

interface LoadingStateProps {
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = '불러오는 중입니다…',
}) => (
  <div
    className="sd-card sd-card-lg"
    aria-busy="true"
    style={{
      color: 'var(--fg-muted)',
      fontSize: 'var(--fs-body)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 16,
      textAlign: 'center',
      padding: '40px 24px',
    }}
  >
    <SpiralLoader />
    {message}
  </div>
);

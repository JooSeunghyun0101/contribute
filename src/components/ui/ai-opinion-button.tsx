import { cn } from '@/lib/utils';

// AI 의견(초안·성과보고 등) 생성 트리거용 버튼.
// 모양·사이즈는 '평가저장' 버튼(sd-btn sd-btn-sm)과 동일, 색은 파랑 그라데이션.
// 클릭 → 로딩 동안: shine sweep + 이모지 "위로 쓸어올림" 애니메이션이 반복된다.
// (텍스트는 "AI의견" 유지, 흐려짐 없음 — 애니메이션 자체가 진행 표시.)
interface AiOpinionButtonProps {
  className?: string;
  onClick?: () => void;
  /** 사용 불가(권한 등) — 흐리게 + 비활성화. 로딩과 별개. */
  disabled?: boolean;
  /** 생성 진행 중 — 비활성화(클릭만 막음) + 반복 효과. */
  loading?: boolean;
  /** 버튼 텍스트. 기본 "AI의견". */
  label?: string;
  title?: string;
  type?: 'button' | 'submit';
}

export function AiOpinionButton({
  className,
  onClick,
  disabled = false,
  loading = false,
  label = 'AI 의견',
  title,
  type = 'button',
}: AiOpinionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={cn(
        // 평가저장 버튼과 동일한 모양·사이즈
        'sd-btn sd-btn-sm',
        // 파랑 채움 + shine 을 위한 relative/overflow
        'relative overflow-hidden text-white',
        'bg-gradient-to-r from-blue-600 to-blue-700',
        'hover:from-blue-700 hover:to-blue-800',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/40',
        // 권한 비활성: 더 흐리게. 로딩 중: 약간 흐리게 + 텍스트 선택 비활성화.
        disabled && 'opacity-60 cursor-not-allowed',
        loading && 'opacity-80 select-none cursor-wait',
        className,
      )}
    >
      {/* AI 이모지 — 로딩 동안 위로 쓸어올림 반복(위로 사라지고 아래에서 새로 올라옴) */}
      <span
        aria-hidden
        className="relative inline-flex items-center justify-center overflow-hidden leading-none"
        style={{ width: '1.15em', height: '1.25em' }}
      >
        <span className={cn('inline-block', loading && 'animate-ai-emoji-up')}>✨</span>
      </span>
      <span>{label}</span>

      {/* shine sweep — 로딩 동안 반복(왼→오). 평상시엔 숨김. */}
      <span className="pointer-events-none absolute inset-0 overflow-hidden">
        <span
          className={cn(
            'absolute inset-0 -translate-x-full -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent',
            loading ? 'animate-ai-shine' : 'opacity-0',
          )}
        />
      </span>
    </button>
  );
}

export default AiOpinionButton;

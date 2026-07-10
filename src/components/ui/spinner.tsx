import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 인라인 로딩 스피너 — 버튼·상태 표시에서 "처리 중"을 시각적으로 명확히 한다.
 *
 * 현재 글자색(currentColor)을 따르므로 어떤 버튼 위에서도 색이 맞는다.
 * 텍스트("저장 중…")와 함께 쓰면 접근성·가독성이 모두 좋다.
 *
 *   {isSaving ? <Spinner /> : <IconCheck />}
 *   <button disabled={isSaving}>{isSaving ? '저장 중…' : '저장'} <Spinner size={14} /></button>
 */
export const Spinner: React.FC<{
  /** 한 변의 px 크기 (기본 16). */
  size?: number;
  className?: string;
  'aria-label'?: string;
}> = ({ size = 16, className, 'aria-label': ariaLabel = '처리 중' }) => (
  <span
    role="status"
    aria-label={ariaLabel}
    className={cn(
      'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]',
      className,
    )}
    style={{ width: size, height: size }}
  />
);

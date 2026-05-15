import type { PillTone } from '@/components/brand';
import type {
  EvaluatorAssignmentChangeType,
  EvaluatorAssignmentHistory,
  EvaluatorAssignmentStatus,
} from '@/types';

// 평가자 변경 이력 표시용 라벨/포맷 헬퍼.
// HrUsersPage 와 EvaluatorHistoryModal 이 공유한다.

export const assignmentTypeLabel = (type: EvaluatorAssignmentChangeType) =>
  type === 'cancel' ? '취소' : '변경';

export const assignmentStatusLabel = (status: EvaluatorAssignmentStatus) =>
  status === 'cancelled' ? '취소됨' : '적용됨';

export const assignmentStatusTone = (status: EvaluatorAssignmentStatus): PillTone =>
  status === 'cancelled' ? 'neutral' : 'success';

export const formatAssignmentDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

// 매칭 엑셀 일괄 임포트로 생성된 이력 행인지 판별.
// reason 이 'Matching import:' / 'Matching past tour:' / 'Matching baseline import:' 로 시작.
export const isBulkMatchingHistory = (history: EvaluatorAssignmentHistory): boolean => {
  const reason = (history.reason ?? '').trim();
  return /^Matching (import|past tour|baseline import):/i.test(reason);
};

// 정정(supersede)으로 생긴 행인지 — supersedes_history_id 가 채워져 있으면 정정 행.
export const isCorrectionHistory = (history: EvaluatorAssignmentHistory): boolean =>
  Boolean(history.supersedes_history_id);

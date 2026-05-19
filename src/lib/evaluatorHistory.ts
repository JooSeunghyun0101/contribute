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

export type EvaluatorPeriod = { start: string | null; end: string | null };

// 새 평가자 시작일의 '전날'을 이전 평가자 종료일로 사용해 하루가 겹치지 않게 한다.
const shiftBackOneDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  return d.toISOString();
};

// 변경 이력 타임라인을 걸어 평가자별 근무기간(시작~종료)을 계산한다.
// - status='applied' & change_type='change' 행만 사용
// - 시간순으로 정렬 후, 각 행의 직전 행 new_evaluator 종료일 = 이 행의 시작일 -1일
//   (previous_evaluator_id 만 보면 정정/취소로 체인이 끊겼을 때 종료일이 갱신 안 됨)
// - 같은 평가자가 여러 번 배정된 경우 가장 최근 구간으로 덮어씀
export const buildEvaluatorPeriods = (
  history: EvaluatorAssignmentHistory[],
): Map<string, EvaluatorPeriod> => {
  const applied = history
    .filter((row) => row.status === 'applied' && row.change_type === 'change')
    .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());

  const periods = new Map<string, EvaluatorPeriod>();
  applied.forEach((row, index) => {
    // 직전 applied 행의 new_evaluator 가 이 시점에 평가자 자리를 비운다.
    if (index > 0) {
      const prevEvaluatorId = applied[index - 1].new_evaluator_id;
      if (prevEvaluatorId && prevEvaluatorId !== row.new_evaluator_id) {
        const prevEnd = shiftBackOneDay(row.changed_at);
        const prev = periods.get(prevEvaluatorId);
        if (prev) prev.end = prevEnd;
        else periods.set(prevEvaluatorId, { start: null, end: prevEnd });
      }
    }
    if (row.new_evaluator_id) {
      const existing = periods.get(row.new_evaluator_id);
      if (existing) {
        existing.start = row.changed_at;
        existing.end = null;
      } else {
        periods.set(row.new_evaluator_id, { start: row.changed_at, end: null });
      }
    }
  });
  return periods;
};

const periodDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatPeriodDate = (value: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return periodDateFormatter.format(d);
};

// 사람이 읽는 표시 문자열로 변환. 둘 다 없으면 null.
export const formatEvaluatorPeriod = (period?: EvaluatorPeriod | null): string | null => {
  if (!period) return null;
  const start = formatPeriodDate(period.start);
  const end = formatPeriodDate(period.end);
  if (!start && !end) return null;
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~ 현재`;
  return `이전 ~ ${end}`;
};

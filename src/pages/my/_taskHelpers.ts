import type { PillTone } from '@/components/brand';

export type TaskDraft = {
  title: string;
  description: string;
  weight: number;
  isAiTask: boolean;
  startDate: string;
  endDate: string;
};

export type WeightStatus = {
  tone: PillTone;
  label: string;
  message: string;
  guide: string;
  color: string;
  background: string;
  border: string;
};

export type EvaluationStatusMeta = {
  tone: PillTone;
  label: string;
  description: string;
};

export const EMPTY_DRAFT: TaskDraft = {
  title: '',
  description: '',
  weight: 0,
  isAiTask: false,
  startDate: '',
  endDate: '',
};

export const EVALUATEE_TASK_LOCKED_STATUSES = new Set(['submitted', 'evaluating', 'completed', 'locked']);

export const toDateInput = (value?: string) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
};

export const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
};

export const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const getTaskSuggestion = (score?: number | null) => {
  if (score === 4) return '성과가 충분히 드러난 과업입니다. 다음 반기에는 확산 방식까지 설계하는 편이 좋습니다.';
  if (score === 3) return '현재 수준은 안정적입니다. 기여 범위를 한 단계 더 넓히면 상위 점수에 가까워집니다.';
  if (score === 2) return '실행 근거와 영향 범위를 더 명확히 정리하면 평가 해석이 쉬워집니다.';
  if (score === 1) return '기여 내용은 있으나 임팩트 설명이 부족할 수 있습니다. 구체적 결과를 보강하는 편이 낫습니다.';
  return '평가 전 과업입니다. 시작일, 종료일, 설명과 가중치가 충분한지 먼저 점검하세요.';
};

export const getWeightStatus = (totalWeight: number): WeightStatus => {
  if (totalWeight === 100) {
    return {
      tone: 'success',
      label: '100% 완료',
      message: '총합 100%',
      guide: '가중치 조건을 충족했습니다.',
      color: 'var(--success)',
      background: 'rgba(22, 163, 74, 0.10)',
      border: '1px solid rgba(22, 163, 74, 0.45)',
    };
  }
  if (totalWeight > 100) {
    return {
      tone: 'danger',
      label: '초과',
      message: `${totalWeight - 100}% 초과`,
      guide: '임시저장은 가능하지만 최종제출하려면 총합을 100%로 낮춰야 합니다.',
      color: 'var(--danger)',
      background: 'rgba(220, 69, 69, 0.10)',
      border: '1px solid rgba(220, 69, 69, 0.45)',
    };
  }
  return {
    tone: 'warning',
    label: '조정 필요',
    message: `${100 - totalWeight}% 부족`,
    guide: '임시저장은 가능하지만 최종제출하려면 총합을 100%로 맞춰야 합니다.',
    color: 'var(--warning)',
    background: 'var(--bg-muted)',
    border: '1px solid transparent',
  };
};

export const getEvaluationStatusMeta = (status?: string): EvaluationStatusMeta => {
  switch (status) {
    case 'submitted':
      return { tone: 'info', label: '제출 완료', description: '평가자 검토 단계로 넘어갔습니다.' };
    case 'evaluating':
      return { tone: 'orange', label: '평가 진행', description: '평가자가 점수와 피드백을 작성 중입니다.' };
    case 'completed':
      return { tone: 'success', label: '평가 완료', description: '평가가 완료되어 과업을 수정할 수 없습니다.' };
    case 'locked':
      return { tone: 'neutral', label: '잠금', description: '평가가 잠겨 과업을 수정할 수 없습니다.' };
    case 'in-progress':
      return { tone: 'warning', label: '작성 중', description: '과업을 작성하고 최종제출해 주세요.' };
    case 'draft':
    default:
      return { tone: 'warning', label: '작성 중', description: '과업을 작성하고 최종제출해 주세요.' };
  }
};

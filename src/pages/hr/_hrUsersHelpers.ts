import type { UserRole, EvaluationStatus } from '@/types';

// 사용자관리 행/필터에서 공유하는 순수 헬퍼·상수·타입(HrUsersPage ↔ UserRow 공용).

export const roleFilters: Array<{ id: 'all' | UserRole; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'evaluator', label: '평가자' },
  { id: 'evaluatee', label: '피평가자' },
  { id: 'hr', label: 'HR' },
];
export const editableRoleOptions = roleFilters.filter(
  (filter): filter is { id: UserRole; label: string } => filter.id !== 'all',
);

export const ROLE_BG: Record<string, string> = {
  hr: '#EFF6FF',
  evaluator: 'var(--ok-orange-50)',
  evaluatee: 'var(--bg-muted)',
};
export const ROLE_COLOR: Record<string, string> = {
  hr: '#2563EB',
  evaluator: 'var(--ok-orange)',
  evaluatee: 'var(--fg-muted)',
};
export const ROLE_BORDER: Record<string, string> = {
  hr: '#BFDBFE',
  evaluator: 'var(--ok-orange-100)',
  evaluatee: 'var(--border)',
};

export const roleLabel = (role: UserRole) => {
  if (role === 'hr') return 'HR';
  if (role === 'evaluator') return '평가자';
  return '피평가자';
};

export const statusLabel = (status?: EvaluationStatus | null) => {
  if (status === 'submitted') return '검토 대기';
  if (status === 'evaluating') return '평가 중';
  if (status === 'completed') return '완료';
  if (status === 'locked') return '잠금';
  if (status === 'draft' || status === 'in-progress') return '작성 중';
  return '없음';
};

export const statusTone = (status?: EvaluationStatus | null) => {
  if (status === 'submitted') return 'orange';
  if (status === 'evaluating') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'locked') return 'neutral';
  if (status === 'draft' || status === 'in-progress') return 'warning';
  return 'neutral';
};

export type EmployeeEditForm = {
  name: string;
  position: string;
  department: string;
  growthLevel: string;
  roles: UserRole[];
  jobRole: string;
  orgCorporation: string;
  orgDivision: string;
  orgDepartment: string;
  orgTeam: string;
  onLeave: boolean; // 휴직 여부(편집 폼에서 토글). 실제 소속은 org_* 로 보존.
};

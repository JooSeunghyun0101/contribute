import type { Employee } from '@/types';

// 휴직자 식별: 매칭결과가 '휴직'이거나 소속이 '휴직자소속'.
// 휴직자는 평가 대상이 아니므로 조직 조회/대시보드 목록에서 기본 제외한다.
export const ON_LEAVE_MATCHING_RESULT = '휴직';
export const ON_LEAVE_DEPARTMENT = '휴직자소속';

export const isOnLeave = (
  emp: Pick<Employee, 'matching_result' | 'department'> | { matching_result?: string | null; department?: string | null },
): boolean =>
  (emp.matching_result ?? '').trim() === ON_LEAVE_MATCHING_RESULT ||
  (emp.department ?? '').trim() === ON_LEAVE_DEPARTMENT;

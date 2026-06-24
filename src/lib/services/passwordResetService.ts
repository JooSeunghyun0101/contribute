import { apiFetch } from '@/lib/api';

export interface PasswordResetRequest {
  id: string;
  employee_id: string;
  employee_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  review_comment: string | null;
  created_at: string;
}

const jsonPost = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

// 비밀번호 초기화 요청 관리 (HR 전용). 승인/직접초기화는 대상 직원 비밀번호를 사번으로 되돌린다.
export const passwordResetService = {
  listRequests: (status: 'pending' | 'all' = 'pending') =>
    apiFetch<PasswordResetRequest[]>(`/api/admin/password-reset-requests?status=${status}`),

  approve: (id: string) =>
    apiFetch<{ ok: boolean; employee_id: string }>(
      `/api/admin/password-reset-requests/${id}/approve`,
      jsonPost(),
    ),

  reject: (id: string, comment?: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/admin/password-reset-requests/${id}/reject`,
      jsonPost({ comment }),
    ),

  // HR 직접 초기화 (요청 없이 즉시).
  directReset: (employeeId: string) =>
    apiFetch<{ ok: boolean; employee_id: string }>(
      `/api/admin/password-reset/${encodeURIComponent(employeeId)}`,
      jsonPost(),
    ),
};

import { Employee } from '@/types';

export interface AuthSession {
  employee: Employee;
  must_change_password: boolean;
}

const base = import.meta.env.VITE_API_BASE ?? '';

// apiFetch는 실패를 "API ... failed: 401 {...}" 형태로 합쳐 사용자 노출에 부적합 —
// 인증 흐름은 서버가 주는 한국어 error 메시지를 그대로 띄워야 해서 전용 래퍼를 둔다.
const authFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${base}${path}`, { credentials: 'include', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) || `요청에 실패했습니다. (${response.status})`;
    throw new Error(message);
  }
  return data as T;
};

const jsonInit = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const authService = {
  login: (employeeId: string, password: string) =>
    authFetch<AuthSession>('/api/auth/login', jsonInit({ employee_id: employeeId, password })),

  me: () => authFetch<AuthSession>('/api/auth/me'),

  logout: () => authFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    authFetch<{ ok: boolean }>(
      '/api/auth/change-password',
      jsonInit({ current_password: currentPassword, new_password: newPassword }),
    ),
};

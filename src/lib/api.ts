/**
 * Simple wrapper for fetch calls to the backend API.
 * Vite exposes variables prefixed with VITE_ to the client.
 */

/** API 오류 — 상태코드를 보존해 errorHandler 가 401/403/404/500 을 정확히 분류하도록 한다. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    let message = '';
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.error === 'string') message = parsed.error;
    } catch {
      /* body 가 JSON 이 아니면 무시 */
    }
    super(message || `요청에 실패했습니다. (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

// 현재 활성 역할(role switch 결과) — AuthProvider 가 갱신. 서버가 'HR이지만 평가자 모드' 를
// 구분(KPI 가시성 등)하도록 모든 요청에 X-Active-Role 로 동봉한다. 신원이 아니라 'UX 모드' 힌트라,
// 서버는 available_roles 와 교차검증해 권한 상향에는 쓰지 않는다(자기 권한 축소에만).
let activeRole: string | null = null;
export const setActiveRole = (role: string | null): void => {
  activeRole = role;
};

// 세션 만료(401)로 로그인 화면에 튕겨온 것을 Login 이 1회성 안내로 알리기 위한 sessionStorage 키.
// AuthProvider 의 unauthorized 핸들러가 기록하고, Login 이 마운트 시 읽은 뒤 즉시 제거한다.
// (사용자가 직접 로그아웃한 경로에서는 기록하지 않는다 — AuthContext 참조.)
export const SESSION_EXPIRED_STORAGE_KEY = 'session-expired';

// 세션 만료(401) 전역 처리기 — AuthProvider 가 등록해 사용자 상태를 비우고 로그인 화면으로 보낸다.
// (인증 부팅 프로브 authService.me 는 별도 authFetch 라 여기서 트리거되지 않는다.)
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null): void => {
  onUnauthorized = fn;
};

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const base = import.meta.env.VITE_API_BASE ?? '';
  const response = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...init,
    // CSRF 방어: 모든 요청에 커스텀 헤더 부착(서버가 상태변경 요청에서 검사).
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(activeRole ? { 'X-Active-Role': activeRole } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) {
      // 세션 만료/무효 — 클라이언트 상태를 비우고 재로그인 유도.
      try {
        onUnauthorized?.();
      } catch {
        /* noop */
      }
    }
    throw new ApiRequestError(response.status, text);
  }

  return (await response.json()) as T;
};
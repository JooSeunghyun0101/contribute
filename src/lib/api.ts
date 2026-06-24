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
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(init?.headers as Record<string, string> | undefined) },
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
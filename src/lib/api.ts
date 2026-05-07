/**
 * Simple wrapper for fetch calls to the backend API.
 * Vite exposes variables prefixed with VITE_ to the client.
 */
export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const base = import.meta.env.VITE_API_BASE ?? '';
  const response = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
};
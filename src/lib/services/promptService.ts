export class PromptService {
  private static cache = new Map<string, string>();

  /** Retrieve a prompt by its unique key. Caches the result for subsequent calls. */
  static async get(key: string): Promise<string> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const response = await fetch(`/api/prompt/${encodeURIComponent(key)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch prompt "${key}": ${response.status}`);
    }
    const data = await response.json();
    const content = data.content as string;
    this.cache.set(key, content);
    return content;
  }

  /** Invalidate a cached prompt (e.g., after an admin edit). */
  static invalidate(key: string) {
    this.cache.delete(key);
  }
}
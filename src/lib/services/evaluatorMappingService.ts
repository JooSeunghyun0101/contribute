import { EvaluatorMapping } from '@/types/evaluatorManagement';

/**
 * Base URL for API requests.
 * Uses the VITE_API_BASE environment variable if defined, otherwise defaults to localhost:5000.
 */
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

/**
 * Fetch evaluator‑evaluatee mappings from the backend.
 * Returns an array of {@link EvaluatorMapping}.
 *
 * @throws Will throw an error if the network request fails or the response is not ok.
 */
export const getEvaluatorMappings = async (): Promise<EvaluatorMapping[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/evaluator-mappings`);
    if (!response.ok) {
      throw new Error(`Failed to fetch evaluator mappings: ${response.status}`);
    }
    const data: EvaluatorMapping[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error in getEvaluatorMappings:', error);
    throw error;
  }
};
/**
 * POST evaluator‑evaluatee mappings to the backend (used for migration from localStorage).
 *
 * @param mappings - Array of {@link EvaluatorMapping} to be saved.
 */
export const postEvaluatorMappings = async (mappings: EvaluatorMapping[]): Promise<void> => {
  try {
    const response = await fetch(`${API_BASE}/api/evaluator-mappings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mappings),
    });
    if (!response.ok) {
      throw new Error(`Failed to post evaluator mappings: ${response.status}`);
    }
  } catch (error) {
    console.error('Error in postEvaluatorMappings:', error);
    throw error;
  }
};
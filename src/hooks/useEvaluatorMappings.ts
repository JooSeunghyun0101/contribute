import { useState, useEffect } from 'react';
import { EvaluatorMapping } from '@/types/evaluatorManagement';
import { getEvaluatorMappings } from '@/lib/services/evaluatorMappingService';

/**
 * Hook to load evaluator‑evaluatee mappings from the backend.
 *
 * @returns {{
 *   mappings: EvaluatorMapping[] | null;
 *   isLoading: boolean;
 *   error: string | null;
 * }} Current fetch state.
 */
export const useEvaluatorMappings = () => {
  const [mappings, setMappings] = useState<EvaluatorMapping[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getEvaluatorMappings();
        setMappings(data);
      } catch (err) {
        setError((err as Error).message || '알 수 없는 오류');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  return { mappings, isLoading, error };
};
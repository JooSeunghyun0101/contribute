export const MATRIX_METHODS = ['총괄', '리딩', '실무', '지원'] as const;
export const MATRIX_SCOPES = ['의존적', '독립적', '상호적', '전략적'] as const;

export type MatrixMethod = (typeof MATRIX_METHODS)[number];
export type MatrixScope = (typeof MATRIX_SCOPES)[number];

export const MATRIX_SCORES: readonly (readonly number[])[] = [
  [2, 3, 4, 4],
  [1, 2, 3, 4],
  [1, 1, 2, 3],
  [1, 1, 1, 2],
] as const;

export type EvaluationMatrixScores = number[][];

export const EVALUATION_MATRIX_SETTING_TYPE = 'evaluation_matrix';
export const COMPANY_MATRIX_SETTING_USER_ID = 'company';

export const cloneDefaultMatrix = (): EvaluationMatrixScores =>
  MATRIX_SCORES.map((row) => [...row]);

export const normalizeEvaluationMatrix = (
  value: unknown,
): EvaluationMatrixScores | null => {
  if (!Array.isArray(value) || value.length !== MATRIX_SCORES.length) return null;

  const normalized = value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== MATRIX_SCORES[rowIndex].length) return null;

    return row.map((cell, cellIndex) => {
      const numeric = Number(cell);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 4) {
        return MATRIX_SCORES[rowIndex][cellIndex];
      }
      return Math.round(numeric);
    });
  });

  if (normalized.some((row) => row === null)) return null;
  return normalized as EvaluationMatrixScores;
};

export const MATRIX_SCORE_COLORS: Record<number, string> = {
  4: '#F55000',
  3: '#D94400',
  2: '#FFAA00',
  1: '#C2BAB0',
};

export const getMatrixMethodIndex = (method?: string | null) => {
  const value = (method ?? '').trim();
  if (!value || value === '기여없음') return -1;
  if (value.includes('총괄') || value.includes('주도')) return 0;
  if (value.includes('리딩')) return 1;
  if (value.includes('실무') || value.includes('협업')) return 2;
  if (value.includes('지원')) return 3;
  return -1;
};

export const getMatrixScopeIndex = (scope?: string | null) => {
  const value = (scope ?? '').trim();
  if (!value || value === '기여없음') return -1;
  if (value.includes('의존') || value.includes('개인')) return 0;
  if (value.includes('독립') || value.includes('팀')) return 1;
  if (value.includes('상호') || value.includes('본부')) return 2;
  if (value.includes('전략') || value.includes('전사') || value.includes('그룹')) return 3;
  return -1;
};

export const getMatrixScore = (
  method?: string | null,
  scope?: string | null,
  matrix: EvaluationMatrixScores | readonly (readonly number[])[] = MATRIX_SCORES,
) => {
  if (method === '기여없음' && scope === '기여없음') return 0;

  const methodIndex = getMatrixMethodIndex(method);
  const scopeIndex = getMatrixScopeIndex(scope);
  if (methodIndex < 0 || scopeIndex < 0) return null;

  return matrix[methodIndex]?.[scopeIndex] ?? MATRIX_SCORES[methodIndex][scopeIndex];
};

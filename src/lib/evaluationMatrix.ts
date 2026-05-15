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

// 점수별 색상 — 브랜드 4-hue 스케일.
// 인접 점수의 색상(hue)을 모두 다르게 두어 가시성을 확보하고,
// 점수가 높을수록 더 진하고 무겁게(명도↓·채도↑) 보이도록 단조 배치한다.
//   4점 진한 오렌지레드 → 3점 골든 앰버 → 2점 라이트 머스터드 → 1점 웜 그레이
export const MATRIX_SCORE_COLORS: Record<number, string> = {
  4: '#E84200',
  3: '#F59E00',
  2: '#C99A4E',
  1: '#BBB1A4',
};

// 미평가 / 기여없음(0점) 과업에 쓰는 중립 색상.
// 1점 색(#BBB1A4)보다 한 단계 더 옅게 두어 "아직 점수 없음"을 구분한다.
export const SCORE_COLOR_UNRATED = '#EAE6DF';

// 점수별 배경 위에 올라가는 텍스트 색상.
// 4점만 어두운 배경(흰 글씨), 3점 이하는 밝은 배경이라 어두운 글씨로 대비를 확보한다.
export const MATRIX_SCORE_TEXT_COLORS: Record<number, string> = {
  4: '#FFFFFF',
  3: '#4A1A00',
  2: '#4A1A00',
  1: '#4A3B33',
};
export const SCORE_TEXT_COLOR_UNRATED = '#78716C';

// 점수(1~4) → 배경 색상. 미평가/0점/범위 밖은 중립 색상으로 폴백.
// 대시보드·간트·일정 등 과업을 색으로 표현하는 모든 곳에서 이 함수를 써서
// 점수별 색상 체계와 일관성을 맞춘다.
export const getScoreColor = (score?: number | null): string => {
  if (score == null || score <= 0) return SCORE_COLOR_UNRATED;
  return MATRIX_SCORE_COLORS[score] ?? SCORE_COLOR_UNRATED;
};

// 점수(1~4) → 위 배경에 어울리는 텍스트 색상. 미평가/0점은 중립 텍스트색.
export const getScoreTextColor = (score?: number | null): string => {
  if (score == null || score <= 0) return SCORE_TEXT_COLOR_UNRATED;
  return MATRIX_SCORE_TEXT_COLORS[score] ?? SCORE_TEXT_COLOR_UNRATED;
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

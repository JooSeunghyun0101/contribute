export const MATRIX_METHODS = ['총괄', '리딩', '실무', '지원'] as const;
export const MATRIX_SCOPES = ['의존적', '독립적', '상호적', '전략적'] as const;

// 기여 방식·범위 가이드 — 매트릭스 가이드 표시 및 점수표(MatrixGrid) 라벨 hover 툴팁에 사용.
export const MATRIX_METHOD_GUIDE: Record<string, string> = {
  총괄: '프로젝트나 업무를 전체적으로 주도하고 관리',
  리딩: '팀이나 그룹을 이끌며 방향성 제시',
  실무: '구체적인 업무 실행과 결과물 생성',
  지원: '다른 업무나 팀을 보조하고 지원',
};
export const MATRIX_SCOPE_GUIDE: Record<string, string> = {
  의존적: '다른 사람의 도움이나 지시가 필요한 수준',
  독립적: '혼자서 업무를 완수할 수 있는 수준',
  상호적: '타 부서나 팀과 협력하여 진행하는 수준',
  전략적: '조직 전체에 영향을 미치는 전략적 수준',
};

// 편집 가능한 매트릭스 가이드(기여 방식·범위 설명).
export const MATRIX_GUIDE_SETTING_TYPE = 'matrix_guide';
export type MatrixGuide = { methods: Record<string, string>; scopes: Record<string, string> };
export const cloneDefaultMatrixGuide = (): MatrixGuide => ({
  methods: { ...MATRIX_METHOD_GUIDE },
  scopes: { ...MATRIX_SCOPE_GUIDE },
});
export const normalizeMatrixGuide = (value: unknown): MatrixGuide | null => {
  if (!value || typeof value !== 'object') return null;
  const obj = value as { methods?: Record<string, unknown>; scopes?: Record<string, unknown> };
  const base = cloneDefaultMatrixGuide();
  for (const k of MATRIX_METHODS) {
    const v = obj.methods?.[k];
    if (typeof v === 'string') base.methods[k] = v;
  }
  for (const k of MATRIX_SCOPES) {
    const v = obj.scopes?.[k];
    if (typeof v === 'string') base.scopes[k] = v;
  }
  return base;
};

export type MatrixMethod = (typeof MATRIX_METHODS)[number];
export type MatrixScope = (typeof MATRIX_SCOPES)[number];

export const MATRIX_SCORES: readonly (readonly number[])[] = [
  [2, 3, 4, 4],
  [1, 2, 3, 4],
  [1, 1, 2, 3],
  [1, 1, 1, 2],
] as const;

export type EvaluationMatrixScores = number[][];
export type ContributionScoreLevel = 1 | 2 | 3 | 4;
export type GrowthLevel = 1 | 2 | 3 | 4;

export type ScoreExpectation = {
  score: ContributionScoreLevel;
  label: string;
  summary: string;
  detail: string;
};

export const CONTRIBUTION_SCORE_EXPECTATIONS: Record<ContributionScoreLevel, ScoreExpectation> = {
  4: {
    score: 4,
    label: '탁월 기여',
    summary: '성장레벨 기대수준을 명확히 초과',
    detail: '과업을 주도하거나 총괄하고, 성과가 팀을 넘어 조직 성과나 의사결정에 뚜렷하게 연결된 경우입니다.',
  },
  3: {
    score: 3,
    label: '우수 기여',
    summary: '성장레벨 기대수준 충족',
    detail: '맡은 역할을 독립적으로 완수하고, 기한과 품질을 안정적으로 지키며 팀 목표 달성에 실질적으로 기여한 경우입니다.',
  },
  2: {
    score: 2,
    label: '기본 기여',
    summary: '기대수준에 근접하나 일부 보완 필요',
    detail: '주요 결과는 만들었지만 독립성, 완성도, 범위 확장, 일정 준수 중 일부에서 추가 보완이 필요한 경우입니다.',
  },
  1: {
    score: 1,
    label: '제한적 기여',
    summary: '기대수준 미달성',
    detail: '지원이나 지시 수행에 머물렀거나, 결과 품질과 기한 준수 측면에서 성장레벨 대비 기대에 충분히 미치지 못한 경우입니다.',
  },
};

export type GrowthLevelExpectation = {
  level: number;
  title: string;
  minimumExpectation: string;
  stretchExpectation: string;
};

export const GROWTH_LEVEL_EXPECTATIONS: Record<GrowthLevel, GrowthLevelExpectation> = {
  1: {
    level: 1,
    title: 'Lv.1 사원',
    minimumExpectation: '지시된 운영, 보고, 자료정리 업무를 정확히 수행하고 기본 기준과 절차를 이해해 기한 내 안정적으로 완수합니다.',
    stretchExpectation: '반복 업무 개선 아이디어를 제안하거나 자료 품질과 정확도를 높이면 높은 기여로 볼 수 있습니다.',
  },
  2: {
    level: 2,
    title: 'Lv.2 대리',
    minimumExpectation: '담당 영역의 보고와 운영 업무를 독립적으로 수행하고, 이슈를 정리해 실무적 대안을 제시합니다.',
    stretchExpectation: '팀 공통 양식 정비, 보고서와 회의체 운영 효율화, 후배 업무 지원까지 확장하면 높은 기여로 볼 수 있습니다.',
  },
  3: {
    level: 3,
    title: 'Lv.3 차장',
    minimumExpectation: '팀 단위 프로세스 개선을 주도하고, 복수 이해관계자를 조율하며 기준과 운영체계를 정비합니다.',
    stretchExpectation: '부서 단위 생산성 향상, 제도와 프로세스 개선 실행, 후배 코칭과 표준화 주도까지 이어지면 높은 기여로 볼 수 있습니다.',
  },
  4: {
    level: 4,
    title: 'Lv.4 부장',
    minimumExpectation: '부서 목표를 책임지고 핵심 운영체계를 설계하며 경영진 의사결정 지원 체계를 구축합니다.',
    stretchExpectation: '전사 차원의 운영혁신, 그룹 공통 기준 수립, 조직 간 협업 구조 개선을 주도하면 높은 기여로 볼 수 있습니다.',
  },
};

export const getScoreExpectation = (score?: number | null): ScoreExpectation | null => {
  const normalized = Math.round(Number(score));
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 4) return null;
  return CONTRIBUTION_SCORE_EXPECTATIONS[normalized as ContributionScoreLevel];
};

// 점수 - 성장레벨 갭에 따른 상대적 평가 결과 (성장레벨이 다르면 같은 점수도 다른 의미).
export type ScoreGapBucket = 'exceed' | 'meet' | 'near' | 'below';

export type ScoreGapExpectation = {
  bucket: ScoreGapBucket;
  label: string;
  summary: string;
  detail: string;
};

export const SCORE_GAP_EXPECTATIONS: Record<ScoreGapBucket, ScoreGapExpectation> = {
  exceed: {
    bucket: 'exceed',
    label: '탁월 기여',
    summary: '성장레벨 기대수준을 명확히 초과',
    detail:
      '본인 성장레벨에서 기대되는 수준을 뛰어넘는 기여입니다. 다음 단계 역할로의 성장 가능성을 보입니다.',
  },
  meet: {
    bucket: 'meet',
    label: '기준 충족',
    summary: '성장레벨 기대수준 충족',
    detail:
      '본인 성장레벨에서 기대되는 책임과 성과를 안정적으로 수행한 수준입니다.',
  },
  near: {
    bucket: 'near',
    label: '보완 필요',
    summary: '기대수준에 근접하나 일부 보완 필요',
    detail:
      '주요 결과는 만들었지만 본인 성장레벨에서 요구되는 독립성·완성도·범위 측면에서 보완이 필요합니다.',
  },
  below: {
    bucket: 'below',
    label: '미달성',
    summary: '성장레벨 기대수준 미달성',
    detail:
      '본인 성장레벨에서 기대되는 수준에 미치지 못한 결과입니다. 책임 범위와 산출물 품질을 점검할 필요가 있습니다.',
  },
};

export const getScoreGapBucket = (score: number, growthLevel: number): ScoreGapBucket => {
  const gap = Math.round(score) - Math.round(growthLevel);
  if (gap >= 1) return 'exceed';
  if (gap === 0) return 'meet';
  if (gap === -1) return 'near';
  return 'below';
};

export const SCORE_GAP_EXPECTATIONS_SETTING_TYPE = 'contribution_score_gap_expectations';

export const cloneDefaultScoreGapExpectations = (): Record<ScoreGapBucket, ScoreGapExpectation> => ({
  exceed: { ...SCORE_GAP_EXPECTATIONS.exceed },
  meet: { ...SCORE_GAP_EXPECTATIONS.meet },
  near: { ...SCORE_GAP_EXPECTATIONS.near },
  below: { ...SCORE_GAP_EXPECTATIONS.below },
});

export const normalizeScoreGapExpectations = (
  value: unknown,
): Record<ScoreGapBucket, ScoreGapExpectation> | null => {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const out = {} as Record<ScoreGapBucket, ScoreGapExpectation>;
  for (const bucket of ['exceed', 'meet', 'near', 'below'] as ScoreGapBucket[]) {
    const raw = obj[bucket] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const { label, summary, detail } = raw;
    if (typeof label !== 'string' || typeof summary !== 'string' || typeof detail !== 'string') {
      return null;
    }
    out[bucket] = { bucket, label, summary, detail };
  }
  return out;
};

export const getGrowthLevelExpectation = (level?: number | null): GrowthLevelExpectation => {
  const normalized = Math.round(Number(level));
  if (Number.isFinite(normalized) && normalized >= 1 && normalized <= 4) {
    return GROWTH_LEVEL_EXPECTATIONS[normalized as GrowthLevel];
  }

  const fallbackLevel = Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
  return {
    level: fallbackLevel,
    title: `Lv.${fallbackLevel}`,
    minimumExpectation: '해당 레벨의 상세 기대수준은 HR 기준표를 확인해야 합니다.',
    stretchExpectation: '현재 시스템에는 Lv.1~4 기준만 등록되어 있습니다.',
  };
};

export const EVALUATION_MATRIX_SETTING_TYPE = 'evaluation_matrix';
export const SCORE_EXPECTATIONS_SETTING_TYPE = 'contribution_score_expectations';
export const GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE = 'growth_level_expectations';
// 전사 공통 기준표의 공유 user_id. 서버 settings 가드는 'system'만 전 직원 읽기를
// 허용하고(쓰기는 HR), 그 외 user_id는 본인/HR 전용이라 다른 값이면 비HR 읽기가 403이 된다.
export const COMPANY_MATRIX_SETTING_USER_ID = 'system';

export const cloneDefaultScoreExpectations = (): Record<ContributionScoreLevel, ScoreExpectation> => ({
  4: { ...CONTRIBUTION_SCORE_EXPECTATIONS[4] },
  3: { ...CONTRIBUTION_SCORE_EXPECTATIONS[3] },
  2: { ...CONTRIBUTION_SCORE_EXPECTATIONS[2] },
  1: { ...CONTRIBUTION_SCORE_EXPECTATIONS[1] },
});

export const cloneDefaultGrowthLevelExpectations = (): Record<GrowthLevel, GrowthLevelExpectation> => ({
  1: { ...GROWTH_LEVEL_EXPECTATIONS[1] },
  2: { ...GROWTH_LEVEL_EXPECTATIONS[2] },
  3: { ...GROWTH_LEVEL_EXPECTATIONS[3] },
  4: { ...GROWTH_LEVEL_EXPECTATIONS[4] },
});

export const normalizeScoreExpectations = (
  value: unknown,
): Record<ContributionScoreLevel, ScoreExpectation> | null => {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const out = {} as Record<ContributionScoreLevel, ScoreExpectation>;
  for (const lv of [1, 2, 3, 4] as ContributionScoreLevel[]) {
    const raw = (obj[String(lv)] ?? obj[lv]) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const label = raw.label;
    const summary = raw.summary;
    const detail = raw.detail;
    if (typeof label !== 'string' || typeof summary !== 'string' || typeof detail !== 'string') {
      return null;
    }
    out[lv] = { score: lv, label, summary, detail };
  }
  return out;
};

export const normalizeGrowthLevelExpectations = (
  value: unknown,
): Record<GrowthLevel, GrowthLevelExpectation> | null => {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const out = {} as Record<GrowthLevel, GrowthLevelExpectation>;
  for (const lv of [1, 2, 3, 4] as GrowthLevel[]) {
    const raw = (obj[String(lv)] ?? obj[lv]) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const title = raw.title;
    const minimumExpectation = raw.minimumExpectation;
    const stretchExpectation = raw.stretchExpectation;
    if (
      typeof title !== 'string' ||
      typeof minimumExpectation !== 'string' ||
      typeof stretchExpectation !== 'string'
    ) {
      return null;
    }
    out[lv] = { level: lv, title, minimumExpectation, stretchExpectation };
  }
  return out;
};

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
// 미평가/0점 — 다크/라이트 양쪽 가독성 위해 CSS 변수 사용 (index.css에 모드별 매핑)
export const SCORE_COLOR_UNRATED = 'var(--score-unrated-bg)';

// 점수별 배경 위에 올라가는 텍스트 색상.
// 4점만 어두운 배경(흰 글씨), 3점 이하는 밝은 배경이라 어두운 글씨로 대비를 확보한다.
export const MATRIX_SCORE_TEXT_COLORS: Record<number, string> = {
  4: '#FFFFFF',
  3: '#4A1A00',
  2: '#4A1A00',
  1: '#4A3B33',
};
export const SCORE_TEXT_COLOR_UNRATED = 'var(--score-unrated-fg)';

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

// 점수 표시 — 소수점 둘째 자리에서 내림 처리.
// flooredScore(절사 정수)와의 일관성 유지: 2.99는 "2.9"로 표시되어
// 미달성인데 반올림으로 "3.0" 처럼 보여 달성으로 오해되지 않도록 한다.
export const floorScoreTenths = (score: number): number => Math.floor(score * 10) / 10;
export const formatScore = (score: number): string => floorScoreTenths(score).toFixed(1);

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

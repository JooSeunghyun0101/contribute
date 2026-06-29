export const MATRIX_METHODS = ['총괄', '리딩', '실무', '지원'] as const;
export const MATRIX_SCOPES = ['의존적', '독립적', '상호적', '전략적'] as const;

// 기여 방식·범위 가이드 — 매트릭스 가이드 표시 및 점수표(MatrixGrid) 라벨 hover 툴팁에 사용.
export const MATRIX_METHOD_GUIDE: Record<string, string> = {
  총괄: '과제와 목표의 최종 오너로서 방향과 자원 배분을 결정하고 성과에 대해 전적으로 책임집니다.',
  리딩: '단위 과제의 실행 리더로서 설계·일정·이슈 해결을 주도하며 의사결정을 적극 견인합니다.',
  실무: '핵심 산출물을 직접 생산·수행하며 본인 담당 영역의 품질·기한·정확도를 책임집니다.',
  지원: '실행을 가능하게 하는 조율·운영·보조를 수행하며 성과에 실질적인 지원 기능을 제공합니다.',
};
export const MATRIX_SCOPE_GUIDE: Record<string, string> = {
  의존적: '상급자의 구체적인 지시와 가이드 하에 정해진 절차와 방식에 따라 과업을 수행합니다.',
  독립적: '상급자의 세부 가이드 없이도 본인의 판단에 따라 과업을 완수하며 자기주도적으로 업무합니다.',
  상호적: '유관 부서 및 동료와 긴밀히 협업하여 시너지를 창출하고 공동의 목표 달성을 위해 소통합니다.',
  전략적: '전사적 관점에서 과업의 가치를 창출하며 미래 방향성을 제시하고 조직의 핵심 이익에 기여합니다.',
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

// 실제 운영 매트릭스(25년 기여도 실데이터에서 100% 결정적으로 도출).
// 행=기여방식(총괄/리딩/실무/지원), 열=기여범위(의존적/독립적/상호적/전략적).
export const MATRIX_SCORES: readonly (readonly number[])[] = [
  [2, 3, 4, 4], // 총괄
  [2, 3, 3, 4], // 리딩
  [1, 2, 3, 3], // 실무
  [1, 1, 2, 2], // 지원
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

// 점수별 색상 — 전 화면 공통 단계 팔레트(단일 소스). 값은 index.css의 --score-*-bg/fg.
// 채도를 낮추되 인접 단계가 명도(밝다↔어둡다)로 교차해 한눈에 구분되게 배치했고,
// CSS 변수라 라이트/다크 모드가 자동 매핑된다. 색 종류를 한정하기 위해 모든 화면이 이 값만 쓴다.
//   4 진한 테라코타 ↔ 3 골드 앰버 ↔ 2 탄 브라운 ↔ 1 웜 그레이
export const MATRIX_SCORE_COLORS: Record<number, string> = {
  4: 'var(--score-4-bg)',
  3: 'var(--score-3-bg)',
  2: 'var(--score-2-bg)',
  1: 'var(--score-1-bg)',
};

// 미평가 / 기여미흡(0점) 과업에 쓰는 중립 색상.
// 1점 색(#BBB1A4)보다 한 단계 더 옅게 두어 "아직 점수 없음"을 구분한다.
// 미평가/0점 — 다크/라이트 양쪽 가독성 위해 CSS 변수 사용 (index.css에 모드별 매핑)
export const SCORE_COLOR_UNRATED = 'var(--score-unrated-bg)';

// 점수별 배경 위에 올라가는 텍스트 색상(단계 팔레트와 한 쌍, index.css의 --score-*-fg).
// 4점만 어두운 배경(흰 글씨), 2·3·1점은 밝은 배경(어두운 글씨)으로 대비를 맞춘다.
export const MATRIX_SCORE_TEXT_COLORS: Record<number, string> = {
  4: 'var(--score-4-fg)',
  3: 'var(--score-3-fg)',
  2: 'var(--score-2-fg)',
  1: 'var(--score-1-fg)',
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

// 점수 단계 팔레트 접근자(별칭). 이제 전 화면이 동일 팔레트(getScoreColor/getScoreTextColor)를
// 쓰므로 틴트=솔리드로 통합되었다. 직원 화면에서 먼저 도입한 이름이라 호환을 위해 유지한다.
export const getScoreTintBg = (score?: number | null): string => getScoreColor(score);
export const getScoreTintFg = (score?: number | null): string => getScoreTextColor(score);

// 점수 표시 — 소수점 둘째 자리에서 내림 처리.
// flooredScore(절사 정수)와의 일관성 유지: 2.99는 "2.9"로 표시되어
// 미달성인데 반올림으로 "3.0" 처럼 보여 달성으로 오해되지 않도록 한다.
export const floorScoreTenths = (score: number): number => Math.floor(score * 10) / 10;
export const formatScore = (score: number): string => floorScoreTenths(score).toFixed(1);

export const getMatrixMethodIndex = (method?: string | null) => {
  const value = (method ?? '').trim();
  if (!value || value === '기여미흡') return -1;
  if (value.includes('총괄') || value.includes('주도')) return 0;
  if (value.includes('리딩')) return 1;
  if (value.includes('실무') || value.includes('협업')) return 2;
  if (value.includes('지원')) return 3;
  return -1;
};

export const getMatrixScopeIndex = (scope?: string | null) => {
  const value = (scope ?? '').trim();
  if (!value || value === '기여미흡') return -1;
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
  if (method === '기여미흡' && scope === '기여미흡') return 0;

  const methodIndex = getMatrixMethodIndex(method);
  const scopeIndex = getMatrixScopeIndex(scope);
  if (methodIndex < 0 || scopeIndex < 0) return null;

  return matrix[methodIndex]?.[scopeIndex] ?? MATRIX_SCORES[methodIndex][scopeIndex];
};

export type MatrixCriteriaInput = {
  matrix?: EvaluationMatrixScores | readonly (readonly number[])[];
  guide?: MatrixGuide;
  growth?: Record<GrowthLevel, GrowthLevelExpectation>;
  gap?: Record<ScoreGapBucket, ScoreGapExpectation>;
};

const GAP_PROMPT_LABEL: Record<ScoreGapBucket, string> = {
  exceed: '초과(점수>성장레벨)',
  meet: '충족(점수=성장레벨)',
  near: '근접(성장레벨 -1)',
  below: '미달(성장레벨 -2 이하)',
};

// /hr/matrix(평가 매트릭스 설정)에서 관리하는 모든 기준을 AI 프롬프트용 텍스트로 변환한다.
// 기여 방식·범위 정의 + 점수 매트릭스 + 성장레벨별 기대수준 + 점수-성장레벨 갭별 해석.
// 이 설정들이 단일 원천이며, 여기서 생성해 평가 기준 문서(evaluation_guide)에 합성한다.
// → HR이 /hr/matrix 에서 무엇을 바꾸든 AI 기능이 항상 최신 기준으로 답한다(하드코딩·중복 제거).
export const formatMatrixCriteria = ({
  matrix = MATRIX_SCORES,
  guide = cloneDefaultMatrixGuide(),
  growth = GROWTH_LEVEL_EXPECTATIONS,
  gap = SCORE_GAP_EXPECTATIONS,
}: MatrixCriteriaInput = {}): string => {
  const methodDefs = MATRIX_METHODS.map((m) => `- ${m}: ${guide.methods[m] ?? ''}`).join('\n');
  const scopeDefs = MATRIX_SCOPES.map((s) => `- ${s}: ${guide.scopes[s] ?? ''}`).join('\n');
  const matrixRows = MATRIX_METHODS.map((method, mi) => {
    const cells = MATRIX_SCOPES.map(
      (scope, si) => `${scope}(${matrix[mi]?.[si] ?? MATRIX_SCORES[mi][si]}점)`,
    ).join(', ');
    return `- ${method}: ${cells}`;
  }).join('\n');
  const growthLines = ([1, 2, 3, 4] as GrowthLevel[])
    .map((lv) => {
      const g = growth[lv];
      return `- ${g.title}: (최소 기대) ${g.minimumExpectation} / (높은 기여) ${g.stretchExpectation}`;
    })
    .join('\n');
  const gapLines = (['exceed', 'meet', 'near', 'below'] as ScoreGapBucket[])
    .map((b) => `- ${GAP_PROMPT_LABEL[b]}: ${gap[b].label} — ${gap[b].summary}. ${gap[b].detail}`)
    .join('\n');

  return [
    `**기여 방식 정의:**\n${methodDefs}`,
    `**기여 범위 정의:**\n${scopeDefs}`,
    `**점수 매트릭스:** (행=기여방식, 열=기여범위 의존적→전략적)\n${matrixRows}`,
    `**성장레벨별 기대수준:**\n${growthLines}`,
    `**점수-성장레벨 갭별 해석:** (피평가자 성장레벨 대비 점수 차이)\n${gapLines}`,
  ].join('\n\n');
};

// 개인별(또는 과업 집합) 월별 평가 점수/달성률 추이 집계.
//
// 데이터 모델상 과업 점수는 "확정 시점" 값 한 개만 보존되므로(시계열 스냅샷 없음),
// 각 과업이 "점수를 받은 시점"을 feedbackHistory 의 가장 이른 날짜로 보고,
// 그 달부터 누적 가중 점수에 반영한다. 결과 곡선의 마지막 값은
// dashboardData.weightedScore( = Σ score×weight/100 )와 일치한다.

export interface TrendTaskInput {
  score: number | null;
  weight: number | null;
  /** 피드백 이력(점수 부여 시점 신호). 가장 이른 날짜를 점수 부여 월로 본다. */
  feedbackHistory?: Array<{ date: string }>;
  /** feedbackHistory 가 없을 때의 폴백 점수 시점(예: tasks.feedback_date). */
  feedbackDate?: string | null;
}

export interface MonthlyScorePoint {
  monthIndex: number; // 0=1월
  label: string;
  /** 해당 월까지 누적 가중 점수. 미래 월은 null. */
  cumulativeScore: number | null;
  /** 누적 점수 / 목표 레벨 × 100 (%). 목표 레벨이 없으면 null. */
  achievement: number | null;
  /** 해당 월까지 점수가 입력된 과업 수. */
  scoredCount: number;
}

export const TREND_MONTH_LABELS = [
  '1월', '2월', '3월', '4월', '5월', '6월',
  '7월', '8월', '9월', '10월', '11월', '12월',
];

const isScored = (t: TrendTaskInput) => t.score !== null && t.score !== undefined;

/** 점수가 입력된 과업이 하나라도 있는지 — 빈 상태 판단용. */
export const hasTrendData = (tasks: TrendTaskInput[]): boolean => tasks.some(isScored);

export interface BuildTrendOptions {
  /** 추이를 그릴 연도. 기본값: referenceDate 의 연도. */
  year?: number;
  /** "현재" 기준 시각. 기본값: new Date(). 미래 월 판정에 사용. */
  referenceDate?: Date;
}

export function buildMonthlyScoreTrend(
  tasks: TrendTaskInput[],
  growthLevel: number,
  options: BuildTrendOptions = {},
): MonthlyScorePoint[] {
  const ref = options.referenceDate ?? new Date();
  const year = options.year ?? ref.getFullYear();
  const isCurrentYear = year === ref.getFullYear();
  const isPastYear = year < ref.getFullYear();
  // 과거 연도면 12월까지, 올해면 현재 월까지, 미래 연도면 표시 안 함.
  const lastMonth = isPastYear ? 11 : isCurrentYear ? ref.getMonth() : -1;

  // 각 점수 과업의 (기여점수, 점수를 받은 월) 산출.
  const contributions = tasks.filter(isScored).map((t) => {
    const weight = Number(t.weight) || 0;
    const score = Number(t.score) || 0;
    const contribution = score * (weight / 100);

    const candidateDates = [
      ...(t.feedbackHistory ?? []).map((f) => f.date),
      ...(t.feedbackDate ? [t.feedbackDate] : []),
    ];
    const monthsInYear = candidateDates
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()) && d.getFullYear() === year)
      .map((d) => d.getMonth())
      .sort((a, b) => a - b);

    // 점수를 처음 받은 달. 해당 연도 피드백 날짜가 없으면 마지막 표시 월에 귀속.
    const scoredMonth = monthsInYear.length > 0
      ? monthsInYear[0]
      : Math.max(0, lastMonth);

    return { contribution, scoredMonth };
  });

  return TREND_MONTH_LABELS.map((label, m) => {
    if (lastMonth < 0 || m > lastMonth) {
      return { monthIndex: m, label, cumulativeScore: null, achievement: null, scoredCount: 0 };
    }
    const upto = contributions.filter((c) => c.scoredMonth <= m);
    const cumulative = upto.reduce((sum, c) => sum + c.contribution, 0);
    const achievement = growthLevel > 0 ? (cumulative / growthLevel) * 100 : null;
    return {
      monthIndex: m,
      label,
      cumulativeScore: Number(cumulative.toFixed(2)),
      achievement: achievement === null ? null : Math.round(achievement),
      scoredCount: upto.length,
    };
  });
}

// ── 조직/팀 집계 월별 추이 ─────────────────────────────────────
// 구성원 각자의 월별 누적 점수를 구한 뒤 월별로 집계한다.
// avgScore: 그 달까지 점수가 입력된 구성원들의 누적 점수 평균(품질 추이).
// achievementRate: 전체 대상 대비 누적점수 ≥ 목표레벨 달성 인원 비율.
export interface AggregateTrendMember {
  tasks: TrendTaskInput[];
  growthLevel: number;
}

export interface AggregateMonthlyPoint {
  monthIndex: number;
  label: string;
  avgScore: number | null;
  achievementRate: number | null;
  evaluatedCount: number;
  totalCount: number;
}

export const hasAggregateTrendData = (members: AggregateTrendMember[]): boolean =>
  members.some((m) => hasTrendData(m.tasks));

export function buildAggregateMonthlyTrend(
  members: AggregateTrendMember[],
  options: BuildTrendOptions = {},
): AggregateMonthlyPoint[] {
  const perMember = members.map((m) => buildMonthlyScoreTrend(m.tasks, m.growthLevel, options));
  const total = members.length;

  return TREND_MONTH_LABELS.map((label, mi) => {
    const points = perMember.map((series, i) => ({
      point: series[mi],
      growthLevel: members[i].growthLevel,
    }));
    // 모든 구성원이 미래 월(null)이면 표시 안 함.
    if (points.every((x) => x.point.cumulativeScore === null)) {
      return { monthIndex: mi, label, avgScore: null, achievementRate: null, evaluatedCount: 0, totalCount: total };
    }
    const evaluated = points.filter((x) => x.point.scoredCount > 0);
    const avgScore = evaluated.length
      ? evaluated.reduce((sum, x) => sum + (x.point.cumulativeScore ?? 0), 0) / evaluated.length
      : null;
    const achievedCount = evaluated.filter(
      (x) => x.growthLevel > 0 && Math.floor(x.point.cumulativeScore ?? 0) >= x.growthLevel,
    ).length;
    return {
      monthIndex: mi,
      label,
      avgScore: avgScore === null ? null : Number(avgScore.toFixed(2)),
      achievementRate: total > 0 ? Math.round((achievedCount / total) * 100) : null,
      evaluatedCount: evaluated.length,
      totalCount: total,
    };
  });
}

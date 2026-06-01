import { useExpectations } from '@/contexts/ExpectationContext';
import {
  getGrowthLevelExpectation,
  getScoreExpectation,
  getScoreGapBucket,
  type ContributionScoreLevel,
  type GrowthLevel,
} from '@/lib/evaluationMatrix';

type ScoreExpectationContentProps = {
  score: number;
  method?: string;
  scope?: string;
  growthLevel?: number | null;
};

export const ScoreExpectationContent = ({
  score,
  method,
  scope,
  growthLevel,
}: ScoreExpectationContentProps) => {
  const { scoreExpectations, scoreGapExpectations } = useExpectations();
  const rounded = Math.round(Number(score));

  // 절대 점수 등급명 (탁월/우수/기본/제한적) — 점수 자체 의미
  const baseExpectation =
    rounded >= 1 && rounded <= 4
      ? scoreExpectations[rounded as ContributionScoreLevel]
      : getScoreExpectation(score);

  if (!baseExpectation) {
    return (
      <div className="max-w-[280px] text-sm leading-relaxed">
        점수 기준을 확인할 수 없습니다.
      </div>
    );
  }

  // 성장레벨 정보가 있으면 갭 기반 상대 메시지로 교체
  const normalizedLevel =
    growthLevel != null && Number.isFinite(growthLevel) ? Math.round(Number(growthLevel)) : null;
  const gapExpectation =
    normalizedLevel != null && normalizedLevel >= 1
      ? scoreGapExpectations[getScoreGapBucket(rounded, normalizedLevel)]
      : null;

  const summary = gapExpectation ? gapExpectation.summary : baseExpectation.summary;
  const detail = gapExpectation ? gapExpectation.detail : baseExpectation.detail;

  return (
    <div className="max-w-[320px] text-sm leading-relaxed">
      <div className="font-extrabold text-foreground">
        {baseExpectation.score}점 · {baseExpectation.label}
        {gapExpectation && (
          <span className="ml-2 text-xs font-bold text-primary">
            (Lv.{normalizedLevel} 기준 · {gapExpectation.label})
          </span>
        )}
      </div>
      {method && scope && (
        <div className="mt-1 text-xs font-bold text-muted-foreground">
          {method} × {scope}
        </div>
      )}
      <div className="mt-2 font-bold text-primary">{summary}</div>
      <div className="mt-1 text-muted-foreground">{detail}</div>
    </div>
  );
};

type GrowthLevelExpectationContentProps = {
  level: number;
};

export const GrowthLevelExpectationContent = ({
  level,
}: GrowthLevelExpectationContentProps) => {
  const { growthLevelExpectations } = useExpectations();
  const rounded = Math.round(Number(level));
  const expectation =
    rounded >= 1 && rounded <= 4
      ? growthLevelExpectations[rounded as GrowthLevel]
      : getGrowthLevelExpectation(level);

  return (
    <div className="max-w-[340px] text-sm leading-relaxed">
      <div className="font-extrabold text-foreground">{expectation.title} 기대수준</div>
      <div className="mt-2">
        <div className="text-xs font-bold text-muted-foreground">레벨별 최소 기대</div>
        <div className="mt-1 text-foreground">{expectation.minimumExpectation}</div>
      </div>
      <div className="mt-3">
        <div className="text-xs font-bold text-muted-foreground">높은 기여 판단 포인트</div>
        <div className="mt-1 text-foreground">{expectation.stretchExpectation}</div>
      </div>
    </div>
  );
};

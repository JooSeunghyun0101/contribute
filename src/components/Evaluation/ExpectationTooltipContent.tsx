import { useExpectations } from '@/contexts/ExpectationContext';
import {
  getGrowthLevelExpectation,
  getScoreGapBucket,
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
  // 점수 자체의 절대 등급/의미는 사용하지 않는다(기여방식·범위가 의미를 담당).
  // 성장레벨 대비 상대 평가(초과/충족/근접/미달)만 표시한다.
  const { scoreGapExpectations } = useExpectations();
  const rounded = Math.round(Number(score));
  const normalizedLevel =
    growthLevel != null && Number.isFinite(growthLevel) ? Math.round(Number(growthLevel)) : null;
  const gapExpectation =
    normalizedLevel != null && normalizedLevel >= 1
      ? scoreGapExpectations[getScoreGapBucket(rounded, normalizedLevel)]
      : null;

  return (
    <div className="max-w-[320px] text-sm leading-relaxed">
      <div className="font-extrabold text-foreground">
        {rounded}점
        {gapExpectation && (
          <span className="ml-2 text-xs font-bold text-primary">
            Lv.{normalizedLevel} 기준 · {gapExpectation.label}
          </span>
        )}
      </div>
      {method && scope && (
        <div className="mt-1 text-xs font-bold text-muted-foreground">
          {method} × {scope}
        </div>
      )}
      {gapExpectation ? (
        <>
          <div className="mt-2 font-bold text-primary">{gapExpectation.summary}</div>
          <div className="mt-1 text-muted-foreground">{gapExpectation.detail}</div>
        </>
      ) : (
        <div className="mt-2 text-muted-foreground">성장레벨 기준 상대 평가는 평가 대상자의 레벨이 있을 때 표시됩니다.</div>
      )}
    </div>
  );
};

type MethodScopeGuideContentProps = {
  kind: 'method' | 'scope';
  term: string;
};

// 기여 방식/범위 라벨 hover 시 — 점수-갭 툴팁과 동일한 UI 스타일.
export const MethodScopeGuideContent = ({ kind, term }: MethodScopeGuideContentProps) => {
  const { matrixGuide } = useExpectations();
  const desc = kind === 'method' ? matrixGuide.methods[term] : matrixGuide.scopes[term];
  return (
    <div className="max-w-[320px] text-sm leading-relaxed">
      <div className="font-extrabold text-foreground">{term}</div>
      <div className="mt-1 text-xs font-bold text-muted-foreground">
        {kind === 'method' ? '기여 방식' : '기여 범위'}
      </div>
      {desc ? (
        <div className="mt-2 text-muted-foreground">{desc}</div>
      ) : (
        <div className="mt-2 text-muted-foreground">설명이 등록되지 않았습니다.</div>
      )}
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

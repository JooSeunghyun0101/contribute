import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, CircleHelp, Clock3 } from 'lucide-react';
import { AiOpinionButton } from '@/components/ui/ai-opinion-button';
import { AiSectionTitle } from '@/components/ui/AiSectionTitle';
import { AiContentText } from '@/components/ui/AiContentText';
import { NumBadge, Pill } from '@/components/brand';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import {
  GrowthLevelExpectationContent,
  ScoreExpectationContent,
} from '@/components/Evaluation/ExpectationTooltipContent';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { generateFeedbackRecommendation } from '@/lib/gptOss';
import { Task, TaskEvaluationEntry } from '@/types/evaluation';
import {
  MATRIX_METHODS,
  MATRIX_SCOPES,
  MATRIX_SCORE_COLORS,
  EvaluationMatrixScores,
  formatScore,
  getMatrixScore,
  getScoreTextColor,
} from '@/lib/evaluationMatrix';

// 평가자 관점 평가 화면(아코디언)의 표현 컴포넌트. 평가자 입력 화면(Evaluation.tsx)과
// HR 읽기 전용 열람 화면(HrEvaluationViewerPage)이 같은 UI를 공유한다.
// 편집 여부는 group.canEdit 로 제어 — false 면 매트릭스·피드백·AI 버튼이 모두 비활성(읽기 전용).

export const METHODS = MATRIX_METHODS;
export const SCOPES = MATRIX_SCOPES;
export const SCORE_BG = MATRIX_SCORE_COLORS;

export type EvaluatorTaskView = {
  task: Task;
  displayTask: Task;
  /** 이 평가자가 이 과업에 매긴 저장된 평가 항목(저장 시점 AI 검수 결과 ai_* 포함). */
  entry?: TaskEvaluationEntry | null;
  score: number | null;
  hasDraft: boolean;
};

export type EvaluatorGroup = {
  key: string;
  /** 이 그룹이 속한 평가 레코드 id (전보로 평가자별 평가가 나뉜 경우 그룹마다 다름). */
  evaluationId?: string;
  evaluatorId: string;
  evaluatorName: string;
  label: string;
  description: string;
  accent: string;
  mutedAccent: string;
  canEdit: boolean;
  isOwnedByCurrentUser: boolean;
  isCurrentAssignment: boolean;
  tasks: EvaluatorTaskView[];
  exactScore: number;
  flooredScore: number;
  completedCount: number;
};

export const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(d);
};

export const resolveTaskScore = (
  task: Pick<Task, 'contributionMethod' | 'contributionScope' | 'score'>,
  matrix: EvaluationMatrixScores,
) => getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ?? task.score ?? null;

export const toScoreSummary = (tasks: EvaluatorTaskView[]) => {
  const exactScore = tasks.reduce((sum, item) => {
    if (item.score == null) return sum;
    return sum + (item.score * item.task.weight) / 100;
  }, 0);

  return {
    exactScore: Math.round(exactScore * 100) / 100,
    flooredScore: Math.floor(exactScore),
    completedCount: tasks.filter((item) => item.score != null).length,
  };
};

type EvaluateeStatHeroProps = {
  growthLevel: number;
  currentScore: number | null;
  achieved: boolean;
  /** 최종 완료(completed)·잠금(locked)에서만 점수/달성을 반영. 저장 후 AI 검토중(evaluating)에는 미반영. */
  isFinalized: boolean;
};

export const EvaluateeStatHero = ({ growthLevel, currentScore, achieved, isFinalized }: EvaluateeStatHeroProps) => {
  const canCelebrate = isFinalized && achieved;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <StatTile
        label="성장 레벨"
        value={`Lv.${growthLevel}`}
        valueColor="var(--fg)"
        tooltipContent={<GrowthLevelExpectationContent level={growthLevel} />}
      />
      <StatTile
        label="내 반영 점수"
        value={currentScore != null && currentScore > 0 ? formatScore(currentScore) : '–'}
        valueColor="var(--ok-orange)"
      />
      <StatTile
        label="달성 여부"
        value={currentScore != null && currentScore > 0 ? (achieved ? '달성' : '미달성') : '–'}
        valueColor={canCelebrate ? 'var(--ok-orange)' : 'var(--fg-muted)'}
      />
    </div>
  );
};

type StatTileProps = {
  label: string;
  value: string;
  valueColor: string;
  tooltipContent?: ReactNode;
  onValueClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
};

export const StatTile = ({ label, value, valueColor, tooltipContent, onValueClick, title }: StatTileProps) => {
  const valueStyle = {
    fontSize: 'var(--fs-h2)',
    fontWeight: 900,
    lineHeight: 1,
    marginTop: 4,
    color: valueColor,
    whiteSpace: 'nowrap' as const,
    letterSpacing: 0,
  };
  const content = (
    <div style={{ textAlign: 'center', lineHeight: 1.1, cursor: tooltipContent ? 'help' : 'default' }}>
      <div
        style={{
          fontSize: 'var(--fs-micro)',
          fontWeight: 700,
          color: 'var(--fg-subtle)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        {label}
        {tooltipContent && <CircleHelp size={12} aria-hidden="true" />}
      </div>
      {onValueClick ? (
        <button
          type="button"
          className="tnum"
          onClick={onValueClick}
          title={title}
          style={{
            ...valueStyle,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {value}
        </button>
      ) : (
        <div className="tnum" style={valueStyle}>
          {value}
        </div>
      )}
    </div>
  );

  if (!tooltipContent) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="bottom" className="p-3">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
};

type EvaluatorAccordionProps = {
  group: EvaluatorGroup;
  isExpanded: boolean;
  selectedItem?: EvaluatorTaskView;
  selectedTaskId?: string;
  periodLabel?: string | null;
  growthLevel: number;
  onToggle: () => void;
  onSelectTask: (taskId: string) => void;
  onCellClick: (task: Task, methodIndex: number, scopeIndex: number) => void;
  onNoContributionClick: (task: Task) => void;
  onFeedbackChange: (taskId: string, feedback: string) => void;
  matrix: EvaluationMatrixScores;
};

export const EvaluatorAccordion = ({
  group,
  isExpanded,
  selectedItem,
  selectedTaskId,
  periodLabel,
  growthLevel,
  onToggle,
  onSelectTask,
  onCellClick,
  onNoContributionClick,
  onFeedbackChange,
  matrix,
}: EvaluatorAccordionProps) => (
  <section
    style={{
      border: `1px solid ${isExpanded ? group.accent : 'var(--border)'}`,
      borderRadius: 8,
      background: 'var(--bg-card)',
      overflow: 'hidden',
    }}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      style={{
        width: '100%',
        minHeight: 116,
        padding: '24px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 20,
        border: 'none',
        background: 'transparent',
        color: 'var(--fg)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--fs-h1)',
              fontWeight: 900,
              color: group.accent,
              lineHeight: 1.15,
            }}
          >
            평가자 {group.evaluatorName}
          </h2>
          <Pill tone={group.canEdit ? 'orange' : group.isOwnedByCurrentUser ? 'success' : 'neutral'}>
            {group.label}
          </Pill>
          {!group.canEdit && <Pill tone="neutral">읽기 전용</Pill>}
          {periodLabel && (
            <span
              className="tnum"
              style={{
                fontSize: 'var(--fs-sm)',
                fontWeight: 700,
                color: 'var(--fg-muted)',
                background: 'var(--bg-muted)',
                padding: '3px 10px',
                borderRadius: 999,
              }}
              title="평가자 근무기간"
            >
              {periodLabel}
            </span>
          )}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 'var(--fs-body)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          {group.description}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div className="sd-label-mini">반영 점수</div>
          <div className="tnum" style={{ fontSize: 'var(--fs-h2)', fontWeight: 900, color: group.accent }}>
            {formatScore(group.exactScore)}
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
              {' '}
              / {growthLevel}
            </span>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 3 }}>
            {group.completedCount}/{group.tasks.length} 과업
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp size={24} color={group.accent} aria-hidden="true" />
        ) : (
          <ChevronDown size={24} color={group.accent} aria-hidden="true" />
        )}
      </div>
    </button>

    {isExpanded && group.tasks.length === 0 && (
      <div
        style={{
          borderTop: `1px solid ${group.accent}`,
          minHeight: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-muted)',
          fontSize: 'var(--fs-body)',
          fontWeight: 700,
          background: 'var(--bg-muted)',
        }}
      >
        피평가자가 과업을 제출하기 전입니다.
      </div>
    )}

    {isExpanded && selectedItem && (
      <div
        style={{
          borderTop: `1px solid ${group.accent}`,
          display: 'grid',
          gridTemplateColumns: '420px minmax(0, 1fr)',
          // 펼친 영역 높이를 고정해 과업이 많아도 좌측 목록·우측 상세가 각자 내부 스크롤.
          height: 'min(720px, calc(100vh - 220px))',
          minHeight: 420,
        }}
      >
        <TaskTabs group={group} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
        <TaskDetail
          group={group}
          item={selectedItem}
          matrix={matrix}
          growthLevel={growthLevel}
          onCellClick={onCellClick}
          onNoContributionClick={onNoContributionClick}
          onFeedbackChange={onFeedbackChange}
        />
      </div>
    )}
  </section>
);

type TaskTabsProps = {
  group: EvaluatorGroup;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
};

const TaskTabs = ({ group, selectedTaskId, onSelectTask }: TaskTabsProps) => (
  <nav
    style={{
      borderRight: '1px solid var(--border)',
      background: 'var(--bg-muted)',
      overflow: 'auto',
      minHeight: 0,
    }}
  >
    {group.tasks.map((item, index) => {
      const active = item.task.id === selectedTaskId;

      return (
        <button
          key={item.task.id}
          type="button"
          onClick={() => onSelectTask(item.task.id)}
          style={{
            width: '100%',
            minHeight: 72,
            padding: '12px 12px 12px 18px',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            background: active ? group.mutedAccent : 'transparent',
            color: active ? 'var(--fg)' : 'var(--fg-muted)',
            display: 'grid',
            gridTemplateColumns: '52px minmax(0, 1fr)',
            gap: 10,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 900, color: active ? group.accent : 'var(--fg-muted)' }}>
            T{String(index + 1).padStart(2, '0')}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div
                style={{
                  fontSize: 'var(--fs-body)',
                  fontWeight: 800,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {item.task.title}
              </div>
              {item.score != null && <NumBadge score={item.score} size={28} />}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 'var(--fs-xs)', alignItems: 'center' }}>
              {item.task.isAiTask && (
                <span
                  style={{
                    padding: '0 6px',
                    borderRadius: 999,
                    fontWeight: 800,
                    color: 'var(--ai-accent)',
                    background: 'var(--ai-accent-bg)',
                  }}
                >
                  AI
                </span>
              )}
              <span>{item.displayTask.contributionMethod || '방식 미정'}</span>
              <span>·</span>
              <span>{item.displayTask.contributionScope || '범위 미정'}</span>
              {item.hasDraft && (
                <>
                  <span>·</span>
                  <span style={{ color: group.accent, fontWeight: 900 }}>임시저장</span>
                </>
              )}
            </div>
          </div>
        </button>
      );
    })}
  </nav>
);

// AI 검수 유형(저장값) → 칩 색. AiReviewRollup 의 typeTone 과 동일 매핑.
const AI_TYPE_TONE: Record<string, 'orange' | 'info' | 'warning'> = {
  복붙: 'orange',
  논조: 'info',
  성의: 'warning',
  구체성: 'warning',
};
// 저장값(구어체)을 공식적인 표기로 바꿔 표시한다. 저장 데이터는 그대로 두고 라벨만 매핑.
const AI_TYPE_LABEL: Record<string, string> = {
  구체성: '구체성',
  성의: '성실성',
  복붙: '중복성',
  논조: '정합성',
};

// 저장 시점에 기록된 AI 검수 결과를 '조회 시 재호출 없이' 그대로 표시한다(평가 저장 → ai_* 영속 → 여기 출력).
// 평가자가 자기 피드백 품질을 바로 확인하고, 부적합이면 수정 후 재저장(재검수)하도록 유도하는 안내를 함께 보여준다.
const AiReviewResultCard = ({ entry }: { entry?: TaskEvaluationEntry | null }) => {
  const reviewed = Boolean(entry?.aiReviewedAt);
  const flagged = entry?.aiFlagged === true;
  const tone = !reviewed
    ? { bg: 'var(--bg-muted)', border: 'var(--border)', fg: 'var(--fg-muted)' }
    : flagged
      ? { bg: 'var(--warning-bg)', border: 'var(--warning)', fg: 'var(--warning)' }
      : { bg: 'var(--success-bg)', border: 'var(--success)', fg: 'var(--success)' };

  return (
    <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <AiSectionTitle
        title="AI 검수 결과"
        right={reviewed && entry?.aiReviewedAt ? `${formatDate(entry.aiReviewedAt)} 검수` : undefined}
        style={{ marginBottom: 8 }}
      />

      {!reviewed ? (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          아직 검수 전입니다. 피드백을 저장하면 AI가 품질(구체성·성실성·중복성·정합성)을 자동 검수합니다.
        </p>
      ) : flagged ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {entry?.aiType && (
              <Pill tone={AI_TYPE_TONE[entry.aiType] ?? 'warning'}>{AI_TYPE_LABEL[entry.aiType] ?? entry.aiType}</Pill>
            )}
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: tone.fg }}>확인 필요</span>
          </div>
          {entry?.aiSummary && (
            <p style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--fg)', lineHeight: 1.6 }}>{entry.aiSummary}</p>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: tone.fg, lineHeight: 1.6 }}>
          이상 없음 — 검수 통과
        </p>
      )}

      <p
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1px solid var(--border)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--fg-muted)',
          lineHeight: 1.6,
        }}
      >
        구체적 행동 → 성과 → 영향 → 개선 방향 순으로 작성하면 품질 검수를 통과하기 쉽습니다.
      </p>
    </div>
  );
};

type TaskDetailProps = {
  group: EvaluatorGroup;
  item: EvaluatorTaskView;
  matrix: EvaluationMatrixScores;
  growthLevel: number;
  onCellClick: (task: Task, methodIndex: number, scopeIndex: number) => void;
  onNoContributionClick: (task: Task) => void;
  onFeedbackChange: (taskId: string, feedback: string) => void;
};

const TaskDetail = ({
  group,
  item,
  matrix,
  growthLevel,
  onCellClick,
  onNoContributionClick,
  onFeedbackChange,
}: TaskDetailProps) => {
  const { toast } = useToast();
  const { task, displayTask } = item;
  const selectedMethodIdx = (METHODS as readonly string[]).indexOf(displayTask.contributionMethod ?? '');
  const selectedScopeIdx = (SCOPES as readonly string[]).indexOf(displayTask.contributionScope ?? '');
  const noContribSelected =
    displayTask.contributionMethod === '기여미흡' && displayTask.contributionScope === '기여미흡';
  const [feedbackAiLoading, setFeedbackAiLoading] = useState(false);
  const [feedbackAiSuggestion, setFeedbackAiSuggestion] = useState<string | null>(null);

  const handleGenerateFeedbackDraft = async () => {
    if (!group.canEdit) return;

    const score = resolveTaskScore(displayTask, matrix);
    const contributionMethod = displayTask.contributionMethod ?? '';
    const contributionScope = displayTask.contributionScope ?? '';
    if (score == null || !contributionMethod || !contributionScope) {
      toast({
        title: '점수 선택이 필요합니다.',
        description: '기여방식과 기여범위를 먼저 선택한 뒤 AI 피드백을 생성해 주세요.',
        variant: 'destructive',
      });
      return;
    }

    setFeedbackAiLoading(true);
    try {
      const generated = await generateFeedbackRecommendation(
        displayTask.title || task.title || '제목 없음',
        displayTask.description || task.description || '',
        score,
        contributionMethod,
        contributionScope,
        displayTask.feedback ?? '',
      );
      const nextFeedback = generated.trim();
      if (!nextFeedback || nextFeedback.startsWith('⚠')) {
        throw new Error(nextFeedback || 'AI 응답이 비어 있습니다.');
      }
      setFeedbackAiSuggestion(nextFeedback);
      toast({ title: 'AI 피드백 의견을 생성했습니다.' });
    } catch (error) {
      console.error('피드백 AI 생성 실패:', error);
      toast({
        title: 'AI 피드백 생성 실패',
        description: error instanceof Error ? error.message : 'AI 호출 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setFeedbackAiLoading(false);
    }
  };

  useEffect(() => {
    setFeedbackAiSuggestion(null);
  }, [task.id]);

  return (
    <div
      style={{
        padding: '28px 34px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 280px',
        gap: 24,
        alignItems: 'start',
        overflow: 'auto',
        minHeight: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Clock3 size={14} color="var(--fg-muted)" aria-hidden="true" />
          <span style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>
            {formatDate(task.startDate)}~{formatDate(task.endDate)}
          </span>
          <Pill tone="neutral">가중치 {task.weight}%</Pill>
          {item.hasDraft && <Pill tone="orange">임시저장</Pill>}
        </div>

        <h1 style={{ margin: 0, fontSize: 'var(--fs-h1)', fontWeight: 900, lineHeight: 1.25 }}>{task.title}</h1>
        {task.description && (
          <p style={{ marginTop: 16, fontSize: 'var(--fs-body)', lineHeight: 1.8, color: 'var(--fg-muted)' }}>
            {task.description}
          </p>
        )}

        <div style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div className="sd-label-mini">스코어링 매트릭스</div>
              <h3 style={{ margin: '2px 0 0', fontSize: 'var(--fs-body)', fontWeight: 900 }}>
                {group.canEdit ? '셀을 클릭해 점수 선택' : '평가자가 선택한 점수'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNoContributionClick(task)}
              disabled={!group.canEdit}
              style={{
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid',
                borderColor: noContribSelected ? 'var(--danger)' : 'var(--border)',
                background: noContribSelected ? 'var(--danger)' : 'transparent',
                color: noContribSelected ? '#fff' : 'var(--fg)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 800,
                cursor: group.canEdit ? 'pointer' : 'not-allowed',
                opacity: group.canEdit ? 1 : 0.55,
              }}
            >
              기여미흡 (0점)
            </button>
          </div>

          <MatrixGrid
            matrix={matrix}
            rowHeaderWidth={56}
            gap={4}
            renderMethodLabel={(method) => (
              <div
                style={{
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {method}
              </div>
            )}
            renderScopeLabel={(scope) => (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  paddingTop: 4,
                }}
              >
                {scope}
              </div>
            )}
            renderCell={(method, scope, methodIndex, scopeIndex, cellScore) => {
              const isSelected = !noContribSelected && methodIndex === selectedMethodIdx && scopeIndex === selectedScopeIdx;
              const cellBg = isSelected ? (SCORE_BG[cellScore] ?? group.accent) : 'var(--bg-muted)';
              const cellColor = isSelected ? getScoreTextColor(cellScore) : 'var(--fg-subtle)';

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span style={{ display: 'block', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => onCellClick(task, methodIndex, scopeIndex)}
                        disabled={!group.canEdit}
                        style={{
                          width: '100%',
                          height: 44,
                          borderRadius: 8,
                          border: `2px solid ${isSelected ? (SCORE_BG[cellScore] ?? group.accent) : 'var(--border)'}`,
                          background: cellBg,
                          color: cellColor,
                          fontWeight: isSelected ? 900 : 700,
                          fontSize: isSelected ? 'var(--fs-h3)' : 'var(--fs-h4)',
                          cursor: group.canEdit ? 'pointer' : 'not-allowed',
                          opacity: group.canEdit || isSelected ? 1 : 0.48,
                        }}
                      >
                        {cellScore}
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="p-3">
                    <ScoreExpectationContent score={cellScore} method={method} scope={scope} growthLevel={growthLevel} />
                  </TooltipContent>
                </Tooltip>
              );
            }}
          />
        </div>

        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="sd-label-mini">피드백</div>
            <AiOpinionButton
              onClick={handleGenerateFeedbackDraft}
              disabled={!group.canEdit}
              loading={feedbackAiLoading}
              title={
                group.canEdit
                  ? '선택한 점수와 과업 정보를 바탕으로 평가자 피드백 의견 초안을 작성합니다.'
                  : '현재 평가를 수정할 수 없습니다.'
              }
            />
          </div>
          <div
            style={{
              marginTop: 8,
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 0.7fr)',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            <textarea
              value={displayTask.feedback ?? ''}
              onChange={(event) => onFeedbackChange(task.id, event.target.value)}
              disabled={!group.canEdit}
              placeholder="이번 과업에 대한 피드백을 작성하세요."
              rows={7}
              style={{
                width: '100%',
                minHeight: 178,
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: group.canEdit ? 'var(--bg-card)' : 'var(--bg-muted)',
                fontSize: 'var(--fs-body)',
                lineHeight: 1.7,
                color: 'var(--fg)',
                resize: 'vertical',
                fontFamily: 'inherit',
                cursor: group.canEdit ? 'text' : 'not-allowed',
              }}
            />
            <div
              className={feedbackAiSuggestion ? 'ai-shine-border' : undefined}
              onCopy={(event) => {
                event.preventDefault();
                toast({ title: 'AI 의견은 복사할 수 없습니다.' });
              }}
              onCut={(event) => event.preventDefault()}
              onContextMenu={(event) => event.preventDefault()}
              style={{
                minHeight: 178,
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-muted)',
                color: 'var(--fg)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.7,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                cursor: 'default',
              }}
            >
              {feedbackAiLoading ? (
                <span style={{ color: 'var(--fg-muted)' }}>생성 중입니다...</span>
              ) : feedbackAiSuggestion ? (
                <AiContentText text={feedbackAiSuggestion} accent="var(--ai-accent)" />
              ) : (
                <span style={{ color: 'var(--fg-muted)' }}>AI 의견 초안을 생성하면 여기에 표시됩니다.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            padding: 20,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-muted)',
            textAlign: 'center',
          }}
        >
          <div className="sd-label-mini">{group.canEdit ? '현재 선택 점수' : '평가 점수'}</div>
          {item.score != null ? (
            <>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                <NumBadge score={item.score} size={78} />
              </div>
              <div style={{ marginTop: 10, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                {displayTask.contributionMethod || '미정'} × {displayTask.contributionScope || '미정'}
              </div>
            </>
          ) : (
            <div style={{ marginTop: 18, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
              아직 평가되지 않았습니다.
            </div>
          )}
        </div>

        <div
          style={{
            padding: 18,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}
        >
          <div className="sd-label-mini">가중치 반영</div>
          <div className="tnum" style={{ marginTop: 8, fontSize: 'var(--fs-h2)', fontWeight: 900, color: group.accent }}>
            {item.score != null ? ((item.score * task.weight) / 100).toFixed(2) : '–'}
          </div>
          <div style={{ marginTop: 5, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
            점수 {item.score ?? '–'} × 가중치 {task.weight}%
          </div>
        </div>

        {!group.canEdit && (
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--bg-muted)',
              border: '1px solid var(--border)',
              color: 'var(--fg-muted)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.6,
            }}
          >
            이 평가는 {group.evaluatorName} 평가자의 기록입니다. 해당 평가자만 수정할 수 있습니다.
          </div>
        )}

        <AiReviewResultCard entry={item.entry} />
      </aside>
    </div>
  );
};

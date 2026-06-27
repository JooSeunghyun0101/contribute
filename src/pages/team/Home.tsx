import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ClipboardCheck, Clock3 } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { LoadingState } from '@/components/ui/state-views';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluatorPeriodRoster } from '@/hooks/useEvaluatorPeriodRoster';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { evaluationService } from '@/lib/services';
import { useToast } from '@/hooks/use-toast';
import { formatScore, getScoreColor, MATRIX_SCORE_COLORS } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const COLOR_ACHIEVED = MATRIX_SCORE_COLORS[4]; // #E84200
const COLOR_MISSED = MATRIX_SCORE_COLORS[2]; // #C99A4E

type ColumnId = 'draft' | 'submitted' | 'evaluating' | 'completed';

const COLUMN_DEFS: Record<
  ColumnId,
  {
    label: string;
    description: string;
    dot: string;
    icon: typeof Clock3;
  }
> = {
  draft: {
    label: '작성 중',
    description: '피평가자 최종제출 전',
    dot: '#9CA3AF',
    icon: Clock3,
  },
  submitted: {
    label: '검토 대기',
    description: '평가자가 평가를 시작할 수 있음',
    dot: 'var(--ok-orange-brand)',
    icon: AlertCircle,
  },
  evaluating: {
    label: '평가 중',
    description: '점수 또는 피드백 작성 중',
    dot: '#2563EB',
    icon: ClipboardCheck,
  },
  completed: {
    label: '완료',
    description: '평가 저장 완료',
    dot: '#16A34A',
    icon: CheckCircle2,
  },
};

const formatWorkDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const formatWorkPeriod = (start?: string | null, end?: string | null) => {
  const s = formatWorkDate(start);
  const e = formatWorkDate(end);
  if (!s && !e) return null;
  if (s && e) return `${s} ~ ${e}`;
  if (s) return `${s} ~ 현재`;
  return `이전 ~ ${e}`;
};

const formatRelative = (value?: string | null) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / dayMs);

  if (days < 1) return '오늘';
  if (days < 2) return '어제';
  if (days < 14) return `${days}일 전`;

  return `${date.getMonth() + 1}/${date.getDate()}`;
};

type CardModel = {
  column: ColumnId;
  record: EmployeeEvaluationRecord;
  caption: string;
  scoreText: string;
  dateText: string;
  progress: number;
  actionText: string;
  disabled: boolean;
};

const getLatestTaskDate = (record: EmployeeEvaluationRecord) =>
  record.tasks
    .flatMap((task) => [task.feedback_date, task.start_date, task.end_date])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

const getColumn = (record: EmployeeEvaluationRecord): ColumnId => {
  if (record.reviewStatus === 'submitted') return 'submitted';
  if (record.reviewStatus === 'evaluating') return 'evaluating';
  if (record.reviewStatus === 'completed' || record.reviewStatus === 'locked') return 'completed';
  return 'draft';
};

const buildCard = (record: EmployeeEvaluationRecord): CardModel => {
  const column = getColumn(record);
  const scoreText = record.weightedScore > 0 ? `${formatScore(record.weightedScore)}점` : '-';
  const progress = column === 'submitted' ? 0 : record.progress ?? 0;
  const totalTasks = record.totalTasks;
  const completedTasks = record.completedTasks;

  if (column === 'submitted') {
    return {
      column,
      record,
      caption: `최종제출 완료 - 과업 ${totalTasks}건 검토 필요`,
      scoreText,
      dateText: formatRelative(record.evaluation?.last_modified ?? getLatestTaskDate(record)),
      progress,
      actionText: '평가 시작',
      disabled: false,
    };
  }

  if (column === 'evaluating') {
    return {
      column,
      record,
      caption: `${completedTasks}/${totalTasks}개 과업 평가 완료`,
      scoreText,
      dateText: formatRelative(record.latestFeedback?.date ?? getLatestTaskDate(record)),
      progress,
      actionText: '계속 평가',
      disabled: false,
    };
  }

  if (column === 'completed') {
    return {
      column,
      record,
      caption: `평가 완료 - ${record.achieved ? '목표 달성' : '목표 미달성'}`,
      scoreText,
      dateText: formatRelative(record.latestFeedback?.date ?? record.evaluation?.last_modified),
      progress: 100,
      actionText: '상세 보기',
      disabled: false,
    };
  }

  return {
    column,
    record,
    caption: totalTasks > 0 ? `과업 ${totalTasks}건 작성 중 - 최종제출 전` : '과업 미등록',
    scoreText,
    dateText: formatRelative(record.evaluation?.last_modified ?? getLatestTaskDate(record)),
    progress: 0,
    actionText: '제출 전',
    disabled: true,
  };
};

const TeamHome = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  // 현재/이전 담당 분류는 선택한 평가기간 기준 — 발령 인원을 그 기간 담당 여부로 정확히 가른다.
  const { selectedPeriod } = useEvaluationPeriod();
  const {
    current: records,
    former: formerRecords,
    isLoading,
    error,
    isFormerLoading,
    formerError,
  } = useEvaluatorPeriodRoster(user?.employeeId || '', selectedPeriod?.id ?? null, true);

  const cards = useMemo(() => records.map(buildCard), [records]);
  // 과거 담당 피평가자 카드는 reviewStatus 가 어떤 값이든 클릭 가능해야 한다.
  // (정정/매칭 변경 후 상태가 'draft' 로 보이더라도 본인이 평가자였던 이력이 있는 evaluation 은
  //  과거 평가로 진입해서 점수/이력을 볼 수 있어야 함.)
  const formerCards = useMemo(
    () =>
      formerRecords.map((record) => {
        const card = buildCard(record);
        return {
          ...card,
          disabled: false,
          actionText: card.column === 'completed' ? '이전 평가 보기' : '이전 평가 열기',
        };
      }),
    [formerRecords],
  );

  const grouped = useMemo(() => {
    const out: Record<ColumnId, CardModel[]> = {
      draft: [],
      submitted: [],
      evaluating: [],
      completed: [],
    };
    cards.forEach((card) => out[card.column].push(card));
    (Object.keys(out) as ColumnId[]).forEach((col) => {
      out[col].sort((a, b) => {
        const levelA = a.record.employee.growth_level ?? 1;
        const levelB = b.record.employee.growth_level ?? 1;
        if (levelB !== levelA) return levelB - levelA;
        return a.record.employee.name.localeCompare(b.record.employee.name, 'ko-KR');
      });
    });
    return out;
  }, [cards]);

  const stats = useMemo(() => {
    const reviewableCount = grouped.submitted.length + grouped.evaluating.length;
    const departmentName = records[0]?.employee.department ?? '';

    return {
      totalMembers: records.length,
      reviewableCount,
      departmentName,
    };
  }, [grouped, records]);

  const notifyNotYetSubmitted = (card: CardModel) => {
    toast({
      title: '아직 평가할 수 없습니다.',
      description: `${card.record.employee.name}님이 평가를 최종제출하기 전입니다. 피평가자가 최종제출을 완료하면 평가할 수 있습니다.`,
    });
  };

  const openEvaluation = (card: CardModel) => {
    if (card.disabled) {
      notifyNotYetSubmitted(card);
      return;
    }
    navigate(`/evaluation/${card.record.employee.employee_id}`);
  };

  const openFormerEvaluation = async (card: CardModel) => {
    try {
      const evals = await evaluationService.getEvaluationsByEmployeeId(
        card.record.employee.employee_id,
      );
      const myPast = evals.find((ev) => ev.evaluator_id === user?.employeeId);
      if (myPast) {
        // 과거(이전) 평가는 피평가자 현재 제출 상태와 무관하게 항상 연결한다.
        // (이전 평가자가 평가수정요청을 보낸 케이스에서 평가자가 과거 평가에 못 들어가던 버그)
        navigate(`/evaluation/${card.record.employee.employee_id}?evaluationId=${myPast.id}`);
        return;
      }
    } catch {
      // fall through
    }
    // 과거 평가가 없을 때만 현재 평가로 진입 — 미제출이면 안내.
    if (card.disabled) {
      notifyNotYetSubmitted(card);
      return;
    }
    navigate(`/evaluation/${card.record.employee.employee_id}`);
  };

  const startNextReview = () => {
    const target = grouped.submitted[0] ?? grouped.evaluating[0];
    if (target) {
      navigate(`/evaluation/${target.record.employee.employee_id}`);
    }
  };

  return (
    <>
      <PageHeader
        title="평가 진행 보드"
        subtitle={`최종제출된 피평가자를 중심으로 평가를 진행합니다${
          stats.departmentName ? ` - ${stats.departmentName} ${stats.totalMembers}명` : ''
        }`}
        actions={
          <button
            className="sd-btn sd-btn-primary sd-btn-sm"
            onClick={startNextReview}
            disabled={stats.reviewableCount === 0}
            title={stats.reviewableCount === 0 ? '검토 가능한 제출 건이 없습니다.' : '다음 검토 대상 열기'}
          >
            <ClipboardCheck size={14} aria-hidden="true" />
            검토 시작
          </button>
        }
      />

      <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
        {isLoading ? (
          <LoadingState message="평가 보드를 불러오는 중입니다." />
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <>
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 14,
                minHeight: 480,
              }}
            >
              {(Object.keys(COLUMN_DEFS) as ColumnId[]).map((column) => {
                const def = COLUMN_DEFS[column];
                const items = grouped[column];
                const Icon = def.icon;

                return (
                  <div
                    key={column}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      // 좌우 padding 을 줄여서 카드 영역의 폭을 보존하면서
                      // inner wrapper paddingLeft 로 카드 영역을 가운데로 정렬.
                      padding: '16px 8px',
                      borderRadius: 8,
                      background: 'var(--bg-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginBottom: 14,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: def.dot,
                            marginTop: 6,
                            flexShrink: 0,
                          }}
                        />
                        <div>
                          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>{def.label}</div>
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>
                            {def.description}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon size={15} color={def.dot} aria-hidden="true" />
                        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                          {items.length}건
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        flex: 1,
                        maxHeight: 600,
                        overflowY: 'auto',
                        // scrollbar 자리 항상 확보 — 카드 수와 관계없이 동일 폭 유지
                        scrollbarGutter: 'stable',
                        // 카드 좌측 여백을 우측 scrollbar 자리(6px, 전역 thin) 와 동일하게 두어 가운데 정렬
                        paddingLeft: 6,
                      }}
                    >
                      {items.length === 0 ? (
                        <div
                          style={{
                            color: 'var(--fg-subtle)',
                            fontSize: 'var(--fs-body)',
                            textAlign: 'center',
                            padding: '24px 0',
                          }}
                        >
                          대상 없음
                        </div>
                      ) : (
                        items.map((card) => (
                          <BoardCard
                            key={card.record.employee.employee_id}
                            card={card}
                            onClick={() => openEvaluation(card)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {(isFormerLoading || formerError || formerCards.length > 0) && (
              <FormerCarousel
                cards={formerCards}
                isLoading={isFormerLoading}
                error={formerError}
                onOpen={openFormerEvaluation}
              />
            )}

          </>
        )}
      </div>
    </>
  );
};

type BoardCardProps = {
  card: CardModel;
  onClick: () => void;
};

const BoardCard = ({ card, onClick }: BoardCardProps) => {
  const { record, caption, dateText, column, disabled } = card;
  const accentColor = COLUMN_DEFS[column].dot;
  const scoreColor = getScoreColor(record.flooredScore);
  const scoreFraction = Math.min(100, Math.max(0, (record.weightedScore / 4) * 100));
  const hasScore = record.weightedScore > 0;
  const growthLevel = record.employee.growth_level ?? 1;
  const workPeriod = formatWorkPeriod(
    record.employee.assigned_period_start ?? record.employee.work_start_date,
    record.employee.assigned_period_end ?? record.employee.work_end_date,
  );

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '14px 16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: disabled ? 0.68 : 1,
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.borderColor = accentColor;
        event.currentTarget.style.boxShadow = `0 0 0 2px ${accentColor}25`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'var(--border)';
        event.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: disabled ? '#9CA3AF' : 'var(--ok-orange)',
            color: '#fff',
            fontSize: 'var(--fs-body)',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {record.employee.name.charAt(0)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
            {record.employee.name}{' '}
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--fg-muted)' }}>
              {record.employee.position}
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 4,
                background: 'var(--ok-orange-50)',
                color: 'var(--ok-orange-700)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 800,
                letterSpacing: '0.04em',
              }}
            >
              Lv.{growthLevel}
            </span>
          </div>
        </div>
        <StatusBadge disabled={disabled} isCompleted={column === 'completed'} achieved={record.achieved} />
      </div>

      <div
        style={{
          fontSize: 'var(--fs-body)',
          color: 'var(--fg)',
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {caption}
      </div>

      <div
        style={{
          height: 6,
          background: 'var(--bg-muted)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${scoreFraction}%`,
            background: scoreColor,
            borderRadius: 3,
            transition: 'width 0.4s',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span
            className="tnum"
            style={{ fontSize: 'var(--fs-h4)', fontWeight: 900, color: hasScore ? scoreColor : 'var(--fg-muted)' }}
          >
            {hasScore ? formatScore(record.weightedScore) : '–'}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)' }}>
            / 4.0
          </span>
        </div>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>{dateText}</span>
      </div>

      {workPeriod && (
        <div className="tnum" style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)' }}>
          근무 {workPeriod}
        </div>
      )}
    </button>
  );
};

const StatusBadge = ({
  disabled,
  isCompleted,
  achieved,
}: {
  disabled: boolean;
  isCompleted: boolean;
  achieved: boolean;
}) => {
  if (disabled) {
    // 피평가자가 아직 최종제출 안 함 — 제출 전만 표시
    return (
      <span
        style={{
          padding: '2px 10px',
          borderRadius: 999,
          background: 'var(--bg-muted)',
          color: 'var(--fg-muted)',
          border: '1px solid var(--border)',
          fontSize: 'var(--fs-xs)',
          fontWeight: 800,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}
      >
        제출 전
      </span>
    );
  }
  if (!isCompleted) {
    // 평가 완료 전(검토 대기·평가 중)은 라벨 비움
    return null;
  }
  const color = achieved ? COLOR_ACHIEVED : COLOR_MISSED;
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: 999,
        background: achieved ? 'var(--ok-orange-50)' : 'var(--warning-bg)',
        color,
        border: `1px solid ${color}33`,
        fontSize: 'var(--fs-xs)',
        fontWeight: 800,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {achieved ? '달성' : '미달성'}
    </span>
  );
};

// 위 board column 안의 카드 간 간격(12) 과 동일하게 맞춰 통일감 확보.
// 위 column padding(좌우 8 합 16) + scrollbar gutter 6 + cards container paddingLeft 6
// = 총 28 정도 만큼 카드 폭이 column outer 보다 좁다. 아래 wrapper outer 도 그만큼 줄여서
// 카드 너비가 위/아래 동일해지도록 보정.
const FORMER_CARD_GAP = 12;
const FORMER_CARDS_VISIBLE = 4;
const FORMER_CARD_SCROLLBAR_COMPENSATION = 15;
const FORMER_CARD_FLEX_BASIS = `calc((100% - ${FORMER_CARD_GAP * (FORMER_CARDS_VISIBLE - 1)}px) / ${FORMER_CARDS_VISIBLE} - ${FORMER_CARD_SCROLLBAR_COMPENSATION}px)`;

const formerCarouselNavStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: '1px solid var(--ok-orange-200)',
  background: 'var(--bg-card)',
  color: 'var(--ok-orange-700)',
  fontSize: 'var(--fs-h4)',
  fontWeight: 800,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

type FormerCarouselProps = {
  cards: CardModel[];
  isLoading: boolean;
  error: string | null;
  onOpen: (card: CardModel) => void;
};

const FormerCarousel = ({ cards, isLoading, error, onOpen }: FormerCarouselProps) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const scrollByPage = (direction: 'prev' | 'next') => {
    const node = scrollerRef.current;
    if (!node) return;
    // 한 번에 카드 2개 분량씩 이동
    const cardWidth = node.clientWidth / FORMER_CARDS_VISIBLE;
    const delta = (cardWidth + FORMER_CARD_GAP) * 2 * (direction === 'next' ? 1 : -1);
    node.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <section
      style={{
        padding: '16px 0',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 12,
          padding: '0 16px',
        }}
      >
        <div>
          <div className="sd-label-mini" style={{ color: 'var(--ok-orange-700)' }}>
            이전 담당
          </div>
          <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 900, marginTop: 2, color: 'var(--fg)' }}>
            이전 담당 피평가자
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 800 }}>
            {cards.length}명
          </span>
          {cards.length > 0 && !isLoading && !error && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => scrollByPage('prev')}
                aria-label="이전"
                style={formerCarouselNavStyle}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => scrollByPage('next')}
                aria-label="다음"
                style={formerCarouselNavStyle}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>이전 담당 목록을 불러오는 중입니다.</div>
      ) : error ? (
        <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-body)' }}>{error}</div>
      ) : (
        <div
          ref={scrollerRef}
          style={{
            display: 'grid',
            gridAutoFlow: 'column',
            gridAutoColumns: FORMER_CARD_FLEX_BASIS,
            gap: FORMER_CARD_GAP,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            paddingBottom: 6,
          }}
        >
          {cards.map((card) => (
            <div
              key={card.record.employee.employee_id}
              style={{
                boxSizing: 'border-box',
                padding: 16,
                scrollSnapAlign: 'start',
              }}
            >
              <BoardCard card={card} onClick={() => onOpen(card)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default TeamHome;

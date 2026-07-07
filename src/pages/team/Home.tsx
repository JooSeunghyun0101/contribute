import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BellRing, CheckCircle2, ClipboardCheck, Clock3, HelpCircle } from 'lucide-react';
import EvaluationGuide from '@/components/Dashboard/EvaluationGuide';
import PageHeader from '@/components/Layout/PageHeader';
import { LoadingState } from '@/components/ui/state-views';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useEvaluatorPeriodRoster } from '@/hooks/useEvaluatorPeriodRoster';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { evaluationService, notificationService } from '@/lib/services';
import { formatDate } from '@/lib/dateFormat';
import { useToast } from '@/hooks/use-toast';
import { formatScore, getScoreColor, MATRIX_SCORE_COLORS } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const COLOR_ACHIEVED = MATRIX_SCORE_COLORS[4]; // #E84200
const COLOR_MISSED = MATRIX_SCORE_COLORS[2]; // #C99A4E

// 평가 진행 컬럼은 3단계로 통합: 미제출 / 검토 필요(제출됨·평가중) / 완료.
type ColumnId = 'unsubmitted' | 'review' | 'completed';

const COLUMN_DEFS: Record<
  ColumnId,
  {
    label: string;
    description: string;
    dot: string;
    icon: typeof Clock3;
  }
> = {
  unsubmitted: {
    label: '미제출',
    description: '피평가자 최종제출 전',
    dot: 'var(--fg-subtle)',
    icon: Clock3,
  },
  review: {
    label: '검토 필요',
    description: '제출 완료 · 평가 진행',
    dot: 'var(--ok-orange-brand)',
    icon: AlertCircle,
  },
  completed: {
    label: '완료',
    description: '평가 저장 완료',
    dot: 'var(--success)',
    icon: CheckCircle2,
  },
};

// P3-10: 날짜 표기 공용 컨벤션(dateFormat.ts) 사용 — 값 없음은 null 로 유지(호출부 분기용).
const formatWorkDate = (value?: string | null) => {
  if (!value) return null;
  const text = formatDate(value);
  return text === '-' ? null : text;
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
  if (record.reviewStatus === 'submitted' || record.reviewStatus === 'evaluating') return 'review';
  if (record.reviewStatus === 'completed' || record.reviewStatus === 'locked') return 'completed';
  return 'unsubmitted';
};

const laterOf = (a?: string | null, b?: string | null): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
};

// 카드 'n일 전' = 현재 칸반 컬럼에 진입한 시점(상태 전이 타임스탬프 기준, #4).
//  - 검토 필요(submitted): 최종제출 시점(submitted_at)
//  - 검토 필요(evaluating): 최종제출 또는 완료→임시저장 되돌림(reverted_at) 중 더 최근
//  - 완료: 완료 시점(completed_at)
//  - 미제출: 돌려보낸 시점(returned_at), 없으면 매칭/배정 시점(evaluator_assigned_at)
const columnEnteredAt = (record: EmployeeEvaluationRecord): string | null => {
  const e = record.evaluation;
  if (!e) return getLatestTaskDate(record) ?? null;
  switch (record.reviewStatus) {
    case 'submitted':
      return e.submitted_at ?? e.last_modified ?? null;
    case 'evaluating':
      return laterOf(e.submitted_at, e.reverted_at) ?? e.last_modified ?? null;
    case 'completed':
    case 'locked':
      return e.completed_at ?? e.last_modified ?? null;
    default:
      return e.returned_at ?? e.evaluator_assigned_at ?? e.last_modified ?? null;
  }
};

const buildCard = (record: EmployeeEvaluationRecord): CardModel => {
  const column = getColumn(record);
  const scoreText = record.weightedScore > 0 ? `${formatScore(record.weightedScore)}점` : '-';
  const totalTasks = record.totalTasks;
  const completedTasks = record.completedTasks;
  const status = record.reviewStatus;
  const dateText = formatRelative(columnEnteredAt(record));

  // '검토 필요' 컬럼은 제출됨(submitted)·평가중(evaluating)을 묶지만, 카드 문구·액션은
  // 세부 상태(reviewStatus)로 구분해 평가자가 다음 행동을 바로 알 수 있게 한다.
  if (status === 'submitted') {
    return {
      column,
      record,
      caption: `최종제출 완료 - 과업 ${totalTasks}건 검토 필요`,
      scoreText,
      dateText,
      progress: 0,
      actionText: '평가 시작',
      disabled: false,
    };
  }

  if (status === 'evaluating') {
    return {
      column,
      record,
      caption: `${completedTasks}/${totalTasks}개 과업 평가 완료`,
      scoreText,
      dateText,
      progress: record.progress ?? 0,
      actionText: '계속 평가',
      disabled: false,
    };
  }

  if (status === 'completed' || status === 'locked') {
    return {
      column,
      record,
      caption: `평가 완료 - ${record.achieved ? '목표 달성' : '목표 미달성'}`,
      scoreText,
      dateText,
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
    dateText,
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
  const { selectedPeriod, isSelectedPeriodEditable, selectedPeriodEditMessage } = useEvaluationPeriod();
  const {
    current: records,
    former: formerRecords,
    isLoading,
    error,
    isFormerLoading,
    formerError,
  // includeFeedbackHistory=false — 보드는 피드백 이력을 표시하지 않는데 true 면 과업당 이력 HTTP 호출이
  // 추가돼(팀원 20명·과업 100건 ≈ 요청 100+개) 보드 로딩을 크게 늦춘다.
  } = useEvaluatorPeriodRoster(user?.employeeId || '', selectedPeriod?.id ?? null, false);

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

  // 감사 finding(evaluator-board): 이전 담당 0명인 대다수 평가자에게 4번째 컬럼이
  // '이전 담당 없음'만 띄운 채 보드 폭 25%를 차지 — 있을 때만 렌더하고 없으면 3컬럼.
  // 로딩 중엔 숨겨 두면 흔한 케이스(0명)에서 레이아웃 점프가 없고, 에러는 숨기지 않는다(P3-9).
  const showFormerColumn = !isFormerLoading && (formerError != null || formerCards.length > 0);

  const grouped = useMemo(() => {
    const out: Record<ColumnId, CardModel[]> = {
      unsubmitted: [],
      review: [],
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
    const reviewableCount = grouped.review.length;
    const departmentName = records[0]?.employee.department ?? '';

    return {
      totalMembers: records.length,
      reviewableCount,
      completedCount: grouped.completed.length,
      unsubmittedCount: grouped.unsubmitted.length,
      departmentName,
    };
  }, [grouped, records]);

  // 메인 최상단 한 줄 알림 — 피평가자가 제출한 성과보고의 '미평가 경과일' + 매월 1회 평가 안내.
  // (검토 필요·미제출·완료 수치는 아래 칸반에 그대로 있어 여기서는 제외)
  const summaryText = useMemo(() => {
    if (records.length === 0) return '담당 팀원이 없습니다.';
    // 미평가 = 검토 대기(submitted) + 평가 중/임시저장(evaluating). 완료 전은 모두 미평가로 본다.
    const pending = grouped.review.map((c) => c.record);
    if (pending.length === 0) {
      return '미평가 성과보고가 없습니다.';
    }
    const now = Date.now();
    const oldest = pending.reduce((min, r) => {
      const at = columnEnteredAt(r); // 검토필요 진입 시점(최종제출 또는 되돌림)
      const t = at ? new Date(at).getTime() : now;
      return Number.isNaN(t) ? min : Math.min(min, t);
    }, now);
    const days = Math.max(0, Math.floor((now - oldest) / 86_400_000));
    const head = `성과보고 ${pending.length}건 미평가${days > 0 ? ` (최대 ${days}일째)` : ''}`;
    return `${head} · 매월 최소 1회는 평가해 주세요`;
  }, [records.length, grouped.review]);

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
    const target = grouped.review[0];
    if (target) {
      navigate(`/evaluation/${target.record.employee.employee_id}`);
    }
  };

  // P3-11: 평가 가이드 모달(기구현 EvaluationGuide 재배선).
  const [showGuide, setShowGuide] = useState(false);

  // P3-8: 미제출 팀원 전원에게 성과보고 제출 리마인드 알림 발송(현재 담당 카드만 — 과거 담당 제외).
  const confirmDialog = useConfirm();
  const [remindSending, setRemindSending] = useState(false);
  const remindUnsubmitted = async () => {
    if (!user) return;
    // 리뷰 확정 수정: 마감·잠금·작성 전 기간에는 제출 자체가 불가능하므로 발송 차단
    // (이행 불가능한 high 우선순위 알림 방지).
    if (!isSelectedPeriodEditable) {
      toast({
        title: '마감된 평가기간에는 리마인드를 보낼 수 없습니다.',
        description: selectedPeriodEditMessage ?? '활성 평가기간에서만 제출 리마인드가 가능합니다.',
        variant: 'destructive',
      });
      return;
    }
    const targets = grouped.unsubmitted.map((c) => c.record.employee);
    if (targets.length === 0) return;
    const names = targets.map((t) => t.name);
    const nameList =
      names.slice(0, 10).join(', ') + (names.length > 10 ? ` 외 ${names.length - 10}명` : '');
    const ok = await confirmDialog({
      title: `미제출 ${targets.length}명에게 제출 리마인드를 보낼까요?`,
      description: `${nameList}\n\n각자에게 '성과보고 제출 리마인드' 알림이 발송됩니다.`,
      confirmText: '리마인드 발송',
    });
    if (!ok) return;
    setRemindSending(true);
    let sent = 0;
    try {
      for (const target of targets) {
        try {
          await notificationService.createNotification({
            notification_type: 'submit_reminder',
            title: '성과보고 제출 리마인드',
            message: `${user.name} 평가자가 성과보고 제출을 요청했습니다. 과업을 작성하고 최종제출해 주세요.`,
            priority: 'high',
            sender_id: user.employeeId,
            sender_name: user.name,
            recipient_id: target.employee_id,
            related_evaluation_id: null,
            related_task_id: null,
            is_read: false,
          });
          sent += 1;
        } catch {
          /* 개별 실패는 합계로만 알림 */
        }
      }
      toast({
        title: `리마인드 발송 완료 — ${sent}/${targets.length}명`,
        description: sent < targets.length ? '일부 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' : undefined,
        variant: sent < targets.length ? 'destructive' : 'default',
      });
    } finally {
      setRemindSending(false);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* P3-11: 평가 가이드(기구현 모달) 재배선 — 평가 기준·매트릭스 안내 */}
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={() => setShowGuide(true)}
              title="평가 기준·매트릭스 가이드를 봅니다."
            >
              <HelpCircle size={14} aria-hidden="true" />
              평가 가이드
            </button>
            <button
              className="sd-btn sd-btn-primary sd-btn-sm"
              onClick={startNextReview}
              disabled={stats.reviewableCount === 0}
              title={stats.reviewableCount === 0 ? '검토 가능한 제출 건이 없습니다.' : '다음 검토 대상 열기'}
            >
              <ClipboardCheck size={14} aria-hidden="true" />
              검토 시작
            </button>
          </div>
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
            {/* 최상단 한 줄 요약 — 지금 해야 할 일/업데이트. (조직 KPI 현황은 '조직 KPI' 메뉴로 일원화) */}
            <SummaryBar text={summaryText} />

            <section
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${showFormerColumn ? 4 : 3}, minmax(0, 1fr))`,
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
                        {column === 'unsubmitted' && (
                          <button
                            className="sd-btn sd-btn-outline sd-btn-xs"
                            onClick={() => void remindUnsubmitted()}
                            disabled={remindSending || items.length === 0 || !isSelectedPeriodEditable}
                            title={
                              !isSelectedPeriodEditable
                                ? selectedPeriodEditMessage ?? '마감된 평가기간에는 리마인드를 보낼 수 없습니다.'
                                : items.length === 0
                                  ? '미제출 팀원이 없습니다.'
                                  : '미제출 팀원 전원에게 제출 리마인드 알림을 보냅니다.'
                            }
                          >
                            <BellRing size={13} aria-hidden="true" />
                            {remindSending ? '발송 중…' : '리마인드'}
                          </button>
                        )}
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

              {/* 4번째 열 — 이전 담당(기간 중 이관된 피평가자). 진행 프로세스(--bg-muted)와 구분되도록
                  더 연한 --bg-subtle 배경으로 부차/보관 느낌을 준다. 0명이면 컬럼 자체를 생략(3컬럼). */}
              {showFormerColumn && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '16px 8px',
                  borderRadius: 8,
                  background: 'var(--bg-subtle)',
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
                        background: 'var(--fg-subtle)',
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800, color: 'var(--fg-muted)' }}>이전 담당</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>
                        기간 중 다른 평가자에게 이관
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock3 size={15} color="var(--fg-subtle)" aria-hidden="true" />
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                      {formerCards.length}명
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
                    scrollbarGutter: 'stable',
                    paddingLeft: 6,
                  }}
                >
                  {formerError ? (
                    <div
                      style={{
                        color: 'var(--danger)',
                        fontSize: 'var(--fs-sm)',
                        textAlign: 'center',
                        padding: '24px 0',
                      }}
                    >
                      {formerError}
                    </div>
                  ) : (
                    formerCards.map((card) => (
                      <BoardCard
                        key={card.record.employee.employee_id}
                        card={card}
                        onClick={() => openFormerEvaluation(card)}
                      />
                    ))
                  )}
                </div>
              </div>
              )}
            </section>
          </>
        )}
      </div>
      {showGuide && <EvaluationGuide onClose={() => setShowGuide(false)} />}
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
            background: disabled ? 'var(--n-400)' : 'var(--ok-orange)',
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

// ── 최상단 한 줄 요약 (#6) ──────────────────────────────
const SummaryBar = ({ text }: { text: string }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 16px',
      borderRadius: 10,
      background: 'var(--ok-orange-50)',
      border: '1px solid var(--ok-orange-100)',
    }}
  >
    <span className="sd-label-mini" style={{ color: 'var(--ok-orange-700)', flexShrink: 0 }}>
      알림
    </span>
    <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--fg)' }}>{text}</span>
  </div>
);

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

export default TeamHome;

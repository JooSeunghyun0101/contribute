import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ClipboardCheck, Clock3 } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { Pill } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useFormerTeamDashboardRecords, useTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

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
    dot: '#F55000',
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
  const scoreText = record.weightedScore > 0 ? `${record.weightedScore.toFixed(1)}점` : '-';
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
      caption: `평가 완료 - ${record.achieved ? '목표 달성' : '목표 미달'}`,
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
  const {
    records,
    isLoading,
    error,
  } = useTeamDashboardRecords(user?.employeeId || '', true);
  const {
    records: formerRecords,
    isLoading: isFormerLoading,
    error: formerError,
  } = useFormerTeamDashboardRecords(user?.employeeId || '', true);

  const cards = useMemo(() => records.map(buildCard), [records]);
  const formerCards = useMemo(() => formerRecords.map(buildCard), [formerRecords]);

  const grouped = useMemo(() => {
    const out: Record<ColumnId, CardModel[]> = {
      draft: [],
      submitted: [],
      evaluating: [],
      completed: [],
    };
    cards.forEach((card) => out[card.column].push(card));
    return out;
  }, [cards]);

  const stats = useMemo(() => {
    const reviewableCount = grouped.submitted.length + grouped.evaluating.length;
    const completionRate = records.length > 0 ? Math.round((grouped.completed.length / records.length) * 100) : 0;
    const departmentName = records[0]?.employee.department ?? '';

    return {
      totalMembers: records.length,
      draftCount: grouped.draft.length,
      submittedCount: grouped.submitted.length,
      evaluatingCount: grouped.evaluating.length,
      completedCount: grouped.completed.length,
      reviewableCount,
      completionRate,
      departmentName,
    };
  }, [grouped, records]);

  const openEvaluation = (card: CardModel) => {
    if (card.disabled) return;
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
          <div className="sd-card">평가 보드를 불러오는 중입니다.</div>
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
                      padding: 16,
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
                          <div style={{ fontSize: 14, fontWeight: 800 }}>{def.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                            {def.description}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon size={15} color={def.dot} aria-hidden="true" />
                        <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 700 }}>
                          {items.length}건
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                      {items.length === 0 ? (
                        <div
                          style={{
                            color: 'var(--fg-subtle)',
                            fontSize: 13,
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
              <section
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: '1px solid var(--ok-orange-100)',
                  borderLeft: '3px solid var(--ok-orange-600)',
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
                  }}
                >
                  <div>
                    <div className="sd-label-mini" style={{ color: 'var(--ok-orange-700)' }}>
                      이전 담당
                    </div>
                    <h2 style={{ fontSize: 16, fontWeight: 900, marginTop: 2, color: 'var(--fg)' }}>
                      이전 담당 피평가자
                    </h2>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 800 }}>
                    {formerCards.length}명
                  </span>
                </div>

                {isFormerLoading ? (
                  <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>이전 담당 목록을 불러오는 중입니다.</div>
                ) : formerError ? (
                  <div style={{ color: 'var(--danger)', fontSize: 13 }}>{formerError}</div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                      gap: 12,
                    }}
                  >
                    {formerCards.map((card) => (
                      <FormerBoardCard
                        key={card.record.employee.employee_id}
                        card={card}
                        onClick={() => navigate(`/evaluation/${card.record.employee.employee_id}`)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 14,
              }}
            >
              <StatTile label="담당 피평가자" value={stats.totalMembers} sub={stats.departmentName || ''} />
              <StatTile label="검토 대기" value={stats.submittedCount} sub="최종제출 완료" accent />
              <StatTile label="평가 중" value={stats.evaluatingCount} sub={`${stats.reviewableCount}건 진행 대상`} />
              <StatTile label="완료" value={stats.completedCount} sub={`${stats.completionRate}%`} />
            </section>
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
  const { record, caption, scoreText, dateText, progress, column, actionText, disabled } = card;
  const accentColor = COLUMN_DEFS[column].dot;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
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
            fontSize: 13,
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
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {record.employee.name}{' '}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
              {record.employee.position}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
            {record.totalTasks}개 과업
          </div>
        </div>
        <Pill tone={disabled ? 'neutral' : column === 'completed' ? 'success' : column === 'submitted' ? 'orange' : 'info'}>
          {actionText}
        </Pill>
      </div>

      <div
        style={{
          fontSize: 13,
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
          height: 4,
          background: 'var(--bg-muted)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: accentColor,
            borderRadius: 4,
            transition: 'width 0.4s',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="tnum" style={{ fontSize: 16, fontWeight: 900, color: accentColor }}>
          {scoreText}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{dateText}</span>
      </div>
    </button>
  );
};

const FormerBoardCard = ({ card, onClick }: BoardCardProps) => {
  const { record, caption, scoreText, dateText, progress, actionText } = card;

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--bg-card)',
        border: '1px solid var(--ok-orange-100)',
        borderRadius: 8,
        padding: '14px 16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = 'var(--ok-orange-600)';
        event.currentTarget.style.boxShadow = 'var(--sh-focus)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'var(--ok-orange-100)';
        event.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--ok-orange-600)',
            color: '#fff',
            fontSize: 13,
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
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {record.employee.name}{' '}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}>
              {record.employee.position}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
            현재 담당 변경됨 · {record.totalTasks}개 과업
          </div>
        </div>
        <Pill tone="neutral">이전 담당</Pill>
      </div>

      <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.4 }}>{caption}</div>

      <div style={{ height: 4, background: 'var(--ok-orange-50)', borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'var(--ok-orange-600)',
            borderRadius: 4,
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="tnum" style={{ fontSize: 16, fontWeight: 900, color: 'var(--ok-orange-700)' }}>
          {scoreText}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{dateText}</span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ok-orange-700)' }}>
        {actionText === '제출 전' ? '이전 평가 보기' : '이전 평가 수정'}
      </div>
    </button>
  );
};

type StatTileProps = {
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
};

const StatTile = ({ label, value, sub, accent }: StatTileProps) => (
  <div
    className="sd-card"
    style={{
      padding: '20px 22px',
      background: accent ? 'var(--ok-orange)' : undefined,
      border: accent ? 'none' : undefined,
      color: accent ? '#fff' : undefined,
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: accent ? 'rgba(255,255,255,0.86)' : 'var(--fg-muted)',
        marginBottom: 8,
      }}
    >
      {label}
    </div>
    <div
      className="tnum"
      style={{
        fontSize: 28,
        fontWeight: 900,
        lineHeight: 1.05,
        color: accent ? '#fff' : 'var(--fg)',
      }}
    >
      {value}
    </div>
    {sub && (
      <div
        style={{
          fontSize: 12,
          color: accent ? 'rgba(255,255,255,0.86)' : 'var(--fg-muted)',
          marginTop: 6,
        }}
      >
        {sub}
      </div>
    )}
  </div>
);

export default TeamHome;

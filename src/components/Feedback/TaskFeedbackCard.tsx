import { useState } from 'react';
import { AccordionMotion } from '@/components/ui/accordion-motion';
import {
  getScoreColor,
  getScoreTextColor,
  getScoreTintBg,
  getScoreTintFg,
} from '@/lib/evaluationMatrix';

export type TaskFeedbackEntry = {
  id: string;
  content: string;
  date: string;
  evaluatorName: string | null;
};

export type TaskFeedbackCardProps = {
  taskIndex?: number;
  taskTitle: string;
  contributionMethod?: string | null;
  contributionScope?: string | null;
  score: number | null;
  isAiTask?: boolean;
  /** 점수 배지를 솔리드 대신 옅은 틴트로. 직원 화면에서 색 과잉을 줄일 때. */
  tint?: boolean;
  entries: TaskFeedbackEntry[];
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\. /g, '-')
    .replace('.', '');
};

const EvaluatorRow = ({
  name,
  date,
  isLatest,
}: {
  name: string | null;
  date: string;
  isLatest?: boolean;
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--ok-orange)',
        color: '#fff',
        fontSize: 'var(--fs-body)',
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {name ? name.charAt(0) : '?'}
    </div>
    <div>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
        {name ?? '평가자'}
        {isLatest && (
          <span style={{ marginLeft: 8, color: 'var(--ok-orange)', fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
            · 최신
          </span>
        )}
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 1 }}>{formatDate(date)}</div>
    </div>
  </div>
);

const TaskFeedbackCard = ({
  taskIndex,
  taskTitle,
  contributionMethod,
  contributionScope,
  score,
  isAiTask,
  tint = false,
  entries,
}: TaskFeedbackCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [latest, ...older] = entries;
  const scoreBg = tint ? getScoreTintBg(score) : getScoreColor(score);
  const scoreFg = tint ? getScoreTintFg(score) : getScoreTextColor(score);
  const taskBadge = typeof taskIndex === 'number' ? `T${String(taskIndex + 1).padStart(2, '0')}` : null;

  return (
    <div className="sd-card" style={{ padding: '20px 22px', position: 'relative' }}>
      {score != null && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 18,
            minWidth: 64,
            padding: '6px 14px',
            borderRadius: 10,
            background: scoreBg,
            color: scoreFg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            boxShadow: tint ? 'none' : '0 2px 6px rgba(0,0,0,0.08)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--fs-micro)',
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity: 0.88,
              lineHeight: 1.1,
            }}
          >
            점수
          </span>
          <span
            className="tnum"
            style={{ fontSize: 'var(--fs-h2)', fontWeight: 900, lineHeight: 1 }}
          >
            {score}
          </span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--bg-muted)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 14,
          marginRight: score != null ? 92 : 0,
          flexWrap: 'wrap',
        }}
      >
        {taskBadge && (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 800,
              color: 'var(--bg-card)',
              background: 'var(--ok-brown)',
              borderRadius: 4,
              padding: '2px 7px',
            }}
          >
            {taskBadge}
          </span>
        )}
        {isAiTask && (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 800,
              color: 'var(--ai-accent)',
              background: 'var(--ai-accent-bg)',
              borderRadius: 4,
              padding: '2px 7px',
            }}
          >
            AI
          </span>
        )}
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{taskTitle}</span>
        {(contributionMethod || contributionScope) && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            · {[contributionMethod, contributionScope].filter(Boolean).join(' / ')}
          </span>
        )}
      </div>

      {latest ? (
        <>
          <EvaluatorRow name={latest.evaluatorName} date={latest.date} isLatest={older.length > 0} />
          <p style={{ fontSize: 'var(--fs-body)', lineHeight: 1.75, color: 'var(--fg)', margin: 0 }}>
            {latest.content}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)', margin: 0 }}>
          등록된 피드백이 없습니다.
        </p>
      )}

      {older.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            style={{
              marginTop: 14,
              padding: '5px 12px',
              borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'var(--bg-muted)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isExpanded ? '이전 피드백 접기' : `이전 피드백 ${older.length}건 펼치기`}
            <span style={{ fontSize: 'var(--fs-2xs)' }}>{isExpanded ? '▲' : '▼'}</span>
          </button>

          <AccordionMotion isOpen={isExpanded}>
            <div className="flex flex-col" style={{ marginTop: 14, gap: 14 }}>
              {older.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    paddingTop: 14,
                    borderTop: '1px dashed var(--border)',
                  }}
                >
                  <EvaluatorRow name={entry.evaluatorName} date={entry.date} />
                  <p
                    style={{
                      fontSize: 'var(--fs-body)',
                      lineHeight: 1.7,
                      color: 'var(--fg-muted)',
                      margin: 0,
                    }}
                  >
                    {entry.content}
                  </p>
                </div>
              ))}
            </div>
          </AccordionMotion>
        </>
      )}
    </div>
  );
};

export default TaskFeedbackCard;

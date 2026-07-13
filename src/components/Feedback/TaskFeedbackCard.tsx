import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
  /** 이전 평가(발령 전) 과업 표기 — 예: '이전 평가 · 홍길동'. 있으면 T번호 대신 이 배지를 단다. */
  historicalLabel?: string | null;
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

// 피드백 우측에 평가자·날짜를 한 줄로 간단히 표기(예전 아바타 큰 블록 대체).
const FeedbackMeta = ({
  name,
  date,
  isLatest,
}: {
  name: string | null;
  date: string;
  isLatest?: boolean;
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
      marginTop: 2,
      fontSize: 'var(--fs-xs)',
      color: 'var(--fg-muted)',
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{name ?? '평가자'}</span>
    <span style={{ opacity: 0.45 }}>·</span>
    <span className="tnum">{formatDate(date)}</span>
    {isLatest && <span style={{ color: 'var(--ok-orange)', fontWeight: 700 }}>· 최신</span>}
  </span>
);

const TaskFeedbackCard = ({
  taskIndex,
  taskTitle,
  contributionMethod,
  contributionScope,
  score,
  isAiTask,
  tint = false,
  historicalLabel,
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
            borderRadius: 'var(--r-md)',
            background: scoreBg,
            color: scoreFg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            boxShadow: tint ? 'none' : 'var(--sh-sm)',
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
          borderRadius: 'var(--r-sm)',
          padding: '8px 12px',
          marginBottom: 14,
          marginRight: score != null ? 92 : 0,
          flexWrap: 'wrap',
        }}
      >
        {historicalLabel ? (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              color: 'var(--fg-muted)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-xs)',
              padding: '2px 7px',
              whiteSpace: 'nowrap',
            }}
          >
            {historicalLabel}
          </span>
        ) : (
          taskBadge && (
            <span
              style={{
                fontSize: 'var(--fs-xs)',
                fontWeight: 800,
                color: 'var(--bg-card)',
                background: 'var(--ok-brown)',
                borderRadius: 'var(--r-xs)',
                padding: '2px 7px',
              }}
            >
              {taskBadge}
            </span>
          )
        )}
        {isAiTask && (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 800,
              color: 'var(--ai-accent)',
              background: 'var(--ai-accent-bg)',
              borderRadius: 'var(--r-xs)',
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <p style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-body)', lineHeight: 1.75, color: 'var(--fg)', margin: 0 }}>
            {latest.content}
          </p>
          <FeedbackMeta name={latest.evaluatorName} date={latest.date} isLatest={older.length > 0} />
        </div>
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
            className="sd-btn sd-btn-ghost sd-btn-xs"
            style={{
              marginTop: 14,
              padding: '5px 12px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              gap: 4,
            }}
          >
            {isExpanded ? '이전 피드백 접기' : `이전 피드백 ${older.length}건 펼치기`}
            {isExpanded ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
          </button>

          <AccordionMotion isOpen={isExpanded}>
            <div className="flex flex-col" style={{ marginTop: 14, gap: 14 }}>
              {older.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    paddingTop: 14,
                    borderTop: '1px dashed var(--border)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                  }}
                >
                  <p
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 'var(--fs-body)',
                      lineHeight: 1.7,
                      color: 'var(--fg-muted)',
                      margin: 0,
                    }}
                  >
                    {entry.content}
                  </p>
                  <FeedbackMeta name={entry.evaluatorName} date={entry.date} />
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

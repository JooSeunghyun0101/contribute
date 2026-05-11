import { useState } from 'react';
import TaskFeedbackCard, { type TaskFeedbackCardProps } from './TaskFeedbackCard';
import type { Evaluation } from '@/types';

export type PastEvaluationBundle = {
  evaluation: Evaluation;
  cards: (TaskFeedbackCardProps & { taskId: string })[];
};

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\. /g, '-')
    .replace('.', '');
};

const PastEvaluationAccordion = ({ bundle }: { bundle: PastEvaluationBundle }) => {
  const [open, setOpen] = useState(false);
  const { evaluation, cards } = bundle;
  const evaluatorName = evaluation.evaluator_name ?? '이전 평가자';
  const assignedAt = formatDate(evaluation.evaluator_assigned_at);
  const taskCount = cards.length;
  const feedbackCount = cards.reduce((sum, c) => sum + c.entries.length, 0);

  return (
    <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--bg-muted)',
              color: 'var(--fg-muted)',
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {evaluatorName.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{evaluatorName}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>
              {assignedAt ? `${assignedAt} 시작` : '기간 정보 없음'}
              {taskCount > 0 && ` · 과업 ${taskCount}개 · 피드백 ${feedbackCount}건`}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            padding: '14px 18px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            borderTop: '1px solid var(--border)',
          }}
        >
          {cards.length === 0 ? (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--fg-muted)',
                padding: '14px 0',
                textAlign: 'center',
              }}
            >
              이 기간에는 등록된 과업이 없습니다.
            </div>
          ) : (
            cards.map((card) => (
              <TaskFeedbackCard
                key={card.taskId}
                taskIndex={card.taskIndex}
                taskTitle={card.taskTitle}
                contributionMethod={card.contributionMethod}
                contributionScope={card.contributionScope}
                score={card.score}
                entries={card.entries}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default PastEvaluationAccordion;

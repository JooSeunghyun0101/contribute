import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const PastEvaluationAccordion = ({
  bundle,
  editable = false,
  onActivate,
}: {
  bundle: PastEvaluationBundle;
  editable?: boolean;
  /** 전달되면 헤더 클릭 자체가 activate(즉시 전환) 동작. 부재시 기존 펼침/접힘 + URL 이동 */
  onActivate?: (evaluationId: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { evaluation, cards } = bundle;
  const evaluatorName = evaluation.evaluator_name ?? '이전 평가자';
  const assignedAt = formatDate(evaluation.evaluator_assigned_at);
  const taskCount = cards.length;
  const feedbackCount = cards.reduce((sum, c) => sum + c.entries.length, 0);
  const activatableMode = Boolean(onActivate);

  const handleHeaderClick = () => {
    if (activatableMode) {
      onActivate!(evaluation.id);
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={handleHeaderClick}
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
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--bg-muted)',
              color: 'var(--fg-muted)',
              fontSize: 14,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {evaluatorName.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg)' }}>
              {evaluatorName} 평가 (과거)
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
              {assignedAt ? `${assignedAt} 시작` : '기간 정보 없음'}
              {' · '}과업 {taskCount}개{taskCount > 0 ? ` · 피드백 ${feedbackCount}건` : ''}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          {activatableMode ? '편집 →' : open ? '▲' : '▼'}
        </span>
      </button>

      {!activatableMode && open && (
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

          {editable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/my/tasks?evaluationId=${evaluation.id}`);
              }}
              style={{
                marginTop: 4,
                padding: '8px 12px',
                background: 'var(--ok-orange-50)',
                color: 'var(--ok-orange)',
                border: '1px dashed var(--ok-orange)',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              이 평가 과업 편집
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PastEvaluationAccordion;

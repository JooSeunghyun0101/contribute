import { useMemo, useState } from 'react';
import { Pill } from '@/components/brand';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import type { Employee, EvaluatorAssignmentHistory } from '@/types';
import {
  assignmentStatusLabel,
  assignmentStatusTone,
  assignmentTypeLabel,
  formatAssignmentDate,
  isBulkMatchingHistory,
  isCorrectionHistory,
} from '@/lib/evaluatorHistory';

interface Props {
  employee: Employee;
  historyItems: EvaluatorAssignmentHistory[];
  evaluatorOptions: Employee[];
  isLoading: boolean;
  actionId: string | null;
  onAddChange: (employee: Employee, newEvaluatorId: string) => void;
  onCorrect: (employee: Employee, history: EvaluatorAssignmentHistory, newEvaluatorId: string) => void;
  onCancelChange: (employee: Employee, history: EvaluatorAssignmentHistory) => void;
  onRefresh: () => void;
  onClose: () => void;
}

const evaluatorName = (
  evaluatorId?: string | null,
  resolvedName?: string | null,
  options?: Employee[],
) => {
  if (resolvedName) return resolvedName;
  if (!evaluatorId) return '평가자 없음';
  return options?.find((e) => e.employee_id === evaluatorId)?.name ?? evaluatorId;
};

const periodLabel = (history: EvaluatorAssignmentHistory) => {
  if (history.evaluation_period_name) return history.evaluation_period_name;
  if (history.evaluation_year) return `${history.evaluation_year}년`;
  return '-';
};

const EvaluatorHistoryModal = ({
  employee,
  historyItems,
  evaluatorOptions,
  isLoading,
  actionId,
  onAddChange,
  onCorrect,
  onCancelChange,
  onRefresh,
  onClose,
}: Props) => {
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctValue, setCorrectValue] = useState<string>('');
  const [bulkExpanded, setBulkExpanded] = useState(false);
  const [addingMode, setAddingMode] = useState(false);
  const [addValue, setAddValue] = useState<string>('');

  // 매칭 일괄 임포트 행과 일반 행을 분리. 일반 행은 타임라인에, 일괄 행은 접이식 그룹으로.
  const { timelineRows, bulkRows } = useMemo(() => {
    const timeline: EvaluatorAssignmentHistory[] = [];
    const bulk: EvaluatorAssignmentHistory[] = [];
    for (const h of historyItems) {
      if (isBulkMatchingHistory(h)) bulk.push(h);
      else timeline.push(h);
    }
    return { timelineRows: timeline, bulkRows: bulk };
  }, [historyItems]);

  const latestApplied = useMemo(
    () =>
      historyItems.find((h) => h.status === 'applied' && h.change_type !== 'cancel') ?? null,
    [historyItems],
  );

  const currentEvaluatorLabel = evaluatorName(
    employee.evaluator_id,
    null,
    evaluatorOptions,
  );

  // "변경 추가" — 현재 평가자가 아닌 평가자만 후보로.
  const addOptions = useMemo(
    () => evaluatorOptions.filter((e) => e.employee_id !== employee.evaluator_id),
    [evaluatorOptions, employee.evaluator_id],
  );
  const startAdd = () => {
    setCorrectingId(null);
    setAddingMode(true);
    setAddValue('');
  };
  const cancelAdd = () => {
    setAddingMode(false);
    setAddValue('');
  };
  const submitAdd = () => {
    if (!addValue || addValue === employee.evaluator_id) return;
    onAddChange(employee, addValue);
    cancelAdd();
  };

  const startCorrect = (history: EvaluatorAssignmentHistory) => {
    setAddingMode(false);
    setCorrectingId(history.id);
    setCorrectValue(history.new_evaluator_id ?? '');
  };
  const cancelCorrect = () => {
    setCorrectingId(null);
    setCorrectValue('');
  };
  const submitCorrect = (history: EvaluatorAssignmentHistory) => {
    if (!correctValue || correctValue === (history.new_evaluator_id ?? '')) return;
    onCorrect(employee, history, correctValue);
    cancelCorrect();
  };

  const renderHistoryRow = (history: EvaluatorAssignmentHistory) => {
    const prev = evaluatorName(
      history.previous_evaluator_id,
      history.previous_evaluator_name,
      evaluatorOptions,
    );
    const next = evaluatorName(
      history.new_evaluator_id,
      history.new_evaluator_name,
      evaluatorOptions,
    );
    const isCancelled = history.status === 'cancelled';
    const isActionable = history.status === 'applied' && history.change_type === 'change';
    const isRowBusy = actionId === history.id;
    const isCorrecting = correctingId === history.id;

    return (
      <tr
        key={history.id}
        style={{
          background: isCancelled ? 'var(--bg-muted)' : 'var(--bg-card)',
          opacity: isCancelled ? 0.72 : 1,
        }}
      >
        <td style={cellStyle}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
            {formatAssignmentDate(history.changed_at)}
          </span>
        </td>
        <td style={cellStyle}>
          <div
            style={{
              fontWeight: 700,
              textDecoration: isCancelled ? 'line-through' : 'none',
            }}
          >
            {prev} → {next}
          </div>
          {isCorrectionHistory(history) && (
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--ok-orange)', fontWeight: 700 }}>
              ↳ 정정
            </span>
          )}
        </td>
        <td style={cellStyle}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            {periodLabel(history)}
          </span>
        </td>
        <td style={cellStyle}>
          <span
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg-muted)',
              display: 'block',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={history.reason ?? undefined}
          >
            {history.reason ?? '-'}
          </span>
        </td>
        <td style={cellStyle}>
          <Pill tone={history.change_type === 'cancel' ? 'neutral' : 'orange'}>
            {assignmentTypeLabel(history.change_type)}
          </Pill>
        </td>
        <td style={cellStyle}>
          <Pill tone={assignmentStatusTone(history.status)}>
            {assignmentStatusLabel(history.status)}
          </Pill>
        </td>
        <td style={{ ...cellStyle, textAlign: 'right' }}>
          {isCorrecting ? (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
              <EvaluatorPicker
                options={evaluatorOptions}
                value={correctValue}
                onChange={setCorrectValue}
                placeholder="이름·부서·사번으로 검색…"
                minWidth={220}
              />
              <button
                className="sd-btn sd-btn-primary sd-btn-xs"
                disabled={isRowBusy || !correctValue || correctValue === (history.new_evaluator_id ?? '')}
                onClick={() => submitCorrect(history)}
              >
                저장
              </button>
              <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={cancelCorrect}>
                취소
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                className="sd-btn sd-btn-outline sd-btn-xs"
                disabled={!isActionable || isRowBusy || correctingId !== null}
                title={isActionable ? '이 변경을 다른 평가자로 정정합니다.' : '적용 중인 변경만 정정할 수 있습니다.'}
                onClick={() => startCorrect(history)}
              >
                정정
              </button>
              <button
                className="sd-btn sd-btn-ghost sd-btn-xs"
                disabled={!isActionable || isRowBusy || correctingId !== null}
                title={isActionable ? '이 변경을 취소하고 이전 평가자로 되돌립니다.' : '적용 중인 변경만 취소할 수 있습니다.'}
                onClick={() => onCancelChange(employee, history)}
              >
                취소
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          width: 'min(960px, 100%)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.24)',
        }}
      >
        {/* 헤더 — 현재 상태 */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>
              평가자 변경 이력 · {employee.name}
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 4 }}>
              현재 평가자{' '}
              <span style={{ color: 'var(--fg)', fontWeight: 700 }}>{currentEvaluatorLabel}</span>
              {employee.department ? ` · ${employee.department}` : ''}
              {latestApplied && (
                <>
                  {'  ·  '}최종 변경일 {formatAssignmentDate(latestApplied.changed_at)}
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className="sd-btn sd-btn-primary sd-btn-xs"
              onClick={startAdd}
              disabled={addingMode || actionId !== null || correctingId !== null}
            >
              변경 추가
            </button>
            <button
              className="sd-btn sd-btn-outline sd-btn-xs"
              onClick={onRefresh}
              disabled={isLoading}
            >
              {isLoading ? '조회 중' : '새로고침'}
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        {/* 변경 추가 — 인라인 입력 */}
        {addingMode && (
          <div
            style={{
              padding: '12px 24px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--ok-orange-50)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)' }}>
              새 평가자
            </span>
            <EvaluatorPicker
              options={addOptions}
              value={addValue}
              onChange={setAddValue}
              placeholder="이름·부서·사번으로 검색…"
              minWidth={240}
            />
            <button
              className="sd-btn sd-btn-primary sd-btn-xs"
              disabled={actionId !== null || !addValue || addValue === employee.evaluator_id}
              onClick={submitAdd}
            >
              {actionId === 'add' ? '추가 중…' : '추가'}
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={cancelAdd}>
              취소
            </button>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-muted)' }}>
              현재 평가자가 이전 평가자로 기록되고, 새 변경 이력이 추가됩니다.
            </span>
          </div>
        )}

        {/* 본문 — 타임라인 */}
        <div style={{ padding: '16px 24px', overflow: 'auto' }}>
          {isLoading && historyItems.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)', padding: '24px 0' }}>
              이력을 불러오는 중입니다.
            </div>
          ) : historyItems.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)', padding: '24px 0' }}>
              평가자 변경 이력이 없습니다.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={headStyle}>변경일</th>
                  <th style={headStyle}>변경 (이전 → 이후)</th>
                  <th style={headStyle}>평가기간</th>
                  <th style={headStyle}>사유 / 출처</th>
                  <th style={headStyle}>유형</th>
                  <th style={headStyle}>상태</th>
                  <th style={{ ...headStyle, textAlign: 'right' }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {timelineRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...cellStyle, color: 'var(--fg-muted)' }}>
                      개별 변경 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {timelineRows.map(renderHistoryRow)}

                {/* 매칭 일괄 임포트 그룹 */}
                {bulkRows.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={7} style={{ ...cellStyle, background: 'var(--bg-muted)' }}>
                        <button
                          type="button"
                          onClick={() => setBulkExpanded((v) => !v)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 'var(--fs-sm)',
                            fontWeight: 700,
                            color: 'var(--fg-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: 0,
                          }}
                        >
                          {bulkExpanded ? '▾' : '▸'} 매칭 업로드 일괄 반영 · {bulkRows.length}건
                          {!bulkExpanded && (
                            <span style={{ fontWeight: 500 }}>
                              (최근 {formatAssignmentDate(bulkRows[0]?.changed_at)})
                            </span>
                          )}
                        </button>
                      </td>
                    </tr>
                    {bulkExpanded && bulkRows.map(renderHistoryRow)}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

const headStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const cellStyle: React.CSSProperties = {
  padding: '10px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
};

export default EvaluatorHistoryModal;

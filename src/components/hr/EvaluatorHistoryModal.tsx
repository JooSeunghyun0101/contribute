import { Fragment, useMemo, useState } from 'react';
import { Pill } from '@/components/brand';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import type { Employee, EvaluationPeriod, EvaluatorAssignmentHistory } from '@/types';
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
  periods: EvaluationPeriod[];
  defaultPeriodId: string;
  isLoading: boolean;
  actionId: string | null;
  onAddChange: (
    employee: Employee,
    newEvaluatorId: string,
    options: AssignmentChangeOptions,
  ) => void;
  onCorrect: (
    employee: Employee,
    history: EvaluatorAssignmentHistory,
    newEvaluatorId: string,
    options: AssignmentChangeOptions,
  ) => void;
  onCancelChange: (employee: Employee, history: EvaluatorAssignmentHistory) => void;
  onRefresh: () => void;
  onClose: () => void;
}

type AssignmentChangeOptions = {
  startDate: string;
  evaluationPeriodId: string | null;
};

const todayInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const inputDateValue = (value?: string | null) => {
  if (!value) return todayInputValue();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayInputValue();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  periods,
  defaultPeriodId,
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
  const [correctStartDate, setCorrectStartDate] = useState<string>(todayInputValue());
  const [correctPeriodId, setCorrectPeriodId] = useState<string>(defaultPeriodId);
  const [bulkExpanded, setBulkExpanded] = useState(false);
  const [addingMode, setAddingMode] = useState(false);
  const [addValue, setAddValue] = useState<string>('');
  const [addStartDate, setAddStartDate] = useState<string>(todayInputValue());
  const [addPeriodId, setAddPeriodId] = useState<string>(defaultPeriodId);

  // 매칭 일괄 임포트 행과 일반 행을 분리.
  // 타임라인에는 "지금 실제로 적용된 행"만 표시 — cancelled/superseded 는 DB 로그로만 남긴다.
  const { timelineRows, bulkRows } = useMemo(() => {
    const timeline: EvaluatorAssignmentHistory[] = [];
    const bulk: EvaluatorAssignmentHistory[] = [];
    for (const h of historyItems) {
      if (isBulkMatchingHistory(h)) {
        bulk.push(h);
        continue;
      }
      if (h.status !== 'applied' || h.change_type !== 'change') continue;
      timeline.push(h);
    }
    return { timelineRows: timeline, bulkRows: bulk };
  }, [historyItems]);

  const latestApplied = useMemo(
    () =>
      historyItems.find((h) => h.status === 'applied' && h.change_type !== 'cancel') ?? null,
    [historyItems],
  );

  // 각 history 행이 만든 평가자의 근무기간(시작~종료).
  // 시작 = 이 행의 changed_at, 종료 = 다음 applied change 행의 changed_at - 1일 (없으면 "현재").
  const rowPeriods = useMemo(() => {
    const applied = historyItems
      .filter((row) => row.status === 'applied' && row.change_type === 'change')
      .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
    const map = new Map<string, { start: string; end: string | null }>();
    applied.forEach((row, i) => {
      const next = applied[i + 1];
      const endIso = next
        ? new Date(new Date(next.changed_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
        : null;
      map.set(row.id, { start: row.changed_at, end: endIso });
    });
    return map;
  }, [historyItems]);

  const formatPeriodDate = (iso: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  const renderRowPeriod = (history: EvaluatorAssignmentHistory) => {
    const period = rowPeriods.get(history.id);
    if (!period) return '-';
    const start = formatPeriodDate(period.start);
    const end = formatPeriodDate(period.end);
    if (!start) return '-';
    return `${start} ~ ${end ?? '현재'}`;
  };

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
    setAddStartDate(todayInputValue());
    setAddPeriodId(defaultPeriodId);
  };
  const cancelAdd = () => {
    setAddingMode(false);
    setAddValue('');
  };
  const submitAdd = () => {
    if (!addValue || addValue === employee.evaluator_id || !addStartDate || !addPeriodId) return;
    onAddChange(employee, addValue, {
      startDate: addStartDate,
      evaluationPeriodId: addPeriodId || null,
    });
    cancelAdd();
  };

  const startCorrect = (history: EvaluatorAssignmentHistory) => {
    setAddingMode(false);
    setCorrectingId(history.id);
    setCorrectValue(history.new_evaluator_id ?? '');
    setCorrectStartDate(inputDateValue(history.changed_at));
    setCorrectPeriodId(history.evaluation_period_id ?? defaultPeriodId);
  };
  const cancelCorrect = () => {
    setCorrectingId(null);
    setCorrectValue('');
    setCorrectStartDate(todayInputValue());
    setCorrectPeriodId(defaultPeriodId);
  };
  const submitCorrect = (history: EvaluatorAssignmentHistory) => {
    if (!correctValue || !correctStartDate || !correctPeriodId) return;
    const evaluatorChanged = correctValue !== (history.new_evaluator_id ?? '');
    const dateChanged = correctStartDate !== inputDateValue(history.changed_at);
    const periodChanged = correctPeriodId !== (history.evaluation_period_id ?? defaultPeriodId);
    if (!evaluatorChanged && !dateChanged && !periodChanged) return;
    onCorrect(employee, history, correctValue, {
      startDate: correctStartDate,
      evaluationPeriodId: correctPeriodId || null,
    });
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
      <Fragment key={history.id}>
      <tr
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
          <span className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
            {renderRowPeriod(history)}
          </span>
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
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                className="sd-btn sd-btn-primary sd-btn-xs"
                disabled={(() => {
                  if (isRowBusy || !correctValue || !correctStartDate || !correctPeriodId) return true;
                  const evaluatorChanged = correctValue !== (history.new_evaluator_id ?? '');
                  const dateChanged = correctStartDate !== inputDateValue(history.changed_at);
                  const periodChanged =
                    correctPeriodId !== (history.evaluation_period_id ?? defaultPeriodId);
                  return !evaluatorChanged && !dateChanged && !periodChanged;
                })()}
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
      {isCorrecting && (
        <tr style={{ background: 'var(--ok-orange-50)' }}>
          <td colSpan={8} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
                새 평가자
                <EvaluatorPicker
                  options={evaluatorOptions}
                  value={correctValue}
                  onChange={setCorrectValue}
                  placeholder="이름·부서·사번으로 검색…"
                  minWidth={240}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
                변경 시작일
                <input
                  className="sd-input"
                  type="date"
                  value={correctStartDate}
                  onChange={(event) => setCorrectStartDate(event.target.value)}
                  style={{ width: 160 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
                평가기간
                <select
                  className="sd-input"
                  value={correctPeriodId}
                  onChange={(event) => setCorrectPeriodId(event.target.value)}
                  style={{ minWidth: 200 }}
                >
                  <option value="">선택</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </td>
        </tr>
      )}
      </Fragment>
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
          width: 'min(1280px, 100%)',
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
              flexWrap: 'wrap',
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
              변경 시작일
              <input
                className="sd-input"
                type="date"
                value={addStartDate}
                onChange={(event) => setAddStartDate(event.target.value)}
                style={{ width: 150 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
              평가기간
              <select
                className="sd-input"
                value={addPeriodId}
                onChange={(event) => setAddPeriodId(event.target.value)}
                style={{ minWidth: 180 }}
              >
                <option value="">선택</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="sd-btn sd-btn-primary sd-btn-xs"
              disabled={
                actionId !== null ||
                !addValue ||
                addValue === employee.evaluator_id ||
                !addStartDate ||
                !addPeriodId
              }
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
                  <th style={headStyle}>근무기간</th>
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
                    <td colSpan={8} style={{ ...cellStyle, color: 'var(--fg-muted)' }}>
                      개별 변경 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {timelineRows.map(renderHistoryRow)}

                {/* 매칭 일괄 임포트 그룹 */}
                {bulkRows.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={8} style={{ ...cellStyle, background: 'var(--bg-muted)' }}>
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

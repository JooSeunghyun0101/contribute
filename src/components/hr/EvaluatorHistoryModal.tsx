import { Fragment, useMemo, useState } from 'react';
import { Pill } from '@/components/brand';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import { evaluationStatusLabel as statusLabel } from '@/lib/evaluationStatus';
import type {
  Employee,
  Evaluation,
  EvaluationPeriod,
  EvaluationStatus,
  EvaluatorAssignmentHistory,
} from '@/types';
import {
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
  employeeEvaluations: Evaluation[];
  isLoadingEvaluations?: boolean;
  updatingEvaluationId: string | null;
  onChangeEvaluationStatus: (
    evaluationId: string,
    employeeName: string,
    currentStatus: EvaluationStatus,
    nextStatus: EvaluationStatus,
  ) => Promise<void> | void;
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

// 상태 라벨은 SSOT(evaluationStatus.ts)에서 가져와 화면 간 드리프트를 막는다.
const EVALUATION_STATUS_OPTIONS: { id: EvaluationStatus; label: string }[] = (
  ['in-progress', 'submitted', 'evaluating', 'completed', 'locked'] as EvaluationStatus[]
).map((id) => ({ id, label: statusLabel(id) }));

// SSOT 라벨을 쓰되, 이 화면 관점에서 상태가 없거나 미시작이면 '평가 없음'(기존 동작 보존).
const STATUS_WITH_LABEL = new Set(['submitted', 'evaluating', 'completed', 'locked', 'draft', 'in-progress']);
const evaluationStatusLabel = (status?: EvaluationStatus | null) =>
  status && STATUS_WITH_LABEL.has(status) ? statusLabel(status) : '평가 없음';

const evaluationStatusTone = (status?: EvaluationStatus | null) => {
  switch (status) {
    case 'submitted':
      return 'orange' as const;
    case 'evaluating':
      return 'info' as const;
    case 'completed':
      return 'success' as const;
    case 'locked':
      return 'neutral' as const;
    case 'draft':
    case 'in-progress':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
};

const normalizeEvaluationStatus = (status?: EvaluationStatus | null): EvaluationStatus =>
  status === 'draft' ? 'in-progress' : status ?? 'in-progress';

const EvaluatorHistoryModal = ({
  employee,
  historyItems,
  evaluatorOptions,
  periods,
  defaultPeriodId,
  isLoading,
  actionId,
  employeeEvaluations,
  isLoadingEvaluations,
  updatingEvaluationId,
  onChangeEvaluationStatus,
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
  const [statusDrafts, setStatusDrafts] = useState<Record<string, EvaluationStatus>>({});

  // 매칭 일괄 임포트 행과 일반 행을 분리.
  // 타임라인에는 다음을 표시한다:
  //   - 적용 중인 평가자 변경 행 (status='applied' && change_type='change')
  //   - 정정으로 superseded 된 원본 행 (cancel_reason='Superseded by correction')
  // 그 외 cancelled / superseded 는 DB 로그로만 남기고 표시하지 않는다.
  // 정렬: 정정 행(supersedes_history_id 보유)은 원본 행의 changed_at 키를 따라가
  //       원본 바로 아래에 오도록 한다.
  const evaluationById = useMemo(() => {
    const map = new Map<string, Evaluation>();
    for (const ev of employeeEvaluations) map.set(ev.id, ev);
    return map;
  }, [employeeEvaluations]);

  const { timelineRows, bulkRows } = useMemo(() => {
    // bulk/timeline 분류 시 정정 체인의 root 원본을 따라가서 그룹을 결정한다.
    // (bulk import 행을 정정하면 정정 행도 같은 bulk 그룹에 묶여야 함.)
    const allById = new Map(historyItems.map((row) => [row.id, row]));
    const rootOf = (row: EvaluatorAssignmentHistory) => {
      let current = row;
      const visited = new Set<string>();
      while (current.supersedes_history_id && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = allById.get(current.supersedes_history_id);
        if (!parent) break;
        current = parent;
      }
      return current;
    };

    const timeline: EvaluatorAssignmentHistory[] = [];
    const bulk: EvaluatorAssignmentHistory[] = [];
    for (const h of historyItems) {
      // evaluation_id 가 없거나, 그 evaluation 이 직원의 평가 목록에 없는 행 → 표시 제외.
      // (직원의 현재/과거 평가에 연결되지 않은 이력은 모달 사용자가 처리할 수 없는 데이터.)
      if (!h.evaluation_id || !evaluationById.has(h.evaluation_id)) continue;

      const isAppliedChange = h.status === 'applied' && h.change_type === 'change';
      const isSupersededOriginal =
        h.status === 'cancelled' &&
        h.change_type === 'change' &&
        h.cancel_reason === 'Superseded by correction';
      const isVisible = isBulkMatchingHistory(h) || isAppliedChange || isSupersededOriginal;
      if (!isVisible) continue;

      // root 원본이 bulk 면 그 정정 체인 전체를 bulk 로 분류.
      if (isBulkMatchingHistory(rootOf(h))) {
        bulk.push(h);
      } else {
        timeline.push(h);
      }
    }

    const visibleById = new Map([...timeline, ...bulk].map((row) => [row.id, row]));
    const sortKeyFor = (row: EvaluatorAssignmentHistory) => {
      // 정정 체인을 root 원본까지 따라가서 root 의 changed_at 을 primary key 로 쓴다.
      // secondary = depth (원본=0, 1차 정정=1, 2차 정정=2 ...)
      //   → 원본 → 1차 정정 → 2차 정정 ... 순으로 인접 표시.
      let current = row;
      let depth = 0;
      const visited = new Set<string>();
      while (current.supersedes_history_id && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = visibleById.get(current.supersedes_history_id);
        if (!parent) break;
        current = parent;
        depth += 1;
      }
      return { primary: new Date(current.changed_at).getTime(), secondary: depth };
    };

    const sortRows = (rows: EvaluatorAssignmentHistory[]) =>
      rows.sort((a, b) => {
        const ka = sortKeyFor(a);
        const kb = sortKeyFor(b);
        if (kb.primary !== ka.primary) return kb.primary - ka.primary;
        if (ka.secondary !== kb.secondary) return ka.secondary - kb.secondary;
        return new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime();
      });

    sortRows(timeline);
    sortRows(bulk);

    return { timelineRows: timeline, bulkRows: bulk };
  }, [historyItems, evaluationById]);

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

  // 헤더 '평가자'는 선택한 평가기간(defaultPeriodId)의 평가자를 표시 — 과거 기간을 보면 그 기간 담당자.
  // 그 기간 평가가 없으면 현재 master 평가자로 폴백.
  const periodEvaluation = useMemo(
    () => employeeEvaluations.find((ev) => ev.evaluation_period_id === defaultPeriodId) ?? null,
    [employeeEvaluations, defaultPeriodId],
  );
  const periodName = useMemo(
    () => periods.find((p) => p.id === defaultPeriodId)?.name ?? null,
    [periods, defaultPeriodId],
  );
  const currentEvaluatorLabel = periodEvaluation?.evaluator_id
    ? evaluatorName(periodEvaluation.evaluator_id, periodEvaluation.evaluator_name, evaluatorOptions)
    : evaluatorName(employee.evaluator_id, null, evaluatorOptions);

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
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>
            {formatAssignmentDate(history.changed_at)}
          </span>
        </td>
        <td style={cellStyle}>
          <div
            style={{
              fontWeight: 700,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {history.supersedes_history_id && (
              <span style={{ color: 'var(--fg-muted)', fontWeight: 500, marginRight: 2 }}>
                ㄴ
              </span>
            )}
            <span style={{ textDecoration: isCancelled ? 'line-through' : 'none' }}>
              {prev} → {next}
            </span>
            {isCorrectionHistory(history) && (
              <span
                style={{
                  fontSize: 'var(--fs-2xs)',
                  color: 'var(--ok-orange)',
                  fontWeight: 700,
                }}
              >
                (정정)
              </span>
            )}
          </div>
        </td>
        <td style={cellStyle}>
          <span className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
            {renderRowPeriod(history)}
          </span>
        </td>
        <td style={cellStyle}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
            {periodLabel(history)}
          </span>
        </td>
        <td style={cellStyle}>
          <Pill tone={history.change_type === 'cancel' ? 'neutral' : 'orange'}>
            {assignmentTypeLabel(history.change_type)}
          </Pill>
        </td>
        <td style={cellStyle}>
          {(() => {
            const linkedEvaluation = history.evaluation_id
              ? evaluationById.get(history.evaluation_id) ?? null
              : null;
            if (!linkedEvaluation) {
              return (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                  연결된 평가 없음
                </span>
              );
            }
            const currentStatus = linkedEvaluation.evaluation_status;
            const selectable = normalizeEvaluationStatus(currentStatus);
            const draft = statusDrafts[linkedEvaluation.id] ?? selectable;
            const isUpdating = updatingEvaluationId === linkedEvaluation.id;
            const isLockedByHistory = isCancelled;
            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'nowrap',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    justifyContent: 'center',
                    minWidth: 76,
                  }}
                >
                  <Pill tone={evaluationStatusTone(currentStatus)}>
                    {evaluationStatusLabel(currentStatus)}
                  </Pill>
                </span>
                <select
                  value={draft}
                  disabled={isUpdating || isLockedByHistory}
                  onChange={(event) =>
                    setStatusDrafts((prev) => ({
                      ...prev,
                      [linkedEvaluation.id]: event.target.value as EvaluationStatus,
                    }))
                  }
                  style={{
                    minWidth: 104,
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--fg)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                  }}
                >
                  {EVALUATION_STATUS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  className="sd-btn sd-btn-outline sd-btn-xs"
                  disabled={isUpdating || isLockedByHistory || draft === selectable}
                  title={
                    isLockedByHistory
                      ? '취소된 변경 이력의 평가는 수정할 수 없습니다.'
                      : '선택한 단계로 평가를 변경합니다.'
                  }
                  onClick={async () => {
                    await onChangeEvaluationStatus(
                      linkedEvaluation.id,
                      employee.name,
                      selectable,
                      draft,
                    );
                    setStatusDrafts((prev) => {
                      const next = { ...prev };
                      delete next[linkedEvaluation.id];
                      return next;
                    });
                  }}
                >
                  {isUpdating ? '변경 중' : '변경'}
                </button>
              </div>
            );
          })()}
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
          <td colSpan={7} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
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
              {periodName ? `${periodName} 평가자 ` : '현재 평가자 '}
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
            <button
              className="sd-btn sd-btn-primary sd-btn-xs"
              disabled={
                actionId !== null ||
                !addValue ||
                addValue === employee.evaluator_id ||
                !addStartDate ||
                !defaultPeriodId
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
                  <th style={headStyle}>유형</th>
                  <th style={{ ...headStyle, minWidth: 280 }}>평가 단계</th>
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

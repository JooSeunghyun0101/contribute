import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { ErrorState } from '@/components/ui/state-views';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { changeRequestService, employeeService } from '@/lib/services';
import type {
  ChangeRequestStatus,
  Employee,
  EvaluatorAssignmentHistory,
  EvaluatorChangeRequest,
} from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

const STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
};

const STATUS_STYLE: Record<ChangeRequestStatus, { bg: string; fg: string }> = {
  pending: { bg: 'var(--ok-orange-50)', fg: 'var(--ok-orange)' },
  approved: { bg: 'var(--success-bg)', fg: 'var(--success)' },
  rejected: { bg: 'var(--danger-bg)', fg: 'var(--danger)' },
  cancelled: { bg: 'var(--bg-muted)', fg: 'var(--fg-muted)' },
};

const StatusBadge = ({ status }: { status: ChangeRequestStatus }) => {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 'var(--fs-xs)',
        fontWeight: 700,
        background: s.bg,
        color: s.fg,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
};

const fmtDate = (v: string | null) => (v ? v.slice(0, 10).replace(/-/g, '.') : '-');

// 타임스탬프 → 로컬 캘린더 날짜(YYYY-MM-DD). toISOString 의 UTC 보정으로 인한 하루 밀림 방지.
const toYmd = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

type Segment = {
  historyId: string;
  periodId: string | null;
  periodName: string;
  year: number | null;
  evaluatorId: string | null;
  evaluatorName: string;
  start: string;
  end: string | null; // null = 현재
};

// 배정 이력 → 정정 가능한 평가 구간 목록(최신 먼저). 근무기간 종료일은 다음 변경 전일로 계산.
const buildSegments = (history: EvaluatorAssignmentHistory[]): Segment[] => {
  const applied = history
    .filter((h) => h.status === 'applied' && h.change_type === 'change')
    .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
  return applied
    .map((h, i) => {
      const next = applied[i + 1];
      const end = next ? toYmd(new Date(new Date(next.changed_at).getTime() - 86400000).toISOString()) : null;
      return {
        historyId: h.id,
        periodId: h.evaluation_period_id,
        periodName: h.evaluation_period_name ?? (h.evaluation_year ? `${h.evaluation_year}년` : '평가기간'),
        year: h.evaluation_year ?? null,
        evaluatorId: h.new_evaluator_id,
        evaluatorName: h.new_evaluator_name ?? h.new_evaluator_id ?? '평가자 없음',
        start: toYmd(h.changed_at),
        end,
      };
    })
    .reverse();
};

const EvaluatorRequestPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { selectedPeriodId, selectedPeriod } = useEvaluationPeriod();

  const isEvaluator = user?.role === 'evaluator';

  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [myMembers, setMyMembers] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<EvaluatorChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 폼 상태
  const [targetEvaluateeId, setTargetEvaluateeId] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [requestedEvaluatorId, setRequestedEvaluatorId] = useState('');
  const [reason, setReason] = useState('');

  // P3-9: 로드 실패를 '요청 없음/구간 없음' 빈 상태로 위장하지 않는다.
  const [requestsError, setRequestsError] = useState(false);
  const [segmentsError, setSegmentsError] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!user?.employeeId) return;
    try {
      setRequests(await changeRequestService.list({ requestedBy: user.employeeId }));
      setRequestsError(false);
    } catch {
      setRequests([]);
      setRequestsError(true);
    }
  }, [user?.employeeId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user?.employeeId) return;
      setLoading(true);
      try {
        const employees = await employeeService.getAllEmployees();
        if (cancelled) return;
        setAllEmployees(employees);
        if (isEvaluator) {
          const members = await employeeService.getEvaluateesByEvaluator(user.employeeId);
          if (!cancelled) setMyMembers(members);
        }
        await loadRequests();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.employeeId, isEvaluator, loadRequests]);

  // 피평가자는 본인이 대상. 평가자는 담당 팀원 중 선택.
  const evaluateeId = isEvaluator ? targetEvaluateeId : user?.employeeId ?? '';

  // 대상자가 정해지면 그 사람의 평가 구간을 불러온다.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!evaluateeId) {
        setSegments([]);
        setSelectedHistoryId('');
        return;
      }
      setSegmentsError(false);
      try {
        const history = await employeeService.getEvaluatorAssignmentHistory(evaluateeId);
        if (cancelled) return;
        const segs = buildSegments(history);
        setSegments(segs);
      } catch {
        if (!cancelled) {
          setSegments([]);
          setSelectedHistoryId('');
          setSegmentsError(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [evaluateeId]);

  // 선택한 평가기간(연 단위)으로만 구간을 노출하고, 시작/종료일을 그 기간 경계로 클램프한다.
  // - 필터: 구간의 periodId == 선택기간. periodId 없는 옛 이력은 evaluation_year 로 폴백 매칭.
  // - 클램프: 배정 타임스탬프(예: 직전 연도 2024-12-31)가 연도를 넘어 새지 않게 기간 시작일(2025-01-01)로 자른다.
  const visibleSegments = useMemo(() => {
    const pStart = selectedPeriod?.starts_on?.slice(0, 10) ?? null;
    const pEnd = selectedPeriod?.ends_on?.slice(0, 10) ?? null;
    const matches = (s: Segment) => {
      if (!selectedPeriodId) return true; // 선택된 기간 없으면 전체
      if (s.periodId) return s.periodId === selectedPeriodId;
      if (s.year != null && selectedPeriod?.evaluation_year != null) {
        return s.year === selectedPeriod.evaluation_year;
      }
      return false;
    };
    return segments.filter(matches).map((s) => {
      let start = s.start;
      if (pStart && (!start || start < pStart)) start = pStart;
      let end = s.end;
      if (end !== null && pEnd && end > pEnd) end = pEnd;
      return { ...s, start, end };
    });
  }, [segments, selectedPeriodId, selectedPeriod]);

  // 노출 구간이 바뀌면 선택값을 그 안의 첫 구간으로 보정(기존 선택이 유효하면 유지).
  useEffect(() => {
    setSelectedHistoryId((prev) =>
      prev && visibleSegments.some((s) => s.historyId === prev)
        ? prev
        : visibleSegments[0]?.historyId ?? '',
    );
  }, [visibleSegments]);

  const selectedSegment = useMemo(
    () => visibleSegments.find((s) => s.historyId === selectedHistoryId) ?? null,
    [visibleSegments, selectedHistoryId],
  );

  // 희망 평가자 후보 = '평가자 권한' 보유자만(대상자 본인·admin·영문 사번 제외) —
  // 사용자관리(HrUsersPage)의 평가자 후보 규칙과 동일. 전 직원이 나오면 평가 권한이
  // 없는 사람이 지정돼 승인 후 평가 진행이 막힌다.
  const evaluatorOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => e.employee_id !== evaluateeId)
        .filter((e) => e.employee_id !== 'admin')
        .filter((e) => !/^[A-Za-z]/.test(e.employee_id))
        .filter((e) => e.available_roles?.includes('evaluator')),
    [allEmployees, evaluateeId],
  );

  const submit = async () => {
    if (!user?.employeeId) return;
    if (!evaluateeId) {
      toast({ title: '대상 피평가자를 선택해주세요.', variant: 'destructive' });
      return;
    }
    if (!selectedSegment) {
      toast({ title: '평가 구간을 선택해주세요.', variant: 'destructive' });
      return;
    }
    if (!requestedEvaluatorId) {
      toast({ title: '희망 평가자를 선택해주세요.', variant: 'destructive' });
      return;
    }
    if (requestedEvaluatorId === (selectedSegment.evaluatorId ?? '')) {
      toast({ title: '현재 평가자와 동일합니다.', description: '다른 평가자를 선택해주세요.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await changeRequestService.create({
        evaluatee_id: evaluateeId,
        requested_evaluator_id: requestedEvaluatorId,
        target_history_id: selectedSegment.historyId,
        segment_start_date: selectedSegment.start || null,
        segment_end_date: selectedSegment.end,
        requested_by: user.employeeId,
        requester_role: isEvaluator ? 'evaluator' : 'evaluatee',
        reason: reason.trim() || null,
      });
      toast({ title: '변경요청이 접수되었습니다.', description: 'HR 승인 후 반영됩니다.' });
      setRequestedEvaluatorId('');
      setReason('');
      if (isEvaluator) setTargetEvaluateeId('');
      await loadRequests();
    } catch (err) {
      toast({
        title: '변경요청 실패',
        description: err instanceof Error ? err.message : '요청을 접수하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (id: string) => {
    if (!user?.employeeId) return;
    const ok = await confirm({ title: '이 변경요청을 취소할까요?', confirmText: '변경요청 취소' });
    if (!ok) return;
    try {
      await changeRequestService.cancel(id, user.employeeId);
      toast({ title: '변경요청이 취소되었습니다.' });
      await loadRequests();
    } catch (err) {
      toast({
        title: '취소 실패',
        description: err instanceof Error ? err.message : '취소하지 못했습니다.',
        variant: 'destructive',
      });
    }
  };

  const segmentLabel = (s: Segment) =>
    `${s.evaluatorName} · ${s.start || '-'} ~ ${s.end ?? '현재'}`;

  return (
    <div>
      <PageHeader
        title="평가자 변경요청"
        subtitle={
          isEvaluator
            ? '담당 팀원의 평가 구간을 선택해 평가자 변경을 요청합니다. HR 승인 후 반영됩니다.'
            : '내 평가 구간을 선택해 평가자 변경을 요청합니다. HR 승인 후 반영됩니다.'
        }
      />

      <div className="sd-card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 16 }}>새 변경요청</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 620 }}>
          {isEvaluator && (
            <Field label="대상 피평가자">
              <EvaluatorPicker
                options={myMembers}
                value={targetEvaluateeId}
                onChange={setTargetEvaluateeId}
                placeholder="담당 팀원 검색…"
                minWidth={280}
              />
            </Field>
          )}

          <Field label="평가 구간">
            {segmentsError ? (
              <span style={{ color: 'var(--danger)' }}>
                평가 구간을 불러오지 못했습니다. 대상자를 다시 선택하거나 잠시 후 새로고침해 주세요.
              </span>
            ) : visibleSegments.length === 0 ? (
              <span style={{ color: 'var(--fg-muted)' }}>
                {evaluateeId ? '선택한 평가기간에 해당하는 평가 구간이 없습니다.' : '대상자를 먼저 선택하세요.'}
              </span>
            ) : (
              <select
                className="sd-input"
                value={selectedHistoryId}
                onChange={(e) => setSelectedHistoryId(e.target.value)}
                style={{ minWidth: 380 }}
              >
                {visibleSegments.map((s) => (
                  <option key={s.historyId} value={s.historyId}>
                    {segmentLabel(s)}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="현재 평가자">
            <span style={{ fontWeight: 700 }}>{selectedSegment?.evaluatorName ?? '-'}</span>
          </Field>

          <Field label="근무기간">
            <span style={{ color: 'var(--fg-muted)' }}>
              {selectedSegment ? `${selectedSegment.start || '-'} ~ ${selectedSegment.end ?? '현재'}` : '-'}
            </span>
          </Field>

          <Field label="희망 평가자">
            <EvaluatorPicker
              options={evaluatorOptions}
              value={requestedEvaluatorId}
              onChange={setRequestedEvaluatorId}
              placeholder="이름·부서·사번으로 검색…"
              minWidth={280}
            />
          </Field>

          <Field label="사유">
            <textarea
              className="sd-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="변경 사유를 입력하세요. (선택)"
              rows={3}
              style={{ minWidth: 280, resize: 'vertical' }}
            />
          </Field>

          <div>
            <button className="sd-btn sd-btn-primary" disabled={submitting || !selectedSegment} onClick={submit}>
              {submitting ? '접수 중…' : '변경요청 보내기'}
            </button>
          </div>
        </div>
      </div>

      <div className="sd-card" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 16 }}>내 변경요청 내역</h3>
        {loading ? (
          <div style={{ color: 'var(--fg-muted)', padding: '16px 0' }}>불러오는 중…</div>
        ) : requestsError ? (
          <ErrorState message="변경요청 내역을 불러오지 못했습니다." onRetry={() => void loadRequests()} />
        ) : requests.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)', padding: '16px 0' }}>아직 보낸 변경요청이 없습니다.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={th}>요청일</th>
                  <th style={th}>피평가자</th>
                  <th style={th}>변경 (현재 → 희망)</th>
                  <th style={th}>평가기간</th>
                  <th style={th}>근무기간</th>
                  <th style={th}>사유</th>
                  <th style={th}>상태</th>
                  <th style={{ ...th, textAlign: 'right' }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{fmtDate(r.created_at)}</td>
                    <td style={td}>{r.evaluatee_name ?? r.evaluatee_id}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 700 }}>
                        {r.current_evaluator_name ?? '없음'} → {r.requested_evaluator_name ?? '미지정'}
                      </span>
                    </td>
                    <td style={td}>
                      {r.evaluation_period_name ?? '-'}
                      {r.evaluation_year ? ` (${r.evaluation_year})` : ''}
                    </td>
                    <td style={td}>
                      {r.segment_start_date ? `${fmtDate(r.segment_start_date)} ~ ${r.segment_end_date ? fmtDate(r.segment_end_date) : '현재'}` : '-'}
                    </td>
                    <td style={{ ...td, maxWidth: 200, whiteSpace: 'normal', color: 'var(--fg-muted)' }}>
                      {r.reason || '-'}
                      {r.status === 'rejected' && r.review_comment && (
                        <div style={{ color: 'var(--danger)', marginTop: 4 }}>반려: {r.review_comment}</div>
                      )}
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.status === 'pending' ? (
                        <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={() => cancelRequest(r.id)}>
                          취소
                        </button>
                      ) : (
                        <span style={{ color: 'var(--fg-subtle)' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ width: 96, flexShrink: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)' }}>
      {label}
    </span>
    {children}
  </label>
);

const th: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

export default EvaluatorRequestPage;

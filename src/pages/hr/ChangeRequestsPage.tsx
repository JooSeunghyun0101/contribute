import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { ErrorState } from '@/components/ui/state-views';
import { useAuth } from '@/contexts/AuthContext';
import { changeRequestService } from '@/lib/services';
import type { ChangeRequestStatus, EvaluatorChangeRequest } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useConfirm, useReason } from '@/components/ui/confirm-dialog';

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

const fmtDateTime = (v: string | null) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

type FilterKey = 'pending' | 'processed' | 'all';

const ChangeRequestsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const askReason = useReason();
  const [requests, setRequests] = useState<EvaluatorChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // P3-9: 로드 실패를 '요청 없음'(빈 상태)으로 위장하지 않는다.
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [actionId, setActionId] = useState<string | null>(null);
  // S6: 기간·이름 필터 + 일괄 승인 선택.
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const list = await changeRequestService.list();
      setRequests(list);
    } catch {
      setRequests([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // S6: 목록에 존재하는 평가기간 선택지(요청 데이터 기준).
  const periodOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of requests) {
      const key = r.evaluation_period_id ?? r.evaluation_period_name ?? '';
      if (!key) continue;
      const label = `${r.evaluation_period_name ?? '기간 미상'}${r.evaluation_year ? ` (${r.evaluation_year})` : ''}`;
      if (!map.has(key)) map.set(key, label);
    }
    return [...map.entries()].sort((a, b) => b[1].localeCompare(a[1], 'ko-KR'));
  }, [requests]);

  const visible = useMemo(() => {
    let list = requests;
    if (filter === 'pending') list = list.filter((r) => r.status === 'pending');
    else if (filter === 'processed') list = list.filter((r) => r.status !== 'pending');
    if (periodFilter !== 'all') {
      list = list.filter((r) => (r.evaluation_period_id ?? r.evaluation_period_name ?? '') === periodFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [
          r.evaluatee_name,
          r.evaluatee_id,
          r.current_evaluator_name,
          r.requested_evaluator_name,
          r.requested_by_name,
          r.requested_by,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [requests, filter, periodFilter, query]);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests]);
  // 선택은 '화면에 보이는 대기 건'만 유효 — 필터를 바꿔도 안 보이는 건을 실수로 승인하지 않게.
  const visiblePending = useMemo(() => visible.filter((r) => r.status === 'pending'), [visible]);
  const selectedVisible = useMemo(
    () => visiblePending.filter((r) => selectedIds.has(r.id)),
    [visiblePending, selectedIds],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      visiblePending.every((r) => prev.has(r.id))
        ? new Set([...prev].filter((id) => !visiblePending.some((r) => r.id === id)))
        : new Set([...prev, ...visiblePending.map((r) => r.id)]),
    );
  };

  // S6: 일괄 승인 — 선택된 대기 건을 순차 승인(각 건은 기존 단건 승인과 동일 경로·검증).
  const bulkApprove = async () => {
    if (!user?.employeeId || selectedVisible.length === 0) return;
    const names = selectedVisible.map((r) => r.evaluatee_name ?? r.evaluatee_id);
    const nameList = names.slice(0, 10).join(', ') + (names.length > 10 ? ` 외 ${names.length - 10}명` : '');
    const ok = await confirm({
      title: `변경요청 ${selectedVisible.length}건 일괄 승인`,
      description: `다음 피평가자의 평가자 변경을 모두 승인합니다:\n${nameList}\n\n각 건은 개별 승인과 동일하게 즉시 평가자가 변경됩니다.`,
      confirmText: '일괄 승인',
    });
    if (!ok) return;
    setBulkRunning(true);
    let done = 0;
    const failed: string[] = [];
    try {
      for (const r of selectedVisible) {
        try {
          await changeRequestService.approve(r.id, { reviewed_by: user.employeeId });
          done += 1;
        } catch {
          failed.push(r.evaluatee_name ?? r.evaluatee_id);
        }
      }
      toast({
        title: `일괄 승인 완료 — 성공 ${done}건${failed.length ? ` · 실패 ${failed.length}건` : ''}`,
        description: failed.length ? `실패: ${failed.join(', ')} — 목록에서 개별로 다시 시도해 주세요.` : undefined,
        variant: failed.length ? 'destructive' : 'default',
      });
      setSelectedIds(new Set());
      await load();
    } finally {
      setBulkRunning(false);
    }
  };

  const approve = async (r: EvaluatorChangeRequest) => {
    if (!user?.employeeId) return;
    const ok = await confirm({
      title: '평가자 변경요청 승인',
      description: `${r.evaluatee_name ?? r.evaluatee_id}님의 평가자를 "${r.requested_evaluator_name ?? '미지정'}"(으)로 변경하고 승인할까요?`,
      confirmText: '승인',
    });
    if (!ok) return;
    setActionId(r.id);
    try {
      await changeRequestService.approve(r.id, { reviewed_by: user.employeeId });
      toast({ title: '승인 완료', description: '평가자가 변경되었습니다.' });
      await load();
    } catch (err) {
      toast({
        title: '승인 실패',
        description: err instanceof Error ? err.message : '승인하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setActionId(null);
    }
  };

  const reject = async (r: EvaluatorChangeRequest) => {
    if (!user?.employeeId) return;
    const comment = await askReason({
      title: '변경요청 반려',
      description: '반려 사유를 입력하세요. 요청자에게 전달됩니다.',
      placeholder: '반려 사유 (선택)',
      variant: 'danger',
      confirmText: '반려',
    });
    if (comment === null) return;
    setActionId(r.id);
    try {
      await changeRequestService.reject(r.id, { reviewed_by: user.employeeId, review_comment: comment.trim() || null });
      toast({ title: '반려 처리되었습니다.' });
      await load();
    } catch (err) {
      toast({
        title: '반려 실패',
        description: err instanceof Error ? err.message : '반려하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setActionId(null);
    }
  };

  const revert = async (r: EvaluatorChangeRequest) => {
    if (!user?.employeeId) return;
    const ok = await confirm({
      title: '변경 승인 되돌리기',
      description: `${r.evaluatee_name ?? r.evaluatee_id}님의 평가자 변경 승인을 취소하고 이전 평가자(${r.current_evaluator_name ?? '없음'})로 되돌릴까요?`,
      confirmText: '되돌리기',
    });
    if (!ok) return;
    setActionId(r.id);
    try {
      await changeRequestService.revert(r.id, { reviewed_by: user.employeeId });
      toast({ title: '되돌리기 완료', description: '이전 평가자로 복구되었습니다.' });
      await load();
    } catch (err) {
      toast({
        title: '되돌리기 실패',
        description: err instanceof Error ? err.message : '되돌리지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setActionId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="평가자 변경요청 승인"
        subtitle="평가자·피평가자가 요청한 평가자 변경을 검토하고 승인/반려합니다."
        actions={
          <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={() => void load()} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        }
        filters={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {([
                { id: 'pending', label: `대기 ${pendingCount}` },
                { id: 'processed', label: '처리됨' },
                { id: 'all', label: '전체' },
              ] as Array<{ id: FilterKey; label: string }>).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  style={{
                    padding: '6px 16px',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    background: filter === t.id ? 'var(--ok-orange)' : 'transparent',
                    color: filter === t.id ? '#fff' : 'var(--fg-muted)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* S6: 기간·이름 필터 */}
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: 'var(--fs-sm)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-card)',
                color: 'var(--fg)',
              }}
            >
              <option value="all">전체 평가기간</option>
              {periodOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름·사번 검색 (피평가자/평가자/요청자)"
              style={{
                padding: '6px 10px',
                fontSize: 'var(--fs-sm)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-card)',
                color: 'var(--fg)',
                minWidth: 240,
              }}
            />
            {/* S6: 일괄 승인 — 화면에 보이는 대기 건 중 선택된 것만 */}
            <button
              className="sd-btn sd-btn-primary sd-btn-sm"
              onClick={() => void bulkApprove()}
              disabled={bulkRunning || selectedVisible.length === 0}
              title={
                selectedVisible.length === 0
                  ? '목록에서 승인할 대기 건을 선택하세요.'
                  : `선택한 ${selectedVisible.length}건을 일괄 승인합니다.`
              }
            >
              {bulkRunning ? '일괄 승인 중…' : `선택 ${selectedVisible.length}건 일괄 승인`}
            </button>
          </div>
        }
      />

      <div style={{ padding: '20px 32px' }}>
        <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>불러오는 중…</div>
          ) : loadError ? (
            <ErrorState
              message="변경요청 목록을 불러오지 못했습니다."
              onRetry={() => void load()}
            />
          ) : visible.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>해당하는 변경요청이 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ ...th, width: 34 }}>
                      {/* S6: 화면에 보이는 대기 건 전체 선택 */}
                      <input
                        type="checkbox"
                        aria-label="보이는 대기 건 전체 선택"
                        checked={visiblePending.length > 0 && visiblePending.every((r) => selectedIds.has(r.id))}
                        disabled={visiblePending.length === 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th style={th}>요청일</th>
                    <th style={th}>피평가자</th>
                    <th style={th}>변경 (현재 → 희망)</th>
                    <th style={th}>평가기간</th>
                    <th style={th}>근무기간</th>
                    <th style={th}>요청자</th>
                    <th style={th}>사유</th>
                    <th style={th}>상태</th>
                    <th style={{ ...th, textAlign: 'right' }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const busy = actionId === r.id;
                    return (
                      <tr key={r.id}>
                        <td style={td}>
                          {r.status === 'pending' && (
                            <input
                              type="checkbox"
                              aria-label={`${r.evaluatee_name ?? r.evaluatee_id} 선택`}
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
                            />
                          )}
                        </td>
                        <td style={td}>{fmtDateTime(r.created_at)}</td>
                        <td style={td}>
                          <strong>{r.evaluatee_name ?? r.evaluatee_id}</strong>
                          {r.evaluatee_department && (
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>{r.evaluatee_department}</div>
                          )}
                        </td>
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
                          {r.segment_start_date
                            ? `${r.segment_start_date.slice(0, 10).replace(/-/g, '.')} ~ ${
                                r.segment_end_date ? r.segment_end_date.slice(0, 10).replace(/-/g, '.') : '현재'
                              }`
                            : '-'}
                        </td>
                        <td style={td}>
                          {r.requested_by_name ?? r.requested_by}
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                            {r.requester_role === 'evaluator' ? '평가자' : '피평가자'}
                          </div>
                        </td>
                        <td style={{ ...td, maxWidth: 240, whiteSpace: 'normal', color: 'var(--fg-muted)' }}>
                          {r.reason || '-'}
                          {r.status === 'rejected' && r.review_comment && (
                            <div style={{ color: 'var(--danger)', marginTop: 4 }}>반려: {r.review_comment}</div>
                          )}
                        </td>
                        <td style={td}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 10px',
                              borderRadius: 999,
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 700,
                              background: STATUS_STYLE[r.status].bg,
                              color: STATUS_STYLE[r.status].fg,
                            }}
                          >
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {r.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button className="sd-btn sd-btn-primary sd-btn-xs" disabled={busy} onClick={() => approve(r)}>
                                {busy ? '처리 중' : '승인'}
                              </button>
                              <button className="sd-btn sd-btn-outline sd-btn-xs" disabled={busy} onClick={() => reject(r)}>
                                반려
                              </button>
                            </div>
                          ) : r.status === 'approved' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                                {fmtDateTime(r.reviewed_at)}
                              </span>
                              <button className="sd-btn sd-btn-outline sd-btn-xs" disabled={busy} onClick={() => revert(r)}>
                                {busy ? '처리 중' : '승인 되돌리기'}
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                              {fmtDateTime(r.reviewed_at)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const th: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

export default ChangeRequestsPage;

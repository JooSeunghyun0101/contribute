import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { changeRequestService } from '@/lib/services';
import type { ChangeRequestStatus, EvaluatorChangeRequest } from '@/types';
import { useToast } from '@/hooks/use-toast';

const STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
};

const STATUS_STYLE: Record<ChangeRequestStatus, { bg: string; fg: string }> = {
  pending: { bg: 'var(--ok-orange-50)', fg: 'var(--ok-orange)' },
  approved: { bg: '#ECFDF5', fg: '#047857' },
  rejected: { bg: '#FEF2F2', fg: '#B91C1C' },
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
  const [requests, setRequests] = useState<EvaluatorChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await changeRequestService.list();
      setRequests(list);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (filter === 'pending') return requests.filter((r) => r.status === 'pending');
    if (filter === 'processed') return requests.filter((r) => r.status !== 'pending');
    return requests;
  }, [requests, filter]);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests]);

  const approve = async (r: EvaluatorChangeRequest) => {
    if (!user?.employeeId) return;
    if (
      !window.confirm(
        `${r.evaluatee_name ?? r.evaluatee_id}님의 평가자를 "${r.requested_evaluator_name ?? '미지정'}"(으)로 변경하고 승인할까요?`,
      )
    )
      return;
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
    const comment = window.prompt('반려 사유를 입력하세요. (요청자에게 전달됩니다)', '');
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
    if (
      !window.confirm(
        `${r.evaluatee_name ?? r.evaluatee_id}님의 평가자 변경 승인을 취소하고 이전 평가자(${r.current_evaluator_name ?? '없음'})로 되돌릴까요?`,
      )
    )
      return;
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
        }
      />

      <div style={{ padding: '20px 32px' }}>
        <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>불러오는 중…</div>
          ) : visible.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>해당하는 변경요청이 없습니다.</div>
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
                            <div style={{ color: '#B91C1C', marginTop: 4 }}>반려: {r.review_comment}</div>
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

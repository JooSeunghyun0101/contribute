import { useCallback, useEffect, useState } from 'react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  passwordResetService,
  type PasswordResetRequest,
} from '@/lib/services/passwordResetService';

// HR 비밀번호 초기화 관리: 대기 요청 승인/반려 + 요청 없이 직접 초기화.
// 승인·직접초기화 모두 대상 직원 비밀번호를 사번(초기 비밀번호)으로 되돌린다.
const PasswordResetManager = () => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [directId, setDirectId] = useState('');
  const [directBusy, setDirectBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await passwordResetService.listRequests('pending'));
    } catch {
      toast({ title: '요청 목록을 불러오지 못했습니다.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const labelOf = (req: PasswordResetRequest) =>
    `${req.employee_name ?? req.employee_id}(${req.employee_id})`;

  const handleApprove = async (req: PasswordResetRequest) => {
    const ok = await confirm({
      title: '비밀번호 초기화 승인',
      description: `${labelOf(req)}님의 비밀번호를 사번으로 초기화합니다. 해당 직원은 사번으로 로그인 후 새 비밀번호를 설정하게 됩니다.`,
      confirmText: '승인',
    });
    if (!ok) return;
    setBusyId(req.id);
    try {
      await passwordResetService.approve(req.id);
      toast({ title: '초기화 승인 완료', description: `${labelOf(req)}님의 비밀번호를 사번으로 초기화했습니다.` });
      await load();
    } catch {
      toast({ title: '승인 실패', description: '서버와 통신 중 오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: PasswordResetRequest) => {
    const ok = await confirm({
      title: '요청 반려',
      description: `${labelOf(req)}님의 비밀번호 초기화 요청을 반려합니다.`,
      confirmText: '반려',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(req.id);
    try {
      await passwordResetService.reject(req.id);
      toast({ title: '요청을 반려했습니다.' });
      await load();
    } catch {
      toast({ title: '반려 실패', description: '서버와 통신 중 오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDirect = async () => {
    const id = directId.trim();
    if (!id) return;
    const ok = await confirm({
      title: 'HR 직접 비밀번호 초기화',
      description: `${id} 직원의 비밀번호를 사번으로 즉시 초기화합니다. 해당 직원은 사번으로 로그인 후 새 비밀번호를 설정하게 됩니다.`,
      confirmText: '초기화',
    });
    if (!ok) return;
    setDirectBusy(true);
    try {
      await passwordResetService.directReset(id);
      toast({ title: '초기화 완료', description: `${id} 직원의 비밀번호를 사번으로 초기화했습니다.` });
      setDirectId('');
      await load();
    } catch {
      toast({
        title: '초기화 실패',
        description: '대상 사번을 확인해 주세요. (존재하지 않거나 통신 오류)',
        variant: 'destructive',
      });
    } finally {
      setDirectBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 대기 중인 요청 */}
      <section className="sd-card sd-card-lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>
            대기 중인 초기화 요청{requests.length > 0 ? ` (${requests.length})` : ''}
          </h3>
          <button className="sd-btn sd-btn-outline sd-btn-sm" disabled={loading} onClick={() => void load()}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>

        {!loading && requests.length === 0 && (
          <div style={{ padding: '18px 4px', color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
            대기 중인 비밀번호 초기화 요청이 없습니다.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map((req) => (
            <div
              key={req.id}
              style={{
                padding: 14,
                borderRadius: 10,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>{labelOf(req)}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                  요청 {new Date(req.created_at).toLocaleString('ko-KR')}
                  {req.reason ? ` · 사유: ${req.reason}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="sd-btn sd-btn-sm"
                  disabled={busyId !== null}
                  onClick={() => handleApprove(req)}
                  style={{ background: 'var(--ok-orange)', color: '#fff', border: 'none', fontWeight: 700 }}
                >
                  {busyId === req.id ? '처리 중…' : '승인'}
                </button>
                <button
                  className="sd-btn sd-btn-outline sd-btn-sm"
                  disabled={busyId !== null}
                  onClick={() => handleReject(req)}
                >
                  반려
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* HR 직접 초기화 */}
      <section className="sd-card sd-card-lg">
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 8 }}>직접 초기화</h3>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          요청 없이 특정 직원의 비밀번호를 <b>사번(초기 비밀번호)</b>으로 즉시 되돌립니다.
          해당 직원은 다음 로그인 시 새 비밀번호 설정을 강제받습니다.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="sd-input"
            style={{ maxWidth: 240 }}
            value={directId}
            onChange={(e) => setDirectId(e.target.value)}
            placeholder="대상 사번 (예: 1234567)"
            spellCheck={false}
          />
          <button
            className="sd-btn sd-btn-sm"
            disabled={directBusy || !directId.trim()}
            onClick={handleDirect}
            style={{ background: 'var(--ok-orange)', color: '#fff', border: 'none', fontWeight: 700 }}
          >
            {directBusy ? '초기화 중…' : '사번으로 초기화'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default PasswordResetManager;

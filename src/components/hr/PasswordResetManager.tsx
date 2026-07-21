import { useCallback, useEffect, useState } from 'react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/state-views';
import { useToast } from '@/hooks/use-toast';
import {
  passwordResetService,
  type PasswordResetRequest,
} from '@/lib/services/passwordResetService';
import { employeeService } from '@/lib/services/employeeService';

// HR 비밀번호 초기화 관리: 대기 요청 승인/반려 + 요청 없이 직접 초기화.
// 승인·직접초기화 모두 대상 직원 비밀번호를 초기 비밀번호(주민번호 뒷자리, 미등록 시 사번)로 되돌린다.
const PasswordResetManager = () => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [directId, setDirectId] = useState('');
  const [directBusy, setDirectBusy] = useState(false);
  // 직접 초기화 대상 사번의 이름 대조 상태 — 확정 전에 '이 사번이 누구인지' 확인시킨다.
  const [directName, setDirectName] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'checking' | 'found' | 'notfound'>('idle');

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
      description: `${labelOf(req)}님의 비밀번호를 초기 비밀번호(주민번호 뒷자리, 미등록 시 사번)로 초기화합니다. 해당 직원은 초기 비밀번호로 로그인 후 새 비밀번호를 설정하게 됩니다.`,
      confirmText: '승인',
    });
    if (!ok) return;
    setBusyId(req.id);
    try {
      await passwordResetService.approve(req.id);
      toast({ title: '초기화 승인 완료', description: `${labelOf(req)}님의 비밀번호를 초기 비밀번호로 초기화했습니다.` });
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

  // 사번 → 직원 이름 조회. 확정 전에 반드시 이름을 대조해 오타로 인한 엉뚱한 직원 초기화를 막는다.
  const lookupDirect = useCallback(async (id: string): Promise<string | null> => {
    setLookupState('checking');
    try {
      const emp = await employeeService.getEmployeeById(id);
      const name = emp?.name ?? null;
      setDirectName(name);
      setLookupState(name ? 'found' : 'notfound');
      return name;
    } catch {
      setDirectName(null);
      setLookupState('notfound');
      return null;
    }
  }, []);

  const handleDirect = async () => {
    const id = directId.trim();
    if (!id) return;
    // 이미 조회된 이름이 있으면 재사용, 없으면 확정 직전에 조회.
    const name = lookupState === 'found' && directName ? directName : await lookupDirect(id);
    if (!name) {
      toast({
        title: '해당 사번의 직원을 찾을 수 없습니다.',
        description: `사번 ${id} 를 다시 확인해 주세요. 존재하는 사번만 초기화할 수 있습니다.`,
        variant: 'destructive',
      });
      return;
    }
    const label = `${name}(${id})`;
    const ok = await confirm({
      title: 'HR 직접 비밀번호 초기화',
      description: `${label} 님의 비밀번호를 초기 비밀번호(주민번호 뒷자리, 미등록 시 사번)로 즉시 초기화합니다. 해당 직원은 초기 비밀번호로 로그인 후 새 비밀번호를 설정하게 됩니다.`,
      confirmText: '초기화',
    });
    if (!ok) return;
    setDirectBusy(true);
    try {
      await passwordResetService.directReset(id);
      toast({ title: '초기화 완료', description: `${label} 님의 비밀번호를 초기 비밀번호로 초기화했습니다.` });
      setDirectId('');
      setDirectName(null);
      setLookupState('idle');
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
          <EmptyState message="대기 중인 비밀번호 초기화 요청이 없습니다." />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map((req) => (
            <div
              key={req.id}
              style={{
                padding: 14,
                borderRadius: 'var(--r-md)',
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
                  className="sd-btn sd-btn-primary sd-btn-sm"
                  disabled={busyId !== null}
                  onClick={() => handleApprove(req)}
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
          요청 없이 특정 직원의 비밀번호를 <b>초기 비밀번호(주민번호 뒷자리, 미등록 시 사번)</b>로 즉시 되돌립니다.
          해당 직원은 다음 로그인 시 새 비밀번호 설정을 강제받습니다.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="sd-input"
              style={{ maxWidth: 240 }}
              value={directId}
              onChange={(e) => {
                setDirectId(e.target.value);
                setDirectName(null);
                setLookupState('idle');
              }}
              onBlur={() => {
                const id = directId.trim();
                if (id) void lookupDirect(id);
              }}
              placeholder="대상 사번 (예: 1234567)"
              spellCheck={false}
            />
            <button
              className="sd-btn sd-btn-primary sd-btn-sm"
              disabled={directBusy || !directId.trim()}
              onClick={handleDirect}
            >
              {directBusy ? '초기화 중…' : '사번으로 초기화'}
            </button>
          </div>
          {/* 사번 → 이름 대조 미리보기: 확정 전에 대상이 맞는지 눈으로 확인시킨다. */}
          {directId.trim() && lookupState !== 'idle' && (
            <div style={{ fontSize: 'var(--fs-sm)', minHeight: 18 }}>
              {lookupState === 'checking' && <span style={{ color: 'var(--fg-muted)' }}>대상 확인 중…</span>}
              {lookupState === 'found' && directName && (
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>
                  대상: {directName}({directId.trim()})
                </span>
              )}
              {lookupState === 'notfound' && (
                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                  사번 {directId.trim()} 에 해당하는 직원을 찾을 수 없습니다.
                </span>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default PasswordResetManager;

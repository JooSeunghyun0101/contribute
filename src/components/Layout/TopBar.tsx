import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { UserRole } from '@/types';
import { BrandLockup, IconMoon, IconSun, IconLogout } from '@/components/brand';
import NotificationBell from '@/components/Notification/NotificationBell';
import { EvaluationPeriodSelector } from './EvaluationPeriodSelector';

const roleLabels: Record<UserRole, string> = {
  evaluatee: '피평가자',
  evaluator: '평가자',
  hr: 'HR 관리자',
};

const roleOrder: UserRole[] = ['evaluatee', 'evaluator', 'hr'];

const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const TopBar = () => {
  const { user, switchRole, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  // P3-4: 계정 메뉴(비밀번호 변경 진입점) — 기존에는 강제 변경(최초 로그인) 외에 변경 경로가 없었다.
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [accountMenuOpen]);

  const closePwDialog = () => {
    setPwDialogOpen(false);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setPwError('');
  };

  // 검증 규칙은 최초 로그인 강제 변경(Login.tsx)과 동일하게 유지.
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (!currentPw) {
      setPwError('현재 비밀번호를 입력해주세요.');
      return;
    }
    if (newPw.length < 8) {
      setPwError('새 비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (user && newPw === user.employeeId) {
      setPwError('새 비밀번호로 사번을 사용할 수 없습니다.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('새 비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    setPwSaving(true);
    const result = await changePassword(currentPw, newPw);
    setPwSaving(false);
    if (!result.ok) {
      setPwError(result.message ?? '비밀번호 변경에 실패했습니다.');
      return;
    }
    closePwDialog();
    toast({ title: '비밀번호가 변경되었습니다.' });
  };

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  if (!user) return null;

  const available = user.availableRoles ?? [user.role];
  const visibleRoles = roleOrder.filter((r) => available.includes(r));
  // 좌상단 브랜드 로고 클릭 시 현재 역할의 홈으로 이동.
  const homePath = user.role === 'hr' ? '/hr' : user.role === 'evaluator' ? '/team' : '/my';

  return (
    <header
      className="flex items-center justify-between border-b"
      style={{
        height: 'var(--topbar-h)',
        padding: '0 20px',
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-center gap-5" style={{ flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => navigate(homePath)}
          aria-label="홈으로 이동"
          title="홈으로"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            margin: 0,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <BrandLockup />
        </button>
        <div style={{ height: 22, width: 1, background: 'var(--border)' }} />
        {visibleRoles.length > 1 && (
          <div
            className="flex gap-1"
            style={{ background: 'var(--bg-muted)', padding: 3, borderRadius: 8 }}
          >
            {visibleRoles.map((r) => {
              const active = user.role === r;
              return (
                <button
                  key={r}
                  onClick={() => !active && switchRole(r)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    fontSize: 'var(--fs-body)',
                    fontWeight: 600,
                    color: active ? '#fff' : 'var(--fg-muted)',
                    background: active ? 'var(--ok-orange)' : 'transparent',
                    transition: 'all 160ms',
                  }}
                >
                  {roleLabels[r]}
                </button>
              );
            })}
          </div>
        )}
        {visibleRoles.length <= 1 && (
          <span
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              fontSize: 'var(--fs-body)',
              fontWeight: 600,
              color: '#fff',
              background: 'var(--ok-orange)',
            }}
          >
            {roleLabels[user.role]}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
        <EvaluationPeriodSelector />
        <button
          className="sd-btn sd-btn-ghost"
          style={{ padding: 8 }}
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          aria-label="테마 전환"
        >
          {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>
        <NotificationBell />
        <div
          ref={accountMenuRef}
          className="flex items-center gap-2"
          style={{
            paddingLeft: 8,
            borderLeft: '1px solid var(--border)',
            minWidth: 0,
            position: 'relative',
          }}
        >
          {/* P3-4: 아바타·이름 클릭 = 계정 메뉴(비밀번호 변경) */}
          <button
            type="button"
            onClick={() => setAccountMenuOpen((v) => !v)}
            className="flex items-center gap-2"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            title="계정 메뉴"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              minWidth: 0,
              textAlign: 'left',
            }}
          >
            <div className="sd-avatar">{user.name[0]}</div>
            <div style={{ lineHeight: 1.2, minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 700, fontSize: 'var(--fs-body)' }}>
                {user.name}{' '}
                <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>
                  {user.position}
                </span>
              </div>
              <div className="truncate" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                {user.department} · Lv.{user.growthLevel ?? 1}
              </div>
            </div>
          </button>
          {accountMenuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                minWidth: 180,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
                padding: 6,
                zIndex: 60,
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  setPwDialogOpen(true);
                }}
              >
                <KeyRound size={15} aria-hidden="true" />
                비밀번호 변경
              </button>
            </div>
          )}
          <button
            className="sd-btn sd-btn-ghost"
            style={{ padding: 8, flexShrink: 0 }}
            onClick={logout}
            aria-label="로그아웃"
            title="로그아웃"
          >
            <IconLogout size={18} />
          </button>
        </div>
      </div>

      {/* P3-4: 비밀번호 변경 다이얼로그 — 규칙은 최초 로그인 강제 변경과 동일 */}
      {pwDialogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pwSaving) closePwDialog();
          }}
        >
          <form
            onSubmit={handleChangePassword}
            className="sd-card"
            style={{ width: 360, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ fontWeight: 800, fontSize: 'var(--fs-h4)' }}>비밀번호 변경</div>
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              현재 비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="sd-input"
                style={{ width: '100%', marginTop: 4 }}
                autoFocus
              />
            </label>
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              새 비밀번호 (8자 이상, 사번 불가)
              <input
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="sd-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="sd-input"
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            {pwError && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{pwError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="sd-btn sd-btn-outline sd-btn-sm"
                onClick={closePwDialog}
                disabled={pwSaving}
              >
                취소
              </button>
              <button type="submit" className="sd-btn sd-btn-primary sd-btn-sm" disabled={pwSaving}>
                {pwSaving ? '변경 중…' : '변경'}
              </button>
            </div>
          </form>
        </div>
      )}
    </header>
  );
};

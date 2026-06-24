import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user, switchRole, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

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
      <div className="flex items-center gap-5">
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

      <div className="flex items-center gap-3">
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
          className="flex items-center gap-2"
          style={{ paddingLeft: 8, borderLeft: '1px solid var(--border)' }}
        >
          <div className="sd-avatar">{user.name[0]}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)' }}>
              {user.name}{' '}
              <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>
                {user.position}
              </span>
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
              {user.department} · Lv.{user.growthLevel ?? 1}
            </div>
          </div>
          <button
            className="sd-btn sd-btn-ghost"
            style={{ padding: 8 }}
            onClick={logout}
            aria-label="로그아웃"
            title="로그아웃"
          >
            <IconLogout size={18} />
          </button>
        </div>
      </div>
    </header>
  );
};

import React, { lazy, Suspense, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconArrowRight } from '@/components/brand';

// WebGL hero is used only on the login screen, so keep it out of the main bundle.
const ShaderShowcase = lazy(() => import('@/components/ui/hero'));

const Login = () => {
  const { user, login, getAvailableRoles } = useAuth();
  const navigate = useNavigate();

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to="/" replace />;

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!employeeId || !password) {
      setError('사번과 비밀번호를 모두 입력해주세요.');
      return;
    }
    try {
      const roles = await getAvailableRoles(employeeId);
      if (roles.length === 0) {
        setError('사번 또는 비밀번호가 올바르지 않습니다.');
        return;
      }
      // 다중 역할은 로그인 후 상단바에서 전환. 여기서는 첫 번째 역할로 바로 로그인.
      setIsLoading(true);
      const ok = await login(employeeId, password, roles[0]);
      setIsLoading(false);
      if (!ok) setError('사번 또는 비밀번호가 올바르지 않습니다.');
      else navigate('/');
    } catch {
      setError('사번 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  // OK 브랜드 다크 톤 — 셰이더의 검정 배경과 자연스럽게 이어지는 웜 브라운 계열
  const bgL = '#161210';
  const panelL = '#211B17';
  const inputL = '#2C2420';
  const borderL = '#3D332C';
  const textSoft = '#D6C9BC';
  const textSubtle = '#9B8C7D';

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: `radial-gradient(1200px 600px at 15% 20%, rgba(245,80,0,0.16), transparent 60%), radial-gradient(900px 500px at 85% 100%, rgba(255,170,0,0.10), transparent 60%), ${bgL}`,
        color: '#F4EDE3',
        display: 'flex',
      }}
    >
      <div className="hidden lg:block lg:flex-1 relative overflow-hidden bg-black">
        <Suspense fallback={<div className="min-h-screen w-full bg-black" />}>
          <ShaderShowcase />
        </Suspense>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            padding: '70px 72px 70px 24px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 0,
            }}
          >
            <img
              src="/느낌표_orange.png"
              alt="!"
              style={{
                width: 'clamp(108px, 14vw, 195px)',
                height: 'auto',
                objectFit: 'contain',
                flexShrink: 0,
                filter: 'drop-shadow(0 6px 24px rgba(245,80,0,0.45))',
              }}
            />
            <div style={{ minWidth: 0, marginLeft: -20 }}>
              <h1
                style={{
                  fontSize: 'clamp(46px, 5.4vw, 76px)',
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                  lineHeight: 1.06,
                  textShadow: '0 2px 24px rgba(0,0,0,0.65)',
                }}
              >
                기여도 평가
              </h1>
              <p
                style={{
                  color: textSoft,
                  marginTop: 16,
                  fontSize: 'clamp(18px, 1.45vw, 24px)',
                  lineHeight: 1.5,
                  textShadow: '0 1px 16px rgba(0,0,0,0.6)',
                }}
              >
                OK금융그룹의 새로운 성과 평가 체계
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right — login panel */}
      <div
        style={{
          width: 480,
          padding: '80px 56px',
          background: panelL,
          borderLeft: `1px solid ${borderL}`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
        className="w-full lg:w-[480px]"
      >
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            fontWeight: 700,
            letterSpacing: '0.14em',
            color: 'var(--ok-yellow-300)',
          }}
        >
          LOGIN
        </div>
        <h2 style={{ fontSize: 'var(--fs-h1)', fontWeight: 800, marginTop: 6 }}>Welcome back.</h2>

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              background: 'rgba(220, 69, 69, 0.15)',
              border: '1px solid rgba(220, 69, 69, 0.4)',
              borderRadius: 10,
              color: '#FFB4B4',
              fontSize: 'var(--fs-body)',
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleCredentials}
          style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div className="sd-field">
            <label style={{ color: textSoft }}>사번</label>
            <input
              className="sd-input"
              style={{ background: inputL, borderColor: borderL, color: '#F4EDE3' }}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="예: H1911042"
              autoComplete="username"
              spellCheck={false}
            />
          </div>
          <div className="sd-field">
            <label style={{ color: textSoft }}>비밀번호</label>
            <input
              className="sd-input"
              type="password"
              style={{ background: inputL, borderColor: borderL, color: '#F4EDE3' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              height: 46,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: 'linear-gradient(135deg, #F55000 0%, #D94400 100%)',
              color: '#fff',
              fontWeight: 700,
              borderRadius: 10,
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? '로그인 중…' : '로그인'} <IconArrowRight size={16} />
          </button>
          <div style={{ fontSize: 'var(--fs-xs)', color: textSubtle, textAlign: 'center', marginTop: 6 }}>
            SSO · OK금융그룹 통합인증
          </div>
        </form>

        <div
          style={{
            marginTop: 32,
            padding: '14px 16px',
            background: 'rgba(245,80,0,0.12)',
            borderRadius: 10,
            border: `1px solid ${borderL}`,
          }}
        >
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--ok-yellow-300)',
              fontWeight: 700,
              letterSpacing: '0.1em',
            }}
          >
            TIP
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', marginTop: 4, color: textSoft, lineHeight: 1.5 }}>
            로그인 후 상단바의 역할 스위처에서 피평가자 / 평가자 / HR을 전환할 수 있습니다.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

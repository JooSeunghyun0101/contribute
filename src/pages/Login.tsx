import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { authService } from '@/lib/services/authService';
import { SESSION_EXPIRED_STORAGE_KEY } from '@/lib/api';
import { IconArrowRight } from '@/components/brand';
import { Spinner } from '@/components/ui/spinner';
import './login.css';

// WebGL hero is used only on the login screen, so keep it out of the main bundle.
const ShaderShowcase = lazy(() => import('@/components/ui/hero'));

const Login = () => {
  const { user, login, mustChangePassword, changePassword, logout } = useAuth();
  const navigate = useNavigate();

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [info, setInfo] = useState('');

  // 세션 만료(401)로 튕겨온 경우 1회성 안내 — 플래그는 읽은 즉시 제거해 새로고침 시 재노출을 막는다.
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY) === '1') {
      sessionStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
      setInfo('세션이 만료되어 다시 로그인해 주세요.');
    }
  }, []);

  // 로그인됐지만 비밀번호 변경이 강제된 상태(새로고침 포함)면 변경 폼을 보여준다.
  const showChangeForm = Boolean(user) && mustChangePassword;

  if (user && !mustChangePassword) return <Navigate to="/" replace />;

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!employeeId || !password) {
      setError('사번과 비밀번호를 모두 입력해주세요.');
      return;
    }
    // 다중 역할은 로그인 후 상단바에서 전환. 역할 사전조회 없이 서버 인증 한 번으로 끝낸다.
    setIsLoading(true);
    const result = await login(employeeId, password);
    setIsLoading(false);
    if (!result.ok) {
      setError(result.message ?? '사번 또는 비밀번호가 올바르지 않습니다.');
      return;
    }
    // 변경 강제면 user+플래그가 세팅되어 showChangeForm 이 변경 폼으로 전환한다.
    if (!result.mustChangePassword) navigate('/');
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!employeeId) {
      setError('사번을 입력해주세요.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await authService.requestPasswordReset(employeeId, resetReason || undefined);
      setInfo(res.message ?? '비밀번호 초기화 요청이 접수되었습니다. 관리자 승인 후 사번으로 로그인하세요.');
      setResetReason('');
      setResetOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 비밀번호 변경 화면에서 사번 입력(로그인) 화면으로 복귀 — 강제변경 상태는 로그인된 상태라
  // 로그아웃해서 user 를 비워야 로그인 폼이 다시 보인다.
  const handleBackToLogin = () => {
    logout();
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setInfo('');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password) {
      setError('현재 비밀번호를 입력해주세요. (최초 로그인은 사번)');
      return;
    }
    if (newPassword.length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (user && newPassword === user.employeeId) {
      setError('새 비밀번호로 사번을 사용할 수 없습니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    setIsLoading(true);
    const result = await changePassword(password, newPassword);
    setIsLoading(false);
    if (!result.ok) {
      setError(result.message ?? '비밀번호 변경에 실패했습니다.');
      return;
    }
    navigate('/');
  };

  return (
    <div className="login-page">
      {/* 좌측 — WebGL 히어로 + 브랜드 오버레이 */}
      <div className="hidden lg:block lg:flex-1 relative overflow-hidden" style={{ background: '#000' }}>
        <Suspense fallback={<div className="min-h-screen w-full" style={{ background: '#000' }} />}>
          <ShaderShowcase />
        </Suspense>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            padding: '70px 72px 56px 24px',
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
                  letterSpacing: '-0.045em',
                  lineHeight: 1.06,
                  textShadow: '0 2px 24px rgba(0,0,0,0.65)',
                }}
              >
                기여도 평가
              </h1>
              <p
                style={{
                  color: 'var(--lg-text-soft)',
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
          {/* 좌하단 푸터 — 히어로에 무게중심을 잡아주는 낮은 시각 요소 */}
          <div
            style={{
              paddingLeft: 48,
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(245,241,235,0.45)',
              textShadow: '0 1px 12px rgba(0,0,0,0.6)',
            }}
          >
            OK Financial Group · Elevate Growth System
          </div>
        </div>
      </div>

      {/* 우측 — 로그인 패널 */}
      <div className="login-panel w-full lg:w-[480px] lg:shrink-0">
        <div className="login-eyebrow">{showChangeForm ? 'Password' : 'Login'}</div>
        <h2 className="login-title">{showChangeForm ? '비밀번호 변경' : '로그인'}</h2>
        <p className="login-sub">
          {showChangeForm
            ? '최초 로그인(또는 비밀번호 초기화) 상태입니다. 보안을 위해 새 비밀번호를 설정해 주세요.'
            : '사번과 비밀번호로 로그인해 주세요.'}
        </p>

        {error && (
          <div className="login-alert login-alert-error" role="alert">
            {error}
          </div>
        )}

        {info && (
          <div className="login-alert login-alert-info" role="status">
            {info}
          </div>
        )}

        {!showChangeForm ? (
          <>
            {/* 로그인 폼은 fragment 로 감싸 아래 '초기화 요청' 토글을 형제로 둔다. */}
            <form
              onSubmit={handleCredentials}
              style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="sd-field">
                {/* P3-12: label-input 연결(htmlFor/id) — 스크린리더가 필드명을 읽도록 */}
                <label htmlFor="login-employee-id" className="login-label">사번</label>
                <input
                  id="login-employee-id"
                  className="login-input"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="예: 1234567"
                  autoComplete="username"
                  spellCheck={false}
                />
              </div>
              <div className="sd-field">
                <label htmlFor="login-password" className="login-label">비밀번호 (최초 로그인은 사번)</label>
                <input
                  id="login-password"
                  className="login-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                />
              </div>
              <button type="submit" disabled={isLoading} className="login-cta" style={{ marginTop: 4 }}>
                {isLoading ? '로그인 중…' : '로그인'} {isLoading ? <Spinner size={16} /> : <IconArrowRight size={16} />}
              </button>
            </form>
            {!resetOpen ? (
              <button
                type="button"
                onClick={() => {
                  setResetOpen(true);
                  setError('');
                  setInfo('');
                }}
                className="login-link"
                style={{ marginTop: 16, alignSelf: 'flex-start' }}
              >
                비밀번호를 잊으셨나요? 초기화 요청
              </button>
            ) : (
              <form
                onSubmit={handleResetRequest}
                style={{
                  marginTop: 18,
                  paddingTop: 18,
                  borderTop: '1px solid var(--lg-border-soft)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--lg-text-soft)', lineHeight: 1.55 }}>
                  사번을 입력하면 관리자에게 초기화 요청이 전달됩니다. 승인되면 <b>사번(초기 비밀번호)</b>으로
                  로그인 후 새 비밀번호를 설정하세요.
                </div>
                <div className="sd-field">
                  <label htmlFor="login-reset-employee-id" className="login-label">사번</label>
                  <input
                    id="login-reset-employee-id"
                    className="login-input"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    placeholder="예: 1234567"
                    spellCheck={false}
                  />
                </div>
                <input
                  className="login-input"
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="요청 사유 (선택)"
                  aria-label="요청 사유 (선택)"
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={isLoading} className="login-cta" style={{ flex: 1, height: 42 }}>
                    {isLoading ? '요청 중…' : '초기화 요청'} {isLoading && <Spinner size={16} />}
                  </button>
                  <button
                    type="button"
                    className="login-btn-ghost"
                    onClick={() => {
                      setResetOpen(false);
                      setError('');
                    }}
                  >
                    취소
                  </button>
                </div>
              </form>
            )}
          </>
        ) : (
          <form
            onSubmit={handleChangePassword}
            style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div className="sd-field">
              <label htmlFor="login-current-password" className="login-label">현재 비밀번호 (최초 로그인은 사번)</label>
              <input
                id="login-current-password"
                className="login-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="현재 비밀번호"
                autoComplete="current-password"
              />
            </div>
            <div className="sd-field">
              <label htmlFor="login-new-password" className="login-label">새 비밀번호 (8자 이상, 사번 사용 불가)</label>
              <input
                id="login-new-password"
                className="login-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 비밀번호"
                autoComplete="new-password"
              />
            </div>
            <div className="sd-field">
              <label htmlFor="login-confirm-password" className="login-label">새 비밀번호 확인</label>
              <input
                id="login-confirm-password"
                className="login-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="다시 입력"
                autoComplete="new-password"
              />
            </div>
            <button type="submit" disabled={isLoading} className="login-cta" style={{ marginTop: 4 }}>
              {isLoading ? '변경 중…' : '비밀번호 변경 후 시작'} {isLoading ? <Spinner size={16} /> : <IconArrowRight size={16} />}
            </button>
            <button
              type="button"
              onClick={handleBackToLogin}
              disabled={isLoading}
              className="login-btn-ghost"
            >
              <ArrowLeft size={15} aria-hidden="true" /> 뒤로 (다른 사번으로 로그인)
            </button>
          </form>
        )}

        <div className="login-tip">
          <div className="login-eyebrow" style={{ fontSize: 'var(--fs-2xs)' }}>Tip</div>
          <div style={{ fontSize: 'var(--fs-sm)', marginTop: 5, color: 'var(--lg-text-soft)', lineHeight: 1.55 }}>
            로그인 후 상단바의 역할 스위처에서 피평가자 / 평가자 / HR을 전환할 수 있습니다.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

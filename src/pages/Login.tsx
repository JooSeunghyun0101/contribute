import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { BrandLockup, IconArrowRight } from '@/components/brand';

const roleLabel: Record<string, string> = {
  hr: 'HR 관리자',
  evaluator: '평가자',
  evaluatee: '피평가자',
};

const Login = () => {
  const { user, login, getAvailableRoles } = useAuth();
  const navigate = useNavigate();

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [availableRoles, setAvailableRoles] = useState<('hr' | 'evaluator' | 'evaluatee')[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [step, setStep] = useState<'credentials' | 'role'>('credentials');
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
      if (roles.length === 1) {
        setIsLoading(true);
        const ok = await login(employeeId, password, roles[0]);
        setIsLoading(false);
        if (!ok) setError('사번 또는 비밀번호가 올바르지 않습니다.');
        else navigate('/');
      } else {
        setAvailableRoles(roles);
        setStep('role');
      }
    } catch {
      setError('사번 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  const handleRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    const ok = await login(employeeId, password, selectedRole);
    setIsLoading(false);
    if (!ok) setError('로그인 중 오류가 발생했습니다.');
    else navigate('/');
  };

  const bgL = '#1F1428';
  const panelL = '#2A1D35';
  const inputL = '#3A2A48';
  const borderL = '#4A3A58';
  const textSoft = '#C9B8D4';
  const textSubtle = '#8A7A96';

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: `radial-gradient(1200px 600px at 15% 20%, rgba(217,98,60,0.18), transparent 60%), radial-gradient(900px 500px at 85% 100%, rgba(217,154,78,0.12), transparent 60%), ${bgL}`,
        color: '#F4EDE3',
        display: 'flex',
      }}
    >
      {/* Left — brand story */}
      <div
        style={{
          flex: 1,
          padding: '70px 72px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
        }}
        className="hidden lg:flex"
      >
        <div
          style={{
            position: 'absolute',
            bottom: -120,
            left: -80,
            width: 360,
            height: 360,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(232,122,82,0.35) 0%, rgba(217,154,78,0.15) 40%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative' }}>
          <BrandLockup />
          <div
            style={{
              marginTop: 100,
              fontSize: 15,
              color: 'var(--ok-yellow-300)',
              fontWeight: 700,
              letterSpacing: '0.12em',
            }}
          >
            CONTRIBUTION EVALUATION
          </div>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              lineHeight: 1.05,
              marginTop: 12,
            }}
          >
            기여를
            <br />
            <span
              style={{
                background: 'linear-gradient(90deg, #E87A52 0%, #E8BC82 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              측정하다
              <span style={{ color: 'var(--ok-yellow)', WebkitTextFillColor: 'var(--ok-yellow)' }}>
                !
              </span>
            </span>
          </h1>
          <p style={{ color: textSoft, marginTop: 20, fontSize: 15, lineHeight: 1.6, maxWidth: 480 }}>
            과업 × 기여방식 × 기여범위의 정량 매트릭스.
            <br />
            2026년, OK금융그룹의 새로운 평가 체계가 시작됩니다.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 40,
            fontSize: 12,
            color: textSubtle,
            position: 'relative',
          }}
        >
          <div>
            <div style={{ color: textSoft, fontWeight: 700, fontSize: 16 }}>342</div>
            평가 대상자
          </div>
          <div>
            <div style={{ color: textSoft, fontWeight: 700, fontSize: 16 }}>48</div>
            평가자
          </div>
          <div>
            <div style={{ color: textSoft, fontWeight: 700, fontSize: 16 }}>4×4</div>
            매트릭스
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
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.14em',
            color: 'var(--ok-yellow-300)',
          }}
        >
          {step === 'credentials' ? 'LOGIN' : 'SELECT ROLE'}
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
          {step === 'credentials' ? 'Welcome back.' : '역할 선택'}
        </h2>

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              background: 'rgba(220, 69, 69, 0.15)',
              border: '1px solid rgba(220, 69, 69, 0.4)',
              borderRadius: 10,
              color: '#FFB4B4',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {step === 'credentials' ? (
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
                background: 'linear-gradient(135deg, #D9623C 0%, #BE4E2C 100%)',
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
            <div style={{ fontSize: 11, color: textSubtle, textAlign: 'center', marginTop: 6 }}>
              SSO · OK금융그룹 통합인증
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleRole}
            style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {availableRoles.map((r) => (
              <label
                key={r}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: `1px solid ${selectedRole === r ? 'var(--ok-orange)' : borderL}`,
                  background: selectedRole === r ? 'rgba(217,98,60,0.15)' : inputL,
                  cursor: 'pointer',
                  color: '#F4EDE3',
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={selectedRole === r}
                  onChange={() => setSelectedRole(r)}
                  style={{ accentColor: '#D9623C' }}
                />
                <span style={{ fontWeight: 600 }}>{roleLabel[r] ?? r}</span>
              </label>
            ))}
            <button
              type="submit"
              disabled={isLoading || !selectedRole}
              style={{
                height: 46,
                marginTop: 6,
                background: 'linear-gradient(135deg, #D9623C 0%, #BE4E2C 100%)',
                color: '#fff',
                fontWeight: 700,
                borderRadius: 10,
                border: 'none',
                cursor: isLoading || !selectedRole ? 'not-allowed' : 'pointer',
                opacity: isLoading || !selectedRole ? 0.6 : 1,
              }}
            >
              {isLoading ? '로그인 중…' : '선택한 역할로 로그인'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setSelectedRole('');
                setAvailableRoles([]);
              }}
              style={{
                background: 'transparent',
                color: textSoft,
                border: 'none',
                fontSize: 13,
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              ← 이전으로
            </button>
          </form>
        )}

        <div
          style={{
            marginTop: 32,
            padding: '14px 16px',
            background: 'rgba(217,98,60,0.12)',
            borderRadius: 10,
            border: `1px solid ${borderL}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--ok-yellow-300)',
              fontWeight: 700,
              letterSpacing: '0.1em',
            }}
          >
            TIP
          </div>
          <div style={{ fontSize: 12, marginTop: 4, color: textSoft, lineHeight: 1.5 }}>
            로그인 후 상단바의 역할 스위처에서 피평가자 / 평가자 / HR을 전환할 수 있습니다.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

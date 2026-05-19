import { useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { employeeService } from '@/lib/services';

const ROLE_CARDS = [
  { id: 'hr', label: 'HR', desc: '시스템 설정 전체', borderColor: '#2563EB', color: '#EFF6FF' },
  { id: 'evaluator', label: '평가자', desc: '팀원 평가 · 피드백 작성', borderColor: '#F55000', color: 'var(--ok-orange-50)' },
  { id: 'evaluatee', label: '피평가자', desc: '과업 등록 · 피드백 열람', borderColor: 'var(--border)', color: 'var(--bg-muted)' },
];

const HrSettingsPage = () => {
  const { employees, reload } = useAllEmployees();
  const { user } = useAuth();
  const { toast } = useToast();
  const actorId = user?.employeeId ?? user?.id ?? null;
  const [resettingKind, setResettingKind] = useState<null | 'employees' | 'matching'>(null);

  const counts = {
    hr: employees.filter((e) => e.available_roles.includes('hr')).length,
    evaluator: employees.filter((e) => e.available_roles.includes('evaluator')).length,
    evaluatee: employees.filter((e) => e.available_roles.includes('evaluatee')).length,
  };

  const handleResetEmployees = async () => {
    const ok = window.confirm(
      '⚠ 대상자 일괄삭제\n\nadmin을 제외한 모든 직원과 그들의 평가·과업·피드백·이력·임포트 데이터를 영구 삭제합니다.\n되돌릴 수 없습니다.\n\n진행할까요?',
    );
    if (!ok) return;
    const confirmText = window.prompt('정말 삭제하려면 "RESET" 을 입력해 주세요.');
    if (confirmText !== 'RESET') {
      toast({ title: '취소되었습니다.', description: 'RESET 이 입력되지 않았습니다.' });
      return;
    }
    setResettingKind('employees');
    try {
      const result = await employeeService.resetEmployees({ actor_id: actorId });
      await reload();
      toast({
        title: '대상자 일괄삭제 완료',
        description: `${result.deleted_employees}명 + 관련 데이터가 모두 삭제되었습니다.`,
      });
    } catch (error) {
      console.error('대상자 일괄삭제 실패:', error);
      toast({
        title: '대상자 일괄삭제 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setResettingKind(null);
    }
  };

  const handleResetMatching = async () => {
    const ok = window.confirm(
      '⚠ 매칭정보 일괄삭제\n\n대상자 프로필은 유지하되 평가자 배정·평가건·과업·피드백·이력·매칭 임포트 데이터를 영구 삭제합니다.\n되돌릴 수 없습니다.\n\n진행할까요?',
    );
    if (!ok) return;
    const confirmText = window.prompt('정말 삭제하려면 "RESET" 을 입력해 주세요.');
    if (confirmText !== 'RESET') {
      toast({ title: '취소되었습니다.', description: 'RESET 이 입력되지 않았습니다.' });
      return;
    }
    setResettingKind('matching');
    try {
      const result = await employeeService.resetMatching({ actor_id: actorId });
      await reload();
      toast({
        title: '매칭정보 일괄삭제 완료',
        description: `${result.cleared_employees}명의 평가자 배정과 평가/이력 데이터가 모두 삭제되었습니다.`,
      });
    } catch (error) {
      console.error('매칭정보 일괄삭제 실패:', error);
      toast({
        title: '매칭정보 일괄삭제 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setResettingKind(null);
    }
  };

  return (
    <>
      <PageHeader
        title="시스템 설정"
        subtitle="평가 기간 · 알림 · 권한 · 매트릭스 · 전사 공통 설정"
      />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        {/* 평가 주기 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>평가 주기</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div>
              <label
                style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}
              >
                평가 주기
              </label>
              <select
                className="sd-input"
                defaultValue="연간"
                style={{ width: '100%' }}
              >
                <option value="연간">연간 (연 1회)</option>
                <option value="반기">반기 (연 2회)</option>
                <option value="분기">분기 (연 4회)</option>
              </select>
            </div>
            <div>
              <label
                style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}
              >
                현재 라운드
              </label>
              <input
                className="sd-input"
                defaultValue="2026"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label
                style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)', display: 'block', marginBottom: 6 }}
              >
                마감일
              </label>
              <input
                className="sd-input"
                type="date"
                defaultValue="2026-12-31"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </section>

        {/* 알림 설정 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>알림 설정</h3>
          <NotificationSettings onClose={() => {}} />
        </section>

        {/* 권한 & 역할 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>권한 &amp; 역할</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {ROLE_CARDS.map((card) => {
              const count = counts[card.id as keyof typeof counts];
              return (
                <div
                  key={card.id}
                  style={{
                    padding: '20px 22px',
                    borderRadius: 14,
                    background: card.color,
                    border: `1.5px solid ${card.borderColor}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      color: card.borderColor,
                      marginBottom: 10,
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--fs-display)',
                      fontWeight: 900,
                      color: card.borderColor,
                      lineHeight: 1,
                    }}
                  >
                    {count}
                    <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 600, marginLeft: 4 }}>명</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>{card.desc}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 위험 영역 — DB 일괄 삭제 */}
        <section
          className="sd-card sd-card-lg"
          style={{ border: '1.5px solid rgba(220,69,69,0.45)', background: 'rgba(220,69,69,0.04)' }}
        >
          <h3
            style={{
              fontSize: 'var(--fs-h4)',
              fontWeight: 800,
              marginBottom: 8,
              color: 'var(--danger, #B91C1C)',
            }}
          >
            ⚠ 위험 영역 · DB 초기화
          </h3>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginBottom: 18, lineHeight: 1.6 }}>
            아래 작업은 <b>되돌릴 수 없습니다.</b> 테스트·재세팅 목적으로만 사용하세요.
            admin 계정은 항상 보존됩니다.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            {/* 대상자 일괄삭제 */}
            <div
              style={{
                padding: 18,
                borderRadius: 10,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>대상자 일괄삭제</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                admin 외 모든 직원 + 그들에게 딸린 <b>평가·과업·피드백·이력·임포트 데이터</b>를 완전히 제거합니다.
                평가기간·시스템 설정은 유지됩니다.
              </div>
              <button
                className="sd-btn sd-btn-sm"
                disabled={resettingKind !== null}
                onClick={handleResetEmployees}
                style={{
                  alignSelf: 'flex-start',
                  background: 'var(--danger, #B91C1C)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                }}
              >
                {resettingKind === 'employees' ? '삭제 중…' : '대상자 일괄삭제'}
              </button>
            </div>

            {/* 매칭정보 일괄삭제 */}
            <div
              style={{
                padding: 18,
                borderRadius: 10,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>매칭정보 일괄삭제</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                대상자 프로필은 유지하되 <b>평가자 배정·평가건·과업·피드백·이력·매칭 임포트 데이터</b>를 모두 제거합니다.
                매칭 엑셀을 다시 올리기 전 깨끗한 상태로 되돌릴 때 사용합니다.
              </div>
              <button
                className="sd-btn sd-btn-sm"
                disabled={resettingKind !== null}
                onClick={handleResetMatching}
                style={{
                  alignSelf: 'flex-start',
                  background: 'var(--danger, #B91C1C)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                }}
              >
                {resettingKind === 'matching' ? '삭제 중…' : '매칭정보 일괄삭제'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default HrSettingsPage;

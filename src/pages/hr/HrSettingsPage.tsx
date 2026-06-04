import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useToast } from '@/hooks/use-toast';
import { employeeService } from '@/lib/services';
import { downloadEvaluatorQnaLogsWorkbook } from '@/utils/hrDataExport';
import type { EvaluationPeriodStatus } from '@/types';

const ROLE_CARDS = [
  { id: 'hr', label: 'HR', desc: '시스템 설정 전체', borderColor: '#2563EB', color: '#EFF6FF' },
  { id: 'evaluator', label: '평가자', desc: '팀원 평가 · 피드백 작성', borderColor: '#F55000', color: 'var(--ok-orange-50)' },
  { id: 'evaluatee', label: '피평가자', desc: '과업 등록 · 피드백 열람', borderColor: 'var(--border)', color: 'var(--bg-muted)' },
];

const PERIOD_STATUS_LABEL: Record<EvaluationPeriodStatus, string> = {
  draft: '작성 전',
  active: '진행 중',
  closed: '마감',
  locked: '잠금',
};

const PERIOD_STATUS_STYLE: Record<EvaluationPeriodStatus, { bg: string; fg: string; border: string }> = {
  draft: { bg: 'var(--bg-muted)', fg: 'var(--fg-muted)', border: 'var(--border)' },
  active: { bg: 'var(--ok-orange-50)', fg: 'var(--ok-orange-700)', border: 'var(--ok-orange-100)' },
  closed: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  locked: { bg: '#F8FAFC', fg: '#334155', border: '#CBD5E1' },
};

const formatDate = (value: string | null | undefined) =>
  value ? value.slice(0, 10).replace(/-/g, '.') : '-';

const HrSettingsPage = () => {
  const navigate = useNavigate();
  const { employees, reload } = useAllEmployees();
  const { user } = useAuth();
  const { toast } = useToast();
  const { periods, selectedPeriod } = useEvaluationPeriod();
  const actorId = user?.employeeId ?? user?.id ?? null;
  const [resettingKind, setResettingKind] = useState<null | 'employees' | 'matching'>(null);
  const [downloadingQna, setDownloadingQna] = useState(false);

  const activePeriodCount = periods.filter((p) => p.status === 'active').length;

  const handleDownloadQnaLogs = async () => {
    setDownloadingQna(true);
    try {
      const { rowCount } = await downloadEvaluatorQnaLogsWorkbook();
      toast({
        title: 'AI 문의 이력 다운로드',
        description: rowCount > 0 ? `${rowCount}건을 엑셀로 내려받았습니다.` : '아직 남겨진 문의가 없습니다.',
      });
    } catch (error) {
      console.error('AI 문의 이력 다운로드 실패:', error);
      toast({
        title: 'AI 문의 이력 다운로드 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setDownloadingQna(false);
    }
  };

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
        {/* 활성 평가기간 요약 */}
        <section className="sd-card sd-card-lg">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 18,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CalendarDays size={20} color="var(--ok-orange)" />
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>활성 평가기간</h3>
            </div>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={() => navigate('/hr/periods')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              평가기간 관리
              <ArrowRight size={14} />
            </button>
          </div>

          {selectedPeriod ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
              }}
            >
              <SummaryField label="평가기간">
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>{selectedPeriod.name}</div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace' }}>
                  {selectedPeriod.code}
                </div>
              </SummaryField>
              <SummaryField label="상태">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 12px',
                    borderRadius: 999,
                    background: PERIOD_STATUS_STYLE[selectedPeriod.status].bg,
                    color: PERIOD_STATUS_STYLE[selectedPeriod.status].fg,
                    border: `1px solid ${PERIOD_STATUS_STYLE[selectedPeriod.status].border}`,
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 800,
                  }}
                >
                  {PERIOD_STATUS_LABEL[selectedPeriod.status]}
                </span>
                {selectedPeriod.is_default && (
                  <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                    기본 평가기간
                  </div>
                )}
              </SummaryField>
              <SummaryField label="시작일">
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>{formatDate(selectedPeriod.starts_on)}</div>
              </SummaryField>
              <SummaryField label="종료일">
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>{formatDate(selectedPeriod.ends_on)}</div>
              </SummaryField>
              <SummaryField label="등록된 라운드">
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>
                  전체 {periods.length}개{' '}
                  <span style={{ fontWeight: 500, color: 'var(--fg-muted)' }}>
                    · 진행 {activePeriodCount}개
                  </span>
                </div>
              </SummaryField>
            </div>
          ) : (
            <div
              style={{
                padding: '20px 22px',
                borderRadius: 10,
                background: 'var(--bg-muted)',
                border: '1px dashed var(--border)',
                color: 'var(--fg-muted)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.6,
              }}
            >
              현재 선택된 평가기간이 없습니다. <strong>평가기간 관리</strong>에서 라운드를 생성하고 활성화해 주세요.
            </div>
          )}
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

        {/* 데이터 내보내기 */}
        <section className="sd-card sd-card-lg">
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>데이터 내보내기</h3>
          <div
            style={{
              padding: 18,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>AI 문의 이력 다운로드</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                평가자가 <b>AI 도움말</b>에 남긴 질문과 AI 답변을 엑셀(.xlsx)로 내려받습니다.
                일시·사번·이름·부서·질문·답변이 포함됩니다.
              </div>
            </div>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              disabled={downloadingQna}
              onClick={handleDownloadQnaLogs}
              style={{ flexShrink: 0 }}
            >
              {downloadingQna ? '내려받는 중…' : '엑셀 다운로드'}
            </button>
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

const SummaryField = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <div
      style={{
        fontSize: 'var(--fs-sm)',
        fontWeight: 700,
        color: 'var(--fg-muted)',
        marginBottom: 8,
      }}
    >
      {label}
    </div>
    {children}
  </div>
);

export default HrSettingsPage;

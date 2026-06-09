import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { employeeService } from '@/lib/services';
import { downloadEvaluatorQnaLogsWorkbook } from '@/utils/hrDataExport';

// 위험 영역(DB 일괄삭제)은 명시적으로 켰을 때만 노출한다.
// VITE_* 는 항상 string | undefined 이므로 정확히 'true' 일 때만 활성화.
const DANGER_ZONE_ENABLED = import.meta.env.VITE_ENABLE_DANGER_ZONE === 'true';

const HrSettingsPage = () => {
  const navigate = useNavigate();
  const { reload } = useAllEmployees();
  const { user } = useAuth();
  const { toast } = useToast();
  const actorId = user?.employeeId ?? user?.id ?? null;
  const [resettingKind, setResettingKind] = useState<null | 'employees' | 'matching'>(null);
  const [downloadingQna, setDownloadingQna] = useState(false);

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
      <PageHeader title="시스템 설정" subtitle="전사 공통 설정" />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">일반</TabsTrigger>
            <TabsTrigger value="notifications">알림</TabsTrigger>
            <TabsTrigger value="permissions">권한·역할</TabsTrigger>
            <TabsTrigger value="advanced">고급/시스템</TabsTrigger>
          </TabsList>

          {/* 일반 — 전사 공통 설정 홈 + 평가기간 관리 진입 */}
          <TabsContent value="general" className="space-y-6">
            <section className="sd-card sd-card-lg">
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 12 }}>전사 공통 설정</h3>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                전사 공통값(<b>평가척도·기본 라운드 정책</b> 등)은 추후 이 탭에 추가됩니다.
                개별 평가기간(라운드)의 생성·활성화·마감은 <b>평가기간 관리</b>에서 처리합니다.
              </p>
            </section>

            <section className="sd-card sd-card-lg">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>평가기간 관리</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                    평가기간(라운드)의 생성·활성화·마감과 활성 평가기간 현황을 확인·관리합니다.
                  </div>
                </div>
                <button
                  className="sd-btn sd-btn-outline sd-btn-sm"
                  onClick={() => navigate('/hr/periods')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                >
                  평가기간 관리
                  <ArrowRight size={14} />
                </button>
              </div>
            </section>
          </TabsContent>

          {/* 알림 — 알림 설정 (변경 없음) */}
          <TabsContent value="notifications" className="space-y-6">
            <section className="sd-card sd-card-lg">
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>알림 설정</h3>
              <NotificationSettings embedded />
            </section>
          </TabsContent>

          {/* 권한·역할 — 사용자 관리 안내 placeholder */}
          <TabsContent value="permissions" className="space-y-6">
            <section className="sd-card sd-card-lg">
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 12 }}>권한·역할</h3>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.6, marginBottom: 18 }}>
                역할·권한 체계 통합 관리 화면은 준비 중입니다.
                현재 사용자별 역할(<b>HR·평가자</b>)은 <b>사용자 관리</b>에서 부여/회수합니다.
              </p>
              <button
                className="sd-btn sd-btn-outline sd-btn-sm"
                onClick={() => navigate('/hr/users')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                사용자 관리
                <ArrowRight size={14} />
              </button>
            </section>
          </TabsContent>

          {/* 고급/시스템 — 데이터 내보내기 + 위험 영역(가드) */}
          <TabsContent value="advanced" className="space-y-6">
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

            {/* 위험 영역 — DB 일괄 삭제 (VITE_ENABLE_DANGER_ZONE=true 일 때만 노출) */}
            {DANGER_ZONE_ENABLED && (
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
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default HrSettingsPage;

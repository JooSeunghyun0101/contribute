import { useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import PageHeader from '@/components/Layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import PasswordResetManager from '@/components/hr/PasswordResetManager';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { employeeService } from '@/lib/services';
import { downloadEvaluatorQnaLogsWorkbook } from '@/utils/hrDataExport';

// 위험 영역(DB 일괄삭제)은 명시적으로 켰을 때만 노출한다.
// VITE_* 는 항상 string | undefined 이므로 정확히 'true' 일 때만 활성화.
const DANGER_ZONE_ENABLED = import.meta.env.VITE_ENABLE_DANGER_ZONE === 'true';

const HrSettingsPage = () => {
  const { reload } = useAllEmployees();
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: '대상자 일괄삭제',
      description:
        'admin을 제외한 모든 직원과 그들의 평가·과업·피드백·이력·임포트 데이터를 영구 삭제합니다. 되돌릴 수 없습니다. 계속하려면 "RESET"을 입력하세요.',
      variant: 'danger',
      requireTypedConfirmation: 'RESET',
      confirmText: '대상자 일괄삭제',
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: '매칭정보 일괄삭제',
      description:
        '대상자 프로필은 유지하되 평가자 배정·평가건·과업·피드백·이력·매칭 임포트 데이터를 영구 삭제합니다. 되돌릴 수 없습니다. 계속하려면 "RESET"을 입력하세요.',
      variant: 'danger',
      requireTypedConfirmation: 'RESET',
      confirmText: '매칭정보 일괄삭제',
    });
    if (!ok) return;
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
      <PageHeader title="시스템 설정" subtitle="알림·시스템 관리" />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        <Tabs defaultValue="notifications" className="space-y-6">
          <TabsList>
            <TabsTrigger value="notifications">알림</TabsTrigger>
            <TabsTrigger value="account">비밀번호</TabsTrigger>
            <TabsTrigger value="advanced">고급/시스템</TabsTrigger>
          </TabsList>

          {/* 일반·권한역할 탭은 placeholder("추후 추가/준비 중")라 제거 — 평가기간·사용자 관리는 사이드바 메뉴와 중복.
              권한역할 UI는 서버 인증(Phase S) 도입 후 실제 역할 관리 화면으로 부활 예정. */}

          {/* 알림 — 알림 채널 현황 안내 */}
          <TabsContent value="notifications" className="space-y-6">
            <section className="sd-card sd-card-lg">
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>알림 설정</h3>
              <NotificationSettings embedded />
            </section>
          </TabsContent>

          {/* 비밀번호 — 초기화 요청 승인/반려 + HR 직접 초기화 */}
          <TabsContent value="account" className="space-y-6">
            <PasswordResetManager />
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

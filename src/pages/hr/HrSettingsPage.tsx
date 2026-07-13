import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import PageHeader from '@/components/Layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import { PromptManagement } from '@/components/Settings/PromptManagement';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { employeeService, evaluationPeriodService } from '@/lib/services';
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
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const defaultTab = ['notifications', 'prompts', 'advanced'].includes(tabParam ?? '')
    ? (tabParam as string)
    : 'notifications';
  // controlled Tabs — 이미 이 페이지에 있는 상태에서 ?tab= 딥링크(알림 클릭 등)로 오면
  // 리마운트가 없어 defaultValue 만으로는 탭이 안 바뀐다. 쿼리 변경을 상태로 동기화.
  const [activeTab, setActiveTab] = useState(defaultTab);
  useEffect(() => {
    if (tabParam && ['notifications', 'prompts', 'advanced'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);
  const [resettingKind, setResettingKind] = useState<null | 'employees' | 'matching' | 'period'>(null);
  const [downloadingQna, setDownloadingQna] = useState(false);
  const [resetPeriods, setResetPeriods] = useState<Array<{ id: string; code: string; name: string; status: string }>>([]);
  const [resetPeriodId, setResetPeriodId] = useState<string>('');

  useEffect(() => {
    if (!DANGER_ZONE_ENABLED) return;
    let alive = true;
    evaluationPeriodService
      .getPeriods()
      .then((list) => {
        if (!alive) return;
        const mapped = list.map((p) => ({ id: p.id, code: p.code, name: p.name, status: String(p.status) }));
        setResetPeriods(mapped);
        setResetPeriodId((cur) => cur || mapped[0]?.id || '');
      })
      .catch(() => {
        /* 위험영역 전용 — 조회 실패 시 조용히 빈 목록 */
      });
    return () => {
      alive = false;
    };
  }, []);

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

  const handleResetPeriod = async () => {
    const period = resetPeriods.find((p) => p.id === resetPeriodId);
    if (!period) {
      toast({ title: '평가기간을 선택하세요.', variant: 'destructive' });
      return;
    }
    const ok = await confirm({
      title: `평가기간 초기화 — ${period.name}`,
      description:
        `'${period.name}'(${period.code}) 평가기간의 평가·과업·피드백·매칭·조직정보를 영구 삭제합니다. ` +
        '직원 명부와 다른 평가기간은 유지됩니다. 되돌릴 수 없습니다. 계속하려면 "RESET"을 입력하세요.',
      variant: 'danger',
      requireTypedConfirmation: 'RESET',
      confirmText: '이 평가기간 초기화',
    });
    if (!ok) return;
    setResettingKind('period');
    try {
      const result = await employeeService.resetPeriod({
        evaluation_period_id: period.id,
        actor_id: actorId,
      });
      await reload();
      toast({
        title: '평가기간 초기화 완료',
        description: `${result.message} (평가 ${result.deleted_evaluations}건 삭제)`,
      });
    } catch (error) {
      console.error('평가기간 초기화 실패:', error);
      toast({
        title: '평가기간 초기화 실패',
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="notifications">알림</TabsTrigger>
            <TabsTrigger value="prompts">AI 프롬프트</TabsTrigger>
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

          {/* AI 프롬프트 — 시스템 AI 기능에 쓰이는 프롬프트 통합 관리 */}
          <TabsContent value="prompts" className="space-y-6">
            <PromptManagement showClose={false} />
          </TabsContent>

          {/* 고급/시스템 — 데이터 내보내기 + 위험 영역(가드) */}
          <TabsContent value="advanced" className="space-y-6">
            {/* 데이터 내보내기 */}
            <section className="sd-card sd-card-lg">
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 20 }}>데이터 내보내기</h3>
              <div
                style={{
                  padding: 18,
                  borderRadius: 'var(--r-md)',
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
                style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg)' }}
              >
                <h3
                  style={{
                    fontSize: 'var(--fs-h4)',
                    fontWeight: 800,
                    marginBottom: 8,
                    color: 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={17} aria-hidden /> 위험 영역 · DB 초기화
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
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>
                      대상자 일괄삭제 <span style={{ color: 'var(--danger)' }}>(전체 · 모든 평가기간)</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                      <b>모든 평가기간</b>의 admin 외 전 직원 + 딸린 <b>평가·과업·피드백·이력·임포트</b>를 완전히 제거합니다.
                      <b>처음부터 다시 세팅</b>할 때만 쓰세요. 특정 기간만 비우려면 아래 <b>‘평가기간별 초기화’</b>를 사용합니다.
                      (평가기간·시스템 설정·admin 은 유지)
                    </div>
                    <button
                      className="sd-btn sd-btn-danger sd-btn-sm"
                      disabled={resettingKind !== null}
                      onClick={handleResetEmployees}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {resettingKind === 'employees' ? '삭제 중…' : '대상자 일괄삭제'}
                    </button>
                  </div>

                  {/* 매칭정보 일괄삭제 */}
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>
                      매칭정보 일괄삭제 <span style={{ color: 'var(--danger)' }}>(모든 평가기간)</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                      대상자 프로필은 유지하되 <b>모든 평가기간</b>의 <b>평가자 배정·평가·과업·피드백·이력·매칭 임포트</b>를 제거합니다.
                      특정 기간 매칭만 되돌리려면 아래 <b>‘평가기간별 초기화’</b>를 사용합니다.
                    </div>
                    <button
                      className="sd-btn sd-btn-danger sd-btn-sm"
                      disabled={resettingKind !== null}
                      onClick={handleResetMatching}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {resettingKind === 'matching' ? '삭제 중…' : '매칭정보 일괄삭제'}
                    </button>
                  </div>

                  {/* 평가기간별 초기화 */}
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>평가기간별 초기화</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                      선택한 평가기간의 <b>평가·과업·피드백·매칭·조직정보</b>만 삭제합니다.
                      직원 명부와 <b>다른 평가기간은 유지</b>됩니다.
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        className="sd-btn sd-btn-danger sd-btn-sm"
                        disabled={resettingKind !== null || !resetPeriodId}
                        onClick={handleResetPeriod}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {resettingKind === 'period' ? '삭제 중…' : '이 평가기간 초기화'}
                      </button>
                      <select
                        className="sd-input"
                        value={resetPeriodId}
                        onChange={(e) => setResetPeriodId(e.target.value)}
                        disabled={resettingKind !== null || resetPeriods.length === 0}
                        style={{ width: 'auto', minWidth: 180, padding: '6px 10px' }}
                      >
                        {resetPeriods.length === 0 && <option value="">불러오는 중…</option>}
                        {resetPeriods.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.status})
                          </option>
                        ))}
                      </select>
                    </div>
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

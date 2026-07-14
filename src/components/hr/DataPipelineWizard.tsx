import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pill } from '@/components/brand';
import { employeeService, type OrgStructureImport } from '@/lib/services';

// F2-7: 업로드 순서 위저드 — 선택 평가기간 기준으로
// ① 조직정보 → ② 대상자 → ③ 매칭 → ④ 기여도 4단계의 완료 여부를 보여주고,
// 각 단계의 업로드를 부모의 기존 파일선택 핸들러로 트리거한다(업로드 파이프 로직은 불변).

export type ContribLoadStats = {
  // 선택 기간의 평가행 수 / 그중 evaluation_status 가 draft 초과(제출 이상)인 수 — '적재됨' 근사치.
  total: number;
  loaded: number;
};

type Props = {
  periodId: string | null;
  periodName: string | null;
  contribStats: ContribLoadStats;
  onTriggerOrgUpload: () => void;
  onTriggerProfileUpload: () => void;
  onTriggerMatchingUpload: () => void;
  onTriggerContribUpload: () => void;
  onClose: () => void;
};

type StepInfo = {
  title: string;
  description: string;
  done: boolean;
  detail: string;
  onTrigger: () => void;
};

const formatDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('ko-KR');
};

const DataPipelineWizard = ({
  periodId,
  periodName,
  contribStats,
  onTriggerOrgUpload,
  onTriggerProfileUpload,
  onTriggerMatchingUpload,
  onTriggerContribUpload,
  onClose,
}: Props) => {
  const [isLoading, setIsLoading] = useState(true);
  const [orgImport, setOrgImport] = useState<OrgStructureImport | null>(null);
  // null = 조회 실패(미상), 숫자 = 그 기간 최신 배치의 행 수.
  const [profileCount, setProfileCount] = useState<number | null>(0);
  const [matchingCount, setMatchingCount] = useState<number | null>(0);

  useEffect(() => {
    if (!periodId) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const load = async () => {
      const [orgRes, profileRes, matchingRes] = await Promise.allSettled([
        employeeService.getOrgStructureImports(),
        employeeService.getLatestEmployeeProfileImportRows(periodId),
        employeeService.getLatestMatchingImportRows(periodId),
      ]);
      if (cancelled) return;
      setOrgImport(
        orgRes.status === 'fulfilled'
          ? (orgRes.value.find((h) => h.evaluation_period_id === periodId) ?? null)
          : null,
      );
      setProfileCount(profileRes.status === 'fulfilled' ? profileRes.value.length : null);
      setMatchingCount(matchingRes.status === 'fulfilled' ? matchingRes.value.length : null);
      setIsLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [periodId]);

  const countDetail = (count: number | null, unit: string): string => {
    if (count === null) return '업로드 이력 확인 실패';
    return count > 0 ? `최근 업로드 ${count}${unit}` : '이 기간 업로드 없음';
  };

  const steps: StepInfo[] = [
    {
      title: '조직정보 업로드',
      description: '평가기간 기준 조직구조(법인·본부·부·팀)를 가장 먼저 올립니다.',
      done: orgImport !== null,
      detail: orgImport
        ? `부서 ${orgImport.node_count}개${formatDate(orgImport.uploaded_at) ? ` · ${formatDate(orgImport.uploaded_at)} 업로드` : ''}`
        : '이 기간 조직정보 업로드 없음',
      onTrigger: onTriggerOrgUpload,
    },
    {
      title: '대상자 업로드',
      description: '평가 대상자 명단을 올려 이 기간의 평가행을 만듭니다.',
      done: (profileCount ?? 0) > 0,
      detail: countDetail(profileCount, '행'),
      onTrigger: onTriggerProfileUpload,
    },
    {
      title: '매칭 업로드',
      description: '평가자–피평가자 매칭을 올려 평가자 배정과 발령 이력을 반영합니다.',
      done: (matchingCount ?? 0) > 0,
      detail: countDetail(matchingCount, '행'),
      onTrigger: onTriggerMatchingUpload,
    },
    {
      title: '기여도 업로드',
      description: '기여도(과업·점수)를 이 기간의 기존 평가행에 적재합니다.',
      done: contribStats.loaded > 0,
      detail:
        contribStats.total === 0
          ? '이 기간 평가행 없음 — 대상자/매칭 업로드가 선행돼야 합니다.'
          : contribStats.loaded > 0
            ? `평가 ${contribStats.total}건 중 ${contribStats.loaded}건 적재됨(근사)`
            : `평가 ${contribStats.total}건 · 미적재`,
      onTrigger: onTriggerContribUpload,
    },
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent style={{ maxWidth: 'min(560px, 94vw)', maxHeight: '88vh', overflow: 'auto' }}>
        <DialogHeader>
          <DialogTitle>업로드 순서 가이드</DialogTitle>
          <DialogDescription>
            {periodName ?? '평가기간 미선택'} · 조직정보 → 대상자 → 매칭 → 기여도 순서로 올려야
            기간 데이터가 정확히 적재됩니다.
          </DialogDescription>
        </DialogHeader>

        {!periodId ? (
          <div style={{ padding: '16px 4px', color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            평가기간을 먼저 선택하세요. 업로드 순서 안내는 선택한 평가기간 기준으로 표시됩니다.
          </div>
        ) : isLoading ? (
          <div style={{ padding: '16px 4px', color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            단계별 업로드 상태 확인 중…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {steps.map((step, i) => {
              const priorDone = steps.slice(0, i).every((s) => s.done);
              return (
                <div
                  key={step.title}
                  className="sd-card"
                  style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 'var(--r-pill)',
                        background: step.done ? 'var(--ok-orange-50)' : 'var(--bg-muted)',
                        color: step.done ? 'var(--ok-orange)' : 'var(--fg-muted)',
                        border: `1px solid ${step.done ? 'var(--ok-orange-100)' : 'var(--border)'}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--fs-sm)',
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <strong style={{ fontSize: 'var(--fs-body)' }}>{step.title}</strong>
                    <Pill tone={step.done ? 'success' : 'neutral'}>
                      {step.done ? '완료' : '미완료'}
                    </Pill>
                    <button
                      type="button"
                      className="sd-btn sd-btn-outline sd-btn-sm"
                      style={{ marginLeft: 'auto', flexShrink: 0 }}
                      onClick={step.onTrigger}
                    >
                      업로드
                    </button>
                  </div>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                    {step.description}
                  </span>
                  <span
                    className="tnum"
                    style={{
                      fontSize: 'var(--fs-sm)',
                      color: step.done ? 'var(--fg)' : 'var(--fg-subtle)',
                      fontWeight: 600,
                    }}
                  >
                    {step.detail}
                  </span>
                  {!priorDone && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', fontWeight: 600 }}>
                      이전 단계가 아직 완료되지 않았습니다. 순서대로 업로드해야 기간 데이터가
                      정확합니다.
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DataPipelineWizard;

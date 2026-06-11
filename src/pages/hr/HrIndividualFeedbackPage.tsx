import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationPeriodSelector } from '@/components/Layout/EvaluationPeriodSelector';
import { IconSearch, IconUser, Pill } from '@/components/brand';
import { useToast } from '@/hooks/use-toast';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { matchesOrgNodes, orgPathLabel } from '@/lib/orgHierarchy';
import {
  formatScore,
  getGrowthLevelExpectation,
  getScoreColor,
  getScoreGapBucket,
  getScoreTextColor,
  MATRIX_METHOD_GUIDE,
  MATRIX_SCOPE_GUIDE,
  SCORE_GAP_EXPECTATIONS,
  type ScoreGapBucket,
} from '@/lib/evaluationMatrix';
import {
  loadEmployeeEvaluationRecord,
  type EmployeeEvaluationRecord,
  type EnrichedTask,
} from '@/lib/dashboardData';
import { downloadIndividualReportWorkbook, type IndividualReportData } from '@/utils/hrDataExport';
import type { Employee, FeedbackHistory } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// 개인 피드백 리포트 — F-D3a 스코프: 피평가자 1명의 평가 결과를 '읽기 전용' 1장으로 요약(HR 배포 준비용).
//
// [읽기 전용 — 절대 쓰기 금지]
//  상세 로드는 loadEmployeeEvaluationRecord(dashboardData.ts)만 사용한다. 이 함수는 getEvaluationByEmployeeId
//  (읽기)만 호출하며 평가가 없으면 evaluation=null 을 반환할 뿐 createEvaluation 같은 INSERT 를 하지 않는다.
//  (useEvaluationDataDB 는 평가 미존재 시 createEvaluation 으로 DB 쓰기를 일으켜 read-only 위반 → 사용 금지.)
//  엑셀 다운로드도 화면 메모리(record) 직렬화만 하므로 추가 조회·쓰기가 0건이다.
//
// [PDF 금지] jsPDF/html2canvas/pdfmake 등 PDF 의존성·생성 없음(D-3). 출력은 웹 1장 + 기존 SheetJS 엑셀뿐.
//
// [갭 = 절대평가] 과업 갭 = getScoreGapBucket(score, growthLevel) = Math.round(score)−Math.round(growthLevel).
//  종합 달성 = flooredScore(=Math.floor(weightedScore)) ≥ growthLevel. 표시점수는 floorScoreTenths 절사.
//  표시점수(2.9)와 갭기준 정수점수(2)는 산출 출처가 달라 한 화면에서 직관적으로 안 맞아 보일 수 있다(기존
//  HrDepartmentResultsPage 와 동일 동작). 캡션으로 명시한다.
//
// [무폭주] 목록(피평가자 선택)은 useAllEmployees(skipTasks=true) 1훅으로 한 번 로드한 뒤 메모리 필터만 한다.
//  상세는 선택된 1명만 loadEmployeeEvaluationRecord 로 단건 로드한다 — per-건 반복 조회 없음.
//
// [발령 다중평가자] getEvaluationByEmployeeId(periodId) 가 현재 평가자(employee.evaluator_id) 기준 1건을
//  고른다. 발령으로 평가가 여러 건이어도 정상 케이스이며, 현재 평가자 기준 1건만 리포트에 싣는다.
//
// [중립 톤] danger/빨강 전면 금지. 점수칩만 4-hue(getScoreColor), 갭·상태·분포는 중립 토큰.
// [AI] 1장 요약의 핵심 가치는 read-only 결과 요약이므로 AI 요약 섹션은 보류한다(로드 시 자동 호출 0건 보장).
// ────────────────────────────────────────────────────────────────────────────

const GAP_BUCKET_ORDER: ScoreGapBucket[] = ['exceed', 'meet', 'near', 'below'];

const evaluationStatusLabel = (status?: string | null): string => {
  if (status === 'completed') return '완료';
  if (status === 'submitted') return '검토 대기';
  if (status === 'evaluating') return '평가 중';
  if (status === 'locked') return '잠금';
  if (status === 'draft' || status === 'in-progress') return '작성 중';
  if (status === 'not-started') return '미시작';
  return status ?? '미시작';
};

const isFinalizedStatus = (status?: string | null): boolean =>
  status === 'completed' || status === 'locked';

const toGrowthLevel = (employee: Employee): number => {
  const n = Number(employee.growth_level);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

// feedbackHistory 를 최신순 정렬한다(없으면 task.feedback 단건으로 폴백).
const sortedFeedback = (task: EnrichedTask): FeedbackHistory[] => {
  const history = task.feedbackHistory ?? [];
  if (history.length > 0) {
    return [...history].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }
  if (task.feedback && task.feedback_date) {
    return [
      {
        id: `${task.task_id}-legacy`,
        task_id: task.task_id,
        content: task.feedback,
        evaluator_name: task.evaluator_name,
        created_at: task.feedback_date,
      },
    ];
  }
  return [];
};

const HrIndividualFeedbackPage = () => {
  const { employees, isLoading, error } = useAllEmployees();
  const { selectedPeriodId, selectedPeriod } = useEvaluationPeriod();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const [record, setRecord] = useState<EmployeeEvaluationRecord | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 검색어 디바운스 — 메모리 필터라 가볍지만 입력 중 잦은 리렌더를 줄인다.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  // 피평가자(evaluatee) 롤 + admin 제외. getActiveEvaluatees 와 동일 기준.
  const evaluatees = useMemo(
    () =>
      employees.filter(
        (employee) =>
          employee.employee_id !== 'admin' && employee.available_roles?.includes('evaluatee'),
      ),
    [employees],
  );

  // 검색 + 조직 필터를 메모리에서만 적용(추가 조회 0).
  const filteredEmployees = useMemo(() => {
    const q = debouncedQuery;
    return evaluatees
      .filter((employee) => matchesOrgNodes(employee, orgFilter))
      .filter((employee) => {
        if (!q) return true;
        return (
          employee.name?.toLowerCase().includes(q) ||
          employee.employee_id?.toLowerCase().includes(q) ||
          employee.department?.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          (a.department ?? '').localeCompare(b.department ?? '', 'ko') ||
          (a.name ?? '').localeCompare(b.name ?? '', 'ko'),
      );
  }, [evaluatees, orgFilter, debouncedQuery]);

  const selectedEmployee = useMemo(
    () => evaluatees.find((employee) => employee.employee_id === selectedEmployeeId) ?? null,
    [evaluatees, selectedEmployeeId],
  );

  // 선택된 1명만 상세 로드(읽기 전용). 평가기간이 바뀌면 다시 로드한다.
  useEffect(() => {
    if (!selectedEmployee) {
      setRecord(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setIsDetailLoading(true);
    setDetailError(null);
    loadEmployeeEvaluationRecord(selectedEmployee, {
      periodId: selectedPeriodId,
      includeFeedbackHistory: true,
    })
      .then((loaded) => {
        if (!cancelled) setRecord(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setRecord(null);
          setDetailError('선택한 직원의 평가 데이터를 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEmployee, selectedPeriodId]);

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}`
    : '평가기간 미선택';

  // 화면이 가진 record 를 엑셀 직렬화용 형태로 변환(다운로드 시 추가 조회 0).
  const buildReportData = (rec: EmployeeEvaluationRecord): IndividualReportData => {
    const growthLevel = toGrowthLevel(rec.employee);
    const tasks = rec.tasks.map((task) => {
      const feedbacks = sortedFeedback(task);
      const latest = feedbacks[0] ?? null;
      const hasScore = task.score !== null && task.score !== undefined;
      const gap = hasScore ? Math.round(Number(task.score)) - Math.round(growthLevel) : null;
      const gapBucket = hasScore ? getScoreGapBucket(Number(task.score), growthLevel) : null;
      return {
        title: task.title,
        weight: Number(task.weight ?? 0),
        contributionMethod: task.contribution_method,
        contributionScope: task.contribution_scope,
        score: hasScore ? Number(task.score) : null,
        gap,
        gapBucket,
        latestFeedback: latest?.content ?? null,
        latestEvaluatorName: latest?.evaluator_name ?? null,
        latestFeedbackDate: latest?.created_at ?? null,
        feedbackCount: feedbacks.length,
      };
    });
    return {
      employeeId: rec.employee.employee_id,
      name: rec.employee.name,
      position: rec.employee.position ?? '',
      department: rec.employee.department ?? '',
      orgPath: orgPathLabel(rec.employee),
      growthLevel: rec.employee.growth_level ?? null,
      growthLevelTitle: getGrowthLevelExpectation(growthLevel).title,
      currentEvaluatorName: rec.evaluation?.evaluator_name ?? null,
      evaluationStatusLabel: evaluationStatusLabel(rec.evaluationStatus),
      displayScore: formatScore(rec.weightedScore),
      flooredScore: rec.flooredScore,
      achieved: rec.achieved,
      totalWeight: rec.totalWeight,
      totalTasks: rec.totalTasks,
      ratedTasks: rec.completedTasks,
      tasks,
    };
  };

  const handleExport = () => {
    if (!record) return;
    try {
      const { taskCount } = downloadIndividualReportWorkbook(buildReportData(record), { periodLabel });
      toast({
        title: '엑셀 내려받기 완료',
        description: `${record.employee.name} 님의 리포트(과업 ${taskCount}건)를 내려받았습니다.`,
      });
    } catch {
      toast({
        title: '내려받기 실패',
        description: '엑셀 생성 중 문제가 발생했습니다.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <PageHeader
        title="개인 피드백 리포트"
        subtitle="피평가자 1명을 선택하면 평가 결과를 읽기 전용 1장으로 요약합니다. 갭은 성장레벨 대비 절대평가이며, 점수는 판정이 아닌 검토 정황입니다."
        actions={
          <>
            <Pill tone="neutral">{periodLabel}</Pill>
            <button
              type="button"
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={handleExport}
              disabled={isDetailLoading || !record}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title={record ? '선택한 직원의 리포트를 엑셀로 내려받습니다' : '먼저 피평가자를 선택하세요'}
            >
              <Download size={15} />
              엑셀 내려받기
            </button>
          </>
        }
        filters={
          <>
            <EvaluationPeriodSelector />
            <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
              <span
                style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-subtle)', pointerEvents: 'none' }}
              >
                <IconSearch width={16} height={16} />
              </span>
              <input
                className="sd-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 · 사번 · 부서 검색"
                style={{ paddingLeft: 36, width: '100%' }}
              />
            </div>
            <OrgChecklist items={evaluatees} value={orgFilter} onChange={setOrgFilter} />
            <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              대상{' '}
              <b className="tnum" style={{ color: 'var(--fg)' }}>
                {filteredEmployees.length}
              </b>
              명
            </div>
          </>
        }
      />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        <CaveatBar />

        {error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 24, alignItems: 'start' }}>
            <EmployeePicker
              employees={filteredEmployees}
              isLoading={isLoading}
              selectedId={selectedEmployeeId}
              onSelect={setSelectedEmployeeId}
            />
            <ReportPanel
              employee={selectedEmployee}
              record={record}
              isLoading={isDetailLoading}
              error={detailError}
            />
          </div>
        )}
      </div>
    </>
  );
};

// ── 상단 caveat 바 ───────────────────────────────────────────────────────────

const CaveatBar = () => (
  <div
    className="sd-card"
    style={{ background: 'var(--bg-muted)', borderColor: 'var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}
  >
    <div className="sd-label-mini">읽어두기</div>
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
      <li>
        갭은 점수 − 성장레벨(절대평가)입니다. 과업 갭은 정수 점수 기준, 종합 달성은 정수 내림 점수(flooredScore)
        기준이라 표시 점수(소수 절사)와 직관적으로 안 맞아 보일 수 있습니다. 판정이 아닌 검토 정황입니다.
      </li>
      <li>
        평가가 완료되지 않은 경우 점수·갭은 잠정값이며, 점수가 입력되지 않은 과업은 갭을 산출하지 않습니다.
      </li>
      <li>
        발령(전보)으로 평가자가 여럿인 피평가자도 현재 평가자 기준 1건만 표시합니다. 이는 정상 케이스이며 이상이
        아닙니다. 이 화면은 읽기 전용이라 어떤 값도 변경되지 않습니다.
      </li>
    </ul>
  </div>
);

// ── 피평가자 선택 목록 ───────────────────────────────────────────────────────

const EmployeePicker = ({
  employees,
  isLoading,
  selectedId,
  onSelect,
}: {
  employees: Employee[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) => (
  <section className="sd-card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 0 }}>
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>피평가자 선택</h2>
    </div>
    <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
      {isLoading ? (
        <div style={{ padding: '20px 16px', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
          명단을 불러오는 중입니다.
        </div>
      ) : employees.length === 0 ? (
        <div style={{ padding: '20px 16px', fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)' }}>
          조건에 맞는 피평가자가 없습니다.
        </div>
      ) : (
        employees.slice(0, PICKER_LIMIT).map((employee) => {
          const active = employee.employee_id === selectedId;
          return (
            <button
              key={employee.employee_id}
              type="button"
              onClick={() => onSelect(employee.employee_id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: active ? 'var(--ok-orange-50)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ color: active ? 'var(--ok-orange)' : 'var(--fg-subtle)', flexShrink: 0 }}>
                <IconUser size={16} />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontWeight: active ? 800 : 600,
                    color: active ? 'var(--ok-orange)' : 'var(--fg)',
                    fontSize: 'var(--fs-body)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {employee.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--fg-subtle)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {employee.employee_id} · {employee.department || '부서 미지정'}
                </span>
              </span>
            </button>
          );
        })
      )}
      {!isLoading && employees.length > PICKER_LIMIT && (
        <div style={{ padding: '12px 16px', fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          {employees.length.toLocaleString('ko-KR')}명 중 {PICKER_LIMIT}명만 표시합니다. 위 검색으로 좁혀
          주세요.
        </div>
      )}
    </div>
  </section>
);

// 좌측 명단은 사이드 패널이라 페이지네이션 대신 표시 상한 + 검색 유도(전사 수천 명 DOM 폭주 방지).
const PICKER_LIMIT = 100;

// ── 리포트 패널(우측 1장) ─────────────────────────────────────────────────────

const ReportPanel = ({
  employee,
  record,
  isLoading,
  error,
}: {
  employee: Employee | null;
  record: EmployeeEvaluationRecord | null;
  isLoading: boolean;
  error: string | null;
}) => {
  if (!employee) {
    return (
      <div
        className="sd-card"
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--fg-subtle)',
          fontSize: 'var(--fs-body)',
        }}
      >
        왼쪽에서 피평가자를 선택하면 평가 결과 1장 요약이 표시됩니다.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="sd-card" style={{ padding: '32px 24px', color: 'var(--fg-muted)' }}>
        {employee.name} 님의 평가 데이터를 불러오는 중입니다.
      </div>
    );
  }
  if (error) {
    return (
      <div className="sd-card" style={{ padding: '24px', color: 'var(--danger)' }}>
        {error}
      </div>
    );
  }
  if (!record) return null;

  const growthLevel = toGrowthLevel(record.employee);
  const growthExpectation = getGrowthLevelExpectation(growthLevel);
  const finalized = isFinalizedStatus(record.evaluationStatus);
  const orgPath = orgPathLabel(record.employee);
  const noEvaluation = !record.evaluation;

  return (
    <div className="flex flex-col gap-6">
      {/* A. 헤더 */}
      <section className="sd-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 'var(--fs-h3)', fontWeight: 800, color: 'var(--fg)' }}>{record.employee.name}</h2>
              <Pill tone="neutral">
                Lv.{growthLevel} · {growthExpectation.title}
              </Pill>
              <Pill tone="neutral">{evaluationStatusLabel(record.evaluationStatus)}</Pill>
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              {record.employee.employee_id} · {record.employee.position || '직급 미지정'} ·{' '}
              {record.employee.department || '부서 미지정'}
            </div>
            {orgPath && (
              <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{orgPath}</div>
            )}
            <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              현재 평가자: <b style={{ color: 'var(--fg)' }}>{record.evaluation?.evaluator_name ?? '미지정'}</b>
            </div>
          </div>
        </div>
        {!finalized && !noEvaluation && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
            평가가 아직 완료되지 않아 점수·갭은 잠정값입니다.
          </div>
        )}
        {noEvaluation && (
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg-muted)',
              background: 'var(--bg-muted)',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            선택한 평가기간에 이 피평가자의 평가가 아직 없습니다. (읽기 전용 화면이라 평가가 생성되지 않습니다.)
          </div>
        )}
      </section>

      {/* B. 과업별 점수·갭·의견 */}
      <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>과업별 결과</h3>
        </div>
        {record.tasks.length === 0 ? (
          <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
            등록된 과업이 없습니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {record.tasks.map((task) => (
              <TaskRow key={task.id} task={task} growthLevel={growthLevel} />
            ))}
          </div>
        )}
      </section>

      {/* C. 종합 — 평가가 없으면 달성/갭 판정을 표시하지 않는다(평가 미존재를 '미달성'으로 오인하지 않게). */}
      {!noEvaluation && (
        <OverallSummary record={record} growthLevel={growthLevel} finalized={finalized} />
      )}
    </div>
  );
};

// ── 과업 행 ─────────────────────────────────────────────────────────────────

const TaskRow = ({ task, growthLevel }: { task: EnrichedTask; growthLevel: number }) => {
  const [expanded, setExpanded] = useState(false);
  const hasScore = task.score !== null && task.score !== undefined;
  const scoreValue = hasScore ? Number(task.score) : null;
  const gap = hasScore ? Math.round(scoreValue as number) - Math.round(growthLevel) : null;
  const bucket = hasScore ? getScoreGapBucket(scoreValue as number, growthLevel) : null;
  const feedbacks = sortedFeedback(task);
  const latest = feedbacks[0] ?? null;
  const olderCount = Math.max(0, feedbacks.length - 1);

  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 360px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 'var(--fs-body)' }}>{task.title}</span>
            <span className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
              가중치 {Number(task.weight ?? 0)}%
            </span>
          </div>
          <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {task.contribution_method && (
              <span
                className="tnum"
                title={MATRIX_METHOD_GUIDE[task.contribution_method] ?? undefined}
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--fg-muted)',
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '2px 7px',
                }}
              >
                방식 · {task.contribution_method}
              </span>
            )}
            {task.contribution_scope && (
              <span
                className="tnum"
                title={MATRIX_SCOPE_GUIDE[task.contribution_scope] ?? undefined}
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--fg-muted)',
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '2px 7px',
                }}
              >
                범위 · {task.contribution_scope}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <ScoreChip score={scoreValue} />
          <GapChip gap={gap} bucket={bucket} />
        </div>
      </div>

      {/* 최신 의견 1건 + 이전 N건 토글 */}
      {latest ? (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg)',
              background: 'var(--bg-muted)',
              borderRadius: 8,
              padding: '10px 12px',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {latest.content}
          </div>
          <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
            {latest.evaluator_name ?? '평가자 미상'}
            {latest.created_at ? ` · ${formatDate(latest.created_at)}` : ''}
          </div>
          {olderCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                style={{
                  marginTop: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ok-orange)',
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {expanded ? '이전 의견 접기' : `이전 의견 ${olderCount}건 더 보기`}
              </button>
              {expanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {feedbacks.slice(1).map((item) => (
                    <div
                      key={item.id}
                      style={{
                        fontSize: 'var(--fs-sm)',
                        color: 'var(--fg-muted)',
                        borderLeft: '2px solid var(--border)',
                        paddingLeft: 10,
                      }}
                    >
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{item.content}</div>
                      <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                        {item.evaluator_name ?? '평가자 미상'}
                        {item.created_at ? ` · ${formatDate(item.created_at)}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
          아직 평가 의견이 없습니다.
        </div>
      )}
    </div>
  );
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ── 점수 칩(4-hue, 점수만 색 사용) ────────────────────────────────────────────

const ScoreChip = ({ score }: { score: number | null }) => {
  if (score === null) {
    return (
      <span
        className="tnum"
        style={{
          minWidth: 42,
          textAlign: 'center',
          fontSize: 'var(--fs-sm)',
          fontWeight: 800,
          color: getScoreTextColor(null),
          background: getScoreColor(null),
          borderRadius: 8,
          padding: '4px 10px',
        }}
        title="미평가"
      >
        미평가
      </span>
    );
  }
  return (
    <span
      className="tnum"
      style={{
        minWidth: 42,
        textAlign: 'center',
        fontSize: 'var(--fs-sm)',
        fontWeight: 800,
        color: getScoreTextColor(score),
        background: getScoreColor(score),
        borderRadius: 8,
        padding: '4px 10px',
      }}
      title={`점수 ${score}`}
    >
      {score}점
    </span>
  );
};

// ── 갭 칩(중립 토큰만) ───────────────────────────────────────────────────────

const GapChip = ({ gap, bucket }: { gap: number | null; bucket: ScoreGapBucket | null }) => {
  if (gap === null || bucket === null) {
    return (
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }} title="미평가 — 갭 산출 불가">
        갭 ―
      </span>
    );
  }
  const expectation = SCORE_GAP_EXPECTATIONS[bucket];
  const gapText = gap > 0 ? `+${gap}` : String(gap);
  return (
    <span
      className="tnum"
      title={`${expectation.label} · ${expectation.summary} (갭 ${gapText})`}
      style={{
        fontSize: 'var(--fs-xs)',
        fontWeight: 700,
        color: 'var(--fg-muted)',
        background: 'var(--bg-muted)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '3px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {expectation.label} · 갭 {gapText}
    </span>
  );
};

// ── C. 종합 요약 ─────────────────────────────────────────────────────────────

const OverallSummary = ({
  record,
  growthLevel,
  finalized,
}: {
  record: EmployeeEvaluationRecord;
  growthLevel: number;
  finalized: boolean;
}) => {
  const buckets = useMemo(() => {
    const counts: Record<ScoreGapBucket, number> = { exceed: 0, meet: 0, near: 0, below: 0 };
    for (const task of record.tasks) {
      if (task.score === null || task.score === undefined) continue;
      counts[getScoreGapBucket(Number(task.score), growthLevel)] += 1;
    }
    return counts;
  }, [record.tasks, growthLevel]);

  const overallGap = record.flooredScore - growthLevel;
  const overallGapText = overallGap > 0 ? `+${overallGap}` : String(overallGap);
  const weightOk = Math.round(record.totalWeight) === 100;

  return (
    <section className="sd-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>종합</h3>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div className="sd-label-mini">표시 점수(가중)</div>
          <div className="tnum" style={{ fontSize: 'var(--fs-h2)', fontWeight: 800, color: 'var(--fg)', lineHeight: 1.1 }}>
            {formatScore(record.weightedScore)}
          </div>
          <div className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', marginTop: 2 }}>
            갭 기준 정수 점수 {record.flooredScore} · 성장레벨 {growthLevel}
          </div>
        </div>
        <div>
          <div className="sd-label-mini">종합 달성</div>
          <div style={{ marginTop: 4 }}>
            <Pill tone="neutral">
              {record.achieved ? '달성' : '미달성'} · 갭 {overallGapText}
            </Pill>
          </div>
        </div>
        <div>
          <div className="sd-label-mini">평가 과업</div>
          <div className="tnum" style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)', marginTop: 2 }}>
            {record.completedTasks}/{record.totalTasks}
          </div>
        </div>
      </div>

      <div>
        <div className="sd-label-mini" style={{ marginBottom: 6 }}>
          갭 분포
        </div>
        <GapDistribution buckets={buckets} />
      </div>

      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', lineHeight: 1.6 }}>
        표시 점수는 가중점수에 소수 절사(둘째 자리 내림)를 적용한 값이고, 갭·달성은 정수 내림 점수 기준이라 산출
        출처가 다릅니다.
        {' '}
        총 가중치 합 {Math.round(record.totalWeight)}%
        {weightOk ? ' (정상)' : ' — 100%가 아니므로 가중치 구성을 확인하세요.'}
        {!finalized ? ' 평가 미완료 상태라 위 값은 잠정값입니다.' : ''}
      </div>
    </section>
  );
};

// ── 갭 분포(중립 칩) ─────────────────────────────────────────────────────────

const GAP_DISTRIBUTION_LABEL: Record<ScoreGapBucket, string> = {
  exceed: '탁월 기여',
  meet: '기준 충족',
  near: '보완 필요',
  below: '미달성',
};

const GapDistribution = ({ buckets }: { buckets: Record<ScoreGapBucket, number> }) => {
  const active = GAP_BUCKET_ORDER.filter((bucket) => buckets[bucket] > 0);
  if (active.length === 0) {
    return <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)' }}>평가된 과업이 없습니다.</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {active.map((bucket) => (
        <span
          key={bucket}
          className="tnum"
          title={SCORE_GAP_EXPECTATIONS[bucket].summary}
          style={{
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            color: 'var(--fg-muted)',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '3px 9px',
          }}
        >
          {GAP_DISTRIBUTION_LABEL[bucket]} {buckets[bucket]}
        </span>
      ))}
    </div>
  );
};

export default HrIndividualFeedbackPage;
